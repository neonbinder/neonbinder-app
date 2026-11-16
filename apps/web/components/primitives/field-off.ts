/**
 * NEO-535 — how a text field looks when it is off: native `disabled`, or
 * `aria-disabled="true"` on a field kept `readOnly` so focus stays in it (the
 * focus-park pattern: a field that turns native-disabled under the caret
 * blurs to <body>).
 *
 * The same swap a disabled `NeonButton` makes (DESIGN.md, Buttons →
 * Disabled): the `button-neutral` fill in place of the well. The ink steps
 * down to `ink-2`, not `ink-3`: ink-3 misses 4.5:1 on that fill in dark
 * (`TEXT_NEVER_ON`), and the value in a held field still has to be readable
 * while it waits. A fade was the old look; on white a faded field reads as a
 * pale, still-live one.
 *
 * Keyed off the state attributes, never off bare `readOnly`: a field that is
 * read-only only for the instant a reactive commit is in flight (the card
 * drawer's autosave) must not flash grey on every blur.
 *
 * Shared by `Input` and `Textarea`, the only two places it is applied; a
 * caller never adds an opacity of its own.
 */
export const FIELD_OFF =
  "disabled:cursor-not-allowed disabled:bg-button-neutral disabled:text-ink-2 aria-disabled:cursor-not-allowed aria-disabled:bg-button-neutral aria-disabled:text-ink-2";
