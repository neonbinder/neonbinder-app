/**
 * NEO-619 — `setSelectorOptionParallelsNameThemselves`, the set attributes
 * panel's "Parallels name themselves" switch on an insert.
 *
 * Same shape as `setSelectorOptionListingShortName`: one metadata key and
 * nothing else touched; on stores `true`, off deletes the key and drops an
 * emptied metadata object; admin only. Plus: only on an insert-level row under
 * an Insert type (the one row that has parallels beneath it).
 */

import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Doc, Id } from "./_generated/dataModel";

const modules = (
  import.meta as unknown as {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("./**/*.*s");

const ADMIN_IDENTITY = {
  subject: "admin_user_pnt_001",
  issuer: "https://clerk.example.com",
  tokenIdentifier: "clerk|admin_user_pnt_001",
  name: "Admin User",
  role: "admin",
};

const NON_ADMIN_IDENTITY = {
  subject: "user_pnt_001",
  issuer: "https://clerk.example.com",
  tokenIdentifier: "clerk|user_pnt_001",
  name: "Normal User",
  role: "user",
};

const SENTINEL = 1_000_000;

type T = ReturnType<typeof convexTest>;
type Level = Doc<"selectorOptions">["level"];

async function insertRow(
  t: T,
  opts: {
    level?: Level;
    parentId?: Id<"selectorOptions">;
    value?: string;
    metadata?: Record<string, unknown>;
  } = {},
): Promise<Id<"selectorOptions">> {
  return t.run(async (ctx) =>
    ctx.db.insert("selectorOptions", {
      level: opts.level ?? "insert",
      value: opts.value ?? "Zorbo Special Purple",
      platformData: {},
      children: [],
      ...(opts.parentId ? { parentId: opts.parentId } : {}),
      ...(opts.metadata ? { metadata: opts.metadata } : {}),
      lastUpdated: SENTINEL,
    }),
  );
}

/** An insert-level row under a variant type titled `typeTitle`. */
async function insertUnder(
  t: T,
  typeTitle: string,
  metadata?: Record<string, unknown>,
): Promise<Id<"selectorOptions">> {
  const typeId = await insertRow(t, { level: "variantType", value: typeTitle });
  return insertRow(t, { level: "insert", parentId: typeId, ...(metadata ? { metadata } : {}) });
}

async function getRow(t: T, id: Id<"selectorOptions">) {
  return t.run(async (ctx) => ctx.db.get(id));
}

function setOn(t: T, id: Id<"selectorOptions">, on: boolean) {
  return t
    .withIdentity(ADMIN_IDENTITY)
    .mutation(api.selectorOptions.setSelectorOptionParallelsNameThemselves, { id, on });
}

describe("setSelectorOptionParallelsNameThemselves", () => {
  test("on stores true, bumping lastUpdated", async () => {
    const t = convexTest(schema, modules);
    const id = await insertUnder(t, "Inserts");
    await setOn(t, id, true);
    const row = await getRow(t, id);
    expect(row?.metadata).toEqual({ parallelsNameThemselves: true });
    expect(row?.lastUpdated).toBeGreaterThan(SENTINEL);
  });

  test("on again is idempotent", async () => {
    const t = convexTest(schema, modules);
    const id = await insertUnder(t, "Insert", { parallelsNameThemselves: true });
    await setOn(t, id, true);
    expect((await getRow(t, id))?.metadata).toEqual({ parallelsNameThemselves: true });
  });

  test("off deletes the key and drops the emptied metadata object", async () => {
    const t = convexTest(schema, modules);
    const id = await insertUnder(t, "Inserts", { parallelsNameThemselves: true });
    await setOn(t, id, false);
    expect((await getRow(t, id))?.metadata).toBeUndefined();
  });

  test("off on a row that never had it is a quiet no-op", async () => {
    const t = convexTest(schema, modules);
    const id = await insertUnder(t, "Inserts");
    await setOn(t, id, false);
    expect((await getRow(t, id))?.metadata).toBeUndefined();
  });

  test("off keeps every other metadata key", async () => {
    const t = convexTest(schema, modules);
    const id = await insertUnder(t, "Inserts", {
      cardNumberPrefix: "H-",
      listingShortName: "Purple Box",
      parallelsNameThemselves: true,
    });
    await setOn(t, id, false);
    expect((await getRow(t, id))?.metadata).toEqual({
      cardNumberPrefix: "H-",
      listingShortName: "Purple Box",
    });
  });

  test("on keeps every other metadata key", async () => {
    const t = convexTest(schema, modules);
    const id = await insertUnder(t, "Inserts", { cardNumberPrefix: "H-", listingShortName: "Purple Box" });
    await setOn(t, id, true);
    expect((await getRow(t, id))?.metadata).toEqual({
      cardNumberPrefix: "H-",
      listingShortName: "Purple Box",
      parallelsNameThemselves: true,
    });
  });

  test.each(["Parallels", "Parallel", "Promo", "Base"])(
    "an insert-level row under a %s type is refused, writing nothing",
    async (typeTitle) => {
      const t = convexTest(schema, modules);
      const id = await insertUnder(t, typeTitle);
      await expect(setOn(t, id, true)).rejects.toThrow(/Only an insert's parallels can skip its name\./);
      const row = await getRow(t, id);
      expect(row?.metadata).toBeUndefined();
      expect(row?.lastUpdated).toBe(SENTINEL);
    },
  );

  test("an insert-level row with no parent is refused", async () => {
    const t = convexTest(schema, modules);
    const id = await insertRow(t, { level: "insert" });
    await expect(setOn(t, id, true)).rejects.toThrow(/Only an insert's parallels can skip its name\./);
    expect((await getRow(t, id))?.metadata).toBeUndefined();
  });

  test.each(["setName", "variantType", "parallel", "sport", "year", "manufacturer"] as const)(
    "a %s row is refused, even under an Insert type's title",
    async (level) => {
      const t = convexTest(schema, modules);
      const typeId = await insertRow(t, { level: "variantType", value: "Inserts" });
      const id = await insertRow(t, { level, parentId: typeId });
      await expect(setOn(t, id, true)).rejects.toThrow(/Only an insert's parallels can skip its name\./);
      expect((await getRow(t, id))?.metadata).toBeUndefined();
    },
  );

  test("the refusal is a ConvexError with string data, which userFacingMessage shows verbatim", async () => {
    const t = convexTest(schema, modules);
    const id = await insertUnder(t, "Parallels");
    try {
      await setOn(t, id, true);
      expect.unreachable("expected a ConvexError");
    } catch (e) {
      expect(e).toBeInstanceOf(ConvexError);
      expect(typeof (e as ConvexError<string>).data).toBe("string");
    }
  });

  test("a row that no longer exists is refused with a readable message", async () => {
    const t = convexTest(schema, modules);
    const id = await insertUnder(t, "Inserts");
    await t.run(async (ctx) => ctx.db.delete(id));
    await expect(setOn(t, id, true)).rejects.toThrow(/gone/);
  });

  test("refuses a signed-in non-admin and an anonymous caller, writing nothing", async () => {
    const t = convexTest(schema, modules);
    const id = await insertUnder(t, "Inserts");
    const call = (tt: T) =>
      tt.mutation(api.selectorOptions.setSelectorOptionParallelsNameThemselves, { id, on: true });
    await expect(call(t.withIdentity(NON_ADMIN_IDENTITY) as T)).rejects.toThrow();
    await expect(call(t)).rejects.toThrow();
    const row = await getRow(t, id);
    expect(row?.metadata).toBeUndefined();
    expect(row?.lastUpdated).toBe(SENTINEL);
  });
});
