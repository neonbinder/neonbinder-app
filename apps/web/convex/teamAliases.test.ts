/**
 * NEO-284 — team aliases: normalisation bounds, the `teamAliases` index diff,
 * and the writers that touch both copies.
 *
 * Mirrors `playerAliases.test.ts`, with the team-specific differences called
 * out at each test: 64 x 120 rather than 32 x 64 (a team alias is a whole
 * name, not a nickname), aliases written on `findOrCreate`'s INSERT branch
 * only, and the advisory `aliasesInUse` query.
 */

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import {
  TEAM_NAME_LOOKUP_MAX_OPS,
  TEAM_NAME_LOOKUP_READ_BUDGET,
  normalizeTeamAliasList,
  syncTeamAliases,
  normalizeTeamName,
} from "./teams";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

const ADMIN_IDENTITY = {
  subject: "admin_team_alias_001",
  issuer: "https://clerk.example.com",
  tokenIdentifier: "clerk|admin_team_alias_001",
  name: "Admin User",
  role: "admin",
};

type T = ReturnType<typeof convexTest>;

async function seedSport(t: T, value = "Baseball") {
  return t.run(async (ctx) =>
    ctx.db.insert("selectorOptions", {
      level: "sport",
      value,
      platformData: {},
      children: [],
      lastUpdated: Date.now(),
    }),
  );
}

const aliasRows = (t: T) =>
  t.run(async (ctx) => ctx.db.query("teamAliases").collect());

// ===========================================================================
// normalizeTeamAliasList
// ===========================================================================

describe("NEO-284: normalizeTeamAliasList bounds and dedupe", () => {
  test("refuses over 64 entries, naming only the count", () => {
    const raw = Array.from({ length: 65 }, (_, i) => `Team ${i}`);
    expect(() => normalizeTeamAliasList(raw, "San Diego Padres")).toThrow(
      /65 aliases; the limit is 64/,
    );
    // The message never carries the alias strings themselves — they are
    // operator input that reaches Sentry and the browser console.
    try {
      normalizeTeamAliasList(raw, "San Diego Padres");
      throw new Error("expected throw");
    } catch (err) {
      expect(String((err as Error).message)).not.toContain("Team 0");
    }
  });

  test("refuses an entry over 120 characters, naming only the length", () => {
    const tooLong = "x".repeat(121);
    expect(() =>
      normalizeTeamAliasList([tooLong], "San Diego Padres"),
    ).toThrow(/121 characters; the limit is 120/);
    try {
      normalizeTeamAliasList([tooLong], "San Diego Padres");
      throw new Error("expected throw");
    } catch (err) {
      expect(String((err as Error).message)).not.toContain(tooLong);
    }
  });

  test("an entry that normalises to the row's own FULL name is dropped", () => {
    const out = normalizeTeamAliasList(
      ["San Diego Padres", "Padres", "Friars"],
      "San Diego Padres",
    );
    expect(out).toEqual(["Padres", "Friars"]);
  });

  test("the nickname ALONE is kept — it is not the full name", () => {
    // "Padres" is a legitimate alias for "San Diego Padres" precisely because
    // NEO-236 keyed the whole name.
    const out = normalizeTeamAliasList(["Padres"], "San Diego Padres");
    expect(out).toEqual(["Padres"]);
  });

  test("dedupes on the token-sorted key the index stores", () => {
    const out = normalizeTeamAliasList(
      ["LSU Tigers", "Tigers LSU"],
      "Louisiana State University Tigers",
    );
    expect(out).toEqual(["LSU Tigers"]);
  });
});

// ===========================================================================
// syncTeamAliases — the index diff
// ===========================================================================

describe("NEO-284: syncTeamAliases diffs against by_team_id", () => {
  test("no writes when the alias list is unchanged", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const teamId = await t.run(async (ctx) =>
      ctx.db.insert("teams", {
        name: "Padres",
        location: "San Diego",
        nameNormalized: normalizeTeamName("San Diego Padres"),
        sportId,
        lastUpdated: Date.now(),
      }),
    );
    await t.run((ctx) =>
      syncTeamAliases(ctx, { teamId, sportId, aliases: ["Friars"] }),
    );
    const before = await aliasRows(t);
    expect(before).toHaveLength(1);
    const beforeId = before[0]._id;

    await t.run((ctx) =>
      syncTeamAliases(ctx, { teamId, sportId, aliases: ["Friars"] }),
    );
    const after = await aliasRows(t);
    // Same row, not deleted-and-reinserted.
    expect(after).toHaveLength(1);
    expect(after[0]._id).toBe(beforeId);
  });

  test("a stale row (alias no longer wanted) is deleted", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const teamId = await t.run(async (ctx) =>
      ctx.db.insert("teams", {
        name: "Padres",
        location: "San Diego",
        nameNormalized: normalizeTeamName("San Diego Padres"),
        sportId,
        lastUpdated: Date.now(),
      }),
    );
    await t.run((ctx) =>
      syncTeamAliases(ctx, { teamId, sportId, aliases: ["Friars", "SD Padres"] }),
    );
    await t.run((ctx) =>
      syncTeamAliases(ctx, { teamId, sportId, aliases: ["Friars"] }),
    );
    const rows = await aliasRows(t);
    expect(rows.map((r) => r.aliasNormalized)).toEqual([
      normalizeTeamName("Friars"),
    ]);
  });

  test("a wrong-sport row for a matching alias is treated as stale, not held", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t, "Baseball");
    const otherSport = await seedSport(t, "Basketball");
    const teamId = await t.run(async (ctx) =>
      ctx.db.insert("teams", {
        name: "Padres",
        location: "San Diego",
        nameNormalized: normalizeTeamName("San Diego Padres"),
        sportId,
        lastUpdated: Date.now(),
      }),
    );
    // A residue row filed under the wrong sport (predates a fix, or a bug).
    await t.run((ctx) =>
      ctx.db.insert("teamAliases", {
        teamId,
        sportId: otherSport,
        aliasNormalized: normalizeTeamName("Friars"),
      }),
    );
    await t.run((ctx) =>
      syncTeamAliases(ctx, { teamId, sportId, aliases: ["Friars"] }),
    );
    const rows = await aliasRows(t);
    // The wrong-sport row was deleted and a fresh, correctly-sported one
    // inserted — not held as-is.
    expect(rows).toHaveLength(1);
    expect(rows[0].sportId).toBe(sportId);
  });

  test("a missing alias (wanted, not yet indexed) is inserted", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const teamId = await t.run(async (ctx) =>
      ctx.db.insert("teams", {
        name: "Padres",
        location: "San Diego",
        nameNormalized: normalizeTeamName("San Diego Padres"),
        sportId,
        lastUpdated: Date.now(),
      }),
    );
    await t.run((ctx) =>
      syncTeamAliases(ctx, { teamId, sportId, aliases: ["Friars"] }),
    );
    expect(await aliasRows(t)).toHaveLength(1);
  });
});

// ===========================================================================
// saveTeamFields({ aliases })
// ===========================================================================

describe("NEO-284: saveTeamFields writes both copies", () => {
  test("writes the row's aliases column and the teamAliases index", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const id = await asAdmin.mutation(api.teams.findOrCreate, {
      name: "Padres",
      location: "San Diego",
      sportId,
    });

    await asAdmin.mutation(api.teams.saveTeamFields, {
      id,
      aliases: ["Friars", "SD Padres"],
    });

    const team = await t.run(async (ctx) => ctx.db.get(id));
    expect(team!.aliases).toEqual(["Friars", "SD Padres"]);
    expect((await aliasRows(t)).map((r) => r.aliasNormalized).sort()).toEqual(
      [normalizeTeamName("Friars"), normalizeTeamName("SD Padres")].sort(),
    );
  });

  test("a rename re-normalises the alias list against the NEW full name", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const id = await asAdmin.mutation(api.teams.findOrCreate, {
      name: "Padres",
      location: "San Diego",
      sportId,
      aliases: ["SD Padres"],
    });

    // Rename to "SD" / "Padres" while the alias box still carries the string
    // that is about to BECOME the full name — it must be dropped, even
    // though it was a legitimate alias under the old name.
    await asAdmin.mutation(api.teams.saveTeamFields, {
      id,
      location: "SD",
      aliases: ["SD Padres", "Friars"],
    });

    const team = await t.run(async (ctx) => ctx.db.get(id));
    expect(team!.aliases).toEqual(["Friars"]);
  });
});

// ===========================================================================
// findOrCreate({ aliases })
// ===========================================================================

describe("NEO-284: findOrCreate writes aliases on INSERT only", () => {
  test("the FIND branch does not widen an existing row's aliases", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const id = await asAdmin.mutation(api.teams.findOrCreate, {
      name: "Padres",
      location: "San Diego",
      sportId,
      aliases: ["Friars"],
    });
    let team = await t.run(async (ctx) => ctx.db.get(id));
    expect(team!.aliases).toEqual(["Friars"]);

    // Same era, so this call resolves to the FIND branch. New aliases must
    // not silently land on the row.
    const again = await asAdmin.mutation(api.teams.findOrCreate, {
      name: "Padres",
      location: "San Diego",
      sportId,
      aliases: ["Swinging Friars"],
    });
    expect(again).toBe(id);

    team = await t.run(async (ctx) => ctx.db.get(id));
    expect(team!.aliases).toEqual(["Friars"]);
  });

  test("the INSERT branch writes both copies", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const id = await t.withIdentity(ADMIN_IDENTITY).mutation(api.teams.findOrCreate, {
      name: "Padres",
      location: "San Diego",
      sportId,
      aliases: ["Friars", "Padres"],
    });
    const team = await t.run(async (ctx) => ctx.db.get(id));
    // "Padres" alone does not equal the full name "San Diego Padres" so it
    // is kept; only an entry equal to the FULL name is dropped.
    expect(team!.aliases).toEqual(["Friars", "Padres"]);
    expect(await aliasRows(t)).toHaveLength(2);
  });
});

// ===========================================================================
// aliasesInUse — advisory
// ===========================================================================

describe("NEO-284: aliasesInUse is admin-gated and advisory", () => {
  test("requires admin", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    await expect(
      t.query(api.teams.aliasesInUse, { sportId, aliases: ["Friars"] }),
    ).rejects.toThrow();
  });

  test("reports the other team's full name for a shared alias, self excluded", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const padres = await asAdmin.mutation(api.teams.findOrCreate, {
      name: "Padres",
      location: "San Diego",
      sportId,
      aliases: ["Friars"],
    });
    const missions = await asAdmin.mutation(api.teams.findOrCreate, {
      name: "Missions",
      location: "San Antonio",
      sportId,
    });

    expect(
      await asAdmin.query(api.teams.aliasesInUse, {
        sportId,
        aliases: ["Friars", "Nobody"],
        selfId: missions,
      }),
    ).toEqual([{ alias: "Friars", name: "San Diego Padres" }]);

    // Not reported against the row that already owns it.
    expect(
      await asAdmin.query(api.teams.aliasesInUse, {
        sportId,
        aliases: ["Friars"],
        selfId: padres,
      }),
    ).toEqual([]);
  });

  test("bounds the FAN-OUT as well as the alias count (NEO-296)", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);

    // The preloaded-college shape: ONE alias key that a whole window of teams
    // answers to. Each lookup is then 2 index reads + one `db.get` per holder
    // — 18 system ops — so the 64-alias cap alone allowed ~1,152 of them in a
    // query that re-runs as the operator types.
    for (let i = 0; i < 16; i += 1) {
      await asAdmin.mutation(api.teams.findOrCreate, {
        name: `Hurricanes ${i}`,
        location: "Miami",
        sportId,
        aliases: ["Shared College Name"],
      });
    }

    const asked = Array.from({ length: 64 }, () => "Shared College Name");
    const notes = await asAdmin.query(api.teams.aliasesInUse, {
      sportId,
      aliases: asked,
    });

    // It STOPS rather than throwing: this is a note beside a text box, and a
    // form that blanks because an advisory read got expensive is the worse
    // answer. Derived from the constants, so a change to either re-derives
    // here instead of going stale.
    const affordable = Math.ceil(
      TEAM_NAME_LOOKUP_READ_BUDGET / TEAM_NAME_LOOKUP_MAX_OPS,
    );
    expect(notes).toHaveLength(affordable);
    expect(notes.length).toBeLessThan(asked.length);
    // Every note it did answer is a real holder — a partial scan never
    // invents one, and never reports an alias it did not read.
    expect(new Set(notes.map((n) => n.alias))).toEqual(
      new Set(["Shared College Name"]),
    );
    expect(notes.every((n) => n.name.startsWith("Miami Hurricanes"))).toBe(true);
  });

  test("bounded to 64 aliases even when more are passed", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    // A caller passing 70 entries must not cost 70 index reads — the query
    // silently truncates rather than refusing, since it is advisory.
    const many = Array.from({ length: 70 }, (_, i) => `Alias ${i}`);
    await expect(
      asAdmin.query(api.teams.aliasesInUse, { sportId, aliases: many }),
    ).resolves.toEqual([]);
  });
});

// ===========================================================================
// S1 (security review): an alias may never be another team's PRIMARY name
// ===========================================================================

describe("NEO-284 S1: the writers refuse an alias that is another team's own name", () => {
  test("saveTeamFields refuses, naming the owning team — and writes nothing", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    await asAdmin.mutation(api.teams.findOrCreate, {
      name: "Tigers",
      location: "LSU",
      sportId,
    });
    const rival = await asAdmin.mutation(api.teams.findOrCreate, {
      name: "Tigers",
      location: "Auburn",
      sportId,
    });

    await expect(
      asAdmin.mutation(api.teams.saveTeamFields, {
        id: rival,
        aliases: ["War Eagle", "LSU Tigers"],
      }),
    ).rejects.toThrow(/The alias "LSU Tigers" is another team's name/);

    const row = await t.run((ctx) => ctx.db.get(rival));
    expect(row!.aliases).toBeUndefined();
    expect(await aliasRows(t)).toEqual([]);
  });

  test("the refusal names the team, not an id (NAME_TAKEN's shape is for a different surface)", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const owner = await asAdmin.mutation(api.teams.findOrCreate, {
      name: "Tigers",
      location: "LSU",
      sportId,
    });
    const rival = await asAdmin.mutation(api.teams.findOrCreate, {
      name: "Tigers",
      location: "Auburn",
      sportId,
    });
    try {
      await asAdmin.mutation(api.teams.saveTeamFields, { id: rival, aliases: ["LSU Tigers"] });
      throw new Error("expected throw");
    } catch (err) {
      const message = String((err as { data?: unknown; message?: string }).data ?? (err as Error).message);
      expect(message).not.toContain(owner);
      expect(message).not.toContain("NAME_TAKEN");
    }
  });

  test("findOrCreate refuses on the INSERT branch and inserts nothing", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    await asAdmin.mutation(api.teams.findOrCreate, {
      name: "Tigers",
      location: "LSU",
      sportId,
    });
    await expect(
      asAdmin.mutation(api.teams.findOrCreate, {
        name: "Tigers",
        location: "Auburn",
        sportId,
        aliases: ["LSU Tigers"],
      }),
    ).rejects.toThrow(/The alias "LSU Tigers" is another team's name/);
    expect(await t.run((ctx) => ctx.db.query("teams").collect())).toHaveLength(1);
  });

  test("NEO-602: a disjoint era is allowed — the 2011- row may answer to the 1972-1996 Jets' name", async () => {
    // Refused under NEO-307 ("whatever the eras"). The two teams' years do not
    // overlap, so no season has both and the alias cannot steal a card; which
    // Jets a card means is the card's players' to say (pickCardTeam).
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t, "Hockey");
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    await asAdmin.mutation(api.teams.findOrCreate, {
      name: "Jets",
      location: "Winnipeg",
      sportId,
      yearsActive: { from: 1972, to: 1996 },
    });
    const revived = await asAdmin.mutation(api.teams.findOrCreate, {
      name: "Thrashers",
      location: "Atlanta",
      sportId,
      yearsActive: { from: 2011 },
    });
    await asAdmin.mutation(api.teams.saveTeamFields, {
      id: revived,
      aliases: ["Winnipeg Jets"],
    });
    expect((await t.run((ctx) => ctx.db.get(revived)))!.aliases).toEqual(["Winnipeg Jets"]);
    expect(await aliasRows(t)).toHaveLength(1);
  });

  test("…and the other direction: the 1972-1996 Jets may wear the Thrashers' name too", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t, "Hockey");
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const jets = await asAdmin.mutation(api.teams.findOrCreate, {
      name: "Jets",
      location: "Winnipeg",
      sportId,
      yearsActive: { from: 1972, to: 1996 },
    });
    await asAdmin.mutation(api.teams.findOrCreate, {
      name: "Thrashers",
      location: "Atlanta",
      sportId,
      yearsActive: { from: 2011 },
    });
    await asAdmin.mutation(api.teams.saveTeamFields, { id: jets, aliases: ["Atlanta Thrashers"] });
    expect((await t.run((ctx) => ctx.db.get(jets)))!.aliases).toEqual(["Atlanta Thrashers"]);
  });

  test("the guard checks the era this save LEAVES on the row, not the one it had", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t, "Hockey");
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    await asAdmin.mutation(api.teams.findOrCreate, {
      name: "Jets",
      location: "Winnipeg",
      sportId,
      yearsActive: { from: 1972, to: 1996 },
    });
    const revived = await asAdmin.mutation(api.teams.findOrCreate, {
      name: "Thrashers",
      location: "Atlanta",
      sportId,
      yearsActive: { from: 2011 },
    });
    // Widening the era back over 1972-1996 in the same save as the alias:
    // the alias would now reach the other Jets, so it is refused.
    await expect(
      asAdmin.mutation(api.teams.saveTeamFields, {
        id: revived,
        yearsActive: { from: 1990 },
        aliases: ["Winnipeg Jets"],
      }),
    ).rejects.toThrow(/The alias "Winnipeg Jets" is another team's name/);
  });

  test("alias-vs-alias stays advisory: two teams may share an alias, and aliasesInUse only reports it", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const redhawks = await asAdmin.mutation(api.teams.findOrCreate, {
      name: "RedHawks",
      location: "Miami",
      sportId,
      aliases: ["Miami"],
    });
    const hurricanes = await asAdmin.mutation(api.teams.findOrCreate, {
      name: "Hurricanes",
      location: "Miami",
      sportId,
    });
    await asAdmin.mutation(api.teams.saveTeamFields, { id: hurricanes, aliases: ["Miami"] });
    expect((await t.run((ctx) => ctx.db.get(hurricanes)))!.aliases).toEqual(["Miami"]);
    expect(
      await asAdmin.query(api.teams.aliasesInUse, { sportId, aliases: ["Miami"], selfId: hurricanes }),
    ).toEqual([{ alias: "Miami", name: "Miami RedHawks" }]);
    expect(redhawks).toBeTruthy();
  });

  test("aliasesInUse drops an over-long entry before the lookup", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    await asAdmin.mutation(api.teams.findOrCreate, {
      name: "Padres",
      location: "San Diego",
      sportId,
      aliases: ["Friars"],
    });
    // A 121-character string can never equal a stored key; the advisory
    // query answers without it rather than throwing or scanning for it.
    expect(
      await asAdmin.query(api.teams.aliasesInUse, {
        sportId,
        aliases: ["x".repeat(121), "Friars"],
      }),
    ).toEqual([{ alias: "Friars", name: "San Diego Padres" }]);
  });
});

// ===========================================================================
// NEO-602: an alias may be another team's primary name when the two teams'
// years do not overlap (an undated team overlaps everything)
// ===========================================================================

/** Brooklyn Dodgers 1911–1957 and Los Angeles Dodgers 1958–, dated. */
async function seedDodgers(t: T, sportId: Id<"selectorOptions">) {
  const asAdmin = t.withIdentity(ADMIN_IDENTITY);
  const brooklyn = await asAdmin.mutation(api.teams.findOrCreate, {
    name: "Dodgers",
    location: "Brooklyn",
    sportId,
    yearsActive: { from: 1911, to: 1957 },
  });
  const la = await asAdmin.mutation(api.teams.findOrCreate, {
    name: "Dodgers",
    location: "Los Angeles",
    sportId,
    yearsActive: { from: 1958 },
  });
  return { brooklyn, la };
}

/** A team row written straight into the table, with whatever aliases it carries. */
async function insertTeam(
  t: T,
  sportId: Id<"selectorOptions">,
  row: {
    location?: string;
    name: string;
    yearsActive?: { from: number; to?: number };
    aliases?: string[];
  },
) {
  return t.run(async (ctx) => {
    const id = await ctx.db.insert("teams", {
      name: row.name,
      ...(row.location ? { location: row.location } : {}),
      nameNormalized: normalizeTeamName(row.location ? `${row.location} ${row.name}` : row.name),
      sportId,
      ...(row.yearsActive ? { yearsActive: row.yearsActive } : {}),
      ...(row.aliases ? { aliases: row.aliases } : {}),
      lastUpdated: Date.now(),
    });
    if (row.aliases) await syncTeamAliases(ctx, { teamId: id, sportId, aliases: row.aliases });
    return id;
  });
}

describe("NEO-602: a disjoint alias saves, in both directions", () => {
  test("saveTeamFields: Brooklyn Dodgers (1911–1957) may be an alias on LA (1958–)", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { la } = await seedDodgers(t, sportId);

    await asAdmin.mutation(api.teams.saveTeamFields, {
      id: la,
      aliases: ["Dodger Blue", "Brooklyn Dodgers"],
    });

    expect((await t.run((ctx) => ctx.db.get(la)))!.aliases).toEqual([
      "Dodger Blue",
      "Brooklyn Dodgers",
    ]);
    expect(await aliasRows(t)).toHaveLength(2);
  });

  test("saveTeamFields: the earlier team may wear the later team's name too", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { brooklyn } = await seedDodgers(t, sportId);

    await asAdmin.mutation(api.teams.saveTeamFields, {
      id: brooklyn,
      aliases: ["Los Angeles Dodgers"],
    });

    expect((await t.run((ctx) => ctx.db.get(brooklyn)))!.aliases).toEqual([
      "Los Angeles Dodgers",
    ]);
  });

  test("findOrCreate: the insert branch accepts the disjoint alias", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    await asAdmin.mutation(api.teams.findOrCreate, {
      name: "Dodgers",
      location: "Brooklyn",
      sportId,
      yearsActive: { from: 1911, to: 1957 },
    });
    const la = await asAdmin.mutation(api.teams.findOrCreate, {
      name: "Dodgers",
      location: "Los Angeles",
      sportId,
      yearsActive: { from: 1958 },
      aliases: ["Brooklyn Dodgers"],
    });

    expect((await t.run((ctx) => ctx.db.get(la)))!.aliases).toEqual(["Brooklyn Dodgers"]);
  });

  test("the Athletics case: Oakland Athletics (1968–2024, own name) and Athletics (2025–) wearing 'Oakland Athletics'", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const oakland = await asAdmin.mutation(api.teams.findOrCreate, {
      name: "Athletics",
      location: "Oakland",
      sportId,
      yearsActive: { from: 1968, to: 2024 },
    });
    const athletics = await asAdmin.mutation(api.teams.findOrCreate, {
      name: "Athletics",
      sportId,
      yearsActive: { from: 2025 },
      newEra: true,
    });

    await asAdmin.mutation(api.teams.saveTeamFields, {
      id: athletics,
      aliases: ["Oakland Athletics"],
    });

    expect((await t.run((ctx) => ctx.db.get(athletics)))!.aliases).toEqual([
      "Oakland Athletics",
    ]);
    expect((await t.run((ctx) => ctx.db.get(oakland)))!.aliases).toBeUndefined();
    // A bare 2025 card with no player to ask is a question, not a silent link:
    // the year would land on the alias-only Athletics while Oakland owns the name.
    expect(
      await asAdmin.query(api.teams.findByNameAndSport, {
        name: "Oakland Athletics",
        sportId,
        setYear: 2025,
      }),
    ).toBeNull();
    // A set from the Oakland years has only one eligible reading... still two
    // candidates, but the year lands on the own-name row.
    expect(
      (
        await asAdmin.query(api.teams.findByNameAndSport, {
          name: "Oakland Athletics",
          sportId,
          setYear: 1990,
        })
      )?._id,
    ).toBe(oakland);
  });

  test("the Brooklyn retro card is a question when no player says: 2026 -> null, 1950 -> Brooklyn", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { brooklyn, la } = await seedDodgers(t, sportId);
    await asAdmin.mutation(api.teams.saveTeamFields, { id: la, aliases: ["Brooklyn Dodgers"] });

    expect(
      await asAdmin.query(api.teams.findByNameAndSport, {
        name: "Brooklyn Dodgers",
        sportId,
        setYear: 2026,
      }),
    ).toBeNull();
    expect(
      (
        await asAdmin.query(api.teams.findByNameAndSport, {
          name: "Brooklyn Dodgers",
          sportId,
          setYear: 1950,
        })
      )?._id,
    ).toBe(brooklyn);
  });
});

describe("NEO-602: an overlapping or undated alias is refused, in both directions", () => {
  test("saveTeamFields: overlapping years refuse, naming the alias, the owner and both eras", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    await seedDodgers(t, sportId);
    const robins = await insertTeam(t, sportId, {
      location: "Brooklyn",
      name: "Robins",
      yearsActive: { from: 1950, to: 1960 },
    });

    const err = await asAdmin
      .mutation(api.teams.saveTeamFields, {
        id: robins,
        aliases: ["Dodger Blue", "Brooklyn Dodgers"],
      })
      .then(
        () => null,
        (e: unknown) => String((e as { data?: unknown }).data ?? (e as Error).message),
      );
    expect(err).toContain('The alias "Brooklyn Dodgers" is another team\'s name');
    expect(err).toContain("Brooklyn Dodgers · 1911–1957");
    expect(err).toContain("the two teams' years overlap");
    expect(err).toContain("Remove the alias, or give both teams years that don't overlap.");
    // Nothing written: not the clash, and not the safe alias beside it.
    expect((await t.run((ctx) => ctx.db.get(robins)))!.aliases).toBeUndefined();
    expect(await aliasRows(t)).toEqual([]);
  });

  test("saveTeamFields: an UNDATED owner refuses, and the copy says it has no years", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    await insertTeam(t, sportId, { location: "LSU", name: "Tigers" });
    const auburn = await insertTeam(t, sportId, {
      location: "Auburn",
      name: "Tigers",
      yearsActive: { from: 1900 },
    });

    await expect(
      asAdmin.mutation(api.teams.saveTeamFields, { id: auburn, aliases: ["LSU Tigers"] }),
    ).rejects.toThrow(/that team has no years on file, so they may overlap/);
  });

  test("saveTeamFields: an UNDATED self refuses against a dated owner", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { la } = await seedDodgers(t, sportId);
    await insertTeam(t, sportId, { location: "Brooklyn", name: "Robins" });
    const robins = (await t.run((ctx) => ctx.db.query("teams").collect())).find(
      (row) => row.name === "Robins",
    )!._id;

    await expect(
      asAdmin.mutation(api.teams.saveTeamFields, { id: robins, aliases: ["Brooklyn Dodgers"] }),
    ).rejects.toThrow(/this team has no years on file, so they may overlap/);
    expect(la).toBeTruthy();
  });

  test("saveTeamFields: both undated refuses ('neither team')", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    await insertTeam(t, sportId, { location: "LSU", name: "Tigers" });
    const auburn = await insertTeam(t, sportId, { location: "Auburn", name: "Tigers" });

    await expect(
      asAdmin.mutation(api.teams.saveTeamFields, { id: auburn, aliases: ["LSU Tigers"] }),
    ).rejects.toThrow(/neither team has years on file, so they may overlap/);
  });

  test("findOrCreate: the insert branch refuses an overlapping alias and inserts nothing", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    await asAdmin.mutation(api.teams.findOrCreate, {
      name: "Dodgers",
      location: "Brooklyn",
      sportId,
      yearsActive: { from: 1911, to: 1957 },
    });
    await expect(
      asAdmin.mutation(api.teams.findOrCreate, {
        name: "Robins",
        location: "Brooklyn",
        sportId,
        yearsActive: { from: 1914, to: 1931 },
        aliases: ["Brooklyn Dodgers"],
      }),
    ).rejects.toThrow(/The alias "Brooklyn Dodgers" is another team's name/);
    expect(await t.run((ctx) => ctx.db.query("teams").collect())).toHaveLength(1);
  });

  test("findOrCreate: an alias with no years on the create is undated, so it is refused against a dated owner", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    await asAdmin.mutation(api.teams.findOrCreate, {
      name: "Dodgers",
      location: "Brooklyn",
      sportId,
      yearsActive: { from: 1911, to: 1957 },
    });
    await expect(
      asAdmin.mutation(api.teams.findOrCreate, {
        name: "Robins",
        location: "Brooklyn",
        sportId,
        aliases: ["Brooklyn Dodgers"],
      }),
    ).rejects.toThrow(/this team has no years on file, so they may overlap/);
  });

  test("the guard checks the era this save LEAVES on the row, not the one it had", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { la } = await seedDodgers(t, sportId);
    // Brooklyn Dodgers is disjoint from LA (1958–), so the alias saves...
    await asAdmin.mutation(api.teams.saveTeamFields, { id: la, aliases: ["Brooklyn Dodgers"] });
    // ...but not in the same save that widens LA back over 1911–1957.
    await expect(
      asAdmin.mutation(api.teams.saveTeamFields, {
        id: la,
        yearsActive: { from: 1940 },
        aliases: ["Brooklyn Dodgers"],
      }),
    ).rejects.toThrow(/The alias "Brooklyn Dodgers" is another team's name/);
  });

  test("same sport only: an NFL team's name stays allowed as a baseball team's alias, whatever the years", async () => {
    const t = convexTest(schema, modules);
    const baseball = await seedSport(t);
    const football = await seedSport(t, "Football");
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    await asAdmin.mutation(api.teams.findOrCreate, {
      name: "Dodgers",
      location: "Brooklyn",
      sportId: football,
      yearsActive: { from: 1930, to: 1943 },
    });
    const la = await asAdmin.mutation(api.teams.findOrCreate, {
      name: "Dodgers",
      location: "Los Angeles",
      sportId: baseball,
      yearsActive: { from: 1930 },
    });

    await asAdmin.mutation(api.teams.saveTeamFields, { id: la, aliases: ["Brooklyn Dodgers"] });
    expect((await t.run((ctx) => ctx.db.get(la)))!.aliases).toEqual(["Brooklyn Dodgers"]);
  });
});

describe("NEO-602: saveTeamFields checks what a save adds, and re-checks when the years move", () => {
  /** LSU Tigers (1900–1950) and Auburn Tigers carrying "LSU Tigers" from before the rule. */
  async function seedLegacyOverlap(t: T, sportId: Id<"selectorOptions">, auburnYears: { from: number; to?: number }) {
    await insertTeam(t, sportId, {
      location: "LSU",
      name: "Tigers",
      yearsActive: { from: 1900, to: 1950 },
    });
    return insertTeam(t, sportId, {
      location: "Auburn",
      name: "Tigers",
      yearsActive: auburnYears,
      aliases: ["LSU Tigers"],
    });
  }

  test("an unrelated edit saves although the stored list holds an older overlapping alias", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const auburn = await seedLegacyOverlap(t, sportId, { from: 1930 });

    await asAdmin.mutation(api.teams.saveTeamFields, {
      id: auburn,
      colors: { primary: "#0c2340" },
    });
    expect((await t.run((ctx) => ctx.db.get(auburn)))!.colors?.primary).toBe("#0c2340");
  });

  test("adding a safe alias beside the older overlapping one saves", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const auburn = await seedLegacyOverlap(t, sportId, { from: 1930 });

    await asAdmin.mutation(api.teams.saveTeamFields, {
      id: auburn,
      aliases: ["LSU Tigers", "War Eagle"],
    });
    expect((await t.run((ctx) => ctx.db.get(auburn)))!.aliases).toEqual([
      "LSU Tigers",
      "War Eagle",
    ]);
  });

  test("adding a NEW overlapping alias is still refused while the old one stays", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const auburn = await seedLegacyOverlap(t, sportId, { from: 1930 });
    await insertTeam(t, sportId, { location: "Detroit", name: "Tigers", yearsActive: { from: 1900 } });

    await expect(
      asAdmin.mutation(api.teams.saveTeamFields, {
        id: auburn,
        aliases: ["LSU Tigers", "Detroit Tigers"],
      }),
    ).rejects.toThrow(/The alias "Detroit Tigers" is another team's name/);
  });

  test("a years edit re-checks the whole stored list: widening onto the older alias is refused", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    // Auburn (1960–) is disjoint from LSU (1900–1950): the stored alias is fine.
    const auburn = await seedLegacyOverlap(t, sportId, { from: 1960 });

    await expect(
      asAdmin.mutation(api.teams.saveTeamFields, { id: auburn, yearsActive: { from: 1940 } }),
    ).rejects.toThrow(/The alias "LSU Tigers" is another team's name \(LSU Tigers · 1900–1950\)/);
    // Refused whole: the years did not move.
    expect((await t.run((ctx) => ctx.db.get(auburn)))!.yearsActive).toEqual({ from: 1960 });
  });

  test("a years edit that moves clear of the alias's owner saves", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const auburn = await seedLegacyOverlap(t, sportId, { from: 1930 });

    await asAdmin.mutation(api.teams.saveTeamFields, { id: auburn, yearsActive: { from: 1960 } });
    expect((await t.run((ctx) => ctx.db.get(auburn)))!.yearsActive).toEqual({ from: 1960 });
  });

  test("re-saving the SAME years does not re-check (an unchanged era is not a years edit)", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const auburn = await seedLegacyOverlap(t, sportId, { from: 1930 });

    await asAdmin.mutation(api.teams.saveTeamFields, { id: auburn, yearsActive: { from: 1930 } });
    expect((await t.run((ctx) => ctx.db.get(auburn)))!.yearsActive).toEqual({ from: 1930 });
  });

  test("a years edit that widens over a team holding the name as an alias is refused (NAME_TAKEN: the collision check sees the alias holder first)", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { la } = await seedDodgers(t, sportId);
    await asAdmin.mutation(api.teams.saveTeamFields, { id: la, aliases: ["Brooklyn Dodgers"] });
    const brooklyn = (await t.run((ctx) => ctx.db.query("teams").collect())).find(
      (row) => row.location === "Brooklyn",
    )!._id;

    await expect(
      asAdmin.mutation(api.teams.saveTeamFields, {
        id: brooklyn,
        yearsActive: { from: 1911, to: 1970 },
      }),
    ).rejects.toThrow(/NAME_TAKEN/);
  });
});

describe("NEO-602: the reverse order — a team may not take a name an overlapping team holds as an alias", () => {
  /** LA (1958–) already answering to "Brooklyn Dodgers", with no Brooklyn row. */
  async function seedLaWithBrooklynAlias(t: T, sportId: Id<"selectorOptions">) {
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const la = await asAdmin.mutation(api.teams.findOrCreate, {
      name: "Dodgers",
      location: "Los Angeles",
      sportId,
      yearsActive: { from: 1958 },
    });
    await asAdmin.mutation(api.teams.saveTeamFields, { id: la, aliases: ["Brooklyn Dodgers"] });
    return la;
  }

  test("findOrCreate creates Brooklyn Dodgers (1911–1957) beside the alias once the operator confirms the new era", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const la = await seedLaWithBrooklynAlias(t, sportId);

    const brooklyn = await asAdmin.mutation(api.teams.findOrCreate, {
      name: "Dodgers",
      location: "Brooklyn",
      sportId,
      yearsActive: { from: 1911, to: 1957 },
      newEra: true,
    });

    expect(brooklyn).not.toBe(la);
    expect(await t.run((ctx) => ctx.db.query("teams").collect())).toHaveLength(2);
  });

  test("…without the confirmation it asks (TEAM_ERA_EXISTS), exactly as a same-name era does", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    await seedLaWithBrooklynAlias(t, sportId);

    const err = await asAdmin
      .mutation(api.teams.findOrCreate, {
        name: "Dodgers",
        location: "Brooklyn",
        sportId,
        yearsActive: { from: 1911, to: 1957 },
      })
      .then(
        () => null,
        (e: unknown) => (e as { data?: { code?: string } }).data,
      );
    expect(err?.code).toBe("TEAM_ERA_EXISTS");
    expect(await t.run((ctx) => ctx.db.query("teams").collect())).toHaveLength(1);
  });

  test("an OVERLAPPING (or undated) find still returns the alias holder, as it always did", async () => {
    // Typing an alias is how an operator finds its team; nothing is created.
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const la = await seedLaWithBrooklynAlias(t, sportId);

    await expect(
      asAdmin.mutation(api.teams.findOrCreate, { name: "Dodgers", location: "Brooklyn", sportId }),
    ).resolves.toBe(la);
    await expect(
      asAdmin.mutation(api.teams.findOrCreate, {
        name: "Dodgers",
        location: "Brooklyn",
        sportId,
        yearsActive: { from: 1950, to: 1960 },
      }),
    ).resolves.toBe(la);
    expect(await t.run((ctx) => ctx.db.query("teams").collect())).toHaveLength(1);
  });

  test("saveTeamFields: a RENAME onto the alias is allowed when the years are disjoint", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    await seedLaWithBrooklynAlias(t, sportId);
    const robins = await asAdmin.mutation(api.teams.findOrCreate, {
      name: "Robins",
      location: "Brooklyn",
      sportId,
      yearsActive: { from: 1914, to: 1931 },
    });

    await asAdmin.mutation(api.teams.saveTeamFields, { id: robins, name: "Dodgers" });
    expect((await t.run((ctx) => ctx.db.get(robins)))!.name).toBe("Dodgers");
  });

  test("saveTeamFields: a RENAME onto the alias is refused when the team's years overlap the holder's (NAME_TAKEN)", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    await seedLaWithBrooklynAlias(t, sportId);
    const robins = await asAdmin.mutation(api.teams.findOrCreate, {
      name: "Robins",
      location: "Brooklyn",
      sportId,
      yearsActive: { from: 1950, to: 1960 },
    });

    await expect(
      asAdmin.mutation(api.teams.saveTeamFields, { id: robins, name: "Dodgers" }),
    ).rejects.toThrow(/NAME_TAKEN/);
    expect((await t.run((ctx) => ctx.db.get(robins)))!.name).toBe("Robins");
  });

  test("a pair written BEFORE the rule does not lock the named team out of its own saves", async () => {
    // Legacy state (no backfill): Brooklyn exists AND LA holds its name as an
    // alias. Brooklyn re-saving its own name is not a rename, so the reverse
    // check must not fire.
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    await seedLaWithBrooklynAlias(t, sportId);
    const brooklyn = await insertTeam(t, sportId, {
      location: "Brooklyn",
      name: "Dodgers",
      yearsActive: { from: 1911, to: 1957 },
    });

    await asAdmin.mutation(api.teams.saveTeamFields, {
      id: brooklyn,
      name: "Dodgers",
      location: "Brooklyn",
      yearsActive: { from: 1911, to: 1957 },
    });
    expect((await t.run((ctx) => ctx.db.get(brooklyn)))!.name).toBe("Dodgers");
  });
});
