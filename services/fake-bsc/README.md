# Fake BuySportsCards (`services/fake-bsc`)

A standing fake of BuySportsCards (BSC) that previews, worktree deployments and
dev call instead of the real site (NEO-552). **It never contacts BSC.**
Catalogue reads are replayed from recordings; everything else (sign-in,
profile, seller sheet, listing writes, photo uploads, orders) is synthesised
per account. `CONTRACT.md` is the interface every caller builds to; read it
first.

```
Convex / browser service ──► <FAKE>/api/<BSC path>        replay or synthesis
                         ──► <FAKE>/identity/<B2C path>   fake Azure B2C sign-in
tests / Convex testing   ──► <FAKE>/__fake/...            reset, faults, orders, misses
recorder (a person)      ──► <FAKE>/__fake/recordings     sanitised catalogue answers
```

## Layout

| Path | What |
|---|---|
| `src/index.ts` | Boot: config, load recordings and write captures, listen. Logs one `boot` line (instance id, manifest version). |
| `src/app.ts` | HTTP wiring: auth, faults, `/api`, `/identity`, `/__fake`, `/healthz`. |
| `src/auth.ts`, `src/config.ts` | Caller key, admin key, ID-token identity. Fails closed. |
| `src/requestKey.ts` | The one recording key: method + path + sorted query + canonical body, SHA-256. Shared with the recorder. |
| `src/sanitise.ts` | Field allowlists for the three recorded endpoints, versioned. Shared with the recorder; re-applied on upload and on load. |
| `src/catalogue.ts`, `src/store/` | Recordings in memory; GCS bucket, local directory or memory store; versioned, auto-promoted manifest. |
| `src/synth/`, `src/state.ts` | Per-namespace state and the synthesised seller and order endpoints. |
| `src/faults.ts` | Fault rules (429, 503, delay, hang, reset). |
| `src/captures.ts`, `src/shape.ts`, `src/drift.ts` | Write captures, shape signatures and the drift check. |
| `src/identity/` | The B2C identity endpoints (separate owner; see CONTRACT.md "Identity"). |
| `recorder/` | The local recorder: fills the catalogue from real BSC, and captures write shapes. |

## Gates

Node 22 (`.nvmrc`). From this directory:

```bash
npm ci
npm run build && npm test
```

Tests run against `dist/` with `node --test`, on loopback only.

The server image builds `src/` only (`npm run build:server`,
`tsconfig.server.json`); the recorder is never built into it.

## Run it locally

```bash
npm run build
FAKE_BSC_CALLER_KEY=<any 32+ chars> \
FAKE_BSC_ADMIN_KEY=<different 32+ chars> \
FAKE_BSC_LOCAL_DEV_BYPASS=1 \
FAKE_BSC_STORE_DIR=/tmp/fake-bsc-store \
PORT=8787 npm start
curl -s -H "x-nb-fake-bsc-key: <caller key>" http://127.0.0.1:8787/healthz
```

`FAKE_BSC_LOCAL_DEV_BYPASS=1` skips only the Google ID-token check (both keys
are still required) and the server refuses to boot with it on Cloud Run.
Without it, every caller sends its Google ID token twice: in
`X-Serverless-Authorization` for Cloud Run IAM and bare in
`x-nb-fake-id-token`, which the fake verifies itself against
`FAKE_BSC_AUDIENCE`. The fake never trusts `X-Serverless-Authorization`
(Cloud Run strips its signature). Point
the browser service at it with `NEONBINDER_FAKE_BSC_URL=http://127.0.0.1:8787`
and `NEONBINDER_FAKE_BSC_KEY=<caller key>`.

### Environment

| Variable | Meaning |
|---|---|
| `FAKE_BSC_CALLER_KEY` | Required. The `x-nb-fake-bsc-key` every caller sends. 32+ characters. |
| `FAKE_BSC_ADMIN_KEY` | Required, different. The `x-nb-fake-bsc-admin-key` for admin endpoints. |
| `FAKE_BSC_ALLOWED_CALLERS` | Comma-separated service-account emails allowed in (required unless bypassing). |
| `FAKE_BSC_ADMIN_CALLERS` | The subset allowed to use admin endpoints. |
| `FAKE_BSC_AUDIENCE` | The fake's own origin (`https://<service>.run.app`), the audience of every caller's ID token. Required unless bypassing. |
| `FAKE_BSC_BUCKET` | Recordings bucket (required on Cloud Run). |
| `FAKE_BSC_STORE_DIR` | Local store directory (tests, dev). Neither set: memory only. |
| `FAKE_BSC_LOCAL_DEV_BYPASS` | `1` skips the ID-token check. Refused when `K_SERVICE` is set. |
| `ENVIRONMENT` | `prod` refuses to boot: the fake is never production. |

## Accounts, resets and faults

Sign in as `nb+<convexSlug>-<userTag>@fake.invalid` with `fake-bsc-password`
(`wrong-password` gets B2C's rejection). The part between `nb+` and `@` is the
namespace that holds the run's listings, photos, orders, faults and misses.

```bash
H=(-H "x-nb-fake-bsc-key: $KEY" -H "X-Serverless-Authorization: Bearer $ID_TOKEN" -H "x-nb-fake-id-token: $ID_TOKEN" -H 'content-type: application/json')
curl "${H[@]}" -X POST "$FAKE/__fake/reset"  -d '{"prefix":"<convexSlug>-"}'   # never drops sign-ins
curl "${H[@]}" -X POST "$FAKE/__fake/faults" -d '{"ns":"<ns>","rules":[{"match":{"method":"GET","pathTemplate":"marketplace/card/:id/card-listing","cardId":"<id>"},"kind":"hang","times":3}]}'
curl "${H[@]}" -X POST "$FAKE/__fake/orders" -d '{"ns":"<ns>","order":{"items":[{"cardId":"<id>","condition":"near_mint","quantity":1}]}}'
curl "${H[@]}" "$FAKE/__fake/misses?prefix=<convexSlug>-"
```

`/__fake/reset-all` (admin) clears every namespace and every sign-in.

An unrecorded catalogue request answers **501 with `x-nb-fake: unrecorded`**
and lands on the namespace's miss list with the nearest recorded request's
differing paths (`nearMiss.diffPaths`, never values). Anything the fake has no
model for is listed as `needs-model` with its method and path template only.

## Recording the catalogue

Only a person runs the recorder, on their own machine; never CI. It fetches
**only** the three catalogue reads (`search/bulk-upload/filters`,
`search/bulk-upload/results`, `marketplace/card/:id/card-listing`) that the
fake's miss list asks for, serially, at most one request a second and 300 a
session, and it stops on the first 429, 5xx, timeout, 401 or 403 with no retry.
Every answer goes through `src/sanitise.ts` before upload, and the fake
re-applies the allowlist and refuses anything outside it.

Any caller-key holder (every PR's Convex) can write the miss list, so the
recorder trusts none of it: each miss must pass the request allowlist in
`recorder/replay-allowlist.ts` (the exact body shapes NB sends, facet slugs
only, no query string, hex card ids, 4 KB at most) or it is refused and
reported by reason, never sent. Misses with no namespace and no prefix are
skipped unless `--include-anon`. Before it reads a credential or contacts
BSC, it prints how many requests it will send and waits for you to type
`yes` on the terminal (`--yes` skips the question).

Prerequisites:

1. `services/browser` built (`npm ci && npm run build` there): the recorder
   signs in with its `bscPasswordSignIn` and real-endpoint helpers, loaded from
   `services/browser/dist` at run time (`--browser-dist <dir>` overrides).
2. ADC impersonating the loader service account (the recorder mints its
   Google ID token from ADC, asking for the email claim the fake checks):
   `gcloud auth application-default login --impersonate-service-account=<loader SA email>`.
   **This replaces your existing ADC** (one ADC file per machine), so other
   tools on your machine act as the loader SA until you switch back. When you
   are done, restore your usual ADC by running the login you normally use
   again, e.g. `gcloud auth application-default login` (or with your usual
   `--impersonate-service-account=<the SA you normally impersonate>`).
3. The fake's two keys in this command's environment only, read from Secret
   Manager at run time. Never write them to a file.

```bash
cd services/fake-bsc && npm run build
FAKE_BSC_CALLER_KEY="$(gcloud secrets versions access latest --secret=<caller-key secret> --project=<dev project>)" \
FAKE_BSC_ADMIN_KEY="$(gcloud secrets versions access latest --secret=<admin-key secret> --project=<dev project>)" \
  sh -c 'bw get item <bitwarden item id> | node dist/recorder/cli.js record --fake <fake url> --prefix <convexSlug>-'
```

- BSC credentials come **only** from stdin (a Bitwarden item, `{username,
  password}` JSON, or two lines) or, on a terminal, a prompt with the password
  hidden. `--password` and friends are refused. Tokens stay in memory.
- `--watch` keeps polling the miss list (every 3 s) while a local E2E run
  produces misses, and records each one once. Ctrl-C stops after the request
  in flight. A session also stops when the BSC token has under 2 minutes left;
  run it again.
- `--max N` lowers the per-session cap: a positive whole number, clamped to
  300. Anything else (`--max abc`) is an error.
- Exit status: 0 on done, cap or Ctrl-C; 2 when it stopped on a BSC answer;
  1 on a usage or sign-in error. The last lines list any `needs a fake model`
  misses for a developer to model in `src/synth/`.

The fake promotes each upload at once (a new manifest version; earlier
manifests stay under `manifests/` and in the bucket's object versions).
Bumping `SANITISE_ALLOWLIST_VERSION` turns every older recording back into a
miss, to be recorded again.

## Capturing a write's shape

**`capture-write` makes a REAL listing change or a REAL photo upload on the
production BSC account you sign in with.** Buyers can see a listing it makes
until you take it down.

Seller writes get no real test before production. When a PR adds or changes a
BSC write, capture that write once against real BSC **before the PR goes to
CI**:

```bash
cat > /tmp/put.json <<'EOF'
{ "method": "PUT", "path": "seller/bulk-upload", "body": { "sellerId": "<yours>", "listings": [ <one sheet row> ] } }
EOF
FAKE_BSC_CALLER_KEY=... FAKE_BSC_ADMIN_KEY=... \
  sh -c 'bw get item <bitwarden item id> | node dist/recorder/cli.js capture-write --fake <fake url> --request /tmp/put.json'
# prints what it would send; add --yes to send it
```

For the photo upload use `{"method":"POST","path":"common/card/undefined/product/undefined/attachment"}`
and `--file <image>`. It sends **exactly one** request, never retries, and
uploads only the status and the shape (key paths and types, no values) to
`/__fake/write-captures`. The fake answers whether its synthesis fits
(`ok` or `shape_drift` with the differing paths); fix `src/synth/sheet.ts`
(`putAnswer`, `photoAnswer`) on drift. Keep the request file until you have
undone the write, then delete it.

### Undoing a capture

A listing PUT: `undo-write` sends the same rows with `availableQuantity: 0`,
which takes them down. That is a second real write, so it is a dry run until
`--yes`:

```bash
sh -c 'bw get item <bitwarden item id> | node dist/recorder/cli.js undo-write --request /tmp/put.json'
# prints what it would send; add --yes to send it
```

A row that was already listed before the capture is taken down too, not put
back to its earlier quantity: capture with a card you do not have listed, or
set the quantity back by hand in BSC's seller pages afterwards.

A photo upload has no undo through the API. An uploaded image that no listing
points at is not shown to buyers. If a PUT attached it (`sellerImgFront` /
`sellerImgBack` set to the returned `objectKey`), remove it by hand: open that
listing in BSC's seller pages and delete or replace the image there, or
`undo-write` the PUT that attached it to take the listing down.

## Drift

`POST /__fake/drift-compare` (admin) takes the prod probe's shapes
(`{shapes: {<endpoint>: {<key.path>: <type>}}, requests?: {...}}`) and answers
`{outcome: "ok" | "shape_drift" | "unrecorded pinned key", paths, endpoints}`.
Recorded endpoints compare only allowlisted paths.
