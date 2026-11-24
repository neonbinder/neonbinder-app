/**
 * NEO-645 — `tidyNames.lookupsPending`, the one real function of the first
 * slice, and the schema contract of the `tidyNames` table (the three indexes
 * the readers and the stale sweep rely on).
 */

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import {
  LOOKUPS_PENDING_RETURN_MAX,
  MAX_TIDY_NAME_LENGTH,
} from "./tidyNames";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

const NOW = 1_700_000_000_000;
const ADMIN = { subject: "user_admin", role: "admin" };
const MEMBER = { subject: "user_member" };
type T = ReturnType<typeof convexTest>;

async function seed(t: T) {
  return t.run(async (ctx) => {
    const sport = await ctx.db.insert("selectorOptions", {
      level: "sport",
      value: "Baseball",
      platformData: {},
      children: [],
      lastUpdated: NOW,
    });
    const leaf = (value: string) =>
      ctx.db.insert("selectorOptions", {
        level: "variantType",
        value,
        parentId: sport,
        platformData: {},
        children: [],
        lastUpdated: NOW,
      });
    return { sport, a: await leaf("Base"), b: await leaf("Insert") };
  });
}

const name = (
  t: T,
  scopeId: Id<"selectorOptions">,
  sportId: Id<"selectorOptions">,
  n: string,
  over: Record<string, unknown> = {},
) =>
  t.run(async (ctx) =>
    ctx.db.insert("tidyNames", {
      scopeId,
      kind: "player",
      nameNormalized: n,
      name: n,
      sportId,
      status: "pending",
      ...over,
    }),
  );

describe("tidyNames.lookupsPending", () => {
  test("lists the pending names of one scope and nothing else", async () => {
    const t = convexTest(schema, modules);
    const { sport, a, b } = await seed(t);
    await name(t, a, sport, "doc gooden");
    await name(t, a, sport, "ny", { kind: "team" });
    await name(t, a, sport, "ready one", { status: "ready" });
    await name(t, a, sport, "failed one", { status: "error" });
    await name(t, b, sport, "other leaf");
    const out = await t.withIdentity(ADMIN).query(api.tidyNames.lookupsPending, { scopeId: a });
    expect(out.more).toBe(false);
    expect(out.names.map((n) => `${n.kind}:${n.nameNormalized}`).sort()).toEqual([
      "player:doc gooden",
      "team:ny",
    ]);
  });

  test("is empty for a scope with nothing pending", async () => {
    const t = convexTest(schema, modules);
    const { a } = await seed(t);
    expect(
      await t.withIdentity(ADMIN).query(api.tidyNames.lookupsPending, { scopeId: a }),
    ).toEqual({ names: [], more: false });
  });

  test("a lookup landing removes the name on the next read", async () => {
    const t = convexTest(schema, modules);
    const { sport, a } = await seed(t);
    const id = await name(t, a, sport, "doc gooden");
    const read = () => t.withIdentity(ADMIN).query(api.tidyNames.lookupsPending, { scopeId: a });
    expect((await read()).names).toHaveLength(1);
    await t.run(async (ctx) => ctx.db.patch(id, { status: "ready" }));
    expect((await read()).names).toEqual([]);
  });

  test("is bounded: more than the cap returns the cap and says there is more", async () => {
    const t = convexTest(schema, modules);
    const { sport, a } = await seed(t);
    await t.run(async (ctx) => {
      for (let i = 0; i < LOOKUPS_PENDING_RETURN_MAX + 3; i++) {
        await ctx.db.insert("tidyNames", {
          scopeId: a,
          kind: "player",
          nameNormalized: `name ${i}`,
          name: `Name ${i}`,
          sportId: sport,
          status: "pending",
        });
      }
    });
    const out = await t.withIdentity(ADMIN).query(api.tidyNames.lookupsPending, { scopeId: a });
    expect(out.names).toHaveLength(LOOKUPS_PENDING_RETURN_MAX);
    expect(out.more).toBe(true);
  });

  test("refuses a signed-out caller and a non-admin", async () => {
    const t = convexTest(schema, modules);
    const { a } = await seed(t);
    await expect(t.query(api.tidyNames.lookupsPending, { scopeId: a })).rejects.toThrow();
    await expect(
      t.withIdentity(MEMBER).query(api.tidyNames.lookupsPending, { scopeId: a }),
    ).rejects.toThrow(/admin access required/i);
  });
});

describe("tidyNames table", () => {
  test("holds an auto answer, an operator answer, a notEntity answer and an enrichment payload", async () => {
    const t = convexTest(schema, modules);
    const { sport, a } = await seed(t);
    const player = await t.run(async (ctx) =>
      ctx.db.insert("players", {
        name: "Jackson Merrill",
        nameNormalized: "jackson merrill",
        sportId: sport,
        lastUpdated: NOW,
      }),
    );
    const team = await t.run(async (ctx) =>
      ctx.db.insert("teams", {
        name: "Padres",
        nameNormalized: "padres",
        sportId: sport,
        lastUpdated: NOW,
      }),
    );
    await name(t, a, sport, "auto", {
      status: "ready",
      answer: { kind: "linkPlayer", playerId: player, by: "auto", autoReason: "hallOfFame" },
      answerGen: 1,
    });
    await name(t, a, sport, "operator", {
      status: "ready",
      answer: { kind: "linkTeam", teamId: team, by: "operator", saveAsAlias: true },
      answeredByUserId: "user_admin",
      answeredAt: NOW,
      kind: "team",
    });
    await name(t, a, sport, "junk", {
      status: "ready",
      answer: { kind: "notEntity", by: "operator" },
    });
    await name(t, a, sport, "enriched", {
      status: "ready",
      lookupGen: 2,
      lookupRequestedAt: NOW,
      enrichment: {
        wikidataId: "Q1",
        careerTeams: [{ name: "San Diego Padres", fromYear: 2024 }],
        existingCandidates: [
          { playerId: player, name: "Jackson Merrill", careerSummary: "Padres 2024-" },
        ],
        preselect: {
          playerId: player,
          name: "Jackson Merrill",
          sportId: sport,
          sportValue: "Baseball",
          reason: "careerTeam",
        },
      },
      candidateTeamIds: [team],
      candidatePlace: true,
    });
    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("tidyNames")
        .withIndex("by_scope_kind_name", (q) => q.eq("scopeId", a))
        .collect(),
    );
    expect(rows).toHaveLength(4);
  });

  test("the stale-lookup index reads pending rows by request time", async () => {
    const t = convexTest(schema, modules);
    const { sport, a } = await seed(t);
    await name(t, a, sport, "old", { lookupRequestedAt: NOW - 1000 });
    await name(t, a, sport, "new", { lookupRequestedAt: NOW });
    const stale = await t.run(async (ctx) =>
      ctx.db
        .query("tidyNames")
        .withIndex("by_status_requested", (q) =>
          q.eq("status", "pending").lt("lookupRequestedAt", NOW - 500),
        )
        .collect(),
    );
    expect(stale.map((r) => r.nameNormalized)).toEqual(["old"]);
  });

  test("the name bound matches the schema comment", () => {
    expect(MAX_TIDY_NAME_LENGTH).toBe(120);
  });
});
