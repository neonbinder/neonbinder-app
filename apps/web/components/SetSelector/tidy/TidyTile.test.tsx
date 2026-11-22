/**
 * NEO-645 — the tile shell: level colour AND text, the skeleton, the purple
 * note and the dashed "Apply to all" button.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import TidyTile, { ApplyToAllButton, TidyNote, WRAP_LABEL_CLASS } from "./TidyTile";

describe("TidyTile", () => {
  it("is a labelled group with an h3, and says its level in text", () => {
    render(
      <TidyTile heading="Player" level="fix">
        <p>body</p>
      </TidyTile>,
    );
    const section = screen.getByRole("group", { name: "Player" });
    expect(screen.getByRole("heading", { level: 3, name: "Player" })).toBeTruthy();
    expect(section.getAttribute("data-tidy-level")).toBe("fix");
    expect(section.textContent).toContain("To fix");
    expect(section.className).toContain("border-neon-pink-text");
  });

  it("writes the level beside the heading with a shape that is not a colour, and says it once", () => {
    const { rerender } = render(<TidyTile heading="Player" level="fix" />);
    const fix = screen.getByRole("group", { name: "Player" });
    // The visible word is what describes the tile: one place, no sr-only twin.
    const label = screen.getByText("To fix");
    expect(label.className).not.toContain("sr-only");
    expect(label.className).toContain("text-neon-pink-text");
    expect(label.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(fix.getAttribute("aria-describedby")).toBe(label.id);
    expect(screen.getAllByText("To fix")).toHaveLength(1);
    const fixShape = label.querySelector("svg")?.innerHTML;

    rerender(<TidyTile heading="Player" level="check" />);
    const check = screen.getByText("To check");
    expect(check.className).toContain("text-neon-blue-text");
    expect(screen.getByRole("group", { name: "Player" }).getAttribute("aria-describedby")).toBe(check.id);
    // Fix and check carry different shapes.
    expect(check.querySelector("svg")?.innerHTML).not.toBe(fixShape);
  });

  it("a plain tile has no level label and no description", () => {
    render(<TidyTile heading="Player" level="plain" />);
    expect(screen.getByRole("group", { name: "Player" }).getAttribute("aria-describedby")).toBeNull();
  });

  it("states 'To check' for blue and nothing for a plain tile", () => {
    const { rerender } = render(<TidyTile heading="Career" level="check" />);
    const blue = screen.getByRole("group", { name: "Career" });
    expect(blue.textContent).toContain("To check");
    expect(blue.className).toContain("border-neon-blue-text");
    rerender(<TidyTile heading="Career" level="plain" />);
    const plain = screen.getByRole("group", { name: "Career" });
    expect(plain.textContent).not.toMatch(/To (fix|check)/);
  });

  it("a waiting tile is a dashed skeleton: its line, no children, aria-busy", () => {
    render(
      <TidyTile heading="Team" level="waiting" waitingText="Waiting on the spelling above" aside="aside">
        <button type="button">Never shown</button>
      </TidyTile>,
    );
    const section = screen.getByRole("group", { name: "Team" });
    expect(section.getAttribute("aria-busy")).toBe("true");
    expect(section.className).toContain("border-dashed");
    expect(screen.getByText("Waiting on the spelling above")).toBeTruthy();
    // "Waiting" has nothing to see beyond the dashed edge and the line, so it is spoken only.
    expect(screen.getByText("Waiting").className).toContain("sr-only");
    expect(screen.queryByRole("button", { name: "Never shown" })).toBeNull();
    expect(screen.queryByText("aside")).toBeNull();
  });

  it("plain and waiting tiles take the strong rule; pink and blue glow in dark only (through --glow)", () => {
    const { rerender } = render(<TidyTile heading="Player" level="plain" />);
    expect(screen.getByRole("group", { name: "Player" }).className).toContain("border-rule-strong");
    rerender(<TidyTile heading="Player" level="waiting" />);
    expect(screen.getByRole("group", { name: "Player" }).className).toContain("border-rule-strong");
    // No glow on the quiet ones.
    expect(screen.getByRole("group", { name: "Player" }).className).not.toContain("shadow-");

    // The halo's strength is the theme's `--glow` (1 in dark, 0 on paper), so
    // light mode paints nothing; the tile's colour edge is unchanged.
    for (const [level, rgb] of [
      ["fix", "255_46_154"],
      ["check", "0_194_255"],
    ] as const) {
      rerender(<TidyTile heading="Player" level={level} />);
      const cls = screen.getByRole("group", { name: "Player" }).className;
      expect(cls).toContain(`shadow-[0_0_14px_rgb(${rgb}/calc(0.4*var(--glow)))]`);
    }
  });

  it("exports one wrap class for size-1 buttons with long or interpolated labels", () => {
    expect(WRAP_LABEL_CLASS).toBe("h-auto min-h-6 max-w-full py-1 text-left wrap-anywhere");
  });

  it("shows the aside beside the heading", () => {
    render(<TidyTile heading="Player" level="plain" aside="Also on #USC118" />);
    expect(screen.getByText("Also on #USC118")).toBeTruthy();
  });
});

describe("TidyNote", () => {
  it("is a note, not a control", () => {
    render(<TidyNote>Team filled from the player's career</TidyNote>);
    const note = screen.getByRole("note");
    expect(note.textContent).toBe("Team filled from the player's career");
    expect(note.className).toContain("text-neon-purple-text");
  });
});

describe("ApplyToAllButton", () => {
  it("renders nothing for fewer than one card", () => {
    const { container } = render(<ApplyToAllButton count={0} label="Apply to all 0 cards" onApply={vi.fn()} />);
    expect(container.textContent).toBe("");
  });

  it("applies, holds while busy, then says it is done", async () => {
    let finish: () => void = () => {};
    const onApply = vi.fn(() => new Promise<void>((r) => (finish = r)));
    render(<ApplyToAllButton count={4} label="Apply to all 4 autographed cards" onApply={onApply} />);
    const button = screen.getByRole("button", { name: "Apply to all 4 autographed cards" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByRole("status").textContent).toBe("Applying…");
    await act(async () => finish());
    expect(screen.getByRole("status").textContent).toBe("Applied.");
    expect(button.getAttribute("aria-disabled")).toBeNull();
  });

  it("shows a refusal inline and lets the operator retry", async () => {
    const onApply = vi.fn().mockRejectedValueOnce(new Error("no")).mockResolvedValueOnce(undefined);
    render(<ApplyToAllButton count={2} label="Apply to all 2 cards" onApply={onApply} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Apply to all 2 cards" })));
    expect(screen.getByRole("alert").textContent).toBe("Didn't apply, try again.");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Apply to all 2 cards" })));
    expect(screen.getByRole("alert").textContent).toBe("");
    expect(onApply).toHaveBeenCalledTimes(2);
  });

  it.each([
    [{ applied: 0, skipped: 0 }, "No cards changed."],
    [{ applied: 0, skipped: 3 }, "No cards changed."],
    [{ applied: 1, skipped: 0 }, "Applied to 1 card."],
    [{ applied: 5 }, "Applied to 5 cards."],
    [{ applied: 5, skipped: 0 }, "Applied to 5 cards."],
    [{ applied: 4, skipped: 1 }, "Applied to 4 cards. 1 left as it was."],
    [{ applied: 1, skipped: 2 }, "Applied to 1 card. 2 left as they were."],
    [undefined, "Applied."],
  ])("reads the server's counts %j as %j", async (result, text) => {
    const onApply = vi.fn().mockResolvedValue(result);
    render(<ApplyToAllButton count={6} label="Apply to all 6 cards" onApply={onApply} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Apply to all 6 cards" })));
    expect(screen.getByRole("status").textContent).toBe(text);
  });

  it("keeps the result on screen when the apply itself empties the offer, and the button with it", async () => {
    const onApply = vi.fn().mockResolvedValue({ applied: 3, skipped: 0 });
    const { rerender } = render(<ApplyToAllButton count={3} label="Apply to all 3 cards" onApply={onApply} />);
    const button = screen.getByRole("button");
    button.focus();
    await act(async () => fireEvent.click(button));
    // The three cards now fit, so they are no longer offered.
    rerender(<ApplyToAllButton count={0} label="Apply to all 0 cards" onApply={onApply} />);
    expect(screen.getByRole("status").textContent).toBe("Applied to 3 cards.");
    // The pressed button is still the same element, still focused, held aria-disabled,
    // and still reads as what it was (not "Apply to all 0 cards").
    const kept = screen.getByRole("button", { name: "Apply to all 3 cards" });
    expect(kept).toBe(button);
    expect(document.activeElement).toBe(button);
    expect(kept.getAttribute("aria-disabled")).toBe("true");
    // A press while the offer is empty does nothing.
    onApply.mockClear();
    fireEvent.click(kept);
    expect(onApply).not.toHaveBeenCalled();
  });

  it("holds a pressed button aria-disabled when the offer empties", async () => {
    const onApply = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(<ApplyToAllButton count={2} label="Apply to all 2 cards" onApply={onApply} />);
    await act(async () => fireEvent.click(screen.getByRole("button")));
    rerender(<ApplyToAllButton count={0} label="Apply to all 0 cards" onApply={onApply} />);
    expect(screen.getByRole("button").getAttribute("aria-disabled")).toBe("true");
  });

  it("forgets an old result when the offer changes", async () => {
    const onApply = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(<ApplyToAllButton count={2} label="Apply to all 2 cards" onApply={onApply} />);
    await act(async () => fireEvent.click(screen.getByRole("button")));
    expect(screen.getByRole("status").textContent).toBe("Applied.");
    rerender(<ApplyToAllButton count={3} label="Apply to all 3 cards" onApply={onApply} />);
    expect(screen.getByRole("status").textContent).toBe("");
  });
});
