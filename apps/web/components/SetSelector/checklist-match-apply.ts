/**
 * NEO-490 — the operator's checklist links in Match Cards, as pure functions.
 *
 * When the publisher's checklist could not be paired to the fetched cards on
 * the server (its numbers differ and the names left ties, or the two lists
 * are different lengths), the leftover rows show up in Match Cards as a third
 * source, and the operator links each row to its card by hand. Nothing is
 * worked out here about what a link MEANS: the server answers that, through
 * the same helper its own number pairs use (`applyPublishedChecklistPairs`),
 * so a hand link and an automatic pair stamp a card identically. This module
 * only builds the question and folds the answer back onto the cards.
 *
 * Kept out of `CardPairingModal.tsx` so the dialog stays Convex-free and the
 * merge can be tested without rendering it.
 *
 * What a link never does: touch `platformData`, or write a row anywhere. An
 * unlinked row is dropped at Confirm unless the operator kept it (NEO-496).
 *
 * NEO-591 (names first, numbers confirm): a link may change the card's NUMBER.
 * The card takes the more specific of its own and the row's
 * (`preferCardNumber`: letters over digits over none, its own on a tie), and
 * when the two disagree both are kept on `sourceNumbers` for the dialog's
 * "Numbers differ" note. Nothing here renumbers an NB card that already
 * exists: these are fetched cards, not saved ones.
 *
 * NEO-496: the rows now reach the dialog as `checklistOnly` candidates, so a
 * stored checklist (whose rows the client never holds) and a pasted one are
 * linked the same way; `checklistRowOf` in the dialog turns one back into a
 * `ChecklistLinkRow` for the question.
 */

import { cardNumbersAgree, preferCardNumber } from "../../lib/cards/card-number";
import type { ChecklistConflict, TeamLookupOutcome } from "./checklist-conflict";
import type { PairingCard } from "./CardPairingModal";

/**
 * NEO-496 — a card as Match Cards hands it on: the wire-only fields the dialog
 * reads (`checklistLink`, the server's checklist pairing; `checklistRowId`, a
 * checklist-only row's candidate id) taken off, because entity resolution and
 * the commit validate cards strictly and refuse a field they do not know. A
 * card carrying neither is returned by reference. Used by the dialog's
 * Confirm and by the one-source auto-keep path, so both hand on the same card.
 */
export function committable<C extends PairingCard>(card: C): C {
  if (
    card.checklistLink === undefined &&
    card.checklistRowId === undefined &&
    card.sourceNumbers === undefined &&
    card.preKept === undefined
  ) {
    return card;
  }
  const out: C = { ...card };
  delete out.checklistLink;
  delete out.checklistRowId;
  // NEO-591: the numbers each source printed are for the dialog's note only;
  // the commit's validators refuse a field they do not know and save the one
  // number the card carries.
  delete out.sourceNumbers;
  // NEO-591 (variations): where the card started (already in Keeping) is the
  // dialog's own business.
  delete out.preKept;
  return out;
}

/**
 * NEO-591 — the number each source printed for a card the sources paired by
 * name while their numbers differ. A key is present only when that source is
 * in the pair. Wire shape: `sourceNumbersValidator` in `convex/schema.ts`.
 */
export type SourceNumbers = { bsc?: string; sportlots?: string; checklist?: string };

/**
 * NEO-591 — `sourceNumbers` with the checklist's number taken off (an Unlink
 * drops the row). `undefined` once the numbers left no longer differ in text:
 * with nothing to choose between there is no picker to show.
 */
export function withoutChecklistNumber(
  numbers: SourceNumbers | undefined,
): SourceNumbers | undefined {
  if (!numbers) return undefined;
  const rest: SourceNumbers = { ...numbers };
  delete rest.checklist;
  return numbersDifferInText(rest) ? rest : undefined;
}

/**
 * NEO-591 — the distinct numbers the sources printed, trimmed, in the order
 * BSC, SportLots, checklist: one choice each in the number picker. Spellings
 * that differ only in case ("38A" and "38a") are one number; the first
 * spelling is the one kept.
 */
export function distinctNumbers(numbers: SourceNumbers): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const n of [numbers.bsc, numbers.sportlots, numbers.checklist]) {
    const t = n?.trim();
    if (t === undefined) continue;
    const folded = t.toLowerCase();
    if (seen.has(folded)) continue;
    seen.add(folded);
    out.push(t);
  }
  return out;
}

/**
 * NEO-591 — do the sources print the number differently in text? True for
 * "38" against "38a" or "BCP-12" against "12" (which `numbersDiffer` calls
 * agreeing): the operator may still want the other one, so the picker shows.
 */
export function numbersDifferInText(numbers: SourceNumbers): boolean {
  return distinctNumbers(numbers).length > 1;
}

/**
 * NEO-591 — the number the rule picks from what the sources printed: letters
 * over digits over none, the earlier source (BSC, SportLots, checklist) on a
 * tie. The picker's preselected choice.
 */
export function pickedNumber(numbers: SourceNumbers): string {
  const [first, ...rest] = distinctNumbers(numbers);
  return rest.reduce((pick, n) => preferCardNumber(pick, n), first ?? "");
}

/** A card's own number under the marketplace(s) it came from. */
export function ownSourceNumbers(card: {
  cardNumber: string;
  platformData?: { bsc?: unknown; sportlots?: unknown };
}): SourceNumbers {
  const own: SourceNumbers = {
    ...(card.platformData?.bsc ? { bsc: card.cardNumber } : {}),
    ...(card.platformData?.sportlots ? { sportlots: card.cardNumber } : {}),
  };
  return Object.keys(own).length > 0 ? own : { bsc: card.cardNumber };
}

/** Do any two of the numbers disagree (`cardNumbersAgree`)? */
export function numbersDiffer(numbers: SourceNumbers): boolean {
  const printed = Object.values(numbers).filter((n): n is string => n !== undefined);
  return printed.some((n, i) => printed.slice(i + 1).some((m) => !cardNumbersAgree(n, m)));
}

/** One row of the uploaded checklist, as the dialog lists it. */
export type ChecklistLinkRow = {
  number: string;
  players: readonly string[];
  teams: readonly string[];
  noNumber?: true;
  /** NEO-489 — the checklist says this card shows no team ("No Team"). */
  noTeam?: true;
  /** NEO-591 — the team cell said "Prospect" / "Prospect (X)": the card is a prospect (its X is in `teams`). */
  prospect?: true;
  /**
   * The row's team cell as the checklist printed it ("Prospect (Oklahoma)"),
   * for display only, present when `teams` does not already read that way (a
   * resolved team is in `teams` as its full name). `checklistRowLine` prints it.
   */
  claim?: string;
  /**
   * NEO-591 (variations) — the checklist's own note for a variation row
   * ("Photo variation"). Rides the row through an Unlink and a relink so the
   * variation card made from it keeps its name.
   */
  variationName?: string;
};

/** What a linked card needs to carry into the question. */
export type ChecklistLinkCard = {
  cardNumber: string;
  players?: readonly string[];
  teams?: readonly string[];
};

/**
 * One operator link, as the server is asked about it: the card's CURRENT
 * players and teams (after any edit made in the dialog) beside the row.
 */
export type ChecklistPairRequest = {
  /** The card's `candidateKey` in the dialog; the answer comes back keyed by it. */
  cardKey: string;
  card: { cardNumber: string; players: string[]; teams: string[] };
  row: {
    number: string;
    players: string[];
    teams: string[];
    noNumber?: true;
    noTeam?: true;
    prospect?: true;
    variationName?: string;
  };
};

/**
 * The server's answer for one link.
 *
 *  - `teams` + `teamLookup: "checklist"` — the row settles the card's team;
 *    the card carries the row's (resolved) teams and skips the BSC lookup's
 *    answer. `teams: []` with `teamLookup: "checklist"` is the checklist's
 *    "No Team" (NEO-489): the card carries no team and is never looked up
 *    or guessed (`checklistClaimsNoTeam`).
 *  - `checklistConflict` — the row and the card disagree about players or
 *    teams. The card keeps its own values; the wizard's "Checklist says
 *    otherwise" step settles it.
 *  - `fillPlayers` — the card had no players and the row names some.
 *  - NEO-591: `isProspect` — the row says Prospect, whatever became of the
 *    team (its X, if any, is a team like any other and rides in `teams`).
 *
 * Any of these can be absent: a row naming no team makes no claim about it.
 */
export type ChecklistPairAnswer = {
  cardKey: string;
  teams?: string[];
  teamLookup?: "checklist";
  checklistConflict?: ChecklistConflict;
  fillPlayers?: string[];
  isProspect?: true;
};

/** The fields of a card a checklist answer may change. */
type AnswerableCard = ChecklistLinkCard & {
  /** NEO-591: which marketplaces the card is on, to label its own number. */
  platformData?: { bsc?: unknown; sportlots?: unknown };
  sourceNumbers?: SourceNumbers;
  teamLookup?: TeamLookupOutcome;
  checklistConflict?: ChecklistConflict;
  rawTeamName?: string;
  /** NEO-591: the number was swapped in, not printed by a marketplace. */
  numberMinted?: true;
  isProspect?: boolean;
};

function clean(names: readonly string[] | undefined): string[] {
  return (names ?? []).map((n) => n.trim()).filter(Boolean);
}

/**
 * The question for every link that still lands on a card being saved.
 *
 * A link whose card is not in `cards` (it was discarded) or whose row index
 * is out of range is left out: it has nothing to say about a saved card.
 * In `cards` order, so the request is stable for a given screen.
 */
export function buildChecklistPairRequests<C extends ChecklistLinkCard>(
  cards: readonly C[],
  links: ReadonlyMap<string, number>,
  rows: readonly ChecklistLinkRow[],
  keyOf: (card: C) => string,
): ChecklistPairRequest[] {
  const out: ChecklistPairRequest[] = [];
  for (const card of cards) {
    const cardKey = keyOf(card);
    const rowIndex = links.get(cardKey);
    if (rowIndex === undefined) continue;
    const row = rows[rowIndex];
    if (!row) continue;
    out.push({
      cardKey,
      card: {
        cardNumber: card.cardNumber,
        players: clean(card.players),
        teams: clean(card.teams),
      },
      row: {
        number: row.number,
        players: clean(row.players),
        teams: clean(row.teams),
        ...(row.noNumber ? { noNumber: true as const } : {}),
        // NEO-489: a "No Team" row is a claim; dropping the flag would turn
        // it into a row that names no team, which claims nothing.
        ...(row.noTeam ? { noTeam: true as const } : {}),
        // NEO-591: and so is a Prospect row. Without this the server would
        // read a row that is only a prospect as one that claims nothing, and
        // the relink would lose the claim.
        ...(row.prospect ? { prospect: true as const } : {}),
        // NEO-591 (variations): the row's note survives a relink.
        ...(row.variationName ? { variationName: row.variationName } : {}),
      },
    });
  }
  return out;
}

/**
 * Fold the server's answers onto the cards, the way step 3c of the fetch
 * stamps a number pair:
 *
 *  - players fill only a card that has none;
 *  - a disagreement rides on the card as `checklistConflict` and the card's
 *    own values stay;
 *  - a settled team replaces the card's teams and marks it
 *    `teamLookup: "checklist"`. BSC's raw team text goes with it: it was the
 *    hint for a card that might save with no team, and this one has one —
 *    or the checklist said "No Team" (an empty `teams`, NEO-489), a claim
 *    that holds back any guess from that hint.
 *
 *  - NEO-591: a Prospect row marks the card `isProspect`, whatever became of
 *    the team (a conflict included).
 *
 *  - NEO-591: when `rowNumbers` gives the linked row's number (by card key),
 *    the card takes `preferCardNumber(card, row)` and, if the two disagree,
 *    keeps every source's number on `sourceNumbers` (its own under the
 *    marketplace it came from, the row's under `checklist`).
 *
 *    `numberPicks` (cardKey to the number the operator picked in the dialog)
 *    wins over the rule when it is one of the numbers printed.
 *
 * Returns a new array; a card with no answer is returned by reference.
 * `platformData` is never touched.
 */
export function applyChecklistAnswers<C extends AnswerableCard>(
  cards: readonly C[],
  answers: readonly ChecklistPairAnswer[],
  keyOf: (card: C) => string,
  rowNumbers?: ReadonlyMap<string, string>,
  numberPicks?: ReadonlyMap<string, string>,
): C[] {
  const byKey = new Map<string, ChecklistPairAnswer>();
  for (const a of answers) byKey.set(a.cardKey, a);
  if (byKey.size === 0) return [...cards];
  return cards.map((card) => {
    const answer = byKey.get(keyOf(card));
    if (!answer) return card;
    const next: C = { ...card };
    // Written through the base shape: these are the fields this module owns.
    const out: AnswerableCard = next;
    const fill = clean(answer.fillPlayers);
    if (fill.length > 0 && clean(card.players).length === 0) {
      out.players = fill;
    }
    if (answer.checklistConflict) {
      out.checklistConflict = answer.checklistConflict;
    }
    const rowNumber = rowNumbers?.get(keyOf(card));
    if (rowNumber !== undefined) {
      const own = card.cardNumber;
      const printed: SourceNumbers = {
        ...(card.sourceNumbers ?? ownSourceNumbers(card)),
        checklist: rowNumber,
      };
      if (numbersDifferInText(printed)) out.sourceNumbers = printed;
      const pick = numberPicks?.get(keyOf(card))?.trim();
      out.cardNumber =
        pick !== undefined && distinctNumbers(printed).includes(pick)
          ? pick
          : preferCardNumber(own, rowNumber);
      // A number swapped in from the row is not one a marketplace printed for
      // this card; the commit must not match a stored card by it.
      if (out.cardNumber !== own) out.numberMinted = true;
    }
    if (answer.isProspect) out.isProspect = true;
    const teams = clean(answer.teams);
    // NEO-489: an empty `teams` is the checklist's "No Team" claim, applied
    // only to a card with no team of its own (the server answers a card that
    // has one with a conflict instead), so this fold never wipes a team. An
    // answer with no `teams` at all settles nothing.
    const noTeamClaim =
      teams.length === 0 && answer.teams !== undefined && clean(card.teams).length === 0;
    if (
      answer.teamLookup === "checklist" &&
      (teams.length > 0 || noTeamClaim) &&
      !answer.checklistConflict?.teams
    ) {
      out.teams = teams;
      out.teamLookup = "checklist";
      delete out.rawTeamName;
    }
    return next;
  });
}

/**
 * NEO-496 — the publisher row the server paired a fetched card with, as
 * `checklistCandidates.checklistLink.row` carries it
 * (`checklistPairedRowValidator`): the row as Match Cards lists one, plus the
 * name it has as a card of its own.
 */
export type ServerPairedRow = {
  number: string;
  players: string[];
  teams: string[];
  noNumber?: true;
  noTeam?: true;
  prospect?: true;
  /** See `ChecklistLinkRow.claim`. */
  claim?: string;
  /** See `ChecklistLinkRow.variationName`. */
  variationName?: string;
  cardName: string;
};

/**
 * NEO-496 — the card as it was before the server applied its paired row
 * (`checklistPairRevertValidator`). See that validator for each field.
 */
export type ServerPairRevert = {
  players?: string[];
  teamsFromRow: boolean;
  teams?: string[];
  teamLookup?: "failed";
  /** NEO-591: the card's number before the row (present only if the pair changed it). */
  cardNumber?: string;
};

type ServerLinkedCard = PairingCard & {
  checklistLink: NonNullable<PairingCard["checklistLink"]> & {
    row: ServerPairedRow;
    revert: ServerPairRevert;
  };
};

/**
 * NEO-496 — can the operator undo this card's server pairing? Only when the
 * link carries both the row (to list again) and the revert (to put the card
 * back). A pair stored before those existed cannot be undone here: nothing
 * says what the card was before the row, and guessing would be rule 8's
 * guess.
 */
export function unlinkableServerPair(card: PairingCard): card is ServerLinkedCard {
  return !!card.checklistLink?.row && !!card.checklistLink.revert;
}

/** The paired row as the dialog lists a row (`ChecklistLinkRow`). */
export function pairedRowOf(row: ServerPairedRow): ChecklistLinkRow {
  return {
    number: row.number,
    players: [...row.players],
    teams: [...row.teams],
    ...(row.noNumber ? { noNumber: true as const } : {}),
    ...(row.noTeam ? { noTeam: true as const } : {}),
    ...(row.prospect ? { prospect: true as const } : {}),
    ...(row.claim ? { claim: row.claim } : {}),
    ...(row.variationName ? { variationName: row.variationName } : {}),
  };
}

/**
 * Prefix of the `checklistRowId` an unlinked row is listed under. It never
 * came from the stream, so it must not collide with a streamed candidate's
 * id (`ABSORB` tells re-delivered rows apart by it); wire-only like every
 * `checklistRowId`, so `committable` takes it off.
 */
export const UNLINKED_ROW_ID_PREFIX = "unlinked:";

/**
 * The paired row as a checklist-only card: exactly what the fetch publishes
 * for a row no card paired (`checklistOnlyCard` on the server). Its team is
 * the checklist's answer (`teamLookup: "checklist"`) when the row names one
 * or says No Team; a row naming no team makes no claim.
 *
 * NEO-591: a Prospect row is `isProspect`; its X is one of `teams`.
 */
export function pairedRowCard(row: ServerPairedRow, rowId: string): PairingCard {
  const claimsTeam = row.teams.length > 0 || row.noTeam === true;
  return {
    cardNumber: row.number,
    cardName: row.cardName,
    ...(row.players.length > 0 ? { players: [...row.players] } : {}),
    ...(claimsTeam ? { teams: [...row.teams], teamLookup: "checklist" as const } : {}),
    ...(row.prospect ? { isProspect: true } : {}),
    platformData: {},
    checklistRowId: rowId,
  };
}

/**
 * NEO-496 — the card with its server pairing undone: no link, no checklist
 * disagreement (it was with the row), and the players and teams it had
 * before the row.
 *
 *  - players: `revert.players`; absent means the card had none (the row
 *    filled them), so it has none again.
 *  - teams: only when the row settled them (`teamsFromRow`). Then the card's
 *    own teams come back (absent: none) and so does its lookup outcome:
 *    `"failed"` when BSC was never asked because the row answered, which is
 *    the operator-picks state (rule 8: missing data is never guessed).
 *    Otherwise the teams were the card's own, or its lookup's, and stay.
 *  - NEO-591: the number goes back to `revert.cardNumber` (absent: the row did
 *    not change it), and the checklist's number leaves `sourceNumbers`.
 *  - NEO-591: the row's Prospect claim goes with it: no `isProspect`.
 *
 * Returns `null` for a card with no undoable pairing. The name and
 * `platformData` are never touched.
 */
export function revertServerChecklistPair<C extends PairingCard>(card: C): C | null {
  if (!unlinkableServerPair(card)) return null;
  const { revert } = card.checklistLink;
  const next: C = { ...card };
  // Written through the base shape: these are the fields an Unlink owns.
  const out: PairingCard = next;
  delete out.checklistLink;
  delete out.checklistConflict;
  delete out.isProspect;
  if (revert.cardNumber !== undefined) out.cardNumber = revert.cardNumber;
  const remaining = withoutChecklistNumber(out.sourceNumbers);
  if (remaining) out.sourceNumbers = remaining;
  else delete out.sourceNumbers;
  if (revert.players && revert.players.length > 0) out.players = [...revert.players];
  else delete out.players;
  if (revert.teamsFromRow) {
    if (revert.teams && revert.teams.length > 0) out.teams = [...revert.teams];
    else delete out.teams;
    if (revert.teamLookup) out.teamLookup = revert.teamLookup;
    else delete out.teamLookup;
  }
  return next;
}
