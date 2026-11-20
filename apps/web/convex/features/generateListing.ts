/**
 * NEO-24/71-74: auto-generate a card's marketplace-agnostic `listingTitle`
 * and `listingDescription` once, at card-creation time (write-once, same
 * model as every other default this session — the operator can freely edit
 * either field afterward; this module is never called again for an
 * existing row, except by the operator's own Regenerate).
 *
 * Pure functions only — no DB access. Callers (commitCardChecklist's insert
 * branch, addCustomCard, Regenerate, the wizard's pre-save Card titles step)
 * resolve player names / ancestor values first and pass them in as plain
 * data, through `listingInputs.listingInputsForCard`.
 *
 * ## The layout (NEO-535, approved by Jason 2026-11-13)
 *
 *   <description> [Insert/Parallel labels] <players> #<num>
 *     AUTO RELIC /<N> <variation> RC SP|SSP <teams> Rookie <sport>
 *
 * The description is the year, the maker and set, the insert's name and the
 * parallel's name. The parallel is part of the description, not the optional
 * tail. "Insert" follows the insert's name and "Parallel" the parallel's.
 *
 * A listing title is the only text eBay's search actually matches on, so an
 * unused character is a search term thrown away. Jason's research
 * (2026-09-02), two samples of SOLD listings: two-thirds of titles run 70-80
 * characters, 70% lead with the year, 82-93% carry the card number, ~50% name
 * the team, ~50% say RC or Rookie and a third of those use both words. So the
 * title starts FULL and is cut down, never built up from a short core.
 *
 * ## The cut loop (eBay's cap, `LISTING_TITLE_MAX` = 80)
 *
 * 1. Start from the full title; walk the cut list (`planCuts` below) from
 *    row 1.
 * 2. Before every cut, the first one included: at 80 or under, stop; at
 *    exactly 81 with the card number still carrying its "#", drop the "#"
 *    ("#91A-AA1" -> "91A-AA1") and stop. Nothing is checked after the last
 *    cut: by then the number itself is out (row 10), so there is no "#" left
 *    to drop. A number cut whole may still come back bare in the refill.
 * 3. Otherwise make the next cut.
 * 4. Refill: put cut tokens back, most valuable first, wherever they still
 *    fit, skipping any that do not. A team that lost its location comes back
 *    as its nickname first, whole only if that fits too (NEO-606). A REPEAT
 *    (rows 1-3) comes back only when
 *    no real token (rows 9+) is still out. The number may come back without
 *    its "#" when that is the only way it fits.
 * 5. Still over 80 after the whole list, or still needing Tidy Up (a Tidy Up
 *    cut the refill could not undo; NEO-618): when the set has box text ("Set
 *    name in titles", `setShortName`), build again from it and rerun the
 *    list. Over 80, the box version is taken whatever it comes to; needing
 *    Tidy Up, only when the box version fits. Still over: STOP. The over-cap
 *    title is returned as it stands (`fits: false`), the card is flagged `titleOverLimit` by its length, and
 *    the operator fixes it in the Card titles dialog. Description words are
 *    never cut: a title that drops "Dugout Collection" is a title for a
 *    different card.
 *
 * Never cut: year, maker, set words, insert name, parallel name, players'
 * surnames, `/N`. Removing only the "#" is never reported as left out.
 */

import { LISTING_DESCRIPTION_MAX, LISTING_TITLE_MAX } from "./listingLimits";
import { variantTypeKindFromTitle } from "../variantRole";
import { singularTypeName, singularWord } from "../listingShortName";

export { singularTypeName };
import { isGenerationalSuffix } from "../../lib/players/name-fragment";
import { teamFullName } from "../../lib/teams/team-name";
import { parallelAfterInsert, parallelOpensWithInsert, roughlySays } from "../listingShortName";

/** NEO-606 — a team row's Location / Name, as `ListingCardInputs.teamSplits` carries it. */
export type ListingTeamSplit = { location: string; name: string };

/**
 * NEO-609 — one level of the card's set chain, as its variant-type rows name
 * it: the level's own NB name ("Future Stars") and, when a variant type sits
 * above it, that type's name ("Inserts", "Proof"). Top level first. Both are
 * NB data read off the rows (`listingShortName.titleChainFacts`); this module
 * never decides what a level IS, only what the title says of it.
 */
export type ListingTitleLevel = {
  name: string;
  typeName?: string;
  /**
   * The level is the Base kind's: a card sitting directly on the set's Base
   * variant type. Set from that type's kind (`variantRole`), never read off
   * the level's name: a row an operator calls "Base" under an Insert type is
   * an insert called Base (product invariant 4).
   */
  base?: true;
};

export type ListingCardInputs = {
  cardNumber: string;
  /** Resolved player display names, already looked up from playerIds. */
  playerNames?: string[];
  /**
   * NEO-528 + NEO-535 — the NB names of the people also pictured on the card
   * (its cameos), in stored order. The title names them
   * after the card's own players while there is room, and they are the FIRST
   * meaningful thing it gives up (Jason: "secondary names should be dropped
   * before we drop anything else with meaning"): only the no-loss cuts (a
   * repeated AUTO/RC/RELIC, the "Insert" / "Parallel" labels) and the "#" at
   * 81 go before them. The description states them on a line of their own.
   */
  cameoNames?: string[];
  /** Mirrors the year node's value verbatim — same field `features.season` holds. */
  year?: string;
  manufacturer?: string;
  /**
   * NEO-272 — `selectorOptions.metadata.isBrandUnknown` on the ancestor
   * `manufacturer` row: NB has not identified the brand of this set. The row
   * above it is the marketplace's all-brands FILTER OPTION ("show all cards
   * from all brands"), carried as a manufacturer row, so the "brand" here names
   * no brand at all.
   *
   * When true the `manufacturer` above is dropped from both the title and the
   * description — see `manufacturerAndSetTokens`. Passed as a FLAG rather than
   * letting this module compare the name, because that name is a marketplace
   * filter label NB does not own and an operator can rename besides — keying
   * behaviour on it is the forward dependency product invariant 4 forbids.
   */
  manufacturerBrandUnknown?: boolean;
  setName?: string;
  /**
   * NEO-335 — the insert's own name ("Dugout Collection"), already gated on
   * the insert row's NB role by `listingInputsForCard`. Set identity: it is
   * part of the description and is never cut.
   */
  insertName?: string;
  /**
   * NEO-609 — EVERY level of the chain below the set, top level first, each
   * with its variant type's name (`ListingTitleLevel`). The title names them
   * all: the level's name is part of the description and is never cut, its
   * type name is a quiet cut (rows 5-6). Absent (a dash card, an older
   * caller): the levels are built from `insertName` / `parallelName` /
   * `parallelIsRole` exactly as before NEO-609.
   */
  titleLevels?: ListingTitleLevel[];
  /**
   * NEO-535 — the set's box text ("Set name in titles"): the WHOLE set
   * description (year, maker, set, insert, parallel) as the operator typed it.
   * Used verbatim, nothing prepended, and only when the builder's own title
   * is over the cap or still needs Tidy Up (a whole team, the number, SP,
   * RELIC, a first name, RC or AUTO cut) and the box version fits (see
   * `assessListingTitle`). The chain reading (`titleChainFacts`) has already
   * appended the insert's and parallel's names when the value sits above them.
   */
  setShortName?: string;
  /** features.parallelName — "Base" for a plain base card, a real name otherwise. */
  parallelName?: string;
  /**
   * NEO-335 — the card's leaf is a parallel by NB ROLE (a sub-variant, or an
   * insert-level row under a Parallel type: `derivedVariantFlags`, NEO-334),
   * set by `listingInputsForCard` from the chain's `parallelLeafValue`. It is
   * what earns the parallel its "Parallel" label; never read off the
   * parallel's name. The insert's label needs no such flag: `insertName` is
   * itself present only on the insert role.
   */
  parallelIsRole?: boolean;
  isRookie?: boolean;
  isRelic?: boolean;
  /** features.autographed — "None" / "On Card" / "Sticker/Label". */
  autographed?: string;
  /** features.shortPrint — "None" / "SP" / "SSP". */
  shortPrint?: string;
  printRun?: number;
  /**
   * NEO-101/189 — `cardChecklist.cardVariation`, NB's OWN per-card variation
   * name ("Image Variation; Wearing sunglasses", "Nickname", "Sliding").
   *
   * Used VERBATIM. Deliberately not parsed: the `;`-separated shape some rows
   * carry is an artefact of how the string was first authored, not a schema.
   * A variation is very often the reason a buyer searched, which is why it is
   * a title token at all rather than description-only.
   */
  cardVariation?: string;
  /**
   * NEO-101 — the stored `teams.name` values for this card's `teamOnCardIds`,
   * in stored order. VERBATIM: "Seattle Mariners", "Oregon Ducks baseball".
   * Never parsed into city/nickname, never abbreviated to "SEA".
   */
  teamNames?: string[];
  /**
   * NEO-606 — the Location / Name split (NEO-236) of those `teamNames` whose
   * team row has one: `{ location: "New York", name: "Yankees" }` for the
   * team named "New York Yankees". NB's own data, read off the team rows by
   * the caller; this module never works out where a location ends. A team in
   * `teamNames` is matched to its split by its whole name (`location + " " +
   * name`), so a split can ride in any order and a team with no split — a
   * typed name that has no row yet, a row with no location — simply has none.
   * The title gives a team's location up before the team itself (cut row 9);
   * a team without a split can only be dropped whole.
   */
  teamSplits?: ListingTeamSplit[];
  /**
   * NEO-101 — the ancestor sport node's value, e.g. "Baseball". The weakest
   * token in the title; skipped when a team name already says it.
   */
  sport?: string;
};

/**
 * What `assessListingTitle` reports back.
 */
export type ListingTitleAssessment = {
  /**
   * The generated title. At most `LISTING_TITLE_MAX` characters whenever
   * `fits`; over it otherwise (NEO-535: the STOP — description words are never
   * cut to force a fit).
   */
  title: string;
  /** `title.length <= LISTING_TITLE_MAX`: the title can be listed as it is. */
  fits: boolean;
  /**
   * The title lost at least one player's first name (cut row 11) that the
   * refill could not put back.
   */
  firstNameLost: boolean;
  /**
   * What the title leaves out that an operator should see ("Left out to
   * fit"): `leftOutOfTitle(inputs, title)`. Repeats, labels, the sport and
   * the second "Rookie" are never listed, nor a "#" dropped on its own.
   */
  dropped: string[];
  /**
   * Present (and true) only when the title was built from the box text
   * (`setShortName`) instead of the builder's own description.
   */
  shortNameUsed?: true;
  /**
   * NEO-609 — a Tidy Up cut (rows 12-20: a whole team, the card number, SP,
   * RELIC, a first name, RC or AUTO) is still out after the refill. Dropping
   * only the "#" is not one. True for a title built from the box too when the
   * box version cut one. What a parallel copy's "does the builder's title
   * work" test reads (`features/carriedTitle`).
   */
  tidyUp: boolean;
  /**
   * False when the card belongs in the Card titles dialog (Tidy Up): a
   * Tidy Up cut is still out, or its title was built from the box. A row is
   * born with `listingTitleTruncated` when this is false. An over-cap title
   * is flagged by its length (`titleOverLimit`), not by this.
   *
   * Kept under its NEO-101 name so the insert paths read one field.
   */
  coreFits: boolean;
};

/**
 * A set node's `value` often already embeds its manufacturer's name as a
 * literal prefix word — either verbatim for a flagship base product
 * (manufacturer "Topps", setName "Topps"), or as part of a full product name
 * (manufacturer "Topps", setName "Topps Heritage"). Joining manufacturer and
 * setName as independent tokens would duplicate the word, so collapse them
 * whenever setName already starts with manufacturer as a whole word.
 *
 * NEO-272 — a set whose brand NB has not identified has no manufacturer
 * token. The test is the caller's NB flag, never the row's name (product
 * invariant 4). Dropping it here makes the title and the description agree.
 */
function manufacturerAndSetTokens(
  inputs: Pick<ListingCardInputs, "manufacturer" | "setName" | "manufacturerBrandUnknown">,
): string[] {
  const manufacturer = knownMaker(inputs);
  const setName = inputs.setName?.trim();
  if (manufacturer && setName && startsWithWord(setName, manufacturer)) {
    return [setName];
  }
  return [manufacturer, setName].filter((value): value is string => Boolean(value));
}

/** The maker as a title says it: absent for a brand NB has not identified. */
function knownMaker(
  inputs: Pick<ListingCardInputs, "manufacturer" | "manufacturerBrandUnknown">,
): string | undefined {
  return inputs.manufacturerBrandUnknown ? undefined : inputs.manufacturer?.trim() || undefined;
}

/**
 * NEO-464 — a set's name the way its cards' listing titles say it: the brand,
 * then the set's own name, collapsed when the name already leads with its
 * brand ("Topps" + "Finest" reads "Topps Finest"; "Topps" + "Topps Chrome"
 * stays "Topps Chrome").
 */
export function brandedSetName(
  inputs: Pick<ListingCardInputs, "manufacturer" | "setName" | "manufacturerBrandUnknown">,
): string {
  return manufacturerAndSetTokens(inputs).join(" ");
}

function startsWithWord(value: string, prefix: string): boolean {
  if (!value.toLowerCase().startsWith(prefix.toLowerCase())) return false;
  const boundaryChar = value[prefix.length];
  return boundaryChar === undefined || /\s/.test(boundaryChar);
}

/**
 * NEO-335 — the label words the old title builder put after an insert's and a
 * parallel's names: "1996 Score Dugout Collection Insert …", "… Gold
 * Parallel". Since NEO-609 a level's label is its variant type's own name
 * (`ListingTitleLevel.typeName`); these two are what the levels are built
 * with when a caller passes no `titleLevels` (the dash card, an older caller).
 */
export const INSERT_LABEL = "Insert";
export const PARALLEL_LABEL = "Parallel";

/**
 * Does `name` already end with `typeName` as a word, singular or plural
 * ("Gold Insert" with "Inserts", "Prizm Parallels" with "Parallel")? Then the
 * type name would only repeat it. A type name of several words is matched
 * word for word, the last one compared singular to singular.
 */
function endsWithTypeName(name: string, typeName: string): boolean {
  const named = wordsOf(name);
  const wanted = wordsOf(typeName);
  if (wanted.length === 0 || named.length < wanted.length) return false;
  const tail = named.slice(named.length - wanted.length);
  return tail.every((word, i) =>
    i < wanted.length - 1 ? word === wanted[i] : singularWord(word) === singularWord(wanted[i]),
  );
}

/**
 * NEO-335 — "Rookie" shortened to "RC" in a level's name ("Rookie Debut" →
 * "RC Debut"). Cut row 10 (NEO-609: every level, not only the insert). Exactly the old builder's replacement: the FIRST
 * occurrence, case-sensitive, no word boundary — so "Rookies" reads "RCs" and
 * a lowercase "rookie" is left alone.
 */
export function rookieAsRc(name: string): string {
  return name.replace("Rookie", "RC");
}

/**
 * A parallel name that names a parallel: not blank, and not the Base kind's
 * word ("Base", "Bases"), read through the role helper (NEO-334), never a
 * literal here.
 */
function isRealParallel(inputs: ListingCardInputs): boolean {
  const name = inputs.parallelName?.trim();
  return !!name && variantTypeKindFromTitle(name) !== "base";
}

/** Lowercased whitespace-delimited words of a string. */
function wordsOf(text: string): string[] {
  return text.toLowerCase().split(/\s+/).filter(Boolean);
}

/** A word with its leading and trailing punctuation removed ("Autographs," → "autographs"). */
function bareWord(word: string): string {
  return word.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

function bareWordsOf(text: string): string[] {
  return wordsOf(text).map(bareWord).filter(Boolean);
}

/**
 * Is every word of `token` already a word of `title`? A word the buyer has
 * already read is not worth characters twice: "Oregon Ducks baseball" then
 * "Baseball", the same team resolved twice, a variation the parallel already
 * says. It never collapses `RC` and `Rookie`: different words, and carrying
 * both is what real sold listings do.
 */
function alreadySaid(title: string, token: string): boolean {
  const present = new Set(wordsOf(title));
  const tokenWords = wordsOf(token);
  return tokenWords.length > 0 && tokenWords.every((w) => present.has(w));
}

/** Does `words` contain `phrase` as a contiguous run of words? */
function hasPhrase(words: readonly string[], phrase: readonly string[]): boolean {
  if (phrase.length === 0) return false;
  for (let i = 0; i + phrase.length <= words.length; i += 1) {
    if (phrase.every((w, j) => words[i + j] === w)) return true;
  }
  return false;
}

/**
 * Player names as the title and description say them: whitespace collapsed,
 * blanks dropped, and a name already listed (case-insensitively) listed once.
 * Two players with one display name on one card is all but unheard of, and
 * printing the same name twice tells a buyer nothing; the commit path dedupes
 * typed names the same way (`normalizePendingNames`), but a stored row written
 * before that, or a fixture, can still carry a repeat.
 */
function distinctNames(names: ReadonlyArray<string> | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of names ?? []) {
    const name = raw.trim().split(/\s+/).filter(Boolean).join(" ");
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/**
 * NEO-606 — each split team's whole name → its nickname. The key is the name
 * `teamNames` carries for the team (`teamFullName`: location, a space, name),
 * so a split is found by equality, never by taking a name apart. A split with
 * no location or no nickname gives the title nothing to cut and is left out.
 */
function teamNicknames(splits: ReadonlyArray<ListingTeamSplit> | undefined): Map<string, string> {
  const out = new Map<string, string>();
  for (const split of splits ?? []) {
    const location = split.location.trim();
    const nickname = split.name.trim();
    if (!location || !nickname) continue;
    out.set(teamFullName({ name: nickname, location }), nickname);
  }
  return out;
}

/** The words that make AUTO, RC and RELIC repeats (cut rows 2-4, 14, 15). */
const AUTO_WORDS: ReadonlySet<string> = new Set([
  "auto",
  "autos",
  "autograph",
  "autographs",
  "autographed",
]);
const ROOKIE_WORDS: ReadonlySet<string> = new Set(["rookie", "rookies", "rc", "rcs"]);
const RELIC_WORDS: ReadonlySet<string> = new Set(["relic", "relics"]);
/** NEO-609 — a title that says "Memorabilia" lets RELIC go at row 14. */
const MEMORABILIA_WORDS: ReadonlySet<string> = new Set(["memorabilia"]);
/** NEO-609 — a title that says "Signature(s)" lets AUTO go at row 15. */
const SIGNATURE_WORDS: ReadonlySet<string> = new Set(["signature", "signatures"]);

function says(text: string, words: ReadonlySet<string>): boolean {
  return bareWordsOf(text).some((w) => words.has(w));
}

/**
 * NEO-535 — a player's name with the first name cut (row 11), or undefined
 * when it may not be cut. One display name per player (`players.name`); the
 * first WORD goes, and only when the name has two or more words not counting
 * a trailing Jr./Sr./II/III/IV (the suffix list in
 * lib/players/name-fragment.ts). "Aiva Arquette" → "Arquette", "Vladimir
 * Guerrero Jr." → "Guerrero Jr.", "Elly De La Cruz" → "De La Cruz", "J.D.
 * Martinez" → "Martinez"; a one-word name, or "Griffey Jr.", is never cut.
 */
export function withoutFirstName(name: string): string | undefined {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const counted =
    words.length > 1 && isGenerationalSuffix(words[words.length - 1])
      ? words.length - 1
      : words.length;
  if (counted < 2) return undefined;
  return words.slice(1).join(" ");
}

/**
 * NEO-535 cut row 0 — the builder's description strips the year and the
 * maker's words out of an insert's or a parallel's name, so the title does
 * not say them twice: "1991 Gold Leaf Prospects" under Leaf reads "1991 Gold
 * Prospects". Only whole words, compared case-insensitively.
 */
function stripDoubledWords(name: string, inputs: ListingCardInputs): string {
  const doubled = new Set<string>();
  const year = inputs.year?.trim().toLowerCase();
  if (year) doubled.add(year);
  for (const word of wordsOf(knownMaker(inputs) ?? "")) doubled.add(word);
  return name
    .trim()
    .split(/\s+/)
    .filter((word) => word && !doubled.has(word.toLowerCase()))
    .join(" ");
}

/**
 * NEO-609 — the switches Jason may flip. Each is one constant or one function;
 * nothing else in this module knows the answer.
 *
 *   Q1  DECIDED (Jason 2026-11-18): "Base" IS in the full title ("2024 Topps
 *       Chrome Base Mike Trout"), and is the first word cut (row 1). Wherever
 *       a Base level or type sits in the chain it renders as a token and goes
 *       first, quietly. A Base card with no Base level in its chain (a dash
 *       card, a caller with no `titleLevels`) says it through its features'
 *       parallel name, when that is the Base kind's word. Not a switch any
 *       more: `LevelParts.base` / `typeBase` are the whole of it.
 *   Q2  Where a type name sits against its level's name. Default after:
 *       "Future Stars Inserts". false: before, "Inserts Future Stars".
 *   Q3  How a type name is worded: `typeNameAsSaid`. DECIDED (Jason
 *       2026-11-18): singular, "Inserts" reads "Insert" (`singularTypeName`).
 *   Q4  Where the "#"-at-81 rule starts: `HASH_RULE_FROM_ROW` (default the
 *       first Tidy Up row, so a quiet cut is always made before a "#" is).
 *   Q5  "Left out to fit" is unchanged (`leftOutOfTitle`).
 */
const TYPE_NAME_FOLLOWS_LEVEL = true;
function typeNameAsSaid(typeName: string): string {
  return singularTypeName(typeName);
}

/** Is `text` the Base kind's word ("Base", "Bases"), read through the role helper? */
function isBaseWord(text: string | undefined): boolean {
  return variantTypeKindFromTitle(text) === "base";
}

/**
 * One level of a description: the words the title says of it and the type
 * name that may follow (or lead) them. A level whose words the set already
 * says has no `text`.
 */
type LevelParts = {
  /** The level's own words, year and maker stripped. Never cut (but see `base`). */
  text?: string;
  /** The level IS the Base word ("Base"): its `text` is cut first (row 1). */
  base?: true;
  /** The type name is the Base word: cut first (row 1) rather than at row 5. */
  typeBase?: true;
  /** The level's words with "Rookie" → "RC" (cut row 10), when that differs. */
  rc?: string;
  /** The variant type's name (cut rows 5-6). */
  typeName?: string;
};

/** The description half of a title: the builder's own, or the box text. */
type DescriptionParts = {
  /** Year + maker + set, or the whole box text. Never cut. */
  head: string;
  /** Every level of the chain, top level first. Empty for the box text. */
  levels: LevelParts[];
};

/**
 * The levels the title names (NEO-609): the caller's `titleLevels` when it
 * has them, else the insert and the parallel as before. A real parallel name
 * the levels do not already carry (the features' snapshot name, a copy's own)
 * follows them with no type name; one that is the card's own variation text
 * (NEO-189 copies `cardVariation` into `features.parallelName`) is not a
 * level: the variation states itself in the tail.
 */
function effectiveLevels(inputs: ListingCardInputs): ListingTitleLevel[] {
  const levels: ListingTitleLevel[] = [];
  if (inputs.titleLevels) {
    for (const level of inputs.titleLevels) {
      const name = level.name.trim();
      if (!name) continue;
      levels.push({
        name,
        ...(level.typeName?.trim() ? { typeName: level.typeName.trim() } : {}),
        ...(level.base ? { base: true as const } : {}),
      });
    }
  } else {
    const insert = inputs.insertName?.trim();
    if (insert) levels.push({ name: insert, typeName: INSERT_LABEL });
  }
  if (isRealParallel(inputs)) {
    const raw = inputs.parallelName!.trim();
    const variation = inputs.cardVariation?.trim().toLowerCase();
    const carried = levels.some((l) => l.name.toLowerCase() === raw.toLowerCase());
    if (raw.toLowerCase() !== variation && !carried) {
      levels.push({
        name: raw,
        ...(!inputs.titleLevels && inputs.parallelIsRole === true ? { typeName: PARALLEL_LABEL } : {}),
      });
    }
  }
  // Q1 — a Base card with no level in its chain says Base through its
  // features' parallel name, when that is the Base kind's word.
  const featuresName = inputs.parallelName?.trim();
  if (levels.length === 0 && featuresName && isBaseWord(featuresName)) {
    levels.push({ name: featuresName, base: true });
  }
  return levels;
}

/**
 * The builder's description, in parts. The top level collapses into the set
 * when it is named after it ("Topps Chrome Refractor" under "Topps Chrome"),
 * and is left out when the set already says every word of it; otherwise it
 * follows the set with the year and maker words stripped. Each level below
 * follows the same way, and the leading words it shares with the level above
 * are said once (NEO-535, `parallelAfterInsert`). A level literally named
 * Base is a token of its own (cut first, Q1): it takes no part in any of that.
 */
function builderDescriptionParts(inputs: ListingCardInputs): DescriptionParts {
  const year = inputs.year?.trim();
  const setTokens = manufacturerAndSetTokens(inputs);
  let headTokens = setTokens;
  const levels: LevelParts[] = [];
  const said: string[] = [];
  const head = () => [year, ...headTokens].filter(Boolean).join(" ");
  let above: { raw: string; text?: string } | undefined;
  for (const level of effectiveLevels(inputs)) {
    if (level.base) {
      levels.push({ text: level.name, base: true });
      continue;
    }
    const raw = level.name;
    let text: string | undefined;
    if (above === undefined) {
      const joined = setTokens.join(" ");
      const last = setTokens[setTokens.length - 1];
      if (setTokens.length > 0 && startsWithWord(raw, joined)) {
        headTokens = [];
        text = raw;
      } else if (last && startsWithWord(raw, last)) {
        headTokens = setTokens.slice(0, -1);
        text = raw;
      } else if (!alreadySaid(joined, raw)) {
        text = stripDoubledWords(raw, inputs) || undefined;
      }
    } else {
      // NEO-535 — the leading words a level shares with the one above it are
      // said once, by that one ("Anime" + "Anime Red Refractors" → "Anime Red
      // Refractors"; `parallelAfterInsert`).
      const trimmed = parallelAfterInsert(raw, above.text ?? above.raw);
      const stripped = stripDoubledWords(trimmed, inputs);
      if (stripped && !alreadySaid([head(), ...said].filter(Boolean).join(" "), stripped)) {
        text = stripped;
        // A type name never lands inside a level's own name. When this level
        // opens with words the one above it says, the two read as one name
        // ("Gold Wave" + "Gold Wave Refractors" -> "Gold Wave Refractors"),
        // so the upper level's type name sits out instead of splitting it
        // ("Gold Wave Parallel Refractors").
        if (wordsOf(trimmed).length < wordsOf(raw).length) {
          const upper = levels[levels.length - 1];
          if (upper && !upper.base) {
            upper.typeName = undefined;
            upper.typeBase = undefined;
          }
        }
      }
    }
    // The top level keeps its type name even when the set already says its
    // words ("2026 Topps Chrome Update Insert"); a lower level, only with them.
    const typeRaw = level.typeName?.trim();
    const typeName =
      typeRaw &&
      (text !== undefined || above === undefined) &&
      !endsWithTypeName(text ?? raw, typeRaw)
        ? typeNameAsSaid(typeRaw)
        : undefined;
    levels.push({
      text,
      rc: text && rookieAsRc(text) !== text ? rookieAsRc(text) : undefined,
      typeName,
      ...(typeName && isBaseWord(typeName) ? { typeBase: true as const } : {}),
    });
    if (text) said.push(text);
    above = { raw, text };
  }
  return { head: head(), levels };
}

/** The box text as a description: verbatim, no type names, nothing to shorten. */
function boxDescriptionParts(box: string): DescriptionParts {
  return { head: box.trim(), levels: [] };
}

/** A level's words and type name, in the order the title says them (Q2). */
function levelWords(name: string | undefined, typeName: string | undefined): string[] {
  const words = TYPE_NAME_FOLLOWS_LEVEL ? [name, typeName] : [typeName, name];
  return words.filter((w): w is string => !!w);
}

/**
 * NEO-535 — the builder's full set description, without the type names:
 * "2026 Leaf Metal 1991 Gold Prospects Autographs Prismatic Silver". What the
 * "Set name in titles" box is prefilled with when no value is stored
 * (`listingInputs.setDescriptionForTitles`). Ignores `setShortName`.
 */
export function titleDescription(inputs: ListingCardInputs): string {
  const parts = builderDescriptionParts(inputs);
  return [parts.head, ...parts.levels.filter((l) => !l.base).map((l) => l.text)]
    .filter(Boolean)
    .join(" ");
}

/**
 * NEO-535 — every form the builder's description can take in a title it
 * wrote, longest first: with and without each level's type name (cut rows
 * 5-6, or 1 for Base), with each level's "Rookie" read as "RC" (row 10), and
 * with or without the Base word (row 1). What `features/carriedTitle` looks for in a
 * source card's hand-edited title to tell its description from the
 * operator's own words. Ignores `setShortName` (the caller adds the box text
 * as its own candidate).
 */
export function titleDescriptionForms(inputs: ListingCardInputs): string[] {
  const parts = builderDescriptionParts(inputs);
  let forms: string[][] = [[parts.head]];
  for (const level of parts.levels) {
    const names = level.text
      ? [level.text, ...(level.rc ? [level.rc] : []), ...(level.base ? [undefined] : [])]
      : [undefined];
    const types = level.typeName ? [level.typeName, undefined] : [undefined];
    const next: string[][] = [];
    for (const form of forms) {
      for (const name of names) {
        for (const type of types) next.push([...form, ...levelWords(name, type)]);
      }
    }
    forms = next;
  }
  const out = new Set(forms.map((words) => words.filter(Boolean).join(" ")).filter(Boolean));
  return [...out].sort((a, b) => b.length - a.length);
}

type TailKind =
  | "auto"
  | "relic"
  | "printRun"
  | "variation"
  | "rc"
  | "sp"
  | "team"
  | "rookie"
  | "sport";

/**
 * One tail token. `latent`: left out when the full title was built because
 * the title already said every word of it (a team inside the variation, the
 * sport inside a team). It is never cut, but the refill offers it back once
 * whatever said it has been cut and it is no longer said.
 */
type TailToken = {
  kind: TailKind;
  text: string;
  in: boolean;
  latent?: true;
  /**
   * NEO-606 — a team's nickname, when its row is split: what the title says of
   * it once the location has been cut (`shrunk`).
   */
  short?: string;
  shrunk?: boolean;
};

/** One title under construction: what is in, what is cut. */
type TitleState = {
  parts: DescriptionParts;
  /**
   * Per level of `parts.levels`: its "Rookie" read as "RC" (row 10), its type
   * name in (rows 5-6), and its own words in (only a Base level's are ever cut,
   * row 1).
   */
  levels: Array<{ abbreviated: boolean; typeIn: boolean; textIn: boolean }>;
  players: Array<{ full: string; short?: string; firstOut: boolean }>;
  /** NEO-528 — the cameos, after the players; each whole name in or out. */
  cameos: Array<{ name: string; in: boolean }>;
  number?: { text: string; mode: "hash" | "bare" | "out" };
  tail: TailToken[];
};

function renderTitle(state: TitleState): string {
  const out: string[] = [state.parts.head];
  state.parts.levels.forEach((level, index) => {
    const now = state.levels[index];
    const name = !now.textIn ? undefined : now.abbreviated && level.rc ? level.rc : level.text;
    out.push(...levelWords(name, now.typeIn ? level.typeName : undefined));
  });
  const players = state.players.map((p) => (p.firstOut && p.short ? p.short : p.full));
  // NEO-528 — the people also pictured follow the card's own, in one run.
  for (const cameo of state.cameos) if (cameo.in) players.push(cameo.name);
  if (players.length > 0) out.push(players.join(" & "));
  if (state.number && state.number.mode !== "out") {
    out.push(state.number.mode === "hash" ? `#${state.number.text}` : state.number.text);
  }
  for (const token of state.tail) {
    if (!token.in) continue;
    if (token.shrunk && token.short) {
      // NEO-606 — a nickname the title has already said is a repeat, like a
      // second AUTO: "Giants" after "New York Giants" (or after a variation
      // that says "Yankees") is not said twice. The team has given up its
      // location and has nothing left to add, so it adds nothing.
      if (alreadySaid(out.filter(Boolean).join(" "), token.short)) continue;
      out.push(token.short);
    } else {
      out.push(token.text);
    }
  }
  // NEO-363 — `listingTitle` is required and never blank. A card with nothing
  // else to say still gets "#", as the pre-NEO-535 builder always gave it.
  return out.filter(Boolean).join(" ") || "#";
}

/** The full title's state, before any cut, for one description. */
function fullTitleState(inputs: ListingCardInputs, parts: DescriptionParts): {
  state: TitleState;
  repeats: Repeats;
} {
  const players = distinctNames(inputs.playerNames).map((full) => ({
    full,
    short: withoutFirstName(full),
    firstOut: false,
  }));
  const cardNumber = inputs.cardNumber?.trim();
  const own = new Set(players.map((p) => p.full.toLowerCase()));
  const cameos = distinctNames(inputs.cameoNames)
    .filter((name) => !own.has(name.toLowerCase()))
    .map((name) => ({ name, in: true }));
  const state: TitleState = {
    parts,
    levels: parts.levels.map((level) => ({
      abbreviated: false,
      typeIn: !!level.typeName,
      textIn: true,
    })),
    players,
    cameos,
    ...(cardNumber ? { number: { text: cardNumber, mode: "hash" as const } } : {}),
    tail: [],
  };

  // What the title says that is never cut: the description (the set words and
  // every level's own name, NOT the cuttable type names: "Autographs" as a
  // type must not make AUTO a repeat) and the variation. AUTO, RC and RELIC
  // are REPEATS when it already says them.
  const description = [parts.head, ...parts.levels.filter((l) => !l.base).map((l) => l.text)]
    .filter(Boolean)
    .join(" ");
  const variation = inputs.cardVariation?.trim();
  const context = [description, variation].filter(Boolean).join(" ");
  const repeats: Repeats = {
    auto: says(context, AUTO_WORDS),
    rc: says(context, ROOKIE_WORDS),
    relic: says(context, RELIC_WORDS),
    memorabilia: says(context, MEMORABILIA_WORDS),
    signature: says(context, SIGNATURE_WORDS),
  };

  const push = (kind: TailKind, text: string) => {
    state.tail.push({ kind, text, in: true });
  };
  // A token the title already says sits out, latent, in its own place.
  const pushUnlessSaid = (kind: TailKind, text: string) => {
    if (alreadySaid(renderTitle(state), text)) {
      state.tail.push({ kind, text, in: false, latent: true });
    } else {
      push(kind, text);
    }
  };
  if (inputs.autographed && inputs.autographed !== "None") push("auto", "AUTO");
  if (inputs.isRelic) push("relic", "RELIC");
  if (inputs.printRun) push("printRun", `/${inputs.printRun}`);
  if (variation) pushUnlessSaid("variation", variation);
  if (inputs.isRookie) push("rc", "RC");
  if (inputs.shortPrint && inputs.shortPrint !== "None") push("sp", inputs.shortPrint);
  const nicknames = teamNicknames(inputs.teamSplits);
  for (const team of inputs.teamNames ?? []) {
    const trimmed = team.trim();
    if (!trimmed) continue;
    pushUnlessSaid("team", trimmed);
    // NEO-606 — a split team can give up its location before it goes.
    const nickname = nicknames.get(trimmed);
    if (nickname) state.tail[state.tail.length - 1].short = nickname;
  }
  // The second spelling of rookie, only beside an RC that is not a repeat.
  if (inputs.isRookie && !repeats.rc && !alreadySaid(renderTitle(state), "Rookie")) {
    push("rookie", "Rookie");
  }
  const sport = inputs.sport?.trim();
  if (sport) pushUnlessSaid("sport", sport);
  return { state, repeats };
}

/** What the title already says in words that are never cut (see `fullTitleState`). */
type Repeats = {
  auto: boolean;
  rc: boolean;
  relic: boolean;
  /** "Memorabilia" is said: RELIC goes at row 14 instead of 17. */
  memorabilia: boolean;
  /** "Signature(s)" is said: AUTO goes at row 15 instead of 20. */
  signature: boolean;
};

/**
 * The cut list's rows (NEO-609, Jason 2026-11-18, titles only). Rows 1-11 are
 * quiet cuts. From `TIDY_UP_ROW` on, a cut that is still out after the refill
 * sends the card to Tidy Up ("there are decisions that a human may want to
 * make differently").
 */
const ROW = {
  base: 1,
  autoRepeat: 2,
  rcRepeat: 3,
  relicRepeat: 4,
  typeName: 5, // 5 the top level's type name, 6 the next level's, and so on down
  cameo: 7,
  sport: 8,
  secondRookie: 9,
  rookieAsRc: 10,
  teamCity: 11,
  team: 12,
  number: 13,
  relicMemorabilia: 14,
  autoSignature: 15,
  shortPrint: 16,
  relic: 17,
  firstName: 18,
  rc: 19,
  auto: 20,
} as const;
const TIDY_UP_ROW = ROW.team;

/**
 * Q4 — the first row whose cut is preceded by the "#" rule (at exactly 81
 * characters with the number's "#" still on, the "#" alone goes and the loop
 * stops). Row 13's own words are "'#' alone first"; Jason's earlier rule
 * checked before EVERY cut. Default: from the first Tidy Up row, so every
 * quiet cut is made before a "#" is, and the "#" goes before anything a human
 * would want to decide.
 */
const HASH_RULE_FROM_ROW: number = TIDY_UP_ROW;

/**
 * A row whose cut is a loss: a meaningful token an operator is shown as left
 * out, and one that holds a repeat back from the refill while it is out. The
 * cameos and everything from the team's city on.
 */
function isRealRow(row: number): boolean {
  return row === ROW.cameo || row >= ROW.teamCity;
}

/** One cut, and how to undo it. `restores` are tried in order on refill. */
type Cut = {
  row: number;
  /** Cut order within the whole list (row, then position within the row). */
  rank: number;
  /** A latent token's text: offered back only while the title does not say it. */
  latentText?: string;
  /** A token an operator is shown as left out (`isRealRow`). */
  real: boolean;
  /** Rows 2-4: AUTO, RC or RELIC the title already says. */
  repeat: boolean;
  out: boolean;
  cut: () => void;
  restores: Array<() => void>;
};

/**
 * The cut list, in order (1 = first to go; NEO-609):
 *
 *   1  Base: a Base level's word, or a type named Base
 *   2  AUTO, when the title says auto/autograph(s)/autographed (repeat)
 *   3  RC, when the title says Rookie/Rookies/RC (repeat)
 *   4  RELIC, when the title says Relic/Relics (repeat)
 *   5  the top level's type name, then each level's below it ("Inserts",
 *      "Parallel": whatever the variant type rows are called)
 *   7  cameos (the people also pictured), last first, each whole name
 *      (NEO-528, Jason: dropped before anything else with meaning)
 *   8  the sport (already skipped when a team name says it)
 *   9  the second "Rookie" (only ever beside a non-repeat RC)
 *   10 "Rookie" -> "RC" inside a level's name, top level first
 *   11 teams' cities, last team first (NEO-606, Jason: "first drop city
 *      before dropping full team name"): a team whose row has a Location /
 *      Name split gives up its location; a team with no split has none.
 *   --- Tidy Up line: from here a cut still out after the refill sends the
 *       card to Tidy Up ---
 *   12 whole teams, last first, the nickname-only ones included
 *   13 the card number (the "#" alone goes first at exactly 81; Q4)
 *   14 RELIC, when the title says Memorabilia
 *   15 AUTO, when the title says Signature(s)
 *   16 SP / SSP
 *   17 RELIC
 *   18 first names, last player first, one per step
 *   19 RC
 *   20 AUTO
 *
 * Never cut: the year, the maker and set words, every level's own name, /N,
 * the surname and the variation. Still over 80 after the list: `fits` is
 * false and the card is flagged `titleOverLimit`.
 *
 * Rows 5, 10 and the levels exist only on the builder's description, never on
 * the box.
 */
function planCuts(state: TitleState, repeats: Repeats): Cut[] {
  const cuts: Cut[] = [];
  const add = (
    row: number,
    cut: () => void,
    restores: Array<() => void>,
    repeat = false,
    within = 0,
  ) => {
    cuts.push({
      row,
      rank: cutRank(row, within),
      real: isRealRow(row),
      repeat,
      out: false,
      cut,
      restores,
    });
  };
  const tokens = (kind: TailKind) => state.tail.filter((t) => t.kind === kind && t.in);
  const toggle = (row: number, token: TailToken, repeat = false) =>
    add(
      row,
      () => { token.in = false; },
      [() => { token.in = true; }],
      repeat,
      token.kind === "team" ? teamPlace(state, token) : 0,
    );

  // Row 1: Base, wherever the chain has it (a level of that name, or a type).
  state.parts.levels.forEach((level, index) => {
    const now = state.levels[index];
    if (level.base) {
      add(ROW.base, () => { now.textIn = false; }, [() => { now.textIn = true; }], false, index);
    } else if (level.typeBase && now.typeIn) {
      add(ROW.base, () => { now.typeIn = false; }, [() => { now.typeIn = true; }], false, index);
    }
  });
  for (const t of tokens("auto")) {
    if (repeats.auto) toggle(ROW.autoRepeat, t, true);
    else toggle(repeats.signature ? ROW.autoSignature : ROW.auto, t);
  }
  for (const t of tokens("rc")) {
    if (repeats.rc) toggle(ROW.rcRepeat, t, true);
    else toggle(ROW.rc, t);
  }
  for (const t of tokens("relic")) {
    if (repeats.relic) toggle(ROW.relicRepeat, t, true);
    else toggle(repeats.memorabilia ? ROW.relicMemorabilia : ROW.relic, t);
  }
  // Rows 5-6...: each level's type name, top level first.
  state.parts.levels.forEach((level, index) => {
    const now = state.levels[index];
    if (!level.typeName || !now.typeIn || level.typeBase) return;
    add(ROW.typeName, () => { now.typeIn = false; }, [() => { now.typeIn = true; }], false, index);
  });
  // NEO-528 — the cameos, after the no-loss cuts and before everything that
  // carries meaning. A meaningful cut (`real`), so a repeat is not put back
  // while a cameo is still out; refilled last of the meaningful cuts.
  for (const [index, cameo] of [...state.cameos.entries()].reverse()) {
    add(
      ROW.cameo,
      () => { cameo.in = false; },
      [() => { cameo.in = true; }],
      false,
      CAMEO_PLACES - index,
    );
  }
  for (const t of tokens("sport")) toggle(ROW.sport, t);
  for (const t of tokens("rookie")) toggle(ROW.secondRookie, t);
  state.parts.levels.forEach((level, index) => {
    const now = state.levels[index];
    if (!level.rc || now.abbreviated) return;
    add(
      ROW.rookieAsRc,
      () => { now.abbreviated = true; },
      [() => { now.abbreviated = false; }],
      false,
      index,
    );
  });
  // NEO-606 — a split team gives up its location first, last team first.
  // Meaningful (`real`) like the team it belongs to.
  for (const t of [...tokens("team")].reverse()) {
    if (t.short === undefined) continue;
    add(
      ROW.teamCity,
      () => { t.shrunk = true; },
      [() => { t.shrunk = false; }],
      false,
      teamPlace(state, t),
    );
  }
  for (const t of [...tokens("team")].reverse()) toggle(ROW.team, t);
  const number = state.number;
  if (number) {
    add(ROW.number, () => { number.mode = "out"; }, [
      () => { number.mode = "hash"; },
      () => { number.mode = "bare"; },
    ]);
  }
  for (const t of tokens("sp")) toggle(ROW.shortPrint, t);
  for (const [index, player] of [...state.players.entries()].reverse()) {
    if (player.short === undefined) continue;
    add(
      ROW.firstName,
      () => { player.firstOut = true; },
      [() => { player.firstOut = false; }],
      false,
      LAST_FIRST - index,
    );
  }
  // Rows run in order: sorted by rank, stable within a rank.
  return cuts.sort((a, b) => a.rank - b.rank);
}

/**
 * A cut's place in the cut order: its row, then its place within the row.
 * Teams and first names go last first, so a later team or player ranks lower
 * (is cut sooner, and refilled later).
 */
const LAST_FIRST = 999;
/** The cameos' places within their row, last cameo lowest (cut first). */
const CAMEO_PLACES = 100;
function cutRank(row: number, within = 0): number {
  return row * 1000 + within;
}

/** A team token's place within its row: last first. */
function teamPlace(state: TitleState, token: TailToken): number {
  return LAST_FIRST - state.tail.filter((t) => t.kind === "team").indexOf(token);
}

/**
 * The latent tokens as cuts already made, ranked where the cut list would
 * have cut them: the sport at row 8, a team at row 12 in its last-first
 * place. The variation is never cut, so a latent one (left out because the
 * title said it) ranks past the list and comes back first, the moment
 * whatever said it has been cut.
 */
const VARIATION_LATENT_ROW = ROW.auto + 1;
function latentCuts(state: TitleState): Cut[] {
  const rowOf: Partial<Record<TailKind, number>> = {
    sport: ROW.sport,
    team: ROW.team,
    variation: VARIATION_LATENT_ROW,
  };
  const out: Cut[] = [];
  for (const token of state.tail) {
    const row = token.latent ? rowOf[token.kind] : undefined;
    if (row === undefined) continue;
    out.push({
      row,
      rank: cutRank(row, token.kind === "team" ? teamPlace(state, token) : 0),
      latentText: token.text,
      real: isRealRow(row),
      repeat: false,
      out: true,
      cut: () => { token.in = false; },
      // NEO-606 — a split team that does not fit whole is offered back as its
      // nickname, as it would have been had the cuts reached it.
      restores:
        token.kind === "team" && token.short !== undefined
          ? [
              () => { token.shrunk = false; token.in = true; },
              () => { token.shrunk = true; token.in = true; },
            ]
          : [() => { token.in = true; }],
    });
  }
  return out;
}

/** Steps 1-4 of the loop over one description. */
function cutToFit(
  inputs: ListingCardInputs,
  parts: DescriptionParts,
): { title: string; fits: boolean; firstNamesLost: number; tidyUp: boolean } {
  const { state, repeats } = fullTitleState(inputs, parts);
  const length = () => renderTitle(state).length;
  // Step 2's "#" rule: at exactly 81, the "#" alone goes, and the loop stops
  // (before a cut from `HASH_RULE_FROM_ROW` on; Q4).
  const hashRule = (): boolean => {
    if (length() === LISTING_TITLE_MAX + 1 && state.number?.mode === "hash") {
      state.number.mode = "bare";
      return true;
    }
    return false;
  };

  const planned = planCuts(state, repeats);
  const done: Cut[] = [];
  for (const cut of planned) {
    if (length() <= LISTING_TITLE_MAX) break;
    if (cut.row >= HASH_RULE_FROM_ROW && hashRule()) break;
    cut.cut();
    cut.out = true;
    done.push(cut);
  }

  // Step 4 — the refill, most valuable first (the reverse of the cut order).
  // Latent tokens join it in their own places: a team that sat out because
  // the variation said it comes back once the variation is cut.
  const refill = [...done, ...latentCuts(state)].sort((a, b) => a.rank - b.rank);
  const stillOut = (c: Cut) =>
    c.out && !(c.latentText !== undefined && alreadySaid(renderTitle(state), c.latentText));
  for (const cut of [...refill].reverse()) {
    if (!stillOut(cut)) continue;
    if (cut.repeat && refill.some((d) => d.real && stillOut(d))) continue;
    for (const restore of cut.restores) {
      restore();
      if (length() <= LISTING_TITLE_MAX) {
        cut.out = false;
        break;
      }
      cut.cut();
    }
  }

  const title = renderTitle(state);
  return {
    title,
    fits: title.length <= LISTING_TITLE_MAX,
    firstNamesLost: state.players.filter((p) => p.firstOut).length,
    // Tidy Up: a cut from the line down that the refill could not undo. Only
    // cuts actually made count: a latent token never was one, and a "#"
    // dropped on its own (`hashRule`, or a number that came back bare) is not.
    tidyUp: done.some((c) => c.out && c.row >= TIDY_UP_ROW),
  };
}

/**
 * NEO-535 — the listing title, and what it had to give up.
 *
 * The builder's title comes first. The box text ("Set name in titles",
 * `setShortName`) replaces the builder's description only when:
 *
 *   (a) the builder's title is still over the cap after every cut, or
 *   (b) the builder's title needs Tidy Up (`tidyUp`: a Tidy Up cut is still
 *       out after the refill, a first name included) and the box version
 *       fits (NEO-618, Jason 2026-11-19; NEO-535 asked for a first name
 *       saved, which was one Tidy Up cut among several).
 *
 * Never on a title that fits with nothing Tidy Up cut, and never when the
 * box version does not fit while the builder's does. The rule lives here so the
 * pre-save Card titles step, the insert and Regenerate cannot disagree.
 * When the box version is over the cap too, it is the one returned: it is
 * the text the operator chose and will edit.
 */
export function assessListingTitle(inputs: ListingCardInputs): ListingTitleAssessment {
  const builder = cutToFit(inputs, builderDescriptionParts(inputs));
  let chosen = builder;
  let boxUsed = false;
  const box = inputs.setShortName?.trim();
  if (box && (!builder.fits || builder.tidyUp)) {
    const boxed = cutToFit(inputs, boxDescriptionParts(box));
    if (!builder.fits || boxed.fits) {
      chosen = boxed;
      boxUsed = true;
    }
  }
  const firstNameLost = chosen.firstNamesLost > 0;
  return {
    title: chosen.title,
    fits: chosen.fits,
    firstNameLost,
    dropped: leftOutOfTitle(inputs, chosen.title),
    ...(boxUsed ? { shortNameUsed: true as const } : {}),
    tidyUp: chosen.tidyUp,
    coreFits: !chosen.tidyUp && !boxUsed,
  };
}

/**
 * The title alone. Kept as its own export because the demo dashboard and a
 * pile of tests call it; anything that also needs to know what was cut calls
 * `assessListingTitle` directly.
 */
export function generateListingTitle(inputs: ListingCardInputs): string {
  return assessListingTitle(inputs).title;
}

/**
 * NEO-535 — what `text` leaves out of this card's facts: the "Left out to
 * fit" line on the Card titles dialog, computed from whatever is in the title
 * field now (the operator's own words included), never from the generator's
 * assessment.
 *
 * In this order:
 *
 *   1. description words the text does not carry (year + set, then the
 *      insert's, then the parallel's), unless the text carries the box text,
 *      which stands in for the description. "RC" counts for "Rookie" (row 8);
 *   1½. cameos (NEO-528), last first, each whole name;
 *   2. teams, last first;
 *   3. the card number, as `#<number>` (present with or without its "#");
 *   4. players, last first: the first name when the surname part is there,
 *      the whole name otherwise;
 *   5. SP/SSP, RC, RELIC, the variation, AUTO, then the print run `/N`.
 *
 * Never listed: the "Insert" and "Parallel" labels, the sport, the second
 * "Rookie", and AUTO / RC / RELIC when the text already says them (a
 * repeat). Display only; nothing is stored from this.
 */
export function leftOutOfTitle(inputs: ListingCardInputs, text: string): string[] {
  const words = wordsOf(text);
  const present = new Set(words);
  const bare = new Set(bareWordsOf(text));
  const out: string[] = [];
  const add = (value: string) => {
    if (value && !out.includes(value)) out.push(value);
  };
  const wordIn = (word: string) => {
    const lower = word.toLowerCase();
    if (present.has(lower) || bare.has(bareWord(lower))) return true;
    if (lower === "rookie") return present.has("rc");
    if (lower === "rookies") return present.has("rcs");
    return false;
  };
  const phraseIn = (phrase: string) => hasPhrase(words, wordsOf(phrase));

  const parts = builderDescriptionParts(inputs);
  const box = inputs.setShortName?.trim();
  if (!(box && phraseIn(box))) {
    for (const segment of [parts.head, ...parts.levels.filter((l) => !l.base).map((l) => l.text)]) {
      const missing = (segment ?? "")
        .split(/\s+/)
        .filter((w) => w && w !== "&" && !wordIn(w));
      if (missing.length > 0) add(missing.join(" "));
    }
  }

  const ownNames = new Set(distinctNames(inputs.playerNames).map((n) => n.toLowerCase()));
  const cameos = distinctNames(inputs.cameoNames).filter((n) => !ownNames.has(n.toLowerCase()));
  for (const name of [...cameos].reverse()) {
    if (!phraseIn(name)) add(name);
  }

  // NEO-606 — a team the title still names by its nickname is not left out,
  // only its location is: the note lists a team once the title has stopped
  // naming it at all, and the nickname of a split team is read off its row.
  const teams = (inputs.teamNames ?? []).map((t) => t.trim()).filter(Boolean);
  const nicknames = teamNicknames(inputs.teamSplits);
  for (const team of [...teams].reverse()) {
    if (!titleNamesTeam(text, team, inputs.sport, nicknames.get(team))) add(team);
  }

  const cardNumber = inputs.cardNumber?.trim();
  if (cardNumber) {
    const numberWords = wordsOf(cardNumber);
    const withHash = [`#${numberWords[0]}`, ...numberWords.slice(1)];
    if (!hasPhrase(words, numberWords) && !hasPhrase(words, withHash)) add(`#${cardNumber}`);
  }

  const players = distinctNames(inputs.playerNames);
  for (const name of [...players].reverse()) {
    if (phraseIn(name)) continue;
    const short = withoutFirstName(name);
    if (short && phraseIn(short)) add(name.split(/\s+/)[0]);
    else add(name);
  }

  // A repeat is judged on the text itself ("the title says auto"): an
  // operator who removed "Autographs" left the title with no autograph word.
  const repeatOf = (set: ReadonlySet<string>) => says(text, set);
  const shortPrint = inputs.shortPrint?.trim();
  if (shortPrint && shortPrint !== "None" && !bare.has(shortPrint.toLowerCase())) add(shortPrint);
  if (inputs.isRookie && !repeatOf(ROOKIE_WORDS)) add("RC");
  if (inputs.isRelic && !repeatOf(RELIC_WORDS)) add("RELIC");
  const variation = inputs.cardVariation?.trim();
  if (variation && !alreadySaid(text, variation)) add(variation);
  if (inputs.autographed && inputs.autographed !== "None" && !repeatOf(AUTO_WORDS)) add("AUTO");
  if (inputs.printRun && !present.has(`/${inputs.printRun}`)) add(`/${inputs.printRun}`);
  return out;
}

/**
 * NEO-535 — does `text` already name `team`, roughly? A title (or the box text
 * it opens with) that says "Dodgers" has told the buyer the team, so "Los
 * Angeles Dodgers" is not "left out" of "2024 Topps Dodgers Japan Edition".
 *
 * Said when the text roughly says (`roughlySays`: case, a plural "s" folded)
 * the whole name, or its nickname: the last word of a name of two words or
 * more, once a trailing sport word is set aside ("Oregon Ducks baseball" reads
 * "Ducks"). A one-word team is said only whole. Display only: it decides what
 * "Left out to fit" lists, never what a title carries.
 */
function titleNamesTeam(
  text: string,
  team: string,
  sport: string | undefined,
  nickname?: string,
): boolean {
  if (alreadySaid(text, team) || roughlySays(text, team)) return true;
  const sportWord = sport?.trim().toLowerCase();
  const withoutSport = (name: string): string[] => {
    const words = name.split(/\s+/).filter(Boolean);
    if (words.length > 1 && sportWord && words[words.length - 1].toLowerCase() === sportWord) {
      words.pop();
    }
    return words;
  };
  // NEO-606 — a split team's nickname is its row's own, not the last word of
  // its name: "Red Sox" is said by "Red Sox", and a "Sox" in another team's
  // name does not say it. A one-word nickname is said whole, like a one-word
  // team, and the sport word is set aside as it is for a name.
  if (nickname) {
    return (
      alreadySaid(text, nickname) ||
      roughlySays(text, nickname) ||
      roughlySays(text, withoutSport(nickname).join(" "))
    );
  }
  const words = withoutSport(team);
  if (words.length < team.split(/\s+/).filter(Boolean).length && roughlySays(text, words.join(" "))) {
    return true;
  }
  return words.length > 1 && roughlySays(text, words[words.length - 1]);
}

/**
 * The set label the description opens with: year, maker and set, and the
 * insert's name VERBATIM (the description has room, so nothing is stripped or
 * shortened). Same collapse rules as the title's.
 */
function descriptionSetLabel(inputs: ListingCardInputs): string {
  const setTokens = manufacturerAndSetTokens(inputs);
  const insert = inputs.insertName?.trim();
  let tokens = setTokens;
  if (insert) {
    const joined = setTokens.join(" ");
    const last = setTokens[setTokens.length - 1];
    if (setTokens.length > 0 && startsWithWord(insert, joined)) tokens = [insert];
    else if (last && startsWithWord(insert, last)) tokens = [...setTokens.slice(0, -1), insert];
    else if (!alreadySaid(joined, insert)) tokens = [...setTokens, insert];
  }
  return [inputs.year?.trim(), ...tokens].filter(Boolean).join(" ");
}

/**
 * Full prose description: EVERY fact NB knows about the card (NEO-535, Jason
 * Q4), one fact per line. Collector search substring-matches it, so it states
 * both the long forms and the short forms collectors type: "Rookie Card" and
 * `RC`, autograph wording and `AUTO`, `RELIC`, "Serial numbered to N" and
 * `/N`, `SP`/`SSP`, and `#<cardNumber>` with its "#". Players are named in
 * full and in reading order ("Dwight Gooden", never "Gooden, Dwight").
 *
 * No cap applies: eBay's description field takes ~500k of HTML. Pure and
 * deterministic, so a backfill that reruns it writes nothing the second time.
 * Absent facts are skipped, never rendered as blanks.
 *
 * NEO-528 — the NB names of the people also pictured on the card (its
 * cameos), in stored order, stated on their own line right after the team
 * ("Cameo: Ken Griffey Jr." / "Cameos: A, B."). `extras.cameoNames` when
 * given (`[]` says "no cameo line"), else `inputs.cameoNames`, the ones the
 * title names while it has room.
 */
export function generateListingDescription(
  inputs: ListingCardInputs,
  extras: { cameoNames?: ReadonlyArray<string> } = {},
): string {
  const lines: string[] = [];
  const cardNumber = inputs.cardNumber?.trim();
  const number = cardNumber ? `#${cardNumber}` : "";
  const players = distinctNames(inputs.playerNames);
  const isParallel = isRealParallel(inputs);
  const parallel = isParallel ? inputs.parallelName!.trim() : undefined;
  const variation = inputs.cardVariation?.trim();
  // NEO-189 copies a card's variation into `features.parallelName`; a parallel
  // that IS the variation is stated once, as the variation.
  const parallelIsVariation =
    !!parallel && parallel.toLowerCase() === variation?.toLowerCase();
  const insert = inputs.insertName?.trim();
  // A parallel whose name opens with the insert's whole name ("Anime Red
  // Refractors" under "Anime") already says the insert, so the opening line
  // names it once: the parallel's full name stands where the insert's would.
  // Names that only share leading words ("Gold Refractor" under "Gold
  // Prospects") both stay whole. The Insert and Parallel lines are unchanged.
  const parallelSaysInsert =
    !!parallel && !parallelIsVariation && parallelOpensWithInsert(parallel, insert);
  // NEO-609 (Q6) — with the chain's levels in hand the description names every
  // one of them: the top level in the opening line's set label, the levels
  // below it after it (a level opening with the one above it stands for both,
  // as a parallel does for its insert), and a line per level headed by its
  // variant type's own name. Without them (a dash card, an older caller) the
  // Insert / Parallel lines are exactly what they were.
  const levels = inputs.titleLevels
    ? effectiveLevels(inputs).filter((l) => !l.base)
    : undefined;
  let setLabel: string | null;
  let variant: string;
  if (levels) {
    let labelName = levels[0]?.name;
    const rest: string[] = [];
    for (const level of levels.slice(1)) {
      if (rest.length === 0 && labelName && parallelOpensWithInsert(level.name, labelName)) {
        labelName = level.name;
      } else {
        rest.push(level.name);
      }
    }
    setLabel = descriptionSetLabel({ ...inputs, insertName: labelName }) || null;
    variant = rest.map((name) => ` ${name}`).join("");
  } else {
    setLabel =
      (parallelSaysInsert
        ? descriptionSetLabel({ ...inputs, insertName: parallel })
        : descriptionSetLabel(inputs)) || null;
    variant = parallel && !parallelIsVariation && !parallelSaysInsert ? ` ${parallel}` : "";
  }

  const who = players.join(" & ");
  const numbered = number ? ` ${number}` : "";
  if (setLabel && who) {
    lines.push(`${setLabel}${variant} card of ${who}${number ? `, ${number}` : ""}.`);
  } else if (setLabel) {
    lines.push(`${setLabel}${variant} card${numbered}.`);
  } else if (who) {
    lines.push(`Card${numbered} of ${who}.`);
  } else {
    lines.push(`Card${numbered}.`);
  }

  if (levels) {
    for (const level of levels) {
      if (level.typeName && !isBaseWord(level.typeName)) {
        lines.push(`${typeNameAsSaid(level.typeName)}: ${level.name}.`);
      }
    }
  } else {
    if (insert) lines.push(`Insert: ${insert}.`);
    if (parallel && !parallelIsVariation) lines.push(`Parallel: ${parallel}.`);
  }
  if (variation) {
    lines.push(variation.endsWith(".") ? `Variation: ${variation}` : `Variation: ${variation}.`);
  }
  if (inputs.printRun) {
    lines.push(`Serial numbered to ${inputs.printRun} (/${inputs.printRun}).`);
  }
  if (inputs.autographed && inputs.autographed !== "None") {
    lines.push(`Autographed (AUTO), ${inputs.autographed}.`);
  }
  if (inputs.isRelic) lines.push("Includes a memorabilia relic piece (RELIC).");
  if (inputs.isRookie) lines.push("Rookie Card (RC).");
  if (inputs.shortPrint && inputs.shortPrint !== "None") {
    const label = inputs.shortPrint === "SSP" ? "Super Short Print" : "Short Print";
    lines.push(`${label} (${inputs.shortPrint}).`);
  }
  const teamNames = (inputs.teamNames ?? []).map((t) => t.trim()).filter(Boolean);
  if (teamNames.length > 0) lines.push(`Team: ${teamNames.join(", ")}.`);
  // NEO-528: who else is pictured, named in full like the teams. A name that
  // already ends in a full stop ("Ken Griffey Jr.") does not get a second one.
  const cameoNames = (extras.cameoNames ?? inputs.cameoNames ?? [])
    .map((n) => n.trim())
    .filter(Boolean);
  if (cameoNames.length > 0) {
    const label = cameoNames.length === 1 ? "Cameo" : "Cameos";
    const list = cameoNames.join(", ");
    lines.push(list.endsWith(".") ? `${label}: ${list}` : `${label}: ${list}.`);
  }
  const sport = inputs.sport?.trim();
  if (sport) lines.push(`Sport: ${sport}.`);
  return lines.join("\n");
}

/**
 * The lines `generateListingDescription` writes after its opening line, one
 * shape per fact. Kept beside the generator so the two change together; a
 * test runs the generator's own output back through
 * `readsAsGeneratedDescription`.
 */
const DESCRIPTION_FACT_LINES: readonly RegExp[] = [
  /^Insert: .+\.$/,
  /^Parallel: .+\.$/,
  // NEO-609 (Q6) — a level's line is headed by its variant type's own name,
  // whatever that is: "Proof: Animated Autographs Pre-Production Proofs Lazer Red."
  /^[^:\n]{1,60}: .+\.$/,
  /^Variation: .+$/,
  /^Serial numbered to \d+ \(\/\d+\)\.$/,
  /^Autographed \(AUTO\), .+\.$/,
  /^Includes a memorabilia relic piece \(RELIC\)\.$/,
  /^Rookie Card \(RC\)\.$/,
  /^(?:Super )?Short Print \(.+\)\.$/,
  /^Team: .+\.$/,
  // NEO-528 — the cameo line (no second full stop after "Jr.").
  /^Cameos?: .+$/,
  /^Sport: .+\.$/,
];

/** The opening line: "<set> card of <players>, #<n>." and its shorter forms. */
const DESCRIPTION_OPENING_LINE = /^(?:.+ card|Card)(?:\.| #.+\.| of .+\.)$/;

/**
 * NEO-535 — does `text` read as `generateListingDescription`'s own output (for
 * SOME set of facts, not necessarily the card's current ones)? Its opening
 * line, then only lines of the generator's fact shapes, no blank lines.
 *
 * What the card detail panel's Regenerate goes on: it rebuilds a description
 * that reads as the builder's (one written from older facts, a player renamed
 * since, say) and leaves one an operator wrote alone. The NB-owned write paths
 * use the stricter test instead (`cardDescriptionRefresh`): the stored text
 * must equal what the builder made from the card's facts before the change.
 */
export function readsAsGeneratedDescription(text: string): boolean {
  // Longer than any description a door accepts: not the builder's, and the
  // regexes below never run over unbounded text.
  if (text.length > LISTING_DESCRIPTION_MAX) return false;
  const lines = text.trim().split("\n");
  if (lines.length === 0 || !DESCRIPTION_OPENING_LINE.test(lines[0])) return false;
  return lines
    .slice(1)
    .every((line) => DESCRIPTION_FACT_LINES.some((shape) => shape.test(line)));
}
