/**
 * NEO-277 — the pure set-level team rules, branch by branch. The database
 * tests in selectorOptions.setSelectorOptionTeams.test.ts prove the WIRING;
 * this file pins the DECISIONS so a rewording of one writer cannot quietly
 * change what "follows" means for the other two.
 */

import { describe, expect, test } from "vitest";
import type { Id } from "../_generated/dataModel";
import {
  cardTeamFollowOutcome,
  cardTeamFollowVerdict,
  defaultTeamOnCardIds,
  inheritedTeamDefault,
  noTeamCardVerdict,
  sameTeamDefault,
  sameTeamSet,
  stampNoTeam,
  teamDefaultFields,
  teamDefaultFollowVerdict,
  teamDefaultOf,
  teamDefaultPatch,
  teamFollowVerdict,
  type TeamDefault,
} from "./selectorTeams";

const A = "team_a" as Id<"teams">;
const B = "team_b" as Id<"teams">;
const C = "team_c" as Id<"teams">;

const NO_TEAM = { setAt: 1_700_000_000_000, setByUserId: "admin_1" };
const UNSET: TeamDefault = { kind: "unset" };
const teams = (...ids: Array<Id<"teams">>): TeamDefault => ({ kind: "teams", teamIds: ids });
const noTeam: TeamDefault = { kind: "noTeam", noTeamDefault: NO_TEAM };

describe("inheritedTeamDefault (NEO-556, replaces inheritedTeamIds)", () => {
  test("copies a non-empty list; yields {} for empty, absent or no parent", () => {
    const parent = { teamIds: [A, B] };
    const fields = inheritedTeamDefault(parent);
    expect(fields).toEqual({ teamIds: [A, B] });
    expect((fields as { teamIds: unknown }).teamIds).not.toBe(parent.teamIds);
    expect(inheritedTeamDefault({ teamIds: [] })).toEqual({});
    expect(inheritedTeamDefault({})).toEqual({});
    expect(inheritedTeamDefault(null)).toEqual({});
    expect(inheritedTeamDefault(undefined)).toEqual({});
  });

  test("carries No Team with its ORIGINAL stamp, as a copy", () => {
    const parent = { noTeamDefault: NO_TEAM };
    const fields = inheritedTeamDefault(parent);
    expect(fields).toEqual({ noTeamDefault: NO_TEAM });
    expect((fields as { noTeamDefault: unknown }).noTeamDefault).not.toBe(NO_TEAM);
    expect("teamIds" in fields).toBe(false);
  });

  test("never both keys: a row carrying both reads as its teams", () => {
    const fields = inheritedTeamDefault({ teamIds: [A], noTeamDefault: NO_TEAM });
    expect(fields).toEqual({ teamIds: [A] });
    expect(teamDefaultOf({ teamIds: [A], noTeamDefault: NO_TEAM }).kind).toBe("teams");
  });
});

describe("teamDefaultOf / teamDefaultFields / teamDefaultPatch", () => {
  test("round-trips every state", () => {
    for (const d of [UNSET, teams(A, B), noTeam]) {
      expect(teamDefaultOf(teamDefaultFields(d))).toEqual(d);
    }
    expect(teamDefaultOf({ teamIds: [] })).toEqual(UNSET);
  });

  test("a patch always names both fields, the unused one undefined", () => {
    expect(teamDefaultPatch(noTeam)).toEqual({ teamIds: undefined, noTeamDefault: NO_TEAM });
    expect(teamDefaultPatch(teams(A))).toEqual({ teamIds: [A], noTeamDefault: undefined });
    const unset = teamDefaultPatch(UNSET);
    expect(Object.keys(unset).sort()).toEqual(["noTeamDefault", "teamIds"]);
    expect(unset).toEqual({ teamIds: undefined, noTeamDefault: undefined });
  });
});

describe("sameTeamDefault", () => {
  test("kind first; teams compare as sets; No Team ignores who and when", () => {
    expect(sameTeamDefault(teams(A, B), teams(B, A))).toBe(true);
    expect(sameTeamDefault(teams(A), teams(A, B))).toBe(false);
    expect(sameTeamDefault(noTeam, { kind: "noTeam", noTeamDefault: { setAt: 1, setByUserId: "x" } })).toBe(true);
    expect(sameTeamDefault(noTeam, UNSET)).toBe(false);
    expect(sameTeamDefault(UNSET, UNSET)).toBe(true);
  });
});

describe("teamDefaultFollowVerdict", () => {
  test("teams → No Team: unset and inheriting rows follow, an override stays", () => {
    expect(teamDefaultFollowVerdict(UNSET, teams(A), noTeam)).toBe("follow");
    expect(teamDefaultFollowVerdict(teams(A), teams(A), noTeam)).toBe("follow");
    expect(teamDefaultFollowVerdict(teams(B), teams(A), noTeam)).toBe("stay");
    expect(teamDefaultFollowVerdict(noTeam, teams(A), noTeam)).toBe("unchanged");
  });

  test("No Team → teams: rows that inherited No Team follow; a team override stays", () => {
    expect(teamDefaultFollowVerdict(noTeam, noTeam, teams(A))).toBe("follow");
    expect(teamDefaultFollowVerdict(UNSET, noTeam, teams(A))).toBe("follow");
    expect(teamDefaultFollowVerdict(teams(B), noTeam, teams(A))).toBe("stay");
    expect(teamDefaultFollowVerdict(teams(A), noTeam, teams(A))).toBe("unchanged");
  });

  test("unset → No Team: a row an operator set No Team on its own is unchanged; a team stays", () => {
    expect(teamDefaultFollowVerdict(noTeam, UNSET, noTeam)).toBe("unchanged");
    expect(teamDefaultFollowVerdict(teams(A), UNSET, noTeam)).toBe("stay");
  });

  test("agrees with teamFollowVerdict whenever every value is teams or unset", () => {
    const lists: Array<Array<Id<"teams">>> = [[], [A], [B], [A, B]];
    for (const cur of lists) {
      for (const prev of lists) {
        for (const nxt of lists.filter((l) => l.length > 0)) {
          const asDefault = (l: Array<Id<"teams">>): TeamDefault =>
            l.length > 0 ? teams(...l) : UNSET;
          expect(teamDefaultFollowVerdict(asDefault(cur), asDefault(prev), teams(...nxt))).toBe(
            teamFollowVerdict(cur, prev, nxt),
          );
        }
      }
    }
  });
});

describe("stampNoTeam", () => {
  test("is the two server-sourced fields, nothing else", () => {
    expect(stampNoTeam("admin_9", 42)).toEqual({
      teamNoneConfirmedAt: 42,
      teamNoneConfirmedByUserId: "admin_9",
    });
  });
});

describe("noTeamCardVerdict", () => {
  const BSC = { bsc: { ref: "bsc-1" } };
  test("a bare card (no ref, no team) is stamped; so is an SL-only one", () => {
    expect(noTeamCardVerdict({})).toEqual({ verdict: "stamp" });
    expect(noTeamCardVerdict({ platformData: {} })).toEqual({ verdict: "stamp" });
  });

  test("each keep reason, alone", () => {
    expect(noTeamCardVerdict({ teamNoneConfirmedAt: 1 })).toEqual({ verdict: "keep", reason: "alreadyNoTeam" });
    expect(noTeamCardVerdict({ teamOnCardIds: [A] })).toEqual({ verdict: "keep", reason: "hasTeam" });
    expect(noTeamCardVerdict({ pendingTeamNames: ["Bulls"] })).toEqual({ verdict: "keep", reason: "pendingName" });
    expect(noTeamCardVerdict({ bscTeamName: "Durham Bulls", teamCheckDoneAt: 1 })).toEqual({
      verdict: "keep",
      reason: "listingNamesTeam",
    });
    expect(noTeamCardVerdict({ platformData: BSC })).toEqual({ verdict: "keep", reason: "awaitingLookup" });
    expect(
      noTeamCardVerdict({ platformData: BSC, teamCheckDoneAt: 1, teamCheckOutcome: "gaveUp" }),
    ).toEqual({ verdict: "keep", reason: "lookupGaveUp" });
  });

  test("a BSC card whose lookup answered with no team is stamped", () => {
    for (const outcome of ["answered", "checklist", undefined] as const) {
      expect(
        noTeamCardVerdict({ platformData: BSC, teamCheckDoneAt: 1, teamCheckOutcome: outcome }),
      ).toEqual({ verdict: "stamp" });
    }
  });

  test("order: already, team, pending name, listing, awaiting, gave up", () => {
    expect(noTeamCardVerdict({ teamNoneConfirmedAt: 1, teamOnCardIds: [A] }).verdict).toBe("keep");
    expect(noTeamCardVerdict({ teamNoneConfirmedAt: 1, teamOnCardIds: [A] })).toMatchObject({ reason: "alreadyNoTeam" });
    expect(noTeamCardVerdict({ teamOnCardIds: [A], pendingTeamNames: ["x"] })).toMatchObject({ reason: "hasTeam" });
    expect(noTeamCardVerdict({ pendingTeamNames: ["x"], bscTeamName: "y" })).toMatchObject({ reason: "pendingName" });
    expect(noTeamCardVerdict({ bscTeamName: "y", platformData: BSC })).toMatchObject({ reason: "listingNamesTeam" });
  });

  test("an empty team list or a blank hint is no claim; a ruled-out hint is no claim", () => {
    expect(noTeamCardVerdict({ teamOnCardIds: [], pendingTeamNames: [], bscTeamName: "  " })).toEqual({
      verdict: "stamp",
    });
    expect(noTeamCardVerdict({ bscTeamName: "Rookie", teamCheckDoneAt: 1 }, { ruledNotATeam: true })).toEqual({
      verdict: "stamp",
    });
  });
});

describe("sameTeamSet", () => {
  test("is order-insensitive and treats absent as empty", () => {
    expect(sameTeamSet([A, B], [B, A])).toBe(true);
    expect(sameTeamSet([A], [A, B])).toBe(false);
    expect(sameTeamSet(undefined, [])).toBe(true);
    expect(sameTeamSet(undefined, [A])).toBe(false);
  });
});

describe("teamFollowVerdict", () => {
  test("unchanged / follow / stay", () => {
    expect(teamFollowVerdict([C], [A], [C])).toBe("unchanged");
    expect(teamFollowVerdict(undefined, [A], [C])).toBe("follow");
    expect(teamFollowVerdict([], [A], [C])).toBe("follow");
    expect(teamFollowVerdict([A], [A], [C])).toBe("follow");
    expect(teamFollowVerdict([A, B], [B, A], [C])).toBe("follow");
    expect(teamFollowVerdict([B], [A], [C])).toBe("stay");
    // Previous empty: only an empty row follows.
    expect(teamFollowVerdict([B], [], [C])).toBe("stay");
    expect(teamFollowVerdict(undefined, [], [C])).toBe("follow");
  });
});

describe("cardTeamFollowVerdict", () => {
  test("a confirmed-teamless card stays even though it is empty", () => {
    expect(
      cardTeamFollowVerdict({ teamNoneConfirmedAt: 1 }, [A], [C]),
    ).toBe("stay");
  });
  test("a card carrying an unresolved team name stays", () => {
    expect(
      cardTeamFollowVerdict({ pendingTeamNames: ["Bulls"] }, [A], [C]),
    ).toBe("stay");
  });
  test("otherwise the node rule applies", () => {
    expect(cardTeamFollowVerdict({}, [A], [C])).toBe("follow");
    expect(cardTeamFollowVerdict({ teamOnCardIds: [A] }, [A], [C])).toBe("follow");
    expect(cardTeamFollowVerdict({ teamOnCardIds: [B] }, [A], [C])).toBe("stay");
    expect(cardTeamFollowVerdict({ teamOnCardIds: [C] }, [A], [C])).toBe("unchanged");
  });
});

describe("cardTeamFollowOutcome", () => {
  test("names the reason for every stay, in priority order", () => {
    expect(cardTeamFollowOutcome({ teamNoneConfirmedAt: 1 }, [A], [C])).toEqual({
      verdict: "stay",
      reason: "teamless",
    });
    // Teamless outranks a pending name; a pending name outranks an override.
    expect(
      cardTeamFollowOutcome(
        { teamNoneConfirmedAt: 1, pendingTeamNames: ["Bulls"], teamOnCardIds: [B] },
        [A],
        [C],
      ),
    ).toEqual({ verdict: "stay", reason: "teamless" });
    expect(
      cardTeamFollowOutcome({ pendingTeamNames: ["Bulls"], teamOnCardIds: [B] }, [A], [C]),
    ).toEqual({ verdict: "stay", reason: "pendingName" });
    expect(cardTeamFollowOutcome({ teamOnCardIds: [B] }, [A], [C])).toEqual({
      verdict: "stay",
      reason: "overridden",
    });
  });
  test("follow and unchanged carry no reason", () => {
    expect(cardTeamFollowOutcome({}, [A], [C])).toEqual({ verdict: "follow" });
    expect(cardTeamFollowOutcome({ teamOnCardIds: [A] }, [A], [C])).toEqual({ verdict: "follow" });
    expect(cardTeamFollowOutcome({ teamOnCardIds: [C] }, [A], [C])).toEqual({ verdict: "unchanged" });
  });
  test("the verdict function is the outcome's verdict, never a second rule", () => {
    const cards = [
      {},
      { teamOnCardIds: [A] },
      { teamOnCardIds: [B] },
      { teamOnCardIds: [C] },
      { teamNoneConfirmedAt: 1 },
      { pendingTeamNames: ["Bulls"] },
    ];
    for (const card of cards) {
      expect(cardTeamFollowVerdict(card, [A], [C])).toBe(
        cardTeamFollowOutcome(card, [A], [C]).verdict,
      );
    }
  });
});

describe("defaultTeamOnCardIds", () => {
  test("the card's own ids win, and are copied", () => {
    const own = [B];
    const out = defaultTeamOnCardIds({ teamOnCardIds: own }, { teamIds: [A] });
    expect(out).toEqual({ ids: [B], defaulted: false });
    expect(out.ids).not.toBe(own);
  });
  test("a pending name is the card's own answer: no default", () => {
    expect(
      defaultTeamOnCardIds({ pendingTeamNames: ["Bulls"] }, { teamIds: [A] }),
    ).toEqual({ ids: undefined, defaulted: false });
  });
  test("an empty card under a leaf with a team is born with it", () => {
    expect(defaultTeamOnCardIds({}, { teamIds: [A] })).toEqual({
      ids: [A],
      defaulted: true,
    });
    expect(defaultTeamOnCardIds({ teamOnCardIds: [] }, { teamIds: [A] })).toEqual({
      ids: [A],
      defaulted: true,
    });
  });
  test("no leaf team: nothing", () => {
    expect(defaultTeamOnCardIds({}, { teamIds: [] })).toEqual({
      ids: undefined,
      defaulted: false,
    });
    expect(defaultTeamOnCardIds({}, null)).toEqual({ ids: undefined, defaulted: false });
  });
  test("NEO-556: a No Team leaf defaults no ids (the stamp is the verdict's call)", () => {
    expect(defaultTeamOnCardIds({}, { noTeamDefault: NO_TEAM })).toEqual({
      ids: undefined,
      defaulted: false,
    });
  });
});
