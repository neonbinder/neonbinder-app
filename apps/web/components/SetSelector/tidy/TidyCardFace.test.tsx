/**
 * NEO-645 — the drawn card at the top of the walk: display only, drawn from
 * the row until `cardContext` lands, then from its names.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import TidyCardFace from "./TidyCardFace";
import type { TidyCardContext, TidyRow } from "./tile-types";

const row = {
  _id: "card-1",
  cardNumber: "38b",
  cardName: "Mike Trout",
  attributes: ["RC", "AU"],
  printRun: 99,
} as unknown as TidyRow;

const context = {
  cardId: "card-1",
  names: [],
  players: [{ playerId: "p1", name: "Michael Trout", stints: [], stintsMore: false, sportId: "s1" }],
  playersMore: false,
  teams: [{ teamId: "t1", name: "Los Angeles Angels", onCard: true, candidate: false }],
  linkedFor: [],
} as unknown as TidyCardContext;

describe("TidyCardFace", () => {
  it("draws from the row alone while the context loads", () => {
    render(<TidyCardFace row={row} context={undefined} />);
    expect(screen.getByRole("img").getAttribute("aria-label")).toContain("Mike Trout");
  });

  it("names the card's linked player and team once the context is here", () => {
    render(<TidyCardFace row={row} context={context} />);
    const label = screen.getByRole("img").getAttribute("aria-label") ?? "";
    expect(label).toContain("Michael Trout");
    expect(label).toContain("38b");
  });

  it("draws nothing to click: no controls, no upload", () => {
    render(<TidyCardFace row={row} context={context} />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(document.querySelector("input[type=file]")).toBeNull();
  });
});
