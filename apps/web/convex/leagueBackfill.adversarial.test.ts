/**
 * NEO-569 — adversarial pass over `leagueBackfill`: arming edge cases,
 * resumable cursor across pages, idempotence of every phase, never creating a
 * league, strip never touching a sport row, and the data-claim rule on cards.
 */

import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { normalizeEntityName } from "../lib/entities/normalize-name";
import { insertTestCard } from "../lib/testing/card-row";
import { LEAGUE_BACKFILL_CONFIRM, LEAGUE_BACKFILL_ENV_FLAG } from "./leagueBackfill";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

const NOW = 1_700_000_000_000;
type T = ReturnType<typeof convexTest>;
type SelId = Id<"selectorOptions">;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function seed(t: T) {
  return t.run(async (ctx) => {
    const row = (
      level: "sport" | "year" | "manufacturer" | "setName" | "variantType",
      value: string,
      parentId?: SelId,
      features?: Record<string, string>,
    ) =>
      ctx.db.insert("selectorOptions", {
        level, value, ...(parentId ? { parentId } : {}), platformData: {}, children: [],
        ...(features ? { features } : {}), lastUpdated: NOW,
      });
    const sport = await row("sport", "Baseball", undefined, { league: "MLB" });
    const year = await row("year", "2024", sport);
    const brand = await row("manufacturer", "Topps", year);
    const set = await row("setName", "Chrome", brand, { league: "MLB" });
    const base = await row("variantType", "Base", set);
    const league = (name: string, extra: { aliases?: string[]; abbreviation?: string } = {}) =>
      ctx.db.insert("leagues", {
        name, nameNormalized: name.toLowerCase(), sportId: sport, level: "major", ...extra, lastUpdated: NOW,
      });
    const mlb = await league("Major League Baseball", { aliases: ["MLB"] });
    const ncaa = await league("NCAA Division I", { abbreviation: "NCAA" });
    const team = (name: string, leagueId?: Id<"leagues">) =>
      ctx.db.insert("teams", {
        name, nameNormalized: normalizeEntityName(name), sportId: sport, ...(leagueId ? { leagueId } : {}), lastUpdated: NOW,
      });
    const padres = await team("San Diego Padres", mlb);
    const nowhere = await team("Nowhere Nine");
    return { sport, set, base, mlb, ncaa, padres, nowhere };
  });
}

const card = (t: T, selectorOptionId: SelId, extra: Record<string, unknown> = {}) =>
  t.run((ctx) =>
    insertTestCard(ctx, {
      selectorOptionId, cardNumber: String(Math.random()).slice(2, 9), cardName: "Card",
      sortOrder: 0, platformData: {}, lastUpdated: NOW, ...extra,
    }),
  );
const leagueOf = (t: T, id: Id<"cardChecklist">) =>
  t.run(async (ctx) => (await ctx.db.get(id))?.leagueId ?? null);
const snapshot = (t: T) =>
  t.run(async (ctx) => ({
    sel: await ctx.db.query("selectorOptions").collect(),
    cards: await ctx.db.query("cardChecklist").collect(),
    leagues: await ctx.db.query("leagues").collect(),
  }));

describe("arming", () => {
  test.each(["0", "yes", "", "TRUE"])("env flag %j does not arm", async (value) => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    vi.stubEnv(LEAGUE_BACKFILL_ENV_FLAG, value);
    const report = await t.action(internal.leagueBackfill.run, { phase: "sets", confirm: LEAGUE_BACKFILL_CONFIRM });
    expect(report.armed).toBe(false);
    expect((await t.run((ctx) => ctx.db.get(s.set)))!.leagueIds).toBeUndefined();
  });

  test("the flag alone, or a wrong-case token, stays a dry run", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    vi.stubEnv(LEAGUE_BACKFILL_ENV_FLAG, "true");
    for (const confirm of [undefined, "backfill", "BACKFILL "]) {
      const report = await t.action(internal.leagueBackfill.run, { phase: "sets", ...(confirm ? { confirm } : {}) });
      expect(report.armed).toBe(false);
      expect(report.message).toMatch(/^Dry run/);
    }
    expect((await t.run((ctx) => ctx.db.get(s.set)))!.leagueIds).toBeUndefined();
  });

  test("a stage outside the phase is refused", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(internal.leagueBackfill.page, { phase: "cards", stage: 1, cursor: null, apply: false }),
    ).rejects.toThrow(/No stage 1 in the cards phase/);
  });
});

describe("resumable cursor", () => {
  test("a run that stops at its time budget resumes to the same end state, counting each card once", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const ids: Array<Id<"cardChecklist">> = [];
    for (let i = 0; i < 205; i++) ids.push(await card(t, s.base, { teamOnCardIds: [s.padres] }));
    vi.stubEnv(LEAGUE_BACKFILL_ENV_FLAG, "1");
    // Each clock read jumps past the 150 s budget, so the first page ends the call.
    let clock = 0;
    vi.spyOn(Date, "now").mockImplementation(() => (clock += 200_000));
    const first = await t.action(internal.leagueBackfill.run, { phase: "cards", confirm: LEAGUE_BACKFILL_CONFIRM });
    expect(first.complete).toBe(false);
    expect(first.cursor).toBeDefined();
    expect(first.counts.written).toBe(200);
    vi.restoreAllMocks();
    const second = await t.action(internal.leagueBackfill.run, {
      phase: "cards", confirm: LEAGUE_BACKFILL_CONFIRM, cursor: first.cursor,
    });
    expect(second.complete).toBe(true);
    expect(second.counts.written).toBe(5);
    for (const id of ids) expect(await leagueOf(t, id)).toBe(s.mlb);
  });
});

describe("idempotence, and what is never touched", () => {
  test("each phase, run twice armed, changes nothing the second time and never makes a league", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await card(t, s.base, { teamOnCardIds: [s.padres], features: { league: "MLB" } });
    await card(t, s.base, {});
    vi.stubEnv(LEAGUE_BACKFILL_ENV_FLAG, "1");
    for (const phase of ["sets", "cards", "strip"] as const) {
      await t.action(internal.leagueBackfill.run, { phase, confirm: LEAGUE_BACKFILL_CONFIRM });
      const after = await snapshot(t);
      const again = await t.action(internal.leagueBackfill.run, { phase, confirm: LEAGUE_BACKFILL_CONFIRM });
      expect(again.counts.written ?? 0).toBe(0);
      expect(again.counts.setRowsStripped ?? 0).toBe(0);
      expect(again.counts.cardsStripped ?? 0).toBe(0);
      expect(await snapshot(t)).toEqual(after);
    }
    expect((await snapshot(t)).leagues).toHaveLength(2);
    // The sport row's legacy text is reference seed: never stripped.
    expect((await t.run((ctx) => ctx.db.get(s.sport)))!.features).toEqual({ league: "MLB" });
  });

  test("a set the dry run reports unresolved is left alone by the armed run and by strip", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await t.run((ctx) => ctx.db.patch(s.set, { features: { league: "Imaginary Circuit" } }));
    vi.stubEnv(LEAGUE_BACKFILL_ENV_FLAG, "1");
    await t.action(internal.leagueBackfill.run, { phase: "sets", confirm: LEAGUE_BACKFILL_CONFIRM });
    await t.action(internal.leagueBackfill.run, { phase: "strip", confirm: LEAGUE_BACKFILL_CONFIRM });
    const row = await t.run((ctx) => ctx.db.get(s.set));
    expect(row!.leagueIds).toBeUndefined();
    expect(row!.features).toEqual({ league: "Imaginary Circuit" });
  });

  test("an ambiguous abbreviation resolves to nothing rather than the first league", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await t.run(async (ctx) => {
      for (const name of ["Alpha", "Beta"]) {
        await ctx.db.insert("leagues", {
          name, nameNormalized: name.toLowerCase(), abbreviation: "IL", sportId: s.sport, level: "minor", lastUpdated: NOW,
        });
      }
      await ctx.db.patch(s.set, { features: { league: "IL" } });
    });
    vi.stubEnv(LEAGUE_BACKFILL_ENV_FLAG, "1");
    const report = await t.action(internal.leagueBackfill.run, { phase: "sets", confirm: LEAGUE_BACKFILL_CONFIRM });
    expect(report.counts.unresolved).toBe(1);
    expect((await t.run((ctx) => ctx.db.get(s.set)))!.leagueIds).toBeUndefined();
  });
});

describe("cards — a team's data claim holds back a guess (Product invariant rule 8)", () => {
  // BUG (reported, not fixed): a card with one team that HAS a league and one
  // that has none falls into the "no usable team" branch and takes the legacy
  // text's league or the set's only league, which can contradict the league
  // its own team names. `deriveCardLeagueId` returns none for this shape, and
  // the design says legacy text / set league apply only "when no team has a
  // league". Expected: left blank (teamWithoutLeague).
  test("one team in MLB and one without a league: the set's NCAA-only list must not be written", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await t.run((ctx) => ctx.db.patch(s.set, { leagueIds: [s.ncaa], features: undefined }));
    const c = await card(t, s.base, { teamOnCardIds: [s.padres, s.nowhere] });
    vi.stubEnv(LEAGUE_BACKFILL_ENV_FLAG, "1");
    await t.action(internal.leagueBackfill.run, { phase: "cards", confirm: LEAGUE_BACKFILL_CONFIRM });
    expect(await leagueOf(t, c)).toBeNull();
  });

  test("one team in MLB and one without a league: legacy text naming NCAA must not be written", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const c = await card(t, s.base, { teamOnCardIds: [s.padres, s.nowhere], features: { league: "NCAA" } });
    vi.stubEnv(LEAGUE_BACKFILL_ENV_FLAG, "1");
    await t.action(internal.leagueBackfill.run, { phase: "cards", confirm: LEAGUE_BACKFILL_CONFIRM });
    expect(await leagueOf(t, c)).toBeNull();
  });
});
