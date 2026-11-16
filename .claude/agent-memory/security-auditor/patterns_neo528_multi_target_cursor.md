---
name: patterns-neo528-multi-target-cursor
description: Client-driven bulk run over a re-derived target list with a {i, c} cursor - the positional index shifts when rows are inserted mid-run; bind the target id; option-gated facts read unconditionally
metadata:
  type: project
---

NEO-528 bulk add/remove of a cameo player walks `[home, ...parallels]` re-derived on EVERY page
(`bulkTargets`), with a client-held cursor `{ i, c }` (target index + Convex page cursor).

- **Positional index into a re-derived list is not stable.** Children come from
  `by_level_and_parent` per parent type, concatenated; a row created under an earlier parent
  mid-run shifts every later index, so `i` names a different row and `c` (a page cursor for the
  OLD row's range) is fed to a different range. Fix shape: put the target `_id` in the cursor
  and refuse (or restart that target) when `targets[i]._id` differs.
- `parseCursor` type-checks the JSON but a forged `c` is only bounded by the `eq(selectorOptionId)`
  range; under `requireAdmin` the blast radius is the admin's own run (skips cards), so note/should-fix.
- **Fact builders:** a reader that fetches option-gated facts (cameo players) for every card,
  whether the option is on or not, adds point reads to every rule evaluation (planFits walks up to
  MAX_CANDIDATES). Ask for the read to be gated on the option.
- Ownership of `ruleFits`/`matchingCards` lives in the shared `fitsOf` -> `ownBinder`; neither had a
  cross-owner test when NEO-528 landed. Check one exists whenever a new signed-in read shares it.

Related: [[patterns-neo495-scoped-capped-list]], [[public-function-auth-registry]]
