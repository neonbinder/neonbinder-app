/**
 * NEO-645 — the three data migrations behind One-card Tidy Up.
 *
 *   M1 `migrateSkipsToAnswers`        every `entityReviewSkips` row becomes a
 *      `tidyNames` row answered "not an entity". The skips table is never
 *      touched: the readers dual-read until the cleanup step retires it.
 *   M2 `backfillLegacyPendingNames`   a card's `pendingPlayerNames` /
 *      `pendingTeamNames` get a `tidyNames` row and a `cardPrintedNames` row
 *      each, so the walk and the fan-out can find them. A pending spelling that
 *      a linked `nameOnCard` already answers, or that was ruled "not an
 *      entity", is dropped from the card.
 *   M3 `drainEntityReviewQueue`       the review queue's staged rows go; the
 *      old wizard's batches are meaningless once its answers are `tidyNames`.
 *
 * ## Running one
 *
 *   # 1. dry run (the default): reports exactly what an armed run would do
 *   npx convex run tidyMigrations:migrateSkipsToAnswers '{}'
 *
 *   # 2. arm the deployment, then run for real
 *   npx convex env set TIDY_MIGRATION_ARMED 1
 *   npx convex run tidyMigrations:migrateSkipsToAnswers '{"confirm":"APPLY"}'
 *   npx convex env remove TIDY_MIGRATION_ARMED
 *
 * Two independent arms, as every scripted admin task here: `confirm: "APPLY"`
 * per invocation, `TIDY_MIGRATION_ARMED=1` per deployment. An armed call on an
 * unarmed deployment is REFUSED with the report still returned (it runs dry).
 * No `--identity`: these are internal functions, so deploy credentials are the
 * real gate.
 *
 * The dry and the armed run call ONE planner (the page mutation, `apply` true
 * or false), so a dry run's counts are the armed run's counts. Every loop
 * pages with a real cursor and stops on `isDone`; re-running is safe
 * (idempotent: a row already migrated is counted and left alone).
 */

import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { findSportForSelectorOption } from "./cardChecklist";
import {
  listCardPrintedNames,
  syncCardPrintedNames,
  type DesiredPrintedName,
} from "./cardPrintedNames";
import { normalizeEntityName } from "../lib/entities/normalize-name";

export const MIGRATION_ENV_FLAG = "TIDY_MIGRATION_ARMED";
export const SKIPS_PAGE = 100;
export const CARDS_PAGE = 50;
export const QUEUE_PAGE = 500;
/** System-operation budget of one M2 page; a card is never started past it. */
export const CARDS_OP_BUDGET = 900;
/** Safety stop for a loop: no migration pages more than this many times. */
const MAX_PAGES = 100_000;
const MAX_NAME = 120;

const modeValidator = v.union(v.literal("dryRun"), v.literal("applied"));

type Arming = { apply: boolean; refused?: string };

function armingFor(confirm: string | undefined): Arming {
  if (confirm === undefined) return { apply: false };
  if (confirm !== "APPLY") {
    return { apply: false, refused: `confirm must be "APPLY"; ran as a dry run.` };
  }
  if (process.env[MIGRATION_ENV_FLAG] !== "1") {
    return {
      apply: false,
      refused: `${MIGRATION_ENV_FLAG} is not set to 1 on this deployment; ran as a dry run.`,
    };
  }
  return { apply: true };
}

/** The mutation re-checks the arm itself: an internal caller cannot skip it. */
function assertArmedToWrite(apply: boolean): void {
  if (apply && process.env[MIGRATION_ENV_FLAG] !== "1") {
    throw new Error(`${MIGRATION_ENV_FLAG} is not set to 1: refusing to write.`);
  }
}

const trimName = (name: string) => name.replace(/\s+/g, " ").trim().slice(0, MAX_NAME);

// ─── M1: skips -> "not an entity" answers ───────────────────────────────────

const skipsPageReturns = v.object({
  scanned: v.number(),
  inserted: v.number(),
  answered: v.number(),
  alreadyMigrated: v.number(),
  conflicts: v.number(),
  leafGone: v.number(),
  isDone: v.boolean(),
  continueCursor: v.string(),
});

export const migrateSkipsPage = internalMutation({
  args: { cursor: v.union(v.string(), v.null()), apply: v.boolean() },
  returns: skipsPageReturns,
  handler: async (ctx, args) => {
    assertArmedToWrite(args.apply);
    const page = await ctx.db
      .query("entityReviewSkips")
      .paginate({ cursor: args.cursor, numItems: SKIPS_PAGE });
    const sportOfLeaf = new Map<string, Id<"selectorOptions"> | null>();
    const out = { inserted: 0, answered: 0, alreadyMigrated: 0, conflicts: 0, leafGone: 0 };
    for (const skip of page.page) {
      const leaf = await ctx.db.get(skip.selectorOptionId);
      if (!leaf) {
        out.leafGone += 1;
        continue;
      }
      const leafKey = leaf._id as string;
      if (!sportOfLeaf.has(leafKey)) {
        sportOfLeaf.set(leafKey, (await findSportForSelectorOption(ctx, leaf._id)) ?? null);
      }
      const sportId = sportOfLeaf.get(leafKey);
      if (!sportId) {
        out.leafGone += 1;
        continue;
      }
      // Re-derived, not trusted: the stored key may predate the current matcher.
      const key = normalizeEntityName(skip.name);
      if (!key) {
        out.leafGone += 1;
        continue;
      }
      const row = await ctx.db
        .query("tidyNames")
        .withIndex("by_scope_kind_name", (q) =>
          q.eq("scopeId", leaf._id).eq("kind", skip.kind).eq("nameNormalized", key),
        )
        .first();
      if (!row) {
        out.inserted += 1;
        if (args.apply) {
          await ctx.db.insert("tidyNames", {
            scopeId: leaf._id,
            kind: skip.kind,
            nameNormalized: key,
            name: trimName(skip.name),
            sportId,
            status: "ready",
            answer: { kind: "notEntity", by: "operator" },
            answerGen: 1,
            answeredByUserId: skip.skippedByUserId,
            answeredAt: skip.skippedAt,
          });
        }
      } else if (!row.answer) {
        out.answered += 1;
        if (args.apply) {
          await ctx.db.patch(row._id, {
            answer: { kind: "notEntity", by: "operator" },
            answerGen: (row.answerGen ?? 0) + 1,
            answeredByUserId: skip.skippedByUserId,
            answeredAt: skip.skippedAt,
          });
        }
      } else if (row.answer.kind === "notEntity") {
        out.alreadyMigrated += 1;
      } else {
        // An operator linked this name since; the link wins and is not undone.
        out.conflicts += 1;
      }
    }
    return {
      scanned: page.page.length,
      ...out,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

export const migrateSkipsToAnswers = internalAction({
  args: { confirm: v.optional(v.string()) },
  returns: v.object({
    mode: modeValidator,
    refused: v.optional(v.string()),
    pages: v.number(),
    scanned: v.number(),
    inserted: v.number(),
    answered: v.number(),
    alreadyMigrated: v.number(),
    conflicts: v.number(),
    leafGone: v.number(),
  }),
  handler: async (ctx, args) => {
    const arming = armingFor(args.confirm);
    const total = { scanned: 0, inserted: 0, answered: 0, alreadyMigrated: 0, conflicts: 0, leafGone: 0 };
    let cursor: string | null = null;
    let pages = 0;
    for (;;) {
      if (pages >= MAX_PAGES) throw new Error("migrateSkipsToAnswers: did not finish");
      const page: {
        scanned: number;
        inserted: number;
        answered: number;
        alreadyMigrated: number;
        conflicts: number;
        leafGone: number;
        isDone: boolean;
        continueCursor: string;
      } = await ctx.runMutation(internal.tidyMigrations.migrateSkipsPage, {
        cursor,
        apply: arming.apply,
      });
      pages += 1;
      for (const key of Object.keys(total) as Array<keyof typeof total>) total[key] += page[key];
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
    return {
      mode: arming.apply ? ("applied" as const) : ("dryRun" as const),
      ...(arming.refused ? { refused: arming.refused } : {}),
      pages,
      ...total,
    };
  },
});

// ─── M2: pending names on cards -> name rows + printed rows ─────────────────

/** What one card's migration decided. Pure over the card and what was read. */
export type CardMigrationPlan = {
  pendingPlayerNames: string[] | undefined;
  pendingTeamNames: string[] | undefined;
  /** Pending spellings dropped from the card (answered or ruled out). */
  dropped: number;
  /** Names that need a `tidyNames` row, (kind, key, spelling). */
  nameRows: Array<{ kind: "player" | "team"; key: string; name: string }>;
  /** The printed rows the card should carry for its still-pending names. */
  printed: DesiredPrintedName[];
  patchesPending: boolean;
};

/**
 * The planner, shared by the dry and the armed run. `ruledOut(kind, key)` says a
 * name's row is answered "not an entity" (or a legacy skip); `linkedKeys` are
 * the normalised `nameOnCard` of the card's player links.
 */
export function planCardMigration(
  card: Pick<
    Doc<"cardChecklist">,
    "selectorOptionId" | "pendingPlayerNames" | "pendingTeamNames" | "playerLinks" | "teamOnCardIds"
  >,
  ruledOut: (kind: "player" | "team", key: string) => boolean,
): CardMigrationPlan {
  const linkedKeys = new Set(
    (card.playerLinks ?? []).map((l) => normalizeEntityName(l.nameOnCard)),
  );
  const nameRows: CardMigrationPlan["nameRows"] = [];
  const printed: DesiredPrintedName[] = [];
  let dropped = 0;
  const keep = (
    kind: "player" | "team",
    names: ReadonlyArray<string> | undefined,
    firstOrder: number,
  ): string[] | undefined => {
    const kept: string[] = [];
    for (const raw of names ?? []) {
      const name = trimName(raw);
      const key = normalizeEntityName(name);
      if (!key) {
        dropped += 1;
        continue;
      }
      if ((kind === "player" && linkedKeys.has(key)) || ruledOut(kind, key)) {
        dropped += 1;
        continue;
      }
      if (!nameRows.some((r) => r.kind === kind && r.key === key)) {
        nameRows.push({ kind, key, name });
      }
      printed.push({
        kind,
        scopeId: card.selectorOptionId,
        nameNormalized: key,
        printed: name,
        order: firstOrder + kept.length,
      });
      kept.push(raw);
    }
    return kept.length > 0 ? kept : undefined;
  };
  const players = keep("player", card.pendingPlayerNames, (card.playerLinks ?? []).length);
  const teams = keep("team", card.pendingTeamNames, (card.teamOnCardIds ?? []).length);
  const samePending = (a: string[] | undefined, b: ReadonlyArray<string> | undefined) =>
    JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
  return {
    pendingPlayerNames: players,
    pendingTeamNames: teams,
    dropped,
    nameRows,
    printed,
    patchesPending:
      !samePending(players, card.pendingPlayerNames) || !samePending(teams, card.pendingTeamNames),
  };
}

const cardsPageReturns = v.object({
  scanned: v.number(),
  cardsWithNames: v.number(),
  nameRowsInserted: v.number(),
  printedRows: v.number(),
  pendingDropped: v.number(),
  cardsPatched: v.number(),
  /** The cursor the next call pages from (the SAME one when `resumeAfter` is set). */
  continueCursor: v.union(v.string(), v.null()),
  /**
   * Set when the op budget stopped the page part-way: the last card this call
   * finished. The next call re-reads the same page and starts after it, so a
   * card is never skipped and a card that shares a `_creationTime` with it is
   * never lost (a bare `_creationTime` cursor skipped those).
   */
  resumeAfter: v.union(v.id("cardChecklist"), v.null()),
  isDone: v.boolean(),
});

async function readNameRow(
  ctx: MutationCtx,
  scopeId: Id<"selectorOptions">,
  kind: "player" | "team",
  key: string,
) {
  return await ctx.db
    .query("tidyNames")
    .withIndex("by_scope_kind_name", (q) =>
      q.eq("scopeId", scopeId).eq("kind", kind).eq("nameNormalized", key),
    )
    .first();
}

export const backfillLegacyPendingNamesPage = internalMutation({
  args: {
    cursor: v.union(v.string(), v.null()),
    /** The last card a budget-stopped call finished; see `cardsPageReturns`. */
    resumeAfter: v.optional(v.union(v.id("cardChecklist"), v.null())),
    apply: v.boolean(),
    /** Tests only: a smaller page. */
    pageSize: v.optional(v.number()),
    /** Tests only: a smaller op budget. */
    opBudget: v.optional(v.number()),
  },
  returns: cardsPageReturns,
  handler: async (ctx, args) => {
    assertArmedToWrite(args.apply);
    const size = Math.max(1, Math.min(args.pageSize ?? CARDS_PAGE, CARDS_PAGE));
    const budget = Math.max(1, Math.min(args.opBudget ?? CARDS_OP_BUDGET, CARDS_OP_BUDGET));
    const page = await ctx.db
      .query("cardChecklist")
      .withIndex("by_creation_time")
      .paginate({ cursor: args.cursor, numItems: size });
    // Resume part-way through the page a budget stop left. A card that is no
    // longer in the page (deleted since) restarts the page: every step below is
    // idempotent, so doing a card twice is harmless and skipping one is not.
    const resumeAt = args.resumeAfter
      ? page.page.findIndex((c) => c._id === args.resumeAfter)
      : -1;
    const cards = page.page.slice(resumeAt + 1);
    let ops = 1;
    let lastDone: Id<"cardChecklist"> | null = args.resumeAfter ?? null;
    let scanned = 0;
    const out = { cardsWithNames: 0, nameRowsInserted: 0, printedRows: 0, pendingDropped: 0, cardsPatched: 0 };
    let stoppedEarly = false;
    for (const card of cards) {
      const hasPending =
        (card.pendingPlayerNames?.length ?? 0) > 0 || (card.pendingTeamNames?.length ?? 0) > 0;
      if (!hasPending) {
        scanned += 1;
        lastDone = card._id;
        continue;
      }
      // A card with names costs its names x ~3 plus its own reads and writes.
      const names = (card.pendingPlayerNames?.length ?? 0) + (card.pendingTeamNames?.length ?? 0);
      const cost = 4 + names * 3;
      if (scanned > 0 && ops + cost > budget) {
        stoppedEarly = true;
        break;
      }
      // What each name's row says, read once (the planner is pure over it).
      const ruled = new Map<string, boolean>();
      for (const [kind, list] of [
        ["player", card.pendingPlayerNames],
        ["team", card.pendingTeamNames],
      ] as const) {
        for (const raw of list ?? []) {
          const key = normalizeEntityName(trimName(raw));
          if (!key || ruled.has(`${kind}|${key}`)) continue;
          const row = await readNameRow(ctx, card.selectorOptionId, kind, key);
          ops += 1;
          const legacy =
            !row &&
            (await ctx.db
              .query("entityReviewSkips")
              .withIndex("by_selector_option_and_kind_and_name", (q) =>
                q.eq("selectorOptionId", card.selectorOptionId).eq("kind", kind).eq("nameNormalized", key),
              )
              .first());
          if (!row) ops += 1;
          ruled.set(`${kind}|${key}`, row?.answer?.kind === "notEntity" || !!legacy);
        }
      }
      const plan = planCardMigration(card, (kind, key) => ruled.get(`${kind}|${key}`) === true);
      out.cardsWithNames += 1;
      out.pendingDropped += plan.dropped;
      out.printedRows += plan.printed.length;
      for (const nameRow of plan.nameRows) {
        const exists = await readNameRow(ctx, card.selectorOptionId, nameRow.kind, nameRow.key);
        ops += 1;
        if (exists) continue;
        out.nameRowsInserted += 1;
        if (args.apply) {
          await ctx.db.insert("tidyNames", {
            scopeId: card.selectorOptionId,
            kind: nameRow.kind,
            nameNormalized: nameRow.key,
            name: nameRow.name,
            sportId: card.sportId,
            status: "ready",
          });
          ops += 1;
        }
      }
      if (args.apply) {
        // The printed rows the card already has are kept; the plan adds its own.
        const have = await listCardPrintedNames(ctx, card._id);
        const keepRows: DesiredPrintedName[] = have
          .filter((row) => !plan.printed.some((p) => p.kind === row.kind && p.nameNormalized === row.nameNormalized))
          .map((row) => ({
            kind: row.kind,
            scopeId: row.scopeId,
            nameNormalized: row.nameNormalized,
            printed: row.printed,
            order: row.order,
            ...(row.cardOverride ? { cardOverride: true as const } : {}),
          }));
        await syncCardPrintedNames(ctx, card, [...keepRows, ...plan.printed]);
        ops += 3 + plan.printed.length;
        if (plan.patchesPending) {
          // Only the two lists: no `lastUpdated` bump (the NEO-203 baseVersion).
          await ctx.db.patch(card._id, {
            pendingPlayerNames: plan.pendingPlayerNames,
            pendingTeamNames: plan.pendingTeamNames,
          });
          ops += 1;
        }
      }
      if (plan.patchesPending) out.cardsPatched += 1;
      scanned += 1;
      lastDone = card._id;
    }
    if (stoppedEarly) {
      return {
        scanned,
        ...out,
        continueCursor: args.cursor,
        resumeAfter: lastDone,
        isDone: false,
      };
    }
    return {
      scanned,
      ...out,
      continueCursor: page.isDone ? null : page.continueCursor,
      resumeAfter: null,
      isDone: page.isDone,
    };
  },
});

export const backfillLegacyPendingNames = internalAction({
  args: { confirm: v.optional(v.string()) },
  returns: v.object({
    mode: modeValidator,
    refused: v.optional(v.string()),
    pages: v.number(),
    scanned: v.number(),
    cardsWithNames: v.number(),
    nameRowsInserted: v.number(),
    printedRows: v.number(),
    pendingDropped: v.number(),
    cardsPatched: v.number(),
  }),
  handler: async (ctx, args) => {
    const arming = armingFor(args.confirm);
    const total = {
      scanned: 0,
      cardsWithNames: 0,
      nameRowsInserted: 0,
      printedRows: 0,
      pendingDropped: 0,
      cardsPatched: 0,
    };
    let cursor: string | null = null;
    let resumeAfter: Id<"cardChecklist"> | null = null;
    let pages = 0;
    for (;;) {
      if (pages >= MAX_PAGES) throw new Error("backfillLegacyPendingNames: did not finish");
      const page: typeof total & {
        continueCursor: string | null;
        resumeAfter: Id<"cardChecklist"> | null;
        isDone: boolean;
      } = await ctx.runMutation(internal.tidyMigrations.backfillLegacyPendingNamesPage, {
        cursor,
        resumeAfter,
        apply: arming.apply,
      });
      pages += 1;
      for (const key of Object.keys(total) as Array<keyof typeof total>) total[key] += page[key];
      if (page.isDone) break;
      cursor = page.continueCursor;
      resumeAfter = page.resumeAfter;
    }
    return {
      mode: arming.apply ? ("applied" as const) : ("dryRun" as const),
      ...(arming.refused ? { refused: arming.refused } : {}),
      pages,
      ...total,
    };
  },
});

// ─── M3: drain the review queue ─────────────────────────────────────────────

export const drainEntityReviewQueuePage = internalMutation({
  args: { cursor: v.union(v.string(), v.null()), apply: v.boolean() },
  returns: v.object({
    scanned: v.number(),
    deleted: v.number(),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    assertArmedToWrite(args.apply);
    const page = await ctx.db
      .query("entityReviewQueue")
      .paginate({ cursor: args.cursor, numItems: QUEUE_PAGE });
    if (args.apply) for (const row of page.page) await ctx.db.delete(row._id);
    return {
      scanned: page.page.length,
      deleted: args.apply ? page.page.length : 0,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

export const drainEntityReviewQueue = internalAction({
  args: { confirm: v.optional(v.string()) },
  returns: v.object({
    mode: modeValidator,
    refused: v.optional(v.string()),
    pages: v.number(),
    scanned: v.number(),
    deleted: v.number(),
  }),
  handler: async (ctx, args) => {
    const arming = armingFor(args.confirm);
    let cursor: string | null = null;
    let pages = 0;
    let scanned = 0;
    let deleted = 0;
    for (;;) {
      if (pages >= MAX_PAGES) throw new Error("drainEntityReviewQueue: did not finish");
      const page: { scanned: number; deleted: number; isDone: boolean; continueCursor: string } =
        await ctx.runMutation(internal.tidyMigrations.drainEntityReviewQueuePage, {
          cursor,
          apply: arming.apply,
        });
      pages += 1;
      scanned += page.scanned;
      deleted += page.deleted;
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
    return {
      mode: arming.apply ? ("applied" as const) : ("dryRun" as const),
      ...(arming.refused ? { refused: arming.refused } : {}),
      pages,
      scanned,
      deleted,
    };
  },
});
