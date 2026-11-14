import crypto from "node:crypto";

/**
 * NEO-552: a value-free description of a JSON body, for the BSC probe and the
 * daily drift check. It answers "did BSC change the SHAPE of this answer"
 * without ever carrying a value out of the process.
 *
 * The signature is a sorted list of `path: type` lines:
 *
 *   - types are `string | number | boolean | null | object | array`;
 *   - array elements are collapsed into one `[]` segment, so a list of 3 cards
 *     and a list of 300 have the same signature (element shapes are unioned);
 *   - an object key that is id-like (hex, uuid, digits) or not a plain
 *     identifier (spaces, punctuation, over 40 chars) is collapsed to `{*}`,
 *     because such keys are data (a card id, a player name), not schema, and
 *     a key that is data is a value;
 *   - depth is capped at 12 and the list at 400 lines (the last line then
 *     reads `…: truncated`).
 *
 * `hash` is a short sha256 of the lines, for a one-glance comparison.
 */

const MAX_DEPTH = 12;
const MAX_LINES = 400;
const MAX_KEY_LENGTH = 40;

const PLAIN_KEY = /^[A-Za-z_$][A-Za-z0-9_$-]*$/;
const ID_LIKE_KEY =
  /^(?:[0-9a-f]{16,}|[0-9]+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export interface ShapeSignature {
  lines: string[];
  hash: string;
}

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  const t = typeof value;
  if (t === "string" || t === "number" || t === "boolean" || t === "object") return t;
  return "other";
}

function keySegment(key: string): string {
  if (key.length > MAX_KEY_LENGTH || ID_LIKE_KEY.test(key) || !PLAIN_KEY.test(key)) {
    return "{*}";
  }
  return key;
}

export function shapeSignature(value: unknown): ShapeSignature {
  const types = new Map<string, Set<string>>();
  let truncated = false;

  const note = (path: string, type: string): boolean => {
    let set = types.get(path);
    if (!set) {
      if (types.size >= MAX_LINES) {
        truncated = true;
        return false;
      }
      set = new Set();
      types.set(path, set);
    }
    set.add(type);
    return true;
  };

  const walk = (node: unknown, path: string, depth: number): void => {
    const t = typeOf(node);
    if (!note(path, t)) return;
    if (depth >= MAX_DEPTH) return;
    if (t === "array") {
      for (const el of node as unknown[]) walk(el, `${path}[]`, depth + 1);
    } else if (t === "object") {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        walk(v, `${path}.${keySegment(k)}`, depth + 1);
      }
    }
  };

  walk(value, "$", 0);
  const lines = [...types.entries()]
    .map(([path, set]) => `${path}: ${[...set].sort().join("|")}`)
    .sort();
  if (truncated) lines.push("…: truncated");
  const hash = crypto.createHash("sha256").update(lines.join("\n")).digest("hex").slice(0, 16);
  return { lines, hash };
}

/**
 * Recursively sort object keys, for a canonical JSON body. Same rule as the
 * fake's request key (CONTRACT.md, "Request key"): keys sorted recursively,
 * arrays left in order.
 */
export function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = canonicalJson((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

/**
 * The signature as CONTRACT.md's `shapes` entry: `{<key.path>: <type>}`.
 * Paths drop the `$.` root prefix (`results[].orderId`); the root itself is
 * `$`. A truncated signature carries `…: "truncated"`.
 */
export function shapeMap(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of shapeSignature(value).lines) {
    const sep = line.lastIndexOf(": ");
    const path = line.slice(0, sep);
    const type = line.slice(sep + 2);
    const key = path === "$" ? "$" : path.startsWith("$.") ? path.slice(2) : path.slice(1);
    out[key] = type;
  }
  return out;
}
