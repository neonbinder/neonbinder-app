/**
 * NEO-645 — the drawn card at the top of the walk: display only, drawn from
 * the row until `cardContext` lands, then from its names.
 */
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TidyCardFace, { SHORT_VIEWPORT } from "./TidyCardFace";
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

describe("TidyCardFace size", () => {
  afterEach(() => vi.unstubAllGlobals());

  const stubShort = (short: boolean) => {
    const asked: string[] = [];
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => {
        asked.push(query);
        return {
          matches: short && query === SHORT_VIEWPORT,
          media: query,
          addEventListener: () => {},
          removeEventListener: () => {},
        };
      }),
    );
    return asked;
  };

  const faceWidth = () => (screen.getByRole("img") as HTMLElement).style.width;

  it("draws the medium card on a tall window", () => {
    stubShort(false);
    render(<TidyCardFace row={row} context={context} />);
    expect(faceWidth()).toBe("9rem");
  });

  it("draws the small card when the window is short, so the tiles get the room", () => {
    const asked = stubShort(true);
    render(<TidyCardFace row={row} context={context} />);
    expect(faceWidth()).toBe("5.5rem");
    expect(asked).toContain("(max-height: 720px)");
  });

  it("draws the medium card where there is no matchMedia to ask", () => {
    vi.stubGlobal("matchMedia", undefined);
    render(<TidyCardFace row={row} context={context} />);
    expect(faceWidth()).toBe("9rem");
  });
});

