---
name: card-pairing-is-names-first-two-matchers
description: Card pairing lives in TWO server matchers (BSC vs SportLots in fetchCardChecklist step 1a-1c; checklist vs cards in lib/checklists/match-published-checklist.ts); number "kinds" must never partition the name passes (NNO rows vs lettered numbers paired 0 of 56 on Onyx)
metadata:
  type: project
---

Rule 7 was rewritten 2026-11-18 (NEO-591): match on names first, numbers confirm;
NB number prefers letters > digits > NNO. Card pairing happens in two server-side
places and one client merge:

- BSC vs SportLots: `convex/selectorOptions.ts` fetchCardChecklist, steps 1a (identity:
  stored operator pairing, BSC's sportlotsRef cross-ref, variation label pairing by stem,
  then number lookups) and 1b (Jaro-Winkler fallback). Step 3c then runs the checklist matcher
  over the merged `out` list.
- Checklist vs marketplace cards: `matchPublishedChecklist` (pure, lib).
- Hand links: `mergePair` in CardPairingModal (BSC+SL), `applyChecklistAnswers` (checklist row).
  Match Cards has NO client-side auto-pairing.

**Why:** the matcher split cards and rows into "numbered" and "no-number" kinds and never paired
across them, so BSC "OV-ANFI" against an all-NNO publisher PDF paired nothing and every card was
reported as a misread. Reproduce any pairing claim with a tsx harness against the pure function
before trusting a plan's description of it.

**How to apply:** a names-first change touches both matchers through one shared pure core; the
operator's stored pairing and BSC's cross-ref stay ahead of names (they are links, not numbers).
The existing UI already has a % cell and a "Checklist: #n" chip for name pairs. D2 (a repeated
number sits out the name passes) is the decision names-first collides with; see
[[publisher-checklist-is-a-match-cards-source]], [[checklist-pairing-modal-absorbs-only-teams]].
