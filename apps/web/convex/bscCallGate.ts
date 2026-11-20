/**
 * NEO-552 — the BSC call gate (CONTRACT.md, "BSC call breaker"): one
 * `marketplaceCallGates` row per KEY, holding the breaker and the token bucket
 * every BuySportsCards call passes through. Default runtime, all internal. The
 * policy is pure, in `lib/bscCallGatePolicy.ts`; this module stores it, and
 * `bscCallGateFor(ctx, key)` binds it to `bscFetch`.
 *
 * NEO-628 (NEO-629) — the key is the rate-limit domain a call lands in
 * (`lib/bscGateKey.ts`). Against real BSC there is ONE key, `"deployment"`
 * (its 429s are per egress IP, shared by every user). Against the fake there
 * is one key per fake namespace (`ns:<namespace>`, one per test user), so a
 * fault injected into one user's namespace closes only that user's gate. Each
 * key keeps today's behaviour exactly: the 429 ladder, the five-failure trip
 * and the token bucket. The row's `scope` column holds the key.
 *
 *  - `acquire({key, count, maxWaitMs?})` before a call (or a wave): a grant
 *    with a wait to sleep, or a refusal ("open", "probing", "throttled") that
 *    writes nothing.
 *  - `recordOutcome({key, grantedAt, outcome, retryAfterMs?})` after any 429,
 *    any failure, and a success only when the grant said `reportOutcome`.
 *  - `state({key})` for a caller that slept on a grant's wait, and for the
 *    team lane's push-back.
 *
 * Rate and burst come from the deployment, never from args: the fake gets a
 * faster bucket (`resolveBscTarget`), BuySportsCards the measured one.
 */
import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery, type ActionCtx } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import {
  FAKE_BSC_TUNING,
  REAL_BSC_TUNING,
  blockedAfterWait,
  blockedUntil,
  decideAcquire,
  decideOutcome,
  decideReleaseProbe,
  type BscGateState,
  type BscGateTuning,
} from "./lib/bscCallGatePolicy";
import { resolveBscTarget, type BscCallGate, type BscGrant } from "./lib/bscHttp";
import {
  BSC_GATE_DEPLOYMENT_KEY,
  bscGateKey,
  bscGateKeyKind,
  isBscGateKey,
} from "./lib/bscGateKey";
import { fakeBscNamespaceFor, fakeBscPrefixFor } from "./lib/fakeBscNamespace";

const PLATFORM = "bsc" as const;

/** The bucket for where this deployment's BSC calls go. */
function tuning(): BscGateTuning {
  return resolveBscTarget(process.env).mode === "fake" ? FAKE_BSC_TUNING : REAL_BSC_TUNING;
}

/**
 * The row's `scope` for a gate key. THE one place a key is checked, called by
 * every read, insert and delete of a row, and failing closed: a value that is
 * not `"deployment"` or `ns:<namespace>` is refused, and an `ns:` key is
 * honoured only when this deployment is on the fake BSC (a real-mode
 * deployment has one key, whatever a caller asks for).
 */
export function gateScopeFor(key: string): string {
  if (!isBscGateKey(key)) throw new ConvexError("Unreadable BSC gate key");
  if (key !== BSC_GATE_DEPLOYMENT_KEY && resolveBscTarget(process.env).mode !== "fake") {
    throw new ConvexError("A per-namespace BSC gate key needs the fake BSC");
  }
  return key;
}

async function readRow(
  ctx: QueryCtx | MutationCtx,
  key: string,
): Promise<Doc<"marketplaceCallGates"> | null> {
  const scope = gateScopeFor(key);
  return await ctx.db
    .query("marketplaceCallGates")
    .withIndex("by_platform_scope", (q) => q.eq("platform", PLATFORM).eq("scope", scope))
    .unique();
}

function toState(row: Doc<"marketplaceCallGates">): BscGateState {
  return {
    tokens: row.tokens,
    refilledAt: row.refilledAt,
    openUntil: row.openUntil,
    ...(row.openCause !== undefined ? { openCause: row.openCause } : {}),
    streak: row.streak,
    lastOpenedAt: row.lastOpenedAt,
    consecutiveFailures: row.consecutiveFailures,
    lastFailureAt: row.lastFailureAt,
    ...(row.probeLeaseUntil !== undefined ? { probeLeaseUntil: row.probeLeaseUntil } : {}),
    ...(row.probeGrantedAt !== undefined ? { probeGrantedAt: row.probeGrantedAt } : {}),
  };
}

/**
 * Stores `next`. A patch replaces the optional fields explicitly, so a lease
 * or a cause the policy dropped is cleared, not left behind. Two racing first
 * acquires are serialised by OCC on the index range, so one row results.
 */
async function writeRow(
  ctx: MutationCtx,
  key: string,
  row: Doc<"marketplaceCallGates"> | null,
  next: BscGateState,
  now: number,
): Promise<void> {
  const scope = gateScopeFor(key);
  const fields = {
    tokens: next.tokens,
    refilledAt: next.refilledAt,
    openUntil: next.openUntil,
    openCause: next.openCause,
    streak: next.streak,
    lastOpenedAt: next.lastOpenedAt,
    consecutiveFailures: next.consecutiveFailures,
    lastFailureAt: next.lastFailureAt,
    probeLeaseUntil: next.probeLeaseUntil,
    probeGrantedAt: next.probeGrantedAt,
    updatedAt: now,
  };
  if (row) {
    await ctx.db.patch(row._id, fields);
  } else {
    const { openCause, probeLeaseUntil, probeGrantedAt, ...rest } = fields;
    await ctx.db.insert("marketplaceCallGates", {
      platform: PLATFORM,
      scope,
      ...rest,
      ...(openCause !== undefined ? { openCause } : {}),
      ...(probeLeaseUntil !== undefined ? { probeLeaseUntil } : {}),
      ...(probeGrantedAt !== undefined ? { probeGrantedAt } : {}),
    });
  }
}

const refusalReason = v.union(v.literal("open"), v.literal("probing"), v.literal("throttled"));

/** A key an in-flight caller from before NEO-628 did not send is the deployment's. */
const gateKeyArg = v.optional(v.string());

export const acquire = internalMutation({
  args: {
    /** The rate-limit domain (`lib/bscGateKey.ts`); absent = `"deployment"`. */
    key: gateKeyArg,
    /** Calls wanted (one wave); clamped to 1..10. A half-open gate grants 1. */
    count: v.number(),
    /** The most the caller will wait; capped at `MAX_WAIT_MS`. */
    maxWaitMs: v.optional(v.number()),
  },
  returns: v.union(
    v.object({
      ok: v.literal(true),
      granted: v.number(),
      waitMs: v.number(),
      grantedAt: v.number(),
      reportOutcome: v.boolean(),
      probe: v.boolean(),
    }),
    v.object({ ok: v.literal(false), reason: refusalReason, retryAt: v.number() }),
  ),
  handler: async (ctx, args) => {
    const now = Date.now();
    const key = args.key ?? BSC_GATE_DEPLOYMENT_KEY;
    const row = await readRow(ctx, key);
    const decision = decideAcquire(
      row ? toState(row) : null,
      now,
      args.count,
      tuning(),
      args.maxWaitMs,
    );
    if (!decision.ok) {
      return { ok: false as const, reason: decision.reason, retryAt: decision.retryAt };
    }
    if (decision.next) await writeRow(ctx, key, row, decision.next, now);
    if (decision.probe) {
      // Platform, operation and timing only.
      console.log(
        JSON.stringify({ msg: "bsc_gate_probe", platform: PLATFORM, operation: "acquire", waitMs: decision.waitMs }),
      );
    }
    return {
      ok: true as const,
      granted: decision.granted,
      waitMs: decision.waitMs,
      grantedAt: decision.grantedAt,
      reportOutcome: decision.reportOutcome,
      probe: decision.probe,
    };
  },
});

export const recordOutcome = internalMutation({
  args: {
    key: gateKeyArg,
    /** The grant the call went under (`acquire`'s `grantedAt`). */
    grantedAt: v.number(),
    outcome: v.union(v.literal("success"), v.literal("rateLimited"), v.literal("failure")),
    /** BSC's Retry-After, already parsed (a 429 only). */
    retryAfterMs: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now();
    const key = args.key ?? BSC_GATE_DEPLOYMENT_KEY;
    const row = await readRow(ctx, key);
    const decision = decideOutcome(
      row ? toState(row) : null,
      now,
      {
        grantedAt: args.grantedAt,
        outcome: args.outcome,
        ...(args.retryAfterMs !== undefined ? { retryAfterMs: args.retryAfterMs } : {}),
      },
      tuning(),
    );
    if (!decision.next) return null;
    await writeRow(ctx, key, row, decision.next, now);
    if (decision.opened) {
      console.warn(
        JSON.stringify({
          msg: "bsc_gate_opened",
          platform: PLATFORM,
          operation: "recordOutcome",
          // The kind only: a namespace names a test user's run on the fake.
          keyKind: bscGateKeyKind(key),
          cause: decision.opened.cause,
          streak: decision.opened.streak,
          ms: decision.opened.until - now,
        }),
      );
    } else if (decision.closed) {
      console.log(JSON.stringify({ msg: "bsc_gate_closed", platform: PLATFORM, operation: "recordOutcome" }));
    }
    return null;
  },
});

/**
 * Until when no BSC call may be asked (an open window or a live probe), or
 * null. `probe: true` is the re-check of a probe that slept on its grant: its
 * own lease does not block it, only a window opened meanwhile.
 */
export const state = internalQuery({
  args: { key: gateKeyArg, probe: v.optional(v.boolean()) },
  returns: v.object({ blockedUntil: v.union(v.number(), v.null()) }),
  handler: async (ctx, args) => {
    const row = await readRow(ctx, args.key ?? BSC_GATE_DEPLOYMENT_KEY);
    const s = row ? toState(row) : null;
    const now = Date.now();
    return { blockedUntil: args.probe ? blockedAfterWait(s, now, true) : blockedUntil(s, now) };
  },
});

/**
 * Hands back a probe's lease when the probe ended with nothing to report (a
 * neutral answer, or a throw before it was sent). Only the grant holding the
 * lease can; anything else writes nothing.
 */
export const releaseProbe = internalMutation({
  args: { key: gateKeyArg, grantedAt: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const key = args.key ?? BSC_GATE_DEPLOYMENT_KEY;
    const row = await readRow(ctx, key);
    const next = decideReleaseProbe(row ? toState(row) : null, args.grantedAt);
    if (!next || !row) return null;
    await writeRow(ctx, key, row, next, Date.now());
    console.log(JSON.stringify({ msg: "bsc_gate_probe_released", platform: PLATFORM, operation: "releaseProbe" }));
    return null;
  },
});

/**
 * Testing only (armed by `TESTING_RESET_SECRET`, which only a test deployment
 * carries): clears ONE gate, the `ns:` key it is given, for the teardown of
 * the breaker fault specs. It deletes exactly that row and refuses
 * `"deployment"`: the real BSC's one gate is never cleared from here (the
 * global reset drains every row, whatever its scope).
 */
export const clearForTesting = internalMutation({
  args: { key: v.string() },
  returns: v.object({ deleted: v.number() }),
  handler: async (ctx, args) => {
    if (!process.env.TESTING_RESET_SECRET) {
      throw new ConvexError("The BSC call gate can be cleared only on a test deployment");
    }
    if (args.key === BSC_GATE_DEPLOYMENT_KEY) {
      throw new ConvexError("The deployment's BSC call gate is not cleared one key at a time");
    }
    const row = await readRow(ctx, args.key);
    if (!row) return { deleted: 0 };
    await ctx.db.delete(row._id);
    return { deleted: 1 };
  },
});

/**
 * How a grant's wait is slept. An object so a test can replace `sleep` (and
 * move its own clock instead of waiting real seconds); nothing else
 * reassigns it.
 */
export const bscGateClock = {
  sleep: (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms)),
};

/**
 * Where a BSC call lands, as ONE value: the gate key and the namespace sent to
 * the fake (`x-nb-fake-ns`). Every call site derives both from this, so a call
 * can never key the gate on one namespace and send another.
 *
 * `userId` is whose namespace the call belongs to: the owner of the BSC token
 * it carries, or the operator a background item was queued by; null for a
 * call with no user (it then belongs to the deployment's prefix on the fake).
 * Real mode, and a fake deployment that cannot form a namespace, are the
 * `"deployment"` key with no `fakeNs`.
 */
export type BscCallDomain = { gateKey: string; fakeNs?: string };

export function bscCallDomainFor(
  userId: string | null | undefined,
  env: Readonly<Record<string, string | undefined>> = process.env,
): BscCallDomain {
  const mode = resolveBscTarget(env).mode;
  if (mode !== "fake") return { gateKey: BSC_GATE_DEPLOYMENT_KEY };
  let fakeNs: string | undefined;
  try {
    fakeNs = userId
      ? fakeBscNamespaceFor(userId, env.CONVEX_CLOUD_URL)
      : fakeBscPrefixFor(env.CONVEX_CLOUD_URL);
  } catch {
    fakeNs = undefined;
  }
  return { gateKey: bscGateKey({ mode, fakeNs }), ...(fakeNs !== undefined ? { fakeNs } : {}) };
}

/**
 * The gate as `bscFetch` and the wave callers use it, bound to an action's
 * ctx and to ONE key (`bscCallDomainFor(...).gateKey`). Fails closed: a gate that cannot be asked is a refusal
 * ("gate_unavailable"), never a call. A grant with a wait is slept here, then
 * the gate is read once more; a window opened meanwhile refuses it.
 */
export function bscCallGateFor(
  ctx: Pick<ActionCtx, "runMutation" | "runQuery">,
  key: string,
): BscCallGate {
  // A failure this caller reported that no reported success has followed
  // yet: the next success is worth a write, because it ends the run.
  let failurePending = false;
  return {
    async acquire(count) {
      let decision;
      try {
        decision = await ctx.runMutation(internal.bscCallGate.acquire, { key, count });
        if (typeof decision?.ok !== "boolean") throw new TypeError("unreadable gate answer");
      } catch (error) {
        logGateError("acquire", error);
        return { ok: false, reason: "gate_unavailable", retryAt: Date.now() };
      }
      if (!decision.ok) return decision;
      if (decision.waitMs > 0) {
        await bscGateClock.sleep(decision.waitMs);
        try {
          // A probe is never refused by its own lease, only by a new window.
          const now = await ctx.runQuery(internal.bscCallGate.state, decision.probe ? { key, probe: true } : { key });
          if (now?.blockedUntil === undefined) throw new TypeError("unreadable gate state");
          if (now.blockedUntil !== null) {
            return { ok: false, reason: "open", retryAt: now.blockedUntil };
          }
        } catch (error) {
          logGateError("state", error);
          return { ok: false, reason: "gate_unavailable", retryAt: Date.now() };
        }
      }
      const grant: BscGrant = {
        grantedAt: decision.grantedAt,
        reportOutcome: decision.reportOutcome,
        probe: decision.probe,
      };
      return { ok: true, granted: decision.granted, grant };
    },
    wantsSuccess(grant) {
      return grant.reportOutcome || failurePending;
    },
    async record(grant, outcome, retryAfterMs) {
      failurePending = outcome !== "success";
      await ctx.runMutation(internal.bscCallGate.recordOutcome, {
        key,
        grantedAt: grant.grantedAt,
        outcome,
        ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
      });
    },
    async release(grant) {
      if (!grant.probe) return;
      await ctx.runMutation(internal.bscCallGate.releaseProbe, { key, grantedAt: grant.grantedAt });
    },
    async blockedUntil() {
      try {
        const now = await ctx.runQuery(internal.bscCallGate.state, { key });
        if (now?.blockedUntil === undefined) throw new TypeError("unreadable gate state");
        return now.blockedUntil;
      } catch (error) {
        logGateError("state", error);
        // Fail closed: an unreadable gate blocks for one base window.
        return Date.now() + GATE_UNAVAILABLE_BLOCK_MS;
      }
    },
  };
}

/** How long an unreadable gate counts as blocked for a caller that only reads it. */
const GATE_UNAVAILABLE_BLOCK_MS = 15_000;

function logGateError(operation: string, error: unknown): void {
  console.warn(
    JSON.stringify({
      msg: "bsc_gate_unavailable",
      platform: PLATFORM,
      operation,
      error: error instanceof Error ? error.name : "unknown",
    }),
  );
}
