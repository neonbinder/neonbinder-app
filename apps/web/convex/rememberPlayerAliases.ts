/**
 * NEO-671 — "Remember “X” as a name for this player", the player twin of
 * `rememberTeamAliases.ts`. `tidyNames.answerName` calls it when the operator
 * links a printed name to an existing player under another spelling
 * ("Josh Kuroda-Grauer" → "Joshua Kuroda-Grauer") and leaves the box checked.
 */

import type { MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import {
  additionalSportIds,
  MAX_PLAYER_ALIASES,
  MAX_PLAYER_ALIAS_LENGTH,
  normalizePlayerAliasList,
  normalizePlayerName,
  sameNamePlayers,
  syncPlayerAliases,
} from "./players";

/**
 * Add the strings `names` to the player's aliases, when they do not already
 * answer to them. Non-throwing, like the team writer: there is no operator in
 * the loop and losing one alias must not undo the link. A string equal to the
 * player's own name (after normalising), one they already hold, one over
 * `MAX_PLAYER_ALIAS_LENGTH`, a player already at `MAX_PLAYER_ALIASES`, and a
 * string that is another player's PRIMARY name in any sport the alias will be
 * indexed in (home plus the player's added sports) are each skipped
 * (logged by length and id, never the string); the link itself lands.
 *
 * An alias another player holds as an ALIAS is allowed (NEO-254: both Griffeys
 * answer to "Ken Griffey"), exactly as the team side allows a shared alias.
 */
export async function rememberAliasesOnPlayer(
  ctx: MutationCtx,
  linked: Doc<"players">,
  names: readonly string[],
  caller: string,
): Promise<void> {
  const held = linked.aliases ?? [];
  const answersTo = new Set<string>([
    linked.nameNormalized,
    ...held.map((a) => normalizePlayerName(a)),
  ]);
  const additions: string[] = [];
  const sportIds = [linked.sportId, ...(await additionalSportIds(ctx, linked._id))];
  for (const name of names) {
    const trimmed = name.trim();
    const key = normalizePlayerName(trimmed);
    if (!key || answersTo.has(key)) continue;
    if (trimmed.length > MAX_PLAYER_ALIAS_LENGTH) {
      // Length, never the string: this reaches Sentry and the console.
      console.warn(
        `${caller}: a saveAsAlias string is ${trimmed.length} characters; the limit is ${MAX_PLAYER_ALIAS_LENGTH}. Linked, not remembered.`,
      );
      continue;
    }
    if (held.length + additions.length >= MAX_PLAYER_ALIASES) {
      console.warn(
        `${caller}: player ${linked._id} already holds ${MAX_PLAYER_ALIASES} aliases. Linked, not remembered.`,
      );
      continue;
    }
    // Another player's primary name in any sport the alias will be indexed in
    // (home plus added sports, read now so a sport `addSetSport` just added
    // counts): stored as an alias it would make the name answer to two people
    // the operator never asked about. Primary-name hits only, through either
    // leg (`players`, or `playerSports`' name leg); another player's ALIAS hit
    // does not stop it.
    let owner: Doc<"players"> | undefined;
    for (const sportId of sportIds) {
      owner = (await sameNamePlayers(ctx, key, sportId)).find(
        (p) => p.nameNormalized === key && p._id !== linked._id,
      );
      if (owner) break;
    }
    if (owner) {
      console.warn(
        `${caller}: a saveAsAlias string is player ${owner._id}'s own name. Linked, not remembered.`,
      );
      continue;
    }
    answersTo.add(key);
    additions.push(trimmed);
  }
  if (additions.length === 0) return;
  // Through the one list normaliser every other writer uses; the inputs are
  // inside the caps by the checks above, so this cannot throw.
  const aliases = normalizePlayerAliasList([...held, ...additions], linked.name);
  await ctx.db.patch(linked._id, { aliases, lastUpdated: Date.now() });
  await syncPlayerAliases(ctx, { playerId: linked._id, aliases });
}
