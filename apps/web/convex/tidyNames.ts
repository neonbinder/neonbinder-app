/**
 * NEO-645 / NEO-656 — answering a name in One-card Tidy Up.
 *
 * NEO-656 (Jason: "We should not be keeping answers to anything... Any dialogs
 * or interim information needed to do that is simply for the purpose of
 * building the set/card data and should never be stored."): the CARD is the
 * only record of its names. A name is read from the card itself
 * (`pendingPlayerNames`, `pendingTeamNames`, linked players'
 * `playerLinks.nameOnCard`), an answer is written to that one card, and
 * nothing is stored about it. The Wikidata lookup runs on demand
 * (`adapters/wikidata.lookupTidyName`) and its result lives in the walk's
 * memory only.
 *
 * The PUBLIC surface the tiles call:
 *
 *   - `answerName`      Link / Change / Not a player / Not a team / undo, on
 *                       THIS card.
 *   - `createPlayer`    Add as new player, on THIS card.
 *   - `applyNameToAll`  "Apply to all cards printing X": the answer just given
 *                       to the open card, offered to every card of the
 *                       printing level that is STILL WAITING on the name.
 *
 * and the INTERNAL pieces behind them (the paged scan and the paged writes of
 * Apply to all, and the live reads a lookup needs).
 *
 * ## Conventions every public function here follows
 *
 *  - `requireAdmin` first.
 *  - Strings are capped (`MAX_TIDY_NAME_LENGTH`). An over-cap argument is a
 *    `ConvexError` naming the LIMIT, never the value.
 *  - A marketplace name never appears in an error message.
 *
 * ## Apply to all cost
 *
 * See `APPLY_TO_ALL_PAGE_SIZE` and `applyNameToAll`.
 */

import { ConvexError, v, type Infer } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  type MutationCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireAdmin } from "./auth";
import {
  cardHoldsName,
  newNameWriteCache,
  planNameChange,
  printedRefOf,
  writeNameChange,
  type NameChange,
  type StoredAnswer,
} from "./tidyCardWrites";
import { printingLevelLeaves } from "./tidyPrintingLevel";
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
import { assertCareerStintYears, maxCareerYear } from "../lib/players/career-years";
import { isWikidataQid } from "../lib/players/wikidata-id";
import { cleanseExternalName } from "../lib/entities/cleanse-name";
import { normalizeEntityName } from "../lib/entities/normalize-name";

/** Longest printed name accepted, in characters. */
export const MAX_TIDY_NAME_LENGTH = 120;

/**
 * Cards one Apply to all write page changes. Do not shrink: more pages re-run
 * every subscribed `getCardChecklist` more often.
 *
 * What one card costs is MEASURED by `tidyNames.applyToAll.test.ts` (a counting
 * Proxy over `ctx.db`): about 5 database calls a card (3 documents read, 2
 * written), so a page of 50 is about 500 operations (a team link adds the
 * league settle, about 650), inside the ~900-operation band with room for the
 * per-leaf cache fills.
 */
export const APPLY_TO_ALL_PAGE_SIZE = 50;
/** Cards one scan page reads (row- AND byte-bounded; the query stays under 16 MiB). */
export const APPLY_TO_ALL_SCAN_PAGE = 200;
export const APPLY_TO_ALL_SCAN_BYTES = 4 * 1024 * 1024;
/** A leaf this long is not scanned to the end (900 cards is a big leaf). */
const APPLY_TO_ALL_MAX_SCAN_PAGES = 100;

// ─── shapes (moved here from schema.ts: nothing is stored any more) ─────────

/** What a name is: a player's or a team's. */
export const tidyNameKindValidator = v.union(v.literal("player"), v.literal("team"));

/** How a lookup ended. Never stored. */
export const tidyLookupStatusValidator = v.union(v.literal("ready"), v.literal("error"));

/** One same-name player the operator can link instead of creating. */
export const existingCandidateValidator = v.object({
  playerId: v.id("players"),
  name: v.string(),
  birthYear: v.optional(v.number()),
  careerSummary: v.string(),
  activeInSetYear: v.optional(v.boolean()),
  matchedAlias: v.optional(v.string()),
  sportValue: v.optional(v.string()),
});

/** The lookup's payload, held by the walk for the sitting and never stored. */
export const tidyNameEnrichmentValidator = v.object({
  wikidataId: v.optional(v.string()),
  careerTeams: v.optional(
    v.array(
      v.object({
        name: v.string(),
        fromYear: v.number(),
        toYear: v.optional(v.number()),
        wikidataId: v.optional(v.string()),
      }),
    ),
  ),
  undatedCareerTeams: v.optional(v.array(v.string())),
  isHallOfFame: v.optional(v.boolean()),
  description: v.optional(v.string()),
  birthYear: v.optional(v.number()),
  enwikiTitle: v.optional(v.string()),
  existingCandidates: v.optional(v.array(existingCandidateValidator)),
  preselect: v.optional(
    v.object({
      playerId: v.id("players"),
      name: v.string(),
      sportId: v.id("selectorOptions"),
      sportValue: v.string(),
      reason: v.union(
        v.literal("priorYearProduct"),
        v.literal("onlyNamesake"),
        v.literal("setHistory"),
        v.literal("hallOfFame"),
        v.literal("careerTeam"),
      ),
    }),
  ),
  league: v.optional(v.string()),
  leagueWikidataId: v.optional(v.string()),
  location: v.optional(v.string()),
  yearsActive: v.optional(v.object({ from: v.number(), to: v.optional(v.number()) })),
  colors: v.optional(
    v.object({ primary: v.optional(v.string()), secondary: v.optional(v.string()) }),
  ),
  espnId: v.optional(v.string()),
});

/**
 * What the operator answered, as the tiles send it.
 *
 * `clear` undoes an answer made while the card is open: the name goes back to
 * waiting. A link to a team has no name on the card, so the walk (which holds
 * what it answered) sends the `teamId` to take off again.
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
  v.object({ kind: v.literal("clear"), teamId: v.optional(v.id("teams")) }),
);

/** What Apply to all copies: a link, or the name taken off. Never `clear`. */
export const tidyApplyInputValidator = v.union(
  v.object({ kind: v.literal("linkPlayer"), playerId: v.id("players") }),
  v.object({ kind: v.literal("linkTeam"), teamId: v.id("teams") }),
  v.object({ kind: v.literal("notEntity") }),
);

const originValidator = v.union(
  v.literal("setHistory"),
  v.literal("hallOfFame"),
  v.literal("careerTeam"),
);

/** One name the review gate established a fact about (`selectorOptions` computes these). */
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

type Enrichment = Infer<typeof tidyNameEnrichmentValidator>;
type ExistingCandidate = Infer<typeof existingCandidateValidator>;

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

/** The name as cleaned and its matcher key. */
function nameAndKey(raw: string): { name: string; key: string } {
  const name = cleanName(raw);
  const key = normalizeEntityName(name);
  if (!key) throw new ConvexError("A name is required.");
  return { name, key };
}

async function assertSport(ctx: Pick<MutationCtx, "db">, sportId: Id<"selectorOptions">) {
  const sport = await ctx.db.get(sportId);
  if (!sport || sport.level !== "sport") throw new ConvexError("Pick a sport.");
}

/** Whitelist a lookup result down to what `tidyNameEnrichmentValidator` holds. */
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
 * The lookup's answer as the operator sees it: ported from the merge
 * `applyLookupResult` made when a lookup landed (NEO-424). History candidates
 * (stamped `sportValue`, not re-derivable from the name index) lead, the live
 * ones follow, and the preselect is carried over.
 */
export function mergeLookupEnrichment(args: {
  incoming: Enrichment | undefined;
  history: ReadonlyArray<ExistingCandidate>;
  live: ReadonlyArray<ExistingCandidate>;
  preselect: Enrichment["preselect"] | undefined;
}): Enrichment | undefined {
  const history = args.history.filter((c) => c.sportValue !== undefined);
  const historyIds = new Set(history.map((c) => c.playerId as string));
  const existingCandidates = [
    ...history,
    ...args.live.filter((c) => !historyIds.has(c.playerId as string)),
  ];
  const looked: Enrichment | undefined =
    existingCandidates.length > 0
      ? { ...(args.incoming ?? {}), existingCandidates }
      : args.incoming;
  return args.preselect ? { ...(looked ?? {}), preselect: args.preselect } : looked;
}

/**
 * The live reads one lookup needs, for the lookup action (an action has no
 * `ctx.db`): the same-name players a name could be, history candidates first
 * (`historyPlayerIds`, the set's own links, in the order the gate gave them),
 * then the live ones. Nothing is written.
 */
export const lookupContext = internalQuery({
  args: {
    cardId: v.id("cardChecklist"),
    kind: tidyNameKindValidator,
    name: v.string(),
    sportId: v.id("selectorOptions"),
    historyPlayerIds: v.optional(v.array(v.id("players"))),
  },
  returns: v.object({
    history: v.array(existingCandidateValidator),
    live: v.array(existingCandidateValidator),
  }),
  handler: async (ctx, args) => {
    const card = await ctx.db.get(args.cardId);
    if (!card) throw new ConvexError("That card is gone. Refresh and try again.");
    const sport = await ctx.db.get(args.sportId);
    if (!sport || sport.level !== "sport") throw new ConvexError("Pick a sport.");
    if (args.kind !== "player") return { history: [], live: [] };
    const name = cleanName(args.name);
    const cardYear = await findSetYearForSelectorOption(ctx, card.selectorOptionId);
    const history =
      (args.historyPlayerIds?.length ?? 0) > 0
        ? await buildExistingPlayerCandidatesForIds(ctx, args.historyPlayerIds!, {
            name,
            cardYear,
          })
        : [];
    const live = await buildExistingPlayerCandidates(ctx, name, args.sportId, { cardYear });
    return { history, live };
  },
});

/** The most history ids a lookup is handed (the candidate builder caps the rest). */
export const LOOKUP_HISTORY_IDS_MAX = MAX_CANDIDATES_FOR_IDS * 2;

/**
 * NEO-645 — `cleanseExternalName` for every name the gate hands in, bound again
 * after cleansing (NFC can lengthen a string). Refused by length and position,
 * never by echoing the name.
 */
export function cleansedGateNames(items: ReadonlyArray<{ kind: string; name: string }>): string[] {
  return items.map((item, index) => {
    const name = cleanseExternalName(item.name);
    if (name.length > MAX_PLAYER_NAME_LENGTH) {
      throw new Error(
        `the ${item.kind} name at index ${index} is ${name.length} characters once cleansed; the limit is ${MAX_PLAYER_NAME_LENGTH}.`,
      );
    }
    return name;
  });
}

// ─── answerName ─────────────────────────────────────────────────────────────

/**
 * The answer write, on ONE card. `answerName`, `createPlayer` and the cameo
 * shortcut all end here, so a created player is answered exactly as a linked
 * one.
 *
 * The name is read off the card (`printedRefOf`). A name the card no longer
 * holds (the walk is re-asking after Not a player, which it holds for the
 * sitting) is placed like a waiting one, under the spelling given.
 *
 * `offered` (D5, ported from D7 of NEO-645): a link the lookup itself offered
 * may be in another sport, so the sport check is skipped for it.
 */
export async function applyAnswer(
  ctx: MutationCtx,
  userId: string,
  args: {
    cardId: Id<"cardChecklist">;
    kind: "player" | "team";
    name: string;
    sportId: Id<"selectorOptions"> | undefined;
    input: Infer<typeof tidyAnswerInputValidator>;
    offered?: boolean;
  },
): Promise<void> {
  const { name, key } = nameAndKey(args.name);
  const card = await ctx.db.get(args.cardId);
  if (!card) throw new ConvexError("That card is gone. Refresh and try again.");
  const { ref, unlinkedBefore } = printedRefOf(card, args.kind, key, name);
  const input = args.input;

  let change: NameChange;
  let previousAnswer: StoredAnswer | undefined;
  if (input.kind === "linkPlayer") {
    if (args.kind !== "player") throw new ConvexError("That answer is for a player name.");
    const player = await ctx.db.get(input.playerId);
    if (!player) throw new ConvexError("That player is gone. Pick them again.");
    if (!args.offered) {
      if (!args.sportId) throw new ConvexError("Pick a sport.");
      await assertSport(ctx, args.sportId);
      if (!(await playerBelongsToSport(ctx, player, args.sportId))) {
        throw new ConvexError("That player isn't in this sport.");
      }
    }
    if (input.addSetSport) {
      const setSportId = await findSportForSelectorOption(ctx, card.selectorOptionId);
      if (setSportId && player.sportId !== setSportId) {
        await addPlayerSport(ctx, player, setSportId);
      }
    }
    change = { kind: "linkPlayer", playerId: player._id };
  } else if (input.kind === "linkTeam") {
    if (args.kind !== "team") throw new ConvexError("That answer is for a team name.");
    const team = await ctx.db.get(input.teamId);
    if (!team) throw new ConvexError("That team is gone. Pick it again.");
    if (!args.sportId) throw new ConvexError("Pick a sport.");
    await assertSport(ctx, args.sportId);
    if (team.sportId !== args.sportId) throw new ConvexError("That team isn't in this sport.");
    if (input.saveAsAlias) {
      await rememberAliasesOnTeam(ctx, team, [ref.printed], "tidyNames.answerName");
    }
    change = { kind: "linkTeam", teamId: team._id };
  } else if (input.kind === "notEntity") {
    change = { kind: "notEntity" };
  } else {
    // Undo: the printed spelling is waiting again.
    change = { kind: "restore" };
    if (args.kind === "team" && input.teamId) {
      previousAnswer = { kind: "linkTeam", teamId: input.teamId };
    }
  }

  const plan = planNameChange(card, ref, change, "any", {
    unlinkedBefore,
    previousAnswer,
  });
  if (plan.status === "skipped") {
    throw new ConvexError("This card can't carry any more of those.");
  }
  if (plan.status === "changed") {
    await writeNameChange(ctx, card, plan.fields, newNameWriteCache(ctx), userId);
  }
}

/**
 * Answer a name on THIS card: link it, change the link, "not a player / not a
 * team", or undo while the card is open. Other cards are reached only by
 * `applyNameToAll`. Idempotent: the same answer twice writes nothing the second
 * time.
 *
 * `sportId` is the sport the question is asked in (the Sport chip). `offered`
 * says the player is one the lookup offered, who may be in another sport.
 */
export const answerName = mutation({
  args: {
    cardId: v.id("cardChecklist"),
    kind: tidyNameKindValidator,
    name: v.string(),
    sportId: v.id("selectorOptions"),
    answer: tidyAnswerInputValidator,
    offered: v.optional(v.literal(true)),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireAdmin(ctx);
    await applyAnswer(ctx, userId, {
      cardId: args.cardId,
      kind: args.kind,
      name: args.name,
      sportId: args.sportId,
      input: args.answer,
      offered: args.offered === true,
    });
    return null;
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

/** What the operator saw the lookup find, for seeding the new player (B14). */
export const createPlayerEnrichmentValidator = v.object({
  wikidataId: v.optional(v.string()),
  isHallOfFame: v.optional(v.boolean()),
  careerTeams: v.optional(
    v.array(
      v.object({
        name: v.string(),
        fromYear: v.number(),
        toYear: v.optional(v.number()),
        wikidataId: v.optional(v.string()),
      }),
    ),
  ),
});

/**
 * Add as new player, on THIS card. Creates the player (career teams matched,
 * never created: NEO-236) from the `enrichment` the operator saw, then answers
 * exactly as a link would.
 *
 * `excludedCareerTeamNames` (additive, NEO-212): the Wikidata career teams the
 * operator unticked. Matching is by the shared name matcher, so an unticked
 * stint never reaches `teamYears`.
 *
 * `addSetSport` (additive): the player is created in `sportId` and also plays
 * the set's (NEO-313).
 *
 * The enrichment comes from the client (the walk holds the lookup), so it is
 * checked here: at most 64 career teams, a valid Wikidata id, and a stint whose
 * years the career will not hold is dropped like an unmatched team.
 */
export const createPlayer = mutation({
  args: {
    cardId: v.id("cardChecklist"),
    name: v.string(),
    sportId: v.id("selectorOptions"),
    oneNamePlayer: v.optional(v.literal(true)),
    addSetSport: v.optional(v.literal(true)),
    excludedCareerTeamNames: v.optional(v.array(v.string())),
    enrichment: v.optional(createPlayerEnrichmentValidator),
  },
  returns: v.object({ playerId: v.id("players") }),
  handler: async (ctx, args) => {
    const userId = await requireAdmin(ctx);
    const { key } = nameAndKey(args.name);
    const card = await ctx.db.get(args.cardId);
    if (!card) throw new ConvexError("That card is gone. Refresh and try again.");
    await assertSport(ctx, args.sportId);
    // The name already answered on this card: Change it first.
    if (
      (card.playerLinks ?? []).some((l) => normalizeEntityName(l.nameOnCard) === key)
    ) {
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
    await assertNotNameFragment(ctx, name, args.sportId, args.oneNamePlayer);
    const excluded = normalizeExcludedCareerTeamNames(args.excludedCareerTeamNames ?? []);

    const enrichment = args.enrichment;
    if (enrichment?.wikidataId !== undefined && !isWikidataQid(enrichment.wikidataId)) {
      throw new ConvexError("That Wikidata id isn't valid.");
    }
    const careerTeams = enrichment?.careerTeams ?? [];
    if (careerTeams.length > 64) {
      throw new ConvexError(`At most 64 career teams can come with a new player.`);
    }
    const teamYearByKey = new Map<
      string,
      { teamId: Id<"teams">; fromYear: number; toYear?: number }
    >();
    for (const ct of careerTeams) {
      if (ct.name.length > MAX_TEAM_NAME_LENGTH) {
        throw new ConvexError(
          `A team name is ${ct.name.length} characters; the limit is ${MAX_TEAM_NAME_LENGTH}.`,
        );
      }
      // NEO-212: a team the operator unticked is never matched.
      if (excluded.has(normalizeEntityName(ct.name))) continue;
      if (!careerYearsHoldable(ct.fromYear, ct.toYear)) continue;
      // Match only (NEO-236): a stint at a team nobody reviewed is dropped, not invented.
      const { teamId } = await resolveTeamForSetYear(ctx, args.sportId, ct.name, ct.fromYear);
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
      sportId: args.sportId,
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
      JSON.stringify({ msg: "tidy_player_created", playerId, sportId: args.sportId, userId }),
    );
    if (args.addSetSport) {
      const setSportId = await findSportForSelectorOption(ctx, card.selectorOptionId);
      const created = await ctx.db.get(playerId);
      if (created && setSportId && created.sportId !== setSportId) {
        await addPlayerSport(ctx, created, setSportId);
      }
    }
    // The player was just made in `sportId`: no sport check to run.
    await applyAnswer(ctx, userId, {
      cardId: card._id,
      kind: "player",
      name: args.name,
      sportId: args.sportId,
      input: { kind: "linkPlayer", playerId },
      offered: true,
    });
    return { playerId };
  },
});

/** `assertCareerStintYears` as a yes/no, so a stint the career will not hold is dropped. */
function careerYearsHoldable(fromYear: number, toYear: number | undefined): boolean {
  try {
    assertCareerStintYears(fromYear, toYear, maxCareerYear());
    return true;
  } catch {
    return false;
  }
}

// ─── Apply to all ───────────────────────────────────────────────────────────

/**
 * Read the open card and refuse unless it already carries the answer being
 * applied (the walk answers the card, then offers it to the rest), then find the
 * leaves of the printing level. Nothing is trusted from the client but the ids,
 * and each is checked against the card itself.
 */
export const applyToAllPlan = internalQuery({
  args: {
    cardId: v.id("cardChecklist"),
    kind: tidyNameKindValidator,
    name: v.string(),
    answer: tidyApplyInputValidator,
  },
  returns: v.object({
    key: v.string(),
    leafIds: v.array(v.id("selectorOptions")),
  }),
  handler: async (ctx, args) => {
    const { key } = nameAndKey(args.name);
    const card = await ctx.db.get(args.cardId);
    if (!card) throw new ConvexError("That card is gone. Refresh and try again.");
    const answer = args.answer;
    if (answer.kind === "linkPlayer") {
      if (args.kind !== "player") throw new ConvexError("That answer is for a player name.");
      const linked = (card.playerLinks ?? []).some(
        (l) => l.playerId === answer.playerId && normalizeEntityName(l.nameOnCard) === key,
      );
      if (!linked) throw new ConvexError("Answer this card first.");
    } else if (answer.kind === "linkTeam") {
      if (args.kind !== "team") throw new ConvexError("That answer is for a team name.");
      if (!(card.teamOnCardIds ?? []).includes(answer.teamId)) {
        throw new ConvexError("Answer this card first.");
      }
    } else if (cardHoldsName(card, args.kind, key)) {
      throw new ConvexError("Answer this card first.");
    }
    return { key, leafIds: await printingLevelLeaves(ctx, card.selectorOptionId) };
  },
});

/**
 * One byte-bounded page of a leaf's cards: the ids of those whose waiting list
 * holds the name (the shared matcher, `normalizeEntityName`). Only ids leave the
 * query, so a leaf of 900 wide cards costs a few pages, never one big read.
 */
export const pageWaitingCards = internalQuery({
  args: {
    leafId: v.id("selectorOptions"),
    kind: tidyNameKindValidator,
    key: v.string(),
    cursor: v.union(v.string(), v.null()),
  },
  returns: v.object({
    cardIds: v.array(v.id("cardChecklist")),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("cardChecklist")
      .withIndex("by_selector_option_and_sort", (q) => q.eq("selectorOptionId", args.leafId))
      .paginate({
        numItems: APPLY_TO_ALL_SCAN_PAGE,
        cursor: args.cursor,
        maximumBytesRead: APPLY_TO_ALL_SCAN_BYTES,
      });
    const cardIds = page.page
      .filter((card) =>
        (args.kind === "player" ? card.pendingPlayerNames : card.pendingTeamNames)?.some(
          (n) => normalizeEntityName(n) === args.key,
        ),
      )
      .map((card) => card._id);
    return { cardIds, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

/**
 * One page of Apply to all's writes. Every card is re-read and compared and set:
 * it is written only while it is STILL waiting on the name (a card the operator
 * answered since the scan, or linked another way, is left alone and counted).
 * The planner, the writer and the cache are the open card's own
 * (`planNameChange` + `writeNameChange`).
 */
export async function applyNameToCardsImpl(
  ctx: MutationCtx,
  args: {
    cardIds: ReadonlyArray<Id<"cardChecklist">>;
    kind: "player" | "team";
    key: string;
    answer: Infer<typeof tidyApplyInputValidator>;
    userId: string;
  },
): Promise<{ linked: number; skipped: number }> {
  const cache = newNameWriteCache(ctx);
  const change: NameChange =
    args.answer.kind === "linkPlayer"
      ? { kind: "linkPlayer", playerId: args.answer.playerId }
      : args.answer.kind === "linkTeam"
        ? { kind: "linkTeam", teamId: args.answer.teamId }
        : { kind: "notEntity" };
  let linked = 0;
  let skipped = 0;
  for (const id of args.cardIds) {
    const card = await ctx.db.get(id);
    if (!card) {
      skipped += 1;
      continue;
    }
    const { ref, unlinkedBefore } = printedRefOf(card, args.kind, args.key, "");
    // Compare-and-set: the name must still be waiting on this card.
    const plan = planNameChange(card, ref, change, { answer: undefined }, { unlinkedBefore });
    if (plan.status === "changed") {
      await writeNameChange(ctx, card, plan.fields, cache, args.userId);
      linked += 1;
    } else {
      skipped += 1;
    }
  }
  return { linked, skipped };
}

export const applyNameToCards = internalMutation({
  args: {
    cardIds: v.array(v.id("cardChecklist")),
    kind: tidyNameKindValidator,
    key: v.string(),
    answer: tidyApplyInputValidator,
    userId: v.string(),
  },
  returns: v.object({ linked: v.number(), skipped: v.number() }),
  handler: async (ctx, args) => applyNameToCardsImpl(ctx, args),
});

/**
 * "Apply to all cards printing X". The operator has just answered the open
 * card; this offers the same answer to every card of its printing level (the
 * leaf, and the parallels copied from it) that is STILL WAITING on the name.
 * Cards already linked, to this player or another, are not touched (Jason,
 * J3): after a Change they are fixed one at a time.
 *
 * Read once, when clicked. A public action: the scan is paged queries (a
 * snapshot, so it adds no write conflicts), the writes are paged mutations of
 * `APPLY_TO_ALL_PAGE_SIZE`. It is not atomic: a card committed mid-scan may be
 * missed, and a second click is idempotent through the compare-and-set.
 *
 * The open card must already carry the answer (`applyToAllPlan`), which is also
 * what proves the player or team is a real, in-sport answer: nothing stored
 * vouches for it.
 *
 * Returns how many cards were written and how many were skipped.
 */
export const applyNameToAll = action({
  args: {
    cardId: v.id("cardChecklist"),
    kind: tidyNameKindValidator,
    name: v.string(),
    answer: tidyApplyInputValidator,
  },
  returns: v.object({ linked: v.number(), skipped: v.number() }),
  handler: async (ctx, args): Promise<{ linked: number; skipped: number }> => {
    const userId = await requireAdmin(ctx);
    const plan: { key: string; leafIds: Array<Id<"selectorOptions">> } = await ctx.runQuery(
      internal.tidyNames.applyToAllPlan,
      { cardId: args.cardId, kind: args.kind, name: args.name, answer: args.answer },
    );
    let linked = 0;
    let skipped = 0;
    for (const leafId of plan.leafIds) {
      const waiting: Array<Id<"cardChecklist">> = [];
      let cursor: string | null = null;
      for (let pageNo = 0; ; pageNo++) {
        if (pageNo >= APPLY_TO_ALL_MAX_SCAN_PAGES) {
          throw new ConvexError("That checklist is too long to apply to all at once.");
        }
        const page: {
          cardIds: Array<Id<"cardChecklist">>;
          isDone: boolean;
          continueCursor: string;
        } = await ctx.runQuery(internal.tidyNames.pageWaitingCards, {
          leafId,
          kind: args.kind,
          key: plan.key,
          cursor,
        });
        waiting.push(...page.cardIds);
        if (page.isDone) break;
        cursor = page.continueCursor;
      }
      for (let at = 0; at < waiting.length; at += APPLY_TO_ALL_PAGE_SIZE) {
        const result: { linked: number; skipped: number } = await ctx.runMutation(
          internal.tidyNames.applyNameToCards,
          {
            cardIds: waiting.slice(at, at + APPLY_TO_ALL_PAGE_SIZE),
            kind: args.kind,
            key: plan.key,
            answer: args.answer,
            userId,
          },
        );
        linked += result.linked;
        skipped += result.skipped;
      }
    }
    return { linked, skipped };
  },
});
