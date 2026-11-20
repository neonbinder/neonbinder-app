/**
 * NEO-574 — the wizard's "Career check" step: where it sits in the walk,
 * how it is counted, what it reports up, and how a re-teamed card leaves the
 * teams step. The step's own behaviour is CareerCheckStep.test.tsx and the
 * rules are career-check.test.tsx. The harness is
 * EntityReviewWizard.autograph.test.tsx's.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";

vi.mock("../../convex/_generated/api", () => {
  const moduleProxy = (mod: string) =>
    new Proxy({}, { get: (_t, fn) => `${mod}.${String(fn)}` });
  return { api: new Proxy({}, { get: (_t, mod) => moduleProxy(String(mod)) }) };
});

let currentRows: unknown[];
/** The ids the wizard asked `players.getManyByIds` for, per render. */
let playerIdReads: string[][];
/** The teams read has answered (false = still loading, so the step waits). */
let teamsLoaded = true;
/** Extra team rows the read serves, by id. */
let teamRows: Array<{ _id: string; name: string; location?: string }> = [];

vi.mock("convex/react", () => ({
  useQuery: (ref: string, args: unknown) => {
    if (args === "skip") return undefined;
    if (ref === "entityReviewQueue.getBatch") return currentRows;
    // NEO-426: no sport is flagged teamless, so the plan's teams step is known.
    if (ref === "sportTeamless.listTeamlessSportIds") return [];
    if (ref === "players.getManyByIds") {
      playerIdReads.push((args as { ids: string[] }).ids);
      const known: Record<string, string> = {
        "p-tatis": "Fernando Tatis Jr.",
        "p-trout": "Mike Trout",
      };
      return (args as { ids: string[] }).ids.map((id) => ({ _id: id, name: known[id] ?? `Name of ${id}` }));
    }
    if (ref === "teams.getManyByIds") {
      // Only the team the search "picks" has a row here; the read itself has
      // answered unless a test holds it back (`teamsLoaded`).
      if (!teamsLoaded) return undefined;
      const ids = (args as { ids: string[] }).ids;
      return [
        ...(ids.includes("picked-team")
          ? [{ _id: "picked-team", name: "Picks", location: "Pickton" }]
          : []),
        ...teamRows.filter((t) => ids.includes(t._id)),
      ];
    }
    return undefined;
  },
  useQueries: (queries: Record<string, { args: { players: unknown[] } }>) => {
    const out: Record<string, unknown> = {};
    for (const [key, { args }] of Object.entries(queries)) {
      out[key] = {
        setYear: 2022,
        players: args.players.map(() => ({ playerId: null, answer: null, candidates: [] })),
      };
    }
    return out;
  },
  useMutation: () => vi.fn(() => Promise.resolve(0)),
  useAction: () => vi.fn(() => Promise.resolve(undefined)),
  useConvex: () => ({ query: vi.fn(() => Promise.resolve({ setYear: 2022, results: [] })) }),
}));

vi.mock("./EntityLinkSearch", () => ({
  default: ({ kind, onSelect }: { kind: string; onSelect: (id: string, name: string) => void }) => (
    <button type="button" onClick={() => onSelect(`picked-${kind}`, `Picked ${kind}`)}>
      Search result {kind}
    </button>
  ),
}));
/** What the coverage fetcher does on mount, per test: answer, or fail. */
let fetcherBehaviour: (
  asks: Array<{ playerId: string; teamId?: string; teamName?: string }>,
  cb: { onAnswered: (a: Record<string, boolean>) => void; onFailed: (k: string[]) => void },
) => void;
let fetcherMounts = 0;

vi.mock("./career-reads", async () => {
  const React = await import("react");
  return {
    CareerCoverageFetcher: (props: {
      asks: Array<{ playerId: string; teamId?: string; teamName?: string }>;
      onAnswered: (a: Record<string, boolean>) => void;
      onFailed: (k: string[]) => void;
    }) => {
      React.useEffect(() => {
        fetcherMounts += 1;
        fetcherBehaviour(props.asks, props);
        // Asked once per mount, as the real one does.
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);
      return null;
    },
    useRelinkCandidates: () => ({ state: "ready", candidates: [] }),
  };
});

import EntityReviewWizard from "./EntityReviewWizard";
import {
  CAREER_READ_FAILED,
  CAREER_RETRY_LABEL,
  CAREER_CHECKING,
  CAREER_NAMES_WAIT_MS,
  CAREER_NEXT_BLOCKED,
  careerHeading,
  CAREER_TEAM_NOT_NEEDED,
  type CareerContext,
} from "./career-check";
import { STEP_SUBTITLE } from "./entity-review-steps";

const NEXT_NAME = "Next (Enter)";
const pid = (s: string) => s as unknown as Id<"players">;
const tid = (s: string) => s as unknown as Id<"teams">;

type Card = {
  cardNumber: string;
  cardName: string;
  players?: string[];
  teams?: string[];
  attributes?: string[];
};

const CARDS: Card[] = [
  { cardNumber: "12", cardName: "Base", players: ["Fernando Tatis Jr."], teams: ["Padres"] },
  { cardNumber: "45", cardName: "Base", players: ["Mike Trout"], teams: ["Angels"] },
];

const CONTEXT: CareerContext = {
  setYear: 2022,
  players: [
    { printed: "Fernando Tatis Jr.", playerId: pid("p-tatis") },
    { printed: "Mike Trout", playerId: pid("p-trout") },
  ],
  teams: [
    { printed: "Padres", teamId: tid("t-padres") },
    { printed: "Angels", teamId: tid("t-angels") },
  ],
  gaps: [{ teamId: tid("t-padres"), playerIds: [pid("p-tatis")] }],
};

function wizard(props: Record<string, unknown> = {}, cards: Card[] = CARDS) {
  return (
    <EntityReviewWizard
      isOpen
      selectorOptionId={"selopt-1" as unknown as Id<"selectorOptions">}
      sportId={"sport-1" as unknown as Id<"selectorOptions">}
      batchId=""
      teamsOnly
      summary={{ cardCount: cards.length, deleteCount: 0, reviewDecisionCount: 0 }}
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
      previewCards={cards}
      onTeamAnswersChange={vi.fn()}
      careerContext={CONTEXT}
      onCareerChange={vi.fn()}
      {...props}
    />
  );
}

const bar = () => screen.getByRole("progressbar", { name: "Wizard progress" });
/** The step the operator is on, as the progress bar reads it (NEO-467). */
const onStep = () => bar().getAttribute("aria-valuetext") ?? "";
const percent = () => Number(bar().getAttribute("aria-valuenow"));
const next = () => screen.getByRole("button", { name: NEXT_NAME });

beforeEach(() => {
  currentRows = [];
  teamsLoaded = true;
  teamRows = [];
  fetcherMounts = 0;
  playerIdReads = [];
  fetcherBehaviour = () => {};
});

describe("when the step is asked", () => {
  it("opens on it, first of the steps, when a new card's team is missing from its player's career", () => {
    render(wizard());
    expect(screen.getByRole("heading", { name: careerHeading(1) })).toBeTruthy();
    expect(screen.getAllByText(STEP_SUBTITLE.career).length).toBeGreaterThan(0);
    expect(onStep()).toBe(STEP_SUBTITLE.career);
    // First of two (the career check, then Save): nothing is behind it.
    expect(percent()).toBe(0);
  });

  it("counts the step it lands on: the bar names it, and Next moves on to Save", () => {
    // The career check is judged once the names are decided, so it can turn up
    // under the operator's feet. NEO-467: there is no growth line to keep
    // quiet; the plan just grows by one and the bar reads the new screen.
    const { rerender } = render(wizard({ careerContext: { ...CONTEXT, gaps: [] } }));
    expect(screen.queryByText(STEP_SUBTITLE.career)).toBeNull();
    rerender(wizard());
    expect(screen.getByRole("heading", { name: careerHeading(1) })).toBeTruthy();
    expect(onStep()).toBe(STEP_SUBTITLE.career);
    fireEvent.click(next());
    expect(onStep()).toBe(STEP_SUBTITLE.save);
    expect(percent()).toBe(100);
  });

  it("lists only the pair the gate called a gap", () => {
    render(wizard());
    expect(screen.getAllByRole("radiogroup")).toHaveLength(1);
    expect(screen.getByText("Fernando Tatis Jr.")).toBeTruthy();
    expect(screen.queryByText("Mike Trout")).toBeNull();
  });

  it("is not asked when nothing is missing", () => {
    render(wizard({ careerContext: { ...CONTEXT, gaps: [] } }));
    expect(screen.queryByText(STEP_SUBTITLE.career)).toBeNull();
  });

  it("is not asked without a set year", () => {
    render(wizard({ careerContext: { ...CONTEXT, setYear: undefined } }));
    expect(screen.queryByText(STEP_SUBTITLE.career)).toBeNull();
  });

  it("is not asked without a context, or without the callback that carries its answers", () => {
    const { unmount } = render(wizard({ careerContext: undefined }));
    expect(screen.queryByText(STEP_SUBTITLE.career)).toBeNull();
    unmount();
    render(wizard({ onCareerChange: undefined }));
    expect(screen.queryByText(STEP_SUBTITLE.career)).toBeNull();
  });

  it("is not asked about a card that re-syncs a stored row", () => {
    render(wizard({ existingCardIndexes: [0] }));
    expect(screen.queryByText(STEP_SUBTITLE.career)).toBeNull();
  });

  it("is not asked about a card with several players", () => {
    const duo: Card[] = [
      { cardNumber: "99", cardName: "Duo", players: ["Fernando Tatis Jr.", "Mike Trout"], teams: ["Padres"] },
    ];
    render(wizard({}, duo));
    expect(screen.queryByText(STEP_SUBTITLE.career)).toBeNull();
  });
});

describe("answers", () => {
  it("every line starts on 'Keep as is', so nothing is reported and Next just passes", () => {
    const onCareerChange = vi.fn();
    render(wizard({ onCareerChange }));
    expect(onCareerChange).toHaveBeenLastCalledWith(undefined);
    fireEvent.click(next());
    expect(screen.queryByRole("heading", { name: careerHeading(1) })).toBeNull();
  });

  it("adding a stint reports it up, with the team by id", () => {
    const onCareerChange = vi.fn();
    render(wizard({ onCareerChange }));
    const group = screen.getAllByRole("radiogroup")[0];
    fireEvent.click(within(group).getByRole("radio", { name: "Add to career" }));
    const fields = onCareerChange.mock.calls.at(-1)?.[0];
    expect(fields?.stints).toEqual([{ playerId: "p-tatis", teamId: "t-padres", fromYear: 2022 }]);
  });

  it("holds Next while an add form's years are not a stint, and says so", () => {
    render(wizard());
    const group = screen.getAllByRole("radiogroup")[0];
    fireEvent.click(within(group).getByRole("radio", { name: "Add to career" }));
    const from = screen.getByLabelText(/^From year for /);
    fireEvent.change(from, { target: { value: "" } });
    fireEvent.click(next());
    expect(screen.getByRole("heading", { name: careerHeading(1) })).toBeTruthy();
    expect(next().getAttribute("aria-disabled")).toBe("true");
    // Why Next is held is said in the wizard's live region, not the step's.
    expect(
      screen.getAllByRole("status").some((el) => el.textContent === CAREER_NEXT_BLOCKED),
    ).toBe(true);
    expect(CAREER_NEXT_BLOCKED).toBe("Fix the years first — then Next.");
  });
});

describe("a re-teamed card leaves the teams step", () => {
  const ANGELS_GAP: CareerContext = {
    ...CONTEXT,
    gaps: [{ teamId: tid("t-angels"), playerIds: [pid("p-trout")] }],
  };

  function reteam() {
    const group = screen.getAllByRole("radiogroup")[0];
    fireEvent.click(within(group).getByRole("radio", { name: "Fix card’s team" }));
    fireEvent.click(screen.getByRole("button", { name: "Pick a team for Mike Trout" }));
    fireEvent.click(screen.getByRole("button", { name: "Search result team" }));
  }

  it("calls the picked team by its short name in the follow-up, not the typeahead's full one", () => {
    fetcherBehaviour = (asks, cb) =>
      cb.onAnswered(Object.fromEntries(asks.map((a) => [`${a.playerId}|${a.teamId}`, false])));
    render(wizard({ careerContext: ANGELS_GAP }, [CARDS[1]]));
    reteam();
    // Still the search result until the team loads; here the mock has it at once.
    expect(screen.getByText("No Picks in Mike Trout’s career by 2022 either.")).toBeTruthy();
  });

  it("reports the printed team dropped and the picked team on", () => {
    const onCareerChange = vi.fn();
    render(wizard({ careerContext: ANGELS_GAP, onCareerChange }, [CARDS[1]]));
    reteam();
    const fields = onCareerChange.mock.calls.at(-1)?.[0];
    expect(fields?.cardEdits[0]).toEqual({
      dropTeams: ["Angels"],
      dropTeamIds: ["t-angels"],
      teamIds: ["picked-team"],
    });
  });

  it("does not ask the teams step about it afterwards, but still asks about a card with no team", () => {
    const cards: Card[] = [CARDS[1], { cardNumber: "77", cardName: "Base", players: ["Pete Rose"] }];
    render(wizard({ careerContext: ANGELS_GAP }, cards));
    reteam();
    fireEvent.click(next());
    expect(screen.queryByRole("heading", { name: careerHeading(1) })).toBeNull();
    // The teams step is about card #77 only.
    expect(screen.getAllByText(STEP_SUBTITLE.teams).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Mike Trout/)).toBeNull();
  });

  it("with nothing else teamless, goes straight on to the save step", () => {
    render(wizard({ careerContext: ANGELS_GAP }, [CARDS[1]]));
    reteam();
    fireEvent.click(next());
    expect(screen.queryAllByText(STEP_SUBTITLE.teams)).toHaveLength(0);
  });
});

/** A batch where the operator linked a player and a team: the gate judged neither pair. */
function linkedRows() {
  return [
    {
      _id: "row-p",
      _creationTime: 1,
      selectorOptionId: "selopt-1",
      batchId: "batch-1",
      kind: "player",
      name: "Mike Trout",
      sportId: "sport-1",
      sportValue: "Baseball",
      setSportId: "sport-1",
      setSportValue: "Baseball",
      status: "ready",
      decision: { action: "link", linkedPlayerId: "p-trout" },
    },
    {
      _id: "row-t",
      _creationTime: 2,
      selectorOptionId: "selopt-1",
      batchId: "batch-1",
      kind: "team",
      name: "Angels",
      sportId: "sport-1",
      sportValue: "Baseball",
      setSportId: "sport-1",
      setSportValue: "Baseball",
      status: "ready",
      decision: { action: "link", linkedTeamId: "t-angels" },
    },
  ];
}

function readWizard() {
  return wizard(
    { teamsOnly: false, batchId: "batch-1", careerContext: { setYear: 2022, players: [], teams: [], gaps: [] } },
    [CARDS[1]],
  );
}

describe("a coverage read that fails (never silently 'covered')", () => {
  it("says the career check could not run, with a Retry, and Next still goes on", () => {
    currentRows = linkedRows();
    fetcherBehaviour = (asks, cb) => cb.onFailed(asks.map((a) => `${a.playerId}|${a.teamId}`));
    render(readWizard());
    expect(screen.getByRole("heading", { name: careerHeading(0) })).toBeTruthy();
    // The words ride the wizard's one live region, not a new one on the step.
    const live = screen
      .getAllByRole("status")
      .find((el) => el.textContent === CAREER_READ_FAILED);
    expect(live).toBeTruthy();
    expect(CAREER_READ_FAILED).toBe("Couldn’t check careers. Retry, or Next saves without it.");
    expect(screen.getByRole("button", { name: CAREER_RETRY_LABEL })).toBeTruthy();
    expect(next().getAttribute("aria-disabled")).not.toBe("true");
    fireEvent.click(next());
    expect(screen.queryByRole("heading", { name: careerHeading(0) })).toBeNull();
  });

  it("says 'Checking careers…' in that same live region while the reads are on their way (A4)", () => {
    currentRows = linkedRows();
    fetcherBehaviour = () => {};
    render(readWizard());
    const live = screen.getAllByRole("status").find((el) => el.textContent === CAREER_CHECKING);
    expect(live).toBeTruthy();
    expect(live?.isConnected).toBe(true);
    expect(CAREER_CHECKING).toBe("Checking careers…");
  });

  it("holds Next while the reads are on their way, with the footer status as the reason, then lets it through", () => {
    currentRows = linkedRows();
    let answer: ((a: Record<string, boolean>) => void) | undefined;
    fetcherBehaviour = (_asks, cb) => {
      answer = cb.onAnswered;
    };
    render(readWizard());
    const status = screen.getAllByRole("status").find((el) => el.textContent === CAREER_CHECKING)!;
    expect(next().getAttribute("aria-disabled")).toBe("true");
    // The reason the button is held is the footer's own live status line.
    expect((next().getAttribute("aria-describedby") ?? "").split(" ")).toContain(status.id);
    // A press (click or Enter) goes nowhere while the answer is out.
    fireEvent.click(next());
    fireEvent.keyDown(next(), { key: "Enter" });
    expect(screen.queryByRole("button", { name: /^Confirm & Save/ })).toBeNull();
    // The answer lands: Next is live again.
    act(() => {
      answer?.({ "p-trout|t-angels": false });
    });
    expect(next().getAttribute("aria-disabled")).not.toBe("true");
  });

  it("waits for the listed teams' names, then shows the lines once, in an order that never moves after", () => {
    const both: CareerContext = {
      ...CONTEXT,
      gaps: [
        { teamId: tid("t-padres"), playerIds: [pid("p-tatis")] },
        { teamId: tid("t-angels"), playerIds: [pid("p-trout")] },
      ],
    };
    teamsLoaded = false;
    const { rerender } = render(wizard({ careerContext: both }));
    // Names not here yet: the step says it is checking, Next is held, no lines to sort.
    expect(screen.getAllByRole("status").some((el) => el.textContent === CAREER_CHECKING)).toBe(true);
    expect(next().getAttribute("aria-disabled")).toBe("true");
    expect(screen.queryByRole("radiogroup")).toBeNull();
    // They arrive: Padres resolves to a name that sorts AFTER Angels.
    teamsLoaded = true;
    teamRows = [
      { _id: "t-padres", name: "Zephyrs", location: "San Diego" },
      { _id: "t-angels", name: "Angels", location: "Los Angeles" },
    ];
    rerender(wizard({ careerContext: both }));
    const headings = () => screen.getAllByRole("heading", { level: 4 }).map((h) => h.textContent);
    expect(headings()).toEqual(["Mike Trout", "Fernando Tatis Jr."]);
    expect(screen.getByRole("radiogroup", { name: "Fernando Tatis Jr. on San Diego Zephyrs" })).toBeTruthy();
    expect(next().getAttribute("aria-disabled")).not.toBe("true");
    // Focus is on the first line; a later change to the read (a name arriving
    // again, the teams read re-subscribing) moves neither the order nor focus.
    const first = within(screen.getAllByRole("radiogroup")[0]).getByRole("radio", { name: "Keep as is" });
    expect(document.activeElement).toBe(first);
    teamsLoaded = false;
    rerender(wizard({ careerContext: both }));
    expect(headings()).toEqual(["Mike Trout", "Fernando Tatis Jr."]);
    expect(screen.getAllByRole("radiogroup")).toHaveLength(2);
    expect(document.activeElement).toBe(first);
  });

  describe("the way out of 'Checking careers…' (names latch escape)", () => {
    const BOTH: CareerContext = {
      ...CONTEXT,
      gaps: [
        { teamId: tid("t-padres"), playerIds: [pid("p-tatis")] },
        { teamId: tid("t-angels"), playerIds: [pid("p-trout")] },
      ],
    };

    it("a names read that never answers is given up on after 15 s: lines with the printed names, Next released", () => {
      vi.useFakeTimers();
      try {
        teamsLoaded = false;
        render(wizard({ careerContext: BOTH }));
        expect(next().getAttribute("aria-disabled")).toBe("true");
        expect(screen.queryByRole("radiogroup")).toBeNull();
        act(() => {
          vi.advanceTimersByTime(CAREER_NAMES_WAIT_MS - 1);
        });
        expect(screen.queryByRole("radiogroup")).toBeNull();
        act(() => {
          vi.advanceTimersByTime(2);
        });
        expect(CAREER_NAMES_WAIT_MS).toBe(15_000);
        expect(screen.getAllByRole("radiogroup")).toHaveLength(2);
        expect(screen.getByRole("radiogroup", { name: "Fernando Tatis Jr. on Padres" })).toBeTruthy();
        expect(next().getAttribute("aria-disabled")).not.toBe("true");
      } finally {
        vi.useRealTimers();
      }
    });

    it("a failed coverage read releases the lines at once, with the failure line and Retry", () => {
      currentRows = linkedRows();
      teamsLoaded = false;
      fetcherBehaviour = (asks, cb) => cb.onFailed(asks.map((a) => `${a.playerId}|${a.teamId}`));
      render(readWizard());
      expect(screen.getByRole("button", { name: CAREER_RETRY_LABEL })).toBeTruthy();
      expect(screen.getAllByRole("status").some((el) => el.textContent === CAREER_READ_FAILED)).toBe(true);
      expect(next().getAttribute("aria-disabled")).not.toBe("true");
    });

    it("a names answer with fewer rows than ids (a deleted team) counts as loaded and falls back to the printed name", () => {
      // Only Angels has a row; Padres was deleted under the pair.
      teamRows = [{ _id: "t-angels", name: "Angels", location: "Los Angeles" }];
      render(wizard({ careerContext: BOTH }));
      expect(screen.getByRole("radiogroup", { name: "Fernando Tatis Jr. on Padres" })).toBeTruthy();
      expect(screen.getByRole("radiogroup", { name: "Mike Trout on Los Angeles Angels" })).toBeTruthy();
      expect(next().getAttribute("aria-disabled")).not.toBe("true");
    });
  });

  describe("a different batch or set while the wizard stays mounted", () => {
    it("drops the career answers and reads, and the names latch, and asks again", () => {
      const onCareerChange = vi.fn();
      const { rerender } = render(wizard({ onCareerChange, batchId: "" }));
      const group = screen.getAllByRole("radiogroup")[0];
      fireEvent.click(within(group).getByRole("radio", { name: "Add to career" }));
      expect(onCareerChange.mock.calls.at(-1)?.[0]?.stints).toHaveLength(1);
      // The same component instance, handed another set.
      rerender(
        wizard({
          onCareerChange,
          selectorOptionId: "selopt-2" as unknown as Id<"selectorOptions">,
        }),
      );
      expect(onCareerChange.mock.calls.at(-1)?.[0]).toBeUndefined();
      const again = within(screen.getAllByRole("radiogroup")[0]);
      expect(again.getByRole("radio", { name: "Keep as is" }).getAttribute("aria-checked")).toBe("true");
      expect(screen.queryByLabelText(/^From year for /)).toBeNull();
    });

    it("asks the coverage reads again for the new batch (a fresh fetcher)", () => {
      currentRows = linkedRows();
      fetcherBehaviour = () => {};
      const { rerender } = render(readWizard());
      expect(fetcherMounts).toBe(1);
      rerender(
        wizard(
          {
            teamsOnly: false,
            batchId: "batch-2",
            careerContext: { setYear: 2022, players: [], teams: [], gaps: [] },
          },
          [CARDS[1]],
        ),
      );
      expect(fetcherMounts).toBe(2);
    });

    it("drops the answers when the wizard closes and opens again", () => {
      const onCareerChange = vi.fn();
      const { rerender } = render(wizard({ onCareerChange }));
      fireEvent.click(
        within(screen.getAllByRole("radiogroup")[0]).getByRole("radio", { name: "Add to career" }),
      );
      rerender(wizard({ onCareerChange, isOpen: false }));
      rerender(wizard({ onCareerChange, isOpen: true }));
      expect(onCareerChange.mock.calls.at(-1)?.[0]).toBeUndefined();
    });
  });

  it("after a Retry that finds nothing missing, focus lands on the next screen's control, not the page", () => {
    currentRows = linkedRows();
    fetcherBehaviour = (asks, cb) => cb.onFailed(asks.map((a) => `${a.playerId}|${a.teamId}`));
    render(readWizard());
    fetcherBehaviour = (asks, cb) =>
      cb.onAnswered(Object.fromEntries(asks.map((a) => [`${a.playerId}|${a.teamId}`, true])));
    fireEvent.click(screen.getByRole("button", { name: CAREER_RETRY_LABEL }));
    expect(screen.queryByRole("button", { name: CAREER_RETRY_LABEL })).toBeNull();
    // Every pair read as covered, so the step is gone: focus follows the walk
    // to the next screen's own control rather than falling to the page.
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /^Confirm & Save/ }));
  });

  it("Retry asks again, and a good answer clears the line", () => {
    currentRows = linkedRows();
    fetcherBehaviour = (asks, cb) => cb.onFailed(asks.map((a) => `${a.playerId}|${a.teamId}`));
    render(readWizard());
    expect(fetcherMounts).toBe(1);
    fetcherBehaviour = (asks, cb) =>
      cb.onAnswered(Object.fromEntries(asks.map((a) => [`${a.playerId}|${a.teamId}`, false])));
    fireEvent.click(screen.getByRole("button", { name: CAREER_RETRY_LABEL }));
    expect(fetcherMounts).toBe(2);
    expect(screen.queryByRole("button", { name: CAREER_RETRY_LABEL })).toBeNull();
    expect(screen.getByRole("radiogroup")).toBeTruthy();
    expect(screen.queryByText(CAREER_READ_FAILED)).toBeNull();
    expect(screen.getByRole("heading", { name: careerHeading(1) })).toBeTruthy();
  });

  it("is not a gap: a read that answers 'covered' passes the step without a line", () => {
    currentRows = linkedRows();
    fetcherBehaviour = (asks, cb) =>
      cb.onAnswered(Object.fromEntries(asks.map((a) => [`${a.playerId}|${a.teamId}`, true])));
    render(readWizard());
    expect(screen.queryByRole("heading", { name: careerHeading(1) })).toBeNull();
  });
});

describe("a New Team nobody names any more (NEO-574)", () => {
  /** The operator linked Mike Trout and decided to create a team called Angels. */
  function createRows() {
    const [player, team] = linkedRows();
    return [
      player,
      {
        ...team,
        decision: { action: "create", create: { location: "Los Angeles", name: "Angels" } },
      },
    ];
  }
  const summaryCount = () => {
    const label = screen.getByText("New players and teams");
    return label.parentElement?.textContent ?? "";
  };

  function toSummary() {
    currentRows = createRows();
    fetcherBehaviour = (asks, cb) =>
      cb.onAnswered(
        Object.fromEntries(asks.map((a) => [`${a.playerId}|${a.teamId ?? `~${a.teamName}`.toLowerCase()}`, false])),
      );
    render(readWizard());
  }

  it("counts the team it would create while the card still prints it", () => {
    toSummary();
    // On the career step: Leave it, Next. Then the save step's summary.
    fireEvent.click(next());
    expect(summaryCount()).toBe("New players and teams1");
  });

  it("does not count it once 'Fix card’s team' took its only reference off the card", () => {
    toSummary();
    const group = screen.getAllByRole("radiogroup")[0];
    fireEvent.click(within(group).getByRole("radio", { name: "Fix card’s team" }));
    fireEvent.click(screen.getByRole("button", { name: "Pick a team for Mike Trout" }));
    fireEvent.click(screen.getByRole("button", { name: "Search result team" }));
    fireEvent.click(next());
    // A zero row is not listed at all.
    expect(screen.queryByText("New players and teams")).toBeNull();
    expect(screen.getByText("Linked to existing")).toBeTruthy();
  });

  it("still says 'Added as new' while the card prints the team", () => {
    toSummary();
    fireEvent.click(next());
    const decided = within(screen.getByRole("list", { name: "Decided names" }));
    expect(decided.getByText("Added as new")).toBeTruthy();
    expect(decided.queryByText(CAREER_TEAM_NOT_NEEDED)).toBeNull();
  });

  it("says 'not needed' for it in the Decided list once 'Fix card’s team' dropped it", () => {
    toSummary();
    const group = screen.getAllByRole("radiogroup")[0];
    fireEvent.click(within(group).getByRole("radio", { name: "Fix card’s team" }));
    fireEvent.click(screen.getByRole("button", { name: "Pick a team for Mike Trout" }));
    fireEvent.click(screen.getByRole("button", { name: "Search result team" }));
    fireEvent.click(next());
    const decided = within(screen.getByRole("list", { name: "Decided names" }));
    expect(decided.queryByText("Added as new")).toBeNull();
    expect(decided.getByText(CAREER_TEAM_NOT_NEEDED)).toBeTruthy();
    // The linked player's line is still there.
    expect(decided.getByText("Mike Trout")).toBeTruthy();
  });
});

describe("a relinked player reaches the titles step (NEO-574)", () => {
  it("asks for the picked player's own name, so the title can use it", () => {
    render(wizard());
    const group = screen.getAllByRole("radiogroup")[0];
    fireEvent.click(within(group).getByRole("radio", { name: "Wrong player" }));
    fireEvent.click(screen.getByRole("button", { name: "Someone else for Fernando Tatis Jr." }));
    fireEvent.click(screen.getByRole("button", { name: "Search result player" }));
    expect(playerIdReads.at(-1)).toContain("picked-player");
  });
});
