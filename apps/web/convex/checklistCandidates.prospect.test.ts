/**
 * NEO-591 — a Prospect claim survives the candidate table: the batch the fetch
 * streams, and the modal's read of it, carry `isProspect` exactly as written.
 * The X of "Prospect (X)" is one of the card's `teams`, like any team.
 */

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

const ADMIN = { subject: "admin_cand_prospect", role: "admin" };

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

const cand = (cardNumber: string, extra: Record<string, unknown> = {}) => ({
  cardNumber,
  cardName: `Card ${cardNumber}`,
  platformData: { bsc: { ref: `b${cardNumber}` } },
  bucket: "matched" as const,
  ...extra,
});

async function start(t: ReturnType<typeof convexTest>, selectorOptionId: Awaited<ReturnType<typeof seedRow>>, candidates: ReturnType<typeof cand>[]) {
  return t.mutation(internal.checklistCandidates.startCandidateBatch, {
    selectorOptionId,
    batchId: "batch-591",
    userId: ADMIN.subject,
    candidates,
    readyImmediately: true,
  });
}

describe("checklistCandidates — Prospect", () => {
  test("the prospect mark comes back as written, with X as the card's team", async () => {
    const t = convexTest(schema, modules);
    const id = await seedRow(t);
    await start(t, id, [
      cand("1", { teams: ["Dallas Baptist"], teamLookup: "checklist" as const, isProspect: true }),
      cand("2"),
    ]);

    const res = await t.withIdentity(ADMIN).query(api.checklistCandidates.getReadyCandidates, { selectorOptionId: id });
    const one = res.cards.find((c) => c.cardNumber === "1")!;
    const two = res.cards.find((c) => c.cardNumber === "2")!;
    expect(one.isProspect).toBe(true);
    expect(one.teams).toEqual(["Dallas Baptist"]);
    expect(two.isProspect).toBeUndefined();
  });

  test("a team conflict on a prospect row comes back as the plain two-sided conflict", async () => {
    const t = convexTest(schema, modules);
    const id = await seedRow(t);
    await start(t, id, [
      cand("1", {
        isProspect: true,
        checklistConflict: { teams: { marketplace: ["Boston Red Sox"], checklist: ["Dallas Baptist"] } },
      }),
    ]);

    const res = await t.withIdentity(ADMIN).query(api.checklistCandidates.getReadyCandidates, { selectorOptionId: id });
    expect(res.cards[0].isProspect).toBe(true);
    expect(res.cards[0].checklistConflict).toEqual({
      teams: { marketplace: ["Boston Red Sox"], checklist: ["Dallas Baptist"] },
    });
  });
});
