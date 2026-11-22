/**
 * NEO-645 — the Sport chip (`setNameSport`), "Add as new player anyway"
 * (`requestLookup`), and the Wikidata result that lands (`applyLookupResult`).
 *
 * Every request bumps `lookupGen` and the pool is asked under that generation;
 * a result for a question the row has since moved past (an older generation, or
 * another sport) is dropped, so a slow lookup can never overwrite a newer one.
 */

import { convexTest } from "convex-test";
import { afterEach, describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { backstopLookupRowImpl, LOOKUP_STALE_MS } from "./tidyNames";
import { cancelScheduled } from "../lib/testing/drain-scheduled";
import { normalizeEntityName } from "../lib/entities/normalize-name";
import { addPlayer, nameRow, printCard, seedTidyWorld } from "../lib/testing/tidy-world";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

const ADMIN = { subject: "user_tidy_lookup_admin", role: "admin" };
const MEMBER = { subject: "user_tidy_lookup_member" };
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

const NAME = "Rookie Newguy";

async function setup(t: T, over: Record<string, unknown> = {}, kind: "player" | "team" = "player") {
  return t.run(async (ctx) => {
    const w = await seedTidyWorld(ctx);
    const hoops = await ctx.db.insert("selectorOptions", {
      level: "sport",
      value: "Basketball",
      platformData: {},
      children: [],
      lastUpdated: 1,
    });
    const rowId = await nameRow(ctx, {
      scopeId: w.base,
      sportId: w.sport,
      kind,
      name: NAME,
      over: over as never,
    });
    const open = await printCard(ctx, w, { number: "1", printed: [{ kind, name: NAME }] });
    return { w, hoops, rowId, open };
  });
}

const rowById = (t: T, id: Id<"tidyNames">) => t.run((ctx) => ctx.db.get(id));
const scheduledLookups = async (t: T) => {
  const all = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
  return all.filter((s) => s.name.includes("enqueueTidyNameLookups"));
};
const setSport = (t: T, cardId: Id<"cardChecklist">, sportId: Id<"selectorOptions">, kind: "player" | "team" = "player") =>
  t.withIdentity(ADMIN).mutation(api.tidyNames.setNameSport, { cardId, kind, name: NAME, sportId });
const requestLookup = (t: T, cardId: Id<"cardChecklist">) =>
  t.withIdentity(ADMIN).mutation(api.tidyNames.requestLookup, { cardId, kind: "player", name: NAME });

describe("setNameSport", () => {
  test("re-points the row, bumps lookupGen, goes pending and asks the pool under the NEW generation", async () => {
    const t = newT();
    const { hoops, rowId, open } = await setup(t, { status: "ready", lookupGen: 3, enrichment: { wikidataId: "Q9" } });
    await setSport(t, open, hoops);
    const row = (await rowById(t, rowId))!;
    expect(row.sportId).toBe(hoops);
    expect(row.status).toBe("pending");
    expect(row.lookupGen).toBe(4);
    expect(row.lookupRequestedAt).toBeGreaterThan(0);
    // The previous sport's lookup result does not carry over.
    expect(row.enrichment).toBeUndefined();
    const scheduled = await scheduledLookups(t);
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].args[0]).toEqual({ items: [{ rowId, gen: 4 }] });
  });

  test("two changes in a row ask under two generations", async () => {
    const t = newT();
    const { w, hoops, rowId, open } = await setup(t);
    await setSport(t, open, hoops);
    await setSport(t, open, w.sport);
    expect((await rowById(t, rowId))!.lookupGen).toBe(2);
    expect((await scheduledLookups(t)).map((s) => (s.args[0] as { items: Array<{ gen: number }> }).items[0].gen).sort()).toEqual([1, 2]);
  });

  test("the sport it already has is a no-op: no bump, no lookup", async () => {
    const t = newT();
    const { w, rowId, open } = await setup(t, { lookupGen: 2 });
    await setSport(t, open, w.sport);
    expect((await rowById(t, rowId))!.lookupGen).toBe(2);
    expect(await scheduledLookups(t)).toEqual([]);
  });

  test("a name that is a same-name choice in the new sport is `ready` with its candidates, and no lookup", async () => {
    const t = newT();
    const { hoops, rowId, open, namesakes } = await (async () => {
      const s = await setup(t);
      // A same-name CHOICE needs two namesakes in the sport the chip moves to.
      const namesakes = await t.run(async (ctx) => {
        const ids: Array<Id<"players">> = [];
        for (const birthYear of [1980, 1995]) {
          ids.push(
            await ctx.db.insert("players", {
              name: NAME,
              nameNormalized: normalizeEntityName(NAME),
              sportId: s.hoops,
              birthYear,
              lastUpdated: 1,
            }),
          );
        }
        return ids;
      });
      return { ...s, namesakes };
    })();
    await setSport(t, open, hoops);
    const row = (await rowById(t, rowId))!;
    expect(row.status).toBe("ready");
    expect(row.sportId).toBe(hoops);
    expect(row.enrichment?.existingCandidates?.map((c) => c.playerId).sort()).toEqual([...namesakes].sort());
    expect(row.lookupGen).toBe(1);
    expect(await scheduledLookups(t)).toEqual([]);
  });

  test("an ANSWERED row is refused: the answer was about the old sport", async () => {
    const t = newT();
    const { w, hoops, rowId, open } = await setup(t);
    const bo = await t.run((ctx) => addPlayer(ctx, w, "Someone Else"));
    await t.run((ctx) =>
      ctx.db.patch(rowId, { answer: { kind: "linkPlayer", playerId: bo, by: "operator" }, answerGen: 1 }),
    );
    await expect(setSport(t, open, hoops)).rejects.toThrow(/Change this answer/);
    expect((await rowById(t, rowId))!.sportId).toBe(w.sport);
  });

  test("a row that is not a sport is refused", async () => {
    const t = newT();
    const { w, open } = await setup(t);
    await expect(setSport(t, open, w.base)).rejects.toThrow(/Pick a sport/);
  });

  test("works for a team name too (a team row has no same-name choice)", async () => {
    const t = newT();
    const { hoops, rowId, open } = await setup(t, {}, "team");
    await setSport(t, open, hoops, "team");
    expect((await rowById(t, rowId))!.status).toBe("pending");
    expect((await rowById(t, rowId))!.sportId).toBe(hoops);
  });

  test("refuses a signed-out caller and a non-admin", async () => {
    const t = newT();
    const { hoops, open } = await setup(t);
    const args = { cardId: open, kind: "player" as const, name: NAME, sportId: hoops };
    await expect(t.mutation(api.tidyNames.setNameSport, args)).rejects.toThrow(/Not authenticated/);
    await expect(t.withIdentity(MEMBER).mutation(api.tidyNames.setNameSport, args)).rejects.toThrow(
      /Admin access required/,
    );
  });
});

describe("requestLookup", () => {
  const choice = (playerId: Id<"players">) => ({
    status: "ready" as const,
    lookupGen: 0,
    enrichment: {
      existingCandidates: [{ playerId, name: NAME, careerSummary: "-" }],
    },
  });

  test("a name that was born a same-name choice asks Wikidata now: gen bump, pending, one enqueue", async () => {
    const t = newT();
    const s = await setup(t);
    const namesake = await t.run((ctx) => addPlayer(ctx, s.w, NAME));
    await t.run((ctx) => ctx.db.patch(s.rowId, choice(namesake)));
    await requestLookup(t, s.open);
    const row = (await rowById(t, s.rowId))!;
    expect(row.status).toBe("pending");
    expect(row.lookupGen).toBe(1);
    expect((await scheduledLookups(t))[0].args[0]).toEqual({ items: [{ rowId: s.rowId, gen: 1 }] });
  });

  test("a second press while it is looking up asks again under a NEWER generation", async () => {
    const t = newT();
    const s = await setup(t);
    const namesake = await t.run((ctx) => addPlayer(ctx, s.w, NAME));
    await t.run((ctx) => ctx.db.patch(s.rowId, choice(namesake)));
    await requestLookup(t, s.open);
    // Lands ready with a choice but no wikidata id: still awaiting, so asking again is allowed.
    await t.run((ctx) => ctx.db.patch(s.rowId, { status: "ready" }));
    await requestLookup(t, s.open);
    expect((await rowById(t, s.rowId))!.lookupGen).toBe(2);
  });

  test("a row that was already looked up (it has a Wikidata id) is not asked again", async () => {
    const t = newT();
    const s = await setup(t);
    const namesake = await t.run((ctx) => addPlayer(ctx, s.w, NAME));
    await t.run((ctx) =>
      ctx.db.patch(s.rowId, {
        ...choice(namesake),
        enrichment: { wikidataId: "Q1", existingCandidates: choice(namesake).enrichment.existingCandidates },
      }),
    );
    await requestLookup(t, s.open);
    expect((await rowById(t, s.rowId))!.lookupGen).toBe(0);
    expect(await scheduledLookups(t)).toEqual([]);
  });

  test("a plain ready row with nothing awaited is a no-op", async () => {
    const t = newT();
    const s = await setup(t);
    await requestLookup(t, s.open);
    expect((await rowById(t, s.rowId))!.status).toBe("ready");
    expect(await scheduledLookups(t)).toEqual([]);
  });

  test("an answered row is refused; a team name has no lookup to ask for", async () => {
    const t = newT();
    const s = await setup(t);
    await t.run((ctx) => ctx.db.patch(s.rowId, { answer: { kind: "notEntity", by: "operator" }, answerGen: 1 }));
    await expect(requestLookup(t, s.open)).rejects.toThrow(/Change this answer/);
    await expect(
      t.withIdentity(ADMIN).mutation(api.tidyNames.requestLookup, { cardId: s.open, kind: "team", name: NAME }),
    ).rejects.toThrow(/Only a player/);
  });

  test("refuses a signed-out caller and a non-admin", async () => {
    const t = newT();
    const s = await setup(t);
    const args = { cardId: s.open, kind: "player" as const, name: NAME };
    await expect(t.mutation(api.tidyNames.requestLookup, args)).rejects.toThrow(/Not authenticated/);
    await expect(t.withIdentity(MEMBER).mutation(api.tidyNames.requestLookup, args)).rejects.toThrow(
      /Admin access required/,
    );
  });
});

describe("applyLookupResult — a stale pool result is ignored", () => {
  const land = (
    t: T,
    id: Id<"tidyNames">,
    gen: number,
    over: { status?: "ready" | "error"; enrichment?: unknown; sportId?: Id<"selectorOptions"> } = {},
  ) =>
    t.mutation(internal.tidyNames.applyLookupResult, {
      id,
      gen,
      status: over.status ?? "ready",
      enrichment: over.enrichment ?? { wikidataId: "Q42", description: "an outfielder" },
      ...(over.sportId ? { sportId: over.sportId } : {}),
    });

  test("the current generation lands: status ready and the payload stored", async () => {
    const t = newT();
    const s = await setup(t, { status: "pending", lookupGen: 2 });
    await land(t, s.rowId, 2);
    const row = (await rowById(t, s.rowId))!;
    expect(row.status).toBe("ready");
    expect(row.enrichment).toMatchObject({ wikidataId: "Q42", description: "an outfielder" });
  });

  test("an OLDER generation changes nothing (the question moved on)", async () => {
    const t = newT();
    const s = await setup(t, { status: "pending", lookupGen: 2 });
    await land(t, s.rowId, 1);
    const row = (await rowById(t, s.rowId))!;
    expect(row.status).toBe("pending");
    expect(row.enrichment).toBeUndefined();
  });

  test("a result for another sport than the row's now is dropped", async () => {
    const t = newT();
    const s = await setup(t, { status: "pending", lookupGen: 1 });
    await land(t, s.rowId, 1, { sportId: s.hoops });
    expect((await rowById(t, s.rowId))!.status).toBe("pending");
  });

  test("a result for an ANSWERED row is dropped: nothing reads the enrichment any more", async () => {
    const t = newT();
    const s = await setup(t, { status: "pending", lookupGen: 1, answer: { kind: "notEntity", by: "operator" }, answerGen: 1 });
    await land(t, s.rowId, 1);
    expect((await rowById(t, s.rowId))!.enrichment).toBeUndefined();
  });

  test("a result for a row that is gone is a no-op", async () => {
    const t = newT();
    const s = await setup(t, { status: "pending", lookupGen: 1 });
    await t.run((ctx) => ctx.db.delete(s.rowId));
    await expect(land(t, s.rowId, 1)).resolves.toBeNull();
  });

  test("the gate's preselect survives the lookup", async () => {
    const t = newT();
    const s = await setup(t);
    const bo = await t.run((ctx) => addPlayer(ctx, s.w, "Namesake"));
    const preselect = { playerId: bo, name: "Namesake", sportId: s.w.sport, sportValue: "Baseball", reason: "setHistory" as const };
    await t.run((ctx) => ctx.db.patch(s.rowId, { status: "pending", lookupGen: 1, enrichment: { preselect } }));
    await land(t, s.rowId, 1);
    expect((await rowById(t, s.rowId))!.enrichment?.preselect).toMatchObject({ playerId: bo, reason: "setHistory" });
  });

  test("an error never downgrades a team's partial ESPN answer", async () => {
    const t = newT();
    const s = await setup(t, { status: "ready", lookupGen: 1, enrichment: { league: "MLB" } }, "team");
    await land(t, s.rowId, 1, { status: "error", enrichment: undefined });
    const row = (await rowById(t, s.rowId))!;
    expect(row.status).toBe("ready");
    expect(row.enrichment?.league).toBe("MLB");
  });

  test("a later team lookup overlays the partial answer instead of replacing it", async () => {
    const t = newT();
    const s = await setup(t, { status: "ready", lookupGen: 1, enrichment: { league: "MLB", colors: { primary: "#111" } } }, "team");
    await land(t, s.rowId, 1, { enrichment: { location: "San Diego", colors: { secondary: "#222" } } });
    const row = (await rowById(t, s.rowId))!;
    expect(row.enrichment).toMatchObject({ league: "MLB", location: "San Diego", colors: { primary: "#111", secondary: "#222" } });
  });

  test("keeps only the fields the table stores and caps the career list at 64", async () => {
    const t = newT();
    const s = await setup(t, { status: "pending", lookupGen: 1 });
    const careerTeams = Array.from({ length: 70 }, (_, i) => ({ name: `Team ${i}`, fromYear: 1900 + i, stray: "x" }));
    await land(t, s.rowId, 1, { enrichment: { wikidataId: "Q1", careerTeams, notAField: "dropped" } });
    const row = (await rowById(t, s.rowId))!;
    expect(row.enrichment?.careerTeams).toHaveLength(64);
    expect(row.enrichment as Record<string, unknown>).not.toHaveProperty("notAField");
    expect(row.enrichment?.careerTeams?.[0]).toEqual({ name: "Team 0", fromYear: 1900 });
  });
});

describe("the backstop and the stale sweep", () => {
  test("the backstop errors a row still pending under the SAME generation, and only that", async () => {
    const t = newT();
    const s = await setup(t, { status: "pending", lookupGen: 2 });
    const failed = { kind: "failed", error: "x" } as never;
    await t.run(async (ctx) => {
      await backstopLookupRowImpl(ctx, { tidyNameId: s.rowId, gen: 1 }, failed);
    });
    expect((await rowById(t, s.rowId))!.status).toBe("pending");
    await t.run(async (ctx) => {
      await backstopLookupRowImpl(ctx, { tidyNameId: s.rowId, gen: 2 }, failed);
    });
    expect((await rowById(t, s.rowId))!.status).toBe("error");
  });

  test("the sweep ages a pending row by its REQUEST time, not its creation time", async () => {
    const t = newT();
    const s = await setup(t);
    const old = await t.run((ctx) =>
      nameRow(ctx, {
        scopeId: s.w.base,
        sportId: s.w.sport,
        kind: "player",
        name: "Old Request",
        over: { status: "pending", lookupGen: 1, lookupRequestedAt: Date.now() - LOOKUP_STALE_MS - 1000 },
      }),
    );
    // Created long ago in table terms is irrelevant: this one was just asked.
    const fresh = await nameRow2(t, s, "Fresh Request", Date.now());
    const out = await t.mutation(internal.tidyNames.sweepStaleLookups, {});
    expect(out).toEqual({ aged: 1, done: true });
    expect((await rowById(t, old))!.status).toBe("error");
    expect((await rowById(t, fresh))!.status).toBe("pending");
  });
});

function nameRow2(t: T, s: Awaited<ReturnType<typeof setup>>, name: string, requestedAt: number) {
  return t.run((ctx) =>
    nameRow(ctx, {
      scopeId: s.w.base,
      sportId: s.w.sport,
      kind: "player",
      name,
      over: { status: "pending", lookupGen: 1, lookupRequestedAt: requestedAt },
    }),
  );
}
