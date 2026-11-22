import type { TeamCheckOutcome } from "../../card-checklist-row";
import {
  aliasHolderSentence as sharedAliasHolderSentence,
  eraOverlapReason,
  teamOptionLabel,
} from "../../../../lib/teams/team-era";

/**
 * NEO-645 — the words the identity tiles say, in one place.
 *
 * Most of these are ported from the retired review wizard
 * (`entity-review-nav.ts`) and the missing-team fixer, whose files go away with
 * the walker. They are kept word for word where the wizard's E2E flows and the
 * operators already know them.
 */

/** A name's lookup suggestion (`enrichment.preselect`), as the tile reads it. */
export type PreselectLike = {
  name: string;
  sportValue: string;
  reason: "priorYearProduct" | "onlyNamesake" | "setHistory" | "hallOfFame" | "careerTeam";
};

/**
 * Why a suggested player is on offer, so the operator is never asked to
 * confirm a guess they cannot see the basis of. Ported from
 * `preselectReasonLine` (NEO-424).
 */
export function preselectReasonLine(preselect: PreselectLike): string {
  const who = `${preselect.name} (${preselect.sportValue})`;
  switch (preselect.reason) {
    case "priorYearProduct":
      return `Last year's edition of this set had ${who}. Same one?`;
    case "setHistory":
      return `Another card in this set is already linked to ${who}. Same one?`;
    case "hallOfFame":
      return `None of the ${preselect.name}s on file played that year, but one's in the Hall of Fame (${preselect.sportValue}). Same one?`;
    case "careerTeam":
      return `Only one ${preselect.name} on file ever played for this card's team (${preselect.sportValue}). Same one?`;
    case "onlyNamesake":
    default:
      return `We've only got one ${who} on file. Same one?`;
  }
}

/** Why NeonBinder linked a name without being asked: the purple "Linked for you" note. */
export type LinkedForReason = "exact" | "setHistory" | "hallOfFame" | "careerTeam";

export function linkedForText(reason: LinkedForReason): string {
  switch (reason) {
    case "exact":
      return "Linked for you: exact name, plays in this set's sport";
    case "setHistory":
      return "Linked for you: another card in this set is already linked to them";
    case "hallOfFame":
      return "Linked for you: none of the others on file played that year, but this one is in the Hall of Fame";
    case "careerTeam":
      return "Linked for you: the only one on file who played for this card's team";
  }
}

/**
 * The same note on a TEAM row. `linkedForText("careerTeam")` is about a player
 * ("the only one on file who played for this card's team"), so a team row says
 * which player's career names the team instead. `playerName` is the card's
 * player whose stints include it, when there is one.
 */
export function teamLinkedForText(reason: LinkedForReason, playerName?: string): string {
  if (reason !== "careerTeam") return linkedForText(reason);
  const who = playerName?.trim();
  return who ? `Linked for you: ${who} played here` : "Linked for you: a player on this card played here";
}

/**
 * NEO-645 (S3a): the purple note on a player name NB ruled out itself, because
 * the same card prints it as its team. The card says so; the operator can
 * still change it.
 */
export const NOT_A_PLAYER_SAME_AS_TEAM_NOTE =
  "Ruled out for you: this card prints the same name as its team";

/** The purple note on a player "Add all new players" created, when Wikidata gave no career. */
export function newPlayerNoCareerText(playerName: string | undefined, several: boolean): string {
  const who = playerName?.trim();
  return several && who
    ? `New player ${who}, no career from Wikidata`
    : "New player, no career from Wikidata";
}

/** The Q1-A purple note on a card whose team the commit filled in. */
export function teamFillText(reason: "otherCards" | "career"): string {
  return reason === "career"
    ? "Team filled from the player's career"
    : "Team filled from the player's other cards";
}

/** "2011–2018", "2024–" or "" for a stint with no years. An open stint reads "2024–". */
export function stintYears(stint: { fromYear?: number; toYear?: number }): string {
  if (stint.fromYear === undefined) return "";
  if (stint.toYear === undefined) return `${stint.fromYear}–`;
  if (stint.toYear === stint.fromYear) return `${stint.fromYear}`;
  return `${stint.fromYear}–${stint.toYear}`;
}

/**
 * NEO-602 — why a name the New Team form would create is refused, in the words
 * `teams.assertNameNotAnotherTeamsAlias` throws. Same `eraOverlapReason` as the
 * server, so the pre-check and the refusal cannot drift.
 */
export function aliasHolderSentence(
  holder: { name: string; yearsActive?: { from: number; to?: number } },
  draftYears: { from: number; to?: number } | undefined,
): string {
  const label = teamOptionLabel(holder.name, holder.yearsActive);
  return sharedAliasHolderSentence(label, eraOverlapReason(draftYears, holder.yearsActive));
}

// ── The "no team" chips (ported from MissingTeamFixer, NEO-330 / NEO-345) ──

/**
 * "Jimmie Foxx played here" / "Johnny Bench & Pete Rose played here": the
 * provenance a chip carries. Full names, never a derived surname.
 */
export function playedHere(playerNames: string[]): string {
  const names =
    playerNames.length <= 2
      ? playerNames.join(" & ")
      : `${playerNames.slice(0, -1).join(", ")} & ${playerNames[playerNames.length - 1]}`;
  return `${names} played here`;
}

/**
 * The line over the listing's chips. Never names the marketplace: "the
 * listing" (Jason, 2026-10-11).
 */
export function marketplaceHeading(listingName: string, rowCount: number, agreed: boolean): string {
  if (agreed) return `The listing names “${listingName}” and the career agrees.`;
  if (rowCount > 1) {
    return `The listing names “${listingName}”, and ${rowCount} teams share that name. Pick the one on the card.`;
  }
  return `The listing names “${listingName}”. Pick it if it matches the card.`;
}

/** The card's case, from the background team check's recorded outcome. */
export function outcomeHeading(outcome: TeamCheckOutcome | undefined, hasHint: boolean): string | null {
  if (outcome === "checklist" && !hasHint) {
    return "The official checklist skips the team on this one. Pick the one on the card, or say there isn't one.";
  }
  if (outcome === "gaveUp") {
    return "We couldn't get a team from the listing for this card. Pick the one on the card.";
  }
  if (outcome === "answered" && !hasHint) {
    return "The listing has no team for this card. Pick the one on the card, or say there isn't one.";
  }
  return null;
}

/**
 * What else decides the line over the career chips (NEO-639).
 *
 *  - `tie`: a player's window holds more than one team and no rule breaks the
 *    tie, so nothing is preselected;
 *  - `setNoTeam`: the set's own team default is "No Team", so a career team is
 *    offered and never preselected over the set's answer.
 */
export type CareerHeadingFacts = { tie?: boolean; setNoTeam?: boolean };

/**
 * The line over the career chips. Precedence, first that holds: the whole
 * career because no stint covers the year, a tie in the window, no year at
 * all; then, for a team that is in the window, the listing disagreeing, the
 * set's No Team, and last the plain "Suggested". Each line promises only what
 * the tile does.
 */
export function careerHeading(
  inSetYear: boolean,
  listingDisagrees: boolean,
  uncoveredSetYear?: number,
  facts: CareerHeadingFacts = {},
): string {
  if (!inSetYear) {
    if (uncoveredSetYear !== undefined) {
      return `No ${uncoveredSetYear} team on file. Here's the whole career, so pick the one on the card.`;
    }
    if (facts.tie) {
      return "From the career. More than one team that season, so pick the one on the card.";
    }
    return "No year on this set. Here's the whole career, so pick the one on the card.";
  }
  if (listingDisagrees) {
    return "From the career. The listing names a different team, so pick the one on the card.";
  }
  if (facts.setNoTeam) {
    return "From the career. This set says No Team, so pick one only if it's on the card.";
  }
  return "Suggested from career history.";
}

/**
 * NEO-639 — one player's years with one team, as a chip prints them. Several
 * stints at the team merge where they overlap or touch ("2015–2017" and
 * "2018–2019" read "2015–2019"), oldest first, separate spans joined ", ". Each
 * span reads as `stintYears` does: "2024–" when open, "2026" for one season. An
 * undated stint prints nothing; an end before its start (bad data) reads as the
 * years between the two, never as nothing.
 */
export function mergedStintYears(stints: ReadonlyArray<{ fromYear?: number; toYear?: number }>): string {
  const spans: Array<{ from: number; to: number }> = [];
  for (const s of stints) {
    if (s.fromYear === undefined || !Number.isFinite(s.fromYear)) continue;
    if (s.toYear !== undefined && !Number.isFinite(s.toYear)) continue;
    spans.push(
      s.toYear === undefined
        ? { from: s.fromYear, to: Number.POSITIVE_INFINITY }
        : { from: Math.min(s.fromYear, s.toYear), to: Math.max(s.fromYear, s.toYear) },
    );
  }
  spans.sort((a, b) => a.from - b.from || a.to - b.to);
  const merged: Array<{ from: number; to: number }> = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span.from <= last.to + 1) last.to = Math.max(last.to, span.to);
    else merged.push({ ...span });
  }
  return merged
    .map(({ from, to }) =>
      stintYears({ fromYear: from, ...(to === Number.POSITIVE_INFINITY ? {} : { toYear: to }) }),
    )
    .join(", ");
}

// ── The Career tile (ported from career-check.ts, NEO-591) ──

/**
 * "No San Diego Padres in the career by 2024." With no year known yet it drops
 * the clause rather than guess one, so it is never wrong text.
 */
export function noStintText(team: string | undefined, year: number | undefined): string {
  const who = team ?? "This team";
  if (year === undefined) return team ? `No ${who} in the career.` : "This team isn't in the career.";
  return team ? `No ${who} in the career by ${year}.` : `This team isn't in the career by ${year}.`;
}

/** A player with no stints at all: there is nothing to compare the team with. */
export const NO_CAREER_TEXT = "No career on file yet.";

/** "San Diego Padres · 2024–", "Missions · 2023": a stint as its line reads. */
export function careerLineText(name: string, fromYear: number | undefined, toYear: number | undefined): string {
  const years = stintYears({ fromYear, toYear });
  return years ? `${name} · ${years}` : name;
}
