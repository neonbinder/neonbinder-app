import { useEffect, type RefObject } from "react";
import { focusWithoutOpening } from "../../../primitives/Autocomplete";
import type { WalkMemory } from "../walk-memory";

const FOCUSABLE =
  'button:not([disabled]):not([tabindex="-1"]), input:not([disabled]):not([tabindex="-1"]), a[href], select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Edit on a ruled-out name ("Not a player" / "Not a team") re-opens the
 * question. The Edit button that was pressed is gone, so the re-opened row takes
 * focus on its own first control (never on a control that would undo anything).
 * `WalkMemory.oweFocus` is set by the ruled-out row once the write has landed;
 * this is the row that mounts for it. A combobox never opens on arrival.
 */
export function useReopenedFocus(
  memory: WalkMemory,
  cardId: string,
  kind: "player" | "team",
  printed: string,
  wrapRef: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    if (!memory.takeFocusOwed(cardId, kind, printed)) return;
    // After the walk's own lost-focus repair (a frame), so this is the last word.
    const id = requestAnimationFrame(() => {
      const first = wrapRef.current?.querySelector<HTMLElement>(FOCUSABLE);
      if (first) focusWithoutOpening(first);
    });
    return () => cancelAnimationFrame(id);
    // Once, when the row mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
