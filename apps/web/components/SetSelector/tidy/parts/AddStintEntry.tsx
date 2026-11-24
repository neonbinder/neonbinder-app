import { useCallback, useEffect, useRef, useState } from "react";
import type { Id } from "../../../../convex/_generated/dataModel";
import NeonButton from "../../../modules/NeonButton";
import CareerTeamEntry, { type CareerTeamAdded } from "../../CareerTeamEntry";
import { useInlinePart } from "../inline-stack";

/**
 * NEO-645 — "+ Add stint": the career entry form (team search, years), opened
 * inline under a player's career row. Only a team NeonBinder holds can be
 * added (`knownTeamsOnly`); a team it lacks is made first, in the row's New
 * team form. `onAdd` writes the stint to the player (`players.addStint`) and
 * resolves true when it went through, which closes the form.
 *
 * NEO-657 — `prefill` opens the form already holding a stint (a team NB holds,
 * and its years). It is the same form and the same `onAdd`: the operator
 * changes what is wrong, then "+ Add" (or Enter on a year) writes it, and
 * closing it (Esc) writes nothing. While it is that open prefilled form,
 * `onDraft` hears what + Add would add, so the walk's Save & next can add it as
 * shown. Closing it, or reopening with "+ Add stint", is a plain empty form
 * with no `onDraft`.
 */
export type StintPrefill = {
  teamId: Id<"teams">;
  /** The team's full name, as the form shows it. */
  name: string;
  fromYear: number;
  toYear?: number;
};

export default function AddStintEntry({
  playerName,
  sportId,
  leafId,
  disabled,
  onAdd,
  prefill,
  onDraft,
}: {
  playerName: string;
  sportId: Id<"selectorOptions">;
  leafId: Id<"selectorOptions">;
  disabled: boolean;
  onAdd: (entry: CareerTeamAdded & { teamId: Id<"teams"> }) => Promise<boolean>;
  prefill?: StintPrefill;
  onDraft?: (draft: (CareerTeamAdded & { teamId: Id<"teams"> }) | null) => void;
}) {
  const [open, setOpen] = useState(prefill !== undefined);
  /** The form is the one opened with the prefill and nothing has closed it. */
  const [prefilled, setPrefilled] = useState(prefill !== undefined);
  // One instance for the row's life: the form follows the prefill prop rather
  // than being remounted, so close() finds its button to return focus to. A
  // prefill that arrives later (the card's Team answered after the player was
  // made) opens it; one that goes away (the stint is written) closes it.
  const hasPrefill = prefill !== undefined;
  const [sawPrefill, setSawPrefill] = useState(hasPrefill);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const scopeRef = useRef<HTMLDivElement | null>(null);
  // The form's element, as state, so a render can ask where focus is while the
  // form is still mounted (a ref is not readable during render).
  const [scopeEl, setScopeEl] = useState<HTMLDivElement | null>(null);
  const attachScope = useCallback((el: HTMLDivElement | null) => {
    scopeRef.current = el;
    setScopeEl(el);
  }, []);
  // The prefill going away closes the form from outside, so close() never
  // runs. If focus was inside the form (still mounted during this render), it
  // would drop to <body>; count a ticket here and restore it to "+ Add stint"
  // after the commit.
  const [focusTicket, setFocusTicket] = useState(0);
  if (hasPrefill !== sawPrefill) {
    setSawPrefill(hasPrefill);
    setOpen(hasPrefill);
    setPrefilled(hasPrefill);
    if (!hasPrefill && scopeEl?.contains(document.activeElement)) {
      setFocusTicket(focusTicket + 1);
    }
  }
  useEffect(() => {
    if (focusTicket === 0) return;
    requestAnimationFrame(() => buttonRef.current?.focus({ preventScroll: true }));
  }, [focusTicket]);
  const close = () => {
    setOpen(false);
    setPrefilled(false);
    requestAnimationFrame(() => buttonRef.current?.focus({ preventScroll: true }));
  };
  useInlinePart(open, close, scopeRef);

  if (open) {
    const asPrefilled = prefilled && prefill !== undefined;
    return (
      <div
        ref={attachScope}
        {...(asPrefilled
          ? { role: "group", "aria-label": `New stint for ${playerName}, prefilled from the card` }
          : {})}
      >
        <CareerTeamEntry
          sportId={sportId}
          contextOptionId={leafId}
          stagedNames={[]}
          knownTeamsOnly
          label={playerName}
          disabled={disabled}
          onDone={close}
          {...(asPrefilled
            ? {
                load: {
                  token: 1,
                  name: prefill.name,
                  teamId: prefill.teamId,
                  fromYear: prefill.fromYear,
                  ...(prefill.toYear !== undefined ? { toYear: prefill.toYear } : {}),
                },
                onDraftChange: (draft: CareerTeamAdded | null) =>
                  onDraft?.(draft?.teamId ? { ...draft, teamId: draft.teamId } : null),
              }
            : {})}
          onAdd={async (entry) => {
            if (!entry.teamId) return;
            const ok = await onAdd({ ...entry, teamId: entry.teamId });
            if (ok) close();
          }}
        />
      </div>
    );
  }
  return (
    <NeonButton
      ref={buttonRef}
      size="1"
      variant="secondary"
      outline
      aria-label={`+ Add stint for ${playerName}`}
      aria-disabled={disabled ? true : undefined}
      onClick={() => setOpen(true)}
    >
      + Add stint
    </NeonButton>
  );
}
