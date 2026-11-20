/**
 * NEO-335 Phase 2 — the "Card titles" step is recomputed from the TEAMS
 * step's answers, so it can appear and disappear while the operator answers
 * teams.
 *
 * With today's title generator a team is filler text and never trims the
 * core, so no real card flips on a team answer; the wiring is what is pinned
 * here, with `cardsNeedingTitleReview` stubbed to depend on the answers.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";

vi.mock("../../convex/_generated/api", () => {
  const moduleProxy = (mod: string) =>
    new Proxy({}, { get: (_t, fn) => `${mod}.${String(fn)}` });
  return { api: new Proxy({}, { get: (_t, mod) => moduleProxy(String(mod)) }) };
});

vi.mock("convex/react", () => ({
  // NEO-426 — no sport flagged: the teams step is exactly what it was.
  useQuery: (ref: string) => (ref === "sportTeamless.listTeamlessSportIds" ? [] : undefined),
  useQueries: (queries: Record<string, { args: { players?: unknown[]; names?: unknown[] } }>) => {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(queries)) out[key] = undefined;
    return out;
  },
  useMutation: () => vi.fn(() => Promise.resolve(0)),
  useAction: () => vi.fn(() => Promise.resolve(undefined)),
}));

vi.mock("./EntityLinkSearch", () => ({ default: () => null }));

const seenTeamAnswers: unknown[] = [];
vi.mock("./card-titles", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./card-titles")>();
  return {
    ...actual,
    // The step asks about card 0 exactly while some card is answered "no team".
    cardsNeedingTitleReview: (
      _cards: unknown,
      _context: unknown,
      teamAnswers?: ReadonlyArray<{ teamNone?: true } | undefined>,
    ) => {
      seenTeamAnswers.push(teamAnswers);
      return teamAnswers?.some((a) => a?.teamNone) ? [0] : [];
    },
  };
});

import EntityReviewWizard from "./EntityReviewWizard";

const NEXT_NAME = "Next (Enter)";
const bar = () => screen.getByRole("progressbar", { name: "Wizard progress" });
/** The step the operator is on, as the progress bar reads it. */
const onStep = () => bar().getAttribute("aria-valuetext") ?? "";

describe("the titles step follows the team answers", () => {
  it("appears on a team answer, and is passed over once the answer goes", () => {
    render(
      <EntityReviewWizard
        isOpen
        teamsOnly
        selectorOptionId={"selopt-1" as unknown as Id<"selectorOptions">}
        batchId=""
        summary={{ cardCount: 1, deleteCount: 0, reviewDecisionCount: 0 }}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        previewCards={[{ cardNumber: "1", cardName: "Checklist", players: [] }]}
        onTeamAnswersChange={vi.fn()}
        titleContext={{ sportValue: "Baseball", setTeamNames: [], players: [], teams: [] }}
      />,
    );
    // Teams, then Save — no titles step yet.
    expect(onStep()).toBe("Cards with no team");

    fireEvent.click(screen.getByRole("radio", { name: "No team on this card — Cards with no players (1)" }));
    expect(seenTeamAnswers.at(-1)).toEqual([{ teamNone: true }]);
    expect(onStep()).toBe("Cards with no team");
    // The titles step is in the plan now: Next goes there.
    fireEvent.click(screen.getByRole("button", { name: NEXT_NAME }));
    expect(onStep()).toBe("Card titles");

    // The answer goes back to "later": the step has nothing in it, and Next
    // passes the empty step over to Save.
    fireEvent.click(screen.getByRole("button", { name: "Back to previous step" }));
    expect(onStep()).toBe("Cards with no team");
    fireEvent.click(screen.getByRole("radio", { name: "Leave for later — Cards with no players (1)" }));
    fireEvent.click(screen.getByRole("button", { name: NEXT_NAME }));
    expect(onStep()).toBe("Ready to save");
    expect(screen.getByText("Save 1 card?")).toBeTruthy();
    expect(screen.queryByText("Card titles")).toBeNull();
  });
});

void React;
