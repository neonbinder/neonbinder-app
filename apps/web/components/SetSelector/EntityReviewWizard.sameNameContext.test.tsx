/**
 * NEO-602 — a same-name PLAYER pick step shows the cards that print the name
 * (number and printed team) and each candidate's stints, under the candidates.
 *
 * Jason, 2026-11-19: "I don't know how I would choose between the two active
 * luis castillo. We should show the card number & team from the player on the
 * screen." The fixture is the case that raised it: 2026 Topps Chrome, card #62
 * "Seattle Mariners", two Luis Castillos on a Mariners roster that year.
 *
 * Own file with its own mocks, like `EntityReviewWizard.teamCandidates.test`:
 * `useQuery` is routed by reference string, `playerStepContext` returns the
 * fixture below.
 */

import { render, screen, within } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";

const SPORT_ID = "selopt-sport-baseball";

vi.mock("../../convex/_generated/api", () => ({
  api: {
    // NEO-426: the teams step's flagged-sports read.
    sportTeamless: {
      listTeamlessSportIds: "sportTeamless.listTeamlessSportIds",
    },
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
      requestPlayerLookup: "entityReviewQueue.requestPlayerLookup",
      playerStepContext: "entityReviewQueue.playerStepContext",
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
    // The row header's SportSwitch reads the sport list.
    selectorOptions: { getSelectorOptions: "selectorOptions.getSelectorOptions" },
  },
}));

const PITCHER = "p-pitcher";
const SECOND = "p-second";

/** What `playerStepContext` answers for the Luis Castillo step. */
const CASTILLO_CONTEXT = {
  cards: [{ number: "62", teams: ["Seattle Mariners"] }],
  moreCards: 0,
  players: [
    {
      playerId: PITCHER,
      name: "Luis Castillo",
      birthYear: 1992,
      hasPrintedTeam: true,
      moreStints: 0,
      stints: [
        { teamId: "t-reds", label: "Cincinnati Reds", years: "2017–22", onPrintedTeam: false },
        { teamId: "t-sea", label: "Seattle Mariners", years: "2022–present", onPrintedTeam: true },
      ],
    },
    {
      playerId: SECOND,
      name: "Luis Castillo",
      birthYear: 1995,
      hasPrintedTeam: true,
      moreStints: 0,
      stints: [
        { teamId: "t-sea", label: "Seattle Mariners", years: "2025–present", onPrintedTeam: true },
      ],
    },
  ],
};

let currentRows: unknown;
let contextAnswer: unknown;
let queryCalls: Array<{ ref: string; args: unknown }>;

vi.mock("convex/react", () => ({
  useQuery: (ref: string, args: unknown) => {
    queryCalls.push({ ref, args });
    if (args === "skip") return undefined;
    if (ref === "entityReviewQueue.getBatch") return currentRows;
    if (ref === "entityReviewQueue.playerStepContext") return contextAnswer;
    if (ref === "sportTeamless.listTeamlessSportIds") return [];
    if (ref === "players.nearMatches" || ref === "teams.nearMatches") return [];
    if (ref === "leagues.list") return [];
    return undefined;
  },
  useMutation: () => vi.fn(() => Promise.resolve(null)),
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
    kind: "player",
    name: "Luis Castillo",
    sportId: SPORT_ID,
    sportValue: "Baseball",
    setSportId: SPORT_ID,
    setSportValue: "Baseball",
    status: "ready",
    ...overrides,
  };
}

/** A pick step the gate raised for a name two players answer to. */
const castilloRow = (overrides: Record<string, unknown> = {}) =>
  makeRow({
    enrichment: {
      existingCandidates: [
        {
          playerId: PITCHER,
          name: "Luis Castillo",
          birthYear: 1992,
          careerSummary: "Reds 2017–22 · Mariners 2022–present",
          activeInSetYear: true,
        },
        {
          playerId: SECOND,
          name: "Luis Castillo",
          birthYear: 1995,
          careerSummary: "Mariners 2025–present",
          activeInSetYear: true,
        },
      ],
    },
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
  currentRows = [];
  contextAnswer = undefined;
  queryCalls = [];
  nextRowId = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("EntityReviewWizard — the same-name player pick step shows its card (NEO-602)", () => {
  it("lists the card number and printed team, and each candidate's stints", async () => {
    const row = castilloRow();
    currentRows = [row];
    contextAnswer = CASTILLO_CONTEXT;
    render(wizard());

    expect(screen.getByRole("heading", { name: /Which Luis Castillo is this/ })).toBeTruthy();
    const cards = screen.getByRole("list", { name: "Printed on 1 card" });
    expect(cards.textContent).toContain("#62");
    expect(cards.textContent).toContain("Seattle Mariners");
    const stints = screen.getByRole("list", { name: "Teams we know for each player" });
    expect(within(stints).getAllByText("(printed team)")).toHaveLength(2);
    // The status is filled one tick after the step mounts.
    expect(
      await screen.findByText(
        "The printed team doesn't settle it: 2 of these players have a stint with it.",
      ),
    ).toBeTruthy();
    // Asked about THIS row, once.
    const asked = queryCalls.filter((c) => c.ref === "entityReviewQueue.playerStepContext");
    expect(asked.length).toBeGreaterThan(0);
    expect(asked.every((c) => (c.args as { reviewRowId: unknown }).reviewRowId === row._id)).toBe(true);
  });

  it("sits under the candidates, which keep their own distinct links", () => {
    currentRows = [castilloRow()];
    contextAnswer = CASTILLO_CONTEXT;
    render(wizard());

    const candidates = screen.getByRole("list", { name: "Players already filed under this name" });
    const names = within(candidates)
      .getAllByRole("button")
      .map((b) => b.getAttribute("aria-label"));
    expect(new Set(names).size).toBe(2);
    names.forEach((n) => expect(n).toMatch(/b\. 199|born 199/));
    const cards = screen.getByRole("list", { name: "Printed on 1 card" });
    expect(
      candidates.compareDocumentPosition(cards) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("is not asked for on a New Player step, nor for a team", () => {
    currentRows = [
      makeRow({ name: "Somebody New" }),
      makeRow({ kind: "team", name: "Seattle Mariners" }),
    ];
    contextAnswer = CASTILLO_CONTEXT;
    render(wizard());

    expect(queryCalls.some((c) => c.ref === "entityReviewQueue.playerStepContext")).toBe(false);
    expect(screen.queryByRole("list", { name: "Printed on 1 card" })).toBeNull();
  });
});
