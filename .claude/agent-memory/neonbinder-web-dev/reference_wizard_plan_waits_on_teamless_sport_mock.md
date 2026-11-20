---
name: wizard-plan-waits-on-teamless-sport-mock
description: EntityReviewWizard component tests must answer sportTeamless.listTeamlessSportIds or the progress plan never starts and the bar reads 0 (vacuous percent asserts)
metadata:
  type: reference
---

The wizard only starts its step plan (`trackSteps`) once `teamsStepKnown`, which waits on the
`sportTeamless.listTeamlessSportIds` query. A test whose `useQuery` mock returns `undefined` for it
leaves the bar at `aria-valuenow` 0 on every screen, including Save, so `percent()` asserts pass or
fail for the wrong reason. Add `if (ref === "sportTeamless.listTeamlessSportIds") return [];` to the mock
(the steps and autograph tests already do).

When merging a main branch that adds a wizard step onto the progress-bar model: port the step into
`entity-review-steps.ts` (kind, subtitle, POST_REVIEW_ORDER, StepPlanInput/StepCount, plannedTotal,
stepNumber, TrackStepsInput) and delete anything that fed the growth line (`position`, `WALK_RANK`).
Specs read the step off the bar (`expectWizardStep`, `readProgress`, `expectPostNameStepLeft`), never a counter.
