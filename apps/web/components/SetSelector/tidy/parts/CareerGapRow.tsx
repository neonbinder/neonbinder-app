import { useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { defaultGapStint } from "../../../../convex/lib/careerGapStint";
import NeonButton from "../../../modules/NeonButton";
import { useAnswered } from "../answered";
import type { TidyCardContext } from "../tile-types";
import AddStintEntry from "./AddStintEntry";
import { NO_CAREER_TEXT, careerLineText, noStintText } from "./copy";
import type { TidyWrite } from "./tidy-write";

type Ctx = NonNullable<TidyCardContext>;

/**
 * NEO-645 — a player already in NeonBinder whose career has no stint for the
 * team this card shows (`careerGap`, blue). Never a stop: the card's team is
 * not wrong, the career may just be short.
 *
 * The default is main's: "Add to career". Save & next with the gap still open
 * adds the stint from the set's year (`tidyCards.saveCard`, the same stint "Add
 * to career" writes: `defaultGapStint`). "Add to career" writes it to the
 * PLAYER now (`players.addStint`). Nothing records that the gap was seen
 * (NEO-656): it is blue for as long as the data holds it. A wrong team is
 * Change on the Team tile, never here.
 */
export default function CareerGapRow({
  context,
  playerId,
  teamId,
  setYear,
  leafId,
  multi,
  write,
}: {
  context: Ctx;
  playerId: string;
  teamId: string;
  setYear: number | undefined;
  leafId: Id<"selectorOptions">;
  multi: boolean;
  write: TidyWrite;
}) {
  const addStint = useMutation(api.players.addStint);
  const answered = useAnswered();
  const player = context.players.find((p) => p.playerId === playerId);
  const team = context.teams.find((t) => t.teamId === teamId);
  if (!player) return null;

  const noCareer = player.stints.length === 0 && !player.stintsMore;
  const suffix = multi ? ` for ${player.name}` : "";
  const disabled = write.busy ? true : undefined;

  const add = async (stint: { teamId: Id<"teams">; fromYear: number; toYear?: number }): Promise<boolean> => {
    const ok = await write.run(
      () =>
        addStint({
          playerId: player.playerId,
          teamId: stint.teamId,
          fromYear: stint.fromYear,
          ...(stint.toYear !== undefined ? { toYear: stint.toYear } : {}),
        }),
      "Couldn't add that stint. Try again.",
    );
    if (ok) answered();
    return ok;
  };
  return (
    <div role="group" aria-label={`Career ${player.name}`} className="grid gap-1.5">
      <p className="text-sm text-ink wrap-anywhere">
        <span className="font-medium">{player.name}</span>{" "}
        <span>{noCareer ? NO_CAREER_TEXT : noStintText(team?.name, setYear)}</span>
      </p>
      {player.stints.length > 0 && (
        <ul aria-label={`Career on file for ${player.name}`} className="flex flex-wrap gap-1.5">
          {player.stints.map((s, i) => (
            <li
              key={`${s.teamId}:${s.fromYear ?? ""}:${i}`}
              className="rounded-full border border-control bg-raised px-2 py-0.5 text-xs text-ink-2 wrap-anywhere"
            >
              {careerLineText(s.teamName, s.fromYear, s.toYear)}
            </li>
          ))}
          {player.stintsMore && <li className="text-xs text-ink-3">and more</li>}
        </ul>
      )}
      {setYear !== undefined && (
        <p className="text-xs text-ink-2">Save &amp; next adds it to the career.</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {setYear !== undefined && (
          <NeonButton
            size="1"
            aria-label={`Add to career${suffix}`}
            aria-disabled={disabled}
            onClick={() => void add({ teamId: teamId as Id<"teams">, ...defaultGapStint(setYear) })}
          >
            Add to career
          </NeonButton>
        )}
        <AddStintEntry
          playerName={player.name}
          sportId={player.sportId}
          leafId={leafId}
          disabled={write.busy}
          onAdd={(entry) =>
            add({
              teamId: entry.teamId,
              fromYear: entry.fromYear,
              ...(entry.toYear !== undefined ? { toYear: entry.toYear } : {}),
            })
          }
        />
      </div>
    </div>
  );
}
