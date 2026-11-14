/**
 * NEO-552 — the deployment-wide BSC call gate (CONTRACT.md, "BSC call
 * breaker"): one `marketplaceCallGates` row holding the breaker and the token
 * bucket every BuySportsCards call passes through. Default runtime, all
 * internal. The policy is pure, in `lib/bscCallGatePolicy.ts`; this module
 * stores it, and `bscCallGateFor(ctx)` binds it to `bscFetch`.
 *
 *  - `acquire({count, maxWaitMs?})` before a call (or a wave): a grant with a
 *    wait to sleep, or a refusal ("open", "probing", "throttled") that writes
 *    nothing.
 *  - `recordOutcome({grantedAt, outcome, retryAfterMs?})` after any 429, any
 *    failure, and a success only when the grant said `reportOutcome`.
 *  - `state()` for a caller that slept on a grant's wait, and for the team
 *    lane's push-back.
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
  blockedUntil,
  decideAcquire,
  decideOutcome,
  type BscGateState,
  type BscGateTuning,
} from "./lib/bscCallGatePolicy";
import { resolveBscTarget, type BscCallGate, type BscGrant } from "./lib/bscHttp";

const PLATFORM = "bsc" as const;
const SCOPE = "deployment" as const;

/** The bucket for where this deployment's BSC calls go. */
function tuning(): BscGateTuning {
  return resolveBscTarget(process.env).mode === "fake" ? FAKE_BSC_TUNING : REAL_BSC_TUNING;
}

async function readRow(
  ctx: QueryCtx | MutationCtx,
): Promise<Doc<"marketplaceCallGates"> | null> {
  return await ctx.db
    .query("marketplaceCallGates")
    .withIndex("by_platform_scope", (q) => q.eq("platform", PLATFORM).eq("scope", SCOPE))
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
  };
}

/**
 * Stores `next`. A patch replaces the optional fields explicitly, so a lease
 * or a cause the policy dropped is cleared, not left behind. Two racing first
 * acquires are serialised by OCC on the index range, so one row results.
 */
async function writeRow(
  ctx: MutationCtx,
  row: Doc<"marketplaceCallGates"> | null,
  next: BscGateState,
  now: number,
): Promise<void> {
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
    updatedAt: now,
  };
  if (row) {
    await ctx.db.patch(row._id, fields);
  } else {
    const { openCause, probeLeaseUntil, ...rest } = fields;
    await ctx.db.insert("marketplaceCallGates", {
      platform: PLATFORM,
      scope: SCOPE,
      ...rest,
      ...(openCause !== undefined ? { openCause } : {}),
      ...(probeLeaseUntil !== undefined ? { probeLeaseUntil } : {}),
    });
  }
}

const refusalReason = v.union(v.literal("open"), v.literal("probing"), v.literal("throttled"));

export const acquire = internalMutation({
  args: {
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
    const row = await readRow(ctx);
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
    await writeRow(ctx, row, decision.next, now);
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
    /** The grant the call went under (`acquire`'s `grantedAt`). */
    grantedAt: v.number(),
    outcome: v.union(v.literal("success"), v.literal("rateLimited"), v.literal("failure")),
    /** BSC's Retry-After, already parsed (a 429 only). */
    retryAfterMs: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now();
    const row = await readRow(ctx);
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
    await writeRow(ctx, row, decision.next, now);
    if (decision.opened) {
      console.warn(
        JSON.stringify({
          msg: "bsc_gate_opened",
          platform: PLATFORM,
          operation: "recordOutcome",
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

/** Until when no BSC call may be asked (an open window or a live probe), or null. */
export const state = internalQuery({
  args: {},
  returns: v.object({ blockedUntil: v.union(v.number(), v.null()) }),
  handler: async (ctx) => {
    const row = await readRow(ctx);
    return { blockedUntil: blockedUntil(row ? toState(row) : null, Date.now()) };
  },
});

/**
 * Testing only (armed by `TESTING_RESET_SECRET`, which only a test deployment
 * carries): clears the gate, for the teardown of the breaker fault specs,
 * which run serially.
 */
export const clearForTesting = internalMutation({
  args: {},
  returns: v.object({ deleted: v.number() }),
  handler: async (ctx) => {
    if (!process.env.TESTING_RESET_SECRET) {
      throw new ConvexError("The BSC call gate can be cleared only on a test deployment");
    }
    const rows = await ctx.db
      .query("marketplaceCallGates")
      .withIndex("by_platform_scope", (q) => q.eq("platform", PLATFORM).eq("scope", SCOPE))
      .take(10);
    for (const row of rows) await ctx.db.delete(row._id);
    return { deleted: rows.length };
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
 * The gate as `bscFetch` and the wave callers use it, bound to an action's
 * ctx. Fails closed: a gate that cannot be asked is a refusal
 * ("gate_unavailable"), never a call. A grant with a wait is slept here, then
 * the gate is read once more; a window opened meanwhile refuses it.
 */
export function bscCallGateFor(ctx: Pick<ActionCtx, "runMutation" | "runQuery">): BscCallGate {
  // A failure this caller reported that no reported success has followed
  // yet: the next success is worth a write, because it ends the run.
  let failurePending = false;
  return {
    async acquire(count) {
      let decision;
      try {
        decision = await ctx.runMutation(internal.bscCallGate.acquire, { count });
        if (typeof decision?.ok !== "boolean") throw new TypeError("unreadable gate answer");
      } catch (error) {
        logGateError("acquire", error);
        return { ok: false, reason: "gate_unavailable", retryAt: Date.now() };
      }
      if (!decision.ok) return decision;
      if (decision.waitMs > 0) {
        await bscGateClock.sleep(decision.waitMs);
        try {
          const now = await ctx.runQuery(internal.bscCallGate.state, {});
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
        grantedAt: grant.grantedAt,
        outcome,
        ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
      });
    },
    async blockedUntil() {
      try {
        const now = await ctx.runQuery(internal.bscCallGate.state, {});
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
