/**
 * NEO-591 — the Names gate and a "Prospect (X)" card. X is the card's printed
 * team (Jason, 2026-11-19), so it sits in the card's `teams` beside
 * `isProspect: true` and the gate reads it like any other team: a team NB has
 * no row for is an unknown team (the New Team dialog asks), a team NB has
 * resolves without asking.
 */

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { cancelScheduled } from "../lib/testing/drain-scheduled";
import { teamRowFields } from "./lib/teamRow";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

const ADMIN = {
  subject: "admin_prospect_gate_001",
  issuer: "https://clerk.example.com",
  tokenIdentifier: "clerk|admin_prospect_gate_001",
  role: "admin",
};

async function gate(teamTexts: string[], withSooners: boolean) {
  const t = convexTest(schema, modules);
  const { sportId, leafId } = await t.run(async (ctx) => {
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
      value: "Test Set",
      platformData: {},
      features: { manufacturer: "Topps", season: "2024" },
      parentId: sportId,
      children: [],
      lastUpdated: Date.now(),
    });
    const leafId = await ctx.db.insert("selectorOptions", {
      level: "variantType",
      value: "Base",
      platformData: {},
      features: { manufacturer: "Topps", season: "2024" },
      parentId: setNameId,
      children: [],
      lastUpdated: Date.now(),
    });
    if (withSooners) {
      await ctx.db.insert("teams", {
        ...teamRowFields({ name: "Sooners", location: "Oklahoma" }),
        sportId,
        lastUpdated: Date.now(),
      });
    }
    return { sportId, leafId };
  });
  const result = await t.withIdentity(ADMIN).action(api.selectorOptions.resolveChecklistEntities, {
    selectorOptionId: leafId,
    sportId,
    cards: [
      {
        cardNumber: "1",
        cardName: "Cord Rager",
        teams: teamTexts,
        players: [],
        platformData: {},
        isProspect: true,
        teamLookup: "checklist" as const,
      },
    ],
  });
  await cancelScheduled(t);
  return result;
}

describe("resolveChecklistEntities — a Prospect (X) card", () => {
  test("an X NB has no team for is an unknown team, so the New Team dialog asks", async () => {
    const result = await gate(["Dallas Baptist"], false);
    expect(result.unknownTeams).toEqual(["Dallas Baptist"]);
  });

  test("an X NB already has a team for resolves without asking", async () => {
    const result = await gate(["Oklahoma Sooners"], true);
    expect(result.unknownTeams).toEqual([]);
  });
});
