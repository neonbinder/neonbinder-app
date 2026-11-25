import { ArrowsRightLeftIcon, CheckIcon } from "@heroicons/react/16/solid";

/**
 * One team chip: a pill-shaped button with the team's label and, when there is
 * one, a second line (years, "played here") that wraps inside the chip.
 *
 * Extracted from `TeamFillChips` (NEO-672) so the Team tile's career swaps look
 * and read like the fill chips. The caller owns the `<li>` and the accessible
 * name. A busy chip stays focusable and ignores the click, like every write
 * control in the tile.
 *
 * `variant="action"` (NEO-672) is the swap pill: blue outline and tint at rest and a
 * swap mark, so it reads as a button and not as the inert "Career on file" chips.
 * The default `"chip"` is the fill chips' look, unchanged.
 */
export default function TeamChip({
  label,
  on,
  suffix,
  accessibleName,
  busy,
  onClick,
  describedBy,
  variant = "chip",
}: {
  label: string;
  /** Preselected: the green, checked look. */
  on: boolean;
  /** The second line (years, "played here"). */
  suffix?: string;
  accessibleName: string;
  busy: boolean;
  onClick: () => void;
  describedBy?: string;
  /** "chip": a choice among teams (default). "action": a button that does something on click. */
  variant?: "chip" | "action";
}) {
  const action = variant === "action";
  return (
    <button
      type="button"
      aria-label={accessibleName}
      aria-disabled={busy || undefined}
      aria-describedby={describedBy}
      onClick={() => {
        if (busy) return;
        onClick();
      }}
      className={`hit-area-24 inline-flex max-w-full flex-col items-start gap-0 border px-2 py-0.5 text-left text-xs focus-outline ${
        suffix ? "rounded-2xl" : "rounded-full"
      } ${
        on
          ? "border-neon-green-text bg-neon-green/20 text-neon-green-text"
          : action
            ? "border-neon-blue-text bg-neon-blue/10 text-neon-blue-text hover:bg-neon-blue/20"
            : "border-control bg-raised text-ink-2 hover:border-neon-blue-text hover:text-neon-blue-text"
      }`}
    >
      <span className="inline-flex items-center gap-1">
        {/* The preselected mark that is not a colour (SC 1.4.1); the accessible name says "suggested" to a reader. */}
        {on && <CheckIcon aria-hidden="true" className="h-3 w-3 shrink-0" />}
        {action && <ArrowsRightLeftIcon aria-hidden="true" className="h-3 w-3 shrink-0" />}
        <span>{label}</span>
      </span>
      {/* NEO-645: the years (every player's, merged) get their own line, so a
          long list wraps inside the chip at 320px and is never clipped. The
          dot is in the accessible name ("Team · Player 1967–1983"). */}
      {suffix && (
        <span className={action ? "block max-w-full wrap-anywhere" : "block max-w-full text-ink-2 wrap-anywhere"}>
          {suffix}
        </span>
      )}
    </button>
  );
}
