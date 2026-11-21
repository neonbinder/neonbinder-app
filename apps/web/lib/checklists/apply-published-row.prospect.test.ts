/**
 * NEO-591 — `applyChecklistRow` with a "Prospect (X)" row.
 *
 * X is the card's printed team (Jason, 2026-11-19), so the parser has already
 * put it in the row's `teams` beside `prospect: true`. Nothing here treats it
 * differently from any other team text: the same compare, the same place
 * lookup, the same alias-aware agreement, and the same answer when NB has no
 * team by that name (the text stays as printed, so the Names gate asks).
 */
import { describe, expect, test } from "vitest";
import { MAX_CARD_TEAMS } from "../../convex/features/cardAttention";
import { applyChecklistRow } from "./apply-published-row";

const noResolve = () => null;
const row = (extra: { teams?: string[]; prospect?: boolean; noTeam?: boolean } = {}) => ({
  players: ["Cord Rager"],
  teams: [] as string[],
  ...extra,
});
const card = (teams: string[] = []) => ({ players: ["Cord Rager"], teams });

describe("applyChecklistRow — Prospect (X), X is a team", () => {
  test("a team NB has no row for stays as printed, answered, and marks the prospect", () => {
    const r = applyChecklistRow(card(), row({ prospect: true, teams: ["Dallas Baptist"] }), noResolve);
    expect(r).toEqual({ teams: ["Dallas Baptist"], answered: true, isProspect: true });
  });

  test("a place that one team answers to becomes that team, like any plain team text", () => {
    const place = (text: string) => (text === "Oklahoma" ? "Oklahoma Sooners" : null);
    const r = applyChecklistRow(card(), row({ prospect: true, teams: ["Oklahoma"] }), noResolve, place);
    expect(r).toEqual({ teams: ["Oklahoma Sooners"], answered: true, isProspect: true });
  });

  test("agrees with a card whose marketplace team is the same team by alias: no conflict", () => {
    const ids: Record<string, string> = { "Oakland Athletics": "t1", "Oakland A's": "t1" };
    const r = applyChecklistRow(
      card(["Oakland A's"]),
      row({ prospect: true, teams: ["Oakland Athletics"] }),
      noResolve,
      undefined,
      (name) => ids[name] ?? null,
    );
    expect(r.conflict).toBeUndefined();
    expect(r.answered).toBe(true);
    expect(r.isProspect).toBe(true);
  });

  test("against a different marketplace team is the ordinary conflict, and the prospect rides along", () => {
    const r = applyChecklistRow(card(["Boston Red Sox"]), row({ prospect: true, teams: ["Dallas Baptist"] }), noResolve);
    expect(r.answered).toBe(false);
    expect(r.conflict).toEqual({
      teams: { marketplace: ["Boston Red Sox"], checklist: ["Dallas Baptist"] },
    });
    expect(r.isProspect).toBe(true);
  });

  test("sits beside the row's own other teams, each once", () => {
    const r = applyChecklistRow(
      card(),
      row({ prospect: true, teams: ["Boston Red Sox", "Dallas Baptist", "Boston Red Sox"] }),
      noResolve,
    );
    expect(r.teams).toEqual(["Boston Red Sox", "Dallas Baptist"]);
    expect(r.answered).toBe(true);
  });

  test("a team list past the card's cap says nothing usable: teams null, not answered", () => {
    const many = Array.from({ length: MAX_CARD_TEAMS + 1 }, (_, i) => `Team ${i}`);
    const r = applyChecklistRow(card(), row({ teams: many, prospect: true }), noResolve);
    expect(r.teams).toBeNull();
    expect(r.answered).toBe(false);
    expect(r.isProspect).toBe(true);
  });
});

describe("applyChecklistRow — a bare Prospect", () => {
  test("is a No Team answer that also marks the prospect", () => {
    const r = applyChecklistRow(card(), row({ prospect: true, noTeam: true }), noResolve);
    expect(r).toEqual({ teams: [], answered: true, isProspect: true });
  });

  test("against a card with a team is the ordinary No Team conflict", () => {
    const r = applyChecklistRow(card(["Boston Red Sox"]), row({ prospect: true, noTeam: true }), noResolve);
    expect(r.answered).toBe(false);
    expect(r.conflict).toEqual({ teams: { marketplace: ["Boston Red Sox"], checklist: [] } });
    expect(r.isProspect).toBe(true);
  });

  test("a prospect flag with nothing else makes no team claim", () => {
    const r = applyChecklistRow(card(["Boston Red Sox"]), row({ prospect: true }), noResolve);
    expect(r.answered).toBe(false);
    expect(r.conflict).toBeUndefined();
    expect(r.isProspect).toBe(true);
  });

  test("a row that is not a prospect row carries no prospect flag", () => {
    const r = applyChecklistRow(card(), row({ teams: ["Boston Red Sox"] }), noResolve);
    expect(r).toEqual({ teams: ["Boston Red Sox"], answered: true });
  });
});
