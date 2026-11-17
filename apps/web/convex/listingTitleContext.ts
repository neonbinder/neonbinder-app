/**
 * NEO-335 — the server half of the wizard's pre-save "Card titles" step.
 *
 * The step titles cards that are not rows yet, in the browser, with the same
 * pure code the insert uses (`features/listingInputs.ts`). What the browser
 * cannot work out for itself is the set's facts and the CANONICAL names behind
 * the printed ones — the title says "Dwight Gooden", not the "Doc Gooden" a
 * card prints. This module assembles that `TitleContext`, once, and
 * `resolveChecklistEntities` hands it back beside the unknown names, so the
 * wizard opens with everything it needs and makes no second round trip.
 *
 * ## The set facts mirror the commit prelude, not `findAncestorLabels`
 *
 * `commitCardChecklistPrelude` is what the insert's titles are actually built
 * from: the leaf's own `features` snapshot, the NEAREST `setName` ancestor's
 * value, that set's parent manufacturer ROLE (NEO-272), the sport row's value,
 * the chain's insert role, parallel leaf and short name (NEO-335,
 * `listingShortName.titleChainFacts`), (NEO-277, in the chunk) the leaf's
 * set-level teams, and (NEO-528 round 3, in the chunk) the leaf's default
 * player ("Player on every card"). `titleSetFacts`
 * reads exactly those, the same way, so a title shown before save is the
 * title written at insert.
 *
 * ## The names come from the resolve gate itself
 *
 * `resolveUnknownsAndStartBatch` already asks, for every printed name, "does
 * this resolve to one NB row?" — it is the gate that decides which names reach
 * the wizard at all. It records the ids it resolved, and this module turns
 * them into names. No second resolution, so the context can never claim a
 * name resolved that the gate sent to the wizard, or the reverse.
 */

import { internalQuery, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { teamDefaultOf } from "./lib/selectorTeams";
import { teamFullName } from "../lib/teams/team-name";
import type { TitleContext } from "./features/listingInputs";
import { normalizePlayerName } from "./players";
import { normalizeTeamName } from "./teams";
import { deriveCareerPairs } from "./lib/careerCoverage";
import { COVERAGE_PAIRS_PER_INTERNAL_READ } from "./careerCoverage";
import { titleChainFacts, titleChainFactsFields } from "./listingShortName";
import { effectiveCardPlayerDefaults } from "./cardPlayersBulk";

/** Player ids read per `playerNamesByIds` call: one transaction's budget. */
export const TITLE_CONTEXT_PLAYER_PAGE = 200;

/** Depth cap on the ancestor walk, as the prelude's sibling walks have. */
const MAX_ANCESTOR_DEPTH = 16;

const nameMapValidator = v.array(v.object({ printed: v.string(), name: v.string() }));

/** The wire shape of `TitleContext`. */
export const titleContextValidator = v.object({
  sportValue: v.string(),
  setNameValue: v.optional(v.string()),
  manufacturerBrandUnknown: v.optional(v.boolean()),
  inheritedFeatures: v.optional(v.record(v.string(), v.string())),
  // NEO-335 — the insert role, a parallel leaf, the nearest short name.
  ...titleChainFactsFields,
  setTeamNames: v.array(v.string()),
  // NEO-528 round 3 — optional on the wire: an older server sends none.
  setPlayerNames: v.optional(v.array(v.string())),
  setPlayerId: v.optional(v.id("players")),
  // NEO-528 + NEO-535 — the default cameos a new card is born with.
  setCameoNames: v.optional(v.array(v.string())),
  players: nameMapValidator,
  teams: nameMapValidator,
});

const setFactsValidator = v.object({
  sportValue: v.string(),
  setNameValue: v.optional(v.string()),
  manufacturerBrandUnknown: v.optional(v.boolean()),
  inheritedFeatures: v.optional(v.record(v.string(), v.string())),
  ...titleChainFactsFields,
  setTeamNames: v.array(v.string()),
  setPlayerNames: v.optional(v.array(v.string())),
  setPlayerId: v.optional(v.id("players")),
  // NEO-528 + NEO-535 — the default cameos a new card is born with.
  setCameoNames: v.optional(v.array(v.string())),
});

/**
 * The set-level facts a new card's title reads — see the module note for why
 * these mirror `commitCardChecklistPrelude` line for line.
 *
 * Internal: it trusts its arguments. `resolveChecklistEntities` calls it after
 * `requireAdmin` and after proving `sportId` is the leaf's own sport.
 */
export const titleSetFacts = internalQuery({
  args: {
    selectorOptionId: v.id("selectorOptions"),
    sportId: v.id("selectorOptions"),
  },
  returns: setFactsValidator,
  handler: async (ctx, args) => {
    const leaf = await ctx.db.get(args.selectorOptionId);
    const inheritedFeatures =
      leaf?.features && Object.keys(leaf.features).length > 0 ? leaf.features : undefined;

    let setNameNode: Doc<"selectorOptions"> | null =
      leaf?.level === "setName" ? leaf : null;
    // NEO-335 — the rows walked, leaf first up to the setName row, for the
    // title's chain facts; the prelude reads the same rows the same way.
    const titleChain: Array<Doc<"selectorOptions"> | null> = [leaf];
    let cursorId: Id<"selectorOptions"> | undefined = setNameNode ? undefined : leaf?.parentId;
    let depth = 0;
    while (!setNameNode && cursorId && depth < MAX_ANCESTOR_DEPTH) {
      const node: Doc<"selectorOptions"> | null = await ctx.db.get(cursorId);
      if (!node) break;
      titleChain.push(node);
      if (node.level === "setName") setNameNode = node;
      cursorId = node.parentId;
      depth += 1;
    }
    const manufacturerNode = setNameNode?.parentId
      ? await ctx.db.get(setNameNode.parentId)
      : null;
    const manufacturerBrandUnknown =
      manufacturerNode?.level === "manufacturer"
        ? manufacturerNode.metadata?.isBrandUnknown === true
        : undefined;

    const sportRow = await ctx.db.get(args.sportId);

    // NEO-277 — a new card with no team of its own is born with these.
    // NEO-556 — a No Team leaf names none: a stamped card's title carries no
    // team, exactly as a teamless one's does.
    const setTeamNames: string[] = [];
    const leafDefault = teamDefaultOf(leaf);
    // Not sliced: the chunk reads the whole list, and this must match it.
    for (const teamId of leafDefault.kind === "teams" ? leafDefault.teamIds : []) {
      const team = await ctx.db.get(teamId);
      if (team) setTeamNames.push(teamFullName(team));
    }

    // NEO-528 round 3 — "Player on every card": the player a new card with
    // no player of its own (none resolved, no name waiting for review) is
    // born with, by the same lookup the commit chunk makes. The title names
    // them, and (NEO-535 merge) the cameos below, while there is room. The id rides along so the checklist
    // can tell which rows the default covers; nothing writes it from here.
    const setPlayerNames: string[] = [];
    let setPlayerId: Id<"players"> | undefined;
    const setCameoNames: string[] = [];
    if (leaf) {
      const defaults = await effectiveCardPlayerDefaults(ctx, leaf._id, { sportId: args.sportId });
      if (defaults.player) {
        setPlayerNames.push(defaults.player.name);
        setPlayerId = defaults.player._id;
      }
      // NEO-528 + NEO-535 — and the cameos it is born with: the title names
      // them while it has room (the first meaningful thing it drops).
      for (const cameo of defaults.cameos) setCameoNames.push(cameo.name);
    }

    return {
      sportValue: sportRow?.value ?? "",
      ...(setNameNode?.value !== undefined ? { setNameValue: setNameNode.value } : {}),
      ...(manufacturerBrandUnknown !== undefined ? { manufacturerBrandUnknown } : {}),
      ...(inheritedFeatures ? { inheritedFeatures } : {}),
      ...titleChainFacts(titleChain),
      setTeamNames,
      setPlayerNames,
      ...(setPlayerId ? { setPlayerId } : {}),
      ...(setCameoNames.length > 0 ? { setCameoNames } : {}),
    };
  },
});

/**
 * Canonical names for player ids the resolve gate resolved. Bounded per call;
 * the caller pages. A dangling id is skipped — the card will not carry it.
 */
export const playerNamesByIds = internalQuery({
  args: { ids: v.array(v.id("players")) },
  returns: v.array(v.object({ id: v.id("players"), name: v.string() })),
  handler: async (ctx, args) => {
    if (args.ids.length > TITLE_CONTEXT_PLAYER_PAGE) {
      throw new Error(
        `playerNamesByIds: ${args.ids.length} ids exceeds the ${TITLE_CONTEXT_PLAYER_PAGE}-id page`,
      );
    }
    const out: Array<{ id: Id<"players">; name: string }> = [];
    for (const id of args.ids) {
      const player = await ctx.db.get(id);
      if (player) out.push({ id, name: player.name });
    }
    return out;
  },
});

/**
 * What the resolve gate learned about each printed name, keyed by the SAME
 * normalisation it looked them up under (`normalizePlayerName` /
 * `normalizeTeamName`). Filled by `resolveUnknownsAndStartBatch`.
 */
export type ResolvedNames = {
  playerIdByNorm: Map<string, Id<"players">>;
  teamNameByNorm: Map<string, string>;
  /**
   * NEO-574 — the NB team each resolved team spelling answered to, beside
   * `teamNameByNorm` and set at the same places, for the career check.
   */
  teamIdByNorm: Map<string, Id<"teams">>;
  /** NEO-574 — the set's year as the gate found it; absent when the set has none. */
  setYear?: number;
};

export function emptyResolvedNames(): ResolvedNames {
  return {
    playerIdByNorm: new Map(),
    teamNameByNorm: new Map(),
    teamIdByNorm: new Map(),
  };
}

/**
 * Assemble the `TitleContext` for the confirmed cards: the set facts, then
 * every printed player/team spelling on the cards that the gate resolved,
 * with its canonical name. Spellings are listed verbatim (trimmed) so the
 * browser looks a card's own string up without re-implementing the
 * normaliser.
 */
export async function buildTitleContext(
  ctx: ActionCtx,
  args: {
    selectorOptionId: Id<"selectorOptions">;
    sportId: Id<"selectorOptions">;
    cards: ReadonlyArray<{ players?: string[]; teams?: string[]; team?: string }>;
    resolved: ResolvedNames;
  },
): Promise<TitleContext> {
  type SetFacts = Omit<TitleContext, "players" | "teams">;
  const facts: SetFacts = await ctx.runQuery(internal.listingTitleContext.titleSetFacts, {
    selectorOptionId: args.selectorOptionId,
    sportId: args.sportId,
  });

  const ids = Array.from(new Set(args.resolved.playerIdByNorm.values()));
  const nameById = new Map<string, string>();
  for (let i = 0; i < ids.length; i += TITLE_CONTEXT_PLAYER_PAGE) {
    const page: Array<{ id: Id<"players">; name: string }> = await ctx.runQuery(
      internal.listingTitleContext.playerNamesByIds,
      {
        ids: ids.slice(i, i + TITLE_CONTEXT_PLAYER_PAGE),
      },
    );
    for (const { id, name } of page) nameById.set(id, name);
  }

  const players = new Map<string, string>();
  const teams = new Map<string, string>();
  for (const card of args.cards) {
    for (const raw of card.players ?? []) {
      const printed = raw.trim();
      if (!printed || players.has(printed)) continue;
      const id = args.resolved.playerIdByNorm.get(normalizePlayerName(printed));
      const name = id ? nameById.get(id) : undefined;
      if (name) players.set(printed, name);
    }
    const printedTeams = (card.teams ?? []).map((t) => t.trim()).filter(Boolean);
    if (printedTeams.length === 0 && card.team?.trim()) printedTeams.push(card.team.trim());
    for (const printed of printedTeams) {
      if (teams.has(printed)) continue;
      const name = args.resolved.teamNameByNorm.get(normalizeTeamName(printed));
      if (name) teams.set(printed, name);
    }
  }

  return {
    ...facts,
    players: Array.from(players, ([printed, name]) => ({ printed, name })),
    teams: Array.from(teams, ([printed, name]) => ({ printed, name })),
  };
}

/** NEO-574 — the wire shape of `CareerContext`. */
export const careerContextValidator = v.object({
  setYear: v.optional(v.number()),
  players: v.array(v.object({ printed: v.string(), playerId: v.id("players") })),
  teams: v.array(v.object({ printed: v.string(), teamId: v.id("teams") })),
  gaps: v.array(
    v.object({ teamId: v.id("teams"), playerIds: v.array(v.id("players")) }),
  ),
});

/**
 * NEO-574 — what the wizard's "career check" step starts from: which printed
 * names the gate resolved to existing players and to NB teams, and which
 * (team, players) the players' careers do not cover as of the set's year.
 */
export type CareerContext = {
  setYear?: number;
  players: Array<{ printed: string; playerId: Id<"players"> }>;
  teams: Array<{ printed: string; teamId: Id<"teams"> }>;
  gaps: Array<{ teamId: Id<"teams">; playerIds: Array<Id<"players">> }>;
};

/**
 * NEO-574 — assemble the `CareerContext` for the confirmed cards, from the
 * gate's own answers (the same `ResolvedNames` the title context reads, so the
 * two can never disagree about which names resolved).
 *
 * `gaps` is computed over EVERY card passed (the gate does not know which
 * already exist as rows) but only for single-player cards whose player and
 * team both resolved: the pairs `deriveCareerPairs` would list for a save that
 * creates every card. The wizard intersects it with its own pairs. Coverage is
 * read through `careerCoverage.coverageForPairs` in slices of
 * `COVERAGE_PAIRS_PER_INTERNAL_READ`, so no transaction reads the whole set.
 * With no set year there is nothing to compare against: no gaps.
 */
export async function buildCareerContext(
  ctx: ActionCtx,
  args: {
    sportId: Id<"selectorOptions">;
    cards: ReadonlyArray<{
      cardNumber: string;
      players?: string[];
      teams?: string[];
      team?: string;
      teamIds?: ReadonlyArray<Id<"teams">>;
      checklistConflict?: {
        players?: { marketplace: string[]; checklist: string[] };
        teams?: { marketplace: string[]; checklist: string[] };
      };
    }>;
    resolved: ResolvedNames;
  },
): Promise<CareerContext> {
  const { resolved } = args;
  // A card the operator's publisher checklist disagrees with is settled in the
  // wizard, and EITHER side can become the card. The card as sent carries the
  // marketplace's side; the checklist's side is a second card the operator
  // may choose, and it is checked all the same: a card behaves the same
  // whichever source its names came from (product invariant 6). The settle
  // is the wizard's `applyChecklistChoice`: one side for every part in
  // dispute. A gap on a side nobody picks is harmless (the wizard reads only
  // the pairs of the cards it ends up with).
  const cards = args.cards.flatMap((card) => {
    const conflict = card.checklistConflict;
    if (!conflict || (!conflict.players && !conflict.teams)) return [card];
    const settled = { ...card };
    delete settled.checklistConflict;
    if (conflict.players) settled.players = [...conflict.players.checklist];
    if (conflict.teams) {
      settled.teams = [...conflict.teams.checklist];
      delete settled.team;
    }
    return [card, settled];
  });
  const players = new Map<string, Id<"players">>();
  const teams = new Map<string, Id<"teams">>();
  for (const card of cards) {
    for (const raw of card.players ?? []) {
      const printed = raw.trim();
      if (!printed || players.has(printed)) continue;
      const id = resolved.playerIdByNorm.get(normalizePlayerName(printed));
      if (id) players.set(printed, id);
    }
    const printedTeams = (card.teams ?? []).map((t) => t.trim()).filter(Boolean);
    if (printedTeams.length === 0 && card.team?.trim()) printedTeams.push(card.team.trim());
    for (const printed of printedTeams) {
      if (teams.has(printed)) continue;
      const id = resolved.teamIdByNorm.get(normalizeTeamName(printed));
      if (id) teams.set(printed, id);
    }
  }
  const context: CareerContext = {
    ...(resolved.setYear !== undefined ? { setYear: resolved.setYear } : {}),
    players: Array.from(players, ([printed, playerId]) => ({ printed, playerId })),
    teams: Array.from(teams, ([printed, teamId]) => ({ printed, teamId })),
    gaps: [],
  };
  if (resolved.setYear === undefined) return context;

  const pairs = deriveCareerPairs({
    cards,
    setYear: resolved.setYear,
    playerIdFor: (printed) => players.get(printed),
    teamFor: (printed) => {
      const teamId = teams.get(printed);
      return teamId ? { teamId } : undefined;
    },
  });
  const pairArgs = pairs.flatMap((pair) =>
    pair.teamId
      ? [{ playerId: pair.playerId as Id<"players">, teamId: pair.teamId as Id<"teams"> }]
      : [],
  );
  const uncoveredByTeam = new Map<string, Array<Id<"players">>>();
  for (let i = 0; i < pairArgs.length; i += COVERAGE_PAIRS_PER_INTERNAL_READ) {
    const results: Array<{ playerId: Id<"players">; teamId?: Id<"teams">; covered: boolean }> =
      await ctx.runQuery(internal.careerCoverage.coverageForPairs, {
        sportId: args.sportId,
        setYear: resolved.setYear,
        pairs: pairArgs.slice(i, i + COVERAGE_PAIRS_PER_INTERNAL_READ),
      });
    for (const r of results) {
      if (r.covered || !r.teamId) continue;
      const list = uncoveredByTeam.get(r.teamId as string) ?? [];
      if (!list.includes(r.playerId)) list.push(r.playerId);
      uncoveredByTeam.set(r.teamId as string, list);
    }
  }
  context.gaps = Array.from(uncoveredByTeam, ([teamId, playerIds]) => ({
    teamId: teamId as Id<"teams">,
    playerIds,
  }));
  return context;
}
