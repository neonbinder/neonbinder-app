/**
 * NEO-591 — a team cell that MIXES plain teams with a Prospect claim keeps
 * which teams sat inside the parens (`prospectClaimedTeams`), so the claim
 * reads as printed. `teams` and `prospect` mean what they always did.
 */
import { describe, expect, it } from "vitest";
import { parsePublishedChecklist } from "./parse-published-checklist";
import { checklistClaimText } from "./prospect-team-text";

const csv = (cell: string) =>
  parsePublishedChecklist(`Card #,Player,Team\n1,Cord Rager,"${cell}"\n`).rows[0];
const line = (cell: string) => parsePublishedChecklist(`1 Cord Rager - ${cell}`).rows[0];

describe.each([
  ["a delimited file", csv],
  ["the line format", line],
])("prospectClaimedTeams in %s", (_name, read) => {
  it("a plain team beside a Prospect claim: only X was inside the parens", () => {
    const row = read("Cincinnati Reds / Prospect (Frisco)");
    expect(row).toMatchObject({
      teams: ["Cincinnati Reds", "Frisco"],
      prospect: true,
      prospectClaimedTeams: ["Frisco"],
    });
    expect(checklistClaimText(row)).toBe("Cincinnati Reds / Prospect (Frisco)");
  });

  it("an all-prospect cell stores nothing extra and reads Prospect (X / Y)", () => {
    for (const cell of ["Prospect (Frisco / Dallas Baptist)", "Prospect (Oklahoma)"]) {
      const row = read(cell);
      expect(row.prospect).toBe(true);
      expect(row).not.toHaveProperty("prospectClaimedTeams");
      expect(checklistClaimText(row)).toBe(cell);
    }
  });

  it("a bare Prospect has no team to keep and reads Prospect", () => {
    const row = read("Prospect");
    expect(row).toMatchObject({ teams: [], prospect: true, noTeam: true });
    expect(row).not.toHaveProperty("prospectClaimedTeams");
    expect(checklistClaimText(row)).toBe("Prospect");
  });

  it("two plain teams and one prospect X: both plain teams stay outside, in order", () => {
    const row = read("Boston Red Sox / Cincinnati Reds / Prospect (Frisco)");
    expect(row.teams).toEqual(["Boston Red Sox", "Cincinnati Reds", "Frisco"]);
    expect(row.prospectClaimedTeams).toEqual(["Frisco"]);
    expect(checklistClaimText(row)).toBe("Boston Red Sox / Cincinnati Reds / Prospect (Frisco)");
  });

  it("a bare Prospect beside a plain team keeps the team outside: Reds / Prospect", () => {
    const row = read("Cincinnati Reds / Prospect");
    expect(row).toMatchObject({ teams: ["Cincinnati Reds"], prospect: true });
    expect(row.prospectClaimedTeams).toEqual([]);
    expect(checklistClaimText(row)).toBe("Cincinnati Reds / Prospect");
  });

  it("a team that is also the X is just the claim (nothing left outside)", () => {
    const row = read("Frisco / Prospect (Frisco)");
    expect(row.teams).toEqual(["Frisco"]);
    expect(row).not.toHaveProperty("prospectClaimedTeams");
  });

  it("no Prospect, no field", () => {
    const row = read("Cincinnati Reds / Boston Red Sox");
    expect(row).not.toHaveProperty("prospect");
    expect(row).not.toHaveProperty("prospectClaimedTeams");
  });
});

describe("prospectClaimedTeams across team columns", () => {
  it("a plain team column and a Prospect column keep the claim to its own column", () => {
    const row = parsePublishedChecklist(
      "Card #,Player,Team,Team\n1,Cord Rager,Cincinnati Reds,Prospect (Frisco)\n",
    ).rows[0];
    expect(row.teams).toEqual(["Cincinnati Reds", "Frisco"]);
    expect(row.prospectClaimedTeams).toEqual(["Frisco"]);
  });
});
