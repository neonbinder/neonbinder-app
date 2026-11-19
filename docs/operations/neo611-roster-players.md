# NEO-611 — roster players: preview, load and rerun

**Status:** Operations runbook for the roster leg of the armed bulk loader
(`upsertPlayers` / `previewPlayers`): adopt or create NB players from a roster
dataset and add their stints on teams NB already holds. Written with the code;
run it after the PR is green.
**Related:** [NEO-611](https://linear.app/neonbinder/issue/NEO-611);
NEO-285 (the adopt-only stints leg this shares its stint engine with, see
`neo285-college-stints.md`); NEO-284 (the armed loader and the team rows the
stints point at, see `neo284-team-aliases-preload.md`); NEO-254 (the player
identity key); NEO-190 (backup, restore and preview procedures).
**Server half:** `apps/web/convex/bulkLoad.ts`, section "Roster players". Its
section note is the protocol; every result field is documented on the
validators.
**Wrapper half:** the roster dataset, the chunking loop, the answers file and
the load epoch live in the private wrapper repo. This runbook calls that script
"the driver".

Nothing in this document names a deployment, a dataset or a URL.

---

## 0. What the loader will and will not do

- **Armed, twice.** `confirm: "BULK_LOAD"` and `ALLOW_BULK_LOAD=true` on the
  target deployment, as for every writer in the file. `previewPlayers` (a
  query) needs only the confirm literal and runs against an unarmed
  deployment, including prod. Arm only for the run, and disarm after.
- **Creating people is opt-in by function name.** `upsertPlayerStints` stays
  adopt-only. Only `upsertPlayers` may insert a `players` row.
- **Never guesses the player.** The same identity rule as the New Player form
  and NEO-285 (§1.1). Anything the rule cannot settle is reported and nothing
  is written for that row.
- **An adopt nothing confirms is held**, not written (§1.3).
- **Stints name a team by `teamId` only.** There is no `school` path. A team in
  another sport is refused per stint (`wrong-sport`); a missing one is
  `missing-team`; the rest of the row lands.
- **Gap-fill only.** Nothing already on a player is removed, renamed or
  re-dated. A stint that could be one the player already has is `present`.
- **Schedules nothing.** No enrichment lookup, no sport-membership row. A
  created row has no `createdByUserId` (a CLI run has no user).
- **Aliases** go through the one index writer, so a created or adopted player
  is found by an alias on the next call.

## 1. The rules the driver must know

### 1.1 Identity

Candidates are the players that answer to the incoming name: the primary name,
an alias, or membership of the sport (`sameNamePlayers`).

| Candidates | Birth years | Outcome |
|---|---|---|
| none | any | create |
| one | agree, or either side has none | adopt (see §1.3) |
| one | both dated and different | create |
| several | exactly one equals the incoming year | adopt that one |
| several | incoming and every candidate dated, none equal | create, `forked: true` |
| anything else | | `ambiguous`, with the candidates |

A candidate scan that comes back full may hide the person, so it is always
`ambiguous` and never forks. An adopt found through an alias reports
`matchedBy: "alias"`.

### 1.2 The load epoch: twins

A roster can list one person twice. The second key would find the first key's
new row and fold into it. Nothing stored tells "made by this load" from "NB
already held it", so the driver supplies the line:

- Take **one** `loadStartedAt` (milliseconds since the epoch) before the first
  call of the load. Send the **same value** on every call, resume and rerun of
  that load. A value in the future is refused.
- When the row the rule would adopt was created at or after `loadStartedAt`
  and no answer named it, the result is `ambiguous` with
  `reason: "created-this-run"`, and that candidate carries `createdThisRun`.
  On a preview the same verdict names the earlier row as `twinOfKey`.
- **Record every `created` id** (`results[].playerId`) in the answers file as
  `decision: { adopt: <id> }` for that key. A rerun with the same epoch and
  those answers adopts every key by decision and creates nothing. A rerun on a
  new epoch with no answers adopts the dated keys by `match`, holds the
  undated ones, and also creates nothing.
- Two different keys that are really one person are settled by an answer:
  `decision: { adopt: <id> }` on the later key.

### 1.3 `birthYearCheck`, and `held`

Every adopt reports why the player was trusted:

| `birthYearCheck` | meaning |
|---|---|
| `match` | both dated and equal |
| `candidate-undated` | NB has no birth year for the player |
| `incoming-undated` | the roster row carries none |
| `decision` | an answer named the player |

Only `match` and `decision` write. With `candidate-undated` or
`incoming-undated` (when neither side has a year, the incoming side is the one
reported) the name is all that agrees, and a career written onto the wrong
undated person cannot be taken back, so the row is **`held`**: status `held`,
nothing written, and the result still carries `playerId` (the candidate),
`birthYearCheck`, `candidateBirthYear` and `candidates` so the driver can show
the operator who it found. The operator answers `decision: { adopt: <id> }`, or
`decision: { create: true }` if it is someone else.

On a decision adopt the birth year is filled when the player has none. Aliases
are unioned (never removed, capped at the player alias limit; the overflow is
`aliasesSkipped`) on a `match` or `decision` adopt only.

### 1.4 `decision`

| decision | effect |
|---|---|
| `{ adopt: id }` | adopt that player. Refused (the call fails) unless the player is in this sport (home or added) and answers to the row's name (primary or alias). Skips the twin check and the held check. |
| `{ create: true }` | insert a new player regardless of candidates. **Not idempotent**: replaying it inserts another. Record the new id and replay it as `{ adopt: id }`. Also confirms a one-word name (§2). |

### 1.5 Keys and chunks

- One key per row; a key repeated within a call is refused. Never split one key
  across rows.
- At most 100 rows per call and 64 stints per row. A call that spends its
  operation budget stops between rows with `hasMore: true` and `nextKey`;
  **resume from `nextKey`**, never by resending the chunk (a replayed prefix is
  harmless for adopts but a replayed `{ create: true }` inserts again).

## 2. Statuses

Per row (`results[].status`):

| status | meaning | your move |
|---|---|---|
| `created` / `would-create` | a new player; see `nearExisting`, `forked` | record the id. Read `nearExisting` (up to three players that look like this one): a duplicate of someone NB holds under another name has no delete or merge path |
| `adopted` / `would-adopt` | an existing player; see `matchedBy`, `birthYearCheck` | nothing |
| `held` | an adopt nothing confirms; nothing written | answer `{ adopt }` or `{ create }` |
| `ambiguous` + `candidates` | several candidates the rule cannot choose between | answer `{ adopt }` or `{ create }` |
| `ambiguous`, `reason: "created-this-run"` | would fold into a player this load made | usually a twin or a lost answers file; answer `{ adopt: id }` if it is the same person, `{ create: true }` if not |
| `ambiguous`, `reason: "name-fragment"` | a one-word name that is the first or last name of fuller-named players | answer `{ adopt }` for the fuller name, or `{ create: true }` if it is a one-name player. `candidatesTruncated` means the list is not complete |

Per stint (`results[].stints[].outcome`): `added` / `would-add`, `present`,
`wrong-sport`, `missing-team`, `cap-reached` (the player already holds 64
stints).

The chunk `summary` totals `created`, `forked`, `adopted`, `held`, `ambiguous`,
`stintsAdded`, `stintsPresent` and `wrongSport`.

## 3. Procedure

1. **Rehearse on a deployment of your own.** A hand-made sample proves the
   mechanics (statuses, rerun, resume). Only a restored snapshot has the real
   team ids the dataset points at, so run the real dataset on a restored
   preview (NEO-190 §4.3) before prod.
2. **Preview first, always.** Run `previewPlayers` over the whole dataset with
   the epoch you will use. Read, in this order: `ambiguous` rows (answer them),
   `held` rows (answer them), `created` rows with a non-empty `nearExisting`
   (spot-check for variant-name duplicates), `forked` rows, and `wrong-sport` /
   `missing-team` stints. The preview models twins among its own would-create
   rows; it does not model a one-word name clashing with a player it would
   itself create, so that case first appears on the write.
3. **Backup Now** on the target (NEO-190 §3). There is no delete or merge path
   for a created player.
4. **Arm**, run `upsertPlayers` chunk by chunk with one epoch and the answers
   file, recording every `created` id as an answer as you go. Resume from
   `nextKey`.
5. **Prove the rerun.** Run the whole load again. It must report `created: 0`
   and `stintsAdded: 0`. Then disarm and prove the flag is gone.
6. **Spot-check** in the Players admin: a created player with aliases, a
   created player with a long career, an adopted player's earlier career
   (untouched, with the new stints after it), and one `held` row after its
   answer.

## 4. Known limits

- A person NB holds under a variant name that neither the primary name, an
  alias nor the sport membership covers (a double surname, a nickname) is
  created again. `nearExisting` and the preview are the mitigation; there is no
  merge.
- The epoch is the driver's. Taking it late (after some rows were created)
  hides those rows from the twin check; the loader can only refuse a future
  one.
