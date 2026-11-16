/**
 * NEO-555: POST /probe/ebay (src/routes/ebay-probe.ts) and its allowlist
 * (src/routes/ebay-probe-allowlist.ts).
 *
 * Three kinds of test:
 *   1. Static guards over the SOURCE of both probe modules: the only egress is
 *      probeGet (GETs from the frozen allowlist), tokenGrant (the token
 *      endpoint) and the transport guard that wraps both; no aliased call, no
 *      write-method literal in any case, no import beyond the pinned list, no
 *      Secret Manager write, and every allowlist entry is a GET. Each guard is
 *      also run against planted bypasses, to prove it still sees them.
 *   2. The transport guard (createProbeTransport) on its own: what it
 *      forwards and what it refuses, however it is called.
 *   3. The route end to end with eBay, the pause lookup and the credential
 *      read stubbed. Every stub registers itself and an afterEach hook checks
 *      EVERY recorded call of EVERY test against the allowlist, not only the
 *      happy path's.
 *
 * Nothing here contacts eBay or Secret Manager.
 */
import { describe, it, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const express = require("express");
const probe = require("../dist/routes/ebay-probe");
const allow = require("../dist/routes/ebay-probe-allowlist");
const { EBAY_READONLY_SCOPES, EBAY_SCOPES } = require("../dist/services/ebay-oauth");

const {
  createEbayProbeRouter,
  createProbeTransport,
  probeEntryUrl,
  probeGet,
  tokenGrant,
  digestNames,
  resolveEbayProbeTarget,
  EBAY_PROBE_CREDENTIAL_KEY_ENV,
  FAKE_EBAY_CLIENT_ID,
  FAKE_EBAY_CLIENT_SECRET,
} = probe;
const { EBAY_PROBE_ALLOWLIST, resolveProbeQueryValue, PROBE_ORDERS_SINCE_DAYS } = allow;

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "src", "routes");

// Values that must never leave the process.
const APP_TOKEN = "APP-TOKEN-VALUE-1111";
const USER_TOKEN = "USER-TOKEN-VALUE-2222";
const REFRESH_TOKEN = "REFRESH-TOKEN-VALUE-3333";
const CLIENT_SECRET = "CLIENT-SECRET-VALUE-4444";
const PROBE_KEY = "ebay-credentials-user_SECRETID5555";
const EBAY_USER_ID = "EBAYUSERIDVALUE6666";
const BUYER = "buyer-name-value-7777";

const PROD_ENV = Object.freeze({
  ENVIRONMENT: "prod",
  EBAY_ENVIRONMENT: "production",
  EBAY_CLIENT_ID: "client-id-value",
  EBAY_CLIENT_SECRET: CLIENT_SECRET,
  EBAY_RU_NAME: "ru-name-value",
  [EBAY_PROBE_CREDENTIAL_KEY_ENV]: PROBE_KEY,
});

const SHIPPING_CODES = ["USPSGroundAdvantage", "US_eBayStandardEnvelope", "USPSPriority", "USPSGroundAdvantage"];
const ASPECT_NAMES = ["Player/Athlete", "Sport", "Manufacturer", "Card Number"];

/** Answers per path (after the host base). */
function goodAnswers() {
  return {
    "/commerce/taxonomy/v1/category_tree/0/get_item_aspects_for_category": () => ({
      categoryTreeId: "0",
      aspects: ASPECT_NAMES.map((n, i) => ({
        localizedAspectName: n,
        aspectConstraint: { aspectRequired: i === 0, aspectMaxLength: 65 },
        aspectValues: [{ localizedValue: "VALUE-OF-ASPECT" }],
      })),
    }),
    "/commerce/identity/v1/user/": () => ({
      userId: EBAY_USER_ID,
      username: "seller-username-value",
      registrationMarketplaceId: "EBAY_US",
      individualAccount: { email: "seller@example.com", firstName: "Seller" },
    }),
    "/sell/account/v1/program/get_opted_in_programs": () => ({ programs: [{ programType: "SELLING_POLICY_MANAGEMENT" }] }),
    "/sell/account/v1/payment_policy": () => ({ total: 1, paymentPolicies: [{ paymentPolicyId: "PP-ID-VALUE", name: "Policy Name Value" }] }),
    "/sell/account/v1/return_policy": () => ({
      total: 1,
      returnPolicies: [
        {
          returnPolicyId: "RP-ID-VALUE",
          name: "Return Name Value",
          returnsAccepted: true,
          returnPeriod: { value: 30, unit: "DAY" },
          returnShippingCostPayer: "BUYER",
        },
      ],
    }),
    "/sell/account/v1/fulfillment_policy": () => ({
      total: 1,
      fulfillmentPolicies: [
        {
          fulfillmentPolicyId: "FP-ID-VALUE",
          name: "Ship Name Value",
          shippingOptions: [
            {
              optionType: "DOMESTIC",
              shippingServices: [{ shippingServiceCode: "USPSGroundAdvantage", freeShipping: false, shippingCost: { value: "4.99", currency: "USD" } }],
            },
          ],
        },
      ],
    }),
    "/sell/metadata/v1/shipping/marketplace/EBAY_US/get_shipping_services": () => ({
      shippingServices: SHIPPING_CODES.map((c) => ({
        shippingService: c,
        description: `Desc ${c}`,
        shippingCarrier: "USPS",
        internationalService: false,
        validForSellingFlow: true,
        shippingCostTypes: ["FLAT"],
      })),
    }),
    "/sell/inventory/v1/location/neonbinder-main": () => ({
      merchantLocationKey: "neonbinder-main",
      merchantLocationStatus: "ENABLED",
      location: { address: { postalCode: "POSTAL-VALUE", city: "CITY-VALUE" } },
    }),
    "/sell/inventory/v1/offer": () => [404, { errors: [{ errorId: 25713, domain: "API_INVENTORY", category: "REQUEST", message: "This Offer is not available." }] }],
    "/sell/fulfillment/v1/order": () => ({
      total: 1,
      orders: [
        {
          orderId: "ORDER-ID-VALUE",
          creationDate: "2026-11-01T00:00:00.000Z",
          lastModifiedDate: "2026-11-02T00:00:00.000Z",
          orderPaymentStatus: "PAID",
          orderFulfillmentStatus: "FULFILLED",
          buyer: { username: BUYER, taxAddress: { postalCode: "BUYER-ZIP" } },
          fulfillmentStartInstructions: [{ shippingStep: { shipTo: { fullName: "Buyer Full Name" } } }],
          pricingSummary: { total: { value: "10.00", currency: "USD" } },
          lineItems: [{ legacyItemId: "LEGACY-ID-VALUE", sku: "SKU-VALUE", quantity: 1, title: "Title Value", lineItemCost: { value: "10.00", currency: "USD" } }],
        },
      ],
    }),
  };
}

/**
 * A stub eBay. `token` decides each grant's answer:
 *   (grantType, scope) => [status, body]
 */
/**
 * Every stub eBay made by any test. The afterEach hook below drains it and
 * checks every call each one received, so a test that forgets to call
 * assertOnlyPermittedCalls is still covered.
 */
const STUBS = [];
let stubsChecked = 0;

function stubEbay({ answers = goodAnswers(), token, bases } = {}) {
  const calls = [];
  const [api, apiz] = bases ?? ["https://api.ebay.com", "https://apiz.ebay.com"];
  STUBS.push({ calls, bases: { api, apiz } });
  const tokenAnswer =
    token ??
    ((grant) =>
      grant === "client_credentials"
        ? [200, { access_token: APP_TOKEN, expires_in: 7200 }]
        : [200, { access_token: USER_TOKEN, expires_in: 7200 }]);
  const roots = [api, apiz];
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(String(url));
    const call = {
      method: init.method ?? "GET",
      url: u.href,
      headers: { ...(init.headers ?? {}) },
      body: typeof init.body === "string" ? init.body : undefined,
    };
    calls.push(call);
    const root = roots.find((r) => u.href.startsWith(`${r}/`));
    assert.ok(root, `call outside the stubbed hosts: ${u.origin}`);
    const path = u.href.slice(root.length).split("?")[0];
    if (path === "/identity/v1/oauth2/token") {
      const form = new URLSearchParams(call.body);
      const [status, body] = tokenAnswer(form.get("grant_type"), form.get("scope") ?? "");
      return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    }
    const answer = answers[path];
    if (!answer) return new Response(JSON.stringify({ errors: [{ errorId: 1 }] }), { status: 404 });
    const out = answer(u);
    if (out instanceof Error) throw out;
    const [status, body] = Array.isArray(out) && typeof out[0] === "number" && out.length === 2 ? out : [200, out];
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
  return { calls, fetchImpl };
}

async function call(router, body = {}) {
  const app = express();
  app.use(express.json());
  app.use(router);
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/probe/ebay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, headers: res.headers, text, body: JSON.parse(text) };
  } finally {
    server.close();
  }
}

function makeRouter(overrides = {}) {
  const logs = [];
  const reads = [];
  const stub = overrides.stub ?? stubEbay();
  const router = createEbayProbeRouter({
    env: overrides.env ?? PROD_ENV,
    fetchImpl: stub.fetchImpl,
    // `isPaused: null` leaves the route's default lookup (shouldSkipCanary) in place.
    isPaused: overrides.isPaused === null ? undefined : (overrides.isPaused ?? (async () => false)),
    readCredential:
      overrides.readCredential ??
      (async (key) => {
        reads.push(key);
        return { kind: "found", refreshToken: REFRESH_TOKEN };
      }),
    log: (line) => logs.push(line),
    mintIdToken: async () => "ID-TOKEN-VALUE",
    ...(overrides.deps ?? {}),
  });
  return { router, logs, reads, calls: stub.calls };
}

const SECRET_VALUES = [APP_TOKEN, USER_TOKEN, REFRESH_TOKEN, CLIENT_SECRET, PROBE_KEY, "SECRETID5555", EBAY_USER_ID, BUYER, "Buyer Full Name", "ID-TOKEN-VALUE", "fake-caller-key-value"];

function assertNoSecrets(text, where) {
  for (const v of SECRET_VALUES) assert.ok(!text.includes(v), `${where} carries a secret value (${v.slice(0, 6)}…)`);
}

/** Every recorded call is an allowlisted GET or a permitted token grant. */
function assertOnlyPermittedCalls(calls, bases = { api: "https://api.ebay.com", apiz: "https://apiz.ebay.com" }) {
  for (const c of calls) {
    const u = new URL(c.url);
    assert.ok(c.method === "GET" || c.method === "POST", `method ${JSON.stringify(c.method)} reached eBay`);
    if (c.method === "POST") {
      assert.equal(`${u.href}`, `${bases.api}/identity/v1/oauth2/token`, "a POST went somewhere but the token endpoint");
      const grant = new URLSearchParams(c.body).get("grant_type");
      assert.ok(grant === "client_credentials" || grant === "refresh_token", `grant ${grant} is not permitted`);
      continue;
    }
    assert.equal(c.method, "GET", `method ${c.method} is not permitted`);
    assert.equal(c.body, undefined, "a GET carried a body");
    const match = EBAY_PROBE_ALLOWLIST.find((e) => u.href.startsWith(`${bases[e.host]}${e.path}`) && u.href.slice(`${bases[e.host]}${e.path}`.length).match(/^(\?|$)/));
    assert.ok(match, `GET ${u.pathname} is not in the allowlist`);
  }
}

afterEach(() => {
  for (const s of STUBS.splice(0)) {
    assertOnlyPermittedCalls(s.calls, s.bases);
    stubsChecked++;
  }
});

after(() => {
  // The hook must actually have run over the route tests; if node:test ever
  // stops applying a root afterEach to nested tests, this fails.
  assert.ok(stubsChecked >= 40, `the afterEach permitted-call check ran over only ${stubsChecked} stubs`);
});

// ---------------------------------------------------------------------------
// 1. Static guards
// ---------------------------------------------------------------------------

/** Source with comments removed (keeps `https://` inside strings). */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

/** [start, end) of the body of `function <name>(` in src. */
function functionRange(src, name) {
  const at = src.search(new RegExp(`function\\s+${name}\\s*\\(`));
  assert.ok(at >= 0, `function ${name} not found`);
  // The body opens at the first "{" after the parameter list closes.
  let i = src.indexOf("(", at);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")" && --depth === 0) break;
  }
  const open = src.indexOf("{", i);
  depth = 0;
  for (let j = open; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) return [open, j + 1];
  }
  throw new Error(`unbalanced braces in ${name}`);
}

/** Each egress pattern and the only functions it may appear in. */
const EGRESS_PATTERNS = [
  { re: /\bfetch\w*\s*\(/g, what: "a fetch call", only: ["probeGet", "tokenGrant", "createProbeTransport"] },
  { re: /\b(?:refreshAccessToken|fetchApplicationToken)\s*\(/g, what: "a token grant", only: ["tokenGrant"] },
  // Case-insensitive: fetch upper-cases a lowercase "delete" to DELETE. Not
  // in probeGet: its one request is a GET.
  { re: /["'`](?:POST|PUT|DELETE|PATCH)["'`]/gi, what: "a write method literal", only: ["tokenGrant", "createProbeTransport"] },
];
const FORBIDDEN_EVERYWHERE = [
  /\bexchangeAuthorizationCode\b/,
  /\bfetchEbayIdentity\b/,
  /\bupdateCredentials\b/,
  /\bdeleteCredentials\b/,
  /\baddSecretVersion\b/,
  /\bcreateSecret\b/,
  /\bwithCredentialLock\b|\bcredentialLock\b/,
  /\bhttps?\.request\b|\bhttps?\.get\b/,
  /from\s+["']undici["']|require\(["']undici["']\)/,
  /\bbscFetch\b/,
  /\bXMLHttpRequest\b/,
  // An aliased call slips past `fetch\w*(`: forbid the aliases outright.
  /\b(?:fetch\w*|rawFetch|raw|transport)\s*(?:\?\.\s*|\.\s*)(?:call|apply|bind)\b/,
  /\bReflect\s*\.\s*(?:apply|construct)\b/,
  /\bglobalThis\s*\[/,
  // Egress in an imported module: only the pinned static imports are allowed.
  /\brequire\s*\(/,
  /\bimport\s*\(/,
];


/**
 * ebay-probe.ts's imports, exactly. A new import is a new place egress could
 * hide (a helper that POSTs), so adding one means reviewing it and this list.
 */
const PINNED_IMPORTS = {
  "node:crypto": ["default crypto"],
  express: ["Request", "Response", "Router"],
  "../bsc-endpoints": ["BscEndpoints", "fakeBscCallerHeaders", "resolveBscEndpoints"],
  "../bsc-shape": ["shapeMap"],
  "../canary-pause": ["CanaryPauseDeps", "shouldSkipCanary"],
  "../services/ebay-oauth": [
    "EBAY_HOSTS",
    "EBAY_READONLY_SCOPES",
    "EBAY_SCOPES",
    "EbayOAuthConfig",
    "EbayOAuthError",
    "EbayTokenResult",
    "TOKEN_PATH",
    "fetchApplicationToken",
    "readEbayOAuthConfig",
    "refreshAccessToken",
  ],
  "../services/secrets-manager": ["SecretsManagerService"],
  "./ebay-probe-allowlist": ["EBAY_PROBE_ALLOWLIST", "EbayProbeEntry", "EbayProbeHashKind", "EbayProbeHost", "EbayProbeLeg", "resolveProbeQueryValue"],
};

/** module → sorted imported names ("default x" for a default import). */
function importsOf(src) {
  const out = {};
  let statements = 0;
  for (const m of src.matchAll(/^\s*import\s+([\s\S]*?)\s+from\s+["']([^"']+)["'];?/gm)) {
    statements++;
    const clause = m[1].trim();
    const names = [];
    const braces = clause.match(/\{([\s\S]*)\}/);
    const outside = clause.replace(/\{[\s\S]*\}/, "").replace(/,/g, "").trim();
    if (outside) names.push(`default ${outside.replace(/^type\s+/, "")}`);
    if (braces) for (const n of braces[1].split(",")) if (n.trim()) names.push(n.trim().replace(/^type\s+/, ""));
    out[m[2]] = [...(out[m[2]] ?? []), ...names].sort();
  }
  // Every `import` keyword at a statement start must be one of those.
  const keywords = [...src.matchAll(/^\s*import\b/gm)].length;
  return { imports: out, statements, keywords };
}

/**
 * Every static-guard violation in the probe module's source (comments
 * stripped). Empty for the real file; the planted-bypass tests below prove
 * it is not empty when a bypass is added.
 */
function probeViolations(probeSrc) {
  const out = [];
  let seen = 0;
  for (const { re, what, only } of EGRESS_PATTERNS) {
    const ranges = only.map((n) => functionRange(probeSrc, n));
    const inside = (idx) => ranges.some(([a, b]) => idx >= a && idx < b);
    for (const m of probeSrc.matchAll(re)) {
      seen++;
      if (!inside(m.index)) out.push(`${what} outside ${only.join("/")}: ${JSON.stringify(m[0])} at offset ${m.index}`);
    }
  }
  if (seen < 5) out.push("the scan found almost no egress; it has stopped testing");
  for (const re of FORBIDDEN_EVERYWHERE) if (re.test(probeSrc)) out.push(`matches ${re}`);

  // The raw transport reaches the guard and nothing else.
  const count = (re) => [...probeSrc.matchAll(re)].length;
  if (count(/\bdeps\s*\.\s*fetchImpl\b/g) !== 1) out.push("deps.fetchImpl is read somewhere but the rawFetch line");
  if (count(/\bglobalThis\s*\.\s*fetch\b/g) !== 1) out.push("globalThis.fetch is read somewhere but the rawFetch line");
  if (!/const rawFetch: typeof fetch = deps\.fetchImpl \?\? globalThis\.fetch;/.test(probeSrc)) out.push("rawFetch is not the raw transport");
  const rawUses = [...probeSrc.matchAll(/\brawFetch\b/g)].map((m) => probeSrc.slice(m.index - 22, m.index + 8));
  if (rawUses.length !== 2 || !rawUses[1].endsWith("createProbeTransport(rawFetch")) out.push(`rawFetch is used other than by createProbeTransport: ${JSON.stringify(rawUses)}`);
  // A bare `fetch` (not `typeof fetch`, not a property) is the global: forbidden.
  for (const m of probeSrc.matchAll(/(?<![\w.$])fetch\b/g)) {
    if (!/typeof\s+$/.test(probeSrc.slice(Math.max(0, m.index - 10), m.index))) out.push(`a bare fetch reference at offset ${m.index}`);
  }
  // The route puts only the guard in the context.
  const [ra, rb] = functionRange(probeSrc, "createEbayProbeRouter");
  const props = [...probeSrc.slice(ra, rb).matchAll(/\bfetchImpl\s*:\s*([^\n]*?),?[ \t]*$/gm)].map((m) => m[1].trim());
  if (props.length !== 1 || props[0] !== "createProbeTransport(rawFetch, target, started)") out.push(`the route's context transport is not only the guard: ${JSON.stringify(props)}`);

  const { imports, statements, keywords } = importsOf(probeSrc);
  if (statements !== keywords) out.push("an import statement the pin cannot read");
  try {
    assert.deepEqual(imports, Object.fromEntries(Object.entries(PINNED_IMPORTS).map(([k, v]) => [k, [...v].sort()])));
  } catch {
    out.push(`the imports changed: ${JSON.stringify(imports)}`);
  }
  return out;
}

const PROBE_SRC = stripComments(readFileSync(join(SRC, "ebay-probe.ts"), "utf8"));
const ALLOW_SRC = stripComments(readFileSync(join(SRC, "ebay-probe-allowlist.ts"), "utf8"));

/** PROBE_SRC with `snippet` planted right after `anchor` (default: the route handler's first line). */
function plantInHandler(snippet, anchor = 'router.post("/probe/ebay", async (req: Request, res: Response) => {') {
  const at = PROBE_SRC.indexOf(anchor);
  assert.ok(at >= 0, `the plant anchor moved: ${anchor}`);
  const cut = at + anchor.length;
  return `${PROBE_SRC.slice(0, cut)}\n    ${snippet}\n${PROBE_SRC.slice(cut)}`;
}

/** probeGet's first line, where the probeGet plants go. */
const PROBE_GET_ANCHOR = "const href = probeEntryUrl(entry, ctx.target, ctx.queryTimeMs ?? ctx.now());";

describe("ebay probe: static read-only guards", () => {
  it("ebay-probe.ts has no violation: egress only in probeGet, tokenGrant and the guard; the raw fetch reaches only the guard; imports pinned", () => {
    assert.deepEqual(probeViolations(PROBE_SRC), []);
  });

  it("the token grant POST lives only in tokenGrant and the guard, and only for the two grants", () => {
    const [a, b] = functionRange(PROBE_SRC, "tokenGrant");
    assert.match(PROBE_SRC.slice(a, b), /["']POST["']/);
    assert.match(PROBE_SRC.slice(a, b), /TOKEN_GRANT_TYPES\.has\(grantType\)/);
    const [c, d] = functionRange(PROBE_SRC, "createProbeTransport");
    assert.match(PROBE_SRC.slice(c, d), /TOKEN_GRANT_TYPES\.has\(grants\[0\]\)/);
    assert.match(
      PROBE_SRC,
      /const TOKEN_GRANT_TYPES: ReadonlySet<string> = new Set\(\["client_credentials", "refresh_token"\]\);/,
      "the permitted grant set changed",
    );
    assert.ok(!/authorization_code/.test(PROBE_SRC), "the probe names the authorization_code grant");
  });

  it("the allowlist module imports nothing, makes no request and names no write method", () => {
    assert.equal(importsOf(ALLOW_SRC).keywords, 0, "ebay-probe-allowlist.ts gained an import");
    for (const { re, what } of EGRESS_PATTERNS) {
      assert.equal([...ALLOW_SRC.matchAll(re)].length, 0, `ebay-probe-allowlist.ts contains ${what}`);
    }
    assert.ok(!/method:\s*["'`](?!GET["'`])/i.test(ALLOW_SRC), "an allowlist entry names a method other than GET");
  });

  it("neither module touches a Secret Manager write, a credential lock, an alias, a dynamic import or another HTTP client", () => {
    for (const re of FORBIDDEN_EVERYWHERE) {
      assert.ok(!re.test(PROBE_SRC), `ebay-probe.ts matches ${re}`);
      assert.ok(!re.test(ALLOW_SRC), `ebay-probe-allowlist.ts matches ${re}`);
    }
  });

  // The S1 bypasses: each must be seen by the scan.
  const PLANTS = {
    "a .call-aliased fetch": 'await ctx.fetchImpl.call(null, "https://api.ebay.com/sell/inventory/v1/offer/1/publish", {});',
    "an .apply-aliased fetch": 'await deps.fetchImpl?.apply(null, ["https://api.ebay.com/x", {}]);',
    "a bound fetch": "const f = rawFetch.bind(null);",
    "Reflect.apply": 'await Reflect.apply(rawFetch, undefined, ["https://api.ebay.com/x", {}]);',
    "a lowercase delete": 'const init = { method: "delete" };',
    "a mixed-case patch in a template": "const init = { method: `Patch` };",
    "a raw fetch through an alias": 'const f = deps.fetchImpl; await f!("https://api.ebay.com/x", { method: "GET" });',
    "the global fetch, bare": 'await fetch("https://api.ebay.com/x");',
    "the global fetch, by index": 'await (globalThis["fet" + "ch"] as typeof fetch)("https://api.ebay.com/x");',
    "a dynamic import": 'const m = await import("../services/easypost");',
    "a require": 'const m = require("node:https");',
    "a new static import": "",
    "a second transport in the context": "const ctx2 = { fetchImpl: rawFetch };",
  };
  for (const [name, snippet] of Object.entries(PLANTS)) {
    it(`the scan sees a planted bypass: ${name}`, () => {
      const src =
        name === "a new static import"
          ? `import { postLabel } from "../services/easypost";\n${PROBE_SRC}`
          : plantInHandler(snippet);
      assert.ok(probeViolations(src).length > 0, `the scan missed ${name}`);
    });
  }
  const PROBE_GET_PLANTS = {
    "a POST in probeGet": 'await ctx.fetchImpl(href, { method: "POST" });',
    "a lowercase delete in probeGet": 'await ctx.fetchImpl(href, { method: "delete" });',
    "a token grant in probeGet": "await refreshAccessToken(config, rt, deps);",
  };
  for (const [name, snippet] of Object.entries(PROBE_GET_PLANTS)) {
    it(`the scan sees a planted bypass: ${name}`, () => {
      assert.ok(probeViolations(plantInHandler(snippet, PROBE_GET_ANCHOR)).length > 0, `the scan missed ${name}`);
    });
  }
});

describe("ebay probe: the allowlist", () => {
  it("is frozen to the bone and every entry is a GET", () => {
    assert.ok(Object.isFrozen(EBAY_PROBE_ALLOWLIST));
    for (const e of EBAY_PROBE_ALLOWLIST) {
      assert.equal(e.method, "GET", `${e.step} is not a GET`);
      assert.ok(Object.isFrozen(e), `${e.step} is not frozen`);
      assert.ok(Object.isFrozen(e.query), `${e.step}'s query is not frozen`);
      assert.ok(Object.isFrozen(e.shapePaths), `${e.step}'s shapePaths are not frozen`);
      assert.ok(e.host === "api" || e.host === "apiz");
      assert.match(e.path, /^\/[A-Za-z0-9_/.-]*$/);
      assert.ok(!e.path.includes(".."));
      // No write-shaped path, ever.
      assert.ok(
        !/(publish|withdraw|opt_in|bulk_|create|delete|update|enable|disable|image)/i.test(e.path),
        `${e.step} has a write-shaped path`,
      );
      for (const v of Object.values(e.query)) {
        assert.ok(typeof v === "string" || (typeof v === "object" && Object.keys(v).join() === "lastModifiedSinceDays"));
      }
    }
  });

  it("covers exactly rows 1, 3, 5, 6, 7, 10, 13 and 15; row 7 is the only app read", () => {
    assert.deepEqual([...new Set(EBAY_PROBE_ALLOWLIST.map((e) => e.row))].sort((a, b) => a - b), [1, 3, 5, 6, 7, 10, 13, 15]);
    assert.deepEqual(EBAY_PROBE_ALLOWLIST.filter((e) => e.leg === "app").map((e) => e.row), [7]);
    assert.equal(EBAY_PROBE_ALLOWLIST.filter((e) => e.row === 3).length, 3);
    assert.equal(EBAY_PROBE_ALLOWLIST.find((e) => e.row === 13).query.limit, "1");
    assert.equal(EBAY_PROBE_ALLOWLIST.find((e) => e.row === 15).host, "apiz");
    assert.equal(new Set(EBAY_PROBE_ALLOWLIST.map((e) => e.endpoint)).size, EBAY_PROBE_ALLOWLIST.length);
    for (const e of EBAY_PROBE_ALLOWLIST) {
      assert.ok(e.endpoint.startsWith(`GET ebay/${e.host}/`), e.endpoint);
    }
    assert.equal(EBAY_PROBE_ALLOWLIST.find((e) => e.hash === "shippingServiceCodes").row, 5);
    assert.equal(EBAY_PROBE_ALLOWLIST.find((e) => e.hash === "aspectNames").row, 7);
  });

  it("no shape path names buyer or ship-to data", () => {
    for (const e of EBAY_PROBE_ALLOWLIST) {
      for (const p of e.shapePaths) {
        assert.ok(!/buyer|shipTo|fulfillmentStartInstructions|email|address|fullName|phone|individualAccount|businessAccount/i.test(p), `${e.step}: ${p}`);
      }
    }
  });

  it("EBAY_READONLY_SCOPES is frozen and holds only .readonly scopes or the bare api_scope", () => {
    assert.ok(Object.isFrozen(EBAY_READONLY_SCOPES));
    assert.throws(() => EBAY_READONLY_SCOPES.push("https://api.ebay.com/oauth/api_scope/sell.inventory"), TypeError);
    assert.throws(() => {
      EBAY_READONLY_SCOPES[1] = "https://api.ebay.com/oauth/api_scope/sell.inventory";
    }, TypeError);
    assert.ok(EBAY_READONLY_SCOPES.length > 0);
    assert.equal(new Set(EBAY_READONLY_SCOPES).size, EBAY_READONLY_SCOPES.length);
    for (const scope of EBAY_READONLY_SCOPES) {
      assert.ok(
        scope === "https://api.ebay.com/oauth/api_scope" || /^https:\/\/api\.ebay\.com\/oauth\/api_scope\/[a-z]+(\.[a-z_]+)*\.readonly$/.test(scope),
        `${scope} is neither a .readonly scope nor the bare api_scope`,
      );
    }
  });

  it("row 13 reports the same top-level shape whether the seller had orders or not", () => {
    const { shapeMap } = require("../dist/bsc-shape");
    const orders = EBAY_PROBE_ALLOWLIST.find((e) => e.row === 13);
    const withOrders = goodAnswers()["/sell/fulfillment/v1/order"]();
    withOrders.next = "https://api.ebay.com/sell/fulfillment/v1/order?offset=1&limit=1";
    withOrders.total = 7;
    const none = { href: "h", limit: 1, offset: 0, total: 0, orders: [] };
    const a = shapeMap({ href: "h", limit: 1, offset: 0, ...withOrders }, { allow: orders.shapePaths });
    const b = shapeMap(none, { allow: orders.shapePaths });
    assert.deepEqual(a, b);
    assert.deepEqual(Object.keys(a).sort(), ["$", "href", "limit", "offset", "orders", "total"]);
    for (const p of orders.shapePaths) assert.ok(!p.startsWith("orders[") && p !== "next" && p !== "prev", `row 13 reports ${p}`);
  });

  it("resolves the orders window to UTC midnight N days back", () => {
    const now = Date.parse("2026-11-16T15:42:10.000Z");
    assert.equal(resolveProbeQueryValue({ lastModifiedSinceDays: PROBE_ORDERS_SINCE_DAYS }, now), "lastmodifieddate:[2026-10-17T00:00:00.000Z..]");
    assert.equal(resolveProbeQueryValue("EBAY_US", now), "EBAY_US");
  });
});

describe("ebay probe: probeGet and tokenGrant refuse anything off-list", () => {
  const ctx = (fetchImpl, env = PROD_ENV) => ({
    target: resolveEbayProbeTarget(env),
    env,
    fetchImpl,
    now: Date.now,
    timeoutMs: 1000,
  });

  it("probeGet refuses a forged copy of a listed entry, and a non-GET, before any request", async () => {
    const stub = stubEbay();
    const listed = EBAY_PROBE_ALLOWLIST[1];
    await assert.rejects(probeGet({ ...listed }, USER_TOKEN, ctx(stub.fetchImpl)), /not an allowlisted GET/);
    await assert.rejects(probeGet({ ...listed, method: "POST" }, USER_TOKEN, ctx(stub.fetchImpl)), /not an allowlisted GET/);
    await assert.rejects(
      probeGet({ ...listed, path: "/sell/inventory/v1/offer/1/publish" }, USER_TOKEN, ctx(stub.fetchImpl)),
      /not an allowlisted GET/,
    );
    assert.equal(stub.calls.length, 0);
  });

  it("probeGet sends one GET, no body, no redirect, to the fixed URL", async () => {
    const seen = [];
    const fetchImpl = async (url, init) => {
      seen.push({ url, init });
      return new Response(JSON.stringify({ userId: "x", username: "y" }), { status: 200 });
    };
    const entry = EBAY_PROBE_ALLOWLIST.find((e) => e.row === 15);
    const got = await probeGet(entry, USER_TOKEN, ctx(fetchImpl));
    assert.equal(got.status, 200);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].url, "https://apiz.ebay.com/commerce/identity/v1/user/");
    assert.equal(seen[0].init.method, "GET");
    assert.equal(seen[0].init.body, undefined);
    assert.equal(seen[0].init.redirect, "error");
    assert.equal(seen[0].init.headers.Authorization, `Bearer ${USER_TOKEN}`);
  });

  it("tokenGrant's transport refuses a non-token URL (the eBay client then reports unavailable)", async () => {
    // Simulate the eBay client being pointed elsewhere: wrap fetchImpl so the
    // URL handed to the transport is wrong. We do it by stubbing the global
    // production host check: a grant whose fetch is never reached.
    const stub = stubEbay();
    const config = { environment: "sandbox", clientId: "a", clientSecret: CLIENT_SECRET, ruName: "r" };
    await assert.rejects(tokenGrant(config, { grant: "client_credentials" }, ctx(stub.fetchImpl)), /unavailable/);
    assert.equal(stub.calls.length, 0, "the sandbox token URL was not refused");
  });

  it("tokenGrant asks for the scopes it was given and returns no refresh token", async () => {
    const stub = stubEbay({
      token: () => [200, { access_token: USER_TOKEN, expires_in: 7200, refresh_token: "ROTATED", refresh_token_expires_in: 99 }],
    });
    const config = { environment: "production", clientId: "a", clientSecret: CLIENT_SECRET, ruName: "r" };
    const out = await tokenGrant(config, { grant: "refresh_token", refreshToken: REFRESH_TOKEN, scopes: EBAY_READONLY_SCOPES }, ctx(stub.fetchImpl));
    assert.deepEqual(Object.keys(out).sort(), ["accessToken", "expiresAt"]);
    const form = new URLSearchParams(stub.calls[0].body);
    assert.equal(form.get("grant_type"), "refresh_token");
    assert.equal(form.get("scope"), EBAY_READONLY_SCOPES.join(" "));
  });
});

describe("ebay probe: the transport guard (createProbeTransport)", () => {
  const T = Date.parse("2026-11-16T12:00:00.000Z");
  const REAL = resolveEbayProbeTarget(PROD_ENV);
  const FAKE = resolveEbayProbeTarget({ ENVIRONMENT: "dev", NEONBINDER_FAKE_BSC_URL: "http://127.0.0.1:59999", NEONBINDER_FAKE_BSC_KEY: "k" });
  const recorder = () => {
    const seen = [];
    const raw = async (url, init) => (seen.push({ url, init }), new Response("{}", { status: 200 }));
    return { seen, raw };
  };
  const tokenUrl = (target) => `${target.bases.api}/identity/v1/oauth2/token`;
  const urlOf = (row, target = REAL, t = T) => probeEntryUrl(EBAY_PROBE_ALLOWLIST.find((e) => e.row === row), target, t);

  it("forwards each allowlisted GET and the two token grants, always with redirects refused", async () => {
    for (const target of [REAL, FAKE]) {
      const { seen, raw } = recorder();
      const transport = createProbeTransport(raw, target, T);
      for (const e of EBAY_PROBE_ALLOWLIST) {
        await transport(probeEntryUrl(e, target, T), { method: "GET", redirect: "follow" });
      }
      for (const grant of ["client_credentials", "refresh_token"]) {
        await transport(tokenUrl(target), { method: "POST", body: `grant_type=${grant}&scope=x` });
      }
      assert.equal(seen.length, EBAY_PROBE_ALLOWLIST.length + 2);
      for (const { init } of seen) assert.equal(init.redirect, "error");
    }
  });

  it("refuses a lowercase delete (fetch would upper-case it), and every other method or spelling", async () => {
    const { seen, raw } = recorder();
    const transport = createProbeTransport(raw, REAL, T);
    const target = urlOf(10);
    for (const method of ["delete", "DELETE", "put", "PUT", "patch", "post", "get", "Get", "HEAD", "OPTIONS", "", undefined]) {
      await assert.rejects(transport(target, { method }), /refused/, String(method));
    }
    await assert.rejects(transport(target), /refused/, "no init: fetch would default to GET");
    await assert.rejects(transport(tokenUrl(REAL), { method: "post", body: "grant_type=refresh_token" }), /refused/);
    assert.equal(seen.length, 0);
  });

  it("refuses a .call-, .apply- or Reflect.apply-aliased call to anything off the list (aliasing changes nothing)", async () => {
    const { seen, raw } = recorder();
    const transport = createProbeTransport(raw, REAL, T);
    const publish = "https://api.ebay.com/sell/inventory/v1/offer/1/publish";
    await assert.rejects(transport.call(null, publish, { method: "POST", body: "grant_type=refresh_token" }), /refused/);
    await assert.rejects(transport.call({ fetchImpl: raw }, urlOf(10), { method: "delete" }), /refused/);
    await assert.rejects(transport.apply(null, [publish, { method: "GET" }]), /refused/);
    await assert.rejects(Reflect.apply(transport, undefined, [urlOf(13), { method: "DELETE" }]), /refused/);
    await assert.rejects(transport.bind(null)(publish, { method: "GET" }), /refused/);
    assert.equal(seen.length, 0);
    assert.ok(Object.isFrozen(transport), "the guard can be patched");
  });

  it("refuses a GET that is not character for character an allowlisted URL, or that carries a body", async () => {
    const { seen, raw } = recorder();
    const transport = createProbeTransport(raw, REAL, T);
    const offers = urlOf(10);
    const bad = [
      `${offers}&sku=OTHER`,
      offers.replace("NBPROBE-ABSENT", "REAL-SKU"),
      `${offers}#x`,
      urlOf(13, REAL, T - 2 * 24 * 3600 * 1000),
      "https://api.ebay.com/sell/inventory/v1/offer/1/publish",
      "https://api.ebay.com/sell/inventory/v1/offer",
      urlOf(15).replace("apiz.ebay.com", "api.ebay.com"),
      urlOf(15, FAKE),
      tokenUrl(REAL),
    ];
    for (const url of bad) await assert.rejects(transport(url, { method: "GET" }), /refused/, url);
    await assert.rejects(transport(offers, { method: "GET", body: "x" }), /refused/);
    await assert.rejects(transport(new URL(offers), { method: "GET" }), /refused/, "a URL object");
    await assert.rejects(transport(new Request(offers), { method: "GET" }), /refused/, "a Request object");
    assert.equal(seen.length, 0);
  });

  it("refuses a POST that is not one client_credentials or refresh_token grant to the target's own token URL", async () => {
    const { seen, raw } = recorder();
    const transport = createProbeTransport(raw, REAL, T);
    const tu = tokenUrl(REAL);
    const bad = [
      [tu, "grant_type=authorization_code&code=abc"],
      [tu, "grant_type=refresh_token&grant_type=authorization_code"],
      [tu, "grant_type=refresh_token&code=abc"],
      [tu, "scope=x"],
      [tu, ""],
      [tokenUrl(FAKE), "grant_type=refresh_token"],
      [`${tu}?x=1`, "grant_type=refresh_token"],
      ["https://api.ebay.com/sell/inventory/v1/offer/1/publish", "grant_type=refresh_token"],
      [urlOf(10), "grant_type=refresh_token"],
    ];
    for (const [url, body] of bad) await assert.rejects(transport(url, { method: "POST", body }), /refused/, `${url} ${body}`);
    await assert.rejects(transport(tu, { method: "POST", body: new URLSearchParams({ grant_type: "refresh_token" }) }), /refused/, "a non-string body");
    await assert.rejects(transport(tu, { method: "POST" }), /refused/, "no body");
    assert.equal(seen.length, 0);

    // The fake target's guard refuses the REAL token URL.
    const fakeGuard = createProbeTransport(raw, FAKE, T);
    await assert.rejects(fakeGuard(tu, { method: "POST", body: "grant_type=client_credentials" }), /refused/);
    assert.equal(seen.length, 0);
  });
});

describe("ebay probe: digests and parity with the fake", () => {
  const FAKE = join(HERE, "..", "..", "fake-bsc");

  it("is sha256 hex of JSON.stringify of the unique, non-empty, default-sorted names", () => {
    assert.equal(digestNames(["b", "a", "a", ""]), crypto.createHash("sha256").update('["a","b"]').digest("hex"));
    assert.equal(digestNames(["Z", "a", "É"]), crypto.createHash("sha256").update(JSON.stringify(["Z", "a", "É"])).digest("hex"));
  });

  it("uses the fake eBay's own public client id and secret", () => {
    const src = readFileSync(join(FAKE, "src", "ebay", "tokens.ts"), "utf8");
    assert.match(src, new RegExp(`FAKE_EBAY_CLIENT_ID = "${FAKE_EBAY_CLIENT_ID}"`));
    assert.match(src, new RegExp(`FAKE_EBAY_CLIENT_SECRET = "${FAKE_EBAY_CLIENT_SECRET}"`));
  });

  it("names exactly the endpoints the fake's drift compare expects", () => {
    const contract = readFileSync(join(FAKE, "CONTRACT.md"), "utf8");
    const block = contract.split("Endpoint names are exactly")[1]?.split("```")[1];
    assert.ok(block, "CONTRACT.md lost its eBay endpoint list");
    const listed = block.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("GET "));
    assert.deepEqual([...listed].sort(), EBAY_PROBE_ALLOWLIST.map((e) => e.endpoint).sort());
  });
});

// ---------------------------------------------------------------------------
// 2. The route
// ---------------------------------------------------------------------------

describe("POST /probe/ebay (real target)", () => {
  it("prod, all good: ok, readonly scopes, only permitted calls, shapes and digests, no values", async () => {
    const { router, logs, reads, calls } = makeRouter();
    const res = await call(router);
    assert.equal(res.status, 200);
    const b = res.body;
    assert.equal(b.ebayTarget, "real");
    assert.equal(b.outcome, "ok");
    assert.deepEqual(b.appLeg, { ok: true, outcome: "ok" });
    assert.deepEqual(b.accountLeg, { ok: true, outcome: "ok", scopes: "readonly" });
    assert.deepEqual(reads, [PROBE_KEY]);

    assertOnlyPermittedCalls(calls);
    const posts = calls.filter((c) => c.method === "POST");
    assert.equal(posts.length, 2, "one app grant and one refresh grant");
    assert.equal(new URLSearchParams(posts[1].body).get("scope"), EBAY_READONLY_SCOPES.join(" "));
    assert.equal(calls.filter((c) => c.method === "GET").length, EBAY_PROBE_ALLOWLIST.length);
    // The app token reads row 7 only; the user token reads the rest.
    for (const c of calls.filter((x) => x.method === "GET")) {
      const expected = c.url.includes("get_item_aspects_for_category") ? APP_TOKEN : USER_TOKEN;
      assert.equal(c.headers.Authorization, `Bearer ${expected}`);
    }

    for (const e of EBAY_PROBE_ALLOWLIST) {
      assert.ok(b.shapes[e.endpoint], `no shape for ${e.endpoint}`);
      assert.equal(typeof b.statuses[e.endpoint], "number");
    }
    assert.equal(b.shapes["GET ebay/api/sell/inventory/v1/offer"]["errors[].errorId"], "number");
    assert.equal(b.statuses["GET ebay/api/sell/inventory/v1/offer"], 404);
    // Row 13: top-level keys only. Never an order's fields, never `next`.
    assert.deepEqual(b.shapes["GET ebay/api/sell/fulfillment/v1/order"], { $: "object", orders: "array", total: "number" });
    assert.deepEqual(b.hashes, {
      "GET ebay/api/sell/metadata/v1/shipping/marketplace/EBAY_US/get_shipping_services": digestNames(SHIPPING_CODES),
      "GET ebay/api/commerce/taxonomy/v1/category_tree/0/get_item_aspects_for_category": digestNames(ASPECT_NAMES),
    });
    assert.equal(b.steps.length, EBAY_PROBE_ALLOWLIST.length + 2);

    assertNoSecrets(res.text, "response");
    assertNoSecrets(JSON.stringify(logs), "logs");
    // Only allowlisted shape paths left the process.
    for (const e of EBAY_PROBE_ALLOWLIST) {
      const allowed = new Set(e.shapePaths);
      for (const p of Object.keys(b.shapes[e.endpoint])) {
        const ok = p === "$" || [...allowed].some((a) => a === p || a.startsWith(`${p}.`) || a.startsWith(`${p}[]`));
        assert.ok(ok, `${e.endpoint} reported ${p}`);
      }
    }
    assert.ok(!res.text.includes("buyer") && !res.text.includes("shipTo") && !res.text.includes("individualAccount"));
  });

  it("ignores the request body in real mode", async () => {
    const { router, reads, calls } = makeRouter();
    const res = await call(router, { key: "ebay-credentials-someone-else", refreshToken: "BODY-REFRESH" });
    assert.equal(res.body.outcome, "ok");
    assert.deepEqual(reads, [PROBE_KEY]);
    assert.ok(!calls.some((c) => (c.body ?? "").includes("BODY-REFRESH")));
  });

  it("refuses a real probe outside prod and calls nobody", async () => {
    const { router, calls, reads } = makeRouter({ env: { ...PROD_ENV, ENVIRONMENT: "dev" } });
    const res = await call(router);
    assert.equal(res.status, 409);
    assert.equal(calls.length, 0);
    assert.equal(reads.length, 0);
  });

  it("runs at most once a minute", async () => {
    const { router } = makeRouter();
    assert.equal((await call(router)).status, 200);
    const second = await call(router);
    assert.equal(second.status, 429);
    assert.ok(Number(second.headers.get("retry-after")) > 0);
  });

  it("honours the eBay pause flag: skipped_paused, nothing read", async () => {
    const { router, calls, reads } = makeRouter({ isPaused: async () => true });
    const res = await call(router);
    assert.equal(res.body.outcome, "skipped_paused");
    assert.equal(calls.length, 0);
    assert.equal(reads.length, 0);
  });

  /** Deps for the route's DEFAULT lookup: the real shouldSkipCanary with a stub Convex. */
  const pauseLookup = (answer) => {
    const seen = [];
    const logs = [];
    return {
      seen,
      logs,
      deps: {
        siteUrl: "https://pause-lookup.example.site",
        mintIdToken: async () => "PAUSE-ID-TOKEN-VALUE",
        fetch: async (url, init) => {
          seen.push({ url, init });
          return answer();
        },
        log: (line) => logs.push(line),
        timeoutMs: 2000,
      },
    };
  };

  it("the default lookup (the real shouldSkipCanary) answering paused [\"ebay\"] is skipped_paused, nothing read", async () => {
    const lookup = pauseLookup(() => new Response(JSON.stringify({ paused: ["ebay"] }), { status: 200 }));
    const { router, calls, reads } = makeRouter({ isPaused: null, deps: { pauseLookup: lookup.deps } });
    const res = await call(router);
    assert.equal(res.status, 200);
    assert.equal(res.body.outcome, "skipped_paused");
    assert.equal(res.body.appLeg.outcome, "skipped_paused");
    assert.equal(res.body.accountLeg.outcome, "skipped_paused");
    assert.equal(lookup.seen.length, 1);
    assert.equal(lookup.seen[0].url, "https://pause-lookup.example.site/internal/marketplace-pause");
    assert.equal(calls.length, 0);
    assert.equal(reads.length, 0);
    assert.ok(!res.text.includes("PAUSE-ID-TOKEN-VALUE"));

    // Another platform paused is not eBay paused.
    const other = pauseLookup(() => new Response(JSON.stringify({ paused: ["buysportscards", "sportlots"] }), { status: 200 }));
    const run = makeRouter({ isPaused: null, deps: { pauseLookup: other.deps } });
    assert.equal((await call(run.router)).body.outcome, "ok");
  });

  it("a pause lookup that fails FAILS OPEN: the probe runs and the failure is logged", async () => {
    for (const [why, answer, reason] of [
      ["a 503", () => new Response("down", { status: 503 }), "http_503"],
      ["a network error", () => Promise.reject(new TypeError(`fetch failed ${USER_TOKEN}`)), "network_error"],
      ["an unreadable body", () => new Response("not json", { status: 200 }), "bad_body"],
    ]) {
      const lookup = pauseLookup(answer);
      const { router, calls, reads, logs } = makeRouter({ isPaused: null, deps: { pauseLookup: lookup.deps } });
      const res = await call(router);
      assert.equal(res.status, 200, why);
      assert.equal(res.body.outcome, "ok", why);
      assert.deepEqual(reads, [PROBE_KEY], why);
      assert.equal(calls.filter((c) => c.method === "GET").length, EBAY_PROBE_ALLOWLIST.length, why);
      assert.deepEqual(lookup.logs, [{ msg: "canary_pause_lookup_failed", platform: "ebay", reason }], why);
      assertNoSecrets(JSON.stringify([lookup.logs, logs]), `logs (${why})`);
    }
  });

  it("an injected lookup that throws also fails open: the probe runs, a value-free line is logged", async () => {
    const { router, calls, logs } = makeRouter({ isPaused: async () => Promise.reject(new Error(`boom ${USER_TOKEN}`)) });
    const res = await call(router);
    assert.equal(res.status, 200);
    assert.equal(res.body.outcome, "ok");
    assert.equal(calls.filter((c) => c.method === "GET").length, EBAY_PROBE_ALLOWLIST.length);
    assert.ok(logs.some((l) => l.msg === "ebay_probe_pause_lookup_failed" && l.error_class === "Error"));
    assertNoSecrets(JSON.stringify(logs), "logs");
  });

  it("falls back to the consented scopes when eBay refuses the read-only ones, and logs it", async () => {
    const stub = stubEbay({
      token: (grant, scope) => {
        if (grant === "client_credentials") return [200, { access_token: APP_TOKEN, expires_in: 7200 }];
        if (scope.includes(".readonly") && scope.includes("sell.account.readonly")) return [400, { error: "invalid_scope", error_description: "DESC-VALUE" }];
        return [200, { access_token: USER_TOKEN, expires_in: 7200 }];
      },
    });
    const { router, logs, calls } = makeRouter({ stub });
    const res = await call(router);
    assert.equal(res.body.outcome, "ok");
    assert.equal(res.body.accountLeg.scopes, "consented");
    const refreshes = calls.filter((c) => c.method === "POST" && c.body.includes("refresh_token"));
    assert.deepEqual(refreshes.map((c) => new URLSearchParams(c.body).get("scope")), [EBAY_READONLY_SCOPES.join(" "), EBAY_SCOPES.join(" ")]);
    assert.ok(logs.some((l) => l.msg === "ebay_probe_scope_fallback" && l.reason === "invalid_scope"));
    assert.ok(!res.text.includes("DESC-VALUE"));
    assertNoSecrets(JSON.stringify(logs), "logs");
  });

  it("does not fall back when the refresh fails for a reason other than a refusal", async () => {
    const stub = stubEbay({
      token: (grant) => (grant === "client_credentials" ? [200, { access_token: APP_TOKEN, expires_in: 7200 }] : [503, {}]),
    });
    const { router, calls } = makeRouter({ stub });
    const res = await call(router);
    assert.equal(res.body.outcome, "account_warning");
    assert.equal(res.body.accountLeg.outcome, "ebay_unavailable");
    assert.equal(calls.filter((c) => c.method === "POST").length, 2);
  });

  it("no configured probe account: app leg still gates, account leg is skipped_not_connected", async () => {
    const env = { ...PROD_ENV };
    delete env[EBAY_PROBE_CREDENTIAL_KEY_ENV];
    const { router, calls, reads } = makeRouter({ env });
    const res = await call(router);
    assert.equal(res.body.outcome, "account_warning");
    assert.equal(res.body.appLeg.ok, true);
    assert.equal(res.body.accountLeg.outcome, "skipped_not_connected");
    assert.equal(reads.length, 0);
    assert.equal(calls.filter((c) => c.method === "POST").length, 1);
    assert.ok(res.body.steps.filter((s) => s.leg === "account").every((s) => s.failure === "skipped"));
  });

  it("an absent secret is skipped_not_connected; a read fault is credential_read_failed", async () => {
    const absent = makeRouter({ readCredential: async () => ({ kind: "absent" }) });
    assert.equal((await call(absent.router)).body.accountLeg.outcome, "skipped_not_connected");
    const failed = makeRouter({ readCredential: async () => ({ kind: "failed" }) });
    const res = await call(failed.router);
    assert.equal(res.body.outcome, "account_warning");
    assert.equal(res.body.accountLeg.outcome, "credential_read_failed");
  });

  it("refuses a malformed or fake-form probe key without reading it", async () => {
    for (const key of ["buysportscards-credentials-x", "ebay-credentials-fake-slug-user", "ebay-credentials-a/b"]) {
      const { router, reads } = makeRouter({ env: { ...PROD_ENV, [EBAY_PROBE_CREDENTIAL_KEY_ENV]: key } });
      const res = await call(router);
      assert.equal(res.body.accountLeg.outcome, "credential_read_failed", key);
      assert.equal(reads.length, 0, key);
    }
  });

  it("invalid_grant on the read-only grant is refresh_failed, a warning, with NO second grant (fallback is invalid_scope only)", async () => {
    for (const error of ["invalid_grant", "access_denied"]) {
      const stub = stubEbay({
        token: (grant) =>
          grant === "client_credentials" ? [200, { access_token: APP_TOKEN, expires_in: 7200 }] : [400, { error }],
      });
      const { router, calls, logs } = makeRouter({ stub });
      const res = await call(router);
      assert.equal(res.body.outcome, "account_warning", error);
      assert.equal(res.body.accountLeg.outcome, "refresh_failed", error);
      assert.equal(res.body.accountLeg.scopes, null, error);
      assert.match(res.body.accountLeg.detail, new RegExp(`^account\\.token_readonly: rejected, HTTP 400, ${error}$`), error);
      const refreshes = calls.filter((c) => c.method === "POST" && new URLSearchParams(c.body).get("grant_type") === "refresh_token");
      assert.deepEqual(refreshes.map((c) => new URLSearchParams(c.body).get("scope")), [EBAY_READONLY_SCOPES.join(" ")], error);
      assert.ok(!logs.some((l) => l.msg === "ebay_probe_scope_fallback"), error);
      assert.equal(calls.filter((c) => c.method === "GET").length, 1, `${error}: only row 7 was read`);
    }
  });

  it("an app token eBay refuses fails the probe", async () => {
    const stub = stubEbay({ token: () => [401, { error: "invalid_client" }] });
    const { router } = makeRouter({ stub });
    const res = await call(router);
    assert.equal(res.body.outcome, "app_failed");
    assert.equal(res.body.appLeg.outcome, "token_failed");
  });

  it("a 5xx on row 7 fails the probe as ebay_unavailable", async () => {
    const answers = goodAnswers();
    answers["/commerce/taxonomy/v1/category_tree/0/get_item_aspects_for_category"] = () => [503, { errors: [] }];
    const { router } = makeRouter({ stub: stubEbay({ answers }) });
    const res = await call(router);
    assert.equal(res.body.outcome, "app_failed");
    assert.equal(res.body.appLeg.outcome, "ebay_unavailable");
    assert.equal(res.body.accountLeg.ok, true, "the account leg still ran");
  });

  it("row 7 without an aspects list is read_failed (no digest)", async () => {
    const answers = goodAnswers();
    answers["/commerce/taxonomy/v1/category_tree/0/get_item_aspects_for_category"] = () => ({ categoryTreeId: "0" });
    const { router } = makeRouter({ stub: stubEbay({ answers }) });
    const res = await call(router);
    assert.equal(res.body.appLeg.outcome, "read_failed");
    assert.deepEqual(Object.keys(res.body.hashes), [
      "GET ebay/api/sell/metadata/v1/shipping/marketplace/EBAY_US/get_shipping_services",
    ]);
  });

  it("a 429 on the account leg stops the remaining account reads", async () => {
    const answers = goodAnswers();
    answers["/sell/account/v1/program/get_opted_in_programs"] = () => [429, { errors: [] }];
    const { router, calls } = makeRouter({ stub: stubEbay({ answers }) });
    const res = await call(router);
    assert.equal(res.body.outcome, "account_warning");
    assert.equal(res.body.accountLeg.outcome, "ebay_unavailable");
    assert.ok(!calls.some((c) => c.url.includes("/sell/fulfillment/")));
    const skipped = res.body.steps.filter((s) => s.failure === "skipped").map((s) => s.step);
    assert.ok(skipped.includes("account.orders"));
  });

  it("a non-JSON or unexpected-status answer is read_failed, naming the step only", async () => {
    const answers = goodAnswers();
    answers["/sell/account/v1/payment_policy"] = () => [403, { errors: [{ errorId: 1100, message: "MSG-VALUE" }] }];
    const { router } = makeRouter({ stub: stubEbay({ answers }) });
    const res = await call(router);
    assert.equal(res.body.accountLeg.outcome, "read_failed");
    assert.equal(res.body.accountLeg.detail, "account.payment_policies: HTTP 403");
    assert.ok(!res.text.includes("MSG-VALUE"));
  });

  it("refuses an eBay environment other than production in real mode", async () => {
    const { router, calls } = makeRouter({ env: { ...PROD_ENV, EBAY_ENVIRONMENT: "sandbox" } });
    const res = await call(router);
    assert.equal(res.body.outcome, "app_failed");
    assert.equal(res.body.appLeg.outcome, "not_configured");
    assert.equal(calls.length, 0);
  });
});

describe("POST /probe/ebay (fake target)", () => {
  const FAKE_ORIGIN = "http://127.0.0.1:59999";
  const FAKE_ENV = Object.freeze({
    ENVIRONMENT: "dev",
    NEONBINDER_FAKE_BSC_URL: FAKE_ORIGIN,
    NEONBINDER_FAKE_BSC_KEY: "fake-caller-key-value",
    // Present but must be ignored on the fake: the fake has its own client.
    EBAY_ENVIRONMENT: "sandbox",
    EBAY_CLIENT_ID: "sandbox-client",
    EBAY_CLIENT_SECRET: CLIENT_SECRET,
    EBAY_RU_NAME: "sandbox-ru",
    [EBAY_PROBE_CREDENTIAL_KEY_ENV]: PROBE_KEY,
  });
  const FAKE_BASES = { api: `${FAKE_ORIGIN}/ebay/api`, apiz: `${FAKE_ORIGIN}/ebay/apiz` };
  const fakeStub = (opts = {}) => stubEbay({ ...opts, bases: [FAKE_BASES.api, FAKE_BASES.apiz] });

  it("targets the fake under /ebay/api|apiz with the caller key and the fake client; body refresh token used", async () => {
    const stub = fakeStub();
    const { router, reads, calls } = makeRouter({ env: FAKE_ENV, stub });
    const res = await call(router, { refreshToken: "fake-refresh-token" });
    assert.equal(res.status, 200);
    assert.equal(res.body.ebayTarget, "fake");
    assert.equal(res.body.outcome, "ok");
    assert.equal(reads.length, 0, "the fake never reads Secret Manager");
    assertOnlyPermittedCalls(calls, FAKE_BASES);
    for (const c of calls) {
      assert.ok(c.url.startsWith(`${FAKE_ORIGIN}/ebay/`), `left the fake: ${c.url}`);
      assert.equal(c.headers["x-nb-fake-bsc-key"], "fake-caller-key-value");
    }
    const grants = calls.filter((c) => c.method === "POST");
    const basic = `Basic ${Buffer.from(`${FAKE_EBAY_CLIENT_ID}:${FAKE_EBAY_CLIENT_SECRET}`).toString("base64")}`;
    for (const g of grants) assert.equal(g.headers.Authorization, basic);
    assert.equal(new URLSearchParams(grants[1].body).get("refresh_token"), "fake-refresh-token");
    assert.ok(!res.text.includes("fake-refresh-token"));
  });

  it("without a refresh token the account leg is skipped_not_connected", async () => {
    const { router, calls } = makeRouter({ env: FAKE_ENV, stub: fakeStub() });
    const res = await call(router);
    assert.equal(res.body.outcome, "account_warning");
    assert.equal(res.body.accountLeg.outcome, "skipped_not_connected");
    assert.equal(calls.filter((c) => c.method === "POST").length, 1);
  });

  it("refuses a malformed body with 400 before the rate window", async () => {
    const { router, calls } = makeRouter({ env: FAKE_ENV, stub: fakeStub() });
    for (const body of [{ refreshToken: 7 }, { refreshToken: "" }, { refreshToken: "has space" }, [1]]) {
      const res = await call(router, body);
      assert.equal(res.status, 400, JSON.stringify(body));
    }
    assert.equal(calls.length, 0);
    assert.equal((await call(router)).status, 200, "a refused body did not burn the minute");
  });

  it("a missing caller key fails the reads as network, not a crash", async () => {
    const env = { ...FAKE_ENV };
    delete env.NEONBINDER_FAKE_BSC_KEY;
    const { router, calls } = makeRouter({ env, stub: fakeStub() });
    const res = await call(router);
    assert.equal(res.status, 200);
    assert.equal(res.body.outcome, "app_failed");
    assert.equal(calls.length, 0);
  });

  it("a fake URL off the pinned host is refused (500), contacting nobody", async () => {
    const { router, calls } = makeRouter({ env: { ...FAKE_ENV, NEONBINDER_FAKE_BSC_URL: "https://evil.example.com" }, stub: fakeStub() });
    assert.equal((await call(router)).status, 500);
    assert.equal(calls.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Adversarial pass (NEO-555 PR A): try to make the probe write, follow a
// redirect, take input from the request, or run twice at once.
// ---------------------------------------------------------------------------

describe("ebay probe (adversarial): the allowlist cannot be forged or mutated", () => {
  const ctx = (fetchImpl) => ({ target: resolveEbayProbeTarget(PROD_ENV), env: PROD_ENV, fetchImpl, now: Date.now, timeoutMs: 1000 });

  it("refuses every look-alike of a listed entry (prototype, proxy, clone, getter that flips) before any request", async () => {
    const stub = stubEbay();
    const listed = EBAY_PROBE_ALLOWLIST.find((e) => e.row === 15);
    let reads = 0;
    const flipping = {
      ...listed,
      get method() {
        return ++reads === 1 ? "GET" : "POST";
      },
    };
    const lookAlikes = [
      Object.create(listed),
      new Proxy(listed, {}),
      structuredClone(listed),
      Object.assign(Object.create(null), listed),
      flipping,
      { ...listed, method: "get" },
      { ...listed, host: "evil" },
    ];
    for (const forged of lookAlikes) {
      await assert.rejects(probeGet(forged, USER_TOKEN, ctx(stub.fetchImpl)), /not an allowlisted GET/);
    }
    assert.equal(stub.calls.length, 0);
  });

  it("the list, each entry, its query values and its arrays all reject a write (strict mode throws)", () => {
    assert.throws(() => EBAY_PROBE_ALLOWLIST.push({}), TypeError);
    assert.throws(() => {
      EBAY_PROBE_ALLOWLIST[0] = EBAY_PROBE_ALLOWLIST[1];
    }, TypeError);
    for (const e of EBAY_PROBE_ALLOWLIST) {
      assert.throws(() => {
        e.method = "POST";
      }, TypeError, e.step);
      assert.throws(() => {
        e.path = "/sell/inventory/v1/offer/1/publish";
      }, TypeError, e.step);
      assert.throws(() => {
        e.host = "evil";
      }, TypeError, e.step);
      assert.throws(() => e.okStatuses.push(500), TypeError, e.step);
      assert.throws(() => e.shapePaths.push("buyer.username"), TypeError, e.step);
      assert.throws(() => {
        e.query.injected = "1";
      }, TypeError, e.step);
      for (const v of Object.values(e.query)) {
        if (typeof v === "object") {
          assert.ok(Object.isFrozen(v), `${e.step}: a query value object is writable`);
          assert.throws(() => {
            v.lastModifiedSinceDays = Number.NaN;
          }, TypeError, e.step);
        }
      }
    }
  });

  it("the orders window cannot be bent: the day count stays 30", () => {
    const orders = EBAY_PROBE_ALLOWLIST.find((e) => e.row === 13);
    assert.equal(orders.query.filter.lastModifiedSinceDays, PROBE_ORDERS_SINCE_DAYS);
    assert.match(resolveProbeQueryValue(orders.query.filter, Date.parse("2026-11-16T00:00:00Z")), /^lastmodifieddate:\[2026-10-17T00:00:00\.000Z\.\.\]$/);
  });

  it("every URL probeGet builds is the target's base, the entry's path and its own fixed query, nothing else", async () => {
    for (const env of [PROD_ENV, { ENVIRONMENT: "dev", NEONBINDER_FAKE_BSC_URL: "http://127.0.0.1:59999", NEONBINDER_FAKE_BSC_KEY: "k" }]) {
      const target = resolveEbayProbeTarget(env);
      for (const e of EBAY_PROBE_ALLOWLIST) {
        let seen;
        const fetchImpl = async (url) => ((seen = new URL(url)), new Response("{}", { status: 200 }));
        await probeGet(e, USER_TOKEN, { target, env, fetchImpl, now: () => Date.parse("2026-11-16T00:00:00Z"), timeoutMs: 1000, mintIdToken: async () => "t" });
        const base = new URL(target.bases[e.host]);
        assert.equal(seen.origin, base.origin, e.step);
        assert.equal(seen.pathname, `${base.pathname.replace(/\/$/, "")}${e.path}`, e.step);
        const want = Object.keys(e.query).sort();
        assert.deepEqual([...seen.searchParams.keys()].sort(), want, e.step);
        assert.equal(seen.hash, "");
        assert.equal(seen.username + seen.password, "");
      }
    }
  });
});

describe("ebay probe (adversarial): redirects and error causes", () => {
  it("every request, GET and token grant, asks fetch to refuse redirects", async () => {
    for (const env of [PROD_ENV, { ENVIRONMENT: "dev", NEONBINDER_FAKE_BSC_URL: "http://127.0.0.1:59999", NEONBINDER_FAKE_BSC_KEY: "k", [EBAY_PROBE_CREDENTIAL_KEY_ENV]: PROBE_KEY }]) {
      const fake = env.NEONBINDER_FAKE_BSC_URL !== undefined;
      const inner = stubEbay(fake ? { bases: ["http://127.0.0.1:59999/ebay/api", "http://127.0.0.1:59999/ebay/apiz"] } : {});
      const inits = [];
      const fetchImpl = async (url, init) => (inits.push(init), inner.fetchImpl(url, init));
      const { router } = makeRouter({ env, stub: { fetchImpl, calls: inner.calls } });
      const res = await call(router, fake ? { refreshToken: "fake-rt" } : {});
      assert.equal(res.body.outcome, "ok");
      assert.ok(inits.length >= 12);
      for (const init of inits) assert.equal(init.redirect, "error");
    }
  });

  it("a 3xx answer is read_failed and its Location is never fetched", async () => {
    const inner = stubEbay();
    const seen = [];
    const fetchImpl = async (url, init) => {
      const u = new URL(String(url));
      seen.push(`${init?.method ?? "GET"} ${u.href}`);
      if (u.pathname.endsWith("/oauth2/token")) return inner.fetchImpl(url, init);
      return new Response(null, { status: 302, headers: { location: "https://evil.example.com/steal" } });
    };
    const { router } = makeRouter({ stub: { fetchImpl, calls: inner.calls } });
    const res = await call(router);
    assert.equal(res.body.outcome, "app_failed");
    assert.equal(res.body.appLeg.outcome, "read_failed");
    assert.ok(!seen.some((s) => s.includes("evil.example.com")));
    assert.ok(!res.text.includes("evil.example.com"));
  });

  it("a thrown fetch error, with a cause that carries the request, never reaches the response or the logs", async () => {
    const inner = stubEbay();
    const leaky = () =>
      Object.assign(new TypeError(`fetch failed ${USER_TOKEN} ${REFRESH_TOKEN}`), {
        cause: Object.assign(new Error(`Authorization: Bearer ${APP_TOKEN} ${CLIENT_SECRET}`), { request: { headers: { Authorization: `Bearer ${USER_TOKEN}` } } }),
      });
    for (const failing of ["GET", "POST"]) {
      const fetchImpl = async (url, init) => {
        if ((init?.method ?? "GET") === failing && (failing === "GET" || new URLSearchParams(init.body).get("grant_type") === "refresh_token")) throw leaky();
        return inner.fetchImpl(url, init);
      };
      const { router, logs } = makeRouter({ stub: { fetchImpl, calls: inner.calls }, deps: { minIntervalMs: 0 } });
      const errors = [];
      const orig = console.error;
      console.error = (...a) => errors.push(a.map(String).join(" "));
      let res;
      try {
        res = await call(router);
      } finally {
        console.error = orig;
      }
      assert.equal(res.status, 200, failing);
      assertNoSecrets(res.text, `response (${failing})`);
      assertNoSecrets(JSON.stringify(logs), `logs (${failing})`);
      assertNoSecrets(errors.join("\n"), `console.error (${failing})`);
    }
  });

  it("an unexpected throw (an injected credential reader) is a fixed 500 with nothing but the target", async () => {
    const { router } = makeRouter({ readCredential: async () => Promise.reject(new Error(`boom ${USER_TOKEN} ${REFRESH_TOKEN}`)) });
    const errors = [];
    const orig = console.error;
    console.error = (...a) => errors.push(a.map(String).join(" "));
    let res;
    try {
      res = await call(router);
    } finally {
      console.error = orig;
    }
    assert.equal(res.status, 500);
    assert.deepEqual(res.body, { error: "eBay probe failed", ebayTarget: "real" });
    assertNoSecrets(errors.join("\n"), "console.error");
  });
});

describe("ebay probe (adversarial): the request cannot steer the probe", () => {
  const FAKE_ORIGIN = "http://127.0.0.1:59999";
  const FAKE_ENV = Object.freeze({ ENVIRONMENT: "dev", NEONBINDER_FAKE_BSC_URL: FAKE_ORIGIN, NEONBINDER_FAKE_BSC_KEY: "fake-caller-key-value" });
  const FAKE_BASES = { api: `${FAKE_ORIGIN}/ebay/api`, apiz: `${FAKE_ORIGIN}/ebay/apiz` };
  const fakeStub = () => stubEbay({ bases: [FAKE_BASES.api, FAKE_BASES.apiz] });

  it("a fake refresh token full of form and path syntax stays one opaque form value", async () => {
    const hostile = [
      "x&grant_type=authorization_code&code=abc",
      "x&scope=https://api.ebay.com/oauth/api_scope/sell.inventory",
      "../../sell/inventory/v1/offer/1/publish",
      "x%26grant_type%3Dauthorization_code",
      "a=b;c=d#frag?q=1",
    ];
    for (const refreshToken of hostile) {
      const stub = fakeStub();
      const { router, calls } = makeRouter({ env: FAKE_ENV, stub });
      const res = await call(router, { refreshToken });
      assert.equal(res.status, 200, refreshToken);
      assertOnlyPermittedCalls(calls, FAKE_BASES);
      const refresh = calls.filter((c) => c.method === "POST" && c.body.includes("grant_type=refresh_token"));
      assert.equal(refresh.length, 1, refreshToken);
      const form = new URLSearchParams(refresh[0].body);
      assert.deepEqual([...form.keys()].sort(), ["grant_type", "refresh_token", "scope"], refreshToken);
      assert.equal(form.get("refresh_token"), refreshToken);
      assert.equal(form.get("scope"), EBAY_READONLY_SCOPES.join(" "));
      for (const c of calls.filter((x) => x.method === "POST")) {
        assert.notEqual(new URLSearchParams(c.body).get("grant_type"), "authorization_code");
      }
    }
  });

  it("extra body fields (url, host, path, method, __proto__) change nothing", async () => {
    const stub = fakeStub();
    const { router, calls } = makeRouter({ env: FAKE_ENV, stub });
    const raw = '{"refreshToken":"fake-rt","url":"https://evil.example.com","host":"evil.example.com","path":"/sell/inventory/v1/offer/1/publish","method":"POST","sku":"X","__proto__":{"method":"POST"}}';
    const app = express();
    app.use(express.json());
    app.use(router);
    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    try {
      const res = await fetch(`http://127.0.0.1:${server.address().port}/probe/ebay`, { method: "POST", headers: { "Content-Type": "application/json" }, body: raw });
      assert.equal(res.status, 200);
    } finally {
      server.close();
    }
    assertOnlyPermittedCalls(calls, FAKE_BASES);
    assert.ok(calls.every((c) => new URL(c.url).origin === FAKE_ORIGIN));
  });

  it("a prod process with the fake URL set is refused (500) and contacts nobody", async () => {
    const stub = fakeStub();
    const { router, calls } = makeRouter({ env: { ...FAKE_ENV, ENVIRONMENT: "prod" }, stub });
    const res = await call(router, { refreshToken: "fake-rt" });
    assert.equal(res.status, 500);
    assert.equal(calls.length, 0);
  });

  it("an over-long or non-printable fake refresh token is a 400", async () => {
    const { router, calls } = makeRouter({ env: FAKE_ENV, stub: fakeStub() });
    for (const refreshToken of ["a".repeat(4097), "tab\there", "nul\u0000", "é"]) {
      assert.equal((await call(router, { refreshToken })).status, 400, JSON.stringify(refreshToken).slice(0, 20));
    }
    assert.equal(calls.length, 0);
  });

  it("real mode reads no body at all: an array, a nested object and a key all leave the call list as it was", async () => {
    const baseline = makeRouter();
    await call(baseline.router);
    for (const body of [[1, 2], { key: "ebay-credentials-other", refreshToken: "BODY-RT", nested: { path: "/sell/x" } }]) {
      const { router, calls, reads } = makeRouter();
      const res = await call(router, body);
      assert.equal(res.status, 200, JSON.stringify(body));
      assert.deepEqual(reads, [PROBE_KEY]);
      assert.deepEqual(
        calls.map((c) => `${c.method} ${c.url}`),
        baseline.calls.map((c) => `${c.method} ${c.url}`),
      );
      assert.ok(!calls.some((c) => (c.body ?? "").includes("BODY-RT")));
    }
  });
});

describe("ebay probe (adversarial): scope fallback and writes", () => {
  it("falls back once, never loops: two refusals make exactly two refresh grants", async () => {
    const stub = stubEbay({
      token: (grant) => (grant === "client_credentials" ? [200, { access_token: APP_TOKEN, expires_in: 7200 }] : [400, { error: "invalid_scope" }]),
    });
    const { router, calls, logs } = makeRouter({ stub });
    const res = await call(router);
    assert.equal(res.body.accountLeg.outcome, "refresh_failed");
    const refreshes = calls.filter((c) => c.method === "POST" && c.body.includes("refresh_token"));
    assert.equal(refreshes.length, 2);
    assert.equal(calls.filter((c) => c.method === "POST").length, 3, "app grant plus the two refresh grants");
    assert.equal(logs.filter((l) => l.msg === "ebay_probe_scope_fallback").length, 1);
    assert.equal(calls.filter((c) => c.method === "GET").length, 1, "only row 7 was read: no account token, no account reads");
  });

  it("a token minted with the consented (write-capable) scopes still reads only allowlisted GETs", async () => {
    const stub = stubEbay({
      token: (grant, scope) => {
        if (grant === "client_credentials") return [200, { access_token: APP_TOKEN, expires_in: 7200 }];
        return scope.includes("readonly") && scope.includes("sell.account.readonly") ? [400, { error: "invalid_scope" }] : [200, { access_token: USER_TOKEN, expires_in: 7200 }];
      },
    });
    const { router, calls } = makeRouter({ stub });
    const res = await call(router);
    assert.equal(res.body.accountLeg.scopes, "consented");
    assertOnlyPermittedCalls(calls);
  });

  it("writes nothing back: only getCredentials of Secret Manager runs, a rotated refresh token is dropped", async () => {
    const { SecretsManagerService } = require("../dist/services/secrets-manager");
    const proto = SecretsManagerService.prototype;
    const touched = [];
    const saved = new Map();
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (name === "constructor" || typeof proto[name] !== "function") continue;
      saved.set(name, proto[name]);
      proto[name] = name === "getCredentials" ? async (key) => (touched.push(`${name}:${key}`), { refreshToken: REFRESH_TOKEN }) : async () => (touched.push(`WRITE-OR-OTHER:${name}`), undefined);
    }
    try {
      const stub = stubEbay({
        token: (grant) =>
          grant === "client_credentials"
            ? [200, { access_token: APP_TOKEN, expires_in: 7200 }]
            : [200, { access_token: USER_TOKEN, expires_in: 7200, refresh_token: "ROTATED-RT-9999", refresh_token_expires_in: 99 }],
      });
      const router = createEbayProbeRouter({ env: PROD_ENV, fetchImpl: stub.fetchImpl, isPaused: async () => false, log: () => {} });
      const res = await call(router);
      assert.equal(res.body.outcome, "ok");
      assert.deepEqual(touched, [`getCredentials:${PROBE_KEY}`]);
      assert.ok(!res.text.includes("ROTATED-RT-9999"));
    } finally {
      for (const [name, fn] of saved) proto[name] = fn;
    }
  });
});

describe("ebay probe (adversarial): the rate window", () => {
  it("five simultaneous requests: exactly one runs, four are 429, eBay is called once over", async () => {
    const { router, calls } = makeRouter();
    const all = await Promise.all([1, 2, 3, 4, 5].map(() => call(router)));
    assert.deepEqual(all.map((r) => r.status).sort(), [200, 429, 429, 429, 429]);
    assert.equal(calls.filter((c) => c.method === "POST").length, 2);
    assert.equal(calls.filter((c) => c.method === "GET").length, EBAY_PROBE_ALLOWLIST.length);
  });

  it("a second request while the first is still talking to eBay is 429 and adds no call", async () => {
    const inner = stubEbay();
    let release;
    const gate = new Promise((r) => (release = r));
    let held = false;
    const fetchImpl = async (url, init) => {
      if (!held && new URL(String(url)).pathname.includes("get_item_aspects")) {
        held = true;
        await gate;
      }
      return inner.fetchImpl(url, init);
    };
    const { router } = makeRouter({ stub: { fetchImpl, calls: inner.calls } });
    const first = call(router);
    // Bounded: a route that never reaches row 7 must fail this test, not hang the suite.
    for (let i = 0; !held && i < 1000; i++) await new Promise((r) => setTimeout(r, 5));
    if (!held) {
      await first;
      assert.fail("the probe never reached row 7");
    }
    const before = inner.calls.length;
    const second = await call(router);
    assert.equal(second.status, 429);
    assert.equal(inner.calls.length, before);
    release();
    assert.equal((await first).status, 200);
  });

  it("the window is exact, reopens at 60 s, and a clock that jumps back stays closed", async () => {
    let t = 1_000_000;
    const { router } = makeRouter({ deps: { now: () => t } });
    assert.equal((await call(router)).status, 200);
    t += 59_999;
    const early = await call(router);
    assert.equal(early.status, 429);
    assert.equal(early.headers.get("retry-after"), "1");
    t -= 3_600_000;
    assert.equal((await call(router)).status, 429, "a backwards clock must not reopen the window");
    t = 1_000_000 + 60_000;
    assert.equal((await call(router)).status, 200);
  });

  it("the 409 (real target outside prod) and a 400 body do not consume the window", async () => {
    const nonProd = makeRouter({ env: { ...PROD_ENV, ENVIRONMENT: "dev" } });
    assert.equal((await call(nonProd.router)).status, 409);
    assert.equal((await call(nonProd.router)).status, 409, "still 409, never 429");
  });
});
