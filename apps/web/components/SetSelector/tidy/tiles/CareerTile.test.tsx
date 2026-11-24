/**
 * NEO-645 tile 4, "Career", as NEO-656 left it: blue, only while the live data
 * holds a career gap (the item comes from `careerCoverage.careerGaps`). Stints
 * are written to the PLAYER ("Add to career", "+ Add stint"). There is no
 * "Keep as is", no new-player career review, and nothing records a look.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../convex/_generated/api", () => ({
  api: new Proxy(
    {},
    {
      get: (_t, mod) =>
        typeof mod !== "string" || mod === "then"
          ? undefined
          : new Proxy(
              {},
              {
                get: (_t2, fn) => (typeof fn !== "string" || fn === "then" ? undefined : `${mod}.${fn}`),
              },
            ),
    },
  ),
}));

const queryResults: Record<string, unknown> = {};
const mutations: Record<string, ReturnType<typeof vi.fn>> = {};
const mutation = (ref: string) => (mutations[ref] ??= vi.fn().mockResolvedValue(null));
const mockConvexQuery = vi.fn();
vi.mock("convex/react", () => ({
  useQuery: (ref: string, args: unknown) => {
    if (args === "skip") return undefined;
    const result = queryResults[ref];
    return typeof result === "function" ? (result as (a: unknown) => unknown)(args) : result;
  },
  useMutation: (ref: string) => mutation(ref),
  useConvex: () => ({ query: mockConvexQuery }),
}));

/** The entry form owns its own tests; here it is one button that adds a known team. */
vi.mock("../../CareerTeamEntry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../CareerTeamEntry")>()),
  default: ({ onAdd }: { onAdd: (e: { name: string; fromYear: number; teamId: string }) => void }) => (
    <button type="button" onClick={() => onAdd({ name: "Texas Rangers", fromYear: 2020, teamId: "team-tex" })}>
      Entry form stub
    </button>
  ),
}));

vi.mock("../../NewTeamForm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../NewTeamForm")>()),
  default: ({ onSubmit }: { onSubmit?: () => void }) => (
    <button type="button" onClick={() => onSubmit?.()}>
      Submit new team form
    </button>
  ),
}));

import { AnsweredProvider } from "../answered";
import CareerTile from "./CareerTile";
import type { TidyAttention, TidyCardContext, TidyRow, TidyTileProps } from "../tile-types";

const CARD = "card-1";
const SPORT = "sport-1";

const card = (extra: Record<string, unknown> = {}) =>
  ({ _id: CARD, cardNumber: "USC42", cardName: "Jackson Merrill", playerIds: ["player-1"], ...extra }) as unknown as TidyRow;

const player = (extra: Record<string, unknown> = {}) => ({
  playerId: "player-1",
  name: "Jackson Merrill",
  sportId: SPORT,
  stints: [{ teamId: "t-old", teamName: "El Paso Chihuahuas", fromYear: 2022, toYear: 2023 }],
  stintsMore: false,
  ...extra,
});

const context = (over: Record<string, unknown> = {}) =>
  ({
    cardId: CARD,
    names: [],
    players: [player()],
    playersMore: false,
    teams: [{ teamId: "team-pad", name: "San Diego Padres", onCard: true, candidate: false }],
    linkedFor: [],
    ...over,
  }) as unknown as NonNullable<TidyCardContext>;

const gapItem = { level: "check", kind: "careerGap", playerId: "player-1", teamId: "team-pad", key: "careerGap:x" } as const;

function renderTile(items: TidyAttention["items"], ctx: TidyCardContext | undefined = context()) {
  const props: TidyTileProps = {
    row: card(),
    context: ctx,
    attention: { level: "check", items },
    leafId: "leaf-1" as never,
    sportId: SPORT as never,
    leafCards: [],
    setName: "Set",
  };
  return render(<CareerTile {...props} />);
}

const click = (el: HTMLElement) => act(async () => fireEvent.click(el));

beforeEach(() => {
  for (const k of Object.keys(queryResults)) delete queryResults[k];
  for (const k of Object.keys(mutations)) delete mutations[k];
  mockConvexQuery.mockReset();
  queryResults["selectorOptions.getAncestorChain"] = [{ _id: "y", level: "year", value: "2024" }];
});

describe("CareerTile", () => {
  it("renders nothing when the card has no career item", () => {
    const { container } = renderTile([]);
    expect(container.textContent).toBe("");
  });

  describe("a career gap on an existing player", () => {
    it("is blue and says which team is missing by which year", () => {
      renderTile([gapItem]);
      expect(screen.getByRole("group", { name: "Career" }).getAttribute("data-tidy-level")).toBe("check");
      expect(screen.getByText("No San Diego Padres in the career by 2024.")).toBeTruthy();
      expect(screen.getByRole("list", { name: "Career on file for Jackson Merrill" })).toBeTruthy();
      expect(screen.getByText("El Paso Chihuahuas · 2022–2023")).toBeTruthy();
    });

    it("a player with no stints at all has 'No career on file yet.'", () => {
      renderTile([gapItem], context({ players: [player({ stints: [] })] }));
      expect(screen.getByText("No career on file yet.")).toBeTruthy();
    });

    describe("'Add to career' writes the card's team to the PLAYER from the set's year (A8, main's default stint)", () => {
      beforeEach(() => vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-06-01T12:00:00Z") }));
      afterEach(() => vi.useRealTimers());

      it("a set from a past year: that one season, 2024–2024", async () => {
        renderTile([gapItem]);
        await click(screen.getByRole("button", { name: "Add to career" }));
        expect(mutation("players.addStint")).toHaveBeenCalledWith({
          playerId: "player-1",
          teamId: "team-pad",
          fromYear: 2024,
          toYear: 2024,
        });
      });

      it("a set from this year, or later: an open stint, 'present' (the player's current team)", async () => {
        queryResults["selectorOptions.getAncestorChain"] = [{ _id: "y", level: "year", value: "2026" }];
        renderTile([gapItem]);
        await click(screen.getByRole("button", { name: "Add to career" }));
        expect(mutation("players.addStint")).toHaveBeenCalledWith({
          playerId: "player-1",
          teamId: "team-pad",
          fromYear: 2026,
        });
      });

      it("tells the walk it was answered, once the stint lands", async () => {
        const onAnswered = vi.fn();
        const props: TidyTileProps = {
          row: card(),
          context: context(),
          attention: { level: "check", items: [gapItem] },
          leafId: "leaf-1" as never,
          sportId: SPORT as never,
          leafCards: [],
          setName: "Set",
        };
        render(
          <AnsweredProvider value={onAnswered}>
            <CareerTile {...props} />
          </AnsweredProvider>,
        );
        await click(screen.getByRole("button", { name: "Add to career" }));
        expect(onAnswered).toHaveBeenCalledTimes(1);
      });
    });

    it("says what Save & next will do while the gap is open, when the set's year is known (A8)", () => {
      renderTile([gapItem]);
      expect(screen.getByText("Save & next adds it to the career.")).toBeTruthy();
    });

    it("says nothing of it when the set has no year: there is no stint to add", () => {
      queryResults["selectorOptions.getAncestorChain"] = [{ _id: "y", level: "year", value: "Unknown" }];
      renderTile([gapItem]);
      expect(screen.queryByText(/Save & next adds it/)).toBeNull();
      expect(screen.queryByRole("button", { name: "Add to career" })).toBeNull();
    });

    it("offers no 'Keep as is': nothing records that a gap was seen, so the only ways out are the data", () => {
      renderTile([gapItem]);
      expect(screen.queryByRole("button", { name: "Keep as is" })).toBeNull();
    });

    it("'+ Add stint' adds a team NB holds, with its years", async () => {
      renderTile([gapItem]);
      await click(screen.getByRole("button", { name: "+ Add stint for Jackson Merrill" }));
      await click(screen.getByRole("button", { name: "Entry form stub" }));
      expect(mutation("players.addStint")).toHaveBeenCalledWith({
        playerId: "player-1",
        teamId: "team-tex",
        fromYear: 2020,
      });
    });

    it("shows a refused write inline", async () => {
      mutation("players.addStint").mockRejectedValueOnce(new Error("Server Error"));
      renderTile([gapItem]);
      await click(screen.getByRole("button", { name: "Add to career" }));
      expect(screen.getByRole("alert").textContent).toBe("Couldn't add that stint. Try again.");
    });
  });
});
