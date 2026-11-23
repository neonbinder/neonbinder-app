/**
 * NEO-645 (Jason, 2026-11-23) — "Card name": pink while a card has no player
 * and no name of its own. Typing one writes `cardName` and rebuilds the
 * listing title and description (T4); the tile is gone with the item.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../convex/_generated/api", () => ({
  api: { selectorOptions: { updateCard: "updateCard" } },
}));
const mockUpdateCard = vi.fn();
vi.mock("convex/react", () => ({
  useMutation: (ref: string) => (ref === "updateCard" ? mockUpdateCard : vi.fn()),
}));

import { AnsweredProvider } from "../answered";
import CardNameTile from "./CardNameTile";
import type { TidyAttention, TidyRow, TidyTileProps } from "../tile-types";

const needsName = { level: "fix", items: [{ level: "fix", kind: "needsName" }] } as unknown as TidyAttention;
const none: TidyAttention = { level: "none", items: [] };
const card = { _id: "c1", cardNumber: "3", cardName: "Card #3" } as unknown as TidyRow;

function renderTile(attention: TidyAttention = needsName, onAnswered: () => void = () => {}) {
  const props: TidyTileProps = {
    row: card,
    context: undefined,
    attention,
    leafId: "leaf-1" as never,
    sportId: undefined,
    leafCards: [card],
    setName: "Set",
  };
  return render(
    <AnsweredProvider value={onAnswered}>
      <CardNameTile {...props} />
    </AnsweredProvider>,
  );
}

const field = () => screen.getByRole("textbox", { name: "Card name" }) as HTMLInputElement;

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdateCard.mockResolvedValue(null);
});

describe("CardNameTile", () => {
  it("renders nothing for a card that has a name or a player", () => {
    const { container } = renderTile(none);
    expect(container.textContent).toBe("");
  });

  it("is a pink tile with a field and a Save name button while the card needs a name", () => {
    renderTile();
    expect(screen.getByRole("group", { name: "Card name" }).getAttribute("data-tidy-level")).toBe("fix");
    expect(field().value).toBe("");
    expect(screen.getByRole("button", { name: "Save name" })).toBeTruthy();
  });

  it("Save name writes the typed name and rebuilds the listing text, then hands focus on", async () => {
    const answered = vi.fn();
    renderTile(needsName, answered);
    fireEvent.change(field(), { target: { value: "  Team   Card " } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save name" })));
    expect(mockUpdateCard).toHaveBeenCalledWith({ id: "c1", cardName: "Team Card", regenerateListing: true });
    expect(answered).toHaveBeenCalledTimes(1);
  });

  it("Enter in the field saves in place", async () => {
    renderTile();
    fireEvent.change(field(), { target: { value: "Checklist" } });
    await act(async () => fireEvent.keyDown(field(), { key: "Enter" }));
    expect(mockUpdateCard).toHaveBeenCalledWith({ id: "c1", cardName: "Checklist", regenerateListing: true });
  });

  it.each(["", "   ", "Card #3", "card # 12"])("refuses %j without writing", async (typed) => {
    const answered = vi.fn();
    renderTile(needsName, answered);
    fireEvent.change(field(), { target: { value: typed } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save name" })));
    expect(mockUpdateCard).not.toHaveBeenCalled();
    expect(answered).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe("Type what this card is, like Checklist or Team Card.");
    expect(field().getAttribute("aria-invalid")).toBe("true");
  });

  it("says so inline when the write is refused, and keeps what was typed", async () => {
    mockUpdateCard.mockRejectedValueOnce(new Error("Server Error"));
    const answered = vi.fn();
    renderTile(needsName, answered);
    fireEvent.change(field(), { target: { value: "Checklist" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save name" })));
    expect(screen.getByRole("alert").textContent).toBe("Couldn't save that name. Try again.");
    expect(field().value).toBe("Checklist");
    expect(answered).not.toHaveBeenCalled();
  });

  it("typing again clears the refusal", async () => {
    renderTile();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save name" })));
    expect(screen.getByRole("alert").textContent).not.toBe("");
    fireEvent.change(field(), { target: { value: "C" } });
    expect(screen.getByRole("alert").textContent).toBe("");
  });

  it("a refused save from the button puts focus back in the field, and the field points at the alert", async () => {
    renderTile();
    expect(field().getAttribute("aria-required")).toBe("true");
    expect(field().getAttribute("aria-describedby")).toBeNull();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save name" })));
    expect(document.activeElement).toBe(field());
    const alert = screen.getByRole("alert");
    expect(field().getAttribute("aria-describedby")).toBe(alert.id);
    expect(alert.id).not.toBe("");
  });

  it("Enter lets go of the field once the name is saved, as the button path does", async () => {
    renderTile();
    fireEvent.change(field(), { target: { value: "Checklist" } });
    act(() => field().focus());
    expect(document.activeElement).toBe(field());
    await act(async () => fireEvent.keyDown(field(), { key: "Enter" }));
    expect(document.activeElement).not.toBe(field());
  });

  it("an Enter that confirms an IME composition is not a save", async () => {
    renderTile();
    fireEvent.change(field(), { target: { value: "チェックリスト" } });
    await act(async () => fireEvent.keyDown(field(), { key: "Enter", isComposing: true }));
    expect(mockUpdateCard).not.toHaveBeenCalled();
  });

  it("holds a name to a player name's length", () => {
    renderTile();
    expect(field().maxLength).toBe(120);
  });
});
