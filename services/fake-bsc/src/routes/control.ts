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
  /** Drops identity sessions; only `/__fake/reset-all` calls it. */
  resetIdentity?: (sel: NamespaceSelector) => void;
}

export const MAX_RECORDINGS_PER_UPLOAD = 50;

export function controlRouter(deps: ControlDeps): Router {
  const { catalogue, captures, state, now, requireAdmin } = deps;
  const router = express.Router();
  const small = express.json({ limit: "1mb" });
  const large = express.json({ limit: "40mb" });

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

  router.get("/misses", (req, res) => {
    const ns = typeof req.query.ns === "string" ? req.query.ns : undefined;
    const prefix = typeof req.query.prefix === "string" ? req.query.prefix : undefined;
    const sel = readSelector(ns !== undefined ? { ns } : { prefix });
    if (!sel) {
      res.status(400).json({ error: "query needs ns or prefix (prefix at least 3 characters)" });
      return;
    }
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

  router.post("/reset-all", requireAdmin, (_req, res) => {
    const cleared = state.resetAll();
    deps.resetIdentity?.({});
    res.json({ ok: true, cleared });
  });

  router.get("/recordings", requireAdmin, (_req, res) => {
    res.json({ manifestVersion: catalogue.manifestVersion, allowlistVersion: SANITISE_ALLOWLIST_VERSION, recordings: catalogue.size });
  });

  router.post("/recordings", requireAdmin, large, async (req, res) => {
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
