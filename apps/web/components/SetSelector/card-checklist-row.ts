import type { Id } from "../../convex/_generated/dataModel";
import type { TidyDisagreement } from "../../convex/features/cardAttention";

/**
 * A `getCardChecklist` row, structurally.
 *
 * Deliberately not the generated query type: this module is imported by
 * components that must typecheck while the backend half of the PR is still
 * landing. Every field beyond the identity trio is optional, so widening it
 * for a new fixer is additive and breaks no caller. Add fields here as fixers
 * need them rather than casting at a call site.
 */
/** NEO-345 / NEO-478 — `cardChecklist.teamCheckOutcome`, as the client reads it. */
export type TeamCheckOutcome = "answered" | "gaveUp" | "checklist";

export type CardChecklistRow = {
  _id: Id<"cardChecklist">;
  cardNumber: string;
  cardName: string;
  playerIds?: Array<Id<"players">>;
  /** NEO-528: players pictured on the card but not its subject ("Also on this card"). */
  secondaryPlayerIds?: Array<Id<"players">>;
  /** NEO-254: the name each linked player was printed with. Read for the title-has-no-player check. */
  playerLinks?: Array<{ playerId: Id<"players">; nameOnCard: string }>;
  teamOnCardIds?: Array<Id<"teams">>;
  teamCheckDoneAt?: number;
  /**
   * NEO-345: why the background BSC team check finished, written with every
   * `teamCheckDoneAt` stamp — "answered" (BSC replied) or "gaveUp" (retries
   * ran out); NEO-478 adds "checklist" (the operator's published checklist
   * settled the team, so BSC was never asked). Absent on a row stamped
   * before the field existed. Read only by the missing-team fixer's one-line
   * account of the card's case.
   */
  teamCheckOutcome?: TeamCheckOutcome;
  teamNoneConfirmedAt?: number;
  /**
   * NEO-236: the team name BSC returned that matched no `teams` row.
   *
   * A HINT for the operator, not a team. `deriveCardAttention` must never
   * read it: a card carrying one is still "missing team" — that is the whole
   * reason it is here rather than in `pendingTeamNames`, which the attention
   * rule counts as HAVING a team and which would take the card straight out
   * of the lane `MissingTeamFixer` works.
   */
  bscTeamName?: string;
  /**
   * NEO-102: team names an operator typed that no `teams` row exists for yet.
   * `deriveCardAttention` counts a non-empty list as HAVING a team — leave
   * this off the row and every card carrying a typed team gets badged "no
   * team" and walked.
   *
   * NEO-208: the quick-add form used to write these (it had a free-text Team
   * box) and now sends real `teamOnCardIds` instead, so this is legacy state
   * the product no longer creates — see the field note in
   * convex/features/cardAttention.ts.
   */
  pendingTeamNames?: string[];
  /**
   * NEO-221 (D12): player names the commit could not resolve, because their
   * entity-review rows were never decided. Same storage and same self-healing
   * route as `pendingTeamNames` above — the next sync's
   * `resolveUnknownsAndStartBatch` folds them into a fresh batch — but unlike
   * that field this one has no "counts as answered" clause: a typed player
   * name is not a player LINK, and nothing else on the row stands in for one.
   * `UnreviewedNameFixer` renders these, so leaving the field off the type
   * would hand the operator a fixer that shows no names.
   */
  pendingPlayerNames?: string[];
  /**
   * NEO-102: `deriveCardAttention` reads `bsc.ref`'s presence — a BSC-linked
   * card has an automatic team source still to come, so it is not badged until
   * `teamCheckDoneAt` says that lookup has been and gone. A card without one
   * (custom, or SportLots-only) has nothing to wait for. So this field is NOT
   * decoration on the type: leave it off and every fixer sees a card as though
   * it had no marketplace link.
   */
  platformData?: {
    bsc?: { ref: string; src?: string };
    sportlots?: { ref: string; src?: string };
  };
  /**
   * Stamped alongside `teamNoneConfirmedAt`. Declared so a whole stored row
   * assigns without a cast, and deliberately NEVER RENDERED — who answered is
   * an audit fact, not something to put on an operator's screen.
   */
  teamNoneConfirmedByUserId?: string;
  attributes?: string[];
  cardVariation?: string;
  /**
   * NEO-101: the marketplace-agnostic listing title, authored once at creation
   * and edited by hand thereafter. `TitleFixer` pre-fills its input from this,
   * so leaving it off the row would hand the operator an EMPTY field for a
   * title that already exists — and Save would then blank it.
   */
  listingTitle?: string;
  /**
   * NEO-101: the auto-generated title did not fit and was cut at a word
   * boundary. Read only for the wording of the fixer's note; the attention item
   * itself comes from `deriveCardAttention`, and any write of `listingTitle`
   * clears this server-side.
   */
  listingTitleTruncated?: boolean;
  autographType?: string;
  printRun?: number;
  /** NEO-645: the card's feature map; `autographed` answers the autograph tile. */
  features?: Record<string, string>;
  /** NEO-645: the numbers each source printed, kept when they differ (Match Cards). */
  sourceNumbers?: { bsc?: string; sportlots?: string; checklist?: string };
  /** NEO-645: fields on which the sources still disagree (the pink Sources tile). */
  sourceDisagreements?: TidyDisagreement[];
  /** NEO-645: the card's own photos; the face on the walk draws them. */
  imageUrls?: { front?: string; back?: string };
};
