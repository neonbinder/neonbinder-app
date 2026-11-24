---
name: reference_macos_has_no_timeout_command
description: macOS agent shells have no `timeout`; `timeout 300 npx tsc ... | grep` fails with command-not-found and the grep then proves nothing
metadata:
  type: reference
---

`timeout N cmd | grep file` on macOS prints nothing because `timeout` is not found, which reads exactly
like a clean "no errors in my files" result. Run the root `npx tsc -p . --noEmit` in the background to a
log file (it takes minutes and is red at baseline, ~600 errors), wait with an `until grep -q done` loop,
then grep the log for your own paths and also check the error count is non-zero (a zero count means it did not run).
Same family as [[reference_apps_web_root_tsc_is_red_at_baseline]].
