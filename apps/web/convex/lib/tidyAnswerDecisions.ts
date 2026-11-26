/**
 * NEO-656 — what the review gate decided on its own (`gateLinks`), read the way
 * the commit prelude reads a review decision.
 *
 * The prelude's whole decision machinery (a link beats the exactly-one fast
 * path, an auto-link carries its origin, a team link may remember the printed
 * spelling as an alias) was written against review rows with a `decision`.
 * Nothing stores those rows any more: the gate returns the links it made
 * (`resolveChecklistEntities` -> `gateLinks`), the client hands them back to
 * `commitCardChecklist`, and the prelude reads each one through this adapter,
 * so every rule it had (NEO-424 set history, NEO-463, NEO-307, NEO-284,
 * NEO-313, NEO-602) runs unchanged.
 *
 *   player link -> { action: "link", linkedPlayerId, autoLinked: origin }
 *   team link   -> { action: "link", linkedTeamId,   autoLinked: origin }
 *
 * A name with no link has no decision (it is pending, and the walk answers it
 * on the card). Pure: ids and strings only.
 */

import { v, type Infer } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { normalizeEntityName } from "../../lib/entities/normalize-name";

/** Entries the commit accepts in `gateLinks`: the Convex array limit. */
export const GATE_LINKS_MAX = 8192;
/** Gate links one `checkGateLinks` call re-checks (a read per link). */
export const GATE_LINKS_PER_CHECK = 1000;

const gateOriginValidator = v.union(
  v.literal("setHistory"),
  v.literal("hallOfFame"),
  v.literal("careerTeam"),
);

/**
 * One automatic answer the gate made (rules A / D / 6b / F): the player or team
 * a printed name was linked to, and why. Facts for the commit, never stored.
 */
export const gateLinkValidator = v.object({
  kind: v.union(v.literal("player"), v.literal("team")),
  name: v.string(),
  playerId: v.optional(v.id("players")),
  teamId: v.optional(v.id("teams")),
  origin: gateOriginValidator,
  /** History player first, then in-sport rivals; present when there are two or more. */
  candidatePlayerIds: v.optional(v.array(v.id("players"))),
});
export type GateLink = Infer<typeof gateLinkValidator>;

/** A gate link the commit re-checked: its sport is the player's or team's own. */
export const checkedGateLinkValidator = v.object({
  kind: v.union(v.literal("player"), v.literal("team")),
  name: v.string(),
  playerId: v.optional(v.id("players")),
  teamId: v.optional(v.id("teams")),
  origin: gateOriginValidator,
  sportId: v.id("selectorOptions"),
});
export type CheckedGateLink = Infer<typeof checkedGateLinkValidator>;

/**
 * One name the gate established a fact about, for the walk (`tidyLeafFacts`).
 * The same facts the gate once wrote onto its per-name rows.
 */
export const gateItemValidator = v.object({
  kind: v.union(v.literal("player"), v.literal("team")),
  name: v.string(),
  /** The sport the question is asked in (an auto-linked player's HOME sport). */
  sportId: v.id("selectorOptions"),
  /** The caller proved no player of this name exists (NEO-296). */
  noExistingMatch: v.optional(v.literal(true)),
  /** The gate answers the name: rule A / D / 6b / F. */
  auto: v.optional(
    v.object({
      playerId: v.optional(v.id("players")),
      teamId: v.optional(v.id("teams")),
      origin: gateOriginValidator,
      /** History player first, then in-sport rivals; present when there are two or more. */
      candidatePlayerIds: v.optional(v.array(v.id("players"))),
    }),
  ),
  /** The set's history links the name to 2+ players: a choice, no lookup. */
  historyPlayerIds: v.optional(v.array(v.id("players"))),
  /** Rule E: an obvious candidate the operator still confirms. */
  preselect: v.optional(
    v.object({
      playerId: v.id("players"),
      sportId: v.id("selectorOptions"),
      sportValue: v.string(),
      reason: v.union(v.literal("priorYearProduct"), v.literal("onlyNamesake")),
    }),
  ),
  /** NEO-602: the rows a team name reached. Display only. */
  candidateTeamIds: v.optional(v.array(v.id("teams"))),
  /** NEO-591: the candidates are places. */
  candidatePlace: v.optional(v.literal(true)),
});
export type GateItem = Infer<typeof gateItemValidator>;

/** The wizard-era decision shapes the prelude's machinery was written against. */
export type PreludeDecision =
  | {
      action: "link";
      linkedPlayerId?: Id<"players">;
      linkedTeamId?: Id<"teams">;
      linkedLeagueId?: Id<"leagues">;
      saveAsAlias?: boolean;
      addSetSport?: boolean;
      autoLinked?: "setHistory" | "hallOfFame" | "careerTeam";
    }
  | { action: "skip" }
  | {
      action: "create";
      manualCareerTeams?: Array<{ name: string; fromYear: number; toYear?: number }>;
      excludedCareerTeamNames?: string[];
      create?: {
        location?: string;
        name: string;
        yearsActive?: { from: number; to?: number };
        leagueId?: Id<"leagues"> | null;
        leagueName?: string;
        aliases?: string[];
      };
      createTeams?: Array<{ sourceName: string; location?: string; name: string }>;
      linkTeams?: Array<{ sourceName: string; teamId: Id<"teams"> }>;
      createLeague?: {
        name: string;
        abbreviation?: string;
        level?: "major" | "minor" | "college" | "international" | "independent" | "other";
        yearsActive?: { from: number; to?: number };
        aliases?: string[];
        wikidataId?: string;
      };
      addSetSport?: boolean;
      oneNamePlayer?: true;
    };

/** What a lookup offered for a name, as the prelude's create machinery reads it. */
export type PreludeEnrichment = {
  wikidataId?: string;
  careerTeams?: Array<{ name: string; fromYear: number; toYear?: number; wikidataId?: string }>;
  undatedCareerTeams?: string[];
  isHallOfFame?: boolean;
  description?: string;
  birthYear?: number;
  enwikiTitle?: string;
  existingCandidates?: Array<{
    playerId: Id<"players">;
    name: string;
    birthYear?: number;
    careerSummary: string;
    activeInSetYear?: boolean;
    matchedAlias?: string;
    sportValue?: string;
  }>;
  league?: string;
  leagueWikidataId?: string;
  location?: string;
  yearsActive?: { from: number; to?: number };
  colors?: { primary?: string; secondary?: string };
  espnId?: string;
  abbreviation?: string;
};

/** The prelude's view of one review decision. */
export type PreludeReviewRow = {
  _id: string;
  kind: "player" | "team" | "league";
  /** First-seen spelling; the prelude keys it again with its own normaliser. */
  name: string;
  nameNormalized: string;
  sportId: Id<"selectorOptions">;
  /** Set only on a row staged for a player's career or a team's league. */
  source?:
    | { kind: "careerTeamOf"; playerRowId: string }
    | { kind: "leagueOf"; teamRowId: string };
  enrichment?: PreludeEnrichment;
  decision?: PreludeDecision;
};

/**
 * The row the commit prelude reads for one re-checked gate link. Only the
 * fields the prelude reads are real (`kind`, `name`, `sportId`, `decision`);
 * the rest is the link's own identity, so `reviewByKey` and the alias / sport
 * walks run unchanged.
 */
export function gateLinkRowOf(link: CheckedGateLink): PreludeReviewRow {
  return {
    _id: `gateLink:${link.kind}:${normalizeEntityName(link.name)}`,
    kind: link.kind,
    name: link.name,
    nameNormalized: normalizeEntityName(link.name),
    sportId: link.sportId,
    decision: {
      action: "link",
      ...(link.kind === "player"
        ? { linkedPlayerId: link.playerId }
        : { linkedTeamId: link.teamId }),
      autoLinked: link.origin,
    },
  };
}
