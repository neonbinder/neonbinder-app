/**
 * NEO-645 tile 3, "Player": a skeleton while the spelling is unsettled, one
 * row per printed name, every way to answer a name inline (add as new, not a
 * player, change), the "Linked for you" note, "Printed on", and never an empty
 * "Possible matches".
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
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

import PlayerTile from "./PlayerTile";
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

const fixItem: TidyAttention["items"][number] = { level: "fix", kind: "playerName", names: ["Jackson Merrill"] };

function renderTile(
  opts: {
    row?: TidyRow;
    ctx?: TidyCardContext | undefined;
    items?: TidyAttention["items"];
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
  return render(<PlayerTile {...props} />);
}

beforeEach(() => {
  for (const k of Object.keys(queryResults)) delete queryResults[k];
  for (const k of Object.keys(mutations)) delete mutations[k];
});

describe("PlayerTile", () => {
  it("is a skeleton, with nothing to press, while a players disagreement is unsettled", () => {
    renderTile({ items: [{ level: "fix", kind: "sourcesDisagree", field: "players" }] });
    const tile = screen.getByRole("region", { name: "Player" });
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
    expect(screen.getByRole("region", { name: "Player" }).getAttribute("data-tidy-level")).toBe("waiting");
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
    expect(screen.getByRole("region", { name: "Player" }).getAttribute("data-tidy-level")).toBe("fix");
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

  it("'Add as new player' creates the player from this card's printed name", async () => {
    queryResults["players.nearMatches"] = [];
    renderTile();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add as new player" })));
    expect(mutation("tidyNames.createPlayer")).toHaveBeenCalledWith({ cardId: CARD, name: "Jackson Merrill" });
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
    expect(screen.getByRole("region", { name: "Player" }).getAttribute("data-tidy-level")).toBe("plain");
    expect(screen.getByText("Linked for you: another card in this set is already linked to them")).toBeTruthy();
    expect(screen.getByText(/b\. 2003/)).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Change" })));
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
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Change" })));
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
});
