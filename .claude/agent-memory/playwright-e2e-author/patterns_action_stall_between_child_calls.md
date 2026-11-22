---
name: action-stall-between-child-calls
description: How to tell a Convex action that sat idle between its child calls (a runtime stall) from a slow marketplace or slow reads, using the convex-logs artifact grouped by requestId
metadata:
  type: project
---

A red that reads "our own time 7.1 s, BuySportsCards held it 0.0 s" with the
busy button ("Fetching...") still on screen can be neither BSC nor NB code: in
NEO-592's run, `fetchBscChecklist` sat idle for 27 s between
`getBscToken` completing and its next child call (`bscCallGate:acquire`), with
no reads or writes in between. The BSC call itself took 124 ms.

**How to see it:** group the convex-logs jsonl by `requestId` (every child of
one client call shares it). For each request, compare a child's
`executionTimestamp + executionTime` with the next child's
`executionTimestamp`. The healthy gap from token end to gate acquire is about
0.03 s (median of ~145 calls a run); a gap of seconds with no other child in
between means the action was not running its own code. The `bsc_call_summary`
log line (calls, status, latency buckets) confirms what BSC actually took.

**Why the wait line stayed empty:** with a second source (published
checklist), CardChecklist sets the pairing phase to review at the press, which
turns the page's wait line off, and the Match Cards dialog (which carries its
own) mounts only once streamed candidates exist. Before the first candidate,
no "Waiting on BuySportsCards" line can show.

**How to apply:** open the artifact first (screenshot + error-context), then
run the requestId gap check before blaming BSC, slow reads (NEO-594) or the
commit (NEO-599). Compare against the same check on an earlier green run's
logs. See never diagnose timing first (GUIDE).
