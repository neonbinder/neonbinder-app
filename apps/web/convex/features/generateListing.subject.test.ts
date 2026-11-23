/**
 * NEO-645 — a card named for something that is not a player, with a cameo.
 *
 * Jason, 2026-11-22: "the title generation should use the name and then the
 * cameo if it fits". 2026 Topps Base #118 is named "Hopping to It CPC" (not a
 * player) and pictures Ronald Acuña Jr.; its title says the name where a
 * player's would go, the cameo after it, and never "Base" in the name's place.
 */
import { describe, expect, test } from "vitest";
import {
  assessListingTitle,
  leftOutOfTitle,
  type ListingCardInputs,
} from "./generateListing";

const NAME = "Hopping to It CPC";
const CAMEO = "Ronald Acuña Jr.";

const hopping: ListingCardInputs = {
  year: "2026",
  manufacturer: "Topps",
  setName: "Topps",
  titleLevels: [{ name: "Base", base: true }],
  cardNumber: "118",
  playerNames: [],
  cameoNames: [CAMEO],
  subjectName: NAME,
  teamNames: ["Atlanta Braves"],
  sport: "Baseball",
};

describe("a non-player card with a cameo", () => {
  test("the name, then the cameo, and no Base", () => {
    const a = assessListingTitle(hopping);
    expect(a.title).toBe("2026 Topps Hopping to It CPC Ronald Acuña Jr. #118 Atlanta Braves Baseball");
    expect(a.fits).toBe(true);
    expect(a.dropped).toEqual([]);
  });

  test("a Base type name leaves too, not only a Base level", () => {
    const a = assessListingTitle({
      ...hopping,
      titleLevels: [{ name: "Gold", typeName: "Base" }],
    });
    expect(a.title).toBe("2026 Topps Gold Hopping to It CPC Ronald Acuña Jr. #118 Atlanta Braves Baseball");
  });

  test("over the cap the cameo goes first, the name stays, and the note names the cameo", () => {
    const long: ListingCardInputs = {
      ...hopping,
      teamNames: ["Atlanta Braves Spring Training Squad"],
    };
    const a = assessListingTitle(long);
    expect(`${hopping.year} ${NAME} ${CAMEO}`.length).toBeLessThan(80);
    // Without the cameo it fits; with it the full title is over 80.
    expect(assessListingTitle({ ...long, cameoNames: [] , subjectName: undefined }).title.length)
      .toBeLessThanOrEqual(80);
    expect(a.title).not.toContain("Acuña");
    expect(a.title).toContain(NAME);
    expect(a.title).toContain("Atlanta Braves Spring Training Squad");
    expect(a.title.length).toBeLessThanOrEqual(80);
    expect(a.dropped).toEqual([CAMEO]);
    expect(leftOutOfTitle(long, a.title)).toEqual([CAMEO]);
  });

  test("the name is never shortened like a first name", () => {
    const a = assessListingTitle({
      ...hopping,
      teamNames: ["Atlanta Braves Spring Training Squad Of Many Words"],
      setName: "Topps Chrome Update Series",
    });
    expect(a.title).toContain(NAME);
  });

  test("a name the cameo shares is said once, and with no other cameo the card is a plain one", () => {
    const a = assessListingTitle({ ...hopping, subjectName: CAMEO });
    expect(a.title).toBe("2026 Topps Base Ronald Acuña Jr. #118 Atlanta Braves Baseball");
  });
});

describe("every other card is as it was", () => {
  test("a non-player name with no cameo says Base and no name", () => {
    const a = assessListingTitle({ ...hopping, cameoNames: [] });
    expect(a.title).toBe("2026 Topps Base #118 Atlanta Braves Baseball");
  });

  test("a card with a player ignores the name", () => {
    const a = assessListingTitle({ ...hopping, playerNames: [CAMEO], cameoNames: ["Mike Trout"], subjectName: NAME });
    expect(a.title).toBe("2026 Topps Base Ronald Acuña Jr. & Mike Trout #118 Atlanta Braves Baseball");
  });

  test("no subject name: the same as before", () => {
    const a = assessListingTitle({ ...hopping, subjectName: undefined });
    expect(a.title).toBe("2026 Topps Base Ronald Acuña Jr. #118 Atlanta Braves Baseball");
  });

  test("a team that is the subject's own name is not said twice", () => {
    const a = assessListingTitle({
      year: "2026",
      manufacturer: "Topps",
      setName: "Topps",
      titleLevels: [{ name: "Base", base: true }],
      cardNumber: "198",
      playerNames: [],
      cameoNames: ["Ceddanne Rafaela"],
      subjectName: "Boston Red Sox",
      teamNames: ["Boston Red Sox"],
      sport: "Baseball",
    });
    expect(a.title).toBe("2026 Topps Boston Red Sox Ceddanne Rafaela #198 Baseball");
  });

  test("a team that differs from the subject's name is kept", () => {
    const a = assessListingTitle({
      ...hopping,
      subjectName: "Boston Red Sox",
      cameoNames: ["Ceddanne Rafaela"],
      cardNumber: "198",
      teamNames: ["Atlanta Braves"],
    });
    expect(a.title).toBe(
      "2026 Topps Boston Red Sox Ceddanne Rafaela #198 Atlanta Braves Baseball",
    );
  });
});
