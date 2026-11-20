/**
 * NEO-490 — `applyChecklistRow`: what one publisher-checklist row does to the
 * card it is paired with (wrapper rules 3 and 8). The fetch's step 3c and the
 * operator's own links share it, so the cases are pinned once, here.
 */
import { describe, expect, test, vi } from "vitest";
import { MAX_CARD_TEAMS } from "../../convex/features/cardAttention";
import { applyChecklistRow, checklistTeamTextNeedsResolving } from "./apply-published-row";

const noResolve = () => null;

describe("applyChecklistRow: teams", () => {
  test("a row naming one team answers the card with it", () => {
    const r = applyChecklistRow({ players: ["A One"], teams: [] }, { players: ["A One"], teams: ["Boston Red Sox"] }, noResolve);
    expect(r).toEqual({ teams: ["Boston Red Sox"], answered: true });
  });

  test("a row naming no team makes no claim: teams [] and not answered", () => {
    const r = applyChecklistRow({ players: ["A One"], teams: ["Boston Red Sox"] }, { players: ["A One"], teams: [] }, noResolve);
    expect(r.teams).toEqual([]);
    expect(r.answered).toBe(false);
    expect(r.conflict).toBeUndefined();
  });

  test("blank team texts count as naming no team", () => {
    const r = applyChecklistRow({}, { players: [], teams: ["  ", ""] }, noResolve);
    expect(r.teams).toEqual([]);
    expect(r.answered).toBe(false);
  });

  test("a refused comma text gives teams null, is not answered and offers no conflict", () => {
    const r = applyChecklistRow(
      { players: ["A One"], teams: ["New York Mets"] },
      { players: ["A One"], teams: ["Phillies, Braves"] },
      noResolve,
    );
    expect(r.teams).toBeNull();
    expect(r.answered).toBe(false);
    expect(r.conflict).toBeUndefined();
  });

  test("a list past MAX_CARD_TEAMS is refused as null", () => {
    const names = Array.from({ length: MAX_CARD_TEAMS + 1 }, (_, i) => `Team${i}`);
    const r = applyChecklistRow({}, { players: [], teams: ["many, teams"] }, () => names);
    expect(r.teams).toBeNull();
    expect(r.answered).toBe(false);
  });

  test("resolveText is asked only about a text with a comma", () => {
    const resolve = vi.fn(() => ["Philadelphia Phillies", "Atlanta Braves"]);
    const r = applyChecklistRow({}, { players: [], teams: ["Boston Red Sox", "Phillies, Braves"] }, resolve);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith("Phillies, Braves");
    expect(r.teams).toEqual(["Boston Red Sox", "Philadelphia Phillies", "Atlanta Braves"]);
  });

  test("resolved teams are deduped", () => {
    const r = applyChecklistRow({}, { players: [], teams: ["Boston Red Sox", "a, b"] }, () => ["Boston Red Sox"]);
    expect(r.teams).toEqual(["Boston Red Sox"]);
  });

  test("a team conflict keeps the marketplace's teams and carries both sides, resolved", () => {
    const r = applyChecklistRow(
      { players: ["A One"], teams: ["New York Mets"] },
      { players: ["A One"], teams: ["Phillies, Braves"] },
      () => ["Philadelphia Phillies", "Atlanta Braves"],
    );
    expect(r.conflict).toEqual({
      teams: { marketplace: ["New York Mets"], checklist: ["Philadelphia Phillies", "Atlanta Braves"] },
    });
    expect(r.answered).toBe(false);
    expect(r.teams).toEqual(["Philadelphia Phillies", "Atlanta Braves"]);
  });

  test("a team text that resolves to the card's own teams is no conflict and answers", () => {
    const r = applyChecklistRow(
      { players: ["A One"], teams: ["New York Mets", "New York Yankees"] },
      { players: ["A One"], teams: ["Yankees, Mets"] },
      () => ["New York Yankees", "New York Mets"],
    );
    expect(r.conflict).toBeUndefined();
    expect(r.answered).toBe(true);
  });

  test("a players-only conflict survives when the team conflict is dropped", () => {
    const r = applyChecklistRow(
      { players: ["A One"], teams: ["New York Mets"] },
      { players: ["B Two"], teams: ["Mets, Mets"] },
      () => ["New York Mets"],
    );
    expect(r.conflict).toEqual({ players: { marketplace: ["A One"], checklist: ["B Two"] } });
    expect(r.answered).toBe(true);
  });
});

describe("applyChecklistRow: players", () => {
  test("the row's players fill a card that has none", () => {
    const r = applyChecklistRow({ players: [], teams: [] }, { players: ["Juan Soto"], teams: [] }, noResolve);
    expect(r.fillPlayers).toEqual(["Juan Soto"]);
  });

  test("a card that has players is never filled, and a disagreement is a conflict", () => {
    const r = applyChecklistRow({ players: ["Pete Alonso"], teams: [] }, { players: ["Kyle Schwarber"], teams: [] }, noResolve);
    expect(r.fillPlayers).toBeUndefined();
    expect(r.conflict?.players).toEqual({ marketplace: ["Pete Alonso"], checklist: ["Kyle Schwarber"] });
  });

  test("a row with no players fills nothing", () => {
    const r = applyChecklistRow({ players: [], teams: [] }, { players: [], teams: [] }, noResolve);
    expect(r.fillPlayers).toBeUndefined();
  });
});

describe("checklistTeamTextNeedsResolving", () => {
  test("only a comma text needs resolving", () => {
    expect(checklistTeamTextNeedsResolving("A, B")).toBe(true);
    expect(checklistTeamTextNeedsResolving("Boston Red Sox")).toBe(false);
  });
});

describe("applyChecklistRow: NEO-489 a No Team row", () => {
  const noTeam = (players: string[] = ["A One"]) => ({ players, teams: [] as string[], noTeam: true as const });

  test("answers a teamless card with no team: teams [] and answered", () => {
    const r = applyChecklistRow({ players: ["A One"], teams: [] }, noTeam(), noResolve);
    expect(r).toEqual({ teams: [], answered: true });
  });

  test("against a card with a team it is a conflict with an empty checklist side, never answered", () => {
    const r = applyChecklistRow({ players: ["A One"], teams: ["Boston Red Sox"] }, noTeam(), noResolve);
    expect(r.answered).toBe(false);
    expect(r.conflict).toEqual({ teams: { marketplace: ["Boston Red Sox"], checklist: [] } });
  });

  test("the legacy singular team counts as the card's team", () => {
    const r = applyChecklistRow({ players: ["A One"], team: "Boston Red Sox" }, noTeam(), noResolve);
    expect(r.answered).toBe(false);
    expect(r.conflict?.teams).toEqual({ marketplace: ["Boston Red Sox"], checklist: [] });
  });

  test("still fills the players of a card that has none", () => {
    const r = applyChecklistRow({ players: [], teams: [] }, noTeam(["A One"]), noResolve);
    expect(r).toEqual({ fillPlayers: ["A One"], teams: [], answered: true });
  });

  test("never asks resolveText", () => {
    const resolve = vi.fn(() => ["X"]);
    applyChecklistRow({}, noTeam(), resolve);
    expect(resolve).not.toHaveBeenCalled();
  });
});

// NEO-591 — two team names that are aliases of one NB team are not a disagreement.
describe("applyChecklistRow: team names compared as NB teams, not strings", () => {
  // The product's resolver, as a table: aliases of one team share an id.
  const ids: Record<string, string> = {
    "Oakland Athletics": "team-athletics",
    "Oakland A's": "team-athletics",
    Athletics: "team-athletics",
    "Boston Red Sox": "team-redsox",
  };
  const resolveTeamId = (name: string) => ids[name] ?? null;
  const card = (...teams: string[]) => ({ players: ["Mark Mulder"], teams });
  const row = (...teams: string[]) => ({ players: ["Mark Mulder"], teams });

  test("Oakland Athletics against Oakland A's, both aliases of one team: no disagreement, the card takes the row's team", () => {
    const r = applyChecklistRow(card("Oakland Athletics"), row("Oakland A's"), noResolve, undefined, resolveTeamId);
    expect(r.conflict).toBeUndefined();
    expect(r.answered).toBe(true);
    expect(r.teams).toEqual(["Oakland A's"]);
  });

  test("without the resolver the same strings still disagree (today's behaviour)", () => {
    const r = applyChecklistRow(card("Oakland Athletics"), row("Oakland A's"), noResolve);
    expect(r.conflict?.teams).toEqual({
      marketplace: ["Oakland Athletics"],
      checklist: ["Oakland A's"],
    });
    expect(r.answered).toBe(false);
  });

  test("a real different team is still asked", () => {
    const r = applyChecklistRow(card("Oakland Athletics"), row("Boston Red Sox"), noResolve, undefined, resolveTeamId);
    expect(r.conflict?.teams).toEqual({
      marketplace: ["Oakland Athletics"],
      checklist: ["Boston Red Sox"],
    });
    expect(r.answered).toBe(false);
  });

  test("a name that does not resolve is still asked, on either side", () => {
    const checklistSide = applyChecklistRow(card("Oakland Athletics"), row("Oakland Elephants"), noResolve, undefined, resolveTeamId);
    expect(checklistSide.conflict?.teams).toBeDefined();
    const marketplaceSide = applyChecklistRow(card("Oakland Elephants"), row("Oakland A's"), noResolve, undefined, resolveTeamId);
    expect(marketplaceSide.conflict?.teams).toBeDefined();
  });

  test("a multi-team card agrees when the resolved sets agree, and not when one team differs", () => {
    const agree = applyChecklistRow(
      card("Oakland Athletics", "Boston Red Sox"),
      row("Boston Red Sox", "Oakland A's"),
      noResolve,
      undefined,
      resolveTeamId,
    );
    expect(agree.conflict).toBeUndefined();
    const differ = applyChecklistRow(
      card("Oakland Athletics", "Boston Red Sox"),
      row("Oakland A's"),
      noResolve,
      undefined,
      resolveTeamId,
    );
    expect(differ.conflict?.teams).toBeDefined();
  });

  test("the card's legacy single team is compared the same way", () => {
    const r = applyChecklistRow(
      { players: ["Mark Mulder"], team: "Oakland Athletics" },
      row("Oakland A's"),
      noResolve,
      undefined,
      resolveTeamId,
    );
    expect(r.conflict).toBeUndefined();
  });
});

// NEO-591 (Jason, 2026-11-20) — a place left as printed agrees with a
// marketplace team that is one of the place's teams. The resolvers are tables:
// the product's own (aliases, any era), the place resolver that settles only a
// LONE team, and the set-valued one that answers every in-league team.
describe("applyChecklistRow: a place left as printed agrees with the marketplace's team", () => {
  const ids: Record<string, string> = {
    "Seattle Mariners": "team-mariners",
    Mariners: "team-mariners",
    "M's": "team-mariners",
    "Seattle Pilots": "team-pilots",
    "Boston Red Sox": "team-redsox",
    "Chicago Cubs": "team-cubs",
    "Tampa Bay Rays": "team-rays",
  };
  const resolveTeamId = (name: string) => ids[name] ?? null;
  // Seattle has two in-league teams (so `resolvePlace` leaves it); Chicago has
  // two (Cubs, White Sox); Tampa has one (settled by `resolvePlace`).
  const places: Record<string, string[]> = {
    Seattle: ["team-pilots", "team-mariners"],
    Chicago: ["team-cubs", "team-whitesox"],
  };
  const resolvePlaceTeamIds = (text: string) => places[text] ?? null;
  const resolvePlace = (text: string) => (text === "Tampa" ? "Tampa Bay Rays" : null);
  const card = (...teams: string[]) => ({ players: ["Ken Griffey Jr."], teams });
  const row = (...teams: string[]) => ({ players: ["Ken Griffey Jr."], teams });
  const apply = (c: ReturnType<typeof card>, r: ReturnType<typeof row>) =>
    applyChecklistRow(c, r, noResolve, resolvePlace, resolveTeamId, resolvePlaceTeamIds);

  test("Seattle against BSC's Seattle Mariners: no conflict, and the card keeps the marketplace's team", () => {
    const r = apply(card("Seattle Mariners"), row("Seattle"));
    expect(r.conflict).toBeUndefined();
    expect(r.answered).toBe(false);
  });

  test("the marketplace may name the team by an alias of it", () => {
    const r = apply(card("M's"), row("Seattle"));
    expect(r.conflict).toBeUndefined();
    expect(r.answered).toBe(false);
  });

  test("the other team of the place agrees just the same (Pilots)", () => {
    const r = apply(card("Seattle Pilots"), row("Seattle"));
    expect(r.conflict).toBeUndefined();
    expect(r.answered).toBe(false);
  });

  test("a marketplace team that is not one of the place's teams is still a disagreement, with the place as printed", () => {
    const r = apply(card("Seattle Mariners"), row("Chicago"));
    expect(r.conflict?.teams).toEqual({
      marketplace: ["Seattle Mariners"],
      checklist: ["Chicago"],
    });
    expect(r.answered).toBe(false);
  });

  test("a marketplace name no team answers to is still a disagreement", () => {
    expect(apply(card("Seattle Elephants"), row("Seattle")).conflict?.teams).toBeDefined();
  });

  test("without the set-valued resolver, or with no answer for the text, the place is a disagreement as before", () => {
    const without = applyChecklistRow(
      card("Seattle Mariners"),
      row("Seattle"),
      noResolve,
      resolvePlace,
      resolveTeamId,
    );
    expect(without.conflict?.teams).toBeDefined();
    const unanswered = applyChecklistRow(
      card("Seattle Mariners"),
      row("Seattle"),
      noResolve,
      resolvePlace,
      resolveTeamId,
      () => null,
    );
    expect(unanswered.conflict?.teams).toBeDefined();
  });

  test("a lone in-league place is unchanged: the settled name is the checklist's team, agreeing or conflicting", () => {
    const agree = apply(card("Tampa Bay Rays"), row("Tampa"));
    expect(agree.conflict).toBeUndefined();
    expect(agree.answered).toBe(true);
    expect(agree.teams).toEqual(["Tampa Bay Rays"]);
    const differ = apply(card("Seattle Mariners"), row("Tampa"));
    expect(differ.conflict?.teams).toEqual({
      marketplace: ["Seattle Mariners"],
      checklist: ["Tampa Bay Rays"],
    });
  });

  test("no marketplace team: nothing to agree with, the row answers with the place as printed (the card rule decides later)", () => {
    const r = apply({ players: ["Ken Griffey Jr."], teams: [] }, row("Seattle"));
    expect(r.conflict).toBeUndefined();
    expect(r.answered).toBe(true);
    expect(r.teams).toEqual(["Seattle"]);
  });

  test("a place beside a named team: each text pairs with one marketplace team", () => {
    const agree = apply(card("Boston Red Sox", "Seattle Mariners"), row("Seattle", "Boston Red Sox"));
    expect(agree.conflict).toBeUndefined();
    expect(agree.answered).toBe(false);
    // One place twice is one text: the Red Sox are left unaccounted for.
    const unpaired = apply(card("Boston Red Sox", "Seattle Mariners"), row("Seattle", "Seattle"));
    expect(unpaired.conflict?.teams).toBeDefined();
    // The checklist names a team the marketplace does not.
    const extra = apply(card("Seattle Mariners"), row("Seattle", "Boston Red Sox"));
    expect(extra.conflict?.teams).toBeDefined();
  });

  test("a marketplace team the checklist does not account for stays a disagreement", () => {
    const r = apply(card("Seattle Mariners", "Boston Red Sox"), row("Seattle"));
    expect(r.conflict?.teams).toBeDefined();
  });

  test("a players conflict is kept when the place agrees", () => {
    const r = apply(
      { players: ["Ken Griffey Sr."], teams: ["Seattle Mariners"] },
      { players: ["Ken Griffey Jr."], teams: ["Seattle"] },
    );
    expect(r.conflict?.teams).toBeUndefined();
    expect(r.conflict?.players).toBeDefined();
  });

  test("a No Team row against a card with a team is still a disagreement", () => {
    const r = applyChecklistRow(
      card("Seattle Mariners"),
      { players: ["Ken Griffey Jr."], teams: [], noTeam: true },
      noResolve,
      resolvePlace,
      resolveTeamId,
      resolvePlaceTeamIds,
    );
    expect(r.conflict?.teams).toEqual({ marketplace: ["Seattle Mariners"], checklist: [] });
  });
});
