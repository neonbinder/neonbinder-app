import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import HintedLabel from "./HintedLabel";

describe("HintedLabel", () => {
  it("keeps the bracketed key in the text, and takes it out of sight on a coarse pointer", () => {
    render(
      <button type="button">
        <HintedLabel label="Save & next (Enter)" />
      </button>,
    );
    const button = screen.getByRole("button", { name: "Save & next (Enter)" });
    const hint = button.querySelector("span") as HTMLElement;
    expect(hint.textContent).toBe(" (Enter)");
    expect(hint.className).toBe("[@media(pointer:coarse)]:sr-only");
    expect(button.firstChild?.textContent).toBe("Save & next");
  });

  it.each(["Cancel (Esc)", "Done (Esc)"])("splits %s", (label) => {
    const { container } = render(<HintedLabel label={label} />);
    expect(container.textContent).toBe(label);
    expect(container.querySelectorAll("span")).toHaveLength(1);
  });

  it("leaves a label with no key, or a bracket that is not a key, whole", () => {
    const { container } = render(
      <>
        <HintedLabel label="Skip: not ready to list" />
        <HintedLabel label="Sort (A to Z)" />
      </>,
    );
    expect(container.querySelector("span")).toBeNull();
    expect(container.textContent).toBe("Skip: not ready to listSort (A to Z)");
  });
});
