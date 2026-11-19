/**
 * NEO-426 — the wizard around the teamless-sport default: a card whose every
 * person plays a flagged sport saves as "No team" without a teams-step line,
 * and the Save step says how many (singular and plural), describing Confirm &
 * Save by that note (never relabelling it).
 *
 * The pure rule is in teams-on-cards.teamlessSport.test.tsx and its server
 * twin in teamlessSport.clientServerParity.test.tsx; this file is the wiring:
 * the flagged-sport query, the linked player's home sport (read off the player
 * rows the wizard already loads), and the bar waiting on those facts.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";

vi.mock("../../convex/_generated/api", () => {
  const moduleProxy = (mod: string) =>
    new Proxy({}, { get: (_t, fn) => `${mod}.${String(fn)}` });
  return { api: new Proxy({}, { get: (_t, mod) => moduleProxy(String(mod)) }) };
});

let currentRows: unknown;
/** undefined = still loading. */
let flaggedSports: string[] | undefined;
let linkedPlayers: Array<{ _id: string; name: string; sportId: string }> | undefined;

vi.mock("convex/react", () => ({
  useQuery: (ref: string, args: unknown) => {
    if (args === "skip") return undefined;
    if (ref === "entityReviewQueue.getBatch") return currentRows;
    if (ref === "sportTeamless.listTeamlessSportIds") return flaggedSports;
    if (ref === "players.getManyByIds") return linkedPlayers;
    if (ref === "teams.getManyByIds") return [];
    return undefined;
  },
  useQueries: (queries: Record<string, { args: { players: unknown[] } }>) => {
    const out: Record<string, unknown> = {};
    for (const [key, { args }] of Object.entries(queries)) {
      out[key] = {
        setYear: 1985,
        players: args.players.map(() => ({ playerId: null, answer: null, candidates: [] })),
      };
    }
    return out;
  },
  useMutation: () => vi.fn(() => Promise.resolve(null)),
  useAction: () => vi.fn(() => Promise.resolve(undefined)),
}));

vi.mock("./EntityLinkSearch", () => ({ default: () => null }));

import EntityReviewWizard from "./EntityReviewWizard";

const CONFIRM_SAVE_NAME = "Confirm & Save (Enter) — commit this review";
const NEXT_NAME = "Next (Enter)";
const NOTE_ONE =
  "1 card saves with No team: its player's sport has none. Add a team later in the card editor.";
const notePlural = (n: number) =>
  `${n} cards save with No team: their players' sports have none. Add a team later in the card editor.`;
const bar = () => screen.getByRole("progressbar", { name: "Wizard progress" });
const onStep = () => bar().getAttribute("aria-valuetext") ?? "";
const NONE = "sport-none";
const BALL = "sport-ball";

let rowId = 0;
function row(overrides: Record<string, unknown>) {
  rowId += 1;
  return {
    _id: `row-${rowId}`,
    _creationTime: rowId,
    selectorOptionId: "selopt-1",
    batchId: "batch-1",
    kind: "player",
    name: "Pat Nonsport",
    sportId: NONE,
    sportValue: "Non Sport",
    setSportId: NONE,
    setSportValue: "Non Sport",
    status: "ready",
    decision: { action: "create" },
    ...overrides,
  };
}

type Card = {
  cardNumber: string;
  cardName: string;
  players?: string[];
  teams?: string[];
  rawTeamName?: string;
};

function renderWizard(previewCards: Card[], extra: Record<string, unknown> = {}) {
  const onTeamAnswersChange = vi.fn();
  const utils = render(
    <EntityReviewWizard
      isOpen
      selectorOptionId={"selopt-1" as unknown as Id<"selectorOptions">}
      batchId="batch-1"
      summary={{ cardCount: previewCards.length, deleteCount: 0, reviewDecisionCount: 0 }}
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
      previewCards={previewCards}
      onTeamAnswersChange={onTeamAnswersChange}
      {...extra}
    />,
  );
  return { ...utils, onTeamAnswersChange };
}

const confirm = () => screen.getByRole("button", { name: CONFIRM_SAVE_NAME });
const describedText = (el: HTMLElement) =>
  (el.getAttribute("aria-describedby") ?? "")
    .split(" ")
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" | ");

beforeEach(() => {
  rowId = 0;
  flaggedSports = [NONE];
  linkedPlayers = [];
  currentRows = [row({ name: "Pat Nonsport" })];
});

describe("Save step: the 'saves with No team' note", () => {
  it("one stamped card: no teams step, the singular note, and Confirm & Save described by it", () => {
    renderWizard([{ cardNumber: "1", cardName: "Card", players: ["Pat Nonsport"] }]);
    expect(onStep()).toBe("Ready to save");
    expect(screen.queryByText("Cards with no team")).toBeNull();
    expect(screen.getByText(NOTE_ONE)).toBeTruthy();
    // Described, never relabelled: the name is the E2E contract.
    expect(describedText(confirm())).toBe(NOTE_ONE);
    expect(confirm().getAttribute("aria-label")).toBe(CONFIRM_SAVE_NAME);
  });

  it("several stamped cards: the plural note with the count", () => {
    renderWizard([
      { cardNumber: "1", cardName: "A", players: ["Pat Nonsport"] },
      { cardNumber: "2", cardName: "B", players: ["Pat Nonsport"] },
      { cardNumber: "3", cardName: "C", players: ["Pat Nonsport"] },
    ]);
    expect(screen.getByText(notePlural(3))).toBeTruthy();
    expect(screen.queryByText(NOTE_ONE)).toBeNull();
    expect(describedText(confirm())).toBe(notePlural(3));
  });

  it("no flagged sport: no note, no teams-step change, and Confirm has no description", () => {
    flaggedSports = [];
    renderWizard([{ cardNumber: "1", cardName: "Card", players: ["Pat Nonsport"] }]);
    // The card is asked about, as before.
    expect(onStep()).toBe("Cards with no team");
    fireEvent.click(screen.getByRole("button", { name: NEXT_NAME }));
    expect(screen.queryByText(/save with No team/)).toBeNull();
    expect(confirm().hasAttribute("aria-describedby")).toBe(false);
  });

  it("a mixed sitting: only the asked card gets a teams-step line, the note counts the stamped one", () => {
    currentRows = [
      row({ name: "Pat Nonsport" }),
      row({ name: "Ron Ballplayer", sportId: BALL, sportValue: "Baseball" }),
    ];
    renderWizard([
      { cardNumber: "1", cardName: "A", players: ["Pat Nonsport"] },
      { cardNumber: "2", cardName: "B", players: ["Ron Ballplayer"] },
    ]);
    expect(onStep()).toBe("Cards with no team");
    expect(screen.getByRole("radiogroup", { name: "Team for Ron Ballplayer" })).toBeTruthy();
    expect(screen.queryByRole("radiogroup", { name: "Team for Pat Nonsport" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: NEXT_NAME }));
    expect(screen.getByText(NOTE_ONE)).toBeTruthy();
    expect(describedText(confirm())).toBe(NOTE_ONE);
  });

  it("a card with a listing team is asked, not stamped", () => {
    renderWizard([
      { cardNumber: "1", cardName: "A", players: ["Pat Nonsport"], rawTeamName: "Cubs" },
    ]);
    expect(onStep()).toBe("Cards with no team");
    fireEvent.click(screen.getByRole("button", { name: NEXT_NAME }));
    expect(screen.queryByText(/save with No team/)).toBeNull();
  });

  it("a card the parent marks settled is neither asked nor counted", () => {
    renderWizard([{ cardNumber: "1", cardName: "A", players: ["Pat Nonsport"] }], {
      cardsWithSettledTeam: [0],
    });
    expect(onStep()).toBe("Ready to save");
    expect(screen.queryByText(/save with No team/)).toBeNull();
  });

  it("a card that re-syncs a stored row is asked, not counted", () => {
    renderWizard([{ cardNumber: "1", cardName: "A", players: ["Pat Nonsport"] }], {
      existingCardIndexes: [0],
    });
    expect(onStep()).toBe("Cards with no team");
  });

  it("a fetch-resolved teamless name beside a created player in a sport with teams: mixed, asked", () => {
    currentRows = [row({ name: "Someone Else", sportId: BALL })];
    renderWizard(
      [{ cardNumber: "1", cardName: "A", players: ["Known Golfer", "Someone Else"] }],
      { teamlessPlayerNames: ["Known Golfer"] },
    );
    // Mixed (Someone Else is in a sport with teams): asked.
    expect(onStep()).toBe("Cards with no team");
  });
});

describe("Save step: the note beside the auto-linked intro", () => {
  it("Confirm & Save is described by both lines, the intro first", () => {
    linkedPlayers = [{ _id: "p-pat", name: "Pat Nonsport", sportId: NONE }];
    currentRows = [
      row({
        name: "Pat Nonsport",
        decision: { action: "link", linkedPlayerId: "p-pat", autoLinked: "setHistory" },
      }),
    ];
    renderWizard([{ cardNumber: "1", cardName: "A", players: ["Pat Nonsport"] }]);
    // Opened with every name decided: on Save at once, the linked player's
    // home sport (read off the player rows) makes the card a stamped one.
    expect(onStep()).toBe("Ready to save");
    const parts = describedText(confirm()).split(" | ");
    expect(parts).toHaveLength(2);
    expect(parts[0]).toMatch(/linked|look/i);
    expect(parts[1]).toBe(NOTE_ONE);
  });

  it("a linked player in a sport with teams adds no note, only the intro", () => {
    linkedPlayers = [{ _id: "p-ron", name: "Ron Ballplayer", sportId: BALL }];
    currentRows = [
      row({
        name: "Ron Ballplayer",
        decision: { action: "link", linkedPlayerId: "p-ron", autoLinked: "setHistory" },
      }),
    ];
    renderWizard([{ cardNumber: "1", cardName: "A", players: ["Ron Ballplayer"] }]);
    // The card is asked (his sport has teams); step on to Save.
    expect(onStep()).toBe("Cards with no team");
    fireEvent.click(screen.getByRole("button", { name: NEXT_NAME }));
    expect(screen.queryByText(/save with No team/)).toBeNull();
    expect(describedText(confirm()).split(" | ")).toHaveLength(1);
  });
});

describe("the plan waits for the facts the teams step reads", () => {
  const cards = [{ cardNumber: "1", cardName: "A", players: ["Pat Nonsport"] }];
  const rerenderWith = (rerender: (ui: React.ReactElement) => void) =>
    rerender(
      <EntityReviewWizard
        isOpen
        selectorOptionId={"selopt-1" as unknown as Id<"selectorOptions">}
        batchId="batch-1"
        summary={{ cardCount: 1, deleteCount: 0, reviewDecisionCount: 0 }}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        previewCards={cards}
        onTeamAnswersChange={vi.fn()}
      />,
    );
  const valueNow = () => bar().getAttribute("aria-valuenow");

  it("while the flagged sports are loading the plan has not started (0%), then it does", () => {
    flaggedSports = undefined;
    const { rerender } = renderWizard(cards);
    expect(valueNow()).toBe("0");
    flaggedSports = [NONE];
    rerenderWith(rerender);
    expect(onStep()).toBe("Ready to save");
    expect(valueNow()).toBe("100");
  });

  it("a linked player's sport still loading holds the plan too, then it starts", () => {
    linkedPlayers = undefined;
    currentRows = [
      row({ name: "Pat Nonsport", decision: { action: "link", linkedPlayerId: "p-pat" } }),
    ];
    const { rerender } = renderWizard(cards);
    expect(valueNow()).toBe("0");
    linkedPlayers = [{ _id: "p-pat", name: "Pat Nonsport", sportId: NONE }];
    rerenderWith(rerender);
    expect(valueNow()).toBe("100");
  });

  it("with no flagged sport nothing waits on a player read", () => {
    flaggedSports = [];
    linkedPlayers = undefined;
    currentRows = [
      row({ name: "Pat Nonsport", decision: { action: "link", linkedPlayerId: "p-pat" } }),
    ];
    renderWizard(cards);
    expect(valueNow()).not.toBe("0");
  });
});
