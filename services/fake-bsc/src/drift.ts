/**
 * `POST /__fake/drift-compare` (CONTRACT.md, "Probe, drift and ops wiring"):
 * the daily prod probe's response shapes against what the fake serves.
 *
 * Input:  `{shapes: {<path template>: {<key.path>: <type>}},
 *          requests?: {<catalogue template>: {method, path, query?, body?}}}`
 *   The probe's dialect: root `$`, arrays `[]`, id-like map keys `{*}`,
 *   unions `number|null`. Our own `[type, ...]` lists are accepted too.
 * Output: `{outcome, paths, endpoints: [{endpoint, verdict, paths}]}`; a
 *   verdict is "ok", "shape_drift", "unrecorded pinned key" or
 *   "not_compared", and `paths` are `<endpoint> <key.path>`.
 *
 * Recorded endpoints compare only allowlisted paths (the fake holds nothing
 * else), against the recording for the pinned request when one is given.
 * Synthesised endpoints compare only the paths NeonBinder's parsers read. A
 * path missing from the probe is drift only when its parent is present (a
 * facet absent from one answer is not drift; a facet item that lost its
 * `slug` is), and never for an array's items (an empty list says nothing).
 */
import type { Catalogue } from "./catalogue";
import { canonicalRequest, normalisePath, requestKey, type QueryPairs } from "./requestKey";
import { CATALOGUE_PATH_TEMPLATES, SPECS, catalogueEndpointFor, specAllowsPath, type CatalogueEndpoint } from "./sanitise";
import { MAX_SHAPE_PATHS, MAX_SHAPE_PATH_LENGTH, shapeOf, type Shape, type ShapeType } from "./shape";
import { profileAnswer, synthSheet } from "./synth/sheet";
import { addOrder, orderHistory } from "./synth/orders";
import type { NamespaceState } from "./state";

export type DriftVerdict = "ok" | "shape_drift" | "unrecorded pinned key" | "not_compared";

export interface DriftEndpointResult {
  endpoint: string;
  verdict: DriftVerdict;
  paths: string[];
}

export interface DriftResult {
  outcome: "ok" | "shape_drift" | "unrecorded pinned key";
  paths: string[];
  endpoints: DriftEndpointResult[];
}

export type Synth = "profile" | "sheet" | "orderHistory";

/** The paths NeonBinder reads from each synthesised endpoint. */
const READ_PATHS: Record<Synth, readonly string[]> = {
  // bscSeller.fetchBscSellerId, browser bsc-adapter attemptSellerProfile
  profile: ["", "sellerProfile", "sellerProfile.sellerId", "sellerProfile.sellerStoreName"],
  // lib/bscSheetPlan.narrowBscSheetRow
  sheet: ["", "[]", "[].card", "[].card.id", "[].card.cardNo", "[].cardId", "[].condition", "[].availableQuantity", "[].price", "[].productType", "[].sellerSku", "[].sellerImgFront", "[].sellerImgBack", "[].productId"],
  // lib/bscOrders.parseBscOrderHistoryPage
  orderHistory: ["", "totalElements", "results", "results[]", "results[].orderId", "results[].orderNo", "results[].orderStatus", "results[].orderDate"],
};

type Target = { kind: "catalogue"; endpoint: CatalogueEndpoint } | { kind: "synth"; which: Synth } | { kind: "unknown" };

function targetFor(name: string): Target {
  const m = /^(GET|POST|PUT)\s+(.+)$/i.exec(name.trim());
  const path = normalisePath(m ? m[2] : name);
  if (path === "marketplace/user/profile") return { kind: "synth", which: "profile" };
  if (path === "seller/bulk-upload/results") return { kind: "synth", which: "sheet" };
  if (path === "seller/order/history") return { kind: "synth", which: "orderHistory" };
  for (const [endpoint, tpl] of Object.entries(CATALOGUE_PATH_TEMPLATES) as Array<[CatalogueEndpoint, string]>) {
    if (path === tpl || path === endpoint) return { kind: "catalogue", endpoint };
  }
  const method = m ? m[1].toUpperCase() : path.endsWith("card-listing") ? "GET" : "POST";
  const e = catalogueEndpointFor(method, path);
  return e ? { kind: "catalogue", endpoint: e } : { kind: "unknown" };
}

const KNOWN_TYPES = new Set<ShapeType>(["string", "number", "boolean", "null", "object", "array"]);
const PROBE_PATH_RE = /^[A-Za-z0-9_.$\[\]{}*]*$/;

/**
 * Reads a probe shape: `$` is the root, `$.a` is `a`, `number|null` a union.
 * A path holding `{*}` (an id-like map key) is dropped: no allowlisted or read
 * path has one. Unknown type names are ignored. Null when not a shape at all.
 */
export function readProbeShape(v: unknown): Shape | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const entries = Object.entries(v as Record<string, unknown>);
  if (entries.length > MAX_SHAPE_PATHS) return null;
  const out: Shape = {};
  for (const [rawPath, rawTypes] of entries) {
    if (rawPath.length > MAX_SHAPE_PATH_LENGTH || !PROBE_PATH_RE.test(rawPath)) return null;
    const list = typeof rawTypes === "string" ? rawTypes.split("|") : Array.isArray(rawTypes) ? rawTypes : null;
    if (!list || !list.every((t) => typeof t === "string")) return null;
    if (rawPath.includes("{*}")) continue;
    const path = rawPath === "$" ? "" : rawPath.startsWith("$.") ? rawPath.slice(2) : rawPath.startsWith("$[]") ? rawPath.slice(1) : rawPath;
    const types = [...new Set((list as string[]).map((t) => t.trim()).filter((t): t is ShapeType => KNOWN_TYPES.has(t as ShapeType)))].sort();
    if (types.length === 0) continue;
    out[path] = [...new Set([...(out[path] ?? []), ...types])].sort() as ShapeType[];
  }
  return out;
}

export function mergeShapes(shapes: Shape[]): Shape {
  const out: Record<string, Set<ShapeType>> = {};
  for (const s of shapes) for (const [p, ts] of Object.entries(s)) for (const t of ts) (out[p] ??= new Set()).add(t);
  const merged: Shape = {};
  for (const [p, ts] of Object.entries(out)) merged[p] = [...ts].sort();
  return merged;
}

function parentOf(path: string): string {
  if (path.endsWith("[]")) return path.slice(0, -2);
  const i = path.lastIndexOf(".");
  return i === -1 ? "" : path.slice(0, i);
}

/**
 * `required`: the served paths the probe must have whenever their parent is
 * present. Absent: every served path. A served path outside it (the seller
 * sheet's listed-only keys) is type-checked when the probe has it, never
 * required.
 */
export function compare(probe: Shape, served: Shape, allow: (p: string) => boolean, required?: ReadonlySet<string>): string[] {
  const out: string[] = [];
  const nonNull = (ts: readonly string[]) => ts.filter((t) => t !== "null");
  for (const p of Object.keys(probe)) {
    if (!allow(p)) continue;
    const s = served[p];
    if (!s) continue; // a path the fake has never seen filled: not comparable
    const a = nonNull(probe[p]);
    const b = nonNull(s);
    if (a.length && b.length && !a.some((t) => b.includes(t))) out.push(p);
  }
  for (const p of Object.keys(served)) {
    if (!allow(p) || probe[p] || p.endsWith("[]")) continue;
    if (required && !required.has(p)) continue;
    if (probe[parentOf(p)]) out.push(p);
  }
  return [...new Set(out)].sort();
}

const SAMPLE_STATE = (): NamespaceState => ({
  ns: "sample",
  sellerId: "fake-sample",
  storeName: "Fake Store sample",
  userId: "fake-user-sample",
  listings: new Map(),
  photos: 0,
  orders: new Map(),
  faults: [],
  misses: new Map(),
  lastSeen: 0,
});

/** What the fake serves for a synthesised endpoint, and which of its paths every answer carries. */
export interface SynthShape {
  served: Shape;
  /** Paths every answer has (required in the probe). The rest appear only on some rows. */
  required: ReadonlySet<string>;
}

const SAMPLE_SHEET_ROWS = [{ id: "c1", cardNo: "1", players: "x" }, { id: "c2", cardNo: "2", players: "y" }];

/**
 * What the fake serves for a synthesised endpoint, filled with sample rows.
 * The seller sheet is built twice: blank rows only (an account with no
 * listings, which is what the probe reads), whose paths are required, and
 * with one listed row, which adds the listed-only keys (`sellerSku`,
 * `sellerImgFront`, `sellerImgBack`) as optional.
 */
export function synthShape(which: Synth): SynthShape {
  const all = (served: Shape): SynthShape => ({ served, required: new Set(Object.keys(served)) });
  const state = SAMPLE_STATE();
  switch (which) {
    case "profile":
      return all(shapeOf(profileAnswer(state)));
    case "sheet": {
      const blank = shapeOf(synthSheet(SAMPLE_SHEET_ROWS, SAMPLE_STATE(), "near_mint", 0));
      state.listings.set("c1|near_mint", {
        cardId: "c1",
        condition: "near_mint",
        productId: "p",
        availableQuantity: 1,
        price: 0.25,
        sellerSku: "1|1",
        sellerImgFront: "/x.jpg",
        sellerImgBack: null,
        updatedTimestamp: "2026-01-01T00:00:00.000000",
        card: null,
      });
      const listed = shapeOf(synthSheet(SAMPLE_SHEET_ROWS, state, "near_mint", 0));
      return { served: mergeShapes([blank, listed]), required: new Set(Object.keys(blank)) };
    }
    case "orderHistory":
      addOrder(state, { items: [{ cardId: "c1", condition: "near_mint", quantity: 1 }] }, 0);
      return all(shapeOf(orderHistory(state, {})));
  }
}

/**
 * The seller sheet's two root forms. bscSeller.ts `fetchBscSellerSheet`
 * reads a bare array, or `{results: [...]}`; real BSC sends the wrapped form
 * (and so does the fake, `sheetAnswer`), and the probe may report either.
 * Both are one answer to NB, so a
 * wrapped probe is unwrapped to the bare form (`results` → root,
 * `results[]...` → `[]...`) before it is compared; nothing else in a wrapped
 * root is read by NB.
 */
export function unwrapSheetRoot(probe: Shape): Shape {
  const root = probe[""] ?? [];
  if (!root.includes("object") || !(probe["results"] ?? []).includes("array")) return probe;
  const out: Shape = {};
  for (const [p, ts] of Object.entries(probe)) {
    if (p === "results") out[""] = ts;
    else if (p.startsWith("results[]")) out[p.slice("results".length)] = ts;
  }
  // A root seen as both forms keeps its array side.
  if (root.includes("array")) for (const [p, ts] of Object.entries(probe)) if (p.startsWith("[]") && !out[p]) out[p] = ts;
  return out;
}

function readQuery(v: unknown): string | QueryPairs | Record<string, unknown> | undefined {
  if (typeof v === "string" || Array.isArray(v)) return v as string | QueryPairs;
  if (v && typeof v === "object") return v as Record<string, unknown>;
  return undefined;
}

export function compareDrift(input: unknown, catalogue: Catalogue): { ok: true; result: DriftResult } | { ok: false; error: string } {
  if (!input || typeof input !== "object") return { ok: false, error: "body must be an object" };
  const b = input as Record<string, unknown>;
  if (!b.shapes || typeof b.shapes !== "object" || Array.isArray(b.shapes)) return { ok: false, error: "shapes must be an object" };
  const entries = Object.entries(b.shapes as Record<string, unknown>);
  if (entries.length > 20) return { ok: false, error: "at most 20 endpoints" };
  const requests = b.requests && typeof b.requests === "object" ? (b.requests as Record<string, unknown>) : {};

  const results: DriftEndpointResult[] = [];
  for (const [name, rawShape] of entries) {
    if (name.length > 200) return { ok: false, error: "endpoint name too long" };
    const probe = readProbeShape(rawShape);
    if (!probe) return { ok: false, error: `shapes[${name}] is not a shape` };
    const target = targetFor(name);
    if (target.kind === "unknown") {
      results.push({ endpoint: name, verdict: "not_compared", paths: [] });
      continue;
    }
    if (target.kind === "synth") {
      const read = READ_PATHS[target.which];
      const asServed = target.which === "sheet" ? unwrapSheetRoot(probe) : probe;
      const synth = synthShape(target.which);
      const paths = compare(asServed, synth.served, (p) => read.includes(p), synth.required);
      results.push({ endpoint: name, verdict: paths.length ? "shape_drift" : "ok", paths });
      continue;
    }
    const spec = SPECS[target.endpoint];
    let served: Shape;
    const pinned = requests[name] as Record<string, unknown> | undefined;
    if (pinned && typeof pinned === "object" && typeof pinned.method === "string" && typeof pinned.path === "string") {
      const req = canonicalRequest({ method: pinned.method, path: pinned.path, query: readQuery(pinned.query), body: pinned.body });
      const rec = catalogue.get(requestKey(req));
      if (!rec || rec.response.status !== 200) {
        results.push({ endpoint: name, verdict: "unrecorded pinned key", paths: [] });
        continue;
      }
      served = shapeOf(rec.response.body);
    } else {
      const recs = catalogue.sameEndpoint(target.endpoint, 200).filter((r) => r.response.status === 200);
      if (recs.length === 0) {
        results.push({ endpoint: name, verdict: "unrecorded pinned key", paths: [] });
        continue;
      }
      served = mergeShapes(recs.map((r) => shapeOf(r.response.body)));
    }
    const paths = compare(probe, served, (p) => specAllowsPath(spec, p));
    results.push({ endpoint: name, verdict: paths.length ? "shape_drift" : "ok", paths });
  }
  const paths = results.flatMap((r) => r.paths.map((p) => `${r.endpoint} ${p}`));
  const outcome = results.some((r) => r.verdict === "shape_drift")
    ? "shape_drift"
    : results.some((r) => r.verdict === "unrecorded pinned key")
      ? "unrecorded pinned key"
      : "ok";
  return { ok: true, result: { outcome, paths, endpoints: results } };
}
