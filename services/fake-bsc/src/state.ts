/**
 * Per-namespace, in-memory run state (CONTRACT.md, "Accounts and per-run
 * isolation"): listings, photos, orders, faults and misses. Run state is not
 * persisted; a restart is a reset (the boot log line makes one visible). The
 * one exception is replayable catalogue misses, which a `MissPersistence`
 * (src/missStore.ts) also keeps in the bucket (CONTRACT.md, "Durable misses").
 */
import { createHash, randomBytes } from "node:crypto";
import type { CanonicalRequest } from "./requestKey";
import type { CatalogueEndpoint } from "./sanitise";
import { pruneRules, type FaultRule } from "./faults";
import { matchesSelector, type NamespaceSelector } from "./namespace";

export interface Listing {
  cardId: string;
  condition: string;
  productId: string;
  availableQuantity: number;
  /** Dollars, as BSC's PUT takes them. */
  price: number;
  sellerSku: string | null;
  sellerImgFront: string | null;
  sellerImgBack: string | null;
  updatedTimestamp: string;
  /** The card fields the PUT row carried, echoed on the sheet. */
  card: Record<string, unknown> | null;
}

export interface Miss {
  key: string;
  kind: "catalogue" | "needs-model";
  method: string;
  /** Catalogue misses: the path. Needs-model misses: the template only. */
  path: string;
  endpoint?: CatalogueEndpoint;
  /** Catalogue misses only: the request to fetch. */
  request?: CanonicalRequest;
  count: number;
  firstSeen: string;
  lastSeen: string;
  nearMiss?: { key: string; diffPaths: string[] };
}

export interface NamespaceState {
  ns: string;
  sellerId: string;
  storeName: string;
  userId: string;
  listings: Map<string, Listing>;
  photos: number;
  /** BSC wire-shaped orders, newest last. */
  orders: Map<string, Record<string, unknown>>;
  faults: FaultRule[];
  misses: Map<string, Miss>;
  lastSeen: number;
}

export const MAX_NAMESPACES = 2000;
export const MAX_LISTINGS_PER_NAMESPACE = 20_000;
export const MAX_ORDERS_PER_NAMESPACE = 500;
export const MAX_MISSES_PER_NAMESPACE = 500;
/** Deployment prefixes holding misses from the background lane (`x-nb-fake-ns: <slug>-`). */
export const MAX_PREFIX_MISS_LISTS = 200;

/** Who a miss belongs to: one namespace, a deployment prefix, or nobody (no token, no header). */
export type MissOwner = { ns: string } | { prefix: string } | null;

/** Catalogue misses older than this (from `firstSeen`) leave memory and the bucket. */
export const MISS_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Where catalogue misses are kept durably (CONTRACT.md, "Durable misses").
 * The StateStore calls it as its lists change; every method settles and
 * never rejects (a failure is logged and leaves memory as it is).
 */
export interface MissPersistence {
  /** Keeps a catalogue miss, once per owner and key, if the replay allowlist accepts it. */
  save(owner: MissOwner, miss: Miss): Promise<void>;
  /** Removes one owner's object for a key. */
  remove(owner: MissOwner, key: string): Promise<void>;
  /** Removes every owner's object for a key (its recording was stored). */
  removeKey(key: string): Promise<void>;
  /** Removes every kept miss (`/__fake/reset-all`). */
  removeAll(): Promise<void>;
  /** Removes every kept miss first seen before `cutoffMs` (the TTL). */
  expire(cutoffMs: number): Promise<void>;
  /**
   * Boot: the kept misses that are still valid, current and unrecorded.
   * Anything expired, invalid, of another allowlist version, past a cap or
   * already recorded is deleted instead.
   */
  restore(nowMs: number, isRecorded: (key: string) => boolean): Promise<Array<{ owner: MissOwner; miss: Miss }>>;
}

export function listingKey(cardId: string, condition: string): string {
  return `${cardId}|${condition}`;
}

/**
 * The catalogue misses of a list: the recorder's to-do list, which a reset
 * keeps (a catalogue miss leaves only when its recording is stored).
 */
function catalogueMisses(map: Map<string, Miss>): Map<string, Miss> {
  const out = new Map<string, Miss>();
  for (const [k, m] of map) if (m.kind === "catalogue") out.set(k, m);
  return out;
}

function hash8(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 12);
}

export function newProductId(): string {
  return randomBytes(10).toString("hex");
}

export class StateStore {
  private readonly spaces = new Map<string, NamespaceState>();
  /** Misses from requests with no namespace (a card-listing with no BSC token). */
  private readonly anonMisses = new Map<string, Miss>();
  /** Misses from requests scoped by a deployment prefix, keyed by that prefix. */
  private readonly prefixMisses = new Map<string, Map<string, Miss>>();

  /** Persistence work started by list changes, awaited by `flushMisses`. */
  private readonly inflight = new Set<Promise<void>>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly persistence?: MissPersistence,
  ) {}

  private track(work: Promise<void> | undefined): void {
    if (!work) return;
    const p = work.catch(() => undefined).finally(() => this.inflight.delete(p));
    this.inflight.add(p);
  }

  /**
   * Waits for the persistence work started so far, at most `timeoutMs`.
   * True when it all settled in time. Never rejects: a slow store never
   * turns an answer into an error (the work carries on regardless).
   */
  async flushMisses(timeoutMs: number): Promise<boolean> {
    if (this.inflight.size === 0) return true;
    let timer: NodeJS.Timeout | undefined;
    const settled = await Promise.race([
      Promise.all([...this.inflight]).then(() => true),
      new Promise<boolean>((r) => {
        timer = setTimeout(() => r(false), timeoutMs);
        timer.unref();
      }),
    ]);
    clearTimeout(timer);
    return settled;
  }

  /** Persistence work still running (tests). */
  get pendingMissWrites(): number {
    return this.inflight.size;
  }

  /** The namespace's state, created on first use (evicting the least recent past the cap). */
  get(ns: string): NamespaceState {
    let s = this.spaces.get(ns);
    if (!s) {
      if (this.spaces.size >= MAX_NAMESPACES) this.evictOldest();
      const h = hash8(ns);
      s = {
        ns,
        sellerId: `fake-${h}`,
        storeName: `Fake Store ${h.slice(0, 6)}`,
        userId: `fake-user-${h}`,
        listings: new Map(),
        photos: 0,
        orders: new Map(),
        faults: [],
        misses: new Map(),
        lastSeen: this.now(),
      };
      this.spaces.set(ns, s);
    }
    s.lastSeen = this.now();
    return s;
  }

  peek(ns: string): NamespaceState | undefined {
    return this.spaces.get(ns);
  }

  private evictOldest(): void {
    let oldest: NamespaceState | undefined;
    for (const s of this.spaces.values()) if (!oldest || s.lastSeen < oldest.lastSeen) oldest = s;
    if (oldest) this.spaces.delete(oldest.ns);
  }

  /**
   * Clears run state for the selected namespaces (listings, photos, orders,
   * faults, needs-model misses), and a prefix selector also clears the
   * needs-model entries of the prefix miss lists inside it. Returns how many
   * namespaces.
   *
   * Catalogue misses survive a reset: they are the recorder's to-do list, a
   * reset runs before every E2E seed, and a miss confirmed but not yet
   * recorded must still be listed for the next recorder session. They leave
   * only through `clearMiss` (a stored recording), `resetAll`, the list caps
   * or a restart. They change no answer the fake gives, so keeping them
   * breaks no run's isolation.
   */
  reset(sel: NamespaceSelector): number {
    const prefixInside = (p: string) => (sel.prefix !== undefined ? p.startsWith(sel.prefix) : sel.ns === undefined);
    for (const [p, map] of [...this.prefixMisses]) {
      if (!prefixInside(p)) continue;
      const kept = catalogueMisses(map);
      if (kept.size > 0) this.prefixMisses.set(p, kept);
      else this.prefixMisses.delete(p);
    }
    let n = 0;
    for (const [ns, s] of [...this.spaces]) {
      if (matchesSelector(ns, sel)) {
        const kept = catalogueMisses(s.misses);
        this.spaces.delete(ns);
        if (kept.size > 0) this.get(ns).misses = kept;
        n += 1;
      }
    }
    return n;
  }

  /** Clears everything, kept misses included (their removal is tracked: `flushMisses`). */
  resetAll(): number {
    const n = this.spaces.size;
    this.spaces.clear();
    this.anonMisses.clear();
    this.prefixMisses.clear();
    this.track(this.persistence?.removeAll());
    return n;
  }

  /** Live fault rules for a namespace (expired and spent ones pruned). */
  faultsFor(ns: string): FaultRule[] {
    const s = this.spaces.get(ns);
    if (!s) return [];
    s.faults = pruneRules(s.faults, this.now());
    return s.faults;
  }

  /**
   * The live rules that name a card id, for card-listing calls with no BSC
   * token: every namespace's, or only those under `prefix` (the background
   * lane's `x-nb-fake-ns: <slug>-`).
   */
  cardScopedFaults(prefix?: string): FaultRule[] {
    const out: FaultRule[] = [];
    for (const s of this.spaces.values()) {
      if (prefix !== undefined && !s.ns.startsWith(prefix)) continue;
      s.faults = pruneRules(s.faults, this.now());
      for (const r of s.faults) if (r.match.cardId !== undefined) out.push(r);
    }
    return out;
  }

  recordMiss(owner: MissOwner, miss: Omit<Miss, "count" | "firstSeen" | "lastSeen">): Miss {
    const map = owner === null ? this.anonMisses : "ns" in owner ? this.get(owner.ns).misses : this.prefixList(owner.prefix);
    const at = new Date(this.now()).toISOString();
    const prev = map.get(miss.key);
    if (prev) {
      prev.count += 1;
      prev.lastSeen = at;
      if (miss.nearMiss) prev.nearMiss = miss.nearMiss;
      return prev;
    }
    if (map.size >= MAX_MISSES_PER_NAMESPACE) {
      const first = map.keys().next().value;
      if (first !== undefined) {
        const evicted = map.get(first);
        map.delete(first);
        if (evicted?.kind === "catalogue") this.track(this.persistence?.remove(owner, first));
      }
    }
    const m: Miss = { ...miss, count: 1, firstSeen: at, lastSeen: at };
    map.set(miss.key, m);
    // Kept once per owner and key; the 501 awaits it (`flushMisses`).
    if (m.kind === "catalogue") this.track(this.persistence?.save(owner, m));
    return m;
  }

  private prefixList(prefix: string): Map<string, Miss> {
    let map = this.prefixMisses.get(prefix);
    if (!map) {
      if (this.prefixMisses.size >= MAX_PREFIX_MISS_LISTS) {
        const first = this.prefixMisses.keys().next().value;
        if (first !== undefined) {
          for (const [k, m] of this.prefixMisses.get(first) ?? []) {
            if (m.kind === "catalogue") this.track(this.persistence?.remove({ prefix: first }, k));
          }
          this.prefixMisses.delete(first);
        }
      }
      map = new Map();
      this.prefixMisses.set(prefix, map);
    }
    return map;
  }

  /** Drops a miss everywhere once it has been recorded, kept copies included (tracked). */
  clearMiss(key: string): void {
    this.anonMisses.delete(key);
    for (const m of this.prefixMisses.values()) m.delete(key);
    for (const s of this.spaces.values()) s.misses.delete(key);
    this.track(this.persistence?.removeKey(key));
  }

  /**
   * Drops catalogue misses first seen more than `MISS_TTL_MS` ago, from
   * memory and (tracked) from the bucket. Returns how many.
   */
  expireMisses(): number {
    const cutoff = this.now() - MISS_TTL_MS;
    let n = 0;
    const sweep = (map: Map<string, Miss>): void => {
      for (const [k, m] of [...map]) {
        if (m.kind !== "catalogue") continue;
        const seen = Date.parse(m.firstSeen);
        if (Number.isNaN(seen) || seen >= cutoff) continue;
        map.delete(k);
        n += 1;
      }
    };
    sweep(this.anonMisses);
    for (const map of this.prefixMisses.values()) sweep(map);
    for (const s of this.spaces.values()) sweep(s.misses);
    // The bucket's own sweep also reaches objects with no list entry in memory.
    this.track(this.persistence?.expire(cutoff));
    return n;
  }

  /**
   * Boot: puts the kept misses back on their owners' lists (CONTRACT.md,
   * "Durable misses"). A miss already listed (seen again before the restore
   * finished) keeps its count and the earlier `firstSeen`. Never rejects; a
   * failed restore leaves memory as it is.
   */
  async restoreMisses(isRecorded: (key: string) => boolean): Promise<number> {
    if (!this.persistence) return 0;
    const kept = await this.persistence.restore(this.now(), isRecorded);
    let n = 0;
    for (const { owner, miss } of kept) {
      const map = owner === null ? this.anonMisses : "ns" in owner ? this.get(owner.ns).misses : this.prefixList(owner.prefix);
      const prev = map.get(miss.key);
      if (prev) {
        if (miss.firstSeen < prev.firstSeen) prev.firstSeen = miss.firstSeen;
        continue;
      }
      if (map.size >= MAX_MISSES_PER_NAMESPACE) continue;
      map.set(miss.key, { ...miss });
      n += 1;
    }
    return n;
  }

  /**
   * Misses for the selected namespaces, the prefix lists that overlap the
   * selection (a namespace or prefix under the list's prefix, or a list
   * inside the selected prefix), plus the anonymous ones.
   */
  listMisses(sel: NamespaceSelector): Array<Miss & { ns: string | null; prefix?: string }> {
    const out: Array<Miss & { ns: string | null; prefix?: string }> = [];
    for (const s of this.spaces.values()) {
      if (!matchesSelector(s.ns, sel)) continue;
      for (const m of s.misses.values()) out.push({ ...m, ns: s.ns });
    }
    for (const [prefix, map] of this.prefixMisses) {
      const overlaps =
        sel.ns !== undefined ? sel.ns.startsWith(prefix) : sel.prefix !== undefined ? prefix.startsWith(sel.prefix) || sel.prefix.startsWith(prefix) : true;
      if (!overlaps) continue;
      for (const m of map.values()) out.push({ ...m, ns: null, prefix });
    }
    for (const m of this.anonMisses.values()) out.push({ ...m, ns: null });
    return out.sort((a, b) => (a.firstSeen < b.firstSeen ? -1 : a.firstSeen > b.firstSeen ? 1 : 0));
  }
}
