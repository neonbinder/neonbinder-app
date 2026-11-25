/**
 * NEO-665 — the shared "Left out to fit" line: one purple pill per item, as a
 * list named by its visible label; nothing at all for an empty list.
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import LeftOutPills from "./LeftOutPills";

afterEach(cleanup);

describe("LeftOutPills", () => {
  test("one purple list item per thing left out, in a list named 'Left out to fit'", () => {
    render(<LeftOutPills items={["Cincinnati Reds", "#DD-11", "/99"]} />);
    const list = screen.getByRole("list", { name: "Left out to fit" });
    const pills = within(list).getAllByRole("listitem");
    expect(pills.map((li) => li.firstChild?.textContent)).toEqual(["Cincinnati Reds", "#DD-11", "/99"]);
    for (const pill of pills) {
      expect(pill.className).toContain("text-neon-purple-text");
      // Wraps inside itself; never an ellipsis or a clip.
      expect(pill.className).toContain("wrap-anywhere");
      expect(pill.className).not.toContain("truncate");
    }
    expect(screen.getByText("Left out to fit")).toBeTruthy();
  });

  test("the id lands on the wrapper, so a description reads the label, pills and trailing text", () => {
    render(<LeftOutPills id="line" items={["RELIC"]} trailing={<span>(2 cards)</span>} />);
    const line = document.getElementById("line");
    expect(line?.textContent).toBe("Left out to fitRELIC(2 cards)");
    expect(line?.contains(screen.getByRole("list", { name: "Left out to fit" }))).toBe(true);
  });

  test("every item but the last ends in a screen-reader-only comma, so a flattened read does not run them together", () => {
    render(<LeftOutPills id="line" items={["Cincinnati Reds", "#DD-11", "/99"]} />);
    const pills = within(screen.getByRole("list", { name: "Left out to fit" })).getAllByRole("listitem");
    expect(pills.map((li) => li.querySelector(".sr-only")?.textContent ?? null)).toEqual([", ", ", ", null]);
    expect(document.getElementById("line")?.textContent).toBe("Left out to fitCincinnati Reds, #DD-11, /99");
  });

  test("the list keeps its role under list-style: none", () => {
    const { container } = render(<LeftOutPills items={["RELIC"]} />);
    expect(container.querySelector("ul")?.getAttribute("role")).toBe("list");
  });

  test("listNamed={false}: the list carries no name, so a description that points at the wrapper keeps the pills", () => {
    render(<LeftOutPills id="line" listNamed={false} items={["Cincinnati Reds", "RELIC"]} />);
    expect(screen.queryByRole("list", { name: "Left out to fit" })).toBeNull();
    const list = screen.getByRole("list");
    expect(list.hasAttribute("aria-labelledby")).toBe(false);
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(document.getElementById("line")?.textContent).toBe("Left out to fitCincinnati Reds, RELIC");
  });

  test("renders nothing for an empty list", () => {
    const { container } = render(<LeftOutPills items={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
