/**
 * NEO-556 — copy-down planted-break proof: three row-creation sites whose
 * team-default spread no other test failed on when it was replaced by `{}`
 * (only the source pin in noTeamDefault.pin.test.ts caught two of them; the
 * third nothing).
 *
 *  - `storeSelectorOptions` (the sync's upsert of a NEW option row)
 *  - `ensureBrandUnknownRow`
 *  - `ensureBrandRow` → `ensureBrandRowForName` (brandRehome.ts)
 *
 * Each is run under a parent carrying No Team AND under a parent carrying a
 * team: the child must be born with the SAME default (a copy-down is not a new
 * decision, so No Team keeps the parent's stamp), and never both fields.
 * Nothing here may reach the network.
 */

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import type { Doc, Id } from "./_generated/dataModel";
import { teamRowFields } from "./lib/teamRow";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

beforeEach(() => {
  vi.stubGlobal("fetch", (async (url: string | URL) => {
    throw new Error(`NEO-556: this test file must not reach the network: ${String(url)}`);
  }) as unknown as typeof fetch);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const ADMIN_IDENTITY = {
  subject: "admin_copy_down_001",
  issuer: "https://clerk.example.com",
  tokenIdentifier: "clerk|admin_copy_down_001",
  name: "Admin User",
  role: "admin",
};
const SENTINEL = 1_000_000;
const NO_TEAM = { setAt: 1_600_000_000_000, setByUserId: "admin_earlier" };

type T = ReturnType<typeof convexTest>;
type Parent = "noTeam" | "team";

async function seedYear(t: T, parent: Parent) {
  return t.run(async (ctx) => {
    const sportId = await ctx.db.insert("selectorOptions", {
      level: "sport",
      value: "Baseball",
      sportConfig: { skuCode: "BB", league: "MLB" },
      platformData: {},
      children: [],
      lastUpdated: SENTINEL,
    });
    const teamId = await ctx.db.insert("teams", {
      ...teamRowFields({ name: "Bulls", location: "Durham" }),
      sportId,
      lastUpdated: SENTINEL,
    } as never);
    const yearId = await ctx.db.insert("selectorOptions", {
      level: "year",
      value: "1997",
      platformData: { bsc: { b0: "1997" } },
      platformSlotSeq: { bsc: 1 },
      parentId: sportId,
      features: { sport: "Baseball" },
      children: [],
      ...(parent === "noTeam" ? { noTeamDefault: NO_TEAM } : { teamIds: [teamId] }),
      lastUpdated: SENTINEL,
    });
    await ctx.db.patch(sportId, { children: [yearId] });
    return { sportId, yearId, teamId };
  });
}

/** The child must carry exactly the parent's default, and never both fields. */
function expectCopiedDown(
  child: Doc<"selectorOptions"> | null,
  parent: Parent,
  teamId: Id<"teams">,
) {
  expect(child).not.toBeNull();
  if (parent === "noTeam") {
    expect(child!.noTeamDefault).toEqual(NO_TEAM);
    expect(child!.teamIds).toBeUndefined();
  } else {
    expect(child!.teamIds).toEqual([teamId]);
    expect(child!.noTeamDefault).toBeUndefined();
  }
}

describe.each<Parent>(["noTeam", "team"])(
  "NEO-556 copy-down at row creation under a %s parent",
  (parent) => {
    test("storeSelectorOptions: a brand-new option row is born with the parent's default", async () => {
      const t = convexTest(schema, modules);
      const { yearId, teamId } = await seedYear(t, parent);

      await t.withIdentity(ADMIN_IDENTITY).mutation(api.selectorOptions.storeSelectorOptions, {
        level: "manufacturer",
        parentId: yearId,
        options: [{ value: "Fleer", platformData: { bsc: "fleer" } }],
      });

      const child = await t.run(async (ctx) =>
        ctx.db
          .query("selectorOptions")
          .withIndex("by_level_and_parent", (q) =>
            q.eq("level", "manufacturer").eq("parentId", yearId),
          )
          .first(),
      );
      expect(child?.value).toBe("Fleer");
      expectCopiedDown(child, parent, teamId);
    });

    test("ensureBrandUnknownRow: the minted Unknown brand is born with the year's default", async () => {
      const t = convexTest(schema, modules);
      const { yearId, teamId } = await seedYear(t, parent);

      const result = await t.mutation(internal.selectorOptions.ensureBrandUnknownRow, {
        yearId,
      });

      expect(result.created).toBe(true);
      expectCopiedDown(await t.run(async (ctx) => ctx.db.get(result.id)), parent, teamId);
    });

    test("ensureBrandRow: the minted known brand is born with the year's default", async () => {
      const t = convexTest(schema, modules);
      const { yearId, teamId } = await seedYear(t, parent);

      const result = await t.mutation(internal.selectorOptions.ensureBrandRow, {
        yearId,
        name: "Topps",
      });

      expect(result.created).toBe(true);
      expectCopiedDown(await t.run(async (ctx) => ctx.db.get(result.id!)), parent, teamId);
    });
  },
);
