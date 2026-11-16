/**
 * The fake's HTTP surface. Pure wiring: every dependency is passed in, so
 * tests build an app with a memory store and a stub identity module.
 */
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import type { FakeConfig } from "./config";
import type { Catalogue } from "./catalogue";
import type { Captures } from "./captures";
import { requireAdmin, requireCaller, type IdTokenVerifier } from "./auth";
import { HANG_CAP_MS, MAX_DELAYED_PER_SCOPE, MAX_HELD_SOCKETS, MAX_HUNG_PER_SCOPE, ruleMatches, type FaultRule, type FaultTarget } from "./faults";
import { cardIdOf, templatesFor } from "./paths";
import { normalisePath } from "./requestKey";
import { SANITISE_ALLOWLIST_VERSION } from "./sanitise";
import type { StateStore } from "./state";
import { UNRECORDED_HEADER, apiRouter, bearerToken, headerScope } from "./routes/api";
import { controlRouter } from "./routes/control";
import type { NamespaceSelector } from "./namespace";
import { log } from "./log";

/** What the server needs from `src/identity/` (CONTRACT.md, "Identity"). */
export interface IdentityModule {
  identityRouter: Router;
  namespaceForToken(accessToken: string): string | null;
  resetIdentity?(sel: NamespaceSelector): void;
}

export interface AppDeps {
  config: FakeConfig;
  catalogue: Catalogue;
  captures: Captures;
  state: StateStore;
  identity: IdentityModule;
  verifyIdToken: IdTokenVerifier;
  instanceId: string;
  now?: () => number;
  /** Test seam for `delay` faults. */
  sleep?: (ms: number) => Promise<void>;
  /**
   * True while recordings and write captures are still loading (the server
   * listens before they are in, so a cold start answers at once). Absent:
   * never loading.
   */
  loading?: () => boolean;
  /** Resolves when loading is done; held requests wait on it. */
  loaded?: Promise<void>;
  /**
   * True while the durable misses are being restored (after the recordings).
   * Only `GET /__fake/misses` waits for it; `/api` does not. Absent: never.
   */
  missesLoading?: () => boolean;
  /** Resolves when the misses restore is done (failed included). */
  missesLoaded?: Promise<void>;
  /** How long a held request waits for the load before a 503 (default 25 s). */
  loadWaitMs?: number;
}

/** A held request waits at most this long for the recordings (Convex's timeout is 30 s). */
export const LOAD_WAIT_MS = 25_000;

/** Control routes that need the recordings loaded; reset, faults and orders do not. */
const LOADING_REFUSED_CONTROL = new Set(["/recordings", "/write-captures", "/drift-compare"]);
/** Control routes held (not refused) until the recordings are in. */
const LOADING_HELD_CONTROL = new Set(["/misses"]);

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function createApp(deps: AppDeps): express.Express {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? defaultSleep;
  const { config, state, identity } = deps;
  const app = express();
  app.disable("x-powered-by");
  app.set("etag", false);

  // One line per request: template, status, timing. No ids beyond the
  // template, no bodies, no headers.
  app.use((req, res, next) => {
    const started = Date.now();
    // Read now: mounted routers rewrite req.path while they run.
    const full = req.originalUrl.split("?")[0];
    res.on("finish", () => {
      const area = full.startsWith("/api/") ? "api" : full.startsWith("/identity/") ? "identity" : full.startsWith("/__fake/") ? "control" : "other";
      const p = area === "api" ? normalisePath(full) : full.replace(/^\/+/, "");
      log("request", {
        method: req.method,
        area,
        template: templatesFor(p)[0].slice(0, 120),
        status: res.statusCode,
        ms: Date.now() - started,
      });
    });
    next();
  });

  const caller = requireCaller(config, deps.verifyIdToken);
  const admin = requireAdmin(config);
  const isLoading = deps.loading ?? (() => false);

  const loadWaitMs = deps.loadWaitMs ?? LOAD_WAIT_MS;
  const loadingAnswer = (res: Response): void => {
    res.status(503).set(UNRECORDED_HEADER, "loading").set("retry-after", "2").json({ error: "loading" });
  };

  /** Admin uploads: 503 `x-nb-fake: loading` at once until the recordings are in. */
  const refuseWhileLoading = (_req: Request, res: Response, next: NextFunction): void => {
    if (isLoading()) loadingAnswer(res);
    else next();
  };

  /**
   * `/api` and the miss list: held until the recordings are in, so a cold
   * start answers normally (a 503 here would count against Convex's BSC call
   * gate). Only a load longer than `loadWaitMs` answers 503 loading.
   */
  const holdUntil =
    (busy: () => boolean, done: Promise<unknown> | undefined) =>
    async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
      if (!busy()) {
        next();
        return;
      }
      let timer: NodeJS.Timeout | undefined;
      await Promise.race([
        done ?? new Promise<void>(() => undefined),
        new Promise<void>((r) => {
          timer = setTimeout(r, loadWaitMs);
          timer.unref();
        }),
      ]);
      clearTimeout(timer);
      if (busy()) loadingAnswer(res);
      else next();
    };
  const holdWhileLoading = holdUntil(isLoading, deps.loaded);
  /**
   * The admin writes that change the miss list in bulk (a stored recording
   * clears its misses, reset-all clears them all) wait for the misses restore:
   * run during it, the restore would put back what they removed (CONTRACT.md,
   * "Durable misses"). Run after the admin check, inside the control router.
   */
  const holdForMisses = holdUntil(
    deps.missesLoading ?? (() => false),
    deps.missesLoaded ?? (deps.missesLoading ? new Promise<void>(() => undefined) : Promise.resolve()),
  );
  // The miss list also waits for the durable misses (restored after the recordings).
  const missesBusy = deps.missesLoading ?? (() => false);
  const holdMisses = holdUntil(
    () => isLoading() || missesBusy(),
    // A busy flag with no promise waits out the cap, as `holdWhileLoading` does.
    Promise.all([
      deps.loaded ?? (deps.loading ? new Promise<void>(() => undefined) : Promise.resolve()),
      deps.missesLoaded ?? (deps.missesLoading ? new Promise<void>(() => undefined) : Promise.resolve()),
    ]),
  );

  const tokenNs = (req: Request): string | null => {
    const t = bearerToken(req);
    return t === null ? null : identity.namespaceForToken(t);
  };

  // Not `/healthz`: Cloud Run's frontend reserves that path (and any ending in `z`) and answers 404 itself.
  app.get("/__fake/health", caller, (_req, res) => {
    const loading = isLoading();
    res.json({
      ok: true,
      loading,
      instanceId: deps.instanceId,
      revision: config.revision,
      manifestVersion: deps.catalogue.manifestVersion,
      allowlistVersion: SANITISE_ALLOWLIST_VERSION,
      recordings: deps.catalogue.size,
      // The write endpoints with no stored real capture (CONTRACT.md, "Write capture").
      // While loading the captures are not in yet, so every endpoint would read
      // as missing: say "loading" and send no list. No `missing` field also makes
      // a reader that ignores `loading` fail closed, never read "none missing".
      writeCaptures: loading ? { loading: true } : { missing: deps.captures.missing() },
    });
  });

  app.use(
    "/__fake",
    caller,
    (req: Request, res: Response, next: NextFunction) =>
      LOADING_REFUSED_CONTROL.has(req.path) ? refuseWhileLoading(req, res, next) : LOADING_HELD_CONTROL.has(req.path) && req.method === "GET" ? holdMisses(req, res, next) : next(),
    controlRouter({
      catalogue: deps.catalogue,
      captures: deps.captures,
      state,
      now,
      requireAdmin: admin,
      afterMissesRestore: holdForMisses,
      resetIdentity: identity.resetIdentity ? (sel) => identity.resetIdentity!(sel) : undefined,
    }),
  );

  /**
   * Sockets held by a `hang` or a `delay`, per scope and in all, so faults
   * cannot pin more than a few. `hold` answers a release function, or null
   * when either cap is reached (the caller then answers 503 at once).
   */
  const heldByScope = new Map<string, number>();
  let heldTotal = 0;
  const hold = (scopeKey: string, kind: "hang" | "delay"): (() => void) | null => {
    const key = `${kind}:${scopeKey}`;
    const mine = heldByScope.get(key) ?? 0;
    const perScope = kind === "hang" ? MAX_HUNG_PER_SCOPE : MAX_DELAYED_PER_SCOPE;
    if (heldTotal >= MAX_HELD_SOCKETS || mine >= perScope) return null;
    heldTotal += 1;
    heldByScope.set(key, mine + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      heldTotal -= 1;
      const n = (heldByScope.get(key) ?? 1) - 1;
      if (n <= 0) heldByScope.delete(key);
      else heldByScope.set(key, n);
    };
  };

  const faults = (area: "api" | "identity") => async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const path = normalisePath(req.path);
    const target: FaultTarget = {
      method: req.method.toUpperCase(),
      templates: area === "api" ? templatesFor(path) : [`identity/${path}`],
      cardId: area === "api" ? cardIdOf(path) : null,
    };
    // A BSC token names one namespace; without one, `x-nb-fake-ns` names a
    // namespace or a deployment prefix (card-scoped rules under it); with
    // neither, a card id meets every namespace's card-scoped rules.
    const ns = tokenNs(req);
    const scope = ns !== null ? { ns } : headerScope(req);
    const rules: FaultRule[] =
      scope !== null && "ns" in scope
        ? state.faultsFor(scope.ns)
        : target.cardId === null
          ? []
          : state.cardScopedFaults(scope?.prefix);
    const t = now();
    const rule = rules.find((r) => ruleMatches(r, target, t));
    if (!rule) {
      next();
      return;
    }
    if (rule.timesLeft !== null) rule.timesLeft -= 1;
    log("fault_applied", { kind: rule.kind, template: target.templates[0].slice(0, 120) });
    switch (rule.kind) {
      case "429":
        if (rule.retryAfterS !== undefined) res.set("retry-after", String(rule.retryAfterS));
        res.status(429).json({ message: "Too Many Requests" });
        return;
      case "503":
        if (rule.retryAfterS !== undefined) res.set("retry-after", String(rule.retryAfterS));
        res.status(503).json({ message: "Service Unavailable" });
        return;
      case "delay":
      case "hang": {
        const scopeKey = scope === null ? "anon" : "ns" in scope ? `ns:${scope.ns}` : `prefix:${scope.prefix}`;
        const release = hold(scopeKey, rule.kind);
        if (!release) {
          log("fault_hold_refused", { kind: rule.kind, heldTotal });
          res.status(503).json({ message: "Service Unavailable" });
          return;
        }
        res.on("close", release);
        if (rule.kind === "delay") {
          try {
            await sleep(rule.delayMs ?? 0);
          } finally {
            release();
          }
          next();
          return;
        }
        const timer = setTimeout(() => req.socket.destroy(), HANG_CAP_MS);
        timer.unref();
        res.on("close", () => clearTimeout(timer));
        return;
      }
      case "reset":
        req.socket.destroy();
        return;
    }
  };

  app.use("/identity", caller, faults("identity"), identity.identityRouter);
  app.use("/api", caller, holdWhileLoading, faults("api"), apiRouter({ catalogue: deps.catalogue, state, ns: { fromToken: tokenNs }, now }));

  app.use((_req, res) => {
    res.status(404).json({ error: "not found" });
  });

  // Never echo an error's message: a body parser's error can quote the body.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status = typeof (err as { status?: unknown })?.status === "number" ? (err as { status: number }).status : 500;
    log("request_error", { status, error: err instanceof Error ? err.name : "unknown" });
    if (!res.headersSent) res.status(status >= 400 && status < 600 ? status : 500).json({ error: status === 413 ? "too large" : status >= 500 ? "internal error" : "bad request" });
  });

  return app;
}
