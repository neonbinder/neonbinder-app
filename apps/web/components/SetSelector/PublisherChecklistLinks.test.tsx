/**
 * NEO-597 — the publishers' checklist-page links beside the file pickers.
 * Only the markup is asserted: nothing here follows a link.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import PublisherChecklistLinks from "./PublisherChecklistLinks";

describe("PublisherChecklistLinks", () => {
  it("always shows both publishers' pages, Topps first, each in a new tab", () => {
    render(<PublisherChecklistLinks />);
    const links = screen.getAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual([
      "https://www.topps.com/pages/checklists",
      "https://www.paniniamerica.net/checklist.html",
    ]);
    for (const link of links) {
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    }
  });

  it("names each link by its label plus that it opens in a new tab, with no glyph", () => {
    render(<PublisherChecklistLinks />);
    expect(screen.getByRole("link", { name: "Topps Checklists (opens in new tab)" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Panini Checklists (opens in new tab)" })).toBeTruthy();
    expect(screen.getAllByRole("link").map((l) => l.textContent)).toEqual([
      "Topps Checklists (opens in new tab)",
      "Panini Checklists (opens in new tab)",
    ]);
  });
});
