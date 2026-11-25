import { useEffect, useId, useImperativeHandle, useRef, useState, type Ref } from "react";
import { PencilSquareIcon } from "@heroicons/react/24/outline";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useFieldTestClass } from "../../src/hooks/useFieldTestClass";
import { Textarea } from "../primitives/Textarea";
import { VARIANT_TYPE_RENAME_REFUSED } from "../../convex/variantRole";

/**
 * NEO-96: inline rename for a single `selectorOptions` row's display value.
 *
 * Until now `value` was write-once — set at insert and never patched anywhere
 * in the codebase — so a typo in a sport, year, manufacturer, set or variant
 * name was permanent. (`renamePlatformLabel` renames a MARKETPLACE label, which
 * is a different thing.) Renaming only became safe once entities referenced the
 * sport ROW instead of copying its label: before that, a rename would silently
 * orphan every team/player holding the old string, and break SKU generation and
 * enrichment, which both keyed off the display name.
 *
 * ── WHERE THIS LIVES (read before moving it) ────────────────────────────────
 * A pencil icon immediately after SetAttributesPanel's header title, which is
 * the name it renames. That adjacency IS the affordance: an earlier revision
 * put a "Rename" text link over by the SET ATTRIBUTES heading, far from the
 * name, where nobody would connect the two.
 *
 * The panel targets exactly one row — the deepest current selection, at ANY
 * level — so rename reaches sports, years, manufacturers, sets and variants.
 *
 * Do not put it back on the selector rows: it was there first, one per row in
 * every column, which was a lot of permanent weight for a rare action. An
 * EntitySelector row is also a single full-width <button>, and a <button>
 * inside a <button> is invalid HTML that browsers reparent, detaching the
 * click handler — so it could only ever be a sibling, never inline with the
 * name the way it is here.
 *
 * ── UNCONTROLLED INPUT (NEO-36 pattern — do not "fix" this back) ─────────────
 * The name field is UNCONTROLLED (a ref, read at commit) rather than controlled
 * React state, for the same reason as CardChecklist's add-card form: this row
 * lives in a Convex-reactive list that re-renders on every selectorOptions
 * update, and those externally-triggered re-renders contend with a controlled
 * input's value. React never reconciles an uncontrolled input's value, so the
 * DOM holds exactly what was typed and commit() reads it directly: what you
 * see is what you save.
 *
 * ── PRE-FILLED, IN THE TITLE'S PLACE (NEO-667) ─────────────────────────────
 * Jason, 2026-11-25: the editor "should open up a text area where the title
 * label is before you hit edit instead of opening this tiny text area to the
 * right of it. The text area should also contain the current title right away
 * so that it can be inline edited easily."
 *
 * So the field opens holding the current name (`defaultValue`, still
 * uncontrolled: the NEO-36 note above stands), with the caret at the end so one
 * word can be fixed without retyping the rest. It is a textarea that takes the
 * title's width and wraps (never clips) a long name; the host hides the title
 * while this control is busy (`onBusyChange`) so the field stands in its place.
 * Enter still saves (a name is one line, so Enter never inserts a newline) and
 * Escape cancels. Saving an unchanged or emptied field is still a no-op that
 * closes the editor, so the old name is never lost by accident.
 *
 * (NEO-96 once opened it EMPTY with the name as a placeholder, because a
 * caret placed by a click made a backspace-based E2E clear leave a tail. The
 * specs now `fill`, which replaces, so that reason is gone.)
 *
 * ── MAESTRO ─────────────────────────────────────────────────────────────────
 * Selectors are visible text or aria-label only. The input additionally carries
 * a per-instance class from useFieldTestClass: maestro-web's `inputText` builds
 * an XPath from `id` → `class` → positional index, and every row here would
 * otherwise share one Tailwind className, so typing would land in the first
 * row's input rather than the one the test tapped (mobile-dev-inc/maestro#1083).
 *
 * Interaction mirrors MultiSourcePanel's Chip, the existing inline-rename
 * precedent: Enter commits, Escape reverts, blur commits, errors surface in a
 * role="alert" rather than being swallowed.
 *
 * ── EVERY ROW IS RENAMEABLE (NEO-239) ───────────────────────────────────────
 * `variantType` rows used to be refused a rename outright, because the BSC
 * checklist fetch re-derived its `variant` facet from the value. That facet now
 * comes off the row's tagged BSC slot, so no marketplace query reads a title.
 *
 * ── A VARIANT TYPE'S TITLE IS ITS KIND (NEO-334) ────────────────────────────
 * Jason, 2026-10-10: the type titled "Base" is the set's Base, "Insert(s)" is
 * an Insert type, "Parallel(s)" a Parallel type (`variantTypeKind`). So a
 * rename of a variant type can change what it is, and the server refuses that
 * while rows sit beneath it, as well as a second "Base" and a title whose
 * singular or plural a sibling already holds. Each refusal is a sentence
 * written for the operator; it renders on its own line under the panel header
 * (`order-last basis-full` in the header's wrapping row), because those
 * sentences are too long for the slot beside the field.
 */

/**
 * The server's refusal payload for a rename it would not accept. Matched
 * structurally rather than with `instanceof ConvexError` so a mocked/rethrown
 * error in a test, or a version skew in the convex client, still surfaces the
 * server's own words. NEO-334 brought the code back: a variant type whose
 * rename would change its kind with rows beneath it, a second "Base", or a
 * same-word sibling ("Promos" beside "Promo").
 */
function refusalMessage(e: unknown): string | null {
  if (typeof e !== "object" || e === null) return null;
  const data = (e as { data?: unknown }).data;
  if (typeof data !== "object" || data === null) return null;
  const { code, message } = data as { code?: unknown; message?: unknown };
  if (code !== VARIANT_TYPE_RENAME_REFUSED) return null;
  return typeof message === "string" && message.length > 0
    ? message
    : "This name can't be changed.";
}
/** NEO-569 — what a host may ask of the control: put focus in its name field. */
export type RenameEntityHandle = { focusField: () => void };

export default function RenameEntityControl({
  id,
  currentValue,
  disabled,
  onBusyChange,
  ref,
}: {
  id: Id<"selectorOptions">;
  currentValue: string;
  disabled?: boolean;
  /**
   * NEO-569 — told `true` while the name field is open or its save is in
   * flight, and `false` when neither (and on unmount). A host that can unmount
   * this control (the Attributes panel shutting) holds off while it is `true`:
   * the refusal line and the typed name live in this control's own state, and a
   * collapse would drop both and leave focus on <body>.
   */
  onBusyChange?: (busy: boolean) => void;
  /**
   * NEO-569 — a press on the host's toggle while this control is busy is
   * refused; the host sends focus here so the refusal (the field's
   * `aria-describedby`) is read, rather than leaving it on the toggle.
   */
  ref?: Ref<RenameEntityHandle>;
}) {
  const rename = useMutation(api.selectorOptions.renameSelectorOption);
  const fieldClass = useFieldTestClass();
  const errorId = useId();

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  // Guards the focus-restore effect below so it only fires on a genuine
  // editing->not-editing transition, never on this component's own initial
  // mount (where `editing` is already false and there is nothing to restore
  // focus FROM).
  const wasEditingRef = useRef(false);
  useImperativeHandle(ref, () => ({
    focusField: () => inputRef.current?.focus({ preventScroll: true }),
  }));

  // Focus goes into the field with the caret after the name (NEO-667): the
  // name is already there to edit, not to replace.
  useEffect(() => {
    const field = inputRef.current;
    if (!editing || !field) return;
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
  }, [editing]);

  // Held in a ref so a host passing a fresh callback each render does not
  // re-run the effect below (and so flicker `false` then `true`).
  const onBusyChangeRef = useRef(onBusyChange);
  useEffect(() => {
    onBusyChangeRef.current = onBusyChange;
  });
  const busy = editing || saving;
  useEffect(() => {
    onBusyChangeRef.current?.(busy);
  }, [busy]);
  useEffect(() => () => onBusyChangeRef.current?.(false), []);

  // The input unmounts the instant `editing` goes false (commit succeeding,
  // or Escape reverting) and the pencil button takes its place — with nothing
  // to move focus onto it, the browser drops focus to <body>. Same shape as
  // every other busy/unmount focus-park case in this codebase; here the
  // return target is simply the control that opened the editor.
  useEffect(() => {
    if (wasEditingRef.current && !editing) buttonRef.current?.focus();
    wasEditingRef.current = editing;
  }, [editing]);

  // Auto-grow fallback (NEO-667): `[field-sizing:content]` is not in every
  // browser, and the field is `overflow-hidden` (no scrollbar, rows={1}), so
  // without this a long name would clip on one line. Size to the content.
  const grow = () => {
    const field = inputRef.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${field.scrollHeight}px`;
  };
  useEffect(() => {
    if (editing) grow();
  }, [editing]);

  const commit = async () => {
    // Read the live DOM value (uncontrolled input) — see the NEO-36 note above.
    // A textarea keeps a pasted newline where the old single-line input stripped
    // it: names stay one line, so a line break becomes one space.
    const trimmed = (inputRef.current?.value ?? "").replace(/(?:\r?\n)+/g, " ").trim();
    if (saving) return;
    if (!trimmed || trimmed === currentValue) {
      setEditing(false);
      setError(null);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await rename({ id, value: trimmed });
      setEditing(false);
    } catch (e) {
      // Surface it: a sibling-name collision is the expected failure here and
      // the user needs to see why their rename didn't take. A variantType
      // refusal (NEO-334) arrives as a structured ConvexError whose own
      // message explains why the title is load-bearing — render that, not a
      // generic.
      setError(refusalMessage(e) ?? (e instanceof Error ? e.message : "Rename failed"));
    } finally {
      setSaving(false);
    }
  };

  // Android soft keyboards send Enter as a `beforeinput` of type
  // `insertLineBreak` rather than a keydown Enter. React's `onBeforeInput` is
  // built on keypress/textInput and carries no `inputType`, so this listens for
  // the native event. Read through a ref so the listener always sees the latest
  // `commit` (its `saving` guard) without re-binding.
  const commitRef = useRef(commit);
  useEffect(() => {
    commitRef.current = commit;
  });
  useEffect(() => {
    const field = inputRef.current;
    if (!editing || !field) return;
    const onBeforeInput = (e: Event) => {
      if ((e as InputEvent).inputType !== "insertLineBreak") return;
      e.preventDefault();
      void commitRef.current();
    };
    field.addEventListener("beforeinput", onBeforeInput);
    return () => field.removeEventListener("beforeinput", onBeforeInput);
  }, [editing]);

  // Closing unmounts the field; it remounts holding the current name, so there
  // is nothing to reset.
  const cancel = () => {
    setEditing(false);
    setError(null);
  };

  if (!editing) {
    return (
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        onClick={() => setEditing(true)}
        aria-label={`Rename ${currentValue}`}
        title={`Rename ${currentValue}`}
        // min-w-6 min-h-6: a bare 16x16 icon is a ~16x16 hit target, under
        // WCAG 2.5.8's 24x24 CSS pixel minimum. NEO-306: no chip — the pencil
        // stays small beside the name it edits — but it wears the panel's one
        // focus ring (2px #00C2FF, offset). The old `focus:outline-none` with
        // only a colour change was a focus indicator in name only.
        className="shrink-0 inline-flex items-center justify-center min-w-6 min-h-6 rounded text-ink-3 hover:text-neon-green-text focus-outline disabled:opacity-50"
      >
        <PencilSquareIcon className="w-4 h-4" aria-hidden="true" />
      </button>
    );
  }

  // A fragment, not one wrapper: the refusal is a SIBLING of the field in the
  // panel header's wrapping flex row, so `basis-full` gives it a line of its
  // own and `order-last` puts that line under the whole header row (after
  // the Base tag and the delete) rather than splitting the row in two.
  //
  // The field's wrapper grows from a zero basis to fill the row (the title
  // it stands in for is hidden by the host), and wraps the Base tag and
  // delete onto the next line only when there is no room beside it.
  return (
    <>
      <div className="grow basis-0 min-w-32">
        <Textarea
          bare
          ref={inputRef}
          rows={1}
          defaultValue={currentValue}
          // readOnly + aria-disabled, not disabled: this field's own onKeyDown
          // triggers commit() directly (Enter), which sets `saving` true
          // synchronously — a native `disabled` on the still-focused field
          // would force-blur it to <body> for the duration of the rename
          // round-trip. readOnly blocks edits without removing focusability;
          // aria-disabled still announces the busy state.
          readOnly={saving}
          aria-disabled={saving || undefined}
          aria-label={`Edit name for ${currentValue}`}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          // A refusal describes the name that was refused; once the operator
          // edits, it no longer does. (Uncontrolled field — this reads nothing,
          // it only clears.) A blur-commit that is refused keeps the editor
          // OPEN in this error state on purpose: closing it would hide the
          // reason and drop what they typed.
          onChange={() => error && setError(null)}
          onInput={grow}
          enterKeyHint="done"
          // One line tall to start, then as tall as the name needs
          // (`field-sizing`, as CardTitlesStep's boxes do); `wrap-anywhere`
          // breaks a long unbroken token rather than clipping or widening the
          // page (NEO-499). Type matches the title it replaces.
          className={`${fieldClass("rename")} block w-full min-w-0 resize-none overflow-hidden px-2 py-1 text-sm font-semibold leading-snug wrap-anywhere [field-sizing:content]`}
          onKeyDown={(e) => {
            // Stop the row's own handlers from seeing these — the row is a
            // sibling button and Enter would otherwise also select it.
            e.stopPropagation();
            // An Enter that confirms an IME composition is not a save.
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              // A name is one line: Enter saves rather than adding a newline.
              e.preventDefault();
              void commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
          }}
          onBlur={() => void commit()}
        />
      </div>
      {error && (
        <p
          id={errorId}
          role="alert"
          className="order-last basis-full max-w-prose text-xs leading-snug text-neon-pink-text"
        >
          {error}
        </p>
      )}
    </>
  );
}
