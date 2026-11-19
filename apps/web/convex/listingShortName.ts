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
import { derivedVariantFlags, variantTypeKindFromTitle } from "./variantRole";
import type { Id } from "./_generated/dataModel";

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
 * NEO-609 — one level of the chain as the title names it: the level's own NB
 * name and the name of the variant type above it. Top level first in
 * `TitleChainFacts.titleLevels`. See `ListingTitleLevel` in
 * `features/generateListing` (same shape; this file is the pure-validator side).
 */
export type TitleLevelFact = {
  name: string;
  typeName?: string;
  /** A card sitting directly on the Base variant type (its KIND, never a name). */
  base?: true;
};

/** `TitleLevelFact` as a validator, for every hand-kept copy of the facts. */
export const titleLevelValidator = v.object({
  name: v.string(),
  typeName: v.optional(v.string()),
  base: v.optional(v.literal(true)),
});

/**
 * The chain's title facts: the `ListingSetContext` fields NEO-335 adds, and
 * (NEO-609) every level.
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
  /**
   * NEO-609 — EVERY level of the chain below the set, top level first, named
   * by the variant-type rows: an insert-level row is {its value, its type's
   * value}; a sub-variant row is {its value, "Parallel"} (it has no type row
   * of its own); a card sitting directly on a variant type that is not Base
   * is {the type's value} (Base included: the title says it and cuts it first).
   * Omitted when the chain has no level.
   * Unlike `insertNameValue` / `parallelLeafValue` (kept: the eBay aspects
   * read them), no NB role gates it: a "Proof" type's rows name their cards.
   */
  titleLevels?: TitleLevelFact[];
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
  titleLevels: v.optional(v.array(titleLevelValidator)),
};

/**
 * Every title fact, copied from `source` by KEY, so a caller that hands the
 * facts from one place to another (the commit prelude to its chunks) names
 * none of them: a new fact in `titleChainFactsFields` travels on its own.
 * Keys with no value are left off, so a set with no facts hands on exactly the
 * context it had before.
 */
export function pickTitleChainFacts(source: TitleChainFacts): TitleChainFacts {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(titleChainFactsFields)) {
    const value = (source as Record<string, unknown>)[key];
    if (value !== undefined) out[key] = value;
  }
  return out as TitleChainFacts;
}

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
  // NEO-609 — the levels, leaf first, each with its chain index (below).
  const levels: Array<TitleLevelFact & { index: number }> = [];
  const typeName = variantType?.value?.trim();
  for (const [index, row] of chain.entries()) {
    if (row.level === "parallel") {
      levels.push({ index, name: row.value, typeName: SUB_VARIANT_TYPE_NAME });
    } else if (row.level === "insert") {
      levels.push({ index, name: row.value, ...(typeName ? { typeName } : {}) });
    } else if (row.level === "variantType" && index === 0) {
      // A card sitting directly on a variant type. Base included (NEO-609, Q1:
      // the title says "Base" and cuts it first): flagged by the type's KIND.
      // Named in the singular, as a type name is everywhere else.
      if (variantTypeKindFromTitle(row.value) === "base") {
        levels.push({ index, name: row.value, base: true });
      } else {
        levels.push({ index, name: singularTypeName(row.value) });
      }
    }
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
    // NEO-609 — every level below the box's row, top level first (never a
    // type name): the box says the set, and the levels it does not cover are
    // the card's own. A level lower than the first is appended as its own
    // words only: its leading words the level above it says are said once.
    let above: string | undefined;
    for (const level of [...levels].reverse()) {
      // Base is not part of the description a box stands for (the title cuts
      // it first); a box title never says it.
      if (level.base) continue;
      if (level.index < shortIndex) {
        short = appendUnsaid(
          short,
          above === undefined ? level.name : parallelAfterInsert(level.name, above),
        );
      }
      above = level.name;
    }
    facts.listingShortName = short;
  }
  if (levels.length > 0) {
    facts.titleLevels = levels.reverse().map(({ name, typeName, base }) => ({
      name,
      ...(typeName ? { typeName } : {}),
      ...(base ? { base } : {}),
    }));
  }
  return facts;
}

/**
 * NEO-609 — a sub-variant row has no variant type of its own (it hangs under
 * an insert row), so its type name is the NB word for what it is.
 */
const SUB_VARIANT_TYPE_NAME = "Parallel";

/**
 * A word in the singular, by suffix alone: "Inserts" -> "Insert", "Legacies"
 * -> "Legacy", "Rookies" -> "Rookie" (a "kies" word keeps its "ie"). A word
 * ending in ss, us, is, series or species, and one already singular, is left
 * alone.
 */
export function singularWord(word: string): string {
  const lower = word.toLowerCase();
  if (lower.length < 3 || /(ss|us|is)$/.test(lower) || !lower.endsWith("s")) return word;
  // The two English words that are their own plural.
  if (/(series|species)$/.test(lower)) return word;
  if (lower.length > 4 && lower.endsWith("ies") && !lower.endsWith("kies")) {
    const y = word.endsWith("S") ? "Y" : "y";
    return `${word.slice(0, -3)}${y}`;
  }
  return word.slice(0, -1);
}

/**
 * A variant type's name as a title, a description line and a preview chip
 * say it (one source, so they agree): the singular of its LAST word, so
 * "Short Prints" reads "Short Print".
 */
export function singularTypeName(typeName: string): string {
  const words = typeName.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  words[words.length - 1] = singularWord(words[words.length - 1]);
  return words.join(" ");
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

/**
 * NEO-535 — a parallel's name as a description writes it after its insert:
 * the leading words it shares with the insert's name are said once, by the
 * insert. Jason's rule: "2026 Bowman Anime Red Refractors" reads
 * "2026 Bowman Anime Red Refractors", and "TRItanium Prismatic White
 * TRItanium Red Flood" reads "TRItanium Prismatic White Red Flood".
 *
 * Only a LEADING run, matched word by word from the start of both names
 * (folded as `roughlySays` folds: case, edge punctuation, a plural "s", the
 * autograph spellings). A shared word later in the name stays. Returns "" when
 * the parallel's name is all insert words (the insert already says it). The
 * one rule the builder's description (`generateListing`) and the box's
 * parallel append (`titleChainFacts`) both apply, so every title path agrees.
 */
export function parallelAfterInsert(parallel: string, insert: string | undefined): string {
  const { words, shared } = leadingInsertWords(parallel, insert);
  return words.slice(shared).join(" ");
}

/**
 * NEO-535 — does the parallel's name open with the insert's WHOLE name, word
 * for word and folded as `parallelAfterInsert` folds? "Anime Red Refractors"
 * under "Anime" does, and so does "Anime" under "Anime"; "Gold Refractor"
 * under "Gold Prospects" only shares a leading word, so it does not. The
 * description's opening line names such an insert once, through the
 * parallel's full name.
 */
export function parallelOpensWithInsert(parallel: string, insert: string | undefined): boolean {
  const { shared, insertLength } = leadingInsertWords(parallel, insert);
  return insertLength > 0 && shared === insertLength;
}

/** The parallel's words, and how many of them lead with the insert's words. */
function leadingInsertWords(
  parallel: string,
  insert: string | undefined,
): { words: string[]; shared: number; insertLength: number } {
  const words = parallel.trim().split(/\s+/).filter(Boolean);
  const insertWords = (insert ?? "").trim().split(/\s+/).filter(Boolean).map(foldWord);
  let shared = 0;
  while (
    shared < words.length &&
    shared < insertWords.length &&
    insertWords[shared] !== "" &&
    foldWord(words[shared]) === insertWords[shared]
  ) {
    shared += 1;
  }
  return { words, shared, insertLength: insertWords.length };
}

/** `text` then `name`, unless `text` already says it (`roughlySays`). */
function appendUnsaid(text: string, name: string | undefined): string {
  const trimmed = name?.trim();
  if (!trimmed || roughlySays(text, trimmed)) return text;
  return `${text} ${trimmed}`;
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
