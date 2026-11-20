import type { Id } from "../../convex/_generated/dataModel";
import { normalizeEntityName } from "../../convex/lib/entityNearMatch";
import { listingNamesAPlayer } from "../../convex/lib/cardPlayerDefaults";
// Browser-safe: `features/cardAttention.ts` has no server imports (it is
// already read by the attention walker in the browser).
import { MAX_CARD_TEAMS } from "../../convex/features/cardAttention";
// Browser-safe: `lib/teamFill.ts` is pure by contract (ids in, answer out).
// The career window rule lives there ONCE, for the server and for a player
// created in this wizard alike.
import {
  careerTeamVerdict,
  UNRANKED,
  type TeamPreferenceRank,
} from "../../convex/lib/teamFill";
import { teamFullName } from "../../lib/teams/team-name";
import { checklistClaimsNoTeam } from "../../lib/checklists/no-team";
import type { TeamLookupOutcome } from "./checklist-conflict";

export { MAX_CARD_TEAMS };

/**
 * NEO-335 — the Teams step: which confirmed cards will save with no team,
 * what evidence says about each, and what the operator answered.
 *
 * Pure: no Convex, no hooks, no I/O. The entity review wizard's Teams step
 * (`TeamsOnCardsSection`) supplies the preview cards, the batch rows and the
 * server's evidence; everything it renders is decided here, so the whole
 * thing is testable as a function of its inputs — the same split
 * `entity-review-staging.ts` makes for the career-team typeahead.
 *
 * ## Who is in the section
 *
 * A confirmed card none of whose team strings will resolve at commit: no
 * strings at all (SportLots never sends one), or every string a name the
 * operator skipped as "not a team" — in this sitting, or in an earlier save
 * of this set (the set's skip records, `StoredPeople.skippedTeamNames`). Any
 * other string with no review row resolved before the wizard opened
 * (`resolveChecklistEntities` only queues unknowns, and drops a skipped name
 * before it asks), so it counts as a team.
 *
 * Never in the section: a card whose publisher checklist said "No Team"
 * (NEO-489, `checklistClaimsNoTeam`: `teamLookup: "checklist"` with no team
 * strings). That is the checklist's answer, not a gap: the commit saves it
 * as a confirmed no-team card, so asking would put an answered question back
 * to the operator. Being outside the section it gets no line, so no pre-fill
 * and no "Fill" can reach it (invariant 8: the claim holds every guess back),
 * and it gives no batch evidence to a sibling with the same player, because
 * it prints no team to give.
 *
 * Membership is computed from the cards and the
 * Names-phase decisions ONLY — never from this section's own answers, so a
 * line does not vanish under the operator's cursor the moment they answer it.
 *
 * ## Evidence, first answer wins
 *
 *  (i) **batch** — other confirmed cards in this preview with the SAME player
 *      set whose team resolves. One distinct team set is the answer; two or
 *      more means the checklist disagrees with itself and the search stops,
 *      offering every team as an unselected choice.
 *  (ii)+(iii) **per player** — linked and already-known players from the
 *      server (`cardChecklist.teamSuggestionsForPreview`: stored rows, then
 *      the career window); players CREATED in this wizard from their own
 *      row's career (`enrichment.careerTeams`, minus what the operator
 *      unchecked, plus what they typed) through the SAME window rule
 *      (`careerTeamVerdict`). Every player answering → the union is
 *      pre-filled. Anyone not answering → every team any of them offered,
 *      unselected.
 *
 * The career window (NEO-335 Phase 2, C2): exactly one team covering
 * `[setYear - 1, setYear]`, or in a tie the one team the set's league
 * prefers (C2b). With nothing in the window, a legend's ONE-team career
 * pre-fills only when that team is in the set's own league; any other legend
 * gets his career unselected, longest stint first. Choices are ordered by
 * that preference rank, which never hides a team and never forces a pick.
 *
 * ## A listing's team claim holds the guess back (invariant 8)
 *
 * "A data claim holds back a guess; it never makes one." A card in the
 * section whose listing printed a team name NB could not resolve and the
 * operator has NOT ruled on, or whose team lookup FAILED (the listing may
 * name a team we never heard), gets NO pre-fill from any rule — batch,
 * stored rows, career, preference. The line comes up on "Leave for later";
 * the listed name is SHOWN (`listedNames`), the existing NB teams it names
 * are offered first as choices (`teamNameEvidence`), and the evidence's
 * teams follow as unselected choices. The listing's string itself is never
 * written as NB data: a chip is always an existing team (by id), a team
 * staged in this wizard, or one the operator found or created with
 * "Other team…".
 *
 * A name the operator ruled "not a team" (its step skipped) in this sitting
 * is no longer a claim (Jason, NEO-335 Phase 2): the operator has already
 * answered it, so it neither blocks the pre-fill nor is shown, and the line
 * falls back to the normal rules. The same holds for a name an EARLIER save
 * of this set skipped: the set's skip records are that answer, kept.
 *
 * Never a guess: a tie stays unselected, and a card number is never a key —
 * a card is identified by its POSITION in the preview, which is the only
 * identity it has until it is saved (product invariant 7).
 *
 * ## A teamless sport is a default, never a block (NEO-426)
 *
 * A sport row an operator flagged "No teams in this sport" (Non Sport, Golf,
 * Tennis; `isTeamlessSport`, never the sport's name) changes the DEFAULT for
 * one kind of card: a NEW card that would save with no team, has at least one
 * person on it, and whose every person has that sport as their HOME sport
 * (`players.sportId`; extra sports never count). Such a card is not asked
 * about: the commit stamps it "No team" itself, exactly as it stamps the
 * set's own No Team (`noTeamCardVerdict` on the card as it is born), and the
 * Save step says how many there are (`autoNoTeamIndexes`).
 *
 * This is the client half of that one verdict, and it only ever errs toward
 * ASKING: the client may put a line up for a card the server would have
 * stamped, never the reverse. So a card goes to the operator, as before, when
 * anything is not plainly the default:
 *  - the card re-syncs a stored row (the client cannot see that row's lookup
 *    bookkeeping, which the server's verdict reads);
 *  - a person is not known to be teamless: mixed card, a sport not loaded yet,
 *    a name still waiting on review;
 *  - the card has nobody on it (nothing says what sport it is);
 *  - a data claim stands (invariant 8): the listing names a team the operator
 *    has not ruled out, or a BSC card's team lookup has not ended with no
 *    team (`setDefaultSettlesNewRow` reads the lookup the same way).
 * Nothing here refuses, hides or strips a team: a team from any source wins,
 * and one picked later in the card editor sticks.
 *
 * ## Choices
 *
 * One line per player set. A line whose card has several people on it (or
 * whose answer is several teams) is MULTI-select, up to `MAX_CARD_TEAMS`
 * (C4); every other line picks one. "Other team…" adds a team the evidence
 * did not offer, found or created through the team picker, as `extra` on the
 * choice so it survives the operator flipping to "No team" and back (C1). A
 * card inside a grouped line can take its own answer (C3), filed under
 * `cardChoiceKey`; `{ kind: "line" }` hands it back to the line.
 *
 * ## What an answer writes
 *
 * Onto the preview card, for the commit to read, and nowhere else (wizard
 * answers are never stored):
 *  - `teamIds` — existing NB teams, by id (server evidence, "Other team…");
 *  - `teams` — team STRINGS the commit already resolves the way it resolves
 *    every card's printed team: a team staged in this wizard (by its review
 *    row's name, which is the key the commit's decision map uses), or a
 *    sibling card's printed team (batch evidence);
 *  - `teamNone: true` — "No team on this card".
 */

/** The preview card fields this module reads (a structural subset of `FetchPreview`'s cards). */
export interface PreviewCardForTeams {
  cardNumber: string;
  cardName: string;
  team?: string;
  teams?: string[];
  players?: string[];
  /**
   * NEO-574 / NEO-591 — a printed name the career step pointed at another
   * person: an existing player (`playerIdByName`) or a new one the commit
   * creates (`newPlayerByName`, by ref). That person is who the card has for
   * the teams step, not whoever the printed name matched.
   */
  playerIdByName?: ReadonlyArray<{ name: string; playerId: string }>;
  newPlayerByName?: ReadonlyArray<{ name: string; ref: string }>;
  /**
   * How the fetch-time team lookup for this card ended. "failed" means the
   * listing's answer never arrived, so no rule may guess a team for it
   * (invariant 8): the operator picks. NEO-478 "checklist" means the
   * operator's published checklist settled the team — a data claim on the
   * same terms: no rule may fill a different team over it. With no team
   * strings, "checklist" means the checklist said "No Team" (NEO-489,
   * `checklistClaimsNoTeam`).
   */
  teamLookup?: TeamLookupOutcome;
  /**
   * BSC's unsplit team value, kept only where `teams` does not already say it
   * (a split that was refused, or over the cap). With no team strings it is
   * the listing's claim about the team: see `listedClaims`. NEO-426 — the
   * teamless-sport default reads it too, the way the commit's `commitTeamHint`
   * does.
   */
  rawTeamName?: string;
  /** NEO-426 — only the BSC ref's PRESENCE is read (a lookup is due or not). */
  platformData?: { bsc?: unknown };
}

/** The operator's answer for one card, as the commit reads it. */
export type TeamAnswer = {
  teamIds?: Array<Id<"teams">>;
  teams?: string[];
  teamNone?: true;
};

type TeamColors = { primary?: string; secondary?: string };
type CareerStint = { name: string; fromYear: number; toYear?: number };

/** The subset of an `entityReviewQueue.getBatch` row this module reads. */
export interface TeamsReviewRow {
  _id: string;
  kind: "player" | "team" | "league";
  name: string;
  /**
   * NEO-426 — the sport the row files under: a player CREATED from it is born
   * with this as his home sport (the operator may have switched it from the
   * set's). Read only by the teamless-sport default; absent = not teamless.
   */
  sportId?: string;
  enrichment?: {
    careerTeams?: CareerStint[];
    /** NEO-569 — Wikidata teams with no years; see `createdUndatedNames`. */
    undatedCareerTeams?: string[];
    colors?: TeamColors;
  } | null;
  decision?:
    | {
        action: "create";
        create?: { location?: string; name: string; leagueId?: string | null };
        manualCareerTeams?: CareerStint[];
        excludedCareerTeamNames?: string[];
      }
    | { action: "link"; linkedPlayerId?: string; linkedTeamId?: string }
    | { action: "skip" }
    | null;
}

/** One team as the server suggests it. */
export interface ServerTeam {
  teamId: Id<"teams">;
  name: string;
  colors?: TeamColors;
  /** C2b — 0 the set's league, 1 its level, 2 other. Absent = 2. */
  rank?: number;
}

/** One player's evidence from `teamSuggestionsForPreview`. */
export interface ServerPlayerEvidence {
  answer: { tier: string; teams: ServerTeam[] } | null;
  candidates: ServerTeam[];
}

/** A player the server is asked about. `key` is what its evidence is filed under. */
export interface EvidenceRequest {
  key: string;
  playerId?: Id<"players">;
  name?: string;
}

/** A team name the server is asked to resolve to existing NB teams. `key` = normalized name. */
export interface TeamNameRequest {
  key: string;
  name: string;
  /**
   * Also ask for the teams whose LOCATION is this name. Every name a LISTING
   * printed gets it (collector review): Onyx prints teams as places
   * ("Seattle"), and the place is the only thing that finds "Seattle
   * Mariners". It adds choices; it never pre-fills one.
   */
  location?: true;
}

/** One team chip. */
export interface TeamRef {
  /** `id:<teamId>` or `name:<normalized>` — dedup identity. */
  key: string;
  /** What the chip says. */
  label: string;
  colors?: TeamColors;
  /** Set for an existing NB team → the answer's `teamIds`. */
  teamId?: Id<"teams">;
  /** Set for a team the commit resolves by string → the answer's `teams`. */
  name?: string;
  /** C2b preference, for ordering. Absent = 2. */
  rank?: number;
}

/** Cards that share a player set (and a listing claim) share evidence, so they share one line. */
export interface TeamsGroup {
  key: string;
  /** Display names, as printed on the first card of the group. */
  players: string[];
  /** Preview positions, ascending. */
  cards: Array<{ index: number; cardNumber: string; cardName: string }>;
  /** Several people on the card (or several teams in its answer): pick up to `MAX_CARD_TEAMS`. */
  multi: boolean;
  /** Every team chip the line offers: the pre-fill first, the listing's teams next, then by preference. */
  refs: TeamRef[];
  /** The pre-filled selection (ref keys), when evidence gave one and nothing held it back. */
  suggestion: string[] | null;
  /**
   * Invariant 8 — team names the listing printed that NB could not resolve
   * and the operator has not ruled "not a team". Shown, never written.
   */
  listedNames: string[];
  /** Invariant 8 — the listing's team lookup failed for these cards. */
  lookupFailed: boolean;
  /**
   * NEO-478, invariant 8 — the operator's published checklist is where these
   * cards' teams came from (`teamLookup: "checklist"`), so nothing is
   * pre-filled over it. Absent reads as false.
   */
  checklistClaim?: boolean;
  /** Server evidence for at least one player (or listed name) has not arrived yet. */
  loading: boolean;
}

/** Team ids found with "Other team…", kept whatever the line is set to. */
type Extra = { extra?: Array<Id<"teams">> };

export type GroupChoice =
  | ({ kind: "teams"; refKeys: string[] } & Extra)
  | ({ kind: "none" } & Extra)
  | ({ kind: "later" } & Extra)
  /** Per-card only: follow the line again. */
  | { kind: "line" };

/** The one line every teamless card with no players shares. */
export const NO_PLAYERS_GROUP_KEY = "no-players";

/** How many team chips one line offers before "Other team…". */
export const TEAMS_SECTION_MAX_OPTIONS = 6;

/**
 * Players per server call. Mirrors `TEAM_SUGGESTION_MAX_PLAYERS` in
 * convex/cardChecklist.ts (the server refuses more); a convex test pins the
 * two together. A browser bundle cannot import that module.
 */
export const TEAMS_SECTION_PLAYERS_PER_REQUEST = 32;

/** Team names per server call. Mirrors `TEAM_SUGGESTION_MAX_TEAM_NAMES` (pinned by the same test). */
export const TEAMS_SECTION_NAMES_PER_REQUEST = 32;

/** How many player calls the section makes at most (×32 players). */
export const TEAMS_SECTION_MAX_REQUESTS = 8;

/**
 * NEO-591 — how many of one name call's names get the location leg. Mirrors
 * `TEAM_SUGGESTION_MAX_LOCATION_NAMES` in convex/cardChecklist.ts (a browser
 * bundle cannot import that module; the server ignores any past its own cap).
 */
export const TEAMS_SECTION_LOCATION_NAMES_PER_REQUEST = 8;

/**
 * The name BUDGET, not a call count: at most 4 × `TEAMS_SECTION_NAMES_PER_REQUEST`
 * (128) names are asked about. Calls are sliced further to keep each call's
 * location leg within `TEAMS_SECTION_LOCATION_NAMES_PER_REQUEST`, so up to 16
 * calls happen for 128 names (`nameRequestSlices`).
 */
export const TEAMS_SECTION_MAX_NAME_REQUESTS = 4;

/**
 * The name requests split into calls: at most `TEAMS_SECTION_NAMES_PER_REQUEST`
 * names and `TEAMS_SECTION_LOCATION_NAMES_PER_REQUEST` location names each, in
 * first-seen order. The server gives the location leg to the first 8 names of
 * a call and silently none to the rest, so a call is closed at 8 location
 * names rather than letting the 9th be asked for and quietly not answered.
 * A set whose listings print a place on every card (Onyx) therefore makes more
 * calls than one that does not, for the same names.
 */
export function nameRequestSlices(requests: readonly TeamNameRequest[]): TeamNameRequest[][] {
  const out: TeamNameRequest[][] = [];
  let current: TeamNameRequest[] = [];
  let locations = 0;
  for (const request of requests) {
    const full =
      current.length >= TEAMS_SECTION_NAMES_PER_REQUEST ||
      (request.location && locations >= TEAMS_SECTION_LOCATION_NAMES_PER_REQUEST);
    if (full && current.length > 0) {
      out.push(current);
      current = [];
      locations = 0;
    }
    current.push(request);
    if (request.location) locations++;
  }
  if (current.length > 0) out.push(current);
  return out;
}

const norm = (raw: string): string => normalizeEntityName(raw.trim());

/** Where one card's own answer is filed in the choices record (C3). */
export function cardChoiceKey(groupKey: string, index: number): string {
  return `${groupKey}#card:${index}`;
}

/** The ref key of an existing NB team. */
export function teamIdKey(teamId: Id<"teams">): string {
  return `id:${teamId}`;
}

/**
 * The team strings printed on a card — `teams[]`, else the legacy `team`.
 * Mirrors `cardTeamNames` in convex/selectorOptions.ts so the two agree on
 * what a card says.
 */
export function cardTeamStrings(card: PreviewCardForTeams): string[] {
  const named = (card.teams ?? []).map((t) => t.trim()).filter(Boolean);
  if (named.length === 0 && card.team?.trim()) named.push(card.team.trim());
  return Array.from(new Set(named));
}

/**
 * NEO-556 — the set-level team default a checklist row carries, in its three
 * states: a team (or teams) every new card gets, "No Team", or nothing. A row
 * that somehow carries both reads as teams, as the server reads it
 * (`teamDefaultOf`).
 */
export type SetTeamDefaultKind = "teams" | "noTeam" | "none";

export function setTeamDefaultKind(
  row:
    | {
        teamIds?: ReadonlyArray<unknown>;
        /** `getAncestorChain`'s row: the third state as a plain flag. */
        noTeam?: boolean;
        /** `getSelectorOptionById`'s whole document: the stored stamp. */
        noTeamDefault?: unknown;
      }
    | null
    | undefined,
): SetTeamDefaultKind {
  if ((row?.teamIds?.length ?? 0) > 0) return "teams";
  if (row?.noTeam === true) return "noTeam";
  if (row?.noTeamDefault !== undefined && row?.noTeamDefault !== null) return "noTeam";
  return "none";
}

/** The fields of a confirmed card `setDefaultSettlesNewRow` reads. */
export type NewRowTeamCard = PreviewCardForTeams;

/**
 * NEO-556 — will the set-level default settle the team of this card when the
 * commit inserts it as a NEW row, so the wizard need not ask?
 *
 *  - A set team: when the card names none the commit could not give it. The
 *    commit gives a teamless new row that team, and a card that resolves a
 *    team of its own has one anyway (NEO-277). A listing value kept as the
 *    "Listed as:" hint is a team the data names, so the set's team is not
 *    stamped over it and the card is asked (invariant 8).
 *  - "No Team": only when the commit will STAMP the card No Team — the
 *    client half of `noTeamCardVerdict` as the commit asks it. Product
 *    invariant 8: a listing that names a team, or a BSC lookup that has not
 *    answered (still to run, or failed), holds the stamp back, and the
 *    operator answers. So settled means the card prints no team string, no
 *    listing value, and either has no BSC ref (nothing to look up) or a
 *    lookup that already ended with no team ("answered", or the publisher
 *    checklist's "checklist").
 *  - Nothing: never.
 *
 * Deliberately one-sided: a card whose only team strings were ruled "not a
 * team" would be stamped by the commit, but is still asked here. Asking about
 * a card the commit would have settled costs a click; settling one it would
 * not would save it teamless with nobody asked.
 */
export function setDefaultSettlesNewRow(
  card: NewRowTeamCard,
  setDefault: SetTeamDefaultKind,
): boolean {
  if (setDefault === "teams") {
    // Invariant 8 (NEO-591): a card the data gives a team to (a listing's
    // team the commit could not resolve into `teams`) never takes the set's
    // team over it: the commit does not stamp it (`bscTeamHint`), so the
    // operator is asked. A card that prints team strings has a team of its
    // own (or a name waiting for review): as before.
    if (cardTeamStrings(card).length > 0) return true;
    return (card.rawTeamName?.trim() ?? "") === "";
  }
  if (setDefault !== "noTeam") return false;
  if (cardTeamStrings(card).length > 0) return false;
  if ((card.rawTeamName?.trim() ?? "") !== "") return false;
  if (!card.platformData?.bsc) return true;
  return card.teamLookup === "answered" || card.teamLookup === "checklist";
}

/**
 * Who and what is on the cards, as the STORED data says it — the half the
 * review rows cannot say. All are facts NB already holds (sets → cards →
 * players, and the set's skip records); nothing here is a stored wizard
 * answer.
 *
 * The review rows only describe names that were UNKNOWN when this sitting
 * opened. A re-sync of a set whose names were settled in an earlier save has
 * none (the teams-only entry has no rows at all), so without these every
 * printed name — including the ones an operator ruled "not a person" — would
 * come back as a player line of its own, and every string ruled "not a team"
 * would pass for a team.
 */
export interface StoredPeople {
  /**
   * Preview positions whose card re-syncs a stored row that the save keeps
   * with NO players (its players are not being replaced by an accepted
   * content change). The save writes nobody onto it, so it is a no-players
   * card whatever it prints.
   */
  playerless?: ReadonlySet<number>;
  /**
   * Player names this set's skip records rule "not a person" (normalized with
   * `normalizeEntityName`, as the records key them). Such a name never reaches
   * the review rows — the gate drops it before asking — so it is nobody here
   * too, exactly like a name skipped in this sitting.
   */
  skippedPlayerNames?: ReadonlySet<string>;
  /**
   * Team names this set's skip records rule "not a team" (normalized the same
   * way). The other half of the same fact, and the same reason: a re-sync
   * carries no review row for them, so without this a skipped string would
   * read as a team that resolved before the wizard opened — the card would
   * look teamed, and the save would go ahead without asking. A skipped name is
   * not a team and not a listing's claim either: the operator answered it.
   * A review row in this sitting still wins over the record.
   */
  skippedTeamNames?: ReadonlySet<string>;
  /**
   * NEO-528 — the row's "Player on every card": preview positions of NEW
   * cards the commit will give that player. Only a card whose listing names
   * nobody gets them (`listingNamesAPlayer`): one that prints a name, even a
   * name ruled "not a person" or still waiting for review, is left blank by
   * the commit (Jason, 2026-11-15; invariant 8), so it is never theirs here
   * either, whatever position the host passed. Such a card is that player's
   * for the teams step, so its team is asked with their career as evidence,
   * never filed under "Cards with no players". By id: the name is only what
   * the line shows.
   */
  defaultPlayer?: DefaultPlayerForNewCards;
  /**
   * NEO-426 — the sport rows flagged "No teams in this sport"
   * (`listTeamlessSportIds`). Read for a player CREATED in this sitting (his
   * review row's `sportId`), a LINKED one or the row's default player
   * (`playerSportIds`).
   */
  teamlessSportIds?: ReadonlySet<string>;
  /**
   * NEO-426 — a linked (or default) player's id → his HOME sport id, from the
   * player rows the wizard already reads for their names. A player not in the
   * map (not loaded yet) is not teamless.
   */
  playerSportIds?: ReadonlyMap<string, string>;
  /**
   * NEO-426 — printed player names that resolved to a known player BEFORE the
   * sitting (no review row) whose home sport is flagged; the fetch says so
   * (`resolveChecklistEntities`' `teamlessPlayerNames`). Normalized like the
   * skip records.
   */
  teamlessPlayerNames?: ReadonlySet<string>;
  /**
   * NEO-426 — preview positions whose card re-syncs a stored row
   * (`existingIndexes`). The sport default never answers them: whether the
   * server stamps such a row turns on its stored lookup bookkeeping, which the
   * wizard cannot see, so they are asked about as before.
   */
  existingPositions?: ReadonlySet<number>;
}

/** NEO-426 — the host's wire shapes for the teamless-sport default (see `StoredPeople`). */
export interface TeamlessFacts {
  teamlessSportIds?: readonly string[];
  /** Linked or default player id → home sport id. */
  playerSportIds?: ReadonlyMap<string, string>;
  /** RAW printed names, as `resolveChecklistEntities` returns them. */
  teamlessPlayerNames?: readonly string[];
  /** Preview positions that re-sync a stored row. */
  existingIndexes?: readonly number[];
}

/** NEO-528 — see `StoredPeople.defaultPlayer`. */
export interface DefaultPlayerForNewCards {
  playerId: Id<"players">;
  name: string;
  /** Preview positions of the NEW cards (never a re-synced stored row). */
  positions: ReadonlySet<number>;
}

/**
 * The host's wire shapes (positions and RAW skipped names) as `StoredPeople`.
 * Undefined when there is nothing to say, so a caller with none passes
 * exactly what it passed before.
 */
export function storedPeople(
  playerlessIndexes?: readonly number[],
  skippedPlayerNames?: readonly string[],
  skippedTeamNames?: readonly string[],
  defaultPlayer?: DefaultPlayerWire,
  teamless?: TeamlessFacts,
): StoredPeople | undefined {
  const playerless =
    playerlessIndexes && playerlessIndexes.length > 0 ? new Set(playerlessIndexes) : undefined;
  const skipped = new Set((skippedPlayerNames ?? []).map(norm).filter(Boolean));
  const skippedTeams = new Set((skippedTeamNames ?? []).map(norm).filter(Boolean));
  const fallback =
    defaultPlayer && defaultPlayer.positions.length > 0 && norm(defaultPlayer.name)
      ? { playerId: defaultPlayer.playerId, name: defaultPlayer.name, positions: new Set(defaultPlayer.positions) }
      : undefined;
  const teamlessSports = new Set(teamless?.teamlessSportIds ?? []);
  const teamlessNames = new Set((teamless?.teamlessPlayerNames ?? []).map(norm).filter(Boolean));
  // Meaningful only beside a flagged sport (or a name the fetch found in
  // one): with none, no player can be teamless, so the rest is dropped
  // rather than carried for nothing.
  const hasTeamless = teamlessSports.size > 0 || teamlessNames.size > 0;
  const playerSports =
    hasTeamless && teamless?.playerSportIds && teamless.playerSportIds.size > 0
      ? teamless.playerSportIds
      : undefined;
  const existing =
    hasTeamless && teamless?.existingIndexes && teamless.existingIndexes.length > 0
      ? new Set(teamless.existingIndexes)
      : undefined;
  if (
    !playerless &&
    skipped.size === 0 &&
    skippedTeams.size === 0 &&
    !fallback &&
    !hasTeamless
  ) {
    return undefined;
  }
  return {
    ...(playerless ? { playerless } : {}),
    ...(skipped.size > 0 ? { skippedPlayerNames: skipped } : {}),
    ...(skippedTeams.size > 0 ? { skippedTeamNames: skippedTeams } : {}),
    ...(fallback ? { defaultPlayer: fallback } : {}),
    ...(teamlessSports.size > 0 ? { teamlessSportIds: teamlessSports } : {}),
    ...(playerSports ? { playerSportIds: playerSports } : {}),
    ...(teamlessNames.size > 0 ? { teamlessPlayerNames: teamlessNames } : {}),
    ...(existing ? { existingPositions: existing } : {}),
  };
}

/**
 * NEO-528 — the preview positions a "Player on every card" default would
 * land on: a card that does not re-sync a stored row (`existingIdByIndex` has
 * no entry for its index) AND whose listing names nobody
 * (`listingNamesAPlayer`; a blank-only list names nobody). Existing rows are
 * never filled, and a new card the listing named someone on is left blank,
 * the same test the commit's insert branch uses, so the wizard cannot plan a
 * player the save leaves off. Positions index into `kept`, not into the
 * diff's card indexes.
 */
export function defaultPlayerPositions(
  kept: ReadonlyArray<{ card: Pick<PreviewCardForTeams, "players">; index: number }>,
  existingIdByIndex: ReadonlyMap<number, unknown>,
): number[] {
  return kept.flatMap(({ card, index }, position) =>
    existingIdByIndex.has(index) || listingNamesAPlayer(card.players) ? [] : [position],
  );
}

/** NEO-528 — `DefaultPlayerForNewCards` as the host passes it (positions as an array). */
export type DefaultPlayerWire = {
  playerId: Id<"players">;
  name: string;
  positions: readonly number[];
};

interface NamesView {
  teamRowByKey: Map<string, TeamsReviewRow>;
  playerRowByKey: Map<string, TeamsReviewRow>;
  playerless: ReadonlySet<number>;
  skippedPlayerNames: ReadonlySet<string>;
  skippedTeamNames: ReadonlySet<string>;
  defaultPlayer?: DefaultPlayerForNewCards;
  teamlessSportIds: ReadonlySet<string>;
  playerSportIds: ReadonlyMap<string, string>;
  teamlessPlayerNames: ReadonlySet<string>;
  existingPositions: ReadonlySet<number>;
}

const NOBODY: ReadonlySet<never> = new Set<never>();
const NO_SPORTS: ReadonlyMap<never, never> = new Map<never, never>();

function namesView(
  rows: readonly TeamsReviewRow[],
  people?: StoredPeople,
): NamesView {
  const teamRowByKey = new Map<string, TeamsReviewRow>();
  const playerRowByKey = new Map<string, TeamsReviewRow>();
  for (const row of rows) {
    const key = norm(row.name);
    if (!key) continue;
    const target =
      row.kind === "team" ? teamRowByKey : row.kind === "player" ? playerRowByKey : null;
    if (target && !target.has(key)) target.set(key, row);
  }
  return {
    teamRowByKey,
    playerRowByKey,
    playerless: people?.playerless ?? NOBODY,
    skippedPlayerNames: people?.skippedPlayerNames ?? NOBODY,
    skippedTeamNames: people?.skippedTeamNames ?? NOBODY,
    ...(people?.defaultPlayer ? { defaultPlayer: people.defaultPlayer } : {}),
    teamlessSportIds: people?.teamlessSportIds ?? NOBODY,
    playerSportIds: people?.playerSportIds ?? NO_SPORTS,
    teamlessPlayerNames: people?.teamlessPlayerNames ?? NOBODY,
    existingPositions: people?.existingPositions ?? NOBODY,
  };
}

/**
 * Was this printed team string ruled "not a team"? By its review row in this
 * sitting, else — with no row — by the set's skip records from an earlier
 * save. A row wins: it is the newer answer.
 */
function teamStringSkipped(raw: string, view: NamesView): boolean {
  const key = norm(raw);
  const row = view.teamRowByKey.get(key);
  if (row) return row.decision?.action === "skip";
  return view.skippedTeamNames.has(key);
}

/**
 * Invariant 8 — the printed team strings on a section card that still claim
 * a team: every one failed to resolve (that is how the card got here), minus
 * the ones the operator ruled "not a team", now or in an earlier save. A skip
 * is an answer to the claim, so it no longer holds the guess back.
 */
function listedClaims(card: PreviewCardForTeams, view: NamesView): string[] {
  const printed = cardTeamStrings(card).filter((raw) => !teamStringSkipped(raw, view));
  // Invariant 8: a card whose listing named a team the card carries no string
  // for (BSC's raw value, its split refused) is a claim too, exactly like a
  // printed string that failed to resolve. Without it nothing holds back a
  // "same player in this set" pre-fill over the team the data names. Only when
  // the card has no team string at all (a raw value beside strings is already
  // said by them, and all of its parts skipped is the operator's ruling), and
  // not a value the operator ruled out.
  const raw = card.rawTeamName?.trim() ?? "";
  const listing =
    raw && cardTeamStrings(card).length === 0 && !teamStringSkipped(raw, view) ? [raw] : [];
  return [...printed, ...listing];
}

/** Will this printed team string resolve to a team at commit? */
function teamStringResolves(raw: string, view: NamesView): boolean {
  const key = norm(raw);
  if (!key) return false;
  const row = view.teamRowByKey.get(key);
  // No row: resolved before the wizard opened — unless an earlier save of
  // this set skipped it, which is why the gate never queued it.
  if (!row) return !view.skippedTeamNames.has(key);
  return row.decision?.action === "create" || row.decision?.action === "link";
}

type CardPlayer = (
  | { kind: "created"; key: string; display: string; row: TeamsReviewRow }
  | { kind: "server"; key: string; display: string; request: EvidenceRequest }
  /** NEO-591 — a player the career step creates: no career on file, and nothing to ask the server. */
  | { kind: "new"; key: string; display: string }
) & {
  /**
   * NEO-426 — this person's HOME sport is flagged teamless, as far as the
   * host's facts say: a created player by his row's sport, a linked or
   * default one by his stored sport, one resolved before the sitting by the
   * fetch's `teamlessPlayerNames`. Unknown = false.
   */
  teamless: boolean;
  /**
   * NEO-426 — that person's HOME sport id when the host's facts say it (a
   * created player's row, a linked or default player's stored sport). A name
   * that resolved before the sitting carries only the fetch's "flagged"
   * verdict, so its sport is not known here.
   */
  sportId?: string;
};

function sportFact(sportId: string | undefined): { sportId?: string } {
  return sportId === undefined ? {} : { sportId };
}

function sportIsTeamless(sportId: string | undefined, view: NamesView): boolean {
  return sportId !== undefined && view.teamlessSportIds.has(sportId);
}

/**
 * The people on a card (at preview position `index`), deduped. A name skipped
 * as "not a person" — in this sitting, or in an earlier save of this set — is
 * nobody, and a re-synced card the save keeps with no players has nobody on
 * it at all (`StoredPeople`).
 */
function cardPlayers(card: PreviewCardForTeams, index: number, view: NamesView): CardPlayer[] {
  if (view.playerless.has(index)) return [];
  const out: CardPlayer[] = [];
  const seen = new Set<string>();
  for (const raw of card.players ?? []) {
    const display = raw.trim();
    const key = norm(display);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    // NEO-574 / NEO-591 — a name the career step pointed at another person is
    // THAT person's, keyed by who they are: a namesake's sibling card (same
    // printed name, still on the first player) is not evidence for it.
    const fresh = card.newPlayerByName?.find((r) => norm(r.name) === key);
    if (fresh) {
      // NEO-426: a person the commit has yet to create has no home sport the
      // host can read, and unknown is never teamless: the card is asked.
      out.push({ kind: "new", key: `new:${fresh.ref}`, display, teamless: false });
      continue;
    }
    const relinked = card.playerIdByName?.find((r) => norm(r.name) === key);
    if (relinked) {
      const playerId = relinked.playerId as Id<"players">;
      out.push({
        kind: "server",
        key: `id:${playerId}`,
        display,
        request: { key: `id:${playerId}`, playerId },
        teamless: sportIsTeamless(view.playerSportIds.get(playerId), view),
        ...sportFact(view.playerSportIds.get(playerId)),
      });
      continue;
    }
    const row = view.playerRowByKey.get(key);
    const action = row?.decision?.action;
    if (row && action === "skip") continue;
    if (!row && view.skippedPlayerNames.has(key)) continue;
    if (row && action === "create") {
      out.push({
        kind: "created",
        key,
        display,
        row,
        teamless: sportIsTeamless(row.sportId, view),
        sportId: row.sportId,
      });
    } else if (row && row.decision?.action === "link" && row.decision.linkedPlayerId) {
      const playerId = row.decision.linkedPlayerId as Id<"players">;
      out.push({
        kind: "server",
        key,
        display,
        request: { key: `id:${playerId}`, playerId },
        teamless: sportIsTeamless(view.playerSportIds.get(playerId), view),
        ...sportFact(view.playerSportIds.get(playerId)),
      });
    } else if (!row) {
      out.push({
        kind: "server",
        key,
        display,
        request: { key: `name:${key}`, name: display },
        teamless: view.teamlessPlayerNames.has(key),
      });
    }
    // A row with no decision cannot reach the Teams step (every row is
    // decided there); a link with no id is malformed. Both are nobody.
  }
  // NEO-528 — a NEW card whose listing names nobody: the commit gives it the
  // row's "Player on every card", so the teams step reads it as theirs. A
  // card that prints any name never takes them, even when every name was
  // ruled out or is still waiting for review: the commit leaves it blank
  // (`listingNamedPlayer`, the same `listingNamesAPlayer` test), so it stays
  // a card with no players here.
  const fallback = view.defaultPlayer;
  if (out.length === 0 && fallback?.positions.has(index) && !listingNamesAPlayer(card.players)) {
    out.push({
      kind: "server",
      key: norm(fallback.name),
      display: fallback.name,
      request: { key: `id:${fallback.playerId}`, playerId: fallback.playerId },
      teamless: sportIsTeamless(view.playerSportIds.get(fallback.playerId), view),
      ...sportFact(view.playerSportIds.get(fallback.playerId)),
    });
  }
  return out;
}

/**
 * The preview positions that will save with no team.
 *
 * `settled` names positions whose card re-syncs an EXISTING row that already
 * carries a team (or an operator's "no team"): the commit keeps a stored
 * row's team, so those cards will not save teamless whatever they print, and
 * asking about them again on every re-sync would be asking an answered
 * question. A card whose checklist said "No Team" is left out for the same
 * reason: the checklist answered it (NEO-489).
 */
export function teamlessCardIndexes(
  cards: readonly PreviewCardForTeams[],
  rows: readonly TeamsReviewRow[],
  settled?: ReadonlySet<number>,
  people?: StoredPeople,
): number[] {
  const view = namesView(rows, people);
  return wouldSaveTeamless(cards, view, settled).filter(
    (index) => !takesNoTeamByDefault(cards[index], index, view),
  );
}

/**
 * NEO-426 — the preview positions that will save with no team AND that the
 * teamless-sport default answers "No team" without asking (see the header's
 * "A teamless sport is a default, never a block"). Disjoint from
 * `teamlessCardIndexes`; the two together are every card that would save with
 * no team (bar the ones the checklist or a set-level team already answered).
 *
 * The commit stamps these itself (the server reads the same facts), so the
 * host sends nothing for them; the Save step only counts them.
 */
export function autoNoTeamIndexes(
  cards: readonly PreviewCardForTeams[],
  rows: readonly TeamsReviewRow[],
  settled?: ReadonlySet<number>,
  people?: StoredPeople,
): number[] {
  const view = namesView(rows, people);
  if (!hasTeamlessFacts(view)) return [];
  return wouldSaveTeamless(cards, view, settled).filter((index) =>
    takesNoTeamByDefault(cards[index], index, view),
  );
}

/**
 * NEO-426 — who the teamless-sport default saves with No Team, for the Save
 * step's note: the people on the cards `autoNoTeamIndexes` counts, by the name
 * the card prints, and their home sports where the facts say them.
 *
 * `cards` is how many cards. `names` are distinct people (case-folded), in
 * card order. `sportIds` are the distinct home sports that are known;
 * `sportUnknown` is true when someone's home sport is not (a name that
 * resolved before the sitting, which the fetch only flags), so the caller
 * never presents a partial list of sports as the whole of it.
 */
export interface AutoNoTeamPeople {
  cards: number;
  names: string[];
  sportIds: string[];
  sportUnknown: boolean;
}

export function autoNoTeamPeople(
  cards: readonly PreviewCardForTeams[],
  rows: readonly TeamsReviewRow[],
  settled?: ReadonlySet<number>,
  people?: StoredPeople,
): AutoNoTeamPeople {
  const view = namesView(rows, people);
  const indexes = autoNoTeamIndexes(cards, rows, settled, people);
  const names = new Map<string, string>();
  const sportIds = new Set<string>();
  let sportUnknown = false;
  for (const index of indexes) {
    for (const player of cardPlayers(cards[index], index, view)) {
      if (!names.has(player.key)) names.set(player.key, player.display);
      if (player.sportId !== undefined) sportIds.add(player.sportId);
      else sportUnknown = true;
    }
  }
  return {
    cards: indexes.length,
    names: [...names.values()],
    sportIds: [...sportIds],
    sportUnknown,
  };
}

/** "A", "A and B", "A, B and C". */
function joinList(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** Most names the Save step's note spells out before "and N more". */
export const AUTO_NO_TEAM_NAMES_SHOWN = 5;

/**
 * The Save step's No Team note (NEO-426): who saves with No Team, and which
 * sport has no teams, in the order an operator checks them.
 *
 *   One card:   "Jane Doe saves with No Team. Pokemon has no teams. Add one
 *                later in the card editor."
 *   Many cards: "7 cards save with No Team (Pokemon has no teams): Jane Doe,
 *                Sam Lee, and 2 more. Add a team later in the card editor."
 *
 * `sportNames` are the sports' names, or empty when they cannot be said whole
 * (a lookup that has not landed, or a person whose sport the data does not
 * give): the sport clause is then left out rather than guessed. Empty string
 * when no card takes the default.
 */
export function autoNoTeamNote(
  facts: Pick<AutoNoTeamPeople, "cards" | "names">,
  sportNames: readonly string[],
): string {
  if (facts.cards <= 0) return "";
  const noTeams = sportNames.length === 1 ? "has" : "have";
  if (facts.cards === 1) {
    const who = joinList(facts.names);
    const verb = facts.names.length > 1 ? "save" : "saves";
    const sport = sportNames.length > 0 ? ` ${joinList(sportNames)} ${noTeams} no teams.` : "";
    return `${who} ${verb} with No Team.${sport} Add one later in the card editor.`;
  }
  const shown = facts.names.slice(0, AUTO_NO_TEAM_NAMES_SHOWN);
  const more = facts.names.length - shown.length;
  const nameList = more > 0 ? `${shown.join(", ")}, and ${more} more` : joinList(shown);
  const sport = sportNames.length > 0 ? ` (${joinList(sportNames)} ${noTeams} no teams)` : "";
  const who = nameList !== "" ? `: ${nameList}` : "";
  return `${facts.cards} cards save with No Team${sport}${who}. Add a team later in the card editor.`;
}

/** Every unsettled position none of whose printed team strings will resolve. */
function wouldSaveTeamless(
  cards: readonly PreviewCardForTeams[],
  view: NamesView,
  settled: ReadonlySet<number> | undefined,
): number[] {
  const out: number[] = [];
  cards.forEach((card, index) => {
    if (settled?.has(index)) return;
    // NEO-489 — the checklist said No Team: answered, never asked.
    if (checklistClaimsNoTeam(card)) return;
    if (!cardTeamStrings(card).some((t) => teamStringResolves(t, view))) out.push(index);
  });
  return out;
}

function hasTeamlessFacts(view: NamesView): boolean {
  return view.teamlessSportIds.size > 0 || view.teamlessPlayerNames.size > 0;
}

/**
 * NEO-426 — does the teamless-sport default answer this would-be-teamless
 * card? A NEW card (a stored row's bookkeeping is the server's to read), at
 * least one person, every one of them teamless, and no data claim standing
 * (invariant 8): the listing names no team the operator has not ruled out,
 * and a BSC card's lookup has already ended with no team.
 */
function takesNoTeamByDefault(card: PreviewCardForTeams, index: number, view: NamesView): boolean {
  if (!hasTeamlessFacts(view)) return false;
  if (view.existingPositions.has(index)) return false;
  if (!lookupHasEnded(card)) return false;
  if (hasListedTeamClaim(card, view)) return false;
  if (hasUnaccountedPlayer(card, index, view)) return false;
  const players = cardPlayers(card, index, view);
  return players.length > 0 && players.every((p) => p.teamless);
}

/**
 * NEO-426 — a card with a BSC ref is stamped only once its team lookup has
 * ended with no team: the server's `awaitingLookup` and `lookupGaveUp` keeps.
 * "answered" and the publisher checklist's "checklist" both end it; a "failed"
 * or absent lookup does not. No BSC ref means nothing to look up.
 * (`setDefaultSettlesNewRow` reads the lookup the same way.)
 */
function lookupHasEnded(card: PreviewCardForTeams): boolean {
  if (!card.platformData?.bsc) return true;
  return card.teamLookup === "answered" || card.teamLookup === "checklist";
}

/**
 * NEO-426 — does the listing still claim a team for this card? Mirrors the
 * commit's `commitTeamHint(rawTeamName, teamStrings, skipped) !== undefined`
 * exactly, so the client never leaves out a card the server will not stamp:
 * BSC's raw value counts unless the operator ruled it "not a team"; when some
 * printed strings were ruled out, only the remaining ones count.
 */
function hasListedTeamClaim(card: PreviewCardForTeams, view: NamesView): boolean {
  const raw = card.rawTeamName?.trim() ?? "";
  if (raw && teamStringSkipped(raw, view)) return false;
  const parts = cardTeamStrings(card);
  const live = parts.filter((p) => !teamStringSkipped(p, view));
  if (live.length < parts.length) return live.length > 0;
  return raw.length > 0 || live.length > 0;
}

/**
 * NEO-426 — a printed name on the card that is neither a known person nor
 * ruled "not a person": a review row still undecided, or a link with no
 * player. The commit counts such a name against the default (a pending player
 * name), so the client does too (`cardPlayers` drops it as nobody, which here
 * would overclaim). A name with no row resolved before the sitting; whether
 * he is teamless is `teamlessPlayerNames`' answer.
 */
function hasUnaccountedPlayer(card: PreviewCardForTeams, index: number, view: NamesView): boolean {
  if (view.playerless.has(index)) return false;
  for (const raw of card.players ?? []) {
    const key = norm(raw);
    if (!key) continue;
    const row = view.playerRowByKey.get(key);
    if (!row) continue;
    const decision = row.decision;
    if (!decision) return true;
    if (decision.action === "link" && !decision.linkedPlayerId) return true;
  }
  return false;
}

/**
 * Every player the server should be asked about, across every teamless card,
 * deduped by request key, in first-seen order.
 */
export function evidenceRequests(
  cards: readonly PreviewCardForTeams[],
  rows: readonly TeamsReviewRow[],
  settled?: ReadonlySet<number>,
  people?: StoredPeople,
): EvidenceRequest[] {
  const view = namesView(rows, people);
  const out = new Map<string, EvidenceRequest>();
  for (const index of teamlessCardIndexes(cards, rows, settled, people)) {
    for (const player of cardPlayers(cards[index], index, view)) {
      if (player.kind === "server" && !out.has(player.request.key)) {
        out.set(player.request.key, player.request);
      }
    }
  }
  return [...out.values()];
}

/** A created player's career, minus what the operator unchecked, plus what they typed. */
function createdStints(row: TeamsReviewRow): CareerStint[] {
  const decision = row.decision?.action === "create" ? row.decision : undefined;
  const excluded = new Set((decision?.excludedCareerTeamNames ?? []).map(norm));
  return [
    ...(row.enrichment?.careerTeams ?? []).filter((s) => !excluded.has(norm(s.name))),
    ...(decision?.manualCareerTeams ?? []),
  ];
}

/**
 * NEO-569 — a created player's UNDATED career teams: the Wikidata names with
 * no years, minus what the operator unchecked and minus any name already on
 * the dated list (dating a lead moves it there). They reach the career rule as
 * undated stints, which counts one only when it is the player's one team in
 * the set's leagues (`careerTeamVerdict`) — the client mirror of the server's
 * rule for a stored player's undated `teamYears`. A lead still creates nothing
 * on the player.
 */
function createdUndatedNames(row: TeamsReviewRow, dated: readonly CareerStint[]): string[] {
  const decision = row.decision?.action === "create" ? row.decision : undefined;
  const skip = new Set([
    ...(decision?.excludedCareerTeamNames ?? []).map(norm),
    ...dated.map((s) => norm(s.name)),
  ]);
  const out: string[] = [];
  for (const name of row.enrichment?.undatedCareerTeams ?? []) {
    const key = norm(name);
    if (!key || skip.has(key)) continue;
    skip.add(key);
    out.push(name);
  }
  return out;
}

/**
 * Every team NAME the server should resolve to existing NB teams, deduped by
 * normalized name, in first-seen order:
 *  - a listing's printed team on a card in the section (invariant 8: its NB
 *    matches are offered as choices, never pre-filled);
 *  - a created player's career team that has no review row of its own, i.e.
 *    one that names a team NB already holds — so it can be ranked (C2b).
 */
export function teamNameRequests(
  cards: readonly PreviewCardForTeams[],
  rows: readonly TeamsReviewRow[],
  settled?: ReadonlySet<number>,
  people?: StoredPeople,
): TeamNameRequest[] {
  const view = namesView(rows, people);
  const out = new Map<string, TeamNameRequest>();
  const add = (raw: string, location = false) => {
    const key = norm(raw);
    if (!key) return;
    const have = out.get(key);
    if (!have) out.set(key, { key, name: raw.trim(), ...(location ? { location: true as const } : {}) });
    else if (location && !have.location) have.location = true;
  };
  for (const index of teamlessCardIndexes(cards, rows, settled, people)) {
    const card = cards[index];
    // Every listed name also asks for the teams LOCATED there (collector
    // review): a held X is a place, and so is most of an Onyx checklist.
    for (const listed of listedClaims(card, view)) add(listed, true);
    for (const player of cardPlayers(card, index, view)) {
      if (player.kind !== "created") continue;
      const dated = createdStints(player.row);
      for (const stint of dated) {
        if (!view.teamRowByKey.has(norm(stint.name))) add(stint.name);
      }
      for (const name of createdUndatedNames(player.row, dated)) {
        if (!view.teamRowByKey.has(norm(name))) add(name);
      }
    }
  }
  return [...out.values()];
}

/** A printed or career team STRING as a chip: staged teams show their composed name. */
function refFromString(
  raw: string,
  view: NamesView,
  linkedTeamNameById: ReadonlyMap<string, string>,
): TeamRef | null {
  const key = norm(raw);
  if (!key) return null;
  const row = view.teamRowByKey.get(key);
  if (!row) return { key: `name:${key}`, label: raw.trim(), name: raw.trim() };
  const decision = row.decision;
  if (decision?.action === "create") {
    return {
      key: `name:${key}`,
      label: decision.create ? teamFullName(decision.create) : row.name,
      ...(row.enrichment?.colors ? { colors: row.enrichment.colors } : {}),
      // The review row's own name: the key the commit's decision map is
      // built on, whatever the operator composed the team as.
      name: row.name,
    };
  }
  if (decision?.action === "link") {
    return {
      key: `name:${key}`,
      label:
        (decision.linkedTeamId && linkedTeamNameById.get(decision.linkedTeamId)) || row.name,
      name: row.name,
    };
  }
  return null; // skipped, or undecided: not a team
}

function refFromServer(team: ServerTeam): TeamRef {
  return {
    key: teamIdKey(team.teamId),
    label: team.name,
    ...(team.colors ? { colors: team.colors } : {}),
    teamId: team.teamId,
    ...(team.rank !== undefined ? { rank: team.rank } : {}),
  };
}

function dedupeRefs(refs: TeamRef[]): TeamRef[] {
  const seen = new Set<string>();
  return refs.filter((r) => (seen.has(r.key) ? false : (seen.add(r.key), true)));
}

/** Stable: preference rank first, the evidence's own order within a rank. */
function byRank(refs: TeamRef[]): TeamRef[] {
  return refs
    .map((ref, i) => ({ ref, i }))
    .sort((a, b) => (a.ref.rank ?? UNRANKED) - (b.ref.rank ?? UNRANKED) || a.i - b.i)
    .map(({ ref }) => ref);
}

type PlayerVerdict = { answer: TeamRef[] | null; candidates: TeamRef[]; loading: boolean };

interface RankContext {
  view: NamesView;
  /** By normalized name; absent map = names are not being resolved (nothing pending). */
  teamNameEvidence: ReadonlyMap<string, ServerTeam[]> | undefined;
  /** NEO-569 — the set's effective leagues, any-of; empty = none. */
  setLeagueIds: readonly string[];
}

/**
 * A career STRING's preference rank, and whether it is still waiting on the
 * server. A team staged in this wizard is in the set's league when the
 * operator filed it there; an existing team is ranked by the server
 * (`teamNames`). Anything unknown is "other".
 */
function stringRank(raw: string, ctx: RankContext): { rank: TeamPreferenceRank; pending: boolean } {
  const key = norm(raw);
  const row = ctx.view.teamRowByKey.get(key);
  if (row) {
    const leagueId = row.decision?.action === "create" ? row.decision.create?.leagueId : undefined;
    return {
      rank: leagueId && ctx.setLeagueIds.includes(leagueId) ? 0 : UNRANKED,
      pending: false,
    };
  }
  if (!ctx.teamNameEvidence) return { rank: UNRANKED, pending: false };
  const evidence = ctx.teamNameEvidence.get(key);
  if (!evidence) return { rank: UNRANKED, pending: true };
  const best = Math.min(UNRANKED, ...evidence.map((t) => t.rank ?? UNRANKED));
  return { rank: best as TeamPreferenceRank, pending: false };
}

/** A created player's own career, through the shared window rule. */
function createdPlayerVerdict(
  row: TeamsReviewRow,
  linkedTeamNameById: ReadonlyMap<string, string>,
  setYear: number | undefined,
  currentYear: number,
  ctx: RankContext,
): PlayerVerdict {
  const refByKey = new Map<string, TeamRef>();
  const stints: Array<{ key: string; fromYear?: number; toYear?: number }> = [];
  let loading = false;
  const refFor = (name: string): TeamRef | null => {
    const ref = refFromString(name, ctx.view, linkedTeamNameById);
    if (!ref) return null;
    if (!refByKey.has(ref.key)) {
      const { rank, pending } = stringRank(name, ctx);
      if (pending) loading = true;
      refByKey.set(ref.key, rank === UNRANKED ? ref : { ...ref, rank });
    }
    return ref;
  };
  const dated = createdStints(row);
  for (const stint of dated) {
    const ref = refFor(stint.name);
    if (!ref) continue;
    stints.push({
      key: ref.key,
      fromYear: stint.fromYear,
      ...(stint.toYear !== undefined ? { toYear: stint.toYear } : {}),
    });
  }
  // NEO-569 — undated leads go to the career rule as undated stints.
  for (const name of createdUndatedNames(row, dated)) {
    const ref = refFor(name);
    if (ref) stints.push({ key: ref.key });
  }
  // A rank still on its way could change a tie-break: hold the line until
  // it lands rather than pre-fill and then move the pick under the cursor.
  if (loading) return { answer: null, candidates: [], loading: true };
  const verdict = careerTeamVerdict({
    stints,
    year: setYear,
    currentYear,
    rankOf: (key) => (refByKey.get(key)?.rank ?? UNRANKED) as TeamPreferenceRank,
    setHasLeagues: ctx.setLeagueIds.length > 0,
  });
  return {
    answer: verdict.answer ? [refByKey.get(verdict.answer.key)!] : null,
    candidates: verdict.candidates.map((key) => refByKey.get(key)!),
    loading: false,
  };
}

function serverPlayerVerdict(evidence: ServerPlayerEvidence | undefined): PlayerVerdict {
  if (!evidence) return { answer: null, candidates: [], loading: true };
  return {
    answer: evidence.answer ? evidence.answer.teams.map(refFromServer) : null,
    candidates: evidence.candidates.map(refFromServer),
    loading: false,
  };
}

/**
 * Group the teamless cards by player set (and listing claim) and decide each
 * group's evidence. Groups come back in the order of their first card.
 */
export function buildTeamsGroups(input: {
  cards: readonly PreviewCardForTeams[];
  rows: readonly TeamsReviewRow[];
  /** Server evidence by `EvidenceRequest.key`; absent = not arrived yet. */
  serverEvidence: ReadonlyMap<string, ServerPlayerEvidence>;
  setYear: number | undefined;
  /** Linked team id → its full name, for a link decision's chip. */
  linkedTeamNameById: ReadonlyMap<string, string>;
  currentYear: number;
  /** Positions whose stored row already has a team — see `teamlessCardIndexes`. */
  settled?: ReadonlySet<number>;
  /**
   * `TeamNameRequest.key` → the existing NB teams that name resolves to;
   * a key absent from the map = not arrived yet. Omit the whole map and
   * names are not resolved at all (nothing waits on them).
   */
  teamNameEvidence?: ReadonlyMap<string, ServerTeam[]>;
  /**
   * NEO-569 — the set's effective leagues (C2b, any-of), for a team staged
   * in this wizard and for the undated-stint rule's scope.
   */
  setLeagueIds?: readonly string[];
  /** Who the stored data says is on the cards — see `StoredPeople`. */
  people?: StoredPeople;
}): TeamsGroup[] {
  const { cards, rows, serverEvidence, setYear, linkedTeamNameById, currentYear, settled } =
    input;
  const view = namesView(rows, input.people);
  const rankCtx: RankContext = {
    view,
    teamNameEvidence: input.teamNameEvidence,
    setLeagueIds: input.setLeagueIds ?? [],
  };
  const members = new Set(teamlessCardIndexes(cards, rows, settled, input.people));

  // Batch evidence: per player set, the distinct resolving team sets printed
  // on the cards that are NOT in the section.
  const playerSetKey = (players: CardPlayer[]) => players.map((p) => p.key).sort().join("|");
  const batchSets = new Map<string, Map<string, TeamRef[]>>();
  cards.forEach((card, index) => {
    if (members.has(index)) return;
    const players = cardPlayers(card, index, view);
    if (players.length === 0) return;
    const refs = dedupeRefs(
      cardTeamStrings(card)
        .filter((t) => teamStringResolves(t, view))
        .map((t) => refFromString(t, view, linkedTeamNameById))
        .filter((r): r is TeamRef => r !== null),
    );
    if (refs.length === 0) return;
    const pKey = playerSetKey(players);
    const sets = batchSets.get(pKey) ?? new Map<string, TeamRef[]>();
    const setKey = refs.map((r) => r.key).sort().join("+");
    if (!sets.has(setKey)) sets.set(setKey, refs);
    batchSets.set(pKey, sets);
  });

  const groups = new Map<string, TeamsGroup>();
  for (const index of [...members].sort((a, b) => a - b)) {
    const card = cards[index];
    const players = cardPlayers(card, index, view);
    // A printed string on a member card failed to resolve — that is how it
    // got here — so unless the operator ruled it "not a team", it is a
    // listing's team claim (invariant 8).
    const listedNames = listedClaims(card, view);
    const lookupFailed = card.teamLookup === "failed";
    // NEO-478 — a team the operator's published checklist settled is a data
    // claim exactly like a failed lookup's: the card's team is the one its
    // checklist row named, so no inference may fill another over it. A row
    // whose team cell is blank makes no claim and never sets "checklist"
    // (B1); one that says "No Team" never reaches this loop (NEO-489,
    // `teamlessCardIndexes`).
    const checklistClaim = card.teamLookup === "checklist";
    const claimKey =
      (listedNames.length > 0 ? `|listed:${listedNames.map(norm).sort().join("|")}` : "") +
      (lookupFailed ? "|lookup-failed" : "") +
      (checklistClaim ? "|checklist" : "");
    // No people → no player evidence at all, so every such card (a
    // checklist, a league leaders card, a highlight) shares ONE line, keyed
    // on having no players — never on a card's name. Its listing claims are
    // pooled: nothing on it is pre-filled anyway, and each card can still
    // take its own answer (C3).
    const groupKey =
      players.length > 0
        ? `players:${playerSetKey(players)}${claimKey}`
        : NO_PLAYERS_GROUP_KEY;
    const existing = groups.get(groupKey);
    const entry = { index, cardNumber: card.cardNumber, cardName: card.cardName };
    if (existing) {
      existing.cards.push(entry);
      if (groupKey === NO_PLAYERS_GROUP_KEY) {
        existing.lookupFailed ||= lookupFailed;
        if (checklistClaim) existing.checklistClaim = true;
        for (const name of listedNames) {
          if (existing.listedNames.some((n) => norm(n) === norm(name))) continue;
          existing.listedNames.push(name);
          const found = input.teamNameEvidence?.get(norm(name));
          if (input.teamNameEvidence && !found) existing.loading = true;
          existing.refs = dedupeRefs([
            ...existing.refs,
            ...(found ?? []).map(refFromServer),
          ]).slice(0, TEAMS_SECTION_MAX_OPTIONS);
        }
      }
      continue;
    }

    let suggestion: TeamRef[] | null = null;
    let choices: TeamRef[] = [];
    let loading = false;

    const batch = players.length > 0 ? batchSets.get(playerSetKey(players)) : undefined;
    if (batch && batch.size === 1) {
      suggestion = [...batch.values()][0];
    } else if (batch && batch.size > 1) {
      // The checklist disagrees with itself: the operator picks.
      choices = [...batch.values()].flat();
    } else if (players.length > 0) {
      const verdicts = players.map((p) =>
        p.kind === "created"
          ? createdPlayerVerdict(p.row, linkedTeamNameById, setYear, currentYear, rankCtx)
          : p.kind === "new"
            ? // A new player has no career yet: no evidence, nothing loading.
              { answer: null, candidates: [], loading: false }
            : serverPlayerVerdict(serverEvidence.get(p.request.key)),
      );
      loading = verdicts.some((v) => v.loading);
      const union = dedupeRefs(verdicts.flatMap((v) => v.answer ?? []));
      if (verdicts.every((v) => v.answer !== null) && union.length <= MAX_CARD_TEAMS) {
        suggestion = union;
        // A tie-break never hides the teams it ranked below.
        choices = verdicts.flatMap((v) => v.candidates);
      } else {
        choices = verdicts.flatMap((v) => [...(v.answer ?? []), ...v.candidates]);
      }
    }

    // Invariant 8: the listing's own teams, as NB holds them, first.
    const listedRefs: TeamRef[] = [];
    if (input.teamNameEvidence) {
      for (const name of listedNames) {
        const found = input.teamNameEvidence.get(norm(name));
        if (!found) loading = true;
        else listedRefs.push(...found.map(refFromServer));
      }
    }
    if (listedNames.length > 0 || lookupFailed || checklistClaim) {
      // A data claim holds the guess back: nothing is pre-selected, and the
      // would-be pre-fill becomes one more choice.
      choices = [...(suggestion ?? []), ...choices];
      suggestion = null;
    }

    const lead = suggestion ?? [];
    const refs = dedupeRefs([...lead, ...listedRefs, ...byRank(choices)])
      .slice(0, Math.max(TEAMS_SECTION_MAX_OPTIONS, lead.length));

    groups.set(groupKey, {
      key: groupKey,
      players: players.map((p) => p.display),
      cards: [entry],
      multi: players.length > 1 || lead.length > 1,
      refs,
      suggestion: suggestion && suggestion.length > 0 ? suggestion.map((r) => r.key) : null,
      listedNames: [...listedNames],
      lookupFailed,
      ...(checklistClaim ? { checklistClaim: true } : {}),
      loading,
    });
  }
  return [...groups.values()];
}

/** The pre-fill when there is one, else "Leave for later". */
export function defaultChoice(group: TeamsGroup): GroupChoice {
  return group.suggestion ? { kind: "teams", refKeys: [...group.suggestion] } : { kind: "later" };
}

function extraOf(choice: GroupChoice | undefined): Array<Id<"teams">> | undefined {
  return choice && choice.kind !== "line" ? choice.extra : undefined;
}

function withExtra<T extends GroupChoice>(choice: T, extra: Array<Id<"teams">> | undefined): T {
  if (choice.kind === "line" || !extra || extra.length === 0) return choice;
  return { ...choice, extra };
}

/** The keys a line can select: its own chips plus the teams found with "Other team…". */
function offeredKeys(group: TeamsGroup, extra: ReadonlyArray<Id<"teams">> | undefined): Set<string> {
  return new Set([...group.refs.map((r) => r.key), ...(extra ?? []).map(teamIdKey)]);
}

/**
 * What the line shows as chosen: the operator's own pick while it still names
 * chips the line offers, else the default. `{ kind: "line" }` is the default
 * too — it only means something on a card's own key.
 */
export function effectiveChoice(group: TeamsGroup, explicit: GroupChoice | undefined): GroupChoice {
  if (!explicit || explicit.kind === "line") return defaultChoice(group);
  if (explicit.kind !== "teams") return explicit;
  const offered = offeredKeys(group, explicit.extra);
  const keys = [...new Set(explicit.refKeys)].filter((k) => offered.has(k));
  const capped = keys.slice(0, group.multi ? MAX_CARD_TEAMS : 1);
  if (capped.length === 0) return withExtra(defaultChoice(group), explicit.extra);
  return withExtra({ kind: "teams", refKeys: capped }, explicit.extra);
}

/** One card's choice: its own (C3) when it has one, else its line's. */
export function effectiveCardChoice(
  group: TeamsGroup,
  choices: Readonly<Record<string, GroupChoice>>,
  index: number,
): GroupChoice {
  const own = choices[cardChoiceKey(group.key, index)];
  if (own && own.kind !== "line") return effectiveChoice(group, own);
  return effectiveChoice(group, choices[group.key]);
}

/** Does this card carry its own answer, apart from its line? */
export function hasCardOverride(
  group: TeamsGroup,
  choices: Readonly<Record<string, GroupChoice>>,
  index: number,
): boolean {
  const own = choices[cardChoiceKey(group.key, index)];
  return own !== undefined && own.kind !== "line";
}

/**
 * The choice after pressing a team chip. One-pick lines replace; multi lines
 * toggle, and refuse a team past `MAX_CARD_TEAMS` (the choice comes back
 * unchanged). Unticking the last team leaves the line for later.
 */
export function toggleTeam(group: TeamsGroup, current: GroupChoice, refKey: string): GroupChoice {
  const extra = extraOf(current);
  if (!group.multi) return withExtra({ kind: "teams", refKeys: [refKey] }, extra);
  const keys = current.kind === "teams" ? current.refKeys : [];
  if (keys.includes(refKey)) {
    const rest = keys.filter((k) => k !== refKey);
    return rest.length > 0
      ? withExtra({ kind: "teams", refKeys: rest }, extra)
      : withExtra({ kind: "later" }, extra);
  }
  if (keys.length >= MAX_CARD_TEAMS) return current;
  return withExtra({ kind: "teams", refKeys: [...keys, refKey] }, extra);
}

/** "No team on this card" / "Leave for later", keeping any team found with "Other team…". */
export function chooseKind(current: GroupChoice, kind: "none" | "later"): GroupChoice {
  return withExtra({ kind }, extraOf(current));
}

/**
 * A team the operator found (or created) with "Other team…" (C1): offered on
 * the line from now on, and selected — added to a multi line's picks (unless
 * that would pass the cap, when it is only offered), the pick on a one-team
 * line. A team the line already offers is simply selected.
 */
export function addOtherTeam(
  group: TeamsGroup,
  current: GroupChoice,
  teamId: Id<"teams">,
): GroupChoice {
  const key = teamIdKey(teamId);
  const before = extraOf(current) ?? [];
  const extra =
    group.refs.some((r) => r.key === key) || before.includes(teamId) ? before : [...before, teamId];
  const extraOrNone = extra.length > 0 ? extra : undefined;
  if (!group.multi) return withExtra({ kind: "teams", refKeys: [key] }, extraOrNone);
  const keys = current.kind === "teams" ? current.refKeys : [];
  if (keys.includes(key)) return withExtra({ kind: "teams", refKeys: keys }, extraOrNone);
  if (keys.length >= MAX_CARD_TEAMS) {
    return current.kind === "line" ? current : withExtra(current, extraOrNone);
  }
  return withExtra({ kind: "teams", refKeys: [...keys, key] }, extraOrNone);
}

/**
 * A choice as the commit reads it; undefined for "Leave for later".
 * `blockedTeamIds` are "Other team…" picks that cannot be saved (another
 * sport's team — the commit would refuse the whole save).
 */
export function answerForChoice(
  group: TeamsGroup,
  choice: GroupChoice,
  blockedTeamIds?: ReadonlySet<string>,
): TeamAnswer | undefined {
  if (choice.kind === "none") return { teamNone: true };
  if (choice.kind !== "teams") return undefined;
  const teamIds: Array<Id<"teams">> = [];
  const teams: string[] = [];
  const extra = new Set<string>(choice.extra ?? []);
  for (const key of choice.refKeys) {
    const ref = group.refs.find((r) => r.key === key);
    if (ref) {
      if (ref.teamId) teamIds.push(ref.teamId);
      if (ref.name !== undefined) teams.push(ref.name);
      continue;
    }
    const id = key.startsWith("id:") ? key.slice(3) : null;
    if (id && extra.has(id) && !blockedTeamIds?.has(id)) teamIds.push(id as Id<"teams">);
  }
  if (teamIds.length === 0 && teams.length === 0) return undefined;
  const ids = [...new Set(teamIds)];
  return {
    ...(ids.length > 0 ? { teamIds: ids } : {}),
    ...(teams.length > 0 ? { teams: [...new Set(teams)] } : {}),
  };
}

/**
 * Every card's answer, positionally aligned with the preview's cards.
 * Cards outside the section, and cards left for later, are undefined.
 */
export function teamAnswersByCard(
  groups: readonly TeamsGroup[],
  choices: Readonly<Record<string, GroupChoice>>,
  cardCount: number,
  blockedTeamIds?: ReadonlySet<string>,
): Array<TeamAnswer | undefined> {
  const out: Array<TeamAnswer | undefined> = new Array(cardCount).fill(undefined);
  for (const group of groups) {
    for (const card of group.cards) {
      if (card.index >= cardCount) continue;
      out[card.index] = answerForChoice(
        group,
        effectiveCardChoice(group, choices, card.index),
        blockedTeamIds,
      );
    }
  }
  return out;
}

/**
 * The card numbers a grouped line covers, for the line itself: up to four
 * in full ("#5 · #407"), past that the first three and a count
 * ("#5, #407, #512 +3"). Display only — a number is never a key here.
 */
export function cardNumbersSummary(cards: ReadonlyArray<{ cardNumber: string }>): string {
  const numbers = cards.map((c) => `#${c.cardNumber}`);
  if (numbers.length <= 4) return numbers.join(" · ");
  return `${numbers.slice(0, 3).join(", ")} +${numbers.length - 3}`;
}

/** Every team id found with "Other team…" across the section (for one label read). */
export function extraTeamIds(choices: Readonly<Record<string, GroupChoice>>): Array<Id<"teams">> {
  const out = new Set<Id<"teams">>();
  for (const choice of Object.values(choices)) {
    for (const id of extraOf(choice) ?? []) out.add(id);
  }
  return [...out];
}

/** Two answer arrays say the same thing (so the parent is not re-rendered for nothing). */
export function sameTeamAnswers(
  a: ReadonlyArray<TeamAnswer | undefined>,
  b: ReadonlyArray<TeamAnswer | undefined>,
): boolean {
  if (a.length !== b.length) return false;
  return a.every((x, i) => JSON.stringify(x ?? null) === JSON.stringify(b[i] ?? null));
}

/**
 * A preview card with its answer put on it, as the commit receives it. A card
 * with no answer comes back as the same object, so the unanswered path's wire
 * payload is byte-identical to what it was before this feature existed.
 *
 * `teams` REPLACES the card's printed team strings: every one of them failed
 * to resolve (that is how the card got into the section), and the commit
 * resolves the replacement exactly as it resolves any printed team.
 *
 * `teamsAnswered` marks that replacement as the OPERATOR's answer rather than
 * what the card printed. The commit needs to know: a printed team string on
 * a re-synced, already-stored row is marketplace content and is written only
 * through the content review (`applyFields`), while an answered one fills
 * that row's empty team the way a picked `teamIds` does.
 */
export function withTeamAnswer<T extends PreviewCardForTeams>(
  card: T,
  answer: TeamAnswer | undefined,
): T & TeamAnswer & { teamsAnswered?: true } {
  if (!answer) return card;
  return {
    ...card,
    ...(answer.teamIds?.length ? { teamIds: answer.teamIds } : {}),
    ...(answer.teams?.length ? { teams: answer.teams, teamsAnswered: true as const } : {}),
    ...(answer.teamNone ? { teamNone: true as const } : {}),
  };
}
