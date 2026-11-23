/**
 * NEO-101: the marketplace length limits, pinned.
 *
 * Modelled on `convex/sku.test.ts`, and for the same reason: these are numbers
 * transcribed from someone else's documentation, so the test's job is to make
 * a change to one of them DELIBERATE. A number that moves because an eBay
 * policy actually changed should arrive with a red test and a re-read of the
 * doc block in `listingLimits.ts`; a number that moves because someone was
 * tidying should never get that far.
 */

import { describe, expect, test } from "vitest";
import {
  ASPECT_VALUE_MAX,
  LISTING_DESCRIPTION_MAX,
  LISTING_TITLE_MAX,
} from "./listingLimits";
import { EBAY_DESCRIPTION_MAX } from "../lib/ebayListing";

describe("listing limits", () => {
  test("the confirmed values (2026-09-02)", () => {
    expect(LISTING_TITLE_MAX).toBe(80);
    expect(ASPECT_VALUE_MAX).toBe(65);
  });

  test("the aspect-value cap is independent of the title cap", () => {
    // Different eBay field, different number. Pinned so a future "tidy up,
    // they're all 80" cannot quietly happen.
    expect(ASPECT_VALUE_MAX).not.toBe(LISTING_TITLE_MAX);
    expect(ASPECT_VALUE_MAX).toBeLessThan(LISTING_TITLE_MAX);
  });

  test("every limit is a positive whole number of characters", () => {
    for (const limit of [LISTING_TITLE_MAX, ASPECT_VALUE_MAX]) {
      expect(Number.isInteger(limit)).toBe(true);
      expect(limit).toBeGreaterThan(0);
    }
  });

  test("NEO-535: the stored description cap is eBay's description cap", () => {
    expect(LISTING_DESCRIPTION_MAX).toBe(4000);
    expect(LISTING_DESCRIPTION_MAX).toBe(EBAY_DESCRIPTION_MAX);
  });
});
