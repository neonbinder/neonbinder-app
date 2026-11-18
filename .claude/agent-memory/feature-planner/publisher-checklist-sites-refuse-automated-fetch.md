---
name: publisher-checklist-sites-refuse-automated-fetch
description: Panini's checklist site returns an edge 403 to curl and headless Chrome, and no CORS for neonbinder.io; a server-side "fetch the official checklist" means bot evasion, so the operator upload stays the only door (NEO-597)
metadata:
  type: project
---
NEO-597 probe (2026-11-18): Panini's checklist page (a Sport > Year > Brand >
Program dropdown cascade with one Excel download per program) answered a plain
HTTP client AND a headless Chrome with a bot-block 403 page. The only CORS
origin it allows is its own; its static assets host sends no CORS header.
Getting past the block would be bot evasion, and the session's own guardrail
refused even an archive copy as a workaround.

**Why:** a plan to "fetch publisher checklists on the backend" fails on
access, not on parsing. The readers already take Panini's program workbook
(credit line, then CARD SET | CARD # | ATHLETE | TEAM | SEQ) and Topps' PDF.

**How to apply:** for any publisher or third-party checklist source, test
access with ONE plain request before planning a fetch path. Blocked means
link-out plus the existing upload (PublishedChecklistPanel), or a permission
or data-feed ask that goes to Jason. Never plan Puppeteer, a residential proxy
or an archive mirror to get round a block. Related:
[[publisher-checklist-is-a-match-cards-source]].
