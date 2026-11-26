/** NEO-676 — the pure guards and constants the new storage fields share. */
import { describe, expect, test } from "vitest";
import { isMlbamId } from "./mlbamId";
import { assertBirthDate, isBirthDate } from "./birthDate";
import {
  MINOR_LEAGUE_CLASSES,
  MINOR_LEAGUE_CLASS_LABELS,
} from "./leagueClass";
import { MAX_PARENT_CLUBS } from "./parentClubs";
import { maxBirthYear } from "../../lib/players/career-years";

describe("isMlbamId", () => {
  test("accepts a positive safe integer", () => {
    expect(isMlbamId(1)).toBe(true);
    expect(isMlbamId(665742)).toBe(true);
    expect(isMlbamId(Number.MAX_SAFE_INTEGER)).toBe(true);
  });
  test("refuses everything else", () => {
    for (const bad of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "665742", null, undefined, {}]) {
      expect(isMlbamId(bad)).toBe(false);
    }
  });
});

describe("isBirthDate / assertBirthDate", () => {
  test("accepts a real calendar date inside the birth-year bounds", () => {
    expect(isBirthDate("1941-04-14")).toBe(true);
    expect(isBirthDate("1850-01-01")).toBe(true);
    expect(isBirthDate("2000-02-29")).toBe(true);
    expect(isBirthDate(`${maxBirthYear()}-01-01`)).toBe(true);
    expect(() => assertBirthDate("1941-04-14")).not.toThrow();
  });
  test("refuses a date that is not real, not ISO, or out of bounds", () => {
    for (const bad of [
      "2001-02-29",
      "1941-13-01",
      "1941-04-31",
      "1941-4-14",
      "1941/04/14",
      "1941-04-14T00:00:00Z",
      "1849-12-31",
      `${maxBirthYear() + 1}-01-01`,
      "",
      "nope",
      1941,
      null,
    ]) {
      expect(isBirthDate(bad)).toBe(false);
    }
    expect(() => assertBirthDate("2001-02-29")).toThrow(/birth date/i);
  });
});

describe("minor-league classes", () => {
  test("every class has a display label, and the labels are the ones Jason named", () => {
    expect(Object.keys(MINOR_LEAGUE_CLASS_LABELS).sort()).toEqual([...MINOR_LEAGUE_CLASSES].sort());
    expect(MINOR_LEAGUE_CLASS_LABELS).toEqual({
      aaa: "AAA",
      aa: "AA",
      "high-a": "High-A",
      "single-a": "Single-A",
      "short-season-a": "Short-Season A",
      "rookie-advanced": "Rookie Advanced",
      rookie: "Rookie",
    });
  });
});

describe("parent clubs", () => {
  test("the cap is 64", () => {
    expect(MAX_PARENT_CLUBS).toBe(64);
  });
});
