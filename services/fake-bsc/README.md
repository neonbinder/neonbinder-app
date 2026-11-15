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
| `src/app.ts` | HTTP wiring: auth, faults, `/api`, `/identity`, `/__fake` (health at `/__fake/health`). |
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
curl -s -H "x-nb-fake-bsc-key: <caller key>" http://127.0.0.1:8787/__fake/health
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

A catalogue miss stays listed until its recording is uploaded: `/__fake/reset`
(which runs before every E2E seed) clears listings, photos, orders, faults and
`needs-model` misses, but keeps catalogue misses, because they are the
recorder's to-do list and change no answer. Only an upload, `/__fake/reset-all`,
the list caps or a restart of the fake's instance remove one.

The miss list lives only in memory and the service scales to zero, so a restart
(an idle scale-down or a deploy) empties it. That is accepted: run the specs
again to list the misses, then record them.

## First rollout

Order matters. Until recordings exist, the dev and preview probes and every E2E
BSC call answer 501 (unrecorded), so the first PR must not be pushed before
step 7.

1. Terraform: PR to `develop` in the infrastructure repo, then apply dev.
2. Seed one version each of the two Secret Manager keys (`fake-bsc-caller-key`,
   `fake-bsc-admin-key`) with random strings. Set the repo variables
   `NEONBINDER_FAKE_BSC_URL` (the Terraform `fake_bsc_url` output) and
   `FAKE_BSC_DEPLOY_ENABLED=true`.
3. `workflow_dispatch` the "Fake BSC deploy" workflow from the branch.
4. Deploy a fake-aware browser revision to the dev service (tagged, no traffic).
5. Point a worktree Convex deployment at the fake.
6. Run `setup` plus the BSC specs locally; the recorder loads their misses
   (`--watch --prefix` during the run).
7. Record the probe's pinned reads (the `probe-ci` namespace misses) and the
   write captures (`recorder capture-write`, then `undo-write`).
8. Only then push the PR.

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
BSC, it prints every request it will send (endpoint and facet slugs, or the
card id) and waits for you to type `yes` on the terminal (`--yes` skips the
question). A miss that turns up later, including each new `--watch` batch, is
shown and asked about again before it is sent.

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
  in flight.
- When the BSC access token has under 2 minutes left, the session renews it
  with the refresh token from the sign-in: one B2C refresh grant each time,
  paced like any request (one a second) but not counted in the cap, never
  retried. If it fails (or the sign-in gave no refresh token) the session
  stops and says why (`could not renew the BSC session (<reason>)`); run it
  again.
- The recorder never removes anything from the miss list. A request you
  confirmed that was not recorded when the session stopped (Ctrl-C, the cap,
  a BSC stop, a failed renewal) stays listed, and the last lines say how many:
  run the recorder again, no E2E run needed.
- `--max N` lowers the per-session cap: a positive whole number, clamped to
  300. Anything else (`--max abc`) is an error.
- Exit status: 0 on done, cap or Ctrl-C; 2 when it stopped on a BSC answer
  or could not renew the session; 1 on a usage or sign-in error. The last
  lines list any `needs a fake model` misses for a developer to model in
  `src/synth/`.

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

A listing PUT is built the way NeonBinder builds one, so what is captured is
the write NB really sends. The request file names only the intent; the tool
fills in the rest from the signed-in session:

```bash
cat > /tmp/put.json <<'EOF'
{ "method": "PUT", "path": "seller/bulk-upload",
  "listing": { "cardId": "<BSC card id>",
               "filters": { "sport": ["..."], "year": ["..."], "setName": ["..."], "variant": ["..."] },
               "condition": "near_mint", "price": 999, "sellerSku": "NBCAPTURE-<ticket>" } }
EOF
FAKE_BSC_CALLER_KEY=... FAKE_BSC_ADMIN_KEY=... \
  sh -c 'bw get item <bitwarden item id> | node dist/recorder/cli.js capture-write --fake <fake url> --request /tmp/put.json'
# lists every request it would send, sends nothing; add --yes to send them
```

- `filters` name the card's set, one value per facet (the slugs NB stores for
  the set); `condition` is one of BSC's raw condition keys
  (`apps/web/convex/lib/bscConditions.ts`).
- A capture lists **exactly one copy** (leave `quantity` out; anything but 1
  is refused) at **$500 to $999** (`price`, dollars in whole cents), so nobody
  buys it in the minutes it is live; NB never sends more than $999.
- `sellerSku` must be `NBCAPTURE-` then 1 to 80 letters, digits, `-` or `_`.
  NB's listing SKU (`NB1-...`, `parseListingSku` in
  `apps/web/convex/lib/listingSku.ts`) is refused, and NB can never read a
  capture SKU as its own, so an account later connected to NB never takes the
  capture for an NB listing.
- The request file may hold only `method`, `path` and `listing`, and
  `listing` only `cardId`, `filters`, `condition`, `quantity`, `price` and
  `sellerSku`. Any other key (a `body`, `headers`, a `sellerId`) is refused,
  never ignored.
- After sign-in it sends four requests, each once, never retried:
  1. `GET marketplace/user/profile` for the seller id (as NB's
     `fetchBscSellerId` reads it);
  2. `POST seller/bulk-upload/results` for that condition and set (the read
     NB's listing sync makes), taking the card's row;
  3. the same sheet read again, just before the write;
  4. the PUT: `{sellerId, listings: [{...the latest row, condition,
     availableQuantity, price, sellerSku}]}`, the row NB's `planBscSheet`
     builds. No photo keys are set.
- It stops before the PUT, writing nothing, when the profile has no seller
  id, when the sheet does not hold exactly one readable row for the card (a
  row over NB's 16 KB row limit is refused, as NB drops it), when the card is
  **already listed** in that condition, or when the card's row changed
  between the two sheet reads (its quantity, SKU, price or images). Every
  answer is read with a byte cap, as NB reads it.
- The already-listed guard is a **read-then-write check**, not a lock:
  NeonBinder's own listing sync, or anyone signed in to the account, could
  list the same card and condition between the read and the PUT. The second
  read narrows that gap but cannot close it, and the undo would then take
  that listing down. So **pick a card NB has never listed on that account**,
  and do not run a capture while NB may be pushing listings to it.
- It prints counts, statuses and reasons only, never the seller id or a row
  value, and uploads only the PUT answer's status and shape. After the upload
  it prints that stored shape, one key path and its types per line (no
  values), so drift can be fixed straight from the terminal.
- Once the PUT has gone out, any failure (a timeout, a dropped connection,
  an answer too large to read, the fake refusing the upload) still prints
  **THIS MAY HAVE BEEN A REAL WRITE** with the `undo-write` command: the
  listing may be up. Run the undo's dry run, then `--yes`.

For the photo upload use `{"method":"POST","path":"common/card/undefined/product/undefined/attachment"}`
(that literal path, nothing else) and `--file <image>`: that one request.
**Use a synthetic image, or one with its EXIF stripped** (no location, camera
or owner data): BSC keeps it and there is no API undo. The tool refuses a
JPEG with an Exif APP1 segment, a PNG with an `eXIf` chunk, a WebP with an
`EXIF` chunk, a file whose bytes are not the format its extension names,
and one whose structure it cannot walk; a request file for a photo may hold
only `method` and `path`. The file is always sent as `capture<ext>`, never
under its own name. Either way it uploads
only the status and the shape (key paths and types, no values) to
`/__fake/write-captures`. The fake answers whether its synthesis fits
(`ok` or `shape_drift` with the differing paths); fix `src/synth/sheet.ts`
(`putAnswer`, `photoAnswer`) on drift. Keep the request file until you have
undone the write, then delete it.

### Undoing a capture

A listing PUT: `undo-write` takes it down the way NB delists. It reads the
seller id and the card's sheet row again, then PUTs that fresh row at
`availableQuantity: 0` (NB's own "zero" row, carrying BSC's current
`productId` for the listing), then reads the sheet once more to check. That
is a second real write, so it is a dry run until `--yes`:

```bash
sh -c 'bw get item <bitwarden item id> | node dist/recorder/cli.js undo-write --request /tmp/put.json'
# lists every request it would send, sends nothing; add --yes to send them
```

It writes nothing when the card is not listed in that condition (already
down), or when the listing's SKU is not the request's `NBCAPTURE-` SKU (not
the capture's listing: take it down by hand if it should go).

The undone row is left at quantity 0 still carrying the capture's
`NBCAPTURE-` SKU and price; NB's planner rewrites both the next time NB
lists that card on the account.

After its PUT it reads the sheet once (no retry) and says what it found:
`down`; down but carrying another SKU; **still listed**; listed under another
SKU; or not checked (the read failed). Anything but down exits non-zero:
look at the card in BSC's seller pages and take it down by hand.

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
