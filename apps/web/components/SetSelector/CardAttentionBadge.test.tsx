/**
 * NEO-645 — the grid row's attention mark: the tile's own icon, one per level,
 * in the same 20px disc, with the words in its name and its tooltip.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import CardAttentionBadge from "./CardAttentionBadge";
import type { TidyAttention } from "./tidy/tile-types";

const fix = {
  level: "fix",
  items: [{ level: "fix", kind: "noTeam" }],
} as unknown as TidyAttention;
const check = {
  level: "check",
  items: [{ level: "check", kind: "titleCut", key: "cut:1" }],
} as unknown as TidyAttention;

describe("CardAttentionBadge", () => {
  it("keeps its accessible name for a card to fix", () => {
    render(<CardAttentionBadge attention={fix} cardIdentity="12, Mike Trout" />);
    expect(
      screen.getByRole("img", { name: "Card 12, Mike Trout needs attention: no team on this card yet" }),
    ).toBeTruthy();
  });

  it("keeps its accessible name for a card to check", () => {
    render(<CardAttentionBadge attention={check} cardIdentity="12, Mike Trout" />);
    expect(
      screen.getByRole("img", { name: "Card 12, Mike Trout is worth a check: listing title was cut short" }),
    ).toBeTruthy();
  });

  it("draws an icon, not a bang, and a different one for each level", () => {
    const { rerender } = render(<CardAttentionBadge attention={fix} cardIdentity="12" />);
    const badge = screen.getByRole("img");
    const fixIcon = badge.querySelector("svg");
    expect(fixIcon?.getAttribute("aria-hidden")).toBe("true");
    expect(fixIcon?.getAttribute("class")).toContain("h-3");
    expect(fixIcon?.getAttribute("class")).toContain("w-3");
    expect(badge.textContent).toBe("");
    const fixShape = fixIcon?.innerHTML;

    rerender(<CardAttentionBadge attention={check} cardIdentity="12" />);
    const checkIcon = screen.getByRole("img").querySelector("svg");
    expect(checkIcon?.innerHTML).not.toBe(fixShape);
    expect(screen.getByRole("img").textContent).toBe("");
  });

  it("keeps the 20px disc and the level's colour", () => {
    const { rerender } = render(<CardAttentionBadge attention={fix} cardIdentity="12" />);
    expect(screen.getByRole("img").className).toContain("h-5 w-5");
    expect(screen.getByRole("img").className).toContain("border-neon-pink-text");
    rerender(<CardAttentionBadge attention={check} cardIdentity="12" />);
    expect(screen.getByRole("img").className).toContain("border-neon-blue-text");
  });

  it("has no dash in its tooltip", () => {
    const { rerender } = render(<CardAttentionBadge attention={fix} cardIdentity="12" />);
    expect(screen.getByRole("img").getAttribute("title")).toBe("Needs attention: no team on this card yet");
    rerender(<CardAttentionBadge attention={check} cardIdentity="12" />);
    expect(screen.getByRole("img").getAttribute("title")).toBe("Worth a check: listing title was cut short");
  });
});
