import { useId, type ReactNode } from "react";

/**
 * NEO-665 (Jason: "one purple pill for each thing we've dropped") — what a
 * listing title left out to fit, as one purple pill per item. The one
 * rendering every title surface uses: the Tidy Up "Listing title" tile, the
 * card drawer, and both lines of the Card titles step.
 *
 * Structure: a wrapper `<div>` (carries `id`, so a field's `aria-describedby`
 * reads the label, the pills and any `trailing` text), the visible label "Left
 * out to fit", and a `<ul role="list">` (the role keeps list semantics in
 * Safari/VoiceOver, which drops them under `list-style: none`) with one `<li>`
 * per item. Each item but the last ends in a screen-reader-only ", " so a
 * flattened read does not run the items together; the visible pill text is
 * still just the item.
 *
 * The list is named by the label (`aria-labelledby`, so it is read once)
 * unless `listNamed` is false. A wrapper that an `aria-describedby` points at
 * must pass `listNamed={false}`: a named list inside a description is replaced
 * by its name, which drops the pills from what is read. Pills wrap onto
 * further lines and never clip.
 *
 * Renders nothing for an empty list: a title with nothing to name shows no
 * line at all. Display only; nothing is stored from this.
 */
export default function LeftOutPills({
  items,
  id,
  className = "",
  trailing,
  listNamed = true,
}: {
  items: readonly string[];
  /** On the wrapper, for an `aria-describedby` that points at the whole line. */
  id?: string;
  /** Spacing from the caller ("mt-1"). */
  className?: string;
  /** Plain text after the pills ("(3 cards)"). */
  trailing?: ReactNode;
  /**
   * Name the `<ul>` by the visible label (default). Pass false when `id` is
   * referenced by an `aria-describedby`, so the description keeps the pills.
   */
  listNamed?: boolean;
}) {
  const labelId = useId();
  if (items.length === 0) return null;
  return (
    <div id={id} className={`flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs ${className}`.trim()}>
      <span id={labelId} className="text-ink-2">
        Left out to fit
      </span>
      <ul role="list" aria-labelledby={listNamed ? labelId : undefined} className="flex min-w-0 flex-wrap gap-1">
        {items.map((item, index) => (
          <li
            key={`${item}-${index}`}
            className="max-w-full rounded-full border border-neon-purple-text/60 bg-neon-purple/10 px-2 py-0.5 text-neon-purple-text wrap-anywhere"
          >
            {item}
            {index < items.length - 1 && <span className="sr-only">, </span>}
          </li>
        ))}
      </ul>
      {trailing}
    </div>
  );
}
