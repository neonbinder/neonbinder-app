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
  truncatedAfterSetName,
  withoutWaitingNames,
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

// ── NEO-645 follow-ups, one fixture: 1996 Score, a long insert, no rookie flag ──
const SCORE: ListingCardInputs = {
  cardNumber: "3",
  playerNames: ["Ryan Klesko"],
  teamNames: ["Atlanta Braves"],
  year: "1996",
  manufacturer: "Score",
  setName: "Score",
  insertName: "Dugout Collection Artists Proofs Hologram Foil Series II",
  sport: "Baseball",
};
const BOX = "1996 Score Dugout Collection Artists Proofs";

describe("a hand edit that lost only the card's own words still shows the line", () => {
  // Typed "Klesko #3" after the description: "Ryan" and the team are out. They
  // are the card's own words, and they are what the "Left out to fit" line lists.
  const typed = `${titleDescription(SCORE)} Klesko #3`;

  test("the title shows the line though every missing entry is a player or team word", () => {
    expect(leftOutOfTitle(SCORE, typed)).toEqual(["Atlanta Braves", "Ryan"]);
    expect(titleShowsLeftOut(SCORE, typed)).toBe(true);
  });

  test("the new set name is swapped in for the description and 'Klesko #3' is kept", () => {
    const out = retitleForSetName({
      storedTitle: typed,
      inputsAfter: { ...SCORE, setShortName: BOX },
      oldShortName: undefined,
      newShortName: BOX,
    });
    expect(out).toEqual({ kind: "swapped", title: `${BOX} Klesko #3` });
  });

  test("a second box edit swaps the first box's text for the second, 'Klesko #3' still kept", () => {
    const next = "1996 Score Dugout Collection";
    const out = retitleForSetName({
      storedTitle: `${BOX} Klesko #3`,
      inputsAfter: { ...SCORE, setShortName: next },
      oldShortName: BOX,
      newShortName: next,
    });
    expect(out).toEqual({ kind: "swapped", title: `${next} Klesko #3` });
  });

  test("a title with every word back, the team before the number, is left exactly as typed", () => {
    const own = `${BOX} Ryan Klesko Atlanta Braves #3`;
    expect(titleShowsLeftOut({ ...SCORE, setShortName: BOX }, own)).toBe(false);
    const out = retitleForSetName({
      storedTitle: own,
      inputsAfter: { ...SCORE, setShortName: "1996 Score Dugout Collection" },
      oldShortName: BOX,
      newShortName: "1996 Score Dugout Collection",
    });
    expect(out).toEqual({ kind: "leave" });
  });

  test("an over-length variation is not a line on its own (it has its own field)", () => {
    const longVariation = "V".repeat(70);
    const inputs = { ...SCORE, setShortName: BOX, cardVariation: longVariation };
    const stored = `${BOX} Ryan Klesko Atlanta Braves #3`;
    expect(titleShowsLeftOut(inputs, stored)).toBe(false);
  });
});

describe("a name still waiting for an answer is not left out", () => {
  const waiting: ListingCardInputs = { ...SCORE, playerNames: ["Dave Stewart"] };

  test("withoutWaitingNames drops a waiting player and a waiting team, case-insensitively", () => {
    const inputs: ListingCardInputs = { ...SCORE, playerNames: ["Dave Stewart", "Bo Jackson"], teamNames: ["Oakland Athletics"] };
    expect(withoutWaitingNames(inputs, [" dave stewart ", "OAKLAND ATHLETICS"])).toMatchObject({
      playerNames: ["Bo Jackson"],
      teamNames: [],
    });
    expect(withoutWaitingNames(inputs, undefined)).toBe(inputs);
    expect(withoutWaitingNames(inputs, [])).toBe(inputs);
  });

  test("a hand edit that omits only the waiting name is left as typed", () => {
    const typed = `${BOX} #3 Atlanta Braves My Own Words`;
    expect(titleShowsLeftOut({ ...waiting, setShortName: BOX }, typed)).toBe(true);
    const out = retitleForSetName({
      storedTitle: typed,
      inputsAfter: { ...waiting, setShortName: "1996 Score Dugout Collection" },
      oldShortName: BOX,
      newShortName: "1996 Score Dugout Collection",
      waitingNames: ["Dave Stewart"],
    });
    expect(out).toEqual({ kind: "leave" });
  });

  test("the title the commit generated (without the waiting name) is rebuilt without it", () => {
    const before: ListingCardInputs = { ...waiting, playerNames: [], setShortName: BOX };
    const stored = assessListingTitle(before).title;
    const out = retitleForSetName({
      storedTitle: stored,
      inputsAfter: { ...waiting, setShortName: "1996 Score Dugout Collection" },
      oldShortName: BOX,
      newShortName: "1996 Score Dugout Collection",
      waitingNames: ["Dave Stewart"],
    });
    expect(out.kind).toBe("generated");
    if (out.kind === "generated") expect(out.title).not.toContain("Stewart");
  });
});

describe("a rebuilt title is flagged only when something is left to check", () => {
  const daulton: ListingCardInputs = {
    cardNumber: "12",
    playerNames: ["Darren Daulton"],
    teamNames: ["Philadelphia Phillies"],
    teamSplits: [{ location: "Philadelphia", name: "Phillies" }],
    year: "1996",
    manufacturer: "Score",
    setName: "Score",
    insertName: "Dugout Collection Artists Proofs Hologram Foil Series II",
    sport: "Baseball",
  };

  test("the box brings the first name back and the team fits as its nickname: nothing to check", () => {
    const before = assessListingTitle(daulton);
    expect(before.dropped).toEqual(["Philadelphia Phillies", "Darren"]);
    const out = retitleForSetName({
      storedTitle: before.title,
      inputsAfter: { ...daulton, setShortName: BOX },
      oldShortName: undefined,
      newShortName: BOX,
    });
    expect(out).toMatchObject({
      kind: "generated",
      title: "1996 Score Dugout Collection Artists Proofs Darren Daulton #12 Phillies Baseball",
    });
    // The first build marks a box-built title as one to review; a set-name save
    // that rebuilt it and left nothing out must not add a check with no line.
    expect(assessListingTitle({ ...daulton, setShortName: BOX }).coreFits).toBe(false);
    expect((out as { truncated: true | undefined }).truncated).toBeUndefined();
  });

  test("a title that still leaves something out is flagged", () => {
    const tight = { ...daulton, setShortName: "1996 Score Dugout Collection Artists Proofs Hologram Foil Series II Extra" };
    const after = assessListingTitle(tight);
    expect(after.dropped.length > 0 || after.tidyUp).toBe(true);
    expect(truncatedAfterSetName(after)).toBe(true);
  });

  test("a title that fits whole is not flagged, however it was built", () => {
    expect(truncatedAfterSetName({ coreFits: true, tidyUp: false, dropped: [] })).toBeUndefined();
    expect(truncatedAfterSetName({ coreFits: false, tidyUp: false, dropped: [] })).toBeUndefined();
    expect(truncatedAfterSetName({ coreFits: false, tidyUp: true, dropped: [] })).toBe(true);
    expect(truncatedAfterSetName({ coreFits: false, tidyUp: false, dropped: ["Atlanta Braves"] })).toBe(true);
  });
});
