import React from "react";

export interface CheckboxProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "children"> {
  /** Plain-text label, set in the primitive's own type (text-sm, medium). */
  label?: React.ReactNode;
  /**
   * Rich label content. Rendered inside the same row and inherits the type of
   * the surrounding text, so set `className="text-xs text-ink-2"` (or similar)
   * on the Checkbox for a denser row.
   */
  children?: React.ReactNode;
  /** Shown under the label with `variant="withText"`. Not part of the name. */
  description?: string;
  variant?: "default" | "withText";
}

/**
 * The box: 16px, `peer` so the tick and the rest of the row read the input's
 * own state (`peer-checked`, `peer-indeterminate`), whether it is controlled
 * or not.
 */
function Box({
  inputRef,
  inputProps,
  hitArea = false,
}: {
  inputRef: React.ForwardedRef<HTMLInputElement>;
  inputProps: React.InputHTMLAttributes<HTMLInputElement>;
  /** Grow the input's own hit area to 24px (the bare box, which has no row). */
  hitArea?: boolean;
}) {
  return (
    <span className="relative inline-flex h-4 w-4 shrink-0">
      <input
        ref={inputRef}
        type="checkbox"
        {...inputProps}
        className={`peer ${hitArea ? "hit-area-24 " : ""}h-4 w-4 cursor-pointer appearance-none rounded border border-control bg-field checked:border-selection checked:bg-selection indeterminate:border-selection indeterminate:bg-selection focus-outline disabled:cursor-not-allowed aria-disabled:cursor-not-allowed forced-colors:border-[color:CanvasText]`}
      />
      {/* The tick shows when checked and not indeterminate; the dash shows
          when `el.indeterminate` is set, whatever `checked` says (native). */}
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-4 w-4 text-surface opacity-0 peer-[:checked:not(:indeterminate)]:opacity-100 forced-colors:text-[color:CanvasText]"
        fill="currentColor"
        viewBox="0 0 20 20"
      >
        <path
          fillRule="evenodd"
          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
          clipRule="evenodd"
        />
      </svg>
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-4 w-4 text-surface opacity-0 peer-indeterminate:opacity-100 forced-colors:text-[color:CanvasText]"
        fill="currentColor"
        viewBox="0 0 20 20"
      >
        <rect x="4" y="9" width="12" height="2" rx="1" />
      </svg>
    </span>
  );
}

/**
 * The one checkbox. The whole row (box plus text) is a `<label>` at least 24px
 * tall, so clicking the text toggles the box, while the box itself stays 16px.
 * The tick shows for controlled and uncontrolled use alike. A caller sets
 * `indeterminate` natively through the ref (`el.indeterminate = true`) and the
 * box draws a dash in place of the tick.
 *
 * Forced colors (Windows high contrast): the border and the tick/dash draw in
 * `CanvasText`, since the fill is dropped.
 *
 * Disabled: pass `disabled` (native) or `aria-disabled` (the box stays
 * focusable; the caller's `onChange` must ignore the change). Both dim the
 * row and show a not-allowed cursor.
 *
 * With no `label`, `children` or `description` it is just the bare box, for
 * a caller that already wraps it in its own `<label>`.
 */
export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  (
    {
      label,
      children,
      description,
      variant = "default",
      className = "",
      "aria-describedby": ariaDescribedBy,
      ...props
    },
    ref,
  ) => {
    const descriptionId = React.useId();
    const hasText = label !== undefined && label !== null && label !== false;
    const hasChildren = children !== undefined && children !== null && children !== false;
    const showDescription = variant === "withText" && Boolean(description);

    if (!hasText && !hasChildren && !showDescription) {
      return (
        <span
          className={`inline-flex has-[input:disabled]:opacity-60 has-[input[aria-disabled=true]]:opacity-60 ${className}`}
        >
          {/* The 24px hit area is a ::before on the input itself (`.hit-area-24`,
              globals.css): a click on it is a click on the input, so no extra
              <label> (callers often wrap the bare box in their own). */}
          <Box
            inputRef={ref}
            inputProps={{ ...props, "aria-describedby": ariaDescribedBy }}
            hitArea
          />
        </span>
      );
    }

    const describedBy =
      [ariaDescribedBy, showDescription ? descriptionId : undefined]
        .filter(Boolean)
        .join(" ") || undefined;

    return (
      <div className={className}>
        <label className="flex min-h-6 cursor-pointer items-start gap-2 has-[input:disabled]:cursor-not-allowed has-[input:disabled]:opacity-60 has-[input[aria-disabled=true]]:cursor-not-allowed has-[input[aria-disabled=true]]:opacity-60">
          {/* The box sits in a cell as tall as the first line plus 4px of
              air above and below, so it centres on that line when the text
              wraps and the row is never under 24px. */}
          <span className="flex h-[calc(1lh+0.5rem)] min-h-6 shrink-0 items-center">
            <Box
              inputRef={ref}
              inputProps={{ ...props, "aria-describedby": describedBy }}
            />
          </span>
          <span className="min-w-0 py-1">
            {hasText && <span className="text-sm font-medium text-ink">{label}</span>}
            {children}
          </span>
        </label>
        {showDescription && (
          <p id={descriptionId} className="pl-6 text-sm text-ink-3 leading-5">
            {description}
          </p>
        )}
      </div>
    );
  },
);

Checkbox.displayName = "Checkbox";
