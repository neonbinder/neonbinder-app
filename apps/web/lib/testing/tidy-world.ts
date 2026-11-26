/**
 * NEO-645 test fixture — a small real chain (sport > year > brand > set > Base
 * and Insert leaves, plus a parallel leaf), two teams, a few players, and
 * writers for the rows One-card Tidy Up reads: a card that PRINTED names, and
 * a card whose stored title is the generated one (so a title test can tell "generated" from "hand typed").
 *
 * Lives under lib/ so it is never deployed as a Convex module. Every function
 * takes the `ctx` of a `t.run`.
 */

import type { Doc, Id } from "../../convex/_generated/dataModel";
import type { MutationCtx } from "../../convex/_generated/server";
import { newStoredCardReadCache, titleForStoredCard } from "../../convex/storedCardTitle";
import { insertTestCard } from "./card-row";
import { normalizeEntityName } from "../entities/normalize-name";

type Ctx = Pick<MutationCtx, "db">;
type Sel = Id<"selectorOptions">;

export const WORLD_NOW = 1_700_000_000_000;

export async function seedTidyWorld(ctx: Ctx, opts: { sportValue?: string; year?: string } = {}) {
  const node = (
    level: Doc<"selectorOptions">["level"],
    value: string,
    parentId?: Sel,
    extra: Partial<Doc<"selectorOptions">> = {},
  ) =>
    ctx.db.insert("selectorOptions", {
      level,
      value,
      ...(parentId ? { parentId } : {}),
      platformData: {},
      children: [],
      lastUpdated: WORLD_NOW,
      ...extra,
    });
  const sport = await node("sport", opts.sportValue ?? "Baseball");
  const year = await node("year", opts.year ?? "2024", sport);
  const brand = await node("manufacturer", "Topps", year);
  const set = await node("setName", "Chrome", brand);
  const base = await node("variantType", "Base", set);
  const insert = await node("variantType", "Insert", set);
  const parallel = await node("variantType", "Parallel", set);
  const league = await ctx.db.insert("leagues", {
    level: "major",
    name: "Major League Baseball",
    nameNormalized: "baseball league major",
    sportId: sport,
    lastUpdated: WORLD_NOW,
  });
  const padres = await addTeam(ctx, { sport, league }, "San Diego", "Padres");
  const mets = await addTeam(ctx, { sport, league }, "New York", "Mets");
  return { sport, year, brand, set, base, insert, parallel, league, padres, mets };
}
export function addTeam(
  ctx: Ctx,
  w: { sport: Sel; league?: Id<"leagues"> },
  location: string,
  name: string,
  extra: Partial<Doc<"teams">> = {},
): Promise<Id<"teams">> {
  return ctx.db.insert("teams", {
    name,
    location,
    nameNormalized: normalizeEntityName(`${location} ${name}`),
    sportId: w.sport,
    ...(w.league ? { leagueId: w.league } : {}),
    lastUpdated: WORLD_NOW,
    ...extra,
  });
}

export function addPlayer(
  ctx: Ctx,
  w: { sport: Sel },
  name: string,
  teamYears?: Array<{ teamId: Id<"teams">; fromYear?: number; toYear?: number }>,
  extra: Partial<Doc<"players">> = {},
): Promise<Id<"players">> {
  return ctx.db.insert("players", {
    name,
    nameNormalized: normalizeEntityName(name),
    sportId: w.sport,
    ...(teamYears ? { teamYears } : {}),
    lastUpdated: WORLD_NOW,
    ...extra,
  });
}

export type TidyWorld = Awaited<ReturnType<typeof seedTidyWorld>>;

export type PrintedSeed = {
  kind: "player" | "team";
  name: string;
};

/**
 * A card that printed names: the card row. Its pending lists follow `printed`
 * (the names still waiting, in printed order) unless `pending*` or `extra`
 * overrides them. The card is the only record of its names (NEO-656).
 */
export async function printCard(
  ctx: Ctx,
  w: Pick<TidyWorld, "base">,
  args: {
    leaf?: Sel;
    number: string;
    printed?: PrintedSeed[];
    pendingPlayerNames?: string[];
    pendingTeamNames?: string[];
    extra?: Record<string, unknown>;
  },
): Promise<Id<"cardChecklist">> {
  const leaf = args.leaf ?? w.base;
  const players = args.printed?.filter((p) => p.kind === "player") ?? [];
  const teams = args.printed?.filter((p) => p.kind === "team") ?? [];
  const pendingPlayers = args.pendingPlayerNames ?? players.map((p) => p.name);
  const pendingTeams = args.pendingTeamNames ?? teams.map((p) => p.name);
  const id = await insertTestCard(ctx, {
    selectorOptionId: leaf,
    cardNumber: args.number,
    cardName: `Card #${args.number}`,
    platformData: {},
    sortOrder: Number(args.number) || 0,
    lastUpdated: WORLD_NOW,
    ...(pendingPlayers.length > 0 ? { pendingPlayerNames: pendingPlayers } : {}),
    ...(pendingTeams.length > 0 ? { pendingTeamNames: pendingTeams } : {}),
    ...(args.extra ?? {}),
  } as never);
  return id;
}

/** Make the card's stored title the generated one, so retitling treats it as generated. */
export async function stampGeneratedTitle(ctx: Ctx, cardId: Id<"cardChecklist">): Promise<string> {
  const card = (await ctx.db.get(cardId))!;
  const title = (await titleForStoredCard(ctx as never, card, newStoredCardReadCache())).title;
  await ctx.db.patch(cardId, { listingTitle: title });
  return title;
}
