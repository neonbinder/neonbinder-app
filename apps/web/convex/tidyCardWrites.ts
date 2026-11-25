/**
 * NEO-645 — what an answered name does to ONE card.
 *
 * The one place the card-side effect of an answered name is decided and
 * written. `tidyNames.answerName` (the open card), `applyNameToAll`'s pages,
 * `createPlayer` and `tidyCards.pickSourceValue` all go through
 * `writeNameChange`, so a card reached by Apply to all ends up byte-for-byte
 * like the card the operator answered on.
 *
 * NEO-656: the card is the only record. A name is read from the card itself
 * (`playerLinks.nameOnCard`, `pendingPlayerNames`, `pendingTeamNames`), never
 * from a stored row (`printedRefOf`).
 *
 * ## Pure planner, thin writer
 *
 * `planNameChange` is pure: it takes the card's name fields and says what they
 * become, or that the card is not in the state the previous answer left it in
 * (compare-and-set, `skipped`) or that nothing changes (`unchanged`).
 * `writeNameChange` applies a plan: the card patch, its index rows through
 * their one writers (`syncCardPlayerLinks`, `syncCardTeamLinks`), a rebuilt
 * title and description (always rebuilt, a hand-typed one included: T4), and the
 * teamless-sport default (NEO-426) on a card that just lost its last pending
 * player name.
 *
 * ## Costs (measured by `tidyNames.applyToAll.test.ts`, see APPLY_TO_ALL_PAGE_SIZE)
 *
 * Per card: 1 get, 1 patch, `syncCardPlayerLinks` (1 read + writes) or
 * `syncCardTeamLinks` (1 read + writes + league settle), the title read through
 * a shared cache (chain labels once per leaf, players and teams once per page),
 * `queueRetitledCardNow` (1 read) when the title moved. The title and description
 * are ALWAYS rebuilt (T4, `regenerateTitleFields`), one read of the card's facts.
 */

import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { syncCardPlayerLinks } from "./cardPlayerLinks";
import { syncCardTeamLinks } from "./cardTeamLinks";
import { newCardLeagueCache, type CardLeagueCache } from "./cardLeague";
import {
  newStoredCardReadCache,
  type StoredCardReadCache,
} from "./storedCardTitle";
import { rebuildListingText } from "./tidyListingText";
import { dropCameosNowPrimary, withoutPrimaryCameos } from "./cardSecondaryPlayers";
import { MAX_CARD_PLAYERS, MAX_CARD_TEAMS } from "./features/cardAttention";
import { queueRetitledCardNow } from "./listingTitleRequeue";
import { createSportNoTeamReader } from "./sportTeamless";
import {
  cardMayTakeFill,
  newFillReadCache,
  planFillOnAnswer,
  type FillReadCache,
} from "./teamFillOnAnswer";
import { noTeamCardVerdict, stampNoTeam } from "./lib/selectorTeams";
import { normalizeEntityName } from "../lib/entities/normalize-name";

type Card = Doc<"cardChecklist">;

/**
 * The answer a card is expected to be holding, for the compare-and-set of
 * `applyNameToAll` and for undoing a team link. NOT stored anywhere (NEO-656):
 * the caller reads it off the card or holds it for the sitting.
 */
export type StoredAnswer =
  | { kind: "linkPlayer"; playerId: Id<"players"> }
  | { kind: "linkTeam"; teamId: Id<"teams"> }
  | { kind: "notEntity" };

/** The card side of one printed name: which name, where it sat. */
export type PrintedRef = {
  kind: "player" | "team";
  /** `normalizeEntityName` of the printed spelling: the name's key. */
  nameNormalized: string;
  /** This card's own spelling. */
  printed: string;
  /** Position among the card's printed names of this kind. */
  order: number;
};

/**
 * What the card's name becomes.
 *
 *  - `linkPlayer` / `linkTeam`: the name leaves the pending list and the entity
 *    is linked;
 *  - `notEntity`: the name leaves the card altogether (pending list, links and
 *    title);
 *  - `restore`: the answer was undone: the printed spelling is pending again.
 */
export type NameChange =
  | { kind: "linkPlayer"; playerId: Id<"players"> }
  | { kind: "linkTeam"; teamId: Id<"teams"> }
  | { kind: "notEntity" }
  | { kind: "restore" };

/**
 * The state the card must be in for the write to apply: what the PREVIOUS
 * answer left. `"any"` is the open card, which the operator is answering on
 * (its state is whatever it is). A card in some other state (the operator
 * changed it by hand, `cardOverride`; a sync rewrote it) is skipped, never
 * overwritten.
 */
export type ExpectedState = "any" | { answer: StoredAnswer | undefined };

type Link = { playerId: Id<"players">; nameOnCard: string };

export type NameFields = {
  playerIds: Id<"players">[];
  playerLinks: Link[];
  pendingPlayerNames: string[];
  teamOnCardIds: Id<"teams">[];
  pendingTeamNames: string[];
};

export type NamePlan =
  | { status: "skipped" }
  | { status: "unchanged" }
  | { status: "changed"; fields: NameFields };

/** The card's name fields, with absence read as empty. */
export function nameFieldsOf(
  card: Pick<
    Card,
    "playerIds" | "playerLinks" | "pendingPlayerNames" | "teamOnCardIds" | "pendingTeamNames"
  >,
): NameFields {
  return {
    playerIds: [...(card.playerIds ?? [])],
    playerLinks: [...(card.playerLinks ?? [])],
    pendingPlayerNames: [...(card.pendingPlayerNames ?? [])],
    teamOnCardIds: [...(card.teamOnCardIds ?? [])],
    pendingTeamNames: [...(card.pendingTeamNames ?? [])],
  };
}

const isKey = (key: string) => (name: string) => normalizeEntityName(name) === key;

function stateMatches(
  fields: NameFields,
  ref: PrintedRef,
  expected: ExpectedState,
): boolean {
  if (expected === "any") return true;
  const prev = expected.answer;
  if (ref.kind === "player") {
    const hasPending = fields.pendingPlayerNames.some(isKey(ref.nameNormalized));
    const links = fields.playerLinks.filter((l) => isKey(ref.nameNormalized)(l.nameOnCard));
    if (prev === undefined) return hasPending;
    if (prev.kind === "linkPlayer") {
      return links.some((l) => l.playerId === prev.playerId);
    }
    if (prev.kind === "notEntity") return !hasPending && links.length === 0;
    return false;
  }
  const hasPending = fields.pendingTeamNames.some(isKey(ref.nameNormalized));
  if (prev === undefined) return hasPending;
  if (prev.kind === "linkTeam") return fields.teamOnCardIds.includes(prev.teamId);
  if (prev.kind === "notEntity") return !hasPending;
  return false;
}

const sameList = <T>(a: readonly T[], b: readonly T[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Plan one name's change on one card. `unlinkedBefore` is the number of the
 * card's OTHER printed player names that sit before this one and are not
 * linked (pending or ruled out): the link is placed at `order - unlinkedBefore`
 * so `playerIds` keeps the printed order (the playerIds = playerLinks order
 * invariant in schema.ts).
 */
export function planNameChange(
  card: Parameters<typeof nameFieldsOf>[0],
  ref: PrintedRef,
  change: NameChange,
  expected: ExpectedState,
  opts: { unlinkedBefore: number; previousAnswer?: StoredAnswer },
): NamePlan {
  const before = nameFieldsOf(card);
  if (!stateMatches(before, ref, expected)) return { status: "skipped" };
  const next = nameFieldsOf(card);
  const key = ref.nameNormalized;
  const prev = opts.previousAnswer;

  if (ref.kind === "player") {
    const dropPending = () => {
      next.pendingPlayerNames = next.pendingPlayerNames.filter((n) => !isKey(key)(n));
    };
    const keyedLinkIdx = () =>
      next.playerLinks.findIndex((l) => isKey(key)(l.nameOnCard));
    const dropKeyedLinks = () => {
      const gone = new Set(
        next.playerLinks.filter((l) => isKey(key)(l.nameOnCard)).map((l) => l.playerId as string),
      );
      next.playerLinks = next.playerLinks.filter((l) => !isKey(key)(l.nameOnCard));
      next.playerIds = next.playerIds.filter((id) => !gone.has(id as string));
    };
    if (change.kind === "linkPlayer") {
      dropPending();
      const at = keyedLinkIdx();
      const already = next.playerIds.includes(change.playerId);
      if (at >= 0) {
        // Replace in place: same printed position, another player.
        const old = next.playerLinks[at].playerId;
        if (old !== change.playerId) {
          if (already) {
            // The new player is already on the card through another name: drop this link.
            next.playerLinks.splice(at, 1);
            next.playerIds = next.playerIds.filter((id) => id !== old);
          } else {
            const idAt = next.playerIds.indexOf(old);
            next.playerLinks[at] = { playerId: change.playerId, nameOnCard: ref.printed };
            if (idAt >= 0) next.playerIds[idAt] = change.playerId;
            else next.playerIds.splice(Math.min(at, next.playerIds.length), 0, change.playerId);
          }
        }
      } else if (!already) {
        if (next.playerIds.length >= MAX_CARD_PLAYERS) return { status: "skipped" };
        const idx = Math.max(
          0,
          Math.min(ref.order - opts.unlinkedBefore, next.playerIds.length),
        );
        next.playerIds.splice(idx, 0, change.playerId);
        next.playerLinks.splice(idx, 0, { playerId: change.playerId, nameOnCard: ref.printed });
      }
    } else if (change.kind === "notEntity") {
      dropPending();
      dropKeyedLinks();
    } else if (change.kind === "restore") {
      dropKeyedLinks();
      if (!next.pendingPlayerNames.some(isKey(key))) next.pendingPlayerNames.push(ref.printed);
    } else {
      return { status: "skipped" };
    }
  } else {
    const dropPending = () => {
      next.pendingTeamNames = next.pendingTeamNames.filter((n) => !isKey(key)(n));
    };
    const dropPrevTeam = () => {
      if (prev?.kind === "linkTeam") {
        next.teamOnCardIds = next.teamOnCardIds.filter((id) => id !== prev.teamId);
      }
    };
    if (change.kind === "linkTeam") {
      dropPending();
      dropPrevTeam();
      if (!next.teamOnCardIds.includes(change.teamId)) {
        if (next.teamOnCardIds.length >= MAX_CARD_TEAMS) return { status: "skipped" };
        next.teamOnCardIds.push(change.teamId);
      }
    } else if (change.kind === "notEntity") {
      dropPending();
      dropPrevTeam();
    } else if (change.kind === "restore") {
      dropPrevTeam();
      if (!next.pendingTeamNames.some(isKey(key))) next.pendingTeamNames.push(ref.printed);
    } else {
      return { status: "skipped" };
    }
  }

  const same =
    sameList(before.playerIds, next.playerIds) &&
    sameList(
      before.playerLinks.map((l) => `${l.playerId}|${l.nameOnCard}`),
      next.playerLinks.map((l) => `${l.playerId}|${l.nameOnCard}`),
    ) &&
    sameList(before.pendingPlayerNames, next.pendingPlayerNames) &&
    sameList(before.teamOnCardIds, next.teamOnCardIds) &&
    sameList(before.pendingTeamNames, next.pendingTeamNames);
  return same ? { status: "unchanged" } : { status: "changed", fields: next };
}

/** Caches one transaction (a page) shares across its cards. */
export type NameWriteCache = {
  titles: StoredCardReadCache;
  league: CardLeagueCache;
  sportNoTeam: ReturnType<typeof createSportNoTeamReader>;
  /** NEO-645 — the career reads the team fill shares across a page's cards. */
  fill: FillReadCache;
};

export function newNameWriteCache(ctx: Pick<MutationCtx, "db">): NameWriteCache {
  return {
    titles: newStoredCardReadCache(),
    league: newCardLeagueCache(),
    sportNoTeam: createSportNoTeamReader(ctx),
    fill: newFillReadCache(),
  };
}

/**
 * The title and description follow the facts, always (NEO-645 T4); see
 * `rebuildListingText`, which holds the rule and is reachable from modules
 * that must not import this one.
 */
export async function regenerateTitleFields(
  ctx: MutationCtx,
  card: Card,
  patch: Partial<Card>,
  cache: NameWriteCache,
): Promise<{ titleChanged: boolean }> {
  return await rebuildListingText(ctx, card, patch, cache.titles);
}

/**
 * Apply a `changed` plan to the card: patch, index rows, rebuilt title and
 * description, the teamless-sport default. Writes `lastUpdated` (content
 * really changed under an open review). Returns true when the stored title
 * moved.
 */
export async function writeNameChange(
  ctx: MutationCtx,
  card: Card,
  fields: NameFields,
  cache: NameWriteCache,
  operatorUserId: string | undefined,
): Promise<{ titleChanged: boolean }> {
  // NEO-645 (Q1 = A) — a card that has just lost its last pending player name
  // gets the commit's team fill, with the commit's verdict and rule 8: a card
  // the commit could not offer it to (the name was still pending) is not left
  // to stop on the Team tile when the career gives exactly one team.
  if (
    (card.pendingPlayerNames?.length ?? 0) > 0 &&
    cardMayTakeFill(card, fields)
  ) {
    const filled = await planFillOnAnswer(ctx, card, fields.playerIds, cache.fill);
    if (filled && filled.teamIds.length > 0) {
      fields = { ...fields, teamOnCardIds: filled.teamIds };
    }
  }
  const playersChanged =
    !sameList(card.playerIds ?? [], fields.playerIds) ||
    !sameList(
      (card.playerLinks ?? []).map((l) => `${l.playerId}|${l.nameOnCard}`),
      fields.playerLinks.map((l) => `${l.playerId}|${l.nameOnCard}`),
    );
  const teamsChanged = !sameList(card.teamOnCardIds ?? [], fields.teamOnCardIds);

  const patch: Partial<Card> = {
    playerIds: fields.playerIds.length > 0 ? fields.playerIds : undefined,
    playerLinks: fields.playerLinks.length > 0 ? fields.playerLinks : undefined,
    pendingPlayerNames:
      fields.pendingPlayerNames.length > 0 ? fields.pendingPlayerNames : undefined,
    teamOnCardIds: fields.teamOnCardIds.length > 0 ? fields.teamOnCardIds : undefined,
    pendingTeamNames:
      fields.pendingTeamNames.length > 0 ? fields.pendingTeamNames : undefined,
  };
  // A real team retires a "no team" ruling (NEO-102), as `updateCard` does.
  if (teamsChanged && fields.teamOnCardIds.length > 0) {
    patch.teamNoneConfirmedAt = undefined;
    patch.teamNoneConfirmedByUserId = undefined;
  }
  const next: Card = { ...card, ...patch } as Card;

  // The teamless-sport default (NEO-426), re-asked of a card that just lost its
  // last pending player name: at birth the pending name held it back.
  if (
    (card.pendingPlayerNames?.length ?? 0) > 0 &&
    fields.pendingPlayerNames.length === 0 &&
    fields.playerIds.length > 0 &&
    next.teamNoneConfirmedAt === undefined
  ) {
    const vouch = await cache.sportNoTeam.defaultFor({
      playerIds: fields.playerIds,
      pendingPlayerNameCount: 0,
    });
    if (vouch) {
      const verdict = noTeamCardVerdict({
        teamOnCardIds: next.teamOnCardIds,
        pendingTeamNames: next.pendingTeamNames,
        bscTeamName: next.bscTeamName,
        teamCheckDoneAt: next.teamCheckDoneAt,
        teamCheckOutcome: next.teamCheckOutcome,
        platformData: next.platformData?.bsc ? { bsc: { ref: next.platformData.bsc.ref } } : {},
      });
      if (verdict.verdict === "stamp") {
        const stamp = stampNoTeam(operatorUserId ?? vouch.setByUserId, Date.now());
        patch.teamNoneConfirmedAt = stamp.teamNoneConfirmedAt;
        patch.teamNoneConfirmedByUserId = stamp.teamNoneConfirmedByUserId;
        next.teamNoneConfirmedAt = stamp.teamNoneConfirmedAt;
        next.teamNoneConfirmedByUserId = stamp.teamNoneConfirmedByUserId;
      }
    }
  }

  // The listing text follows the names, always (T4). A player who has just
  // become the card's own player is no longer a cameo, so the text is built
  // without that cameo and the cameo is dropped below.
  const textCard = withoutPrimaryCameos({
    ...card,
    playerIds: fields.playerIds,
    playerLinks: fields.playerLinks,
  });
  const { titleChanged } = await regenerateTitleFields(ctx, textCard, patch, cache);

  await ctx.db.patch(card._id, { ...patch, lastUpdated: Date.now() });
  if (playersChanged) {
    await syncCardPlayerLinks(ctx, card._id, fields.playerIds, card.sportId);
    await dropCameosNowPrimary(ctx, { ...card, ...patch } as Card, cache.titles);
  }
  if (teamsChanged) {
    await syncCardTeamLinks(ctx, card, fields.teamOnCardIds, { leagueCache: cache.league });
  }
  if (titleChanged) await queueRetitledCardNow(ctx, card._id);
  return { titleChanged };
}

/**
 * NEO-656 (D6) — the ref of a printed name, read from the CARD alone, and the
 * number of the card's player names before it that are not linked.
 *
 * The card does not record how linked and pending names interleave, so a name
 * still waiting is placed after the links the card already has:
 * `order = playerLinks.length + pendingIndex` and `unlinkedBefore = pendingIndex`,
 * which `planNameChange` turns into the slot `playerLinks.length`. `playerIds`
 * stays equal to `playerLinks` (same ids, same order). A name already linked
 * keeps its own slot (Change replaces in place). A name on neither list (a name
 * the walk is re-asking after Not a player) is placed last, like a waiting one.
 * `printed` is the card's own spelling when the card holds the name, else the
 * spelling given.
 */
export function printedRefOf(
  card: Parameters<typeof nameFieldsOf>[0],
  kind: "player" | "team",
  key: string,
  spelling: string,
): { ref: PrintedRef; unlinkedBefore: number } {
  const fields = nameFieldsOf(card);
  const matches = isKey(key);
  if (kind === "player") {
    const linkAt = fields.playerLinks.findIndex((l) => matches(l.nameOnCard));
    if (linkAt >= 0) {
      return {
        ref: {
          kind,
          nameNormalized: key,
          printed: fields.playerLinks[linkAt].nameOnCard,
          order: linkAt,
        },
        unlinkedBefore: 0,
      };
    }
    const pendingAt = fields.pendingPlayerNames.findIndex(matches);
    const waiting = pendingAt >= 0 ? pendingAt : fields.pendingPlayerNames.length;
    return {
      ref: {
        kind,
        nameNormalized: key,
        printed: pendingAt >= 0 ? fields.pendingPlayerNames[pendingAt] : spelling,
        order: fields.playerLinks.length + waiting,
      },
      unlinkedBefore: waiting,
    };
  }
  const pendingAt = fields.pendingTeamNames.findIndex(matches);
  return {
    ref: {
      kind,
      nameNormalized: key,
      printed: pendingAt >= 0 ? fields.pendingTeamNames[pendingAt] : spelling,
      order: pendingAt >= 0 ? pendingAt : fields.pendingTeamNames.length,
    },
    unlinkedBefore: 0,
  };
}

/** Does the card still hold this name (waiting, or linked by `nameOnCard`)? */
export function cardHoldsName(
  card: Parameters<typeof nameFieldsOf>[0],
  kind: "player" | "team",
  key: string,
): boolean {
  const fields = nameFieldsOf(card);
  const matches = isKey(key);
  return kind === "player"
    ? fields.pendingPlayerNames.some(matches) || fields.playerLinks.some((l) => matches(l.nameOnCard))
    : fields.pendingTeamNames.some(matches);
}
