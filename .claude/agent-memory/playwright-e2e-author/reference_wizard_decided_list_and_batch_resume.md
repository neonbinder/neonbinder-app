---
name: reference_wizard_decided_list_and_batch_resume
description: Entity-review wizard traps - decided list and batch resume, decisions read from header and summary, return to batch-order player, late lookup reopens a skipped review, staged career-team headings, multi-team row counts
metadata:
  type: reference
---

# Assert the header numerator, not the `Decided (N)` list

The decided-names list is the LAST thing in the wizard's dialog body. On a tall step
(a college team row with five possible matches above an expanded league grid) it can
sit far below the viewport, and its presence is no signal. Playwright reports it as
visible if it is rendered, but do not build the assertion on it. **Assert the header
instead: `getByText(/^<n> of \d+ reviewed/)`.** It is the wizard's own progress
numerator, sits at the top of the dialog, is always rendered, and carries the exact
count, so it is not a weaker claim than `Decided (n)`.

## Never pin the TOTAL: it grows while the review is open

`<n> of <M> reviewed`: only `<n>` is the spec's to assert. `<M>` grows while lookups
land, because a settled player's Wikidata career teams are staged as new New Team
rows. NEO-332: a spec captured `0 of 221` and read `0 of 229` ten seconds later on an
otherwise-correct screen. Assert `/^<n> of \d+ reviewed/` (anchored, so `0 of` never
matches `10 of`); if a value must be captured, keep only the leading digits.

## The teams-first walk breaks every hard-coded decision COUNT

`walkToPlayerRow` answers each team step to reach a player, and each answer is a
decision the wizard counts: confirm read `Discard 28 decisions?`, header `28 of 116
reviewed` (27 drained skips plus the spec's one create). Any literal `Discard 1
decision` / `Decided (1)` in a spec that walks to a player row is wrong. Prove the
spec's OWN decision by NAME, not by count: the skip variant leaves every drained row
reading `Skipped`, so `Added as new` is unique; the create variant leaves them `Added
as new`, so `Skipped` is unique.

## Read a decision off its ROW via Back, never the list

Past five entries the Decided list is COLLAPSED (an operator sees none of it) and in
BATCH order, so a `Skipped`/`Linked to X` assertion on it passes only while the spec's
row is early in the batch. NEO-335's `resolveNav` (a decided staged career team hands
the walk back to the player it was staged for) moved the walk to deep rows (about 30
down) and three specs went red on decisions that had landed. Use the read-back helper:
footer `Back` (`Back to previous decision`) presents the last decision read-only, and
the text sits inside the `Decision for <name>` group (the footer group of that name is
absent while reviewing); then tap the panel's `Next` to resume.

The same walk change lands on players whose CREATE is held ("needs a team decision":
the walk skipped their staged career team). A caller that must `Add as New Player`
asks the walk helper for ready-to-create players only, which skips held players (never
unticks a chip). Those players are also tall: a career-form click can hit the footer,
so scroll the form into view first.

# A review batch outlives its spec: one red spec cascades

`commitCardChecklist`'s batch is per (selectorOption, user) and persists. A spec that
ends any way except Cancel then Discard (failed assertion, timeout, killed run) leaves
its decisions on the set, and the next fetch **resumes** that batch: the wizard opens
at `N of M reviewed`, not `0 of M`. All the read-only wizard specs share one set, so
ONE red spec fails its siblings on their `0 of N reviewed` precondition and the report
shows several broken specs for one broken feature. Reproduced locally: two killed runs
left the set reading `887 checklist reviews are in progress here`.

Fix in the suite: `discardResumedReviewBatch` in `support/wizard.ts`, run right before
each caller's own HARD `0 of N reviewed` assertion (so a resume it fails to clear
still fails the spec). **Recovering a wedged fixture by hand:** fetch the checklist to
the wizard, then `cancelAndDiscard`; about 2 minutes. Do this before you leave a
shared preview.

## Wizard decisions read from header and summary

Rule: never assert `Skipped` / `Added as new` / `Linked to X` from the Decided
list. Use:
- **one decision happened**: read the header text matching `Step x of y`
  (NEO-335; x = decided + 1 on a name step), keep x, act, then expect
  `Step ${x+1} of \d+`. Pin x, never y: y grows as staged steps arrive. The
  walk helpers may already have decided rows, so never hard-code `Step 2`.
- **what KIND every decision was**: `summaryRows` render only on the SAVE step
  ("Ready to save", heading "Save N cards?") since NEO-335 Phase 2, so reach
  it with the advance-to-save helper after the names-done footer
  (`Next (Enter)` or `Confirm & Save`). They omit zero lines except "Cards to
  save": "Skipped as not a name" present + "New players and teams" / "Linked
  to existing" absent = every decision was a skip (positive first).
- **what ONE decision was**: the read-back helper (footer Back, then the
  row's own "Decision for <name>" panel), never the Decided list.
- answer walk steps as SKIPS when a spec needs "all skips" to stay provable.

**Why:** NEO-330 moved skip specs onto 1995 hockey sets whose players hit
Wikidata ("Also on Wikidata, no years yet" lists ~10 clubs); the Decided list fell below the dialog body's visible area and a "Skipped" assert failed on a decision that had landed ("Step 2 of 16" in the header). Same rule as asserting inside a dialog: header and footer only. Related:
[[reference_wizard_decided_list_and_batch_resume]].

**When the decision was the LAST name** the wizard is already on its first
post-name step, which has no Decided list and whose footer Back is
`Back to previous step` (not `... decision`); from the first post step it
presents the last name decided. `util-wizard-read-back-decision` taps either.
The reference catalogue makes one-name batches common (Topps Big League
stages one), and it also gives known players their own lines on the teams
step, so read a line's count off its heading, never `FETCHED - 1`
(NEO-335 merge, CI run 38302511049 attempt 2).

## Wizard returns to batch order player after staged team

**Current behaviour (NEO-330, `returnTo` in `entity-review-nav.ts`):** typing a
career team on player A (or pressing "Decide team") stages a New Team step and
records a return stack; once that step — and any `New League:` step staged
ahead of it — is answered (create, link or skip), the walk presents A again.
Only when the operator had started editing A; if A was decided meanwhile the
walk falls back to batch order. Back, the Decided list's "Change" and "Back to
review" clear the return.

**What a flow can lean on:** the career-team chip list is keyed by A's review
row, so asserting `<club> (2001.2005)` right after the step proves the walk
returned to A — `checklist-wizard-career-team-commits` is the E2E proof
(red on the old nav, green on the new, Memphis RiverKings, 2026-10-10).
After A is DECIDED the walk moves on in batch order as before.

**History:** before the fix `resolveNav` took `nextUndecided(rows)` (first
settled undecided player in batch ORDER), while the walk util stops on
whichever row settled FIRST (a Wikidata no-match settles fastest), so on a
mixed batch the two differed and the chip assert failed on a row that never
had a chip. Flows on fixtures where they coincided (Orioles, Big League)
passed by luck. See neo248 career team entry years lost.

## Late lookup reopens a bulk skipped review

**Signature.** Failure PNG shows `N-1 of N reviewed · K still being looked up`,
a `New Team: <club>` step with `Needed by: <a name the bulk skip just decided>`,
and the footer offering `Skip remaining names (1)` again. The wait on
`Confirm & Save` runs out its whole window.

**Mechanism (product, not spec; fixed in NEO-330 W10).** The player was still
UNDECIDED when its lookup landed: `applyLookupResult` already drops decided rows.
The hole was the bulk skip's query-then-mutation paging (NEO-301):
`listBulkCandidates` picks a page's ids, the late lookup stages a team row after
the cursor, and `decideRowsByIds` decides only the ids it was handed. On the
LAST page nothing re-read, so the staged step stayed open and `allDecided` went
false. The fix: `runBulkDecidePage` re-checks after a skip's last page and keeps
draining; staging also refuses under a `skip` decision as a backstop. Whether it
bit depended on the shared 5-wide pool's timing.

**Proving it from artifacts.** convex-logs: the `enrichment_fixture` line for the
player (logged at lookup START) is later than the skip click's start in the spec's trace, and the staged club's own `kind:"team"` lookup line follows ~2s on.

**How to apply.** Do not "fix" with a re-click loop on `Skip remaining names` —
that hides the product bug. Report it; this one was a paging gap in the bulk skip. Related: [[patterns_pick_a_wizard_name_from_bsc_facets_and_the_gate_resolver]],
[[reference_wizard_decided_list_and_batch_resume]].

## Wizard headings include staged career teams

Before a spec pre-creates a team to match a CHECKLIST string, prove the string is
on a CARD. A `New Team: <name>` heading, or a registry note listing "the wizard's
headings", does not prove it.

**Why:** NEO-307 built the retro-rule proof on "Homestead Grays". SET-REGISTRY
listed it among the Rickwood set's clubs because the wizard had shown it as a
heading. It was a career team staged from a player's Wikidata stint. No card
carries it, so the proof could never pass. The first presented team row is often
a staged career team too.

**How to apply:** read the committed checklist. A linked card's sub-line prints
its team's full name, and an unlinked one shows only the attention "!". Or read
the alias a team link saved in Team Management ("Also known as"), which is the
raw checklist string. A throwaway probe spec run once against the preview and
deleted afterwards does this in about a minute. Related: [[reference_neo284_team_alias_fixture]].

## Multi team row needs a team count

**The row cannot tell two links from one combined team.** `CardChecklistItem`
builds the sub-line as `teamRows.map(teamFullName).join(", ")` then
`subParts.join(" · ")`. So `Boston Red Sox, Detroit Tigers` is what
BOTH a correctly split card and a card linked to one combined team print. A
full-match regex on the sub-line, `(A, B|B, A)( · .*)?`, does rule out a
one-sided link and an `X (unconfirmed)` tail, but not the combined team.

**Close it with Team Management's counter.** Since NEO-330 the screen asks
`teams.searchForManagement` from two typed characters and keeps a row when
EVERY typed word starts a word of its full name or an alias
(`teamMatchesFilter`). The counter is `N teams` browsing (page gate
`[0-9,]+ teams?( . [0-9,]+ need attention)?`) and `N match(es)` filtering,
never "N of M". Filter one half (`Boston Red Sox`) and wait for
`1 match( . [0-9,]+ need attention)?`: a combined team carries the same
words whichever order it was joined in, so "1 match" is the positive and the
negative in one read. The browser-side interim count runs over a capped
window first, so anchor a row assert under the counter to rule out an
interim "1 match" on the wrong row. Scope
it to a name, never a bare `,`: real teams and staged Wikidata career teams
can carry commas, and other flows' rows are on the same preview. The master
row's first line is the SHORT name, which is `Red Sox` or, when the New
Team step left Location blank, the whole name, so match
`(Boston )?Red Sox` below the counter.

**Checking every wizard team step needs the lookups settled first.** Team
rows go through the Wikidata pool like players (`startBatch` inserts them
`pending`) and are presented only once settled, teams before players. A
"Skip remaining names" pressed before that decides a pending team unseen.
Wait `notVisible: ".*still looking up.*"` (180000, the walk util's external
exception). It is safe straight after `Confirm New Players & Teams`, because
the wizard returns null until its rows load, so the title implies the status
line is live. Check each step on the pinned footer control, whose accessible
name carries the row name: `Skip [^,]+ — (not a team|this team has no
league)`, with a `|Skip .* — not a person` branch for the guard/tap TOCTOU.

Worked example: `playwright/tests/set-selector/checklist-dual-team-card-links-both-teams.spec.ts`
(NEO-333). Related: [[patterns_draft_echo_is_not_a_read_back]],
neo236 wizard teams first walk, guard then tap toctou.
