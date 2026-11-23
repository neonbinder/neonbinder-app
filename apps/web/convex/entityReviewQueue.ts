import { internalMutation, internalQuery } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { RunResult } from "@convex-dev/workpool";
// NEO-301: the backstop says whether a failed item gave up on Wikidata.
import {
  isWikidataUnavailableResult,
  parseWikidataUnavailable,
} from "../lib/errors/wikidata-unavailable";
import { playerContextValidator, teamContextValidator } from "./lib/entityReviewContext";
import {
  buildExistingPlayerCandidates,
  // NEO-424 — the set-history candidates, by id and in any sport.
  buildExistingPlayerCandidatesForIds,
  MAX_CANDIDATES_FOR_IDS,
  normalizePlayerName,
} from "./players";
import { normalizeTeamName } from "./teams";
// NEO-643 — every external name is cleansed before it is keyed, stored or shown.
import { cleanseExternalName } from "../lib/entities/cleanse-name";
import {
  findLeagueByName,
  leagueLevelValidator,
  MAX_LEAGUE_NAME_LENGTH,
  normalizeLeagueName,
} from "./leagues";
// NEO-236: the ONE team lookup. Staging asks "do we already hold this career
// team?" and must ask it exactly the way every writer keys the table.
import { resolveTeamForSetYear } from "./lib/teamRow";
// NEO-254: the set's year, for labelling which same-name candidates were
// active in it. One ancestor walk per batch; see convex/lib/selectorAncestry.ts.
import { findSetYearForSelectorOption } from "./lib/selectorAncestry";
// NEO-294 — the two bounds that decide what one ambiguous name COSTS. Imported
// rather than restated so `startBatch`'s op budget is tied to the real limits:
// if either grows, the arithmetic in ENTITY_REVIEW_START_OPS grows with it
// instead of quietly under-charging.
import { MAX_PLAYER_NAME_LENGTH, PLAYER_AMBIGUITY_SCAN_LIMIT } from "../lib/players/name-limits";
import { PLAYER_DESCRIPTION_MAX_TEAMS } from "../lib/players/player-description";

/**
 * NEO-92 (retired by NEO-645): the step-through "new players & teams" review
 * wizard's batch rows. One-card Tidy Up (`tidyNames.ts`, `tidyCards.ts`)
 * replaced the wizard, and with it every PUBLIC function of this module
 * (getBatch, recordDecision, the step contexts, the bulk actions, ...): none
 * is callable from a client any more.
 *
 * What is left is internal and exists only for the deploy window and the
 * follow-up cleanup that retires the table:
 *
 *  - `getInternal`, `applyLookupResult` and `backstopEntityReviewRowImpl`
 *    finish a Wikidata lookup that was already in flight when the new code
 *    landed (the pool's old-shape work items and completions);
 *  - `startBatch` and the abandoned-batch sweep keep the old rows readable and
 *    deletable until `tidyMigrations.drainEntityReviewQueue` empties the table
 *    and the table itself is removed.
 */

/**
 * NEO-424 — why a review row was born decided: the set's own history named
 * exactly one player (or team) for the name, or the Hall of Fame tie-break
 * picked the one Hall of Famer among same-name players nobody else in the set
 * year could be. Mirrors `entityReviewQueue.decision.autoLinked` in schema.ts.
 */
const autoLinkOriginValidator = v.union(
  v.literal("setHistory"),
  v.literal("hallOfFame"),
  // NEO-490: the card's team picked the one same-name player with a stint on
  // it (rule 6b), or the card's player picked the one team era he played for.
  v.literal("careerTeam"),
);

/**
 * NEO-424 — the one existing player the batch suggests for a name, which the
 * operator confirms. Mirrors `entityReviewQueue.enrichment.preselect` in
 * schema.ts, and doubles as the `startBatch` arg's element shape minus the
 * reasons only `clearDecision` writes.
 */
const preselectValidator = v.object({
  playerId: v.id("players"),
  name: v.string(),
  sportId: v.id("selectorOptions"),
  sportValue: v.string(),
  reason: v.union(
    v.literal("priorYearProduct"),
    v.literal("onlyNamesake"),
    // An auto-link the operator pressed Change on: the player it named comes
    // back as the primary. Written only by `clearDecision`.
    v.literal("setHistory"),
    v.literal("hallOfFame"),
    v.literal("careerTeam"),
  ),
});

const enrichmentValidator = v.object({
  wikidataId: v.optional(v.string()),
  careerTeams: v.optional(v.array(v.object({
    name: v.string(),
    fromYear: v.number(),
    toYear: v.optional(v.number()),
    // NEO-236: the team's own Wikidata QID — see schema.ts. Linkage only.
    wikidataId: v.optional(v.string()),
  }))),
  // NEO-235, player-only: Wikidata teams with no usable start year. Names
  // only — they cannot become `teamYears` entries (which require `fromYear`)
  // and are surfaced so the operator can see what was found. See schema.ts.
  undatedCareerTeams: v.optional(v.array(v.string())),
  isHallOfFame: v.optional(v.boolean()),
  // NEO-212: player-only disambiguation context from Wikidata. See the
  // entityReviewQueue.enrichment comment in schema.ts.
  description: v.optional(v.string()),
  birthYear: v.optional(v.number()),
  enwikiTitle: v.optional(v.string()),
  // NEO-254: league-only pre-fill from `adapters/wikidata.lookupLeague`. Kept
  // in step with schema.ts — see the note on `activeInSetYear` below for what
  // a field in one and not the other costs at runtime.
  abbreviation: v.optional(v.string()),
  // NEO-254, team-only — see schema.ts. Kept in step with it deliberately.
  leagueWikidataId: v.optional(v.string()),
  // NEO-254, player-only: the NB rows already filed under this name, present
  // only when there is MORE THAN ONE of them. See schema.ts, and
  // `players.buildExistingPlayerCandidates` for who fills it in.
  existingCandidates: v.optional(v.array(v.object({
    playerId: v.id("players"),
    name: v.string(),
    birthYear: v.optional(v.number()),
    careerSummary: v.string(),
    // NEO-254: the alias that answered, when it was not the primary name.
    // Kept in step with schema.ts — see the note below on what a field in one
    // and not the other costs at runtime.
    matchedAlias: v.optional(v.string()),
    // NEO-254: this candidate has a stint covering the SET'S year.
    //
    // This object is a hand-kept copy of the schema's, and a field added to
    // one and not the other is not a type error — it is a RUNTIME refusal on
    // every function that returns a row (`getBatch`, `entityReviewRowValidator`
    // below), which is the wizard failing to open at all. Anything added to
    // `entityReviewQueue.enrichment.existingCandidates` in schema.ts belongs
    // here in the same edit.
    activeInSetYear: v.optional(v.boolean()),
    // NEO-424: the candidate's home-sport label, on candidates taken from the
    // set's own history (which is not sport-scoped). Kept in step with
    // schema.ts for the reason above.
    sportValue: v.optional(v.string()),
  }))),
  // NEO-424, player-only: the one existing player the batch suggests and the
  // operator confirms (rule E, or the player an undone auto-link named). Kept
  // in step with schema.ts — see `preselectValidator`.
  preselect: v.optional(preselectValidator),
  league: v.optional(v.string()),
  // NEO-236: the place part of the team name. Location, not city.
  location: v.optional(v.string()),
  yearsActive: v.optional(v.object({
    from: v.number(),
    to: v.optional(v.number()),
  })),
  colors: v.optional(v.object({
    primary: v.optional(v.string()),
    secondary: v.optional(v.string()),
  })),
  espnId: v.optional(v.string()),
});

// Manual career-team entries the admin can add for a player row in the
// wizard (see recordDecision). Kept as a standalone validator so both the
// stored `decision` shape and recordDecision's args validate identically.
const manualCareerTeamValidator = v.object({
  name: v.string(),
  fromYear: v.number(),
  toYear: v.optional(v.number()),
});

/**
 * NEO-236 — the operator's Location + Name for a team-kind create decision.
 *
 * The whole point is that neither half is the raw checklist string: the wizard
 * pre-fills them (splitting on the ESPN location when it is a whole-word
 * prefix) and the operator confirms or corrects. `teamRowFields` composes them
 * back into the stored name and its dedup key at commit.
 */
/**
 * NEO-254 — the three kinds a review row can be, in walk order.
 *
 * One constant rather than the union written out at each of the two row
 * validators: they describe the same column, and a kind added to one and not
 * the other is a runtime refusal on whichever function returns the row.
 */
const kindValidator = v.union(
  v.literal("player"),
  v.literal("team"),
  v.literal("league"),
);

/**
 * NEO-254 — the whole league record a New League step collects.
 *
 * Mirrors `convex/schema.ts`. Every field but `name` is optional and means
 * "not answered" when absent — `findOrCreateLeague` gap-fills, so an absent
 * field never clears an existing row's value.
 *
 * NEO-331: `level` stays OPTIONAL here even though `leagues.level` is now
 * required. This validator is shared with `decisionValidator`, which validates
 * drafts read back from stored queue rows, and rows recorded before the flip
 * carry no level — tightening it would make reading them throw. The
 * requirement is enforced where a NEW answer arrives instead: the
 * `recordDecision` handler, through `requireLeagueCreate`.
 */
const leagueCreateValidator = v.object({
  name: v.string(),
  abbreviation: v.optional(v.string()),
  level: v.optional(leagueLevelValidator),
  yearsActive: v.optional(v.object({
    from: v.number(),
    to: v.optional(v.number()),
  })),
  aliases: v.optional(v.array(v.string())),
  wikidataId: v.optional(v.string()),
});

const teamCreateValidator = v.object({
  location: v.optional(v.string()),
  name: v.string(),
  /**
   * NEO-236 — the league the operator chose on the New Team step.
   *
   * `leagueId` is a UNION with null on purpose: an id is "this league", null is
   * "no league, deliberately", and ABSENT is "not answered" — which is the only
   * one of the three that lets the prelude fall back to the enrichment's P118
   * label (the suggestion the field showed as its answer). Without the null
   * case an operator could not decline that suggestion. NEO-331 (Jason,
   * 2026-10-10): with no suggestion, "not answered" lands exactly where "no
   * league" does — blank. The sport default is never applied to a team the
   * operator did not put in it.
   *
   * `leagueName` names a league by name. NEO-331: the prelude only LINKS it
   * (staged New League step first, then an existing row by name or alias); a
   * miss leaves the team with no league rather than minting a level-less row.
   * See schema.ts for the long version.
   */
  leagueId: v.optional(v.union(v.id("leagues"), v.null())),
  leagueName: v.optional(v.string()),
  /**
   * ── NEO-254: the era the operator typed, and why it must travel ──────────
   *
   * A sport can hold two teams under one name — the 1972-1996 Winnipeg Jets
   * and the 2011- Jets — and the era is the only thing that tells them apart.
   * Without it on this payload the operator could type "Winnipeg Jets,
   * 1972-1996" into a 1985 set's New Team step, the prelude would see a create
   * with no dates, adopt the 2011 row it already held, and every 1985 card in
   * the set would bind to a franchise that did not exist yet.
   *
   * Optional, and stays optional: most teams are created without anybody
   * knowing or caring, and an undated row is a normal row. It matters exactly
   * when the name is already taken, which is when the form asks for it.
   */
  yearsActive: v.optional(v.object({
    from: v.number(),
    to: v.optional(v.number()),
  })),
  /**
   * NEO-284 — the "Also known as" list typed on the New Team step.
   *
   * RAW spellings, the contract `teams.aliases` keeps (see schema.ts).
   * `requireTeamCreate` runs them through `normalizeTeamAliasList` against
   * the composed Location + Name before they are stored, so the bounds and
   * the own-name rule are enforced where the operator can still fix the
   * list. Written on the commit's INSERT branch only; a name the prelude
   * finds already held adopts that row without widening its aliases.
   */
  aliases: v.optional(v.array(v.string())),
});

/**
 * NEO-236 — the same, per accepted career team on a player-kind decision,
 * keyed by the label the wizard showed (`sourceName`).
 */
const careerTeamCreateValidator = v.object({
  sourceName: v.string(),
  location: v.optional(v.string()),
  name: v.string(),
});

const decisionValidator = v.union(
  v.object({
    action: v.literal("create"),
    manualCareerTeams: v.optional(v.array(manualCareerTeamValidator)),
    // NEO-212: Wikidata career-team labels the admin unchecked in the wizard.
    // Commit must not create team rows for these. See schema.ts.
    excludedCareerTeamNames: v.optional(v.array(v.string())),
    // NEO-236: team-kind only — the Location + Name a `teams` row is built
    // from. Without it the prelude creates nothing. See schema.ts.
    create: v.optional(teamCreateValidator),
    // NEO-236: player-kind only — Location + Name for each accepted career
    // team that matched no existing row. See schema.ts.
    createTeams: v.optional(v.array(careerTeamCreateValidator)),
    // NEO-307: player-kind only — a career-team create `recordDecision` turned
    // into a link, because exactly one other team holds its name as an alias.
    // See schema.ts.
    linkTeams: v.optional(
      v.array(v.object({ sourceName: v.string(), teamId: v.id("teams") })),
    ),
    // NEO-254: league-kind only — the whole record. See schema.ts.
    createLeague: v.optional(leagueCreateValidator),
    // NEO-313: player-kind only — at COMMIT, also add the set's sport to the
    // created player's `playerSports`. Absent is a guest link. See schema.ts.
    addSetSport: v.optional(v.boolean()),
    // NEO-463: player-kind only — the operator confirmed a one-word name that
    // clashes with a fuller-named player is a one-name player. See schema.ts.
    oneNamePlayer: v.optional(v.literal(true)),
  }),
  v.object({
    action: v.literal("link"),
    linkedPlayerId: v.optional(v.id("players")),
    linkedTeamId: v.optional(v.id("teams")),
    // NEO-254: league-kind only. Every team naming this league then uses it.
    linkedLeagueId: v.optional(v.id("leagues")),
    // NEO-284: team-kind only — at COMMIT, remember the parked string as an
    // alias of `linkedTeamId`. Stored only when true. See schema.ts.
    saveAsAlias: v.optional(v.boolean()),
    // NEO-313: player-kind only — at COMMIT, also add the set's sport to
    // `linkedPlayerId`'s `playerSports`. Absent is a guest link. See schema.ts.
    addSetSport: v.optional(v.boolean()),
    // NEO-424: the batch made this link (set history, or the Hall of Fame
    // tie-break), not the operator. Written only by `startBatch`. See schema.ts.
    autoLinked: v.optional(autoLinkOriginValidator),
  }),
  // NEO-212: "not a person / not a team" — the card keeps the raw name, and
  // nothing is created or linked. See schema.ts.
  v.object({ action: v.literal("skip") }),
);


/**
 * Mirrors `MAX_TEAM_NAME_LENGTH` in convex/teams.ts (120). Copied rather than
 * imported because `teams.ts` does not export it and this module has no other
 * reason to depend on it; the bound is applied to the COMPOSED full name, which
 * is what `teams.findOrCreate` bounds, so the two agree on what they measure.
 */
const MAX_TEAM_FULL_NAME_LENGTH = 120;

/**
 * Upper bound on per-career-team create entries carried on one decision. Same
 * shape of guard rail, and the same generosity, as MAX_MANUAL_CAREER_TEAMS —
 * this list can never be longer than the accepted career teams it answers.
 */
const MAX_CAREER_TEAM_CREATES = 64;

/**
 * NEO-254 — how many League steps one team row may raise.
 *
 * A team belongs to ONE league, so the real number is one; the headroom is
 * for a team whose enrichment names a league and whose operator then types a
 * different one before the first is answered. A guard rail on an unbounded
 * write, not a security boundary — the same job, and the same reasoning, as
 * `MAX_CAREER_TEAM_CREATES` above.
 */
const MAX_STAGED_LEAGUES_PER_TEAM = 4;


/**
 * NEO-236 — a row the batch staged for itself rather than reading off the
 * checklist. See the `source` field in schema.ts for why these exist.
 */
const rowSourceValidator = v.union(
  v.object({
    kind: v.literal("careerTeamOf"),
    playerRowId: v.id("entityReviewQueue"),
    wikidataId: v.optional(v.string()),
    // NEO-248 — the years the operator typed alongside the name, on the step
    // that staged this one. Hand-typed entries only; see schema.ts.
    manualStint: v.optional(v.object({
      fromYear: v.number(),
      toYear: v.optional(v.number()),
    })),
  }),
  // NEO-254 — the same relationship one level up. A league has no
  // `manualStint`: NEO-248's field records the years typed for a career TEAM,
  // and a league's dates live on the record its own step collects. See
  // schema.ts.
  v.object({
    kind: v.literal("leagueOf"),
    teamRowId: v.id("entityReviewQueue"),
    wikidataId: v.optional(v.string()),
  }),
);

// `createdByUserId` is audit/scoping-only — see toPublicRow below. Mirrors
// the players.ts/teams.ts pattern: internalQuery reads the full row,
// public query strips this field before it reaches the client.
const rowValidator = v.object({
  _id: v.id("entityReviewQueue"),
  _creationTime: v.number(),
  selectorOptionId: v.id("selectorOptions"),
  batchId: v.string(),
  createdByUserId: v.string(),
  kind: kindValidator,
  name: v.string(),
  // NEO-236 — the dedup key staging reads through an index. See schema.ts.
  nameNormalized: v.optional(v.string()),
  // NEO-96: reference to the sport-level selectorOptions row.
  sportId: v.id("selectorOptions"),
  // NEO-236 — set only on a row this batch staged for itself.
  source: v.optional(rowSourceValidator),
  status: v.union(v.literal("pending"), v.literal("ready"), v.literal("error")),
  enrichment: v.optional(enrichmentValidator),
  decision: v.optional(decisionValidator),
  // NEO-221 — see schema.ts. Read only by `sweepAbandonedBatches`.
  lastTouchedAt: v.optional(v.number()),
  // NEO-602 — display context the review gate writes at insert. The stored
  // row carries both, so `getInternal` (which hands the raw document to the
  // pool's lookup work item) must declare them or every team row fails its
  // returns validation. The public path never sees them: `toPublicRow`.
  teamContext: v.optional(teamContextValidator),
  playerContext: v.optional(playerContextValidator),
});

/**
 * NEO-602 — one team step's context, as the gate hands it to `startBatch`. The
 * same shape the row stores (`entityReviewQueue.teamContext`) plus the printed
 * name it belongs to.
 */
const teamContextFactValidator = v.object({
  name: v.string(),
  ...teamContextValidator.fields,
});

/**
 * NEO-602 — one same-name player step's context, as the gate hands it to
 * `startBatch`: the cards that printed the name (number and printed team(s))
 * plus the printed name it belongs to. The same shape the row stores
 * (`entityReviewQueue.playerContext`).
 */
const playerContextFactValidator = v.object({
  name: v.string(),
  ...playerContextValidator.fields,
});

/**
 * Start (or resume) a review batch for a selectorOption, scoped to the
 * calling user. Called from fetchCardChecklist's action via ctx.runMutation
 * — internal, no public surface needed since only that action calls it.
 *
 * If a batch already exists for this (selectorOptionId, createdByUserId)
 * pair, resume it (return its id, touch nothing) rather than deleting +
 * restarting: a batch only exists while mid-review (commit and cancel both
 * delete their batch's rows on completion), so finding one means this SAME
 * user's previous tab/click is still reviewing it — silently discarding
 * that progress would be a real bug. This holds even once every row is
 * decided but not yet committed (the wizard's final "All reviewed — save?"
 * screen) — a page refresh in that state should resume the same
 * fully-decided batch, not lose it.
 *
 * Scoping by user (not just selectorOptionId) is what makes this safe under
 * concurrent access to the same set: two different users (or, in Maestro
 * E2E, two different CI workers each authenticated as a distinct test
 * account) fetching the SAME real marketplace variant each get their own
 * private batch instead of sharing/colliding on one. This isn't only a test
 * concern — two admin sessions (or the same admin in two tabs) reviewing
 * the same set concurrently should behave the same way.
 *
 * Safe to key resumption purely on "any row exists for this user" (not "any
 * UNDECIDED row") because commitCardChecklist deletes a batch's rows
 * SYNCHRONOUSLY, in the same transaction as the commit itself — there is no
 * async window where a fully-decided batch could be observed here after
 * it's already been committed. See the delete site in commitCardChecklist
 * for why that matters (an earlier scheduled-delete version of this had
 * exactly that race).
 *
 * ## NEO-221 — resume RECONCILES rather than returning the batch untouched
 *
 * "Touch nothing" was right while the only way back into a resumed batch was
 * an identical re-fetch. It stopped being right once the wizard could hand the
 * operator back to card matching and return (NEO-220's "Back to matching"):
 * the second Confirm can legitimately carry a DIFFERENT name set — a pairing
 * the operator linked no longer contributes its unmatched name, a rename
 * introduces one — and a batch frozen at the first Confirm's names would ask
 * about names no card carries any more while never asking about the new ones.
 * Commit would then find no decision for a real name and leave the card
 * unlinked, which is precisely the failure this ticket exists to remove.
 *
 * So a resume reconciles the batch against the incoming names, keyed by
 * `kind` + the SAME normalizer the players/teams tables dedupe on
 * (`normalizePlayerName`/`normalizeTeamName`), so a re-spelling of one name is
 * a match rather than an add plus a drop:
 *
 *   - a key present on both sides keeps its row, and therefore its decision,
 *     its enrichment and its status — reconciliation never re-asks something
 *     the operator has already answered;
 *   - a key only in the incoming set gets a fresh `pending` row (same shape as
 *     a first-time insert) and a lookup scheduled for it — and ONLY for it, so
 *     resuming does not re-run the whole batch's Wikidata work;
 *   - a key only on the existing side is dropped ONLY IF the operator never
 *     ruled on it AND the row came from the incoming set in the first place
 *     (NEO-236: a staged career team never does — see the guard). An UNDECIDED row for a name no card carries any more is a
 *     question about nothing, and leaving it would block the wizard's
 *     "all reviewed" on it forever. A DECIDED row is kept, whatever the
 *     incoming set says.
 *
 * ## Why a decided row is never deleted here
 *
 * Reconciliation is ADDITIVE about the operator's work, in exactly the sense
 * the sync boundary is additive about NB's data. The incoming name list is
 * derived — from a marketplace payload, through a pairing session an operator
 * can still change their mind about — so "this name is not in the list any
 * more" is a statement about that derivation, not evidence that the human's
 * ruling was wrong. Deleting on it would let a re-pair silently discard a
 * decision, and the operator's only clue would be a name they have to rule on
 * twice. A kept-but-unused decision costs one throwaway row; the batch is
 * deleted wholesale at commit, cancel, or by the abandoned-batch sweep.
 *
 * ONE surviving row is stamped `lastTouchedAt`: coming back to a batch is
 * proof of life, and a session an operator has just re-entered must not look
 * abandoned to the sweep. NEO-294 cut this from "every surviving row" — the
 * sweep spares a batch when ANY row is live, so the other 753 writes on a
 * 754-row review proved nothing the first one had not. See
 * `ENTITY_REVIEW_START_OPS`.
 *
 * The `batchId` is preserved throughout, because the client is already holding
 * it and a new one would strand the open wizard.
 *
 * ## NEO-294 — bounded, and idempotent so the bound costs nothing
 *
 * One call writes at most `ENTITY_REVIEW_START_OPS` operations' worth of rows
 * and re-schedules ITSELF for the rest, with the same arguments plus
 * `continueBatchId`. No cursor is needed and none would help: reconciliation
 * is a pure function of the batch's current rows and the incoming names, so
 * running it again converges — a row already inserted is suppressed by its
 * key, a row already deleted is simply absent, and a row that was never in
 * scope is never touched. That also makes an interrupted chain harmless: every
 * page committed on its own, and the next Confirm finishes the job.
 *
 * `continueBatchId` is the one thing a continuation needs that a re-Confirm
 * does not: permission to write only while the batch it belongs to is still
 * open. See the guard at the top of the handler.
 */
/**
 * NEO-254 — the enrichment a review row is BORN with.
 *
 * ## Why ambiguity is attached here and not only when the lookup lands
 *
 * `applyLookupResult` computes `existingCandidates` too, and for a while that
 * was the only place it happened. That left the marker missing on every row
 * whose lookup never produced one:
 *
 *   - `backstopEntityReviewRowImpl` settles a stranded row to "error" without
 *     going near `players`;
 *   - `sweepStalePendingRows` does the same for a row the pool lost entirely;
 *   - and any row already sitting in the queue at deploy time never re-runs
 *     its lookup at all.
 *
 * A row in any of those states is indistinguishable, to every consumer, from
 * a name nobody has ever heard of — so the wizard would promote one of two
 * same-name players to its one-tap primary, and the bulk create would mint a
 * third. The ambiguity is knowable the moment the row is inserted, from
 * `players` alone, with no network anywhere in it. So it is written then, and
 * the lookup merely REFRESHES it.
 *
 * Returns `undefined` rather than an empty object for an unambiguous name, so
 * an ordinary row is stored byte-identical to how it was before this existed.
 */
async function initialEnrichmentFor(
  ctx: MutationCtx,
  kind: "player" | "team",
  name: string,
  sportId: Id<"selectorOptions">,
  /**
   * NEO-254 — the set's own year, so each candidate can be marked as active in
   * it. Resolved once by the caller and passed down: it is one ancestor walk
   * per BATCH, not one per name.
   */
  cardYear: number | undefined,
): Promise<{ existingCandidates: Awaited<ReturnType<typeof buildExistingPlayerCandidates>> } | undefined> {
  if (kind !== "player") return undefined;
  const existingCandidates = await buildExistingPlayerCandidates(ctx, name, sportId, {
    cardYear,
  });
  return existingCandidates.length > 0 ? { existingCandidates } : undefined;
}

/** NEO-424 — one entry of `enrichment.existingCandidates`. */
type ExistingCandidate = NonNullable<
  NonNullable<Doc<"entityReviewQueue">["enrichment"]>["existingCandidates"]
>[number];

/**
 * NEO-424 — the candidates for a name the SET'S OWN HISTORY answers, by id,
 * plus what reading them cost `startBatch`'s budget.
 *
 * The rendering is `players.buildExistingPlayerCandidatesForIds` (unit A's),
 * so a history candidate and an in-sport one cannot disagree about what a
 * candidate looks like; each comes back with its home sport's `sportValue`.
 * Order is the caller's — the history player first, then in-sport rivals.
 *
 * The charge is the builder's ceiling rather than a count, because it does
 * not report one: per distinct id (capped at `MAX_CANDIDATES_FOR_IDS`) one
 * player read, one sport-label read and `PLAYER_DESCRIPTION_MAX_TEAMS` team reads.
 * Over-charging only pages a batch sooner; under-charging is the NEO-294
 * failure.
 */
async function buildCandidatesForPlayerIds(
  ctx: MutationCtx,
  name: string,
  playerIds: ReadonlyArray<Id<"players">>,
  opts: { cardYear: number | undefined },
): Promise<{ candidates: ExistingCandidate[]; ops: number }> {
  const distinct = Math.min(
    new Set(playerIds.map((id) => id as string)).size,
    MAX_CANDIDATES_FOR_IDS,
  );
  const candidates = await buildExistingPlayerCandidatesForIds(ctx, playerIds, {
    name,
    cardYear: opts.cardYear,
  });
  return { candidates, ops: distinct * (2 + PLAYER_DESCRIPTION_MAX_TEAMS) };
}

/**
 * NEO-424 — does this row carry candidates the batch took from the set's own
 * history?
 *
 * Those are the only candidates stamped with `sportValue`, and they are not
 * something the in-sport name index can re-derive: the history player may be
 * filed under another sport entirely. So the two places that rebuild a row's
 * candidates from the index — `applyLookupResult` after Create new, and the
 * bulk create's ambiguity test — must read them off the row instead.
 */
function historyCandidatesOf(
  enrichment: Doc<"entityReviewQueue">["enrichment"] | undefined,
): ExistingCandidate[] {
  return (enrichment?.existingCandidates ?? []).filter(
    (candidate) => candidate.sportValue !== undefined,
  );
}

/**
 * NEO-332 — does this enrichment make the row a CHOICE between players we
 * already hold?
 *
 * `buildExistingPlayerCandidates` returns [] unless two or more rows answer to
 * the name AND the card-year narrowing could not pick one, so any stored
 * candidate means exactly that. The same reading as the wizard's pick-step
 * predicate (`sameNameCandidates.length > 0`), so the server and the client
 * cannot disagree about which rows wait for the operator.
 */
function isSameNameChoice(
  enrichment: Doc<"entityReviewQueue">["enrichment"] | undefined,
): boolean {
  return (enrichment?.existingCandidates?.length ?? 0) > 0;
}

/**
 * NEO-332 — a same-name player row whose Wikidata lookup has not been asked
 * for yet.
 *
 * Jason, 2026-10-10: "we shouldn't even be querying wikidata at all in this
 * scenerio because there is no new player to query the data for." Two or more
 * players on file under the name means the operator's first question is WHICH
 * of them this card is. A lookup would describe a NEW person, and would stage
 * New Team steps for that person's career — ahead of a pick step whose usual
 * answer is "one of the people we already have", which needs none of it. So
 * the row is inserted settled (`ready`, carrying only its candidates), no
 * lookup is enqueued, and the lookup starts only when the operator presses
 * Create new (`requestPlayerLookup`).
 *
 * Derived from the row rather than stored, so no schema field is needed:
 *
 *   - `ready`, because every other road out of `pending` ends elsewhere. A
 *     lookup that answers writes a player result, and `PlayerLookupResult`
 *     always carries `wikidataId`; one that finds nothing, throws, is
 *     backstopped or is swept writes `error`. So a `ready` player row with
 *     candidates and NO `wikidataId` was never looked up at all.
 *   - `pending` is a lookup in flight (asked for, or enqueued before this
 *     shipped), and `error` / `wikidataId` are a lookup that already ran.
 *     None of those wait for anything.
 */
export function playerLookupAwaitsCreateNew(
  row: Pick<Doc<"entityReviewQueue">, "kind" | "status" | "enrichment">,
): boolean {
  return (
    row.kind === "player" &&
    row.status === "ready" &&
    awaitsOperatorBeforeLookup(row.enrichment) &&
    row.enrichment?.wikidataId === undefined
  );
}

/**
 * NEO-332 / NEO-424 — does this enrichment put an EXISTING player in front of
 * the operator before any new one is looked up?
 *
 * Two shapes, one rule. A same-name choice (`existingCandidates`) asks "which
 * of ours is this?"; a preselect (rule E, or an undone auto-link) asks "is it
 * this one of ours?". Either way the usual answer needs no new person, so
 * Jason's NEO-332 rule applies to both: "we shouldn't even be querying
 * wikidata at all in this scenerio because there is no new player to query
 * the data for." The row is born `ready` with no lookup enqueued, nothing is
 * staged ahead of the "Link to <name>" step, and the lookup starts only when
 * the operator says it is someone new — Create new on the pick step, or "Add
 * as New Player anyway" under a preselect — through `requestPlayerLookup`.
 *
 * Derived, like `playerLookupAwaitsCreateNew`: no stored field says "waiting".
 */
function awaitsOperatorBeforeLookup(
  enrichment: Doc<"entityReviewQueue">["enrichment"] | undefined,
): boolean {
  return isSameNameChoice(enrichment) || enrichment?.preselect !== undefined;
}

/**
 * NEO-294 — what ONE `startBatch` transaction may spend, counted in Convex
 * system operations.
 *
 * ## The failure this exists to stop
 *
 * Same wall, same seed job, one mutation earlier than the bulk decide above.
 * `startBatch` is what the operator's **Confirm** on the pairing modal blocks
 * on, and on CI run 35760682857's 2024 Topps Chrome sync it was handed 300 new
 * player names and 30 new team names in one call. Convex counts one system
 * operation per CALL — a `db.get`, an index read, an insert/patch/delete, a
 * `scheduler.runAfter` — and this handler makes a per-NAME call:
 *
 *   FRESH path, per player name
 *     2 — `initialEnrichmentFor` → `buildExistingPlayerCandidates` →
 *         `sameNamePlayers`: the `players` name index plus the `playerAliases`
 *         index. Paid for EVERY name, ambiguous or not.
 *     … — and when two or more rows already answer to that name, up to
 *         PLAYER_AMBIGUITY_SCAN_LIMIT alias `db.get`s plus
 *         PLAYER_DESCRIPTION_MAX_TEAMS team reads per candidate for the career
 *         summary (the narrowing itself reads no teams here — this caller
 *         passes no `cardTeamNames`).
 *     1 — the insert.
 *   FRESH path, per team name
 *     1 — the insert. Teams carry no ambiguity marker.
 *   RESUME path
 *     1 — the `.first()` that finds the open batch
 *     1 — the `.collect()` of its rows (ONE op whatever the row count; the
 *         documents land against the separate read budget, not this one)
 *     1 — PER EXISTING ROW, unconditionally: a `delete` for a name the
 *         incoming set dropped, or a `patch` stamping `lastTouchedAt`.
 *
 * So a bare 300-player fresh batch is ~930 operations before a single
 * ambiguous name, and a handful of common surnames push it past 3,000. The
 * resume path is worse in the ordinary case: ~755 writes on a 754-row batch
 * before ONE new name is even considered, and it fires on every re-Confirm and
 * every re-sync with a batch open — which is more common than the fresh path.
 *
 * ## The budget, and the two things that made it fit
 *
 * `CARDS_PER_COMMIT_CHUNK` (selectorOptions.ts) measured the ceiling from the
 * same Convex error in NEO-189: ~900 operations per transaction is
 * comfortable, ~1,800 strains, ~4,000 fails outright. 800 leaves ~11% headroom
 * for this handler's fixed overhead — the batch lookup, the ancestor walk for
 * the set year (at most MAX_ANCESTOR_DEPTH = 16 `db.get`s), the pool enqueue,
 * and the continuation schedule — so the worst transaction lands near ~820.
 *
 * Two changes do the work; the page is what catches what is left.
 *
 * 1. **The resume path stamps ONE row, not all of them.** `lastTouchedAt` has
 *    exactly one reader, `sweepAbandonedBatches`, and its test is
 *    `all.some((row) => lastTouched(row) >= cutoff)` — ANY live row spares the
 *    whole batch. 754 stamps were 753 writes proving something one stamp
 *    already proves. That turns the ordinary resume (nothing dropped, nothing
 *    added) from ~755 operations into about five.
 * 2. **Every write is charged against this budget**, drops and inserts alike,
 *    and the ambiguity read is charged at what it actually costs.
 *
 * ## When the budget runs out
 *
 * The call stops writing and re-schedules ITSELF with identical arguments. It
 * does not need a cursor, because the resume path is idempotent and
 * convergent: a row already inserted is found by `existingKeys` and not
 * inserted twice, a row already deleted is simply not there, and the incoming
 * set is recomputed from the same arguments. A truncated FRESH call leaves a
 * batch behind, so its continuation takes the resume branch and finishes the
 * same list. Each page commits on its own, so an interrupted run keeps every
 * row it wrote and the next Confirm converges on the rest.
 *
 * Truncation is REPORTED — a `console.warn` with counts and ids, never a name
 * (the observability.ts rule) — rather than silently doing less.
 *
 * The return value stays a bare `batchId`: the caller
 * (`selectorOptions.resolveUnknownsAndStartBatch`) assigns it directly, and a
 * `{ batchId, hasMore }` shape would make every caller responsible for a walk
 * the scheduler already drives. Nothing downstream can observe the split
 * either — truncation only happens once there are 800 operations' worth of
 * work, which means several hundred undecided rows are already in the batch
 * when the wizard opens, and the wizard's Confirm & Save appears only when
 * EVERY row is decided. No operator clears several hundred rows in the
 * milliseconds a `runAfter(0)` takes.
 */
export const ENTITY_REVIEW_START_OPS = 800;

/**
 * NEO-643 — the caller (`selectorOptions`) refuses a player or team name longer
 * than `MAX_PLAYER_NAME_LENGTH` (`assertCardBatchWithinLimits`) BEFORE the names
 * reach `startBatch`, but it checks the RAW text, and cleansing composes to NFC,
 * which can lengthen a string (U+0958 composes to two characters). So the same
 * bound is applied again to what is actually about to be stored. Refused by
 * length and position, never by echoing the name.
 */
function assertStartBatchNamesWithinLimit(args: {
  playerNames: string[];
  teamNames: string[];
  playersWithNoExistingMatch?: string[];
}): void {
  const lists: Array<[string, string[]]> = [
    ["player", args.playerNames],
    ["team", args.teamNames],
    ["no-existing-match player", args.playersWithNoExistingMatch ?? []],
  ];
  for (const [kind, names] of lists) {
    names.forEach((name, index) => {
      if (name.length > MAX_PLAYER_NAME_LENGTH) {
        throw new Error(
          `startBatch: the ${kind} name at index ${index} is ${name.length} characters once cleansed; the limit is ${MAX_PLAYER_NAME_LENGTH}.`,
        );
      }
    });
  }
}

/**
 * NEO-643 — `startBatch`'s args with every NAME in them cleansed
 * (`cleanseExternalName`): the incoming player and team lists, the caller's
 * "no existing match" set, the names the facts are about, and the names and
 * printed teams a step's context displays. Ids and every other field pass
 * through untouched. Idempotent, which the self-scheduled continuation relies
 * on, and the lists keep their length and order, so nothing that lines up
 * with them can drift.
 */
function cleanseStartBatchNames<
  A extends {
    playerNames: string[];
    teamNames: string[];
    playersWithNoExistingMatch?: string[];
    autoLinks?: Array<{ name: string }>;
    historyCandidates?: Array<{ name: string }>;
    preselects?: Array<{ name: string }>;
    teamContexts?: Array<{
      name: string;
      cards: Array<{ players: Array<{ name: string }> }>;
    }>;
    playerContexts?: Array<{ name: string; cards: Array<{ teams: string[] }> }>;
  },
>(args: A): A {
  const named = <T extends { name: string }>(rows: T[] | undefined): T[] | undefined =>
    rows?.map((row) => ({ ...row, name: cleanseExternalName(row.name) }));
  return {
    ...args,
    playerNames: args.playerNames.map(cleanseExternalName),
    teamNames: args.teamNames.map(cleanseExternalName),
    ...(args.playersWithNoExistingMatch
      ? { playersWithNoExistingMatch: args.playersWithNoExistingMatch.map(cleanseExternalName) }
      : {}),
    ...(args.autoLinks ? { autoLinks: named(args.autoLinks) } : {}),
    ...(args.historyCandidates ? { historyCandidates: named(args.historyCandidates) } : {}),
    ...(args.preselects ? { preselects: named(args.preselects) } : {}),
    ...(args.teamContexts
      ? {
          teamContexts: args.teamContexts.map((fact) => ({
            ...fact,
            name: cleanseExternalName(fact.name),
            cards: fact.cards.map((card) => ({
              ...card,
              players: card.players.map((p) => ({ ...p, name: cleanseExternalName(p.name) })),
            })),
          })),
        }
      : {}),
    ...(args.playerContexts
      ? {
          playerContexts: args.playerContexts.map((fact) => ({
            ...fact,
            name: cleanseExternalName(fact.name),
            cards: fact.cards.map((card) => ({
              ...card,
              teams: card.teams.map(cleanseExternalName),
            })),
          })),
        }
      : {}),
  };
}

/**
 * NEO-294 — what one `initialEnrichmentFor` call is charged.
 *
 * `BASE` is the pair of index reads `sameNamePlayers` always performs. `EXTRA`
 * is the ceiling on everything an AMBIGUOUS name adds on top: one `db.get` per
 * alias hit, and `PLAYER_DESCRIPTION_MAX_TEAMS` team reads per candidate for the
 * career summary (deduped by id across candidates, so this over-charges rather
 * than under-charges). Charged after the call, from whether candidates came
 * back — the cheap answer is by far the common one, and charging every name
 * the worst case would cut the page to a quarter of the names it can actually
 * afford.
 */
const REVIEW_NAME_LOOKUP_OPS = {
  // NEO-313: three index reads now — `players`, `playerSports`, `playerAliases`.
  BASE: 3,
  EXTRA: PLAYER_AMBIGUITY_SCAN_LIMIT * (PLAYER_DESCRIPTION_MAX_TEAMS + 1),
} as const;

export const startBatch = internalMutation({
  args: {
    selectorOptionId: v.id("selectorOptions"),
    createdByUserId: v.string(),
    sportId: v.id("selectorOptions"),
    playerNames: v.array(v.string()),
    teamNames: v.array(v.string()),
    /**
     * NEO-294 — set ONLY on the continuation this mutation schedules for
     * itself, and never by the caller.
     *
     * It names the batch the chain belongs to, so a link that lands after that
     * batch is gone — cancelled, committed, or reaped — stops instead of
     * minting a fresh batch full of names nobody asked about again. Absent is
     * the operator's own Confirm, which is always allowed to start one.
     */
    continueBatchId: v.optional(v.string()),
    /**
     * NEO-296 — player names the CALLER has already established match no
     * existing row, so this mutation need not ask again.
     *
     * `resolveUnknownsAndStartBatch` reaches this function only for names its
     * own `players.resolveNameForReview` could not resolve, and that query
     * already returns `matchCount` from the very index pair
     * `initialEnrichmentFor` is about to read. A name with `matchCount === 0`
     * has nothing for `buildExistingPlayerCandidates` to find, so the two
     * index reads it costs are spent proving something the caller was just
     * told. On a first-time sync — where almost every unknown name is
     * genuinely new — that is 2 operations × the whole list, ~600 on the
     * 300-player 2024 Topps Chrome batch, against a per-transaction budget of
     * `ENTITY_REVIEW_START_OPS` (800).
     *
     * A SET of names rather than a parallel array, so it cannot be silently
     * misaligned with `playerNames` by an edit to either.
     *
     * ## What a stale entry costs, and why it is acceptable here
     *
     * The caller's answer is a snapshot. If another session inserts a player
     * of that name in the milliseconds between the two calls, this skips the
     * lookup and the row is written without `enrichment.existingCandidates` —
     * so the wizard does not pre-offer the link and the operator reaches the
     * same row through the search box instead. Nothing is mis-created: the
     * paths that could mint a duplicate (`recordAllRemainingAsCreate`, the
     * commit prelude) all re-ask the LIVE index and are untouched by this.
     *
     * Absent, or a name not in it, means "ask" — so an old caller, a
     * hand-written call and the continuation below all behave exactly as
     * before.
     */
    playersWithNoExistingMatch: v.optional(v.array(v.string())),
    /**
     * ── NEO-424: FACTS the gate established, never questions ──────────────
     *
     * Same contract as `playersWithNoExistingMatch`: the caller
     * (`resolveUnknownsAndStartBatch`, through `setHistory.ts`) has already
     * done the reading, in bounded internal queries from its action, and this
     * mutation only writes what it was told. Every one is optional, so an old
     * caller, a hand-written call and the continuation (`...args`) all behave
     * exactly as before — the continuation carries the facts with it, and the
     * resume path's `existingKeys` dedupe stops a page re-inserting a row the
     * previous page wrote.
     *
     * `autoLinks` — a name the batch ANSWERS (rule A set history, rule D the
     * Hall of Fame tie-break, rule F a team the card prints). Inserted as a
     * decided `link` row tagged `autoLinked`, `ready`, with no lookup: one
     * insert, no `initialEnrichmentFor`. `rowSportId` is the linked player's
     * HOME sport (D2), so the row's sport and its link agree and nothing is
     * written to the player at commit. `candidatePlayerIds` (history player
     * first, then in-sport rivals) is what Change turns back into a pick step;
     * the candidates are only built when there are two or more, because one
     * is not a choice (`clearDecision` offers it as the preselect instead).
     *
     * `historyCandidates` — a name the set's history links to TWO OR MORE
     * players. Inserted `ready` carrying those players as candidates (any
     * sport, each with `sportValue`) and NOT looked up, exactly as a same-name
     * choice is (NEO-332): the operator's first question is which of them it
     * is, and Create new starts the lookup.
     *
     * `preselects` — rule E: a name with an obvious candidate the operator
     * still confirms. Stored on `enrichment.preselect` and, like a same-name
     * choice, inserted `ready` with NO lookup (`awaitsOperatorBeforeLookup`):
     * there is no new player to look up until the operator presses "Add as
     * New Player anyway", which goes through `requestPlayerLookup`.
     *
     * A name in `autoLinks` ignores any `historyCandidates` or `preselects`
     * entry for the same key, and a `historyCandidates` name keeps its
     * preselect. Names are matched by the same normalizers the batch keys on,
     * so a fact about "J.T. Realmuto" applies to "JT Realmuto".
     */
    autoLinks: v.optional(v.array(v.object({
      kind: v.union(v.literal("player"), v.literal("team")),
      name: v.string(),
      playerId: v.optional(v.id("players")),
      teamId: v.optional(v.id("teams")),
      rowSportId: v.id("selectorOptions"),
      origin: autoLinkOriginValidator,
      candidatePlayerIds: v.optional(v.array(v.id("players"))),
    }))),
    historyCandidates: v.optional(v.array(v.object({
      name: v.string(),
      playerIds: v.array(v.id("players")),
    }))),
    preselects: v.optional(v.array(v.object({
      name: v.string(),
      playerId: v.id("players"),
      sportId: v.id("selectorOptions"),
      sportValue: v.string(),
      reason: v.union(v.literal("priorYearProduct"), v.literal("onlyNamesake")),
    }))),
    /**
     * NEO-602 — what each TEAM step shows: the cards that printed the name,
     * their players, and the rows the name reached. A fact the gate read from
     * the cards (which are not committed yet, so nothing else can find them),
     * written onto the team row as `teamContext` at insert. Display only.
     * Matched to a row by the normalized team name, like every fact above, and
     * carried by the continuation in `...args`.
     */
    teamContexts: v.optional(v.array(teamContextFactValidator)),
    /**
     * NEO-602 — what each same-name PLAYER step shows: the cards that printed
     * the name, with the team printed on each. A fact the gate read from the
     * cards (not committed yet, so nothing else can find them), written onto
     * the player row as `playerContext` at insert. Display only. Matched to a
     * row by the normalized player name, and carried by the continuation in
     * `...args`.
     */
    playerContexts: v.optional(v.array(playerContextFactValidator)),
  },
  returns: v.string(),
  handler: async (ctx, incomingArgs): Promise<string> => {
    // NEO-643 — every external name is cleansed before it is keyed, stored or
    // shown (BSC's "R\ios" for Ríos, stray soft hyphens and zero-width
    // characters). The continuation re-enters with these cleansed args, and
    // cleansing is idempotent, so a chain never re-cleans into a different name.
    const args = cleanseStartBatchNames(incomingArgs);
    assertStartBatchNamesWithinLimit(args);
    /**
     * NEO-294 — system operations this transaction has spent. See
     * ENTITY_REVIEW_START_OPS for what each write and each name lookup costs
     * and for what happens when the budget runs out.
     */
    let ops = 0;
    /** Work this call deliberately left for its own continuation. */
    let deferred = 0;
    /**
     * NEO-296 — names the caller already proved match nothing. Membership is
     * tested on the RAW name, which is what `playerNames` carries and what
     * `resolveNameForReview` was asked about, so the two sides agree without a
     * second normalisation to keep in step.
     */
    const noExistingMatch = new Set(args.playersWithNoExistingMatch ?? []);
    /**
     * Hand the rest of this call to the scheduler, tagged with the batch it
     * belongs to. Separate from the pool enqueue below so the two cannot be
     * confused: one continues THIS function, the other starts the Wikidata
     * lookups.
     */
    const deferRemainder = async (batchId: string): Promise<void> => {
      if (deferred === 0) return;
      // Ids and counts only — never a name. See the no-PII rule in
      // observability.ts.
      console.warn(
        JSON.stringify({
          msg: "entity_review_start_batch_paged",
          selectorOptionId: args.selectorOptionId,
          ops,
          deferred,
        }),
      );
      await ctx.scheduler.runAfter(0, internal.entityReviewQueue.startBatch, {
        ...args,
        continueBatchId: batchId,
      });
    };
    // NEO-254 — the set's own year, walked ONCE per batch rather than once per
    // name. It only labels which same-name candidates were active that year;
    // an undefined year simply leaves every candidate unlabelled.
    const setYear = await findSetYearForSelectorOption(ctx, args.selectorOptionId);
    // Keyed the same way on both sides of the reconciliation below, and by
    // the same normalizers `players`/`teams` dedupe on, so "J.T. Realmuto"
    // and "JT Realmuto" are one name here exactly as they are one row there.
    /*
     * NEO-254 — a league key uses `normalizeLeagueName`, which does NOT
     * token-sort.
     *
     * `normalizeTeamName` sorts tokens so "San Diego Padres" and
     * ("San Diego", "Padres") land on one key. That is exactly wrong for a
     * league: "National League" and "League National" are not the same
     * competition, and `convex/leagues.ts` says so in its own normaliser. The
     * kind prefix keeps the two key spaces apart, so a league and a team of
     * the same name never collide here either.
     */
    const keyFor = (kind: "player" | "team" | "league", name: string) =>
      kind === "player"
        ? `player:${normalizePlayerName(name)}`
        : kind === "league"
          ? `league:${normalizeLeagueName(name)}`
          : `team:${normalizeTeamName(name)}`;

    /*
     * NEO-424 — the gate's facts, keyed exactly like the rows they describe.
     *
     * Built from the arguments alone, so the continuation (which re-sends them)
     * rebuilds the same maps and converges with the page before it. A fact for
     * a key with nothing to normalise is dropped, as is a malformed auto-link
     * (a player link without a player, a team link without a team, or a Hall
     * of Fame team): this is an internal contract, and a broken entry must
     * cost its one name a wizard step rather than cost the operator the fetch.
     */
    type AutoLinkFact = NonNullable<typeof args.autoLinks>[number];
    type PreselectFact = NonNullable<typeof args.preselects>[number];
    type FactRow = {
      kind: "player" | "team";
      name: string;
      auto?: AutoLinkFact;
      historyPlayerIds?: Array<Id<"players">>;
    };
    const isBlankKey = (kind: "player" | "team", key: string) =>
      key.length <= kind.length + 1;
    /** Rows the facts decide or shape, in the order they were given. */
    const factRows = new Map<string, FactRow>();
    let malformedFacts = 0;
    for (const link of args.autoLinks ?? []) {
      const wellFormed =
        link.kind === "player"
          ? link.playerId !== undefined && link.teamId === undefined
          : link.teamId !== undefined &&
            link.playerId === undefined &&
            // NEO-490: a team is auto-linked by set history (rule F) or by
            // the card's own player (careerTeam), never by Hall of Fame.
            // An allowlist, not a denylist: an origin added later is refused
            // for teams until someone decides it may link one.
            (link.origin === "setHistory" || link.origin === "careerTeam");
      const key = keyFor(link.kind, link.name);
      if (!wellFormed || isBlankKey(link.kind, key)) {
        malformedFacts += 1;
        continue;
      }
      if (!factRows.has(key)) {
        factRows.set(key, { kind: link.kind, name: link.name, auto: link });
      }
    }
    for (const history of args.historyCandidates ?? []) {
      const key = keyFor("player", history.name);
      if (isBlankKey("player", key) || history.playerIds.length === 0) {
        malformedFacts += 1;
        continue;
      }
      // An auto-link for the same key wins: the batch has an answer, so there
      // is no choice left to offer.
      if (factRows.has(key)) continue;
      factRows.set(key, {
        kind: "player",
        name: history.name,
        historyPlayerIds: history.playerIds,
      });
    }
    /** NEO-602 — each team step's context, by the row key it belongs to. */
    const teamContextByKey = new Map<
      string,
      NonNullable<Doc<"entityReviewQueue">["teamContext"]>
    >();
    for (const fact of args.teamContexts ?? []) {
      const key = keyFor("team", fact.name);
      if (isBlankKey("team", key) || teamContextByKey.has(key)) continue;
      teamContextByKey.set(key, {
        candidateTeamIds: fact.candidateTeamIds,
        ...(fact.place ? { place: true as const } : {}),
        cards: fact.cards,
        moreCards: fact.moreCards,
      });
    }
    const teamContextFor = (key: string) => {
      const teamContext = teamContextByKey.get(key);
      return teamContext ? { teamContext } : {};
    };
    /** NEO-602 — each same-name player step's context, by the row key it belongs to. */
    const playerContextByKey = new Map<
      string,
      NonNullable<Doc<"entityReviewQueue">["playerContext"]>
    >();
    for (const fact of args.playerContexts ?? []) {
      const key = keyFor("player", fact.name);
      if (isBlankKey("player", key) || playerContextByKey.has(key)) continue;
      playerContextByKey.set(key, { cards: fact.cards, moreCards: fact.moreCards });
    }
    const playerContextFor = (key: string) => {
      const playerContext = playerContextByKey.get(key);
      return playerContext ? { playerContext } : {};
    };
    const preselectByKey = new Map<string, PreselectFact>();
    for (const preselect of args.preselects ?? []) {
      const key = keyFor("player", preselect.name);
      if (isBlankKey("player", key)) {
        malformedFacts += 1;
        continue;
      }
      if (factRows.get(key)?.auto) continue;
      if (!preselectByKey.has(key)) preselectByKey.set(key, preselect);
    }
    if (malformedFacts > 0) {
      // Counts only — never a name (observability.ts).
      console.warn(
        JSON.stringify({
          msg: "entity_review_start_batch_malformed_facts",
          selectorOptionId: args.selectorOptionId,
          malformedFacts,
        }),
      );
    }
    /** Lay a preselect over a row's born-with enrichment, when it has one. */
    const withPreselect = (
      key: string,
      enrichment: Doc<"entityReviewQueue">["enrichment"] | undefined,
    ): Doc<"entityReviewQueue">["enrichment"] | undefined => {
      const preselect = preselectByKey.get(key);
      if (!preselect) return enrichment;
      return { ...(enrichment ?? {}), preselect };
    };
    /**
     * What this call auto-linked, for one log line at the end: row ids, link
     * ids and origins — never a name (observability.ts).
     */
    const autoLinkLog: Array<{
      rowId: Id<"entityReviewQueue">;
      origin: AutoLinkFact["origin"];
      playerId?: Id<"players">;
      teamId?: Id<"teams">;
    }> = [];
    const logAutoLinks = (batchId: string) => {
      if (autoLinkLog.length === 0) return;
      console.log(
        JSON.stringify({
          msg: "entity_review_auto_linked",
          selectorOptionId: args.selectorOptionId,
          batchId,
          links: autoLinkLog,
        }),
      );
    };
    /**
     * NEO-424 — insert one row the gate's facts decide or shape. The caller has
     * already checked the budget; this charges what it spends.
     *
     *   - an AUTO-LINK is born decided and `ready`, in `rowSportId`, and is
     *     never looked up: one insert, plus the candidate reads when Change
     *     will need a pick step (two or more players);
     *   - a HISTORY CHOICE is born `ready` with its candidates and waits for
     *     Create new, like a same-name choice (NEO-332). If every one of its
     *     players has gone since the gate read them, it falls back to the
     *     ordinary new-name row it would otherwise have been.
     *
     * Returns whether the row's lookup should be enqueued.
     */
    const insertFactRow = async (
      batchId: string,
      key: string,
      fact: FactRow,
      name: string,
    ): Promise<{ id: Id<"entityReviewQueue">; enqueue: boolean }> => {
      const base = {
        selectorOptionId: args.selectorOptionId,
        batchId,
        createdByUserId: args.createdByUserId,
        kind: fact.kind,
        name,
        // NEO-236 — the same slice the resume path stores; see there.
        nameNormalized: key.slice(fact.kind.length + 1),
      };
      if (fact.auto) {
        const link = fact.auto;
        let enrichment: Doc<"entityReviewQueue">["enrichment"] | undefined;
        if (link.kind === "player" && link.playerId !== undefined) {
          const linkedId = link.playerId;
          const ids = [
            linkedId,
            ...(link.candidatePlayerIds ?? []).filter((id) => id !== linkedId),
          ];
          if (ids.length >= 2) {
            const built = await buildCandidatesForPlayerIds(ctx, name, ids, {
              cardYear: setYear,
            });
            ops += built.ops;
            if (built.candidates.length >= 2) {
              enrichment = { existingCandidates: built.candidates };
            }
          }
        }
        const id = await ctx.db.insert("entityReviewQueue", {
          ...base,
          sportId: link.rowSportId,
          status: "ready",
          ...(enrichment ? { enrichment } : {}),
          // NEO-602 — a Change turns a linked team back into a team step, which
          // shows these cards and rows.
          ...(link.kind === "team" ? teamContextFor(key) : {}),
          // NEO-602 — and a Change on a linked player turns it back into a pick
          // step, which shows the cards that printed the name.
          ...(link.kind === "player" ? playerContextFor(key) : {}),
          decision:
            link.kind === "player"
              ? { action: "link", linkedPlayerId: link.playerId, autoLinked: link.origin }
              : { action: "link", linkedTeamId: link.teamId, autoLinked: link.origin },
        });
        ops += 1;
        autoLinkLog.push({
          rowId: id,
          origin: link.origin,
          ...(link.playerId ? { playerId: link.playerId } : {}),
          ...(link.teamId ? { teamId: link.teamId } : {}),
        });
        return { id, enqueue: false };
      }

      const built = await buildCandidatesForPlayerIds(
        ctx,
        name,
        fact.historyPlayerIds ?? [],
        { cardYear: setYear },
      );
      ops += built.ops;
      if (built.candidates.length === 0) {
        const born = await initialEnrichmentFor(ctx, "player", name, args.sportId, setYear);
        ops +=
          REVIEW_NAME_LOOKUP_OPS.BASE + (born ? REVIEW_NAME_LOOKUP_OPS.EXTRA : 0) + 1;
        const enrichment = withPreselect(key, born);
        const awaitsChoice = awaitsOperatorBeforeLookup(enrichment);
        const id = await ctx.db.insert("entityReviewQueue", {
          ...base,
          sportId: args.sportId,
          status: awaitsChoice ? "ready" : "pending",
          ...(enrichment ? { enrichment } : {}),
          ...playerContextFor(key),
        });
        return { id, enqueue: !awaitsChoice };
      }
      const id = await ctx.db.insert("entityReviewQueue", {
        ...base,
        // The question is asked in the set's sport like any other; a
        // cross-sport pick re-points it (`recordDecision`, D7).
        sportId: args.sportId,
        status: "ready",
        enrichment: withPreselect(key, { existingCandidates: built.candidates }),
        ...playerContextFor(key),
      });
      ops += 1;
      return { id, enqueue: false };
    };

    const existing = await ctx.db
      .query("entityReviewQueue")
      .withIndex("by_selector_option_and_user", (q) =>
        q
          .eq("selectorOptionId", args.selectorOptionId)
          .eq("createdByUserId", args.createdByUserId),
      )
      .first();
    ops += 1;

    /*
     * NEO-294 — a continuation whose batch is GONE does nothing at all.
     *
     * Paging opened one window the single-transaction version could not have:
     * the operator cancels (or the wizard commits) between two links of the
     * chain. Without this guard the next link finds no open batch, takes the
     * FRESH path, and mints a brand-new batch full of the names the operator
     * has just finished dealing with — a wizard that reopens itself.
     *
     * Costs nothing: the read it decides on is the one every call already
     * makes. A mismatched id means this chain's batch was replaced by another,
     * which is the same answer.
     */
    if (
      args.continueBatchId !== undefined &&
      existing?.batchId !== args.continueBatchId
    ) {
      // Ids only — never a name. See the no-PII rule in observability.ts.
      console.warn(
        JSON.stringify({
          msg: "entity_review_start_batch_abandoned",
          selectorOptionId: args.selectorOptionId,
        }),
      );
      return args.continueBatchId;
    }

    if (existing) {
      const batchId = existing.batchId;
      // Scoped to the resumed batch itself, not to every row this user has for
      // this selectorOption: one user only ever holds one batch at a time (a
      // commit or a cancel deletes it), and reading through the batch index
      // keeps that assumption from silently deleting a stray row from another.
      const existingRows = await ctx.db
        .query("entityReviewQueue")
        .withIndex("by_selector_option_and_batch", (q) =>
          q.eq("selectorOptionId", args.selectorOptionId).eq("batchId", batchId),
        )
        .collect();
      // NEO-294 — ONE operation whatever the row count. The documents
      // themselves land against Convex's separate read budget (~32k docs), not
      // against the system-operation ceiling this handler is bounding.
      ops += 1;

      // Incoming names, deduped by key so two spellings of one name cannot
      // insert two rows. First spelling wins, matching how
      // `resolveUnknownsAndStartBatch` picks the label it surfaces.
      const incoming = new Map<string, { kind: "player" | "team"; name: string }>();
      for (const name of args.playerNames) {
        const key = keyFor("player", name);
        if (!incoming.has(key)) incoming.set(key, { kind: "player", name });
      }
      for (const name of args.teamNames) {
        const key = keyFor("team", name);
        if (!incoming.has(key)) incoming.set(key, { kind: "team", name });
      }
      // NEO-424 — a name the facts answer or shape is incoming too, whether or
      // not the caller also listed it: otherwise the drop test below would
      // delete an undecided row for it as "a name no card carries".
      for (const [key, fact] of factRows) {
        if (!incoming.has(key)) incoming.set(key, { kind: fact.kind, name: fact.name });
      }

      const now = Date.now();
      const existingKeys = new Set<string>();
      /*
       * NEO-236 security review, finding 4 — a staged step whose player is gone.
       *
       * The exemption below keeps every `careerTeamOf` row through
       * reconciliation, because its name is never in the incoming list. That is
       * right while the player it was staged for is still in the batch, and
       * wrong once the player has been reconciled away: the step then asks the
       * operator to create a team that nothing needs, and blocks "all reviewed"
       * on it forever. So an UNDECIDED orphan is dropped in the same pass. A
       * DECIDED one is kept, for the same reason every decided row is — the
       * operator ruled on it, and the prelude will still honour that ruling.
       */
      const survivingRowIds = new Set(
        existingRows
          .filter((row) => incoming.has(keyFor(row.kind, row.name)) || row.decision !== undefined)
          .map((row) => row._id as string),
      );
      /**
       * NEO-254 — does this row's whole chain still stand?
       *
       * A staged row is NEVER in `incoming` (no card carries its name), so it
       * cannot be judged against `survivingRowIds` directly — that set only
       * means something for a row that came off the checklist. A staged row is
       * judged by its PARENT, recursively: a league by its team, and that team
       * by the player it was staged for. Judging a league against
       * `survivingRowIds` would delete every league under a live staged team,
       * because that team is not in the set either.
       *
       * A DECIDED row survives on its own account at every level — the
       * operator ruled on it, and the prelude will still honour that ruling.
       *
       * Depth is two by construction; the `seen` guard makes a cycle terminate
       * rather than wedge the mutation.
       */
      const rowsById = new Map(existingRows.map((r) => [r._id as string, r]));
      const rowSurvives = (
        row: Doc<"entityReviewQueue">,
        seen: Set<string> = new Set(),
      ): boolean => {
        if (row.decision !== undefined) return true;
        const id = row._id as string;
        if (seen.has(id)) return false;
        seen.add(id);
        const parentId =
          row.source?.kind === "careerTeamOf"
            ? (row.source.playerRowId as string)
            : row.source?.kind === "leagueOf"
              ? (row.source.teamRowId as string)
              : null;
        // Came off the checklist: still incoming, or it goes.
        if (parentId === null) return survivingRowIds.has(id);
        const parent = rowsById.get(parentId);
        return parent ? rowSurvives(parent, seen) : false;
      };

      /**
       * NEO-294 — rows this pass has deleted, so the proof-of-life stamp below
       * lands on one that is still there.
       */
      const droppedIds = new Set<string>();
      for (const row of existingRows) {
        const key = keyFor(row.kind, row.name);
        // Recorded BEFORE the drop test, so a decided row that is no longer
        // incoming still suppresses a re-insert of its own name.
        //
        // NEO-294 — and recorded before the BUDGET test too, which matters
        // more. A row this call ran out of budget to delete is still a row in
        // the batch, and its key must still suppress an insert of the same
        // name; the scan itself costs nothing (`existingRows` is already in
        // hand), so the loop runs to the end whatever the budget says.
        existingKeys.add(key);
        if (
          !incoming.has(key) &&
          row.decision === undefined &&
          // NEO-236 — a row the BATCH staged for itself is never in the
          // incoming set, and never can be.
          //
          // The incoming list is the checklist's own player and team names. A
          // career team pulled off a player's Wikidata history is not one of
          // them — no card carries "Sydney Blue Sox" — so the drop test above
          // reads it as "a question about a name nothing needs" and deletes it.
          // It is the opposite: it is a question the batch RAISED, about a team
          // one of its own players needs, and deleting it on a resume would
          // leave that player's chips reading "needs a team decision" with no
          // step left anywhere to answer. (Nothing re-stages it either: the
          // enrichment that staged it has already landed, and the wizard's
          // belt-and-braces pass fires once per row per session.)
          //
          // The rule the drop test encodes still holds, it just does not apply
          // here: reconciliation is about names DERIVED from the incoming set,
          // and `source` marks the rows that are not.
          row.source === undefined
        ) {
          // Gone from the incoming set and never ruled on — a question about
          // a name no card carries. A DECIDED row is kept; see the doc above.
          if (ops >= ENTITY_REVIEW_START_OPS) {
            deferred += 1;
            continue;
          }
          await ctx.db.delete(row._id);
          droppedIds.add(row._id as string);
          ops += 1;
          continue;
        }
        /*
         * NEO-236 security review, finding 4 / NEO-254 — a staged step is
         * exempt from the test above, but not from being orphaned.
         *
         * Its parent is judged by the SAME rule (still incoming, or decided),
         * so a step and the row that needs it are dropped together or kept
         * together. A league staged for a team that was reconciled away is the
         * league tier of the same defect: left behind, it is undecided, unowned
         * and blocks "all reviewed" forever.
         *
         * `survivingStagedRowIds` is TRANSITIVE, and that is load-bearing: a
         * staged row is never in `incoming` (no card carries its name), so a
         * naive `survivingRowIds` check would judge every league by a set its
         * live parent team is not in and delete the lot.
         */
        if (row.source !== undefined && !rowSurvives(row)) {
          if (ops >= ENTITY_REVIEW_START_OPS) {
            deferred += 1;
            continue;
          }
          await ctx.db.delete(row._id);
          droppedIds.add(row._id as string);
          ops += 1;
          continue;
        }
      }

      /*
       * NEO-294 — re-entering the batch is operator activity, and ONE stamp
       * says so.
       *
       * This used to patch `lastTouchedAt` on every surviving row: 754 writes
       * on the seed job's batch, before a single new name was considered, on
       * the path that fires every time an operator re-Confirms. The field has
       * exactly one reader, `sweepAbandonedBatches`, and its test is
       * `all.some((row) => lastTouched(row) >= cutoff)` — ANY row past the
       * cutoff spares the WHOLE batch, because a batch is one session (see the
       * sweep's "every row, not any row" note, which is about what makes a
       * batch DEAD, not about what keeps it alive). So 753 of those writes
       * proved something the 754th already proved.
       *
       * It lands on a row this pass did NOT drop, for the obvious reason. If
       * nothing survives, nothing is stamped and nothing needs to be: either
       * this resume inserts rows, whose `_creationTime` is itself proof of life
       * (`max(_creationTime, lastTouchedAt ?? 0)`), or the batch is empty and
       * the sweep's `all.length === 0` guard skips it.
       */
      const alive = existingRows.find((row) => !droppedIds.has(row._id as string));
      if (alive !== undefined) {
        if (ops >= ENTITY_REVIEW_START_OPS) {
          deferred += 1;
        } else {
          await ctx.db.patch(alive._id, { lastTouchedAt: now });
          ops += 1;
        }
      }

      const addedIds: Array<Id<"entityReviewQueue">> = [];
      for (const [key, { kind, name }] of incoming) {
        if (existingKeys.has(key)) continue;
        // NEO-294 — an insert costs a name lookup plus the write itself, and
        // the budget is checked BEFORE the lookup so a refused row costs
        // nothing at all. The rest come back on the continuation.
        if (ops >= ENTITY_REVIEW_START_OPS) {
          deferred += 1;
          continue;
        }
        // NEO-424 — a name the gate's facts answer (auto-link) or shape (a
        // history choice). Same `existingKeys` dedupe as every other insert,
        // so a row the operator already has — decided or not — is left alone.
        const fact = factRows.get(key);
        if (fact) {
          const inserted = await insertFactRow(batchId, key, fact, name);
          if (inserted.enqueue) addedIds.push(inserted.id);
          continue;
        }
        // NEO-254 — see `initialEnrichmentFor`. A row added by a resume is as
        // liable to be an ambiguous name as one from a fresh batch.
        //
        // NEO-296 — unless the caller already asked. See
        // `playersWithNoExistingMatch`: a name with no matching row has no
        // candidates to find, and the read is charged only when it happens.
        const skipLookup = kind === "player" && noExistingMatch.has(name);
        const bornWith = skipLookup
          ? undefined
          : await initialEnrichmentFor(ctx, kind, name, args.sportId, setYear);
        // NEO-424 — rule E's suggestion rides on the row. Never a decision,
        // but it does hold the lookup back (`awaitsOperatorBeforeLookup`).
        const enrichment = kind === "player" ? withPreselect(key, bornWith) : bornWith;
        ops +=
          (skipLookup ? 0 : REVIEW_NAME_LOOKUP_OPS.BASE) +
          // Charged on what the READ found, not on the preselect it carries.
          (bornWith ? REVIEW_NAME_LOOKUP_OPS.EXTRA : 0) +
          1;
        // NEO-332 — a same-name choice is born settled and is NOT enqueued;
        // see `playerLookupAwaitsCreateNew`. NEO-424 — nor is a preselected
        // row. Same insert, so the charge above is unchanged.
        const awaitsChoice = kind === "player" && awaitsOperatorBeforeLookup(enrichment);
        const addedId = await ctx.db.insert("entityReviewQueue", {
          selectorOptionId: args.selectorOptionId,
          batchId,
          createdByUserId: args.createdByUserId,
          kind,
          name,
          // NEO-236: `key` IS that normalization — computed by `keyFor`
          // above with the kind prefix, which is stored as a separate
          // column. Slicing it keeps the two provably identical rather than
          // normalizing twice and hoping.
          nameNormalized: key.slice(kind.length + 1),
          sportId: args.sportId,
          status: awaitsChoice ? "ready" : "pending",
          ...(enrichment ? { enrichment } : {}),
          ...(kind === "team" ? teamContextFor(key) : {}),
          ...(kind === "player" ? playerContextFor(key) : {}),
        });
        if (!awaitsChoice) addedIds.push(addedId);
      }
      if (addedIds.length > 0) {
        // Only the ADDED rows. A resume must never re-enqueue a lookup that
        // already ran (or is running) — see the enqueue note on the fresh path
        // below, and NEO-99's creation-only enrichment contract.
        //
        // NEO-294 — and only the rows added by THIS page. A continuation
        // enqueues the ones it adds, so no row is enqueued twice and none is
        // missed.
        await ctx.scheduler.runAfter(
          0,
          internal.wikidataPool.enqueueEntityReviewLookups,
          { rowIds: addedIds },
        );
      }
      logAutoLinks(batchId);
      await deferRemainder(batchId);
      return batchId;
    }

    const batchId = crypto.randomUUID();
    const ids: Array<Id<"entityReviewQueue">> = [];
    for (const name of args.playerNames) {
      // NEO-294 — checked before the lookup, so a name this page cannot afford
      // costs nothing. The continuation picks it up through the RESUME branch,
      // which now finds the rows this page wrote: `existingKeys` suppresses
      // re-inserting them, and the names still missing are inserted there.
      if (ops >= ENTITY_REVIEW_START_OPS) {
        deferred += 1;
        continue;
      }
      const key = keyFor("player", name);
      // NEO-424 — a name the gate's facts answer or shape is inserted by the
      // fact loop below, once, whatever list(s) it also arrived in.
      if (factRows.has(key)) continue;
      // NEO-254 — the row knows it is a choice before any lookup runs. See
      // `initialEnrichmentFor` for why that cannot wait for the lookup.
      //
      // NEO-296 — unless the caller already asked; see
      // `playersWithNoExistingMatch`.
      const skipLookup = noExistingMatch.has(name);
      const bornWith = skipLookup
        ? undefined
        : await initialEnrichmentFor(ctx, "player", name, args.sportId, setYear);
      // NEO-424 — rule E's suggestion rides on the row, and holds its lookup
      // back until the operator says it is someone new.
      const enrichment = withPreselect(key, bornWith);
      ops +=
        (skipLookup ? 0 : REVIEW_NAME_LOOKUP_OPS.BASE) +
        (bornWith ? REVIEW_NAME_LOOKUP_OPS.EXTRA : 0) +
        1;
      // NEO-332 — two or more players on file under this name: the operator
      // picks one first, and the lookup waits for Create new. Inserted
      // settled and left out of the enqueue; see
      // `playerLookupAwaitsCreateNew`. Same one insert, so the charge above
      // is unchanged — and when EVERY name is a choice, the pool enqueue
      // below is not scheduled at all. NEO-424: a preselected row waits the
      // same way (`awaitsOperatorBeforeLookup`).
      const awaitsChoice = awaitsOperatorBeforeLookup(enrichment);
      const insertedId = await ctx.db.insert("entityReviewQueue", {
        selectorOptionId: args.selectorOptionId,
        batchId,
        createdByUserId: args.createdByUserId,
        kind: "player",
        name,
        // NEO-236 — see the field's note in schema.ts.
        nameNormalized: normalizePlayerName(name),
        sportId: args.sportId,
        status: awaitsChoice ? "ready" : "pending",
        ...(enrichment ? { enrichment } : {}),
        ...playerContextFor(key),
      });
      if (!awaitsChoice) ids.push(insertedId);
    }
    for (const name of args.teamNames) {
      // NEO-294 — a team row is one insert and no name lookup, so it is
      // charged one operation. Same deferral as the player loop above.
      if (ops >= ENTITY_REVIEW_START_OPS) {
        deferred += 1;
        continue;
      }
      // NEO-424 — a team the card prints that set history answers (rule F).
      if (factRows.has(keyFor("team", name))) continue;
      ops += 1;
      ids.push(
        await ctx.db.insert("entityReviewQueue", {
          selectorOptionId: args.selectorOptionId,
          batchId,
          createdByUserId: args.createdByUserId,
          kind: "team",
          name,
          nameNormalized: normalizeTeamName(name),
          sportId: args.sportId,
          status: "pending",
          ...teamContextFor(keyFor("team", name)),
        }),
      );
    }
    /*
     * NEO-424 — the rows the gate's facts decide (auto-links) or shape
     * (history choices), each once. After the plain names so an ordinary
     * batch's insertion order — and therefore its walk — is unchanged. Same
     * budget and the same deferral: a fact this page cannot afford is picked
     * up by the continuation's resume branch, which carries the facts in
     * `...args`.
     */
    for (const [key, fact] of factRows) {
      if (ops >= ENTITY_REVIEW_START_OPS) {
        deferred += 1;
        continue;
      }
      const inserted = await insertFactRow(batchId, key, fact, fact.name);
      if (inserted.enqueue) ids.push(inserted.id);
    }
    if (ids.length > 0) {
      // NEO-99: hand the rows to the deployment-wide Wikidata pool
      // (convex/wikidataPool.ts) instead of a per-batch serial chain. Scheduled
      // rather than enqueued inline so THIS mutation — the one the user's fetch
      // is waiting on — stays a plain insert and never touches the pool
      // component; the scheduled `enqueueEntityReviewLookups` does the enqueuing
      // (chunked) in the background. Same start/enqueue split as
      // `startPlaceholderBatch` → `enqueueImageChunk`.
      await ctx.scheduler.runAfter(
        0,
        internal.wikidataPool.enqueueEntityReviewLookups,
        { rowIds: ids },
      );
    }
    logAutoLinks(batchId);
    await deferRemainder(batchId);
    return batchId;
  },
});

/**
 * NEO-254 — stage a New League step ahead of the TEAM row that needs it.
 *
 * ## The bug this closes
 *
 * Jason, preview test 2026-09-06: on a fresh deployment every hockey team row
 * offered `Create National Hockey League`. Nothing is written until commit, so
 * the 3rd team asked the same question as the 1st, and the 30th asked it
 * again — and whichever pill was finally pressed created a league carrying a
 * name and nothing else: no abbreviation, no level, no years, no aliases.
 * "The proper fix is pulling league up before team as we'll need to fill in
 * the rest of the year information too."
 *
 * So the league becomes a row of its own, walked BEFORE the team, asked ONCE
 * per batch, and answered with the whole record. This is `stageCareerTeamRows
 * Impl` one level up, and it is deliberately the same shape down to the
 * guard rails — a batch-wide index dedupe, a bound on the name, a cap counted
 * through `by_source_team` so re-entry cannot grow past it, and a hard refusal
 * to stage from a staged row (which is what keeps the chain two deep).
 *
 * ## What is NOT staged
 *
 *  - a league this sport already answers to, by name OR alias
 *    (`findLeagueByName`) — it exists, so there is nothing to ask;
 *  - a league already staged in this batch — the whole point;
 *  - a blank or unusable name.
 *
 * Returns the ids it inserted, so the caller can enqueue exactly those lookups
 * and nothing else.
 */
async function stageLeagueRowsImpl(
  ctx: MutationCtx,
  teamRow: Doc<"entityReviewQueue">,
  /**
   * League names the caller knows about that the row's own enrichment does
   * not — a name the operator typed into the team step's league field.
   */
  extraLeagueNames: ReadonlyArray<{ name: string; wikidataId?: string }> = [],
): Promise<Array<Id<"entityReviewQueue">>> {
  /*
   * Only a TEAM has a league.
   *
   * A team STAGED off a player's career list is included deliberately — a club
   * side pulled from a P54 statement needs its league asked about exactly as a
   * checklist team does, and that is the case Jason's hockey batch is made of.
   * The chain stops there: a league row stages nothing, so the depth is two by
   * construction rather than by this guard.
   */
  if (teamRow.kind !== "team") return [];
  /*
   * NEO-330 / NEO-341 — nor does a team the operator SKIPPED: "not a team"
   * makes no team, so it has no league to ask about. The twin of the
   * skipped-player rule in `stageCareerTeamRowsImpl`, at the same no-extra-read
   * cost.
   */
  if (teamRow.decision?.action === "skip") return [];

  const proposals: Array<{ name: string; wikidataId?: string }> = [
    ...(teamRow.enrichment?.league
      ? [
          {
            name: teamRow.enrichment.league,
            // NEO-254 — the P118 value's id, when the team's lookup got one.
            // The staged row's own lookup then READS that record rather than
            // searching for the label, which is the same argument NEO-236 made
            // for a career team's QID.
            ...(teamRow.enrichment.leagueWikidataId
              ? { wikidataId: teamRow.enrichment.leagueWikidataId }
              : {}),
          },
        ]
      : []),
    ...extraLeagueNames,
  ];
  if (proposals.length === 0) return [];

  /*
   * The cap is PER TEAM, not per call — the same finding NEO-236's security
   * review raised about career teams. Three callers can stage for one team
   * (the lookup landing, the wizard's belt-and-braces pass, and a hand-typed
   * league), so counting one invocation would let N calls mint N caps' worth.
   */
  const alreadyStagedForTeam = (
    await ctx.db
      .query("entityReviewQueue")
      .withIndex("by_source_team", (q) => q.eq("source.teamRowId", teamRow._id))
      .collect()
  ).length;

  const added: Array<Id<"entityReviewQueue">> = [];
  const seen = new Set<string>();
  for (const proposal of proposals) {
    if (alreadyStagedForTeam + added.length >= MAX_STAGED_LEAGUES_PER_TEAM) break;
    const name = proposal.name.trim().replace(/\s+/g, " ");
    if (!name) continue;
    // `normalizeLeagueName`, NOT the team normaliser: it does not token-sort,
    // because "National League" and "League National" are different
    // competitions. See `convex/leagues.ts`.
    const nameNormalized = normalizeLeagueName(name);
    if (!nameNormalized || seen.has(nameNormalized)) continue;
    seen.add(nameNormalized);
    // Same reasoning as the team staging: a Wikidata label is text nobody on
    // our side vetted, and it reaches both `name` and the INDEX. Skipped
    // rather than thrown on — one absurd label must not cost the team its
    // step, and the team still links if we already hold the league (NEO-331:
    // otherwise it commits with no league — names never create one).
    if (name.length > MAX_LEAGUE_NAME_LENGTH) continue;

    const alreadyInBatch = await ctx.db
      .query("entityReviewQueue")
      .withIndex("by_batch_and_kind_and_name", (q) =>
        q
          .eq("selectorOptionId", teamRow.selectorOptionId)
          .eq("batchId", teamRow.batchId)
          .eq("kind", "league")
          .eq("nameNormalized", nameNormalized),
      )
      .first();
    if (alreadyInBatch) continue;
    /*
     * NEO-254 — and by QID, because one league has more than one name.
     *
     * ESPN calls it "NHL" and Wikidata calls it "National Hockey League", so
     * two teams in one batch routinely propose the same competition under
     * names that do not normalise to each other. Keyed only on the name, that
     * produced two steps and — worse — two `leagues` rows for one league,
     * which is precisely the duplication this feature exists to prevent.
     *
     * The QID is the identity Wikidata itself asserts, so a match on EITHER
     * key means the batch already holds this league.
     *
     * ## NEO-294 — the range is the batch's LEAGUE rows, never the batch
     *
     * There is still no index on `source.wikidataId`, so the QID itself is
     * matched in memory. What changed is the range feeding that match. This
     * used to `.collect()` `by_selector_option_and_batch`, on the reasoning
     * that "a batch's league rows are a handful" — true of the RESULT, false
     * of the READ SET, and the read set is the only thing optimistic
     * concurrency charges for. **A `.collect()` costs what it READS, not what
     * it returns.** Every row in the batch (754 on the seed job) entered this
     * transaction's read set, while `applyLookupResult` runs five-wide under
     * the Wikidata pool with every sibling's `ctx.db.patch` landing inside
     * that same range. They invalidated one another on the first attempt and
     * again on every retry — four PERMANENT write conflicts on this mutation
     * in PR #273's preview logs, with Convex's automatic retries exhausted.
     *
     * `by_batch_and_kind_and_name` is
     * `[selectorOptionId, batchId, kind, nameNormalized]`, so stopping the
     * equality chain after `kind` is a legal three-field prefix: the read set
     * becomes this batch's league rows alone — a handful for real this time.
     * `nameNormalized` is optional in the schema, and a prefix range spans
     * every value of the trailing field including `undefined`, so a league row
     * that carries no normalised name is still seen. `kind === "league"` is
     * now guaranteed by the range and has left the predicate. Same answer,
     * ~754 documents read down to ~5.
     *
     * Do not widen this back out to reach some other row of the batch: add the
     * index, or read through one that already exists. The rule is written at
     * the index in `schema.ts` — "a collect of the batch is the NEO-189
     * optimistic-concurrency storm" — and this is the second time staging has
     * broken it.
     */
    if (proposal.wikidataId) {
      const sameQid = (
        await ctx.db
          .query("entityReviewQueue")
          .withIndex("by_batch_and_kind_and_name", (q) =>
            q
              .eq("selectorOptionId", teamRow.selectorOptionId)
              .eq("batchId", teamRow.batchId)
              .eq("kind", "league"),
          )
          .collect()
      ).some(
        (r) =>
          r.source?.kind === "leagueOf" &&
          r.source.wikidataId === proposal.wikidataId,
      );
      if (sameQid) continue;
    }

    // Held already — including under an ALIAS, which is the case that makes
    // this worth a helper call rather than an index read: a sport that already
    // has "National Hockey League" with the alias "NHL" must not be asked to
    // create "NHL".
    if (await findLeagueByName(ctx, { name, sportId: teamRow.sportId })) continue;

    added.push(
      await ctx.db.insert("entityReviewQueue", {
        selectorOptionId: teamRow.selectorOptionId,
        batchId: teamRow.batchId,
        // The batch's owner, not the caller — `assertOwnsRow` compares against
        // this, and a row stamped with anyone else would be unanswerable by
        // the operator it was staged for.
        createdByUserId: teamRow.createdByUserId,
        kind: "league",
        name,
        nameNormalized,
        sportId: teamRow.sportId,
        source: {
          kind: "leagueOf",
          teamRowId: teamRow._id,
          ...(proposal.wikidataId ? { wikidataId: proposal.wikidataId } : {}),
        },
        /*
         * ── NEO-254: a league step is ANSWERABLE the moment it is staged ────
         *
         * `"ready"`, not `"pending"` — and this is a correctness point before
         * it is a speed one. `pending` means "we cannot present this row yet
         * because we do not know enough to ask the question". For a player or
         * a team that is true: the whole step is built out of the lookup. For
         * a league it is not. Everything the question needs is already
         * decided by the time this insert runs — the NAME came off the team's
         * P118 statement, and the two things that could make the step
         * unnecessary (the sport already holds this league, by name or by
         * alias; the batch already staged it) were both checked synchronously
         * above.
         *
         * The Wikidata lookup only fills in abbreviation, years and the QID.
         * It is a PREFILL, and it streams into the open form when it lands the
         * same way a team row's enrichment does — `applyLookupResult` has no
         * status guard, so it patches this row whether or not it was pending.
         *
         * Marking it pending made the whole chain wait on a network round trip
         * for nothing: `nextUndecided` only presents a settled row, so the
         * league was unpresentable, and `waitingOnStagedLeagues` held its team
         * behind it — one Wikidata call blocking two steps that were both
         * ready to be answered. On CI's 1024x629 drain that is an unbounded
         * stall per league; in the wizard it is an operator watching a form
         * they could already have filled in.
         *
         * Pool semantics are untouched: the enqueue below still happens, the
         * result still lands through `applyLookupResult`, and a lookup that
         * dies is simply a step with no prefill. `backstopEntityReviewRowImpl`
         * returns early on a non-pending row, which is exactly right here —
         * there is nothing to rescue a row from when it was never waiting.
         */
        status: "ready",
      }),
    );
  }

  if (added.length > 0) {
    // ONLY the rows just inserted — a re-entrant call must never re-enqueue a
    // lookup that already ran, which is NEO-99's creation-only contract.
    await ctx.scheduler.runAfter(
      0,
      internal.wikidataPool.enqueueEntityReviewLookups,
      { rowIds: added },
    );
  }
  return added;
}

/**
 * ── NEO-236: a career team the batch will have to create becomes its OWN step ─
 *
 * Jason, 2026-09-05, looking at the wizard on Travis Bazzana with three inline
 * Location/Name pairs under his career list: "How does this dialog know which
 * League the new team is in? I think we need to show a new team dialog instead
 * of that inline thing. So for this example I think we should show 3 modals in
 * the walker: 1. New Team: Sydney Blue Sox 2. New Team: Oregon State Beavers
 * 3. New Player Travis Bazzana which can now use the 2 new teams that were
 * created."
 *
 * That is what this does. Every accepted career team on a player row that
 * matches no existing `teams` row gets a `team` row of its own in the SAME
 * batch, `source.kind === "careerTeamOf"`, walked before the player (see
 * `getBatch`'s ordering) and answered with the same New Team step a checklist
 * team gets — Location, Name, and the League that used to have no way of being
 * asked about at all. The prelude then creates those rows first, and the
 * player's stints resolve onto them by name.
 *
 * ## What is NOT staged, and why each exclusion is load-bearing
 *
 *  - **A career team we already hold.** `findTeamByFullName` is asked first, by
 *    the composed full name and therefore by the same key every writer uses, so
 *    a stint at the San Diego Padres is a link and not a question. Asking the
 *    operator to re-create a team they already have is how the duplicate this
 *    ticket exists to prevent gets made.
 *  - **A name the batch already has a team row for.** Deduped through the
 *    `by_batch_and_kind_and_name` INDEX rather than a collect, and that is a
 *    correctness choice rather than a tuning one — see the field note on
 *    `nameNormalized` in schema.ts, and NEO-189 for what a wide read set inside
 *    a pool-driven mutation does to the commit that runs beside it. It covers
 *    both directions at once: a checklist team of the same name, and a career
 *    team another player already staged.
 *  - **A team the operator UNCHECKED.** An exclusion is the operator saying
 *    "he never played there", and staging a step for it would ask them again in
 *    a form they cannot decline.
 *
 * ## Idempotent, and it has to be
 *
 * Three callers reach this: the lookup landing on a player row, the wizard
 * staging a hand-typed career team, and the wizard's belt-and-braces call when
 * a player row comes up. Every one of them can fire more than once for one
 * player, so "already staged" is the ONLY thing keeping the batch from growing
 * a duplicate step per re-entry. Returns the rows it actually inserted, which
 * is what makes "and only those get a lookup scheduled" expressible.
 */
async function stageCareerTeamRowsImpl(
  ctx: MutationCtx,
  playerRow: Doc<"entityReviewQueue">,
  /**
   * Career teams the caller knows about that the row's own enrichment does not
   * — the wizard's hand-typed entries. Merged with the enrichment's proposals
   * rather than replacing them, because a player can have both.
   */
  extraCareerTeams: ReadonlyArray<{
    name: string;
    wikidataId?: string;
    /**
     * NEO-248 — the years typed beside the name, when this proposal came from
     * the wizard's manual entry form. Stored on the staged row so the chip can
     * be rebuilt after the team's own step; see schema.ts.
     */
    manualStint?: { fromYear: number; toYear?: number };
  }> = [],
): Promise<Array<Id<"entityReviewQueue">>> {
  // A team row has no career teams of its own, and a staged row must never
  // stage further rows — that is the recursion this guard forecloses.
  if (playerRow.kind !== "player") return [];
  /*
   * NEO-332 — a same-name choice the operator has not answered stages
   * nothing. Career teams belong to a NEW person, and until the operator
   * presses Create new (`requestPlayerLookup`) there is none: the usual
   * answer is a player we already hold, who needs no New Team steps at all.
   * Such a row has no `careerTeams` to stage from anyway (its lookup has not
   * run); this keeps hand-typed extras and every future caller out too.
   * Reads nothing, so it adds nothing to any caller's read set.
   */
  if (playerLookupAwaitsCreateNew(playerRow)) return [];
  /*
   * NEO-330 / NEO-341 — a player the operator SKIPPED stages nothing.
   *
   * "Not a person" makes no player, so it has no career and no New Team
   * step to answer. A step staged under one is an undecided row the operator
   * never asked for: after a "Skip remaining names" it is the one row
   * standing between the operator and Confirm & Save, asking them to create a
   * team for a name they have just dismissed. `applyLookupResult` already
   * drops a result for any decided row; this covers every other caller — the
   * wizard's belt-and-braces pass racing a "Skip remaining names", and any
   * future one — and is what lets `skipStagedStepsOf` be race-free. Reads the
   * row already in hand, so it adds nothing to any caller's read set.
   *
   * A CREATE decision still stages: the bulk create decides a player before
   * its teams are asked. `link` is deliberately NOT refused here: whether a
   * player linked to one we hold should still raise career-team steps is an
   * open question, and this guard does not answer it.
   */
  if (playerRow.decision?.action === "skip") return [];

  type Proposal = {
    name: string;
    wikidataId?: string;
    manualStint?: { fromYear: number; toYear?: number };
    /**
     * NEO-254 — the year this stint STARTED, used only to decide which era of
     * a name we are talking about. Never stored.
     *
     * A club name can now belong to several team rows: a 1979 Winnipeg Jets
     * stint and a 2015 one are different franchises. The "we hold this already,
     * nothing to stage" check below therefore has to ask about a year, and the
     * stint's own start is a far better signal than the set's year — the card
     * this player appeared on says nothing about when they played for a club
     * they left a decade earlier.
     */
    stintYear?: number;
  };
  const proposals: Proposal[] = [
    // A Wikidata proposal deliberately carries NO `manualStint` even though it
    // has years: they already live on this player's `enrichment.careerTeams`,
    // and `manualStint` is how the wizard tells a chip it has to rebuild from
    // one it can read off the player row.
    ...(playerRow.enrichment?.careerTeams ?? []).map((ct) => ({
      name: ct.name,
      ...(ct.wikidataId ? { wikidataId: ct.wikidataId } : {}),
      // …but it DOES carry the year for the era check — see `stintYear`.
      ...(ct.fromYear !== undefined ? { stintYear: ct.fromYear } : {}),
    })),
    ...extraCareerTeams.map((extra) => ({
      ...extra,
      ...(extra.manualStint ? { stintYear: extra.manualStint.fromYear } : {}),
    })),
  ];
  if (proposals.length === 0) return [];

  /*
   * NEO-248 — collapse duplicate names BEFORE the loop, not inside it.
   *
   * The enrichment's proposals and the caller's extras can name the same club:
   * Wikidata knew the club but not the dates, and the operator typed them. The
   * loop's own per-call dedupe (`seen`) would drop whichever came second — and
   * that is always the hand-typed one, because the extras are appended last —
   * so the years would be discarded before anything looked at them.
   *
   * First occurrence keeps its position and its QID; a `manualStint` from ANY
   * occurrence is adopted, since only the operator's own entry carries one.
   */
  const mergedProposals: Proposal[] = [];
  const proposalByKey = new Map<string, Proposal>();
  for (const proposal of proposals) {
    const key = normalizeTeamName(proposal.name.trim().replace(/\s+/g, " "));
    if (!key) continue;
    const held = proposalByKey.get(key);
    if (!held) {
      const copy: Proposal = { ...proposal };
      proposalByKey.set(key, copy);
      mergedProposals.push(copy);
      continue;
    }
    if (proposal.manualStint && held.manualStint === undefined) {
      held.manualStint = proposal.manualStint;
    }
  }

  // The operator's unchecks, read off whatever decision the row carries. A
  // `create` decision is not a reason to skip staging: the bulk create decides
  // a player before its career teams have been asked about, and those teams
  // still need their steps — the prelude resolves stints by NAME, so a team
  // row created after the player's decision still lands on the timeline. A
  // `skip` decision IS one, and returned above (NEO-330): a skipped name has
  // no career to stage. `link` reaches here and stages as an undecided row
  // would; only a `create` carries unchecks.
  const excluded = new Set(
    (playerRow.decision?.action === "create"
      ? (playerRow.decision.excludedCareerTeamNames ?? [])
      : []
    ).map(normalizeTeamName),
  );

  /*
   * NEO-236 security review, finding 3 — the cap is PER PLAYER, not per call.
   *
   * `added.length` alone bounded one invocation, and three callers can stage
   * for the same player (the lookup landing, the wizard's belt-and-braces pass,
   * and every hand-typed career team), so N calls could mint 64N steps. Counted
   * through `by_source_player` rather than by collecting the batch: staging
   * runs inside `applyLookupResult`, which the pool calls five-wide while the
   * commit prelude may be reading the same rows — see NEO-189.
   */
  const alreadyStagedForPlayer = (
    await ctx.db
      .query("entityReviewQueue")
      .withIndex("by_source_player", (q) =>
        q.eq("source.playerRowId", playerRow._id),
      )
      .collect()
  ).length;

  const added: Array<Id<"entityReviewQueue">> = [];
  const seen = new Set<string>();
  for (const proposal of mergedProposals) {
    const name = proposal.name.trim().replace(/\s+/g, " ");
    if (!name) continue;
    const nameNormalized = normalizeTeamName(name);
    if (!nameNormalized || seen.has(nameNormalized)) continue;
    seen.add(nameNormalized);
    if (excluded.has(nameNormalized)) continue;
    /*
     * NEO-236 security review, finding 2 — an unbounded name never reaches the
     * row or the index.
     *
     * Both sources are text nobody on our side vetted: a Wikidata P54 label,
     * and the `careerTeamNames` a client hands the public mutation. Without
     * this, an arbitrarily long string landed in `name` AND in the indexed
     * `nameNormalized`. SKIPPED rather than thrown on, exactly as
     * `normalizeCareerTeamCreates` drops an unusable pair: one absurd label
     * must not cost the player every other career-team step. The stint itself
     * still resolves if we already hold the team.
     */
    if (name.length > MAX_TEAM_FULL_NAME_LENGTH) continue;

    const alreadyInBatch = await ctx.db
      .query("entityReviewQueue")
      .withIndex("by_batch_and_kind_and_name", (q) =>
        q
          .eq("selectorOptionId", playerRow.selectorOptionId)
          .eq("batchId", playerRow.batchId)
          .eq("kind", "team")
          .eq("nameNormalized", nameNormalized),
      )
      .first();
    if (alreadyInBatch) {
      /*
       * NEO-248 — the step exists, but it may not yet carry the years.
       *
       * Staging dedupes a career team across the whole batch, so the operator
       * can hand-type a stint for a club this player's OWN lookup already
       * staged (Wikidata knew the club, not the dates). Without this the years
       * would have nowhere to live and the chip could not be rebuilt.
       *
       * Narrow on purpose: only a step staged for THIS player, only when it
       * carries no stint yet, and only from a caller that actually supplied
       * one. So it never overwrites an earlier answer and never attributes one
       * player's dates to another's step — and the enrichment-driven callers,
       * which pass no `manualStint`, write nothing here at all.
       */
      if (
        proposal.manualStint &&
        alreadyInBatch.source?.kind === "careerTeamOf" &&
        alreadyInBatch.source.playerRowId === playerRow._id &&
        alreadyInBatch.source.manualStint === undefined
      ) {
        await ctx.db.patch(alreadyInBatch._id, {
          source: { ...alreadyInBatch.source, manualStint: proposal.manualStint },
        });
      }
      continue;
    }

    // Held already — a link, not a question. Composed-name keyed, so a split
    // row ("San Diego" + "Padres") answers to the Wikidata label "San Diego
    // Padres" and nothing is staged.
    //
    // NEO-254: "held already" now means held FOR THIS STINT'S ERA. A name that
    // resolves to several team rows is not held — it is a question, and it gets
    // a step so the operator picks the era. Without the year here, a 1979
    // Winnipeg Jets stint would be silently satisfied by the 2011 row simply
    // because it exists.
    //
    // NEO-307: STRICT — no `allowPastEra`. This is a stint's year, and nobody
    // plays for a team after it folds: a 2015 stint with only the 1972-1996
    // Jets held gets its step, so the 2011 era can be created.
    const { teamId: heldTeamId } = await resolveTeamForSetYear(
      ctx,
      playerRow.sportId,
      name,
      proposal.stintYear,
    );
    if (heldTeamId) continue;

    /*
     * A guard rail on an unbounded write, not a security boundary — and it
     * counts the steps this player ALREADY has, so re-entry cannot grow past
     * it.
     *
     * ## NEO-248 — checked HERE, at the insert, and loud for a typed stint
     *
     * It used to sit at the top of the loop, which made it two wrong things at
     * once. It consumed the cap for proposals that need no row (a name the
     * batch already has a step for, a team we already hold) — and, because the
     * caller's extras are appended last, it broke out of the loop BEFORE ever
     * reaching a hand-typed stint whenever the enrichment's own proposals had
     * filled the quota. The mutation then returned 0, the wizard's `.catch` had
     * nothing to catch, and the operator's years were gone with no message.
     *
     * So: the cap bounds ROWS, and it is tested where a row would actually be
     * inserted. A proposal carrying a `manualStint` is the operator typing, and
     * a refusal they can read beats a silent drop — it throws, which rolls the
     * whole mutation back rather than half-staging. Every other caller
     * (`applyLookupResult`, the belt-and-braces pass, the bulk create) passes
     * no stint and still breaks quietly, exactly as before.
     *
     * The message carries the COUNT and never a name — this string reaches the
     * browser and Sentry.
     */
    if (alreadyStagedForPlayer + added.length >= MAX_CAREER_TEAM_CREATES) {
      if (proposal.manualStint) {
        throw new ConvexError(
          `This player already has ${MAX_CAREER_TEAM_CREATES} career-team steps, which is the maximum. Remove one before adding another.`,
        );
      }
      break;
    }

    added.push(
      await ctx.db.insert("entityReviewQueue", {
        selectorOptionId: playerRow.selectorOptionId,
        batchId: playerRow.batchId,
        // The batch's owner, not the caller: `assertOwnsRow` compares against
        // this, and a row stamped with anyone else would be unanswerable by the
        // very operator it was staged for.
        createdByUserId: playerRow.createdByUserId,
        kind: "team",
        name,
        nameNormalized,
        sportId: playerRow.sportId,
        source: {
          kind: "careerTeamOf",
          playerRowId: playerRow._id,
          ...(proposal.wikidataId ? { wikidataId: proposal.wikidataId } : {}),
          // NEO-248 — absent unless the operator typed the years themselves.
          ...(proposal.manualStint ? { manualStint: proposal.manualStint } : {}),
        },
        status: "pending",
      }),
    );
  }

  if (added.length > 0) {
    // ONLY the rows just inserted, for the same reason `startBatch`'s resume
    // path enqueues only its additions: a re-entry must never re-run a lookup
    // that already ran. The staged row's lookup is what supplies the League
    // suggestion and the ESPN location its New Team step pre-fills from.
    await ctx.scheduler.runAfter(
      0,
      internal.wikidataPool.enqueueEntityReviewLookups,
      { rowIds: added },
    );
  }
  return added;
}

/**
 * NEO-221 — delete every row of one batch, and return how many were deleted.
 *
 * The single deletion body behind `cancelBatch` (the operator said no),
 * `cleanupBatch` (an operator tool for a batch nobody will finish) and
 * `sweepAbandonedBatches` (the cron that finds those on its own). Three
 * callers with three different reasons and exactly one definition of what
 * "delete a batch" means — before this, two of them carried their own copy of
 * the same loop, which is one drift away from a sweep that half-cleans.
 *
 * Reads through `by_selector_option_and_batch` unless the caller hands over
 * rows it read through that same index in this same transaction (see
 * `alreadyRead` below): the sweep decides on a sampled window, and deleting
 * from a stale list would leave a batch partly alive.
 *
 * ## NEO-294 — `alreadyRead`, and why it is safe
 *
 * `alreadyRead` lets a caller that has JUST read this batch through this exact
 * index, in THIS transaction, hand those rows over instead of paying for them
 * twice. `cancelBatch` reads the page to check ownership before it deletes
 * anything, and `sweepAbandonedBatches` reads the whole batch to decide
 * whether it is abandoned at all — both were re-reading the same rows a line
 * later. A Convex transaction is serializable and reads its own writes, so
 * "just read in this transaction" is not an optimistic assumption; nothing can
 * have changed underneath it.
 *
 * What a caller must NOT pass is a SAMPLED window. The sweep's paginated page
 * (`page.page`) is a window over the table, not over one batch, and deleting
 * from it would leave a batch half-alive — which is why the sweep re-reads the
 * batch in full and passes THAT.
 *
 * ## NEO-294 — and the delete itself is bounded
 *
 * One delete is one system operation, so "delete the batch" is O(rows) against
 * a ~900-operation ceiling: a 754-row review — the seed job's real shape — cost
 * 754 reads to check ownership, 754 more to re-read the same rows and 754
 * deletes, the same order as the bulk decide that blew the budget outright.
 * This deletes at most `ENTITY_REVIEW_DELETE_PAGE` rows and reports whether
 * more remain; the callers below schedule `cleanupBatch` to finish, and it
 * chains until the batch is gone.
 *
 * Private, and assumes its caller has already gated itself.
 */
async function deleteBatchRows(
  ctx: MutationCtx,
  selectorOptionId: Id<"selectorOptions">,
  batchId: string,
  alreadyRead?: ReadonlyArray<Doc<"entityReviewQueue">>,
): Promise<{ deleted: number; hasMore: boolean }> {
  const rows =
    alreadyRead ??
    // One row PAST the page, so "is there more behind this" is answered by the
    // same read rather than by a second one. `alreadyRead` callers do the
    // same — see `cancelBatch` — or pass the batch in full, as the sweep does.
    (await ctx.db
      .query("entityReviewQueue")
      .withIndex("by_selector_option_and_batch", (q) =>
        q.eq("selectorOptionId", selectorOptionId).eq("batchId", batchId),
      )
      .take(ENTITY_REVIEW_DELETE_PAGE + 1));
  const page = rows.slice(0, ENTITY_REVIEW_DELETE_PAGE);
  for (const row of page) await ctx.db.delete(row._id);
  return { deleted: page.length, hasMore: rows.length > page.length };
}

/**
 * NEO-294 — how many rows of a batch ONE transaction may delete.
 *
 * A delete is one system operation and nothing else is spent per row, so the
 * arithmetic is as plain as it gets: 800 deletes, plus the one index read that
 * produced the page and the one `scheduler.runAfter` that continues the chain,
 * is ~802 against the ~900 that `CARDS_PER_COMMIT_CHUNK` measured as
 * comfortable (~1,800 strains, ~4,000 fails). That is ~11% headroom.
 *
 * Deliberately NOT smaller. Cancel is the operator's one irreversible action
 * on a review, and a batch that is only half-deleted is a batch `startBatch`
 * will happily RESUME into the next fetch of the set — so the page is sized to
 * keep the largest review anyone has measured (754 rows) a single
 * all-or-nothing transaction, and only a review bigger than that pays for a
 * continuation. The continuation is a scheduled `cleanupBatch`, which commits
 * its own page and chains; if it were ever to die mid-chain the
 * abandoned-batch sweep is the backstop.
 */
export const ENTITY_REVIEW_DELETE_PAGE = 800;

/**
 * NEO-294 — schedule `cleanupBatch` to finish a delete this transaction could
 * not. Shared by the three callers so none of them can forget the tail.
 */
async function scheduleBatchCleanup(
  ctx: MutationCtx,
  selectorOptionId: Id<"selectorOptions">,
  batchId: string,
): Promise<void> {
  // Ids and counts only — never a name. See the no-PII rule in
  // observability.ts.
  console.warn(
    JSON.stringify({
      msg: "entity_review_batch_delete_paged",
      selectorOptionId,
      page: ENTITY_REVIEW_DELETE_PAGE,
    }),
  );
  await ctx.scheduler.runAfter(0, internal.entityReviewQueue.cleanupBatch, {
    selectorOptionId,
    batchId,
  });
}

/** Internal — read one row for the pool's lookup work item (runEntityReviewLookup). */
export const getInternal = internalQuery({
  args: { id: v.id("entityReviewQueue") },
  returns: v.union(rowValidator, v.null()),
  handler: async (ctx, args) => await ctx.db.get(args.id),
});

/**
 * Internal — the pool's lookup work item patches status/enrichment as each
 * lookup completes.
 *
 * ## Why this reads before it writes (NEO-189)
 *
 * A row that already carries a `decision` is LEFT ALONE. This used to patch
 * unconditionally, and that is what turned a seed job red: the operator's
 * "mark everything as create" fast path (`recordAllRemainingAsCreate`)
 * deliberately decides rows whose lookup is still `pending`, the operator hits
 * Confirm, and `commitCardChecklist`'s prelude then reads the whole batch
 * through `by_selector_option_and_batch`. Every straggler lookup landing here
 * during that read invalidated the prelude's read set, and with a lookup storm
 * in flight (CI hit an ESPN 403 retry loop) it lost on Convex's every internal
 * retry too:
 *
 *   Documents read from or written to the "entityReviewQueue" table changed
 *   while this mutation was being run and on every subsequent retry. A call to
 *   "entityReviewQueue.js:applyLookupResult" changed the document…
 *
 * The write was pointless as well as harmful. `enrichment` has exactly two
 * consumers: the commit prelude, which reads it to seed a newly created
 * player/team, and the review wizard's detail panel — and the wizard only ever
 * renders a row that is NOT decided (`EntityReviewWizard`'s `current` filters
 * on `!r.decision`). So once a decision exists, nothing will ever read the
 * enrichment this patch would store: commit has either already read the row or
 * is about to, and either way it finishes by deleting the batch.
 *
 * This does NOT weaken the "a row is never stranded on pending" invariant —
 * see `backstopEntityReviewRowImpl`, which carries the same guard and the
 * argument for why.
 */
/**
 * NEO-301 — lay a team lookup's later result over the partial answer already
 * on the row (see `applyLookupResult`). A field the new result leaves
 * `undefined` keeps its stored value; `colors` is merged per swatch for the
 * same reason. Everything the new result DOES carry wins, so a Wikidata answer
 * adds `wikidataId`, `yearsActive` and `leagueWikidataId` and an ESPN answer
 * refreshes its own fields with the same values.
 */
export function overlayTeamEnrichment(
  prior: Doc<"entityReviewQueue">["enrichment"],
  next: Doc<"entityReviewQueue">["enrichment"],
): Doc<"entityReviewQueue">["enrichment"] {
  if (!next) return prior;
  if (!prior) return next;
  const merged: Record<string, unknown> = { ...prior };
  for (const [key, value] of Object.entries(next)) {
    if (value !== undefined) merged[key] = value;
  }
  if (prior.colors || next.colors) {
    const colors: Record<string, unknown> = { ...(prior.colors ?? {}) };
    for (const [key, value] of Object.entries(next.colors ?? {})) {
      if (value !== undefined) colors[key] = value;
    }
    merged.colors = colors;
  }
  return merged as Doc<"entityReviewQueue">["enrichment"];
}

export const applyLookupResult = internalMutation({
  args: {
    id: v.id("entityReviewQueue"),
    status: v.union(v.literal("ready"), v.literal("error")),
    enrichment: v.optional(enrichmentValidator),
    /**
     * NEO-313 — the sport the lookup ran under. When the operator has switched
     * the row's sport since (`switchRowSport`), this answer is about the old
     * sport and is dropped; the switch enqueued a lookup of its own. Optional
     * so a caller that predates it is not refused.
     */
    sportId: v.optional(v.id("selectorOptions")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    // Gone — a Cancel or a completed commit deleted the batch while this item
    // was still draining. Nothing to resolve.
    if (!row) return null;
    // Decided: the operator has ruled and commit is imminent or done. Writing
    // here would only contend with the commit's read of this same row.
    if (row.decision) return null;
    // NEO-313 — an answer to a question the row is no longer asking.
    if (args.sportId !== undefined && args.sportId !== row.sportId) return null;

    /*
     * NEO-301 — a TEAM row can already be "ready" with a PARTIAL answer here.
     *
     * When a team's Wikidata lookup is unavailable but ESPN answered,
     * `runEntityReviewLookupImpl` writes that ESPN half as "ready" (league,
     * location, colours — the operator can act on it now, and for a team this
     * lookup is the only automatic source of them, NEO-254) and then throws so
     * `wikidataPool` retries the Wikidata half. Each later attempt lands here
     * on a row that already holds an answer, and must ADD to it, never take
     * from it:
     *   - a result is overlaid field by field, keeping every field the new
     *     one leaves undefined — a retry whose ESPN fetch failed (ESPN is
     *     no-throw, so that reads as "no ESPN data") must not erase the
     *     colours the first attempt found;
     *   - an "error" (a retry whose lookup found nothing at all) does not
     *     downgrade it — the ESPN answer it already holds is still true.
     *
     * Scoped to team rows that are already "ready" because that shape has
     * exactly one producer: a team row is staged `pending` and its lookup is
     * enqueued once (NEO-99's creation-only contract), so before NEO-301 no
     * team row was ever written twice. League rows, which ARE staged "ready"
     * before their first lookup, are deliberately not included.
     */
    const priorTeamAnswer =
      row.kind === "team" && row.status === "ready" ? row.enrichment : undefined;
    if (priorTeamAnswer && args.status === "error") return null;

    /**
     * NEO-254 — attach NB's OWN answer to the same question the lookup asked.
     *
     * A row reaches the wizard for one of two reasons now: nothing in
     * `players` matches the name, or SEVERAL things do (see
     * `players.resolveNameForReview`). In the second case the operator's first
     * question is not "what does Wikidata say", it is "which of the people we
     * already have is this?", and until now the wizard had no way to answer
     * it: `nearMatches` gave bare names with no birth year and no career, and
     * only one of them at that.
     *
     * Computed HERE rather than in the action that calls this, for two
     * reasons. It is a `players` read, and this mutation already holds the
     * transaction; and it must happen on BOTH branches — a name Wikidata has
     * never heard of is exactly as ambiguous as one it knows, and the error
     * branch sends no enrichment at all, so a client-side merge would have
     * shown candidates only for the lucky half.
     *
     * `buildExistingPlayerCandidates` returns [] unless there are two or more,
     * so an ordinary new name stores nothing extra and the wizard renders
     * exactly what it did before.
     */
    const liveCandidates =
      row.kind === "player"
        ? await buildExistingPlayerCandidates(ctx, row.name, row.sportId, {
            // NEO-254: re-derived live rather than read off the row, for the
            // same reason the candidates themselves are — the set's year is
            // cheap to walk to and a row can outlive the shape it was written
            // with.
            cardYear: await findSetYearForSelectorOption(ctx, row.selectorOptionId),
          })
        : [];
    /*
     * NEO-424 — what the BATCH put on the row survives the lookup.
     *
     * The live rebuild above only sees the row's own sport. Candidates taken
     * from the set's history (`sportValue` set; possibly another sport) and
     * the rule-E `preselect` cannot be re-derived from the name index, and
     * dropping them here would take "Link to <name>" away from the operator the
     * moment the lookup landed — after Create new on a history choice, or
     * after "Add as New Player anyway" on a preselected row. So
     * the history candidates lead (they are this set's own evidence), the live
     * ones follow without repeats, and the preselect is carried over as is.
     */
    const historyCandidates = row.kind === "player" ? historyCandidatesOf(row.enrichment) : [];
    const historyIds = new Set(historyCandidates.map((c) => c.playerId as string));
    const existingCandidates = [
      ...historyCandidates,
      ...liveCandidates.filter((c) => !historyIds.has(c.playerId as string)),
    ];
    const preselect = row.kind === "player" ? row.enrichment?.preselect : undefined;

    // The enrichment object is only MINTED for candidates when the lookup
    // itself found nothing; a `status: "error"` row with candidates on it is
    // still an error row, and the wizard keys its "No Wikidata match found."
    // on `status`, not on the presence of this object.
    const looked =
      existingCandidates.length > 0
        ? { ...(args.enrichment ?? {}), existingCandidates }
        : priorTeamAnswer
          ? overlayTeamEnrichment(priorTeamAnswer, args.enrichment)
          : args.enrichment;
    const enrichment = preselect ? { ...(looked ?? {}), preselect } : looked;

    await ctx.db.patch(args.id, {
      status: args.status,
      enrichment,
    });
    /*
     * NEO-236 — THIS is where a player's career teams become their own steps.
     *
     * The moment the enrichment lands is the earliest one at which the career
     * list exists, and it is before the row can be walked to: `nextUndecided`
     * only ever presents a SETTLED row, and this mutation is what settles it.
     * Staging here is therefore what makes Jason's sequence fall out of the
     * ordinary walk — the two club steps are already in the batch, ahead of the
     * player, by the time anything is presented at all.
     *
     * Deliberately reads through an INDEX rather than collecting the batch (see
     * `stageCareerTeamRowsImpl`): this mutation runs once per row, five at a
     * time under the pool, alongside a commit that may be reading the same
     * batch. NEO-189 is the record of what a wide read set does here.
     *
     * `row` is the PRE-patch document, so the enrichment is passed explicitly
     * rather than re-read — a second `ctx.db.get` would only widen the read set
     * for a value already in hand.
     */
    if (row.kind === "player" && (args.enrichment?.careerTeams?.length ?? 0) > 0) {
      await stageCareerTeamRowsImpl(ctx, { ...row, enrichment: args.enrichment });
    }
    /*
     * NEO-254 — and the same, one level up.
     *
     * A team row's lookup is what produces `enrichment.league` (Wikidata P118,
     * or ESPN's league name), so this is the first moment the batch knows a
     * league might have to be created. Staging here puts the New League step
     * in the batch BEFORE the team can be walked to, for exactly the reason
     * the career-team staging runs here: `nextUndecided` only ever presents a
     * settled row, and this mutation is what settles it.
     */
    if (row.kind === "team" && enrichment?.league) {
      await stageLeagueRowsImpl(ctx, { ...row, enrichment });
    }
    return null;
  },
});

/**
 * The workpool completion backstop (NEO-99), as a plain exported function so
 * the tests can drive it via `t.run` without mounting the workpool component —
 * the same reason `recordImageOutcomeImpl` is a function rather than a
 * registered mutation. `onEntityReviewLookupComplete` in wikidataPool.ts is the
 * one-line delegation the pool actually calls.
 *
 * The invariant it guarantees: a review row can never be stranded on `pending`.
 * `runEntityReviewLookup` resolves the row on its own happy and caught-error
 * paths, so this normally finds the row already "ready"/"error" and no-ops. It
 * exists for the residue that path cannot reach from within itself — an uncaught
 * throw, an action-level timeout, or a pool cancellation, in each of which the
 * action never ran its patch. In all of those the row is still `pending` when
 * the work item finally completes, and this ages it to "error" ("No Wikidata
 * match found"), which is the honest end state for a lookup that produced
 * nothing usable.
 *
 * `result.kind` is not branched on: whatever terminal shape the work item ended
 * in, a still-`pending` row means "no result landed", and "error" is the
 * resolution for every one of them. An already-resolved row is left exactly as
 * the action set it (a real "ready" with enrichment is never downgraded).
 * `decision` is never touched, so a row bulk-decided while its lookup was in
 * flight keeps its decision.
 *
 * ## NEO-189: a DECIDED row is skipped, and that does not weaken the invariant
 *
 * Same guard, same reason as `applyLookupResult` above — a write here on a row
 * the commit prelude is reading is what made the seed job's commit lose an
 * optimistic-concurrency race on every retry.
 *
 * The invariant this function exists for is about rows the operator has NOT
 * ruled on: those are the ones the wizard blocks on, and they still get aged
 * exactly as before. A DECIDED row left sitting on `pending` is inert — the
 * wizard's `current` skips decided rows entirely, its "N of M" counts
 * decisions rather than statuses, so nothing blocks on the status — and it does
 * not survive: `commitCardChecklist` deletes the whole batch when it finishes,
 * `cancelBatch` deletes it on Cancel, and `sweepStalePendingRows` ages whatever
 * an abandoned wizard leaves behind after ENTITY_REVIEW_STALE_MS.
 */
export async function backstopEntityReviewRowImpl(
  ctx: MutationCtx,
  rowId: Id<"entityReviewQueue">,
  result: RunResult,
): Promise<null> {
  const row = await ctx.db.get(rowId);
  // Gone (a Cancel deleted the batch while this item drained) — nothing to age.
  if (!row) return null;
  // NEO-301 — the retry ladder ran out without ever reaching Wikidata. Said
  // for EVERY surviving row, before the guards below, because the row it
  // matters most for is one they leave alone: a team row already "ready"
  // with the ESPN half of its answer keeps it (it has data; flipping it to
  // "error" would throw that away), and this line is then the only record
  // that its Wikidata half never came. Ids, kinds and the transport reason
  // only — never the name (observability.ts).
  const unavailable =
    result.kind === "failed" ? parseWikidataUnavailable(result.error) : null;
  if (unavailable) {
    console.warn(
      JSON.stringify({
        msg: "wikidata_review_unavailable",
        rowId,
        kind: row.kind,
        reason: unavailable.reason,
        rowStatus: row.status,
      }),
    );
  }
  // Already resolved by the action itself — the common path. Leave it be.
  if (row.status !== "pending") return null;
  // NEO-189: decided by the operator — commit is imminent or done, and this
  // write would only contend with the commit's read of this row. See above.
  if (row.decision) return null;

  // rowId is an opaque document id, never PII (see the no-PII rule in
  // observability.ts). `result.kind` tells triage HOW the work item ended
  // without the row having been resolved — the fingerprint of the residue this
  // backstop exists for.
  //
  // NEO-301: `wikidataUnavailable` says the item gave up because every attempt
  // of the pool's retry ladder failed to reach Wikidata (the backstop only
  // runs after the LAST attempt), as opposed to a thrown write or a
  // cancellation — the one question triage asks of this line first.
  console.warn(
    JSON.stringify({
      msg: "entity_review_row_backstopped",
      rowId,
      resultKind: result.kind,
      wikidataUnavailable: isWikidataUnavailableResult(result),
    }),
  );
  await ctx.db.patch(rowId, { status: "error" });
  return null;
}

/**
 * How long a review row may sit `pending` before the cron sweep ages it to
 * "error" (crons.ts → sweepStalePendingRows).
 *
 * This is the LAST line of defense, behind both the pool's `onComplete` and the
 * fetch timeout — it only matters if a work item is lost so completely that its
 * completion callback never fires at all. 30 minutes is deliberately generous:
 * under the 5-wide pool a healthy row resolves within seconds, and even a
 * pathological all-timeout drain of a many-hundred-entity batch finishes well
 * inside this window, so a false positive (aging a row that was still going to
 * resolve) is nearly impossible — and if every lookup really is timing out for
 * half an hour, Wikidata is down and "error" is the correct outcome anyway.
 * Erring long mirrors the placeholder wedge watchdog's exact philosophy: a
 * safety net must never fire on healthy work.
 *
 * NEO-301: a lookup that cannot reach Wikidata is now RETRIED by the pool, and
 * the row stays `pending` across the whole ladder — at worst 18.2 minutes from
 * the item's first start to its final failure (the arithmetic is on
 * `WIKIDATA_POOL_RETRY` in wikidataPool.ts), inside this 30-minute window for
 * any row that starts promptly. A row queued behind a large batch during a
 * sustained outage can outlast it and be aged here mid-ladder; that is
 * self-correcting (a later successful attempt still writes "ready", and the
 * final backstop no-ops on a non-pending row), so this stays a clock from
 * creation rather than growing a heartbeat.
 */
export const ENTITY_REVIEW_STALE_MS = 30 * 60 * 1000;

/** Rows aged per sweep invocation before self-scheduling the rest — bounds the
 *  transaction the way the placeholder watchdog's take does. */
export const ENTITY_REVIEW_SWEEP_CHUNK = 100;

/**
 * Cron target (crons.ts): age review rows that have been `pending` past
 * ENTITY_REVIEW_STALE_MS to "error", so a lookup whose work item died mid-flight
 * — in a way even the pool's completion backstop never observed — cannot leave
 * the wizard hung on "Looking up…" forever.
 *
 * Reads through `by_status`, which orders `pending` rows oldest-first (every
 * index ends in `_creationTime` ascending), so the oldest — and therefore the
 * only candidates that can be stale — come first. The scan STOPS at the first
 * row younger than the cutoff: everything after it is younger still. In steady
 * state that first row is a few seconds old, so the common run reads the oldest
 * handful, ages none, and returns — cheap enough to run often.
 *
 * Bounded per invocation and self-scheduling for the remainder, mirroring
 * sweepWedgedBatches: a mass strand after an incident drains across several
 * runs rather than one giant transaction.
 */
export const sweepStalePendingRows = internalMutation({
  args: {},
  returns: v.object({ aged: v.number(), done: v.boolean() }),
  handler: async (ctx) => {
    const cutoff = Date.now() - ENTITY_REVIEW_STALE_MS;
    const oldest = await ctx.db
      .query("entityReviewQueue")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .take(ENTITY_REVIEW_SWEEP_CHUNK);

    let aged = 0;
    for (const row of oldest) {
      // Ordered oldest-first: the first row at-or-after the cutoff means every
      // remaining row is younger too, so there is nothing left to age.
      if (row._creationTime >= cutoff) break;
      await ctx.db.patch(row._id, { status: "error" });
      aged += 1;
    }

    if (aged > 0) {
      console.warn(
        JSON.stringify({ msg: "entity_review_stale_rows_aged", aged }),
      );
    }

    // Self-schedule only if the whole chunk was stale — then more may remain
    // (the aged rows have left the `pending` index, so the next run resumes at
    // the next-oldest and the set strictly shrinks). A partial chunk means the
    // scan hit a fresh row and there is nothing further to do.
    const done = aged < oldest.length || oldest.length < ENTITY_REVIEW_SWEEP_CHUNK;
    if (!done) {
      await ctx.scheduler.runAfter(0, internal.entityReviewQueue.sweepStalePendingRows, {});
    }
    return { aged, done };
  },
});

/**
 * Internal — deletes a batch's rows. NOT called by commitCardChecklist
 * (which deletes its batch's rows synchronously, inline, using the rows it
 * already read to resolve decisions — see the delete site there for why a
 * scheduled/async cleanup was replaced: it left a race where a re-fetch of
 * the same selectorOptionId could observe and wrongly resume an
 * already-committed batch). Kept as a standalone utility for clearing a
 * genuinely abandoned batch (e.g. the user closed the tab mid-review,
 * never confirmed or cancelled) — nothing currently calls it in the
 * commit/cancel path, both of which clean up their own rows directly.
 *
 * ## NEO-294 — it is also the TAIL of every other delete
 *
 * `cancelBatch` and `sweepAbandonedBatches` each delete one bounded page and
 * schedule this for whatever is behind it; this deletes a page of its own and
 * chains until the batch is gone. Each link commits on its own and re-reads
 * the batch from the head, so an interrupted chain loses nothing and a replay
 * finds fewer rows rather than deleting anything twice — a delete of a row
 * that is no longer there is not reached at all.
 */
export const cleanupBatch = internalMutation({
  args: {
    selectorOptionId: v.id("selectorOptions"),
    batchId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { hasMore } = await deleteBatchRows(
      ctx,
      args.selectorOptionId,
      args.batchId,
    );
    if (hasMore) {
      await scheduleBatchCleanup(ctx, args.selectorOptionId, args.batchId);
    }
    return null;
  },
});

/**
 * NEO-221 — how long a review batch may sit with NO operator activity before
 * the hourly cron deletes it.
 *
 * Distinct from ENTITY_REVIEW_STALE_MS above, which is about a single row's
 * LOOKUP hanging (30 minutes, ages `pending` → `error`, deletes nothing). This
 * one is about the SESSION: a wizard the operator closed the tab on, whose
 * rows are perfectly healthy and will simply sit there forever, quietly
 * resuming themselves into the next fetch of that set (see `startBatch`).
 *
 * A day, because deleting a batch throws away real operator work — every
 * decision recorded in it — and the only cost of erring long is some rows in a
 * throwaway table. An operator who reviews 200 names across a working day,
 * leaves it overnight and comes back is doing something entirely reasonable;
 * `lastTouchedAt` keeps their session alive for as long as they keep touching
 * it, and 24 hours of complete silence is the honest read of "nobody is coming
 * back".
 */
export const ENTITY_REVIEW_ABANDONED_MS = 24 * 60 * 60 * 1000;

/**
 * Rows examined per sweep invocation. Bounds the transaction the way
 * ENTITY_REVIEW_SWEEP_CHUNK does — a table PAGE, not an index range, because
 * abandonment is a property of a whole (selectorOptionId, batchId) group and
 * no index groups by that.
 */
export const ENTITY_REVIEW_ABANDONED_SCAN = 500;

/**
 * Cron target (crons.ts): delete review batches nobody is coming back to.
 *
 * ## What it is for
 *
 * `commitCardChecklist` and `cancelBatch` each clean up after themselves, so
 * the only batches that survive are the ones whose session simply ENDED —
 * closed tab, crashed browser, an operator who walked away. Those are not
 * inert: `startBatch` resumes any batch it finds for the same
 * (selectorOptionId, user), so an abandoned one silently becomes the next
 * fetch's starting point, complete with decisions made against a card list
 * that may be weeks old. Deleting it is what makes the next fetch a fresh
 * question.
 *
 * ## The abandonment test
 *
 * A batch is abandoned when EVERY row in it has been silent past the cutoff,
 * where a row's last sign of life is `max(_creationTime, lastTouchedAt ?? 0)`.
 * Every row, not any row and not the newest: a batch is one session, and one
 * decision recorded ten minutes ago is proof the whole session is alive even
 * if two hundred of its rows were inserted yesterday and never touched again.
 * `lastTouchedAt` absent means "never touched", which is exactly what a row
 * written before this field existed is.
 *
 * ## Why the page only NOMINATES, and the batch is then re-read in full
 *
 * The page is a window over the table ordered by `_creationTime`, and a batch
 * is routinely bigger than it — a first-time sync of a real set surfaces
 * hundreds of names. Judging a batch on the rows that happened to fall inside
 * the window would delete a live session whose recent activity sat just
 * outside it, which is the operator-work-destroying failure this whole ticket
 * is about. So a page can only nominate a (selectorOptionId, batchId) as a
 * candidate; the decision is taken over the batch's FULL row set, re-read
 * through `by_selector_option_and_batch` in this same transaction.
 *
 * ## Why it paginates with a cursor rather than restarting
 *
 * `sweepStalePendingRows` can restart from the top each run because the rows
 * it fixes LEAVE the index it reads (`status` stops being `pending`). This one
 * reads the whole table, and the rows it does not delete — every live batch —
 * stay exactly where they are. Without a cursor, a deployment whose oldest 500
 * rows are one long-running review would re-examine that same review forever
 * and never reach the abandoned batch behind it. So the cursor is carried
 * forward and the sweep self-schedules until the table is exhausted, the same
 * bounded-work-then-continue shape as `sweepWedgedBatches`.
 */
export const sweepAbandonedBatches = internalMutation({
  args: {
    // Continuation of THIS sweep's walk over the table. Absent on the cron's
    // own invocation, which always starts from the beginning.
    cursor: v.optional(v.string()),
  },
  returns: v.object({
    batches: v.number(),
    rows: v.number(),
    done: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const cutoff = Date.now() - ENTITY_REVIEW_ABANDONED_MS;
    const lastTouched = (row: Doc<"entityReviewQueue">) =>
      Math.max(row._creationTime, row.lastTouchedAt ?? 0);

    const page = await ctx.db
      .query("entityReviewQueue")
      .paginate({
        cursor: args.cursor ?? null,
        numItems: ENTITY_REVIEW_ABANDONED_SCAN,
      });

    // Group by (selectorOptionId, batchId). `\u0000` cannot appear in either
    // component, so the composite key is unambiguous. A batch straddling the
    // page boundary is nominated by whichever page holds a stale row of it and
    // then re-read in full below, so the split costs correctness nothing.
    const candidates = new Map<
      string,
      { selectorOptionId: Id<"selectorOptions">; batchId: string }
    >();
    for (const row of page.page) {
      if (lastTouched(row) >= cutoff) continue;
      const key = `${row.selectorOptionId}\u0000${row.batchId}`;
      if (!candidates.has(key)) {
        candidates.set(key, {
          selectorOptionId: row.selectorOptionId,
          batchId: row.batchId,
        });
      }
    }

    let batches = 0;
    let rows = 0;
    /**
     * NEO-294 — system operations this invocation has left, across ALL the
     * batches it nominated: one per batch re-read, one per row deleted.
     *
     * `deleteBatchRows` bounds ONE batch; nothing bounded the loop around it,
     * and a page of `ENTITY_REVIEW_ABANDONED_SCAN` table rows can nominate a
     * great many batches. A cron that reaps ten 754-row reviews in one
     * transaction is ~7,500 system operations, past the ~4,000 that fails
     * outright — the sweep would then throw on every run and the litter it
     * exists to clear would simply accumulate. The re-read is counted too: 500
     * nominations whose batches turn out to be alive is 500 operations spent
     * deleting nothing, which is the shape a busy deployment actually has.
     */
    let budget = ENTITY_REVIEW_DELETE_PAGE;
    /** A batch this invocation could not finish, or did not start. */
    let interrupted = false;
    for (const { selectorOptionId, batchId } of candidates.values()) {
      if (budget <= 0) {
        interrupted = true;
        break;
      }
      // The decision, taken over the WHOLE batch. One live row anywhere in it
      // means the session is not over — see the note above.
      const all = await ctx.db
        .query("entityReviewQueue")
        .withIndex("by_selector_option_and_batch", (q) =>
          q.eq("selectorOptionId", selectorOptionId).eq("batchId", batchId),
        )
        .collect();
      budget -= 1;
      if (all.length === 0) continue;
      if (all.some((row) => lastTouched(row) >= cutoff)) continue;
      // NEO-294 — `all` IS this batch, read through the same index in this
      // same transaction, so hand it over rather than paying for it twice.
      // (What must never be passed here is `page.page`, which is a sampled
      // window over the TABLE — see `deleteBatchRows`.)
      const { deleted, hasMore } = await deleteBatchRows(
        ctx,
        selectorOptionId,
        batchId,
        all.slice(0, Math.max(budget, 0)),
      );
      rows += deleted;
      budget -= deleted;
      batches += 1;
      // Bigger than one page, or bigger than what was left of this
      // invocation's budget: the tail is a scheduled `cleanupBatch`, exactly
      // as it is for a cancel.
      if (hasMore || deleted < all.length) {
        await scheduleBatchCleanup(ctx, selectorOptionId, batchId);
      }
    }

    if (batches > 0) {
      // Ids and counts only — never a name. See the no-PII rule in
      // observability.ts.
      console.warn(
        JSON.stringify({ msg: "entity_review_batches_reaped", batches, rows }),
      );
    }

    /*
     * NEO-294 — a budget-interrupted invocation re-runs on the SAME cursor.
     *
     * Advancing past a page whose candidates were not all judged would leave
     * those batches unreaped until the table wrapped around, which on a
     * deployment whose oldest rows are long-lived reviews is never. Re-reading
     * the same position is safe and terminates: the batches this run deleted
     * are gone, so the next pass nominates the ones behind them, and once a
     * pass spends less than its budget the cursor moves on as usual.
     *
     * `rows > 0` is what makes "terminates" a guarantee rather than an
     * argument about constant sizes. A pass that deleted NOTHING and re-ran on
     * the same cursor would nominate the same batches and do the same nothing,
     * forever; advancing instead costs only that the next CRON run (which
     * always starts from the head) re-nominates them. With
     * ENTITY_REVIEW_ABANDONED_SCAN below ENTITY_REVIEW_DELETE_PAGE the case
     * cannot arise today — a page cannot nominate enough batches to spend the
     * budget on re-reads alone — but the loop must not depend on that.
     */
    if (interrupted && rows > 0) {
      await ctx.scheduler.runAfter(
        0,
        internal.entityReviewQueue.sweepAbandonedBatches,
        args.cursor === undefined ? {} : { cursor: args.cursor },
      );
      return { batches, rows, done: false };
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.entityReviewQueue.sweepAbandonedBatches,
        { cursor: page.continueCursor },
      );
    }
    return { batches, rows, done: page.isDone };
  },
});
