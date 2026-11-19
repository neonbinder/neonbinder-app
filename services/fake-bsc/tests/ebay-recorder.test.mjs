// The eBay recorder against a STUBBED eBay: every eBay answer here is a stub
// function, so nothing reaches eBay. Covers the client's pacing, cap and
// stop rules, the credentials file checks, ebay-record, the sandbox capture,
// the production capture's guards and ebay-undo.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, writeFile, chmod, symlink, mkdir, rm, rename, open as openFile } from "node:fs/promises";
import { execFileSync, spawn } from "node:child_process";
import { PassThrough } from "node:stream";
import { tmpdir } from "node:os";
import path from "node:path";
import { REFRESH, CERT, NOW, PRD_SKU, SBX_SKU, stubEbay, tokenOk, api, PICTURE, prodRoutes, sink } from "./ebay-stubs.mjs";

const require = createRequire(import.meta.url);
const { EbayApi, EbayStop, EBAY_SCOPES, MIN_EBAY_INTERVAL_MS } = require("../dist/recorder/ebay-api.js");
const { readCredsFile, readProductionCreds } = require("../dist/recorder/ebay-credentials.js");
const { ebayRecordPlan, runEbayRecord } = require("../dist/recorder/ebay-record.js");
const { runProdCapture, runSandboxCapture, runEbayUndo, prodPlanLines, prodFailureLines, checkCaptureSku, captureSku, GUARDED_SIGNALS } = require("../dist/recorder/ebay-capture.js");
const { EBAY_REQUIRED_CAPTURES, EBAY_CONDITIONAL_WRITE_CAPTURES, EBAY_CAPTURE_ENDPOINTS } = require("../dist/src/ebay/captures.js");
const { endpointName } = require("../dist/src/ebay/sample.js");
const { askYes, askToType, typeOnTerminal, askOnTerminal } = require("../dist/recorder/confirm.js");
const { ebayCapture, ebayUndo, parseArgs } = require("../dist/recorder/cli.js");
const { canonicalRequest, requestKey } = require("../dist/src/requestKey.js");

/** Requests that change the account: anything but GET and the token endpoint. */
const writesOf = (calls) => calls.filter((c) => c.method !== "GET" && c.path !== "/identity/v1/oauth2/token");

describe("eBay recorder client", () => {
  it("paces calls a second apart, and the refresh grant asks for NB's scopes only", async () => {
    const { api: a, stub, sleeps } = api("sandbox", { "GET /x": () => ({ status: 200, body: {} }) });
    await a.grantUser();
    await a.call({ label: "GET x", method: "GET", host: "api", path: "/x", token: "user" });
    await a.call({ label: "GET x", method: "GET", host: "api", path: "/x", token: "user" });
    assert.deepEqual(sleeps, [MIN_EBAY_INTERVAL_MS, MIN_EBAY_INTERVAL_MS]);
    const grant = new URLSearchParams(stub.calls[0].body);
    assert.equal(stub.calls[0].host, "api.sandbox.ebay.com");
    assert.equal(grant.get("grant_type"), "refresh_token");
    assert.equal(grant.get("scope"), EBAY_SCOPES.join(" "));
  });

  it("never sends an authorization-code grant, and only one refresh grant a run", async () => {
    const { api: a, stub } = api("sandbox", {});
    await a.grantUser();
    await assert.rejects(() => a.grantUser(), /one refresh grant/);
    await a.grantApp();
    await assert.rejects(() => a.grantApp(), /one app token/);
    assert.ok(stub.calls.every((c) => !c.body.includes("authorization_code")));
  });

  for (const [status, reason] of [
    [401, "unauthorized"],
    [429, "rate_limited"],
    [500, "server_error"],
    [503, "server_error"],
  ]) {
    it(`stops on the first ${status}, without retrying`, async () => {
      const { api: a, stub } = api("sandbox", { "GET /x": () => ({ status, body: { errors: [{ errorId: 1001 }] } }) });
      await a.grantUser();
      const err = await a.call({ label: "GET x", method: "GET", host: "api", path: "/x", token: "user" }).catch((e) => e);
      assert.ok(err instanceof EbayStop);
      assert.equal(err.reason, reason);
      assert.equal(stub.calls.filter((c) => c.path === "/x").length, 1);
    });
  }

  it("stops at the call cap", async () => {
    const { api: a } = api("sandbox", { "GET /x": () => ({ status: 200, body: {} }) }, { maxCalls: 2 });
    await a.grantUser();
    await a.call({ label: "GET x", method: "GET", host: "api", path: "/x", token: "user" });
    const err = await a.call({ label: "GET x", method: "GET", host: "api", path: "/x", token: "user" }).catch((e) => e);
    assert.equal(err.reason, "cap");
  });

  it("a refused grant or a network error stops the run and never names a credential", async () => {
    const refused = api("sandbox", { "POST /identity/v1/oauth2/token": () => ({ status: 400, body: { error: "invalid_grant", error_description: REFRESH } }) });
    const e1 = await refused.api.grantUser().catch((e) => e);
    assert.equal(e1.reason, "token_refused");
    assert.ok(!e1.message.includes(REFRESH) && !e1.message.includes(CERT));
    const down = api("sandbox", { "POST /identity/v1/oauth2/token": () => new TypeError(`fetch failed ${REFRESH}`) });
    const e2 = await down.api.grantUser().catch((e) => e);
    assert.equal(e2.reason, "network");
    assert.ok(!e2.message.includes(REFRESH));
  });

  it("forget() drops every credential", async () => {
    const { api: a, stub } = api("sandbox", {});
    a.forget();
    await a.grantUser();
    // The grant went out with emptied credentials: nothing is held after forget.
    const sent = JSON.stringify(stub.calls[0]);
    assert.ok(!sent.includes(REFRESH));
    assert.ok(!sent.includes(Buffer.from(`NB-app-id:${CERT}`).toString("base64")));
    assert.equal(new URLSearchParams(stub.calls[0].body).get("refresh_token"), "");
  });
});

describe("eBay recorder credentials", () => {
  let dir;
  before(async () => (dir = await mkdtemp(path.join(tmpdir(), "nb-ebay-creds-"))));
  after(() => rm(dir, { recursive: true, force: true }));

  const good = JSON.stringify({ clientId: "NB-app-id", certId: CERT, refreshToken: REFRESH });

  it("reads a mode-600 file outside any checkout", async () => {
    const f = path.join(dir, "ok.json");
    await writeFile(f, good, { mode: 0o600 });
    const c = await readCredsFile(f);
    assert.equal(c.clientId, "NB-app-id");
  });

  it("refuses a file others can read, a link, a file in a git checkout, and bad JSON without quoting it", async () => {
    const loose = path.join(dir, "loose.json");
    await writeFile(loose, good);
    await chmod(loose, 0o644);
    await assert.rejects(() => readCredsFile(loose), /chmod 600/);
    const link = path.join(dir, "link.json");
    await writeFile(path.join(dir, "target.json"), good, { mode: 0o600 });
    await symlink(path.join(dir, "target.json"), link);
    await assert.rejects(() => readCredsFile(link), /link/);
    const repo = path.join(dir, "repo");
    await mkdir(path.join(repo, ".git"), { recursive: true });
    await writeFile(path.join(repo, "c.json"), good, { mode: 0o600 });
    await assert.rejects(() => readCredsFile(path.join(repo, "c.json")), /git checkout/);
    const bad = path.join(dir, "bad.json");
    await writeFile(bad, `{"certId": "${CERT}"`, { mode: 0o600 });
    const err = await readCredsFile(bad).catch((e) => e);
    assert.match(err.message, /not valid JSON/);
    assert.ok(!err.message.includes(CERT));
    await assert.rejects(() => readCredsFile(path.join(dir, "ok.json"), { uid: 999999 }), /not owned by you/);
  });

  it("opens with O_NOFOLLOW and checks the open handle: a link, a FIFO, a directory and an oversized file are refused", async () => {
    // A link to a good file: the kernel refuses it at open (O_NOFOLLOW).
    await writeFile(path.join(dir, "real.json"), good, { mode: 0o600 });
    await symlink(path.join(dir, "real.json"), path.join(dir, "via-link.json"));
    await assert.rejects(() => readCredsFile(path.join(dir, "via-link.json")), /is a link/);
    // A FIFO with no writer: refused by fstat, and the open does not hang (O_NONBLOCK).
    const fifo = path.join(dir, "creds.fifo");
    let haveFifo = true;
    try {
      execFileSync("mkfifo", ["-m", "600", fifo]);
    } catch {
      haveFifo = false;
    }
    if (haveFifo) await assert.rejects(() => readCredsFile(fifo), /not a regular file/);
    const sub = path.join(dir, "a-dir");
    await mkdir(sub, { mode: 0o700 });
    await assert.rejects(() => readCredsFile(sub), /not a regular file/);
    const big = path.join(dir, "big.json");
    await writeFile(big, JSON.stringify({ clientId: "NB-app-id", certId: CERT, refreshToken: REFRESH, pad: "x".repeat(16 * 1024) }), { mode: 0o600 });
    await assert.rejects(() => readCredsFile(big), /larger than a credentials file/);
    await assert.rejects(() => readCredsFile(path.join(dir, "missing.json")), /not found/);
    // The mode and owner checks still hold on the handle.
    const loose = path.join(dir, "loose2.json");
    await writeFile(loose, good, { mode: 0o640 });
    await chmod(loose, 0o640);
    await assert.rejects(() => readCredsFile(loose), /chmod 600/);
    await assert.rejects(() => readCredsFile(path.join(dir, "real.json"), { uid: 999999 }), /not owned by you/);
    assert.equal((await readCredsFile(path.join(dir, "real.json"))).refreshToken, REFRESH);
  });

  it("a link inside the path is followed for the git check: a file in a checkout reached through a linked directory is refused", async () => {
    const repo = path.join(dir, "repo2");
    await mkdir(path.join(repo, ".git"), { recursive: true });
    await writeFile(path.join(repo, "c.json"), good, { mode: 0o600 });
    await symlink(repo, path.join(dir, "outside"));
    await assert.rejects(() => readCredsFile(path.join(dir, "outside", "c.json")), /git checkout/);
  });

  it("production: reads the Cert ID and the stored session's refresh token through the secret reader", async () => {
    const asked = [];
    const read = async (name, project) => {
      asked.push([name, project]);
      return name === "cert" ? `${CERT}\n` : JSON.stringify({ username: "u", token: "t", refreshToken: REFRESH });
    };
    const c = await readProductionCreds({ clientId: "NB-app-id", certSecret: "cert", sessionSecret: "session", project: "proj-1234", read });
    assert.equal(c.certId, CERT);
    assert.equal(c.refreshToken, REFRESH);
    assert.deepEqual(asked, [["cert", "proj-1234"], ["session", "proj-1234"]]);
    await assert.rejects(() => readProductionCreds({ clientId: "x", certSecret: "c", sessionSecret: "s", project: "p-1234", read: async (n) => (n === "c" ? CERT : "{}") }), /refreshToken/);
  });

  it("refuses credential values as flags", async () => {
    await assert.rejects(() => ebayCapture(parseArgs(["ebay-capture", "--refresh-token", "x"]).flags), /not accepted/);
  });
});

describe("ebay-record", () => {
  const shipBody = { shippingServices: [{ shippingService: "USPSGroundAdvantage", description: "x", sellerOnlyField: "drop me" }] };

  it("plans both pinned reads, or only the pinned ones missed; refuses any other eBay miss", () => {
    assert.equal(ebayRecordPlan(null).todo.length, 2);
    const req = canonicalRequest({ method: "GET", path: "ebay/api/commerce/taxonomy/v1/category_tree/0/get_item_aspects_for_category", query: "category_id=261328" });
    const other = canonicalRequest({ method: "GET", path: "ebay/api/commerce/taxonomy/v1/category_tree/0/get_item_aspects_for_category", query: "category_id=1" });
    const bsc = canonicalRequest({ method: "GET", path: "marketplace/card/abc/card-listing" });
    const m = (r) => ({ ns: "x", key: requestKey(r), kind: "catalogue", method: "GET", path: r.path, request: r, count: 1 });
    const plan = ebayRecordPlan([m(req), m(other), m(bsc)]);
    assert.deepEqual(plan.todo.map((p) => p.endpoint), ["ebayItemAspects"]);
    assert.equal(plan.refused.length, 1);
    assert.match(plan.refused[0], /ebay_query_not_pinned/);
  });

  it("reads the sandbox with one user token, sanitises and uploads; only GETs go to eBay", async () => {
    const { api: a, stub } = api("sandbox", {
      "GET /sell/metadata/v1/shipping/marketplace/EBAY_US/get_shipping_services": () => ({ status: 200, body: shipBody }),
      "GET /commerce/taxonomy/v1/category_tree/0/get_item_aspects_for_category": () => ({ status: 200, body: { aspects: [{ localizedAspectName: "Sport", aspectValues: [{ localizedValue: "Baseball" }] }] } }),
    });
    const uploads = [];
    const report = [];
    const r = await runEbayRecord({ api: a, fake: { uploadRecording: async (x) => uploads.push(x) }, todo: ebayRecordPlan(null).todo, report: (l) => report.push(l) });
    assert.equal(r.recorded, 2);
    assert.deepEqual(uploads[0].response.body, { shippingServices: [{ shippingService: "USPSGroundAdvantage", description: "x" }] });
    assert.equal(uploads[1].request.path, "ebay/api/commerce/taxonomy/v1/category_tree/0/get_item_aspects_for_category");
    assert.deepEqual(uploads[1].request.query, [["category_id", "261328"]]);
    assert.ok(report.some((l) => l.includes("aspectValues")));
    assert.deepEqual(writesOf(stub.calls), []);
    assert.equal(stub.calls.find((c) => c.path.includes("get_item_aspects")).query.category_id, "261328");
  });
});

// ── Production capture ────────────────────────────────────────────────────


describe("ebay-capture --prod: the plan", () => {
  it("the dry run prints exactly 7 requests that change the account, and sends nothing", async () => {
    const lines = prodPlanLines(PRD_SKU);
    assert.equal(lines.filter((l) => /^\d+\. /.test(l)).length, 7);
    assert.deepEqual(lines.filter((l) => /^\d+\. /.test(l)).map((l) => l.split(".")[0]), ["1", "2", "3", "4", "5", "6", "7"]);
    // Through the CLI: no credentials read, no fake called, nothing sent.
    const out = [];
    const write = process.stderr.write;
    process.stderr.write = (s) => (out.push(String(s)), true);
    try {
      const code = await ebayCapture(parseArgs(["ebay-capture", "--prod"]).flags, () => NOW);
      assert.equal(code, 0);
    } finally {
      process.stderr.write = write;
    }
    const numbered = out.join("").split("\n").filter((l) => /^\s+\d+\. /.test(l));
    assert.equal(numbered.length, 7);
    assert.match(out.join(""), /dry run: nothing sent/);
  });

  it("refuses any SKU but today's NBCAPTURE-PRD-<yyyymmdd>", async () => {
    assert.equal(captureSku("production", NOW), PRD_SKU);
    await assert.rejects(() => ebayCapture(parseArgs(["ebay-capture", "--prod", "--sku", "NB2-realcard-NM"]).flags, () => NOW), /refusing SKU/);
    await assert.rejects(() => ebayCapture(parseArgs(["ebay-capture", "--prod", "--sku", SBX_SKU]).flags, () => NOW), /refusing SKU/);
    const { api: a } = api("production", prodRoutes().routes);
    await assert.rejects(() => runProdCapture({ api: a, sink: null, sku: SBX_SKU, picture: PICTURE, report: () => {} }), /refusing SKU/);
    await assert.rejects(() => runProdCapture({ api: a, sink: null, sku: "NBCAPTURE-PRD-x", picture: PICTURE, report: () => {} }), /refusing SKU/);
    assert.throws(() => checkCaptureSku("production", "NB2-abc-NM"), /refusing SKU/);
  });
});

describe("ebay-capture --prod: the run", () => {
  it("happy path: the seven writes in order, the listing ended and deleted, captures stored after the cleanup", async () => {
    const { routes } = prodRoutes();
    const { api: a, stub } = api("production", routes);
    const s = sink();
    const out = await runProdCapture({ api: a, sink: s, sku: PRD_SKU, picture: PICTURE, report: () => {} });
    assert.equal(out.ok, true, JSON.stringify(out));
    assert.deepEqual(
      writesOf(stub.calls).map((c) => `${c.method} ${c.path}`),
      [
        "POST /commerce/media/v1_beta/image/create_image_from_file",
        "POST /sell/inventory/v1/bulk_create_or_replace_inventory_item",
        "POST /sell/inventory/v1/bulk_create_offer",
        "POST /sell/inventory/v1/offer/777/publish",
        "POST /sell/inventory/v1/bulk_update_price_quantity",
        "POST /sell/inventory/v1/offer/777/withdraw",
        `DELETE /sell/inventory/v1/inventory_item/${PRD_SKU}`,
      ],
    );
    assert.ok(stub.calls.every((c) => c.host.endsWith("ebay.com") && !c.host.includes("sandbox")));
    const priceBody = JSON.parse(writesOf(stub.calls)[4].body);
    assert.deepEqual(priceBody, { requests: [{ sku: PRD_SKU, offers: [{ offerId: "777", price: { value: "999.98", currency: "USD" } }] }] });
    const offerBody = JSON.parse(writesOf(stub.calls)[2].body).requests[0];
    assert.equal(offerBody.pricingSummary.price.value, "999.99");
    assert.equal(offerBody.availableQuantity, 1);
    const itemBody = JSON.parse(writesOf(stub.calls)[1].body).requests[0];
    assert.equal(itemBody.product.title, "NB capture test listing - not for sale");
    assert.equal(itemBody.availability.shipToLocationAvailability.quantity, 1);
    assert.deepEqual(
      s.stored.map((c) => c.endpoint),
      [
        "POST ebay/apim/commerce/media/v1_beta/image/create_image_from_file",
        "GET ebay/apim/commerce/media/v1_beta/image/:imageId",
        "POST ebay/api/sell/inventory/v1/bulk_create_or_replace_inventory_item",
        "POST ebay/api/sell/inventory/v1/bulk_create_offer",
        "POST ebay/api/sell/inventory/v1/offer/:offerId/publish",
        "POST ebay/api/sell/inventory/v1/bulk_update_price_quantity",
        "POST ebay/api/sell/inventory/v1/offer/:offerId/withdraw",
        "DELETE ebay/api/sell/inventory/v1/inventory_item/:sku",
      ],
    );
    // Shapes only: no value from eBay reaches the fake.
    const blob = JSON.stringify(s.stored);
    for (const v of ["110000000001", "777", "i.ebayimg.com", PRD_SKU]) assert.ok(!blob.includes(v), v);
  });

  for (const [what, over, reason] of [
    ["the SKU already has an item", { [`GET /sell/inventory/v1/inventory_item/${PRD_SKU}`]: () => ({ status: 200, body: { sku: PRD_SKU } }) }, /already exists/],
    ["the SKU already has an offer", { "GET /sell/inventory/v1/offer": () => ({ status: 200, body: { offers: [{ offerId: "1", status: "UNPUBLISHED" }] } }) }, /offer .* already exists/],
    ["the account has no fulfillment policy", { "GET /sell/account/v1/fulfillment_policy": () => ({ status: 200, body: { total: 0, fulfillmentPolicies: [] } }) }, /policy/],
    ["the location is disabled", { "GET /sell/inventory/v1/location/neonbinder-main": () => ({ status: 200, body: { merchantLocationStatus: "DISABLED" } }) }, /location/],
    ["the location is missing", { "GET /sell/inventory/v1/location/neonbinder-main": () => ({ status: 404, body: { errors: [{ errorId: 25804 }] } }) }, /location/],
    ["only the payment policy list is empty", { "GET /sell/account/v1/payment_policy": () => ({ status: 200, body: { total: 0, paymentPolicies: [] } }) }, /payment, return and fulfillment policy/],
    ["only the return policy list is empty", { "GET /sell/account/v1/return_policy": () => ({ status: 200, body: { total: 0, returnPolicies: [] } }) }, /payment, return and fulfillment policy/],
    ["the offer read answers 503", { "GET /sell/inventory/v1/offer": () => ({ status: 503, body: { errors: [{ errorId: 25001 }] } }) }, /GET offer\?sku= answered HTTP 503/],
    ["the offer read answers 400", { "GET /sell/inventory/v1/offer": () => ({ status: 400, body: { errors: [{ errorId: 25709 }] } }) }, /GET offer\?sku= answered HTTP 400/],
    ["the item read answers 500", { [`GET /sell/inventory/v1/inventory_item/${PRD_SKU}`]: () => ({ status: 500 }) }, /inventory_item\/NBCAPTURE-PRD-20261116 answered HTTP 500/],
    ["the item read answers 401", { [`GET /sell/inventory/v1/inventory_item/${PRD_SKU}`]: () => ({ status: 401, body: { errors: [{ errorId: 1001 }] } }) }, /inventory_item\/NBCAPTURE-PRD-20261116 answered HTTP 401/],
  ]) {
    it(`the pre-check refuses, with nothing written, when ${what}`, async () => {
      const { routes } = prodRoutes(over);
      const { api: a, stub } = api("production", routes);
      const s = sink();
      const out = await runProdCapture({ api: a, sink: s, sku: PRD_SKU, picture: PICTURE, report: () => {} });
      assert.equal(out.ok, false);
      assert.equal(out.stage, "precheck");
      assert.match(out.reason, reason);
      assert.equal(out.writes, 0);
      assert.deepEqual(writesOf(stub.calls), []);
      assert.deepEqual(s.stored, []);
      assert.deepEqual(prodFailureLines(out, PRD_SKU), [`nothing written: ${out.reason}`]);
    });
  }

  it("the finally block withdraws and deletes after a later failure (price update refused), and stores nothing", async () => {
    const { routes, state } = prodRoutes({ "POST /sell/inventory/v1/bulk_update_price_quantity": () => ({ status: 400, body: { errors: [{ errorId: 25709 }] } }) });
    const { api: a, stub } = api("production", routes);
    const s = sink();
    const out = await runProdCapture({ api: a, sink: s, sku: PRD_SKU, picture: PICTURE, report: () => {} });
    assert.equal(out.ok, false);
    assert.equal(out.stage, "write");
    assert.equal(out.cleanedUp, true);
    const w = writesOf(stub.calls).map((c) => `${c.method} ${c.path}`);
    assert.ok(w.includes("POST /sell/inventory/v1/offer/777/withdraw"));
    assert.ok(w.includes(`DELETE /sell/inventory/v1/inventory_item/${PRD_SKU}`));
    assert.equal(state.live, false);
    assert.equal(state.item, false);
    assert.deepEqual(s.stored, []);
  });

  it("a 5xx after publish stops the run, and the cleanup still withdraws and deletes", async () => {
    const { routes, state } = prodRoutes({ "POST /sell/inventory/v1/bulk_update_price_quantity": () => ({ status: 503 }) });
    const { api: a } = api("production", routes);
    const out = await runProdCapture({ api: a, sink: sink(), sku: PRD_SKU, picture: PICTURE, report: () => {} });
    assert.equal(out.ok, false);
    assert.equal(out.cleanedUp, true);
    assert.equal(state.live, false);
    assert.equal(state.item, false);
  });

  it("a failure before publish deletes the item without a withdraw", async () => {
    const { routes, state } = prodRoutes({ "POST /sell/inventory/v1/bulk_create_offer": () => ({ status: 400, body: { responses: [{ statusCode: 400, errors: [{ errorId: 25709 }] }] } }) });
    const { api: a, stub } = api("production", routes);
    const out = await runProdCapture({ api: a, sink: sink(), sku: PRD_SKU, picture: PICTURE, report: () => {} });
    assert.equal(out.cleanedUp, true);
    assert.equal(state.item, false);
    assert.ok(!writesOf(stub.calls).some((c) => c.path.endsWith("/withdraw")));
  });

  it("the cleanup tries at most three times, with one re-grant on a 401", async () => {
    let tries = 0;
    const { routes, state } = prodRoutes({
      "POST /sell/inventory/v1/bulk_update_price_quantity": () => ({ status: 400, body: {} }),
      "POST /sell/inventory/v1/offer/777/withdraw": (_ctx, st) => {
        tries += 1;
        if (tries === 1) return { status: 401, body: { errors: [{ errorId: 1001 }] } };
        if (tries === 2) return { status: 500 };
        st.live = false;
        return { status: 200, body: { listingId: "110000000001" } };
      },
    });
    const { api: a, stub } = api("production", routes);
    const out = await runProdCapture({ api: a, sink: sink(), sku: PRD_SKU, picture: PICTURE, report: () => {} });
    assert.equal(tries, 3);
    assert.equal(stub.calls.filter((c) => c.path === "/identity/v1/oauth2/token").length, 2, "the run's grant plus one re-grant");
    assert.equal(out.cleanedUp, true);
    assert.equal(state.live, false);
  });

  it("a withdraw that keeps failing is covered by the item delete, which ends the listing too", async () => {
    const { routes, state } = prodRoutes({
      "POST /sell/inventory/v1/bulk_update_price_quantity": () => ({ status: 400, body: {} }),
      "POST /sell/inventory/v1/offer/777/withdraw": () => ({ status: 500 }),
    });
    const { api: a } = api("production", routes);
    const out = await runProdCapture({ api: a, sink: sink(), sku: PRD_SKU, picture: PICTURE, report: () => {} });
    assert.equal(out.stage, "write");
    assert.equal(out.cleanedUp, true);
    assert.equal(state.item, false);
    assert.equal(state.offer, false);
  });

  it("a cleanup that cannot finish exits with the listing id, the undo command and Seller Hub", async () => {
    const { routes } = prodRoutes({
      "POST /sell/inventory/v1/bulk_update_price_quantity": () => ({ status: 400, body: {} }),
      "POST /sell/inventory/v1/offer/777/withdraw": () => ({ status: 500 }),
      // eBay's item delete also ends the item's offers and listing, so the
      // cleanup only fails to finish when both of its calls fail.
      [`DELETE /sell/inventory/v1/inventory_item/${PRD_SKU}`]: () => ({ status: 500 }),
    });
    const { api: a, stub } = api("production", routes);
    const out = await runProdCapture({ api: a, sink: sink(), sku: PRD_SKU, picture: PICTURE, report: () => {} });
    assert.equal(out.ok, false);
    assert.equal(out.stage, "cleanup");
    assert.equal(stub.calls.filter((c) => c.method === "DELETE").length, 3);
    assert.equal(out.cleanedUp, false);
    assert.equal(stub.calls.filter((c) => c.path.endsWith("/withdraw")).length, 3);
    const text = prodFailureLines(out, PRD_SKU).join("\n");
    assert.match(text, /110000000001/);
    assert.match(text, new RegExp(`ebay-undo --prod --sku ${PRD_SKU} --yes`));
    assert.match(text, /Seller Hub/);
  });
});

// ── Sandbox capture and undo ──────────────────────────────────────────────

function sandboxRoutes(over = {}) {
  const deleted = [];
  const routes = {
    "GET /commerce/identity/v1/user/": () => ({ status: 200, body: { userId: "u1", username: "sbx" } }),
    "GET /sell/account/v1/program/get_opted_in_programs": () => ({ status: 200, body: { programs: [{ programType: "SELLING_POLICY_MANAGEMENT" }] } }),
    "POST /sell/account/v1/program/opt_in": () => ({ status: 409, body: { errors: [{ errorId: 20409 }] } }),
    "GET /sell/account/v1/payment_policy": () => ({ status: 200, body: { total: 0, paymentPolicies: [] } }),
    "GET /sell/account/v1/return_policy": () => ({ status: 200, body: { total: 0, returnPolicies: [] } }),
    "GET /sell/account/v1/fulfillment_policy": () => ({ status: 200, body: { total: 1, fulfillmentPolicies: [{ fulfillmentPolicyId: "33", name: "f" }] } }),
    "POST /sell/account/v1/payment_policy": () => ({ status: 201, body: { paymentPolicyId: "41", name: "NBCAPTURE-SBX-20261116-pay" } }),
    "POST /sell/account/v1/return_policy": () => ({ status: 201, body: { returnPolicyId: "42", name: "NBCAPTURE-SBX-20261116-ret" } }),
    "POST /sell/inventory/v1/location/nbcapture-sbx-20261116": () => ({ status: 204 }),
    "POST /sell/inventory/v1/location/nbcapture-sbx-20261116/update_location_details": () => ({ status: 204 }),
    "POST /sell/inventory/v1/location/nbcapture-sbx-20261116/enable": () => ({ status: 200, body: {} }),
    "GET /sell/inventory/v1/location/nbcapture-sbx-20261116": () => ({ status: 200, body: { merchantLocationKey: "nbcapture-sbx-20261116", merchantLocationStatus: "ENABLED" } }),
    "POST /sell/inventory/v1/bulk_create_or_replace_inventory_item": () => ({ status: 200, body: { responses: [{ statusCode: 200, sku: SBX_SKU }] } }),
    "POST /sell/inventory/v1/bulk_create_offer": () => ({ status: 200, body: { responses: [{ statusCode: 201, sku: SBX_SKU, offerId: "9" }] } }),
    "PUT /sell/inventory/v1/offer/9": () => ({ status: 204 }),
    "GET /sell/inventory/v1/offer": () => ({ status: 200, body: { offers: [{ offerId: "9", sku: SBX_SKU, status: "UNPUBLISHED" }] } }),
    "POST /sell/inventory/v1/offer/9/publish": () => ({ status: 400, body: { errors: [{ errorId: 25007 }] } }),
    "GET /sell/fulfillment/v1/order": () => ({ status: 200, body: { total: 0, orders: [] } }),
    "GET /sell/inventory/v1/inventory_item": () => ({ status: 200, body: { total: 0, inventoryItems: [] } }),
    [`DELETE /sell/inventory/v1/inventory_item/${SBX_SKU}`]: () => (deleted.push("item"), { status: 204 }),
    "DELETE /sell/account/v1/payment_policy/41": () => (deleted.push("pay"), { status: 204 }),
    "DELETE /sell/account/v1/return_policy/42": () => (deleted.push("ret"), { status: 204 }),
    "DELETE /sell/inventory/v1/location/nbcapture-sbx-20261116": () => (deleted.push("loc"), { status: 204 }),
    ...over,
  };
  return { routes, deleted };
}

describe("ebay-capture (sandbox)", () => {
  it("captures reads and the writes the sandbox accepts, files the publish refusal as #refused, and removes everything", async () => {
    const { routes, deleted } = sandboxRoutes();
    const { api: a, stub } = api("sandbox", routes);
    const s = sink();
    const out = await runSandboxCapture({ api: a, sink: s, now: NOW, publicKeyId: null, report: () => {} });
    assert.equal(out.ok, true, JSON.stringify(out));
    assert.deepEqual(deleted.sort(), ["item", "loc", "pay", "ret"]);
    const names = s.stored.map((c) => c.endpoint);
    for (const n of [
      "POST ebay/api/identity/v1/oauth2/token #refresh_token",
      "POST ebay/api/identity/v1/oauth2/token #client_credentials",
      "POST ebay/api/sell/account/v1/program/opt_in #409",
      "POST ebay/api/sell/inventory/v1/offer/:offerId/publish #refused",
      "PUT ebay/api/sell/inventory/v1/offer/:offerId",
      "DELETE ebay/api/sell/inventory/v1/inventory_item/:sku",
      "GET ebay/api/sell/fulfillment/v1/order",
    ]) {
      assert.ok(names.includes(n), n);
    }
    assert.ok(stub.calls.every((c) => c.host.includes("sandbox")));
    assert.ok(!JSON.stringify(s.stored).includes("ACCESS"), "a token value never reaches the fake");
    assert.equal(stub.calls.find((c) => c.path === "/sell/fulfillment/v1/order").query.limit, "1");
  });

  it("stops on the first 401, still removes what it made, and stores nothing", async () => {
    const { routes, deleted } = sandboxRoutes({ "GET /sell/inventory/v1/location/nbcapture-sbx-20261116": () => ({ status: 401, body: { errors: [{ errorId: 1001 }] } }) });
    const { api: a } = api("sandbox", routes);
    const s = sink();
    const out = await runSandboxCapture({ api: a, sink: s, now: NOW, publicKeyId: null, report: () => {} });
    assert.equal(out.ok, false);
    assert.match(out.reason, /unauthorized/);
    assert.deepEqual(s.stored, []);
    assert.deepEqual(deleted.sort(), ["loc", "pay", "ret"]);
  });
});

// ── The required captures are what the recorder stores (NEO-555 PR B1) ─────

describe("the required eBay captures are exactly what the recorder stores", () => {
  const isWrite = (name) => !name.startsWith("GET ") && !name.includes("/oauth2/token");
  const sandboxStored = async (over = {}) => {
    const { routes } = sandboxRoutes(over);
    const { api: a } = api("sandbox", routes);
    const s = sink();
    const out = await runSandboxCapture({ api: a, sink: s, now: NOW, publicKeyId: null, report: () => {} });
    assert.equal(out.ok, true, JSON.stringify(out));
    return s.stored.map((c) => c.endpoint);
  };
  const prodStored = async () => {
    const { routes } = prodRoutes();
    const { api: a } = api("production", routes);
    const s = sink();
    const out = await runProdCapture({ api: a, sink: s, sku: PRD_SKU, picture: PICTURE, report: () => {} });
    assert.equal(out.ok, true, JSON.stringify(out));
    return s.stored.map((c) => c.endpoint);
  };

  it("every required name is stored by the sandbox run or the production run, and is a capture name the fake accepts", async () => {
    const stored = new Set([...(await sandboxStored()), ...(await prodStored())]);
    for (const name of EBAY_REQUIRED_CAPTURES) {
      assert.ok(stored.has(name), `${name}: no recorder run stores it (renamed or dropped?)`);
      assert.ok(EBAY_CAPTURE_ENDPOINTS.includes(name), `${name} is not an accepted capture name`);
    }
    // The two the plan names: the sandbox's refusal and the production publish.
    assert.ok(EBAY_REQUIRED_CAPTURES.includes("POST ebay/api/sell/inventory/v1/offer/:offerId/publish #refused"));
    assert.ok(EBAY_REQUIRED_CAPTURES.includes("POST ebay/api/sell/inventory/v1/offer/:offerId/publish"));
  });

  it("every write the recorder stores is classified: required, or known to be stored only when eBay accepts it", async () => {
    const stored = new Set([
      ...(await sandboxStored()), // opt-in answers 409
      ...(await sandboxStored({ "POST /sell/account/v1/program/opt_in": () => ({ status: 200, body: {} }) })),
      ...(await prodStored()),
    ]);
    const known = new Set([...EBAY_REQUIRED_CAPTURES, ...EBAY_CONDITIONAL_WRITE_CAPTURES]);
    for (const name of [...stored].filter(isWrite)) assert.ok(known.has(name), `${name} is stored by the recorder but neither required nor listed as conditional`);
    for (const name of EBAY_CONDITIONAL_WRITE_CAPTURES) assert.ok(stored.has(name), `${name} is listed as conditional but no run stores it any more`);
    for (const name of EBAY_CONDITIONAL_WRITE_CAPTURES) assert.ok(!EBAY_REQUIRED_CAPTURES.includes(name), `${name} is both`);
  });

  it("a sandbox that refuses the policy creates still stores every sandbox-side required capture", async () => {
    const refuse = () => ({ status: 400, body: { errors: [{ errorId: 20400 }] } });
    const stored = await sandboxStored({
      // Policies exist already, so the creates are refused and the run carries on with those.
      "GET /sell/account/v1/payment_policy": () => ({ status: 200, body: { total: 1, paymentPolicies: [{ paymentPolicyId: "11" }] } }),
      "GET /sell/account/v1/return_policy": () => ({ status: 200, body: { total: 1, returnPolicies: [{ returnPolicyId: "22" }] } }),
      "POST /sell/account/v1/payment_policy": refuse,
      "POST /sell/account/v1/return_policy": refuse,
    });
    for (const op of ["createPaymentPolicy", "createReturnPolicy"]) assert.ok(!stored.includes(endpointName(op)), `${op} stored although eBay refused it`);
    const prodOnly = new Set([
      "POST ebay/apim/commerce/media/v1_beta/image/create_image_from_file",
      "GET ebay/apim/commerce/media/v1_beta/image/:imageId",
      "POST ebay/api/sell/inventory/v1/bulk_update_price_quantity",
      "POST ebay/api/sell/inventory/v1/offer/:offerId/withdraw",
      "POST ebay/api/sell/inventory/v1/offer/:offerId/publish",
    ]);
    const sandboxSide = EBAY_REQUIRED_CAPTURES.filter((n) => !prodOnly.has(n));
    assert.equal(sandboxSide.length, EBAY_REQUIRED_CAPTURES.length - prodOnly.size, "every production-only name is on the list");
    for (const name of sandboxSide) assert.ok(stored.includes(name), `${name} missing from a sandbox run whose creates were refused`);
  });
});

describe("ebay-undo", () => {
  it("refuses a SKU outside the environment's capture prefix", async () => {
    const { api: prod } = api("production", {});
    await assert.rejects(() => runEbayUndo(prod, SBX_SKU), /refusing SKU/);
    await assert.rejects(() => runEbayUndo(prod, "NB2-realcard-NM"), /refusing SKU/);
    const { api: sbx } = api("sandbox", {});
    await assert.rejects(() => runEbayUndo(sbx, PRD_SKU), /refusing SKU/);
    await assert.rejects(() => ebayUndo(parseArgs(["ebay-undo", "--prod", "--sku", "NB2-x-NM"]).flags), /refusing SKU/);
    await assert.rejects(() => ebayUndo(parseArgs(["ebay-undo", "--sku", PRD_SKU]).flags), /exactly one of/);
  });

  it("withdraws the live offer, deletes the item, and verifies", async () => {
    const { routes, state } = prodRoutes();
    state.item = true;
    state.offer = true;
    state.live = true;
    const { api: a } = api("production", routes);
    const out = await runEbayUndo(a, PRD_SKU);
    assert.equal(out.ok, true, out.lines.join("\n"));
    assert.equal(state.live, false);
    assert.equal(state.item, false);
  });
});

// ── Adversarial pass (NEO-555 PR A): the production capture ────────────────

describe("ebay-capture --prod (adversarial): the SKU gate", () => {
  const bypasses = [
    ["lower case", "nbcapture-prd-20261116"],
    ["leading space", ` ${PRD_SKU}`],
    ["trailing space", `${PRD_SKU} `],
    ["trailing newline", `${PRD_SKU}\n`],
    ["trailing NUL", `${PRD_SKU}\u0000`],
    ["no-break space", `${PRD_SKU} `],
    ["zero-width space inside", "NBCAPTURE-​PRD-20261116"],
    ["full-width digits", "NBCAPTURE-PRD-２０２６１１１６"],
    ["Arabic-Indic digits", "NBCAPTURE-PRD-٢٠٢٦١١١٦"],
    ["Cyrillic B", "NВCAPTURE-PRD-20261116"],
    ["seven digits", "NBCAPTURE-PRD-2026111"],
    ["nine digits", "NBCAPTURE-PRD-202611161"],
    ["suffix", `${PRD_SKU}-x`],
    ["prefix", `x${PRD_SKU}`],
    ["a path", `${PRD_SKU}/../NB2-realcard-NM`],
    ["a query", `${PRD_SKU}?x=1`],
    ["the sandbox form", SBX_SKU],
    ["an NB listing SKU", "NB2-realcard-NM"],
    ["empty", ""],
  ];

  it("refuses every look-alike in the prod capture and the prod undo, and sends nothing", async () => {
    for (const [what, sku] of bypasses) {
      const { routes } = prodRoutes();
      const { api: a, stub } = api("production", routes);
      await assert.rejects(() => runProdCapture({ api: a, sink: null, sku, picture: PICTURE, report: () => {} }), /refusing SKU/, what);
      await assert.rejects(() => runEbayUndo(a, sku), /refusing SKU/, what);
      assert.throws(() => checkCaptureSku("production", sku), /refusing SKU/, what);
      assert.equal(stub.calls.length, 0, `${what}: a request was sent`);
    }
  });

  it("the sandbox form is refused on production and the production form on the sandbox", () => {
    assert.throws(() => checkCaptureSku("production", SBX_SKU), /refusing SKU/);
    assert.throws(() => checkCaptureSku("sandbox", PRD_SKU), /refusing SKU/);
    assert.doesNotThrow(() => checkCaptureSku("production", PRD_SKU));
    assert.doesNotThrow(() => checkCaptureSku("sandbox", SBX_SKU));
  });

  it("the CLI refuses a --sku that is not today's, even a well-formed capture SKU from another day", async () => {
    await assert.rejects(() => ebayCapture(parseArgs(["ebay-capture", "--prod", "--sku", "NBCAPTURE-PRD-20250101", "--yes"]).flags, () => NOW), /refusing SKU/);
  });
});

describe("ebay-capture --prod (adversarial): at most one listing, always cleaned up", () => {
  const publishesOf = (calls) => calls.filter((c) => c.method === "POST" && c.path.endsWith("/publish"));

  it("the happy path sends exactly one publish and one bulk_create_offer", async () => {
    const { routes } = prodRoutes();
    const { api: a, stub } = api("production", routes);
    const out = await runProdCapture({ api: a, sink: sink(), sku: PRD_SKU, picture: PICTURE, report: () => {} });
    assert.equal(out.ok, true);
    assert.equal(publishesOf(stub.calls).length, 1);
    assert.equal(stub.calls.filter((c) => c.path.endsWith("/bulk_create_offer")).length, 1);
  });

  it("a publish that answers 200 with no listingId still gets the offer withdrawn and the item deleted", async () => {
    const { routes, state } = prodRoutes({
      "POST /sell/inventory/v1/offer/777/publish": (_c, st) => ((st.live = true), { status: 200, body: { warnings: [] } }),
    });
    const { api: a, stub } = api("production", routes);
    const s = sink();
    const out = await runProdCapture({ api: a, sink: s, sku: PRD_SKU, picture: PICTURE, report: () => {} });
    assert.equal(out.ok, false);
    assert.equal(out.stage, "write");
    assert.equal(out.cleanedUp, true);
    assert.equal(state.live, false, "the listing is still live");
    assert.equal(state.item, false);
    assert.equal(publishesOf(stub.calls).length, 1);
    assert.deepEqual(s.stored, []);
  });

  it("a publish with an empty body (2xx) is the same", async () => {
    const { routes, state } = prodRoutes({ "POST /sell/inventory/v1/offer/777/publish": (_c, st) => ((st.live = true), { status: 200 }) });
    const { api: a } = api("production", routes);
    const out = await runProdCapture({ api: a, sink: sink(), sku: PRD_SKU, picture: PICTURE, report: () => {} });
    assert.equal(out.cleanedUp, true);
    assert.equal(state.live, false);
  });

  it("a timeout AFTER eBay published (the answer never arrives) still ends the listing", async () => {
    const { routes, state } = prodRoutes({
      "POST /sell/inventory/v1/offer/777/publish": (_c, st) => ((st.live = true), Object.assign(new Error("timed out"), { name: "TimeoutError" })),
    });
    const { api: a, stub } = api("production", routes);
    const out = await runProdCapture({ api: a, sink: sink(), sku: PRD_SKU, picture: PICTURE, report: () => {} });
    assert.equal(out.ok, false);
    assert.equal(out.cleanedUp, true);
    assert.equal(state.live, false, "the listing is still live");
    assert.equal(state.item, false);
    assert.equal(publishesOf(stub.calls).length, 1, "the publish was not retried");
  });

  it("a network drop on the publish answer is the same", async () => {
    const { routes, state } = prodRoutes({ "POST /sell/inventory/v1/offer/777/publish": (_c, st) => ((st.live = true), new TypeError("fetch failed")) });
    const { api: a } = api("production", routes);
    const out = await runProdCapture({ api: a, sink: sink(), sku: PRD_SKU, picture: PICTURE, report: () => {} });
    assert.equal(out.cleanedUp, true);
    assert.equal(state.live, false);
  });

  it("a 401 on the main-path withdraw is recovered by the cleanup's one re-grant", async () => {
    const { routes, state } = prodRoutes({
      "POST /sell/inventory/v1/offer/777/withdraw": (ctx, st) => {
        const grants = ctx.calls.filter((c) => c.path === "/identity/v1/oauth2/token").length;
        if (grants < 2) return { status: 401, body: { errors: [{ errorId: 1001 }] } };
        st.live = false;
        return { status: 200, body: { listingId: "110000000001" } };
      },
    });
    const { api: a, stub } = api("production", routes);
    const out = await runProdCapture({ api: a, sink: sink(), sku: PRD_SKU, picture: PICTURE, report: () => {} });
    assert.equal(out.ok, false);
    assert.equal(out.stage, "write");
    assert.equal(out.cleanedUp, true);
    assert.equal(state.live, false);
    assert.equal(state.item, false);
    assert.equal(stub.calls.filter((c) => c.path === "/identity/v1/oauth2/token").length, 2);
    assert.equal(publishesOf(stub.calls).length, 1);
  });

  it("a 401 on the withdraw with a re-grant eBay refuses ends in an unverified cleanup carrying the listing id", async () => {
    let grants = 0;
    const { routes } = prodRoutes({
      "POST /identity/v1/oauth2/token": () => (++grants === 1 ? tokenOk() : { status: 400, body: { error: "invalid_grant" } }),
      "POST /sell/inventory/v1/offer/777/withdraw": () => ({ status: 401, body: { errors: [{ errorId: 1001 }] } }),
      [`DELETE /sell/inventory/v1/inventory_item/${PRD_SKU}`]: () => ({ status: 401, body: { errors: [{ errorId: 1001 }] } }),
    });
    const { api: a } = api("production", routes);
    const out = await runProdCapture({ api: a, sink: sink(), sku: PRD_SKU, picture: PICTURE, report: () => {} });
    assert.equal(out.ok, false);
    assert.equal(out.cleanedUp, false);
    assert.equal(out.listingId, "110000000001");
    assert.match(prodFailureLines(out, PRD_SKU).join("\n"), /COULD NOT BE VERIFIED/);
  });

  it("a report callback that throws (a closed stdout) cannot skip the cleanup", async () => {
    const { routes, state } = prodRoutes({ "POST /sell/inventory/v1/bulk_update_price_quantity": () => ({ status: 400, body: {} }) });
    const { api: a } = api("production", routes);
    const out = await runProdCapture({
      api: a,
      sink: sink(),
      sku: PRD_SKU,
      picture: PICTURE,
      report: () => {
        throw new Error("EPIPE");
      },
    });
    assert.equal(out.ok, false);
    assert.equal(out.cleanedUp, true);
    assert.equal(state.live, false);
    assert.equal(state.item, false);
  });

  it("a stop signal during the run is held off until the cleanup is done, and the handlers are removed after", async () => {
    const signals = ["SIGINT", "SIGTERM", "SIGHUP"];
    const before = signals.map((s) => process.listenerCount(s));
    let during = null;
    const lines = [];
    const { routes } = prodRoutes({
      "POST /sell/inventory/v1/bulk_update_price_quantity": () => {
        during = signals.map((s) => process.listenerCount(s));
        process.emit("SIGINT");
        return { status: 200, body: { responses: [{ statusCode: 200 }] } };
      },
    });
    const { api: a } = api("production", routes);
    const out = await runProdCapture({ api: a, sink: sink(), sku: PRD_SKU, picture: PICTURE, report: (l) => lines.push(l) });
    assert.equal(out.ok, true);
    assert.deepEqual(during, before.map((n) => n + 1));
    assert.ok(lines.some((l) => /interrupt ignored/.test(l)));
    assert.deepEqual(signals.map((s) => process.listenerCount(s)), before);
  });

  it("the handlers are removed even when the run throws", async () => {
    const before = process.listenerCount("SIGINT");
    const { routes } = prodRoutes({ "GET /sell/inventory/v1/location/neonbinder-main": () => ({ status: 401, body: {} }) });
    const { api: a } = api("production", routes);
    await assert.rejects(() => runProdCapture({ api: a, sink: null, sku: PRD_SKU, picture: PICTURE, report: () => {} }));
    assert.equal(process.listenerCount("SIGINT"), before);
  });
});

describe("ebay-capture --prod (adversarial): nothing secret in reports or errors", () => {
  const SECRETS = [REFRESH, CERT, "ACCESS", Buffer.from(`NB-app-id:${CERT}`).toString("base64")];
  const leaky = () =>
    Object.assign(new TypeError(`fetch failed: Bearer v^1.1#ACCESS ${REFRESH} ${CERT}`), {
      cause: Object.assign(new Error(`${REFRESH} ${CERT}`), { request: { headers: { authorization: "Bearer v^1.1#ACCESS" } } }),
    });
  const body = (t) => `${t.map(String).join("\n")}`;

  async function runAndCollect(routes, over = {}) {
    const { api: a } = api("production", routes, over);
    const lines = [];
    let out;
    let thrown = null;
    try {
      out = await runProdCapture({ api: a, sink: sink(), sku: PRD_SKU, picture: PICTURE, report: (l) => lines.push(l) });
    } catch (err) {
      thrown = err;
    }
    const failure = out && !out.ok ? prodFailureLines(out, PRD_SKU) : [];
    const text = [...lines, ...failure, thrown ? `${thrown.name}: ${thrown.message}` : "", JSON.stringify(out ?? {})].join("\n");
    a.forget();
    return text;
  }

  it("a fetch error whose message and cause carry the token, cert and refresh token is reduced to a class", async () => {
    for (const path of ["bulk_create_offer", "offer/777/publish", "offer/777/withdraw", "bulk_update_price_quantity"]) {
      const { routes } = prodRoutes({ [`POST /sell/inventory/v1/${path}`]: (_c, st) => ((st.live = path.includes("publish") ? true : st.live), leaky()) });
      const text = await runAndCollect(routes);
      for (const v of SECRETS) assert.ok(!text.includes(v), `${path}: leaked ${v.slice(0, 8)}`);
      assert.match(text, /network/);
    }
  });

  it("a response body that fails mid-read (its error names the secrets) is a stop, not a raw error", async () => {
    const { routes } = prodRoutes();
    const stub = stubEbay({ "POST /identity/v1/oauth2/token": tokenOk, ...routes });
    const fetchImpl = async (url, init) => {
      if (new URL(url).pathname.endsWith("/publish")) {
        return { status: 200, headers: new Headers(), arrayBuffer: async () => Promise.reject(new Error(`terminated ${REFRESH} ${CERT} Bearer v^1.1#ACCESS`)) };
      }
      return stub.fetchImpl(url, init);
    };
    const text = await runAndCollect(routes, { fetchImpl });
    for (const v of SECRETS) assert.ok(!text.includes(v), `leaked ${v.slice(0, 8)}`);
    assert.match(text, /network/);
  });

  it("a refused token grant names a status and nothing else", async () => {
    const { routes } = prodRoutes({ "POST /identity/v1/oauth2/token": () => ({ status: 400, body: { error: "invalid_grant", error_description: `bad ${REFRESH}` } }) });
    const { api: a } = api("production", routes);
    let msg = "";
    try {
      await runProdCapture({ api: a, sink: null, sku: PRD_SKU, picture: PICTURE, report: () => {} });
    } catch (err) {
      msg = String(err.message);
    }
    assert.match(msg, /token_refused/);
    for (const v of SECRETS) assert.ok(!msg.includes(v));
    void body;
  });

  it("the production credential reader never quotes a value, even when the stored session is malformed", async () => {
    const reads = [CERT, `{"refreshToken": "${REFRESH}" broken`];
    let i = 0;
    await assert.rejects(
      () => readProductionCreds({ clientId: "NB-app-id", certSecret: "cert-secret", sessionSecret: "session-secret", project: "some-project-1", read: async () => reads[i++] }),
      (err) => !SECRETS.some((v) => String(err.message).includes(v)) && /not JSON/.test(err.message),
    );
    for (const bad of ['{"refreshToken": "has space"}', '{"refreshToken": 7}', '{"refreshToken": ""}', "[]", "null"]) {
      let n = 0;
      await assert.rejects(
        () => readProductionCreds({ clientId: "NB-app-id", certSecret: "cert-secret", sessionSecret: "session-secret", project: "some-project-1", read: async () => (n++ === 0 ? CERT : bad) }),
        (err) => !SECRETS.some((v) => String(err.message).includes(v)),
        bad,
      );
    }
  });
});

// ── Audit round (NEO-555): signals, thrown transport errors, confirmation ──

/** Runs `fn` with stderr captured (the CLI's `say`); answers its result and the text. */
async function quietly(fn) {
  const out = [];
  const write = process.stderr.write;
  process.stderr.write = (s) => (out.push(String(s)), true);
  try {
    return { result: await fn(), text: out.join("") };
  } finally {
    process.stderr.write = write;
  }
}

const listenerCounts = () => GUARDED_SIGNALS.map((s) => process.listenerCount(s));

describe("ebay-capture --prod (audit): stop signals", () => {
  it("guards SIGINT, SIGTERM and SIGHUP on every request from the grant through the first write to the last verification read", async () => {
    assert.deepEqual([...GUARDED_SIGNALS], ["SIGINT", "SIGTERM", "SIGHUP"]);
    const before = listenerCounts();
    const { routes } = prodRoutes();
    const stub = stubEbay({ "POST /identity/v1/oauth2/token": tokenOk, ...routes });
    const seen = [];
    const fetchImpl = (url, init = {}) => {
      seen.push({ req: `${init.method ?? "GET"} ${new URL(url).pathname}`, counts: listenerCounts() });
      return stub.fetchImpl(url, init);
    };
    const { api: a } = api("production", {}, { fetchImpl });
    const out = await runProdCapture({ api: a, sink: sink(), sku: PRD_SKU, picture: PICTURE, report: () => {}, exit: () => assert.fail("no exit") });
    assert.equal(out.ok, true);
    const firstWrite = seen.findIndex((x) => x.req === "POST /commerce/media/v1_beta/image/create_image_from_file");
    assert.ok(firstWrite > 0);
    // The run ends with the two verification reads.
    assert.deepEqual(seen.slice(-2).map((x) => x.req), ["GET /sell/inventory/v1/offer", `GET /sell/inventory/v1/inventory_item/${PRD_SKU}`]);
    for (const x of seen) assert.deepEqual(x.counts, before.map((n) => n + 1), x.req);
    assert.deepEqual(listenerCounts(), before);
  });

  it("after a first signal the cleanup and the verification still run, and nothing exits", async () => {
    const before = listenerCounts();
    const exits = [];
    const lines = [];
    let signalledAt = -1;
    const { routes, state } = prodRoutes({
      "POST /sell/inventory/v1/bulk_update_price_quantity": (ctx) => {
        signalledAt = ctx.calls.length;
        process.emit("SIGTERM", "SIGTERM");
        return { status: 400, body: { errors: [{ errorId: 25709 }] } };
      },
    });
    const { api: a, stub } = api("production", routes);
    const out = await runProdCapture({ api: a, sink: sink(), sku: PRD_SKU, picture: PICTURE, report: (l) => lines.push(l), exit: (c) => exits.push(c) });
    assert.equal(out.ok, false);
    assert.equal(out.stage, "write");
    assert.equal(out.cleanedUp, true);
    assert.equal(state.live, false);
    assert.equal(state.item, false);
    assert.deepEqual(exits, []);
    assert.ok(lines.some((l) => /interrupt ignored/.test(l)));
    const after = stub.calls.slice(signalledAt).map((c) => `${c.method} ${c.path}`);
    assert.ok(after.includes("POST /sell/inventory/v1/offer/777/withdraw"), after.join("\n"));
    assert.ok(after.includes(`DELETE /sell/inventory/v1/inventory_item/${PRD_SKU}`));
    assert.deepEqual(after.slice(-2), ["GET /sell/inventory/v1/offer", `GET /sell/inventory/v1/inventory_item/${PRD_SKU}`]);
    assert.deepEqual(listenerCounts(), before);
  });

  it("a second signal prints the undo command and Seller Hub with the listing id, and exits non-zero once", async () => {
    const before = listenerCounts();
    const exits = [];
    const lines = [];
    const { routes } = prodRoutes({
      "POST /sell/inventory/v1/bulk_update_price_quantity": () => {
        process.emit("SIGINT", "SIGINT");
        process.emit("SIGTERM", "SIGTERM");
        process.emit("SIGHUP", "SIGHUP");
        return { status: 200, body: { responses: [{ statusCode: 200 }] } };
      },
    });
    const { api: a } = api("production", routes);
    await runProdCapture({ api: a, sink: sink(), sku: PRD_SKU, picture: PICTURE, report: (l) => lines.push(l), exit: (c) => exits.push(c) });
    assert.deepEqual(exits, [143], "the second signal (SIGTERM) exits 128+15, and only once");
    const text = lines.join("\n");
    assert.match(text, /THE CLEANUP COULD NOT BE VERIFIED\. Listing id: 110000000001\./);
    assert.ok(lines.includes(`  run: node dist/recorder/cli.js ebay-undo --prod --sku ${PRD_SKU} --yes   (same credential flags)`), text);
    assert.ok(lines.includes("  or end it in Seller Hub."), text);
    assert.match(text, /after 5 write\(s\)/);
    assert.match(text, /second SIGTERM/);
    assert.deepEqual(listenerCounts(), before);
  });

  it("a second signal before any write says nothing was written, and still exits non-zero", async () => {
    const exits = [];
    const lines = [];
    const { routes } = prodRoutes({
      "GET /sell/account/v1/payment_policy": () => {
        process.emit("SIGINT", "SIGINT");
        process.emit("SIGINT", "SIGINT");
        return { status: 200, body: { total: 1, paymentPolicies: [{ paymentPolicyId: "11", name: "p" }] } };
      },
    });
    const { api: a } = api("production", routes);
    await runProdCapture({ api: a, sink: sink(), sku: PRD_SKU, picture: PICTURE, report: (l) => lines.push(l), exit: (c) => exits.push(c) });
    assert.deepEqual(exits, [130]);
    assert.ok(lines.some((l) => /^nothing written: stopped by a second SIGINT/.test(l)), lines.join("\n"));
    assert.ok(!lines.some((l) => /ebay-undo/.test(l)));
  });

  it("a second signal still prints when the report throws (a closed terminal), and the exit is still called", async () => {
    const exits = [];
    const { routes } = prodRoutes({
      "POST /sell/inventory/v1/offer/777/publish": (_c, st) => {
        st.live = true;
        process.emit("SIGHUP", "SIGHUP");
        process.emit("SIGHUP", "SIGHUP");
        return { status: 200, body: { listingId: "110000000001" } };
      },
    });
    const { api: a } = api("production", routes);
    const out = await runProdCapture({
      api: a,
      sink: sink(),
      sku: PRD_SKU,
      picture: PICTURE,
      report: () => {
        throw new Error("EIO");
      },
      exit: (c) => exits.push(c),
    });
    assert.deepEqual(exits, [129]);
    assert.equal(out.ok, true, "the stubbed exit returns, so the run itself carries on and cleans up");
  });
});

describe("ebay-capture --prod (audit): cleanup after a thrown transport error", () => {
  it("a network error on bulk_create_offer: not ok, the item deleted, nothing live, nothing stored", async () => {
    const { routes, state } = prodRoutes({ "POST /sell/inventory/v1/bulk_create_offer": () => new TypeError("fetch failed") });
    const { api: a, stub } = api("production", routes);
    const s = sink();
    const out = await runProdCapture({ api: a, sink: s, sku: PRD_SKU, picture: PICTURE, report: () => {} });
    assert.equal(out.ok, false);
    assert.equal(out.stage, "write");
    assert.equal(out.cleanedUp, true);
    assert.match(out.reason, /network/);
    assert.equal(state.item, false);
    assert.equal(state.live, false);
    assert.equal(state.offer, false);
    assert.deepEqual(s.stored, []);
    assert.ok(stub.calls.some((c) => c.method === "DELETE"));
    assert.ok(!stub.calls.some((c) => c.path.endsWith("/publish")));
  });

  it("a timeout after publish (on the price update): not ok, withdrawn and deleted, nothing stored", async () => {
    const { routes, state } = prodRoutes({ "POST /sell/inventory/v1/bulk_update_price_quantity": () => Object.assign(new Error("timed out"), { name: "TimeoutError" }) });
    const { api: a, stub } = api("production", routes);
    const s = sink();
    const out = await runProdCapture({ api: a, sink: s, sku: PRD_SKU, picture: PICTURE, report: () => {} });
    assert.equal(out.ok, false);
    assert.equal(out.cleanedUp, true);
    assert.match(out.reason, /timeout/);
    assert.equal(out.listingId, "110000000001");
    assert.equal(state.live, false);
    assert.equal(state.item, false);
    assert.deepEqual(s.stored, []);
    assert.ok(stub.calls.some((c) => c.path === "/sell/inventory/v1/offer/777/withdraw"));
  });

  it("a thrown error, then a 401 on the item DELETE: one re-grant, the delete goes through, verified", async () => {
    let deletes = 0;
    const { routes, state } = prodRoutes({
      "POST /sell/inventory/v1/bulk_create_offer": () => new TypeError("fetch failed"),
      [`DELETE /sell/inventory/v1/inventory_item/${PRD_SKU}`]: (_c, st) => {
        deletes += 1;
        if (deletes === 1) return { status: 401, body: { errors: [{ errorId: 1001 }] } };
        st.item = false;
        return { status: 204 };
      },
    });
    const { api: a, stub } = api("production", routes);
    const s = sink();
    const out = await runProdCapture({ api: a, sink: s, sku: PRD_SKU, picture: PICTURE, report: () => {} });
    assert.equal(out.ok, false);
    assert.equal(out.cleanedUp, true);
    assert.equal(deletes, 2);
    assert.equal(stub.calls.filter((c) => c.path === "/identity/v1/oauth2/token").length, 2, "the run's grant plus one re-grant");
    assert.equal(state.item, false);
    assert.equal(state.live, false);
    assert.deepEqual(s.stored, []);
  });
});

describe("recorder confirmation", () => {
  const ask = async (fn, typed, ...args) => {
    const input = new PassThrough();
    const output = new PassThrough();
    output.resume();
    const p = fn(input, output, "go? ", ...args);
    if (typed === null) input.end();
    else input.end(typed);
    return p;
  };

  it("askToType is true only for the exact SKU", async () => {
    assert.equal(await ask(askToType, `${PRD_SKU}\n`, PRD_SKU), true);
    assert.equal(await ask(askToType, `  ${PRD_SKU}  \n`, PRD_SKU), true, "surrounding blanks are trimmed");
    assert.equal(await ask(askToType, "NBCAPTURE-PRD-20261115\n", PRD_SKU), false);
    assert.equal(await ask(askToType, `${PRD_SKU.toLowerCase()}\n`, PRD_SKU), false);
    assert.equal(await ask(askToType, "\n", PRD_SKU), false);
    assert.equal(await ask(askToType, null, PRD_SKU), false, "EOF");
    assert.equal(await ask(askToType, "yes\n", PRD_SKU), false);
  });

  it("askYes is true only for the word yes", async () => {
    assert.equal(await ask(askYes, "yes\n"), true);
    assert.equal(await ask(askYes, " YES \n"), true);
    for (const typed of ["y\n", "no\n", "\n", "yes please\n", null]) assert.equal(await ask(askYes, typed), false, JSON.stringify(typed));
  });

  it("with no terminal both questions reject instead of answering", async () => {
    const noTty = () => {
      throw Object.assign(new Error("ENXIO"), { code: "ENXIO" });
    };
    await assert.rejects(() => typeOnTerminal("go? ", PRD_SKU, noTty), /no terminal to confirm on/);
    await assert.rejects(() => askOnTerminal("go? ", noTty), /no terminal to confirm on: .*--yes/);
  });
});

describe("ebay-capture --prod and ebay-undo --prod through the CLI (audit)", () => {
  const prodFlags = (...extra) => parseArgs(["ebay-capture", "--prod", "--yes", ...extra]).flags;

  /** An ebayApi seam that counts builds (a build is the only step that reads credentials). */
  function apiSeam(routes) {
    const built = [];
    const holder = {};
    const make = async (env) => {
      built.push(env);
      const made = api(env, routes);
      holder.stub = made.stub;
      return made.api;
    };
    return { built, holder, make };
  }

  it("a typed SKU that does not match sends nothing: no credentials read, no grant, no write", async () => {
    const { routes } = prodRoutes();
    const seam = apiSeam(routes);
    const asked = [];
    const s = sink();
    const { result, text } = await quietly(() =>
      ebayCapture(prodFlags(), () => NOW, { typeToConfirm: async (q, expected) => (asked.push([q, expected]), false), ebayApi: seam.make, sink: () => s }),
    );
    assert.equal(result, 0);
    assert.match(text, /not confirmed; nothing sent/);
    assert.deepEqual(asked.map((x) => x[1]), [PRD_SKU]);
    assert.match(asked[0][0], new RegExp(`Type ${PRD_SKU}`));
    assert.deepEqual(seam.built, [], "credentials were read");
    assert.equal(seam.holder.stub, undefined, "an eBay client was made");
    assert.deepEqual(s.stored, []);
  });

  it("with no terminal it rejects before reading credentials", async () => {
    const seam = apiSeam(prodRoutes().routes);
    const noTty = () => {
      throw new Error("ENXIO");
    };
    await assert.rejects(
      () => quietly(() => ebayCapture(prodFlags(), () => NOW, { typeToConfirm: (q, e) => typeOnTerminal(q, e, noTty), ebayApi: seam.make, sink: () => sink() })),
      /no terminal to confirm on/,
    );
    assert.deepEqual(seam.built, []);
  });

  it("control: the matching SKU runs the capture end to end through the same seams", async () => {
    const { routes, state } = prodRoutes();
    const seam = apiSeam(routes);
    const s = sink();
    const { result, text } = await quietly(() => ebayCapture(prodFlags(), () => NOW, { typeToConfirm: async (_q, e) => e === PRD_SKU, ebayApi: seam.make, sink: () => s }));
    assert.equal(result, 0, text);
    assert.deepEqual(seam.built, ["production"]);
    assert.equal(writesOf(seam.holder.stub.calls).length, 7);
    assert.equal(state.item, false);
    assert.ok(s.stored.length > 0);
  });

  it("ebay-undo --prod: no --yes is a dry run with no credentials read; --yes withdraws, deletes and verifies", async () => {
    const { routes, state } = prodRoutes();
    state.item = true;
    state.offer = true;
    state.live = true;
    const seam = apiSeam(routes);
    const dry = await quietly(() => ebayUndo(parseArgs(["ebay-undo", "--prod", "--sku", PRD_SKU]).flags, { ebayApi: seam.make }));
    assert.equal(dry.result, 0);
    assert.match(dry.text, /dry run: nothing sent/);
    assert.deepEqual(seam.built, []);
    const run = await quietly(() => ebayUndo(parseArgs(["ebay-undo", "--prod", "--sku", PRD_SKU, "--yes"]).flags, { ebayApi: seam.make }));
    assert.equal(run.result, 0, run.text);
    assert.deepEqual(seam.built, ["production"]);
    assert.match(run.text, /verified: no offer, no item/);
    assert.equal(state.live, false);
    assert.equal(state.item, false);
    assert.ok(seam.holder.stub.calls.every((c) => !c.host.includes("sandbox")));
  });

  it("ebay-undo --prod --yes that cannot verify exits 2 and names Seller Hub", async () => {
    const { routes, state } = prodRoutes({ [`DELETE /sell/inventory/v1/inventory_item/${PRD_SKU}`]: () => ({ status: 400, body: { errors: [{ errorId: 25709 }] } }) });
    state.item = true;
    const seam = apiSeam(routes);
    const run = await quietly(() => ebayUndo(parseArgs(["ebay-undo", "--prod", "--sku", PRD_SKU, "--yes"]).flags, { ebayApi: seam.make }));
    assert.equal(run.result, 2);
    assert.match(run.text, /NOT verified: end it in Seller Hub/);
  });
});

// ── Audit round 2 (NEO-555): closed stdio, signal names, credential file races ──

/**
 * Runs `node <args>` with its stderr a pipe this side closes before the child
 * writes. With `handshake`, the child waits for a line on stdin, sent only
 * after the close. Answers the exit code, the signal and stdout.
 */
function runWithClosedStderr(args, { handshake = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio: ["pipe", "pipe", "pipe"], cwd: path.join(path.dirname(new URL(import.meta.url).pathname), "..") });
    child.stderr.destroy();
    let stdout = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({ code, signal, stdout }));
    if (handshake) child.stdin.end("go\n");
    else child.stdin.end();
  });
}

describe("ebay-capture --prod (audit 2): a closed stderr or a hung-up terminal", () => {
  it("a write to a closed stderr pipe during the run (with a SIGHUP once live) does not end the process: the cleanup and verification still run", async () => {
    const r = await runWithClosedStderr(["tests/fixtures/prod-capture-closed-stderr.mjs"], { handshake: true });
    assert.equal(r.signal, null);
    assert.equal(r.code, 0, `the child died: ${r.stdout}`);
    const out = JSON.parse(r.stdout);
    // The guard was exercised: the child's stderr really failed with EPIPE.
    assert.ok(out.stderrErrors.length > 0 && out.stderrErrors.every((c) => c === "EPIPE"), JSON.stringify(out.stderrErrors));
    assert.ok(out.lines > 0);
    assert.equal(out.ok, true);
    assert.equal(out.live, false, "the listing was ended");
    assert.equal(out.item, false, "the item was deleted");
    const published = out.calls.indexOf("POST /sell/inventory/v1/offer/777/publish");
    assert.ok(published > 0, out.calls.join("\n"));
    const after = out.calls.slice(published + 1);
    assert.ok(after.includes("POST /sell/inventory/v1/offer/777/withdraw"), after.join("\n"));
    assert.ok(after.includes(`DELETE /sell/inventory/v1/inventory_item/${PRD_SKU}`), after.join("\n"));
    assert.deepEqual(after.slice(-2), ["GET /sell/inventory/v1/offer", `GET /sell/inventory/v1/inventory_item/${PRD_SKU}`]);
    // The no-op listeners belong to the run's window and are removed after it.
    assert.equal(out.listenersAfter, out.listenersBefore);
  });

  it("the CLI entry holds stdio errors from its start: a dry run printing to a closed stderr still exits 0", async () => {
    const r = await runWithClosedStderr(["dist/recorder/cli.js", "ebay-capture", "--prod"]);
    assert.equal(r.signal, null);
    assert.equal(r.code, 0);
  });

  it("the guard is attached during the run only, on both stderr and stdout", async () => {
    const counts = () => [process.stderr.listenerCount("error"), process.stdout.listenerCount("error")];
    const before = counts();
    let during = null;
    const { routes } = prodRoutes({
      "POST /sell/inventory/v1/offer/777/publish": (_c, st) => {
        st.live = true;
        during = counts();
        return { status: 200, body: { listingId: "110000000001" } };
      },
    });
    const { api: a } = api("production", routes);
    const out = await runProdCapture({ api: a, sink: sink(), sku: PRD_SKU, picture: PICTURE, report: () => {}, exit: () => assert.fail("no exit") });
    assert.equal(out.ok, true);
    assert.deepEqual(during, before.map((n) => n + 1));
    // Removed one turn of the event loop later, after any queued 'error' event.
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(counts(), before);
  });
});

describe("ebay-capture --prod (audit 2): the signal named in the second-signal message", () => {
  async function secondSignal(emit) {
    const exits = [];
    const lines = [];
    const { routes } = prodRoutes({
      "POST /sell/inventory/v1/offer/777/publish": (_c, st) => {
        st.live = true;
        emit();
        return { status: 200, body: { listingId: "110000000001" } };
      },
    });
    const { api: a } = api("production", routes);
    await runProdCapture({ api: a, sink: sink(), sku: PRD_SKU, picture: PICTURE, report: (l) => lines.push(l), exit: (c) => exits.push(c) });
    return { exits, text: lines.join("\n") };
  }

  for (const [what, arg] of [
    ["no signal name", undefined],
    ["a non-string", 42],
    ["an over-long name", "SIG" + "X".repeat(14)],
  ]) {
    it(`${what} is printed as "stop signal", and exits 130`, async () => {
      const { exits, text } = await secondSignal(() => {
        process.emit("SIGINT", arg);
        process.emit("SIGINT", arg);
      });
      assert.deepEqual(exits, [130]);
      assert.match(text, /stopped by a second stop signal before the cleanup was verified/);
      assert.ok(!text.includes("XXXX") && !/second 42/.test(text), text);
    });
  }

  it("a second SIGHUP (a closed terminal) is named and exits 129", async () => {
    const { exits, text } = await secondSignal(() => {
      process.emit("SIGINT", "SIGINT");
      process.emit("SIGHUP", "SIGHUP");
    });
    assert.deepEqual(exits, [129]);
    assert.match(text, /stopped by a second SIGHUP before the cleanup was verified/);
  });
});

describe("eBay recorder credentials (audit 2): the file changing under the open handle", () => {
  let dir;
  before(async () => (dir = await mkdtemp(path.join(tmpdir(), "nb-ebay-creds2-"))));
  after(() => rm(dir, { recursive: true, force: true }));
  const good = JSON.stringify({ clientId: "NB-app-id", certId: CERT, refreshToken: REFRESH });

  it("a file swapped at the path after the open (the git check would look at another file) is refused", async () => {
    const f = path.join(dir, "swap.json");
    const other = path.join(dir, "other.json");
    await writeFile(f, good, { mode: 0o600 });
    await writeFile(other, good, { mode: 0o600 });
    const swapAfterOpen = async (p, flags) => {
      const fh = await openFile(p, flags);
      await rename(other, p);
      return fh;
    };
    const err = await readCredsFile(f, { open: swapAfterOpen }).catch((e) => e);
    assert.match(err.message, /changed while being read/);
    assert.ok(!err.message.includes(CERT));
    // The same open, with nothing swapped, reads.
    await writeFile(path.join(dir, "still.json"), good, { mode: 0o600 });
    const c = await readCredsFile(path.join(dir, "still.json"), { open: (p, flags) => openFile(p, flags) });
    assert.equal(c.refreshToken, REFRESH);
  });

  it("a file removed after the open is refused", async () => {
    const f = path.join(dir, "gone.json");
    await writeFile(f, good, { mode: 0o600 });
    const removeAfterOpen = async (p, flags) => {
      const fh = await openFile(p, flags);
      await rm(p);
      return fh;
    };
    await assert.rejects(() => readCredsFile(f, { open: removeAfterOpen }), /changed while being read/);
  });

  it("a file that grows past the limit after the fstat (small size reported, more bytes read) is refused", async () => {
    const f = path.join(dir, "grows.json");
    await writeFile(f, good, { mode: 0o600 });
    let read = 0;
    const growing = async (p, flags) => {
      const fh = await openFile(p, flags);
      return {
        stat: () => fh.stat(),
        read: async (buf, offset, length) => {
          buf.fill(0x20, offset, offset + length);
          read += length;
          return { bytesRead: length, buffer: buf };
        },
        close: () => fh.close(),
      };
    };
    await assert.rejects(() => readCredsFile(f, { open: growing }), /larger than a credentials file/);
    assert.equal(read, 16 * 1024 + 1, "reads at most one byte past the limit");
  });
});
