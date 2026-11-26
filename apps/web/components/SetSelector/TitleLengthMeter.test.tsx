/**
 * NEO-101 — `titleLengthState` and the two components built on it
 * (`TitleLengthMeter`, `TitleLengthAlert`), plus `TitleFieldNote`.
 *
 * This is the ONE place the 80 cap is pinned as a pure function, so a
 * boundary regression here is a red test rather than something only
 * discoverable by eyeballing a rendered drawer. There is no soft band below
 * the cap (NEO-645): 55 and 70 are as plain as 40.
 */

import { render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";
import {
  ASPECT_VALUE_MAX,
  LISTING_TITLE_MAX,
  OVER_FIELD_CLASS,
  overFieldProps,
  TitleFieldNote,
  TitleLengthAlert,
  TitleLengthMeter,
  titleLengthState,
} from "./TitleLengthMeter";
describe("titleLengthState — the hard cap", () => {
  it("is 'ok' for everything up to and including the cap (the default)", () => {
    for (const length of [0, 1, 40, 54, 55, 56, 69, 70, 71, 79, 80]) {
      const state = titleLengthState(length);
      expect(state, `length ${length}`).toMatchObject({
        tone: "ok",
        over: false,
        overBy: 0,
        hint: null,
        alert: null,
      });
    }
  });

  it("flips to 'over' at exactly one character past the cap, never at the cap itself", () => {
    expect(titleLengthState(LISTING_TITLE_MAX).over).toBe(false);
    expect(titleLengthState(LISTING_TITLE_MAX + 1).over).toBe(true);
  });

  it("reports overBy and the alert text precisely", () => {
    const state = titleLengthState(94);
    expect(state.tone).toBe("over");
    expect(state.over).toBe(true);
    expect(state.overBy).toBe(14);
    expect(state.hint).toBe("14 over");
    expect(state.alert).toBe(
      "94 characters, 14 over the 80-character limit.",
    );
  });

  it("one over the cap is exactly '1 over', not '0 over' or '2 over'", () => {
    const state = titleLengthState(LISTING_TITLE_MAX + 1);
    expect(state.overBy).toBe(1);
    expect(state.hint).toBe("1 over");
    expect(state.alert).toBe("81 characters, 1 over the 80-character limit.");
  });
});

describe("titleLengthState — no soft band below the cap (NEO-645)", () => {
  it("is plain 'ok' with no hint at every length up to and including 80, 55 and 70 included", () => {
    for (const length of [0, 1, 40, 54, 55, 56, 69, 70, 71, 79, 80]) {
      expect(titleLengthState(length, LISTING_TITLE_MAX), `length ${length}`).toMatchObject({
        tone: "ok",
        over: false,
        hint: null,
        alert: null,
      });
    }
  });

  it("81 is over and keeps its over-limit treatment", () => {
    const overCap = titleLengthState(81, LISTING_TITLE_MAX);
    expect(overCap.tone).toBe("over");
    expect(overCap.over).toBe(true);
    expect(overCap.hint).toBe("1 over");
    expect(overCap.alert).not.toBeNull();
  });
});

describe("titleLengthState — a non-title field (the aspect value)", () => {
  // How TitleFixer and CardDetailPanel call it for `cardVariation`: a custom
  // `max`. Nothing below the cap warns.
  it("stays plain below its own cap", () => {
    for (const length of [0, 50, 55, 60, 64, 65]) {
      expect(titleLengthState(length, ASPECT_VALUE_MAX)).toMatchObject({
        tone: "ok",
        hint: null,
      });
    }
  });

  it("65 is fine, 66 is over — the aspect cap is independent of the title cap", () => {
    expect(titleLengthState(65, ASPECT_VALUE_MAX).over).toBe(false);
    const over = titleLengthState(66, ASPECT_VALUE_MAX);
    expect(over.over).toBe(true);
    expect(over.overBy).toBe(1);
    expect(over.alert).toBe("66 characters, 1 over the 65-character limit.");
  });
});

describe("TitleLengthMeter — rendering", () => {
  it("renders the raw count and no hint within the cap", () => {
    render(<TitleLengthMeter length={40} />);
    expect(screen.getByText("40/80")).toBeTruthy();
    expect(screen.queryByText(/may clip/)).toBeNull();
  });

  it("renders a plain count, no clip hint, at 55 and 70 (NEO-645)", () => {
    const { rerender, container } = render(<TitleLengthMeter length={55} />);
    expect(screen.getByText("55/80")).toBeTruthy();
    expect(screen.queryByText(/may clip/)).toBeNull();
    expect(container.textContent).toBe("55/80");
    expect(container.firstElementChild?.className).toContain("text-ink-3");

    rerender(<TitleLengthMeter length={70} />);
    expect(screen.getByText("70/80")).toBeTruthy();
    expect(container.textContent).toBe("70/80");
    expect(container.firstElementChild?.className).toContain("text-ink-3");
  });

  it("past the cap shows the count, '· N over' and the pink text role", () => {
    const { container } = render(<TitleLengthMeter length={84} />);
    expect(container.textContent).toBe("84/80·4 over");
    expect(container.firstElementChild?.className).toContain("text-neon-pink-text");
  });

  it("uses a custom max verbatim (the aspect-value field)", () => {
    render(<TitleLengthMeter length={70} max={ASPECT_VALUE_MAX} />);
    expect(screen.getByText("70/65")).toBeTruthy();
  });
});

describe("TitleLengthAlert — rendering and semantics", () => {
  it("renders nothing within the cap, at any length", () => {
    const { container } = render(<TitleLengthAlert length={80} />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("blocking (default): role=alert, and tells the operator to shorten it", () => {
    render(<TitleLengthAlert length={84} />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("84 characters");
    expect(alert.textContent).toContain("4 over the 80-character limit");
    expect(alert.textContent).toContain("Shorten it before saving.");
  });

  it("non-blocking (aspect value): role=status, and warns rather than instructs", () => {
    render(
      <TitleLengthAlert
        length={70}
        max={ASPECT_VALUE_MAX}
        what="Variation"
        blocking={false}
      />,
    );
    const status = screen.getByRole("status");
    expect(status.textContent).toContain("Variation is 70 characters");
    expect(status.textContent).toContain("5 over the 65-character limit");
    expect(status.textContent).toContain("You can still save it");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("carries the id through, for aria-describedby wiring", () => {
    render(<TitleLengthAlert id="my-alert-id" length={84} />);
    expect(screen.getByRole("alert").id).toBe("my-alert-id");
  });
});

describe("TitleFieldNote", () => {
  it("renders its children as plain advisory text", () => {
    render(<TitleFieldNote>Auto title was cut short — rewrite it</TitleFieldNote>);
    expect(
      screen.getByText("Auto title was cut short — rewrite it"),
    ).toBeTruthy();
  });
});

describe("NEO-606 — the over-cap look is neon pink, on the text and on the field", () => {
  it("paints the counter and the alert in the pink text role itself, not through the danger notice role", () => {
    render(
      <>
        <TitleLengthMeter length={81} />
        <TitleLengthAlert id="a" length={81} />
      </>,
    );
    expect(screen.getByText("81/80").parentElement?.className).toContain("text-neon-pink-text");
    expect(screen.getByRole("alert").className).toContain("text-neon-pink-text");
    expect(screen.getByRole("alert").className).not.toContain("notice-danger");
  });

  it("OVER_FIELD_CLASS is keyed on data-over, never aria-invalid: edge, ring and tint in the pink roles", () => {
    const classes = OVER_FIELD_CLASS.split(" ");
    expect(classes).toEqual(expect.arrayContaining([
      "data-[over=true]:border-neon-pink-text",
      "data-[over=true]:ring-1",
      "data-[over=true]:ring-neon-pink-text",
      "data-[over=true]:bg-neon-pink/10",
    ]));
    // A refused save sets aria-invalid; that error keeps its own look.
    expect(OVER_FIELD_CLASS).not.toContain("aria-invalid");
  });

  it("OVER_FIELD_CLASS lets the grey held fill win over the tint, edge and ring staying", () => {
    const classes = OVER_FIELD_CLASS.split(" ");
    // Three attributes of specificity (held + over) against the tint's two.
    expect(classes).toContain("aria-disabled:data-[over=true]:bg-button-neutral");
    expect(classes).toContain("disabled:data-[over=true]:bg-button-neutral");
    // Nothing held ever drops the edge or the ring.
    expect(classes.filter((c) => /^(aria-disabled|disabled):.*(border|ring)/.test(c))).toEqual([]);
  });

  it("overFieldProps sets the length-only hook when over and nothing when not", () => {
    expect(overFieldProps(true)).toEqual({ "data-over": "true" });
    expect(overFieldProps(false)).toEqual({});
  });
});
