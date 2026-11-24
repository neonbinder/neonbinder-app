/**
 * NEO-592 — one deterministic world for the review-gate parity tests.
 *
 * `resolveChecklistEntities` was rewritten to read concurrently and to batch its
 * action-to-query hops, and it had to change NOTHING about what it answers. This
 * fixture is the representative set the golden and the differential run drive:
 * every branch the rewrite touched has a name in it.
 *
 *   - fetched players: unique, two in-sport namesakes (ambiguous), an alias hit,
 *     an unknown, a skipped name, a name skipped for ANOTHER kind, a name
 *     skipped in ANOTHER set, a lone namesake in another sport (E2), a name the
 *     prior-year product settles that ALSO has one namesake (E1 beside E2), and
 *     a name two other-sport players share (no preselect);
 *   - fetched teams: unique, by alias, a two-era name settled by the set year,
 *     a closed-era name settled by a card's player (career team), an unknown,
 *     a skipped one, and one whose name is also a skipped PLAYER;
 *   - pending names on the set's own cards: home cards and a cross-listed guest
 *     card, with card numbers chosen so that sorting them (and the tie between a
 *     home and a guest card number) decides the order names are queued in.
 *
 * Rows carry fixed timestamps so two runs of the same fixture are identical.
 * Lives under lib/ so it is never deployed as a Convex module.
 */

import type { convexTest } from "convex-test";
import type { Id } from "../../convex/_generated/dataModel";
import { normalizePlayerName } from "../../convex/players";
import { normalizeTeamName } from "../../convex/teams";
import { insertTestCard } from "./card-row";

type T = ReturnType<typeof convexTest>;
type Sel = Id<"selectorOptions">;

const NOW = 1_700_000_000_000;

export async function node(
  t: T,
  fields: { level: string; value: string; parentId?: Sel },
): Promise<Sel> {
  return t.run(async (ctx) => {
    const id = await ctx.db.insert("selectorOptions", {
      ...fields,
      platformData: {},
      children: [],
      lastUpdated: NOW,
    });
    if (fields.parentId) {
      const parent = await ctx.db.get(fields.parentId);
      await ctx.db.patch(fields.parentId, { children: [...(parent?.children ?? []), id] });
    }
    return id;
  });
}

export async function product(
  t: T,
  sportId: Sel,
  opts: { year: string; brand?: string; set?: string },
) {
  const year = await node(t, { level: "year", value: opts.year, parentId: sportId });
  const brand = await node(t, {
    level: "manufacturer",
    value: opts.brand ?? "Topps",
    parentId: year,
  });
  const set = await node(t, { level: "setName", value: opts.set ?? "Series 1", parentId: brand });
  const base = await node(t, { level: "variantType", value: "Base", parentId: set });
  const insert = await node(t, { level: "variantType", value: "Insert", parentId: set });
  return { year, brand, set, base, insert };
}

export function playerRow(
  t: T,
  sportId: Sel,
  name: string,
  extra: Record<string, unknown> = {},
): Promise<Id<"players">> {
  return t.run((ctx) =>
    ctx.db.insert("players", {
      name,
      nameNormalized: normalizePlayerName(name),
      sportId,
      lastUpdated: NOW,
      ...extra,
    }),
  );
}

export function teamRow(
  t: T,
  sportId: Sel,
  location: string,
  name: string,
  extra: Record<string, unknown> = {},
): Promise<Id<"teams">> {
  return t.run((ctx) =>
    ctx.db.insert("teams", {
      location,
      name,
      nameNormalized: normalizeTeamName(`${location} ${name}`),
      sportId,
      lastUpdated: NOW,
      ...extra,
    }),
  );
}

export function aliasRow(t: T, playerId: Id<"players">, sportId: Sel, alias: string) {
  return t.run((ctx) =>
    ctx.db.insert("playerAliases", {
      playerId,
      sportId,
      aliasNormalized: normalizePlayerName(alias),
    }),
  );
}

/** A committed card on a set node. */
export function committedCard(
  t: T,
  selectorOptionId: Sel,
  cardNumber: string,
  opts: {
    printed?: Array<[nameOnCard: string, playerId: Id<"players">]>;
    pendingPlayerNames?: string[];
    pendingTeamNames?: string[];
  } = {},
): Promise<Id<"cardChecklist">> {
  return t.run((ctx) =>
    insertTestCard(ctx, {
      selectorOptionId,
      cardNumber,
      cardName: "Card",
      platformData: {},
      sortOrder: 0,
      lastUpdated: NOW,
      ...(opts.printed
        ? {
            playerIds: opts.printed.map(([, id]) => id),
            playerLinks: opts.printed.map(([nameOnCard, playerId]) => ({ playerId, nameOnCard })),
          }
        : {}),
      ...(opts.pendingPlayerNames ? { pendingPlayerNames: opts.pendingPlayerNames } : {}),
      ...(opts.pendingTeamNames ? { pendingTeamNames: opts.pendingTeamNames } : {}),
    }),
  );
}

export function crossList(t: T, cardChecklistId: Id<"cardChecklist">, guestSet: Sel) {
  return t.run((ctx) =>
    ctx.db.insert("cardCrossListings", {
      cardChecklistId,
      selectorOptionId: guestSet,
      lastUpdated: NOW,
    }),
  );
}

export type FetchedCard = {
  cardNumber: string;
  cardName: string;
  players: string[];
  teams: string[];
  platformData: Record<string, never>;
};

/** The whole world: returns what a gate call needs and the ids a test asserts on. */
export async function seedGateWorld(t: T) {
  const baseball = await node(t, { level: "sport", value: "Baseball" });
  const football = await node(t, { level: "sport", value: "Football" });
  const hockey = await node(t, { level: "sport", value: "Hockey" });
  const prior = await product(t, baseball, { year: "2023" });
  const now = await product(t, baseball, { year: "2024" });
  // The set a guest card lives in (its home set), another product altogether.
  const other = await product(t, baseball, { year: "2024", set: "Update" });

  // ── players ──
  const trout = await playerRow(t, baseball, "Mike Trout");
  const bobA = await playerRow(t, baseball, "Bob Allen", { birthYear: 1867 });
  const bobB = await playerRow(t, baseball, "Bob Allen", { birthYear: 1937 });
  const vincent = await playerRow(t, baseball, "Vincent Edward Jackson");
  await aliasRow(t, vincent, baseball, "Ricky Alias");
  const boFootball = await playerRow(t, football, "Bo Jackson");
  const marino = await playerRow(t, football, "Dan Marino");
  await playerRow(t, football, "Pat Twin");
  await playerRow(t, hockey, "Pat Twin");
  const browns = {
    early: await teamRow(t, baseball, "St. Louis", "Browns", {
      yearsActive: { from: 1902, to: 1953 },
    }),
    late: await teamRow(t, baseball, "St. Louis", "Browns", {
      yearsActive: { from: 1961, to: 1965 },
    }),
  };
  const veteran = await playerRow(t, baseball, "Browns Veteran", {
    teamYears: [{ teamId: browns.early, fromYear: 1930, toYear: 1931 }],
  });

  // ── teams ──
  const redSox = await teamRow(t, baseball, "Boston", "Red Sox", { aliases: ["Bosox"] });
  await t.run((ctx) =>
    ctx.db.insert("teamAliases", {
      teamId: redSox,
      sportId: baseball,
      aliasNormalized: normalizeTeamName("Bosox"),
    }),
  );
  const jets = {
    old: await teamRow(t, baseball, "Winnipeg", "Jets", { yearsActive: { from: 1972, to: 1996 } }),
    modern: await teamRow(t, baseball, "Winnipeg", "Jets", { yearsActive: { from: 2011 } }),
  };

  // ── history: the prior year's Base links "Dan Marino" to the football man ──
  await committedCard(t, prior.base, "1", { printed: [["Dan Marino", marino]] });
  // The set's own committed card (history for D3).
  await committedCard(t, now.base, "1", { printed: [["Mike Trout", trout]] });

  // ── skips ──
  await skipRow(t, now.insert, "player", "Skipped Person");
  await skipRow(t, now.insert, "team", "Skipped Team");
  await skipRow(t, now.insert, "player", "Dual Name");
  // Another set's skip: must not hide "Other Set Skip" here.
  await skipRow(t, other.insert, "player", "Other Set Skip");

  // ── pending names on the set's own cards ──
  // Sorting is by card number, so the queue order is Amy (2), Guest Mid (3),
  // Tie Home (5, home first), Tie Guest (5), Zed Late (10).
  await committedCard(t, now.insert, "10", {
    pendingPlayerNames: ["Zed Late", "Amy Early"],
    pendingTeamNames: ["Pending Team Z"],
  });
  await committedCard(t, now.insert, "2", {
    pendingPlayerNames: ["Amy Early"],
    pendingTeamNames: ["Pending Team A"],
  });
  await committedCard(t, now.insert, "5", {
    pendingPlayerNames: ["Tie Home"],
    pendingTeamNames: ["Pending Team Tie Home"],
  });
  const guestHome3 = await committedCard(t, other.insert, "3", {
    pendingPlayerNames: ["Guest Mid"],
    pendingTeamNames: ["Pending Team Guest"],
  });
  const guestHome5 = await committedCard(t, other.insert, "5", {
    pendingPlayerNames: ["Tie Guest"],
  });
  await crossList(t, guestHome3, now.insert);
  await crossList(t, guestHome5, now.insert);

  const card = (n: number, players: string[], teams: string[]): FetchedCard => ({
    cardNumber: `I-${n}`,
    cardName: "Card",
    players,
    teams,
    platformData: {},
  });
  const cards: FetchedCard[] = [
    card(1, ["Mike Trout", "Bob Allen"], ["Boston Red Sox"]),
    card(2, ["Ricky Alias", "Stranger Alpha"], ["Bosox", "Winnipeg Jets"]),
    card(3, ["Skipped Person", "Dual Name", "Other Set Skip"], ["Skipped Team", "Dual Name"]),
    card(4, ["Bo Jackson", "Dan Marino", "Pat Twin"], ["Fictional Whalers"]),
    card(5, ["Browns Veteran"], ["St. Louis Browns"]),
    card(6, ["Stranger Beta"], []),
  ];

  return {
    ids: {
      baseball,
      football,
      hockey,
      prior,
      now,
      other,
      trout,
      bobA,
      bobB,
      vincent,
      boFootball,
      marino,
      veteran,
      redSox,
      jets,
      browns,
    },
    cards,
    selectorOptionId: now.insert,
    sportId: baseball,
  };
}
