/**
 * NEO-645 / NEO-569 — the career verdict, with the set's leagues in it.
 *
 * `teamFill.careerTeamVerdict` is the one rule every team fill reads: the Team
 * tile's chips (`cardChecklist.suggestedTeamsForCard`), the commit's fill
 * (`selectorOptions` chunk), the answer-time fill (`teamFillOnAnswer`) and the
 * guarded Apply-to-all (`tidyCards.cardTakesTeamFill`). On main the same rule
 * ran inside `teamSuggestionsForPreview` with two inputs the walk's callers had
 * dropped:
 *
 *  - `rankOf` — how well each career team fits the set's own leagues (0 = the
 *    set's league, 1 = its level, 2 = anything else). It breaks a tie between
 *    two teams in the window and scopes NEO-569's undated-stint rule. Without
 *    it a Roanoke Express card in an ECHL/college set read "two teams in the
 *    window" and preselected nothing, though the set's leagues name the one;
 *  - the sport check — a team of another sport, or a gone one, is not a team,
 *    and a two-sport athlete's football stint must not make his baseball
 *    window a tie.
 *
 * This module is those two inputs, read once per call (caller-owned
 * `CareerVerdictCache`) and handed to the same `careerTeamVerdict`, so a chip
 * is preselected exactly when the fill would have written that team.
 *
 * Reads are lazy: a team's row (and its league) is read only when the verdict
 * can depend on it: the teams that cover the window, and the whole career when
 * the window is empty or any stint is undated. A team the verdict never read (a
 * career past `CAREER_TEAMS_READ`) is left out of the result, so every candidate
 * has passed the sport and gone checks.
 */

import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { effectiveSetLeagueIds } from "./selectorLeagues";
import {
  careerTeamVerdict,
  stintCoversWindow,
  teamPreferenceRank,
  UNRANKED,
  type CareerVerdict,
  type KeyedStint,
  type TeamPreferenceRank,
} from "./teamFill";

/** The set's leagues in the shape `teamPreferenceRank` reads; null = the set has none. */
export type SetPreference = {
  leagueIds: string[];
  levels: Array<string | null>;
} | null;

export type CareerVerdictCache = {
  /** By selectorOption id: the effective leagues of that row, in the card's sport. */
  preference: Map<string, SetPreference>;
  leagues: Map<string, Doc<"leagues"> | null>;
  teams: Map<string, Doc<"teams"> | null>;
};

export const newCareerVerdictCache = (): CareerVerdictCache => ({
  preference: new Map(),
  leagues: new Map(),
  teams: new Map(),
});

/** The most career teams one verdict reads (a career longer than this is read in stint order). */
const CAREER_TEAMS_READ = 24;

type ReadCtx = Pick<QueryCtx, "db">;

async function readLeague(
  ctx: ReadCtx,
  cache: CareerVerdictCache,
  leagueId: Id<"leagues">,
): Promise<Doc<"leagues"> | null> {
  if (!cache.leagues.has(leagueId)) cache.leagues.set(leagueId, await ctx.db.get(leagueId));
  return cache.leagues.get(leagueId) ?? null;
}

async function readTeam(
  ctx: ReadCtx,
  cache: CareerVerdictCache,
  teamId: Id<"teams">,
): Promise<Doc<"teams"> | null> {
  if (!cache.teams.has(teamId)) cache.teams.set(teamId, await ctx.db.get(teamId));
  return cache.teams.get(teamId) ?? null;
}

/**
 * The leagues the set under `selectorOptionId` is in (any-of, NEO-569), by NB's
 * own rows. A league of another sport, or one that is gone, is not ranked by.
 */
export async function setPreferenceOf(
  ctx: ReadCtx,
  cache: CareerVerdictCache,
  selectorOptionId: Id<"selectorOptions">,
  sportId: Id<"selectorOptions">,
): Promise<SetPreference> {
  const key = `${selectorOptionId}|${sportId}`;
  const hit = cache.preference.get(key);
  if (hit !== undefined) return hit;
  const leagues: Array<Doc<"leagues">> = [];
  for (const leagueId of await effectiveSetLeagueIds(ctx, selectorOptionId)) {
    const league = await readLeague(ctx, cache, leagueId);
    if (league && league.sportId === sportId) leagues.push(league);
  }
  const preference: SetPreference =
    leagues.length > 0
      ? {
          leagueIds: leagues.map((league) => league._id as string),
          levels: leagues.map((league) => league.level ?? null),
        }
      : null;
  cache.preference.set(key, preference);
  return preference;
}

export type CareerVerdictResult = {
  verdict: CareerVerdict<string>;
  /** The stints the verdict was counted over: gone, other-sport and unread (past the cap) teams removed. */
  stints: Array<KeyedStint<string>>;
  /** Teams whose dated stint covers the window (empty with no year). */
  windowKeys: string[];
};

/**
 * `careerTeamVerdict` over a player's stints, ranked by the set's leagues and
 * with a team of another sport (or a gone one) taken out first.
 *
 * `selectorOptionId` is any row under the set (the card's leaf); the leagues
 * come from the nearest row that carries them. `sportId` is the card's sport.
 */
export async function careerVerdictFor(
  ctx: ReadCtx,
  cache: CareerVerdictCache,
  input: {
    stints: ReadonlyArray<KeyedStint<string>>;
    year: number | undefined;
    currentYear: number;
    selectorOptionId: Id<"selectorOptions">;
    sportId: Id<"selectorOptions">;
  },
): Promise<CareerVerdictResult> {
  const { year } = input;
  const keys = [...new Set(input.stints.map((stint) => stint.key))];
  const covering = new Set(
    year === undefined
      ? []
      : input.stints
          .filter(
            (stint) =>
              stint.fromYear !== undefined &&
              stintCoversWindow({ fromYear: stint.fromYear, toYear: stint.toYear }, year),
          )
          .map((stint) => stint.key),
  );
  // What the verdict can depend on: the teams in the window, plus the whole
  // career when there is none (the one-team legend rule) or any stint is
  // undated (the undated rule scopes over every career team).
  const undated = input.stints.some((stint) => stint.fromYear === undefined);
  const wanted = (undated || covering.size === 0 ? keys : keys.filter((key) => covering.has(key))).slice(
    0,
    CAREER_TEAMS_READ,
  );

  const preference = await setPreferenceOf(ctx, cache, input.selectorOptionId, input.sportId);
  const rank = new Map<string, TeamPreferenceRank>();
  const gone = new Set<string>();
  for (const key of wanted) {
    const team = await readTeam(ctx, cache, key as Id<"teams">);
    if (!team || team.sportId !== input.sportId) {
      gone.add(key);
      continue;
    }
    let level: string | null = null;
    if (preference && team.leagueId) level = (await readLeague(ctx, cache, team.leagueId))?.level ?? null;
    rank.set(key, teamPreferenceRank({ leagueId: team.leagueId ?? null, leagueLevel: level }, preference));
  }

  // A team past the read cap was never checked for sport or gone: it is left out
  // of the candidates (a verdict and chips built only from teams that passed),
  // never offered unchecked at the lowest rank.
  const read = new Set(wanted);
  const stints = input.stints.filter((stint) => read.has(stint.key) && !gone.has(stint.key));
  const verdict = careerTeamVerdict({
    stints,
    year,
    currentYear: input.currentYear,
    rankOf: (key) => rank.get(key) ?? UNRANKED,
    setHasLeagues: preference !== null,
  });
  return {
    verdict,
    stints,
    windowKeys:
      year === undefined
        ? []
        : [
            ...new Set(
              stints
                .filter(
                  (stint) =>
                    stint.fromYear !== undefined &&
                    stintCoversWindow({ fromYear: stint.fromYear, toYear: stint.toYear }, year),
                )
                .map((stint) => stint.key),
            ),
          ],
  };
}
