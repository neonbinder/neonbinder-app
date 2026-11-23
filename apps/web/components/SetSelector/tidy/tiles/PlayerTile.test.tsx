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

  it("a linked name is plain, says why it was linked, and Edit clears the answer", async () => {
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
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Edit Jackson Merrill" })));
    expect(mutation("tidyNames.answerName")).toHaveBeenCalledWith({
      cardId: CARD,
      kind: "player",
      name: "Jackson Merrill",
      answer: { kind: "clear" },
    });
  });

  it("T1: an exact link with no name row carries no purple note, and Edit changes this card only", async () => {
    renderTile({
      row: card({ playerIds: ["player-1"] }),
      items: [],
      ctx: context({
        players: [{ playerId: "player-1", name: "Jackson Merrill", sportId: SPORT, stints: [], stintsMore: false }],
        linkedFor: [],
      }),
    });
    expect(screen.queryByText(/Linked for you/)).toBeNull();
    expect(screen.queryByRole("note")).toBeNull();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Edit Jackson Merrill" })));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Pick a player" })));
    expect(mutation("selectorOptions.updateCard")).toHaveBeenCalledWith({
      id: CARD,
      playerIds: ["player-9"],
      regenerateListing: true,
    });
  });

  it("T1: a reason this build calls plain ('exact', from an older server) draws no note either", () => {
    renderTile({
      row: card({ playerIds: ["player-1"] }),
      items: [],
      ctx: context({
        players: [{ playerId: "player-1", name: "Jackson Merrill", sportId: SPORT, stints: [], stintsMore: false }],
        linkedFor: [{ kind: "player", playerId: "player-1", reason: "exact" }],
      }),
    });
    expect(screen.queryByRole("note")).toBeNull();
  });

  it.each([
    ["setHistory", "Linked for you: another card in this set is already linked to them"],
    ["hallOfFame", "Linked for you: none of the others on file played that year, but this one is in the Hall of Fame"],
    ["careerTeam", "Linked for you: the only one on file who played for this card's team"],
  ])("T1: the %s judgement call keeps its purple note on a link with no name row", (reason, text) => {
    renderTile({
      row: card({ playerIds: ["player-1"] }),
      items: [],
      ctx: context({
        players: [{ playerId: "player-1", name: "Jackson Merrill", sportId: SPORT, stints: [], stintsMore: false }],
        linkedFor: [{ kind: "player", playerId: "player-1", reason }],
      }),
    });
    expect(screen.getByRole("note").textContent).toBe(text);
  });

  it("T2: each linked name ends its line with one small Edit, named 'Edit <name>'; no Change player row remains", () => {
    renderTile({
      row: card({ playerIds: ["player-1", "player-2"] }),
      items: [],
      ctx: context({
        players: [
          { playerId: "player-1", name: "Freddy Peralta", birthYear: 1996, sportId: SPORT, stints: [], stintsMore: false },
          { playerId: "player-2", name: "Jesus Luzardo", birthYear: 1997, sportId: SPORT, stints: [], stintsMore: false },
        ],
      }),
    });
    for (const who of ["Freddy Peralta", "Jesus Luzardo"]) {
      const edit = screen.getByRole("button", { name: `Edit ${who}` });
      expect(edit.textContent).toBe("Edit");
      // WCAG 2.5.3: the accessible name holds the visible word.
      expect(edit.getAttribute("aria-label")).toContain(edit.textContent!);
      // The button is the LAST thing on the same line as the name, and the line may wrap.
      const line = edit.parentElement as HTMLElement;
      expect(line.lastElementChild).toBe(edit);
      expect(line.textContent).toContain(who);
      expect(line.className).toContain("flex-wrap");
    }
    expect(screen.queryByRole("button", { name: /^Change/ })).toBeNull();
    // One "+ Another player" and one "+ Cameo" at the bottom, in that order.
    const adds = screen.getAllByRole("button").map((b) => b.textContent);
    expect(adds.filter((t) => t === "+ Another player")).toHaveLength(1);
    expect(adds.slice(-2)).toEqual(["+ Another player", "+ Cameo"]);
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
      regenerateListing: true,
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

    it("'Edit' is 'Edit <name>' to a reader, so the name holds the visible word", () => {
      renderTile({ row: linkedRow(), items: [], ctx: linkedCtx() });
      const change = screen.getByRole("button", { name: "Edit Jackson Merrill" });
      expect(change.textContent).toBe("Edit");
      expect(change.getAttribute("aria-label")).toBe("Edit Jackson Merrill");
    });

    it("a pick is an answer: the walk is told, and focus is not sent back to the opener", async () => {
      const onAnswered = vi.fn();
      renderTile({ row: linkedRow(), items: [], ctx: linkedCtx(), onAnswered });
      const change = screen.getByRole("button", { name: "Edit Jackson Merrill" });
      change.focus();
      fireEvent.click(change);
      const pick = screen.getByRole("button", { name: "Pick a player" });
      pick.focus();
      await act(async () => fireEvent.click(pick));
      expect(onAnswered).toHaveBeenCalledTimes(1);
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      expect(document.activeElement).not.toBe(screen.getByRole("button", { name: "Edit Jackson Merrill" }));
    });

    it("Cancel gives focus back to the Edit that opened the search", async () => {
      const onAnswered = vi.fn();
      renderTile({ row: linkedRow(), items: [], ctx: linkedCtx(), onAnswered });
      const change = screen.getByRole("button", { name: "Edit Jackson Merrill" });
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

    it("on a card with two names, Edit carries the name so the two do not read alike", () => {
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
      expect(screen.getByRole("button", { name: "Edit Jackson Merrill" }).textContent).toBe("Edit");
      expect(screen.getByRole("button", { name: "Edit Juan Soto" }).textContent).toBe("Edit");
    });
  });
});

describe("PlayerTile: Link to existing… (NEO-645)", () => {
  it("opens its search with the printed name typed, and offers no near-spelling button", async () => {
    queryResults["players.nearMatches"] = [];
    renderTile({
      row: card({ pendingPlayerNames: ["Jackson Holiday"] }),
      ctx: context({
        names: [
          printedName({
            nameNormalized: "holiday jackson",
            printed: "Jackson Holiday",
            row: nameRow({ name: "Jackson Holiday" }),
          }),
        ],
      }),
      items: [{ level: "fix", kind: "playerName", names: ["Jackson Holiday"] }],
    });
    expect(screen.queryByRole("button", { name: /^Did you mean/ })).toBeNull();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Link to existing…" })));
    const props = linkSearchProps[linkSearchProps.length - 1];
    expect(props.initialQuery).toBe("Jackson Holiday");
    // The search is main's: no card ranking is passed down.
    expect(props.contextCardId).toBeUndefined();
  });
});

describe("PlayerTile: the set-history suggestion (NEO-645 item 8)", () => {
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

  it("gives way to an exact namesake on file, as on main: only his plain link shows", () => {
    queryResults["players.nearMatches"] = [
      { _id: "player-6", name: "Kendry Morales", confidence: "exact", birthYear: 1983 },
    ];
    renderMorales(sethistory);
    expect(screen.queryByText(line)).toBeNull();
    expect(screen.queryByRole("button", { name: "Link to Kendry Morales (Football)" })).toBeNull();
    expect(screen.getByRole("button", { name: "Link to Kendry Morales" })).toBeTruthy();
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
    queryResults["players.nearMatches"] = [];
    renderOne(morales(setHistory));
    const lead = screen.getByRole("button", { name: "Link to Kendry Morales (Football)" });
    const reason = screen.getByText(
      "Another card in this set is already linked to Kendry Morales (Football). Same one?",
    );
    expect(lead.getAttribute("aria-describedby")).toBe(reason.id);
    expect(reason.id).not.toBe("");
    expect(
      screen.getByRole("button", { name: "Add as new player anyway" }).hasAttribute("aria-describedby"),
    ).toBe(false);
  });

  it("the suggestion is the one filled button when it shows; Add as new player anyway is an outline", () => {
    queryResults["players.nearMatches"] = [];
    renderOne(morales(setHistory));
    expect(filledNames()).toEqual(["Link to Kendry Morales (Football)"]);
    expect(isFilled(screen.getByRole("button", { name: "Add as new player anyway" }))).toBe(false);
  });

  it("an exact namesake takes the suggestion's place: his link is the one filled button", () => {
    queryResults["players.nearMatches"] = [exact];
    renderOne(morales(setHistory));
    expect(filledNames()).toEqual(["Link to Kendry Morales"]);
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
    queryResults["players.nearMatches"] = [];
    renderOne(morales(setHistory));
    wraps(screen.getByRole("button", { name: "Link to Kendry Morales (Football)" }));
    wraps(screen.getByRole("button", { name: "Not a player (checklist, team card, stadium)" }));
  });

  it("the exact link wraps too", () => {
    queryResults["players.nearMatches"] = [exact];
    renderOne(morales());
    wraps(screen.getByRole("button", { name: "Link to Kendry Morales" }));
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

describe("PlayerTile: cameos (T5)", () => {
  const merrill = { playerId: "player-1", name: "Jackson Merrill", sportId: SPORT, stints: [], stintsMore: false };
  const cameoTile = (cameos: Array<{ playerId: string; name: string }>, over: Record<string, unknown> = {}) =>
    renderTile({
      row: card({ playerIds: ["player-1"], secondaryPlayerIds: cameos.map((c) => c.playerId) }),
      items: [],
      ctx: context({ players: [merrill], cameos, ...over }),
    });

  it("'+ Cameo' sits beside '+ Another player' and adds the pick through the attributes panel's own mutation", async () => {
    cameoTile([]);
    const add = screen.getByRole("button", { name: "+ Another player" });
    const cameo = screen.getByRole("button", { name: "+ Cameo" });
    expect(add.parentElement).toBe(cameo.parentElement);
    await act(async () => fireEvent.click(cameo));
    // The same player picker as "+ Another player".
    expect(linkSearchProps.at(-1)?.kind).toBe("player");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Pick a player" })));
    expect(mutation("cardSecondaryPlayers.setSecondaryPlayers")).toHaveBeenCalledWith({
      cardId: CARD,
      playerIds: ["player-9"],
      regenerateListing: true,
    });
    // A cameo is not a player: the card's players are untouched.
    expect(mutation("selectorOptions.updateCard")).not.toHaveBeenCalled();
  });

  it("lists each cameo as a row, 'Francisco Lindor · cameo' with its own Edit", () => {
    cameoTile([
      { playerId: "player-5", name: "Francisco Lindor" },
      { playerId: "player-6", name: "Juan Soto" },
    ]);
    const row = screen.getByRole("group", { name: "Cameo Francisco Lindor" });
    expect(row.textContent).toBe("Francisco Lindor · cameoEdit");
    const edit = screen.getByRole("button", { name: "Edit cameo Francisco Lindor" });
    expect(edit.textContent).toBe("Edit");
    expect(row.contains(edit)).toBe(true);
    expect(screen.getByRole("button", { name: "Edit cameo Juan Soto" })).toBeTruthy();
    // Players and cameos are not mixed: Merrill is a player row, not a cameo.
    expect(screen.queryByRole("group", { name: "Cameo Jackson Merrill" })).toBeNull();
  });

  it("Edit on a cameo swaps it for the pick, keeping the others in order", async () => {
    cameoTile([
      { playerId: "player-5", name: "Francisco Lindor" },
      { playerId: "player-6", name: "Juan Soto" },
    ]);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Edit cameo Francisco Lindor" })));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Pick a player" })));
    expect(mutation("cardSecondaryPlayers.setSecondaryPlayers")).toHaveBeenCalledWith({
      cardId: CARD,
      playerIds: ["player-9", "player-6"],
      regenerateListing: true,
    });
  });

  it("Edit on a cameo can remove it", async () => {
    cameoTile([
      { playerId: "player-5", name: "Francisco Lindor" },
      { playerId: "player-6", name: "Juan Soto" },
    ]);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Edit cameo Juan Soto" })));
    const remove = screen.getByRole("button", { name: "Remove cameo Juan Soto" });
    expect(remove.textContent).toBe("Remove cameo");
    await act(async () => fireEvent.click(remove));
    expect(mutation("cardSecondaryPlayers.setSecondaryPlayers")).toHaveBeenCalledWith({
      cardId: CARD,
      playerIds: ["player-5"],
      regenerateListing: true,
    });
  });

  it("after Remove cameo, focus lands on '+ Cameo' once the query has dropped the cameo (the frame can come first)", async () => {
    const lindor = { playerId: "player-5", name: "Francisco Lindor" };
    const soto = { playerId: "player-6", name: "Juan Soto" };
    const element = (cameos: Array<{ playerId: string; name: string }>) => (
      <AnsweredProvider value={() => {}}>
        <PlayerTile
          row={card({ playerIds: ["player-1"], secondaryPlayerIds: cameos.map((c) => c.playerId) })}
          context={context({ players: [merrill], cameos })}
          attention={{ level: "fix", items: [] }}
          leafId={"leaf-1" as never}
          sportId={SPORT as never}
          leafCards={[]}
          setName="Set"
        />
      </AnsweredProvider>
    );
    // A frame that runs before React has re-rendered: the worst order the old
    // one-frame lookup could meet.
    const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return 0;
    });
    try {
      const { rerender } = render(element([lindor, soto]));
      const edit = screen.getByRole("button", { name: "Edit cameo Juan Soto" });
      edit.focus();
      await act(async () => fireEvent.click(edit));
      let resolve!: (v: null) => void;
      mutation("cardSecondaryPlayers.setSecondaryPlayers").mockReturnValueOnce(
        new Promise((r) => {
          resolve = r;
        }),
      );
      await act(async () => fireEvent.click(screen.getByRole("button", { name: "Remove cameo Juan Soto" })));
      // The write resolves, but the query still lists Soto: nothing to focus yet.
      await act(async () => resolve(null));
      expect(document.activeElement).not.toBe(screen.queryByRole("button", { name: "+ Cameo" }));
      // The query catches up: the tile re-renders without him, and focus follows.
      rerender(element([lindor]));
      expect(screen.queryByRole("button", { name: "Edit cameo Juan Soto" })).toBeNull();
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "+ Cameo" }));
    } finally {
      raf.mockRestore();
    }
  });

  it("a refused Remove cameo keeps the search open, and Cancel returns focus to that cameo's Edit", async () => {
    cameoTile([{ playerId: "player-6", name: "Juan Soto" }]);
    mutation("cardSecondaryPlayers.setSecondaryPlayers").mockRejectedValueOnce(new Error("Server Error"));
    const edit = screen.getByRole("button", { name: "Edit cameo Juan Soto" });
    edit.focus();
    await act(async () => fireEvent.click(edit));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Remove cameo Juan Soto" })));
    expect(screen.getByRole("alert").textContent).toBe("Couldn't remove that cameo. Try again.");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Cancel linking" })));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Edit cameo Juan Soto" }));
  });

  it("Remove is offered only while a cameo is open, never on '+ Cameo'", async () => {
    cameoTile([{ playerId: "player-5", name: "Francisco Lindor" }]);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "+ Cameo" })));
    expect(screen.queryByRole("button", { name: /^Remove cameo/ })).toBeNull();
  });

  it("a card's own player picked as a cameo is refused beside the pick, nothing written", async () => {
    // The mocked search picks "player-9": make that the card's own player.
    renderTile({
      row: card({ playerIds: ["player-9"] }),
      items: [],
      ctx: context({ players: [{ ...merrill, playerId: "player-9" }], cameos: [] }),
    });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "+ Cameo" })));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Pick a player" })));
    expect(screen.getByRole("alert").textContent).toBe("They're already this card's player. No cameo needed.");
    expect(mutation("cardSecondaryPlayers.setSecondaryPlayers")).not.toHaveBeenCalled();
  });

  it("a cameo made a player leaves the cameos in the same write (as the attributes panel does)", async () => {
    cameoTile([{ playerId: "player-9", name: "Someone" }]);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "+ Another player" })));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Pick a player" })));
    expect(mutation("selectorOptions.updateCard")).toHaveBeenCalledWith({
      id: CARD,
      playerIds: ["player-1", "player-9"],
      regenerateListing: true,
    });
    expect(mutation("cardSecondaryPlayers.setSecondaryPlayers")).toHaveBeenCalledWith({
      cardId: CARD,
      playerIds: [],
      regenerateListing: true,
    });
  });

  it("a card with only cameos still shows the tile with its rows", () => {
    renderTile({
      row: card({ secondaryPlayerIds: ["player-5"] }),
      items: [],
      ctx: context({ cameos: [{ playerId: "player-5", name: "Francisco Lindor" }] }),
    });
    expect(screen.getByRole("group", { name: "Cameo Francisco Lindor" })).toBeTruthy();
  });

  it("a cameo write that is refused says so and leaves the picker open", async () => {
    cameoTile([]);
    mutation("cardSecondaryPlayers.setSecondaryPlayers").mockRejectedValueOnce(new Error("Server Error"));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "+ Cameo" })));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Pick a player" })));
    expect(screen.getByRole("alert").textContent).toBe("Couldn't save that cameo. Try again.");
    expect(screen.getByRole("button", { name: "Pick a player" })).toBeTruthy();
  });

  it("Cancel on '+ Cameo' returns focus to that button, which was gone while the search was open", async () => {
    cameoTile([{ playerId: "player-5", name: "Francisco Lindor" }]);
    const cameo = screen.getByRole("button", { name: "+ Cameo" });
    cameo.focus();
    fireEvent.click(cameo);
    fireEvent.click(screen.getByRole("button", { name: "Cancel linking" }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "+ Cameo" })));
  });

  it("the buttons are named so no two read alike", () => {
    cameoTile([{ playerId: "player-5", name: "Francisco Lindor" }]);
    const names = screen.getAllByRole("button").map((b) => b.getAttribute("aria-label") ?? b.textContent);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual([
      "Edit Jackson Merrill",
      "Edit cameo Francisco Lindor",
      "+ Another player",
      "+ Cameo",
    ]);
  });
});

describe("PlayerTile: accessibility (T2, T5, T6)", () => {
  it("names every control, leaves no id on one, and has no axe violation the DOM can show (light and dark)", async () => {
    const axe = (await import("axe-core")).default;
    for (const mode of ["light", "dark"] as const) {
      document.documentElement.setAttribute("data-theme", mode);
      const { container, unmount } = renderTile({
        row: card({ playerIds: ["player-1"], secondaryPlayerIds: ["player-5"] }),
        items: [{ level: "check", kind: "playerName", names: [] }] as never,
        ctx: context({
          players: [{ playerId: "player-1", name: "Jackson Merrill", birthYear: 2003, sportId: SPORT, stints: [], stintsMore: false }],
          cameos: [{ playerId: "player-5", name: "Francisco Lindor" }],
          linkedFor: [{ kind: "player", playerId: "player-1", reason: "careerTeam" }],
        }),
      });
      for (const b of container.querySelectorAll("button")) {
        expect(b.id).toBe("");
        expect((b.getAttribute("aria-label") ?? b.textContent ?? "").trim().length).toBeGreaterThan(0);
      }
      // happy-dom has no layout, so contrast and target-size are the E2E suite's; the rest holds here.
      const result = await axe.run(container, {
        rules: { "color-contrast": { enabled: false }, "target-size": { enabled: false }, region: { enabled: false } },
      });
      expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(" | ")}`)).toEqual([]);
      unmount();
    }
    document.documentElement.removeAttribute("data-theme");
  });
});
