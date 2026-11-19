/**
 * NEO-574 — what the New player step's career form opens with.
 *
 * A player the wizard is about to CREATE has no career until the operator (or
 * Wikidata) gives it one, and the cards in front of them already say where the
 * player was that year: the team printed on their cards, in the set's year.
 * So the form opens ready to add exactly that stint — the team and the set
 * year in the boxes — and the other teams the player's cards print wait one
 * press away as chips. Nothing is written until + Add (the prefill is not
 * "work": the form is not dirty, so the walk is free to move on).
 *
 * Pure: no React, no Convex. The wizard supplies its preview cards and batch
 * rows; everything decided here is a function of them.
 *
 * ## Which cards count
 *
 * Cards the save will CREATE that print this player and nobody else. A card
 * with several players says nothing about which of them wore the team
 * (invariant 8: a data claim holds a guess back, it never makes one), so its
 * teams are never offered. A name the operator ruled "not a person", now or in
 * an earlier save, is nobody, so a card printing it beside this player is
 * still this player's alone.
 *
 * ## What text the team goes in as
 *
 * The name the batch will actually use, so the add lands on the team and not
 * on a second spelling of it:
 *
 *   1. the team row this batch decided: the New Team it will create (its
 *      composed name), or the existing team it linked (that team's name);
 *   2. else the name the gate resolved for the printed string
 *      (`titleContext.teams`);
 *   3. else the printed string itself, which goes the usual New Team way
 *      (the career form stages a step for a name that matches nothing).
 *
 * A team the operator ruled "not a team" is not offered.
 *
 * ## Order
 *
 * The team on the most of the player's solo cards is the prefill; ties go to
 * the card that comes first in the checklist. The rest are chips, in the same
 * order. A team the career already accepted for this year (a kept Wikidata
 * team, a chip already added) is skipped, so after each + Add the next team
 * the cards print is what the form opens with.
 */
import { normalizeEntityName } from "../../convex/lib/entityNearMatch";
import { teamFullName } from "../../lib/teams/team-name";

/** The slice of a preview card this module reads. */
export interface PrefillCard {
  players?: string[];
  team?: string;
  teams?: string[];
}

/** The slice of a batch row this module reads. */
export interface PrefillRow {
  kind: "player" | "team" | "league";
  name: string;
  decision?:
    | { action: "create"; create?: { location?: string; name: string } }
    | { action: "link"; linkedTeamId?: string }
    | { action: "skip" }
    | null;
}

/** A career stint already accepted for the player on screen. */
export interface AcceptedStint {
  name: string;
  fromYear: number;
}

export interface CareerPrefillInput {
  /** The New player row's name, as the cards print it. */
  playerName: string;
  cards: readonly PrefillCard[];
  /** Positions in `cards` that re-sync a stored row; the save creates the rest. */
  existingIndexes?: readonly number[];
  rows: readonly PrefillRow[];
  /** Player names this set's skip records rule "not a person", raw. */
  skippedPlayerNames?: readonly string[];
  /** `titleContext.teams`: printed string → the name the gate resolved it to. */
  resolvedTeams?: ReadonlyArray<{ printed: string; name: string }>;
  /** Linked team id → its full name, for a team row the operator linked. */
  linkedTeamNameById?: ReadonlyMap<string, string>;
  /** The set's year. Without it nothing is offered. */
  setYear: number | undefined;
  /** What this player's career already holds, kept Wikidata teams and added chips alike. */
  accepted: readonly AcceptedStint[];
}

export interface CareerPrefill {
  /** The team and From year the form opens with, or null. */
  prefill: { team: string; fromYear: number } | null;
  /** The other teams, one press each. */
  quickPicks: Array<{ team: string; fromYear: number }>;
}

const NONE: CareerPrefill = { prefill: null, quickPicks: [] };

const norm = (raw: string): string => normalizeEntityName(raw.trim());

/**
 * The people on a card, as keys: every printed name that is not ruled "not a
 * person". `ignored` holds the keys of names a skip decision or an earlier
 * save's skip record rules out.
 */
export function cardPlayerKeys(
  card: { players?: readonly string[] },
  ignored: ReadonlySet<string>,
): string[] {
  const out: string[] = [];
  for (const raw of card.players ?? []) {
    const key = norm(raw);
    if (key && !ignored.has(key) && !out.includes(key)) out.push(key);
  }
  return out;
}

/** The keys of the names ruled "not a person": this sitting's skips, and earlier saves'. */
export function ignoredPlayerKeys(
  rows: ReadonlyArray<Pick<PrefillRow, "kind" | "name" | "decision">>,
  skippedPlayerNames: readonly string[] | undefined,
): Set<string> {
  const out = new Set<string>();
  for (const name of skippedPlayerNames ?? []) {
    const key = norm(name);
    if (key) out.add(key);
  }
  // A row wins over the stored record: it is the newer answer.
  for (const row of rows) {
    if (row.kind !== "player") continue;
    const key = norm(row.name);
    if (!key) continue;
    if (row.decision?.action === "skip") out.add(key);
    else if (row.decision) out.delete(key);
  }
  return out;
}

function cardTeamStrings(card: PrefillCard): string[] {
  const named = (card.teams ?? []).map((t) => t.trim()).filter(Boolean);
  if (named.length === 0 && card.team?.trim()) named.push(card.team.trim());
  return Array.from(new Set(named));
}

/**
 * The name to put in the form for one printed team string, or null when it is
 * ruled "not a team".
 */
function teamTextFor(printed: string, input: CareerPrefillInput): string | null {
  const key = norm(printed);
  const row = input.rows.find((r) => r.kind === "team" && norm(r.name) === key);
  const decision = row?.decision;
  if (decision?.action === "skip") return null;
  if (decision?.action === "create" && decision.create) return teamFullName(decision.create);
  if (decision?.action === "link" && decision.linkedTeamId) {
    const linked = input.linkedTeamNameById?.get(decision.linkedTeamId);
    if (linked) return linked;
  }
  const resolved = input.resolvedTeams?.find((t) => t.printed.trim() === printed.trim());
  return resolved?.name.trim() || printed.trim();
}

/** Does an accepted stint already cover this team in the set's year? */
function covered(team: string, setYear: number, accepted: readonly AcceptedStint[]): boolean {
  const key = norm(team);
  return accepted.some((s) => norm(s.name) === key && s.fromYear <= setYear);
}

export function careerPrefill(input: CareerPrefillInput): CareerPrefill {
  const { setYear } = input;
  if (setYear === undefined) return NONE;
  const player = norm(input.playerName);
  if (!player) return NONE;
  const ignored = ignoredPlayerKeys(input.rows, input.skippedPlayerNames);
  const existing = new Set(input.existingIndexes ?? []);

  const tally = new Map<string, { team: string; cards: number; first: number }>();
  input.cards.forEach((card, index) => {
    if (existing.has(index)) return;
    const people = cardPlayerKeys(card, ignored);
    if (people.length !== 1 || people[0] !== player) return;
    // One card counts for a team once, whatever spellings it prints it in.
    const counted = new Set<string>();
    for (const printed of cardTeamStrings(card)) {
      const team = teamTextFor(printed, input);
      if (!team) continue;
      const key = norm(team);
      if (counted.has(key)) continue;
      counted.add(key);
      const seen = tally.get(key);
      if (seen) seen.cards += 1;
      else tally.set(key, { team, cards: 1, first: index });
    }
  });

  const ranked = [...tally.values()]
    .filter((t) => !covered(t.team, setYear, input.accepted))
    .sort((a, b) => b.cards - a.cards || a.first - b.first)
    .map((t) => ({ team: t.team, fromYear: setYear }));
  if (ranked.length === 0) return NONE;
  return { prefill: ranked[0], quickPicks: ranked.slice(1) };
}
