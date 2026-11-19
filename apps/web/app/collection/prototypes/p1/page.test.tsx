import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import CollectionPrototype1 from "./page";

/**
 * NEO-592 — the page's status line takes down its own notice only. Notice ids
 * come from a counter that never comes round again: after a dismiss the next
 * notice must not reuse the id a timer that outlived the last one still holds.
 */
const NOTICE_MS = 10_000;

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  // The spy wraps the fake `setTimeout`: put that back before the real one.
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const reset = () => fireEvent.click(screen.getByRole("button", { name: "Reset prototype data" }));
const dismiss = () => fireEvent.click(screen.getByRole("button", { name: "Dismiss message" }));
// The line is up while its Dismiss control is (its words are also in a live region).
const said = () => screen.queryByRole("button", { name: "Dismiss message" });

function mountPage() {
  render(
    <MemoryRouter>
      <CollectionPrototype1 />
    </MemoryRouter>,
  );
}

describe("collection prototype 1: the page's notices", () => {
  it("a dismissed notice's timer never takes down the next notice (the stale-timer race)", () => {
    // The race: the old timer fires after the next notice has committed but
    // before React ran the old effect's cleanup. Hand the test that timer.
    const spy = vi.spyOn(globalThis, "setTimeout");
    mountPage();
    act(() => reset());
    expect(said()).not.toBeNull();
    const staleTimer = spy.mock.calls.filter(([, ms]) => ms === NOTICE_MS).at(-1)![0] as () => void;
    act(() => dismiss());
    expect(said()).toBeNull();
    act(() => reset());
    expect(said()).not.toBeNull();
    act(() => staleTimer());
    expect(said()).not.toBeNull();
  });

  it("a notice keeps its own full NOTICE_MS, counted from when it came up", () => {
    mountPage();
    act(() => reset());
    act(() => void vi.advanceTimersByTime(NOTICE_MS - 1_000));
    act(() => dismiss());
    act(() => reset());
    act(() => void vi.advanceTimersByTime(NOTICE_MS - 1));
    expect(said()).not.toBeNull();
    act(() => void vi.advanceTimersByTime(1));
    expect(said()).toBeNull();
  });
});
