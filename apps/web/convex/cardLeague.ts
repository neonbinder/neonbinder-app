/**
 * NEO-569 — each card's own NB league (`cardChecklist.leagueId`) and a set's
 * leagues (`selectorOptions.leagueIds`).
 *
 * ## The card rule (Jason, 2026-11-16)
 *
 * "Each card has a saved, editable league, set when its team is chosen and
 * updated when the team changes. No team, or teams in two leagues → the
 * operator is asked; never guessed." So, from NB rows only:
 *
 *   - the card's teams all carry one league → that league;
 *   - the card has no team and its set has exactly one league → that league;
 *   - anything else — teams in two leagues, any team without a league, no
 *     team in a many-league (or league-less) set → no league, for an admin to
 *     pick in the card panel (`updateCard.leagueId`).
 *
 * `deriveCardLeagueId` is that rule, pure.
 *
 * ## Where it is applied
 *
 *  - **Insert**: a new card is born with it (`deriveNewCardLeagueId`, called
 *    by `insertCardRow` and `addCustomCard` before the insert, never as a
 *    patch after it).
 *  - **Team change**: `syncCardTeamLinks` (cardTeamLinks.ts), the one seam
 *    every `teamOnCardIds` writer passes, calls `settleCardLeague` whenever
 *    the card's team set actually changed. Rule B (coordinator default): a
 *    league the card already carries survives the change while it is still the
 *    league of one of the card's teams (an admin's pick on a two-league card
 *    stays when one team is swapped); otherwise it is re-derived.
 *  - **A team's own league changes**: `recomputeTeamCards`, chunked over that
 *    team's `cardTeamLinks`, with the NEO-24 follow rule — a card follows when
 *    its league is absent or equals the team's PREVIOUS league, and it is
 *    re-derived from the LIVE team rows (so two overlapping chains converge on
 *    the later value).
 *  - **A set's leagues change** (rule A, coordinator default):
 *    `cascadeSetLeagues` re-derives that subtree's TEAMLESS cards, a card
 *    following when its league is absent or equals the previous single league.
 *  - Card moves (`setShapeMove.moveCards`) do not re-derive.
 *
 * ## Never a marketplace value
 *
 * Every input is an NB id: the card's team ids, each team's `leagueId`, the
 * set's `leagueIds`. No adapter or sync reads or writes either field; the eBay
 * League aspect READS the card's league (lib/ebayListing.ts) and holds a card
 * without one (`noLeague`).
 */

import { ConvexError, v } from "convex/values";
import { internalMutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { requireAdmin } from "./auth";
import {
  MAX_SET_LEAGUES,
  leagueSummaryValidator,
  sportLeagueSummaries,
  toLeagueSummary,
  type LeagueSummary,
} from "./leagues";
import {
  LEAGUE_BEARING_LEVELS,
  effectiveSetLeagueIds,
  effectiveSetLeagues,
  newSelectorLeagueCache,
  sportOfSelectorOption,
  type SelectorLeagueCache,
} from "./lib/selectorLeagues";
import { pageCardTeamLinksForTeam, teamHasCardTeamLinks } from "./cardTeamLinks";

// ───────────────────────────────────────────────────────────────────────────
// The pure rules
// ───────────────────────────────────────────────────────────────────────────

/**
 * The card's league from its teams' leagues (`null` = a team with no league,
 * or a team that is gone) and its set's effective leagues. `undefined` = no
 * league: the operator decides.
 */
export function deriveCardLeagueId<L extends string>(input: {
  teamLeagueIds: ReadonlyArray<L | null>;
  setLeagueIds: ReadonlyArray<L>;
}): L | undefined {
  const { teamLeagueIds, setLeagueIds } = input;
  if (teamLeagueIds.length === 0) {
    const distinctSet = [...new Set(setLeagueIds)];
    return distinctSet.length === 1 ? distinctSet[0] : undefined;
  }
  if (teamLeagueIds.some((id) => id === null)) return undefined;
  const distinct = new Set(teamLeagueIds as ReadonlyArray<L>);
  return distinct.size === 1 ? [...distinct][0] : undefined;
}

/**
 * Rule B — the league a card carries after its team set changed: the one it
 * already has when that is still one of its teams' leagues, else the derived
 * one. With every team in one league the two are the same answer.
 */
export function settleCardLeagueId<L extends string>(input: {
  current: L | undefined;
  teamLeagueIds: ReadonlyArray<L | null>;
  setLeagueIds: ReadonlyArray<L>;
}): L | undefined {
  if (input.current !== undefined && input.teamLeagueIds.includes(input.current)) {
    return input.current;
  }
  return deriveCardLeagueId(input);
}

export type CardLeagueBlankReason = "noTeam" | "teamsInDifferentLeagues" | "teamWithoutLeague";

/**
 * Why a card has no league, for the card panel's helper line. `null` when the
 * teams would give one (a card left blank by an admin's clear, say).
 */
export function cardLeagueBlankReason(
  teamLeagueIds: ReadonlyArray<string | null>,
): CardLeagueBlankReason | null {
  if (teamLeagueIds.length === 0) return "noTeam";
  if (teamLeagueIds.some((id) => id === null)) return "teamWithoutLeague";
  return new Set(teamLeagueIds).size > 1 ? "teamsInDifferentLeagues" : null;
}

// ───────────────────────────────────────────────────────────────────────────
// Reads, cached per transaction
// ───────────────────────────────────────────────────────────────────────────

/**
 * One transaction's reads for the rule: each team's league (`null` = none, or
 * the team is gone) and each set row's effective leagues. A commit chunk or a
 * cascade page shares one, so a team or a set row is read once however many
 * cards name it.
 */
export type CardLeagueCache = {
  teamLeague: Map<string, Id<"leagues"> | null>;
  setLeagues: SelectorLeagueCache;
};

export function newCardLeagueCache(): CardLeagueCache {
  return { teamLeague: new Map(), setLeagues: newSelectorLeagueCache() };
}

type ReadCtx = Pick<QueryCtx, "db">;

export async function teamLeagueIdsFor(
  ctx: ReadCtx,
  teamIds: ReadonlyArray<Id<"teams">> | undefined,
  cache: CardLeagueCache,
): Promise<Array<Id<"leagues"> | null>> {
  const out: Array<Id<"leagues"> | null> = [];
  for (const teamId of new Set(teamIds ?? [])) {
    if (!cache.teamLeague.has(teamId)) {
      const team = await ctx.db.get(teamId);
      cache.teamLeague.set(teamId, team?.leagueId ?? null);
    }
    out.push(cache.teamLeague.get(teamId) ?? null);
  }
  return out;
}

/** The league a NEW card under `selectorOptionId` with these teams is born with. */
export async function deriveNewCardLeagueId(
  ctx: ReadCtx,
  card: { selectorOptionId: Id<"selectorOptions">; teamOnCardIds?: ReadonlyArray<Id<"teams">> },
  cache: CardLeagueCache,
): Promise<Id<"leagues"> | undefined> {
  const teamLeagueIds = await teamLeagueIdsFor(ctx, card.teamOnCardIds, cache);
  // The set is read only when it can decide: a card with teams never asks it.
  const setLeagueIds =
    teamLeagueIds.length === 0
      ? await effectiveSetLeagueIds(ctx, card.selectorOptionId, cache.setLeagues)
      : [];
  return deriveCardLeagueId({ teamLeagueIds, setLeagueIds });
}

export type LeagueSettleCard = Pick<Doc<"cardChecklist">, "_id" | "selectorOptionId" | "leagueId">;

/**
 * Rule B's answer for a stored card about to carry `teamOnCardIds`, without
 * writing it — for a caller that folds the league into its own patch (the
 * set-level team cascade) and then hands the seam the updated card, so the
 * seam sees nothing left to change.
 */
export async function settledCardLeagueId(
  ctx: ReadCtx,
  card: LeagueSettleCard,
  teamOnCardIds: ReadonlyArray<Id<"teams">> | undefined,
  cache: CardLeagueCache,
): Promise<Id<"leagues"> | undefined> {
  const teamLeagueIds = await teamLeagueIdsFor(ctx, teamOnCardIds, cache);
  const setLeagueIds =
    teamLeagueIds.length === 0
      ? await effectiveSetLeagueIds(ctx, card.selectorOptionId, cache.setLeagues)
      : [];
  return settleCardLeagueId({ current: card.leagueId, teamLeagueIds, setLeagueIds });
}

/**
 * Settle a stored card's league after its team set changed (rule B), patching
 * only when the answer differs from what the card carries. Returns the league
 * the card now carries. Called by `syncCardTeamLinks`; nothing else should
 * need it.
 */
export async function settleCardLeague(
  ctx: Pick<MutationCtx, "db">,
  card: LeagueSettleCard,
  teamOnCardIds: ReadonlyArray<Id<"teams">> | undefined,
  cache: CardLeagueCache,
): Promise<Id<"leagues"> | undefined> {
  const next = await settledCardLeagueId(ctx, card, teamOnCardIds, cache);
  if (next !== card.leagueId) {
    // `undefined` in a patch deletes the field.
    await ctx.db.patch(card._id, { leagueId: next });
  }
  return next;
}

// ───────────────────────────────────────────────────────────────────────────
// The card panel's League select
// ───────────────────────────────────────────────────────────────────────────

const cardLeagueBlankReasonValidator = v.union(
  v.literal("noTeam"),
  v.literal("teamsInDifferentLeagues"),
  v.literal("teamWithoutLeague"),
  v.null(),
);

async function summariesFor(
  ctx: ReadCtx,
  ids: ReadonlyArray<Id<"leagues">>,
): Promise<LeagueSummary[]> {
  const out: LeagueSummary[] = [];
  for (const id of new Set(ids)) {
    const row = await ctx.db.get(id);
    if (row) out.push(toLeagueSummary(row));
  }
  return out;
}

/**
 * NEO-569 — what the card panel's League select offers for one card:
 *
 *  - `current`: the card's league, or null;
 *  - `setLeagues`: its set's effective leagues, in the set's own order (the
 *    select lists these first);
 *  - `sportLeagues`: every league of the card's sport, major first then A–Z,
 *    the set's included (the select de-duplicates);
 *  - `blankReason`: when `current` is null, why the teams gave no answer
 *    ("noTeam", "teamsInDifferentLeagues", "teamWithoutLeague"); null
 *    otherwise.
 *
 * Admin: the card panel is operator tooling, as `getCardChecklist` is. A card
 * that is gone answers an empty shape rather than throwing, so a panel open on
 * a deleted card does not crash its boundary.
 */
export const cardLeagueOptions = query({
  args: { cardId: v.id("cardChecklist") },
  returns: v.object({
    current: v.union(leagueSummaryValidator, v.null()),
    setLeagues: v.array(leagueSummaryValidator),
    sportLeagues: v.array(leagueSummaryValidator),
    blankReason: cardLeagueBlankReasonValidator,
  }),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const card = await ctx.db.get(args.cardId);
    if (!card) return { current: null, setLeagues: [], sportLeagues: [], blankReason: null };
    const cache = newCardLeagueCache();
    const currentRow = card.leagueId ? await ctx.db.get(card.leagueId) : null;
    const setLeagueIds = await effectiveSetLeagueIds(ctx, card.selectorOptionId, cache.setLeagues);
    const teamLeagueIds = await teamLeagueIdsFor(ctx, card.teamOnCardIds, cache);
    return {
      current: currentRow ? toLeagueSummary(currentRow) : null,
      setLeagues: await summariesFor(ctx, setLeagueIds),
      sportLeagues: await sportLeagueSummaries(ctx, card.sportId),
      blankReason: currentRow ? null : cardLeagueBlankReason(teamLeagueIds),
    };
  },
});

/**
 * NEO-569 — an admin's explicit league for one card (`updateCard.leagueId`):
 * the id must be a league of the card's own sport. `null` clears. Returns the
 * value to patch (`undefined` deletes the field).
 */
export async function resolveCardLeagueForWrite(
  ctx: ReadCtx,
  card: Pick<Doc<"cardChecklist">, "sportId">,
  leagueId: Id<"leagues"> | null,
): Promise<Id<"leagues"> | undefined> {
  if (leagueId === null) return undefined;
  const league = await ctx.db.get(leagueId);
  if (!league) throw new ConvexError("That league no longer exists.");
  if (league.sportId !== card.sportId) {
    // Reference data the operator just picked off a list; safe to name.
    throw new ConvexError(`${league.name} is a league in another sport.`);
  }
  return league._id;
}

// ───────────────────────────────────────────────────────────────────────────
// A set row's leagues: read and write
// ───────────────────────────────────────────────────────────────────────────

/** How long a `leagueCascadeStartedAt` stamp is believed (as the team cascade's). */
export const LEAGUE_CASCADE_STALE_MS = 10 * 60 * 1000;

export const selectorOptionLeaguesValidator = v.object({
  own: v.union(v.array(leagueSummaryValidator), v.null()),
  effective: v.array(leagueSummaryValidator),
  inheritedFrom: v.union(v.id("selectorOptions"), v.null()),
  sportLeagues: v.array(leagueSummaryValidator),
});

/**
 * The body of `selectorOptions.getSelectorOptionLeagues`: the row's own list
 * (null when it inherits), the effective list, the row it inherits from (null
 * when it has its own, or nothing above has one), and every league of its
 * sport (major first, then A–Z). A row that cannot carry leagues (a sport,
 * year or brand) answers its sport's leagues and nothing else.
 */
export async function readSelectorOptionLeagues(
  ctx: ReadCtx,
  selectorOptionId: Id<"selectorOptions">,
): Promise<{
  own: LeagueSummary[] | null;
  effective: LeagueSummary[];
  inheritedFrom: Id<"selectorOptions"> | null;
  sportLeagues: LeagueSummary[];
}> {
  const row = await ctx.db.get(selectorOptionId);
  if (!row) return { own: null, effective: [], inheritedFrom: null, sportLeagues: [] };
  const sportLeagues = await sportLeagueSummaries(ctx, await sportOfSelectorOption(ctx, row._id));
  if (!LEAGUE_BEARING_LEVELS.has(row.level)) {
    return { own: null, effective: [], inheritedFrom: null, sportLeagues };
  }
  const own = row.leagueIds && row.leagueIds.length > 0 ? await summariesFor(ctx, row.leagueIds) : null;
  const effective = await effectiveSetLeagues(ctx, row._id);
  return {
    own,
    effective: own ?? (await summariesFor(ctx, effective.leagueIds)),
    inheritedFrom: own ? null : effective.fromId,
    sportLeagues,
  };
}

/** The single league a teamless card under this list would take, if any. */
function singleLeague(ids: ReadonlyArray<Id<"leagues">>): Id<"leagues"> | undefined {
  const distinct = [...new Set(ids)];
  return distinct.length === 1 ? distinct[0] : undefined;
}

/**
 * The body of `selectorOptions.setSelectorOptionLeagues` (the caller has
 * already gated it): validate, patch THIS row, and hand its subtree's teamless
 * cards to `cascadeSetLeagues` when the league they would take changes.
 *
 *  - only on `setName`, `variantType`, `insert`, `parallel`;
 *  - deduped, at most `MAX_SET_LEAGUES`, every league in the row's sport
 *    (refused, never dropped, as `resolveOperatorLeagueId` refuses);
 *  - an empty list removes the field: the row inherits its parent's again;
 *  - refused while ANY league cascade in the same set is still running.
 *
 * NEO-569 security N1 — one lock per SET. Every cascade, whichever row of the
 * set it starts from, stamps `leagueCascadeStartedAt` on the set's `setName`
 * row (`leagueLockRow`), and every edit within the set checks that one stamp.
 * So an ancestor's cascade and a descendant's can never overlap and write
 * different leagues to the same teamless cards: the second edit is refused
 * until the first cascade clears the stamp (or it goes stale).
 */
export async function writeSelectorOptionLeagues(
  ctx: MutationCtx,
  selectorOptionId: Id<"selectorOptions">,
  leagueIds: ReadonlyArray<Id<"leagues">>,
): Promise<void> {
  const row = await ctx.db.get(selectorOptionId);
  if (!row) throw new ConvexError("That row is gone. Refresh and try again.");
  if (!LEAGUE_BEARING_LEVELS.has(row.level)) {
    throw new ConvexError("Pick leagues on the set, not on the sport, year or brand.");
  }
  const now = Date.now();
  const lock = await leagueLockRow(ctx, row);
  if (
    lock.leagueCascadeStartedAt !== undefined &&
    now - lock.leagueCascadeStartedAt < LEAGUE_CASCADE_STALE_MS
  ) {
    throw new ConvexError("Still applying the last league change. Try again in a moment.");
  }
  const ids = [...new Set(leagueIds)];
  if (ids.length > MAX_SET_LEAGUES) {
    throw new ConvexError(`A set can carry up to ${MAX_SET_LEAGUES} leagues.`);
  }
  if (ids.length > 0) {
    const sportId = await sportOfSelectorOption(ctx, row._id);
    for (const id of ids) {
      const league = await ctx.db.get(id);
      if (!league) throw new ConvexError("That league no longer exists.");
      if (league.sportId !== sportId) {
        throw new ConvexError(`${league.name} is a league in another sport.`);
      }
    }
  }

  const previous = singleLeague(await effectiveSetLeagueIds(ctx, row._id));
  await ctx.db.patch(row._id, {
    // Never stored empty: absent IS "inherit".
    leagueIds: ids.length > 0 ? ids : undefined,
    lastUpdated: now,
  });
  const next = singleLeague(await effectiveSetLeagueIds(ctx, row._id));
  if (previous === next) {
    // A teamless card's answer is unchanged; nothing to cascade. A stale
    // stamp the edit was allowed past is wiped.
    if (lock.leagueCascadeStartedAt !== undefined) {
      await ctx.db.patch(lock._id, { leagueCascadeStartedAt: undefined });
    }
    return;
  }
  await ctx.db.patch(lock._id, { leagueCascadeStartedAt: now });
  await ctx.scheduler.runAfter(0, internal.cardLeague.cascadeSetLeagues, {
    rootId: row._id,
    lockId: lock._id,
    ...(previous ? { previousLeagueId: previous } : {}),
    ...(next ? { nextLeagueId: next } : {}),
    startedAt: now,
  });
}

/**
 * The row that holds a set's one league-cascade lock: the `setName` row at or
 * above `row`. A league-bearing row with no `setName` above it (malformed
 * tree) locks on its topmost league-bearing ancestor, still shared by every
 * row beneath it.
 */
async function leagueLockRow(
  ctx: ReadCtx,
  row: Doc<"selectorOptions">,
): Promise<Doc<"selectorOptions">> {
  let current = row;
  const seen = new Set<string>([row._id]);
  while (current.level !== "setName" && current.parentId && !seen.has(current.parentId)) {
    seen.add(current.parentId);
    const parent = await ctx.db.get(current.parentId);
    if (!parent || !LEAGUE_BEARING_LEVELS.has(parent.level)) break;
    current = parent;
  }
  return current;
}

/** Cards examined per cascade invocation: one read and at most one patch each. */
const LEAGUE_CASCADE_CARD_PAGE = 200;

/**
 * The subtree whose cards inherit their leagues from `rootId`: the root and
 * every descendant, minus any descendant that carries its own `leagueIds`
 * (and everything under it — nearest wins, so they answer for themselves).
 */
async function inheritingSubtree(
  ctx: ReadCtx,
  rootId: Id<"selectorOptions">,
): Promise<Array<Id<"selectorOptions">>> {
  const out: Array<Id<"selectorOptions">> = [rootId];
  const seen = new Set<string>([rootId]);
  const stack: Array<Id<"selectorOptions">> = [rootId];
  while (stack.length > 0) {
    const row = await ctx.db.get(stack.pop()!);
    for (const childId of row?.children ?? []) {
      if (seen.has(childId)) continue;
      seen.add(childId);
      const child = await ctx.db.get(childId);
      if (!child || (child.leagueIds && child.leagueIds.length > 0)) continue;
      out.push(childId);
      stack.push(childId);
    }
  }
  return out;
}

/**
 * Rule A — a set row's leagues changed: re-derive the TEAMLESS cards in the
 * subtree that inherits from it. A card follows when its league is absent or
 * equals `previousLeagueId` (the single league a teamless card used to take);
 * it then takes `nextLeagueId` (absent = none: two leagues, or none). A card
 * with teams is never touched — its teams decide. Chunked and
 * self-rescheduling over `by_selector_option`, the `cascadeSelectorOptionTeams`
 * shape; the last invocation removes the set's lock stamp
 * (`leagueCascadeStartedAt` on `lockId`, the set's `setName` row) when it is
 * still this run's.
 */
export const cascadeSetLeagues = internalMutation({
  args: {
    rootId: v.id("selectorOptions"),
    // The row holding the set's lock stamp (`leagueLockRow`); absent = rootId.
    lockId: v.optional(v.id("selectorOptions")),
    previousLeagueId: v.optional(v.id("leagues")),
    nextLeagueId: v.optional(v.id("leagues")),
    startedAt: v.optional(v.number()),
    nodeIds: v.optional(v.array(v.id("selectorOptions"))),
    nodeIndex: v.optional(v.number()),
    // `_creationTime` of the last card examined under `nodeIds[nodeIndex]`
    // (one `.paginate()` per function, so a hand-rolled cursor).
    cursor: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const nodeIds = args.nodeIds ?? (await inheritingSubtree(ctx, args.rootId));
    let nodeIndex = args.nodeIndex ?? 0;
    let cursor = args.cursor;
    let budget = LEAGUE_CASCADE_CARD_PAGE;
    while (nodeIndex < nodeIds.length && budget > 0) {
      const nodeId = nodeIds[nodeIndex];
      const after = cursor;
      const requested = budget;
      const rows = await ctx.db
        .query("cardChecklist")
        .withIndex("by_selector_option", (q) =>
          after === undefined
            ? q.eq("selectorOptionId", nodeId)
            : q.eq("selectorOptionId", nodeId).gt("_creationTime", after),
        )
        .take(requested);
      for (const card of rows) {
        budget -= 1;
        if ((card.teamOnCardIds ?? []).length > 0) continue;
        const follows = card.leagueId === undefined || card.leagueId === args.previousLeagueId;
        if (!follows || card.leagueId === args.nextLeagueId) continue;
        await ctx.db.patch(card._id, { leagueId: args.nextLeagueId });
      }
      if (rows.length < requested) {
        nodeIndex += 1;
        cursor = undefined;
      } else {
        cursor = rows[rows.length - 1]._creationTime;
      }
    }
    if (nodeIndex < nodeIds.length) {
      await ctx.scheduler.runAfter(0, internal.cardLeague.cascadeSetLeagues, {
        rootId: args.rootId,
        ...(args.lockId ? { lockId: args.lockId } : {}),
        ...(args.previousLeagueId ? { previousLeagueId: args.previousLeagueId } : {}),
        ...(args.nextLeagueId ? { nextLeagueId: args.nextLeagueId } : {}),
        ...(args.startedAt !== undefined ? { startedAt: args.startedAt } : {}),
        nodeIds,
        nodeIndex,
        ...(cursor !== undefined ? { cursor } : {}),
      });
      return null;
    }
    const lockId = args.lockId ?? args.rootId;
    const lock = await ctx.db.get(lockId);
    if (
      lock &&
      lock.leagueCascadeStartedAt !== undefined &&
      (args.startedAt === undefined || lock.leagueCascadeStartedAt === args.startedAt)
    ) {
      await ctx.db.patch(lockId, { leagueCascadeStartedAt: undefined });
    }
    return null;
  },
});

// ───────────────────────────────────────────────────────────────────────────
// A team's own league changed
// ───────────────────────────────────────────────────────────────────────────

/** Links examined per `recomputeTeamCards` invocation (a card read + at most a patch, plus its teams). */
export const TEAM_LEAGUE_RECOMPUTE_PAGE = 150;

/**
 * Schedule `recomputeTeamCards` for a team whose `leagueId` just changed —
 * only when some card shows the team (one indexed `.first()`), so a team
 * edit in League or Team Management costs nothing extra for a team on no card.
 */
export async function scheduleTeamLeagueRecompute(
  ctx: MutationCtx,
  teamId: Id<"teams">,
  previousLeagueId: Id<"leagues"> | undefined,
): Promise<void> {
  if (!(await teamHasCardTeamLinks(ctx, teamId))) return;
  await ctx.scheduler.runAfter(0, internal.cardLeague.recomputeTeamCards, {
    teamId,
    ...(previousLeagueId ? { previousLeagueId } : {}),
  });
}

/**
 * Re-settle the cards showing one team after that team's league changed.
 * Pages `cardTeamLinks.by_team`; a card follows when its league is absent or
 * equals `previousLeagueId` and is re-derived from its LIVE teams and set.
 * Anything else is an admin's pick (or another team's answer) and stays.
 */
export const recomputeTeamCards = internalMutation({
  args: {
    teamId: v.id("teams"),
    previousLeagueId: v.optional(v.id("leagues")),
    cursor: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const page = await pageCardTeamLinksForTeam(
      ctx,
      args.teamId,
      args.cursor ?? null,
      TEAM_LEAGUE_RECOMPUTE_PAGE,
    );
    const cache = newCardLeagueCache();
    for (const cardId of page.cardIds) {
      const card = await ctx.db.get(cardId);
      if (!card) continue;
      const follows = card.leagueId === undefined || card.leagueId === args.previousLeagueId;
      if (!follows) continue;
      const next = await deriveNewCardLeagueId(ctx, card, cache);
      if (next !== card.leagueId) await ctx.db.patch(card._id, { leagueId: next });
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.cardLeague.recomputeTeamCards, {
        teamId: args.teamId,
        ...(args.previousLeagueId ? { previousLeagueId: args.previousLeagueId } : {}),
        cursor: page.continueCursor,
      });
    }
    return null;
  },
});
