/**
 * NEO-645 — moved out of `selectorOptions.ts` so `tidyNames.answerName` (which
 * writes the alias at answer time, NEO-284) and the commit prelude share the
 * one implementation without `tidyNames` importing the 27k-line module.
 */

import type { MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import {
  MAX_TEAM_ALIASES,
  MAX_TEAM_ALIAS_LENGTH,
  dropAliasesThatArePrimaryNames,
  normalizeTeamAliasList,
  normalizeTeamName,
  syncTeamAliases,
} from "./teams";
import { teamFullName } from "../lib/teams/team-name";

/**
 * Add the strings `names` to the team's aliases, when it does not already
 * answer to them. The one alias writer behind "Remember … as a name for this
 * team": the entity-review prelude (a step the operator linked) calls it, so
 * the caps and the guard against another team's primary name live in one place.
 *
 * Non-throwing by design: there is no operator in the loop and losing one
 * alias must not abort a commit. A string over `MAX_TEAM_ALIAS_LENGTH`, a team
 * already at `MAX_TEAM_ALIASES`, and a string that is another team's primary
 * name in this sport whose years overlap the team's (NEO-602) are each logged
 * (lengths and ids, never the string) and skipped; the link itself lands.
 */
export async function rememberAliasesOnTeam(
  ctx: MutationCtx,
  linked: Doc<"teams">,
  names: readonly string[],
  caller: string,
): Promise<void> {
  const held = linked.aliases ?? [];
  // Keys the team already answers to: its full name and every alias.
  // `nameNormalized` IS `normalizeTeamName(teamFullName(row))` by
  // construction (convex/lib/teamRow.ts), so it stands in for the name.
  const answersTo = new Set<string>([
    linked.nameNormalized,
    ...held.map((a) => normalizeTeamName(a)),
  ]);
  const additions: string[] = [];
  for (const name of names) {
    const trimmed = name.trim();
    const key = normalizeTeamName(trimmed);
    if (!key || answersTo.has(key)) continue;
    if (trimmed.length > MAX_TEAM_ALIAS_LENGTH) {
      // Length, never the string: this reaches Sentry and the console.
      console.warn(
        `${caller}: a saveAsAlias string is ${trimmed.length} characters; the limit is ${MAX_TEAM_ALIAS_LENGTH}. Linked, not remembered.`,
      );
      continue;
    }
    if (held.length + additions.length >= MAX_TEAM_ALIASES) {
      console.warn(
        `${caller}: team ${linked._id} already holds ${MAX_TEAM_ALIASES} aliases. Linked, not remembered.`,
      );
      continue;
    }
    answersTo.add(key);
    additions.push(trimmed);
  }
  if (additions.length === 0) return;
  // NEO-284 security audit / NEO-602 — a string that is another team's
  // PRIMARY name in this sport is not remembered when the two teams' years
  // overlap, or either has none (undated cannot be told apart from
  // overlapping): stored as an alias it would lock that team out of its
  // own edits (NAME_TAKEN on every save) and share the string over the
  // same seasons. A disjoint era may be worn as an alias — the card's
  // players, else the set year, say which team a printed name means.
  // Warn-and-skip, like the caps above; the link itself still lands.
  // `selfId` so the linked team's own name is not a clash, `selfYears` so
  // its era is the one compared.
  const { aliases: safeAdditions, dropped } = await dropAliasesThatArePrimaryNames(ctx, {
    sportId: linked.sportId,
    aliases: additions,
    selfId: linked._id,
    ...(linked.yearsActive ? { selfYears: linked.yearsActive } : {}),
  });
  for (const { teamName } of dropped) {
    // The owning team's display name only — never the parked string.
    console.warn(
      `${caller}: a saveAsAlias string is ${teamName}'s own name. Linked, not remembered.`,
    );
  }
  if (safeAdditions.length === 0) return;
  // Through the same helper every other writer uses, against the team's
  // own composed name, so the stored list obeys the one contract. The
  // inputs are inside the caps by the checks above, so this cannot throw.
  const aliases = normalizeTeamAliasList(
    [...held, ...safeAdditions],
    teamFullName(linked),
  );
  await ctx.db.patch(linked._id, { aliases, lastUpdated: Date.now() });
  await syncTeamAliases(ctx, { teamId: linked._id, sportId: linked.sportId, aliases });
}
