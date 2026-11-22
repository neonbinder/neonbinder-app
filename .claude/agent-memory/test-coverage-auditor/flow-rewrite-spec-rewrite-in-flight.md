---
name: flow-rewrite-spec-rewrite-in-flight
description: Big flow replacement PRs leave old-UI specs alive behind a compat helper; audit by grepping old UI strings in code lines, not comments
metadata:
  type: project
---

When a whole flow (wizard, walker) is replaced and specs are rewritten in waves:

- A compat support file (old helper names mapped onto the new one) keeps imports compiling, so
  specs still driving the OLD UI only go red at run time. Grep specs for the old UI's strings on
  non-comment lines and list each as unrewritten; do not trust "N specs import the helper".
- Ported unit tests (`*.ported.test.ts`) drop the old audit-log lines (observability) and batch
  mechanics; check the retired list exists in the report, not just in a header comment.
- Rules whose only live proof was the old spec (for example "a fallback list is offered, never
  preselected") often survive only in a component test after the rewrite; name them as E2E gaps.
- A helper that branches with `if (await x.isVisible())` after an `.or()` wait is fine; one that
  branches with no prior wait (settle-after-commit using a pill) can pass with the screen shut.
- Seed/setup specs that auto-answer a new flow prove none of it; a suspiciously fast setup run
  needs a planted break before it is trusted.

**How to apply:** ask for planted-break proof on shared walk helpers and list unrewritten specs by name.
