import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";

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
 * Colour is never the only carrier: the level is also written into the DOM
 * as text ("To fix", "To check", "Waiting") that the section is described by,
 * so a screen reader and a colour-blind operator get it too.
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

const LEVEL_CLASS: Record<TidyTileLevel, string> = {
  fix: "border-2 border-neon-pink-text bg-wash-pink",
  check: "border-2 border-neon-blue-text bg-wash-blue",
  plain: "border border-rule bg-raised",
  waiting: "border-[1.5px] border-dashed border-rule bg-transparent",
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

  return (
    <section
      aria-labelledby={headingId}
      aria-describedby={levelText ? levelId : undefined}
      aria-busy={waiting || undefined}
      data-tidy-level={level}
      className={`grid min-w-0 gap-2 rounded-[10px] px-3.5 py-3 ${LEVEL_CLASS[level]}`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 id={headingId} className={`min-w-0 text-sm font-semibold wrap-anywhere ${HEADING_CLASS[level]}`}>
          {heading}
        </h3>
        {levelText && (
          <span id={levelId} className="sr-only">
            {levelText}
          </span>
        )}
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

/**
 * "Answer, then Apply to all": a dashed blue button that offers this card's
 * answer to every card it fits. `label` is the whole visible text
 * ("Apply to all 12 autographed cards"); `count` is how many cards it offers
 * to, and the button is not rendered for fewer than one. The server re-checks
 * every card (the client only proposes), so a refusal is the caller's to
 * report; a thrown error is shown here, inline, so the operator can retry.
 */
export function ApplyToAllButton({
  count,
  label,
  onApply,
}: {
  count: number;
  label: string;
  onApply: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  // The last outcome, tied to the offer it answered: a new offer (the label or
  // count moved) is a new question, so an old result stops showing by itself.
  const [outcome, setOutcome] = useState<{ offer: string; kind: "done" | "failed" } | null>(null);
  const offer = `${label}\u0000${count}`;
  const failed = outcome?.offer === offer && outcome.kind === "failed";
  const done = outcome?.offer === offer && outcome.kind === "done";
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  if (count < 1) return null;

  const apply = async () => {
    if (busy) return;
    setBusy(true);
    setOutcome(null);
    try {
      await onApply();
      if (alive.current) setOutcome({ offer, kind: "done" });
    } catch {
      if (alive.current) setOutcome({ offer, kind: "failed" });
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <button
        type="button"
        onClick={() => void apply()}
        aria-disabled={busy || undefined}
        className="focus-outline hit-area-24 max-w-full rounded-[7px] border-[1.5px] border-dashed border-neon-blue-text bg-transparent px-2.5 py-1 text-left text-xs font-medium text-neon-blue-text wrap-anywhere hover:bg-neon-blue/10 aria-disabled:cursor-wait aria-disabled:opacity-60"
      >
        {label}
      </button>
      <span role="status" className="text-xs text-ink-2 empty:hidden">
        {busy ? "Applying…" : done ? "Applied." : null}
      </span>
      <span role="alert" className="text-xs text-neon-pink-text empty:hidden">
        {failed ? "Didn't apply, try again." : null}
      </span>
    </span>
  );
}
