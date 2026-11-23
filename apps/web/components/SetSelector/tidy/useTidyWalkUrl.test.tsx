/**
 * NEO-645 — where the Tidy Up walk is lives in the URL.
 *
 * Driven under a real MemoryRouter, so push vs replace and Back are the
 * router's own. The walk pushes one history entry when it opens and replaces
 * on every move after that; one test drives 100 moves against a history that
 * keeps only 50 entries, as Chromium does.
 */
import { act, render } from "@testing-library/react";
import {
  MemoryRouter,
  UNSAFE_createMemoryHistory as createMemoryHistory,
  unstable_HistoryRouter as HistoryRouter,
  useLocation,
  useNavigate,
  useNavigationType,
} from "react-router";
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

/**
 * A memory history that behaves like Chromium's session history: it keeps at
 * most `cap` entries (the oldest fall off), and `go(n)` past what is left does
 * nothing at all.
 */
function cappedHistory(initial: string, cap = 50) {
  const base = createMemoryHistory({ initialEntries: [initial], v5Compat: true });
  let index = 0; // absolute position since the history began
  let length = 1; // absolute count of entries since the history began
  let evicted = 0; // entries that fell off the front
  const counts = { pushes: 0, replaces: 0 };
  const history = Object.create(base, {
    push: {
      value: (...args: Parameters<typeof base.push>) => {
        counts.pushes++;
        index += 1;
        length = index + 1; // a push drops everything ahead of it
        if (length - evicted > cap) evicted += 1;
        base.push(...args);
      },
    },
    replace: {
      value: (...args: Parameters<typeof base.replace>) => {
        counts.replaces++;
        base.replace(...args);
      },
    },
    go: {
      value: (delta: number) => {
        const target = index + delta;
        if (target < evicted || target > length - 1) return;
        index = target;
        base.go(delta);
      },
    },
  }) as typeof base;
  return { history, counts };
}

function mount(initial: string, history?: ReturnType<typeof cappedHistory>["history"]) {
  const probe: Probe = { url: null, search: "", type: "", nav: null };
  function Harness() {
    probe.url = useTidyWalkUrl();
    probe.search = useLocation().search;
    probe.type = useNavigationType();
    probe.nav = useNavigate();
    return null;
  }
  render(
    history ? (
      <HistoryRouter history={history}>
        <Harness />
      </HistoryRouter>
    ) : (
      <MemoryRouter initialEntries={[initial]}>
        <Harness />
      </MemoryRouter>
    ),
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

  it("replaces on a move between cards, and footer Back returns to the card it left, also a replace", () => {
    const probe = mount("/?tidy=a");
    act(() => probe.url!.goToCard("b", "a"));
    expect(probe.search).toBe("?tidy=b");
    expect(probe.type).toBe("REPLACE");
    expect(probe.url!.canStepBack).toBe(true);
    act(() => probe.url!.stepBack());
    expect(probe.search).toBe("?tidy=a");
    expect(probe.type).toBe("REPLACE");
    expect(probe.url!.canStepBack).toBe(false);
  });

  it("footer Back from the first card of a review returns to the end screen", () => {
    const probe = mount("/?tidy=done");
    act(() => probe.url!.goToCard("a", "done"));
    expect(probe.search).toBe("?tidy=a");
    act(() => probe.url!.stepBack());
    expect(probe.search).toBe("?tidy=done");
    expect(probe.type).toBe("REPLACE");
  });

  it("replaces `first` and a bad id with a card, so Back never lands on them", () => {
    const probe = mount("/?tidy=first");
    act(() => probe.url!.showCard("a"));
    expect(probe.search).toBe("?tidy=a");
    expect(probe.type).toBe("REPLACE");
  });

  it("replaces for the end screen too, whether the walk finished or had nothing to walk", () => {
    const probe = mount("/?tidy=a");
    act(() => probe.url!.finish("a"));
    expect(probe.search).toBe("?tidy=done");
    expect(probe.type).toBe("REPLACE");
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

  describe("leaving goes back the one entry the walk pushed (Back never reopens it)", () => {
    it("Done after a walk of several cards goes back to the entry before the walk opened", () => {
      const probe = mount("/?sport=s");
      act(() => probe.url!.open());
      act(() => probe.url!.showCard("a")); // `first` becomes the first card: a replace, still the same entry
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

    it("after footer Back the walk still closes the same one entry", () => {
      const probe = mount("/?sport=s");
      act(() => probe.url!.open());
      act(() => probe.url!.showCard("a"));
      act(() => probe.url!.goToCard("b", "a"));
      act(() => probe.url!.stepBack());
      expect(probe.search).toBe("?sport=s&tidy=a");
      act(() => probe.url!.close());
      expect(probe.search).toBe("?sport=s");
    });

    it("a walk that was not opened here (a pasted link, a new tab) has nothing before it that is ours: it only drops the param", () => {
      const probe = mount("/?sport=s&tidy=a");
      act(() => probe.url!.goToCard("b", "a")); // no opening entry to carry
      act(() => probe.url!.close());
      expect(probe.search).toBe("?sport=s");
      expect(probe.type).toBe("REPLACE");
    });

    it("100 moves against a 50-entry history still close back to the page the walk opened from", () => {
      const { history, counts } = cappedHistory("/?sport=s");
      const probe = mount("/?sport=s", history);
      act(() => probe.url!.open());
      act(() => probe.url!.showCard("c0"));
      for (let i = 0; i < 99; i++) act(() => probe.url!.goToCard(`c${i + 1}`, `c${i}`));
      act(() => probe.url!.finish("c99"));
      expect(probe.search).toBe("?sport=s&tidy=done");
      // One push for the whole walk; every move was a replace.
      expect(counts.pushes).toBe(1);
      act(() => probe.url!.close());
      expect(probe.search).toBe("?sport=s");
      expect(probe.type).toBe("POP");
      expect(probe.url!.location).toEqual({ kind: "closed" });
    });

    it("the capped history fails the old way: a push per move leaves go(-n) stranded", () => {
      const { history } = cappedHistory("/?sport=s");
      for (let i = 0; i < 60; i++) history.push(`/?tidy=c${i}`);
      history.go(-60);
      expect(history.location.search).toBe("?tidy=c59");
    });

    it("still reads a pasted ?tidy=<id>", () => {
      const probe = mount("/?sport=s&tidy=card9");
      expect(probe.url!.location).toEqual({ kind: "card", cardId: "card9" });
    });
  });
});
