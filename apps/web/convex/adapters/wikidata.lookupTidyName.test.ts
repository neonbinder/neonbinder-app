/**
 * NEO-656 — the team half of `lookupTidyName`: a later team lookup is laid over
 * the partial answer the walk already holds (NEO-301), never replacing it.
 * Ported from the deleted `wikidataEntityReviewTeamPartial.test.ts`
 * (`overlayTeamEnrichment` cases), plus the two rules `withHeldTeamAnswer`
 * carries over from `tidyNames.applyLookupResult`: an `error` never downgrades
 * a held answer, and no held answer leaves the result as it came.
 *
 * Pure functions, no Convex runtime, so it lives beside the adapter.
 */

import { describe, expect, test } from "vitest";
import { overlayTeamEnrichment, withHeldTeamAnswer } from "./wikidata";

const NATIONALS_QID = "Q212654";

describe("overlayTeamEnrichment", () => {
  test("keeps what the new result leaves undefined, per field and per colour swatch", () => {
    expect(
      overlayTeamEnrichment(
        { league: "MLB", location: "Washington", colors: { primary: "#ab0003", secondary: "#14225a" }, espnId: "20" },
        { wikidataId: NATIONALS_QID, location: undefined, colors: { primary: undefined, secondary: "#000000" } },
      ),
    ).toEqual({
      league: "MLB",
      location: "Washington",
      colors: { primary: "#ab0003", secondary: "#000000" },
      espnId: "20",
      wikidataId: NATIONALS_QID,
    });
  });

  test("either side missing returns the other", () => {
    expect(overlayTeamEnrichment(undefined, { espnId: "1" })).toEqual({ espnId: "1" });
    expect(overlayTeamEnrichment({ espnId: "1" }, undefined)).toEqual({ espnId: "1" });
  });
});

describe("withHeldTeamAnswer", () => {
  const espnHalf = { league: "MLB", location: "Washington", colors: { primary: "#ab0003" }, espnId: "20" };

  test("a later result that reaches Wikidata adds its QID and years, keeps ESPN's colours", () => {
    expect(
      withHeldTeamAnswer(espnHalf, {
        status: "ready",
        enrichment: { wikidataId: NATIONALS_QID, yearsActive: { from: 2005 }, colors: { primary: undefined } },
      }),
    ).toEqual({
      status: "ready",
      enrichment: { ...espnHalf, wikidataId: NATIONALS_QID, yearsActive: { from: 2005 } },
    });
  });

  test("a later try that finds NOTHING does not downgrade the held answer", () => {
    expect(withHeldTeamAnswer(espnHalf, { status: "error" })).toEqual({
      status: "ready",
      enrichment: espnHalf,
    });
    expect(withHeldTeamAnswer(espnHalf, { status: "ready" })).toEqual({
      status: "ready",
      enrichment: espnHalf,
    });
  });

  test("with no held answer the result is exactly what the lookup said", () => {
    expect(withHeldTeamAnswer(undefined, { status: "error" })).toEqual({ status: "error" });
    expect(withHeldTeamAnswer(undefined, { status: "ready", enrichment: { espnId: "1" } })).toEqual({
      status: "ready",
      enrichment: { espnId: "1" },
    });
  });
});
