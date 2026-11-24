/**
 * NEO-322 — one set of initials, one NB row, at every key that decides identity.
 *
 * The twin of `entityNames.diacritics.test.ts`: `lib/entities/normalize-name.test.ts`
 * pins the function, this file pins the places that USE it. "C.J. Kayfus" on a
 * card and "C. J. Kayfus" on file keyed differently ("cj kayfus" vs
 * "c j kayfus"), so the entity wizard offered a player NB already held as new.
 *
 * Each `describe` is a separate crossing of the round trip that could split one
 * person into two rows: the lookup, `findOrCreate` and the team key. (The review-queue resume key and
 * the durable skip went with their tables, NEO-656.)
 */

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { Id } from "./_generated/dataModel";
import { normalizePlayerName } from "./players";
import { normalizeTeamName } from "./teams";
import { teamRowFields } from "./lib/teamRow";
import { drainScheduled } from "../lib/testing/drain-scheduled";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

// Same reasoning as the diacritics twin: INSERT branches schedule Wikidata
// work, so a THROWING fetch stub and a drain per test. Nothing here is about
// enrichment; every test is about a KEY.
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    (async (url: string | URL) => {
      throw new Error(
        `NEO-322: this test file must not reach the network: ${String(url)}`,
      );
    }) as unknown as typeof fetch,
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const USER = {
  subject: "user_neo322",
  issuer: "https://clerk.example.com",
  tokenIdentifier: "clerk|user_neo322",
  name: "Signed In User",
  role: "admin",
};

async function seedSport(
  t: ReturnType<typeof convexTest>,
): Promise<Id<"selectorOptions">> {
  return t.run(async (ctx) =>
    ctx.db.insert("selectorOptions", {
      level: "sport",
      value: "Baseball",
      sportConfig: { skuCode: "BB", league: "MLB" },
      platformData: {},
      children: [],
      lastUpdated: Date.now(),
    }),
  );
}

describe("players.findByNameAndSport joins initials (NEO-322)", () => {
  test("an unspaced query finds the spaced row", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("players", {
        name: "C. J. Kayfus",
        nameNormalized: normalizePlayerName("C. J. Kayfus"),
        sportId,
        lastUpdated: Date.now(),
      });
    });

    const found = await t
      .withIdentity(USER)
      .query(api.players.findByNameAndSport, { name: "C.J. Kayfus", sportId });
    expect(found?.name).toBe("C. J. Kayfus");
  });

  test("a spaced query finds the unspaced row", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("players", {
        name: "C.J. Kayfus",
        nameNormalized: normalizePlayerName("C.J. Kayfus"),
        sportId,
        lastUpdated: Date.now(),
      });
    });

    const found = await t
      .withIdentity(USER)
      .query(api.players.findByNameAndSport, { name: "C. J. Kayfus", sportId });
    expect(found?.name).toBe("C.J. Kayfus");
  });

  test("findOrCreate returns the existing row rather than minting a second person", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const asUser = t.withIdentity(USER);

    const first = await asUser.mutation(api.players.findOrCreate, {
      name: "C. J. Kayfus",
      sportId,
    });
    const second = await asUser.mutation(api.players.findOrCreate, {
      name: "CJ Kayfus",
      sportId,
    });
    expect(second).toBe(first);

    const rows = await t.run(async (ctx) => ctx.db.query("players").collect());
    expect(rows).toHaveLength(1);
    // The key decides identity; it never rewrites the stored spelling.
    expect(rows[0].name).toBe("C. J. Kayfus");

    await drainScheduled(t);
  });

  test("A. J. Smith and J. A. Smith stay two rows", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const asUser = t.withIdentity(USER);

    const first = await asUser.mutation(api.players.findOrCreate, {
      name: "A. J. Smith",
      sportId,
    });
    const second = await asUser.mutation(api.players.findOrCreate, {
      name: "J. A. Smith",
      sportId,
    });
    expect(second).not.toBe(first);

    await drainScheduled(t);
  });
});

describe("teams key joins initials (NEO-322)", () => {
  test("an unspaced query finds the spaced franchise", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("teams", {
        name: "Texas A & M",
        nameNormalized: normalizeTeamName("Texas A & M"),
        sportId,
        lastUpdated: Date.now(),
      });
    });

    const found = await t
      .withIdentity(USER)
      .query(internal.teams.findByNameAndSport, { name: "Texas A&M", sportId });
    expect(found?.name).toBe("Texas A & M");
  });

  test("teamRowFields derives one key from every spelling, split or whole", () => {
    const keys = [
      teamRowFields({ name: "Texas A&M" }),
      teamRowFields({ name: "Texas AM" }),
      teamRowFields({ name: "Texas A & M" }),
      teamRowFields({ name: "A&M", location: "Texas" }),
    ].map((f) => f.nameNormalized);
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBe("am texas");
  });
});

describe("the commit prelude does not ask about a player NB already holds (NEO-322)", () => {
  test("a card naming 'C.J. Kayfus' with 'C. J. Kayfus' on file reports no unknown", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(USER);
    const { variantTypeId, sportId } = await t.run(async (ctx) => {
      const sportId = await ctx.db.insert("selectorOptions", {
        level: "sport",
        value: "Baseball",
        sportConfig: { skuCode: "BB", league: "MLB" },
        platformData: {},
        children: [],
        lastUpdated: Date.now(),
      });
      const setNameId = await ctx.db.insert("selectorOptions", {
        level: "setName",
        value: "Chrome",
        platformData: {},
        features: { manufacturer: "Topps", season: "2024" },
        parentId: sportId,
        children: [],
        lastUpdated: Date.now(),
      });
      await ctx.db.patch(sportId, { children: [setNameId] });
      const variantTypeId = await ctx.db.insert("selectorOptions", {
        level: "variantType",
        value: "Base",
        platformData: {},
        features: { manufacturer: "Topps", season: "2024" },
        parentId: setNameId,
        children: [],
        lastUpdated: Date.now(),
      });
      await ctx.db.patch(setNameId, { children: [variantTypeId] });
      return { sportId, variantTypeId };
    });
    await t.run(async (ctx) => {
      await ctx.db.insert("players", {
        name: "C. J. Kayfus",
        nameNormalized: normalizePlayerName("C. J. Kayfus"),
        sportId,
        lastUpdated: Date.now(),
      });
    });

    const resolved = await asAdmin.action(
      api.selectorOptions.resolveChecklistEntities,
      {
        selectorOptionId: variantTypeId,
        sportId,
        cards: [
          {
            cardNumber: "1",
            cardName: "Card",
            team: undefined,
            teams: [],
            players: ["C.J. Kayfus"],
            attributes: [],
            isRookie: false,
            isRelic: false,
            printRun: undefined,
            autographType: undefined,
            cardVariation: undefined,
            platformData: {},
            unmatched: undefined,
          },
        ],
      },
    );

    expect(resolved.unknownPlayers).toEqual([]);
    expect(resolved.gateLinks ?? []).toEqual([]);

    await drainScheduled(t);
  });
});
