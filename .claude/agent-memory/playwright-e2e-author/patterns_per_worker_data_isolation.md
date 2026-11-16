---
name: patterns_per_worker_data_isolation
description: HARD RULE - per-worker data isolation under concurrent shards; splitting a flow over shared real data; picking a fixture-owned name
metadata:
  type: pattern
---

# Per-worker data isolation (concurrent shards) — HARD RULE

**Why:** CI runs 8 shards at once, each its own VM and its own signed-in test
user (`worker=<n>`), against ONE shared Convex preview. `selectorOptions` (the
set catalog) and `cardChecklist` are **GLOBAL**: no per-user scoping field. If
two specs edit the **same real set** (metadata, features, cards) they stomp each
other and contend on the same docs (OCC retries, slow mutations, assertion
timeouts, list races). This is the root cause of "a different spec flakes every
CI run."

**`ATTEMPT_ID` does NOT make a shared-set write safe**: it protects against a
PRIOR attempt's debris, never against a CONCURRENT shard.

## The rule for EVERY spec you write or touch (GUIDE R7a)
1. **Default = a per-worker hand-made set** under real ancestors (Baseball /
   2024 keeps seeded teams and players warm), suffixed with the worker index.
   Do all editing there: metadata, features, card CRUD, grouping, panels.
2. **Never write to a shared REAL set. At all.** Only the seed provisions them;
   every other spec reads. `SET-REGISTRY.md` lists the sole writers and the
   read-only visitors. There is no serial/"isolated" lane to put a shared-set
   writer on; if a spec seems to need a shared-set write, that is a finding to
   raise, not a licence.
3. Reads of a shared set are concurrent-safe; WRITES are not.

## Hand-made set specifics
- Use the drill helpers (`drillToCustomSet` etc., R9) rather than inlining.
- For CARD tests, add a hand-made variant type under the hand-made set, then add
  cards in ITS checklist.
- TeamPicker / team search is **sport-scoped**: the seeded teams exist for
  BASEBALL only, so TeamPicker specs drill Baseball/2024 or "Yankees" returns
  no matches.

## `teams` is global too, and other specs create rows in it MID-RUN
Teams are globally-shared rows (dedup key = normalized name + sportId).
Committing a player in the entity-review/checklist path resolves that player's
Wikidata career and get-or-creates every club in it, so a spec on another shard
can insert e.g. "Gulf Coast League Yankees" seconds into yours. So **any
assertion of the form "filtering by X narrows to exactly 1" must filter on a
FULL unique minted name, never a distinctive-looking token** (a CI run failed on
"Yankees" matching 2 of 105 teams; nothing was broken, the needle was too short).

## NEVER assert a filtered RESULT COUNT on a shared admin list
`{n} of {N} teams` is fine when you filter to a name only this attempt owns.
**`{n} matches` on `/admin/players` is not**: that counter appears only while a
search term is present, and the search runs through Convex's search index, which
is **word-wise**. A minted name that is a bag of tokens collides with other
shards' fixtures on shared tokens (a measured run reported "3 matches" for one
exact minted string). The fix is the minted-single-token rule (GUIDE) plus waiting
on **the row** by its perceivable name (the Open/Create control for that name)
rather than on a count. Teams and leagues use `{n} of {N}`, a client-side
substring filter, which IS safe to compose with a count.

See [[patterns_credential_seeding]] for the other hard authoring rule.

## Splitting a flow over shared real data

When a sole-writer spec on a real brand-year gets too long and is split into
specs the shards run CONCURRENTLY, the server-side write sets are rarely the
problem; client-side SNAPSHOT SAVES are.

**Why:** in the 2026 Bowman split, every server write was disjoint or a
set-union, yet one pair still clobbered: `Sync <Type>s` opens a
ReconciliationModal that seeds EVERY existing row of that variant type into
Ready, and its save matches each item's `existingId` against that type's own
children only. A Make insert of... that moved (created-new + deleted-source) one
of those rows into another variant type while the dialog was open made the save
re-create it: two NB rows on one marketplace link. It was a PRODUCT bug, not only
a race (a plain later `Sync <Type>s` after the move re-created the row too);
NEO-312 fixed it with a whole-set/brand held check at save. When a split exposes
a cross-spec clobber, ask whether one spec alone can trigger it; if so, file it
and write the regression step, and keep the sequencing anyway.

**How to apply:**
- List every brand/set-wide write in the spec and, per write, (a) the rows it
  touches (cite file:line) and (b) whether its client computed a plan or list
  before saving. (b) is where the overlaps hide: reconcile modals, Group
  Parallels plans, any dialog's reactive target list.
- A pair with a stale-snapshot clobber goes in ONE spec, in the order the merged
  spec proved. A pair that only reshapes a reactive list under a click is a UI
  race: retry the pick once, result-keyed (assert the fold/selection, clear the
  filter before re-typing).
- A brand-wide write BOTH halves need (Sync Sets + the SportLots review) moves
  into the seed (`setup.spec.ts`), which runs alone; also give the seed the
  paused-mode manufacturer row and Variant Types, and strip guarded creates from
  the concurrent specs (two guarded creates can both create).
Related: [[patterns_per_worker_data_isolation]].

## Pick a fixture owned name by name

**Rule:** a spec whose write is keyed on a NAME (a team alias, a created team, a
career stint) picks that name explicitly, from names only its own fixture can
raise. Never "whichever row the wizard presents first".

**Why:** NEO-335, a CI run. The alias-saving spec linked the first team step on its
own sole-writer set and saved it as an alias of its minted team. The first step
was a STAGED CAREER TEAM (off a player's history), and the four read-only Big
League specs stage the same name off their own players. An alias is resolved by
every team lookup in the deployment, so while it was live their walk changed under
them. Owning the SET does not mean owning the NAMES on its review: staged career
teams and leagues come from players' histories, which cross sets.

**How to apply:**
- Previews answer wizard lookups from the committed recording
  `apps/web/convex/adapters/__fixtures__/enrichment-lookups.json` (NEO-289). Grep
  its `careerTeams`/`undatedCareerTeams` for the name: the players listed are every
  recorded source of that step. A name staged by one player who is only on your
  fixture is owned.
- Confirm against history: search every archived run log for the name and count the
  specs that touched it. A skip control's accessible name carries its row name
  (`Skip <name> ...`), so any spec that ever walked the step shows up.
- Walk to the chosen row with a read-then-skip loop whose click NAMES the row it
  read (`Skip <escaped heading name> . (not a team|this team has no league)`), so
  a guard/click race can never skip the row under test
  ([[patterns_responsive_duplicates_and_text_locators]]). Skips are scoped to the set's
  `selectorOptionId` (`entityReviewSkips`), so they leak nothing.
- Card clubs are the BSC `teamName` facet of the set; they reach a ONE-marketplace
  review only if the fetch waits for its team lookups (NEO-333), so check a run's
  `Skip <club> (not a team)` steps before relying on one.

Related: [[reference_neo284_team_alias_fixture]], [[patterns_per_worker_data_isolation]].
