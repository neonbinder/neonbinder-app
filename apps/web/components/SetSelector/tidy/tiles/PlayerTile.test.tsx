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

const linkSearchProps: Array<Record<string, unknown>> = [];
vi.mock("../../EntityLinkSearch", () => ({
  default: (props: { kind: string; onSelect: (id: string, n: string) => void; onCancel: () => void }) => {
    linkSearchProps.push(props);
    const { kind, onSelect, onCancel } = props;
    return (
    <div>
      <button type="button" onClick={() => onSelect("player-9", "Someone")}>
        {`Pick a ${kind}`}
      </button>
      <button type="button" onClick={onCancel}>
        Cancel linking
      </button>
    </div>
    );
  },
}));

import { AnsweredProvider } from "../answered";
import PlayerTile from "./PlayerTile";
import { WRAP_LABEL_CLASS } from "../TidyTile";
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
  linkSearchProps.length = 0;
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

  it("a player Add all new players made with no Wikidata career carries a purple note, and the tile stays plain", () => {
    renderTile({
      row: card({
        playerIds: ["player-1"],
        tidyChecks: [{ kind: "newPlayerNoCareer", playerId: "player-1" }],
      } as never),
      items: [],
      ctx: context({
        players: [{ playerId: "player-1", name: "Quinn Rookie", sportId: SPORT, stints: [], stintsMore: false }],
        linkedFor: [{ kind: "player", playerId: "player-1", reason: "exact" }],
      }),
    });
    const note = screen.getByText("New player, no career from Wikidata");
    expect(note.getAttribute("role")).toBe("note");
    expect(screen.getByRole("group", { name: "Player" }).getAttribute("data-tidy-level")).toBe("plain");
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

describe("PlayerTile: a near spelling (NEO-645 S2)", () => {
  const near = {
    _id: "player-7",
    name: "Jackson Holliday",
    distance: 1,
    teamName: "Baltimore Orioles",
    fromYear: 2024,
  };
  const holiday = () =>
    context({
      names: [
        printedName({
          nameNormalized: "holiday jackson",
          printed: "Jackson Holiday",
          row: nameRow({ name: "Jackson Holiday" }),
        }),
      ],
    });
  const renderHoliday = () =>
    renderTile({
      row: card({ pendingPlayerNames: ["Jackson Holiday"] }),
      ctx: holiday(),
      items: [{ level: "fix", kind: "playerName", names: ["Jackson Holiday"] }],
    });

  it("offers 'Did you mean {name} ({team} {years})?' above Add as new player, which goes quiet", () => {
    queryResults["players.nearMatches"] = [];
    queryResults["players.didYouMean"] = [near];
    renderHoliday();
    const buttons = screen.getAllByRole("button").map((b) => b.getAttribute("aria-label") ?? b.textContent);
    const didYouMean = "Did you mean Jackson Holliday (Baltimore Orioles 2024–)?";
    expect(screen.getByRole("button", { name: didYouMean })).toBeTruthy();
    expect(buttons.indexOf(didYouMean)).toBeLessThan(buttons.indexOf("Add as new player"));
    // Not the green primary any more: the outline paint (a clear fill), as
    // 'Add as new player anyway' has.
    const add = screen.getByRole("button", { name: "Add as new player" });
    expect(add.style.getPropertyValue("--nb-fill")).toBe("transparent");
  });

  it("pressing it links the player like a pick, and links nothing before that", async () => {
    queryResults["players.nearMatches"] = [];
    queryResults["players.didYouMean"] = [near];
    renderHoliday();
    expect(mutation("tidyNames.answerName")).not.toHaveBeenCalled();
    expect(mutation("tidyNames.createPlayer")).not.toHaveBeenCalled();
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Did you mean Jackson Holliday (Baltimore Orioles 2024–)?" })),
    );
    expect(mutation("tidyNames.answerName")).toHaveBeenCalledWith({
      cardId: CARD,
      kind: "player",
      name: "Jackson Holiday",
      answer: { kind: "linkPlayer", playerId: "player-7" },
    });
  });

  it("with nothing near, 'Add as new player' stays the primary and no suggestion shows", () => {
    queryResults["players.nearMatches"] = [];
    queryResults["players.didYouMean"] = [];
    renderHoliday();
    expect(screen.queryByRole("button", { name: /^Did you mean/ })).toBeNull();
    const add = screen.getByRole("button", { name: "Add as new player" });
    expect(add.style.getPropertyValue("--nb-fill")).not.toBe("transparent");
  });

  it("a near player with no stint on file reads without the parentheses", () => {
    queryResults["players.nearMatches"] = [];
    queryResults["players.didYouMean"] = [{ _id: "player-8", name: "Jackson Holliday", distance: 1 }];
    renderHoliday();
    expect(screen.getByRole("button", { name: "Did you mean Jackson Holliday?" })).toBeTruthy();
  });

  it("'Link to existing…' opens its search with the printed name typed, ranked for this card", async () => {
    queryResults["players.nearMatches"] = [];
    queryResults["players.didYouMean"] = [];
    renderHoliday();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Link to existing…" })));
    const props = linkSearchProps[linkSearchProps.length - 1];
    expect(props.initialQuery).toBe("Jackson Holiday");
    expect(props.contextCardId).toBe(CARD);
  });
});

describe("PlayerTile: the set-history suggestion leads (NEO-645 item 8)", () => {
  const sethistory = {
    playerId: "player-5",
    name: "Kendry Morales",
    sportId: SPORT,
    sportValue: "Football",
    reason: "setHistory" as const,
  };
  const morales = (preselect: Record<string, unknown>) =>
    context({
      names: [
        printedName({
          nameNormalized: "kendry morales",
          printed: "Kendry Morales",
          row: nameRow({ name: "Kendry Morales", enrichment: { preselect } }),
        }),
      ],
    });
  const renderMorales = (preselect: Record<string, unknown>) =>
    renderTile({
      row: card({ pendingPlayerNames: ["Kendry Morales"] }),
      ctx: morales(preselect),
      items: [{ level: "fix", kind: "playerName", names: ["Kendry Morales"] }],
    });
  const line = "Another card in this set is already linked to Kendry Morales (Football). Same one?";

  it("shows the line and its link when there is no namesake", () => {
    queryResults["players.nearMatches"] = [];
    renderMorales(sethistory);
    expect(screen.getByText(line)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Link to Kendry Morales (Football)" })).toBeTruthy();
  });

  it("still shows it, first, when an exact namesake is on file; his plain link follows", () => {
    queryResults["players.nearMatches"] = [
      { _id: "player-6", name: "Kendry Morales", confidence: "exact", birthYear: 1983 },
    ];
    renderMorales(sethistory);
    expect(screen.getByText(line)).toBeTruthy();
    const names = screen.getAllByRole("button").map((b) => b.getAttribute("aria-label") ?? b.textContent);
    const lead = names.indexOf("Link to Kendry Morales (Football)");
    const plain = names.indexOf("Link to Kendry Morales");
    expect(lead).toBeGreaterThanOrEqual(0);
    expect(plain).toBeGreaterThan(lead);
  });

  it("the plain-exact behaviour is untouched for any other reason: the suggestion stays hidden", () => {
    queryResults["players.nearMatches"] = [
      { _id: "player-6", name: "Kendry Morales", confidence: "exact", birthYear: 1983 },
    ];
    renderMorales({ ...sethistory, reason: "onlyNamesake" });
    expect(screen.queryByText(/Same one\?/)).toBeNull();
    expect(screen.getByRole("button", { name: "Link to Kendry Morales" })).toBeTruthy();
  });
});

describe("PlayerTile: a name ruled out because it is the card's team (NEO-645 S3a)", () => {
  const ruledOut = (answer: Record<string, unknown>) =>
    context({
      names: [
        printedName({
          nameNormalized: "new york yankees",
          printed: "New York Yankees",
          row: nameRow({ name: "New York Yankees", answer }),
        }),
      ],
    });
  const render = (answer: Record<string, unknown>) =>
    renderTile({ row: card({ pendingPlayerNames: [] }), ctx: ruledOut(answer), items: [] });

  it("says it is not a player, carries the purple note, and Change player undoes it", async () => {
    render({ kind: "notEntity", by: "auto", autoReason: "sameAsTeam" });
    expect(screen.getByText("is not a player.", { exact: false })).toBeTruthy();
    expect(screen.getByRole("note").textContent).toBe(
      "Ruled out for you: this card prints the same name as its team",
    );
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Change player" })));
    expect(mutation("tidyNames.answerName")).toHaveBeenCalledWith({
      cardId: CARD,
      kind: "player",
      name: "New York Yankees",
      answer: { kind: "clear" },
    });
  });

  it("an operator's own 'Not a player' carries no note", () => {
    render({ kind: "notEntity", by: "operator" });
    expect(screen.queryByRole("note")).toBeNull();
  });
});

describe("PlayerTile: one filled button per tile, and long labels wrap (NEO-645 audit)", () => {
  /** A NeonButton is filled when its paint is not the clear outline fill. */
  const isFilled = (el: HTMLElement) => {
    const fill = el.style.getPropertyValue("--nb-fill");
    return fill !== "" && fill !== "transparent";
  };
  const filledNames = () =>
    screen
      .getAllByRole("button")
      .filter(isFilled)
      .map((b) => b.getAttribute("aria-label") ?? b.textContent);
  const wraps = (el: HTMLElement) => {
    for (const token of WRAP_LABEL_CLASS.split(" ")) expect(el.className).toContain(token);
  };

  const holiday = (name = "Jackson Holiday", order = 0) =>
    printedName({
      nameNormalized: name.toLowerCase(),
      printed: name,
      order,
      row: nameRow({ name }),
    });
  const near = (id: string, name: string) => ({ _id: id, name, distance: 1, teamName: "Baltimore Orioles", fromYear: 2024 });
  const exact = { _id: "player-6", name: "Kendry Morales", confidence: "exact", birthYear: 1983 };
  const setHistory = {
    playerId: "player-5",
    name: "Kendry Morales",
    sportId: SPORT,
    sportValue: "Football",
    reason: "setHistory" as const,
  };
  const morales = (preselect?: Record<string, unknown>) =>
    printedName({
      nameNormalized: "kendry morales",
      printed: "Kendry Morales",
      row: nameRow({ name: "Kendry Morales", ...(preselect ? { enrichment: { preselect } } : {}) }),
    });
  const renderOne = (ctxName: ReturnType<typeof printedName>) =>
    renderTile({
      row: card({ pendingPlayerNames: [ctxName.printed] }),
      ctx: context({ names: [ctxName] }),
      items: [{ level: "fix", kind: "playerName", names: [ctxName.printed] }],
    });

  it("a name with nothing on file: Add as new player is the one filled button, the rest are outlines", () => {
    queryResults["players.nearMatches"] = [];
    renderTile();
    expect(filledNames()).toEqual(["Add as new player"]);
    // Link to existing… is a blue outline now, not a blue fill.
    const linkExisting = screen.getByRole("button", { name: "Link to existing…" });
    expect(isFilled(linkExisting)).toBe(false);
    expect(linkExisting.style.getPropertyValue("--nb-edge")).not.toBe("transparent");
  });

  it("an exact single match leads, ahead of Add as new player anyway", () => {
    queryResults["players.nearMatches"] = [exact];
    renderOne(morales());
    expect(filledNames()).toEqual(["Link to Kendry Morales"]);
  });

  it("the suggestion's button is described by the reason line under it, and nothing else is", () => {
    queryResults["players.nearMatches"] = [exact];
    renderOne(morales(setHistory));
    const lead = screen.getByRole("button", { name: "Link to Kendry Morales (Football)" });
    const reason = screen.getByText(
      "Another card in this set is already linked to Kendry Morales (Football). Same one?",
    );
    expect(lead.getAttribute("aria-describedby")).toBe(reason.id);
    expect(reason.id).not.toBe("");
    expect(
      screen.getByRole("button", { name: "Link to Kendry Morales" }).hasAttribute("aria-describedby"),
    ).toBe(false);
  });

  it("the suggestion leads the exact link when both show; the exact link is an outline", () => {
    queryResults["players.nearMatches"] = [exact];
    renderOne(morales(setHistory));
    expect(filledNames()).toEqual(["Link to Kendry Morales (Football)"]);
    expect(isFilled(screen.getByRole("button", { name: "Link to Kendry Morales" }))).toBe(false);
  });

  it("with near spellings, only the first Did you mean is filled; Add as new player is an outline", () => {
    queryResults["players.nearMatches"] = [];
    queryResults["players.didYouMean"] = [near("player-7", "Jackson Holliday"), near("player-8", "Jackson Hollidae")];
    renderOne(holiday());
    expect(filledNames()).toEqual(["Did you mean Jackson Holliday (Baltimore Orioles 2024–)?"]);
    expect(isFilled(screen.getByRole("button", { name: "Add as new player" }))).toBe(false);
  });

  it("two unanswered names: only the first row carries a filled button", () => {
    queryResults["players.nearMatches"] = [];
    renderTile({
      ctx: context({ names: [holiday("Jackson Merrill", 0), holiday("Juan Soto", 1)] }),
    });
    expect(filledNames()).toEqual(["Add as new player Jackson Merrill"]);
    expect(isFilled(screen.getByRole("button", { name: "Add as new player Juan Soto" }))).toBe(false);
  });

  it("an answered first name hands the filled button to the next row", () => {
    queryResults["players.nearMatches"] = [];
    renderTile({
      ctx: context({
        names: [
          printedName({ row: nameRow({ answer: { kind: "notEntity" } }) }),
          holiday("Juan Soto", 1),
        ],
      }),
    });
    expect(filledNames()).toEqual(["Add as new player Juan Soto"]);
  });

  it("the buttons whose labels are a name or a long sentence wrap inside the button", () => {
    queryResults["players.nearMatches"] = [exact];
    renderOne(morales(setHistory));
    wraps(screen.getByRole("button", { name: "Link to Kendry Morales (Football)" }));
    wraps(screen.getByRole("button", { name: "Link to Kendry Morales" }));
    wraps(screen.getByRole("button", { name: "Not a player (checklist, team card, stadium)" }));
  });

  it("a Did you mean button wraps too", () => {
    queryResults["players.nearMatches"] = [];
    queryResults["players.didYouMean"] = [near("player-7", "Jackson Holliday")];
    renderOne(holiday());
    wraps(screen.getByRole("button", { name: /^Did you mean Jackson Holliday/ }));
  });

  it("the suggestion's reason sits in a plain panel with an icon, not a side rail", () => {
    queryResults["players.nearMatches"] = [];
    renderOne(morales(setHistory));
    const reason = screen.getByText(
      "Another card in this set is already linked to Kendry Morales (Football). Same one?",
    );
    const panel = reason.parentElement!;
    expect(panel.className).toContain("bg-raised-deep");
    expect(panel.className).not.toContain("border-l-4");
    expect(panel.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("the cross-sport box says it once in its label, with no always-on line under it", () => {
    queryResults["players.nearMatches"] = [];
    renderTile({ ctx: context({ names: [printedName({ row: nameRow({ sportId: "sport-2" }) })] }) });
    expect(screen.getByRole("checkbox", { name: /^Also add / })).toBeTruthy();
    expect(screen.queryByText(/one-off appearance/)).toBeNull();
  });
});
