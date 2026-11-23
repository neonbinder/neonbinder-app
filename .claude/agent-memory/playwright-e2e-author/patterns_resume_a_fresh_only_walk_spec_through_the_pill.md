---
name: patterns-resume-a-fresh-only-walk-spec-through-the-pill
description: NEO-645 — a fresh-only sole-writer spec that went red INSIDE the Tidy Up walk can be re-checked without a reseed: Skip/Save for later wrote nothing, so a throwaway copy in the run snapshot drills to the committed set and opens the walk from the "N need you" pill
metadata:
  type: feedback
---

On the NEO-645 walk the commit happens at Match Cards' Confirm, so a fresh-only
sole-writer spec (its precondition "No cards in this checklist yet.") cannot run twice on
one seed. But if it went red INSIDE the walk after only Skips (or before any tile answer),
nothing was answered: the set is committed with every name still open and the checklist
shows "N need you".

- Do not reseed (shared deployment, coordinator-owned). Put a THROWAWAY copy of the spec
  in the run snapshot only (never the edit worktree; the next `rsync --delete` removes it)
  with the fetch replaced by `openOneMarketplaceSetBase(...)` + `openTidyWalk(page)`.
  Minted names come from a fresh `ATTEMPT_TOKEN`, so the spec's own fixtures re-mint.
- Report the real spec's first run plus the resume run; the fetch-to-walk half is proven
  by the first run's artifacts (the walk dialog in `error-context.md`).
- The classic way to burn the fresh set this way: `skipUntil(page, row.filter({ has:
  rowButtonVar }))` where the `has` locator is a variable chained off the walk/row. A `has`
  locator is evaluated relative to the filtered element, so a chained one never matches and
  `skipUntil` skips EVERY card to the end screen ("N cards skipped, not ready to list").
  Root the inner locator at `page`.

**Why:** found on the first rewrite (team-link alias spec, 2026-11-22). **How to apply:** any
walk spec on a sole-writer fixture; check the end-screen line in `error-context.md` first.
