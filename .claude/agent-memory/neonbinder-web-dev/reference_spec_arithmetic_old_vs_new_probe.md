---
name: spec-arithmetic-old-vs-new-probe
description: To recompute an E2E spec's title arithmetic after a builder change, run HEAD's module and the edited one side by side in one scratch vitest probe; the OLD leg must reproduce the spec's numbers first
metadata:
  type: reference
---

When a change to a pure builder (title generator, carried-title order) shifts the
numbers an E2E spec hard-codes (failing counts, which card numbers fail, a carried
title), compute the new numbers without running E2E:

1. `git show HEAD:<path>` each changed module into a temporary `convex/features/zzold_*.ts`
   (sed its sibling imports to the zzold copies).
2. A temporary `convex/features/zzprobe.test.ts` reads the spec's fixture CSV with
   `readFileSync` (the network guard only blocks sockets), builds inputs for every
   row, runs OLD and NEW, and writes results with `appendFileSync` to the scratchpad
   (console output from a passing test is hidden, see [[vitest-console-hidden-in-passing-tests]]).
3. Trust the NEW numbers only if the OLD leg reproduces the spec's stated numbers
   exactly; that proves the probe's inputs model the spec.
4. When the change dissolves the scenario (nothing fails any more), search for a
   replacement constant that restores it and report it; never edit playwright/ yourself.
5. Run with `npx vitest run <file>` (no `--project`), then delete every zz file.

**Why:** NEO-535 removed the doubled insert word from parallel descriptions, which
silently dissolved the Bowman spec's carried-title step. The OLD leg matched the
spec to the character, so the NEW numbers could go to the E2E author with confidence.
