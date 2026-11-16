import { useId, useRef, useState, type KeyboardEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Autocomplete, focusWithoutOpening } from "../primitives/Autocomplete";
import { userFacingMessage } from "@/lib/errors/user-facing-message";

/**
 * NEO-569 — the set's League, as a list of NB `leagues` rows.
 *
 * A set's league used to be one free-text `features.league` string chosen
 * from a fixed list ("MLB", "NBA", …). It is now `selectorOptions.leagueIds`:
 * every league of the row's sport the set's teams play in (a minor-league set
 * spans several, a Japanese set NPB and its farm leagues). The team pickers
 * rank by any of them, and a card with no team takes the set's league when
 * the set has exactly one.
 *
 * Where it is edited: the set and every set-side row below it (variant type,
 * insert, parallel). Nothing is copied down. A row below the set with no list
 * of its own uses the nearest one above it (`getSelectorOptionLeagues`'s
 * `inheritedFrom`), shown here in a dashed chip, with the chip list named
 * "Leagues from above", so the difference never rests on colour (SC 1.4.1). Changing an inherited list
 * (adding one, or taking one away when there are two or more) gives the row
 * its own list, and says so: the inherited chip's × ("Remove NPB from this
 * insert") and the toast after it ("… has its own leagues now"). No hint
 * line explains any of this (Jason: "too much text on the screen"); the
 * only line is the one for a sport with no leagues to pick. "Use the set's leagues" ("Use the leagues above" when the list
 * comes from a nearer row) drops it again, and so does any change that
 * leaves the row's list the same as the one above: a copy of the list above
 * is never stored, so it never goes stale when the set's list changes. An
 * empty list is never stored either: saving `[]` deletes the key, which is
 * how the row goes back.
 *
 * The list above is read from the parent row (its effective leagues, and
 * where they come from), so a row with its own list still knows it.
 *
 * Every change saves at once, through the panel's own toast ("Saving
 * League…", then "Saved League", "Cleared League" or "Back to the set's
 * leagues"), the same polite region every other row of the panel uses.
 *
 * Keyboard: the add field is the shared type-ahead (`Autocomplete`, picker
 * mode, as every one-of-N over a growing table is): focus opens the sport's
 * leagues, under "Major leagues" then "More leagues" (ARIA groups); typing narrows by name or abbreviation; Enter adds
 * the highlighted one and leaves the caret in the field for the next; Escape
 * closes the list. Each chip's × takes Delete and Backspace as well as Enter,
 * Space and a click, and after a removal focus moves to the chip that took
 * its place, else the one before, else the add field (quietly, so the list
 * does not open over the panel on its own).
 */

/** What the leagues queries return for one league. */
export type LeagueSummary = {
  _id: Id<"leagues">;
  name: string;
  abbreviation?: string;
  level?: string;
};

/**
 * The most leagues one row holds. Keep in step with `MAX_SET_LEAGUES` in
 * `convex/leagues.ts`, which refuses more: a component cannot import from that
 * module (it is a server graph), so the number is copied here.
 */
export const MAX_SET_LEAGUES = 12;

/**
 * The row's words that the E2E suite and the a11y audit read. Module scope so
 * there is one place to read them from. None shares a substring with the card
 * drawer's "Card league" combobox, which can be on screen at the same time.
 */
export const SET_LEAGUE_LABELS = {
  /** The group's visible label and accessible name. */
  group: "League",
  /** The type-ahead's accessible name. */
  add: "Add league",
  /** The way back to the inherited list, when the set holds it. */
  useInherited: "Use the set's leagues",
  /** The way back, when a nearer row (a variant type, an insert) holds it. */
  useAbove: "Use the leagues above",
} as const;

/** The add list's group heading for a league: major ones first. */
export function leagueGroup(league: LeagueSummary): string {
  return league.level === "major" ? "Major leagues" : "More leagues";
}

/** Same leagues, in any order. */
function sameLeagues(a: ReadonlyArray<LeagueSummary>, b: ReadonlyArray<LeagueSummary>): boolean {
  if (a.length !== b.length) return false;
  const ids = new Set<string>(a.map((l) => l._id));
  return b.every((l) => ids.has(l._id));
}

/** The short form a chip shows: the abbreviation when there is one. */
export function leagueChipText(league: LeagueSummary): string {
  return league.abbreviation?.trim() || league.name;
}

/**
 * The sport's leagues the add field offers: every one not already in the
 * list, in the server's order (major first, then by name), narrowed by what
 * was typed against the name and the abbreviation.
 */
export function addableLeagues(
  sportLeagues: ReadonlyArray<LeagueSummary>,
  shown: ReadonlyArray<LeagueSummary>,
  query: string,
): LeagueSummary[] {
  const taken = new Set<string>(shown.map((l) => l._id));
  const typed = query.trim().toLowerCase();
  return sportLeagues.filter((league) => {
    if (taken.has(league._id)) return false;
    if (!typed) return true;
    return (
      league.name.toLowerCase().includes(typed) ||
      (league.abbreviation?.toLowerCase().includes(typed) ?? false)
    );
  });
}

/** Data attribute on each chip's ×, so focus can be moved in code without an id. */
const REMOVE_ATTR = "data-set-league-remove";

export default function SetLeagueRow({
  selectorOptionId,
  levelLabel,
  isSet,
  ancestors,
  onSaving,
  onSaved,
  onFailed,
}: {
  selectorOptionId: Id<"selectorOptions">;
  /** "Set", "Variant", "Insert" or "Parallel": the panel's own word for the row. */
  levelLabel: string;
  /** The row is the set itself, so there is nothing above it to inherit. */
  isSet: boolean;
  /**
   * The row's ancestor chain, root first and ending at the row itself
   * (`getAncestorChain`): the parent whose list this row would use, and the
   * name and level of the row that list comes from.
   */
  ancestors: ReadonlyArray<{ _id: Id<"selectorOptions">; value: string; level?: string }>;
  onSaving: (label: string) => void;
  onSaved: (message: string) => void;
  onFailed: (message: string) => void;
}) {
  const data = useQuery(api.selectorOptions.getSelectorOptionLeagues, {
    selectorOptionId,
  });
  // The list this row would use with none of its own: the parent's.
  const selfIndex = ancestors.findIndex((a) => a._id === selectorOptionId);
  const parentId = !isSet && selfIndex > 0 ? ancestors[selfIndex - 1]._id : undefined;
  const aboveData = useQuery(
    api.selectorOptions.getSelectorOptionLeagues,
    parentId ? { selectorOptionId: parentId } : "skip",
  );
  const setSelectorOptionLeagues = useMutation(
    api.selectorOptions.setSelectorOptionLeagues,
  );
  const labelId = useId();
  const hintId = useId();
  const rowRef = useRef<HTMLDivElement | null>(null);
  const seqRef = useRef(0);
  const [query, setQuery] = useState("");
  /**
   * The row's own list while a save is in flight, so the chips move at once.
   * Cleared when the LATEST save settles; by then the subscription already
   * carries the new value (Convex updates queries before the promise).
   */
  const [pending, setPending] = useState<{ own: LeagueSummary[] | null } | null>(null);

  const noun = levelLabel.toLowerCase();

  if (data === undefined) {
    return (
      <div
        role="group"
        aria-labelledby={labelId}
        className="flex flex-col gap-1 p-2 rounded border text-xs border-rule-strong bg-raised-deep/30"
      >
        <span id={labelId} className="text-[10px] uppercase tracking-wide text-ink-3">
          {SET_LEAGUE_LABELS.group}
        </span>
        <p className="text-xs text-ink-3">Loading leagues…</p>
      </div>
    );
  }

  // The list above this row, once known: the parent's effective list, or,
  // while the row inherits, its own effective list (the same thing).
  const above: LeagueSummary[] | undefined = isSet
    ? undefined
    : (aboveData?.effective ?? (data.own === null ? data.effective : undefined));
  const sourceId = aboveData
    ? aboveData.own !== null
      ? parentId
      : aboveData.inheritedFrom
    : data.inheritedFrom;
  const source = sourceId ? ancestors.find((a) => a._id === sourceId) : undefined;
  const fromSet = !source || source.level === "setName";
  const sourcePhrase = fromSet ? "the set's leagues" : `the leagues from ${source.value}`;

  const own: LeagueSummary[] | null = pending ? pending.own : data.own;
  const inheriting = own === null;
  const shown: LeagueSummary[] = own ?? (pending ? (above ?? []) : data.effective);
  const atCap = shown.length >= MAX_SET_LEAGUES;
  // Major ones first, each group one run under its heading (a stable sort
  // keeps the server's A–Z inside each).
  const options = atCap
    ? []
    : [...addableLeagues(data.sportLeagues, shown, query)].sort(
        (x, y) => Number(leagueGroup(x) !== "Major leagues") - Number(leagueGroup(y) !== "Major leagues"),
      );
  // A lone inherited league has no ×: taking it away would leave an empty
  // list, and an empty list is how a row says "use the one above", so the
  // press would change nothing.
  const canRemove = !inheriting || shown.length > 1;

  const save = async (next: LeagueSummary[]) => {
    // Below the set, an empty list or a copy of the list above is no list of
    // its own: it saves as inheriting, so it follows the list above from now on.
    const inherit =
      !isSet &&
      (next.length === 0 || (above !== undefined && above.length > 0 && sameLeagues(next, above)));
    const message = inherit
      ? above && above.length > 0
        ? `Back to ${sourcePhrase}`
        : "Cleared League"
      : next.length === 0
        ? "Cleared League"
        : inheriting && !isSet
          ? `Saved League. This ${noun} has its own leagues now.`
          : "Saved League";
    const seq = ++seqRef.current;
    setPending({ own: inherit ? null : next });
    onSaving(SET_LEAGUE_LABELS.group);
    try {
      await setSelectorOptionLeagues({
        selectorOptionId,
        leagueIds: inherit ? [] : next.map((l) => l._id),
      });
      if (seq !== seqRef.current) return;
      onSaved(message);
    } catch (e) {
      if (seq !== seqRef.current) return;
      onFailed(userFacingMessage(e, "Could not save League"));
    } finally {
      // Only the latest save hands the chips back to the server's answer; an
      // earlier one settling first must not flash the list it replaced.
      if (seq === seqRef.current) setPending(null);
    }
  };

  const add = (league: LeagueSummary) => {
    setQuery("");
    if (atCap || shown.some((l) => l._id === league._id)) return;
    void save([...shown, league]);
  };

  const remove = (index: number) => {
    if (!canRemove) return;
    const next = shown.filter((_, i) => i !== index);
    void save(next);
    // After the chips re-render: the chip that slid into this place, else the
    // one before it, else the add field.
    setTimeout(() => {
      const row = rowRef.current;
      if (!row) return;
      const buttons = row.querySelectorAll<HTMLElement>(`[${REMOVE_ATTR}]`);
      const target = buttons[index] ?? buttons[index - 1];
      if (target) {
        target.focus();
        return;
      }
      focusWithoutOpening(row.querySelector<HTMLElement>('[role="combobox"]'));
    }, 0);
  };

  const removeLabel = (league: LeagueSummary) =>
    inheriting ? `Remove ${league.name} from this ${noun}` : `Remove ${league.name}`;

  const onChipKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      remove(index);
    }
  };

  const returnToInherited = () => {
    void save([]);
    setTimeout(() => {
      focusWithoutOpening(
        rowRef.current?.querySelector<HTMLElement>('[role="combobox"]'),
      );
    }, 0);
  };

  // NEO-569 (Jason: "too much text on the screen"): a line only when
  // something is off. The rest shows itself: dashed chips are inherited (and
  // their list is named "Leagues from above"), a row's own list has the way
  // back beside it, and the toasts say what each change did.
  const hint =
    data.sportLeagues.length === 0
      ? "This sport has no leagues yet. Add them in Admin → Leagues first."
      : null;

  const emptyMessage = atCap
    ? `That's the limit: ${MAX_SET_LEAGUES} leagues.`
    : query.trim()
      ? "No league by that name in this sport"
      : "Every league in this sport is already here";

  return (
    <div
      ref={rowRef}
      role="group"
      aria-labelledby={labelId}
      aria-describedby={hint ? hintId : undefined}
      className="flex flex-col gap-1.5 p-2 rounded border text-xs border-rule-strong bg-raised-deep/30"
    >
      <span id={labelId} className="text-[10px] uppercase tracking-wide text-ink-3">
        {SET_LEAGUE_LABELS.group}
      </span>
      {shown.length > 0 && (
        <ul
          aria-label={inheriting ? "Leagues from above" : "This row's leagues"}
          className="flex flex-wrap items-center gap-1.5"
        >
          {shown.map((league, index) => (
            <li
              key={league._id}
              // Own chips are solid; inherited ones are an outline with a
              // dashed edge, in ink-3 (a 1px dash in --control read faint in
              // dark; ink-3 clears 3:1 with room in both modes). Shape as
              // well as fill, and the hint says it in words.
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border ${
                inheriting
                  ? "border-dashed border-ink-3 text-ink-2"
                  : "border-transparent bg-chip text-ink"
              }`}
            >
              {/* The chip reads its abbreviation; the full name is its title
                  for the pointer and its text for a screen reader. */}
              <span aria-hidden="true" title={league.name} className="font-semibold">
                {leagueChipText(league)}
              </span>
              <span className="sr-only">{league.name}</span>
              {canRemove && (
                <button
                  type="button"
                  data-set-league-remove=""
                  onClick={() => remove(index)}
                  onKeyDown={(e) => onChipKeyDown(e, index)}
                  // From an inherited list it changes this row only: said here.
                  aria-label={removeLabel(league)}
                  title={removeLabel(league)}
                  // The TeamPicker chip's ×: quiet ink-2 on the chip's grey,
                  // a pink fill with black ink under the pointer or focus
                  // (pink text on the chip misses 4.5:1 in dark).
                  className="hit-area-24 -mx-1 rounded-full px-1 text-ink-2 hover:bg-neon-pink hover:text-on-neon-pink focus:bg-neon-pink focus:text-on-neon-pink focus-outline"
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="relative max-w-xs">
        <Autocomplete<LeagueSummary>
          label={SET_LEAGUE_LABELS.add}
          query={query}
          onQueryChange={setQuery}
          items={options}
          getKey={(l) => l._id}
          getLabel={(l) => l.name}
          getDescription={(l) => l.abbreviation?.trim() || undefined}
          getGroup={leagueGroup}
          onSelect={add}
          onDismiss={() => setQuery("")}
          openOnEmpty
          placeholder="Add a league"
          emptyMessage={emptyMessage}
          describedBy={hint ? hintId : undefined}
          listMaxHeightClassName="max-h-48"
          inputGeometryClassName="py-1 pl-1.5 pr-7 text-xs"
        />
        {/* The one cue that the field opens a list. The combobox role says
            it to assistive tech. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-ink-3"
        >
          ▾
        </span>
      </div>
      {!isSet && !inheriting && (
        <div>
          <button
            type="button"
            onClick={returnToInherited}
            className="hit-area-24 text-[11px] text-ink-2 underline decoration-dotted underline-offset-2 hover:text-neon-blue-text focus:text-neon-blue-text focus-outline"
          >
            {fromSet ? SET_LEAGUE_LABELS.useInherited : SET_LEAGUE_LABELS.useAbove}
          </button>
        </div>
      )}
      {hint && (
        <p id={hintId} className="text-xs text-ink-3">
          {hint}
        </p>
      )}
    </div>
  );
}
