/**
 * NEO-645 tile 5, "Team": a skeleton while the spelling is unsettled; an
 * unanswered printed team name (candidates, link with "Remember as a name",
 * New team, Not a team); a card with no team (chips and their pre-fill rules,
 * "No team on this card"); the purple fill note; and the guarded "Apply to all".
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
vi.mock("convex/react", () => ({
  useQuery: (ref: string, args: unknown) => (args === "skip" ? undefined : queryResults[ref]),
  useMutation: (ref: string) => mutation(ref),
  useConvex: () => ({ query: vi.fn() }),
}));

vi.mock("../../EntityLinkSearch", () => ({
  default: ({
    kind,
    onSelect,
    onCancel,
  }: {
    kind: string;
    onSelect: (id: string, n: string) => void;
    onCancel: () => void;
  }) => (
    <div>
      <button type="button" onClick={() => onSelect("team-9", "Someone")}>
        {`Pick a ${kind}`}
      </button>
      <button type="button" onClick={onCancel}>
        Cancel linking
      </button>
    </div>
  ),
}));

/** The search owns its own test file; here it is a pick button and the caller's checkbox. */
vi.mock("../../../entities/TeamMatchSearch", () => ({
  TeamMatchSearch: ({
    onPick,
    children,
  }: {
    onPick: (id: string, n: string) => void;
    children?: React.ReactNode;
  }) => (
    <div>
      <button type="button" onClick={() => onPick("team-7", "San Diego Padres")}>
        Pick San Diego Padres
      </button>
      {children}
    </div>
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
import TeamTile from "./TeamTile";
import type { TidyAttentionItem } from "../../../../convex/features/cardAttention";
import type { TidyAttention, TidyCardContext, TidyRow, TidyTileProps } from "../tile-types";

const CARD = "card-1";
const SPORT = "sport-1";

const card = (extra: Record<string, unknown> = {}) =>
  ({ _id: CARD, cardNumber: "USC42", cardName: "Jackson Merrill", ...extra }) as unknown as TidyRow;

const teamName = (over: Record<string, unknown> = {}) => ({
  kind: "team" as const,
  nameNormalized: "padres",
  printed: "Padres",
  order: 0,
  cardOverride: false,
  scopeId: "leaf-1",
  row: { name: "Padres", sportId: SPORT, status: "ready" as const },
  printedOn: null,
  ...over,
});

const context = (over: Record<string, unknown> = {}) =>
  ({
    cardId: CARD,
    names: [],
    players: [],
    playersMore: false,
    teams: [],
    linkedFor: [],
    ...over,
  }) as unknown as NonNullable<TidyCardContext>;

const nameItem: TidyAttentionItem = { level: "fix", kind: "teamName", names: ["Padres"] };
const noTeamItem: TidyAttentionItem = { level: "fix", kind: "noTeam" };

function renderTile(
  opts: {
    row?: TidyRow;
    ctx?: TidyCardContext | undefined;
    items?: TidyAttentionItem[];
    leafCards?: TidyRow[];
    onAnswered?: () => void;
  } = {},
) {
  const props: TidyTileProps = {
    row: opts.row ?? card({ pendingTeamNames: ["Padres"] }),
    context: "ctx" in opts ? opts.ctx : context({ names: [teamName()] }),
    attention: { level: "fix", items: opts.items ?? [nameItem] },
    leafId: "leaf-1" as never,
    sportId: SPORT as never,
    leafCards: opts.leafCards ?? [],
    setName: "Set",
  };
  return render(
    <AnsweredProvider value={opts.onAnswered ?? (() => {})}>
      <TeamTile {...props} />
    </AnsweredProvider>,
  );
}

const click = (el: HTMLElement) => act(async () => fireEvent.click(el));

beforeEach(() => {
  for (const k of Object.keys(queryResults)) delete queryResults[k];
  for (const k of Object.keys(mutations)) delete mutations[k];
});

describe("TeamTile", () => {
  it("is a skeleton, with nothing to press, while a teams disagreement is unsettled", () => {
    renderTile({ items: [{ level: "fix", kind: "sourcesDisagree", field: "teams" }] });
    expect(screen.getByRole("group", { name: "Team" }).getAttribute("data-tidy-level")).toBe("waiting");
    expect(screen.getByText("Waiting on the spelling above")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders nothing for a card with no team names, no team and nothing to ask", () => {
    const { container } = renderTile({ row: card(), ctx: context(), items: [] });
    expect(container.textContent).toBe("");
  });

  describe("an unanswered printed name", () => {
    it("links the lone exact match and remembers the printed name as an alias for it", async () => {
      queryResults["teams.nearMatches"] = [
        { _id: "team-7", name: "San Diego Padres", confidence: "exact", yearsActive: { from: 1969 } },
      ];
      renderTile();
      expect(screen.getByRole("group", { name: "Team" }).getAttribute("data-tidy-level")).toBe("fix");
      await click(screen.getByRole("button", { name: "Link to San Diego Padres · 1969–present" }));
      expect(mutation("tidyNames.answerName")).toHaveBeenCalledWith({
        cardId: CARD,
        kind: "team",
        name: "Padres",
        answer: { kind: "linkTeam", teamId: "team-7", saveAsAlias: true },
      });
    });

    it("a string that is another team's LOCATION starts with 'Remember' unticked", async () => {
      queryResults["teams.nearMatches"] = [
        { _id: "team-1", name: "Padres", confidence: "close", locationMatch: true },
      ];
      renderTile();
      const box = screen.getByRole("checkbox", { name: "Remember “Padres” as a name for this team" });
      expect((box as HTMLInputElement).checked).toBe(false);
      await click(screen.getByRole("button", { name: "Pick San Diego Padres" }));
      expect(mutation("tidyNames.answerName")).toHaveBeenCalledWith({
        cardId: CARD,
        kind: "team",
        name: "Padres",
        answer: { kind: "linkTeam", teamId: "team-7" },
      });
    });

    it("the 'Remember' box is a 24px target and holds with aria-disabled while a write is in flight", async () => {
      queryResults["teams.nearMatches"] = [];
      renderTile();
      const box = screen.getByRole("checkbox", { name: "Remember “Padres” as a name for this team" }) as HTMLInputElement;
      expect(box.className).toContain("h-6");
      expect(box.closest("label")?.className).toContain("min-h-6");
      mutation("tidyNames.answerName").mockReturnValueOnce(new Promise(() => {}));
      await click(screen.getByRole("button", { name: "Not a team" }));
      expect(box.getAttribute("aria-disabled")).toBe("true");
      expect(box.disabled).toBe(false);
      const before = box.checked;
      await click(box);
      expect(box.checked).toBe(before);
    });

    it("a pick from the search remembers the name unless the box is cleared", async () => {
      queryResults["teams.nearMatches"] = [];
      renderTile();
      const box = screen.getByRole("checkbox", { name: "Remember “Padres” as a name for this team" });
      expect((box as HTMLInputElement).checked).toBe(true);
      await click(box);
      await click(screen.getByRole("button", { name: "Pick San Diego Padres" }));
      expect(mutation("tidyNames.answerName")).toHaveBeenCalledWith({
        cardId: CARD,
        kind: "team",
        name: "Padres",
        answer: { kind: "linkTeam", teamId: "team-7" },
      });
    });

    it("offers each team the name could mean, by era, and links the one picked", async () => {
      queryResults["teams.nearMatches"] = [];
      queryResults["teams.getManyByIds"] = [
        { _id: "t-new", name: "Padres", location: "San Diego", yearsActive: { from: 1969 } },
        { _id: "t-old", name: "Padres", location: "San Diego", yearsActive: { from: 1936, to: 1968 } },
      ];
      renderTile({
        ctx: context({
          names: [teamName({ row: { name: "Padres", sportId: SPORT, status: "ready", candidateTeamIds: ["t-new", "t-old"] } })],
        }),
      });
      // The lead-in is a live region: announced a beat after the rows are there.
      expect(await screen.findByText("We've got 2 teams by that name. Pick the one on this card.")).toBeTruthy();
      const links = screen.getAllByRole("button", { name: /^Link to San Diego Padres/ });
      expect(links).toHaveLength(2);
      expect(new Set(links.map((b) => b.getAttribute("aria-label") ?? b.textContent)).size).toBe(2);
      await click(links[0]);
      expect(mutation("tidyNames.answerName")).toHaveBeenCalledTimes(1);
    });

    it("lists the candidates newest era first, not in candidateTeamIds order, undated last", () => {
      queryResults["teams.nearMatches"] = [];
      queryResults["teams.getManyByIds"] = [
        { _id: "t-undated", name: "Athletics", location: "Oakland" },
        { _id: "t-old", name: "Athletics", location: "Oakland", yearsActive: { from: 1968, to: 2024 } },
        { _id: "t-new", name: "Athletics", yearsActive: { from: 2025 } },
      ];
      renderTile({
        ctx: context({
          names: [
            teamName({
              row: {
                name: "Athletics",
                sportId: SPORT,
                status: "ready",
                candidateTeamIds: ["t-undated", "t-old", "t-new"],
              },
            }),
          ],
        }),
      });
      const links = screen.getAllByRole("button", { name: /^Link to / });
      expect(links.map((b) => b.textContent)).toEqual([
        "Link to Athletics · 2025–present",
        "Link to Oakland Athletics · 1968–2024",
        "Link to Oakland Athletics",
      ]);
    });

    it("holds '+ New team' until the near matches answer, and says why", async () => {
      renderTile();
      expect(screen.getByText("Checking for teams by that name…").getAttribute("role")).toBe("status");
      const add = screen.getByRole("button", { name: "+ New team" });
      expect(add.getAttribute("aria-disabled")).toBe("true");
      await click(add);
      expect(screen.queryByRole("group", { name: "New team: Padres" })).toBeNull();
    });

    it("says nothing about checking once the near matches answered", () => {
      queryResults["teams.nearMatches"] = [];
      renderTile();
      expect(screen.queryByText("Checking for teams by that name…")).toBeNull();
      expect(screen.getByRole("button", { name: "+ New team" }).getAttribute("aria-disabled")).toBeNull();
    });

    it("the candidates list is named from its first render", () => {
      queryResults["teams.nearMatches"] = [];
      queryResults["teams.getManyByIds"] = [
        { _id: "t-new", name: "Padres", location: "San Diego", yearsActive: { from: 1969 } },
        { _id: "t-old", name: "Padres", location: "San Diego", yearsActive: { from: 1936, to: 1968 } },
      ];
      renderTile({
        ctx: context({
          names: [teamName({ row: { name: "Padres", sportId: SPORT, status: "ready", candidateTeamIds: ["t-new", "t-old"] } })],
        }),
      });
      expect(screen.getByRole("list", { name: "We've got 2 teams by that name. Pick the one on this card." })).toBeTruthy();
    });

    it("'Not a team' answers notEntity for the name", async () => {
      queryResults["teams.nearMatches"] = [];
      renderTile();
      await click(screen.getByRole("button", { name: "Not a team" }));
      expect(mutation("tidyNames.answerName")).toHaveBeenCalledWith({
        cardId: CARD,
        kind: "team",
        name: "Padres",
        answer: { kind: "notEntity" },
      });
    });

    it("'+ New team' opens the form inside the tile; creating it links the name", async () => {
      queryResults["teams.nearMatches"] = [];
      mutation("teams.findOrCreate").mockResolvedValue("team-new");
      renderTile();
      await click(screen.getByRole("button", { name: "+ New team" }));
      expect(screen.getByRole("group", { name: "New team: Padres" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Cancel new team" })).toBeTruthy();
      await click(screen.getByRole("button", { name: "Submit new team form" }));
      expect(mutation("teams.findOrCreate")).toHaveBeenCalledWith(expect.objectContaining({ name: "Padres", sportId: SPORT }));
      expect(mutation("tidyNames.answerName")).toHaveBeenCalledWith({
        cardId: CARD,
        kind: "team",
        name: "Padres",
        answer: { kind: "linkTeam", teamId: "team-new" },
      });
      // Closed again once it is made.
      expect(screen.queryByRole("group", { name: "New team: Padres" })).toBeNull();
    });

    it("a new team keeps the lookup's league suggestion, era, colours and ids (NEO-645)", async () => {
      queryResults["teams.nearMatches"] = [];
      mutation("teams.findOrCreate").mockResolvedValue("team-new");
      renderTile({
        ctx: context({
          names: [
            teamName({
              row: {
                name: "Padres",
                sportId: SPORT,
                status: "ready",
                enrichment: {
                  league: "Major League Baseball",
                  location: "San Diego",
                  yearsActive: { from: 1969 },
                  colors: { primary: "#2f241d", secondary: "#ffc425" },
                  espnId: "25",
                  wikidataId: "Q650850",
                  // Not team facts: never forwarded.
                  description: "ignored",
                },
              },
            }),
          ],
        }),
      });
      await click(screen.getByRole("button", { name: "+ New team" }));
      await click(screen.getByRole("button", { name: "Submit new team form" }));
      const sent = mutation("teams.findOrCreate").mock.calls[0][0] as Record<string, unknown>;
      expect(sent.enrichment).toEqual({
        league: "Major League Baseball",
        yearsActive: { from: 1969 },
        colors: { primary: "#2f241d", secondary: "#ffc425" },
        espnId: "25",
        wikidataId: "Q650850",
      });
    });

    it("a lookup with nothing to carry sends no enrichment key", async () => {
      queryResults["teams.nearMatches"] = [];
      mutation("teams.findOrCreate").mockResolvedValue("team-new");
      renderTile();
      await click(screen.getByRole("button", { name: "+ New team" }));
      await click(screen.getByRole("button", { name: "Submit new team form" }));
      expect(mutation("teams.findOrCreate").mock.calls[0][0]).not.toHaveProperty("enrichment");
    });

    it("a name another team holds as an alias becomes 'Link to {holder}', and creating is held", async () => {
      queryResults["teams.nearMatches"] = [];
      queryResults["teams.nameHeldAsAliasBy"] = [
        { id: "team-holder", name: "San Diego Padres", yearsActive: { from: 1969 } },
      ];
      renderTile();
      await click(screen.getByRole("button", { name: "+ New team" }));
      await click(screen.getByRole("button", { name: "Link to San Diego Padres · 1969–present" }));
      expect(mutation("tidyNames.answerName")).toHaveBeenCalledWith(
        expect.objectContaining({ answer: expect.objectContaining({ kind: "linkTeam", teamId: "team-holder" }) }),
      );
      expect(mutation("teams.findOrCreate")).not.toHaveBeenCalled();
    });

    it("two names on one card carry the printed name in every control", () => {
      queryResults["teams.nearMatches"] = [];
      renderTile({
        ctx: context({
          names: [
            teamName(),
            teamName({ nameNormalized: "dodgers", printed: "Dodgers", order: 1, row: { name: "Dodgers", sportId: SPORT, status: "ready" } }),
          ],
        }),
      });
      expect(screen.getByRole("button", { name: "Not a team Padres" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Not a team Dodgers" })).toBeTruthy();
    });
  });

  describe("an answered name", () => {
    const linked = (answer: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
      context({
        names: [teamName({ row: { name: "Padres", sportId: SPORT, status: "ready", answer } })],
        teams: [{ teamId: "team-7", name: "San Diego Padres", onCard: true, candidate: false }],
        ...extra,
      });

    it("a team we linked says why, is plain, and Change clears the answer", async () => {
      renderTile({
        row: card({ teamOnCardIds: ["team-7"] }),
        items: [],
        ctx: linked(
          { kind: "linkTeam", teamId: "team-7", by: "auto", autoReason: "careerTeam" },
          {
            linkedFor: [{ kind: "team", teamId: "team-7", reason: "careerTeam" }],
            players: [
              {
                playerId: "player-1",
                name: "Jackson Merrill",
                sportId: SPORT,
                stints: [{ teamId: "team-7", teamName: "San Diego Padres", fromYear: 2024 }],
                stintsMore: false,
              },
            ],
          },
        ),
      });
      expect(screen.getByRole("group", { name: "Team" }).getAttribute("data-tidy-level")).toBe("plain");
      expect(screen.getByText("San Diego Padres")).toBeTruthy();
      // The team row's own words: the player row's "the only one on file…" is about a person.
      expect(screen.getByText("Linked for you: Jackson Merrill played here")).toBeTruthy();
      expect(screen.queryByText(/only one on file/)).toBeNull();
      await click(screen.getByRole("button", { name: "Change team" }));
      expect(mutation("tidyNames.answerName")).toHaveBeenCalledWith({
        cardId: CARD,
        kind: "team",
        name: "Padres",
        answer: { kind: "clear" },
      });
    });

    it("'Not a team' reads as answered and Change brings the question back", async () => {
      renderTile({
        row: card(),
        items: [],
        ctx: linked({ kind: "notEntity", by: "operator" }, { teams: [] }),
      });
      expect(screen.getByText("is not a team.")).toBeTruthy();
      await click(screen.getByRole("button", { name: "Change team" }));
      expect(mutation("tidyNames.answerName")).toHaveBeenCalledWith(
        expect.objectContaining({ answer: { kind: "clear" } }),
      );
    });
  });

  describe("a card with no team", () => {
    const player = {
      playerId: "player-1",
      name: "Jimmie Foxx",
      sportId: SPORT,
      stints: [
        { teamId: "t-a", teamName: "Philadelphia Athletics", fromYear: 1925, toYear: 1935 },
        { teamId: "t-b", teamName: "Boston Red Sox", fromYear: 1936, toYear: 1942 },
      ],
      stintsMore: false,
    };
    const items = [noTeamItem];
    const row = () => card({ playerIds: ["player-1"] });
    const ctx = () => context({ players: [player] });

    it("pre-fills a stint that covers the set's year and saves it with the Save button", async () => {
      queryResults["cardChecklist.suggestedTeamsForCard"] = [
        { teamId: "t-b", name: "Boston Red Sox", label: "Boston Red Sox", source: "career", playerName: "Jimmie Foxx", inSetYear: true },
      ];
      renderTile({ row: row(), ctx: ctx(), items });
      const chip = screen.getByRole("button", { name: /Boston Red Sox/ });
      expect(chip.getAttribute("aria-pressed")).toBe("true");
      expect(screen.getByText("Suggested from career history.")).toBeTruthy();
      await click(screen.getByRole("button", { name: "Save team" }));
      expect(mutation("selectorOptions.updateCard")).toHaveBeenCalledWith({ id: CARD, teamOnCardIds: ["t-b"] });
    });

    it("never pre-fills a whole-career fallback, and shows the player's years with each team", async () => {
      queryResults["cardChecklist.suggestedTeamsForCard"] = [
        { teamId: "t-a", name: "Philadelphia Athletics", label: "Philadelphia Athletics", source: "career", playerName: "Jimmie Foxx", inSetYear: false, uncoveredSetYear: 2025 },
        { teamId: "t-b", name: "Boston Red Sox", label: "Boston Red Sox", source: "career", playerName: "Jimmie Foxx", inSetYear: false, uncoveredSetYear: 2025 },
      ];
      renderTile({ row: row(), ctx: ctx(), items });
      for (const chip of screen.getAllByRole("button", { name: /Athletics|Red Sox/ })) {
        expect(chip.getAttribute("aria-pressed")).toBe("false");
      }
      expect(screen.getByRole("button", { name: /Philadelphia Athletics · Jimmie Foxx 1925–1935/ })).toBeTruthy();
      expect(screen.getByText("No 2025 team on file. Here’s the whole career, so pick the one on the card.")).toBeTruthy();
      // Nothing chosen: there is nothing to save, so there is no Save button at all.
      expect(screen.queryByRole("button", { name: /^Save teams?$/ })).toBeNull();
      expect(mutation("selectorOptions.updateCard")).not.toHaveBeenCalled();
      await click(screen.getByRole("button", { name: /Boston Red Sox/ }));
      await click(screen.getByRole("button", { name: "Save team" }));
      // Taking the chip back off puts the button away again.

      expect(mutation("selectorOptions.updateCard")).toHaveBeenCalledWith({ id: CARD, teamOnCardIds: ["t-b"] });
    });

    it("never pre-fills against a team the listing names (rule 8)", () => {
      queryResults["cardChecklist.suggestedTeamsForCard"] = [
        { teamId: "t-b", name: "Boston Red Sox", label: "Boston Red Sox", source: "career", playerName: "Jimmie Foxx", inSetYear: true },
      ];
      queryResults["teams.erasByNameAndSport"] = [
        { _id: "t-a", name: "Philadelphia Athletics", label: "Philadelphia Athletics" },
      ];
      renderTile({ row: card({ playerIds: ["player-1"], bscTeamName: "Philadelphia Athletics" }), ctx: ctx(), items });
      for (const chip of screen.getAllByRole("button", { name: /Athletics|Red Sox/ })) {
        expect(chip.getAttribute("aria-pressed")).toBe("false");
      }
      expect(
        screen.getByText("From the career. The listing names a different team, so pick the one on the card."),
      ).toBeTruthy();
      expect(
        screen.getByText("The listing names “Philadelphia Athletics”. Pick it if it matches the card."),
      ).toBeTruthy();
    });

    it("a lookup that never answered holds nothing back: the career pre-fills as usual", () => {
      queryResults["cardChecklist.suggestedTeamsForCard"] = [
        { teamId: "t-b", name: "Boston Red Sox", label: "Boston Red Sox", source: "career", playerName: "Jimmie Foxx", inSetYear: true },
      ];
      renderTile({ row: card({ playerIds: ["player-1"], teamCheckOutcome: "gaveUp" }), ctx: ctx(), items });
      expect(screen.getByRole("button", { name: /Boston Red Sox/ }).getAttribute("aria-pressed")).toBe("true");
      expect(screen.getByText("We couldn’t get a team from the listing for this card. Pick the one on the card.")).toBeTruthy();
    });

    it("'No team on this card' records the answer", async () => {
      queryResults["cardChecklist.suggestedTeamsForCard"] = [];
      mutation("cardChecklist.confirmCardNoTeam").mockResolvedValue({ confirmed: true, stamped: true });
      renderTile({ row: row(), ctx: ctx(), items });
      await click(screen.getByRole("button", { name: "No team on this card" }));
      expect(mutation("cardChecklist.confirmCardNoTeam")).toHaveBeenCalledWith({ cardId: CARD });
    });

    it("says so when the card turned out to have teams", async () => {
      queryResults["cardChecklist.suggestedTeamsForCard"] = [];
      mutation("cardChecklist.confirmCardNoTeam").mockResolvedValue({ confirmed: false, stamped: false });
      renderTile({ row: row(), ctx: ctx(), items });
      await click(screen.getByRole("button", { name: "No team on this card" }));
      expect(screen.getByRole("alert").textContent).toMatch(/nothing to confirm/);
    });

    it("shows Save team only once there is a chip to save, and puts it away when the last one comes off", async () => {
      queryResults["cardChecklist.suggestedTeamsForCard"] = [
        { teamId: "t-b", name: "Boston Red Sox", label: "Boston Red Sox", source: "career", playerName: "Jimmie Foxx", inSetYear: false, uncoveredSetYear: 2025 },
      ];
      renderTile({ row: row(), ctx: ctx(), items });
      expect(screen.queryByRole("button", { name: /^Save teams?$/ })).toBeNull();
      // The way out of the question is still there.
      expect(screen.getByRole("button", { name: "No team on this card" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Other team…" })).toBeTruthy();
      await click(screen.getByRole("button", { name: /Boston Red Sox/ }));
      expect(screen.getByRole("button", { name: "Save team" })).toBeTruthy();
      await click(screen.getByRole("button", { name: /Boston Red Sox/ }));
      expect(screen.queryByRole("button", { name: /^Save teams?$/ })).toBeNull();
    });

    it("a team picked with Other team… shows its league and years on its chip", async () => {
      queryResults["cardChecklist.suggestedTeamsForCard"] = [];
      queryResults["teams.getManyByIds"] = [
        { _id: "team-9", name: "Orioles", location: "Baltimore", leagueId: "l-mlb", yearsActive: { from: 1954 } },
      ];
      queryResults["leagues.list"] = [{ _id: "l-mlb", name: "Major League Baseball", abbreviation: "MLB" }];
      renderTile({ row: row(), ctx: ctx(), items });
      await click(screen.getByRole("button", { name: "Other team…" }));
      await click(screen.getByRole("button", { name: "Pick a team" }));
      const chip = screen.getByRole("button", { name: "Baltimore Orioles · MLB · 1954–present" });
      expect(chip.getAttribute("aria-pressed")).toBe("true");
    });

    it("keeps an open Other team… search and the teams picked in it when the card's context arrives", async () => {
      queryResults["cardChecklist.suggestedTeamsForCard"] = [];
      queryResults["teams.getManyByIds"] = [
        { _id: "team-9", name: "Orioles", location: "Baltimore", leagueId: "l-mlb", yearsActive: { from: 1954 } },
      ];
      queryResults["leagues.list"] = [{ _id: "l-mlb", name: "Major League Baseball", abbreviation: "MLB" }];
      const props = (ctx: TidyCardContext | undefined): TidyTileProps => ({
        row: row(),
        context: ctx,
        attention: { level: "fix", items },
        leafId: "leaf-1" as never,
        sportId: SPORT as never,
        leafCards: [],
        setName: "Set",
      });
      const tree = (ctx: TidyCardContext | undefined) => (
        <AnsweredProvider value={() => {}}>
          <TeamTile {...props(ctx)} />
        </AnsweredProvider>
      );
      // The context query has not answered: the chips are the tile's only child.
      const { rerender } = render(tree(undefined));
      await click(screen.getByRole("button", { name: "Other team…" }));
      const pick = screen.getByRole("button", { name: "Pick a team" });
      await click(pick);
      const chip = screen.getByRole("button", { name: /Baltimore Orioles/ });
      // Then it does: the same chips now sit among the tile's other children.
      rerender(tree(ctx()));
      expect(screen.getByRole("button", { name: /Baltimore Orioles/ })).toBe(chip);
      expect(chip.isConnected).toBe(true);
      expect(chip.getAttribute("aria-pressed")).toBe("true");
      await click(screen.getByRole("button", { name: "Save team" }));
      expect(mutation("selectorOptions.updateCard")).toHaveBeenCalledWith({ id: CARD, teamOnCardIds: ["team-9"] });
    });

    it("keeps the Other team… search itself open across the same switch", async () => {
      queryResults["cardChecklist.suggestedTeamsForCard"] = [];
      const props = (ctx: TidyCardContext | undefined): TidyTileProps => ({
        row: row(),
        context: ctx,
        attention: { level: "fix", items },
        leafId: "leaf-1" as never,
        sportId: SPORT as never,
        leafCards: [],
        setName: "Set",
      });
      const tree = (ctx: TidyCardContext | undefined) => (
        <AnsweredProvider value={() => {}}>
          <TeamTile {...props(ctx)} />
        </AnsweredProvider>
      );
      const { rerender } = render(tree(undefined));
      await click(screen.getByRole("button", { name: "Other team…" }));
      const pick = screen.getByRole("button", { name: "Pick a team" });
      rerender(tree(ctx()));
      expect(screen.getByRole("button", { name: "Pick a team" })).toBe(pick);
    });

    it("'Other team…' adds a searched team to the choice", async () => {
      queryResults["cardChecklist.suggestedTeamsForCard"] = [];
      renderTile({ row: row(), ctx: ctx(), items });
      await click(screen.getByRole("button", { name: "Other team…" }));
      await click(screen.getByRole("button", { name: "Pick a team" }));
      await click(screen.getByRole("button", { name: "Save team" }));
      expect(mutation("selectorOptions.updateCard")).toHaveBeenCalledWith({ id: CARD, teamOnCardIds: ["team-9"] });
    });
  });

  describe("a card that has its team", () => {
    const base = () => ({
      row: card({
        playerIds: ["player-1"],
        teamOnCardIds: ["team-7"],
        tidyChecks: [{ kind: "teamFill", teamIds: ["team-7"], reason: "career" }],
      }),
      items: [] as TidyAttention["items"],
      ctx: context({
        players: [{ playerId: "player-1", name: "Jackson Merrill", sportId: SPORT, stints: [], stintsMore: false }],
        teams: [{ teamId: "team-7", name: "San Diego Padres", onCard: true, candidate: false }],
      }),
    });

    it("says the commit filled it in, from the career or from the other cards", () => {
      const { unmount } = renderTile(base());
      expect(screen.getByText("Team filled from the player's career")).toBeTruthy();
      unmount();
      const other = base();
      other.row = card({
        playerIds: ["player-1"],
        teamOnCardIds: ["team-7"],
        tidyChecks: [{ kind: "teamFill", teamIds: ["team-7"], reason: "otherCards" }],
      });
      renderTile(other);
      expect(screen.getByText("Team filled from the player's other cards")).toBeTruthy();
    });

    it("drops the note once the operator changed the team by hand", () => {
      const b = base();
      b.row = card({
        playerIds: ["player-1"],
        teamOnCardIds: ["team-8"],
        tidyChecks: [{ kind: "teamFill", teamIds: ["team-7"], reason: "career" }],
      });
      renderTile(b);
      expect(screen.queryByText(/Team filled from/)).toBeNull();
    });

    it("Change swaps the team on this card only", async () => {
      renderTile(base());
      await click(screen.getByRole("button", { name: "Change team" }));
      await click(screen.getByRole("button", { name: "Pick a team" }));
      expect(mutation("selectorOptions.updateCard")).toHaveBeenCalledWith({ id: CARD, teamOnCardIds: ["team-9"] });
    });

    it("'+ Another team' adds one", async () => {
      renderTile(base());
      await click(screen.getByRole("button", { name: "+ Another team" }));
      await click(screen.getByRole("button", { name: "Pick a team" }));
      expect(mutation("selectorOptions.updateCard")).toHaveBeenCalledWith({
        id: CARD,
        teamOnCardIds: ["team-7", "team-9"],
      });
    });

    describe("Apply to all", () => {
      const sibling = (id: string, extra: Record<string, unknown> = {}) =>
        card({ _id: id, playerIds: ["player-1"], ...extra });

      it("proposes only this player's other teamless, unclaimed cards, and the server decides", async () => {
        const b = base();
        renderTile({
          ...b,
          leafCards: [
            b.row,
            sibling("c2"),
            sibling("c3"),
            sibling("c4", { teamOnCardIds: ["team-1"] }),
            sibling("c5", { bscTeamName: "Padres" }),
            sibling("c6", { pendingTeamNames: ["Padres"] }),
            sibling("c7", { teamNoneConfirmedAt: 1 }),
            sibling("c8", { sourceDisagreements: [{ field: "teams", values: [] }] }),
            sibling("c9", { teamCheckOutcome: "checklist" }),
            sibling("c10", { playerIds: ["player-1", "player-2"] }),
            sibling("c11", { playerIds: ["player-2"] }),
          ],
        });
        await click(screen.getByRole("button", { name: "Apply to all 2 other Jackson Merrill cards" }));
        expect(mutation("tidyCards.applyTeamToPlayerCards")).toHaveBeenCalledWith({
          sourceCardId: CARD,
          teamId: "team-7",
          cardIds: ["c2", "c3"],
        });
      });

      it("reads every refusal the way the server does: a pending player name, a blank pending team name, a whitespace listing team", async () => {
        const b = base();
        renderTile({
          ...b,
          leafCards: [
            b.row,
            sibling("c2"),
            // A second name nobody has answered: `cardTakesTeamFill` refuses on its length.
            sibling("c3", { pendingPlayerNames: ["Jackson Merril"] }),
            sibling("c4", { pendingPlayerNames: [""] }),
            sibling("c5", { pendingTeamNames: [""] }),
            sibling("c6", { bscTeamName: " " }),
          ],
        });
        // Only c2 is left to offer, so the button speaks in the singular.
        await click(screen.getByRole("button", { name: "Apply to the other Jackson Merrill card" }));
        expect(mutation("tidyCards.applyTeamToPlayerCards")).toHaveBeenCalledWith({
          sourceCardId: CARD,
          teamId: "team-7",
          cardIds: ["c2"],
        });
      });

      it("offers nothing when the only other cards still have a pending player name", () => {
        const b = base();
        renderTile({
          ...b,
          leafCards: [b.row, sibling("c2", { pendingPlayerNames: ["Jackson Merril"] })],
        });
        expect(screen.queryByRole("button", { name: /Apply to/ })).toBeNull();
      });

      it.each([
        [{ applied: 2, skipped: 0 }, "Applied to 2 cards."],
        [{ applied: 1, skipped: 1 }, "Applied to 1 card. 1 left as it was."],
        [{ applied: 0, skipped: 2 }, "No cards changed."],
      ])("shows the server's %j as %j", async (result, text) => {
        mutation("tidyCards.applyTeamToPlayerCards").mockResolvedValue(result);
        const b = base();
        renderTile({ ...b, leafCards: [b.row, sibling("c2"), sibling("c3")] });
        await click(screen.getByRole("button", { name: "Apply to all 2 other Jackson Merrill cards" }));
        expect(screen.getByText(text)).toBeTruthy();
      });

      it("is not offered with nothing to apply to, on a two-player card, or with two teams", () => {
        const b = base();
        const { unmount } = renderTile({ ...b, leafCards: [b.row] });
        expect(screen.queryByRole("button", { name: /Apply to/ })).toBeNull();
        unmount();

        const twoPlayers = { ...b, row: card({ playerIds: ["player-1", "player-2"], teamOnCardIds: ["team-7"] }) };
        const { unmount: u2 } = renderTile({ ...twoPlayers, leafCards: [sibling("c2")] });
        expect(screen.queryByRole("button", { name: /Apply to/ })).toBeNull();
        u2();

        const twoTeams = { ...b, row: card({ playerIds: ["player-1"], teamOnCardIds: ["team-7", "team-8"] }) };
        renderTile({ ...twoTeams, leafCards: [sibling("c2")] });
        expect(screen.queryByRole("button", { name: /Apply to/ })).toBeNull();
      });

      it("a single card reads in the singular", () => {
        const b = base();
        renderTile({ ...b, leafCards: [b.row, sibling("c2")] });
        expect(screen.getByRole("button", { name: "Apply to the other Jackson Merrill card" })).toBeTruthy();
      });
    });
  });

  it("shows a refused write inline, in the tile", async () => {
    queryResults["teams.nearMatches"] = [];
    mutation("tidyNames.answerName").mockRejectedValueOnce(new Error("Server Error"));
    renderTile();
    await click(screen.getByRole("button", { name: "Not a team" }));
    const tile = screen.getByRole("group", { name: "Team" });
    expect(within(tile).getByRole("alert").textContent).toBe("Couldn't save that answer. Try again.");
  });

  describe("focus after an answer (S1) and after a cancel", () => {
    const base = () => ({
      row: card({ playerIds: ["player-1"], teamOnCardIds: ["team-7"] }),
      items: [] as TidyAttention["items"],
      ctx: context({
        players: [{ playerId: "player-1", name: "Jackson Merrill", sportId: SPORT, stints: [], stintsMore: false }],
        teams: [{ teamId: "team-7", name: "San Diego Padres", onCard: true, candidate: false }],
      }),
    });

    it("'Change' is 'Change team' on the screen and to a reader", () => {
      renderTile(base());
      const change = screen.getByRole("button", { name: "Change team" });
      expect(change.textContent).toBe("Change team");
      expect(change.getAttribute("aria-label")).toBeNull();
    });

    it("a pick is an answer: the walk is told, focus is not sent back to the opener", async () => {
      const onAnswered = vi.fn();
      renderTile({ ...base(), onAnswered });
      const change = screen.getByRole("button", { name: "Change team" });
      change.focus();
      await click(change);
      const pick = screen.getByRole("button", { name: "Pick a team" });
      pick.focus();
      await click(pick);
      expect(onAnswered).toHaveBeenCalledTimes(1);
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      expect(document.activeElement).not.toBe(screen.getByRole("button", { name: "Change team" }));
    });

    it("Cancel gives focus back to the control that opened the search, and tells the walk nothing", async () => {
      const onAnswered = vi.fn();
      renderTile({ ...base(), onAnswered });
      const add = screen.getByRole("button", { name: "+ Another team" });
      add.focus();
      await click(add);
      fireEvent.click(screen.getByRole("button", { name: "Cancel linking" }));
      await waitFor(() =>
        expect(document.activeElement).toBe(screen.getByRole("button", { name: "+ Another team" })),
      );
      expect(onAnswered).not.toHaveBeenCalled();
    });

    it("'Not a team' is an answer; a refused one is not", async () => {
      queryResults["teams.nearMatches"] = [];
      const onAnswered = vi.fn();
      renderTile({ onAnswered });
      mutation("tidyNames.answerName").mockRejectedValueOnce(new Error("Server Error"));
      await click(screen.getByRole("button", { name: "Not a team" }));
      expect(onAnswered).not.toHaveBeenCalled();
      await click(screen.getByRole("button", { name: "Not a team" }));
      expect(onAnswered).toHaveBeenCalledTimes(1);
    });
  });
});
