/**
 * NEO-279 — ConfirmDialog's `children`/`childrenLabel` detail slot (the
 * "who gets which team" ledger FillTeamsControl renders between the
 * description and the buttons). Existing keyboard-contract behaviour
 * (Escape cancels, Cancel starts focused, Tab traps) is exercised more fully
 * through FillTeamsControl.test.tsx and the NEO-170 callers; this file pins
 * the slot itself plus a no-children smoke test so the base shape stays
 * covered directly, not only through a caller.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "./confirm-dialog";

function renderDialog(overrides: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const utils = render(
    <ConfirmDialog
      title="Delete this thing?"
      description="This cannot be undone."
      confirmLabel="Yes, delete"
      busyLabel="Deleting…"
      busy={false}
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...overrides}
    />,
  );
  return { ...utils, onConfirm, onCancel };
}

describe("ConfirmDialog — children slot (NEO-279)", () => {
  it("renders the children inside a named, focusable group between the description and the buttons", () => {
    renderDialog({
      children: <p>Johnny Bench → Cincinnati Reds</p>,
      childrenLabel: "Who gets which team",
    });

    const group = screen.getByRole("group", { name: "Who gets which team" });
    expect(group.textContent).toContain("Johnny Bench → Cincinnati Reds");
    expect(group.getAttribute("tabindex")).toBe("0");
  });

  it("renders no group element at all when children is omitted", () => {
    renderDialog();
    expect(screen.queryByRole("group")).toBeNull();
  });

  it("renders no group element when children is explicitly null or undefined", () => {
    renderDialog({ children: null });
    expect(screen.queryByRole("group")).toBeNull();

    renderDialog({ children: undefined });
    expect(screen.queryByRole("group")).toBeNull();
  });

  it("the group is not joined onto aria-describedby — only the static description is announced on open", () => {
    renderDialog({
      children: <p>Detail nobody should hear read aloud automatically.</p>,
      childrenLabel: "Detail",
    });
    const dialog = screen.getByRole("dialog");
    const describedBy = dialog.getAttribute("aria-describedby");
    expect(describedBy).toBe("confirm-dialog-description");
  });

  it("an error joins aria-describedby alongside the description, still excluding the children group", () => {
    renderDialog({
      children: <p>Detail</p>,
      childrenLabel: "Detail",
      error: "Something changed underneath you.",
    });
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-describedby")).toBe(
      "confirm-dialog-description confirm-dialog-error",
    );
  });

  it("existing behaviour is unchanged: Escape cancels, and the buttons still work, with children present", () => {
    const { onCancel, onConfirm } = renderDialog({
      children: <p>Detail</p>,
      childrenLabel: "Detail",
    });

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Yes, delete" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("Cancel is focused on open, same as with no children", () => {
    renderDialog({ children: <p>Detail</p>, childrenLabel: "Detail" });
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Cancel" }),
    );
  });
});

describe("ConfirmDialog — the buttons' colours and footer (NEO-528)", () => {
  const fill = (el: HTMLElement) => el.style.getPropertyValue("--nb-fill");

  it("by default the confirm is the pink of taking away, beside a cyan Cancel (every existing caller)", () => {
    renderDialog();
    expect(fill(screen.getByRole("button", { name: "Yes, delete" }))).toBe("var(--neon-pink)");
    expect(fill(screen.getByRole("button", { name: "Cancel" }))).toBe("var(--neon-blue)");
  });

  it("a confirm that adds is green, and Cancel then wears the pink every cancel wears", () => {
    renderDialog({ confirmLabel: "Yes, add them", confirmVariant: "primary" });
    expect(fill(screen.getByRole("button", { name: "Yes, add them" }))).toBe("var(--neon-green)");
    expect(fill(screen.getByRole("button", { name: "Cancel" }))).toBe("var(--neon-pink)");
  });

  it("stacks the two buttons below sm and puts them side by side from sm up", () => {
    renderDialog();
    const footer = screen.getByRole("button", { name: "Cancel" }).parentElement!;
    expect(footer.className.split(/\s+/)).toEqual(expect.arrayContaining(["flex", "flex-col", "sm:flex-row"]));
  });
});
