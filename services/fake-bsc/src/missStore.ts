/**
 * Durable catalogue misses (CONTRACT.md, "Durable misses"): the recorder's
 * to-do list survives the fake scaling to zero.
 *
 * One small object per (owner, request key):
 *
 *   misses/v<allowlistVersion>/ns/<ns>/<key>.json
 *   misses/v<allowlistVersion>/prefix/<prefix>/<key>.json
 *   misses/v<allowlistVersion>/anon/<key>.json
 *
 * Only a catalogue miss the recorder's replay allowlist accepts is kept, and
 * only what the recorder needs to replay it (no count, no near miss, nothing
 * else from the request). Writes are create-only, so an owner's key is
 * written once however often it is missed. Every delete names the object's
 * generation (the bucket is versioned; a plain delete would leave a
 * noncurrent version that its lifecycle rule never reaps).
 *
 * Every public method settles and never rejects: a store failure is logged
 * and leaves the in-memory miss list as it is.
 */
import { canonicalRequest, requestKey, type CanonicalRequest, type QueryPairs } from "./requestKey";
import { catalogueEndpointFor, SANITISE_ALLOWLIST_VERSION, type CatalogueEndpoint } from "./sanitise";
import { replayRefusal } from "./replayAllowlist";
import { NAMESPACE_RE } from "./namespace";
import { MAX_MISSES_PER_NAMESPACE, MISS_TTL_MS, type Miss, type MissOwner, type MissPersistence } from "./state";
import type { MissObjectStore } from "./store/types";
import { log } from "./log";

export const MISS_OBJECT_ROOT = "misses/";
/** Most kept misses in all; past it the oldest object is removed. */
export const MAX_PERSISTED_MISSES = 2000;
/** Most objects a boot restore lists (kept misses plus stragglers to delete). */
export const MAX_RESTORE_LISTING = 5000;
/** Store calls in flight at once during a restore or a sweep. */
const CONCURRENCY = 16;
/**
 * Create rate (CONTRACT.md, "Durable misses"): any caller-key holder can miss
 * a new allowlisted key, so creates are rate limited process-wide and per
 * owner. Over the limit the miss stays in memory only.
 */
export const MISS_CREATES_PER_MINUTE = 60;
export const MISS_CREATES_BURST = 60;
export const MISS_CREATES_PER_OWNER_PER_MINUTE = 20;
/** Owners whose create bucket is tracked at once (least recently used dropped). */
const MAX_OWNER_BUCKETS = 2000;
/** At most one `miss_persist_skipped` line this often; it carries the count since the last. */
const SKIP_LOG_INTERVAL_MS = 60_000;
const VERSION_PREFIX_RE = /^misses\/v(\d{1,6})\//;

const KEY_RE = /^[0-9a-f]{64}$/;
const PREFIX_RE = /^[a-z0-9][a-z0-9-]{1,98}-$/;
const OBJECT_RE = /^misses\/v(\d{1,6})\/(?:ns\/([a-z0-9][a-z0-9-]{0,99})|prefix\/([a-z0-9][a-z0-9-]{1,98}-)|anon)\/([0-9a-f]{64})\.json$/;

/** The kept form of a miss. */
export interface MissRecord {
  schema: 1;
  allowlistVersion: number;
  owner: { ns: string } | { prefix: string } | null;
  key: string;
  endpoint: CatalogueEndpoint;
  method: string;
  path: string;
  request: CanonicalRequest;
  firstSeen: string;
}

function validOwner(owner: MissOwner): boolean {
  if (owner === null) return true;
  if ("ns" in owner) return NAMESPACE_RE.test(owner.ns);
  return PREFIX_RE.test(owner.prefix);
}

/** The object a miss is kept in, for the current allowlist version. Null for an owner or key that cannot name one. */
export function missObjectName(owner: MissOwner, key: string, allowlistVersion = SANITISE_ALLOWLIST_VERSION): string | null {
  if (!KEY_RE.test(key) || !validOwner(owner)) return null;
  const who = owner === null ? "anon" : "ns" in owner ? `ns/${owner.ns}` : `prefix/${owner.prefix}`;
  return `${MISS_OBJECT_ROOT}v${allowlistVersion}/${who}/${key}.json`;
}

/** Reads an object name back: its allowlist version, owner and key, or null. */
export function parseMissObjectName(name: string): { allowlistVersion: number; owner: MissOwner; key: string } | null {
  const m = OBJECT_RE.exec(name);
  if (!m) return null;
  const owner: MissOwner = m[2] !== undefined ? { ns: m[2] } : m[3] !== undefined ? { prefix: m[3] } : null;
  return { allowlistVersion: Number(m[1]), owner, key: m[4] };
}

function sameOwner(a: MissOwner, b: unknown): boolean {
  if (a === null) return b === null;
  if (!b || typeof b !== "object" || Array.isArray(b)) return false;
  const o = b as Record<string, unknown>;
  const keys = Object.keys(o);
  if (keys.length !== 1) return false;
  return "ns" in a ? o.ns === a.ns : o.prefix === a.prefix;
}

/** The record to keep for a miss, or null when it may not be kept (with the reason). */
export function missRecordFor(owner: MissOwner, miss: Miss): { ok: true; record: MissRecord } | { ok: false; reason: string } {
  if (miss.kind !== "catalogue" || !miss.request || !miss.endpoint) return { ok: false, reason: "not_catalogue" };
  if (!validOwner(owner)) return { ok: false, reason: "bad_owner" };
  const refusal = replayRefusal(miss.request);
  if (refusal) return { ok: false, reason: refusal };
  const request = canonicalRequest(miss.request);
  if (requestKey(request) !== miss.key) return { ok: false, reason: "key_mismatch" };
  return {
    ok: true,
    record: {
      schema: 1,
      allowlistVersion: SANITISE_ALLOWLIST_VERSION,
      owner: owner === null ? null : "ns" in owner ? { ns: owner.ns } : { prefix: owner.prefix },
      key: miss.key,
      endpoint: miss.endpoint,
      method: request.method,
      path: request.path,
      request: { method: request.method, path: request.path, query: request.query, body: request.body },
      firstSeen: miss.firstSeen,
    },
  };
}

/**
 * Validates a kept object read back from the store against the name it was
 * read from. The key is recomputed, never trusted, and the request must still
 * pass the replay allowlist. Null when it is not a miss this fake would keep.
 */
export function readMissRecord(name: string, value: unknown): { owner: MissOwner; miss: Miss } | null {
  const at = parseMissObjectName(name);
  if (!at || at.allowlistVersion !== SANITISE_ALLOWLIST_VERSION) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  if (r.schema !== 1 || r.allowlistVersion !== SANITISE_ALLOWLIST_VERSION || r.key !== at.key) return null;
  if (!sameOwner(at.owner, r.owner)) return null;
  const q = r.request as Record<string, unknown> | undefined;
  if (!q || typeof q !== "object" || typeof q.method !== "string" || typeof q.path !== "string") return null;
  if (q.query !== undefined && !(Array.isArray(q.query) && q.query.every((p) => Array.isArray(p) && p.length === 2 && p.every((x) => typeof x === "string")))) return null;
  const request = canonicalRequest({ method: q.method, path: q.path, query: (q.query as QueryPairs | undefined) ?? [], body: q.body });
  if (requestKey(request) !== at.key || replayRefusal(request) !== null) return null;
  const endpoint = catalogueEndpointFor(request.method, request.path);
  if (!endpoint || r.endpoint !== endpoint) return null;
  if (typeof r.firstSeen !== "string" || Number.isNaN(Date.parse(r.firstSeen))) return null;
  const firstSeen = new Date(Date.parse(r.firstSeen)).toISOString();
  return {
    owner: at.owner,
    miss: { key: at.key, kind: "catalogue", method: request.method, path: request.path, endpoint, request, count: 1, firstSeen, lastSeen: firstSeen },
  };
}

interface Entry {
  owner: MissOwner;
  key: string;
  firstSeenMs: number;
  /** Null until the create answers, or when the object existed before this process wrote it. */
  generation: string | null;
}

async function inBatches<T>(items: readonly T[], fn: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += CONCURRENCY) await Promise.all(items.slice(i, i + CONCURRENCY).map(fn));
}

function errorName(err: unknown): string {
  return err instanceof Error ? err.name : "unknown";
}

/**
 * A token bucket: `capacity` tokens, refilled at `perMinute`. `take` spends
 * one when there is one.
 */
export class TokenBucket {
  private tokens: number;
  private at: number;

  constructor(
    private readonly capacity: number,
    private readonly perMinute: number,
    nowMs: number,
  ) {
    this.tokens = capacity;
    this.at = nowMs;
  }

  private refill(nowMs: number): void {
    if (nowMs > this.at) {
      this.tokens = Math.min(this.capacity, this.tokens + ((nowMs - this.at) * this.perMinute) / 60_000);
      this.at = nowMs;
    }
  }

  has(nowMs: number): boolean {
    this.refill(nowMs);
    return this.tokens >= 1;
  }

  take(nowMs: number): boolean {
    if (!this.has(nowMs)) return false;
    this.tokens -= 1;
    return true;
  }
}

export interface DurableMissesOptions {
  /** Cap on kept misses in all (default 2,000). */
  maxPersisted?: number;
  /** Creates a minute, process-wide (default 60), and the burst (default 60). */
  createsPerMinute?: number;
  createsBurst?: number;
  /** Creates a minute per owner (default 20; its burst is the same number). */
  createsPerOwnerPerMinute?: number;
  /** The clock the rate limit reads (default Date.now). */
  now?: () => number;
  /** Cap on objects a restore lists (default 5,000). */
  maxListing?: number;
}

/** The bucket-backed `MissPersistence` the server runs with. */
export class DurableMisses implements MissPersistence {
  /** Every kept object this process knows of, by object name. */
  private readonly index = new Map<string, Entry>();
  /** One chain of store calls per object name, so a delete waits for its create. */
  private readonly chains = new Map<string, Promise<void>>();
  private readonly maxPersisted: number;
  private readonly maxListing: number;

  constructor(
    private readonly store: MissObjectStore,
    opts: DurableMissesOptions = {},
  ) {
    this.maxPersisted = opts.maxPersisted ?? MAX_PERSISTED_MISSES;
    this.maxListing = opts.maxListing ?? MAX_RESTORE_LISTING;
    this.now = opts.now ?? Date.now;
    this.perOwnerPerMinute = opts.createsPerOwnerPerMinute ?? MISS_CREATES_PER_OWNER_PER_MINUTE;
    this.global = new TokenBucket(opts.createsBurst ?? MISS_CREATES_BURST, opts.createsPerMinute ?? MISS_CREATES_PER_MINUTE, this.now());
  }

  private readonly now: () => number;
  private readonly perOwnerPerMinute: number;
  private readonly global: TokenBucket;
  private readonly ownerBuckets = new Map<string, TokenBucket>();
  private skipped = 0;
  private lastSkipLog = -Infinity;

  /**
   * Spends one create from the process-wide bucket and the owner's, or none
   * when either is empty. A refusal is logged at most once a minute, as a count.
   */
  private allowCreate(owner: MissOwner): boolean {
    const t = this.now();
    const who = owner === null ? "anon" : "ns" in owner ? `ns:${owner.ns}` : `prefix:${owner.prefix}`;
    let mine = this.ownerBuckets.get(who);
    if (mine) this.ownerBuckets.delete(who); // re-inserted below: most recent last
    else mine = new TokenBucket(this.perOwnerPerMinute, this.perOwnerPerMinute, t);
    this.ownerBuckets.set(who, mine);
    if (this.ownerBuckets.size > MAX_OWNER_BUCKETS) {
      const first = this.ownerBuckets.keys().next().value;
      if (first !== undefined) this.ownerBuckets.delete(first);
    }
    const globalOk = this.global.has(t);
    const ownerOk = mine.has(t);
    if (globalOk && ownerOk) {
      this.global.take(t);
      mine.take(t);
      return true;
    }
    this.skipped += 1;
    if (t - this.lastSkipLog >= SKIP_LOG_INTERVAL_MS) {
      log("miss_persist_skipped", { reason: "rate", scope: globalOk ? "owner" : "global", skipped: this.skipped });
      this.skipped = 0;
      this.lastSkipLog = t;
    }
    return false;
  }

  /** How many kept misses this process knows of (tests, health). */
  get size(): number {
    return this.index.size;
  }

  /** The object names this process knows of (tests). */
  names(): string[] {
    return [...this.index.keys()].sort();
  }

  private serial(name: string, work: () => Promise<void>): Promise<void> {
    const prev = this.chains.get(name) ?? Promise.resolve();
    const next = prev.then(work).catch(() => undefined);
    this.chains.set(name, next);
    return next.finally(() => {
      if (this.chains.get(name) === next) this.chains.delete(name);
    });
  }

  /** The live generation of an object this process did not create, or null when it is gone. */
  private async liveGeneration(name: string): Promise<string | null> {
    const found = await this.store.listVersions(name, 10);
    return found.find((v) => v.name === name)?.generation ?? null;
  }

  private deleteObject(name: string, entry: { generation: string | null }, reason: string): Promise<void> {
    return this.serial(name, async () => {
      const started = Date.now();
      try {
        // Read after the chain: a create queued before this delete has set it.
        const generation = entry.generation ?? (await this.liveGeneration(name));
        if (generation !== null) await this.store.deleteVersion(name, generation);
      } catch (err) {
        log("miss_delete_failed", { reason, error: errorName(err), ms: Date.now() - started });
      }
    });
  }

  private forget(name: string, reason: string): Promise<void> {
    const entry = this.index.get(name);
    if (!entry) return Promise.resolve();
    this.index.delete(name);
    return this.deleteObject(name, entry, reason);
  }

  private oldestName(except: string): string | undefined {
    let oldest: [string, Entry] | undefined;
    for (const e of this.index) if (e[0] !== except && (!oldest || e[1].firstSeenMs < oldest[1].firstSeenMs)) oldest = e;
    return oldest?.[0];
  }

  async save(owner: MissOwner, miss: Miss): Promise<void> {
    const read = missRecordFor(owner, miss);
    if (!read.ok) return;
    const name = missObjectName(owner, miss.key);
    if (name === null || this.index.has(name)) return;
    // Over the create rate the miss stays in memory only; a later miss of the key tries again.
    if (!this.allowCreate(owner)) return;
    const entry: Entry = { owner, key: miss.key, firstSeenMs: Date.parse(miss.firstSeen), generation: null };
    this.index.set(name, entry);
    const work: Promise<void>[] = [];
    while (this.index.size > this.maxPersisted) {
      const oldest = this.oldestName(name);
      if (oldest === undefined) break;
      work.push(this.forget(oldest, "cap"));
    }
    work.push(
      this.serial(name, async () => {
        const started = Date.now();
        try {
          const generation = await this.store.createOnce(name, read.record);
          // null: the object was already there (written before a restart, or
          // by a retry after a lost answer); its generation is looked up
          // when it is deleted.
          if (this.index.get(name) === entry) entry.generation = generation;
          log("miss_persisted", { endpoint: read.record.endpoint, created: generation !== null, ms: Date.now() - started });
        } catch (err) {
          // Not kept: a later miss of the same key tries again.
          if (this.index.get(name) === entry) this.index.delete(name);
          log("miss_persist_failed", { endpoint: read.record.endpoint, error: errorName(err), ms: Date.now() - started });
        }
      }),
    );
    await Promise.all(work);
  }

  async remove(owner: MissOwner, key: string): Promise<void> {
    const name = missObjectName(owner, key);
    if (name !== null) await this.forget(name, "evicted");
  }

  async removeKey(key: string): Promise<void> {
    const names = [...this.index].filter(([, e]) => e.key === key).map(([n]) => n);
    await Promise.all(names.map((n) => this.forget(n, "recorded")));
  }

  async expire(cutoffMs: number): Promise<void> {
    const names = [...this.index].filter(([, e]) => e.firstSeenMs < cutoffMs).map(([n]) => n);
    await inBatches(names, (n) => this.forget(n, "expired"));
  }

  async removeAll(): Promise<void> {
    const known = [...this.index.keys()];
    await inBatches(known, (n) => this.forget(n, "reset_all"));
    // Objects this process never indexed (a failed restore, another instance).
    try {
      const strays = await this.store.listVersions(MISS_OBJECT_ROOT, this.maxListing);
      await inBatches(strays, (v) => this.deleteObject(v.name, { generation: v.generation }, "reset_all"));
    } catch (err) {
      log("miss_delete_failed", { reason: "reset_all_listing", error: errorName(err) });
    }
  }

  async restore(nowMs: number, isRecorded: (key: string) => boolean): Promise<Array<{ owner: MissOwner; miss: Miss }>> {
    const started = Date.now();
    let listed;
    try {
      listed = await this.store.listVersions(MISS_OBJECT_ROOT, this.maxListing);
    } catch (err) {
      log("misses_restore_failed", { error: errorName(err), ms: Date.now() - started });
      return [];
    }
    const cutoff = nowMs - MISS_TTL_MS;
    const kept: Array<{ name: string; generation: string; owner: MissOwner; miss: Miss }> = [];
    const drop: Array<{ name: string; generation: string; reason: string }> = [];
    let failedReads = 0;
    let newer = 0;
    await inBatches(listed, async (v) => {
      // A newer allowlist version belongs to a newer revision (overlapping
      // revisions, or a rollback): neither restored nor deleted. Older ones go.
      const version = VERSION_PREFIX_RE.exec(v.name);
      if (version && Number(version[1]) > SANITISE_ALLOWLIST_VERSION) {
        newer += 1;
        return;
      }
      const at = parseMissObjectName(v.name);
      if (!at || at.allowlistVersion !== SANITISE_ALLOWLIST_VERSION) {
        drop.push({ ...v, reason: at ? "allowlist_version" : "bad_name" });
        return;
      }
      let value: unknown;
      try {
        value = await this.store.readVersion(v.name, v.generation);
      } catch {
        failedReads += 1; // left alone: the next boot tries again
        return;
      }
      if (value === null) return; // gone since the listing
      const read = readMissRecord(v.name, value);
      if (!read) drop.push({ ...v, reason: "invalid" });
      else if (Date.parse(read.miss.firstSeen) < cutoff) drop.push({ ...v, reason: "expired" });
      else if (isRecorded(read.miss.key)) drop.push({ ...v, reason: "recorded" });
      else kept.push({ ...v, ...read });
    });

    // Newest first: the per-owner and total caps keep the newest.
    kept.sort((a, b) => (a.miss.firstSeen < b.miss.firstSeen ? 1 : a.miss.firstSeen > b.miss.firstSeen ? -1 : a.name < b.name ? -1 : 1));
    const perOwner = new Map<string, number>();
    const out: Array<{ owner: MissOwner; miss: Miss }> = [];
    for (const k of kept) {
      const who = k.owner === null ? "anon" : "ns" in k.owner ? `ns:${k.owner.ns}` : `prefix:${k.owner.prefix}`;
      const n = perOwner.get(who) ?? 0;
      const known = this.index.get(k.name);
      if (n >= MAX_MISSES_PER_NAMESPACE || (!known && this.index.size >= this.maxPersisted)) {
        drop.push({ name: k.name, generation: k.generation, reason: "cap" });
        if (known) this.index.delete(k.name);
        continue;
      }
      perOwner.set(who, n + 1);
      // A miss saved since boot (its create found this object) learns its generation here.
      if (known) {
        if (known.generation === null) known.generation = k.generation;
      } else {
        this.index.set(k.name, { owner: k.owner, key: k.miss.key, firstSeenMs: Date.parse(k.miss.firstSeen), generation: k.generation });
      }
      out.push({ owner: k.owner, miss: k.miss });
    }
    await inBatches(drop, (d) => this.deleteObject(d.name, { generation: d.generation }, d.reason));
    log("misses_restored", {
      listed: listed.length,
      restored: out.length,
      deleted: drop.length,
      failedReads,
      newerVersion: newer,
      ms: Date.now() - started,
    });
    return out;
  }
}
