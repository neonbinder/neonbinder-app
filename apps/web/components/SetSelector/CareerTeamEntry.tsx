import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
  normalizeEntityName,
  rankTeamCandidates,
} from "../../convex/lib/entityNearMatch";
import { teamFullName } from "../../lib/teams/team-name";
import { Input } from "../primitives/Input";
import { MIN_CAREER_YEAR, maxCareerYear } from "../../lib/players/career-years";
import {
  nameHasQueryPrefix,
  nameMatchesQuery,
  nameSearchKey,
} from "../../lib/entities/name-search";
import NeonButton from "@/components/modules/NeonButton";

/**
 * NEO-92 follow-up: manual career-team entry for a player row in the
 * EntityReviewWizard. When the wizard's background Wikidata lookup finds no
 * career-team history (e.g. "Daulton Varsho" in our testing) — or missed a
 * team it should have — the admin can add `{ team, fromYear, toYear? }`
 * entries by hand, in ADDITION to whatever Wikidata found.
 *
 * The team field is a free-text combobox: it typeaheads against candidate
 * teams, but UNLIKE EntityLinkSearch it deliberately accepts a name that
 * matches nothing. So there's no "+ Create" escape hatch here; typing IS
 * creating.
 *
 * ## NEO-236 — ONE box, and creating happens on its own step
 *
 * Jason, 2026-09-05: "we should also remove the Location box from New Players
 * as we should only be selecting existing teams or entering it in the singular
 * field which would trigger that new team dialog."
 *
 * An earlier pass put a Location field beside the name here. It asked the
 * operator to split a team while they were dating a stint, in a form with no
 * room for the League, and it asked it in a different place from every other
 * team creation in the product. The field is gone: this is a single team box
 * again, and a name that matches nothing STAGES a New Team step in the wizard
 * — Location, Name and League, answered where every other new team is answered.
 *
 * That is why typing still creates and there is still no "+ Create" row here:
 * what this component reports upward is a STINT, and the team it names is
 * either one we already hold or one the batch is about to ask about.
 *
 * This component owns only its own mini-form state and emits each completed
 * entry via `onAdd`. The staged list of added entries (and its per-row reset)
 * lives in EntityReviewWizard — see there.
 *
 * ## NEO-212 — the two ways this field used to mint a duplicate team
 *
 * 1. **It could not see the batch.** Suggestions came from `teams.list`
 *    (`limit: 500`) — i.e. from `teams`, the table, which during a review
 *    contains none of what the batch is about to create. An operator who staged
 *    "Toronto Blue Jays" on row 2 got no suggestion for it on row 5, retyped it
 *    as "Toronto Bluejays", and the commit created both. `stagedNames` closes
 *    that: the batch's own pending team names are offered FIRST, tagged so the
 *    operator can tell a not-yet-saved name from a saved one.
 * 2. **It could not see past 500 rows, and matched only on substring.** Now
 *    the search index (debounced like `PlayerAutocomplete`) supplies the saved
 *    half, and `rankTeamCandidates` adds the softer "did you mean?" prompt
 *    underneath — the one that catches "NY Yankees" vs "New York Yankees",
 *    which no substring filter ever will.
 *
 * ## NEO-331 — the saved half is ranked by the set
 *
 * The saved half comes from `teams.pickerCandidates`, the query `TeamPicker`
 * types against, given the set under review (`contextOptionId`). On a 2022
 * Donruss set whose League is MLB, "pad" lists San Diego Padres above Arizona
 * League Padres: the set's league active in the set's year first, then minor
 * leagues active that year, then the set's league in other eras, then the
 * rest. The rows arrive in that order and are NOT re-sorted here — an
 * alphabet over them would undo the tiers. Staged names still lead.
 *
 * Client-side year bounds mirror the server validation in
 * entityReviewQueue.recordDecision so bad input is caught before the
 * round-trip; the server re-validates regardless (defense in depth).
 */

// NEO-254: re-exported from the one place the number now lives, rather than
// mirrored by hand. The comment this replaced pointed at the file it was
// copying — which is exactly how the Players page's copy drifted to 1850
// without anybody noticing the two validators had stopped agreeing.
export { MIN_CAREER_YEAR } from "../../lib/players/career-years";

/** See `PlayerAutocomplete`'s SEARCH_DEBOUNCE_MS — same value, same reasoning. */
const SEARCH_DEBOUNCE_MS = 200;

/** NEO-591 — `knownTeamsOnly`: what the form says when the typed team does not exist. */
export const UNKNOWN_TEAM_TEXT = "No team by that name. Pick one from the list.";
export const UNKNOWN_TEAM_AMBIGUOUS = "More than one team has that name. Pick one from the list.";

/** How many suggestions the dropdown shows, staged and searched combined. */
const MAX_SUGGESTIONS = 8;

/**
 * NEO-236: `name` is the WHOLE team name as the operator typed or picked it —
 * "San Diego Padres", not "Padres". Splitting it into a Location and a nickname
 * is the New Team step's question, asked once, where the League is asked too.
 */
export type CareerTeamDraft = {
  name: string;
  fromYear: number;
  toYear?: number;
};

/**
 * What `onAdd` reports in `knownTeamsOnly` mode: the stint, plus the NB team it
 * names when that is a saved team (a team the batch is still creating has no id
 * yet, and is found by its name).
 */
export type CareerTeamAdded = CareerTeamDraft & { teamId?: Id<"teams"> };

/** One dropdown row. `staged` drives the ordering and the dedupe — never a
 *  visible difference; see the option's `aria-label`. `teamId` is the saved
 *  team a row is (absent on a staged name). */
type Suggestion = { key: string; name: string; staged: boolean; teamId?: Id<"teams"> };

export default function CareerTeamEntry({
  sportId,
  contextOptionId,
  stagedNames,
  onAdd,
  onDirtyChange,
  initialTeam,
  initialFromYear,
  quickPicks,
  label,
  disabled = false,
  knownTeamsOnly = false,
  onDone,
}: {
  /** NEO-96: the sport-level selectorOptions row id, not its display name. */
  sportId: Id<"selectorOptions">;
  /**
   * NEO-331 — the set under review (its `selectorOptions` row), which
   * `teams.pickerCandidates` ranks the saved suggestions by. Absent, the
   * server falls back to name order.
   */
  contextOptionId?: Id<"selectorOptions">;
  /**
   * Team names this review batch is already going to create or link, from
   * `deriveStagedTeamNames`. Not yet in `teams`, so the team search cannot
   * return them — suggesting them is the whole point.
   */
  stagedNames: string[];
  onAdd: (entry: CareerTeamAdded) => void;
  /**
   * NEO-236 — "the operator has started filling this in".
   *
   * The wizard's walk may revise its own choice of row while nobody has begun
   * work on it (teams jump the queue as their lookups land). Half-typed text in
   * THIS form is work, and it lives here rather than in the wizard, so the
   * wizard cannot see it without being told. Fires on the transitions only, not
   * per keystroke.
   */
  onDirtyChange?: (dirty: boolean) => void;
  /**
   * NEO-574 — a team and From year the form opens with: the card's team and
   * the set's year (`career-prefill.ts`). A PREFILL, not work: it does not
   * make the form dirty, and nothing is added until the operator presses
   * + Add. When these change (the next team after an add, a lookup landing)
   * a form the operator has not touched follows them; a form they have is
   * left alone.
   */
  initialTeam?: string;
  initialFromYear?: number;
  /**
   * NEO-574 — other teams the cards print for this player, as one-press
   * fills for the team and From year. Parent-filtered: a team already
   * added is not offered again.
   */
  quickPicks?: ReadonlyArray<{ team: string; fromYear: number }>;
  /**
   * NEO-591 — whose stint this is, when more than one of these forms can be on
   * screen (the Career check step has one per "Add to career" line). It
   * rides on each control's name ("From year for Luis Rodriguez") so no two
   * read alike. Absent, the names are the New Player step's, unchanged.
   */
  label?: string;
  disabled?: boolean;
  /**
   * NEO-591 — the team must be one that exists: a saved team (offered in the
   * list, or typed exactly) or a team in `stagedNames`. A name that matches
   * neither cannot be added, and says so, because the form is used after the
   * wizard's New Team steps, where nothing can create it any more. `onAdd`
   * then carries the saved team's id. Off (the New Player step), typing a new
   * name IS creating it.
   */
  knownTeamsOnly?: boolean;
  /**
   * NEO-591 — Enter on an EMPTY form means "nothing more to add": the host
   * moves on (the Career check step goes to its next line).
   */
  onDone?: () => void;
}) {
  const suffix = label ? ` for ${label}` : "";
  const initialName = initialTeam ?? "";
  const initialYear = initialFromYear === undefined ? "" : String(initialFromYear);
  const [name, setName] = useState(initialName);
  const [debouncedName, setDebouncedName] = useState(initialName);
  const [fromYear, setFromYear] = useState(initialYear);
  const [toYear, setToYear] = useState("");
  /** The saved team a suggestion was taken from (`knownTeamsOnly`); typing clears it. */
  const [pickedTeamId, setPickedTeamId] = useState<Id<"teams"> | null>(null);
  /*
   * The prefill the fields last followed (render-phase "previous props"
   * pattern). A form still sitting on that prefill — or empty, which is what
   * + Add leaves — takes the new one; anything the operator changed stays.
   */
  const [followed, setFollowed] = useState({ name: initialName, year: initialYear });
  if (followed.name !== initialName || followed.year !== initialYear) {
    setFollowed({ name: initialName, year: initialYear });
    const untouched =
      toYear === "" &&
      ((name === followed.name && fromYear === followed.year) ||
        (name === "" && fromYear === ""));
    if (untouched) {
      setName(initialName);
      setDebouncedName(initialName);
      setFromYear(initialYear);
      setPickedTeamId(null);
    }
  }
  /** + Add just fired: the next prefill, if one arrives, is where Enter goes. */
  const justAddedRef = useRef(false);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(0);
  /** ArrowDown was pressed since the last keystroke: show the list even when
   *  the box already holds a known team (see `exactMatch`). */
  const [browsing, setBrowsing] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  /** Where focus goes after a suggestion is taken — the next thing to fill in. */
  const fromYearRef = useRef<HTMLInputElement>(null);
  /** The input + its listbox. Blur out of THIS closes the list; blur between
   *  its two halves does not. */
  const comboRef = useRef<HTMLDivElement>(null);
  /** The whole entry: scrolled into view when the list opens, so the list and
   *  the years row under it are both on screen. */
  const rootRef = useRef<HTMLDivElement>(null);
  const baseId = useId();
  const listboxId = `${baseId}-listbox`;
  const optionId = (idx: number) => `${baseId}-option-${idx}`;

  const maxYear = maxCareerYear();

  /**
   * Anything typed into any of the three fields counts. A name alone is enough:
   * it is the half the operator cannot get back by re-picking a suggestion.
   * NEO-574: a prefill left as it came is not typing (`followed`), and an
   * emptied form never is.
   */
  const blank = name.trim() === "" && fromYear.trim() === "";
  /** Nothing in any of the three boxes. */
  const isEmpty = blank && toYear.trim() === "";
  const dirty =
    toYear.trim() !== "" ||
    (!blank && (name.trim() !== followed.name.trim() || fromYear.trim() !== followed.year));

  /*
   * Emitted on the TRANSITIONS only, and through a ref rather than a dep.
   *
   * The parent's handler is an inline arrow, so it is a new function every
   * render; depending on it would fire this effect every render, and since the
   * handler sets parent state that is a render loop. Holding it in a ref and
   * gating on the value's own change makes the call count equal to the number
   * of times the answer actually changed — twice per stint, typically.
   */
  const onDirtyChangeRef = useRef(onDirtyChange);
  useEffect(() => {
    onDirtyChangeRef.current = onDirtyChange;
  }, [onDirtyChange]);
  const lastDirtyRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (lastDirtyRef.current === dirty) return;
    lastDirtyRef.current = dirty;
    onDirtyChangeRef.current?.(dirty);
  }, [dirty]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedName(name), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [name]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- typeahead highlight resets with the query it indexes into
    setHighlightIdx(0);
  }, [name]);

  const trimmedName = name.trim();
  const debouncedTrimmed = debouncedName.trim();
  /** What this entry will match against, and what a New Team step would be
   *  staged for: the whole typed name. */
  const composedName = trimmedName;

  // Blank skips: a typeahead that suggests before you type is noise, and
  // `pickerCandidates` would BROWSE on an empty term. Every key written out,
  // never spread (see TeamPicker): `undefined` is dropped on the wire.
  const ranked = useQuery(
    api.teams.pickerCandidates,
    debouncedTrimmed
      ? { query: debouncedTrimmed, sportId, contextOptionId }
      : "skip",
  );
  /*
   * The last answer the query gave. Convex hands back `undefined` while a query
   * with new arguments loads, so without this the list blinks once each time
   * typing pauses. Held as state, adjusted during render (the same "previous
   * value" pattern as `followed` above) rather than in a ref: the lint rule
   * rightly refuses a ref read while rendering.
   */
  const [lastRanked, setLastRanked] = useState(ranked);
  if (ranked !== undefined && ranked !== lastRanked) setLastRanked(ranked);
  /** The saved teams, in the server's final (tiered) order — or, while the
   *  query reloads, the last order it gave. */
  const searched = useMemo(
    () => (ranked ?? lastRanked)?.map((r) => r.team),
    [ranked, lastRanked],
  );
  /**
   * The saved teams to offer for the text CURRENTLY in the box.
   *
   * While the debounce or the query catches up, what we hold is the answer for
   * earlier text. Hiding it outright made the in-flow list vanish and come
   * back on every keystroke (`aria-expanded` flipping, the status re-announced,
   * + Add jumping). So stale rows stay, narrowed by the same folded-substring
   * test the staged names use: a row that still matches what is typed remains,
   * one that no longer does goes, and the list closes only when nothing is
   * left. Once the answer for this text is in, it is the server's, untouched
   * (its search can be softer than a substring). The very first query has no
   * earlier answer, so until it lands there are no saved rows at all. Staged
   * names are matched here, not searched, so they are always instant.
   */
  const savedStale = ranked === undefined || debouncedTrimmed !== name.trim();
  const freshSearched = useMemo(() => {
    if (searched === undefined) return undefined;
    if (!savedStale) return searched;
    return searched.filter((t) => nameMatchesQuery(teamFullName(t), name.trim()));
  }, [searched, savedStale, name]);


  /**
   * Staged first, then saved teams the staged list does not already cover.
   *
   * Staged names go first because they are the ones the operator cannot
   * discover any other way — a saved team is still findable by typing its full
   * name, a pending one is not. The staged half is filtered by the typed text
   * and prefix-ranked here; the saved half is already the server's match, in
   * the server's order (NEO-331: tier, then prefix, then A–Z), and is kept in
   * that order — re-sorting it would put Arizona League Padres back above
   * San Diego Padres on an MLB set.
   */
  const suggestions = useMemo<Suggestion[]>(() => {
    // NEO-253: folded, so an accented staged chip is reachable by typing the
    // ASCII spelling and vice versa. `nameSearchKey` rather than the
    // token-sorted dedup key, which would stop "new york" matching "New York
    // Yankees"; the dedup key is still what `stagedKeys` below uses, because
    // THAT question is identity.
    const q = trimmedName;
    if (!q) return [];

    const rank = (a: string, b: string) => {
      const aPrefix = nameHasQueryPrefix(a, q) ? 0 : 1;
      const bPrefix = nameHasQueryPrefix(b, q) ? 0 : 1;
      if (aPrefix !== bPrefix) return aPrefix - bPrefix;
      return a.localeCompare(b);
    };

    const stagedKeys = new Set(stagedNames.map(normalizeEntityName));
    const staged = stagedNames
      .filter((n) => nameMatchesQuery(n, q))
      .sort(rank)
      .map((n) => ({ key: `staged:${n}`, name: n, staged: true }));

    const saved = (freshSearched ?? [])
      // NEO-236: the FULL name. A suggestion is something the operator can
      // pick to LINK to, and "Padres" does not identify the row it belongs to.
      .map((t) => ({ _id: t._id, name: teamFullName(t) }))
      // Dropping a saved team already offered as staged: the same name twice,
      // once tagged and once not, reads as two different teams.
      .filter((t) => !stagedKeys.has(normalizeEntityName(t.name)))
      .map((t) => ({ key: `team:${t._id}`, name: t.name, staged: false, teamId: t._id }));

    return [...staged, ...saved].slice(0, MAX_SUGGESTIONS);
  }, [stagedNames, freshSearched, trimmedName]);

  /**
   * NEO-574 — the typed text IS one of the suggestions (case and accents
   * aside). There is nothing left to pick, so the list steps out of the way.
   *
   * It is an overlay, so while open it sits over the From/To years and + Add
   * directly under the field. Typing a team's whole name ("Memphis
   * RiverKings") and then clicking + Add used to land on the suggestion under
   * the pointer: the click picked a team (maybe a different one, ranked
   * first by the set) instead of adding. A list that offers back exactly what
   * is already in the box has no job, so it is not shown. A partial name still
   * shows its list, which is what the list is for, and ArrowDown asks for it
   * on purpose (`browsing`): a keyboard operator who does that is not about to
   * click + Add.
   */
  const exactIdx = useMemo(() => {
    if (!trimmedName) return -1;
    const key = nameSearchKey(trimmedName);
    return suggestions.findIndex((s) => nameSearchKey(s.name) === key);
  }, [suggestions, trimmedName]);
  const exactMatch = exactIdx >= 0;
  /*
   * NEO-591 — which team the typed name IS, in `knownTeamsOnly` mode: a team
   * the batch is creating (found by name), else the saved team taken from the
   * list, else the one saved team the whole name matches. Two saved teams
   * with one name are not guessed between: the list stays open to pick one.
   */
  const typedKey = nameSearchKey(trimmedName);
  const stagedMatch =
    knownTeamsOnly && typedKey !== "" && stagedNames.some((n) => nameSearchKey(n) === typedKey);
  const savedMatchIds = useMemo<Array<Id<"teams">>>(() => {
    if (!knownTeamsOnly || typedKey === "" || savedStale) return [];
    return (freshSearched ?? [])
      .filter((t) => nameSearchKey(teamFullName(t)) === typedKey)
      .map((t) => t._id);
  }, [knownTeamsOnly, typedKey, savedStale, freshSearched]);
  const resolvedTeamId: Id<"teams"> | undefined =
    knownTeamsOnly && !stagedMatch
      ? (pickedTeamId ?? (savedMatchIds.length === 1 ? savedMatchIds[0] : undefined))
      : undefined;
  const teamKnown = !knownTeamsOnly || stagedMatch || resolvedTeamId !== undefined;
  const ambiguousName = knownTeamsOnly && !stagedMatch && !pickedTeamId && savedMatchIds.length > 1;
  /** What the combobox actually shows: open, with rows, and not an echo. */
  const listOpen =
    suggestionsOpen && suggestions.length > 0 && (!exactMatch || browsing || ambiguousName);
  /** Typed, the search has answered, no list is offering a pick, and nothing by that name exists. */
  const showUnknownTeam =
    knownTeamsOnly && trimmedName !== "" && !savedStale && !teamKnown && !ambiguousName && !listOpen;

  /**
   * The "did you mean?" prompt: a name that is CLOSE to something already in
   * play but not equal to it. Suppressed when an exact match exists, because
   * then the typed text is already the right name and there is nothing to mean
   * instead — `rankTeamCandidates` puts any exact hit first, so one look at the
   * head of the ranking settles it.
   */
  const didYouMean = useMemo<string | null>(() => {
    if (!composedName) return null;
    const pool = [
      ...stagedNames,
      // NEO-236: the search returns whole rows, so the full name is
      // composed here rather than read off `name` — a split row's `name` is
      // just "Padres" and ranking "San Diego Padres" against it would report a
      // near match where there is an exact one.
      ...(freshSearched ?? []).map((t) => teamFullName(t)),
    ];
    if (pool.length === 0) return null;
    const ranked = rankTeamCandidates(
      composedName,
      pool.map((n) => ({ name: n })),
    );
    if (ranked.length === 0) return null;
    if (ranked[0].confidence === "exact") return null;
    return pool[ranked[0].index] ?? null;
  }, [composedName, stagedNames, freshSearched]);

  /**
   * The prompt that shows. While the list is open and already offers the very
   * team the prompt would name, the prompt is a second way to say the same
   * thing, so it waits until the list is closed (or offers something else).
   */
  const didYouMeanShown =
    didYouMean !== null &&
    !(
      listOpen &&
      suggestions.some((s) => nameSearchKey(s.name) === nameSearchKey(didYouMean))
    )
      ? didYouMean
      : null;

  const fromNum = Number(fromYear);
  const toNum = toYear.trim() === "" ? undefined : Number(toYear);

  const fromValid =
    fromYear.trim() !== "" &&
    Number.isInteger(fromNum) &&
    fromNum >= MIN_CAREER_YEAR &&
    fromNum <= maxYear;
  const toValid =
    toNum === undefined ||
    (Number.isInteger(toNum) && toNum <= maxYear && toNum >= fromNum);
  const canAdd = trimmedName !== "" && fromValid && toValid && teamKnown && !disabled;

  const commit = () => {
    if (!canAdd) return;
    onAdd({
      name: trimmedName,
      fromYear: fromNum,
      ...(toNum !== undefined ? { toYear: toNum } : {}),
      ...(resolvedTeamId ? { teamId: resolvedTeamId } : {}),
    });
    setPickedTeamId(null);
    setName("");
    setDebouncedName("");
    setFromYear("");
    setToYear("");
    setSuggestionsOpen(false);
    setBrowsing(false);
    justAddedRef.current = true;
    // Safe to refocus now: the list opens on TYPING, not on focus. See the
    // note on `pickSuggestion`.
    nameInputRef.current?.focus();
  };

  /*
   * NEO-574 — if the parent answered the add with the NEXT prefill (the next
   * team the cards print), the form is ready to add again: park focus on
   * From year, where Enter adds, instead of on the name. Runs once, on the
   * first render after an add; a prefill that arrives later never moves
   * focus.
   */
  useEffect(() => {
    if (!justAddedRef.current) return;
    justAddedRef.current = false;
    if (followed.name !== "" && followed.year !== "") fromYearRef.current?.focus();
  });

  /** A quick pick fills the team and From year, and leaves the add to the operator. */
  const takeQuickPick = (team: string, year: number) => {
    setPickedTeamId(null);
    setName(team);
    setDebouncedName(team);
    setFromYear(String(year));
    setSuggestionsOpen(false);
    setBrowsing(false);
    fromYearRef.current?.focus();
  };
  const shownQuickPicks = (quickPicks ?? []).filter(
    (q) => !(q.team === trimmedName && String(q.fromYear) === fromYear.trim()),
  );

  /**
   * Enter in either year field is "+ Add" (Jason, 2026-10-04): the years are
   * the last thing filled in, so the keyboard operator should not have to Tab
   * to the button. `commit` already refuses an invalid entry, so Enter on bad
   * data does nothing, exactly like the disabled button.
   *
   * `preventDefault` on EVERY Enter, valid or not: nothing else acts on it — no
   * implicit form submission if a caller ever wraps this in a `<form>`, and no
   * ancestor shortcut that honours `defaultPrevented`. The name field keeps its
   * own Enter (take a suggestion or close the list); it never adds.
   */
  const handleYearKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    // NEO-591 — an empty form has nothing to add: Enter is "done here".
    if (onDone && isEmpty) {
      e.stopPropagation();
      if (!e.repeat) onDone();
      return;
    }
    commit();
  };

  /**
   * A suggestion is an existing (or already-staged) team's WHOLE name, and it
   * goes into the box verbatim — byte-for-byte the name the prelude will look
   * up, which is what makes it link rather than create.
   *
   * ## Why taking a suggestion used to leave the list open
   *
   * Jason, 2026-09-06, on "Buffalo Sabres": "I can't find any way to dismiss
   * the green list." This closed the list and then called
   * `nameInputRef.current.focus()` — and the input carried
   * `onFocus={() => setSuggestionsOpen(true)}`, so the refocus immediately
   * reopened what the line above had just closed. The list then covered the
   * From/To year fields underneath, which are the very next thing to fill in,
   * and nothing could dismiss it: blur was unhandled too.
   *
   * The `onFocus` auto-open is GONE rather than worked around with a
   * suppression flag. Focusing a text box should not drop a list over the
   * fields below it; the list belongs to typing (and to ArrowDown, for a
   * keyboard operator who wants it back). That removes the whole class of bug
   * rather than this one instance of it.
   *
   * Focus lands on FROM YEAR, not back on the name: the team is chosen, and
   * the stint is not finished until it has a year.
   */
  const pickSuggestion = (teamName: string, teamId?: Id<"teams">) => {
    setPickedTeamId(teamId ?? null);
    setName(teamName);
    setDebouncedName(teamName);
    setSuggestionsOpen(false);
    setBrowsing(false);
    fromYearRef.current?.focus();
  };

  /**
   * Focus left the combobox entirely — close the list.
   *
   * Deferred, and checked against `document.activeElement` rather than the
   * event's `relatedTarget`: `relatedTarget` on blur/focusout is unreliable
   * across environments (notably jsdom, where it comes back null for an
   * ordinary focus move), so the read has to happen after focus has actually
   * settled. Same reasoning, same shape as `TeamPicker.handleRootBlur`.
   *
   * Scoped to the combobox, so moving between the input and one of its own
   * options does not count as leaving.
   */
  const handleComboBlur = () => {
    setTimeout(() => {
      if (comboRef.current?.contains(document.activeElement)) return;
      // A press on the controls under the list is still in flight: closing now
      // would pull the row up from under the pointer and the click would never
      // land. `holdListWhilePressed` closes it once the press is over.
      if (pressingRef.current) {
        closeAfterPressRef.current = true;
        return;
      }
      setSuggestionsOpen(false);
      setBrowsing(false);
    }, 0);
  };

  /*
   * The list is in the flow, so closing it moves everything under it up. A
   * mouse press on + Add (or a year box) first blurs the name box, which
   * closes the list, which moves the button before the button is released:
   * mousedown and mouseup then land on different elements and no click fires.
   * So a press on those controls keeps the list as it is until the pointer is
   * released and the click has run; a blur that happened meanwhile is honoured
   * then. + Add closes the list itself when it commits.
   */
  const pressingRef = useRef(false);
  const closeAfterPressRef = useRef(false);
  const releasePressRef = useRef<(() => void) | null>(null);
  const holdListWhilePressed = () => {
    pressingRef.current = true;
    releasePressRef.current?.();
    const onUp = () => {
      window.removeEventListener("mouseup", onUp);
      releasePressRef.current = null;
      // After the click event that follows this mouseup.
      setTimeout(() => {
        pressingRef.current = false;
        if (!closeAfterPressRef.current) return;
        closeAfterPressRef.current = false;
        if (comboRef.current?.contains(document.activeElement)) return;
        setSuggestionsOpen(false);
        setBrowsing(false);
      }, 0);
    };
    releasePressRef.current = () => window.removeEventListener("mouseup", onUp);
    window.addEventListener("mouseup", onUp);
  };
  useEffect(() => () => releasePressRef.current?.(), []);

  /* The list opening grows the entry downward; keep the list and the years row
     under it in view (the review dialog scrolls). `nearest` moves nothing
     when they already are. */
  useEffect(() => {
    if (listOpen) rootRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [listOpen]);

  return (
    <div
      ref={rootRef}
      className="border border-rule-strong rounded-md bg-raised-deep/60 p-2 space-y-1.5"
    >
      {/* NEO-236: one box. The team's Location is asked on its own New Team
          step, which is also the only place its League can be asked. */}
      <div className="relative" ref={comboRef} onBlur={handleComboBlur}>
        <Input
          bare
          ref={nameInputRef}
          type="text"
          value={name}
          placeholder="Team name (search or type new)…"
          aria-label={`Career team name${suffix}`}
          disabled={disabled}
          role="combobox"
          aria-expanded={listOpen}
          aria-controls={listboxId}
          aria-activedescendant={
            listOpen && suggestions[highlightIdx] ? optionId(highlightIdx) : undefined
          }
          aria-autocomplete="list"
          onChange={(e) => {
            setPickedTeamId(null);
            setName(e.target.value);
            setSuggestionsOpen(true);
            setBrowsing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              if (listOpen) {
                setHighlightIdx((i) => Math.min(i + 1, suggestions.length - 1));
              } else {
                // Opening the list is the first press: land on the row the box
                // already holds (a whole name), else the top, instead of
                // skipping past it.
                setSuggestionsOpen(true);
                setBrowsing(true);
                setHighlightIdx(exactIdx >= 0 ? exactIdx : 0);
              }
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHighlightIdx((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
              // Never let Enter here bubble to the wizard's confirm shortcut
              // or add a half-filled entry. If a suggestion is highlighted,
              // fill the name from it; if the box already holds a known
              // team's name (NEO-574), move on to From year as a pick would;
              // otherwise just close the dropdown.
              e.preventDefault();
              if (listOpen && suggestions[highlightIdx]) {
                pickSuggestion(suggestions[highlightIdx].name, suggestions[highlightIdx].teamId);
              } else if (exactMatch && !browsing) {
                setSuggestionsOpen(false);
                fromYearRef.current?.focus();
              } else {
                setSuggestionsOpen(false);
                // NEO-591 — and an empty form is "done here".
                if (onDone && isEmpty) {
                  e.stopPropagation();
                  if (!e.repeat) onDone();
                }
              }
            } else if (e.key === "Escape") {
              /*
               * NEO-220 — Escape in this field NEVER reaches the wizard.
               *
               * It used to be swallowed only while the dropdown had
               * suggestions in it, so Escape on a typed name that matched
               * nothing — the exact case this field exists for, a team
               * Wikidata and `teams` have both never heard of — bubbled to the
               * dialog root and cancelled the whole review batch. The operator
               * pressed a key that means "clear this" and lost every decision
               * they had made.
               *
               * Now it steps out one level at a time and stops there: close
               * the dropdown if it is open, otherwise clear the name. Both are
               * local, both are what Escape means in a combobox, and neither
               * can reach past this field. `stopPropagation` unconditionally,
               * so the guarantee does not depend on which branch ran.
               */
              e.preventDefault();
              e.stopPropagation();
              setBrowsing(false);
              if (listOpen) {
                setSuggestionsOpen(false);
              } else if (name !== "") {
                setName("");
                setDebouncedName("");
                setSuggestionsOpen(false);
              }
            }
          }}
          className="w-full p-1.5 text-sm"
        />
        {listOpen && (
          <ul
            id={listboxId}
            role="listbox"
            aria-label="Existing team suggestions"
            className="mt-1 max-h-32 max-sm:max-h-[30vh] overflow-y-auto rounded-md border border-rule-strong bg-raised-deep"
          >
            {suggestions.map((s, idx) => (
              <li key={s.key} role="none">
                <button
                  type="button"
                  id={optionId(idx)}
                  role="option"
                  tabIndex={-1}
                  aria-selected={idx === highlightIdx}
                  /*
                   * NEO-236 — ONE name for every suggestion, saved or staged.
                   *
                   * Jason, 2026-09-06, on the tag this used to carry: "'not
                   * saved yet' is equally confusing. Do we need anything there
                   * at all? Is there any value in telling the user anything
                   * about that?" There is not. Whether a team already exists or
                   * this review is about to create it changes nothing the
                   * operator can act on here — picking it does the same thing
                   * either way, and the difference is bookkeeping we were
                   * narrating at them.
                   *
                   * `staged` still earns its keep: it orders these rows (a
                   * pending name is the one you cannot find any other way) and
                   * it dedupes them against the saved half. It just no longer
                   * says anything.
                   */
                  aria-label={`Use ${s.name}`}
                  onMouseEnter={() => setHighlightIdx(idx)}
                  onClick={() => pickSuggestion(s.name, s.teamId)}
                  className={`flex w-full items-center gap-2 px-2 py-1 text-left text-sm ${
                    idx === highlightIdx
                      ? "bg-neon-green/20 text-neon-green-text"
                      : "hover:bg-hover text-ink-2"
                  }`}
                >
                  <span className="flex-1 truncate">{s.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {/* Always mounted: a live region has to exist before its text changes. */}
        <p className="sr-only" role="status">
          {listOpen
            ? `${suggestions.length} ${suggestions.length === 1 ? "suggestion" : "suggestions"}`
            : ""}
        </p>
      </div>

      {knownTeamsOnly && (
        /* Always mounted, text swapped in: a live region that exists before it
           speaks. Only when the search has answered and nothing matches. */
        <p role="status" className="text-xs text-neon-pink-text">
          {ambiguousName
            ? UNKNOWN_TEAM_AMBIGUOUS
            : showUnknownTeam
              ? UNKNOWN_TEAM_TEXT
              : ""}
        </p>
      )}

      {didYouMeanShown && (
        <p className="text-xs text-ink-3" onMouseDown={holdListWhilePressed}>
          {/* NEO-212 (a11y): no aria-label. The visible text IS the name, so
              an "Use {name}" override replaced a readable label with one that
              shares none of its words — a voice-control user saying "Did you
              mean New York Yankees" matched nothing (WCAG 2.2 SC 2.5.3). */}
          <button
            type="button"
            onClick={() => pickSuggestion(didYouMeanShown)}
            className="text-neon-blue-text underline decoration-dotted hover:text-neon-green-text focus:text-neon-green-text focus-outline"
          >
            Did you mean {didYouMeanShown}?
          </button>
        </p>
      )}

      <div className="flex items-center gap-2" onMouseDown={holdListWhilePressed}>
        <Input
          bare
          ref={fromYearRef}
          type="number"
          value={fromYear}
          placeholder="From year"
          aria-label={`From year${suffix}`}
          disabled={disabled}
          min={MIN_CAREER_YEAR}
          max={maxYear}
          onChange={(e) => setFromYear(e.target.value)}
          onKeyDown={handleYearKeyDown}
          className="w-24 p-1.5 text-sm"
        />
        <Input
          bare
          type="number"
          value={toYear}
          placeholder="To year"
          aria-label={`To year (optional)${suffix}`}
          disabled={disabled}
          min={MIN_CAREER_YEAR}
          max={maxYear}
          onChange={(e) => setToYear(e.target.value)}
          onKeyDown={handleYearKeyDown}
          className="w-28 p-1.5 text-sm"
        />
        <NeonButton
          type="button"
          variant="primary"
          outline
          onClick={commit}
          disabled={!canAdd}
          aria-label={`Add career team${suffix}`}
        >
          + Add
        </NeonButton>
      </div>

      {shownQuickPicks.length > 0 && (
        <div
          role="group"
          aria-label="Also on the cards"
          className="flex flex-wrap items-center gap-1.5"
          onMouseDown={holdListWhilePressed}
        >
          <span aria-hidden="true" className="text-xs text-ink-3">
            Also on the cards:
          </span>
          {shownQuickPicks.map((q) => (
            <button
              key={`${q.team}:${q.fromYear}`}
              type="button"
              aria-label={`Fill in ${q.team}`}
              onClick={() => takeQuickPick(q.team, q.fromYear)}
              className="rounded-full border border-rule-strong bg-raised min-h-6 px-2 py-1 text-xs text-ink-2 hover:border-ink-2 hover:text-ink focus-outline max-sm:min-h-11"
            >
              {q.team}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
