/**
 * NEO-645 — what Enter and Escape mean in the Tidy Up walk.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ownsEnter, useTidyKeys, type TidyKeysOptions } from "./useTidyKeys";

function Harness(options: TidyKeysOptions & { onNativeKey?: () => void }) {
  const onKeyDown = useTidyKeys(options);
  return (
    <div data-testid="root" onKeyDown={onKeyDown}>
      <input aria-label="A field" />
      <textarea aria-label="A box" />
      <button type="button">A control</button>
      <a href="#x">A link</a>
      <div role="combobox" aria-label="A search" tabIndex={0} />
      <p>Plain text</p>
    </div>
  );
}

function setup(overrides: Partial<TidyKeysOptions> = {}) {
  const options: TidyKeysOptions = {
    canSave: true,
    inlineOpen: false,
    closeTopInlinePart: vi.fn(() => false),
    onSave: vi.fn(),
    onSaveForLater: vi.fn(),
    ...overrides,
  };
  render(<Harness {...options} />);
  return options;
}

describe("Enter", () => {
  it("is Save & next outside any field", () => {
    const o = setup();
    fireEvent.keyDown(screen.getByText("Plain text"), { key: "Enter" });
    expect(o.onSave).toHaveBeenCalledTimes(1);
  });

  it("is a field's own while a field is focused", () => {
    const o = setup();
    fireEvent.keyDown(screen.getByLabelText("A field"), { key: "Enter" });
    fireEvent.keyDown(screen.getByLabelText("A box"), { key: "Enter" });
    fireEvent.keyDown(screen.getByRole("combobox", { name: "A search" }), { key: "Enter" });
    expect(o.onSave).not.toHaveBeenCalled();
  });

  it("is a control's own on a button or a link", () => {
    const o = setup();
    fireEvent.keyDown(screen.getByRole("button", { name: "A control" }), { key: "Enter" });
    fireEvent.keyDown(screen.getByRole("link", { name: "A link" }), { key: "Enter" });
    expect(o.onSave).not.toHaveBeenCalled();
  });

  it("never saves while an inline part is open", () => {
    const o = setup({ inlineOpen: true });
    fireEvent.keyDown(screen.getByText("Plain text"), { key: "Enter" });
    expect(o.onSave).not.toHaveBeenCalled();
  });

  it("never saves while something is pink (or a save is in flight)", () => {
    const o = setup({ canSave: false });
    fireEvent.keyDown(screen.getByText("Plain text"), { key: "Enter" });
    expect(o.onSave).not.toHaveBeenCalled();
  });

  it("leaves a key a field already handled alone, and ignores repeats and chords", () => {
    const o = setup();
    const text = screen.getByText("Plain text");
    fireEvent.keyDown(text, { key: "Enter", repeat: true });
    fireEvent.keyDown(text, { key: "Enter", ctrlKey: true });
    fireEvent.keyDown(text, { key: "Enter", shiftKey: true });
    expect(o.onSave).not.toHaveBeenCalled();
    const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    event.preventDefault();
    text.dispatchEvent(event);
    expect(o.onSave).not.toHaveBeenCalled();
  });

  it("claims the key (no double action) when it does save", () => {
    setup();
    const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    screen.getByText("Plain text").dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});

describe("Escape", () => {
  it("is Save for later outside any field", () => {
    const o = setup();
    fireEvent.keyDown(screen.getByText("Plain text"), { key: "Escape" });
    expect(o.onSaveForLater).toHaveBeenCalledTimes(1);
  });

  it("is Save for later from a button too (a button has no Escape of its own)", () => {
    const o = setup();
    fireEvent.keyDown(screen.getByRole("button", { name: "A control" }), { key: "Escape" });
    expect(o.onSaveForLater).toHaveBeenCalledTimes(1);
  });

  it("is a field's own while a field is focused and nothing inline is open", () => {
    const o = setup();
    fireEvent.keyDown(screen.getByLabelText("A field"), { key: "Escape" });
    expect(o.onSaveForLater).not.toHaveBeenCalled();
  });

  it("closes the top inline part first, from a field or not, and does not leave", () => {
    const close = vi.fn(() => true);
    const o = setup({ inlineOpen: true, closeTopInlinePart: close });
    fireEvent.keyDown(screen.getByLabelText("A field"), { key: "Escape" });
    fireEvent.keyDown(screen.getByText("Plain text"), { key: "Escape" });
    expect(close).toHaveBeenCalledTimes(2);
    expect(o.onSaveForLater).not.toHaveBeenCalled();
  });

  it("leaves a key a field already swallowed (an open list closing)", () => {
    const o = setup();
    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    event.preventDefault();
    screen.getByText("Plain text").dispatchEvent(event);
    expect(o.onSaveForLater).not.toHaveBeenCalled();
  });
});

describe("ownsEnter", () => {
  it("says which targets activate on Enter", () => {
    const button = document.createElement("button");
    const inner = document.createElement("span");
    button.append(inner);
    expect(ownsEnter(inner)).toBe(true);
    expect(ownsEnter(document.createElement("p"))).toBe(false);
    expect(ownsEnter(null)).toBe(false);
  });
});
