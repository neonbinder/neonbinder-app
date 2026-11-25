import { useId, type ReactNode } from "react";

/**
 * NEO-665 (Jason: "one purple pill for each thing we've dropped") — what a
 * listing title left out to fit, as one purple pill per item. The one
 * rendering every title surface uses: the Tidy Up "Listing title" tile, the
 * card drawer, and both lines of the Card titles step.
 *
 * Structure: a wrapper `<div>` (carries `id`, so a field's `aria-describedby`
 * reads the label, the pills and any `trailing` text), the visible label "Left
 * out to fit", and a `<ul>` named by that label (`aria-labelledby`, so it is
 * read once) with one `<li>` per item. Pills wrap onto further lines and never
 * clip.
 *
 * Renders nothing for an empty list: a title with nothing to name shows no
 * line at all. Display only; nothing is stored from this.
 */
export default function LeftOutPills({
  items,
  id,
  className = "",
  trailing,
}: {
  items: readonly string[];
  /** On the wrapper, for an `aria-describedby` that points at the whole line. */
  id?: string;
  /** Spacing from the caller ("mt-1"). */
  className?: string;
  /** Plain text after the pills ("(3 cards)"). */
  trailing?: ReactNode;
}) {
  const labelId = useId();
  if (items.length === 0) return null;
  return (
    <div id={id} className={`flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs ${className}`.trim()}>
      <span id={labelId} className="text-ink-2">
        Left out to fit
      </span>
      <ul aria-labelledby={labelId} className="flex min-w-0 flex-wrap gap-1">
        {items.map((item, index) => (
          <li
            key={`${item}-${index}`}
            className="max-w-full rounded-full border border-neon-purple-text/60 bg-neon-purple/10 px-2 py-0.5 text-neon-purple-text wrap-anywhere"
          >
            {item}
          </li>
        ))}
      </ul>
      {trailing}
    </div>
  );
}
