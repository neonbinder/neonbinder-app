/**
 * NEO-535 — one-time rewrite of stored "Set name in titles" values
 * (`selectorOptions.metadata.listingShortName`) to their new meaning.
 *
 * ## What changed
 *
 * Before NEO-535 the stored value was a SHORT NAME: the title builder put the
 * year, and the maker unless the value already started with it (or the brand
 * is unknown, NEO-272), in front of it, and the value took the place of the
 * set's and insert's words. A parallel stayed a tail token after the players.
 *
 * Since NEO-535 the value is the WHOLE set description, used verbatim, and
 * `listingShortName.titleChainFacts` appends the insert's name when the value
 * sits above the insert row and the parallel's when it sits above a parallel
 * leaf (each skipped when the value already says every word of it).
 *
 * ## What this writes
 *
 * For each row carrying a value (`planShortName`):
 *
 *   - Already full (starts with the year as a word): unchanged. This is what
 *     makes a second run a no-op, and it leaves a value an operator typed
 *     under the new meaning alone.
 *   - Otherwise: year + maker (unless the value starts with the maker, or the
 *     brand is unknown) + the stored text, which is exactly what the old
 *     builder put in front of the players. On a parallel leaf the parallel's
 *     name is appended too (the old builder's tail token; the new box is the
 *     whole description, and nothing appends a leaf's own parallel), unless
 *     the text already says it or the leaf is named for the Base kind
 *     (`variantRole.variantTypeKindFromTitle`).
 *
 * ## Insert and parallel appending: no doubled words
 *
 * A value stored above an insert row or a parallel leaf gets that name
 * appended at read time, unless it already says it. The old short names
 * often said the insert in a shortened spelling ("Gold Prospect Auto" for
 * "Gold Prospects Autographs"); `titleChainFacts` reads that as already said
 * (`listingShortName.roughlySays` folds case, a plural "s" and the autograph
 * spellings), so the rewrite here writes only the row's own value and never
 * a row below it. A name the text does not say at all is appended, which is
 * the NEO-535 rule (a value covers its own row and everything above it, and
 * the cards below still need their insert's name).
 *
 * ## What it never touches
 *
 * Only `metadata.listingShortName`, the other metadata keys kept as they are.
 * Never a card row or a title, never `lastUpdated` (a re-sync baseline).
 * A value that would run past `MAX_LISTING_SHORT_NAME_LENGTH` (80) is not
 * written, nor anything else for that row; it is counted and sampled for an
 * operator to shorten by hand.
 *
 * ## Rewriting operator text is opt-in, and approved once
 *
 * Every stored value is text an operator typed, so the run rewrites nothing
 * unless `rewriteExisting: true` is passed; without it, even an armed run
 * reports each value it would rewrite as `keptExisting`. Jason, 2026-11-13
 * (NEO-535): the rewrite to the new meaning is approved — run with
 * `rewriteExisting: true` once.
 *
 * ## Operator commands
 *
 *   # 1. dry run — reports what the approved rewrite would do, writes nothing
 *   #    (on a transaction read-limit failure, add "numItems":50 as below)
 *   npx convex run backfillListingShortNames:run '{"rewriteExisting":true}'
 *
 *   # 2. arm the deployment, run the approved rewrite once, disarm
 *   npx convex env set ALLOW_SHORT_NAME_BACKFILL 1
 *   npx convex run backfillListingShortNames:run '{"confirm":"BACKFILL","rewriteExisting":true}'
 *   #    a run that stops early returns `continueCursor`; resume with
 *   npx convex run backfillListingShortNames:run '{"confirm":"BACKFILL","rewriteExisting":true,"cursor":"<continueCursor>"}'
 *   #    a page that fails on the transaction read limit wrote nothing (a page
 *   #    is one transaction): re-run from the last cursor with fewer rows a
 *   #    page, e.g. 50
 *   npx convex run backfillListingShortNames:run '{"confirm":"BACKFILL","rewriteExisting":true,"cursor":"<continueCursor>","numItems":50}'
 *   npx convex env remove ALLOW_SHORT_NAME_BACKFILL
 *
 *   # 3. verify: a dry run reports rewritten 0 and keptExisting 0
 *   npx convex run backfillListingShortNames:run '{"rewriteExisting":true}'
 *
 *   # production: the same commands with --prod
 *
 * Two arms (see `backfillBrandUnknownRole.ts`): `confirm: "BACKFILL"` per
 * invocation and `ALLOW_SHORT_NAME_BACKFILL` per deployment. Dry run is the
 * default; an armed invocation on an unarmed deployment is refused in the
 * report, not thrown, and the page mutation re-checks both arms itself. No
 * `--identity`: internal functions, the deploy credential is the gate.
 *
 * Run it right after the NEO-535 deploy: a value an operator types after the
 * deploy that does not start with the year would be read as an old one.
 */

import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  internalAction,
  internalMutation,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  MAX_LISTING_SHORT_NAME_LENGTH,
  roughlySays,
  titleChainFacts,
  type TitleChainRow,
} from "./listingShortName";
import { variantTypeKindFromTitle } from "./variantRole";

/** The string an armed run must carry. */
export const CONFIRM_TOKEN = "BACKFILL";

/** The deployment-level arm. */
export const ENV_FLAG = "ALLOW_SHORT_NAME_BACKFILL";

/** Rows of one level read per page mutation. */
export const ROWS_PER_PAGE = 200;

/** The action stops starting new pages after this long. */
export const RUN_BUDGET_MS = 150_000;

/** Samples reported per run. Counts are always exact. */
export const MAX_SAMPLES = 5;

/** The levels a value lives on, in scan order. */
const LEVELS = ["setName", "variantType", "insert", "parallel"] as const;
type Level = (typeof LEVELS)[number];

const MAX_DEPTH = 16;

function deploymentIsArmed(): boolean {
  const value = process.env[ENV_FLAG];
  return value === "1" || value === "true";
}

const NOT_ARMED_MESSAGE =
  `Refused: this deployment is not armed for the short-name rewrite. ` +
  `Set ${ENV_FLAG}=1 on it (npx convex env set ${ENV_FLAG} 1), re-run, and ` +
  `remove the flag afterwards. Nothing was written; the report below is what ` +
  `an armed run would have done.`;
const APPLIED_MESSAGE = "Applied. Re-run as a dry run to confirm the steady state.";
const DRY_RUN_MESSAGE =
  `Dry run — nothing written. Arm with ${ENV_FLAG}=1 on the deployment and ` +
  `re-run with {"confirm":"${CONFIRM_TOKEN}"} to apply.`;
const UNFINISHED_NOTE =
  " Stopped before the end of the table: resume with the returned continueCursor.";

// ── Words ───────────────────────────────────────────────────────────────────

function startsWithWord(value: string, prefix: string): boolean {
  if (!prefix) return false;
  if (!value.toLowerCase().startsWith(prefix.toLowerCase())) return false;
  const boundary = value[prefix.length];
  return boundary === undefined || /\s/.test(boundary);
}

/** `text` then `name` unless `text` roughly says it already. */
function appendUnlessRoughlySaid(text: string, name: string | undefined): string {
  const trimmed = name?.trim();
  if (!trimmed || roughlySays(text, trimmed)) return text;
  return `${text} ${trimmed}`;
}

// ── The plan ────────────────────────────────────────────────────────────────

/** What the old builder knew about a row's set: the year and the maker. */
export type SetHead = { year?: string; maker?: string };

/**
 * The new value for an old one: year + maker + the stored text, as the old
 * builder said it in front of the players, and a parallel leaf's own name
 * after it. Unchanged when the text already starts with the year.
 */
export function rewriteShortName(
  stored: string,
  head: SetHead,
  ownParallel?: string,
): string {
  const text = stored.trim();
  const year = head.year?.trim();
  if (year && startsWithWord(text, year)) return text;
  const maker = head.maker?.trim();
  const tokens: string[] = [];
  if (year) tokens.push(year);
  if (maker && !startsWithWord(text, maker)) tokens.push(maker);
  tokens.push(text);
  let out = tokens.join(" ");
  const parallel = ownParallel?.trim();
  // A leaf named for the Base kind ("Base") is no parallel to name: the role
  // helper reads the word, never a literal here.
  if (parallel && variantTypeKindFromTitle(parallel) !== "base") {
    out = appendUnlessRoughlySaid(out, parallel);
  }
  return out;
}

/** A chain row as `titleChainFacts` reads it, for the row's roles only. */
function chainRow(row: Doc<"selectorOptions">): TitleChainRow {
  return { level: row.level, value: row.value };
}

export type ShortNamePlan =
  | { action: "unchanged" }
  | { action: "rewritten" | "overLimit"; next: string };

/** The row's chain up to the setName row (leaf first), and the set's year and maker. */
async function chainOf(
  ctx: { db: QueryCtx["db"] },
  row: Doc<"selectorOptions">,
): Promise<{ chain: Doc<"selectorOptions">[]; head: SetHead }> {
  const chain: Doc<"selectorOptions">[] = [row];
  let setRow: Doc<"selectorOptions"> | null = row.level === "setName" ? row : null;
  let cursor = setRow ? undefined : row.parentId;
  for (let depth = 0; !setRow && cursor && depth < MAX_DEPTH; depth++) {
    const node: Doc<"selectorOptions"> | null = await ctx.db.get(cursor);
    if (!node) break;
    chain.push(node);
    if (node.level === "setName") setRow = node;
    cursor = node.parentId;
  }
  // Above the set: the maker row, then the year row.
  let makerRow: Doc<"selectorOptions"> | null = null;
  let yearRow: Doc<"selectorOptions"> | null = null;
  let above = setRow?.parentId;
  for (let depth = 0; above && depth < MAX_DEPTH && !yearRow; depth++) {
    const node: Doc<"selectorOptions"> | null = await ctx.db.get(above);
    if (!node) break;
    if (node.level === "manufacturer" && !makerRow) makerRow = node;
    if (node.level === "year") yearRow = node;
    above = node.parentId;
  }
  // The old builder read the year and maker off the card's features (the
  // leaf's snapshot); the row's own snapshot, then the chain's rows.
  const year = row.features?.season?.trim() || yearRow?.value?.trim() || undefined;
  const brandUnknown = makerRow?.metadata?.isBrandUnknown === true;
  const maker = brandUnknown
    ? undefined
    : row.features?.manufacturer?.trim() || makerRow?.value?.trim() || undefined;
  return { chain, head: { year, maker } };
}

/**
 * ONE planner for the dry run and the armed run. Reads only; the caller
 * writes `next` onto this row alone on an armed run.
 */
export async function planShortName(
  ctx: { db: QueryCtx["db"] },
  row: Doc<"selectorOptions">,
): Promise<ShortNamePlan> {
  const stored = row.metadata?.listingShortName?.trim();
  if (!stored) return { action: "unchanged" };
  const { chain, head } = await chainOf(ctx, row);
  const ownFacts = titleChainFacts(chain.map((r) => chainRow(r)));
  const ownParallel = ownFacts.parallelLeafValue !== undefined
    ? row.features?.parallelName?.trim() || row.value
    : undefined;
  const next = rewriteShortName(stored, head, ownParallel);
  if (next === stored) return { action: "unchanged" };
  if (next.length > MAX_LISTING_SHORT_NAME_LENGTH) return { action: "overLimit", next };
  return { action: "rewritten", next };
}

// ── Functions ───────────────────────────────────────────────────────────────

const countsValidator = v.object({
  scanned: v.number(),
  withShortName: v.number(),
  rewritten: v.number(),
  unchanged: v.number(),
  overLimit: v.number(),
  keptExisting: v.number(),
});
type Counts = {
  scanned: number;
  withShortName: number;
  rewritten: number;
  unchanged: number;
  overLimit: number;
  keptExisting: number;
};
function emptyCounts(): Counts {
  return {
    scanned: 0,
    withShortName: 0,
    rewritten: 0,
    unchanged: 0,
    overLimit: 0,
    keptExisting: 0,
  };
}

const sampleValidator = v.object({
  rowId: v.id("selectorOptions"),
  level: v.string(),
  /** The row's own name. */
  name: v.string(),
  action: v.union(
    v.literal("rewritten"),
    v.literal("overLimit"),
    v.literal("keptExisting"),
  ),
  before: v.string(),
  after: v.string(),
});
type Sample = {
  rowId: Id<"selectorOptions">;
  level: string;
  name: string;
  action: "rewritten" | "overLimit" | "keptExisting";
  before: string;
  after: string;
};

/** Patch ONLY `metadata.listingShortName`, every other key kept, no `lastUpdated`. */
async function writeShortName(
  ctx: Pick<MutationCtx, "db">,
  id: Id<"selectorOptions">,
  value: string,
): Promise<void> {
  const row = await ctx.db.get(id);
  if (!row) return;
  await ctx.db.patch(id, { metadata: { ...(row.metadata ?? {}), listingShortName: value } });
}

/** One page of one level's rows. Writes only when both arms are present. */
export const backfillListingShortNamesPage = internalMutation({
  args: {
    level: v.union(v.literal("setName"), v.literal("variantType"), v.literal("insert"), v.literal("parallel")),
    cursor: v.union(v.string(), v.null()),
    confirm: v.optional(v.string()),
    numItems: v.optional(v.number()),
    /** Rewrite stored values (operator text). Without it nothing is rewritten. */
    rewriteExisting: v.optional(v.boolean()),
  },
  returns: v.object({
    armed: v.boolean(),
    counts: countsValidator,
    samples: v.array(sampleValidator),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const armed = args.confirm === CONFIRM_TOKEN && deploymentIsArmed();
    const requested = Number.isFinite(args.numItems) ? Math.floor(args.numItems as number) : ROWS_PER_PAGE;
    const numItems = Math.max(1, Math.min(ROWS_PER_PAGE, requested));
    const page = await ctx.db
      .query("selectorOptions")
      .withIndex("by_level", (q) => q.eq("level", args.level))
      .paginate({ numItems, cursor: args.cursor });
    const counts = emptyCounts();
    const samples: Sample[] = [];
    const sample = (s: Sample) => {
      if (samples.length < MAX_SAMPLES) samples.push(s);
    };
    for (const row of page.page) {
      counts.scanned += 1;
      const stored = row.metadata?.listingShortName?.trim();
      if (!stored) continue;
      counts.withShortName += 1;
      const plan = await planShortName(ctx, row);
      if (plan.action === "unchanged") {
        counts.unchanged += 1;
        continue;
      }
      // Every stored value is an operator's text: rewritten only on request.
      const action = plan.action === "rewritten" && args.rewriteExisting !== true ? "keptExisting" : plan.action;
      counts[action] += 1;
      sample({ rowId: row._id, level: row.level, name: row.value, action, before: stored, after: plan.next });
      if (action === "rewritten" && armed) await writeShortName(ctx, row._id, plan.next);
    }
    return { armed, counts, samples, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

type RunCursor = { l: number; c: string | null };

function parseRunCursor(raw: string | undefined): RunCursor {
  if (!raw) return { l: 0, c: null };
  try {
    const parsed = JSON.parse(raw) as RunCursor;
    if (Number.isInteger(parsed.l) && parsed.l >= 0 && parsed.l < LEVELS.length) {
      return { l: parsed.l, c: typeof parsed.c === "string" ? parsed.c : null };
    }
  } catch {
    // fall through: a bad cursor starts from the beginning
  }
  return { l: 0, c: null };
}

export const run = internalAction({
  args: {
    /** `"BACKFILL"` states the intent to write; anything else is a dry run. */
    confirm: v.optional(v.string()),
    /** A previous run's `continueCursor`. */
    cursor: v.optional(v.string()),
    /** Rows per page, 1..`ROWS_PER_PAGE`. */
    numItems: v.optional(v.number()),
    /** Stop after this many pages and hand back the cursor. */
    maxPages: v.optional(v.number()),
    /**
     * Rewrite stored values. Every value is an operator's text, so without
     * this an armed run writes nothing and reports `keptExisting`.
     */
    rewriteExisting: v.optional(v.boolean()),
  },
  returns: v.object({
    armed: v.boolean(),
    message: v.string(),
    pages: v.number(),
    isDone: v.boolean(),
    continueCursor: v.optional(v.string()),
    counts: countsValidator,
    samples: v.array(sampleValidator),
  }),
  handler: async (ctx, args) => {
    const intendsToWrite = args.confirm === CONFIRM_TOKEN;
    const refusedForFlag = intendsToWrite && !deploymentIsArmed();
    const startedAt = Date.now();
    const totals = emptyCounts();
    const samples: Sample[] = [];
    let position = parseRunCursor(args.cursor);
    let pages = 0;
    let isDone = false;
    let armed = false;
    const maxPages =
      args.maxPages !== undefined && Number.isFinite(args.maxPages)
        ? Math.max(1, Math.floor(args.maxPages))
        : Number.POSITIVE_INFINITY;
    for (;;) {
      const level: Level = LEVELS[position.l];
      const page: {
        armed: boolean;
        counts: Counts;
        samples: Sample[];
        isDone: boolean;
        continueCursor: string;
      } = await ctx.runMutation(internal.backfillListingShortNames.backfillListingShortNamesPage, {
        level,
        cursor: position.c,
        ...(intendsToWrite && !refusedForFlag ? { confirm: CONFIRM_TOKEN } : {}),
        ...(args.numItems !== undefined ? { numItems: args.numItems } : {}),
        ...(args.rewriteExisting ? { rewriteExisting: true } : {}),
      });
      pages += 1;
      armed = armed || page.armed;
      for (const key of Object.keys(totals) as Array<keyof Counts>) totals[key] += page.counts[key];
      for (const s of page.samples) if (samples.length < MAX_SAMPLES) samples.push(s);
      if (page.isDone) {
        if (position.l === LEVELS.length - 1) {
          isDone = true;
          break;
        }
        position = { l: position.l + 1, c: null };
      } else {
        position = { l: position.l, c: page.continueCursor };
      }
      if (pages >= maxPages || Date.now() - startedAt >= RUN_BUDGET_MS) break;
    }

    // ONE audit line: counts and flags only, never a row's text.
    console.log(
      JSON.stringify({
        msg: "backfill_listing_short_names",
        armed,
        refusedForFlag,
        rewriteExisting: args.rewriteExisting === true,
        resumed: args.cursor !== undefined,
        pages,
        isDone,
        ...totals,
      }),
    );

    const base = refusedForFlag ? NOT_ARMED_MESSAGE : armed ? APPLIED_MESSAGE : DRY_RUN_MESSAGE;
    return {
      armed,
      message: isDone ? base : base + UNFINISHED_NOTE,
      pages,
      isDone,
      ...(!isDone ? { continueCursor: JSON.stringify(position) } : {}),
      counts: totals,
      samples,
    };
  },
});
