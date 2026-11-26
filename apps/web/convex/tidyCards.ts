/**
 * NEO-645 / NEO-656 — the card-level writes and the one subscribed read of
 * One-card Tidy Up. The name answers live in `tidyNames.ts`; the career write is
 * `players.addStint`.
 *
 *   - `cardContext`            REAL. One card's names, players, teams: the walk's
 *                              only per-card subscription besides `getCardChecklist`.
 *   - `saveCard`               REAL. Save & next: refuses while pink remains, and
 *                              adds the default stint for the career gaps shown.
 *   - `pickSourceValue`        Sources disagree: use one value (this card, or the
 *                              cards with the same disagreement).
 *   - `applyTeamToPlayerCards` "Apply to all" on the Team tile: the answer goes to its line.
 *   - `applyVariation`         Apply a corrected variation to the cards that share it.
 *   - `applySetNameToTitles`   "Shorten the set name for every card".
 *
 * NEO-656 (Jason: "it should read real data and display pink/blue as
 * appropriate depending on the current state of the data"): nothing is stored
 * about what the operator has seen or checked. Blue is read live from the data
 * (`careerCoverage.careerGaps`), and a card keeps only its result.
 *
 * ## Conventions every mutation here follows
 *
 *  - `requireAdmin` first.
 *  - Every string and array argument is capped; an over-cap argument is a
 *    `ConvexError` naming the LIMIT, never the value.
 *  - A marketplace name never appears in an error message.
 *  - A bulk call (`cardIds`, at most `MAX_APPLY_CARDS`) is checked per card on
 *    the server: the client's belief that cards "have the same disagreement" is
 *    never trusted. The open card is written in the call; the rest are written
 *    by scheduled 50-card pages (a call that wrote 100 cards inline would be
 *    about 1,500 operations).
 *  - Writes that change `playerIds`, `teamOnCardIds`, a title or a variation
 *    bump `lastUpdated` (the NEO-203 baseVersion): content really changed under
 *    an open review. A pick that only removes its disagreement never does.
 */

import { ConvexError, v, type Infer } from "convex/values";
import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { requireAdmin } from "./auth";
import { tidyNameKindValidator } from "./tidyNames";
import {
  MAX_CARD_PLAYERS,
  MAX_CARD_TEAMS,
  deriveCardAttention,
} from "./features/cardAttention";
import { normalizeEntityName } from "../lib/entities/normalize-name";
import { teamFullName } from "../lib/teams/team-name";
import {
  applyPickToCard,
  cleanPickNames,
  entryFor,
  entryFromOffered,
  sameDisagreement,
  sameValue,
  sameValueSets,
} from "./tidyPickSource";
import {
  newNameWriteCache,
  nameFieldsOf,
  regenerateTitleFields,
  writeNameChange,
  type NameWriteCache,
} from "./tidyCardWrites";
import { findSetYearForSelectorOption } from "./lib/selectorAncestry";
import { hasTeamLine, isTeamlessOnLine, teamLineKey } from "./lib/teamLine";
import { defaultGapStint } from "./lib/careerGapStint";
import { computeCoverage } from "./lib/careerCoverageFacts";
import { appendCareerStintsImpl } from "./players";
import { assertCareerStintYears, maxCareerYear } from "../lib/players/career-years";
import { queueRetitledCardNow } from "./listingTitleRequeue";
import { cameoOfferFor, cameoOfferValidator } from "./tidyCameo";
import { listingInputsForStoredCard } from "./storedCardTitle";
import { retitleForSetName } from "./features/setNameInTitles";
import { LISTING_SHORT_NAME_LEVELS, normalizeListingShortName } from "./listingShortName";

/** The most cards one bulk apply can name. */
export const MAX_APPLY_CARDS = 100;
/** Cards of one page of a scheduled bulk apply. */
export const APPLY_PAGE_SIZE = 50;
/** A source value's longest name, and the most names in one value. */
export const MAX_PICK_NAME_LENGTH = 120;
export const MAX_PICK_NAMES = 20;
/** `cardContext` bounds (NEO-392: a subscribed query stays small). */
export const CONTEXT_MAX_PLAYERS = 4;
export const CONTEXT_MAX_STINTS_PER_PLAYER = 32;
export const CONTEXT_MAX_TEAMS = 16;

// ─── cardContext ────────────────────────────────────────────────────────────

/**
 * One name the open card prints, read from the card itself (NEO-656): a player
 * already linked (`playerLinks.nameOnCard`), a player name still waiting
 * (`pendingPlayerNames`) or a team name still waiting (`pendingTeamNames`). A
 * linked team has no name here: a team link keeps no printed spelling.
 */
export const contextNameValidator = v.object({
  kind: tidyNameKindValidator,
  nameNormalized: v.string(),
  /** This card's own spelling. */
  printed: v.string(),
  /**
   * Position among the card's printed names of this kind: linked players first
   * in link order, then waiting ones after them.
   */
  order: v.number(),
  /** Still waiting for an answer; false once linked. */
  pending: v.boolean(),
  /** The linked player, when `pending` is false. */
  playerId: v.optional(v.id("players")),
});

export const contextPlayerValidator = v.object({
  playerId: v.id("players"),
  name: v.string(),
  /** The name this card printed for the player, when it differs from `name`. */
  nameOnCard: v.optional(v.string()),
  birthYear: v.optional(v.number()),
  isHallOfFame: v.optional(v.boolean()),
  sportId: v.id("selectorOptions"),
  stints: v.array(
    v.object({
      teamId: v.id("teams"),
      teamName: v.string(),
      fromYear: v.optional(v.number()),
      toYear: v.optional(v.number()),
    }),
  ),
  /** The player has more stints than `stints` holds. */
  stintsMore: v.boolean(),
});

export const contextTeamValidator = v.object({
  teamId: v.id("teams"),
  /** Full name, "San Diego Padres". */
  name: v.string(),
  /** The card carries this team. */
  onCard: v.boolean(),
  /** The walk named this team as a candidate (`candidateTeamIds`, NEO-602). */
  candidate: v.boolean(),
});

export const cardContextValidator = v.object({
  cardId: v.id("cardChecklist"),
  names: v.array(contextNameValidator),
  players: v.array(contextPlayerValidator),
  /** The card links more players than `players` holds. */
  playersMore: v.boolean(),
  /**
   * The players PICTURED on the card ("Also on this card", NEO-528
   * `secondaryPlayerIds`), name only: the Player tile lists them as cameo rows.
   * At most `MAX_CARD_PLAYERS`; one the catalogue no longer has is left out.
   */
  cameos: v.array(v.object({ playerId: v.id("players"), name: v.string() })),
  teams: v.array(contextTeamValidator),
  /**
   * NEO-645 T3: the "Lindor as a cameo" shortcut the Sources disagree tile may
   * offer (`tidyCameo.cameoOfferFor`); absent when it is not on offer.
   */
  cameoOffer: v.optional(cameoOfferValidator),
});

/**
 * Everything the open card's tiles need beyond the card row itself. REAL.
 *
 * Subscribed only while the walk is open (NEO-392). The reads are bounded and
 * the result is small by construction:
 *
 *  - the card, and its names (read off the card: no other document);
 *  - at most `CONTEXT_MAX_PLAYERS` linked players and, for each, at most
 *    `CONTEXT_MAX_STINTS_PER_PLAYER` stints (team names cached per call);
 *  - the card's teams plus the walk's `candidateTeamIds`, at most
 *    `CONTEXT_MAX_TEAMS`.
 *
 * Target: under 150 documents. It re-runs on the open card's own writes.
 *
 * `candidateTeamIds` are the rows a team name reached (the walk holds them from
 * `tidyLeafFacts`); they are only named here, so the tile can show them.
 *
 * Returns null when the card is gone.
 */
export const cardContext = query({
  args: {
    cardId: v.id("cardChecklist"),
    candidateTeamIds: v.optional(v.array(v.id("teams"))),
  },
  returns: v.union(v.null(), cardContextValidator),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const card = await ctx.db.get(args.cardId);
    if (!card) return null;

    // One cache for every team name this call needs.
    const teamNames = new Map<string, string>();
    const teamName = async (teamId: Id<"teams">): Promise<string | null> => {
      const held = teamNames.get(teamId);
      if (held !== undefined) return held;
      const team = await ctx.db.get(teamId);
      if (!team) return null;
      const name = teamFullName(team);
      teamNames.set(teamId, name);
      return name;
    };

    // ── names: from the card itself ──
    const links = card.playerLinks ?? [];
    const names: Array<Infer<typeof contextNameValidator>> = [
      ...links.map((l, order) => ({
        kind: "player" as const,
        nameNormalized: normalizeEntityName(l.nameOnCard),
        printed: l.nameOnCard,
        order,
        pending: false,
        playerId: l.playerId,
      })),
      ...(card.pendingPlayerNames ?? []).map((printed, i) => ({
        kind: "player" as const,
        nameNormalized: normalizeEntityName(printed),
        printed,
        order: links.length + i,
        pending: true,
      })),
      ...(card.pendingTeamNames ?? []).map((printed, order) => ({
        kind: "team" as const,
        nameNormalized: normalizeEntityName(printed),
        printed,
        order,
        pending: true,
      })),
    ];

    // ── players ──
    const playerIds = card.playerIds ?? [];
    const players: Array<Infer<typeof contextPlayerValidator>> = [];
    for (const playerId of playerIds.slice(0, CONTEXT_MAX_PLAYERS)) {
      const player = await ctx.db.get(playerId);
      if (!player) continue;
      const nameOnCard = card.playerLinks?.find((l) => l.playerId === playerId)?.nameOnCard;
      const stints = [];
      for (const s of (player.teamYears ?? []).slice(0, CONTEXT_MAX_STINTS_PER_PLAYER)) {
        const name = await teamName(s.teamId);
        if (name === null) continue;
        stints.push({
          teamId: s.teamId,
          teamName: name,
          ...(s.fromYear !== undefined ? { fromYear: s.fromYear } : {}),
          ...(s.toYear !== undefined ? { toYear: s.toYear } : {}),
        });
      }
      players.push({
        playerId,
        name: player.name,
        ...(nameOnCard && nameOnCard !== player.name ? { nameOnCard } : {}),
        ...(player.birthYear !== undefined ? { birthYear: player.birthYear } : {}),
        ...(player.isHallOfFame !== undefined ? { isHallOfFame: player.isHallOfFame } : {}),
        sportId: player.sportId,
        stints,
        stintsMore: (player.teamYears?.length ?? 0) > CONTEXT_MAX_STINTS_PER_PLAYER,
      });
    }

    // ── cameos (NEO-528 "Also on this card") ──
    const cameos: Array<Infer<typeof cardContextValidator>["cameos"][number]> = [];
    for (const playerId of (card.secondaryPlayerIds ?? []).slice(0, MAX_CARD_PLAYERS)) {
      const player = await ctx.db.get(playerId);
      if (player) cameos.push({ playerId, name: player.name });
    }

    // ── the cameo shortcut (T3) ──
    const cameoOffer = await cameoOfferFor(ctx, card);

    // ── teams ──
    const onCard = new Set<string>(card.teamOnCardIds ?? []);
    const candidates = new Set<string>(args.candidateTeamIds ?? []);
    const teams: Array<Infer<typeof contextTeamValidator>> = [];
    for (const id of [...new Set([...onCard, ...candidates])].slice(0, CONTEXT_MAX_TEAMS)) {
      const name = await teamName(id as Id<"teams">);
      if (name === null) continue;
      teams.push({
        teamId: id as Id<"teams">,
        name,
        onCard: onCard.has(id),
        candidate: candidates.has(id),
      });
    }

    return {
      cardId: card._id,
      names,
      players,
      playersMore: playerIds.length > CONTEXT_MAX_PLAYERS,
      cameos,
      teams,
      ...(cameoOffer ? { cameoOffer } : {}),
    };
  },
});

// ─── saveCard ───────────────────────────────────────────────────────────────

/** The most career gaps one Save & next names (a card carries at most `MAX_CARD_TEAMS` teams). */
export const SAVE_CARD_MAX_GAPS = MAX_CARD_TEAMS;

/**
 * Save & next on a card: refuses while a pink item remains, then answers each
 * career gap the operator was shown with main's default, "Add to career".
 * REAL.
 *
 * ## Contract
 *
 * - Refused (`ConvexError`, "Fix the pink items first.") while the card still
 *   has any pink item: Save & next is only ever enabled with none left, so this
 *   is the server's guard against a stale client.
 * - Nothing is stored about the card having been seen (NEO-656): a blue item
 *   shows for as long as the data holds it.
 * - `gaps` is what the client showed. The server RECOMPUTES the card's gaps
 *   from the data (a single-player card, each of its teams, `computeCoverage`
 *   as of the set's year: the commit's own rule) and acts only on the ones the
 *   client named that are still open, so a gap the client never saw, or one
 *   that has since been covered, is not written. `gaps` is at most
 *   `SAVE_CARD_MAX_GAPS` entries.
 * - Each such gap takes the default stint (`defaultGapStint`, from the set's
 *   year) through the one writer of a career (`appendCareerStintsImpl`). A year
 *   the career will not hold leaves the gap in place, and so blue. Tested
 *   BEFORE the write, so only that case is skipped: any other failure
 *   propagates, because Convex keeps the writes made before a caught throw.
 * - Writes no field of the card: no `lastUpdated`, no title.
 */
export const saveCard = mutation({
  args: {
    cardId: v.id("cardChecklist"),
    gaps: v.array(v.object({ playerId: v.id("players"), teamId: v.id("teams") })),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    if (args.gaps.length > SAVE_CARD_MAX_GAPS) {
      throw new ConvexError(`At most ${SAVE_CARD_MAX_GAPS} career gaps can be saved at once.`);
    }
    const card = await ctx.db.get(args.cardId);
    if (!card) throw new Error("Card not found");
    if (deriveCardAttention(card).level === "fix") {
      throw new ConvexError("Fix the pink items first.");
    }
    const playerIds = card.playerIds ?? [];
    if (args.gaps.length === 0 || playerIds.length !== 1) return null;
    const setYear = await findSetYearForSelectorOption(ctx, card.selectorOptionId);
    if (setYear === undefined) return null;
    const pairs = (card.teamOnCardIds ?? []).map((teamId) => ({ playerId: playerIds[0], teamId }));
    const covered = await computeCoverage(ctx, { sportId: card.sportId, setYear, pairs });
    const open = covered.filter((c) => !c.covered);
    const shown = new Set(args.gaps.map((g) => `${g.playerId}|${g.teamId}`));
    // A year the career will not hold leaves the gap in place.
    const stint = defaultGapStint(setYear);
    if (!careerStintYearsHoldable(stint.fromYear, stint.toYear)) return null;
    for (const gap of open) {
      if (!shown.has(`${gap.playerId}|${gap.teamId}`)) continue;
      await appendCareerStintsImpl(ctx, [
        { playerId: gap.playerId, teamId: gap.teamId as Id<"teams">, ...stint },
      ]);
    }
    return null;
  },
});

/** `assertCareerStintYears` as a yes/no, so a caller can skip ONLY that case. */
function careerStintYearsHoldable(fromYear: number, toYear: number | undefined): boolean {
  try {
    assertCareerStintYears(fromYear, toYear, maxCareerYear());
    return true;
  } catch {
    return false;
  }
}

// ─── write mutations ────────────────────────────────────────────────────────

/**
 * Sources disagree: use one value.
 *
 * ## Contract
 *
 * - `field` names a `sourceDisagreements` entry on the card. `value` is one of
 *   the entry's `values`, or a typed value (`typed: true`, the "Type another"
 *   control; then it is cleansed with the shared name matcher and must not be
 *   empty). Names are capped at `MAX_PICK_NAMES` of at most
 *   `MAX_PICK_NAME_LENGTH` characters.
 * - Each parsed name is resolved: an exact single NB match links; anything else
 *   stays a pending name on the card. A generated title is regenerated (a
 *   hand-typed one is left alone). The card's own name follows the pick when it
 *   is one of the spellings the sources gave and is left alone when it matches
 *   none (typed by hand): `pickedCardName`.
 * - REMOVES the entry from the card (NEO-656: "Once you pick a source, the card
 *   keeps only the result"). That removal on its own does not bump
 *   `lastUpdated`; the link/pending writes it causes do.
 * - `offered` (D13): the values the walk kept for this card. A card that was
 *   picked a moment ago no longer carries the entry, so Change, and Apply to the
 *   same, work from `offered` while the card is open: at most 3 values, the
 *   `MAX_PICK_NAMES` / `MAX_PICK_NAME_LENGTH` caps and 4096 bytes. The call is
 *   refused without it when the card has no entry.
 * - `cardIds` (at most `MAX_APPLY_CARDS`): "Apply to the cards with the same
 *   disagreement". The server checks EACH card carries the same field with the
 *   same set of values; a card that differs (one already picked included) is
 *   refused and counted, never written. The open card is written in the call;
 *   the rest by scheduled `APPLY_PAGE_SIZE`-card pages, each of which re-checks
 *   the card against the open card's offered values (the same set, the picked
 *   value still among them).
 *
 * Returns the cards written in the call, the cards queued for scheduled pages,
 * and the cards refused.
 */
export const pickSourceValue = mutation({
  args: {
    cardId: v.id("cardChecklist"),
    field: v.union(v.literal("players"), v.literal("teams")),
    value: v.array(v.string()),
    typed: v.optional(v.literal(true)),
    cardIds: v.optional(v.array(v.id("cardChecklist"))),
    offered: v.optional(v.array(v.array(v.string()))),
  },
  returns: v.object({
    applied: v.number(),
    scheduled: v.number(),
    refused: v.number(),
  }),
  handler: async (ctx, args) => {
    const userId = await requireAdmin(ctx);
    if (args.value.length > MAX_PICK_NAMES) {
      throw new ConvexError(`A value holds at most ${MAX_PICK_NAMES} names.`);
    }
    const names = cleanPickNames(args.value);
    if (args.typed && names.length === 0) throw new ConvexError("Type a name to use.");
    const others = [...new Set(args.cardIds ?? [])].filter((id) => id !== args.cardId);
    if (others.length > MAX_APPLY_CARDS) {
      throw new ConvexError(`At most ${MAX_APPLY_CARDS} cards can be changed at once.`);
    }
    const card = await ctx.db.get(args.cardId);
    if (!card) throw new ConvexError("That card is gone. Refresh and try again.");
    // The card's own entry, else the values the walk kept (D13).
    const found = entryFor(card, args.field);
    const entry = found ? found.entry : entryFromOffered(args.field, args.offered);
    if (!args.typed && !entry.values.some((o) => sameValue(o.value, names))) {
      throw new ConvexError("That isn't one of the values the sources gave.");
    }
    const cache = newNameWriteCache(ctx);
    await applyPickToCard(ctx, card, {
      field: args.field,
      names,
      typed: args.typed === true,
      userId,
      cache,
      entry,
    });

    // The same disagreement on other cards: checked per card, never assumed.
    const accepted: Array<Id<"cardChecklist">> = [];
    let refused = 0;
    for (const id of others) {
      const other = await ctx.db.get(id);
      const theirs = other ? entryFor(other, args.field) : undefined;
      if (other && theirs && sameDisagreement(entry, theirs.entry)) {
        accepted.push(id);
      } else refused += 1;
    }
    for (let at = 0; at < accepted.length; at += APPLY_PAGE_SIZE) {
      await ctx.scheduler.runAfter(0, internal.tidyCards.pickSourceValuePage, {
        field: args.field,
        value: names,
        typed: args.typed,
        // The open card's own entry: each page checks every card it is handed
        // against it, so a card edited since this call is never trusted.
        offered: entry.values.map((o) => o.value),
        cardIds: accepted.slice(at, at + APPLY_PAGE_SIZE),
        userId,
      });
    }
    return { applied: 1, scheduled: accepted.length, refused };
  },
});

/** One scheduled page of `pickSourceValue`'s "apply to the same disagreement". */
export const pickSourceValuePage = internalMutation({
  args: {
    field: v.union(v.literal("players"), v.literal("teams")),
    value: v.array(v.string()),
    typed: v.optional(v.literal(true)),
    /** The values the open card's entry offered: the disagreement every card must still carry. */
    offered: v.array(v.array(v.string())),
    cardIds: v.array(v.id("cardChecklist")),
    userId: v.string(),
  },
  returns: v.object({ applied: v.number(), refused: v.number() }),
  handler: async (ctx, args) => {
    const cache = newNameWriteCache(ctx);
    let applied = 0;
    let refused = 0;
    for (const id of args.cardIds) {
      const card = await ctx.db.get(id);
      const found = card ? entryFor(card, args.field) : undefined;
      // Compare-and-set: a card picked or edited since the call is left alone
      // (its entry is gone), and so is one that no longer carries the
      // disagreement the operator saw: the same set of values, with the picked
      // one still among them (a typed value is the operator's own and needs no
      // offer).
      if (
        !card ||
        !found ||
        !sameValueSets(
          args.offered,
          found.entry.values.map((o) => o.value),
        ) ||
        (!args.typed && !found.entry.values.some((o) => sameValue(o.value, args.value)))
      ) {
        refused += 1;
        continue;
      }
      await applyPickToCard(ctx, card, {
        field: args.field,
        names: args.value,
        typed: args.typed === true,
        userId: args.userId,
        cache,
      });
      applied += 1;
    }
    return { applied, refused };
  },
});

/**
 * "Apply to all" on the Team tile: the answer the operator just gave one card,
 * offered to the rest of its LINE (main's Tidy Up wizard, `teams-on-cards.ts`).
 *
 * ## Contract
 *
 * A line is one player SET plus one claim key (`lib/teamLine`: the listing's
 * team name when it printed one, and "the publisher's checklist settled the
 * team"). The server checks EVERY card in `cardIds` (at most `MAX_APPLY_CARDS`)
 * and skips and counts any it refuses. A card is written only when ALL hold:
 *  - it is under the same checklist (leaf) as `sourceCardId`, and on the same
 *    line (`teamLineKey`), a multi-player set included. The source card must
 *    have a player: the line of cards with nobody on them is refused
 *    (`hasTeamLine`);
 *  - nobody is waiting on it and it has no team: no pending player or team
 *    names, no "No team" stamp, no teams disagreement between the sources
 *    (`isTeamlessOnLine`).
 * There is NO career test: the operator's answer is the evidence, as it was for
 * a wizard line, and a set whose own default is "No Team" takes it too (that
 * default only holds back what NB guesses, never what the operator says).
 * The source card must already carry every team in `teamIds`: the call is
 * "copy what is on that card", never a team the operator did not give it.
 *
 * Written cards get `teamOnCardIds: teamIds` through the one writer
 * (`syncCardTeamLinks`, which settles the card's league) and a regenerated
 * generated title; `lastUpdated` bumps. The first `APPLY_PAGE_SIZE` accepted
 * cards are written in the call; the rest by scheduled pages.
 *
 * Returns the cards accepted for writing and the cards skipped.
 */
export const applyTeamToPlayerCards = mutation({
  args: {
    sourceCardId: v.id("cardChecklist"),
    teamIds: v.array(v.id("teams")),
    cardIds: v.array(v.id("cardChecklist")),
  },
  returns: v.object({ applied: v.number(), skipped: v.number() }),
  handler: async (ctx, args) => {
    const userId = await requireAdmin(ctx);
    const ids = [...new Set(args.cardIds)].filter((id) => id !== args.sourceCardId);
    if (ids.length > MAX_APPLY_CARDS) {
      throw new ConvexError(`At most ${MAX_APPLY_CARDS} cards can be changed at once.`);
    }
    const teamIds = [...new Set(args.teamIds)];
    if (teamIds.length === 0 || teamIds.length > MAX_CARD_TEAMS) {
      throw new ConvexError(`A card carries between 1 and ${MAX_CARD_TEAMS} teams.`);
    }
    const source = await ctx.db.get(args.sourceCardId);
    if (!source) throw new ConvexError("That card is gone. Refresh and try again.");
    const onSource = new Set<string>(source.teamOnCardIds ?? []);
    if (!teamIds.every((id) => onSource.has(id))) {
      throw new ConvexError("Give this card the team first.");
    }
    const line = { leafId: source.selectorOptionId, lineKey: teamLineKey(source) };
    if (!hasTeamLine(line.lineKey)) {
      throw new ConvexError("Apply to all is for cards with a player.");
    }
    const accepted: Array<Id<"cardChecklist">> = [];
    for (const id of ids) {
      const card = await ctx.db.get(id);
      if (card && cardTakesLineTeams(card, line)) accepted.push(id);
    }
    const cache = newNameWriteCache(ctx);
    const now = accepted.slice(0, APPLY_PAGE_SIZE);
    for (const id of now) {
      const card = await ctx.db.get(id);
      if (card) await writeTeamFill(ctx, card, teamIds, cache, userId);
    }
    for (let at = APPLY_PAGE_SIZE; at < accepted.length; at += APPLY_PAGE_SIZE) {
      await ctx.scheduler.runAfter(0, internal.tidyCards.applyTeamPage, {
        ...line,
        teamIds,
        cardIds: accepted.slice(at, at + APPLY_PAGE_SIZE),
        userId,
      });
    }
    return { applied: accepted.length, skipped: ids.length - accepted.length };
  },
});

/** The line an Apply-to-all answer belongs to: the checklist and `teamLineKey`. */
type TeamLine = { leafId: Id<"selectorOptions">; lineKey: string };

/**
 * Whether a card takes its line's answer: under the same checklist, on the same
 * line, and still waiting for a team. The line of cards with no player takes
 * nothing. Pure: every field is on the card.
 */
export function cardTakesLineTeams(card: Doc<"cardChecklist">, line: TeamLine): boolean {
  return (
    hasTeamLine(line.lineKey) &&
    card.selectorOptionId === line.leafId &&
    teamLineKey(card) === line.lineKey &&
    isTeamlessOnLine(card)
  );
}

async function writeTeamFill(
  ctx: MutationCtx,
  card: Doc<"cardChecklist">,
  teamIds: Array<Id<"teams">>,
  cache: NameWriteCache,
  userId: string,
): Promise<void> {
  const fields = nameFieldsOf(card);
  fields.teamOnCardIds = teamIds;
  await writeNameChange(ctx, card, fields, cache, userId);
}

/** One scheduled page of `applyTeamToPlayerCards`; every card is re-checked. */
export const applyTeamPage = internalMutation({
  args: {
    leafId: v.id("selectorOptions"),
    lineKey: v.string(),
    teamIds: v.array(v.id("teams")),
    cardIds: v.array(v.id("cardChecklist")),
    userId: v.string(),
  },
  returns: v.object({ applied: v.number(), skipped: v.number() }),
  handler: async (ctx, args) => {
    const cache = newNameWriteCache(ctx);
    let applied = 0;
    for (const id of args.cardIds) {
      const card = await ctx.db.get(id);
      if (card && cardTakesLineTeams(card, args)) {
        await writeTeamFill(ctx, card, args.teamIds, cache, args.userId);
        applied += 1;
      }
    }
    return { applied, skipped: args.cardIds.length - applied };
  },
});

/**
 * Apply a corrected card variation to the cards that print the same one.
 *
 * ## Contract
 *
 * For each card in `cardIds` (at most `MAX_APPLY_CARDS`): write
 * `cardVariation: to` only when the card's stored variation, trimmed, equals
 * `from` (compare-and-set: a card edited since is skipped and counted). `to`
 * is trimmed and capped like `updateCard`'s variation. The title is always
 * regenerated: the walk overwrites a hand-typed title too (Jason's decision,
 * NEO-645). A still-long new value stays blue on its own: nothing remembers it
 * as seen (NEO-656).
 *
 * Returns the cards written and the cards skipped.
 */
export const applyVariation = mutation({
  args: {
    cardIds: v.array(v.id("cardChecklist")),
    from: v.string(),
    to: v.string(),
  },
  returns: v.object({ applied: v.number(), skipped: v.number() }),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const from = args.from.trim();
    const to = args.to.trim();
    if (!from) throw new ConvexError("There is no variation to change.");
    if (to.length > MAX_VARIATION_LENGTH) {
      throw new ConvexError(
        `A variation is ${to.length} characters; the limit is ${MAX_VARIATION_LENGTH}.`,
      );
    }
    const ids = [...new Set(args.cardIds)];
    if (ids.length > MAX_APPLY_CARDS) {
      throw new ConvexError(`At most ${MAX_APPLY_CARDS} cards can be changed at once.`);
    }
    const accepted: Array<Id<"cardChecklist">> = [];
    for (const id of ids) {
      const card = await ctx.db.get(id);
      if (card && (card.cardVariation ?? "").trim() === from) accepted.push(id);
    }
    const cache = newNameWriteCache(ctx);
    for (const id of accepted.slice(0, APPLY_PAGE_SIZE)) {
      const card = await ctx.db.get(id);
      if (card) await writeVariation(ctx, card, from, to, cache);
    }
    for (let at = APPLY_PAGE_SIZE; at < accepted.length; at += APPLY_PAGE_SIZE) {
      await ctx.scheduler.runAfter(0, internal.tidyCards.applyVariationPage, {
        cardIds: accepted.slice(at, at + APPLY_PAGE_SIZE),
        from,
        to,
      });
    }
    return { applied: accepted.length, skipped: ids.length - accepted.length };
  },
});

/** The longest variation `applyVariation` writes. */
export const MAX_VARIATION_LENGTH = 200;

async function writeVariation(
  ctx: MutationCtx,
  card: Doc<"cardChecklist">,
  from: string,
  to: string,
  cache: NameWriteCache,
): Promise<boolean> {
  // Compare-and-set: a card edited since is left alone.
  if ((card.cardVariation ?? "").trim() !== from) return false;
  const patch: Partial<Doc<"cardChecklist">> = { cardVariation: to === "" ? undefined : to };
  const { titleChanged } = await regenerateTitleFields(ctx, card, patch, cache);
  await ctx.db.patch(card._id, { ...patch, lastUpdated: Date.now() });
  if (titleChanged) await queueRetitledCardNow(ctx, card._id);
  return true;
}

/** One scheduled page of `applyVariation`; every card is re-checked. */
export const applyVariationPage = internalMutation({
  args: {
    cardIds: v.array(v.id("cardChecklist")),
    from: v.string(),
    to: v.string(),
  },
  returns: v.object({ applied: v.number(), skipped: v.number() }),
  handler: async (ctx, args) => {
    const cache = newNameWriteCache(ctx);
    let applied = 0;
    for (const id of args.cardIds) {
      const card = await ctx.db.get(id);
      if (card && (await writeVariation(ctx, card, args.from, args.to, cache))) applied += 1;
    }
    return { applied, skipped: args.cardIds.length - applied };
  },
});

/**
 * "Shorten the set name for every card": save the new set name and retitle.
 *
 * ## Contract
 *
 * - Writes the leaf's `metadata.listingShortName` with the
 *   `setSelectorOptionListingShortName` rules (`selectorOptions.ts`).
 * - Patches the OPEN card's title now (`cardId`).
 * - Schedules a paged retitle (`convex/features/setNameInTitles.ts`, the NEO-637
 *   rules): a generated title is regenerated; a hand edit showing "Left out" gets
 *   `swapSetNameInTitle`; any other hand edit is left alone. Selection is a
 *   query over `by_selector_option_and_sort`; 100 writes a page.
 * - The live preview while typing is client-side (`useTitlePreview`); this is
 *   the Save.
 *
 * Returns whether the open card was retitled and whether pages were scheduled.
 */
export const applySetNameToTitles = mutation({
  args: {
    leafId: v.id("selectorOptions"),
    /** The open card, patched in the call. */
    cardId: v.id("cardChecklist"),
    listingShortName: v.string(),
    /**
     * NEO-645 T4 — pressed from the walk: every card's title and description
     * is rebuilt, a hand-typed title included (Jason: "always overwrite").
     * Absent, the NEO-637 rules above keep a hand edit that does not show
     * "Left out". Only the walk sends it.
     */
    regenerateListing: v.optional(v.literal(true)),
  },
  returns: v.object({
    openCardRetitled: v.boolean(),
    scheduled: v.boolean(),
  }),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const leaf = await ctx.db.get(args.leafId);
    if (!leaf) throw new ConvexError("That row is gone. Refresh and try again.");
    if (!LISTING_SHORT_NAME_LEVELS.has(leaf.level)) {
      throw new ConvexError("A short name goes on a set or a part of one.");
    }
    const card = await ctx.db.get(args.cardId);
    if (!card || card.selectorOptionId !== args.leafId) {
      throw new ConvexError("That card isn't in this checklist.");
    }
    const next = normalizeListingShortName(args.listingShortName);
    const old = leaf.metadata?.listingShortName;
    if ((old ?? undefined) === next) return { openCardRetitled: false, scheduled: false };

    const metadata = { ...(leaf.metadata ?? {}) };
    if (next) metadata.listingShortName = next;
    else delete metadata.listingShortName;
    // The run id of the retitle chain this save starts (the NEO-535 run id,
    // `listingShortNameSavedAt`, written the same way). A chain pages on only
    // while the leaf still holds ITS id and ITS box, so two quick saves leave
    // one live chain: the older one would otherwise swap a stale old -> new
    // pair into titles the newer one has already settled.
    const runId = Math.max(Date.now(), (leaf.metadata?.listingShortNameSavedAt ?? 0) + 1);
    metadata.listingShortNameSavedAt = runId;
    await ctx.db.patch(args.leafId, {
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
      lastUpdated: Date.now(),
    });

    const cache = newNameWriteCache(ctx);
    const overwrite = args.regenerateListing === true;
    const openCardRetitled = await retitleCardForSetName(ctx, card, old, next, cache, overwrite);
    await ctx.scheduler.runAfter(0, internal.tidyCards.retitleLeafPage, {
      leafId: args.leafId,
      oldShortName: old,
      newShortName: next,
      runId,
      cursor: null,
      ...(overwrite ? { regenerateListing: true as const } : {}),
      // The open card was decided in this call. A second pass would read the
      // title this one wrote against the same old -> new pair: a swapped hand
      // edit no longer holds the old name, so it would be rebuilt.
      openCardId: args.cardId,
    });
    return { openCardRetitled, scheduled: true };
  },
});

/** Cards one scheduled retitle page writes. */
export const RETITLE_PAGE_SIZE = 100;

/**
 * One card's title under a changed set name (the NEO-637 rules, in
 * `features/setNameInTitles.ts`): a generated title is rebuilt, a hand edit that
 * shows "Left out" has the set name swapped, any other hand edit stays.
 */
async function retitleCardForSetName(
  ctx: MutationCtx,
  card: Doc<"cardChecklist">,
  oldShortName: string | undefined,
  newShortName: string | undefined,
  cache: NameWriteCache,
  overwrite = false,
): Promise<boolean> {
  if (overwrite) {
    // The walk's save: the title is the generator's, whatever the stored one is.
    const patch: Partial<Doc<"cardChecklist">> = {};
    const { titleChanged } = await regenerateTitleFields(ctx, card, patch, cache);
    if (Object.keys(patch).length === 0) return false;
    await ctx.db.patch(card._id, { ...patch, lastUpdated: Date.now() });
    if (titleChanged) await queueRetitledCardNow(ctx, card._id);
    return titleChanged;
  }
  const { inputs } = await listingInputsForStoredCard(ctx, card, cache.titles);
  const decision = retitleForSetName({
    storedTitle: card.listingTitle,
    inputsAfter: inputs,
    oldShortName,
    newShortName,
    waitingNames: [...(card.pendingPlayerNames ?? []), ...(card.pendingTeamNames ?? [])],
  });
  if (decision.kind === "leave") return false;
  const patch: Partial<Doc<"cardChecklist">> =
    decision.kind === "generated"
      ? {
          listingTitle: decision.title,
          listingTitleTruncated: decision.truncated,
        }
      : { listingTitle: decision.title };
  await ctx.db.patch(card._id, { ...patch, lastUpdated: Date.now() });
  await queueRetitledCardNow(ctx, card._id);
  return true;
}

/** One scheduled page of `applySetNameToTitles`, over the leaf's cards in sort order. */
export const retitleLeafPage = internalMutation({
  args: {
    leafId: v.id("selectorOptions"),
    oldShortName: v.optional(v.string()),
    newShortName: v.optional(v.string()),
    /** The `metadata.listingShortNameSavedAt` the save that started this chain wrote. */
    runId: v.number(),
    cursor: v.union(v.string(), v.null()),
    /** The card `applySetNameToTitles` already decided; the pages skip it. */
    openCardId: v.optional(v.id("cardChecklist")),
    /** NEO-645 T4: rebuild every title, a typed one included. */
    regenerateListing: v.optional(v.literal(true)),
  },
  returns: v.object({ retitled: v.number(), done: v.boolean() }),
  handler: async (ctx, args) => {
    // A newer save, or any other writer of the box, ends this chain.
    const leaf = await ctx.db.get(args.leafId);
    if (
      !leaf ||
      leaf.metadata?.listingShortNameSavedAt !== args.runId ||
      leaf.metadata?.listingShortName !== args.newShortName
    ) {
      return { retitled: 0, done: true };
    }
    const page = await ctx.db
      .query("cardChecklist")
      .withIndex("by_selector_option_and_sort", (q) => q.eq("selectorOptionId", args.leafId))
      .paginate({ numItems: RETITLE_PAGE_SIZE, cursor: args.cursor });
    const cache = newNameWriteCache(ctx);
    let retitled = 0;
    for (const card of page.page) {
      if (card._id === args.openCardId) continue;
      if (
        await retitleCardForSetName(
          ctx,
          card,
          args.oldShortName,
          args.newShortName,
          cache,
          args.regenerateListing === true,
        )
      ) {
        retitled += 1;
      }
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.tidyCards.retitleLeafPage, {
        ...args,
        cursor: page.continueCursor,
      });
    }
    return { retitled, done: page.isDone };
  },
});

/**
 * NEO-656 — kept as a no-op for one release. After Add to career this paged the
 * leaf's cards to drop a stored career-gap check; there is no stored check any
 * more (the gap is read live), but a page scheduled before the deploy may still
 * be in flight and must find its function. Remove in the release after.
 */
export const recheckCareerGapPage = internalMutation({
  args: {
    leafId: v.id("selectorOptions"),
    playerId: v.id("players"),
    cursor: v.union(v.string(), v.null()),
  },
  returns: v.object({ cleared: v.number(), done: v.boolean() }),
  handler: async () => ({ cleared: 0, done: true }),
});
