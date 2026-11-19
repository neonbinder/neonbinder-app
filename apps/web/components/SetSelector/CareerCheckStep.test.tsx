/**
 * NEO-574 — the "Career check" step's own behaviour: one line per
 * (player, team), "Keep as is" picked by default, the four answers, the
 * re-check after a different player or team, and the keyboard model.
 * The wiring into the wizard is EntityReviewWizard.career.test.tsx.
 *
 * NEO-591: "Add to career" is the New Player step's stints widget
 * (`CareerTeamEntry`, mocked here to its props: its own behaviour is
 * CareerTeamEntry.test.tsx), and "Wrong player" / "Fix card’s team" open their
 * search at once.
 */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import React, { useEffect, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";

let candidates: Array<Record<string, unknown>>;
let candidateState: "idle" | "loading" | "ready" | "failed";
let relinkArgs: unknown[];
let relinkSetIds: unknown[];

vi.mock("./career-reads", () => ({
  useRelinkCandidates: (setId: unknown, args: unknown) => {
    relinkSetIds.push(setId);
    relinkArgs.push(args);
    // `reorderOnPick`: once a namesake is picked the read comes back reversed,
    // so the rows change places in the same render the pick lands.
    return {
      state: candidateState,
      candidates: reorderOnPick && pickedAny ? [...candidates].reverse() : candidates,
    };
  },
}));

/** How many times a search has mounted: arrowing across the pills must never add one. */
let searchMounts: number;
vi.mock("./EntityLinkSearch", async () => {
  const react = await import("react");
  return {
    default: ({
      kind,
      onSelect,
      onCancel,
    }: {
      kind: string;
      onSelect: (id: string, name: string) => void;
      onCancel: () => void;
    }) => {
      const ref = react.useRef<HTMLInputElement>(null);
      // The real search focuses its box as it mounts.
      react.useEffect(() => {
        searchMounts += 1;
        ref.current?.focus();
      }, []);
      return react.createElement(
        "div",
        null,
        react.createElement("input", { ref, "aria-label": `Search ${kind}s` }),
        react.createElement(
          "button",
          { type: "button", onClick: () => onSelect(`picked-${kind}`, `Picked ${kind}`) },
          `Search result ${kind}`,
        ),
        react.createElement("button", { type: "button", onClick: onCancel }, "Cancel search"),
      );
    },
  };
});

type EntryProps = {
  sportId: unknown;
  contextOptionId?: unknown;
  stagedNames: string[];
  label?: string;
  knownTeamsOnly?: boolean;
  disabled?: boolean;
  initialTeam?: string;
  initialFromYear?: number;
  onAdd: (entry: { name: string; fromYear: number; toYear?: number; teamId?: string }) => void;
  onDone?: () => void;
};
/** The latest props each stints form was given, by its player. */
let entryProps: Record<string, EntryProps>;
/** What the mocked form adds when its Add is pressed. */
let nextEntry: { name: string; fromYear: number; toYear?: number; teamId?: string };
vi.mock("./CareerTeamEntry", async () => {
  const react = await import("react");
  return {
    default: (props: EntryProps) => {
      entryProps[props.label ?? ""] = props;
      return react.createElement(
        "div",
        { role: "group", "aria-label": `Stints form for ${props.label}` },
        react.createElement("input", { "aria-label": `Career team name for ${props.label}` }),
        react.createElement(
          "button",
          { type: "button", onClick: () => props.onAdd(nextEntry) },
          `Add stint for ${props.label}`,
        ),
        react.createElement(
          "button",
          { type: "button", onClick: () => props.onDone?.() },
          `Done with ${props.label}`,
        ),
      );
    },
  };
});

import CareerCheckStep, { careerLineLabel } from "./CareerCheckStep";
import {
  CAREER_RETRY_LABEL,
  NO_CAREER_TEXT,
  careerHeading,
  deriveSittingPairs,
  noStintText,
  stintChipText,
  toLines,
  type BatchTeam,
  type CareerAnswers,
  type CareerContext,
  type CoverageAsk,
  type ExistingStint,
} from "./career-check";

const pid = (s: string) => s as unknown as Id<"players">;
const tid = (s: string) => s as unknown as Id<"teams">;
const SET = "set-1" as unknown as Id<"selectorOptions">;
const SPORT = "sport-1" as unknown as Id<"selectorOptions">;

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
  gaps: [],
};
const CARDS = [
  { cardNumber: "12", cardName: "a", players: ["Fernando Tatis Jr."], teams: ["Padres"] },
  { cardNumber: "45", cardName: "b", players: ["Fernando Tatis Jr."], teams: ["Padres"] },
  { cardNumber: "27", cardName: "c", players: ["Mike Trout"], teams: ["Angels"] },
];
const LINES = toLines(deriveSittingPairs({ cards: CARDS, rows: [], context: CONTEXT }));
const NAMES: Record<string, string> = {
  "p-tatis": "Fernando Tatis Jr.",
  "p-trout": "Mike Trout",
};
const TEAMS: Record<string, string> = {
  "t-padres": "San Diego Padres",
  "t-angels": "Los Angeles Angels",
};
const SHORT: Record<string, string> = {
  "t-padres": "Padres",
  "t-angels": "Angels",
  // A team picked from the search: the typeahead says "Picked team", the row's nickname is short.
  "picked-team": "Picks",
};
/** Sorted by team, then card number: Angels (Trout) come before Padres (Tatis). */
const keyOf = (playerId: string) => LINES.find((l) => l.playerId === playerId)!.key;
let noCareer: Set<string>;
/** Team names the harness knows; absent = not resolved yet. */
let reorderOnPick = false;
let pickedAny = false;
let answerCalls = 0;

let existing: Record<string, ExistingStint[]>;
let batch: BatchTeam[];

let coverage: Record<string, boolean>;
let asked: CoverageAsk[];
let answersSeen: CareerAnswers;
let allDone: () => void;

let failed: Record<string, boolean>;
let onRetry: () => void;

function Harness(props: {
  /** No team has a short name yet. */
  shortUnknown?: boolean;
  linesOverride?: typeof LINES;
  shortOverride?: Record<string, string>;
  readFailed?: boolean;
  empty?: boolean;
  /** The full team name a line shows, for lines that name a team by its printed text. */
  teamNameOverride?: string;
  disabled?: boolean;
}) {
  const [answers, setAnswers] = useState<CareerAnswers>({});
  useEffect(() => {
    answersSeen = answers;
  }, [answers]);
  return (
    <CareerCheckStep
      lines={props.empty ? [] : (props.linesOverride ?? LINES)}
      setYear={2022}
      selectorOptionId={SET}
      sportId={SPORT}
      answers={answers}
      onAnswer={(key, answer) => {
        answerCalls += 1;
        if (answer.kind === "player" && answer.pick) pickedAny = true;
        setAnswers((prev) => ({ ...prev, [key]: answer }));
      }}
      coverage={coverage}
      failed={failed}
      onRetry={onRetry}
      requestCoverage={(asks) => asked.push(...asks)}
      playerNameOf={(l) => NAMES[l.playerId]}
      teamNameOf={(l) =>
        props.teamNameOverride ?? (props.shortUnknown ? "this team" : TEAMS[l.teamId ?? ""])
      }
      shortTeamNameOf={(l) =>
        props.shortUnknown
          ? undefined
          : (props.shortOverride?.[l.teamId ?? ""] ?? SHORT[l.teamId ?? ""])
      }
      shortTeamNameOfId={(id) => SHORT[id]}
      hasNoCareer={(l) => noCareer.has(l.playerId)}
      existingStintsOf={(id) => existing[id] ?? []}
      batchTeams={batch}
      onAllDone={allDone}
      headingId="career-lead"
      {...props}
    />
  );
}

const group = (player: string, team: string) =>
  screen.getByRole("radiogroup", { name: careerLineLabel(player, team) });
const tatis = () => group("Fernando Tatis Jr.", "San Diego Padres");
const trout = () => group("Mike Trout", "Los Angeles Angels");
const radio = (g: HTMLElement, name: string) => within(g).getByRole("radio", { name });
// The standard secondary NeonButton paints through --nb-* custom properties:
// outline = a clear ground, filled = the cyan fill.
const isOutline = (el: HTMLElement) => el.style.getPropertyValue("--nb-fill") === "transparent";
const isFilledBlue = (el: HTMLElement) => el.style.getPropertyValue("--nb-fill") === "var(--neon-blue)";

beforeEach(() => {
  candidates = [];
  existing = {};
  batch = [];
  entryProps = {};
  nextEntry = { name: "Cincinnati Reds", fromYear: 2019, toYear: 2021, teamId: "t-reds" };
  searchMounts = 0;
  noCareer = new Set();
  reorderOnPick = false;
  pickedAny = false;
  answerCalls = 0;
  candidateState = "ready";
  relinkArgs = [];
  relinkSetIds = [];
  coverage = {};
  asked = [];
  allDone = vi.fn() as unknown as () => void;
  failed = {};
  onRetry = vi.fn() as unknown as () => void;
});

describe("the lines", () => {
  it("names the step with its count, and lists one line per player and team", () => {
    render(<Harness />);
    expect(screen.getByRole("heading", { name: careerHeading(2) })).toBeTruthy();
    expect(careerHeading(2)).toBe("Career check · 2 to look at");
    expect(screen.getByText("Fernando Tatis Jr.")).toBeTruthy();
    // The short team name, as the rows show it.
    expect(screen.getByText(noStintText("Padres", 2022))).toBeTruthy();
    expect(noStintText("Padres", 2022)).toBe("No Padres in the career by 2022.");
    // The cards behind the pair, once.
    expect(screen.getByText(/Cards #12 · #45/)).toBeTruthy();
    expect(screen.getByText(/Cards #27/)).toBeTruthy();
  });

  it("keeps the order once lines are shown, whatever name arrives later", () => {
    const { rerender } = render(<Harness shortUnknown />);
    const headings = () => screen.getAllByRole("heading", { level: 4 }).map((h) => h.textContent);
    // No team names: sorted by the printed text (Angels, Padres).
    expect(headings()).toEqual(["Mike Trout", "Fernando Tatis Jr."]);
    const first = screen.getAllByRole("radio", { name: "Keep as is" })[0];
    act(() => first.focus());
    // Padres now resolves to a name that would sort first.
    rerender(<Harness shortOverride={{ "t-padres": "Aardvarks" }} />);
    expect(headings()).toEqual(["Mike Trout", "Fernando Tatis Jr."]);
    expect(document.activeElement).toBe(first);
    expect(screen.getAllByRole("radio", { name: "Keep as is" })[0]).toBe(first);
  });

  it("tells two lines of one player apart by the first card when no team has a name", () => {
    const cards = [
      { cardNumber: "12", cardName: "a", players: ["Fernando Tatis Jr."], teams: ["Padres"] },
      { cardNumber: "45", cardName: "b", players: ["Fernando Tatis Jr."], teams: ["Angels"] },
    ];
    const two = toLines(deriveSittingPairs({ cards, rows: [], context: CONTEXT }));
    render(<Harness shortUnknown linesOverride={two} />);
    const names = screen.getAllByRole("radiogroup").map((g) => g.getAttribute("aria-label"));
    expect(new Set(names).size).toBe(2);
    expect(names.every((n) => /^Fernando Tatis Jr\. on this team, card (12|45)$/.test(n ?? ""))).toBe(true);
  });

  it("never renders 'No the team…': a line whose team has no name yet says it plainly", () => {
    render(<Harness shortUnknown />);
    expect(screen.queryByText(/the team/)).toBeNull();
    expect(screen.getAllByText("This team isn’t in the career by 2022.")).toHaveLength(2);
  });

  it("sorts by the team as the line shows it, not by the text the card printed", () => {
    // Tatis prints "Padres" and resolves to "Zephyrs"; Trout prints "Angels" and resolves to "Angels".
    render(<Harness shortOverride={{ "t-padres": "Zephyrs" }} />);
    const names = screen.getAllByRole("heading", { level: 4 }).map((h) => h.textContent);
    expect(names).toEqual(["Mike Trout", "Fernando Tatis Jr."]);
    // And the other way round: Angels resolves late in the alphabet.
    cleanup();
    render(<Harness shortOverride={{ "t-angels": "Zephyrs" }} />);
    expect(screen.getAllByRole("heading", { level: 4 }).map((h) => h.textContent)).toEqual([
      "Fernando Tatis Jr.",
      "Mike Trout",
    ]);
  });

  it("sorts the lines by team, then by card number", () => {
    render(<Harness />);
    const names = screen.getAllByRole("heading", { level: 4 }).map((h) => h.textContent);
    expect(names).toEqual(["Mike Trout", "Fernando Tatis Jr."]);
  });

  it("says 'No career on file yet.' for a player with no stints at all", () => {
    noCareer = new Set(["p-tatis"]);
    render(<Harness />);
    expect(screen.getByText(NO_CAREER_TEXT)).toBeTruthy();
    expect(NO_CAREER_TEXT).toBe("No career on file yet.");
    expect(screen.queryByText(noStintText("Padres", 2022))).toBeNull();
    expect(screen.getByText(noStintText("Angels", 2022))).toBeTruthy();
  });

  it("describes each line's group by its note and its cards (A6), keeping the name", () => {
    render(<Harness />);
    const g = tatis();
    const text = (g.getAttribute("aria-describedby") ?? "")
      .split(" ")
      .map((id) => document.getElementById(id)?.textContent)
      .join(" | ");
    expect(text).toContain("No Padres in the career by 2022.");
    expect(text).toContain("Cards #12 · #45");
    expect(g.getAttribute("aria-label")).toBe("Fernando Tatis Jr. on San Diego Padres");
  });

  it("opens every line on 'Keep as is', as the one tab stop", () => {
    render(<Harness />);
    for (const g of [tatis(), trout()]) {
      const leave = radio(g, "Keep as is");
      expect(leave.getAttribute("aria-checked")).toBe("true");
      expect(leave.tabIndex).toBe(0);
      expect(radio(g, "Add to career").tabIndex).toBe(-1);
    }
    expect(answersSeen).toEqual({});
  });

  // Jason (NEO-574): the choices are the standard secondary NeonButton, not a
  // pale hand-rolled chip. Unselected = outline, selected = filled.

  it("draws the answers as standard secondary buttons: outline until picked, then filled", () => {
    render(<Harness />);
    const g = tatis();
    for (const r of within(g).getAllByRole("radio")) {
      expect(r.className).toContain("neon-button");
      expect(r.getAttribute("type")).toBe("button");
    }
    expect(isFilledBlue(radio(g, "Keep as is"))).toBe(true);
    for (const name of ["Add to career", "Wrong player", "Fix card’s team"]) {
      expect(isOutline(radio(g, name))).toBe(true);
      expect(radio(g, name).style.getPropertyValue("--nb-ink")).toBe("var(--neon-blue-text)");
    }
    fireEvent.click(radio(g, "Add to career"));
    expect(isFilledBlue(radio(g, "Add to career"))).toBe(true);
    expect(isOutline(radio(g, "Keep as is"))).toBe(true);
  });

  it("keeps the radio semantics on the buttons: checked, one tab stop, arrows, Enter", () => {
    render(<Harness />);
    const g = tatis();
    const radios = within(g).getAllByRole("radio");
    expect(radios.map((r) => r.getAttribute("aria-checked"))).toEqual(["true", "false", "false", "false"]);
    expect(radios.map((r) => r.tabIndex)).toEqual([0, -1, -1, -1]);
    const leave = radio(g, "Keep as is");
    act(() => leave.focus());
    fireEvent.keyDown(leave, { key: "ArrowRight" });
    const add = radio(g, "Add to career");
    expect(document.activeElement).toBe(add);
    expect(add.getAttribute("aria-checked")).toBe("true");
    expect(add.tabIndex).toBe(0);
    expect(leave.tabIndex).toBe(-1);
    expect(isFilledBlue(add)).toBe(true);
    // Enter is handled by the radio, not left to the button's click.
    const notPrevented = fireEvent.keyDown(add, { key: "Enter" });
    expect(notPrevented).toBe(false);
  });

  it("names the four answers in the collector's words", () => {
    render(<Harness />);
    expect(
      within(tatis()).getAllByRole("radio").map((r) => r.textContent?.replace("✓", "").trim()),
    ).toEqual(["Keep as is", "Add to career", "Wrong player", "Fix card’s team"]);
  });

  it("has no lead sentence under the heading", () => {
    render(<Harness />);
    expect(screen.queryByText(/don’t show the team on the card/)).toBeNull();
  });
});

describe("Add to career", () => {
  const PADRES_CHIP = "San Diego Padres (2022–present)";
  const stintsList = (player: string) => screen.getByRole("list", { name: `Stints to add for ${player}` });
  const form = (player: string) => screen.getByRole("group", { name: `Stints form for ${player}` });

  it("stages the card's team from the set's year, so the team is named before anything is typed", () => {
    render(<Harness />);
    fireEvent.click(radio(tatis(), "Add to career"));
    expect(within(stintsList("Fernando Tatis Jr.")).getByText(PADRES_CHIP)).toBeTruthy();
    expect(answersSeen[keyOf("p-tatis")]).toEqual({
      kind: "add",
      stints: [{ teamId: "t-padres", label: "San Diego Padres", fromYear: 2022 }],
    });
  });

  it("names a team the batch is creating by its printed text", () => {
    const created = deriveSittingPairs({
      cards: CARDS,
      rows: [{ kind: "team", name: "Padres", decision: { action: "create" } }],
      context: CONTEXT,
    });
    const lines = toLines(created).filter((l) => l.playerId === "p-tatis");
    render(<Harness linesOverride={lines} teamNameOverride="San Diego Padres" shortOverride={{}} />);
    fireEvent.click(
      screen.getByRole("radio", { name: "Add to career" }),
    );
    expect(answersSeen[lines[0].key]).toEqual({
      kind: "add",
      stints: [{ teamName: "Padres", label: "San Diego Padres", fromYear: 2022 }],
    });
  });

  it("uses the New Player step's form, told whose stint it is and that the team must exist", () => {
    batch = [{ label: "Memphis RiverKings", teamName: "RiverKings" }];
    render(<Harness />);
    fireEvent.click(radio(tatis(), "Add to career"));
    const props = entryProps["Fernando Tatis Jr."];
    expect(props).toMatchObject({
      sportId: SPORT,
      contextOptionId: SET,
      label: "Fernando Tatis Jr.",
      knownTeamsOnly: true,
      stagedNames: ["Memphis RiverKings"],
    });
    expect(form("Fernando Tatis Jr.")).toBeTruthy();
  });

  it("lists the stints already on file, read-only, and nothing for a player with none", () => {
    existing = {
      "p-tatis": [
        { key: "a", label: "San Diego Padres", fromYear: 2019, toYear: 2021 },
        { key: "b", label: "Cincinnati Reds", fromYear: 2022 },
      ],
    };
    render(<Harness />);
    fireEvent.click(radio(tatis(), "Add to career"));
    fireEvent.click(radio(trout(), "Add to career"));
    const onFile = screen.getByRole("list", { name: "Career on file for Fernando Tatis Jr." });
    expect(within(onFile).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "San Diego Padres (2019–2021)",
      "Cincinnati Reds (2022–present)",
    ]);
    expect(within(onFile).queryByRole("button")).toBeNull();
    expect(screen.queryByRole("list", { name: "Career on file for Mike Trout" })).toBeNull();
  });

  it("opens the form on the card's team and year only once that stint is removed", () => {
    render(<Harness />);
    fireEvent.click(radio(tatis(), "Add to career"));
    const props = () => entryProps["Fernando Tatis Jr."];
    // Staged already: nothing to prefill.
    expect(props().initialTeam).toBeUndefined();
    expect(props().initialFromYear).toBeUndefined();
    fireEvent.click(
      screen.getByRole("button", { name: `Remove ${PADRES_CHIP} for Fernando Tatis Jr.` }),
    );
    expect(answersSeen[keyOf("p-tatis")]).toEqual({ kind: "add", stints: [] });
    expect(props().initialTeam).toBe("San Diego Padres");
    expect(props().initialFromYear).toBe(2022);
    expect(screen.queryByRole("list", { name: "Stints to add for Fernando Tatis Jr." })).toBeNull();
  });

  it("adds a stint for any saved team by its id, and any number of them", () => {
    render(<Harness />);
    fireEvent.click(radio(tatis(), "Add to career"));
    nextEntry = { name: "Cincinnati Reds", fromYear: 2019, toYear: 2021, teamId: "t-reds" };
    fireEvent.click(screen.getByRole("button", { name: "Add stint for Fernando Tatis Jr." }));
    nextEntry = { name: "St. Louis Cardinals", fromYear: 2015, teamId: "t-cards" };
    fireEvent.click(screen.getByRole("button", { name: "Add stint for Fernando Tatis Jr." }));
    expect(
      within(stintsList("Fernando Tatis Jr.")).getAllByRole("listitem").map((li) => li.textContent),
    ).toEqual([
      `${PADRES_CHIP}×`,
      "Cincinnati Reds (2019–2021)×",
      "St. Louis Cardinals (2015–present)×",
    ]);
    expect((answersSeen[keyOf("p-tatis")] as { stints: unknown[] }).stints).toEqual([
      { teamId: "t-padres", label: "San Diego Padres", fromYear: 2022 },
      { teamId: "t-reds", label: "Cincinnati Reds", fromYear: 2019, toYear: 2021 },
      { teamId: "t-cards", label: "St. Louis Cardinals", fromYear: 2015 },
    ]);
  });

  it("adds a stint for a team the batch is creating by its printed text", () => {
    batch = [{ label: "Memphis RiverKings", teamName: "RiverKings" }];
    render(<Harness />);
    fireEvent.click(radio(tatis(), "Add to career"));
    nextEntry = { name: "Memphis RiverKings", fromYear: 2012, toYear: 2014 };
    fireEvent.click(screen.getByRole("button", { name: "Add stint for Fernando Tatis Jr." }));
    expect((answersSeen[keyOf("p-tatis")] as { stints: unknown[] }).stints).toContainEqual({
      teamName: "RiverKings",
      label: "Memphis RiverKings",
      fromYear: 2012,
      toYear: 2014,
    });
  });

  it("adds nothing for a team it cannot name (no id, not in the batch)", () => {
    render(<Harness />);
    fireEvent.click(radio(tatis(), "Add to career"));
    nextEntry = { name: "Nowhere Nine", fromYear: 2012 };
    fireEvent.click(screen.getByRole("button", { name: "Add stint for Fernando Tatis Jr." }));
    expect((answersSeen[keyOf("p-tatis")] as { stints: unknown[] }).stints).toHaveLength(1);
  });

  it("does not stage the same stint twice", () => {
    render(<Harness />);
    fireEvent.click(radio(tatis(), "Add to career"));
    nextEntry = { name: "San Diego Padres", fromYear: 2022, teamId: "t-padres" };
    fireEvent.click(screen.getByRole("button", { name: "Add stint for Fernando Tatis Jr." }));
    expect((answersSeen[keyOf("p-tatis")] as { stints: unknown[] }).stints).toHaveLength(1);
  });

  it("keeps each line's stints and form apart", () => {
    render(<Harness />);
    fireEvent.click(radio(tatis(), "Add to career"));
    fireEvent.click(radio(trout(), "Add to career"));
    expect(form("Fernando Tatis Jr.")).not.toBe(form("Mike Trout"));
    expect(within(stintsList("Mike Trout")).getByText("Los Angeles Angels (2022–present)")).toBeTruthy();
    expect(within(stintsList("Fernando Tatis Jr.")).queryByText(/Angels/)).toBeNull();
    nextEntry = { name: "Cincinnati Reds", fromYear: 2019, teamId: "t-reds" };
    fireEvent.click(screen.getByRole("button", { name: "Add stint for Mike Trout" }));
    expect((answersSeen[keyOf("p-tatis")] as { stints: unknown[] }).stints).toHaveLength(1);
    expect((answersSeen[keyOf("p-trout")] as { stints: unknown[] }).stints).toHaveLength(2);
  });

  it("Enter on the radio steps into the team box, a click does not move focus", () => {
    vi.useFakeTimers();
    render(<Harness />);
    fireEvent.click(radio(tatis(), "Add to career"));
    act(() => {
      vi.runAllTimers();
    });
    expect(document.activeElement).not.toBe(screen.getByLabelText("Career team name for Fernando Tatis Jr."));
    fireEvent.keyDown(radio(tatis(), "Add to career"), { key: "Enter" });
    act(() => {
      vi.runAllTimers();
    });
    vi.useRealTimers();
    expect(document.activeElement).toBe(screen.getByLabelText("Career team name for Fernando Tatis Jr."));
  });

  it("Enter on the empty form moves on (the last line: out to Next)", () => {
    render(<Harness />);
    fireEvent.click(radio(trout(), "Add to career"));
    fireEvent.click(radio(tatis(), "Add to career"));
    fireEvent.click(screen.getByRole("button", { name: "Done with Mike Trout" }));
    expect(document.activeElement).toBe(radio(tatis(), "Add to career"));
    expect(allDone).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Done with Fernando Tatis Jr." }));
    expect(allDone).toHaveBeenCalledTimes(1);
  });

  it("returning to 'Keep as is' closes the form and drops what was staged", () => {
    render(<Harness />);
    fireEvent.click(radio(tatis(), "Add to career"));
    nextEntry = { name: "Cincinnati Reds", fromYear: 2019, teamId: "t-reds" };
    fireEvent.click(screen.getByRole("button", { name: "Add stint for Fernando Tatis Jr." }));
    fireEvent.click(radio(tatis(), "Keep as is"));
    expect(screen.queryByRole("group", { name: "Stints form for Fernando Tatis Jr." })).toBeNull();
    expect(screen.queryByRole("list", { name: "Stints to add for Fernando Tatis Jr." })).toBeNull();
    expect(answersSeen[keyOf("p-tatis")]).toEqual({ kind: "leave" });
    // Back again: the card's team alone, not the stints from before.
    fireEvent.click(radio(tatis(), "Add to career"));
    expect(
      within(stintsList("Fernando Tatis Jr.")).getAllByRole("listitem").map((li) => li.textContent),
    ).toEqual([`${PADRES_CHIP}×`]);
  });

  it("changing to another answer drops the stints too", () => {
    render(<Harness />);
    fireEvent.click(radio(tatis(), "Add to career"));
    fireEvent.click(radio(tatis(), "Fix card’s team"));
    expect(answersSeen[keyOf("p-tatis")]).toMatchObject({ kind: "team", then: { kind: "leave" } });
    expect(screen.queryByRole("list", { name: "Stints to add for Fernando Tatis Jr." })).toBeNull();
  });

  it("the chip reads as the New Player step's does", () => {
    expect(stintChipText({ label: "San Diego Padres", fromYear: 2022 })).toBe(PADRES_CHIP);
  });
});

describe("Wrong player", () => {
  const CANDIDATES = [
    { playerId: pid("p-sr"), name: "Fernando Tatis Sr.", birthYear: 1971, careerSummary: "Cardinals 1997–98", covers: true },
    { playerId: pid("p-x"), name: "Fernando Tatis", careerSummary: "", covers: false },
  ];

  it("keeps the phone target height on every choice", () => {
    candidates = CANDIDATES;
    render(<Harness />);
    fireEvent.click(radio(tatis(), "Wrong player"));
    const list = screen.getByRole("radiogroup", { name: "Which Fernando Tatis Jr.?" });
    for (const r of [...within(tatis()).getAllByRole("radio"), ...within(list).getAllByRole("radio")]) {
      expect(r.className).toContain("max-sm:min-h-11");
    }
  });

  it("draws the namesakes as the same secondary buttons, keeping their detail lines", () => {
    candidates = CANDIDATES;
    render(<Harness />);
    fireEvent.click(radio(tatis(), "Wrong player"));
    const list = screen.getByRole("radiogroup", { name: "Which Fernando Tatis Jr.?" });
    const [first, second] = within(list).getAllByRole("radio");
    expect(isOutline(first)).toBe(true);
    expect(isOutline(second)).toBe(true);
    fireEvent.click(second);
    const after = within(list).getAllByRole("radio");
    expect(after.filter(isFilledBlue)).toHaveLength(1);
    expect(after.filter(isFilledBlue)[0].getAttribute("aria-checked")).toBe("true");
    // The detail lines carry no ink of their own, so they follow the button's.
    expect(within(list).getByText("b. 1971 · Cardinals 1997–98").className).not.toMatch(/text-ink|text-neon/);
  });

  it("draws the follow-up pair as the same secondary buttons", () => {
    candidates = CANDIDATES;
    coverage = { "p-sr|t-padres": false };
    render(<Harness />);
    fireEvent.click(radio(tatis(), "Wrong player"));
    fireEvent.click(screen.getByRole("radio", { name: /Fernando Tatis Sr\./ }));
    const follow = screen.getByRole("radiogroup", { name: "Career for Fernando Tatis Sr." });
    expect(isFilledBlue(radio(follow, "Keep as is"))).toBe(true);
    expect(isOutline(radio(follow, "Add to career"))).toBe(true);
    expect(radio(follow, "Add to career").tabIndex).toBe(-1);
    fireEvent.click(radio(follow, "Add to career"));
    expect(isFilledBlue(radio(follow, "Add to career"))).toBe(true);
    expect(isOutline(radio(follow, "Keep as is"))).toBe(true);
  });

  it("lists the same-name players, asking only about existing ones, excluding the current", () => {
    candidates = CANDIDATES;
    render(<Harness />);
    fireEvent.click(radio(tatis(), "Wrong player"));
    expect(relinkArgs.at(-1)).toMatchObject({
      printedName: "Fernando Tatis Jr.",
      teamId: "t-padres",
      excludePlayerId: "p-tatis",
    });
    // A radio group named for the printed name (A5), not a pile of buttons.
    const list = screen.getByRole("radiogroup", { name: "Which Fernando Tatis Jr.?" });
    const options = within(list).getAllByRole("radio");
    expect(options.map((b) => b.textContent)).toEqual([
      expect.stringContaining("Fernando Tatis Sr."),
      expect.stringContaining("Fernando Tatis"),
    ]);
    // Career years with the team's short name; birth year ahead of it.
    expect(within(list).getByText("b. 1971 · Cardinals 1997–98")).toBeTruthy();
    // A bare namesake says so.
    expect(within(list).getByText("Nothing on file yet")).toBeTruthy();
    // The covering one says what the line is missing.
    expect(within(list).getByText("Played for the Padres")).toBeTruthy();
    expect(within(list).queryByText(/on file$/)).toBeNull();
    expect(options.every((o) => o.getAttribute("aria-pressed") === null)).toBe(true);
  });

  it("asks the server about THIS set only, and lists nothing the read does not return (item 9)", () => {
    // The server narrows the read to the set's sport (convex/careerCoverage.test.ts
    // pins "never offers another sport's player"); the step adds nothing of its own.
    candidates = [CANDIDATES[0]];
    render(<Harness />);
    fireEvent.click(radio(tatis(), "Wrong player"));
    expect(relinkSetIds.at(-1)).toBe(SET);
    const list = screen.getByRole("radiogroup", { name: "Which Fernando Tatis Jr.?" });
    expect(within(list).getAllByRole("radio")).toHaveLength(1);
  });

  it("the namesakes are one tab stop that arrows move and pick, wrapping (A5)", () => {
    candidates = CANDIDATES;
    render(<Harness />);
    fireEvent.click(radio(tatis(), "Wrong player"));
    const list = screen.getByRole("radiogroup", { name: "Which Fernando Tatis Jr.?" });
    const [first, second] = within(list).getAllByRole("radio");
    expect(first.tabIndex).toBe(0);
    expect(second.tabIndex).toBe(-1);
    act(() => first.focus());
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(answersSeen[keyOf("p-tatis")]).toMatchObject({ kind: "player", pick: { playerId: "p-x" } });
    expect(document.activeElement).toBe(second);
    expect(second.getAttribute("aria-checked")).toBe("true");
    expect(second.tabIndex).toBe(0);
    expect(first.tabIndex).toBe(-1);
    fireEvent.keyDown(second, { key: "ArrowDown" });
    expect(document.activeElement).toBe(first);
    expect(first.getAttribute("aria-checked")).toBe("true");
  });

  it("after an arrow pick, focus follows the player by id even when the rows change places", () => {
    candidates = CANDIDATES;
    reorderOnPick = true;
    render(<Harness />);
    fireEvent.click(radio(tatis(), "Wrong player"));
    const list = screen.getByRole("radiogroup", { name: "Which Fernando Tatis Jr.?" });
    const [first] = within(list).getAllByRole("radio");
    act(() => first.focus());
    fireEvent.keyDown(first, { key: "ArrowDown" });
    // The read is now reversed: the picked player (p-x) sits first.
    const after = within(screen.getByRole("radiogroup", { name: "Which Fernando Tatis Jr.?" })).getAllByRole("radio");
    expect(after[0].textContent).toContain("Fernando Tatis");
    expect(after[0].textContent).not.toContain("Sr.");
    expect(document.activeElement).toBe(after[0]);
    expect(document.activeElement?.getAttribute("aria-checked")).toBe("true");
  });

  it("an arrow landing on the already-picked row does not pick again (the stints staged under it survive)", () => {
    candidates = [CANDIDATES[0]];
    coverage = { "p-sr|t-padres": false };
    render(<Harness />);
    fireEvent.click(radio(tatis(), "Wrong player"));
    const only = screen.getByRole("radio", { name: /Fernando Tatis Sr\./ });
    fireEvent.click(only);
    const follow = screen.getByRole("radiogroup", { name: "Career for Fernando Tatis Sr." });
    fireEvent.click(radio(follow, "Add to career"));
    nextEntry = { name: "Cincinnati Reds", fromYear: 1999, teamId: "t-reds" };
    fireEvent.click(screen.getByRole("button", { name: "Add stint for Fernando Tatis Sr." }));
    const before = answerCalls;
    act(() => only.focus());
    fireEvent.keyDown(only, { key: "ArrowDown" });
    fireEvent.keyDown(only, { key: "ArrowUp" });
    expect(answerCalls).toBe(before);
    expect(
      within(screen.getByRole("list", { name: "Stints to add for Fernando Tatis Sr." })).getAllByRole("listitem"),
    ).toHaveLength(2);
    expect(document.activeElement).toBe(only);
  });

  it("'Someone else…' stays outside the namesake group", () => {
    candidates = CANDIDATES;
    render(<Harness />);
    // Arrowed onto, so the search is not open and the button is on offer.
    fireEvent.keyDown(radio(tatis(), "Keep as is"), { key: "ArrowRight" });
    fireEvent.keyDown(radio(tatis(), "Add to career"), { key: "ArrowRight" });
    const list = screen.getByRole("radiogroup", { name: "Which Fernando Tatis Jr.?" });
    const else_ = screen.getByRole("button", { name: "Someone else for Fernando Tatis Jr." });
    expect(list.contains(else_)).toBe(false);
  });

  it("a pick asks about the NEW pair and says it is checking", () => {
    candidates = CANDIDATES;
    render(<Harness />);
    fireEvent.click(radio(tatis(), "Wrong player"));
    fireEvent.click(screen.getByRole("radio", { name: /Fernando Tatis Sr\./ }));
    expect(answersSeen[keyOf("p-tatis")]).toMatchObject({
      kind: "player",
      pick: { playerId: "p-sr", name: "Fernando Tatis Sr." },
    });
    expect(asked).toEqual([{ playerId: "p-sr", teamId: "t-padres", teamName: "Padres" }]);
    expect(screen.getByText("Checking Fernando Tatis Sr.’s career…")).toBeTruthy();
  });

  it("a covered answer needs nothing more", () => {
    candidates = CANDIDATES;
    coverage = { "p-sr|t-padres": true };
    render(<Harness />);
    fireEvent.click(radio(tatis(), "Wrong player"));
    fireEvent.click(screen.getByRole("radio", { name: /Fernando Tatis Sr\./ }));
    expect(screen.getByText("Fernando Tatis Sr. played for the Padres.")).toBeTruthy();
    expect(screen.queryByRole("radiogroup", { name: "Career for Fernando Tatis Sr." })).toBeNull();
  });

  it("an uncovered answer offers the stint for the new player, or leaving it", () => {
    candidates = CANDIDATES;
    coverage = { "p-sr|t-padres": false };
    render(<Harness />);
    fireEvent.click(radio(tatis(), "Wrong player"));
    fireEvent.click(screen.getByRole("radio", { name: /Fernando Tatis Sr\./ }));
    expect(screen.getByText("No Padres in Fernando Tatis Sr.’s career by 2022 either.")).toBeTruthy();
    const follow = screen.getByRole("radiogroup", { name: "Career for Fernando Tatis Sr." });
    expect(radio(follow, "Keep as is").getAttribute("aria-checked")).toBe("true");
    fireEvent.click(radio(follow, "Add to career"));
    // The same widget, on the new player, with the card's team already staged.
    expect(
      within(screen.getByRole("list", { name: "Stints to add for Fernando Tatis Sr." })).getByText(
        "San Diego Padres (2022–present)",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("group", { name: "Stints form for Fernando Tatis Sr." })).toBeTruthy();
    expect(answersSeen[keyOf("p-tatis")]).toMatchObject({
      then: {
        kind: "add",
        stints: [{ teamId: "t-padres", label: "San Diego Padres", fromYear: 2022 }],
      },
    });
  });

  it("lists the new player's stints on file beside the widget", () => {
    candidates = CANDIDATES;
    coverage = { "p-sr|t-padres": false };
    existing = { "p-sr": [{ key: "c", label: "St. Louis Cardinals", fromYear: 1997, toYear: 1998 }] };
    render(<Harness />);
    fireEvent.click(radio(tatis(), "Wrong player"));
    fireEvent.click(screen.getByRole("radio", { name: /Fernando Tatis Sr\./ }));
    fireEvent.click(radio(screen.getByRole("radiogroup", { name: "Career for Fernando Tatis Sr." }), "Add to career"));
    expect(
      within(screen.getByRole("list", { name: "Career on file for Fernando Tatis Sr." })).getByText(
        "St. Louis Cardinals (1997–1998)",
      ),
    ).toBeTruthy();
  });

  it("the follow-up keeps ONE status region whose words swap, never a new one (A4)", () => {
    candidates = CANDIDATES;
    const { rerender } = render(<Harness />);
    fireEvent.click(radio(tatis(), "Wrong player"));
    fireEvent.click(screen.getByRole("radio", { name: /Fernando Tatis Sr\./ }));
    const status = screen.getByText("Checking Fernando Tatis Sr.’s career…");
    expect(status.getAttribute("role")).toBe("status");
    coverage = { "p-sr|t-padres": false };
    rerender(<Harness />);
    // The very same element now says the answer.
    expect(status.textContent).toBe("No Padres in Fernando Tatis Sr.’s career by 2022 either.");
    expect(status.isConnected).toBe(true);
  });

  it("inner Enter acts like the outer: 'Keep as is' moves on, 'Add to career' steps into the team box", () => {
    vi.useFakeTimers();
    candidates = CANDIDATES;
    coverage = { "p-sr|t-padres": false };
    render(<Harness />);
    fireEvent.click(radio(tatis(), "Wrong player"));
    fireEvent.click(screen.getByRole("radio", { name: /Fernando Tatis Sr\./ }));
    const follow = screen.getByRole("radiogroup", { name: "Career for Fernando Tatis Sr." });
    fireEvent.keyDown(radio(follow, "Add to career"), { key: "Enter" });
    act(() => {
      vi.runAllTimers();
    });
    vi.useRealTimers();
    expect(document.activeElement).toBe(
      screen.getByLabelText("Career team name for Fernando Tatis Sr."),
    );
    fireEvent.keyDown(radio(follow, "Keep as is"), { key: "Enter" });
    expect(allDone).toHaveBeenCalledTimes(1);
  });

  it("choosing it opens the existing-player search at once, and a result is a pick", () => {
    candidates = [];
    render(<Harness />);
    fireEvent.click(radio(tatis(), "Wrong player"));
    // No second click: the search is there, with focus in its box.
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Search players" }));
    expect(screen.queryByRole("button", { name: "Someone else for Fernando Tatis Jr." })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Search result player" }));
    expect(answersSeen[keyOf("p-tatis")]).toMatchObject({
      kind: "player",
      pick: { playerId: "picked-player", name: "Picked player" },
    });
    expect(asked).toEqual([
      { playerId: "picked-player", teamId: "t-padres", teamName: "Padres" },
    ]);
    // The pick stays visible though it is not among the candidates.
    expect(screen.getByRole("radio", { name: /Picked player/ }).getAttribute("aria-checked")).toBe("true");
  });

  it("cancelling a search the pill opened puts focus back on that pill (A1)", () => {
    vi.useFakeTimers();
    candidates = [];
    render(<Harness />);
    fireEvent.click(radio(tatis(), "Wrong player"));
    fireEvent.click(screen.getByRole("button", { name: "Cancel search" }));
    act(() => {
      vi.runAllTimers();
    });
    vi.useRealTimers();
    expect(document.activeElement).toBe(radio(tatis(), "Wrong player"));
    expect(screen.getByRole("button", { name: "Someone else for Fernando Tatis Jr." })).toBeTruthy();
  });

  it("cancelling a search 'Someone else…' opened puts focus back on that button (A1)", () => {
    vi.useFakeTimers();
    candidates = [];
    render(<Harness />);
    // Arrowed onto: no search yet, so the button is how it opens.
    fireEvent.keyDown(radio(tatis(), "Keep as is"), { key: "ArrowLeft" });
    fireEvent.keyDown(radio(tatis(), "Fix card’s team"), { key: "ArrowLeft" });
    expect(searchMounts).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Someone else for Fernando Tatis Jr." }));
    expect(searchMounts).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "Cancel search" }));
    act(() => {
      vi.runAllTimers();
    });
    vi.useRealTimers();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Someone else for Fernando Tatis Jr." }),
    );
  });

  describe("opening on a choice, not on an arrow", () => {
    it("Enter on the pill opens the search and takes focus; a held Enter does not", () => {
      candidates = [];
      render(<Harness />);
      const pill = radio(tatis(), "Keep as is");
      fireEvent.keyDown(pill, { key: "ArrowLeft" });
      fireEvent.keyDown(radio(tatis(), "Fix card’s team"), { key: "ArrowLeft" });
      expect(radio(tatis(), "Wrong player").getAttribute("aria-checked")).toBe("true");
      expect(searchMounts).toBe(0);
      fireEvent.keyDown(radio(tatis(), "Wrong player"), { key: "Enter", repeat: true });
      expect(searchMounts).toBe(0);
      fireEvent.keyDown(radio(tatis(), "Wrong player"), { key: "Enter" });
      expect(searchMounts).toBe(1);
      expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Search players" }));
    });

    it("a click on the pill that is already picked opens the search (Space is a click)", () => {
      candidates = [];
      render(<Harness />);
      fireEvent.keyDown(radio(tatis(), "Keep as is"), { key: "ArrowLeft" });
      fireEvent.keyDown(radio(tatis(), "Fix card’s team"), { key: "ArrowLeft" });
      expect(searchMounts).toBe(0);
      fireEvent.click(radio(tatis(), "Wrong player"));
      expect(searchMounts).toBe(1);
      // Pressing it again with the search open only brings focus back to it.
      act(() => radio(tatis(), "Wrong player").focus());
      fireEvent.click(radio(tatis(), "Wrong player"));
      expect(searchMounts).toBe(1);
      expect(screen.getAllByRole("textbox", { name: "Search players" })).toHaveLength(1);
    });

    it("arrowing across Wrong player and Fix card’s team opens nothing and keeps focus on the pills", () => {
      candidates = CANDIDATES;
      render(<Harness />);
      const order = ["Add to career", "Wrong player", "Fix card’s team", "Keep as is", "Add to career", "Wrong player"];
      let at = radio(tatis(), "Keep as is");
      act(() => at.focus());
      for (const name of order) {
        fireEvent.keyDown(at, { key: "ArrowRight" });
        at = radio(tatis(), name);
        expect(document.activeElement).toBe(at);
        expect(at.getAttribute("aria-checked")).toBe("true");
      }
      expect(searchMounts).toBe(0);
      expect(screen.queryByRole("textbox")).toBeNull();
    });

    it("arrowing off an open search closes it", () => {
      render(<Harness />);
      fireEvent.click(radio(tatis(), "Wrong player"));
      expect(searchMounts).toBe(1);
      fireEvent.keyDown(radio(tatis(), "Wrong player"), { key: "ArrowRight" });
      expect(screen.queryByRole("textbox", { name: "Search players" })).toBeNull();
      expect(searchMounts).toBe(1);
    });

    it("keeps the namesakes in view with the search open", () => {
      candidates = CANDIDATES;
      render(<Harness />);
      fireEvent.click(radio(tatis(), "Wrong player"));
      expect(screen.getByRole("radiogroup", { name: "Which Fernando Tatis Jr.?" })).toBeTruthy();
      expect(screen.getByRole("textbox", { name: "Search players" })).toBeTruthy();
    });
  });

  it("says it is looking while the read is on its way", () => {
    candidateState = "loading";
    render(<Harness />);
    fireEvent.click(radio(tatis(), "Wrong player"));
    expect(screen.getByText("Looking for players…")).toBeTruthy();
  });
});

describe("Fix card’s team", () => {
  it("choosing it opens a search of existing teams at once; a result re-checks the same player", () => {
    render(<Harness />);
    fireEvent.click(radio(trout(), "Fix card’s team"));
    // No second click: the search is there, with focus in its box.
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Search teams" }));
    expect(screen.queryByRole("button", { name: "Pick a team for Mike Trout" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Search result team" }));
    expect(answersSeen[keyOf("p-trout")]).toMatchObject({
      kind: "team",
      pick: { teamId: "picked-team", name: "Picked team" },
    });
    expect(asked).toEqual([{ playerId: "p-trout", teamId: "picked-team" }]);
    expect(screen.getByRole("button", { name: "Pick another team for Mike Trout" })).toBeTruthy();
  });

  it("Enter on the pill opens it and takes focus; arrowing onto it does neither", () => {
    render(<Harness />);
    fireEvent.keyDown(radio(trout(), "Keep as is"), { key: "ArrowLeft" });
    expect(radio(trout(), "Fix card’s team").getAttribute("aria-checked")).toBe("true");
    expect(searchMounts).toBe(0);
    expect(document.activeElement).toBe(radio(trout(), "Fix card’s team"));
    // The button is still how a keyboard user opens it from the panel.
    expect(screen.getByRole("button", { name: "Pick a team for Mike Trout" })).toBeTruthy();
    fireEvent.keyDown(radio(trout(), "Fix card’s team"), { key: "Enter" });
    expect(searchMounts).toBe(1);
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Search teams" }));
  });

  it("names the picked team by its short name in the follow-up, as the lines do", () => {
    coverage = { "p-trout|picked-team": false };
    render(<Harness />);
    fireEvent.click(radio(trout(), "Fix card’s team"));
    fireEvent.click(screen.getByRole("button", { name: "Search result team" }));
    expect(screen.getByText("No Picks in Mike Trout’s career by 2022 either.")).toBeTruthy();
    expect(screen.queryByText(/Picked team/)).toBeNull();
    fireEvent.click(radio(screen.getByRole("radiogroup", { name: "Career for Mike Trout" }), "Add to career"));
    // The widget stages the PICKED team, by id, from the set's year.
    expect(
      within(screen.getByRole("list", { name: "Stints to add for Mike Trout" })).getByText(
        "Picked team (2022–present)",
      ),
    ).toBeTruthy();
    expect(answersSeen[keyOf("p-trout")]).toMatchObject({
      then: { kind: "add", stints: [{ teamId: "picked-team", fromYear: 2022 }] },
    });
  });

  it("falls back to the search result's name until the short name is known", () => {
    coverage = { "p-trout|picked-team": false };
    delete SHORT["picked-team"];
    try {
      render(<Harness />);
      fireEvent.click(radio(trout(), "Fix card’s team"));
      fireEvent.click(screen.getByRole("button", { name: "Search result team" }));
      expect(screen.getByText("No Picked team in Mike Trout’s career by 2022 either.")).toBeTruthy();
    } finally {
      SHORT["picked-team"] = "Picks";
    }
  });

  it("cancelling a search the pill opened puts focus back on that pill (A1)", () => {
    vi.useFakeTimers();
    render(<Harness />);
    fireEvent.click(radio(trout(), "Fix card’s team"));
    fireEvent.click(screen.getByRole("button", { name: "Cancel search" }));
    act(() => {
      vi.runAllTimers();
    });
    vi.useRealTimers();
    expect(document.activeElement).toBe(radio(trout(), "Fix card’s team"));
    expect(screen.getByRole("button", { name: "Pick a team for Mike Trout" })).toBeTruthy();
  });

  it("cancelling a search 'Pick a team…' opened puts focus back on that button (A1)", () => {
    vi.useFakeTimers();
    render(<Harness />);
    fireEvent.keyDown(radio(trout(), "Keep as is"), { key: "ArrowLeft" });
    fireEvent.click(screen.getByRole("button", { name: "Pick a team for Mike Trout" }));
    expect(searchMounts).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "Cancel search" }));
    act(() => {
      vi.runAllTimers();
    });
    vi.useRealTimers();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Pick a team for Mike Trout" }),
    );
  });

  it("pressing the pill again after a pick searches again", () => {
    render(<Harness />);
    fireEvent.click(radio(trout(), "Fix card’s team"));
    fireEvent.click(screen.getByRole("button", { name: "Search result team" }));
    expect(searchMounts).toBe(1);
    fireEvent.click(radio(trout(), "Fix card’s team"));
    expect(searchMounts).toBe(2);
    expect(screen.getByRole("textbox", { name: "Search teams" })).toBeTruthy();
  });
});

describe("keyboard", () => {
  it("arrows move and pick, wrapping", () => {
    render(<Harness />);
    const leave = radio(tatis(), "Keep as is");
    act(() => leave.focus());
    fireEvent.keyDown(leave, { key: "ArrowRight" });
    expect(radio(tatis(), "Add to career").getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(radio(tatis(), "Add to career"));
    fireEvent.keyDown(radio(tatis(), "Add to career"), { key: "ArrowLeft" });
    fireEvent.keyDown(radio(tatis(), "Keep as is"), { key: "ArrowLeft" });
    expect(radio(tatis(), "Fix card’s team").getAttribute("aria-checked")).toBe("true");
  });

  it("Enter on 'Leave it' moves to the next line, and from the last line out to Next", () => {
    render(<Harness />);
    fireEvent.keyDown(radio(trout(), "Keep as is"), { key: "Enter" });
    expect(document.activeElement).toBe(radio(tatis(), "Keep as is"));
    expect(allDone).not.toHaveBeenCalled();
    fireEvent.keyDown(radio(tatis(), "Keep as is"), { key: "Enter" });
    expect(allDone).toHaveBeenCalledTimes(1);
  });

  it("refuses a held (repeating) Enter", () => {
    render(<Harness />);
    fireEvent.keyDown(radio(tatis(), "Keep as is"), { key: "Enter", repeat: true });
    expect(allDone).not.toHaveBeenCalled();
  });

  it("Enter on 'Add to career' steps into its team box", () => {
    vi.useFakeTimers();
    render(<Harness />);
    fireEvent.keyDown(radio(tatis(), "Keep as is"), { key: "ArrowRight" });
    fireEvent.keyDown(radio(tatis(), "Add to career"), { key: "Enter" });
    act(() => {
      vi.runAllTimers();
    });
    vi.useRealTimers();
    expect(document.activeElement).toBe(
      screen.getByLabelText("Career team name for Fernando Tatis Jr."),
    );
  });
});

describe("when the career check could not run (NEO-574)", () => {
  it("offers a Retry beside lines that did read (the words ride the wizard's status line)", () => {
    render(<Harness readFailed />);
    fireEvent.click(screen.getByRole("button", { name: CAREER_RETRY_LABEL }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    // The lines are still there and still default to Leave it.
    expect(radio(tatis(), "Keep as is").getAttribute("aria-checked")).toBe("true");
  });

  it("with no line to list, still shows the heading and Retry", () => {
    render(<Harness empty readFailed />);
    expect(screen.getByRole("heading", { name: careerHeading(0) })).toBeTruthy();
    expect(screen.getByRole("button", { name: CAREER_RETRY_LABEL })).toBeTruthy();
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });

  it("offers no Retry when nothing failed", () => {
    render(<Harness />);
    expect(screen.queryByRole("button", { name: CAREER_RETRY_LABEL })).toBeNull();
  });

  it("a failed re-check of a picked player says so, instead of 'Checking…' for ever", () => {
    candidates = [
      { playerId: pid("p-sr"), name: "Fernando Tatis Sr.", careerSummary: "", covers: false },
    ];
    failed = { "p-sr|t-padres": true };
    render(<Harness readFailed />);
    fireEvent.click(radio(tatis(), "Wrong player"));
    fireEvent.click(screen.getByRole("radio", { name: /Fernando Tatis Sr\./ }));
    expect(screen.getByText("Couldn’t check Fernando Tatis Sr.’s career.")).toBeTruthy();
    expect(screen.queryByText(/^Checking /)).toBeNull();
  });
});
