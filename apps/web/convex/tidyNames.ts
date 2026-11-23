/**
 * NEO-645 — the name rows of One-card Tidy Up: answers, sport, lookups.
 *
 * `tidyNames` (schema.ts) replaces `entityReviewQueue` and absorbs
 * `entityReviewSkips`. One row per (scopeId, kind, nameNormalized), shared
 * across operators. This module is the PUBLIC surface the tiles call:
 *
 *   - `answerName`      Link / which player / preselect / Change / Not a player
 *                       / Not a team / clear. The one door for a name's answer.
 *   - `createPlayer`    Add as new player.
 *   - `setNameSport`    the Sport chip on a player or team tile.
 *   - `requestLookup`   "Add as new player anyway": ask Wikidata now (and for a
 *                       migrated name nobody has asked about: `neverLooked`).
 *   - `lookupsPending`  a small subscribed read: which names are still looking.
 *
 * and the INTERNAL machinery behind them:
 *
 *   - `upsertFromGatePage`   the review gate writes its facts (auto-links, set
 *                            history picks, preselects, same-name choices, team
 *                            candidates) as rows BEFORE the commit (schema doc
 *                            4a). Driven page by page from the action.
 *   - `resetForRefetch`      a fetch forgets every earlier answer (A17): the gate
 *                            calls it first, so a name is matched against the
 *                            players and teams that exist NOW and asked again if
 *                            unlinked. Only an operator's "not an entity" stays.
 *   - `sweepExpiredLookupOutput` hourly cron: Wikidata output a day old is
 *                            forgotten (the row goes back to never-looked-up;
 *                            answers stay), as main's 24h reaper did.
 *   - `fanOut*`              an answer reaches every card in its scope: paged,
 *                            compare-and-set, stops when the answer is replaced.
 *   - `enqueuePendingLookups` after the commit finalizes (schema doc 4b).
 *   - `applyLookupResult` / `backstopLookupRowImpl` / `sweepStaleLookups`
 *                            the Wikidata side, gated by `lookupGen`.
 *
 * ## Conventions every public mutation here follows
 *
 *  - `requireAdmin` first.
 *  - The scope is NEVER an argument. Each mutation takes the open `cardId` and
 *    the printed `name`; the server finds the card's `cardPrintedNames` row for
 *    (kind, normalised name) and reads the scope off it (falling back to the
 *    card's own leaf when the scope leaf is gone: decision Q3).
 *  - Strings are capped (`MAX_TIDY_NAME_LENGTH`). An over-cap argument is a
 *    `ConvexError` naming the LIMIT, never the value.
 *  - A marketplace name never appears in an error message.
 *  - Answers are NB data: `by` is set by the server ("operator" here; "auto"
 *    is written only by the gate from NB's own rows).
 *
 * ## Fan-out cost
 *
 * See the measurement note on `FAN_OUT_PAGE_SIZE` and the page doc on `fanOutPage`.
 */

import { ConvexError, v, type Infer } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { requireAdmin } from "./auth";
import { TIDY_CHECKS_MAX } from "./features/cardAttention";
import {
  tidyLookupStatusValidator,
  tidyNameAnswerValidator,
  tidyNameEnrichmentValidator,
  tidyNameKindValidator,
} from "./schema";
import {
  listCardPrintedNames,
  listPrintersOfName,
  pagePrintersOfName,
  resolveScopeLeaf,
} from "./cardPrintedNames";
import {
  nameFieldsOf,
  newNameWriteCache,
  planNameChange,
  unlinkedBeforeCount,
  writeNameChange,
  type NameChange,
  type NameWriteCache,
  type PrintedRef,
} from "./tidyCardWrites";
import {
  addPlayerSport,
  assertNotNameFragment,
  buildExistingPlayerCandidates,
  buildExistingPlayerCandidatesForIds,
  MAX_CANDIDATES_FOR_IDS,
  MAX_PLAYER_NAME_LENGTH,
  playerBelongsToSport,
} from "./players";
import { rememberAliasesOnTeam } from "./rememberTeamAliases";
import { MAX_TEAM_NAME_LENGTH } from "./teams";
import { findSportForSelectorOption } from "./cardChecklist";
import { findSetYearForSelectorOption } from "./lib/selectorAncestry";
import { resolveTeamForSetYear } from "./lib/teamRow";
import { sortTeamYears } from "../lib/players/team-tenure";
import { cleanseExternalName } from "../lib/entities/cleanse-name";
import { normalizeEntityName } from "../lib/entities/normalize-name";
import { PLAYER_DESCRIPTION_MAX_TEAMS } from "../lib/players/player-description";
import type { RunResult } from "@convex-dev/workpool";

/** Longest printed name accepted, in characters. Same bound as the schema. */
export const MAX_TIDY_NAME_LENGTH = 120;

/**
 * The most pending names `lookupsPending` reads in one run. One more than it
 * returns, so `more` is exact. Pending rows are small (no enrichment yet), and
 * the query re-runs each time a lookup lands, so the bound is what keeps it
 * cheap (NEO-392).
 */
export const LOOKUPS_PENDING_RETURN_MAX = 256;

/** Printed cards one fan-out page reads and writes. Do not shrink: more pages
 *  re-run every subscribed `getCardChecklist` more often. */
export const FAN_OUT_PAGE_SIZE = 50;

/*
 * What one fan-out card costs, MEASURED by `tidyNames.fanOut.test.ts` (a counting
 * Proxy over `ctx.db`, a page of `FAN_OUT_PAGE_SIZE` printers each linking a
 * player, the page cache warm, the card in a leaf with no league):
 *
 *   per page   250 database calls, 152 documents read, 98 written
 *   per card   about 5.1 calls (3.1 documents read, 2 written), so about 10
 *              operations counting each call, read and write once
 *
 * A page of 50 is therefore about 500 operations (a team link adds the league
 * settle, about 3 more a card, so about 650): comfortably inside the ~900-op
 * band, with room for the per-leaf cache fills (6 reads per distinct leaf). The
 * old estimate of 12 a card (the constant this replaces) was a modelled upper
 * bound, not a measurement. Do not shrink the page: more pages re-run every
 * subscribed `getCardChecklist` more often.
 */

/** The gate's budget per `upsertFromGatePage` call (same as the old startBatch). */
export const GATE_UPSERT_OPS = 800;
/** Stale-lookup sweep: age a pending row to error after this long. */
export const LOOKUP_STALE_MS = 30 * 60 * 1000;
export const LOOKUP_SWEEP_CHUNK = 100;
/** Rows one `enqueuePendingLookups` page reads. */
export const ENQUEUE_PAGE = 100;

/** Per-name gate charge, as `startBatch` (NEO-294). */
const NAME_LOOKUP_OPS_BASE = 3;
const NAME_LOOKUP_OPS_EXTRA = 16 * (PLAYER_DESCRIPTION_MAX_TEAMS + 1);

/**
 * What the operator answered, as the tiles send it. `by` is absent on purpose:
 * the server records "operator".
 */
export const tidyAnswerInputValidator = v.union(
  v.object({
    kind: v.literal("linkPlayer"),
    playerId: v.id("players"),
    addSetSport: v.optional(v.literal(true)),
  }),
  v.object({
    kind: v.literal("linkTeam"),
    teamId: v.id("teams"),
    saveAsAlias: v.optional(v.literal(true)),
  }),
  v.object({ kind: v.literal("notEntity") }),
  v.object({ kind: v.literal("clear") }),
);

/** What a fan-out applies to a card. Mirrors `NameChange` as a validator. */
const changeValidator = v.union(
  v.object({ kind: v.literal("linkPlayer"), playerId: v.id("players") }),
  v.object({ kind: v.literal("linkTeam"), teamId: v.id("teams") }),
  v.object({ kind: v.literal("notEntity") }),
  v.object({ kind: v.literal("restore") }),
);

const originValidator = v.union(
  v.literal("setHistory"),
  v.literal("hallOfFame"),
  v.literal("careerTeam"),
);

/** One name the gate established a fact about. See `upsertFromGatePage`. */
export const gateItemValidator = v.object({
  kind: tidyNameKindValidator,
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
      origin: originValidator,
      /** History player first, then in-sport rivals; built into candidates when 2+. */
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

type Answer = Infer<typeof tidyNameAnswerValidator>;
type Enrichment = Infer<typeof tidyNameEnrichmentValidator>;

// ─── helpers ────────────────────────────────────────────────────────────────

function cleanName(raw: string): string {
  const name = raw.trim();
  if (name.length === 0) throw new ConvexError("A name is required.");
  if (name.length > MAX_TIDY_NAME_LENGTH) {
    throw new ConvexError(
      `A name is ${name.length} characters; the limit is ${MAX_TIDY_NAME_LENGTH}.`,
    );
  }
  return name;
}

export async function readRow(
  ctx: Pick<MutationCtx, "db">,
  scopeId: Id<"selectorOptions">,
  kind: "player" | "team",
  nameNormalized: string,
): Promise<Doc<"tidyNames"> | null> {
  return ctx.db
    .query("tidyNames")
    .withIndex("by_scope_kind_name", (q) =>
      q.eq("scopeId", scopeId).eq("kind", kind).eq("nameNormalized", nameNormalized),
    )
    .first();
}

/** The card, its printed row for the name, the answering scope and the name row. */
export async function resolveName(
  ctx: MutationCtx,
  cardId: Id<"cardChecklist">,
  kind: "player" | "team",
  rawName: string,
) {
  const name = cleanName(rawName);
  const key = normalizeEntityName(name);
  if (!key) throw new ConvexError("A name is required.");
  const card = await ctx.db.get(cardId);
  if (!card) throw new ConvexError("That card is gone. Refresh and try again.");
  const printedRows = await listCardPrintedNames(ctx, card._id);
  const printed = printedRows.find((p) => p.kind === kind && p.nameNormalized === key);
  if (!printed) throw new ConvexError("That name isn't on this card.");
  const scopeId = await resolveScopeLeaf(ctx, printed, card.selectorOptionId);
  const row = await readRow(ctx, scopeId, kind, key);
  if (!row) throw new ConvexError("That name has nothing to answer.");
  return { card, printed, printedRows, scopeId, row, key };
}

/** How many unfinished states a name remembers (a fifth quick answer would be a person mashing keys). */
const FAN_OUT_STATES_MAX = 8;

function sameState(a: Answer | null, b: Answer | null): boolean {
  if (a === null || b === null) return a === b;
  return sameAnswer(a, b);
}

function sameAnswer(a: Answer | undefined, b: Answer): boolean {
  if (!a || a.kind !== b.kind || a.by !== b.by) return false;
  if (a.kind === "linkPlayer" && b.kind === "linkPlayer") {
    return a.playerId === b.playerId && !!a.addSetSport === !!b.addSetSport;
  }
  if (a.kind === "linkTeam" && b.kind === "linkTeam") {
    return a.teamId === b.teamId && !!a.saveAsAlias === !!b.saveAsAlias;
  }
  return a.kind === "notEntity";
}

function changeOf(answer: Answer | undefined): NameChange {
  if (!answer) return { kind: "restore" };
  if (answer.kind === "linkPlayer") return { kind: "linkPlayer", playerId: answer.playerId };
  if (answer.kind === "linkTeam") return { kind: "linkTeam", teamId: answer.teamId };
  return { kind: "notEntity" };
}

/** Whitelist a lookup result down to what `tidyNameEnrichmentValidator` stores. */
export function pickEnrichment(raw: Record<string, unknown> | undefined): Enrichment | undefined {
  if (!raw) return undefined;
  const out: Record<string, unknown> = {};
  for (const key of [
    "wikidataId",
    "undatedCareerTeams",
    "isHallOfFame",
    "description",
    "birthYear",
    "enwikiTitle",
    "existingCandidates",
    "preselect",
    "league",
    "leagueWikidataId",
    "location",
    "yearsActive",
    "colors",
    "espnId",
  ]) {
    if (raw[key] !== undefined) out[key] = raw[key];
  }
  const careers = raw.careerTeams;
  if (Array.isArray(careers)) {
    out.careerTeams = careers.slice(0, 64).map((c: Record<string, unknown>) => ({
      name: c.name,
      fromYear: c.fromYear,
      ...(c.toYear !== undefined ? { toYear: c.toYear } : {}),
      ...(c.wikidataId !== undefined ? { wikidataId: c.wikidataId } : {}),
    }));
  }
  return out as Enrichment;
}

const isSameNameChoice = (e: Enrichment | undefined) =>
  (e?.existingCandidates?.length ?? 0) > 0;
/** A same-name choice or a preselect waits for the operator before any lookup (NEO-332/424). */
export const awaitsOperatorBeforeLookup = (e: Enrichment | undefined) =>
  isSameNameChoice(e) || e?.preselect !== undefined;

/**
 * The name row for a printed name, born if it has none: `ready` with its
 * same-name candidates when the name is a choice (NEO-332), otherwise `pending`
 * at generation 0 so `enqueuePendingLookups` asks Wikidata AFTER the write that
 * made it commits (schema doc 4b). Used by the writers that meet a name outside
 * the gate (`tidyCards.pickSourceValue`).
 */
export async function ensureTidyNameRow(
  ctx: MutationCtx,
  args: {
    scopeId: Id<"selectorOptions">;
    kind: "player" | "team";
    name: string;
    sportId: Id<"selectorOptions">;
    setYear: number | undefined;
  },
): Promise<Doc<"tidyNames">> {
  const name = args.name.trim().slice(0, MAX_TIDY_NAME_LENGTH);
  const key = normalizeEntityName(name);
  const existing = await readRow(ctx, args.scopeId, args.kind, key);
  if (existing) return existing;
  const candidates =
    args.kind === "player"
      ? await buildExistingPlayerCandidates(ctx, name, args.sportId, { cardYear: args.setYear })
      : [];
  const choice = candidates.length > 0;
  const id = await ctx.db.insert("tidyNames", {
    scopeId: args.scopeId,
    kind: args.kind,
    nameNormalized: key,
    name,
    sportId: args.sportId,
    status: choice ? "ready" : "pending",
    ...(choice
      ? { enrichment: { existingCandidates: candidates } }
      : { lookupGen: 0, lookupRequestedAt: Date.now() }),
  });
  return (await ctx.db.get(id))!;
}

// ─── answerName ─────────────────────────────────────────────────────────────

/**
 * The shared answer write: the row, its side effects, the open card, the
 * scheduled fan-out. `answerName` and `createPlayer` both end here, so a
 * created player is answered exactly as a linked one.
 */
export async function applyAnswer(
  ctx: MutationCtx,
  userId: string,
  target: Awaited<ReturnType<typeof resolveName>>,
  input: Infer<typeof tidyAnswerInputValidator>,
): Promise<{ answerGen: number; fanOutScheduled: boolean }> {
  const { card, printed, printedRows, scopeId, row, key } = target;
  const kind = row.kind;
  let stored: Answer | undefined;
  let sportPatch: Id<"selectorOptions"> | undefined;

  if (input.kind === "linkPlayer") {
    if (kind !== "player") throw new ConvexError("That answer is for a player name.");
    const player = await ctx.db.get(input.playerId);
    if (!player) throw new ConvexError("That player is gone. Pick them again.");
    const offered =
      row.enrichment?.preselect?.playerId === player._id ||
      (row.enrichment?.existingCandidates ?? []).some((c) => c.playerId === player._id);
    if (offered) {
      // D7: a link to what the row itself offered may be in another sport; the
      // row's question follows the player's home sport.
      if (player.sportId !== row.sportId) sportPatch = player.sportId;
    } else if (!(await playerBelongsToSport(ctx, player, row.sportId))) {
      throw new ConvexError("That player isn't in this sport.");
    }
    if (input.addSetSport) {
      const setSportId = await findSportForSelectorOption(ctx, scopeId);
      if (setSportId && player.sportId !== setSportId) {
        await addPlayerSport(ctx, player, setSportId);
      }
    }
    stored = {
      kind: "linkPlayer",
      playerId: player._id,
      by: "operator",
      ...(input.addSetSport ? { addSetSport: true as const } : {}),
    };
  } else if (input.kind === "linkTeam") {
    if (kind !== "team") throw new ConvexError("That answer is for a team name.");
    const team = await ctx.db.get(input.teamId);
    if (!team) throw new ConvexError("That team is gone. Pick it again.");
    if (team.sportId !== row.sportId) throw new ConvexError("That team isn't in this sport.");
    if (input.saveAsAlias) {
      await rememberAliasesOnTeam(ctx, team, [printed.printed], "tidyNames.answerName");
    }
    stored = {
      kind: "linkTeam",
      teamId: team._id,
      by: "operator",
      ...(input.saveAsAlias ? { saveAsAlias: true as const } : {}),
    };
  } else if (input.kind === "notEntity") {
    stored = { kind: "notEntity", by: "operator" };
  } else {
    stored = undefined; // clear
  }

  const unchanged =
    stored === undefined ? row.answer === undefined : sameAnswer(row.answer, stored);
  const prev = row.answer;
  let answerGen = row.answerGen ?? 0;
  // The states a card of this name may be in: what the answer being replaced
  // produced, and whatever an earlier, unfinished fan-out left behind.
  let fanOutFrom: Array<Answer | null> = [];
  if (!unchanged) {
    answerGen += 1;
    fanOutFrom = [prev ?? null];
    for (const state of row.fanOutFrom ?? []) {
      if (!fanOutFrom.some((seen) => sameState(seen, state))) fanOutFrom.push(state);
    }
    fanOutFrom = fanOutFrom.slice(0, FAN_OUT_STATES_MAX);
    const patch: Partial<Doc<"tidyNames">> = {
      answer: stored,
      answerGen,
      fanOutFrom,
      answeredByUserId: stored ? userId : undefined,
      answeredAt: stored ? Date.now() : undefined,
      ...(sportPatch ? { sportId: sportPatch } : {}),
    };
    // Changing an auto answer back keeps the old pick as the preselect (item 15).
    if (stored === undefined && prev?.kind === "linkPlayer" && prev.by === "auto") {
      const player = await ctx.db.get(prev.playerId);
      const sport = player ? await ctx.db.get(player.sportId) : null;
      if (player && sport) {
        patch.enrichment = {
          ...(row.enrichment ?? {}),
          preselect: {
            playerId: player._id,
            name: player.name,
            sportId: player.sportId,
            sportValue: sport.value,
            reason: prev.autoReason ?? "setHistory",
          },
        };
      }
    }
    await ctx.db.patch(row._id, patch);
  }

  // The open card, in this transaction.
  const ref: PrintedRef = {
    kind,
    nameNormalized: key,
    printed: printed.printed,
    order: printed.order,
  };
  const change = changeOf(stored);
  const plan = planNameChange(card, ref, change, "any", {
    unlinkedBefore: unlinkedBeforeCount(card, printedRows, ref),
    previousAnswer: prev,
  });
  if (plan.status === "skipped") {
    throw new ConvexError("This card can't carry any more of those.");
  }
  if (plan.status === "changed") {
    await writeNameChange(ctx, card, plan.fields, newNameWriteCache(ctx), userId);
  }

  let fanOutScheduled = false;
  if (!unchanged) {
    const printers = await listPrintersOfName(
      ctx,
      { scopeId, kind, nameNormalized: key },
      2,
    );
    if (printers.some((p) => p.cardChecklistId !== card._id)) {
      await ctx.scheduler.runAfter(0, internal.tidyNames.fanOut, {
        scopeId,
        kind,
        nameNormalized: key,
        gen: answerGen,
        fromStates: fanOutFrom,
        change,
        openCardId: card._id,
        userId,
      });
      fanOutScheduled = true;
    } else if (fanOutFrom.length > 0) {
      // Nobody else printed it: no job is owed, and none is left to clear this.
      await ctx.db.patch(row._id, { fanOutFrom: undefined });
    }
  }
  return { answerGen, fanOutScheduled };
}

/**
 * Answer a printed name for every card in its scope.
 *
 * The open card is patched in this transaction; other cards that printed the
 * name are written by the scheduled `fanOut` (50 a page, compare-and-set,
 * skipping `cardOverride`, stopping when `answerGen` moves on). Idempotent:
 * the same answer twice writes nothing the second time.
 */
export const answerName = mutation({
  args: {
    cardId: v.id("cardChecklist"),
    kind: tidyNameKindValidator,
    name: v.string(),
    answer: tidyAnswerInputValidator,
  },
  returns: v.object({ answerGen: v.number(), fanOutScheduled: v.boolean() }),
  handler: async (ctx, args) => {
    const userId = await requireAdmin(ctx);
    const target = await resolveName(ctx, args.cardId, args.kind, args.name);
    return applyAnswer(ctx, userId, target, args.answer);
  },
});

/** The Wikidata career teams the operator can untick is capped at the lookup's own 64. */
export const MAX_EXCLUDED_CAREER_TEAM_NAMES = 64;

/**
 * NEO-212 / NEO-645: validate and normalize the Wikidata career-team labels the
 * operator unticked before "Add as new player". Trims, drops a duplicate (by the
 * shared name matcher, so "Montréal Expos" and "Montreal Expos" are one), and
 * refuses a blank, an over-long or an over-many list. `ConvexError`, with the
 * count or length and never the name: a team name reaches Sentry and the console.
 * Returns the normalized keys.
 */
export function normalizeExcludedCareerTeamNames(names: ReadonlyArray<string>): Set<string> {
  if (names.length > MAX_EXCLUDED_CAREER_TEAM_NAMES) {
    throw new ConvexError(
      `${names.length} career teams were unticked; the limit is ${MAX_EXCLUDED_CAREER_TEAM_NAMES}.`,
    );
  }
  const keys = new Set<string>();
  for (const raw of names) {
    const name = raw.trim().replace(/\s+/g, " ");
    if (name.length === 0) throw new ConvexError("An unticked career team has no name.");
    if (name.length > MAX_TEAM_NAME_LENGTH) {
      throw new ConvexError(
        `A team name is ${name.length} characters; the limit is ${MAX_TEAM_NAME_LENGTH}.`,
      );
    }
    keys.add(normalizeEntityName(name));
  }
  return keys;
}

/**
 * Add as new player. Creates the player from the row's lookup (career teams
 * matched, never created: NEO-236), then answers exactly as a link would, and
 * records `newPlayerCareer` on THIS card only.
 *
 * `excludedCareerTeamNames` (additive, NEO-212): the Wikidata career teams the
 * operator unticked. Matching is by the shared name matcher, so an unticked
 * stint never reaches `teamYears`.
 *
 * `addSetSport` (additive): the player is created in the row's sport and also
 * plays the set's (NEO-313).
 */
export const createPlayer = mutation({
  args: {
    cardId: v.id("cardChecklist"),
    name: v.string(),
    oneNamePlayer: v.optional(v.literal(true)),
    addSetSport: v.optional(v.literal(true)),
    excludedCareerTeamNames: v.optional(v.array(v.string())),
  },
  returns: v.object({ playerId: v.id("players"), answerGen: v.number() }),
  handler: async (ctx, args) => {
    const userId = await requireAdmin(ctx);
    const target = await resolveName(ctx, args.cardId, "player", args.name);
    return createPlayerOnTarget(ctx, userId, target, args);
  },
});

/**
 * The body of Add as new player, once the name is resolved to a card, its printed
 * row and its name row. `createPlayer` and the bulk "Add all new players"
 * (`tidyNewPlayers`) both end here, so a player added in bulk is created, matched
 * to career teams, sported and answered exactly as one added from its card.
 * Every refusal happens before the first write.
 */
export async function createPlayerOnTarget(
  ctx: MutationCtx,
  userId: string,
  target: Awaited<ReturnType<typeof resolveName>>,
  args: {
    name: string;
    oneNamePlayer?: true;
    addSetSport?: true;
    excludedCareerTeamNames?: string[];
    /**
     * Created by "Add all new players". The operator is not on this card, so a
     * player Wikidata gave no career for is a purple note, not a blue check.
     */
    bulk?: true;
  },
): Promise<{ playerId: Id<"players">; answerGen: number }> {
  const { row, scopeId, card } = target;
  if (row.answer) {
    throw new ConvexError("This name already has an answer. Change it first.");
  }
  // NEO-643 (career-check's `cleanNewPlayerName`, ported): the name a new player
  // is stored under is cleansed (stray backslash, soft hyphen, zero-width and
  // other invisible characters gone, whitespace collapsed) like every external name.
  const name = cleanseExternalName(args.name);
  if (name.length > MAX_PLAYER_NAME_LENGTH) {
    throw new ConvexError(
      `A player name is ${name.length} characters; the limit is ${MAX_PLAYER_NAME_LENGTH}.`,
    );
  }
  // NEO-463: a one-word name that is part of a fuller-named player is refused
  // unless the operator confirmed a one-name player. Nothing is written first.
  await assertNotNameFragment(ctx, name, row.sportId, args.oneNamePlayer);
  const excluded = normalizeExcludedCareerTeamNames(args.excludedCareerTeamNames ?? []);

  const enrichment = row.enrichment;
  const teamYearByKey = new Map<
    string,
    { teamId: Id<"teams">; fromYear: number; toYear?: number }
  >();
  for (const ct of enrichment?.careerTeams ?? []) {
    // NEO-212: a team the operator unticked is never matched.
    if (excluded.has(normalizeEntityName(ct.name))) continue;
    // Match only (NEO-236): a stint at a team nobody reviewed is dropped, not invented.
    const { teamId } = await resolveTeamForSetYear(ctx, row.sportId, ct.name, ct.fromYear);
    if (!teamId) continue;
    teamYearByKey.set(`${teamId}|${ct.fromYear}`, {
      teamId,
      fromYear: ct.fromYear,
      ...(ct.toYear !== undefined ? { toYear: ct.toYear } : {}),
    });
  }
  const teamYears = sortTeamYears(Array.from(teamYearByKey.values()));
  const playerId = await ctx.db.insert("players", {
    name,
    nameNormalized: normalizeEntityName(name),
    sportId: row.sportId,
    createdByUserId: userId,
    lastUpdated: Date.now(),
    ...(teamYears.length ? { teamYears } : {}),
    ...(enrichment?.isHallOfFame !== undefined ? { isHallOfFame: enrichment.isHallOfFame } : {}),
    // NEO-254: the lookup's birthYear is deliberately not written. It is what
    // tells two same-name people apart, and a Wikidata year for a name the
    // operator just said is NEW would be the previous person's.
    ...(enrichment?.wikidataId ? { externalIds: { wikidataId: enrichment.wikidataId } } : {}),
  });
  console.log(
    JSON.stringify({ msg: "tidy_player_created", playerId, sportId: row.sportId, userId }),
  );
  if (args.addSetSport) {
    const setSportId = await findSportForSelectorOption(ctx, scopeId);
    const created = await ctx.db.get(playerId);
    if (created && setSportId && created.sportId !== setSportId) {
      await addPlayerSport(ctx, created, setSportId);
    }
  }
  const result = await applyAnswer(ctx, userId, target, {
    kind: "linkPlayer",
    playerId,
    ...(args.addSetSport ? { addSetSport: true as const } : {}),
  });
  // Only THIS card shows the new player's career as blue. A player added in bulk
  // with no career from Wikidata is a purple note instead (near-universal for
  // rookies; a hundred of them must not be a hundred stops). A career Wikidata
  // did give stays blue: that one is worth a look.
  const noCareer =
    (enrichment?.careerTeams ?? []).length === 0 &&
    (enrichment?.undatedCareerTeams ?? []).length === 0;
  const kind = args.bulk && noCareer ? ("newPlayerNoCareer" as const) : ("newPlayerCareer" as const);
  const fresh = await ctx.db.get(card._id);
  if (fresh) {
    const checks = [...(fresh.tidyChecks ?? [])];
    if (!checks.some((c) => c.kind === kind && c.playerId === playerId)) {
      checks.push({ kind, playerId });
      await ctx.db.patch(card._id, { tidyChecks: checks.slice(-TIDY_CHECKS_MAX) });
    }
  }
  return { playerId, answerGen: result.answerGen };
}

// ─── fan-out ────────────────────────────────────────────────────────────────

const fanOutArgs = {
  scopeId: v.id("selectorOptions"),
  kind: tidyNameKindValidator,
  nameNormalized: v.string(),
  gen: v.number(),
  fromAnswer: v.optional(tidyNameAnswerValidator),
  // The states a card may be in (newest first, `null` = unanswered): the
  // replaced answer's, plus an earlier job's that went stale part-way.
  fromStates: v.optional(v.array(v.union(tidyNameAnswerValidator, v.null()))),
  change: changeValidator,
  openCardId: v.id("cardChecklist"),
  userId: v.string(),
};

export type FanOutPageArgs = {
  scopeId: Id<"selectorOptions">;
  kind: "player" | "team";
  nameNormalized: string;
  gen: number;
  fromAnswer?: Answer;
  fromStates?: Array<Answer | null>;
  change: NameChange;
  openCardId: Id<"cardChecklist">;
  userId: string;
  cursor: string | null;
};

/**
 * One page of the fan-out. Exported as a plain function so a test can hand it
 * a counting `ctx` (the per-card measurement below `FAN_OUT_PAGE_SIZE`).
 *
 * Stops (`stale`) when the row is gone or its `answerGen` is not the job's: a
 * newer answer has its own job. Each card is re-read and re-checked
 * (compare-and-set against `fromAnswer`), and a `cardOverride` printed row is
 * never touched.
 */
export async function fanOutPageImpl(
  ctx: MutationCtx,
  args: FanOutPageArgs,
  cache: NameWriteCache = newNameWriteCache(ctx),
): Promise<{
  done: boolean;
  stale: boolean;
  cursor: string | null;
  applied: number;
  skipped: number;
}> {
  const row = await readRow(ctx, args.scopeId, args.kind, args.nameNormalized);
  if (!row || (row.answerGen ?? 0) !== args.gen) {
    return { done: true, stale: true, cursor: null, applied: 0, skipped: 0 };
  }
  const page = await pagePrintersOfName(
    ctx,
    { scopeId: args.scopeId, kind: args.kind, nameNormalized: args.nameNormalized },
    { numItems: FAN_OUT_PAGE_SIZE, cursor: args.cursor },
  );
  const states: Array<Answer | null> = args.fromStates ?? [args.fromAnswer ?? null];
  let applied = 0;
  let skipped = 0;
  for (const printed of page.page) {
    if (printed.cardOverride || printed.cardChecklistId === args.openCardId) {
      skipped += printed.cardOverride ? 1 : 0;
      continue;
    }
    const card = await ctx.db.get(printed.cardChecklistId);
    if (!card) continue;
    const ref: PrintedRef = {
      kind: args.kind,
      nameNormalized: args.nameNormalized,
      printed: printed.printed,
      order: printed.order,
    };
    const rows =
      args.change.kind === "linkPlayer" ? await listCardPrintedNames(ctx, card._id) : [];
    // Compare-and-set against every state the card may legitimately be in; a
    // card in none of them was changed by hand and is left alone.
    let plan: ReturnType<typeof planNameChange> = { status: "skipped" };
    for (const state of states) {
      plan = planNameChange(
        card,
        ref,
        args.change,
        { answer: state ?? undefined },
        { unlinkedBefore: unlinkedBeforeCount(card, rows, ref), previousAnswer: state ?? undefined },
      );
      if (plan.status !== "skipped") break;
    }
    if (plan.status === "changed") {
      await writeNameChange(ctx, card, plan.fields, cache, args.userId);
      applied += 1;
    } else {
      skipped += 1;
    }
  }
  // The last page of the CURRENT answer's job: every older state is cleared.
  if (page.isDone && row.fanOutFrom !== undefined) {
    await ctx.db.patch(row._id, { fanOutFrom: undefined });
  }
  return {
    done: page.isDone,
    stale: false,
    cursor: page.isDone ? null : page.continueCursor,
    applied,
    skipped,
  };
}

export const fanOutPage = internalMutation({
  args: { ...fanOutArgs, cursor: v.union(v.string(), v.null()) },
  returns: v.object({
    done: v.boolean(),
    stale: v.boolean(),
    cursor: v.union(v.string(), v.null()),
    applied: v.number(),
    skipped: v.number(),
  }),
  handler: async (ctx, args) => fanOutPageImpl(ctx, args),
});

const FAN_OUT_MAX_PAGES = 400;

/** Drives the pages (the shape of `cascadeAutographFormat`). */
export const fanOut = internalAction({
  args: fanOutArgs,
  returns: v.null(),
  handler: async (ctx, args) => {
    let cursor: string | null = null;
    for (let i = 0; i < FAN_OUT_MAX_PAGES; i++) {
      const res: { done: boolean; stale: boolean; cursor: string | null } =
        await ctx.runMutation(internal.tidyNames.fanOutPage, { ...args, cursor });
      if (res.done) return null;
      if (res.cursor === cursor) throw new Error("tidyNames.fanOut: cursor did not advance");
      cursor = res.cursor;
    }
    throw new Error(`tidyNames.fanOut: did not finish within ${FAN_OUT_MAX_PAGES} pages`);
  },
});

// ─── sport, lookups ─────────────────────────────────────────────────────────

/** Bump the generation and ask the pool for a lookup, after this write. */
async function scheduleLookup(
  ctx: MutationCtx,
  row: Doc<"tidyNames">,
  patch: Partial<Doc<"tidyNames">>,
): Promise<void> {
  const gen = (row.lookupGen ?? 0) + 1;
  await ctx.db.patch(row._id, {
    ...patch,
    status: "pending",
    lookupGen: gen,
    lookupRequestedAt: Date.now(),
  });
  await ctx.scheduler.runAfter(0, internal.wikidataPool.enqueueTidyNameLookups, {
    items: [{ rowId: row._id, gen }],
  });
}

/**
 * The Sport chip (NEO-313). Re-points the row's sport, clears its lookup and
 * asks again under the new sport, unless the name is a same-name choice there
 * (NEO-332). An answered row is refused: the answer was about the old sport.
 */
export const setNameSport = mutation({
  args: {
    cardId: v.id("cardChecklist"),
    kind: tidyNameKindValidator,
    name: v.string(),
    sportId: v.id("selectorOptions"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const { row, scopeId } = await resolveName(ctx, args.cardId, args.kind, args.name);
    if (row.answer) throw new ConvexError("Change this answer before changing the sport.");
    const sport = await ctx.db.get(args.sportId);
    if (!sport || sport.level !== "sport") throw new ConvexError("Pick a sport.");
    if (row.sportId === args.sportId) return null;

    const born =
      row.kind === "player"
        ? await buildExistingPlayerCandidates(ctx, row.name, args.sportId, {
            cardYear: await findSetYearForSelectorOption(ctx, scopeId),
          })
        : [];
    const enrichment: Enrichment | undefined =
      born.length > 0 ? { existingCandidates: born } : undefined;
    if (row.kind === "player" && isSameNameChoice(enrichment)) {
      await ctx.db.patch(row._id, {
        sportId: args.sportId,
        status: "ready",
        enrichment,
        lookupGen: (row.lookupGen ?? 0) + 1,
        lookupRequestedAt: Date.now(),
      });
      return null;
    }
    await scheduleLookup(ctx, row, { sportId: args.sportId, enrichment });
    return null;
  },
});

/**
 * A name row nobody has asked Wikidata about: born (or migrated: M2) `ready`
 * with nothing on it. A row whose lookup ran and found nothing has a
 * generation or a request time, so it is never asked twice from here.
 */
export const neverLooked = (row: Doc<"tidyNames">): boolean =>
  row.status === "ready" &&
  !row.answer &&
  row.enrichment === undefined &&
  // A name the gate offered candidates for is a choice, not an unasked name.
  (row.candidateTeamIds?.length ?? 0) === 0 &&
  row.candidatePlace === undefined &&
  (row.lookupGen ?? 0) === 0 &&
  row.lookupRequestedAt === undefined;

/**
 * Ask Wikidata about a player name that was born `ready`: "Add as new player
 * anyway", and (the walk opening a card) a name migrated with no lookup at all.
 */
export const requestLookup = mutation({
  args: {
    cardId: v.id("cardChecklist"),
    kind: tidyNameKindValidator,
    name: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    if (args.kind !== "player") throw new ConvexError("Only a player name has a lookup to ask for.");
    const { row } = await resolveName(ctx, args.cardId, "player", args.name);
    if (row.answer) throw new ConvexError("Change this answer before looking it up.");
    // Already looked up (or looking): the tile shows what it has.
    const awaits =
      row.status === "ready" &&
      awaitsOperatorBeforeLookup(row.enrichment) &&
      row.enrichment?.wikidataId === undefined;
    if (!awaits && !neverLooked(row)) return null;
    await scheduleLookup(ctx, row, {});
    return null;
  },
});

/**
 * The scope a card's name lookups live in: where its printed names are
 * answered (a parallel copy keeps its source leaf), else its own leaf.
 */
async function lookupScopeOf(
  ctx: Pick<QueryCtx, "db">,
  card: Doc<"cardChecklist">,
): Promise<Id<"selectorOptions">> {
  const [first] = await listCardPrintedNames(ctx, card._id);
  return first ? resolveScopeLeaf(ctx, first, card.selectorOptionId) : card.selectorOptionId;
}

/**
 * NEO-645 — ask for a team lookup by name, for a team that is NOT printed on the
 * card: a Wikidata career team the operator is about to create from the Career
 * tile. It is the same `tidyNames` team row, lookup and pool lane a printed team
 * name uses (league, colours, era, location, ESPN id), so the New team form can
 * be pre-filled the way a printed name's is.
 *
 * Assistive and free of side effects on the card: the row is never answered and
 * nothing reads it but `teamLookup`. An existing row (a printed team of the same
 * name, or an earlier ask) is reused and never looked up again, except one that
 * was never looked up at all (migrated `ready` with nothing on it: M2).
 */
export const requestTeamLookup = mutation({
  args: {
    cardId: v.id("cardChecklist"),
    name: v.string(),
    sportId: v.id("selectorOptions"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const name = cleanName(args.name);
    const card = await ctx.db.get(args.cardId);
    if (!card) throw new ConvexError("That card is gone. Refresh and try again.");
    const sport = await ctx.db.get(args.sportId);
    if (!sport || sport.level !== "sport") throw new ConvexError("Pick a sport.");
    const scopeId = await lookupScopeOf(ctx, card);
    const key = normalizeEntityName(name);
    if (!key) throw new ConvexError("A name is required.");
    const before = await readRow(ctx, scopeId, "team", key);
    if (before) {
      // A printed team a migration left `ready` with no lookup, or whose lookup
      // output expired (`sweepExpiredLookupOutput`): ask it again, once.
      if (neverLooked(before)) await scheduleLookup(ctx, before, {});
      return null;
    }
    const row = await ensureTidyNameRow(ctx, {
      scopeId,
      kind: "team",
      name,
      sportId: args.sportId,
      setYear: undefined,
    });
    await scheduleLookup(ctx, row, {});
    return null;
  },
});

/** What the team lookup for `name` has found, for the New team form. Null: none asked for. */
export const teamLookup = query({
  args: { cardId: v.id("cardChecklist"), name: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      status: tidyLookupStatusValidator,
      enrichment: v.optional(tidyNameEnrichmentValidator),
    }),
  ),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const name = args.name.trim();
    if (name.length === 0 || name.length > MAX_TIDY_NAME_LENGTH) return null;
    const key = normalizeEntityName(name);
    if (!key) return null;
    const card = await ctx.db.get(args.cardId);
    if (!card) return null;
    const scopeId = await lookupScopeOf(ctx, card);
    const row = await ctx.db
      .query("tidyNames")
      .withIndex("by_scope_kind_name", (q) =>
        q.eq("scopeId", scopeId).eq("kind", "team").eq("nameNormalized", key),
      )
      .first();
    if (!row) return null;
    return { status: row.status, ...(row.enrichment ? { enrichment: row.enrichment } : {}) };
  },
});

/** The names in a scope whose Wikidata lookup has not finished. */
export const lookupsPending = query({
  args: { scopeId: v.id("selectorOptions") },
  returns: v.object({
    names: v.array(v.object({ kind: tidyNameKindValidator, nameNormalized: v.string() })),
    more: v.boolean(),
  }),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const rows = await ctx.db
      .query("tidyNames")
      .withIndex("by_scope_status", (q) => q.eq("scopeId", args.scopeId).eq("status", "pending"))
      .take(LOOKUPS_PENDING_RETURN_MAX + 1);
    return {
      names: rows
        .slice(0, LOOKUPS_PENDING_RETURN_MAX)
        .map((r) => ({ kind: r.kind, nameNormalized: r.nameNormalized })),
      more: rows.length > LOOKUPS_PENDING_RETURN_MAX,
    };
  },
});

// ─── the Wikidata side ──────────────────────────────────────────────────────

/** What the lookup action reads. Null when the row is gone or answered. */
export const getForLookup = internalQuery({
  args: { id: v.id("tidyNames") },
  returns: v.union(
    v.null(),
    v.object({
      kind: tidyNameKindValidator,
      name: v.string(),
      sportId: v.id("selectorOptions"),
      status: tidyLookupStatusValidator,
      lookupGen: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row) return null;
    return {
      kind: row.kind,
      name: row.name,
      sportId: row.sportId,
      status: row.status,
      lookupGen: row.lookupGen ?? 0,
    };
  },
});

/**
 * A lookup result lands. Dropped when the row is gone, answered (nothing reads
 * the enrichment any more), asking another question (`gen` or `sportId`
 * moved), or when an error would downgrade a team's partial ESPN answer.
 */
export const applyLookupResult = internalMutation({
  args: {
    id: v.id("tidyNames"),
    gen: v.number(),
    status: v.union(v.literal("ready"), v.literal("error")),
    enrichment: v.optional(v.any()),
    sportId: v.optional(v.id("selectorOptions")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row || row.answer) return null;
    if ((row.lookupGen ?? 0) !== args.gen) return null;
    if (args.sportId !== undefined && args.sportId !== row.sportId) return null;
    const incoming = pickEnrichment(args.enrichment as Record<string, unknown> | undefined);
    const priorTeam = row.kind === "team" && row.status === "ready" ? row.enrichment : undefined;
    if (priorTeam && args.status === "error") return null;

    const liveCandidates =
      row.kind === "player"
        ? await buildExistingPlayerCandidates(ctx, row.name, row.sportId, {
            cardYear: await findSetYearForSelectorOption(ctx, row.scopeId),
          })
        : [];
    // What the GATE put on the row survives the lookup: history candidates
    // (stamped `sportValue`, not re-derivable from the name index) lead, the
    // live ones follow, and the preselect is carried over (NEO-424).
    const history = (row.enrichment?.existingCandidates ?? []).filter(
      (c) => c.sportValue !== undefined,
    );
    const historyIds = new Set(history.map((c) => c.playerId as string));
    const existingCandidates = [
      ...history,
      ...liveCandidates.filter((c) => !historyIds.has(c.playerId as string)),
    ];
    const preselect = row.kind === "player" ? row.enrichment?.preselect : undefined;
    let looked: Enrichment | undefined;
    if (existingCandidates.length > 0) looked = { ...(incoming ?? {}), existingCandidates };
    else if (priorTeam && incoming) looked = overlay(priorTeam, incoming);
    else looked = incoming;
    const enrichment = preselect ? { ...(looked ?? {}), preselect } : looked;
    await ctx.db.patch(args.id, { status: args.status, enrichment });
    return null;
  },
});

/** A later team lookup over the partial answer already on the row (NEO-301). */
function overlay(prior: Enrichment, next: Enrichment): Enrichment {
  const merged: Record<string, unknown> = { ...prior };
  for (const [key, value] of Object.entries(next)) if (value !== undefined) merged[key] = value;
  if (prior.colors || next.colors) merged.colors = { ...(prior.colors ?? {}), ...(next.colors ?? {}) };
  return merged as Enrichment;
}

/**
 * The workpool completion backstop: a row can never be stranded on `pending`.
 * A plain function so tests can drive it without mounting the component.
 */
export async function backstopLookupRowImpl(
  ctx: MutationCtx,
  context: { tidyNameId: Id<"tidyNames">; gen: number },
  result: RunResult,
): Promise<null> {
  const row = await ctx.db.get(context.tidyNameId);
  if (!row) return null;
  if (row.status !== "pending" || row.answer) return null;
  if ((row.lookupGen ?? 0) !== context.gen) return null;
  console.warn(
    JSON.stringify({
      msg: "tidy_name_lookup_backstopped",
      rowId: row._id,
      resultKind: result.kind,
    }),
  );
  await ctx.db.patch(row._id, { status: "error" });
  return null;
}

/** Cron: age pending rows past `LOOKUP_STALE_MS` (from the request time) to error. */
export const sweepStaleLookups = internalMutation({
  args: {},
  returns: v.object({ aged: v.number(), done: v.boolean() }),
  handler: async (ctx) => {
    const cutoff = Date.now() - LOOKUP_STALE_MS;
    const stale = await ctx.db
      .query("tidyNames")
      .withIndex("by_status_requested", (q) =>
        q.eq("status", "pending").lt("lookupRequestedAt", cutoff),
      )
      .take(LOOKUP_SWEEP_CHUNK);
    for (const row of stale) await ctx.db.patch(row._id, { status: "error" });
    const done = stale.length < LOOKUP_SWEEP_CHUNK;
    if (!done) await ctx.scheduler.runAfter(0, internal.tidyNames.sweepStaleLookups, {});
    return { aged: stale.length, done };
  },
});

/**
 * How long Wikidata output may sit on a name row (Jason: "I don't want to store
 * that data for anything longer than necessary"). Main's queue rows were deleted
 * at the commit and, when a session was abandoned, by the hourly reaper after
 * 24 hours (`ENTITY_REVIEW_ABANDONED_MS`, `sweepAbandonedBatches`); the rows
 * here outlive the commit because the walk answers them card by card, so the
 * same hourly reaper and the same day apply, counted from the lookup.
 */
export const LOOKUP_OUTPUT_TTL_MS = 24 * 60 * 60 * 1000;
/** Rows one `sweepExpiredLookupOutput` run reads per status. */
export const LOOKUP_OUTPUT_SWEEP_CHUNK = 100;

/** The `enrichment` keys that are Wikidata's (or ESPN's) output, not NB data. */
export const LOOKUP_OUTPUT_KEYS = [
  "wikidataId",
  "careerTeams",
  "undatedCareerTeams",
  "isHallOfFame",
  "description",
  "birthYear",
  "enwikiTitle",
  "league",
  "leagueWikidataId",
  "location",
  "yearsActive",
  "colors",
  "espnId",
] as const;

/** Does this enrichment carry anything a lookup found? */
export function hasLookupOutput(enrichment: Enrichment | undefined): boolean {
  return !!enrichment && LOOKUP_OUTPUT_KEYS.some((key) => enrichment[key] !== undefined);
}

/** The enrichment without the lookup's output: what the gate itself put there (same-name choice, preselect). */
export function withoutLookupOutput(enrichment: Enrichment | undefined): Enrichment | undefined {
  if (!enrichment) return undefined;
  const kept: Record<string, unknown> = { ...enrichment };
  for (const key of LOOKUP_OUTPUT_KEYS) delete kept[key];
  return Object.keys(kept).length > 0 ? (kept as Enrichment) : undefined;
}

/**
 * Cron target (crons.ts, hourly like main's reaper): forget Wikidata output
 * that is a day old.
 *
 * A row whose lookup was stamped (`lookupRequestedAt`) more than
 * `LOOKUP_OUTPUT_TTL_MS` ago loses what the lookup found: the Wikidata keys of
 * its enrichment, its status, its generation and its stamp. It goes back to the
 * state of a name nobody has asked about (`neverLooked`), so the next time the
 * operator needs the lookup it is asked again through the ordinary path
 * (`requestLookup`, which the open card does for a never-looked name).
 *
 * KEPT: the answer and everything about it (`answerGen`, `fanOutFrom`, who and
 * when), the sport, the gate's own facts (a same-name choice's candidates and
 * a preselect are NB players, not Wikidata output; `candidateTeamIds` and
 * `candidatePlace` are NB team rows). An operator's ruling is an answer, so it
 * stays. A row still `pending` is left to `sweepStaleLookups`.
 *
 * A row nobody answered and no card prints (the lookup rows `requestTeamLookup`
 * makes for a career team, or a name whose cards are gone) has nothing left to
 * hold, and is deleted.
 *
 * Only rows with a stamp older than the cutoff are read (an index range on
 * `status` and the stamp), and every row it touches leaves that range (the
 * stamp is cleared or the row deleted), so each run starts from the top, a run
 * that finds nothing stale reads nothing, and a second run changes nothing. A
 * full chunk schedules another.
 */
export const sweepExpiredLookupOutput = internalMutation({
  args: {},
  returns: v.object({ cleared: v.number(), deleted: v.number(), done: v.boolean() }),
  handler: async (ctx) => {
    const cutoff = Date.now() - LOOKUP_OUTPUT_TTL_MS;
    let cleared = 0;
    let deleted = 0;
    let full = false;
    for (const status of ["ready", "error"] as const) {
      // `gt 0` keeps rows with no stamp (born ready, never asked) out of the range.
      const stale = await ctx.db
        .query("tidyNames")
        .withIndex("by_status_requested", (q) =>
          q.eq("status", status).gt("lookupRequestedAt", 0).lt("lookupRequestedAt", cutoff),
        )
        .take(LOOKUP_OUTPUT_SWEEP_CHUNK);
      if (stale.length === LOOKUP_OUTPUT_SWEEP_CHUNK) full = true;
      for (const row of stale) {
        if (row.answer === undefined) {
          const printers = await listPrintersOfName(
            ctx,
            { scopeId: row.scopeId, kind: row.kind, nameNormalized: row.nameNormalized },
            1,
          );
          if (printers.length === 0) {
            await ctx.db.delete(row._id);
            deleted += 1;
            continue;
          }
        }
        await ctx.db.patch(row._id, {
          enrichment: withoutLookupOutput(row.enrichment),
          status: "ready",
          lookupGen: undefined,
          lookupRequestedAt: undefined,
        });
        cleared += 1;
      }
    }
    if (full) await ctx.scheduler.runAfter(0, internal.tidyNames.sweepExpiredLookupOutput, {});
    return { cleared, deleted, done: !full };
  },
});

/**
 * After the commit finalizes (schema doc 4b): enqueue the lookup of every
 * pending row in the scope that has not been enqueued (`lookupGen` 0). The gate
 * wrote them at gen 0 so the pool never patches a row the prelude is reading.
 *
 * One page per call, walked with a real cursor (NEO-645). A queued row STAYS
 * `pending` (the lookup answers it later), so a `.take()` of the index re-read
 * the same first page every time and a scope with 217 pending names queued 100.
 * The cursor moves past a page whether or not its rows were queued, and the
 * function reschedules itself with the cursor until the walk is done, so every
 * pending name is queued exactly once and a second walk queues none.
 */
export const enqueuePendingLookups = internalMutation({
  args: { scopeId: v.id("selectorOptions"), cursor: v.optional(v.string()) },
  returns: v.number(),
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("tidyNames")
      .withIndex("by_scope_status", (q) => q.eq("scopeId", args.scopeId).eq("status", "pending"))
      .paginate({ numItems: ENQUEUE_PAGE, cursor: args.cursor ?? null });
    const items: Array<{ rowId: Id<"tidyNames">; gen: number }> = [];
    for (const row of page.page) {
      if ((row.lookupGen ?? 0) > 0) continue;
      await ctx.db.patch(row._id, { lookupGen: 1, lookupRequestedAt: Date.now() });
      items.push({ rowId: row._id, gen: 1 });
    }
    if (items.length > 0) {
      await ctx.scheduler.runAfter(0, internal.wikidataPool.enqueueTidyNameLookups, { items });
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.tidyNames.enqueuePendingLookups, {
        scopeId: args.scopeId,
        cursor: page.continueCursor,
      });
    }
    return items.length;
  },
});

// ─── the gate's upsert ──────────────────────────────────────────────────────

/**
 * NEO-643 (startBatch's cleanse, ported) — every name the gate hands in is
 * cleansed (`cleanseExternalName`: BSC's "R\ios" for Ríos, soft hyphens,
 * zero-width characters) before it is keyed, stored or shown. The caller
 * refuses a name longer than `MAX_PLAYER_NAME_LENGTH` on the RAW text, but
 * cleansing composes to NFC, which can lengthen a string (U+0958 composes to
 * two characters), so the bound is applied again to what is about to be stored.
 * Refused by length and position, never by echoing the name, and before the
 * first write. Idempotent, so a re-called page converges on the same rows.
 */
export function cleansedGateNames(items: ReadonlyArray<{ kind: string; name: string }>): string[] {
  return items.map((item, index) => {
    const name = cleanseExternalName(item.name);
    if (name.length > MAX_PLAYER_NAME_LENGTH) {
      throw new Error(
        `upsertFromGatePage: the ${item.kind} name at index ${index} is ${name.length} characters once cleansed; the limit is ${MAX_PLAYER_NAME_LENGTH}.`,
      );
    }
    return name;
  });
}

/**
 * The review gate writes its facts as rows (schema doc 4a). Idempotent and
 * convergent, so the driving action re-calls with the remainder when the budget
 * runs out and a re-fetch converges on the same rows:
 *
 *  - an OPERATOR answer is never touched (a fetch's `resetForRefetch` has
 *    already cleared every earlier one but a "not an entity" ruling, so what
 *    stands here is this fetch's own, or a ruling main also kept);
 *  - an `auto` answer is replaced with the fresh fact, or cleared when the gate
 *    no longer has one;
 *  - an unanswered row still `pending` is left alone; otherwise its preselect,
 *    candidates and team candidates are refreshed;
 *  - a new row is born `pending` (lookup enqueued AFTER the commit), or `ready`
 *    with no lookup when a same-name choice, a history choice, a preselect or
 *    an auto answer decides it (NEO-332/424).
 *
 * Returns how many leading items it processed (the action passes the rest on)
 * and the ops it spent.
 */
export const upsertFromGatePage = internalMutation({
  args: {
    scopeId: v.id("selectorOptions"),
    items: v.array(gateItemValidator),
  },
  returns: v.object({ processed: v.number(), ops: v.number() }),
  handler: async (ctx, args) => {
    let ops = 0;
    const setYear = await findSetYearForSelectorOption(ctx, args.scopeId);
    ops += 1;
    let processed = 0;
    const cleansed = cleansedGateNames(args.items);
    for (const [index, item] of args.items.entries()) {
      if (ops >= GATE_UPSERT_OPS && processed > 0) break;
      processed += 1;
      const name = cleansed[index].slice(0, MAX_TIDY_NAME_LENGTH);
      const key = normalizeEntityName(name);
      if (!key) continue;
      const existing = await readRow(ctx, args.scopeId, item.kind, key);
      ops += 1;

      // The fact the gate states for this name.
      let answer: Answer | undefined;
      let enrichment: Enrichment | undefined;
      let awaitsChoice = false;
      const auto = item.auto;
      if (auto && item.kind === "player" && auto.playerId) {
        answer = { kind: "linkPlayer", playerId: auto.playerId, by: "auto", autoReason: auto.origin };
        const ids = [
          auto.playerId,
          ...(auto.candidatePlayerIds ?? []).filter((id) => id !== auto.playerId),
        ];
        if (ids.length >= 2) {
          const built = await buildExistingPlayerCandidatesForIds(ctx, ids, {
            name,
            cardYear: setYear,
          });
          ops += Math.min(new Set(ids).size, MAX_CANDIDATES_FOR_IDS) * (2 + PLAYER_DESCRIPTION_MAX_TEAMS);
          if (built.length >= 2) enrichment = { existingCandidates: built };
        }
      } else if (
        auto &&
        item.kind === "team" &&
        auto.teamId &&
        (auto.origin === "setHistory" || auto.origin === "careerTeam")
      ) {
        answer = { kind: "linkTeam", teamId: auto.teamId, by: "auto", autoReason: auto.origin };
      } else if (item.kind === "player") {
        if ((item.historyPlayerIds?.length ?? 0) > 0) {
          const built = await buildExistingPlayerCandidatesForIds(ctx, item.historyPlayerIds!, {
            name,
            cardYear: setYear,
          });
          ops += Math.min(new Set(item.historyPlayerIds).size, MAX_CANDIDATES_FOR_IDS) * (2 + PLAYER_DESCRIPTION_MAX_TEAMS);
          if (built.length > 0) enrichment = { existingCandidates: built };
        }
        if (!enrichment && !item.noExistingMatch) {
          const live = await buildExistingPlayerCandidates(ctx, name, item.sportId, {
            cardYear: setYear,
          });
          ops += NAME_LOOKUP_OPS_BASE + (live.length > 0 ? NAME_LOOKUP_OPS_EXTRA : 0);
          if (live.length > 0) enrichment = { existingCandidates: live };
        }
        if (item.preselect) {
          enrichment = {
            ...(enrichment ?? {}),
            preselect: { ...item.preselect, name },
          };
        }
        awaitsChoice = awaitsOperatorBeforeLookup(enrichment);
      }

      if (existing) {
        if (existing.answer && existing.answer.by !== "auto") continue;
        if (existing.answer?.by === "auto" || existing.answer === undefined) {
          const patch: Partial<Doc<"tidyNames">> = {};
          // A row nobody has looked up (the fetch's reset left it blank, or a
          // migration did) that the gate asks about like a new name is born
          // again: `pending` at generation 0, so it is looked up after the
          // commit exactly as a new row is. A name the gate decides itself
          // (an answer, a same-name choice, a preselect) stays `ready`.
          if (!answer && !awaitsChoice && !existing.answer && neverLooked(existing)) {
            patch.status = "pending";
            patch.lookupGen = 0;
            patch.lookupRequestedAt = Date.now();
          }
          if (answer) {
            if (!sameAnswer(existing.answer, answer)) {
              patch.answer = answer;
              patch.answerGen = (existing.answerGen ?? 0) + 1;
              patch.answeredAt = Date.now();
              patch.sportId = item.sportId;
            }
          } else if (existing.answer) {
            patch.answer = undefined;
            patch.answerGen = (existing.answerGen ?? 0) + 1;
          }
          // An unanswered row still looking is left alone; a settled one is refreshed.
          if (!existing.answer && existing.status !== "pending") {
            if (enrichment) patch.enrichment = enrichment;
            if (item.candidateTeamIds) patch.candidateTeamIds = item.candidateTeamIds;
            if (item.candidatePlace) patch.candidatePlace = true;
          }
          if (answer && enrichment) patch.enrichment = enrichment;
          if (Object.keys(patch).length > 0) {
            await ctx.db.patch(existing._id, patch);
            ops += 1;
          }
        }
        continue;
      }

      await ctx.db.insert("tidyNames", {
        scopeId: args.scopeId,
        kind: item.kind,
        nameNormalized: key,
        name,
        sportId: item.sportId,
        // Born ready when the gate answers it or the operator must choose first.
        status: answer || awaitsChoice ? "ready" : "pending",
        ...(answer || awaitsChoice ? {} : { lookupGen: 0, lookupRequestedAt: Date.now() }),
        ...(enrichment ? { enrichment } : {}),
        ...(item.candidateTeamIds && item.candidateTeamIds.length > 0
          ? { candidateTeamIds: item.candidateTeamIds }
          : {}),
        ...(item.candidatePlace ? { candidatePlace: true as const } : {}),
        ...(answer ? { answer, answerGen: 1, answeredAt: Date.now() } : {}),
      });
      ops += 1;
    }
    return { processed, ops };
  },
});

/** Rows one `resetForRefetch` page reads (and at most patches). */
export const RESET_PAGE = 150;

/**
 * NEO-645 (A17, Jason: "it should refetch all card data and use whatever
 * player/team data exists now. We do not need to keep track of answers.") — a
 * fetch starts from the set's name rows with every earlier answer forgotten.
 *
 * On main a review row lived for one batch and was deleted at the commit, so a
 * later fetch matched names against the players and teams that exist NOW (main's
 * normal rules) and asked again for anything unlinked. Here the rows outlive the
 * commit (the walk answers them card by card), so without this step the commit
 * prelude would read last fetch's operator link as a decision and let it beat
 * the exactly-one match, and the gate's upsert would leave it standing.
 *
 * What a reset row keeps is what main kept: nothing about the name but the one
 * durable ruling main also kept, an operator's "not a player / not a team"
 * (`entityReviewSkips`, NEO-212). Everything else goes back to the shape of a
 * row nobody has asked about: no answer, no Wikidata output, no candidates, no
 * lookup state. `upsertFromGatePage` then re-asks each name the gate still
 * needs (a new `pending` row's worth: looked up after the commit) and re-states
 * every fact the gate still holds (auto-links, history choices, preselects).
 * A name the gate no longer lists (it now matches exactly one player) is left
 * blank, never looked up, and nothing reads it.
 *
 * The row is reset IN PLACE, never deleted: `cardPrintedNames` points at it
 * for the cards that print the name, and an orphaned printed row would answer
 * "That name has nothing to answer." A cleared answer bumps `answerGen`, so a
 * fan-out still running for it stops (its generation no longer matches). The
 * cards themselves are not touched here: the commit that follows rewrites them
 * from the names as they now resolve. `lookupGen` goes back to zero, so a
 * lookup result still in flight for the old question finds a different
 * generation and is dropped.
 *
 * Paged (a scope holds a few hundred to a few thousand name rows); the gate
 * drives it with the cursor until it returns null.
 */
export const resetForRefetch = internalMutation({
  args: {
    scopeId: v.id("selectorOptions"),
    /** The sport the fetch asks its questions in; a blank row asks in it. */
    sportId: v.id("selectorOptions"),
    cursor: v.optional(v.string()),
  },
  returns: v.object({ cursor: v.union(v.string(), v.null()), reset: v.number() }),
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("tidyNames")
      .withIndex("by_scope_kind_name", (q) => q.eq("scopeId", args.scopeId))
      .paginate({ numItems: RESET_PAGE, cursor: args.cursor ?? null });
    let reset = 0;
    for (const row of page.page) {
      // The one ruling that outlives a fetch: an operator's "not an entity".
      if (row.answer?.kind === "notEntity" && row.answer.by === "operator") continue;
      const blank =
        row.answer === undefined &&
        row.status === "ready" &&
        row.enrichment === undefined &&
        row.candidateTeamIds === undefined &&
        row.candidatePlace === undefined &&
        row.lookupGen === undefined &&
        row.lookupRequestedAt === undefined &&
        row.fanOutFrom === undefined &&
        row.answeredByUserId === undefined &&
        row.answeredAt === undefined &&
        row.sportId === args.sportId;
      if (blank) continue;
      await ctx.db.patch(row._id, {
        answer: undefined,
        ...(row.answer !== undefined || row.fanOutFrom !== undefined
          ? { answerGen: (row.answerGen ?? 0) + 1 }
          : {}),
        answeredByUserId: undefined,
        answeredAt: undefined,
        fanOutFrom: undefined,
        enrichment: undefined,
        candidateTeamIds: undefined,
        candidatePlace: undefined,
        status: "ready",
        lookupGen: undefined,
        lookupRequestedAt: undefined,
        sportId: args.sportId,
      });
      reset += 1;
    }
    return { cursor: page.isDone ? null : page.continueCursor, reset };
  },
});

/**
 * NEO-645 — every `kind|nameNormalized` that has a name row in a scope: the
 * commit chunk's "is this printed name indexed" answer, read once per commit
 * instead of once per name per chunk. `null` when the scope holds more rows
 * than one read can prove a negative over (the chunk then point-reads).
 */
export const NAMES_WITH_ROWS_MAX = 2000;
export const namesWithRows = internalQuery({
  args: { scopeId: v.id("selectorOptions") },
  returns: v.union(v.array(v.string()), v.null()),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("tidyNames")
      .withIndex("by_scope_kind_name", (q) => q.eq("scopeId", args.scopeId))
      .take(NAMES_WITH_ROWS_MAX + 1);
    if (rows.length > NAMES_WITH_ROWS_MAX) return null;
    return rows.map((row) => `${row.kind}|${row.nameNormalized}`);
  },
});

/** Every answer in a scope, for the gate and the prelude: one prefix range. */
export const PRELUDE_ANSWER_READ_MAX = 1001;
