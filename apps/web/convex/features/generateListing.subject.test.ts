/**
 * NEO-645 — a card's own name is in its title.
 *
 * Jason, 2026-11-22: "the title generation should use the name and then the
 * cameo if it fits". 2026 Topps Base #118 is named "Hopping to It CPC" (not a
 * player) and pictures Ronald Acuña Jr.; its title says the name where a
 * player's would go, the cameo after it, and never "Base" in the name's place.
 *
 * Jason, 2026-11-23: "Whatever name we put on a card should always show up,
 * whether that is checklist, Team Card, Boston Red Sox or just cool card. If
 * there is a name we include it in title." So no cameo is needed, a player card
 * with a name of its own shows it, and only a placeholder or a name that merely
 * repeats the players adds nothing. Never said twice: a team the name already
 * says is not added.
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
  test("a placeholder name says Base and no name", () => {
    expect(assessListingTitle({ ...hopping, cameoNames: [], subjectName: "Card #118" }).title).toBe(
      "2026 Topps Base #118 Atlanta Braves Baseball",
    );
    expect(assessListingTitle({ ...hopping, cameoNames: [], subjectName: "Card #NNO" }).title).toBe(
      "2026 Topps Base #118 Atlanta Braves Baseball",
    );
    expect(assessListingTitle({ ...hopping, cameoNames: [], subjectName: "  " }).title).toBe(
      "2026 Topps Base #118 Atlanta Braves Baseball",
    );
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

describe("a name is in the title whether or not the card has a cameo (Jason, 2026-11-23)", () => {
  const card: ListingCardInputs = {
    year: "2026",
    manufacturer: "Topps",
    setName: "Topps",
    titleLevels: [{ name: "Base", base: true }],
    cardNumber: "1",
    playerNames: [],
    teamNames: [],
    sport: "Baseball",
  };

  test("Checklist, with no team", () => {
    expect(assessListingTitle({ ...card, subjectName: "Checklist" }).title).toBe(
      "2026 Topps Checklist #1 Baseball",
    );
  });

  test("Team Card, with a team", () => {
    expect(
      assessListingTitle({
        ...card,
        subjectName: "Team Card",
        teamNames: ["Kansas City Royals"],
      }).title,
    ).toBe("2026 Topps Team Card #1 Kansas City Royals Baseball");
  });

  test("'Kansas City Royals' with the Royals team says the team once", () => {
    expect(
      assessListingTitle({
        ...card,
        subjectName: "Kansas City Royals",
        teamNames: ["Kansas City Royals"],
      }).title,
    ).toBe("2026 Topps Kansas City Royals #1 Baseball");
  });

  test("'Royals Team Card' with the Royals team: the name already says the team, so it is not added", () => {
    const a = assessListingTitle({
      ...card,
      subjectName: "Royals Team Card",
      teamNames: ["Kansas City Royals"],
    });
    expect(a.title).toBe("2026 Topps Royals Team Card #1 Baseball");
    expect(a.dropped).toEqual([]);
  });

  test("the nickname of a split team counts the same way", () => {
    expect(
      assessListingTitle({
        ...card,
        subjectName: "Red Sox Team Card",
        teamNames: ["Boston Red Sox"],
        teamSplits: [{ location: "Boston", name: "Red Sox" }],
      }).title,
    ).toBe("2026 Topps Red Sox Team Card #1 Baseball");
  });

  test("a place that is not the team's nickname does not hide the team", () => {
    expect(
      assessListingTitle({
        ...card,
        subjectName: "Kansas City Team Card",
        teamNames: ["Kansas City Royals"],
      }).title,
    ).toBe("2026 Topps Kansas City Team Card #1 Kansas City Royals Baseball");
  });

  test("a player card named for its player is as it always was", () => {
    const withPlayer = { ...card, playerNames: ["Mike Trout"], teamNames: ["Los Angeles Angels"] };
    const plain = assessListingTitle(withPlayer).title;
    expect(plain).toBe("2026 Topps Base Mike Trout #1 Los Angeles Angels Baseball");
    expect(assessListingTitle({ ...withPlayer, subjectName: "Mike Trout" }).title).toBe(plain);
    // The last name alone, or the name beside other words of the player's own.
    expect(assessListingTitle({ ...withPlayer, subjectName: "Trout" }).title).toBe(plain);
  });

  test("a player card with a name of its own shows it ahead of the player", () => {
    expect(
      assessListingTitle({
        ...card,
        playerNames: ["Mike Trout"],
        subjectName: "It Takes Two CPC",
      }).title,
    ).toBe("2026 Topps It Takes Two CPC Mike Trout #1 Baseball");
  });

  test("a name that already contains the player adds nothing", () => {
    const withPlayer = { ...card, playerNames: ["Kyle Schwarber", "Pete Alonso"] };
    const plain = assessListingTitle(withPlayer).title;
    expect(
      assessListingTitle({
        ...withPlayer,
        subjectName: "National League Leaders RBI (Kyle Schwarber / Pete Alonso)",
      }).title,
    ).toBe(plain);
  });

  test("a placeholder says no name, with or without a team", () => {
    expect(
      assessListingTitle({ ...card, subjectName: "Card #1", teamNames: ["Kansas City Royals"] }).title,
    ).toBe("2026 Topps Base #1 Kansas City Royals Baseball");
  });

  test("the name is never cut: over the cap the team goes before it", () => {
    const a = assessListingTitle({
      ...card,
      setName: "Topps Chrome Update Series Sapphire Edition",
      subjectName: "Checklist",
      teamNames: ["Kansas City Royals"],
    });
    expect(a.title).toContain("Checklist");
    expect(a.title.length).toBeLessThanOrEqual(80);
  });
});
