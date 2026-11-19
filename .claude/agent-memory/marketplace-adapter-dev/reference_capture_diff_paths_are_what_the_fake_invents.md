---
name: capture-diff-paths-are-what-the-fake-invents
description: a shape_drift verdict lists paths the FAKE sends that the stored capture lacks (synthConformsTo is one-way), not what real has and the fake lacks; stored capture shapes are not readable, only verdicts
metadata:
  type: reference
---

`checkCapture` calls `synthConformsTo(synth, capture)`: every path in the
fake's answer must exist in the capture. So the `paths` of a `shape_drift`
verdict are fields the fake emits that the real answer did not carry (or whose
types do not overlap), never fields the real answer has and the fake lacks.
A blank path (`""`) means the fake sent a body where the real answer had none
(shape `{}`): an empty-body 200 versus the fake's `{}`.

`GET /__fake/write-captures` (admin) returns verdict, paths and status only;
the stored shapes are not readable through any route. Work from the paths plus
the OAS fixture, and reproduce a drift offline by deleting those paths from
the sample's shape and calling `checkCapture`.

A capture sees ONE object (the recorder's `inventory_item?limit=1` is the
seller's first item, not the one it just made; an offer read before publish has
no `listing`), so presence of optional fields varies. Those go in
`CAPTURE_OPTIONAL` (src/ebay/captures.ts), still type-checked when present.
Aspect names with a space collapse to `*` in a shape, so the sample's own
aspect keys decide which aspect paths exist.

Name a variant for the kind of answer (`#refused`), never an error id: the
sandbox's publish refusal was 25007 while the variant said 25002.
