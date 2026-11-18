/**
 * NEO-527 (Jason, 2026-11-12: "a user should never see unknown outside of the
 * admin screen") — a dashboard card's title and its set's heading never name
 * the year's brand-unknown row. The row is told by its flag (`brandUnknown`,
 * from the server's `manufacturerBrandUnknown`), never by its name: here it is
 * still called "Unknown" so a leak would show, and a real brand that happens
 * to carry that name is still named.
 */

import { describe, expect, test } from "vitest";
import type { Card, SetRef } from "@/app/collection/final/data/types";
import { dashSetLabel, setRefLabel, toDash } from "./dash-card";

const set = (extra: Partial<SetRef> = {}): SetRef => ({
  id: "set-1" as SetRef["id"],
  name: "Bowman",
  season: "2026",
  year: 2026,
  brand: { id: "brand-1", name: "Unknown" },
  sport: { id: "sport-1", name: "Football" },
  ...extra,
});

const card = (s: SetRef): Card => ({
  id: "card-1" as Card["id"],
  set: s,
  variant: {
    id: "variant-1" as Card["variant"]["id"],
    kind: "base",
    name: null,
    insertName: null,
    printRun: null,
    order: 0,
    path: { typeId: "variant-1", variantId: null, subVariantId: null },
    finish: { kind: "standard" },
  } as Card["variant"],
  cardNumber: "87",
  players: [{ id: "p-1", name: "Brock Purdy" }] as Card["players"],
  teams: [],
  printRun: null,
  features: [],
  cardVariation: null,
  isVariation: false,
  sortOrder: 0,
  finish: { kind: "standard" } as Card["finish"],
});

describe("NEO-527 — the brand-unknown row is never in a dashboard title or heading", () => {
  test("toDash's title and set label leave the flagged brand out", () => {
    const dash = toDash(card(set({ brandUnknown: true })));
    expect(dash.title).toMatch(/^2026 Bowman Brock Purdy #87/);
    expect(dash.title).not.toMatch(/unknown/i);
    expect(dash.setLabel).toBe("2026 Bowman");
  });

  test("a real brand is still named, whatever it is called", () => {
    const real = toDash(card(set({ brand: { id: "brand-2", name: "Topps" }, name: "Chrome" })));
    expect(real.title).toMatch(/^2026 Topps Chrome /);
    expect(real.setLabel).toBe("2026 Topps Chrome");
    // Only the flag hides a brand: a real brand named "Unknown" is a brand.
    expect(toDash(card(set())).setLabel).toBe("2026 Unknown Bowman");
  });

  test("dashSetLabel and setRefLabel take the flag", () => {
    expect(dashSetLabel({ season: "2026", name: "Bowman Chrome", brand: "Unknown", brandUnknown: true })).toBe(
      "2026 Bowman Chrome",
    );
    expect(dashSetLabel({ season: "1993", name: "Finest", brand: "Topps" })).toBe("1993 Topps Finest");
    expect(setRefLabel(set({ brandUnknown: true }))).toBe("2026 Bowman");
  });
});

describe("NEO-606 — a dashboard title that must lose its teams gives up the location first", () => {
  /** A set name that makes "2026 <name> Brock Purdy #87" exactly `length` characters. */
  const titled = (length: number, teams: Card["teams"]): Card => ({
    ...card(set({ brandUnknown: true, name: "Q".repeat(length - 21) })),
    teams,
  });
  const yankees = { id: "t-1" as Card["teams"][number]["id"], name: "Yankees", location: "New York" };
  const licey = { id: "t-2" as Card["teams"][number]["id"], name: "Tigres del Licey", location: "" };

  test("a title that fits names the whole team", () => {
    expect(toDash(titled(40, [yankees])).title).toContain("#87 New York Yankees");
  });

  test("over the limit the team renders as its nickname, not dropped and not whole", () => {
    // 66 + " New York Yankees" is 83; the nickname alone makes 74.
    const dash = toDash(titled(66, [yankees]));
    expect(dash.title.endsWith("#87 Yankees")).toBe(true);
    expect(dash.title).not.toContain("New York");
    expect(dash.title.length).toBeLessThanOrEqual(80);
  });

  test("a team with no location is dropped whole while the split one keeps its nickname", () => {
    const dash = toDash(titled(66, [yankees, licey]));
    expect(dash.title.endsWith("#87 Yankees")).toBe(true);
    expect(dash.title).not.toContain("Licey");
  });
});
