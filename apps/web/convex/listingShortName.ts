/**
 * NEO-335 — the ONE rule for `selectorOptions.metadata.listingShortName`, and
 * the ONE reading of a set chain's title facts.
 *
 * Two doors write the short name — the attributes panel's
 * `setSelectorOptionListingShortName` and the card-checklist commit's
 * batch-level `listingShortName` (the wizard's Card titles step) — and both
 * call `normalizeListingShortName`, so they cannot apply two rules (the
 * NEO-291 finding `cardNumberPrefix.ts` exists for).
 *
 * Four walks read a chain for a new card's title — the commit prelude,
 * `findAncestorLabels` (hand-added cards and Regenerate), `titleSetFacts` (the
 * pre-save Card titles step) and the parallel build — and all four hand the
 * rows they walked to `titleChainFacts`, so the title shown before save, the
 * one written at insert and the one Regenerate offers read the same rows the
 * same way.
 *
 * Pure and dependency-light on purpose (`convex/values` and the pure
 * `variantRole` helpers only), so the SPA may import the cap and the rule (see
 * reference memory: client imports from convex only pure modules).
 */

import { ConvexError, v } from "convex/values";
import { derivedVariantFlags } from "./variantRole";
import type { Id } from "./_generated/dataModel";

/**
 * Ceiling on a short name. A title is 80 characters and the short name stands
 * in for the set and insert words of its core; anything near 60 is not short.
 */
export const MAX_LISTING_SHORT_NAME_LENGTH = 60;

/** The levels a short name may live on: the set and everything under it. */
export const LISTING_SHORT_NAME_LEVELS: ReadonlySet<string> = new Set([
  "setName",
  "variantType",
  "insert",
  "parallel",
]);

/**
 * Trim `raw` and return the short name to store, or `undefined` when it is
 * blank — `""` is never stored (the NEO-217 spelling).
 *
 * Throws a STRING `ConvexError` — the shape `userFacingMessage` shows
 * verbatim — for a line break, a control character or an invisible character
 * (a title nobody can see the fault in), or for one over the ceiling.
 */
export function normalizeListingShortName(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  // One Unicode-property test (NEO-335 security re-audit), not hand-listed
  // ranges: Cc covers C0 and C1 controls (incl. NEL U+0085), Zl/Zp the line
  // and paragraph separators, Cf every format character (zero-widths, bidi
  // overrides and isolates, LRM/RLM, the soft hyphen, U+061C, tag characters,
  // the BOM). No literal invisible character appears in this source.
  const forbidden = trimmed.match(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u);
  if (forbidden) {
    throw new ConvexError(
      /\p{Cf}/u.test(forbidden[0])
        ? "A short name cannot contain zero-width or invisible characters."
        : "A short name cannot contain line breaks or control characters.",
    );
  }
  if (trimmed.length > MAX_LISTING_SHORT_NAME_LENGTH) {
    throw new ConvexError(
      `A short name is at most ${MAX_LISTING_SHORT_NAME_LENGTH} characters.`,
    );
  }
  return trimmed;
}

/** The fields of a chain row `titleChainFacts` reads. */
export type TitleChainRow = {
  level: string;
  value: string;
  metadata?: {
    listingShortName?: string;
  };
};

/**
 * The chain's title facts: the four `ListingSetContext` fields NEO-335 adds.
 * Every key is omitted when it has nothing to say, so a set with no insert
 * role, no parallel leaf and no short name hands its chunks exactly the
 * context it did before.
 */
export type TitleChainFacts = {
  /** The insert-level row's value — only when it is an insert of an Insert type. */
  insertNameValue?: string;
  /** Always `true` when present; absent means "no insert in the core". */
  insertIsRole?: boolean;
  /** The LEAF's own value — only when the leaf is a parallel (see below). */
  parallelLeafValue?: string;
  /** The nearest self-or-ancestor short name, up to the setName row. */
  listingShortName?: string;
};

/**
 * The validator fields for `TitleChainFacts`, spread into every hand-kept
 * validator that carries a set context (the prelude's returns, the chunk's
 * args, `titleContextValidator`), so a fifth field is added in one place.
 */
export const titleChainFactsFields = {
  insertNameValue: v.optional(v.string()),
  insertIsRole: v.optional(v.boolean()),
  parallelLeafValue: v.optional(v.string()),
  listingShortName: v.optional(v.string()),
};

/**
 * Read the title facts off a chain, LEAF FIRST. Rows past the first `setName`
 * row are ignored, so a caller may pass the whole chain up to the sport.
 *
 * Roles only, never an insert's own name (product invariant 4). A row's role
 * is its level together with its variant type's KIND, and that kind is the
 * variant type's title (NEO-334, `variantRole.ts`): `derivedVariantFlags` is
 * the one reading, the same one a row is created with. So the insert name
 * enters only when the chain's insert-level row sits under an Insert type (an
 * insert-level row under a Parallel type is a parallel of base, not an
 * insert), and the leaf's value is a parallel name only when the leaf is a
 * sub-variant or an insert-level row under a Parallel type. A variant type
 * whose title has no kind ("Promo", "Insert Set") confers neither.
 *
 * The variant type is read off the chain itself — every caller walks up to
 * the setName row, so it is already in hand and costs no read.
 */
export function titleChainFacts(
  leafFirst: ReadonlyArray<TitleChainRow | null | undefined>,
): TitleChainFacts {
  const chain: Array<TitleChainRow> = [];
  for (const row of leafFirst) {
    if (!row) break;
    chain.push(row);
    if (row.level === "setName") break;
  }
  const variantType = chain.find((row) => row.level === "variantType");

  const facts: TitleChainFacts = {};
  let insertSeen = false;
  for (const [index, row] of chain.entries()) {
    if (index === 0 && derivedVariantFlags(row.level, variantType)?.isParallel === true) {
      facts.parallelLeafValue = row.value;
    }
    if (row.level === "insert" && !insertSeen) {
      insertSeen = true;
      if (derivedVariantFlags(row.level, variantType)?.isInsert === true) {
        facts.insertNameValue = row.value;
        facts.insertIsRole = true;
      }
    }
    const short = row.metadata?.listingShortName?.trim();
    if (short && facts.listingShortName === undefined) {
      facts.listingShortName = short;
    }
  }
  return facts;
}

/**
 * Walk a selectorOptions node's parent chain ONCE, collecting everything
 * listing generation needs from above the card: the setName display value
 * ("Chrome"), the sport display value ("Baseball"), and — NEO-272 — whether NB
 * has identified the brand of the set at all (a ROLE off
 * `metadata.isBrandUnknown` on the manufacturer in between, never its name).
 *
 * NEO-101 widened this from `findSetNameValue`, which returned early at the
 * setName level. The sport node sits ABOVE setName, so a second helper would
 * have meant a second walk over the same chain for every card previewed or
 * hand-added — the walk is the cost here, not the comparison, so both values
 * come out of one pass.
 *
 * Still deliberately narrow rather than a general ancestor-chain utility:
 * every other consumer of the chain already had its own reason to walk it
 * (commitCardChecklist resolves both in the prelude, once per commit, and
 * hands them to the chunks). Depth-bounded like
 * `findSportForSelectorOption`, so a cyclic or corrupted `parentId` cannot
 * spin a query.
 */
export async function findAncestorLabels(
  ctx: { db: { get: (id: Id<"selectorOptions">) => Promise<any> } },
  node: any,
): Promise<
  {
    setName?: string;
    sport?: string;
    manufacturerBrandUnknown?: boolean;
  } & TitleChainFacts
> {
  const labels: {
    setName?: string;
    sport?: string;
    manufacturerBrandUnknown?: boolean;
  } = {};
  if (!node) return labels;
  // NEO-335 — the rows from `node` up to and including the setName row, LEAF
  // FIRST, for `titleChainFacts` (the insert role, a parallel leaf, the
  // nearest short name). Collected on the way past: this walk already passes
  // every one of them before it can stop.
  const titleChain: any[] = [];
  let current = node;
  let depth = 0;
  while (current && depth < 16) {
    if (labels.setName === undefined) titleChain.push(current);
    if (current.level === "setName" && labels.setName === undefined) {
      labels.setName = current.value;
    }
    // NEO-272 — the manufacturer ROLE, not its name. Picked up on the way past
    // rather than by a walk of its own: the chain is
    // sport › year › manufacturer › setName › …, so walking UP from a card's
    // parent reaches the manufacturer AFTER setName and BEFORE sport, and the
    // break below waits for sport. Every chain that has a manufacturer level
    // therefore passes through it before this loop can stop.
    if (
      current.level === "manufacturer" &&
      labels.manufacturerBrandUnknown === undefined
    ) {
      labels.manufacturerBrandUnknown =
        current.metadata?.isBrandUnknown === true;
    }
    if (current.level === "sport" && labels.sport === undefined) {
      labels.sport = current.value;
    }
    // Deliberately NOT extended with `manufacturerBrandUnknown`. A chain with
    // no manufacturer level at all — a setName hung straight off a sport, which
    // is what most fixtures and some hand-built trees look like — would then
    // never satisfy the condition and would walk to the depth cap, paying extra
    // reads on every card previewed or hand-added to buy nothing. The value is
    // already collected above by the time sport is reached, so stopping here
    // loses nothing; leaving it absent is the same "no manufacturer role" answer
    // as `false`, which is exactly how the generator reads it.
    if (labels.setName !== undefined && labels.sport !== undefined) break;
    const parentId: Id<"selectorOptions"> | undefined = current.parentId;
    if (!parentId) break;
    current = await ctx.db.get(parentId);
    depth += 1;
  }
  return { ...labels, ...titleChainFacts(titleChain) };
}
