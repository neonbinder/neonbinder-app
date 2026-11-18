/**
 * NEO-254 — a team's ERA, and what it is allowed to decide.
 *
 * ## Why a team name is no longer unique in a sport
 *
 * Jason, at the hockey checkpoint: "lets fix the lineage issue now … when we
 * are done loading, all of the data is correct."
 *
 * There are two Winnipeg Jets. The first played 1972-1996 and became the
 * Phoenix Coyotes and then Utah; the second is the 2011 Atlanta Thrashers
 * under a revived name. They are different franchises, different players and
 * different cards, and under the NEO-236 key `(nameNormalized, sportId)` they
 * folded into one row — so a 1985 Jets card and a 2015 Jets card pointed at the
 * same team. The Browns/Ravens split and the Charlotte/New Orleans Hornets do
 * the same thing in other sports.
 *
 * Identity therefore becomes `(nameNormalized, sportId, yearsActive.from)`.
 * The name still does the finding; the ERA is what tells two findings apart.
 *
 * ## What this module is for
 *
 * The era arithmetic, and nothing else. Pure — no Convex imports, no I/O — for
 * the same reason `lib/teams/team-name.ts` is: it is read by Convex functions,
 * by React components and by tests in three environments, and a
 * `_generated/server` import here would break the client build.
 *
 * ## The one rule that matters more than the arithmetic
 *
 * **A row with no `yearsActive` is never excluded.** Not by the card-year
 * narrowing, not by the overlap check. "We have not recorded this team's years"
 * and "this team was not active then" are different facts, and every path here
 * treats the first as unknown rather than as no. The consequence is deliberate
 * and it is the safe direction: an undated row keeps a card name ambiguous and
 * sends it to a human, instead of being quietly ruled out so that some other
 * era can win by default.
 *
 * That mirrors the player side exactly — see `lib/players/career-span.ts`,
 * where a player with no stints has no span and is never filtered out.
 *
 * ## …and the one direction a lone row may be out of its era (NEO-307)
 *
 * Jason, 2026-09-25: "a card can show a team's past, never its future." A
 * retro card of a team that folded is still that team's card, so a LONE dated
 * row answers for a SET year after its era ended — and never for one before
 * it began. A career stint's year gets no such allowance: nobody plays for a
 * team after it folds. `pickTeamForYear` is where that is decided, opt-in per
 * caller; the filters below stay strict, because between SEVERAL rows a closed
 * era is still no answer.
 *
 * ## …and who decides between several rows for a CARD (NEO-602)
 *
 * The set's year only knows what was true when the cards were printed; the
 * card's PLAYERS know which franchise they are on. When a printed name reaches
 * several rows, `pickCardTeam` lets a player's stint (overlapping the row's
 * era) decide, the year only excludes the future, and the year decides alone
 * only when no player has a stint on any row — except that a year pick reached
 * through an alias is not trusted over another row's own primary name. A tie
 * or a disagreement is a question for the operator, never the first row.
 */

import { MIN_CAREER_YEAR, maxCareerYear } from "../players/career-years";

/** A team's lifespan. `to` absent means "still going". */
export type TeamEra = { from: number; to?: number };

/**
 * NEO-602 (second layer) — is this an era the arithmetic below can trust?
 *
 * Whole years, and `to` no earlier than `from`. The writers refuse anything
 * else (`teamEraProblem`), but a row written before they did, by the loader,
 * or by a path nobody audited could still hold NaN, Infinity, a fraction or an
 * inverted span, and every comparison against NaN is false: a malformed era
 * would read as "overlaps nothing" and let an alias through that the strict
 * reading refuses. So a malformed era is treated as UNDATED, which every
 * helper here reads as overlapping and never excludes (the module note: unknown
 * is not absent). Fails safe.
 *
 * Range is not checked here (that is the writers' bound, `teamEraProblem`);
 * an integer far outside it is still an era, just a strange one.
 */
export function isWellFormedEra(years: TeamEra | undefined): years is TeamEra {
  if (!years || !Number.isInteger(years.from)) return false;
  if (years.to === undefined) return true;
  return Number.isInteger(years.to) && years.to >= years.from;
}

/**
 * NEO-254 / NEO-602 — why a team era cannot be saved, in the operator's words,
 * or `null` when it can: whole years between `MIN_CAREER_YEAR` and next year,
 * ending no earlier than they start. The ONE rule behind every writer
 * (`requireTeamEra` in `convex/lib/teamEra.ts`) and the review wizard's
 * pre-check, the same bounds `leagues.validateLeagueYears` applies to a
 * league's era.
 */
export function teamEraProblem(
  era: { from: number; to?: number },
  now: Date = new Date(),
): string | null {
  const maxYear = maxCareerYear(now);
  if (!Number.isInteger(era.from) || era.from < MIN_CAREER_YEAR || era.from > maxYear) {
    return `A team start year must be a whole year between ${MIN_CAREER_YEAR} and ${maxYear}.`;
  }
  if (era.to !== undefined) {
    if (!Number.isInteger(era.to) || era.to < MIN_CAREER_YEAR || era.to > maxYear) {
      return `A team end year must be a whole year between ${MIN_CAREER_YEAR} and ${maxYear}.`;
    }
    if (era.to < era.from) return "A team cannot stop playing before it starts.";
  }
  return null;
}

/** The minimum a row must expose for the era helpers. */
export type TeamEraRow = { yearsActive?: TeamEra };

/**
 * "1972–1996", "2011–present", or "" for a team nobody has dated.
 *
 * An en dash, not a hyphen: this is a range, and it is rendered beside team
 * names in pickers and candidate lists where the distinction is the whole
 * point of the label.
 */
export function eraLabel(years: TeamEra | undefined): string {
  if (!years) return "";
  return `${years.from}–${years.to ?? "present"}`;
}

/**
 * Does this row's era contain `year`?
 *
 * `true` for a row with no era at all — see the module note. That is what makes
 * this safe to use as a filter: it removes rows KNOWN to be wrong and never
 * rows merely unproven.
 *
 * No tolerance window, unlike the player narrowing's `CARD_YEAR_TOLERANCE`. A
 * career span is assembled from stints that may be missing their first or last
 * season, so it needs slack; a franchise's `yearsActive` is a single recorded
 * fact about when the team existed, and widening it would let a 1996 Jets card
 * match the 1997 team that did not exist yet.
 */
export function eraCoversYear(
  years: TeamEra | undefined,
  year: number,
): boolean {
  if (!isWellFormedEra(years)) return true;
  if (year < years.from) return false;
  return years.to === undefined || year <= years.to;
}

/**
 * Could these two eras be the same team's?
 *
 * Two closed spans overlap when each starts no later than the other ends; an
 * open `to` runs forever. Either side being undated returns `true` — unknown,
 * so not ruled out.
 *
 * This is the collision test, not the narrowing test, and the asymmetry is
 * deliberate. `eraCoversYear` decides which row a CARD means and errs toward
 * asking a human. This decides whether two ROWS are the same team and errs
 * toward refusing the write: an operator renaming a row onto an undated
 * same-name row is told to go and look, rather than being allowed to create the
 * second Winnipeg Jets this ticket exists to keep apart.
 */
export function erasOverlap(
  a: TeamEra | undefined,
  b: TeamEra | undefined,
): boolean {
  if (!isWellFormedEra(a) || !isWellFormedEra(b)) return true;
  return a.from <= (b.to ?? Infinity) && b.from <= (a.to ?? Infinity);
}

/**
 * The rows a card from `year` could be naming.
 *
 * Returns every row when `year` is undefined: with no evidence nothing is
 * narrowed, which is rule 1 of the player narrowing restated. The caller then
 * sees "more than one" and sends the name to review, rather than picking.
 */
export function teamsActiveInYear<T extends TeamEraRow>(
  rows: readonly T[],
  year: number | undefined,
): T[] {
  if (year === undefined || !Number.isInteger(year)) return [...rows];
  return rows.filter((row) => eraCoversYear(row.yearsActive, year));
}

/**
 * What `pickTeamForYear` concluded: the row, and whether it won only because a
 * card may show a team's PAST.
 */
export type TeamEraPick<T> = { row: T; pastEra: boolean };

/** How `pickTeamForYear` may read a year. */
export type TeamEraPickOptions = {
  /**
   * NEO-307 — `true` only when `year` is a CARD's (set) year. A card can show
   * a team's past; a career stint cannot be after its team folded, so a stint
   * caller leaves this off and a lone row outside its era stays a question.
   * Off by default: a new caller has to decide which kind of year it holds.
   */
  allowPastEra?: boolean;
};

/**
 * NEO-254 + NEO-307 — which of a name's rows `year` means, or `null` when a
 * human has to decide.
 *
 * ## Rule 1: a card can show a team's past, never its future
 *
 * Jason, 2026-09-25: "a card can show a team's past, never its future."
 *
 * A 2026 Donruss card of the Brooklyn Dodgers is a retro card. It is still a
 * Brooklyn Dodgers card, and when the sport holds exactly one row under that
 * name — dated 1911–1957 — that row is the one it means. Refusing it (the
 * NEO-254 behaviour) raised a New Team step for a team we already hold.
 *
 * The other direction is still a refusal. A 1985 card cannot show a team that
 * did not exist until 2011, so a lone Winnipeg Jets row dated 2011– is
 * positive evidence the card means some other Jets, and the answer is `null`:
 * we hold a Winnipeg Jets, it is not this one, and a human decides whether the
 * earlier era needs creating.
 *
 * The allowance is a CARD rule, so it is opt-in (`allowPastEra`). A career
 * stint is a season a player actually played: a 2015 stint at "Winnipeg Jets"
 * cannot mean the 1972–1996 franchise, so with only that row held the stint
 * gets a step to create the 2011 era rather than a link to the wrong one.
 *
 * In full:
 *
 * - **One row, and its era covers the year (or it has none)** → that row.
 *   Unknown years cannot contradict anything.
 * - **One row, and the year is after its era ended** → with `allowPastEra`,
 *   that row with `pastEra: true` (the card shows the team's past); without
 *   it, `null`.
 * - **One row, and the year is before its era began** → `null`. Nothing shows
 *   a team's future.
 * - **Several rows** → the one whose era covers the year, when exactly one
 *   does; otherwise `null`, whatever `allowPastEra` says. Two closed eras both
 *   before the year are two franchises a retro card could equally mean, and
 *   choosing between them is a guess. Never guess.
 * - **No year** → nothing is narrowed, so one row is the row and several are
 *   a question. See `teamsActiveInYear`.
 *
 * Pure and era-only by design. It reads `yearsActive` and nothing else — never
 * a name, never a marketplace value — so what the card said has already done
 * its only job (finding the candidates) before this runs.
 */
export function pickTeamForYear<T extends TeamEraRow>(
  rows: readonly T[],
  year: number | undefined,
  options: TeamEraPickOptions = {},
): TeamEraPick<T> | null {
  const survivors = teamsActiveInYear(rows, year);
  if (survivors.length === 1) return { row: survivors[0], pastEra: false };
  if (survivors.length > 0 || rows.length !== 1) return null;
  if (!options.allowPastEra) return null;
  // Exactly one row and its era excludes the year — which can only happen when
  // the year is an integer and the row is dated. Past, or future?
  const lone = rows[0];
  const end = lone.yearsActive?.to;
  if (year !== undefined && end !== undefined && year > end) {
    return { row: lone, pastEra: true };
  }
  return null;
}

/**
 * NEO-602 — one season of a player's career on a team, as the era rules read it.
 *
 * The shape of `players.teamYears[]`, with the team id as a plain string so
 * this module stays free of Convex types. Either year may be absent: an
 * undated stint is a fact we hold without its years.
 */
export type Stint = { teamId: string; fromYear?: number; toYear?: number };

/**
 * NEO-602 — does `stint` overlap `era`?
 *
 * A stint missing a year runs open on that side (a missing `toYear` is "still
 * there", a missing `fromYear` is "from the start"), so an UNDATED stint
 * overlaps everything and an undated ERA overlaps every stint. Unknown is not
 * absent — the module note's rule, applied to the player side.
 */
export function stintOverlapsEra(stint: Stint, era: TeamEra | undefined): boolean {
  if (!isWellFormedEra(era)) return true;
  const from = stint.fromYear ?? -Infinity;
  const to = stint.toYear ?? Infinity;
  return from <= (era.to ?? Infinity) && era.from <= to;
}

/** What `pickCardTeam` concluded. */
export type CardTeamPick<T> = {
  row: T;
  /**
   * `"year"` — the set year (and the alias-vs-own-name guard) settled it, no
   * player was needed. `"players"` — the cards' players' stints settled it.
   */
  via: "year" | "players";
  /**
   * Whether the set year, read on its own the way the resolver always has
   * (`pickTeamForYear` with the card's past-era allowance), lands on this same
   * row. A players' answer that DISAGREES with the year is the one a caller
   * must show the operator rather than link silently.
   */
  agreesWithYear: boolean;
};

/** What `pickCardTeam` reads besides the rows. */
export type CardTeamPickInput = {
  /** The set's year; absent means nothing is narrowed by year. */
  setYear: number | undefined;
  /**
   * The ids of the rows the printed name reached by an ALIAS only (the name is
   * not their own primary name). The card name matched them through a side
   * entry the operator or the loader wrote, not through what the team is
   * called.
   */
  aliasOnlyIds: ReadonlySet<string>;
  /**
   * Per card printing the name, per player on that card, that player's stints.
   * Absent (or empty) means the caller has no player evidence to offer.
   */
  cards?: ReadonlyArray<ReadonlyArray<ReadonlyArray<Stint>>>;
};

/**
 * NEO-602 — which of a printed team name's rows a CARD means, or `null` when a
 * human has to decide. The ONE rule behind the review gate, the commit prelude,
 * the per-card BSC fill and the legacy backfill: callers hand it the rows and
 * the evidence, and none of them restates it.
 *
 * ## Why the year alone is not enough
 *
 * "Oakland Athletics" is the PRIMARY name of the 1968–2024 Oakland row and an
 * ALIAS of the 2025– Athletics row. A 2025 set's year covers only the second,
 * so the year silently linked every card to the Athletics — including a Rickey
 * Henderson card, a man who never played for them. The card's players know
 * which franchise they are on; the set's year only knows what was true when
 * the cards were printed.
 *
 * ## The rule (Jason, 2026-11-18: option A for the no-stint case)
 *
 * - **One row** → `pickTeamForYear` with the card's past-era allowance, as it
 *   has always been. Nothing to choose between, so no player is asked.
 * - **Several rows** →
 *   1. A row whose era starts after the set year is never an answer: a card can
 *      show a team's past, never its future.
 *   2. A row is SUPPORTED when a player on a card has a stint on it that
 *      overlaps the row's era (an undated stint counts).
 *   3. If any row is supported, the players decide, strictly: every card must
 *      point at exactly one row, the same row on every card. A tie, a
 *      disagreement, or a card the players say nothing about is `null` — never
 *      the first candidate. A player with stints on BOTH rows is a tie too; the
 *      year does not break it (D6).
 *   4. If no player supports any row, the set year picks, as before — EXCEPT
 *      when the year's pick matched the name only by alias while another
 *      eligible row holds the name as its OWN primary name: then `null`. An
 *      alias is a side entry; the printed name is that other team's name.
 *
 * Pure and era/stint-only: it reads `yearsActive`, stints and the two id sets,
 * never a name.
 */
export function pickCardTeam<T extends TeamEraRow & { _id: string }>(
  rows: readonly T[],
  input: CardTeamPickInput,
): CardTeamPick<T> | null {
  if (rows.length === 0) return null;
  const { setYear, aliasOnlyIds, cards } = input;
  const yearPick = pickTeamForYear(rows, setYear, { allowPastEra: true });
  if (rows.length === 1) {
    return yearPick ? { row: yearPick.row, via: "year", agreesWithYear: true } : null;
  }

  const year =
    setYear !== undefined && Number.isInteger(setYear) ? setYear : undefined;
  // 1. Never a team that did not exist yet.
  const eligible = rows.filter((row) => {
    const era = row.yearsActive;
    return year === undefined || !isWellFormedEra(era) || era.from <= year;
  });
  if (eligible.length === 0) return null;

  // 2. Which rows does each card's cast of players put a stint on?
  const supportedPerCard: Set<string>[] = (cards ?? []).map((players) => {
    const onCard = new Set<string>();
    for (const stints of players) {
      for (const stint of stints) {
        const row = eligible.find((r) => r._id === stint.teamId);
        if (row && stintOverlapsEra(stint, row.yearsActive)) onCard.add(row._id);
      }
    }
    return onCard;
  });

  // 3. Any player evidence at all → the players decide, strictly.
  if (supportedPerCard.some((onCard) => onCard.size > 0)) {
    let answer: string | null = null;
    for (const onCard of supportedPerCard) {
      if (onCard.size !== 1) return null;
      const [only] = onCard;
      if (answer !== null && answer !== only) return null;
      answer = only;
    }
    const row = eligible.find((r) => r._id === answer);
    if (!row) return null;
    return {
      row,
      via: "players",
      agreesWithYear: yearPick !== null && yearPick.row._id === row._id,
    };
  }

  // 4. No player says anything: the set year picks, with one guard.
  if (!yearPick) return null;
  if (
    aliasOnlyIds.has(yearPick.row._id) &&
    eligible.some((r) => r._id !== yearPick.row._id && !aliasOnlyIds.has(r._id))
  ) {
    return null;
  }
  return { row: yearPick.row, via: "year", agreesWithYear: true };
}

/**
 * NEO-602 — the clause of an alias refusal that says WHY two teams are
 * considered to clash, in the operator's words.
 *
 * `self` is the team being saved or created; `other` is the team it clashes
 * with. Two dated, overlapping teams read "the two teams' years overlap";
 * when a side has no years the clash is a "may", because an undated team is
 * unknown rather than absent (the module note). Shared by the server's
 * refusals and the review wizard's own copy so they cannot drift.
 */
export function eraOverlapReason(
  self: TeamEra | undefined,
  other: TeamEra | undefined,
): string {
  if (self && other) return "the two teams' years overlap";
  if (!self && !other) return "neither team has years on file, so they may overlap";
  if (!self) return "this team has no years on file, so they may overlap";
  return "that team has no years on file, so they may overlap";
}

/**
 * "San Diego Padres · 1969–present" — a team named the way a picker has to name
 * it once two rows can share the name.
 *
 * The era is appended only when the row HAS one: "Winnipeg Jets · " with
 * nothing after it reads as a rendering bug, and an undated row is common
 * enough that it must look deliberate.
 */
export function teamOptionLabel(
  fullName: string,
  years: TeamEra | undefined,
): string {
  const era = eraLabel(years);
  return era ? `${fullName} · ${era}` : fullName;
}
