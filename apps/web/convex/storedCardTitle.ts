/**
 * NEO-358 — what the generator WOULD title a STORED card today.
 *
 * The body of `selectorOptions.previewListingTitle` (Regenerate), extracted
 * unchanged so the NEO-358 backfill filled a missing `listingTitle` with
 * exactly the title Regenerate would offer the operator. That backfill ran
 * and was retired in NEO-363; Regenerate is the one title caller now.
 *
 * NEO-535: the input half (`listingInputsForStoredCard`) is its own export,
 * so the description backfill (`backfillListingDescriptions`) feeds
 * `generateListingDescription` exactly the inputs Regenerate's title is built
 * from. It takes an optional per-page lookup cache, so a page of one
 * variant's cards walks the ancestor chain once and reads each player and
 * team once.
 *
 * Read-only. Players and teams are deduped and bounded before any read
 * (`MAX_CARD_PLAYERS` / `MAX_CARD_TEAMS`, what the write paths enforce); a
 * dangling id is skipped rather than failing; a hand-added card's still
 * pending names are the fallback, as `addCustomCard` uses them.
 */

import type { QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  assessListingTitle,
  type ListingCardInputs,
  type ListingTitleAssessment,
} from "./features/generateListing";
import { listingInputsForCard } from "./features/listingInputs";
import { MAX_CARD_PLAYERS, MAX_CARD_TEAMS } from "./features/cardAttention";
import { teamFullName } from "../lib/teams/team-name";
// Called inside the function only; selectorOptions.ts imports this module back.
import { findAncestorLabels } from "./selectorOptions";

export type StoredCardInputs = ListingCardInputs & {
  playerNames: string[];
  teamNames: string[];
};

export type StoredCardTitle = ListingTitleAssessment & {
  inputs: StoredCardInputs;
};

type AncestorLabels = Awaited<ReturnType<typeof findAncestorLabels>>;

/**
 * Memoised reads for `listingInputsForStoredCard`, shared across the cards of
 * one transaction (one backfill page). Keyed by id; a `null` entry is a
 * dangling id, remembered so it is not read twice either. Never shared across
 * transactions: a later page must see later data.
 */
export type StoredCardLookupCache = {
  chains: Map<Id<"selectorOptions">, { found: boolean; labels: AncestorLabels }>;
  playerNames: Map<Id<"players">, string | null>;
  teamNames: Map<Id<"teams">, string | null>;
};

export function newStoredCardLookupCache(): StoredCardLookupCache {
  return { chains: new Map(), playerNames: new Map(), teamNames: new Map() };
}

/**
 * The listing inputs a STORED card resolves to today, and what failed to
 * resolve: `unresolved.players` / `unresolved.teams` count dangling ids (the
 * pending-name fallback may still have filled the names), `unresolved.parent`
 * says the card's own row is gone, so no set, sport or chain facts were read.
 * A caller that writes from these inputs decides what an unresolved card
 * means for it; the title preview ignores it, as it always has.
 */
export async function listingInputsForStoredCard(
  ctx: { db: QueryCtx["db"] },
  card: Doc<"cardChecklist">,
  cache: StoredCardLookupCache = newStoredCardLookupCache(),
): Promise<{
  inputs: StoredCardInputs;
  unresolved: { players: number; teams: number; parent: boolean };
}> {
  // Deduped and BOUNDED before any read, exactly as `teamOnCardIds` is
  // below. NEO-101 originally bounded this with a LOCAL constant of its own
  // (12) because `updateCard.playerIds` was written unvalidated and this
  // query was the only thing standing between one card id and an unbounded
  // sequential `ctx.db.get` walk. NEO-246 routed that write through
  // `resolvePlayerIdsForWrite`, so the stopgap is gone and the bound here is
  // `MAX_CARD_PLAYERS` — the same number the write path enforces. A row that
  // went through the supported path can therefore never be truncated by it;
  // the cap remains for rows written before that validation landed, or by a
  // future caller that skips it. Deduping still earns its keep for the same
  // rows: a repeat must not be read twice, or printed twice.
  const previewPlayerIds = [...new Set(card.playerIds ?? [])].slice(
    0,
    MAX_CARD_PLAYERS,
  );
  const resolvedPlayerNames: string[] = [];
  let danglingPlayers = 0;
  for (const playerId of previewPlayerIds) {
    if (!cache.playerNames.has(playerId)) {
      const player = await ctx.db.get(playerId);
      cache.playerNames.set(playerId, player ? player.name : null);
    }
    const name = cache.playerNames.get(playerId) ?? null;
    // A dangling id is a data problem, not a reason to fail a preview —
    // skip it and let the chips show what actually resolved.
    if (name !== null) resolvedPlayerNames.push(name);
    else danglingPlayers += 1;
  }
  const playerNames =
    resolvedPlayerNames.length > 0
      ? resolvedPlayerNames
      : (card.pendingPlayerNames ?? []);

  // Teams get the same treatment as players — deduped and BOUNDED before any
  // read. The bound here is `MAX_CARD_TEAMS`, which is what `updateCard`
  // already enforces on the write path, so a row that went through the
  // supported path can never be truncated by it; the cap exists for rows
  // written before that validation landed, or by a future caller that skips
  // it.
  const previewTeamIds = [...new Set(card.teamOnCardIds ?? [])].slice(
    0,
    MAX_CARD_TEAMS,
  );
  const resolvedTeamNames: string[] = [];
  let danglingTeams = 0;
  for (const teamId of previewTeamIds) {
    if (!cache.teamNames.has(teamId)) {
      const team = await ctx.db.get(teamId);
      // NEO-236: full name, matching what the commit path stores on the card.
      cache.teamNames.set(teamId, team ? teamFullName(team) : null);
    }
    const name = cache.teamNames.get(teamId) ?? null;
    if (name !== null) resolvedTeamNames.push(name);
    else danglingTeams += 1;
  }
  // Same fallback as `playerNames`: a hand-added card carries the names the
  // operator typed until a sync resolves them into `teams` rows, and those
  // are the operator's answer.
  const teamNames =
    resolvedTeamNames.length > 0
      ? resolvedTeamNames
      : (card.pendingTeamNames ?? []).slice(0, MAX_CARD_TEAMS);

  const features: Record<string, string> = card.features ?? {};
  let chain = cache.chains.get(card.selectorOptionId);
  if (!chain) {
    const parentNode = await ctx.db.get(card.selectorOptionId);
    chain = {
      found: parentNode !== null,
      labels: await findAncestorLabels(ctx, parentNode),
    };
    cache.chains.set(card.selectorOptionId, chain);
  }
  const {
    setName: setNameValue,
    sport: sportValue,
    manufacturerBrandUnknown,
    ...chainFacts
  } = chain.labels;

  // NEO-335 — the insert branch's own mapping (`listingInputsForCard`), fed
  // the STORED row's `features` as the merged snapshot, rather than a
  // hand-kept mirror of it. Same fields as before — year/manufacturer/
  // parallel/autograph/short print off `features`, the card's own RC/relic/
  // print run/verbatim variation, the set name, the NEO-272 brand ROLE and
  // the sport — plus the chain's insert role, parallel leaf and short name,
  // so Regenerate and the TitleFixer read the short name an operator set.
  const inputs: ListingCardInputs = listingInputsForCard(
    {
      cardNumber: card.cardNumber,
      isRookie: card.isRookie,
      isRelic: card.isRelic,
      printRun: card.printRun,
      cardVariation: card.cardVariation,
    },
    {
      sportValue: sportValue ?? "",
      setNameValue,
      manufacturerBrandUnknown,
      ...chainFacts,
    },
    { playerNames, teamNames },
    features,
  );

  return {
    inputs: { ...inputs, playerNames, teamNames },
    unresolved: {
      players: danglingPlayers,
      teams: danglingTeams,
      parent: !chain.found,
    },
  };
}

export async function titleForStoredCard(
  ctx: { db: QueryCtx["db"] },
  card: Doc<"cardChecklist">,
  cache?: StoredCardLookupCache,
): Promise<StoredCardTitle> {
  const { inputs } = await listingInputsForStoredCard(ctx, card, cache);
  return { ...assessListingTitle(inputs), inputs };
}
