---
name: neo645-tidy-test-patterns
description: NEO-645 tidy backend test recipes - id-only world fixture, fan-out via drainScheduled, commit-action fixtures
metadata:
  type: reference
---
- Shared fixture lib/testing/tidy-world.ts returns IDs only (closures break t.run serialisation); use addPlayer/addTeam/printCard/nameRow.
- Fan-out tests: answer, then drainScheduled(t); cancelScheduled in afterEach.
- Commit action: nb-pick of a source disagreement needs the name also in card.players (prelude resolves only listed names).
- Career tier teamFill adds a tidyChecks entry; assert absence by kind, not by empty array.
- Career coverage rule: a stint covers a card when fromYear <= card year (end year irrelevant).
