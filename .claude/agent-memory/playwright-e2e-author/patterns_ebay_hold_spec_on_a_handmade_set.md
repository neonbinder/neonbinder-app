---
name: ebay-hold-spec-on-a-handmade-set
description: NEO-535 eBay over-80 hold spec - how an over-80 stored title is made, what a hold-only run shows on Sync status, the shared runOver80Flow helper and connectEbayAndFinishSetup
metadata:
  type: reference
---

- **An over-80 stored title can only come from the generator.** `updateCard` refuses a TYPED title over 80, so the fixture is a hand-made card under a 60-character insert (`card-title-uses-short-name-for-titles` card C): every cut leaves it at 99 and it is kept whole. Compute the length with the bundled generator ([[patterns_title_fixture_arithmetic]]); a team on the card does not change it (teams are cut first). The fix path is typing a shorter title in the set builder drawer: fill, Enter, `Saved Card title`.
- **eBay needs no marketplace ids.** A hand-made set under real Baseball > 2024 > Topps lists on eBay; the collector cascade (`drillToCollectorChecklist` with `checklist: { type: "Insert", name }`) reaches it and the checklist/Sync label is `<year> <set> <insert>`. The hold order in the drain is photo, then required aspect, then title, so the card needs a photo and its facts (player, team, number) or it is held for the wrong reason.
- **A hold-only eBay run** reads `0 listed, 1 skipped` plus `1 held back:` and a list item that is a link named `#<number> <card> <sentence>`; its folded ledger is `Gathering data` (+ `Nothing new to send`) with no `List the cards` / `Set prices` / `Go live` step. Assert the absence of the sending steps next to the positive `gathered()`. Poll-first and press-first give the same end state for a hold.
- **A save that re-queues** shows the card under `Queued for the next sync` on Sync status with no Sync pressed (row text `<number> ... in <set label>`).
- **No seller tag any more (NEO-555).** eBay is the fake, one seller per test user, so the over-80 pair runs in the ordinary shards on both projects: no tag, no list entry, ordinary retries. No spec carries a scheduling tag since NEO-628 retired `@bsc-breaker` too (the BSC call gate is per test user on the fake).
- **eBay setup has one shared helper**: `connectEbayAndFinishSetup(page, ebayFake, { gate })` in `support/credentials.ts` (policies seeded on the fake, ships-from, Set me up when offered, a pick per slot, "You're all set"). Use it when the setup is the means; only `profile/ebay-connect-and-setup` drives each step as the subject.
- **Share a flow between twin specs** through a local non-spec helper beside them (`tests/collection/ebay-over-80-title-fixture.ts`, `runOver80Flow(args, through)`). `playwright/expect-expect` warns on a spec that only calls the helper; end it with a real end-state assert (Profile, eBay not connected).
