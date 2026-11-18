/**
 * NEO-591 — `applyChecklistRow` with a "Prospect (X)" row (wrapper rule 8).
 *
 * The server settles each X to exactly one minor-league or college team or
 * holds it. A settled X is a team name like any other; a held X is NEVER a
 * team string, never beside another team, and is shown to the operator.
 */
import { describe, expect, test, vi } from "vitest";
import { MAX_CARD_TEAMS } from "../../convex/features/cardAttention";
import { applyChecklistRow } from "./apply-published-row";
import type { ProspectResolution } from "./prospect";

const noResolve = () => null;
const answers =
  (table: Record<string, ProspectResolution>) =>
  (text: string): ProspectResolution | null =>
    table[text] ?? null;
const sooners: ProspectResolution = { kind: "team", name: "Oklahoma Sooners" };
const heldX: ProspectResolution = { kind: "held" };

const row = (extra: { teams?: string[]; prospect?: boolean; prospectTeams?: string[]; noTeam?: boolean } = {}) => ({
  players: ["Cord Rager"],
  teams: [] as string[],
  ...extra,
});
const card = (teams: string[] = []) => ({ players: ["Cord Rager"], teams });

describe("applyChecklistRow — a settled Prospect (X)", () => {
  test("answers the card with the team's full name and marks it a prospect", () => {
    const r = applyChecklistRow(card(), row({ prospect: true, prospectTeams: ["Oklahoma"] }), noResolve, answers({ Oklahoma: sooners }));
    expect(r).toEqual({ teams: ["Oklahoma Sooners"], answered: true, isProspect: true });
  });

  test("agrees with a card whose marketplace team is the same team: no conflict, answered", () => {
    const r = applyChecklistRow(
      card(["Oklahoma Sooners"]),
      row({ prospect: true, prospectTeams: ["Oklahoma"] }),
      noResolve,
      answers({ Oklahoma: sooners }),
    );
    expect(r.conflict).toBeUndefined();
    expect(r.answered).toBe(true);
    expect(r.teams).toEqual(["Oklahoma Sooners"]);
    expect(r.isProspect).toBe(true);
  });

  test("against a different marketplace team is a conflict carrying prospectClaim, not answered", () => {
    const r = applyChecklistRow(
      card(["Boston Red Sox"]),
      row({ prospect: true, prospectTeams: ["Oklahoma"] }),
      noResolve,
      answers({ Oklahoma: sooners }),
    );
    expect(r.answered).toBe(false);
    expect(r.conflict).toEqual({
      teams: { marketplace: ["Boston Red Sox"], checklist: ["Oklahoma Sooners"], prospectClaim: true },
    });
    // The prospect claim is about the card and rides with the conflict.
    expect(r.isProspect).toBe(true);
  });

  test("sits beside the row's own resolved teams", () => {
    const r = applyChecklistRow(
      card(),
      row({ teams: ["Boston Red Sox"], prospectTeams: ["Oklahoma"] }),
      noResolve,
      answers({ Oklahoma: sooners }),
    );
    expect(r.teams).toEqual(["Boston Red Sox", "Oklahoma Sooners"]);
    expect(r.answered).toBe(true);
  });

  test("a team counted once when the row also names it", () => {
    const r = applyChecklistRow(
      card(),
      row({ teams: ["Oklahoma Sooners"], prospectTeams: ["Oklahoma"] }),
      noResolve,
      answers({ Oklahoma: sooners }),
    );
    expect(r.teams).toEqual(["Oklahoma Sooners"]);
  });

  test("a team list past the card's cap says nothing usable: teams null, not answered", () => {
    const many = Array.from({ length: MAX_CARD_TEAMS }, (_, i) => `Team ${i}`);
    const r = applyChecklistRow(card(), row({ teams: many, prospectTeams: ["Oklahoma"] }), noResolve, answers({ Oklahoma: sooners }));
    expect(r.teams).toBeNull();
    expect(r.answered).toBe(false);
    expect(r.isProspect).toBe(true);
  });

  test("asks the resolver once per X, with the trimmed text", () => {
    const resolve = vi.fn((_: string): ProspectResolution | null => sooners);
    applyChecklistRow(card(), row({ prospectTeams: ["  Oklahoma  "] }), noResolve, resolve);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith("Oklahoma");
  });
});

describe("applyChecklistRow — a held Prospect (X)", () => {
  test.each([
    ["the server held it", answers({ Oklahoma: heldX })],
    ["the resolver knows nothing of it", answers({})],
    ["there is no resolver", undefined],
  ])("%s: the card is answered with NO team and the X as prospectTeam", (_label, resolver) => {
    const r = applyChecklistRow(card(), row({ prospect: true, prospectTeams: ["Oklahoma"] }), noResolve, resolver);
    expect(r).toEqual({ teams: [], answered: true, isProspect: true, prospectTeam: "Oklahoma", prospectTeams: ["Oklahoma"] });
  });

  test("never writes X as a team string, in teams or in the conflict", () => {
    const empty = applyChecklistRow(card(), row({ prospectTeams: ["Arizona"] }), noResolve, answers({ Arizona: heldX }));
    expect(empty.teams).toEqual([]);
    const withCard = applyChecklistRow(card(["Boston Red Sox"]), row({ prospectTeams: ["Arizona"] }), noResolve, answers({ Arizona: heldX }));
    expect(withCard.conflict?.teams?.checklist).toEqual([]);
    expect(JSON.stringify(withCard.teams)).not.toContain("Arizona");
  });

  test("is not a No Team claim: the answer carries the X and no noTeam", () => {
    const r = applyChecklistRow(card(), row({ prospectTeams: ["Oklahoma"] }), noResolve, answers({ Oklahoma: heldX }));
    expect(r.prospectTeam).toBe("Oklahoma");
    expect("noTeam" in r).toBe(false);
  });

  test("against a card that already has a team is a conflict with an empty checklist side and prospectClaim", () => {
    const r = applyChecklistRow(card(["Boston Red Sox"]), row({ prospectTeams: ["Oklahoma"] }), noResolve, answers({ Oklahoma: heldX }));
    expect(r.answered).toBe(false);
    expect(r.conflict).toEqual({
      teams: { marketplace: ["Boston Red Sox"], checklist: [], prospectClaim: true },
    });
    expect(r.prospectTeam).toBe("Oklahoma");
    expect(r.prospectTeams).toEqual(["Oklahoma"]);
    expect(r.isProspect).toBe(true);
  });

  test("a legacy singular team on the card counts as its team", () => {
    const r = applyChecklistRow({ players: ["Cord Rager"], team: "Boston Red Sox" }, row({ prospectTeams: ["Oklahoma"] }), noResolve, answers({ Oklahoma: heldX }));
    expect(r.conflict?.teams).toEqual({ marketplace: ["Boston Red Sox"], checklist: [], prospectClaim: true });
  });

  test("a held X holds back every other team the row names too", () => {
    const resolveText = vi.fn(() => ["Boston Red Sox"]);
    const r = applyChecklistRow(card(), row({ teams: ["Boston Red Sox"], prospectTeams: ["Oklahoma"] }), resolveText, answers({ Oklahoma: heldX }));
    expect(r.teams).toEqual([]);
    expect(r.prospectTeam).toBe("Oklahoma");
    expect(r.answered).toBe(true);
  });

  test("one X settled and one held: the held one wins, nothing is written, both claims are the operator's", () => {
    const r = applyChecklistRow(
      card(),
      row({ prospectTeams: ["Oklahoma", "Arizona"] }),
      noResolve,
      answers({ Oklahoma: sooners, Arizona: heldX }),
    );
    expect(r.teams).toEqual([]);
    expect(r.prospectTeam).toBe("Arizona");
    // Only the held one is listed; the settled one is not a question.
    expect(r.prospectTeams).toEqual(["Arizona"]);
  });

  test("several held X are joined with ' / ', each once", () => {
    const r = applyChecklistRow(
      card(),
      row({ prospectTeams: ["Oklahoma", "Arizona", "Oklahoma"] }),
      noResolve,
      answers({}),
    );
    expect(r.prospectTeam).toBe("Oklahoma / Arizona");
    // The exact list rides beside the joined text, so nothing splits " / " back apart.
    expect(r.prospectTeams).toEqual(["Oklahoma", "Arizona"]);
  });

  test("an X that itself holds ' / ' stays one entry of the exact list", () => {
    const r = applyChecklistRow(card(), row({ prospectTeams: ["Dallas / Fort Worth"] }), noResolve, answers({}));
    expect(r.prospectTeam).toBe("Dallas / Fort Worth");
    expect(r.prospectTeams).toEqual(["Dallas / Fort Worth"]);
  });

  test("a settled X carries no held list", () => {
    const r = applyChecklistRow(card(), row({ prospectTeams: ["Oklahoma"] }), noResolve, answers({ Oklahoma: sooners }));
    expect(r.prospectTeams).toBeUndefined();
    expect(r.prospectTeam).toBeUndefined();
  });

  test("a card whose marketplace team is the checklist's held X's neighbour still gets the question", () => {
    const r = applyChecklistRow(card(["Oklahoma Sooners"]), row({ prospectTeams: ["Oklahoma"] }), noResolve, answers({ Oklahoma: heldX }));
    // Held means nothing was settled, so even an equal-looking team is asked, never silently agreed.
    expect(r.answered).toBe(false);
    expect(r.conflict?.teams?.prospectClaim).toBe(true);
  });
});

describe("applyChecklistRow — a bare Prospect and a blank X", () => {
  test("a bare Prospect (prospect + noTeam) is a No Team answer that also marks the prospect", () => {
    const r = applyChecklistRow(card(), row({ prospect: true, noTeam: true }), noResolve);
    expect(r).toEqual({ teams: [], answered: true, isProspect: true });
  });

  test("a bare Prospect against a card with a team is the ordinary No Team conflict, with no prospectClaim", () => {
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

  test("blank X are skipped: no prospect, nothing asked", () => {
    const resolve = vi.fn((): ProspectResolution | null => sooners);
    const r = applyChecklistRow(card(), row({ prospectTeams: ["", "   "] }), noResolve, resolve);
    expect(resolve).not.toHaveBeenCalled();
    expect(r.isProspect).toBeUndefined();
    expect(r.prospectTeam).toBeUndefined();
    expect(r.answered).toBe(false);
  });

  test("a row that is not a prospect row has no prospect fields and never asks the resolver", () => {
    const resolve = vi.fn((): ProspectResolution | null => sooners);
    const r = applyChecklistRow(card(), row({ teams: ["Boston Red Sox"] }), noResolve, resolve);
    expect(resolve).not.toHaveBeenCalled();
    expect(r).toEqual({ teams: ["Boston Red Sox"], answered: true });
  });
});
