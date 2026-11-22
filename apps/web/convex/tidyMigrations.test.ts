/**
 * NEO-645 — the three migrations behind One-card Tidy Up: skips become
 * "not an entity" answers (M1), a card's legacy pending names become name rows
 * and printed rows (M2), the review queue is drained (M3).
 *
 * Each runs dry by default, applies only with `{confirm: "APPLY"}` AND the
 * deployment flag, and its dry run reports what the armed run does.
 */

import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { insertTestCard } from "../lib/testing/card-row";
import { normalizeEntityName } from "../lib/entities/normalize-name";
import { listCardPrintedNames } from "./cardPrintedNames";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

type T = ReturnType<typeof convexTest>;
type Sel = Id<"selectorOptions">;

afterEach(() => {
  vi.unstubAllEnvs();
});

async function seed(t: T) {
  return t.run(async (ctx) => {
    const node = async (level: string, value: string, parentId?: Sel) => {
      const id = await ctx.db.insert("selectorOptions", {
        level: level as "sport",
        value,
        ...(parentId ? { parentId } : {}),
        platformData: {},
        children: [],
        lastUpdated: 1_700_000_000_000,
      });
      if (parentId) {
        const parent = await ctx.db.get(parentId);
        await ctx.db.patch(parentId, { children: [...(parent?.children ?? []), id] });
      }
      return id;
    };
    const sport = await node("sport", "Baseball");
    const year = await node("year", "2024", sport);
    const brand = await node("manufacturer", "Topps", year);
    const set = await node("setName", "Chrome", brand);
    const leaf = await node("variantType", "Insert", set);
    const other = await node("variantType", "Refractor", set);
    return { sport, leaf, other };
  });
}

const ARM = { confirm: "APPLY" };
const arm = () => vi.stubEnv("TIDY_MIGRATION_ARMED", "1");

describe("M1 migrateSkipsToAnswers", () => {
  async function skip(t: T, scope: Sel, kind: "player" | "team", name: string) {
    return t.run((ctx) =>
      ctx.db.insert("entityReviewSkips", {
        selectorOptionId: scope,
        kind,
        nameNormalized: name.toLowerCase(),
        name,
        skippedAt: 1_700_000_001_000,
        skippedByUserId: "operator_1",
      }),
    );
  }
  const names = (t: T) => t.run((ctx) => ctx.db.query("tidyNames").collect());

  test("dry by default: reports, writes nothing", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await skip(t, s.leaf, "player", "CHECKLIST");
    const report = await t.action(internal.tidyMigrations.migrateSkipsToAnswers, {});
    expect(report).toMatchObject({ mode: "dryRun", inserted: 1, scanned: 1 });
    expect(await names(t)).toEqual([]);
  });

  test("confirm alone is refused: the deployment must be armed too, and it runs dry", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await skip(t, s.leaf, "player", "CHECKLIST");
    const report = await t.action(internal.tidyMigrations.migrateSkipsToAnswers, ARM);
    expect(report.mode).toBe("dryRun");
    expect(report.refused).toMatch(/TIDY_MIGRATION_ARMED/);
    expect(await names(t)).toEqual([]);
  });

  test("armed: one answered row per skip, same scope, kind and operator; the skips stay", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await skip(t, s.leaf, "player", "CHECKLIST");
    await skip(t, s.leaf, "team", "SPONSORED BY ACME");
    await skip(t, s.other, "player", "CHECKLIST");
    arm();
    const report = await t.action(internal.tidyMigrations.migrateSkipsToAnswers, ARM);
    expect(report).toMatchObject({ mode: "applied", inserted: 3 });

    const rows = await names(t);
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.answer).toEqual({ kind: "notEntity", by: "operator" });
      expect(row.sportId).toBe(s.sport);
      expect(row.answeredByUserId).toBe("operator_1");
      expect(row.answeredAt).toBe(1_700_000_001_000);
      expect(row.nameNormalized).toBe(normalizeEntityName(row.name));
    }
    expect(new Set(rows.map((r) => r.scopeId))).toEqual(new Set([s.leaf, s.other]));
    // Never deletes the old table.
    expect(await t.run((ctx) => ctx.db.query("entityReviewSkips").collect())).toHaveLength(3);
  });

  test("idempotent: a second run inserts nothing", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await skip(t, s.leaf, "player", "CHECKLIST");
    arm();
    await t.action(internal.tidyMigrations.migrateSkipsToAnswers, ARM);
    const again = await t.action(internal.tidyMigrations.migrateSkipsToAnswers, ARM);
    expect(again).toMatchObject({ inserted: 0, alreadyMigrated: 1 });
    expect(await names(t)).toHaveLength(1);
  });

  test("an existing unanswered row takes the answer; an operator's link is a conflict and wins", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await skip(t, s.leaf, "player", "Open Name");
    await skip(t, s.leaf, "player", "Linked Name");
    const player = await t.run((ctx) =>
      ctx.db.insert("players", {
        name: "Linked Name",
        nameNormalized: normalizeEntityName("Linked Name"),
        sportId: s.sport,
        lastUpdated: 1,
      }),
    );
    await t.run(async (ctx) => {
      await ctx.db.insert("tidyNames", {
        scopeId: s.leaf,
        kind: "player",
        nameNormalized: normalizeEntityName("Open Name"),
        name: "Open Name",
        sportId: s.sport,
        status: "ready",
      });
      await ctx.db.insert("tidyNames", {
        scopeId: s.leaf,
        kind: "player",
        nameNormalized: normalizeEntityName("Linked Name"),
        name: "Linked Name",
        sportId: s.sport,
        status: "ready",
        answer: { kind: "linkPlayer", playerId: player, by: "operator" },
      });
    });
    arm();
    const report = await t.action(internal.tidyMigrations.migrateSkipsToAnswers, ARM);
    expect(report).toMatchObject({ answered: 1, conflicts: 1, inserted: 0 });
    const rows = await names(t);
    expect(rows.find((r) => r.name === "Open Name")!.answer?.kind).toBe("notEntity");
    expect(rows.find((r) => r.name === "Linked Name")!.answer?.kind).toBe("linkPlayer");
  });

  test("a skip whose leaf is gone is counted and skipped", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const id = await skip(t, s.other, "player", "Gone");
    await t.run(async (ctx) => {
      const skipDoc = (await ctx.db.get(id))!;
      expect(skipDoc).toBeTruthy();
      await ctx.db.delete(s.other);
    });
    arm();
    const report = await t.action(internal.tidyMigrations.migrateSkipsToAnswers, ARM);
    expect(report).toMatchObject({ leafGone: 1, inserted: 0 });
  });

  test("pages with a real cursor: more skips than one page are all migrated", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    for (let i = 0; i < 130; i++) await skip(t, s.leaf, "player", `Junk Name${String.fromCharCode(97 + (i % 26))}${Math.floor(i / 26)}`);
    arm();
    const report = await t.action(internal.tidyMigrations.migrateSkipsToAnswers, ARM);
    expect(report.pages).toBeGreaterThan(1);
    expect(report.inserted).toBe(130);
    expect(await names(t)).toHaveLength(130);
  });
});

describe("M2 backfillLegacyPendingNames", () => {
  async function card(t: T, scope: Sel, n: string, extra: Record<string, unknown> = {}) {
    return t.run((ctx) =>
      insertTestCard(ctx, {
        selectorOptionId: scope,
        cardNumber: n,
        cardName: `Card ${n}`,
        platformData: {},
        sortOrder: Number(n),
        lastUpdated: 1_700_000_000_000,
        ...extra,
      }),
    );
  }
  const printed = (t: T, id: Id<"cardChecklist">) =>
    t.run((ctx) => listCardPrintedNames(ctx, id));
  const names = (t: T) => t.run((ctx) => ctx.db.query("tidyNames").collect());

  test("dry: counts names, writes nothing", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const id = await card(t, s.leaf, "1", { pendingPlayerNames: ["Bo Jackson"], pendingTeamNames: ["Royals"] });
    const report = await t.action(internal.tidyMigrations.backfillLegacyPendingNames, {});
    expect(report).toMatchObject({ mode: "dryRun", cardsWithNames: 1, nameRowsInserted: 2, printedRows: 2 });
    expect(await names(t)).toEqual([]);
    expect(await printed(t, id)).toEqual([]);
  });

  test("armed: a name row (ready) and a printed row per pending name, in order; the pending lists stay; lastUpdated is not bumped", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const id = await card(t, s.leaf, "1", { pendingPlayerNames: ["Bo Jackson", "Dan Marino"], pendingTeamNames: ["Royals"] });
    arm();
    await t.action(internal.tidyMigrations.backfillLegacyPendingNames, ARM);
    const rows = await names(t);
    expect(rows.map((r) => `${r.kind}:${r.nameNormalized}`).sort()).toEqual(
      [`player:${normalizeEntityName("Bo Jackson")}`, `player:${normalizeEntityName("Dan Marino")}`, `team:${normalizeEntityName("Royals")}`].sort(),
    );
    expect(rows.every((r) => r.status === "ready" && r.scopeId === s.leaf && r.sportId === s.sport)).toBe(true);
    const printedRows = await printed(t, id);
    expect(printedRows.filter((r) => r.kind === "player").map((r) => [r.printed, r.order])).toEqual([
      ["Bo Jackson", 0],
      ["Dan Marino", 1],
    ]);
    const after = await t.run((ctx) => ctx.db.get(id));
    expect(after!.pendingPlayerNames).toEqual(["Bo Jackson", "Dan Marino"]);
    expect(after!.lastUpdated).toBe(1_700_000_000_000);
  });

  test("a pending spelling a linked nameOnCard already answers is dropped; a ruled-out name is dropped; the rest stay", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const player = await t.run((ctx) =>
      ctx.db.insert("players", { name: "Bo Jackson", nameNormalized: normalizeEntityName("Bo Jackson"), sportId: s.sport, lastUpdated: 1 }),
    );
    const id = await card(t, s.leaf, "1", {
      playerIds: [player],
      playerLinks: [{ playerId: player, nameOnCard: "Bo Jackson" }],
      pendingPlayerNames: ["Jackson, Bo", "CHECKLIST", "Dan Marino"],
    });
    await t.run((ctx) =>
      ctx.db.insert("entityReviewSkips", {
        selectorOptionId: s.leaf,
        kind: "player",
        nameNormalized: normalizeEntityName("CHECKLIST"),
        name: "CHECKLIST",
        skippedAt: 1,
        skippedByUserId: "op",
      }),
    );
    arm();
    const report = await t.action(internal.tidyMigrations.backfillLegacyPendingNames, ARM);
    expect(report).toMatchObject({ pendingDropped: 2, cardsPatched: 1 });
    const after = await t.run((ctx) => ctx.db.get(id));
    expect(after!.pendingPlayerNames).toEqual(["Dan Marino"]);
    // order = links already on the card + position among the kept names.
    const [only] = (await printed(t, id)).filter((r) => r.kind === "player");
    expect(only.printed).toBe("Dan Marino");
    expect(only.order).toBe(1);
  });

  test("idempotent, and one name row for a name two cards print", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await card(t, s.leaf, "1", { pendingPlayerNames: ["Bo Jackson"] });
    await card(t, s.leaf, "2", { pendingPlayerNames: ["Bo Jackson"] });
    arm();
    await t.action(internal.tidyMigrations.backfillLegacyPendingNames, ARM);
    const again = await t.action(internal.tidyMigrations.backfillLegacyPendingNames, ARM);
    expect(again.nameRowsInserted).toBe(0);
    expect(await names(t)).toHaveLength(1);
    expect(await t.run((ctx) => ctx.db.query("cardPrintedNames").collect())).toHaveLength(2);
  });

  test("pages by cursor within an op budget: more cards than one page all migrate", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    for (let i = 1; i <= 120; i++) await card(t, s.leaf, String(i), { pendingPlayerNames: [`Player Number${String.fromCharCode(96 + (i % 26 || 26))}${i}`] });
    arm();
    const report = await t.action(internal.tidyMigrations.backfillLegacyPendingNames, ARM);
    expect(report.pages).toBeGreaterThan(1);
    expect(report.cardsWithNames).toBe(120);
    expect(await t.run((ctx) => ctx.db.query("cardPrintedNames").collect())).toHaveLength(120);
  });
});

describe("M3 drainEntityReviewQueue", () => {
  async function queueRow(t: T, scope: Sel, sport: Sel, name: string) {
    return t.run((ctx) =>
      ctx.db.insert("entityReviewQueue", {
        selectorOptionId: scope,
        batchId: "b",
        createdByUserId: "u",
        kind: "player",
        name,
        nameNormalized: normalizeEntityName(name),
        sportId: sport,
        status: "ready",
      }),
    );
  }

  test("dry reports the count and keeps the rows; armed deletes them all across pages", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    for (let i = 0; i < 7; i++) await queueRow(t, s.leaf, s.sport, `Queued ${i}`);
    const dry = await t.action(internal.tidyMigrations.drainEntityReviewQueue, {});
    expect(dry).toMatchObject({ mode: "dryRun", scanned: 7, deleted: 0 });
    expect(await t.run((ctx) => ctx.db.query("entityReviewQueue").collect())).toHaveLength(7);

    arm();
    const done = await t.action(internal.tidyMigrations.drainEntityReviewQueue, ARM);
    expect(done).toMatchObject({ mode: "applied", scanned: 7, deleted: 7 });
    expect(await t.run((ctx) => ctx.db.query("entityReviewQueue").collect())).toEqual([]);
  });

  test("the page mutation refuses to write on an unarmed deployment, whatever its caller says", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(internal.tidyMigrations.drainEntityReviewQueuePage, { cursor: null, apply: true }),
    ).rejects.toThrow(/TIDY_MIGRATION_ARMED/);
  });
});
