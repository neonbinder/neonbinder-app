/**
 * NEO-602 — a team step shows the cards that print its name, their players and
 * the stints we know; and when the name reaches two or more team rows, those
 * rows are one-click choices, not a brand-new team.
 *
 * Jason, 2026-11-19: "On that New Team screen we need to show what player/card
 * is triggering it because that is the only way a person knows the right team
 * to link it to." The fixture is the case that raised it: 2026 Topps Chrome
 * "Baltimore Orioles", which three team rows answer to.
 *
 * Own file with its own mocks, like `EntityReviewWizard.teamMatchSearch.test`:
 * `useQuery` is routed by reference string, `teamStepContext` returns the
 * fixture below.
 */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";

const SPORT_ID = "selopt-sport-baseball";

vi.mock("../../convex/_generated/api", () => ({
  api: {
    entityReviewQueue: {
      getBatch: "entityReviewQueue.getBatch",
      recordDecision: "entityReviewQueue.recordDecision",
      clearDecision: "entityReviewQueue.clearDecision",
      cancelBatch: "entityReviewQueue.cancelBatch",
      recordAllRemainingAsCreate: "entityReviewQueue.recordAllRemainingAsCreate",
      recordAllRemainingAsSkip: "entityReviewQueue.recordAllRemainingAsSkip",
      stageCareerTeamRows: "entityReviewQueue.stageCareerTeamRows",
      clearCareerTeamStint: "entityReviewQueue.clearCareerTeamStint",
      stageLeagueRows: "entityReviewQueue.stageLeagueRows",
      teamStepContext: "entityReviewQueue.teamStepContext",
    },
    players: {
      nearMatches: "players.nearMatches",
      search: "players.search",
      getManyByIds: "players.getManyByIds",
    },
    teams: {
      nearMatches: "teams.nearMatches",
      pickerCandidates: "teams.pickerCandidates",
      getManyByIds: "teams.getManyByIds",
      resolveNames: "teams.resolveNames",
      nameHeldAsAliasBy: "teams.nameHeldAsAliasBy",
    },
    leagues: { list: "leagues.list" },
  },
}));

const NOW_ROW = "t-bal-now";
const OLD_ROW = "t-bal-old";
const AA_ROW = "t-bal-aa";

/** What `teamStepContext` answers for the Orioles step. */
const ORIOLES_CONTEXT = {
  candidates: [
    {
      teamId: NOW_ROW,
      fullName: "Baltimore Orioles",
      era: "1954–present",
      league: "Major League Baseball",
    },
    { teamId: OLD_ROW, fullName: "Baltimore Orioles", era: "1901–1902" },
    { teamId: AA_ROW, fullName: "Baltimore Orioles", era: "1882–1899" },
  ],
  cards: [
    {
      number: "7",
      players: [
        {
          name: "Recent Oriole",
          stints: [
            { teamId: NOW_ROW, label: "Baltimore Orioles · 1954–present", years: "2020–23" },
            { teamId: "t-other", label: "Seattle Mariners", years: "" },
          ],
          moreStints: 0,
        },
      ],
    },
    {
      number: "8",
      players: [{ name: "Fresh Arrival", stints: [], moreStints: 0 }],
    },
  ],
  moreCards: 4,
  playersDontSettle: true,
};

let currentRows: unknown;
let contextAnswer: unknown;
let nearAnswer: unknown;
let holdersAnswer: unknown;
let queryCalls: Array<{ ref: string; args: unknown }>;
const mockRecordDecision = vi.fn();

vi.mock("convex/react", () => ({
  useQuery: (ref: string, args: unknown) => {
    queryCalls.push({ ref, args });
    if (args === "skip") return undefined;
    if (ref === "entityReviewQueue.getBatch") return currentRows;
    if (ref === "entityReviewQueue.teamStepContext") return contextAnswer;
    if (ref === "players.nearMatches" || ref === "teams.nearMatches") return nearAnswer;
    if (ref === "leagues.list") return [];
    if (ref === "teams.nameHeldAsAliasBy") return holdersAnswer;
    return undefined;
  },
  useMutation: (ref: string) => {
    if (ref === "entityReviewQueue.recordDecision") return mockRecordDecision;
    return vi.fn(() => Promise.resolve(undefined));
  },
  useAction: () => vi.fn(() => Promise.resolve({ decided: 0, hasMore: false, cursor: null })),
}));

vi.mock("./EntityLinkSearch", () => ({
  default: () => <div aria-label="Entity link search (stub)" />,
}));

import EntityReviewWizard from "./EntityReviewWizard";

let nextRowId = 0;
function makeRow(overrides: Record<string, unknown> = {}) {
  nextRowId += 1;
  return {
    _id: `row-${nextRowId}` as unknown as Id<"entityReviewQueue">,
    _creationTime: nextRowId,
    selectorOptionId: "selopt-1",
    batchId: "batch-1",
    kind: "team",
    name: "Baltimore Orioles",
    sportId: SPORT_ID,
    sportValue: "Baseball",
    status: "ready",
    ...overrides,
  };
}

/** A team step the gate raised for a name that reached three rows. */
const orioleRow = (overrides: Record<string, unknown> = {}) =>
  makeRow({
    teamContext: { candidateTeamIds: [NOW_ROW, OLD_ROW, AA_ROW] },
    ...overrides,
  });

function wizard() {
  return (
    <EntityReviewWizard
      isOpen
      selectorOptionId={"selopt-1" as unknown as Id<"selectorOptions">}
      batchId="batch-1"
      summary={{ cardCount: 3, deleteCount: 0, reviewDecisionCount: 0 }}
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRecordDecision.mockResolvedValue(null);
  currentRows = [];
  contextAnswer = undefined;
  nearAnswer = [];
  holdersAnswer = [];
  queryCalls = [];
  nextRowId = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("EntityReviewWizard — a team name that reaches several rows (NEO-602)", () => {
  it("asks which team, not for a new one", () => {
    currentRows = [orioleRow()];
    contextAnswer = ORIOLES_CONTEXT;
    render(wizard());

    expect(screen.getByRole("heading", { name: "Which team: Baltimore Orioles" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /^New Team/ })).toBeNull();
  });

  it("offers each row as a link, newest era first, with its era and league in the name", async () => {
    currentRows = [orioleRow()];
    contextAnswer = ORIOLES_CONTEXT;
    render(wizard());

    // The intro names the list, and lands one tick after the step mounts.
    const list = await screen.findByRole("list", { name: /^We've got [0-9]+ teams by that name/ });
    const names = within(list)
      .getAllByRole("button")
      .map((b) => b.textContent);
    expect(names).toEqual([
      "Link to Baltimore Orioles · 1954–present · Major League Baseball",
      "Link to Baltimore Orioles · 1901–1902",
      "Link to Baltimore Orioles · 1882–1899",
    ]);
    // Distinct accessible names: nothing to disambiguate by position.
    expect(new Set(names).size).toBe(3);
    expect(await screen.findByText("We've got 3 teams by that name. Pick the one on these cards.")).toBeTruthy();
  });

  it("clicking a row records the same link every team link path records, 'Remember …' ticked", async () => {
    const row = orioleRow();
    currentRows = [row];
    contextAnswer = ORIOLES_CONTEXT;
    render(wizard());

    fireEvent.click(
      screen.getByRole("button", { name: "Link to Baltimore Orioles · 1901–1902" }),
    );

    await waitFor(() => expect(mockRecordDecision).toHaveBeenCalledTimes(1));
    expect(mockRecordDecision).toHaveBeenCalledWith({
      reviewRowId: row._id,
      action: "link",
      linkedPlayerId: undefined,
      linkedTeamId: OLD_ROW,
      linkedLeagueId: undefined,
      saveAsAlias: true,
    });
  });

  it("an unticked 'Remember …' travels with the click", async () => {
    const row = orioleRow();
    currentRows = [row];
    contextAnswer = ORIOLES_CONTEXT;
    render(wizard());

    fireEvent.click(
      screen.getByLabelText("Remember “Baltimore Orioles” as a name for this team"),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Link to Baltimore Orioles · 1954–present · Major League Baseball",
      }),
    );

    await waitFor(() =>
      expect(mockRecordDecision).toHaveBeenCalledWith(
        expect.objectContaining({ linkedTeamId: NOW_ROW, saveAsAlias: false }),
      ),
    );
  });

  it("keeps the search and the New Team form below as the fallback", async () => {
    currentRows = [orioleRow()];
    contextAnswer = ORIOLES_CONTEXT;
    render(wizard());

    expect(screen.getByRole("combobox", { name: "Search all teams" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add as New Team" })).toBeTruthy();
    // The rows come first in the document, ahead of the search.
    // The intro names the list, and lands one tick after the step mounts.
    const list = await screen.findByRole("list", { name: /^We've got [0-9]+ teams by that name/ });
    const search = screen.getByRole("combobox", { name: "Search all teams" });
    expect(
      list.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("states the reason only when the players do not settle it", () => {
    currentRows = [orioleRow()];
    contextAnswer = ORIOLES_CONTEXT;
    const { unmount } = render(wizard());
    expect(screen.getByText("Players on these cards don't settle which team.")).toBeTruthy();
    unmount();

    contextAnswer = { ...ORIOLES_CONTEXT, playersDontSettle: false };
    render(wizard());
    expect(screen.queryByText(/don't settle which team/)).toBeNull();
  });

  it("a lone exact near match is not promoted over the rows: the footer stays 'Add as New Team'", () => {
    nearAnswer = [
      {
        _id: NOW_ROW,
        name: "Baltimore Orioles",
        confidence: "exact",
        yearsActive: { from: 1954 },
      },
    ];
    currentRows = [orioleRow()];
    contextAnswer = ORIOLES_CONTEXT;
    const { unmount } = render(wizard());
    expect(screen.getByRole("button", { name: "Add as New Team" })).toBeTruthy();
    // Only the candidate list's own link carries that name, once.
    expect(
      screen.getAllByRole("button", { name: /^Link to Baltimore Orioles · 1954–present/ }),
    ).toHaveLength(1);
    unmount();

    // The same near match on a step with ONE row (no teamContext) is the
    // footer's promoted link, as it has always been.
    currentRows = [makeRow()];
    contextAnswer = null;
    render(wizard());
    expect(
      screen.getByRole("button", { name: "Link to Baltimore Orioles · 1954–present" }),
    ).toBeTruthy();
  });

  it("an alias holder the step already offers is not offered a second time; another holder still is", () => {
    holdersAnswer = [
      { id: NOW_ROW, name: "Baltimore Orioles", yearsActive: { from: 1954 } },
      { id: "t-elsewhere", name: "Charm City Birds", yearsActive: { from: 2000 } },
    ];
    currentRows = [orioleRow()];
    contextAnswer = ORIOLES_CONTEXT;
    render(wizard());

    expect(
      screen.getAllByRole("button", { name: /^Link to Baltimore Orioles · 1954–present/ }),
    ).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: "Link to Charm City Birds · 2000–present" }),
    ).toBeTruthy();
  });

  it("moves focus off the create action when the step arrives with it there", () => {
    const first = makeRow({ name: "Plain FC" });
    const second = orioleRow();
    currentRows = [first, second];
    contextAnswer = undefined;
    const { rerender } = render(wizard());

    const primary = screen.getByRole("button", { name: "Add as New Team" });
    primary.focus();
    expect(document.activeElement).toBe(primary);

    currentRows = [{ ...first, decision: { action: "skip" } }, second];
    contextAnswer = ORIOLES_CONTEXT;
    rerender(wizard());

    expect(document.activeElement).toBe(
      screen.getByRole("heading", { name: "Which team: Baltimore Orioles" }),
    );
  });
});

describe("EntityReviewWizard — the cards behind a team step (NEO-602)", () => {
  it("lists each card's number and players, and under each player the stints we know", () => {
    currentRows = [orioleRow()];
    contextAnswer = ORIOLES_CONTEXT;
    render(wizard());

    const cards = screen.getByRole("list", { name: /^Printed on [0-9]+ cards?$/ });
    expect(within(cards).getByText("#7")).toBeTruthy();
    expect(within(cards).getByText("Recent Oriole")).toBeTruthy();
    expect(within(cards).getByText("2020–23")).toBeTruthy();
    expect(within(cards).getByText("Baltimore Orioles · 1954–present")).toBeTruthy();
    // A stint with no years says so.
    expect(within(cards).getByText("years not on file")).toBeTruthy();
    expect(within(cards).getByText("Seattle Mariners")).toBeTruthy();
    // A player with no stints on file says that.
    expect(within(cards).getByText("Fresh Arrival")).toBeTruthy();
    expect(within(cards).getByText("Nothing on file yet")).toBeTruthy();
  });

  it("counts the cards it does not list", () => {
    currentRows = [orioleRow()];
    contextAnswer = ORIOLES_CONTEXT;
    render(wizard());
    expect(screen.getByText("Printed on 6 cards")).toBeTruthy();
    expect(screen.getByText("+4 more cards")).toBeTruthy();
  });

  it("a brand-new name still says 'New Team', with its cards and no rows to choose", () => {
    currentRows = [makeRow({ name: "Nowhere Nobodies", teamContext: { candidateTeamIds: [] } })];
    contextAnswer = {
      candidates: [],
      cards: [{ number: "3", players: [{ name: "Somebody New", stints: [], moreStints: 0 }] }],
      moreCards: 0,
      playersDontSettle: false,
    };
    render(wizard());

    expect(screen.getByRole("heading", { name: "New Team: Nowhere Nobodies" })).toBeTruthy();
    expect(screen.queryByRole("list", { name: /^We've got [0-9]+ teams by that name/ })).toBeNull();
    expect(screen.getByText("Printed on 1 card")).toBeTruthy();
    expect(screen.getByText("Somebody New")).toBeTruthy();
    expect(screen.queryByText("+0 more cards")).toBeNull();
  });

  it("a step with no context (an older row, a staged career team) renders as it always did", () => {
    currentRows = [makeRow({ name: "Plain FC" })];
    contextAnswer = null;
    render(wizard());

    expect(screen.getByRole("heading", { name: "New Team: Plain FC" })).toBeTruthy();
    expect(screen.queryByRole("list", { name: /^Printed on [0-9]+ cards?$/ })).toBeNull();
  });

  it("asks the server only for a team step", () => {
    currentRows = [makeRow({ kind: "player", name: "Mike Trout" })];
    render(wizard());
    expect(queryCalls.some((c) => c.ref === "entityReviewQueue.teamStepContext")).toBe(false);
  });
});
