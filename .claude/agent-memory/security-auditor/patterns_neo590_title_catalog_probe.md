---
name: neo590-title-catalog-probe
description: Signed-in query that searches the global players/teams catalog by client-sent text (NEO-590 pickList.titleSports): how to judge exposure, fan-out and the no-write/no-match invariant
metadata:
  type: project
---

A public query that takes free text, searches `players`/`teams` search indexes and returns
only a derived NB value (a sport row) is NOT a new oracle when `players.search` /
`teams.search` already return full docs to any signed-in caller: compare against those,
not against zero. Players/teams are a global catalog (no owner scoping), so client text
cannot reach another user's data through them.

What to check instead:
- Per-call fan-out: N texts x 2 searches x take(k) docs read vs the existing search's
  per-call limit (25). NEO-590: 20 x 2 x 8 = 320 search docs/call, plus per verified
  player hit a playerSports read (take 16): ~2,900 at the ceiling, ~980 realistic (≤4
  extra sports per player). Count the follow-up reads per hit, not just the searches.
  Bounded, signed-in, one-shot (not subscribed), no write: a note, not a finding.
- Each text clamped by `clampSearchQuery` before any tokenising; the array cap is checked
  before `new Set(...)`/work. Watch for a new pre-pass helper that slices the RAW title
  (e.g. "words after the first #token") and only clamps its output: the regex/replace then
  runs over the unclamped arg. Clamp first; it changes no answer, since verification words
  already come from the clamped title.
- Search-term normalisation parity: `teams.search` runs the query through `nameTokens`
  before the `nameNormalized` index; a new caller passing raw text misses accents and
  punctuation (correctness, not security).
- `players.alsoSportIds` is a derived display copy; `playerSports` is the authority.
- Invariant: the derived answer must stay in client state (grep the new field name for any
  mutation arg or `useMutation` path) and the server fn must be a `query` (cannot write).
- Marketplace sale text (eBay line title) already on the client (NEO-520) sent back as a
  query arg is not a new exposure: it is the caller's own sale data, not a marketplace id.

Related: [[neo330-by-id-twin-and-search]], [[neo331-context-id-side-channel]], [[public-function-auth-registry]].
