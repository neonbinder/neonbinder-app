import { useRef, useState } from "react";
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
 */
export default function AddStintEntry({
  playerName,
  sportId,
  leafId,
  disabled,
  onAdd,
}: {
  playerName: string;
  sportId: Id<"selectorOptions">;
  leafId: Id<"selectorOptions">;
  disabled: boolean;
  onAdd: (entry: CareerTeamAdded & { teamId: Id<"teams"> }) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const close = () => {
    setOpen(false);
    requestAnimationFrame(() => buttonRef.current?.focus({ preventScroll: true }));
  };
  useInlinePart(open, close);

  if (open) {
    return (
      <CareerTeamEntry
        sportId={sportId}
        contextOptionId={leafId}
        stagedNames={[]}
        knownTeamsOnly
        label={playerName}
        disabled={disabled}
        onDone={close}
        onAdd={async (entry) => {
          if (!entry.teamId) return;
          const ok = await onAdd({ ...entry, teamId: entry.teamId });
          if (ok) close();
        }}
      />
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
