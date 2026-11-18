/**
 * NEO-591 — the fetch's glue around a "Prospect (X)" row:
 * `resolveChecklistProspectTexts` (asks the server once per distinct X, in
 * bounded batches, and holds what it cannot ask), and the two card shapes
 * built from a checklist row (`checklistOnlyCard`, `checklistPairedRow`).
 */
import { describe, expect, test, vi } from "vitest";
import type { Id } from "./_generated/dataModel";
import {
  MAX_PROSPECT_TEAM_TEXTS,
  checklistOnlyCard,
  checklistPairedRow,
  resolveChecklistProspectTexts,
} from "./selectorOptions";
import { MAX_PROSPECT_TEAMS_PER_QUERY } from "./checklistCandidates";
import type { ProspectResolution } from "../lib/checklists/prospect";
import { applyChecklistRow } from "../lib/checklists/apply-published-row";

const setId = "set1" as Id<"selectorOptions">;

/** A ctx whose query answers each text through `answer`, recording every batch asked. */
function fakeCtx(answer: (text: string) => ProspectResolution = (t) => ({ kind: "team", name: `${t} Team` })) {
  const batches: string[][] = [];
  const runQuery = vi.fn(async (_ref: unknown, args: { texts: string[] }) => {
    batches.push(args.texts);
    return args.texts.map(answer);
  });
  return { ctx: { runQuery } as never, batches, runQuery };
}

describe("resolveChecklistProspectTexts", () => {
  test("answers each X as the server did", async () => {
    const { ctx } = fakeCtx((t) => (t === "Oklahoma" ? { kind: "team", name: "Oklahoma Sooners" } : { kind: "held" }));
    const resolve = await resolveChecklistProspectTexts(ctx, setId, ["Oklahoma", "Arizona"]);
    expect(resolve("Oklahoma")).toEqual({ kind: "team", name: "Oklahoma Sooners" });
    expect(resolve("Arizona")).toEqual({ kind: "held" });
  });

  test("asks once per distinct X by the folded key, in first-seen order, trimmed", async () => {
    const { ctx, batches } = fakeCtx();
    const resolve = await resolveChecklistProspectTexts(ctx, setId, ["  Oklahoma ", "oklahoma", "OKLAHOMA", "Texas"]);
    expect(batches).toEqual([["Oklahoma", "Texas"]]);
    // Any spelling that folds alike is answered.
    expect(resolve("OKLAHOMA")).toEqual({ kind: "team", name: "Oklahoma Team" });
    expect(resolve(" oklahoma ")).toEqual({ kind: "team", name: "Oklahoma Team" });
  });

  test("skips blank texts and asks nothing when there is no X", async () => {
    const { ctx, runQuery } = fakeCtx();
    const resolve = await resolveChecklistProspectTexts(ctx, setId, ["", "   "]);
    expect(runQuery).not.toHaveBeenCalled();
    expect(resolve("")).toBeNull();
  });

  test("answers null (read as held) for an X it never asked", async () => {
    const { ctx } = fakeCtx();
    const resolve = await resolveChecklistProspectTexts(ctx, setId, ["Oklahoma"]);
    expect(resolve("Nowhere")).toBeNull();
  });

  test("asks in batches of the query's own cap", async () => {
    const { ctx, batches } = fakeCtx();
    const texts = Array.from({ length: MAX_PROSPECT_TEAMS_PER_QUERY * 2 + 1 }, (_, i) => `School ${i}`);
    const resolve = await resolveChecklistProspectTexts(ctx, setId, texts);
    expect(batches.map((b) => b.length)).toEqual([MAX_PROSPECT_TEAMS_PER_QUERY, MAX_PROSPECT_TEAMS_PER_QUERY, 1]);
    expect(resolve("School 40")).toEqual({ kind: "team", name: "School 40 Team" });
  });

  test("asks at most MAX_PROSPECT_TEAM_TEXTS distinct texts; a text past it answers null", async () => {
    const { ctx, batches } = fakeCtx();
    const texts = Array.from({ length: MAX_PROSPECT_TEAM_TEXTS + 3 }, (_, i) => `School ${i}`);
    const resolve = await resolveChecklistProspectTexts(ctx, setId, texts);
    expect(batches.flat()).toHaveLength(MAX_PROSPECT_TEAM_TEXTS);
    expect(resolve(`School ${MAX_PROSPECT_TEAM_TEXTS - 1}`)).not.toBeNull();
    expect(resolve(`School ${MAX_PROSPECT_TEAM_TEXTS}`)).toBeNull();
  });

  test("a batch the server could not read leaves its X held (null), without throwing, and the others still answer", async () => {
    let call = 0;
    const runQuery = vi.fn(async (_ref: unknown, args: { texts: string[] }) => {
      call++;
      if (call === 1) throw new Error("db unavailable");
      return args.texts.map((t): ProspectResolution => ({ kind: "team", name: `${t} Team` }));
    });
    const texts = Array.from({ length: MAX_PROSPECT_TEAMS_PER_QUERY + 1 }, (_, i) => `School ${i}`);
    const resolve = await resolveChecklistProspectTexts({ runQuery } as never, setId, texts);
    expect(resolve("School 0")).toBeNull();
    expect(resolve(`School ${MAX_PROSPECT_TEAMS_PER_QUERY - 1}`)).toBeNull();
    expect(resolve(`School ${MAX_PROSPECT_TEAMS_PER_QUERY}`)).toEqual({
      kind: "team",
      name: `School ${MAX_PROSPECT_TEAMS_PER_QUERY} Team`,
    });
  });
});

describe("checklistOnlyCard — Prospect", () => {
  const row = (extra: Record<string, unknown>) => ({ number: "NNO", players: ["Cord Rager"], teams: [] as string[], ...extra });
  const sooners = (t: string): ProspectResolution | null => (t === "Oklahoma" ? { kind: "team", name: "Oklahoma Sooners" } : null);

  test("a settled X is the card's team, answered by the checklist, born a prospect", () => {
    const card = checklistOnlyCard(row({ prospect: true, prospectTeams: ["Oklahoma"] }), () => null, sooners);
    expect(card).toMatchObject({ teams: ["Oklahoma Sooners"], teamLookup: "checklist", isProspect: true });
    expect(card.prospectTeam).toBeUndefined();
  });

  test("a held X is the card's hint and prospectTeam, never a team", () => {
    const card = checklistOnlyCard(row({ prospect: true, prospectTeams: ["Arizona"] }), () => null, sooners);
    expect(card.teams).toEqual([]);
    expect(card).toMatchObject({
      teamLookup: "checklist",
      isProspect: true,
      prospectTeam: "Arizona",
      prospectTeams: ["Arizona"],
      rawTeamName: "Arizona",
    });
  });

  test("with no resolver an X is held", () => {
    const card = checklistOnlyCard(row({ prospectTeams: ["Oklahoma"] }), () => null);
    expect(card.teams).toEqual([]);
    expect(card.prospectTeam).toBe("Oklahoma");
    expect(card.prospectTeams).toEqual(["Oklahoma"]);
  });

  test("a bare Prospect is a No Team answer and a prospect", () => {
    const card = checklistOnlyCard(row({ prospect: true, noTeam: true }), () => null);
    expect(card).toMatchObject({ teams: [], teamLookup: "checklist", isProspect: true });
    expect(card.prospectTeam).toBeUndefined();
  });

  test("a row that is not a prospect carries no prospect fields", () => {
    const card = checklistOnlyCard(row({ teams: ["Boston Red Sox"] }), () => null);
    expect(card.isProspect).toBeUndefined();
    expect(card.prospectTeam).toBeUndefined();
    expect(card.prospectTeams).toBeUndefined();
  });
});

describe("checklistPairedRow — Prospect", () => {
  const row = (extra: Record<string, unknown>) => ({ number: "NNO", players: ["Cord Rager"], teams: [] as string[], ...extra });
  const sooners = (t: string): ProspectResolution | null => (t === "Oklahoma" ? { kind: "team", name: "Oklahoma Sooners" } : { kind: "held" });

  test("one X settled and one held: nothing is written as a team and the held X is kept for the operator", () => {
    const paired = checklistPairedRow(row({ prospect: true, prospectTeams: ["Oklahoma", "Arizona"] }), () => null, sooners);
    expect(paired.prospect).toBe(true);
    expect(paired.teams).toEqual([]);
    // Every X goes back as printed, the settled one too: the card is held
    // whole, so a settled X is in no team list, and re-linking must be asked
    // the same question.
    expect(paired.prospectTeams).toEqual(["Oklahoma", "Arizona"]);
  });

  test("unlink then relink: the row sent again reproduces the answer, mixed Xs and a printed team included", () => {
    const original = row({
      prospect: true,
      teams: ["Boston Red Sox"],
      prospectTeams: ["Oklahoma", "Arizona"],
    });
    const first = applyChecklistRow({}, original, () => null, sooners);
    const paired = checklistPairedRow(original, () => null, sooners);
    // What the dialog sends back for the relink (`ChecklistLinkRow` fields).
    const resent = {
      players: paired.players,
      teams: paired.teams,
      ...(paired.noTeam ? { noTeam: true } : {}),
      ...(paired.prospect ? { prospect: true } : {}),
      ...(paired.prospectTeams ? { prospectTeams: paired.prospectTeams } : {}),
    };
    const second = applyChecklistRow({}, resent, () => null, sooners);
    expect(second).toEqual(first);
    expect(second).toMatchObject({ teams: [], isProspect: true, prospectTeam: "Arizona" });
  });

  test("unlink then relink with every X settled: the full names carry the claim", () => {
    const original = row({ prospect: true, prospectTeams: ["Oklahoma"] });
    const first = applyChecklistRow({}, original, () => null, sooners);
    const paired = checklistPairedRow(original, () => null, sooners);
    const second = applyChecklistRow(
      {},
      { players: paired.players, teams: paired.teams, prospect: true },
      () => null,
      sooners,
    );
    expect(second).toEqual(first);
  });

  test("a held X is not a No Team claim", () => {
    const paired = checklistPairedRow(row({ prospect: true, prospectTeams: ["Arizona"] }), () => null, sooners);
    expect(paired.noTeam).toBeUndefined();
  });

  test("a settled X is in teams and the row carries no prospectTeams", () => {
    const paired = checklistPairedRow(row({ prospect: true, prospectTeams: ["Oklahoma"] }), () => null, sooners);
    expect(paired.teams).toEqual(["Oklahoma Sooners"]);
    expect(paired.prospectTeams).toBeUndefined();
    expect(paired.prospect).toBe(true);
  });

  test("a bare Prospect is a No Team row that is also a prospect", () => {
    const paired = checklistPairedRow(row({ prospect: true, noTeam: true }), () => null);
    expect(paired).toMatchObject({ teams: [], noTeam: true, prospect: true });
  });
});
