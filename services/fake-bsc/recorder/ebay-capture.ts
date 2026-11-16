/**
 * `ebay-capture` and `ebay-undo` (CONTRACT.md, "Recorder: eBay"). Each run
 * stores, per eBay endpoint it exercised, only `{endpoint, status, shape}`
 * (key paths and types, never a value) through `/__fake/write-captures`.
 *
 *   Sandbox: the reads and the writes the sandbox accepts, on objects named
 *     NBCAPTURE-SBX-<yyyymmdd>, all removed at the end.
 *   Production (`--prod`, Jason only): ONE real listing to capture what the
 *     sandbox refuses (media, publish, price update, withdraw). Pre-checks
 *     before any write; exactly the seven writes the dry run prints; a
 *     `finally` that withdraws and deletes whatever the run made, at most
 *     three tries each, then verifies.
 */
import { endpointName } from "../src/ebay/sample";
import type { EbayOp } from "../src/ebay/paths";
import { shapeOf, type Shape } from "../src/shape";
import { EbayStop, errorIdsOf, type EbayApi, type EbayCall, type EbayEnv, type EbayResponse } from "./ebay-api";

export interface StoredCapture {
  endpoint: string;
  status: number;
  shape: Shape;
}

export interface CaptureSink {
  uploadCapture(c: StoredCapture): Promise<{ verdict: string; paths: string[] }>;
}

export const CAPTURE_SKU_RE = /^NBCAPTURE-(SBX|PRD)-(\d{8})$/;
export const LOCATION_KEY = "neonbinder-main";
const CATEGORY_ID = "261328";
export const PROD_TITLE = "NB capture test listing - not for sale";
export const PROD_PRICE = "999.99";
export const PROD_NEW_PRICE = "999.98";
/** Withdraw and delete: tries each, in the production cleanup. */
export const CLEANUP_TRIES = 3;
/** A fixed public picture on an NB host, for the sandbox item (the sandbox has no media upload). */
export const SANDBOX_IMAGE_URL = "https://www.neonbinder.io/placeholder-fixtures/01-vorkle-front.jpg";

/** `yyyymmdd`, UTC. */
export function captureDate(now: number): string {
  return new Date(now).toISOString().slice(0, 10).replace(/-/g, "");
}

export function captureSku(env: EbayEnv, now: number): string {
  return `NBCAPTURE-${env === "production" ? "PRD" : "SBX"}-${captureDate(now)}`;
}

/** Refuses any SKU outside the environment's own capture prefix. */
export function checkCaptureSku(env: EbayEnv, sku: string): void {
  const m = CAPTURE_SKU_RE.exec(sku);
  const want = env === "production" ? "PRD" : "SBX";
  if (!m || m[1] !== want) throw new Error(`refusing SKU: only NBCAPTURE-${want}-<yyyymmdd> may be touched in ${env}`);
}

const shapeOfBody = (r: EbayResponse): Shape => (r.body === null || r.body === undefined ? {} : shapeOf(r.body));
const ok2xx = (s: number) => s >= 200 && s < 300;
const firstEntry = (r: EbayResponse): Record<string, unknown> => {
  const list = r.body && typeof r.body === "object" ? (r.body as { responses?: unknown }).responses : undefined;
  return Array.isArray(list) && list[0] && typeof list[0] === "object" ? (list[0] as Record<string, unknown>) : {};
};

function inventoryItem(sku: string, title: string, imageUrl: string): Record<string, unknown> {
  return {
    sku,
    locale: "en_US",
    condition: "USED_VERY_GOOD",
    conditionDescriptors: [{ name: "40001", values: ["400010"] }],
    availability: { shipToLocationAvailability: { quantity: 1 } },
    packageWeightAndSize: { weight: { value: 1, unit: "OUNCE" }, dimensions: { length: 6, width: 4, height: 1, unit: "INCH" }, packageType: "LETTER" },
    product: {
      title,
      description: "NeonBinder capture test listing. Not for sale; it is ended within minutes.",
      aspects: { Sport: ["Baseball"], Graded: ["No"], Type: ["Sports Trading Card"] },
      imageUrls: [imageUrl],
    },
  };
}

interface Policies {
  fulfillmentPolicyId: string;
  paymentPolicyId: string;
  returnPolicyId: string;
}

function offer(sku: string, price: string, policies: Policies, locationKey: string): Record<string, unknown> {
  return {
    sku,
    marketplaceId: "EBAY_US",
    format: "FIXED_PRICE",
    availableQuantity: 1,
    categoryId: CATEGORY_ID,
    listingDescription: "NeonBinder capture test listing. Not for sale; it is ended within minutes.",
    listingDuration: "GTC",
    listingPolicies: { ...policies, bestOfferTerms: { bestOfferEnabled: false } },
    pricingSummary: { price: { value: price, currency: "USD" } },
    merchantLocationKey: locationKey,
  };
}

const enc = encodeURIComponent;
const C = {
  getItem: (sku: string): EbayCall => ({ label: `GET sell/inventory/v1/inventory_item/${sku}`, method: "GET", host: "api", path: `/sell/inventory/v1/inventory_item/${enc(sku)}`, token: "user" }),
  deleteItem: (sku: string): EbayCall => ({ label: `DELETE sell/inventory/v1/inventory_item/${sku}`, method: "DELETE", host: "api", path: `/sell/inventory/v1/inventory_item/${enc(sku)}`, token: "user" }),
  offersBySku: (sku: string): EbayCall => ({
    label: `GET sell/inventory/v1/offer?sku=${sku}`,
    method: "GET",
    host: "api",
    path: "/sell/inventory/v1/offer",
    query: { sku, marketplace_id: "EBAY_US", format: "FIXED_PRICE", limit: "5" },
    token: "user",
  }),
  policies: (kind: "payment" | "return" | "fulfillment"): EbayCall => ({
    label: `GET sell/account/v1/${kind}_policy`,
    method: "GET",
    host: "api",
    path: `/sell/account/v1/${kind}_policy`,
    query: { marketplace_id: "EBAY_US" },
    token: "user",
  }),
  location: (key: string): EbayCall => ({ label: `GET sell/inventory/v1/location/${key}`, method: "GET", host: "api", path: `/sell/inventory/v1/location/${enc(key)}`, token: "user" }),
  withdraw: (offerId: string): EbayCall => ({ label: "POST sell/inventory/v1/offer/<offerId>/withdraw", method: "POST", host: "api", path: `/sell/inventory/v1/offer/${enc(offerId)}/withdraw`, token: "user" }),
  publish: (offerId: string): EbayCall => ({ label: "POST sell/inventory/v1/offer/<offerId>/publish", method: "POST", host: "api", path: `/sell/inventory/v1/offer/${enc(offerId)}/publish`, token: "user" }),
  bulkItems: (item: unknown): EbayCall => ({ label: "POST sell/inventory/v1/bulk_create_or_replace_inventory_item (1 item)", method: "POST", host: "api", path: "/sell/inventory/v1/bulk_create_or_replace_inventory_item", json: { requests: [item] }, token: "user" }),
  bulkOffers: (o: unknown): EbayCall => ({ label: "POST sell/inventory/v1/bulk_create_offer (1 offer)", method: "POST", host: "api", path: "/sell/inventory/v1/bulk_create_offer", json: { requests: [o] }, token: "user" }),
};

function firstId(r: EbayResponse, list: string, field: string): string | null {
  const arr = r.body && typeof r.body === "object" ? (r.body as Record<string, unknown>)[list] : undefined;
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const v = (arr[0] as Record<string, unknown> | undefined)?.[field];
  return typeof v === "string" && v.length > 0 ? v : null;
}

function offersOf(r: EbayResponse): Array<{ offerId: string; status: string }> {
  if (r.status === 404) return [];
  const arr = r.body && typeof r.body === "object" ? (r.body as { offers?: unknown }).offers : undefined;
  if (!Array.isArray(arr)) return [];
  return arr
    .map((o) => (o && typeof o === "object" ? (o as Record<string, unknown>) : {}))
    .filter((o) => typeof o.offerId === "string")
    .map((o) => ({ offerId: o.offerId as string, status: typeof o.status === "string" ? o.status : "" }));
}

async function store(sink: CaptureSink | null, captures: StoredCapture[], report: (l: string) => void): Promise<number> {
  if (!sink) return 0;
  let stored = 0;
  for (const c of captures) {
    const v = await sink.uploadCapture(c);
    stored += 1;
    report(`stored ${c.endpoint} (HTTP ${c.status}, ${Object.keys(c.shape).length} path(s)): fake verdict ${v.verdict}${v.paths.length ? `; differs: ${v.paths.join(", ")}` : ""}`);
  }
  return stored;
}

// ── Production ─────────────────────────────────────────────────────────────

export interface Picture {
  filename: string;
  contentType: string;
  bytes: Buffer;
}

/** The plan `ebay-capture --prod` prints: exactly the seven writes, then the reads on one line. */
export function prodPlan(sku: string): { writes: string[]; reads: string } {
  return {
    writes: [
      "POST apim commerce/media/v1_beta/image/create_image_from_file (one synthetic NB picture)",
      `POST sell/inventory/v1/bulk_create_or_replace_inventory_item (one item, SKU ${sku}, quantity 1, title "${PROD_TITLE}")`,
      `POST sell/inventory/v1/bulk_create_offer (one offer, $${PROD_PRICE}, your first payment, return and fulfillment policies, location ${LOCATION_KEY})`,
      "POST sell/inventory/v1/offer/<offerId>/publish (the listing goes live)",
      `POST sell/inventory/v1/bulk_update_price_quantity (price only, to $${PROD_NEW_PRICE})`,
      "POST sell/inventory/v1/offer/<offerId>/withdraw (the listing ends)",
      `DELETE sell/inventory/v1/inventory_item/${sku}`,
    ],
    reads:
      `reads (no change): token refresh grant; GET inventory_item/${sku} (must be 404); GET offer?sku=${sku} (must be none); ` +
      `GET payment, return and fulfillment policies (each at least one); GET location/${LOCATION_KEY} (must be ENABLED); GET image/<id>; ` +
      `then GET offer?sku= and GET inventory_item/${sku} again to verify the cleanup`,
  };
}

export function prodPlanLines(sku: string): string[] {
  const p = prodPlan(sku);
  return [...p.writes.map((w, i) => `${i + 1}. ${w}`), p.reads];
}

export type ProdOutcome =
  | { ok: true; stored: number; listingId: string | null }
  | {
      ok: false;
      stage: "precheck" | "write" | "cleanup";
      reason: string;
      /** Requests that changed the account (0 = nothing written). */
      writes: number;
      listingId: string | null;
      cleanedUp: boolean;
    };

export interface ProdDeps {
  api: EbayApi;
  sink: CaptureSink | null;
  sku: string;
  picture: Picture;
  report: (line: string) => void;
  /** Ends the process on a second stop signal (tests pass a recorder). Default: `process.exit`. */
  exit?: (code: number) => void;
}

/**
 * The pre-checks: the SKU is unused and the account has what a listing needs.
 * Reads only. Returns the policies to list with, or why not.
 */
export async function prodPrechecks(api: EbayApi, sku: string): Promise<{ ok: true; policies: Policies } | { ok: false; reason: string }> {
  // `attempt`, not `call`: a 401 or 5xx here is a refusal with nothing written, not a stop.
  const item = await api.attempt(C.getItem(sku));
  if (ok2xx(item.status)) return { ok: false, reason: `inventory item ${sku} already exists (HTTP ${item.status}); run ebay-undo first` };
  if (item.status !== 404) return { ok: false, reason: `GET inventory_item/${sku} answered HTTP ${item.status}; nothing was written` };
  const offers = await api.attempt(C.offersBySku(sku));
  if (offers.status !== 404 && offersOf(offers).length > 0) return { ok: false, reason: `an offer for ${sku} already exists; run ebay-undo first` };
  if (offers.status !== 404 && !ok2xx(offers.status)) return { ok: false, reason: `GET offer?sku= answered HTTP ${offers.status}` };
  const pay = await api.call(C.policies("payment"));
  const ret = await api.call(C.policies("return"));
  const ful = await api.call(C.policies("fulfillment"));
  const paymentPolicyId = firstId(pay, "paymentPolicies", "paymentPolicyId");
  const returnPolicyId = firstId(ret, "returnPolicies", "returnPolicyId");
  const fulfillmentPolicyId = firstId(ful, "fulfillmentPolicies", "fulfillmentPolicyId");
  if (!paymentPolicyId || !returnPolicyId || !fulfillmentPolicyId) return { ok: false, reason: "the account needs at least one payment, return and fulfillment policy (connect eBay in NB first)" };
  const loc = await api.call(C.location(LOCATION_KEY));
  const status = loc.body && typeof loc.body === "object" ? (loc.body as { merchantLocationStatus?: unknown }).merchantLocationStatus : undefined;
  if (loc.status !== 200 || status !== "ENABLED") return { ok: false, reason: `location ${LOCATION_KEY} is missing or not enabled (connect eBay in NB first)` };
  return { ok: true, policies: { paymentPolicyId, returnPolicyId, fulfillmentPolicyId } };
}

/**
 * Up to `CLEANUP_TRIES` attempts; `done` decides success. One refresh grant
 * is allowed across the whole cleanup when a try answers 401.
 */
async function cleanupCall(api: EbayApi, call: EbayCall, done: (s: number) => boolean, regrant: { used: boolean }, report: (l: string) => void): Promise<boolean> {
  for (let i = 1; i <= CLEANUP_TRIES; i++) {
    try {
      const r = await api.attempt(call);
      if (done(r.status)) return true;
      report(`cleanup: ${call.label} answered HTTP ${r.status}${errorIdsOf(r.body).length ? ` (errorIds ${errorIdsOf(r.body).join(",")})` : ""} (try ${i} of ${CLEANUP_TRIES})`);
      if (r.status === 401 && !regrant.used) {
        regrant.used = true;
        await api.grantUser({ regrant: true });
      }
    } catch (err) {
      report(`cleanup: ${call.label} failed: ${err instanceof EbayStop ? err.reason : "error"} (try ${i} of ${CLEANUP_TRIES})`);
      if (err instanceof EbayStop && (err.reason === "cap" || err.reason === "token_refused" || err.reason === "token_malformed")) return false;
    }
  }
  return false;
}

/** Signals that would end the process (and skip the cleanup) while a listing may be live. */
export const GUARDED_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

/**
 * A write to a closed stderr or stdout (EPIPE: `2>&1 | tee` after tee died)
 * or to a hung-up terminal (EIO, after SIGHUP) fails as an asynchronous
 * 'error' event on the stream, not as a throw. With no listener that event
 * ends the process, uncaught, and skips the cleanup with the listing live.
 * Attaches a no-op listener to both streams (the lines are lost, the run goes
 * on) and answers the function that removes it. The CLI attaches one for the
 * whole process; `runProdCapture` attaches its own for its run, so a caller
 * that is not the CLI is covered too.
 */
export function holdStdioErrors(): () => void {
  const ignore = (): void => undefined;
  process.stderr.on("error", ignore);
  process.stdout.on("error", ignore);
  return () => {
    process.stderr.off("error", ignore);
    process.stdout.off("error", ignore);
  };
}

/** What a run has sent so far, for the second-interrupt exit. */
interface Progress {
  writes: number;
  listingId: string | null;
}

/** The exit code for a stop forced by a second signal: 128 + the signal number. */
function signalExitCode(signal: string): number {
  return signal === "SIGHUP" ? 129 : signal === "SIGTERM" ? 143 : 130;
}

/**
 * The production capture holds off stop signals: a signal that kills the
 * process mid-run would leave the real listing live (`finally` does not run
 * on a signal). The first Ctrl-C, terminal close or `kill` is noted and the
 * run, cleanup and verification included, carries on. A second one stops at
 * once, after printing what may be left and the exact command that ends it
 * (`prodFailureLines`). The handlers cover the whole run, from before the
 * token grant until the captures are stored, and are removed afterwards. So
 * does a no-op 'error' listener on stderr and stdout (`holdStdioErrors`): the
 * terminal closing, or a pipe reader dying, must not end the run either.
 */
export async function runProdCapture(deps: ProdDeps): Promise<ProdOutcome> {
  checkCaptureSku("production", deps.sku);
  const exit = deps.exit ?? ((code: number) => process.exit(code));
  const progress: Progress = { writes: 0, listingId: null };
  let signals = 0;
  const say = (line: string) => {
    try {
      deps.report(line);
    } catch {
      // a closed terminal: nothing to do
    }
  };
  const onSignal = (received: unknown) => {
    const signal = typeof received === "string" && received.length <= 16 ? received : "stop signal";
    signals += 1;
    if (signals === 1) {
      say("interrupt ignored: the cleanup must finish first (the listing may be live); interrupt again to stop now without it");
      return;
    }
    if (signals > 2) return;
    const reason = `stopped by a second ${signal} before the cleanup was verified`;
    const outcome: Extract<ProdOutcome, { ok: false }> =
      progress.writes === 0
        ? { ok: false, stage: "precheck", reason: `${reason}; no write had been sent`, writes: 0, listingId: null, cleanedUp: true }
        : { ok: false, stage: "cleanup", reason, writes: progress.writes, listingId: progress.listingId, cleanedUp: false };
    for (const line of prodFailureLines(outcome, deps.sku)) say(line);
    exit(signalExitCode(signal));
  };
  const releaseStdio = holdStdioErrors();
  for (const s of GUARDED_SIGNALS) process.on(s, onSignal);
  try {
    return await runProdCaptureGuarded(deps, progress);
  } finally {
    for (const s of GUARDED_SIGNALS) process.off(s, onSignal);
    // A failed write's 'error' event is queued with process.nextTick, and a
    // run whose awaits never yield to the event loop finishes before that
    // queue drains: remove the listener only after it has.
    setImmediate(releaseStdio);
  }
}

async function runProdCaptureGuarded(deps: ProdDeps, progress: Progress): Promise<ProdOutcome> {
  const { api, sink, sku, picture } = deps;
  // A report that throws (a closed stdout) must never skip the cleanup.
  const report = (line: string): void => {
    try {
      deps.report(line);
    } catch {
      // dropped
    }
  };
  checkCaptureSku("production", sku);
  if (api.env !== "production") throw new Error("the production capture needs the production client");
  await api.grantUser();
  const pre = await prodPrechecks(api, sku);
  if (!pre.ok) return { ok: false, stage: "precheck", reason: pre.reason, writes: 0, listingId: null, cleanedUp: true };

  const captures: StoredCapture[] = [];
  const keep = (op: EbayOp, r: EbayResponse) => captures.push({ endpoint: endpointName(op), status: r.status, shape: shapeOfBody(r) });
  let writes = 0;
  let itemSent = false;
  let offerId: string | null = null;
  let publishSent = false;
  let withdrawn = false;
  let deleted = false;
  let listingId: string | null = null;
  let failure: string | null = null;

  // Counted before it is sent: a write whose answer never came may still have landed.
  const write = async (call: EbayCall): Promise<EbayResponse> => {
    writes += 1;
    progress.writes = writes;
    return api.call(call);
  };

  try {
    // 1. Picture
    const up = await write({ label: "POST commerce/media/v1_beta/image/create_image_from_file", method: "POST", host: "apim", path: "/commerce/media/v1_beta/image/create_image_from_file", multipart: { field: "image", ...picture }, token: "user" });
    if (!ok2xx(up.status)) throw new Error(`the picture upload answered HTTP ${up.status}`);
    keep("uploadImage", up);
    const imageId = /\/commerce\/media\/v1_beta\/image\/([^/?#]{1,256})\/?$/.exec(up.location ?? "")?.[1] ?? null;
    let imageUrl = up.body && typeof up.body === "object" ? (up.body as { imageUrl?: unknown }).imageUrl : undefined;
    if (imageId) {
      const got = await api.call({ label: "GET commerce/media/v1_beta/image/<id>", method: "GET", host: "apim", path: `/commerce/media/v1_beta/image/${enc(imageId)}`, token: "user" });
      if (ok2xx(got.status)) keep("getImage", got);
      if (typeof imageUrl !== "string") imageUrl = got.body && typeof got.body === "object" ? (got.body as { imageUrl?: unknown }).imageUrl : undefined;
    }
    if (typeof imageUrl !== "string" || !imageUrl.startsWith("https://")) throw new Error("the picture upload gave no image URL");

    // 2. Item
    itemSent = true;
    const items = await write(C.bulkItems(inventoryItem(sku, PROD_TITLE, imageUrl)));
    keep("bulkItems", items);
    const ie = firstEntry(items);
    if (!ok2xx(items.status) || typeof ie.statusCode !== "number" || !ok2xx(ie.statusCode)) throw new Error(`the item was refused (errorIds ${errorIdsOf(ie).join(",") || "none"})`);

    // 3. Offer
    const offers = await write(C.bulkOffers(offer(sku, PROD_PRICE, pre.policies, LOCATION_KEY)));
    keep("bulkOffers", offers);
    const oe = firstEntry(offers);
    if (typeof oe.offerId === "string") offerId = oe.offerId;
    if (!offerId || typeof oe.statusCode !== "number" || !ok2xx(oe.statusCode)) throw new Error(`the offer was refused (errorIds ${errorIdsOf(oe).join(",") || "none"})`);

    // 4. Publish
    publishSent = true;
    const pub = await write(C.publish(offerId));
    keep("publishOffer", pub);
    const lid = pub.body && typeof pub.body === "object" ? (pub.body as { listingId?: unknown }).listingId : undefined;
    if (typeof lid === "string") {
      listingId = lid;
      progress.listingId = lid;
    }
    if (!ok2xx(pub.status) || !listingId) throw new Error(`publish answered HTTP ${pub.status} (errorIds ${errorIdsOf(pub.body).join(",") || "none"})`);
    report(`listed: listing ${listingId} (ending it now)`);

    // 5. Price update
    const price = await write({
      label: "POST sell/inventory/v1/bulk_update_price_quantity",
      method: "POST",
      host: "api",
      path: "/sell/inventory/v1/bulk_update_price_quantity",
      json: { requests: [{ sku, offers: [{ offerId, price: { value: PROD_NEW_PRICE, currency: "USD" } }] }] },
      token: "user",
    });
    keep("bulkPriceQuantity", price);
    if (!ok2xx(price.status)) throw new Error(`the price update answered HTTP ${price.status}`);

    // 6. Withdraw
    const wd = await write(C.withdraw(offerId));
    keep("withdrawOffer", wd);
    if (!ok2xx(wd.status)) throw new Error(`withdraw answered HTTP ${wd.status}`);
    withdrawn = true;

    // 7. Delete
    const del = await write(C.deleteItem(sku));
    keep("deleteItem", del);
    if (!ok2xx(del.status)) throw new Error(`delete answered HTTP ${del.status}`);
    deleted = true;
  } catch (err) {
    failure = err instanceof Error ? err.message : "error";
    report(`stopped: ${failure}`);
  } finally {
    // Remove whatever the run made, whatever happened above.
    if (itemSent) {
      const regrant = { used: false };
      if (publishSent && !withdrawn) {
        // An offer that is not live answers 404: already ended.
        if (!offerId) {
          const found = await api.attempt(C.offersBySku(sku)).catch(() => null);
          offerId = found ? (offersOf(found)[0]?.offerId ?? null) : null;
        }
        if (offerId) withdrawn = await cleanupCall(api, C.withdraw(offerId), (s) => ok2xx(s) || s === 404, regrant, report);
      }
      if (!deleted) deleted = await cleanupCall(api, C.deleteItem(sku), (s) => ok2xx(s) || s === 404, regrant, report);
    }
  }

  let verified = true;
  if (itemSent) {
    try {
      const o = await api.attempt(C.offersBySku(sku));
      const i = await api.attempt(C.getItem(sku));
      verified = (o.status === 404 || (ok2xx(o.status) && offersOf(o).length === 0)) && i.status === 404;
    } catch {
      verified = false;
    }
  }
  if (!verified) return { ok: false, stage: "cleanup", reason: failure ?? "the listing could not be verified gone", writes, listingId, cleanedUp: false };
  if (failure) return { ok: false, stage: "write", reason: failure, writes, listingId, cleanedUp: true };
  const stored = await store(sink, captures, report);
  return { ok: true, stored, listingId };
}

/** What a failed production run prints (terminal only). */
export function prodFailureLines(o: Extract<ProdOutcome, { ok: false }>, sku: string): string[] {
  if (o.stage === "precheck") return [`nothing written: ${o.reason}`];
  const lines = [`the run failed after ${o.writes} write(s): ${o.reason}`];
  if (o.cleanedUp) {
    lines.push("the cleanup removed what the run made (verified); nothing was stored");
    return lines;
  }
  lines.push(`THE CLEANUP COULD NOT BE VERIFIED.${o.listingId ? ` Listing id: ${o.listingId}.` : ""}`);
  lines.push(`  run: node dist/recorder/cli.js ebay-undo --prod --sku ${sku} --yes   (same credential flags)`);
  lines.push("  or end it in Seller Hub.");
  return lines;
}

// ── Sandbox ────────────────────────────────────────────────────────────────

export function sandboxPlanLines(sku: string, date: string, publicKeyId: string | null): string[] {
  return [
    "reads: refresh and client-credentials grants; identity; opted-in programs; payment, return and fulfillment policies;",
    `  location; offer?sku=${sku}; orders (limit 1); inventory_item (limit 1)${publicKeyId ? "; notification public key" : ""}`,
    "writes (sandbox): opt_in; payment and return policy create " +
      `(NBCAPTURE-SBX-${date}-pay, -ret); location nbcapture-sbx-${date} create, update, enable; one bulk item (${sku}); ` +
      "one bulk offer; PUT offer; publish (expected refused); DELETE inventory item; withdraw if the sandbox publishes",
    "cleanup (not captured): withdraw, DELETE item, DELETE both policies, DELETE the location",
  ];
}

export interface SandboxDeps {
  api: EbayApi;
  sink: CaptureSink | null;
  now: number;
  publicKeyId: string | null;
  report: (line: string) => void;
}

export interface SandboxOutcome {
  ok: boolean;
  stored: number;
  reason: string | null;
  leftovers: string[];
}

export async function runSandboxCapture(deps: SandboxDeps): Promise<SandboxOutcome> {
  const { api, sink, report } = deps;
  if (api.env !== "sandbox") throw new Error("the sandbox capture needs the sandbox client");
  const date = captureDate(deps.now);
  const sku = captureSku("sandbox", deps.now);
  const locKey = `nbcapture-sbx-${date}`;
  const captures: StoredCapture[] = [];
  const keep = (op: EbayOp, r: EbayResponse, variant?: string) => captures.push({ endpoint: endpointName(op, variant), status: r.status, shape: shapeOfBody(r) });
  const made = { payment: null as string | null, ret: null as string | null, location: false, item: false, offerId: null as string | null, live: false, deleted: false };
  let reason: string | null = null;
  const leftovers: string[] = [];

  try {
    keep("token", await api.grantUser(), "refresh_token");
    keep("token", await api.grantApp(), "client_credentials");
    keep("identityUser", await api.call({ label: "GET commerce/identity/v1/user/", method: "GET", host: "apiz", path: "/commerce/identity/v1/user/", token: "user" }));
    keep("optedInPrograms", await api.call({ label: "GET sell/account/v1/program/get_opted_in_programs", method: "GET", host: "api", path: "/sell/account/v1/program/get_opted_in_programs", token: "user" }));
    const optIn = await api.call({ label: "POST sell/account/v1/program/opt_in", method: "POST", host: "api", path: "/sell/account/v1/program/opt_in", json: { programType: "SELLING_POLICY_MANAGEMENT" }, token: "user" });
    if (ok2xx(optIn.status)) keep("optIn", optIn);
    else if (optIn.status === 409) keep("optIn", optIn, "409");
    const pay = await api.call(C.policies("payment"));
    keep("listPaymentPolicies", pay);
    const ret = await api.call(C.policies("return"));
    keep("listReturnPolicies", ret);
    const ful = await api.call(C.policies("fulfillment"));
    keep("listFulfillmentPolicies", ful);

    const cp = await api.call({
      label: "POST sell/account/v1/payment_policy",
      method: "POST",
      host: "api",
      path: "/sell/account/v1/payment_policy",
      json: { name: `NBCAPTURE-SBX-${date}-pay`, marketplaceId: "EBAY_US", categoryTypes: [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES" }], immediatePay: true },
      token: "user",
    });
    if (ok2xx(cp.status)) {
      keep("createPaymentPolicy", cp);
      made.payment = String((cp.body as Record<string, unknown>).paymentPolicyId ?? "") || null;
    }
    const cr = await api.call({
      label: "POST sell/account/v1/return_policy",
      method: "POST",
      host: "api",
      path: "/sell/account/v1/return_policy",
      json: {
        name: `NBCAPTURE-SBX-${date}-ret`,
        marketplaceId: "EBAY_US",
        categoryTypes: [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES" }],
        returnsAccepted: true,
        returnPeriod: { value: 30, unit: "DAY" },
        returnShippingCostPayer: "BUYER",
        refundMethod: "MONEY_BACK",
      },
      token: "user",
    });
    if (ok2xx(cr.status)) {
      keep("createReturnPolicy", cr);
      made.ret = String((cr.body as Record<string, unknown>).returnPolicyId ?? "") || null;
    }

    const address = { location: { address: { city: "Austin", stateOrProvince: "TX", postalCode: "78701", country: "US" } }, locationTypes: ["WAREHOUSE"], name: "NeonBinder capture" };
    const lp = `/sell/inventory/v1/location/${enc(locKey)}`;
    const lc = await api.call({ label: `POST sell/inventory/v1/location/${locKey}`, method: "POST", host: "api", path: lp, json: { ...address, merchantLocationStatus: "ENABLED" }, token: "user" });
    if (ok2xx(lc.status)) keep("createLocation", lc);
    made.location = true;
    keep("updateLocation", await api.call({ label: `POST sell/inventory/v1/location/${locKey}/update_location_details`, method: "POST", host: "api", path: `${lp}/update_location_details`, json: address, token: "user" }));
    keep("enableLocation", await api.call({ label: `POST sell/inventory/v1/location/${locKey}/enable`, method: "POST", host: "api", path: `${lp}/enable`, token: "user" }));
    keep("getLocation", await api.call(C.location(locKey)));

    made.item = true;
    keep("bulkItems", await api.call(C.bulkItems(inventoryItem(sku, "NB capture sandbox item", SANDBOX_IMAGE_URL))));
    const fulfillmentPolicyId = firstId(ful, "fulfillmentPolicies", "fulfillmentPolicyId");
    const paymentPolicyId = made.payment ?? firstId(pay, "paymentPolicies", "paymentPolicyId");
    const returnPolicyId = made.ret ?? firstId(ret, "returnPolicies", "returnPolicyId");
    if (!fulfillmentPolicyId || !paymentPolicyId || !returnPolicyId) {
      report("no fulfillment policy on the sandbox seller (or a policy create failed): the offer, publish and PUT steps are skipped");
    } else {
      const policies = { fulfillmentPolicyId, paymentPolicyId, returnPolicyId };
      const bo = await api.call(C.bulkOffers(offer(sku, "12.50", policies, locKey)));
      keep("bulkOffers", bo);
      const oe = firstEntry(bo);
      made.offerId = typeof oe.offerId === "string" ? oe.offerId : null;
      if (!made.offerId) made.offerId = offersOf(await api.call(C.offersBySku(sku)))[0]?.offerId ?? null;
      if (made.offerId) {
        const { sku: _s, marketplaceId: _m, format: _f, ...update } = offer(sku, "12.49", policies, locKey);
        void _s;
        void _m;
        void _f;
        keep("updateOffer", await api.call({ label: "PUT sell/inventory/v1/offer/<offerId>", method: "PUT", host: "api", path: `/sell/inventory/v1/offer/${enc(made.offerId)}`, json: update, token: "user" }));
        keep("getOffers", await api.call(C.offersBySku(sku)));
        const pub = await api.call(C.publish(made.offerId));
        if (ok2xx(pub.status)) {
          made.live = true;
          keep("publishOffer", pub);
          const wd = await api.call(C.withdraw(made.offerId));
          if (ok2xx(wd.status)) {
            keep("withdrawOffer", wd);
            made.live = false;
          }
        } else {
          report(`publish refused as expected (HTTP ${pub.status}, errorIds ${errorIdsOf(pub.body).join(",") || "none"})`);
          keep("publishOffer", pub, "25002");
        }
      }
    }
    const since = new Date(deps.now - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    keep(
      "orders",
      await api.call({ label: "GET sell/fulfillment/v1/order (limit 1)", method: "GET", host: "api", path: "/sell/fulfillment/v1/order", query: { filter: `lastmodifieddate:[${since}T00:00:00.000Z..]`, limit: "1", offset: "0" }, token: "user" }),
    );
    keep("listItems", await api.call({ label: "GET sell/inventory/v1/inventory_item (limit 1)", method: "GET", host: "api", path: "/sell/inventory/v1/inventory_item", query: { limit: "1", offset: "0" }, token: "user" }));
    const del = await api.call(C.deleteItem(sku));
    if (ok2xx(del.status)) {
      keep("deleteItem", del);
      made.deleted = true;
    }
    if (deps.publicKeyId) {
      const pk = await api.call({ label: "GET commerce/notification/v1/public_key/<kid>", method: "GET", host: "api", path: `/commerce/notification/v1/public_key/${enc(deps.publicKeyId)}`, token: "app" });
      if (ok2xx(pk.status)) keep("publicKey", pk);
    }
  } catch (err) {
    reason = err instanceof EbayStop ? err.message : err instanceof Error ? err.message : "error";
    report(`stopped: ${reason}`);
  } finally {
    // One try each; a leftover is printed with the command that removes it.
    const tryOnce = async (call: EbayCall, okStatus: (s: number) => boolean): Promise<boolean> => {
      try {
        return okStatus((await api.attempt(call)).status);
      } catch {
        return false;
      }
    };
    if (made.live && made.offerId && !(await tryOnce(C.withdraw(made.offerId), (s) => ok2xx(s) || s === 404))) leftovers.push(`live offer for ${sku}`);
    if (made.item && !made.deleted && !(await tryOnce(C.deleteItem(sku), (s) => ok2xx(s) || s === 404))) leftovers.push(`inventory item ${sku}`);
    for (const [kind, id] of [["payment", made.payment], ["return", made.ret]] as const) {
      if (id && !(await tryOnce({ label: `DELETE sell/account/v1/${kind}_policy/<id>`, method: "DELETE", host: "api", path: `/sell/account/v1/${kind}_policy/${enc(id)}`, token: "user" }, (s) => ok2xx(s) || s === 404))) {
        leftovers.push(`${kind} policy NBCAPTURE-SBX-${date}-${kind === "payment" ? "pay" : "ret"}`);
      }
    }
    if (made.location && !(await tryOnce({ label: `DELETE sell/inventory/v1/location/${locKey}`, method: "DELETE", host: "api", path: `/sell/inventory/v1/location/${enc(locKey)}`, token: "user" }, (s) => ok2xx(s) || s === 404))) {
      leftovers.push(`location ${locKey}`);
    }
  }
  const stored = reason === null ? await store(sink, captures, report) : 0;
  return { ok: reason === null && leftovers.length === 0, stored, reason, leftovers };
}

// ── Undo ───────────────────────────────────────────────────────────────────

export interface UndoOutcome {
  ok: boolean;
  lines: string[];
}

/** `ebay-undo`: withdraw the capture SKU's live offer, delete its item, verify. */
export async function runEbayUndo(api: EbayApi, sku: string): Promise<UndoOutcome> {
  checkCaptureSku(api.env, sku);
  const lines: string[] = [];
  await api.grantUser();
  const offers = offersOf(await api.call(C.offersBySku(sku)));
  for (const o of offers) {
    if (o.status !== "PUBLISHED") continue;
    const r = await api.call(C.withdraw(o.offerId));
    lines.push(`withdraw: HTTP ${r.status}`);
  }
  const del = await api.call(C.deleteItem(sku));
  lines.push(`delete ${sku}: HTTP ${del.status}${del.status === 404 ? " (already gone)" : ""}`);
  const o = await api.call(C.offersBySku(sku));
  const i = await api.call(C.getItem(sku));
  const ok = (o.status === 404 || offersOf(o).length === 0) && i.status === 404;
  lines.push(ok ? "verified: no offer, no item" : "NOT verified: end it in Seller Hub");
  return { ok, lines };
}
