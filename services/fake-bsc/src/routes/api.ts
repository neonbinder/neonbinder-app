/**
 * `<FAKE>/api/<BSC path>`: the recorded catalogue replayed, everything else
 * synthesised from the caller's namespace. Never forwarded anywhere: a
 * request the fake cannot answer is a 501 with `x-nb-fake: unrecorded` and a
 * miss on the namespace's list.
 */
import { createHash } from "node:crypto";
import express, { type Request, type Response, type Router } from "express";
import type { Catalogue } from "../catalogue";
import { canonicalRequest, diffRequestPaths, normalisePath, requestKey, type CanonicalRequest } from "../requestKey";
import { catalogueEndpointFor, type CatalogueEndpoint } from "../sanitise";
import { ATTACHMENT_RE, ORDER_DETAIL_RE, templatesFor } from "../paths";
import type { MissOwner, StateStore } from "../state";
import { applyPhotoUpload, applyPut, catalogueRequestFor, profileAnswer, readSheetRequest, synthSheet } from "../synth/sheet";
import { orderDetail, orderHistory } from "../synth/orders";
import { readHeaderScope } from "../namespace";

export interface NamespaceResolver {
  /** The namespace of the request's BSC bearer token, or null. */
  fromToken(req: Request): string | null;
}

export const UNRECORDED_HEADER = "x-nb-fake";

export const PUT_BODY_LIMIT = 2 * 1024 * 1024;
export const API_BODY_LIMIT = 64 * 1024;
export const PHOTO_BODY_LIMIT = 4 * 1024 * 1024;

export function bearerToken(req: Request): string | null {
  const h = req.get("authorization");
  if (!h) return null;
  const m = /^Bearer\s+(\S{1,4096})$/i.exec(h.trim());
  return m ? m[1] : null;
}

/**
 * The scope of a request with no BSC token: the optional `x-nb-fake-ns`
 * header, one namespace or (ending in `-`) a deployment prefix.
 */
export function headerScope(req: Request): { ns: string } | { prefix: string } | null {
  return readHeaderScope(req.get("x-nb-fake-ns"));
}

/** Who a miss belongs to: the token's namespace, else the header's scope, else nobody. */
function missOwner(tokenNs: string | null, req: Request): MissOwner {
  return tokenNs !== null ? { ns: tokenNs } : headerScope(req);
}

function queryString(req: Request): string {
  const i = req.originalUrl.indexOf("?");
  return i === -1 ? "" : req.originalUrl.slice(i + 1);
}

/** The nearest recorded request of the same endpoint, as diff paths only. */
export function nearMiss(
  catalogue: Catalogue,
  endpoint: CatalogueEndpoint,
  req: CanonicalRequest,
): { key: string; diffPaths: string[] } | undefined {
  let best: { key: string; diffPaths: string[] } | undefined;
  for (const r of catalogue.sameEndpoint(endpoint)) {
    const d = diffRequestPaths(req, r.request);
    if (!best || d.length < best.diffPaths.length) best = { key: r.key, diffPaths: d };
    if (best.diffPaths.length <= 1) break;
  }
  return best;
}

export function apiRouter(deps: { catalogue: Catalogue; state: StateStore; ns: NamespaceResolver; now: () => number }): Router {
  const { catalogue, state, now } = deps;
  const router = express.Router();
  // Body limits from what NB's own BSC traffic needs (bscSheetPlan.ts,
  // copyPhotos.ts): a PUT is at most 100 rows of at most 16 KB each; every
  // other JSON body is a small request; a photo is at most 3 MB plus framing.
  const putJson = express.json({ limit: PUT_BODY_LIMIT });
  const smallJson = express.json({ limit: API_BODY_LIMIT });
  router.use((req, res, next) => (req.method === "PUT" && normalisePath(req.path) === "seller/bulk-upload" ? putJson : smallJson)(req, res, next));
  router.use(express.raw({ type: "multipart/form-data", limit: PHOTO_BODY_LIMIT }));

  const unrecorded = (res: Response, key: string): void => {
    res.status(501).set(UNRECORDED_HEADER, "unrecorded").json({ error: "unrecorded", key });
  };

  const missCatalogue = (res: Response, owner: MissOwner, endpoint: CatalogueEndpoint, req: CanonicalRequest): void => {
    const key = requestKey(req);
    state.recordMiss(owner, {
      key,
      kind: "catalogue",
      method: req.method,
      path: req.path,
      endpoint,
      request: req,
      nearMiss: nearMiss(catalogue, endpoint, req),
    });
    unrecorded(res, key);
  };

  router.use((req: Request, res: Response) => {
    const method = req.method.toUpperCase();
    const path = normalisePath(req.path);
    const tokenNs = deps.ns.fromToken(req);
    const needNs = (): string | null => {
      if (tokenNs === null) res.status(401).json({ error: "unauthorised" });
      return tokenNs;
    };

    const endpoint = catalogueEndpointFor(method, path);
    if (endpoint) {
      // card-listing is public on BSC; the others need a signed-in caller.
      let owner: MissOwner;
      if (endpoint === "cardListing") owner = missOwner(tokenNs, req);
      else {
        const ns = needNs();
        if (ns === null) return;
        owner = { ns };
      }
      const creq = canonicalRequest({ method, path, query: queryString(req), body: method === "GET" ? undefined : req.body });
      const rec = catalogue.get(requestKey(creq));
      if (!rec) {
        missCatalogue(res, owner, endpoint, creq);
        return;
      }
      if (rec.response.status === 200) res.status(200).json(rec.response.body);
      else res.status(rec.response.status).end();
      return;
    }

    if (method === "GET" && path === "marketplace/user/profile") {
      const ns = needNs();
      if (ns === null) return;
      res.json(profileAnswer(state.get(ns)));
      return;
    }

    if (method === "POST" && path === "seller/bulk-upload/results") {
      const ns = needNs();
      if (ns === null) return;
      const sheet = readSheetRequest(req.body);
      if (!sheet.ok) {
        res.status(sheet.status).json({ error: sheet.error });
        return;
      }
      const creq = catalogueRequestFor(sheet.filters);
      const rec = catalogue.resultsFor(sheet.filters);
      if (!rec) {
        missCatalogue(res, { ns }, "results", creq);
        return;
      }
      const rows = Array.isArray(rec.response.body) ? rec.response.body : [];
      res.json(synthSheet(rows, state.get(ns), sheet.condition, now()));
      return;
    }

    if (method === "PUT" && path === "seller/bulk-upload") {
      const ns = needNs();
      if (ns === null) return;
      const out = applyPut(state.get(ns), req.body, now());
      res.status(out.status).json(out.body);
      return;
    }

    if (method === "POST" && ATTACHMENT_RE.test(path)) {
      const ns = needNs();
      if (ns === null) return;
      const out = applyPhotoUpload(state.get(ns), req.get("content-type"), Buffer.isBuffer(req.body) ? req.body : undefined);
      res.status(out.status).json(out.body);
      return;
    }

    if (method === "POST" && path === "seller/order/history") {
      const ns = needNs();
      if (ns === null) return;
      res.json(orderHistory(state.get(ns), req.body));
      return;
    }

    const order = method === "GET" ? ORDER_DETAIL_RE.exec(path) : null;
    if (order) {
      const ns = needNs();
      if (ns === null) return;
      const o = orderDetail(state.get(ns), order[1]);
      if (o) res.json(o);
      else res.status(404).json({ error: "not found" });
      return;
    }

    // Not modelled. Only the method and template are kept: the body of an
    // unknown request may be anything, so none of it is stored.
    const template = templatesFor(path)[0].slice(0, 200);
    const key = createHash("sha256").update(`${method}\n${template}`).digest("hex");
    state.recordMiss(missOwner(tokenNs, req), { key, kind: "needs-model", method, path: template });
    unrecorded(res, key);
  });

  return router;
}
