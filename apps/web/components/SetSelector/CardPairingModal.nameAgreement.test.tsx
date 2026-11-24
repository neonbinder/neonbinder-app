/**
 * NEO-591 — Match Cards and the server ask ONE question when they decide that
 * a checklist names a card differently (`playersAgree`). The same table
 * (`lib/checklists/players-agree.cases.ts`) is held to both callers: the
 * dialog shows a name picker exactly when the server reports a players
 * disagreement, hand-linked or server-paired.
 */

import { describe, expect, test, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import CardPairingModal, { type PairingCard } from "./CardPairingModal";
import type { ChecklistPairRequest } from "./checklist-match-apply";
import { compareChecklistRow } from "@/lib/checklists/match-published-checklist";
import { NAME_AGREEMENT_CASES } from "@/lib/checklists/players-agree.cases";

const bscCard = (name: string, players: string[]): PairingCard => ({
  cardNumber: "27b",
  cardName: name,
  players,
  platformData: { bsc: { ref: "bsc-27b", setId: "set-1" } },
  unmatched: "sl",
});

const rowCard = (name: string, players: string[]): PairingCard => ({
  cardNumber: "27b",
  cardName: name,
  players,
  platformData: {},
  checklistRowId: "row-0",
});

const nameGroups = () => screen.queryAllByRole("group", { name: /^Name conflict on / });

function mountHandLink(card: string[], row: string[]) {
  const onConfirm = vi.fn().mockResolvedValue(undefined);
  render(
    <CardPairingModal
      isOpen
      onClose={vi.fn()}
      onConfirm={onConfirm}
      sources={["bsc", "sportlots", "checklist"]}
      resolveChecklistPairs={async (pairs: ChecklistPairRequest[]) =>
        pairs.map((p) => {
          const { conflict } = compareChecklistRow({ players: p.card.players }, { players: p.row.players, teams: [] });
          return { cardKey: p.cardKey, ...(conflict ? { checklistConflict: conflict } : {}) };
        })
      }
      initialData={{
        autoMatched: [],
        unmatchedBsc: [bscCard(card.join(" / "), card)],
        unmatchedSl: [],
        checklistOnly: [rowCard(row.join(" / "), row)],
      }}
    />,
  );
  fireEvent.click(screen.getByLabelText(/^Select #27b /));
  fireEvent.click(screen.getByLabelText(/^Link selected checklist row to #27b /));
  fireEvent.click(screen.queryByLabelText(/^Expand matched cards/) ?? document.body);
  return { onConfirm };
}

function mountServerPair(card: string[], row: string[]) {
  const { conflict } = compareChecklistRow({ players: card }, { players: row, teams: [] });
  const paired: PairingCard = {
    ...bscCard(card.join(" / "), card),
    checklistLink: {
      via: "playerFuzzy",
      confidence: 0.9,
      row: { number: "27b", players: row, teams: [], cardName: row.join(" / ") },
      revert: { teamsFromRow: false },
    },
    ...(conflict ? { checklistConflict: conflict } : {}),
  };
  render(
    <CardPairingModal
      isOpen
      onClose={vi.fn()}
      onConfirm={vi.fn()}
      sources={["bsc", "sportlots", "checklist"]}
      initialData={{ autoMatched: [], unmatchedBsc: [paired], unmatchedSl: [], checklistOnly: [] }}
    />,
  );
  fireEvent.click(screen.queryByLabelText(/^Expand matched cards/) ?? document.body);
}

describe("the dialog and the server agree on what a name difference is", () => {
  test.each(NAME_AGREEMENT_CASES)("hand link, $label", ({ card, row, agree }) => {
    mountHandLink(card, row);
    expect(nameGroups().length === 0).toBe(agree);
    // Nothing warned about, and the wizard would ask nothing either.
    expect(
      compareChecklistRow({ players: card }, { players: row, teams: [] }).conflict?.players === undefined,
    ).toBe(agree);
  });

  test.each(NAME_AGREEMENT_CASES)("server pair, $label", ({ card, row, agree }) => {
    mountServerPair(card, row);
    expect(nameGroups().length === 0).toBe(agree);
  });

  test("Leaf Pete Rose #27b: 'Old Teammates SP' against 'Old Teammates' warns nothing", async () => {
    const { onConfirm } = mountHandLink(["Old Teammates SP"], ["Old Teammates"]);
    expect(nameGroups()).toHaveLength(0);
    expect(screen.queryByText(/Potential names for this card/)).toBeNull();
    expect(screen.queryByText(/with a name conflict/)).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Confirm card matches"));
    });
    const [saved] = onConfirm.mock.calls[0][0].cards;
    expect(saved.cardName).toBe("Old Teammates SP");
    expect(saved.checklistConflict).toBeUndefined();
  });

  test("a surname only and a swapped order show no picker; Dax against Max still shows one", () => {
    mountHandLink(["Pete Rose", "Johnny Bench"], ["Bench", "Rose"]);
    expect(nameGroups()).toHaveLength(0);
  });

  test("Dax against Max still shows its one warned picker", () => {
    mountHandLink(["Dax Kilby"], ["Max Kilby"]);
    expect(nameGroups()).toHaveLength(1);
    expect(screen.getByText(/Potential names for this card/)).toBeTruthy();
    expect(screen.getByRole("radio", { name: /^Max Kilby · your checklist — use this name for / })).toBeTruthy();
  });
});
