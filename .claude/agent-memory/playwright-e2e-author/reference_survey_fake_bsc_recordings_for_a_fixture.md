---
name: reference-survey-fake-bsc-recordings-for-a-fixture
description: How to answer "is there a recorded fake-BSC set with X?" from data, not guesses - join results recordings to card-listing recordings, then check names against the reference catalogue per sport
metadata:
  type: reference
---

The fake BSC's recordings are one JSON object per request (`endpoint`,
`request.path`, `request.body.filters`, `response.body`) under a versioned
prefix, listed by a manifest. Download them into the scratchpad (gcloud, the
bucket is in the dev project; name in private notes), then:

- `search/bulk-upload/results` bodies are card arrays (`id`, `players`,
  `cardNo`, `playerAttribute`) keyed by the request's facet filters
  (sport/year/setName/variant/variantName).
- `marketplace/card/<id>/card-listing` bodies carry `teamName` ("" = BSC names
  no team). Join on card id to get "which recorded sets have no-team listings".
- Card-listing reads exist only for cards a spec asked live; a set uploaded
  whole as a publisher's checklist has results but no listings.
- For "unknown to the catalogue": the reference bundle (repo variable, private
  bucket; `agent-convex.sh --seed` fetches it the same way) has
  `players/documents.jsonl` (`name`, `sportId`), `playerSports`,
  `playerAliases`, and sport rows in `selectorOptions`. Check membership PER
  SPORT (the name gate is set-sport scoped), print only counts and the fixture
  names, and delete the bundle after (prod data, licensed rows).

NEO-426 result (2026-11-19): every recorded no-team listing (Leaf Vivid Base and
Lazer Red proofs, 2026 Donruss Retro SIG autos) is a player the Baseball
catalogue knows; every recorded set with unknown players either names a team on
its listings (1995 hockey, ASU Onit) or has no listing recorded. The catalogue
has 0 Non Sport players, and Non Sport has no BSC id (SportLots only).
Related: [[patterns_worktree_deployment_onto_the_fake_bsc]], [[patterns_leaf_vivid_real_unlicensed_set]]

Update (NEO-426 audit, 2026-11-19): recorded card-listings exist for whole sets only on
1995 Dayton Bombers ECHL (all 32, every one names the club; owned by the 429 breaker),
2026 Onit Athlete Arizona State Sun Devils Base (all 10, each names "Arizona State Sun
Devils", which the catalogue HOLDS; players unknown; drill filters recorded; no spec
owns it) and Leaf Vivid. Stars of MLB Network Base has results but no listings; five of
its hosts are unknown to the catalogue, and its publisher file's "No Team" cells mean BSC
gave them none, so ONE recorded listing there (its card left out of an uploaded file)
is the cheapest "BSC answers no team for an unknown person" fixture.
The recorder for catalogue READS is `fake-bsc.sh record <deployment>-` (misses), not
`capture` (seller writes).
