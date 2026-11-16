/**
 * Field allowlists for the three recorded catalogue endpoints (CONTRACT.md,
 * "Recorded vs synthesised"), shared by the recorder (before upload) and the
 * server (on upload, and again on load).
 *
 * Derived from exactly what NeonBinder's parsers read, plus the structural ids
 * and sort keys a row carries:
 *
 *   filters      apps/web/convex/adapters/buysportscards.ts,
 *                fetchBscSelectorOptions: `aggregations[facet][].label/slug/
 *                count/active`, facets from convex/bscFacets.ts
 *                LEVEL_TO_BSC_FACET (sport, year, setName, variant,
 *                variantName).
 *   results      fetchBscChecklist's row map: `id`, `setName`, `players`,
 *                `cardNo` (with its `cardNumber` / `number` fallbacks),
 *                `playerAttribute`, `playerAttributeDesc`; plus the row's
 *                own ordering keys `cardNoOrder`, `cardNoSequence`,
 *                `cardNoSort`. The seller sheet is synthesised from these
 *                rows (`card.id`, `card.cardNo`, lib/bscSheetPlan.ts).
 *   cardListing  fetchBscCardTeamNameAttempt: `teamName`, `playerAttribute`
 *                (a comma string or a string array); plus the card's `id`.
 *
 * Field NAMES are the allowlist; each also has a type and a bound. A value of
 * another type (an object where a string belongs), a string over its bound,
 * or a string shaped like an email address or a bearer token is dropped,
 * never truncated. Everything else (seller, buyer, listing, image and price
 * fields, at any depth) is dropped.
 *
 * Bump SANITISE_ALLOWLIST_VERSION whenever a spec changes: recordings carry
 * the version they were cleaned under, and the server treats any other
 * version as unrecorded, so they are fetched again.
 */

export const SANITISE_ALLOWLIST_VERSION = 1;

export type CatalogueEndpoint = "filters" | "results" | "cardListing";

type Leaf = "string" | "number" | "boolean";

export type Spec =
  | { kind: "leaf"; types: readonly Leaf[]; maxLength?: number }
  | { kind: "object"; fields: Readonly<Record<string, Spec>> }
  | { kind: "array"; items: Spec; maxItems: number }
  | { kind: "oneOf"; options: readonly Spec[] };

const str = (maxLength = 256): Spec => ({ kind: "leaf", types: ["string"], maxLength });
const strOrNum = (maxLength = 64): Spec => ({ kind: "leaf", types: ["string", "number"], maxLength });
const num: Spec = { kind: "leaf", types: ["number"] };
const bool: Spec = { kind: "leaf", types: ["boolean"] };

const attributeTokens: Spec = {
  kind: "oneOf",
  options: [str(512), { kind: "array", items: str(64), maxItems: 50 }],
};

const facetItem: Spec = {
  kind: "object",
  fields: { label: str(256), slug: str(256), count: num, active: bool },
};
const facetList: Spec = { kind: "array", items: facetItem, maxItems: 5000 };

/** The BSC facets NeonBinder filters on (convex/bscFacets.ts). */
export const BSC_FACETS = ["sport", "year", "setName", "variant", "variantName"] as const;

export const SPECS: Readonly<Record<CatalogueEndpoint, Spec>> = {
  filters: {
    kind: "object",
    fields: {
      aggregations: {
        kind: "object",
        fields: Object.fromEntries(BSC_FACETS.map((f) => [f, facetList])),
      },
    },
  },
  results: {
    kind: "array",
    maxItems: 5000,
    items: {
      kind: "object",
      fields: {
        id: strOrNum(64),
        setName: str(256),
        players: str(2000),
        cardNo: strOrNum(64),
        cardNumber: strOrNum(64),
        number: strOrNum(64),
        playerAttribute: attributeTokens,
        playerAttributeDesc: str(2000),
        cardNoOrder: strOrNum(64),
        cardNoSequence: strOrNum(64),
        cardNoSort: strOrNum(64),
      },
    },
  },
  cardListing: {
    kind: "object",
    fields: {
      id: strOrNum(64),
      teamName: str(2000),
      playerAttribute: attributeTokens,
    },
  },
};

/** Which catalogue endpoint a (method, normalised path) is, if any. */
export function catalogueEndpointFor(method: string, path: string): CatalogueEndpoint | null {
  const m = method.toUpperCase();
  if (m === "POST" && path === "search/bulk-upload/filters") return "filters";
  if (m === "POST" && path === "search/bulk-upload/results") return "results";
  if (m === "GET" && CARD_LISTING_RE.test(path)) return "cardListing";
  return null;
}

export const CARD_LISTING_RE = /^marketplace\/card\/([A-Za-z0-9_-]{1,64})\/card-listing$/;

export const CATALOGUE_PATH_TEMPLATES: Readonly<Record<CatalogueEndpoint, string>> = {
  filters: "search/bulk-upload/filters",
  results: "search/bulk-upload/results",
  cardListing: "marketplace/card/:id/card-listing",
};

// Values that are never catalogue data whatever key they sit under.
const EMAIL_RE = /[^\s@<>()]+@[^\s@<>()]+\.[A-Za-z]{2,}/;
const JWT_RE = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/;
const BEARER_RE = /\bbearer\s+[A-Za-z0-9._~+/-]{16,}/i;

function suspiciousString(s: string): boolean {
  return EMAIL_RE.test(s) || JWT_RE.test(s) || BEARER_RE.test(s);
}

export interface SanitiseResult {
  value: unknown;
  /** Key paths that were dropped (`[].sellerId`, `aggregations.seller`). Paths only. */
  dropped: string[];
}

const MAX_DROPPED = 200;

/** Applies `spec`; `undefined` value means the whole input was dropped. */
export function sanitiseWith(spec: Spec, input: unknown): SanitiseResult {
  const dropped = new Set<string>();
  const value = walk(spec, input, "", dropped);
  return { value, dropped: [...dropped].sort() };
}

export function sanitiseCatalogue(endpoint: CatalogueEndpoint, input: unknown): SanitiseResult {
  return sanitiseWith(SPECS[endpoint], input);
}

function note(dropped: Set<string>, path: string): void {
  if (dropped.size < MAX_DROPPED) dropped.add(path === "" ? "$" : path);
}

function join(path: string, key: string): string {
  return path === "" ? key : `${path}.${key}`;
}

function walk(spec: Spec, input: unknown, path: string, dropped: Set<string>): unknown {
  switch (spec.kind) {
    case "leaf": {
      if (input === null) return null;
      const t = typeof input;
      if (t === "string") {
        const s = input as string;
        if (!spec.types.includes("string")) break;
        if (spec.maxLength !== undefined && s.length > spec.maxLength) break;
        if (suspiciousString(s)) break;
        return s;
      }
      if (t === "number") {
        if (!spec.types.includes("number") || !Number.isFinite(input as number)) break;
        return input;
      }
      if (t === "boolean") {
        if (!spec.types.includes("boolean")) break;
        return input;
      }
      break;
    }
    case "object": {
      if (input === null) return null;
      if (typeof input !== "object" || Array.isArray(input)) break;
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
        const child = Object.prototype.hasOwnProperty.call(spec.fields, k) ? spec.fields[k] : undefined;
        if (!child) {
          note(dropped, join(path, k));
          continue;
        }
        const w = walk(child, v, join(path, k), dropped);
        if (w !== undefined) out[k] = w;
      }
      return out;
    }
    case "array": {
      if (input === null) return null;
      if (!Array.isArray(input) || input.length > spec.maxItems) break;
      const out: unknown[] = [];
      for (const item of input) {
        const w = walk(spec.items, item, `${path}[]`, dropped);
        if (w !== undefined) out.push(w);
      }
      return out;
    }
    case "oneOf": {
      for (const option of spec.options) {
        const probe = new Set<string>();
        const w = walk(option, input, path, probe);
        if (w !== undefined && probe.size === 0) return w;
      }
      break;
    }
  }
  note(dropped, path);
  return undefined;
}

/** Every leaf path a spec allows (`aggregations.sport[].label`). For drift checks. */
export function specLeafPaths(spec: Spec, path = ""): string[] {
  switch (spec.kind) {
    case "leaf":
      return [path];
    case "object":
      return Object.entries(spec.fields).flatMap(([k, s]) => specLeafPaths(s, join(path, k)));
    case "array":
      return specLeafPaths(spec.items, `${path}[]`);
    case "oneOf":
      return [...new Set(spec.options.flatMap((o) => specLeafPaths(o, path)))];
  }
}

/** True when `path` (a shape path) is one the spec allows, at any level. */
export function specAllowsPath(spec: Spec, path: string): boolean {
  if (path === "") return true;
  const parts = tokenisePath(path);
  return allows(spec, parts);
}

function tokenisePath(path: string): string[] {
  // `a.b[].c` → ["a", "b", "[]", "c"]; `[].id` → ["[]", "id"]
  const out: string[] = [];
  for (const seg of path.split(".")) {
    let s = seg;
    const arrays: string[] = [];
    while (s.endsWith("[]")) {
      arrays.push("[]");
      s = s.slice(0, -2);
    }
    if (s !== "") out.push(s);
    out.push(...arrays);
  }
  return out;
}

function allows(spec: Spec, parts: string[]): boolean {
  if (parts.length === 0) return true;
  const [head, ...rest] = parts;
  switch (spec.kind) {
    case "leaf":
      return false;
    case "object": {
      const child = Object.prototype.hasOwnProperty.call(spec.fields, head) ? spec.fields[head] : undefined;
      return !!child && allows(child, rest);
    }
    case "array":
      return head === "[]" && allows(spec.items, rest);
    case "oneOf":
      return spec.options.some((o) => allows(o, parts));
  }
}
