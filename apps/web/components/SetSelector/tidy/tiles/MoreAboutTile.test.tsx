/**
 * NEO-645 callout 8 — "More about this card": collapsed by default, the
 * side panel's own fields once opened, and none of the sections that have a
 * tile of their own.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../../convex/_generated/api", () => ({
  api: {
    players: { getManyByIds: "players.getManyByIds" },
    selectorOptions: {
      updateCard: "updateCard",
      setCardFeature: "setCardFeature",
      setCardVariationParent: "setCardVariationParent",
      getCardChecklist: "getCardChecklist",
      getAncestorChain: "getAncestorChain",
      getCrossListingsForCard: "getCrossListingsForCard",
      removeCrossListing: "removeCrossListing",
      previewListingTitle: "previewListingTitle",
    },
    cardSecondaryPlayers: { setSecondaryPlayers: "cardSecondaryPlayers.setSecondaryPlayers" },
  },
}));
vi.mock("convex/react", () => ({
  useConvex: () => ({ mutation: vi.fn() }),
  useMutation: () => vi.fn(),
  useQuery: (ref: string) =>
    ref === "getAncestorChain"
      ? [
          { level: "sport", value: "Baseball" },
          { level: "year", value: "2024" },
        ]
      : undefined,
}));
vi.mock("../../CardLeagueRow", () => ({ default: () => <div aria-label="Card league row (stub)" /> }));
vi.mock("../../TeamPicker", () => ({ default: () => <div aria-label="Team picker (stub)" /> }));
// The one labelled picker is "Also pictured", which stays in More about this card.
vi.mock("../../PlayerPicker", () => ({
  default: ({ labels }: { labels?: { root: string } }) => (
    <div aria-label={labels ? `${labels.root} (stub)` : "Player picker (stub)"} />
  ),
}));

import MoreAboutTile from "./MoreAboutTile";
import type { TidyRow, TidyTileProps } from "../tile-types";

const row = {
  _id: "c1",
  cardNumber: "42",
  cardName: "Mike Trout",
  attributes: ["RC"],
  platformData: {},
} as unknown as TidyRow;

const props: TidyTileProps = {
  row,
  context: undefined,
  attention: { level: "none", items: [] },
  leafId: "leaf-1" as never,
  sportId: undefined,
  leafCards: [row],
  setName: "Set",
};

describe("MoreAboutTile", () => {
  it("is collapsed by default: no fields are mounted", () => {
    render(<MoreAboutTile {...props} />);
    expect(screen.getByRole("region", { name: "More about this card" })).toBeTruthy();
    const toggle = screen.getByRole("button", { name: "Show fields" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByLabelText("Card name")).toBeNull();
  });

  it("opens the leftover fields, and none that have a tile of their own", () => {
    render(<MoreAboutTile {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Show fields" }));
    expect(screen.getByRole("button", { name: "Hide fields" }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByLabelText("Card name")).toBeTruthy();
    expect(screen.getByLabelText("Print run")).toBeTruthy();
    expect(screen.getByLabelText("Card league row (stub)")).toBeTruthy();
    expect(screen.queryByLabelText("Team picker (stub)")).toBeNull();
    expect(screen.queryByLabelText("Player picker (stub)")).toBeNull();
    expect(screen.queryByLabelText("Card title")).toBeNull();
  });

  it("collapses again", () => {
    render(<MoreAboutTile {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Show fields" }));
    fireEvent.click(screen.getByRole("button", { name: "Hide fields" }));
    expect(screen.queryByLabelText("Card name")).toBeNull();
  });
});
