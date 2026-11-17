/**
 * NEO-574 — the reads behind the wizard's "career check" step.
 *
 * When a set is tidied up, each new card's team is compared with the career of
 * the existing player the card resolved to (`lib/careerCoverage.ts` is the
 * rule). The resolve gate answers the first question for the whole set
 * (`listingTitleContext.buildCareerContext` calls `coverageForPairs`); the
 * wizard asks the same question again, one pair at a time, after the operator
 * links a card to a different player or picks a different team
 * (`coverageForPreview`), and asks who the other candidates are
 * (`relinkCandidates`). All three go through `computeCoverage`, so the screen
 * can never disagree with the gate about what a career covers.
 *
 * Reads only. Nothing here writes; the stint is added by
 * `players.appendCareerStints` inside the commit.
 */
import { internalQuery, query } from "./_generated/server";
import { v } from "convex/values";
import { requireAdmin } from "./auth";
import { findSportForSelectorOption } from "./cardChecklist";
import { findSetYearForSelectorOption } from "./lib/selectorAncestry";
import {
  computeCoverage,
  cardTeamKeysFor,
  stintsWithKeys,
  type TeamFactsMemo,
} from "./lib/careerCoverageFacts";
import { CAREER_COVERAGE_MAX_PAIRS, careerCoversCardTeam } from "./lib/careerCoverage";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import {
  narrowSameNamePlayersByCardYear,
  normalizePlayerName,
  playerBelongsToSport,
  renderExistingPlayerCandidates,
  sameNamePlayers,
} from "./players";
import { MAX_PLAYER_NAME_LENGTH } from "../lib/players/name-limits";

/** Pairs one internal coverage read answers; the gate slices to this. */
export const COVERAGE_PAIRS_PER_INTERNAL_READ = 100;

const pairArgs = v.object({
  playerId: v.id("players"),
  teamId: v.optional(v.id("teams")),
  teamName: v.optional(v.string()),
});

const resultValidator = v.object({
  playerId: v.id("players"),
  teamId: v.optional(v.id("teams")),
  teamName: v.optional(v.string()),
  covered: v.boolean(),
});

function assertPairText(pairs: ReadonlyArray<{ teamName?: string }>): void {
  for (const pair of pairs) {
    if ((pair.teamName ?? "").length > MAX_PLAYER_NAME_LENGTH) {
      throw new Error(
        `careerCoverage: a team name of ${pair.teamName!.length} characters exceeds the ${MAX_PLAYER_NAME_LENGTH}-character limit`,
      );
    }
  }
}

/**
 * The commit refuses an id outside the set's sport, so the preview must not
 * read one either (it would hand back another sport's career as an answer).
 * A pair naming a player or team that is not this sport's (or is gone) is
 * answered `covered: true` WITHOUT reading its career: there is nothing here
 * to check, and nothing the commit would accept. Results stay aligned with the
 * input.
 */
async function coverageInSport(
  ctx: QueryCtx,
  sportId: Id<"selectorOptions">,
  setYear: number | null,
  pairs: ReadonlyArray<{ playerId: Id<"players">; teamId?: Id<"teams">; teamName?: string }>,
) {
  const playerOk = new Map<string, boolean>();
  const teamOk = new Map<string, boolean>();
  const allowed: boolean[] = [];
  for (const pair of pairs) {
    const pKey = pair.playerId as string;
    if (!playerOk.has(pKey)) {
      const player: Doc<"players"> | null = await ctx.db.get(pair.playerId);
      playerOk.set(pKey, player !== null && (await playerBelongsToSport(ctx, player, sportId)));
    }
    let ok = playerOk.get(pKey) === true;
    if (ok && pair.teamId) {
      const tKey = pair.teamId as string;
      if (!teamOk.has(tKey)) {
        const team = await ctx.db.get(pair.teamId);
        teamOk.set(tKey, team !== null && team.sportId === sportId);
      }
      ok = teamOk.get(tKey) === true;
    }
    allowed.push(ok);
  }
  const answered = await computeCoverage(ctx, {
    sportId,
    setYear,
    pairs: pairs.filter((_, i) => allowed[i]),
  });
  let next = 0;
  return pairs.map((pair, i) =>
    allowed[i]
      ? answered[next++]
      : {
          playerId: pair.playerId,
          ...(pair.teamId ? { teamId: pair.teamId } : {}),
          ...(pair.teamName !== undefined ? { teamName: pair.teamName } : {}),
          covered: true,
        },
  );
}

/**
 * Admin read: is each (player, team) pair covered by the player's career as of
 * the set's year? Called one-shot by the wizard (`useConvex().query`), never
 * subscribed. At most `CAREER_COVERAGE_MAX_PAIRS` pairs; more is refused, not
 * truncated, so a short answer can never read as "covered".
 *
 * A set with no year answers `setYear: null` and every pair covered: with no
 * year there is nothing to compare against.
 */
export const coverageForPreview = query({
  args: {
    selectorOptionId: v.id("selectorOptions"),
    pairs: v.array(pairArgs),
  },
  returns: v.object({
    setYear: v.union(v.number(), v.null()),
    results: v.array(resultValidator),
  }),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    if (args.pairs.length > CAREER_COVERAGE_MAX_PAIRS) {
      throw new Error(
        `coverageForPreview: ${args.pairs.length} pairs exceeds the ${CAREER_COVERAGE_MAX_PAIRS}-pair limit`,
      );
    }
    assertPairText(args.pairs);
    const sportId = await findSportForSelectorOption(ctx, args.selectorOptionId);
    if (!sportId) {
      throw new Error("coverageForPreview: the set has no sport ancestor");
    }
    const setYear = (await findSetYearForSelectorOption(ctx, args.selectorOptionId)) ?? null;
    const results = await coverageInSport(ctx, sportId, setYear, args.pairs);
    return { setYear, results };
  },
});

/**
 * Internal: the gate's version of the same read. The caller (an action) has
 * already proven the sport and found the year, and slices its pairs to
 * `COVERAGE_PAIRS_PER_INTERNAL_READ` so one transaction stays small.
 */
export const coverageForPairs = internalQuery({
  args: {
    sportId: v.id("selectorOptions"),
    setYear: v.number(),
    pairs: v.array(pairArgs),
  },
  returns: v.array(resultValidator),
  handler: async (ctx, args) => {
    if (args.pairs.length > COVERAGE_PAIRS_PER_INTERNAL_READ) {
      throw new Error(
        `coverageForPairs: ${args.pairs.length} pairs exceeds the ${COVERAGE_PAIRS_PER_INTERNAL_READ}-pair page`,
      );
    }
    return await computeCoverage(ctx, {
      sportId: args.sportId,
      setYear: args.setYear,
      pairs: args.pairs,
    });
  },
});

/**
 * Admin read: the players the card's printed name could instead mean, for the
 * career check's "link the cards to a different player". Existing players of
 * the set's sport that answer to the name (the alias leg included); the ones
 * whose career covers the card's team as of the set's year come first, each
 * group in the order the sport lookup returned them. `excludePlayerId` leaves
 * out the player being replaced.
 *
 * Someone with a different name is found with the wizard's player search; the
 * pick is sent on the card as `playerIdByName`.
 */
export const relinkCandidates = query({
  args: {
    selectorOptionId: v.id("selectorOptions"),
    printedName: v.string(),
    teamId: v.optional(v.id("teams")),
    teamName: v.optional(v.string()),
    excludePlayerId: v.optional(v.id("players")),
  },
  returns: v.object({
    setYear: v.union(v.number(), v.null()),
    candidates: v.array(
      v.object({
        playerId: v.id("players"),
        name: v.string(),
        birthYear: v.optional(v.number()),
        careerSummary: v.string(),
        covers: v.boolean(),
        activeInSetYear: v.optional(v.boolean()),
        matchedAlias: v.optional(v.string()),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    if (args.printedName.length > MAX_PLAYER_NAME_LENGTH) {
      throw new Error(
        `relinkCandidates: a player name of ${args.printedName.length} characters exceeds the ${MAX_PLAYER_NAME_LENGTH}-character limit`,
      );
    }
    assertPairText([args]);
    const sportId = await findSportForSelectorOption(ctx, args.selectorOptionId);
    if (!sportId) throw new Error("relinkCandidates: the set has no sport ancestor");
    const setYear = (await findSetYearForSelectorOption(ctx, args.selectorOptionId)) ?? null;
    const normalized = normalizePlayerName(args.printedName);
    if (!normalized) return { setYear, candidates: [] };
    // Fail closed, as the commit does: only players that belong to this
    // set's sport are ever offered, whatever leg of the lookup found them.
    const namesakes: Array<Doc<"players">> = [];
    for (const player of await sameNamePlayers(ctx, normalized, sportId)) {
      if (player._id === args.excludePlayerId) continue;
      if (await playerBelongsToSport(ctx, player, sportId)) namesakes.push(player);
    }
    if (namesakes.length === 0) return { setYear, candidates: [] };

    const memo: TeamFactsMemo = new Map();
    // A team id from another sport contributes no keys: nothing covers it.
    const cardTeam = args.teamId ? await ctx.db.get(args.teamId) : null;
    const teamId = cardTeam && cardTeam.sportId === sportId ? args.teamId : undefined;
    const cardKeys = await cardTeamKeysFor(
      ctx,
      sportId,
      { teamId, teamName: teamId || !args.teamId ? args.teamName : undefined },
      memo,
    );
    const covers = new Map<string, boolean>();
    for (const player of namesakes) {
      const stints = await stintsWithKeys(ctx, player.teamYears, memo);
      covers.set(
        player._id as string,
        setYear !== null && careerCoversCardTeam(stints, cardKeys, setYear),
      );
    }
    const active = new Set<string>(
      setYear === null
        ? []
        : (await narrowSameNamePlayersByCardYear(ctx, namesakes, { cardYear: setYear }))
            .activePlayerIds,
    );
    const rendered = await renderExistingPlayerCandidates(
      ctx,
      namesakes,
      normalized,
      active,
      new Date().getFullYear(),
    );
    const withCover = rendered.map((candidate) => ({
      playerId: candidate.playerId,
      name: candidate.name,
      ...(candidate.birthYear !== undefined ? { birthYear: candidate.birthYear } : {}),
      careerSummary: candidate.careerSummary,
      covers: covers.get(candidate.playerId as string) === true,
      ...(candidate.activeInSetYear ? { activeInSetYear: true } : {}),
      ...(candidate.matchedAlias ? { matchedAlias: candidate.matchedAlias } : {}),
    }));
    // Stable: covering players first, otherwise the lookup's own order.
    return {
      setYear,
      candidates: [
        ...withCover.filter((c) => c.covers),
        ...withCover.filter((c) => !c.covers),
      ],
    };
  },
});
