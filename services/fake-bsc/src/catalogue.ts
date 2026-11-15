/**
 * The recorded catalogue in memory: every recording the current manifest
 * lists, loaded at boot, plus whatever the recorder uploads (auto-promoted:
 * an upload is live as soon as its manifest is written).
 */
import { canonicalJson, canonicalRequest, requestKey, type CanonicalRequest, type QueryPairs } from "./requestKey";
import {
  CATALOGUE_PATH_TEMPLATES,
  SANITISE_ALLOWLIST_VERSION,
  catalogueEndpointFor,
  sanitiseCatalogue,
  type CatalogueEndpoint,
} from "./sanitise";
import { ManifestConflictError, type ObjectStore } from "./store/types";
import { log } from "./log";

export interface Recording {
  key: string;
  allowlistVersion: number;
  endpoint: CatalogueEndpoint;
  request: CanonicalRequest;
  response: { status: number; body: unknown };
  recordedAt: string;
}

export interface ManifestEntry {
  object: string;
  pathTemplate: string;
  recordedAt: string;
}

export interface Manifest {
  schema: 1;
  version: number;
  allowlistVersion: number;
  updatedAt: string;
  entries: Record<string, ManifestEntry>;
}

/** Statuses a recording may hold: an answer, or BSC's "no such card". */
const RECORDABLE_STATUSES = new Set([200, 404]);

export type RecordingCheck =
  | { ok: true; recording: Recording }
  | { ok: false; reason: string; droppedPaths?: string[] };

/**
 * Validates an untrusted recording (an upload, or an object read back from
 * the store). The key is always recomputed, never trusted; the response
 * must already be inside the allowlist (anything the sanitiser would drop is
 * a refusal, with the offending paths).
 */
export function checkRecording(input: unknown, now: () => Date = () => new Date()): RecordingCheck {
  if (!input || typeof input !== "object") return { ok: false, reason: "not_an_object" };
  const r = input as Record<string, unknown>;
  const req = r.request as Record<string, unknown> | undefined;
  const resp = r.response as Record<string, unknown> | undefined;
  if (!req || typeof req !== "object" || !resp || typeof resp !== "object") return { ok: false, reason: "missing_request_or_response" };
  if (typeof req.method !== "string" || typeof req.path !== "string") return { ok: false, reason: "bad_request" };
  if (req.path.length > 512) return { ok: false, reason: "bad_request" };
  let query: QueryPairs = [];
  if (req.query !== undefined) {
    if (!Array.isArray(req.query) || req.query.length > 50) return { ok: false, reason: "bad_query" };
    for (const p of req.query) {
      if (!Array.isArray(p) || p.length !== 2 || typeof p[0] !== "string" || typeof p[1] !== "string") return { ok: false, reason: "bad_query" };
    }
    query = req.query as QueryPairs;
  }
  const request = canonicalRequest({ method: req.method, path: req.path, query, body: req.body });
  const endpoint = catalogueEndpointFor(request.method, request.path);
  if (!endpoint) return { ok: false, reason: "not_a_catalogue_endpoint" };
  if (request.body !== undefined && canonicalJson(request.body).length > 64 * 1024) return { ok: false, reason: "request_body_too_large" };
  if (typeof resp.status !== "number" || !RECORDABLE_STATUSES.has(resp.status)) return { ok: false, reason: "status_not_recordable" };
  if (r.allowlistVersion !== undefined && r.allowlistVersion !== SANITISE_ALLOWLIST_VERSION) {
    return { ok: false, reason: "allowlist_version" };
  }
  let body: unknown = null;
  if (resp.status === 200) {
    const s = sanitiseCatalogue(endpoint, resp.body);
    if (s.dropped.length > 0 || s.value === undefined) return { ok: false, reason: "outside_allowlist", droppedPaths: s.dropped };
    body = s.value;
  } else if (resp.body !== null && resp.body !== undefined) {
    return { ok: false, reason: "non_200_with_body" };
  }
  const key = requestKey(request);
  if (r.key !== undefined && r.key !== key) return { ok: false, reason: "key_mismatch" };
  const recordedAt = typeof r.recordedAt === "string" && !Number.isNaN(Date.parse(r.recordedAt)) ? r.recordedAt : now().toISOString();
  return {
    ok: true,
    recording: { key, allowlistVersion: SANITISE_ALLOWLIST_VERSION, endpoint, request, response: { status: resp.status, body }, recordedAt },
  };
}

function objectName(key: string): string {
  return `recordings/v${SANITISE_ALLOWLIST_VERSION}/${key}.json`;
}

function isManifest(v: unknown): v is Manifest {
  if (!v || typeof v !== "object") return false;
  const m = v as Record<string, unknown>;
  return m.schema === 1 && typeof m.version === "number" && typeof m.entries === "object" && m.entries !== null;
}

export class Catalogue {
  private byKey = new Map<string, Recording>();
  private resultsByFilters = new Map<string, Recording>();
  private manifest: Manifest | null = null;
  private generation: string | null = null;
  private writeChain: Promise<unknown> = Promise.resolve();

  constructor(private readonly store: ObjectStore) {}

  get manifestVersion(): number {
    return this.manifest?.version ?? 0;
  }

  get size(): number {
    return this.byKey.size;
  }

  get(key: string): Recording | undefined {
    return this.byKey.get(key);
  }

  /** The latest catalogue `results` recording for exactly these filters. */
  resultsFor(filters: unknown): Recording | undefined {
    return this.resultsByFilters.get(canonicalJson(filters ?? {}));
  }

  /** Recordings of one endpoint, for near-miss diffs (bounded). */
  sameEndpoint(endpoint: CatalogueEndpoint, limit = 500): Recording[] {
    const out: Recording[] = [];
    for (const r of this.byKey.values()) {
      if (r.endpoint === endpoint) out.push(r);
      if (out.length >= limit) break;
    }
    return out;
  }

  private index(r: Recording): void {
    this.byKey.set(r.key, r);
    if (r.endpoint === "results" && r.response.status === 200) {
      const filters = (r.request.body as { filters?: unknown } | undefined)?.filters;
      const k = canonicalJson(filters ?? {});
      const prev = this.resultsByFilters.get(k);
      if (!prev || prev.recordedAt <= r.recordedAt) this.resultsByFilters.set(k, r);
    }
  }

  /** Boot: read the manifest and every recording it lists. */
  async load(): Promise<{ loaded: number; skipped: number }> {
    const read = await this.store.readManifest();
    this.byKey.clear();
    this.resultsByFilters.clear();
    if (!read) {
      this.manifest = null;
      this.generation = null;
      return { loaded: 0, skipped: 0 };
    }
    if (!isManifest(read.value)) throw new Error("manifest.json is not a manifest");
    this.manifest = read.value;
    this.generation = read.generation;
    let skipped = 0;
    const entries = Object.entries(this.manifest.entries);
    const CONCURRENCY = 16;
    for (let i = 0; i < entries.length; i += CONCURRENCY) {
      const chunk = entries.slice(i, i + CONCURRENCY);
      const objs = await Promise.all(
        chunk.map(([, e]) => (e.object.startsWith(`recordings/v${SANITISE_ALLOWLIST_VERSION}/`) ? this.store.read(e.object) : Promise.resolve(null))),
      );
      chunk.forEach(([key], j) => {
        const check = objs[j] === null ? null : checkRecording(objs[j]);
        if (check?.ok && check.recording.key === key) this.index(check.recording);
        else skipped += 1;
      });
    }
    return { loaded: this.byKey.size, skipped };
  }

  /**
   * Stores checked recordings and promotes a new manifest. Serialised within
   * the process; a conflicting manifest (another writer) is re-read and the
   * write retried once.
   */
  add(recordings: Recording[]): Promise<{ version: number; added: number }> {
    const run = this.writeChain.then(() => this.addNow(recordings));
    this.writeChain = run.catch(() => undefined);
    return run;
  }

  private async addNow(recordings: Recording[]): Promise<{ version: number; added: number }> {
    for (const r of recordings) await this.store.write(objectName(r.key), r);
    for (let attempt = 0; attempt < 2; attempt++) {
      const base = this.manifest;
      const next: Manifest = {
        schema: 1,
        version: (base?.version ?? 0) + 1,
        allowlistVersion: SANITISE_ALLOWLIST_VERSION,
        updatedAt: new Date().toISOString(),
        entries: { ...(base?.entries ?? {}) },
      };
      for (const r of recordings) {
        next.entries[r.key] = { object: objectName(r.key), pathTemplate: CATALOGUE_PATH_TEMPLATES[r.endpoint], recordedAt: r.recordedAt };
      }
      try {
        await this.store.write(`manifests/${String(next.version).padStart(8, "0")}.json`, next);
        await this.store.writeManifest(next, this.generation);
      } catch (err) {
        if (err instanceof ManifestConflictError && attempt === 0) {
          const fresh = await this.store.readManifest();
          if (fresh && isManifest(fresh.value)) {
            this.manifest = fresh.value;
            this.generation = fresh.generation;
          }
          log("manifest_conflict_retry", {});
          continue;
        }
        throw err;
      }
      const after = await this.store.readManifest();
      this.manifest = next;
      this.generation = after?.generation ?? null;
      for (const r of recordings) this.index(r);
      return { version: next.version, added: recordings.length };
    }
    throw new ManifestConflictError();
  }

  /** Test seam: put recordings in memory without a store round trip. */
  primeForTests(recordings: Recording[]): void {
    for (const r of recordings) this.index(r);
  }
}
