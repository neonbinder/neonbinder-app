/**
 * NEO-528 — "Player on every card", from the Set Builder's attributes panel.
 *
 * Round 3 (Jason, 2026-11-13) made it a STORED attribute of any row, at any
 * level (sport, year, manufacturer, set, variant type, insert, parallel):
 *
 *   - `selectorOptions.defaultPlayerIds` — the ONE player every new card
 *     beneath the row is born with when it has no player of its own;
 *   - `selectorOptions.defaultCameoIds` — the cameos every new card beneath
 *     it is born with.
 *
 * Nothing is copied down. A card being created LOOKS UP its defaults
 * (`effectiveCardPlayerDefaults`): its checklist row and the rows above it,
 * nearest first, and the nearest row carrying a value wins, as a whole, per
 * field (a nearer row's cameo list replaces a farther row's; lists are never
 * merged). A parallel's walk passes through the row it is a parallel of
 * (`cardPlayerDefaultsChain`). The per-card decision is the pure planners in
 * `lib/cardPlayerDefaults.ts`.
 *
 * Storing a value (`setCardPlayerDefault`) or clearing it
 * (`clearCardPlayerDefault`) edits no card. Cards that already exist change
 * only through the whole-checklist run, which the panel starts after a store
 * when there are cards beneath:
 *
 *   - `addPlayerToVariant` makes them the CARD'S player on every card that
 *     has none yet (`playerIds` + `playerLinks`, the card → player index,
 *     `lastUpdated`). A card that already names anyone, or still carries a
 *     name waiting for review (`pendingPlayerNames`), is left exactly as it
 *     is and counted. A card where they were a cameo is promoted: they become
 *     its player and leave its cameos. No team is ever written (product
 *     invariant 8), and entity review is not touched.
 *   - `addCameoToVariant` adds them under "Also on this card" (the cameo
 *     list, through `cardSecondaryPlayers.setCardSecondaryPlayers`).
 *
 * Neither takes anything away; there is no remove. Neither puts anyone on a
 * card of a sport they don't play (`skippedSport`), the rule a new card's
 * defaults follow too; storing such a player is refused up front
 * (`setCardPlayerDefault`). A page's cursor is bound to its run (the row,
 * the player, the add), so it cannot resume a different run.
 *
 * The run walks every card-holding row beneath the one asked about
 * (`everyCardTargets`), EXCEPT rows whose cards a nearer row's own value of
 * that kind speaks for: those cards' new siblings would be born with the
 * nearer value, so the run leaves the existing ones alone too. The walk and
 * the lookup are one rule read in two directions, and
 * `cardPlayersBulk.test.ts` pins that they agree.
 *
 * Listing text follows the card only where nobody has edited it: before a
 * write, a stored title (or description) that still equals what the generator
 * builds for the card is regenerated after it; one a person typed is kept.
 * The title never names a cameo, so only the player add refreshes titles.
 *
 * The run is client-paged: `everyCardTargets` lists the rows for the
 * progress ledger, and each call does one page of one row, handing back a
 * cursor until it is null.
 */

import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireAdmin } from "./auth";
import { MAX_CARD_PLAYERS } from "./features/cardAttention";
import { generateListingDescription } from "./features/generateListing";
import { generatedTitleTruncatedFlag } from "./features/listingInputs";
import { variantTypeKind } from "./variantRole";
import { syncCardPlayerLinks } from "./cardPlayerLinks";
import { playerBelongsToSport } from "./players";
import {
  cameoNamesFor,
  descriptionIsGenerated,
  setCardSecondaryPlayers,
} from "./cardSecondaryPlayers";
import {
  newStoredCardReadCache,
  titleForStoredCard,
  type StoredCardReadCache,
} from "./storedCardTitle";
import {
  planDefaultCameos,
  planDefaultPlayers,
  type CardPlayerDefaultIds,
} from "./lib/cardPlayerDefaults";

type ReadCtx = Pick<QueryCtx, "db">;
type CardRow = Doc<"cardChecklist">;
type SelectorRow = Doc<"selectorOptions">;

/** Which stored default: the card's player, or a cameo. */
export type CardPlayerDefaultKind = "player" | "cameo";
const kindValidator = v.union(v.literal("player"), v.literal("cameo"));

/**
 * Cards one page reads and writes.
 *
 * The budget is the transaction's ~4,000 database calls (each `get` and each
 * query range is one). A page re-reads its targets first (`bulkTargets`: the
 * walk down, at most `MAX_EVERY_CARD_WALK` rows, one range per row that can
 * have rows beneath it, plus the ancestor chain, each set's Base lookup and
 * at most `MAX_UNCOUNTED_PROBES` empty-row probes; under 1,000 calls at the
 * caps; `cardPlayersBulk.defaults.test.ts` counts it). Then,
 * per card, the worst case:
 *
 *   - the title and description before and after: the card's own players
 *     (none on a card the player add writes; up to `MAX_CARD_PLAYERS` on a
 *     cameo add), its teams (up to `MAX_CARD_TEAMS`), its cameos (up to
 *     `MAX_CARD_PLAYERS`), each read once per PAGE through the shared cache,
 *     and the ancestor chain, once per page;
 *   - the card → player index (one range) and the cameo index (one range).
 *
 * Every name a card names for the first time on the page is a read, so the
 * pathological page (every card naming 20 players, 19 cameos and 8 teams no
 * other card names) costs about 50 x (20 + 20 + 8 + 2) + 100 = 2,600 calls.
 * `cardPlayersBulk.test.ts` counts that page: 2,410 calls for the cameo add,
 * 1,460 for the player add (every card a promote). At 100 cards the cameo add
 * would be near 4,800, past the limit, hence 50.
 */
export const BULK_PAGE = 50;
/** Card-holding rows one run walks at most; past it the list is `truncated`. */
export const MAX_EVERY_CARD_TARGETS = 500;
/** Rows the walk down reads at most (card-holding or not). */
export const MAX_EVERY_CARD_WALK = 500;
/**
 * Never-counted rows (`cardCount` absent: a hand-made row nobody has added a
 * card to yet) the walk probes for a first card, one indexed `.first()` each.
 * Past it such a row stays unknown and is walked as before.
 */
export const MAX_UNCOUNTED_PROBES = 100;
/** Variant types read under one set when finding its Base or its Parallel types. */
const MAX_VARIANT_TYPES = 100;
/** Depth cutoff of the walk up; the hierarchy is seven levels. */
const MAX_CHAIN_DEPTH = 16;

/** The run's player was deleted mid-way (or before the first page). */
export const BULK_MISSING_PLAYER = "Can't find that player anymore. Pick them again.";
/**
 * A cursor this run's checklist no longer matches: its targets changed (a
 * parallel added or removed, a nearer row given its own value) or the cursor
 * is not one a page handed out.
 */
export const BULK_CHECKLIST_CHANGED = "This checklist changed mid-way. Give it another go.";
/** The row asked about is gone. */
export const DEFAULT_ROW_MISSING = "That part of the set isn't in Neon Binder anymore.";
/** A cameo store past the cap. */
export const DEFAULT_CAMEOS_FULL = `Every card can carry at most ${MAX_CARD_PLAYERS} cameos.`;
/** A cameo store of the row's own stored player. */
export function alreadyThePlayerMessage(name: string): string {
  return `${name} is already the player on every card.`;
}
/** A store of a player who does not play the row's sport. */
export function wrongSportMessage(name: string, sport: string): string {
  return `${name} doesn't play ${sport}, so they can't go on every card here.`;
}

// ───────────────────────────────────────────────────────────────────────────
// The walk up: where a card's defaults come from
// ───────────────────────────────────────────────────────────────────────────

/**
 * Reads a walk shares, by id. `null` is "read, and gone". `bases` is a set's
 * Base variant type by the set's id.
 */
export type SelectorRowCache = {
  rows: Map<string, SelectorRow | null>;
  bases: Map<string, SelectorRow | null>;
};

export function newSelectorRowCache(): SelectorRowCache {
  return { rows: new Map(), bases: new Map() };
}

async function rowFor(ctx: ReadCtx, id: Id<"selectorOptions">, cache: SelectorRowCache): Promise<SelectorRow | null> {
  const key = id as string;
  if (cache.rows.has(key)) return cache.rows.get(key) ?? null;
  const row = await ctx.db.get(id);
  cache.rows.set(key, row);
  return row;
}

/** A set's Base variant type, by its kind (never a name match beyond the kind word). */
async function baseVariantTypeOf(
  ctx: ReadCtx,
  setId: Id<"selectorOptions">,
  cache: SelectorRowCache,
): Promise<SelectorRow | null> {
  const key = setId as string;
  if (cache.bases.has(key)) return cache.bases.get(key) ?? null;
  const types = await ctx.db
    .query("selectorOptions")
    .withIndex("by_level_and_parent", (q) => q.eq("level", "variantType").eq("parentId", setId))
    .take(MAX_VARIANT_TYPES);
  const base = types.find((type) => variantTypeKind(type) === "base") ?? null;
  cache.bases.set(key, base);
  return base;
}

/**
 * The rows whose defaults a card on `startId` reads, nearest first: the row
 * itself, then up the `parentId` chain to the sport. A row that is a
 * PARALLEL of another row passes through that row too:
 *
 *   - a `parallel` row's parent IS its insert, so the plain chain covers it;
 *   - an `insert` under a Parallel variant type (the base set's parallels,
 *     NEO-321) is followed by its own Parallel variant type (its structural
 *     parent), then by the set's Base variant type, then by the set and the
 *     rest of the chain.
 *
 * Kinds come from the variant type's title through `variantTypeKind`, the
 * NEO-334 exception; nothing else is read from a name. A missing row ends the
 * chain; a cycle is cut at `MAX_CHAIN_DEPTH`.
 */
export async function cardPlayerDefaultsChain(
  ctx: ReadCtx,
  startId: Id<"selectorOptions">,
  cache: SelectorRowCache = newSelectorRowCache(),
): Promise<SelectorRow[]> {
  const chain: SelectorRow[] = [];
  const seen = new Set<string>();
  const push = (row: SelectorRow) => {
    if (seen.has(row._id as string)) return false;
    seen.add(row._id as string);
    chain.push(row);
    return true;
  };
  let row = await rowFor(ctx, startId, cache);
  for (let depth = 0; row && depth < MAX_CHAIN_DEPTH; depth++) {
    if (!push(row)) break;
    const parent = row.parentId ? await rowFor(ctx, row.parentId, cache) : null;
    if (
      row.level === "insert" &&
      parent?.level === "variantType" &&
      variantTypeKind(parent) === "parallel" &&
      parent.parentId
    ) {
      // The insert's own Parallel type first (its structural parent), then
      // the set's Base, then on up from the set.
      if (!push(parent)) break;
      const base = await baseVariantTypeOf(ctx, parent.parentId, cache);
      if (base) push(base);
      row = await rowFor(ctx, parent.parentId, cache);
      continue;
    }
    row = parent;
  }
  return chain;
}

/** The row's own stored value of `kind`, or undefined when it stores none. */
export function ownCardPlayerDefault(
  row: Pick<SelectorRow, "defaultPlayerIds" | "defaultCameoIds">,
  kind: CardPlayerDefaultKind,
): ReadonlyArray<Id<"players">> | undefined {
  const list = kind === "player" ? row.defaultPlayerIds : row.defaultCameoIds;
  return list && list.length > 0 ? list : undefined;
}

/** A player as the panel and the card writers show them. */
export type NamedPlayer = { _id: Id<"players">; name: string };

/**
 * What a NEW card on `leafId` is born with. The planners take it as it is
 * (`playerId` / `cameoIds`); the names ride along for the writers that need
 * them (`nameOnCard`, Signed By, the listing text).
 *
 *   - `playerFromId` / `cameosFromId`: the row whose value won, or null when
 *     no row in the chain stores one. A winning value whose player is gone
 *     (or plays another sport than the card) is dropped, not replaced by a
 *     farther row's: nearest wins as a whole.
 *   - `player` / `playerId`: the default player, after that drop.
 *   - `cameos` / `cameoIds`: the default cameos, in stored order, after that
 *     drop, without the default player.
 *
 * `sportId` is the card's sport; omitted, the sport row at the top of the
 * chain is used, and with no sport row nothing is dropped for sport. Never
 * refuses: a default that no longer fits is left off the card.
 */
export type EffectiveCardPlayerDefaults = CardPlayerDefaultIds & {
  player: NamedPlayer | null;
  cameos: NamedPlayer[];
  playerFromId: Id<"selectorOptions"> | null;
  cameosFromId: Id<"selectorOptions"> | null;
};

export async function effectiveCardPlayerDefaults(
  ctx: ReadCtx,
  leafId: Id<"selectorOptions">,
  opts: { sportId?: Id<"selectorOptions">; cache?: SelectorRowCache } = {},
): Promise<EffectiveCardPlayerDefaults> {
  const chain = await cardPlayerDefaultsChain(ctx, leafId, opts.cache);
  const playerFrom = chain.find((row) => ownCardPlayerDefault(row, "player"));
  const cameosFrom = chain.find((row) => ownCardPlayerDefault(row, "cameo"));
  const sportId = opts.sportId ?? chain.find((row) => row.level === "sport")?._id;
  const fits = new Map<string, NamedPlayer | null>();
  const resolve = async (id: Id<"players">): Promise<NamedPlayer | null> => {
    const key = id as string;
    if (fits.has(key)) return fits.get(key) ?? null;
    const player = await ctx.db.get(id);
    const ok =
      player !== null &&
      (sportId === undefined || (await playerBelongsToSport(ctx as QueryCtx, player, sportId)));
    const named = ok && player ? { _id: player._id, name: player.name } : null;
    fits.set(key, named);
    return named;
  };
  const playerId = playerFrom ? ownCardPlayerDefault(playerFrom, "player")![0] : undefined;
  const player = playerId ? await resolve(playerId) : null;
  const cameos: NamedPlayer[] = [];
  const seen = new Set<string>(player ? [player._id as string] : []);
  for (const id of (cameosFrom ? ownCardPlayerDefault(cameosFrom, "cameo") : undefined) ?? []) {
    if (seen.has(id as string)) continue;
    seen.add(id as string);
    const named = await resolve(id);
    if (named) cameos.push(named);
  }
  return {
    playerId: player?._id ?? null,
    cameoIds: cameos.map((c) => c._id),
    player,
    cameos,
    playerFromId: playerFrom?._id ?? null,
    cameosFromId: cameosFrom?._id ?? null,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// The walk down: the rows a run walks
// ───────────────────────────────────────────────────────────────────────────

/** Levels a card can sit on (`cardChecklist.selectorOptionId`). */
const CARD_LEVELS: ReadonlySet<string> = new Set(["variantType", "insert", "parallel"]);

const targetValidator = v.object({
  _id: v.id("selectorOptions"),
  /** The row's own NB name. */
  name: v.string(),
  /** The row asked about or a row beneath it, or one of their parallels. */
  role: v.union(v.literal("home"), v.literal("parallel")),
  /** Home cards on this row (`selectorOptions.cardCount`); absent = unknown (never counted, holds cards). */
  cardCount: v.optional(v.number()),
});

type Target = typeof targetValidator.type;

type Candidate = {
  row: SelectorRow;
  role: "home" | "parallel";
  /** A row between this one and the root stores its own value of that kind. */
  overridden: Record<CardPlayerDefaultKind, boolean>;
  /**
   * Home cards on the row: its `cardCount`, or 0 when it was never counted
   * and a probe found no card on it. Absent = unknown (never counted, and
   * either a probe found a card or the probes ran out).
   */
  cards?: number;
};

/**
 * Every card-holding row a run from `rootId` could reach, in walk order, with
 * whether each is overridden per kind. The order:
 *
 *   1. the root and every row beneath it, depth first, children in index
 *      order (`by_parent`);
 *   2. when the root is a Base variant type, the inserts under the set's
 *      Parallel variant types and their rows (the base set's parallels).
 *
 * That is exactly the set of rows whose `cardPlayerDefaultsChain` passes
 * through the root; each candidate's chain is read (from the cache the walk
 * filled) and a candidate whose chain reaches a row with its own value
 * BEFORE the root is overridden for that kind. Only HOME cards are touched
 * later (`by_selector_option`): a card cross-listed into a checklist belongs
 * to the set it was printed in.
 */
async function everyCardWalk(
  ctx: ReadCtx,
  rootId: Id<"selectorOptions">,
): Promise<{ root: SelectorRow; candidates: Candidate[]; truncated: boolean }> {
  const cache = newSelectorRowCache();
  const root = await rowFor(ctx, rootId, cache);
  if (!root) throw new ConvexError(DEFAULT_ROW_MISSING);
  const found: Array<{ row: SelectorRow; role: "home" | "parallel" }> = [];
  const seen = new Set<string>();
  let read = 0;
  let truncated = false;

  const children = async (parentId: Id<"selectorOptions">): Promise<SelectorRow[]> => {
    const room = MAX_EVERY_CARD_WALK - read;
    if (room <= 0) {
      truncated = true;
      return [];
    }
    const rows = await ctx.db
      .query("selectorOptions")
      .withIndex("by_parent", (q) => q.eq("parentId", parentId))
      .take(room + 1);
    if (rows.length > room) truncated = true;
    const kept = rows.slice(0, room);
    read += kept.length;
    for (const row of kept) cache.rows.set(row._id as string, row);
    return kept;
  };

  const walk = async (starts: SelectorRow[], parallel: boolean) => {
    const stack = [...starts].reverse().map((row) => ({ row, parallel }));
    while (stack.length > 0) {
      const { row, parallel: isParallel } = stack.pop()!;
      if (seen.has(row._id as string)) continue;
      seen.add(row._id as string);
      if (CARD_LEVELS.has(row.level)) {
        if (found.length >= MAX_EVERY_CARD_TARGETS) {
          truncated = true;
          return;
        }
        found.push({ row, role: isParallel || row.level === "parallel" ? "parallel" : "home" });
      }
      if (row.level === "parallel") continue; // nothing sits below a parallel
      const kids = await children(row._id);
      const kidsParallel =
        isParallel || (row.level === "variantType" && variantTypeKind(row) === "parallel");
      for (let i = kids.length - 1; i >= 0; i--) stack.push({ row: kids[i], parallel: kidsParallel });
    }
  };

  await walk([root], false);
  if (root.level === "variantType" && variantTypeKind(root) === "base" && root.parentId) {
    const setId = root.parentId;
    const types = await ctx.db
      .query("selectorOptions")
      .withIndex("by_level_and_parent", (q) => q.eq("level", "variantType").eq("parentId", setId))
      .take(MAX_VARIANT_TYPES);
    cache.bases.set(setId as string, root);
    for (const type of types) {
      if (type._id === root._id || variantTypeKind(type) !== "parallel") continue;
      cache.rows.set(type._id as string, type);
      const inserts = (await children(type._id)).filter((row) => row.level === "insert");
      await walk(inserts, true);
    }
  }

  const candidates: Candidate[] = [];
  let probes = 0;
  for (const { row, role } of found) {
    const chain = await cardPlayerDefaultsChain(ctx, row._id, cache);
    const at = chain.findIndex((r) => r._id === root._id);
    if (at === -1) continue; // not reached through the root after all
    const nearer = chain.slice(0, at);
    // A row never counted is most often a hand-made one with no cards yet:
    // one indexed read tells "empty" from "unknown", so an empty checklist
    // is not walked (or confirmed) as if it might hold cards.
    let cards = row.cardCount;
    if (cards === undefined && probes < MAX_UNCOUNTED_PROBES) {
      probes++;
      const first = await ctx.db
        .query("cardChecklist")
        .withIndex("by_selector_option", (q) => q.eq("selectorOptionId", row._id))
        .first();
      if (first === null) cards = 0;
    }
    candidates.push({
      row,
      role,
      overridden: {
        player: nearer.some((r) => ownCardPlayerDefault(r, "player") !== undefined),
        cameo: nearer.some((r) => ownCardPlayerDefault(r, "cameo") !== undefined),
      },
      ...(cards !== undefined ? { cards } : {}),
    });
  }
  return { root, candidates, truncated };
}

/**
 * The card-holding rows a run of `kind` from `rootId` walks, in order, and
 * how many rows it leaves out because a nearer row stores its own value of
 * that kind (`overridden`). `truncated` when the walk hit a cap. A row known
 * to hold no cards (`cardCount` 0, or never counted and probed empty) is not
 * walked: an empty checklist has nothing to bring along, so a run over only
 * such rows has no targets and the panel just saves.
 */
export async function bulkTargets(
  ctx: ReadCtx,
  rootId: Id<"selectorOptions">,
  kind: CardPlayerDefaultKind,
): Promise<{ targets: Target[]; truncated: boolean; overridden: number }> {
  const { candidates, truncated } = await everyCardWalk(ctx, rootId);
  const targets: Target[] = [];
  let overridden = 0;
  for (const c of candidates) {
    if (c.overridden[kind]) {
      overridden++;
      continue;
    }
    if (c.cards === 0) continue;
    targets.push({
      _id: c.row._id,
      name: c.row.value,
      role: c.role,
      ...(c.cards !== undefined ? { cardCount: c.cards } : {}),
    });
  }
  return { targets, truncated, overridden };
}

/**
 * The rows a run will walk, for the progress ledger. `kind` must be the kind
 * of the run the ledger follows (`addPlayerToVariant` walks "player",
 * `addCameoToVariant` "cameo"): the pages refuse a cursor whose row list
 * differs. `variantId` may be a row at any level.
 */
export const everyCardTargets = query({
  args: { variantId: v.id("selectorOptions"), kind: kindValidator },
  returns: v.object({
    targets: v.array(targetValidator),
    truncated: v.boolean(),
    overridden: v.number(),
  }),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    return await bulkTargets(ctx, args.variantId, args.kind);
  },
});

// ───────────────────────────────────────────────────────────────────────────
// The stored values
// ───────────────────────────────────────────────────────────────────────────

const ownDefaultsValidator = v.object({
  playerId: v.union(v.id("players"), v.null()),
  cameoIds: v.array(v.id("players")),
});

const defaultArgs = {
  /** The row the value is stored on: any level. */
  selectorOptionId: v.id("selectorOptions"),
  kind: kindValidator,
  playerId: v.id("players"),
};

function ownDefaults(row: Pick<SelectorRow, "defaultPlayerIds" | "defaultCameoIds">) {
  return {
    playerId: row.defaultPlayerIds?.[0] ?? null,
    cameoIds: [...(row.defaultCameoIds ?? [])],
  };
}

async function writeDefaults(
  ctx: MutationCtx,
  row: SelectorRow,
  next: { players: Array<Id<"players">>; cameos: Array<Id<"players">> },
  log: { op: "set" | "clear"; kind: CardPlayerDefaultKind; playerId: Id<"players">; userId: string },
) {
  const same = (a: ReadonlyArray<Id<"players">> | undefined, b: ReadonlyArray<Id<"players">>) =>
    (a ?? []).length === b.length && (a ?? []).every((id, i) => id === b[i]);
  const changed = !same(row.defaultPlayerIds, next.players) || !same(row.defaultCameoIds, next.cameos);
  if (changed) {
    // Absent when empty; no lastUpdated bump (that stamp is the sync's).
    await ctx.db.patch(row._id, {
      defaultPlayerIds: next.players.length > 0 ? next.players : undefined,
      defaultCameoIds: next.cameos.length > 0 ? next.cameos : undefined,
    });
  }
  // Ids only.
  console.log(
    JSON.stringify({
      msg: "card_player_default",
      ...log,
      selectorOptionId: row._id,
      level: row.level,
      changed,
    }),
  );
  return { playerId: next.players[0] ?? null, cameoIds: next.cameos };
}

/**
 * Store a default on one row. `player`: they become the row's player,
 * replacing any other, and leave the row's cameos if they were one. `cameo`:
 * added to the row's cameos (refused when they are the row's player, or past
 * `MAX_CARD_PLAYERS`). Edits no card: the panel runs `addPlayerToVariant` /
 * `addCameoToVariant` afterwards for the cards already there. Returns the
 * row's own values after the write.
 */
export const setCardPlayerDefault = mutation({
  args: defaultArgs,
  returns: ownDefaultsValidator,
  handler: async (ctx, args) => {
    const userId = await requireAdmin(ctx);
    const row = await ctx.db.get(args.selectorOptionId);
    if (!row) throw new ConvexError(DEFAULT_ROW_MISSING);
    const player = await ctx.db.get(args.playerId);
    if (!player) throw new ConvexError(BULK_MISSING_PLAYER);
    // The row's sport, from the same walk a new card's lookup takes (the row
    // itself when it IS the sport). A player who doesn't play it would be
    // dropped from every card it reaches, so it is refused here rather than
    // stored to do nothing. No sport in the chain: nothing to check against.
    const sport = (await cardPlayerDefaultsChain(ctx, row._id)).find((r) => r.level === "sport");
    if (sport && !(await playerBelongsToSport(ctx, player, sport._id))) {
      throw new ConvexError(wrongSportMessage(player.name, sport.value));
    }
    const own = ownDefaults(row);
    const players = own.playerId ? [own.playerId] : [];
    let cameos = own.cameoIds;
    let nextPlayers = players;
    if (args.kind === "player") {
      nextPlayers = [args.playerId];
      cameos = cameos.filter((id) => id !== args.playerId);
    } else if (!cameos.includes(args.playerId)) {
      if (players.includes(args.playerId)) throw new ConvexError(alreadyThePlayerMessage(player.name));
      if (cameos.length >= MAX_CARD_PLAYERS) throw new ConvexError(DEFAULT_CAMEOS_FULL);
      cameos = [...cameos, args.playerId];
    }
    return await writeDefaults(ctx, row, { players: nextPlayers, cameos }, {
      op: "set",
      kind: args.kind,
      playerId: args.playerId,
      userId,
    });
  },
});

/**
 * Take a stored default off one row: the player (when it is `playerId`) or
 * one cameo. Edits no card: cards that already carry them keep them. A value
 * that is not stored is a no-op. Returns the row's own values after.
 */
export const clearCardPlayerDefault = mutation({
  args: defaultArgs,
  returns: ownDefaultsValidator,
  handler: async (ctx, args) => {
    const userId = await requireAdmin(ctx);
    const row = await ctx.db.get(args.selectorOptionId);
    if (!row) throw new ConvexError(DEFAULT_ROW_MISSING);
    const own = ownDefaults(row);
    const players = own.playerId && !(args.kind === "player" && own.playerId === args.playerId) ? [own.playerId] : [];
    const cameos = args.kind === "cameo" ? own.cameoIds.filter((id) => id !== args.playerId) : own.cameoIds;
    return await writeDefaults(ctx, row, { players, cameos }, {
      op: "clear",
      kind: args.kind,
      playerId: args.playerId,
      userId,
    });
  },
});

const namedPlayerValidator = v.object({ _id: v.id("players"), name: v.string() });

/**
 * What the attributes panel shows for one row:
 *
 *   - `own`: the row's stored player and cameos (players no longer in NB are
 *     left out);
 *   - `inherited`: per field, the nearest row ABOVE it (its
 *     `cardPlayerDefaultsChain` past itself) that stores a value, with that
 *     row's id and name. What a new card here gets when `own` is empty.
 *   - `cardCount`: home cards on every card-holding row a run from here could
 *     reach; `cardsToWalk`: of those, the cards a run of each kind would walk
 *     (a nearer row's own value leaves its cards out). A row never counted
 *     is probed for a first card (none: 0). Both absent when the walk hit a
 *     cap or a never-counted row holds cards (unknown, not zero).
 *
 * Null when the row is gone. Reads at most `MAX_EVERY_CARD_WALK` rows below.
 */
export const cardPlayerDefaults = query({
  args: { selectorOptionId: v.id("selectorOptions") },
  returns: v.union(
    v.null(),
    v.object({
      own: v.object({ player: v.optional(namedPlayerValidator), cameos: v.array(namedPlayerValidator) }),
      inherited: v.optional(
        v.object({
          player: v.optional(
            v.object({
              fromId: v.id("selectorOptions"),
              fromName: v.string(),
              _id: v.id("players"),
              name: v.string(),
            }),
          ),
          cameos: v.optional(
            v.object({
              fromId: v.id("selectorOptions"),
              fromName: v.string(),
              list: v.array(namedPlayerValidator),
            }),
          ),
        }),
      ),
      cardCount: v.optional(v.number()),
      cardsToWalk: v.optional(v.object({ player: v.number(), cameo: v.number() })),
      truncated: v.boolean(),
    }),
  ),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const row = await ctx.db.get(args.selectorOptionId);
    if (!row) return null;
    const names = new Map<string, NamedPlayer | null>();
    const named = async (id: Id<"players">) => {
      const key = id as string;
      if (!names.has(key)) {
        const player = await ctx.db.get(id);
        names.set(key, player ? { _id: player._id, name: player.name } : null);
      }
      return names.get(key) ?? null;
    };
    const namedList = async (ids: ReadonlyArray<Id<"players">> | undefined) => {
      const out: NamedPlayer[] = [];
      for (const id of ids ?? []) {
        const p = await named(id);
        if (p) out.push(p);
      }
      return out;
    };

    const ownPlayer = row.defaultPlayerIds?.[0] ? await named(row.defaultPlayerIds[0]) : null;
    const own = { ...(ownPlayer ? { player: ownPlayer } : {}), cameos: await namedList(row.defaultCameoIds) };

    const above = (await cardPlayerDefaultsChain(ctx, row._id)).slice(1);
    const playerFrom = above.find((r) => ownCardPlayerDefault(r, "player"));
    const cameosFrom = above.find((r) => ownCardPlayerDefault(r, "cameo"));
    const inheritedPlayer = playerFrom ? await named(playerFrom.defaultPlayerIds![0]) : null;
    const inheritedCameos = cameosFrom ? await namedList(cameosFrom.defaultCameoIds) : [];
    const inherited = {
      ...(playerFrom && inheritedPlayer
        ? { player: { fromId: playerFrom._id, fromName: playerFrom.value, ...inheritedPlayer } }
        : {}),
      ...(cameosFrom && inheritedCameos.length > 0
        ? { cameos: { fromId: cameosFrom._id, fromName: cameosFrom.value, list: inheritedCameos } }
        : {}),
    };

    const { candidates, truncated } = await everyCardWalk(ctx, row._id);
    let cardCount = 0;
    const toWalk = { player: 0, cameo: 0 };
    let known = !truncated;
    for (const c of candidates) {
      const n = c.cards;
      if (n === undefined) {
        known = false;
        break;
      }
      cardCount += n;
      if (!c.overridden.player) toWalk.player += n;
      if (!c.overridden.cameo) toWalk.cameo += n;
    }
    return {
      own,
      ...(Object.keys(inherited).length > 0 ? { inherited } : {}),
      ...(known ? { cardCount, cardsToWalk: toWalk } : {}),
      truncated,
    };
  },
});

// ───────────────────────────────────────────────────────────────────────────
// One page of a run
// ───────────────────────────────────────────────────────────────────────────

const bulkPageValidator = v.object({
  /** The row this page worked in (`everyCardTargets` order). */
  targetId: v.id("selectorOptions"),
  targetIndex: v.number(),
  targetCount: v.number(),
  /** Cards this page read. */
  scanned: v.number(),
  /**
   * Cards this page changed: for the player add, every card that now names
   * the player (`promoted` ones included); for the cameo add, every card
   * whose cameos gained them.
   */
  changed: v.number(),
  /** Cards already as asked: already the card's player, or already a cameo. */
  unchanged: v.number(),
  /** Player add: of `changed`, the cards where they were a cameo and moved up. */
  promoted: v.number(),
  /** Cameo add: they are already one of the card's own players. */
  skippedPrimary: v.number(),
  /** Cameo add: the card already lists the most cameos it can. */
  skippedFull: v.number(),
  /** Player add: the card already names someone else. */
  skippedOther: v.number(),
  /** Player add: the card has no player yet but a name waiting for review. */
  skippedPending: v.number(),
  /**
   * Either add: the card's sport is one the player doesn't play (a cross-sport
   * set, or a set moved under another sport). Left as it is.
   */
  skippedSport: v.number(),
  /** Player add: changed cards whose generated title was regenerated. */
  titlesRefreshed: v.number(),
  /** Player add: changed cards whose title a person had typed, kept as is. */
  titlesKept: v.number(),
  /** Pass back for the next page; null when every row is done. */
  cursor: v.union(v.string(), v.null()),
});

export type BulkPage = typeof bulkPageValidator.type;
export type BulkOp = CardPlayerDefaultKind;
type Counts = Omit<BulkPage, "targetId" | "targetIndex" | "targetCount" | "cursor">;

/**
 * Where a run is: `i` the target's index in `bulkTargets` order, `t` that
 * target's id (so a row added or removed between pages, which shifts every
 * index after it, is refused rather than walked as the wrong row), and `c`
 * the page cursor inside it. Null for the first page.
 *
 * Bound to the run that handed it out: `v` the row the run started from, `p`
 * the player, `k` the kind. A cursor from one run passed to another (another
 * row, another player, the other add) is refused rather than resumed part
 * way through the wrong checklist.
 */
type BulkCursor = { i: number; t: string | null; c: string | null };
type BulkRun = { variantId: Id<"selectorOptions">; playerId: Id<"players">; op: BulkOp };

export function parseCursor(raw: string | null, run: BulkRun): BulkCursor {
  if (raw === null) return { i: 0, t: null, c: null };
  try {
    const parsed = JSON.parse(raw) as { i?: unknown; t?: unknown; c?: unknown; v?: unknown; p?: unknown; k?: unknown };
    if (
      typeof parsed.i === "number" &&
      Number.isInteger(parsed.i) &&
      parsed.i >= 0 &&
      typeof parsed.t === "string" &&
      (parsed.c === null || typeof parsed.c === "string") &&
      parsed.v === run.variantId &&
      parsed.p === run.playerId &&
      parsed.k === run.op
    ) {
      return { i: parsed.i, t: parsed.t, c: parsed.c };
    }
  } catch {
    // fall through
  }
  throw new ConvexError(BULK_CHECKLIST_CHANGED);
}

function formatCursor(at: { i: number; t: string; c: string | null }, run: BulkRun): string {
  return JSON.stringify({ ...at, v: run.variantId, p: run.playerId, k: run.op });
}

/**
 * Make `player` the card's player (see the module note for which cards). The
 * card has no player and no pending name when this is called.
 */
async function putPlayerOnCard(
  ctx: MutationCtx,
  card: CardRow,
  player: { _id: Id<"players">; name: string },
  promote: boolean,
  cache: StoredCardReadCache,
  counts: Counts,
): Promise<void> {
  const cameos = card.secondaryPlayerIds ?? [];
  // The cameos as the planner leaves them once they are the card's player.
  const nextCameos = promote
    ? planDefaultCameos({ ...card, playerIds: [player._id], playerLinks: [] }, { cameoIds: [] }).ids
    : cameos;

  // What the generator builds for the card as it stands, to tell generated
  // text from typed text.
  const before = await titleForStoredCard(ctx, card, cache);
  const titleUntouched = card.listingTitle === before.title;
  const descriptionUntouched = descriptionIsGenerated(
    card.listingDescription,
    before.inputs,
    await cameoNamesFor(ctx, cameos, cache),
  );

  const playerLinks = [{ playerId: player._id, nameOnCard: player.name }];
  const next: CardRow = { ...card, playerIds: [player._id], playerLinks, secondaryPlayerIds: nextCameos };
  const text: { listingTitle?: string; listingTitleTruncated?: true | undefined; listingDescription?: string } = {};
  if (titleUntouched || descriptionUntouched) {
    const after = await titleForStoredCard(ctx, next, cache);
    if (titleUntouched) {
      text.listingTitle = after.title;
      // As the commit writes it: flagged only when the generator had to cut
      // the core; undefined in a patch clears a flag the old title carried.
      text.listingTitleTruncated = generatedTitleTruncatedFlag(after);
    }
    if (descriptionUntouched) {
      text.listingDescription = generateListingDescription(after.inputs, {
        cameoNames: await cameoNamesFor(ctx, nextCameos, cache),
      });
    }
  }
  if (titleUntouched) counts.titlesRefreshed++;
  else counts.titlesKept++;

  // NEO-254 — the pair, in one literal, same order.
  await ctx.db.patch(card._id, {
    playerIds: [player._id],
    playerLinks,
    lastUpdated: Date.now(),
    ...text,
  });
  await syncCardPlayerLinks(ctx, card._id, [player._id], card.sportId);
  if (promote) {
    await setCardSecondaryPlayers(ctx, { ...next, secondaryPlayerIds: cameos }, nextCameos, {
      dropMissing: true,
      cache,
      // Written above, with the player and the cameos both changed.
      description: "leave",
    });
    counts.promoted++;
  }
  counts.changed++;
}

/**
 * One page of a run, with no auth check: the mutations below check it first.
 * Exported for the read-budget test.
 */
export async function runBulkPage(
  ctx: MutationCtx,
  args: { variantId: Id<"selectorOptions">; playerId: Id<"players">; cursor: string | null },
  op: BulkOp,
): Promise<BulkPage> {
  const cache = newStoredCardReadCache();
  const player = await ctx.db.get(args.playerId);
  if (!player) throw new ConvexError(BULK_MISSING_PLAYER);
  cache.players.set(player._id as string, player.name);
  const run: BulkRun = { variantId: args.variantId, playerId: args.playerId, op };
  const at = parseCursor(args.cursor, run);
  const { targets } = await bulkTargets(ctx, args.variantId, op);
  // The cursor names the row it was handed out for; a checklist whose
  // rows moved under the run would otherwise send this page into a
  // different row's cards with another row's page cursor.
  if (at.i >= targets.length || (at.t !== null && (targets[at.i]._id as string) !== at.t)) {
    throw new ConvexError(BULK_CHECKLIST_CHANGED);
  }
  const target = targets[at.i];
  const page = await ctx.db
    .query("cardChecklist")
    .withIndex("by_selector_option", (q) => q.eq("selectorOptionId", target._id))
    .paginate({ cursor: at.c, numItems: BULK_PAGE });
  const counts: Counts = {
    scanned: 0,
    changed: 0,
    unchanged: 0,
    promoted: 0,
    skippedPrimary: 0,
    skippedFull: 0,
    skippedOther: 0,
    skippedPending: 0,
    skippedSport: 0,
    titlesRefreshed: 0,
    titlesKept: 0,
  };
  // Whether the player plays a card's sport, once per sport per page (the
  // same rule a new card's default follows: a card of another sport never
  // gets them). A card with no sport stamped is not refused for it.
  const sportFits = new Map<string, boolean>();
  const playsCardSport = async (card: CardRow): Promise<boolean> => {
    if (!card.sportId) return true;
    const key = card.sportId as string;
    let fits = sportFits.get(key);
    if (fits === undefined) {
      fits = await playerBelongsToSport(ctx, player, card.sportId);
      sportFits.set(key, fits);
    }
    return fits;
  };
  for (const card of page.page) {
    counts.scanned++;
    if (op === "player") {
      // "Do not alter any cards that already have a player set" (Jason).
      const plan = planDefaultPlayers(card, { playerId: args.playerId });
      if (plan.kind === "fill") {
        if (await playsCardSport(card)) await putPlayerOnCard(ctx, card, player, plan.promote, cache, counts);
        else counts.skippedSport++;
      } else if (plan.kind === "unchanged") counts.unchanged++;
      else if (plan.kind === "skip" && plan.reason === "other") counts.skippedOther++;
      else if (plan.kind === "skip") counts.skippedPending++;
      continue;
    }
    const plan = planDefaultCameos(card, { cameoIds: [args.playerId] });
    if (plan.skippedPrimary.length > 0) {
      counts.skippedPrimary++;
      continue;
    }
    if (plan.already.length > 0) {
      counts.unchanged++;
      continue;
    }
    if (plan.skippedFull.length > 0) {
      counts.skippedFull++;
      continue;
    }
    if (!(await playsCardSport(card))) {
      counts.skippedSport++;
      continue;
    }
    const result = await setCardSecondaryPlayers(ctx, card, plan.ids, { dropMissing: true, cache });
    if (result.changed) counts.changed++;
    else counts.unchanged++;
  }
  const cursor = !page.isDone
    ? formatCursor({ i: at.i, t: target._id, c: page.continueCursor }, run)
    : at.i + 1 < targets.length
      ? formatCursor({ i: at.i + 1, t: targets[at.i + 1]._id, c: null }, run)
      : null;
  return { targetId: target._id, targetIndex: at.i, targetCount: targets.length, ...counts, cursor };
}

async function bulkMutation(
  ctx: MutationCtx,
  args: { variantId: Id<"selectorOptions">; playerId: Id<"players">; cursor: string | null },
  op: BulkOp,
): Promise<BulkPage> {
  const userId = await requireAdmin(ctx);
  const result = await runBulkPage(ctx, args, op);
  // Ids and counts only.
  console.log(
    JSON.stringify({
      msg: "card_players_bulk_page",
      op,
      variantId: args.variantId,
      playerId: args.playerId,
      ...result,
      cursor: undefined,
      done: result.cursor === null,
      userId,
    }),
  );
  return result;
}

const bulkArgs = {
  /**
   * The row the operator is on, at any level; every card-holding row beneath
   * it (and its parallels) comes with it, less rows a nearer value of this
   * kind speaks for (`everyCardTargets` with the same kind lists them).
   */
  variantId: v.id("selectorOptions"),
  playerId: v.id("players"),
  /** Null for the first page; then the `cursor` the last page returned. */
  cursor: v.union(v.string(), v.null()),
};

/**
 * Make one player the card's player on every home card beneath a row (see
 * `bulkArgs.variantId`) that has no player yet, `BULK_PAGE` cards per call. Call again
 * with the returned `cursor` until it is null.
 */
export const addPlayerToVariant = mutation({
  args: bulkArgs,
  returns: bulkPageValidator,
  handler: async (ctx, args) => await bulkMutation(ctx, args, "player"),
});

/**
 * Add one player as a cameo on every home card beneath a row (see
 * `bulkArgs.variantId`), `BULK_PAGE` cards per call. A card where they are already one
 * of the card's own players is skipped and counted (`skippedPrimary`).
 */
export const addCameoToVariant = mutation({
  args: bulkArgs,
  returns: bulkPageValidator,
  handler: async (ctx, args) => await bulkMutation(ctx, args, "cameo"),
});
