/**
 * NEO-556 — adversarial pass over the pure No Team rules in
 * `lib/selectorTeams.ts`.
 *
 * The builder's own file (`selectorTeams.test.ts`) pins each rule with a few
 * hand-picked cards. This one attacks the same functions from the other side:
 *
 *  - `noTeamCardVerdict` is checked against an INDEPENDENT oracle over the
 *    whole cartesian product of the fields it reads, so a reordered branch or
 *    a sloppy blank check cannot hide between the examples.
 *  - Product invariant 8 is stated as a property: a `stamp` verdict is only
 *    ever given to a card with no team, no pending name, no listing team, no
 *    outstanding lookup and no gave-up lookup.
 *  - The three-state team default is checked for the one thing the schema
 *    cannot enforce: no helper ever emits both `teamIds` and `noTeamDefault`.
 */

import { describe, expect, test } from "vitest";
import type { Id } from "../_generated/dataModel";
import {
  defaultTeamOnCardIds,
  inheritedTeamDefault,
  noTeamCardVerdict,
  sameTeamDefault,
  stampNoTeam,
  teamDefaultFields,
  teamDefaultFollowVerdict,
  teamDefaultOf,
  teamDefaultPatch,
  type NoTeamKeepReason,
  type NoTeamVerdictCard,
  type TeamDefault,
} from "./selectorTeams";

const A = "team_a" as Id<"teams">;
const B = "team_b" as Id<"teams">;
const STAMP_1 = { setAt: 1_700_000_000_000, setByUserId: "admin_1" };
const STAMP_2 = { setAt: 1_800_000_000_000, setByUserId: "admin_2" };

// ---------------------------------------------------------------------------
// noTeamCardVerdict — exhaustive against an independent oracle
// ---------------------------------------------------------------------------

type Dim<T> = ReadonlyArray<readonly [label: string, value: T]>;

const NONE_CONFIRMED: Dim<number | undefined> = [
  ["unruled", undefined],
  ["ruled", 5],
  ["ruled at epoch 0", 0],
];
const TEAM_IDS: Dim<Array<Id<"teams">> | undefined> = [
  ["ids absent", undefined],
  ["ids empty", []],
  ["ids [A]", [A]],
];
const PENDING: Dim<string[] | undefined> = [
  ["pending absent", undefined],
  ["pending empty", []],
  ["pending [x]", ["Bulls"]],
];
const HINT: Dim<string | undefined> = [
  ["hint absent", undefined],
  ["hint empty", ""],
  ["hint spaces", "   "],
  ["hint tab/newline", "\t\n"],
  ["hint nbsp", " "],
  ["hint real", "Durham Bulls"],
  ["hint padded", "  Durham Bulls  "],
];
const RULED_NOT_A_TEAM: Dim<boolean> = [
  ["not ruled out", false],
  ["ruled not a team", true],
];
const BSC_REF: Dim<boolean> = [
  ["no BSC ref", false],
  ["BSC ref", true],
];
const DONE_AT: Dim<number | undefined> = [
  ["lookup never ran", undefined],
  ["lookup ran at epoch 0", 0],
  ["lookup ran", 123],
];
const OUTCOME: Dim<"answered" | "gaveUp" | "checklist" | undefined> = [
  ["outcome absent", undefined],
  ["answered", "answered"],
  ["gaveUp", "gaveUp"],
  ["checklist", "checklist"],
];

/**
 * The oracle. Written from the doc comment on `NoTeamKeepReason`, not from the
 * function body: the first matching clause wins.
 */
function oracle(
  c: {
    noneConfirmed: number | undefined;
    ids: Array<Id<"teams">> | undefined;
    pending: string[] | undefined;
    hint: string | undefined;
    ruled: boolean;
    bscRef: boolean;
    doneAt: number | undefined;
    outcome: "answered" | "gaveUp" | "checklist" | undefined;
  },
): "stamp" | NoTeamKeepReason {
  if (c.noneConfirmed !== undefined) return "alreadyNoTeam";
  if (c.ids && c.ids.length > 0) return "hasTeam";
  if (c.pending && c.pending.length > 0) return "pendingName";
  const hintHasText = c.hint !== undefined && c.hint.replace(/[\s ﻿]/g, "") !== "";
  if (hintHasText && !c.ruled) return "listingNamesTeam";
  if (c.bscRef && c.doneAt === undefined) return "awaitingLookup";
  if (c.outcome === "gaveUp") return "lookupGaveUp";
  return "stamp";
}

describe("noTeamCardVerdict — exhaustive", () => {
  test("agrees with an independent oracle on every combination (and the product is not vacuous)", () => {
    let combos = 0;
    const seen = new Set<string>();
    for (const [, noneConfirmed] of NONE_CONFIRMED)
      for (const [, ids] of TEAM_IDS)
        for (const [, pending] of PENDING)
          for (const [hintLabel, hint] of HINT)
            for (const [, ruled] of RULED_NOT_A_TEAM)
              for (const [, bscRef] of BSC_REF)
                for (const [, doneAt] of DONE_AT)
                  for (const [, outcome] of OUTCOME) {
                    const card: NoTeamVerdictCard = {
                      ...(noneConfirmed !== undefined ? { teamNoneConfirmedAt: noneConfirmed } : {}),
                      ...(ids ? { teamOnCardIds: ids } : {}),
                      ...(pending ? { pendingTeamNames: pending } : {}),
                      ...(hint !== undefined ? { bscTeamName: hint } : {}),
                      ...(doneAt !== undefined ? { teamCheckDoneAt: doneAt } : {}),
                      ...(outcome ? { teamCheckOutcome: outcome } : {}),
                      ...(bscRef ? { platformData: { bsc: { ref: "b" } } } : { platformData: {} }),
                    };
                    const got = noTeamCardVerdict(card, { ruledNotATeam: ruled });
                    const want = oracle({ noneConfirmed, ids, pending, hint, ruled, bscRef, doneAt, outcome });
                    const gotLabel = got.verdict === "stamp" ? "stamp" : got.reason;
                    expect(gotLabel, `${hintLabel} ruled=${ruled} ref=${bscRef} done=${doneAt} outcome=${outcome} ids=${ids?.length} pending=${pending?.length} none=${noneConfirmed}`).toBe(want);
                    seen.add(gotLabel);
                    combos++;
                  }
    // 3*3*3*7*2*2*3*4 combinations, and every outcome is reached.
    expect(combos).toBe(3 * 3 * 3 * 7 * 2 * 2 * 3 * 4);
    expect([...seen].sort()).toEqual(
      ["alreadyNoTeam", "awaitingLookup", "hasTeam", "listingNamesTeam", "lookupGaveUp", "pendingName", "stamp"].sort(),
    );
  });

  test("invariant 8 as a property: a stamp is only ever given to a card with nothing that names a team", () => {
    for (const [, ids] of TEAM_IDS)
      for (const [, pending] of PENDING)
        for (const [, hint] of HINT)
          for (const [, bscRef] of BSC_REF)
            for (const [, doneAt] of DONE_AT)
              for (const [, outcome] of OUTCOME) {
                const verdict = noTeamCardVerdict({
                  ...(ids ? { teamOnCardIds: ids } : {}),
                  ...(pending ? { pendingTeamNames: pending } : {}),
                  ...(hint !== undefined ? { bscTeamName: hint } : {}),
                  ...(doneAt !== undefined ? { teamCheckDoneAt: doneAt } : {}),
                  ...(outcome ? { teamCheckOutcome: outcome } : {}),
                  platformData: bscRef ? { bsc: { ref: "b" } } : {},
                });
                if (verdict.verdict !== "stamp") continue;
                expect(ids?.length ?? 0).toBe(0);
                expect(pending?.length ?? 0).toBe(0);
                expect((hint ?? "").trim()).toBe("");
                if (bscRef) expect(doneAt).not.toBeUndefined();
                expect(outcome).not.toBe("gaveUp");
              }
  });

  test("ruledNotATeam lifts ONLY the listing hint; it never bypasses a team, a pending name, a lookup still to run, or a gave-up lookup", () => {
    const ruled = { ruledNotATeam: true };
    expect(noTeamCardVerdict({ teamOnCardIds: [A], bscTeamName: "Rookie" }, ruled)).toMatchObject({ reason: "hasTeam" });
    expect(noTeamCardVerdict({ pendingTeamNames: ["x"], bscTeamName: "Rookie" }, ruled)).toMatchObject({ reason: "pendingName" });
    expect(
      noTeamCardVerdict({ bscTeamName: "Rookie", platformData: { bsc: { ref: "b" } } }, ruled),
    ).toMatchObject({ reason: "awaitingLookup" });
    expect(
      noTeamCardVerdict({ bscTeamName: "Rookie", teamCheckOutcome: "gaveUp" }, ruled),
    ).toMatchObject({ reason: "lookupGaveUp" });
    expect(noTeamCardVerdict({ bscTeamName: "Rookie", teamNoneConfirmedAt: 1 }, ruled)).toMatchObject({
      reason: "alreadyNoTeam",
    });
  });

  test("a gave-up lookup with NO BSC ref still keeps the card (the reason is not tied to a ref)", () => {
    expect(noTeamCardVerdict({ teamCheckOutcome: "gaveUp" })).toEqual({ verdict: "keep", reason: "lookupGaveUp" });
  });

  test("an absent outcome with a stamped lookup reads as answered (cards stamped before NEO-345)", () => {
    expect(
      noTeamCardVerdict({ platformData: { bsc: { ref: "b" } }, teamCheckDoneAt: 1 }),
    ).toEqual({ verdict: "stamp" });
  });

  test("`checklist` outcome without a BSC ref and without a done stamp is still a stamp (nothing to wait on)", () => {
    expect(noTeamCardVerdict({ teamCheckOutcome: "checklist" })).toEqual({ verdict: "stamp" });
  });

  test("a zero-width space in the hint is NOT blank: the card is held back, the safe side of rule 8", () => {
    // String.prototype.trim does not strip U+200B. A hint that only LOOKS empty
    // stays a claim; the operator decides. (The hint writers trim and drop
    // blanks, so this is a belt-and-braces check on the reader.)
    expect(noTeamCardVerdict({ bscTeamName: "​" })).toEqual({ verdict: "keep", reason: "listingNamesTeam" });
  });

  test("does not read or write past its input: frozen cards are fine and are left untouched", () => {
    const card = Object.freeze({
      teamOnCardIds: Object.freeze([]) as unknown as Array<Id<"teams">>,
      pendingTeamNames: Object.freeze([]) as unknown as string[],
      platformData: Object.freeze({ bsc: Object.freeze({ ref: "b" }) }),
      teamCheckDoneAt: 1,
    });
    expect(noTeamCardVerdict(card)).toEqual({ verdict: "stamp" });
    expect(card.teamCheckDoneAt).toBe(1);
  });
});

describe("stampNoTeam", () => {
  test("passes through exactly what it is given: no clock, no extra keys, no mutation of a shared object", () => {
    const first = stampNoTeam("u1", 10);
    const second = stampNoTeam("u2", 20);
    expect(first).toEqual({ teamNoneConfirmedAt: 10, teamNoneConfirmedByUserId: "u1" });
    expect(second).toEqual({ teamNoneConfirmedAt: 20, teamNoneConfirmedByUserId: "u2" });
    expect(first).not.toBe(second);
    expect(Object.keys(first).sort()).toEqual(["teamNoneConfirmedAt", "teamNoneConfirmedByUserId"]);
  });
});

// ---------------------------------------------------------------------------
// The three-state default: never both fields
// ---------------------------------------------------------------------------

type StoredRow = { teamIds?: Array<Id<"teams">>; noTeamDefault?: typeof STAMP_1 };

/** Every stored shape a row could be in, including the two corrupt ones. */
const STORED_ROWS: Array<[string, StoredRow | null | undefined]> = [
  ["null", null],
  ["undefined", undefined],
  ["bare", {}],
  ["teamIds empty", { teamIds: [] }],
  ["teamIds [A]", { teamIds: [A] }],
  ["No Team", { noTeamDefault: STAMP_1 }],
  ["empty teamIds + No Team", { teamIds: [], noTeamDefault: STAMP_1 }],
  ["CORRUPT: teamIds [A] + No Team", { teamIds: [A], noTeamDefault: STAMP_1 }],
];

describe("three-state team default — never both", () => {
  test("inheritedTeamDefault / teamDefaultFields never emit both keys, for any stored shape", () => {
    for (const [label, row] of STORED_ROWS) {
      const inherited = inheritedTeamDefault(row);
      expect(
        "teamIds" in inherited && "noTeamDefault" in inherited,
        `inheritedTeamDefault(${label})`,
      ).toBe(false);
      const fields = teamDefaultFields(teamDefaultOf(row));
      expect("teamIds" in fields && "noTeamDefault" in fields, `fields(${label})`).toBe(false);
      expect(inherited).toEqual(fields);
    }
  });

  test("a row that somehow carries both reads as TEAMS: data that names a team wins over the 'no team' answer", () => {
    const corrupt = { teamIds: [A], noTeamDefault: STAMP_1 };
    expect(teamDefaultOf(corrupt)).toEqual({ kind: "teams", teamIds: [A] });
    expect(inheritedTeamDefault(corrupt)).toEqual({ teamIds: [A] });
    // ...and a card born under it is defaulted that team, never stamped.
    expect(defaultTeamOnCardIds({}, corrupt)).toEqual({ ids: [A], defaulted: true });
  });

  test("an empty teamIds array is never copied down: absent stays absent", () => {
    expect(inheritedTeamDefault({ teamIds: [] })).toEqual({});
    expect("teamIds" in inheritedTeamDefault({ teamIds: [] })).toBe(false);
    expect(inheritedTeamDefault({ teamIds: [], noTeamDefault: STAMP_1 })).toEqual({ noTeamDefault: STAMP_1 });
  });

  test("the copy is a copy: mutating a child's fields never reaches the parent", () => {
    const parentTeams = { teamIds: [A, B] };
    const childTeams = inheritedTeamDefault(parentTeams) as { teamIds: Array<Id<"teams">> };
    childTeams.teamIds.push("team_c" as Id<"teams">);
    expect(parentTeams.teamIds).toEqual([A, B]);

    const parentNoTeam = { noTeamDefault: { ...STAMP_1 } };
    const childNoTeam = inheritedTeamDefault(parentNoTeam) as { noTeamDefault: typeof STAMP_1 };
    childNoTeam.noTeamDefault.setByUserId = "someone_else";
    expect(parentNoTeam.noTeamDefault.setByUserId).toBe("admin_1");
    // Same decision, same stamp: a copy-down is not a new decision.
    expect(inheritedTeamDefault({ noTeamDefault: STAMP_1 })).toEqual({ noTeamDefault: STAMP_1 });
  });

  test("a PATCH built from any state, applied to a row in any state, leaves exactly one state (or none)", () => {
    const states: TeamDefault[] = [
      { kind: "unset" },
      { kind: "teams", teamIds: [A] },
      { kind: "teams", teamIds: [A, B] },
      { kind: "noTeam", noTeamDefault: STAMP_1 },
    ];
    for (const [label, start] of STORED_ROWS) {
      for (const next of states) {
        const row: StoredRow = { ...(start ?? {}) };
        // How Convex applies a patch: undefined deletes the field.
        for (const [k, v] of Object.entries(teamDefaultPatch(next))) {
          if (v === undefined) delete (row as Record<string, unknown>)[k];
          else (row as Record<string, unknown>)[k] = v;
        }
        expect(teamDefaultOf(row), `${label} -> ${next.kind}`).toEqual(next);
        expect(Boolean(row.teamIds) && Boolean(row.noTeamDefault), `${label} -> ${next.kind}`).toBe(false);
      }
    }
  });

  test("defaultTeamOnCardIds under a No Team leaf never defaults an id, whatever the card carries", () => {
    const leaf = { noTeamDefault: STAMP_1 };
    expect(defaultTeamOnCardIds({}, leaf)).toEqual({ ids: undefined, defaulted: false });
    expect(defaultTeamOnCardIds({ teamOnCardIds: [] }, leaf)).toEqual({ ids: undefined, defaulted: false });
    expect(defaultTeamOnCardIds({ teamOnCardIds: [B] }, leaf)).toEqual({ ids: [B], defaulted: false });
    expect(defaultTeamOnCardIds({ pendingTeamNames: ["x"] }, leaf)).toEqual({ ids: undefined, defaulted: false });
  });

  test("defaultTeamOnCardIds hands back a copy of the leaf's ids and of the card's own", () => {
    const leaf = { teamIds: [A] };
    const got = defaultTeamOnCardIds({}, leaf);
    got.ids!.push(B);
    expect(leaf.teamIds).toEqual([A]);
    const own = [B];
    const mine = defaultTeamOnCardIds({ teamOnCardIds: own }, leaf);
    mine.ids!.push(A);
    expect(own).toEqual([B]);
  });
});

// ---------------------------------------------------------------------------
// teamDefaultFollowVerdict — exhaustive properties
// ---------------------------------------------------------------------------

describe("teamDefaultFollowVerdict — exhaustive", () => {
  const states: Array<[string, TeamDefault]> = [
    ["unset", { kind: "unset" }],
    ["teams A", { kind: "teams", teamIds: [A] }],
    ["teams B", { kind: "teams", teamIds: [B] }],
    ["teams A,B", { kind: "teams", teamIds: [A, B] }],
    ["teams B,A", { kind: "teams", teamIds: [B, A] }],
    ["No Team (stamp 1)", { kind: "noTeam", noTeamDefault: STAMP_1 }],
    ["No Team (stamp 2)", { kind: "noTeam", noTeamDefault: STAMP_2 }],
  ];

  test("unchanged <=> same as next; follow <=> unset or same as previous; stay otherwise", () => {
    let n = 0;
    for (const [cl, current] of states)
      for (const [pl, previous] of states)
        for (const [nl, next] of states) {
          if (next.kind === "unset") continue; // a clear never cascades
          const verdict = teamDefaultFollowVerdict(current, previous, next);
          const label = `${cl} | prev ${pl} | next ${nl}`;
          if (sameTeamDefault(current, next)) {
            expect(verdict, label).toBe("unchanged");
          } else if (current.kind === "unset" || sameTeamDefault(current, previous)) {
            expect(verdict, label).toBe("follow");
          } else {
            expect(verdict, label).toBe("stay");
          }
          n++;
        }
    expect(n).toBe(7 * 7 * 6);
  });

  test("the stamp is not part of the decision: who set No Team, and when, never makes a row an override", () => {
    const one: TeamDefault = { kind: "noTeam", noTeamDefault: STAMP_1 };
    const two: TeamDefault = { kind: "noTeam", noTeamDefault: STAMP_2 };
    const x: TeamDefault = { kind: "teams", teamIds: [A] };
    expect(sameTeamDefault(one, two)).toBe(true);
    expect(teamDefaultFollowVerdict(two, one, x)).toBe("follow");
    expect(teamDefaultFollowVerdict(x, one, two)).toBe("stay");
  });

  test("teams order is not part of the decision either", () => {
    expect(
      teamDefaultFollowVerdict(
        { kind: "teams", teamIds: [B, A] },
        { kind: "teams", teamIds: [A, B] },
        { kind: "noTeam", noTeamDefault: STAMP_1 },
      ),
    ).toBe("follow");
  });

  test("applying 'follow' as the cascade does never leaves a node with both states", () => {
    for (const [, current] of states)
      for (const [, previous] of states)
        for (const [, next] of states) {
          if (next.kind === "unset") continue;
          if (teamDefaultFollowVerdict(current, previous, next) !== "follow") continue;
          const row: StoredRow = { ...(teamDefaultFields(current) as StoredRow) };
          for (const [k, v] of Object.entries(teamDefaultPatch(next))) {
            if (v === undefined) delete (row as Record<string, unknown>)[k];
            else (row as Record<string, unknown>)[k] = v;
          }
          expect(Boolean(row.teamIds) && Boolean(row.noTeamDefault)).toBe(false);
          expect(teamDefaultOf(row)).toEqual(next);
        }
  });
});
