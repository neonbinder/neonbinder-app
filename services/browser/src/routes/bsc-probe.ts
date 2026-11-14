import { Request, Response, Router } from "express";
import { BscTarget, bscApiHeaders, resolveBscEndpoints } from "../bsc-endpoints";
import { BscFetchOptions, bscFetch } from "../bsc-fetch";
import { canonicalJson, shapeMap } from "../bsc-shape";
import {
  BscPasswordSignInInput,
  BscPasswordSignInResult,
  BscSignInStep,
  bscPasswordSignIn,
} from "../bsc-signin";
import { shouldSkipCanary } from "../canary-pause";
import { SecretsManagerService } from "../services/secrets-manager";
import { parseTransientCredentials } from "../transient-credentials";

/**
 * NEO-552: `POST /probe/bsc`, the prod deploy check and the daily drift
 * source. Contract: services/fake-bsc/CONTRACT.md, "Probe, drift and ops
 * wiring"; the verdict is .github/scripts/bsc-probe-verdict.sh.
 *
 * WHAT IT DOES. A real B2C password sign-in (never the cached token, never a
 * refresh), then a fixed list of pinned reads with that token: the catalogue
 * filters, results and one card-listing on pinned public ids, then the
 * seller profile, one seller-sheet facet and order history page 1 (the prod
 * account is a seller account). The token is discarded when the request ends;
 * nothing is written to Secret Manager.
 *
 * WHICH ACCOUNT.
 *   - bscTarget "real" (prod only): the request body is IGNORED. The service
 *     signs in with the canary secret the 30-minute login canary uses, so no
 *     BSC credential ever travels from CI. A real probe outside prod answers
 *     409 and contacts nobody.
 *   - bscTarget "fake": the body's `{username, password}` if present, else the
 *     fake's constant probe account. Both only mean something to the fake.
 *
 * WHAT IT RETURNS. Status codes, timings, parser verdicts and value-free shape
 * signatures (key paths and types). NEVER a value: no token, no seller id, no
 * card data, no B2C message. `detail` names a step and a class, nothing more.
 *
 * LIMITS. One probe a minute per process (429 + Retry-After otherwise), on top
 * of the global per-key limiter. A probe on the real target honours the
 * operator's BSC pause flag (NEONBINDER_PAUSED_PLATFORMS, via the same lookup
 * the login canary uses) and answers `outcome: "skipped_paused"` without
 * calling BSC. Every BSC request goes through bscFetch, so an open 429
 * breaker short-circuits the probe too.
 *
 * AUTH. Cloud Run IAM only, like every other route. No app-layer check.
 */

/** The canary secret the prod login canary signs in with (NEO-43). */
export const BSC_PROBE_CANARY_KEY = "bsc-credentials-canary";
/** The fake's constant probe account (CONTRACT.md: sign-in username is the namespace). */
export const FAKE_PROBE_USERNAME = "nb+probe-ci@fake.invalid";
export const FAKE_PROBE_PASSWORD = "fake-bsc-password";

export const BSC_PROBE_MIN_INTERVAL_MS = 60_000;
export const BSC_PROBE_READ_TIMEOUT_MS = 15_000;
/** A pinned read larger than this is not parsed (and fails the parser leg). */
export const BSC_PROBE_MAX_BODY_CHARS = 5 * 1024 * 1024;

export type ProbeOutcome =
  | "ok"
  | "signin_failed"
  | "bsc_unavailable"
  | "catalogue_non_2xx"
  | "parser_rejected"
  | "skipped_paused";

const PINNED_SET_FILTERS = {
  sport: ["hockey"],
  year: ["1995"],
  setName: ["halifax-mooseheads-qmjhl"],
  variant: ["base"],
};
/** Card #1 of the pinned set (BSC's own id; public catalogue data). */
const PINNED_CARD_ID = "96f9a87adeb7d02c275e117ef10d569c";

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

interface PinnedRead {
  /** Step name in `steps`. */
  step: string;
  /** Path template, the key in `shapes` (same templates as Convex's call telemetry). */
  template: string;
  method: "GET" | "POST";
  path: string;
  body?: unknown;
  /** Catalogue reads report their canonical request (the fake's recording key input). */
  catalogue: boolean;
  /** Mirrors what the production parser needs from the body. */
  accept: (body: unknown) => boolean;
  /** The ONLY paths reported in `shapes` (see SHAPE_PATHS). */
  shapePaths: readonly string[];
}

const facetPaths = (facet: string): string[] => [
  `aggregations.${facet}[].label`,
  `aggregations.${facet}[].slug`,
  `aggregations.${facet}[].count`,
  `aggregations.${facet}[].active`,
];
const sheetRowPaths = (row: string): string[] => [
  `${row}.card.id`,
  `${row}.card.cardNo`,
  `${row}.cardId`,
  `${row}.condition`,
  `${row}.availableQuantity`,
  `${row}.price`,
  `${row}.productType`,
  `${row}.sellerSku`,
  `${row}.sellerImgFront`,
  `${row}.sellerImgBack`,
  `${row}.productId`,
];

/**
 * SECURITY: the paths each pinned read may report in `shapes`, and nothing
 * else. The prod probe's shapes are uploaded by the drift workflow as a
 * public artifact, and a seller answer can carry maps keyed by buyer
 * usernames, emails or ids that the `{*}` rule does not catch. So every read
 * reports exactly the fields NB's parsers read (plus their ancestors); any
 * other key is dropped unseen. These match the fake's comparison lists
 * (services/fake-bsc/src/sanitise.ts SPECS for the catalogue, drift.ts
 * READ_PATHS for the seller reads); tests/bsc-probe-route.test.mjs checks
 * the parity.
 *
 *   filters       fetchBscSelectorOptions: aggregations[facet][] label, slug,
 *                 count, active, for the facets in convex/bscFacets.ts.
 *   results       fetchBscChecklist's row map plus the row's ordering keys.
 *   card-listing  fetchBscCardTeamNameAttempt: id, teamName, playerAttribute.
 *   profile       sellerProfile.sellerId / sellerStoreName (bsc-adapter,
 *                 bscSeller.fetchBscSellerId).
 *   seller sheet  lib/bscSheetPlan.narrowBscSheetRow, bare array or {results}.
 *   order history lib/bscOrders.parseBscOrderHistoryPage.
 */
export const SHAPE_PATHS = Object.freeze({
  filters: Object.freeze(["sport", "year", "setName", "variant", "variantName"].flatMap(facetPaths)),
  results: Object.freeze(
    [
      "id",
      "setName",
      "players",
      "cardNo",
      "cardNumber",
      "number",
      "playerAttribute",
      "playerAttribute[]",
      "playerAttributeDesc",
      "cardNoOrder",
      "cardNoSequence",
      "cardNoSort",
    ].map((f) => `[].${f}`),
  ),
  cardListing: Object.freeze(["id", "teamName", "playerAttribute", "playerAttribute[]"]),
  profile: Object.freeze(["sellerProfile.sellerId", "sellerProfile.sellerStoreName"]),
  sellerSheet: Object.freeze([...sheetRowPaths("[]"), ...sheetRowPaths("results[]")]),
  orderHistory: Object.freeze([
    "totalElements",
    "results[].orderId",
    "results[].orderNo",
    "results[].orderStatus",
    "results[].orderDate",
  ]),
});

/**
 * The pinned reads, in order. Request bodies are byte-for-byte what Convex
 * sends for the same call (apps/web/convex/adapters/buysportscards.ts and
 * bscSeller.ts), so the fake's recording for the same request is comparable.
 */
export const PINNED_READS: readonly PinnedRead[] = Object.freeze([
  {
    step: "catalogue_filters",
    shapePaths: SHAPE_PATHS.filters,
    template: "search/bulk-upload/filters",
    method: "POST",
    path: "search/bulk-upload/filters",
    body: { filters: { sport: PINNED_SET_FILTERS.sport, year: PINNED_SET_FILTERS.year } },
    catalogue: true,
    // fetchBscSelectorOptions reads aggregations[<facet>] as {label, slug}[].
    accept: (b) =>
      isRecord(b) &&
      isRecord(b.aggregations) &&
      Array.isArray(b.aggregations.setName) &&
      b.aggregations.setName.some(
        (f) => isRecord(f) && typeof f.label === "string" && typeof f.slug === "string",
      ),
  },
  {
    step: "catalogue_results",
    shapePaths: SHAPE_PATHS.results,
    template: "search/bulk-upload/results",
    method: "POST",
    path: "search/bulk-upload/results",
    body: { condition: "all", page: 0, size: 5000, sort: "default", filters: PINNED_SET_FILTERS },
    catalogue: true,
    // fetchBscChecklist reads a bare array of card rows.
    accept: (b) => Array.isArray(b) && b.every(isRecord),
  },
  {
    step: "card_listing",
    shapePaths: SHAPE_PATHS.cardListing,
    template: "marketplace/card/:id/card-listing",
    method: "GET",
    path: `marketplace/card/${PINNED_CARD_ID}/card-listing`,
    catalogue: true,
    accept: (b) => isRecord(b),
  },
  {
    step: "seller_profile",
    shapePaths: SHAPE_PATHS.profile,
    template: "marketplace/user/profile",
    method: "GET",
    path: "marketplace/user/profile",
    catalogue: false,
    accept: (b) => isRecord(b) && isRecord(b.sellerProfile),
  },
  {
    step: "seller_sheet",
    shapePaths: SHAPE_PATHS.sellerSheet,
    template: "seller/bulk-upload/results",
    method: "POST",
    path: "seller/bulk-upload/results",
    body: {
      condition: "near_mint",
      currentListings: true,
      productType: "raw",
      page: 0,
      size: 5000,
      sort: "default",
      filters: PINNED_SET_FILTERS,
    },
    catalogue: false,
    // readBscSellerSheet: a bare array, or {results: []}.
    accept: (b) => Array.isArray(b) || (isRecord(b) && Array.isArray(b.results)),
  },
  {
    step: "order_history",
    shapePaths: SHAPE_PATHS.orderHistory,
    template: "seller/order/history",
    method: "POST",
    path: "seller/order/history",
    body: { name: "", orderNo: "", fromDate: "", toDate: "", page: 0, size: 50, status: [] },
    catalogue: false,
    // parseBscOrderHistoryPage: an object; `results` an array when present.
    accept: (b) => isRecord(b) && (b.results === undefined || Array.isArray(b.results)),
  },
]);

export interface ProbeStep {
  step: string;
  status: number;
  ms: number;
  parsed: boolean;
  failure?: "timeout" | "network" | "too_large" | "skipped";
}

export interface CanonicalRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  body: unknown;
}

export interface ProbeResponseBody {
  bscTarget: BscTarget;
  outcome: ProbeOutcome;
  signIn: { ok: boolean };
  catalogue: { ok: boolean; status: number };
  parser: { ok: boolean };
  shapes: Record<string, Record<string, string>>;
  requests: Record<string, CanonicalRequest>;
  steps: ProbeStep[];
  durationMs: number;
  detail?: string;
}

export interface BscProbeDeps {
  env?: Record<string, string | undefined>;
  now?: () => number;
  signIn?: (input: BscPasswordSignInInput) => Promise<BscPasswordSignInResult>;
  /** The prod account. Default: the canary secret from Secret Manager. */
  readCanaryCredentials?: () => Promise<{ username: string; password?: string }>;
  /** The BSC pause lookup. Default: shouldSkipCanary("bsc"). */
  isPaused?: () => Promise<boolean>;
  minIntervalMs?: number;
  readTimeoutMs?: number;
  /** Extra bscFetch options (tests inject mintIdToken). */
  fetchOptions?: BscFetchOptions;
  log?: (line: Record<string, unknown>) => void;
}

const unavailableStatus = (status: number): boolean => status === 429 || status >= 500;

function defaultLog(line: Record<string, unknown>): void {
  try {
    console.log(JSON.stringify(line));
  } catch {
    console.log("bsc_probe (unserialisable line)");
  }
}

/** Express Router carrying POST /probe/bsc. One instance = one rate window. */
export function createBscProbeRouter(deps: BscProbeDeps = {}): Router {
  const router = Router();
  const now = deps.now ?? Date.now;
  const minInterval = deps.minIntervalMs ?? BSC_PROBE_MIN_INTERVAL_MS;
  const readTimeoutMs = deps.readTimeoutMs ?? BSC_PROBE_READ_TIMEOUT_MS;
  const signIn = deps.signIn ?? bscPasswordSignIn;
  const log = deps.log ?? defaultLog;
  let lastStartedAt: number | undefined;

  router.post("/probe/bsc", async (req: Request, res: Response) => {
    const env = deps.env ?? process.env;
    let target: BscTarget;
    try {
      target = resolveBscEndpoints(env).target;
    } catch {
      // A misconfigured fake URL; boot refuses this, so only a test sees it.
      res.status(500).json({ error: "BSC target is misconfigured" });
      return;
    }
    const isProd = (env.ENVIRONMENT ?? "").trim() === "prod";
    if (target === "real" && !isProd) {
      res.status(409).json({
        error: "The real-BSC probe runs only in prod; point this revision at the fake",
        bscTarget: target,
      });
      return;
    }

    const started = now();
    if (lastStartedAt !== undefined && started - lastStartedAt < minInterval) {
      const retryAfterS = Math.ceil((minInterval - (started - lastStartedAt)) / 1000);
      res.setHeader("Retry-After", String(retryAfterS));
      res.status(429).json({ error: "The BSC probe runs at most once a minute", bscTarget: target });
      return;
    }
    lastStartedAt = started;

    const body: ProbeResponseBody = {
      bscTarget: target,
      outcome: "ok",
      signIn: { ok: false },
      catalogue: { ok: false, status: 0 },
      parser: { ok: false },
      shapes: {},
      requests: {},
      steps: [],
      durationMs: 0,
    };
    const finish = (status = 200): void => {
      body.durationMs = now() - started;
      log({
        msg: "bsc_probe",
        bsc_target: target,
        outcome: body.outcome,
        duration_ms: body.durationMs,
        steps: body.steps.map((s) => ({ step: s.step, status: s.status, ms: s.ms, parsed: s.parsed })),
      });
      res.status(status).json(body);
    };

    try {
      // --- Pause flag (real target only; the lookup is off outside prod) ---
      if (target === "real") {
        const paused = await (deps.isPaused ?? (() => shouldSkipCanary("bsc")))();
        if (paused) {
          body.outcome = "skipped_paused";
          body.detail = "BSC is paused (NEONBINDER_PAUSED_PLATFORMS); no call was made";
          finish();
          return;
        }
      }

      // --- Which account ---------------------------------------------------
      let username: string;
      let password: string | undefined;
      if (target === "real") {
        try {
          const stored = await (deps.readCanaryCredentials ??
            (() => new SecretsManagerService().getCredentials(BSC_PROBE_CANARY_KEY)))();
          username = stored.username;
          password = stored.password;
        } catch (err) {
          // Name only: a secret client error can carry request detail.
          console.error(
            "[BSC probe] reading the probe account failed:",
            err instanceof Error ? err.name : "unknown",
          );
          body.outcome = "signin_failed";
          body.detail = "credentials: the stored probe account could not be read";
          finish();
          return;
        }
      } else {
        const parsed = parseTransientCredentials(req.body);
        if (!parsed.ok) {
          res.status(400).json({ error: parsed.error, bscTarget: target });
          return;
        }
        username = parsed.credentials?.username ?? FAKE_PROBE_USERNAME;
        password = parsed.credentials?.password ?? FAKE_PROBE_PASSWORD;
      }
      if (!username || !password) {
        body.outcome = "signin_failed";
        body.detail = "credentials: the probe account has no password";
        finish();
        return;
      }

      // --- Sign in ---------------------------------------------------------
      const fetchOptions: BscFetchOptions = { env, scope: "probe", ...deps.fetchOptions };
      const signInSteps: BscSignInStep[] = [];
      const result = await signIn({
        username,
        password,
        fetchOptions,
        onStep: (s) => signInSteps.push(s),
      });
      for (const s of signInSteps) {
        body.steps.push({
          step: `sign_in.${s.step}`,
          status: s.status,
          ms: s.ms,
          parsed: s.parsed,
          ...(s.failure ? { failure: s.failure } : {}),
        });
      }
      if (!("tokens" in result)) {
        const failed = signInSteps.find(
          (s) => s.failure !== undefined || (s.status !== 0 && unavailableStatus(s.status)),
        );
        if (failed) {
          body.outcome = "bsc_unavailable";
          body.detail = `sign_in.${failed.step}: ${failed.failure ?? `HTTP ${failed.status}`}`;
        } else {
          body.outcome = "signin_failed";
          const last = signInSteps[signInSteps.length - 1];
          body.detail = last
            ? `sign_in.${last.step}: ${result.credentialRejected ? "credentials rejected" : "not accepted"}`
            : "sign_in: failed before the first step";
        }
        finish();
        return;
      }
      body.signIn.ok = true;
      const accessToken = result.tokens.token;

      // --- Pinned reads ----------------------------------------------------
      const apiBase = resolveBscEndpoints(env).apiBase;
      let firstFailure: { outcome: ProbeOutcome; detail: string; status: number } | undefined;
      let parserOk = true;
      let filtersStatus = 0;
      for (const read of PINNED_READS) {
        if (read.catalogue) {
          body.requests[read.template] = canonicalJson({
            method: read.method,
            path: read.path,
            query: {},
            body: read.body ?? null,
          }) as CanonicalRequest;
        }
        const t0 = now();
        let status = 0;
        let failure: ProbeStep["failure"];
        let parsed = false;
        try {
          const response = await bscFetch(
            `${apiBase}/${read.path}`,
            {
              method: read.method,
              headers: bscApiHeaders(accessToken, { json: read.body !== undefined }),
              ...(read.body !== undefined ? { body: JSON.stringify(read.body) } : {}),
              signal: AbortSignal.timeout(readTimeoutMs),
            },
            fetchOptions,
          );
          status = response.status;
          const text = await response.text();
          if (response.ok) {
            if (text.length > BSC_PROBE_MAX_BODY_CHARS) {
              failure = "too_large";
            } else {
              let json: unknown;
              let jsonOk = false;
              try {
                json = JSON.parse(text);
                jsonOk = true;
              } catch {
                jsonOk = false;
              }
              if (jsonOk) {
                body.shapes[read.template] = shapeMap(json, { allow: read.shapePaths });
                parsed = read.accept(json);
              }
            }
          }
        } catch (err) {
          const name = err instanceof Error ? err.name : "";
          failure = name === "TimeoutError" || name === "AbortError" ? "timeout" : "network";
        }
        const ms = now() - t0;
        body.steps.push({ step: read.step, status, ms, parsed, ...(failure ? { failure } : {}) });
        if (read.step === "catalogue_filters") filtersStatus = status;

        if (!firstFailure) {
          if (failure === "timeout" || failure === "network" || unavailableStatus(status)) {
            firstFailure = {
              outcome: "bsc_unavailable",
              detail: `${read.step}: ${failure ?? `HTTP ${status}`}`,
              status,
            };
          } else if (status < 200 || status >= 300) {
            firstFailure = { outcome: "catalogue_non_2xx", detail: `${read.step}: HTTP ${status}`, status };
          } else if (!parsed) {
            firstFailure = {
              outcome: "parser_rejected",
              detail: `${read.step}: ${failure === "too_large" ? "body too large" : "parser rejected the body"}`,
              status,
            };
          }
        }
        if (!parsed) parserOk = false;
        // BSC is throttling or down: stop, do not add to it.
        if (firstFailure?.outcome === "bsc_unavailable") break;
      }

      for (const read of PINNED_READS) {
        if (!body.steps.some((s) => s.step === read.step)) {
          body.steps.push({ step: read.step, status: 0, ms: 0, parsed: false, failure: "skipped" });
          parserOk = false;
        }
      }

      body.parser.ok = parserOk;
      if (firstFailure) {
        body.outcome = firstFailure.outcome;
        body.detail = firstFailure.detail;
        body.catalogue = {
          ok: firstFailure.outcome === "parser_rejected",
          status: firstFailure.status,
        };
      } else {
        body.catalogue = { ok: true, status: filtersStatus };
      }
      finish();
    } catch (err) {
      // Unreachable by construction (every leg catches); never the object.
      console.error(
        "[BSC probe] unexpected failure:",
        err instanceof Error ? err.name : "unknown",
      );
      if (!res.headersSent) {
        res.status(500).json({ error: "BSC probe failed", bscTarget: target });
      }
    }
  });

  return router;
}
