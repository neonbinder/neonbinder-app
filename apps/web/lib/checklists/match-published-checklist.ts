/**
 * PR 451 (NEO-478), rebuilt for NEO-591 — pair the operator's official
 * checklist with the cards a checklist fetch reconciled, names first and
 * numbers confirming (product rule 7, rewritten 2026-11-18).
 *
 * Pure: no Convex, no DOM. `fetchCardChecklist` runs it on the server; the
 * rows come from `parsePublishedChecklist` (same folder) on the client. The
 * pairing itself is `pairNamesFirst` (`lib/cards/pair-names-first.ts`), the
 * one core BuySportsCards-against-SportLots pairing shares; read its header
 * for the tiers. This file adapts rows and cards to it and reads the result
 * in this module's vocabulary.
 *
 * ## Names first
 *
 * A publisher numbers a set one way and a marketplace another ("OV-ANFI"
 * against the checklist's "NNO"), so a number cannot be the gate. A card and
 * a row pair when they name the same players and each side has exactly one
 * (the Onyx set: 56 lettered cards against 56 NNO rows now pair 56 of 56).
 * The numbers then only say whether they agree:
 *
 *  - names and numbers agree: `via` is "number" (as printed, case kept),
 *    "caseFolded" or "prefixStripped" ("BCP-12" against "12"); two
 *    no-number entries are "player";
 *  - names agree, numbers differ: `via: "playerName"`, with `confidence`
 *    0.9 and `checklistNumber` (the row's number as printed, "NNO" for a
 *    no-number row). The card keeps its own number;
 *  - a near name (Jaro-Winkler at `PLAYER_NAME_AUTO_LINK`, each side's one
 *    best): `via: "playerFuzzy"`, `confidence` the score (times 0.9 when the
 *    numbers differ), and `checklistNumber` when they differ.
 *
 * A player with several cards in the set is decided by the number inside
 * that group; when it cannot (a tie) every member stays unmatched (rule 8),
 * never given to the first candidate. A card whose players no row names pairs
 * by number alone, and only where that number is exactly one card and exactly
 * one row in the whole set: a number repeated on either side pins nothing
 * down, but it no longer stops an exactly-one NAME pairing (Jason,
 * 2026-11-18; D2 of 2026-11-10 is superseded).
 *
 * Numbers are compared as printed, case kept (NEO-489), then case-folded,
 * then letter-prefix stripped ("BCP-12", "US12", or the set's own prefix).
 * "38a" does not agree with "38".
 *
 * ## Disagreements are surfaced, never settled
 *
 *  - The players differ on both sides (both non-empty): `conflict.players`.
 *    Two lists of the same length agree when each checklist name is a
 *    marketplace name, or the end of one ("Alonso/Schwarber/Soto" against
 *    "Pete Alonso", "Kyle Schwarber", "Juan Soto"): checklists print surnames.
 *    That is a comparison only; nothing is written from it, and the card
 *    keeps the marketplace's full names (`playersAgree`). A pair made by
 *    number alone whose players conflict is the likely misread; it is paired
 *    and carries the conflict for the operator.
 *  - The card already carries a team (BSC's bulk parse, or SportLots) and the
 *    row names a different one: `conflict.teams`. A row that says "No Team"
 *    (`noTeam`) against a card with a team is a disagreement too, with an
 *    empty checklist side.
 *  - A card still unmatched whose players appear on a row at a DIFFERENT
 *    number is a likely misread (`misreads`): reported, never paired (a tie
 *    left it unmatched). The list holds at most `MAX_CHECKLIST_MISREADS`
 *    pairs (a player on many rows times many unmatched cards could otherwise
 *    reach millions); `misreadCount` is always the whole.
 *
 * The card keeps the marketplace's values; the conflict carries both sides
 * for the operator ("Checklist says otherwise").
 *
 * Where the card has no players and the row has some, the row's players fill
 * them in (`fillPlayers`): a fill, not a disagreement.
 *
 * ## Variations
 *
 * Both sides listing 38a / 38b pair each with its own. When only one side
 * lists the stem, that one stands for all of them:
 *
 *  - one row "38" against cards 38, 38b, 38c: 38 pairs 38 as usual, and the
 *    others are `via: "stem"` matches sharing the row's index; the same for a
 *    lettered base (cards 38a / 38b / 38c against row "38"). A stem-linked row
 *    is used, not in `unusedRowIndices`;
 *  - one card "38" against rows 38a / 38b: the card pairs with the row that
 *    matches its number exactly, else the single row numbered 38a (else it is
 *    a tie and nothing pairs). The other rows come back in `siblingRows` for
 *    the caller to create as variation cards of that card.
 *
 * Two cards or two rows sharing the stem on the ONE side is a tie, and a
 * stem never crosses players.
 *
 * ## Ties
 *
 * A player with several cards the numbers cannot settle, and a same-name pair
 * whose numbers are both plain digits and disagree (38 against 250: two cards,
 * not one card misnumbered), pair nothing. They are listed in
 * `tiedCardIndices` / `tiedRowIndices` so the caller can tell a tie from a
 * card that simply had no row. Different kinds of number still pair at 0.9
 * ("OV-ANFI" against NNO, "US12" against "12", 12 against NNO).
 *
 * A name pair never touches the card's number (the card keeps the number it
 * was fetched with) and is never a number conflict. Players and teams are
 * compared as for any pair.
 */

import { orderedEntityNameCompareKey } from "../entities/normalize-name";
import { dropTrailingMarkers } from "../cards/print-run-markers";
import { pairNamesFirst, type NamesFirstPair } from "../cards/pair-names-first";
import {
  cardNumbersAgree,
  exactChecklistNumber,
  isNoNumber,
  normalizeChecklistNumber,
  stripLetterPrefix,
} from "../cards/card-number";

// Born here, moved to `lib/cards/card-number.ts` (NEO-591); re-exported so
// every importer stays put.
export { exactChecklistNumber, isNoNumber, normalizeChecklistNumber, stripLetterPrefix };

export type ChecklistRowInput = {
  number: string;
  players: readonly string[];
  teams: readonly string[];
  /**
   * The checklist prints no number for this card ("NNO"). Such a row pairs
   * by player only (see the header). A row whose number is blank or "NNO"
   * counts as one whether or not the flag is set.
   */
  noNumber?: boolean;
  /**
   * The checklist says this card shows no team ("No Team"); `teams` is then
   * empty. Against a card that has a team it is a conflict (NEO-489).
   */
  noTeam?: boolean;
  /**
   * NEO-591 — the team cell said "Prospect" / "Prospect (X)": the card is a
   * prospect (its X, if any, is already in `teams`). Read by
   * `applyChecklistRow`; the matcher never keys on it.
   */
  prospect?: boolean;
};

export type ChecklistCardInput = {
  cardNumber: string;
  players?: readonly string[];
  teams?: readonly string[];
  /** A legacy single team, read only when `teams` is empty. */
  team?: string;
};

export type ChecklistConflictSides = { marketplace: string[]; checklist: string[] };
export type ChecklistConflict = {
  players?: ChecklistConflictSides;
  teams?: ChecklistConflictSides;
};

export type ChecklistCardMatch = {
  cardIndex: number;
  rowIndex: number;
  /**
   * How the pair was made, names first (NEO-591): the numbers agree as
   * printed (case kept), case-folded or letter-prefix stripped; both are no
   * number (`player`); the names agree and the numbers differ (`playerName`);
   * or a near first player (`playerFuzzy`). `stem` (variations): the row
   * stands for several cards that share its number's stem (row "38" for
   * cards 38b and 38c, or for a lettered base 38a / 38b / 38c); every such
   * card carries the same `rowIndex`. The card that matches the row's number
   * exactly is an ordinary pair.
   */
  via:
    | "number"
    | "caseFolded"
    | "prefixStripped"
    | "player"
    | "playerName"
    | "playerFuzzy"
    | "stem";
  /**
   * NEO-591 — set when the pair is less than certain: `playerName` is 0.9
   * (the names agree, the numbers do not); `playerFuzzy` is the Jaro-Winkler
   * score (0.92..1), times 0.9 when the numbers differ.
   */
  confidence?: number;
  /**
   * A name pair (`playerName` / `playerFuzzy`) or a `stem` link whose numbers differ: the
   * row's number as printed ("NNO" for a no-number row). The card keeps its
   * own number; this is shown beside it in Match Cards and is never a
   * conflict.
   */
  checklistNumber?: string;
  /** Present only when the two disagree. */
  conflict?: ChecklistConflict;
  /** The row's players, when the card has none. */
  fillPlayers?: string[];
};

export type ChecklistMatchResult = {
  /** In card order. */
  matches: ChecklistCardMatch[];
  /** Cards no row paired with, in card order. */
  unmatchedCardIndices: number[];
  /**
   * Unmatched cards whose players a row lists under another number: the
   * first `MAX_CHECKLIST_MISREADS` pairs, in card then row order.
   */
  misreads: Array<{ cardIndex: number; rowIndex: number }>;
  /** Every such pair, including those past the list's cap. */
  misreadCount: number;
  /**
   * NEO-490 / NEO-496 — a card AND a row are both left over, so there is
   * something for the operator to pair by hand.
   */
  needsOperator: boolean;
  /** NEO-490 — rows no match used, ascending. */
  unusedRowIndices: number[];
  /**
   * Cards left unmatched because they were one side of a TIE, not because
   * nothing fit: a player with several cards the numbers could not settle, or
   * a same-name pair whose numbers are both plain and disagree (38 against
   * 250). Ascending; a subset of `unmatchedCardIndices`. A card unmatched and
   * not here simply had no row.
   */
  tiedCardIndices: number[];
  /** The rows of the same ties, ascending; a subset of `unusedRowIndices`. */
  tiedRowIndices: number[];
  /**
   * Variations: rows that are variations of a card with no card of their own
   * ("38b" when the card is "38" and the row "38a" took it). The caller
   * creates each as a variation card of `parentCardIndex`. Ascending by
   * `rowIndex`; never in `matches`, `unusedRowIndices` or a stem link.
   */
  siblingRows: Array<{ rowIndex: number; parentCardIndex: number }>;
};

/** The most misread pairs listed; `misreadCount` counts the rest. */
export const MAX_CHECKLIST_MISREADS = 200;

/** Whether a checklist row is a no-number row: flagged, or its number is none. */
export function rowHasNoNumber(row: Pick<ChecklistRowInput, "number" | "noNumber">): boolean {
  return row.noNumber === true || isNoNumber(row.number);
}

/** A person's or team's name as the two sides compare it. */
export function checklistNameKey(name: string): string {
  // NEO-643: the one entity-name reading, word order kept; never stored.
  return orderedEntityNameCompareKey(name);
}

function namesKey(names: readonly string[]): string {
  return [...new Set(names.map(checklistNameKey).filter(Boolean))].sort().join("|");
}

/** A suffix a surname comparison passes over ("Ken Griffey Jr" ends "griffey"). */
const SURNAME_SUFFIX = /(?: (?:jr|sr|ii|iii|iv|v))+$/;

/**
 * Do the checklist's players name the marketplace's? The same names, or the
 * same count with each checklist name equal to a marketplace name or to its
 * last word(s), each marketplace name used once. Exact names are paired
 * first, so a full name never takes a surname's partner.
 *
 * A comparison for the conflict check only: never used to write a name.
 *
 * The ONE rule for "do these two sources name the card differently": the
 * server's players disagreement (`compareChecklistRow`) and Match Cards' name
 * picker (`nameSourceOptions` in the pairing dialog) both ask it, so the
 * dialog never warns about a name the wizard would not. A trailing hobby
 * marker ("SP"), a surname only, and a different order all agree.
 */
export function playersAgree(
  marketplace: readonly string[],
  checklist: readonly string[],
): boolean {
  // A marketplace keeps a trailing "SP" the checklist parser drops; neither
  // is a different player.
  marketplace = marketplace.map(dropTrailingMarkers);
  checklist = checklist.map(dropTrailingMarkers);
  if (namesKey(marketplace) === namesKey(checklist)) return true;
  const market = marketplace.map(checklistNameKey).filter(Boolean);
  const listed = checklist.map(checklistNameKey).filter(Boolean);
  if (market.length !== listed.length || market.length === 0) return false;
  const open = [...market];
  const surnameLeft: string[] = [];
  for (const key of listed) {
    const at = open.indexOf(key);
    if (at === -1) surnameLeft.push(key);
    else open.splice(at, 1);
  }
  for (const key of surnameLeft) {
    const at = open.findIndex((full) => {
      const bare = full.replace(SURNAME_SUFFIX, "");
      return bare.endsWith(` ${key}`);
    });
    if (at === -1) return false;
    open.splice(at, 1);
  }
  return true;
}

function nonEmpty(names: readonly string[] | undefined): string[] {
  return (names ?? []).map((n) => n.trim()).filter(Boolean);
}

function groupByKey(keys: Map<number, string>): Map<string, number[]> {
  const byKey = new Map<string, number[]>();
  for (const [i, k] of keys) {
    const list = byKey.get(k);
    if (list) list.push(i);
    else byKey.set(k, [i]);
  }
  return byKey;
}

/** Pair keys that are exactly one on each side. */
function pairUnique(
  cardKeys: Map<number, string>,
  rowKeys: Map<number, string>,
): Array<{ cardIndex: number; rowIndex: number }> {
  const cardsByKey = groupByKey(cardKeys);
  const rowsByKey = groupByKey(rowKeys);
  const pairs: Array<{ cardIndex: number; rowIndex: number }> = [];
  for (const [k, cardList] of cardsByKey) {
    const rowList = rowsByKey.get(k);
    if (cardList.length === 1 && rowList?.length === 1) {
      pairs.push({ cardIndex: cardList[0], rowIndex: rowList[0] });
    }
  }
  return pairs;
}

/**
 * NEO-490 — pair cards and rows by their players: the same `namesKey` the
 * NNO pass uses, exactly one card AND exactly one row per key (rule 7's guard
 * on the only key left), in card order. A card or row with no players has no
 * key and pairs with nothing; a tie leaves every card and row of that key
 * unmatched, never given to the first.
 *
 * Pure, and indexes are positions in the lists given, so a caller may pass
 * any subset (the Match Cards dialog passes its leftovers).
 */
export function pairByPlayerName(
  cards: ReadonlyArray<{ players?: readonly string[] }>,
  rows: ReadonlyArray<{ players: readonly string[] }>,
): Array<{ cardIndex: number; rowIndex: number }> {
  const cardKeys = new Map<number, string>();
  cards.forEach((c, i) => {
    const k = namesKey(nonEmpty(c.players));
    if (k) cardKeys.set(i, k);
  });
  const rowKeys = new Map<number, string>();
  rows.forEach((r, i) => {
    const k = namesKey(nonEmpty(r.players));
    if (k) rowKeys.set(i, k);
  });
  return pairUnique(cardKeys, rowKeys).sort((a, b) => a.cardIndex - b.cardIndex);
}

/**
 * One pair compared: what disagrees (both sides non-empty and different) and
 * the players the row fills in when the card has none. The row's teams are
 * compared as written; `applyChecklistRow` (same folder) re-reads a team
 * conflict against the RESOLVED names. Shared by the matcher and every caller
 * that pairs a card and a row some other way (the operator's own links), so
 * the comparison cannot differ by how the pair was made.
 *
 * NEO-489: the card's teams are its `teams`, else its legacy single `team`.
 * A row that says "No Team" (`noTeam`) against a card that has a team is a
 * team disagreement with an EMPTY checklist side, however the pair was made
 * (number, case-folded number, prefix strip, players, or the operator's own
 * link): the operator decides, nothing is filled.
 */
export function compareChecklistRow(
  card: Pick<ChecklistCardInput, "players" | "teams" | "team">,
  row: Pick<ChecklistRowInput, "players" | "teams" | "noTeam">,
): { conflict?: ChecklistConflict; fillPlayers?: string[] } {
  const cardPlayers = nonEmpty(card.players);
  const rowPlayers = nonEmpty(row.players);
  const listedTeams = nonEmpty(card.teams);
  const cardTeams = listedTeams.length > 0 ? listedTeams : nonEmpty(card.team ? [card.team] : []);
  const rowTeams = nonEmpty(row.teams);
  const conflict: ChecklistConflict = {};
  if (cardPlayers.length > 0 && rowPlayers.length > 0 && !playersAgree(cardPlayers, rowPlayers)) {
    conflict.players = { marketplace: cardPlayers, checklist: rowPlayers };
  }
  if (cardTeams.length > 0 && rowTeams.length > 0 && namesKey(cardTeams) !== namesKey(rowTeams)) {
    conflict.teams = { marketplace: cardTeams, checklist: rowTeams };
  } else if (cardTeams.length > 0 && rowTeams.length === 0 && row.noTeam === true) {
    // The checklist says No Team; the card has one. The operator decides.
    conflict.teams = { marketplace: cardTeams, checklist: [] };
  }
  return {
    ...(conflict.players || conflict.teams ? { conflict } : {}),
    ...(cardPlayers.length === 0 && rowPlayers.length > 0 ? { fillPlayers: rowPlayers } : {}),
  };
}

/**
 * How a core pair reads in this module's `via` vocabulary. Numbers agreeing
 * (whatever tier paired them): the number as printed, case-folded, or the
 * prefix stripped; two no-number cards: the player. Numbers differing: the
 * players' names pair them (`playerName`, confidence 0.9) or a near name
 * (`playerFuzzy`, its score times 0.9 when the numbers differ).
 */
function agreementVia(
  cardNumber: string,
  row: ChecklistRowInput,
  pair: NamesFirstPair,
): { via: ChecklistCardMatch["via"]; confidence?: number } {
  if (pair.by === "nearName") return { via: "playerFuzzy", confidence: pair.confidence };
  if (!pair.numbersAgree) return { via: "playerName", confidence: pair.confidence };
  if (rowHasNoNumber(row)) return { via: "player" };
  if (exactChecklistNumber(cardNumber) === exactChecklistNumber(row.number)) return { via: "number" };
  if (normalizeChecklistNumber(cardNumber) === normalizeChecklistNumber(row.number)) {
    return { via: "caseFolded" };
  }
  return { via: "prefixStripped" };
}

export function matchPublishedChecklist(
  cards: readonly ChecklistCardInput[],
  rows: readonly ChecklistRowInput[],
  options: { prefix?: string } = {},
): ChecklistMatchResult {
  // The core reads a roster and a number; a no-number row is "NNO" whether
  // or not the flag is set.
  const core = pairNamesFirst(
    cards.map((c) => ({ names: nonEmpty(c.players), number: c.cardNumber })),
    rows.map((r) => ({ names: nonEmpty(r.players), number: rowHasNoNumber(r) ? "NNO" : r.number })),
    // A checklist's numbers are the publisher's own, so a letter prefix
    // ("BCP-12" against "12") still counts when numbers alone decide.
    { prefix: options.prefix, stripLetterPrefix: true, stemSiblingSide: "right" },
  );

  const paired = new Map<
    number,
    { rowIndex: number; via: ChecklistCardMatch["via"]; confidence?: number; numbersDiffer: boolean }
  >();
  const usedRows = new Set<number>();
  for (const p of core.pairs) {
    const card = cards[p.leftIndex];
    const row = rows[p.rightIndex];
    paired.set(p.leftIndex, {
      rowIndex: p.rightIndex,
      ...agreementVia(card.cardNumber, row, p),
      numbersDiffer: !p.numbersAgree,
    });
    usedRows.add(p.rightIndex);
  }

  // Variations: a row that stands for several cards sharing its stem.
  for (const link of core.stemLinks) {
    // Rows are the right side and the siblings side, so the one is always a row.
    if (link.oneSide !== "right") continue;
    const row = rows[link.oneIndex];
    for (const cardIndex of link.manyIndices) {
      paired.set(cardIndex, {
        rowIndex: link.oneIndex,
        via: "stem",
        numbersDiffer: !cardNumbersAgree(cards[cardIndex].cardNumber, rowHasNoNumber(row) ? "NNO" : row.number, {
          prefix: options.prefix,
        }),
      });
    }
    usedRows.add(link.oneIndex);
  }
  const siblingRows = core.stemSiblings
    .filter((s) => s.side === "right")
    .map((s) => ({ rowIndex: s.index, parentCardIndex: s.parentIndex }));
  const siblingRowSet = new Set(siblingRows.map((s) => s.rowIndex));

  // Only the misread check below reads these: the folded number as printed,
  // "" for a no-number card or row.
  const cardNumbers = new Map<number, string>();
  cards.forEach((c, i) => {
    if (!isNoNumber(c.cardNumber)) cardNumbers.set(i, normalizeChecklistNumber(c.cardNumber));
  });
  const rowNumbers = new Map<number, string>();
  rows.forEach((r, i) => {
    if (!rowHasNoNumber(r)) rowNumbers.set(i, normalizeChecklistNumber(r.number));
  });

  const matches: ChecklistCardMatch[] = [];
  const unmatchedCardIndices: number[] = [];
  cards.forEach((card, cardIndex) => {
    const pair = paired.get(cardIndex);
    if (!pair) {
      unmatchedCardIndices.push(cardIndex);
      return;
    }
    const row = rows[pair.rowIndex];
    const byName = pair.via === "playerName" || pair.via === "playerFuzzy" || pair.via === "stem";
    matches.push({
      cardIndex,
      rowIndex: pair.rowIndex,
      via: pair.via,
      ...(pair.confidence !== undefined ? { confidence: pair.confidence } : {}),
      ...(byName && pair.numbersDiffer
        ? { checklistNumber: rowHasNoNumber(row) ? "NNO" : row.number.trim() }
        : {}),
      ...compareChecklistRow(card, row),
    });
  });
  const unusedRowIndices: number[] = [];
  rows.forEach((_, i) => {
    if (!usedRows.has(i) && !siblingRowSet.has(i)) unusedRowIndices.push(i);
  });
  // The operator pairs what is left, when there is something on both sides.
  const needsOperator = unmatchedCardIndices.length > 0 && unusedRowIndices.length > 0;

  // Likely misreads: an unmatched card whose players a row lists under a
  // different number. Reported only. Counted per group (the group's rows
  // less those at the card's own number), so the count costs one pass over
  // cards and rows however large the cross product is; only the listed pairs
  // are walked, and the walk stops at the cap. "" stands for a blank number,
  // which a normalised number never is.
  const rowsByPlayers = new Map<string, { rows: number[]; byNumber: Map<string, number> }>();
  rows.forEach((r, i) => {
    const k = namesKey(nonEmpty(r.players));
    if (!k) return;
    let group = rowsByPlayers.get(k);
    if (!group) {
      group = { rows: [], byNumber: new Map() };
      rowsByPlayers.set(k, group);
    }
    group.rows.push(i);
    const n = rowNumbers.get(i) ?? "";
    group.byNumber.set(n, (group.byNumber.get(n) ?? 0) + 1);
  });
  const misreads: ChecklistMatchResult["misreads"] = [];
  let misreadCount = 0;
  for (const cardIndex of unmatchedCardIndices) {
    const k = namesKey(nonEmpty(cards[cardIndex].players));
    if (!k) continue;
    const group = rowsByPlayers.get(k);
    if (!group) continue;
    const cardNumber = cardNumbers.get(cardIndex) ?? "";
    const here = group.rows.length - (group.byNumber.get(cardNumber) ?? 0);
    misreadCount += here;
    if (here === 0 || misreads.length >= MAX_CHECKLIST_MISREADS) continue;
    for (const rowIndex of group.rows) {
      if ((rowNumbers.get(rowIndex) ?? "") === cardNumber) continue;
      misreads.push({ cardIndex, rowIndex });
      if (misreads.length >= MAX_CHECKLIST_MISREADS) break;
    }
  }

  return {
    matches,
    unmatchedCardIndices,
    misreads,
    misreadCount,
    needsOperator,
    unusedRowIndices,
    tiedCardIndices: core.tiedLeft.filter((i) => !paired.has(i)),
    tiedRowIndices: core.tiedRight.filter((i) => !usedRows.has(i)),
    siblingRows,
  };
}
