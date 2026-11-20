/**
 * NEO-426 — `resolveChecklistEntities` hands the wizard `teamlessPlayerNames`:
 * the printed spellings whose RESOLVED player's HOME sport is flagged "no
 * teams". A fact about players, never a block; extra sports never count.
 * Read inside the NEO-592 gate's one prelude hop, so a deployment with no
 * flagged sport pays no player read (the golden call count in
 * reviewGate.neo592.golden.test.ts is unchanged; the probe here pins the new
 * internal query is never called).
 */
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { normalizePlayerName } from "./players";
import { cancelScheduled } from "../lib/testing/drain-scheduled";

const realModules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

const ADMIN = {
  subject: "admin_teamless_names_001",
  issuer: "https://clerk.example.com",
  tokenIdentifier: "clerk|admin_teamless_names_001",
  name: "Admin User",
  role: "admin",
};

type T = ReturnType<typeof convexTest>;
type Sel = Id<"selectorOptions">;

/** Page arguments of every `playersWithTeamlessHomeSport` call while running. */
const lookups: Array<{ playerIds: string[]; teamlessSportIds: string[] }> = [];

function probedModules() {
  const modules: Record<string, () => Promise<unknown>> = { ...realModules };
  const key = Object.keys(realModules).find((k) => /^\.\/sportTeamless\.[jt]s$/.test(k))!;
  modules[key] = async () => {
    const real = (await realModules[key]()) as Record<string, any>;
    const fn = real.playersWithTeamlessHomeSport;
    return {
      ...real,
      playersWithTeamlessHomeSport: Object.assign(() => undefined, fn, {
        _handler: (ctx: unknown, args: { playerIds: string[]; teamlessSportIds: string[] }) => {
          lookups.push({ playerIds: [...args.playerIds], teamlessSportIds: [...args.teamlessSportIds] });
          return fn._handler(ctx, args);
        },
      }),
    };
  };
  return modules;
}

const live: T[] = [];
afterEach(async () => {
  lookups.length = 0;
  for (const t of live.splice(0)) await cancelScheduled(t);
});

async function seedTree(flagged: boolean) {
  const t = convexTest(schema, probedModules());
  live.push(t);
  const fx = await t.run(async (ctx) => {
    const now = Date.now();
    const sportId = await ctx.db.insert("selectorOptions", {
      level: "sport",
      value: "Pokemon",
      platformData: {},
      children: [],
      lastUpdated: now,
      ...(flagged ? { teamlessSport: { setAt: now, setByUserId: "admin_setter" } } : {}),
    });
    const baseballId = await ctx.db.insert("selectorOptions", {
      level: "sport",
      value: "Baseball",
      platformData: {},
      children: [],
      lastUpdated: now,
    });
    const leafId = await ctx.db.insert("selectorOptions", {
      level: "variantType",
      value: "Base",
      platformData: {},
      features: { manufacturer: "Wizards", season: "1999" },
      parentId: sportId,
      children: [],
      lastUpdated: now,
    });
    return { sportId, baseballId, leafId };
  });
  return { t, ...fx };
}

const seedPlayer = (t: T, sportId: Sel, name: string) =>
  t.run(async (ctx) =>
    ctx.db.insert("players", {
      name,
      nameNormalized: normalizePlayerName(name),
      sportId,
      lastUpdated: Date.now(),
    }),
  );

type Printed = {
  cardNumber: string;
  cardName: string;
  players: string[];
  platformData: Record<string, never>;
  checklistConflict?: unknown;
};
const printed = (cardNumber: string, players: string[], extra: Partial<Printed> = {}): Printed => ({
  cardNumber,
  cardName: `Card ${cardNumber}`,
  players,
  platformData: {},
  ...extra,
});

function resolve(t: T, sportId: Sel, leafId: Sel, cards: Printed[]) {
  return t
    .withIdentity(ADMIN)
    .action(api.selectorOptions.resolveChecklistEntities, { selectorOptionId: leafId, sportId, cards: cards as never });
}

describe("resolveChecklistEntities — teamlessPlayerNames (NEO-426)", () => {
  test("lists exactly the resolved players whose HOME sport is flagged, spellings verbatim and deduped", async () => {
    const { t, sportId, baseballId, leafId } = await seedTree(true);
    await seedPlayer(t, sportId, "Pika Chu");
    const bench = await seedPlayer(t, baseballId, "Johnny Bench");
    // Resolvable in this set through an extra sport, but his HOME sport has teams.
    await t.run(async (ctx) =>
      ctx.db.insert("playerSports", { playerId: bench, sportId, nameNormalized: normalizePlayerName("Johnny Bench") }),
    );

    const out = await resolve(t, sportId, leafId, [
      printed("1", ["Pika Chu", " pika chu "]),
      printed("2", ["pika chu", "Johnny Bench"]),
    ]);

    expect(out.unknownPlayers).toEqual([]);
    expect([...(out.teamlessPlayerNames ?? [])].sort()).toEqual(["Pika Chu", "pika chu"].sort());
  });

  test("is empty, always sent, and costs no player lookup when no sport is flagged", async () => {
    const { t, sportId, leafId } = await seedTree(false);
    await seedPlayer(t, sportId, "Pika Chu");
    const out = await resolve(t, sportId, leafId, [printed("1", ["Pika Chu"])]);
    expect(out.teamlessPlayerNames).toEqual([]);
    expect(lookups).toEqual([]);
  });

  test("with a flagged sport the lookup is asked once, with the resolved ids and the flagged sport", async () => {
    const { t, sportId, leafId } = await seedTree(true);
    const pika = await seedPlayer(t, sportId, "Pika Chu");
    await resolve(t, sportId, leafId, [printed("1", ["Pika Chu"]), printed("2", ["Pika Chu"])]);
    expect(lookups).toEqual([{ playerIds: [pika], teamlessSportIds: [sportId] }]);
  });

  test("a name the gate left unknown is never listed", async () => {
    const { t, sportId, leafId } = await seedTree(true);
    await seedPlayer(t, sportId, "Pika Chu");
    const out = await resolve(t, sportId, leafId, [printed("1", ["Pika Chu", "Totally Unknown"])]);
    expect(out.unknownPlayers).toEqual(["Totally Unknown"]);
    expect(out.teamlessPlayerNames).toEqual(["Pika Chu"]);
  });

  test("the checklist's side of a disagreement is included, since the gate resolved those names too", async () => {
    const { t, sportId, leafId } = await seedTree(true);
    await seedPlayer(t, sportId, "Pika Chu");
    await seedPlayer(t, sportId, "Char Mander");
    const out = await resolve(t, sportId, leafId, [
      printed("1", ["Pika Chu"], {
        checklistConflict: { players: { marketplace: ["Pika Chu"], checklist: ["Char Mander"] } },
      }),
    ]);
    expect([...(out.teamlessPlayerNames ?? [])].sort()).toEqual(["Char Mander", "Pika Chu"]);
  });

  test("a card with no players lists nothing", async () => {
    const { t, sportId, leafId } = await seedTree(true);
    const out = await resolve(t, sportId, leafId, [printed("1", [])]);
    expect(out.teamlessPlayerNames).toEqual([]);
  });
});
