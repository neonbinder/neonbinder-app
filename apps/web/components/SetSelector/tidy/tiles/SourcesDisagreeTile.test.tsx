/**
 * NEO-645 callout 2 — "Sources disagree": one column per source, a pick per
 * distinct value, "Type another…", Change, and the
 * apply-to-the-same offer (which only proposes; the server checks each card).
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConvexError } from "convex/values";

vi.mock("../../../../convex/_generated/api", () => ({
  api: {
    tidyCards: { pickSourceValue: "tidyCards.pickSourceValue" },
    tidyCameo: { pickSourceAsCameo: "tidyCameo.pickSourceAsCameo" },
  },
}));
const mockPick = vi.fn();
const mockPickCameo = vi.fn();
vi.mock("convex/react", () => ({
  useMutation: (ref: string) =>
    ref === "tidyCards.pickSourceValue"
      ? mockPick
      : ref === "tidyCameo.pickSourceAsCameo"
        ? mockPickCameo
        : vi.fn(),
}));

import { AnsweredProvider } from "../answered";
import { WalkMemory, WalkMemoryProvider } from "../walk-memory";
import SourcesDisagreeTile from "./SourcesDisagreeTile";
import type { TidyAttention, TidyRow, TidyTileProps } from "../tile-types";
import type { TidyDisagreement as RowDisagreement } from "../../../../convex/features/cardAttention";

const MERRIL = ["Jackson Merril"];
const MERRILL = ["Jackson Merrill"];
const UNCHOSEN: RowDisagreement = {
  field: "players",
  values: [
    { value: MERRIL, sources: ["bsc", "sportlots"] },
    { value: MERRILL, sources: ["checklist"] },
  ],
};

const rowOf = (id: string, d?: RowDisagreement): TidyRow =>
  ({
    _id: id,
    cardNumber: "USC42",
    cardName: "Jackson Merrill",
    ...(d ? { sourceDisagreements: [d] } : {}),
  }) as unknown as TidyRow;

function renderTile(
  d: RowDisagreement | undefined,
  {
    attention,
    leafCards,
    context,
    onAnswered = () => {},
  }: {
    attention?: TidyAttention;
    leafCards?: TidyRow[];
    context?: unknown;
    onAnswered?: () => void;
  } = {},
) {
  const row = rowOf("card-1", d);
  const props: TidyTileProps = {
    row,
    context: context as TidyTileProps["context"],
    attention: attention ?? { level: d && !d.chosen ? "fix" : "none", items: [] },
    leafId: "leaf-1" as never,
    sportId: undefined,
    leafCards: leafCards ?? [row],
    setName: "Topps Chrome Update",
  };
  return render(
    <AnsweredProvider value={onAnswered}>
      <SourcesDisagreeTile {...props} />
    </AnsweredProvider>,
  );
}

/**
 * NEO-656: a pick removes the disagreement from the card, so the card keeps
 * only the result. This drives the real thing: click the pick, then re-render
 * the row the way Convex would deliver it, with the entry gone. The walk's
 * memory (one shared object, as in the walk) is what keeps "Using" on screen.
 */
async function renderPicked(
  d: RowDisagreement,
  pickName: string,
  { leafCards = [], context }: { leafCards?: TidyRow[]; context?: unknown } = {},
) {
  const memory = new WalkMemory();
  const make = (row: TidyRow, cards: TidyRow[]): TidyTileProps => ({
    row,
    context: context as TidyTileProps["context"],
    attention: { level: "fix", items: [] },
    leafId: "leaf-1" as never,
    sportId: undefined,
    leafCards: cards,
    setName: "Set",
  });
  const tree = (props: TidyTileProps) => (
    <WalkMemoryProvider value={memory}>
      <SourcesDisagreeTile {...props} />
    </WalkMemoryProvider>
  );
  const open = rowOf("card-1", d);
  const view = render(tree(make(open, [open, ...leafCards])));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: pickName })));
  const settled = rowOf("card-1");
  view.rerender(tree(make(settled, [settled, ...leafCards])));
  return { memory, view };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPick.mockResolvedValue({ applied: 1, scheduled: 0, refused: 0 });
  mockPickCameo.mockResolvedValue({ playerId: "player-1", name: "It Takes Two CPC" });
});

describe("SourcesDisagreeTile", () => {
  it("renders nothing for a card the sources agree on", () => {
    const { container } = renderTile(undefined);
    expect(container.textContent).toBe("");
  });

  it("is pink with one column per source, labelled as Match Cards labels them", () => {
    renderTile(UNCHOSEN);
    const section = screen.getByRole("group", { name: "Sources disagree" });
    expect(section.getAttribute("data-tidy-level")).toBe("fix");
    const columns = within(screen.getByRole("list", { name: /What each source says/ })).getAllByRole("listitem");
    expect(columns.map((c) => c.textContent)).toEqual([
      expect.stringContaining("BSC"),
      expect.stringContaining("SportLots"),
      expect.stringContaining("Checklist"),
    ]);
    expect(columns[0].textContent).toContain("Jackson Merril");
    expect(columns[2].textContent).toContain("Jackson Merrill");
  });

  it("offers a button per distinct value and no 'Not sure yet'", () => {
    renderTile(UNCHOSEN);
    expect(screen.getByRole("button", { name: "Use “Jackson Merril”" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Use “Jackson Merrill”" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Type another… player name" })).toBeTruthy();
    expect(screen.queryByText(/not sure/i)).toBeNull();
  });

  describe("a source that named no team", () => {
    const NO_TEAM: RowDisagreement = {
      field: "teams",
      values: [
        { value: [], sources: ["sportlots"] },
        { value: ["San Diego Padres"], sources: ["bsc"] },
      ],
    };

    it("says it in the column, never an empty one", () => {
      renderTile(NO_TEAM);
      const columns = within(screen.getByRole("list", { name: /What each source says/ })).getAllByRole("listitem");
      expect(columns.map((c) => c.textContent)).toEqual([
        "BSCSan Diego Padres",
        "SportLotsNo team on the card",
      ]);
    });

    it("names its button 'Use no team', and picking it sends the empty list", async () => {
      renderTile(NO_TEAM);
      expect(screen.queryByRole("button", { name: "Use “”" })).toBeNull();
      expect(screen.getByRole("button", { name: "Use “San Diego Padres”" })).toBeTruthy();
      await act(async () => fireEvent.click(screen.getByRole("button", { name: "Use no team" })));
      expect(mockPick).toHaveBeenCalledWith({ cardId: "card-1", field: "teams", value: [] });
      expect(screen.getByRole("status").textContent).toBe("");
    });

    it("an answer of no team reads 'Using no team'", async () => {
      await renderPicked(NO_TEAM, "Use no team");
      expect(screen.getByRole("status").textContent).toBe("Using no team (SportLots)");
    });
  });

  it("a pick calls pickSourceValue for this card and field", async () => {
    renderTile(UNCHOSEN);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Use “Jackson Merrill”" })));
    expect(mockPick).toHaveBeenCalledWith({ cardId: "card-1", field: "players", value: MERRILL });
  });

  it("'Type another…' opens an inline field; Enter sends the typed names with typed: true", async () => {
    renderTile(UNCHOSEN);
    fireEvent.click(screen.getByRole("button", { name: "Type another… player name" }));
    const field = screen.getByLabelText("Type the player name yourself");
    fireEvent.change(field, { target: { value: "Aaron Judge / Juan Soto" } });
    await act(async () => {
      fireEvent.keyDown(field, { key: "Enter" });
    });
    expect(mockPick).toHaveBeenCalledWith({
      cardId: "card-1",
      field: "players",
      value: ["Aaron Judge", "Juan Soto"],
      typed: true,
    });
  });

  it("Esc closes the typed field and returns focus to its button", async () => {
    renderTile(UNCHOSEN);
    const open = screen.getByRole("button", { name: "Type another… player name" });
    fireEvent.click(open);
    fireEvent.keyDown(screen.getByLabelText("Type the player name yourself"), { key: "Escape" });
    expect(screen.queryByLabelText("Type the player name yourself")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(open));
  });

  it("names the repeated buttons by their field, keeping the visible words in the name", () => {
    renderTile(UNCHOSEN);
    const type = screen.getByRole("button", { name: "Type another… player name" });
    expect(type.textContent).toBe("Type another…");
    fireEvent.click(type);
    const use = screen.getByRole("button", { name: "Use this player name" });
    expect(use.textContent).toBe("Use this");
  });

  it("a pick is an answer: it tells the walk, and focus is not sent back to Change", async () => {
    const onAnswered = vi.fn();
    renderTile(UNCHOSEN, { onAnswered });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Use “Jackson Merrill”" })));
    expect(onAnswered).toHaveBeenCalledTimes(1);
  });

  it("a refused pick tells the walk nothing", async () => {
    const onAnswered = vi.fn();
    mockPick.mockRejectedValueOnce(new Error("no"));
    renderTile(UNCHOSEN, { onAnswered });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Use “Jackson Merrill”" })));
    expect(onAnswered).not.toHaveBeenCalled();
  });

  it("an empty typed value sends nothing", () => {
    renderTile(UNCHOSEN);
    fireEvent.click(screen.getByRole("button", { name: "Type another… player name" }));
    fireEvent.change(screen.getByLabelText("Type the player name yourself"), { target: { value: "  /  " } });
    fireEvent.keyDown(screen.getByLabelText("Type the player name yourself"), { key: "Enter" });
    expect(mockPick).not.toHaveBeenCalled();
  });

  it("shows a refused pick inline, with the server's own words", async () => {
    mockPick.mockRejectedValueOnce(new ConvexError("That card changed. Refresh and try again."));
    renderTile(UNCHOSEN);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Use “Jackson Merril”" })));
    expect(screen.getByRole("alert").textContent).toBe("That card changed. Refresh and try again.");
  });

  describe("answered by the operator", () => {
    it("says what is used and where it came from, with Change", async () => {
      await renderPicked(UNCHOSEN, "Use “Jackson Merrill”");
      expect(screen.getByText("Using “Jackson Merrill” (Checklist)")).toBeTruthy();
      expect(screen.getByRole("group", { name: "Sources disagree" }).getAttribute("data-tidy-level")).toBe("plain");
      fireEvent.click(screen.getByRole("button", { name: "Change the player name" }));
      expect(screen.getByRole("button", { name: "Use “Jackson Merril”" })).toBeTruthy();
    });

    it("a legacy `chosen` on the card is settled: the tile offers nothing (the card keeps only the result)", () => {
      const { container } = renderTile({ ...UNCHOSEN, chosen: { value: MERRILL, by: "operator" } } as RowDisagreement);
      expect(container.textContent).toBe("");
    });

    it("offers the cards with the same open disagreement, and only those; sends what the sources gave", async () => {
      const same = rowOf("card-2", UNCHOSEN);
      const reordered = rowOf("card-3", { ...UNCHOSEN, values: [...UNCHOSEN.values].reverse() });
      const settled = rowOf("card-4");
      const other = rowOf("card-5", { field: "players", values: [{ value: ["A"], sources: ["bsc"] }, { value: ["B"], sources: ["checklist"] }] });
      const teams = rowOf("card-6", { ...UNCHOSEN, field: "teams" });
      await renderPicked(UNCHOSEN, "Use “Jackson Merrill”", { leafCards: [same, reordered, settled, other, teams] });
      const apply = screen.getByRole("button", { name: "Apply to the 2 cards with the same disagreement" });
      mockPick.mockClear();
      await act(async () => fireEvent.click(apply));
      expect(mockPick).toHaveBeenCalledWith({
        cardId: "card-1",
        field: "players",
        value: MERRILL,
        cardIds: ["card-2", "card-3"],
        // The card no longer carries the entry, so the values ride with the call.
        offered: [MERRIL, MERRILL],
      });
    });

    it("the first pick sends no `offered` (the card still carries the entry)", async () => {
      renderTile(UNCHOSEN);
      await act(async () => fireEvent.click(screen.getByRole("button", { name: "Use “Jackson Merrill”" })));
      expect(mockPick.mock.calls[0][0]).not.toHaveProperty("offered");
    });

    it("offers nothing when no other card shares it", async () => {
      await renderPicked(UNCHOSEN, "Use “Jackson Merrill”");
      expect(screen.queryByRole("button", { name: /Apply to the/ })).toBeNull();
    });

    it("says how many cards the server applied and how many it left alone", async () => {
      await renderPicked(UNCHOSEN, "Use “Jackson Merrill”", { leafCards: [rowOf("card-2", UNCHOSEN)] });
      mockPick.mockResolvedValueOnce({ applied: 1, scheduled: 3, refused: 1 });
      await act(async () =>
        fireEvent.click(screen.getByRole("button", { name: "Apply to the 1 card with the same disagreement" })),
      );
      expect(screen.getByText("Applied to 3 cards. 1 left as it was.")).toBeTruthy();
    });

    it("says no cards changed when the server accepted none", async () => {
      await renderPicked(UNCHOSEN, "Use “Jackson Merrill”", { leafCards: [rowOf("card-2", UNCHOSEN)] });
      mockPick.mockResolvedValueOnce({ applied: 1, scheduled: 0, refused: 1 });
      await act(async () =>
        fireEvent.click(screen.getByRole("button", { name: "Apply to the 1 card with the same disagreement" })),
      );
      expect(screen.getByText("No cards changed.")).toBeTruthy();
    });

    it("a refused pick takes the held pick back, so the tile stays open and pink", async () => {
      mockPick.mockRejectedValueOnce(new Error("no"));
      const memory = new WalkMemory();
      const row = rowOf("card-1", UNCHOSEN);
      render(
        <WalkMemoryProvider value={memory}>
          <SourcesDisagreeTile
            row={row}
            context={undefined}
            attention={{ level: "fix", items: [] }}
            leafId={"leaf-1" as never}
            sportId={undefined}
            leafCards={[row]}
            setName="Set"
          />
        </WalkMemoryProvider>,
      );
      await act(async () => fireEvent.click(screen.getByRole("button", { name: "Use “Jackson Merrill”" })));
      expect(memory.pickFor("card-1", "players")).toBeUndefined();
    });

    it("the walk leaving the card drops the pick: nothing about it is kept", async () => {
      const { memory } = await renderPicked(UNCHOSEN, "Use “Jackson Merrill”");
      expect(memory.pickFor("card-1", "players")).toBeDefined();
      memory.leaveCard("card-1");
      expect(memory.pickFor("card-1", "players")).toBeUndefined();
    });
  });

  describe("the status line", () => {
    it("is on the page before any answer, empty, and says the pick when the answer lands", async () => {
      const memory = new WalkMemory();
      const props = (r: TidyRow): TidyTileProps => ({
        row: r,
        context: undefined,
        attention: { level: "fix", items: [] },
        leafId: "leaf-1" as never,
        sportId: undefined,
        leafCards: [r],
        setName: "Set",
      });
      const tree = (r: TidyRow) => (
        <WalkMemoryProvider value={memory}>
          <SourcesDisagreeTile {...props(r)} />
        </WalkMemoryProvider>
      );
      const { rerender } = render(tree(rowOf("card-1", UNCHOSEN)));
      const status = screen.getByRole("status");
      expect(status.textContent).toBe("");
      await act(async () => fireEvent.click(screen.getByRole("button", { name: "Use “Jackson Merrill”" })));
      rerender(tree(rowOf("card-1")));
      // The entry's status element is the same one: a change to a live region that was already there.
      expect(screen.getByRole("status").textContent).toBe("Using “Jackson Merrill” (Checklist)");
    });

    it("clears while Change is open, so the choices are the only thing on offer", async () => {
      await renderPicked(UNCHOSEN, "Use “Jackson Merrill”");
      expect(screen.getByRole("status").textContent).toContain("Using");
      fireEvent.click(screen.getByRole("button", { name: "Change the player name" }));
      expect(screen.getByRole("status").textContent).toBe("");
    });
  });

  it("Change puts focus on the first choice it brings back", async () => {
    await renderPicked(UNCHOSEN, "Use “Jackson Merrill”");
    const change = screen.getByRole("button", { name: "Change the player name" });
    change.focus();
    await act(async () => fireEvent.click(change));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Use “Jackson Merril”" })),
    );
  });

  it("names the field when a card disagrees on two", () => {
    const row = {
      ...rowOf("card-1"),
      sourceDisagreements: [UNCHOSEN, { ...UNCHOSEN, field: "teams" }],
    } as unknown as TidyRow;
    render(
      <SourcesDisagreeTile
        row={row}
        context={undefined}
        attention={{ level: "fix", items: [] }}
        leafId={"leaf-1" as never}
        sportId={undefined}
        leafCards={[row]}
        setName="Set"
      />,
    );
    expect(screen.getByText("Player name")).toBeTruthy();
    expect(screen.getByText("Team name")).toBeTruthy();
  });
});

describe("SourcesDisagreeTile wrapping and edges (NEO-645 audit)", () => {
  it("the 'Use “…”' buttons wrap their data-length labels, and each source cell has the strong edge", () => {
    renderTile(UNCHOSEN);
    for (const name of ["Use “Jackson Merril”", "Use “Jackson Merrill”"]) {
      const button = screen.getByRole("button", { name });
      for (const token of ["h-auto", "min-h-6", "max-w-full", "py-1", "text-left", "wrap-anywhere"]) {
        expect(button.className).toContain(token);
      }
    }
    const cells = within(screen.getByRole("list", { name: /What each source says/ })).getAllByRole("listitem");
    for (const cell of cells) expect(cell.className).toContain("border-rule-strong");
  });
});


describe("the cameo shortcut (T3)", () => {
  const CPC: RowDisagreement = {
    field: "players",
    values: [
      { value: ["It Takes Two CPC"], sources: ["bsc"] },
      { value: ["Francisco Lindor"], sources: ["checklist"] },
    ],
  };
  const OFFER = { playerId: "player-1", surname: "Lindor", name: "It Takes Two CPC" };
  const ctx = (cameoOffer?: typeof OFFER) => ({ cardId: "card-1", cameoOffer });
  const LABEL = "“It Takes Two CPC”, Lindor as a cameo";

  it("sits beside the Use buttons, named for the other side and the surname", () => {
    renderTile(CPC, { context: ctx(OFFER) });
    expect(screen.getByRole("button", { name: LABEL })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Use “It Takes Two CPC”" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Use “Francisco Lindor”" })).toBeTruthy();
  });

  it("is not there when the server offers nothing, or the context has not loaded", () => {
    const none = renderTile(CPC, { context: ctx(undefined) });
    expect(screen.queryByRole("button", { name: /as a cameo/ })).toBeNull();
    none.unmount();
    renderTile(CPC, { context: undefined });
    expect(screen.queryByRole("button", { name: /as a cameo/ })).toBeNull();
  });

  it("is not there on a teams disagreement", () => {
    renderTile(
      {
        field: "teams",
        values: [
          { value: ["Mets"], sources: ["bsc"] },
          { value: ["Padres"], sources: ["checklist"] },
        ],
      },
      { context: ctx(OFFER) },
    );
    expect(screen.queryByRole("button", { name: /as a cameo/ })).toBeNull();
  });

  it("is not there once the disagreement is settled, until Change", async () => {
    await renderPicked(CPC, "Use “It Takes Two CPC”", { context: ctx(OFFER) });
    expect(screen.queryByRole("button", { name: LABEL })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Change the player name" }));
    expect(screen.getByRole("button", { name: LABEL })).toBeTruthy();
  });

  it("one click settles the card with one mutation and moves the walk on", async () => {
    const onAnswered = vi.fn();
    renderTile(CPC, { context: ctx(OFFER), onAnswered });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: LABEL }));
    });
    expect(mockPickCameo).toHaveBeenCalledTimes(1);
    expect(mockPickCameo).toHaveBeenCalledWith({ cardId: "card-1" });
    expect(mockPick).not.toHaveBeenCalled();
    await waitFor(() => expect(onAnswered).toHaveBeenCalledTimes(1));
  });

  it("keeps \"Using\" and Change up while the card is open, and tells the Player tile the name is not a player (D13)", async () => {
    const { memory } = await renderPicked(CPC, LABEL, { context: ctx(OFFER) });
    expect(screen.getByRole("status").textContent).toBe("Using “It Takes Two CPC” (BSC)");
    expect(screen.getByRole("button", { name: "Change the player name" })).toBeTruthy();
    expect(memory.answersOn("card-1", "player")).toEqual([
      { kind: "notEntity", printed: "It Takes Two CPC" },
    ]);
  });

  it("forgets that memory when the write is refused", async () => {
    mockPickCameo.mockRejectedValueOnce(new ConvexError("That card has no cameo to offer. Refresh and try again."));
    const memory = new WalkMemory();
    const row = rowOf("card-1", CPC);
    render(
      <WalkMemoryProvider value={memory}>
        <SourcesDisagreeTile
          {...({
            row,
            context: ctx(OFFER),
            attention: { level: "fix", items: [] },
            leafId: "leaf-1",
            sportId: undefined,
            leafCards: [row],
            setName: "Set",
          } as unknown as TidyTileProps)}
        />
      </WalkMemoryProvider>,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: LABEL }));
    });
    await screen.findByRole("alert");
    expect(memory.pickFor("card-1", "players")).toBeUndefined();
    expect(memory.answersOn("card-1", "player")).toEqual([]);
  });

  it("says what went wrong and does not move on when the write is refused", async () => {
    mockPickCameo.mockRejectedValueOnce(new ConvexError("That card has no cameo to offer. Refresh and try again."));
    const onAnswered = vi.fn();
    renderTile(CPC, { context: ctx(OFFER), onAnswered });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: LABEL }));
    });
    expect((await screen.findByRole("alert")).textContent).toContain("no cameo to offer");
    expect(onAnswered).not.toHaveBeenCalled();
  });
});
