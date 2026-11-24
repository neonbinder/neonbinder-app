import type { ReactNode, Ref } from "react";
import NeonButton from "../../../modules/NeonButton";

/**
 * NEO-645 (T2) — one linked name's line in the Player and Team tiles: who it is,
 * and a small "Edit" at the end of the same line, in place of the "Change
 * player" / "Change team" row of buttons that used to sit under every name.
 *
 * The text takes the width it can (`basis-48`, shrinkable), so on a phone-width
 * tile "Edit" drops under the name instead of squeezing it or running out of
 * the tile. The button's name is "Edit <who>": it contains the visible word (WCAG 2.5.3),
 * two lines never read alike, and a screen reader hears what Edit changes.
 */
export default function EditLine({
  children,
  editLabel,
  onEdit,
  busy,
  buttonRef,
  textClass = "text-sm",
}: {
  /** The line's text: a name, a summary, a sentence. */
  children: ReactNode;
  /** The button's accessible name: "Edit Freddy Peralta". */
  editLabel: string;
  onEdit: (opener: HTMLElement) => void;
  busy: boolean;
  buttonRef?: Ref<HTMLButtonElement>;
  textClass?: string;
}) {
  return (
    <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
      <p className={`min-w-0 flex-1 basis-48 wrap-anywhere ${textClass}`}>{children}</p>
      <NeonButton
        ref={buttonRef}
        size="1"
        variant="secondary"
        outline
        aria-label={editLabel}
        aria-disabled={busy ? true : undefined}
        onClick={(e) => onEdit(e.currentTarget)}
      >
        Edit
      </NeonButton>
    </div>
  );
}
