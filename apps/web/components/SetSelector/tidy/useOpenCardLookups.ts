import { useEffect, useRef } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { TidyCardContext } from "./tile-types";

/** The context names whose row exists, is unanswered and was never looked up. */
export function namesToAskAbout(context: NonNullable<TidyCardContext>) {
  return context.names.filter(
    (n) => n.row !== null && !n.row.answer && n.row.status === "ready" && !n.row.enrichment,
  );
}

/**
 * NEO-645 — opening a card asks Wikidata about the names that were never asked.
 *
 * A card the legacy-name migration (M2) wrote has name rows born `ready` with no
 * enrichment, so nothing would ever look them up. The server decides whether a
 * name is really unasked (`tidyNames.neverLooked`: no generation, no request
 * time) and does nothing for one whose lookup already ran, so this only offers
 * every ready, unanswered, enrichment-less name once per sitting.
 */
export function useOpenCardLookups(context: TidyCardContext | undefined) {
  const requestLookup = useMutation(api.tidyNames.requestLookup);
  const requestTeamLookup = useMutation(api.tidyNames.requestTeamLookup);
  const offered = useRef(new Set<string>());

  useEffect(() => {
    if (!context) return;
    for (const n of namesToAskAbout(context)) {
      const key = `${context.cardId}|${n.kind}|${n.nameNormalized}`;
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
