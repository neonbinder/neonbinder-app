/**
 * NEO-656 — `lookupTidyName` and main's "no Wikidata until Add anyway"
 * (`awaitsOperatorBeforeLookup`, NEO-332/424): a player name that already has a
 * same-name choice or a preselect is answered from those alone, with no Wikidata
 * call, unless the walk asks again with `full: true`. Preselect and candidates
 * must not wait on a call they do not need.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import { api } from "../_generated/api";
import schema from "../schema";
import type { Id } from "../_generated/dataModel";
import { cancelScheduled } from "../../lib/testing/drain-scheduled";
import { addPlayer, printCard, seedTidyWorld } from "../../lib/testing/tidy-world";

const modules = Object.fromEntries(
  Object.entries(
    (import.meta as unknown as {
      glob: (pattern: string) => Record<string, () => Promise<unknown>>;
    }).glob("../**/*.*s"),
  ).map(([key, load]) => [
    key.startsWith("../") ? `./${key.slice(3)}` : `./adapters/${key.slice(2)}`,
    load,
  ]),
);

const ADMIN = { subject: "user_lookup_admin", role: "admin" };
type T = ReturnType<typeof convexTest>;
const live: T[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  for (const t of live.splice(0)) await cancelScheduled(t);
});

const fetchSpy = vi.fn();
beforeEach(() => {
  fetchSpy.mockReset();
  // Wikidata "unreachable": a call is a transport failure, which is an `error`.
  fetchSpy.mockRejectedValue(new Error("offline"));
  vi.stubGlobal("fetch", fetchSpy);
});

async function setup(names: string[]) {
  const t = convexTest(schema, modules);
  live.push(t);
  const w = await t.run(async (ctx) => {
    const w = await seedTidyWorld(ctx);
    await ctx.db.patch(w.sport, { sportConfig: { wikidata: { sportQid: "Q5369" } } });
    return w;
  });
  const same = await t.run(async (ctx) => {
    const ids: Array<Id<"players">> = [];
    for (const n of names) ids.push(await addPlayer(ctx, w, n));
    return ids;
  });
  const cardId = await t.run((ctx) =>
    printCard(ctx, w, { number: "1", printed: [{ kind: "player", name: "Luis Castillo" }] }),
  );
  return { t, w, same, cardId };
}

const ask = (
  s: Awaited<ReturnType<typeof setup>>,
  extra: Record<string, unknown> = {},
) =>
  s.t.withIdentity(ADMIN).action(api.adapters.wikidata.lookupTidyName, {
    cardId: s.cardId,
    kind: "player",
    name: "Luis Castillo",
    sportId: s.w.sport,
    ...extra,
  });

describe("lookupTidyName: a same-name choice or a preselect waits for the operator", () => {
  test("a same-name choice (two players of the name) is returned at once with no Wikidata call", async () => {
    const s = await setup(["Luis Castillo", "Luis Castillo"]);
    const out = await ask(s);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(out.status).toBe("ready");
    expect(out.enrichment?.existingCandidates?.map((c) => c.playerId)).toEqual(s.same);
  });

  test("a preselect is returned at once with no Wikidata call, even with no same-name player", async () => {
    const s = await setup([]);
    const other = await s.t.run((ctx) => addPlayer(ctx, s.w, "Someone Else"));
    const preselect = {
      playerId: other,
      sportId: s.w.sport,
      sportValue: "Baseball",
      reason: "onlyNamesake" as const,
    };
    const out = await ask(s, { preselect });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(out).toEqual({
      status: "ready",
      enrichment: { preselect: { ...preselect, name: "Luis Castillo" } },
    });
  });

  test("full: true asks Wikidata as well, and keeps the candidates when the call fails", async () => {
    const s = await setup(["Luis Castillo", "Luis Castillo"]);
    const out = await ask(s, { full: true });
    expect(fetchSpy).toHaveBeenCalled();
    expect(out.status).toBe("error");
    expect(out.enrichment?.existingCandidates?.map((c) => c.playerId)).toEqual(s.same);
  });

  test("a name with neither a choice nor a preselect is always looked up", async () => {
    const s = await setup([]);
    await ask(s);
    expect(fetchSpy).toHaveBeenCalled();
  });

  test("a team name is always looked up (it has no same-name choice)", async () => {
    const s = await setup([]);
    await s.t.withIdentity(ADMIN).action(api.adapters.wikidata.lookupTidyName, {
      cardId: s.cardId,
      kind: "team",
      name: "Nationals",
      sportId: s.w.sport,
    });
    expect(fetchSpy).toHaveBeenCalled();
  });
});
