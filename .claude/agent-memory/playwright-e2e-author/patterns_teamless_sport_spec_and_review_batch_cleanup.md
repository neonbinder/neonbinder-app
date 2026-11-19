---
name: teamless-sport-spec-and-review-batch-cleanup
description: NEO-426 "No teams in this sport" spec shape (handles, the hand-made commit fixture) and how a cleanup ends a review batch a red body left open, which otherwise refuses the rows' deletes
metadata:
  type: patterns
---

**Handles.** The sport row's Attributes cell `getByLabel("Set feature No teams in this sport")`,
the toggle inside it `getByRole("button", { name: "No teams in this sport", exact: true, pressed })`
(sport rows only; aria-disabled while the write flies). Open the panel with
`openAttributesPanel` after `drillToCustom(page, { sport })`; heading
`Attributes for <sport> (Sport)`. Toast copy was still settling at hand-back: match the
claim (`/save with No Team/`, `/ask for a team again/`), not the sentence.

**Fixture that reaches the commit path with no marketplace:** hand-made set under
`customSport(env)`, `Insert` > `Base`, `usePastedChecklist(page, "number,player,team\n1,<Minted>,\n", 1)`
(blank team cell = no claim), Sync. The wizard opens on the minted name's New player step
(no lookup: the custom sport has no Wikidata mapping); `Sport for this name: <sport>` is
the set's sport by default; a one-token minted name is NOT treated as a name fragment
unless a fuller player shares the word. Dialog name `tidyUpName({ year, set })` (an
insert named Base drops "Base" too).

**Proof the default worked:** after `answerPlayerAsNew` the footer is Confirm & Save
at once (`expectWizardStep(save)`); with the flag off the same fixture stops on "Cards
with no team" (planted red). Committed row `#1 ... No Team`, no
`Card 1 needs attention: no team...` img, no `/^[0-9]+ needs? you$/` pill. The drawer's
"No Team for this card" reads pressed; creating a team there un-presses it.

**Review batch cleanup.** While a fetch's review batch is open (Sync pressed, not saved),
the leaf's delete is refused ("a checklist review is in progress here — finish or cancel
it first"). A pasted checklist lives only on the page that pasted it: on a fresh page
Sync with no checklist says "Saved 0 cards." and does not resume. So the cleanup page
re-pastes the same checklist, presses Sync (the batch is per set + account, so the SAME
batch resumes), then Cancel (Esc) and settles on `Discard` or "Fetch cancelled — no cards
saved." (resumed past the names, the Decided summary is not shown, so do not branch on
it). Record the checklist text in the cleanup state from the Sync press until the
wizard closes on Save.

Related: [[reference_hand_made_rows_cannot_reach_the_commit_path]], [[patterns-set-no-team-spec-shape]], [[failure-screenshot-shows-the-finally-end-state]]
