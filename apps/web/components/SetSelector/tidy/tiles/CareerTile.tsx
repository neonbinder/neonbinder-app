import CareerGapRow from "../parts/CareerGapRow";
import CareerStintEntry, { stintPrefillFor } from "../parts/CareerStintEntry";
import { useTidyWrite } from "../parts/tidy-write";
import { useSetYear } from "../parts/use-set-year";
import TidyTile from "../TidyTile";
import type { TidyTileProps } from "../tile-types";
import { useWalkMemory } from "../walk-memory";

/**
 * NEO-645 — tile 4, Career (indented under Player).
 *
 * Blue, never pink: a missing stint is something to check, not something that
 * stops the card. NEO-656: it is read from the data and nothing else. It shows
 * while the card's one player has no stint covering the card's team by the
 * set's year (`careerCoverage.careerGaps`, handed in as a `careerGap` item), and
 * it is gone the moment a stint or a team covers it, wherever that is written.
 * Nothing records that anyone looked.
 *
 * NEO-657: a player made on this card in this sitting gets the card's team as a
 * prefilled "+ Add stint" (`CareerStintEntry`) whether or not they have a gap:
 * it needs one NB team on the card, not one player. The live gap is one-player
 * only, so a card with two made players shows the prefill here, at level
 * "check", for each one that has no gap item. Nothing is stored.
 *
 * Stints live on the PLAYER (`players.teamYears`), never on a card: "Add to
 * career" and "+ Add stint" write to the player through `players.addStint`. A
 * career gap's default is main's: Save & next with the gap still open adds the
 * stint from the set's year (`tidyCards.saveCard`). A wrong team on the card is
 * Change on the Team tile.
 */
export default function CareerTile({ row, context, attention, leafId }: TidyTileProps) {
  const write = useTidyWrite();
  const gaps = attention.items.flatMap((i) => (i.kind === "careerGap" ? [i] : []));
  const memory = useWalkMemory();
  const gapPlayers = new Set(gaps.map((g) => g.playerId));
  const madeNoGap = (row.playerIds ?? []).filter((p) => !gapPlayers.has(p) && memory.madeOnCard(row._id, p));
  const wanted = gaps.length > 0 || madeNoGap.length > 0;
  const setYear = useSetYear(leafId, wanted);

  if (!wanted || context === null) return null;
  if (context === undefined) {
    if (gaps.length === 0) return null;
    return <TidyTile heading="Career" level="waiting" waitingText="Looking at this card" />;
  }

  const multi = gaps.length > 1;

  const prefilled = madeNoGap.filter((p) => stintPrefillFor(row, context, p, setYear, true) !== undefined);
  if (gaps.length === 0 && prefilled.length === 0) return null;

  return (
    <TidyTile heading="Career" level="check">
      {write.error && (
        <p role="alert" className="text-xs text-neon-pink-text">
          {write.error}
        </p>
      )}
      {gaps.map((item) => (
        <CareerGapRow
          key={`gap:${item.playerId}:${item.teamId}`}
          row={row}
          context={context}
          playerId={item.playerId}
          teamId={item.teamId}
          setYear={setYear}
          leafId={leafId}
          multi={multi}
          write={write}
        />
      ))}
      {prefilled.map((id) => {
        const player = context.players.find((p) => p.playerId === id);
        if (!player) return null;
        return (
          <div key={`made:${id}`} role="group" aria-label={`Career ${player.name}`} className="grid gap-1.5">
            <p className="text-sm font-medium text-ink wrap-anywhere">{player.name}</p>
            <div className="flex flex-wrap items-center gap-2">
              <CareerStintEntry
                row={row}
                context={context}
                playerId={id}
                setYear={setYear}
                leafId={leafId}
                write={write}
              />
            </div>
          </div>
        );
      })}
    </TidyTile>
  );
}
