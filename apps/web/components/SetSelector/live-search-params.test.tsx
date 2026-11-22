/**
 * NEO-645 — a write to the set builder's query string builds on the URL the
 * last write asked for, not the one last rendered.
 *
 * Found through "Saved N cards." vanishing after Match Cards' Confirm: the walk
 * opens (`?tidy=first`) straight after the commit, and a drill write still
 * waiting in the router's transition was undone by it, which left the drill on
 * a URL it had not vouched for, so the whole set builder went back to its
 * loading placeholder and the checklist, with its notice, was torn down.
 * (`.test.tsx`: the components project only collects that suffix.)
 */
import { act, render } from "@testing-library/react";
import { useLayoutEffect } from "react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../convex/_generated/api", () => ({
  api: { drillPath: { resolveDrillPath: "resolveDrillPath" } },
}));
const resolverCalls: string[][] = [];
vi.mock("convex/react", () => ({
  useQuery: (_ref: string, args: unknown) => {
    if (args === "skip") return undefined;
    const { ids } = args as { ids: string[] };
    resolverCalls.push(ids);
    return ids.map((_id) => ({ _id }));
  },
}));

import {
  forgetSearchWrite,
  liveSearchParams,
  noteSearchWrite,
  settleSearchWrite,
} from "./live-search-params";
import { useTidyWalkUrl, type TidyWalkUrl } from "./tidy/useTidyWalkUrl";
import { useDrillUrlState, type DrillUrlState } from "./useDrillUrlState";

const seen: {
  drill: ReturnType<typeof useDrillUrlState> | null;
  tidy: ReturnType<typeof useTidyWalkUrl> | null;
  search: string;
} = { drill: null, tidy: null, search: "" };
const drill = {
  select: (...args: Parameters<DrillUrlState["select"]>) => seen.drill!.select(...args),
};
const tidy = {
  open: () => seen.tidy!.open(),
  goToCard: (...args: Parameters<TidyWalkUrl["goToCard"]>) => seen.tidy!.goToCard(...args),
};
function Harness() {
  const d = useDrillUrlState();
  const t = useTidyWalkUrl();
  const { search } = useLocation();
  useLayoutEffect(() => {
    seen.drill = d;
    seen.tidy = t;
    seen.search = search;
  });
  return <p>{d.resolving ? "resolving" : "ready"}</p>;
}
const params = () => Object.fromEntries(new URLSearchParams(seen.search));

beforeEach(() => {
  resolverCalls.length = 0;
  forgetSearchWrite();
});
afterEach(() => vi.useRealTimers());

describe("the walk opening in the same tick as a drill write", () => {
  it("keeps the drill's new level and the walk's param", async () => {
    const { container } = render(
      <MemoryRouter initialEntries={["/?sport=a"]}>
        <Harness />
      </MemoryRouter>,
    );
    await act(async () => {
      drill.select("year", "y1");
      tidy.open();
    });
    expect(params()).toEqual({ sport: "a", year: "y1", tidy: "first" });
    expect(container.textContent).toBe("ready");
    // The path the drill wrote is trusted: nothing went to the resolver for it.
    expect(resolverCalls.some((ids) => ids.includes("y1"))).toBe(false);
  });

  it("keeps both when the walk's write comes first and the drill's write is a correction that leaves the path alone", async () => {
    render(
      <MemoryRouter initialEntries={["/?sport=a&year=y1"]}>
        <Harness />
      </MemoryRouter>,
    );
    await act(async () => {
      tidy.open();
      drill.select("year", "y1"); // re-pick of the selected row: no write
    });
    expect(params()).toEqual({ sport: "a", year: "y1", tidy: "first" });
  });

  it("a later walk write after both commits builds on the committed URL", async () => {
    render(
      <MemoryRouter initialEntries={["/?sport=a"]}>
        <Harness />
      </MemoryRouter>,
    );
    await act(async () => {
      drill.select("year", "y1");
      tidy.open();
    });
    await act(async () => tidy.goToCard("card-1", "first"));
    expect(params()).toEqual({ sport: "a", year: "y1", tidy: "card-1" });
  });
});

describe("liveSearchParams", () => {
  it("is the rendered params while nothing is pending", () => {
    const rendered = new URLSearchParams("a=1");
    expect(liveSearchParams(rendered)).toBe(rendered);
  });

  it("is the pending write's params until a render shows them", () => {
    noteSearchWrite(new URLSearchParams("a=1&b=2"));
    expect(liveSearchParams(new URLSearchParams("a=1")).toString()).toBe("a=1&b=2");
    settleSearchWrite(new URLSearchParams("a=1")); // an older URL: still pending
    expect(liveSearchParams(new URLSearchParams("a=1")).toString()).toBe("a=1&b=2");
    settleSearchWrite(new URLSearchParams("a=1&b=2"));
    const rendered = new URLSearchParams("c=3");
    expect(liveSearchParams(rendered)).toBe(rendered);
  });

  it("lets a write the router never committed lapse", () => {
    vi.useFakeTimers();
    noteSearchWrite(new URLSearchParams("a=1&b=2"));
    vi.advanceTimersByTime(3500);
    const rendered = new URLSearchParams("a=1");
    expect(liveSearchParams(rendered)).toBe(rendered);
  });

  it("forgets a pending write when the browser's own Back or Forward moves the URL", () => {
    noteSearchWrite(new URLSearchParams("a=1&b=2"));
    window.dispatchEvent(new PopStateEvent("popstate"));
    const rendered = new URLSearchParams("a=1");
    expect(liveSearchParams(rendered)).toBe(rendered);
  });
});
