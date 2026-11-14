/**
 * Shape signatures: the key paths of a JSON value and the types seen at each,
 * never a value. Write captures and the drift check are built from these, so
 * a real BSC response never has to leave the machine that read it.
 *
 *   {"a": {"b": [1, "x"]}}  →  { "": ["object"], "a": ["object"],
 *                                "a.b": ["array"], "a.b[]": ["number", "string"] }
 */

export type ShapeType = "string" | "number" | "boolean" | "null" | "object" | "array";

const SHAPE_TYPES: readonly ShapeType[] = ["string", "number", "boolean", "null", "object", "array"];

export type Shape = Record<string, ShapeType[]>;

export interface ShapeSignature {
  status: number;
  shape: Shape;
}

/** Most paths a signature may hold, and the longest path. */
export const MAX_SHAPE_PATHS = 2000;
export const MAX_SHAPE_PATH_LENGTH = 300;
const MAX_DEPTH = 32;

function typeOf(v: unknown): ShapeType | null {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  const t = typeof v;
  if (t === "string" || t === "number" || t === "boolean" || t === "object") return t;
  return null;
}

export function shapeOf(value: unknown): Shape {
  const acc = new Map<string, Set<ShapeType>>();
  visit(value, "", acc, 0);
  const out: Shape = {};
  for (const k of [...acc.keys()].sort()) out[k] = [...acc.get(k)!].sort();
  return out;
}

function visit(v: unknown, path: string, acc: Map<string, Set<ShapeType>>, depth: number): void {
  const t = typeOf(v);
  if (t === null || depth > MAX_DEPTH || acc.size >= MAX_SHAPE_PATHS) return;
  if (path.length > MAX_SHAPE_PATH_LENGTH) return;
  let set = acc.get(path);
  if (!set) acc.set(path, (set = new Set()));
  set.add(t);
  if (t === "array") {
    for (const item of v as unknown[]) visit(item, `${path}[]`, acc, depth + 1);
  } else if (t === "object") {
    for (const [k, child] of Object.entries(v as Record<string, unknown>)) {
      if (!SAFE_KEY_RE.test(k)) continue; // a key that is itself data (an id, an email) is not shape
      visit(child, path === "" ? k : `${path}.${k}`, acc, depth + 1);
    }
  }
}

/** Keys that look like field names. A key that does not is a value and is not recorded. */
const SAFE_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

const PATH_RE = /^(?:[A-Za-z_][A-Za-z0-9_]{0,63}|\[\])?(?:(?:\.[A-Za-z_][A-Za-z0-9_]{0,63})|\[\])*$/;

/** Validates an untrusted shape (from a capture upload or a drift probe). */
export function readShape(value: unknown): Shape | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > MAX_SHAPE_PATHS) return null;
  const out: Shape = {};
  for (const [path, types] of entries) {
    if (path.length > MAX_SHAPE_PATH_LENGTH || !PATH_RE.test(path)) return null;
    if (!Array.isArray(types) || types.length === 0 || types.length > SHAPE_TYPES.length) return null;
    if (!types.every((t) => (SHAPE_TYPES as readonly unknown[]).includes(t))) return null;
    out[path] = [...new Set(types as ShapeType[])].sort();
  }
  return out;
}

export interface ShapeDiff {
  /** Paths only one side has, or whose non-null types do not overlap. */
  paths: string[];
}

/**
 * Where two shapes disagree. `null` is compatible with anything (a field that
 * is sometimes null is not drift). `only` limits the comparison to paths a
 * predicate accepts (the allowlist, for a recorded endpoint).
 */
export function diffShapes(a: Shape, b: Shape, only?: (path: string) => boolean): ShapeDiff {
  const out: string[] = [];
  for (const path of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (only && !only(path)) continue;
    const ta = a[path];
    const tb = b[path];
    if (!ta || !tb) {
      out.push(path);
      continue;
    }
    const na = ta.filter((t) => t !== "null");
    const nb = tb.filter((t) => t !== "null");
    if (na.length === 0 || nb.length === 0) continue;
    if (!na.some((t) => nb.includes(t))) out.push(path);
  }
  return { paths: out.sort() };
}

/**
 * True when `synth` could have come from the API `capture` describes: every
 * path synthesis produces exists in the capture with an overlapping type. A
 * capture may hold more (fields NB never reads); synthesis must not invent.
 */
export function synthConformsTo(synth: Shape, capture: Shape): ShapeDiff {
  const out: string[] = [];
  for (const [path, types] of Object.entries(synth)) {
    const ct = capture[path];
    if (!ct) {
      if (!underUnseenItems(path, capture)) out.push(path);
      continue;
    }
    const ns = types.filter((t) => t !== "null");
    const nc = ct.filter((t) => t !== "null");
    if (ns.length && nc.length && !ns.some((t) => nc.includes(t))) out.push(path);
  }
  return { paths: out.sort() };
}

/**
 * True when `path` sits under an array the capture saw only empty (`x` is an
 * array, nothing under `x[]`): the capture cannot say what its items hold.
 */
function underUnseenItems(path: string, capture: Shape): boolean {
  let idx = path.indexOf("[]");
  while (idx !== -1) {
    const arrayPath = path.slice(0, idx);
    const itemPrefix = `${arrayPath}[]`;
    if (capture[arrayPath]?.includes("array") && !Object.keys(capture).some((k) => k.startsWith(itemPrefix))) {
      return true;
    }
    idx = path.indexOf("[]", idx + 2);
  }
  return false;
}
