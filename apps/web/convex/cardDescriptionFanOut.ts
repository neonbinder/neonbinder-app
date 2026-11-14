/**
 * NEO-535 — a rename reaches the descriptions of the cards beneath it.
 *
 * A card's `listingDescription` names its players, its teams, its set, its
 * insert and its parallel (`generateListingDescription`), and collector search
 * reads it. `cardDescriptionRefresh` keeps it current when a CARD's own facts
 * change; this module does the same when a row many cards point at is
 * renamed:
 *
 *  - a player (`players.savePlayerFields`): every card carrying the player,
 *    through `cardPlayerLinks`;
 *  - a team, its name or its location (`teams.saveTeamFields`): every card
 *    printed with the team, through `cardTeamLinks`;
 *  - a set, insert or parallel row (`renameSelectorOption`, and the
 *    reconciliation modal's tier-0 title edit): every card in the row's
 *    subtree;
 *  - a set moved onto or off the year's Unknown brand (`brandRehome`), which
 *    decides whether its cards name their maker.
 *
 * Same rule as every other description writer: a card is rebuilt only when
 * its stored description is exactly the builder's for the card as it read
 * BEFORE the rename (`renamedListingDescription`, which lays the old values
 * over the reads), so a description a person wrote is left alone.
 *
 * ## Paged
 *
 * A rename can touch thousands of cards, so the work is a chain of internal
 * mutations, `RENAME_DESCRIPTION_PAGE` cards per run, each scheduling the
 * next, walking on index cursors (`_creationTime`, never `.paginate()`, so a
 * public mutation that runs a page keeps its one paginate). The operator's
 * own doors do the FIRST page inline (`refreshDescriptionsAfterRename` with
 * `inline: true`): an ordinary rename finishes in its own transaction and
 * schedules nothing, and a big one hands the chain the cursor it stopped at.
 * A page is idempotent: a card already rebuilt no longer matches the old
 * names, so re-reading it writes nothing.
 *
 * Not covered, on purpose:
 *  - a sport, year or manufacturer RENAME. A card's year and maker are its own
 *    `features` snapshot, copied at creation (a row rename does not rewrite
 *    them), and a sport rename would walk every card of the sport for one
 *    "Sport:" line;
 *  - a variant type rename: the title is its kind, and a rename that changes
 *    the kind is refused while rows sit beneath it (NEO-334), so the cards'
 *    descriptions cannot change;
 *  - legacy and backfill-only writers (`backfillTeamToOnCardIds`,
 *    `materializeSelectorOptionFeature`), and enrichment's location split
 *    (`teams.applyEnrichmentInternal`, `splitTeamLocations`), which moves a
 *    leading word between two fields without changing the full name.
 */

import { v, type Infer } from "convex/values";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { cardPlayerLinkPage } from "./cardPlayerLinks";
import { cardTeamLinkPage } from "./cardTeamLinks";
import {
  newRenameLookupCaches,
  renamedListingDescription,
  type DescriptionOverlay,
  type RenameLookupCaches,
} from "./cardDescriptionRefresh";

/** Cards per run. */
export const RENAME_DESCRIPTION_PAGE = 100;

/**
 * Selector rows a subtree page may finish per run, on top of its cards: an
 * empty row (a variant type with no cards of its own) costs a read and no
 * card, so the card budget alone would not bound a page of them.
 */
export const RENAME_DESCRIPTION_NODE_PAGE = 100;

/**
 * The runaway stop: pages one chain may run (~200,000 cards). A chain that
 * spends it logs and stops; every page so far is committed, and the next
 * rename of the same row starts over.
 */
export const RENAME_DESCRIPTION_MAX_PAGES = 2000;

/**
 * Row ids a subtree walk may hold pending. Convex caps an array argument at
 * 8,192 values, and the stack is carried to the next page as one.
 */
const MAX_PENDING_ROWS = 8000;

/** The selector levels whose own value a card's description says. */
export const DESCRIBED_ROW_LEVELS: ReadonlySet<Doc<"selectorOptions">["level"]> = new Set([
  "setName",
  "insert",
  "parallel",
]);

/** What was renamed, and how it read before. */
export const renameTargetValidator = v.union(
  v.object({
    kind: v.literal("player"),
    playerId: v.id("players"),
    before: v.object({ name: v.string() }),
  }),
  v.object({
    kind: v.literal("team"),
    teamId: v.id("teams"),
    before: v.object({ name: v.string(), location: v.optional(v.string()) }),
  }),
  v.object({
    kind: v.literal("rows"),
    rows: v.array(
      v.object({
        rowId: v.id("selectorOptions"),
        before: v.object({
          value: v.optional(v.string()),
          parentId: v.optional(v.id("selectorOptions")),
        }),
      }),
    ),
  }),
);
export type RenameTarget = Infer<typeof renameTargetValidator>;

/** Where the walk is: a link-table page cursor, or a subtree stack. */
const walkStateValidator = v.union(
  v.object({
    kind: v.literal("links"),
    /**
     * The last link row read: its `_creationTime`, and for a player its
     * `sportId` (the player index is `[playerId, sportId]`). `null` first.
     */
    after: v.union(
      v.null(),
      v.object({ sportId: v.optional(v.id("selectorOptions")), creationTime: v.number() }),
    ),
  }),
  v.object({
    kind: v.literal("subtree"),
    /** Rows still to visit; the LAST is the one being read. */
    stack: v.array(v.id("selectorOptions")),
    /** `_creationTime` of the last card read under the last row of `stack`. */
    after: v.optional(v.number()),
  }),
);
type WalkState = Infer<typeof walkStateValidator>;

function overlayFor(target: RenameTarget): DescriptionOverlay {
  switch (target.kind) {
    case "player":
      return new Map([[target.playerId as string, { name: target.before.name }]]);
    case "team":
      // `location: undefined` is the point when the team had none: it hides
      // the location the rename gave it.
      return new Map([
        [
          target.teamId as string,
          { name: target.before.name, location: target.before.location },
        ],
      ]);
    case "rows":
      return new Map(
        target.rows.map(({ rowId, before }) => [
          rowId as string,
          {
            ...(before.value !== undefined ? { value: before.value } : {}),
            ...(before.parentId !== undefined ? { parentId: before.parentId } : {}),
          },
        ]),
      );
  }
}

function firstState(target: RenameTarget): WalkState {
  return target.kind === "rows"
    ? { kind: "subtree", stack: target.rows.map((r) => r.rowId) }
    : { kind: "links", after: null };
}

type Visit = (card: Doc<"cardChecklist">) => Promise<void>;

/**
 * One page of a player's or team's link rows, through the link modules' own
 * readers (they are the sanctioned readers of their indexes): the card ids,
 * and the cursor after them, `null` when the walk is done.
 */
async function linkPage(
  ctx: MutationCtx,
  target: Extract<RenameTarget, { kind: "player" | "team" }>,
  after: Extract<WalkState, { kind: "links" }>["after"],
): Promise<{
  cardIds: Array<Id<"cardChecklist">>;
  next: Extract<WalkState, { kind: "links" }> | null;
}> {
  if (target.kind === "player") {
    const rows = await cardPlayerLinkPage(
      ctx,
      target.playerId,
      after?.sportId ? { sportId: after.sportId, creationTime: after.creationTime } : null,
      RENAME_DESCRIPTION_PAGE,
    );
    const last = rows[rows.length - 1];
    return {
      cardIds: rows.map((link) => link.cardChecklistId),
      next:
        rows.length < RENAME_DESCRIPTION_PAGE
          ? null
          : {
              kind: "links",
              after: { sportId: last.sportId, creationTime: last._creationTime },
            },
    };
  }
  const rows = await cardTeamLinkPage(
    ctx,
    target.teamId,
    after?.creationTime ?? null,
    RENAME_DESCRIPTION_PAGE,
  );
  const last = rows[rows.length - 1];
  return {
    cardIds: rows.map((link) => link.cardChecklistId),
    next:
      rows.length < RENAME_DESCRIPTION_PAGE
        ? null
        : { kind: "links", after: { creationTime: last._creationTime } },
  };
}

/**
 * One page of a subtree walk: up to `RENAME_DESCRIPTION_PAGE` cards and
 * `RENAME_DESCRIPTION_NODE_PAGE` finished rows. Cards are read per row on
 * `by_selector_option` with a `_creationTime` cursor (not `.paginate`, which
 * Convex allows once per execution, and a page crosses rows). A row's
 * children join the stack once its cards are done. `null` when the walk is.
 */
async function subtreePage(
  ctx: MutationCtx,
  state: Extract<WalkState, { kind: "subtree" }>,
  visit: Visit,
): Promise<WalkState | null> {
  const stack = [...state.stack];
  let after = state.after;
  let cards = 0;
  let rows = 0;
  while (stack.length > 0 && cards < RENAME_DESCRIPTION_PAGE && rows < RENAME_DESCRIPTION_NODE_PAGE) {
    const rowId = stack[stack.length - 1];
    const want = RENAME_DESCRIPTION_PAGE - cards;
    const since = after;
    const page = await ctx.db
      .query("cardChecklist")
      .withIndex("by_selector_option", (q) =>
        since === undefined
          ? q.eq("selectorOptionId", rowId)
          : q.eq("selectorOptionId", rowId).gt("_creationTime", since),
      )
      .take(want);
    for (const card of page) await visit(card);
    cards += page.length;
    if (page.length === want) {
      after = page[page.length - 1]._creationTime;
      continue;
    }
    // This row's cards are done: on to its children.
    stack.pop();
    after = undefined;
    rows += 1;
    const row = await ctx.db.get(rowId);
    for (const childId of row?.children ?? []) {
      if (stack.length >= MAX_PENDING_ROWS) {
        // Ids and counts only. Past this the stack could not be carried to
        // the next page at all; the rows not reached keep their descriptions.
        console.warn(
          JSON.stringify({
            msg: "rename_description_subtree_too_wide",
            rowId,
            pending: stack.length,
          }),
        );
        break;
      }
      stack.push(childId);
    }
  }
  return stack.length > 0 ? { kind: "subtree", stack, after } : null;
}

/** Rows `subtreeMayHoldCards` probes before it answers "maybe" anyway. */
const CARD_PROBE_ROWS = 50;

/**
 * Could any card sit in `row`'s subtree? The doors that only SCHEDULE the
 * fan-out ask first, so a rename of an empty row schedules nothing.
 * `subtreeCardCount` answers when it is set (NEO-358 keeps it from the set
 * down); a row it was never counted on is probed, one `.first()` per row,
 * and past `CARD_PROBE_ROWS` rows the answer is "maybe".
 */
export async function subtreeMayHoldCards(
  ctx: MutationCtx,
  row: Pick<Doc<"selectorOptions">, "_id" | "subtreeCardCount">,
): Promise<boolean> {
  if (row.subtreeCardCount !== undefined) return row.subtreeCardCount > 0;
  const stack: Array<Id<"selectorOptions">> = [row._id];
  let probed = 0;
  while (stack.length > 0) {
    if (probed >= CARD_PROBE_ROWS) return true;
    const rowId = stack.pop()!;
    probed += 1;
    const card = await ctx.db
      .query("cardChecklist")
      .withIndex("by_selector_option", (q) => q.eq("selectorOptionId", rowId))
      .first();
    if (card) return true;
    const node = await ctx.db.get(rowId);
    stack.push(...(node?.children ?? []));
  }
  return false;
}

/** Rebuild one card's description if the rename made it stale. */
function rebuilder(
  ctx: MutationCtx,
  overlay: DescriptionOverlay,
  caches: RenameLookupCaches,
  counts: { rewritten: number },
): Visit {
  return async (card) => {
    const listingDescription = await renamedListingDescription(ctx, card, overlay, caches);
    if (listingDescription === undefined) return;
    await ctx.db.patch(card._id, { listingDescription });
    counts.rewritten += 1;
  };
}

async function scheduleNext(
  ctx: MutationCtx,
  target: RenameTarget,
  state: WalkState,
  pagesLeft: number,
): Promise<void> {
  await ctx.scheduler.runAfter(0, internal.cardDescriptionFanOut.refreshRenamedCardDescriptions, {
    target,
    state,
    pagesLeft,
  });
}

/** One page of the walk at `state`: the state after it, `null` when done. */
async function runPage(
  ctx: MutationCtx,
  target: RenameTarget,
  state: WalkState,
  visit: Visit,
): Promise<WalkState | null> {
  if (state.kind === "subtree") return await subtreePage(ctx, state, visit);
  if (target.kind === "rows") return null;
  const page = await linkPage(ctx, target, state.after);
  for (const cardId of page.cardIds) {
    const card = await ctx.db.get(cardId);
    if (card) await visit(card);
  }
  return page.next;
}

/**
 * Start the fan-out for a rename that has just been written in this
 * transaction. `inline: true` (the operator's own rename doors) does the
 * first page here and schedules only what is left, from where the page
 * stopped; `inline: false` (doors that already spend their transaction on
 * other rows) schedules it all. Returns how many descriptions the inline
 * page rewrote.
 */
export async function refreshDescriptionsAfterRename(
  ctx: MutationCtx,
  target: RenameTarget,
  options: { inline: boolean },
): Promise<number> {
  if (target.kind === "rows" && target.rows.length === 0) return 0;
  if (!options.inline) {
    await scheduleNext(ctx, target, firstState(target), RENAME_DESCRIPTION_MAX_PAGES);
    return 0;
  }
  const counts = { rewritten: 0 };
  const visit = rebuilder(ctx, overlayFor(target), newRenameLookupCaches(), counts);
  const next = await runPage(ctx, target, firstState(target), visit);
  if (next) await scheduleNext(ctx, target, next, RENAME_DESCRIPTION_MAX_PAGES - 1);
  return counts.rewritten;
}

/**
 * One page of the fan-out, then itself again while there is more. See the
 * module note.
 */
export const refreshRenamedCardDescriptions = internalMutation({
  args: {
    target: renameTargetValidator,
    state: walkStateValidator,
    pagesLeft: v.number(),
  },
  returns: v.object({ rewritten: v.number(), done: v.boolean() }),
  handler: async (ctx, args) => {
    const counts = { rewritten: 0 };
    const visit = rebuilder(ctx, overlayFor(args.target), newRenameLookupCaches(), counts);
    const next = await runPage(ctx, args.target, args.state, visit);
    if (next === null) return { rewritten: counts.rewritten, done: true };
    if (args.pagesLeft <= 1) {
      // Counts only: a name is operator content, and the log is not its place.
      console.warn(
        JSON.stringify({
          msg: "rename_description_chain_stopped",
          kind: args.target.kind,
          pages: RENAME_DESCRIPTION_MAX_PAGES,
        }),
      );
      return { rewritten: counts.rewritten, done: true };
    }
    await scheduleNext(ctx, args.target, next, args.pagesLeft - 1);
    return { rewritten: counts.rewritten, done: false };
  },
});
