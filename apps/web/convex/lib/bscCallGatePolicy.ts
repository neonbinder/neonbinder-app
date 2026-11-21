/**
 * NEO-552 — the BSC call gate's policy: the breaker and token bucket every
 * BuySportsCards call passes through (`bscFetch`, CONTRACT.md "BSC call
 * breaker"). Pure: no Convex imports, no clock of its own, no I/O.
 * `convex/bscCallGate.ts` stores the state (`marketplaceCallGates`, one row per
 * gate KEY: NEO-628, one `"deployment"` key against real BSC, one `ns:` key
 * per fake namespace; this policy is the same for every key and knows none of
 * them) and runs these functions inside its mutations; `lib/bscHttp.ts` classifies
 * each answer with `classifyBscAnswer` / `classifyBscThrow`.
 *
 * Why (NEO-482, NEO-487, the CI lockout): BSC's edge answers 429 and then
 * blocks the calling IP for 15 to 45 s, Convex deployments share egress IPs,
 * and a retry storm escalates into an account lockout. So:
 *
 *  - **A 429 opens the breaker** on the PR 451 ladder (moved here from
 *    `marketplaceCooldowns`): 15 s doubling to 120 s, or BSC's Retry-After
 *    when longer, up to 10 min. A 429 inside a live window does not escalate
 *    it. A 429 is never retried by any caller.
 *  - **A run of failures opens it too**: 5 consecutive 5xx / timeouts /
 *    network errors (a CloudFront 403 on a catalogue endpoint counts), the run
 *    forgotten after 5 idle minutes, opens on the failure ladder: 30 s
 *    doubling to 300 s.
 *  - **Half-open**: once a window closes while its streak is live, exactly
 *    one call (the probe) is granted, under a lease; everyone else is told
 *    "probing" until the lease ends. A probe that succeeds closes the breaker
 *    (streak 0); one that fails re-opens it, escalated.
 *  - **Token bucket** (a debt bucket): `tokens` refill at the tuning's rate up
 *    to `burst`; a grant of n takes n, and a negative balance is a wait the
 *    caller sleeps before sending. A wait past `MAX_WAIT_MS` is refused
 *    ("throttled") and nothing is taken. Against the fake there is no bucket
 *    at all (Jason, NEO-552): no wait and no "throttled", ever; the breaker
 *    and the probe work exactly as against BuySportsCards.
 *
 * Healthy path cost: one write per acquire (the bucket), and no outcome write
 * on a success unless the grant says `reportOutcome` (recovering).
 */

// ── The 429 ladder (PR 451 / NEO-482; formerly `marketplaceCooldowns`) ──────

export const COOLDOWN_BASE_MS = 15_000;
export const COOLDOWN_MAX_MS = 120_000;
/** BSC's Retry-After is honoured up to this, past `COOLDOWN_MAX_MS`. */
export const RETRY_AFTER_MAX_MS = 10 * 60_000;
/** Backstop only: the streak normally resets on a success. */
export const COOLDOWN_STREAK_RESET_MS = 15 * 60_000;

/** The fields of a window the 429 ladder reads. */
export type CooldownRow = { until: number; last429At: number; streak: number };

/** Whether `row` still carries a streak the next opening would escalate. Pure. */
export function streakIsLive(row: CooldownRow | null, now: number): boolean {
  return row !== null && row.streak > 0 && now - row.last429At <= COOLDOWN_STREAK_RESET_MS;
}

/**
 * The window a 429 at `now` opens, given the stored window. `escalated:
 * false` means the 429 landed inside a live window and its `until` stands.
 */
export function nextCooldown(
  row: CooldownRow | null,
  now: number,
  retryAfterMs?: number,
): { until: number; streak: number; escalated: boolean } {
  if (row && row.until > now) {
    return { until: row.until, streak: row.streak, escalated: false };
  }
  const streak = row && streakIsLive(row, now) ? row.streak + 1 : 1;
  const doubled = COOLDOWN_BASE_MS * 2 ** Math.min(streak - 1, 16);
  const base = Math.min(doubled, COOLDOWN_MAX_MS);
  const retryAfter =
    retryAfterMs !== undefined && Number.isFinite(retryAfterMs) && retryAfterMs > 0
      ? Math.min(retryAfterMs, RETRY_AFTER_MAX_MS)
      : 0;
  return { until: now + Math.max(base, retryAfter), streak, escalated: true };
}

/**
 * Whether a successful answer to a call asked at `askedAt` resets the streak:
 * only a call asked after the window closed proves the lockout lifted.
 */
export function successResetsStreak(row: CooldownRow | null, now: number, askedAt: number): boolean {
  return row !== null && row.streak > 0 && row.until <= now && askedAt >= row.until;
}

/**
 * Parses a Retry-After header: delta-seconds or an HTTP date. `undefined` for
 * anything else (a third party's header, so nothing is trusted beyond a
 * number; `nextCooldown` caps it).
 */
export function parseRetryAfterMs(value: string | null | undefined, now: number): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d{1,7}$/.test(trimmed)) return Number(trimmed) * 1000;
  if (trimmed.length > 64) return undefined;
  const at = Date.parse(trimmed);
  if (!Number.isFinite(at)) return undefined;
  return Math.max(0, at - now);
}

// ── The failure ladder ──────────────────────────────────────────────────────

/** Consecutive failures that open the breaker. */
export const FAILURE_RUN_OPENS_AT = 5;
/** A failure run with no failure for this long starts over. */
export const FAILURE_RUN_IDLE_RESET_MS = 5 * 60_000;
export const FAILURE_BASE_MS = 30_000;
export const FAILURE_MAX_MS = 300_000;

/** The failure-ladder window for an opening at `streak`. */
export function failureWindowMs(streak: number): number {
  return Math.min(FAILURE_BASE_MS * 2 ** Math.min(Math.max(streak, 1) - 1, 16), FAILURE_MAX_MS);
}

// ── The bucket and the probe ────────────────────────────────────────────────

/**
 * Calls per minute and the most that may go at once, or no bucket at all
 * (`unlimited`): never a wait, never "throttled".
 */
export type BscGateTuning = { perMinute: number; burst: number } | { unlimited: true };
/** BuySportsCards itself. No env override (a deliberate choice). */
export const REAL_BSC_TUNING: BscGateTuning = { perMinute: 60, burst: 10 };
/**
 * The fake is our own server: no rate cap (Jason, NEO-552). Only the breaker
 * applies, which the BSC fault specs drive.
 */
export const FAKE_BSC_TUNING: BscGateTuning = { unlimited: true };

/** The longest a grant may make its caller wait; longer is "throttled". */
export const MAX_WAIT_MS = 15_000;
/** The most calls one acquire may ask for (one wave). */
export const MAX_ACQUIRE_COUNT = 10;
/**
 * How long a half-open probe holds the gate. Longer than the longest
 * per-attempt timeout of any BSC call (`bscSeller`'s 90 s sheet read and PUT
 * are the longest), so a probe still in flight is never joined by a second.
 */
export const PROBE_LEASE_MS = 120_000;

/** The stored gate, minus its identity fields. */
export type BscGateState = {
  tokens: number;
  refilledAt: number;
  /** 0 when the breaker has never opened. */
  openUntil: number;
  openCause?: "429" | "failures";
  /** Openings in a row with no success between them. */
  streak: number;
  lastOpenedAt: number;
  consecutiveFailures: number;
  lastFailureAt: number;
  probeLeaseUntil?: number;
  /** The `grantedAt` of the probe holding the lease, so only it can release it. */
  probeGrantedAt?: number;
};

/** A fresh gate: a full bucket, closed. */
export function initialGateState(now: number, tuning: BscGateTuning): BscGateState {
  return {
    tokens: "unlimited" in tuning ? 0 : tuning.burst,
    refilledAt: now,
    openUntil: 0,
    streak: 0,
    lastOpenedAt: 0,
    consecutiveFailures: 0,
    lastFailureAt: 0,
  };
}

function asCooldownRow(s: BscGateState): CooldownRow {
  return { until: s.openUntil, last429At: s.lastOpenedAt, streak: s.streak };
}

/** The window closed, but its streak is live: the next call is a probe. */
export function isHalfOpen(s: BscGateState, now: number): boolean {
  return s.openUntil <= now && streakIsLive(asCooldownRow(s), now);
}

/** Clamps an acquire's `count` to 1..`MAX_ACQUIRE_COUNT`. */
export function clampAcquireCount(count: number): number {
  if (!Number.isFinite(count)) return 1;
  return Math.min(Math.max(Math.floor(count), 1), MAX_ACQUIRE_COUNT);
}

export type BscGateRefusalReason = "open" | "probing" | "throttled";

export type AcquireDecision =
  | {
      ok: true;
      /** How many of the asked calls may go (1 for a probe). */
      granted: number;
      /** Sleep this long before sending. */
      waitMs: number;
      grantedAt: number;
      /** Report a success (the gate is recovering); otherwise only failures. */
      reportOutcome: boolean;
      probe: boolean;
      /** The row to store, or null to write nothing (a grant with no bucket). */
      next: BscGateState | null;
    }
  | { ok: false; reason: BscGateRefusalReason; retryAt: number };

/**
 * Whether `count` calls may go at `now`. A refusal writes nothing (the caller
 * stores `next` only on a grant).
 */
export function decideAcquire(
  stored: BscGateState | null,
  now: number,
  count: number,
  tuning: BscGateTuning,
  maxWaitMs: number = MAX_WAIT_MS,
): AcquireDecision {
  const s = stored ?? initialGateState(now, tuning);
  if (s.openUntil > now) return { ok: false, reason: "open", retryAt: s.openUntil };
  const halfOpen = isHalfOpen(s, now);
  if (halfOpen && s.probeLeaseUntil !== undefined && s.probeLeaseUntil > now) {
    return { ok: false, reason: "probing", retryAt: s.probeLeaseUntil };
  }
  const want = halfOpen ? 1 : clampAcquireCount(count);
  if ("unlimited" in tuning) {
    // No bucket: only a probe's lease is worth storing; a healthy grant
    // writes nothing (every caller of one key shares this row).
    const reportOutcome = halfOpen || s.streak > 0 || s.consecutiveFailures > 0;
    if (!halfOpen) {
      return { ok: true, granted: want, waitMs: 0, grantedAt: now, reportOutcome, probe: false, next: null };
    }
    return {
      ok: true,
      granted: 1,
      waitMs: 0,
      grantedAt: now,
      reportOutcome,
      probe: true,
      next: { ...s, probeLeaseUntil: now + PROBE_LEASE_MS, probeGrantedAt: now },
    };
  }
  const maxWait = Math.min(Math.max(Number.isFinite(maxWaitMs) ? maxWaitMs : 0, 0), MAX_WAIT_MS);
  const ratePerMs = tuning.perMinute / 60_000;
  const elapsed = Math.max(0, now - s.refilledAt);
  const refilled = Math.min(tuning.burst, s.tokens + elapsed * ratePerMs);
  const after = refilled - want;
  const waitMs = after < 0 ? Math.ceil(-after / ratePerMs) : 0;
  if (waitMs > maxWait) return { ok: false, reason: "throttled", retryAt: now + waitMs };
  const next: BscGateState = { ...s, tokens: after, refilledAt: now };
  if (halfOpen) {
    next.probeLeaseUntil = now + waitMs + PROBE_LEASE_MS;
    next.probeGrantedAt = now;
  } else {
    delete next.probeLeaseUntil;
    delete next.probeGrantedAt;
  }
  return {
    ok: true,
    granted: want,
    waitMs,
    grantedAt: now,
    reportOutcome: halfOpen || s.streak > 0 || s.consecutiveFailures > 0,
    probe: halfOpen,
    next,
  };
}

export type BscGateOutcome = "success" | "rateLimited" | "failure";

export type OutcomeDecision = {
  /** The row to store, or null to write nothing. */
  next: BscGateState | null;
  /** Set when this outcome opened (or re-opened) the breaker. */
  opened?: { until: number; cause: "429" | "failures"; streak: number };
  /** Set when a probe's success closed it. */
  closed?: true;
};

/**
 * Applies one call's outcome. `grantedAt` is the grant the call went under:
 * a success from a grant made before the current window opened proves
 * nothing and is ignored.
 */
export function decideOutcome(
  stored: BscGateState | null,
  now: number,
  input: { grantedAt: number; outcome: BscGateOutcome; retryAfterMs?: number },
  tuning: BscGateTuning,
): OutcomeDecision {
  const s = stored ?? initialGateState(now, tuning);
  const live = streakIsLive(asCooldownRow(s), now);

  if (input.outcome === "rateLimited") {
    const next = nextCooldown(asCooldownRow(s), now, input.retryAfterMs);
    if (!next.escalated) return { next: null };
    return {
      next: {
        ...withoutLease(s),
        openUntil: next.until,
        openCause: "429",
        streak: next.streak,
        lastOpenedAt: now,
        consecutiveFailures: 0,
      },
      opened: { until: next.until, cause: "429", streak: next.streak },
    };
  }

  if (input.outcome === "failure") {
    // Calls already in flight when the window opened: no escalation.
    if (s.openUntil > now) return { next: null };
    const failedProbe = live && s.streak > 0 && input.grantedAt >= s.openUntil;
    const run =
      now - s.lastFailureAt > FAILURE_RUN_IDLE_RESET_MS ? 1 : s.consecutiveFailures + 1;
    if (failedProbe || run >= FAILURE_RUN_OPENS_AT) {
      const streak = live ? s.streak + 1 : 1;
      const until = now + failureWindowMs(streak);
      return {
        next: {
          ...withoutLease(s),
          openUntil: until,
          openCause: "failures",
          streak,
          lastOpenedAt: now,
          consecutiveFailures: 0,
          lastFailureAt: now,
        },
        opened: { until, cause: "failures", streak },
      };
    }
    return { next: { ...s, consecutiveFailures: run, lastFailureAt: now } };
  }

  // success
  if (stored === null || input.grantedAt < s.openUntil) return { next: null };
  const closes = s.streak > 0 && s.openUntil <= now;
  if (!closes && s.consecutiveFailures === 0) return { next: null };
  const next: BscGateState = { ...withoutLease(s), consecutiveFailures: 0 };
  if (closes) {
    next.streak = 0;
    return { next, closed: true };
  }
  return { next };
}

function withoutLease(s: BscGateState): BscGateState {
  const copy = { ...s };
  delete copy.probeLeaseUntil;
  delete copy.probeGrantedAt;
  return copy;
}

/**
 * A probe that ended with no outcome to report (the fake's 501 unrecorded,
 * or a throw before anything was sent) hands its lease back, so the next
 * caller probes at once instead of waiting out the lease. Only the probe
 * that holds the lease can release it; nothing else (no token) is refunded.
 */
export function decideReleaseProbe(stored: BscGateState | null, grantedAt: number): BscGateState | null {
  if (!stored || stored.probeLeaseUntil === undefined || stored.probeGrantedAt !== grantedAt) return null;
  return withoutLease(stored);
}

/**
 * NEO-552 — the re-check after a grant's wait. A probe's own lease is not a
 * reason to refuse it (it IS the lease holder), so a probe is blocked only by
 * a window opened meanwhile; any other grant by anything that blocks.
 */
export function blockedAfterWait(
  s: BscGateState | null,
  now: number,
  probe: boolean,
): number | null {
  if (!probe) return blockedUntil(s, now);
  return s && s.openUntil > now ? s.openUntil : null;
}

/** Until when the gate blocks every caller, or null when a call may be asked. */
export function blockedUntil(s: BscGateState | null, now: number): number | null {
  if (!s) return null;
  if (s.openUntil > now) return s.openUntil;
  if (isHalfOpen(s, now) && s.probeLeaseUntil !== undefined && s.probeLeaseUntil > now) {
    return s.probeLeaseUntil;
  }
  return null;
}

// ── Classifying an answer ───────────────────────────────────────────────────

/** The catalogue reads, where a CloudFront/WAF 403 is BSC's edge refusing us. */
export const BSC_CATALOGUE_PATH_TEMPLATES: ReadonlySet<string> = new Set([
  "search/bulk-upload/filters",
  "search/bulk-upload/results",
  "marketplace/card/:id/card-listing",
]);

/** What one answer means to the gate; `neutral` is not reported at all. */
export type BscAnswerClass =
  | { kind: "success" }
  | { kind: "rateLimited"; retryAfterMs?: number }
  | { kind: "failure" }
  | { kind: "neutral" };

/**
 * Classifies an answer. A non-429 4xx is BSC answering (a success to the gate:
 * its edge is not blocking us), except a 403 on a catalogue read, which is
 * CloudFront refusing. The fake's 501 `x-nb-fake: unrecorded` and 503
 * `x-nb-fake: loading` are neither: the fake answered for itself (a missing
 * recording, or recordings still loading), not for BSC.
 */
export function classifyBscAnswer(
  status: number,
  header: (name: string) => string | null,
  pathTemplate: string,
  now: number,
): BscAnswerClass {
  if (status === 429) {
    const retryAfterMs = parseRetryAfterMs(header("retry-after"), now);
    return retryAfterMs !== undefined ? { kind: "rateLimited", retryAfterMs } : { kind: "rateLimited" };
  }
  if (status === 501 && header("x-nb-fake") === "unrecorded") return { kind: "neutral" };
  // The fake still loading its recordings (it held the request first): the
  // fake answering for itself, not BSC failing.
  if (status === 503 && header("x-nb-fake") === "loading") return { kind: "neutral" };
  if (status >= 500) return { kind: "failure" };
  if (status === 403 && BSC_CATALOGUE_PATH_TEMPLATES.has(pathTemplate)) return { kind: "failure" };
  return { kind: "success" };
}

/** A thrown fetch (a timeout or a network error) is a failure. */
export function classifyBscThrow(): BscAnswerClass {
  return { kind: "failure" };
}
