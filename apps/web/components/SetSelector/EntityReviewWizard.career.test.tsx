/**
 * NEO-574 — the wizard's "Career check" step: where it sits in the walk,
 * how it is counted, what it reports up, and how a re-teamed card leaves the
 * teams step. The step's own behaviour is CareerCheckStep.test.tsx and the
 * rules are career-check.test.tsx. The harness is
 * EntityReviewWizard.autograph.test.tsx's.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";

vi.mock("../../convex/_generated/api", () => {
  const moduleProxy = (mod: string) =>
    new Proxy({}, { get: (_t, fn) => `${mod}.${String(fn)}` });
  return { api: new Proxy({}, { get: (_t, mod) => moduleProxy(String(mod)) }) };
});

let currentRows: unknown[];

vi.mock("convex/react", () => ({
  useQuery: (ref: string, args: unknown) => {
    if (args === "skip") return undefined;
    if (ref === "entityReviewQueue.getBatch") return currentRows;
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
vi.mock("./career-reads", () => ({
  CareerCoverageFetcher: () => null,
  useRelinkCandidates: () => ({ state: "ready", candidates: [] }),
}));

import EntityReviewWizard from "./EntityReviewWizard";
import { CAREER_STEP_HEADING, type CareerContext } from "./career-check";
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

const counter = () =>
  screen
    .getAllByRole("status")
    .map((el) => el.textContent ?? "")
    .find((t) => /^Step \d+ of \d+$/.test(t)) ?? "";
const next = () => screen.getByRole("button", { name: NEXT_NAME });

beforeEach(() => {
  currentRows = [];
});

describe("when the step is asked", () => {
  it("opens on it, first of the steps, when a new card's team is missing from its player's career", () => {
    render(wizard());
    expect(screen.getByRole("heading", { name: CAREER_STEP_HEADING })).toBeTruthy();
    expect(screen.getAllByText(STEP_SUBTITLE.career).length).toBeGreaterThan(0);
    expect(counter()).toBe("Step 1 of 2");
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
  it("every line starts on 'Leave it', so nothing is reported and Next just passes", () => {
    const onCareerChange = vi.fn();
    render(wizard({ onCareerChange }));
    expect(onCareerChange).toHaveBeenLastCalledWith(undefined);
    fireEvent.click(next());
    expect(screen.queryByRole("heading", { name: CAREER_STEP_HEADING })).toBeNull();
  });

  it("adding a stint reports it up, with the team by id", () => {
    const onCareerChange = vi.fn();
    render(wizard({ onCareerChange }));
    const group = screen.getAllByRole("radiogroup")[0];
    fireEvent.click(within(group).getByRole("radio", { name: "Add the stint" }));
    const fields = onCareerChange.mock.calls.at(-1)?.[0];
    expect(fields?.stints).toEqual([{ playerId: "p-tatis", teamId: "t-padres", fromYear: 2022 }]);
  });

  it("holds Next while an add form's years are not a stint, and says so", () => {
    render(wizard());
    const group = screen.getAllByRole("radiogroup")[0];
    fireEvent.click(within(group).getByRole("radio", { name: "Add the stint" }));
    const from = screen.getByLabelText(/^From year for /);
    fireEvent.change(from, { target: { value: "" } });
    fireEvent.click(next());
    expect(screen.getByRole("heading", { name: CAREER_STEP_HEADING })).toBeTruthy();
    expect(next().getAttribute("aria-disabled")).toBe("true");
  });
});

describe("a re-teamed card leaves the teams step", () => {
  const ANGELS_GAP: CareerContext = {
    ...CONTEXT,
    gaps: [{ teamId: tid("t-angels"), playerIds: [pid("p-trout")] }],
  };

  function reteam() {
    const group = screen.getAllByRole("radiogroup")[0];
    fireEvent.click(within(group).getByRole("radio", { name: "Different team" }));
    fireEvent.click(screen.getByRole("button", { name: "Pick a team for Mike Trout" }));
    fireEvent.click(screen.getByRole("button", { name: "Search result team" }));
  }

  it("reports the printed team dropped and the picked team on", () => {
    const onCareerChange = vi.fn();
    render(wizard({ careerContext: ANGELS_GAP, onCareerChange }, [CARDS[1]]));
    reteam();
    const fields = onCareerChange.mock.calls.at(-1)?.[0];
    expect(fields?.cardEdits[0]).toEqual({ dropTeams: ["Angels"], teamIds: ["picked-team"] });
  });

  it("does not ask the teams step about it afterwards, but still asks about a card with no team", () => {
    const cards: Card[] = [CARDS[1], { cardNumber: "77", cardName: "Base", players: ["Pete Rose"] }];
    render(wizard({ careerContext: ANGELS_GAP }, cards));
    reteam();
    fireEvent.click(next());
    expect(screen.queryByRole("heading", { name: CAREER_STEP_HEADING })).toBeNull();
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
