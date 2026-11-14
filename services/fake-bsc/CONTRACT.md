# Fake BSC: shared contract (NEO-552)

A standing fake of BuySportsCards (BSC) that previews, worktree deployments and
dev call instead of the real site. It never contacts BSC. Catalogue reads are
replayed from recordings that a local recorder loads; everything else is
synthesised. This file is the contract every builder works to: change it here
first, then in code.

## Service

- `services/fake-bsc/`: Node 22, TypeScript, Express, `node --test`. Small
  image, no Chromium. Deployed on its own (never per PR), Cloud Run in the dev
  project, min 0 / max 1 instance.
- Recordings live in a private versioned GCS bucket and load into memory at
  start-up. They never go into any repo.

## Who may call it

1. Cloud Run IAM: no `allUsers`. Invokers are the dev Convex SA, the dev browser
   runtime SA, the dev CI deployer SA and `fake-bsc-loader`. Because the BSC
   API uses `Authorization: Bearer <bsc token>`, callers send their Google ID
   token in `X-Serverless-Authorization`.
2. The caller secret in the header `x-nb-fake-bsc-key` on every request
   (env `FAKE_BSC_CALLER_KEY` on the fake).
3. Admin endpoints (`/__fake/recordings`, `/__fake/drift-compare`,
   `/__fake/write-captures`, `/__fake/reset-all`) also need
   `x-nb-fake-bsc-admin-key` (env `FAKE_BSC_ADMIN_KEY`) AND a caller identity
   on `FAKE_BSC_ADMIN_CALLERS` (the loader SA and the dev deployer).
   Run-scoped endpoints (`/__fake/reset`, `/__fake/faults`, `/__fake/orders`)
   and `GET /__fake/misses?prefix=` (or `?ns=`) need only rules 1 and 2, so
   Convex can report its own preview's misses. Misses hold only catalogue
   request keys and bodies, which are public; a non-catalogue miss holds only
   its method and path template.
4. The fake checks the caller email against `FAKE_BSC_ALLOWED_CALLERS`, so a
   loosened IAM binding still fails closed.

## Paths

- BSC API, mirroring `api-prod` paths: `<FAKE>/api/<same path>`.
- BSC identity (Azure B2C), mirroring the real path shape:
  `<FAKE>/identity/<same path as the identity host>`.
- Test control: `<FAKE>/__fake/...`. Health: `<FAKE>/healthz`.

## Accounts and per-run isolation

- Sign-in username `nb+<convexSlug>-<userTag>@fake.invalid` is the namespace.
  `convexSlug` comes from the deployment's `CONVEX_CLOUD_URL`.
- Password `fake-bsc-password` signs in. `wrong-password` gets B2C's
  rejected-credentials answer, so that path stays testable.
- Tokens are opaque and map to their namespace. Seller id and store name are
  synthesised per namespace. All write state (listings, photos, orders,
  faults) is in memory per namespace.
- `POST /__fake/reset {ns}` or `{prefix}` clears state: listings, photos,
  orders, faults and misses. It never drops the namespace's tokens or
  sessions. The E2E seed reuses a stored BSC session that is still renewable
  rather than signing in again, and both resets run just before that seed
  (Convex `testing.resetMyTestState` per user, `e2e-baseline.sh reset` per
  deployment), so a reset that dropped tokens would turn the next BSC call
  into a 401 and a re-auth prompt. Only `/__fake/reset-all` may drop them.

## Recorded vs synthesised

| Endpoint | Treatment |
|---|---|
| POST `search/bulk-upload/filters`, POST `search/bulk-upload/results`, GET `marketplace/card/:id/card-listing` | Recorded (field allowlist) |
| GET `marketplace/user/profile` | Synthesised per namespace |
| POST `seller/bulk-upload/results` | Synthesised from the recorded catalogue results for the same filters, overlaid with the namespace's listings |
| PUT `seller/bulk-upload`, POST attachment | Synthesised from state; response shapes come from write captures |
| POST `seller/order/history`, GET `seller/order/:id` | Synthesised; empty plus orders injected with `/__fake/orders` |
| Identity endpoints | Synthesised (PKCE S256, lenient refresh rotation, SSO cookie; stateless tokens) |

- Request key: method + path + sorted query + canonical JSON body (keys sorted
  recursively), hashed. Headers ignored. One shared module,
  `src/requestKey.ts`, used by the server and the recorder.
- Field allowlist: `src/sanitise.ts`, shared by server and recorder, field
  names only. The server re-applies it on upload. Each recording carries the
  allowlist version; bumping it turns older recordings back into misses.
- An unrecorded request answers 501 with header `x-nb-fake: unrecorded` and is
  added to the namespace's miss list. Never forwarded anywhere.

## Faults

`POST /__fake/faults {ns, rules:[{match:{method, pathTemplate, cardId?},
kind: "429"|"503"|"delay"|"hang"|"reset", delayMs?, retryAfterS?, times?,
ttlS?}]}`. Default TTL 10 minutes. Replaces
`NEONBINDER_TEST_BSC_STALL_CARD_IDS`.

## Recorder (`services/fake-bsc/recorder/`)

- Jason runs it. Credentials come from Bitwarden at run time and are never
  written anywhere. Tokens stay in process memory.
- Sign-in uses `bscPasswordSignIn()` from `services/browser`.
- To-do list: `GET /__fake/misses?prefix=` as the loader SA. Only the three
  catalogue endpoints are fetched; anything else is listed as "needs a fake
  model".
- At most 1 request a second, 300 per session, and it stops on the first 429,
  5xx, timeout or 401 with no retry.
- Uploads with `POST /__fake/recordings`; auto-promoted.
- `--watch --prefix` long-polls the miss list during a local E2E run.

### Write capture (Jason, 2026-11-14)

Seller writes get no real test before prod. Instead, whenever a PR adds or
changes a BSC write (listing PUT, photo upload, any new write), Jason performs
that write once locally against real BSC and the recorder captures it:
`recorder capture-write`. It sends exactly one write request, stores only the
response's status and shape (key paths and types, no values) through
`POST /__fake/write-captures`, and the fake's synthesis is checked against
that shape in its tests. This happens before the PR is pushed to CI.

## App seams

- Convex: `apps/web/convex/lib/bscHttp.ts` exports `bscApiBase(env)` and
  `bscFetch()`. It returns the fake base only when
  `NEONBINDER_BSC_API_BASE` is set AND `TESTING_RESET_SECRET` is set AND the
  URL is https on `*.run.app`; otherwise the real host. Fake mode adds
  `x-nb-fake-bsc-key` from `NEONBINDER_FAKE_BSC_KEY` and the Google ID token.
  No other file may name a BSC host.
- Browser service: `services/browser/src/bsc-endpoints.ts` resolves the API
  base and identity authority from `NEONBINDER_FAKE_BSC_URL`. If that is set
  while `ENVIRONMENT=prod`, the process refuses to boot. `/health` reports
  `bscTarget: "real" | "fake"`. As built: authority
  `<FAKE>/identity/identity.buysportscards.com/b2c_1a_signin`, API base
  `<FAKE>/api`; the B2C `redirect_uri` stays the real SPA's (never fetched;
  the fake echoes whatever the authorize carried). Every request to the fake
  (identity and API) goes through `src/bsc-fetch.ts`, which adds
  `x-nb-fake-bsc-key` from `NEONBINDER_FAKE_BSC_KEY` and, on https only,
  `X-Serverless-Authorization: Bearer <ID token>` (runtime SA via ADC,
  audience = the fake's origin). Plain http is allowed only on loopback.
  `bscFetch` also holds a 429 breaker: process-wide against real BSC, per
  credential key against the fake.

## BSC call breaker (`bscFetch`)

Every BSC API call from Convex goes through `bscFetch`. It checks one
deployment-wide breaker before each call. It opens the breaker on any 429
(honouring `Retry-After`) or on a run of 5xx or timeouts on any endpoint, and
enforces a per-deployment token bucket. A 429 is never retried.

As built (`apps/web/convex/bscCallGate.ts`, policy in
`convex/lib/bscCallGatePolicy.ts`, one `marketplaceCallGates` row):

- Bucket: 60 a minute, burst 10 against BuySportsCards; 600 a minute, burst
  20 against the fake. A wave acquires up to 10 at once; a wait over 15 s is
  refused (`throttled`) and writes nothing.
- 429 ladder unchanged from PR 451 (15 s doubling to 120 s, or Retry-After up
  to 10 min; streak resets after 15 min). Failure ladder: 5 failures in a run
  (a run resets after 5 min idle) open it for 30 s doubling to 300 s.
- Failures: 5xx, timeouts, network errors, and a 403 on the three catalogue
  reads (filters, results, card-listing). Not failures: other 4xx, and the
  fake's 501 `x-nb-fake: unrecorded`.
- Half-open: after a window, one probe is granted, under a lease of 120 s
  (longer than the longest per-attempt timeout, the seller sheet's 90 s);
  everyone else is refused `probing`. The probe's success closes it; its
  failure re-opens it, escalated.
- A refusal sends nothing: `bscFetch` answers 429 with `Retry-After` and
  `x-nb-bsc-breaker: open|probing|throttled`, or 503 with
  `x-nb-bsc-breaker: gate_unavailable` when the gate itself cannot be read
  (fail closed).
- `bscCallGate:clearForTesting` (internal, refused without
  `TESTING_RESET_SECRET`) clears the row, for the breaker fault specs'
  teardown. The Set Builder reset clears it first.

## Module seams inside the fake (agreed between builders)

### Namespace (`src/namespace.ts`, owned by the server builder)

- `namespaceFromUsername(username: string): string | null`: the namespace is
  the part between `nb+` and `@fake.invalid`, lower-cased, matching
  `^[a-z0-9][a-z0-9-]{0,99}$` (so `<convexSlug>-<userTag>`). Anything else is
  null and the sign-in is refused.
- `matchesSelector(ns, {ns?, prefix?})`: exact namespace, or `startsWith`.
  Callers resetting a whole deployment pass `prefix: "<convexSlug>-"` (with
  the dash, so one slug never matches another that starts with it).

### Identity (`src/identity/index.ts`, owned by the identity builder)

The server imports exactly these and nothing else from `src/identity/`:

```ts
import type { Router } from "express";
/** Mounted at `/identity`, behind the same auth + faults middleware as `/api`. */
export const identityRouter: Router;
/** The namespace of a live (unexpired) access token this fake issued, else null. */
export function namespaceForToken(accessToken: string): string | null;
/** Optional: drop sessions/tokens for `/__fake/reset-all` only ({} = all); never on `/__fake/reset`. */
export function resetIdentity(sel: { ns?: string; prefix?: string }): void;
```

As built (identity builder):

- `namespaceForToken` also accepts a whole `Bearer <token>` value, and gives
  null for a refresh token, an id token, an expired or a revoked token.
- `resetIdentity(sel)` revokes every access token, refresh token, auth code
  and SSO cookie issued to the selected namespaces before the call, and drops
  their sign-in pages. Revocations live in memory (a restart forgets them; the
  tokens then run out on their own clocks).
- Extra exports, not needed by the server: `configureIdentity({tokenSecret?,
  now?, namespaceFromUsername?, log?})` replaces the singleton (tests), and `createFakeIdentity` (the pure core in
  `src/identity/b2c.ts`, which services/browser's contract test loads).
- The Router parses its own urlencoded bodies; no body parser is needed in
  front of it (a `{}` left by an upstream parser is fine).
- Behaviour: `fake-bsc-password` signs in; any other password (`wrong-password`
  included) or a username `namespaceFromUsername` rejects gets HTTP 200
  `{"status":"400","message":"Your password is incorrect."}`, never echoing the
  username. A bad SelfAsserted transaction or csrf is HTTP 400 plain text (an
  integration fault, not a rejection). Authorize needs `response_type=code`
  and S256 PKCE; `prompt=login|select_account` always serves the form; no
  prompt plus a live `x-ms-cpim-sso:fake-bsc_0` cookie answers 302
  `#state=&code=` and re-issues the cookie (Max-Age 62 days, sliding);
  `prompt=none` without one answers `#error=interaction_required`.
  `/confirmed?rememberMe=true` sets that cookie. Codes last 5 minutes and are
  bound to client_id, redirect_uri and the PKCE challenge; single use is best
  effort (per instance, until a restart). Token
  answers carry `expires_in: 3600` and `refresh_token_expires_in` counting
  down from 86400 from the sign-in (password or silent) that opened the window;
  the refresh grant always returns a new refresh token (same absolute window,
  rotation counter + 1) but is lenient: any unexpired, validly sealed refresh
  token for the client is accepted, including one already rotated. Replay
  protection is not a goal of a test fake.
- Stateless, because the fake runs min 0 / max 1 instances and restarts after
  every idle gap. Access tokens, refresh tokens, auth codes and SSO cookies
  are sealed payloads `{kind, ns, exp, iat, rot?, client, scope, ...}`:
  AES-256-GCM (its auth tag is the MAC that is verified) under an HKDF key
  derived from `FAKE_BSC_ADMIN_KEY`. `namespaceForToken` verifies and decodes;
  nothing is looked up, so a session the seed stored in Convex and the browser
  service survives any number of restarts. The admin key, not the caller key,
  because Convex and the browser service hold the caller key and must not be
  able to mint tokens. No new secret: rotating `FAKE_BSC_ADMIN_KEY` signs
  every fake session out (re-seed). Without the variable (local tests only;
  config refuses to boot without it) the key is random per process. Only the
  sign-in page's transaction (minutes long), the best-effort spent-code set
  and the reset revocations live in memory.

The server reads the BSC token from `Authorization: Bearer <token>` and
answers 401 on a seller or catalogue endpoint when `namespaceForToken` gives
null. `card-listing` is public on real BSC, so it needs no BSC token; a
request without one is namespaced by the optional header `x-nb-fake-ns` when
present (a fault or miss with no namespace otherwise matches every
namespace's rules that name its `cardId`).

Convex (`bscFetch`, fake mode only, never in real mode) sends `x-nb-fake-ns`
on a request with no BSC token: the caller's namespace
(`fakeBscNamespaceFor`) when the action runs as a signed-in user (a fetch-time
team lookup), else the deployment prefix `<convexSlug>-`
(`fakeBscPrefixFor`), for the background team lane, which has no user. Both
match `^[a-z0-9][a-z0-9-]{0,99}$`. **Server side (done):** a value ending in
`-` is a prefix, not a namespace: its faults are the card-scoped rules of
every namespace under that prefix (rules without a `cardId` never apply), and
its misses are recorded under the prefix. A miss read includes a prefix's list
when the selection overlaps it (`?ns=` under the prefix, or a `?prefix=`
inside it or containing it); such an entry carries `ns: null` and
`prefix: "<prefix>"`. `POST /__fake/reset {prefix}` clears the prefix lists
inside the selection; `{ns}` leaves them. The value is read strictly
(`readHeaderScope` in `src/namespace.ts`): the whole value must match the
pattern above and a prefix must be at least 3 characters, like a `{prefix}`
selector; anything else is read as no header. A BSC token always wins over the
header.

### Test controls from Convex (`apps/web/convex/testing.ts` → `fakeBsc.ts`)

`testing.ts` derives every namespace itself (`<convexSlug>-<userTag>`, the
tag being 12 hex digits of a hash of the Clerk subject) and calls these
internal actions in `apps/web/convex/fakeBsc.ts`, which send them on to the
fake's run-scoped endpoints unchanged:

```ts
internal.fakeBsc.resetNamespace({ ns: string })                 // POST /__fake/reset {ns}
internal.fakeBsc.resetPrefix({ prefix: string })                // POST /__fake/reset {prefix}, "<convexSlug>-"
internal.fakeBsc.setFaults({ ns: string, rules: FaultRule[] })  // POST /__fake/faults {ns, rules}
internal.fakeBsc.addOrder({ ns: string, order: FakeOrder })     // POST /__fake/orders {ns, order}
```

`FaultRule` is the shape under "Faults"; `testing.ts` has already bounded it
(1-20 rules, `pathTemplate` a plain BSC path template, `delayMs` <= 120000,
`ttlS` <= 3600, `times` 1-1000). `FakeOrder` is NB-side vocabulary that the
fake renders into BSC's order wire shape (what `convex/lib/bscOrders.ts`
parses: `orderId` synthesised, `orderNo`, `orderStatus`, `orderDate`,
`orderItems[].{card.id, cardId, condition, orderQuantity, price (dollars),
sellerSku, productType: "raw"}`):

```ts
type FakeOrder = {
  orderNo?: string;        // default: synthesised
  status?: string;         // default "READY_TO_SHIP"
  orderDateMs?: number;    // default: the fake's clock
  items: Array<{ cardId: string; condition: string; quantity: number; priceCents?: number; sellerSku?: string }>; // 1-50
};
```

`POST /__fake/orders` takes `{ns, order}` (or `{ns, orders: [...]}`, 1-20) and
answers `{ok: true, orderId (when one order), orderIds: string[], orders:
[{orderId, orderNo, status, items: [{cardId, condition, quantity, priceCents,
sellerSku}]}]}`. A selling status (anything but `CANCELLED` and unknown
statuses) lowers the namespace's matching listing by the quantity, as BSC
does; the price defaults to the listing's price, else 25 cents.

### Recorder sign-in (`services/browser`, owned by the browser builder)

As built in `services/browser/src/bsc-signin.ts` (the recorder codes to this):

```ts
export async function bscPasswordSignIn(input: {
  username: string;
  password: string;
  authority?: string;              // default: resolveBscEndpoints(fetchOptions.env).authority
  onStep?: (step: BscSignInStep) => void;
  fetchOptions?: BscFetchOptions;  // { env?, scope?, endpoints?, mintIdToken?, now? }
  stepTimeoutMs?: number;
}): Promise<{ tokens: BscTokenSet } | { error: string; diagnostic?: LoginDiagnostic; credentialRejected?: boolean }>;
// BscTokenSet: { token, expiresAt /* epoch ms */, refreshToken?, refreshExpiresAt?, ssoCookies?, ssoExpiresAt? }
```

The recorder loads the compiled modules at run time from
`services/browser/dist/` (`bsc-signin.js`, and `bsc-endpoints.js` for
`resolveBscEndpoints` and `bscApiHeaders`), so `services/browser` must be
built first (`npm ci && npm run build` there). It passes
`fetchOptions: {env: {}}` and the real endpoints, so a fake URL in the
operator's shell can never redirect a recording, and it never names a BSC
host itself. It never bundles or copies the browser source.

## Auth details (server builder)

- Cloud Run verifies `X-Serverless-Authorization` and removes the token's
  signature before the container sees it ("This removes the signature before
  passing the token to the user container"). The fake therefore:
  - with a signed token (three non-empty parts): verifies it itself with
    google-auth-library against `FAKE_BSC_AUDIENCE`;
  - with an unsigned token: accepts it only when `K_SERVICE` is set (Cloud
    Run already verified it, audience included), and still checks `iss`,
    `exp`, `email_verified` and, when `FAKE_BSC_AUDIENCE` is set, `aud`;
  - anything else is 401. `FAKE_BSC_AUDIENCE` (the service URL) is optional
    on Cloud Run and required for a signed token (local runs).
- The fake refuses to boot when `ENVIRONMENT=prod`.
- Not yet confirmed on a deployed revision: that `Authorization` (the BSC
  token) reaches the container untouched when `X-Serverless-Authorization`
  is also sent. The doc says only that `X-Serverless-Authorization` is the
  one checked. The first deploy must confirm it (a profile read through the
  fake proves it).
- `FAKE_BSC_LOCAL_DEV_BYPASS=1` skips the ID-token check only (keys are
  still required); the server refuses to boot with it when `K_SERVICE` is set.
- `/healthz` needs the ID token and caller key like the rest (Cloud Run's
  default TCP startup probe needs no route). It answers `{ok, instanceId,
  revision, manifestVersion, allowlistVersion, recordings}`.

## Storage layout (bucket or local directory)

- `manifest.json`: `{schema:1, version, allowlistVersion, updatedAt,
  entries: {<key>: {object, pathTemplate, recordedAt}}}`. Each upload writes
  the recording objects, then `manifests/<version>.json` and a new
  `manifest.json` (GCS generation precondition), and swaps the in-memory
  catalogue: auto-promoted.
- `recordings/v<allowlistVersion>/<key>.json`: `{key, allowlistVersion,
  request:{method,path,query,body}, response:{status, body}, recordedAt}`.
- `write-captures/<endpoint slug>.json`: the latest capture per write endpoint.
- Recordings of another allowlist version, or whose key does not recompute,
  are skipped at boot and logged as a count.

## Probe, drift and ops wiring (devops, NEO-552)

Added by the devops builder; the workflows and Terraform are built to this.

### Browser service `POST /probe/bsc` (IAM-gated like every route)

Built in `services/browser/src/routes/bsc-probe.ts`.

- Body: `{username, password}` is read ONLY when `bscTarget` is `fake` (CI sends
  `nb+probe-ci@fake.invalid` / `fake-bsc-password`; an empty body uses that
  same pair). When `real`, the body is ignored and the service signs in with
  the stored canary account in Secret Manager (the one the 30-minute login
  canary uses); no BSC credential is ever sent from CI. A `real` probe outside
  `ENVIRONMENT=prod` answers 409 and calls nobody.
- It runs: a fresh B2C password sign-in (never the cached token), then the
  pinned reads in order: `search/bulk-upload/filters`, `search/bulk-upload/results`,
  `marketplace/card/:id/card-listing`, `marketplace/user/profile`,
  `seller/bulk-upload/results` (one facet), `seller/order/history` page 1.
  Each body is checked by the same acceptance the production parser needs.
  Request bodies are exactly what Convex sends for the same call. It stops at
  the first `bsc_unavailable` read. Always HTTP 200 when it ran.
- Not run: 409 (real target outside prod), 429 + `Retry-After` (at most one
  probe a minute per process), 400 (half a credential pair on the fake).
- Response: `{ bscTarget: "real"|"fake", outcome, signIn: {ok}, catalogue: {ok,
  status}, parser: {ok}, shapes, requests, steps, durationMs, detail? }`.
  - `outcome` is one of `ok`, `skipped_paused` (real target, BSC paused via
    `NEONBINDER_PAUSED_PLATFORMS`: no call was made; the verdict passes with a
    warning), `signin_failed`, `bsc_unavailable` (429, 5xx, timeout or network,
    in sign-in or any read), `catalogue_non_2xx`, `parser_rejected`. The
    `catalogue` leg covers every pinned read, seller reads included: the first
    failing read decides `outcome`, `catalogue.status` is its status (the
    filters status when all pass), and `detail` names the step.
  - `shapes` maps the endpoint's path template (the keys listed above) to
    `{<key.path>: <type>}`: paths without the `$.` root (`results[].orderId`;
    the root is `$`), arrays collapsed to `[]`, id-like or non-identifier map
    keys collapsed to `{*}`, unions as `number|null`. Key paths and types only,
    never values. Sign-in shapes are NOT in `shapes` (the fake's identity is
    synthesised); they appear only as step verdicts.
  - `requests` maps each catalogue template to its canonical request
    `{method, path, query, body}` (keys sorted recursively), the input to
    `src/requestKey.ts`, so drift-compare can find the recording it compares.
    The drift workflow forwards `{shapes, requests}` (decided, NEO-552).
  - `steps`: `[{step, status, ms, parsed, failure?}]` for `sign_in.authorize`,
    `sign_in.self_asserted`, `sign_in.confirmed`, `sign_in.token` and each read.
  - `detail` carries no secret or response data.
- `GET /health` includes `bscTarget`. `.github/scripts/bsc-probe-verdict.sh`
  judges both and is the single definition of pass.
- Env the browser service reads on a fake revision: `NEONBINDER_FAKE_BSC_URL`
  (the fake's origin) and `NEONBINDER_FAKE_BSC_KEY` (the caller key, mounted
  from Secret Manager `fake-bsc-caller-key`). Never set on prod: a process
  with `NEONBINDER_FAKE_BSC_URL` set and `ENVIRONMENT=prod` refuses to boot.

### Fake `POST /__fake/drift-compare` (admin)

- Body `{shapes, requests}` as above (both from the prod probe; `requests`
  maps each catalogue template to its canonical request, so the fake finds the
  matching recording). Response `{outcome: "ok"|"shape_drift", paths: [...]}`
  (`paths` = key paths that differ). Caller: the dev CI deployer, daily.
- As built (server builder): the response is `{outcome, paths, endpoints:
  [{endpoint, verdict, paths}]}`. `outcome` may also be
  `"unrecorded pinned key"` (a pinned request has no recording, or an
  endpoint has no recordings at all): the fake cannot judge it, so the
  verdict script should treat it as a warning, not a pass. Top-level `paths`
  are `"<endpoint> <key.path>"`. Recorded endpoints compare allowlisted paths
  only; `marketplace/user/profile`, `seller/bulk-upload/results` and
  `seller/order/history` compare the paths NB's parsers read against the
  synthesis; any other key is `not_compared`. The probe dialect (`$` root,
  `[]`, `{*}`, `a|b` unions) is read as described above; a `{*}` path is
  ignored. A path missing from the probe is drift only when its parent is
  present, and never for an array's items.

### Fake service environment (set by Terraform)

`FAKE_BSC_CALLER_KEY`, `FAKE_BSC_ADMIN_KEY` (Secret Manager; the admin key
also keys the identity's sealed tokens, so it must be stable across
revisions),
`FAKE_BSC_ALLOWED_CALLERS`, `FAKE_BSC_ADMIN_CALLERS` (comma-separated SA
emails), `FAKE_BSC_BUCKET` (recordings bucket name), `ENVIRONMENT`. Listens on
`PORT` (8080). `GET /healthz` needs the ID token and caller key like the rest.

### Convex internal action for CI

`fakeBsc:reportMisses` (internal action, no args) returns
`{ok: true, skipped, misses: [{method, path}]}` for this deployment's
namespace prefix, read from the fake (`skipped: true`, no misses, outside fake
mode), or `{ok: false, status?, error}` when the fake could not be read.
CI calls it with the preview deploy key so no admin key is on the runner.
Resolved (coordinator, 2026-11-14): `GET /__fake/misses?prefix=` needs only
rules 1 and 2 (see "Who may call it").
