/**
 * NEO-645 (Jason: "I don't want to store that data for anything longer than
 * necessary") — Wikidata output on a name row expires.
 *
 * `tidyNames.sweepExpiredLookupOutput` is main's hourly reaper (24 hours,
 * `sweepAbandonedBatches`) applied to the rows that outlive the commit here:
 * a lookup stamped a day ago loses its Wikidata keys, status, generation and
 * stamp; the answer, its fan-out state, the sport and the gate's own facts stay.
 */

import { convexTest } from "convex-test";
import { afterEach, describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import type { Doc, Id } from "./_generated/dataModel";
import {
  hasLookupOutput,
  LOOKUP_OUTPUT_SWEEP_CHUNK,
  LOOKUP_OUTPUT_TTL_MS,
  neverLooked,
} from "./tidyNames";
import { cancelScheduled } from "../lib/testing/drain-scheduled";
import { normalizeEntityName } from "../lib/entities/normalize-name";
import { addPlayer, nameRow, printCard, seedTidyWorld, type TidyWorld } from "../lib/testing/tidy-world";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

const ADMIN = { subject: "user_tidy_expiry_admin", role: "admin" };
type T = ReturnType<typeof convexTest>;

const live: T[] = [];
const newT = () => {
  const t = convexTest(schema, modules);
  live.push(t);
  return t;
};
afterEach(async () => {
  for (const t of live.splice(0)) await cancelScheduled(t);
});

const OLD = () => Date.now() - LOOKUP_OUTPUT_TTL_MS - 60_000;
const FRESH = () => Date.now() - 60_000;
const WD = { wikidataId: "Q111", description: "outfielder", birthYear: 1996, careerTeams: [{ name: "Padres", fromYear: 2020 }] };

const sweep = (t: T) => t.mutation(internal.tidyNames.sweepExpiredLookupOutput, {});
const rowById = (t: T, id: Id<"tidyNames">) => t.run((ctx) => ctx.db.get(id));
const rowsAll = (t: T) => t.run((ctx) => ctx.db.query("tidyNames").collect());

/** A looked-up name row of `status`, stamped `at`, printed by one card unless `unprinted`. */
async function looked(
  t: T,
  name: string,
  over: Partial<Doc<"tidyNames">>,
  opts: { unprinted?: boolean; kind?: "player" | "team"; w?: TidyWorld } = {},
) {
  return t.run(async (ctx) => {
    const w = opts.w ?? (await seedTidyWorld(ctx));
    const kind = opts.kind ?? "player";
    const id = await nameRow(ctx, { scopeId: w.base, sportId: w.sport, kind, name, over });
    const cardId = opts.unprinted
      ? undefined
      : await printCard(ctx, w, { number: "1", printed: [{ kind, name }] });
    return { w, id, cardId };
  });
}

describe("sweepExpiredLookupOutput: only expired Wikidata output goes", () => {
  test("a day-old lookup is cleared to a never-looked name; a fresh one, a pending one and one never stamped are left alone", async () => {
    const t = newT();
    const old = await looked(t, "Old Hit", { status: "ready", lookupGen: 2, lookupRequestedAt: OLD(), enrichment: WD });
    const fresh = await looked(t, "Fresh Hit", { status: "ready", lookupGen: 1, lookupRequestedAt: FRESH(), enrichment: WD });
    const err = await looked(t, "Old Error", { status: "error", lookupGen: 3, lookupRequestedAt: OLD() });
    const pending = await looked(t, "Old Pending", { status: "pending", lookupGen: 1, lookupRequestedAt: OLD() });
    const never = await looked(t, "Never Stamped", { status: "ready", enrichment: { description: "kept?" } });

    const out = await sweep(t);
    expect(out).toEqual({ cleared: 2, deleted: 0, done: true });

    const cleared = (await rowById(t, old.id))!;
    expect(cleared.enrichment).toBeUndefined();
    expect(cleared.status).toBe("ready");
    expect(cleared.lookupGen).toBeUndefined();
    expect(cleared.lookupRequestedAt).toBeUndefined();
    expect(neverLooked(cleared)).toBe(true);
    expect(neverLooked((await rowById(t, err.id))!)).toBe(true);

    expect((await rowById(t, fresh.id))!.enrichment).toEqual(WD);
    expect((await rowById(t, pending.id))).toMatchObject({ status: "pending", lookupGen: 1 });
    expect((await rowById(t, never.id))!.enrichment).toEqual({ description: "kept?" });
  });

  test("the gate's own facts stay (a same-name choice's candidates, a preselect, a team row's candidates); only Wikidata's keys go", async () => {
    const t = newT();
    const world = await t.run((ctx) => seedTidyWorld(ctx));
    const bo = await t.run((ctx) => addPlayer(ctx, world, "Bo Jackson"));
    const candidates = [{ playerId: bo, name: "Bo Jackson", careerSummary: "x" }];
    const choice = await looked(
      t,
      "Bo Jackson",
      { status: "ready", lookupGen: 1, lookupRequestedAt: OLD(), enrichment: { ...WD, existingCandidates: candidates } },
      { w: world },
    );
    const team = await looked(
      t,
      "Pads",
      {
        status: "ready",
        lookupGen: 1,
        lookupRequestedAt: OLD(),
        enrichment: { league: "MLB", espnId: "25", colors: { primary: "#fff" } },
        candidateTeamIds: [world.padres],
        candidatePlace: true,
      },
      { kind: "team", w: world },
    );
    await sweep(t);
    const c = (await rowById(t, choice.id))!;
    expect(c.enrichment).toEqual({ existingCandidates: candidates });
    expect(hasLookupOutput(c.enrichment)).toBe(false);
    const tm = (await rowById(t, team.id))!;
    expect(tm.enrichment).toBeUndefined();
    expect(tm.candidateTeamIds).toEqual([world.padres]);
    expect(tm.candidatePlace).toBe(true);
    expect(tm.status).toBe("ready");
  });

  test("an answer survives: the link, its generation, its fan-out state and its sport; an operator's ruling too", async () => {
    const t = newT();
    const world = await t.run((ctx) => seedTidyWorld(ctx));
    const bo = await t.run((ctx) => addPlayer(ctx, world, "Bo Jackson"));
    const linked = await looked(
      t,
      "Linked Name",
      {
        status: "ready",
        lookupGen: 1,
        lookupRequestedAt: OLD(),
        enrichment: WD,
        answer: { kind: "linkPlayer", playerId: bo, by: "operator" },
        answerGen: 4,
        fanOutFrom: [null],
        answeredByUserId: "u1",
        answeredAt: 123,
      },
      { w: world },
    );
    const ruled = await looked(
      t,
      "Junk Header",
      { status: "ready", lookupGen: 1, lookupRequestedAt: OLD(), enrichment: WD, answer: { kind: "notEntity", by: "operator" }, answerGen: 1 },
      { w: world, unprinted: true },
    );
    await sweep(t);
    const l = (await rowById(t, linked.id))!;
    expect(l.answer).toEqual({ kind: "linkPlayer", playerId: bo, by: "operator" });
    expect(l.answerGen).toBe(4);
    expect(l.fanOutFrom).toEqual([null]);
    expect(l.answeredByUserId).toBe("u1");
    expect(l.answeredAt).toBe(123);
    expect(l.sportId).toBe(world.sport);
    expect(l.enrichment).toBeUndefined();
    // An answered row with no printer is still kept: the answer is not Wikidata's.
    const r = (await rowById(t, ruled.id))!;
    expect(r.answer).toEqual({ kind: "notEntity", by: "operator" });
    expect(r.enrichment).toBeUndefined();
  });

  test("teams nobody prints: an unanswered row with no printer is deleted; with a printer it is blanked", async () => {
    const t = newT();
    const world = await t.run((ctx) => seedTidyWorld(ctx));
    const stamp = { status: "ready" as const, lookupGen: 1, lookupRequestedAt: OLD(), enrichment: { league: "MLB", wikidataId: "Q5" } };
    const orphan = await looked(t, "Career Team", stamp, { kind: "team", unprinted: true, w: world });
    const printed = await looked(t, "Printed Team", stamp, { kind: "team", w: world });
    const out = await sweep(t);
    expect(out).toMatchObject({ cleared: 1, deleted: 1 });
    expect(await rowById(t, orphan.id)).toBeNull();
    expect((await rowById(t, printed.id))!.enrichment).toBeUndefined();
  });

  test("pages and is idempotent: a full chunk schedules the next run, every row ends cleared, and a second pass changes nothing", async () => {
    const t = newT();
    const world = await t.run((ctx) => seedTidyWorld(ctx));
    const bo = await t.run((ctx) => addPlayer(ctx, world, "Bo Jackson"));
    const total = LOOKUP_OUTPUT_SWEEP_CHUNK * 2 + 30;
    await t.run(async (ctx) => {
      for (let i = 0; i < total; i++) {
        await nameRow(ctx, {
          scopeId: world.base,
          sportId: world.sport,
          kind: "player",
          name: `Answered ${i}`,
          over: {
            status: "ready",
            lookupGen: 1,
            lookupRequestedAt: OLD(),
            enrichment: WD,
            answer: { kind: "linkPlayer", playerId: bo, by: "operator" },
          },
        });
      }
    });
    const first = await sweep(t);
    expect(first).toEqual({ cleared: LOOKUP_OUTPUT_SWEEP_CHUNK, deleted: 0, done: false });
    const scheduled = (await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect())).filter((s) =>
      s.name.includes("sweepExpiredLookupOutput"),
    );
    expect(scheduled).toHaveLength(1);
    let cleared = first.cleared;
    for (let guard = 0; guard < 10; guard++) {
      const next = await sweep(t);
      cleared += next.cleared;
      if (next.done) break;
    }
    expect(cleared).toBe(total);
    expect((await rowsAll(t)).every((r) => r.enrichment === undefined && r.lookupRequestedAt === undefined)).toBe(true);
    expect(await sweep(t)).toEqual({ cleared: 0, deleted: 0, done: true });
  });
});

describe("Change, then Add as new player, after the output expired", () => {
  test("the name is looked up again through the ordinary path, and the player is created from the FRESH result", async () => {
    const t = newT();
    const { w, open, bo } = await t.run(async (ctx) => {
      const w = await seedTidyWorld(ctx);
      const bo = await addPlayer(ctx, w, "Rookie Linked");
      await nameRow(ctx, { scopeId: w.base, sportId: w.sport, kind: "player", name: "Rookie Newguy" });
      const open = await printCard(ctx, w, { number: "1", printed: [{ kind: "player", name: "Rookie Newguy" }] });
      return { w, open, bo };
    });
    const as = () => t.withIdentity(ADMIN);
    // The operator linked it, with Wikidata's output on the row, a day ago.
    await as().mutation(api.tidyNames.answerName, { cardId: open, kind: "player", name: "Rookie Newguy", answer: { kind: "linkPlayer", playerId: bo } });
    const key = normalizeEntityName("Rookie Newguy");
    const rowNow = () =>
      t.run((ctx) =>
        ctx.db
          .query("tidyNames")
          .withIndex("by_scope_kind_name", (q) => q.eq("scopeId", w.base).eq("kind", "player").eq("nameNormalized", key))
          .first(),
      );
    const rowId = (await rowNow())!._id;
    await t.run((ctx) =>
      ctx.db.patch(rowId, { status: "ready", lookupGen: 1, lookupRequestedAt: OLD(), enrichment: { wikidataId: "Q_OLD", description: "stale" } }),
    );

    await sweep(t);
    const swept = (await rowNow())!;
    expect(swept.enrichment).toBeUndefined();
    expect(swept.answer).toMatchObject({ kind: "linkPlayer", by: "operator" });

    // Change: unanswered, and nobody has asked Wikidata (as far as the row knows).
    await as().mutation(api.tidyNames.answerName, { cardId: open, kind: "player", name: "Rookie Newguy", answer: { kind: "clear" } });
    expect(neverLooked((await rowNow())!)).toBe(true);

    // The open card asks (useOpenCardLookups): a lookup is queued under a new generation.
    await as().mutation(api.tidyNames.requestLookup, { cardId: open, kind: "player", name: "Rookie Newguy" });
    const asked = (await rowNow())!;
    expect(asked.status).toBe("pending");
    expect(asked.lookupGen).toBe(1);
    const queued = (await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect())).filter((s) =>
      s.name.includes("enqueueTidyNameLookups"),
    );
    expect(queued).toHaveLength(1);

    // The lookup lands, then Add as new player creates from it.
    await t.mutation(internal.tidyNames.applyLookupResult, {
      id: asked._id,
      gen: 1,
      status: "ready",
      enrichment: { wikidataId: "Q_NEW", description: "fresh" },
      sportId: asked.sportId,
    });
    const out = await as().mutation(api.tidyNames.createPlayer, { cardId: open, name: "Rookie Newguy" });
    const made = (await t.run((ctx) => ctx.db.get(out.playerId)))!;
    expect(made.externalIds?.wikidataId).toBe("Q_NEW");
  });

  test("a team row whose output expired is asked again by requestTeamLookup", async () => {
    const t = newT();
    const { w, open } = await t.run(async (ctx) => {
      const w = await seedTidyWorld(ctx);
      await nameRow(ctx, {
        scopeId: w.base,
        sportId: w.sport,
        kind: "team",
        name: "Pads",
        over: { status: "ready", lookupGen: 1, lookupRequestedAt: OLD(), enrichment: { league: "MLB" } },
      });
      const open = await printCard(ctx, w, { number: "1", printed: [{ kind: "team", name: "Pads" }] });
      return { w, open };
    });
    await sweep(t);
    await t.withIdentity(ADMIN).mutation(api.tidyNames.requestTeamLookup, { cardId: open, name: "Pads", sportId: w.sport });
    const row = (await rowsAll(t)).find((r) => r.kind === "team")!;
    expect(row.status).toBe("pending");
    expect(row.lookupGen).toBe(1);
  });
});
