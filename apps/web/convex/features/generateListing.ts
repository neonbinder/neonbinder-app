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
 *    fit, skipping any that do not. A REPEAT (rows 1-3) comes back only when
 *    no real token (rows 9+) is still out. The number may come back without
 *    its "#" when that is the only way it fits.
 * 5. Still over 80 after the whole list: when the set has box text ("Set name
 *    in titles", `setShortName`), build again from it and rerun the list.
 *    Still over: STOP. The over-cap title is returned as it stands
 *    (`fits: false`), the card is flagged `titleOverLimit` by its length, and
 *    the operator fixes it in the Card titles dialog. Description words are
 *    never cut: a title that drops "Dugout Collection" is a title for a
 *    different card.
 *
 * Never cut: year, maker, set words, insert name, parallel name, players'
 * surnames, `/N`. Removing only the "#" is never reported as left out.
 */

import { LISTING_DESCRIPTION_MAX, LISTING_TITLE_MAX } from "./listingLimits";
import { variantTypeKindFromTitle } from "../variantRole";
import { isGenerationalSuffix } from "../../lib/players/name-fragment";
import { parallelAfterInsert, parallelOpensWithInsert, roughlySays } from "../listingShortName";

export type ListingCardInputs = {
  cardNumber: string;
  /** Resolved player display names, already looked up from playerIds. */
  playerNames?: string[];
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
   * NEO-535 — the set's box text ("Set name in titles"): the WHOLE set
   * description (year, maker, set, insert, parallel) as the operator typed it.
   * Used verbatim, nothing prepended, and only when the builder's own title is
   * over the cap or lost a first name the box version keeps (see
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
   * False when the card belongs in the Card titles dialog for a first name or
   * the box: it lost a first name, or its title was built from the box. A row
   * is born with `listingTitleTruncated` when this is false. An over-cap title
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
 * Parallel". Cut rows 4 and 5.
 */
export const INSERT_LABEL = "Insert";
export const PARALLEL_LABEL = "Parallel";

/**
 * Does `name` already end with `label` as a word, singular or plural ("Gold
 * Insert", "Prizm Parallels")? Then the label would only repeat it.
 */
function endsWithLabel(name: string, label: string): boolean {
  const words = name.trim().toLowerCase().split(/\s+/);
  const last = words[words.length - 1] ?? "";
  const word = label.toLowerCase();
  return last === word || last === `${word}s`;
}

/**
 * NEO-335 — "Rookie" shortened to "RC" in an insert's name ("Rookie Debut" →
 * "RC Debut"). Cut row 8. Exactly the old builder's replacement: the FIRST
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

/** The words that make AUTO, RC and RELIC repeats (cut rows 1-3). */
const AUTO_WORDS: ReadonlySet<string> = new Set([
  "auto",
  "autos",
  "autograph",
  "autographs",
  "autographed",
]);
const ROOKIE_WORDS: ReadonlySet<string> = new Set(["rookie", "rookies", "rc", "rcs"]);
const RELIC_WORDS: ReadonlySet<string> = new Set(["relic", "relics"]);

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

/** The description half of a title: the builder's own, or the box text. */
type DescriptionParts = {
  /** Year + maker + set, or the whole box text. Never cut. */
  head: string;
  /** The insert's words as the title says them. Never cut. */
  insert?: string;
  /** The insert's words with "Rookie" → "RC" (cut row 8), when that differs. */
  insertRc?: string;
  /** "Insert" follows the insert (cut row 4). */
  insertLabel: boolean;
  /** The parallel's words. Never cut. */
  parallel?: string;
  /** "Parallel" follows the parallel (cut row 5). */
  parallelLabel: boolean;
};

/**
 * The builder's description, in parts. The insert collapses into the set when
 * it is named after it ("Topps Chrome Refractor" under "Topps Chrome"), and is
 * left out when the set already says every word of it; otherwise it follows
 * the set with the year and maker words stripped (row 0). The parallel follows
 * the insert the same way, and the leading words it shares with the insert's
 * name are said once (NEO-535, `parallelAfterInsert`). A "parallel" that is
 * the card's own variation text (NEO-189 copies `cardVariation` into
 * `features.parallelName`) is not a parallel: the variation states itself in
 * the tail.
 */
function builderDescriptionParts(inputs: ListingCardInputs): DescriptionParts {
  const year = inputs.year?.trim();
  const setTokens = manufacturerAndSetTokens(inputs);
  const insertRaw = inputs.insertName?.trim();
  let headTokens = setTokens;
  let insert: string | undefined;
  if (insertRaw) {
    const joined = setTokens.join(" ");
    const last = setTokens[setTokens.length - 1];
    if (setTokens.length > 0 && startsWithWord(insertRaw, joined)) {
      headTokens = [];
      insert = insertRaw;
    } else if (last && startsWithWord(insertRaw, last)) {
      headTokens = setTokens.slice(0, -1);
      insert = insertRaw;
    } else if (!alreadySaid(joined, insertRaw)) {
      insert = stripDoubledWords(insertRaw, inputs) || undefined;
    }
  }
  const head = [year, ...headTokens].filter(Boolean).join(" ");
  const soFar = [head, insert].filter(Boolean).join(" ");

  let parallel: string | undefined;
  const variation = inputs.cardVariation?.trim().toLowerCase();
  if (isRealParallel(inputs)) {
    const raw = inputs.parallelName!.trim();
    if (raw.toLowerCase() !== variation) {
      // NEO-535 — the leading words the parallel shares with its insert are
      // said once, by the insert ("Anime" + "Anime Red Refractors" →
      // "Anime Red Refractors"; `parallelAfterInsert`).
      const stripped = stripDoubledWords(parallelAfterInsert(raw, insert ?? insertRaw), inputs);
      if (stripped && !alreadySaid(soFar, stripped)) parallel = stripped;
    }
  }

  const insertRc = insert && rookieAsRc(insert) !== insert ? rookieAsRc(insert) : undefined;
  return {
    head,
    insert,
    insertRc,
    insertLabel: !!insertRaw && !endsWithLabel(insertRaw, INSERT_LABEL),
    parallel,
    parallelLabel:
      !!parallel && inputs.parallelIsRole === true && !endsWithLabel(parallel, PARALLEL_LABEL),
  };
}

/** The box text as a description: verbatim, no labels, nothing to shorten. */
function boxDescriptionParts(box: string): DescriptionParts {
  return { head: box.trim(), insertLabel: false, parallelLabel: false };
}

/**
 * NEO-535 — the builder's full set description, without the "Insert" and
 * "Parallel" labels: "2026 Leaf Metal 1991 Gold Prospects Autographs
 * Prismatic Silver". What the "Set name in titles" box is prefilled with when
 * no value is stored (`listingInputs.setDescriptionForTitles`). Ignores
 * `setShortName`.
 */
export function titleDescription(inputs: ListingCardInputs): string {
  const parts = builderDescriptionParts(inputs);
  return [parts.head, parts.insert, parts.parallel].filter(Boolean).join(" ");
}

/**
 * NEO-535 — every form the builder's description can take in a title it
 * wrote, longest first: with and without the "Insert" and "Parallel" labels
 * (cut rows 4 and 5), and with the insert's "Rookie" read as "RC" (row 8).
 * What `features/carriedTitle` looks for in a source card's hand-edited title
 * to tell its description from the operator's own words. Ignores
 * `setShortName` (the caller adds the box text as its own candidate).
 */
export function titleDescriptionForms(inputs: ListingCardInputs): string[] {
  const parts = builderDescriptionParts(inputs);
  const inserts: Array<string | undefined> = parts.insert
    ? [parts.insert, ...(parts.insertRc ? [parts.insertRc] : [])]
    : [undefined];
  const insertLabels = parts.insertLabel ? [true, false] : [false];
  const parallelLabels = parts.parallelLabel ? [true, false] : [false];
  const forms = new Set<string>();
  for (const insert of inserts) {
    for (const insertLabel of insertLabels) {
      for (const parallelLabel of parallelLabels) {
        const form = [
          parts.head,
          insert,
          insertLabel ? INSERT_LABEL : undefined,
          parts.parallel,
          parallelLabel ? PARALLEL_LABEL : undefined,
        ]
          .filter(Boolean)
          .join(" ");
        if (form) forms.add(form);
      }
    }
  }
  return [...forms].sort((a, b) => b.length - a.length);
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
type TailToken = { kind: TailKind; text: string; in: boolean; latent?: true };

/** One title under construction: what is in, what is cut. */
type TitleState = {
  parts: DescriptionParts;
  insertAbbreviated: boolean;
  insertLabelIn: boolean;
  parallelLabelIn: boolean;
  players: Array<{ full: string; short?: string; firstOut: boolean }>;
  number?: { text: string; mode: "hash" | "bare" | "out" };
  tail: TailToken[];
};

function renderTitle(state: TitleState): string {
  const out: string[] = [state.parts.head];
  const { insert, insertRc, parallel } = state.parts;
  if (insert) out.push(state.insertAbbreviated && insertRc ? insertRc : insert);
  if (state.insertLabelIn) out.push(INSERT_LABEL);
  if (parallel) out.push(parallel);
  if (state.parallelLabelIn) out.push(PARALLEL_LABEL);
  const players = state.players.map((p) => (p.firstOut && p.short ? p.short : p.full));
  if (players.length > 0) out.push(players.join(" & "));
  if (state.number && state.number.mode !== "out") {
    out.push(state.number.mode === "hash" ? `#${state.number.text}` : state.number.text);
  }
  for (const token of state.tail) if (token.in) out.push(token.text);
  // NEO-363 — `listingTitle` is required and never blank. A card with nothing
  // else to say still gets "#", as the pre-NEO-535 builder always gave it.
  return out.filter(Boolean).join(" ") || "#";
}

/** The full title's state, before any cut, for one description. */
function fullTitleState(inputs: ListingCardInputs, parts: DescriptionParts): {
  state: TitleState;
  repeats: { auto: boolean; rc: boolean; relic: boolean };
} {
  const players = distinctNames(inputs.playerNames).map((full) => ({
    full,
    short: withoutFirstName(full),
    firstOut: false,
  }));
  const cardNumber = inputs.cardNumber?.trim();
  const state: TitleState = {
    parts,
    insertAbbreviated: false,
    insertLabelIn: parts.insertLabel,
    parallelLabelIn: parts.parallelLabel,
    players,
    ...(cardNumber ? { number: { text: cardNumber, mode: "hash" as const } } : {}),
    tail: [],
  };

  // What the title says besides the tokens themselves: the description and
  // the variation. AUTO, RC and RELIC are REPEATS when it already says them.
  const description = [parts.head, parts.insert, parts.parallel].filter(Boolean).join(" ");
  const variation = inputs.cardVariation?.trim();
  const context = [description, variation].filter(Boolean).join(" ");
  const repeats = {
    auto: says(context, AUTO_WORDS),
    rc: says(context, ROOKIE_WORDS),
    relic: says(context, RELIC_WORDS),
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
  for (const team of inputs.teamNames ?? []) {
    const trimmed = team.trim();
    if (trimmed) pushUnlessSaid("team", trimmed);
  }
  // The second spelling of rookie, only beside an RC that is not a repeat.
  if (inputs.isRookie && !repeats.rc && !alreadySaid(renderTitle(state), "Rookie")) {
    push("rookie", "Rookie");
  }
  const sport = inputs.sport?.trim();
  if (sport) pushUnlessSaid("sport", sport);
  return { state, repeats };
}

/** One cut, and how to undo it. `restores` are tried in order on refill. */
type Cut = {
  row: number;
  /** Cut order within the whole list (row, then position within the row). */
  rank: number;
  /** A latent token's text: offered back only while the title does not say it. */
  latentText?: string;
  /** Rows 9+: a token an operator is shown as left out. */
  real: boolean;
  /** Rows 1-3: AUTO, RC or RELIC the title already says. */
  repeat: boolean;
  out: boolean;
  cut: () => void;
  restores: Array<() => void>;
};

/**
 * The cut list, in order (1 = first to go):
 *
 *   1  AUTO, when the title says auto/autograph(s)/autographed (repeat)
 *   2  RC, when the title says Rookie/Rookies/RC (repeat)
 *   3  RELIC, when the title says Relic/Relics (repeat)
 *   4  the "Insert" label
 *   5  the "Parallel" label
 *   6  the sport (already skipped when a team name says it)
 *   7  the second "Rookie" (only ever beside a non-repeat RC)
 *   8  "Rookie" → "RC" inside the insert's name
 *   9  teams, last first
 *   10 the card number (the "#" alone goes at 81, before any cut)
 *   11 first names, last player first, one per step
 *   12 SP / SSP
 *   13 RC (non-repeat)
 *   14 RELIC (non-repeat)
 *   15 the variation
 *   16 AUTO (non-repeat)
 *
 * Rows 4, 5 and 8 exist only on the builder's description, never on the box.
 */
function planCuts(
  state: TitleState,
  repeats: { auto: boolean; rc: boolean; relic: boolean },
): Cut[] {
  const cuts: Cut[] = [];
  const add = (
    row: number,
    cut: () => void,
    restores: Array<() => void>,
    repeat = false,
    rank = cutRank(row),
  ) => {
    cuts.push({ row, rank, real: row >= 9, repeat, out: false, cut, restores });
  };
  const tokens = (kind: TailKind) => state.tail.filter((t) => t.kind === kind && t.in);
  const toggle = (row: number, token: TailToken, repeat = false) =>
    add(
      row,
      () => { token.in = false; },
      [() => { token.in = true; }],
      repeat,
      cutRank(row, token.kind === "team" ? teamPlace(state, token) : 0),
    );

  if (repeats.auto) for (const t of tokens("auto")) toggle(1, t, true);
  if (repeats.rc) for (const t of tokens("rc")) toggle(2, t, true);
  if (repeats.relic) for (const t of tokens("relic")) toggle(3, t, true);
  if (state.insertLabelIn) {
    add(4, () => { state.insertLabelIn = false; }, [() => { state.insertLabelIn = true; }]);
  }
  if (state.parallelLabelIn) {
    add(5, () => { state.parallelLabelIn = false; }, [() => { state.parallelLabelIn = true; }]);
  }
  for (const t of tokens("sport")) toggle(6, t);
  for (const t of tokens("rookie")) toggle(7, t);
  if (state.parts.insertRc) {
    add(8, () => { state.insertAbbreviated = true; }, [() => { state.insertAbbreviated = false; }]);
  }
  for (const t of [...tokens("team")].reverse()) toggle(9, t);
  const number = state.number;
  if (number) {
    add(10, () => { number.mode = "out"; }, [
      () => { number.mode = "hash"; },
      () => { number.mode = "bare"; },
    ]);
  }
  for (const [index, player] of [...state.players.entries()].reverse()) {
    if (player.short === undefined) continue;
    add(
      11,
      () => { player.firstOut = true; },
      [() => { player.firstOut = false; }],
      false,
      cutRank(11, LAST_FIRST - index),
    );
  }
  for (const t of tokens("sp")) toggle(12, t);
  if (!repeats.rc) for (const t of tokens("rc")) toggle(13, t);
  if (!repeats.relic) for (const t of tokens("relic")) toggle(14, t);
  for (const t of tokens("variation")) toggle(15, t);
  if (!repeats.auto) for (const t of tokens("auto")) toggle(16, t);
  return cuts;
}

/**
 * A cut's place in the cut order: its row, then its place within the row.
 * Teams and first names go last first, so a later team or player ranks lower
 * (is cut sooner, and refilled later).
 */
const LAST_FIRST = 999;
function cutRank(row: number, within = 0): number {
  return row * 1000 + within;
}

/** A team token's place within row 9: last first. */
function teamPlace(state: TitleState, token: TailToken): number {
  return LAST_FIRST - state.tail.filter((t) => t.kind === "team").indexOf(token);
}

/**
 * The latent tokens as cuts already made, ranked where the cut list would
 * have cut them: the sport at row 6, a team at row 9 in its last-first place,
 * the variation at row 15.
 */
function latentCuts(state: TitleState): Cut[] {
  const rowOf: Partial<Record<TailKind, number>> = { sport: 6, team: 9, variation: 15 };
  const out: Cut[] = [];
  for (const token of state.tail) {
    const row = token.latent ? rowOf[token.kind] : undefined;
    if (row === undefined) continue;
    out.push({
      row,
      rank: cutRank(row, token.kind === "team" ? teamPlace(state, token) : 0),
      latentText: token.text,
      real: row >= 9,
      repeat: false,
      out: true,
      cut: () => { token.in = false; },
      restores: [() => { token.in = true; }],
    });
  }
  return out;
}

/** Steps 1-4 of the loop over one description. */
function cutToFit(
  inputs: ListingCardInputs,
  parts: DescriptionParts,
): { title: string; fits: boolean; firstNamesLost: number } {
  const { state, repeats } = fullTitleState(inputs, parts);
  const length = () => renderTitle(state).length;
  // Step 2's "#" rule: at exactly 81, the "#" alone goes, and the loop stops.
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
    if (hashRule()) break;
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
  };
}

/**
 * NEO-535 — the listing title, and what it had to give up.
 *
 * The builder's title comes first. The box text ("Set name in titles",
 * `setShortName`) replaces the builder's description only when:
 *
 *   (a) the builder's title is still over the cap after every cut, or
 *   (b) the builder's title lost a first name and the box version, which
 *       fits, loses fewer (Jason, Q1).
 *
 * Never on a title that fits with full names. The rule lives here so the
 * pre-save Card titles step, the insert and Regenerate cannot disagree.
 * When the box version is over the cap too, it is the one returned: it is
 * the text the operator chose and will edit.
 */
export function assessListingTitle(inputs: ListingCardInputs): ListingTitleAssessment {
  const builder = cutToFit(inputs, builderDescriptionParts(inputs));
  let chosen = builder;
  let boxUsed = false;
  const box = inputs.setShortName?.trim();
  if (box && (!builder.fits || builder.firstNamesLost > 0)) {
    const boxed = cutToFit(inputs, boxDescriptionParts(box));
    if (!builder.fits || (boxed.fits && boxed.firstNamesLost < builder.firstNamesLost)) {
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
    coreFits: !firstNameLost && !boxUsed,
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
    for (const segment of [parts.head, parts.insert, parts.parallel]) {
      const missing = (segment ?? "")
        .split(/\s+/)
        .filter((w) => w && w !== "&" && !wordIn(w));
      if (missing.length > 0) add(missing.join(" "));
    }
  }

  const teams = (inputs.teamNames ?? []).map((t) => t.trim()).filter(Boolean);
  for (const team of [...teams].reverse()) {
    if (!titleNamesTeam(text, team, inputs.sport)) add(team);
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
function titleNamesTeam(text: string, team: string, sport: string | undefined): boolean {
  if (alreadySaid(text, team) || roughlySays(text, team)) return true;
  const words = team.split(/\s+/).filter(Boolean);
  const sportWord = sport?.trim().toLowerCase();
  if (words.length > 1 && sportWord && words[words.length - 1].toLowerCase() === sportWord) {
    words.pop();
    if (roughlySays(text, words.join(" "))) return true;
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
 */
export function generateListingDescription(inputs: ListingCardInputs): string {
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
  const setLabel =
    (parallelSaysInsert
      ? descriptionSetLabel({ ...inputs, insertName: parallel })
      : descriptionSetLabel(inputs)) || null;
  const variant = parallel && !parallelIsVariation && !parallelSaysInsert ? ` ${parallel}` : "";

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

  if (insert) lines.push(`Insert: ${insert}.`);
  if (parallel && !parallelIsVariation) lines.push(`Parallel: ${parallel}.`);
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
  /^Variation: .+$/,
  /^Serial numbered to \d+ \(\/\d+\)\.$/,
  /^Autographed \(AUTO\), .+\.$/,
  /^Includes a memorabilia relic piece \(RELIC\)\.$/,
  /^Rookie Card \(RC\)\.$/,
  /^(?:Super )?Short Print \(.+\)\.$/,
  /^Team: .+\.$/,
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
