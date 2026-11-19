/**
 * NEO-426 — the operator's "No teams in this sport" switch, and the server's
 * reads of it.
 *
 * The stamp lives on the sport row (`selectorOptions.teamlessSport`, level
 * "sport" only). It is a DEFAULT, never a block: a card whose every player's
 * home sport carries it saves as "No team" when nothing names a team or waits
 * on one, and nothing here or downstream refuses, strips or hides a team
 * because of it. The predicate is `sportDefaultNoTeam`
 * (`convex/lib/teamlessSport.ts`); the "does anything name a team?" half is
 * `noTeamCardVerdict`, shared with the set's No Team.
 */

import { ConvexError, v } from "convex/values";
import {
  internalQuery,
  mutation,
  query,
  type QueryCtx,
} from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireAdmin } from "./auth";
import { mapBounded } from "./lib/boundedConcurrency";
import {
  isTeamlessSport,
  sportDefaultNoTeam,
  teamlessSportOf,
  type TeamlessSport,
} from "./lib/teamlessSport";

type DbCtx = Pick<QueryCtx, "db">;

/**
 * Every flagged sport and its stamp, read once per call. Sports are a handful
 * of rows (`by_level` "sport"), so this stays one small read however large the
 * catalogue grows.
 */
export async function teamlessSportMap(
  ctx: DbCtx,
): Promise<Map<Id<"selectorOptions">, TeamlessSport>> {
  const sports = await ctx.db
    .query("selectorOptions")
    .withIndex("by_level", (q) => q.eq("level", "sport"))
    .collect();
  const out = new Map<Id<"selectorOptions">, TeamlessSport>();
  for (const row of sports) {
    const stamp = teamlessSportOf(row);
    if (stamp) out.set(row._id, stamp);
  }
  return out;
}

/** The flagged sports' ids. */
export async function teamlessSportIdSet(
  ctx: DbCtx,
): Promise<Set<Id<"selectorOptions">>> {
  return new Set((await teamlessSportMap(ctx)).keys());
}

/**
 * The sport default for cards inside ONE transaction (a commit chunk, a
 * single-card write, a background stamp). Lazy and cached: the flagged sports
 * are read on the first ask, and a player's home sport once per player, so a
 * chunk of hundreds of cards pays for each distinct player once, and a
 * deployment with no flagged sport pays one small read and never touches a
 * player.
 *
 * `defaultFor` answers the stamp that vouches for the card, or `undefined`
 * (`sportDefaultNoTeam` holds the rule: >=1 player, no pending player name,
 * every player's HOME sport flagged; extra sports never count; a missing
 * player is not teamless).
 */
export function createSportNoTeamReader(ctx: DbCtx): {
  defaultFor: (card: {
    playerIds: ReadonlyArray<Id<"players">>;
    pendingPlayerNameCount: number;
  }) => Promise<TeamlessSport | undefined>;
} {
  let flagged: Promise<Map<Id<"selectorOptions">, TeamlessSport>> | undefined;
  const homeSports = new Map<string, Id<"selectorOptions"> | null>();
  return {
    defaultFor: async (card) => {
      // Cheapest refusals first: no database read for a card with no player
      // or one still waiting on a name.
      if (card.playerIds.length === 0 || card.pendingPlayerNameCount > 0) {
        return undefined;
      }
      flagged ??= teamlessSportMap(ctx);
      const sports = await flagged;
      if (sports.size === 0) return undefined;
      for (const id of new Set(card.playerIds)) {
        if (homeSports.has(id)) continue;
        const player = await ctx.db.get(id);
        homeSports.set(id, player ? player.sportId : null);
      }
      return sportDefaultNoTeam({
        playerIds: card.playerIds,
        pendingPlayerNameCount: card.pendingPlayerNameCount,
        homeSport: (id) => {
          const sportId = homeSports.get(id);
          return sportId ? sports.get(sportId) : undefined;
        },
      });
    },
  };
}

/**
 * Turn the flag on or off for one sport (admin only). `true` stores the
 * server-stamped `{ setAt, setByUserId }`; `false` removes the field (a stored
 * `false` would only be a second way to say "has teams"). Refused on any row
 * that is not a sport. Idempotent: setting what is already set writes nothing
 * and keeps the original stamp (who made the decision, and when).
 *
 * Touches no card: the stamp only changes what a LATER save defaults to. Cards
 * already saved keep whatever team (or "No team") they carry.
 */
export const setTeamlessSport = mutation({
  args: {
    sportId: v.id("selectorOptions"),
    teamless: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireAdmin(ctx);
    const row = await ctx.db.get(args.sportId);
    if (!row) {
      throw new ConvexError("That sport is gone. Refresh and try again.");
    }
    if (row.level !== "sport") {
      throw new ConvexError("Only a sport can be marked as having no teams.");
    }
    if (isTeamlessSport(row) === args.teamless) return null;
    const now = Date.now();
    await ctx.db.patch(args.sportId, {
      teamlessSport: args.teamless ? { setAt: now, setByUserId: userId } : undefined,
      lastUpdated: now,
    });
    return null;
  },
});

/**
 * The ids of every sport flagged "no teams", for the checklist wizard's Teams
 * step. Admin-only, like every set-builder read.
 */
export const listTeamlessSportIds = query({
  args: {},
  returns: v.array(v.id("selectorOptions")),
  handler: async (ctx) => {
    await requireAdmin(ctx);
    return [...(await teamlessSportIdSet(ctx))];
  },
});

/**
 * The most player ids `playersWithTeamlessHomeSport` reads in one call: one
 * point read per id, the same page the title context reads its names in.
 */
export const TEAMLESS_PLAYER_LOOKUP_PAGE = 200;

/**
 * Which of these players' HOME sport (`players.sportId`) is one of the given
 * flagged sports. Extra sports (`playerSports`) never count (Jason, NEO-426).
 * A missing player is not teamless.
 *
 * For `resolveChecklistEntities`' `teamlessPlayerNames`, which already read
 * the flagged sports in the review gate's one prelude hop and calls this only
 * when at least one sport is flagged, so a deployment with none pays no player
 * read at all. Internal: the gate has already checked the operator.
 */
export const playersWithTeamlessHomeSport = internalQuery({
  args: {
    playerIds: v.array(v.id("players")),
    teamlessSportIds: v.array(v.id("selectorOptions")),
  },
  returns: v.array(v.id("players")),
  handler: async (ctx, args) => {
    if (args.playerIds.length > TEAMLESS_PLAYER_LOOKUP_PAGE) {
      throw new Error(
        `playersWithTeamlessHomeSport: ${args.playerIds.length} ids exceeds the ` +
          `${TEAMLESS_PLAYER_LOOKUP_PAGE} per call — slice them`,
      );
    }
    const flagged = new Set<string>(args.teamlessSportIds);
    if (flagged.size === 0) return [];
    const ids = [...new Set(args.playerIds)];
    const players = await mapBounded(ids, (id) => ctx.db.get(id));
    return ids.filter((_, i) => {
      const player = players[i];
      return !!player && flagged.has(player.sportId);
    });
  },
});
