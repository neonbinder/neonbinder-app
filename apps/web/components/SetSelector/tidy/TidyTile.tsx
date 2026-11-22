import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ExclamationTriangleIcon, EyeIcon } from "@heroicons/react/16/solid";

/**
 * NEO-645 — the tile shell for the per-card Tidy Up walk.
 *
 * One tile is one question about the open card. Its LEVEL is how much the
 * walk cares:
 *
 * - `fix`     pink, solid 2px edge. Blocks Save & next; the card can't be
 *             listed until it is answered.
 * - `check`   blue, solid 2px edge. A stop for review; never blocks.
 * - `plain`   a quiet 1px tile: answered, or never needed an answer.
 * - `waiting` a dashed skeleton. The tile depends on something unsettled (a
 *             disagreement, a lookup) so it renders no controls and runs
 *             nothing until it can.
 *
 * Colour is never the only carrier. "To fix" and "To check" are written
 * beside the heading, each behind its own shape (a warning triangle, an eye),
 * and the tile is described by that visible word, so a colour-blind operator
 * and a screen reader get it too, and it is read once. A waiting tile has no
 * label to see (its dashed edge and its line say it), so "Waiting" is spoken
 * text only.
 *
 * Roles, not palette steps: the edge and the heading use the neon `-text`
 * roles (they pass 3:1 on the tile in both modes), the wash is the
 * `wash-*` role (a tint in dark, plain white in light).
 */
export type TidyTileLevel = "fix" | "check" | "plain" | "waiting";

const LEVEL_TEXT: Record<TidyTileLevel, string | null> = {
  fix: "To fix",
  check: "To check",
  plain: null,
  waiting: "Waiting",
};

/**
 * Pink and blue tiles glow in dark, the mock's 14px neon halo. `--glow`
 * (app/theme.css) is 1 where neon is lit and 0 on paper, so light mode gets
 * no shadow at all. Outside the box only: nothing is drawn under the tile's
 * own text, so contrast is unchanged.
 */
const LEVEL_CLASS: Record<TidyTileLevel, string> = {
  fix: "border-2 border-neon-pink-text bg-wash-pink shadow-[0_0_14px_rgb(255_46_154/calc(0.4*var(--glow)))]",
  check: "border-2 border-neon-blue-text bg-wash-blue shadow-[0_0_14px_rgb(0_194_255/calc(0.4*var(--glow)))]",
  plain: "border border-rule-strong bg-raised",
  waiting: "border-[1.5px] border-dashed border-rule-strong bg-transparent",
};

/** The shape beside the word, so "to fix" and "to check" differ without colour. */
const LEVEL_ICON = {
  fix: ExclamationTriangleIcon,
  check: EyeIcon,
} as const;

const LEVEL_LABEL_CLASS: Record<"fix" | "check", string> = {
  fix: "text-neon-pink-text",
  check: "text-neon-blue-text",
};

const HEADING_CLASS: Record<TidyTileLevel, string> = {
  fix: "text-neon-pink-text",
  check: "text-neon-blue-text",
  plain: "text-ink",
  waiting: "text-ink-3",
};

export default function TidyTile({
  heading,
  level,
  aside,
  waitingText,
  children,
}: {
  /** "Player", "Team", "Sources disagree", "Listing title"... */
  heading: string;
  level: TidyTileLevel;
  /** Right of the heading: "Also on #USC118", a meter... */
  aside?: ReactNode;
  /** The skeleton's line, e.g. "Waiting on the spelling above". */
  waitingText?: string;
  children?: ReactNode;
}) {
  const headingId = useId();
  const levelId = useId();
  const levelText = LEVEL_TEXT[level];
  const waiting = level === "waiting";
  const visible = level === "fix" || level === "check" ? level : null;
  const Icon = visible ? LEVEL_ICON[visible] : null;

  return (
    <section
      role="group"
      aria-labelledby={headingId}
      aria-describedby={levelText ? levelId : undefined}
      aria-busy={waiting || undefined}
      data-tidy-level={level}
      className={`grid min-w-0 gap-2 rounded-[10px] px-3.5 py-3 ${LEVEL_CLASS[level]}`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <h3 id={headingId} className={`min-w-0 text-sm font-semibold wrap-anywhere ${HEADING_CLASS[level]}`}>
            {heading}
          </h3>
          {Icon && visible ? (
            <span
              id={levelId}
              className={`inline-flex items-center gap-1 text-xs font-medium ${LEVEL_LABEL_CLASS[visible]}`}
            >
              <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0 self-center" />
              {levelText}
            </span>
          ) : levelText ? (
            <span id={levelId} className="sr-only">
              {levelText}
            </span>
          ) : null}
        </div>
        {aside != null && !waiting && <div className="min-w-0 text-xs text-ink-2 wrap-anywhere">{aside}</div>}
      </div>
      {waiting ? (
        <div className="grid gap-2">
          {waitingText && <p className="text-xs text-ink-3 wrap-anywhere">{waitingText}</p>}
          <div
            aria-hidden="true"
            className="h-2.5 w-3/5 rounded bg-chip motion-safe:animate-pulse"
          />
        </div>
      ) : (
        children
      )}
    </section>
  );
}

/**
 * A purple note: shown only on a card that is already a stop, never makes one
 * ("Team filled from the player's career"). `role="note"` so it is announced
 * as supporting text, not as another control.
 */
export function TidyNote({ children }: { children: ReactNode }) {
  return (
    <p
      role="note"
      className="w-fit max-w-full rounded-md border border-neon-purple-text/60 bg-neon-purple/10 px-2 py-0.5 text-xs text-neon-purple-text wrap-anywhere"
    >
      {children}
    </p>
  );
}

/** What a bulk apply reports when the server counted: cards changed, cards left as they were. */
export type ApplyCounts = { applied: number; skipped?: number };

/**
 * What the counts count. Cards by default ("Applied to 4 cards."); the bulk
 * "Add all new players" counts players ("Added 12 players.").
 */
export type ApplyCountsWords = {
  /** Before the number: "Applied to" or "Added". */
  lead: string;
  one: string;
  many: string;
  /** When nothing changed. */
  none: string;
};
const CARD_WORDS: ApplyCountsWords = {
  lead: "Applied to",
  one: "card",
  many: "cards",
  none: "No cards changed.",
};
/** The bulk "Add all new players" counts players. */
export const PLAYER_WORDS: ApplyCountsWords = {
  lead: "Added",
  one: "player",
  many: "players",
  none: "No players added.",
};

/**
 * The line an Apply-to-all leaves behind. No counts (`undefined`: the writes are
 * scheduled pages, so nobody knows yet) reads "Applied."; none changed reads
 * "No cards changed."; otherwise the count, and what was left as it was.
 */
export function applyOutcomeText(
  result: void | ApplyCounts,
  words: ApplyCountsWords = CARD_WORDS,
): string {
  if (!result) return "Applied.";
  const { applied, skipped = 0 } = result;
  if (applied === 0) return words.none;
  const done = `${words.lead} ${applied} ${applied === 1 ? words.one : words.many}.`;
  if (skipped === 0) return done;
  return `${done} ${skipped} left as ${skipped === 1 ? "it was" : "they were"}.`;
}

/**
 * The dashed blue look of an Apply-to-all control, for the controls that offer
 * more than one card or name at a time. One string, so they never drift apart.
 */
export const DASHED_APPLY_CLASS =
  "focus-outline hit-area-24 max-w-full rounded-[7px] border-[1.5px] border-dashed border-neon-blue-text bg-transparent px-2.5 py-1 text-left text-xs font-medium text-neon-blue-text wrap-anywhere hover:bg-neon-blue/10 aria-disabled:cursor-wait aria-disabled:opacity-60";

/**
 * A size-1 `NeonButton` whose label is data (a player or team name, a pasted
 * value) or runs past about 35 characters: Radix fixes size 1 at 24px high and
 * `flex-shrink: 0`, so such a label runs out of a phone-width tile. This lets
 * it wrap inside the button instead (`min-h-6 py-1` is the same 24px on one
 * line). One string, so the buttons never drift apart.
 */
export const WRAP_LABEL_CLASS = "h-auto min-h-6 max-w-full py-1 text-left wrap-anywhere";

/**
 * "Answer, then Apply to all": a dashed blue button that offers this card's
 * answer to every card it fits. `label` is the whole visible text
 * ("Apply to all 12 autographed cards"); `count` is how many cards it offers
 * to, and the button is not rendered for fewer than one (its result stays, so
 * "Applied to 3 cards." survives the offer emptying). While that result is
 * showing the button stays on the page, `aria-disabled`, so the operator who
 * pressed it is not dropped out of the tab order when the offer empties. The server re-checks every
 * card (the client only proposes); its `{applied, skipped}` is the line shown
 * beside the button. A thrown error is shown here, inline, so the operator can
 * retry.
 */
export function ApplyToAllButton({
  count,
  label,
  onApply,
}: {
  count: number;
  label: string;
  /**
   * Resolve to the server's `{applied, skipped}` so the line says how many cards
   * changed and how many were left as they were; resolve to nothing when the
   * count is not known yet (scheduled pages) and it reads "Applied.".
   */
  onApply: () => Promise<void | ApplyCounts>;
}) {
  const [busy, setBusy] = useState(false);
  // The words on the button when it was pressed: the caller's label counts the
  // cards on offer, and "Apply to all 0 cards" is no label for a button that
  // is only still here to hold focus.
  const [pressedLabel, setPressedLabel] = useState<string | null>(null);
  // The last outcome, tied to the offer it answered: `at` is how many cards were
  // on offer when it was pressed. The apply itself shrinks the offer (the cards
  // now fit, so they stop being offered), so a smaller count keeps the result on
  // screen; a LARGER one is a new question and the old result stops showing.
  const [outcome, setOutcome] = useState<
    { at: number; kind: "done"; text: string } | { at: number; kind: "failed" } | null
  >(null);
  const current = outcome !== null && count <= outcome.at ? outcome : null;
  const failed = current?.kind === "failed";
  const doneText = current?.kind === "done" ? current.text : null;
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  if (count < 1 && current === null && !busy) return null;

  const apply = async () => {
    if (busy || count < 1) return;
    setPressedLabel(label);
    setBusy(true);
    setOutcome(null);
    try {
      const result = await onApply();
      if (alive.current) setOutcome({ at: count, kind: "done", text: applyOutcomeText(result) });
    } catch {
      if (alive.current) setOutcome({ at: count, kind: "failed" });
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      {(count >= 1 || current !== null || busy) && (
        <button
          type="button"
          onClick={() => void apply()}
          aria-disabled={busy || count < 1 || undefined}
          className={DASHED_APPLY_CLASS}
        >
          {count >= 1 ? label : (pressedLabel ?? label)}
        </button>
      )}
      <span role="status" className="text-xs text-ink-2 empty:hidden">
        {busy ? "Applying…" : doneText}
      </span>
      <span role="alert" className="text-xs text-neon-pink-text empty:hidden">
        {failed ? "Didn't apply, try again." : null}
      </span>
    </span>
  );
}
