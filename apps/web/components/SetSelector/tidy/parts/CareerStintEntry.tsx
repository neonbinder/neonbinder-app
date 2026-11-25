import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { stintCountsForYear } from "../../../../convex/lib/careerCoverage";
import { useAnswered } from "../answered";
import { useBeforeSave } from "../before-save";
import type { TidyCardContext, TidyRow } from "../tile-types";
import { useWalkMemory } from "../walk-memory";
import AddStintEntry, { type StintPrefill } from "./AddStintEntry";
import type { TidyWrite } from "./tidy-write";

type Ctx = NonNullable<TidyCardContext>;

/**
 * NEO-657 (Jason, 2026-11-23: "When adding a new player IF we know the team on
 * the card we should automatically create a new stint for the player for the
 * year of the card. It should be open and editable so that if that is not the
 * right years the admin can fix it."): for a player made on this card in this
 * sitting (the walk's memory), when the card carries exactly one NB team (the
 * tidy context's own `onCard`, never a name) and the set has a year, "+ Add
 * stint" is open already holding that team and the year as both From and To,
 * unless the career has a stint for that team that counts for the year
 * (`stintCountsForYear`, the career-gap rule). It needs one team on the card,
 * not one player: every player made on the card gets it, a career gap or not.
 * Nothing is stored.
 */
export function stintPrefillFor(
  row: TidyRow,
  context: Ctx,
  playerId: string,
  setYear: number | undefined,
  madeOnCard: boolean,
): StintPrefill | undefined {
  const player = context.players.find((p) => p.playerId === playerId);
  const cardTeams = context.teams.filter((t) => t.onCard);
  const cardTeam = cardTeams.length === 1 ? cardTeams[0] : undefined;
  if (!madeOnCard || !player || !cardTeam || setYear === undefined) return undefined;
  if (player.stints.some((s) => s.teamId === cardTeam.teamId && stintCountsForYear(s, setYear))) return undefined;
  return { teamId: cardTeam.teamId, name: cardTeam.name, fromYear: setYear, toYear: setYear };
}

/**
 * "+ Add stint" under a player's career row, with the NEO-657 prefill when it
 * applies. "+ Add" writes the stint as shown; Esc closes the form and writes
 * nothing; Save & next with the prefilled form still open adds what it shows
 * (`useBeforeSave`) and tells the walk which player it wrote, so the walk's own
 * default stint for that player's career gap is not written on top of it.
 */
export default function CareerStintEntry({
  row,
  context,
  playerId,
  setYear,
  leafId,
  write,
}: {
  row: TidyRow;
  context: Ctx;
  playerId: string;
  setYear: number | undefined;
  leafId: Id<"selectorOptions">;
  write: TidyWrite;
}) {
  const addStint = useMutation(api.players.addStint);
  const answered = useAnswered();
  const memory = useWalkMemory();
  // What the open prefilled form would add right now (null when it is closed,
  // or holds nothing addable). Save & next adds it as shown.
  const [draft, setDraft] = useState<{ teamId: Id<"teams">; fromYear: number; toYear?: number } | null>(null);
  const player = context.players.find((p) => p.playerId === playerId);

  const writeStint = (stint: { teamId: Id<"teams">; fromYear: number; toYear?: number }): Promise<boolean> =>
    write.run(
      () =>
        addStint({
          playerId: playerId as Id<"players">,
          teamId: stint.teamId,
          fromYear: stint.fromYear,
          ...(stint.toYear !== undefined ? { toYear: stint.toYear } : {}),
        }),
      "Couldn't add that stint. Try again.",
    );

  useBeforeSave(draft !== null, async (wrote) => {
    if (!draft || !player) return true;
    const ok = await writeStint(draft);
    if (ok) wrote(player.playerId);
    return ok;
  });
  if (!player) return null;

  const prefill = stintPrefillFor(row, context, playerId, setYear, memory.madeOnCard(row._id, playerId));

  return (
    <AddStintEntry
      prefill={prefill}
      onDraft={setDraft}
      playerName={player.name}
      sportId={player.sportId}
      leafId={leafId}
      disabled={write.busy}
      onAdd={async (entry) => {
        const ok = await writeStint({
          teamId: entry.teamId,
          fromYear: entry.fromYear,
          ...(entry.toYear !== undefined ? { toYear: entry.toYear } : {}),
        });
        if (ok) answered();
        return ok;
      }}
    />
  );
}
