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
    expect(pills.map((li) => li.textContent)).toEqual(["Cincinnati Reds", "#DD-11", "/99"]);
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

  test("renders nothing for an empty list", () => {
    const { container } = render(<LeftOutPills items={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
