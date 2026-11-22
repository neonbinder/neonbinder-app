/**
 * NEO-645 callout 2 — "Sources disagree": one column per source, a pick per
 * distinct value, "Type another…", the blue NB-picked state, Change, and the
 * apply-to-the-same offer (which only proposes; the server checks each card).
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConvexError } from "convex/values";

vi.mock("../../../../convex/_generated/api", () => ({
  api: { tidyCards: { pickSourceValue: "tidyCards.pickSourceValue" } },
}));
const mockPick = vi.fn();
vi.mock("convex/react", () => ({
  useMutation: (ref: string) => (ref === "tidyCards.pickSourceValue" ? mockPick : vi.fn()),
}));

import { AnsweredProvider } from "../answered";
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
    onAnswered = () => {},
  }: { attention?: TidyAttention; leafCards?: TidyRow[]; onAnswered?: () => void } = {},
) {
  const row = rowOf("card-1", d);
  const props: TidyTileProps = {
    row,
    context: undefined,
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

beforeEach(() => {
  vi.clearAllMocks();
  mockPick.mockResolvedValue({ applied: 1, scheduled: 0, refused: 0 });
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

    it("an answer of no team reads 'Using no team', and the NB-picked flip says 'Use no team instead'", () => {
      renderTile({ ...NO_TEAM, chosen: { value: [], by: "operator" } } as RowDisagreement);
      expect(screen.getByRole("status").textContent).toBe("Using no team (SportLots)");
      renderTile({ ...NO_TEAM, chosen: { value: ["San Diego Padres"], by: "nb" } } as RowDisagreement);
      expect(screen.getByRole("button", { name: "Use no team instead" })).toBeTruthy();
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

  describe("NB already has one value (blue)", () => {
    const NB: RowDisagreement = { ...UNCHOSEN, chosen: { value: MERRILL, by: "nb" } };
    const attention: TidyAttention = {
      level: "check",
      items: [{ level: "check", kind: "nbPicked", field: "players", key: "picked:players:x" }],
    };

    it("says it went with the one already in the binder, and offers the other", async () => {
      renderTile(NB, { attention });
      expect(screen.getByRole("group", { name: "Sources disagree" }).getAttribute("data-tidy-level")).toBe("check");
      expect(screen.getByText("Went with “Jackson Merrill”, they're already in your binder.")).toBeTruthy();
      expect(screen.getByText("In NeonBinder")).toBeTruthy();
      await act(async () => fireEvent.click(screen.getByRole("button", { name: "Use “Jackson Merril” instead" })));
      expect(mockPick).toHaveBeenCalledWith({ cardId: "card-1", field: "players", value: MERRIL });
    });

    it("drops back to plain once the walk has seen it", () => {
      renderTile(NB, { attention: { level: "none", items: [] } });
      expect(screen.getByRole("group", { name: "Sources disagree" }).getAttribute("data-tidy-level")).toBe("plain");
    });
  });

  describe("answered by the operator", () => {
    const CHOSEN: RowDisagreement = { ...UNCHOSEN, chosen: { value: MERRILL, by: "operator" } };

    it("says what is used and where it came from, with Change", () => {
      renderTile(CHOSEN);
      expect(screen.getByText("Using “Jackson Merrill” (Checklist)")).toBeTruthy();
      expect(screen.getByRole("group", { name: "Sources disagree" }).getAttribute("data-tidy-level")).toBe("plain");
      fireEvent.click(screen.getByRole("button", { name: "Change the player name" }));
      expect(screen.getByRole("button", { name: "Use “Jackson Merril”" })).toBeTruthy();
    });

    it("offers the cards with the same disagreement, and only those", async () => {
      const same = rowOf("card-2", UNCHOSEN);
      const reordered = rowOf("card-3", { ...UNCHOSEN, values: [...UNCHOSEN.values].reverse() });
      const answered = rowOf("card-4", CHOSEN);
      const other = rowOf("card-5", { field: "players", values: [{ value: ["A"], sources: ["bsc"] }, { value: ["B"], sources: ["checklist"] }] });
      const teams = rowOf("card-6", { ...UNCHOSEN, field: "teams" });
      renderTile(CHOSEN, { leafCards: [rowOf("card-1", CHOSEN), same, reordered, answered, other, teams] });
      const apply = screen.getByRole("button", { name: "Apply to the 2 cards with the same disagreement" });
      await act(async () => fireEvent.click(apply));
      expect(mockPick).toHaveBeenCalledWith({
        cardId: "card-1",
        field: "players",
        value: MERRILL,
        cardIds: ["card-2", "card-3"],
      });
    });

    it("offers nothing when no other card shares it", () => {
      renderTile(CHOSEN);
      expect(screen.queryByRole("button", { name: /Apply to the/ })).toBeNull();
    });

    it("says how many cards the server applied and how many it left alone", async () => {
      mockPick.mockResolvedValueOnce({ applied: 1, scheduled: 3, refused: 1 });
      renderTile(CHOSEN, { leafCards: [rowOf("card-1", CHOSEN), rowOf("card-2", UNCHOSEN)] });
      await act(async () =>
        fireEvent.click(screen.getByRole("button", { name: "Apply to the 1 card with the same disagreement" })),
      );
      expect(screen.getByText("Applied to 3 cards. 1 left as it was.")).toBeTruthy();
    });

    it("says no cards changed when the server accepted none", async () => {
      mockPick.mockResolvedValueOnce({ applied: 1, scheduled: 0, refused: 1 });
      renderTile(CHOSEN, { leafCards: [rowOf("card-1", CHOSEN), rowOf("card-2", UNCHOSEN)] });
      await act(async () =>
        fireEvent.click(screen.getByRole("button", { name: "Apply to the 1 card with the same disagreement" })),
      );
      expect(screen.getByText("No cards changed.")).toBeTruthy();
    });
  });

  describe("the status line", () => {
    const CHOSEN: RowDisagreement = { ...UNCHOSEN, chosen: { value: MERRILL, by: "operator" } };

    it("is on the page before any answer, empty, and says the pick when the answer lands", () => {
      const row = rowOf("card-1", UNCHOSEN);
      const props = (r: TidyRow): TidyTileProps => ({
        row: r,
        context: undefined,
        attention: { level: "fix", items: [] },
        leafId: "leaf-1" as never,
        sportId: undefined,
        leafCards: [r],
        setName: "Set",
      });
      const { rerender } = render(<SourcesDisagreeTile {...props(row)} />);
      const status = screen.getByRole("status");
      expect(status.textContent).toBe("");
      rerender(<SourcesDisagreeTile {...props(rowOf("card-1", CHOSEN))} />);
      // The same element: a change to a live region that was already there.
      expect(screen.getByRole("status")).toBe(status);
      expect(status.textContent).toBe("Using “Jackson Merrill” (Checklist)");
    });

    it("clears while Change is open, so the choices are the only thing on offer", () => {
      renderTile(CHOSEN);
      expect(screen.getByRole("status").textContent).toContain("Using");
      fireEvent.click(screen.getByRole("button", { name: "Change the player name" }));
      expect(screen.getByRole("status").textContent).toBe("");
    });
  });

  it("Change puts focus on the first choice it brings back", async () => {
    const CHOSEN: RowDisagreement = { ...UNCHOSEN, chosen: { value: MERRILL, by: "operator" } };
    renderTile(CHOSEN);
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

