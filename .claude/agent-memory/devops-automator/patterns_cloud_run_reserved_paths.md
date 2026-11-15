---
name: patterns-cloud-run-reserved-paths
description: Cloud Run's frontend answers its own 404 for reserved paths ending in z (/healthz) on run.app URLs, so a container route there is unreachable; use another path
metadata:
  type: reference
---

On `*.run.app` URLs the Google frontend intercepts `/healthz` (the legacy
reserved health name, and in general paths ending in `z`) and returns its own
HTML 404 before the request reaches the container. It happens with valid auth
and with none, so it looks like an app routing bug but isn't.

**Tell:** an unauthenticated call to `/` is a 403 (IAM), while the same call to
`/healthz` is a Google-styled 404. `/healthz/` (trailing slash) can still reach
an Express app, which hides the problem in local tests and via sloppy routing.

**How to apply:** never name a service route `/healthz`, `/readyz`, `/livez` or
anything ending in `z` that a smoke, probe or caller must hit on Cloud Run. Pick
an ordinary path (the fake BSC uses `/__fake/health`). Local `node --test`
against loopback can never catch this; only a call to the deployed URL does.
Cloud Run's default TCP startup probe needs no route at all.
