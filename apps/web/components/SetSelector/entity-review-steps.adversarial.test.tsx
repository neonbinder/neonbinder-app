/**
 * NEO-335 Phase 2 — adversarial pass over the step plan behind the progress
 * bar: it never shrinks, freezes on Save, and thaws with its growth counted.
 * `.test.tsx` because `.test.ts` is not collected under components/.
 */
import { describe, expect, it } from "vitest";
import {
  advanceStepCount,
  initialStepCount,
  nextPostReviewStep,
  previousPostReviewStep,
  resolvePostReviewStep,
  stepNumber,
  stepProgress,
  trackSteps,
} from "./entity-review-steps";

const input = (reviewRows: number, teamsStep = false, titlesStep = false, onSave = false) => ({
  reviewRows,
  teamsStep,
  titlesStep,
  onSave,
});

describe("the plan never shrinks", () => {
  it("whatever sequence of inputs, total is non-decreasing", () => {
    let count = initialStepCount({ reviewRows: 3, teamsStep: true, titlesStep: false });
    let last = count.total;
    const seq = [
      { reviewRows: 0, teamsStep: false, titlesStep: false },
      { reviewRows: 5, teamsStep: false, titlesStep: true },
      { reviewRows: 1, teamsStep: false, titlesStep: false },
      { reviewRows: 5, teamsStep: true, titlesStep: true },
      { reviewRows: 2, teamsStep: false, titlesStep: false },
    ];
    for (const s of seq) {
      count = advanceStepCount(count, s, false);
      expect(count.total).toBeGreaterThanOrEqual(last);
      last = count.total;
    }
    expect(count.total).toBe(5 + 1 + 1 + 1);
  });

  it("a negative or zero review-row count cannot push the plan below 1", () => {
    expect(initialStepCount({ reviewRows: -4, teamsStep: false, titlesStep: false }).total).toBe(1);
  });

  it("trackSteps with every row removed keeps the plan", () => {
    const t0 = trackSteps(null, input(2));
    const t1 = trackSteps(t0, input(0));
    expect(t1).toBe(t0);
  });

  it("Save is always the last step and a full bar, however the flags climbed", () => {
    let count = initialStepCount({ reviewRows: 1, teamsStep: false, titlesStep: false });
    count = advanceStepCount(count, { reviewRows: 4, teamsStep: true, titlesStep: true }, false);
    expect(stepNumber(count, { kind: "save" })).toBe(count.total);
    expect(stepNumber(count, { kind: "titles" })).toBe(count.total - 1);
    expect(stepNumber(count, { kind: "teams" })).toBe(count.total - 2);
    const { done, planned } = stepProgress(count, { kind: "save" });
    expect(done).toBe(planned);
  });

  it("a review index past the plan never fills the bar", () => {
    const count = initialStepCount({ reviewRows: 2, teamsStep: true, titlesStep: false });
    const { done, planned } = stepProgress(count, { kind: "review", index: 99 });
    expect(done).toBeLessThan(planned);
  });
});

describe("frozen on Save", () => {
  it("opening straight on Save counts everything present and then ignores growth", () => {
    const t0 = trackSteps(null, input(1, true, false, true));
    expect(t0.frozen).toBe(true);
    expect(t0.total).toBe(3);
    const t1 = trackSteps(t0, input(3, true, true, true));
    expect(t1).toBe(t0);
  });

  it("growth during Save is counted once, on thaw", () => {
    const t0 = trackSteps(null, input(1));
    const onSave = trackSteps(t0, input(1, false, false, true));
    const during = trackSteps(onSave, input(2, true, true, true));
    expect(during.total).toBe(onSave.total);
    const thawed = trackSteps(during, input(2, true, true, false));
    expect(thawed.total).toBe(5);
    // and then it is still again
    expect(trackSteps(thawed, input(2, true, true, false))).toBe(thawed);
  });

  it("thawing with nothing new only thaws", () => {
    const t0 = trackSteps(null, input(1));
    const frozen = trackSteps(t0, input(1, false, false, true));
    const thawed = trackSteps(frozen, input(1));
    expect(thawed.frozen).toBe(false);
    expect(thawed.total).toBe(t0.total);
  });

  it("the move onto Save with growth arriving the same instant adds nothing", () => {
    const prev = initialStepCount({ reviewRows: 1, teamsStep: false, titlesStep: false });
    const count = advanceStepCount(prev, { reviewRows: 9, teamsStep: true, titlesStep: true }, true);
    expect(count.total).toBe(prev.total);
    expect(count.frozen).toBe(true);
  });
});

describe("walking past empty steps", () => {
  it("nothing live: every request lands on Save, and Back from Save leaves for the names", () => {
    const live = { teams: false, titles: false };
    expect(resolvePostReviewStep("teams", live)).toBe("save");
    expect(resolvePostReviewStep("titles", live)).toBe("save");
    expect(previousPostReviewStep("save", live)).toBeNull();
    expect(nextPostReviewStep("save", live)).toBeNull();
  });

  it("titles live but teams not: Back from Save stops on titles, and from titles leaves", () => {
    const live = { teams: false, titles: true };
    expect(previousPostReviewStep("save", live)).toBe("titles");
    expect(previousPostReviewStep("titles", live)).toBeNull();
  });
});
