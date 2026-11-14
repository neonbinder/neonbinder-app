---
name: cloud-run-strips-serverless-auth-signature
description: Cloud Run removes the ID token's signature from X-Serverless-Authorization before the container sees it; the container cannot re-verify, so trust the unsigned claims only when K_SERVICE is set
metadata:
  type: reference
---

Cloud Run's docs: with `X-Serverless-Authorization: Bearer <id token>`, IAM checks that header (it wins over `Authorization` when both are sent) and "removes the signature before passing the token to the user container". The docs do not promise that `Authorization` (for example a third-party bearer such as BSC's) reaches the container untouched when both are sent; prove it on a deployed revision.

**How to apply:** an app-layer identity check behind Cloud Run IAM (services/fake-bsc `src/auth.ts`) must: verify a SIGNED token itself (google-auth-library `verifyIdToken` with the service URL as audience); accept an UNSIGNED one only when `K_SERVICE` is set, still checking `iss`, `exp`, `email_verified` and the allowlisted email; refuse anything else. Never accept an unsigned token off Cloud Run, or a local caller can forge one. Related: [[no-token-can-be-our-own-limiter]].
