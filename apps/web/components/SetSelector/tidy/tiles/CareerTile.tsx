import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import CareerGapRow from "../parts/CareerGapRow";
import NewPlayerCareerRow from "../parts/NewPlayerCareerRow";
import { useTidyWrite } from "../parts/tidy-write";
import TidyTile from "../TidyTile";
import type { TidyTileProps } from "../tile-types";

/**
 * NEO-645 — tile 4, Career (indented under Player).
 *
 * Blue, never pink: a missing stint is something to check, not something that
 * stops the card. It exists only while the card carries a `careerGap` (an
 * existing player has no stint for the card's team by the set's year) or a
 * `newPlayerCareer` (a player made on this card, and Wikidata's career to
 * review), and it is gone once those are answered or seen.
 *
 * Stints live on the PLAYER (`players.teamYears`), never on a card: "Add to
 * career" and the New team form's "Create team and add stint" write to the
 * player through `players.addStint`. A career gap's default is main's: Save &
 * next with the gap still open adds the stint from the set's year, then marks
 * it seen. "Keep as is" is the explicit way out and writes nothing to the
 * player (`tidyCards.keepCareerGap` stores it). A wrong team on the card is
 * Change on the Team tile.
 */
export default function CareerTile({ row, context, attention, leafId }: TidyTileProps) {
  const write = useTidyWrite();
  const gaps = attention.items.flatMap((i) => (i.kind === "careerGap" ? [i] : []));
  const fresh = attention.items.flatMap((i) => (i.kind === "newPlayerCareer" ? [i] : []));
  const wanted = gaps.length + fresh.length > 0;
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

  const multi = gaps.length + fresh.length > 1;

  return (
    <TidyTile
      heading="Career"
      level="check"
      aside={fresh.length > 0 ? "From Wikidata · new player only" : undefined}
    >
      {write.error && (
        <p role="alert" className="text-xs text-neon-pink-text">
          {write.error}
        </p>
      )}
      {fresh.map((item) => (
        <NewPlayerCareerRow
          key={`new:${item.playerId}`}
          row={row}
          context={context}
          playerId={item.playerId}
          leafId={leafId}
          setYear={setYear}
          write={write}
        />
      ))}
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
