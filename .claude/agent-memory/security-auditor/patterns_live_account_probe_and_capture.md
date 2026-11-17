---
name: patterns-live-account-probe-and-capture
description: Read-only probes and one-shot write captures against a real seller account (NEO-555 eBay) - lexical egress scan is a tripwire; finally is not cleanup on a signal; stderr EPIPE/EIO kills a guarded run
metadata:
  type: feedback
---

Two traps when a probe or recorder touches a REAL marketplace account.

1. **Source-scan egress guards are bypassable; put the guard in the transport.**
   A test that greps the probe module for `\bfetch\w*\s*\(` and quoted
   `"POST|PUT|DELETE|PATCH"` misses `ctx.fetchImpl.call(...)` /
   `Reflect.apply(fetchImpl, ...)` (no `(` right after the name) and a
   lowercase `method: "delete"` (WHATWG fetch upper-cases delete/get/head/
   options/post/put itself). It also never sees a helper imported from another
   module. The runtime guards that held were: entry-by-reference allowlist in
   the one GET helper, and a wrapping transport on the token client that
   refuses any URL/method/grant but its own. Ask for the raw `fetchImpl` to be
   wrapped ONCE at router construction (only GET to allowlisted URLs, only POST
   to the token URL with an allowed grant), so new code cannot reach the raw
   client, and keep the scan as a tripwire with a case-insensitive method regex
   plus a pinned import list.

2. **`finally` does not run on Ctrl-C.** Node exits on SIGINT/SIGHUP without
   unwinding, so a capture that publishes a live listing and withdraws it in
   `finally` leaves it live if the operator interrupts mid-window. Require a
   signal handler armed for the write window that defers exit until cleanup and
   verification finish (second signal = print the undo command and exit).

3. **try/catch around `process.stderr.write` is not a guard.** A write to a
   closed stream (EPIPE from a dead `| tee`, EIO from a hung-up terminal) is
   delivered as an async `'error'` event; with no listener the process dies with
   an uncaught exception, mid-cleanup. Verified on Node 24 with a closed pipe:
   try/catch -> exit 1, cleanup skipped; `process.stderr.on("error", noop)` ->
   cleanup runs. A SIGHUP guard that reports to the terminal is the trigger
   itself. `console.*` is safe (it swallows write errors); raw
   `process.stdout/stderr.write` is not. Ask for a no-op error listener on both
   std streams for the guarded window.

4. **A workflow step that moves inline shell into `.github/scripts/` needs a
   checkout in EVERY job that calls it.** Grep each job for `actions/checkout`
   before the first `$GITHUB_WORKSPACE/.github/scripts/` use; a missing file
   inside `if ! out=$(bash ...)` reads as the script's own refusal, not a crash.

**Why:** NEO-555 audit (prod eBay probe + one-listing prod capture on the
operator's own account; eBay has no separate prod test seller).

**How to apply:** any probe, drift job or recorder holding a real seller token:
check where the transport is constrained (not just linted), whether a
write-capable scope fallback exists, what the public artifact reveals about
account activity (path presence = "has orders"), and the interrupt path of any
create-then-undo sequence. Related: [[patterns-neo281-probe-verdicts]],
[[patterns-shared-cache-host-gate]].
