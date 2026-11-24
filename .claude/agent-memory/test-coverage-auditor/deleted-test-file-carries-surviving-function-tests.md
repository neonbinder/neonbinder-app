---
name: deleted-test-file-carries-surviving-function-tests
description: when a feature is removed and its test file deleted, the same file may also hold the only tests of a function that survives; diff the deleted file's describe names against surviving exports
metadata:
  type: feedback
---

A feature removal (e.g. a "held" path) deleted a whole convex test file. Its last
describe block tested a sibling query that stayed in the product (place-to-team
settling: league filter, saturated search window, cap, over-long text), and no
other file tested it.

**Why:** the removal looked like pure deletion in the stat, so the surviving
guards (a rule-8 "never guess" window check) silently lost their only test.

**How to apply:** for every deleted `*.test.*`, list its describe/test names
(`git show <base>:path | grep -E "describe|test\("`), map each to the function
under test, and `grep -rl` that function in tests at HEAD. Anything exported and
still called with no test is a finding. Related: [[websocket-faked-query-masks-transitions]].
