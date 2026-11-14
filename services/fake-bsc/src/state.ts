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

export function listingKey(cardId: string, condition: string): string {
  return `${cardId}|${condition}`;
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

  /** Clears run state for the selected namespaces. Returns how many. */
  reset(sel: NamespaceSelector): number {
    let n = 0;
    for (const ns of [...this.spaces.keys()]) {
      if (matchesSelector(ns, sel)) {
        this.spaces.delete(ns);
        n += 1;
      }
    }
    return n;
  }

  resetAll(): number {
    const n = this.spaces.size;
    this.spaces.clear();
    this.anonMisses.clear();
    return n;
  }

  /** Live fault rules for a namespace (expired and spent ones pruned). */
  faultsFor(ns: string): FaultRule[] {
    const s = this.spaces.get(ns);
    if (!s) return [];
    s.faults = pruneRules(s.faults, this.now());
    return s.faults;
  }

  /** Every namespace's live rules that name a card id: for anonymous card-listing calls. */
  cardScopedFaults(): FaultRule[] {
    const out: FaultRule[] = [];
    for (const s of this.spaces.values()) {
      s.faults = pruneRules(s.faults, this.now());
      for (const r of s.faults) if (r.match.cardId !== undefined) out.push(r);
    }
    return out;
  }

  recordMiss(ns: string | null, miss: Omit<Miss, "count" | "firstSeen" | "lastSeen">): Miss {
    const map = ns === null ? this.anonMisses : this.get(ns).misses;
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

  /** Drops a miss everywhere once it has been recorded. */
  clearMiss(key: string): void {
    this.anonMisses.delete(key);
    for (const s of this.spaces.values()) s.misses.delete(key);
  }

  /** Misses for the selected namespaces, plus the anonymous ones. */
  listMisses(sel: NamespaceSelector): Array<Miss & { ns: string | null }> {
    const out: Array<Miss & { ns: string | null }> = [];
    for (const s of this.spaces.values()) {
      if (!matchesSelector(s.ns, sel)) continue;
      for (const m of s.misses.values()) out.push({ ...m, ns: s.ns });
    }
    for (const m of this.anonMisses.values()) out.push({ ...m, ns: null });
    return out.sort((a, b) => (a.firstSeen < b.firstSeen ? -1 : a.firstSeen > b.firstSeen ? 1 : 0));
  }
}
