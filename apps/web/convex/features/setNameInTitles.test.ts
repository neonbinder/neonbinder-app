/**
 * NEO-645 — what a change of the set name in titles does to ONE stored title
 * (the NEO-637 rules, moved server-side):
 *
 *   - a GENERATED title is rebuilt under the new name;
 *   - a HAND EDIT that shows "Left out to fit" gets the new set name swapped in;
 *   - ANY OTHER hand edit is left exactly as typed.
 *
 * Pure, so each case is pinned without a database. The fixture is a set whose
 * description is too long for a title, so the builder cuts words and the short
 * name ("UD Holo") has something to replace.
 */

import { describe, expect, test } from "vitest";
import {
  assessListingTitle,
  leftOutOfTitle,
  titleDescription,
  type ListingCardInputs,
} from "./generateListing";
import {
  oneLine,
  retitleForSetName,
  swapSetNameInTitle,
  titleShowsLeftOut,
} from "./setNameInTitles";

const LONG: ListingCardInputs = {
  cardNumber: "38",
  playerNames: ["Bo Jackson"],
  teamNames: ["Kansas City Royals"],
  year: "1991",
  manufacturer: "Upper Deck",
  setName: "Hologram Collection Extraordinaire Series Nineteen Ninety One Anniversary",
  insertName: "Dugout Collection Deluxe",
  isRookie: true,
};
const SHORT = "UD Holo";
const withShort = (name: string | undefined): ListingCardInputs => ({
  ...LONG,
  setShortName: name,
});

describe("retitleForSetName — a generated title", () => {
  test("is rebuilt under the new set name", () => {
    const stored = assessListingTitle(LONG).title;
    const out = retitleForSetName({
      storedTitle: stored,
      inputsAfter: withShort(SHORT),
      oldShortName: undefined,
      newShortName: SHORT,
    });
    expect(out.kind).toBe("generated");
    if (out.kind !== "generated") return;
    expect(out.title).toBe(assessListingTitle(withShort(SHORT)).title);
    expect(out.title.startsWith(SHORT)).toBe(true);
  });

  test("is rebuilt back to the full description when the short name is cleared", () => {
    const stored = assessListingTitle(withShort(SHORT)).title;
    const out = retitleForSetName({
      storedTitle: stored,
      inputsAfter: LONG,
      oldShortName: SHORT,
      newShortName: undefined,
    });
    expect(out).toMatchObject({ kind: "generated", title: assessListingTitle(LONG).title });
  });

  test("a card with no title yet gets the generated one", () => {
    const out = retitleForSetName({
      storedTitle: undefined,
      inputsAfter: withShort(SHORT),
      oldShortName: undefined,
      newShortName: SHORT,
    });
    expect(out.kind).toBe("generated");
  });

  test("a rebuild that changes nothing is left alone (no write)", () => {
    // A short name the builder never uses (the title fits without it).
    const fits: ListingCardInputs = { ...LONG, setName: "Hologram", insertName: undefined };
    const stored = assessListingTitle(fits).title;
    const out = retitleForSetName({
      storedTitle: stored,
      inputsAfter: { ...fits, setShortName: SHORT },
      oldShortName: undefined,
      newShortName: SHORT,
    });
    expect(out).toEqual({ kind: "leave" });
  });
});

describe("retitleForSetName — a hand edit that shows 'Left out'", () => {
  test("gets the new name swapped in for the builder's description, the rest kept", () => {
    const stored = `${titleDescription(LONG)} Jackson #38`;
    expect(titleShowsLeftOut(LONG, stored)).toBe(true);
    const out = retitleForSetName({
      storedTitle: stored,
      inputsAfter: withShort(SHORT),
      oldShortName: undefined,
      newShortName: SHORT,
    });
    expect(out).toEqual({ kind: "swapped", title: `${SHORT} Jackson #38` });
  });

  test("swaps the OLD short name for the new one when the title carries it", () => {
    const stored = `${SHORT} Jackson #38`;
    expect(titleShowsLeftOut(withShort(SHORT), stored)).toBe(true);
    const out = retitleForSetName({
      storedTitle: stored,
      inputsAfter: withShort("Holo"),
      oldShortName: SHORT,
      newShortName: "Holo",
    });
    expect(out).toEqual({ kind: "swapped", title: "Holo Jackson #38" });
  });

  test("clearing the short name swaps the builder's description back in", () => {
    const out = retitleForSetName({
      storedTitle: `${SHORT} Jackson #38`,
      inputsAfter: LONG,
      oldShortName: SHORT,
      newShortName: undefined,
    });
    expect(out).toEqual({ kind: "swapped", title: `${titleDescription(LONG)} Jackson #38` });
  });

  test("when the old set name cannot be found the edit is dropped for the generated title", () => {
    const out = retitleForSetName({
      storedTitle: "Jackson #38",
      inputsAfter: withShort(SHORT),
      oldShortName: undefined,
      newShortName: SHORT,
    });
    expect(out).toMatchObject({ kind: "generated", title: assessListingTitle(withShort(SHORT)).title });
  });
});

describe("retitleForSetName — any other hand edit", () => {
  test("a title that shows nothing left out is left exactly as typed", () => {
    const stored = `${titleDescription(LONG)} Bo Jackson #38 RC Kansas City Royals MINT`;
    expect(leftOutOfTitle(LONG, stored)).toEqual([]);
    expect(titleShowsLeftOut(LONG, stored)).toBe(false);
    const out = retitleForSetName({
      storedTitle: stored,
      inputsAfter: withShort(SHORT),
      oldShortName: undefined,
      newShortName: SHORT,
    });
    expect(out).toEqual({ kind: "leave" });
  });

  test("a hand edit is never mistaken for generated by being close to it", () => {
    const generated = assessListingTitle(LONG).title;
    const out = retitleForSetName({
      storedTitle: `${generated}!`,
      inputsAfter: withShort(SHORT),
      oldShortName: undefined,
      newShortName: SHORT,
    });
    // Not the generated title, so it is treated as a hand edit: either left or
    // swapped, never silently rebuilt over the extra character.
    expect(out.kind === "generated" && out.title === generated).toBe(false);
  });
});

describe("swapSetNameInTitle", () => {
  test("is case-insensitive and keeps the rest of the words", () => {
    expect(swapSetNameInTitle("ud holo Bo Jackson", "UD Holo", "Topps Chrome")).toBe(
      "Topps Chrome Bo Jackson",
    );
  });

  test("matches whole words only: Score is not found inside Scorecard", () => {
    expect(swapSetNameInTitle("Scorecard Bo", "Score", "X")).toBeUndefined();
  });

  test("two copies with none at the start is a guess, so it is refused", () => {
    expect(swapSetNameInTitle("a Score b Score", "Score", "X")).toBeUndefined();
  });

  test("the copy at the start wins over a later one", () => {
    expect(swapSetNameInTitle("Score Scorecard Score", "Score", "X")).toBe("X Scorecard Score");
  });

  test("a blank old name finds nothing", () => {
    expect(swapSetNameInTitle("anything", "  ", "X")).toBeUndefined();
  });

  test("the swapped title is one line", () => {
    expect(oneLine(swapSetNameInTitle("Old\nBo", "Old", "New\n\nName")!)).not.toMatch(/[\r\n]/);
  });
});
