/**
 * NEO-673 — the Parallels column tags the parallel the others copy from (a set
 * with no Base) with a small "source" marker, in the linkage pill's style.
 * Only that row; every other row, and every column without a source, is
 * untouched.
 */

import { render, screen } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../convex/_generated/api", () => ({
  api: { selectorOptions: { getSelectorOptions: "getSelectorOptions" } },
}));

const state: { items: unknown } = { items: [] };

vi.mock("convex/react", () => ({
  useQuery: () => state.items,
}));

import VariantSelector from "./VariantSelector";

const ROWS = [
  { _id: "silver", value: "Silver" },
  { _id: "gold", value: "Gold" },
];

const column = (sourceId?: string) => (
  <VariantSelector
    variantTypeId={"vt" as never}
    selectedVariantId={null}
    onVariantSelect={vi.fn()}
    expanded={true}
    setExpanded={vi.fn()}
    title="Parallels"
    sourceId={sourceId as never}
  />
);

describe("VariantSelector — the source tag (NEO-673)", () => {
  beforeEach(() => {
    state.items = ROWS;
  });

  it("tags only the source row", () => {
    render(column("silver"));
    const silver = screen.getByRole("option", { name: /^Silver/ });
    const gold = screen.getByRole("option", { name: /^Gold/ });
    expect(silver.textContent).toContain("source");
    expect(gold.textContent).not.toContain("source");
    // The name stays alone in its own node, beside the tag.
    expect(screen.getByText("Silver")).toBeTruthy();
    expect(screen.getAllByText("source")).toHaveLength(1);
  });

  it("tags nothing without a source", () => {
    render(column(undefined));
    expect(screen.queryByText("source")).toBeNull();
  });
});
