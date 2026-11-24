/**
 * NEO-26: data migration from the legacy free-text `cardChecklist.team`
 * field into the structured `teamOnCardIds[]` entity link.
 *
 * Historically the BSC/SL fetch path wrote whatever team string the
 * marketplace happened to surface into `cardChecklist.team`. The form
 * UI was inconsistent: marketplace-fetched rows had `team` set but
 * never `teamOnCardIds[]`, and the edit form only read the latter,
 * which is why "Team field is always blank when editing a card" (the
 * NEO-26 bug report).
 *
 * The fix is to converge on `teamOnCardIds[]` as the canonical
 * representation. This file provides the one-shot internal mutation
 * that drains `team` strings into `teamOnCardIds[]` for every existing
 * row. After the migration runs to completion (caller reruns until
 * `remaining === 0`), the `cardChecklist.team` field is removed from
 * the schema in this same PR.
 *
 * Idempotent: rows already carrying a `teamOnCardIds[]` value are
 * skipped on every pass. Run via the Convex dashboard with
 * `batchSize` tuned to fit under the per-mutation read/write budget
 * (default 100 rows per batch).
 */

import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { requireAdmin } from "./auth";
// NEO-236: these two paths LOOK UP a team and link it; neither may create one.
// See `convex/lib/teamRow.ts` and the notes on each handler below.
import { findTeamsByFullName, resolveCardTeamName } from "./lib/teamRow";
// NEO-591 — a listed place ("Oklahoma"): the teams whose LOCATION it is, as choices.
import { nameTokens } from "./lib/entityNearMatch";
import { teamLocationIs } from "./lib/placeTeam";
import { findSetYearForSelectorOption } from "./lib/selectorAncestry";
import { teamFullName } from "../lib/teams/team-name";
// NEO-335: the wizard's pre-save team suggestions (`teamSuggestionsForPreview`).
import { ConvexError } from "convex/values";
import { sameNamePlayers } from "./players";
// Called inside the handler only; `cardPlayerLinks.ts` imports this module
// back (for `findSportForSelectorOption`), which is safe for the same reason.
import { recentCardIdsForPlayer } from "./cardPlayerLinks";
// NEO-358 — every `teamOnCardIds` write here keeps the team → cards index.
import { syncCardTeamLinks } from "./cardTeamLinks";
import { newCardLeagueCache } from "./cardLeague";
import { refreshedListingDescription } from "./cardDescriptionRefresh";
import { normalizeEntityName } from "../lib/entities/normalize-name";
import {
  suggestTeamsForPlayer,
  teamPreferenceRank,
  UNRANKED,
  type SuggestionCard,
  type TeamPreferenceRank,
  type TeamSuggestionTier,
} from "./lib/teamFill";
// NEO-335 Phase 2: the set's league (C2b) and a listing's team name as choices.
import { effectiveSetLeagueIds } from "./lib/selectorLeagues";
import { pickTeamForYear } from "../lib/teams/team-era";
import { MAX_CARD_TEAMS } from "./features/cardAttention";
// NEO-345: BSC attribute tokens read into NB's vocabulary, and the closed
// autograph-format vocabulary the fill writes into `features.autographed`.
import {
  boundBscAttributeTokens,
  normalizeBscAttributeTokensDetailed,
  printRunFromToken,
  MAX_BSC_PRINT_RUN,
} from "./lib/bscAttributeTokens";
import {
  carriesAutographToken,
  deriveCardObservedFeatures,
  isAutographFormat,
} from "./features/deriveCardFeatures";
import { variantTypeKind } from "./variantRole";
// NEO-556: the leaf's set-level "No Team", stamped once BSC answers with none.
import { noTeamCardVerdict, stampNoTeam, teamDefaultOf } from "./lib/selectorTeams";
import { regenerateListingNow } from "./tidyListingText";
// NEO-426 — a teamless sport is one more reason to stamp "No team".
import { createSportNoTeamReader } from "./sportTeamless";
import { queuedByField } from "./lib/bscGateKey";

/**
 * Walk up the parent chain from a cardChecklist's selectorOption to
 * find the ancestor `level === "sport"` row's value. Returns
 * undefined when the chain doesn't include a sport row (orphaned data;
 * shouldn't happen in practice but guard anyway). 16-step depth
 * cutoff matches the `commitCardChecklist` ancestor walk so a cycle
 * can't deadlock the mutation.
 */
/**
 * NEO-96: returns the sport-level ancestor's ROW ID, not its display value.
 * It used to return `node.value` (raw case) while `fetchCardChecklist` returned
 * the same node's value lowercased — two writers, two casings, into the same
 * `teams.sport` string column. Returning the id removes the disagreement by
 * construction.
 */
export async function findSportForSelectorOption(
  ctx: { db: { get: (id: Id<"selectorOptions">) => Promise<any> } },
  selectorOptionId: Id<"selectorOptions">,
): Promise<Id<"selectorOptions"> | undefined> {
  let cursor: Id<"selectorOptions"> | undefined = selectorOptionId;
  let depth = 0;
  while (cursor && depth < 16) {
    const node = await ctx.db.get(cursor);
    if (!node) return undefined;
    if (node.level === "sport") return node._id;
    cursor = node.parentId;
    depth += 1;
  }
  return undefined;
}

export const backfillTeamToOnCardIds = internalMutation({
  args: {
    /**
     * Cap on rows scanned per invocation. Defaults to 100 — a card
     * row patch is one read + one write, plus one indexed team lookup.
     * 100 keeps us far below the 4096-read mutation budget.
     */
    batchSize: v.optional(v.number()),
  },
  returns: v.object({
    /** Rows visited this batch (including skips). */
    processed: v.number(),
    /**
     * NEO-236: rows whose legacy `team` string matches no team we hold.
     *
     * This used to be `teamsCreated`, and the rename is the behaviour change:
     * the migration inserted a `teams` row for every unrecognised string a
     * marketplace had ever written onto a card. Creation now takes Location +
     * Name from an operator, and this path has neither, so an unmatched row is
     * LEFT ALONE — both its `team` string and its empty `teamOnCardIds` stay
     * put, so the attention walker's missing-team lane still surfaces it and a
     * rerun after the operator creates the team picks it up.
     *
     * **This changes the operator's exit condition.** The old advice was
     * "rerun until `processed === 0`", which assumed every row could be
     * migrated. An unmatched row stays eligible forever by design, so a run
     * whose `processed === unmatched` has done everything it can — anything
     * further needs the teams to exist first.
     */
    unmatched: v.number(),
    /**
     * Rows skipped because we couldn't determine the sport for the
     * ancestor chain — usually orphaned test fixtures. Logged with
     * the cardChecklist id so operators can clean these up by hand.
     */
    skippedAmbiguous: v.number(),
    /** Approximate number of rows still needing backfill after this batch. */
    remaining: v.number(),
  }),
  handler: async (ctx, args) => {
    const batchSize = args.batchSize ?? 100;

    // Pull a window of rows. We can't use a `.withIndex(...)` for
    // "team set AND teamOnCardIds empty" — there is no such index —
    // so the cheapest correct read is to scan the table in pages
    // (1000-row pages) and filter in JS. Bounded by Convex's
    // per-mutation read budget; once a page yields no work, we stop.
    //
    // Idempotent design: every pass filters down to rows that still
    // need work, so reruns naturally drain the queue regardless of
    // where the previous batch stopped.
    const PAGE_SIZE = 1000;
    const rows = await ctx.db
      .query("cardChecklist")
      .take(PAGE_SIZE);

    let processed = 0;
    let unmatched = 0;
    let skippedAmbiguous = 0;
    /**
     * NEO-254 — the set year per selectorOption, walked once.
     *
     * The narrowing needs it per ROW, and this loop runs over a batch whose
     * rows share a handful of sets; the walk is several `ctx.db.get`s, so
     * repeating it per row would spend the mutation's read budget re-deriving
     * one number. `undefined` is a real answer (an orphaned subtree) and is
     * cached as such, so a miss is not re-walked either.
     */
    const setYearCache = new Map<string, number | undefined>();
    // NEO-569 — team and set league reads, shared across the batch.
    const leagueCache = newCardLeagueCache();
    const setYearFor = async (
      selectorOptionId: Id<"selectorOptions">,
    ): Promise<number | undefined> => {
      const key = selectorOptionId as string;
      if (!setYearCache.has(key)) {
        setYearCache.set(
          key,
          await findSetYearForSelectorOption(ctx, selectorOptionId),
        );
      }
      return setYearCache.get(key);
    };
    let remaining = 0;

    for (const row of rows) {
      // Skip rows that are already migrated (no `team` string set, OR
      // they already carry `teamOnCardIds[]` from the marketplace
      // fetch path). The latter wins: we never clobber an existing
      // entity link with the legacy string.
      const teamString = (row as any).team as string | undefined;
      const teamOnCardIds = row.teamOnCardIds;

      if (teamOnCardIds && teamOnCardIds.length > 0) {
        // Already linked — only need to clear the dangling string.
        if (teamString && teamString.length > 0) {
          await ctx.db.patch(row._id, { team: undefined } as any);
          processed += 1;
        }
        continue;
      }
      if (!teamString || teamString.trim().length === 0) {
        // Nothing to backfill.
        continue;
      }

      if (processed >= batchSize) {
        // We've hit our per-batch cap. Account for unfinished rows
        // in `remaining` so the caller knows to re-run.
        remaining += 1;
        continue;
      }

      const sportId = await findSportForSelectorOption(
        ctx,
        row.selectorOptionId,
      );
      if (!sportId) {
        // No sport ancestor — can't safely look up across sports
        // (Yankees-MLB vs Yankees-Pinstripes-something-else). Log
        // and leave for operator review.
        console.warn(
          `[backfillTeamToOnCardIds] skipping ambiguous row id=${row._id}` +
            ` selectorOptionId=${row.selectorOptionId} team="${teamString}"`,
        );
        skippedAmbiguous += 1;
        processed += 1;
        continue;
      }

      // NEO-236: the shared identity lookup (`by_name_normalized_and_sport_id`
      // keyed on the composed full name), so a legacy string still resolves
      // onto a row that has since been split into location + nickname. One
      // indexed read per team string.
      //
      // NEO-254: narrowed by the SET'S year, because a name can now belong to
      // several eras — a 1985 "Winnipeg Jets" card and a 2015 one are
      // different franchises. The year is walked once per selectorOption and
      // memoised across the batch: it is a property of the set, and this loop
      // runs over hundreds of rows that share a handful of sets.
      const setYear = await setYearFor(row.selectorOptionId);
      //
      // NEO-602: and by the card's own PLAYERS when the name has several eras
      // (`resolveCardTeamName`): a Rickey Henderson card printing "Oakland
      // Athletics" is the 1968–2024 franchise's whatever year the set is. A
      // card with no players, or a name with one row, resolves by the year
      // alone exactly as before. The set year keeps its NEO-307 past-era
      // allowance — a card can show a team's past. Unattended and with no
      // review row to show, so the players' answer links even where the card
      // year disagrees (`CardTeamResolution.agreesWithYear`); a null stays put.
      const { teamId: resolvedTeamId } = await resolveCardTeamName(
        ctx,
        sportId,
        teamString,
        setYear,
        { cardPlayerIds: [row.playerIds ?? []] },
      );

      if (!resolvedTeamId) {
        // NEO-236: no match, so no link — and NOT an insert. Deliberately
        // leaves `team` set as well: the string is the only record of what the
        // marketplace claimed, and clearing it would destroy the evidence an
        // operator needs to create the right team. The row simply stays
        // unmigrated and a later pass will link it once the team exists.
        // NEO-254: this now also covers "several eras and the year did not
        // separate them", which lands in the same place for the same reason —
        // the string is kept, nothing is linked, and an operator decides.
        unmatched += 1;
        processed += 1;
        continue;
      }
      const teamId: Id<"teams"> = resolvedTeamId;

      await ctx.db.patch(row._id, {
        teamOnCardIds: [teamId],
        // Clear the legacy string in the same patch so the next
        // pre-removal verification scan reports 0 unmigrated rows.
        team: undefined,
        lastUpdated: Date.now(),
      } as any);
      // NEO-358 — the team → cards index follows the link.
      await syncCardTeamLinks(ctx, row, [teamId], { leagueCache });
      processed += 1;
    }

    // Best-effort `remaining` estimate: every row in this page that
    // wasn't already migrated and wasn't processed this batch.
    // Caller can rerun until processed === 0 to fully drain.
    return {
      processed,
      unmatched,
      skippedAmbiguous,
      remaining,
    };
  },
});

// ===========================================================================
// NEO-345 — BSC attribute fill
// ===========================================================================

/**
 * NEO-345 — Signed By's default for a card that just became an autograph: the
 * card's own players, comma-joined, in `playerIds` order. Undefined when the
 * card has none (or none still exist). The ONE spelling of the rule
 * `setCardFeature` applies on a manual edit and `buildCardRowForInsert`
 * applies at insert, for every server-side writer of `features.autographed`.
 */
export async function signedByFromPlayers(
  ctx: Pick<MutationCtx, "db">,
  playerIds: ReadonlyArray<Id<"players">> | undefined,
): Promise<string | undefined> {
  if (!playerIds || playerIds.length === 0) return undefined;
  const players = await Promise.all(playerIds.map((id) => ctx.db.get(id)));
  const names = players
    .filter((p): p is NonNullable<typeof p> => p !== null)
    .map((p) => p.name)
    .filter((name) => !!name && name.trim().length > 0);
  return names.length > 0 ? names.join(", ") : undefined;
}

/** A `features` value that says nothing yet. */
function featureIsEmpty(value: string | undefined): boolean {
  return value === undefined || value === "" || value === "None";
}

function hasToken(list: ReadonlyArray<string>, token: string): boolean {
  const key = token.toUpperCase();
  return list.some((t) => t.trim().toUpperCase() === key);
}

/**
 * NEO-345 — fill a stored card from BSC's attribute tokens. FILL-EMPTY, NEVER
 * OVERWRITE: a marketplace value only ever lands where NB has nothing, and a
 * disagreement is left standing for the NEO-203 re-sync review.
 *
 * Callers: `applyBscTeamResolution` on every answered card, the leaf
 * autograph-format cascade (`autographFormat.ts`), and the stored-row backfill
 * (`backfillBscAttributeFeatures.ts`). The tokens may be raw BSC tokens or an
 * already-normalised list; they are bounded and normalised here.
 *
 * - `attributes`: the union of what the row holds and what BSC says. A raw
 *   `SN<n>`/`1/1` on the row is canonicalised to `NUM`; nothing else is
 *   removed.
 * - `printRun`: set only when the row has none. When the row's differs, it is
 *   left, BSC's raw `SN<n>` is kept beside `NUM`, and the disagreement is
 *   reported.
 * - `isRookie` / `isRelic`: set true from `RC` / `RELIC` when not already
 *   true (an explicit false counts as empty).
 * - `features.shortPrint` / `isRookie` / `isRelic`: only where the key is
 *   absent or "None".
 * - `features.autographed`: only when the card carries `AU`, a format is
 *   known (the LEAF's `autographFormat`, never a marketplace's wording), and
 *   the card's value is absent/"None" or equals `previousAutographFormat`
 *   (the cascade re-answering a leaf). Signed By is then seeded from the
 *   card's players when empty.
 * - `lastUpdated` is bumped only when something was written. The listing
 *   title is NOT regenerated. Idempotent: a second call writes nothing.
 */
export async function applyBscAttributeFill(
  ctx: MutationCtx,
  row: Doc<"cardChecklist">,
  opts: {
    tokens: string[];
    printRun?: number;
    autographFormat?: "On Card" | "Sticker/Label";
    previousAutographFormat?: string;
  },
): Promise<{
  wrote: boolean;
  printRunDisagreement: boolean;
  autographFormatted: boolean;
}> {
  const incoming = normalizeBscAttributeTokensDetailed(
    boundBscAttributeTokens(opts.tokens).tokens,
  );
  const callerPrintRun =
    opts.printRun !== undefined &&
    Number.isInteger(opts.printRun) &&
    opts.printRun >= 1 &&
    opts.printRun <= MAX_BSC_PRINT_RUN
      ? opts.printRun
      : undefined;
  const incomingPrintRun = callerPrintRun ?? incoming.printRun;

  const stored = row.attributes ?? [];
  // The row's own raw print-run tokens (a pre-NEO-345 parse stored "SN25").
  const storedRuns = new Set<number>();
  for (const t of stored) {
    const n = printRunFromToken(t);
    if (n !== undefined) storedRuns.add(n);
  }
  const storedRun = storedRuns.size === 1 ? [...storedRuns][0] : undefined;

  // ── print run ──────────────────────────────────────────────────────────
  const offeredRun = incomingPrintRun ?? storedRun;
  let printRun = row.printRun;
  let printRunDisagreement = false;
  if (offeredRun !== undefined) {
    if (printRun === undefined) {
      printRun = offeredRun;
    } else if (printRun !== offeredRun) {
      printRunDisagreement = true;
    }
  }
  // A stored token that disagrees with the row's run is a disagreement too.
  if (printRun !== undefined) {
    for (const n of storedRuns) if (n !== printRun) printRunDisagreement = true;
  }

  // ── attributes ─────────────────────────────────────────────────────────
  // A raw print-run token stays only while it disagrees with the row's run
  // (or no single run could be settled); `NUM` says the rest.
  const keepRawRun = (t: string): boolean => {
    const n = printRunFromToken(t);
    return n !== undefined && (printRun === undefined || n !== printRun);
  };
  const merged: string[] = [];
  const add = (t: string) => {
    const trimmed = t.trim();
    if (trimmed && !hasToken(merged, trimmed)) merged.push(trimmed);
  };
  let numbered = false;
  for (const t of stored) {
    if (printRunFromToken(t) !== undefined) {
      numbered = true;
      if (keepRawRun(t)) add(t);
      continue;
    }
    add(t);
  }
  for (const t of incoming.attributes) {
    if (printRunFromToken(t) !== undefined) {
      numbered = true;
      if (keepRawRun(t)) add(t);
      continue;
    }
    add(t);
  }
  if (incoming.printRun !== undefined || incoming.printRunTokens.length > 0) {
    numbered = true;
    for (const t of incoming.printRunTokens) if (keepRawRun(t)) add(t);
  }
  if (callerPrintRun !== undefined) {
    numbered = true;
    if (printRun !== undefined && callerPrintRun !== printRun) {
      add(`SN${callerPrintRun}`);
    }
  }
  if (numbered) add("NUM");

  // ── typed flags ────────────────────────────────────────────────────────
  const isRookie = hasToken(merged, "RC") && row.isRookie !== true;
  const isRelic = hasToken(merged, "RELIC") && row.isRelic !== true;

  // ── features ───────────────────────────────────────────────────────────
  const features: Record<string, string> = { ...(row.features ?? {}) };
  let featuresChanged = false;
  const observed = deriveCardObservedFeatures({ attributes: merged });
  for (const key of ["shortPrint", "isRookie", "isRelic"] as const) {
    const value = observed[key];
    if (value !== undefined && featureIsEmpty(features[key])) {
      features[key] = value;
      featuresChanged = true;
    }
  }

  let autographFormatted = false;
  if (
    opts.autographFormat !== undefined &&
    isAutographFormat(opts.autographFormat) &&
    carriesAutographToken(merged)
  ) {
    const current = features.autographed;
    const answerable =
      featureIsEmpty(current) ||
      (opts.previousAutographFormat !== undefined &&
        opts.previousAutographFormat !== "" &&
        current === opts.previousAutographFormat);
    if (answerable && current !== opts.autographFormat) {
      features.autographed = opts.autographFormat;
      featuresChanged = true;
      autographFormatted = true;
    }
    // Seeded only by the write that made the card an autograph, like
    // `setCardFeature`: an operator who later cleared Signed By on a card
    // that was already formatted is not overruled by a re-run.
    if (autographFormatted && featureIsEmpty(features.signedBy)) {
      const signedBy = await signedByFromPlayers(ctx, row.playerIds);
      if (signedBy) {
        features.signedBy = signedBy;
        featuresChanged = true;
      }
    }
  }

  // ── write, only what changed ───────────────────────────────────────────
  const patch: Partial<Doc<"cardChecklist">> = {};
  const attributesChanged =
    merged.length !== stored.length ||
    merged.some((t, i) => t !== stored[i]);
  if (attributesChanged) patch.attributes = merged;
  if (printRun !== row.printRun) patch.printRun = printRun;
  if (isRookie) patch.isRookie = true;
  if (isRelic) patch.isRelic = true;
  if (featuresChanged) patch.features = features;

  // NEO-535 — a print run, RC, RELIC, SP or autograph the fill adds is a fact
  // the description carries: an unedited description follows, in this write.
  if (Object.keys(patch).length > 0) {
    const listingDescription = await refreshedListingDescription(ctx, row, patch);
    if (listingDescription !== undefined) patch.listingDescription = listingDescription;
  }

  const wrote = Object.keys(patch).length > 0;
  if (wrote) {
    patch.lastUpdated = Date.now();
    await ctx.db.patch(row._id, patch);
  }
  return { wrote, printRunDisagreement, autographFormatted };
}

/**
 * NEO-345 — the leaf's operator-supplied autograph format, when the card
 * carries AU and the leaf has one. One read, and only for an AU card.
 */
async function leafAutographFormatFor(
  ctx: MutationCtx,
  row: Doc<"cardChecklist">,
  tokens: ReadonlyArray<string>,
): Promise<"On Card" | "Sticker/Label" | undefined> {
  const incoming = normalizeBscAttributeTokensDetailed(
    boundBscAttributeTokens(tokens).tokens,
  );
  if (
    !carriesAutographToken(incoming.attributes) &&
    !carriesAutographToken(row.attributes)
  ) {
    return undefined;
  }
  const leaf = await ctx.db.get(row.selectorOptionId);
  const format = leaf?.features?.autographFormat;
  return isAutographFormat(format) ? format : undefined;
}

/**
 * NEO-90: apply the result of a BSC per-card team lookup
 * (`adapters/buysportscards.ts`'s `resolveBscCardTeam`) to a single
 * cardChecklist row. Idempotent and race-safe: re-checks `teamOnCardIds`
 * is still empty before writing, since a concurrent edit or an earlier
 * queue pass may have already resolved it.
 */
/**
 * NEO-90: read-side half of the BSC per-card team lookup — lives here
 * (not `adapters/buysportscards.ts`, which is a `"use node"` action file
 * and can't define queries) so `resolveBscCardTeam` can check whether a
 * card still needs a lookup before making the HTTP call.
 */
export const getForBscTeamCheck = internalQuery({
  args: { cardChecklistId: v.id("cardChecklist") },
  returns: v.union(
    v.object({
      bscCardId: v.string(),
      needsCheck: v.boolean(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.cardChecklistId);
    if (!row || !row.platformData?.bsc) return null;
    const needsCheck =
      (!row.teamOnCardIds || row.teamOnCardIds.length === 0) &&
      !row.teamCheckDoneAt &&
      // NEO-102: an operator already settled this card as carrying no team.
      // "Empty teams" is no longer the same statement as "not looked up yet",
      // and every path that used to treat them as one has to say which it
      // means. Spending a live BSC request to re-derive an answer a human
      // already gave is the cheapest half of the problem; the expensive half
      // is `applyBscTeamResolution` then writing a team over that answer.
      !row.teamNoneConfirmedAt;
    // NEO-137: platformData.bsc is now {ref, src}; the BSC card id is the ref.
    return { bscCardId: row.platformData.bsc.ref, needsCheck };
  },
});

/**
 * NEO-236 — bound on the marketplace string kept in `cardChecklist.bscTeamName`.
 *
 * The same 120 as `teams.MAX_TEAM_NAME_LENGTH`, and for the same reason: this
 * is what an operator would copy into the create form, so anything a team name
 * could not be is not worth keeping. Truncated rather than refused — unlike a
 * stored team name this is only a hint, and dropping the whole hint because it
 * was long helps nobody. Duplicated rather than imported to keep this module
 * off `teams.ts`'s import graph, which is what let the NEO-236 rewrite take
 * the team lookup out of here cleanly.
 *
 * NEO-335: exported so the commit, which now stamps the same hint for a card
 * whose fetch-time lookup answered, caps it at the same length.
 */
export const MAX_BSC_TEAM_NAME_LENGTH = 120;

/**
 * NEO-556 / NEO-426 — the "No Team" default's stamp for a card BSC has just
 * answered with no team (nothing on file, or the whole claim ruled "not a
 * team").
 *
 * The card's birth held the stamp back while this lookup was outstanding
 * (`noTeamCardVerdict` → `awaitingLookup`, product invariant 8). Now the data
 * is in and names no team, so a default applies: asked of the card as this
 * patch leaves it (no team, no hint, the lookup stamped), by the SAME verdict
 * the birth path asks, and vouched for by either
 *  - the card's own leaf saying No Team (NEO-556; copied down at the leaf's
 *    creation and moved by the cascade, so no walk up the chain), or
 *  - every player on the card playing a teamless HOME sport (NEO-426;
 *    `sportDefaultNoTeam`, which also refuses a card with no player or a
 *    player name still waiting on review).
 * A pending team name still holds it back. Credited to whoever set the
 * default (`stampNoTeam`); there is no operator here. The caller has already
 * returned for a card carrying a team or a ruling.
 *
 * Returns the fields to spread into the caller's patch (`{}` for none).
 */
async function noTeamDefaultStamp(
  ctx: MutationCtx,
  row: Doc<"cardChecklist">,
  now: number,
): Promise<{ teamNoneConfirmedAt?: number; teamNoneConfirmedByUserId?: string }> {
  const verdict = noTeamCardVerdict({
    teamOnCardIds: row.teamOnCardIds,
    pendingTeamNames: row.pendingTeamNames,
    teamNoneConfirmedAt: row.teamNoneConfirmedAt,
    teamCheckDoneAt: now,
    teamCheckOutcome: "answered",
    platformData: row.platformData?.bsc ? { bsc: { ref: row.platformData.bsc.ref } } : {},
  });
  if (verdict.verdict !== "stamp") return {};
  const leafDefault = teamDefaultOf(await ctx.db.get(row.selectorOptionId));
  const vouchedBy =
    leafDefault.kind === "noTeam"
      ? leafDefault.noTeamDefault
      : await createSportNoTeamReader(ctx).defaultFor({
          playerIds: row.playerIds ?? [],
          pendingPlayerNameCount: row.pendingPlayerNames?.length ?? 0,
        });
  return vouchedBy ? stampNoTeam(vouchedBy.setByUserId, now) : {};
}

export const applyBscTeamResolution = internalMutation({
  args: {
    cardChecklistId: v.id("cardChecklist"),
    /**
     * NEO-333: BSC's team value exactly as the card-listing endpoint gave it
     * (trimmed, UNSPLIT). Tried FIRST: a comma is not a reliable team
     * separator — "Korea, South" and "Scranton, Wilkes-Barre RailRiders" are
     * one team each — so when the whole string resolves to exactly one team,
     * that is the card's team and the split is never consulted. Also the
     * unmatched hint kept in `bscTeamName`.
     *
     * Empty (with no `teamNames`) means BSC had no team on file.
     */
    rawTeamName: v.string(),
    /**
     * NEO-333: the same value split on commas by the adapter
     * (`splitMarketplaceTeamNames`), in BSC's order. Used only when the whole
     * string does not resolve: on a pairings card the string names several
     * teams ("Chicago Cubs, Texas Rangers"), and each part must resolve.
     * Empty when BSC named more teams than a card can carry — the adapter
     * refuses that list rather than trimming it.
     */
    teamNames: v.array(v.string()),
    /**
     * NEO-345: the card's attribute tokens from the same answer (raw BSC
     * tokens; normalised by `applyBscAttributeFill`). Optional so a queue
     * call scheduled before this field existed still runs; absent fills
     * nothing.
     */
    attributeTokens: v.optional(v.array(v.string())),
    /** NEO-345: the print run those tokens carry, when they carry one. */
    printRun: v.optional(v.number()),
  },
  returns: v.object({
    applied: v.boolean(),
    /**
     * NEO-236: BSC named a team we do not hold, so nothing was linked.
     *
     * Replaces `teamCreated`. This path used to insert a `teams` row from
     * whatever string BSC's per-card endpoint returned — a globally-shared row
     * created by a background queue, from a marketplace string, with no
     * operator in the loop. Creation takes Location + Name now, and a queue
     * has neither, so a miss leaves the card teamless for the attention
     * walker's missing-team lane to surface.
     */
    unmatched: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.cardChecklistId);
    if (!row) return { applied: false, unmatched: false };

    // NEO-345: every call here is an ANSWER from BSC, so its attribute tokens
    // fill the card first — whatever the team branch below decides, and on
    // the early returns too (a card that already has a team still gains its
    // print run). Fill-empty, never overwrite; the team fields below are not
    // touched by it. The leaf's operator-supplied autograph format, when it
    // has one, formats an AU card; a marketplace's wording never does.
    if (args.attributeTokens !== undefined || args.printRun !== undefined) {
      const tokens = args.attributeTokens ?? [];
      await applyBscAttributeFill(ctx, row, {
        tokens,
        ...(args.printRun !== undefined ? { printRun: args.printRun } : {}),
        autographFormat: await leafAutographFormatFor(ctx, row, tokens),
      });
    }

    // NEO-102: an operator confirmed this card carries no team. A background
    // writer must never overturn that.
    //
    // Checked HERE, inside the writing mutation, on a fresh read — not at
    // enqueue time — for the same reason the `teamOnCardIds` check below is:
    // the confirmation can land while this lookup is in flight (the queue
    // walks a whole set at one request every 300ms, and the operator is
    // working the same checklist at the same time). An enqueue-time filter
    // would be checked minutes earlier and would be exactly the race.
    //
    // Stamps `teamCheckDoneAt` on the way out, mirroring the early return
    // below: the lookup HAS now been and gone for this card, and stamping it
    // also takes the row out of `enqueueBscTeamBackfill`'s scan.
    if (row.teamNoneConfirmedAt) {
      if (!row.teamCheckDoneAt) {
        await ctx.db.patch(row._id, {
          teamCheckDoneAt: Date.now(),
          teamCheckOutcome: "answered",
        });
      }
      return { applied: false, unmatched: false };
    }

    if (row.teamOnCardIds && row.teamOnCardIds.length > 0) {
      if (!row.teamCheckDoneAt) {
        await ctx.db.patch(row._id, {
          teamCheckDoneAt: Date.now(),
          teamCheckOutcome: "answered",
        });
      }
      return { applied: false, unmatched: false };
    }

    // NEO-333: trimmed, blanks dropped, exact repeats dropped. The adapter has
    // already done all three; this is the mutation not trusting its caller's
    // shape, not a second parser — it never splits a part further.
    const rawTeamName = args.rawTeamName.trim();
    // Security review N2: bounded BEFORE the dedupe loop, so an oversized
    // array costs nothing here. Over `MAX_CARD_TEAMS` the split is unusable —
    // no card may carry that many teams (`selectorOptions.updateCard` refuses
    // the same array) — so it is set aside unread; the raw string still gets
    // its whole-name match below, and a miss lands as unmatched, not as "no
    // team on file", because BSC did name teams.
    const splitOverCap = args.teamNames.length > MAX_CARD_TEAMS;
    const teamNames: string[] = [];
    if (!splitOverCap) {
      for (const raw of args.teamNames) {
        const name = raw.trim();
        if (name && !teamNames.includes(name)) teamNames.push(name);
      }
    }
    if (!rawTeamName && !splitOverCap && teamNames.length === 0) {
      // No team on file for this card (insert/subset cards like League
      // Leaders) — remember we checked so it's never re-enqueued.
      //
      // NEO-345: and clear any hint an EARLIER answer left. BSC now says it
      // has no team, so a stale "The listing names …" from before (or from a
      // value that was really the attribute label, "AU  SN1") would contradict
      // the answer the operator is about to act on.
      //
      // NEO-556 / NEO-426: and the leaf's "No Team" (or the players' teamless
      // sport), now that BSC has named none.
      const now = Date.now();
      await ctx.db.patch(row._id, {
        teamCheckDoneAt: now,
        teamCheckOutcome: "answered",
        bscTeamName: undefined,
        ...(await noTeamDefaultStamp(ctx, row, now)),
      });
      return { applied: false, unmatched: false };
    }

    // NEO-333: what an unmatched card keeps as its hint — BSC's raw value,
    // exactly as it was given, so the operator sees what the marketplace said
    // rather than our reading of it. The join is only a fallback for a caller
    // that sent parts without the raw string. See the unmatched branch below
    // for why a hint is kept at all.
    const hint = (rawTeamName || teamNames.join(", ")).slice(
      0,
      MAX_BSC_TEAM_NAME_LENGTH,
    );
    const sportId = await findSportForSelectorOption(ctx, row.selectorOptionId);
    if (!sportId) {
      // Same ambiguous case backfillTeamToOnCardIds guards against. Leave
      // teamCheckDoneAt unset so a future retry can still pick this up
      // once the ancestor chain is fixed.
      console.warn(
        `[applyBscTeamResolution] skipping ambiguous row id=${row._id}` +
          ` selectorOptionId=${row.selectorOptionId}`,
      );
      return { applied: false, unmatched: false };
    }

    // NEO-236: the shared identity lookup on each of BSC's full team strings,
    // so a row already split into location + nickname still matches.
    //
    // NEO-254: narrowed by the set's year — the name may name several eras,
    // and BSC's string carries none of that. Read once: it is the set's year,
    // the same for every part.
    //
    // NEO-602: each name is resolved against THIS card's players too
    // (`resolveCardTeamName`) — "Oakland Athletics" on a Rickey Henderson card
    // is the 1968–2024 franchise, not the 2025– Athletics whose alias it is.
    //
    // Unattended: the players' answer links even where the card year
    // disagrees with it (`CardTeamResolution.agreesWithYear`); only a null
    // (a tie, disagreeing evidence, an alias-only year pick) stays unmatched.
    //
    // NEO-333: all or nothing. Every part must resolve to exactly one team
    // (`resolveCardTeamName` returns null for "unknown" and for "several
    // eras the year and the players did not separate" alike) or NOTHING is
    // linked. Jason,
    // 2026-10-10: "keep unmatched". A subset would be wrong in a way nobody
    // sees: the card would have a team, so it would leave the missing-team
    // lane, and the operator would never learn the second team was dropped.
    // The first miss ends the walk — the answer cannot change after it.
    const setYear = await findSetYearForSelectorOption(
      ctx,
      row.selectorOptionId,
    );

    // NEO-333: WHOLE NAME FIRST (Jason, 2026-10-10). The raw string as one
    // team name or alias; exactly one hit settles the card, ANY hit means the
    // split is never consulted, and only a whole string matching nothing
    // falls through to it. Skipped when the split is just the raw string again —
    // the loop below asks the identical question.
    const splitIsJustRaw =
      teamNames.length === 1 && teamNames[0] === rawTeamName;
    if (
      rawTeamName &&
      !splitIsJustRaw &&
      rawTeamName.length <= MAX_BSC_TEAM_NAME_LENGTH
    ) {
      const { teamId: wholeTeamId, candidates: wholeCandidates } =
        await resolveCardTeamName(ctx, sportId, rawTeamName, setYear, {
          cardPlayerIds: [row.playerIds ?? []],
        });
      if (wholeTeamId) {
        await ctx.db.patch(row._id, {
          ...(await descriptionForTeams(ctx, row._id, [wholeTeamId])),
          teamOnCardIds: [wholeTeamId],
          teamCheckDoneAt: Date.now(),
          teamCheckOutcome: "answered",
          // Same as the split path's success below: a resolved team leaves
          // the hint nothing to say.
          bscTeamName: undefined,
          lastUpdated: Date.now(),
        });
        // NEO-358 — the team → cards index follows the card.
        await syncCardTeamLinks(ctx, row, [wholeTeamId], {
          leagueCache: newCardLeagueCache(),
        });
        return { applied: true, unmatched: false };
      }
      // The whole string names a team NB holds, but not one this card can
      // link: several rows the set year cannot separate, or only a later era.
      // It is still ONE team, so the split is never tried — cutting a known
      // name at its comma could link two unrelated teams. Unmatched with the
      // raw hint, the same landing as any unresolved name: the operator picks
      // the era in the missing-team lane.
      if (wholeCandidates.length > 0) {
        await ctx.db.patch(row._id, {
          teamCheckDoneAt: Date.now(),
          teamCheckOutcome: "answered",
          bscTeamName: hint || undefined,
        });
        return { applied: false, unmatched: true };
      }
    }

    // NEO-333: the split. No parts (BSC named more teams than a card can
    // carry, so the adapter refused the list, or a caller sent more than
    // `MAX_CARD_TEAMS` and N2 above set it aside) cannot resolve: the same
    // landing as an unknown team — stamped, hinted with the raw value, left
    // for the operator. NOT "no team on file": BSC did name a team.
    const resolvedTeamIds: Id<"teams">[] = [];
    let allResolved = teamNames.length > 0;
    for (const teamName of allResolved ? teamNames : []) {
      const { teamId } = await resolveCardTeamName(
        ctx,
        sportId,
        teamName,
        setYear,
        { cardPlayerIds: [row.playerIds ?? []] },
      );
      if (!teamId) {
        allResolved = false;
        break;
      }
      // Two parts can land on one row (a name and its alias); the card links
      // that team once. Order is BSC's, for display only.
      if (!resolvedTeamIds.includes(teamId)) resolvedTeamIds.push(teamId);
    }

    if (!allResolved) {
      // NEO-236: link-or-leave. No insert, and no team on the card.
      //
      // `teamCheckDoneAt` is still STAMPED, and that is deliberate rather than
      // an oversight. It records "the BSC lookup has been and gone for this
      // card", which is true — the answer came back, we simply have no team to
      // point at. Leaving it unset would put the row straight back into
      // `enqueueBscTeamBackfill`'s scan and spend a live BSC request per pass
      // to re-learn the same string, forever. Contrast the `!sportId` branch
      // above, which leaves it unset precisely because that IS a retryable
      // condition (a broken ancestor chain an operator can fix).
      //
      // The card is not lost: an empty `teamOnCardIds` with no
      // `teamNoneConfirmedAt` is exactly what the attention walker's
      // missing-team lane looks for, and the operator resolves it there.
      //
      // BSC's string is KEPT on the row as `bscTeamName`. Discarding it left
      // the operator staring at a card with no team and no clue which team it
      // was meant to be — the marketplace had the answer and we threw it away
      // on the way to not trusting it. `MissingTeamFixer` renders it as
      // "Marketplace says: …" so they can create the right Location + Name.
      //
      // A hint, never a team. It is deliberately NOT written to
      // `pendingTeamNames`, which `features/cardAttention.ts` reads as the
      // card HAVING a team — that would take the card out of the very lane
      // this branch exists to leave it in. Capped at the same length a stored
      // team name is capped at: this is a third party's string reaching an
      // admin screen, and nothing downstream should have to bound it again.
      //
      // NEO-333: the hint is BSC's raw value — on a multi-team card that
      // includes the parts that DID resolve, so the operator sees the whole
      // card's claim, not just the half we could not place.
      await ctx.db.patch(row._id, {
        teamCheckDoneAt: Date.now(),
        teamCheckOutcome: "answered",
        // No hint at all when there is nothing displayable to keep (the raw
        // string was over the adapter's cap AND the split was over
        // `MAX_CARD_TEAMS`): an empty "Marketplace says:" helps nobody.
        bscTeamName: hint || undefined,
      });
      return { applied: false, unmatched: true };
    }

    await ctx.db.patch(row._id, {
      ...(await descriptionForTeams(ctx, row._id, resolvedTeamIds)),
      teamOnCardIds: resolvedTeamIds,
      teamCheckDoneAt: Date.now(),
      teamCheckOutcome: "answered",
      // A matched card has a real team now, so the hint has nothing left to
      // say — and a stale "Marketplace says: …" beside a resolved team reads
      // as a disagreement rather than as history.
      bscTeamName: undefined,
      lastUpdated: Date.now(),
    });
    // NEO-358 — the team → cards index follows the card.
    await syncCardTeamLinks(ctx, row, resolvedTeamIds, {
      leagueCache: newCardLeagueCache(),
    });

    return { applied: true, unmatched: false };
  },
});

/**
 * NEO-535 — the description half of a resolved-team write: the card's
 * unedited description rebuilt to name its teams (`cardDescriptionRefresh`),
 * as a patch fragment, or nothing. Read FRESH, not from the row the mutation
 * started with: the attribute fill above may already have written the card.
 */
async function descriptionForTeams(
  ctx: MutationCtx,
  cardId: Id<"cardChecklist">,
  teamOnCardIds: Array<Id<"teams">>,
): Promise<{ listingDescription?: string }> {
  const card = await ctx.db.get(cardId);
  if (!card) return {};
  const listingDescription = await refreshedListingDescription(ctx, card, { teamOnCardIds });
  return listingDescription !== undefined ? { listingDescription } : {};
}

/** NEO-345 — the token a live re-ask must carry. */
const REASK_CONFIRM_TOKEN = "REASK";

/** NEO-345 — the deployment-level arm for a live re-ask. */
const REASK_ENV_FLAG = "ALLOW_BSC_TEAM_REASK";

function reaskDeploymentIsArmed(): boolean {
  const value = process.env[REASK_ENV_FLAG];
  return value === "1" || value === "true";
}

/**
 * NEO-90: one-shot operator trigger to backfill team data for sets synced
 * BEFORE the BSC per-card enrichment queue existed. No index exists for
 * "has platformData.bsc, missing teamOnCardIds AND teamCheckDoneAt", so this
 * pages through the table with a real cursor and filters in JS per page.
 *
 * MUST use a cursor (not a blind `.take(N)` re-scanned from the top every
 * call) — this table keeps growing from ongoing syncs, and a fixed "first N"
 * window's boundary can land in the middle of a single batch insert (a
 * commitCardChecklist call inserts many rows with near-identical
 * `_creationTime`s), permanently stranding whichever rows fall just past the
 * cutoff no matter how many times the migration reruns. Confirmed this
 * exact failure mode in practice: 47 of 335 cards in one set sat right at a
 * `.take(1000)` boundary and were unreachable by any rerun until this fix.
 * Operator reruns passing the returned `continueCursor` until `isDone`.
 *
 * IMPORTANT — do not rerun before the previous call's queue has drained.
 * Enqueued cards only stop looking "eligible" once the `bscTeamPool` lane
 * actually resolves them (one every BSC_TEAM_ENRICH_DELAY_MS, serially), which
 * takes `enqueued * BSC_TEAM_ENRICH_DELAY_MS` in the best case. Rerunning
 * sooner re-scans the same still-pending rows and schedules a second,
 * overlapping queue for them — harmless (each resolve is idempotent and a
 * duplicate just no-ops once the other chain gets there first) but wastes a
 * real live HTTP call to BSC per duplicate. `estimatedDrainMs` below is that
 * lower bound — wait at least that long before calling again.
 *
 * NEO-345 — `mode: "reask"` re-asks BSC for the cards whose lookup finished
 * WITHOUT an answer (gave up after its retries, or finished before the
 * outcome was recorded), and `dryRun: true` reports each page's counts while
 * writing and scheduling nothing. A re-ask is ARMED: it is a dry run by
 * default, and runs live only with `confirm: "REASK"` on a deployment with
 * `ALLOW_BSC_TEAM_REASK=1` (set it, run, remove it):
 *
 *   npx convex run cardChecklist:enqueueBscTeamBackfill '{"mode":"reask"}'
 *   npx convex env set ALLOW_BSC_TEAM_REASK 1
 *   npx convex run cardChecklist:enqueueBscTeamBackfill '{"mode":"reask","confirm":"REASK"}'
 *   npx convex env remove ALLOW_BSC_TEAM_REASK
 *
 * The drain rule above applies to both modes:
 * a re-asked card's stamp is cleared when it is queued, so until the queue
 * answers it an "unchecked" run would select it too. A re-ask run never
 * selects it twice — it is no longer stamped.
 */
export const enqueueBscTeamBackfill = internalMutation({
  args: {
    /**
     * Cap on rows enqueued per page. Defaults to 200; anything above 1000
     * (the page size) means the whole page.
     */
    batchSize: v.optional(v.number()),
    /** Pagination cursor from a previous call's `continueCursor`. Omit/null to start from the beginning. */
    cursor: v.optional(v.union(v.string(), v.null())),
    /**
     * NEO-345 — which cards to ask BSC about.
     *  - "unchecked" (default, the original behaviour): BSC-linked cards with
     *    no team whose lookup never ran (`teamCheckDoneAt` unset).
     *  - "reask": BSC-linked cards with no team whose lookup DID finish, but
     *    either gave up after its retries (`teamCheckOutcome: "gaveUp"`) or
     *    finished before the outcome was recorded (absent). Their stamp and
     *    outcome are cleared and they are queued exactly as an unchecked card
     *    is. A card BSC answered ("answered") is never re-asked: asking again
     *    would only re-learn the same answer.
     * Either way a card an operator settled (`teamNoneConfirmedAt`) or one
     * with a team is never selected.
     */
    mode: v.optional(v.union(v.literal("unchecked"), v.literal("reask"))),
    /**
     * NEO-628 — the Clerk subject the cards are queued for, an operator-run
     * backfill's own choice (it has no caller identity). On the fake the cards
     * are asked in that user's namespace and behind that user's BSC call gate;
     * absent (the usual run) is the deployment's own domain.
     */
    queuedBy: v.optional(v.string()),
    /**
     * NEO-345 — write and schedule nothing; report what this page holds.
     * Run it first: the counts say how many live BSC requests an armed run
     * of either mode would spend. Defaults to FALSE in "unchecked" mode (its
     * original behaviour) and to TRUE in "reask" mode, which is armed (see
     * `confirm`).
     */
    dryRun: v.optional(v.boolean()),
    /**
     * NEO-345 — "reask" only: a live re-ask clears stamps on finished cards
     * and spends a live BSC request per card, so it takes two independent
     * arms, as the house backfills do: this token (`"REASK"`) AND the
     * deployment flag `ALLOW_BSC_TEAM_REASK=1`. Either one missing writes and
     * schedules nothing. Ignored in "unchecked" mode.
     */
    confirm: v.optional(v.string()),
  },
  returns: v.object({
    /** Cards queued for a BSC lookup by THIS call. Always 0 on a dry run. */
    enqueued: v.number(),
    /**
     * NEO-345 — cards in this page the mode selected (up to batchSize):
     * queued on an armed run, what WOULD be queued on a dry run.
     */
    selected: v.number(),
    /** Eligible rows in THIS page beyond batchSize — bump batchSize if nonzero. */
    remaining: v.number(),
    isDone: v.boolean(),
    continueCursor: v.string(),
    /** Minimum ms to wait before calling this again — see doc comment above. */
    estimatedDrainMs: v.number(),
    dryRun: v.boolean(),
    /**
     * NEO-345 — a re-ask carried the confirm token on a deployment without
     * `ALLOW_BSC_TEAM_REASK`, so it ran as a dry run instead.
     */
    refusedForFlag: v.boolean(),
    /**
     * NEO-345 — this page's BSC-linked cards with no team and no operator
     * "no team" ruling, by why they have none. Counted on every call, armed
     * or dry, before any write.
     */
    counts: v.object({
      /** Lookup finished before `teamCheckOutcome` existed. */
      legacyNoOutcome: v.number(),
      /** Every retry failed; the queue stopped asking. */
      gaveUp: v.number(),
      /** BSC answered and named no team. */
      answeredNoTeam: v.number(),
      /** BSC answered with a team NB could not link (a hint is kept). */
      answeredHinted: v.number(),
      /** PR 451 — the publisher checklist answered and named no team. Never re-asked. */
      checklistNoTeam: v.number(),
      /** The lookup never ran. */
      unchecked: v.number(),
    }),
  }),
  handler: async (ctx, args) => {
    const PAGE_SIZE = 1000;
    const requestedBatchSize = args.batchSize ?? 200;
    if (!Number.isInteger(requestedBatchSize) || requestedBatchSize < 1) {
      throw new ConvexError("batchSize must be a whole number of at least 1");
    }
    // A page holds at most PAGE_SIZE rows, so a larger cap is the page.
    const batchSize = Math.min(requestedBatchSize, PAGE_SIZE);
    const mode = args.mode ?? "unchecked";
    // NEO-345 — "unchecked" keeps its original contract (live unless asked
    // otherwise). "reask" is dry unless BOTH arms are present.
    let dryRun = args.dryRun === true;
    let refusedForFlag = false;
    if (mode === "reask") {
      const intendsToWrite =
        args.dryRun !== true && args.confirm === REASK_CONFIRM_TOKEN;
      refusedForFlag = intendsToWrite && !reaskDeploymentIsArmed();
      dryRun = !intendsToWrite || refusedForFlag;
    }
    const page = await ctx.db
      .query("cardChecklist")
      .paginate({ cursor: args.cursor ?? null, numItems: PAGE_SIZE });

    const counts = {
      legacyNoOutcome: 0,
      gaveUp: 0,
      answeredNoTeam: 0,
      answeredHinted: 0,
      checklistNoTeam: 0,
      unchecked: 0,
    };
    const candidateIds: Id<"cardChecklist">[] = [];
    let remaining = 0;
    for (const row of page.page) {
      const teamless =
        !!row.platformData?.bsc &&
        (!row.teamOnCardIds || row.teamOnCardIds.length === 0) &&
        // NEO-102: never re-derive a team for a card an operator settled as
        // teamless. `applyBscTeamResolution` re-checks this too, so a row
        // enqueued before the confirmation still cannot be overwritten — this
        // clause is what stops the pointless live BSC request.
        !row.teamNoneConfirmedAt;
      if (!teamless) continue;

      if (!row.teamCheckDoneAt) counts.unchecked += 1;
      else if (row.teamCheckOutcome === "gaveUp") counts.gaveUp += 1;
      else if (row.teamCheckOutcome === "answered") {
        if (row.bscTeamName) counts.answeredHinted += 1;
        else counts.answeredNoTeam += 1;
      } else if (row.teamCheckOutcome === "checklist") counts.checklistNoTeam += 1;
      else counts.legacyNoOutcome += 1;

      // PR 451 (NEO-478): a card the publisher checklist answered is never
      // re-asked either: BSC was not the source, and the checklist's answer
      // is the operator's own.
      const needsCheck =
        mode === "unchecked"
          ? !row.teamCheckDoneAt
          : !!row.teamCheckDoneAt &&
            row.teamCheckOutcome !== "answered" &&
            row.teamCheckOutcome !== "checklist";
      if (!needsCheck) continue;
      if (candidateIds.length < batchSize) {
        candidateIds.push(row._id);
      } else {
        remaining += 1;
      }
    }

    if (!dryRun && candidateIds.length > 0) {
      if (mode === "reask") {
        // The lookup is owed again: clear the stamp and its outcome together,
        // so `getForBscTeamCheck` lets the queue ask and the card reads as
        // "waiting on the automatic answer" until it does. Nothing else on
        // the row is touched — any team, hint or ruling stays as it was, and
        // the queue's own guards re-check them on a fresh read.
        for (const id of candidateIds) {
          await ctx.db.patch(id, {
            teamCheckDoneAt: undefined,
            teamCheckOutcome: undefined,
          });
        }
      }
      // PR 451 (NEO-487) — onto the one-slot `bscTeamPool` lane.
      await ctx.scheduler.runAfter(
        0,
        internal.bscTeamPool.enqueueBscTeamChecks,
        {
          cardChecklistIds: candidateIds,
          ...queuedByField(args.queuedBy),
        },
      );
    }

    // Not imported directly — adapters/buysportscards.ts is a "use node"
    // action file and this one isn't; cross-runtime imports of a directive
    // file are unsupported in Convex's bundler. Keep in sync with
    // BSC_TEAM_ENRICH_DELAY_MS there.
    const BSC_TEAM_ENRICH_DELAY_MS = 1_700;
    const enqueued = dryRun ? 0 : candidateIds.length;
    console.log(
      JSON.stringify({
        msg: "bsc_team_backfill_page",
        platform: "bsc",
        operation: "enqueueBscTeamBackfill",
        mode,
        dryRun,
        refusedForFlag,
        selected: candidateIds.length,
        enqueued,
        remaining,
        ...counts,
      }),
    );
    return {
      enqueued,
      selected: candidateIds.length,
      remaining,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
      estimatedDrainMs: enqueued * BSC_TEAM_ENRICH_DELAY_MS,
      dryRun,
      refusedForFlag,
      counts,
    };
  },
});

// ===========================================================================
// NEO-102 — reconciling a card that has no team
// ===========================================================================

/**
 * NEO-102 — record that an operator has decided this card carries no team.
 *
 * ## Server-stamped, deliberately
 *
 * The only argument is the card. `teamNoneConfirmedAt` and
 * `teamNoneConfirmedByUserId` are written from `Date.now()` and the
 * `requireAdmin` return value — a timestamp on a client-supplied argument
 * would be operator-review suppression the client can mint for itself, and
 * this flag's whole job is to suppress both the BSC background lookup and the
 * "missing team" badge. Nothing on any client path anywhere in this feature
 * carries a timestamp.
 *
 * ## Refuses on a card that HAS teams
 *
 * Re-read inside the mutation and checked against the row as it stands, not
 * against whatever the client last rendered — the same shape as
 * `applyBscTeamResolution`'s guards. "No team" and "these three teams" cannot
 * both be true, and the operator clicking this on a stale render must not be
 * the way that contradiction gets written. `confirmed: false` is the honest
 * answer, not an error: the card already has the thing the operator was being
 * asked about.
 *
 * ## Idempotent, and does not re-stamp
 *
 * A second call on an already-confirmed card writes nothing and reports
 * `stamped: false`. That is not just tidiness: in Convex, patching a row even
 * with identical data invalidates every query that read it, which re-renders
 * the checklist (see `valuesDeepEqual`'s note in selectorOptions.ts). It also
 * keeps the audit stamp pointing at whoever actually made the call.
 *
 * `lastUpdated` is deliberately NOT touched. This is suppression bookkeeping,
 * not card content — the same treatment `teamCheckDoneAt` gets — and bumping
 * it would invalidate the `baseVersion` of a sync review the operator may have
 * open in another tab, turning an unrelated accepted diff stale.
 */
export const confirmCardNoTeam = mutation({
  args: {
    cardId: v.id("cardChecklist"),
    /**
     * NEO-645 T4 — the Tidy Up walk's answer: rebuild the title and
     * description from the card as it stands, always. Only the walk sends it.
     */
    regenerateListing: v.optional(v.literal(true)),
  },
  returns: v.object({
    /** The row now carries a "no team" confirmation. */
    confirmed: v.boolean(),
    /** THIS call wrote it. False when it was already confirmed, or refused. */
    stamped: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const userId = await requireAdmin(ctx);

    const row = await ctx.db.get(args.cardId);
    if (!row) return { confirmed: false, stamped: false };
    if (row.teamOnCardIds && row.teamOnCardIds.length > 0) {
      return { confirmed: false, stamped: false };
    }
    if (row.teamNoneConfirmedAt) {
      if (args.regenerateListing) await regenerateListingNow(ctx, row._id);
      return { confirmed: true, stamped: false };
    }

    // NEO-556 — the one stamp builder every writer shares.
    await ctx.db.patch(row._id, stampNoTeam(userId, Date.now()));
    if (args.regenerateListing) await regenerateListingNow(ctx, row._id);
    return { confirmed: true, stamped: true };
  },
});

// ===========================================================================
// NEO-335 — team suggestions for the cards a sync is ABOUT to save
// ===========================================================================

/**
 * The most players one `teamSuggestionsForPreview` call answers for.
 *
 * Over-length is REFUSED, not truncated — a short answer would read as "no
 * evidence" for the players it dropped. The wizard asks in slices of this size
 * (one subscription per slice), so it never trips this; a direct call that
 * does gets a count, never the names.
 */
export const TEAM_SUGGESTION_MAX_PLAYERS = 32;

/**
 * How many of one player's card links a call reads, newest first.
 *
 * The stored tiers want the player's cards under at most three nodes of ONE
 * set, but `cardPlayerLinks` can only be asked "this player's cards in this
 * sport", which for a star is every set he appears in. Newest first, because
 * the set being synced — and its base, synced just before it — are the
 * player's most recent cards far more often than not. A player whose evidence
 * sits past this window simply falls through to the career tiers: the bound
 * can cost a suggestion, never produce a wrong one.
 *
 * Per call: 32 players × (24 links + 24 cards + the player + the name lookup)
 * is ~1,700 reads, plus each player's career teams (NEO-335 Phase 2 reads
 * them to rank and sport-check the window; capped at 24 per player, cached
 * across players, so a set's shared clubs are read once) and their leagues.
 * Team-name lookups (`teamNames`) arrive in their own calls from the browser,
 * never stacked on a full player slice.
 */
export const TEAM_SUGGESTION_LINKS_PER_PLAYER = 24;

/** How many unselected candidates one player may offer. */
export const TEAM_SUGGESTION_MAX_CANDIDATES = 6;

/** A name past this is not a player name; it is not looked up at all. */
const TEAM_SUGGESTION_MAX_NAME_LENGTH = 200;

/** How many of the set's children are read to find its base checklist. */
const TEAM_SUGGESTION_SET_CHILD_SCAN = 64;

/**
 * NEO-335 Phase 2 — how many team NAMES one call resolves (`teamNames`).
 * Refused past it, like the players: the browser slices at this size, and its
 * own constant is pinned to this one by the convex test.
 */
export const TEAM_SUGGESTION_MAX_TEAM_NAMES = 32;

/**
 * NEO-591 — how many of one call's names get the location leg (`locationNames`
 * below), and how many `search_name` hits each reads. Each is one search plus
 * a handful of reads, so they are bounded apart from the 32 names: a name past
 * the first few simply gets its full-name matches alone.
 */
export const TEAM_SUGGESTION_MAX_LOCATION_NAMES = 8;
const TEAM_SUGGESTION_LOCATION_HITS = 16;

/**
 * How many distinct career teams of one player are read to rank and
 * sport-check them. A stint whose team is past this is kept unverified (rank
 * "other"): dropping it could turn a two-team window into a false single
 * answer, keeping it can only cost one.
 */
const TEAM_SUGGESTION_CAREER_TEAMS_READ = 24;

/**
 * NEO-335 / NEO-645 — the nodes the stored team tiers read (`sameNode`,
 * `parallelOf`, `baseSet`): the sport the cards are filed under, the node a
 * parallel copies, and the set's base checklist (the variantType whose title
 * is the word "Base", `variantTypeKind`; exactly one, or the tier is skipped).
 */
export async function storedTierNodes(
  ctx: Pick<QueryCtx, "db">,
  node: Doc<"selectorOptions">,
): Promise<{
  sportId: Id<"selectorOptions"> | undefined;
  parallelOfNodeId: Id<"selectorOptions"> | null;
  baseNodeId: Id<"selectorOptions"> | null;
}> {
  // One walk up the chain for the facts it holds: the sport (the card
  // links are filed under the CARD's sport) and the setName row whose
  // children hold the base checklist.
  let sportId: Id<"selectorOptions"> | undefined;
  let setNameNode: Doc<"selectorOptions"> | null = null;
  {
    let cursor: Doc<"selectorOptions"> | null = node;
    let depth = 0;
    while (cursor && depth < 16) {
      if (cursor.level === "setName" && !setNameNode) setNameNode = cursor;
      if (cursor.level === "sport") {
        sportId = cursor._id;
        break;
      }
      cursor = cursor.parentId ? await ctx.db.get(cursor.parentId) : null;
      depth += 1;
    }
  }
  const parallelOfNodeId = node.level === "parallel" && node.parentId ? node.parentId : null;
  let baseNodeId: Id<"selectorOptions"> | null = null;
  if (setNameNode) {
    const bases: Array<Id<"selectorOptions">> = [];
    for (const childId of (setNameNode.children ?? []).slice(0, TEAM_SUGGESTION_SET_CHILD_SCAN)) {
      const child = await ctx.db.get(childId);
      if (child?.level === "variantType" && variantTypeKind(child) === "base") {
        bases.push(child._id);
      }
    }
    if (bases.length === 1) baseNodeId = bases[0];
  }
  return { sportId, parallelOfNodeId, baseNodeId };
}

/**
 * NEO-639 — how many of one player's DATED stints come back as `stints`, in
 * the order the row holds them. Display only (the Teams step prints a
 * player's years beside a team chip), so a career past this simply loses the
 * years on its latest chips, never a chip.
 */
export const TEAM_SUGGESTION_MAX_STINTS = 48;

const teamSuggestionTierValidator = v.union(
  v.literal("sameNode"),
  v.literal("parallelOf"),
  v.literal("baseSet"),
  v.literal("oneTeamInWindow"),
  v.literal("preferredInWindow"),
  v.literal("oneTeamCareerInLeague"),
);

const suggestedTeamValidator = v.object({
  teamId: v.id("teams"),
  /** NEO-236: the FULL name — "Padres" does not say which Padres. */
  name: v.string(),
  /** The team's livery, for the chip. Absent for teams ESPN does not carry. */
  colors: v.optional(
    v.object({
      primary: v.optional(v.string()),
      secondary: v.optional(v.string()),
    }),
  ),
  /**
   * NEO-335 Phase 2 (C2b) — the team's fit to the set: 0 the set's league, 1
   * the set's level, 2 anything else. Present only when the set HAS a league;
   * absent means "nothing to prefer", which the browser ranks as 2.
   */
  rank: v.optional(v.number()),
});

type SuggestedTeam = {
  teamId: Id<"teams">;
  name: string;
  colors?: { primary?: string; secondary?: string };
  rank?: number;
};

type SuggestionStint = { teamId: Id<"teams">; fromYear: number; toYear?: number };

type PlayerSuggestionResult = {
  playerId: Id<"players"> | null;
  answer: { tier: TeamSuggestionTier; teams: Array<SuggestedTeam> } | null;
  candidates: Array<SuggestedTeam>;
  /** NEO-639 — see "Stints" on `teamSuggestionsForPreview`. Absent = none. */
  stints?: Array<SuggestionStint>;
};

const suggestionStintValidator = v.object({
  teamId: v.id("teams"),
  fromYear: v.number(),
  toYear: v.optional(v.number()),
});

/**
 * NEO-335 — per-player team evidence for the entity review wizard's Teams
 * step, BEFORE the cards are saved.
 *
 * The wizard holds the confirmed cards in client state; some will save with
 * no team (SportLots never emits one, a BSC blank, a name skipped as "not a
 * team"). For the players on those cards, this answers "is there exactly one
 * team?" from what NB already holds:
 *
 *  - stored rows — the player's own cards under the node being synced, the
 *    node it copies (a parallel), and the set's base checklist;
 *  - the player row — exactly one team in the window `[setYear - 1, setYear]`,
 *    or, in a tie, the one team the set's league prefers (C2, C2b); with
 *    nothing in the window, a one-team career whose team is in the set's own
 *    league (legends).
 *
 * The tiers, and why an ambiguous stored tier stops the search, are
 * `lib/teamFill.ts`'s. Batch evidence (another card in the same preview) and
 * players CREATED in this wizard are answered in the browser — neither has a
 * row to read yet.
 *
 * Each entry names a player by `playerId` (linked in the wizard) or by `name`
 * (a checklist name that resolved without review). A name is resolved the
 * commit's way for an exactly-one match — `sameNamePlayers` in the set's
 * sport — and anything else is no evidence, never a guess at which of two
 * same-name players is meant. Results come back in input order.
 *
 * ## The set's leagues (C2b, NEO-569)
 *
 * The node's effective `leagueIds` — NB's own league rows, picked at set
 * level (`lib/selectorLeagues.effectiveSetLeagueIds`: the node's own, else
 * the nearest ancestor's up to the set). Any-of: a career team ranks 0 when
 * it is in any of them, 1 when its league's level is any of theirs, 2
 * otherwise, to break a window tie and to order candidates. No league →
 * nothing is ranked and nothing is tie-broken. Undated career stints reach
 * the career rule too, which counts one only when it is the player's one team
 * in the set's leagues (`teamFill.careerTeamVerdict`).
 *
 * ## `teamNames` — names resolved to existing NB teams, as CHOICES
 *
 * Optional, aligned with the input. Each name is looked up the identity way
 * (`findTeamsByFullName`: the name and alias legs, every era) in the set's
 * sport, and every row it finds comes back ranked, the one whose era covers
 * the set year first. Two callers in the browser: a listing's printed team
 * name that NB could not resolve (invariant 8 — shown as choices, never
 * pre-filled), and a wizard-created player's career team that names an
 * existing team (so it can be ranked). Nothing is created and nothing is
 * picked here.
 *
 * ## Stints — the player's years, for the chips (NEO-639)
 *
 * Each player found also comes back with `stints`: his DATED career stints
 * (`teamId`, `fromYear`, `toYear` when closed), in the order his row holds
 * them, capped at `TEAM_SUGGESTION_MAX_STINTS`, at teams this call has already
 * read and found in the set's sport (the career's first
 * `TEAM_SUGGESTION_CAREER_TEAMS_READ` teams, and every team it suggests), so
 * they cost no extra reads. Display
 * only: the Teams step prints a player's years with a team beside every chip it
 * does not pre-fill, so the operator can tell two choices apart. Undated stints
 * are left out (they have no years to print). `stints` is absent when there
 * are none, and for an entry with no player (an ambiguous or unknown name).
 *
 * NEO-591: `locationNames` — a subset of `teamNames` that is ALSO read the
 * location way: the sport's teams whose location is the name ("Oklahoma", the
 * place of the Oklahoma Sooners, a name no row holds whole) join that name's
 * rows, as choices. It is asked for every name a listing printed, since a
 * checklist may print a team as its place.
 *
 * Suggestions only: nothing here writes, and nothing reads a marketplace
 * value or name — every key is an NB id, or the Base variant type read from
 * its title (`variantTypeKind`, NEO-334: a variant type's title is its kind).
 * Whether a suggestion may PRE-FILL a card is the browser's call per card
 * (`teams-on-cards.ts`), because only it can see what the card's listing said.
 */
export const teamSuggestionsForPreview = query({
  args: {
    /** The node the incoming cards will be saved under. */
    selectorOptionId: v.id("selectorOptions"),
    players: v.array(
      v.object({
        playerId: v.optional(v.id("players")),
        name: v.optional(v.string()),
      }),
    ),
    /** Team names to resolve to existing NB teams. See "teamNames" above. */
    teamNames: v.optional(v.array(v.string())),
    /** NEO-591 — names in `teamNames` that also get the location leg. */
    locationNames: v.optional(v.array(v.string())),
  },
  returns: v.object({
    /** The year the career tiers compared against, so the browser's own
     *  career answer (players created in the wizard) uses the same one. */
    setYear: v.union(v.number(), v.null()),
    /** The set's sport — the browser's team search and New Team dialog file
     *  under it, and the commit refuses any other. */
    sportId: v.union(v.id("selectorOptions"), v.null()),
    /** NEO-569 — the set's effective leagues (C2b, any-of), in the set's order. */
    setLeagueIds: v.array(v.id("leagues")),
    /** The first of `setLeagueIds`, or null: kept for a bundle older than NEO-569. */
    setLeagueId: v.union(v.id("leagues"), v.null()),
    players: v.array(
      v.object({
        playerId: v.union(v.id("players"), v.null()),
        answer: v.union(
          v.null(),
          v.object({
            tier: teamSuggestionTierValidator,
            teams: v.array(suggestedTeamValidator),
          }),
        ),
        candidates: v.array(suggestedTeamValidator),
        /** NEO-639 — the player's dated stints, for display. See "Stints" above. */
        stints: v.optional(v.array(suggestionStintValidator)),
      }),
    ),
    /** One entry per `teamNames` input, in order; empty when none were asked. */
    teamNames: v.array(v.object({ teams: v.array(suggestedTeamValidator) })),
  }),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    if (args.players.length > TEAM_SUGGESTION_MAX_PLAYERS) {
      throw new ConvexError(
        `Too many players to suggest teams for at once (${args.players.length}; max ${TEAM_SUGGESTION_MAX_PLAYERS}).`,
      );
    }
    const teamNameArgs = args.teamNames ?? [];
    if (teamNameArgs.length > TEAM_SUGGESTION_MAX_TEAM_NAMES) {
      throw new ConvexError(
        `Too many team names to look up at once (${teamNameArgs.length}; max ${TEAM_SUGGESTION_MAX_TEAM_NAMES}).`,
      );
    }
    // Security audit N1 — `locationNames` is a subset of `teamNames`, so it
    // takes the same count bound. (Its entries are bounded by length below,
    // before they are normalized.)
    if ((args.locationNames ?? []).length > TEAM_SUGGESTION_MAX_TEAM_NAMES) {
      throw new ConvexError(
        `Too many place names to look up at once (${(args.locationNames ?? []).length}; max ${TEAM_SUGGESTION_MAX_TEAM_NAMES}).`,
      );
    }
    // NEO-335 security audit — the read budget. Each cap above is sized for a
    // call that does ONE of the two jobs; a full player slice plus a full name
    // slice in one transaction stacks both budgets. The browser already sends
    // them as separate calls (TeamsOnCardsSection's `p…` and `n…` queries),
    // so a call carrying both is refused rather than served.
    if (args.players.length > 0 && teamNameArgs.length > 0) {
      throw new ConvexError(
        "Ask for players or team names in one call, not both.",
      );
    }

    const empty = (): PlayerSuggestionResult => ({
      playerId: null,
      answer: null,
      candidates: [],
    });
    const noTeams = () => ({ teams: [] as Array<SuggestedTeam> });

    const node = await ctx.db.get(args.selectorOptionId);
    if (!node) {
      return {
        setYear: null,
        sportId: null,
        setLeagueIds: [],
        setLeagueId: null,
        players: args.players.map(empty),
        teamNames: teamNameArgs.map(noTeams),
      };
    }

    // The sport, the base checklist and the node a parallel copies: one walk,
    // shared with the commit's own stored-evidence read (`storedTeamEvidence`).
    const { sportId, parallelOfNodeId, baseNodeId } = await storedTierNodes(ctx, node);
    const setYear = await findSetYearForSelectorOption(ctx, node._id);

    // C2b / NEO-569 — the set's leagues, by NB's own field and NB's own rows,
    // any-of. A league of another sport (or one that is gone) is not ranked by.
    const setLeagues: Array<Doc<"leagues">> = [];
    for (const leagueId of await effectiveSetLeagueIds(ctx, node._id)) {
      const league = await ctx.db.get(leagueId);
      if (league && league.sportId === sportId) setLeagues.push(league);
    }
    const setPreference =
      setLeagues.length > 0
        ? {
            leagueIds: setLeagues.map((league) => league._id as string),
            levels: setLeagues.map((league) => league.level ?? null),
          }
        : null;

    const relevantNodes = new Set<string>(
      [node._id, parallelOfNodeId, baseNodeId].filter(
        (id): id is Id<"selectorOptions"> => id !== null,
      ),
    );
    const currentYear = new Date().getFullYear();

    const leagueLevelCache = new Map<string, string | null>();
    const leagueLevel = async (leagueId: Id<"leagues">): Promise<string | null> => {
      if (!leagueLevelCache.has(leagueId)) {
        const league = await ctx.db.get(leagueId);
        leagueLevelCache.set(leagueId, league?.level ?? null);
      }
      return leagueLevelCache.get(leagueId) ?? null;
    };

    // Team reads, cached. `null` = cannot be offered: deleted, or another
    // sport's team (the commit refuses a whole save that names one —
    // `validateOperatorTeamIds` — so it is never something to offer).
    const teamCache = new Map<string, { team: SuggestedTeam; rank: TeamPreferenceRank } | null>();
    const readTeamRow = async (
      team: Doc<"teams"> | null,
      teamId: Id<"teams">,
    ): Promise<{ team: SuggestedTeam; rank: TeamPreferenceRank } | null> => {
      if (!teamCache.has(teamId)) {
        if (!team || team.sportId !== sportId) {
          teamCache.set(teamId, null);
        } else {
          const level = team.leagueId ? await leagueLevel(team.leagueId) : null;
          const rank = setPreference
            ? teamPreferenceRank(
                { leagueId: team.leagueId ?? null, leagueLevel: level },
                setPreference,
              )
            : UNRANKED;
          teamCache.set(teamId, {
            team: {
              teamId,
              name: teamFullName(team),
              ...(team.colors ? { colors: team.colors } : {}),
              // Only when there is a league to prefer: an unranked answer
              // stays byte-identical to what it was before C2b.
              ...(setPreference ? { rank } : {}),
            },
            rank,
          });
        }
      }
      return teamCache.get(teamId) ?? null;
    };
    const readTeam = async (teamId: Id<"teams">) =>
      teamCache.has(teamId)
        ? (teamCache.get(teamId) ?? null)
        : readTeamRow(await ctx.db.get(teamId), teamId);

    const byPlayerId = new Map<string, PlayerSuggestionResult>();
    const answerFor = async (
      playerId: Id<"players">,
      preloaded?: Doc<"players">,
    ): Promise<PlayerSuggestionResult> => {
      const cached = byPlayerId.get(playerId);
      if (cached) return cached;

      const player = preloaded ?? (await ctx.db.get(playerId)) ?? undefined;
      const cards: Array<SuggestionCard> = [];
      if (sportId) {
        const cardIds = await recentCardIdsForPlayer(
          ctx,
          playerId,
          sportId,
          TEAM_SUGGESTION_LINKS_PER_PLAYER,
        );
        for (const cardId of cardIds) {
          const card = await ctx.db.get(cardId);
          if (card && relevantNodes.has(card.selectorOptionId)) cards.push(card);
        }
      }

      // The career, sport-checked and ranked BEFORE the window is counted: a
      // two-sport athlete's football stint must not make his baseball window
      // a tie, and a deleted team is not a team.
      const careerIds = [...new Set((player?.teamYears ?? []).map((entry) => entry.teamId))];
      const known = new Map<string, TeamPreferenceRank | null>();
      for (const teamId of careerIds.slice(0, TEAM_SUGGESTION_CAREER_TEAMS_READ)) {
        const read = await readTeam(teamId);
        known.set(teamId, read ? read.rank : null);
      }
      const usablePlayer = player
        ? {
            // NEO-569 — undated stints go through too: the career rule counts
            // one only when it is the player's ONE team in the set's leagues
            // (Jason, 2026-11-16), and ignores every undated stint otherwise,
            // as NEO-285's filter here used to.
            teamYears: (player.teamYears ?? []).filter(
              (entry) => known.get(entry.teamId) !== null,
            ),
          }
        : undefined;

      const suggestion = suggestTeamsForPlayer({
        playerId,
        player: usablePlayer,
        cards,
        nodeId: node._id,
        parallelOfNodeId,
        baseNodeId,
        year: setYear,
        currentYear,
        maxCandidates: TEAM_SUGGESTION_MAX_CANDIDATES,
        rankOf: (teamId) => known.get(teamId) ?? UNRANKED,
        setHasLeagues: setPreference !== null,
      });

      let answer: PlayerSuggestionResult["answer"] = null;
      const candidates: Array<SuggestedTeam> = [];
      if (suggestion.answer) {
        const teams: Array<SuggestedTeam> = [];
        for (const teamId of suggestion.answer.teamIds) {
          const read = await readTeam(teamId);
          if (read) teams.push(read.team);
        }
        // A dangling team in the answer makes it no longer the whole answer;
        // offer what is left to pick from instead of a partial pre-fill.
        if (teams.length === suggestion.answer.teamIds.length) {
          answer = { tier: suggestion.answer.tier, teams };
        } else {
          candidates.push(...teams);
        }
      }
      for (const teamId of suggestion.candidates) {
        const read = await readTeam(teamId);
        if (read) candidates.push(read.team);
      }
      // NEO-639 — the years the chips print. The career the window just read,
      // dated stints only, in the row's order, and only at a team already
      // read and found in this sport (`teamCache`: every team a chip can show
      // has been through it by now). No reads.
      const stints: Array<SuggestionStint> = [];
      for (const entry of usablePlayer?.teamYears ?? []) {
        if (stints.length >= TEAM_SUGGESTION_MAX_STINTS) break;
        if (entry.fromYear === undefined) continue;
        if (!teamCache.get(entry.teamId)) continue;
        stints.push({
          teamId: entry.teamId,
          fromYear: entry.fromYear,
          ...(entry.toYear !== undefined ? { toYear: entry.toYear } : {}),
        });
      }
      const result: PlayerSuggestionResult = {
        playerId,
        answer,
        candidates,
        // Absent rather than empty: most callers never print years, and an
        // answer with none stays the shape it was before NEO-639.
        ...(stints.length > 0 ? { stints } : {}),
      };
      byPlayerId.set(playerId, result);
      return result;
    };

    const players: Array<PlayerSuggestionResult> = [];
    for (const entry of args.players) {
      if (entry.playerId) {
        players.push(await answerFor(entry.playerId));
        continue;
      }
      const trimmed = entry.name?.trim() ?? "";
      if (!sportId || !trimmed || trimmed.length > TEAM_SUGGESTION_MAX_NAME_LENGTH) {
        players.push(empty());
        continue;
      }
      const normalized = normalizeEntityName(trimmed);
      const matches = normalized ? await sameNamePlayers(ctx, normalized, sportId) : [];
      // Exactly one, or no evidence: two same-name players is a question for
      // the operator, and this query does not get to answer it.
      players.push(
        matches.length === 1 ? await answerFor(matches[0]._id, matches[0]) : empty(),
      );
    }

    // Names → existing NB teams, every era, as choices. Never a pick: the
    // order is only "the era covering the set year first, then the set's
    // league first".
    const teamNames: Array<{ teams: Array<SuggestedTeam> }> = [];
    const byName = new Map<string, Array<SuggestedTeam>>();
    const locationKeys = new Set(
      (args.locationNames ?? [])
        .map((n) => n.trim())
        // Skipped BEFORE normalizing: an over-long entry is never matched
        // (`teamNames` skips the same names), so it must not cost the work.
        .filter((n) => n.length > 0 && n.length <= TEAM_SUGGESTION_MAX_NAME_LENGTH)
        .map((n) => normalizeEntityName(n))
        .filter(Boolean),
    );
    let locationLegs = 0;
    for (const raw of teamNameArgs) {
      const trimmed = raw.trim();
      if (!sportId || !trimmed || trimmed.length > TEAM_SUGGESTION_MAX_NAME_LENGTH) {
        teamNames.push(noTeams());
        continue;
      }
      const key = normalizeEntityName(trimmed);
      const cached = byName.get(key);
      if (cached) {
        teamNames.push({ teams: cached });
        continue;
      }
      const rows = await findTeamsByFullName(ctx, sportId, trimmed);
      const coveringId = pickTeamForYear(rows, setYear, { allowPastEra: true })?.row._id;
      // NEO-591 — the location leg, for a name the caller asked it for: the
      // rows whose location IS the name. Only ever more choices.
      //
      // Security audit S2: unlike the fetch-time resolvers, this read decides
      // nothing, it only lists. A window that came back full (16 hits) can cut
      // a choice off the list, never settle a card on a guess, so it is
      // deliberately not turned into a hold here.
      let located: Array<Doc<"teams">> = [];
      const term = nameTokens(trimmed).join(" ");
      if (term && locationKeys.has(key) && locationLegs < TEAM_SUGGESTION_MAX_LOCATION_NAMES) {
        locationLegs++;
        const hits = await ctx.db
          .query("teams")
          .withSearchIndex("search_name", (q) => q.search("nameNormalized", term).eq("sportId", sportId))
          .take(TEAM_SUGGESTION_LOCATION_HITS);
        located = hits.filter(
          (row) => teamLocationIs(row, trimmed) && !rows.some((r) => r._id === row._id),
        );
      }
      const resolved: Array<{ team: SuggestedTeam; rank: TeamPreferenceRank; covers: boolean }> =
        [];
      for (const row of [...rows, ...located]) {
        const read = await readTeamRow(row, row._id);
        if (read) resolved.push({ ...read, covers: row._id === coveringId });
      }
      const teams = resolved
        .map((entry, i) => ({ ...entry, i }))
        .sort((a, b) => Number(b.covers) - Number(a.covers) || a.rank - b.rank || a.i - b.i)
        .slice(0, TEAM_SUGGESTION_MAX_CANDIDATES)
        .map((entry) => entry.team);
      byName.set(key, teams);
      teamNames.push({ teams });
    }

    return {
      setYear: setYear ?? null,
      sportId: sportId ?? null,
      setLeagueIds: setLeagues.map((league) => league._id),
      setLeagueId: setLeagues[0]?._id ?? null,
      players,
      teamNames,
    };
  },
});

/** How many players one `storedTeamEvidence` call reads (each is up to ~50 reads). */
export const STORED_TEAM_EVIDENCE_PLAYERS_PER_CALL = 16;

/**
 * NEO-645 (Q1 = A) — the "stored cards of the set" tier of the commit's own
 * team fill: for each player, the team set his OTHER cards already carry under
 * the node being saved, the node it copies (a parallel), or the set's base
 * checklist — exactly the stored tiers `teamSuggestionsForPreview` offered the
 * old Teams step (`suggestTeamsForPlayer`, minus the career, which the commit
 * chunk reads itself).
 *
 * Per player, either:
 *  - `answer`: one team set agrees (the first tier that has cards decides);
 *  - `disagree`: that tier's cards disagree with each other. The search STOPS
 *    for this player (a career tier must not outvote two printed cards), so the
 *    card is left for the operator.
 * A player with no stored evidence is absent from the result, and the chunk
 * falls through to his career. Never a guess at which of two same-name players
 * is meant: the caller sends player ids. The bound (24 newest links per
 * player) can cost a suggestion, never produce a wrong one.
 */
export const storedTeamEvidence = internalQuery({
  args: {
    selectorOptionId: v.id("selectorOptions"),
    askAbout: v.array(v.id("players")),
  },
  returns: v.array(
    v.object({
      playerId: v.id("players"),
      status: v.union(v.literal("answer"), v.literal("disagree")),
      teamIds: v.array(v.id("teams")),
    }),
  ),
  handler: async (ctx, args) => {
    if (args.askAbout.length > STORED_TEAM_EVIDENCE_PLAYERS_PER_CALL) {
      throw new ConvexError(
        `Too many players to read stored teams for at once (${args.askAbout.length}; max ${STORED_TEAM_EVIDENCE_PLAYERS_PER_CALL}).`,
      );
    }
    const node = await ctx.db.get(args.selectorOptionId);
    if (!node) return [];
    const { sportId, parallelOfNodeId, baseNodeId } = await storedTierNodes(ctx, node);
    if (!sportId) return [];
    const relevantNodes = new Set<string>(
      [node._id, parallelOfNodeId, baseNodeId].filter(
        (id): id is Id<"selectorOptions"> => id !== null,
      ),
    );
    const out: Array<{
      playerId: Id<"players">;
      status: "answer" | "disagree";
      teamIds: Array<Id<"teams">>;
    }> = [];
    for (const playerId of new Set(args.askAbout)) {
      const cards: Array<Doc<"cardChecklist">> = [];
      for (const cardId of await recentCardIdsForPlayer(
        ctx,
        playerId,
        sportId,
        TEAM_SUGGESTION_LINKS_PER_PLAYER,
      )) {
        const card = await ctx.db.get(cardId);
        if (card && relevantNodes.has(card.selectorOptionId)) cards.push(card);
      }
      const suggestion = suggestTeamsForPlayer({
        playerId,
        // No player row: the stored tiers only, the career is the chunk's.
        player: undefined,
        cards,
        nodeId: node._id,
        parallelOfNodeId,
        baseNodeId,
        year: undefined,
        currentYear: new Date().getFullYear(),
        maxCandidates: TEAM_SUGGESTION_MAX_CANDIDATES,
      });
      if (suggestion.answer) {
        out.push({ playerId, status: "answer", teamIds: suggestion.answer.teamIds });
      } else if (suggestion.candidates.length > 0) {
        out.push({ playerId, status: "disagree", teamIds: [] });
      }
    }
    return out;
  },
});
