---
name: patterns_dead_branch_guards_can_cover_a_second_outcome
description: Spec maintenance - dead branch guards, copy sweeps missed by merges, diffing optional branches green vs red
metadata:
  type: pattern
---

When a branch in a helper or spec becomes unreachable on its stated premise ("no
search box"), its guard may still be doing a second job. In the old custom-drill
helper's Level 4 the short-list fallback was gated on "Variant Types column
absent" and the search branch on "search box visible". Together they also
handled the create submit SELECTING an existing row (the typed name already
exists but sits clipped in a long list): the box vanished with the collapse, the
search branch skipped, and the other guard skipped the fallback. Making the
search pick unconditional would have re-picked a selected row.

**Why:** stripping on the premise alone silently drops coverage of an outcome
nobody wrote down; it shows up later as a re-pick/toggle or a hard fail on a box
that collapsed.

**How to apply:** for each branch you remove, enumerate the app states that
reach that point (every outcome of the step before it: create vs select-existing
vs confirm-exists), and check which branch each one took before. Keep a cheap
guard that preserves those, and put the hard result assertion after the block
(R2). Related: [[patterns_entity_column_shapes_and_cold_sync]].

## Merged specs miss a branch copy sweep

A branch that changes UI copy also sweeps every flow that reads that copy.
When main is merged in later, any flow main ADDED was written against main's
old copy, so it fails on the branch even though both sides were green alone.
The sweep never saw it, and git reports no conflict.

Example: NEO-330 changed the Player Management counter from "N of M players" to
"500 players", "N matches" and "10+ matches", and updated every flow in one
commit. The NEO-332 merge then brought in a pick-step flow whose launch gate
was still a locator for "N of M players". Its first CI run failed at the 45s launch
gate, with "500 players" in the failure screenshot.

**Why:** a gate like this fails on the first read and looks like a slow
sign-in. The screenshot answers it in seconds; a timing theory never would.

**How to apply:** after merging main into a branch that changed copy, grep
the specs for each OLD string or regex the sweep replaced. Fix the specs main
added in the same push. Check the capped and plural forms too: a sweep that
adds "10+ matches" breaks every `[0-9]+ matches` locator whose search can fill
the cap. See [[patterns_record_a_fixture_sets_lookups]].

**Resolving the conflict hunks by script:** split on a LINE that is exactly
`=======`, never on the substring `=======\n`. A banner comment such as
`// ============…` ends in seven `=` and a newline, so a non-greedy
`<<<<<<< HEAD\n(.*?)=======\n` regex cuts the HEAD side at the first banner
inside it and silently keeps half of both sides (NEO-335's merge of NEO-330
did this once). After any scripted resolution, grep for `^=======$` and diff
the file against both parents.

## Diff optional branches green vs red

Download the last green run's artifacts (traces, step logs) and compare them with
the red run's for the spec's conditional branches: the `if (await ...isVisible())`
arms, the optional skip taps, and the accessible name of whatever each one clicked.
A branch that ran only in the red run is the fixture changing shape under the spec.
For example, NEO-335 after NEO-333 merged: the `Skip <club> (not a team)` arm ran
in the red run and not in the green one, because the fetch now waited for BSC team
lookups, so the cards arrived listing a team.

**Why:** walk helpers absorb new wizard steps silently (that is their job), so the
red shows up many steps later, on a re-sync, as a product symptom. The branch diff
names the cause in one grep. The red step's screenshot shows only the consequence.

**How to apply:** on any red step in a spec that reads live marketplace data, run
this diff before reading product code. Also read the failure screenshot's banner
text in full. A `Saved N cards.` assertion written as a prefix match also accepts a
`... names were not reviewed` tail, so an earlier green can hide the same damage.
Related: [[patterns_record_a_fixture_sets_lookups]].
