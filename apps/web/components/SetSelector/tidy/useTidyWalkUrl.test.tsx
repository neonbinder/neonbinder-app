/**
 * NEO-645 — where the Tidy Up walk is lives in the URL.
 *
 * Driven under a real MemoryRouter, so push vs replace and Back are the
 * router's own.
 */
import { act, render } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate, useNavigationType } from "react-router";
import { describe, expect, it } from "vitest";
import {
  TIDY_PARAM,
  parseTidyParam,
  useTidyWalkUrl,
  withTidyParam,
  type TidyWalkUrl,
} from "./useTidyWalkUrl";

describe("parseTidyParam", () => {
  it("is closed with no value, an empty one, or an over-long one", () => {
    expect(parseTidyParam(null)).toEqual({ kind: "closed" });
    expect(parseTidyParam("  ")).toEqual({ kind: "closed" });
    expect(parseTidyParam("x".repeat(200))).toEqual({ kind: "closed" });
  });

  it("reads the two reserved values and otherwise a card id", () => {
    expect(parseTidyParam("first")).toEqual({ kind: "first" });
    expect(parseTidyParam("done")).toEqual({ kind: "done" });
    expect(parseTidyParam(" abc123 ")).toEqual({ kind: "card", cardId: "abc123" });
  });
});

describe("withTidyParam", () => {
  it("sets and removes the key and leaves the drill's params alone", () => {
    const base = new URLSearchParams("sport=s&set=t");
    expect(withTidyParam(base, "first").toString()).toBe("sport=s&set=t&tidy=first");
    expect(withTidyParam(new URLSearchParams("sport=s&tidy=x"), null).toString()).toBe("sport=s");
  });
});

type Probe = { url: TidyWalkUrl | null; search: string; type: string; nav: ReturnType<typeof useNavigate> | null };

function mount(initial: string) {
  const probe: Probe = { url: null, search: "", type: "", nav: null };
  function Harness() {
    probe.url = useTidyWalkUrl();
    probe.search = useLocation().search;
    probe.type = useNavigationType();
    probe.nav = useNavigate();
    return null;
  }
  render(
    <MemoryRouter initialEntries={[initial]}>
      <Harness />
    </MemoryRouter>,
  );
  return probe;
}

describe("useTidyWalkUrl", () => {
  it("reads the position from the URL", () => {
    const probe = mount("/?sport=s&tidy=card1");
    expect(probe.url!.location).toEqual({ kind: "card", cardId: "card1" });
  });

  it("opens the walk with a push, keeping the drill's params", () => {
    const probe = mount("/?sport=s");
    act(() => probe.url!.open());
    expect(probe.search).toBe(`?sport=s&${TIDY_PARAM}=first`);
    expect(probe.type).toBe("PUSH");
  });

  it("pushes a move between cards and Back steps to the card before", () => {
    const probe = mount("/?tidy=a");
    act(() => probe.url!.goToCard("b", "a"));
    expect(probe.search).toBe("?tidy=b");
    expect(probe.type).toBe("PUSH");
    expect(probe.url!.canStepBack).toBe(true);
    act(() => probe.url!.stepBack());
    expect(probe.search).toBe("?tidy=a");
    expect(probe.url!.canStepBack).toBe(false);
  });

  it("replaces `first` and a bad id with a card, so Back never lands on them", () => {
    const probe = mount("/?tidy=first");
    act(() => probe.url!.showCard("a"));
    expect(probe.search).toBe("?tidy=a");
    expect(probe.type).toBe("REPLACE");
  });

  it("pushes the end screen, and replaces it when there was nothing to walk", () => {
    const probe = mount("/?tidy=a");
    act(() => probe.url!.finish("a"));
    expect(probe.search).toBe("?tidy=done");
    expect(probe.type).toBe("PUSH");
    act(() => probe.url!.showDone());
    expect(probe.type).toBe("REPLACE");
  });

  it("closes a walk that was pasted or refreshed into with a replace and drops only its own key", () => {
    const probe = mount("/?sport=s&tidy=a");
    act(() => probe.url!.close());
    expect(probe.search).toBe("?sport=s");
    expect(probe.type).toBe("REPLACE");
    expect(probe.url!.location).toEqual({ kind: "closed" });
  });

  describe("leaving takes the walk out of history (Back never reopens it)", () => {
    it("Done after a walk of several cards goes back to the entry before the walk opened", () => {
      const probe = mount("/?sport=s");
      act(() => probe.url!.open());
      act(() => probe.url!.showCard("a")); // `first` becomes the first card: a replace, depth kept
      act(() => probe.url!.goToCard("b", "a"));
      act(() => probe.url!.goToCard("c", "b"));
      act(() => probe.url!.finish("c"));
      expect(probe.search).toBe("?sport=s&tidy=done");
      act(() => probe.url!.close());
      // Back from the checklist is now what was before the walk, not "?tidy=c".
      expect(probe.search).toBe("?sport=s");
      expect(probe.type).toBe("POP");
      expect(probe.url!.location).toEqual({ kind: "closed" });
      act(() => probe.nav!(-1));
      expect(probe.search).not.toContain("tidy");
    });

    it("Save for later on the first card leaves the same way", () => {
      const probe = mount("/?sport=s");
      act(() => probe.url!.open());
      act(() => probe.url!.showCard("a"));
      act(() => probe.url!.close());
      expect(probe.search).toBe("?sport=s");
      expect(probe.type).toBe("POP");
    });

    it("counts only this sitting's entries after a step back", () => {
      const probe = mount("/?sport=s");
      act(() => probe.url!.open());
      act(() => probe.url!.showCard("a"));
      act(() => probe.url!.goToCard("b", "a"));
      act(() => probe.url!.stepBack());
      expect(probe.search).toBe("?sport=s&tidy=a");
      act(() => probe.url!.close());
      expect(probe.search).toBe("?sport=s");
    });

    it("a walk with no depth (a pasted link, a new tab) has nothing before it that is ours: it only drops the param", () => {
      const probe = mount("/?sport=s&tidy=a");
      act(() => probe.url!.goToCard("b", "a")); // no depth to carry
      act(() => probe.url!.close());
      expect(probe.search).toBe("?sport=s");
      expect(probe.type).toBe("REPLACE");
    });

    it("still reads a pasted ?tidy=<id>", () => {
      const probe = mount("/?sport=s&tidy=card9");
      expect(probe.url!.location).toEqual({ kind: "card", cardId: "card9" });
    });
  });
});
