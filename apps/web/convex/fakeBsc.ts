"use node";

/**
 * NEO-552 — this deployment's handle on the standing fake BSC
 * (`services/fake-bsc`, CONTRACT.md): the ID token default-runtime callers
 * need for it, and the run-scoped test controls (reset, faults, orders,
 * misses). Every action is internal and a no-op, sending nothing, unless the
 * deployment is in fake mode (`resolveBscTarget`): on a production deployment
 * they cannot reach anything.
 *
 * Namespaces: a fake account is `nb+<convexSlug>-<userTag>@fake.invalid`, and
 * its namespace is `<convexSlug>-<userTag>` (`testing.fakeBscNamespaceFor`).
 * Every `ns` and `prefix` must sit under this deployment's own prefix
 * (`<convexSlug>-`, from `CONVEX_CLOUD_URL`), so one deployment cannot reset,
 * fault or read another's state.
 */
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { BscConfigError, fakeBscControlFetch, resolveBscTarget } from "./lib/bscHttp";
import {
  fakeBscFaultRuleValidator,
  fakeBscOrderValidator,
  fakeBscPrefixFor,
} from "./testing";
import { idTokenExpiresAt, nodeBscIdToken } from "./lib/bscFakeIdToken";

/**
 * Per control attempt. The fake answers at once once warm, but a cold start
 * (a new instance, recordings still loading) can take most of this.
 */
export const CONTROL_TIMEOUT_MS = 30_000;
/** One retry, on a network error or a 503 (a cold or loading fake); never on a timeout. */
const CONTROL_ATTEMPTS = 2;
/** The pause before the retry: the fake's Retry-After, within these bounds. */
const CONTROL_RETRY_DEFAULT_MS = 1_000;
const CONTROL_RETRY_MAX_MS = 5_000;

/** How the control retry pauses; a test replaces `sleep`. */
export const fakeBscControlClock = {
  sleep: (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** A throw worth one retry: not our own refusal, not the per-attempt timeout. */
function retryableThrow(error: unknown): boolean {
  if (error instanceof BscConfigError) return false;
  const name = error instanceof Error ? error.name : "";
  return name !== "TimeoutError" && name !== "AbortError";
}

function retryPauseMs(res: Response | null): number {
  const raw = res?.headers.get("retry-after");
  const seconds = raw !== null && raw !== undefined ? Number(raw) : NaN;
  if (!Number.isFinite(seconds) || seconds < 0) return CONTROL_RETRY_DEFAULT_MS;
  return Math.min(seconds * 1000, CONTROL_RETRY_MAX_MS);
}

/**
 * A control call to the fake (`__fake/...`, never `/api`, which goes
 * through `bscFetch` and the gate): at most two attempts, the second only
 * after a network error or a 503. Null outside fake mode, sending nothing.
 * Throws what the last attempt threw. Logs route, status and timing only.
 */
async function controlFetch(path: string, route: string, init: () => RequestInit): Promise<Response | null> {
  for (let attempt = 1; ; attempt += 1) {
    const startedAt = Date.now();
    let res: Response | null;
    try {
      res = await fakeBscControlFetch(
        path,
        { ...init(), signal: AbortSignal.timeout(CONTROL_TIMEOUT_MS) },
        { idToken: nodeBscIdToken },
      );
    } catch (error) {
      logControl(route, startedAt, undefined, error, attempt);
      if (attempt < CONTROL_ATTEMPTS && retryableThrow(error)) {
        await fakeBscControlClock.sleep(CONTROL_RETRY_DEFAULT_MS);
        continue;
      }
      throw error;
    }
    if (res === null) return null;
    logControl(route, startedAt, res.status, undefined, attempt);
    if (res.status === 503 && attempt < CONTROL_ATTEMPTS) {
      const pause = retryPauseMs(res);
      await res.body?.cancel().catch(() => undefined);
      await fakeBscControlClock.sleep(pause);
      continue;
    }
    return res;
  }
}
/** The most miss entries returned; the fake's list can be long. */
const MAX_MISSES = 500;

/** Namespace and prefix characters (a Convex slug, a hyphen, a hex tag). */
const NS_CHARS = /^[a-z0-9-]{1,128}$/;

/** This deployment's own prefix (`<convexSlug>-`), or null when it cannot be formed. */
function ownPrefix(): string | null {
  try {
    return fakeBscPrefixFor(process.env.CONVEX_CLOUD_URL);
  } catch {
    return null;
  }
}

/** True for a namespace of this deployment's: under its prefix, and longer than it. */
export function isOwnNamespace(ns: string, prefix: string | null = ownPrefix()): boolean {
  return prefix !== null && NS_CHARS.test(ns) && ns.startsWith(prefix) && ns.length > prefix.length;
}

/** True for a prefix at or under this deployment's own. */
export function isOwnPrefix(candidate: string, prefix: string | null = ownPrefix()): boolean {
  return prefix !== null && NS_CHARS.test(candidate) && candidate.startsWith(prefix);
}

const controlResult = v.union(
  v.object({ ok: v.literal(true), skipped: v.boolean() }),
  v.object({ ok: v.literal(false), status: v.optional(v.number()), error: v.string() }),
);
type ControlResult =
  | { ok: true; skipped: boolean }
  | { ok: false; status?: number; error: string };

/** POSTs `body` to `__fake/<route>`; no-op outside fake mode. Logs route, status and timing only. */
async function control(route: string, body: unknown): Promise<ControlResult> {
  const payload = JSON.stringify(body);
  let res: Response | null;
  try {
    res = await controlFetch(`__fake/${route}`, route, () => ({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: payload,
    }));
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.name : "unknown" };
  }
  if (res === null) return { ok: true, skipped: true };
  await res.body?.cancel().catch(() => undefined);
  return res.ok ? { ok: true, skipped: false } : { ok: false, status: res.status, error: "http" };
}

function logControl(route: string, startedAt: number, status?: number, error?: unknown, attempt = 1): void {
  console.log(
    JSON.stringify({
      msg: "fake_bsc_control",
      platform: "bsc",
      operation: route,
      attempt,
      ...(status !== undefined ? { status } : {}),
      ...(error !== undefined ? { error: error instanceof Error ? error.name : "unknown" } : {}),
      ms: Date.now() - startedAt,
    }),
  );
}

const notFormed = (what: string): ControlResult => ({ ok: false, error: `${what} refused` });

/**
 * A Google ID token for the fake's origin, for default-runtime callers
 * (`actionBscIdTokenSource`). Null outside fake mode.
 */
export const idToken = internalAction({
  args: {},
  returns: v.union(
    v.null(),
    v.object({ audience: v.string(), token: v.string(), expiresAt: v.number() }),
  ),
  handler: async () => {
    const target = resolveBscTarget(process.env);
    if (target.mode !== "fake") return null;
    const token = await nodeBscIdToken(target.origin);
    return {
      audience: target.origin,
      token,
      expiresAt: idTokenExpiresAt(token, Date.now() + 10 * 60_000),
    };
  },
});

/** Clears one namespace's state (listings, photos, orders, faults, misses). */
export const resetNamespace = internalAction({
  args: { ns: v.string() },
  returns: controlResult,
  handler: async (_ctx, args): Promise<ControlResult> => {
    if (!isOwnNamespace(args.ns)) return notFormed("namespace");
    return await control("reset", { ns: args.ns });
  },
});

/** Clears every namespace under `prefix`: this deployment's own (`<slug>-`) or narrower. */
export const resetPrefix = internalAction({
  args: { prefix: v.string() },
  returns: controlResult,
  handler: async (_ctx, args): Promise<ControlResult> => {
    if (!isOwnPrefix(args.prefix)) return notFormed("prefix");
    return await control("reset", { prefix: args.prefix });
  },
});

/** Installs fault rules on one namespace (replaces the old stall switch). */
export const setFaults = internalAction({
  args: { ns: v.string(), rules: v.array(fakeBscFaultRuleValidator) },
  returns: controlResult,
  handler: async (_ctx, args): Promise<ControlResult> => {
    const { ns } = args;
    if (!isOwnNamespace(ns)) return notFormed("namespace");
    if (args.rules.length > 50) return notFormed("rules");
    for (const rule of args.rules) {
      if (!/^[A-Za-z0-9/:_.-]{1,128}$/.test(rule.match.pathTemplate)) return notFormed("rules");
      if (rule.match.cardId !== undefined && !/^[A-Za-z0-9_-]{1,64}$/.test(rule.match.cardId)) {
        return notFormed("rules");
      }
    }
    return await control("faults", { ns, rules: args.rules });
  },
});

/**
 * Injects one order into a namespace's seller order history, in NB's terms
 * (`testing.fakeBscOrderValidator`, bounded by `testing.addMyBscOrder`); the
 * fake renders BSC's wire shape from it.
 */
export const addOrder = internalAction({
  args: { ns: v.string(), order: fakeBscOrderValidator },
  returns: controlResult,
  handler: async (_ctx, args): Promise<ControlResult> => {
    if (!isOwnNamespace(args.ns)) return notFormed("namespace");
    if (args.order.items.length > 50) return notFormed("order");
    return await control("orders", { ns: args.ns, order: args.order });
  },
});

/** One request the fake had no recording for. */
type FakeBscMiss = { method: string; path: string };

/** Narrows the fake's miss list; anything unreadable is dropped, never trusted. */
export function narrowMisses(body: unknown): FakeBscMiss[] {
  const list =
    typeof body === "object" && body !== null && Array.isArray((body as { misses?: unknown }).misses)
      ? ((body as { misses: unknown[] }).misses)
      : [];
  const out: FakeBscMiss[] = [];
  for (const item of list) {
    if (out.length >= MAX_MISSES) break;
    if (typeof item !== "object" || item === null) continue;
    const { method, path } = item as { method?: unknown; path?: unknown };
    if (typeof method !== "string" || typeof path !== "string") continue;
    if (!/^[A-Z]{3,7}$/.test(method) || path.length > 512) continue;
    out.push({ method, path });
  }
  return out;
}

const missesResult = v.union(
  v.object({
    ok: v.literal(true),
    skipped: v.boolean(),
    misses: v.array(v.object({ method: v.string(), path: v.string() })),
  }),
  v.object({ ok: v.literal(false), status: v.optional(v.number()), error: v.string() }),
);
type MissesResult =
  | { ok: true; skipped: boolean; misses: FakeBscMiss[] }
  | { ok: false; status?: number; error: string };

/** GETs `__fake/misses?<query>`; skipped outside fake mode. Caller auth only (no admin key). */
async function fetchMisses(query: string): Promise<MissesResult> {
  let res: Response | null;
  try {
    res = await controlFetch(`__fake/misses?${query}`, "misses", () => ({ method: "GET" }));
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.name : "unknown" };
  }
  if (res === null) return { ok: true, skipped: true, misses: [] };
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    return { ok: false, status: res.status, error: "http" };
  }
  const body: unknown = await res.json().catch(() => null);
  return { ok: true, skipped: false, misses: narrowMisses(body) };
}

/**
 * The requests the fake answered 501 (unrecorded) for in one namespace, so a
 * run can fail on them. Skipped outside fake mode.
 */
export const misses = internalAction({
  args: { ns: v.string() },
  returns: missesResult,
  handler: async (_ctx, args): Promise<MissesResult> => {
    if (!isOwnNamespace(args.ns)) return { ok: false, error: "namespace refused" };
    return await fetchMisses(`ns=${encodeURIComponent(args.ns)}`);
  },
});

/**
 * Every miss across this deployment's namespaces (`<slug>-`), for the E2E
 * report job (`npx convex run fakeBsc:reportMisses`). Skipped outside fake mode.
 */
export const reportMisses = internalAction({
  args: {},
  returns: missesResult,
  handler: async (): Promise<MissesResult> => {
    const prefix = ownPrefix();
    if (prefix === null) return { ok: false, error: "prefix refused" };
    return await fetchMisses(`prefix=${encodeURIComponent(prefix)}`);
  },
});

/** The write endpoints named in the fake's `/healthz`, narrowed: fixed vocabulary only. */
export function narrowMissingCaptures(body: unknown): string[] | null {
  const wc = typeof body === "object" && body !== null ? (body as { writeCaptures?: unknown }).writeCaptures : undefined;
  const missing = typeof wc === "object" && wc !== null ? (wc as { missing?: unknown }).missing : undefined;
  if (!Array.isArray(missing)) return null;
  return missing
    .filter((m): m is string => typeof m === "string" && /^[A-Z]{3,7} [A-Za-z0-9/_.:-]{1,128}$/.test(m))
    .slice(0, 20);
}

const writeCapturesResult = v.union(
  v.object({ ok: v.literal(true), skipped: v.boolean(), missing: v.array(v.string()) }),
  v.object({ ok: v.literal(false), status: v.optional(v.number()), error: v.string() }),
);
type WriteCapturesResult =
  | { ok: true; skipped: boolean; missing: string[] }
  | { ok: false; status?: number; error: string };

/**
 * Which BSC write endpoints the fake has no real capture for
 * (`/healthz` `writeCaptures.missing`; CONTRACT.md, "Write capture"). CI runs
 * it with the preview deploy key before seeding (`npx convex run
 * fakeBsc:writeCaptureStatus`) and fails when `missing` is not empty. Skipped
 * outside fake mode. A health body without the field is an error, never "none missing".
 */
export const writeCaptureStatus = internalAction({
  args: {},
  returns: writeCapturesResult,
  handler: async (): Promise<WriteCapturesResult> => {
    let res: Response | null;
    try {
      res = await controlFetch("healthz", "healthz", () => ({ method: "GET" }));
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.name : "unknown" };
    }
    if (res === null) return { ok: true, skipped: true, missing: [] };
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      return { ok: false, status: res.status, error: "http" };
    }
    const missing = narrowMissingCaptures(await res.json().catch(() => null));
    if (missing === null) return { ok: false, error: "health answer has no writeCaptures" };
    return { ok: true, skipped: false, missing };
  },
});
