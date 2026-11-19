---
name: patterns_add_cards_run_start_caps
description: Add cards - run-start caps, pickIntakeSet before any drop, intake zip fixtures
metadata:
  type: pattern
---

A red `expect(page).toHaveURL(/run=/)` after "Use a scanner" or a photo drop, with
an `alert` in the failure ARIA snapshot, is a cap, not a regression:

- **"You've got too many runs going. Finish one first."** — 2 active batches per
  user. "Done adding photos" closes a run but its job stays active while the
  photos are still being cropped and read (a minute or more), so two real-photo
  specs back to back (desktop then mobile on one account) leave the third start
  refused. It drains by itself; rerun after a couple of minutes.
- **"You've started a lot of runs just now."** — 12 job starts per hour per
  user (`MAX_JOB_STARTS_PER_WINDOW`). Repeated local runs exhaust it. On your OWN
  Convex deployment raise it with `npx convex env set MAX_JOB_STARTS_PER_WINDOW 100`
  (accepted up to 200); never on shared dev or a preview.
- Workers 3 and up fall back to the one `TEST_EMAIL` user when no
  `TEST_EMAIL_<n>` exists, so a second worker index is NOT a fresh account for
  these caps.
- A spec that waits on "Sent N photos." under a long ceiling sits the whole
  ceiling when a start is refused; read the alert before believing a hang.
- **A run a spec never closed holds a slot until Done**: a spec whose body
  fails with its run still open (e.g. inside a photo viewer) must `page.goto`
  the run URL in its cleanup before pressing "Done adding photos"; an open modal
  leaves the page behind it inert, so a bare click times out and the run stays
  open. Take the run URL from `page.url()` too (a start that never said "Sent").
  To clear leftovers by hand: the Add cards tab's region `Recent runs` lists
  `Into <home>, <variant>, <date>` buttons; open each and press Done.
- Order a local run of several run-starting specs so only one leaves a job
  reading at a time (scanner-code, which starts empty runs, before the photo spec).

A vite dev server that shows a blank dark page after another agent's edits to
`main.tsx` or a provider (console: "multiple <ClerkProvider>") is an HMR artifact;
restart Vite once, no spec change.

An `aria-describedby` that points at an element with its own `aria-label` yields
the label, not the element's text, as the accessible description: a
`toHaveAccessibleDescription(<the tray words>)` goes red if the tray region gets
a label.

The 12-starts window is the deployment env `MAX_JOB_STARTS_PER_WINDOW`
(`resolveMaxJobStartsPerWindow`, integer 1-200). On YOUR OWN worktree
deployment you may raise it with `npx convex env set` for a day of reruns
(say so in the report, and unset it after); never on shared dev or a preview,
and never in a spec.

## Add cards drop needs a set first

Since NEO-452 a drop on Add cards with no set picked never uploads: it sits in a
tray ("N photos waiting. Pick a set and they're off."), no run starts and no
`?run=` appears. A spec written before it (e.g. NEO-446's zip/over-limit specs)
that drops straight after picking the binder waits forever on `?run=`.

- Call `pickIntakeSet(page)` (`support/collection.ts`) after the binder/box pick
  and before `intakeDropzone(page).setInputFiles(...)`. A Main binder needs only
  the set; a box that lists also needs a Min price and condition.
- Which set: a spec whose photos never reach Matching (refused, all-rejected,
  a lone side that never pairs) picks the seed's 2024 Topps Chrome Base
  read-only and is listed under "Read-only consumers" in SET-REGISTRY.md. A spec
  whose pair must MATCH a card needs a hand-made per-attempt set holding that
  card (`hres-`, `intk-`), with `pickIntakeSet(page, target, { under: "Insert" })`.
- A zip's send writes no "Sent" status line (the job row speaks); loose photos
  get "Sent N photo(s)." once the set makes the run ready.

Related: [[patterns_add_cards_run_start_caps]]

## Patterns intake zip fixtures

- A flat oversize JPEG for a "too many pixels" fixture: write a PPM with a short
  python3 -I script and compress with `cjpeg -quality 50 -optimize -sample 2x2`
  (8200x8200 is about 395 KB). macOS `sips` cannot get a flat 67 MP JPEG under
  1 MiB (about one byte per 8x8 block). Build zips with `zip -0 -X`; a stored entry
  expands 1:1, so the 100:1 guard (only applies above 1 MiB) never fires.
- A big photo that must stay on the fast path (no heavy-model cold start): stamp it
  so `scan_meta.is_card_sized_scan` accepts the frame: JFIF density square and
  >= 200 dpi, pixels / dpi within 3% of 2.5 x 3.5 in (6000x8400 at 2400 dpi).
  `sips -z H W -s dpiWidth N -s dpiHeight N` writes that density, BUT it leaves the
  JFIF density UNIT byte (file offset 13) at 0, which `_trustworthy_dpi` rejects
  ("no trustworthy resolution"), so the photo escalates to the heavy service anyway.
  Patch byte 13 to 1 (python3 -I, no re-encode) and verify with `xxd -s 13 -l 5`
  (`01 09 60 09 60` for 2400 dpi), never with `sips -g dpiWidth`, which reports 2400
  either way.
- Pixel limit rejection happens at /extract (header only), so a zip of oversize
  photos fails the whole run without any model call; the failure line comes from
  `runNotice` in realLanes.ts, so compute the expected string from there.
- The Add cards drop zone is `getByLabel("Drag your card photos here, or browse
  your files")`; "Start a new run" is a substring of nothing else but the setup
  bar's "New run" matches it, so use `exact: true` for both.
