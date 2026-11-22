/**
 * NEO-645 — the tile shell: level colour AND text, the skeleton, the purple
 * note and the dashed "Apply to all" button.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import TidyTile, { ApplyToAllButton, TidyNote } from "./TidyTile";

describe("TidyTile", () => {
  it("is a labelled section with an h3, and says its level in text", () => {
    render(
      <TidyTile heading="Player" level="fix">
        <p>body</p>
      </TidyTile>,
    );
    const section = screen.getByRole("region", { name: "Player" });
    expect(screen.getByRole("heading", { level: 3, name: "Player" })).toBeTruthy();
    expect(section.getAttribute("data-tidy-level")).toBe("fix");
    expect(section.textContent).toContain("To fix");
    expect(section.className).toContain("border-neon-pink-text");
  });

  it("states 'To check' for blue and nothing for a plain tile", () => {
    const { rerender } = render(<TidyTile heading="Career" level="check" />);
    const blue = screen.getByRole("region", { name: "Career" });
    expect(blue.textContent).toContain("To check");
    expect(blue.className).toContain("border-neon-blue-text");
    rerender(<TidyTile heading="Career" level="plain" />);
    const plain = screen.getByRole("region", { name: "Career" });
    expect(plain.textContent).not.toMatch(/To (fix|check)/);
  });

  it("a waiting tile is a dashed skeleton: its line, no children, aria-busy", () => {
    render(
      <TidyTile heading="Team" level="waiting" waitingText="Waiting on the spelling above" aside="aside">
        <button type="button">Never shown</button>
      </TidyTile>,
    );
    const section = screen.getByRole("region", { name: "Team" });
    expect(section.getAttribute("aria-busy")).toBe("true");
    expect(section.className).toContain("border-dashed");
    expect(screen.getByText("Waiting on the spelling above")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Never shown" })).toBeNull();
    expect(screen.queryByText("aside")).toBeNull();
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

  it("forgets an old result when the offer changes", async () => {
    const onApply = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(<ApplyToAllButton count={2} label="Apply to all 2 cards" onApply={onApply} />);
    await act(async () => fireEvent.click(screen.getByRole("button")));
    expect(screen.getByRole("status").textContent).toBe("Applied.");
    rerender(<ApplyToAllButton count={3} label="Apply to all 3 cards" onApply={onApply} />);
    expect(screen.getByRole("status").textContent).toBe("");
  });
});
