/**
 * `<FAKE>/ebay/{api,apiz,apim}/<eBay path>` (CONTRACT.md, "Fake eBay"). Never
 * forwarded anywhere: rows 5 and 7 replay the catalogue, the token endpoint
 * and the public key are sealed or derived, everything else is synthesised
 * from the token's namespace and seller. A request the fake has no model for
 * is a 501 `x-nb-fake: unrecorded` and a miss (method and template only).
 *
 * Mounted after the caller check, the recordings hold and the faults (which
 * read the parsed body for a bulk `ebayError`), so the body parser runs first:
 * `ebayBodyParser`.
 */
import { createHash } from "node:crypto";
import express, { type NextFunction, type Request, type RequestHandler, type Response, type Router } from "express";
import type { Catalogue } from "../catalogue";
import { canonicalRequest, normalisePath, requestKey } from "../requestKey";
import { catalogueEndpointFor, isEbayCatalogueEndpoint } from "../sanitise";
import { settleWithin, type MissOwner, type StateStore } from "../state";
import { MISS_WRITE_BUDGET_MS, UNRECORDED_HEADER, bearerToken, headerScope, nearMiss } from "../routes/api";
import { UNAUTHORIZED_BODY, ebayErrorBody } from "./errors";
import type { NotificationKey } from "./notificationKey";
import { tokenAnswer } from "./oauth";
import { ebayTemplatesFor, matchEbayRoute } from "./paths";
import { sellerOf } from "./state";
import { answerSeller, type EbayAnswer } from "./synth";
import type { EbayTokens, EbayUser } from "./tokens";

export const EBAY_BULK_BODY_LIMIT = 2 * 1024 * 1024;
export const EBAY_MEDIA_BODY_LIMIT = 4 * 1024 * 1024 + 64 * 1024; // a 4 MB picture plus multipart framing
export const EBAY_TOKEN_BODY_LIMIT = 64 * 1024;
export const EBAY_JSON_BODY_LIMIT = 256 * 1024;

const BULK_PATH_RE = /^ebay\/api\/sell\/inventory\/v1\/bulk_[a-z_]+$/;
const MEDIA_UPLOAD_PATH = "ebay/apim/commerce/media/v1_beta/image/create_image_from_file";
const TOKEN_PATH = "ebay/api/identity/v1/oauth2/token";

/** The fake's normalised path for a request under `/ebay` (keeps the `ebay/<host>/` prefix). */
export function ebayPathOf(req: Request): string {
  return normalisePath(req.originalUrl.split("?")[0]);
}

/** One body parser per eBay path class (CONTRACT.md, "Faults on eBay paths": the body limits). */
export function ebayBodyParser(): RequestHandler {
  const bulk = express.json({ limit: EBAY_BULK_BODY_LIMIT });
  const json = express.json({ limit: EBAY_JSON_BODY_LIMIT });
  const form = express.urlencoded({ extended: false, limit: EBAY_TOKEN_BODY_LIMIT, parameterLimit: 20 });
  const media = express.raw({ type: "multipart/form-data", limit: EBAY_MEDIA_BODY_LIMIT });
  return (req, res, next) => {
    const path = ebayPathOf(req);
    if (path === TOKEN_PATH) return form(req, res, next);
    if (path === MEDIA_UPLOAD_PATH) return media(req, res, next);
    if (BULK_PATH_RE.test(path)) return bulk(req, res, next);
    return json(req, res, next);
  };
}

/** The user a request's bearer token names, if it is a live fake eBay user token. */
export function ebayUserOf(req: Request, tokens: EbayTokens): EbayUser | null {
  return tokens.userForAccess(bearerToken(req));
}

/** Fault and miss scope: the user token's namespace, else `x-nb-fake-ns`. */
export function ebayScope(req: Request, tokens: EbayTokens): { ns: string } | { prefix: string } | null {
  const u = ebayUserOf(req, tokens);
  return u ? { ns: u.ns } : headerScope(req);
}

function send(res: Response, a: EbayAnswer): void {
  if (a.headers) res.set(a.headers);
  if (a.body === undefined) res.status(a.status).end();
  else res.status(a.status).json(a.body);
}

function queryString(req: Request): string {
  const i = req.originalUrl.indexOf("?");
  return i === -1 ? "" : req.originalUrl.slice(i + 1);
}

export interface EbayRouterDeps {
  catalogue: Catalogue;
  state: StateStore;
  tokens: EbayTokens;
  publicKey: NotificationKey;
  now: () => number;
}

export function ebayRouter(deps: EbayRouterDeps): Router {
  const { catalogue, state, tokens, publicKey, now } = deps;
  const router = express.Router();

  const unauthorized = (res: Response): void => {
    res.status(401).json(UNAUTHORIZED_BODY);
  };

  const needsModel = (res: Response, method: string, path: string, owner: MissOwner): void => {
    // Only the method and template are kept: the path may hold a SKU or an id, the body anything.
    const template = ebayTemplatesFor(path)[0].slice(0, 200);
    const key = createHash("sha256").update(`${method}\n${template}`).digest("hex");
    state.recordMiss(owner, { key, kind: "needs-model", method, path: template });
    res.status(501).set(UNRECORDED_HEADER, "unrecorded").json({ error: "unrecorded", key });
  };

  router.use(async (req: Request, res: Response, _next: NextFunction) => {
    const method = req.method.toUpperCase();
    const path = ebayPathOf(req);
    const user = ebayUserOf(req, tokens);
    const owner: MissOwner = user ? { ns: user.ns } : headerScope(req);
    const route = matchEbayRoute(method, path);
    if (!route) {
      needsModel(res, method, path, owner);
      return;
    }

    if (route.op === "token") {
      send(res, tokenAnswer(tokens, req.get("authorization"), req.body));
      return;
    }

    if (route.op === "publicKey") {
      if (!tokens.isApp(bearerToken(req))) {
        unauthorized(res);
        return;
      }
      if (route.params.publicKeyId !== publicKey.kid) {
        send(res, { status: 404, body: ebayErrorBody([195000]) });
        return;
      }
      res.json({ algorithm: "ECDSA", digest: "SHA1", key: publicKey.publicPem });
      return;
    }

    if (route.op === "shippingServices" || route.op === "itemAspects") {
      // Public metadata: a user token or an app token.
      if (!user && !tokens.isApp(bearerToken(req))) {
        unauthorized(res);
        return;
      }
      const endpoint = catalogueEndpointFor(method, path);
      if (!endpoint || !isEbayCatalogueEndpoint(endpoint)) {
        needsModel(res, method, path, owner);
        return;
      }
      const creq = canonicalRequest({ method, path, query: queryString(req), body: undefined });
      const key = requestKey(creq);
      const rec = catalogue.get(key);
      if (rec) {
        if (rec.response.status === 200) res.status(200).json(rec.response.body);
        else res.status(rec.response.status).json(ebayErrorBody([2004]));
        return;
      }
      const { saved } = state.recordMissDurably(owner, {
        key,
        kind: "catalogue",
        method,
        path,
        endpoint,
        request: creq,
        nearMiss: nearMiss(catalogue, endpoint, creq),
      });
      await settleWithin(saved, MISS_WRITE_BUDGET_MS);
      res.status(501).set(UNRECORDED_HEADER, "unrecorded").json({ error: "unrecorded", key });
      return;
    }

    // Every other call is the seller's own.
    if (!user) {
      unauthorized(res);
      return;
    }
    const seller = sellerOf(state.get(user.ns), user.seller);
    const answer = answerSeller(seller, {
      op: route.op,
      params: route.params,
      query: new URLSearchParams(queryString(req)),
      body: Buffer.isBuffer(req.body) ? undefined : req.body,
      raw: { contentType: req.get("content-type"), bytes: Buffer.isBuffer(req.body) ? req.body : undefined },
      now: now(),
    });
    if (answer === "needs-model") {
      needsModel(res, method, path, owner);
      return;
    }
    send(res, answer);
  });

  return router;
}
