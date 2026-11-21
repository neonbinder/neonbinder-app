/**
 * NEO-643 — the names the preprocess classify step reads off a card
 * (`players`, `player`, `team`) are cleansed as they come in. The adapter is
 * called with a stub ctx and a stubbed `fetch` (the `adapters.preprocess.test.ts`
 * arrangement: a loopback URL short-circuits the OIDC path). Every other field
 * of the answer passes through untouched.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ActionCtx } from "../_generated/server";
import { callProcessEntryFast, callRenderEdit } from "./preprocess";

const ctx = {
  auth: { getUserIdentity: async () => null },
  runAction: async () => null,
  scheduler: { runAfter: async () => "scheduled-id" },
} as unknown as ActionCtx;

const WIRE = {
  players: ["Wilmer R\\ios", "\\", "Jos\u00ADe Ram\\irez"],
  player: "Wilmer R\\ios",
  team: "Le\\on",
  card_number: "A\\B-12",
  side: "front",
  rotation_degrees: 0,
  orient_confidence: 0.9,
  text_count: 40,
  cropped_source: "tiered",
  dhash: "0f1e2d3c4b5a6978",
  output_written: true,
  needs_escalation: false,
};

beforeEach(() => {
  process.env.NEONBINDER_PREPROCESS_URL = "http://localhost:9998";
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.NEONBINDER_PREPROCESS_URL;
});

describe("preprocess classify names", () => {
  test("/process-entry players, player and team are cleansed; the rest is untouched", async () => {
    vi.stubGlobal("fetch", (async () => new Response(JSON.stringify(WIRE), { status: 200 })) as unknown as typeof fetch);

    const result = await callProcessEntryFast(ctx, { jobId: "j", userId: "u", entryIndex: 0 });

    expect(result.players).toEqual(["Wilmer Rios", "Jose Ramirez"]);
    expect(result.player).toBe("Wilmer Rios");
    expect(result.team).toBe("Leon");
    // Not a name: the read card number and the other fields pass through.
    expect(result.card_number).toBe("A\\B-12");
    expect(result.dhash).toBe("0f1e2d3c4b5a6978");
    expect(result.side).toBe("front");
  });

  test("a team that is only junk becomes null; null stays null", async () => {
    vi.stubGlobal("fetch", (async () =>
      new Response(JSON.stringify({ ...WIRE, team: "\\", player: null }), { status: 200 })) as unknown as typeof fetch);

    const result = await callProcessEntryFast(ctx, { jobId: "j", userId: "u", entryIndex: 0 });

    expect(result.team).toBeNull();
    expect(result.player).toBeNull();
  });

  test("/render-edit classify names are cleansed too", async () => {
    vi.stubGlobal("fetch", (async () =>
      new Response(
        JSON.stringify({
          classified: true,
          players: ["Wilmer R\\ios"],
          team: "Le\\on",
          card_number: "12",
        }),
        { status: 200 },
      )) as unknown as typeof fetch);

    const out = await callRenderEdit(ctx, {
      jobId: "j",
      userId: "u",
      entryIndex: 0,
      edit: { turns: 0, crop: null },
      version: 1,
      classify: true,
    });

    expect(out.classified).toMatchObject({ players: ["Wilmer Rios"], team: "Leon", card_number: "12" });
  });
});
