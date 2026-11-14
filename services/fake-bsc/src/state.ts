/**
 * Per-namespace, in-memory run state (CONTRACT.md, "Accounts and per-run
 * isolation"): listings, photos, orders, faults and misses. Nothing here is
 * persisted; a restart is a reset (the boot log line makes one visible).
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

  constructor(private readonly now: () => number = Date.now) {}

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

  resetAll(): number {
    const n = this.spaces.size;
    this.spaces.clear();
    this.anonMisses.clear();
    this.prefixMisses.clear();
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
      if (first !== undefined) map.delete(first);
    }
    const m: Miss = { ...miss, count: 1, firstSeen: at, lastSeen: at };
    map.set(miss.key, m);
    return m;
  }

  private prefixList(prefix: string): Map<string, Miss> {
    let map = this.prefixMisses.get(prefix);
    if (!map) {
      if (this.prefixMisses.size >= MAX_PREFIX_MISS_LISTS) {
        const first = this.prefixMisses.keys().next().value;
        if (first !== undefined) this.prefixMisses.delete(first);
      }
      map = new Map();
      this.prefixMisses.set(prefix, map);
    }
    return map;
  }

  /** Drops a miss everywhere once it has been recorded. */
  clearMiss(key: string): void {
    this.anonMisses.delete(key);
    for (const m of this.prefixMisses.values()) m.delete(key);
    for (const s of this.spaces.values()) s.misses.delete(key);
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
