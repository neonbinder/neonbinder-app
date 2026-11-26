/**
 * NEO-591 — what a staged candidate carries for Match Cards' number choice and
 * for the variation work: the printed numbers each source gave
 * (`sourceNumbers`, held to 64 characters), `preKept`, `numberMinted` and
 * `variationGroup`. The fetch writes them; `getReadyCandidates` hands them to
 * the client.
 */

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { MAX_SOURCE_NUMBER_LENGTH, MAX_TEAM_CELL_LENGTH } from "./checklistCandidates";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

const ADMIN = { subject: "admin_591_source_numbers", role: "admin" };

async function seedRow(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) =>
    ctx.db.insert("selectorOptions", {
      level: "variantType",
      value: "Base",
      platformData: {},
      lastUpdated: Date.now(),
    }),
  );
}

const candidate = (extra: Record<string, unknown> = {}) => ({
  cardNumber: "38",
  cardName: "Card 38",
  platformData: { bsc: { ref: "b38" } },
  bucket: "matched" as const,
  ...extra,
});

describe("sourceNumbers on a staged candidate", () => {
  test("a value of 65 characters is refused; 64 is accepted", async () => {
    const t = convexTest(schema, modules);
    const selectorOptionId = await seedRow(t);
    const start = (printed: string) =>
      t.mutation(internal.checklistCandidates.startCandidateBatch, {
        selectorOptionId,
        batchId: "batch-1",
        userId: ADMIN.subject,
        candidates: [candidate({ sourceNumbers: { sportlots: printed } })],
        readyImmediately: true,
      });

    expect(MAX_SOURCE_NUMBER_LENGTH).toBe(64);
    await expect(start("x".repeat(65))).rejects.toThrow(/source number of 65 characters/);
    await expect(start("x".repeat(64))).resolves.toMatchObject({ written: 1 });
  });

  test("a team cell over the bound is refused; at the bound it is accepted", async () => {
    const t = convexTest(schema, modules);
    const selectorOptionId = await seedRow(t);
    const start = (cell: string) =>
      t.mutation(internal.checklistCandidates.startCandidateBatch, {
        selectorOptionId,
        batchId: "batch-1",
        userId: ADMIN.subject,
        candidates: [candidate({ teamCell: cell })],
        readyImmediately: true,
      });

    await expect(start("x".repeat(MAX_TEAM_CELL_LENGTH + 1))).rejects.toThrow(
      /team cell of \d+ characters/,
    );
    await expect(start("x".repeat(MAX_TEAM_CELL_LENGTH))).resolves.toMatchObject({ written: 1 });
  });

  test("sourceNumbers, preKept, numberMinted and variationGroup round-trip through getReadyCandidates", async () => {
    const t = convexTest(schema, modules);
    const selectorOptionId = await seedRow(t);
    await t.mutation(internal.checklistCandidates.startCandidateBatch, {
      selectorOptionId,
      batchId: "batch-1",
      userId: ADMIN.subject,
      candidates: [
        candidate({
          sourceNumbers: { bsc: "38", sportlots: "38a", checklist: "BCP-38" },
          preKept: true as const,
          numberMinted: true as const,
          variationGroup: "g3",
        }),
        candidate({ cardNumber: "39", platformData: { bsc: { ref: "b39" } } }),
      ],
      readyImmediately: true,
    });

    const res = await t
      .withIdentity(ADMIN)
      .query(api.checklistCandidates.getReadyCandidates, { selectorOptionId });
    const full = res.cards.find((c) => c.cardNumber === "38");
    expect(full).toMatchObject({
      sourceNumbers: { bsc: "38", sportlots: "38a", checklist: "BCP-38" },
      preKept: true,
      numberMinted: true,
      variationGroup: "g3",
    });
    const plain = res.cards.find((c) => c.cardNumber === "39");
    expect(plain?.sourceNumbers).toBeUndefined();
    expect(plain?.preKept).toBeUndefined();
    expect(plain?.numberMinted).toBeUndefined();
    expect(plain?.variationGroup).toBeUndefined();
  });

  test("pairedBy round-trips through getReadyCandidates; a row without them stays without", async () => {
    const t = convexTest(schema, modules);
    const selectorOptionId = await seedRow(t);
    await t.mutation(internal.checklistCandidates.startCandidateBatch, {
      selectorOptionId,
      batchId: "batch-1",
      userId: ADMIN.subject,
      candidates: [
        candidate({ cardNumber: "38", pairedBy: "name" }),
        candidate({ cardNumber: "39", pairedBy: "number" }),
        candidate({ cardNumber: "40" }),
      ],
      readyImmediately: true,
    });

    const res = await t
      .withIdentity(ADMIN)
      .query(api.checklistCandidates.getReadyCandidates, { selectorOptionId });
    const byNumber = (n: string) => res.cards.find((c) => c.cardNumber === n);
    expect(byNumber("38")).toMatchObject({ pairedBy: "name" });
    expect(byNumber("39")?.pairedBy).toBe("number");
    expect(byNumber("40")?.pairedBy).toBeUndefined();
  });
});
