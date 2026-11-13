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

/**
 * Ceiling on the "Set name in titles" box (NEO-535: raised from 60). The box
 * holds the WHOLE set description a title opens with, and a title is 80
 * characters, so 80 is the most it could ever usefully say.
 */
export const MAX_LISTING_SHORT_NAME_LENGTH = 80;

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
        ? "Set name in titles can't hold zero-width or invisible characters."
        : "Set name in titles can't hold line breaks or control characters.",
    );
  }
  if (trimmed.length > MAX_LISTING_SHORT_NAME_LENGTH) {
    throw new ConvexError(
      `Set name in titles tops out at ${MAX_LISTING_SHORT_NAME_LENGTH} characters.`,
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
  /**
   * NEO-535 — the box text ("Set name in titles") the leaf's cards get: the
   * nearest self-or-ancestor value, up to the setName row, with the insert's
   * name appended when the value sits above the insert row and the parallel
   * leaf's name appended when it sits above the leaf (see `titleChainFacts`).
   */
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
  let insertIndex: number | undefined;
  let shortIndex: number | undefined;
  let short: string | undefined;
  for (const [index, row] of chain.entries()) {
    if (index === 0 && derivedVariantFlags(row.level, variantType)?.isParallel === true) {
      facts.parallelLeafValue = row.value;
    }
    if (row.level === "insert" && insertIndex === undefined) {
      insertIndex = index;
      if (derivedVariantFlags(row.level, variantType)?.isInsert === true) {
        facts.insertNameValue = row.value;
        facts.insertIsRole = true;
      }
    }
    const value = row.metadata?.listingShortName?.trim();
    if (value && short === undefined) {
      short = value;
      shortIndex = index;
    }
  }
  if (short !== undefined && shortIndex !== undefined) {
    // NEO-535 — a value covers its own row and everything above it. Stored
    // above the insert row, the cards still need their insert's name; stored
    // above a parallel leaf, the parallel's. Appended verbatim (the box is the
    // operator's text, and nothing is prepended to it), and skipped when the
    // value already says it, in any spelling `roughlySays` folds together.
    if (facts.insertIsRole && insertIndex !== undefined && shortIndex > insertIndex) {
      short = appendUnsaid(short, facts.insertNameValue);
    }
    if (facts.parallelLeafValue !== undefined && shortIndex > 0) {
      short = appendUnsaid(short, facts.parallelLeafValue);
    }
    facts.listingShortName = short;
  }
  return facts;
}

/** The autograph spellings a set description uses for one word. */
const AUTO_WORDS: ReadonlySet<string> = new Set([
  "au",
  "auto",
  "autos",
  "autograph",
  "autographs",
  "autographed",
]);

/**
 * A word folded for `roughlySays`: lower-cased, edge punctuation dropped, the
 * autograph spellings made one word, and a plural "s" dropped (not from "ss",
 * nor from a word of three letters or fewer).
 */
function foldWord(word: string): string {
  const bare = word.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
  if (AUTO_WORDS.has(bare)) return "auto";
  if (bare.length > 3 && bare.endsWith("s") && !bare.endsWith("ss")) return bare.slice(0, -1);
  return bare;
}

function foldedWords(text: string): string[] {
  return text.split(/\s+/).map(foldWord).filter(Boolean);
}

/**
 * NEO-535 — does `text` already say every word of `name`, allowing another
 * spelling of a word? Case, a plural "s" and the autograph spellings are
 * folded, so a box reading "Gold Prospect Auto" already says the insert
 * "Gold Prospects Autographs". The old short names (before NEO-535) named an
 * insert in exactly these shortened forms, so the read-time append below
 * would otherwise say the insert twice.
 */
export function roughlySays(text: string, name: string): boolean {
  const wanted = foldedWords(name);
  if (wanted.length === 0) return false;
  const present = new Set(foldedWords(text));
  return wanted.every((w) => present.has(w));
}

/** `text` then `name`, unless `text` already says it (`roughlySays`). */
function appendUnsaid(text: string, name: string | undefined): string {
  const trimmed = name?.trim();
  if (!trimmed || roughlySays(text, trimmed)) return text;
  return `${text} ${trimmed}`;
}
