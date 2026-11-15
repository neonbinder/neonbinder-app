---
name: cloud-run-strips-serverless-auth-signature
description: Cloud Run strips the ID token signature from X-Serverless-Authorization, so an app-layer identity check must never trust it; callers send the signed token again in a second header the app verifies itself
metadata:
  type: reference
---

Cloud Run's docs: with `X-Serverless-Authorization: Bearer <id token>`, IAM checks that header (it wins over `Authorization` when both are sent) and "removes the signature before passing the token to the user container". The docs do not promise that `Authorization` (for example a third-party bearer such as BSC's) reaches the container untouched when both are sent; prove it on a deployed revision.

An earlier design trusted the unsigned claims whenever `K_SERVICE` was set. A security audit rejected it (should-fix): the claims are only as good as IAM, so an `allUsers` binding or a loosened invoker list makes them forgeable, and the app-layer check was meant to survive exactly that.

**How to apply:** behind Cloud Run IAM, the caller sends its Google ID token twice: `X-Serverless-Authorization` for IAM, and the same signed token in a custom header Cloud Run leaves alone (services/fake-bsc uses `x-nb-fake-id-token`). The app ALWAYS verifies that token's signature itself (google-auth-library `verifyIdToken`, audience = the service origin, required config), never reads `X-Serverless-Authorization`, and allowlists only the verified email. Impersonated ADC leaves `email` out of minted ID tokens unless `fetchIdToken(aud, { includeEmail: true })` is used on the `Impersonated` client. Related: [[no-token-can-be-our-own-limiter]].
