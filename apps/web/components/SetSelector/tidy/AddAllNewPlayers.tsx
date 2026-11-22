import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useConvex, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import NeonButton from "../../modules/NeonButton";
import { useInlinePart } from "./inline-stack";
import { DASHED_APPLY_CLASS, PLAYER_WORDS, applyOutcomeText } from "./TidyTile";

/**
 * NEO-645 (decision 32) — "Add all N new players", at the top of the walk.
 *
 * The old wizard had "Add remaining players as new". Without it a set with a
 * hundred new rookies is a hundred per-card answers. The server offers only the
 * names nothing else could answer (`tidyNewPlayers.newPlayerNames`: lookup
 * finished, no same-name player, no "Did you mean", not ruled out), and
 * `addNewPlayers` re-checks every one before it writes.
 *
 * ## One screen of its own, inline
 *
 * The dashed control opens a confirm in place (not a dialog on top of the
 * walk): the names, each with the card numbers that print it, in a scrolling
 * list, then "Add N players" and "Cancel". Esc closes it (the walk's inline
 * stack, so it never reads as Save for later). Enter confirms only on the
 * confirm button itself; focus opens on the list, so a second Enter after
 * opening never writes a hundred players. The result is the house counts line
 * (`applyOutcomeText`), and "N left as they were" counts names the server no
 * longer found new.
 *
 * ## Read on demand
 *
 * The list reads the player table for every name, so it is never subscribed
 * (NEO-392): it is asked for (`useConvex().query`) when the walk opens and again
 * after anything that can change it moves (a name answered, a lookup landing,
 * a card arriving), settled for a moment so a run of answers asks once.
 */

type Offered = { name: string; cardNumbers: string[]; moreCards: boolean };
type Offer = { names: Offered[]; more: boolean };

/** How long the answer waits for the walk to stop changing. */
const REFRESH_SETTLE_MS = 400;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "#4, #17" and, when the list is cut, "#4, #17 and more". */
export function cardNumbersText(entry: Pick<Offered, "cardNumbers" | "moreCards">): string {
  const numbers = entry.cardNumbers.map((n) => `#${n}`).join(", ");
  return entry.moreCards ? `${numbers} and more` : numbers;
}

export default function AddAllNewPlayers({
  leafId,
  refreshKey,
}: {
  leafId: Id<"selectorOptions">;
  /**
   * Anything that can change who is offered, as one string: the names still
   * waiting on the checklist's cards and the lookups still running. A new value
   * asks the server again.
   */
  refreshKey: string;
}) {
  const convex = useConvex();
  const addNewPlayers = useMutation(api.tidyNewPlayers.addNewPlayers);
  const panelId = useId();
  const headingId = useId();

  const [offer, setOffer] = useState<Offer | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // The line the last press left, tied to the offer it answered: the add itself
  // shrinks the offer, so a smaller count keeps it on screen, and a larger one
  // (the next hundred) is a new question.
  const [result, setResult] = useState<{ text: string; at: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const [pressedLabel, setPressedLabel] = useState<string | null>(null);

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const busyRef = useRef(false);
  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Ask, settled. A reply that arrives after a newer ask went out is dropped.
  const asked = useRef(0);
  useEffect(() => {
    const ask = ++asked.current;
    const timer = setTimeout(() => {
      void convex
        .query(api.tidyNewPlayers.newPlayerNames, { leafId })
        .then((next) => {
          if (!alive.current || ask !== asked.current) return;
          setOffer(next);
          // The offer shrank below two while the confirm was open (another tab
          // answered the names): there is nothing left to confirm.
          if (next.names.length < 2) setOpen((o) => (busyRef.current ? o : false));
        })
        // Assistive: a failed read leaves the offer as it was.
        .catch(() => {});
    }, REFRESH_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [convex, leafId, refreshKey]);

  const names = useMemo(() => offer?.names ?? [], [offer]);
  const count = names.length;
  const outcome = result !== null && count <= result.at ? result.text : null;
  const label = offer?.more ? `Add the first ${count} new players` : `Add all ${count} new players`;

  const close = () => {
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
  };
  useInlinePart(open, close, panelRef);

  // The confirm opens with the list focused: reading starts at the names, and
  // Enter is the confirm button's alone.
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => listRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(id);
  }, [open]);

  const confirm = async () => {
    if (busy || count < 2) return;
    setBusy(true);
    setFailed(false);
    setResult(null);
    setPressedLabel(label);
    try {
      const counts = await addNewPlayers({ leafId, names: names.map((n) => n.name) });
      if (!alive.current) return;
      setResult({ text: applyOutcomeText({ applied: counts.created, skipped: counts.skipped }, PLAYER_WORDS), at: count });
      setOpen(false);
      // The confirm button is gone: the control that opened it takes focus.
      requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
    } catch {
      if (alive.current) setFailed(true);
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  const showControl = count >= 2 || open || busy || outcome !== null;
  if (!showControl) return null;

  return (
    <div className="grid min-w-0 gap-2">
      <span className="inline-flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <button
          ref={triggerRef}
          type="button"
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          aria-disabled={busy || count < 2 || undefined}
          className={DASHED_APPLY_CLASS}
          onClick={() => {
            if (busy || count < 2) return;
            setResult(null);
            setFailed(false);
            setOpen((o) => !o);
          }}
        >
          {count >= 2 ? label : (pressedLabel ?? label)}
        </button>
        <span role="status" className="text-xs text-ink-2 empty:hidden">
          {busy ? "Adding…" : outcome}
        </span>
      </span>

      {open && (
        <div
          ref={panelRef}
          id={panelId}
          role="group"
          aria-labelledby={headingId}
          className="grid min-w-0 gap-2 rounded-[10px] border border-rule bg-raised px-3.5 py-3"
        >
          <h3 id={headingId} className="text-sm font-semibold text-ink">
            New players to add
          </h3>
          <p className="text-xs text-ink-2">
            None of these is in NeonBinder yet. Each becomes a player, linked on every card that
            prints the name.
          </p>
          <ul
            ref={listRef}
            // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scrolling list must be reachable by keyboard
            tabIndex={0}
            aria-label="Names to add"
            className="focus-outline grid max-h-44 gap-1 overflow-y-auto rounded-md border border-rule px-2.5 py-2 text-sm"
          >
            {names.map((entry) => (
              <li key={entry.name} className="flex min-w-0 flex-wrap items-baseline gap-x-2 wrap-anywhere">
                <span className="font-medium text-ink">{entry.name}</span>
                <span className="text-xs text-ink-3">{cardNumbersText(entry)}</span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-2" aria-busy={busy || undefined}>
            <NeonButton
              type="button"
              size="1"
              aria-label={`Add ${plural(count, "player", "players")}`}
              aria-disabled={busy || undefined}
              onClick={() => void confirm()}
            >
              {`Add ${plural(count, "player", "players")}`}
            </NeonButton>
            <NeonButton
              type="button"
              size="1"
              variant="negative"
              outline
              aria-label="Cancel adding new players"
              aria-disabled={busy || undefined}
              onClick={() => {
                if (!busy) close();
              }}
            >
              Cancel
            </NeonButton>
            <span role="alert" className="text-xs text-neon-pink-text empty:hidden">
              {failed ? "Didn't add the players, try again." : null}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
