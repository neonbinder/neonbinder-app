import { useEffect, useSyncExternalStore } from "react";

/**
 * NEO-535 — "take me to Set name in titles".
 *
 * A card whose title is still over 80 after every cut can be fixed one card
 * at a time in the attention walker, or for the whole row by trimming the
 * row's "Set name in titles" in the Attributes panel. The walker's
 * `TitleFixer` offers the second door, and the door has to actually go
 * there: the operator-copy rule is that a pointer is reachable and
 * actionable, never a sentence telling them to go find a field.
 *
 * The walker (inside `CardChecklist`) and the Attributes panel are siblings
 * under the set builder, so the two meet here rather than through props
 * neither owns:
 *  - the panel registers a TARGET while it shows the row's box
 *    (`useSetNameInTitlesTarget`);
 *  - a dialog standing in front of it registers a CLOSER
 *    (`useClosesForSetNameInTitles`), so focus can land behind it;
 *  - the fixer renders its door only while a target exists
 *    (`useSetNameInTitlesReachable`), so the door is never a dead end.
 *
 * Not navigation: opening the panel and focusing a field is an in-view move,
 * so nothing goes into the URL or the history.
 */

const targets: Array<() => void> = [];
const closers = new Set<() => void>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const hasTarget = () => targets.length > 0;

/** Register `open` as where "Set name in titles" lives, while mounted. */
export function useSetNameInTitlesTarget(open: () => void): void {
  useEffect(() => {
    targets.push(open);
    emit();
    return () => {
      const at = targets.lastIndexOf(open);
      if (at >= 0) targets.splice(at, 1);
      emit();
    };
  }, [open]);
}

/** Close this dialog when the operator heads for "Set name in titles". */
export function useClosesForSetNameInTitles(close: () => void): void {
  useEffect(() => {
    closers.add(close);
    return () => {
      closers.delete(close);
    };
  }, [close]);
}

/** Is there a "Set name in titles" on screen to go to? */
export function useSetNameInTitlesReachable(): boolean {
  return useSyncExternalStore(subscribe, hasTarget, () => false);
}

/**
 * Close whatever stands in front, then open the newest target. False (and
 * nothing closed) when there is no target.
 */
export function goToSetNameInTitles(): boolean {
  const open = targets[targets.length - 1];
  if (!open) return false;
  for (const close of [...closers]) close();
  open();
  return true;
}
