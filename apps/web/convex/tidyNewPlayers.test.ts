/**
 * NEO-645 (decision 32) — "Add all N new players": `tidyNewPlayers.newPlayerNames`
 * (the eligible list) and `tidyNewPlayers.addNewPlayers` (the write).
 *
 * The list is every name no other answer could take: unanswered player names,
 * lookup finished, nothing on file under the name, near it, or containing it,
 * and not ruled out. The write re-checks every name, creates each player
 * exactly as "Add as new player" does, answers the name (so the fan-out
 * reaches every card printing it), caps a call at 100 deduplicated names and
 * pages the long work.
 */

import { convexTest } from "convex-test";
import { afterEach, describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Doc, Id } from "./_generated/dataModel";
import {
  MAX_NEW_PLAYERS_PER_CALL,
  NEW_PLAYERS_NUMBERS_SHOWN,
  NEW_PLAYERS_PAGE_SIZE,
} from "./tidyNewPlayers";
import { normalizePlayerName } from "./players";
import { cancelScheduled, drainScheduled } from "../lib/testing/drain-scheduled";
import { normalizeEntityName } from "../lib/entities/normalize-name";
import { addPlayer, nameRow, printCard, seedTidyWorld, type TidyWorld } from "../lib/testing/tidy-world";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

const ADMIN = { subject: "user_new_players_admin", role: "admin" };
const MEMBER = { subject: "user_new_players_member" };
type T = ReturnType<typeof convexTest>;

const live: T[] = [];
const newT = () => {
  const t = convexTest(schema, modules);
  live.push(t);
  return t;
};
afterEach(async () => {
  for (const t of live.splice(0)) {
    await drainScheduled(t);
    await cancelScheduled(t);
  }
});

/** A name looked up and found nothing: the settled, unanswered row. */
const LOOKED_UP = { lookupGen: 1, lookupRequestedAt: 1 };

type RowOver = Partial<Doc<"tidyNames">>;
/** A name row plus one card printing it. */
async function seedName(
  t: T,
  w: TidyWorld,
  name: string,
  opts: { over?: RowOver; number?: string; kind?: "player" | "team"; print?: boolean } = {},
): Promise<Id<"cardChecklist"> | null> {
  return t.run(async (ctx) => {
    await nameRow(ctx, {
      scopeId: w.base,
      sportId: w.sport,
      kind: opts.kind ?? "player",
      name,
      over: { ...LOOKED_UP, ...(opts.over ?? {}) },
    });
    if (opts.print === false) return null;
    return printCard(ctx, w, {
      number: opts.number ?? "1",
      printed: [{ kind: opts.kind ?? "player", name }],
    });
  });
}

/**
 * Names far enough apart that none is a near spelling of another (two edits on
 * a long name would be): a fixed list, not a counter.
 */
const SURNAMES = [
  "Abernathy", "Blackwood", "Castellano", "Dovetail", "Eisenhower", "Fairbanks", "Goldsmith", "Hawthorne",
  "Ingersoll", "Jablonski", "Kowalczyk", "Lindqvist", "Montgomery", "Nakamura", "Ostrowski", "Pemberton",
  "Quackenbush", "Rutherford", "Sandoval", "Tillerman", "Underhill", "Vandermeer", "Whitaker", "Yarborough",
  "Zimmerman", "Bellweather", "Cartwright", "Delacroix", "Fitzgerald", "Grimaldi", "Halloran", "Iwasaki",
  "Jankowski", "Kensington", "Lowenstein", "Mastroianni", "Nightingale", "Oppenheimer", "Pendleton", "Rosenthal",
  "Stonebridge", "Thackeray", "Valdespino", "Wolfensohn", "Ashcroft", "Brightwater", "Calloway", "Drummond",
  "Everhart", "Fontaine", "Galloway", "Huntington", "Kirkpatrick", "Lancaster", "Merriweather", "Northcutt",
  "Prendergast", "Quarterman", "Ravenscroft", "Sutherland", "Treadwell", "Underwood", "Winterbourne", "Xanthakis",
  "Yellowhorse", "Zachariah", "Armitage", "Beauregard", "Chamberlain", "Dunleavy", "Esperanza", "Fotheringay",
  "Gallagher", "Hargreaves", "Illingworth", "Jorgensen", "Killingsworth", "Longfellow", "Macnamara", "Nettleton",
  "Oglethorpe", "Pennington", "Quintanilla", "Rockefeller", "Scarborough", "Tennyson", "Umberger", "Vanderbilt",
  "Worthington", "Yanovsky", "Zeitlin", "Archibald", "Bannerman", "Crossthwaite", "Duckworth", "Ellsworth",
  "Farnsworth", "Goodenough", "Hollingsworth", "Ironside", "Jeffcoat", "Knightley", "Lightfoot", "Mountbatten",
];
const distinctNames = (n: number) => SURNAMES.slice(0, n).map((s, i) => `${["Alex", "Bryce", "Cole", "Dane"][i % 4]} ${s}`);

const world = (t: T) => t.run((ctx) => seedTidyWorld(ctx));
const list = (t: T, w: TidyWorld) =>
  t.withIdentity(ADMIN).query(api.tidyNewPlayers.newPlayerNames, { leafId: w.base });
const add = (t: T, w: TidyWorld, names: string[]) =>
  t.withIdentity(ADMIN).mutation(api.tidyNewPlayers.addNewPlayers, { leafId: w.base, names });
const listed = async (t: T, w: TidyWorld) => (await list(t, w)).names.map((n) => n.name);
const players = (t: T) => t.run((ctx) => ctx.db.query("players").collect());
const card = (t: T, id: Id<"cardChecklist">) => t.run((ctx) => ctx.db.get(id));
const rowFor = (t: T, w: TidyWorld, name: string) =>
  t.run((ctx) =>
    ctx.db
      .query("tidyNames")
      .withIndex("by_scope_kind_name", (q) =>
        q.eq("scopeId", w.base).eq("kind", "player").eq("nameNormalized", normalizeEntityName(name)),
      )
      .first(),
  );

describe("newPlayerNames — who is on the list", () => {
  test("a name looked up and found nothing is offered, with the card numbers that print it", async () => {
    const t = newT();
    const w = await world(t);
    await seedName(t, w, "Quinn Rookie", { number: "4" });
    await t.run((ctx) => printCard(ctx, w, { number: "17", printed: [{ kind: "player", name: "Quinn Rookie" }] }));
    expect(await list(t, w)).toEqual({
      names: [{ name: "Quinn Rookie", cardNumbers: ["4", "17"], moreCards: false }],
      more: false,
    });
  });

  test("lists at most a handful of card numbers and says there are more", async () => {
    const t = newT();
    const w = await world(t);
    await seedName(t, w, "Quinn Rookie", { number: "1" });
    for (let n = 2; n <= NEW_PLAYERS_NUMBERS_SHOWN + 3; n++) {
      await t.run((ctx) => printCard(ctx, w, { number: String(n), printed: [{ kind: "player", name: "Quinn Rookie" }] }));
    }
    const [only] = (await list(t, w)).names;
    expect(only.cardNumbers).toHaveLength(NEW_PLAYERS_NUMBERS_SHOWN);
    expect(only.moreCards).toBe(true);
  });

  test("a name whose Wikidata match is exactly one person is offered (a match is what Add as new player uses)", async () => {
    const t = newT();
    const w = await world(t);
    await seedName(t, w, "Quinn Rookie", { over: { enrichment: { wikidataId: "Q123", description: "baseball player" } } });
    expect(await listed(t, w)).toEqual(["Quinn Rookie"]);
  });

  test("sorted by name", async () => {
    const t = newT();
    const w = await world(t);
    await seedName(t, w, "Zed Rookie", { number: "1" });
    await seedName(t, w, "Abe Rookie", { number: "2" });
    expect(await listed(t, w)).toEqual(["Abe Rookie", "Zed Rookie"]);
  });

  describe("is not offered when", () => {
    const NAME = "Quinn Rookie";
    const cases: Array<[string, (t: T, w: TidyWorld) => Promise<unknown>]> = [
      ["it is answered with a link", async (t, w) => {
        const id = await t.run((ctx) => addPlayer(ctx, w, "Someone Else"));
        await seedName(t, w, NAME, { over: { answer: { kind: "linkPlayer", playerId: id, by: "operator" } } });
      }],
      ["the operator ruled it out as not a player", (t, w) =>
        seedName(t, w, NAME, { over: { answer: { kind: "notEntity", by: "operator" } } })],
      ["NB ruled it out itself (same as its team)", (t, w) =>
        seedName(t, w, NAME, { over: { answer: { kind: "notEntity", by: "auto", autoReason: "sameAsTeam" } } })],
      ["its lookup is still pending", (t, w) => seedName(t, w, NAME, { over: { status: "pending" } })],
      ["its lookup errored", (t, w) => seedName(t, w, NAME, { over: { status: "error" } })],
      ["nobody has asked Wikidata about it (a migrated row)", (t, w) =>
        seedName(t, w, NAME, { over: { lookupGen: undefined, lookupRequestedAt: undefined } })],
      ["the row carries a same-name choice", async (t, w) => {
        const a = await t.run((ctx) => addPlayer(ctx, w, "Other Person"));
        await seedName(t, w, NAME, {
          over: { enrichment: { existingCandidates: [{ playerId: a, name: NAME, careerSummary: "" }] } },
        });
      }],
      ["the row carries a preselect", async (t, w) => {
        const a = await t.run((ctx) => addPlayer(ctx, w, "Other Person"));
        await seedName(t, w, NAME, {
          over: {
            enrichment: {
              preselect: { playerId: a, name: "Other Person", sportId: w.sport, sportValue: "Baseball", reason: "onlyNamesake" },
            },
          },
        });
      }],
      ["the row is a team name", (t, w) => seedName(t, w, NAME, { kind: "team" })],
      ["no card prints it any more", (t, w) => seedName(t, w, NAME, { print: false })],
      ["a player of that name is on file", async (t, w) => {
        await t.run((ctx) => addPlayer(ctx, w, NAME));
        await seedName(t, w, NAME);
      }],
      ["a player answers to it as an alias", async (t, w) => {
        const id = await t.run((ctx) => addPlayer(ctx, w, "Someone Else"));
        await t.run((ctx) =>
          ctx.db.insert("playerAliases", {
            playerId: id,
            sportId: w.sport,
            aliasNormalized: normalizePlayerName(NAME),
          }),
        );
        await seedName(t, w, NAME);
      }],
      ["a near spelling is on file (Did you mean)", async (t, w) => {
        await t.run((ctx) => addPlayer(ctx, w, "Quinn Rookey"));
        await seedName(t, w, NAME);
      }],
      ["it is one word that is a piece of a fuller-named player", async (t, w) => {
        await t.run((ctx) => addPlayer(ctx, w, "Dwight Gooden"));
        await seedName(t, w, "Gooden");
      }],
    ];
    test.each(cases)("%s", async (_why, arrange) => {
      const t = newT();
      const w = await world(t);
      await arrange(t, w);
      // The fixture is not vacuous: a name row exists for the list to have offered.
      expect((await t.run((ctx) => ctx.db.query("tidyNames").collect())).length).toBeGreaterThan(0);
      expect(await listed(t, w)).toEqual([]);
    });
  });

  test("a name of another sport on file does not hold the name back (the row's sport is the question)", async () => {
    const t = newT();
    const w = await world(t);
    const hockey = await t.run((ctx) =>
      ctx.db.insert("selectorOptions", { level: "sport", value: "Hockey", platformData: {}, children: [], lastUpdated: 1 }),
    );
    await t.run((ctx) => addPlayer(ctx, { sport: hockey }, "Quinn Rookie"));
    await seedName(t, w, "Quinn Rookie");
    expect(await listed(t, w)).toEqual(["Quinn Rookie"]);
  });

  test("stops at the cap and says there are more", async () => {
    const t = newT();
    const w = await world(t);
    const many = distinctNames(MAX_NEW_PLAYERS_PER_CALL + 3);
    for (const [i, name] of many.entries()) await seedName(t, w, name, { number: String(i + 1) });
    const out = await list(t, w);
    expect(out.names).toHaveLength(MAX_NEW_PLAYERS_PER_CALL);
    expect(out.more).toBe(true);
  });

  test("reads only the checklist asked about", async () => {
    const t = newT();
    const w = await world(t);
    await seedName(t, w, "Quinn Rookie");
    const elsewhere = await t.withIdentity(ADMIN).query(api.tidyNewPlayers.newPlayerNames, { leafId: w.insert });
    expect(elsewhere).toEqual({ names: [], more: false });
  });
});

describe("addNewPlayers — the write", () => {
  test("creates each player in the row's sport and answers the name for every card printing it", async () => {
    const t = newT();
    const w = await world(t);
    const first = (await seedName(t, w, "Quinn Rookie", { number: "1" }))!;
    const second = await t.run((ctx) =>
      printCard(ctx, w, { number: "2", printed: [{ kind: "player", name: "Quinn Rookie" }] }),
    );
    const other = (await seedName(t, w, "Abe Rookie", { number: "3" }))!;
    const out = await add(t, w, ["Quinn Rookie", "Abe Rookie"]);
    expect(out).toEqual({ created: 2, skipped: 0 });
    const made = await players(t);
    expect(made.map((p) => p.name).sort()).toEqual(["Abe Rookie", "Quinn Rookie"]);
    expect(made.every((p) => p.sportId === w.sport && p.createdByUserId)).toBe(true);
    const quinn = made.find((p) => p.name === "Quinn Rookie")!;
    const row = (await rowFor(t, w, "Quinn Rookie"))!;
    expect(row.answer).toEqual({ kind: "linkPlayer", playerId: quinn._id, by: "operator" });
    expect((await card(t, first))!.playerIds).toEqual([quinn._id]);
    await drainScheduled(t);
    // The fan-out reaches the other card that printed the name.
    expect((await card(t, second))!.playerIds).toEqual([quinn._id]);
    expect((await card(t, second))!.pendingPlayerNames ?? []).toEqual([]);
    expect((await card(t, other))!.playerIds).toEqual([made.find((p) => p.name === "Abe Rookie")!._id]);
  });

  test("is the single path's creation: career teams matched, Wikidata id kept, career check on the anchor card only", async () => {
    const t = newT();
    const w = await world(t);
    const first = (await seedName(t, w, "Quinn Rookie", {
      number: "1",
      over: {
        enrichment: {
          wikidataId: "Q42",
          isHallOfFame: false,
          careerTeams: [
            { name: "San Diego Padres", fromYear: 2023 },
            { name: "Nowhere Club", fromYear: 2022 },
          ],
        },
      },
    }))!;
    const second = await t.run((ctx) =>
      printCard(ctx, w, { number: "2", printed: [{ kind: "player", name: "Quinn Rookie" }] }),
    );
    await add(t, w, ["Quinn Rookie"]);
    await drainScheduled(t);
    const quinn = (await players(t)).find((p) => p.name === "Quinn Rookie")!;
    expect(quinn.externalIds).toEqual({ wikidataId: "Q42" });
    // Matched, never created: the unknown club is dropped.
    expect(quinn.teamYears).toEqual([{ teamId: w.padres, fromYear: 2023 }]);
    const anchor = (await card(t, first))!;
    const fanned = (await card(t, second))!;
    expect(anchor.tidyChecks).toContainEqual({ kind: "newPlayerCareer", playerId: quinn._id });
    expect(fanned.tidyChecks ?? []).not.toContainEqual({ kind: "newPlayerCareer", playerId: quinn._id });
  });

  test("a name that stopped qualifying since the list is skipped and counted, and nothing is created for it", async () => {
    const t = newT();
    const w = await world(t);
    await seedName(t, w, "Quinn Rookie", { number: "1" });
    await seedName(t, w, "Abe Rookie", { number: "2" });
    // Between the list and the press: a player of that name appears.
    await t.run((ctx) => addPlayer(ctx, w, "Quinn Rookie"));
    const out = await add(t, w, ["Quinn Rookie", "Abe Rookie"]);
    expect(out).toEqual({ created: 1, skipped: 1 });
    expect((await players(t)).filter((p) => p.name === "Quinn Rookie")).toHaveLength(1);
    expect((await rowFor(t, w, "Quinn Rookie"))!.answer).toBeUndefined();
  });

  test.each([
    ["answered by hand meanwhile", { answer: { kind: "notEntity", by: "operator" } }],
    ["its lookup went pending again", { status: "pending" }],
    ["errored", { status: "error" }],
  ] as Array<[string, RowOver]>)("a name %s is skipped", async (_why, over) => {
    const t = newT();
    const w = await world(t);
    await seedName(t, w, "Quinn Rookie", { over });
    expect(await add(t, w, ["Quinn Rookie"])).toEqual({ created: 0, skipped: 1 });
    expect(await players(t)).toEqual([]);
  });

  test("a near spelling or a name fragment appearing since is skipped too", async () => {
    const t = newT();
    const w = await world(t);
    await seedName(t, w, "Quinn Rookie", { number: "1" });
    await seedName(t, w, "Gooden", { number: "2" });
    await t.run(async (ctx) => {
      await addPlayer(ctx, w, "Quinn Rookey");
      await addPlayer(ctx, w, "Dwight Gooden");
    });
    expect(await add(t, w, ["Quinn Rookie", "Gooden"])).toEqual({ created: 0, skipped: 2 });
  });

  test("a name nobody asked for, or that is not on this checklist, is skipped", async () => {
    const t = newT();
    const w = await world(t);
    await seedName(t, w, "Quinn Rookie");
    expect(await add(t, w, ["Not Listed Anywhere"])).toEqual({ created: 0, skipped: 1 });
    expect(await players(t)).toEqual([]);
  });

  test("a card changed on its own is not the anchor, and the answer still reaches it only by its own link", async () => {
    const t = newT();
    const w = await world(t);
    await seedName(t, w, "Quinn Rookie", { number: "1" });
    // The only printer was changed on its own (`cardOverride`): nothing can carry the answer.
    await t.run(async (ctx) => {
      const printed = await ctx.db.query("cardPrintedNames").collect();
      for (const p of printed) await ctx.db.patch(p._id, { cardOverride: true });
    });
    expect(await add(t, w, ["Quinn Rookie"])).toEqual({ created: 0, skipped: 1 });
    expect(await players(t)).toEqual([]);
  });

  test("repeats and spelling variants are one name; blanks are ignored", async () => {
    const t = newT();
    const w = await world(t);
    await seedName(t, w, "José Rookie", { number: "1" });
    const out = await add(t, w, ["José Rookie", "Jose Rookie", "  jose  rookie ", "  ", ""]);
    expect(out).toEqual({ created: 1, skipped: 0 });
    expect(await players(t)).toHaveLength(1);
  });

  test("takes exactly the cap, refuses one more, and writes nothing on the refusal", async () => {
    const t = newT();
    const w = await world(t);
    const names = distinctNames;
    await expect(add(t, w, names(MAX_NEW_PLAYERS_PER_CALL + 1))).rejects.toThrow(
      `At most ${MAX_NEW_PLAYERS_PER_CALL} players can be added at once.`,
    );
    expect(await players(t)).toEqual([]);
    // Duplicates do not count toward the cap.
    expect(await add(t, w, [...names(MAX_NEW_PLAYERS_PER_CALL), ...names(5)])).toEqual({
      created: 0,
      skipped: MAX_NEW_PLAYERS_PER_CALL,
    });
  });

  test("refuses a name over the bound, naming the limit and never the value", async () => {
    const t = newT();
    const w = await world(t);
    const long = "Q".repeat(200);
    const error = await add(t, w, [long]).catch((e: Error) => e);
    expect(String((error as Error).message)).toMatch(/the limit is 120/);
    expect(String((error as Error).message)).not.toContain(long);
  });

  test("pages the work: the first page now, the rest by scheduled pages that re-check each name", async () => {
    const t = newT();
    const w = await world(t);
    const total = NEW_PLAYERS_PAGE_SIZE * 2 + 3;
    const names = distinctNames(total);
    for (const [i, name] of names.entries()) await seedName(t, w, name, { number: String(i + 1) });
    // One of the scheduled ones stops qualifying before its page runs.
    await t.run((ctx) => addPlayer(ctx, w, names[total - 1]));
    const out = await add(t, w, names);
    // Accepted for creation: all but none (the clash appears only at its page).
    expect(out).toEqual({ created: total, skipped: 0 });
    expect((await players(t)).filter((p) => names.includes(p.name))).toHaveLength(NEW_PLAYERS_PAGE_SIZE + 1);
    await drainScheduled(t);
    // The last name's player was already on file: its page skipped it.
    expect((await players(t)).filter((p) => names.includes(p.name))).toHaveLength(total);
  });

  test("an admin who adds a list never creates a player for an answered name twice", async () => {
    const t = newT();
    const w = await world(t);
    await seedName(t, w, "Quinn Rookie");
    await add(t, w, ["Quinn Rookie"]);
    expect(await add(t, w, ["Quinn Rookie"])).toEqual({ created: 0, skipped: 1 });
    expect((await players(t)).filter((p) => p.name === "Quinn Rookie")).toHaveLength(1);
  });
});

describe("addNewPlayers and newPlayerNames — who may call", () => {
  test("a signed-out caller and a non-admin are refused and nothing is written", async () => {
    const t = newT();
    const w = await world(t);
    await seedName(t, w, "Quinn Rookie");
    await expect(t.mutation(api.tidyNewPlayers.addNewPlayers, { leafId: w.base, names: ["Quinn Rookie"] })).rejects.toThrow(/not authenticated/i);
    await expect(
      t.withIdentity(MEMBER).mutation(api.tidyNewPlayers.addNewPlayers, { leafId: w.base, names: ["Quinn Rookie"] }),
    ).rejects.toThrow(/admin access required/i);
    await expect(t.query(api.tidyNewPlayers.newPlayerNames, { leafId: w.base })).rejects.toThrow(/not authenticated/i);
    await expect(
      t.withIdentity(MEMBER).query(api.tidyNewPlayers.newPlayerNames, { leafId: w.base }),
    ).rejects.toThrow(/admin access required/i);
    expect(await players(t)).toEqual([]);
  });
});
