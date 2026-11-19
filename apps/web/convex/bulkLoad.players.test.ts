/**
 * NEO-611 phase 2 — the roster leg of the armed bulk loader (`upsertPlayers` /
 * `previewPlayers`): adopt or create NB players from a roster dataset and add
 * dated stints on teams NB already holds. Each `describe` below is one clause
 * of the plan of record (D1-D7); the NEO-285 adopt-only leg keeps its own
 * file, `bulkLoad.playerStints.test.ts`.
 *
 * Every test asserts the outcome AND the rows left behind (`players`,
 * `playerAliases`, `playerSports`, `_scheduled_functions`): a status alone
 * would stay green while the wrong row was written.
 */

import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { normalizeTeamName } from "./teams";
import { normalizePlayerName } from "./players";
import { BULK_LOAD_PLAYER_OP_BUDGET } from "./bulkLoad";
import {
  MAX_PLAYER_ALIAS_LENGTH,
  MAX_PLAYER_ALIASES,
  MAX_PLAYER_TEAM_YEARS,
  PLAYER_AMBIGUITY_SCAN_LIMIT,
} from "./players";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

const CONFIRM = "BULK_LOAD" as const;
type T = ReturnType<typeof convexTest>;

afterEach(() => vi.unstubAllEnvs());

function armed() {
  vi.stubEnv("ALLOW_BULK_LOAD", "true");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * A load epoch (D4): taken AFTER the fixture was seeded and BEFORE the first
 * load call, with a gap each side so `_creationTime` ordering is unambiguous
 * on a millisecond clock. Rows seeded earlier predate it; rows a load creates
 * afterwards carry it or later.
 */
async function epoch(): Promise<number> {
  await sleep(5);
  const e = Date.now();
  await sleep(5);
  return e;
}

async function seedSport(t: T, value = "Baseball") {
  return t.run(async (ctx) =>
    ctx.db.insert("selectorOptions", {
      level: "sport",
      value,
      platformData: {},
      children: [],
      lastUpdated: 1_700_000_000_000,
    }),
  );
}

async function seedTeam(
  t: T,
  sportId: Id<"selectorOptions">,
  location: string,
  name: string,
) {
  return t.run(async (ctx) =>
    ctx.db.insert("teams", {
      name,
      location,
      nameNormalized: normalizeTeamName(`${location} ${name}`),
      sportId,
      lastUpdated: 1_700_000_000_000,
    }),
  );
}

async function seedPlayer(
  t: T,
  sportId: Id<"selectorOptions">,
  name: string,
  extra: {
    birthYear?: number;
    aliases?: string[];
    teamYears?: Array<{ teamId: Id<"teams">; fromYear?: number; toYear?: number }>;
  } = {},
) {
  return t.run(async (ctx) => {
    const id = await ctx.db.insert("players", {
      name,
      nameNormalized: normalizePlayerName(name),
      sportId,
      ...(extra.birthYear !== undefined ? { birthYear: extra.birthYear } : {}),
      ...(extra.aliases ? { aliases: extra.aliases } : {}),
      ...(extra.teamYears ? { teamYears: extra.teamYears } : {}),
      lastUpdated: 1_700_000_000_000,
    });
    // The flat alias index the real writer keeps beside `players.aliases`.
    for (const alias of extra.aliases ?? []) {
      await ctx.db.insert("playerAliases", {
        playerId: id,
        sportId,
        aliasNormalized: normalizePlayerName(alias),
      });
    }
    return id;
  });
}

async function fixture(t: T) {
  const sportId = await seedSport(t, "Baseball");
  const padres = await seedTeam(t, sportId, "San Diego", "Padres");
  const cubs = await seedTeam(t, sportId, "Chicago", "Cubs");
  return { sportId, padres, cubs };
}

const allPlayers = (t: T) => t.run(async (ctx) => ctx.db.query("players").collect());
const playerRow = (t: T, id: Id<"players">) => t.run(async (ctx) => ctx.db.get(id));
const aliasRows = (t: T) => t.run(async (ctx) => ctx.db.query("playerAliases").collect());
const sportRows = (t: T) => t.run(async (ctx) => ctx.db.query("playerSports").collect());
const scheduled = (t: T) =>
  t.run(async (ctx) => ctx.db.system.query("_scheduled_functions").collect());

type RowIn = {
  key: string;
  name: string;
  birthYear?: number;
  aliases?: string[];
  stints?: Array<{ teamId: Id<"teams">; fromYear?: number; toYear?: number }>;
  decision?: { adopt: Id<"players"> } | { create: true };
};

function load(t: T, loadStartedAt: number, players: RowIn[], extra: { sport?: string } = {}) {
  return t.mutation(internal.bulkLoad.upsertPlayers, {
    confirm: CONFIRM,
    sport: extra.sport ?? "Baseball",
    loadStartedAt,
    players: players.map((p) => ({ ...p, stints: p.stints ?? [] })),
  });
}

function preview(t: T, loadStartedAt: number, players: RowIn[]) {
  return t.query(internal.bulkLoad.previewPlayers, {
    confirm: CONFIRM,
    sport: "Baseball",
    loadStartedAt,
    players: players.map((p) => ({ ...p, stints: p.stints ?? [] })),
  });
}

/** Nothing the loader may leave behind unless a test says otherwise. */
async function expectNoSideEffects(t: T) {
  expect(await sportRows(t)).toEqual([]);
  expect(await scheduled(t)).toEqual([]);
}

describe("the gate", () => {
  test("upsertPlayers unarmed refuses even with the right confirm, and writes nothing", async () => {
    const t = convexTest(schema, modules);
    await fixture(t);
    const e = await epoch();
    await expect(load(t, e, [{ key: "a", name: "Pat White" }])).rejects.toThrow(/not armed/);
    expect(await allPlayers(t)).toEqual([]);
  });

  test("a wrong confirm literal is refused even when armed, and writes nothing", async () => {
    const t = convexTest(schema, modules);
    armed();
    await fixture(t);
    const e = await epoch();
    await expect(
      t.mutation(internal.bulkLoad.upsertPlayers, {
        confirm: "yes" as unknown as typeof CONFIRM,
        sport: "Baseball",
        loadStartedAt: e,
        players: [{ key: "a", name: "Pat White", stints: [] }],
      }),
    ).rejects.toThrow(/Expected `BULK_LOAD`, got `yes`/);
    expect(await allPlayers(t)).toEqual([]);
  });

  test("previewPlayers runs unarmed, reports would-create, and writes nothing", async () => {
    const t = convexTest(schema, modules);
    const f = await fixture(t);
    const e = await epoch();
    const out = await preview(t, e, [
      {
        key: "a",
        name: "Pat White",
        birthYear: 1980,
        aliases: ["Patrick White"],
        stints: [{ teamId: f.padres, fromYear: 2005 }],
      },
    ]);
    expect(out.results[0].status).toBe("would-create");
    expect(await allPlayers(t)).toEqual([]);
    expect(await aliasRows(t)).toEqual([]);
    await expectNoSideEffects(t);
  });

  test("previewPlayers with a wrong confirm is refused by the validator, and writes nothing", async () => {
    // The handler's own "requires confirm" check sits behind the argument
    // validator, so convex-test can only reach the validator's refusal.
    const t = convexTest(schema, modules);
    await fixture(t);
    const e = await epoch();
    await expect(
      t.query(internal.bulkLoad.previewPlayers, {
        confirm: "yes" as unknown as typeof CONFIRM,
        sport: "Baseball",
        loadStartedAt: e,
        players: [{ key: "a", name: "Pat White", stints: [] }],
      }),
    ).rejects.toThrow(/Expected `BULK_LOAD`, got `yes`/);
    expect(await allPlayers(t)).toEqual([]);
  });

  test("a sport the deployment does not hold is refused by name, never created", async () => {
    const t = convexTest(schema, modules);
    armed();
    const e = await epoch();
    await expect(load(t, e, [], { sport: "Curling" })).rejects.toThrow(/No sport row for "Curling"/);
  });

  test("a load epoch in the future is refused by both the mutation and the preview", async () => {
    const t = convexTest(schema, modules);
    armed();
    await fixture(t);
    const future = Date.now() + 60 * 60 * 1000;
    await expect(load(t, future, [{ key: "a", name: "Pat White" }])).rejects.toThrow(
      /loadStartedAt is in the future/,
    );
    await expect(preview(t, future, [{ key: "a", name: "Pat White" }])).rejects.toThrow(
      /loadStartedAt is in the future/,
    );
    expect(await allPlayers(t)).toEqual([]);
  });
});

describe("outcomes: create, adopt, ambiguous (D3)", () => {
  test("no candidate: a row is created with the app's fields, and nothing else", async () => {
    const t = convexTest(schema, modules);
    armed();
    const f = await fixture(t);
    const e = await epoch();
    const out = await load(t, e, [
      {
        key: "a",
        name: "Pat White",
        birthYear: 1980,
        aliases: ["Patrick White"],
        stints: [
          { teamId: f.cubs, fromYear: 2008, toYear: 2010 },
          { teamId: f.padres, fromYear: 2003, toYear: 2007 },
        ],
      },
    ]);
    expect(out.results[0]).toMatchObject({ status: "created", key: "a" });
    const rows = await allPlayers(t);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(out.results[0].playerId).toBe(row._id);
    expect(row).toMatchObject({
      name: "Pat White",
      nameNormalized: normalizePlayerName("Pat White"),
      sportId: f.sportId,
      birthYear: 1980,
      aliases: ["Patrick White"],
    });
    // sortTeamYears: chronological.
    expect(row.teamYears).toEqual([
      { teamId: f.padres, fromYear: 2003, toYear: 2007 },
      { teamId: f.cubs, fromYear: 2008, toYear: 2010 },
    ]);
    expect(row.createdByUserId).toBeUndefined();
    expect(typeof row.lastUpdated).toBe("number");
    await expectNoSideEffects(t);
  });

  test("a created row carries no birthYear, aliases or teamYears keys when none were sent", async () => {
    const t = convexTest(schema, modules);
    armed();
    await fixture(t);
    const e = await epoch();
    await load(t, e, [{ key: "a", name: "Pat White" }]);
    const row = (await allPlayers(t))[0];
    expect("birthYear" in row).toBe(false);
    expect("aliases" in row).toBe(false);
    expect("teamYears" in row).toBe(false);
  });

  test("one candidate whose birth year agrees is adopted, not duplicated", async () => {
    const t = convexTest(schema, modules);
    armed();
    const f = await fixture(t);
    const p = await seedPlayer(t, f.sportId, "Pat White", { birthYear: 1980 });
    const e = await epoch();
    const out = await load(t, e, [
      { key: "a", name: "Pat White", birthYear: 1980, stints: [{ teamId: f.padres, fromYear: 2003 }] },
    ]);
    expect(out.results[0]).toMatchObject({
      status: "adopted",
      playerId: p,
      matchedBy: "name",
      birthYearCheck: "match",
      candidateBirthYear: 1980,
    });
    expect(await allPlayers(t)).toHaveLength(1);
    expect((await playerRow(t, p))!.teamYears).toEqual([{ teamId: f.padres, fromYear: 2003 }]);
  });

  test("one candidate whose birth year CONTRADICTS creates a second person and leaves the first alone", async () => {
    const t = convexTest(schema, modules);
    armed();
    const f = await fixture(t);
    const old = await seedPlayer(t, f.sportId, "Adrian Peterson", { birthYear: 1985 });
    const e = await epoch();
    const out = await load(t, e, [
      { key: "a", name: "Adrian Peterson", birthYear: 1979, stints: [{ teamId: f.padres }] },
    ]);
    expect(out.results[0].status).toBe("created");
    expect(out.results[0].playerId).not.toBe(old);
    const rows = await allPlayers(t);
    expect(rows).toHaveLength(2);
    const before = await playerRow(t, old);
    expect(before!.birthYear).toBe(1985);
    expect(before!.teamYears).toBeUndefined();
    const fresh = rows.find((r) => r._id !== old)!;
    expect(fresh.birthYear).toBe(1979);
    expect(fresh.teamYears).toEqual([{ teamId: f.padres }]);
  });

  test("several candidates, exactly one with the incoming birth year: that one is adopted", async () => {
    const t = convexTest(schema, modules);
    armed();
    const f = await fixture(t);
    const older = await seedPlayer(t, f.sportId, "Adrian Peterson", { birthYear: 1979 });
    const younger = await seedPlayer(t, f.sportId, "Adrian Peterson", { birthYear: 1985 });
    const e = await epoch();
    const out = await load(t, e, [
      { key: "a", name: "Adrian Peterson", birthYear: 1985, stints: [{ teamId: f.cubs }] },
    ]);
    expect(out.results[0]).toMatchObject({
      status: "adopted",
      playerId: younger,
      birthYearCheck: "match",
    });
    expect((await playerRow(t, younger))!.teamYears).toEqual([{ teamId: f.cubs }]);
    expect((await playerRow(t, older))!.teamYears).toBeUndefined();
    expect(await allPlayers(t)).toHaveLength(2);
  });

  test("several candidates, incoming and every candidate dated, none equal: create, forked", async () => {
    const t = convexTest(schema, modules);
    armed();
    const f = await fixture(t);
    const a = await seedPlayer(t, f.sportId, "Adrian Peterson", { birthYear: 1979 });
    const b = await seedPlayer(t, f.sportId, "Adrian Peterson", { birthYear: 1985 });
    const e = await epoch();
    const out = await load(t, e, [{ key: "a", name: "Adrian Peterson", birthYear: 1990 }]);
    expect(out.results[0]).toMatchObject({ status: "created", forked: true });
    const rows = await allPlayers(t);
    expect(rows).toHaveLength(3);
    const fresh = rows.find((r) => r._id !== a && r._id !== b)!;
    expect(fresh.birthYear).toBe(1990);
  });

  test("several candidates and an undated incoming row: ambiguous with the candidates, nothing written", async () => {
    const t = convexTest(schema, modules);
    armed();
    const f = await fixture(t);
    const a = await seedPlayer(t, f.sportId, "Adrian Peterson", { birthYear: 1979 });
    const b = await seedPlayer(t, f.sportId, "Adrian Peterson", { birthYear: 1985 });
    const e = await epoch();
    const out = await load(t, e, [
      { key: "a", name: "Adrian Peterson", stints: [{ teamId: f.padres }], aliases: ["AP"] },
    ]);
    expect(out.results[0].status).toBe("ambiguous");
    expect(out.results[0].playerId).toBeNull();
    expect(out.results[0].candidates?.map((c) => c.id).sort()).toEqual([a, b].sort());
    expect(await allPlayers(t)).toHaveLength(2);
    expect((await playerRow(t, a))!.teamYears).toBeUndefined();
    expect((await playerRow(t, b))!.teamYears).toBeUndefined();
    expect((await aliasRows(t)).filter((r) => r.aliasNormalized === normalizePlayerName("AP"))).toEqual([]);
  });

  test("several candidates where one is undated never fork: ambiguous, nothing written", async () => {
    const t = convexTest(schema, modules);
    armed();
    const f = await fixture(t);
    await seedPlayer(t, f.sportId, "Adrian Peterson", { birthYear: 1979 });
    await seedPlayer(t, f.sportId, "Adrian Peterson");
    const e = await epoch();
    const out = await load(t, e, [{ key: "a", name: "Adrian Peterson", birthYear: 1990 }]);
    expect(out.results[0].status).toBe("ambiguous");
    expect(await allPlayers(t)).toHaveLength(2);
  });

  test("a full scan (8 same-name rows) is ambiguous and never forks, even when every row is dated and none equal", async () => {
    const t = convexTest(schema, modules);
    armed();
    const f = await fixture(t);
    for (let i = 0; i < 8; i++) {
      await seedPlayer(t, f.sportId, "Adrian Peterson", { birthYear: 1960 + i });
    }
    const e = await epoch();
    const out = await load(t, e, [{ key: "a", name: "Adrian Peterson", birthYear: 1999 }]);
    expect(out.results[0].status).toBe("ambiguous");
    expect(out.results[0].forked).not.toBe(true);
    expect(await allPlayers(t)).toHaveLength(8);
  });

  test("a birth year outside the app's bounds is refused before anything is written", async () => {
    const t = convexTest(schema, modules);
    armed();
    await fixture(t);
    const e = await epoch();
    const tooLate = new Date().getFullYear() + 1;
    await expect(load(t, e, [{ key: "a", name: "Pat White", birthYear: 1500 }])).rejects.toThrow(
      /The birth year for "a" is out of range; expected a whole year between/,
    );
    await expect(
      load(t, e, [{ key: "a", name: "Pat White", birthYear: tooLate }]),
    ).rejects.toThrow(/out of range; expected a whole year between/);
    // The message never echoes the offending value (it reaches logs and Sentry).
    for (const year of [1500, tooLate]) {
      const err = await load(t, e, [{ key: "a", name: "Pat White", birthYear: year }]).then(
        () => null,
        (x: unknown) => x as Error,
      );
      expect(err?.message).not.toContain(String(year));
    }
    expect(await allPlayers(t)).toEqual([]);
  });
});

describe("twins are caught by the load epoch (D4)", () => {
  test("two undated keys with one name in ONE call: the first creates, the second is ambiguous created-this-run", async () => {
    const t = convexTest(schema, modules);
    armed();
    await fixture(t);
    const e = await epoch();
    const out = await load(t, e, [
      { key: "a", name: "Chris Young" },
      { key: "b", name: "Chris Young" },
    ]);
    expect(out.results[0].status).toBe("created");
    expect(out.results[1]).toMatchObject({ status: "ambiguous", reason: "created-this-run" });
    expect(out.results[1].candidates?.map((c) => c.id)).toEqual([out.results[0].playerId]);
    expect(out.results[1].candidates?.[0].createdThisRun).toBe(true);
    expect(await allPlayers(t)).toHaveLength(1);
  });

  test("twins across two calls on the same epoch are caught the same way", async () => {
    const t = convexTest(schema, modules);
    armed();
    await fixture(t);
    const e = await epoch();
    const first = await load(t, e, [{ key: "a", name: "Chris Young", birthYear: 1979 }]);
    const second = await load(t, e, [{ key: "b", name: "Chris Young", birthYear: 1979 }]);
    expect(first.results[0].status).toBe("created");
    expect(second.results[0]).toMatchObject({ status: "ambiguous", reason: "created-this-run" });
    expect(await allPlayers(t)).toHaveLength(1);
  });

  test("an undated later key against a row this run created is ambiguous, never held or adopted", async () => {
    const t = convexTest(schema, modules);
    armed();
    await fixture(t);
    const e = await epoch();
    await load(t, e, [{ key: "a", name: "Chris Young", birthYear: 1979 }]);
    const second = await load(t, e, [{ key: "b", name: "Chris Young" }]);
    expect(second.results[0]).toMatchObject({ status: "ambiguous", reason: "created-this-run" });
    expect(await allPlayers(t)).toHaveLength(1);
  });

  test("two keys with one name and DIFFERENT birth years are two people and both create", async () => {
    const t = convexTest(schema, modules);
    armed();
    await fixture(t);
    const e = await epoch();
    const out = await load(t, e, [
      { key: "a", name: "Chris Young", birthYear: 1979 },
      { key: "b", name: "Chris Young", birthYear: 1983 },
    ]);
    expect(out.results.map((r) => r.status)).toEqual(["created", "created"]);
    expect(await allPlayers(t)).toHaveLength(2);
  });

  test("an answer naming the row this run created settles the twin: adopted by decision, no new row", async () => {
    const t = convexTest(schema, modules);
    armed();
    const f = await fixture(t);
    const e = await epoch();
    const first = await load(t, e, [{ key: "a", name: "Chris Young", birthYear: 1979 }]);
    const id = first.results[0].playerId!;
    const second = await load(t, e, [
      {
        key: "b",
        name: "Chris Young",
        birthYear: 1979,
        stints: [{ teamId: f.padres, fromYear: 2004 }],
        decision: { adopt: id },
      },
    ]);
    expect(second.results[0]).toMatchObject({
      status: "adopted",
      playerId: id,
      matchedBy: "decision",
      birthYearCheck: "decision",
    });
    expect(await allPlayers(t)).toHaveLength(1);
    expect((await playerRow(t, id))!.teamYears).toEqual([{ teamId: f.padres, fromYear: 2004 }]);
  });

  test("a row that predates the epoch is an ordinary candidate, not a twin", async () => {
    const t = convexTest(schema, modules);
    armed();
    const f = await fixture(t);
    const p = await seedPlayer(t, f.sportId, "Chris Young", { birthYear: 1979 });
    const e = await epoch();
    const out = await load(t, e, [{ key: "a", name: "Chris Young", birthYear: 1979 }]);
    expect(out.results[0]).toMatchObject({ status: "adopted", playerId: p });
    expect(out.results[0].reason).toBeUndefined();
  });

  test("the preview simulates the twin inside one call, and still writes nothing", async () => {
    const t = convexTest(schema, modules);
    await fixture(t);
    const e = await epoch();
    const out = await preview(t, e, [
      { key: "a", name: "Chris Young" },
      { key: "b", name: "Chris Young" },
    ]);
    expect(out.results[0].status).toBe("would-create");
    expect(out.results[1]).toMatchObject({ status: "ambiguous", reason: "created-this-run" });
    expect(await allPlayers(t)).toEqual([]);
  });
});

describe("every adopt reports a birth-year check (D5)", () => {
  test("match: both dated and equal — adopted, aliases unioned, nothing else changed", async () => {
    const t = convexTest(schema, modules);
    armed();
    const f = await fixture(t);
    const p = await seedPlayer(t, f.sportId, "Pat White", { birthYear: 1980, aliases: ["Patty"] });
    const e = await epoch();
    const out = await load(t, e, [
      { key: "a", name: "Pat White", birthYear: 1980, aliases: ["Patrick White", "patty"] },
    ]);
    expect(out.results[0]).toMatchObject({
      status: "adopted",
      birthYearCheck: "match",
      candidateBirthYear: 1980,
    });
    const row = await playerRow(t, p);
    expect(row!.birthYear).toBe(1980);
    expect([...(row!.aliases ?? [])].sort()).toEqual(["Patrick White", "Patty"]);
    const flat = (await aliasRows(t)).filter((r) => r.playerId === p).map((r) => r.aliasNormalized);
    expect(flat.sort()).toEqual([normalizePlayerName("Patrick White"), normalizePlayerName("Patty")].sort());
  });

  test("candidate-undated: HELD — no stints, no birth year, no aliases, no rows", async () => {
    const t = convexTest(schema, modules);
    armed();
    const f = await fixture(t);
    const p = await seedPlayer(t, f.sportId, "Pat White");
    const e = await epoch();
    const out = await load(t, e, [
      {
        key: "a",
        name: "Pat White",
        birthYear: 1980,
        aliases: ["Patrick White"],
        stints: [{ teamId: f.padres, fromYear: 2003 }],
      },
    ]);
    expect(out.results[0]).toMatchObject({
      status: "held",
      playerId: null,
      birthYearCheck: "candidate-undated",
    });
    expect(out.results[0].candidates?.map((c) => c.id)).toEqual([p]);
    expect(out.results[0].candidateBirthYear).toBeUndefined();
    const row = await playerRow(t, p);
    expect(row!.teamYears).toBeUndefined();
    expect(row!.birthYear).toBeUndefined();
    expect(row!.aliases).toBeUndefined();
    expect(row!.lastUpdated).toBe(1_700_000_000_000);
    expect(await aliasRows(t)).toEqual([]);
    expect(await allPlayers(t)).toHaveLength(1);
    await expectNoSideEffects(t);
  });

  test("incoming-undated: HELD, reports the candidate's birth year, writes nothing", async () => {
    const t = convexTest(schema, modules);
    armed();
    const f = await fixture(t);
    const p = await seedPlayer(t, f.sportId, "Pat White", { birthYear: 1980 });
    const e = await epoch();
    const out = await load(t, e, [
      {
        key: "a",
        name: "Pat White",
        aliases: ["Patrick White"],
        stints: [{ teamId: f.padres, fromYear: 2003 }],
      },
    ]);
    expect(out.results[0]).toMatchObject({
      status: "held",
      playerId: null,
      birthYearCheck: "incoming-undated",
      candidateBirthYear: 1980,
    });
    expect(out.results[0].candidates?.map((c) => c.id)).toEqual([p]);
    const row = await playerRow(t, p);
    expect(row!.teamYears).toBeUndefined();
    expect(row!.aliases).toBeUndefined();
    expect(row!.lastUpdated).toBe(1_700_000_000_000);
    expect(await aliasRows(t)).toEqual([]);
    await expectNoSideEffects(t);
  });

  test("neither side dated: HELD as well (an adopt nothing confirms)", async () => {
    const t = convexTest(schema, modules);
    armed();
    const f = await fixture(t);
    const p = await seedPlayer(t, f.sportId, "Pat White");
    const e = await epoch();
    const out = await load(t, e, [
      { key: "a", name: "Pat White", stints: [{ teamId: f.padres }] },
    ]);
    expect(out.results[0].status).toBe("held");
    expect((await playerRow(t, p))!.teamYears).toBeUndefined();
  });

  test("decision: an answer adopts a dated row, the check says decision, stints and aliases land", async () => {
    const t = convexTest(schema, modules);
    armed();
    const f = await fixture(t);
    const p = await seedPlayer(t, f.sportId, "Pat White", { birthYear: 1980 });
    const e = await epoch();
    const out = await load(t, e, [
      {
        key: "a",
        name: "Pat White",
        aliases: ["Patrick White"],
        stints: [{ teamId: f.padres, fromYear: 2003 }],
        decision: { adopt: p },
      },
    ]);
    expect(out.results[0]).toMatchObject({
      status: "adopted",
      playerId: p,
      matchedBy: "decision",
      birthYearCheck: "decision",
    });
    const row = await playerRow(t, p);
    expect(row!.birthYear).toBe(1980);
    expect(row!.teamYears).toEqual([{ teamId: f.padres, fromYear: 2003 }]);
    expect(row!.aliases).toEqual(["Patrick White"]);
    expect((await aliasRows(t)).map((r) => r.aliasNormalized)).toEqual([
      normalizePlayerName("Patrick White"),
    ]);
  });

  test("a decision adopt FILLS the birth year of an undated row", async () => {
    const t = convexTest(schema, modules);
    armed();
    const f = await fixture(t);
    const p = await seedPlayer(t, f.sportId, "Pat White");
    const e = await epoch();
    await load(t, e, [{ key: "a", name: "Pat White", birthYear: 1980, decision: { adopt: p } }]);
    expect((await playerRow(t, p))!.birthYear).toBe(1980);
  });

  test("a decision adopt whose birth year CONTRADICTS the player's is refused, naming the key and neither year, and writes nothing", async () => {
    const t = convexTest(schema, modules);
    armed();
    const f = await fixture(t);
    const p = await seedPlayer(t, f.sportId, "Pat White", { birthYear: 1980 });
    const before = await snapshot(t);
    const rows: RowIn[] = [
      {
        key: "k1",
        name: "Pat White",
        birthYear: 1975,
        aliases: ["Patrick White"],
        stints: [{ teamId: f.padres, fromYear: 2003 }],
        decision: { adopt: p },
      },
    ];
    for (const run of [
      async () => load(t, await epoch(), rows),
      async () => preview(t, await epoch(), rows),
    ]) {
      const err = await run().then(
        () => null,
        (e: unknown) => e as Error,
      );
      expect(err?.message).toMatch(/The birth year of the player chosen for "k1" contradicts the row/);
      expect(err?.message).not.toMatch(/1975|1980/);
    }
    expect(await snapshot(t)).toEqual(before);
  });

  test("a decision adopt with the SAME birth year on both sides is accepted and leaves it alone", async () => {
    const t = convexTest(schema, modules);
    armed();
    const f = await fixture(t);
    const p = await seedPlayer(t, f.sportId, "Pat White", { birthYear: 1980 });
    const out = await load(t, await epoch(), [
      { key: "a", name: "Pat White", birthYear: 1980, decision: { adopt: p } },
    ]);
    expect(out.results[0]).toMatchObject({ status: "adopted", playerId: p });
    expect((await playerRow(t, p))!.birthYear).toBe(1980);
  });

  test("a decision adopt on a dated player with an undated row is accepted and keeps the player's year", async () => {
    const t = convexTest(schema, modules);
    armed();
    const f = await fixture(t);
    const p = await seedPlayer(t, f.sportId, "Pat White", { birthYear: 1980 });
    const out = await load(t, await epoch(), [{ key: "a", name: "Pat White", decision: { adopt: p } }]);
    expect(out.results[0].status).toBe("adopted");
    expect((await playerRow(t, p))!.birthYear).toBe(1980);
  });

  test("a match adopt never stamps a birth year (nothing to fill: both sides are dated)", async () => {
    const t = convexTest(schema, modules);
    armed();
    const f = await fixture(t);
    const p = await seedPlayer(t, f.sportId, "Pat White", { birthYear: 1980 });
    const e = await epoch();
    await load(t, e, [{ key: "a", name: "Pat White", birthYear: 1980 }]);
    expect((await playerRow(t, p))!.birthYear).toBe(1980);
  });

  test("the preview reports the same held and match verdicts and writes nothing", async () => {
    const t = convexTest(schema, modules);
    const f = await fixture(t);
    const dated = await seedPlayer(t, f.sportId, "Pat White", { birthYear: 1980 });
    const undated = await seedPlayer(t, f.sportId, "Geno Smith");
    const e = await epoch();
    const out = await preview(t, e, [
      { key: "a", name: "Pat White", birthYear: 1980, stints: [{ teamId: f.padres }] },
      { key: "b", name: "Geno Smith", birthYear: 1990, stints: [{ teamId: f.padres }] },
    ]);
    expect(out.results[0]).toMatchObject({
      status: "would-adopt",
      playerId: dated,
      birthYearCheck: "match",
    });
    expect(out.results[1]).toMatchObject({
      playerId: null,
      birthYearCheck: "candidate-undated",
    });
    expect(out.results[1].candidates?.map((c) => c.id)).toEqual([undated]);
    expect(out.results[1].status).toMatch(/held/);
    expect((await playerRow(t, dated))!.teamYears).toBeUndefined();
    expect((await playerRow(t, undated))!.teamYears).toBeUndefined();
  });
});

describe("matching through aliases and sport membership, and replay (D2)", () => {
  test("a player holding the name as an ALIAS is adopted, matchedBy alias", async () => {
    const t = convexTest(schema, modules);
    armed();
    const f = await fixture(t);
    const p = await seedPlayer(t, f.sportId, "Metta World Peace", {
      birthYear: 1979,
      aliases: ["Ron Artest"],
    });
    const e = await epoch();
    const out = await load(t, e, [
      { key: "a", name: "Ron Artest", birthYear: 1979, stints: [{ teamId: f.padres, fromYear: 2000 }] },
    ]);
    expect(out.results[0]).toMatchObject({
      status: "adopted",
      playerId: p,
      matchedBy: "alias",
      birthYearCheck: "match",
    });
    expect(await allPlayers(t)).toHaveLength(1);
    expect((await playerRow(t, p))!.teamYears).toEqual([{ teamId: f.padres, fromYear: 2000 }]);
  });

  test("a player who belongs to the sport through playerSports is a candidate, not a duplicate", async () => {
    const t = convexTest(schema, modules);
    armed();
    const f = await fixture(t);
    const football = await seedSport(t, "Football");
    const bo = await seedPlayer(t, football, "Bo Jackson", { birthYear: 1962 });
    await t.run(async (ctx) =>
      ctx.db.insert("playerSports", {
        playerId: bo,
        sportId: f.sportId,
        nameNormalized: normalizePlayerName("Bo Jackson"),
      }),
    );
    const e = await epoch();
    const out = await load(t, e, [{ key: "a", name: "Bo Jackson", birthYear: 1962 }]);
    expect(out.results[0]).toMatchObject({ status: "adopted", playerId: bo });
    expect(await allPlayers(t)).toHaveLength(1);
    // The pre-existing membership row is the only one; the loader adds none.
    expect(await sportRows(t)).toHaveLength(1);
  });

  test("a replayed adopt that reaches the player through an alias is accepted", async () => {
    const t = convexTest(schema, modules);
    armed();
    const f = await fixture(t);
    const p = await seedPlayer(t, f.sportId, "Metta World Peace", { aliases: ["Ron Artest"] });
    const e = await epoch();
    const out = await load(t, e, [
      { key: "a", name: "Ron Artest", birthYear: 1979, decision: { adopt: p } },
    ]);
    expect(out.results[0]).toMatchObject({ status: "adopted", playerId: p, matchedBy: "decision" });
    expect(await allPlayers(t)).toHaveLength(1);
  });

  test("a replayed adopt naming another person is refused and writes nothing", async () => {
    const t = convexTest(schema, modules);
    armed();
    const f = await fixture(t);
    const other = await seedPlayer(t, f.sportId, "Someone Else");
    const e = await epoch();
    await expect(
      load(t, e, [
        {
          key: "k",
          name: "Pat White",
          stints: [{ teamId: f.padres }],
          decision: { adopt: other },
        },
      ]),
    ).rejects.toThrow(/different person/);
    expect((await playerRow(t, other))!.teamYears).toBeUndefined();
    expect(await allPlayers(t)).toHaveLength(1);
  });

  test("a replayed adopt naming a player in another sport is refused", async () => {
    const t = convexTest(schema, modules);
    armed();
    await fixture(t);
    const football = await seedSport(t, "Football");
    const foreign = await seedPlayer(t, football, "Pat White");
    const e = await epoch();
    await expect(
      load(t, e, [{ key: "k", name: "Pat White", decision: { adopt: foreign } }]),
    ).rejects.toThrow(/is not a player in this sport/);
    expect(await allPlayers(t)).toHaveLength(1);
  });

  test("{create: true} forces a second row even beside an exact, dated match", async () => {
    const t = convexTest(schema, modules);
    armed();
    const f = await fixture(t);
    await seedPlayer(t, f.sportId, "Pat White", { birthYear: 1980 });
    const e = await epoch();
    const out = await load(t, e, [
      { key: "a", name: "Pat White", birthYear: 1980, decision: { create: true } },
    ]);
    expect(out.results[0].status).toBe("created");
    expect(await allPlayers(t)).toHaveLength(2);
  });
});

describe("a rerun creates nothing (the driver contract)", () => {
  const roster: RowIn[] = [
    { key: "a", name: "Pat White", birthYear: 1980 },
    { key: "b", name: "Geno Smith", birthYear: 1990 },
    { key: "c", name: "Dan Marino" },
  ];

  test("a NEW epoch with no answers: dated keys adopt (match), the undated one is held, 0 rows created", async () => {
    const t = convexTest(schema, modules);
    armed();
    await fixture(t);
    const first = await load(t, await epoch(), roster);
    expect(first.results.map((r) => r.status)).toEqual(["created", "created", "created"]);
    expect(await allPlayers(t)).toHaveLength(3);

    const second = await load(t, await epoch(), roster);
    expect(second.results.map((r) => r.status)).toEqual(["adopted", "adopted", "held"]);
    // The adopted keys name their players; the held one names none, only its candidate.
    expect(second.results.map((r) => r.playerId)).toEqual([
      first.results[0].playerId,
      first.results[1].playerId,
      null,
    ]);
    expect(second.results[2].candidates?.map((c) => c.id)).toEqual([first.results[2].playerId]);
    expect(await allPlayers(t)).toHaveLength(3);
  });

  test("the SAME epoch with the created ids as answers: every key adopts by decision, 0 rows created", async () => {
    const t = convexTest(schema, modules);
    armed();
    const f = await fixture(t);
    const e = await epoch();
    const first = await load(t, e, roster);
    const withAnswers: RowIn[] = roster.map((r, i) => ({
      ...r,
      stints: [{ teamId: f.padres, fromYear: 2000 + i }],
      decision: { adopt: first.results[i].playerId! },
    }));
    const second = await load(t, e, withAnswers);
    expect(second.results.map((r) => r.status)).toEqual(["adopted", "adopted", "adopted"]);
    expect(second.results.every((r) => r.matchedBy === "decision")).toBe(true);
    expect(await allPlayers(t)).toHaveLength(3);
    // Replaying the same answers again adds no stint twice.
    const third = await load(t, e, withAnswers);
    expect(third.summary.stintsAdded).toBe(0);
    const rows = await allPlayers(t);
    for (const r of rows) expect((r.teamYears ?? []).length).toBeLessThanOrEqual(1);
  });

  test("the SAME epoch with NO answers: every key is ambiguous created-this-run, 0 rows created", async () => {
    const t = convexTest(schema, modules);
    armed();
    await fixture(t);
    const e = await epoch();
    await load(t, e, roster);
    const second = await load(t, e, roster);
    expect(second.results.map((r) => r.status)).toEqual(["ambiguous", "ambiguous", "ambiguous"]);
    expect(second.results.every((r) => r.reason === "created-this-run")).toBe(true);
    expect(await allPlayers(t)).toHaveLength(3);
  });
});

describe("side effects on a create (D7)", () => {
  test("playerAliases rows land for each alias, nothing is scheduled, no playerSports rows", async () => {
    const t = convexTest(schema, modules);
    armed();
    const f = await fixture(t);
    const e = await epoch();
    const out = await load(t, e, [
      { key: "a", name: "Pat White", birthYear: 1980, aliases: ["Patrick White", "P. White"] },
    ]);
    const id = out.results[0].playerId!;
    const flat = (await aliasRows(t)).filter((r) => r.playerId === id);
    expect(flat.map((r) => r.aliasNormalized).sort()).toEqual(
      [normalizePlayerName("Patrick White"), normalizePlayerName("P. White")].sort(),
    );
    expect(flat.every((r) => r.sportId === f.sportId)).toBe(true);
    expect(await sportRows(t)).toEqual([]);
    expect(await scheduled(t)).toEqual([]);
  });

  test("a created row is found by its alias on the next load (the flat index is real, not just the column)", async () => {
    const t = convexTest(schema, modules);
    armed();
    await fixture(t);
    const first = await load(t, await epoch(), [
      { key: "a", name: "Metta World Peace", birthYear: 1979, aliases: ["Ron Artest"] },
    ]);
    const second = await load(t, await epoch(), [{ key: "b", name: "Ron Artest", birthYear: 1979 }]);
    expect(second.results[0]).toMatchObject({
      status: "adopted",
      playerId: first.results[0].playerId,
      matchedBy: "alias",
    });
    expect(await allPlayers(t)).toHaveLength(1);
  });

  test("an adopt schedules nothing either", async () => {
    const t = convexTest(schema, modules);
    armed();
    const f = await fixture(t);
    await seedPlayer(t, f.sportId, "Pat White", { birthYear: 1980 });
    await load(t, await epoch(), [
      { key: "a", name: "Pat White", birthYear: 1980, stints: [{ teamId: f.padres }] },
    ]);
    await expectNoSideEffects(t);
  });
});

describe("stints and keys (D6)", () => {
  test("13 stints on one new row all land, in chronological order", async () => {
    const t = convexTest(schema, modules);
    armed();
    const f = await fixture(t);
    const stints = Array.from({ length: 13 }, (_, i) => ({
      teamId: i % 2 === 0 ? f.padres : f.cubs,
      fromYear: 2000 + i * 2,
      toYear: 2000 + i * 2 + 1,
    }));
    const e = await epoch();
    const out = await load(t, e, [
      { key: "a", name: "Journey Man", birthYear: 1975, stints: [...stints].reverse() },
    ]);
    expect(out.results[0].stints.map((s) => s.outcome)).toEqual(Array(13).fill("added"));
    expect(out.summary.stintsAdded).toBe(13);
    expect((await playerRow(t, out.results[0].playerId!))!.teamYears).toEqual(stints);
  });

  test("a stint the player already has is present, not duplicated, on an adopt", async () => {
    const t = convexTest(schema, modules);
    armed();
    const f = await fixture(t);
    const p = await seedPlayer(t, f.sportId, "Pat White", {
      birthYear: 1980,
      teamYears: [{ teamId: f.padres, fromYear: 2003, toYear: 2007 }],
    });
    const out = await load(t, await epoch(), [
      {
        key: "a",
        name: "Pat White",
        birthYear: 1980,
        stints: [
          { teamId: f.padres, fromYear: 2004, toYear: 2006 },
          { teamId: f.cubs, fromYear: 2008 },
        ],
      },
    ]);
    expect(out.results[0].stints.map((s) => s.outcome)).toEqual(["present", "added"]);
    expect((await playerRow(t, p))!.teamYears).toEqual([
      { teamId: f.padres, fromYear: 2003, toYear: 2007 },
      { teamId: f.cubs, fromYear: 2008 },
    ]);
  });

  test("a key repeated within one call is refused and writes nothing", async () => {
    const t = convexTest(schema, modules);
    armed();
    await fixture(t);
    await expect(
      load(t, await epoch(), [
        { key: "dup", name: "Pat White", birthYear: 1980 },
        { key: "dup", name: "Geno Smith", birthYear: 1990 },
      ]),
    ).rejects.toThrow(/appears more than once in this call/);
    expect(await allPlayers(t)).toEqual([]);
  });

  test("wrong-sport and missing-team are reported per stint; the row is still created with the rest", async () => {
    const t = convexTest(schema, modules);
    armed();
    const f = await fixture(t);
    const football = await seedSport(t, "Football");
    const foreignTeam = await seedTeam(t, football, "Pittsburgh", "Steelers");
    const gone = await seedTeam(t, f.sportId, "Gone", "Team");
    await t.run(async (ctx) => ctx.db.delete(gone));
    const out = await load(t, await epoch(), [
      {
        key: "a",
        name: "Pat White",
        birthYear: 1980,
        stints: [
          { teamId: foreignTeam, fromYear: 2001 },
          { teamId: gone, fromYear: 2002 },
          { teamId: f.padres, fromYear: 2003 },
        ],
      },
    ]);
    expect(out.results[0].status).toBe("created");
    expect(out.results[0].stints.map((s) => s.outcome)).toEqual([
      "wrong-sport",
      "missing-team",
      "added",
    ]);
    const row = await playerRow(t, out.results[0].playerId!);
    expect(row!.teamYears).toEqual([{ teamId: f.padres, fromYear: 2003 }]);
  });

  test("a create with zero valid stints still creates, with no teamYears key", async () => {
    const t = convexTest(schema, modules);
    armed();
    const f = await fixture(t);
    const football = await seedSport(t, "Football");
    const foreignTeam = await seedTeam(t, football, "Pittsburgh", "Steelers");
    const out = await load(t, await epoch(), [
      { key: "a", name: "Pat White", birthYear: 1980, stints: [{ teamId: foreignTeam }] },
    ]);
    expect(out.results[0].status).toBe("created");
    const row = await playerRow(t, out.results[0].playerId!);
    expect(row!.sportId).toBe(f.sportId);
    expect("teamYears" in row!).toBe(false);
  });
});

describe("the op budget", () => {
  test("a chunk that exceeds the budget stops with nextKey; resuming from it creates nothing twice", async () => {
    const t = convexTest(schema, modules);
    armed();
    const f = await fixture(t);
    const letters = "abcdefghijklmnopqrstuvwxyz";
    // Creates with a long alias list are the expensive row; unique names, so
    // no twin or fragment clash can end a row early.
    const rows: RowIn[] = Array.from({ length: 100 }, (_, i) => ({
      key: `k${String(i).padStart(3, "0")}`,
      name: `Given${letters[i % 26]}${letters[Math.floor(i / 26)]} Family${letters[i % 26]}${letters[Math.floor(i / 26)]}`,
      birthYear: 1950 + (i % 40),
      aliases: Array.from({ length: 12 }, (_, j) => `Alias${j}x${letters[i % 26]}${letters[Math.floor(i / 26)]} Zed`),
      stints: [{ teamId: f.padres, fromYear: 1970 }],
    }));
    const e = await epoch();
    const first = await load(t, e, rows);
    expect(first.hasMore).toBe(true);
    expect(first.processed).toBeGreaterThan(0);
    expect(first.processed).toBeLessThan(rows.length);
    expect(first.nextKey).toBe(rows[first.processed].key);
    expect(first.results).toHaveLength(first.processed);
    expect(first.opsSpent).toBeGreaterThanOrEqual(BULK_LOAD_PLAYER_OP_BUDGET);
    expect(await allPlayers(t)).toHaveLength(first.processed);

    const second = await load(t, e, rows.slice(first.processed));
    expect(second.results[0].key).toBe(first.nextKey);
    expect(second.results[0].status).toBe("created");
    const created = first.processed + second.processed;
    expect(await allPlayers(t)).toHaveLength(created);
    // Every created row exists exactly once.
    const names = (await allPlayers(t)).map((r) => r.nameNormalized);
    expect(new Set(names).size).toBe(created);
    expect(first.summary.created + second.summary.created).toBe(created);
  });
});

describe("single-token names (D7)", () => {
  test("a one-word name that clashes with a fuller-named player is ambiguous name-fragment and creates nothing", async () => {
    const t = convexTest(schema, modules);
    armed();
    const f = await fixture(t);
    const larry = await seedPlayer(t, f.sportId, "Larry Walker", { birthYear: 1966 });
    const out = await load(t, await epoch(), [{ key: "a", name: "Walker", birthYear: 1990 }]);
    expect(out.results[0]).toMatchObject({ status: "ambiguous", reason: "name-fragment" });
    expect(out.results[0].candidates?.map((c) => c.id)).toContain(larry);
    expect(await allPlayers(t)).toHaveLength(1);
    await expectNoSideEffects(t);
  });

  test("{create: true} counts as confirmation and creates the one-name player", async () => {
    const t = convexTest(schema, modules);
    armed();
    const f = await fixture(t);
    await seedPlayer(t, f.sportId, "Larry Walker", { birthYear: 1966 });
    const out = await load(t, await epoch(), [
      { key: "a", name: "Walker", birthYear: 1990, decision: { create: true } },
    ]);
    expect(out.results[0].status).toBe("created");
    const rows = await allPlayers(t);
    expect(rows).toHaveLength(2);
    expect(rows.some((r) => r.name === "Walker")).toBe(true);
  });

  test("a one-word name with no clash is created normally", async () => {
    const t = convexTest(schema, modules);
    armed();
    await fixture(t);
    const out = await load(t, await epoch(), [{ key: "a", name: "Ichiro", birthYear: 1973 }]);
    expect(out.results[0].status).toBe("created");
    expect(await allPlayers(t)).toHaveLength(1);
  });
});


/** Every table the loader can write, so "refused" can mean "nothing changed". */
async function snapshot(t: T) {
  return t.run(async (ctx) => ({
    players: await ctx.db.query("players").collect(),
    aliases: await ctx.db.query("playerAliases").collect(),
    sports: await ctx.db.query("playerSports").collect(),
    scheduled: await ctx.db.system.query("_scheduled_functions").collect(),
  }));
}

/** `n` distinct two-word names that share no token with one another. */
function uniqueNames(n: number): string[] {
  const letters = "abcdefghijklmnopqrstuvwxyz";
  return Array.from({ length: n }, (_, i) => {
    const tag = `${letters[i % 26]}${letters[Math.floor(i / 26)]}`;
    return `Given${tag} Family${tag}`;
  });
}

/** `n` distinct aliases that do not collide with any name above. */
function uniqueAliases(n: number, prefix = "Nick"): string[] {
  const letters = "abcdefghijklmnopqrstuvwxyz";
  return Array.from({ length: n }, (_, i) => `${prefix}${letters[i % 26]}${letters[Math.floor(i / 26)]} Zed`);
}

describe("nearExisting: a create beside a near name lists it and still proceeds", () => {
  test("a create beside a close name lists it, capped at three, and the create goes ahead", async () => {
    const t = convexTest(schema, modules);
    armed();
    const f = await fixture(t);
    const near: Id<"players">[] = [];
    for (let i = 0; i < 5; i++) {
      near.push(await seedPlayer(t, f.sportId, "Patrick White", { birthYear: 1960 + i }));
    }
    const e = await epoch();
    const out = await load(t, e, [{ key: "a", name: "Pat White", birthYear: 1980 }]);
    expect(out.results[0].status).toBe("created");
    const listed = out.results[0].nearExisting ?? [];
    expect(listed).toHaveLength(3);
    for (const hit of listed) {
      expect(near).toContain(hit.id);
      expect(hit.name).toBe("Patrick White");
      expect(typeof hit.confidence).toBe("string");
      expect(hit.birthYear).toBeGreaterThanOrEqual(1960);
    }
    expect(new Set(listed.map((h) => h.id)).size).toBe(3);
    // The create went ahead: six rows now, the new one not among its own neighbours.
    expect(await allPlayers(t)).toHaveLength(6);
    expect(listed.map((h) => h.id)).not.toContain(out.results[0].playerId);
  });

  test("a single near name is listed whole, under the cap", async () => {
    const t = convexTest(schema, modules);
    armed();
    const f = await fixture(t);
    const p = await seedPlayer(t, f.sportId, "Patrick White");
    const out = await load(t, await epoch(), [{ key: "a", name: "Pat White", birthYear: 1980 }]);
    expect(out.results[0].status).toBe("created");
    expect(out.results[0].nearExisting?.map((h) => h.id)).toEqual([p]);
    expect(out.results[0].nearExisting?.[0]).not.toHaveProperty("birthYear");
  });

  test("with nothing near, the field is absent rather than empty", async () => {
    const t = convexTest(schema, modules);
    armed();
    const f = await fixture(t);
    await seedPlayer(t, f.sportId, "Geno Smith", { birthYear: 1990 });
    const out = await load(t, await epoch(), [{ key: "a", name: "Pat White", birthYear: 1980 }]);
    expect(out.results[0].status).toBe("created");
    expect("nearExisting" in out.results[0]).toBe(false);
  });

  test("the preview lists the same near names for a would-create", async () => {
    const t = convexTest(schema, modules);
    const f = await fixture(t);
    const p = await seedPlayer(t, f.sportId, "Patrick White");
    const out = await preview(t, await epoch(), [{ key: "a", name: "Pat White", birthYear: 1980 }]);
    expect(out.results[0].status).toBe("would-create");
    expect(out.results[0].nearExisting?.map((h) => h.id)).toEqual([p]);
    expect(await allPlayers(t)).toHaveLength(1);
  });
});

describe("the per-row stint cap", () => {
  const stintsOf = (n: number, f: { padres: Id<"teams">; cubs: Id<"teams"> }) =>
    Array.from({ length: n }, (_, i) => ({
      teamId: i % 2 === 0 ? f.padres : f.cubs,
      fromYear: 1930 + i,
      toYear: 1930 + i,
    }));

  test("exactly the cap lands in full", async () => {
    const t = convexTest(schema, modules);
    armed();
    const f = await fixture(t);
    const out = await load(t, await epoch(), [
      { key: "a", name: "Journey Man", birthYear: 1975, stints: stintsOf(MAX_PLAYER_TEAM_YEARS, f) },
    ]);
    expect(out.results[0].status).toBe("created");
    expect(out.summary.stintsAdded).toBe(MAX_PLAYER_TEAM_YEARS);
    expect((await playerRow(t, out.results[0].playerId!))!.teamYears).toHaveLength(
      MAX_PLAYER_TEAM_YEARS,
    );
  });

  test("one stint over the cap is refused with its message, and nothing is written", async () => {
    const t = convexTest(schema, modules);
    armed();
    const f = await fixture(t);
    const before = await snapshot(t);
    const over = MAX_PLAYER_TEAM_YEARS + 1;
    const rows = [
      { key: "a", name: "Pat White", birthYear: 1980 },
      { key: "b", name: "Journey Man", birthYear: 1975, stints: stintsOf(over, f) },
    ];
    const pattern = new RegExp(`"b" has ${over} stints; the limit is ${MAX_PLAYER_TEAM_YEARS}`);
    await expect(load(t, await epoch(), rows)).rejects.toThrow(pattern);
    await expect(preview(t, await epoch(), rows)).rejects.toThrow(pattern);
    expect(await snapshot(t)).toEqual(before);
  });
});

describe("twinOfKey names the first key (preview only; the mutation cannot know it)", () => {
  test("the preview twin inside one call points at the first key", async () => {
    const t = convexTest(schema, modules);
    await fixture(t);
    const out = await preview(t, await epoch(), [
      { key: "first", name: "Chris Young" },
      { key: "second", name: "Chris Young" },
    ]);
    expect(out.results[1]).toMatchObject({
      status: "ambiguous",
      reason: "created-this-run",
      twinOfKey: "first",
    });
    // A simulated row has no id to show, so the key is the only pointer.
    expect(out.results[1].candidates).toEqual([]);
  });

  test("the preview twin points at the FIRST key even with three keys of one name", async () => {
    const t = convexTest(schema, modules);
    await fixture(t);
    const out = await preview(t, await epoch(), [
      { key: "first", name: "Chris Young" },
      { key: "second", name: "Chris Young" },
      { key: "third", name: "Chris Young" },
    ]);
    expect(out.results[1].twinOfKey).toBe("first");
    expect(out.results[2].twinOfKey).toBe("first");
  });

  test("the mutation twin (one call) names a candidate row but no key: rows do not store keys", async () => {
    const t = convexTest(schema, modules);
    armed();
    await fixture(t);
    const out = await load(t, await epoch(), [
      { key: "first", name: "Chris Young" },
      { key: "second", name: "Chris Young" },
    ]);
    expect(out.results[1]).toMatchObject({ status: "ambiguous", reason: "created-this-run" });
    expect(out.results[1].candidates?.map((c) => c.id)).toEqual([out.results[0].playerId]);
    expect("twinOfKey" in out.results[1]).toBe(false);
  });

  test("the mutation twin across two calls names the row, not a key", async () => {
    const t = convexTest(schema, modules);
    armed();
    await fixture(t);
    const e = await epoch();
    const first = await load(t, e, [{ key: "first", name: "Chris Young", birthYear: 1979 }]);
    const second = await load(t, e, [{ key: "second", name: "Chris Young", birthYear: 1979 }]);
    expect(second.results[0].candidates?.map((c) => c.id)).toEqual([first.results[0].playerId]);
    expect("twinOfKey" in second.results[0]).toBe(false);
  });
});

describe("aliasesAdded and aliasesSkipped on an adopt", () => {
  test("two new aliases beside one already held: added 2, nothing skipped (a held alias is not a skip)", async () => {
    const t = convexTest(schema, modules);
    armed();
    const f = await fixture(t);
    const p = await seedPlayer(t, f.sportId, "Pat White", { birthYear: 1980, aliases: ["Patty"] });
    const out = await load(t, await epoch(), [
      { key: "a", name: "Pat White", birthYear: 1980, aliases: ["Patty", "Patrick White", "P. White"] },
    ]);
    expect(out.results[0].status).toBe("adopted");
    expect(out.results[0].aliasesAdded).toBe(2);
    expect("aliasesSkipped" in out.results[0]).toBe(false);
    expect((await playerRow(t, p))!.aliases).toHaveLength(3);
  });

  test("with nothing new to add, both keys are absent", async () => {
    const t = convexTest(schema, modules);
    armed();
    const f = await fixture(t);
    await seedPlayer(t, f.sportId, "Pat White", { birthYear: 1980, aliases: ["Patty"] });
    const out = await load(t, await epoch(), [
      { key: "a", name: "Pat White", birthYear: 1980, aliases: ["patty"], stints: [{ teamId: f.padres }] },
    ]);
    expect(out.results[0].status).toBe("adopted");
    expect("aliasesAdded" in out.results[0]).toBe(false);
    expect("aliasesSkipped" in out.results[0]).toBe(false);
  });

  test("a row with no aliases at all reports neither key", async () => {
    const t = convexTest(schema, modules);
    armed();
    const f = await fixture(t);
    await seedPlayer(t, f.sportId, "Pat White", { birthYear: 1980 });
    const out = await load(t, await epoch(), [{ key: "a", name: "Pat White", birthYear: 1980 }]);
    expect("aliasesAdded" in out.results[0]).toBe(false);
    expect("aliasesSkipped" in out.results[0]).toBe(false);
  });

  test("a player already at the alias cap: no throw, every incoming alias skipped, aliases unchanged", async () => {
    const t = convexTest(schema, modules);
    armed();
    const f = await fixture(t);
    const held = uniqueAliases(MAX_PLAYER_ALIASES, "Held");
    const p = await seedPlayer(t, f.sportId, "Pat White", { birthYear: 1980, aliases: held });
    const incoming = uniqueAliases(3, "Fresh");
    const aliasRowsBefore = (await aliasRows(t)).length;
    const out = await load(t, await epoch(), [
      { key: "a", name: "Pat White", birthYear: 1980, aliases: incoming },
    ]);
    expect(out.results[0].status).toBe("adopted");
    expect(out.results[0].aliasesSkipped).toBe(incoming.length);
    expect("aliasesAdded" in out.results[0]).toBe(false);
    const row = await playerRow(t, p);
    expect(row!.aliases).toEqual(held);
    expect(row!.lastUpdated).toBe(1_700_000_000_000);
    expect((await aliasRows(t)).length).toBe(aliasRowsBefore);
  });

  test("partial room: adds up to the cap and skips the rest", async () => {
    const t = convexTest(schema, modules);
    armed();
    const f = await fixture(t);
    const held = uniqueAliases(MAX_PLAYER_ALIASES - 2, "Held");
    const p = await seedPlayer(t, f.sportId, "Pat White", { birthYear: 1980, aliases: held });
    const incoming = uniqueAliases(5, "Fresh");
    const out = await load(t, await epoch(), [
      { key: "a", name: "Pat White", birthYear: 1980, aliases: incoming },
    ]);
    expect(out.results[0].aliasesAdded).toBe(2);
    expect(out.results[0].aliasesSkipped).toBe(3);
    const row = await playerRow(t, p);
    expect(row!.aliases).toEqual([...held, ...incoming.slice(0, 2)]);
    const flat = (await aliasRows(t)).filter((r) => r.playerId === p);
    expect(flat).toHaveLength(MAX_PLAYER_ALIASES);
  });

  test("the preview reports the same added and skipped counts and writes nothing", async () => {
    const t = convexTest(schema, modules);
    const f = await fixture(t);
    const held = uniqueAliases(MAX_PLAYER_ALIASES - 1, "Held");
    const p = await seedPlayer(t, f.sportId, "Pat White", { birthYear: 1980, aliases: held });
    const out = await preview(t, await epoch(), [
      { key: "a", name: "Pat White", birthYear: 1980, aliases: uniqueAliases(3, "Fresh") },
    ]);
    expect(out.results[0].status).toBe("would-adopt");
    expect(out.results[0].aliasesAdded).toBe(1);
    expect(out.results[0].aliasesSkipped).toBe(2);
    expect((await playerRow(t, p))!.aliases).toEqual(held);
  });
});

describe("candidatesTruncated on the name-fragment branch", () => {
  async function seedWalkers(t: T, sportId: Id<"selectorOptions">, n: number) {
    const letters = "abcdefghijklmnopqrstuvwxyz";
    for (let i = 0; i < n; i++) {
      await seedPlayer(t, sportId, `Given${letters[i % 26]}${letters[Math.floor(i / 26)]} Walker`, {
        birthYear: 1950 + i,
      });
    }
  }

  test("above the candidate cap the list is cut and flagged truncated", async () => {
    const t = convexTest(schema, modules);
    armed();
    const f = await fixture(t);
    await seedWalkers(t, f.sportId, PLAYER_AMBIGUITY_SCAN_LIMIT + 1);
    const out = await load(t, await epoch(), [{ key: "a", name: "Walker", birthYear: 1990 }]);
    expect(out.results[0]).toMatchObject({ status: "ambiguous", reason: "name-fragment" });
    expect(out.results[0].candidates).toHaveLength(PLAYER_AMBIGUITY_SCAN_LIMIT);
    expect(out.results[0].candidatesTruncated).toBe(true);
    expect(await allPlayers(t)).toHaveLength(PLAYER_AMBIGUITY_SCAN_LIMIT + 1);
  });

  test("exactly at the cap the list is whole and the flag is absent", async () => {
    const t = convexTest(schema, modules);
    armed();
    const f = await fixture(t);
    await seedWalkers(t, f.sportId, PLAYER_AMBIGUITY_SCAN_LIMIT);
    const out = await load(t, await epoch(), [{ key: "a", name: "Walker", birthYear: 1990 }]);
    expect(out.results[0].reason).toBe("name-fragment");
    expect(out.results[0].candidates).toHaveLength(PLAYER_AMBIGUITY_SCAN_LIMIT);
    expect("candidatesTruncated" in out.results[0]).toBe(false);
  });

  test("a single clash reports no flag", async () => {
    const t = convexTest(schema, modules);
    armed();
    const f = await fixture(t);
    await seedWalkers(t, f.sportId, 1);
    const out = await load(t, await epoch(), [{ key: "a", name: "Walker", birthYear: 1990 }]);
    expect(out.results[0].candidates).toHaveLength(1);
    expect("candidatesTruncated" in out.results[0]).toBe(false);
  });
});

describe("input refusals leave every table untouched", () => {
  async function refused(t: T, rows: RowIn[], pattern: RegExp) {
    const before = await snapshot(t);
    await expect(load(t, await epoch(), rows)).rejects.toThrow(pattern);
    await expect(preview(t, await epoch(), rows)).rejects.toThrow(pattern);
    expect(await snapshot(t)).toEqual(before);
  }

  test("a name with no letters or digits is refused; a digits-led name is the allowed side", async () => {
    const t = convexTest(schema, modules);
    armed();
    await fixture(t);
    await refused(
      t,
      [
        { key: "ok", name: "Fine Player", birthYear: 1980 },
        { key: "bad", name: "?! ?!", birthYear: 1980 },
      ],
      /The player name for "bad" has no letters or digits in it/,
    );
    const out = await load(t, await epoch(), [{ key: "n", name: "007 Bond", birthYear: 1980 }]);
    expect(out.results[0].status).toBe("created");
  });

  test("a stint with an end year and no start year is refused; a start year alone is the allowed side", async () => {
    const t = convexTest(schema, modules);
    armed();
    const f = await fixture(t);
    await refused(
      t,
      [{ key: "bad", name: "Pat White", birthYear: 1980, stints: [{ teamId: f.padres, toYear: 2005 }] }],
      /A stint for "bad" has an end year and no start year/,
    );
    const out = await load(t, await epoch(), [
      { key: "ok", name: "Pat White", birthYear: 1980, stints: [{ teamId: f.padres, fromYear: 2005 }] },
    ]);
    expect(out.results[0].stints.map((s) => s.outcome)).toEqual(["added"]);
  });

  test("more aliases than the cap is refused; exactly the cap lands", async () => {
    const t = convexTest(schema, modules);
    armed();
    await fixture(t);
    await refused(
      t,
      [{ key: "bad", name: "Pat White", birthYear: 1980, aliases: uniqueAliases(MAX_PLAYER_ALIASES + 1) }],
      new RegExp(`"bad" has ${MAX_PLAYER_ALIASES + 1} aliases; the limit is ${MAX_PLAYER_ALIASES}`),
    );
    const out = await load(t, await epoch(), [
      { key: "ok", name: "Pat White", birthYear: 1980, aliases: uniqueAliases(MAX_PLAYER_ALIASES) },
    ]);
    expect(out.results[0].status).toBe("created");
    expect((await playerRow(t, out.results[0].playerId!))!.aliases).toHaveLength(MAX_PLAYER_ALIASES);
    expect(await aliasRows(t)).toHaveLength(MAX_PLAYER_ALIASES);
  });

  test("an alias longer than the limit is refused; one of exactly the limit lands", async () => {
    const t = convexTest(schema, modules);
    armed();
    await fixture(t);
    const over = MAX_PLAYER_ALIAS_LENGTH + 1;
    await refused(
      t,
      [{ key: "bad", name: "Pat White", birthYear: 1980, aliases: ["a".repeat(over)] }],
      new RegExp(`An alias for "bad" is ${over} characters; the limit is ${MAX_PLAYER_ALIAS_LENGTH}`),
    );
    const out = await load(t, await epoch(), [
      { key: "ok", name: "Pat White", birthYear: 1980, aliases: ["a".repeat(MAX_PLAYER_ALIAS_LENGTH)] },
    ]);
    expect(out.results[0].status).toBe("created");
  });

  test("101 rows in one call are refused whole; 100 are accepted", async () => {
    const t = convexTest(schema, modules);
    armed();
    await fixture(t);
    const names = uniqueNames(101);
    const rows = (n: number): RowIn[] =>
      names.slice(0, n).map((name, i) => ({ key: `k${i}`, name, birthYear: 1950 + (i % 40) }));
    await refused(t, rows(101), /101 players in one call; the limit is 100/);
    const out = await load(t, await epoch(), rows(100));
    expect(out.processed).toBe(100);
    expect(out.summary.created).toBe(100);
    expect(await allPlayers(t)).toHaveLength(100);
  });
});

describe("the load epoch boundary is inclusive (_creationTime >= loadStartedAt)", () => {
  test("a row whose creation time EQUALS the epoch counts as created this run", async () => {
    const t = convexTest(schema, modules);
    armed();
    const f = await fixture(t);
    const p = await seedPlayer(t, f.sportId, "Chris Young", { birthYear: 1979 });
    const created = (await playerRow(t, p))!._creationTime;
    await sleep(5);
    const out = await load(t, created, [{ key: "a", name: "Chris Young", birthYear: 1979 }]);
    expect(out.results[0]).toMatchObject({ status: "ambiguous", reason: "created-this-run" });
    expect(out.results[0].candidates?.[0].createdThisRun).toBe(true);
    expect(await allPlayers(t)).toHaveLength(1);
  });

  test("an epoch one millisecond after the row's creation makes it an ordinary candidate", async () => {
    const t = convexTest(schema, modules);
    armed();
    const f = await fixture(t);
    const p = await seedPlayer(t, f.sportId, "Chris Young", { birthYear: 1979 });
    const created = (await playerRow(t, p))!._creationTime;
    await sleep(5);
    const out = await load(t, Math.floor(created) + 1, [
      { key: "a", name: "Chris Young", birthYear: 1979 },
    ]);
    expect(out.results[0]).toMatchObject({ status: "adopted", playerId: p });
    expect(out.results[0].reason).toBeUndefined();
  });

  test("the same boundary holds in the preview", async () => {
    const t = convexTest(schema, modules);
    const f = await fixture(t);
    const p = await seedPlayer(t, f.sportId, "Chris Young", { birthYear: 1979 });
    const created = (await playerRow(t, p))!._creationTime;
    await sleep(5);
    const at = await preview(t, created, [{ key: "a", name: "Chris Young", birthYear: 1979 }]);
    expect(at.results[0]).toMatchObject({ status: "ambiguous", reason: "created-this-run" });
    const after = await preview(t, Math.floor(created) + 1, [
      { key: "a", name: "Chris Young", birthYear: 1979 },
    ]);
    expect(after.results[0]).toMatchObject({ status: "would-adopt", playerId: p });
  });
});
