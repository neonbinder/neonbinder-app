/**
 * NEO-335 — the step plan for the tidy-up wizard. Pure: no React, no Convex.
 *
 * NEO-467 (Jason, 2026-11-07): the header shows a progress bar, not "Step x
 * of y", so the plan only has to be reasonably accurate. The sitting is a
 * list of steps:
 *
 *     planned = 1 checklist step       (NEO-478, FIRST: a card the operator's
 *                                       published checklist disagrees with)
 *             + review rows            (one per name: New league / New team /
 *                                       New player / "Which player is this?",
 *                                       staged career New Team/League steps
 *                                       included — they are rows too)
 *             + 1 career step          (NEO-574: a card's team that its
 *                                       player's career does not show, FIRST
 *                                       after the names: it can change a
 *                                       card's player or team, which the
 *                                       steps below read)
 *             + 1 teams step           (if any card would save teamless)
 *             + 1 autograph step       (NEO-345: a NEW card carries AU and the
 *                                       leaf has no autograph format yet)
 *             + 1 titles step          (if any card title needs a look)
 *             + 1 save step
 *
 * The bar's fill is steps done ÷ steps planned (`stepProgress`), and Save is
 * always full.
 *
 * - **The plan never shrinks during a sitting.** Every input is a high-water
 *   mark: review rows by count, the teams and titles steps once present. A
 *   counted step that turns out to have nothing in it is passed over, so the
 *   bar jumps forward.
 * - **It grows on an operator decision or a staged career step**, and the bar
 *   stalls rather than moving back (`WizardChrome` holds its high-water mark).
 *   The teams step is judged OPTIMISTICALLY while names are still being
 *   reviewed (`cardsForTeamsStep`), so it appears up front for cards that
 *   print no team at all.
 * - **Nothing is added while the operator is on Save.** The plan freezes
 *   there; anything that turns up after is the post-save walker's to catch.
 */
import { isAmbiguousPlayerRow, type NavRow } from "./entity-review-nav";
import {
  AUTOGRAPH_FORMATS,
  carriesAutographToken,
  isAutographFormat,
  type AutographFormat,
} from "../../convex/features/deriveCardFeatures";
import {
  teamlessCardIndexes,
  type PreviewCardForTeams,
  type StoredPeople,
  type TeamsReviewRow,
} from "./teams-on-cards";

/** Every kind of screen the wizard walks. */
export type WizardStepKind =
  | "league"
  | "team"
  | "player"
  | "pick"
  | "checklist"
  | "career"
  | "teams"
  | "autograph"
  | "titles"
  | "save";

/**
 * The subtitle under the "Tidy up <the set>" title, per screen type. Jason-approved copy,
 * except `autograph` (NEO-345), which is a placeholder awaiting his wording.
 */
export const STEP_SUBTITLE: Readonly<Record<WizardStepKind, string>> = {
  league: "New league",
  team: "New team",
  player: "New player",
  pick: "Which player is this?",
  checklist: "Checklist disagreements",
  career: "Career check",
  teams: "Cards with no team",
  autograph: "Autographed cards",
  titles: "Card titles",
  save: "Ready to save",
};

/**
 * The steps after the names, in the order the wizard walks them. The
 * autograph step sits before titles because a title reads `autographed`.
 *
 * NEO-478's "checklist" step is a screen of the same family but it is NOT in
 * this order: it comes BEFORE the names. Its answer decides which players and
 * teams the cards carry, so a name only the losing side carried is dropped
 * from the walk instead of being asked about (`orphanedReviewRowIds`). The
 * wizard puts it on screen itself until it is settled.
 */
export type PostReviewStep =
  | "checklist"
  | "career"
  | "teams"
  | "autograph"
  | "titles"
  | "save";

/** Which post-review steps have anything in them right now. */
export type PostReviewLive = {
  /**
   * NEO-478 — absent reads as false (a host with no checklist step). Not walked
   * by the post-review helpers: the checklist step comes before the names.
   */
  checklist?: boolean;
  /**
   * NEO-574 — absent reads as false (a host with no career check). First of
   * the steps after the names: its answers can re-team or relink a card, and
   * every step below reads the cards as they are after it.
   */
  career?: boolean;
  teams: boolean;
  /** NEO-345 — absent reads as false (a host with no autograph step). */
  autograph?: boolean;
  titles: boolean;
};

const POST_REVIEW_ORDER: readonly PostReviewStep[] = [
  "career",
  "teams",
  "autograph",
  "titles",
  "save",
];

function isLive(step: PostReviewStep, live: PostReviewLive): boolean {
  return step === "save" || live[step] === true;
}

// ---------------------------------------------------------------------------
// NEO-345 — the autograph format question.
//
// An autograph's FORMAT (on the card, or on a sticker) is NB data the
// operator supplies once per synced leaf; no marketplace says which it is.
// The wizard asks for it when a card the save will CREATE carries the "AU"
// attribute and the leaf has no format yet, and the answer travels as the
// commit's batch-level `autographFormat`.
// ---------------------------------------------------------------------------

/**
 * The two answers, as stored in the leaf's `features.autographFormat` — the
 * backend's own vocabulary and predicates (`deriveCardFeatures.ts`, a pure
 * module), so the step's on/off rule is the commit's.
 */
export { AUTOGRAPH_FORMATS, type AutographFormat };

/**
 * The two answers' display names, keyed by the stored value — the wizard's
 * tiles, the checklist prompt's buttons and the Attributes panel's select (under
 * "Edit attributes") all say
 * these words (NEO-345 a11y: one name per answer everywhere).
 */
export const AUTOGRAPH_CHOICE_LABEL: Readonly<Record<AutographFormat, string>> = {
  "On Card": "On card",
  "Sticker/Label": "Sticker",
};

/** A stored value read back as one of the two answers (anything else is none). */
export function asAutographFormat(value: string | undefined | null): AutographFormat | undefined {
  return isAutographFormat(value) ? value : undefined;
}

/** Does this attribute list carry the autograph token? Case-folded, trimmed. */
export function carriesAutograph(attributes: readonly string[] | undefined): boolean {
  return carriesAutographToken(attributes);
}

/**
 * Positions in `cards` the autograph step is about: cards the save will
 * CREATE (not in `existingIndexes`, which re-sync a stored row) that carry
 * "AU". A re-synced row keeps its own features; the stored-leaf prompt in the
 * checklist header is where those are answered.
 */
export function autographCardIndexes(
  cards: readonly { attributes?: readonly string[] }[],
  existingIndexes: readonly number[] = [],
): number[] {
  const existing = new Set(existingIndexes);
  const out: number[] = [];
  cards.forEach((card, i) => {
    if (!existing.has(i) && carriesAutograph(card.attributes)) out.push(i);
  });
  return out;
}

/**
 * Where the operator is. `review.index` is 0-based among the review rows.
 */
export type StepPosition =
  | { kind: "review"; index: number }
  | { kind: PostReviewStep };

/** What the wizard can see right now. */
export interface StepPlanInput {
  /** Review rows in the batch (0 in a teams-only sitting). */
  reviewRows: number;
  /** NEO-478 — does any card disagree with the published checklist? Absent = no. */
  checklistStep?: boolean;
  /** NEO-574 — is any card's team missing from its player's career? Absent = no. */
  careerStep?: boolean;
  /** Would any card save teamless? See `cardsForTeamsStep`. */
  teamsStep: boolean;
  /** NEO-345 — does the autograph format question apply? Absent = no. */
  autographStep?: boolean;
  /** Is any card title waiting for a look? */
  titlesStep: boolean;
}

/** The counted plan — every field a high-water mark. */
export interface StepCount {
  total: number;
  reviewRows: number;
  /**
   * NEO-478 — the checklist step, once counted. Present only when true, so a
   * count with no checklist step is exactly the shape it was before.
   */
  checklistStep?: boolean;
  /** NEO-574 — the career step, once counted. Present only when true. */
  careerStep?: boolean;
  teamsStep: boolean;
  /** NEO-345 — the autograph step, once counted. */
  autographStep: boolean;
  titlesStep: boolean;
  /** On Save: nothing more is added. */
  frozen: boolean;
}

/** The steps in a plan, with no history. */
export function plannedTotal(input: StepPlanInput): number {
  return (
    Math.max(0, input.reviewRows) +
    (input.checklistStep ? 1 : 0) +
    (input.careerStep ? 1 : 0) +
    (input.teamsStep ? 1 : 0) +
    (input.autographStep ? 1 : 0) +
    (input.titlesStep ? 1 : 0) +
    1
  );
}

/** The first count of a sitting. */
export function initialStepCount(input: StepPlanInput, onSave = false): StepCount {
  const reviewRows = Math.max(0, input.reviewRows);
  return {
    total: plannedTotal({ ...input, reviewRows }),
    reviewRows,
    ...(input.checklistStep ? { checklistStep: true } : {}),
    ...(input.careerStep ? { careerStep: true } : {}),
    teamsStep: input.teamsStep,
    autographStep: input.autographStep === true,
    titlesStep: input.titlesStep,
    frozen: onSave,
  };
}

/**
 * The next count: never smaller than `prev`, unchanged while on Save.
 * Returns `prev` itself (same object) when nothing moved, so a caller can
 * compare by identity.
 */
export function advanceStepCount(
  prev: StepCount,
  input: StepPlanInput,
  onSave: boolean,
): StepCount {
  // On Save — and the move ONTO Save — adds nothing. Steps that turn up now
  // are the walker's, after the save.
  if (onSave) return prev.frozen ? prev : { ...prev, frozen: true };
  // Off Save (again): a thaw, then whatever turned up meanwhile counts.
  const reviewRows = Math.max(prev.reviewRows, input.reviewRows);
  const checklistStep = prev.checklistStep === true || input.checklistStep === true;
  const careerStep = prev.careerStep === true || input.careerStep === true;
  const teamsStep = prev.teamsStep || input.teamsStep;
  const autographStep = prev.autographStep || input.autographStep === true;
  const titlesStep = prev.titlesStep || input.titlesStep;
  if (
    reviewRows === prev.reviewRows &&
    checklistStep === (prev.checklistStep === true) &&
    careerStep === (prev.careerStep === true) &&
    teamsStep === prev.teamsStep &&
    autographStep === prev.autographStep &&
    titlesStep === prev.titlesStep
  ) {
    return prev.frozen ? { ...prev, frozen: false } : prev;
  }
  return {
    total: plannedTotal({
      reviewRows,
      checklistStep,
      careerStep,
      teamsStep,
      autographStep,
      titlesStep,
    }),
    reviewRows,
    ...(checklistStep ? { checklistStep: true } : {}),
    ...(careerStep ? { careerStep: true } : {}),
    teamsStep,
    autographStep,
    titlesStep,
    frozen: false,
  };
}

/** The steps after the names that are counted (NEO-478: the checklist step is before them). */
function postReviewSteps(count: StepCount): number {
  return (
    1 +
    (count.careerStep ? 1 : 0) +
    (count.teamsStep ? 1 : 0) +
    (count.autographStep ? 1 : 0) +
    (count.titlesStep ? 1 : 0)
  );
}

/**
 * The 1-based place of a position in the plan. Post-review steps are counted
 * back from the END, so Save is always the last step whatever the high-water
 * marks did on the way.
 */
export function stepNumber(count: StepCount, position: StepPosition): number {
  switch (position.kind) {
    case "save":
      return count.total;
    case "titles":
      return count.total - 1;
    case "autograph":
      return count.total - 1 - (count.titlesStep ? 1 : 0);
    case "teams":
      return (
        count.total - 1 - (count.titlesStep ? 1 : 0) - (count.autographStep ? 1 : 0)
      );
    case "career":
      // NEO-574 — first of the steps after the names, so counted back from
      // the end like its siblings.
      return (
        count.total -
        1 -
        (count.titlesStep ? 1 : 0) -
        (count.autographStep ? 1 : 0) -
        (count.teamsStep ? 1 : 0)
      );
    case "checklist":
      // NEO-478 — the first step of the sitting.
      return 1;
    case "review": {
      const before = count.checklistStep ? 1 : 0;
      const last = Math.max(1 + before, count.total - postReviewSteps(count));
      return Math.min(last, Math.max(1 + before, position.index + 1 + before));
    }
  }
}

/**
 * NEO-467 — what the progress bar reads: the steps behind the one on screen,
 * out of the plan. Save is full.
 */
export function stepProgress(
  count: StepCount,
  position: StepPosition,
): { done: number; planned: number } {
  const planned = count.total;
  if (position.kind === "save") return { done: planned, planned };
  return { done: Math.max(0, stepNumber(count, position) - 1), planned };
}

/**
 * The 0-based review step for the row on screen.
 *
 * An undecided row is the next one to do: every decided row is behind it, so
 * it is step `decided + 1` — which is what makes the bar step forward one
 * at a time however the walk reorders (teams first, staged steps ahead of
 * their player). A decided row being read back sits at its place among the
 * decided rows, in batch order. With nothing on screen (names still being
 * looked up) the next step is still `decided + 1`.
 */
export function reviewStepIndex(
  rows: readonly Pick<NavRow, "_id" | "decision">[],
  currentRowId: string | null,
): number {
  const current = currentRowId ? rows.find((r) => r._id === currentRowId) : undefined;
  if (current?.decision) {
    let before = 0;
    for (const row of rows) {
      if (row._id === current._id) break;
      if (row.decision) before += 1;
    }
    return before;
  }
  const decided = rows.reduce((n, r) => n + (r.decision ? 1 : 0), 0);
  return Math.min(decided, Math.max(0, rows.length - 1));
}

/**
 * The screen type for a review row. `pick` — the row is on its NEO-332 pick
 * step ("Which player is this?"); the New Player step "Create new" opens is a
 * player step.
 */
export function reviewStepKind(
  row: Pick<NavRow, "kind">,
  opts: { pick?: boolean } = {},
): WizardStepKind {
  if (row.kind === "league") return "league";
  if (row.kind === "team") return "team";
  return opts.pick ? "pick" : "player";
}

/**
 * The step the walk reaches next while nothing is on screen (lookups still
 * landing): leagues, then teams, then players — `nextUndecided`'s order —
 * first undecided of the first kind present. Null when nothing is undecided.
 */
export function upcomingReviewStepKind(rows: readonly NavRow[]): WizardStepKind | null {
  for (const kind of ["league", "team", "player"] as const) {
    const row = rows.find((r) => !r.decision && r.kind === kind);
    if (row) return reviewStepKind(row, { pick: isAmbiguousPlayerRow(row) });
  }
  const untyped = rows.find((r) => !r.decision);
  return untyped ? reviewStepKind(untyped) : null;
}

/**
 * The preview cards the teams step would list.
 *
 * Once every name is decided this is exactly `teamlessCardIndexes` — what the
 * teams step shows. Before that it is OPTIMISTIC: a team name nobody has ruled
 * on yet is assumed to resolve, because most do (Add as New Team, Link). So
 * the step is counted from the start for cards that print no team at all, and
 * otherwise appears only when the operator SKIPS a team name — an operator
 * decision, which is the only kind of growth the plan allows.
 *
 * A team name an EARLIER save of this set skipped (`people.skippedTeamNames`)
 * is known before the sitting starts, so a card printing only such names is
 * counted from the start, like a card that prints no team at all.
 */
export function cardsForTeamsStep(
  cards: readonly PreviewCardForTeams[],
  rows: readonly TeamsReviewRow[],
  settledIndexes?: readonly number[],
  people?: StoredPeople,
): number[] {
  // An undecided team name is ASSUMED to resolve: stood in for by a link, so
  // its row still outranks a skip record for the same name (the gate queued
  // it, so this sitting is where it is being answered).
  const assumed = rows.map((r) =>
    r.kind === "team" && !r.decision ? { ...r, decision: { action: "link" as const } } : r,
  );
  const settled =
    settledIndexes && settledIndexes.length > 0 ? new Set(settledIndexes) : undefined;
  return teamlessCardIndexes(cards, assumed, settled, people);
}

/**
 * Which post-review step the operator is on.
 *
 * `requested` is where they asked to be (null = "the first one there is").
 * A step with nothing in it right now is passed over in the walking
 * direction — forward from teams to autograph to titles to save. Save
 * always exists.
 *
 * `unanswered` (NEO-345) names a live step whose answer is REQUIRED and not
 * yet given: no step after it can be reached until it is, whatever was
 * requested. The autograph step is the one (NEO-478's checklist step is also
 * required, but it comes before the names and the wizard holds it itself).
 */
export function resolvePostReviewStep(
  requested: PostReviewStep | null,
  live: PostReviewLive,
  unanswered?: PostReviewStep,
): PostReviewStep {
  const start = requested ? POST_REVIEW_ORDER.indexOf(requested) : 0;
  let resolved: PostReviewStep = "save";
  for (let i = start; i < POST_REVIEW_ORDER.length; i++) {
    const step = POST_REVIEW_ORDER[i];
    if (isLive(step, live)) {
      resolved = step;
      break;
    }
  }
  if (
    unanswered &&
    unanswered !== "save" &&
    isLive(unanswered, live) &&
    POST_REVIEW_ORDER.indexOf(unanswered) < POST_REVIEW_ORDER.indexOf(resolved)
  ) {
    return unanswered;
  }
  return resolved;
}

/** The post-review step after `step`, or null past Save. */
export function nextPostReviewStep(
  step: PostReviewStep,
  live: PostReviewLive,
): PostReviewStep | null {
  if (step === "save") return null;
  return resolvePostReviewStep(POST_REVIEW_ORDER[POST_REVIEW_ORDER.indexOf(step) + 1], live);
}

/** The post-review step before `step`, or null when Back leaves for the names. */
export function previousPostReviewStep(
  step: PostReviewStep,
  live: PostReviewLive,
): PostReviewStep | null {
  for (let i = POST_REVIEW_ORDER.indexOf(step) - 1; i >= 0; i--) {
    const candidate = POST_REVIEW_ORDER[i];
    if (candidate !== "save" && isLive(candidate, live)) return candidate;
  }
  return null;
}

export interface TrackStepsInput {
  /** Review rows in the batch. */
  reviewRows: number;
  /** NEO-478 — absent reads as false. */
  checklistStep?: boolean;
  /** NEO-574 — absent reads as false. */
  careerStep?: boolean;
  teamsStep: boolean;
  /**
   * NEO-426 — false while a fact the teams step's membership reads is still
   * loading (the flagged sports, a newly linked player's home sport). The
   * counted teams step is then HELD as it was, not added on a half-loaded
   * answer. Absent reads as true. A host should not start the plan
   * (`prev === null`) until it is true, so the first count is close.
   */
  teamsStepKnown?: boolean;
  /** NEO-345 — absent reads as false. */
  autographStep?: boolean;
  titlesStep: boolean;
  onSave: boolean;
}

/**
 * The plan's memory across renders of one sitting. Feed it every render; it
 * hands back the SAME object while nothing moved.
 */
export function trackSteps(prev: StepCount | null, input: TrackStepsInput): StepCount {
  const known = input.teamsStepKnown !== false;
  const plan: StepPlanInput = {
    reviewRows: input.reviewRows,
    checklistStep: input.checklistStep === true,
    careerStep: input.careerStep === true,
    // Unknown: hold what was counted (nothing yet, on a first count).
    teamsStep: known ? input.teamsStep : (prev?.teamsStep ?? false),
    autographStep: input.autographStep === true,
    titlesStep: input.titlesStep,
  };
  if (prev === null) return initialStepCount(plan, input.onSave);
  return advanceStepCount(prev, plan, input.onSave);
}
