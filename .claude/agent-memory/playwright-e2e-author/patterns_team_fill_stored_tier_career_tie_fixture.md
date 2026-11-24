---
name: patterns-team-fill-stored-tier-career-tie-fixture
description: Prove the commit's stored-tier team fill (Base card -> insert card) and "another insert is not evidence" by giving every player a career TIE, so the career tier can never be the filler
metadata:
  type: project
---

The commit's team fill (`planCardFill`) tries stored evidence (this node, a parallel's source,
the set's Base; `cardChecklist.storedTeamEvidence`) before the career tier. To prove the stored
tier alone, give each player TWO stints covering the set year (2020-2025 and year-year): the
career tier then answers nothing, and each printed team (Base / other insert) is in the career,
so neither fixture commit has a Career gap or opens the walk (`settleWalkAfterCommit` -> false).

- Hand-made Base: `drillToCustom` to the set, then `selectOrCreate(page, "Variant Types", "Base", { via: "list" })`;
  inserts via `drillToCustom(..., variantType: "Insert", variant)`. `tidyUpName` omits Base.
- Players: `addPlayerByHand` + `createTeamInCareerEditor` x2 + `addCareerStint` x2 + Save.
- The filled card has no stop, so it is absent from the walk (`expectCardsLeft(1)`, `#1 · ` count 0);
  read it back with `teamChip(drawer, team)`.
- Plants that go red: stored "answer" ignored in `planCardFill` (Ann's card enters the walk);
  `storedTeamEvidence` treating another node's card as this node's (Bob filled, walk never opens).
  `plant` `find` is a substring: `cardChecklist.ts` has the `relevantNodes.has` line twice at two
  indents, so anchor with a leading `\n` + exact indent.

**How to apply:** any spec on fill tiers. Spec: `tidy-up-team-fill-takes-the-players-base-team-never-another-inserts`.
Related: [[patterns-team-fill-career-tier-fixture]].
