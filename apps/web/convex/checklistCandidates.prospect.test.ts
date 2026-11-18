/**
 * NEO-591 — a Prospect claim survives the candidate table: the batch the fetch
 * streams, and the modal's read of it, carry `isProspect`, a held X
 * (`prospectTeam`) and the conflict's `prospectClaim` exactly as written, and a
 * held X is bounded like any name before it is stored.
 */

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { MAX_PLAYER_NAME_LENGTH } from "../lib/players/name-limits";
import { MAX_CARD_TEAMS } from "./features/cardAttention";
import { applyChecklistRow } from "../lib/checklists/apply-published-row";

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
  test("a held X and the prospect mark come back as written, with no team", async () => {
    const t = convexTest(schema, modules);
    const id = await seedRow(t);
    await start(t, id, [
      cand("1", {
        teams: [],
        teamLookup: "checklist" as const,
        isProspect: true,
        prospectTeam: "Oklahoma / Arizona",
        prospectTeams: ["Oklahoma", "Arizona"],
        rawTeamName: "Oklahoma / Arizona",
      }),
      cand("2"),
    ]);

    const res = await t.withIdentity(ADMIN).query(api.checklistCandidates.getReadyCandidates, { selectorOptionId: id });
    const one = res.cards.find((c) => c.cardNumber === "1")!;
    const two = res.cards.find((c) => c.cardNumber === "2")!;
    expect(one.isProspect).toBe(true);
    expect(one.prospectTeam).toBe("Oklahoma / Arizona");
    // The exact list comes back as written, never split out of the joined text.
    expect(one.prospectTeams).toEqual(["Oklahoma", "Arizona"]);
    expect(one.teams ?? []).toEqual([]);
    expect(two.isProspect).toBeUndefined();
    expect(two.prospectTeam).toBeUndefined();
    expect(two.prospectTeams).toBeUndefined();
  });

  test("a team conflict flagged as a prospect claim keeps its flag and its empty checklist side", async () => {
    const t = convexTest(schema, modules);
    const id = await seedRow(t);
    await start(t, id, [
      cand("1", {
        isProspect: true,
        prospectTeam: "Oklahoma",
        checklistConflict: { teams: { marketplace: ["Boston Red Sox"], checklist: [], prospectClaim: true as const } },
      }),
    ]);

    const res = await t.withIdentity(ADMIN).query(api.checklistCandidates.getReadyCandidates, { selectorOptionId: id });
    expect(res.cards[0].checklistConflict).toEqual({
      teams: { marketplace: ["Boston Red Sox"], checklist: [], prospectClaim: true },
    });
  });

  test("refuses the whole batch when a card holds more X than a card's team cap, or an X over a name's length", async () => {
    const t = convexTest(schema, modules);
    const id = await seedRow(t);
    const many = Array.from({ length: MAX_CARD_TEAMS + 1 }, (_, i) => `School ${i}`);
    await expect(start(t, id, [cand("1", { prospectTeams: many })])).rejects.toThrow(
      /card #1 carries 9 held prospect teams, above the 8-team limit/,
    );
    await expect(
      start(t, id, [cand("2", { prospectTeams: ["x".repeat(MAX_PLAYER_NAME_LENGTH + 1)] })]),
    ).rejects.toThrow(/card #2 carries a team name of \d+ characters/);
    expect(await t.run(async (ctx) => ctx.db.query("checklistCandidates").collect())).toEqual([]);
  });

  test.each(["prospectTeam", "rawTeamName"] as const)(
    "refuses the whole batch when a held %s is over a name's length, writing nothing",
    async (field) => {
      const t = convexTest(schema, modules);
      const id = await seedRow(t);
      await expect(
        start(t, id, [cand("1"), cand("2", { [field]: "x".repeat(MAX_PLAYER_NAME_LENGTH + 1) })]),
      ).rejects.toThrow(/card #2 carries a team name of \d+ characters/);
      const rows = await t.run(async (ctx) => ctx.db.query("checklistCandidates").collect());
      expect(rows).toEqual([]);
    },
  );

  test("three 50-character held Xs, built the way the fetch builds them, stream without refusing the batch (security audit S1)", async () => {
    const t = convexTest(schema, modules);
    const id = await seedRow(t);
    const xs = ["A".repeat(50), "B".repeat(50), "C".repeat(50)];
    const applied = applyChecklistRow({}, { players: [], teams: [], prospect: true, prospectTeams: xs }, () => null);
    expect(applied.prospectTeams).toEqual(xs);
    await start(t, id, [
      cand("1", {
        teams: [],
        teamLookup: "checklist" as const,
        isProspect: true,
        prospectTeam: applied.prospectTeam,
        prospectTeams: applied.prospectTeams,
        rawTeamName: applied.prospectTeam,
      }),
    ]);
    const res = await t.withIdentity(ADMIN).query(api.checklistCandidates.getReadyCandidates, { selectorOptionId: id });
    expect(res.cards[0].prospectTeams).toEqual(xs);
    expect(res.cards[0].prospectTeam!.length).toBeLessThanOrEqual(MAX_PLAYER_NAME_LENGTH);
  });
});
