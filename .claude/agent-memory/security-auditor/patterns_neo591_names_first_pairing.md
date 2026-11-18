---
name: neo591-names-first-pairing
description: NEO-591 names-first pairing core and variations-by-stem; a number the fetch MINTS or re-derives feeds the commit's number-keyed match tiers, and a parent the fetch knew is re-guessed by stem at commit
metadata:
  type: project
---

NEO-591 replaced the BSC/SportLots and checklist matchers with one pure core
(`lib/cards/pair-names-first.ts`): bucket-by-key, linear, T3 delegated to the
capped `pairNamesBySimilarity`. Auth and bounds held: `sourceNumbers` clipped
before `startCandidateBatch` (which also refuses >64), `sourceNumbers` and
`preKept` accepted on the commit arg and read by nothing, `variationName`
control-stripped and capped by `checkPublishedChecklist` on every path in
(paste, stored, pairs action). The chunk's update branch never writes
`cardNumber` (not in `NB_CONTENT_FIELDS`), so a changed incoming number never
renumbers an existing row.

Durable traps:

- **A fabricated number reaches the number tiers.** `resolveExistingIds` runs
  slot+number and the no-ref number tier for ANY card whose refs missed,
  including one carrying a ref. A number the fetch minted (SL-only bare-stem
  variation -> "38b" by list order) or swapped in (`preferCardNumber`) is then
  treated as printed identity and can attach a marketplace ref to an NB row
  that only shares the minted label. Ask of any new number derivation: can it
  reach `noRefMatchKey` / `slotNumberMatchKey` on commit?
- **Parent known at fetch, re-guessed at commit.** The core returns
  `parentIndex` for a stem sibling, but the commit links the unattributed
  child by "exactly one non-variation with this stem across the whole
  commit", i.e. across partitions the NEO-203 comment says are unsafe to
  mix. Exactly-one guard holds rule 7 on paper; carrying an NB-side parent
  key would remove the guess.
- **Per-stem whole-array filter in the commit action** is O(stems x cards);
  ~1.4 s at the 5000-card cap in node. Precompute stem -> non-variation
  indices once.

See [[patterns_checklist_commit_trust_boundary]], [[neo219-sanctioned-delete]].
