/**
 * Unit tests for the shared Checkbox primitive: the label toggles the box, an
 * uncontrolled `defaultChecked` shows checked, the forwarded ref reaches the
 * input (so a caller can set `indeterminate` natively), and `aria-disabled`
 * lands on the input.
 */

import { createRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
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
});
