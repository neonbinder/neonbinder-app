/**
 * NEO-656 — the career gaps of a checklist, read live (Jason: "it should read
 * real data and display pink/blue as appropriate depending on the current state
 * of the data"). One subscribed query, asked about the pairs the cards already
 * name; the answer is never stored, so a gap clears when the data clears.
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../convex/_generated/api", () => ({
  api: { careerCoverage: { careerGaps: "careerCoverage.careerGaps" } },
}));
const useQueryMock = vi.fn();
vi.mock("convex/react", () => ({
  useQuery: (ref: string, args: unknown) => useQueryMock(ref, args),
}));

import { CAREER_GAPS_MAX_PAIRS, useLeafCareerGaps, type CareerGapCard } from "./useLeafCareerGaps";

const card = (id: string, extra: Partial<CareerGapCard> = {}) =>
  ({ _id: id, selectorOptionId: "leaf", playerIds: ["p1"], teamOnCardIds: ["t1"], ...extra }) as unknown as CareerGapCard;

let answer: unknown;
beforeEach(() => {
  answer = [];
  useQueryMock.mockReset();
  useQueryMock.mockImplementation((_ref: string, args: unknown) => (args === "skip" ? undefined : answer));
});

const lastArgs = () => useQueryMock.mock.calls.at(-1)![1] as { pairs: Array<Record<string, string>> } | "skip";

describe("useLeafCareerGaps", () => {
  it("asks about one pair per single-player card and team, de-duplicated, sorted", () => {
    renderHook(() =>
      useLeafCareerGaps([
        card("c2", { teamOnCardIds: ["t2", "t1"] as never }),
        card("c1"),
        card("c3"), // the same pair as c1
      ]),
    );
    expect(useQueryMock.mock.calls[0][0]).toBe("careerCoverage.careerGaps");
    expect(lastArgs()).toEqual({
      pairs: [
        { selectorOptionId: "leaf", playerId: "p1", teamId: "t1" },
        { selectorOptionId: "leaf", playerId: "p1", teamId: "t2" },
      ],
    });
  });

  it("a card with two players, none, or no team asks nothing: nobody can say whose team it is", () => {
    const { result } = renderHook(() =>
      useLeafCareerGaps([
        card("a", { playerIds: ["p1", "p2"] as never }),
        card("b", { playerIds: [] }),
        card("c", { teamOnCardIds: [] }),
      ]),
    );
    expect(lastArgs()).toBe("skip");
    expect(result.current.gapsByCard.size).toBe(0);
    expect(result.current.ready).toBe(true);
  });

  it("a guest row asks in its OWN set (its home year), so the same pair in two sets is two questions", () => {
    renderHook(() => useLeafCareerGaps([card("a"), card("b", { selectorOptionId: "home" as never })]));
    const args = lastArgs() as { pairs: Array<{ selectorOptionId: string }> };
    expect(args.pairs.map((p) => p.selectorOptionId).sort()).toEqual(["home", "leaf"]);
  });

  it("is not ready until the cards load, and not until the first answer arrives", () => {
    const cards = [card("a")];
    answer = undefined;
    const loading = renderHook(() => useLeafCareerGaps(undefined));
    expect(loading.result.current.ready).toBe(false);
    const waiting = renderHook(() => useLeafCareerGaps(cards));
    expect(waiting.result.current.ready).toBe(false);
    answer = [];
    const done = renderHook(() => useLeafCareerGaps(cards));
    expect(done.result.current.ready).toBe(true);
  });

  it("puts each uncovered pair on its own card; a covered one (absent from the answer) shows no gap", () => {
    answer = [{ selectorOptionId: "leaf", playerId: "p1", teamId: "t1" }];
    const { result } = renderHook(() =>
      useLeafCareerGaps([card("a"), card("b", { teamOnCardIds: ["t9"] as never })]),
    );
    expect(result.current.gapsByCard.get("a")).toEqual([{ playerId: "p1", teamId: "t1" }]);
    expect(result.current.gapsByCard.has("b")).toBe(false);
  });

  it("a gap shows blue and clears when the data clears (nothing remembered)", () => {
    const cards = [card("a")];
    answer = [{ selectorOptionId: "leaf", playerId: "p1", teamId: "t1" }];
    const { result, rerender } = renderHook(() => useLeafCareerGaps(cards));
    expect(result.current.gapsByCard.get("a")).toHaveLength(1);
    // A stint was added (anywhere, even Players admin): the query answers with no gap.
    answer = [];
    rerender();
    expect(result.current.gapsByCard.size).toBe(0);
    expect(result.current.ready).toBe(true);
    // And it comes back if the data goes back.
    answer = [{ selectorOptionId: "leaf", playerId: "p1", teamId: "t1" }];
    rerender();
    expect(result.current.gapsByCard.get("a")).toHaveLength(1);
  });

  it("stays ready (never flips back) while a team change re-asks", () => {
    answer = [{ selectorOptionId: "leaf", playerId: "p1", teamId: "t1" }];
    let cards = [card("a")];
    const { result, rerender } = renderHook(() => useLeafCareerGaps(cards));
    expect(result.current.gapsByCard.get("a")).toHaveLength(1);
    cards = [card("a", { teamOnCardIds: ["t2"] as never })];
    answer = undefined; // the new question is in flight
    rerender();
    expect(result.current.ready).toBe(true);
  });

  it("the cards stay on the answer when a card is written but no pair changed (the same pairs, one question)", () => {
    const { rerender } = renderHook(({ cards }) => useLeafCareerGaps(cards), {
      initialProps: { cards: [card("a")] },
    });
    const first = lastArgs();
    rerender({ cards: [{ ...card("a"), extra: "written" } as CareerGapCard] });
    expect(lastArgs()).toEqual(first);
  });

  it("never sends more pairs than the query takes", () => {
    const cards = Array.from({ length: CAREER_GAPS_MAX_PAIRS + 5 }, (_, i) =>
      card(`c${i}`, { playerIds: [`p${i}`] as never }),
    );
    renderHook(() => useLeafCareerGaps(cards));
    expect((lastArgs() as { pairs: unknown[] }).pairs).toHaveLength(CAREER_GAPS_MAX_PAIRS);
  });
});
