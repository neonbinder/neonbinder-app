/**
 * NEO-358 — what the generator WOULD title a STORED card today.
 *
 * The body of `selectorOptions.previewListingTitle` (Regenerate), extracted
 * unchanged so the NEO-358 backfill filled a missing `listingTitle` with
 * exactly the title Regenerate would offer the operator. That backfill ran
 * and was retired in NEO-363; Regenerate is the one caller now.
 *
 * Read-only. Players and teams are deduped and bounded before any read
 * (`MAX_CARD_PLAYERS` / `MAX_CARD_TEAMS`, what the write paths enforce); a
 * dangling id is skipped rather than failing; a hand-added card's still
 * pending names are the fallback, as `addCustomCard` uses them.
 *
 * NEO-528 — a caller that asks about many cards (a bulk page, a parallel
 * build page) passes one `StoredCardReadCache`, so the ancestor chain is
 * walked once per checklist and each player or team is read once per page,
 * not once per card. The title never reads a card's cameos; only the
 * description names them, and its caller resolves the names
 * (`playerNameFor`) and hands them in.
 */

import type { QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  assessListingTitle,
  generateListingDescription,
  type ListingCardInputs,
  type ListingTitleAssessment,
} from "./features/generateListing";
import { listingInputsForCard } from "./features/listingInputs";
import { MAX_CARD_PLAYERS, MAX_CARD_TEAMS } from "./features/cardAttention";
import { teamFullName } from "../lib/teams/team-name";
// From listingShortName.ts, not selectorOptions.ts: the cameo writer
// (cardSecondaryPlayers.ts) imports this module, players.ts imports the
// writer, and a static path back into selectorOptions.ts would close an
// import cycle that leaves its validators undefined at load.
import { findAncestorLabels } from "./listingShortName";

export type StoredCardTitle = ListingTitleAssessment & {
  inputs: ListingCardInputs & { playerNames: string[]; teamNames: string[] };
};

type ReadCtx = { db: QueryCtx["db"] };
type ChainLabels = Awaited<ReturnType<typeof findAncestorLabels>>;

/**
 * Reads one page of title or description work shares. Keyed by id; `null`
 * is "read, and gone", so a dangling id is not read twice either.
 */
export type StoredCardReadCache = {
  /** `findAncestorLabels` of a card's checklist row, by that row's id. */
  chain: Map<string, ChainLabels>;
  /** A player's NB name, by id. */
  players: Map<string, string | null>;
  /** A team's full name (`teamFullName`), by id. */
  teams: Map<string, string | null>;
};

export function newStoredCardReadCache(): StoredCardReadCache {
  return { chain: new Map(), players: new Map(), teams: new Map() };
}

/** A player's NB name, or null for an id that no longer resolves. */
export async function playerNameFor(
  ctx: ReadCtx,
  id: Id<"players">,
  cache?: StoredCardReadCache,
): Promise<string | null> {
  const key = id as string;
  if (cache?.players.has(key)) return cache.players.get(key) ?? null;
  const name = (await ctx.db.get(id))?.name ?? null;
  cache?.players.set(key, name);
  return name;
}

async function teamNameFor(
  ctx: ReadCtx,
  id: Id<"teams">,
  cache?: StoredCardReadCache,
): Promise<string | null> {
  const key = id as string;
  if (cache?.teams.has(key)) return cache.teams.get(key) ?? null;
  const team = await ctx.db.get(id);
  // NEO-236: full name, matching what the commit path stores on the card.
  const name = team ? teamFullName(team) : null;
  cache?.teams.set(key, name);
  return name;
}

async function chainLabelsFor(
  ctx: ReadCtx,
  selectorOptionId: Id<"selectorOptions">,
  cache?: StoredCardReadCache,
): Promise<ChainLabels> {
  const key = selectorOptionId as string;
  const hit = cache?.chain.get(key);
  if (hit) return hit;
  const parentNode = await ctx.db.get(selectorOptionId);
  const labels = await findAncestorLabels(ctx, parentNode);
  cache?.chain.set(key, labels);
  return labels;
}

/**
 * NEO-528 — what the generator WOULD write as a stored card's description,
 * given the names of the people also pictured on it (in stored order).
 * Compared against the stored `listingDescription` to tell a generated one
 * (refreshed when the card changes) from one a person typed (kept).
 */
export async function descriptionForStoredCard(
  ctx: ReadCtx,
  card: Doc<"cardChecklist">,
  cameoNames: ReadonlyArray<string>,
  cache?: StoredCardReadCache,
): Promise<string> {
  const { inputs } = await titleForStoredCard(ctx, card, cache);
  return generateListingDescription(inputs, { cameoNames });
}

export async function titleForStoredCard(
  ctx: ReadCtx,
  card: Doc<"cardChecklist">,
  cache?: StoredCardReadCache,
): Promise<StoredCardTitle> {
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
  for (const playerId of previewPlayerIds) {
    const name = await playerNameFor(ctx, playerId, cache);
    // A dangling id is a data problem, not a reason to fail a preview —
    // skip it and let the chips show what actually resolved.
    if (name !== null) resolvedPlayerNames.push(name);
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
  for (const teamId of previewTeamIds) {
    const name = await teamNameFor(ctx, teamId, cache);
    if (name !== null) resolvedTeamNames.push(name);
  }
  // Same fallback as `playerNames`: a hand-added card carries the names the
  // operator typed until a sync resolves them into `teams` rows, and those
  // are the operator's answer.
  const teamNames =
    resolvedTeamNames.length > 0
      ? resolvedTeamNames
      : (card.pendingTeamNames ?? []).slice(0, MAX_CARD_TEAMS);

  const features: Record<string, string> = card.features ?? {};
  const {
    setName: setNameValue,
    sport: sportValue,
    manufacturerBrandUnknown,
    ...chainFacts
  } = await chainLabelsFor(ctx, card.selectorOptionId, cache);

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

  const { title, coreFits, dropped } = assessListingTitle(inputs);
  return {
    title,
    coreFits,
    dropped,
    inputs: { ...inputs, playerNames, teamNames },
  };
}
