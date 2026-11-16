---
name: secret-manager-expiry-update
description: How to give a Secret Manager secret a sliding expiry from Node — set expireTime with update mask expire_time, not ttl; extend before adding the version
metadata:
  type: reference
---

A secret's expiry is the `expiration` oneof on the Secret: `expire_time`
(Timestamp, OPTIONAL, always returned on output) or `ttl` (Duration,
INPUT_ONLY). At expiry the secret and every version are irreversibly deleted.

For a sliding expiry, send an absolute `expireTime: {seconds}` computed locally,
on `createSecret` and on `updateSecret` with `updateMask: {paths: ["expire_time"]}`.
The REST reference does not say which mask path a `ttl` update takes, nor that a
`ttl` update counts from the call (the expiration guide page 404'd when checked),
so `ttl` on update is unverified; `expire_time` is unambiguous and testable.

Order: extend first, then `addSecretVersion`, so the version just written can
never land in a secret that expires a moment later. NOT_FOUND on the extend is
silent (the create path sets the expiry); any other failure is logged by code
and swallowed so a lifecycle hiccup never fails a credential write.

Tests can pin the exact value with `mock.timers.enable({apis: ["Date"], now})`
and `tick()` between writes. See [[secret-manager-has-no-upsert]],
[[require-cache-fake-for-singleton-client]].
