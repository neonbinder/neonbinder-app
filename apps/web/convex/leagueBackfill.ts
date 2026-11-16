/**
 * NEO-569 — the armed, one-time move from the free-text `features.league`
 * ("MLB") to NB league ids: a set's `selectorOptions.leagueIds` and a card's
 * `cardChecklist.leagueId`. The ONLY module that still reads the legacy key
 * (`leagueBackfill.pin.test.ts` holds that line).
 *
 * ## Three phases, run in order
 *
 *  1. **sets** — `setName`, then `variantType`, `insert`, `parallel` rows with
 *     no `leagueIds` of their own whose legacy text resolves to a league of
 *     their sport: by name or alias (`findLeagueByName`), else by a unique
 *     abbreviation (`leagueByUniqueAbbreviation`). A row BELOW a set is written
 *     only where its text differs from its parent's: every row under a set
 *     carries a copy of the set's text, and a copy is inherited, not stored
 *     again (`lib/selectorLeagues`). Never creates a league.
 *  2. **cards** — every card with no `leagueId`: its teams all in one league →
 *     that league; teams in two leagues → left for an admin; no usable team (no
 *     team, or a team without a league) → its legacy text resolved in its
 *     sport; no text → its set's league when the set has exactly one; else
 *     left blank. Runs after **sets** (the last step reads the sets' lists).
 *  3. **strip** — removes the `league` key from `features` on `setName`,
 *     `variantType`, `insert` and `parallel` rows, on year and brand
 *     (`manufacturer`) rows, and on cards, dropping a map that ends up empty. Text that does not resolve is KEPT (it is the only
 *     record of what an operator typed) unless `includeUnresolved: true`.
 *     Never touches a sport row (reference seed).
 *
 * Every phase is idempotent: a re-run counts what is already done and writes
 * nothing for it.
 *
 * ## Operator commands
 *
 *   # dry run, per phase — reports what an armed run would write
 *   npx convex run leagueBackfill:run '{"phase":"sets"}'
 *
 *   # arm the deployment, run each phase for real, disarm
 *   npx convex env set ALLOW_LEAGUE_BACKFILL 1
 *   npx convex run leagueBackfill:run '{"phase":"sets","confirm":"BACKFILL"}'
 *   npx convex run leagueBackfill:run '{"phase":"cards","confirm":"BACKFILL"}'
 *   npx convex run leagueBackfill:run '{"phase":"strip","confirm":"BACKFILL"}'
 *   npx convex env remove ALLOW_LEAGUE_BACKFILL
 *
 *   # re-run a phase until "complete": true; pass the returned `cursor` back
 *   # to resume where the last call stopped.
 *
 * The NEO-214 pair, exactly as `cardTeamLinks.backfillCardTeamLinks`:
 * `confirm: "BACKFILL"` per invocation, the deployment flag per deployment.
 * An armed invocation on an unarmed deployment is REPORTED as refused rather
 * than thrown, so the dry-run numbers still come back.
 */

import { ConvexError, v } from "convex/values";
import { internalAction, internalMutation, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { findLeagueByName, leagueByUniqueAbbreviation } from "./leagues";
import {
  effectiveSetLeagueIds,
  sportOfSelectorOption,
  type SelectorLeagueCache,
} from "./lib/selectorLeagues";
import { newCardLeagueCache, teamLeagueIdsFor } from "./cardLeague";

// ───────────────────────────────────────────────────────────────────────────
// Arming
// ───────────────────────────────────────────────────────────────────────────

const CONFIRM_TOKEN = "BACKFILL";
const ENV_FLAG = "ALLOW_LEAGUE_BACKFILL";

function deploymentIsArmed(): boolean {
  const value = process.env[ENV_FLAG];
  return value === "1" || value === "true";
}

const NOT_ARMED_MESSAGE =
  `Refused: this deployment is not armed for the backfill. ` +
  `Set ${ENV_FLAG}=1 on it (npx convex env set ${ENV_FLAG} 1), re-run, and ` +
  `remove the flag afterwards. Nothing was written; the counts below are what ` +
  `an armed run would have done.`;
const APPLIED_MESSAGE = "Applied. Re-run to confirm the steady state.";
const DRY_RUN_MESSAGE =
  `Dry run — nothing written. Arm with ${ENV_FLAG}=1 on the deployment and ` +
  `re-run with {"confirm":"${CONFIRM_TOKEN}"} to apply.`;

/** Rows per page: a row costs a handful of cached reads and at most one write. */
const ROWS_PER_PAGE = 200;

/** A call stops after the first page that lands past this; re-run to resume. */
const TIME_BUDGET_MS = 150_000;

/** Distinct unresolved texts reported per call. */
const MAX_UNRESOLVED_REPORTED = 100;

const SET_LEVELS = ["setName", "variantType", "insert", "parallel"] as const;
type SetLevel = (typeof SET_LEVELS)[number];

/**
 * The strip phase's stages: the four set levels, the year and brand rows
 * above them (their copy of the old feature is read by nothing now), then the
 * cards. Never `sport`.
 */
const STRIP_STAGES = [...SET_LEVELS, "year", "manufacturer", "cards"] as const;

const phaseValidator = v.union(v.literal("sets"), v.literal("cards"), v.literal("strip"));
type Phase = "sets" | "cards" | "strip";

function stageCount(phase: Phase): number {
  return phase === "sets" ? SET_LEVELS.length : phase === "strip" ? STRIP_STAGES.length : 1;
}

// ───────────────────────────────────────────────────────────────────────────
// Resolving legacy text
// ───────────────────────────────────────────────────────────────────────────

/** The legacy free-text League a row carries, trimmed; undefined when none. */
export function legacyLeagueText(
  features: Readonly<Record<string, string>> | undefined,
): string | undefined {
  const text = features?.league?.trim();
  return text ? text : undefined;
}

type Resolution = { leagueId: Id<"leagues">; how: "byNameOrAlias" | "byAbbreviation" } | null;

/** One page's memo of text → league, per sport. */
type ResolveCache = {
  bySportText: Map<string, Resolution>;
  sportLeagues: Map<string, Array<Doc<"leagues">>>;
  sportOf: Map<string, Id<"selectorOptions"> | undefined>;
};

function newResolveCache(): ResolveCache {
  return { bySportText: new Map(), sportLeagues: new Map(), sportOf: new Map() };
}

async function sportFor(
  ctx: MutationCtx,
  selectorOptionId: Id<"selectorOptions">,
  cache: ResolveCache,
): Promise<Id<"selectorOptions"> | undefined> {
  if (!cache.sportOf.has(selectorOptionId)) {
    cache.sportOf.set(selectorOptionId, await sportOfSelectorOption(ctx, selectorOptionId));
  }
  return cache.sportOf.get(selectorOptionId);
}

/**
 * The league `text` names in `sportId`: by name or alias first, then by a
 * unique abbreviation. Never creates one; null when nothing answers.
 */
async function resolveLegacyText(
  ctx: MutationCtx,
  text: string,
  sportId: Id<"selectorOptions"> | undefined,
  cache: ResolveCache,
): Promise<Resolution> {
  if (!sportId) return null;
  const key = `${sportId}|${text.toLowerCase()}`;
  if (cache.bySportText.has(key)) return cache.bySportText.get(key) ?? null;
  let answer: Resolution = null;
  const byName = await findLeagueByName(ctx, { name: text, sportId });
  if (byName) {
    answer = { leagueId: byName._id, how: "byNameOrAlias" };
  } else {
    let leagues = cache.sportLeagues.get(sportId);
    if (!leagues) {
      leagues = await ctx.db
        .query("leagues")
        .withIndex("by_sport_id", (q) => q.eq("sportId", sportId))
        .collect();
      cache.sportLeagues.set(sportId, leagues);
    }
    const byAbbreviation = leagueByUniqueAbbreviation(leagues, text);
    if (byAbbreviation) answer = { leagueId: byAbbreviation._id, how: "byAbbreviation" };
  }
  cache.bySportText.set(key, answer);
  return answer;
}

// ───────────────────────────────────────────────────────────────────────────
// Pages
// ───────────────────────────────────────────────────────────────────────────

const unresolvedValidator = v.array(v.object({ text: v.string(), count: v.number() }));

const pageResultValidator = v.object({
  counts: v.record(v.string(), v.number()),
  unresolved: unresolvedValidator,
  isDone: v.boolean(),
  continueCursor: v.string(),
});

type Counts = Record<string, number>;

function bump(counts: Counts, key: string, by = 1): void {
  counts[key] = (counts[key] ?? 0) + by;
}

function noteUnresolved(map: Map<string, number>, text: string): void {
  map.set(text, (map.get(text) ?? 0) + 1);
}

function unresolvedList(map: Map<string, number>): Array<{ text: string; count: number }> {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_UNRESOLVED_REPORTED)
    .map(([text, count]) => ({ text, count }));
}

/** Phase 1, one page of one set level. */
async function setsPage(
  ctx: MutationCtx,
  level: SetLevel,
  cursor: string | null,
  apply: boolean,
) {
  const page = await ctx.db
    .query("selectorOptions")
    .withIndex("by_level", (q) => q.eq("level", level))
    .paginate({ cursor, numItems: ROWS_PER_PAGE });
  const counts: Counts = {};
  const unresolved = new Map<string, number>();
  const cache = newResolveCache();
  const parentText = new Map<string, string | undefined>();
  for (const row of page.page) {
    bump(counts, "scanned");
    if (row.leagueIds && row.leagueIds.length > 0) {
      bump(counts, "alreadySet");
      continue;
    }
    const text = legacyLeagueText(row.features);
    if (!text) {
      bump(counts, "noLegacyText");
      continue;
    }
    if (level !== "setName" && row.parentId) {
      if (!parentText.has(row.parentId)) {
        const parent = await ctx.db.get(row.parentId);
        parentText.set(row.parentId, legacyLeagueText(parent?.features));
      }
      const inherited = parentText.get(row.parentId);
      if (inherited !== undefined && inherited.toLowerCase() === text.toLowerCase()) {
        bump(counts, "copyOfParent");
        continue;
      }
    }
    const resolved = await resolveLegacyText(ctx, text, await sportFor(ctx, row._id, cache), cache);
    if (!resolved) {
      bump(counts, "unresolved");
      noteUnresolved(unresolved, text);
      continue;
    }
    bump(counts, resolved.how);
    bump(counts, "written");
    if (apply) await ctx.db.patch(row._id, { leagueIds: [resolved.leagueId] });
  }
  return { page, counts, unresolved };
}

/** Phase 2, one page of cards. */
async function cardsPage(ctx: MutationCtx, cursor: string | null, apply: boolean) {
  const page = await ctx.db.query("cardChecklist").paginate({ cursor, numItems: ROWS_PER_PAGE });
  const counts: Counts = {};
  const unresolved = new Map<string, number>();
  const cache = newResolveCache();
  const leagueCache = newCardLeagueCache();
  const setLeagues: SelectorLeagueCache = leagueCache.setLeagues;
  for (const card of page.page) {
    bump(counts, "scanned");
    if (card.leagueId) {
      bump(counts, "alreadySet");
      continue;
    }
    const teamLeagueIds = await teamLeagueIdsFor(ctx, card.teamOnCardIds, leagueCache);
    let leagueId: Id<"leagues"> | undefined;
    if (teamLeagueIds.length > 0 && !teamLeagueIds.includes(null)) {
      const distinct = new Set(teamLeagueIds);
      if (distinct.size > 1) {
        bump(counts, "mixedTeamLeagues");
        continue;
      }
      leagueId = teamLeagueIds[0] ?? undefined;
      bump(counts, "fromTeams");
    } else {
      // No usable team: none at all, or one without a league.
      if (teamLeagueIds.length > 0) bump(counts, "teamWithoutLeague");
      const text = legacyLeagueText(card.features);
      if (text) {
        const resolved = await resolveLegacyText(
          ctx,
          text,
          await sportFor(ctx, card.selectorOptionId, cache),
          cache,
        );
        if (!resolved) {
          bump(counts, "legacyUnresolved");
          noteUnresolved(unresolved, text);
          continue;
        }
        leagueId = resolved.leagueId;
        bump(counts, "fromLegacyText");
      } else {
        const fromSet = [
          ...new Set(await effectiveSetLeagueIds(ctx, card.selectorOptionId, setLeagues)),
        ];
        if (fromSet.length !== 1) {
          bump(counts, "noSignal");
          continue;
        }
        leagueId = fromSet[0];
        bump(counts, "fromSetOnlyLeague");
      }
    }
    if (!leagueId) continue;
    bump(counts, "written");
    if (apply) await ctx.db.patch(card._id, { leagueId });
  }
  return { page, counts, unresolved };
}

/** `features` without the legacy key, or undefined when nothing is left. */
function withoutLeague(
  features: Readonly<Record<string, string>>,
): Record<string, string> | undefined {
  const rest: Record<string, string> = { ...features };
  delete rest.league;
  return Object.keys(rest).length > 0 ? rest : undefined;
}

/** Phase 3, one page of one stage (a set level, or the cards). */
async function stripPage(
  ctx: MutationCtx,
  stage: (typeof STRIP_STAGES)[number],
  cursor: string | null,
  apply: boolean,
  includeUnresolved: boolean,
) {
  const page =
    stage === "cards"
      ? await ctx.db.query("cardChecklist").paginate({ cursor, numItems: ROWS_PER_PAGE })
      : await ctx.db
          .query("selectorOptions")
          .withIndex("by_level", (q) => q.eq("level", stage))
          .paginate({ cursor, numItems: ROWS_PER_PAGE });
  const counts: Counts = {};
  const unresolved = new Map<string, number>();
  const cache = newResolveCache();
  for (const row of page.page as Array<Doc<"selectorOptions"> | Doc<"cardChecklist">>) {
    bump(counts, "scanned");
    const features = row.features;
    if (!features || !("league" in features)) continue;
    const text = legacyLeagueText(features);
    if (text && !includeUnresolved) {
      const at = "selectorOptionId" in row ? row.selectorOptionId : row._id;
      const resolved = await resolveLegacyText(ctx, text, await sportFor(ctx, at, cache), cache);
      if (!resolved) {
        bump(counts, "keptUnresolved");
        noteUnresolved(unresolved, text);
        continue;
      }
    }
    bump(
      counts,
      stage === "cards"
        ? "cardsStripped"
        : stage === "year" || stage === "manufacturer"
          ? "yearOrBrandRowsStripped"
          : "setRowsStripped",
    );
    if (apply) await ctx.db.patch(row._id, { features: withoutLeague(features) });
  }
  return { page, counts, unresolved };
}

/**
 * One page of one phase's stage. `apply: false` computes the same plan and
 * writes nothing. Re-asserts the arming itself when applying.
 */
export const page = internalMutation({
  args: {
    phase: phaseValidator,
    stage: v.number(),
    cursor: v.union(v.string(), v.null()),
    apply: v.boolean(),
    includeUnresolved: v.optional(v.boolean()),
  },
  returns: pageResultValidator,
  handler: async (ctx, args) => {
    if (args.apply && !deploymentIsArmed()) {
      throw new ConvexError(NOT_ARMED_MESSAGE);
    }
    if (!Number.isInteger(args.stage) || args.stage < 0 || args.stage >= stageCount(args.phase)) {
      throw new ConvexError(`No stage ${args.stage} in the ${args.phase} phase.`);
    }
    const result =
      args.phase === "sets"
        ? await setsPage(ctx, SET_LEVELS[args.stage], args.cursor, args.apply)
        : args.phase === "cards"
          ? await cardsPage(ctx, args.cursor, args.apply)
          : await stripPage(
              ctx,
              STRIP_STAGES[args.stage],
              args.cursor,
              args.apply,
              args.includeUnresolved ?? false,
            );
    return {
      counts: result.counts,
      unresolved: unresolvedList(result.unresolved),
      isDone: result.page.isDone,
      continueCursor: result.page.continueCursor,
    };
  },
});

/** The resumable position: the stage within the phase, and its page cursor. */
type Position = { stage: number; cursor: string | null };

function parsePosition(raw: string | undefined): Position {
  if (!raw) return { stage: 0, cursor: null };
  try {
    const parsed = JSON.parse(raw) as { stage?: unknown; cursor?: unknown };
    if (
      typeof parsed.stage === "number" &&
      (typeof parsed.cursor === "string" || parsed.cursor === null)
    ) {
      return { stage: parsed.stage, cursor: parsed.cursor };
    }
  } catch {
    // fall through
  }
  throw new ConvexError("That cursor is not one this backfill returned.");
}

/**
 * NEO-569 — run one phase of the league backfill. Dry run by default; see the
 * header for the operator commands and the phase order.
 */
export const run = internalAction({
  args: {
    phase: phaseValidator,
    confirm: v.optional(v.string()),
    cursor: v.optional(v.string()),
    includeUnresolved: v.optional(v.boolean()),
  },
  returns: v.object({
    phase: phaseValidator,
    armed: v.boolean(),
    message: v.string(),
    complete: v.boolean(),
    cursor: v.optional(v.string()),
    counts: v.record(v.string(), v.number()),
    unresolved: unresolvedValidator,
  }),
  handler: async (ctx, args) => {
    const intendsToWrite = args.confirm === CONFIRM_TOKEN;
    const refusedForFlag = intendsToWrite && !deploymentIsArmed();
    const armed = intendsToWrite && !refusedForFlag;
    const startedAt = Date.now();

    const totals: Counts = {};
    const unresolved = new Map<string, number>();
    let position = parsePosition(args.cursor);
    let complete = false;
    const stages = stageCount(args.phase);
    while (position.stage < stages) {
      const result: {
        counts: Record<string, number>;
        unresolved: Array<{ text: string; count: number }>;
        isDone: boolean;
        continueCursor: string;
      } = await ctx.runMutation(internal.leagueBackfill.page, {
        phase: args.phase,
        stage: position.stage,
        cursor: position.cursor,
        apply: armed,
        ...(args.includeUnresolved !== undefined
          ? { includeUnresolved: args.includeUnresolved }
          : {}),
      });
      for (const [key, value] of Object.entries(result.counts)) bump(totals, key, value);
      for (const entry of result.unresolved) {
        unresolved.set(entry.text, (unresolved.get(entry.text) ?? 0) + entry.count);
      }
      position = result.isDone
        ? { stage: position.stage + 1, cursor: null }
        : { stage: position.stage, cursor: result.continueCursor };
      if (position.stage >= stages) {
        complete = true;
        break;
      }
      if (Date.now() - startedAt >= TIME_BUDGET_MS) break;
    }

    console.log(
      JSON.stringify({
        msg: "league_backfill",
        phase: args.phase,
        armed,
        refusedForFlag,
        complete,
        ...totals,
      }),
    );

    return {
      phase: args.phase,
      armed,
      message: refusedForFlag ? NOT_ARMED_MESSAGE : armed ? APPLIED_MESSAGE : DRY_RUN_MESSAGE,
      complete,
      ...(complete ? {} : { cursor: JSON.stringify(position) }),
      counts: totals,
      unresolved: unresolvedList(unresolved),
    };
  },
});

// Exported for the unit tests' expectations.
export { CONFIRM_TOKEN as LEAGUE_BACKFILL_CONFIRM, ENV_FLAG as LEAGUE_BACKFILL_ENV_FLAG };
