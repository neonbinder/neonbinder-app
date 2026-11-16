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
   token in `X-Serverless-Authorization` (for IAM), and the same signed
   token again, bare, in `x-nb-fake-id-token` (for rule 4).
2. The caller secret in the header `x-nb-fake-bsc-key` on every request
   (env `FAKE_BSC_CALLER_KEY` on the fake).
3. Admin endpoints (`/__fake/recordings`, `/__fake/drift-compare`,
   `/__fake/write-captures`, `/__fake/reset-all`, and `GET
   /__fake/misses?all=1`, every owner's misses at once) also need
   `x-nb-fake-bsc-admin-key` (env `FAKE_BSC_ADMIN_KEY`) AND a caller identity
   on `FAKE_BSC_ADMIN_CALLERS` (the loader SA and the dev deployer).
   Run-scoped endpoints (`/__fake/reset`, `/__fake/faults`, `/__fake/orders`)
   and `GET /__fake/misses?prefix=` (or `?ns=`) need only rules 1 and 2, so
   Convex can report its own preview's misses. Misses hold only catalogue
   request keys and bodies, which are public; a non-catalogue miss holds only
   its method and path template.
4. The fake verifies the signature of the token in `x-nb-fake-id-token`
   itself (google-auth-library, audience `FAKE_BSC_AUDIENCE`) and checks
   that verified email against `FAKE_BSC_ALLOWED_CALLERS`, so a loosened IAM
   binding (or an `allUsers` grant) still fails closed. It never reads
   `X-Serverless-Authorization`: Cloud Run strips its signature, so its
   claims are forgeable the moment IAM stops checking it.

## Paths

- BSC API, mirroring `api-prod` paths: `<FAKE>/api/<same path>`.
- BSC identity (Azure B2C), mirroring the real path shape:
  `<FAKE>/identity/<same path as the identity host>`.
- Test control: `<FAKE>/__fake/...`. Health: `<FAKE>/__fake/health` (never `/healthz`: Cloud Run reserves paths ending in `z` and answers 404 before the container sees them).

## Accounts and per-run isolation

- Sign-in username `nb+<convexSlug>-<userTag>@fake.invalid` is the namespace.
  `convexSlug` comes from the deployment's `CONVEX_CLOUD_URL`.
- Password `fake-bsc-password` signs in. `wrong-password` gets B2C's
  rejected-credentials answer, so that path stays testable.
- Tokens are opaque and map to their namespace. Seller id and store name are
  synthesised per namespace. All write state (listings, photos, orders,
  faults) is in memory per namespace.
- `POST /__fake/reset {ns}` or `{prefix}` clears state: listings, photos,
  orders, faults and `needs-model` misses. It keeps catalogue misses: they are
  the recorder's to-do list, change no answer, and leave only when their
  recording is stored (`POST /__fake/recordings`), on `/__fake/reset-all`,
  past the list caps, or 30 days after they were first seen. Most survive a
  restart too (see "Durable misses"). It never drops the
  namespace's tokens or sessions. The E2E seed reuses a stored BSC session that is still renewable
  rather than signing in again, and both resets run just before that seed
  (Convex `testing.resetMyTestState` per user, `e2e-baseline.sh reset` per
  deployment), so a reset that dropped tokens would turn the next BSC call
  into a 401 and a re-auth prompt. Only `/__fake/reset-all` may drop them.
- **Saved sessions are per deployment too.** The browser service stores a
  BSC session in Secret Manager under the key Convex names (`credKey`,
  `apps/web/convex/credentials.ts`). In fake mode that key is
  `buysportscards-credentials-fake-<convexSlug>-<clerkUserId>`
  (`fakeBscCredentialKeyFor`, `apps/web/convex/testing.ts`), so deployments
  sharing a Clerk test user keep separate sessions. On the real BSC
  (production included) it stays the bare `buysportscards-credentials-<clerkUserId>`;
  SportLots, eBay and EasyPost keys never change. The browser service treats
  the key as opaque under its `KEY_PATTERN`, so this needs no contract bump.
- **TTL.** The browser service gives a `-credentials-fake-` secret an absolute
  `expireTime` of now + 72 h when it creates it and again on every write
  (`updateSecret` with the `expire_time` mask, not `ttl`), the backstop for a
  run that never cleans up (Secret Manager bills per active version, and
  previews and worktrees are many).
- **The browser service checks the key and the account.** Its
  `validateKeyFormat` refuses a `-credentials-fake-` key on a real-mode
  revision, or for any site but `buysportscards` (400, logged
  `credential_key_refused`). On a fake revision, a BSC sign-in or
  stored-session renewal whose username does not match
  `^nb\+[a-z0-9-]{1,100}@fake\.invalid$` is refused (422,
  `error_class: "invalid_credentials"`), so no real BSC account is ever sent
  to the fake.
- **Two guards.** (1) Convex, in fake mode, sends no BSC credential call
  (`/login/bsc`, or any `/credentials/*` call naming a BSC key) unless the
  browser service's cached `/health` reports `bscTarget: "fake"`; a revision
  without the field is refused too, and the refusal logs
  `fake_bsc_browser_not_fake`. (2) The namespace check: a stored session whose
  username is not this deployment's own fake account is refused
  (`fake_bsc_namespace_clash`); re-seeding the user repairs it.
- **Cleanup.** After both E2E passes, `e2e.yml` (the `e2e` job, `if: always()`)
  runs the internal action `credentials:deleteFakeBscSessionsFromCli` with the
  preview deploy key. It deletes, through `DELETE /credentials/:key`, the fake
  key of every user on the deployment, only keys with this deployment's own
  `buysportscards-credentials-fake-<convexSlug>-` prefix, clears their BSC
  flag, and reports counts. Outside fake mode it deletes nothing. A failure
  only warns; the TTL removes what is left.

## Recorded vs synthesised

| Endpoint | Treatment |
|---|---|
| POST `search/bulk-upload/filters`, POST `search/bulk-upload/results`, GET `marketplace/card/:id/card-listing` | Recorded (field allowlist) |
| GET `marketplace/user/profile` | Synthesised per namespace |
| POST `seller/bulk-upload/results` | Synthesised from the recorded catalogue results for the same filters, overlaid with the namespace's listings; answered as `{results: [...rows]}`, the form real BSC sends (see "The seller sheet") |
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
  added to the namespace's miss list. Never forwarded anywhere. It stays
  listed until its recording is stored (see the reset above).

### The seller sheet (`POST seller/bulk-upload/results`)

Real BSC answers `{results: [...]}` (the daily drift probe, 2026-11). The fake
answers the same, so every spec exercises the branch production takes in
`readBscSellerSheet` (`apps/web/convex/adapters/bscSeller.ts`, which still
also reads a bare array).

- Every row: `productId`, `productType`, `cardId`, `price` (a dollar string),
  `condition`, `availableQuantity`, `active`, `sellerId`, `updatedTimestamp`,
  `card` (`id`, `cardNo`, and the recorded card fields).
- A blank row (no listing for that card and condition, and every row of a
  `""`/`"all"` read) has **no** `sellerSku`, `sellerImgFront` or
  `sellerImgBack` key at all: the probe of an account with no listings shows
  them absent, not null.
- A listed row carries all three: `sellerSku` as the PUT stored it, and the
  stored image paths or BSC's default-image strings (`/Images/DefaultFront.gif`,
  `/Images/DefaultBack.gif`) when the listing has no photo, as the PUT write
  capture shows.
- NB narrows absent, null and `Default…` the same (`bscSheetPlan.ts`
  `narrowBscSheetRow`, `rowNeedsSellerPhoto`; `listingDrain.ts`), so dropping
  the keys changes no NB behaviour. The probe's read-path list
  (`READ_PATHS` in `src/drift.ts`, `SHAPE_PATHS` in services/browser) is
  unchanged: no browser-service change and no contract bump.

### Durable misses

Catalogue misses are the recorder's to-do list, and the fake scales to zero,
so the ones the recorder could replay are also kept in the recordings bucket.

- **What is kept:** only a `catalogue` miss whose request passes the
  recorder's replay allowlist (`src/replayAllowlist.ts`, re-exported by
  `recorder/replay-allowlist.ts`: facet slugs or a hex card id, at most 4 KB).
  `needs-model` misses and refused requests stay in memory only.
- **Object:** one per (owner, request key):
  `misses/v<allowlistVersion>/ns/<ns>/<key>.json`,
  `misses/v<allowlistVersion>/prefix/<prefix>/<key>.json` or
  `misses/v<allowlistVersion>/anon/<key>.json`, holding `{schema: 1,
  allowlistVersion, owner: {ns}|{prefix}|null, key, endpoint, method, path,
  request: {method, path, query, body}, firstSeen}`. No count, no near miss,
  no header, nothing else from the request.
- **Write once:** the first miss of a key for an owner creates its object
  (create-only precondition); repeats change only the in-memory count. The
  write is awaited inside the 501 (Cloud Run throttles CPU outside a
  request), bounded at 2 s. The 501 waits for that miss's own write only,
  never for other persistence work (a reset-all, a TTL sweep). A failed or
  slow write is logged (`miss_persist_failed`, with the error class and
  timing only) and the answer is still the 501, never a 5xx.
- **Create rate:** any caller-key holder can miss a new allowlisted key, so
  creates are rate limited: a process-wide token bucket of 60 a minute
  (burst 60) and, inside it, 20 a minute per owner (namespace, prefix or
  anonymous). Over either limit the miss stays in memory only (a later miss
  of the key tries again) and the fake logs `miss_persist_skipped` with
  `reason: "rate"`, the scope that refused it and a count, at most once a
  minute. The 501 is unchanged. A repeat of a key that is not kept (refused
  by the rate, or its write failed) asks again, spending a token only if it
  is then written; a repeat of a kept key makes no store call.
- **Bounds:** 30 days from `firstSeen` (memory and bucket); 2,000 objects in
  all (past it, the oldest object is removed, and that miss stays listed in
  memory until a restart); the existing 500 per owner (an evicted miss's
  object is removed too).
- **Removal:** when a recording for the key is stored (every owner's object),
  on `/__fake/reset-all` (every object under `misses/`), at the TTL, on
  per-owner eviction, and at boot for any object under an older allowlist
  version or one that fails validation. An object under a NEWER allowlist
  version belongs to a newer revision (overlapping revisions, or a rollback):
  a restore neither restores nor deletes it; only `/__fake/reset-all` sweeps
  it. After a permanent rollback to an older version those objects stay
  until someone runs `/__fake/reset-all`. `/__fake/reset` keeps them, as it
  keeps the in-memory catalogue misses. Namespace eviction (past 2,000
  namespaces) drops only the in-memory list; the objects come back at the
  next boot.
- **Generation-specific deletes:** the bucket is versioned, and a plain delete
  would leave a noncurrent version the lifecycle rule never reaps, so every
  delete names the object's generation. No Terraform change, no new spend.
- **Boot:** after the recordings and write captures load, misses are restored
  on their own promise (expired and invalid objects are deleted as they are
  read). `/api` is not held for it; `GET /__fake/misses` is held until both
  loads finish (same 25 s cap, then 503 `x-nb-fake: loading`). The two admin
  writes that remove misses in bulk, `POST /__fake/recordings` and `POST
  /__fake/reset-all`, are held the same way (after the admin check) until the
  restore is done: run during it, the restore would put back a miss they had
  just removed (one it read before the recording was stored, or before
  reset-all deleted its object). A failed
  restore is logged (`misses_restore_failed`) and the fake carries on with
  what it has. A restored miss has `count: 1` and `lastSeen = firstSeen`.
- **Every owner at once:** `GET /__fake/misses?all=1` (admin, 403 without the
  admin key and an admin caller) lists every namespace's, prefix's and
  anonymous miss, so a later session needs no slug of a preview that is gone.
  It lists only the misses the recorder would replay (catalogue misses its
  replay allowlist accepts, anonymous ones included); needs-model and refused
  misses are left out so they can never fill the page, and a later session
  always makes progress (`?ns=`/`?prefix=` reads still list everything). It
  answers at most 2,000 entries, the oldest first (selected without copying
  the whole list), and `truncated: true` when more matched (`truncated:
  false` otherwise; `?ns=`/`?prefix=` reads carry no such field). Any other
  `all` value is a 400.

## Faults

`POST /__fake/faults {ns, rules:[{match:{method, pathTemplate, cardId?},
kind: "429"|"503"|"delay"|"hang"|"reset", delayMs?, retryAfterS?, times?,
ttlS?}]}`. Default TTL 10 minutes. Replaces
`NEONBINDER_TEST_BSC_STALL_CARD_IDS`. A `hang` holds the socket for at most
2 minutes. Held sockets are capped per scope (namespace, prefix, or no
namespace): 4 in a `hang`, 24 in a `delay` (`bscFault.slow` delays
card-listing in waves of 10 per namespace, and a 503 there would count as a
BSC failure). Hangs and delays together are capped at 64 for the whole
process, since a caller picks its own scope. Past any cap the request answers
503 at once.

Request bodies are limited to what NB's BSC traffic needs: 2 MB for
`PUT seller/bulk-upload` (100 rows of at most 16 KB, `bscSheetPlan.ts`),
64 KB for every other JSON body, 4 MB for the photo upload (photos are at most
3 MB, `copyPhotos.ts`); 413 past them.

## Recorder (`services/fake-bsc/recorder/`)

- Jason runs it. Credentials come from Bitwarden at run time and are never
  written anywhere. Tokens stay in process memory.
- Sign-in uses `bscPasswordSignIn()` from `services/browser`.
- To-do list: `GET /__fake/misses?prefix=` as the loader SA. Only the three
  catalogue endpoints are fetched; anything else is listed as "needs a fake
  model".
- The miss list is written by any caller-key holder, so before anything is
  sent each miss passes a request-side allowlist (`src/replayAllowlist.ts`):
  filters `{filters}` and results `{filters, condition?, page?, size?, sort?}`
  only, `filters` holding only `sport|year|setName|variant|variantName` as
  1-50 slugs (`^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$`), `condition` `"all"`,
  `sort` `"default"`, `page` 0-100, `size` 1-5000, at most 4 KB; no query
  string on any of them; card-listing ids hex only (8-64). A refused miss is
  never sent and is reported by reason, endpoint and key prefix, never value.
- Anonymous misses (no namespace and no prefix) are left alone unless
  `--include-anon`.
- `--all` in place of `--prefix` reads every owner's misses through the
  admin-only `GET /__fake/misses?all=1`, for a session whose preview is gone.
  The same allowlist, `--include-anon` rule and typed confirmation apply. With
  `--yes` (no one reads the plan) `--all` also needs `--max N`, or the
  recorder refuses to start. When the fake answers `truncated: true` the
  recorder says so once; a later session reaches the rest.
- Before any credential is read or BSC contacted, it prints every request it
  will send (endpoint and facet slugs, or the hex card id) and needs the word
  `yes` typed on the terminal, or `--yes`. Only those keys are confirmed: a
  miss that appears later (between the plan and the session, or under
  `--watch`) is shown and asked about again, batch by batch, before it goes.
- `--max N` takes a positive whole number only, clamped to 300; anything else
  is an error.
- At most 1 request a second, 300 per session, and it stops on the first 429,
  5xx, timeout or 401 with no retry.
- It never removes a miss: a miss leaves the list only when its upload is
  stored. A confirmed miss the session did not record (Ctrl-C, the cap, a BSC
  stop, a failed renewal) stays listed for the next session, which the
  recorder reports as a count.
- When the BSC access token has under 2 minutes left it renews the session
  with the sign-in's refresh token through `services/browser`'s
  `bscRefreshGrant` (the one B2C refresh grant, shared with the BSC adapter:
  `client_id`, `grant_type=refresh_token`, `refresh_token`, `scope`), forced
  to real BSC. One grant each time the token nears expiry,
  paced inside the 1 request/second limit but not counted in the 300, never
  retried; the rotated refresh token is kept in memory. A failed grant (or no
  refresh token) stops the session with a fixed reason (`refused`,
  `rate_limited`, `server_error`, `timeout`, `network`, `bad_body`,
  `no_refresh_token`, `refresh_expired`, `unexpected_status`), never a token
  or B2C text.
- It reaches the fake as the loader SA through impersonated ADC, minting its
  ID token with `includeEmail` so rule 4 sees the SA's email.
- Uploads with `POST /__fake/recordings`; auto-promoted.
- `--watch --prefix` long-polls the miss list during a local E2E run.

### Write capture (Jason, 2026-11-14)

Seller writes get no real test before prod. Instead, whenever a PR adds or
changes a BSC write (listing PUT, photo upload, any new write), Jason performs
that write once locally against real BSC and the recorder captures it:
`recorder capture-write`. It sends exactly one write request (a listing PUT
is built as NB builds it, from one seller-profile read and two seller-sheet
reads in the same session, refused if the card is already listed or its row
changed between the reads; the request file's keys are a fixed list; one copy
at $500 or more under an `NBCAPTURE-` SKU NB never reads as its own), stores only the
response's status and shape (key paths and types, no values) through
`POST /__fake/write-captures`, and the fake's synthesis is checked against
that shape in its tests. This happens before the PR is pushed to CI.

Captured so far:

- **`PUT seller/bulk-upload`** (2026-11-14, status 200): an object,
  `{listings: [...], result: string}`, one listing per saved row with
  `active`, `sellerInventoryStatus`, `imageChanged` (booleans);
  `availableQuantity`, `cardYear`, `cartQty`, `orderQuantity` (numbers);
  `cardId`, `condition`, `currency`, `matchVal`, `price` (a dollar
  **string**, though the PUT sends a number), `productId`, `productType`,
  `sellerId`, `sellerImgFront`, `sellerImgBack`, `sellerSku`, `shippingCost`,
  `sportId`, `updatedTimestamp` (strings). 25 paths in all. Not a bare array
  of rows, which was the fake's first guess. `putAnswer` builds exactly these
  paths from the saved rows and the namespace, and `tests/server.test.mjs`
  pins them. NB never reads this answer (`putBscListings` discards it and the
  push reads the sheet back), so its shape cannot break a push.
- The photo upload: captured (status 200, verdict ok). The answer is an
  object with `name`, `objectKey` and `url` (strings), which the fake's
  `photoAnswer` already matched.

The write is real: a PUT makes or changes a listing on the account that
signed in, a photo upload stores a real image. `recorder undo-write --request
<the same file>` mirrors NB's delist: a fresh sheet read, then the card's row
at `availableQuantity: 0` (a second real write: dry run unless `--yes`), and
only when that row carries the capture's SKU, then one sheet read to report
whether the row is down. A photo upload has no API undo
(README, "Undoing a capture").

## App seams

- Convex: `apps/web/convex/lib/bscHttp.ts` exports `bscApiBase(env)` and
  `bscFetch()`. It returns the fake base only when
  `NEONBINDER_BSC_API_BASE` is set AND `TESTING_RESET_SECRET` is set AND the
  URL is the fake's root origin, https, on the fake's own Cloud Run service
  (host starts `neonbinder-fake-bsc-`, ends `.run.app`; a tagged revision or
  any other service is refused); otherwise the real host. A test deployment
  whose URL or key fails these checks is misconfigured and sends nothing.
  Fake mode adds `x-nb-fake-bsc-key` from `NEONBINDER_FAKE_BSC_KEY` and the
  Google ID token twice: `X-Serverless-Authorization: Bearer <token>` (for
  Cloud Run IAM) and the same signed token bare in `x-nb-fake-id-token`, whose
  signature the fake verifies itself. Both `bscFetch` and the `__fake/`
  control calls send them.
  No other file may name a BSC host.
- Browser service: `services/browser/src/bsc-endpoints.ts` resolves the API
  base and identity authority from `NEONBINDER_FAKE_BSC_URL`. If that is set
  while `ENVIRONMENT=prod`, the process refuses to boot. `/health` reports
  `bscTarget: "real" | "fake"`. As built: authority
  `<FAKE>/identity/identity.buysportscards.com/b2c_1a_signin`, API base
  `<FAKE>/api`; the B2C `redirect_uri` stays the real SPA's (never fetched;
  the fake echoes whatever the authorize carried). Every request to the fake
  (identity and API) goes through `src/bsc-fetch.ts`, which adds
  `x-nb-fake-bsc-key` from `NEONBINDER_FAKE_BSC_KEY` and, on https only, the
  runtime SA's Google ID token (ADC, audience = the fake's origin) twice:
  `X-Serverless-Authorization: Bearer <token>` and bare in
  `x-nb-fake-id-token`. The URL must be https on the fake's own Cloud Run
  host (`neonbinder-fake-bsc-*.run.app`, default port, no tag URL, no
  userinfo); http or https on loopback is allowed for local runs and tests.
  Anything else refuses to boot, and `bscFetch` adds the fake headers only to
  that pinned origin.
  `bscFetch` also holds a 429 breaker: process-wide against real BSC, per
  credential key against the fake.

## BSC call breaker (`bscFetch`)

Every BSC API call from Convex goes through `bscFetch`. It checks one
deployment-wide breaker before each call. It opens the breaker on any 429
(honouring `Retry-After`) or on a run of 5xx or timeouts on any endpoint, and
enforces a per-deployment token bucket against BuySportsCards (none against
the fake). A 429 is never retried.

As built (`apps/web/convex/bscCallGate.ts`, policy in
`convex/lib/bscCallGatePolicy.ts`, one `marketplaceCallGates` row):

- Bucket: 60 a minute, burst 10 against BuySportsCards. **None against the
  fake** (Jason): no wait and no `throttled` refusal, ever, and a healthy
  grant writes nothing; only the breaker below applies. A wave (the
  fetch-time team lookup) acquires once per wave of up to 10; every other
  call acquires one. Against BuySportsCards a wait over 15 s is refused
  (`throttled`) and writes nothing.
- 429 ladder unchanged from PR 451 (15 s doubling to 120 s, or Retry-After up
  to 10 min; streak resets after 15 min). Failure ladder: 5 failures in a run
  (a run resets after 5 min idle) open it for 30 s doubling to 300 s.
- Failures: 5xx, timeouts, network errors, and a 403 on the three catalogue
  reads (filters, results, card-listing). Not failures: other 4xx, the
  fake's 501 `x-nb-fake: unrecorded`, and its 503 `x-nb-fake: loading`.
- Half-open: after a window, one probe is granted, under a lease of 120 s
  (longer than the longest per-attempt timeout, the seller sheet's 90 s);
  everyone else is refused `probing`. The probe's success closes it; its
  failure re-opens it, escalated. A probe that waited for a token is checked
  after the wait only against a window opened meanwhile, never its own
  lease. A probe that ends with nothing to report (a neutral answer, or a
  throw before it was sent) hands its lease back at once; no token is
  refunded.
- Control calls (`__fake/...`, including `__fake/health`) are not gated: a 30 s timeout per
  attempt and one retry on a network error or a 503 (honouring Retry-After,
  at most 5 s), never on a timeout. `/api` calls are never retried there.
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
`prefix: "<prefix>"`. `POST /__fake/reset {prefix}` clears the `needs-model`
entries of the prefix lists inside the selection (catalogue entries stay, as
above); `{ns}` leaves them. The value is read strictly
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

// One B2C refresh grant, shared with BscAdapter.refreshAccessToken. Sent once;
// a network failure or timeout throws. Logs status and B2C's error code only.
export async function bscRefreshGrant(input: {
  refreshToken: string;
  authority?: string;              // default: resolveBscEndpoints(fetchOptions.env).authority
  fetchOptions?: BscFetchOptions;
  stepTimeoutMs?: number;
}): Promise<
  | { ok: true; tokens: BscTokenSet }
  | { ok: false; status: number; reason: "refused" | "rate_limited" | "server_error" | "unexpected_status" | "no_access_token"; reauthRequired: boolean }
>;
```

The recorder loads the compiled modules at run time from
`services/browser/dist/` (`bsc-signin.js` for `bscPasswordSignIn` and
`bscRefreshGrant`; `bsc-endpoints.js` for `resolveBscEndpoints` and
`bscApiHeaders`), so `services/browser` must be
built first (`npm ci && npm run build` there). It passes
`fetchOptions: {env: {}}` and the real endpoints, so a fake URL in the
operator's shell can never redirect a recording, and it never names a BSC
host itself. It never bundles or copies the browser source.

## Auth details (server builder)

- Cloud Run verifies `X-Serverless-Authorization` and removes the token's
  signature before the container sees it ("This removes the signature before
  passing the token to the user container"), so the fake never reads that
  header. Its identity comes only from `x-nb-fake-id-token` (a bare JWT;
  `Bearer <jwt>` is accepted too), which Cloud Run passes through untouched:
  - the token must have a signature, and the fake verifies it with
    google-auth-library against `FAKE_BSC_AUDIENCE` (the fake's origin, e.g.
    `https://<service>.run.app`), on Cloud Run and off it;
  - then `iss`, `exp`, `aud`, `email_verified` and `email` are checked;
  - anything else (missing header, unsigned or forged token, wrong audience)
    is 401; a verified email not on `FAKE_BSC_ALLOWED_CALLERS` is 403.
- `FAKE_BSC_AUDIENCE` is required (boot refuses without it) unless
  `FAKE_BSC_LOCAL_DEV_BYPASS` is on, and must be an origin.
- The fake refuses to boot when `ENVIRONMENT=prod`.
- Not yet confirmed on a deployed revision: that `Authorization` (the BSC
  token) reaches the container untouched when `X-Serverless-Authorization`
  is also sent. The doc says only that `X-Serverless-Authorization` is the
  one checked. The first deploy must confirm it (a profile read through the
  fake proves it).
- Cold start: the server listens before it loads the recordings and write
  captures from the store (`/__fake/health` `loading: true` until they are in).
  Meanwhile `/api/*` and `GET /__fake/misses` are HELD, after auth, until the
  load finishes (the miss list also waits for the durable misses to be
  restored), and then answered normally: a 503 on `/api` would count
  against Convex's BSC call gate, and recording loads take seconds. Only a
  hold past 25 s answers 503 with `x-nb-fake: loading` and `Retry-After: 2`.
  The admin uploads that read the loaded state (`/__fake/recordings`,
  `/__fake/write-captures`, `/__fake/drift-compare`) answer that 503 at once;
  after the load, `/__fake/recordings` is held until the durable misses are
  restored, and `/__fake/reset-all` is held from boot until then ("Durable
  misses", the same 25 s cap).
  `/__fake/reset`, `/__fake/faults`, `/__fake/orders` and the identity
  endpoints work at once. A load failure exits the process.
- `FAKE_BSC_LOCAL_DEV_BYPASS=1` skips the ID-token check only (keys are
  still required); the server refuses to boot with it when `K_SERVICE` is set.
- `/__fake/health` needs the ID token and caller key like the rest (Cloud Run's
  default TCP startup probe needs no route). It answers `{ok, loading,
  instanceId, revision, manifestVersion, allowlistVersion, recordings, writeCaptures:
  {missing: [<write endpoint>, ...]}}`. `missing` lists the write endpoints
  (`PUT seller/bulk-upload`, the photo-upload POST) that have no stored
  capture; the boot also logs `write_captures_missing`. The E2E seed fails on
  a non-empty list (see "Convex internal action for CI"). While `loading` is
  true the captures are not in yet, so health answers `writeCaptures:
  {loading: true}` with no `missing` field: a cold start never names an
  endpoint as missing, and a reader that ignores `loading` finds no list and
  fails closed rather than reading "none missing".

## Storage layout (bucket or local directory)

- `manifest.json`: `{schema:1, version, allowlistVersion, updatedAt,
  entries: {<key>: {object, pathTemplate, recordedAt}}}`. Each upload writes
  the recording objects, then `manifests/<version>.json` and a new
  `manifest.json` (GCS generation precondition), and swaps the in-memory
  catalogue: auto-promoted.
- `recordings/v<allowlistVersion>/<key>.json`: `{key, allowlistVersion,
  request:{method,path,query,body}, response:{status, body}, recordedAt}`.
- `write-captures/<endpoint slug>.json`: the latest capture per write endpoint.
- `misses/v<allowlistVersion>/{ns/<ns>|prefix/<prefix>|anon}/<key>.json`:
  durable catalogue misses (see "Durable misses"), deleted by generation.
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
  probe a minute per process), 400 (half a credential pair on the fake), 400
  "The fake BSC accepts only fake accounts" (a username on the fake that is not
  `nb+<ns>@fake.invalid`).
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
    the root is `$`), arrays collapsed to `[]`, unions as `number|null`. Key
    paths and types only, never values. As built: each read reports ONLY an
    allowlist of the paths NB's parsers read, plus their ancestors
    (`SHAPE_PATHS` in `bsc-probe.ts`: the catalogue lists equal `sanitise.ts`
    SPECS, the seller lists equal `drift.ts` READ_PATHS, the sheet also in its
    `{results: [...]}` form; a browser test checks the parity). Every other
    key, at any depth, is dropped unseen, so no `{*}` path is ever reported
    and a map keyed by a username, email or id cannot reach the public drift
    artifact. A change to either list must change the other. Sign-in shapes are NOT in `shapes` (the fake's identity is
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
- The seller sheet has two root forms, both read by NB (`bscSeller.ts`
  `fetchBscSellerSheet`: a bare array, or `{results: [...]}`). A probe of the
  wrapped form is unwrapped (`results` → root, `results[]…` → `[]…`) before
  it is compared, so either form is `ok` and drift paths are named in the
  bare form. An object root without a `results` array is drift.
- The sheet's served shape has two parts. Paths every row carries (a blank
  row's) are required: missing from the probe while their parent is present
  is drift. Paths only a listed row carries (`[].sellerSku`,
  `[].sellerImgFront`, `[].sellerImgBack`) are type-checked when the probe
  has them and never required, since the probe account lists nothing.

### Fake service environment (set by Terraform)

`FAKE_BSC_CALLER_KEY`, `FAKE_BSC_ADMIN_KEY` (Secret Manager; the admin key
also keys the identity's sealed tokens, so it must be stable across
revisions),
`FAKE_BSC_ALLOWED_CALLERS`, `FAKE_BSC_ADMIN_CALLERS` (comma-separated SA
emails), `FAKE_BSC_BUCKET` (recordings bucket name), `FAKE_BSC_AUDIENCE`
(the service's own origin; required), `ENVIRONMENT`. Listens on
`PORT` (8080). `GET /__fake/health` needs the ID token and caller key like the rest.

### Convex internal action for CI

`fakeBsc:reportMisses` (internal action, no args) returns
`{ok: true, skipped, misses: [{method, path}]}` for this deployment's
namespace prefix, read from the fake (`skipped: true`, no misses, outside fake
mode), or `{ok: false, status?, error}` when the fake could not be read.
CI calls it with the preview deploy key so no admin key is on the runner.

`fakeBsc:writeCaptureStatus` (internal action, no args) reads the fake's
`/__fake/health` (caller auth only) and returns `{ok: true, skipped, missing:
[<write endpoint>]}` (`skipped: true` outside fake mode), or `{ok: false,
status?, error}`, which includes a health answer with no `writeCaptures` field
(an older fake: never read as "none missing"). While the health answer
says `loading: true` (or `writeCaptures.loading: true`), the action asks
again with a bounded backoff (about 45 s of pauses in all); a fake still
loading after that is `{ok: false, error: "fake still loading"}`, never a
missing list and never "none missing". The E2E `seed` job runs it
before seeding and fails with an `::error::` naming `recorder capture-write`
when `missing` is not empty. The Convex control fetch (`fakeBscControlFetch`)
therefore needs no special case: the health route is under `__fake/...`.
Resolved (coordinator, 2026-11-14): `GET /__fake/misses?prefix=` needs only
rules 1 and 2 (see "Who may call it").

### First rollout order

See `README.md`, "First rollout". In short: Terraform apply (dev); seed the two
keys and set `NEONBINDER_FAKE_BSC_URL` and `FAKE_BSC_DEPLOY_ENABLED`; dispatch
the fake deploy; deploy a fake-aware browser revision (tagged, no traffic);
point a worktree Convex at it; run setup and the BSC specs and load the misses;
record the `probe-ci` pinned reads and the write captures; only then push the
PR. Until recordings exist every probe and E2E BSC call answers 501.
