/**
 * Faults (CONTRACT.md, "Faults"): per-namespace rules that make a matching
 * request answer 429 or 503, wait, hang or drop its connection. They replace
 * NEONBINDER_TEST_BSC_STALL_CARD_IDS. Default TTL 10 minutes.
 */

export type FaultKind = "429" | "503" | "delay" | "hang" | "reset";
const KINDS: readonly FaultKind[] = ["429", "503", "delay", "hang", "reset"];

export interface FaultRule {
  match: { method: string; pathTemplate: string; cardId?: string };
  kind: FaultKind;
  delayMs?: number;
  retryAfterS?: number;
  /** Applications left; null = until it expires. */
  timesLeft: number | null;
  expiresAt: number;
}

export const DEFAULT_FAULT_TTL_S = 600;
export const MAX_FAULT_TTL_S = 3600;
export const MAX_RULES_PER_NAMESPACE = 50;
export const MAX_DELAY_MS = 120_000;
/**
 * A hang is cut after this, so a client with no timeout cannot pin a socket
 * for long. Two minutes is past every NB timeout a hang is meant to trip
 * (BSC calls time out at 30-60 s).
 */
export const HANG_CAP_MS = 2 * 60 * 1000;
/** Sockets one scope (namespace, prefix or anonymous) may hold hung at once; past it, 503 at once. */
export const MAX_HUNG_PER_SCOPE = 4;

const METHODS = new Set(["GET", "POST", "PUT", "DELETE", "PATCH", "*"]);
const TEMPLATE_RE = /^[A-Za-z0-9_.:\-/]{1,200}\*?$/;
const CARD_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function intIn(v: unknown, min: number, max: number): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : null;
}

export type FaultRulesRead = { ok: true; rules: FaultRule[] } | { ok: false; error: string };

/** Validates `rules` from a `POST /__fake/faults` body. */
export function readFaultRules(input: unknown, now: number = Date.now()): FaultRulesRead {
  if (!Array.isArray(input)) return { ok: false, error: "rules must be an array" };
  if (input.length > MAX_RULES_PER_NAMESPACE) return { ok: false, error: `at most ${MAX_RULES_PER_NAMESPACE} rules` };
  const rules: FaultRule[] = [];
  for (const [i, raw] of input.entries()) {
    const bad = (why: string): FaultRulesRead => ({ ok: false, error: `rules[${i}]: ${why}` });
    if (!raw || typeof raw !== "object") return bad("not an object");
    const r = raw as Record<string, unknown>;
    const m = r.match as Record<string, unknown> | undefined;
    if (!m || typeof m !== "object") return bad("match is required");
    const method = typeof m.method === "string" ? m.method.toUpperCase() : "";
    if (!METHODS.has(method)) return bad("match.method");
    const pathTemplate = typeof m.pathTemplate === "string" ? m.pathTemplate.replace(/^\/+/, "") : "";
    if (!TEMPLATE_RE.test(pathTemplate)) return bad("match.pathTemplate");
    if (m.cardId !== undefined && !(typeof m.cardId === "string" && CARD_ID_RE.test(m.cardId))) return bad("match.cardId");
    if (!(KINDS as readonly unknown[]).includes(r.kind)) return bad("kind");
    const kind = r.kind as FaultKind;
    let delayMs: number | undefined;
    if (r.delayMs !== undefined) {
      const d = intIn(r.delayMs, 0, MAX_DELAY_MS);
      if (d === null) return bad("delayMs");
      delayMs = d;
    }
    if (kind === "delay" && delayMs === undefined) return bad("delay needs delayMs");
    let retryAfterS: number | undefined;
    if (r.retryAfterS !== undefined) {
      const ra = intIn(r.retryAfterS, 0, 3600);
      if (ra === null) return bad("retryAfterS");
      retryAfterS = ra;
    }
    let timesLeft: number | null = null;
    if (r.times !== undefined) {
      const t = intIn(r.times, 1, 10_000);
      if (t === null) return bad("times");
      timesLeft = t;
    }
    let ttlS = DEFAULT_FAULT_TTL_S;
    if (r.ttlS !== undefined) {
      const t = intIn(r.ttlS, 1, MAX_FAULT_TTL_S);
      if (t === null) return bad("ttlS");
      ttlS = t;
    }
    rules.push({
      match: { method, pathTemplate, ...(typeof m.cardId === "string" ? { cardId: m.cardId } : {}) },
      kind,
      ...(delayMs !== undefined ? { delayMs } : {}),
      ...(retryAfterS !== undefined ? { retryAfterS } : {}),
      timesLeft,
      expiresAt: now + ttlS * 1000,
    });
  }
  return { ok: true, rules };
}

export interface FaultTarget {
  method: string;
  /** Every name the request's path answers to (see `templatesFor`). */
  templates: readonly string[];
  cardId: string | null;
}

export function ruleMatches(rule: FaultRule, t: FaultTarget, now: number): boolean {
  if (rule.expiresAt <= now) return false;
  if (rule.timesLeft !== null && rule.timesLeft <= 0) return false;
  if (rule.match.method !== "*" && rule.match.method !== t.method) return false;
  if (rule.match.cardId !== undefined && rule.match.cardId !== t.cardId) return false;
  const tpl = rule.match.pathTemplate;
  if (tpl.endsWith("*")) {
    const prefix = tpl.slice(0, -1);
    return t.templates.some((x) => x.startsWith(prefix));
  }
  return t.templates.includes(tpl);
}

/** Drops expired and spent rules in place. */
export function pruneRules(rules: FaultRule[], now: number): FaultRule[] {
  return rules.filter((r) => r.expiresAt > now && (r.timesLeft === null || r.timesLeft > 0));
}
