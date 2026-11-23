/**
 * NEO-463 — the "Just Walker?" question, tested on its own. The Tidy Up Player
 * tile hosts it; these pin the panel and its helpers, which the retired entity
 * review wizard used to cover from above.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { ConvexError } from "convex/values";
import { describe, expect, it, vi } from "vitest";
import NameFragmentPanel, {
  NameFragmentLiveRegion,
  ONE_NAME_PLAYER_LABEL,
  fragmentCheckChoices,
  fragmentRefusalMatches,
  isNameFragmentRefusal,
  nameFragmentMessage,
} from "./NameFragmentPanel";

const DEVIN = { _id: "p1", name: "Devin Walker" };
const LARRY = { _id: "p2", name: "Larry Walker" };

describe("fragmentCheckChoices", () => {
  it("is null for no answer or a name that is no fragment", () => {
    expect(fragmentCheckChoices(undefined)).toBeNull();
    expect(fragmentCheckChoices({ isFragment: false, matches: [DEVIN] })).toBeNull();
  });

  it("lists the matches, and withholds a truncated read's partial list", () => {
    expect(fragmentCheckChoices({ isFragment: true, matches: [DEVIN] })).toEqual([DEVIN]);
    expect(fragmentCheckChoices({ isFragment: true, truncated: true, matches: [DEVIN] })).toEqual([]);
  });
});

describe("nameFragmentMessage", () => {
  it("names one, two, or two and a count", () => {
    expect(nameFragmentMessage("Walker", [DEVIN])).toBe(
      "Just Walker? We've got Devin Walker. Pick one, or add Walker as a one-name player.",
    );
    expect(nameFragmentMessage("Walker", [DEVIN, LARRY])).toBe(
      "Just Walker? We've got Devin Walker and Larry Walker. Pick one, or add Walker as a one-name player.",
    );
    expect(nameFragmentMessage("Walker", [DEVIN, LARRY, { _id: "p3", name: "Jordan Walker" }])).toContain(
      "Devin Walker, Larry Walker and 1 more.",
    );
  });

  it("does not double the stop after a name that ends in one", () => {
    const jr = { _id: "p4", name: "Ken Griffey Jr." };
    expect(nameFragmentMessage("Griffey", [jr])).toContain("Ken Griffey Jr. Pick one");
  });

  it("still speaks with no matches in hand", () => {
    expect(nameFragmentMessage(" Walker ", [])).toBe(
      "Just Walker? That's part of a fuller name we've got. Type the whole name to find them, or add Walker as a one-name player.",
    );
  });
});

describe("the server's refusal", () => {
  it("is read by its code, never its text", () => {
    expect(isNameFragmentRefusal(new ConvexError({ code: "PLAYER_NAME_FRAGMENT" }))).toBe(true);
    expect(isNameFragmentRefusal(new ConvexError("Just Walker?"))).toBe(false);
    expect(isNameFragmentRefusal(new Error("PLAYER_NAME_FRAGMENT"))).toBe(false);
  });

  it("carries matches only in the shape the panel reads", () => {
    const err = new ConvexError({
      code: "PLAYER_NAME_FRAGMENT",
      matches: [{ _id: "p1", name: "Devin Walker", birthYear: 1994 }, { nope: true }, { _id: "p2", name: "Larry Walker" }],
    });
    expect(fragmentRefusalMatches(err)).toEqual([
      { _id: "p1", name: "Devin Walker", birthYear: 1994 },
      { _id: "p2", name: "Larry Walker" },
    ]);
    expect(fragmentRefusalMatches(new ConvexError({ code: "PLAYER_NAME_FRAGMENT" }))).toEqual([]);
    expect(fragmentRefusalMatches(new Error("x"))).toEqual([]);
  });
});

describe("NameFragmentPanel", () => {
  it("is a group named by its sentence, with the fuller names as links", () => {
    const onPick = vi.fn();
    render(<NameFragmentPanel name="Walker" matches={[DEVIN, LARRY]} onPick={onPick} />);
    expect(screen.getByRole("group", { name: /^Just Walker\? We've got Devin Walker and Larry Walker/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Link to Devin Walker" }));
    expect(onPick).toHaveBeenCalledWith("p1");
  });

  it("tells two players with one name apart by birth year, and only then", () => {
    render(
      <NameFragmentPanel
        name="Walker"
        matches={[
          { _id: "a", name: "Larry Walker", birthYear: 1966 },
          { _id: "b", name: "Larry Walker", birthYear: 1990 },
          { _id: "c", name: "Devin Walker", birthYear: 1994 },
        ]}
        onPick={vi.fn()}
      />,
    );
    expect(screen.getByText("b. 1966")).toBeTruthy();
    expect(screen.getByText("b. 1990")).toBeTruthy();
    expect(screen.queryByText("b. 1994")).toBeNull();
  });

  it("offers the one-name create only where the surface hands it a handler", () => {
    const onConfirm = vi.fn();
    const { rerender } = render(<NameFragmentPanel name="Walker" matches={[DEVIN]} onPick={vi.fn()} />);
    expect(screen.queryByRole("button", { name: ONE_NAME_PLAYER_LABEL })).toBeNull();
    rerender(<NameFragmentPanel name="Walker" matches={[DEVIN]} onPick={vi.fn()} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole("button", { name: ONE_NAME_PLAYER_LABEL }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("holds every control with aria-disabled while another decision is in flight", () => {
    const onPick = vi.fn();
    render(<NameFragmentPanel name="Walker" matches={[DEVIN]} onPick={onPick} disabled />);
    const link = screen.getByRole("button", { name: "Link to Devin Walker" });
    expect(link.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(link);
    expect(onPick).not.toHaveBeenCalled();
  });

  it("takes focus on mount when asked, and Escape hands back to the caller", () => {
    const onDismiss = vi.fn();
    render(<NameFragmentPanel name="Walker" matches={[DEVIN]} onPick={vi.fn()} autoFocus onDismiss={onDismiss} />);
    const group = screen.getByRole("group");
    expect(document.activeElement).toBe(group);
    fireEvent.keyDown(group, { key: "Escape" });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe("NameFragmentLiveRegion", () => {
  it("is mounted empty, then says the sentence", () => {
    const { rerender } = render(<NameFragmentLiveRegion message={null} />);
    const region = screen.getByRole("status");
    expect(region.textContent).toBe("");
    rerender(<NameFragmentLiveRegion message="Just Walker? …" />);
    expect(screen.getByRole("status").textContent).toBe("Just Walker? …");
  });

  it("stays quiet while focus sits where the panel will take it", () => {
    const btn = document.createElement("button");
    document.body.append(btn);
    btn.focus();
    const ref = { current: btn };
    render(<NameFragmentLiveRegion message="Just Walker? …" skipWhileFocusedOn={ref} />);
    expect(screen.getByRole("status").textContent).toBe("");
    btn.remove();
  });
});
