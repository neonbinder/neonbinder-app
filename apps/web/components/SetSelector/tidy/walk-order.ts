/**
 * NEO-645 — the order Tidy Up walks a checklist in, and the sitting's memory.
 *
 * Pure, apart from the sessionStorage helpers at the bottom. Nothing here
 * reads a marketplace value: a card is in the walk when `deriveCardAttention`
 * says it needs a person, whatever the sources called anything.
 *
 * ## Membership and order
 *
 * The walk is every card whose attention level is not "none": the same rule
 * the badge, the pill count and the grid filter use, so count = walk = pill.
 * NEO-656: the level is read from the data every time, including the career
 * gaps (`useLeafCareerGaps`), so a card the sitting saved still counts while
 * anything on it holds.
 *
 *   1. lookups finished first. A card whose automatic team lookup has not
 *      landed yet sorts after the ones that have, so the operator does not open
 *      a half-loaded card while a loaded one is waiting. (NEO-656: the name
 *      lookups run when a card opens, so they no longer order the walk.)
 *   2. then the leaf's own order (`leafRank`; the Base checklist first). One
 *      checklist is one leaf, so this is a constant today. It is a parameter
 *      so a walk that spans leaves needs no new sort;
 *   3. then the natural card number (USC2 before USC10).
 *
 * ## The sitting
 *
 * A sitting remembers, per leaf and per tab (sessionStorage), which cards it
 * has been through and the trail of cards it showed:
 *
 *   - `passed`: left going forward, by Save & next or by Skip. Skip is not a
 *     write, so a skipped card stays flagged; it is simply not offered again
 *     this sitting, and the end screen counts it.
 *   - `trail`: every card shown, in order, so Back can step to the one before
 *     when the browser has no entry to step back to (a refresh, a pasted link).
 *
 * A new sitting (the commit landing, the pill pressed) starts both empty, so a
 * card skipped last time is offered again. A refresh keeps them.
 */
import { compareCardNumbers } from "@/lib/cards/card-number";
import {
  deriveCardAttention,
  isAwaitingTeamLookup,
  type AttentionCardRow,
  type LiveCareerGap,
} from "../card-attention";
import type { TidyAttention } from "./tile-types";

/** The career gaps read live, by card id (`useLeafCareerGaps`). A card with none is absent. */
export type CareerGapsByCard = ReadonlyMap<string, readonly LiveCareerGap[]>;
const NO_GAPS: CareerGapsByCard = new Map();

/** The row fields the walk reads, on top of what the attention rule reads. */
export type WalkRow = AttentionCardRow & {
  _id: string;
  cardNumber: string;
};

/**
 * Have this card's lookups finished? Its automatic team lookup has answered.
 * A lookup never blocks a card, it only moves it later.
 */
export function lookupsFinished(row: WalkRow): boolean {
  return !isAwaitingTeamLookup(row);
}

export type WalkEntry<Row extends WalkRow> = {
  row: Row;
  attention: TidyAttention;
  /** The card's lookups have finished. */
  ready: boolean;
};

/** Every card that needs a person, in walk order. */
export function walkOrder<Row extends WalkRow>(
  rows: readonly Row[],
  careerGaps: CareerGapsByCard = NO_GAPS,
  leafRank: (row: Row) => number = () => 0,
): WalkEntry<Row>[] {
  const entries: WalkEntry<Row>[] = [];
  for (const row of rows) {
    const attention = deriveCardAttention(row, { careerGaps: careerGaps.get(row._id) });
    if (attention.level === "none") continue;
    entries.push({ row, attention, ready: lookupsFinished(row) });
  }
  // The rank is computed once per card, not inside the comparator.
  const rank = new Map(entries.map((e) => [e.row._id, leafRank(e.row)]));
  return entries.sort(
    (a, b) =>
      Number(!a.ready) - Number(!b.ready) ||
      (rank.get(a.row._id) ?? 0) - (rank.get(b.row._id) ?? 0) ||
      compareCardNumbers(a.row.cardNumber, b.row.cardNumber),
  );
}

/** What a sitting remembers. */
export type WalkSitting = {
  /** Cards left going forward (Save & next, Skip), in the order they were. */
  passed: readonly string[];
  /** Every card shown, in the order shown, for Back. */
  trail: readonly string[];
};

export const EMPTY_SITTING: WalkSitting = { passed: [], trail: [] };

/** The trail is capped; a leaf has at most ~1,000 cards and ids are short. */
const TRAIL_MAX = 1200;

/** The card to show after `currentId`: the first flagged card not yet passed. */
export function nextCardId(
  order: ReadonlyArray<{ row: { _id: string } }>,
  sitting: WalkSitting,
  currentId: string | null,
): string | null {
  const passed = new Set(sitting.passed);
  for (const { row } of order) {
    if (row._id === currentId || passed.has(row._id)) continue;
    return row._id;
  }
  return null;
}

/** The card shown before `currentId` on the trail, if any. */
export function previousCardId(sitting: WalkSitting, currentId: string | null): string | null {
  const trail = sitting.trail;
  if (currentId === null) return trail.at(-1) ?? null;
  const at = trail.lastIndexOf(currentId);
  if (at < 0) return trail.at(-1) ?? null;
  return at > 0 ? trail[at - 1] : null;
}

/**
 * `sitting` with `id` on screen. The trail is the path to the card on screen:
 * showing a card already on it (Back) cuts the trail back to that card, so
 * Back twice walks two cards back instead of swinging between two.
 */
export function withShown(sitting: WalkSitting, id: string): WalkSitting {
  const at = sitting.trail.lastIndexOf(id);
  if (at === sitting.trail.length - 1 && at >= 0) return sitting;
  const trail = at >= 0 ? sitting.trail.slice(0, at + 1) : [...sitting.trail, id];
  return {
    ...sitting,
    trail: trail.length > TRAIL_MAX ? trail.slice(trail.length - TRAIL_MAX) : trail,
  };
}

/** `sitting` with `id` left going forward. */
export function withPassed(sitting: WalkSitting, id: string): WalkSitting {
  if (sitting.passed.includes(id)) return sitting;
  return { ...sitting, passed: [...sitting.passed, id] };
}

/** Flagged cards the sitting has not been through yet; the current card counts. */
export function cardsLeft(
  order: ReadonlyArray<{ row: { _id: string } }>,
  sitting: WalkSitting,
): number {
  const passed = new Set(sitting.passed);
  return order.reduce((n, { row }) => n + (passed.has(row._id) ? 0 : 1), 0);
}

/**
 * Cards the sitting passed that are still pink: "not ready to list". NEO-656
 * (B20): counted by the card's level NOW, not by which button was pressed. A
 * card fixed elsewhere in the sitting is not in `order` and drops out.
 */
export function cardsSkipped(
  order: ReadonlyArray<{ row: { _id: string }; attention: { level: string } }>,
  sitting: WalkSitting,
): number {
  const passed = new Set(sitting.passed);
  return order.reduce(
    (n, { row, attention }) => n + (passed.has(row._id) && attention.level === "fix" ? 1 : 0),
    0,
  );
}

/**
 * Cards the sitting passed that are blue and nothing worse: "still to check". A
 * saved card with a blue item left (a career the set's year cannot hold) is
 * still flagged by the data, so it is counted here and never as skipped.
 */
export function cardsStillToCheck(
  order: ReadonlyArray<{ row: { _id: string }; attention: { level: string } }>,
  sitting: WalkSitting,
): number {
  const passed = new Set(sitting.passed);
  return order.reduce(
    (n, { row, attention }) => n + (passed.has(row._id) && attention.level === "check" ? 1 : 0),
    0,
  );
}

/** "31 cards left" / "1 card left" / "No cards left". */
export function cardsLeftText(left: number): string {
  if (left <= 0) return "No cards left";
  return `${left} ${left === 1 ? "card" : "cards"} left`;
}

/** "6 cards skipped, not ready to list". */
export function cardsSkippedText(skipped: number): string {
  return `${skipped} ${skipped === 1 ? "card" : "cards"} skipped, not ready to list`;
}

/** "2 cards still to check". */
export function cardsStillToCheckText(count: number): string {
  return `${count} ${count === 1 ? "card" : "cards"} still to check`;
}

/**
 * The end screen's tally: "9 cards fixed, 2 skipped." A sitting with nothing
 * skipped or left to check gets the sign-off too. The verdict line ("6 cards
 * skipped, not ready to list" / "All tidy") stays the status line; this is the
 * count beside it. Blue cards left (`stillToCheck`) are said only when there are
 * some: "9 cards fixed, 0 skipped, 1 still to check."
 */
export function cardsTallyText(fixed: number, skipped: number, stillToCheck = 0): string {
  const head = `${fixed} ${fixed === 1 ? "card" : "cards"} fixed, ${skipped} skipped${
    stillToCheck > 0 ? `, ${stillToCheck} still to check` : ""
  }.`;
  return skipped === 0 && stillToCheck === 0 && fixed > 0 ? `${head} Totally rad.` : head;
}

/** "3 to fix · 1 to check", with either half left out at zero. Empty at none. */
export function tallyText(attention: TidyAttention): string {
  const fix = attention.items.filter((i) => i.level === "fix").length;
  const check = attention.items.filter((i) => i.level === "check").length;
  const parts: string[] = [];
  if (fix > 0) parts.push(`${fix} to fix`);
  if (check > 0) parts.push(`${check} to check`);
  return parts.join(" · ");
}

// ── sessionStorage ──────────────────────────────────────────────────────────

const STORAGE_PREFIX = "nb:tidy-walk:";

const storageKey = (leafId: string) => `${STORAGE_PREFIX}${leafId}`;

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    // Blocked storage (a locked-down browser): the sitting then lives in
    // memory only, which loses a refresh's place and nothing else.
    return null;
  }
}

const isIdList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((v) => typeof v === "string");

/** The leaf's saved sitting; empty when there is none or it cannot be read. */
export function loadSitting(leafId: string): WalkSitting {
  const store = storage();
  if (!store) return EMPTY_SITTING;
  try {
    const raw = store.getItem(storageKey(leafId));
    if (!raw) return EMPTY_SITTING;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return EMPTY_SITTING;
    const { passed, trail } = parsed as { passed?: unknown; trail?: unknown };
    return {
      passed: isIdList(passed) ? passed : [],
      trail: isIdList(trail) ? trail : [],
    };
  } catch {
    return EMPTY_SITTING;
  }
}

export function saveSitting(leafId: string, sitting: WalkSitting): void {
  try {
    storage()?.setItem(storageKey(leafId), JSON.stringify(sitting));
  } catch {
    // Quota or blocked storage: the sitting just is not remembered.
  }
}

/** A new sitting: nothing passed, nothing shown. */
export function resetSitting(leafId: string): void {
  try {
    storage()?.removeItem(storageKey(leafId));
  } catch {
    // Nothing to forget.
  }
}
