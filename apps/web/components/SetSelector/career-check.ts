/**
 * NEO-574 — the wizard's "Career check" step, as a pure model.
 *
 * When a set is tidied up, each NEW card that carries exactly one player (an
 * existing one) and a team is compared with that player's career. If no stint
 * counts toward the set's year for the card's team (`careerCoversCardTeam`),
 * the pair (player, team) is listed ONCE on the step, with its card numbers.
 * The operator can leave it, add the stint, link the cards to a different
 * existing player, or give the cards a different team. Every line defaults to
 * "Leave it", so one Next passes the screen.
 *
 * Nothing here is stored. The answers are wizard state like the teams and
 * autograph answers: `careerCommitFields` turns them into the commit's
 * `careerStints` and per-card edits (`playerIdByName`, `teamIds`, a team
 * string dropped), which the host applies at the last moment and forgets with
 * the preview.
 *
 * Pure: no React, no Convex. The pair rule itself is `convex/lib/careerCoverage`
 * (`deriveCareerPairs`), shared with the server.
 *
 * ## Who is checked
 *
 * Only cards the save creates, with ONE player, who is an existing NB player.
 * A card with several players is never checked and never listed (Jason,
 * 2026-11-16: nobody can say which of them wore the team). A player created in
 * this wizard has a career being built right now and is not checked.
 *
 * ## Where a pair's answer comes from
 *
 * The resolve gate already judged every pair it could resolve on its own
 * (`CareerContext.gaps`). A pair built from those same resolutions is read
 * from the gate: a gap iff the gate listed it. Any other pair (a player the
 * operator linked in this wizard, a team the batch is creating or linked) is
 * put to `careerCoverage.coverageForPreview`. Line membership is decided from
 * the cards as they arrived, never from the answers, so a line does not move
 * under the operator's cursor.
 */
import type { Id } from "../../convex/_generated/dataModel";
import {
  deriveCareerPairs,
  type CareerCheckCard,
  type CareerPair,
} from "../../convex/lib/careerCoverage";
import { normalizeEntityName } from "../../convex/lib/entityNearMatch";
import { MIN_CAREER_YEAR, maxCareerYear } from "../../lib/players/career-years";
import { ignoredPlayerKeys } from "./career-prefill";

export const CAREER_STEP_HEADING = "Career check";

// ---------------------------------------------------------------------------
// The wire shapes
// ---------------------------------------------------------------------------

/** `resolveChecklistEntities`' `careerContext`, as it arrives. */
export type CareerContext = {
  setYear?: number;
  players: Array<{ printed: string; playerId: Id<"players"> }>;
  teams: Array<{ printed: string; teamId: Id<"teams"> }>;
  gaps: Array<{ teamId: Id<"teams">; playerIds: Array<Id<"players">> }>;
};

/** The slice of a batch row the pair derivation reads. */
export type CareerRow = {
  kind: "player" | "team" | "league";
  name: string;
  decision?:
    | { action: "create" }
    | { action: "link"; linkedPlayerId?: string; linkedTeamId?: string }
    | { action: "skip" }
    | null;
};

/** The slice of a preview card it reads. */
export type CareerCard = CareerCheckCard;

const norm = (raw: string): string => normalizeEntityName(raw.trim());
const fold = (raw: string): string => raw.trim().replace(/\s+/g, " ").toLowerCase();

// ---------------------------------------------------------------------------
// Pairs and lines
// ---------------------------------------------------------------------------

/** A pair's identity: stable for the life of a sitting, and the answer's key. */
export function pairKey(pair: Pick<CareerPair, "playerId" | "teamId" | "teamName">): string {
  return `${pair.playerId}|${pair.teamId ?? `~${fold(pair.teamName ?? "")}`}`;
}

/**
 * One line on the step. `printedTeam` is the team text the first card prints
 * for it: stable data (the cards as they arrived), so the order of the lines
 * never shifts when a team's name loads.
 */
export type CareerLine = CareerPair & { key: string; printedTeam?: string };

/**
 * The pairs this sitting's cards produce, after the names are decided:
 * existing players only (a created or skipped player is nobody to check), and
 * a team is an NB row, a team the batch creates (text only), or nothing (ruled
 * "not a team").
 */
export function deriveSittingPairs(input: {
  cards: readonly CareerCard[];
  existingIndexes?: readonly number[];
  rows: readonly CareerRow[];
  skippedPlayerNames?: readonly string[];
  context: CareerContext | undefined;
}): Array<CareerPair & { printedTeam?: string }> {
  const { context } = input;
  if (!context || context.setYear === undefined) return [];
  const ignored = ignoredPlayerKeys(input.rows, input.skippedPlayerNames);
  const playerRows = new Map<string, CareerRow>();
  const teamRows = new Map<string, CareerRow>();
  for (const row of input.rows) {
    const key = norm(row.name);
    if (!key) continue;
    const target = row.kind === "player" ? playerRows : row.kind === "team" ? teamRows : null;
    if (target && !target.has(key)) target.set(key, row);
  }
  const gatePlayers = new Map(context.players.map((p) => [fold(p.printed), p.playerId]));
  const gateTeams = new Map(context.teams.map((t) => [fold(t.printed), t.teamId]));
  // A name ruled "not a person" is nobody on the card, so a card printing it
  // beside one real player still has one player.
  const cards = input.cards.map((card) => ({
    ...card,
    players: (card.players ?? []).filter((p) => !ignored.has(norm(p))),
  }));
  const teamFor = (printed: string): { teamId?: string; teamName?: string } | undefined => {
    const row = teamRows.get(norm(printed));
    if (row) {
      const d = row.decision;
      if (d?.action === "create") return { teamName: printed };
      if (d?.action === "link" && d.linkedTeamId) return { teamId: d.linkedTeamId };
      return undefined;
    }
    const teamId = gateTeams.get(fold(printed));
    return teamId ? { teamId } : undefined;
  };
  const pairs = deriveCareerPairs({
    cards,
    existingIndexes: new Set(input.existingIndexes ?? []),
    setYear: context.setYear,
    playerIdFor: (printed) => {
      const row = playerRows.get(norm(printed));
      if (row) {
        return row.decision?.action === "link" ? row.decision.linkedPlayerId : undefined;
      }
      return gatePlayers.get(fold(printed));
    },
    teamFor,
  });
  // The team text the pair's first card prints for it (for ordering the lines).
  return pairs.map((pair) => {
    const card = cards[pair.cardIndexes[0]];
    const strings = (card?.teams ?? []).filter((t) => t.trim());
    const printed = (strings.length > 0 ? strings : card?.team ? [card.team] : []).find((t) => {
      const ref = teamFor(t);
      if (!ref) return false;
      return pair.teamId
        ? ref.teamId === pair.teamId
        : fold(ref.teamName ?? "") === fold(pair.teamName ?? "");
    });
    return printed ? { ...pair, printedTeam: printed.trim() } : pair;
  });
}

/** The keys of the pairs the gate itself judged: its own resolutions, nothing the operator decided. */
export function gateJudgedKeys(input: {
  cards: readonly CareerCard[];
  existingIndexes?: readonly number[];
  context: CareerContext | undefined;
}): Set<string> {
  const { context } = input;
  if (!context || context.setYear === undefined) return new Set();
  const gatePlayers = new Map(context.players.map((p) => [fold(p.printed), p.playerId]));
  const gateTeams = new Map(context.teams.map((t) => [fold(t.printed), t.teamId]));
  const pairs = deriveCareerPairs({
    cards: input.cards,
    existingIndexes: new Set(input.existingIndexes ?? []),
    setYear: context.setYear,
    playerIdFor: (printed) => gatePlayers.get(fold(printed)),
    teamFor: (printed) => {
      const teamId = gateTeams.get(fold(printed));
      return teamId ? { teamId } : undefined;
    },
  });
  return new Set(pairs.map(pairKey));
}

/** What the coverage read is asked, per pair. */
export type CoverageAsk = { playerId: Id<"players">; teamId?: Id<"teams">; teamName?: string };

export function coverageAskOf(
  pair: Pick<CareerPair, "playerId" | "teamId" | "teamName">,
): CoverageAsk {
  return {
    playerId: pair.playerId as Id<"players">,
    ...(pair.teamId ? { teamId: pair.teamId as Id<"teams"> } : {}),
    ...(pair.teamName ? { teamName: pair.teamName } : {}),
  };
}

export type CareerClassification = {
  /** The pairs to list. */
  gaps: CareerPair[];
  /** The pairs still waiting on `coverageForPreview`. */
  pending: CareerPair[];
  /** The pairs whose coverage read failed: neither listed nor passed, until Retry. */
  failed: CareerPair[];
};

/**
 * Sort pairs into listed, passed, waiting and failed. `coverage` holds the
 * read answers by `pairKey` (true = covered); `failed` the keys whose read
 * failed. A failed read is NOT an answer: the pair is not called covered (it
 * is reported as one the check could not run for), and it does not wait either,
 * so the rest of the step is not held up by it.
 */
export function classifyPairs(input: {
  pairs: readonly CareerPair[];
  judgedByGate: ReadonlySet<string>;
  context: CareerContext | undefined;
  coverage: Readonly<Record<string, boolean>>;
  failed?: Readonly<Record<string, boolean>>;
}): CareerClassification {
  const gapKeys = new Set<string>();
  for (const gap of input.context?.gaps ?? []) {
    for (const playerId of gap.playerIds) gapKeys.add(`${playerId}|${gap.teamId}`);
  }
  const gaps: CareerPair[] = [];
  const pending: CareerPair[] = [];
  const failed: CareerPair[] = [];
  for (const pair of input.pairs) {
    const key = pairKey(pair);
    if (input.judgedByGate.has(key)) {
      if (gapKeys.has(key)) gaps.push(pair);
      continue;
    }
    const covered = input.coverage[key];
    if (covered === undefined) {
      if (input.failed?.[key]) failed.push(pair);
      else pending.push(pair);
    } else if (!covered) gaps.push(pair);
  }
  return { gaps, pending, failed };
}

/**
 * With no names to review, does the sitting need the career step? True when
 * the gate itself listed a gap among the pairs these cards make, or when a
 * pair is one the gate did not judge (a name an earlier save ruled "not a
 * person" changes what counts as a single-player card) and so must be read.
 */
export function careerContextAsks(
  cards: readonly CareerCard[],
  existingIndexes: readonly number[],
  context: CareerContext | undefined,
  skippedPlayerNames?: readonly string[],
): boolean {
  const pairs = deriveSittingPairs({
    cards,
    existingIndexes,
    rows: [],
    skippedPlayerNames,
    context,
  });
  if (pairs.length === 0) return false;
  const { gaps, pending } = classifyPairs({
    pairs,
    judgedByGate: gateJudgedKeys({ cards, existingIndexes, context }),
    context,
    coverage: {},
  });
  return gaps.length > 0 || pending.length > 0;
}

const numeric = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/**
 * The step's lines: by team, then by the first card number, so a team's
 * players sit together and a team's cards read in order. The team is the
 * text the cards print (stable); a pair without one sorts after the others.
 */
export function toLines(
  pairs: ReadonlyArray<CareerPair & { printedTeam?: string }>,
): CareerLine[] {
  return sortCareerLines(pairs.map((pair) => ({ ...pair, key: pairKey(pair) })));
}

/**
 * Lines by team, then the first card number, then key. `teamLabelOf` is the
 * team as the line shows it (the resolved short name); where it has none yet
 * the order falls back to the text the cards print, so a line without a name
 * is placed, never lost. Returns a new array.
 */
export function sortCareerLines<T extends CareerLine>(
  lines: readonly T[],
  teamLabelOf?: (line: T) => string | undefined,
): T[] {
  const teamKey = (line: T): string => {
    const label = teamLabelOf?.(line) || line.printedTeam;
    return label ? fold(label) : "\uffff";
  };
  return [...lines].sort((a, b) => {
    const ta = teamKey(a);
    const tb = teamKey(b);
    if (ta !== tb) return ta < tb ? -1 : 1;
    const byNumber = numeric.compare(a.cardNumbers[0] ?? "", b.cardNumbers[0] ?? "");
    if (byNumber !== 0) return byNumber;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
}

// ---------------------------------------------------------------------------
// Answers
// ---------------------------------------------------------------------------

/** A stint being typed: strings, because it is a form. */
export type StintDraft = { fromYear: string; toYear: string };

/** What happens after a re-check says the NEW pair is uncovered too. */
export type CareerFollowUp = { kind: "leave" } | ({ kind: "add" } & StintDraft);

/**
 * One line's answer. Absent = "Leave it". A "player" or "team" answer with no
 * pick yet is the picker being open: it does nothing until a pick lands.
 */
export type CareerAnswer =
  | { kind: "leave" }
  | ({ kind: "add" } & StintDraft)
  | { kind: "player"; pick?: { playerId: Id<"players">; name: string }; then: CareerFollowUp }
  | { kind: "team"; pick?: { teamId: Id<"teams">; name: string }; then: CareerFollowUp };

export type CareerAnswers = Readonly<Record<string, CareerAnswer>>;

export const LEAVE_FOLLOW_UP: CareerFollowUp = { kind: "leave" };

/** A fresh add form: From year the set's, To year blank. */
export function freshStint(setYear: number | undefined): StintDraft {
  return { fromYear: setYear === undefined ? "" : String(setYear), toYear: "" };
}

const YEAR_TEXT = /^\d{4}$/;

/** The years a draft means, or null when they are not a valid stint yet. */
export function parseStintDraft(
  draft: StintDraft,
  maxYear: number = maxCareerYear(),
): { fromYear: number; toYear?: number } | null {
  const from = draft.fromYear.trim();
  // Four digits and nothing else: `Number()` would take "0x7C6" or "1.99e3".
  if (!YEAR_TEXT.test(from)) return null;
  const fromYear = Number(from);
  if (fromYear < MIN_CAREER_YEAR || fromYear > maxYear) return null;
  const to = draft.toYear.trim();
  if (to === "") return { fromYear };
  if (!YEAR_TEXT.test(to)) return null;
  const toYear = Number(to);
  if (toYear > maxYear || toYear < fromYear) return null;
  return { fromYear, toYear };
}

/** The stint form a line's answer is holding, if any (the add itself, or a follow-up add). */
export function stintDraftOf(answer: CareerAnswer | undefined): StintDraft | null {
  if (!answer) return null;
  if (answer.kind === "add") return answer;
  if ((answer.kind === "player" || answer.kind === "team") && answer.pick) {
    return answer.then.kind === "add" ? answer.then : null;
  }
  return null;
}

/** Lines whose add form is open and not a valid stint: Next waits for these. */
export function linesWithBadYears(
  lines: readonly CareerLine[],
  answers: CareerAnswers,
  maxYear: number = maxCareerYear(),
): string[] {
  return lines
    .filter((line) => {
      const draft = stintDraftOf(answers[line.key]);
      return draft !== null && parseStintDraft(draft, maxYear) === null;
    })
    .map((line) => line.key);
}

/**
 * The pair a "Different player" / "Different team" pick asks the coverage read
 * about: the new player on the card's team, or the same player on the new
 * team. Null until something is picked.
 */
export function followUpPair(
  line: CareerLine,
  answer: CareerAnswer | undefined,
): { key: string; ask: CoverageAsk } | null {
  if (!answer || (answer.kind !== "player" && answer.kind !== "team") || !answer.pick) return null;
  const ask: CoverageAsk =
    answer.kind === "player"
      ? {
          playerId: answer.pick.playerId,
          ...(line.teamId ? { teamId: line.teamId as Id<"teams"> } : {}),
          ...(line.teamName ? { teamName: line.teamName } : {}),
        }
      : { playerId: line.playerId as Id<"players">, teamId: answer.pick.teamId };
  return { key: pairKey(ask), ask };
}

// ---------------------------------------------------------------------------
// What the commit receives
// ---------------------------------------------------------------------------

/** One card's edits: who is on it, and its team. */
export type CareerCardEdit = {
  /** The printed player string → the existing player the card now links to. */
  playerIdByName?: Array<{ name: string; playerId: Id<"players"> }>;
  /** Printed team strings the operator replaced. */
  dropTeams?: string[];
  /**
   * NB team ids the operator replaced. A pair's team can come from a card's
   * `teamIds` rather than its printed text (an earlier answer put it there),
   * and taking the string off would leave that id on the card.
   */
  dropTeamIds?: Array<Id<"teams">>;
  /** NB teams the operator picked. */
  teamIds?: Array<Id<"teams">>;
};

/** `commitCardChecklist`' `careerStints` entry. */
export type CareerStintArg = {
  playerId: Id<"players">;
  teamId?: Id<"teams">;
  teamName?: string;
  fromYear: number;
  toYear?: number;
};

/** MAX the commit accepts. */
export const CAREER_STINTS_MAX = 200;

export type CareerCommitFields = {
  stints: CareerStintArg[];
  /** Aligned with the preview cards. */
  cardEdits: Array<CareerCardEdit | undefined>;
};

function stintFor(
  playerId: string,
  team: { teamId?: string; teamName?: string },
  draft: StintDraft,
  maxYear: number,
): CareerStintArg | null {
  const years = parseStintDraft(draft, maxYear);
  if (!years) return null;
  return {
    playerId: playerId as Id<"players">,
    ...(team.teamId ? { teamId: team.teamId as Id<"teams"> } : { teamName: team.teamName }),
    ...years,
  };
}

/** The printed spelling of `printed` as THIS card carries it. */
function spellingOn(card: CareerCard, printed: string): string {
  const key = fold(printed);
  return (card.players ?? []).map((p) => p.trim()).find((p) => fold(p) === key) ?? printed.trim();
}

/**
 * The commit's view of the operator's answers: stints to add and per-card
 * edits. Undefined when there is nothing to send, so an untouched step puts
 * nothing on the wire. A "player" or "team" answer with no pick is "Leave it";
 * an add whose years are not valid yet is not sent (Next waits for it).
 */
export function careerCommitFields(input: {
  lines: readonly CareerLine[];
  answers: CareerAnswers;
  cards: readonly CareerCard[];
  maxYear?: number;
}): CareerCommitFields | undefined {
  const maxYear = input.maxYear ?? maxCareerYear();
  const stints: CareerStintArg[] = [];
  const seen = new Set<string>();
  const addStint = (stint: CareerStintArg | null) => {
    if (!stint) return;
    const key = `${stint.playerId}|${stint.teamId ?? `~${fold(stint.teamName ?? "")}`}|${stint.fromYear}`;
    if (seen.has(key)) return;
    seen.add(key);
    stints.push(stint);
  };
  const edits: Array<CareerCardEdit | undefined> = input.cards.map(() => undefined);
  const edit = (index: number): CareerCardEdit => (edits[index] ??= {});

  for (const line of input.lines) {
    const answer = input.answers[line.key];
    if (!answer || answer.kind === "leave") continue;
    if (answer.kind === "add") {
      addStint(stintFor(line.playerId, line, answer, maxYear));
      continue;
    }
    if (!answer.pick) continue;
    if (answer.kind === "player") {
      const { playerId } = answer.pick;
      for (const index of line.cardIndexes) {
        const e = edit(index);
        const name = spellingOn(input.cards[index], line.printedPlayer);
        e.playerIdByName = [
          ...(e.playerIdByName ?? []).filter((x) => fold(x.name) !== fold(name)),
          { name, playerId },
        ];
      }
      if (answer.then.kind === "add") addStint(stintFor(playerId, line, answer.then, maxYear));
    } else {
      const { teamId } = answer.pick;
      for (const index of line.cardIndexes) {
        const e = edit(index);
        if (line.teamName) e.dropTeams = [...(e.dropTeams ?? []), line.teamName];
        if (line.teamId) {
          e.dropTeamIds = Array.from(
            new Set([...(e.dropTeamIds ?? []), line.teamId as Id<"teams">]),
          );
        }
        e.teamIds = Array.from(new Set([...(e.teamIds ?? []), teamId]));
      }
      if (answer.then.kind === "add") {
        addStint(stintFor(line.playerId, { teamId }, answer.then, maxYear));
      }
    }
  }
  if (stints.length === 0 && edits.every((e) => e === undefined)) return undefined;
  return { stints: stints.slice(0, CAREER_STINTS_MAX), cardEdits: edits };
}

/** Two commit-field bundles say the same thing (so the host is not re-rendered for nothing). */
export function sameCareerFields(
  a: CareerCommitFields | undefined,
  b: CareerCommitFields | undefined,
): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** The card fields an edit touches. */
type EditableCard = {
  team?: string;
  teams?: string[];
  teamIds?: Array<Id<"teams">>;
  playerIdByName?: ReadonlyArray<{ name: string; playerId: string }>;
};

/**
 * A card with its career edit put on it, as the commit receives it. A card
 * with no edit comes back as the same object, so an untouched step's wire
 * payload is byte-identical to what it was before.
 *
 * A replaced team string comes OFF the card (`teams` and the legacy `team`)
 * and the picked team goes on as `teamIds`; the card's other teams stay.
 */
export function applyCareerCardEdit<T extends EditableCard>(
  card: T,
  edit: CareerCardEdit | undefined,
): T {
  if (!edit) return card;
  const next: T = { ...card };
  if (edit.playerIdByName?.length) next.playerIdByName = edit.playerIdByName;
  if (edit.dropTeams?.length) {
    const dropped = new Set(edit.dropTeams.map(fold));
    const kept = (card.teams ?? []).filter((t) => !dropped.has(fold(t)));
    if (card.teams) next.teams = kept;
    if (card.team !== undefined && dropped.has(fold(card.team))) delete next.team;
  }
  if (edit.dropTeamIds?.length && card.teamIds) {
    // Off first, then the pick goes on: picking the very team replaced keeps it.
    const droppedIds = new Set<string>(edit.dropTeamIds);
    next.teamIds = card.teamIds.filter((id) => !droppedIds.has(id));
  }
  if (edit.teamIds?.length) {
    next.teamIds = Array.from(new Set([...(next.teamIds ?? card.teamIds ?? []), ...edit.teamIds]));
  }
  return next;
}

/**
 * NEO-574 — New Team rows the batch would create that no card names any more.
 *
 * A "Different team" answer takes the card's printed team string off the card.
 * When that string was the only reference to a team the operator had decided
 * to create, nothing is left to ask for it: the commit walks the team names on
 * the cards it receives (`commitCardChecklist`'s `teamNames`), so a name no
 * card carries is never created. This is that same reading, on the client, for
 * what the summary says Confirm will do. Rows whose string another card (or
 * the same card's other team) still prints stay in: "something else still
 * references it".
 *
 * `before` is the cards as they reached the career step, `after` the same
 * cards with the answers put on them. Only a row that was referenced before
 * and is not now counts; a row nobody ever referenced here (a pending name on
 * a stored card, say) is left to the server as it always was.
 */
export function unreferencedCreatedTeamRows(
  before: ReadonlyArray<{ team?: string; teams?: readonly string[] }>,
  after: ReadonlyArray<{ team?: string; teams?: readonly string[] }>,
  rows: ReadonlyArray<Pick<CareerRow, "kind" | "name" | "decision">>,
): string[] {
  const keysOf = (cards: typeof before): Set<string> => {
    const out = new Set<string>();
    for (const card of cards) {
      const named = (card.teams ?? []).filter((t) => t.trim());
      for (const t of named.length > 0 ? named : card.team ? [card.team] : []) {
        const key = norm(t);
        if (key) out.add(key);
      }
    }
    return out;
  };
  const was = keysOf(before);
  const is = keysOf(after);
  const out: string[] = [];
  for (const row of rows) {
    if (row.kind !== "team" || row.decision?.action !== "create") continue;
    const key = norm(row.name);
    if (key && was.has(key) && !is.has(key) && !out.includes(key)) out.push(key);
  }
  return out;
}

/** Positions whose team the operator replaced: the Teams step does not ask about them. */
export function reteamedIndexes(edits: ReadonlyArray<CareerCardEdit | undefined>): number[] {
  const out: number[] = [];
  edits.forEach((e, i) => {
    if (e?.teamIds?.length) out.push(i);
  });
  return out;
}

// ---------------------------------------------------------------------------
// Copy (exported so the tests read it rather than restating it)
// ---------------------------------------------------------------------------

/** "Career check · 3 to look at" — the count lives in the heading, not a lead sentence. */
export function careerHeading(count: number): string {
  return count > 0 ? `${CAREER_STEP_HEADING} · ${count} to look at` : CAREER_STEP_HEADING;
}

/**
 * "No Padres in the career by 2022." The team is the short name, as its rows
 * show it. With no name known yet it says "This team isn’t in the career by
 * 2022.", which is true of any team, so it is never wrong text.
 */
export function noStintText(team: string | undefined, year: number): string {
  return team ? `No ${team} in the career by ${year}.` : `This team isn’t in the career by ${year}.`;
}

/** A player with no stints at all: there is nothing to compare the team with. */
export const NO_CAREER_TEXT = "No career on file yet.";

/** The follow-up after a different player or team is picked and is uncovered too. */
export function uncoveredAgainText(subject: string, team: string | undefined, year: number): string {
  return team
    ? `No ${team} in ${subject}’s career by ${year} either.`
    : `This team isn’t in ${subject}’s career by ${year} either.`;
}

/** …and when the pick's career does show the team. */
export function coveredText(subject: string, team: string | undefined): string {
  return team ? `${subject} played for the ${team}.` : `${subject} played for this team.`;
}

/** A namesake's career shows the card's team. */
export function playedForText(team: string | undefined): string {
  return team ? `Played for the ${team}` : "Played for this team";
}

/** Why the years are not a stint. */
export function yearsHintText(): string {
  return `Years go ${MIN_CAREER_YEAR}–${maxCareerYear()}, and To can’t come before From.`;
}

export const CAREER_NEXT_BLOCKED = "Fix the years first — then Next.";
export const CAREER_CHECKING = "Checking careers…";
/** The coverage read failed. Next still saves; Retry asks again. */
export const CAREER_READ_FAILED = "Couldn’t check careers. Retry, or Next saves without it.";
/** A New Team row the career step made unnecessary, in the Decided list. */
export const CAREER_TEAM_NOT_NEEDED = "Not needed — card’s team changed";
export const CAREER_RETRY_LABEL = "Retry career check";
/** A relinked player or re-teamed pair whose re-check failed. */
export const careerFollowUpFailed = (subject: string): string =>
  `Couldn’t check ${subject}’s career.`;
