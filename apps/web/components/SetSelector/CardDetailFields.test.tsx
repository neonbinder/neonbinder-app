/**
 * NEO-645 — `CardDetailFields`, extracted from `CardDetailPanel`.
 *
 * The side panel must render EVERY section exactly as before; the Tidy Up
 * "More about this card" tile renders the rest (everything it does not promote
 * to a tile of its own). This pins both halves: the panel's full set, and the
 * subset split between the tiles and the leftover.
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../convex/_generated/api", () => ({
  api: {
    players: { getManyByIds: "players.getManyByIds" },
    selectorOptions: {
      updateCard: "updateCard",
      setCardFeature: "setCardFeature",
      setCardVariationParent: "setCardVariationParent",
      getCardChecklist: "getCardChecklist",
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
  useQuery: (ref: string) => (ref === "getCrossListingsForCard" ? [{ _id: "x1", setLabel: "2024 Guest Set" }] : undefined),
}));

vi.mock("./CardLeagueRow", () => ({ default: () => <div aria-label="Card league row (stub)" /> }));
vi.mock("./TeamPicker", () => ({ default: () => <div aria-label="Team picker (stub)" /> }));
vi.mock("./PlayerPicker", () => ({
  default: ({ labels }: { labels?: { root: string } }) => (
    <div aria-label={labels ? `${labels.root} (stub)` : "Player picker (stub)"} />
  ),
}));

import CardDetailPanel from "./CardDetailPanel";
import {
  ALL_CARD_DETAIL_SECTIONS,
  CardDetailFields,
  MORE_ABOUT_SECTIONS,
  useFieldToast,
  type CardDetailCard,
  type CardDetailSection,
} from "./CardDetailFields";
import type { Id } from "../../convex/_generated/dataModel";

const card: CardDetailCard = {
  _id: "card-1" as unknown as Id<"cardChecklist">,
  selectorOptionId: "leaf-1" as unknown as Id<"selectorOptions">,
  cardNumber: "42",
  cardName: "Mike Trout",
  playerIds: [],
  teamOnCardIds: [],
  attributes: ["RC"],
  platformData: {},
  features: {},
};
const chain = [
  { level: "sport", value: "Baseball" },
  { level: "year", value: "2024" },
];

function Host({ sections }: { sections: readonly CardDetailSection[] }) {
  const status = useFieldToast();
  return <CardDetailFields card={card} ancestorChain={chain} sections={sections} status={status} />;
}

/** Every section's own control or caption, by what a person perceives. */
const PROBES: Record<CardDetailSection, () => HTMLElement | null> = {
  name: () => screen.queryByLabelText("Card name"),
  teams: () => screen.queryByLabelText("Team picker (stub)"),
  league: () => screen.queryByLabelText("Card league row (stub)"),
  features: () => screen.queryByText(/features/i),
  title: () => screen.queryByLabelText("Card title"),
  description: () => screen.queryByLabelText("Card description"),
  notes: () => screen.queryByLabelText("Card notes"),
  attributes: () => screen.queryByRole("group", { name: "Card attributes" }),
  printRun: () => screen.queryByLabelText("Print run"),
  variation: () => screen.queryByLabelText("Card variation"),
  variationOf: () => screen.queryByLabelText("Card number this one is a variation of"),
  players: () => screen.queryByLabelText("Player picker (stub)"),
  alsoPictured: () => screen.queryByText(/also on this card/i),
  inherited: () => screen.queryByText("Inherited from set"),
  crossListings: () => screen.queryByText("Also appears in"),
  images: () => screen.queryByText("No image yet"),
};

beforeEach(() => vi.clearAllMocks());

describe("CardDetailFields sections (NEO-645)", () => {
  it("renders every section when given all of them", () => {
    render(<Host sections={ALL_CARD_DETAIL_SECTIONS} />);
    for (const id of ALL_CARD_DETAIL_SECTIONS) {
      expect(PROBES[id](), `section ${id}`).not.toBeNull();
    }
  });

  it("renders only the named sections", () => {
    render(<Host sections={["name", "notes"]} />);
    expect(PROBES.name()).not.toBeNull();
    expect(PROBES.notes()).not.toBeNull();
    for (const id of ALL_CARD_DETAIL_SECTIONS.filter((s) => s !== "name" && s !== "notes")) {
      expect(PROBES[id](), `section ${id}`).toBeNull();
    }
  });

  it("More about this card holds exactly what the tiles do not: no players, teams or title", () => {
    render(<Host sections={MORE_ABOUT_SECTIONS} />);
    for (const id of ["players", "teams", "title", "images"] as const) {
      expect(MORE_ABOUT_SECTIONS).not.toContain(id);
      expect(PROBES[id](), `section ${id}`).toBeNull();
    }
    for (const id of MORE_ABOUT_SECTIONS) {
      expect(PROBES[id](), `section ${id}`).not.toBeNull();
    }
  });

  it("the tiles' sections and the leftover together are the whole panel", () => {
    const tiled: CardDetailSection[] = ["players", "teams", "title", "images"];
    expect([...MORE_ABOUT_SECTIONS, ...tiled].sort()).toEqual([...ALL_CARD_DETAIL_SECTIONS].sort());
  });
});

describe("CardDetailPanel still renders every section (NEO-645 regression)", () => {
  it("shows all sections plus its own chrome", () => {
    render(
      <CardDetailPanel
        card={card}
        ancestorChain={chain}
        ancestorSport="Baseball"
        onClose={vi.fn()}
        onPrev={vi.fn()}
        onNext={vi.fn()}
        hasPrev={false}
        hasNext={false}
      />,
    );
    for (const id of ALL_CARD_DETAIL_SECTIONS) {
      expect(PROBES[id](), `section ${id}`).not.toBeNull();
    }
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Done editing card" })).toBeTruthy();
    expect(screen.getByLabelText("Previous card")).toBeTruthy();
  });
});
