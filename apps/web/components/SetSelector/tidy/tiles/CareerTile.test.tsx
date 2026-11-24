/**
 * NEO-645 tile 4, "Career": blue, only while the card has a career gap or a new
 * player's Wikidata career. Stints are written to the PLAYER ("Add to career",
 * "Create team and add stint", "Add stints to {player}", "+ Add stint").
 * "Keep as is" writes nothing to the player: it is stored on the card at once
 * (`tidyCards.keepCareerGap`), so Save & next leaves the career alone.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useEffect } from "react";
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

/**
 * The entry form owns its own tests; here it is one button that adds a known
 * team, plus what the prefilled form hands it (`load`, `onDraftChange`).
 */
vi.mock("../../CareerTeamEntry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../CareerTeamEntry")>()),
  default: function EntryStub({
    onAdd,
    onDone,
    load,
    onDraftChange,
  }: {
    onAdd: (e: { name: string; fromYear: number; teamId: string }) => void;
    onDone?: () => void;
    load?: { name: string; teamId?: string; fromYear: number; toYear?: number };
    onDraftChange?: (d: { name: string; fromYear: number; toYear?: number; teamId: string } | null) => void;
  }) {
    useEffect(() => {
      if (load && load.teamId) {
        onDraftChange?.({
          name: load.name,
          fromYear: load.fromYear,
          ...(load.toYear !== undefined ? { toYear: load.toYear } : {}),
          teamId: load.teamId,
        });
      }
      return () => onDraftChange?.(null);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return (
      <div>
        {load && <p>{`Prefilled ${load.name} ${load.fromYear}-${load.toYear ?? ""}`}</p>}
        <button type="button" onClick={() => onAdd({ name: "Texas Rangers", fromYear: 2020, teamId: "team-tex" })}>
          Entry form stub
        </button>
        <button
          type="button"
          onClick={() => onDraftChange?.({ name: "San Diego Padres", fromYear: 2023, toYear: 2024, teamId: "team-pad" })}
        >
          Edit the years stub
        </button>
        <button type="button" onClick={() => onDraftChange?.(null)}>
          Clear the form stub
        </button>
        <button type="button" onClick={() => onDone?.()}>
          Close stub
        </button>
      </div>
    );
  },
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
import { BeforeSaveProvider, createBeforeSaveRegistry } from "../before-save";
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
const newItem = { level: "check", kind: "newPlayerCareer", playerId: "player-1", key: "newPlayerCareer:x" } as const;

const wikidataName = (enrichment: Record<string, unknown>) => ({
  kind: "player" as const,
  nameNormalized: "jackson merrill",
  printed: "Jackson Merrill",
  order: 0,
  cardOverride: false,
  scopeId: "leaf-1",
  row: {
    name: "Jackson Merrill",
    sportId: SPORT,
    status: "ready" as const,
    answer: { kind: "linkPlayer", playerId: "player-1", by: "operator" },
    enrichment,
  },
  printedOn: null,
});

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
          cardId: CARD,
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
          cardId: CARD,
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

    it("'Keep as is' is the explicit way out: stored at once, writes nothing to the player", async () => {
      renderTile([gapItem]);
      await click(screen.getByRole("button", { name: "Keep as is" }));
      expect(mutation("tidyCards.keepCareerGap")).toHaveBeenCalledWith({
        cardId: CARD,
        playerId: "player-1",
        teamId: "team-pad",
      });
      expect(mutation("players.addStint")).not.toHaveBeenCalled();
    });

    it("a refused 'Keep as is' shows inline and does not tell the walk", async () => {
      mutation("tidyCards.keepCareerGap").mockRejectedValueOnce(new Error("Server Error"));
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
      await click(screen.getByRole("button", { name: "Keep as is" }));
      expect(screen.getByRole("alert").textContent).toBe("Couldn't keep that. Try again.");
      expect(onAnswered).not.toHaveBeenCalled();
    });

    it("'+ Add stint' adds a team NB holds, with its years", async () => {
      renderTile([gapItem]);
      await click(screen.getByRole("button", { name: "+ Add stint for Jackson Merrill" }));
      await click(screen.getByRole("button", { name: "Entry form stub" }));
      expect(mutation("players.addStint")).toHaveBeenCalledWith({
        playerId: "player-1",
        teamId: "team-tex",
        fromYear: 2020,
        cardId: CARD,
      });
    });

    it("shows a refused write inline", async () => {
      mutation("players.addStint").mockRejectedValueOnce(new Error("Server Error"));
      renderTile([gapItem]);
      await click(screen.getByRole("button", { name: "Add to career" }));
      expect(screen.getByRole("alert").textContent).toBe("Couldn't add that stint. Try again.");
    });
  });

  describe("a new player's Wikidata career", () => {
    const career = {
      careerTeams: [
        { name: "San Diego Padres", fromYear: 2024 },
        { name: "San Antonio Missions", fromYear: 2023, toYear: 2023 },
      ],
    };
    const eras = (args: unknown) =>
      (args as { name: string }).name === "San Diego Padres"
        ? [{ _id: "team-pad", name: "Padres", label: "San Diego Padres", yearsActive: { from: 1969 } }]
        : [];

    it("says it comes from Wikidata, and which teams NB has and lacks", () => {
      queryResults["teams.erasByNameAndSport"] = eras;
      renderTile([newItem], context({ names: [wikidataName(career)] }));
      expect(screen.getByText("From Wikidata · new player only")).toBeTruthy();
      expect(screen.getByText("San Diego Padres · 2024–")).toBeTruthy();
      expect(screen.getByText("✓ team in NB")).toBeTruthy();
      expect(screen.getByText("San Antonio Missions · 2023")).toBeTruthy();
      expect(screen.getByText("team not in NB")).toBeTruthy();
    });

    it("'Add stints to {player}' adds only the teams NB holds", async () => {
      queryResults["teams.erasByNameAndSport"] = eras;
      renderTile([newItem], context({ names: [wikidataName(career)] }));
      await click(screen.getByRole("button", { name: "Add stints to Jackson Merrill" }));
      expect(mutation("players.addStint")).toHaveBeenCalledTimes(1);
      expect(mutation("players.addStint")).toHaveBeenCalledWith({
        playerId: "player-1",
        teamId: "team-pad",
        fromYear: 2024,
        cardId: CARD,
      });
    });

    it("a stint already on the player is not offered again", () => {
      queryResults["teams.erasByNameAndSport"] = eras;
      renderTile(
        [newItem],
        context({
          names: [wikidataName(career)],
          players: [player({ stints: [{ teamId: "team-pad", teamName: "San Diego Padres", fromYear: 2024 }] })],
        }),
      );
      expect(screen.queryByRole("button", { name: "Add stints to Jackson Merrill" })).toBeNull();
      expect(screen.getByText("✓ in the career")).toBeTruthy();
    });

    it("a team NB lacks is made inline, then added as a stint", async () => {
      queryResults["teams.erasByNameAndSport"] = eras;
      mutation("teams.findOrCreate").mockResolvedValue("team-mis");
      renderTile([newItem], context({ names: [wikidataName(career)] }));
      await click(screen.getByRole("button", { name: "+ New team San Antonio Missions" }));
      expect(screen.getByRole("group", { name: "New team: San Antonio Missions" })).toBeTruthy();
      expect(screen.getByText("Create team and add stint")).toBeTruthy();
      await click(screen.getByRole("button", { name: "Submit new team form" }));
      expect(mutation("teams.findOrCreate")).toHaveBeenCalledWith(
        expect.objectContaining({ name: "San Antonio Missions", sportId: SPORT }),
      );
      expect(mutation("players.addStint")).toHaveBeenCalledWith({
        playerId: "player-1",
        teamId: "team-mis",
        fromYear: 2023,
        toYear: 2023,
        cardId: CARD,
      });
    });

    it("the team made for a stint keeps Wikidata's id for that team (NEO-645)", async () => {
      queryResults["teams.erasByNameAndSport"] = eras;
      mutation("teams.findOrCreate").mockResolvedValue("team-mis");
      renderTile(
        [newItem],
        context({
          names: [
            wikidataName({
              careerTeams: [{ name: "San Antonio Missions", fromYear: 2023, toYear: 2023, wikidataId: "Q7414889" }],
            }),
          ],
        }),
      );
      await click(screen.getByRole("button", { name: "+ New team San Antonio Missions" }));
      await click(screen.getByRole("button", { name: "Submit new team form" }));
      expect(mutation("teams.findOrCreate").mock.calls[0][0]).toMatchObject({
        name: "San Antonio Missions",
        enrichment: { wikidataId: "Q7414889" },
      });
    });

    it("a career entry with no id sends no enrichment", async () => {
      queryResults["teams.erasByNameAndSport"] = eras;
      mutation("teams.findOrCreate").mockResolvedValue("team-mis");
      renderTile([newItem], context({ names: [wikidataName(career)] }));
      await click(screen.getByRole("button", { name: "+ New team San Antonio Missions" }));
      await click(screen.getByRole("button", { name: "Submit new team form" }));
      expect(mutation("teams.findOrCreate").mock.calls[0][0]).not.toHaveProperty("enrichment");
    });

    describe("the card's team, as a stint for the card's year (NEO-657)", () => {
      const renderWithSave = (ctx: TidyCardContext) => {
        const { registry, run } = createBeforeSaveRegistry();
        const props: TidyTileProps = {
          row: card(),
          context: ctx,
          attention: { level: "check", items: [newItem] },
          leafId: "leaf-1" as never,
          sportId: SPORT as never,
          leafCards: [],
          setName: "Set",
        };
        render(
          <BeforeSaveProvider value={registry}>
            <CareerTile {...props} />
          </BeforeSaveProvider>,
        );
        return run;
      };

      it("opens '+ Add stint' already holding the card's team and the year as both From and To", () => {
        renderTile([newItem], context({ names: [wikidataName({})] }));
        expect(screen.getByText("Prefilled San Diego Padres 2024-2024")).toBeTruthy();
        expect(screen.queryByRole("button", { name: "+ Add stint for Jackson Merrill" })).toBeNull();
      });

      it("a stint for that team that already counts for the year leaves the form closed", () => {
        renderTile(
          [newItem],
          context({
            names: [wikidataName({})],
            players: [player({ stints: [{ teamId: "team-pad", teamName: "San Diego Padres", fromYear: 2020, toYear: 2021 }] })],
          }),
        );
        expect(screen.queryByText(/Prefilled/)).toBeNull();
        expect(screen.getByRole("button", { name: "+ Add stint for Jackson Merrill" })).toBeTruthy();
      });

      it("a stint for that team that starts after the year does not count", () => {
        renderTile(
          [newItem],
          context({
            players: [player({ stints: [{ teamId: "team-pad", teamName: "San Diego Padres", fromYear: 2025 }] })],
          }),
        );
        expect(screen.getByText("Prefilled San Diego Padres 2024-2024")).toBeTruthy();
      });

      it.each([
        ["no team on the card", { teams: [] }],
        [
          "two teams on the card",
          {
            teams: [
              { teamId: "team-pad", name: "San Diego Padres", onCard: true, candidate: false },
              { teamId: "team-tex", name: "Texas Rangers", onCard: true, candidate: false },
            ],
          },
        ],
        [
          "a team only a name row offered",
          { teams: [{ teamId: "team-pad", name: "San Diego Padres", onCard: false, candidate: true }] },
        ],
      ])("%s: nothing is prefilled", (_label, over) => {
        renderTile([newItem], context(over));
        expect(screen.queryByText(/Prefilled/)).toBeNull();
        expect(screen.getByRole("button", { name: "+ Add stint for Jackson Merrill" })).toBeTruthy();
      });

      it("a set with no year: nothing is prefilled", () => {
        queryResults["selectorOptions.getAncestorChain"] = [{ _id: "y", level: "year", value: "Unknown" }];
        renderTile([newItem], context());
        expect(screen.queryByText(/Prefilled/)).toBeNull();
      });

      it("the team arriving later (answered on the Team tile) opens the form then", () => {
        const { rerender } = renderTile([newItem], context({ teams: [] }));
        expect(screen.queryByText(/Prefilled/)).toBeNull();
        const props: TidyTileProps = {
          row: card(),
          context: context(),
          attention: { level: "check", items: [newItem] },
          leafId: "leaf-1" as never,
          sportId: SPORT as never,
          leafCards: [],
          setName: "Set",
        };
        rerender(<CareerTile {...props} />);
        expect(screen.getByText("Prefilled San Diego Padres 2024-2024")).toBeTruthy();
      });

      it("Save & next with the form still open adds the stint as it shows, years the operator changed included", async () => {
        const run = renderWithSave(context());
        await click(screen.getByRole("button", { name: "Edit the years stub" }));
        let ok = false;
        await act(async () => {
          ok = await run();
        });
        expect(ok).toBe(true);
        expect(mutation("players.addStint")).toHaveBeenCalledTimes(1);
        expect(mutation("players.addStint")).toHaveBeenCalledWith({
          playerId: "player-1",
          teamId: "team-pad",
          fromYear: 2023,
          toYear: 2024,
          cardId: CARD,
        });
      });

      it("Save & next holds the card when the stint will not write", async () => {
        mutation("players.addStint").mockRejectedValueOnce(new Error("Server Error"));
        const run = renderWithSave(context());
        let ok = true;
        await act(async () => {
          ok = await run();
        });
        expect(ok).toBe(false);
      });

      it("closing the form writes nothing, on Save & next or ever", async () => {
        const run = renderWithSave(context());
        await click(screen.getByRole("button", { name: "Close stub" }));
        expect(screen.getByRole("button", { name: "+ Add stint for Jackson Merrill" })).toBeTruthy();
        await act(async () => {
          await run();
        });
        expect(mutation("players.addStint")).not.toHaveBeenCalled();
      });

      it("a form opened by hand after closing it is not added by Save & next", async () => {
        const run = renderWithSave(context());
        await click(screen.getByRole("button", { name: "Close stub" }));
        await click(screen.getByRole("button", { name: "+ Add stint for Jackson Merrill" }));
        expect(screen.queryByText(/Prefilled/)).toBeNull();
        await act(async () => {
          await run();
        });
        expect(mutation("players.addStint")).not.toHaveBeenCalled();
      });

      it("a stint for that team that ended before the year still counts (the career-gap rule ignores the end year), so the form stays closed", () => {
        renderTile(
          [newItem],
          context({
            players: [player({ stints: [{ teamId: "team-pad", teamName: "San Diego Padres", fromYear: 2018, toYear: 2020 }] })],
          }),
        );
        expect(screen.queryByText(/Prefilled/)).toBeNull();
      });

      it("a stint for a different team does not block the prefill, even one spanning the year", () => {
        renderTile(
          [newItem],
          context({
            players: [player({ stints: [{ teamId: "team-tex", teamName: "Texas Rangers", fromYear: 2020, toYear: 2026 }] })],
          }),
        );
        expect(screen.getByText("Prefilled San Diego Padres 2024-2024")).toBeTruthy();
      });

      it("a player with no new-player item (an existing player's gap) gets no prefilled form", () => {
        renderTile([gapItem], context({ players: [player({ stints: [] })] }));
        expect(screen.queryByText(/Prefilled/)).toBeNull();
      });

      it("Save & next after the form became unaddable adds nothing and lets the card move on", async () => {
        const run = renderWithSave(context());
        await click(screen.getByRole("button", { name: "Clear the form stub" }));
        let ok = false;
        await act(async () => {
          ok = await run();
        });
        expect(ok).toBe(true);
        expect(mutation("players.addStint")).not.toHaveBeenCalled();
      });

      it("'+ Add' writes the stint now and the form closes", async () => {
        renderTile([newItem], context());
        await click(screen.getByRole("button", { name: "Entry form stub" }));
        expect(mutation("players.addStint")).toHaveBeenCalledTimes(1);
        expect(screen.queryByText(/Prefilled/)).toBeNull();
      });
    });

    describe("the lookup for a team NB lacks (NEO-645)", () => {
      const missions = {
        careerTeams: [{ name: "San Antonio Missions", fromYear: 2023, toYear: 2023 }],
      };
      const open = async () => {
        queryResults["teams.erasByNameAndSport"] = eras;
        mutation("teams.findOrCreate").mockResolvedValue("team-mis");
        renderTile([newItem], context({ names: [wikidataName(missions)] }));
        await click(screen.getByRole("button", { name: "+ New team San Antonio Missions" }));
      };

      it("is asked for when the form opens, and says it is checking without holding create", async () => {
        await open();
        expect(mutation("tidyNames.requestTeamLookup")).toHaveBeenCalledWith({
          cardId: CARD,
          name: "San Antonio Missions",
          sportId: SPORT,
        });
        expect(screen.getByText("Checking for team details…").getAttribute("role")).toBe("status");
        await click(screen.getByRole("button", { name: "Submit new team form" }));
        expect(mutation("teams.findOrCreate")).toHaveBeenCalled();
        expect(mutation("players.addStint")).toHaveBeenCalled();
      });

      it("is not asked for before the form opens", () => {
        queryResults["teams.erasByNameAndSport"] = eras;
        renderTile([newItem], context({ names: [wikidataName(missions)] }));
        expect(mutation("tidyNames.requestTeamLookup")).not.toHaveBeenCalled();
      });

      it("a result pre-fills the location and rides onto the new team", async () => {
        queryResults["tidyNames.teamLookup"] = {
          status: "ready",
          enrichment: {
            league: "Texas League",
            location: "San Antonio",
            colors: { primary: "#003DA5" },
            espnId: "77",
            yearsActive: { from: 1994 },
          },
        };
        await open();
        expect(screen.queryByText("Checking for team details…")).toBeNull();
        await click(screen.getByRole("button", { name: "Submit new team form" }));
        expect(mutation("teams.findOrCreate").mock.calls[0][0]).toMatchObject({
          location: "San Antonio",
          name: "Missions",
          enrichment: {
            league: "Texas League",
            colors: { primary: "#003DA5" },
            espnId: "77",
            yearsActive: { from: 1994 },
          },
        });
      });

      it("a location that lands after the form opened pre-fills it, until the operator types", async () => {
        const ctx = context({ names: [wikidataName(missions)] });
        const element = () => (
          <CareerTile
            row={card()}
            context={ctx}
            attention={{ level: "check", items: [newItem] }}
            leafId={"leaf-1" as never}
            sportId={SPORT as never}
            leafCards={[]}
            setName="Set"
          />
        );
        queryResults["teams.erasByNameAndSport"] = eras;
        mutation("teams.findOrCreate").mockResolvedValue("team-mis");
        const view = render(element());
        await click(screen.getByRole("button", { name: "+ New team San Antonio Missions" }));
        queryResults["tidyNames.teamLookup"] = { status: "ready", enrichment: { location: "San Antonio" } };
        view.rerender(element());
        await click(screen.getByRole("button", { name: "Submit new team form" }));
        expect(mutation("teams.findOrCreate").mock.calls[0][0]).toMatchObject({
          location: "San Antonio",
          name: "Missions",
        });
      });

      it("Wikidata's own id for the stint's team wins over the lookup's", async () => {
        queryResults["tidyNames.teamLookup"] = { status: "ready", enrichment: { wikidataId: "Q1" } };
        queryResults["teams.erasByNameAndSport"] = eras;
        mutation("teams.findOrCreate").mockResolvedValue("team-mis");
        renderTile(
          [newItem],
          context({
            names: [
              wikidataName({
                careerTeams: [{ name: "San Antonio Missions", fromYear: 2023, toYear: 2023, wikidataId: "Q7414889" }],
              }),
            ],
          }),
        );
        await click(screen.getByRole("button", { name: "+ New team San Antonio Missions" }));
        await click(screen.getByRole("button", { name: "Submit new team form" }));
        expect(mutation("teams.findOrCreate").mock.calls[0][0]).toMatchObject({
          enrichment: { wikidataId: "Q7414889" },
        });
      });

      it("a lookup that found nothing, or could not be asked for, stops saying it is checking", async () => {
        queryResults["tidyNames.teamLookup"] = { status: "error" };
        await open();
        expect(screen.queryByText("Checking for team details…")).toBeNull();
      });

      it("a failed ask is silent and stops the status", async () => {
        queryResults["teams.erasByNameAndSport"] = eras;
        mutation("tidyNames.requestTeamLookup").mockRejectedValue(new Error("Server Error"));
        renderTile([newItem], context({ names: [wikidataName(missions)] }));
        await click(screen.getByRole("button", { name: "+ New team San Antonio Missions" }));
        expect(screen.queryByText("Checking for team details…")).toBeNull();
        expect(screen.queryByRole("alert")).toBeNull();
      });
    });

    it("'Not now' leaves the stint off and writes nothing", async () => {
      queryResults["teams.erasByNameAndSport"] = eras;
      renderTile([newItem], context({ names: [wikidataName(career)] }));
      await click(screen.getByRole("button", { name: "Not now San Antonio Missions" }));
      expect(screen.queryByText("San Antonio Missions · 2023")).toBeNull();
      expect(Object.values(mutations).every((m) => m.mock.calls.length === 0)).toBe(true);
    });

    it("a team Wikidata gave without years is asked for them, then added to the player", async () => {
      queryResults["teams.erasByNameAndSport"] = eras;
      mockConvexQuery.mockResolvedValue([{ _id: "team-tex", name: "Texas Longhorns", label: "Texas Longhorns" }]);
      renderTile([newItem], context({ names: [wikidataName({ undatedCareerTeams: ["Texas Longhorns"] })] }));
      await click(screen.getByRole("button", { name: "Add years for Texas Longhorns" }));
      fireEvent.change(screen.getByLabelText("From year for Texas Longhorns"), { target: { value: "2019" } });
      await click(screen.getByRole("button", { name: "Save years for Texas Longhorns" }));
      expect(mockConvexQuery).toHaveBeenCalledWith("teams.erasByNameAndSport", {
        name: "Texas Longhorns",
        sportId: SPORT,
      });
      expect(mutation("players.addStint")).toHaveBeenCalledWith({
        playerId: "player-1",
        teamId: "team-tex",
        fromYear: 2019,
        cardId: CARD,
      });
    });
  });
});
