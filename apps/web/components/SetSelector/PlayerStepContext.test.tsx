/**
 * NEO-602 — the same-name player step's evidence panel on its own: the cards
 * that print the name, each candidate's stints, the line that says whether the
 * printed team settles anything, and the accessibility the panel promises
 * (explicit list roles, one polite status mounted before the answer lands, no
 * focus moved).
 *
 * The wizard-level placement (under the candidates, only on the pick step) is
 * in `EntityReviewWizard.sameNameContext.test.tsx`.
 */

import { render, screen, within } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";

vi.mock("../../convex/_generated/api", () => ({
  api: { entityReviewQueue: { playerStepContext: "entityReviewQueue.playerStepContext" } },
}));

let answer: unknown;
vi.mock("convex/react", () => ({
  useQuery: () => answer,
}));

import PlayerStepContext, {
  printedTeamLine,
  type PlayerStepCard,
  type PlayerStepPlayer,
} from "./PlayerStepContext";

const stint = (label: string, years: string, onPrintedTeam = false) => ({
  teamId: `team-${label}` as unknown as Id<"teams">,
  label,
  years,
  onPrintedTeam,
});

const who = (
  id: string,
  extra: Partial<PlayerStepPlayer> = {},
): PlayerStepPlayer => ({
  playerId: id as unknown as Id<"players">,
  name: "Luis Castillo",
  stints: [],
  moreStints: 0,
  hasPrintedTeam: false,
  ...extra,
});

const MARINERS: PlayerStepCard = { number: "62", teams: ["Seattle Mariners"] };

describe("printedTeamLine", () => {
  const pitcher = who("a", { birthYear: 1992, hasPrintedTeam: true });
  const second = who("b", { birthYear: 1995, hasPrintedTeam: true });
  const retired = who("c", { birthYear: 1975 });

  it("says the team settles nothing when several candidates have a stint with it", () => {
    expect(printedTeamLine([MARINERS], [pitcher, second, retired])).toBe(
      "The printed team doesn't settle it: 2 of these players have a stint with it.",
    );
  });

  it("names the one candidate with a stint on file, with a birth year to tell the namesakes apart", () => {
    expect(printedTeamLine([MARINERS], [pitcher, retired])).toBe(
      "Only Luis Castillo (b. 1992) has a stint on file with the printed team.",
    );
  });

  it("says so when none of them has a stint with it", () => {
    expect(printedTeamLine([MARINERS], [retired, who("d")])).toBe(
      "None of these players has a stint on file with the printed team.",
    );
  });

  it("speaks of 'a printed team' when the cards name more than one", () => {
    expect(
      printedTeamLine([MARINERS, { number: "63", teams: ["Detroit Tigers"] }], [retired]),
    ).toBe("None of these players has a stint on file with a printed team.");
  });

  it("is silent when no card names a team", () => {
    expect(printedTeamLine([{ number: "62", teams: [] }], [pitcher, second])).toBe("");
    expect(printedTeamLine([], [pitcher])).toBe("");
  });
});

describe("PlayerStepContext", () => {
  const reviewRowId = "row-1" as unknown as Id<"entityReviewQueue">;
  const context = (over: Record<string, unknown> = {}) => ({
    cards: [MARINERS],
    moreCards: 0,
    players: [
      who("a", {
        birthYear: 1992,
        hasPrintedTeam: true,
        stints: [
          stint("Cincinnati Reds", "2017–22"),
          stint("Seattle Mariners", "2022–present", true),
        ],
      }),
      who("b", {
        birthYear: 1995,
        hasPrintedTeam: true,
        stints: [stint("Seattle Mariners", "2025–present", true)],
      }),
      who("c", { stints: [] }),
    ],
    ...over,
  });
  // A FRESH element per render: a rerender of the same element bails out and
  // never re-reads the module-state mock.
  const panel = () => <PlayerStepContext reviewRowId={reviewRowId} />;

  beforeEach(() => {
    answer = undefined;
  });

  it("lists the card with its number and printed team", () => {
    answer = context();
    render(panel());
    expect(screen.getByText("Printed on 1 card")).toBeTruthy();
    const cards = screen.getByRole("list", { name: "Cards that print this name" });
    const card = within(cards).getByRole("listitem");
    expect(card.textContent).toContain("#62");
    expect(card.textContent).toContain("Seattle Mariners");
  });

  it("says 'No team printed' for a card with none, and 'No number' for one without", () => {
    answer = context({ cards: [{ teams: [] }], moreCards: 0 });
    render(panel());
    const card = within(screen.getByRole("list", { name: "Cards that print this name" })).getByRole(
      "listitem",
    );
    expect(card.textContent).toContain("No number");
    expect(card.textContent).toContain("No team printed");
  });

  it("counts the cards beyond the bound", () => {
    answer = context({ moreCards: 4 });
    render(panel());
    expect(screen.getByText("Printed on 5 cards")).toBeTruthy();
    expect(screen.getByText("+4 more cards")).toBeTruthy();
  });

  it("lists each candidate's stints with years and marks the printed team", () => {
    answer = context();
    render(panel());
    const players = screen.getByRole("list", { name: "Known teams for each player on file" });
    const [first, second, bare] = within(players)
      .getAllByRole("listitem")
      .filter((li) => li.parentElement === players);
    expect(first.textContent).toContain("Luis Castillo, b. 1992");
    expect(first.textContent).toContain("2017–22 Cincinnati Reds");
    expect(first.textContent).toContain("2022–present Seattle Mariners printed team");
    expect(first.textContent).not.toContain("2017–22 Cincinnati Reds printed team");
    expect(second.textContent).toContain("b. 1995");
    expect(bare.textContent).toContain("Nothing on file yet");
  });

  it("says 'years not on file' for an undated stint, and counts stints past the bound", () => {
    answer = context({
      players: [
        who("a", {
          stints: [stint("Seattle Mariners", "", true)],
          moreStints: 3,
          hasPrintedTeam: true,
        }),
      ],
    });
    render(panel());
    expect(screen.getByText("years not on file")).toBeTruthy();
    expect(screen.getByText("+3 more")).toBeTruthy();
  });

  it("gives both lists an explicit list role", () => {
    answer = context();
    render(panel());
    for (const name of ["Cards that print this name", "Known teams for each player on file"]) {
      expect(screen.getByRole("list", { name }).getAttribute("role")).toBe("list");
    }
  });

  it("keeps ONE polite status mounted, empty until the answer lands, then carrying the line", () => {
    const { rerender } = render(panel());
    const before = screen.getByRole("status");
    expect(before.textContent).toBe("");
    expect(screen.queryByRole("list")).toBeNull();

    answer = context();
    rerender(panel());

    // The very element that was mounted empty: that is what is announced.
    expect(screen.getByRole("status")).toBe(before);
    expect(before.textContent).toBe(
      "The printed team doesn't settle it: 2 of these players have a stint with it.",
    );
  });

  it("renders nothing but the empty status for a row with no context", () => {
    answer = null;
    render(panel());
    expect(screen.getByRole("status").textContent).toBe("");
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("moves no focus when the answer lands", () => {
    const { rerender } = render(<div>{panel()}</div>);
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    outside.focus();
    answer = context();
    rerender(<div>{panel()}</div>);
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });
});
