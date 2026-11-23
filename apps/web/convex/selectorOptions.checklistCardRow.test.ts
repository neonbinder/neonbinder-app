/**
 * NEO-645 — a checklist row that names no player is named for what it printed
 * ("Checklist", "Team Card"; Jason, 2026-11-23: every card has a name), and
 * "Card #N" only when it printed nothing. No team is claimed for it: No Team
 * comes only from a team-cell claim.
 */
import { describe, expect, test } from "vitest";
import { checklistOnlyCard, checklistPairedRow } from "./selectorOptions";

describe("the card a checklist row with no marketplace card becomes", () => {
  test("a row with neither a player nor a team is 'Card #n', names no player and claims no team", () => {
    const card = checklistOnlyCard({ number: "7", players: [], teams: [] }, () => null);
    expect(card.cardName).toBe("Card #7");
    expect(card.players).toBeUndefined();
    expect(card.teams).toBeUndefined();
    expect(card.teamLookup).toBeUndefined();
  });

  test("a row that printed a subject but no person is named for it, and still names no player or team", () => {
    const card = checklistOnlyCard(
      { number: "3", players: [], teams: [], cardName: "Checklist 1-100" },
      () => null,
    );
    expect(card.cardName).toBe("Checklist 1-100");
    expect(card.players).toBeUndefined();
    expect(card.teams).toBeUndefined();
    expect(card.teamLookup).toBeUndefined();
  });

  test("a row with a player is named for the player, whatever a stray card name says", () => {
    const card = checklistOnlyCard(
      { number: "4", players: ["Mike Trout"], teams: [], cardName: "Team Card" },
      () => null,
    );
    expect(card.cardName).toBe("Mike Trout");
  });

  test("the paired row Match Cards lists (and puts back on an Unlink) keeps the name", () => {
    const row = { number: "3", players: [], teams: [], cardName: "Team Card" };
    expect(checklistPairedRow(row, () => null).cardName).toBe("Team Card");
  });

  test("a row with no number reads 'Card #NNO'", () => {
    const card = checklistOnlyCard({ number: "", players: [], teams: [] }, () => null);
    expect(card.cardName).toBe("Card #NNO");
  });

  test("a row that says No Team (a team-cell claim) is the checklist's own No team answer", () => {
    const card = checklistOnlyCard({ number: "8", players: [], teams: [], noTeam: true }, () => null);
    expect(card.teams).toEqual([]);
    expect(card.teamLookup).toBe("checklist");
  });
});
