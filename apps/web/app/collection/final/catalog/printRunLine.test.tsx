/**
 * NEO-616 — a parallel's print run rides the drill's one extra line.
 *
 * Seen: "/5" under the name, hidden from a screen reader. Heard: the option's
 * own name carries a spoken form after the parallel ("Gold Refractor, numbered
 * to 5", "one of one" for 1), so it is read wherever the option is reached,
 * including by a list driven with aria-activedescendant. A line with no spoken
 * form (the demo's "Have 2 of 30 base") is read as it is, in the name, as before.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import StaticColumn from "../../prototypes/p1/StaticColumn";
import type { ColumnItem } from "../../prototypes/p1/drill";
import { printRunLabel, printRunSpoken } from "../data/labels";
import type { DrillItem } from "../data/types";
import { DrillOptions } from "./DrillOptions";
import { SELECTED } from "../../prototypes/p1/ui";

afterEach(cleanup);

/**
 * The name with its spoken form after a comma. A browser puts a space around the
 * visually hidden span, so the computed name may read "Gold Refractor , numbered
 * to 5": match both, whole, never as a substring.
 */
const SPOKEN = (name: string, spoken: string) => new RegExp(`^${name} ?, ${spoken}$`);

function renderColumn(items: ColumnItem[]) {
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

describe("the print run's words", () => {
  it("written and spoken", () => {
    expect(printRunLabel({ printRun: 50 })).toBe("/50");
    expect(printRunSpoken({ printRun: 50 })).toBe("numbered to 50");
    expect(printRunLabel({ printRun: 1 })).toBe("1/1");
    expect(printRunSpoken({ printRun: 1 })).toBe("one of one");
    expect(printRunSpoken({ printRun: null })).toBeNull();
  });
});

describe("a drill row's print run", () => {
  it("is spoken inside the option's name and shown as /N, hidden from a screen reader", () => {
    renderColumn([
      { id: "a", name: "Gold Refractor", description: "/5", descriptionSpoken: "numbered to 5" },
      { id: "b", name: "Silver Prizm" },
    ]);
    const gold = screen.getByRole("option", { name: SPOKEN("Gold Refractor", "numbered to 5") });
    expect(gold.getAttribute("aria-describedby")).toBeNull();
    const visible = screen.getByText("/5");
    expect(visible.getAttribute("aria-hidden")).toBe("true");
    // "/5" is not what the name says.
    expect(screen.queryByRole("option", { name: /\/5/ })).toBeNull();
  });

  it("the name's own text stays exactly the name, so a locator that finds a row by it still does", () => {
    renderColumn([{ id: "a", name: "Gold Refractor", description: "/5", descriptionSpoken: "numbered to 5" }]);
    expect(screen.getByText("Gold Refractor").closest("button")?.getAttribute("role")).toBe("option");
  });

  it("a one-of-one is said one of one", () => {
    renderColumn([{ id: "a", name: "Gold Refractor", description: "1/1", descriptionSpoken: "one of one" }]);
    expect(screen.getByRole("option", { name: SPOKEN("Gold Refractor", "one of one") })).toBeTruthy();
  });

  it("a line with no spoken form is read as it is, in the name, as before", () => {
    renderColumn([{ id: "a", name: "Baseball", description: "Have 2 of 30 base" }]);
    const row = screen.getByRole("option", { name: "Baseball Have 2 of 30 base" });
    expect(row.querySelector('[aria-hidden="true"]')).toBeNull();
  });

  it("a row with no run keeps its bare name and has no extra node", () => {
    renderColumn([{ id: "b", name: "Silver Prizm" }]);
    const silver = screen.getByRole("option", { name: "Silver Prizm" });
    expect(silver.querySelectorAll("span")).toHaveLength(1);
    expect(silver.querySelector(".sr-only")).toBeNull();
  });

  it("wraps a long run beside a long name instead of clipping", () => {
    renderColumn([{ id: "a", name: "Gold Refractor", description: "1/1", descriptionSpoken: "one of one" }]);
    const line = screen.getByText("1/1");
    expect(line.className).toContain("wrap-anywhere");
    expect(line.className).not.toMatch(/truncate|overflow-hidden|whitespace-nowrap/);
  });
});

describe("a print run in a native set select", () => {
  const row = (id: string, name: string, printRun?: number): DrillItem => ({
    id,
    level: "variant",
    name,
    hasChildren: false,
    ...(printRun ? { printRun, description: printRunLabel({ printRun })!, descriptionSpoken: printRunSpoken({ printRun })! } : {}),
  });
  const renderSelect = (items: DrillItem[]) =>
    render(
      <select aria-label="Parallel">
        <DrillOptions items={items} />
      </select>,
    );

  it("reads after the name in the option's text", () => {
    renderSelect([row("a", "1989 Pro Set Base Prismatic Red", 5), row("b", "Gold Refractor", 1)]);
    expect(screen.getByRole("option", { name: "1989 Pro Set Base Prismatic Red /5" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Gold Refractor 1/1" })).toBeTruthy();
  });

  it("a row with no run reads exactly as before, and keeps its value", () => {
    renderSelect([row("a", "Silver Prizm"), row("b", "Gold Refractor", 5)]);
    const silver = screen.getByRole("option", { name: "Silver Prizm" }) as HTMLOptionElement;
    expect(silver.textContent).toBe("Silver Prizm");
    expect(silver.value).toBe("a");
    expect((screen.getByRole("option", { name: "Gold Refractor /5" }) as HTMLOptionElement).value).toBe("b");
  });

  it("takes only the print run, never a bare description", () => {
    renderSelect([{ ...row("a", "Silver Prizm"), description: "Have 2 of 30 base" }]);
    expect(screen.getByRole("option", { name: "Silver Prizm" })).toBeTruthy();
  });
});
