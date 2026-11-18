/**
 * NEO-500 — the Pick List's rules, pure: how sale lines merge into rows, the
 * order a seller walks them in, the filters, the groups, and the boxes in
 * By the Box. No store, no React, so the demo and the real store pull the
 * same way.
 *
 * Default order (Jason): sport, year newest first, set, variant type (Base,
 * Parallel, Insert, Parallel of an Insert), the insert or parallel's name,
 * then card number in natural order ("BC-2" before "BC-12", "12" before
 * "12a"). A season files under its start year ("2023-24" sorts as 2023):
 * that is the set's `year`. A card number is never assumed unique: rows
 * that tie on it fall through to the player and the line's id.
 *
 * NEO-509: a sale NB could not tie to a card still walks with its set when
 * the listing says enough (sport, year, set, number). Every rule reads a
 * row through one accessor, `rowFacts`, so a card and a listing sort,
 * group and filter alike; `row.card` still means "NB matched it".
 *
 * NEO-590: a sale with no card whose listing has only a title (every
 * unmatched eBay line) is filed by that title: its leading year and set words
 * (`parseListingTitle`) and, only when the title opens with a year, the sport
 * of an NB player or team it names (the store asks the server,
 * `ListedCard.titleSport`). A title that does not parse (clothing, a lot, a
 * set, no year) files under Other even if it names an NB team or player
 * ("Kansas City Chiefs Hoodie XL"). The title is parsed for Pick List order
 * only, never matched to a card and never written to NB.
 */

import type { Infer } from "convex/values";
import { cardNumberToken, skipGraderPrefix } from "@/convex/lib/titleSport";
import type { saleItemListedValidator } from "@/convex/schema";
import { variantTypeKindFromTitle } from "@/convex/variantRole";
import { setLabel } from "../data/labels";
import type { Card, SetRef } from "../data/types";
import type { ListedCard, PickBox, PickGrade, PickOrder, PickPhoto, PickSpot, SaleLine } from "./types";

// ---------------------------------------------------------------------------
// Natural order
// ---------------------------------------------------------------------------

const COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** Natural, case-blind order: "BC-2" < "BC-12", "12" < "12a" < "US150". */
export function naturalCompare(a: string, b: string): number {
  return COLLATOR.compare(a, b);
}

// ---------------------------------------------------------------------------
// Variant role
// ---------------------------------------------------------------------------

/** Which divider a card files behind. */
export type VariantRole = "base" | "parallel" | "insert" | "insertParallel";

export const VARIANT_ROLES: readonly VariantRole[] = ["base", "parallel", "insert", "insertParallel"];

/** What each role is called, written beside its colour every time. */
export const VARIANT_ROLE_LABEL: Record<VariantRole, string> = {
  base: "Base",
  parallel: "Parallel",
  insert: "Insert",
  insertParallel: "Insert parallel",
};

const ROLE_RANK: Record<VariantRole, number> = { base: 0, parallel: 1, insert: 2, insertParallel: 3 };

/**
 * Where a row with no role walks: a listing whose variant word NB does not
 * file by ("Variation", "SP") or that names none. Right after Base, since an
 * image variation or a short print shares the base's number; never shown.
 */
const NO_ROLE_RANK = 0.5;

function roleRank(role: VariantRole | null): number {
  return role ? ROLE_RANK[role] : NO_ROLE_RANK;
}

/**
 * A card's divider, from NB's own variant kind: a parallel under an insert
 * is an insert parallel; a variant of no kind ("Promo") reads like an insert.
 */
export function variantRole(card: Pick<Card, "variant">): VariantRole {
  const { kind, insertName } = card.variant;
  if (kind === "base") return "base";
  if (kind === "parallel") return insertName ? "insertParallel" : "parallel";
  return "insert";
}

/** "Pennant Flyers", "Gold Refractor", "Pennant Flyers Gold"; null for Base. */
export function variantName(card: Pick<Card, "variant">): string | null {
  const { kind, name, insertName } = card.variant;
  if (kind === "base" || !name) return null;
  return insertName ? `${insertName} ${name}` : name;
}

// ---------------------------------------------------------------------------
// Rows: sale lines merged
// ---------------------------------------------------------------------------

/** One row of the list: one or more sale lines for the same copy kind. */
export interface PickRow {
  key: string;
  lines: readonly SaleLine[];
  card: Card | null;
  sportCode: string | null;
  listingTitle: string;
  problem?: string;
  /** Copies to pull across every merged line. */
  quantity: number;
  condition: string;
  serial?: string;
  grade?: PickGrade;
  /** Every order it fills, in first-seen order. */
  orders: readonly PickOrder[];
  lastOnes: boolean;
  /** Copies short across every merged line; 0 when none. */
  short: number;
  isNew: boolean;
  spot?: PickSpot;
  /** NB did not note the box for at least one merged line. */
  boxUnrecorded: boolean;
  /** The first merged line's copy photo, when one has it. */
  photo?: PickPhoto;
  /** NEO-509 — on a row with no card: what the sale says the card is. */
  listed?: ListedCard;
  /** The NB set on the list a `listed` row files behind (`listedSetFor`). */
  joined?: SetOnList;
}

function gradeKey(g: PickGrade | undefined): string {
  return g ? `${g.grader}|${g.grade}|${g.cert}` : "";
}

/**
 * The same card in the same condition across orders is one row (qty 2,
 * both order numbers). Slabs and numbered copies are each their own copy,
 * so a different cert or serial never merges; a line NB could not match
 * never merges; a new line stays with the new ones. `bySpot` (By the Box)
 * also keeps copies in different boxes or slots apart.
 */
export function mergeKey(line: SaleLine, bySpot = false): string {
  if (!line.card) return `line:${line.id}`;
  const parts = [line.card.id, line.condition.toLowerCase(), gradeKey(line.grade), line.serial ?? "", line.isNew ? "new" : ""];
  if (bySpot) parts.push(line.spot?.boxId ?? "", line.spot?.slot === undefined ? "" : String(line.spot.slot));
  return parts.join("|");
}

/**
 * `sets` are the NB sets a listed row may file behind; by default the sets
 * of `lines` themselves. A caller merging part of the list (one order, one
 * stop) passes the whole list's, so a listing files the same way everywhere.
 */
export function mergeLines(
  lines: readonly SaleLine[],
  options: { bySpot?: boolean; sets?: readonly SetOnList[] } = {},
): PickRow[] {
  const rows = new Map<string, SaleLine[]>();
  for (const line of lines) {
    const key = mergeKey(line, options.bySpot);
    const group = rows.get(key);
    if (group) group.push(line);
    else rows.set(key, [line]);
  }
  let sets = options.sets;
  return [...rows].map(([key, group]) => {
    const row = toRow(key, group);
    if (row.card || !row.listed) return row;
    sets ??= setsOnList(lines);
    const joined = listedSetFor(row.listed, sets);
    return joined ? { ...row, joined, sportCode: joined.sportCode } : row;
  });
}

function toRow(key: string, group: SaleLine[]): PickRow {
  const first = group[0];
  const orders: PickOrder[] = [];
  for (const line of group) if (!orders.some((o) => o.id === line.order.id)) orders.push(line.order);
  return {
    key,
    lines: group,
    card: first.card,
    sportCode: first.sportCode,
    listingTitle: first.listingTitle,
    problem: first.problem,
    quantity: group.reduce((n, l) => n + l.quantity, 0),
    condition: first.condition,
    serial: first.serial,
    grade: first.grade,
    orders,
    lastOnes: group.some((l) => l.lastOnes),
    short: group.reduce((n, l) => n + (l.short ?? 0), 0),
    isNew: group.every((l) => l.isNew),
    spot: first.spot,
    boxUnrecorded: group.some((l) => l.boxUnrecorded),
    photo: group.find((l) => l.photo)?.photo,
    ...(first.card || !first.listed ? {} : { listed: first.listed }),
  };
}

// ---------------------------------------------------------------------------
// Row facts: a card, or what a listing says it is
// ---------------------------------------------------------------------------

/** What every rule reads of a row, whether NB matched it or only the listing says it. */
export interface RowFacts {
  /** NB's sport id; `sport:<word>` for a listing's sport NB has no row for; `title:other` for a title row no sport was found for. */
  sportKey: string;
  sportName: string;
  /** The year the set files under; null on a title row whose title opens with none. */
  year: number | null;
  /** The set's own name, without the season. */
  setName: string;
  /** 0 for an NB set, 1 for a listing's own: NB's divider comes first when the names tie. */
  setRank: 0 | 1;
  /** NB's set id, or `listed:<sport>|<year>|<name>` for a listing's own divider. */
  setKey: string;
  /** The divider's title: "2024 Topps Chrome". */
  setTitle: string;
  /** NB's code for the sport ("BB"): the divider's colour. Null when NB has no sport row for it. */
  sportCode: string | null;
  /** The variant's divider; null when a listing names no variant NB files by (never guessed). */
  role: VariantRole | null;
  /** A listing's own variant word NB does not file by ("Variation", "SP"); null otherwise. */
  variantWord: string | null;
  /** The insert or parallel's name; null for Base (a listing's Base keeps a name it gives). */
  variantName: string | null;
  cardNumber: string;
  players: string;
  /**
   * NEO-590 — a row with no card and no place to file by, filed by its
   * listing's title alone: `setName` is the title's set words, `setTitle` the
   * one "Sales NB didn't list" divider of its sport. It draws its title
   * across the columns, never as a card (`cardFacts`).
   */
  fromTitle?: true;
}

/** The sport key of the title rows no NB player or team placed. */
export const TITLE_OTHER_SPORT = "title:other";

/** The one divider a sport's title rows file behind, after its NB sets. */
export const TITLE_SET_TITLE = "Sales Neon Binder didn't list";

/**
 * The variant words a listing gives that are worth writing: its own word NB
 * does not file by, and its variant name. A name that only repeats the word
 * or the role ("Base" on a Base line) is dropped, so nothing reads twice.
 */
export function listedVariant(listed: ListedCard): { word: string | null; name: string | null } {
  const word = listed.variantWord?.trim() || null;
  const raw = listed.variantName?.trim() || null;
  const repeats =
    raw !== null &&
    ((word !== null && fold(raw) === fold(word)) || (listed.role !== undefined && variantTypeKindFromTitle(raw) === listed.role));
  return { word, name: repeats ? null : raw };
}

/** The variant as one phrase for a title: "1991 Throwback", "SP Photo", "Insert"; null for Base or none. */
function listedVariantPhrase(listed: ListedCard): string | null {
  const { word, name } = listedVariant(listed);
  if (word && name) return containsWholeWords(name, word) ? name : `${word} ${name}`;
  if (word || name) return word ?? name;
  return listed.role === "insert" ? "Insert" : listed.role === "parallel" ? "Parallel" : null;
}

/**
 * A listing's title, from whatever it says, in the order a seller finds a
 * card in a box: the set, the insert or parallel, the number, then who is on
 * it. "2021 Score 1991 Throwback #TB2 · Justin Fields". Base is not written
 * (the chip says it); an empty answer means the listing said nothing a
 * seller could look for. With no such words, the listing's own title
 * (NEO-520), parsed for Pick List order only (`parseListingTitle`), never matched to a card.
 */
export function listedTitle(listed: ListedCard): string {
  const season = listed.season?.trim();
  const setName = listed.setName?.trim();
  const set = setName ? (season && !fold(setName).startsWith(`${fold(season)} `) ? `${season} ${setName}` : setName) : season;
  const card = [set, listedVariantPhrase(listed), listed.cardNumber?.trim() ? `#${listed.cardNumber.trim()}` : undefined]
    .filter(Boolean)
    .join(" ");
  // NEO-520: a listing with no card words (an eBay line NB didn't list) is named by its own title, as sent.
  return [card, listed.players?.trim()].filter(Boolean).join(" · ") || (listed.title?.trim() ?? "");
}

/** A sale line's own words for its card, as the order poll stored them (`marketplaceSales.items[].listed`). */
export type RawListed = Infer<typeof saleItemListedValidator>;

/** NB's sport row a sale names: its name and SKU code. */
export interface SportRow {
  name: string;
  code: string | null;
}

/** The NB sport a title's player or team names (NEO-590); null when none was found. */
export type TitleSport = (SportRow & { id: string }) | null;

/** A listing's words, trimmed; blank is absent. */
export function words(text: string | undefined): string | undefined {
  const t = text?.replace(/\s+/g, " ").trim();
  return t ? t : undefined;
}

/**
 * A sale's words for its card, resolved: NB's sport when the sale named one
 * NB has (`sport` loaded), else the listing's sport word; the year as a
 * number; the variant's divider only when its word IS one (Base, Insert,
 * Parallel). A word NB does not file by ("Variation", "SP", "Promo") is kept
 * as written (`variantWord`), never read as a role, and the listing's
 * variant name is kept whatever the word. Undefined when the words say nothing.
 * `titleSport` is the server's answer for the listing's title (NEO-590): null
 * is "asked, no sport found", undefined "not asked".
 */
export function toListedCard(
  raw: RawListed,
  sport: SportRow | null | undefined,
  titleSport?: TitleSport,
): ListedCard | undefined {
  const season = words(raw.year);
  const year = season ? listedYear(season) : undefined;
  const variant = words(raw.variant);
  const variantName = words(raw.variantName);
  const kind = variantTypeKindFromTitle(variant);
  const sportName = sport?.name ?? words(raw.sport);
  const out: ListedCard = {
    ...(sport && raw.sportId ? { sportId: raw.sportId } : {}),
    ...(sportName ? { sportName } : {}),
    ...(sport?.code ? { sportCode: sport.code } : {}),
    ...(year !== undefined ? { year } : {}),
    ...(season ? { season } : {}),
    ...(words(raw.setName) ? { setName: words(raw.setName) } : {}),
    ...(words(raw.players) ? { players: words(raw.players) } : {}),
    ...(words(raw.cardNo) ? { cardNumber: words(raw.cardNo) } : {}),
    ...(kind ? { role: kind } : {}),
    // A word NB does not file by ("Variation") is how the seller tells the copy from the base: kept as written.
    ...(variant && !kind ? { variantWord: variant } : {}),
    ...(variantName ? { variantName } : {}),
    // NEO-520: the listing's own title (eBay). NEO-590: parsed for Pick List order only, never matched to a card.
    ...(words(raw.title) ? { title: words(raw.title) } : {}),
    ...(words(raw.title) && titleSport !== undefined ? { titleSport } : {}),
  };
  return Object.keys(out).length ? out : undefined;
}

/** One NB set on the list, with its sport's code (the divider colour). */
export interface SetOnList {
  set: SetRef;
  sportCode: string | null;
}

/**
 * Whether `name` says `word` as whole words, folded: "Photo Variation" says
 * "Variation", but "Gold Special" does not say "SP". A boundary is the edge
 * of the text or any character that is not a letter or a digit.
 */
function containsWholeWords(name: string, word: string): boolean {
  const escaped = fold(word).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, "u").test(fold(name));
}

/** Trimmed, inner spaces collapsed, case-folded. */
function fold(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

/** The years a listing's year may name: anything else is a misread, not a year. */
const FIRST_YEAR = 1800;
const LAST_YEAR = 2100;

/** "2021" is 2021; a season files under its start: "2023-24" and "2023/2024" are 2023. */
export function listedYear(season: string): number | undefined {
  const m = /^(\d{4})(?:\s*[-–/]\s*(?:\d{2}|\d{4}))?$/.exec(season);
  if (!m) return undefined;
  const year = Number(m[1]);
  return year >= FIRST_YEAR && year <= LAST_YEAR ? year : undefined;
}

/** What a listing's own title says of its place (NEO-590): never a card, only where to look. */
export interface ParsedTitle {
  /** The leading year or season's start ("2023-24" is 2023); null when the title does not open with one. */
  year: number | null;
  /** The token after a `#` when the title has one ("#BC-12" is "BC-12"); "" otherwise. */
  cardNumber: string;
  /** The words between the year and the `#`, or the rest of the title; not split further. */
  setText: string;
}

/**
 * A listing's title read for the Pick List's order: "2021 Panini Prizm #12
 * Justin Herbert" is 2021, "Panini Prizm", "12". A title that opens with no
 * year keeps its whole text as the set words (the row then files by sport
 * alone). A graded slab's title leads with its grader and grade ("PSA 10
 * 2018 Prizm Luka Doncic #280"): that one pair is skipped before the year is
 * read, so the slab parses like the raw card; with no year after it the title
 * still does not parse and keeps its whole text, grader included. Never a
 * match: this only orders a row NB has no card for.
 */
export function parseListingTitle(title: string): ParsedTitle {
  const text = title.replace(/\s+/g, " ").trim();
  const lead = /^(\S+)(?:\s+(.*))?$/.exec(skipGraderPrefix(text));
  const year = lead ? (listedYear(lead[1]) ?? null) : null;
  const rest = year !== null && lead ? (lead[2] ?? "") : text;
  const at = rest.indexOf("#");
  if (at < 0) return { year, cardNumber: "", setText: rest.trim() };
  const number = cardNumberToken(rest.slice(at))?.[1].replace(/[.,;:]+$/, "") ?? "";
  return { year, cardNumber: number, setText: rest.slice(0, at).trim() };
}

/**
 * Whether a listing's title parses (NEO-590): it opens with a year (after a
 * slab's grader and grade, if any). Only such
 * a title may be filed under a sport, so only such a title is worth asking the
 * server about (`pickList.titleSports`); anything else files under Other.
 */
export function titleParses(title: string): boolean {
  return parseListingTitle(title).year !== null;
}

interface ListedPlace {
  sportName: string;
  year: number;
  /** The set's name without a leading season. */
  setName: string;
  /** "2021 Score": the season, then the name. */
  setTitle: string;
  cardNumber: string;
}

/**
 * Where a listing files, when it says enough: a year NB can file under, a
 * set name, a card number and a sport (NB's, or the listing's word).
 * Null otherwise: the line stays in "Can't find it".
 */
function listedPlace(listed: ListedCard): ListedPlace | null {
  const { year } = listed;
  if (year === undefined || !Number.isInteger(year) || year < FIRST_YEAR || year > LAST_YEAR) return null;
  const rawSet = listed.setName?.trim();
  const cardNumber = listed.cardNumber?.trim();
  const sportName = listed.sportName?.trim();
  if (!rawSet || !cardNumber || !sportName) return null;
  const season = listed.season?.trim() || String(year);
  // A listing may write its set with the season in front ("2024 Topps Chrome") or without ("Score").
  const setName = fold(rawSet).startsWith(`${fold(season)} `) ? rawSet.slice(season.length).trim() : rawSet;
  if (!setName) return null;
  return { sportName, year, setName, setTitle: `${season} ${setName}`, cardNumber };
}

/**
 * THE one rule for whether a listing files behind an NB set's divider: when
 * exactly one NB set on the list has its sport (NB's id when the sale named
 * one, else the sport's name), its year, and its set name (case-folded, the
 * listing's season dropped). Anything else gets its own divider, titled
 * with the listing's set. Returning null here gives every listing its own.
 */
export function listedSetFor(listed: ListedCard, sets: readonly SetOnList[]): SetOnList | null {
  const place = listedPlace(listed);
  if (!place) return null;
  const name = fold(place.setName);
  const sport = fold(place.sportName);
  const hits = sets.filter(
    ({ set }) =>
      (listed.sportId ? set.sport.id === listed.sportId : fold(set.sport.name) === sport) &&
      set.year === place.year &&
      fold(set.name) === name,
  );
  return hits.length === 1 ? hits[0] : null;
}

/** The NB sets the matched lines name, once each. */
export function setsOnList(lines: readonly SaleLine[]): SetOnList[] {
  const sets = new Map<string, SetOnList>();
  for (const line of lines) {
    if (line.card && !sets.has(line.card.set.id)) sets.set(line.card.set.id, { set: line.card.set, sportCode: line.sportCode });
  }
  return [...sets.values()];
}

const FACTS = new WeakMap<PickRow, RowFacts | null>();

/**
 * What a row is, for every rule that orders, groups or filters: its card's,
 * or its listing's (behind the NB set it joined, when it did). Null for a
 * row that says too little to walk: it goes in "Can't find it".
 */
export function rowFacts(row: PickRow): RowFacts | null {
  if (FACTS.has(row)) return FACTS.get(row) ?? null;
  const facts = factsOf(row);
  FACTS.set(row, facts);
  return facts;
}

function factsOf(row: PickRow): RowFacts | null {
  const c = row.card;
  if (c) {
    return {
      sportKey: c.set.sport.id,
      sportName: c.set.sport.name,
      year: c.set.year,
      setName: c.set.name,
      setRank: 0,
      setKey: c.set.id,
      setTitle: setLabel(c.set),
      sportCode: row.sportCode,
      role: variantRole(c),
      variantWord: null,
      variantName: variantName(c),
      cardNumber: c.cardNumber,
      players: c.players.map((p) => p.name).join(" / "),
    };
  }
  const listed = row.listed;
  const place = listed ? listedPlace(listed) : null;
  if (listed && !place) return titleFacts(listed);
  if (!listed || !place) return null;
  // Only the listing's own words: a role when its word is one, never a guess.
  const { word, name } = listedVariant(listed);
  const card = {
    role: listed.role ?? null,
    variantWord: word,
    variantName: name,
    cardNumber: place.cardNumber,
    players: listed.players?.trim() ?? "",
  };
  const joined = row.joined?.set;
  if (joined) {
    return {
      sportKey: joined.sport.id,
      sportName: joined.sport.name,
      year: joined.year,
      setName: joined.name,
      setRank: 0,
      setKey: joined.id,
      setTitle: setLabel(joined),
      sportCode: row.joined?.sportCode ?? null,
      ...card,
    };
  }
  const sportKey = listed.sportId ?? `sport:${fold(place.sportName)}`;
  return {
    sportKey,
    sportName: place.sportName,
    year: place.year,
    setName: place.setName,
    setRank: 1,
    setKey: `listed:${sportKey}|${place.year}|${fold(place.setName)}`,
    setTitle: place.setTitle,
    // NB's sport when the store resolved one, so its divider wears NB's colour, never the black "other".
    sportCode: listed.sportCode ?? row.sportCode,
    ...card,
  };
}

/**
 * NEO-590 — a card-less row whose listing says too little to file by but has
 * a title: its year and set words from the title. Its sport is the NB player
 * or team the title names (`titleSport`) only when the title parses (a leading
 * year); an unparsed title ("Kansas City Chiefs Hoodie XL") files under Other
 * whatever it names. Null with no title.
 */
function titleFacts(listed: ListedCard): RowFacts | null {
  const title = listed.title?.trim();
  if (!title) return null;
  const parsed = parseListingTitle(title);
  const sport = parsed.year !== null ? listed.titleSport : null;
  const sportKey = sport ? sport.id : TITLE_OTHER_SPORT;
  return {
    sportKey,
    sportName: sport ? sport.name : "Other",
    year: parsed.year,
    setName: parsed.setText,
    setRank: 1,
    setKey: `title:${sportKey}`,
    setTitle: TITLE_SET_TITLE,
    sportCode: sport ? sport.code : null,
    role: null,
    variantWord: null,
    variantName: null,
    cardNumber: parsed.cardNumber,
    players: "",
    fromTitle: true,
  };
}

/**
 * A row's facts as a card-shaped render needs them: null for a title row,
 * which draws its listing's title across the columns, with its problem line
 * and no card number, as it always has.
 */
export function cardFacts(row: PickRow): RowFacts | null {
  const facts = rowFacts(row);
  return facts && !facts.fromTitle ? facts : null;
}

/** What a row's variant tag says, and the divider colour it wears. */
export interface VariantTag {
  /** The variant's own name ("Wicked Power", "8 Bit Ballers Red"); "Base" on a base row. */
  text: string;
  /** The divider colour; null for a listing's word NB does not file by (a plain tag). */
  role: VariantRole | null;
  /** The kind, for assistive tech, when the name does not say it ("Insert"); null otherwise. */
  kind: string | null;
}

/**
 * NEO-522 — the tag between a row's picture and its number: the variant's
 * own name in its divider's colour, so "Wicked Power" and "N43" read apart
 * from a few feet. A name-less variant says its kind ("Insert"). A listing's
 * word NB does not file by ("Variation") joins its name once, as the title
 * does. Null when the row names no variant at all.
 */
export function variantTag(facts: RowFacts): VariantTag | null {
  const { role, variantWord: word, variantName: name } = facts;
  const phrase = word && name ? (containsWholeWords(name, word) ? name : `${word} ${name}`) : (word ?? name);
  const label = role ? VARIANT_ROLE_LABEL[role] : null;
  const text = phrase ?? label;
  if (!text) return null;
  return { text, role, kind: label && fold(label) !== fold(text) ? label : null };
}

/** Two rows show the same variant when their role, word and name agree. */
function variantKey(facts: RowFacts | null): string {
  return facts ? [facts.role ?? "", fold(facts.variantWord ?? ""), fold(facts.variantName ?? "")].join("|") : "";
}

/**
 * NEO-522 — where the variant changes inside a set's run: for each row, the
 * variant that starts on the next row when it differs from this one (the
 * heavier rule under this row wears the new variant's colour), else
 * undefined. `null` is a next variant of no role (a plain listing word).
 */
export function variantBreaks(rows: readonly PickRow[]): (VariantRole | null | undefined)[] {
  return rows.map((row, i) => {
    const next = rows[i + 1];
    if (!next) return undefined;
    const here = rowFacts(row);
    const there = rowFacts(next);
    if (!here || !there || variantKey(here) === variantKey(there)) return undefined;
    return there.role;
  });
}

/** A row is pulled once every line in it is. */
export function isPulled(row: PickRow, pulled: ReadonlySet<string>): boolean {
  return row.lines.every((l) => pulled.has(l.id));
}

export function lineIds(rows: readonly PickRow[]): string[] {
  return rows.flatMap((r) => r.lines.map((l) => l.id));
}

/** "eBay 12-3456". */
export function orderLabel(order: PickOrder): string {
  return `${order.venue} ${order.number}`;
}

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

/** The columns a seller can sort by. */
export type SortKey = "qty" | "number" | "player" | "set" | "condition" | "detail" | "order";
export type SortDir = "asc" | "desc";

export const SORT_KEYS: readonly SortKey[] = ["qty", "number", "player", "set", "condition", "detail", "order"];

function players(row: PickRow): string {
  return rowFacts(row)?.players ?? row.listingTitle;
}

/** Exact, code-unit order: a set key is an id, never folded, so two keys tie only when equal. */
function compareKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Newest year first; a row with no year last. */
function compareYears(a: number | null, b: number | null): number {
  if (a === null || b === null) return Number(a === null) - Number(b === null);
  return b - a;
}

/**
 * The default walking order (see the file comment). Each step compares one
 * fact of both rows, so the order is a plain lexicographic one: transitive
 * whatever mix of cards and listings it sorts.
 */
export function compareDefault(a: PickRow, b: PickRow): number {
  const fa = rowFacts(a);
  const fb = rowFacts(b);
  if (!fa || !fb) {
    if (fa || fb) return fa ? 1 : -1; // nothing to file by first: those are "Can't find it"
    return naturalCompare(orderLabel(a.orders[0]), orderLabel(b.orders[0])) || naturalCompare(a.key, b.key);
  }
  return (
    // Other (the title rows no sport was found for) walks last; then sport by name.
    Number(fa.sportKey === TITLE_OTHER_SPORT) - Number(fb.sportKey === TITLE_OTHER_SPORT) ||
    naturalCompare(fa.sportName, fb.sportName) ||
    // A sport's NB sets (and listings' own) come before the sales NB didn't list.
    Number(Boolean(fa.fromTitle)) - Number(Boolean(fb.fromTitle)) ||
    compareYears(fa.year, fb.year) ||
    naturalCompare(fa.setName, fb.setName) ||
    fa.setRank - fb.setRank ||
    compareKeys(fa.setKey, fb.setKey) ||
    roleRank(fa.role) - roleRank(fb.role) ||
    naturalCompare(fa.variantWord ?? "", fb.variantWord ?? "") ||
    naturalCompare(fa.variantName ?? "", fb.variantName ?? "") ||
    naturalCompare(fa.cardNumber, fb.cardNumber) ||
    naturalCompare(fa.players, fb.players) ||
    naturalCompare(a.condition, b.condition) ||
    naturalCompare(a.serial ?? "", b.serial ?? "") ||
    naturalCompare(a.key, b.key)
  );
}

/** Serial-numbered first by print run, then slabs by grader and grade, then the rest. */
function detailKey(row: PickRow): string {
  if (row.serial) return `0 ${row.serial}`;
  if (row.grade) return `1 ${row.grade.grader} ${row.grade.grade}`;
  return "2";
}

function columnCompare(key: SortKey, a: PickRow, b: PickRow): number {
  switch (key) {
    case "qty":
      return a.quantity - b.quantity;
    case "number":
      return naturalCompare(rowFacts(a)?.cardNumber ?? "", rowFacts(b)?.cardNumber ?? "");
    case "player":
      return naturalCompare(players(a), players(b));
    case "set":
      return compareDefault(a, b);
    case "condition":
      return naturalCompare(a.grade ? `${a.grade.grader} ${a.grade.grade}` : a.condition, b.grade ? `${b.grade.grader} ${b.grade.grade}` : b.condition);
    case "detail":
      return naturalCompare(detailKey(a), detailKey(b));
    case "order":
      return naturalCompare(orderLabel(a.orders[0]), orderLabel(b.orders[0]));
  }
}

/** Rows sorted by a column (ties fall back to the default order), or by default. */
export function sortRows(rows: readonly PickRow[], key: SortKey | null, dir: SortDir = "asc"): PickRow[] {
  const sign = dir === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => (key ? sign * columnCompare(key, a, b) || compareDefault(a, b) : compareDefault(a, b)));
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export interface PickFilters {
  /** Words to find in the number, player, set, variant, listing or order. */
  text?: string;
  /** A sport's key (`RowFacts.sportKey`: NB's id, or a listing's sport word). */
  sport?: string;
  /** A set year, as a string. */
  year?: string;
  variant?: VariantRole;
  condition?: string;
  /** An order's id. */
  order?: string;
  slabs?: boolean;
  numbered?: boolean;
  /** Only the sales NB has no card for (the "Not in NB" rows and Can't find it). */
  notInNb?: boolean;
}

export function hasFilters(f: PickFilters): boolean {
  return Boolean(f.text || f.sport || f.year || f.variant || f.condition || f.order || f.slabs || f.numbered || f.notInNb);
}

/** The chip a row NB has no card for wears (and a search finds it by). */
export const NOT_IN_NB = "Not in Neon Binder";

function haystack(row: PickRow): string {
  const facts = rowFacts(row);
  const parts = [row.listingTitle, row.condition, row.serial ?? "", ...row.orders.map(orderLabel)];
  if (facts) {
    if (facts.cardNumber) parts.push(`#${facts.cardNumber}`);
    parts.push(facts.cardNumber, facts.players, facts.setTitle, facts.variantWord ?? "", facts.variantName ?? "", facts.sportName);
  }
  if (!row.card) parts.push(NOT_IN_NB);
  if (row.grade) parts.push(row.grade.grader, row.grade.grade, row.grade.cert);
  return parts.join(" ").toLowerCase();
}

export function filterRows(rows: readonly PickRow[], f: PickFilters): PickRow[] {
  const words = (f.text ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter((row) => {
    const facts = rowFacts(row);
    if (f.sport && facts?.sportKey !== f.sport) return false;
    if (f.year && String(facts?.year ?? "") !== f.year) return false;
    if (f.variant && facts?.role !== f.variant) return false;
    if (f.condition && (row.grade ? "Graded" : row.condition) !== f.condition) return false;
    if (f.order && !row.orders.some((o) => o.id === f.order)) return false;
    if (f.slabs && !row.grade) return false;
    if (f.numbered && !row.serial) return false;
    if (f.notInNb && row.card) return false;
    if (words.length) {
      const text = haystack(row);
      if (!words.every((w) => text.includes(w))) return false;
    }
    return true;
  });
}

/** What the Condition filter offers for a row: a slab is "Graded". */
export function conditionOf(row: PickRow): string {
  return row.grade ? "Graded" : row.condition;
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

export type PickSection =
  | { kind: "cantFind"; key: string; rows: PickRow[] }
  | {
      kind: "set";
      key: string;
      sportName: string;
      sportCode: string | null;
      title: string;
      rows: PickRow[];
      /**
       * A listing's own divider whose title reads exactly like an NB set's on
       * the same list: its heading says it is not matched, so the two differ.
       */
      unmatchedTwin?: boolean;
    }
  | { kind: "order"; key: string; order: PickOrder; rows: PickRow[] }
  | { kind: "flat"; key: string; rows: PickRow[] }
  | { kind: "new"; key: string; rows: PickRow[] };

export interface SectionOptions {
  sort: SortKey | null;
  dir: SortDir;
  groupByOrder: boolean;
}

/**
 * The list as the seller walks it: "Can't find it" on top, then the rows
 * (one section per set in the default order, one per order when grouped by
 * order, or one flat run when sorted by a column), then anything that sold
 * after the pull began, at the bottom.
 *
 * Grouped by order, a row merged across two orders shows under each, with
 * that order's own lines only.
 */
export function buildSections(lines: readonly SaleLine[], filters: PickFilters, options: SectionOptions): PickSection[] {
  const sections: PickSection[] = [];
  if (options.groupByOrder) {
    const byOrder = new Map<string, { order: PickOrder; lines: SaleLine[] }>();
    for (const line of lines) {
      const entry = byOrder.get(line.order.id);
      if (entry) entry.lines.push(line);
      else byOrder.set(line.order.id, { order: line.order, lines: [line] });
    }
    const orders = [...byOrder.values()].sort((a, b) => naturalCompare(orderLabel(a.order), orderLabel(b.order)));
    const sets = setsOnList(lines);
    for (const { order, lines: own } of orders) {
      const rows = sortRows(filterRows(mergeLines(own, { sets }), filters), options.sort, options.dir);
      if (rows.length) sections.push({ kind: "order", key: `order:${order.id}`, order, rows });
    }
    return sections;
  }

  const all = filterRows(mergeLines(lines), filters);
  const cantFind = sortRows(all.filter((r) => !rowFacts(r)), null);
  const fresh = sortRows(all.filter((r) => rowFacts(r) && r.isNew), null);
  const rest = sortRows(all.filter((r) => rowFacts(r) && !r.isNew), options.sort, options.dir);

  if (cantFind.length) sections.push({ kind: "cantFind", key: "cantFind", rows: cantFind });
  if (options.sort === null || options.sort === "set") {
    sections.push(...setSections(rest));
  } else if (rest.length) {
    sections.push({ kind: "flat", key: "flat", rows: rest });
  }
  if (fresh.length) sections.push({ kind: "new", key: "new", rows: fresh });
  return sections;
}

/**
 * Rows already in walking order, cut into one section per set divider. A
 * listing's own divider titled exactly like an NB set's divider on the same
 * list is marked (`unmatchedTwin`) so its heading reads apart.
 */
export function setSections(rows: readonly PickRow[]): Extract<PickSection, { kind: "set" }>[] {
  const sections: Extract<PickSection, { kind: "set" }>[] = [];
  const own: boolean[] = [];
  for (const row of rows) {
    const facts = rowFacts(row);
    if (!facts) continue;
    const key = `set:${facts.setKey}`;
    const last = sections[sections.length - 1];
    if (last?.key === key) last.rows.push(row);
    else {
      sections.push({ kind: "set", key, sportName: facts.sportName, sportCode: facts.sportCode, title: facts.setTitle, rows: [row] });
      own.push(facts.setRank === 1);
    }
  }
  const nbTitles = new Set(sections.filter((_, i) => !own[i]).map((s) => fold(s.title)));
  return sections.map((s, i) => (own[i] && nbTitles.has(fold(s.title)) ? { ...s, unmatchedTwin: true } : s));
}

// ---------------------------------------------------------------------------
// By the Box
// ---------------------------------------------------------------------------

export interface BoxStop {
  box: PickBox;
  rows: PickRow[];
  /** The walk's last stop: the sales NB could not tie to a card and that say too little to file. */
  cantFind?: boolean;
  /**
   * The stop before it: sales NB has no card for but whose listings say what
   * they are. No box holds them; they walk by set, as on the list.
   */
  notInBox?: boolean;
  /** The stop after the boxes for cards whose box NB did not note (before Can't find it). */
  unrecorded?: boolean;
}

/** The `pbox` id of the Can't find it stop; never a box's own id. */
export const CANT_FIND_STOP = "cant-find";

/** The `pbox` id of the Not in a box stop; never a box's own id. */
export const NOT_IN_BOX_STOP = "not-in-box";

/** The `pbox` id of the Box not recorded stop; never a box's own id. */
export const BOX_NOT_RECORDED_STOP = "no-box";

/** The catch-all for a copy filed nowhere, when the store names none. */
export const UNSORTED_BOX: PickBox = { id: "unsorted", name: "Unsorted", unsorted: true };

/** Boxes in natural order by name (Box 2 before Box 10), Unsorted last. */
export function compareBoxes(a: PickBox, b: PickBox): number {
  if (Boolean(a.unsorted) !== Boolean(b.unsorted)) return a.unsorted ? 1 : -1;
  return naturalCompare(a.name, b.name) || naturalCompare(a.id, b.id);
}

/**
 * The walk through the boxes: every box that holds something to pull, in
 * box order, empty ones skipped. A line with no box (or a box the store
 * does not list) goes to Unsorted, unless NB never noted its box
 * (`boxUnrecorded`): those are left for the Box not recorded stop. Lines NB
 * could not match to a card are in no box and are left out (the list's
 * "Can't find it" has them).
 *
 * Inside a box: slot order when the box keeps slots (rows without one after,
 * in the default order), else the default order.
 */
export function boxWalk(lines: readonly SaleLine[], boxes: readonly PickBox[]): BoxStop[] {
  const known = new Map(boxes.map((b) => [b.id, b]));
  const unsorted = boxes.find((b) => b.unsorted) ?? UNSORTED_BOX;
  const byBox = new Map<string, SaleLine[]>();
  for (const line of lines) {
    if (!line.card) continue;
    const spotBox = line.spot && known.get(line.spot.boxId);
    if (!spotBox && line.boxUnrecorded) continue;
    const box = spotBox || unsorted;
    const list = byBox.get(box.id);
    if (list) list.push(line);
    else byBox.set(box.id, [line]);
  }
  const stops: BoxStop[] = [];
  for (const box of [...known.values(), ...(known.has(unsorted.id) ? [] : [unsorted])].sort(compareBoxes)) {
    const own = byBox.get(box.id);
    if (!own?.length) continue;
    stops.push({ box, rows: sortInBox(mergeLines(own, { bySpot: true })) });
  }
  return stops;
}

/**
 * The whole By the Box walk: the boxes in order, then a stop for the cards
 * whose box NB never noted, then Not in a box (sales NB has no card for, but
 * whose listings say what they are, in walking order by set), then one last
 * stop for the sales that say too little (the list's Can't find it), each
 * when there are any.
 */
export function boxStops(lines: readonly SaleLine[], boxes: readonly PickBox[]): BoxStop[] {
  const stops = boxWalk(lines, boxes);
  const known = new Set(boxes.map((b) => b.id));
  const loose = lines.filter((l) => l.card && l.boxUnrecorded && !(l.spot && known.has(l.spot.boxId)));
  if (loose.length) {
    stops.push({
      box: { id: BOX_NOT_RECORDED_STOP, name: "Box not recorded" },
      rows: sortRows(mergeLines(loose, { bySpot: true }), null),
      unrecorded: true,
    });
  }
  // No box holds a sale NB could not tie to a card. One whose listing says
  // what it is walks with its set; the rest wait at the very end.
  const lost = sortRows(mergeLines(lines.filter((l) => !l.card), { sets: setsOnList(lines) }), null);
  const described = lost.filter((r) => rowFacts(r));
  if (described.length) {
    stops.push({ box: { id: NOT_IN_BOX_STOP, name: "Not in a box" }, rows: described, notInBox: true });
  }
  const unreadable = lost.filter((r) => !rowFacts(r));
  if (unreadable.length) {
    stops.push({ box: { id: CANT_FIND_STOP, name: "Can't find it" }, rows: unreadable, cantFind: true });
  }
  return stops;
}

export function sortInBox(rows: readonly PickRow[]): PickRow[] {
  return [...rows].sort((a, b) => {
    const sa = a.spot?.slot;
    const sb = b.spot?.slot;
    if (sa !== undefined && sb !== undefined && sa !== sb) return sa - sb;
    if ((sa === undefined) !== (sb === undefined)) return sa === undefined ? 1 : -1;
    return compareDefault(a, b);
  });
}

/** Copies still to pull in these rows. */
export function copiesLeft(rows: readonly PickRow[], pulled: ReadonlySet<string>): number {
  let n = 0;
  for (const row of rows) for (const line of row.lines) if (!pulled.has(line.id)) n += line.quantity;
  return n;
}
