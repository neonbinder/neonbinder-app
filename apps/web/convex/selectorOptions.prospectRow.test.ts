/**
 * NEO-591 — the two card shapes built from a "Prospect (X)" checklist row
 * (`checklistOnlyCard`, `checklistPairedRow`). X is the card's printed team
 * (Jason, 2026-11-19): it is in the row's `teams`, answered by the checklist
 * like any other team, and the card is born a prospect.
 */
import { describe, expect, test } from "vitest";
import { applyChecklistRow } from "../lib/checklists/apply-published-row";
import { checklistClaimText } from "../lib/checklists/prospect-team-text";
import { checklistOnlyCard, checklistPairedRow } from "./selectorOptions";

const row = (extra: Record<string, unknown>) => ({
  number: "NNO",
  players: ["Cord Rager"],
  teams: [] as string[],
  ...extra,
});
const sooners = (t: string): string | null => (t === "Oklahoma" ? "Oklahoma Sooners" : null);

describe("checklistOnlyCard — Prospect", () => {
  test("X is the card's team, answered by the checklist, born a prospect", () => {
    const card = checklistOnlyCard(row({ prospect: true, teams: ["Oklahoma"] }), () => null, sooners);
    expect(card).toMatchObject({ teams: ["Oklahoma Sooners"], teamLookup: "checklist", isProspect: true });
  });

  test("an X no team answers to stays as printed, so the Names gate can ask", () => {
    const card = checklistOnlyCard(row({ prospect: true, teams: ["Dallas Baptist"] }), () => null, sooners);
    expect(card).toMatchObject({ teams: ["Dallas Baptist"], teamLookup: "checklist", isProspect: true });
  });

  test("a bare Prospect is a No Team answer and a prospect", () => {
    const card = checklistOnlyCard(row({ prospect: true, noTeam: true }), () => null);
    expect(card).toMatchObject({ teams: [], teamLookup: "checklist", isProspect: true });
  });

  test("a row that is not a prospect carries no prospect flag", () => {
    const card = checklistOnlyCard(row({ teams: ["Boston Red Sox"] }), () => null);
    expect(card.isProspect).toBeUndefined();
  });
});

describe("checklistPairedRow — Prospect", () => {
  test("X is in teams with the prospect flag", () => {
    const paired = checklistPairedRow(row({ prospect: true, teams: ["Oklahoma"] }), () => null, sooners);
    expect(paired).toMatchObject({ teams: ["Oklahoma Sooners"], prospect: true });
  });

  test("unlink then relink: the row sent again reproduces the answer", () => {
    const original = row({ prospect: true, teams: ["Boston Red Sox", "Oklahoma"] });
    const first = applyChecklistRow({}, original, () => null, sooners);
    const paired = checklistPairedRow(original, () => null, sooners);
    const second = applyChecklistRow(
      {},
      { players: paired.players, teams: paired.teams, ...(paired.prospect ? { prospect: true } : {}) },
      () => null,
      sooners,
    );
    expect(second).toEqual(first);
  });

  test("a bare Prospect is a No Team row that is also a prospect", () => {
    const paired = checklistPairedRow(row({ prospect: true, noTeam: true }), () => null);
    expect(paired).toMatchObject({ teams: [], noTeam: true, prospect: true });
    expect(paired.claim).toBeUndefined();
  });

  test("a resolved X carries the printed claim, so Match Cards reads Prospect (Oklahoma), not the full name", () => {
    const paired = checklistPairedRow(row({ prospect: true, teams: ["Oklahoma"] }), () => null, sooners);
    expect(paired.claim).toBe("Prospect (Oklahoma)");
    expect(checklistClaimText({ teams: ["Oklahoma"], prospect: true })).toBe("Prospect (Oklahoma)");
  });

  test("a row whose claim the paired row already reads the same way carries none", () => {
    const paired = checklistPairedRow(row({ teams: ["Boston Red Sox"] }), (t) => [t]);
    expect(paired.claim).toBeUndefined();
  });
});
