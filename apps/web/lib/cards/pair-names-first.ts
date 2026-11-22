/**
 * NEO-591 — the one core that pairs two lists of cards, names first, numbers
 * confirming (product rule 7, rewritten 2026-11-18).
 *
 * Pure: no Convex, no DOM. Two server matchers run it: BuySportsCards against
 * SportLots (`fetchCardChecklist`) and a publisher's checklist against the
 * fetched cards (`lib/checklists/match-published-checklist.ts`). Indexes are
 * positions in the lists given, so a caller may pass any subset.
 *
 * ## Why names first
 *
 * A card number is a printed label, not an identity: publishers number a set
 * one way and a marketplace another ("OV-ANFI" against the checklist's
 * "NNO"), and the old matcher, which split cards into "numbered" and
 * "no-number" kinds and never paired across them, paired 0 of 56 on an Onyx
 * set. A player's name is the stronger identity in practice. So:
 *
 *  1. **T1, the same roster** (`rosterCompareKey`): an item pairs with the item on
 *     the other side that names the same players when each side has exactly
 *     one. The numbers then only say whether they AGREE (`numbersAgree`);
 *     they never stop the pair. A player with several cards in the set is a
 *     group: inside it the number decides (as printed, case-folded, prefix
 *     stripped, each exactly one within the group), and when exactly one card
 *     is left on each side they pair with `numbersAgree: false`. Anything
 *     else is a tie and stays unmatched for the operator (rule 8), listed in
 *     `tiedLeft` / `tiedRight`.
 *     Between the group's number passes and its 1:1 remainder sits the
 *     **stem step** (variations, Jason 2026-11-18): when one item on a side
 *     carries a stem ("38") that two or more items on the other side carry
 *     ("38", "38b", "38c"), the one item stands for all of them. Only a BARE
 *     stem stands for others: a lettered item ("300b") is one version, so it
 *     pairs by its own number and never takes the base card (2024 Topps
 *     Chrome #300). See
 *     `stemLinks` and `stemSiblings` on the result.
 *  2. **T2, numbers on the leftovers**: only for items whose roster has no
 *     counterpart on the other side (or that name no one), never for a tied
 *     group. A number pairs when it is exactly one item on each side of the
 *     WHOLE set (a repeated number pins nothing down), compared as printed,
 *     then case-folded, then with the set's own `prefix` stripped (an
 *     arbitrary letter prefix only with `stripLetterPrefix`: "T-10" is not
 *     "10"). A no-number item has no key.
 *  3. **T3, near names**: what is still left pairs by the first name,
 *     Jaro-Winkler at `PLAYER_NAME_AUTO_LINK`, each side's one best only
 *     (`pairNamesBySimilarity`; its caps keep it bounded).
 *
 * There is no "numbered" versus "no-number" split anywhere: an item with no
 * number simply cannot be paired by number. `kind` is the one partition: a
 * variation never pairs with a base card.
 *
 * ## Names are compared without trailing print-run markers
 *
 * A checklist prints "Old Teammates SP" and its parser drops the "SP"; a
 * marketplace keeps it in the card's name. Both sides' keys drop trailing
 * markers (`dropTrailingMarkers`, the parser's own list), so the two meet.
 * Stored names are never changed.
 *
 * ## Confidence
 *
 * Same roster with the numbers agreeing: 1. Same roster with the numbers
 * differing: `NUMBERS_DIFFER_FACTOR` (0.9). A near name: its score, times
 * `NUMBERS_DIFFER_FACTOR` when the numbers differ. A pair made by number
 * alone: 1.
 */

import {
  cardNumberClass,
  cardNumbersAgree,
  exactChecklistNumber,
  isNoNumber,
  normalizeChecklistNumber,
  strippedCardNumber,
} from "./card-number";
import { PLAYER_NAME_AUTO_LINK, pairNamesBySimilarity } from "./name-similarity";
import { dropTrailingMarkers } from "./print-run-markers";
import { cardNumberStem } from "./variations";
import { entityNameCompareKey, rosterCompareKey } from "../entities/normalize-name";

/** What a pair's confidence is multiplied by when its numbers differ. */
export const NUMBERS_DIFFER_FACTOR = 0.9;

export type NamesFirstItem = {
  /** The players (or whatever the roster is) as the source prints them. */
  names: readonly string[];
  /** The card number as the source prints it; blank / "NNO" is no number. */
  number: string;
};

export type NamesFirstOptions<T extends NamesFirstItem = NamesFirstItem> = {
  /** The set's `cardNumberPrefix` ("DK-"); stripped in every number reading. */
  prefix?: string;
  /**
   * Strip an ARBITRARY leading letter prefix ("T-10" → "10") when numbers
   * alone decide a pairing (T2, and the number passes inside a multi-card
   * roster group). Default false: a letter prefix often marks another subset
   * (team cards, inserts), so only exact, case-folded and the set's own
   * `prefix` count there. The checklist matcher turns it on. It never affects
   * `numbersAgree`, which always reads a letter prefix as agreeing.
   */
  stripLetterPrefix?: boolean;
  /**
   * The side whose items are SOURCE rows that may need to become cards (a
   * published checklist's rows are `"right"`). Absent (BSC against SportLots,
   * where every item already is a card), the stem step only links.
   *
   * When the "one" item (see `stemLinks`) is on the OTHER side and the
   * several items with its stem are on this one, the one item pairs with
   * the row whose number matches exactly (the number passes did that), else
   * the single row numbered stem + "a" ("38" with rows 38a / 38b pairs 38a),
   * else it is a tie and nothing pairs. Every other row with the stem comes
   * back in `stemSiblings` for the caller to create as a variation of the
   * one item. The mirror shape (one row, several cards) stays a plain
   * `stemLinks`, since each card exists already.
   */
  stemSiblingSide?: "left" | "right";
  /**
   * Items pair only with items of the same kind (e.g. `isVariation`). Absent:
   * every item is one kind.
   */
  kind?: (item: T) => string | number | boolean | null | undefined;
};

export type NamesFirstPair = {
  leftIndex: number;
  rightIndex: number;
  /** The tier: `name` (same roster), `number` (number alone), `nearName`. */
  by: "name" | "number" | "nearName";
  /** `cardNumbersAgree` on the two numbers. */
  numbersAgree: boolean;
  /**
   * `number` pairs only: both sides name players and the rosters differ. The
   * caller shows the disagreement (the checklist matcher reads it as
   * `conflict.players`); `confidence` stays 1, a number-only pair's.
   */
  namesDisagree?: true;
  /** `nearName` only: the Jaro-Winkler score. */
  nameScore?: number;
  confidence: number;
};

/**
 * One item on one side that stands for several on the other, all sharing a
 * card-number stem ("38" for "38", "38b", "38c"). The one item's data applies
 * to every linked item; none of them is also in `pairs`, `tiedLeft` or
 * `tiedRight`. When the one item was paired by full number with one of the
 * several (checklist 38 with cards 38, 38b, 38c: 38 pairs 38), that pair
 * stays in `pairs` and `manyIndices` holds only the others. A link whose one
 * item is not in `pairs` has no partner of its own; it is consumed by the
 * link. `oneSide` says which list `oneIndex` indexes; `manyIndices` index the
 * other.
 */
export type NamesFirstStemLink = {
  oneSide: "left" | "right";
  oneIndex: number;
  manyIndices: number[];
};

/**
 * An item (a checklist row) that has no card yet and is a variation of
 * `parentIndex`, which is on the opposite side. `side` is the side of `index`.
 * Only produced when `stemSiblingSide` names that side. Never in `pairs`.
 */
export type NamesFirstStemSibling = {
  index: number;
  side: "left" | "right";
  parentIndex: number;
};

export type NamesFirstResult = {
  /** In left order. */
  pairs: NamesFirstPair[];
  /** The stem step's one-for-many links, ascending by `oneSide` then `oneIndex`. */
  stemLinks: NamesFirstStemLink[];
  /** The stem step's rows to create, ascending by `side` then `index`. */
  stemSiblings: NamesFirstStemSibling[];
  /**
   * Items left unmatched because they are one side of a tie: a roster with
   * several cards (or rows) on a side that the number could not settle.
   * Ascending, and never also in `pairs`.
   */
  tiedLeft: number[];
  tiedRight: number[];
};

type Info = {
  index: number;
  /** `rosterCompareKey` (a hyphen is a space), "" when the item names no one. */
  key: string;
  none: boolean;
  exact: string;
  folded: string;
  stripped: string;
  /** The shared variation stem, upper-cased; null for a no-number item. */
  stem: string | null;
  /** The number IS its stem ("300", not "300b"): the only kind that stands for others. */
  bare: boolean;
};

function describe(
  items: readonly NamesFirstItem[],
  indices: readonly number[],
  prefix: string | undefined,
  letters: boolean,
): Info[] {
  return indices.map((index) => {
    const item = items[index];
    const none = isNoNumber(item.number);
    const exact = none ? "" : exactChecklistNumber(item.number);
    const stem = none ? null : cardNumberStem(exact).toUpperCase();
    return {
      index,
      key: rosterCompareKey(item.names.map(dropTrailingMarkers)),
      none,
      exact,
      folded: none ? "" : normalizeChecklistNumber(item.number),
      stripped: none ? "" : strippedCardNumber(item.number, prefix, letters),
      stem,
      bare: stem !== null && exact.toUpperCase() === stem,
    };
  });
}

function bucket<K>(infos: readonly Info[], keyOf: (i: Info) => K | null): Map<K, Info[]> {
  const out = new Map<K, Info[]>();
  for (const info of infos) {
    const k = keyOf(info);
    if (k === null) continue;
    const list = out.get(k);
    if (list) list.push(info);
    else out.set(k, [info]);
  }
  return out;
}

/**
 * Pair by one number reading: a key that is exactly one item on each side of
 * `leftAll` / `rightAll` pairs, provided both are still free. The counts run
 * over ALL items given (paired or not): a number the whole set repeats pins
 * nothing down. Returns the pairs it made.
 */
function pairByKey(
  leftAll: readonly Info[],
  rightAll: readonly Info[],
  free: (i: Info) => boolean,
  keyOf: (i: Info) => string | null,
): Array<[Info, Info]> {
  const rightBy = bucket(rightAll, keyOf);
  const out: Array<[Info, Info]> = [];
  for (const [k, ls] of bucket(leftAll, keyOf)) {
    const rs = rightBy.get(k);
    if (ls.length !== 1 || rs?.length !== 1) continue;
    if (free(ls[0]) && free(rs[0])) out.push([ls[0], rs[0]]);
  }
  return out;
}

/** The three number readings, tightest first. None-number items have no key. */
const NUMBER_READINGS: Array<(i: Info) => string | null> = [
  (i) => (i.none ? null : i.exact),
  (i) => (i.none ? null : i.folded),
  (i) => (i.none ? null : i.stripped),
];

function pairKind<T extends NamesFirstItem>(
  left: readonly T[],
  right: readonly T[],
  leftIdx: readonly number[],
  rightIdx: readonly number[],
  prefix: string | undefined,
  letters: boolean,
  siblingSide: "left" | "right" | undefined,
  out: NamesFirstResult,
): void {
  const L = describe(left, leftIdx, prefix, letters);
  const R = describe(right, rightIdx, prefix, letters);
  const taken = new Set<Info>();
  const free = (i: Info) => !taken.has(i);
  const add = (l: Info, r: Info, by: NamesFirstPair["by"], score?: number) => {
    taken.add(l);
    taken.add(r);
    const ln = left[l.index].number;
    const rn = right[r.index].number;
    const numbersAgree = cardNumbersAgree(ln, rn, { prefix });
    // Jason, 2026-11-18: "if they are both numeric then leave unmatched. only
    // match with different numbers if the type is different." Two plain
    // numbers that disagree (38 and 250) are two cards, whatever the names:
    // treated as a tie, both left for the operator.
    if (
      by !== "number" &&
      !numbersAgree &&
      cardNumberClass(ln) === "digits" &&
      cardNumberClass(rn) === "digits"
    ) {
      out.tiedLeft.push(l.index);
      out.tiedRight.push(r.index);
      return;
    }
    const namesDisagree = by === "number" && l.key !== "" && r.key !== "" && l.key !== r.key;
    // A number-only pair is certain of the number, not of the card: when the
    // names disagree it is no better than a pair whose numbers differ.
    const base =
      by === "nearName"
        ? (score ?? 0)
        : by === "number"
          ? namesDisagree
            ? NUMBERS_DIFFER_FACTOR
            : 1
          : numbersAgree
            ? 1
            : NUMBERS_DIFFER_FACTOR;
    const confidence = by === "nearName" && !numbersAgree ? base * NUMBERS_DIFFER_FACTOR : base;
    out.pairs.push({
      leftIndex: l.index,
      rightIndex: r.index,
      by,
      numbersAgree,
      ...(by === "nearName" ? { nameScore: score } : {}),
      ...(namesDisagree ? { namesDisagree: true as const } : {}),
      confidence,
    });
  };

  // ---- T1: the same roster ------------------------------------------------
  const leftByKey = bucket(L, (i) => (i.key ? i.key : null));
  const rightByKey = bucket(R, (i) => (i.key ? i.key : null));
  // Items whose roster is on the other side: the number may not send them
  // elsewhere, so they sit out T2 and T3 whether or not they paired.
  const hasCounterpart = new Set<Info>();
  // A leftover whose roster group has nothing left on the other side (a combo
  // card the other source lists as one of its players) may still pair by
  // number: the group's tie, if any, is not its problem.
  const releasedToNumbers = new Set<Info>();
  for (const [key, ls] of leftByKey) {
    const rs = rightByKey.get(key);
    if (!rs) continue;
    for (const i of ls) hasCounterpart.add(i);
    for (const i of rs) hasCounterpart.add(i);
    if (ls.length === 1 && rs.length === 1) {
      add(ls[0], rs[0], "name");
      continue;
    }
    // A roster with several cards: the number decides, inside the group. The
    // no-number items are their own key under the exact reading.
    const readings: Array<(i: Info) => string | null> = [
      (i) => i.exact,
      (i) => (i.none ? null : i.folded),
      (i) => (i.none ? null : i.stripped),
    ];
    for (const reading of readings) {
      for (const [l, r] of pairByKey(ls, rs, free, reading)) add(l, r, "name");
    }
    // The stem step: one item stands for several that share its stem.
    const rByStem = bucket(rs, (i) => i.stem);
    for (const [stem, lS] of bucket(ls, (i) => i.stem)) {
      const rS = rByStem.get(stem);
      if (!rS) continue;
      // Two on the one side is a tie (rule 8); two on both is a tie too.
      const oneSide = lS.length === 1 && rS.length >= 2 ? "left" : rS.length === 1 && lS.length >= 2 ? "right" : null;
      if (!oneSide) continue;
      const one = oneSide === "left" ? lS[0] : rS[0];
      const many = oneSide === "left" ? rS : lS;
      // Only the bare stem stands for its versions. A lettered item ("300b")
      // is one version itself: the card numbered 300 is its own card, never
      // one of "all versions" of 300b (2024 Topps Chrome: base #300 took the
      // 300b row). Letters on a lone item mean it is paired by its own
      // number, or left for the operator.
      if (!one.bare) continue;
      // The several must be different numbers ("38", "38b"): the same number
      // twice is a repeated number, a tie, not a variation.
      if (new Set(many.map((m) => m.folded)).size !== many.length) continue;
      const manySide = oneSide === "left" ? "right" : "left";
      if (siblingSide === manySide) {
        if (free(one)) {
          const a = many.filter((m) => free(m) && m.folded === stem + "A");
          if (a.length !== 1) continue; // no single "a" row: a tie
          if (oneSide === "left") add(one, a[0], "name");
          else add(a[0], one, "name");
        }
        for (const m of many) {
          if (!free(m)) continue;
          taken.add(m);
          out.stemSiblings.push({ index: m.index, side: manySide, parentIndex: one.index });
        }
      } else {
        const linked = many.filter(free);
        if (linked.length === 0) continue;
        taken.add(one);
        for (const m of linked) taken.add(m);
        out.stemLinks.push({ oneSide, oneIndex: one.index, manyIndices: linked.map((m) => m.index) });
      }
    }

    const lLeft = ls.filter(free);
    const rLeft = rs.filter(free);
    if (lLeft.length === 1 && rLeft.length === 1) {
      add(lLeft[0], rLeft[0], "name");
    } else if (lLeft.length > 0 && rLeft.length > 0) {
      for (const i of lLeft) out.tiedLeft.push(i.index);
      for (const i of rLeft) out.tiedRight.push(i.index);
    } else {
      for (const i of lLeft) releasedToNumbers.add(i);
      for (const i of rLeft) releasedToNumbers.add(i);
    }
  }

  // ---- T2: numbers, on what has no roster counterpart ----------------------
  const eligible = (i: Info) => free(i) && !hasCounterpart.has(i);
  const byNumber = (i: Info) => free(i) && (!hasCounterpart.has(i) || releasedToNumbers.has(i));
  for (const reading of NUMBER_READINGS) {
    for (const [l, r] of pairByKey(L, R, byNumber, reading)) add(l, r, "number");
  }

  // ---- T3: near names ------------------------------------------------------
  const lLeft = L.filter(eligible);
  const rLeft = R.filter(eligible);
  if (lLeft.length > 0 && rLeft.length > 0) {
    const firstName = (names: readonly string[]) => {
      const first = names.map((n) => dropTrailingMarkers(n)).find(Boolean);
      return first ? entityNameCompareKey(first) || undefined : undefined;
    };
    for (const p of pairNamesBySimilarity(
      lLeft.map((i) => firstName(left[i.index].names)),
      rLeft.map((i) => firstName(right[i.index].names)),
      PLAYER_NAME_AUTO_LINK,
    )) {
      add(lLeft[p.leftIndex], rLeft[p.rightIndex], "nearName", p.score);
    }
  }
}

export function pairNamesFirst<T extends NamesFirstItem>(
  left: readonly T[],
  right: readonly T[],
  options: NamesFirstOptions<T> = {},
): NamesFirstResult {
  const kindOf = options.kind;
  const groups = new Map<string, { l: number[]; r: number[] }>();
  const group = (item: T) => {
    const k = kindOf ? String(kindOf(item) ?? "") : "";
    let g = groups.get(k);
    if (!g) {
      g = { l: [], r: [] };
      groups.set(k, g);
    }
    return g;
  };
  left.forEach((item, i) => group(item).l.push(i));
  right.forEach((item, i) => group(item).r.push(i));

  const out: NamesFirstResult = { pairs: [], stemLinks: [], stemSiblings: [], tiedLeft: [], tiedRight: [] };
  for (const g of groups.values()) {
    if (g.l.length === 0 || g.r.length === 0) continue;
    pairKind(left, right, g.l, g.r, options.prefix, options.stripLetterPrefix === true, options.stemSiblingSide, out);
  }
  out.pairs.sort((a, b) => a.leftIndex - b.leftIndex);
  const sideRank = (side: "left" | "right") => (side === "left" ? 0 : 1);
  out.stemLinks.sort((a, b) => sideRank(a.oneSide) - sideRank(b.oneSide) || a.oneIndex - b.oneIndex);
  out.stemSiblings.sort((a, b) => sideRank(a.side) - sideRank(b.side) || a.index - b.index);
  out.tiedLeft.sort((a, b) => a - b);
  out.tiedRight.sort((a, b) => a - b);
  return out;
}
