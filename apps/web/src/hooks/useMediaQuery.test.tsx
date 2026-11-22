/**
 * `useMediaQuery`: the browser's answer, followed as it changes, and `false`
 * wherever there is no `matchMedia` to ask.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { useMediaQuery } from "./useMediaQuery";

function Probe({ query }: { query: string }) {
  return <output aria-label="Matches">{String(useMediaQuery(query))}</output>;
}

/** A `matchMedia` whose answer the test flips by hand. */
function stubMatchMedia(initial: boolean) {
  let matches = initial;
  const listeners = new Set<() => void>();
  const asked: string[] = [];
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => {
      asked.push(query);
      return {
        get matches() {
          return matches;
        },
        media: query,
        addEventListener: (_: string, fn: () => void) => listeners.add(fn),
        removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
      };
    }),
  );
  return {
    asked,
    listeners,
    set(next: boolean) {
      matches = next;
      for (const fn of [...listeners]) fn();
    },
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useMediaQuery", () => {
  it("reads the query's answer, and asks with the query it was given", () => {
    const media = stubMatchMedia(true);
    render(<Probe query="(max-height: 720px)" />);
    expect(screen.getByRole("status", { name: "Matches" }).textContent).toBe("true");
    expect(media.asked).toContain("(max-height: 720px)");
  });

  it("follows the window when the answer changes, and lets go on unmount", () => {
    const media = stubMatchMedia(false);
    const { unmount } = render(<Probe query="(max-height: 720px)" />);
    expect(screen.getByRole("status", { name: "Matches" }).textContent).toBe("false");
    act(() => media.set(true));
    expect(screen.getByRole("status", { name: "Matches" }).textContent).toBe("true");
    expect(media.listeners.size).toBe(1);
    unmount();
    expect(media.listeners.size).toBe(0);
  });

  it("is false where there is no matchMedia to ask", () => {
    vi.stubGlobal("matchMedia", undefined);
    render(<Probe query="(max-height: 720px)" />);
    expect(screen.getByRole("status", { name: "Matches" }).textContent).toBe("false");
  });
});
