import { useEffect, useRef } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { TidyCardContext } from "./tile-types";

/**
 * The context names whose row exists and was never looked up. The server says
 * so (`row.neverLooked`): a lookup that finished and found nothing is also
 * `ready`, unanswered and bare, and asking again for it is a no-op round trip.
 */
export function namesToAskAbout(context: NonNullable<TidyCardContext>) {
  return context.names.filter((n) => n.row !== null && n.row.neverLooked);
}

/**
 * NEO-645 — opening a card asks Wikidata about the names that were never asked.
 *
 * A card the legacy-name migration (M2) wrote has name rows born `ready` with no
 * enrichment, so nothing would ever look them up. The server decides whether a
 * name is really unasked (`tidyNames.neverLooked`: no generation, no request
 * time), and this offers only those, once per sitting and answer. The server still refuses
 * to ask twice, so a stale context costs nothing.
 */
export function useOpenCardLookups(context: TidyCardContext | undefined) {
  const requestLookup = useMutation(api.tidyNames.requestLookup);
  const requestTeamLookup = useMutation(api.tidyNames.requestTeamLookup);
  const offered = useRef(new Set<string>());

  useEffect(() => {
    if (!context) return;
    for (const n of namesToAskAbout(context)) {
      // The answer's generation is part of the key: a name whose lookup output
      // expired (`tidyNames.sweepExpiredLookupOutput`) and is then changed back
      // is a new question, asked again in the same sitting.
      const key = `${context.cardId}|${n.kind}|${n.nameNormalized}|${n.row!.answerGen ?? 0}`;
      if (offered.current.has(key)) continue;
      offered.current.add(key);
      const ask =
        n.kind === "player"
          ? requestLookup({ cardId: context.cardId, kind: "player", name: n.printed })
          : requestTeamLookup({
              cardId: context.cardId,
              name: n.printed,
              sportId: n.row!.sportId,
            });
      // Assistive: a failed ask leaves the tile as it was.
      void Promise.resolve(ask).catch(() => {});
    }
  }, [context, requestLookup, requestTeamLookup]);
}
