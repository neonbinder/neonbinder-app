/**
 * `<FAKE>/__fake/...`: test controls (run-scoped, caller auth) and the
 * loader's endpoints (admin). See CONTRACT.md, "Who may call it".
 */
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import { checkRecording, type Catalogue, type Recording } from "../catalogue";
import { Captures, checkCapture, readCapture } from "../captures";
import { compareDrift } from "../drift";
import { readFaultRules } from "../faults";
import { isNamespace, readSelector, type NamespaceSelector } from "../namespace";
import { SANITISE_ALLOWLIST_VERSION } from "../sanitise";
import type { StateStore } from "../state";
import { addOrder, readFakeOrder } from "../synth/orders";
import { log } from "../log";

export interface ControlDeps {
  catalogue: Catalogue;
  captures: Captures;
  state: StateStore;
  now: () => number;
  requireAdmin: (req: Request, res: Response, next: NextFunction) => void;
  /**
   * Holds a request until the durable misses are restored (503 `loading`
   * past the cap). `POST /recordings` and `POST /reset-all` run behind it, so
   * the restore cannot put back a miss they removed. Absent: no hold.
   */
  afterMissesRestore?: (req: Request, res: Response, next: NextFunction) => void | Promise<void>;
  /** Drops identity sessions; only `/__fake/reset-all` calls it. */
  resetIdentity?: (sel: NamespaceSelector) => void;
}

export const MAX_RECORDINGS_PER_UPLOAD = 50;
/** How long a miss read waits for the TTL sweep's deletes. */
export const MISS_SWEEP_BUDGET_MS = 5000;
/** How long a stored recording waits for its misses' objects to go. */
export const MISS_CLEAR_BUDGET_MS = 10_000;
/** How long `/__fake/reset-all` waits for every kept miss to go. */
export const MISS_RESET_ALL_BUDGET_MS = 60_000;

export function controlRouter(deps: ControlDeps): Router {
  const { catalogue, captures, state, now, requireAdmin } = deps;
  const afterMissesRestore = deps.afterMissesRestore ?? ((_req: Request, _res: Response, next: NextFunction) => next());
  const router = express.Router();
  const small = express.json({ limit: "1mb" });
  // Recordings: one sanitised 5000-row results answer is a few MB; the
  // recorder uploads one at a time.
  const large = express.json({ limit: "8mb" });

  // ── Run-scoped (rules 1 and 2) ─────────────────────────────────────────

  router.post("/reset", small, (req, res) => {
    const sel = readSelector(req.body);
    if (!sel) {
      res.status(400).json({ error: "body needs {ns} or {prefix} (prefix at least 3 characters)" });
      return;
    }
    // Tokens and sessions survive (CONTRACT.md: the seed reuses a stored session).
    res.json({ ok: true, cleared: state.reset(sel) });
  });

  router.post("/faults", small, (req, res) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    if (!isNamespace(b.ns)) {
      res.status(400).json({ error: "ns" });
      return;
    }
    const read = readFaultRules(b.rules, now());
    if (!read.ok) {
      res.status(400).json({ error: read.error });
      return;
    }
    state.get(b.ns).faults = read.rules;
    res.json({ ok: true, rules: read.rules.length });
  });

  router.post("/orders", small, (req, res) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    if (!isNamespace(b.ns)) {
      res.status(400).json({ error: "ns" });
      return;
    }
    const raw = b.order !== undefined ? [b.order] : Array.isArray(b.orders) ? b.orders : null;
    if (!raw || raw.length === 0 || raw.length > 20) {
      res.status(400).json({ error: "body needs {order} or {orders: 1-20}" });
      return;
    }
    const orders = [];
    for (const o of raw) {
      const read = readFakeOrder(o);
      if (!read.ok) {
        res.status(400).json({ error: read.error });
        return;
      }
      orders.push(read.order);
    }
    const ns = state.get(b.ns);
    const added = [];
    for (const o of orders) {
      const r = addOrder(ns, o, now());
      if ("error" in r) {
        res.status(409).json({ error: r.error, added });
        return;
      }
      added.push(r);
    }
    res.json({ ok: true, ...(added.length === 1 ? { orderId: added[0].orderId } : {}), orderIds: added.map((o) => o.orderId), orders: added });
  });

  // `?all=1` lists every owner's misses and is admin-only (CONTRACT.md,
  // "Durable misses"); `?ns=` / `?prefix=` need only caller auth.
  const adminForAll = (req: Request, res: Response, next: NextFunction): void => {
    if (req.query.all === undefined) next();
    else requireAdmin(req, res, next);
  };

  router.get("/misses", adminForAll, async (req, res) => {
    let sel: NamespaceSelector | null;
    if (req.query.all !== undefined) {
      if (req.query.all !== "1" || req.query.ns !== undefined || req.query.prefix !== undefined) {
        res.status(400).json({ error: "all takes only the value 1, and no ns or prefix" });
        return;
      }
      sel = {};
    } else {
      const ns = typeof req.query.ns === "string" ? req.query.ns : undefined;
      const prefix = typeof req.query.prefix === "string" ? req.query.prefix : undefined;
      sel = readSelector(ns !== undefined ? { ns } : { prefix });
    }
    if (!sel) {
      res.status(400).json({ error: "query needs ns or prefix (prefix at least 3 characters)" });
      return;
    }
    state.expireMisses();
    await state.flushMisses(MISS_SWEEP_BUDGET_MS);
    const misses = state.listMisses(sel).map((m) => ({
      ns: m.ns,
      ...(m.prefix !== undefined ? { prefix: m.prefix } : {}),
      key: m.key,
      kind: m.kind,
      method: m.method,
      path: m.path,
      ...(m.endpoint ? { endpoint: m.endpoint } : {}),
      ...(m.request ? { request: { method: m.request.method, path: m.request.path, query: m.request.query, body: m.request.body } } : {}),
      count: m.count,
      firstSeen: m.firstSeen,
      lastSeen: m.lastSeen,
      ...(m.nearMiss ? { nearMiss: m.nearMiss } : {}),
    }));
    res.json({ misses, allowlistVersion: SANITISE_ALLOWLIST_VERSION });
  });

  // ── Admin ──────────────────────────────────────────────────────────────

  router.post("/reset-all", requireAdmin, afterMissesRestore, async (_req, res) => {
    const cleared = state.resetAll();
    deps.resetIdentity?.({});
    // The kept misses go too; `missesRemoved: false` means some deletes were still running.
    const missesRemoved = await state.flushMisses(MISS_RESET_ALL_BUDGET_MS);
    res.json({ ok: true, cleared, missesRemoved });
  });

  router.get("/recordings", requireAdmin, (_req, res) => {
    res.json({ manifestVersion: catalogue.manifestVersion, allowlistVersion: SANITISE_ALLOWLIST_VERSION, recordings: catalogue.size });
  });

  router.post("/recordings", requireAdmin, afterMissesRestore, large, async (req, res) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const raw = Array.isArray(b.recordings) ? b.recordings : null;
    if (!raw || raw.length === 0 || raw.length > MAX_RECORDINGS_PER_UPLOAD) {
      res.status(400).json({ error: `recordings must hold 1-${MAX_RECORDINGS_PER_UPLOAD}` });
      return;
    }
    const checked: Recording[] = [];
    for (const [index, r] of raw.entries()) {
      const c = checkRecording(r);
      if (!c.ok) {
        // Paths only: never echo a value that was refused.
        res.status(400).json({ error: "recording refused", index, reason: c.reason, ...(c.droppedPaths ? { droppedPaths: c.droppedPaths } : {}) });
        return;
      }
      checked.push(c.recording);
    }
    const started = Date.now();
    try {
      const out = await catalogue.add(checked);
      for (const r of checked) state.clearMiss(r.key);
      await state.flushMisses(MISS_CLEAR_BUDGET_MS);
      log("recordings_promoted", { added: out.added, manifestVersion: out.version, ms: Date.now() - started });
      res.json({ ok: true, manifestVersion: out.version, keys: checked.map((r) => r.key) });
    } catch (err) {
      log("recordings_store_failed", { error: err instanceof Error ? err.name : "unknown", ms: Date.now() - started });
      res.status(503).json({ error: "could not store recordings" });
    }
  });

  router.get("/write-captures", requireAdmin, (_req, res) => {
    res.json({ captures: captures.list().map((c) => ({ ...checkCapture(c), status: c.status })) });
  });

  router.post("/write-captures", requireAdmin, small, async (req, res) => {
    const read = readCapture(req.body);
    if (!read.ok) {
      res.status(400).json({ error: read.error });
      return;
    }
    try {
      await captures.save(read.capture);
    } catch (err) {
      log("write_capture_store_failed", { error: err instanceof Error ? err.name : "unknown" });
      res.status(503).json({ error: "could not store the capture" });
      return;
    }
    const verdict = checkCapture(read.capture);
    log("write_capture_stored", { endpoint: read.capture.endpoint, verdict: verdict.verdict });
    res.json({ ok: true, ...verdict });
  });

  router.post("/drift-compare", requireAdmin, small, (req, res) => {
    const out = compareDrift(req.body, catalogue);
    if (!out.ok) {
      res.status(400).json({ error: out.error });
      return;
    }
    log("drift_compare", { outcome: out.result.outcome, paths: out.result.paths.length });
    res.json(out.result);
  });

  return router;
}
