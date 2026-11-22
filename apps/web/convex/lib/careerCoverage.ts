/**
 * NEO-574 — does a player's career cover the team a card shows, as of the
 * card's year? The ONE rule, shared by the commit prelude's rule 6b, the
 * review wizard's "career check" step and the coverage queries that feed it.
 *
 * Pure and browser-safe: no `_generated` import, no `ctx`. The wizard imports
 * it (to pick which cards to check) and the Convex side imports it (to decide
 * what a stint covers). It lives under `convex/lib/` so it sits beside the
 * server code that reads it; the only import is the shared name normaliser.
 *
 * ## The rule
 *
 * A stint COUNTS toward a card of year Y when it is undated, or it started in
 * or before Y (`fromYear <= Y`). A stint that began after the card was
 * printed says nothing about the card: a card can show a team's past, never a
 * team the player had not reached yet. There is no tolerance, deliberately
 * (Jason, 2026-11-16: strict year; a prospect whose first stint with the club
 * starts after the card is flagged, and the operator adds the stint).
 *
 * A counting stint COVERS the card's team when its team and the card's team
 * share a KEY. Keys, not rows, because the card side is often only a printed
 * string:
 *
 *   `t:<teamId>`       the exact team row
 *   `f:<franchiseId>`  the operator-curated franchise thread the row sits on
 *   `n:<nameKey>`      the token-sorted name key `teams` dedupes on, for the
 *                      composed full name and the bare nickname (and, on the
 *                      card side, the printed text)
 *
 * An EMPTY career covers nothing. That is the point of the check: a player
 * with no stints at all has no team to be on, and the operator is asked.
 * (Rule 6b keeps its own guard that every candidate has a career on file;
 * that guard is about "unknown is not absent" for RIVALS and is unchanged.)
 */
import { entityNameCompareKey, foldNameForCompare } from "../../lib/entities/normalize-name";

/** The most pairs one coverage read answers; more is refused, never cut. */
export const CAREER_COVERAGE_MAX_PAIRS = 32;

/** Key for a team row. */
export function teamIdKey(teamId: string): string {
  return `t:${teamId}`;
}

/** Key for a franchise thread. */
export function franchiseIdKey(franchiseId: string): string {
  return `f:${franchiseId}`;
}

/**
 * Key for a team NAME. `raw` is a printed string, a composed full name or a
 * nickname; the normaliser is the one every `teams` lookup uses. Returns null
 * for text that normalises to nothing so a caller never adds an empty key.
 */
export function teamNameKey(raw: string): string | null {
  const norm = entityNameCompareKey(raw);
  return norm.length > 0 ? `n:${norm}` : null;
}

/**
 * Every key a team ROW answers to: its id, its franchise, its composed full
 * name and its bare nickname. These are the same two name keys rule 6b has
 * always matched a printed team against (`teamFullName(team)` and
 * `team.name`), plus the id and the franchise.
 */
export function teamRowKeys(team: {
  id: string;
  franchiseId?: string | null;
  fullName: string;
  name: string;
}): string[] {
  const keys = new Set<string>([teamIdKey(team.id)]);
  if (team.franchiseId) keys.add(franchiseIdKey(team.franchiseId));
  for (const raw of [team.fullName, team.name]) {
    const key = teamNameKey(raw);
    if (key) keys.add(key);
  }
  return Array.from(keys);
}

/**
 * The keys the CARD side of a match carries when the card's team is a known
 * row: its id, its franchise and its composed full name. NOT the nickname:
 * "Tigers" would match every other Tigers club on file, and a known row has
 * an id to say which one it means. (A team that is only printed text carries
 * `teamNameKey(printed)` instead, which may be a bare nickname.)
 */
export function teamRowCardKeys(team: {
  id: string;
  franchiseId?: string | null;
  fullName: string;
}): string[] {
  const keys = new Set<string>([teamIdKey(team.id)]);
  if (team.franchiseId) keys.add(franchiseIdKey(team.franchiseId));
  const full = teamNameKey(team.fullName);
  if (full) keys.add(full);
  return Array.from(keys);
}

/** A stint with the team's keys already resolved. */
export type CoverageStint = {
  /** `teamRowKeys` of the stint's team; empty when the team row is gone. */
  keys: readonly string[];
  fromYear?: number;
  toYear?: number;
};

/**
 * Does this stint count toward a card of `cardYear`? Undated always does (it
 * is a fact about the career, not about a season); a dated one when it began
 * in or before the card's year. The end year is irrelevant: a player who left
 * the club before the card was printed is still a former player of it.
 */
export function stintCountsForYear(
  stint: { fromYear?: number },
  cardYear: number,
): boolean {
  return stint.fromYear === undefined || stint.fromYear <= cardYear;
}

/**
 * Does any COUNTING stint's team share a key with the card's team? An empty
 * list of stints, or an empty key set, covers nothing.
 */
export function careerCoversCardTeam(
  stints: readonly CoverageStint[],
  cardTeamKeys: ReadonlySet<string> | readonly string[],
  cardYear: number,
): boolean {
  const wanted =
    cardTeamKeys instanceof Set ? cardTeamKeys : new Set<string>(cardTeamKeys);
  if (wanted.size === 0) return false;
  for (const stint of stints) {
    if (!stintCountsForYear(stint, cardYear)) continue;
    for (const key of stint.keys) {
      if (wanted.has(key)) return true;
    }
  }
  return false;
}

// ── Which cards are checked, and as which (player, team) pairs ─────────────

/** The fields of a card the pair derivation reads. */
export type CareerCheckCard = {
  cardNumber: string;
  players?: readonly string[];
  teams?: readonly string[];
  team?: string;
  /** NB teams already chosen for the card (a re-team answer, a picked team). */
  teamIds?: readonly string[];
};

/** A (player, team) the career check asks about, once, for all its cards. */
export type CareerPair = {
  playerId: string;
  /** The player's name as the first checked card printed it. */
  printedPlayer: string;
  /** The NB team row, when the team is one. */
  teamId?: string;
  /**
   * The team's text: the printed string for a team resolved by name, or the
   * name staged for a team this batch creates (no `teamId` yet).
   */
  teamName?: string;
  /** Positions in the `cards` array handed to `deriveCareerPairs`. */
  cardIndexes: number[];
  cardNumbers: string[];
};

/** What `deriveCareerPairs` needs to know about the wizard's state. */
export type DeriveCareerPairsInput = {
  cards: readonly CareerCheckCard[];
  /** Positions of cards that already exist as rows: the save will not create them. */
  existingIndexes?: ReadonlySet<number>;
  /** The set's year; with none there is nothing to compare against. */
  setYear: number | undefined;
  /**
   * The EXISTING NB player a printed name resolved to, or undefined. A name
   * the wizard is creating, or one that did not resolve, is undefined: only
   * existing players are checked.
   */
  playerIdFor: (printed: string) => string | undefined;
  /**
   * The team a printed string resolved to: its `teamId` when it is an NB row,
   * or just `teamName` for a team this batch creates. Undefined when the text
   * resolves to nothing (skipped, left to the Teams step).
   */
  teamFor: (printed: string) => { teamId?: string; teamName?: string } | undefined;
};

/** The shared name fold plus collapsed whitespace: the dedupe key for team TEXT with no id. */
function foldText(raw: string): string {
  return foldNameForCompare(raw).trim().replace(/\s+/g, " ");
}

/**
 * The (player, team) pairs the career check lists, in the order the cards
 * first produce them.
 *
 * A card is checked only when ALL of these hold (plan decision 3):
 *  - the save will create it (its position is not in `existingIndexes`);
 *  - the set has a year;
 *  - it carries exactly ONE player (multi-player cards are never checked:
 *    nobody can say which of the players the team belongs to), and that name
 *    resolved to an existing NB player (`playerIdFor`);
 *  - it carries at least one team that resolved (`teamFor`) or was picked
 *    (`teamIds`).
 *
 * A card with several teams contributes one pair per team. Pairs are deduped
 * by (player, team id) or, for a team with no id yet, by (player, folded
 * text); the cards behind a pair are collected on it, in card order.
 */
export function deriveCareerPairs(input: DeriveCareerPairsInput): CareerPair[] {
  if (input.setYear === undefined || !Number.isInteger(input.setYear)) return [];
  const pairs = new Map<string, CareerPair>();
  input.cards.forEach((card, index) => {
    if (input.existingIndexes?.has(index)) return;
    const printedPlayers: string[] = [];
    const seenPlayers = new Set<string>();
    for (const raw of card.players ?? []) {
      const trimmed = raw.trim();
      if (!trimmed) continue;
      const folded = foldText(trimmed);
      if (seenPlayers.has(folded)) continue;
      seenPlayers.add(folded);
      printedPlayers.push(trimmed);
    }
    if (printedPlayers.length !== 1) return;
    const printedPlayer = printedPlayers[0];
    const playerId = input.playerIdFor(printedPlayer);
    if (!playerId) return;

    const teamRefs: Array<{ teamId?: string; teamName?: string }> = [];
    for (const id of card.teamIds ?? []) teamRefs.push({ teamId: id });
    const printedTeams = card.teams?.length ? card.teams : card.team ? [card.team] : [];
    for (const raw of printedTeams) {
      const trimmed = raw.trim();
      if (!trimmed) continue;
      const ref = input.teamFor(trimmed);
      if (!ref || (!ref.teamId && !ref.teamName?.trim())) continue;
      teamRefs.push(ref.teamName ? ref : { ...ref, teamName: trimmed });
    }
    for (const ref of teamRefs) {
      const teamPart = ref.teamId ?? `~${foldText(ref.teamName ?? "")}`;
      const key = `${playerId}|${teamPart}`;
      const existing = pairs.get(key);
      if (existing) {
        if (!existing.cardIndexes.includes(index)) {
          existing.cardIndexes.push(index);
          existing.cardNumbers.push(card.cardNumber);
        }
        continue;
      }
      pairs.set(key, {
        playerId,
        printedPlayer,
        ...(ref.teamId ? { teamId: ref.teamId } : {}),
        ...(ref.teamName ? { teamName: ref.teamName } : {}),
        cardIndexes: [index],
        cardNumbers: [card.cardNumber],
      });
    }
  });
  return Array.from(pairs.values());
}
