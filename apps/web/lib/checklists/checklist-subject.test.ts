import { describe, expect, it } from "vitest";
import { MAX_SUBJECT_LENGTH, checklistSubject } from "./checklist-subject";

describe("checklistSubject", () => {
  it("keeps a checklist's own subject, folded to single spaces", () => {
    expect(checklistSubject("Checklist")).toBe("Checklist");
    expect(checklistSubject(" Team   Checklist 1-100 ")).toBe("Team Checklist 1-100");
  });

  it("drops a person, a team card and a group", () => {
    for (const s of ["Aaron Judge", "Mets TC", "Team Leaders", "Royals Team Card", "", "  "]) {
      expect(checklistSubject(s)).toBeUndefined();
    }
  });

  it("is a whole word, at the start", () => {
    expect(checklistSubject("Checklists")).toBeUndefined();
    expect(checklistSubject("The Checklist")).toBeUndefined();
  });

  it("drops one over the cap", () => {
    expect(checklistSubject(`Checklist ${"x".repeat(MAX_SUBJECT_LENGTH)}`)).toBeUndefined();
    expect(checklistSubject(`Checklist ${"x".repeat(MAX_SUBJECT_LENGTH - 10)}`)).toBeDefined();
  });
});
