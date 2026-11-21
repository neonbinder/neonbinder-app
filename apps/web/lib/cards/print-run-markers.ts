/**
 * NEO-591 — the hobby markers a checklist parser drops from a name ("SP",
 * "SSP", "RC", ...), kept in ONE place so the parser and the pairing key
 * cannot drift apart.
 *
 * A published checklist prints "Old Teammates SP"; the parser drops the "SP"
 * (it is a print run, not part of the name). A marketplace keeps it as the
 * card's name. Pairing compares names, so it drops the same trailing markers
 * from BOTH sides' key. Stored names are never changed.
 *
 * Pure leaf module: imported by `lib/checklists/parse-published-checklist.ts`
 * (a regex source) and `lib/cards/pair-names-first.ts` (a name key).
 */

/**
 * The marker words as a regex alternation: capitals as checklists print them
 * ("Marcus Arcos" and "Spencer" never match), except "1st" and "Exchange",
 * which are also printed in other cases.
 */
export const HOBBY_MARKER_PATTERN =
  "RC|SP|SSP|VAR|HOF|AU|1[sS][tT]|EXCH|EXCHANGE|Exchange|UER|FBC";

const TRAILING_MARKER = new RegExp(
  `(?:^|[\\s,;/])(?:${HOBBY_MARKER_PATTERN}|#?/\\d+)$`,
);

/**
 * `name` without trailing hobby markers and print runs ("Old Teammates SP" →
 * "Old Teammates", "Mike Trout SP /99" → "Mike Trout"). A name that is only a
 * marker is kept as it is. For comparison only: nothing is written from it.
 */
export function dropTrailingMarkers(name: string): string {
  let out = name.trim();
  for (let i = 0; i < 6; i++) {
    const m = TRAILING_MARKER.exec(out);
    if (!m) break;
    const next = out.slice(0, m.index).replace(/[\s,;/]+$/, "");
    if (next === "") break;
    out = next;
  }
  return out;
}
