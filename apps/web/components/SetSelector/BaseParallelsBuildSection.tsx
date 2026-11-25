import { useEffect, useRef, useState } from "react";
import { useConvex, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { activateOnEnter } from "@/lib/dom/activate-on-enter";
import { useFieldTestClass } from "@/src/hooks/useFieldTestClass";
import NeonButton from "../modules/NeonButton";
import { ModeRadioGroup } from "../primitives/ModeRadioGroup";
import { ConfirmDialog } from "../modules/confirm-dialog";
import { WaitingOnMarketplaceRun } from "../modules/WaitingOnMarketplace";
import ParallelBuildPanel, {
  PARALLEL_BUILD_HEADING_ID,
  SLEEVE_TONE,
  moreText,
  planFailedText,
  possessive,
  truncatedText,
  type ParallelBuildPlan,
  type ParallelBuildRunner,
  type ParallelLine,
  type ParallelPlanEntry,
} from "./ParallelBuildPanel";

/**
 * NEO-321 — build the base set's parallels in one go.
 *
 * Shown by the set builder when the selected variant type's kind is
 * `parallel` (`variantTypeKind`, NEO-334: a variant type's title IS its
 * kind, exactly "Parallel" or "Parallels"), and kept on screen
 * while one of the parallels under it is open. Every row under that type is
 * a parallel of the base set, so its cards are a copy of the Base checklist's
 * NB cards, each re-linked to the parallel's own marketplace card — the
 * NEO-312 model with Base as the source (`ParallelBuildPanel`).
 *
 * ## Only when pressed (Jason, D2)
 *
 * Nothing here runs on its own. An insert builds its parallels right after
 * its checklist is saved (NEO-312 J1), but a Base save does NOT build the
 * base set's parallels: a Base checklist runs to hundreds of cards and a base
 * set to dozens of parallels, so a run is minutes of marketplace fetches, and
 * a Base is saved for many reasons (a fix to one card, a re-map) that are
 * not "rebuild every parallel". The operator decides when, here, with one
 * button.
 *
 * ## Asks first only when it would replace something (D4)
 *
 * A run fills every empty parallel and rebuilds every one that already has
 * cards. Filling an empty one loses nothing, so a run over empty parallels
 * starts at once; when K of them already have cards the button asks first,
 * naming K.
 *
 * ## The run
 *
 * Through the set builder's hosted runner (`useHostedParallelBuildRun`), so
 * a run started here survives the operator moving into a parallel, back up to
 * the set or across to another variant type. While this section is on screen
 * and the run is the one it started, the ledger (with "Stop after this one")
 * is drawn here and nowhere else.
 *
 * Copy is DRAFT (Jason signs off); every string is one constant or one pure
 * function below.
 */

// ---------------------------------------------------------------------------
// Copy (DRAFT)
// ---------------------------------------------------------------------------

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

/** Before the Base row's name is known. */
const SOURCE_FALLBACK = "the base set";

/** NEO-673 — a set with no Base asks which parallel the others copy from, so
 * before the first pick there is no "base set" to name. */
const FIRST_PICK_FALLBACK = "this set";

export function sectionHeading(
  sourceValue: string | undefined,
  firstPick = false,
): string {
  return `Parallels of ${sourceValue ?? (firstPick ? FIRST_PICK_FALLBACK : SOURCE_FALLBACK)}`;
}

/**
 * NEO-673 — the heading once the others copy from a parallel the operator
 * picked: the set has no Base, so "of the base set" would be untrue. It names
 * its source ("Parallels from Silver") so it never reads the same as the
 * Variants column's own "Parallels" label.
 */
export function chosenSectionHeading(sourceValue: string): string {
  return `Parallels from ${sourceValue}`;
}

/** "Build 12 parallels from Base"; no count until the list is in. */
export function buildAllLabel(
  sourceValue: string | undefined,
  total: number | undefined,
): string {
  const source = sourceValue ?? SOURCE_FALLBACK;
  return total === undefined
    ? `Build parallels from ${source}`
    : `Build ${plural(total, "parallel", "parallels")} from ${source}`;
}

/**
 * NEO-673 — a set with no Base asks which of its parallels the others copy
 * from. The question is the group's label; the parallel-row stand-in is
 * described by it too (`BASE_PARALLELS_REASON_ID`).
 */
export const PICK_SOURCE_QUESTION = "Which parallel do the others copy from?";
/** The pick's button: names the choice once there is one. */
export function copyFromLabel(sourceValue: string | undefined): string {
  return sourceValue ? `Copy from ${sourceValue}` : "Copy from…";
}
export function copyingFromText(sourceValue: string): string {
  return `Copying from ${sourceValue}`;
}
/** The standing pick, marked in the list Change reopens (checked: never). */
export function currentOptionLabel(value: string): string {
  return `${value} (current)`;
}
/** The newly picked parallel has nothing to build from the pick's side yet. */
export function pickedEmptyText(value: string): string {
  return `${value} has no cards yet.`;
}
export const CHANGE_SOURCE_LABEL = "Change";
export const CHANGE_SOURCE_ARIA = "Change the parallel the others copy from";
export const CANCEL_CHANGE_LABEL = "Cancel";
export const CANCEL_CHANGE_ARIA = "Cancel changing the parallel the others copy from";
export const SAVING_TEXT = "Saving…";
export const PICK_FAILED_TEXT = "Couldn't save that choice. Try again.";

/** A refusal's own sentence (a ConvexError's data), else the fixed one. */
export function pickFailedText(error: unknown): string {
  const data =
    typeof error === "object" && error !== null
      ? (error as { data?: unknown }).data
      : undefined;
  return typeof data === "string" && data.length > 0 ? data : PICK_FAILED_TEXT;
}

export const LOADING_TEXT = "Counting parallels…";
export const NO_SOURCE_TEXT =
  "No single base set to copy from. Rename one variant type to Base first.";

/** The server's reason there is no source (no Base, or more than one), as a sentence. */
export function noSourceText(serverReason?: string): string {
  return serverReason ? `Nothing to copy from — ${serverReason}.` : NO_SOURCE_TEXT;
}
export const NO_PARALLELS_TEXT = "No parallels here yet. Sync or add some first.";
/** Every parallel is one the build would refuse: a run would build nothing. */
export const ALL_BLOCKED_TEXT =
  "Every parallel here is blocked. Clear what's listed above, then build.";
export const OTHER_RUN_TEXT =
  "Another parallel build is running. Let it finish or stop it first.";
export const CONFIRM_LABEL = "Replace and build";
export const CONFIRM_BUSY_LABEL = "Starting…";

/** Worded like the server's own refusal for the same case, so the two agree. */
export function sourceEmptyText(sourceValue: string): string {
  return `${sourceValue} has no cards yet — save its checklist first.`;
}

/** What the parallels look like before a run. */
export type ParallelTally = {
  total: number;
  /** Parallels that already hold cards. */
  withCards: number;
  /** Buildable parallels holding cards: what a run would REPLACE (D4's K). */
  replaced: number;
  /** Buildable parallels with no cards: what a run would fill. */
  filled: number;
  /**
   * Buildable parallels holding no marketplace id of their own. NEO-496
   * (NQ2): the run builds them too, as copies with no marketplace links;
   * counted only to say so. A parallel that owns ids it can't reach right now
   * (paused, or the row above it unlinked) is not one of these: the server
   * marks it `blocked`, as the build would.
   */
  unlinked: number;
  /** The server already knows a build would be refused. */
  blocked: number;
};

/** Ownership, not reach: what the parallel's own copies could be linked to. */
const ownsIds = (p: ParallelPlanEntry) => p.owned.bsc || p.owned.sportlots;

export function tallyParallels(parallels: ParallelPlanEntry[]): ParallelTally {
  // NEO-496 (NQ2): linked or not, every parallel that is not blocked builds.
  const buildable = parallels.filter((p) => !p.blocked);
  return {
    total: parallels.length,
    withCards: parallels.filter((p) => p.hasCards).length,
    replaced: buildable.filter((p) => p.hasCards).length,
    filled: buildable.filter((p) => !p.hasCards).length,
    unlinked: buildable.filter((p) => !ownsIds(p)).length,
    blocked: parallels.filter((p) => p.blocked).length,
  };
}

/**
 * "12 parallels: 9 empty, 3 with cards. 2 have no marketplace link yet, so
 * their cards copy over without one. 1 is blocked." — only the
 * sentences that are true. NEO-496 (NQ2): an unlinked parallel is built, not
 * skipped.
 */
export function summaryText(tally: ParallelTally): string {
  const { total, withCards } = tally;
  const empty = total - withCards;
  const counts =
    withCards === 0
      ? `${plural(total, "parallel", "parallels")}, all empty.`
      : empty === 0
        ? `${plural(total, "parallel", "parallels")}, all with cards.`
        : `${plural(total, "parallel", "parallels")}: ${empty} empty, ${withCards} with cards.`;
  const parts = [counts];
  if (tally.unlinked > 0) {
    parts.push(
      tally.unlinked === 1
        ? "1 has no marketplace link yet, so its cards copy over without one."
        : `${tally.unlinked} have no marketplace link yet, so their cards copy over without one.`,
    );
  }
  if (tally.blocked > 0) {
    parts.push(tally.blocked === 1 ? "1 is blocked." : `${tally.blocked} are blocked.`);
  }
  return parts.join(" ");
}

/** What a run does, said once under the counts. */
export function explainerText(sourceValue: string): string {
  return `Each one gets a fresh copy of ${possessive(sourceValue)} cards, linked to its own marketplace cards.`;
}

/**
 * D4 — asked only when K > 0 parallels already have cards. The title is the
 * question; the description is what confirming does to the cards there.
 */
export function replaceConfirmCopy(
  sourceValue: string,
  tally: ParallelTally,
): { title: string; description: string } {
  const title = `Replace the cards on ${tally.replaced} of ${plural(tally.total, "parallel", "parallels")} with fresh copies of ${possessive(sourceValue)}?`;
  const description = [
    `Every card on ${tally.replaced === 1 ? "that parallel" : "those parallels"} is made fresh from ${sourceValue}: hand edits are replaced, and a card keeps its SKU when it's the same card.`,
    tally.filled > 0
      ? tally.filled === 1
        ? "The empty one just gets filled."
        : `The ${tally.filled} empty ones just get filled.`
      : null,
  ]
    .filter(Boolean)
    .join(" ");
  return { title, description };
}

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

/**
 * The base set's parallels and their source, as the server resolves them from
 * the Parallel variant type. Hosted by the set builder, which needs Base's
 * name for a base parallel's own "Build from Base" button (D3) as well as for
 * this section; Convex dedupes the subscription between the two.
 */
export function useBaseParallelsPlan(
  parallelTypeId: Id<"selectorOptions"> | null,
): ParallelBuildPlan | undefined {
  return useQuery(
    api.parallelChecklistBuild.getParallelsForBuild,
    parallelTypeId ? { sourceId: parallelTypeId } : "skip",
  );
}

/** The pre-run sleeve: what each parallel looks like before anything is built. */
function previewKind(entry: ParallelPlanEntry): ParallelLine["kind"] {
  if (entry.blocked) return "blocked";
  return entry.hasCards ? "built" : "waiting";
}

/**
 * a11y (NEO-321 audit) — a parallel the run will not build, named with why:
 * "Gold — blocked: some of its cards have scans…". `null` for one the run
 * will build (NEO-496: an unlinked one included). Shown as words under the
 * summary, because the strip that also marks them is decorative.
 */
export function attentionText(entry: ParallelPlanEntry): string | null {
  if (entry.blocked) return `${entry.value} — blocked: ${entry.blocked}`;
  return null;
}

/** Above this many, the list says "…and N more" rather than run on. */
const ATTENTION_LIST_MAX = 10;

function previewTitle(entry: ParallelPlanEntry): string {
  const attention = attentionText(entry);
  if (attention) return attention;
  return entry.hasCards ? `${entry.value} — has cards` : `${entry.value} — empty`;
}

// ---------------------------------------------------------------------------
// The section
// ---------------------------------------------------------------------------

const HEADING_ID = "base-parallels-heading";
/**
 * The reason line's id. Exported so a base parallel's stand-in button (no
 * single Base to build from) is described by the same sentence (NEO-321 a11y).
 */
export const BASE_PARALLELS_REASON_ID = "base-parallels-reason";
const REASON_ID = BASE_PARALLELS_REASON_ID;

export default function BaseParallelsBuildSection({
  variantTypeId,
  plan,
  runner,
  showsRun,
}: {
  /** The selected variant type, whose NB role is `parallel`. */
  variantTypeId: Id<"selectorOptions">;
  /** From `useBaseParallelsPlan`; undefined while it loads. */
  plan: ParallelBuildPlan | undefined;
  /** The set builder's hosted runner. */
  runner: ParallelBuildRunner;
  /** The run on the runner is the one this section started; draw it here. */
  showsRun: boolean;
}) {
  const convex = useConvex();
  // NEO-260: the E2E driver re-finds a focused control by an XPath built from
  // its class, so the button carries the document-unique marker class — never
  // a DOM id (which would also hide an aria-label from its `id:` finds).
  const fieldClass = useFieldTestClass();
  const [confirming, setConfirming] = useState(false);
  /** The list could not be read when the run started, so nothing was built. */
  const [startError, setStartError] = useState<string | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  /** NEO-673 — "Change" is open. In-view state, not navigation. */
  const [changing, setChanging] = useState(false);
  /** The parallel picked in the list; empty until one is. */
  const [choice, setChoice] = useState("");
  const [savingChoice, setSavingChoice] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);
  const changeRef = useRef<HTMLButtonElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const groupRef = useRef<HTMLDivElement | null>(null);
  const saveRef = useRef<HTMLButtonElement | null>(null);
  /** Where focus goes after the next commit: the list (opened) or Change (closed). */
  const focusAfterRef = useRef<"list" | "change" | null>(null);
  useEffect(() => {
    const where = focusAfterRef.current;
    if (!where) return;
    if (where === "list") {
      focusAfterRef.current = null;
      // Nothing is checked on open (Jason: "nothing preselected"), so the
      // first radio is the group's one tab stop.
      pickerRef.current?.querySelector<HTMLElement>('[role="radio"]')?.focus();
      return;
    }
    // "change": armed by a save that went through. Stay armed until Change
    // exists to take focus: on a first pick the write can settle before the
    // plan carries the new source, so Change draws a render later. Make sure
    // focus is not on <body> meanwhile. A run that hides Change stops the
    // wait, so Change does not take focus whenever the run ends.
    if (changeRef.current) {
      focusAfterRef.current = null;
      changeRef.current.focus();
    } else if (!savingChoice) {
      if (document.activeElement === document.body) headingRef.current?.focus();
      if (runner.active) focusAfterRef.current = null;
    }
  });
  /**
   * The trigger goes `inert` under the confirm, and going inert blurs it, so
   * the dialog's own restore captured `<body>`. Put focus back here after the
   * commit that lifts `inert` (the house pattern, as on the row's button).
   */
  const restoreRef = useRef(false);
  useEffect(() => {
    if (confirming || !restoreRef.current) return;
    restoreRef.current = false;
    buttonRef.current?.focus();
  }, [confirming]);

  const source = plan?.source ?? undefined;
  const sourceValue = source?.value;
  const parallels = plan?.parallels;
  const tally = parallels ? tallyParallels(parallels) : undefined;
  const attention = (parallels ?? []).flatMap((entry) => {
    const text = attentionText(entry);
    return text ? [{ id: entry._id, text }] : [];
  });
  const ownRunLive = showsRun && runner.active;
  const chosen = source?.kind === "chosenParallel";
  // NEO-673: the list of parallels to pick from. While changing, the current
  // pick is not in `parallels` (the server leaves the source out), so it
  // leads the list, preselected: it is the standing choice, not a default.
  const pickerOpen =
    plan !== undefined &&
    ((!source && plan.sourcePickable === true) || (chosen && changing));
  // Jason: Change "reopens the same list", so the standing pick sits at its
  // own place in the type's child order (the server leaves it out of
  // `parallels` and says where it belongs) and nothing is preselected.
  const pickOptions = (() => {
    if (!pickerOpen || !parallels) return [];
    if (!(chosen && source)) return parallels;
    const at = Math.min(source.position ?? 0, parallels.length);
    return [
      ...parallels.slice(0, at),
      { _id: source.id, value: source.value, hasCards: source.hasCards },
      ...parallels.slice(at),
    ];
  })();
  // A choice that is no longer in the list (a parallel deleted meanwhile) is
  // no choice.
  const picked = pickOptions.find((o) => o._id === choice);
  const pickedName = picked?.value;
  // Changing to a parallel with no cards while the current pick has some: the
  // others would have nothing to copy, so say so before the button.
  const pickedEmpty =
    changing && chosen && !!source?.hasCards && !!picked && !picked.hasCards;
  const statusText = savingChoice
    ? SAVING_TEXT
    : chosen && source && !pickerOpen
      ? copyingFromText(source.value)
      : "";

  // Why the button cannot run, in the order the operator would fix it.
  const reason: string | null =
    plan === undefined
      ? LOADING_TEXT
      : !source
        ? plan.sourcePickable
          ? PICK_SOURCE_QUESTION
          : noSourceText(plan.sourceBlocked)
        : !source.hasCards
          ? sourceEmptyText(source.value)
          : !tally || tally.total === 0
            ? NO_PARALLELS_TEXT
            : tally.blocked === tally.total
              ? ALL_BLOCKED_TEXT
              : runner.active && !showsRun
                ? OTHER_RUN_TEXT
                : null;
  const held = reason !== null || ownRunLive;

  const run = () => {
    if (!source) return;
    setStartError(null);
    void runner
      .start({ id: variantTypeId, value: source.value }, convex)
      .then((failure) => {
        if (failure) setStartError(planFailedText(failure));
      });
  };

  const activate = () => {
    if (held || !tally) return;
    if (tally.replaced > 0) setConfirming(true);
    else run();
  };

  const openChange = () => {
    if (!source) return;
    setChoice("");
    setPickError(null);
    setChanging(true);
    focusAfterRef.current = "list";
  };
  const closeChange = () => {
    setChanging(false);
    setChoice("");
    setPickError(null);
    focusAfterRef.current = "change";
  };
  const savePick = () => {
    if (savingChoice) return;
    if (!picked) {
      // The held button was pressed with nothing chosen: the group is what
      // needs the operator, so land there.
      groupRef.current?.focus();
      return;
    }
    setPickError(null);
    setSavingChoice(true);
    // First pick: the button is about to unmount with the picker, so park
    // focus on the heading (which stays) before the write. A change keeps the
    // button until the picker closes, and Change takes focus after.
    const parked = !changing;
    if (parked) headingRef.current?.focus();
    // Through the client the section already holds, like the run's own reads.
    convex
      .mutation(api.parallelTypeSource.setParallelTypeSource, {
        parallelTypeId: variantTypeId,
        sourceId: picked._id,
      })
      .then(() => {
        // The choice stays until the picker unmounts on its own (no flash of
        // "Copy from…" on a first pick); Change reopens with nothing chosen.
        setChanging(false);
        focusAfterRef.current = "change";
      })
      .catch((error: unknown) => {
        setPickError(pickFailedText(error));
        if (parked) saveRef.current?.focus();
      })
      .finally(() => setSavingChoice(false));
  };

  const label = buildAllLabel(sourceValue, tally?.total);
  const copy =
    confirming && sourceValue && tally
      ? replaceConfirmCopy(sourceValue, tally)
      : null;

  return (
    <section
      aria-labelledby={HEADING_ID}
      className="border border-rule-strong rounded-lg bg-raised-deep/60 p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 max-w-prose">
          <h3
            ref={headingRef}
            id={HEADING_ID}
            tabIndex={-1}
            className="rounded-sm text-sm font-semibold text-ink focus-outline"
          >
            {chosen && source
              ? chosenSectionHeading(source.value)
              : sectionHeading(sourceValue, !source && plan?.sourcePickable === true)}
          </h3>
          {/* Always mounted so the save is announced: "Saving…", then
              "Copying from X". The visible "Copying from X" line IS this
              region, so there is one copy of the words. */}
          <p
            className={`text-xs text-ink-2 break-words ${statusText ? "mt-0.5" : ""}`}
          >
            <span role="status">{statusText}</span>
            {chosen && source && !pickerOpen && !runner.active && (
              <>
                <span aria-hidden="true"> · </span>
                <button
                  ref={changeRef}
                  type="button"
                  aria-label={CHANGE_SOURCE_ARIA}
                  onClick={openChange}
                  className="rounded-sm p-3.5 -m-3.5 underline text-neon-blue-text hover:no-underline focus-outline"
                >
                  {CHANGE_SOURCE_LABEL}
                </button>
              </>
            )}
          </p>
          {!pickerOpen && tally && tally.total > 0 && (
            <p className="mt-0.5 text-xs text-ink-3">
              {summaryText(tally)}
              {sourceValue ? ` ${explainerText(sourceValue)}` : ""}
              {plan?.truncated && parallels
                ? ` ${truncatedText(parallels.length)}`
                : ""}
            </p>
          )}
          {!pickerOpen && attention.length > 0 && (
            <ul className="mt-1.5 space-y-0.5 text-xs text-notice-warn-ink">
              {attention.slice(0, ATTENTION_LIST_MAX).map((item) => (
                <li key={item.id} className="break-words">
                  {item.text}
                </li>
              ))}
              {attention.length > ATTENTION_LIST_MAX && (
                <li className="italic">
                  {moreText(attention.length - ATTENTION_LIST_MAX)}
                </li>
              )}
            </ul>
          )}
        </div>
        {!pickerOpen && (
        <NeonButton
          ref={buttonRef}
          className={`${fieldClass("build-all")} max-w-full sm:shrink-0 sm:max-w-[20rem]`}
          onClick={activate}
          onKeyDown={(event) => activateOnEnter(event, activate, held)}
          // `aria-disabled`, never native `disabled`: the reason below stays
          // reachable from the button, and focus stays put when a run starts.
          aria-disabled={held || undefined}
          aria-describedby={
            reason !== null
              ? REASON_ID
              : ownRunLive
                ? PARALLEL_BUILD_HEADING_ID
                : undefined
          }
          aria-haspopup={tally && tally.replaced > 0 ? "dialog" : undefined}
          inert={confirming || undefined}
          title={label}
        >
          <span className="min-w-0 break-words">{label}</span>
        </NeonButton>
        )}
      </div>

      {/* The binder page before the run: one card-shaped sleeve per parallel,
          filled where the parallel already has cards. The run's own ledger
          draws the same sleeves and fills them as it goes, so the strip hands
          over to it rather than sitting beside it. Decorative — the summary
          says the same in words. */}
      {parallels && parallels.length > 0 && !showsRun && !pickerOpen && (
        <div aria-hidden="true" className="mt-3 flex flex-wrap gap-1">
          {parallels.map((entry) => (
            <span
              key={entry._id}
              title={previewTitle(entry)}
              className={`h-3.5 w-2.5 rounded-[2px] border ${SLEEVE_TONE[previewKind(entry)]}`}
            />
          ))}
        </div>
      )}

      {pickerOpen && (
        <div
          ref={pickerRef}
          className="mt-3"
          onKeyDown={(event) => {
            if (event.key === "Escape" && changing && !savingChoice) {
              event.stopPropagation();
              closeChange();
            }
          }}
        >
          {parallels ? (
            <ModeRadioGroup
              label={PICK_SOURCE_QUESTION}
              // The stand-in on a parallel row points here while there is no
              // source; once there is one, the group takes a generated id.
              labelId={source ? undefined : REASON_ID}
              value={picked?._id ?? ""}
              options={pickOptions.map((o) => ({
                value: o._id,
                label:
                  chosen && source && o._id === source.id
                    ? currentOptionLabel(o.value)
                    : o.value,
              }))}
              onChange={(next) => {
                setPickError(null);
                setChoice(next);
              }}
              required
              groupRef={groupRef}
            />
          ) : (
            <p className="text-xs text-ink-3">{LOADING_TEXT}</p>
          )}
          {/* Always mounted, so the note is announced when it appears (a
              region that arrives with its text is often skipped). The margin
              rides the text, so the empty region takes no space. */}
          <p
            role="status"
            className={`text-xs text-notice-warn-ink break-words ${pickedEmpty && picked ? "mt-3" : ""}`}
          >
            {pickedEmpty && picked ? pickedEmptyText(picked.value) : ""}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <NeonButton
              ref={saveRef}
              className="max-w-full"
              onClick={savePick}
              onKeyDown={(event) => activateOnEnter(event, savePick, savingChoice)}
              aria-disabled={!picked || savingChoice || undefined}
              aria-busy={savingChoice || undefined}
            >
              <span className="min-w-0 break-words">{copyFromLabel(pickedName)}</span>
            </NeonButton>
            {changing && (
              <NeonButton
                variant="negative"
                outline
                aria-label={CANCEL_CHANGE_ARIA}
                onClick={closeChange}
              >
                {CANCEL_CHANGE_LABEL}
              </NeonButton>
            )}
          </div>
          {pickError && (
            <p role="alert" className="mt-2 text-xs text-notice-danger-ink">
              {pickError}
            </p>
          )}
        </div>
      )}

      {reason !== null && !pickerOpen && (
        // Loading is not a problem to fix, so it stays in the summary's grey;
        // every other reason is something the operator has to do first.
        <p
          id={REASON_ID}
          className={`mt-2 text-xs ${reason === LOADING_TEXT ? "text-ink-3" : "text-notice-warn-ink"}`}
        >
          {reason}
        </p>
      )}

      {startError && (
        // A failure the operator is waiting on, so an alert (the house split).
        <p role="alert" className="mt-2 text-xs text-notice-danger-ink">
          {startError}
        </p>
      )}

      {showsRun && runner.run && (
        <div className="mt-3 [&>section]:mb-0">
          <ParallelBuildPanel
            run={runner.run}
            onStop={runner.stop}
            headingLevel={4}
            waitingSlot={
              // NEO-487 — the run's one waitKey; subscribed only while it runs.
              <WaitingOnMarketplaceRun
                runKey={runner.run.waitKey ?? null}
                active={runner.active}
                marketplace="BuySportsCards"
              />
            }
          />
        </div>
      )}

      {copy && (
        <ConfirmDialog
          title={copy.title}
          description={copy.description}
          confirmLabel={CONFIRM_LABEL}
          busyLabel={CONFIRM_BUSY_LABEL}
          busy={false}
          onConfirm={() => {
            restoreRef.current = true;
            setConfirming(false);
            run();
          }}
          onCancel={() => {
            restoreRef.current = true;
            setConfirming(false);
          }}
        />
      )}
    </section>
  );
}
