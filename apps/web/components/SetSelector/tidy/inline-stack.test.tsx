/**
 * NEO-645 — Esc closes the inline part that holds focus, else the newest.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  InlineStackProvider,
  useCloseTopInlinePart,
  useInlinePart,
  useInlineStackOpen,
} from "./inline-stack";

function Part({ name, onClose, scoped = true }: { name: string; onClose: () => void; scoped?: boolean }) {
  const [open, setOpen] = useState(true);
  const ref = useRef<HTMLDivElement | null>(null);
  useInlinePart(
    open,
    () => {
      onClose();
      setOpen(false);
    },
    scoped ? ref : undefined,
  );
  return (
    <div ref={ref}>
      {open && <button type="button">{`${name} field`}</button>}
    </div>
  );
}

function Escape() {
  const closeTop = useCloseTopInlinePart();
  const open = useInlineStackOpen();
  return (
    <button type="button" onClick={() => closeTop()} data-open={open}>
      Press Esc
    </button>
  );
}

function setup(parts: Array<{ name: string; scoped?: boolean; close: () => void }>) {
  render(
    <InlineStackProvider>
      {parts.map((p) => (
        <Part key={p.name} name={p.name} onClose={p.close} scoped={p.scoped} />
      ))}
      <Escape />
    </InlineStackProvider>,
  );
  // Pressing the control moves focus in a browser; keep it where the test put it.
  return screen.getByRole("button", { name: "Press Esc" });
}

describe("closing the top inline part", () => {
  it("closes the part that holds focus, even when another opened later", () => {
    const first = vi.fn();
    const second = vi.fn();
    const press = setup([
      { name: "First", close: first },
      { name: "Second", close: second },
    ]);
    screen.getByRole("button", { name: "First field" }).focus();
    fireEvent.click(press);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });

  it("falls back to the most recent when focus is in none of them", () => {
    const first = vi.fn();
    const second = vi.fn();
    const press = setup([
      { name: "First", close: first },
      { name: "Second", close: second },
    ]);
    press.focus();
    fireEvent.click(press);
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  it("a part with no scope is only ever closed as the most recent", () => {
    const first = vi.fn();
    const second = vi.fn();
    const press = setup([
      { name: "First", scoped: false, close: first },
      { name: "Second", close: second },
    ]);
    screen.getByRole("button", { name: "First field" }).focus();
    fireEvent.click(press);
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  it("says nothing is open once every part has closed, and closes nothing", () => {
    const only = vi.fn();
    const press = setup([{ name: "Only", close: only }]);
    expect(press.getAttribute("data-open")).toBe("true");
    fireEvent.click(press);
    expect(only).toHaveBeenCalledTimes(1);
    expect(press.getAttribute("data-open")).toBe("false");
    fireEvent.click(press);
    expect(only).toHaveBeenCalledTimes(1);
  });
});
