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

import { render, screen, waitFor, within } from "@testing-library/react";
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
  PLAYER_STINTS_HEADING,
  STATUS_ANNOUNCE_DELAY_MS,
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

  it("tells namesakes with no birth year apart by position, the pick step's own wording", () => {
    const first = who("a", { hasPrintedTeam: false });
    const middle = who("b", { hasPrintedTeam: true });
    const last = who("c", { hasPrintedTeam: false });
    expect(printedTeamLine([MARINERS], [first, middle, last])).toBe(
      "Only Luis Castillo (option 2 of 3) has a stint on file with the printed team.",
    );
    // A birth year still wins over the position when we hold one.
    expect(printedTeamLine([MARINERS], [first, who("b", { birthYear: 1995, hasPrintedTeam: true })])).toBe(
      "Only Luis Castillo (b. 1995) has a stint on file with the printed team.",
    );
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
  /** The status is filled one tick after the answer lands (`STATUS_ANNOUNCE_DELAY_MS`). */
  const statusText = async (text: string) =>
    waitFor(() => expect(screen.getByRole("status").textContent).toBe(text), {
      timeout: STATUS_ANNOUNCE_DELAY_MS * 10,
    });

  beforeEach(() => {
    answer = undefined;
  });

  it("lists the card with its number and printed team", () => {
    answer = context();
    render(panel());
    expect(screen.getByText("Printed on 1 card")).toBeTruthy();
    const cards = screen.getByRole("list", { name: "Printed on 1 card" });
    const card = within(cards).getByRole("listitem");
    expect(card.textContent).toContain("#62");
    expect(card.textContent).toContain("Seattle Mariners");
  });

  it("says 'No team printed' for a card with none, and 'No number' for one without", () => {
    answer = context({ cards: [{ teams: [] }], moreCards: 0 });
    render(panel());
    const card = within(screen.getByRole("list", { name: "Printed on 1 card" })).getByRole(
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
    const players = screen.getByRole("list", { name: PLAYER_STINTS_HEADING });
    const [first, second, bare] = within(players)
      .getAllByRole("listitem")
      .filter((li) => li.parentElement === players);
    expect(first.textContent).toContain("Luis Castillo, b. 1992");
    expect(first.textContent).toContain("2017–22 Cincinnati Reds");
    // A qualifier in parentheses, so it never runs into the team's name.
    expect(first.textContent).toContain("2022–present Seattle Mariners (printed team)");
    expect(first.textContent).not.toContain("2017–22 Cincinnati Reds (printed team)");
    expect(second.textContent).toContain("b. 1995");
    expect(bare.textContent).toContain("Nothing on file yet");
  });

  it("tells candidates with no birth year apart in the list by position, in the pick step's order", () => {
    answer = context({
      players: [
        who("a", { stints: [] }),
        who("b", { stints: [] }),
        who("c", { birthYear: 1992, stints: [] }),
      ],
    });
    render(panel());
    const players = screen.getByRole("list", { name: PLAYER_STINTS_HEADING });
    const [first, second, third] = within(players)
      .getAllByRole("listitem")
      .filter((li) => li.parentElement === players);
    expect(first.textContent).toContain("Luis Castillo, option 1 of 3");
    expect(second.textContent).toContain("Luis Castillo, option 2 of 3");
    expect(third.textContent).toContain("Luis Castillo, b. 1992");
    expect(third.textContent).not.toContain("option");
  });

  it("reads the same position in the status line as in the list entry", async () => {
    answer = context({
      cards: [MARINERS],
      players: [
        who("a", { stints: [] }),
        who("b", { stints: [stint("Seattle Mariners", "2025–present", true)], hasPrintedTeam: true }),
        who("c", { stints: [] }),
      ],
    });
    render(panel());
    await statusText("Only Luis Castillo (option 2 of 3) has a stint on file with the printed team.");
    const players = screen.getByRole("list", { name: PLAYER_STINTS_HEADING });
    const entries = within(players)
      .getAllByRole("listitem")
      .filter((li) => li.parentElement === players);
    expect(entries[1].textContent).toContain("Luis Castillo, option 2 of 3");
  });

  it("marks the printed team as a parenthesised qualifier, never run into the name", () => {
    answer = context();
    render(panel());
    const marked = screen.getAllByText("(printed team)");
    expect(marked).toHaveLength(2);
    // Separate text, so a reader pauses between the team and the qualifier.
    expect(marked[0].previousSibling?.textContent).toBe(" ");
  });

  it("names each list by its visible lead-in (aria-labelledby), not by a separate label", () => {
    answer = context();
    render(panel());
    const cards = screen.getByRole("list", { name: "Printed on 1 card" });
    const players = screen.getByRole("list", { name: PLAYER_STINTS_HEADING });
    for (const list of [cards, players]) {
      expect(list.getAttribute("aria-label")).toBeNull();
      const lead = document.getElementById(list.getAttribute("aria-labelledby") ?? "");
      expect(lead?.tagName).toBe("P");
      expect(lead?.textContent).toBeTruthy();
    }
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
    for (const name of ["Printed on 1 card", PLAYER_STINTS_HEADING]) {
      expect(screen.getByRole("list", { name }).getAttribute("role")).toBe("list");
    }
  });

  it("keeps ONE polite status mounted, empty until the answer lands, then carrying the line", async () => {
    const { rerender } = render(panel());
    const before = screen.getByRole("status");
    expect(before.textContent).toBe("");
    expect(screen.queryByRole("list")).toBeNull();

    answer = context();
    rerender(panel());

    // The very element that was mounted empty: that is what is announced.
    expect(screen.getByRole("status")).toBe(before);
    await statusText("The printed team doesn't settle it: 2 of these players have a stint with it.");
    expect(screen.getByRole("status")).toBe(before);
  });

  it("mounts the status EMPTY even when the answer is already in hand, and fills it a tick later", async () => {
    // A cached answer: the first render already has the data, as a revisited
    // step does. A live region born holding its text may not be announced, so
    // the text must land after the element exists.
    answer = context();
    render(panel());
    const status = screen.getByRole("status");
    expect(status.textContent).toBe("");
    await statusText("The printed team doesn't settle it: 2 of these players have a stint with it.");
    expect(screen.getByRole("status")).toBe(status);
  });

  it("owns no space while empty, and a gap below only once it carries text", async () => {
    answer = context();
    render(panel());
    const status = screen.getByRole("status");
    expect(status.className).not.toContain("mb-3");
    await statusText("The printed team doesn't settle it: 2 of these players have a stint with it.");
    expect(status.className).toContain("mb-3");
    // The stack below it is its own block, so an empty status adds no gap to it.
    expect(status.nextElementSibling?.className).toContain("space-y-3");
    expect(status.parentElement?.className ?? "").not.toContain("space-y-3");
  });

  it("renders nothing but the empty status for a row with no context", () => {
    answer = null;
    render(panel());
    expect(screen.getByRole("status").textContent).toBe("");
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("moves no focus when the answer lands, status text included", async () => {
    const { rerender } = render(<div>{panel()}</div>);
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    outside.focus();
    answer = context();
    rerender(<div>{panel()}</div>);
    await statusText("The printed team doesn't settle it: 2 of these players have a stint with it.");
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });
});
