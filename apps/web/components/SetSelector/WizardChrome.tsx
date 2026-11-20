import { useState, type ReactNode } from "react";
import { variantTypeKindFromTitle } from "../../convex/variantRole";

/**
 * NEO-335 — the header every "tidy up" screen wears: the entity review
 * wizard before a save, and the post-save attention walker after one.
 *
 * Jason, 2026-10-10: one title, each screen type its own subtitle. NEO-497:
 * the title names the set it is tidying ("Tidy up 2024 Topps Chrome",
 * `tidyUpTitleFromChain`) instead of "this set". A Base variant type leaves
 * the variant out (Jason, 2026-11-11): the Base checklist reads as the set
 * itself. NEO-616: only that row does; a name is never trimmed.
 * NEO-467 (Jason, 2026-11-07): no "Step x of y" and no "2 more steps" line.
 * The bar under the title is the only progress there is, and it only has to
 * be reasonably accurate.
 *
 *   ┌──────────────────────────────────────────────┐
 *   │ Tidy up 2024 Topps Chrome                    │
 *   │ New team                                     │
 *   ├██████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░┤  ← the bar IS the header's edge
 *
 * The bar is the screen's single bold element: the neon green fill stands
 * where the header's grey divider used to be (`neon-green-text`, the hue's
 * text-role token: the bright fill is ~1.5:1 on the light track, this one is
 * 3:1 or better in both themes and identical to the fill in dark), so progress is literally the
 * line between "where am I" and "what is this". Everything else in the header
 * is quiet type.
 *
 * ## Forward only
 *
 * The fill is a high-water mark for the sitting (this component mounts with
 * the dialog, so a new sitting starts empty). A plan that grew, a Back, a
 * Change decision: the bar stalls where it is and catches up later, because a
 * bar that slides backwards reads as "you lost work". Only forward moves
 * animate, and under `prefers-reduced-motion` nothing does.
 *
 * ## Screen readers
 *
 * - The title is the dialog's name — the host points `aria-labelledby` at
 *   `titleId`. A long set name wraps; past three lines it is clamped
 *   visually, but the heading's text stays whole, so its accessible name is
 *   the full title (also in its `title` attribute for a sighted hover).
 * - The bar is a `progressbar` named "Wizard progress": `aria-valuenow` is the
 *   rounded percent and `aria-valuetext` is the subtitle, so it reads as the
 *   step the operator is on rather than a number to decode. The bar is not a
 *   live region: one that announced itself on every move would talk over the
 *   step's own heading, and a percent is not news.
 * - The subtitle IS the step announcement: a polite `role="status"` that is
 *   mounted before it has words and stays mounted while empty (a region that
 *   appears together with its text is announced unreliably), so each move to
 *   a new screen says its name ("New team", "Ready to save") once. The host
 *   keeps this header mounted across steps, which is what lets the text
 *   change inside one region instead of arriving with a new one.
 * The subtitle row has a fixed minimum height whatever it says, so the body
 * below the header never moves between steps (the NEO-110 rule the wizard's
 * footer already lives by).
 */

/** The title while the set's names are still loading, or none is known. */
export const WIZARD_TITLE = "Tidy up this set";

/**
 * True when `text` opens with `token` as a whole word, case-folded: "2024
 * Topps Chrome" opens with "2024", "Unleashed Blue Ice" with "Unleashed",
 * but "Unleashed2" does not open with "Unleashed". A pure string check on NB's
 * own names, used only to keep the title from saying a word twice.
 */
function startsWithToken(text: string, token: string): boolean {
  if (token === "") return false;
  const haystack = text.toLowerCase();
  const needle = token.toLowerCase();
  if (!haystack.startsWith(needle)) return false;
  const next = haystack.charAt(needle.length);
  return next === "" || /\s/.test(next);
}

/**
 * NEO-497 — "Tidy up 2026 Donruss Unleashed Blue Ice": the year, the set and
 * the variant the checklist belongs to, so the operator always knows which
 * set the dialog is tidying. Each part is skipped when it is missing or
 * blank, and with none known (the chain still loading) the title stays
 * `WIZARD_TITLE`. A set whose own name already opens with the year ("2024
 * Topps Chrome") does not get the year twice. Every name is taken exactly as
 * it is: nothing here trims a word from a set, insert or parallel name
 * (NEO-616: "1989 Pro Set Base" keeps its "Base"). The Base checklist's own
 * title ("Tidy up 2026 Donruss Unleashed") comes from the caller leaving
 * `variant` out (`tidyUpTitleFromChain`). Display only: nothing reads this
 * string back, and no behaviour keys on it.
 */
export function tidyUpTitle({
  year,
  setName,
  variant,
}: {
  year?: string | null;
  setName?: string | null;
  variant?: string | null;
}): string {
  const yearText = year?.trim() ?? "";
  const setText = setName?.trim() ?? "";
  const parts = [startsWithToken(setText, yearText) ? "" : yearText, setText, variant?.trim() ?? ""]
    .filter((part) => part !== "");
  const name = parts.join(" ");
  return name !== "" ? `Tidy up ${name}` : WIZARD_TITLE;
}

/** The levels a checklist leaf can sit at below its set. */
const VARIANT_LEVELS: ReadonlySet<string> = new Set(["variantType", "insert", "parallel"]);

/**
 * The variant words for a leaf.
 *
 * A `variantType` leaf that is the set's Base (`variantTypeKindFromTitle`,
 * the NEO-334 reading of that row's own title: "Base" or "Bases") has none:
 * the Base checklist reads as the set itself. That is the only name left
 * out. An insert or parallel that happens to be called "Base", or ends in
 * it, is its own name and stays whole (NEO-616).
 *
 * A `parallel`-level row only ever sits under an `insert`-level row
 * (NEO-334: sub-variants live under Insert types; a parallel of base is
 * itself an `insert`-level row under the "Parallel" type), and on its own
 * "Gold" does not say WHICH insert's Gold. So a parallel leaf is named after
 * its insert first ("Future Stars Gold"), unless its own name already opens
 * with the insert's ("Unleashed Blue Ice" under "Unleashed").
 */
function variantTitle(
  chain: ReadonlyArray<{ level: string; value: string }>,
): string | undefined {
  const leaf = chain.at(-1);
  if (!leaf || !VARIANT_LEVELS.has(leaf.level)) return undefined;
  const leafText = leaf.value.trim();
  if (leaf.level === "variantType" && variantTypeKindFromTitle(leafText) === "base") {
    return undefined;
  }
  if (leaf.level !== "parallel") return leafText;
  let insertText = "";
  for (let i = chain.length - 2; i >= 0; i--) {
    if (chain[i].level === "insert") {
      insertText = chain[i].value.trim();
      break;
    }
  }
  if (insertText === "" || startsWithToken(leafText, insertText)) return leafText;
  return leafText === "" ? insertText : `${insertText} ${leafText}`;
}

/**
 * `tidyUpTitle` read off a `getAncestorChain` result, which runs root first
 * and INCLUDES the leaf itself. The year and set come from their own levels
 * (the set is the `setName` row, not the manufacturer); the variant is the
 * leaf's own value (`variantTitle`: a parallel carries its insert's name),
 * and only when the leaf sits below the set, so a chain that ends at the set
 * never names it twice. Undefined (loading) gives `WIZARD_TITLE`.
 */
export function tidyUpTitleFromChain(
  chain: ReadonlyArray<{ level: string; value: string }> | null | undefined,
): string {
  if (!chain) return WIZARD_TITLE;
  return tidyUpTitle({
    year: chain.find((row) => row.level === "year")?.value,
    setName: chain.find((row) => row.level === "setName")?.value,
    variant: variantTitle(chain),
  });
}

/** The progressbar's accessible name. E2E specs and the a11y audit target it. */
export const WIZARD_PROGRESS_LABEL = "Wizard progress";

export interface WizardChromeProps {
  /** Steps finished. Equal to `planned` reads as 100%. */
  done: number;
  /** Steps in this sitting, as best known. 0 leaves the bar empty. */
  planned: number;
  /** The screen type — "New team", "Cards with no team", "Ready to save". */
  subtitle: string;
  /** "Tidy up 2024 Topps Chrome" (`tidyUpTitle`); defaults to `WIZARD_TITLE`. Also the h2's `title` attribute. */
  title?: string;
  /** Id for the title, so the host dialog can be `aria-labelledby` it. */
  titleId?: string;
  /** Anything the host needs under the subtitle row. */
  children?: ReactNode;
}

/** done ÷ planned, clamped to 0..1. */
export function progressFraction(done: number, planned: number): number {
  if (!(planned > 0)) return 0;
  return Math.min(1, Math.max(0, done / planned));
}

export default function WizardChrome({
  done,
  planned,
  subtitle,
  title = WIZARD_TITLE,
  titleId,
  children,
}: WizardChromeProps) {
  const target = progressFraction(done, planned);
  /*
   * The high-water mark, kept with the render-phase update React documents
   * for "information from previous renders" (not a ref read during render):
   * whether this render animates is part of its output, so it is decided
   * before commit. `forward` is true only for the render that moved it.
   */
  const [bar, setBar] = useState({ fraction: target, forward: false });
  if (target > bar.fraction) {
    setBar({ fraction: target, forward: true });
  }
  const fraction = Math.max(bar.fraction, target);
  const forward = target > bar.fraction || bar.forward;
  const percent = fraction * 100;

  return (
    <header className="shrink-0">
      <div className="px-6 pt-4 pb-3">
        {/* A long set name wraps in balanced lines; `wrap-anywhere` breaks a
            single unbroken word. Past three lines it is clamped VISUALLY
            only: the text stays whole, so the heading's accessible name (and
            the dialog's, through `aria-labelledby`) is the full title, and
            `title` shows it on hover. */}
        <h2
          id={titleId}
          title={title}
          className="min-w-0 text-lg font-semibold text-ink text-balance wrap-anywhere line-clamp-3"
        >
          {title}
        </h2>
        <p role="status" className="mt-0.5 min-h-5 text-sm text-ink-3">
          {subtitle}
        </p>
        {children}
      </div>
      <div
        role="progressbar"
        aria-label={WIZARD_PROGRESS_LABEL}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent)}
        aria-valuetext={subtitle || undefined}
        className="relative h-1.5 w-full bg-rule"
      >
        <div
          data-rail-fill=""
          data-rail-forward={forward ? "true" : "false"}
          className={[
            "absolute inset-y-0 left-0 bg-neon-green-text shadow-[0_0_10px_rgb(0_213_88/calc(0.65*var(--glow)))]",
            forward
              ? "transition-[width] duration-300 ease-out motion-reduce:transition-none"
              : "transition-none",
          ].join(" ")}
          style={{ width: `${percent.toFixed(3)}%` }}
        />
      </div>
    </header>
  );
}
