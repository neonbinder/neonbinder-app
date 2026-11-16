---
name: patterns_credential_seeding
description: Credentials and sign-in - fake creds for forms, seed-credentials for real auth, needsReauth fixture, redirect chains, never pass secrets via env
metadata:
  type: project
---

See GUIDE "Worker-state seeding" for the authoritative table of
`/testing/seed-credentials` and its `sites` values. Patterns on top of it:

## Credential FORM specs
- Type fake literals (`e2e-fake-user` / `e2e-fake-pass`); no real secrets.
- Assert `Credentials were saved ... authentication failed` after saving (not a
  success message).
- The `hasCredentials` flag is set to true before auth is attempted, so the Clear
  Credentials lifecycle still works.

## Real-auth specs
- Enter with `signIn("/testing/seed-credentials?redirect=/profile")` (the inner
  `?` stays literal; a nested `&` is written `%26`), never by typing credentials.
- Assert the success text (`BSC account authenticated successfully` or
  `Credentials saved successfully`, or the SportLots equivalent).
- Restore by routing through `/testing/seed-credentials?redirect=/profile`.

## Worker bootstrap
The `bootstrap` project (`tests/profile/worker-bootstrap.spec.ts`) resets then
seeds its shard's account. No credential typing; everything is server-side.

## `needsReauth` fixture and its cleanup (verified 2026-09-14)
- Flag a worker's OWN row by navigating to `/testing/needs-reauth?site=sportlots&redirect=<dest>`
  (sets only `needsReauth`/`needsReauthSince`; `hasCredentials` untouched, so the
  Set Builder still renders and the reauth notice shows above its heading).
- Cheapest restore: `/testing/seed-credentials?sites=sportlots&redirect=/profile/credentials`.
  On the renewable-session branch `seedMyTestCredentials` writes `needsReauth:
  false` through `updateSiteCredentialStatus`: ~1 s, no login. (An older comment
  claimed re-seeding preserves the flag; it does not, corrected in NEO-278.)
- Prove the restore landed with `Connected to SportLots` on the SL tab: that card
  renders only when the row has credentials AND is not flagged.
- The reauth notice's dismissal is `sessionStorage` per tab: click its link BEFORE
  Dismiss, because Dismiss hides the whole strip (link included) for the tab
  session; get back to the Set Builder with a fresh navigation.

## Patterns url redirect chains

## How redirect chains work
`signIn("/dest")` opens `/testing/sign-in?redirect=<dest>&worker=<n>`, signs the
worker in, then forwards to `<dest>`. A nested hop keeps its `?` literal and
writes a nested `&` as `%26`:

```ts
await signIn("/testing/seed-credentials?redirect=/profile");           // seed only
await signIn("/testing/seed-credentials?sites=label-scans%26redirect=/print/labels");
```

- **Seed-only**: the spec needs real credentials available (set-selector specs,
  real-auth credential specs).
- **Reset then seed**: only the `bootstrap` project wipes before seeding; a spec
  never resets (R4, R7).
- **Isolated account**: `signIn(dest, { account: "new-profile" })` for a spec that
  must start from an empty profile.

Always let `signIn` build the URL (it adds the `worker=` parameter that selects
the Clerk user); never hand-assemble the chain.

## Feedback no secrets via env

Hard rule (from NEO-29, carried over): marketplace usernames and passwords must
NEVER appear in a spec file, a test argument, a logged value or a run
artifact, and never be typed from a variable a CI step exports for the spec.

**Why:** the previous harness serialised its entire env map into debug output
that was uploaded as a PUBLIC CI artifact, and real marketplace passwords
leaked that way. The same applies to Playwright traces (they record Clerk
testing tokens and request bodies): never upload or commit traces, videos or
HTML reports with data in them.

**How to apply:**
- Credential FORM specs (save, setup, clear-then-setup): type fake literals
  and assert the "saved but authentication failed" state.
- Real-auth coverage: route sign-in through `/testing/seed-credentials`
  (GUIDE "Worker-state seeding"), which seeds server-side from the deployment's
  env; or use `support/credentials.ts`.
- Never add a `wip` tag to work around this; fix the underlying security issue.

See [[patterns_credential_seeding]] for the implementation patterns.
