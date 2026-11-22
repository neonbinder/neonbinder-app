---
name: monitor-watches-cap-at-30-minutes
description: Monitor has no persistent mode — every watch is killed at timeout_ms (max 30 min) and must be re-armed; every stdout line wakes the session
metadata:
  type: project
---

The Monitor tool takes `timeout_ms` (default 5 min, capped at 30 min) and no `persistent` flag; at expiry the script is killed and the session gets one notice. Each stdout line is a wake of the whole context (~200K for the coordinator).

**Why:** pr-watch printed every 120 s (about 3,500 wakes in 14 days) and lost its start time on every 30-minute re-arm (NEO-622); retired in NEO-648 for a single background `gh` wait.
**How to apply:** a watcher script prints only on a state change plus its terminal line, keeps its start time and last-printed state in a file keyed by PR + SHA so a re-arm resumes silently, and the skill passes `timeout_ms: 1800000`. A wait that needs exactly one notification is Bash `run_in_background`, not Monitor. See [[agent-tool-allowlists-what-the-transcripts-show]].
