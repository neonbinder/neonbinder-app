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
import { ebayTargetMode, type EbayTargetMode } from "./lib/ebayEnv";
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

/**
 * Clears one namespace's state (listings, photos, orders, faults, needs-model
 * misses). The fake keeps its catalogue misses, the recorder's to-do list,
 * until they are recorded.
 */
export const resetNamespace = internalAction({
  args: { ns: v.string() },
  returns: controlResult,
  handler: async (_ctx, args): Promise<ControlResult> => {
    if (!isOwnNamespace(args.ns)) return notFormed("namespace");
    return await control("reset", { ns: args.ns });
  },
});

/**
 * Clears every namespace under `prefix`: this deployment's own (`<slug>-`) or
 * narrower. Catalogue misses stay listed until recorded, as above.
 */
export const resetPrefix = internalAction({
  args: { prefix: v.string() },
  returns: controlResult,
  handler: async (_ctx, args): Promise<ControlResult> => {
    if (!isOwnPrefix(args.prefix)) return notFormed("prefix");
    return await control("reset", { prefix: args.prefix });
  },
});

/**
 * Installs fault rules on one namespace (replaces the old stall switch). One
 * list per namespace for both marketplaces (a post replaces it); eBay rules
 * (`ebay/...` templates, kinds `ebayError` and `unauthorized`) ride in it.
 */
export const setFaults = internalAction({
  args: { ns: v.string(), rules: v.array(fakeBscFaultRuleValidator) },
  returns: controlResult,
  handler: async (_ctx, args): Promise<ControlResult> => {
    const { ns } = args;
    if (!isOwnNamespace(ns)) return notFormed("namespace");
    if (args.rules.length > 50) return notFormed("rules");
    for (const rule of args.rules) {
      // NEO-555: eBay templates are longer than BSC's, and may end in `/*` (a prefix).
      // Never a bare `*`, a mid-path star or a `//` or `..` segment.
      const template = rule.match.pathTemplate;
      if (!/^[A-Za-z0-9/:_.-]{1,200}(?:\/\*)?$/.test(template) || template.includes("//") || template.includes("..")) {
        return notFormed("rules");
      }
      if (rule.kind === "ebayError" || rule.kind === "unauthorized") {
        if (!template.startsWith("ebay/")) return notFormed("rules");
      } else if (rule.status !== undefined || rule.errorIds !== undefined) {
        return notFormed("rules");
      }
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

/**
 * True when the fake's `/__fake/health` says its recordings and write captures
 * are still loading (`loading: true`, or `writeCaptures.loading: true`). Only a
 * boolean true counts: a body without it reads as loaded, as before.
 */
export function healthIsLoading(body: unknown): boolean {
  if (typeof body !== "object" || body === null) return false;
  if ((body as { loading?: unknown }).loading === true) return true;
  const wc = (body as { writeCaptures?: unknown }).writeCaptures;
  return typeof wc === "object" && wc !== null && (wc as { loading?: unknown }).loading === true;
}

/**
 * The most write endpoints a health answer may list; a longer list is unreadable, never cut short.
 * BSC's two plus the eBay writes the fake requires come to fifteen (NEO-555).
 */
const MAX_MISSING_CAPTURES = 20;

/**
 * The write endpoints named in the fake's `/__fake/health`, narrowed: fixed
 * vocabulary only. Null when the list is absent, longer than
 * `MAX_MISSING_CAPTURES`, holds any entry that is not an endpoint name, or the
 * answer is still loading: a loading fake has not read its captures, so its
 * list (empty or full) is never an answer.
 */
export function narrowMissingCaptures(body: unknown): string[] | null {
  if (healthIsLoading(body)) return null;
  const wc = typeof body === "object" && body !== null ? (body as { writeCaptures?: unknown }).writeCaptures : undefined;
  const missing = typeof wc === "object" && wc !== null ? (wc as { missing?: unknown }).missing : undefined;
  if (!Array.isArray(missing) || missing.length > MAX_MISSING_CAPTURES) return null;
  // An eBay capture may carry a variant after its path (`... /publish #refused`).
  const named = missing.filter(
    (m): m is string => typeof m === "string" && /^[A-Z]{3,7} [A-Za-z0-9/_.:-]{1,128}( #[a-z0-9_]{1,32})?$/.test(m),
  );
  // One unreadable entry makes the whole list unreadable: dropping it could
  // turn a real "missing" into "none missing".
  return named.length === missing.length ? named : null;
}

const writeCapturesResult = v.union(
  v.object({ ok: v.literal(true), skipped: v.boolean(), missing: v.array(v.string()) }),
  v.object({ ok: v.literal(false), status: v.optional(v.number()), error: v.string() }),
);
type WriteCapturesResult =
  | { ok: true; skipped: boolean; missing: string[] }
  | { ok: false; status?: number; error: string };

/**
 * The pauses between health reads while the fake says it is still loading
 * (a cold start reads every recording and capture from its bucket before it
 * can answer). 45 s of pauses in all; the reads themselves add a little.
 */
export const HEALTH_LOADING_PAUSES_MS: readonly number[] = [1_000, 2_000, 4_000, 8_000, 10_000, 10_000, 10_000];
/** A wall-clock stop as well, so slow health reads cannot stretch the wait past the pauses' budget. */
const HEALTH_LOADING_BUDGET_MS = HEALTH_LOADING_PAUSES_MS.reduce((a, b) => a + b, 0);

/**
 * Which required write endpoints (BSC's two and the eBay writes) the fake has no real capture for
 * (`/__fake/health` `writeCaptures.missing`; CONTRACT.md, "Write capture"). CI runs
 * it with the preview deploy key before seeding (`npx convex run
 * fakeBsc:writeCaptureStatus`) and fails when `missing` is not empty. Skipped
 * outside fake mode. A health body without the field is an error, never "none missing".
 * While the fake answers `loading: true` its list means nothing (the captures
 * are not read yet), so this asks again on `HEALTH_LOADING_PAUSES_MS`; still
 * loading after that is `fake still loading`, never a missing list.
 */
export const writeCaptureStatus = internalAction({
  args: {},
  returns: writeCapturesResult,
  handler: async (): Promise<WriteCapturesResult> => {
    const startedAt = Date.now();
    for (let read = 0; ; read += 1) {
      let res: Response | null;
      try {
        res = await controlFetch("__fake/health", "health", () => ({ method: "GET" }));
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.name : "unknown" };
      }
      if (res === null) return { ok: true, skipped: true, missing: [] };
      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined);
        return { ok: false, status: res.status, error: "http" };
      }
      const body: unknown = await res.json().catch(() => null);
      if (healthIsLoading(body)) {
        const elapsed = Date.now() - startedAt;
        const pause = HEALTH_LOADING_PAUSES_MS[read];
        if (pause === undefined || elapsed >= HEALTH_LOADING_BUDGET_MS) {
          logHealthLoading(read + 1, elapsed, true);
          return { ok: false, error: "fake still loading" };
        }
        logHealthLoading(read + 1, elapsed, false);
        await fakeBscControlClock.sleep(Math.min(pause, HEALTH_LOADING_BUDGET_MS - elapsed));
        continue;
      }
      const missing = narrowMissingCaptures(body);
      if (missing === null) return { ok: false, error: "health answer has no writeCaptures" };
      return { ok: true, skipped: false, missing };
    }
  },
});

function logHealthLoading(read: number, elapsedMs: number, gaveUp: boolean): void {
  console.log(
    JSON.stringify({
      msg: "fake_bsc_health_loading",
      platform: "bsc",
      operation: "health",
      read,
      gaveUp,
      ms: elapsedMs,
    }),
  );
}

// ── The fake eBay's test controls (NEO-555) ─────────────────────────────────
//
// Run-scoped like the BSC controls above (CONTRACT.md, "Consent and seller
// seeding"): `ns` must sit under this deployment's own prefix. Unlike them,
// they act only when THIS deployment is on the fake eBay (`EBAY_ENVIRONMENT=fake`
// and a usable fake target; `ebayTargetMode() === "fake"`): beside a sandbox
// or production eBay they send nothing. A caller seeds the namespace of a test
// user (`testing.fakeBscNamespaceFor`), the same one the user's BSC hops use.

/** Which seller of the namespace: `main` is the default, `alt` the second eBay account for the same NB user. */
export const fakeEbaySellerValidator = v.union(v.literal("main"), v.literal("alt"));
export type FakeEbaySeller = "main" | "alt";

/** One shipping service of a seeded fulfillment policy (the fake's own bounds). */
export const fakeEbayServiceValidator = v.object({
  code: v.string(),
  costCents: v.optional(v.number()),
  freeShipping: v.optional(v.boolean()),
  carrier: v.optional(v.string()),
});

/** One fulfillment policy the seller starts with: NB never creates shipping policies (NEO-423). */
export const fakeEbayFulfillmentPolicyValidator = v.object({
  name: v.string(),
  costType: v.optional(v.union(v.literal("FLAT_RATE"), v.literal("CALCULATED"))),
  services: v.array(fakeEbayServiceValidator),
});
export type FakeEbayFulfillmentPolicy = (typeof fakeEbayFulfillmentPolicyValidator)["type"];

/** One order a spec injects into the seller's order history, in NB's own terms; the fake renders eBay's wire shape. */
export const fakeEbayOrderValidator = v.object({
  orderId: v.optional(v.string()),
  paymentStatus: v.optional(
    v.union(
      v.literal("PAID"),
      v.literal("PARTIALLY_REFUNDED"),
      v.literal("FULLY_REFUNDED"),
      v.literal("PENDING"),
      v.literal("FAILED"),
    ),
  ),
  cancelled: v.optional(v.boolean()),
  fulfillmentStatus: v.optional(
    v.union(v.literal("NOT_STARTED"), v.literal("IN_PROGRESS"), v.literal("FULFILLED")),
  ),
  creationDateMs: v.optional(v.number()),
  lines: v.array(
    v.object({
      sku: v.optional(v.string()),
      title: v.optional(v.string()),
      quantity: v.number(),
      priceCents: v.optional(v.number()),
      listingId: v.optional(v.string()),
    }),
  ),
});
export type FakeEbayOrder = (typeof fakeEbayOrderValidator)["type"];

const EBAY_SERVICE_CODE = /^[A-Za-z0-9_]{1,64}$/;
const EBAY_ORDER_ID = /^[0-9A-Za-z-]{1,64}$/;
const isWhole = (n: unknown, min: number, max: number): boolean =>
  typeof n === "number" && Number.isInteger(n) && n >= min && n <= max;

/** The first reason a fulfillment-policy seed would be refused, or null. Mirrors the fake's own bounds so a bad seed never leaves. */
export function fulfillmentPoliciesRefusal(policies: FakeEbayFulfillmentPolicy[]): string | null {
  if (policies.length < 1 || policies.length > 10) return "fulfillmentPolicies must hold 1-10";
  for (const p of policies) {
    if (p.name.length < 1 || p.name.length > 64 || /[\u0000-\u001f\u007f]/.test(p.name)) return "policy name";
    if (p.services.length < 1 || p.services.length > 5) return "services must hold 1-5";
    for (const sv of p.services) {
      if (!EBAY_SERVICE_CODE.test(sv.code)) return "service code";
      if (sv.costCents !== undefined && !isWhole(sv.costCents, 0, 100_000)) return "service costCents";
      if (sv.carrier !== undefined && !EBAY_SERVICE_CODE.test(sv.carrier)) return "service carrier";
    }
  }
  return null;
}

/** The first reason an injected order would be refused, or null. */
export function ebayOrderRefusal(order: FakeEbayOrder): string | null {
  if (order.orderId !== undefined && !EBAY_ORDER_ID.test(order.orderId)) return "orderId";
  if (order.creationDateMs !== undefined && !(Number.isFinite(order.creationDateMs) && order.creationDateMs > 0 && order.creationDateMs < 8.64e15)) {
    return "creationDateMs";
  }
  if (order.lines.length < 1 || order.lines.length > 50) return "lines must hold 1-50 lines";
  for (const l of order.lines) {
    if (l.sku !== undefined && (l.sku.length < 1 || l.sku.length > 50)) return "line sku";
    if (l.title !== undefined && (l.title.length < 1 || l.title.length > 80 || /[\u0000-\u001f\u007f]/.test(l.title))) return "line title";
    if (!isWhole(l.quantity, 1, 1_000)) return "line quantity";
    if (l.priceCents !== undefined && !isWhole(l.priceCents, 0, 10_000_000)) return "line priceCents";
    if (l.listingId !== undefined && !/^\d{1,40}$/.test(l.listingId)) return "line listingId";
  }
  return null;
}

/** Fixed, secret-free reasons an eBay control did not run. */
type EbayControlFailure = { ok: false; status?: number; error: string; detail?: string };

/** The fake's own error text for a refused control: a short validation reason, never a secret. */
async function refusalDetail(res: Response): Promise<string | undefined> {
  const body: unknown = await res.json().catch(() => null);
  const text = typeof body === "object" && body !== null ? (body as { error?: unknown }).error : undefined;
  return typeof text === "string" ? text.slice(0, 200).replace(/[\u0000-\u001f\u007f]/g, " ") : undefined;
}

/**
 * POSTs `body` to `__fake/ebay/<route>`. `skipped` outside fake mode and when
 * this deployment is not on the fake eBay; otherwise the fake's JSON answer.
 */
async function ebayControl(
  route: "consent" | "seller" | "orders",
  body: unknown,
): Promise<{ kind: "skipped" } | { kind: "answer"; body: unknown } | ({ kind: "failed" } & EbayControlFailure)> {
  if (ebayTargetMode() !== "fake") return { kind: "skipped" };
  const payload = JSON.stringify(body);
  let res: Response | null;
  try {
    res = await controlFetch(`__fake/ebay/${route}`, `ebay/${route}`, () => ({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: payload,
    }));
  } catch (error) {
    return { kind: "failed", ok: false, error: error instanceof Error ? error.name : "unknown" };
  }
  if (res === null) return { kind: "skipped" };
  if (!res.ok) {
    const detail = await refusalDetail(res);
    return { kind: "failed", ok: false, status: res.status, error: "http", ...(detail !== undefined ? { detail } : {}) };
  }
  return { kind: "answer", body: await res.json().catch(() => null) };
}

const ebayControlFailure = v.object({
  ok: v.literal(false),
  status: v.optional(v.number()),
  error: v.string(),
  detail: v.optional(v.string()),
});

/**
 * A single-use authorization code for the namespace's seller (the fake's
 * `POST /__fake/ebay/consent`), which the ordinary code grant
 * (`credentials.connectEbay {code}`) exchanges: it replaces eBay's consent
 * page in fake mode. Throws, with a fixed message, when it cannot give one:
 * a namespace that is not this deployment's, a deployment not on the fake
 * eBay, or a fake that refused. Never returns a code from anywhere else.
 */
export const ebayConsent = internalAction({
  args: { ns: v.string(), seller: v.optional(fakeEbaySellerValidator) },
  returns: v.object({ code: v.string() }),
  handler: async (_ctx, args): Promise<{ code: string }> => {
    if (!isOwnNamespace(args.ns)) throw new Error("fake eBay consent refused: namespace");
    const out = await ebayControl("consent", { ns: args.ns, ...(args.seller !== undefined ? { seller: args.seller } : {}) });
    if (out.kind === "skipped") throw new Error("fake eBay consent unavailable: this deployment is not on the fake eBay");
    if (out.kind === "failed") throw new Error(`fake eBay consent failed: ${out.status ?? out.error}`);
    const code = typeof out.body === "object" && out.body !== null ? (out.body as { code?: unknown }).code : undefined;
    // The code is opaque, but bounded: the connect action refuses one over 4096 characters.
    if (typeof code !== "string" || code.length === 0 || code.length > 4096) {
      throw new Error("fake eBay consent failed: unreadable answer");
    }
    return { code };
  },
});

const ebaySellerResult = v.union(
  v.object({
    ok: v.literal(true),
    skipped: v.boolean(),
    fulfillmentPolicyIds: v.array(v.string()),
    optedIn: v.union(v.boolean(), v.null()),
  }),
  ebayControlFailure,
);
type EbaySellerResult =
  | { ok: true; skipped: boolean; fulfillmentPolicyIds: string[]; optedIn: boolean | null }
  | EbayControlFailure;

/**
 * Seeds the seller's account (the fake's `POST /__fake/ebay/seller`): the
 * Selling Policy Management opt-in, and shipping policies, which NB never
 * creates. Seeding policies opts the seller in unless `optedIn: false`.
 * Skipped outside the fake eBay. `fulfillmentPolicyIds` are the policies'
 * ids in the order given.
 */
export const ebaySeller = internalAction({
  args: {
    ns: v.string(),
    seller: v.optional(fakeEbaySellerValidator),
    optedIn: v.optional(v.boolean()),
    fulfillmentPolicies: v.optional(v.array(fakeEbayFulfillmentPolicyValidator)),
  },
  returns: ebaySellerResult,
  handler: async (_ctx, args): Promise<EbaySellerResult> => {
    if (!isOwnNamespace(args.ns)) return { ok: false, error: "namespace refused" };
    if (args.fulfillmentPolicies !== undefined) {
      const refusal = fulfillmentPoliciesRefusal(args.fulfillmentPolicies);
      if (refusal !== null) return { ok: false, error: "fulfillmentPolicies refused", detail: refusal };
    }
    const out = await ebayControl("seller", {
      ns: args.ns,
      ...(args.seller !== undefined ? { seller: args.seller } : {}),
      ...(args.optedIn !== undefined ? { optedIn: args.optedIn } : {}),
      ...(args.fulfillmentPolicies !== undefined ? { fulfillmentPolicies: args.fulfillmentPolicies } : {}),
    });
    if (out.kind === "skipped") return { ok: true, skipped: true, fulfillmentPolicyIds: [], optedIn: null };
    if (out.kind === "failed") {
      const { kind: _kind, ...failure } = out;
      return failure;
    }
    const b = typeof out.body === "object" && out.body !== null ? (out.body as Record<string, unknown>) : {};
    const ids = Array.isArray(b.fulfillmentPolicyIds)
      ? b.fulfillmentPolicyIds.filter((id): id is string => typeof id === "string").slice(0, 10)
      : [];
    return {
      ok: true,
      skipped: false,
      fulfillmentPolicyIds: ids,
      optedIn: typeof b.optedIn === "boolean" ? b.optedIn : null,
    };
  },
});

const ebayOrdersResult = v.union(
  v.object({ ok: v.literal(true), skipped: v.boolean(), orderIds: v.array(v.string()) }),
  ebayControlFailure,
);
type EbayOrdersResult = { ok: true; skipped: boolean; orderIds: string[] } | EbayControlFailure;

/**
 * Injects one order into the seller's order history (the fake's `POST
 * /__fake/ebay/orders`), in NB's terms (`fakeEbayOrderValidator`). A new PAID
 * order sells down its SKUs' offers, as eBay does; a known `orderId` replaces
 * its order (so a cancel or refund can follow a sale). Skipped outside the
 * fake eBay.
 */
export const ebayOrders = internalAction({
  args: { ns: v.string(), seller: v.optional(fakeEbaySellerValidator), order: fakeEbayOrderValidator },
  returns: ebayOrdersResult,
  handler: async (_ctx, args): Promise<EbayOrdersResult> => {
    if (!isOwnNamespace(args.ns)) return { ok: false, error: "namespace refused" };
    const refusal = ebayOrderRefusal(args.order);
    if (refusal !== null) return { ok: false, error: "order refused", detail: refusal };
    const out = await ebayControl("orders", {
      ns: args.ns,
      ...(args.seller !== undefined ? { seller: args.seller } : {}),
      order: args.order,
    });
    if (out.kind === "skipped") return { ok: true, skipped: true, orderIds: [] };
    if (out.kind === "failed") {
      const { kind: _kind, ...failure } = out;
      return failure;
    }
    const b = typeof out.body === "object" && out.body !== null ? (out.body as Record<string, unknown>) : {};
    const ids = Array.isArray(b.orderIds) ? b.orderIds.filter((id): id is string => typeof id === "string").slice(0, 20) : [];
    return { ok: true, skipped: false, orderIds: ids };
  },
});

/**
 * Which eBay this deployment's calls reach: `fake`, `sandbox`, `production`,
 * or `unconfigured` (nothing is sent). For CI and wrapper checks
 * (`npx convex run fakeBsc:ebayTarget`): a preview that does not say `fake`
 * would not talk to the fake eBay. Reads this deployment's own environment
 * only; sends nothing.
 */
export const ebayTarget = internalAction({
  args: {},
  returns: v.object({
    mode: v.union(v.literal("fake"), v.literal("sandbox"), v.literal("production"), v.literal("unconfigured")),
  }),
  handler: async (): Promise<{ mode: EbayTargetMode }> => ({ mode: ebayTargetMode() }),
});
