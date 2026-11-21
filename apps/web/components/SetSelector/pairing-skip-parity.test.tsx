/**
 * NEO-640 — the skip is only safe if it commits what Confirm would have.
 *
 * When every card is Matched at 100% (`matchCardsNeeded` is false) the run
 * hands `candidatesToPairingCards(live.cards)` and no conflicts to the commit
 * path itself. This pins that those cards are exactly what `CardPairingModal`
 * hands back when the same batch is rendered and Confirm is pressed, order
 * aside, so a field the dialog strips or adds cannot make the skipped run
 * save something a Confirmed run would not.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import CardPairingModal from "./CardPairingModal";
import { matchCardsNeeded, type FetchSource, type MatchCandidate } from "./match-cards-needed";
import { candidateToPairingCard, candidatesToPairingCards } from "./pairing-cards";

const pair = (
  n: string,
  player: string,
  over: Partial<MatchCandidate> = {},
): MatchCandidate => ({
  cardNumber: n,
  cardName: player,
  players: [player],
  teams: ["Cincinnati Reds"],
  bucket: "matched",
  confidence: 1,
  pairedBy: "number",
  teamLookup: "checklist",
  platformData: {
    bsc: { ref: `bsc-${n}`, setId: "2024-topps" },
    sportlots: { ref: `#${n} ${player}`, setId: "884412" },
  },
  checklistLink: { via: "number" },
  ...over,
});

/** A clean batch: three pairings, a printed attribute set, a team-only checklist question. */
const CLEAN: MatchCandidate[] = [
  pair("1", "Elly De La Cruz", { pairedBy: "stored", attributes: ["Rookie"], isRookie: true }),
  pair("2", "Hunter Greene", { pairedBy: "crossRef", printRun: 199 }),
  pair("3", "Spencer Steer", {
    pairedBy: "variation",
    cardVariation: "Photo Variation",
    isVariation: true,
    rawTeamName: "Reds",
  }),
  pair("4", "Tyler Stephenson", {
    checklistConflict: { teams: { marketplace: [], checklist: ["Reds"] } },
  }),
];
const SOURCES: FetchSource[] = ["bsc", "sportlots", "checklist"];

const byNumber = <T extends { cardNumber: string }>(cards: T[]) =>
  [...cards].sort((a, b) => a.cardNumber.localeCompare(b.cardNumber));

describe("the skip path commits what Match Cards' Confirm would (NEO-640)", () => {
  test("the batch under test is one the predicate skips", () => {
    // Without this the parity below would be vacuous: a batch that opens the
    // dialog is never committed by the skip.
    expect(matchCardsNeeded(CLEAN, SOURCES)).toBe(false);
  });

  test("the dialog's Confirm payload equals the skip path's cards, order aside, with no conflicts", async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(
      <CardPairingModal
        isOpen
        onClose={vi.fn()}
        onConfirm={onConfirm}
        initialData={{
          autoMatched: CLEAN.filter((c) => c.bucket === "matched").map((c) => ({
            card: candidateToPairingCard(c),
            confidence: c.confidence ?? 1,
          })),
          unmatchedBsc: [],
          unmatchedSl: [],
          checklistOnly: [],
        }}
      />,
    );

    fireEvent.click(screen.getByLabelText("Confirm card matches"));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));

    const { cards, conflictsByIndex } = onConfirm.mock.calls[0][0];
    expect(conflictsByIndex).toEqual({});
    expect(byNumber(cards)).toEqual(byNumber(candidatesToPairingCards(CLEAN)));
  });

  test("neither payload carries the wire-only fields the strict commit refuses", () => {
    for (const card of candidatesToPairingCards(CLEAN)) {
      expect(card).not.toHaveProperty("checklistLink");
      expect(card).not.toHaveProperty("checklistRowId");
      expect(card).not.toHaveProperty("pairedNumber");
      expect(card).not.toHaveProperty("nameConflict");
      expect(card).not.toHaveProperty("playersConflict");
    }
  });
});
