import type { Id } from "../../../../convex/_generated/dataModel";
import { MAX_CARD_TEAMS } from "../../../../convex/features/cardAttention";
import { stintCoversWindow, UNRANKED } from "../../../../convex/lib/teamFill";

/**
 * NEO-645 — the evidence for ONE card's team, decided as main's Tidy Up wizard
 * decided it for one line (`teams-on-cards.ts`, `buildTeamsGroups`). Pure: no
 * Convex, no hooks, so every rule is testable from literal rows.
 *
 * The walk's card is a line of one. What the wizard took from "the other
 * confirmed cards of this sync" is here "the other cards of this checklist", and
 * what it took from the server (`cardChecklist.teamSuggestionsForPreview`, the
 * same query, unchanged) is `evidence`.
 *
 * ## The tiers, first answer wins
 *
 *  1. **batch**: the checklist's other cards with the SAME player set and a
 *     team. One distinct team set is the answer; two or more means the checklist
 *     disagrees with itself and the search STOPS: every team is offered, none
 *     selected, and no later tier speaks.
 *  2. **per player**: stored cards, then the career window (the server's tiers).
 *     EVERY player must answer, and the union must fit a card
 *     (`MAX_CARD_TEAMS`), or nothing is pre-filled and every team any of them
 *     offered is a choice. A tie is such a player: it pre-fills nothing, and a
 *     tie-break never hides the teams it ranked below.
 *
 * ## A data claim holds the guess back (invariant 8)
 *
 * Three claims hold a card's pre-fill back, from every tier at once: the
 * listing printed a team name NB did not settle (`listing`), the publisher's
 * checklist settled the card's team (`checklist`), the set's own default is
 * "No Team" (`setNoTeam`). The would-be pre-fill is then one more choice. A
 * lookup that failed or never ran is NOT a claim and is never passed here.
 *
 * Nothing here selects a team for being alone: a lone chip is selected only when
 * it IS the pre-fill.
 */

/** Options one card offers; a longer pre-fill is never cut (main's `TEAMS_SECTION_MAX_OPTIONS`). */
export const TEAM_OPTIONS_MAX = 6;

/** One team as the server suggests it. */
export type EvidenceTeam = { teamId: Id<"teams">; name: string; rank?: number };

/** One dated stint, as the server sends it. */
export type EvidenceStint = { teamId: Id<"teams">; fromYear: number; toYear?: number };

/** One player's evidence from `teamSuggestionsForPreview`. */
export type PlayerEvidence = {
  answer: { tier: string; teams: EvidenceTeam[] } | null;
  candidates: EvidenceTeam[];
  stints?: EvidenceStint[];
};

/** Why a rule's answer is not pre-filled. */
export type TeamHold = "setNoTeam" | "listing" | "checklist";

/** One team the card offers. */
export type LineOption = {
  teamId: Id<"teams">;
  /** The server's name for it; absent for a batch team (the caller reads its row). */
  name?: string;
  rank: number;
  /** The card's players the evidence names this team for, in card order (all of them, for batch). */
  playerIds: string[];
};

export type TeamLine = {
  /** The evidence has not arrived: nothing is pre-filled yet. */
  loading: boolean;
  /** The pre-fill; empty when nothing is pre-selected. */
  suggestion: Array<Id<"teams">>;
  /** Every chip, the pre-fill first, then by preference rank. */
  options: LineOption[];
  /** Set whenever a claim stands, whether or not a rule had an answer. */
  held: TeamHold | null;
  /** Where the answer (or the would-be answer) came from. */
  source: "otherCards" | "career" | null;
  /** Facts about a player with no answer, for the line over the chips. */
  tie: boolean;
  uncoveredSetYear?: number;
  noYear: boolean;
  /** The player's other cards disagree (a batch or stored tier stopped the search). */
  disagree: boolean;
};

const STORED_TIERS = new Set(["sameNode", "parallelOf", "baseSet"]);

/** One option per team, first place kept; the players that team is named for merge, in card order. */
function dedupe(options: LineOption[]): LineOption[] {
  const byTeam = new Map<string, LineOption>();
  for (const o of options) {
    const kept = byTeam.get(o.teamId);
    if (!kept) byTeam.set(o.teamId, { ...o, playerIds: [...o.playerIds] });
    else for (const id of o.playerIds) if (!kept.playerIds.includes(id)) kept.playerIds.push(id);
  }
  return [...byTeam.values()];
}

/** Stable: preference rank first, the evidence's own order within a rank. */
function byRank(options: LineOption[]): LineOption[] {
  return options
    .map((o, i) => ({ o, i }))
    .sort((a, b) => a.o.rank - b.o.rank || a.i - b.i)
    .map(({ o }) => o);
}

export function buildTeamLine(input: {
  /** The card's players, in card order, each once. */
  playerIds: ReadonlyArray<string>;
  /** Evidence by player id; undefined = the query has not answered. */
  evidence: ReadonlyMap<string, PlayerEvidence> | undefined;
  /** The distinct team sets the checklist's other cards of this player set carry. */
  batchSets: ReadonlyArray<ReadonlyArray<Id<"teams">>>;
  /** The claim standing on the card, if any. */
  held: TeamHold | null;
  /** The set's year; null when the server found none. */
  setYear: number | null;
}): TeamLine {
  const { playerIds, evidence, batchSets, held, setYear } = input;
  const everyone = [...playerIds];
  const opt = (team: EvidenceTeam, players: string[]): LineOption => ({
    teamId: team.teamId,
    name: team.name,
    rank: team.rank ?? UNRANKED,
    playerIds: players,
  });
  const batchOpt = (teamId: Id<"teams">): LineOption => ({
    teamId,
    rank: UNRANKED,
    playerIds: everyone,
  });

  let suggestion: LineOption[] = [];
  let choices: LineOption[] = [];
  let loading = false;
  let source: TeamLine["source"] = null;
  let tie = false;
  let uncoveredSetYear: number | undefined;
  let noYear = false;
  let disagree = false;

  if (playerIds.length > 0 && batchSets.length === 1) {
    suggestion = batchSets[0].map(batchOpt);
    source = "otherCards";
  } else if (playerIds.length > 0 && batchSets.length > 1) {
    // The checklist disagrees with itself: the operator picks.
    choices = batchSets.flatMap((set) => set.map(batchOpt));
    disagree = true;
  } else if (playerIds.length > 0) {
    const verdicts = playerIds.map((id) => ({ id, evidence: evidence?.get(id) }));
    loading = verdicts.some((v) => v.evidence === undefined);
    if (!loading) {
      const answers = verdicts.map((v) => v.evidence!.answer);
      const union = dedupe(
        verdicts.flatMap((v) => (v.evidence!.answer?.teams ?? []).map((t) => opt(t, [v.id]))),
      );
      if (answers.every((a) => a !== null) && union.length <= MAX_CARD_TEAMS) {
        suggestion = union;
        // A tie-break never hides the teams it ranked below.
        choices = verdicts.flatMap((v) => v.evidence!.candidates.map((t) => opt(t, [v.id])));
        source = answers.every((a) => !STORED_TIERS.has(a!.tier)) ? "career" : "otherCards";
      } else {
        choices = verdicts.flatMap((v) => [
          ...(v.evidence!.answer?.teams ?? []).map((t) => opt(t, [v.id])),
          ...v.evidence!.candidates.map((t) => opt(t, [v.id])),
        ]);
        // Why the unanswered players have none, read from their own career.
        for (const v of verdicts) {
          const e = v.evidence!;
          if (e.answer || e.candidates.length === 0) continue;
          const career = e.stints ?? [];
          const careerTeams = new Set<string>(career.map((s) => s.teamId));
          if (e.candidates.some((c) => !careerTeams.has(c.teamId))) {
            // Offered teams the career does not hold: a stored tier's cards disagree.
            disagree = true;
            continue;
          }
          if (setYear === null) {
            noYear = true;
            continue;
          }
          const inWindow = new Set(
            career.filter((s) => stintCoversWindow(s, setYear)).map((s) => s.teamId as string),
          );
          if (inWindow.size >= 2) tie = true;
          else if (inWindow.size === 0) uncoveredSetYear = setYear;
        }
      }
    }
  }

  // Invariant 8: a standing claim holds every pre-fill back; it becomes a choice.
  if (held) {
    choices = [...suggestion, ...choices];
    suggestion = [];
  }

  const lead = suggestion;
  const options = dedupe([...lead, ...byRank(choices)]).slice(
    0,
    Math.max(TEAM_OPTIONS_MAX, lead.length),
  );
  return {
    loading,
    suggestion: lead.map((o) => o.teamId),
    options,
    held,
    source,
    tie,
    ...(uncoveredSetYear !== undefined ? { uncoveredSetYear } : {}),
    noYear,
    disagree,
  };
}
