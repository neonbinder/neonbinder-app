---
name: neo581-countseq-and-busy-window
description: NEO-581 door count-token tests - which seq checks are observable, and why the busy-at-zero label window cannot be bitten
metadata:
  type: reference
---

- ParallelTitlesDoor `countSeq`: the mount recount is always OLDER than any press/auto-open load, so the recount's `token === countSeq.current` check bites (hold the mount query, press, then resolve the mount read last). The same check inside `open` cannot be reached from props (loadingRef blocks a double press) - an equivalent mutant.
- Panel `lastTitleTotal` / `titlesBusy`: the zero count and `settle()` land in one React batch (microtasks only, no macrotask), so "name at zero while busy" is never rendered; dropping either guard stays green. A MutationObserver test on the button name is a characterization, not a guard. Do not claim it bites.
- Break-check on macOS needs `sed -i ''`; a bare `sed -i` fails silently into a green "break".
