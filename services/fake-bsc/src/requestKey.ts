/**
 * The one definition of a recording's key (CONTRACT.md, "Recorded vs
 * synthesised"), shared by the server and the recorder:
 *
 *   method + path + sorted query + canonical JSON body (object keys sorted
 *   recursively, array order kept), hashed with SHA-256. Headers are ignored.
 *
 * The path is BSC's API path with no leading or trailing slash and no `/api`
 * prefix (`search/bulk-upload/results`). A GET or DELETE has no body.
 */
import { createHash } from "node:crypto";

export type QueryPairs = Array<[string, string]>;

export interface CanonicalRequest {
  method: string;
  path: string;
  query: QueryPairs;
  body: unknown;
}

/** `/api/x/y/` or `x/y` → `x/y`. Collapses duplicate slashes. */
export function normalisePath(path: string): string {
  let p = path.split("?")[0].replace(/\/{2,}/g, "/");
  p = p.replace(/^\/+/, "").replace(/\/+$/, "");
  if (p === "api") return "";
  if (p.startsWith("api/")) p = p.slice(4);
  return p;
}

/** Query pairs sorted by key, then value. Accepts a search string or pairs. */
export function normaliseQuery(query: string | QueryPairs | Record<string, unknown> | undefined): QueryPairs {
  let pairs: QueryPairs = [];
  if (typeof query === "string") {
    const s = query.startsWith("?") ? query.slice(1) : query;
    pairs = [...new URLSearchParams(s).entries()];
  } else if (Array.isArray(query)) {
    pairs = query.map(([k, v]) => [String(k), String(v)]);
  } else if (query && typeof query === "object") {
    for (const [k, v] of Object.entries(query)) {
      if (Array.isArray(v)) for (const x of v) pairs.push([k, String(x)]);
      else if (v !== undefined) pairs.push([k, String(v)]);
    }
  }
  return pairs.sort((a, b) => (a[0] === b[0] ? cmp(a[1], b[1]) : cmp(a[0], b[0])));
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Recursively key-sorted JSON. `undefined` object members are dropped, as JSON does. */
export function canonicalJson(value: unknown): string {
  if (value === undefined) return "";
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((v) => (v === undefined ? null : sortKeys(v)));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort(cmp)) {
      const v = (value as Record<string, unknown>)[k];
      if (v !== undefined) out[k] = sortKeys(v);
    }
    return out;
  }
  return value;
}

const BODYLESS = new Set(["GET", "HEAD", "DELETE"]);

export function canonicalRequest(input: {
  method: string;
  path: string;
  query?: string | QueryPairs | Record<string, unknown>;
  body?: unknown;
}): CanonicalRequest {
  const method = input.method.toUpperCase();
  return {
    method,
    path: normalisePath(input.path),
    query: normaliseQuery(input.query),
    body: BODYLESS.has(method) ? undefined : input.body === undefined ? undefined : JSON.parse(canonicalJson(input.body)),
  };
}

/** The canonical string the key hashes; exported for tests and diagnostics. */
export function canonicalString(req: CanonicalRequest): string {
  const q = req.query.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
  return `${req.method}\n${req.path}\n${q}\n${canonicalJson(req.body)}`;
}

export function requestKey(input: {
  method: string;
  path: string;
  query?: string | QueryPairs | Record<string, unknown>;
  body?: unknown;
}): string {
  return createHash("sha256").update(canonicalString(canonicalRequest(input))).digest("hex");
}

/**
 * Leaf paths where two canonical requests differ (`body.filters.year`,
 * `query.page`). Paths only, never values: this is the near-miss diff a miss
 * list shows.
 */
export function diffRequestPaths(a: CanonicalRequest, b: CanonicalRequest): string[] {
  const out = new Set<string>();
  if (a.method !== b.method) out.add("method");
  if (a.path !== b.path) out.add("path");
  const qa = new Map<string, string[]>();
  const qb = new Map<string, string[]>();
  for (const [k, v] of a.query) qa.set(k, [...(qa.get(k) ?? []), v]);
  for (const [k, v] of b.query) qb.set(k, [...(qb.get(k) ?? []), v]);
  for (const k of new Set([...qa.keys(), ...qb.keys()])) {
    if (JSON.stringify(qa.get(k)) !== JSON.stringify(qb.get(k))) out.add(`query.${k}`);
  }
  diffValue(a.body, b.body, "body", out);
  return [...out].sort(cmp);
}

function diffValue(a: unknown, b: unknown, path: string, out: Set<string>): void {
  if (out.size > 200) return;
  const isObj = (v: unknown) => !!v && typeof v === "object" && !Array.isArray(v);
  if (isObj(a) && isObj(b)) {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    for (const k of new Set([...Object.keys(ao), ...Object.keys(bo)])) diffValue(ao[k], bo[k], `${path}.${k}`, out);
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (canonicalJson(a) !== canonicalJson(b)) out.add(path);
    return;
  }
  if (canonicalJson(a) !== canonicalJson(b)) out.add(path);
}
