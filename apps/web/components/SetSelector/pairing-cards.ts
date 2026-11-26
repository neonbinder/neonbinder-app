/**
 * NEO-255 — one streamed candidate → one `PairingCard`, in exactly one place.
 *
 * This mapping used to live inside `CardChecklist`'s `streamedPairing` memo as
 * a closure called `toCard`, which was fine while the pairing dialog was the
 * only thing that ever built a `PairingCard`. It is not any more: a set with
 * exactly ONE marketplace attached has nothing to line up, so the dialog never
 * mounts and the client commits every fetched card itself, as a kept single.
 *
 * Two paths building the same card from the same row is precisely the shape
 * that drifts — NEO-199's `nameConflict` and NEO-251's `playersConflict` were
 * each added to one mapping and had to be chased into the other, and a field
 * missed here is a field the operator never sees and the sync-review diff is
 * never told about. So the mapping is one exported function, used by both, and
 * the auto-keep path cannot silently build a thinner card than the dialog does.
 */

import type { PairingCard } from "./CardPairingModal";
import { committable, type SourceNumbers } from "./checklist-match-apply";
import type { ChecklistConflict } from "./checklist-conflict";

/**
 * NEO-335 — how the fetch-time BSC team lookup for a card ended:
 * "answered" (BSC replied, with a team or with none on file) or "failed" (the
 * call failed); NEO-478 adds "checklist" (the operator's published checklist
 * named the team, a data claim). Absent when no lookup ran. The commit stamps an answered
 * teamless card as checked instead of asking BSC again after save; see
 * `previewCardFields.teamLookup` in convex/selectorOptions.ts.
 */
export type TeamLookup = NonNullable<PairingCard["teamLookup"]>;

/**
 * The half of `checklistCandidates.getReadyCandidates`' card shape this
 * mapping reads.
 *
 * Structural rather than imported from the generated API: the query returns
 * more than this (`_id`, `stem`, `teamResolved`, `confidence`), and naming only
 * what is consumed keeps the helper — and its unit test — free of Convex.
 */
export type ReadyCandidate = {
  /** NEO-496 — the candidate row's id; keys a checklist-only row (no ref). */
  _id?: string;
  cardNumber: string;
  cardName: string;
  teams?: string[];
  players?: string[];
  attributes?: string[];
  isRookie?: boolean;
  isRelic?: boolean;
  /** NEO-591 — the checklist's Prospect claim; see `PairingCard.isProspect`. */
  isProspect?: boolean;
  /** NEO-591 — the row's team cell as printed; see `PairingCard.teamCell`. */
  teamCell?: string;
  printRun?: number;
  autographType?: string;
  cardVariation?: string;
  isVariation?: boolean;
  platformData: {
    bsc?: { ref: string; setId?: string };
    sportlots?: { ref: string; setId?: string };
  };
  nameConflict?: { bsc: string; sportlots: string };
  playersConflict?: {
    bsc: string[];
    sportlots: string[];
    preferred?: "bsc" | "sportlots";
  };
  bucket: "matched" | "bscOnly" | "slOnly" | "checklistOnly";
  /**
   * NEO-591 — the numbers each source printed, present only when they differ;
   * see `PairingCard.sourceNumbers`. `cardNumber` is already the chosen one.
   */
  sourceNumbers?: SourceNumbers;
  /**
   * NEO-591 (variations) — NB created this card (a variation); it opens in
   * Keeping. See `PairingCard.preKept`.
   */
  preKept?: true;
  /**
   * NEO-591 — the number was derived by the sync, not printed by a marketplace
   * for this card. The commit uses it; see `PairingCard.numberMinted`.
   */
  numberMinted?: true;
  /** NEO-591 (variations) — see `PairingCard.variationGroup`. */
  variationGroup?: string;
  /** NEO-496 — the server paired this card with a publisher checklist row. */
  checklistLink?: PairingCard["checklistLink"];
  teamLookup?: TeamLookup;
  /** NEO-335 — BSC's unsplit team value; see `PairingCard.rawTeamName`. */
  rawTeamName?: string;
  /** NEO-478 — the published checklist disagrees; see `PairingCard.checklistConflict`. */
  checklistConflict?: ChecklistConflict;
  /**
   * NEO-640 — which lookup paired a matched row's two marketplace halves;
   * missing on a matched row = written before NEO-640.
   */
  pairedBy?: "stored" | "crossRef" | "variation" | "number" | "name";
};

/**
 * One candidate as the pairing dialog sees it.
 *
 * `unmatched` is the bucket read from the other end: a card only BSC listed is
 * missing its SportLots half (`"sl"`), and vice versa. A matched pair is
 * missing nothing and carries no marker at all. That is the same value
 * `commitCardChecklist` writes its `unmatched-<side>` attribute from, so the
 * badge on a kept single is decided here.
 */
export function candidateToPairingCard(
  c: ReadyCandidate,
): PairingCard {
  return {
    cardNumber: c.cardNumber,
    cardName: c.cardName,
    teams: c.teams,
    players: c.players,
    attributes: c.attributes,
    isRookie: c.isRookie,
    isRelic: c.isRelic,
    printRun: c.printRun,
    autographType: c.autographType,
    cardVariation: c.cardVariation,
    // NEO-189: without this the modal commits every variation as a standalone
    // card — the flag has to survive the whole path.
    isVariation: c.isVariation,
    platformData: c.platformData,
    // NEO-199: the losing name from a server-side merge. Absent on every row
    // the two marketplaces agree about, which is nearly all of them; where it
    // is present the modal raises the same choice a hand-linked conflict gets.
    nameConflict: c.nameConflict,
    // NEO-251: and the losing ROSTER, on exactly the same terms.
    playersConflict: c.playersConflict,
    unmatched:
      c.bucket === "bscOnly" ? "sl" : c.bucket === "slOnly" ? "bsc" : undefined,
    // NEO-335: spread only when present, so a card with no lookup is
    // byte-identical to what this mapping built before the field existed.
    ...(c.teamLookup ? { teamLookup: c.teamLookup } : {}),
    // NEO-335: BSC's raw team value, only on the rows the server kept one for
    // (a split or refused split). Spread on the same terms as `teamLookup`.
    ...(c.rawTeamName ? { rawTeamName: c.rawTeamName } : {}),
    // NEO-591: the checklist's Prospect claim, spread only when present so
    // every other card is byte-identical to what it was.
    ...(c.isProspect ? { isProspect: true } : {}),
    ...(c.teamCell ? { teamCell: c.teamCell } : {}),
    // NEO-478: the checklist's disagreement, on the same terms. It is NOT a
    // cross-marketplace question, so the dialog carries it through untouched
    // and the wizard's "Checklist says otherwise" step settles it.
    ...(c.checklistConflict ? { checklistConflict: c.checklistConflict } : {}),
    // NEO-496: how the card paired with the publisher's checklist (the
    // dialog's "On checklist" chip), and, on a checklist-only row, the id the
    // dialog tells re-deliveries apart by. Both wire-only: `committable`
    // takes them off before anything is saved.
    ...(c.checklistLink ? { checklistLink: c.checklistLink } : {}),
    // NEO-591: rides to the commit (NEO-645: stored on the new row for the
    // walk's "Numbers didn't match" note); `committable` keeps it.
    ...(c.sourceNumbers ? { sourceNumbers: c.sourceNumbers } : {}),
    ...(c.preKept ? { preKept: true as const } : {}),
    // NEO-591: both ride to the commit, which uses them (it never matches a
    // stored card by a minted number, and links a variation group by its
    // token). `committable` keeps them.
    ...(c.numberMinted ? { numberMinted: true as const } : {}),
    ...(c.variationGroup ? { variationGroup: c.variationGroup } : {}),
    ...(c.bucket === "checklistOnly" && c._id ? { checklistRowId: c._id } : {}),
  };
}

/**
 * NEO-255 — the candidates as COMMITTABLE cards: what the dialog's Confirm
 * would hand back on a set where every row is a kept single.
 *
 * The two disagreement fields are dropped, and that is not a shortcut — it is
 * the same lift `CardPairingModal` performs. `seedMatched` moves a conflict off
 * the card and onto the PAIR the moment it arrives, so a card reaching
 * `onConfirm` never carries one, and `commitCardChecklist` THROWS on a card
 * that still does. A single has no second marketplace to disagree with, so on
 * this path there is nothing to lift and nothing to ask; going through the same
 * mapping and then dropping the fields keeps that a stated property rather than
 * an assumption about which buckets can appear.
 *
 * NEO-478: `checklistConflict` is NOT dropped. It is not a disagreement
 * between two marketplaces but between the operator's published checklist and
 * the card, and a single can carry one as readily as a pair. It rides on to
 * the wizard, whose "Checklist says otherwise" step settles it before the
 * commit (which refuses a card still carrying one).
 */
export function candidatesToPairingCards(
  candidates: readonly ReadyCandidate[],
): PairingCard[] {
  return candidates.map((c) => {
    const card = committable(candidateToPairingCard(c));
    delete card.nameConflict;
    delete card.playersConflict;
    return card;
  });
}
