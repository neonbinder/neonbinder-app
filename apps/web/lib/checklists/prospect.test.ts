/**
 * NEO-591 — "Prospect" / "Prospect (X)" in a checklist team cell:
 * `readProspectCell` (the one reader the client parser and the server share)
 * and the claim as the line format reads it. X is the card's printed team
 * (Jason, 2026-11-19): it lands in `teams` beside `prospect: true`.
 */
import { describe, expect, it } from "vitest";
import { parsePublishedChecklist, parsePublishedChecklistCells } from "./parse-published-checklist";
import { bracketedNotesEnd, isProspectText, matchBrackets, readProspectCell } from "./prospect";

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
    "Prospect (A) Rookie",
    "Prospect (A) (B",
    "Prospect (Frisco) Rookie",
    "Prospect (Oklahoma",
    "Prospect (Oklahoma))",
    "(Prospect)",
    "Pro spect",
  ])("does not read %j as a prospect cell", (cell) => {
    expect(readProspectCell(cell)).toBeNull();
    expect(isProspectText(cell)).toBe(false);
  });

  it.each([
    ["Prospect (A) (B)", "A"],
    ["Prospect (Oklahoma) (RC)", "Oklahoma"],
    ["Prospect (Oklahoma) [SP] (note)", "Oklahoma"],
    ["Prospect (Frisco RoughRiders (AA)) (RC)", "Frisco RoughRiders (AA)"],
  ] as const)("takes the first bracket of %j as X and drops the notes after it", (cell, team) => {
    expect(readProspectCell(cell)).toEqual({ team });
  });

  it("reads Prospect () (RC) as a bare prospect", () => {
    expect(readProspectCell("Prospect () (RC)")).toEqual({ team: null });
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
  ] as const)("%s sets prospect and reads X as the team", (line, x) => {
    const [row] = parse(line).rows;
    expect(row.players).toEqual(["Mike Trout"]);
    expect(row.teams).toEqual([x]);
    expect(row.prospect).toBe(true);
    expect(row.noTeam).toBeUndefined();
  });

  it("reads a bare Prospect as a prospect with No Team", () => {
    const [row] = parse("8 Mike Trout - Prospect").rows;
    expect(row).toMatchObject({ players: ["Mike Trout"], teams: [], noTeam: true, prospect: true });
  });

  it("reads Prospect (N/A) as bare", () => {
    const [row] = parse("9 Mike Trout - Prospect (N/A)").rows;
    expect(row).toMatchObject({ teams: [], noTeam: true, prospect: true });
  });

  it("reads prospect (X) (note) as the team X: the notes after the first bracket are dropped", () => {
    const [row] = parse("5 Mike Trout - prospect (Oklahoma) (Future Stars)").rows;
    expect(row).toEqual({ number: "5", players: ["Mike Trout"], teams: ["Oklahoma"], prospect: true });
  });

  it("reads Mets, Prospect (Oklahoma) (RC) as the team and the claim", () => {
    const [row] = parse("15 Mike Trout - Mets, Prospect (Oklahoma) (RC)").rows;
    expect(row).toEqual({ number: "15", players: ["Mike Trout"], teams: ["Mets", "Oklahoma"], prospect: true, prospectClaimedTeams: ["Oklahoma"] });
  });

  it("reads a Prospect (X) beside another team in the team part: both are teams, and the claim", () => {
    const [row] = parse("10 Mike Trout - Mets, Prospect (Oklahoma)").rows;
    expect(row).toEqual({
      number: "10",
      players: ["Mike Trout"],
      teams: ["Mets", "Oklahoma"],
      prospect: true,
      prospectClaimedTeams: ["Oklahoma"],
    });
  });

  it("reads Mets / Prospect (bare) beside a team as a prospect without No Team", () => {
    const [row] = parse("11 Mike Trout - Mets / Prospect").rows;
    expect(row).toEqual({
      number: "11",
      players: ["Mike Trout"],
      teams: ["Mets"],
      prospect: true,
      prospectClaimedTeams: [],
    });
  });

  it("reads two Prospect segments as one prospect with both X as teams, never as 'Prospect , Prospect'", () => {
    const [row] = parse("12 Mike Trout - Prospect (Oklahoma), Prospect (Texas)").rows;
    expect(row).toMatchObject({ teams: ["Oklahoma", "Texas"], prospect: true });
    const [bare] = parse("13 Mike Trout - Prospect, Prospect").rows;
    expect(bare).toMatchObject({ teams: [], noTeam: true, prospect: true });
  });

  it("keeps one X once when two segments name it", () => {
    const [row] = parse("14 Mike Trout - Prospect (Oklahoma) / Prospect (Oklahoma)").rows;
    expect(row.teams).toEqual(["Oklahoma"]);
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

  it("puts X in the team list on every line shape", () => {
    for (const line of [
      "1 Mike Trout - Prospect (Oklahoma)",
      "2 Mike Trout, Prospect (Oklahoma)",
      "3 Mike Trout ..... Prospect (Oklahoma)",
    ]) {
      expect(parse(line).rows[0].teams).toContain("Oklahoma");
    }
  });
});

describe("Prospect in a delimited file", () => {
  it("reads two team columns, one Prospect (X) and one team, as a prospect with both teams", () => {
    const out = parsePublishedChecklist("Card #,Player,Team,Team\n1,Mike Trout,Prospect (Oklahoma),Mets\n", {});
    expect(out.rows[0]).toMatchObject({ players: ["Mike Trout"], teams: ["Oklahoma", "Mets"], prospect: true });
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
    ["Prospect (Oklahoma) / Mets", ["Mets", "Oklahoma"]],
    ["Mets / Prospect (Oklahoma)", ["Mets", "Oklahoma"]],
    ["Mets; Prospect (Oklahoma)", ["Mets", "Oklahoma"]],
    ["Mets, Prospect (Oklahoma)", ["Mets", "Oklahoma"]],
    ["Prospect / Prospect (Texas)", ["Texas"]],
    ["Prospect (Oklahoma) / Prospect (Texas)", ["Oklahoma", "Texas"]],
    ["Prospect (A/B)", ["A/B"]],
  ] as const)("reads the team cell %j segment by segment", (cell, teams) => {
    const out = parsePublishedChecklist(`Card #,Player,Team\n1,Mike Trout,"${cell}"\n`, {});
    expect(out.rows[0].teams).toEqual(teams);
    expect(out.rows[0].prospect).toBe(true);
  });

  it("reads Mets / Prospect as a team and a bare prospect, with no No Team", () => {
    const out = parsePublishedChecklist('Card #,Player,Team\n1,Mike Trout,"Mets / Prospect"\n', {});
    expect(out.rows[0]).toEqual({
      number: "1",
      players: ["Mike Trout"],
      teams: ["Mets"],
      prospect: true,
      prospectClaimedTeams: [],
    });
  });

  it("reads two Prospect cells across two team columns as one prospect, no 'Prospect' team", () => {
    const out = parsePublishedChecklist("Card #,Player,Team,Team\n1,Mike Trout,Prospect,Prospect (Texas)\n", {});
    expect(out.rows[0]).toEqual({ number: "1", players: ["Mike Trout"], teams: ["Texas"], prospect: true });
  });

  it.each(["Prospect (Oklahoma) Rookie", "Prospect - Oklahoma"])(
    "never lets the word Prospect travel as a team: %j is no claim and no team named Prospect",
    (cell) => {
      const out = parsePublishedChecklist(`Card #,Player,Team\n1,Mike Trout,"${cell}"\n`, {});
      expect(out.rows[0].teams.some((t) => /^prospect$/i.test(t))).toBe(false);
      expect(out.rows[0].prospect).toBeUndefined();
    },
  );

  it.each([
    ["Prospect (Oklahoma) (note)", ["Oklahoma"]],
    ["Prospect (Oklahoma) (RC)", ["Oklahoma"]],
    ["Prospect (Oklahoma) (RC) / Mets", ["Mets", "Oklahoma"]],
    ["Mets / Prospect (A) (B)", ["Mets", "A"]],
  ] as const)("reads the first bracket of %j as X and drops the notes", (cell, teams) => {
    const out = parsePublishedChecklist(`Card #,Player,Team\n1,Mike Trout,"${cell}"\n`, {});
    expect(out.rows[0].teams).toEqual(teams);
    expect(out.rows[0].prospect).toBe(true);
  });

  it("leaves Top Prospect as the team text it always was", () => {
    const out = parsePublishedChecklist('Card #,Player,Team\n1,Mike Trout,"Top Prospect"\n', {});
    expect(out.rows[0]).toEqual({ number: "1", players: ["Mike Trout"], teams: ["Top Prospect"] });
  });

  it("leaves an ordinary team cell with a note alone: no prospect claim, the note dropped", () => {
    const out = parsePublishedChecklist("Card #,Player,Team\n1,Mike Trout,Mets (RC)\n", {});
    expect(out.rows[0]).toEqual({ number: "1", players: ["Mike Trout"], teams: ["Mets"] });
  });
});

describe("Teams in a Last Name / First Name PDF keep only their first bracket (the league tag)", () => {
  const run = (team: string) => {
    const header = [
      { text: "Last Name", x: 52.5, end: 92.4, size: 9.1 },
      { text: "First Name", x: 110.7, end: 151.7, size: 9.1 },
    ];
    const row = [
      { text: "Trout", x: 52.5, end: 80, size: 9.1 },
      { text: "Mike", x: 110.7, end: 130, size: 9.1 },
      { text: team, x: 165.6, end: 165.6 + team.length * 4.5, size: 9.1 },
    ];
    const record = (line: number, items: typeof row) => ({
      line,
      page: 1,
      cells: items.map((i) => i.text),
      xs: items.map((i) => i.x),
      items,
    });
    return parsePublishedChecklistCells(
      { format: "pdf", records: [record(1, header), record(2, row)] },
      {},
    ).rows[0];
  };

  it.each([
    ["New York (A)", ["New York (A)"]],
    ["New York (A) (RC)", ["New York (A)"]],
    ["Seattle (RC)", ["Seattle"]],
    ["Seattle (RC) (A)", ["Seattle"]],
    ["Los Angeles (N)", ["Los Angeles (N)"]],
    ["Seattle", ["Seattle"]],
  ] as const)("reads the team cell %j as %j", (team, teams) => {
    expect(run(team)).toMatchObject({ players: ["Mike Trout"], teams, noNumber: true });
  });

  it("reads Prospect (Oklahoma) (RC) as the team Oklahoma and a prospect", () => {
    expect(run("Prospect (Oklahoma) (RC)")).toEqual({
      number: "NNO",
      players: ["Mike Trout"],
      teams: ["Oklahoma"],
      noNumber: true,
      prospect: true,
    });
  });
});

describe("bracket scans are one pass (N3)", () => {
  it("matches every opening bracket of a long unclosed run in one go", () => {
    const text = "prospect (".repeat(50_000);
    const match = matchBrackets(text);
    expect(match.length).toBe(text.length);
    expect(Array.from(match).every((m) => m === -1)).toBe(true);
  });

  it("matches nested and mixed brackets by kind", () => {
    const text = "a (b (c) [d]) {e}";
    const match = matchBrackets(text);
    expect(match[2]).toBe(12);
    expect(match[5]).toBe(7);
    expect(match[9]).toBe(11);
    expect(match[14]).toBe(16);
    // "(b (c) [d])" then the note "{e}" after it.
    expect(bracketedNotesEnd(text, 2, match)).toBe(17);
    expect(bracketedNotesEnd(text, 2, match) === bracketedNotesEnd(text, 2)).toBe(true);
  });

  it("reads a cell of a repeated unclosed 'prospect (' as no claim, and finishes", () => {
    const cell = "prospect (".repeat(20_000);
    const out = parsePublishedChecklist(`Card #,Player,Team\n1,Mike Trout,"${cell}"\n`, {});
    expect(out.rows.every((r) => r.prospect === undefined)).toBe(true);
  }, 5_000);

  it("reads a line of a repeated unclosed 'prospect (' as no claim, and finishes", () => {
    const out = parsePublishedChecklist(`1 Mike Trout - ${"prospect (".repeat(190)}\n`, {});
    expect(out.rows.every((r) => r.prospect === undefined)).toBe(true);
  }, 5_000);
});
