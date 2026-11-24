---
name: reference_stale_while_loading_hides_in_flight_query
description: A "ready" flag read off a held (stale-while-loading) value is true while the new question is still in flight; read the raw useQuery result for freshness
metadata:
  type: reference
---

`useStaleWhileLoading` keeps the last answer so a badge never blinks, but a
`ready` derived from the held value is true for a pair set that was never
asked: a hook that started with "nothing to ask" (a defined stand-in answer)
stays "ready" after the args change, and an effect that decides once (open the
walk after a commit) acts on the stale empty answer. Show the held value, but
compute `ready` from the raw `useQuery` result (`undefined` from the moment
args change until THEY are answered). Pin it with a test that goes
no-pairs -> pairs with the mock answering `undefined`.

Related: a `sr-only` span (position:absolute) inside a button label gets
padded with spaces in Chromium's accessible name ("Team , suggested"); set an
explicit `aria-label` composed from the visible parts instead.
