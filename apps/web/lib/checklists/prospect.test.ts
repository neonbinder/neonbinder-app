/**
 * NEO-591 — "Prospect" / "Prospect (X)" in a checklist team cell:
 * `readProspectCell` (the one reader the client parser and the server share)
 * and the claim as the line format reads it.
 */
import { describe, expect, it } from "vitest";
import { parsePublishedChecklist } from "./parse-published-checklist";
import { isProspectText, readProspectCell } from "./prospect";

describe("readProspectCell", () => {
  it.each([
    ["Prospect", null],
    ["prospect", null],
    ["  PROSPECT  ", null],
    ["Prospect (N/A)", null],
    ["Prospect (n/a)", null],
    ["Prospect (None)", null],
    ["Prospect (-)", null],
    ["Prospect ()", null],
    ["Prospect (   )", null],
    ["Prospect (No Team)", null],
    ["Prospect (no  team)", null],
  ] as const)("reads %j as a bare prospect (no team)", (cell, team) => {
    expect(readProspectCell(cell)).toEqual({ team });
  });

  it.each([
    ["Prospect (Oklahoma)", "Oklahoma"],
    ["PROSPECT (OKLAHOMA)", "OKLAHOMA"],
    ["prospect (Oklahoma)", "Oklahoma"],
    ["Prospect(Oklahoma)", "Oklahoma"],
    ["Prospect  (  Oklahoma   State )", "Oklahoma State"],
    ["Prospect (Dallas Baptist)", "Dallas Baptist"],
    ["Prospect (Frisco RoughRiders (AA))", "Frisco RoughRiders (AA)"],
    ["Prospect (Prospect)", "Prospect"],
  ] as const)("reads %j as a prospect of %j", (cell, team) => {
    expect(readProspectCell(cell)).toEqual({ team });
  });

  it.each([
    "",
    "Mets",
    "Prospects",
    "Top Prospect",
    "Top Prospect (Oklahoma)",
    "Prospect Smith",
    "Prospect Autos",
    "Prospect - Oklahoma",
    "Prospect (A) (B)",
    "Prospect (Frisco) Rookie",
    "Prospect (Oklahoma",
    "Prospect (Oklahoma))",
    "(Prospect)",
    "Pro spect",
  ])("does not read %j as a prospect cell", (cell) => {
    expect(readProspectCell(cell)).toBeNull();
    expect(isProspectText(cell)).toBe(false);
  });

  it("reads full-width and compatibility characters the way the rest of the checklist does (NFKC)", () => {
    expect(readProspectCell("Ｐｒｏｓｐｅｃｔ（Oklahoma）")).toEqual({ team: "Oklahoma" });
  });

  it("isProspectText is true for the bare and the bracketed forms", () => {
    expect(isProspectText("Prospect")).toBe(true);
    expect(isProspectText("Prospect (Oklahoma)")).toBe(true);
  });
});

describe("Prospect in the line format (number player - team)", () => {
  const parse = (line: string) => parsePublishedChecklist(`${line}\n`, {});

  it.each([
    ["1 Mike Trout - Prospect (Oklahoma)", "Oklahoma"],
    ["2 Mike Trout, Prospect (Frisco RoughRiders (AA))", "Frisco RoughRiders (AA)"],
    ["3 Mike Trout ..... Prospect (Oklahoma)", "Oklahoma"],
    ["4 Mike Trout (Rookie) - Prospect (Oklahoma)", "Oklahoma"],
  ] as const)("%s sets prospect and keeps X out of the teams", (line, x) => {
    const [row] = parse(line).rows;
    expect(row.players).toEqual(["Mike Trout"]);
    expect(row.teams).toEqual([]);
    expect(row.prospect).toBe(true);
    expect(row.prospectTeams).toEqual([x]);
    expect(row.noTeam).toBeUndefined();
  });

  it("reads a bare Prospect as a prospect with No Team", () => {
    const [row] = parse("8 Mike Trout - Prospect").rows;
    expect(row).toMatchObject({ players: ["Mike Trout"], teams: [], noTeam: true, prospect: true });
    expect(row.prospectTeams).toBeUndefined();
  });

  it("reads Prospect (N/A) as bare", () => {
    const [row] = parse("9 Mike Trout - Prospect (N/A)").rows;
    expect(row).toMatchObject({ teams: [], noTeam: true, prospect: true });
    expect(row.prospectTeams).toBeUndefined();
  });

  it("does not read prospect (X) (note) as a claim, and never leaves the bare word as a team", () => {
    const [row] = parse("5 Mike Trout - prospect (Oklahoma) (Future Stars)").rows;
    expect(row.teams).toEqual([]);
    expect(row.prospect).toBeUndefined();
    expect(row.prospectTeams).toBeUndefined();
    expect(row.noTeam).toBeUndefined();
  });

  it("reads a Prospect (X) beside another team in the team part: the claim and the team", () => {
    const [row] = parse("10 Mike Trout - Mets, Prospect (Oklahoma)").rows;
    expect(row).toEqual({ number: "10", players: ["Mike Trout"], teams: ["Mets"], prospect: true, prospectTeams: ["Oklahoma"] });
  });

  it("reads Mets / Prospect (bare) beside a team as a prospect without No Team", () => {
    const [row] = parse("11 Mike Trout - Mets / Prospect").rows;
    expect(row).toEqual({ number: "11", players: ["Mike Trout"], teams: ["Mets"], prospect: true });
  });

  it("reads two Prospect segments as one prospect with both X, never as 'Prospect , Prospect'", () => {
    const [row] = parse("12 Mike Trout - Prospect (Oklahoma), Prospect (Texas)").rows;
    expect(row).toMatchObject({ teams: [], prospect: true, prospectTeams: ["Oklahoma", "Texas"] });
    const [bare] = parse("13 Mike Trout - Prospect, Prospect").rows;
    expect(bare).toMatchObject({ teams: [], noTeam: true, prospect: true });
    expect(bare.prospectTeams).toBeUndefined();
  });

  it("keeps one X once when two segments name it", () => {
    const [row] = parse("14 Mike Trout - Prospect (Oklahoma) / Prospect (Oklahoma)").rows;
    expect(row.prospectTeams).toEqual(["Oklahoma"]);
  });

  it("does not read a player named Prospect as a claim", () => {
    const [row] = parse("6 Prospect Smith - Mets").rows;
    expect(row).toEqual({ number: "6", players: ["Prospect Smith"], teams: ["Mets"] });
  });

  it("does not read Top Prospect (X) as a claim", () => {
    const [row] = parse("7 Mike Trout - Top Prospect (Oklahoma)").rows;
    expect(row.teams).toEqual(["Top Prospect"]);
    expect(row.prospect).toBeUndefined();
  });

  it("never lets X into a team list on any line shape", () => {
    for (const line of [
      "1 Mike Trout - Prospect (Oklahoma)",
      "2 Mike Trout, Prospect (Oklahoma)",
      "3 Mike Trout ..... Prospect (Oklahoma)",
    ]) {
      expect(parse(line).rows[0].teams).not.toContain("Oklahoma");
    }
  });
});

describe("Prospect in a delimited file", () => {
  it("reads two team columns, one Prospect (X) and one team, as a prospect with a team", () => {
    const out = parsePublishedChecklist("Card #,Player,Team,Team\n1,Mike Trout,Prospect (Oklahoma),Mets\n", {});
    expect(out.rows[0]).toMatchObject({ players: ["Mike Trout"], teams: ["Mets"], prospect: true, prospectTeams: ["Oklahoma"] });
    expect(out.rows[0].noTeam).toBeUndefined();
  });

  it("is not a No Team row when a bare Prospect sits beside a real team", () => {
    const out = parsePublishedChecklist("Card #,Player,Team,Team\n1,Mike Trout,Prospect,Mets\n", {});
    expect(out.rows[0]).toMatchObject({ teams: ["Mets"], prospect: true });
    expect(out.rows[0].noTeam).toBeUndefined();
  });

  it("skips a row that says No Team beside Prospect (X)", () => {
    const out = parsePublishedChecklist("Card #,Player,Team,Team\n1,Mike Trout,Prospect (Oklahoma),No Team\n", {});
    expect(out.rows).toEqual([]);
    expect(out.skipped).toHaveLength(1);
  });

  it.each([
    ["Prospect (Oklahoma) / Mets", ["Mets"], ["Oklahoma"]],
    ["Mets / Prospect (Oklahoma)", ["Mets"], ["Oklahoma"]],
    ["Mets; Prospect (Oklahoma)", ["Mets"], ["Oklahoma"]],
    ["Mets, Prospect (Oklahoma)", ["Mets"], ["Oklahoma"]],
    ["Prospect / Prospect (Texas)", [], ["Texas"]],
    ["Prospect (Oklahoma) / Prospect (Texas)", [], ["Oklahoma", "Texas"]],
    ["Prospect (A/B)", [], ["A/B"]],
  ] as const)("reads the team cell %j segment by segment", (cell, teams, xs) => {
    const out = parsePublishedChecklist(`Card #,Player,Team\n1,Mike Trout,"${cell}"\n`, {});
    expect(out.rows[0].teams).toEqual(teams);
    expect(out.rows[0].prospect).toBe(true);
    expect(out.rows[0].prospectTeams).toEqual(xs);
  });

  it("reads Mets / Prospect as a team and a bare prospect, with no No Team", () => {
    const out = parsePublishedChecklist('Card #,Player,Team\n1,Mike Trout,"Mets / Prospect"\n', {});
    expect(out.rows[0]).toEqual({ number: "1", players: ["Mike Trout"], teams: ["Mets"], prospect: true });
  });

  it("reads two Prospect cells across two team columns as one prospect, no 'Prospect' team", () => {
    const out = parsePublishedChecklist("Card #,Player,Team,Team\n1,Mike Trout,Prospect,Prospect (Texas)\n", {});
    expect(out.rows[0]).toEqual({ number: "1", players: ["Mike Trout"], teams: [], prospect: true, prospectTeams: ["Texas"] });
  });

  it.each(["Prospect (Oklahoma) (note)", "Prospect (Oklahoma) Rookie", "Prospect - Oklahoma"])(
    "never lets the word Prospect travel as a team: %j is no claim and no team",
    (cell) => {
      const out = parsePublishedChecklist(`Card #,Player,Team\n1,Mike Trout,"${cell}"\n`, {});
      expect(out.rows[0].teams.some((t) => /^prospect$/i.test(t))).toBe(false);
      expect(out.rows[0].prospect).toBeUndefined();
    },
  );

  it("leaves Top Prospect as the team text it always was", () => {
    const out = parsePublishedChecklist('Card #,Player,Team\n1,Mike Trout,"Top Prospect"\n', {});
    expect(out.rows[0]).toEqual({ number: "1", players: ["Mike Trout"], teams: ["Top Prospect"] });
  });

  it("leaves an ordinary team cell with a note alone: no prospect claim, the note dropped", () => {
    const out = parsePublishedChecklist("Card #,Player,Team\n1,Mike Trout,Mets (RC)\n", {});
    expect(out.rows[0]).toEqual({ number: "1", players: ["Mike Trout"], teams: ["Mets"] });
  });
});
