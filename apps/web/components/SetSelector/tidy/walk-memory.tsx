import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useAction } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { normalizeEntityName } from "@/lib/entities/normalize-name";

/**
 * NEO-656 — what the Tidy Up walk keeps IN MEMORY, for the sitting.
 *
 * The card is the only record of its names: nothing here is stored, in
 * Convex, in `sessionStorage` or in `localStorage`. It is one object per open
 * walk (the Maps live on it, not in React state), and the walk dies with it.
 *
 *  - **Leaf facts** (`selectorOptions.tidyLeafFacts`, asked once when the walk
 *    opens): per pending name, the set-history picks, the obvious candidate
 *    (the preselect) and the team rows the name reached. Missing data is not a
 *    claim: a facts call that failed holds nothing back.
 *  - **Name lookups** (`adapters/wikidata.lookupTidyName`): what Wikidata (and
 *    the live same-name players) said about a name, keyed
 *    `cardId|kind|name|sportId`. A response lands under its own key, so one for
 *    a question the operator has since changed (the Sport chip) is never read.
 *  - **What the operator answered while a card is open**: "Not a player" (so
 *    Edit can take it back), a team link (so "Apply to all" knows what to
 *    copy) and a Sources pick (so "Using", Change and Apply-to-same still
 *    work once the card no longer carries the disagreement). Dropped when the
 *    walk leaves the card.
 */

type LookupResult = FunctionReturnType<typeof api.adapters.wikidata.lookupTidyName>;
type LookupArgs = {
  cardId: Id<"cardChecklist">;
  kind: "player" | "team";
  name: string;
  sportId: Id<"selectorOptions">;
  historyPlayerIds?: Array<Id<"players">>;
  preselect?: {
    playerId: Id<"players">;
    sportId: Id<"selectorOptions">;
    sportValue: string;
    reason: "priorYearProduct" | "onlyNamesake";
  };
  /** A team's partial answer already held for this key (ESPN's half); the new result is laid over it. */
  heldEnrichment?: NonNullable<LookupResult["enrichment"]>;
};
type AskArgs = Omit<LookupArgs, "historyPlayerIds" | "preselect" | "heldEnrichment">;
export type LookupRunner = (args: LookupArgs) => Promise<LookupResult>;

/** What a name's lookup said. `pending` is "asked, not back yet" (and "held for the facts"). */
export type NameLookup = {
  status: "pending" | "ready" | "error";
  enrichment?: NonNullable<LookupResult["enrichment"]>;
};

export type LeafFacts = FunctionReturnType<typeof api.selectorOptions.tidyLeafFacts>;
export type GateItem = LeafFacts["gateItems"][number];
type FactsState = "idle" | "loading" | "ready" | "failed";

/** An answer given on the open card that the card itself no longer shows. */
export type OpenAnswer =
  | { kind: "notEntity"; printed: string }
  | { kind: "linkTeam"; printed: string; teamId: Id<"teams"> };

/** One source disagreement the operator settled on the open card. */
export type KeptPick = {
  field: "players" | "teams";
  /** What the sources said (the entry the card used to carry). */
  values: ReadonlyArray<{ value: readonly string[]; sources: readonly string[] }>;
  /** What the operator picked. */
  picked: readonly string[];
  typed: boolean;
};

/** The one spelling of "this name" the walk keys on: its kind and the shared matcher's key. */
export function nameKeyOf(kind: "player" | "team", name: string): string {
  return `${kind}|${normalizeEntityName(name.trim())}`;
}

/** One lookup request: `cardId|kind|key|sportId`. */
export function lookupKeyOf(
  cardId: string,
  kind: "player" | "team",
  name: string,
  sportId: string,
): string {
  return `${cardId}|${nameKeyOf(kind, name)}|${sportId}`;
}

export class WalkMemory {
  private lookups = new Map<string, NameLookup>();
  private answers = new Map<string, OpenAnswer>();
  private picks = new Map<string, KeptPick>();
  private gateItems = new Map<string, GateItem>();
  private factsState: FactsState = "idle";
  private version = 0;
  private listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getVersion = (): number => this.version;
  private bump() {
    this.version += 1;
    for (const listener of [...this.listeners]) listener();
  }

  // ── leaf facts ────────────────────────────────────────────────────────────
  /** Asked once per walk: a second call, or one after a failure, does nothing. */
  loadFacts(run: () => Promise<LeafFacts>): void {
    if (this.factsState !== "idle") return;
    this.factsState = "loading";
    this.bump();
    run().then(
      (facts) => {
        for (const item of facts.gateItems) this.gateItems.set(nameKeyOf(item.kind, item.name), item);
        this.factsState = "ready";
        this.bump();
      },
      () => {
        // Not a claim: the normal rules go on without it.
        this.factsState = "failed";
        this.bump();
      },
    );
  }
  /** Lookups wait for the facts: the history picks and the preselect ride on the first ask. */
  factsLoading(): boolean {
    return this.factsState === "loading";
  }
  gateItemFor(kind: "player" | "team", name: string): GateItem | undefined {
    return this.gateItems.get(nameKeyOf(kind, name));
  }
  /** The sport a name is first asked in: the facts' (an auto-linked player's home sport), else the set's. */
  defaultSportFor(
    kind: "player" | "team",
    name: string,
    setSportId: Id<"selectorOptions"> | undefined,
  ): Id<"selectorOptions"> | undefined {
    return this.gateItemFor(kind, name)?.sportId ?? setSportId;
  }

  // ── lookups ───────────────────────────────────────────────────────────────
  lookupFor(cardId: string, kind: "player" | "team", name: string, sportId: string): NameLookup | undefined {
    return this.lookups.get(lookupKeyOf(cardId, kind, name, sportId));
  }

  /** Ask once per key. Held while the facts load; the caller asks again when they land. */
  ask(
    args: AskArgs,
    run: LookupRunner,
    heldEnrichment?: NonNullable<LookupResult["enrichment"]>,
  ): void {
    if (this.factsLoading()) return;
    const key = lookupKeyOf(args.cardId, args.kind, args.name, args.sportId);
    if (this.lookups.has(key)) return;
    this.lookups.set(key, { status: "pending" });
    this.bump();
    const item = this.gateItemFor(args.kind, args.name);
    const history = item?.historyPlayerIds ?? [];
    const request: LookupArgs = {
      ...args,
      ...(history.length > 0 ? { historyPlayerIds: [...history] } : {}),
      ...(args.kind === "player" && item?.preselect ? { preselect: item.preselect } : {}),
      ...(args.kind === "team" && heldEnrichment ? { heldEnrichment } : {}),
    };
    let answered: Promise<LookupResult>;
    try {
      answered = run(request);
    } catch {
      answered = Promise.reject(new Error("lookup"));
    }
    answered.then(
      (result) => {
        this.lookups.set(key, {
          status: result.status,
          ...(result.enrichment ? { enrichment: result.enrichment } : {}),
        });
        this.bump();
      },
      () => {
        // A failed try never downgrades a team's partial answer already held
        // (NEO-301): the server keeps it when the lookup says `error`, and so
        // does this when the call itself fails.
        this.lookups.set(
          key,
          heldEnrichment && args.kind === "team"
            ? { status: "ready", enrichment: heldEnrichment }
            : { status: "error" },
        );
        this.bump();
      },
    );
  }

  /**
   * "Try again": forget the answer and ask once more. A team's partial answer
   * held for this key (ESPN's half) goes with the new ask, so the result is
   * laid over it and never replaces it (`lookupTidyName`'s `heldEnrichment`).
   */
  retry(args: AskArgs, run: LookupRunner): void {
    const key = lookupKeyOf(args.cardId, args.kind, args.name, args.sportId);
    const held = args.kind === "team" ? this.lookups.get(key) : undefined;
    this.lookups.delete(key);
    this.ask(args, run, held?.status === "ready" ? held.enrichment : undefined);
  }

  // ── answers given on the open card ────────────────────────────────────────
  rememberAnswer(cardId: string, kind: "player" | "team", printed: string, answer: OpenAnswer): void {
    this.answers.set(`${cardId}|${nameKeyOf(kind, printed)}`, answer);
    this.bump();
  }
  forgetAnswer(cardId: string, kind: "player" | "team", printed: string): void {
    if (this.answers.delete(`${cardId}|${nameKeyOf(kind, printed)}`)) this.bump();
  }
  /** What was answered on this card, in the order it was answered. */
  answersOn(cardId: string, kind: "player" | "team"): OpenAnswer[] {
    const prefix = `${cardId}|${kind}|`;
    return [...this.answers.entries()].filter(([key]) => key.startsWith(prefix)).map(([, a]) => a);
  }

  // ── a Sources pick ────────────────────────────────────────────────────────
  keepPick(cardId: string, pick: KeptPick): void {
    this.picks.set(`${cardId}|${pick.field}`, pick);
    this.bump();
  }
  pickFor(cardId: string, field: "players" | "teams"): KeptPick | undefined {
    return this.picks.get(`${cardId}|${field}`);
  }
  dropPick(cardId: string, field: "players" | "teams"): void {
    if (this.picks.delete(`${cardId}|${field}`)) this.bump();
  }

  /** The walk has left this card: what it held for it goes. Lookups stay for the sitting. */
  leaveCard(cardId: string): void {
    let changed = false;
    for (const key of [...this.answers.keys()]) {
      if (key.startsWith(`${cardId}|`)) changed = this.answers.delete(key) || changed;
    }
    for (const key of [...this.picks.keys()]) {
      if (key.startsWith(`${cardId}|`)) changed = this.picks.delete(key) || changed;
    }
    if (changed) this.bump();
  }
}

const WalkMemoryContext = createContext<WalkMemory | null>(null);
export const WalkMemoryProvider = WalkMemoryContext.Provider;

/** One memory for the open walk. */
export function useWalkMemoryStore(): WalkMemory {
  const [memory] = useState(() => new WalkMemory());
  return memory;
}

/**
 * The walk's memory, re-rendering the caller whenever it changes. A tile
 * rendered alone (no walk) gets a memory of its own, so nothing here needs a
 * provider to run.
 */
export function useWalkMemory(): WalkMemory {
  const provided = useContext(WalkMemoryContext);
  const [own] = useState(() => (provided ? null : new WalkMemory()));
  const memory = provided ?? own!;
  useSyncExternalStore(memory.subscribe, memory.getVersion, memory.getVersion);
  return memory;
}

/** `lookupTidyName` as a stable function: the latest `useAction` result, behind one identity. */
export function useLookupRunner(): LookupRunner {
  const lookup = useAction(api.adapters.wikidata.lookupTidyName);
  const ref = useRef(lookup);
  useEffect(() => {
    ref.current = lookup;
  });
  const [runner] = useState<LookupRunner>(() => (args: LookupArgs) => ref.current(args));
  return runner;
}

/**
 * The walk asks once, when it opens: what the set's history and the name rules
 * say about the pending names of this leaf. Held in memory (`WalkMemory`).
 */
export function useLeafFacts(memory: WalkMemory, leafId: Id<"selectorOptions">) {
  const tidyLeafFacts = useAction(api.selectorOptions.tidyLeafFacts);
  const ref = useRef(tidyLeafFacts);
  useEffect(() => {
    ref.current = tidyLeafFacts;
  });
  useEffect(() => {
    memory.loadFacts(() => ref.current({ selectorOptionId: leafId }));
  }, [memory, leafId]);
}

/** A pending name on a card, as the lookup hooks take it. */
export type PendingName = { kind: "player" | "team"; name: string };

export function pendingNamesOf(row: {
  pendingPlayerNames?: readonly string[];
  pendingTeamNames?: readonly string[];
}): PendingName[] {
  return [
    ...(row.pendingPlayerNames ?? []).map((name) => ({ kind: "player" as const, name })),
    ...(row.pendingTeamNames ?? []).map((name) => ({ kind: "team" as const, name })),
  ].filter((n) => n.name.trim().length > 0);
}

/**
 * The open card's names are asked about when it opens, and the next card's as
 * well, so its tile has an answer by the time Save & next gets there. One try
 * per question; the tile offers Try again on an error. Each name is asked in
 * its own default sport (the facts', else the set's). The walk does not wait
 * on any of them.
 */
export function useCardNameLookups(
  memory: WalkMemory,
  setSportId: Id<"selectorOptions"> | undefined,
  cards: ReadonlyArray<{ id: Id<"cardChecklist">; names: readonly PendingName[] }>,
) {
  const run = useLookupRunner();
  useSyncExternalStore(memory.subscribe, memory.getVersion, memory.getVersion);
  const loading = memory.factsLoading();
  // The ids and names, flattened: the effect re-runs on what is asked, not on identity.
  const wanted = cards
    .flatMap((c) => c.names.map((n) => `${c.id}\u001f${n.kind}\u001f${n.name}`))
    .join("\u001e");
  useEffect(() => {
    if (loading) return;
    for (const card of cards) {
      for (const n of card.names) {
        const sportId = memory.defaultSportFor(n.kind, n.name, setSportId);
        if (sportId) memory.ask({ cardId: card.id, kind: n.kind, name: n.name, sportId }, run);
      }
    }
    // `wanted` stands for `cards`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memory, run, loading, setSportId, wanted]);
}

/**
 * One name's lookup for a tile: asked once its sport is known (and the facts
 * are in), read back by the same key. A change of sport is a new key, so the
 * answer to the old question is never shown for the new one.
 */
export function useNameLookup({
  memory,
  cardId,
  kind,
  name,
  sportId,
}: {
  memory: WalkMemory;
  cardId: Id<"cardChecklist">;
  kind: "player" | "team";
  name: string;
  sportId: Id<"selectorOptions"> | undefined;
}): { lookup: NameLookup | undefined; retry: () => void } {
  const run = useLookupRunner();
  const loading = memory.factsLoading();
  useEffect(() => {
    if (loading || !sportId) return;
    memory.ask({ cardId, kind, name, sportId }, run);
  }, [memory, run, loading, cardId, kind, name, sportId]);
  return {
    lookup: sportId ? memory.lookupFor(cardId, kind, name, sportId) : undefined,
    retry: () => {
      if (sportId) memory.retry({ cardId, kind, name, sportId }, run);
    },
  };
}
