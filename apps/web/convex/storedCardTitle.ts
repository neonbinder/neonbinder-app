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
 *
 * NEO-528 — a caller that asks about many cards (a bulk page, a parallel
 * build page) passes one `StoredCardReadCache`, so the ancestor chain is
 * walked once per checklist and each player or team is read once per page,
 * not once per card. A card's cameos are read here too (Jason, at the
 * NEO-528 + NEO-535 merge): the title names them while it has room, the
 * first meaningful thing it drops, and the description states them.
 */

import type { QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  assessListingTitle,
  generateListingDescription,
  type ListingCardInputs,
  type ListingTeamSplit,
  type ListingTitleAssessment,
} from "./features/generateListing";
import { listingInputsForCard } from "./features/listingInputs";
import { MAX_CARD_PLAYERS, MAX_CARD_TEAMS } from "./features/cardAttention";
import { teamFullName, teamSplitOf } from "../lib/teams/team-name";
// From listingShortName.ts, not selectorOptions.ts: the cameo writer
// (cardSecondaryPlayers.ts) imports this module, players.ts imports the
// writer, and a static path back into selectorOptions.ts would close an
// import cycle that leaves its validators undefined at load. (NEO-535 had
// moved it here for the same reason; NEO-528's home in listingShortName.ts
// is the one kept.)
import { findAncestorLabels } from "./listingShortName";

export type StoredCardInputs = ListingCardInputs & {
  playerNames: string[];
  teamNames: string[];
};

export type StoredCardTitle = ListingTitleAssessment & {
  inputs: StoredCardInputs;
};

type ChainLabels = Awaited<ReturnType<typeof findAncestorLabels>>;

/**
 * NEO-535 — all a stored card's inputs are read through: `get` by id, nothing
 * else. Narrowed from the whole `db` so a caller can hand in a reader that
 * shows some rows as they were (`cardDescriptionRefresh`'s rename overlay).
 */
export type StoredCardReader = Pick<QueryCtx["db"], "get">;
type ReadCtx = { db: StoredCardReader };

/**
 * Reads one page of title or description work shares (NEO-528, NEO-535): a
 * bulk page, a parallel build page, one backfill page. Keyed by id; `null`
 * is "read, and gone", so a dangling id is not read twice either. Never
 * shared across transactions: a later page must see later data.
 */
export type StoredCardReadCache = {
  /**
   * `findAncestorLabels` of a card's checklist row, by that row's id, and
   * whether the row itself was found (NEO-535: a gone row reads no set,
   * sport or chain facts, and `listingInputsForStoredCard` says so).
   */
  chain: Map<string, { found: boolean; labels: ChainLabels }>;
  /** A player's NB name, by id. */
  players: Map<string, string | null>;
  /** A team's full name (`teamFullName`), by id. */
  teams: Map<string, string | null>;
  /**
   * NEO-606 — a team's Location / Name split, by id, set wherever `teams` is
   * (`null`: no id, or no location to give up). Whoever fills `teams` fills
   * this beside it, from the same read.
   */
  teamSplits: Map<string, ListingTeamSplit | null>;
};

export function newStoredCardReadCache(): StoredCardReadCache {
  return { chain: new Map(), players: new Map(), teams: new Map(), teamSplits: new Map() };
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

/** A team's full name, and its split when its row has a location (NEO-606). */
export async function teamNameFor(
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
  cache?.teamSplits.set(key, (team && teamSplitOf(team)) ?? null);
  return name;
}

async function chainLabelsFor(
  ctx: ReadCtx,
  selectorOptionId: Id<"selectorOptions">,
  cache?: StoredCardReadCache,
): Promise<{ found: boolean; labels: ChainLabels }> {
  const key = selectorOptionId as string;
  const hit = cache?.chain.get(key);
  if (hit) return hit;
  const parentNode = await ctx.db.get(selectorOptionId);
  const chain = {
    found: parentNode !== null,
    labels: await findAncestorLabels(ctx, parentNode),
  };
  cache?.chain.set(key, chain);
  return chain;
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
  const { inputs } = await listingInputsForStoredCard(ctx, card, cache);
  return generateListingDescription(inputs, { cameoNames });
}

/**
 * The listing inputs a STORED card resolves to today, and what failed to
 * resolve: `unresolved.players` / `unresolved.teams` / `unresolved.cameos`
 * count dangling ids (the pending-name fallback may still have filled the
 * player and team names), `unresolved.parent`
 * says the card's own row is gone, so no set, sport or chain facts were read.
 * A caller that writes from these inputs decides what an unresolved card
 * means for it; the title preview ignores it, as it always has.
 */
export async function listingInputsForStoredCard(
  ctx: ReadCtx,
  card: Doc<"cardChecklist">,
  cache: StoredCardReadCache = newStoredCardReadCache(),
): Promise<{
  inputs: StoredCardInputs;
  unresolved: { players: number; teams: number; cameos: number; parent: boolean };
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
    const name = await playerNameFor(ctx, playerId, cache);
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
  const teamSplits: ListingTeamSplit[] = [];
  let danglingTeams = 0;
  for (const teamId of previewTeamIds) {
    const name = await teamNameFor(ctx, teamId, cache);
    if (name !== null) {
      resolvedTeamNames.push(name);
      const split = cache.teamSplits.get(teamId as string);
      if (split) teamSplits.push(split);
    } else danglingTeams += 1;
  }
  // Same fallback as `playerNames`: a hand-added card carries the names the
  // operator typed until a sync resolves them into `teams` rows, and those
  // are the operator's answer.
  const teamNames =
    resolvedTeamNames.length > 0
      ? resolvedTeamNames
      : (card.pendingTeamNames ?? []).slice(0, MAX_CARD_TEAMS);

  // NEO-528 — the people also pictured, in stored order, deduped and bounded
  // like the players (the writer caps the list at `MAX_CARD_PLAYERS`). The
  // title names them while it has room; the description on its own line.
  const cameoIds = [...new Set(card.secondaryPlayerIds ?? [])].slice(0, MAX_CARD_PLAYERS);
  const cameoNames: string[] = [];
  let danglingCameos = 0;
  for (const id of cameoIds) {
    const name = await playerNameFor(ctx, id, cache);
    if (name !== null) cameoNames.push(name);
    else danglingCameos += 1;
  }

  const features: Record<string, string> = card.features ?? {};
  const chain = await chainLabelsFor(ctx, card.selectorOptionId, cache);
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
    // NEO-606 — only the teams that resolved to rows can be split; a typed
    // name (`pendingTeamNames`) has no row to read a location off.
    { playerNames, teamNames, teamSplits, cameoNames },
    features,
  );

  // NEO-645 — a card with no player and a cameo is titled by its own name,
  // then the cameo (Jason, 2026-11-22). The generator decides; this only
  // hands the name over for the cards the rule can reach.
  const subjectName =
    playerNames.length === 0 && cameoNames.length > 0 ? card.cardName.trim() : "";
  return {
    inputs: { ...inputs, playerNames, teamNames, ...(subjectName ? { subjectName } : {}) },
    unresolved: {
      players: danglingPlayers,
      teams: danglingTeams,
      cameos: danglingCameos,
      parent: !chain.found,
    },
  };
}

export async function titleForStoredCard(
  ctx: ReadCtx,
  card: Doc<"cardChecklist">,
  cache?: StoredCardReadCache,
): Promise<StoredCardTitle> {
  const { inputs } = await listingInputsForStoredCard(ctx, card, cache);
  return { ...assessListingTitle(inputs), inputs };
}
