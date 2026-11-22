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
export type WikidataLike = {
  wikidataId?: string;
  enwikiTitle?: string;
  description?: string;
  birthYear?: number;
  isHallOfFame?: boolean;
};

const LINK_CLASS =
  "py-1 text-neon-blue-text underline decoration-dotted hover:text-neon-green-text focus:text-neon-green-text focus-outline";

export default function WikidataBlock({
  status,
  enrichment,
}: {
  status: "pending" | "ready" | "error";
  enrichment: WikidataLike | undefined;
}) {
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
  if (facts.length === 0 && !hasLinks && !enrichment.isHallOfFame) {
    return <p className="text-xs italic text-ink-3">No Wikidata match found.</p>;
  }
  return (
    <div className="space-y-1">
      {facts.length > 0 && <p className="text-xs text-ink-2">Wikidata: {facts.join(", ")}</p>}
      {enrichment.isHallOfFame && (
        <p className="text-xs font-semibold text-neon-green-text">Hall of Fame</p>
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
