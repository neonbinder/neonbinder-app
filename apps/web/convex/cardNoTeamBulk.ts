/**
 * NEO-556 — "Mark the teamless cards No Team", the operator's explicit run
 * after a set (or a variant type, insert or parallel) is given "No Team".
 *
 * A set-level No Team (`selectorOptions.noTeamDefault`) reaches NEW cards on
 * its own: a card born beneath it is stamped `teamNoneConfirmedAt` when
 * `noTeamCardVerdict` says so. It never touches a card that already exists.
 * Those change only through this run, which the Set Builder's attributes
 * panel offers after the save:
 *
 *   - `noTeamTargets` (read once, on demand) lists the rows the run walks,
 *     for the progress ledger, and counts the cards beneath them by verdict
 *     so the confirm dialog can say how many get stamped and why the rest
 *     are left alone;
 *   - `applyNoTeamPage` does one page of one row, stamping each card the
 *     verdict says to stamp with the calling admin, and hands back a cursor
 *     until it is null.
 *
 * Which cards: every card whose verdict is `stamp` — no team, no team name
 * waiting for review, no listing that names a team (product invariant 8), no
 * BSC lookup still to run (that card is stamped by `applyBscTeamResolution`
 * when BSC answers with no team), and no lookup that gave up (the data is
 * missing, so the operator decides). The verdict is the one every card
 * creation path asks (`lib/selectorTeams.ts`), so the dialog's counts, the
 * run and the birth stamp cannot disagree. Nothing is ever taken away: a
 * card's team is never cleared, and a card already No Team is counted, not
 * rewritten — so a rerun, or a page retried after a lost reply, is harmless.
 *
 * Which rows: the row asked about and every row beneath it (`children`, the
 * walk the team cascade rode down on) that can hold cards and whose OWN team
 * default is No Team. The default is copied down at creation and moved by the
 * cascade, so a row's own field is its effective default: a row beneath that
 * an operator gave a team keeps its cards out of the run (`rowsWithOtherDefault`),
 * exactly as its new cards are born with that team. A row known to hold no
 * cards (`cardCount` 0) is not walked.
 *
 * Refused while the row's last team change is still cascading
 * (`teamCascadeStartedAt`): the rows beneath are moving, so the list the
 * ledger shows would not be the list the pages walk.
 *
 * Client-paged like `cardPlayersBulk`: a page's cursor is bound to the row
 * the run started from and to the target row it was handed out for, so a
 * checklist whose rows changed between pages is refused rather than walked
 * as the wrong row.
 */

import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireAdmin } from "./auth";
import {
  noTeamCardVerdict,
  stampNoTeam,
  teamDefaultOf,
  type NoTeamKeepReason,
} from "./lib/selectorTeams";

type ReadCtx = Pick<QueryCtx, "db">;
type SelectorRow = Doc<"selectorOptions">;

/**
 * Cards one page reads and stamps. One paginated range, then at most one
 * patch per card: ~200 writes, plus the target walk (at most
 * `MAX_NO_TEAM_WALK` node reads) — inside the ~900 operations the house
 * treats as comfortable (`TEAM_CASCADE_CARD_PAGE` is the same 200).
 */
export const NO_TEAM_PAGE = 200;
/** Rows the walk down reads at most (card-holding or not); past it, `truncated`. */
export const MAX_NO_TEAM_WALK = 500;
/**
 * Cards `noTeamTargets` reads before it stops counting. A confirm dialog wants
 * a number, not a walk of the catalogue; past this the counts are a floor
 * (`truncated`) and the run, which pages, still visits every card. The same
 * 2,000 as the team cascade preview (`TEAM_CASCADE_PREVIEW_CARD_CAP`).
 */
export const NO_TEAM_COUNT_CAP = 2000;
/**
 * How long a `teamCascadeStartedAt` stamp is believed. Keep in step with
 * `TEAM_CASCADE_STALE_MS` in selectorOptions.ts (not imported: that module's
 * graph is not one this small module should pull in).
 */
const TEAM_CASCADE_STALE_MS = 10 * 60 * 1000;
/** Depth cutoff of the walk down; the hierarchy is seven levels. */
const MAX_WALK_DEPTH = 16;

/** Levels a card can sit on (`cardChecklist.selectorOptionId`). */
const CARD_LEVELS: ReadonlySet<string> = new Set(["variantType", "insert", "parallel"]);
/** Levels a set-level team (and so No Team) may be set at; `TEAM_EDITABLE_LEVELS`. */
const TEAM_LEVELS: ReadonlySet<string> = new Set(["setName", "variantType", "insert", "parallel"]);

/** The row asked about is gone. */
export const NO_TEAM_ROW_MISSING = "That part of the set isn't in NB anymore.";
/** The row asked about is a sport, year or manufacturer. */
export const NO_TEAM_WRONG_LEVEL = "No Team goes on a set, not on a sport, year or manufacturer.";
/** The row asked about no longer says No Team. */
export const NO_TEAM_NOT_SET = "This isn't set to No Team anymore, so its cards were left as they are.";
/** The row's last team change is still reaching the rows beneath it. */
export const NO_TEAM_SETTLING = "Still applying the last team change. Try again in a moment.";
/**
 * A cursor this run's checklist no longer matches (a row beneath changed its
 * team default, a row was added or removed), or one no page handed out. The
 * same sentence as `cardPlayersBulk.BULK_CHECKLIST_CHANGED`.
 */
export const NO_TEAM_CHECKLIST_CHANGED = "This checklist changed mid-way. Give it another go.";

const targetValidator = v.object({
  _id: v.id("selectorOptions"),
  /** The row's own NB name. */
  name: v.string(),
  level: v.union(v.literal("variantType"), v.literal("insert"), v.literal("parallel")),
  /** Home cards on the row (`selectorOptions.cardCount`); absent = never counted. */
  cardCount: v.optional(v.number()),
});
type Target = typeof targetValidator.type;

const reasonCountsFields = {
  /** Already marked No Team. */
  alreadyNoTeam: v.number(),
  /** Carries a team. */
  hasTeam: v.number(),
  /** Carries a team name waiting for review. */
  pendingName: v.number(),
  /** The listing names a team NB could not match (product invariant 8). */
  listingNamesTeam: v.number(),
  /** BSC has not answered the card's team lookup yet; stamped when it does. */
  awaitingLookup: v.number(),
  /** The card's team lookup gave up; the operator decides. */
  lookupGaveUp: v.number(),
};
const reasonCountsValidator = v.object(reasonCountsFields);
type ReasonCounts = typeof reasonCountsValidator.type;

function emptyReasonCounts(): ReasonCounts {
  return {
    alreadyNoTeam: 0,
    hasTeam: 0,
    pendingName: 0,
    listingNamesTeam: 0,
    awaitingLookup: 0,
    lookupGaveUp: 0,
  };
}

function bumpReason(counts: ReasonCounts, reason: NoTeamKeepReason): void {
  counts[reason]++;
}

/** The verdict for a stored card, asked with exactly the fields it reads. */
function verdictOf(card: Doc<"cardChecklist">) {
  return noTeamCardVerdict({
    teamOnCardIds: card.teamOnCardIds,
    pendingTeamNames: card.pendingTeamNames,
    teamNoneConfirmedAt: card.teamNoneConfirmedAt,
    bscTeamName: card.bscTeamName,
    teamCheckDoneAt: card.teamCheckDoneAt,
    teamCheckOutcome: card.teamCheckOutcome,
    platformData: card.platformData?.bsc ? { bsc: { ref: card.platformData.bsc.ref } } : {},
  });
}

/**
 * The row asked about, checked: present, at a team level, still No Team, and
 * not mid-cascade. Throws the operator-facing sentence.
 */
async function requireNoTeamRoot(
  ctx: ReadCtx,
  rootId: Id<"selectorOptions">,
): Promise<SelectorRow> {
  const root = await ctx.db.get(rootId);
  if (!root) throw new ConvexError(NO_TEAM_ROW_MISSING);
  if (!TEAM_LEVELS.has(root.level)) throw new ConvexError(NO_TEAM_WRONG_LEVEL);
  if (teamDefaultOf(root).kind !== "noTeam") throw new ConvexError(NO_TEAM_NOT_SET);
  if (
    root.teamCascadeStartedAt !== undefined &&
    Date.now() - root.teamCascadeStartedAt < TEAM_CASCADE_STALE_MS
  ) {
    throw new ConvexError(NO_TEAM_SETTLING);
  }
  return root;
}

/**
 * The card-holding rows the run walks, in walk order (the root first, then
 * depth first through `children` in stored order), and how many card-level
 * rows it leaves out because their own team default is not No Team.
 * Exported for the tests.
 */
export async function noTeamRunTargets(
  ctx: ReadCtx,
  root: SelectorRow,
): Promise<{ targets: Target[]; rowsWithOtherDefault: number; truncated: boolean }> {
  const targets: Target[] = [];
  let rowsWithOtherDefault = 0;
  let truncated = false;
  let read = 0;
  const seen = new Set<string>([root._id as string]);
  const stack: Array<{ row: SelectorRow; depth: number }> = [{ row: root, depth: 0 }];
  while (stack.length > 0) {
    const { row, depth } = stack.pop()!;
    if (CARD_LEVELS.has(row.level)) {
      if (teamDefaultOf(row).kind !== "noTeam") {
        rowsWithOtherDefault++;
      } else if (row.cardCount !== 0) {
        targets.push({
          _id: row._id,
          name: row.value,
          level: row.level as Target["level"],
          ...(row.cardCount !== undefined ? { cardCount: row.cardCount } : {}),
        });
      }
    }
    if (row.level === "parallel" || depth >= MAX_WALK_DEPTH) continue;
    const kids: SelectorRow[] = [];
    for (const childId of row.children ?? []) {
      if (seen.has(childId as string)) continue;
      seen.add(childId as string);
      if (read >= MAX_NO_TEAM_WALK) {
        truncated = true;
        break;
      }
      read++;
      const child = await ctx.db.get(childId);
      if (child) kids.push(child);
    }
    for (let i = kids.length - 1; i >= 0; i--) stack.push({ row: kids[i], depth: depth + 1 });
  }
  return { targets, rowsWithOtherDefault, truncated };
}

/**
 * What the run would do under one row, for the confirm dialog and the
 * progress ledger. Read ONCE, on demand (`useConvex().query`), never
 * subscribed: it reads up to `NO_TEAM_COUNT_CAP` cards.
 *
 * Refuses exactly what `applyNoTeamPage` refuses (a row gone, above a set,
 * not No Team, or mid-cascade), with the same sentence.
 */
export const noTeamTargets = query({
  args: { selectorOptionId: v.id("selectorOptions") },
  returns: v.object({
    /** The ledger's rows, in the order the pages walk them. */
    targets: v.array(
      v.object({
        ...targetValidator.fields,
        /** Cards on this row the run would stamp (a floor when `truncated`). */
        toStamp: v.number(),
      }),
    ),
    /** Cards the run would stamp, across every target. */
    toStamp: v.number(),
    /** Cards left as they are, by why. */
    kept: reasonCountsValidator,
    /** Card-holding rows beneath left out: their own team default is not No Team. */
    rowsWithOtherDefault: v.number(),
    /** A cap was hit (the walk, or the card count); the numbers are a floor. */
    truncated: v.boolean(),
  }),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const root = await requireNoTeamRoot(ctx, args.selectorOptionId);
    const walk = await noTeamRunTargets(ctx, root);
    let truncated = walk.truncated;
    const kept = emptyReasonCounts();
    let toStamp = 0;
    let examined = 0;
    const targets: Array<Target & { toStamp: number }> = [];
    for (const target of walk.targets) {
      let rowStamp = 0;
      const room = NO_TEAM_COUNT_CAP - examined;
      if (room <= 0) {
        truncated = true;
      } else {
        // One over the room, so "exactly at the cap" and "past it" differ.
        const cards = await ctx.db
          .query("cardChecklist")
          .withIndex("by_selector_option", (q) => q.eq("selectorOptionId", target._id))
          .take(room + 1);
        if (cards.length > room) truncated = true;
        for (const card of cards.slice(0, room)) {
          examined++;
          const verdict = verdictOf(card);
          if (verdict.verdict === "stamp") rowStamp++;
          else bumpReason(kept, verdict.reason);
        }
      }
      toStamp += rowStamp;
      targets.push({ ...target, toStamp: rowStamp });
    }
    return { targets, toStamp, kept, rowsWithOtherDefault: walk.rowsWithOtherDefault, truncated };
  },
});

// ───────────────────────────────────────────────────────────────────────────
// The run
// ───────────────────────────────────────────────────────────────────────────

/**
 * Where a run is: `i` the target's index in `noTeamRunTargets` order, `t`
 * that target's id, `c` the page cursor inside it, and `r` the row the run
 * started from. Null for the first page.
 */
type NoTeamCursor = { i: number; t: string | null; c: string | null };

export function parseNoTeamCursor(raw: string | null, rootId: Id<"selectorOptions">): NoTeamCursor {
  if (raw === null) return { i: 0, t: null, c: null };
  try {
    const parsed = JSON.parse(raw) as { i?: unknown; t?: unknown; c?: unknown; r?: unknown };
    if (
      typeof parsed.i === "number" &&
      Number.isInteger(parsed.i) &&
      parsed.i >= 0 &&
      typeof parsed.t === "string" &&
      (parsed.c === null || typeof parsed.c === "string") &&
      parsed.r === rootId
    ) {
      return { i: parsed.i, t: parsed.t, c: parsed.c };
    }
  } catch {
    // fall through
  }
  throw new ConvexError(NO_TEAM_CHECKLIST_CHANGED);
}

function formatNoTeamCursor(
  at: { i: number; t: string; c: string | null },
  rootId: Id<"selectorOptions">,
): string {
  return JSON.stringify({ ...at, r: rootId });
}

const noTeamPageValidator = v.object({
  /** The row this page worked in; null when the run has no rows to walk. */
  targetId: v.union(v.id("selectorOptions"), v.null()),
  targetIndex: v.number(),
  targetCount: v.number(),
  /** Cards this page read. */
  scanned: v.number(),
  /** Cards this page marked No Team. */
  stamped: v.number(),
  /** Cards this page left as they are, by why. */
  kept: reasonCountsValidator,
  /** Pass back for the next page; null when every row is done. */
  cursor: v.union(v.string(), v.null()),
});

export type NoTeamPage = typeof noTeamPageValidator.type;

/**
 * One page of the run, with no auth check: `applyNoTeamPage` checks it first
 * and passes the admin the stamps are credited to. Exported for the tests.
 */
export async function runNoTeamPage(
  ctx: MutationCtx,
  args: { selectorOptionId: Id<"selectorOptions">; cursor: string | null },
  userId: string,
): Promise<NoTeamPage> {
  const at = parseNoTeamCursor(args.cursor, args.selectorOptionId);
  const root = await requireNoTeamRoot(ctx, args.selectorOptionId);
  const { targets } = await noTeamRunTargets(ctx, root);
  const kept = emptyReasonCounts();
  if (targets.length === 0 && args.cursor === null) {
    return { targetId: null, targetIndex: 0, targetCount: 0, scanned: 0, stamped: 0, kept, cursor: null };
  }
  // The cursor names the row it was handed out for; a checklist whose rows
  // moved under the run would otherwise send this page into a different
  // row's cards with another row's page cursor.
  if (at.i >= targets.length || (at.t !== null && (targets[at.i]._id as string) !== at.t)) {
    throw new ConvexError(NO_TEAM_CHECKLIST_CHANGED);
  }
  const target = targets[at.i];
  const page = await ctx.db
    .query("cardChecklist")
    .withIndex("by_selector_option", (q) => q.eq("selectorOptionId", target._id))
    .paginate({ cursor: at.c, numItems: NO_TEAM_PAGE });
  const now = Date.now();
  const stamp = stampNoTeam(userId, now);
  let scanned = 0;
  let stamped = 0;
  for (const card of page.page) {
    scanned++;
    const verdict = verdictOf(card);
    if (verdict.verdict !== "stamp") {
      bumpReason(kept, verdict.reason);
      continue;
    }
    // Only the ruling: the card had no team and no pending name, so its
    // team links, title and description say the same thing after as before.
    await ctx.db.patch(card._id, { ...stamp, lastUpdated: now });
    stamped++;
  }
  const cursor = !page.isDone
    ? formatNoTeamCursor({ i: at.i, t: target._id, c: page.continueCursor }, args.selectorOptionId)
    : at.i + 1 < targets.length
      ? formatNoTeamCursor({ i: at.i + 1, t: targets[at.i + 1]._id, c: null }, args.selectorOptionId)
      : null;
  return {
    targetId: target._id,
    targetIndex: at.i,
    targetCount: targets.length,
    scanned,
    stamped,
    kept,
    cursor,
  };
}

/**
 * Mark the teamless cards beneath a No Team row "No Team", `NO_TEAM_PAGE`
 * cards per call, credited to the calling admin. Call again with the returned
 * `cursor` until it is null. Idempotent: a card already No Team is counted
 * (`kept.alreadyNoTeam`), never rewritten.
 */
export const applyNoTeamPage = mutation({
  args: {
    /** The row that was given No Team: a set, variant type, insert or parallel. */
    selectorOptionId: v.id("selectorOptions"),
    /** Null for the first page; then the `cursor` the last page returned. */
    cursor: v.union(v.string(), v.null()),
  },
  returns: noTeamPageValidator,
  handler: async (ctx, args) => {
    const userId = await requireAdmin(ctx);
    const result = await runNoTeamPage(ctx, args, userId);
    // Ids and counts only.
    console.log(
      JSON.stringify({
        msg: "card_no_team_bulk_page",
        selectorOptionId: args.selectorOptionId,
        targetId: result.targetId,
        targetIndex: result.targetIndex,
        targetCount: result.targetCount,
        scanned: result.scanned,
        stamped: result.stamped,
        kept: result.kept,
        done: result.cursor === null,
        userId,
      }),
    );
    return result;
  },
});
