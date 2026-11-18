import { describe, expect, test } from "vitest";
import { compareChecklistRow, playersAgree } from "./match-published-checklist";
import { NAME_AGREEMENT_CASES } from "./players-agree.cases";

// The server's side of the one table. The dialog's side is
// `components/SetSelector/CardPairingModal.nameAgreement.test.tsx`.
describe("the name-agreement table, server side", () => {
  test.each(NAME_AGREEMENT_CASES)("$label", ({ card, row, agree }) => {
    expect(playersAgree(card, row)).toBe(agree);
    const { conflict } = compareChecklistRow({ players: card }, { players: row, teams: [] });
    expect(conflict?.players === undefined).toBe(agree);
  });
});
