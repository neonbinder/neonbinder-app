/**
 * NEO-661 (Jason, 2026-11-24: "if there is anything that would cause a pink
 * box we should hold the parallels back.") — the client's held auto-start. A
 * commit on an INSERT row does not start the parallel build while any live
 * card is pink (`blocksParallelBuild`); it starts the moment none is. A card
 * still awaiting its BSC team lookup is not pink but holds too (Jason, 2026-11-24:
 * "Yes, wait for lookups") until its lookup answers.
 *
 * Mocked at the module boundary as CardChecklist.test.tsx's NEO-312 auto-run
 * block does: the zero-candidate Sync drives a commit, and
 * `getParallelsForBuild` being called is the build starting.
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";

vi.mock("../../convex/_generated/api", () => ({
  api: {
    careerCoverage: { careerGaps: "careerCoverage.careerGaps" },
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
    entityReviewSkips: { listForSet: "entityReviewSkips.listForSet" },
    teams: { getManyByIds: "teams.getManyByIds" },
    players: { getManyByIds: "players.getManyByIds" },
    parallelChecklistBuild: {
      getParallelsForBuild: "getParallelsForBuild",
      buildParallelChecklist: "buildParallelChecklist",
    },
    marketplaceWaits: { forRun: "marketplaceWaits.forRun" },
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
vi.mock("./CardChecklistItem", () => ({
  default: ({ card }: { card: { cardName: string } }) => <div>{card.cardName}</div>,
}));
vi.mock("./CardDetailPanel", () => ({ default: () => null }));
vi.mock("./CardPairingModal", () => ({ default: () => null }));
vi.mock("./sync-review-modal", () => ({
  default: () => null,
  needsSyncReview: () => false,
}));
vi.mock("./CrossListingImportModal", () => ({ default: () => null }));
vi.mock("./CardLeagueRow", () => ({ default: () => null }));
vi.mock("./tidy/TidyUpWalk", () => ({ default: () => null }));
vi.mock("./TeamPicker", () => ({ default: () => null }));
vi.mock("./PlayerPicker", () => ({ default: () => null }));

const mockFetchChecklist = vi.fn();
const mockResolveEntities = vi.fn();
const mockCommitChecklist = vi.fn();
const mockDiscardCandidates = vi.fn();
const mockGetParallelsForBuild = vi.fn();

const VARIANT_ID = "variant-1" as unknown as Id<"selectorOptions">;
const SPORT_ID = "sport-1" as unknown as Id<"selectorOptions">;
const SET_ID = "set-1" as unknown as Id<"selectorOptions">;

const chain = () => [
  {
    _id: SPORT_ID,
    level: "sport",
    value: "Baseball",
    platformData: { bsc: { b0: "baseball" }, sportlots: { s0: "1" } },
  },
  { _id: SET_ID, level: "setName", value: "Test Set", platformData: { bsc: { b0: "2024-topps" } } },
  {
    _id: VARIANT_ID,
    level: "variantType",
    value: "Inserts",
    platformData: { sportlots: { s0: "884412" } },
  },
];

const state: { cards: unknown; liveCandidates: unknown } = { cards: [], liveCandidates: null };

vi.mock("convex/react", () => ({
  useQuery: (ref: string) => {
    if (ref === "getCardChecklist") return state.cards;
    if (ref === "getSelectorOptionById") return { value: "Anime" };
    if (ref === "getAncestorChain") return chain();
    if (ref === "getReadyCandidates") return state.liveCandidates;
    if (ref === "getPausedPlatforms") return [];
    if (ref === "entityReviewSkips.listForSet") return [];
    return undefined;
  },
  useMutation: (ref: string) => (ref === "discardCandidates" ? mockDiscardCandidates : vi.fn()),
  useAction: (ref: string) => {
    if (ref === "fetchCardChecklist") return mockFetchChecklist;
    if (ref === "resolveChecklistEntities") return mockResolveEntities;
    if (ref === "commitCardChecklist") return mockCommitChecklist;
    return vi.fn();
  },
  useConvex: () => ({
    query: (ref: string, args?: unknown) =>
      ref === "getParallelsForBuild" ? mockGetParallelsForBuild(args) : Promise.resolve(undefined),
    action: () => Promise.resolve(undefined),
  }),
}));

import CardChecklist from "./CardChecklist";

const SYNC_BUTTON = /^(Fetch from Marketplaces|Fetching\.\.\.|Saving\.\.\.|Refresh)$/;

const ui = () => (
  <MemoryRouter>
    <CardChecklist
      variantId={VARIANT_ID}
      sourceChips={{}}
      sourceLabelMaps={{ bsc: {}, sportlots: {} }}
      parallelBuild={{ role: "insert" }}
    />
  </MemoryRouter>
);

/** A named, player-linked card; override the team side to make it pink or not. */
const card = (over: Record<string, unknown> = {}) => ({
  _id: "card-1" as unknown as Id<"cardChecklist">,
  selectorOptionId: VARIANT_ID,
  cardNumber: "1",
  cardName: "Mike Trout",
  platformData: {},
  lastUpdated: 1_000,
  playerIds: ["player-1"],
  teamOnCardIds: [] as string[],
  listingTitle: "2024 Topps Mike Trout #1",
  ...over,
});
const teamless = () => card();
const tidy = () => card({ teamOnCardIds: ["team-1"] });
const awaitingLookup = () => card({ platformData: { bsc: { ref: "bsc-ref-1" } } });

async function commit() {
  state.liveCandidates = { ready: 0, total: 0, cards: [] };
  mockResolveEntities.mockResolvedValue({ unknownPlayers: [], unknownTeams: [], batchId: undefined });
  mockCommitChecklist.mockResolvedValue({ count: 1, unreviewedNameCount: 0 });
  mockDiscardCandidates.mockResolvedValue(undefined);
  mockFetchChecklist.mockResolvedValue({
    success: true,
    message: "nothing to fetch",
    candidateCount: 0,
    attachedSides: ["bsc", "sportlots"],
    sources: ["bsc", "sportlots"],
  });
  fireEvent.click(screen.getByRole("button", { name: SYNC_BUTTON }));
  await waitFor(() => expect(mockCommitChecklist).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.getByText(/^Saved 1 card\./)).toBeTruthy());
}

describe("CardChecklist — the parallel build waits on any pink card (NEO-661)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.cards = [];
    state.liveCandidates = null;
    mockGetParallelsForBuild.mockResolvedValue({ parallels: [], truncated: false });
  });

  it("a commit with a teamless card on screen does not start the parallel build", async () => {
    state.cards = [teamless()];
    render(ui());
    await commit();
    // Let any effect-started run reach its first call before asserting none did.
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockGetParallelsForBuild).not.toHaveBeenCalled();
  });

  it("the held build starts once the live rows are tidy", async () => {
    state.cards = [teamless()];
    const { rerender } = render(ui());
    await commit();
    expect(mockGetParallelsForBuild).not.toHaveBeenCalled();

    state.cards = [tidy()];
    await act(async () => {
      rerender(ui());
    });
    await waitFor(() =>
      expect(mockGetParallelsForBuild).toHaveBeenCalledWith({ sourceId: VARIANT_ID }),
    );
  });

  it("a card still awaiting its team lookup holds the build", async () => {
    state.cards = [awaitingLookup()];
    render(ui());
    await commit();
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockGetParallelsForBuild).not.toHaveBeenCalled();
  });

  it("the held build starts once the lookup answers with a team, without another commit", async () => {
    state.cards = [awaitingLookup()];
    const { rerender } = render(ui());
    await commit();
    expect(mockGetParallelsForBuild).not.toHaveBeenCalled();

    state.cards = [
      card({ platformData: { bsc: { ref: "bsc-ref-1" } }, teamCheckDoneAt: 5, teamOnCardIds: ["team-1"] }),
    ];
    await act(async () => {
      rerender(ui());
    });
    await waitFor(() =>
      expect(mockGetParallelsForBuild).toHaveBeenCalledWith({ sourceId: VARIANT_ID }),
    );
    expect(mockCommitChecklist).toHaveBeenCalledTimes(1);
  });

  it("the held build starts once the lookup answers no team (No Team stamp), without another commit", async () => {
    state.cards = [awaitingLookup()];
    const { rerender } = render(ui());
    await commit();
    expect(mockGetParallelsForBuild).not.toHaveBeenCalled();

    state.cards = [
      card({ platformData: { bsc: { ref: "bsc-ref-1" } }, teamCheckDoneAt: 5, teamNoneConfirmedAt: 5 }),
    ];
    await act(async () => {
      rerender(ui());
    });
    await waitFor(() =>
      expect(mockGetParallelsForBuild).toHaveBeenCalledWith({ sourceId: VARIANT_ID }),
    );
    expect(mockCommitChecklist).toHaveBeenCalledTimes(1);
  });
});
