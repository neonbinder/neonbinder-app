---
name: patterns-neo611-roster-players
description: NEO-611 armed roster player leg (create-capable) — caller epoch direction, decision-replay bypasses birth-year contradiction, held rows carrying a non-null playerId, regex source pin shape limits
metadata:
  type: project
---

Audited 2026-11-18 (diff). Auth clean: `upsertPlayers` internalMutation +
`assertBulkLoadArmed`; `previewPlayers` internalQuery (QueryCtx db cannot
write; MutationCtx helpers sit behind `mutationCtx &&`). No public fn added,
so the publicFunctionAuth registries correctly stay unchanged.

**Rule 1 — a caller-supplied "load epoch" is conservative in ONE direction.**
`createdThisRun = _creationTime >= loadStartedAt`. An EARLIER epoch flags more
rows (safer); a LATER one (still <= now, so not refused) hides earlier calls'
creates from the twin check. "Can only make outcomes more conservative" is
wrong whenever the only server check is `> Date.now()`. Check the runbook
states the late-epoch direction; the guard cannot.

**Rule 2 — an operator decision replayed by a driver is automation.**
`{adopt: id}` checks name/alias + sport but skips the birth-year rule, so a
stale answers file onto a re-cut dataset writes onto a same-name man the
data positively says is someone else. Ask: does a replayed decision ignore
positive contradicting evidence?

**Rule 3 — a "held / nothing written" result that still carries the
candidate in the primary id field** (`playerId`) invites a driver that
records "every playerId" as an answer, auto-adopting every hold. Prefer
null in the id field and the candidate only in `candidates`.

**Rule 4 — regex source pins over `export const X = kind(`** miss
`kind<T>(`, aliased builders, and `export { x }`; the "none is public"
assertion has the same blind spot. Pair it with a count of all builder calls.

Related: [[patterns-neo284-team-aliases]] (shared write/dry-run handler grep).
