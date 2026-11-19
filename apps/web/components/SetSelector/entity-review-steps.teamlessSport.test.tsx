/**
 * NEO-426 — `trackSteps`' `teamsStepKnown`: while a fact the teams step's
 * membership reads is still loading, the counted teams step is HELD as it was,
 * never added (or dropped) on a half-loaded answer, so the progress bar is not
 * measured against a plan that is about to change.
 *
 * `.test.tsx` because `.test.ts` is not collected under components/.
 */

import { describe, expect, test } from "vitest";
import { trackSteps, type TrackStepsInput } from "./entity-review-steps";

const base: TrackStepsInput = {
  reviewRows: 2,
  teamsStep: false,
  titlesStep: false,
  onSave: false,
};

describe("trackSteps: teamsStepKnown", () => {
  test("absent reads as known: the teams step is counted on a first look", () => {
    const count = trackSteps(null, { ...base, teamsStep: true });
    expect(count.teamsStep).toBe(true);
    expect(count.total).toBe(2 + 1 + 1);
  });

  test("known = true counts the teams step like absent", () => {
    expect(trackSteps(null, { ...base, teamsStep: true, teamsStepKnown: true })).toEqual(
      trackSteps(null, { ...base, teamsStep: true }),
    );
  });

  test("unknown on a first count: the teams step is not counted, whatever the half-loaded answer says", () => {
    const count = trackSteps(null, { ...base, teamsStep: true, teamsStepKnown: false });
    expect(count.teamsStep).toBe(false);
    expect(count.total).toBe(2 + 1);
  });

  test("unknown holds a counted teams step even when the half-loaded answer says none", () => {
    const first = trackSteps(null, { ...base, teamsStep: true });
    const held = trackSteps(first, { ...base, teamsStep: false, teamsStepKnown: false });
    expect(held).toBe(first);
    expect(held.teamsStep).toBe(true);
  });

  test("unknown does not add a teams step that was not counted", () => {
    const first = trackSteps(null, base);
    const held = trackSteps(first, { ...base, teamsStep: true, teamsStepKnown: false });
    expect(held).toBe(first);
    expect(held.teamsStep).toBe(false);
  });

  test("once the facts land, a real answer is counted (and then stays: high-water mark)", () => {
    const first = trackSteps(null, base);
    const held = trackSteps(first, { ...base, teamsStep: true, teamsStepKnown: false });
    const landed = trackSteps(held, { ...base, teamsStep: true, teamsStepKnown: true });
    expect(landed.teamsStep).toBe(true);
    expect(landed.total).toBe(first.total + 1);
    const shrunk = trackSteps(landed, { ...base, teamsStep: false, teamsStepKnown: true });
    expect(shrunk.teamsStep).toBe(true);
    expect(shrunk.total).toBe(landed.total);
  });

  test("unknown still lets the other steps grow", () => {
    const first = trackSteps(null, base);
    const grown = trackSteps(first, {
      ...base,
      reviewRows: 3,
      titlesStep: true,
      teamsStep: true,
      teamsStepKnown: false,
    });
    expect(grown.reviewRows).toBe(3);
    expect(grown.titlesStep).toBe(true);
    expect(grown.teamsStep).toBe(false);
    expect(grown.total).toBe(3 + 1 + 1);
  });

  test("unknown on the Save step freezes as usual", () => {
    const first = trackSteps(null, { ...base, teamsStep: true });
    const frozen = trackSteps(first, { ...base, teamsStep: false, teamsStepKnown: false, onSave: true });
    expect(frozen.frozen).toBe(true);
    expect(frozen.teamsStep).toBe(true);
  });
});
