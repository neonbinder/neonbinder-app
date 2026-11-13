/**
 * NEO-528 round 3 — the pure per-card planners behind "Player on every card":
 * what one card does with a default player and default cameos. Every branch.
 */

import { describe, expect, test } from "vitest";
import type { Id } from "../_generated/dataModel";
import { MAX_CARD_PLAYERS } from "../features/cardAttention";
import {
  planCardPlayerDefaults,
  planDefaultCameos,
  planDefaultPlayers,
  type CardPlayerFacts,
} from "./cardPlayerDefaults";

const P = (s: string) => s as Id<"players">;
const link = (id: string) => ({ playerId: P(id), nameOnCard: id.toUpperCase() });

describe("planDefaultPlayers", () => {
  test("no default player: none, whatever the card says", () => {
    expect(planDefaultPlayers({}, { playerId: null })).toEqual({ kind: "none" });
    expect(planDefaultPlayers({ playerIds: [P("x")] }, { playerId: null })).toEqual({ kind: "none" });
  });

  test("a card with no player and no pending name is filled", () => {
    expect(planDefaultPlayers({}, { playerId: P("q") })).toEqual({ kind: "fill", playerId: "q", promote: false });
    expect(planDefaultPlayers({ playerIds: [], playerLinks: [], pendingPlayerNames: [] }, { playerId: P("q") })).toEqual({
      kind: "fill",
      playerId: "q",
      promote: false,
    });
  });

  test("a card where they are a cameo is filled AND promoted", () => {
    expect(planDefaultPlayers({ secondaryPlayerIds: [P("k"), P("q")] }, { playerId: P("q") })).toEqual({
      kind: "fill",
      playerId: "q",
      promote: true,
    });
  });

  test("already the card's player (by playerIds or by playerLinks alone): unchanged", () => {
    expect(planDefaultPlayers({ playerIds: [P("q")], playerLinks: [link("q")] }, { playerId: P("q") })).toEqual({
      kind: "unchanged",
    });
    expect(planDefaultPlayers({ playerLinks: [link("q")] }, { playerId: P("q") })).toEqual({ kind: "unchanged" });
  });

  test("unchanged outranks other: a card naming them and someone else is theirs already", () => {
    expect(planDefaultPlayers({ playerIds: [P("a"), P("q")] }, { playerId: P("q") })).toEqual({ kind: "unchanged" });
  });

  test("a card naming anyone else is skipped (other), even with a pending name too", () => {
    expect(planDefaultPlayers({ playerIds: [P("a")] }, { playerId: P("q") })).toEqual({ kind: "skip", reason: "other" });
    expect(planDefaultPlayers({ playerLinks: [link("a")] }, { playerId: P("q") })).toEqual({
      kind: "skip",
      reason: "other",
    });
    expect(planDefaultPlayers({ playerIds: [P("a")], pendingPlayerNames: ["Q"] }, { playerId: P("q") })).toEqual({
      kind: "skip",
      reason: "other",
    });
  });

  test("a card with no player but a name waiting for review is skipped (pending)", () => {
    expect(planDefaultPlayers({ pendingPlayerNames: ["Pat Mahomes II"] }, { playerId: P("q") })).toEqual({
      kind: "skip",
      reason: "pending",
    });
  });
});

describe("planDefaultCameos", () => {
  test("no defaults and a clean list: nothing changes", () => {
    expect(planDefaultCameos({ secondaryPlayerIds: [P("a")] }, { cameoIds: [] })).toEqual({
      ids: ["a"],
      added: [],
      already: [],
      skippedPrimary: [],
      skippedFull: [],
      changed: false,
    });
    expect(planDefaultCameos({}, { cameoIds: [] }).changed).toBe(false);
  });

  test("adds new defaults after the card's own cameos, in order, once each", () => {
    const plan = planDefaultCameos({ secondaryPlayerIds: [P("a")] }, { cameoIds: [P("b"), P("c"), P("b")] });
    expect(plan.ids).toEqual(["a", "b", "c"]);
    expect(plan.added).toEqual(["b", "c"]);
    expect(plan.changed).toBe(true);
  });

  test("a default the card already lists is `already`, and changes nothing", () => {
    const plan = planDefaultCameos({ secondaryPlayerIds: [P("a"), P("b")] }, { cameoIds: [P("b")] });
    expect(plan).toMatchObject({ ids: ["a", "b"], added: [], already: ["b"], changed: false });
  });

  test("a default who is one of the card's own players (playerIds or playerLinks) is skippedPrimary", () => {
    expect(planDefaultCameos({ playerIds: [P("a")] }, { cameoIds: [P("a"), P("b")] })).toMatchObject({
      ids: ["b"],
      added: ["b"],
      skippedPrimary: ["a"],
    });
    expect(planDefaultCameos({ playerLinks: [link("a")] }, { cameoIds: [P("a")] })).toMatchObject({
      ids: [],
      skippedPrimary: ["a"],
      changed: false,
    });
  });

  test("past MAX_CARD_PLAYERS a default is skippedFull, never added", () => {
    const full = Array.from({ length: MAX_CARD_PLAYERS }, (_, i) => P(`f${i}`));
    const plan = planDefaultCameos({ secondaryPlayerIds: full }, { cameoIds: [P("x"), P("f0")] });
    expect(plan.ids).toEqual(full);
    expect(plan.skippedFull).toEqual(["x"]);
    expect(plan.already).toEqual(["f0"]);
    expect(plan.changed).toBe(false);
    const nearly = full.slice(1);
    const fits = planDefaultCameos({ secondaryPlayerIds: nearly }, { cameoIds: [P("x"), P("y")] });
    expect(fits.added).toEqual(["x"]);
    expect(fits.skippedFull).toEqual(["y"]);
    expect(fits.ids).toHaveLength(MAX_CARD_PLAYERS);
  });

  test("a stored cameo who is also the card's player, or stored twice, is taken out (changed)", () => {
    const plan = planDefaultCameos(
      { playerIds: [P("a")], secondaryPlayerIds: [P("a"), P("b"), P("b")] },
      { cameoIds: [] },
    );
    expect(plan.ids).toEqual(["b"]);
    expect(plan.changed).toBe(true);
  });

  test("taking out a stale own-player id frees room under the cap", () => {
    const full = Array.from({ length: MAX_CARD_PLAYERS }, (_, i) => P(`f${i}`));
    const plan = planDefaultCameos({ playerIds: [P("f0")], secondaryPlayerIds: full }, { cameoIds: [P("x")] });
    expect(plan.added).toEqual(["x"]);
    expect(plan.ids).not.toContain("f0");
  });
});

describe("planCardPlayerDefaults: the player first, then the cameos against the card as it is left", () => {
  const defaults = { playerId: P("q"), cameoIds: [P("q"), P("k")] };

  test("an empty card: q becomes the player and never also a cameo", () => {
    const plan = planCardPlayerDefaults({}, defaults);
    expect(plan.player).toEqual({ kind: "fill", playerId: "q", promote: false });
    expect(plan.playerIds).toEqual(["q"]);
    expect(plan.cameos.ids).toEqual(["k"]);
    expect(plan.cameos.skippedPrimary).toEqual(["q"]);
  });

  test("a card where q was a cameo: promoted, gone from the cameos", () => {
    const card: CardPlayerFacts = { secondaryPlayerIds: [P("q"), P("z")] };
    const plan = planCardPlayerDefaults(card, defaults);
    expect(plan.player).toMatchObject({ kind: "fill", promote: true });
    expect(plan.cameos.ids).toEqual(["z", "k"]);
    expect(plan.cameos.changed).toBe(true);
  });

  test("a card naming someone else keeps its player; the default player is not forced in as a cameo", () => {
    const plan = planCardPlayerDefaults({ playerIds: [P("a")] }, { playerId: P("q"), cameoIds: [P("k")] });
    expect(plan.player).toEqual({ kind: "skip", reason: "other" });
    expect(plan.playerIds).toEqual(["a"]);
    expect(plan.cameos.ids).toEqual(["k"]);
  });

  test("a pending card keeps its pending name and gets only the cameos", () => {
    const plan = planCardPlayerDefaults({ pendingPlayerNames: ["Q?"] }, { playerId: P("q"), cameoIds: [P("k")] });
    expect(plan.player).toEqual({ kind: "skip", reason: "pending" });
    expect(plan.playerIds).toEqual([]);
    expect(plan.cameos.ids).toEqual(["k"]);
  });

  test("no defaults at all: nothing changes", () => {
    const plan = planCardPlayerDefaults({ playerIds: [P("a")] }, { playerId: null, cameoIds: [] });
    expect(plan.player).toEqual({ kind: "none" });
    expect(plan.playerIds).toEqual(["a"]);
    expect(plan.cameos.changed).toBe(false);
  });
});
