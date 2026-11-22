/**
 * NEO-645 callout 6 — "Autograph": pink until a format is chosen (no "Not sure
 * yet"), "On-card auto" / "Sticker auto" write this card, and "Apply to all N
 * autographed cards" uses the leaf's own door.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../convex/_generated/api", () => ({
  api: {
    selectorOptions: { setCardFeature: "setCardFeature" },
    autographFormat: { setAutographFormat: "setAutographFormat" },
  },
}));
const mockSetCardFeature = vi.fn();
const mockSetAutographFormat = vi.fn();
vi.mock("convex/react", () => ({
  useMutation: (ref: string) =>
    ref === "setCardFeature" ? mockSetCardFeature : ref === "setAutographFormat" ? mockSetAutographFormat : vi.fn(),
}));

import { AnsweredProvider } from "../answered";
import AutographTile from "./AutographTile";
import type { TidyRow, TidyTileProps } from "../tile-types";

const card = (id: string, extra: Record<string, unknown> = {}) =>
  ({ _id: id, cardNumber: id, cardName: "x", attributes: ["AU"], ...extra }) as unknown as TidyRow;

function renderTile(row: TidyRow, leafCards: TidyRow[] = [row], onAnswered: () => void = () => {}) {
  const props: TidyTileProps = {
    row,
    context: undefined,
    attention: { level: "none", items: [] },
    leafId: "leaf-1" as never,
    sportId: undefined,
    leafCards,
    setName: "Set",
  };
  return render(
    <AnsweredProvider value={onAnswered}>
      <AutographTile {...props} />
    </AnsweredProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSetCardFeature.mockResolvedValue(null);
  mockSetAutographFormat.mockResolvedValue(null);
});

describe("AutographTile", () => {
  it("renders nothing for a card that is not autographed", () => {
    const { container } = renderTile(card("c1", { attributes: ["RC"] }));
    expect(container.textContent).toBe("");
  });

  it("is pink with the two answers while no format is set, and no 'Not sure yet'", () => {
    renderTile(card("c1"));
    expect(screen.getByRole("group", { name: "Autograph" }).getAttribute("data-tidy-level")).toBe("fix");
    expect(screen.getByText("How is this card signed? It can't be listed until you know.")).toBeTruthy();
    expect(screen.getByRole("radio", { name: "On-card auto" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Sticker auto" })).toBeTruthy();
    expect(screen.queryByText(/not sure/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /Apply to all/ })).toBeNull();
  });

  it.each([
    ["On-card auto", "On Card"],
    ["Sticker auto", "Sticker/Label"],
  ])("%s writes %s on this card", async (name, value) => {
    renderTile(card("c1"));
    await act(async () => fireEvent.click(screen.getByRole("radio", { name })));
    expect(mockSetCardFeature).toHaveBeenCalledWith({ cardChecklistId: "c1", key: "autographed", value });
  });

  it("an answered card is plain, shows the choice pressed, and offers all the autographed cards", async () => {
    const row = card("c1", { features: { autographed: "On Card" } });
    renderTile(row, [row, card("c2"), card("c3"), card("c4", { attributes: ["RC"] })]);
    expect(screen.getByRole("group", { name: "Autograph" }).getAttribute("data-tidy-level")).toBe("plain");
    expect(screen.getByRole("radio", { name: "On-card auto" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "Sticker auto" }).getAttribute("aria-checked")).toBe("false");
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Apply to all 3 autographed cards" })),
    );
    expect(mockSetAutographFormat).toHaveBeenCalledWith({ selectorOptionId: "leaf-1", value: "On Card" });
    // The cascade runs in scheduled pages, so the server has no count to give.
    expect(screen.getByText("Applied.")).toBeTruthy();
  });

  it("offers no apply-to-all when this is the only autographed card", () => {
    renderTile(card("c1", { features: { autographed: "Sticker/Label" } }));
    expect(screen.queryByRole("button", { name: /Apply to all/ })).toBeNull();
  });

  it("shows a refused write inline", async () => {
    mockSetCardFeature.mockRejectedValueOnce(new Error("nope"));
    renderTile(card("c1"));
    await act(async () => fireEvent.click(screen.getByRole("radio", { name: "On-card auto" })));
    expect(screen.getByRole("alert").textContent).toBe("Didn't save, try again.");
  });

  describe("the radio group (NEO-331's required pill group)", () => {
    it("is one required radiogroup named Autograph format", () => {
      renderTile(card("c1"));
      const group = screen.getByRole("radiogroup", { name: "Autograph format" });
      expect(group.getAttribute("aria-required")).toBe("true");
      expect(screen.getAllByRole("radio")).toHaveLength(2);
    });

    it("is one Tab stop: the first radio when nothing is chosen, the chosen one after", () => {
      const { unmount } = renderTile(card("c1"));
      expect(screen.getByRole("radio", { name: "On-card auto" }).getAttribute("tabindex")).toBe("0");
      expect(screen.getByRole("radio", { name: "Sticker auto" }).getAttribute("tabindex")).toBe("-1");
      unmount();
      renderTile(card("c1", { features: { autographed: "Sticker/Label" } }));
      expect(screen.getByRole("radio", { name: "On-card auto" }).getAttribute("tabindex")).toBe("-1");
      expect(screen.getByRole("radio", { name: "Sticker auto" }).getAttribute("tabindex")).toBe("0");
    });

    it("an arrow moves focus AND chooses, wrapping, and does not hand focus on", async () => {
      const onAnswered = vi.fn();
      renderTile(card("c1"), undefined, onAnswered);
      const on = screen.getByRole("radio", { name: "On-card auto" });
      const sticker = screen.getByRole("radio", { name: "Sticker auto" });
      on.focus();
      await act(async () => fireEvent.keyDown(on, { key: "ArrowRight" }));
      expect(document.activeElement).toBe(sticker);
      expect(mockSetCardFeature).toHaveBeenLastCalledWith({
        cardChecklistId: "c1",
        key: "autographed",
        value: "Sticker/Label",
      });
      await act(async () => fireEvent.keyDown(sticker, { key: "ArrowRight" }));
      expect(document.activeElement).toBe(on);
      expect(mockSetCardFeature).toHaveBeenLastCalledWith({
        cardChecklistId: "c1",
        key: "autographed",
        value: "On Card",
      });
      await act(async () => fireEvent.keyDown(on, { key: "ArrowLeft" }));
      expect(document.activeElement).toBe(sticker);
      expect(onAnswered).not.toHaveBeenCalled();
    });

    it("a press is the answer: it hands focus on once saved, and Enter on the chosen radio does too, with no second write", async () => {
      const onAnswered = vi.fn();
      const row = card("c1");
      const { rerender } = renderTile(row, undefined, onAnswered);
      await act(async () => fireEvent.click(screen.getByRole("radio", { name: "On-card auto" })));
      expect(onAnswered).toHaveBeenCalledTimes(1);
      // The saved row comes back with the format; pressing the chosen one again only moves on.
      const saved = card("c1", { features: { autographed: "On Card" } });
      const props: TidyTileProps = {
        row: saved,
        context: undefined,
        attention: { level: "none", items: [] },
        leafId: "leaf-1" as never,
        sportId: undefined,
        leafCards: [saved],
        setName: "Set",
      };
      rerender(
        <AnsweredProvider value={onAnswered}>
          <AutographTile {...props} />
        </AnsweredProvider>,
      );
      mockSetCardFeature.mockClear();
      await act(async () => fireEvent.click(screen.getByRole("radio", { name: "On-card auto" })));
      expect(mockSetCardFeature).not.toHaveBeenCalled();
      expect(onAnswered).toHaveBeenCalledTimes(2);
    });

    it("a refused write hands focus on to no one", async () => {
      const onAnswered = vi.fn();
      mockSetCardFeature.mockRejectedValueOnce(new Error("nope"));
      renderTile(card("c1"), undefined, onAnswered);
      await act(async () => fireEvent.click(screen.getByRole("radio", { name: "On-card auto" })));
      expect(onAnswered).not.toHaveBeenCalled();
    });
  });
});
