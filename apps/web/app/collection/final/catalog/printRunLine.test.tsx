/**
 * NEO-616 — a parallel's print run ("/5") rides the drill's one extra line.
 * It is the option's DESCRIPTION, never part of its name: the name a screen
 * reader gives (and a spec finds the option by) is the parallel's own, and the
 * run is read after it through aria-describedby.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import StaticColumn from "../../prototypes/p1/StaticColumn";
import { SELECTED } from "../../prototypes/p1/ui";

afterEach(cleanup);

function renderColumn(items: Array<{ id: string; name: string; description?: string }>) {
  return render(
    <StaticColumn
      title="Parallel"
      items={items}
      selectedId={null}
      onSelect={() => {}}
      expanded
      setExpanded={() => {}}
      selectedColor={SELECTED.variant}
      keepOrder
    />,
  );
}

describe("a drill row's print run", () => {
  it("is the option's description, not its name", () => {
    renderColumn([
      { id: "a", name: "Gold Refractor", description: "/5" },
      { id: "b", name: "Silver Prizm" },
    ]);
    // The name is the parallel's alone.
    const gold = screen.getByRole("option", { name: "Gold Refractor" });
    expect(screen.queryByRole("option", { name: /\/5/ })).toBeNull();
    // The run is still on screen, and read as the option's description.
    expect(screen.getByText("/5")).toBeTruthy();
    expect(screen.getByRole("option", { name: "Gold Refractor", description: "/5" })).toBe(gold);
  });

  it("a row with no run has no description and no empty node", () => {
    renderColumn([{ id: "b", name: "Silver Prizm" }]);
    const silver = screen.getByRole("option", { name: "Silver Prizm" });
    expect(silver.getAttribute("aria-describedby")).toBeNull();
    expect(silver.querySelectorAll("span")).toHaveLength(1);
  });

  it("wraps a long run beside a long name instead of clipping", () => {
    renderColumn([{ id: "a", name: "Gold Refractor", description: "1/1" }]);
    const line = screen.getByText("1/1");
    expect(line.className).toContain("wrap-anywhere");
    expect(line.className).not.toMatch(/truncate|overflow-hidden|whitespace-nowrap/);
  });
});
