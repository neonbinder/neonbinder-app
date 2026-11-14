/**
 * NEO-535 — the checklist's "Fix card titles" door: on a PARALLEL's checklist
 * it sits beside the "N need you" pill while any loaded card's stored title
 * still fails (over 80, or flagged cut short), off the subscription the
 * checklist already holds. Never on a base or insert checklist.
 *
 * The door and dialog are covered in ParallelTitlesDialog.test.tsx; the
 * Convex surface and heavy children are stubbed as in
 * CardChecklist.needsYou.test.tsx.
 */

import { render, screen } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";

vi.mock("../../convex/_generated/api", () => ({
  api: {
    selectorOptions: {
      getCardChecklist: "getCardChecklist",
      getSelectorOptionById: "getSelectorOptionById",
      getAncestorChain: "getAncestorChain",
      fetchCardChecklist: "fetchCardChecklist",
      diffChecklistAgainstExisting: "diffChecklistAgainstExisting",
      resolveChecklistEntities: "resolveChecklistEntities",
      commitCardChecklist: "commitCardChecklist",
      addCustomCard: "addCustomCard",
    },
    checklistCandidates: {
      getReadyCandidates: "getReadyCandidates",
      discardCandidates: "discardCandidates",
    },
    marketplacePause: { getPausedPlatforms: "getPausedPlatforms" },
    // NEO-335: CardChecklist reads the set's skip records itself (for the
    // wizard's teams step), not only through the mocked SkippedNamesPanel.
    entityReviewSkips: { listForSet: "entityReviewSkips.listForSet" },
    // NEO-343: the search box's team and player names (skipped until the
    // field is focused, but the references still have to resolve).
    teams: { getManyByIds: "teams.getManyByIds" },
    players: { getManyByIds: "players.getManyByIds" },
    // NEO-535: a parallel's checklist mounts its build button and the door.
    parallelChecklistBuild: {
      getParallelsForBuild: "getParallelsForBuild",
      buildParallelChecklist: "buildParallelChecklist",
    },
    parallelCopyTitles: {
      failingTitles: "failingTitles",
      saveTitleFixes: "saveTitleFixes",
    },
  },
}));

vi.mock("react-virtuoso", () => ({
  Virtuoso: ({
    data,
    itemContent,
  }: {
    data: unknown[];
    itemContent: (index: number, item: unknown) => React.ReactNode;
  }) => <div>{data.map((item, i) => <div key={i}>{itemContent(i, item)}</div>)}</div>,
}));

// Children with their own Convex surfaces, none of which this file is about.
vi.mock("./CardChecklistItem", () => ({
  default: ({ card }: { card: { cardName: string } }) => <div>{card.cardName}</div>,
}));
vi.mock("./CardDetailPanel", () => ({ default: () => null }));
vi.mock("./EntityReviewWizard", () => ({ default: () => null }));
vi.mock("./CardPairingModal", () => ({ default: () => null }));
vi.mock("./sync-review-modal", () => ({
  default: () => null,
  needsSyncReview: () => false,
}));
vi.mock("./CrossListingImportModal", () => ({ default: () => null }));
// A visible stand-in, so "the walker opened" is observable without its queue.
vi.mock("./CardAttentionWalker", () => ({
  default: () => <div role="dialog" aria-label="Walker stand-in" />,
}));
vi.mock("./SkippedNamesPanel", () => ({ default: () => null }));
vi.mock("./TeamPicker", () => ({ default: () => null }));
vi.mock("./PlayerPicker", () => ({ default: () => null }));

const state: { cards: unknown; refs: Set<string> } = { cards: [], refs: new Set() };

vi.mock("convex/react", () => ({
  useQuery: (ref: string) => {
    state.refs.add(ref);
    if (ref === "getCardChecklist") return state.cards;
    if (ref === "getSelectorOptionById") return { value: "Base" };
    if (ref === "getAncestorChain") return [];
    if (ref === "getReadyCandidates") return null;
    if (ref === "getPausedPlatforms") return [];
    return undefined;
  },
  useMutation: () => vi.fn(),
  useAction: () => vi.fn(),
  useConvex: () => ({ query: vi.fn(), action: vi.fn() }),
}));

import CardChecklist, { FIX_CARD_TITLES_LABEL } from "./CardChecklist";
import { resetParallelTitlesAutoOpen } from "./ParallelTitlesDialog";

const VARIANT_ID = "variant-1" as unknown as Id<"selectorOptions">;
const INSERT_ID = "insert-1" as unknown as Id<"selectorOptions">;

function card(n: number, overrides: Record<string, unknown> = {}) {
  return {
    _id: `card-${n}` as unknown as Id<"cardChecklist">,
    selectorOptionId: VARIANT_ID,
    cardNumber: String(n),
    cardName: `Card ${n}`,
    platformData: {},
    lastUpdated: 1_000,
    teamOnCardIds: ["team-1"],
    listingTitle: `2024 Topps Chrome Card ${n} #${n}`,
    ...overrides,
  };
}

const PARALLEL_ROLE = { role: "parallel" as const, sourceId: INSERT_ID, sourceValue: "Anime" };

function ui(parallelBuild?: React.ComponentProps<typeof CardChecklist>["parallelBuild"]) {
  return (
    <CardChecklist
      variantId={VARIANT_ID}
      sourceChips={{}}
      sourceLabelMaps={{ bsc: {}, sportlots: {} }}
      parallelBuild={parallelBuild}
    />
  );
}

const door = () => screen.queryByRole("button", { name: FIX_CARD_TITLES_LABEL });

describe("CardChecklist — the Fix card titles door (NEO-535)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetParallelTitlesAutoOpen();
  });

  it("shows on a parallel's checklist beside the pill while a title is flagged cut short", () => {
    state.cards = [card(1), card(2, { listingTitleTruncated: true })];
    render(ui(PARALLEL_ROLE));
    const button = door();
    expect(button).not.toBeNull();
    expect(button!.getAttribute("aria-haspopup")).toBe("dialog");
    // Same row as the one attention pill.
    expect(button!.closest("div")?.textContent).toMatch(/needs? you/);
  });

  it("shows while a title runs over 80", () => {
    state.cards = [card(1, { listingTitle: "x".repeat(81) })];
    render(ui(PARALLEL_ROLE));
    expect(door()).not.toBeNull();
  });

  it("is gone when every title fits", () => {
    state.cards = [card(1), card(2, { listingTitle: "x".repeat(80) })];
    render(ui(PARALLEL_ROLE));
    expect(door()).toBeNull();
  });

  it("never shows on an insert's or a base's checklist", () => {
    state.cards = [card(1, { listingTitleTruncated: true })];
    const { unmount } = render(ui({ role: "insert" }));
    expect(door()).toBeNull();
    unmount();
    render(ui());
    expect(door()).toBeNull();
  });
});
