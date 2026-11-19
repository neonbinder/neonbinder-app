---
name: capture-optional-parent-only
description: fake-bsc eBay capture optional paths - a prefix exemption swallows the fields a present object must carry; use a parent-only rule
metadata:
  type: reference
---

In `services/fake-bsc/src/ebay/captures.ts` an optional entry is a prefix by default, so exempting `offers[].listing` also exempted `listing.listingId`, which NB reads. A rename upstream would pass as "ok".

**How to apply:** use `parentOnly` for an object that is absent on some rows (children optional only while the parent is wholly absent from the capture) and list the genuinely varying children by exact path. Pair it with a test that drops the read field from a present parent and one that wrong-types it. `synthConformsTo` is one-way (synth paths must exist in the capture), so a capture holding extra paths is never drift; do not write a test comment claiming otherwise. Look the endpoint up with `Object.hasOwn`.
