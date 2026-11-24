/**
 * NEO-656 — the walk's in-memory store. The card is the only record of a
 * name's answer: nothing here is stored (not in Convex, `sessionStorage` or
 * `localStorage`). A lookup is keyed `cardId|kind|name|sportId`, so a response
 * for a question the operator has since changed is never read.
 */
import { act, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../convex/_generated/api", () => {
  // A function reference is its dotted path ("adapters.wikidata.lookupTidyName").
  const path = (parts: string[]): unknown =>
    new Proxy(() => {}, {
      get: (_t, key) =>
        key === Symbol.toPrimitive || key === "toString"
          ? () => parts.join(".")
          : typeof key !== "string" || key === "then"
            ? undefined
            : path([...parts, key]),
    });
  return { api: path([]) };
});
const actions: Record<string, ReturnType<typeof vi.fn>> = {};
vi.mock("convex/react", () => ({
  useAction: (ref: unknown) => (actions[String(ref)] ??= vi.fn(() => new Promise(() => {}))),
}));

import {
  WalkMemory,
  WalkMemoryProvider,
  lookupKeyOf,
  nameKeyOf,
  pendingNamesOf,
  useCardNameLookups,
  useLeafFacts,
  useNameLookup,
  useWalkMemory,
  type LeafFacts,
} from "./walk-memory";

type Run = Parameters<WalkMemory["ask"]>[1];
const ids = (c: string, s = "sport-1") => ({ cardId: c as never, sportId: s as never });
const ask = (m: WalkMemory, run: Run, c = "c1", name = "Jackson Merrill", kind: "player" | "team" = "player", s = "sport-1") =>
  m.ask({ ...ids(c, s), kind, name }, run);
const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};
const READY = { status: "ready" as const, enrichment: { wikidataId: "Q1" } };
const flush = () => act(async () => {});

let setItem: ReturnType<typeof vi.spyOn>;
let localSet: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  for (const k of Object.keys(actions)) delete actions[k];
  setItem = vi.spyOn(Storage.prototype, "setItem");
  localSet = setItem;
});
afterEach(() => vi.restoreAllMocks());

describe("lookup keys", () => {
  it("are cardId|kind|name|sportId, the name through the shared matcher", () => {
    expect(lookupKeyOf("c1", "player", "  José  RAMÍREZ ", "s1")).toBe(lookupKeyOf("c1", "player", "jose ramirez", "s1"));
    expect(lookupKeyOf("c1", "player", "A B", "s1").startsWith("c1|player|")).toBe(true);
    expect(lookupKeyOf("c1", "player", "A B", "s1").endsWith("|s1")).toBe(true);
  });

  it("differ by card, kind and sport, and the same words as a team and as a player are two questions", () => {
    const base = lookupKeyOf("c1", "player", "Padres", "s1");
    expect(lookupKeyOf("c2", "player", "Padres", "s1")).not.toBe(base);
    expect(lookupKeyOf("c1", "team", "Padres", "s1")).not.toBe(base);
    expect(lookupKeyOf("c1", "player", "Padres", "s2")).not.toBe(base);
    expect(nameKeyOf("team", "Padres")).not.toBe(nameKeyOf("player", "Padres"));
  });
});

describe("WalkMemory lookups", () => {
  it("asks once per key and reads the answer back under the same key", async () => {
    const m = new WalkMemory();
    const run = vi.fn().mockResolvedValue(READY);
    ask(m, run);
    ask(m, run);
    expect(run).toHaveBeenCalledTimes(1);
    expect(m.lookupFor("c1", "player", "Jackson Merrill", "sport-1")).toEqual({ status: "pending" });
    await flush();
    expect(m.lookupFor("c1", "player", "Jackson Merrill", "sport-1")).toEqual(READY);
  });

  it("a response is filed under the key that asked, so a changed question never shows the old answer", async () => {
    const m = new WalkMemory();
    const first = deferred<typeof READY>();
    const run = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValueOnce({ status: "ready" });
    ask(m, run, "c1", "Jackson Merrill", "player", "sport-1");
    // The operator switches the Sport chip: a new question under a new key.
    ask(m, run, "c1", "Jackson Merrill", "player", "sport-2");
    await flush();
    expect(m.lookupFor("c1", "player", "Jackson Merrill", "sport-2")).toEqual({ status: "ready" });
    // The stale response for sport-1 lands late, and lands only on its own key.
    await act(async () => first.resolve(READY));
    expect(m.lookupFor("c1", "player", "Jackson Merrill", "sport-2")).toEqual({ status: "ready" });
    expect(m.lookupFor("c1", "player", "Jackson Merrill", "sport-1")).toEqual(READY);
  });

  it("a response for a card another card's key never leaks across cards", async () => {
    const m = new WalkMemory();
    const run = vi.fn().mockResolvedValueOnce(READY).mockResolvedValueOnce({ status: "ready" });
    ask(m, run, "c1");
    ask(m, run, "c2");
    await flush();
    expect(m.lookupFor("c2", "player", "Jackson Merrill", "sport-1")).toEqual({ status: "ready" });
  });

  it("a thrown or rejected ask is an error, never a claim; Try again forgets it and asks once more", async () => {
    const m = new WalkMemory();
    const run = vi.fn().mockRejectedValueOnce(new Error("down")).mockResolvedValueOnce(READY);
    ask(m, run);
    await flush();
    expect(m.lookupFor("c1", "player", "Jackson Merrill", "sport-1")).toEqual({ status: "error" });
    m.retry({ ...ids("c1"), kind: "player", name: "Jackson Merrill" }, run);
    expect(m.lookupFor("c1", "player", "Jackson Merrill", "sport-1")).toEqual({ status: "pending" });
    await flush();
    expect(run).toHaveBeenCalledTimes(2);
    expect(m.lookupFor("c1", "player", "Jackson Merrill", "sport-1")).toEqual(READY);
  });

  describe("Add anyway asks again in full (main's awaitsOperatorBeforeLookup)", () => {
    const CHOICE = {
      status: "ready" as const,
      enrichment: { existingCandidates: [{ playerId: "p1", name: "A", careerSummary: "" }] },
    } as never;
    const target = { ...ids("c1"), kind: "player" as const, name: "Jackson Merrill" };

    it("asks again with full: true, keeps the choice on screen meanwhile, and files the full answer", async () => {
      const m = new WalkMemory();
      const second = deferred<typeof READY>();
      const run = vi.fn().mockResolvedValueOnce(CHOICE).mockReturnValueOnce(second.promise);
      ask(m, run);
      await flush();
      expect(run.mock.calls[0][0]).not.toHaveProperty("full");
      m.askFull(target, run);
      expect(run.mock.calls[1][0]).toMatchObject({ full: true });
      const during = m.lookupFor("c1", "player", "Jackson Merrill", "sport-1");
      expect(during?.status).toBe("pending");
      expect(during?.enrichment).toEqual((CHOICE as { enrichment: unknown }).enrichment);
      second.resolve(READY);
      await flush();
      expect(m.lookupFor("c1", "player", "Jackson Merrill", "sport-1")).toEqual(READY);
    });

    it("does nothing when the first answer already included Wikidata, and asks in full only once", async () => {
      const m = new WalkMemory();
      const run = vi.fn().mockResolvedValue(READY);
      ask(m, run);
      await flush();
      m.askFull(target, run);
      expect(run).toHaveBeenCalledTimes(1);

      const held = new WalkMemory();
      const run2 = vi.fn().mockResolvedValue(CHOICE);
      ask(held, run2);
      await flush();
      held.askFull(target, run2);
      held.askFull(target, run2);
      expect(run2).toHaveBeenCalledTimes(2);
    });

    it("a failed full ask is an error that keeps the choice, and Try again asks in full again", async () => {
      const m = new WalkMemory();
      const run = vi.fn().mockResolvedValueOnce(CHOICE).mockRejectedValueOnce(new Error("down")).mockResolvedValueOnce(READY);
      ask(m, run);
      await flush();
      m.askFull(target, run);
      await flush();
      const failed = m.lookupFor("c1", "player", "Jackson Merrill", "sport-1");
      expect(failed?.status).toBe("error");
      expect(failed?.enrichment).toBeDefined();
      m.retry(target, run);
      await flush();
      expect(run.mock.calls[2][0]).toMatchObject({ full: true });
    });

    it("an answer to the first ask that lands after Add anyway never overwrites the full one", async () => {
      const m = new WalkMemory();
      const first = deferred<typeof CHOICE>();
      const run = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValueOnce(READY);
      ask(m, run);
      m.askFull(target, run);
      await flush();
      first.resolve(CHOICE);
      await flush();
      expect(m.lookupFor("c1", "player", "Jackson Merrill", "sport-1")).toEqual(READY);
    });

    it("a team is always asked in full already", async () => {
      const m = new WalkMemory();
      const run = vi.fn().mockResolvedValue(CHOICE);
      m.ask({ ...ids("c1"), kind: "team", name: "Nationals" }, run);
      await flush();
      m.askFull({ ...ids("c1"), kind: "team", name: "Nationals" }, run);
      expect(run).toHaveBeenCalledTimes(1);
    });
  });

  it("a runner that throws synchronously is an error too", async () => {
    const m = new WalkMemory();
    ask(m, () => {
      throw new Error("sync");
    });
    await flush();
    expect(m.lookupFor("c1", "player", "Jackson Merrill", "sport-1")?.status).toBe("error");
  });

  it("notifies subscribers when a lookup lands, and stops after unsubscribe", async () => {
    const m = new WalkMemory();
    const listener = vi.fn();
    const off = m.subscribe(listener);
    ask(m, vi.fn().mockResolvedValue(READY));
    await flush();
    const calls = listener.mock.calls.length;
    expect(calls).toBeGreaterThanOrEqual(2);
    off();
    m.keepPick("c1", { field: "players", values: [], picked: [], typed: false });
    expect(listener).toHaveBeenCalledTimes(calls);
  });
});

describe("WalkMemory leaf facts", () => {
  const facts = (over: Partial<LeafFacts["gateItems"][number]> = {}) =>
    ({
      gateItems: [
        {
          kind: "player",
          name: "Jackson Merrill",
          sportId: "sport-home",
          historyPlayerIds: ["p-hist"],
          preselect: { playerId: "p-1", sportId: "sport-home", sportValue: "Baseball", reason: "priorYearProduct" },
          ...over,
        },
      ],
    }) as unknown as LeafFacts;

  it("holds lookups while the facts load, then asks with the history and preselect riding on the first ask", async () => {
    const m = new WalkMemory();
    const f = deferred<LeafFacts>();
    m.loadFacts(() => f.promise);
    expect(m.factsLoading()).toBe(true);
    const run = vi.fn().mockResolvedValue({ status: "ready" });
    ask(m, run, "c1", "Jackson Merrill", "player", "sport-home");
    expect(run).not.toHaveBeenCalled();
    await act(async () => f.resolve(facts()));
    expect(m.factsLoading()).toBe(false);
    ask(m, run, "c1", "Jackson Merrill", "player", "sport-home");
    expect(run).toHaveBeenCalledWith({
      cardId: "c1",
      kind: "player",
      name: "Jackson Merrill",
      sportId: "sport-home",
      historyPlayerIds: ["p-hist"],
      preselect: { playerId: "p-1", sportId: "sport-home", sportValue: "Baseball", reason: "priorYearProduct" },
    });
  });

  it("a team name's ask never carries the player preselect", async () => {
    const m = new WalkMemory();
    m.loadFacts(async () => facts({ kind: "team", name: "Padres" }) as LeafFacts);
    await flush();
    const run = vi.fn().mockResolvedValue({ status: "ready" });
    ask(m, run, "c1", "Padres", "team", "sport-home");
    expect(run.mock.calls[0][0]).not.toHaveProperty("preselect");
  });

  it("facts that failed are not a claim: lookups go ahead without them", async () => {
    const m = new WalkMemory();
    m.loadFacts(() => Promise.reject(new Error("down")));
    await flush();
    expect(m.factsLoading()).toBe(false);
    const run = vi.fn().mockResolvedValue({ status: "ready" });
    ask(m, run);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][0]).not.toHaveProperty("preselect");
    expect(run.mock.calls[0][0]).not.toHaveProperty("historyPlayerIds");
  });

  it("is asked once per walk: a second load, or one after a failure, does nothing", async () => {
    const m = new WalkMemory();
    const run = vi.fn().mockRejectedValue(new Error("down"));
    m.loadFacts(run);
    m.loadFacts(run);
    await flush();
    m.loadFacts(run);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("a name is first asked in the facts' sport, else the set's", async () => {
    const m = new WalkMemory();
    m.loadFacts(async () => facts());
    await flush();
    expect(m.defaultSportFor("player", "Jackson Merrill", "sport-set" as never)).toBe("sport-home");
    expect(m.defaultSportFor("player", "Someone Else", "sport-set" as never)).toBe("sport-set");
  });
});

describe("WalkMemory answers on the open card", () => {
  it("remembers a ruling in the order given, forgets one, and drops everything when the walk leaves the card", () => {
    const m = new WalkMemory();
    m.rememberAnswer("c1", "player", "A One", { kind: "notEntity", printed: "A One" });
    m.rememberAnswer("c1", "player", "B Two", { kind: "notEntity", printed: "B Two" });
    m.rememberAnswer("c1", "team", "Padres", { kind: "linkTeam", printed: "Padres", teamId: "t1" as never });
    m.rememberAnswer("c2", "player", "C Three", { kind: "notEntity", printed: "C Three" });
    expect(m.answersOn("c1", "player").map((a) => a.printed)).toEqual(["A One", "B Two"]);
    expect(m.answersOn("c1", "team")).toHaveLength(1);
    m.forgetAnswer("c1", "player", "a one");
    expect(m.answersOn("c1", "player").map((a) => a.printed)).toEqual(["B Two"]);
    m.leaveCard("c1");
    expect(m.answersOn("c1", "player")).toEqual([]);
    expect(m.answersOn("c1", "team")).toEqual([]);
    expect(m.answersOn("c2", "player")).toHaveLength(1);
  });

  it("leaving a card keeps its lookups for the sitting (the walk may come back)", async () => {
    const m = new WalkMemory();
    ask(m, vi.fn().mockResolvedValue(READY));
    await flush();
    m.leaveCard("c1");
    expect(m.lookupFor("c1", "player", "Jackson Merrill", "sport-1")).toEqual(READY);
  });
});

describe("nothing is stored", () => {
  it("a whole sitting writes nothing to sessionStorage or localStorage", async () => {
    const m = new WalkMemory();
    m.loadFacts(async () => ({ gateItems: [] }) as unknown as LeafFacts);
    ask(m, vi.fn().mockResolvedValue(READY));
    await flush();
    ask(m, vi.fn().mockRejectedValue(new Error("x")), "c2");
    await flush();
    m.retry({ ...ids("c2"), kind: "player", name: "Jackson Merrill" }, vi.fn().mockResolvedValue(READY));
    m.rememberAnswer("c1", "player", "A One", { kind: "notEntity", printed: "A One" });
    m.keepPick("c1", { field: "teams", values: [], picked: ["Padres"], typed: false });
    m.forgetAnswer("c1", "player", "A One");
    m.dropPick("c1", "teams");
    m.leaveCard("c1");
    await flush();
    // Storage.prototype.setItem covers both areas.
    expect(localSet).not.toHaveBeenCalled();
    expect(window.sessionStorage.length).toBe(0);
    expect(window.localStorage.length).toBe(0);
  });
});

describe("hooks", () => {
  it("useNameLookup asks through the lookupTidyName action once its sport is known, and not before", async () => {
    const m = new WalkMemory();
    const { rerender } = renderHook(
      ({ sportId }: { sportId: string | undefined }) =>
        useNameLookup({ memory: m, cardId: "c1" as never, kind: "player", name: "Jackson Merrill", sportId: sportId as never }),
      { initialProps: { sportId: undefined as string | undefined } },
    );
    await flush();
    expect(actions["adapters.wikidata.lookupTidyName"]).not.toHaveBeenCalled();
    rerender({ sportId: "sport-1" });
    await flush();
    expect(actions["adapters.wikidata.lookupTidyName"]).toHaveBeenCalledTimes(1);
    expect(actions["adapters.wikidata.lookupTidyName"]).toHaveBeenCalledWith({
      cardId: "c1",
      kind: "player",
      name: "Jackson Merrill",
      sportId: "sport-1",
    });
  });

  it("useNameLookup's retry asks the same question again", async () => {
    const m = new WalkMemory();
    const run = (actions["adapters.wikidata.lookupTidyName"] = vi
      .fn()
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValueOnce(READY));
    const { result } = renderHook(() =>
      useNameLookup({ memory: m, cardId: "c1" as never, kind: "player", name: "Jackson Merrill", sportId: "sport-1" as never }),
    );
    await flush();
    expect(m.lookupFor("c1", "player", "Jackson Merrill", "sport-1")?.status).toBe("error");
    await act(async () => result.current.retry());
    await flush();
    expect(run).toHaveBeenCalledTimes(2);
    expect(m.lookupFor("c1", "player", "Jackson Merrill", "sport-1")).toEqual(READY);
  });

  it("useCardNameLookups asks for the open card's names and the next card's, each in its default sport", async () => {
    const m = new WalkMemory();
    renderHook(() =>
      useCardNameLookups(m, "sport-set" as never, [
        { id: "c1" as never, names: [{ kind: "player", name: "A One" }] },
        { id: "c2" as never, names: [{ kind: "team", name: "Padres" }] },
      ]),
    );
    await flush();
    const calls = actions["adapters.wikidata.lookupTidyName"].mock.calls.map((c) => c[0]);
    expect(calls).toEqual([
      { cardId: "c1", kind: "player", name: "A One", sportId: "sport-set" },
      { cardId: "c2", kind: "team", name: "Padres", sportId: "sport-set" },
    ]);
  });

  it("useLeafFacts asks tidyLeafFacts once for the leaf", async () => {
    const m = new WalkMemory();
    const run = (actions["selectorOptions.tidyLeafFacts"] = vi.fn().mockResolvedValue({ gateItems: [] }));
    const { rerender } = renderHook(() => useLeafFacts(m, "leaf-1" as never));
    rerender();
    await flush();
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith({ selectorOptionId: "leaf-1" });
  });

  it("useWalkMemory re-renders the caller when the memory changes, and works with no provider", async () => {
    const m = new WalkMemory();
    function Probe() {
      const memory = useWalkMemory();
      return <p>{`answers:${memory.answersOn("c1", "player").length}`}</p>;
    }
    render(
      <WalkMemoryProvider value={m}>
        <Probe />
      </WalkMemoryProvider>,
    );
    expect(screen.getByText("answers:0")).toBeTruthy();
    act(() => m.rememberAnswer("c1", "player", "A One", { kind: "notEntity", printed: "A One" }));
    expect(screen.getByText("answers:1")).toBeTruthy();
    render(<Probe />);
    expect(screen.getAllByText("answers:0")).toHaveLength(1);
  });
});

describe("pendingNamesOf", () => {
  it("lists a card's waiting players then teams, and skips blank names", () => {
    expect(
      pendingNamesOf({ pendingPlayerNames: ["A One", "  "], pendingTeamNames: ["Padres"] }),
    ).toEqual([
      { kind: "player", name: "A One" },
      { kind: "team", name: "Padres" },
    ]);
    expect(pendingNamesOf({})).toEqual([]);
  });
});
