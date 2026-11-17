/**
 * NEO-574 — the "Career check" step's own behaviour: one line per
 * (player, team), "Leave it" picked by default, the four answers, the
 * re-check after a different player or team, and the keyboard model.
 * The wiring into the wizard is EntityReviewWizard.career.test.tsx.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import React, { useEffect, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";

let candidates: Array<Record<string, unknown>>;
let candidateState: "idle" | "loading" | "ready" | "failed";
let relinkArgs: unknown[];

vi.mock("./career-reads", () => ({
  useRelinkCandidates: (_id: unknown, args: unknown) => {
    relinkArgs.push(args);
    return { state: candidateState, candidates };
  },
}));

vi.mock("./EntityLinkSearch", () => ({
  default: ({
    kind,
    onSelect,
    onCancel,
  }: {
    kind: string;
    onSelect: (id: string, name: string) => void;
    onCancel: () => void;
  }) => (
    <div>
      <button type="button" onClick={() => onSelect(`picked-${kind}`, `Picked ${kind}`)}>
        Search result {kind}
      </button>
      <button type="button" onClick={onCancel}>
        Cancel search
      </button>
    </div>
  ),
}));

import CareerCheckStep, { careerLineLabel } from "./CareerCheckStep";
import {
  CAREER_NEXT_BLOCKED,
  CAREER_STEP_HEADING,
  careerStepLead,
  deriveSittingPairs,
  noStintText,
  toLines,
  type CareerAnswers,
  type CareerContext,
  type CoverageAsk,
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

let coverage: Record<string, boolean>;
let asked: CoverageAsk[];
let answersSeen: CareerAnswers;
let allDone: ReturnType<typeof vi.fn>;

function Harness(props: { checking?: boolean; showBlockedHint?: boolean }) {
  const [answers, setAnswers] = useState<CareerAnswers>({});
  useEffect(() => {
    answersSeen = answers;
  }, [answers]);
  return (
    <CareerCheckStep
      lines={LINES}
      setYear={2022}
      selectorOptionId={SET}
      sportId={SPORT}
      answers={answers}
      onAnswer={(key, answer) => setAnswers((prev) => ({ ...prev, [key]: answer }))}
      coverage={coverage}
      requestCoverage={(asks) => asked.push(...asks)}
      playerNameOf={(l) => NAMES[l.playerId]}
      teamNameOf={(l) => TEAMS[l.teamId ?? ""]}
      onAllDone={allDone}
      headingId="career-lead"
      hintId="career-hint"
      {...props}
    />
  );
}

const group = (player: string, team: string) =>
  screen.getByRole("radiogroup", { name: careerLineLabel(player, team) });
const tatis = () => group("Fernando Tatis Jr.", "San Diego Padres");
const trout = () => group("Mike Trout", "Los Angeles Angels");
const radio = (g: HTMLElement, name: string) => within(g).getByRole("radio", { name });

beforeEach(() => {
  candidates = [];
  candidateState = "ready";
  relinkArgs = [];
  coverage = {};
  asked = [];
  allDone = vi.fn();
});

describe("the lines", () => {
  it("names the step, counts the lines, and lists one line per player and team", () => {
    render(<Harness />);
    expect(screen.getByRole("heading", { name: CAREER_STEP_HEADING })).toBeTruthy();
    expect(screen.getByText(careerStepLead(2))).toBeTruthy();
    expect(screen.getByText("Fernando Tatis Jr.")).toBeTruthy();
    expect(screen.getByText(noStintText("San Diego Padres", 2022))).toBeTruthy();
    // The cards behind the pair, once.
    expect(screen.getByText(/Cards #12 · #45/)).toBeTruthy();
    expect(screen.getByText(/Cards #27/)).toBeTruthy();
  });

  it("opens every line on 'Leave it', as the one tab stop", () => {
    render(<Harness />);
    for (const g of [tatis(), trout()]) {
      const leave = radio(g, "Leave it");
      expect(leave.getAttribute("aria-checked")).toBe("true");
      expect(leave.tabIndex).toBe(0);
      expect(radio(g, "Add the stint").tabIndex).toBe(-1);
    }
    expect(answersSeen).toEqual({});
  });

  it("shows only the checking line while the reads are on their way", () => {
    render(<Harness checking />);
  });
});

describe("Add the stint", () => {
  it("opens From year on the set's year, and a To year", () => {
    render(<Harness />);
    fireEvent.click(radio(tatis(), "Add the stint"));
    const from = screen.getByLabelText("From year for Fernando Tatis Jr., San Diego Padres") as HTMLInputElement;
    expect(from.value).toBe("2022");
    expect(screen.getByLabelText("To year (optional) for Fernando Tatis Jr., San Diego Padres")).toBeTruthy();
    expect(answersSeen[LINES[0].key]).toEqual({ kind: "add", fromYear: "2022", toYear: "" });
  });

  it("keeps each line's years apart", () => {
    render(<Harness />);
    fireEvent.click(radio(tatis(), "Add the stint"));
    fireEvent.click(radio(trout(), "Add the stint"));
    expect(screen.getAllByLabelText(/^From year for /)).toHaveLength(2);
  });

  it("Enter in a year moves on (the last line: out to Next); an invalid stint stays put", () => {
    render(<Harness />);
    fireEvent.click(radio(trout(), "Add the stint"));
    const from = screen.getByLabelText("From year for Mike Trout, Los Angeles Angels");
    fireEvent.change(from, { target: { value: "" } });
    fireEvent.keyDown(from, { key: "Enter" });
    expect(allDone).not.toHaveBeenCalled();
    fireEvent.change(from, { target: { value: "2021" } });
    fireEvent.keyDown(from, { key: "Enter" });
    expect(allDone).toHaveBeenCalledTimes(1);
  });

  it("flags years that are not a stint", () => {
    render(<Harness />);
    fireEvent.click(radio(tatis(), "Add the stint"));
    const from = screen.getByLabelText("From year for Fernando Tatis Jr., San Diego Padres");
    fireEvent.change(from, { target: { value: "1200" } });
    expect(from.getAttribute("aria-invalid")).toBe("true");
  });

  it("returning to 'Leave it' closes the form", () => {
    render(<Harness />);
    fireEvent.click(radio(tatis(), "Add the stint"));
    fireEvent.click(radio(tatis(), "Leave it"));
    expect(screen.queryByLabelText(/^From year for Fernando/)).toBeNull();
    expect(answersSeen[LINES[0].key]).toEqual({ kind: "leave" });
  });
});

describe("Different player", () => {
  const CANDIDATES = [
    { playerId: pid("p-sr"), name: "Fernando Tatis Sr.", careerSummary: "Cardinals 1997–1998", covers: true },
    { playerId: pid("p-x"), name: "Fernando Tatis", careerSummary: "No career on file", covers: false },
  ];

  it("lists the same-name players, asking only about existing ones, excluding the current", () => {
    candidates = CANDIDATES;
    render(<Harness />);
    fireEvent.click(radio(tatis(), "Different player"));
    expect(relinkArgs.at(-1)).toMatchObject({
      printedName: "Fernando Tatis Jr.",
      teamId: "t-padres",
      excludePlayerId: "p-tatis",
    });
    const list = screen.getByRole("group", { name: "Which player is this?" });
    expect(within(list).getAllByRole("button").map((b) => b.textContent)).toEqual([
      expect.stringContaining("Fernando Tatis Sr."),
      expect.stringContaining("Fernando Tatis"),
    ]);
    expect(within(list).getByText("Has San Diego Padres on file")).toBeTruthy();
  });

  it("a pick asks about the NEW pair and says it is checking", () => {
    candidates = CANDIDATES;
    render(<Harness />);
    fireEvent.click(radio(tatis(), "Different player"));
    fireEvent.click(screen.getByRole("button", { name: /Fernando Tatis Sr\./ }));
    expect(answersSeen[LINES[0].key]).toMatchObject({
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
    fireEvent.click(radio(tatis(), "Different player"));
    fireEvent.click(screen.getByRole("button", { name: /Fernando Tatis Sr\./ }));
    expect(screen.getByText("Fernando Tatis Sr. has San Diego Padres on file.")).toBeTruthy();
    expect(screen.queryByRole("radiogroup", { name: "Career for Fernando Tatis Sr." })).toBeNull();
  });

  it("an uncovered answer offers the stint for the new player, or leaving it", () => {
    candidates = CANDIDATES;
    coverage = { "p-sr|t-padres": false };
    render(<Harness />);
    fireEvent.click(radio(tatis(), "Different player"));
    fireEvent.click(screen.getByRole("button", { name: /Fernando Tatis Sr\./ }));
    expect(screen.getByText("Fernando Tatis Sr. has no San Diego Padres stint by 2022 either.")).toBeTruthy();
    const follow = screen.getByRole("radiogroup", { name: "Career for Fernando Tatis Sr." });
    expect(radio(follow, "Leave it").getAttribute("aria-checked")).toBe("true");
    fireEvent.click(radio(follow, "Add the stint"));
    expect(
      screen.getByLabelText("From year for Fernando Tatis Sr., San Diego Padres"),
    ).toBeTruthy();
    expect((answersSeen[LINES[0].key] as { then: { kind: string } }).then.kind).toBe("add");
  });

  it("'Someone else…' opens the existing-player search and a result is a pick", () => {
    candidates = [];
    render(<Harness />);
    fireEvent.click(radio(tatis(), "Different player"));
    fireEvent.click(screen.getByRole("button", { name: "Someone else for Fernando Tatis Jr." }));
    fireEvent.click(screen.getByRole("button", { name: "Search result player" }));
    expect(answersSeen[LINES[0].key]).toMatchObject({
      kind: "player",
      pick: { playerId: "picked-player", name: "Picked player" },
    });
    expect(asked).toEqual([
      { playerId: "picked-player", teamId: "t-padres", teamName: "Padres" },
    ]);
    // The pick stays visible though it is not among the candidates.
    expect(screen.getByRole("button", { name: /Picked player/ }).getAttribute("aria-pressed")).toBe("true");
  });

  it("says it is looking while the read is on its way", () => {
    candidateState = "loading";
    render(<Harness />);
    fireEvent.click(radio(tatis(), "Different player"));
    expect(screen.getByText("Looking for players…")).toBeTruthy();
  });
});

describe("Different team", () => {
  it("opens a search of existing teams on its own button; a result re-checks the same player", () => {
    render(<Harness />);
    fireEvent.click(radio(trout(), "Different team"));
    expect(screen.queryByRole("button", { name: "Search result team" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Pick a team for Mike Trout" }));
    fireEvent.click(screen.getByRole("button", { name: "Search result team" }));
    expect(answersSeen[LINES[1].key]).toMatchObject({
      kind: "team",
      pick: { teamId: "picked-team", name: "Picked team" },
    });
    expect(asked).toEqual([{ playerId: "p-trout", teamId: "picked-team" }]);
    expect(screen.getByRole("button", { name: "Pick another team for Mike Trout" })).toBeTruthy();
  });
});

describe("keyboard", () => {
  it("arrows move and pick, wrapping", () => {
    render(<Harness />);
    const leave = radio(tatis(), "Leave it");
    act(() => leave.focus());
    fireEvent.keyDown(leave, { key: "ArrowRight" });
    expect(radio(tatis(), "Add the stint").getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(radio(tatis(), "Add the stint"));
    fireEvent.keyDown(radio(tatis(), "Add the stint"), { key: "ArrowLeft" });
    fireEvent.keyDown(radio(tatis(), "Leave it"), { key: "ArrowLeft" });
    expect(radio(tatis(), "Different team").getAttribute("aria-checked")).toBe("true");
  });

  it("Enter on 'Leave it' moves to the next line, and from the last line out to Next", () => {
    render(<Harness />);
    fireEvent.keyDown(radio(tatis(), "Leave it"), { key: "Enter" });
    expect(document.activeElement).toBe(radio(trout(), "Leave it"));
    expect(allDone).not.toHaveBeenCalled();
    fireEvent.keyDown(radio(trout(), "Leave it"), { key: "Enter" });
    expect(allDone).toHaveBeenCalledTimes(1);
  });

  it("refuses a held (repeating) Enter", () => {
    render(<Harness />);
    fireEvent.keyDown(radio(trout(), "Leave it"), { key: "Enter", repeat: true });
    expect(allDone).not.toHaveBeenCalled();
  });

  it("Enter on 'Add the stint' steps into its years", () => {
    vi.useFakeTimers();
    render(<Harness />);
    fireEvent.keyDown(radio(tatis(), "Leave it"), { key: "ArrowRight" });
    fireEvent.keyDown(radio(tatis(), "Add the stint"), { key: "Enter" });
    act(() => {
      vi.runAllTimers();
    });
    vi.useRealTimers();
    expect(document.activeElement).toBe(
      screen.getByLabelText("From year for Fernando Tatis Jr., San Diego Padres"),
    );
  });
});

describe("the status line", () => {
  it("is always mounted, and says the years are wrong only when Next was held", () => {
    const { rerender } = render(<Harness />);
    expect(screen.getByRole("status").textContent).toBe("");
    rerender(<Harness showBlockedHint />);
    expect(screen.getByRole("status").textContent).toBe(CAREER_NEXT_BLOCKED);
  });
});
