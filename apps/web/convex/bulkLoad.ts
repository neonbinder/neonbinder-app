/**
 * NEO-284 — the armed bulk upsert, brought back slim for the NCAA D1 / ABL
 * team preload. Armed internal mutations, each with a read-only preview, and no
 * dataset.
 *
 * ## What this is
 *
 * The SERVER half of a scripted preload: a resumable, key-correlated way to
 * push leagues and teams into a deployment from a script run on somebody's
 * laptop. The other half — the college dataset, the chunking loop, the
 * `answers.json` / `progress.jsonl` bookkeeping — lives in the private
 * wrapper and is not in this repository. Nothing dataset-specific appears
 * here; what ships is a mechanism with no opinion about baseball.
 *
 * NEO-254 (#241) shipped the first version of this file with franchises and
 * players as well; #250 removed it once that load was done. This is the
 * leagues + teams half only, re-cut around the alias model NEO-284 adds.
 * NEO-285 brought back the players leg ADOPT-ONLY, as `upsertPlayerStints`:
 * college stints onto players NB already holds — see its section below.
 * NEO-611 adds the roster leg, `upsertPlayers`, which may also CREATE a player
 * (never on a guess: see its section) and shares the stint engine with
 * NEO-285. Creating people is opt-in by function name, so `upsertPlayerStints`
 * stays adopt-only.
 *
 * ## Product invariant
 *
 * Every row this writes is an NB row with an NB id, created from an operator's
 * own curated dataset. No marketplace value seeds anything here, no marketplace
 * id is written, and nothing downstream keys on one. `externalIds.wikidataId`
 * is linkage for Team Management's "Discover", never resolution. Sources are an
 * INITIAL INPUT and this is the input step; after it, these rows are NB's.
 *
 * ## The rules, and why each exists
 *
 * 1. **Armed, twice.** `confirm: "BULK_LOAD"` (the validator) and
 *    `ALLOW_BULK_LOAD === "true"` on the target deployment (asserted inside
 *    every mutation). A CLI run carries no identity — see the long note on
 *    `selectorOptions.resetSetBuilderDataFromCli` — so the flag is the only
 *    thing between a mistyped `--prod` and a thousand rows in the wrong place.
 *    Asserted in EVERY mutation rather than once at an entry point, because
 *    there is no entry point: the loop runs on the operator's machine. The
 *    preview query needs no arming — it writes nothing — but carries the
 *    confirm literal so a script cannot call the wrong one by accident.
 * 2. **Never invents a sport row.** Sports are created by the marketplace sync.
 *    A missing one is a named refusal, not a silent insert: a sport row nothing
 *    else recognises produces teams no query can ever find.
 * 3. **Never overwrites, never renames.** An existing row is ADOPTED and
 *    gap-filled — a fact the row already carries always outranks the
 *    dataset's, and `name`, `location`, colours and franchise are never
 *    touched at all. Aliases are UNIONED, never removed. This is the product
 *    invariant applied to our own data: after creation only an operator
 *    changes a row.
 * 4. **Never prompts, never guesses.** Where the match is ambiguous the row
 *    comes back `ambiguous` with its candidates and NOTHING is written for it.
 *    The script asks the human and resubmits that row with a `decision`. A
 *    mutation cannot ask a question, and one that guesses produces exactly the
 *    duplicate program rows this preload exists to avoid.
 *
 * ## Matching — the per-row protocol (plan §3 step 3; the ticket's section D)
 *
 * Prod already holds college teams: some created by hand under a proper
 * Location / Name split, some created from a raw Wikidata label ("Washington
 * Huskies baseball"). The dataset's canonical name for a program may be
 * neither, so a row is matched in three widening steps and every outcome says
 * HOW it matched:
 *
 *  1. **Decision replay.** An `adopt` answer from a previous run wins over the
 *     match — but only over the CHOICE, never over the key (see the branch).
 *     A `create` answer is unconditional and non-idempotent (below).
 *  2. **By name.** `findTeamsByExactName` on the composed full name, narrowed
 *     by `eraMatch` (the NEO-254 rule, unchanged: overlapping eras adopt, no
 *     overlap creates a new era, several → ambiguous, undated rival + CLOSED
 *     incoming → ambiguous, undated rival + OPEN incoming → adopt).
 *  3. **By alias**, only when the name found NOTHING: rows whose alias is the
 *     incoming full name; rows whose PRIMARY name is one of the incoming
 *     aliases — this is the label-named prod row, because the dataset always
 *     carries the Wikidata label as an alias, so it is found by construction;
 *     and rows merely SHARING an alias with the incoming row. Era-narrowed
 *     the same way. One row found through either of the first two legs →
 *     adopt with `matchedBy: "alias"`, `matchedOn`, and a `suggestion`
 *     carrying the dataset's canonical split — a REPORT LINE for the operator
 *     (plan decision 4), never written: an adopt never renames. A row found
 *     ONLY through a shared alias is `ambiguous` with that row as the
 *     candidate and `matchedOn` naming the string: one side's primary name is
 *     evidence of identity, two "also known as" lists touching is not — a
 *     bare "Miami" typed onto prod's RedHawks and carried by the dataset's
 *     Hurricanes would otherwise have written the Hurricanes' years, Q-id and
 *     aliases onto the RedHawks with nothing anywhere saying so. The operator
 *     answers adopt or create, and either converges.
 *  4. **Alias ownership.** Before any write, every incoming alias another row
 *     in the sport already holds as its name or an alias makes this row
 *     `ambiguous` with `aliasOwnedBy`, and nothing is written. Stricter than
 *     the player editor (advisory there): an alias the loader would attach
 *     unattended is exactly the shared-string case the dataset already dropped
 *     175 of. This also covers security condition S1 — an alias equal to
 *     another row's PRIMARY name — so the loader does not call
 *     `teams.assertAliasesNotPrimaryNames`; applying it here as well would
 *     turn a reported ambiguity into a thrown chunk. NEO-602: the loader
 *     stays STRICT, in any era, on purpose. The editors now allow an alias
 *     equal to another team's name when the two teams' years do not overlap,
 *     but an unattended load has no operator to judge that, so it keeps
 *     parking the pair as `ambiguous` rather than attaching it. With a `decision` present the operator HAS looked, so the owned
 *     aliases are skipped and reported as `aliasesSkipped` while the rest
 *     land — otherwise an `aliasOwnedBy` row would have no expressible answer
 *     and the run could never converge.
 *  4b. **Our NAME held as an alias (NEO-307).** A row whose composed full name
 *     another row in the sport holds as an ALIAS is never created — not by
 *     the create branch and not by a replayed `create` decision. It comes back
 *     `ambiguous` with `nameHeldAsAliasBy`, and settles once the alias is
 *     removed from the holder or the answer becomes `adopt: <holder id>`.
 *  5. **Adopt** gap-fills ABSENT fields only: `leagueId` (clearing the legacy
 *     `league` string — and only when the dataset row NAMES a league; a row
 *     with none leaves it absent, NEO-331), `yearsActive`,
 *     `externalIds.wikidataId`; aliases are
 *     unioned. A different `wikidataId` already on the row is reported as
 *     `wikidataMismatch` and left alone — it is the one signal that the match
 *     picked the wrong program.
 *  6. **Create** inserts the row with its aliases through the one index writer
 *     and reports `nearExisting`: rows in the sport that share the location
 *     token, ranked by `rankTeamCandidates`. That is what surfaces "Hawaii /
 *     Rainbow Warriors" created beside prod's "Hawaii / Rainbows" — two
 *     historical names are two rows by the NEO-254 model, and the loader never
 *     adopts across a rename; the operator dates the eras afterwards.
 *
 * ## NEO-676 — the MLB link pass (leagues, teams, players)
 *
 * The same three write legs and previews, with optional inputs (`mlbamId` on
 * all three, `minorLeagueClasses` on leagues, `parentClubs` on teams,
 * `birthDate` on players) and no new legs. The id is a LINK in the row's
 * `externalIds` slot, never a name and never truth (invariant 2b). Jason, 2026-11-25: "If there is a new player, team, etc
 * automation should create. No need to approve by a human. The only time a human
 * needs to be involved is when there is a disagreement between what MLB says and
 * what NB says." So:
 *
 *  - **Step 0, the id first.** Players: `by_mlbam_id` (`take(2)`: two holders
 *    are a tie). Teams: `by_mlbam_id`, narrowed by the era the row's seasons
 *    fall in (`eraMatch`), because one MLB id spans every NB era row of a
 *    franchise; two eras covering the season are a tie, none overlapping falls
 *    through to the name steps. A holder counts only if it answers to the
 *    incoming name (NB keeps one row per name, MLB one id across renames); one
 *    that does not is another name's row and is ignored, and so is one that
 *    answers only through an alias while another row's own name is the
 *    incoming name and overlaps its era. Leagues: a scan of the sport's
 *    leagues.
 *    A rerun therefore converges with no answers file.
 *  - **Adopt writes only empty fields**, plus the alias union: the id; a team's
 *    league, years, missing parent-club years and (as an alias) the API name
 *    when it differs; a league's aliases (only if none) and, on a minor league,
 *    its classes; a player's birth date when NB's birth year agrees (an
 *    undated row takes the date and its year). Never a name, location, level,
 *    any value already there, or a stint.
 *  - **Disagreements.** `disagreements: [{ field, nb, mlb }]` on a result,
 *    omitted when empty. A FIELD conflict (league, span, class, parent club,
 *    birth date) skips that field and the rest of the row lands. An IDENTITY
 *    conflict (another id on the row, the id held by another row, a birth year
 *    contradicting an id match, a tie, a team found only under another label,
 *    a probable duplicate) holds the whole row: `ambiguous`, nothing written.
 *    `{ adopt }` and `{ create: true }` decisions settle them as before.
 *  - **Leagues and teams are created** when nothing matches, with the id
 *    attached. The player leg can create too, but the link pass sends only
 *    `{ adopt }` answers: players are created in a later ticket.
 *
 * Runbook: `docs/operations/neo676-mlb-pass.md`.
 *
 * ## Chunking — TWO bounds, because a row is not a unit of cost
 *
 * Each mutation is one Convex transaction, so the caller loops in chunks of at
 * most 50 rows, and that cap is ENFORCED here rather than documented: a script
 * that quietly sends 500 fails halfway through with a limit error and leaves
 * the operator guessing which rows landed.
 *
 * NEO-296 — 50 ROWS was never the real bound. A row's cost is set by its
 * ALIASES: one full identity lookup per incoming alias, and
 * `MAX_TEAM_ALIASES` (teams.ts) admits 64. Fifty four-alias NCAA rows spend
 * ~900 operations; fifty 64-alias rows spend ~9,900 and die. The header used to
 * say "a chunk of rows carrying the dataset's 64-alias maximum should be sent
 * smaller" — a request to a caller, enforced by nothing. So the second bound is
 * `BULK_LOAD_TEAM_OP_BUDGET`, spent against what each row actually reads and
 * writes; see its note for the arithmetic.
 *
 * A call that runs out of budget STOPS BETWEEN ROWS and says so:
 * `hasMore: true`, `processed`, and `nextKey` — the key of the first row it did
 * not reach. Everything before that is written and committed; nothing after it
 * was read. **Resume from `nextKey`, never by re-sending the whole chunk**: an
 * adopt converges on a replay, but `decision: { create: true }` deliberately
 * does not (below), so a replayed prefix inserts a second row for every
 * `create` answer in it. `results` carries one entry per row reached, keyed by
 * the caller's own `key`, so a partial run is legible row by row rather than as
 * a number.
 *
 * ## Nothing here schedules enrichment — including through its helpers
 *
 * `findOrCreateLeague`'s insert branch schedules a league lookup; it accepts
 * `skipEnrichment` and every call in this file passes it. (A team row with no
 * league used to reach it through `resolveDefaultLeagueId`; since NEO-331 such
 * a row gets no league at all, so that path is gone.) Teams are not enriched at creation anywhere (NEO-254). Asserted
 * in `bulkLoad.test.ts` off `_scheduled_functions`, because a comment is
 * exactly the wrong place for this to live.
 *
 * ## `decision: { create: true }` is NOT idempotent, and cannot be made so
 *
 * Every other outcome converges on a re-run: an adopted row is found again, an
 * unmatched name creates once and is adopted thereafter (by name and era, or
 * by the aliases it now carries). `create` is the exception BY DEFINITION — it
 * means "none of the rows sharing this key is the one I mean", and the row it
 * inserts then shares that key too, so replaying it inserts a second one.
 * **The caller must record the `id` a `create` decision returned and replay
 * that row as `{ adopt: id }`, never as `{ create: true }`.** That is what the
 * wrapper's answers file is for.
 *
 * ## Dry run
 *
 * `dryRun: true` on `upsertTeams`, and the sibling `previewTeams` query, run
 * the same protocol minus the writes and report the same shape with `status`
 * `would-create` / `would-adopt` (`ambiguous` is `ambiguous` either way —
 * nothing would be written). The `leagues` summary on every result says what
 * each league name in the chunk resolved to; `null` there means the write run
 * would CREATE that league, which for "NCAA" is the assumption-10 signal to
 * add an alias in League Management first.
 *
 * Runbook: `docs/operations/neo284-team-aliases-preload.md`.
 */

import { internalMutation, internalQuery } from "./_generated/server";
// NEO-569 — a team's league filled in here re-settles its cards.
import { scheduleTeamLeagueRecompute } from "./cardLeague";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import type { Infer } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  findLeagueByName,
  findOrCreateLeague,
  leagueAnswersTo,
  normalizeAliasList as normalizeLeagueAliasList,
  normalizeLeagueName,
  requireValidLeagueAbbreviation,
} from "./leagues";
import type { LeagueLevel } from "./leagues";
// NEO-284 — the loader is a second door into `teams.aliases`, so it uses the
// SAME normaliser and the same index writer the admin editor does. A second
// derivation here is a second chance to write an alias the editor would have
// refused.
import {
  MAX_TEAM_ALIASES,
  normalizeTeamAliasList,
  normalizeTeamName,
  syncTeamAliases,
} from "./teams";
import {
  TEAM_ERA_SCAN_LIMIT,
  findTeamsByAlias,
  findTeamsByExactName,
  findTeamsByFullName,
  teamRowFields,
} from "./lib/teamRow";
// NEO-676 — the MLB link pass: the id guard, the birth date guard and the
// league class / parent club shapes the pass's new inputs go through.
import { isMlbamId } from "./lib/mlbamId";
import { isBirthDate } from "./lib/birthDate";
import {
  MAX_MINOR_LEAGUE_CLASSES,
  minorLeagueClassesValidator,
  type MinorLeagueClassEntry,
} from "./lib/leagueClass";
import {
  MAX_PARENT_CLUBS,
  parentClubsValidator,
  type ParentClubEntry,
} from "./lib/parentClubs";
import { cleanseExternalName } from "../lib/entities/cleanse-name";
import { erasOverlap } from "../lib/teams/team-era";
import {
  longestToken,
  nameTokens,
  rankPlayerCandidates,
  rankTeamCandidates,
} from "./lib/entityNearMatch";
import { teamFullName } from "../lib/teams/team-name";
import { isWikidataQid } from "../lib/players/wikidata-id";
// NEO-285 — the stints leg reads players the way the editor keys them and
// orders a career the one way every career writer does.
//
// NEO-611 — the roster leg reads candidates the way the New Player form and the
// review commit do (`sameNamePlayers`: name, alias and sport membership) and
// writes aliases through the one index writer.
import {
  MAX_PLAYER_ALIAS_LENGTH,
  MAX_PLAYER_ALIASES,
  MAX_PLAYER_TEAM_YEARS,
  PLAYER_AMBIGUITY_SCAN_LIMIT,
  matchedAliasFor,
  nameFragmentScan,
  normalizePlayerAliasList,
  normalizePlayerName,
  playerBelongsToSport,
  sameNamePlayers,
  syncPlayerAliases,
} from "./players";
import { sortTeamYears } from "../lib/players/team-tenure";
import { MIN_BIRTH_YEAR, maxBirthYear } from "../lib/players/career-years";
import { nameFragmentTokens } from "../lib/players/name-fragment";

// ---------------------------------------------------------------------------
// Bounds
// ---------------------------------------------------------------------------

/**
 * Rows per call — the OUTER bound. It caps the argument size and nothing else;
 * what actually bounds the transaction is `BULK_LOAD_TEAM_OP_BUDGET` below,
 * because a row's cost is set by its ALIASES, not by its being a row.
 */
const MAX_LEAGUES_PER_CALL = 50;
const MAX_TEAMS_PER_CALL = 50;

/**
 * NEO-296 — the operations one `loadTeams` transaction may spend before it
 * stops and hands the rest of the chunk back.
 *
 * ## What one operation is, and why rows were the wrong unit
 *
 * Convex counts one system operation per CALL — a `db.get`, an indexed or
 * search read, an `insert`, a `patch`, a `scheduler.runAfter`. A `.collect()`
 * returning 754 rows is ONE of them; the document count is a separate budget
 * with a separate error. So the cost of this loader is the number of CALLS its
 * per-row body makes, and that is driven by `row.aliases`, which nothing
 * bounded: `MAX_TEAM_ALIASES` (teams.ts) admits 64 per row, and the module
 * header's "a chunk of rows carrying the dataset's 64-alias maximum should be
 * sent smaller" was a request to the caller that no code enforced.
 *
 * ## The arithmetic, per incoming team row
 *
 *   `findTeamsByFullName` PER INCOMING ALIAS — the ownership/identity lookup:
 *     1 read  `findTeamsByExactName`, the primary-name index
 *     1 read  `findTeamsByAlias`, the `teamAliases` index
 *     1 `db.get` per alias row it returns, up to `TEAM_ERA_SCAN_LIMIT` (16)
 *     → 2 operations for the ordinary miss, up to 18 for a contested string
 *   1 read    the row's OWN name leg (`findTeamsByExactName`)
 *   1–17      the row's own alias leg, when the name leg found nothing
 *   ADOPT:    2–18 for the canonical-name re-read, 1 `patch`, and
 *             `syncTeamAliases` = 1 `.collect()` + up to 64 deletes + up to 64
 *             inserts
 *   CREATE:   1 search read for `nearExisting`, 1 `insert`, and
 *             `syncTeamAliases` = 1 `.collect()` + one insert per alias
 *
 * A 4-alias NCAA row on the create path is 4×2 + 1 + 1 + 1 + 1 + (1+4) ≈ 18
 * operations — ×50 rows ≈ 900, which is the house-comfortable figure and the
 * load this file was written against. A row carrying the dataset's 64-alias
 * maximum is 64×2 + 4 + (1+64) + 1 + 1 ≈ 198 — **×50 ≈ 9,900, which fails
 * outright**, and because a Convex transaction aborts whole, the operator
 * learns only that the chunk died and not which rows landed.
 *
 * The calibration is `CARDS_PER_COMMIT_CHUNK`'s (selectorOptions.ts, sized off
 * this same Convex error in NEO-189): ~900 comfortable, ~1,800 straining,
 * ~4,000 failing. This aims at the same ~900.
 *
 * ## Counted, not estimated
 *
 * The budget is spent against what the row ACTUALLY read — every identity
 * lookup reports `2 + rows.length`, every write reports what it wrote — rather
 * than against a worst case computed from the alias count. A worst-case
 * estimate would charge a clean 4-alias row 137 operations for the 16 `db.get`s
 * it will never make and cut the chunk to six rows, which would slow the real
 * preload by 8× to defend against a shape the dataset does not contain.
 *
 * The check runs BETWEEN rows, so one row may carry the call past the budget:
 * the ceiling is `BULK_LOAD_TEAM_OP_BUDGET` + the worst single row, and the
 * worst single row is a 64-alias row whose every alias is contested — 64×18 +
 * 18 + 18 + 1 + 129 ≈ 1,318. So 900 + 1,318 ≈ 2,220 absolute worst case:
 * inside the straining band, and less than a third of the ~9,900 this replaces.
 * A single row is never refused for its own size; it is always attempted, so no
 * row of a legitimate dataset becomes unloadable.
 *
 * Exported so a test can build a deliberately over-budget chunk without
 * hard-coding the number.
 */
export const BULK_LOAD_TEAM_OP_BUDGET = 900;

/**
 * The fixed half of one `findTeamsByFullName`: the name index read plus the
 * alias index read. The variable half is one `db.get` per alias row, which the
 * returned list counts.
 */
const IDENTITY_LOOKUP_BASE_OPS = 2;

/** Bounds on the strings this writes. Same values as their admin twins. */
const MAX_NAME_LENGTH = 120;
/** A caller-supplied correlation key, echoed back in results. Bounded because
 *  it is echoed into refusal messages. */
const MAX_KEY_LENGTH = 120;

/** The earliest year any of these datasets can legitimately carry. */
const MIN_YEAR = 1800;

/** How many `nearExisting` rows a create reports, and how many the search feeds it. */
const NEAR_EXISTING_SEARCH_CANDIDATES = 10;
const NEAR_EXISTING_LIMIT = 5;

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

/**
 * Asserted at the top of every mutation in this file, exactly as
 * `assertResetArmed` is asserted next to every delete.
 *
 * The duplication is the point: there is no single entry point to guard,
 * because the loop that calls these runs on an operator's laptop. A future
 * internal caller — a migration, a cron, a well-meaning `ctx.runMutation` —
 * that reached one of these directly would otherwise write unarmed.
 *
 * `ConvexError` rather than `Error`, because production Convex redacts a plain
 * `Error` message and the entire job of this refusal is to name the flag.
 *
 * The `confirm` literal is re-checked even though the validator already
 * enforces it. Belt and braces on a write path this wide costs one comparison.
 */
function assertBulkLoadArmed(confirm: string): void {
  if (confirm !== "BULK_LOAD") {
    throw new ConvexError("Bulk load requires confirm: \"BULK_LOAD\".");
  }
  if (process.env.ALLOW_BULK_LOAD !== "true") {
    throw new ConvexError(
      "Bulk load is not armed on this deployment. Set ALLOW_BULK_LOAD=true on " +
        "it first (`npx convex env set ALLOW_BULK_LOAD true`), and unset it " +
        "again afterwards (`npx convex env remove ALLOW_BULK_LOAD`).",
    );
  }
}

// ---------------------------------------------------------------------------
// Shared validators
// ---------------------------------------------------------------------------

const confirmValidator = v.literal("BULK_LOAD");

const yearsValidator = v.object({ from: v.number(), to: v.optional(v.number()) });

/**
 * NEO-676 — one place NB and MLB disagree, for the operator's review file.
 * NOTHING is written for the field it names. `nb` and `mlb` are display
 * strings ("" when that side has no value); the driver files them, it never
 * parses them. A result omits the list when it is empty, so a row that is not
 * part of the MLB pass reports exactly what it always did.
 */
const disagreementValidator = v.object({
  field: v.string(),
  nb: v.string(),
  mlb: v.string(),
});
type Disagreement = Infer<typeof disagreementValidator>;

const levelValidator = v.union(
  v.literal("major"),
  v.literal("minor"),
  v.literal("college"),
  v.literal("international"),
  v.literal("independent"),
  v.literal("other"),
);

/**
 * What happened to one row. `created` and `adopted` both mean "this key now
 * has an id"; `ambiguous` means nothing was written and the caller has a
 * question to answer; the `would-` pair is the dry run's report of what the
 * write run would do. `ambiguous` has no `would-` form because it writes
 * nothing in either mode.
 */
const statusValidator = v.union(
  v.literal("created"),
  v.literal("adopted"),
  v.literal("ambiguous"),
  v.literal("would-create"),
  v.literal("would-adopt"),
);

/**
 * The caller's answer to an `ambiguous` result, sent back on the same row.
 *
 * Two shapes rather than a nullable id, because "use this row" and "none of
 * those, make a new one" are different answers and a script must not be able to
 * express the second by accident.
 */
const teamDecisionValidator = v.union(
  v.object({ adopt: v.id("teams") }),
  v.object({ create: v.literal(true) }),
);

/** One incoming team row. See the header for what each field does. */
const teamRowValidator = v.object({
  key: v.string(),
  location: v.optional(v.string()),
  name: v.string(),
  aliases: v.optional(v.array(v.string())),
  league: v.optional(v.string()),
  yearsActive: v.optional(yearsValidator),
  wikidataId: v.optional(v.string()),
  /** NEO-676 — MLB's club id; matched first, era-narrowed. A link, never a name. */
  mlbamId: v.optional(v.number()),
  /** NEO-676 — which NB MLB era row this minor-league team's parent was, by season. */
  parentClubs: v.optional(parentClubsValidator),
  decision: v.optional(teamDecisionValidator),
});

/** A row on file, as an `ambiguous` result lists it for the operator. */
const candidateValidator = v.object({
  id: v.id("teams"),
  location: v.optional(v.string()),
  name: v.string(),
  yearsActive: v.optional(yearsValidator),
  aliases: v.optional(v.array(v.string())),
});

/** Another row that already answers to one of the incoming aliases. */
const aliasOwnerValidator = v.object({
  alias: v.string(),
  id: v.id("teams"),
  /** The owner's FULL name. */
  name: v.string(),
});

const teamResultValidator = v.object({
  key: v.string(),
  id: v.union(v.id("teams"), v.null()),
  status: statusValidator,
  /** How an adopt found its row. `decision` is a replayed answer. */
  matchedBy: v.optional(
    v.union(
      v.literal("name"),
      v.literal("alias"),
      v.literal("decision"),
      v.literal("mlbamId"),
    ),
  ),
  /** The incoming string that matched, when `matchedBy` is `alias`. */
  matchedOn: v.optional(v.string()),
  /**
   * The dataset's canonical Location / Name for a row adopted by alias. A
   * REPORT LINE — never written; the operator renames in Team Management if
   * they want to.
   */
  suggestion: v.optional(
    v.object({ location: v.optional(v.string()), name: v.string() }),
  ),
  /** Which absent fields an adopt filled: leagueId, yearsActive, wikidataId, mlbamId, parentClubs. */
  filled: v.optional(v.array(v.string())),
  /**
   * NEO-676 — where NB and MLB disagree. On an `adopted` row each entry is a
   * field left as it was; on an `ambiguous` row it is why the whole row was
   * held (nothing written). Omitted when empty.
   */
  disagreements: v.optional(v.array(disagreementValidator)),
  /** How many aliases an adopt added to the row (unioned, never removed). */
  aliasesAdded: v.optional(v.number()),
  /**
   * Incoming aliases NOT attached because another row already answers to
   * them — only on a row carrying a `decision`; without one the row is
   * `ambiguous` with `aliasOwnedBy` instead.
   */
  aliasesSkipped: v.optional(v.array(aliasOwnerValidator)),
  /** The row already carries a DIFFERENT Wikidata id. Left alone; look at it. */
  wikidataMismatch: v.optional(v.boolean()),
  /** `ambiguous`: the rows the match could not choose between. */
  candidates: v.optional(v.array(candidateValidator)),
  /** `ambiguous`: incoming aliases another row already holds. */
  aliasOwnedBy: v.optional(v.array(aliasOwnerValidator)),
  /**
   * NEO-307 — `ambiguous`: the rows that already hold this row's OWN full name
   * as an alias, so it cannot be created. `alias` is the full name. Settles by
   * removing the alias from the holder, or by answering `adopt: <holder id>`;
   * a replayed `create` stays here. See `create` in `loadTeams`.
   */
  nameHeldAsAliasBy: v.optional(v.array(aliasOwnerValidator)),
  /** `created`: rows in the sport that look like the same program. */
  nearExisting: v.optional(
    v.array(
      v.object({
        id: v.id("teams"),
        name: v.string(),
        yearsActive: v.optional(yearsValidator),
      }),
    ),
  ),
});

const teamsResultValidator = v.object({
  /**
   * One entry per row this call REACHED, in the order they were sent. On a
   * truncated call it is shorter than the chunk; correlate by `key` and the
   * rows that did not land are the ones with no entry.
   */
  results: v.array(teamResultValidator),
  /**
   * What every league name in the chunk resolved to. `null` means the write
   * run would create it — for "NCAA" that is the signal to add an alias to the
   * existing league row first rather than let the loader mint a second one.
   *
   * NEO-296: only the leagues the PROCESSED rows named. A truncated call says
   * nothing about a league only its unreached tail mentions.
   */
  leagues: v.array(
    v.object({ name: v.string(), id: v.union(v.id("leagues"), v.null()) }),
  ),
  /** NEO-296 — how many rows of the chunk this call reached. */
  processed: v.number(),
  /**
   * NEO-296 — this call stopped on `BULK_LOAD_TEAM_OP_BUDGET`, not on the end
   * of the chunk. Everything it wrote is committed; the rows from `nextKey`
   * onwards were not read and not written.
   */
  hasMore: v.boolean(),
  /**
   * NEO-296 — the `key` of the first row NOT reached. **Resume from this key**,
   * never by re-sending the whole chunk: an adopt converges on a replay but
   * `decision: { create: true }` deliberately does not (see the header), so a
   * replayed prefix would insert a second row for every `create` answer in it.
   */
  nextKey: v.union(v.string(), v.null()),
  /** NEO-296 — operations this call actually spent. See the budget's note. */
  opsSpent: v.number(),
});

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Cleanse (NEO-643: the dataset's stray backslashes, soft hyphens and
 * zero-width characters out; spacing collapsed and trimmed), refuse empty or
 * over-long.
 */
function boundedName(raw: string, what: string, key: string): string {
  const name = cleanseExternalName(raw);
  if (name.length === 0) {
    throw new ConvexError(`${what} for "${key}" is empty.`);
  }
  if (name.length > MAX_NAME_LENGTH) {
    // The LENGTH, never the value — this reaches Sentry through Convex's
    // error path, same rule as every other name bound in the codebase.
    throw new ConvexError(
      `${what} for "${key}" is ${name.length} characters; the limit is ${MAX_NAME_LENGTH}.`,
    );
  }
  return name;
}

/** The caller's own correlation handle, echoed into results and refusals. */
function boundedKey(raw: string): string {
  const key = raw.trim();
  if (key.length === 0) throw new ConvexError("A row key cannot be empty.");
  if (key.length > MAX_KEY_LENGTH) {
    throw new ConvexError(
      `A row key is ${key.length} characters; the limit is ${MAX_KEY_LENGTH}.`,
    );
  }
  return key;
}

/**
 * Whole years, in range, ending no earlier than they start.
 *
 * The upper bound is NEXT year rather than this one, matching
 * `leagues.validateLeagueYears` and `players.savePlayerFields`: a season
 * already announced is a real span, and refusing it would make the loader wrong
 * every winter.
 */
function assertYears(
  years: { from: number; to?: number },
  what: string,
  key: string,
): void {
  const maxYear = new Date().getFullYear() + 1;
  if (!Number.isInteger(years.from) || years.from < MIN_YEAR || years.from > maxYear) {
    throw new ConvexError(
      `${what} for "${key}" starts in ${years.from}; expected a whole year between ${MIN_YEAR} and ${maxYear}.`,
    );
  }
  if (years.to !== undefined) {
    if (!Number.isInteger(years.to) || years.to < MIN_YEAR || years.to > maxYear) {
      throw new ConvexError(
        `${what} for "${key}" ends in ${years.to}; expected a whole year between ${MIN_YEAR} and ${maxYear}.`,
      );
    }
    if (years.to < years.from) {
      throw new ConvexError(`${what} for "${key}" ends before it starts.`);
    }
  }
}

/**
 * A Wikidata id is `Q<digits>` or it is refused — not dropped, as
 * `teams.applyEnrichmentInternal` drops one, because this value comes off a
 * curated dataset with an operator in the path and a bad one is a dataset bug
 * they should hear about.
 */
function boundedQid(raw: string, key: string): string {
  const qid = raw.trim();
  if (!isWikidataQid(qid)) {
    throw new ConvexError(`The Wikidata id for "${key}" is not a Q-number.`);
  }
  return qid;
}

/** Refuse a chunk bigger than one transaction should carry. */
function assertChunkSize(count: number, max: number, what: string): void {
  if (count > max) {
    throw new ConvexError(
      `${count} ${what} in one call; the limit is ${max}. Send them in chunks.`,
    );
  }
}

// ---------------------------------------------------------------------------
// NEO-676 — the MLB link pass: bounds and display helpers
// ---------------------------------------------------------------------------

/** MLB's id for this row, or the call is refused naming the row, not the value. */
function boundedMlbamId(raw: number, key: string): number {
  if (!isMlbamId(raw)) {
    throw new ConvexError(`The MLB id for "${key}" is not a positive whole number.`);
  }
  return raw;
}

/**
 * One MLB id on two rows of one call is the driver's bug (two MLB people never
 * share an id): the second row would find the first's new row by that id and
 * the pair would report as one. Refused up front, naming both rows. Not used
 * for teams: one club id spans every era row of the franchise.
 */
function assertNoRepeatedMlbamIds(
  rows: ReadonlyArray<{ label: string; mlbamId: number | undefined }>,
): void {
  const seen = new Map<number, string>();
  for (const { label, mlbamId } of rows) {
    if (mlbamId === undefined) continue;
    const first = seen.get(mlbamId);
    if (first !== undefined) {
      throw new ConvexError(
        `The MLB id ${mlbamId} is on both "${first}" and "${label}" in this call.`,
      );
    }
    seen.set(mlbamId, label);
  }
}

/** A birth date, or the call is refused; checked against the row's own birth year. */
function boundedBirthDate(
  raw: string,
  birthYear: number | undefined,
  key: string,
): string {
  const date = raw.trim();
  if (!isBirthDate(date)) {
    throw new ConvexError(
      `The birth date for "${key}" is not a real date written YYYY-MM-DD.`,
    );
  }
  if (birthYear !== undefined && Number(date.slice(0, 4)) !== birthYear) {
    throw new ConvexError(`The birth date for "${key}" is not in the row's birth year.`);
  }
  return date;
}

const describeYears = (years: { from: number; to?: number } | undefined): string =>
  years ? `${years.from}-${years.to ?? ""}` : "";

/** Is every season of `mlb` inside `nb`'s span? An open `nb` runs on forever. */
function yearsWithin(
  mlb: { from: number; to?: number },
  nb: { from: number; to?: number },
): boolean {
  if (mlb.from < nb.from) return false;
  if (nb.to === undefined) return true;
  return mlb.to !== undefined && mlb.to <= nb.to;
}

/** League classes in one order, own fields only, so two lists compare by value. */
function normalizeClassEntries(
  entries: ReadonlyArray<MinorLeagueClassEntry>,
): MinorLeagueClassEntry[] {
  return entries
    .map((e) => ({
      class: e.class,
      fromYear: e.fromYear,
      ...(e.toYear !== undefined ? { toYear: e.toYear } : {}),
    }))
    .sort((a, b) => a.fromYear - b.fromYear || a.class.localeCompare(b.class));
}

const describeClasses = (entries: ReadonlyArray<MinorLeagueClassEntry>): string =>
  normalizeClassEntries(entries)
    .map((e) => `${e.class} ${e.fromYear}-${e.toYear ?? ""}`)
    .join("; ");

function boundedClasses(
  raw: ReadonlyArray<MinorLeagueClassEntry>,
  key: string,
): MinorLeagueClassEntry[] {
  if (raw.length > MAX_MINOR_LEAGUE_CLASSES) {
    throw new ConvexError(
      `"${key}" has ${raw.length} league classes; the limit is ${MAX_MINOR_LEAGUE_CLASSES}.`,
    );
  }
  for (const entry of raw) {
    assertYears(
      { from: entry.fromYear, ...(entry.toYear !== undefined ? { to: entry.toYear } : {}) },
      "A league class",
      key,
    );
  }
  return normalizeClassEntries(raw);
}

const describeParents = (entries: ReadonlyArray<ParentClubEntry>): string =>
  entries
    .map((e) => `${e.parentTeamId} ${e.fromYear}-${e.toYear ?? ""}`)
    .join("; ");

/** The seasons of `years` that none of `covers` spans, as year ranges. */
function uncoveredYears(
  years: { from: number; to?: number },
  covers: ReadonlyArray<{ from: number; to?: number }>,
): Array<{ from: number; to?: number }> {
  let gaps: Array<{ from: number; to?: number }> = [years];
  for (const c of covers) {
    gaps = gaps.flatMap((g) => {
      if (!erasOverlap(g, c)) return [g];
      const out: Array<{ from: number; to?: number }> = [];
      if (g.from < c.from) out.push({ from: g.from, to: c.from - 1 });
      if (c.to !== undefined && (g.to === undefined || g.to > c.to)) {
        out.push({ from: c.to + 1, ...(g.to !== undefined ? { to: g.to } : {}) });
      }
      return out;
    });
  }
  return gaps;
}

/**
 * Fold incoming parent-club years into what a team already carries: a stretch
 * some affiliation already covers is left alone (the same club: present; a
 * different club: a disagreement, nothing written for it), and only the
 * uncovered seasons are added. Never changes or removes an entry.
 */
function mergeParentClubs(
  existing: ReadonlyArray<ParentClubEntry>,
  incoming: ReadonlyArray<ParentClubEntry>,
): { next: ParentClubEntry[]; disagreements: Disagreement[] } {
  const next = [...existing];
  const disagreements: Disagreement[] = [];
  for (const entry of incoming) {
    const years = {
      from: entry.fromYear,
      ...(entry.toYear !== undefined ? { to: entry.toYear } : {}),
    };
    const range = (e: ParentClubEntry) => ({
      from: e.fromYear,
      ...(e.toYear !== undefined ? { to: e.toYear } : {}),
    });
    const overlapping = existing.filter((e) => erasOverlap(range(e), years));
    const other = overlapping.filter((e) => e.parentTeamId !== entry.parentTeamId);
    if (other.length > 0) {
      disagreements.push({
        field: "parentClubs",
        nb: describeParents(other),
        mlb: describeParents([entry]),
      });
      continue;
    }
    const same = overlapping.map(range);
    for (const gap of uncoveredYears(years, same)) {
      next.push({
        parentTeamId: entry.parentTeamId,
        fromYear: gap.from,
        ...(gap.to !== undefined ? { toYear: gap.to } : {}),
      });
    }
  }
  next.sort((a, b) => a.fromYear - b.fromYear);
  return { next, disagreements };
}

/**
 * The sport row this call is about — looked up, never created.
 *
 * Matched case-insensitively on `selectorOptions.value` among `level: "sport"`
 * rows. A miss NAMES the sport, because the operator's next move is either to
 * sync it or to fix a typo in their script, and "no sport" tells them neither.
 */
async function requireSportId(
  ctx: QueryCtx | MutationCtx,
  sport: string,
): Promise<Id<"selectorOptions">> {
  const wanted = sport.trim().toLowerCase();
  if (!wanted) throw new ConvexError("A sport is required.");
  if (wanted.length > MAX_NAME_LENGTH) {
    throw new ConvexError("That sport name is too long to be a sport row.");
  }
  const rows = await ctx.db
    .query("selectorOptions")
    .withIndex("by_level", (q) => q.eq("level", "sport"))
    .collect();
  const hit = rows.find((row) => (row.value ?? "").trim().toLowerCase() === wanted);
  if (!hit) {
    throw new ConvexError(
      `No sport row for "${sport.trim()}" on this deployment. Sports are created ` +
        `by the marketplace sync and are never invented here — sync it first.`,
    );
  }
  return hit._id;
}

// ---------------------------------------------------------------------------
// Leagues
// ---------------------------------------------------------------------------

const leagueRowValidator = v.object({
  name: v.string(),
  abbreviation: v.optional(v.string()),
  // NEO-331: required — a league row cannot exist without a level, and
  // a curated dataset is exactly the caller that knows it.
  level: levelValidator,
  yearsActive: v.optional(yearsValidator),
  aliases: v.optional(v.array(v.string())),
  wikidataId: v.optional(v.string()),
  // NEO-676 — the MLB link pass. A row carrying `mlbamId` is matched by
  // that id first (see the section note below); `minorLeagueClasses`
  // is written only on a league whose level is "minor".
  mlbamId: v.optional(v.number()),
  minorLeagueClasses: v.optional(minorLeagueClassesValidator),
});

const leaguesResultValidator = v.object({
  results: v.array(
    v.object({
      name: v.string(),
      id: v.union(v.id("leagues"), v.null()),
      created: v.boolean(),
      /**
       * NEO-676 — the NB row's current name when a row matched; the incoming
       * name when the row is (or would be) created; null when held. Lets the
       * driver send a team's league by NB's name.
       */
      nbName: v.union(v.string(), v.null()),
      /** NEO-676 — absent fields an adopt filled: mlbamId, minorLeagueClasses, aliases. */
      filled: v.optional(v.array(v.string())),
      /** NEO-676 — see `disagreementValidator`. A held row has `id: null`, `created: false`. */
      disagreements: v.optional(v.array(disagreementValidator)),
    }),
  ),
});

type LeagueRowInput = Infer<typeof leagueRowValidator>;

/**
 * The league load, once, for the write run and the preview. `write: false`
 * reads and reports only (the way `loadTeams` and `loadRosterPlayers` do).
 */
async function loadLeagues(
  ctx: QueryCtx | MutationCtx,
  args: { sport: string; leagues: LeagueRowInput[] },
  write: boolean,
) {
  assertChunkSize(args.leagues.length, MAX_LEAGUES_PER_CALL, "leagues");
  assertNoRepeatedMlbamIds(
    args.leagues.map((l) => ({ label: l.name, mlbamId: l.mlbamId })),
  );
  const sportId = await requireSportId(ctx, args.sport);
  const mutationCtx = write ? (ctx as MutationCtx) : null;

  const results: {
    name: string;
    id: Id<"leagues"> | null;
    created: boolean;
    nbName: string | null;
    filled?: string[];
    disagreements?: Disagreement[];
  }[] = [];

  for (const row of args.leagues) {
    const name = boundedName(row.name, "A league name", row.name);
    // The admin editor's own bound (16), so the loader cannot store an
    // abbreviation League Management would refuse to save back.
    const abbreviation = requireValidLeagueAbbreviation(row.abbreviation);
    if (row.yearsActive) assertYears(row.yearsActive, "A league span", name);
    const wikidataId = row.wikidataId ? boundedQid(row.wikidataId, name) : undefined;
    const mlbamId =
      row.mlbamId === undefined ? undefined : boundedMlbamId(row.mlbamId, name);
    const classes = row.minorLeagueClasses
      ? boundedClasses(row.minorLeagueClasses, name)
      : undefined;
    // Bounded the way League Management bounds them, own name dropped.
    const aliases = row.aliases
      ? normalizeLeagueAliasList(row.aliases.map(cleanseExternalName), name)
      : [];
    const disagreements: Disagreement[] = [];

    // Asked BEFORE the helper runs, because `findOrCreateLeague` does not say
    // whether it inserted and the script's report is the operator's only view
    // of what a run did.
    let before: Doc<"leagues"> | null;
    if (mlbamId === undefined) {
      before = await findLeagueByName(ctx, { name, sportId });
    } else {
      /*
       * NEO-676 step 0: the id first, over the sport's leagues (a small
       * per-sport set; an id inside `externalIds` has no league index). Two
       * rows holding one id, or two rows answering to one name, are a tie
       * the operator breaks: `findLeagueByName` returns the first hit and
       * that is exactly the guess this path must never make.
       */
      const rows = await ctx.db
        .query("leagues")
        .withIndex("by_sport_id", (q) => q.eq("sportId", sportId))
        .collect();
      const byId = rows.filter((r) => r.externalIds?.mlbamId === mlbamId);
      let hold: Disagreement[] | null = null;
      if (byId.length > 1) {
        hold = [
          {
            field: "mlbamId",
            nb: byId.map((r) => `${r.name} (${r._id})`).join("; "),
            mlb: String(mlbamId),
          },
        ];
        before = null;
      } else if (byId.length === 1) {
        before = byId[0];
      } else {
        const nameKey = normalizeLeagueName(name);
        const hits = rows.filter((r) => leagueAnswersTo(r, nameKey));
        if (hits.length > 1) {
          hold = [
            {
              field: "name",
              nb: hits.map((r) => `${r.name} (${r._id})`).join("; "),
              mlb: name,
            },
          ];
          before = null;
        } else {
          before = hits[0] ?? null;
          const held = before?.externalIds?.mlbamId;
          if (before && held !== undefined) {
            // A different id already sits on the row the name found.
            hold = [{ field: "mlbamId", nb: String(held), mlb: String(mlbamId) }];
          } else if (before) {
            /*
             * Found by NAME, not by id, so nothing says it is the same
             * league: MLB has three "American Association"s (a major
             * 1882-91, a minor AAA, an independent) and NB one. A different
             * level, or spans that never overlap, is a different league
             * answering to the same name: hold the whole row, with the
             * level / span entries so the operator sees why. (A match by id
             * keeps its field disagreements and links.)
             */
            const levelDiffers = before.level !== row.level;
            const spansApart =
              before.yearsActive !== undefined &&
              row.yearsActive !== undefined &&
              !erasOverlap(before.yearsActive, row.yearsActive);
            if (levelDiffers || spansApart) {
              const why: Disagreement[] = [];
              if (levelDiffers) {
                why.push({ field: "level", nb: before.level, mlb: row.level });
              }
              if (
                before.yearsActive !== undefined &&
                row.yearsActive &&
                !yearsWithin(row.yearsActive, before.yearsActive)
              ) {
                why.push({
                  field: "yearsActive",
                  nb: describeYears(before.yearsActive),
                  mlb: describeYears(row.yearsActive),
                });
              }
              hold = why;
              before = null;
            }
          }
        }
      }
      if (hold) {
        results.push({
          name,
          id: null,
          created: false,
          nbName: null,
          disagreements: hold,
        });
        continue;
      }
    }

    let id: Id<"leagues"> | null = before?._id ?? null;
    if (mutationCtx && mlbamId !== undefined && before) {
      /*
       * NEO-676: the league was found by its id (or by the one name that
       * answers). Never go back through the name lookup: with two
       * same-named leagues in the sport it would return the first hit, and
       * the gap-fills would land on a row this pass never chose. The same
       * gap-fills `findOrCreateLeague` makes, on the row already in hand.
       */
      const gaps: Partial<Doc<"leagues">> = {};
      if (abbreviation && !before.abbreviation) gaps.abbreviation = abbreviation;
      if (row.yearsActive && !before.yearsActive) gaps.yearsActive = row.yearsActive;
      if (wikidataId && !before.externalIds?.wikidataId) {
        gaps.externalIds = { ...(before.externalIds ?? {}), wikidataId };
      }
      if (Object.keys(gaps).length > 0) {
        await mutationCtx.db.patch(before._id, { ...gaps, lastUpdated: Date.now() });
      }
      // Alias gap-fill on a row this pass FOUND — see the doc comment.
      if (aliases.length > 0 && (before.aliases ?? []).length === 0) {
        await mutationCtx.db.patch(before._id, { aliases, lastUpdated: Date.now() });
      }
    } else if (mutationCtx) {
      id = await findOrCreateLeague(mutationCtx, {
        name,
        ...(abbreviation ? { abbreviation } : {}),
        sportId,
        // See the header: no call in this file queues a Wikidata lookup.
        skipEnrichment: true,
        level: row.level as LeagueLevel,
        ...(aliases.length > 0 ? { aliases } : {}),
        ...(row.yearsActive ? { yearsActive: row.yearsActive } : {}),
        ...(wikidataId ? { wikidataId } : {}),
      });

      // Alias gap-fill on a row the helper FOUND — see the doc comment.
      if (before && aliases.length > 0 && (before.aliases ?? []).length === 0) {
        await mutationCtx.db.patch(id, { aliases, lastUpdated: Date.now() });
      }
    }

    const filled: string[] = [];
    if (before && mlbamId !== undefined && aliases.length > 0 && (before.aliases ?? []).length === 0) {
      filled.push("aliases");
    }
    if (mlbamId !== undefined || classes) {
      // The row as it stands now (after the helper's own gap-fills); on a
      // preview of a create there is no row yet and nothing to compare.
      const target = write && id ? await ctx.db.get(id) : before;
      if (target) {
        const patch: Partial<Doc<"leagues">> = {};
        if (mlbamId !== undefined && target.externalIds?.mlbamId === undefined) {
          patch.externalIds = { ...(target.externalIds ?? {}), mlbamId };
          if (before) filled.push("mlbamId");
        }
        // NEO-676: what NB holds outranks MLB's; a difference is reported,
        // nothing written for it. Only a league this pass found has a
        // level or span of NB's own to compare.
        if (before && mlbamId !== undefined) {
          if (target.level !== row.level) {
            disagreements.push({ field: "level", nb: target.level, mlb: row.level });
          }
          if (
            target.yearsActive !== undefined &&
            row.yearsActive &&
            !yearsWithin(row.yearsActive, target.yearsActive)
          ) {
            disagreements.push({
              field: "yearsActive",
              nb: describeYears(target.yearsActive),
              mlb: describeYears(row.yearsActive),
            });
          }
        }
        // Classes belong to a minor league only; NB's own level decides.
        if (classes && target.level === "minor") {
          const held = target.minorLeagueClasses;
          if (held === undefined || held.length === 0) {
            patch.minorLeagueClasses = classes;
            if (before) filled.push("minorLeagueClasses");
          } else if (describeClasses(held) !== describeClasses(classes)) {
            disagreements.push({
              field: "minorLeagueClasses",
              nb: describeClasses(held),
              mlb: describeClasses(classes),
            });
          }
        }
        if (mutationCtx && Object.keys(patch).length > 0) {
          await mutationCtx.db.patch(target._id, { ...patch, lastUpdated: Date.now() });
        }
      }
    }

    results.push({
      name,
      id,
      created: before === null,
      // The NB row's own name when one matched; the incoming name when
      // the row is (or would be) created. Never a marketplace value.
      nbName: before?.name ?? name,
      ...(filled.length > 0 ? { filled } : {}),
      ...(disagreements.length > 0 ? { disagreements } : {}),
    });
  }

  return { results };
}

/**
 * Leagues, keyed by name-or-alias within the sport.
 *
 * Thin over `findOrCreateLeague`, which every other league writer already goes
 * through, so a bulk-loaded league dedupes against one an operator added by
 * hand and vice versa. That helper already gap-fills abbreviation, level,
 * years and the Wikidata id on a row it finds; the one thing this adds is the
 * alias GAP-FILL — the helper deliberately never widens an existing row's
 * aliases (that is an operator decision in League Management), and a preload
 * of a league nobody has touched is the one caller for which "absent, so take
 * the dataset's" is the right rule. A row that already has ANY alias keeps
 * exactly what it has.
 *
 * `dryRun` resolves and reports without writing: `id: null` with
 * `created: true` means the write run would insert this league.
 */
export const upsertLeagues = internalMutation({
  args: {
    confirm: confirmValidator,
    sport: v.string(),
    dryRun: v.optional(v.boolean()),
    leagues: v.array(leagueRowValidator),
  },
  returns: leaguesResultValidator,
  handler: async (ctx, args) => {
    assertBulkLoadArmed(args.confirm);
    return await loadLeagues(ctx, args, !args.dryRun);
  },
});

/**
 * The leagues dry run as a QUERY, so it runs on a deployment nobody has armed,
 * as `previewTeams` and `previewPlayers` do (same reasoning, see
 * `previewTeams`): arming guards writes, and a preview writes nothing. It
 * shares `loadLeagues` with `upsertLeagues`, so the two cannot drift; only the
 * confirm literal is checked.
 */
export const previewLeagues = internalQuery({
  args: {
    confirm: confirmValidator,
    sport: v.string(),
    leagues: v.array(leagueRowValidator),
  },
  returns: leaguesResultValidator,
  handler: async (ctx, args) => {
    if (args.confirm !== "BULK_LOAD") {
      throw new ConvexError("Bulk load preview requires confirm: \"BULK_LOAD\".");
    }
    return await loadLeagues(ctx, args, false);
  },
});

// ---------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------

/** What matching an incoming team row against the eras already on file found. */
type EraMatch =
  | { kind: "none" }
  | { kind: "one"; team: Doc<"teams"> }
  | { kind: "several"; teams: Doc<"teams">[] };

/**
 * NEO-254 — which ERA of this name the incoming row is.
 *
 * Two Winnipeg Jets exist: 1972-1996 and 2011-. Matching on the name alone
 * folded them into one row, so the loader would have adopted the 2011
 * franchise for every 1970s roster it carried.
 *
 * The rule, and each branch is a different kind of certainty:
 *
 *  - **Overlapping eras.** `erasOverlap` treats an undated side as unknown, so
 *    a dataset row with years matches an undated row on file (we cannot say it
 *    is a different team) and vice versa. Exactly one overlap is the answer.
 *  - **No overlap at all.** Every row on file is a franchise that had ended
 *    before this one began, or began after it ended. That is positive evidence
 *    of a NEW era, so the caller creates — this is what puts the 1972 Jets
 *    beside the 2011 Jets instead of on top of them.
 *  - **Two or more overlaps.** The years do not separate them and the loader
 *    does not guess. `ambiguous`, with the candidates and their years, for the
 *    operator to answer and resubmit.
 */
function eraMatch(
  candidates: readonly Doc<"teams">[],
  yearsActive: { from: number; to?: number } | undefined,
): EraMatch {
  if (candidates.length === 0) return { kind: "none" };
  const overlapping = candidates.filter((team) =>
    erasOverlap(team.yearsActive, yearsActive),
  );
  if (overlapping.length === 0) return { kind: "none" };
  if (overlapping.length > 1) return { kind: "several", teams: overlapping };

  /**
   * One overlap — but if it overlaps only because it is UNDATED, adopting it
   * is order-dependent, and that is a bug rather than a tie.
   *
   * The case: prod holds an undated "Adelaide Giants" carrying a league and
   * colours. The dataset then sends both ABL eras. Whichever arrives FIRST
   * matches the undated row, adopts it, gap-fills its years and inherits
   * everything on it; the second arrives, no longer overlaps, and is created
   * bare. Run the chunks in the other order and the colours land on the other
   * era. Nothing errors, and the result depends on array order in a file.
   *
   * So an undated row is only adopted by an era that could plausibly BE it —
   * an OPEN one, which is what an undated row created from today's roster
   * actually is. A CLOSED incoming era (1989-1999) is a historical club, the
   * one thing an undated "as it stands today" row is least likely to mean, so
   * it comes back ambiguous with that row as the candidate and the operator
   * dates it once. Both arrival orders then converge, because neither writes.
   */
  const only = overlapping[0];
  const undatedRival = only.yearsActive === undefined;
  const incomingIsClosed = yearsActive?.to !== undefined;
  if (undatedRival && incomingIsClosed) {
    return { kind: "several", teams: overlapping };
  }
  return { kind: "one", team: only };
}

type TeamRowInput = {
  key: string;
  location?: string;
  name: string;
  aliases?: string[];
  league?: string;
  yearsActive?: { from: number; to?: number };
  wikidataId?: string;
  mlbamId?: number;
  parentClubs?: ParentClubEntry[];
  decision?: { adopt: Id<"teams"> } | { create: true };
};

type TeamStatus = "created" | "adopted" | "ambiguous" | "would-create" | "would-adopt";

type AliasOwner = { alias: string; id: Id<"teams">; name: string };

type TeamResult = {
  key: string;
  id: Id<"teams"> | null;
  status: TeamStatus;
  matchedBy?: "name" | "alias" | "decision" | "mlbamId";
  matchedOn?: string;
  suggestion?: { location?: string; name: string };
  filled?: string[];
  disagreements?: Disagreement[];
  aliasesAdded?: number;
  aliasesSkipped?: AliasOwner[];
  wikidataMismatch?: boolean;
  candidates?: {
    id: Id<"teams">;
    location?: string;
    name: string;
    yearsActive?: { from: number; to?: number };
    aliases?: string[];
  }[];
  aliasOwnedBy?: AliasOwner[];
  nameHeldAsAliasBy?: AliasOwner[];
  nearExisting?: {
    id: Id<"teams">;
    name: string;
    yearsActive?: { from: number; to?: number };
  }[];
};

type TeamsResult = {
  results: TeamResult[];
  leagues: { name: string; id: Id<"leagues"> | null }[];
  processed: number;
  hasMore: boolean;
  nextKey: string | null;
  opsSpent: number;
};

function candidateOf(team: Doc<"teams">): NonNullable<TeamResult["candidates"]>[number] {
  return {
    id: team._id,
    name: team.name,
    ...(team.location !== undefined ? { location: team.location } : {}),
    ...(team.yearsActive !== undefined ? { yearsActive: team.yearsActive } : {}),
    ...(team.aliases !== undefined && team.aliases.length > 0
      ? { aliases: team.aliases }
      : {}),
  };
}

/**
 * The protocol, shared by the mutation and the preview query. `ctx` is a
 * mutation context only when `write` is true; every write below is behind that
 * flag and the query passes false. Kept as one function rather than two so the
 * dry run cannot drift from what the write run does — the dry run's only job is
 * to predict it.
 */
async function loadTeams(
  ctx: QueryCtx | MutationCtx,
  args: { sport: string; teams: TeamRowInput[] },
  write: boolean,
): Promise<TeamsResult> {
  assertChunkSize(args.teams.length, MAX_TEAMS_PER_CALL, "teams");
  /**
   * NEO-296 — operations this transaction has spent, counted at the call
   * sites. See `BULK_LOAD_TEAM_OP_BUDGET` for the model and the arithmetic.
   */
  let ops = 0;
  const sportId = await requireSportId(ctx, args.sport);
  ops += 1; // the `by_level` sport collect
  const mutationCtx = write ? (ctx as MutationCtx) : null;

  /**
   * The shared identity lookup, with its cost recorded. `2 + rows.length` is
   * the name index read, the alias index read, and one `db.get` per alias row
   * — `rows.length` counts the hits `findTeamsByAlias` resolved, which is what
   * those gets were spent on.
   */
  const lookupByFullName = async (value: string): Promise<Doc<"teams">[]> => {
    const rows = await findTeamsByFullName(ctx, sportId, value);
    ops += IDENTITY_LOOKUP_BASE_OPS + rows.length;
    return rows;
  };

  const results: TeamResult[] = [];

  // The league is resolved once per CHUNK, not once per row. A dataset slice
  // is fifty teams in one or two leagues, and `findLeagueByName`'s alias leg
  // is a `by_sport_id` collect — an array member cannot be indexed — so
  // resolving per row would pay that scan fifty times to reach one id. Keyed
  // on the normalised name. The cache doubles as the `leagues` summary on the
  // result.
  const leagueCache = new Map<string, { name: string; id: Id<"leagues"> | null }>();
  const resolveLeagueId = async (
    leagueName: string | undefined,
    key: string,
  ): Promise<Id<"leagues"> | undefined> => {
    /*
     * NEO-331 — a row that names NO league gets no league. Jason, 2026-10-10:
     * "An unanswered League stays blank, same as No league. No team lands
     * under MLB without someone saying so." Until then a league-less dataset
     * row fell back to the sport's configured default (creating it on first
     * use), on both the create and the adopt gap-fill — so a minor, indie or
     * college club the dataset said nothing about was filed under the top
     * flight. Free: no read, no cache entry, no line in the `leagues` summary.
     */
    if (!leagueName) return undefined;
    const cacheKey = `name:${normalizeLeagueName(leagueName)}`;
    if (!leagueCache.has(cacheKey)) {
      // A cache MISS is the only time this costs anything, and it happens once
      // or twice per chunk. `findLeagueByName` is a name read plus the alias
      // leg's `by_sport_id` collect; charged at 3, the price the budget's
      // arithmetic was set with.
      ops += 3;
      const name = boundedName(leagueName, "A league name", key);
      // NEO-331: FIND-ONLY. A team row names its league by text, which says
      // nothing about the league's level — and a league row now requires
      // one. Leagues are loaded first, by `upsertLeagues`, from a dataset
      // that carries its own level; a team naming a league that run did not
      // load is a dataset error. The dry run reports it as `id: null`; the
      // write run refuses the whole chunk (a thrown mutation writes
      // nothing), naming the league so the operator can fix the dataset.
      const id = (await findLeagueByName(ctx, { name, sportId }))?._id ?? null;
      if (id === null && mutationCtx) {
        throw new ConvexError(
          `No league "${name}" in this sport on this deployment (team "${key}"). ` +
            `Load it with upsertLeagues first — teams never create leagues.`,
        );
      }
      leagueCache.set(cacheKey, { name, id });
    }
    return leagueCache.get(cacheKey)?.id ?? undefined;
  };

  /**
   * NEO-676 — the leagues in the sport that answer to a name, when MORE than
   * one does. `findLeagueByName` (what `resolveLeagueId` uses) returns the first
   * hit, which is a guess; on an MLB-pass row two hits are a tie the operator
   * breaks. One `by_sport_id` read per distinct name per chunk.
   */
  const leagueTieCache = new Map<string, Doc<"leagues">[]>();
  const leagueTie = async (leagueName: string, key: string): Promise<Doc<"leagues">[]> => {
    const nameKey = normalizeLeagueName(boundedName(leagueName, "A league name", key));
    if (!leagueTieCache.has(nameKey)) {
      ops += 1;
      const rows = await ctx.db
        .query("leagues")
        .withIndex("by_sport_id", (q) => q.eq("sportId", sportId))
        .collect();
      leagueTieCache.set(nameKey, rows.filter((r) => leagueAnswersTo(r, nameKey)));
    }
    const hits = leagueTieCache.get(nameKey) ?? [];
    return hits.length > 1 ? hits : [];
  };

  /**
   * NEO-676 — an incoming parent-club list, checked and put in season order:
   * within `MAX_PARENT_CLUBS`, whole years, and every parent a team in this
   * sport. Read once per parent per call.
   */
  const parentCache = new Map<string, Doc<"teams"> | null>();
  const boundedParentClubs = async (
    raw: ReadonlyArray<ParentClubEntry>,
    key: string,
  ): Promise<ParentClubEntry[]> => {
    if (raw.length > MAX_PARENT_CLUBS) {
      throw new ConvexError(
        `"${key}" has ${raw.length} parent clubs; the limit is ${MAX_PARENT_CLUBS}.`,
      );
    }
    for (const entry of raw) {
      assertYears(
        { from: entry.fromYear, ...(entry.toYear !== undefined ? { to: entry.toYear } : {}) },
        "A parent club span",
        key,
      );
      if (!parentCache.has(entry.parentTeamId)) {
        parentCache.set(entry.parentTeamId, await ctx.db.get(entry.parentTeamId));
        ops += 1;
      }
      const parent = parentCache.get(entry.parentTeamId);
      if (!parent || parent.sportId !== sportId) {
        throw new ConvexError(`A parent club for "${key}" is not a team in this sport.`);
      }
    }
    return [...raw].sort((a, b) => a.fromYear - b.fromYear);
  };

  /** NEO-296 — rows this call reached, and where the next one resumes. */
  let processed = 0;
  let nextKey: string | null = null;

  for (let rowIndex = 0; rowIndex < args.teams.length; rowIndex++) {
    // NEO-296 — checked BETWEEN rows, never inside one: a row is an atomic
    // unit of this protocol (its match, its ownership check and its write are
    // one decision) and half of one is not a state anything can resume from.
    // The first row is always attempted, so no single row is unloadable for
    // its own size.
    if (rowIndex > 0 && ops >= BULK_LOAD_TEAM_OP_BUDGET) {
      nextKey = boundedKey(args.teams[rowIndex].key);
      break;
    }
    const row = args.teams[rowIndex];
    processed = rowIndex + 1;
    const key = boundedKey(row.key);
    const name = boundedName(row.name, "A team name", key);
    const location = (row.location && cleanseExternalName(row.location)) || undefined;
    const fullName = teamFullName({ name, location });
    if (fullName.length > MAX_NAME_LENGTH) {
      throw new ConvexError(
        `The team name for "${key}" is ${fullName.length} characters; the limit is ${MAX_NAME_LENGTH}.`,
      );
    }
    if (row.yearsActive) assertYears(row.yearsActive, "A team span", key);
    const wikidataId = row.wikidataId ? boundedQid(row.wikidataId, key) : undefined;
    const mlbamId =
      row.mlbamId === undefined ? undefined : boundedMlbamId(row.mlbamId, key);
    const parentClubs = row.parentClubs
      ? await boundedParentClubs(row.parentClubs, key)
      : undefined;
    // NEO-676 — where this row and NB disagree; empty on every other row.
    const dis: Disagreement[] = [];

    // NEO-676 — an MLB-pass row's league must be exactly one league. Two
    // answering to the name hold the row (nothing written); one is resolved
    // here so the adopt can compare it with the league the team already has.
    let resolvedLeagueId: Id<"leagues"> | undefined;
    if (mlbamId !== undefined && row.league) {
      const tied = await leagueTie(row.league, key);
      if (tied.length > 0) {
        results.push({
          key,
          id: null,
          status: "ambiguous",
          disagreements: [
            {
              field: "league",
              nb: tied.map((l) => `${l.name} (${l._id})`).join("; "),
              mlb: cleanseExternalName(row.league),
            },
          ],
        });
        continue;
      }
      resolvedLeagueId = await resolveLeagueId(row.league, key);
    }

    const fields = teamRowFields({ name, location });
    // Bounded and de-duplicated on the way in, exactly as the admin editor
    // does it, and against the full name this row would carry — so the
    // dataset's own label for the row is dropped when it IS the row's name.
    const aliases = row.aliases
      ? normalizeTeamAliasList(row.aliases.map(cleanseExternalName), fullName)
      : [];
    const incomingKeys = new Set<string>([
      fields.nameNormalized,
      ...aliases.map((alias) => normalizeTeamName(alias)),
    ]);

    /**
     * Who already answers to each incoming alias — by name OR by alias, the
     * shared identity lookup. Read once per row and used twice: as the alias
     * legs of the match (a row whose PRIMARY name is one of these aliases is
     * the label-named prod row) and as the ownership check before any write.
     */
    const holdersByAlias = new Map<string, Doc<"teams">[]>();
    for (const alias of aliases) {
      // NEO-296 — THE loop the budget exists for: unbounded by rows, bounded
      // only by `MAX_TEAM_ALIASES` (64), and each turn is a full identity
      // lookup rather than a single read.
      holdersByAlias.set(alias, await lookupByFullName(alias));
    }
    const ownersExcept = (self: Id<"teams"> | null): AliasOwner[] => {
      const owners: AliasOwner[] = [];
      for (const [alias, holders] of holdersByAlias) {
        for (const holder of holders) {
          if (holder._id === self) continue;
          owners.push({ alias, id: holder._id, name: teamFullName(holder) });
        }
      }
      return owners;
    };

    // ---- the two writes --------------------------------------------------

    const adopt = async (
      existing: Doc<"teams">,
      how: { matchedBy: "name" | "alias" | "decision" | "mlbamId"; matchedOn?: string },
      skippedIn: AliasOwner[],
    ): Promise<TeamResult> => {
      /*
       * NEO-676 — an identity conflict holds the WHOLE row: the row this found
       * already carries a different MLB id, so it is not this club. Nothing is
       * written; a replayed `adopt` decision is the operator's answer.
       */
      const heldMlbamId = existing.externalIds?.mlbamId;
      if (mlbamId !== undefined && heldMlbamId !== undefined && heldMlbamId !== mlbamId) {
        return {
          key,
          id: null,
          status: "ambiguous",
          candidates: [candidateOf(existing)],
          disagreements: [
            { field: "mlbamId", nb: String(heldMlbamId), mlb: String(mlbamId) },
          ],
        };
      }
      const patch: Record<string, unknown> = {};
      const filled: string[] = [];
      if (!existing.leagueId) {
        const leagueId = await resolveLeagueId(row.league, key);
        if (leagueId) {
          patch.leagueId = leagueId;
          // The deprecated free-text `league` is cleared as its replacement
          // lands, exactly as `teams.saveTeamFields` and
          // `teams.convertLegacyLeagueInternal` do it. A row carrying both
          // is a row with two answers to one question.
          patch.league = undefined;
          filled.push("leagueId");
        }
      }
      if (existing.yearsActive === undefined && row.yearsActive) {
        patch.yearsActive = row.yearsActive;
        filled.push("yearsActive");
      }
      let wikidataMismatch = false;
      if (wikidataId) {
        const held = existing.externalIds?.wikidataId;
        if (!held) {
          patch.externalIds = { ...(existing.externalIds ?? {}), wikidataId };
          filled.push("wikidataId");
        } else if (held !== wikidataId) {
          wikidataMismatch = true;
        }
      }

      if (mlbamId !== undefined) {
        // NEO-676 — the link, only where the row has none (always spread: the
        // Wikidata id may sit beside it, or be written just above).
        if (heldMlbamId === undefined) {
          patch.externalIds = {
            ...((patch.externalIds as object | undefined) ?? existing.externalIds ?? {}),
            mlbamId,
          };
          filled.push("mlbamId");
        }
        // A league the row already has outranks MLB's; the difference is
        // reported, never written.
        if (existing.leagueId && resolvedLeagueId && existing.leagueId !== resolvedLeagueId) {
          const held = await ctx.db.get(existing.leagueId);
          ops += 1;
          dis.push({
            field: "league",
            nb: held?.name ?? String(existing.leagueId),
            mlb: leagueCache.get(`name:${normalizeLeagueName(row.league ?? "")}`)?.name ?? "",
          });
        }
        // MLB's seasons must sit inside NB's span; seasons outside it are the
        // operator's to date (NB's years are never widened here).
        if (
          existing.yearsActive !== undefined &&
          row.yearsActive &&
          !yearsWithin(row.yearsActive, existing.yearsActive)
        ) {
          dis.push({
            field: "yearsActive",
            nb: describeYears(existing.yearsActive),
            mlb: describeYears(row.yearsActive),
          });
        }
        if (parentClubs && parentClubs.length > 0) {
          const merged = mergeParentClubs(existing.parentClubs ?? [], parentClubs);
          dis.push(...merged.disagreements);
          if (merged.next.length > (existing.parentClubs ?? []).length) {
            if (merged.next.length > MAX_PARENT_CLUBS) {
              throw new ConvexError(
                `Adopting "${key}" would leave the row with ${merged.next.length} ` +
                  `parent clubs; the limit is ${MAX_PARENT_CLUBS}.`,
              );
            }
            patch.parentClubs = merged.next;
            filled.push("parentClubs");
          }
        }
      }

      /*
       * Aliases are UNIONED, never replaced. Every other field here is
       * gap-filled; an alias list is different, because the row's existing
       * entries may have been typed by an operator who knew something the
       * dataset does not, and a load that dropped them would undo that work
       * on every re-run. The union is de-duplicated on the key the index uses
       * and checked against the row's OWN full name (not the dataset's), so
       * "Washington Huskies baseball" is not written as an alias of the row
       * that is named that. Aliases another row owns were removed by the
       * caller before this point.
       *
       * The incoming CANONICAL full name joins the union too, when it is not
       * the adopted row's own name. Rehearsal found the gap: prod's
       * label-named "West Virginia / Mountaineers baseball" was adopted
       * through its label, the dataset's aliases were unioned — and "West
       * Virginia Mountaineers" itself was never among them, because
       * `normalizeTeamAliasList(row.aliases, fullName)` drops the incoming
       * full name as "the row's own" and the dataset excludes it by
       * construction. So the row still did not answer to the one string a
       * checklist actually prints, and the wizard offered New Team instead of
       * Link. Plan decision 4 — "the row already answers to the canonical
       * name via the unioned aliases" — only holds if the canonical name is
       * in the union. Same ownership rule as every other alias: another
       * row's primary name or alias owns it (the LSU / Tigers beside LSU /
       * Tigers baseball case, reachable through a replayed decision) → it is
       * reported in `aliasesSkipped` and not written.
       */
      const skipped = [...skippedIn];
      const canonicalIsNew = existing.nameNormalized !== fields.nameNormalized;
      if (canonicalIsNew) {
        const owners = (await lookupByFullName(fullName)).filter(
          (holder) => holder._id !== existing._id,
        );
        for (const holder of owners) {
          skipped.push({ alias: fullName, id: holder._id, name: teamFullName(holder) });
        }
      }
      const skippedKeys = new Set(skipped.map((s) => normalizeTeamName(s.alias)));
      const safeAliases = [
        ...(canonicalIsNew ? [fullName] : []),
        ...aliases,
      ].filter((alias) => !skippedKeys.has(normalizeTeamName(alias)));
      const existingAliases = existing.aliases ?? [];
      const existingKeys = new Set(existingAliases.map((a) => normalizeTeamName(a)));
      const additions = safeAliases.filter(
        (alias) => !existingKeys.has(normalizeTeamName(alias)),
      );
      let merged = existingAliases;
      if (additions.length > 0) {
        // Bounded like every other alias write. The dataset never exceeds the
        // cap on its own, so this only trips when the row already carries
        // aliases — a refusal the operator should hear, not a silent trim.
        if (existingAliases.length + additions.length > MAX_TEAM_ALIASES) {
          throw new ConvexError(
            `Adopting "${key}" would leave the row with ` +
              `${existingAliases.length + additions.length} aliases; the limit is ${MAX_TEAM_ALIASES}.`,
          );
        }
        merged = normalizeTeamAliasList(
          [...existingAliases, ...additions],
          teamFullName(existing),
        );
        if (merged.length !== existingAliases.length) patch.aliases = merged;
      }
      const aliasesAdded = merged.length - existingAliases.length;

      // NEO-296 — the cost is charged in BOTH modes, off the same conditions,
      // so the dry run truncates on exactly the row the write run would. The
      // dry run's one job is to predict the write run; a budget it did not pay
      // would have it report seven rows the write run then stops at five.
      const wouldPatch = Object.keys(patch).length > 0;
      if (wouldPatch) {
        ops += 1;
        // `syncTeamAliases` is one `.collect()` of the row's side rows, then a
        // delete per entry it no longer wants and an insert per entry it does
        // not yet hold. Charged at its ceiling — the union only grows, so the
        // deletes are the stale-sport case and the inserts are the additions.
        if (patch.aliases) ops += 1 + existingAliases.length + additions.length;
      }
      if (mutationCtx && wouldPatch) {
        await mutationCtx.db.patch(existing._id, { ...patch, lastUpdated: Date.now() });
        // NEO-569 — a league filled in re-settles the cards showing the team
        // (scheduled only when some card does; one indexed read otherwise).
        if (patch.leagueId !== undefined) {
          await scheduleTeamLeagueRecompute(mutationCtx, existing._id, existing.leagueId);
        }
        if (patch.aliases) {
          await syncTeamAliases(mutationCtx, {
            teamId: existing._id,
            sportId,
            aliases: merged,
          });
        }
      }
      return {
        key,
        id: existing._id,
        status: write ? "adopted" : "would-adopt",
        matchedBy: how.matchedBy,
        ...(how.matchedOn !== undefined ? { matchedOn: how.matchedOn } : {}),
        // The dataset's canonical split, for the operator to consider — only
        // where the row's name is NOT what the dataset calls it.
        ...(how.matchedBy !== "name" && existing.nameNormalized !== fields.nameNormalized
          ? { suggestion: { ...(location ? { location } : {}), name } }
          : {}),
        filled,
        aliasesAdded,
        ...(skipped.length > 0 ? { aliasesSkipped: skipped } : {}),
        ...(wikidataMismatch ? { wikidataMismatch: true } : {}),
        ...(dis.length > 0 ? { disagreements: dis } : {}),
      };
    };

    /**
     * NEO-307 — the rows holding this row's full name as an ALIAS, when step
     * 3's alias leg has already read them (it asks exactly this question when
     * the name found nothing). `create` reuses it so the ordinary create path
     * pays no extra operation; a replayed `create` decision, or a name that
     * found a same-name era, never reached step 3 and reads it itself.
     */
    let aliasHoldersOfName: Doc<"teams">[] | undefined;

    const create = async (
      skipped: AliasOwner[],
      decided = false,
    ): Promise<TeamResult> => {
      /*
       * NEO-307 — the reverse order of the alias rule: a team may never take a
       * name another team in the sport already holds as an ALIAS, whatever the
       * eras. "Brooklyn Dodgers" on the 1958– Los Angeles Dodgers, then a
       * dataset row for the 1911–1957 Brooklyn Dodgers: creating it would
       * leave two teams answering to one string, and the resolver's era
       * narrowing would then pick between them silently on every card.
       *
       * Checked HERE, inside `create`, so the unanswered create branch and a
       * replayed `create: true` decision both pass through it. Reported, not
       * thrown: `ambiguous` with `nameHeldAsAliasBy`, nothing written — the
       * loader's style for "there is a question and this row cannot answer
       * it". A replayed `create` does NOT settle it (the decision says "none
       * of these", and the problem is not a choice between candidates). It
       * settles one of two ways: remove the alias from the holder in Team
       * Management, after which the same `create` replays and lands; or
       * answer `adopt: <holder id>` when the holder IS the program — legal,
       * because the holder answers to the incoming name.
       *
       * Alias leg only: a row holding the name as its own PRIMARY name is a
       * same-name era, which the by-name leg and `eraMatch` already govern.
       */
      let holdersOfName = aliasHoldersOfName;
      if (holdersOfName === undefined) {
        holdersOfName = await findTeamsByAlias(ctx, sportId, fullName);
        // One `teamAliases` index read plus one `db.get` per holder resolved.
        ops += 1 + holdersOfName.length;
      }
      const nameHolders = holdersOfName.filter(
        (holder) => holder.nameNormalized !== fields.nameNormalized,
      );
      if (nameHolders.length > 0) {
        return {
          key,
          id: null,
          status: "ambiguous",
          nameHeldAsAliasBy: nameHolders.map((holder) => ({
            alias: fullName,
            id: holder._id,
            name: teamFullName(holder),
          })),
        };
      }
      const skippedKeys = new Set(skipped.map((s) => normalizeTeamName(s.alias)));
      const safeAliases = aliases.filter(
        (alias) => !skippedKeys.has(normalizeTeamName(alias)),
      );

      /*
       * `nearExisting` — computed BEFORE the insert so the new row is not its
       * own neighbour. A search-index read on the location token (or the
       * name's longest token for a location-less club), ranked against the
       * full name by the same ranker the wizard's "did you mean?" uses;
       * `close` is what "Hawaii / Rainbows" scores for "Hawaii / Rainbow
       * Warriors". Rows in the sport only. Mutations may read search indexes.
       */
      const term = nameTokens(location ?? "").join(" ") || longestToken(name) || "";
      const nearExisting: NonNullable<TeamResult["nearExisting"]> = [];
      let hits: Doc<"teams">[] = [];
      if (term) {
        hits = await ctx.db
          .query("teams")
          .withSearchIndex("search_name", (q) =>
            q.search("nameNormalized", term).eq("sportId", sportId),
          )
          .take(NEAR_EXISTING_SEARCH_CANDIDATES);
        ops += 1;
        const named = hits.map((hit) => ({ hit, name: teamFullName(hit) }));
        for (const { index } of rankTeamCandidates(fullName, named).slice(
          0,
          NEAR_EXISTING_LIMIT,
        )) {
          const { hit } = named[index];
          nearExisting.push({
            id: hit._id,
            name: teamFullName(hit),
            ...(hit.yearsActive !== undefined ? { yearsActive: hit.yearsActive } : {}),
          });
        }
      }

      const leagueId = await resolveLeagueId(row.league, key);
      /*
       * NEO-676 — a probable duplicate is a disagreement, not a create: a
       * near match in the SAME league whose years overlap this row's is
       * very likely the same club under another label. Held, nothing written.
       * `decided` (an operator's `create` answer) is "none of these" and skips
       * it, or the answer could never settle.
       *
       * Only a row with NO MLB id can disagree with MLB. A row already
       * carrying one (any id) is MLB's own team: a sibling MLB lists beside
       * this one, or the same franchise under another name, never an NB row
       * in conflict. The `nearExisting` read above is sport-wide and capped,
       * so id-carrying rows from other leagues ("Dodgers") can crowd an NB-only
       * duplicate out of it, and the hold would fail open. The hold therefore
       * reads its own candidates, narrowed to this league by the index, then
       * filters to no-id rows with overlapping years and ranks them with the
       * same ranker, independent of the informational `nearExisting` cut.
       */
      if (mlbamId !== undefined && !decided && leagueId) {
        let leagueHits: Doc<"teams">[] = [];
        if (term) {
          leagueHits = await ctx.db
            .query("teams")
            .withSearchIndex("search_name", (q) =>
              q
                .search("nameNormalized", term)
                .eq("sportId", sportId)
                .eq("leagueId", leagueId),
            )
            .take(NEAR_EXISTING_SEARCH_CANDIDATES);
          ops += 1;
        }
        const noIdHits = leagueHits.filter(
          (hit) =>
            hit.externalIds?.mlbamId === undefined &&
            erasOverlap(hit.yearsActive, row.yearsActive),
        );
        const namedNoId = noIdHits.map((hit) => ({ hit, name: teamFullName(hit) }));
        const likely = rankTeamCandidates(fullName, namedNoId).map(
          ({ index }) => namedNoId[index].hit,
        );
        if (likely.length > 0) {
          return {
            key,
            id: null,
            status: "ambiguous",
            candidates: likely.map(candidateOf),
            disagreements: [
              {
                field: "duplicate",
                nb: likely.map((hit) => teamFullName(hit)).join("; "),
                mlb: fullName,
              },
            ],
          };
        }
      }
      // NEO-296 — charged in both modes; see the same note on `adopt`.
      ops += 1;
      // One `.collect()` (empty — the row is new) plus one insert per alias.
      if (safeAliases.length > 0) ops += 1 + safeAliases.length;
      let id: Id<"teams"> | null = null;
      if (mutationCtx) {
        id = await mutationCtx.db.insert("teams", {
          ...teamRowFields({ name, location }),
          sportId,
          ...(leagueId ? { leagueId } : {}),
          ...(row.yearsActive ? { yearsActive: row.yearsActive } : {}),
          ...(safeAliases.length > 0 ? { aliases: safeAliases } : {}),
          ...(wikidataId || mlbamId !== undefined
            ? {
                externalIds: {
                  ...(wikidataId ? { wikidataId } : {}),
                  ...(mlbamId !== undefined ? { mlbamId } : {}),
                },
              }
            : {}),
          ...(parentClubs && parentClubs.length > 0 ? { parentClubs } : {}),
          lastUpdated: Date.now(),
        });
        if (safeAliases.length > 0) {
          await syncTeamAliases(mutationCtx, { teamId: id, sportId, aliases: safeAliases });
        }
      }
      return {
        key,
        id,
        status: write ? "created" : "would-create",
        ...(skipped.length > 0 ? { aliasesSkipped: skipped } : {}),
        ...(nearExisting.length > 0 ? { nearExisting } : {}),
      };
    };

    const ambiguous = (
      extra: Pick<TeamResult, "candidates" | "aliasOwnedBy">,
    ): TeamResult => ({ key, id: null, status: "ambiguous", ...extra });

    // ---- 0. NEO-676: the MLB id, narrowed to the era -----------------------

    /*
     * An MLB club id spans every NB era row of that franchise (the Dodgers'
     * Brooklyn and Los Angeles rows share 119), so the id alone is not a row:
     * it is the candidates, and the era this row's seasons fall in picks one.
     * Exactly one era overlapping is the answer; two covering the same season
     * is a tie, held for the operator — never `.first()`. None overlapping
     * means this is an era NB has not got, and the name steps below decide
     * whether it is one NB knows under another name or a new row.
     *
     * Read BEFORE the decision replay: a replayed answer is still a claim
     * about which row holds the id, and an `adopt` onto a row while another
     * era row holds the id for these seasons would mint a second holder.
     */
    let idMatch: EraMatch = { kind: "none" };
    // The scan came back full: more rows may hold this id than were read, so
    // it is a tie — never a pick over a window.
    let idScanFull = false;
    // The single id-holder step 0 set aside because an exact-name row of its
    // own overlaps; a replayed `create` must still hold on it.
    let downgradedHolder: Doc<"teams"> | undefined;
    if (mlbamId !== undefined) {
      const scanned = await ctx.db
        .query("teams")
        .withIndex("by_mlbam_id", (q) => q.eq("externalIds.mlbamId", mlbamId))
        .take(TEAM_ERA_SCAN_LIMIT);
      ops += 1;
      idScanFull = scanned.length >= TEAM_ERA_SCAN_LIMIT;
      const byId = scanned.filter((team) => team.sportId === sportId);
      /*
       * An id says "this is that club", not "this is that NB row": NB keeps one
       * row per name (dated to its earliest year) while MLB keeps one id across
       * every rename, so id 108 sits on "Los Angeles Angels" and the row for
       * "California Angels" 1966-96 overlaps it. An id-holder is a candidate
       * only when it answers to the incoming name (its primary name, or one
       * of the incoming aliases; or the incoming name is one of its aliases).
       * One that does not is another name's row: ignored here, so the name
       * steps below decide (adopt a row of this name, fill the id; a name hit
       * holding a different id is a hold; no hit creates the era row).
       */
      const answers = (team: Doc<"teams">): boolean =>
        team.nameNormalized === fields.nameNormalized ||
        (team.aliases ?? []).some(
          (alias) => normalizeTeamName(alias) === fields.nameNormalized,
        ) ||
        aliases.some((alias) => normalizeTeamName(alias) === team.nameNormalized);
      const answering = byId.filter(answers);
      idMatch = idScanFull
        ? { kind: "several", teams: byId }
        : eraMatch(answering, row.yearsActive);
      /*
       * Several id-holders answering to the name that overlap are not a tie
       * when the row's own name picks exactly one of them: exact name first,
       * then alias, the same legs the name steps below use. Zero or still
       * several stays held. A full scan stays held, and so does the
       * undated-rival guard in `eraMatch` (one candidate, not several).
       */
      if (idMatch.kind === "several" && !idScanFull && idMatch.teams.length > 1) {
        const byPrimary = idMatch.teams.filter(
          (team) => team.nameNormalized === fields.nameNormalized,
        );
        const byAliasLeg =
          byPrimary.length > 0
            ? []
            : idMatch.teams.filter(
                (team) =>
                  (team.aliases ?? []).some(
                    (alias) => normalizeTeamName(alias) === fields.nameNormalized,
                  ) || aliases.some((alias) => normalizeTeamName(alias) === team.nameNormalized),
              );
        const narrowed = byPrimary.length > 0 ? byPrimary : byAliasLeg;
        // Through `eraMatch`, not built by hand, so its undated-rival guard
        // still holds the one that overlaps only because it is undated.
        if (narrowed.length === 1) idMatch = eraMatch(narrowed, row.yearsActive);
      }
      /*
       * A holder that answers only through one of its aliases never beats a
       * row whose OWN name is the incoming name: "California Angels" carrying
       * the alias "Los Angeles Angels" would otherwise absorb the row that
       * IS "Los Angeles Angels" (and hold a pinned `adopt` of it forever).
       * When such a row overlaps the era, the id match is none and the name
       * step below adopts that row and fills the id.
       */
      if (idMatch.kind === "one") {
        const holder = idMatch.team;
        if (holder.nameNormalized !== fields.nameNormalized) {
          const exact = await findTeamsByExactName(ctx, sportId, fullName);
          ops += 1;
          // An exact-name row carrying a different MLB id is another club's
          // row, not this team's: it never displaces the id match.
          const ownRow = exact.some(
            (team) =>
              team._id !== holder._id &&
              !(
                team.externalIds?.mlbamId !== undefined &&
                team.externalIds.mlbamId !== mlbamId
              ) &&
              erasOverlap(team.yearsActive, row.yearsActive),
          );
          if (ownRow) {
            downgradedHolder = holder;
            idMatch = { kind: "none" };
          }
        }
      }
    }
    const heldOnId = (teamsOnId: Doc<"teams">[]): TeamResult => ({
      key,
      id: null,
      status: "ambiguous",
      candidates: teamsOnId.map(candidateOf),
      disagreements: [
        {
          field: "mlbamId",
          nb: idScanFull
            ? `${TEAM_ERA_SCAN_LIMIT} or more teams hold this id`
            : teamsOnId
                .map((t) => `${teamFullName(t)} ${describeYears(t.yearsActive)}`)
                .join("; "),
          mlb: `${mlbamId} ${describeYears(row.yearsActive)}`,
        },
      ],
    });

    // ---- 1. decision replay ----------------------------------------------

    /**
     * An answered question wins over the match — but only over the CHOICE,
     * never over the key.
     *
     * `adopt` exists to pick between rows the match could not choose between,
     * so the chosen row is checked against three things: it exists, it is in
     * this sport, and it shares the name being loaded OR answers to one of the
     * incoming strings by name or alias (relaxed from NEO-254's "same name"
     * because adopting a label-named row through an alias is now legitimate).
     * Without the third, a mis-keyed answers file — a copy-paste slip, a stale
     * id from a previous run, an off-by-one join in the loader — silently
     * writes this dataset row's league, years and aliases onto an unrelated
     * team, and nothing anywhere reports it. Refused instead, naming the key
     * so the operator can go and fix the answer.
     */
    if (row.decision && "adopt" in row.decision) {
      const chosen = await ctx.db.get(row.decision.adopt);
      ops += 1;
      if (!chosen || chosen.sportId !== sportId) {
        throw new ConvexError(
          `The team chosen for "${key}" is not a team in this sport.`,
        );
      }
      const answers =
        incomingKeys.has(chosen.nameNormalized) ||
        (chosen.aliases ?? []).some((alias) => incomingKeys.has(normalizeTeamName(alias)));
      if (!answers) {
        throw new ConvexError(
          `The team chosen for "${key}" is a different team. A decision can ` +
            `only pick a team that shares the name being loaded or answers to ` +
            `one of its aliases.`,
        );
      }
      // NEO-676: the id says another row is this era of the club, or says
      // nothing certain; an answer that disagrees is held, not written.
      if (idMatch.kind === "several") {
        results.push(heldOnId(idMatch.teams));
        continue;
      }
      if (idMatch.kind === "one" && idMatch.team._id !== chosen._id) {
        results.push(heldOnId([idMatch.team]));
        continue;
      }
      results.push(await adopt(chosen, { matchedBy: "decision" }, ownersExcept(chosen._id)));
      continue;
    }
    // `create` is deliberately unconditional — it is the operator saying
    // "none of these is the one I mean". It is also the one decision that
    // does NOT converge on a replay; see the header.
    if (row.decision && "create" in row.decision) {
      // NEO-676: a row the id already places is not a new one.
      if (idMatch.kind === "several") {
        results.push(heldOnId(idMatch.teams));
        continue;
      }
      if (idMatch.kind === "one") {
        results.push(heldOnId([idMatch.team]));
        continue;
      }
      // Step 0 downgraded a lone holder to "none" for an overlapping
      // exact-name row: creating would put the id on a second row.
      if (downgradedHolder) {
        results.push(heldOnId([downgradedHolder]));
        continue;
      }
      results.push(await create(ownersExcept(null), true));
      continue;
    }

    // ---- 1b. NEO-676: by MLB id (read in step 0) --------------------------

    if (mlbamId !== undefined) {
      if (idMatch.kind === "several") {
        results.push(heldOnId(idMatch.teams));
        continue;
      }
      if (idMatch.kind === "one") {
        const owners = ownersExcept(idMatch.team._id);
        if (owners.length > 0) {
          results.push(
            ambiguous({ candidates: [candidateOf(idMatch.team)], aliasOwnedBy: owners }),
          );
          continue;
        }
        results.push(await adopt(idMatch.team, { matchedBy: "mlbamId" }, []));
        continue;
      }
    }

    // ---- 2. by name --------------------------------------------------------

    const byName = await findTeamsByExactName(ctx, sportId, fullName);
    ops += 1;
    const nameMatch = eraMatch(byName, row.yearsActive);
    if (nameMatch.kind === "several") {
      results.push(ambiguous({ candidates: nameMatch.teams.map(candidateOf) }));
      continue;
    }

    // ---- 3. by alias, only when the name found nothing at all -------------

    let aliasMatch: EraMatch = { kind: "none" };
    const matchedOnById = new Map<string, string>();
    // Rows a PRIMARY name vouches for — legs (i) and (ii). A row reached only
    // through leg (iii), a shared alias, is never in here; see the header.
    const vouched = new Set<string>();
    if (nameMatch.kind === "none" && byName.length === 0) {
      const union: Doc<"teams">[] = [];
      const seen = new Set<string>();
      const add = (team: Doc<"teams">, on: string, primary: boolean) => {
        if (primary) vouched.add(team._id);
        if (seen.has(team._id)) return;
        seen.add(team._id);
        matchedOnById.set(team._id, on);
        union.push(team);
      };
      // (i) rows whose ALIAS is the incoming full name — OUR primary name.
      const byAlias = await findTeamsByAlias(ctx, sportId, fullName);
      // One `teamAliases` index read plus one `db.get` per row it resolved.
      ops += 1 + byAlias.length;
      // NEO-307 — the same question `create` asks; see `aliasHoldersOfName`.
      aliasHoldersOfName = byAlias;
      for (const team of byAlias) {
        add(team, fullName, true);
      }
      // (ii) rows whose PRIMARY name is one of our aliases, and (iii) rows
      // that merely share one — the reads already made for the ownership
      // check, told apart by whether the holder's own key is the alias.
      for (const [alias, holders] of holdersByAlias) {
        const aliasKey = normalizeTeamName(alias);
        for (const team of holders) add(team, alias, team.nameNormalized === aliasKey);
      }
      aliasMatch = eraMatch(union, row.yearsActive);
      if (aliasMatch.kind === "several") {
        results.push(ambiguous({ candidates: aliasMatch.teams.map(candidateOf) }));
        continue;
      }
      if (aliasMatch.kind === "one" && !vouched.has(aliasMatch.team._id)) {
        results.push({
          ...ambiguous({ candidates: [candidateOf(aliasMatch.team)] }),
          matchedOn: matchedOnById.get(aliasMatch.team._id) ?? fullName,
        });
        continue;
      }
    }

    // ---- 4. alias ownership, then 5/6 the write ---------------------------

    const found =
      nameMatch.kind === "one"
        ? { team: nameMatch.team, how: { matchedBy: "name" as const } }
        : aliasMatch.kind === "one"
          ? {
              team: aliasMatch.team,
              how: {
                matchedBy: "alias" as const,
                matchedOn: matchedOnById.get(aliasMatch.team._id) ?? fullName,
              },
            }
          : null;
    if (found && mlbamId !== undefined && found.how.matchedBy === "alias") {
      // NEO-676 — found only under another label: NB calls this club something
      // else. Held; the operator's `adopt` answer settles it.
      results.push({
        key,
        id: null,
        status: "ambiguous",
        candidates: [candidateOf(found.team)],
        matchedOn: found.how.matchedOn,
        disagreements: [
          { field: "name", nb: teamFullName(found.team), mlb: fullName },
        ],
      });
      continue;
    }
    if (found) {
      const owners = ownersExcept(found.team._id);
      if (owners.length > 0) {
        results.push(
          ambiguous({ candidates: [candidateOf(found.team)], aliasOwnedBy: owners }),
        );
        continue;
      }
      results.push(await adopt(found.team, found.how, []));
      continue;
    }

    const owners = ownersExcept(null);
    if (owners.length > 0) {
      results.push(ambiguous({ aliasOwnedBy: owners }));
      continue;
    }
    results.push(await create([]));
  }

  const hasMore = processed < args.teams.length;
  if (hasMore) {
    // Structured and loud. A truncated chunk that a script read as "done"
    // would silently drop rows, which is the one outcome this whole protocol
    // is built to avoid. Keys and counts only — a team name is operator data.
    console.warn(
      JSON.stringify({
        msg: "bulk_load_teams_truncated",
        fn: write ? "upsertTeams" : "previewTeams",
        rowsSent: args.teams.length,
        processed,
        opsSpent: ops,
        budget: BULK_LOAD_TEAM_OP_BUDGET,
      }),
    );
  }

  return {
    results,
    leagues: [...leagueCache.values()],
    processed,
    hasMore,
    nextKey,
    opsSpent: ops,
  };
}

/**
 * Teams — one row per historical NAME, which is what a card says. The
 * protocol is in the module header; this is the armed entry point.
 */
export const upsertTeams = internalMutation({
  args: {
    confirm: confirmValidator,
    sport: v.string(),
    /** Same protocol, no writes, `would-` statuses. See the header. */
    dryRun: v.optional(v.boolean()),
    teams: v.array(teamRowValidator),
  },
  returns: teamsResultValidator,
  handler: async (ctx, args) => {
    assertBulkLoadArmed(args.confirm);
    return await loadTeams(ctx, args, !args.dryRun);
  },
});

/**
 * The dry run as a QUERY, so it can be pointed at an unarmed deployment —
 * the rehearsal reads a restored prod snapshot before anything is armed, and
 * prod itself is dry-run before the flag is set. Same handler as
 * `upsertTeams` minus the writes; the confirm literal is kept so a script
 * cannot call the wrong one by accident.
 *
 * ## NEO-296 — the arming asymmetry is deliberate and stays
 *
 * This query carries `loadTeams`' full READ cost while needing only the
 * `confirm` literal, with no `ALLOW_BULK_LOAD` flag. That asymmetry is the
 * point of the function: arming is what guards WRITES, and the whole reason
 * the dry run is a query is to be runnable on a deployment nobody has armed
 * yet — which is every deployment, at the moment an operator most wants to
 * know what the load would do. Requiring the flag here would mean arming prod
 * in order to rehearse against it, i.e. arming it before the rehearsal that
 * decides whether to arm it.
 *
 * What it is NOT is an unbounded door: `internalQuery` is unreachable from any
 * client, so the only callers are a deploy-key `npx convex run` and other
 * server code, and since NEO-296 the read cost is bounded by
 * `BULK_LOAD_TEAM_OP_BUDGET` exactly as the mutation's is — they share one
 * handler, so they cannot drift. The budget, not the flag, is what makes this
 * safe to point at anything.
 */
export const previewTeams = internalQuery({
  args: {
    confirm: confirmValidator,
    sport: v.string(),
    teams: v.array(teamRowValidator),
  },
  returns: teamsResultValidator,
  handler: async (ctx, args) => {
    if (args.confirm !== "BULK_LOAD") {
      throw new ConvexError("Bulk load preview requires confirm: \"BULK_LOAD\".");
    }
    return await loadTeams(ctx, args, false);
  },
});

// ---------------------------------------------------------------------------
// Player stints (NEO-285)
// ---------------------------------------------------------------------------

/**
 * NEO-285 — the stints leg of NEO-254's `upsertPlayers`, brought back
 * ADOPT-ONLY for the college load: "players that went to WVU, in any
 * uniform" is a stint on the college team row NEO-284 loaded, and nobody
 * loaded those for the players NB already holds.
 *
 * ## What a row is
 *
 * One existing NB player, named the way NEO-254 keyed them — name + sport +
 * birth year — and zero or more stints. A stint names its team ONE of two
 * ways, never both:
 *
 *  - `teamId` — the id path. The driver already knows the team's NB id: the
 *    Wikidata P54 item is a college team whose Q-id its NEO-284 dataset
 *    carries, and its NEO-284 results map that key to the row it landed on.
 *    No name matching at all.
 *  - `school` — the name path. nflverse carries a school STRING ("West
 *    Virginia", "WVU"), which resolves through the same name-or-alias lookup
 *    every other team reader uses (`findTeamsByFullName`), so NEO-284's
 *    aliases are what make "WVU" land on West Virginia / Mountaineers.
 *
 * Years are optional on both. A stint with no `fromYear` is written UNDATED
 * — absent means unknown, never a year guessed from the pro career (the
 * NEO-235 rule; see `players.teamYears` in schema.ts).
 *
 * ## The rules, and why each exists
 *
 * 1. **Armed, twice** — the same gate as every writer in this file.
 * 2. **Adopt-only. Never creates a player.** A key that matches no player is
 *    `no-match` and nothing is written; a college load inventing pros is
 *    out of scope by the ticket. Roster loads that DO create players go
 *    through `upsertPlayers` (NEO-611), a separate armed function with its own
 *    identity, twin and held-adopt rules; this leg stays adopt-only so a
 *    college script can never mint a row.
 * 3. **Never guesses the player.** Same identity rule as NEO-254: one
 *    candidate adopts unless the birth years CONTRADICT (positive evidence of
 *    two people — that is `no-match`, not a merge); several adopt the one
 *    whose birth year matches, when exactly one does; anything else is
 *    `ambiguous` with the candidates, nothing written, and the driver asks.
 *    A `decision: { adopt }` replays the answer — only between players that
 *    share the loaded name, so a mis-keyed answers file cannot write one
 *    man's college onto another.
 * 4. **The sport filter holds.** A `teamId` in another sport is refused PER
 *    STINT as `wrong-sport` (the Gwynn case: Wikidata files his San Diego
 *    State membership under the BASKETBALL team) and the rest of the row
 *    lands. A `school` resolves only among the sport's own teams, and never
 *    to a team whose league is a known non-college league — a school string
 *    is not allowed to land on a pro club that happens to share a word.
 * 5. **Never guesses the team.** A school that resolves to nothing is
 *    `unresolved`; to several (two eras of one program, two programs sharing
 *    an alias) it is `ambiguous-school` with the candidates. Neither is
 *    dropped silently and neither gets a placeholder row: the summary's
 *    `unresolvedSchools`, with counts, is the input to the next team preload.
 * 5b. **A bare location reaches a college team.** When a school string
 *    matches no team name or alias, it is tried as a LOCATION among the
 *    sport's college-league teams only ("Ohio State", "Pittsburgh"). Never an
 *    alias: set sync reads aliases, and "Pittsburgh" there must not mean Pitt.
 * 6. **Gap-fill only.** A stint is ADDED to the player's career; nothing on
 *    it is removed, re-dated or re-ordered by hand. A stint on the same team
 *    that could be the same one is `present` and a no-op: an undated incoming
 *    stint against any stint on that team, a dated one against an undated
 *    stint there (never re-date one an operator or an earlier load wrote),
 *    and a dated one against a dated stint whose years overlap. That is what
 *    makes a second run converge to 0 added.
 *
 * ## Budget
 *
 * The same counted budget as `loadTeams`, checked between rows, with the same
 * `processed` / `hasMore` / `nextKey` resume contract — here every outcome is
 * idempotent, so a replayed prefix is harmless, but resuming from `nextKey`
 * is still the cheap way.
 */
const MAX_PLAYER_ROWS_PER_CALL = 100;

/**
 * Stints per incoming row. College careers are one school, two with a
 * transfer, three with a juco year; eight is headroom, and the bound keeps a
 * row's worst case (`8 × 18` for a contested school lookup) inside the budget's
 * single-row overshoot.
 */
const MAX_STINTS_PER_ROW = 8;

/** Same-name players looked at before the answer is just "several". */
const PLAYER_CANDIDATE_SCAN_LIMIT = 8;

/** Same budget and calibration as the team loader's — see its note. */
export const BULK_LOAD_STINT_OP_BUDGET = 900;

const stintInputValidator = v.object({
  teamId: v.optional(v.id("teams")),
  school: v.optional(v.string()),
  fromYear: v.optional(v.number()),
  toYear: v.optional(v.number()),
});

const playerStintRowValidator = v.object({
  key: v.string(),
  name: v.string(),
  birthYear: v.optional(v.number()),
  stints: v.array(stintInputValidator),
  decision: v.optional(v.object({ adopt: v.id("players") })),
});

const stintOutcomeValidator = v.union(
  v.literal("added"),
  v.literal("would-add"),
  v.literal("present"),
  v.literal("wrong-sport"),
  v.literal("missing-team"),
  v.literal("unresolved"),
  v.literal("ambiguous-school"),
  v.literal("cap-reached"),
);

const stintTeamCandidateValidator = v.object({
  id: v.id("teams"),
  name: v.string(),
  yearsActive: v.optional(yearsValidator),
});

const playerStintResultValidator = v.object({
  key: v.string(),
  playerId: v.union(v.id("players"), v.null()),
  status: v.union(
    v.literal("adopted"),
    v.literal("would-adopt"),
    v.literal("no-match"),
    v.literal("ambiguous"),
  ),
  /** How the player was found. `decision` is a replayed answer. */
  matchedBy: v.optional(v.union(v.literal("name"), v.literal("decision"))),
  /** `no-match` only: the one same-name player's birth year contradicted. */
  birthYearMismatch: v.optional(v.boolean()),
  /** `ambiguous` only — the players the operator chooses between. */
  candidates: v.optional(
    v.array(
      v.object({
        id: v.id("players"),
        name: v.string(),
        birthYear: v.optional(v.number()),
      }),
    ),
  ),
  /**
   * One entry per incoming stint, in order. Empty on `no-match` and
   * `ambiguous`: with no player, no stint was looked at.
   */
  stints: v.array(
    v.object({
      outcome: stintOutcomeValidator,
      teamId: v.optional(v.id("teams")),
      school: v.optional(v.string()),
      candidates: v.optional(v.array(stintTeamCandidateValidator)),
    }),
  ),
});

const playerStintsResultValidator = v.object({
  results: v.array(playerStintResultValidator),
  summary: v.object({
    adopted: v.number(),
    /** Stints written — or, on a dry run, that would be. */
    stintsAdded: v.number(),
    stintsPresent: v.number(),
    noMatch: v.number(),
    ambiguous: v.number(),
    wrongSport: v.number(),
    /**
     * Every school string that resolved to no team, with how many stints
     * named it. Never dropped — this list is the next team preload's input.
     */
    unresolvedSchools: v.array(v.object({ school: v.string(), count: v.number() })),
    /** Every school string that resolved to several teams. */
    ambiguousSchools: v.array(
      v.object({
        school: v.string(),
        count: v.number(),
        candidates: v.array(stintTeamCandidateValidator),
      }),
    ),
  }),
  processed: v.number(),
  hasMore: v.boolean(),
  nextKey: v.union(v.string(), v.null()),
  opsSpent: v.number(),
});

type PlayerStintRowInput = {
  key: string;
  name: string;
  birthYear?: number;
  stints: Array<{
    teamId?: Id<"teams">;
    school?: string;
    fromYear?: number;
    toYear?: number;
  }>;
  decision?: { adopt: Id<"players"> };
};

type StintOutcome =
  | "added"
  | "would-add"
  | "present"
  | "wrong-sport"
  | "missing-team"
  | "unresolved"
  | "ambiguous-school"
  | "cap-reached";

type StintTeamCandidate = {
  id: Id<"teams">;
  name: string;
  yearsActive?: { from: number; to?: number };
};

type PlayerStintResult = {
  key: string;
  playerId: Id<"players"> | null;
  status: "adopted" | "would-adopt" | "no-match" | "ambiguous";
  matchedBy?: "name" | "decision";
  birthYearMismatch?: boolean;
  candidates?: Array<{ id: Id<"players">; name: string; birthYear?: number }>;
  stints: Array<{
    outcome: StintOutcome;
    teamId?: Id<"teams">;
    school?: string;
    candidates?: StintTeamCandidate[];
  }>;
};

type StoredStint = {
  teamId: Id<"teams">;
  fromYear?: number;
  toYear?: number;
  /** NEO-676 — a manager stint is a different fact from a playing one on the same team. */
  role?: "manager";
};

/**
 * Could `incoming` be a stint the player already has? See rule 6 in the
 * section note: same team, and either side undated, or the years overlap.
 * An open stint (no `toYear`) runs on.
 */
export function stintAlreadyPresent(
  existing: ReadonlyArray<StoredStint>,
  incoming: StoredStint,
): boolean {
  return existing.some((stint) => {
    if (stint.teamId !== incoming.teamId) return false;
    if (stint.role !== incoming.role) return false;
    if (stint.fromYear === undefined || incoming.fromYear === undefined) return true;
    return erasOverlap(
      { from: stint.fromYear, ...(stint.toYear !== undefined ? { to: stint.toYear } : {}) },
      { from: incoming.fromYear, ...(incoming.toYear !== undefined ? { to: incoming.toYear } : {}) },
    );
  });
}

function stintTeamCandidate(team: Doc<"teams">): StintTeamCandidate {
  return {
    id: team._id,
    name: teamFullName(team),
    ...(team.yearsActive ? { yearsActive: team.yearsActive } : {}),
  };
}

// ---------------------------------------------------------------------------
// The stint engine, shared by both player legs
//
// NEO-611 — `upsertPlayerStints` (adopt-only, college) and `upsertPlayers`
// (roster loads, below) write the same thing onto a player: dated or undated
// stints on teams NB already holds, gap-filled and never removed. The two legs
// differ in who they may touch (an existing player vs. one they may create) and
// in how a stint names its team (a school string is college-only). Everything
// that is the SAME lives here, so there is one place that says what "the same
// stint" means and one place that counts what a load did.
// ---------------------------------------------------------------------------

/** A stint as a caller sends it, before validation. */
type StintInput = {
  teamId?: Id<"teams">;
  school?: string;
  fromYear?: number;
  toYear?: number;
};

/** What a load did to stints, summed across the rows of one call. */
type StintTally = { added: number; present: number; wrongSport: number };

/** One entry of a result row's `stints`. */
type StintEntry = PlayerStintResult["stints"][number];

/** A stint whose team could not be used. */
type TeamRefusalEntry = {
  outcome: "missing-team" | "wrong-sport";
  teamId: Id<"teams">;
};

/** A stint that reached the gap-fill. */
type GapFillEntry = {
  outcome: "added" | "would-add" | "present" | "cap-reached";
  teamId: Id<"teams">;
  school?: string;
};

/** A birth year is a whole year inside the leg's own window, or the call is refused. */
function assertRowBirthYear(
  birthYear: number | undefined,
  key: string,
  min: number,
  max: number,
): void {
  if (
    birthYear !== undefined &&
    (!Number.isInteger(birthYear) || birthYear < min || birthYear > max)
  ) {
    throw new ConvexError(
      `The birth year for "${key}" is out of range; expected a whole year between ${min} and ${max}.`,
    );
  }
}

/** The row's player name, bounded, and the dedup key it answers to. */
function rowPlayerName(
  raw: string,
  key: string,
): { name: string; nameNormalized: string } {
  const name = boundedName(raw, "A player name", key);
  const nameNormalized = normalizePlayerName(name);
  if (!nameNormalized) {
    throw new ConvexError(`The player name for "${key}" has no letters or digits in it.`);
  }
  return { name, nameNormalized };
}

/**
 * Validate a row's stints before anything is read for them: the count, that
 * each names exactly one of `teamId` / `school`, and that the years are whole,
 * in range and not an end without a start. Pure.
 */
function cleanStints(
  raw: ReadonlyArray<StintInput>,
  key: string,
  maxStints: number,
): Array<{ teamId?: Id<"teams">; school?: string; fromYear?: number; toYear?: number }> {
  if (raw.length > maxStints) {
    throw new ConvexError(`"${key}" has ${raw.length} stints; the limit is ${maxStints}.`);
  }
  return raw.map((stint) => {
    const hasTeam = stint.teamId !== undefined;
    const school = (stint.school && cleanseExternalName(stint.school)) || undefined;
    if (hasTeam === (school !== undefined)) {
      throw new ConvexError(
        `A stint for "${key}" must name exactly one of teamId or school.`,
      );
    }
    if (school !== undefined) boundedName(school, "A school", key);
    if (stint.fromYear !== undefined) {
      assertYears(
        { from: stint.fromYear, ...(stint.toYear !== undefined ? { to: stint.toYear } : {}) },
        "A stint",
        key,
      );
    } else if (stint.toYear !== undefined) {
      throw new ConvexError(`A stint for "${key}" has an end year and no start year.`);
    }
    return {
      teamId: stint.teamId,
      school,
      fromYear: stint.fromYear,
      toYear: stint.toYear,
    };
  });
}

/**
 * The id path of a stint: the team must exist and be in the sport being
 * loaded. A miss is reported per stint (`missing-team`, `wrong-sport`) and the
 * rest of the row lands.
 */
async function resolveStintTeamId(
  readTeam: (id: Id<"teams">) => Promise<Doc<"teams"> | null>,
  sportId: Id<"selectorOptions">,
  teamId: Id<"teams">,
  tally: StintTally,
): Promise<{ team: Doc<"teams"> } | { entry: TeamRefusalEntry }> {
  const team = await readTeam(teamId);
  if (!team) return { entry: { outcome: "missing-team", teamId } };
  if (team.sportId !== sportId) {
    tally.wrongSport += 1;
    return { entry: { outcome: "wrong-sport", teamId } };
  }
  return { team };
}

/**
 * Gap-fill one resolved stint into `career` (mutated): `present` when it could
 * be a stint the player already has, `cap-reached` when the career is full,
 * otherwise appended. Nothing already in `career` is removed or re-dated.
 */
function gapFillStint(
  career: StoredStint[],
  team: Doc<"teams">,
  stint: { fromYear?: number; toYear?: number },
  via: { school?: string },
  write: boolean,
  tally: StintTally,
): GapFillEntry {
  const entry: StoredStint = {
    teamId: team._id,
    ...(stint.fromYear !== undefined ? { fromYear: stint.fromYear } : {}),
    ...(stint.toYear !== undefined ? { toYear: stint.toYear } : {}),
  };
  if (stintAlreadyPresent(career, entry)) {
    tally.present += 1;
    return { outcome: "present", teamId: team._id, ...via };
  }
  if (career.length >= MAX_PLAYER_TEAM_YEARS) {
    return { outcome: "cap-reached", teamId: team._id, ...via };
  }
  career.push(entry);
  tally.added += 1;
  return { outcome: write ? "added" : "would-add", teamId: team._id, ...via };
}

/**
 * Write what an adopt gained back onto the player: the grown career (in the
 * one order every career writer uses; null leaves it alone) and, for the
 * roster leg, a filled birth year or a widened alias list.
 */
async function writeCareer(
  ctx: MutationCtx,
  playerId: Id<"players">,
  career: StoredStint[] | null,
  extra: {
    birthYear?: number;
    aliases?: string[];
    birthDate?: string;
    externalIds?: { wikidataId?: string; mlbamId?: number };
  } = {},
): Promise<void> {
  await ctx.db.patch(playerId, {
    ...(career ? { teamYears: sortTeamYears(career) } : {}),
    ...extra,
    lastUpdated: Date.now(),
  });
}

/** `db.get` on teams, once per id across a whole call. */
function cachedTeamReader(
  ctx: QueryCtx | MutationCtx,
  cache: Map<string, Doc<"teams"> | null>,
  onRead: () => void,
): (id: Id<"teams">) => Promise<Doc<"teams"> | null> {
  return async (id) => {
    if (!cache.has(id)) {
      cache.set(id, await ctx.db.get(id));
      onRead();
    }
    return cache.get(id) ?? null;
  };
}

/** A player as an `ambiguous` result lists it for the operator. */
function playerCandidateOf(p: Doc<"players">): {
  id: Id<"players">;
  name: string;
  birthYear?: number;
} {
  return {
    id: p._id,
    name: p.name,
    ...(p.birthYear !== undefined ? { birthYear: p.birthYear } : {}),
  };
}

async function loadPlayerStints(
  ctx: QueryCtx | MutationCtx,
  args: { sport: string; players: PlayerStintRowInput[] },
  write: boolean,
): Promise<Infer<typeof playerStintsResultValidator>> {
  assertChunkSize(args.players.length, MAX_PLAYER_ROWS_PER_CALL, "players");
  let ops = 0;
  const sportId = await requireSportId(ctx, args.sport);
  ops += 1;
  const mutationCtx = write ? (ctx as MutationCtx) : null;
  const maxYear = new Date().getFullYear() + 1;

  // One read per distinct team, league and school across the whole chunk: a
  // hundred players from one draft class share a few dozen schools.
  const teamCache = new Map<string, Doc<"teams"> | null>();
  const readTeam = cachedTeamReader(ctx, teamCache, () => {
    ops += 1;
  });
  const leagueIsCollege = new Map<string, boolean>();
  /**
   * Rule 4 — may a SCHOOL string land on this team? Not when its league is
   * known and is not a college league. A team with no league, or a league
   * with no level, is not ruled out: plenty of hand-made college rows predate
   * NEO-284's league gap-fill, and refusing them would report half the
   * country's programs as unresolved.
   */
  const collegeEligible = async (team: Doc<"teams">): Promise<boolean> => {
    if (!team.leagueId) return true;
    const key = team.leagueId as string;
    if (!leagueIsCollege.has(key)) {
      const league = await ctx.db.get(team.leagueId);
      ops += 1;
      leagueIsCollege.set(key, !league?.level || league.level === "college");
    }
    return leagueIsCollege.get(key)!;
  };
  /**
   * Rule 5b — the bare-LOCATION leg, only when name and alias found nothing.
   *
   * nflverse writes "Ohio State", "USC", "Pittsburgh": a college's location,
   * not its team name. As an alias such a string would be read by set sync
   * too, and for "Pittsburgh" in Football that would bind a checklist's bare
   * city to Pitt instead of parking it (Jason, 2026-10-27). Here it is safe:
   * only teams in the sport's COLLEGE leagues are looked at, so a school can
   * never land on the Steelers, and the caller's exactly-one rule still
   * decides — two college teams at one location (two eras, or two programs)
   * come back `ambiguous-school`.
   *
   * Built once per call, lazily, from the sport's college leagues: one
   * `by_sport_id` read for the leagues and one `by_league_id` read per college
   * league. A team with no league is not on this leg; NEO-284 filed every
   * NCAA program under its league.
   */
  let collegeByLocation: Map<string, Doc<"teams">[]> | null = null;
  const collegeTeamsAtLocation = async (school: string): Promise<Doc<"teams">[]> => {
    if (!collegeByLocation) {
      collegeByLocation = new Map();
      const leagues = await ctx.db
        .query("leagues")
        .withIndex("by_sport_id", (q) => q.eq("sportId", sportId))
        .collect();
      ops += 1;
      for (const league of leagues) {
        if (league.level !== "college") continue;
        const teams = await ctx.db
          .query("teams")
          .withIndex("by_league_id", (q) => q.eq("leagueId", league._id))
          .collect();
        ops += 1;
        for (const team of teams) {
          if (!team.location || team.sportId !== sportId) continue;
          const key = normalizeTeamName(team.location);
          if (!key) continue;
          const list = collegeByLocation.get(key) ?? [];
          list.push(team);
          collegeByLocation.set(key, list);
        }
      }
    }
    return collegeByLocation.get(normalizeTeamName(school)) ?? [];
  };
  const schoolCache = new Map<string, Doc<"teams">[]>();
  const lookupSchool = async (school: string): Promise<Doc<"teams">[]> => {
    const cacheKey = normalizeTeamName(school);
    if (!schoolCache.has(cacheKey)) {
      const rows = await findTeamsByFullName(ctx, sportId, school);
      ops += IDENTITY_LOOKUP_BASE_OPS + rows.length;
      const eligible: Doc<"teams">[] = [];
      for (const row of rows) {
        teamCache.set(row._id, row);
        if (await collegeEligible(row)) eligible.push(row);
      }
      if (eligible.length === 0) {
        eligible.push(...(await collegeTeamsAtLocation(school)));
      }
      schoolCache.set(cacheKey, eligible);
    }
    return schoolCache.get(cacheKey)!;
  };

  const results: PlayerStintResult[] = [];
  const unresolved = new Map<string, { school: string; count: number }>();
  const ambiguousSchools = new Map<
    string,
    { school: string; count: number; candidates: StintTeamCandidate[] }
  >();
  const tally: StintTally = { added: 0, present: 0, wrongSport: 0 };

  let processed = 0;
  let nextKey: string | null = null;

  for (let rowIndex = 0; rowIndex < args.players.length; rowIndex++) {
    if (rowIndex > 0 && ops >= BULK_LOAD_STINT_OP_BUDGET) {
      nextKey = boundedKey(args.players[rowIndex].key);
      break;
    }
    const row = args.players[rowIndex];
    processed = rowIndex + 1;
    const key = boundedKey(row.key);
    const { nameNormalized } = rowPlayerName(row.name, key);
    assertRowBirthYear(row.birthYear, key, MIN_YEAR, maxYear);

    // ---- validate the stints before anything is read for them ------------
    const stints = cleanStints(row.stints, key, MAX_STINTS_PER_ROW);

    // ---- the player: adopt-only ------------------------------------------
    let player: Doc<"players"> | null = null;
    let matchedBy: "name" | "decision" = "name";
    if (row.decision) {
      const chosen = await ctx.db.get(row.decision.adopt);
      ops += 1;
      if (!chosen || chosen.sportId !== sportId) {
        throw new ConvexError(`The player chosen for "${key}" is not a player in this sport.`);
      }
      if (chosen.nameNormalized !== nameNormalized) {
        throw new ConvexError(
          `The player chosen for "${key}" is a different person. A decision ` +
            `can only pick between players that share the name being loaded.`,
        );
      }
      player = chosen;
      matchedBy = "decision";
    } else {
      const candidates = await ctx.db
        .query("players")
        .withIndex("by_name_normalized_and_sport_id", (q) =>
          q.eq("nameNormalized", nameNormalized).eq("sportId", sportId),
        )
        .take(PLAYER_CANDIDATE_SCAN_LIMIT);
      ops += 1;
      if (candidates.length === 0) {
        results.push({ key, playerId: null, status: "no-match", stints: [] });
        continue;
      }
      if (candidates.length === 1) {
        const only = candidates[0];
        if (
          only.birthYear !== undefined &&
          row.birthYear !== undefined &&
          only.birthYear !== row.birthYear
        ) {
          // Positive evidence of two people. A college load creates no one,
          // so this man is simply not in NB yet.
          results.push({
            key,
            playerId: null,
            status: "no-match",
            birthYearMismatch: true,
            stints: [],
          });
          continue;
        }
        player = only;
      } else {
        const byYear =
          row.birthYear === undefined
            ? []
            : candidates.filter((p) => p.birthYear === row.birthYear);
        if (byYear.length === 1) {
          player = byYear[0];
        } else {
          results.push({
            key,
            playerId: null,
            status: "ambiguous",
            candidates: candidates.map(playerCandidateOf),
            stints: [],
          });
          continue;
        }
      }
    }

    // ---- the stints: resolve, then gap-fill ------------------------------
    const career: StoredStint[] = [...(player.teamYears ?? [])];
    const startLength = career.length;
    const outcomes: PlayerStintResult["stints"] = [];
    for (const stint of stints) {
      let team: Doc<"teams"> | null = null;
      if (stint.teamId !== undefined) {
        const resolved = await resolveStintTeamId(readTeam, sportId, stint.teamId, tally);
        if ("entry" in resolved) {
          outcomes.push(resolved.entry);
          continue;
        }
        team = resolved.team;
      } else {
        const school = stint.school!;
        let matches = await lookupSchool(school);
        if (stint.fromYear !== undefined && matches.length > 1) {
          const span = {
            from: stint.fromYear,
            ...(stint.toYear !== undefined ? { to: stint.toYear } : {}),
          };
          matches = matches.filter((r) => erasOverlap(r.yearsActive, span));
        }
        if (matches.length === 0) {
          const k = normalizeTeamName(school);
          const entry = unresolved.get(k) ?? { school, count: 0 };
          entry.count += 1;
          unresolved.set(k, entry);
          outcomes.push({ outcome: "unresolved", school });
          continue;
        }
        if (matches.length > 1) {
          const candidates = matches.map(stintTeamCandidate);
          const k = normalizeTeamName(school);
          const entry = ambiguousSchools.get(k) ?? { school, count: 0, candidates };
          entry.count += 1;
          ambiguousSchools.set(k, entry);
          outcomes.push({ outcome: "ambiguous-school", school, candidates });
          continue;
        }
        // Exactly one — the two branches above returned on none and several.
        if (matches.length === 1) team = matches[0];
      }
      if (!team) continue;

      const via = stint.school !== undefined ? { school: stint.school } : {};
      outcomes.push(gapFillStint(career, team, stint, via, write, tally));
    }

    if (mutationCtx && career.length > startLength) {
      await writeCareer(mutationCtx, player._id, career);
      ops += 1;
    }
    results.push({
      key,
      playerId: player._id,
      status: write ? "adopted" : "would-adopt",
      matchedBy,
      stints: outcomes,
    });
  }

  const hasMore = processed < args.players.length;
  if (hasMore) {
    console.warn(
      JSON.stringify({
        msg: "bulk_load_player_stints_truncated",
        fn: write ? "upsertPlayerStints" : "previewPlayerStints",
        rowsSent: args.players.length,
        processed,
        opsSpent: ops,
        budget: BULK_LOAD_STINT_OP_BUDGET,
      }),
    );
  }

  const adopted = results.filter((r) => r.playerId !== null).length;
  return {
    results,
    summary: {
      adopted,
      stintsAdded: tally.added,
      stintsPresent: tally.present,
      noMatch: results.filter((r) => r.status === "no-match").length,
      ambiguous: results.filter((r) => r.status === "ambiguous").length,
      wrongSport: tally.wrongSport,
      unresolvedSchools: [...unresolved.values()],
      ambiguousSchools: [...ambiguousSchools.values()],
    },
    processed,
    hasMore,
    nextKey,
    opsSpent: ops,
  };
}

/**
 * NEO-285 — college (or any) stints onto players NB already holds. The
 * protocol is in the section note above; this is the armed entry point.
 */
export const upsertPlayerStints = internalMutation({
  args: {
    confirm: confirmValidator,
    sport: v.string(),
    /** Same protocol, no writes, `would-` statuses. */
    dryRun: v.optional(v.boolean()),
    players: v.array(playerStintRowValidator),
  },
  returns: playerStintsResultValidator,
  handler: async (ctx, args) => {
    assertBulkLoadArmed(args.confirm);
    return await loadPlayerStints(ctx, args, !args.dryRun);
  },
});

/**
 * The dry run as a query, runnable against an unarmed deployment — the same
 * reasoning, and the same budget bound, as `previewTeams`.
 */
export const previewPlayerStints = internalQuery({
  args: {
    confirm: confirmValidator,
    sport: v.string(),
    players: v.array(playerStintRowValidator),
  },
  returns: playerStintsResultValidator,
  handler: async (ctx, args) => {
    if (args.confirm !== "BULK_LOAD") {
      throw new ConvexError("Bulk load preview requires confirm: \"BULK_LOAD\".");
    }
    return await loadPlayerStints(ctx, args, false);
  },
});

// ---------------------------------------------------------------------------
// Roster players (NEO-611)
// ---------------------------------------------------------------------------

/**
 * NEO-611 — the roster leg: adopt or CREATE NB players from a roster dataset
 * and add their stints on teams NB already holds. One key per row, resumable,
 * armed twice, no UI. Its sibling `upsertPlayerStints` stays adopt-only; the
 * function NAME is the opt-in to creating people (a flag on the adopt-only
 * function would let one typo in a script mint a few thousand rows).
 *
 * ## The identity rule (NEO-285's, extended with a create branch)
 *
 * The same rule `adoptOrForkOnCreate` (players.ts) applies to the admin form
 * and NEO-285 applies to a college load, over the players that ANSWER to the
 * incoming name — `sameNamePlayers`: the primary name, an alias, or membership
 * of the sport. NEO-285's bare name-index read misses alias holders, and a
 * duplicate of a man NB holds under another name has no delete or merge path.
 *
 * | candidates | birth years                                | outcome            |
 * |------------|--------------------------------------------|--------------------|
 * | none       | any                                        | create             |
 * | one        | agree, or either side has none             | adopt              |
 * | one        | both dated and different                   | create             |
 * | several    | exactly one equals the incoming year       | adopt that one     |
 * | several    | incoming and EVERY candidate dated, none equal | create, `forked` |
 * | anything else |                                         | `ambiguous`        |
 *
 * A scan that came back full (`PLAYER_AMBIGUITY_SCAN_LIMIT` rows) may be
 * hiding the man, so it is always `ambiguous` and never forks.
 *
 * ## Twins: two keys that are one person
 *
 * A roster can list one man twice (a transfer, a spelling variant). The second
 * key finds the first key's freshly created row and, by the rule above, would
 * silently fold into it. Nothing stored distinguishes "a row this load made"
 * from "a row NB already held", so the CALLER supplies the boundary:
 * `loadStartedAt`, one timestamp for the whole load, reused on every call,
 * resume and rerun. When the row the rule would adopt has
 * `_creationTime >= loadStartedAt` and no `decision` named it, the result is
 * `ambiguous` with `reason: "created-this-run"` and that candidate carries
 * `createdThisRun`. An epoch in the future is refused. The driver must record
 * every `created` id and replay the key as `{ adopt: id }`.
 *
 * ## An adopt that nothing confirms is HELD
 *
 * Every adopt reports `birthYearCheck`: `match` (both dated and equal),
 * `candidate-undated`, `incoming-undated`, or `decision` (an operator's
 * answer). When either side has no birth year the name is all that agrees, and
 * writing a career onto the wrong undated man is the one mistake this loader
 * cannot take back. Such a row is `held`: NOTHING is written, `playerId` is
 * null, and `candidates` names the one player found, with `candidateBirthYear`,
 * so the driver can show it. A decision never overrides a contradiction: if both
 * the row and the chosen player are dated and differ, the call is refused. It adopts
 * once the answers file carries `{ adopt: id }`. The birth year is filled only
 * on a decision adopt of an undated row; aliases are unioned only on a
 * `match` or `decision` adopt.
 *
 * ## What a create writes, and what it does not
 *
 * `name`, `nameNormalized`, `sportId`, and when present `birthYear`, `aliases`
 * (through the one index writer) and `teamYears` (in the one career order),
 * plus `lastUpdated`. No `createdByUserId` (a CLI run has no user). It adds no
 * sport membership row and schedules nothing: no enrichment, for the reason
 * NEO-254 states for the team loader. A one-word name that is the first or
 * last name of a fuller-named player is `ambiguous` (`reason:
 * "name-fragment"`) unless the row carries `decision: { create: true }`, which
 * counts as the operator's confirmation. Each create also reports up to three
 * `nearExisting` players, advisory only.
 *
 * ## Stints
 *
 * Teams are named by `teamId` only (the roster driver already holds NB ids);
 * there is no `school` path, whose college-only eligibility rules must not
 * apply to a pro roster. Gap-fill, `present`, `cap-reached` and the per-stint
 * `wrong-sport` / `missing-team` refusals are `upsertPlayerStints`'s, through
 * the shared engine above. A key repeated within one call is refused: splitting
 * one key across rows is unsafe. A create with no valid stint still creates.
 *
 * ## Budget
 *
 * `BULK_LOAD_PLAYER_OP_BUDGET`, checked between rows, with the same
 * `processed` / `hasMore` / `nextKey` / `opsSpent` resume contract as the team
 * loader. A typical row costs 5-10 operations (three identity reads, one
 * write, and an alias sync when it carries aliases); the worst create is about
 * 115 and the worst adopt about 240, so the ceiling is the budget plus one such
 * row. `decision: { create: true }` is not idempotent (see the team loader);
 * replay the created id as an adopt.
 */
export const BULK_LOAD_PLAYER_OP_BUDGET = 900;

/** The most stints a row may carry: the most a player may store. */
const MAX_ROSTER_STINTS_PER_ROW = MAX_PLAYER_TEAM_YEARS;

/** How many `nearExisting` players a create reports. */
const NEAR_EXISTING_PLAYER_LIMIT = 3;

const rosterStintValidator = v.object({
  teamId: v.id("teams"),
  fromYear: v.optional(v.number()),
  toYear: v.optional(v.number()),
});

/** Two shapes, as for teams: "this one" and "none of those" are different answers. */
const rosterDecisionValidator = v.union(
  v.object({ adopt: v.id("players") }),
  v.object({ create: v.literal(true) }),
);

const rosterPlayerRowValidator = v.object({
  key: v.string(),
  name: v.string(),
  birthYear: v.optional(v.number()),
  /** NEO-676 — ISO `YYYY-MM-DD`; its year must be `birthYear` when both are sent. */
  birthDate: v.optional(v.string()),
  /** NEO-676 — MLB's person id: matched first, and filled onto an adopted row. */
  mlbamId: v.optional(v.number()),
  aliases: v.optional(v.array(v.string())),
  stints: v.array(rosterStintValidator),
  decision: v.optional(rosterDecisionValidator),
});

const rosterStintResultValidator = v.object({
  outcome: v.union(
    v.literal("added"),
    v.literal("would-add"),
    v.literal("present"),
    v.literal("wrong-sport"),
    v.literal("missing-team"),
    v.literal("cap-reached"),
  ),
  teamId: v.optional(v.id("teams")),
});

const rosterBirthYearCheckValidator = v.union(
  v.literal("match"),
  v.literal("candidate-undated"),
  v.literal("incoming-undated"),
  v.literal("decision"),
  // NEO-676 — the player was found by MLB id, not by name and year.
  v.literal("mlbamId"),
);

const rosterPlayerResultValidator = v.object({
  key: v.string(),
  /**
   * The player written or found. Null whenever nothing was written to or
   * for a player: `held` (the candidate is in `candidates`), `ambiguous`, and a
   * preview `would-create`.
   */
  playerId: v.union(v.id("players"), v.null()),
  status: v.union(
    v.literal("created"),
    v.literal("adopted"),
    v.literal("would-create"),
    v.literal("would-adopt"),
    v.literal("held"),
    v.literal("ambiguous"),
  ),
  /** How an adopt found its player. `decision` is a replayed answer. */
  matchedBy: v.optional(
    v.union(
      v.literal("name"),
      v.literal("alias"),
      v.literal("decision"),
      v.literal("mlbamId"),
    ),
  ),
  /** Adopt and `held`: what, if anything, confirmed the player by birth year. */
  birthYearCheck: v.optional(rosterBirthYearCheckValidator),
  /** Adopt and `held`: the candidate's birth year, absent when it has none. */
  candidateBirthYear: v.optional(v.number()),
  /** `ambiguous` only, when the cause is not simply "several candidates". */
  reason: v.optional(v.union(v.literal("created-this-run"), v.literal("name-fragment"))),
  /**
   * Preview only, with `reason: "created-this-run"`: the earlier row of this
   * call that would create the player this row would fold into.
   */
  twinOfKey: v.optional(v.string()),
  /** Create: the rule forked because every dated candidate had another birth year. */
  forked: v.optional(v.boolean()),
  /** `ambiguous` and `held`: the players the operator chooses between (`held`: the one found). */
  candidates: v.optional(
    v.array(
      v.object({
        id: v.id("players"),
        name: v.string(),
        birthYear: v.optional(v.number()),
        /** The row was created by this load (its `_creationTime` >= the epoch). */
        createdThisRun: v.optional(v.boolean()),
      }),
    ),
  ),
  /** `name-fragment`: the read filled its cap, so `candidates` is not the whole list. */
  candidatesTruncated: v.optional(v.boolean()),
  /** Create: up to three players in the sport that look like this one. Advisory. */
  nearExisting: v.optional(
    v.array(
      v.object({
        id: v.id("players"),
        name: v.string(),
        birthYear: v.optional(v.number()),
        confidence: v.union(v.literal("exact"), v.literal("close")),
      }),
    ),
  ),
  /** Adopt: aliases added to the row (unioned, never removed). */
  aliasesAdded: v.optional(v.number()),
  /** Adopt: incoming aliases left off because the row is at its alias cap. */
  aliasesSkipped: v.optional(v.number()),
  /** NEO-676 — Adopt: absent fields filled (mlbamId, birthDate, birthYear). */
  filled: v.optional(v.array(v.string())),
  /**
   * NEO-676 — where NB and MLB disagree. On an `adopted` row each entry is a
   * field left as it was; on an `ambiguous` row it is why the row was held
   * (nothing written). Omitted when empty.
   */
  disagreements: v.optional(v.array(disagreementValidator)),
  /** One entry per incoming stint, in order. Empty unless a player was written or found. */
  stints: v.array(rosterStintResultValidator),
});

const rosterPlayersResultValidator = v.object({
  results: v.array(rosterPlayerResultValidator),
  summary: v.object({
    /** Created — or, on a preview, would be. */
    created: v.number(),
    /** Created because the rule forked (a subset of `created`). */
    forked: v.number(),
    adopted: v.number(),
    held: v.number(),
    ambiguous: v.number(),
    stintsAdded: v.number(),
    stintsPresent: v.number(),
    wrongSport: v.number(),
  }),
  processed: v.number(),
  hasMore: v.boolean(),
  nextKey: v.union(v.string(), v.null()),
  opsSpent: v.number(),
});

type RosterPlayerRow = Infer<typeof rosterPlayerRowValidator>;
type RosterPlayerResult = Infer<typeof rosterPlayerResultValidator>;
type RosterBirthYearCheck = Infer<typeof rosterBirthYearCheckValidator>;

/**
 * A player the incoming name answers to. `player` is null for a row the
 * PREVIEW would create earlier in the same call: it cannot be inserted, so it
 * is kept in memory to let the preview see the same twins the write would.
 */
type RosterCandidate = {
  player: Doc<"players"> | null;
  /** The key of the earlier row that would create it (simulated candidates only). */
  twinOfKey?: string;
  name: string;
  birthYear?: number;
  createdThisRun: boolean;
  viaAlias: boolean;
};

type RosterIdentity =
  | { kind: "create"; forked: boolean }
  | { kind: "adopt"; candidate: RosterCandidate }
  | { kind: "ambiguous" };

/** The identity table in the section note, as a pure function. */
function decideRosterIdentity(
  candidates: ReadonlyArray<RosterCandidate>,
  birthYear: number | undefined,
  scanFull: boolean,
): RosterIdentity {
  if (candidates.length === 0) return { kind: "create", forked: false };
  // A full scan may be hiding the man; only a human can rule on that.
  if (scanFull) return { kind: "ambiguous" };
  if (candidates.length === 1) {
    const only = candidates[0];
    if (
      only.birthYear !== undefined &&
      birthYear !== undefined &&
      only.birthYear !== birthYear
    ) {
      // Positive evidence of two people.
      return { kind: "create", forked: false };
    }
    return { kind: "adopt", candidate: only };
  }
  if (birthYear !== undefined) {
    const hits = candidates.filter((c) => c.birthYear === birthYear);
    if (hits.length === 1) return { kind: "adopt", candidate: hits[0] };
    // Every rival is dated and none is this year, so none of them is this man.
    // Anything undated could be, and is not ours to rule out.
    if (hits.length === 0 && candidates.every((c) => c.birthYear !== undefined)) {
      return { kind: "create", forked: true };
    }
  }
  return { kind: "ambiguous" };
}

/** What the birth years say about an adopt the rule chose. */
function rosterBirthYearCheck(
  incoming: number | undefined,
  candidate: number | undefined,
): "match" | "candidate-undated" | "incoming-undated" {
  if (incoming === undefined) return "incoming-undated";
  if (candidate === undefined) return "candidate-undated";
  return "match";
}

/** Refuse an alias list the player writers would refuse, naming the row, not the value. */
function boundedAliasList(raw: ReadonlyArray<string> | undefined, key: string): string[] {
  const list = raw ?? [];
  if (list.length > MAX_PLAYER_ALIASES) {
    throw new ConvexError(
      `"${key}" has ${list.length} aliases; the limit is ${MAX_PLAYER_ALIASES}.`,
    );
  }
  // NEO-643: aliases are names too, cleansed before the length bound.
  const cleaned = list.map((alias) => cleanseExternalName(alias));
  for (const alias of cleaned) {
    if (alias.length > MAX_PLAYER_ALIAS_LENGTH) {
      throw new ConvexError(
        `An alias for "${key}" is ${alias.length} characters; the limit is ${MAX_PLAYER_ALIAS_LENGTH}.`,
      );
    }
  }
  return cleaned;
}

/**
 * The adopted player's aliases with the incoming ones unioned in. Never removes
 * or reorders one that is there; stops at the alias cap and says how many it
 * left off. Null when nothing changes.
 */
function unionPlayerAliases(
  player: Doc<"players">,
  incoming: ReadonlyArray<string>,
): { next: string[]; added: number; skipped: number } | null {
  const existing = player.aliases ?? [];
  const known = new Set(existing.map((a) => normalizePlayerName(a)));
  const fresh = normalizePlayerAliasList(incoming, player.name).filter(
    (a) => !known.has(normalizePlayerName(a)),
  );
  if (fresh.length === 0) return null;
  const room = Math.max(0, MAX_PLAYER_ALIASES - existing.length);
  const take = fresh.slice(0, room);
  if (take.length === 0) return { next: existing, added: 0, skipped: fresh.length };
  return { next: [...existing, ...take], added: take.length, skipped: fresh.length - take.length };
}

/**
 * Up to `NEAR_EXISTING_PLAYER_LIMIT` players in the sport that look like the
 * one about to be created: one `search_name` read, ranked by the same ladder
 * the New Player form uses. Read BEFORE the insert so the new row is not its
 * own neighbour.
 */
async function nearExistingPlayers(
  ctx: QueryCtx | MutationCtx,
  name: string,
  sportId: Id<"selectorOptions">,
): Promise<NonNullable<RosterPlayerResult["nearExisting"]>> {
  const hits = await ctx.db
    .query("players")
    .withSearchIndex("search_name", (q) => q.search("name", name).eq("sportId", sportId))
    .take(NEAR_EXISTING_SEARCH_CANDIDATES);
  return rankPlayerCandidates(name, hits)
    .slice(0, NEAR_EXISTING_PLAYER_LIMIT)
    .map(({ index, confidence }) => {
      const hit = hits[index];
      return {
        id: hit._id,
        name: hit.name,
        ...(hit.birthYear !== undefined ? { birthYear: hit.birthYear } : {}),
        confidence,
      };
    });
}

async function loadRosterPlayers(
  ctx: QueryCtx | MutationCtx,
  args: { sport: string; loadStartedAt: number; players: RosterPlayerRow[] },
  write: boolean,
): Promise<Infer<typeof rosterPlayersResultValidator>> {
  assertChunkSize(args.players.length, MAX_PLAYER_ROWS_PER_CALL, "players");
  if (!Number.isFinite(args.loadStartedAt) || args.loadStartedAt <= 0) {
    throw new ConvexError("loadStartedAt must be a millisecond timestamp.");
  }
  if (args.loadStartedAt > Date.now()) {
    // A future epoch would make every existing player look like a twin and
    // hide that the driver's clock is wrong. Refuse it rather than load on it.
    throw new ConvexError(
      "loadStartedAt is in the future. Take it once, before the first call of the load.",
    );
  }
  // Refused up front, for every row sent: splitting one key across rows (or
  // sending it twice) would make the second row a twin of the first.
  const keysSeen = new Set<string>();
  for (const row of args.players) {
    const key = boundedKey(row.key);
    if (keysSeen.has(key)) {
      throw new ConvexError(`The key "${key}" appears more than once in this call.`);
    }
    keysSeen.add(key);
  }
  assertNoRepeatedMlbamIds(
    args.players.map((p) => ({ label: p.key, mlbamId: p.mlbamId })),
  );

  let ops = 0;
  const sportId = await requireSportId(ctx, args.sport);
  ops += 1;
  const mutationCtx = write ? (ctx as MutationCtx) : null;
  const maxBirth = maxBirthYear();

  const teamCache = new Map<string, Doc<"teams"> | null>();
  const readTeam = cachedTeamReader(ctx, teamCache, () => {
    ops += 1;
  });
  const tally: StintTally = { added: 0, present: 0, wrongSport: 0 };
  // Preview only: the players this call WOULD have created so far.
  const wouldCreate: Array<RosterCandidate & { answersTo: Set<string> }> = [];

  const results: RosterPlayerResult[] = [];
  let processed = 0;
  let nextKey: string | null = null;

  for (let rowIndex = 0; rowIndex < args.players.length; rowIndex++) {
    if (rowIndex > 0 && ops >= BULK_LOAD_PLAYER_OP_BUDGET) {
      nextKey = boundedKey(args.players[rowIndex].key);
      break;
    }
    const row = args.players[rowIndex];
    processed = rowIndex + 1;
    const key = boundedKey(row.key);
    const { name, nameNormalized } = rowPlayerName(row.name, key);
    assertRowBirthYear(row.birthYear, key, MIN_BIRTH_YEAR, maxBirth);
    const stints = cleanStints(row.stints, key, MAX_ROSTER_STINTS_PER_ROW);
    const aliasesIn = boundedAliasList(row.aliases, key);
    const decision = row.decision;
    // NEO-676 — the MLB link pass inputs, and where this row and NB disagree.
    const mlbamId =
      row.mlbamId === undefined ? undefined : boundedMlbamId(row.mlbamId, key);
    const birthDate =
      row.birthDate === undefined
        ? undefined
        : boundedBirthDate(row.birthDate, row.birthYear, key);
    const dis: Disagreement[] = [];
    /** Hold the row: nothing is written, the operator gets the candidates and `dis`. */
    const hold = (candidates: ReadonlyArray<Doc<"players">>) =>
      results.push({
        key,
        playerId: null,
        status: "ambiguous",
        candidates: candidates.map(playerCandidateOf),
        disagreements: dis,
        stints: [],
      });
    const candidateOf = (c: RosterCandidate) =>
      c.player
        ? [
            {
              ...playerCandidateOf(c.player),
              ...(c.createdThisRun ? { createdThisRun: true } : {}),
            },
          ]
        : [];

    // ---- who is this row? --------------------------------------------------
    let player: Doc<"players"> | null = null;
    let matchedBy: "name" | "alias" | "decision" | "mlbamId" = "name";
    let birthYearCheck: RosterBirthYearCheck = "match";
    let forked = false;

    /*
     * NEO-676 step 0 — the MLB id, before any name is read. `by_mlbam_id` is
     * not unique at the schema, so two rows holding one id is a tie (never
     * `.first()`), and the writers below never add a second.
     */
    let idRow: Doc<"players"> | null = null;
    if (mlbamId !== undefined) {
      const idRows = await ctx.db
        .query("players")
        .withIndex("by_mlbam_id", (q) => q.eq("externalIds.mlbamId", mlbamId))
        .take(2);
      ops += 1;
      if (idRows.length > 1) {
        dis.push({
          field: "mlbamId",
          nb: idRows.map((p) => `${p.name} (${p._id})`).join("; "),
          mlb: String(mlbamId),
        });
        hold(idRows);
        continue;
      }
      idRow = idRows[0] ?? null;
      if (idRow) {
        ops += 1;
        if (!(await playerBelongsToSport(ctx, idRow, sportId))) {
          dis.push({
            field: "mlbamId",
            nb: `held by ${idRow.name} (${idRow._id}), outside this sport`,
            mlb: String(mlbamId),
          });
          hold([idRow]);
          continue;
        }
      }
    }

    if (decision && "adopt" in decision) {
      const chosen = await ctx.db.get(decision.adopt);
      ops += 1;
      if (chosen && chosen.sportId !== sportId) ops += 1;
      if (!chosen || !(await playerBelongsToSport(ctx, chosen, sportId))) {
        throw new ConvexError(`The player chosen for "${key}" is not a player in this sport.`);
      }
      if (
        chosen.nameNormalized !== nameNormalized &&
        matchedAliasFor(chosen, nameNormalized) === undefined
      ) {
        throw new ConvexError(
          `The player chosen for "${key}" is a different person. A decision ` +
            `can only pick between players that answer to the name being loaded.`,
        );
      }
      if (mlbamId !== undefined) {
        // NEO-676 — an identity conflict holds the row instead of failing the
        // chunk: the id is another player's, or this player carries another id.
        const heldId = chosen.externalIds?.mlbamId;
        if (idRow && idRow._id !== chosen._id) {
          dis.push({
            field: "mlbamId",
            nb: `held by ${idRow.name} (${idRow._id})`,
            mlb: String(mlbamId),
          });
        } else if (heldId !== undefined && heldId !== mlbamId) {
          dis.push({ field: "mlbamId", nb: String(heldId), mlb: String(mlbamId) });
        }
        if (
          chosen.birthYear !== undefined &&
          row.birthYear !== undefined &&
          chosen.birthYear !== row.birthYear
        ) {
          dis.push({
            field: "birthYear",
            nb: String(chosen.birthYear),
            mlb: String(row.birthYear),
          });
        }
        if (dis.length > 0) {
          hold(idRow && idRow._id !== chosen._id ? [chosen, idRow] : [chosen]);
          continue;
        }
      }
      if (
        chosen.birthYear !== undefined &&
        row.birthYear !== undefined &&
        chosen.birthYear !== row.birthYear
      ) {
        // An answer cannot override a contradiction: the operator named a
        // person the dataset says was born in another year. Neither year is
        // echoed (the message reaches logs and Sentry).
        throw new ConvexError(
          `The birth year of the player chosen for "${key}" contradicts the row; ` +
            `correct the player or drop the row's birth year.`,
        );
      }
      player = chosen;
      matchedBy = "decision";
      birthYearCheck = "decision";
    } else if (!decision && idRow) {
      // NEO-676 — found by MLB id: the link vouches for the person, so the
      // name and the held/twin rules do not apply. A birth year that
      // contradicts the id is an identity conflict, held.
      if (
        idRow.birthYear !== undefined &&
        row.birthYear !== undefined &&
        idRow.birthYear !== row.birthYear
      ) {
        dis.push({
          field: "birthYear",
          nb: String(idRow.birthYear),
          mlb: String(row.birthYear),
        });
        hold([idRow]);
        continue;
      }
      player = idRow;
      matchedBy = "mlbamId";
      birthYearCheck = "mlbamId";
    } else if (!decision) {
      const found = await sameNamePlayers(ctx, nameNormalized, sportId);
      ops += 3 + found.length;
      const candidates: RosterCandidate[] = found.map((p) => ({
        player: p,
        name: p.name,
        ...(p.birthYear !== undefined ? { birthYear: p.birthYear } : {}),
        createdThisRun: p._creationTime >= args.loadStartedAt,
        viaAlias: matchedAliasFor(p, nameNormalized) !== undefined,
      }));
      for (const sim of wouldCreate) {
        if (sim.answersTo.has(nameNormalized)) candidates.push(sim);
      }
      const verdict = decideRosterIdentity(
        candidates,
        row.birthYear,
        found.length >= PLAYER_AMBIGUITY_SCAN_LIMIT,
      );

      if (verdict.kind === "ambiguous") {
        results.push({
          key,
          playerId: null,
          status: "ambiguous",
          candidates: candidates.flatMap(candidateOf),
          stints: [],
        });
        continue;
      }
      if (verdict.kind === "adopt") {
        const c = verdict.candidate;
        if (c.createdThisRun) {
          // The rule would fold this key into a player THIS load made — a twin,
          // or a rerun that lost its answers. Never silently.
          results.push({
            key,
            playerId: null,
            status: "ambiguous",
            reason: "created-this-run",
            ...(c.twinOfKey !== undefined ? { twinOfKey: c.twinOfKey } : {}),
            candidates: candidateOf(c),
            stints: [],
          });
          continue;
        }
        const check = rosterBirthYearCheck(row.birthYear, c.birthYear);
        const otherId = c.player?.externalIds?.mlbamId;
        if (mlbamId !== undefined && otherId !== undefined && otherId !== mlbamId) {
          // NEO-676 — the player the name found is already linked to another
          // MLB person: two people, or a wrong link. Held, never relinked.
          dis.push({ field: "mlbamId", nb: String(otherId), mlb: String(mlbamId) });
          hold([c.player!]);
          continue;
        }
        if (check !== "match") {
          results.push({
            key,
            playerId: null,
            status: "held",
            birthYearCheck: check,
            ...(c.birthYear !== undefined ? { candidateBirthYear: c.birthYear } : {}),
            candidates: candidateOf(c),
            stints: [],
          });
          continue;
        }
        player = c.player!;
        matchedBy = c.viaAlias ? "alias" : "name";
        birthYearCheck = "match";
      } else {
        forked = verdict.forked;
      }
    }
    // NEO-676 — `create` is "none of those is him", and an id already on a
    // player says one is. The answer cannot mint a second holder of the id.
    if (decision && "create" in decision && idRow) {
      dis.push({
        field: "mlbamId",
        nb: `held by ${idRow.name} (${idRow._id})`,
        mlb: String(mlbamId),
      });
      hold([idRow]);
      continue;
    }

    // ---- the stints: resolve, then gap-fill -------------------------------
    const career: StoredStint[] = [...(player?.teamYears ?? [])];
    const startLength = career.length;
    const outcomes: RosterPlayerResult["stints"] = [];
    for (const stint of stints) {
      const resolved = await resolveStintTeamId(readTeam, sportId, stint.teamId!, tally);
      if ("entry" in resolved) {
        outcomes.push(resolved.entry);
        continue;
      }
      outcomes.push(gapFillStint(career, resolved.team, stint, {}, write, tally));
    }

    // ---- adopt: write what the row gains ----------------------------------
    if (player) {
      const candidateBirthYear = player.birthYear;
      const fillBirthYear =
        birthYearCheck === "decision" &&
        player.birthYear === undefined &&
        row.birthYear !== undefined;
      const merged = unionPlayerAliases(player, aliasesIn);
      const aliasesChanged = merged !== null && merged.added > 0;
      const careerGrew = career.length > startLength;
      /*
       * NEO-676 — the MLB link fields, gap-fill only. The id where the row has
       * none; the birth date where the row has none AND its birth year agrees
       * (or it has no year, in which case the date brings the year with it:
       * an auto-linked undated row). A value already on the row is never
       * replaced; a different one is a disagreement.
       */
      const filled: string[] = [];
      const link: {
        birthDate?: string;
        birthYear?: number;
        externalIds?: { wikidataId?: string; mlbamId?: number };
      } = {};
      if (mlbamId !== undefined) {
        if (player.externalIds?.mlbamId === undefined) {
          link.externalIds = { ...(player.externalIds ?? {}), mlbamId };
          filled.push("mlbamId");
        }
        if (birthDate !== undefined) {
          const dateYear = Number(birthDate.slice(0, 4));
          if (player.birthDate !== undefined) {
            if (player.birthDate !== birthDate) {
              dis.push({ field: "birthDate", nb: player.birthDate, mlb: birthDate });
            }
          } else if (player.birthYear === undefined) {
            link.birthDate = birthDate;
            link.birthYear = dateYear;
            filled.push("birthDate", "birthYear");
          } else if (player.birthYear === dateYear) {
            link.birthDate = birthDate;
            filled.push("birthDate");
          } else {
            dis.push({
              field: "birthDate",
              nb: String(player.birthYear),
              mlb: birthDate,
            });
          }
        }
      }
      const linkChanged = Object.keys(link).length > 0;
      if (mutationCtx && (careerGrew || fillBirthYear || aliasesChanged || linkChanged)) {
        await writeCareer(mutationCtx, player._id, careerGrew ? career : null, {
          ...(fillBirthYear ? { birthYear: row.birthYear } : {}),
          ...(aliasesChanged ? { aliases: merged.next } : {}),
          ...link,
        });
        ops += 1;
        if (aliasesChanged) {
          await syncPlayerAliases(mutationCtx, { playerId: player._id, aliases: merged.next });
          ops += 3 + merged.added;
        }
      }
      results.push({
        key,
        playerId: player._id,
        status: write ? "adopted" : "would-adopt",
        matchedBy,
        birthYearCheck,
        ...(candidateBirthYear !== undefined ? { candidateBirthYear } : {}),
        ...(merged && merged.added > 0 ? { aliasesAdded: merged.added } : {}),
        ...(merged && merged.skipped > 0 ? { aliasesSkipped: merged.skipped } : {}),
        ...(filled.length > 0 ? { filled } : {}),
        ...(dis.length > 0 ? { disagreements: dis } : {}),
        stints: outcomes,
      });
      continue;
    }

    // ---- create -------------------------------------------------------------
    if (decision === undefined) {
      // NEO-463 — a one-word name that is a piece of a fuller-named player.
      // `{ create: true }` is the operator saying it is a one-name player.
      if (nameFragmentTokens(name).length === 1) {
        const scan = await nameFragmentScan(ctx, name, sportId);
        ops += 2;
        if (scan.matches.length > 0) {
          results.push({
            key,
            playerId: null,
            status: "ambiguous",
            reason: "name-fragment",
            candidates: scan.matches
              .slice(0, PLAYER_AMBIGUITY_SCAN_LIMIT)
              .map((m) => ({
                id: m._id,
                name: m.name,
                ...(m.birthYear !== undefined ? { birthYear: m.birthYear } : {}),
              })),
            ...(scan.truncated || scan.matches.length > PLAYER_AMBIGUITY_SCAN_LIMIT
              ? { candidatesTruncated: true }
              : {}),
            stints: [],
          });
          continue;
        }
      }
    }
    const nearExisting = await nearExistingPlayers(ctx, name, sportId);
    ops += 1;
    /*
     * NEO-676 — a probable duplicate is a disagreement, not a create: a
     * close-name player with this birth year, or with none on either side,
     * may well be him. Held, nothing written; `{ create: true }` is the
     * operator's "no, a different man" and skips it.
     */
    if (mlbamId !== undefined && decision === undefined) {
      const likely = nearExisting.filter(
        (n) =>
          n.confidence === "close" &&
          (n.birthYear === undefined ||
            row.birthYear === undefined ||
            n.birthYear === row.birthYear),
      );
      if (likely.length > 0) {
        dis.push({
          field: "name",
          nb: likely.map((n) => `${n.name} (${n.id})`).join("; "),
          mlb: name,
        });
        results.push({
          key,
          playerId: null,
          status: "ambiguous",
          candidates: likely.map(({ id, name: candidate, birthYear }) => ({
            id,
            name: candidate,
            ...(birthYear !== undefined ? { birthYear } : {}),
          })),
          disagreements: dis,
          stints: [],
        });
        continue;
      }
    }
    const aliases = normalizePlayerAliasList(aliasesIn, name);

    // A date brings its year when the row sent none (NEO-676).
    const createBirthYear =
      row.birthYear ?? (birthDate !== undefined ? Number(birthDate.slice(0, 4)) : undefined);
    let createdId: Id<"players"> | null = null;
    if (mutationCtx) {
      createdId = await mutationCtx.db.insert("players", {
        name,
        nameNormalized,
        sportId,
        ...(createBirthYear !== undefined ? { birthYear: createBirthYear } : {}),
        ...(birthDate !== undefined ? { birthDate } : {}),
        ...(mlbamId !== undefined ? { externalIds: { mlbamId } } : {}),
        ...(aliases.length ? { aliases } : {}),
        ...(career.length ? { teamYears: sortTeamYears(career) } : {}),
        lastUpdated: Date.now(),
      });
      ops += 1;
      if (aliases.length) {
        await syncPlayerAliases(mutationCtx, { playerId: createdId, aliases });
        ops += 3 + aliases.length;
      }
    } else {
      wouldCreate.push({
        player: null,
        twinOfKey: key,
        name,
        ...(row.birthYear !== undefined ? { birthYear: row.birthYear } : {}),
        createdThisRun: true,
        viaAlias: false,
        answersTo: new Set([nameNormalized, ...aliases.map((a) => normalizePlayerName(a))]),
      });
    }
    results.push({
      key,
      playerId: createdId,
      status: write ? "created" : "would-create",
      ...(forked ? { forked: true } : {}),
      ...(nearExisting.length > 0 ? { nearExisting } : {}),
      stints: outcomes,
    });
  }

  const hasMore = processed < args.players.length;
  if (hasMore) {
    console.warn(
      JSON.stringify({
        msg: "bulk_load_players_truncated",
        fn: write ? "upsertPlayers" : "previewPlayers",
        rowsSent: args.players.length,
        processed,
        opsSpent: ops,
        budget: BULK_LOAD_PLAYER_OP_BUDGET,
      }),
    );
  }

  const count = (status: RosterPlayerResult["status"][]) =>
    results.filter((r) => status.includes(r.status)).length;
  return {
    results,
    summary: {
      created: count(["created", "would-create"]),
      forked: results.filter((r) => r.forked === true).length,
      adopted: count(["adopted", "would-adopt"]),
      held: count(["held"]),
      ambiguous: count(["ambiguous"]),
      stintsAdded: tally.added,
      stintsPresent: tally.present,
      wrongSport: tally.wrongSport,
    },
    processed,
    hasMore,
    nextKey,
    opsSpent: ops,
  };
}

/**
 * NEO-611 — adopt or create players from a roster dataset, with their stints.
 * The protocol is in the section note above; this is the armed entry point.
 * `loadStartedAt` is one timestamp for the whole load: take it once, before the
 * first call, and send the same value on every call, resume and rerun.
 */
export const upsertPlayers = internalMutation({
  args: {
    confirm: confirmValidator,
    sport: v.string(),
    loadStartedAt: v.number(),
    players: v.array(rosterPlayerRowValidator),
  },
  returns: rosterPlayersResultValidator,
  handler: async (ctx, args) => {
    assertBulkLoadArmed(args.confirm);
    return await loadRosterPlayers(ctx, args, true);
  },
});

/**
 * The same protocol with no writes, as a query: runnable against an unarmed
 * deployment, and the first thing to run on a new one. It models the twins its
 * own would-create rows would cause; it does not model a one-word name
 * clashing with a player it would itself create.
 */
export const previewPlayers = internalQuery({
  args: {
    confirm: confirmValidator,
    sport: v.string(),
    loadStartedAt: v.number(),
    players: v.array(rosterPlayerRowValidator),
  },
  returns: rosterPlayersResultValidator,
  handler: async (ctx, args) => {
    if (args.confirm !== "BULK_LOAD") {
      throw new ConvexError("Bulk load preview requires confirm: \"BULK_LOAD\".");
    }
    return await loadRosterPlayers(ctx, args, false);
  },
});
