/**
 * NEO-574 — the database half of the career-coverage rule.
 *
 * `careerCoverage.ts` (lib) is the pure rule over keys. This file turns rows
 * into keys: a player's stints into `CoverageStint`s and a card's team (a row,
 * a printed string, or both) into the key set the rule matches against. It is
 * imported by the public queries in `convex/careerCoverage.ts` and by the
 * commit prelude's rule 6b in `convex/players.ts`, which is why it lives
 * under `lib/` rather than beside the queries: `players.ts` cannot import
 * `careerCoverage.ts` (that module imports `players.ts`), and a cycle between
 * two Convex modules is not worth a shorter path.
 *
 * Reads go through a memo the caller owns, so a team shared by many stints is
 * read once per transaction.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { teamFullName } from "../../lib/teams/team-name";
import {
  careerCoversCardTeam,
  teamNameKey,
  teamRowCardKeys,
  teamRowKeys,
  type CoverageStint,
} from "./careerCoverage";
import { findTeamsByFullName } from "./teamRow";

type Ctx = QueryCtx | MutationCtx;

/** What a team row contributes to a match, read once. */
export type TeamFacts = {
  /** Stint-side keys: id, franchise, full name, nickname. */
  stintKeys: string[];
  /** Card-side keys: id, franchise, full name. */
  cardKeys: string[];
  franchiseId?: string;
};

/** A team id -> its facts, `null` for a row that is gone. */
export type TeamFactsMemo = Map<string, TeamFacts | null>;

function factsOf(team: Doc<"teams">): TeamFacts {
  const row = {
    id: team._id as string,
    franchiseId: team.franchiseId as string | undefined,
    fullName: teamFullName(team),
    name: team.name,
  };
  return {
    stintKeys: teamRowKeys(row),
    cardKeys: teamRowCardKeys(row),
    ...(team.franchiseId ? { franchiseId: team.franchiseId as string } : {}),
  };
}

/** One memoised team read. */
export async function readTeamFacts(
  ctx: Ctx,
  memo: TeamFactsMemo,
  teamId: Id<"teams">,
): Promise<TeamFacts | null> {
  const key = teamId as string;
  if (memo.has(key)) return memo.get(key) ?? null;
  const team = await ctx.db.get(teamId);
  const facts = team ? factsOf(team) : null;
  memo.set(key, facts);
  return facts;
}

/** A player's stints with each team's keys attached. A vanished team has no keys. */
export async function stintsWithKeys(
  ctx: Ctx,
  teamYears: Doc<"players">["teamYears"],
  memo: TeamFactsMemo,
): Promise<CoverageStint[]> {
  const out: CoverageStint[] = [];
  for (const stint of teamYears ?? []) {
    const facts = await readTeamFacts(ctx, memo, stint.teamId);
    out.push({
      keys: facts?.stintKeys ?? [],
      ...(stint.fromYear !== undefined ? { fromYear: stint.fromYear } : {}),
      ...(stint.toYear !== undefined ? { toYear: stint.toYear } : {}),
    });
  }
  return out;
}

/**
 * The most rows one printed team name may resolve to for the card side of a
 * match. A name has one era, occasionally two; the cap only stops a bad
 * import turning a lookup into a scan.
 */
export const CARD_TEAM_ROWS_PER_NAME = 4;

/**
 * The key set of a card's team. `teamId` gives its row's id, franchise and
 * full name; `teamName` adds the printed text's own name key and, when there
 * is no `teamId`, every row of the sport that answers to that text (so a
 * printed "Titans" matches a stint at the franchise's other-named rows).
 */
export async function cardTeamKeysFor(
  ctx: Ctx,
  sportId: Id<"selectorOptions">,
  ref: { teamId?: Id<"teams">; teamName?: string },
  memo: TeamFactsMemo,
): Promise<Set<string>> {
  const keys = new Set<string>();
  if (ref.teamId) {
    const facts = await readTeamFacts(ctx, memo, ref.teamId);
    for (const key of facts?.cardKeys ?? []) keys.add(key);
  }
  const printed = ref.teamName?.trim();
  if (printed) {
    const key = teamNameKey(printed);
    if (key) keys.add(key);
    if (!ref.teamId) {
      const rows = await findTeamsByFullName(ctx, sportId, printed, CARD_TEAM_ROWS_PER_NAME);
      for (const row of rows) {
        const facts = await readTeamFacts(ctx, memo, row._id);
        for (const k of facts?.cardKeys ?? []) keys.add(k);
      }
    }
  }
  return keys;
}

/** One pair to check; the same shape the public query takes. */
export type CoveragePairInput = {
  playerId: Id<"players">;
  teamId?: Id<"teams">;
  teamName?: string;
};

export type CoveragePairResult = CoveragePairInput & { covered: boolean };

/**
 * The coverage of each pair, aligned with the input. With no `setYear` there
 * is nothing to compare against and every pair reads as covered. A vanished
 * player is covered too: there is nothing to add a stint to.
 */
export type CoverageMemo = {
  teams: TeamFactsMemo;
  stintsByPlayer: Map<string, CoverageStint[] | null>;
};
export const newCoverageMemo = (): CoverageMemo => ({ teams: new Map(), stintsByPlayer: new Map() });

export async function computeCoverage(
  ctx: Ctx,
  args: {
    sportId: Id<"selectorOptions">;
    setYear: number | null;
    pairs: ReadonlyArray<CoveragePairInput>;
    /**
     * Reads shared across calls (the commit chunk asks one card at a time; a
     * fresh memo per call read every team and player again for each card).
     */
    memo?: CoverageMemo;
  },
): Promise<CoveragePairResult[]> {
  const memo = args.memo ?? newCoverageMemo();
  const teamMemo = memo.teams;
  const stintsByPlayer = memo.stintsByPlayer;
  const out: CoveragePairResult[] = [];
  for (const pair of args.pairs) {
    const echo: CoveragePairInput = {
      playerId: pair.playerId,
      ...(pair.teamId ? { teamId: pair.teamId } : {}),
      ...(pair.teamName !== undefined ? { teamName: pair.teamName } : {}),
    };
    if (args.setYear === null) {
      out.push({ ...echo, covered: true });
      continue;
    }
    const playerKey = pair.playerId as string;
    let stints = stintsByPlayer.get(playerKey);
    if (stints === undefined) {
      const player = await ctx.db.get(pair.playerId);
      stints = player ? await stintsWithKeys(ctx, player.teamYears, teamMemo) : null;
      stintsByPlayer.set(playerKey, stints);
    }
    if (stints === null) {
      out.push({ ...echo, covered: true });
      continue;
    }
    const cardKeys = await cardTeamKeysFor(ctx, args.sportId, pair, teamMemo);
    out.push({ ...echo, covered: careerCoversCardTeam(stints, cardKeys, args.setYear) });
  }
  return out;
}
