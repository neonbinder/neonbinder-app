/**
 * NEO-574 — the "Career check" step's own behaviour: one line per
 * (player, team), "Keep as is" picked by default, the four answers, the
 * re-check after a different player or team, and the keyboard model.
 * The wiring into the wizard is EntityReviewWizard.career.test.tsx.
 */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import React, { useEffect, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import { MIN_CAREER_YEAR, maxCareerYear } from "../../lib/players/career-years";

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
  CAREER_RETRY_LABEL,
  NO_CAREER_TEXT,
  careerHeading,
  deriveSittingPairs,
  noStintText,
  toLines,
  yearsHintText,
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

let coverage: Record<string, boolean>;
let asked: CoverageAsk[];
let answersSeen: CareerAnswers;
let allDone: () => void;

let failed: Record<string, boolean>;
let onRetry: () => void;

function Harness(props: {
  /** No team has a short name yet. */
  shortUnknown?: boolean;
  shortOverride?: Record<string, string>;
  readFailed?: boolean;
  empty?: boolean;
}) {
  const [answers, setAnswers] = useState<CareerAnswers>({});
  useEffect(() => {
    answersSeen = answers;
  }, [answers]);
  return (
    <CareerCheckStep
      lines={props.empty ? [] : LINES}
      setYear={2022}
      selectorOptionId={SET}
      sportId={SPORT}
      answers={answers}
      onAnswer={(key, answer) => {
        if (answer.kind === "player" && answer.pick) pickedAny = true;
        setAnswers((prev) => ({ ...prev, [key]: answer }));
      }}
      coverage={coverage}
      failed={failed}
      onRetry={onRetry}
      requestCoverage={(asks) => asked.push(...asks)}
      playerNameOf={(l) => NAMES[l.playerId]}
      teamNameOf={(l) => TEAMS[l.teamId ?? ""]}
      shortTeamNameOf={(l) =>
        props.shortUnknown
          ? undefined
          : (props.shortOverride?.[l.teamId ?? ""] ?? SHORT[l.teamId ?? ""])
      }
      shortTeamNameOfId={(id) => SHORT[id]}
      hasNoCareer={(l) => noCareer.has(l.playerId)}
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

beforeEach(() => {
  candidates = [];
  noCareer = new Set();
  reorderOnPick = false;
  pickedAny = false;
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
  it("opens From year on the set's year, and a To year", () => {
    render(<Harness />);
    fireEvent.click(radio(tatis(), "Add to career"));
    const from = screen.getByLabelText("From year for Fernando Tatis Jr., San Diego Padres") as HTMLInputElement;
    expect(from.value).toBe("2022");
    expect(screen.getByLabelText("To year (optional) for Fernando Tatis Jr., San Diego Padres")).toBeTruthy();
    expect(answersSeen[keyOf("p-tatis")]).toEqual({ kind: "add", fromYear: "2022", toYear: "" });
  });

  it("keeps each line's years apart", () => {
    render(<Harness />);
    fireEvent.click(radio(tatis(), "Add to career"));
    fireEvent.click(radio(trout(), "Add to career"));
    expect(screen.getAllByLabelText(/^From year for /)).toHaveLength(2);
  });

  it("Enter in a year moves on (the last line: out to Next); an invalid stint stays put", () => {
    render(<Harness />);
    fireEvent.click(radio(tatis(), "Add to career"));
    const from = screen.getByLabelText("From year for Fernando Tatis Jr., San Diego Padres");
    fireEvent.change(from, { target: { value: "" } });
    fireEvent.keyDown(from, { key: "Enter" });
    expect(allDone).not.toHaveBeenCalled();
    fireEvent.change(from, { target: { value: "2021" } });
    fireEvent.keyDown(from, { key: "Enter" });
    expect(allDone).toHaveBeenCalledTimes(1);
  });

  it("captions both year boxes in view (A3), the name still carrying the visible words", () => {
    render(<Harness />);
    fireEvent.click(radio(tatis(), "Add to career"));
    const from = screen.getByLabelText("From year for Fernando Tatis Jr., San Diego Padres");
    const to = screen.getByLabelText("To year (optional) for Fernando Tatis Jr., San Diego Padres");
    expect(within(from.closest("label") as HTMLElement).getByText("From year")).toBeTruthy();
    expect(within(to.closest("label") as HTMLElement).getByText("To year (optional)")).toBeTruthy();
    // Label-in-name: the accessible name starts with the visible caption.
    expect(from.getAttribute("aria-label")).toMatch(/^From year/);
    expect(to.getAttribute("aria-label")).toMatch(/^To year \(optional\)/);
    // The placeholder drops the "(opt)": the caption says it.
    expect(to.getAttribute("placeholder")).toBe("To year");
  });

  it("points an invalid year at the reason (A2), and Enter on it says the same", () => {
    render(<Harness />);
    fireEvent.click(radio(tatis(), "Add to career"));
    const from = screen.getByLabelText("From year for Fernando Tatis Jr., San Diego Padres");
    const note = () => document.getElementById(from.getAttribute("aria-describedby") ?? "");
    // Untouched and valid: nothing to say.
    expect(from.getAttribute("aria-describedby")).toBeNull();
    fireEvent.change(from, { target: { value: "1200" } });
    expect(note()?.textContent).toBe(yearsHintText());
    expect(yearsHintText()).toBe(
      `Years go ${MIN_CAREER_YEAR}–${maxCareerYear()}, and To can’t come before From.`,
    );
    expect(note()?.getAttribute("role")).toBe("status");
    // A blank From is quiet until Enter is pressed on it; then it is said.
    fireEvent.change(from, { target: { value: "" } });
    expect(from.getAttribute("aria-describedby")).toBeNull();
    fireEvent.keyDown(from, { key: "Enter" });
    expect(allDone).not.toHaveBeenCalled();
    expect(note()?.textContent).toBe(yearsHintText());
    // The same region goes quiet again once the years are a stint.
    fireEvent.change(from, { target: { value: "2021" } });
    expect(from.getAttribute("aria-describedby")).toBeNull();
  });

  it("holds off the 0x / exponent spellings Number() would take (U3)", () => {
    render(<Harness />);
    fireEvent.click(radio(tatis(), "Add to career"));
    const from = screen.getByLabelText("From year for Fernando Tatis Jr., San Diego Padres");
    fireEvent.change(from, { target: { value: "2021" } });
    fireEvent.keyDown(from, { key: "Enter" });
    expect(allDone).toHaveBeenCalledTimes(1);
  });

  it("flags years that are not a stint", () => {
    render(<Harness />);
    fireEvent.click(radio(tatis(), "Add to career"));
    const from = screen.getByLabelText("From year for Fernando Tatis Jr., San Diego Padres");
    fireEvent.change(from, { target: { value: "1200" } });
    expect(from.getAttribute("aria-invalid")).toBe("true");
  });

  it("returning to 'Keep as is' closes the form", () => {
    render(<Harness />);
    fireEvent.click(radio(tatis(), "Add to career"));
    fireEvent.click(radio(tatis(), "Keep as is"));
    expect(screen.queryByLabelText(/^From year for Fernando/)).toBeNull();
    expect(answersSeen[keyOf("p-tatis")]).toEqual({ kind: "leave" });
  });
});

describe("Wrong player", () => {
  const CANDIDATES = [
    { playerId: pid("p-sr"), name: "Fernando Tatis Sr.", birthYear: 1971, careerSummary: "Cardinals 1997–98", covers: true },
    { playerId: pid("p-x"), name: "Fernando Tatis", careerSummary: "", covers: false },
  ];

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

  it("'Someone else…' stays outside the namesake group", () => {
    candidates = CANDIDATES;
    render(<Harness />);
    fireEvent.click(radio(tatis(), "Wrong player"));
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
    expect(
      screen.getByLabelText("From year for Fernando Tatis Sr., Padres"),
    ).toBeTruthy();
    expect((answersSeen[keyOf("p-tatis")] as { then: { kind: string } }).then.kind).toBe("add");
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

  it("inner Enter acts like the outer: 'Keep as is' moves on, 'Add to career' steps into the years", () => {
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
      screen.getByLabelText("From year for Fernando Tatis Sr., Padres"),
    );
    fireEvent.keyDown(radio(follow, "Keep as is"), { key: "Enter" });
    expect(allDone).toHaveBeenCalledTimes(1);
  });

  it("'Someone else…' opens the existing-player search and a result is a pick", () => {
    candidates = [];
    render(<Harness />);
    fireEvent.click(radio(tatis(), "Wrong player"));
    fireEvent.click(screen.getByRole("button", { name: "Someone else for Fernando Tatis Jr." }));
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

  it("cancelling the search puts focus back on 'Someone else…' (A1)", () => {
    vi.useFakeTimers();
    candidates = [];
    render(<Harness />);
    fireEvent.click(radio(tatis(), "Wrong player"));
    fireEvent.click(screen.getByRole("button", { name: "Someone else for Fernando Tatis Jr." }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel search" }));
    act(() => {
      vi.runAllTimers();
    });
    vi.useRealTimers();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Someone else for Fernando Tatis Jr." }),
    );
  });

  it("says it is looking while the read is on its way", () => {
    candidateState = "loading";
    render(<Harness />);
    fireEvent.click(radio(tatis(), "Wrong player"));
    expect(screen.getByText("Looking for players…")).toBeTruthy();
  });
});

describe("Fix card’s team", () => {
  it("opens a search of existing teams on its own button; a result re-checks the same player", () => {
    render(<Harness />);
    fireEvent.click(radio(trout(), "Fix card’s team"));
    expect(screen.queryByRole("button", { name: "Search result team" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Pick a team for Mike Trout" }));
    fireEvent.click(screen.getByRole("button", { name: "Search result team" }));
    expect(answersSeen[keyOf("p-trout")]).toMatchObject({
      kind: "team",
      pick: { teamId: "picked-team", name: "Picked team" },
    });
    expect(asked).toEqual([{ playerId: "p-trout", teamId: "picked-team" }]);
    expect(screen.getByRole("button", { name: "Pick another team for Mike Trout" })).toBeTruthy();
  });

  it("names the picked team by its short name in the follow-up, as the lines do", () => {
    coverage = { "p-trout|picked-team": false };
    render(<Harness />);
    fireEvent.click(radio(trout(), "Fix card’s team"));
    fireEvent.click(screen.getByRole("button", { name: "Pick a team for Mike Trout" }));
    fireEvent.click(screen.getByRole("button", { name: "Search result team" }));
    expect(screen.getByText("No Picks in Mike Trout’s career by 2022 either.")).toBeTruthy();
    expect(screen.queryByText(/Picked team/)).toBeNull();
    fireEvent.click(radio(screen.getByRole("radiogroup", { name: "Career for Mike Trout" }), "Add to career"));
    expect(screen.getByLabelText("From year for Mike Trout, Picks")).toBeTruthy();
  });

  it("falls back to the search result's name until the short name is known", () => {
    coverage = { "p-trout|picked-team": false };
    delete SHORT["picked-team"];
    try {
      render(<Harness />);
      fireEvent.click(radio(trout(), "Fix card’s team"));
      fireEvent.click(screen.getByRole("button", { name: "Pick a team for Mike Trout" }));
      fireEvent.click(screen.getByRole("button", { name: "Search result team" }));
      expect(screen.getByText("No Picked team in Mike Trout’s career by 2022 either.")).toBeTruthy();
    } finally {
      SHORT["picked-team"] = "Picks";
    }
  });

  it("cancelling the search puts focus back on 'Pick a team…' (A1)", () => {
    vi.useFakeTimers();
    render(<Harness />);
    fireEvent.click(radio(trout(), "Fix card’s team"));
    fireEvent.click(screen.getByRole("button", { name: "Pick a team for Mike Trout" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel search" }));
    act(() => {
      vi.runAllTimers();
    });
    vi.useRealTimers();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Pick a team for Mike Trout" }),
    );
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

  it("Enter on 'Add the stint' steps into its years", () => {
    vi.useFakeTimers();
    render(<Harness />);
    fireEvent.keyDown(radio(tatis(), "Keep as is"), { key: "ArrowRight" });
    fireEvent.keyDown(radio(tatis(), "Add to career"), { key: "Enter" });
    act(() => {
      vi.runAllTimers();
    });
    vi.useRealTimers();
    expect(document.activeElement).toBe(
      screen.getByLabelText("From year for Fernando Tatis Jr., San Diego Padres"),
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
