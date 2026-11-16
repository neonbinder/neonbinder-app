import { useId, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Autocomplete } from "../primitives/Autocomplete";
import type { LeagueSummary } from "./SetLeagueRow";

/**
 * NEO-569 — the card's own league, in the card drawer directly under Teams.
 *
 * `cardChecklist.leagueId` is settled by the server from the card's teams
 * (every team in one league → that league; no team in a one-league set → the
 * set's), and it is NB data an admin can overwrite here. A blank is never
 * guessed at: teams in different leagues, a team with no league, or no team
 * in a set with several leagues all leave it blank, and the helper line under
 * the field says which, so the admin knows what a pick is settling. eBay
 * holds a card back until it has one (`noLeague`), which the line says too.
 *
 * One of N over a table that only grows, so the shared type-ahead in picker
 * mode, never a native select or a pill row: focus opens the list with the
 * current answer checked, the set's leagues first, then the sport's others,
 * and "No league" as an explicit choice; typing narrows by name or
 * abbreviation; Enter picks; Escape closes and puts the answer back.
 *
 * The write goes through the drawer's own `commitField` (`onCommit`), so it
 * announces in the drawer's one status region like every other field.
 */

/** The combobox's accessible name. Distinct from the set row's "Add league". */
export const CARD_LEAGUE_LABEL = "Card league";

/** The explicit blank. Its key is never a league id. */
const NO_LEAGUE_KEY = "no-league";

type BlankReason =
  | "noTeam"
  | "teamsInDifferentLeagues"
  | "teamWithoutLeague"
  | null;

type Option =
  | { kind: "none"; key: string; label: string }
  | { kind: "league"; key: string; label: string; league: LeagueSummary; inSet: boolean };

/** Why the field is blank, in the admin's words. */
export function cardLeagueBlankCopy(reason: BlankReason): string {
  const tail = " Listings are held back until it has one.";
  switch (reason) {
    case "noTeam":
      return `No league yet: this card has no team to take one from, and the set has more than one league. Pick one.${tail}`;
    case "teamsInDifferentLeagues":
      return `No league yet: its teams play in different leagues. Pick the one this card counts for.${tail}`;
    case "teamWithoutLeague":
      return `No league yet: one of its teams has no league. Pick one here, or give the team its league in Admin → Teams.${tail}`;
    default:
      return `No league yet. Pick one.${tail}`;
  }
}

/**
 * The list, in order: the blank, the set's leagues, then the rest of the
 * sport's (no league twice). Typing narrows it by name or abbreviation, and
 * then the blank goes last, and only while its own label matches ("no"):
 * the highlight starts on the first row, so "NPB" then Enter must save NPB,
 * never clear the card, and text that names no league offers nothing to
 * press (the empty message says so) rather than a clear.
 */
export function cardLeagueOptions(
  setLeagues: ReadonlyArray<LeagueSummary>,
  sportLeagues: ReadonlyArray<LeagueSummary>,
  typed: string | null,
): Option[] {
  const seen = new Set<string>();
  const leagues: Option[] = [];
  for (const [list, inSet] of [
    [setLeagues, true],
    [sportLeagues, false],
  ] as const) {
    for (const league of list) {
      if (seen.has(league._id)) continue;
      seen.add(league._id);
      leagues.push({ kind: "league", key: league._id, label: league.name, league, inSet });
    }
  }
  const blank: Option = { kind: "none", key: NO_LEAGUE_KEY, label: "No league" };
  const query = typed?.trim().toLowerCase() ?? "";
  if (!query) return [blank, ...leagues];
  const matching = leagues.filter(
    (o) =>
      o.kind === "league" &&
      (o.league.name.toLowerCase().includes(query) ||
        (o.league.abbreviation?.toLowerCase().includes(query) ?? false)),
  );
  return blank.label.toLowerCase().includes(query) ? [...matching, blank] : matching;
}

export default function CardLeagueRow({
  cardId,
  onCommit,
}: {
  cardId: Id<"cardChecklist">;
  /** Writes `leagueId` (null clears it) and announces; rejects with a user-facing message. */
  onCommit: (leagueId: Id<"leagues"> | null) => Promise<void>;
}) {
  const data = useQuery(api.cardLeague.cardLeagueOptions, { cardId });
  const helpId = useId();
  const errorId = useId();
  /** What the operator typed since focusing; null shows the current answer. */
  const [typed, setTyped] = useState<string | null>(null);
  /** The pick being saved, so the field shows it for the round trip. */
  const [pending, setPending] = useState<Option | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (data === undefined) {
    return (
      <div>
        <span className="block text-[10px] uppercase tracking-wide text-ink-3 mb-1">
          League
        </span>
        <p className="text-xs text-ink-3">Loading leagues…</p>
      </div>
    );
  }

  const current = data.current as LeagueSummary | null;
  const options = cardLeagueOptions(data.setLeagues, data.sportLeagues, typed);
  const shownKey = pending ? pending.key : (current?._id ?? NO_LEAGUE_KEY);
  const shownLabel = pending
    ? pending.kind === "none"
      ? ""
      : pending.label
    : (current?.name ?? "");
  // The why-blank line describes the stored answer, so it waits out a save.
  const showHelp = !pending && current === null;

  const pick = async (option: Option) => {
    setTyped(null);
    if (pending || option.key === shownKey) return;
    setPending(option);
    try {
      await onCommit(option.kind === "none" ? null : option.league._id);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(null);
    }
  };

  const describedBy = [showHelp ? helpId : null, error ? errorId : null]
    .filter(Boolean)
    .join(" ") || undefined;

  return (
    <div>
      {/* The visible word; the field's own name is "Card league", which
          contains it (SC 2.5.3). */}
      <span
        aria-hidden="true"
        className="block text-[10px] uppercase tracking-wide text-ink-3 mb-1"
      >
        League
      </span>
      <div className="relative">
        <Autocomplete<Option>
          label={CARD_LEAGUE_LABEL}
          query={typed ?? shownLabel}
          onQueryChange={setTyped}
          items={options}
          getKey={(o) => o.key}
          getLabel={(o) => o.label}
          getDescription={(o) =>
            o.kind === "league"
              ? [o.league.abbreviation?.trim(), o.inSet ? "in this set" : null]
                  .filter(Boolean)
                  .join(", ") || undefined
              : undefined
          }
          onSelect={(o) => void pick(o)}
          onDismiss={() => setTyped(null)}
          selectedKey={shownKey}
          openOnEmpty
          selectOnFocus
          placeholder="No league"
          emptyMessage="No league by that name in this sport"
          describedBy={describedBy}
          invalid={error !== null}
          listMaxHeightClassName="max-h-48"
          inputGeometryClassName="py-1.5 pl-1.5 pr-7 text-sm"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-ink-3"
        >
          ▾
        </span>
      </div>
      {pending && <p className="mt-1 text-[10px] text-ink-3">Saving…</p>}
      {showHelp && (
        <p id={helpId} className="mt-1 text-[11px] text-ink-3">
          {cardLeagueBlankCopy(data.blankReason as BlankReason)}
        </p>
      )}
      {error && (
        // The one channel for a refusal: the drawer's commitField throws it
        // and announces only successes.
        <p id={errorId} role="alert" className="mt-1 text-xs text-notice-danger-ink">
          {error}
        </p>
      )}
    </div>
  );
}
