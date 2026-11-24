import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import CareerGapRow from "../parts/CareerGapRow";
import { useTidyWrite } from "../parts/tidy-write";
import TidyTile from "../TidyTile";
import type { TidyTileProps } from "../tile-types";

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
 * Stints live on the PLAYER (`players.teamYears`), never on a card: "Add to
 * career" and "+ Add stint" write to the player through `players.addStint`. A
 * career gap's default is main's: Save & next with the gap still open adds the
 * stint from the set's year (`tidyCards.saveCard`). A wrong team on the card is
 * Change on the Team tile.
 */
export default function CareerTile({ row, context, attention, leafId }: TidyTileProps) {
  const write = useTidyWrite();
  const gaps = attention.items.flatMap((i) => (i.kind === "careerGap" ? [i] : []));
  const wanted = gaps.length > 0;
  const chain = useQuery(api.selectorOptions.getAncestorChain, wanted ? { id: leafId } : "skip");

  if (!wanted || context === null) return null;
  if (context === undefined) {
    return <TidyTile heading="Career" level="waiting" waitingText="Looking at this card" />;
  }

  // The set's year, as the server reads it for the gap check: the year level's
  // value, leading digits.
  const yearValue = chain?.find((c) => c.level === "year")?.value;
  const parsed = yearValue ? Number.parseInt(yearValue, 10) : Number.NaN;
  const setYear = Number.isInteger(parsed) ? parsed : undefined;

  const multi = gaps.length > 1;

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
    </TidyTile>
  );
}
