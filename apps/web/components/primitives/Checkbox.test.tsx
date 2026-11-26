/**
 * Unit tests for the shared Checkbox primitive: the label toggles the box, an
 * uncontrolled `defaultChecked` shows checked, the forwarded ref reaches the
 * input (so a caller can set `indeterminate` natively), and `aria-disabled`
 * lands on the input.
 */

import { createRef, useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Checkbox } from "./Checkbox";

describe("Checkbox", () => {
  it("toggles when its label text is clicked", () => {
    render(<Checkbox label="Accept" />);
    const box = screen.getByRole("checkbox", { name: "Accept" }) as HTMLInputElement;
    expect(box.checked).toBe(false);
    fireEvent.click(screen.getByText("Accept"));
    expect(box.checked).toBe(true);
    fireEvent.click(screen.getByText("Accept"));
    expect(box.checked).toBe(false);
  });

  it("shows checked for defaultChecked", () => {
    render(<Checkbox label="Pre-ticked" defaultChecked />);
    expect((screen.getByRole("checkbox", { name: "Pre-ticked" }) as HTMLInputElement).checked).toBe(
      true,
    );
  });

  it("forwards the ref to the input so indeterminate can be set", () => {
    const ref = createRef<HTMLInputElement>();
    render(<Checkbox label="Some" ref={ref} />);
    expect(ref.current).toBeInstanceOf(HTMLInputElement);
    expect(ref.current).toBe(screen.getByRole("checkbox", { name: "Some" }));
    ref.current!.indeterminate = true;
    expect(ref.current!.indeterminate).toBe(true);
  });

  it("forwards the ref for the bare box too", () => {
    const ref = createRef<HTMLInputElement>();
    render(<Checkbox aria-label="Select all" ref={ref} />);
    expect(ref.current).toBe(screen.getByRole("checkbox", { name: "Select all" }));
  });

  it("reflects aria-disabled on the input", () => {
    render(<Checkbox label="Held" aria-disabled />);
    expect(screen.getByRole("checkbox", { name: "Held" }).getAttribute("aria-disabled")).toBe(
      "true",
    );
  });

  it("does not toggle on a label click when natively disabled", () => {
    render(<Checkbox label="Locked" disabled />);
    const box = screen.getByRole("checkbox", { name: "Locked" }) as HTMLInputElement;
    fireEvent.click(screen.getByText("Locked"));
    expect(box.checked).toBe(false);
  });

  it("keeps an aria-disabled box focusable", () => {
    render(<Checkbox label="Held" aria-disabled />);
    const box = screen.getByRole("checkbox", { name: "Held" }) as HTMLInputElement;
    expect(box.disabled).toBe(false);
    expect(box.tabIndex).toBe(0);
    box.focus();
    expect(document.activeElement).toBe(box);
  });

  it("leaves a controlled aria-disabled box unchanged when the caller's onChange returns early", () => {
    function Guarded() {
      const [on, setOn] = useState(false);
      return (
        <Checkbox
          label="Guarded"
          aria-disabled
          checked={on}
          onChange={(e) => {
            if (e.currentTarget.getAttribute("aria-disabled") === "true") return;
            setOn(e.target.checked);
          }}
        />
      );
    }
    render(<Guarded />);
    const box = screen.getByRole("checkbox", { name: "Guarded" }) as HTMLInputElement;
    fireEvent.click(screen.getByText("Guarded"));
    expect(box.checked).toBe(false);
  });

  it("renders the withText description outside the label, after a caller's describedby, and out of the name", () => {
    render(
      <>
        <p id="caller-hint">Hint</p>
        <Checkbox
          label="Notify"
          variant="withText"
          description="Sends an email"
          aria-describedby="caller-hint"
        />
      </>,
    );
    const box = screen.getByRole("checkbox", { name: "Notify" });
    const desc = screen.getByText("Sends an email");
    expect(box.closest("label")!.contains(desc)).toBe(false);
    const ids = box.getAttribute("aria-describedby")!.split(" ");
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe("caller-hint");
    expect(ids[1]).toBe(desc.id);
    expect(desc.id).not.toBe("");
  });

  it("does not render a description for the default variant", () => {
    render(<Checkbox label="Plain" description="Ignored" />);
    expect(screen.queryByText("Ignored")).toBeNull();
    expect(
      screen.getByRole("checkbox", { name: "Plain" }).getAttribute("aria-describedby"),
    ).toBeNull();
  });

  it("names the box from rich children", () => {
    render(
      <Checkbox>
        <span>
          Rookie <strong>Card</strong>
        </span>
      </Checkbox>,
    );
    expect(screen.getByRole("checkbox", { name: "Rookie Card" })).toBeTruthy();
  });

  it("renders no label for the bare box and names it from aria-label", () => {
    const { container } = render(<Checkbox aria-label="Select row" />);
    expect(container.querySelector("label")).toBeNull();
    expect(screen.getByRole("checkbox", { name: "Select row" })).toBeTruthy();
  });

  it("toggles from a caller's own label around the bare box", () => {
    render(
      <label>
        <Checkbox />
        <span>Mine</span>
      </label>,
    );
    const box = screen.getByRole("checkbox", { name: "Mine" }) as HTMLInputElement;
    fireEvent.click(screen.getByText("Mine"));
    expect(box.checked).toBe(true);
  });

  it("fires a controlled onChange exactly once per label click", () => {
    const onChange = vi.fn();
    render(<Checkbox label="Once" checked={false} onChange={onChange} />);
    fireEvent.click(screen.getByText("Once"));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("carries the layout and state class hooks", () => {
    const { container } = render(<Checkbox label="Hooks" />);
    expect(container.querySelector("label")!.className).toContain("min-h-6");
    const box = screen.getByRole("checkbox", { name: "Hooks" });
    expect(box.className).toContain("h-4");
    expect(box.className).toContain("w-4");
    const svgs = container.querySelectorAll("svg");
    expect(svgs).toHaveLength(2);
    svgs.forEach((svg) => expect(svg.getAttribute("aria-hidden")).toBe("true"));
    expect(svgs[0].getAttribute("class")).toContain("peer-[:checked:not(:indeterminate)]");
    expect(svgs[1].getAttribute("class")).toContain("peer-indeterminate");
  });

  it("gives the bare box a 24px hit area and disabled dimming", () => {
    const { container } = render(<Checkbox aria-label="Bare" />);
    expect(screen.getByRole("checkbox", { name: "Bare" }).className).toContain("hit-area-24");
    const wrapper = container.firstElementChild!;
    expect(wrapper.className).toContain("has-[input:disabled]:opacity-60");
    expect(wrapper.className).toContain("has-[input[aria-disabled=true]]:opacity-60");
  });
});
