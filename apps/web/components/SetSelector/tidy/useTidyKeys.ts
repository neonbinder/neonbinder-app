/**
 * NEO-645 — what Enter and Escape mean in the Tidy Up walk.
 *
 * Outside any field, Enter is Save & next and Escape is Save for later. The
 * walk is full of fields, searches and inline forms, so those keys are theirs
 * first (CLAUDE.md: Enter confirms, Escape cancels, in the place you are):
 *
 *   - A field handles them. Autocomplete swallows Enter (pick) and Escape
 *     (close the list) itself; whatever it did not swallow arrives here with
 *     `defaultPrevented` or an editable target, and is left alone.
 *   - A control owns Enter. A focused button, link or disclosure activates on
 *     Enter; this handler never turns that into a save as well.
 *   - Escape closes the TOP inline part first (a search, the New Team form,
 *     the title editor, the set-name field; `inline-stack.tsx`). Only with
 *     nothing inline open does it mean Save for later, and only outside a
 *     field.
 *   - Enter never means Save & next while an inline part is open, or while the
 *     card cannot save (something is pink), or while a save is in flight.
 *
 * Returns the `onKeyDown` for the dialog root. Portalled children (the
 * Autocomplete list) bubble through the React tree to it.
 */
import { useCallback, useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { isEditableTarget } from "@/lib/dom/is-editable-target";

/** Targets that own Enter: pressing it on them does what they do. */
const OWNS_ENTER =
  'button, a[href], summary, select, [role="button"], [role="menuitem"], [role="option"], [role="tab"], [role="checkbox"], [role="radio"], [role="switch"], [role="link"]';

export function ownsEnter(target: EventTarget | null | undefined): boolean {
  return target instanceof Element && target.closest(OWNS_ENTER) !== null;
}

export type TidyKeysOptions = {
  /** Save & next is pressable: nothing pink, not saving. */
  canSave: boolean;
  /** An inline part is open (`useInlineStackOpen`). */
  inlineOpen: boolean;
  /** Close the top inline part; true when one was closed. */
  closeTopInlinePart: () => boolean;
  onSave: () => void;
  onSaveForLater: () => void;
};

export function useTidyKeys(options: TidyKeysOptions) {
  // Read through a ref so the handler keeps one identity and never closes
  // over a render's `canSave`.
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });

  return useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.defaultPrevented) return;
    const { canSave, inlineOpen, closeTopInlinePart, onSave, onSaveForLater } = latest.current;

    if (event.key === "Escape") {
      // The top inline part first, wherever focus is inside it.
      if (inlineOpen && closeTopInlinePart()) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      // A field keeps its own Escape.
      if (isEditableTarget(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      onSaveForLater();
      return;
    }

    if (event.key === "Enter") {
      if (event.repeat || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
      if (inlineOpen) return;
      if (isEditableTarget(event.target) || ownsEnter(event.target)) return;
      if (!canSave) return;
      event.preventDefault();
      event.stopPropagation();
      onSave();
    }
  }, []);
}
