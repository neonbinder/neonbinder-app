---
name: names-first-pair-core-shapes-the-fetch-tests
description: After the names-first core, old fetchCardChecklist test fixtures that used a letter-prefixed SportLots number ("T-10") or a different-player sibling pair now pair by number or by name; how to keep a fixture testing what it meant to
metadata:
  type: reference
---

`pairNamesFirst` (lib/cards/pair-names-first.ts) reads a LETTER PREFIX off a number in its
number pass ("T-10" == "10"), and treats a repeated number as blocking only number-keyed
pairing. So fixtures written for the old `slByNumber` rules change meaning:

- A "name below 0.92 does not pair" or "near name pairs" fixture with SL "T-10" against BSC "10"
  now pairs by NUMBER at 1.0. Use a number that agrees with nothing ("T-99").
- A sticky-pairing fixture whose wrong guess was "same number, different player" is now told
  apart by name. Make the sibling card the SAME player so only the number can pair it.
- A near-name pair with differing numbers is score x 0.9, so it can sit below 0.92.
- Candidate rows carry `sourceNumbers` ({bsc, sportlots, checklist}); read stored rows with
  `t.run(ctx.db.query("checklistCandidates"))` when a field is not on the live view.
- An existing NB card is never renumbered by a re-sync: cardNumber is not in NB_CONTENT_FIELDS,
  and the commit matches by marketplace ref first. Pin it with fetch then commit of the staged card.
