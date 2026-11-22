/**
 * NEO-645 tile 3, "Player": a skeleton while the spelling is unsettled, one
 * row per printed name, every way to answer a name inline (add as new, not a
 * player, change), the "Linked for you" note, "Printed on", and never an empty
 * "Possible matches".
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  default: ({ kind, onSelect, onCancel }: { kind: string; onSelect: (id: string, n: string) => void; onCancel: () => void }) => (
    <div>
      <button type="button" onClick={() => onSelect("player-9", "Someone")}>
        {`Pick a ${kind}`}
      </button>
      <button type="button" onClick={onCancel}>
        Cancel linking
      </button>
    </div>
  ),
}));

import { AnsweredProvider } from "../answered";
import PlayerTile from "./PlayerTile";
import type { TidyAttentionItem } from "../../../../convex/features/cardAttention";
import type { TidyAttention, TidyCardContext, TidyRow, TidyTileProps } from "../tile-types";

const CARD = "card-1";
const SPORT = "sport-1";

const card = (extra: Record<string, unknown> = {}) =>
  ({ _id: CARD, cardNumber: "USC42", cardName: "Jackson Merrill", ...extra }) as unknown as TidyRow;

const nameRow = (extra: Record<string, unknown> = {}) => ({
  name: "Jackson Merrill",
  sportId: SPORT,
  status: "ready" as const,
  ...extra,
});

const printedName = (over: Record<string, unknown> = {}) => ({
  kind: "player" as const,
  nameNormalized: "jackson merrill",
  printed: "Jackson Merrill",
  order: 0,
  cardOverride: false,
  scopeId: "leaf-1",
  row: nameRow(),
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

const fixItem: TidyAttentionItem = { level: "fix", kind: "playerName", names: ["Jackson Merrill"] };

function renderTile(
  opts: {
    row?: TidyRow;
    ctx?: TidyCardContext | undefined;
    items?: TidyAttentionItem[];
    onAnswered?: () => void;
  } = {},
) {
  const props: TidyTileProps = {
    row: opts.row ?? card({ pendingPlayerNames: ["Jackson Merrill"] }),
    context: "ctx" in opts ? opts.ctx : context({ names: [printedName()] }),
    attention: { level: "fix", items: opts.items ?? [fixItem] },
    leafId: "leaf-1" as never,
    sportId: SPORT as never,
    leafCards: [],
    setName: "Set",
  };
  return render(
    <AnsweredProvider value={opts.onAnswered ?? (() => {})}>
      <PlayerTile {...props} />
    </AnsweredProvider>,
  );
}

beforeEach(() => {
  for (const k of Object.keys(queryResults)) delete queryResults[k];
  for (const k of Object.keys(mutations)) delete mutations[k];
  queryResults["players.nameFragmentCheck"] = { isFragment: false };
});

describe("PlayerTile", () => {
  it("is a skeleton, with nothing to press, while a players disagreement is unsettled", () => {
    renderTile({ items: [{ level: "fix", kind: "sourcesDisagree", field: "players" }] });
    const tile = screen.getByRole("group", { name: "Player" });
    expect(tile.getAttribute("data-tidy-level")).toBe("waiting");
    expect(screen.getByText("Looks up once the spelling is picked")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders nothing for a card with no players and no names", () => {
    const { container } = renderTile({ row: card(), ctx: context(), items: [] });
    expect(container.textContent).toBe("");
  });

  it("waits while the context loads for a card that has players", () => {
    renderTile({ ctx: undefined });
    expect(screen.getByRole("group", { name: "Player" }).getAttribute("data-tidy-level")).toBe("waiting");
  });

  it("a new name is pink, says it is new, and offers add / link / not a player", () => {
    queryResults["players.nearMatches"] = [];
    renderTile({
      ctx: context({
        names: [
          printedName({
            row: nameRow({ enrichment: { description: "American baseball outfielder", birthYear: 2003 } }),
            printedOn: { cardNumbers: ["USC1", "USC17"], count: 2, more: false },
          }),
        ],
      }),
    });
    expect(screen.getByRole("group", { name: "Player" }).getAttribute("data-tidy-level")).toBe("fix");
    expect(screen.getByText("“Jackson Merrill” is new to NeonBinder.")).toBeTruthy();
    expect(screen.getByText("Wikidata: American baseball outfielder, b. 2003")).toBeTruthy();
    expect(screen.getByText("Printed on #USC1, #USC17")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add as new player" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Link to existing…" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Not a player (checklist, team card, stadium)" })).toBeTruthy();
  });

  it("never shows 'Possible matches' with nothing to list", () => {
    queryResults["players.nearMatches"] = [];
    renderTile();
    expect(screen.queryByText("Possible matches")).toBeNull();
  });

  it.each([
    ["near matches", "players.nearMatches"],
    ["the fragment check", "players.nameFragmentCheck"],
  ])("holds 'Add as new player' until %s has answered", async (_label, pending) => {
    queryResults["players.nearMatches"] = [];
    delete queryResults[pending];
    renderTile();
    expect(screen.getByText("Checking for players by that name…").getAttribute("role")).toBe("status");
    expect(screen.queryByText("“Jackson Merrill” is new to NeonBinder.")).toBeNull();
    const add = screen.getByRole("button", { name: "Add as new player" });
    expect(add.getAttribute("aria-disabled")).toBe("true");
    await act(async () => fireEvent.click(add));
    expect(mutation("tidyNames.createPlayer")).not.toHaveBeenCalled();
  });

  it("says nothing about checking once both answered", () => {
    queryResults["players.nearMatches"] = [];
    renderTile();
    expect(screen.queryByText("Checking for players by that name…")).toBeNull();
    expect(screen.getByRole("button", { name: "Add as new player" }).getAttribute("aria-disabled")).toBeNull();
  });

  it("'Add as new player' creates the player from this card's printed name", async () => {
    queryResults["players.nearMatches"] = [];
    renderTile();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add as new player" })));
    expect(mutation("tidyNames.createPlayer")).toHaveBeenCalledWith({ cardId: CARD, name: "Jackson Merrill" });
  });

  describe("Wikidata career teams (NEO-212)", () => {
    const careerCtx = (over: Record<string, unknown> = {}) =>
      context({
        names: [
          printedName({
            row: nameRow({
              enrichment: {
                description: "American baseball outfielder",
                careerTeams: [
                  { name: "San Diego Padres", fromYear: 2024 },
                  { name: "Salt Lake Bees", fromYear: 2022, toYear: 2023 },
                ],
              },
            }),
            ...over,
          }),
        ],
      });

    it("lists each career team with a ticked checkbox, oldest first", () => {
      queryResults["players.nearMatches"] = [];
      renderTile({ ctx: careerCtx() });
      const group = screen.getByRole("group", { name: "Career teams to add:" });
      const boxes = Array.from(group.querySelectorAll("input[type=checkbox]")) as HTMLInputElement[];
      expect(boxes.map((b) => b.getAttribute("aria-label"))).toEqual([
        "Include career team Salt Lake Bees (2022–2023)",
        "Include career team San Diego Padres (2024–present)",
      ]);
      expect(boxes.every((b) => b.checked)).toBe(true);
    });

    it("creates with every team when nothing was unticked (no key sent)", async () => {
      queryResults["players.nearMatches"] = [];
      renderTile({ ctx: careerCtx() });
      await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add as new player" })));
      expect(mutation("tidyNames.createPlayer")).toHaveBeenCalledWith({ cardId: CARD, name: "Jackson Merrill" });
    });

    it("sends the unticked team names with the create, and re-ticking takes one back", async () => {
      queryResults["players.nearMatches"] = [];
      renderTile({ ctx: careerCtx() });
      const bees = screen.getByRole("checkbox", { name: "Include career team Salt Lake Bees (2022–2023)" });
      const padres = screen.getByRole("checkbox", { name: "Include career team San Diego Padres (2024–present)" });
      fireEvent.click(bees);
      fireEvent.click(padres);
      expect((bees as HTMLInputElement).checked).toBe(false);
      fireEvent.click(padres);
      expect((padres as HTMLInputElement).checked).toBe(true);
      await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add as new player" })));
      expect(mutation("tidyNames.createPlayer")).toHaveBeenCalledWith({
        cardId: CARD,
        name: "Jackson Merrill",
        excludedCareerTeamNames: ["Salt Lake Bees"],
      });
    });

    it("one team with two stints unticks together (the server keys on the name)", async () => {
      queryResults["players.nearMatches"] = [];
      renderTile({
        ctx: context({
          names: [
            printedName({
              row: nameRow({
                enrichment: {
                  careerTeams: [
                    { name: "Los Angeles Angels", fromYear: 2011, toYear: 2013 },
                    { name: "Los Angeles Angels", fromYear: 2016 },
                  ],
                },
              }),
            }),
          ],
        }),
      });
      fireEvent.click(screen.getByRole("checkbox", { name: "Include career team Los Angeles Angels (2016–present)" }));
      expect(
        (screen.getByRole("checkbox", { name: "Include career team Los Angeles Angels (2011–2013)" }) as HTMLInputElement)
          .checked,
      ).toBe(false);
      await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add as new player" })));
      expect(mutation("tidyNames.createPlayer")).toHaveBeenCalledWith({
        cardId: CARD,
        name: "Jackson Merrill",
        excludedCareerTeamNames: ["Los Angeles Angels"],
      });
    });

    it("shows no list for a lookup with no career", () => {
      queryResults["players.nearMatches"] = [];
      renderTile();
      expect(screen.queryByRole("group", { name: "Career teams to add:" })).toBeNull();
    });

    it("names the player in each box when the card prints more than one name", () => {
      queryResults["players.nearMatches"] = [];
      renderTile({
        row: card({ pendingPlayerNames: ["Jackson Merrill", "Fernando Tatis"] }),
        ctx: context({
          names: [
            printedName({
              row: nameRow({ enrichment: { careerTeams: [{ name: "San Diego Padres", fromYear: 2024 }] } }),
            }),
            printedName({
              printed: "Fernando Tatis",
              nameNormalized: "fernando tatis",
              order: 1,
              row: nameRow({
                name: "Fernando Tatis",
                enrichment: { careerTeams: [{ name: "San Diego Padres", fromYear: 2019 }] },
              }),
            }),
          ],
        }),
      });
      expect(
        screen.getByRole("checkbox", { name: "Include career team San Diego Padres (2024–present) Jackson Merrill" }),
      ).toBeTruthy();
      expect(
        screen.getByRole("checkbox", { name: "Include career team San Diego Padres (2019–present) Fernando Tatis" }),
      ).toBeTruthy();
    });
  });

  it("'Not a player' answers notEntity for the name", async () => {
    queryResults["players.nearMatches"] = [];
    renderTile();
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Not a player (checklist, team card, stadium)" })),
    );
    expect(mutation("tidyNames.answerName")).toHaveBeenCalledWith({
      cardId: CARD,
      kind: "player",
      name: "Jackson Merrill",
      answer: { kind: "notEntity" },
    });
  });

  it("an exact single match offers 'Link to {name}' and links it", async () => {
    queryResults["players.nearMatches"] = [
      { _id: "player-1", name: "Jackson Merrill", confidence: "exact", birthYear: 2003 },
    ];
    renderTile();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Link to Jackson Merrill" })));
    expect(mutation("tidyNames.answerName")).toHaveBeenCalledWith({
      cardId: CARD,
      kind: "player",
      name: "Jackson Merrill",
      answer: { kind: "linkPlayer", playerId: "player-1" },
    });
    expect(screen.getByRole("button", { name: "Add as new player anyway" })).toBeTruthy();
  });

  it("a linked name is plain, says why it was linked, and Change clears the answer", async () => {
    renderTile({
      row: card({ playerIds: ["player-1"] }),
      items: [],
      ctx: context({
        names: [
          printedName({
            row: nameRow({
              answer: { kind: "linkPlayer", playerId: "player-1", by: "auto", autoReason: "setHistory" },
            }),
          }),
        ],
        players: [
          {
            playerId: "player-1",
            name: "Jackson Merrill",
            birthYear: 2003,
            sportId: SPORT,
            stints: [{ teamId: "t1", teamName: "San Diego Padres", fromYear: 2024 }],
            stintsMore: false,
          },
        ],
        linkedFor: [{ kind: "player", playerId: "player-1", reason: "setHistory" }],
      }),
    });
    expect(screen.getByRole("group", { name: "Player" }).getAttribute("data-tidy-level")).toBe("plain");
    expect(screen.getByText("Linked for you: another card in this set is already linked to them")).toBeTruthy();
    expect(screen.getByText(/b\. 2003/)).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Change player" })));
    expect(mutation("tidyNames.answerName")).toHaveBeenCalledWith({
      cardId: CARD,
      kind: "player",
      name: "Jackson Merrill",
      answer: { kind: "clear" },
    });
  });

  it("an exact link with no name row says 'exact' from the live read, and Change edits this card only", async () => {
    renderTile({
      row: card({ playerIds: ["player-1"] }),
      items: [],
      ctx: context({
        players: [{ playerId: "player-1", name: "Jackson Merrill", sportId: SPORT, stints: [], stintsMore: false }],
        linkedFor: [{ kind: "player", playerId: "player-1", reason: "exact" }],
      }),
    });
    expect(screen.getByText("Linked for you: exact name, plays in this set's sport")).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Change player" })));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Pick a player" })));
    expect(mutation("selectorOptions.updateCard")).toHaveBeenCalledWith({ id: CARD, playerIds: ["player-9"] });
  });

  it("'+ Another player' adds one to the card, and is hidden while a name is unanswered", async () => {
    const linked = {
      row: card({ playerIds: ["player-1"] }),
      items: [] as TidyAttention["items"],
      ctx: context({
        players: [{ playerId: "player-1", name: "Jackson Merrill", sportId: SPORT, stints: [], stintsMore: false }],
      }),
    };
    const { unmount } = renderTile(linked);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "+ Another player" })));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Pick a player" })));
    expect(mutation("selectorOptions.updateCard")).toHaveBeenCalledWith({
      id: CARD,
      playerIds: ["player-1", "player-9"],
    });
    unmount();

    queryResults["players.nearMatches"] = [];
    renderTile();
    expect(screen.queryByRole("button", { name: "+ Another player" })).toBeNull();
  });

  it("shows a refused write inline, in the tile", async () => {
    queryResults["players.nearMatches"] = [];
    mutation("tidyNames.createPlayer").mockRejectedValueOnce(new Error("Server Error"));
    renderTile();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add as new player" })));
    expect(screen.getByRole("alert").textContent).toBe("Couldn't add that player. Try again.");
  });

  it("two names on one card carry the printed name in every control, so none read alike", () => {
    queryResults["players.nearMatches"] = [];
    renderTile({
      ctx: context({
        names: [
          printedName(),
          printedName({ nameNormalized: "juan soto", printed: "Juan Soto", order: 1, row: nameRow({ name: "Juan Soto" }) }),
        ],
      }),
    });
    expect(screen.getByRole("button", { name: "Add as new player Jackson Merrill" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add as new player Juan Soto" })).toBeTruthy();
  });

  it("the 'Also add … to their sports' box is a 24px target and holds with aria-disabled while a write is in flight", async () => {
    queryResults["players.nearMatches"] = [];
    renderTile({ ctx: context({ names: [printedName({ row: nameRow({ sportId: "sport-2" }) })] }) });
    const box = screen.getByRole("checkbox", { name: /^Also add / }) as HTMLInputElement;
    expect(box.className).toContain("h-6");
    expect(box.closest("label")?.className).toContain("min-h-6");
    mutation("tidyNames.answerName").mockReturnValueOnce(new Promise(() => {}));
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Not a player (checklist, team card, stadium)" })),
    );
    expect(box.getAttribute("aria-disabled")).toBe("true");
    expect(box.disabled).toBe(false);
    fireEvent.click(box);
    expect(box.checked).toBe(false);
  });

  describe("focus after an answer (S1) and after a cancel", () => {
    const linkedCtx = () =>
      context({
        players: [{ playerId: "player-1", name: "Jackson Merrill", sportId: SPORT, stints: [], stintsMore: false }],
      });
    const linkedRow = () => card({ playerIds: ["player-1"] });

    it("'Change' is 'Change player' to a reader and on the screen", () => {
      renderTile({ row: linkedRow(), items: [], ctx: linkedCtx() });
      const change = screen.getByRole("button", { name: "Change player" });
      expect(change.textContent).toBe("Change player");
      expect(change.getAttribute("aria-label")).toBeNull();
    });

    it("a pick is an answer: the walk is told, and focus is not sent back to the opener", async () => {
      const onAnswered = vi.fn();
      renderTile({ row: linkedRow(), items: [], ctx: linkedCtx(), onAnswered });
      const change = screen.getByRole("button", { name: "Change player" });
      change.focus();
      fireEvent.click(change);
      const pick = screen.getByRole("button", { name: "Pick a player" });
      pick.focus();
      await act(async () => fireEvent.click(pick));
      expect(onAnswered).toHaveBeenCalledTimes(1);
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      expect(document.activeElement).not.toBe(screen.getByRole("button", { name: "Change player" }));
    });

    it("Cancel gives focus back to the Change that opened the search", async () => {
      const onAnswered = vi.fn();
      renderTile({ row: linkedRow(), items: [], ctx: linkedCtx(), onAnswered });
      const change = screen.getByRole("button", { name: "Change player" });
      change.focus();
      fireEvent.click(change);
      fireEvent.click(screen.getByRole("button", { name: "Cancel linking" }));
      await waitFor(() => expect(document.activeElement).toBe(change));
      expect(onAnswered).not.toHaveBeenCalled();
    });

    it("Cancel on '+ Another player' returns to that button, which was gone while the search was open", async () => {
      renderTile({ row: linkedRow(), items: [], ctx: linkedCtx() });
      const add = screen.getByRole("button", { name: "+ Another player" });
      add.focus();
      fireEvent.click(add);
      fireEvent.click(screen.getByRole("button", { name: "Cancel linking" }));
      await waitFor(() =>
        expect(document.activeElement).toBe(screen.getByRole("button", { name: "+ Another player" })),
      );
    });

    it("a name answered inline (Add as new player) tells the walk once the write lands", async () => {
      queryResults["players.nearMatches"] = [];
      const onAnswered = vi.fn();
      renderTile({ onAnswered });
      await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add as new player" })));
      expect(onAnswered).toHaveBeenCalledTimes(1);
    });

    it("'Not a player' tells the walk; a refused write does not", async () => {
      queryResults["players.nearMatches"] = [];
      const onAnswered = vi.fn();
      renderTile({ onAnswered });
      mutation("tidyNames.answerName").mockRejectedValueOnce(new Error("Server Error"));
      const no = screen.getByRole("button", { name: "Not a player (checklist, team card, stadium)" });
      await act(async () => fireEvent.click(no));
      expect(onAnswered).not.toHaveBeenCalled();
      await act(async () => fireEvent.click(no));
      expect(onAnswered).toHaveBeenCalledTimes(1);
    });

    it("on a card with two names, Change carries the name so the two do not read alike", () => {
      const ctx = context({
        names: [
          printedName({
            row: nameRow({ answer: { kind: "linkPlayer", playerId: "player-1", by: "operator" } }),
          }),
          printedName({
            nameNormalized: "juan soto",
            printed: "Juan Soto",
            order: 1,
            row: nameRow({ name: "Juan Soto", answer: { kind: "notEntity", by: "operator" } }),
          }),
        ],
        players: [{ playerId: "player-1", name: "Jackson Merrill", sportId: SPORT, stints: [], stintsMore: false }],
      });
      renderTile({ row: linkedRow(), items: [], ctx });
      expect(screen.getByRole("button", { name: "Change player Jackson Merrill" }).textContent).toBe("Change player");
      expect(screen.getByRole("button", { name: "Change player Juan Soto" })).toBeTruthy();
    });
  });
});
