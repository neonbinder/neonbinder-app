import { describe, expect, it } from "vitest";
import {
  checklistClaimParts,
  checklistClaimText,
  mixedProspectClaim,
  MAX_CHECKLIST_CLAIM_LENGTH,
} from "./prospect-team-text";

describe("checklistClaimParts / checklistClaimText", () => {
  it("a row that is not a prospect reads its teams", () => {
    expect(checklistClaimText({ teams: ["Reds", "Cubs"] })).toBe("Reds / Cubs");
  });

  it("all teams inside the parens (no claimed list): Prospect (X / Y), as before", () => {
    expect(checklistClaimText({ teams: ["Frisco", "Dallas Baptist"], prospect: true })).toBe(
      "Prospect (Frisco / Dallas Baptist)",
    );
    expect(checklistClaimText({ teams: ["Oklahoma"], prospect: true })).toBe("Prospect (Oklahoma)");
  });

  it("a bare Prospect still reads Prospect", () => {
    expect(checklistClaimText({ teams: [], prospect: true })).toBe("Prospect");
  });

  it("one plain team and one claimed X read as printed", () => {
    expect(
      checklistClaimText({
        teams: ["Cincinnati Reds", "Frisco"],
        prospect: true,
        prospectClaimedTeams: ["Frisco"],
      }),
    ).toBe("Cincinnati Reds / Prospect (Frisco)");
  });

  it("two plain teams and one claimed keep their order", () => {
    expect(
      checklistClaimParts({
        teams: ["Boston Red Sox", "Cincinnati Reds", "Frisco"],
        prospect: true,
        prospectClaimedTeams: ["Frisco"],
      }),
    ).toEqual(["Boston Red Sox", "Cincinnati Reds", "Prospect (Frisco)"]);
  });

  it("an empty claimed list is a Prospect beside plain teams", () => {
    expect(checklistClaimText({ teams: ["Reds"], prospect: true, prospectClaimedTeams: [] })).toBe(
      "Reds / Prospect",
    );
  });

  it("matches a claimed team by its folded key, and ignores a claimed text that is not a team", () => {
    expect(
      checklistClaimText({
        teams: ["Reds", "Frisco"],
        prospect: true,
        prospectClaimedTeams: [" frisco ", "Nowhere"],
      }),
    ).toBe("Reds / Prospect (Frisco)");
  });

  it("the claimed list does nothing on a row that is not a prospect", () => {
    expect(checklistClaimText({ teams: ["Reds", "Frisco"], prospectClaimedTeams: ["Frisco"] })).toBe(
      "Reds / Frisco",
    );
  });

  it("holds the text to the cap with an ellipsis", () => {
    const text = checklistClaimText({ teams: ["x".repeat(900)], prospect: true });
    expect(text.length).toBe(MAX_CHECKLIST_CLAIM_LENGTH);
    expect(text.endsWith("…")).toBe(true);
  });
});

describe("mixedProspectClaim", () => {
  it("is undefined when every team was inside, or there is no team", () => {
    expect(mixedProspectClaim(["A", "B"], ["A", "B"])).toBeUndefined();
    expect(mixedProspectClaim([], ["A"])).toBeUndefined();
  });

  it("lists the claimed teams as the row spells them, in the row's order", () => {
    expect(mixedProspectClaim(["Reds", "Frisco", "Dallas Baptist"], ["dallas baptist", "FRISCO"])).toEqual([
      "Frisco",
      "Dallas Baptist",
    ]);
  });

  it("never names a team the row does not", () => {
    expect(mixedProspectClaim(["Reds", "Frisco"], ["Frisco", "Mars"])).toEqual(["Frisco"]);
    expect(mixedProspectClaim(["Reds"], ["Mars"])).toEqual([]);
  });
});
