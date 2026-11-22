/**
 * NEO-645 (S3b) — a "7 Checklist" row keeps "Checklist" as the card's own name,
 * names no player, and says No Team. NB-derived: the word is read from the
 * checklist's own printed subject, never from a marketplace value.
 */
import { describe, expect, test } from "vitest";
import { parsePublishedChecklist } from "../lib/checklists/parse-published-checklist";
import { checkPublishedChecklist } from "./lib/publishedChecklistCheck";
import { checklistOnlyCard } from "./selectorOptions";

const parse = (text: string) => parsePublishedChecklist(text).rows;

describe("the parser keeps a checklist card's subject", () => {
  test("the line format: '7 Checklist' is the card's name, no player, No Team", () => {
    expect(parse("7 Checklist")).toEqual([
      { number: "7", players: [], teams: [], noTeam: true, subject: "Checklist" },
    ]);
  });

  test("the printed spelling stays ('Checklist 1-100', 'Team Checklist')", () => {
    expect(parse("100 Checklist 1-100")[0]).toMatchObject({ subject: "Checklist 1-100", noTeam: true, players: [] });
    expect(parse("101 Team Checklist")[0]).toMatchObject({ subject: "Team Checklist", players: [] });
  });

  test("a delimited file's player cell does the same", () => {
    const rows = parse("Card #,Player,Team\n7,Checklist,\n8,Aaron Judge,New York Yankees\n");
    expect(rows[0]).toMatchObject({ number: "7", players: [], subject: "Checklist", noTeam: true });
    expect(rows[1].subject).toBeUndefined();
    expect(rows[1].players).toEqual(["Aaron Judge"]);
  });

  test("a subject that is not the checklist ('Team Card', 'Team Leaders') keeps no name and is not stamped No Team", () => {
    for (const text of ["12 Royals Team Card", "13 Team Leaders"]) {
      const row = parse(text)[0];
      expect(row.players).toEqual([]);
      expect(row.subject).toBeUndefined();
      expect(row.noTeam).toBeUndefined();
    }
  });

  test("a real player row carries neither", () => {
    expect(parse("1 Aaron Judge - New York Yankees")[0]).toEqual({
      number: "1",
      players: ["Aaron Judge"],
      teams: ["New York Yankees"],
    });
  });
});

describe("the server re-check and the checklist-only card", () => {
  test("the subject survives the re-check, cleaned", () => {
    const { rows } = checkPublishedChecklist({
      rows: [{ number: "7", players: [], teams: [], noTeam: true, subject: "  Check​list  " }],
    });
    expect(rows[0]).toMatchObject({ number: "7", subject: "Check list", noTeam: true });
  });

  test("the row with no marketplace card is a card named 'Checklist' with the No Team answer", () => {
    const [row] = checkPublishedChecklist({ rows: parse("7 Checklist") }).rows;
    const card = checklistOnlyCard(row, () => null);
    expect(card).toMatchObject({
      cardNumber: "7",
      cardName: "Checklist",
      teams: [],
      teamLookup: "checklist",
    });
    expect(card.players).toBeUndefined();
  });

  test("a row with neither a name nor a player is still 'Card #n'", () => {
    const card = checklistOnlyCard({ number: "9", players: [], teams: [] }, () => null);
    expect(card.cardName).toBe("Card #9");
  });
});
