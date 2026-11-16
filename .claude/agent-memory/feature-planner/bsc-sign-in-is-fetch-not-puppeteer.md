---
name: bsc-sign-in-is-fetch-not-puppeteer
description: BSC sign-in in services/browser is a plain-fetch B2C PKCE flow (no Chromium); its hosts are hardcoded in bsc-adapter.ts, including a direct api-prod profile read, so any BSC host seam must cover both services
metadata:
  type: project
---

The browser service's BSC login (`/login/bsc`) never drives Puppeteer: it replays the Azure B2C custom-policy flow over fetch (authorize page SETTINGS blob, SelfAsserted, /confirmed 302 with #code, token endpoint with auth-code + refresh grants, silent re-authorize via the SSO cookie). Its seller-profile read goes straight to the BSC API host from the browser service, not through Convex's `lib/bscHttp.ts`.

**Why:** NEO-552 planning found the coordinator (and the ticket) assumed a Puppeteer sign-in page and a single Convex `BSC_API_BASE` seam; a fake/redirect that covers only Convex would let the browser service fall through to real BSC with a fake token.

**How to apply:** any plan that redirects, fakes, pauses or meters BSC must list every BSC host literal in BOTH `apps/web/convex` and `services/browser/src` (grep the host names), and add a single-host unit test so a new literal cannot bypass the seam. Convex env for such a seam is read inside the handler, never at module scope (see [[fe-imported-convex-modules-stay-env-free]]).
