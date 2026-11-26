/**
 * NEO-645 tile 3, "Player", as NEO-656 left it: a skeleton while the spelling is
 * unsettled, one row per printed name READ FROM THE CARD (linked or still
 * pending), every way to answer a name inline (add as new, not a player,
 * change), "Printed on", and never an empty "Possible matches". The lookup a
 * row shows lives in the walk's memory (`WalkMemory`), keyed by
 * `cardId|kind|name|sportId`; these tests seed it. There is no "Linked for
 * you" note, and "Not a player" is held in memory only while the card is open.
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
          : mod === "adapters"
            ? // `adapters.wikidata.lookupTidyName` is one level deeper than the other modules.
              new Proxy({}, { get: (_a, sub) => new Proxy({}, { get: (_b, fn) => `adapters.${String(sub)}.${String(fn)}` }) })
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
// An action that never answers by default: a name's lookup stays "pending" until a test seeds it.
const actions: Record<string, ReturnType<typeof vi.fn>> = {};
const action = (ref: string) => (actions[ref] ??= vi.fn(() => new Promise(() => {})));
vi.mock("convex/react", () => ({
  useQuery: (ref: string, args: unknown) => (args === "skip" ? undefined : queryResults[ref]),
  useMutation: (ref: string) => mutation(ref),
  useAction: (ref: string) => action(ref),
  useConvex: () => ({ query: vi.fn() }),
}));

const linkSearchProps: Array<Record<string, unknown>> = [];
vi.mock("../../EntityLinkSearch", () => ({
  default: (props: {
    kind: string;
    onSelect: (id: string, n: string) => void;
    onCancel: () => void;
    children?: React.ReactNode;
  }) => {
    linkSearchProps.push(props);
    const { kind, onSelect, onCancel, children } = props;
    return (
    <div>
      {children}
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
import { WalkMemory, WalkMemoryProvider, lookupKeyOf, nameKeyOf } from "../walk-memory";
import { normalizeEntityName } from "@/lib/entities/normalize-name";
import PlayerTile from "./PlayerTile";
import { WRAP_LABEL_CLASS } from "../TidyTile";
import type { TidyAttentionItem } from "../../../../convex/features/cardAttention";
import type { TidyAttention, TidyCardContext, TidyRow, TidyTileProps } from "../tile-types";

const CARD = "card-1";
const SPORT = "sport-1";

const card = (extra: Record<string, unknown> = {}) =>
  ({ _id: CARD, cardNumber: "USC42", cardName: "Jackson Merrill", ...extra }) as unknown as TidyRow;

/** What a name's lookup said (seeded into the walk's memory), as the old tests wrote it. */
const nameRow = (extra: Record<string, unknown> = {}) => ({
  name: "Jackson Merrill",
  sportId: SPORT,
  status: "ready" as const,
  ...extra,
});

/**
 * A name as `tidyCards.cardContext` reads it off the card: kind, printed,
 * pending (waiting) or linked (`playerId`). `row` stands for the lookup the
 * walk holds for it (`enrichment`, `status`) and `answer: linkPlayer` for a
 * name the card already links; neither is stored anywhere but the card.
 */
const printedName = (over: Record<string, unknown> = {}) => {
  const { row = nameRow(), printedOn: _printedOn, ...rest } = over as {
    row?: ReturnType<typeof nameRow> & { answer?: { kind: string; playerId?: string }; enrichment?: unknown };
    printedOn?: unknown;
    [k: string]: unknown;
  };
  const printed = (rest.printed as string | undefined) ?? "Jackson Merrill";
  const linked = row.answer?.kind === "linkPlayer";
  return {
    kind: "player" as const,
    nameNormalized: normalizeEntityName(printed),
    printed,
    order: 0,
    pending: !linked,
    ...(linked ? { playerId: row.answer?.playerId } : {}),
    ...rest,
    // Read by `renderTile` to seed the walk's memory; not part of the context.
    lookup: { status: row.status, enrichment: row.enrichment, sportId: row.sportId },
  };
};

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

let memory: WalkMemory;

/** Put a lookup straight into the walk's memory (the state after the action resolved). */
function seedLookup(
  m: WalkMemory,
  name: { kind: "player" | "team"; printed: string },
  lookup: { status?: string; enrichment?: unknown; sportId?: string },
) {
  const sportId = lookup.sportId ?? SPORT;
  const inner = m as unknown as { lookups: Map<string, unknown>; gateItems: Map<string, unknown> };
  // A lookup in another sport than the set's is the facts' sport for the name (an auto-linked player's home).
  if (sportId !== SPORT) {
    inner.gateItems.set(nameKeyOf(name.kind, name.printed), { kind: name.kind, name: name.printed, sportId });
  }
  inner.lookups.set(lookupKeyOf(CARD, name.kind, name.printed, sportId), {
    status: lookup.status ?? "ready",
    ...(lookup.enrichment ? { enrichment: lookup.enrichment } : {}),
  });
}

function renderTile(
  opts: {
    row?: TidyRow;
    ctx?: TidyCardContext | undefined;
    items?: TidyAttentionItem[];
    onAnswered?: () => void;
    leafCards?: TidyRow[];
    /** Name keys to leave unseeded: their lookup is still pending. */
    unseeded?: boolean;
  } = {},
) {
  const ctx = "ctx" in opts ? opts.ctx : context({ names: [printedName()] });
  if (!opts.unseeded) {
    for (const n of (ctx?.names ?? []) as unknown as Array<{
      kind: "player" | "team";
      printed: string;
      pending: boolean;
      lookup?: { status?: string; enrichment?: unknown; sportId?: string };
    }>) {
      if (n.pending && n.lookup) seedLookup(memory, n, n.lookup);
    }
  }
  const props: TidyTileProps = {
    row: opts.row ?? card({ pendingPlayerNames: ["Jackson Merrill"] }),
    context: ctx,
    attention: { level: "fix", items: opts.items ?? [fixItem] },
    leafId: "leaf-1" as never,
    sportId: SPORT as never,
    leafCards: opts.leafCards ?? [],
    setName: "Set",
  };
  return render(
    <WalkMemoryProvider value={memory}>
      <AnsweredProvider value={opts.onAnswered ?? (() => {})}>
        <PlayerTile {...props} />
      </AnsweredProvider>
    </WalkMemoryProvider>,
  );
}

beforeEach(() => {
  memory = new WalkMemory();
  for (const k of Object.keys(actions)) delete actions[k];
  linkSearchProps.length = 0;
  for (const k of Object.keys(queryResults)) delete queryResults[k];
  for (const k of Object.keys(mutations)) delete mutations[k];
  queryResults["players.nameFragmentCheck"] = { isFragment: false };
  // The real mutation answers with the player it made (NEO-657's prefilled stint reads it).
  mutation("tidyNames.createPlayer").mockResolvedValue({ playerId: "player-new" });
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
          }),
        ],
      }),
      // "Printed on" is counted from the checklist's own cards still waiting on the name.
      leafCards: [
        card({ _id: "card-1", cardNumber: "USC1", pendingPlayerNames: ["Jackson Merrill"] }),
        card({ _id: "card-2", cardNumber: "USC17", pendingPlayerNames: ["Jackson Merrill"] }),
        card({ _id: "card-3", cardNumber: "USC20", playerIds: ["player-1"] }),
      ],
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

  it("holds the row while the card's link-on-open call is in flight, then gives the buttons back (NEO-680)", async () => {
    queryResults["players.nearMatches"] = [];
    memory.beginLinkOnOpen(CARD);
    renderTile();
    expect(screen.getByText("Checking for players by that name…").getAttribute("role")).toBe("status");
    expect(screen.queryByText("“Jackson Merrill” is new to NeonBinder.")).toBeNull();
    const add = screen.getByRole("button", { name: "Add as new player" });
    expect(add.getAttribute("aria-disabled")).toBe("true");
    await act(async () => fireEvent.click(add));
    expect(mutation("tidyNames.createPlayer")).not.toHaveBeenCalled();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Not a player (checklist, team card, stadium)" })));
    expect(mutation("tidyNames.answerName")).not.toHaveBeenCalled();

    act(() => memory.endLinkOnOpen(CARD));
    expect(screen.queryByText("Checking for players by that name…")).toBeNull();
    expect(screen.getByText("“Jackson Merrill” is new to NeonBinder.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add as new player" }).getAttribute("aria-disabled")).toBeNull();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add as new player" })));
    expect(mutation("tidyNames.createPlayer")).toHaveBeenCalledTimes(1);
  });

  it("a link-on-open call for another card holds nothing here (NEO-680)", () => {
    queryResults["players.nearMatches"] = [];
    memory.beginLinkOnOpen("card-other");
    renderTile();
    expect(screen.queryByText("Checking for players by that name…")).toBeNull();
    expect(screen.getByRole("button", { name: "Add as new player" }).getAttribute("aria-disabled")).toBeNull();
  });

  it("'Add as new player' creates the player from this card's printed name", async () => {
    queryResults["players.nearMatches"] = [];
    renderTile();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add as new player" })));
    expect(mutation("tidyNames.createPlayer")).toHaveBeenCalledWith({
      cardId: CARD,
      name: "Jackson Merrill",
      sportId: SPORT,
    });
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

    it("creates with every team when nothing was unticked (no exclusion key sent); the career the operator saw seeds the player", async () => {
      queryResults["players.nearMatches"] = [];
      renderTile({ ctx: careerCtx() });
      await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add as new player" })));
      expect(mutation("tidyNames.createPlayer")).toHaveBeenCalledWith({
        cardId: CARD,
        name: "Jackson Merrill",
        sportId: SPORT,
        enrichment: { careerTeams: [
          { name: "San Diego Padres", fromYear: 2024 },
          { name: "Salt Lake Bees", fromYear: 2022, toYear: 2023 },
        ] },
      });
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
        sportId: SPORT,
        excludedCareerTeamNames: ["Salt Lake Bees"],
        enrichment: { careerTeams: [
          { name: "San Diego Padres", fromYear: 2024 },
          { name: "Salt Lake Bees", fromYear: 2022, toYear: 2023 },
        ] },
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
        sportId: SPORT,
        excludedCareerTeamNames: ["Los Angeles Angels"],
        enrichment: { careerTeams: [
          { name: "Los Angeles Angels", fromYear: 2011, toYear: 2013 },
          { name: "Los Angeles Angels", fromYear: 2016 },
        ] },
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
      sportId: SPORT,
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
      sportId: SPORT,
      answer: { kind: "linkPlayer", playerId: "player-1" },
    });
    expect(screen.getByRole("button", { name: "Add as new player anyway" })).toBeTruthy();
  });

  it("a linked name is plain and Edit clears the answer; no 'Linked for you' note is ever shown", async () => {
    renderTile({
      row: card({ playerIds: ["player-1"] }),
      items: [],
      ctx: context({
        names: [printedName({ pending: false, row: nameRow({ answer: { kind: "linkPlayer", playerId: "player-1" } }) })],
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
      }),
    });
    expect(screen.getByRole("group", { name: "Player" }).getAttribute("data-tidy-level")).toBe("plain");
    expect(screen.queryByText(/Linked for you/)).toBeNull();
    expect(screen.queryByRole("note")).toBeNull();
    expect(screen.getByText(/b\. 2003/)).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Edit Jackson Merrill" })));
    expect(mutation("tidyNames.answerName")).toHaveBeenCalledWith({
      cardId: CARD,
      kind: "player",
      name: "Jackson Merrill",
      sportId: SPORT,
      answer: { kind: "clear" },
    });
  });

  it("a name linked through a saved alias carries one purple note, the tile stays plain, and Edit holds the name back from linking again (NEO-680)", async () => {
    renderTile({
      row: card({ playerIds: ["player-1"] }),
      items: [],
      ctx: context({
        names: [
          printedName({
            printed: "Hye-Seong Kim",
            pending: false,
            row: nameRow({ answer: { kind: "linkPlayer", playerId: "player-1" } }),
          }),
        ],
        players: [
          {
            playerId: "player-1",
            name: "Kim Ha-Seong",
            nameOnCard: "Hye-Seong Kim",
            linkedByAlias: "Hye-Seong Kim",
            sportId: SPORT,
            stints: [],
            stintsMore: false,
          },
        ],
      }),
    });
    expect(screen.getAllByRole("note").map((n) => n.textContent)).toEqual(["Linked by alias"]);
    expect(screen.getByRole("group", { name: "Player" }).getAttribute("data-tidy-level")).toBe("plain");
    expect(memory.heldBackNames(CARD, "player")).toEqual([]);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Edit Kim Ha-Seong" })));
    expect(memory.heldBackNames(CARD, "player")).toEqual(["Hye-Seong Kim"]);
  });

  it("a link the card keeps no printed name for has no note, and Edit changes this card only", async () => {
    renderTile({
      row: card({ playerIds: ["player-1"] }),
      items: [],
      ctx: context({
        players: [{ playerId: "player-1", name: "Jackson Merrill", sportId: SPORT, stints: [], stintsMore: false }],
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

  it("an older server's linkedFor reasons draw no note: the client no longer reads them", () => {
    renderTile({
      row: card({ playerIds: ["player-1"] }),
      items: [],
      ctx: context({
        players: [{ playerId: "player-1", name: "Jackson Merrill", sportId: SPORT, stints: [], stintsMore: false }],
        linkedFor: [{ kind: "player", playerId: "player-1", reason: "setHistory" }],
      }),
    });
    expect(screen.queryByRole("note")).toBeNull();
    expect(screen.queryByText(/Linked for you/)).toBeNull();
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

    it("Add as new player remembers the player in the walk, for the Career tile's prefilled stint (NEO-657)", async () => {
    queryResults["players.nearMatches"] = [];
    renderTile({});
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add as new player" })));
    expect(memory.madeOnCard(CARD, "player-new")).toBe(true);
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
            row: nameRow({ answer: { kind: "linkPlayer", playerId: "player-1" } }),
          }),
          printedName({
            printed: "Juan Soto",
            order: 1,
            row: nameRow({ name: "Juan Soto", answer: { kind: "linkPlayer", playerId: "player-2" } }),
          }),
        ],
        players: [
          { playerId: "player-1", name: "Jackson Merrill", sportId: SPORT, stints: [], stintsMore: false },
          { playerId: "player-2", name: "Juan Soto", sportId: SPORT, stints: [], stintsMore: false },
        ],
      });
      renderTile({ row: card({ playerIds: ["player-1", "player-2"] }), items: [], ctx });
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

describe("PlayerTile: remember the printed name as a name for the picked player (NEO-671)", () => {
  const REMEMBER = "Remember “Jackson Merrill” as a name for this player";
  const close = { _id: "player-7", name: "Jackson Merrill Jr.", confidence: "close" as const };

  it("is checked by default under Possible matches, and a pick from there sends saveAsAlias", async () => {
    queryResults["players.nearMatches"] = [close];
    renderTile();
    const box = screen.getByRole("checkbox", { name: REMEMBER }) as HTMLInputElement;
    expect(box.checked).toBe(true);
    expect(box.className).toContain("h-6");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /^Link to Jackson Merrill Jr\./ })));
    expect(mutation("tidyNames.answerName")).toHaveBeenCalledWith({
      cardId: CARD,
      kind: "player",
      name: "Jackson Merrill",
      sportId: SPORT,
      answer: { kind: "linkPlayer", playerId: "player-7", saveAsAlias: true },
    });
  });

  it("unchecked, the same pick sends no flag", async () => {
    queryResults["players.nearMatches"] = [close];
    renderTile();
    fireEvent.click(screen.getByRole("checkbox", { name: REMEMBER }));
    expect((screen.getByRole("checkbox", { name: REMEMBER }) as HTMLInputElement).checked).toBe(false);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /^Link to Jackson Merrill Jr\./ })));
    expect(mutation("tidyNames.answerName")).toHaveBeenCalledWith({
      cardId: CARD,
      kind: "player",
      name: "Jackson Merrill",
      sportId: SPORT,
      answer: { kind: "linkPlayer", playerId: "player-7" },
    });
  });

  it("is not shown with nothing to pick from", () => {
    queryResults["players.nearMatches"] = [];
    renderTile();
    expect(screen.queryByRole("checkbox", { name: REMEMBER })).toBeNull();
  });

  it("is not shown beside the exact-name link, which sends no flag", async () => {
    queryResults["players.nearMatches"] = [
      { _id: "player-1", name: "Jackson Merrill", confidence: "exact", birthYear: 2003 },
    ];
    renderTile();
    expect(screen.queryByRole("checkbox", { name: REMEMBER })).toBeNull();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Link to Jackson Merrill" })));
    expect(mutation("tidyNames.answerName")).toHaveBeenCalledWith({
      cardId: CARD,
      kind: "player",
      name: "Jackson Merrill",
      sportId: SPORT,
      answer: { kind: "linkPlayer", playerId: "player-1" },
    });
  });

  it("an exact link sends no flag even while Possible matches shows the box checked", async () => {
    queryResults["players.nearMatches"] = [
      { _id: "player-1", name: "Jackson Merrill", confidence: "exact", birthYear: 2003 },
      close,
    ];
    renderTile();
    expect((screen.getByRole("checkbox", { name: REMEMBER }) as HTMLInputElement).checked).toBe(true);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Link to Jackson Merrill" })));
    expect(mutation("tidyNames.answerName")).toHaveBeenCalledWith({
      cardId: CARD,
      kind: "player",
      name: "Jackson Merrill",
      sportId: SPORT,
      answer: { kind: "linkPlayer", playerId: "player-1" },
    });
  });

  it("is shown with Link to existing…, checked, and its pick sends the flag", async () => {
    queryResults["players.nearMatches"] = [];
    renderTile();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Link to existing…" })));
    const box = screen.getByRole("checkbox", { name: REMEMBER }) as HTMLInputElement;
    expect(box.checked).toBe(true);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Pick a player" })));
    expect(mutation("tidyNames.answerName")).toHaveBeenCalledWith({
      cardId: CARD,
      kind: "player",
      name: "Jackson Merrill",
      sportId: SPORT,
      answer: { kind: "linkPlayer", playerId: "player-9", saveAsAlias: true },
    });
  });

  it("tabs before the picks: ahead of the Possible matches buttons and the search results", async () => {
    queryResults["players.nearMatches"] = [close];
    renderTile();
    const box = screen.getByRole("checkbox", { name: REMEMBER });
    const pick = screen.getByRole("button", { name: /^Link to Jackson Merrill Jr\./ });
    expect(box.compareDocumentPosition(pick) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Link to existing…" })));
    const open = screen.getByRole("checkbox", { name: REMEMBER });
    const search = screen.getByRole("button", { name: "Pick a player" });
    expect(open.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("is not shown with the one-name fragment question, whose pick sends no flag", async () => {
    queryResults["players.nearMatches"] = [];
    queryResults["players.nameFragmentCheck"] = {
      isFragment: true,
      matches: [{ _id: "player-3", name: "Jackson Merrill Sr.", birthYear: 1970 }],
    };
    renderTile();
    expect(screen.queryByRole("checkbox", { name: REMEMBER })).toBeNull();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /Jackson Merrill Sr\./ })));
    expect(mutation("tidyNames.answerName")).toHaveBeenCalledWith({
      cardId: CARD,
      kind: "player",
      name: "Jackson Merrill",
      sportId: SPORT,
      answer: { kind: "linkPlayer", playerId: "player-3" },
    });
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

  it("linking the set-history pick asks the server to prove it: the action, with offered, never the mutation", async () => {
    queryResults["players.nearMatches"] = [];
    actions["tidyNames.answerOfferedName"] = vi.fn().mockResolvedValue(null);
    mutations["tidyNames.answerName"]?.mockClear();
    renderMorales(sethistory);
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Link to Kendry Morales (Football)" })),
    );
    expect(action("tidyNames.answerOfferedName")).toHaveBeenCalledWith({
      cardId: CARD,
      kind: "player",
      name: "Kendry Morales",
      sportId: SPORT,
      answer: { kind: "linkPlayer", playerId: "player-5" },
      offered: true,
    });
    expect(mutation("tidyNames.answerName")).not.toHaveBeenCalled();
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
          printedName({ row: nameRow({ answer: { kind: "linkPlayer", playerId: "player-1" } }) }),
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

describe("PlayerTile: answers live on the card, the lookup in the walk's memory (NEO-656)", () => {
  const rerenderWith = (view: ReturnType<typeof renderTile>, props: Partial<TidyTileProps>) =>
    view.rerender(
      <WalkMemoryProvider value={memory}>
        <AnsweredProvider value={() => {}}>
          <PlayerTile
            row={card()}
            context={context()}
            attention={{ level: "none", items: [] }}
            leafId={"leaf-1" as never}
            sportId={SPORT as never}
            leafCards={[]}
            setName="Set"
            {...props}
          />
        </AnsweredProvider>
      </WalkMemoryProvider>,
    );

  it("'Not a player' is held in memory only: once the card drops the name, a 'is not a player' row with Edit stays while the card is open", async () => {
    queryResults["players.nearMatches"] = [];
    const view = renderTile();
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Not a player (checklist, team card, stadium)" })),
    );
    expect(memory.answersOn(CARD, "player")).toEqual([{ kind: "notEntity", printed: "Jackson Merrill" }]);
    rerenderWith(view, { context: context() });
    expect(screen.getByRole("group", { name: "Player Jackson Merrill" }).textContent).toContain("is not a player.");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Edit Jackson Merrill" })));
    expect(mutation("tidyNames.answerName")).toHaveBeenLastCalledWith({
      cardId: CARD,
      kind: "player",
      name: "Jackson Merrill",
      sportId: SPORT,
      answer: { kind: "clear" },
    });
    expect(memory.answersOn(CARD, "player")).toEqual([]);
  });

  it("Edit on a ruled-out name holds it back from the link on open for the sitting (NEO-680)", async () => {
    memory.rememberAnswer(CARD, "player", "Jackson Merrill", { kind: "notEntity", printed: "Jackson Merrill" });
    renderTile({ row: card(), items: [], ctx: context() });
    expect(memory.heldBackNames(CARD, "player")).toEqual([]);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Edit Jackson Merrill" })));
    expect(memory.heldBackNames(CARD, "player")).toEqual(["Jackson Merrill"]);
  });

  it("Edit on a ruled-out name hands focus to the first control of the row it re-opens, not to <body> or another tile (A3)", async () => {
    queryResults["players.nearMatches"] = [];
    memory.rememberAnswer(CARD, "player", "Jackson Merrill", { kind: "notEntity", printed: "Jackson Merrill" });
    const view = renderTile({ row: card(), items: [], ctx: context() });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Edit Jackson Merrill" })));
    // Convex delivers the card with the name waiting again; the ruled-out row is replaced by the question.
    rerenderWith(view, { row: card({ pendingPlayerNames: ["Jackson Merrill"] }), context: context({ names: [printedName()] }) });
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });
    const group = screen.getByRole("group", { name: "Player Jackson Merrill" });
    expect(screen.queryByText(/is not a player\./)).toBeNull();
    const first = group.querySelector<HTMLElement>("button, input, [tabindex]");
    expect(first).not.toBeNull();
    expect(document.activeElement).toBe(first);
  });

  it("a refused Edit on a ruled-out name keeps the ruling and says so", async () => {
    memory.rememberAnswer(CARD, "player", "Jackson Merrill", { kind: "notEntity", printed: "Jackson Merrill" });
    mutation("tidyNames.answerName").mockRejectedValueOnce(new Error("Server Error"));
    renderTile({ row: card(), items: [], ctx: context() });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Edit Jackson Merrill" })));
    expect(screen.getByRole("alert").textContent).toBe("Couldn't change that answer. Try again.");
    expect(memory.answersOn(CARD, "player")).toHaveLength(1);
  });

  it("a ruled-out name that is waiting again is the question, not a second 'is not a player' row", () => {
    queryResults["players.nearMatches"] = [];
    memory.rememberAnswer(CARD, "player", "Jackson Merrill", { kind: "notEntity", printed: "Jackson Merrill" });
    renderTile();
    expect(screen.queryByText(/is not a player\./)).toBeNull();
    expect(screen.getByRole("button", { name: "Add as new player" })).toBeTruthy();
  });

  it("Apply to all after 'Not a player' reaches only the cards still waiting, and says Cleared", async () => {
    const applyNameToAll = (actions["tidyNames.applyNameToAll"] = vi.fn().mockResolvedValue({ linked: 2, skipped: 0 }));
    memory.rememberAnswer(CARD, "player", "Jackson Merrill", { kind: "notEntity", printed: "Jackson Merrill" });
    renderTile({
      row: card(),
      items: [],
      ctx: context(),
      leafCards: [
        card(),
        card({ _id: "card-2", cardNumber: "2", pendingPlayerNames: ["Jackson Merrill"] }),
        card({ _id: "card-3", cardNumber: "3", pendingPlayerNames: ["Jackson Merrill"] }),
        card({ _id: "card-4", cardNumber: "4", playerIds: ["player-1"] }),
      ],
    });
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Apply to all cards printing “Jackson Merrill”" })),
    );
    expect(applyNameToAll).toHaveBeenCalledWith({
      cardId: CARD,
      kind: "player",
      name: "Jackson Merrill",
      answer: { kind: "notEntity" },
    });
    expect(screen.getByText("Cleared 2 more cards.")).toBeTruthy();
  });

  it("a linked name offers Apply to all with the card's own link, never before the answer", async () => {
    const applyNameToAll = (actions["tidyNames.applyNameToAll"] = vi.fn().mockResolvedValue({ linked: 1, skipped: 1 }));
    const waiting = card({ _id: "card-2", cardNumber: "2", pendingPlayerNames: ["Jackson Merrill"] });
    // Unanswered: nothing is offered yet.
    queryResults["players.nearMatches"] = [];
    const view = renderTile({ leafCards: [card({ pendingPlayerNames: ["Jackson Merrill"] }), waiting] });
    expect(screen.queryByRole("button", { name: /Apply to all/ })).toBeNull();
    rerenderWith(view, {
      row: card({ playerIds: ["player-1"] }),
      context: context({
        names: [printedName({ pending: false, row: nameRow({ answer: { kind: "linkPlayer", playerId: "player-1" } }) })],
        players: [{ playerId: "player-1", name: "Jackson Merrill", sportId: SPORT, stints: [], stintsMore: false }],
      }),
      leafCards: [card({ playerIds: ["player-1"] }), waiting],
    });
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Apply to all cards printing “Jackson Merrill”" })),
    );
    expect(applyNameToAll).toHaveBeenCalledWith({
      cardId: CARD,
      kind: "player",
      name: "Jackson Merrill",
      answer: { kind: "linkPlayer", playerId: "player-1" },
    });
    expect(screen.getByText("Linked 1 more card. 1 left as it was.")).toBeTruthy();
  });

  it("nothing is offered when no other card waits on the name", () => {
    renderTile({
      row: card({ playerIds: ["player-1"] }),
      items: [],
      ctx: context({
        names: [printedName({ pending: false, row: nameRow({ answer: { kind: "linkPlayer", playerId: "player-1" } }) })],
        players: [{ playerId: "player-1", name: "Jackson Merrill", sportId: SPORT, stints: [], stintsMore: false }],
      }),
      leafCards: [card({ playerIds: ["player-1"] })],
    });
    expect(screen.queryByRole("button", { name: /Apply to all/ })).toBeNull();
  });

  describe("a lookup that failed", () => {
    it("says so, leaves every answer on offer (missing data is not a claim), and Try again asks once more", async () => {
      queryResults["players.nearMatches"] = [];
      renderTile({ ctx: context({ names: [printedName({ row: nameRow({ status: "error" }) })] }) });
      expect(screen.getByText("Couldn't look this one up.")).toBeTruthy();
      expect(screen.queryByText("Checking for players by that name…")).toBeNull();
      const add = screen.getByRole("button", { name: "Add as new player" });
      expect(add.getAttribute("aria-disabled")).toBeNull();
      const lookup = action("adapters.wikidata.lookupTidyName");
      expect(lookup).not.toHaveBeenCalled();
      await act(async () => fireEvent.click(screen.getByRole("button", { name: "Try again" })));
      expect(lookup).toHaveBeenCalledTimes(1);
      expect(lookup).toHaveBeenCalledWith({
        cardId: CARD,
        kind: "player",
        name: "Jackson Merrill",
        sportId: SPORT,
      });
      // Asked again: pending now, so Try again is gone until it answers.
      expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    });

    it("a lookup still pending holds 'Add as new player' (a created player can't be taken back)", async () => {
      queryResults["players.nearMatches"] = [];
      renderTile({ unseeded: true });
      const add = screen.getByRole("button", { name: "Add as new player" });
      expect(add.getAttribute("aria-disabled")).toBe("true");
      await act(async () => fireEvent.click(add));
      expect(mutation("tidyNames.createPlayer")).not.toHaveBeenCalled();
    });
  });

  it("writes nothing to sessionStorage or localStorage while answering", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    queryResults["players.nearMatches"] = [];
    renderTile();
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Not a player (checklist, team card, stadium)" })),
    );
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
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
