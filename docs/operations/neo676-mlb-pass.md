# NEO-676 — the MLB link pass: rehearse, preview, answer, load, rerun

**Status:** Operations runbook for the one-time MLB link pass on the armed bulk
loader: leagues and teams are linked to MLB's ids or created, existing players
are linked, and every place NB and MLB disagree comes back for an operator to
answer. Written with the code; run it after the PR is green.
**Related:** [NEO-676](https://linear.app/neonbinder/issue/NEO-676);
NEO-284 (the armed loader, `neo284-team-aliases-preload.md`); NEO-611 (the
roster player leg and its answers file, `neo611-roster-players.md`); NEO-190
(backup, restore and preview procedures). Players are *created* in a later
ticket; this pass only links the ones NB already holds.
**Server half:** `apps/web/convex/bulkLoad.ts`, the note headed "NEO-676" in the
module header, and the validators of `upsertLeagues`, `upsertTeams`
(`previewTeams`) and `upsertPlayers` (`previewPlayers`).
**Wrapper half:** the MLB fetch, the chunk loop, the answers file and the review
file live in the private wrapper. This runbook calls that script "the driver".

Nothing in this document names a deployment, an account or a URL.

---

## 0. What the pass will and will not do

- **Armed, twice.** `confirm: "BULK_LOAD"` and `ALLOW_BULK_LOAD=true` on the
  target deployment. The previews are queries and need only the confirm literal,
  so they run against an unarmed deployment, prod included. Arm only for the
  write and disarm straight after.
- **The id first.** A row carrying `mlbamId` is matched by that id before any
  name is read, so a rerun converges with no answers file.
- **Gap-fill only.** An adopt writes an empty field and nothing else: the id; a
  team's league, years, missing parent-club years and (as an alias) the API name
  when it differs from the row's; a league's aliases (only if it has none) and,
  on a minor league, its classes; a player's birth date when NB's birth year
  agrees. It never writes a name, location, level, a value already there, or a
  stint.
- **Creates what NB lacks, for leagues and teams**, with the id attached.
  Players are linked only: the driver sends `{ adopt }` answers and never a
  create.
- **Humans see disagreements only.** A result's `disagreements` lists each place
  NB and MLB differ, as `{ field, nb, mlb }`. A *field* conflict (league, level, span,
  class, parent club, birth date) is left as it is and the rest of the row
  lands. An *identity* conflict holds the whole row (status `ambiguous`, nothing
  written): a different id already on the row, the id held by another row, a
  birth year that contradicts an id match, two rows answering to one league
  name, two rows covering one season (or an id held by sixteen or more teams,
  which is more than one read returns), a team found only under another label,
  or a probable duplicate.
- **Schedules nothing.** No enrichment, no lookups.

## 1. Procedure

1. **Rehearse on a deployment of your own.** Restore a prod snapshot onto it
   (NEO-190 §4.3), then run: preview → leagues → MLB teams → minor-league teams
   → players → the whole run again. The rerun must report no creates and no
   fills. Then walk Team Management, League Management and a checklist team
   import on that deployment: rows load, nothing throws.
2. **Prod: back up first.** Take a snapshot (NEO-190 §3). A created league or
   team has no merge path, and a wrong player link has no undo.
3. **Preview everything.** Run the previews over the whole dataset, leagues,
   then MLB clubs, then minor-league clubs (clubs load before affiliates so a
   parent exists), then players. Nothing is armed and nothing is written.
4. **The operator answers the disagreement file.** The driver writes every
   `ambiguous` result and every `disagreements` entry to one review file. A row
   is for review when its `status` is `"ambiguous"` **or** its `disagreements`
   list is non-empty; a landed row can carry disagreements, so the status alone
   misses them. Each identity conflict is answered with `{ adopt: <id> }` (this
   row is that one), or for a team `{ create: true }` (none of those). Field
   conflicts need no answer; they are the list to fix by hand in the admin
   screens if wrong. Answers are pinned in the answers file and replayed on every
   rerun.
   - **A create is replayed as an adopt.** When a write creates a row (a team
     the operator answered `{ create: true }`, or any row the id and name
     steps did not place), the driver records the returned id in the answers
     file and replays it as `{ adopt: <that id> }`, never as `{ create: true }`.
     The server holds a replayed `{ create: true }` whose id and seasons already
     place a row, and holds an `{ adopt }` that disagrees with the id, so a stale
     answer cannot make a second holder of an id.
   - **Ids are unique within a call, and the driver checks across calls.** A
     call that repeats an `mlbamId` across its leagues, or across its players, is
     refused naming both rows (teams are exempt: one club id spans every era
     row of a franchise). Before the first write the driver checks that no
     `mlbamId` repeats anywhere in the whole dataset for leagues, or for players,
     since the server only sees one chunk at a time. A repeated id is a fault in
     the fetch, to fix before arming.
5. **Arm**, run the write legs in the same order, chunk by chunk, resuming from
   `nextKey`. Take one `loadStartedAt` before the first player call and reuse it.
   The player link pass sends `stints: []` on every row: this pass links people
   and writes no stint.
6. **Disarm and check.** Remove `ALLOW_BULK_LOAD` and prove it is gone.
7. **Rerun.** Run the whole pass again with the answers file: zero creates, zero
   fills. Anything else is a row to look at. Every create from the first run is
   now an `{ adopt: <recorded id> }` (step 4), so a rerun never takes the
   create path; a row reported as created on the rerun means the answers file
   lost an id.

## 2. Chunking and resuming

Leagues: at most 50 per call. Teams: at most 50 per call, and a call that spends
its operation budget stops between rows with `hasMore` and `nextKey`: resume from
`nextKey`. Players: at most 100 per call, same resume contract. An MLB id on a
row costs one extra read, and a row with a league or parent clubs one more per
distinct league or parent; the budget counts them.
A league row may carry at most 64 class stretches, as a team at most 64 parent
clubs; a longer list is refused naming the row.

## 3. Reading a result

| Where | Field | Meaning |
|---|---|---|
| league | `created` | a new row was made (or would be) |
| league | `id: null`, `created: false`, `disagreements` | held; nothing written |
| league | `filled` | `mlbamId`, `minorLeagueClasses`, `aliases` written |
| team | `matchedBy: "mlbamId"` | found by id, era-narrowed |
| team | `status: "ambiguous"` + `disagreements` | held; the field names the cause (`mlbamId`, `league`, `name`, `duplicate`) |
| team | `status: "adopted"` + `disagreements` | landed; the listed fields were left |
| player | `matchedBy: "mlbamId"`, `birthYearCheck: "mlbamId"` | found by id |
| player | `status: "ambiguous"` + `disagreements` | held (`mlbamId`, `birthYear`, `name`) |
| player | `filled` | `mlbamId`, `birthDate`, `birthYear` written |

## 4. Known limits

- A franchise whose NB era rows were never dated can read as a tie; date them
  and rerun.
- A minor league's class history is compared as a whole list. A season MLB adds
  later is reported as a difference, not merged.
- A player NB holds under a variant name the id does not reach is not found by
  name; the preview lists it as a would-create, which this pass does not write.
