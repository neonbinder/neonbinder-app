---
name: patterns-live-account-probe-and-capture
description: Read-only probes and one-shot write captures against a real seller account (NEO-555 eBay) - why a lexical egress scan is a tripwire not a guarantee, and why a finally block is not a cleanup guarantee
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

**Why:** NEO-555 audit (prod eBay probe + one-listing prod capture on the
operator's own account; eBay has no separate prod test seller).

**How to apply:** any probe, drift job or recorder holding a real seller token:
check where the transport is constrained (not just linted), whether a
write-capable scope fallback exists, what the public artifact reveals about
account activity (path presence = "has orders"), and the interrupt path of any
create-then-undo sequence. Related: [[patterns-neo281-probe-verdicts]],
[[patterns-shared-cache-host-gate]].
