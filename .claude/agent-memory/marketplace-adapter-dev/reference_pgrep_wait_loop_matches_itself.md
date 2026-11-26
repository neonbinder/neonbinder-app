---
name: pgrep-wait-loop-matches-itself
description: an `until ! pgrep -f "<tool>"` wait loop in the Bash tool matches its own shell line and never ends; wait on a pid with kill -0
metadata:
  type: reference
---

The harness runs a command as `zsh -c '... eval "<your command>"'`, so
`pgrep -f eslint` inside the loop finds the loop's own shell and the wait
never ends (it was moved to the background after 180 s). Read the target pid
once (`pgrep -fl "node_modules/.bin/eslint"` from a separate call) and loop
on `kill -0 <pid>`, or run the gate itself with `run_in_background` and wait
for its notification.
