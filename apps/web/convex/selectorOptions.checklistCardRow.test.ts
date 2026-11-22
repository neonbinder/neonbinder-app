/**
 * NEO-645 — a checklist row that names no player is "Card #N", as on main's
 * Tidy Up wizard. The row's printed word ("Checklist") is not kept as a name
 * and no team is claimed for it: No Team comes only from a team-cell claim.
 */
import { describe, expect, test } from "vitest";
import { checklistOnlyCard } from "./selectorOptions";

describe("the card a checklist row with no marketplace card becomes", () => {
  test("a row with neither a player nor a team is 'Card #n', names no player and claims no team", () => {
    const card = checklistOnlyCard({ number: "7", players: [], teams: [] }, () => null);
    expect(card.cardName).toBe("Card #7");
    expect(card.players).toBeUndefined();
    expect(card.teams).toBeUndefined();
    expect(card.teamLookup).toBeUndefined();
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
