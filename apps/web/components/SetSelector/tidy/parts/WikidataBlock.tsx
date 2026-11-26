import { useId } from "react";
import { Checkbox } from "../../../primitives/Checkbox";
import { wikidataUrl, wikipediaUrl } from "../../../../lib/players/wikidata-id";

/**
 * NEO-645 — what Wikidata said about a NEW player: the one line that most
 * often settles "is this the right man?", and the two source links.
 *
 * Only ever rendered for a name that is about to become a new player. A player
 * that is already linked is never sent to Wikidata (design callout 3), and a
 * same-name pick step shows no lookup at all (NEO-332): a description of one
 * person beside a list of two reads as a verdict on which of ours it is.
 *
 * `wikidataId` arrives from query.wikidata.org, so it is external input on its
 * way into an `href`; `wikidataUrl` returns null unless it really is a
 * `Q<digits>` id, and the value is then shown as text only.
 */
export type WikidataCareerTeam = { name: string; fromYear: number; toYear?: number };

export type WikidataLike = {
  wikidataId?: string;
  careerTeams?: ReadonlyArray<WikidataCareerTeam>;
  enwikiTitle?: string;
  description?: string;
  birthYear?: number;
  isHallOfFame?: boolean;
};

/** Chronological, an open-ended tenure last within a shared start year (the old wizard's order). */
function byCareerOrder(a: WikidataCareerTeam, b: WikidataCareerTeam): number {
  if (a.fromYear !== b.fromYear) return a.fromYear - b.fromYear;
  const aOpen = a.toYear === undefined ? 1 : 0;
  const bOpen = b.toYear === undefined ? 1 : 0;
  if (aOpen !== bOpen) return aOpen - bOpen;
  return (a.toYear ?? 0) - (b.toYear ?? 0);
}

export const careerTeamLabel = (ct: WikidataCareerTeam): string =>
  `${ct.name} (${ct.fromYear}–${ct.toYear ?? "present"})`;

const LINK_CLASS =
  "py-1 text-neon-blue-text underline decoration-dotted hover:text-neon-green-text focus:text-neon-green-text focus-outline";

/**
 * `excludedCareerTeams` + `onToggleCareerTeam` (NEO-212 / NEO-645): the career
 * teams Wikidata proposed, each ticked unless the operator unticked it, so a
 * wrong one (a minor-league affiliate, a national side) can be left off the new
 * player before it is created. Names are the key, as the server compares them.
 */
export default function WikidataBlock({
  status,
  enrichment,
  excludedCareerTeams,
  onToggleCareerTeam,
  disabled = false,
  labelSuffix = "",
}: {
  status: "pending" | "ready" | "error";
  enrichment: WikidataLike | undefined;
  excludedCareerTeams?: ReadonlySet<string>;
  onToggleCareerTeam?: (name: string) => void;
  disabled?: boolean;
  /** " Jackson Merrill" on a card with more than one name, so no two boxes read alike. */
  labelSuffix?: string;
}) {
  const careerId = useId();
  if (status === "pending") {
    return (
      <p role="status" className="text-xs italic text-ink-3">
        Still looking up details. Add it now, or wait and they&apos;ll fill in.
      </p>
    );
  }
  if (status === "error" || !enrichment) {
    return <p className="text-xs italic text-ink-3">No Wikidata match found.</p>;
  }
  const facts = [
    enrichment.description,
    enrichment.birthYear ? `b. ${enrichment.birthYear}` : null,
  ].filter(Boolean);
  const hasLinks = Boolean(enrichment.wikidataId || enrichment.enwikiTitle);
  const career = onToggleCareerTeam ? [...(enrichment.careerTeams ?? [])].sort(byCareerOrder) : [];
  if (facts.length === 0 && !hasLinks && !enrichment.isHallOfFame && career.length === 0) {
    return <p className="text-xs italic text-ink-3">No Wikidata match found.</p>;
  }
  return (
    <div className="space-y-1">
      {facts.length > 0 && <p className="text-xs text-ink-2">Wikidata: {facts.join(", ")}</p>}
      {enrichment.isHallOfFame && (
        <p className="text-xs font-semibold text-neon-green-text">Hall of Fame</p>
      )}
      {career.length > 0 && (
        <div role="group" aria-labelledby={careerId} className="grid gap-0.5">
          <p id={careerId} className="text-xs text-ink-3">
            Career teams to add:
          </p>
          <ul className="grid gap-1">
            {career.map((ct) => {
              const label = careerTeamLabel(ct);
              return (
                <li key={`${ct.name}|${ct.fromYear}|${ct.toYear ?? ""}`}>
                  <Checkbox
                    className="text-xs text-ink-2 wrap-anywhere"
                    checked={!excludedCareerTeams?.has(ct.name)}
                    aria-disabled={disabled || undefined}
                    aria-label={`Include career team ${label}${labelSuffix}`}
                    onChange={() => {
                      if (disabled) return;
                      onToggleCareerTeam?.(ct.name);
                    }}
                  >
                    {label}
                  </Checkbox>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {hasLinks && (
        <p className="flex flex-wrap items-center gap-3 text-xs">
          {enrichment.wikidataId &&
            (wikidataUrl(enrichment.wikidataId) ? (
              <a
                href={wikidataUrl(enrichment.wikidataId)!}
                target="_blank"
                rel="noopener noreferrer"
                className={LINK_CLASS}
              >
                Wikidata {enrichment.wikidataId}
                <span className="sr-only"> (opens in new tab)</span>
              </a>
            ) : (
              <span className="text-ink-3">Wikidata {enrichment.wikidataId}</span>
            ))}
          {enrichment.enwikiTitle && (
            <a
              href={wikipediaUrl(enrichment.enwikiTitle)}
              target="_blank"
              rel="noopener noreferrer"
              className={LINK_CLASS}
            >
              Wikipedia
              <span className="sr-only"> (opens in new tab)</span>
            </a>
          )}
        </p>
      )}
    </div>
  );
}
