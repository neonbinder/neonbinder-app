/**
 * NEO-478 / NEO-482: the publisher's checklist, uploaded through the Set
 * Builder's "Add the official checklist" dialog before Sync card checklist.
 *
 * A checklist with a team beside each card means a fetch asks BuySportsCards
 * for nothing per card (D4): the specs that used to make one `card-listing` call
 * per card upload a CSV captured from BSC's OWN per-card answers instead
 * (`playwright/tools/capture-bsc-checklist-teams.mjs`, recorded in
 * SET-REGISTRY.md), so every assertion about a set's teams stays what it was.
 * The files are in `playwright/fixtures/checklists/`; `CHECKLISTS` names them.
 *
 * Everything here is located by what the dialog shows: the button "Add the
 * publisher's checklist", the dialog "Publisher's checklist" (textbox "Paste the
 * checklist", file input "Choose a file", "N rows", "Skipped lines", buttons "Use
 * this checklist" and "Cancel"), then the chip "Publisher's checklist: N rows".
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, type Locator, type Page } from "@playwright/test";
// The product's own rules for a team cell, so this file cannot drift from the parser (NEO-489).
import { isNoClaimTeamText, isNoTeamText } from "../../lib/checklists/no-team";
import { expectAfterMarketplace } from "./marketplace-wait";
import type { FlowEnv } from "./env";
import { columnSearch, drillToColdManufacturer, escapeRe, openAttributesPanel } from "./set-builder";

const DIRECTORY = fileURLToPath(new URL("../fixtures/checklists/", import.meta.url));

/** The captured files, by what they are. Each name is the file's, without `.csv`. */
export const CHECKLISTS = {
  /** Baseball 2024 Topps Stars of MLB Network Base: the default wizard fixture (10 cards, "No Team" on every row: the hosts and the show card have none). */
  starsOfMlbNetwork: "2024-topps-stars-of-mlb-network-base",
  /**
   * The same file with card 1's row (Lauren Shehadi) LEFT OUT: 9 rows, so exactly one card is asked
   * of BSC live, and BSC answers that it names no team (NEO-426's teamless-sport reader).
   */
  starsOfMlbNetworkShehadiLive: "2024-topps-stars-of-mlb-network-base-shehadi-live",
  /**
   * Baseball 2026 ONIT Athlete Arizona State Sun Devils Base, ALL 29 cards (`B-1`..`B-29`), every one
   * naming "Arizona State Sun Devils". No spec uploads it whole: it is the source of the copy below.
   */
  onitArizonaState2026Full: "2026-onit-athlete-arizona-state-sun-devils-base",
  /**
   * The ONIT Arizona State file with `B-1`'s row (Austin Musso) LEFT OUT: 28 rows, so exactly one card
   * is asked of BSC live, and its listing names the team (NEO-426: a listed team beats the default).
   */
  onitArizonaState2026OneLive: "2026-onit-athlete-arizona-state-sun-devils-base-one-live",
  tulsaOilers: "1995-hockey-tulsa-oilers-chl-base",
  memphisRiverKings: "1995-hockey-memphis-riverkings-chl-base",
  sanAntonioIguanas: "1995-hockey-san-antonio-iguanas-chl-base",
  fortWorthFire: "1995-hockey-fort-worth-fire-chl-base",
  oklahomaCityBlazers: "1995-hockey-oklahoma-city-blazers-chl-base",
  newHavenRavens: "1996-new-haven-ravens-rally-raffle-base",
  welcomeToTheClub: "2025-topps-welcome-to-the-club-3x-mvp-base",
  bbmRookieEditionPremium: "2024-bbm-rookie-edition-premium-base",
  /**
   * Baseball 2024 Topps Chrome Base, the seed's own fetch: 334 rows, card #300's row LEFT OUT
   * so exactly one card (#300) is still asked of BSC live (D8). Seed only.
   */
  toppsChrome2024Base: "2024-topps-chrome-base",
  teamBonus2010: "2010-topps-insert-team-bonus",
  /** Baseball 2010 Topps Insert Silk Collection: 201 cards, every one numbered `NNO`, so each pairs by player (exactly one card and one NNO row). */
  silkCollection2010: "2010-topps-insert-silk-collection",
  peakPerformance2010: "2010-topps-insert-peak-performance",
  peakPerformanceRelics2010: "2010-topps-insert-peak-performance-relics",
  turkeyRed2010: "2010-topps-insert-turkey-red",
  careerBestJumboJerseys2009: "2009-topps-insert-career-best-jumbo-jerseys",
  bowman2026Base: "2026-football-bowman-base",
  topps2014FootballBase: "2014-football-topps-base",
  /** Football 1984 Topps Base: 396 cards; the cameo smart-binder spec's set (card #355 Fred Dean, NEO-528). */
  topps1984FootballBase: "1984-football-topps-base",
  /**
   * Baseball 2011 Leaf Pete Rose Legacy Base: 75 cards (`1`, `2a`, `2b` ..), the commit-path
   * "Player on every card" spec's set (NEO-528). Ten cards name no person ("1975 World
   * Champions", "Former Teammates" ..); 11 rows say `No Team`, set by hand.
   */
  leafPeteRoseLegacy2011: "2011-leaf-pete-rose-legacy-base",
  /** Baseball 2026 Topps Insert Profiles: 25 cards (`TP-1`..`TP-25`), the commit-path cameo spec's set (NEO-528). */
  toppsProfiles2026: "2026-topps-insert-profiles",
  /** Baseball 2024 Topps Chrome Insert Future Stars: 20 cards (`FS-1`..`FS-20`), the setup's insert fetch. */
  futureStars2024: "2024-topps-chrome-insert-future-stars",
  /**
   * Future Stars as a publisher would number it: `101`..`119`, the same 19 players (FS-20 Brayan Rocchio left
   * out). No number is a BSC `FS-n` or a SportLots number, and 19 rows against 20 cards means the counts
   * differ, so every row pairs by player name and none is applied until the operator confirms.
   */
  futureStars2024PublisherNumbering: "2024-topps-chrome-insert-future-stars-publisher-numbering",
  /** Hockey 1995 Roanoke Express ECHL Base: 25 cards, every one `NNO`, so each pairs by player. */
  roanokeExpress1995: "1995-hockey-roanoke-express-echl-base",
  /**
   * The Roanoke file with Chris Pollack's row LEFT OUT: 24 rows, so exactly one card is asked of BSC
   * live per fetch. The one-marketplace spec uploads it; that card is the player it creates.
   */
  roanokeExpress1995OneLive: "1995-hockey-roanoke-express-echl-base-one-live",
  /** Baseball 2025 Bowman Draft Insert Bowman Draft Nights Autographs: 5 cards (`BDNA-EW`..), the autograph-format spec's set. */
  bowmanDraftNightsAutographs2025: "2025-bowman-draft-insert-bowman-draft-nights-autographs",
  /**
   * Baseball 2025 Bowman Draft Insert Prospect Dual Autographs: 14 cards (`PDA-AD`..), the dual-team spec's set,
   * with `PDA-WW`'s row LEFT OUT (13 rows): the one card whose two-club team value that spec reads live.
   */
  prospectDualAutographs2025: "2025-bowman-draft-insert-prospect-dual-autographs",
  /**
   * Baseball 2026 Bowman Insert Anime: all 36 rows read (a number column is trusted as printed, so
   * the `TBD` row is a number too and no card is asked of BSC); six of the cards are football players.
   */
  bowmanAnime2026: "2026-bowman-insert-anime",
  /**
   * Baseball 1996 Score Insert Dugout Collection Artist's Proofs Series 1 (NEO-535): all 110 cards,
   * numbers `1`..`110`, a team on every row. The inserts-1996-score spec's SportLots-paused branch
   * uploads it so BSC is asked for no card one by one.
   */
  dugoutArtistsProofs1996Series1: "1996-score-insert-dugout-collection-artists-proofs-series-1",
  /**
   * Hockey 1995 Halifax Mooseheads QMJHL Base, ALL 26 cards. No spec uploads it whole: it is the
   * source of the trimmed copy below (made from it with `--omit-number`).
   */
  halifaxMooseheads1995Full: "1995-hockey-halifax-mooseheads-qmjhl-base-full",
  /**
   * The Halifax file with cards 1, 2, 3, 24 and 25 left OUT: 21 rows. The NEO-487 stall spec uploads
   * it, so exactly five cards are asked of BSC live: #1-#3 are the stalled ids, #24 and #25 answer.
   */
  halifaxMooseheads1995FiveLive: "1995-hockey-halifax-mooseheads-qmjhl-base-five-live",
  /**
   * Baseball 2026 Donruss Insert Retro 1997 Donruss Signature Series Autographs (NEO-490): Panini's OWN
   * published checklist, 14 rows. Its numbers are the publisher's (1-8, 10, 11, 13, 14, 16, 17) and
   * BuySportsCards numbers the same 14 cards `SIG-AM`..`SIG-RL`, so no number meets another and every
   * row pairs by player. It is no capture of BSC's answers: BSC names a team on none of these cards.
   */
  signatureSeries2026: "2026-donruss-insert-retro-1997-donruss-signature-series-autographs",
  /** The same file with row 17 (Mike Lowell) left out: 13 rows against BSC's 14 cards, so the counts differ. */
  signatureSeries2026WithoutLowell: "2026-donruss-insert-retro-1997-donruss-signature-series-autographs-without-lowell",
  /**
   * The whole file with row 11 misspelled ("Rhett Lowdr"): 14 rows against 14 cards, so the counts match and
   * the server pairs the 13 unique names itself, but Rhett Lowder's card and the misspelled row are left for
   * the operator, so Match Cards opens for that one pair.
   */
  signatureSeries2026MisspelledLowder: "2026-donruss-insert-retro-1997-donruss-signature-series-autographs-misspelled-lowder",
} as const;

export type ChecklistName = (typeof CHECKLISTS)[keyof typeof CHECKLISTS];

/**
 * NEO-640 (Jason, 2026-11-21: "we should only skip this if Matched is all at 100%"): does a fetch
 * with this file, uploaded as is, open Match Cards? A run with two or more sources (BSC and the
 * file are two) skips the dialog only when every card pairs with exactly one row by its number
 * (or NNO card to NNO row by its player), no row is left over and no row names other players.
 *
 * `paused` is MEASURED on a SportLots-paused deployment (the run's sources are BSC and the file).
 * `live` is what the set's SportLots side changes: a set with no SportLots id fetches the same two
 * sources live, so it equals `paused`; a set the seed maps to SportLots too (Topps Chrome 2024,
 * Stars of MLB Network) adds a third source, UNMEASURED since the pause, and is written `true`
 * (a guess that opens costs the first live run one red, a guess that skips would commit unseen).
 * A file nothing uploads whole (`...Full`) is read off the file. A spec's own edit to a file
 * (`extraRows`: rows no card has) always opens it, which `usePublishersChecklist` applies.
 */
export interface MatchCardsFact {
  paused: boolean;
  live: boolean;
}
const opens = (paused: boolean, live = paused): MatchCardsFact => ({ paused, live });
const MATCH_CARDS: Record<ChecklistName, MatchCardsFact> = {
  // Every row is BSC's own card, by number; live, its SportLots base is mapped by the seed.
  "2024-topps-stars-of-mlb-network-base": opens(false, true),
  "2024-topps-stars-of-mlb-network-base-shehadi-live": opens(true),
  "2026-onit-athlete-arizona-state-sun-devils-base": opens(false),
  "2026-onit-athlete-arizona-state-sun-devils-base-one-live": opens(true),
  "1995-hockey-tulsa-oilers-chl-base": opens(false),
  "1995-hockey-memphis-riverkings-chl-base": opens(false),
  "1995-hockey-san-antonio-iguanas-chl-base": opens(false),
  "1995-hockey-fort-worth-fire-chl-base": opens(false),
  "1995-hockey-oklahoma-city-blazers-chl-base": opens(false),
  "1996-new-haven-ravens-rally-raffle-base": opens(false),
  "2025-topps-welcome-to-the-club-3x-mvp-base": opens(false),
  "2024-bbm-rookie-edition-premium-base": opens(false),
  // Card #300's row is left out, so #300 is a BSC-only card.
  "2024-topps-chrome-base": opens(true),
  "2010-topps-insert-team-bonus": opens(false),
  "2010-topps-insert-silk-collection": opens(false),
  "2010-topps-insert-peak-performance": opens(false),
  // PPR-CR and PPR-DU are each on two rows: a tie, left to the operator (rule 7, D2).
  "2010-topps-insert-peak-performance-relics": opens(true),
  "2010-topps-insert-turkey-red": opens(false),
  "2009-topps-insert-career-best-jumbo-jerseys": opens(false),
  "2026-football-bowman-base": opens(false),
  "2014-football-topps-base": opens(false),
  "1984-football-topps-base": opens(false),
  "2011-leaf-pete-rose-legacy-base": opens(true),
  "2026-topps-insert-profiles": opens(false),
  "2024-topps-chrome-insert-future-stars": opens(false, true),
  "2024-topps-chrome-insert-future-stars-publisher-numbering": opens(true),
  "1995-hockey-roanoke-express-echl-base": opens(false),
  "1995-hockey-roanoke-express-echl-base-one-live": opens(true),
  "2025-bowman-draft-insert-bowman-draft-nights-autographs": opens(false),
  "2025-bowman-draft-insert-prospect-dual-autographs": opens(true),
  "2026-bowman-insert-anime": opens(false),
  "1996-score-insert-dugout-collection-artists-proofs-series-1": opens(false),
  "1995-hockey-halifax-mooseheads-qmjhl-base-full": opens(false),
  "1995-hockey-halifax-mooseheads-qmjhl-base-five-live": opens(true),
  // The publisher's own numbers: every row pairs by player name, shown with a %.
  "2026-donruss-insert-retro-1997-donruss-signature-series-autographs": opens(true),
  "2026-donruss-insert-retro-1997-donruss-signature-series-autographs-without-lowell": opens(true),
  "2026-donruss-insert-retro-1997-donruss-signature-series-autographs-misspelled-lowder": opens(true),
};

/** NEO-640: does this fetch open Match Cards, on this run's SportLots switch? */
export function opensMatchCards(facts: Pick<ChecklistFacts, "matchCards">, env: Pick<FlowEnv, "SL_PAUSED">): boolean {
  return env.SL_PAUSED ? facts.matchCards.paused : facts.matchCards.live;
}

/** What a fixture file holds, read off the file itself so the spec never restates a count. */
export interface ChecklistFacts {
  /** The file's absolute path, for `setInputFiles`. */
  path: string;
  /** NEO-640: does a fetch with it open Match Cards (`opensMatchCards`)? */
  matchCards: MatchCardsFact;
  /** Data rows the dialog reads (a one-word number, or NNO; a row mixing "No Team" with a team is skipped): what its preview and the chip call "N rows". */
  rows: number;
  /**
   * The cards whose team the file answers: a card paired to exactly one row
   * that names a team or says "No Team". A number on two rows pairs nothing
   * (NEO-496 D2), so neither row counts. This is N in "Teams from your
   * checklist: N of M cards"; M is the marketplace's cards
   * (lib/checklists/checklist-teams-tally.ts).
   */
  matched: number;
}

/** One CSV line into cells (the captured files hold quoted cells, never a newline inside one). */
function cells(line: string): string[] {
  const out: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { out.push(cell); cell = ""; }
    else cell += ch;
  }
  out.push(cell);
  return out;
}

/** One captured row, as the file holds it ("; " already splits a cell with several names). */
export interface ChecklistRow {
  number: string;
  player: string;
  team: string;
}

/** The file's data rows, for a spec that builds its own paste from them. */
export function checklistRows(name: ChecklistName): ChecklistRow[] {
  const lines = readFileSync(`${DIRECTORY}${name}.csv`, "utf8").split("\n").filter((l) => l.trim() !== "");
  const [header, ...rows] = lines.map(cells);
  const at = (column: string) => header.indexOf(column);
  return rows.map((r) => ({ number: r[at("number")] ?? "", player: r[at("player")] ?? "", team: r[at("team")] ?? "" }));
}

/** A person's or club's name as the product compares two sides: accents, case, dots and spacing set aside. */
function nameKey(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[.'’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** The names of a "; "-joined cell, as one order-free key ("" when the cell names nobody). */
function namesKey(cell: string): string {
  return [...new Set(cell.split(";").map(nameKey).filter(Boolean))].sort().join("|");
}

/**
 * The names of a team cell ("; "-joined in the captured files). A whole cell that makes no
 * claim ("None", "N/A", "TBD", a dash, blank: `isNoClaimTeamText`) names nobody, exactly as
 * the parser reads it; "No Team" is a name here (the claim), kept apart by `isNoTeamText`.
 */
function teamNames(cell: string): string[] {
  if (cell.trim() === "" || isNoClaimTeamText(cell)) return [];
  return cell.split(";").map((n) => n.trim()).filter(Boolean);
}

// A number cell is read when it is one word of letters, digits, "." and "-" (any case; "1a",
// "PPR-DLa", "TBD"), with a leading "#" and a trailing "." or ":" set aside (NEO-489, D6), or
// is the unnumbered "NNO" (kept as a row; a card printed with no number is paired by player).
// Anything else is a skipped line.
const numberOf = (r: ChecklistRow) => r.number.trim().replace(/^#/, "").replace(/[.:]$/, "");
const isNnoRow = (r: ChecklistRow) => numberOf(r).toUpperCase() === "NNO";
const readable = (r: ChecklistRow) => /^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(numberOf(r)) || isNnoRow(r);
/** "No Team" beside a real team in one cell is a row the product skips (it cannot say both). */
const sayingBoth = (r: ChecklistRow) => {
  const names = teamNames(r.team);
  return names.some(isNoTeamText) && !names.every(isNoTeamText);
};
/** The rows the dialog reads: readable, and not saying both "No Team" and a team. */
const readRows = (name: ChecklistName) => checklistRows(name).filter(readable).filter((r) => !sayingBoth(r));
/**
 * A paired row answers its card's team when it names a team or says "No Team" (a card with no
 * team, the publisher's own claim). A BLANK cell, or one saying "None", "N/A", "TBD" or a dash,
 * makes no claim, so BSC is still asked for that card.
 */
const answersTeam = (r: ChecklistRow) => teamNames(r.team).length > 0;

export function checklistFacts(name: ChecklistName): ChecklistFacts {
  // A number is compared exactly as printed, case included; the product only pairs two numbers
  // that differ by case when each is on one card and one row, which a captured set has no row to
  // prove, so a file holding two such rows is refused here rather than guessed at.
  const rows = readRows(name);
  const numbered = rows.filter((r) => !isNnoRow(r));
  const unnumbered = rows.filter(isNnoRow);
  const countOf = new Map<string, number>();
  for (const r of numbered) countOf.set(numberOf(r), (countOf.get(numberOf(r)) ?? 0) + 1);
  const byCase = new Map<string, string>();
  for (const key of countOf.keys()) {
    const seen = byCase.get(key.toUpperCase());
    if (seen !== undefined && seen !== key) {
      throw new Error(`${name}.csv has the numbers "${seen}" and "${key}", which differ only by case: the product pairs those by a rule the file cannot restate (NEO-489, D7).`);
    }
    byCase.set(key.toUpperCase(), key);
  }
  const playerCountOf = new Map<string, number>();
  for (const r of unnumbered) playerCountOf.set(namesKey(r.player), (playerCountOf.get(namesKey(r.player)) ?? 0) + 1);
  // NEO-496 (D2, restored; lib/checklists/checklist-teams-tally.ts): N counts the CARDS whose team
  // came from the checklist. A number printed on two rows pairs with neither, and its card is asked
  // of the marketplace, so neither row counts; a checklist-only row is not a card until it is kept.
  // A numbered card is matched when its number is on exactly one row (rule 7). An unnumbered card
  // is matched by player, only when exactly one such card and exactly one NNO row name that player
  // (the captured set has one card per row, so the rows count for both sides). A matched card counts
  // here only when its row answers the team (`answersTeam`).
  // NEO-490: when no number pairs at all, the product pairs by player name instead; that is
  // `nameFallbackFacts`' reading, not this one, so a file that would reach it is refused here.
  if (numbered.length > 0 && !numbered.some((r) => countOf.get(numberOf(r)) === 1)) {
    throw new Error(`${name}.csv pairs no card by number, so the product pairs it by player name: read it with nameFallbackFacts (NEO-490).`);
  }
  const matchedNumbered = numbered.filter((r) => countOf.get(numberOf(r)) === 1 && answersTeam(r)).length;
  const matchedUnnumbered = unnumbered.filter((r) => {
    const key = namesKey(r.player);
    return key !== "" && playerCountOf.get(key) === 1 && answersTeam(r);
  }).length;
  return {
    path: `${DIRECTORY}${name}.csv`,
    matchCards: MATCH_CARDS[name],
    rows: rows.length,
    matched: matchedNumbered + matchedUnnumbered,
  };
}

/**
 * NEO-490: what a checklist whose numbers meet NO card's number answers, when each row is paired
 * to a card by player name instead. `cardsOf` is the file listing the set's cards (their players);
 * BSC's own list for the set is that file's rows, so the card side is read off a file, never typed.
 *
 * A name is paired when exactly one row and exactly one card carry it (the exactly-one guard; a
 * name two rows share pairs nothing). With EQUAL counts the unique pairs are applied by the fetch
 * (`matched` = those whose row answers the team, naming one or saying "No Team": N in "Teams from
 * your checklist: N of M cards"); with
 * DIFFERENT counts nothing is applied by the fetch (`matched` = 0) and the unique pairs are only
 * SUGGESTED (`suggested`) to the operator in the Match Cards dialog.
 */
export interface NameFallbackFacts extends ChecklistFacts {
  /** The cards the pairing is made against. */
  cards: number;
  /** Rows and cards of equal number: the fetch applies the unique pairs itself. */
  equalCounts: boolean;
  /** Unique name pairs: applied by an equal-count fetch, offered as suggestions otherwise. */
  suggested: number;
}

export function nameFallbackFacts(name: ChecklistName, cardsOf: ChecklistName): NameFallbackFacts {
  // The rows the dialog reads (the same reading as `checklistFacts`, NEO-489 case and No Team rules
  // included). Only NUMBERED rows and cards take part in the name pass: an NNO row pairs by player
  // with an NNO card in its own pass, and the counts compared are the numbered ones on each side.
  const all = readRows(name);
  const rows = all.filter((r) => !isNnoRow(r));
  const cards = readRows(cardsOf).filter((r) => !isNnoRow(r));
  const tally = (list: ChecklistRow[]) => {
    const counts = new Map<string, number>();
    for (const r of list) counts.set(namesKey(r.player), (counts.get(namesKey(r.player)) ?? 0) + 1);
    return counts;
  };
  const rowCounts = tally(rows);
  const cardCounts = tally(cards);
  const paired = rows.filter((r) => {
    const key = namesKey(r.player);
    return key !== "" && rowCounts.get(key) === 1 && cardCounts.get(key) === 1;
  });
  const equalCounts = rows.length === cards.length;
  return {
    path: `${DIRECTORY}${name}.csv`,
    matchCards: MATCH_CARDS[name],
    rows: all.length,
    cards: cards.length,
    equalCounts,
    suggested: paired.length,
    // A row saying "No Team" answers its card too (no team, never looked up); a no-claim cell
    // ("None", "N/A", blank) does not.
    matched: equalCounts ? paired.filter(answersTeam).length : 0,
  };
}

/** The button beside "Sync card checklist". Contract: a locator, nothing waited for. */
export function publishersChecklistButton(page: Page): Locator {
  return page.getByRole("button", { name: "Add the official checklist" });
}

/** The open dialog. Contract: a locator, nothing waited for. */
export function publishersChecklistDialog(page: Page): Locator {
  return page.getByRole("dialog", { name: "Official checklist" });
}

/**
 * The chip a used checklist leaves beside the Sync button: a button named
 * "Official checklist: N rows" (" · M skipped" follows when lines were), which
 * reopens the dialog. Contract: a locator, nothing waited for.
 */
export function publishersChecklistChip(page: Page, rows: number): Locator {
  return page.getByRole("button", { name: new RegExp(`^Official checklist: ${rows} ${rows === 1 ? "row" : "rows"}\\b`) });
}

/** The preview's count, "N rows" (a row, singular, when it is one). */
export function previewRowCount(dialog: Locator, rows: number): Locator {
  return dialog.getByText(new RegExp(`\\b${rows} ${rows === 1 ? "row" : "rows"}\\b`)).first();
}

/** One cell into CSV (quoted when it holds a comma, a quote or a newline). */
function csvCell(cell: string): string {
  return /[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

/**
 * A captured file with ONE card's team cell replaced by `No Team`: the publisher
 * saying the card shows no team (NEO-489). Throws when the file has no such number,
 * so a spec built on it fails by name rather than uploading an unchanged file.
 */
function csvWithNoTeamOn(name: ChecklistName, number: string): string {
  const lines = readFileSync(`${DIRECTORY}${name}.csv`, "utf8").split("\n").filter((l) => l.trim() !== "");
  const header = cells(lines[0]);
  const numberAt = header.indexOf("number");
  const teamAt = header.indexOf("team");
  let changed = 0;
  const out = lines.map((line, i) => {
    if (i === 0) return line;
    const row = cells(line);
    if (row[numberAt] !== number) return line;
    row[teamAt] = "No Team";
    changed++;
    return row.map(csvCell).join(",");
  });
  if (changed !== 1) throw new Error(`${name}.csv has ${changed} rows numbered "${number}": expected exactly one to say No Team on.`);
  return `${out.join("\n")}\n`;
}

/**
 * A captured file with `extra` rows appended: rows the publisher lists that the
 * marketplace has no card for (NEO-574: a spec's own player on cards only the
 * checklist names, kept in Match Cards). Throws when an extra row's number is
 * already in the file, so it can only ever ADD checklist-only rows.
 */
function csvWithExtraRows(name: ChecklistName, extra: readonly ChecklistRow[]): string {
  const lines = readFileSync(`${DIRECTORY}${name}.csv`, "utf8").split("\n").filter((l) => l.trim() !== "");
  const header = cells(lines[0]);
  const taken = new Set(checklistRows(name).map((r) => r.number));
  const out = [...lines];
  for (const row of extra) {
    if (taken.has(row.number)) throw new Error(`${name}.csv already has a row numbered "${row.number}": an extra row must be checklist-only.`);
    taken.add(row.number);
    out.push(header.map((column) => csvCell(row[column as keyof ChecklistRow] ?? "")).join(","));
  }
  return `${out.join("\n")}\n`;
}

/**
 * Upload a captured checklist and use it. Contract: ENTRY a checklist section
 * with "Add the official checklist" on screen (the set's Base or variant is
 * open). EXIT the dialog is closed and the chip "Official checklist: N rows"
 * is showing, N read off the file; nothing is fetched. Returns the file's facts
 * for the result line (`expectTeamsFromChecklist`).
 *
 * `noTeamOn` uploads the file with that one card's team cell changed to `No Team`
 * (the publisher's claim that the card shows no team). The facts are the unchanged
 * file's: the row is answered either way, but a card the marketplace already gives a
 * team is a disagreement the operator settles, which the fetch does not count as
 * answered by the checklist (the caller subtracts it from `matched`).
 *
 * `extraRows` (NEO-574) uploads the file with those rows appended. Each must carry
 * a number the marketplace does not list for the set (and the file does not hold):
 * a checklist-only row, so the facts' `rows` grow by them and `matched` does not
 * (a checklist-only row is not a card until it is kept in Match Cards). Once kept
 * and saved, each is a card its checklist row gives a team, so the line the save
 * lands with counts them: N there is `matched` plus the kept rows (measured NEO-574).
 */
export async function usePublishersChecklist(
  page: Page,
  name: ChecklistName,
  options: { noTeamOn?: string; extraRows?: readonly ChecklistRow[] } = {},
): Promise<ChecklistFacts> {
  if (options.noTeamOn !== undefined && options.extraRows !== undefined) {
    throw new Error("usePublishersChecklist: noTeamOn and extraRows are one change each; a spec needing both builds its own file.");
  }
  const captured = checklistFacts(name);
  const facts: ChecklistFacts = {
    ...captured,
    rows: captured.rows + (options.extraRows?.length ?? 0),
    // NEO-640: a row no card has is a "Checklist only" row, which only the operator can keep.
    matchCards: options.extraRows?.length ? opens(true) : captured.matchCards,
  };
  // A second visit to the same open checklist (a discarded review fetched again)
  // may still hold the file the first visit used: the chip is then the proof.
  const chip = publishersChecklistChip(page, facts.rows);
  await expect(publishersChecklistButton(page).or(chip).first()).toBeVisible();
  if (await chip.isVisible()) return facts;
  await publishersChecklistButton(page).click();
  const dialog = publishersChecklistDialog(page);
  await expect(dialog).toBeVisible();
  const file = dialog.getByLabel("Choose a file");
  if (options.noTeamOn !== undefined) {
    await file.setInputFiles({ name: `${name}.csv`, mimeType: "text/csv", buffer: Buffer.from(csvWithNoTeamOn(name, options.noTeamOn)) });
  } else if (options.extraRows !== undefined) {
    await file.setInputFiles({ name: `${name}.csv`, mimeType: "text/csv", buffer: Buffer.from(csvWithExtraRows(name, options.extraRows)) });
  } else {
    await file.setInputFiles(facts.path);
  }
  await expect(previewRowCount(dialog, facts.rows)).toBeVisible();
  await dialog.getByRole("button", { name: "Use this checklist" }).click();
  await expect(dialog).toBeHidden();
  await expect(publishersChecklistChip(page, facts.rows)).toBeVisible();
  return facts;
}

/**
 * NEO-556: a checklist a spec writes itself, pasted into the dialog's textbox, for a real set
 * no capture file exists for (the Leaf Vivid proofs: no capture tool run, so the file names only
 * the rows the spec is about; every other card is asked of BSC like any left-out row). `rows` is
 * the data rows pasted (the preview's count). Same contract as `usePublishersChecklist`: ENTRY a
 * checklist section with the button (or the chip) on screen; EXIT the dialog is closed and the
 * chip is showing, nothing fetched. A chip already showing the same row count is the proof of a
 * second visit.
 */
export async function usePastedChecklist(page: Page, csv: string, rows: number): Promise<ChecklistFacts> {
  const chip = publishersChecklistChip(page, rows);
  await expect(publishersChecklistButton(page).or(chip).first()).toBeVisible();
  // NEO-640: a pasted checklist names only the rows its spec is about, so every other card is a
  // BSC-only card and Match Cards opens.
  const facts: ChecklistFacts = { path: "(pasted)", matchCards: opens(true), rows, matched: rows };
  if (await chip.isVisible()) return facts;
  await publishersChecklistButton(page).click();
  const dialog = publishersChecklistDialog(page);
  await expect(dialog).toBeVisible();
  await dialog.getByRole("textbox", { name: "Paste the checklist" }).fill(csv);
  await expect(previewRowCount(dialog, rows)).toBeVisible();
  await dialog.getByRole("button", { name: "Use this checklist" }).click();
  await expect(dialog).toBeHidden();
  await expect(chip).toBeVisible();
  return facts;
}

/**
 * The Sync result line: "Teams from your checklist: N of M cards", appended to
 * the sync's message. N is `facts.matched`; M is the set's card count on the
 * marketplace (it can differ from the file's rows: a card the checklist never
 * listed has no row), so only N is pinned.
 *
 * NEO-496: when the fetch opens Match Cards (a checklist is a source, so a
 * one-marketplace leaf with one is two sources), the line is on the page while
 * the dialog is open; once Confirm hands the cards to the wizard it is said
 * again only on the line the save lands with. Assert it before Confirm
 * (`confirmChecklistMatchCards` does) or on the saved line.
 */
export async function expectTeamsFromChecklist(page: Page, facts: ChecklistFacts): Promise<void> {
  await expect(
    // N is read off the file; M is the set's card count on the marketplace, so it is not restated here.
    page.getByText(new RegExp(`Teams from your checklist: ${facts.matched} of [0-9]+ cards`)).first(),
  ).toBeVisible();
}

/** The Match Cards dialog (heading "Match Cards — <set>"). Contract: a locator, nothing waited for. */
export function matchCardsDialog(page: Page): Locator {
  return page.getByRole("dialog", { name: /^Match Cards/ });
}

/**
 * NEO-496 (D10, NQ1): a fetch with a publisher's checklist in play draws on two
 * sources even when the leaf carries one marketplace, so it opens Match Cards,
 * exactly as two marketplaces always did. The cards the checklist paired are in
 * the Matched list; a marketplace card no row paired waits in "BSC only (n)" /
 * "SportLots only (n)" and is DISCARDED at Confirm unless kept; a row no card
 * paired waits in "Checklist only (n)" and is dropped unless kept.
 *
 * This is the operator who wants every card the marketplace listed and nothing
 * the checklist alone adds: it keeps every marketplace single ("Keep all
 * BSC-only cards", and SportLots' when that column holds any), keeps no
 * checklist-only row, and confirms. With `keepChecklistOnly: n` (NEO-574) it
 * also keeps the checklist's own rows: the column must read "Checklist only
 * (n)" first, and every one of them is kept ("Keep all checklist-only cards"). A spec whose feature IS Match Cards drives
 * the dialog itself; this is for the specs that only pass through it.
 *
 * The fetch is a live BSC round trip, and Confirm unlocks only once this run's
 * teams have landed (a card the file leaves out is looked up live), so both
 * waits are 7 s of our own time plus the seconds the screen says it is waiting
 * on BSC (`expectAfterMarketplace`).
 *
 * Contract: ENTRY Sync card checklist has just been pressed with a checklist in
 * play (pasted, or the leaf's sections of the set's stored checklist). EXIT the
 * dialog was confirmed and is gone; the wizard (or the saved line) is the
 * caller's to wait for. With `facts`, the "Teams from your checklist: N of M
 * cards" line was asserted while the dialog was open (the only time before the
 * save that it is on the page).
 */
export async function confirmChecklistMatchCards(
  page: Page,
  { facts, what, keepChecklistOnly }: { facts?: ChecklistFacts; what: string; keepChecklistOnly?: number },
): Promise<void> {
  const dialog = matchCardsDialog(page);
  await expectAfterMarketplace(page, dialog, { platform: "BuySportsCards", what: `Match Cards after ${what}` });
  // "Loading…" (aria-disabled) until the batch has streamed in whole and its teams have landed.
  const confirm = dialog.getByRole("button", { name: "Confirm card matches", disabled: false });
  await expectAfterMarketplace(page, confirm, { platform: "BuySportsCards", what: `Confirm unlocked after ${what}` });
  if (facts !== undefined) await expectTeamsFromChecklist(page, facts);
  // Confirm is usable, so the dialog has settled: each side's single column is final.
  for (const side of ["BSC", "SportLots"] as const) {
    const singles = dialog.getByRole("heading", { name: new RegExp(`^${side} only \\([1-9][0-9]*\\)$`) });
    if (await singles.isVisible()) {
      await dialog.getByRole("button", { name: `Keep all ${side}-only cards` }).click();
      await expect(dialog.getByRole("heading", { name: `${side} only (0)` })).toBeVisible();
    }
  }
  if (keepChecklistOnly !== undefined) {
    await expect(dialog.getByRole("heading", { name: `Checklist only (${keepChecklistOnly})` })).toBeVisible();
    await dialog.getByRole("button", { name: "Keep all checklist-only cards" }).click();
    await expect(dialog.getByRole("heading", { name: "Checklist only (0)" })).toBeVisible();
  }
  await confirm.click();
  await expect(dialog).toBeHidden();
}

/**
 * NEO-640: the line every fetch with two or more sources starts on, a status naming them
 * ("Fetching from BSC and your checklist…", then "N of M cards ready."), with its Cancel
 * ("Cancel checklist fetch"). Contract: a locator, nothing waited for.
 */
export function checklistFetchProgress(page: Page): Locator {
  return page.getByRole("status").filter({ hasText: /^Fetching from BSC and your checklist…/ });
}

/**
 * NEO-640: the line a skipped Match Cards leaves, "Kept all N cards. Every card matched across BSC
 * and your checklist." ("Kept the 1 card. It matched across …" for one). A skip is only ever BSC and
 * the file (`MATCH_CARDS`: a set with a SportLots side is written to open live). The line goes on
 * with the paused sentence and the teams line, so only its start is pinned. Contract: a locator.
 */
export function matchedKeptLine(page: Page, cards: number): Locator {
  const text =
    cards === 1
      ? "Kept the 1 card. It matched across BSC and your checklist."
      : `Kept all ${cards} cards. Every card matched across BSC and your checklist.`;
  return page.getByText(new RegExp(`^${escapeRe(text)}`)).filter({ visible: true });
}

/**
 * NEO-640: a fetch whose every card paired with its own row at 100% skips Match Cards. The run
 * starts on the progress line (with its Cancel), and when the fetch ends the line goes with no
 * dialog standing. Where it lands is the caller's `lands`, which the fixture decides:
 *  - `"review"`: names (or teams, titles, a career check) are left to settle, so the tidy-up
 *    dialog opens, and the kept line ("Kept all N cards. Every card matched across BSC and your
 *    checklist.", N the file's rows: on a skip each row is exactly one card) stays in front of
 *    it with the teams line;
 *  - `"saved"`: nothing is left to ask, so the cards are saved at once and "Saved N cards." (with
 *    the teams line) replaces the kept line, which is then on screen for the length of the write
 *    only and is not asserted.
 *
 * Contract: ENTRY Sync card checklist has just been pressed with `facts`' file in play and
 * `opensMatchCards` false. EXIT the tidy-up dialog is open (`"review"`) or the saved line is up.
 */
export async function expectMatchCardsSkipped(
  page: Page,
  { facts, what, lands }: { facts: ChecklistFacts; what: string; lands: SkippedLanding },
): Promise<void> {
  const progress = checklistFetchProgress(page);
  await expect(progress, `the progress line of ${what}`).toBeVisible();
  // A sibling of the status line, not inside it: the run's one control.
  await expect(page.getByRole("button", { name: "Cancel checklist fetch" })).toBeVisible();
  // One live BSC round trip, under its own "Waiting on BuySportsCards" line (NEO-487).
  await expectAfterMarketplace(page, progress, { platform: "BuySportsCards", what: `the end of ${what}`, state: "hidden" });
  if (lands === "review") {
    // Our own queueing once the fetch has landed (measured 1.3 s at most, #487): the standard 7 s.
    await expect(page.getByRole("dialog", { name: /^Tidy up / })).toBeVisible();
    await expect(matchedKeptLine(page, facts.rows)).toBeVisible();
  } else {
    await expect(page.getByText(new RegExp(`^Saved ${facts.rows} cards\\.`)).filter({ visible: true })).toBeVisible();
  }
  await expectTeamsFromChecklist(page, facts);
  // Paired with the landing just above (R2): the dialog never stood, and nobody confirmed one.
  await expect(matchCardsDialog(page)).toHaveCount(0);
}

/** NEO-640: where a skipped Match Cards lands (`expectMatchCardsSkipped`). */
export type SkippedLanding = "review" | "saved";

/**
 * NEO-640: settle a fetch with a publisher's checklist in play, on the file's own measured fact
 * (`opensMatchCards`): through Match Cards (`confirmChecklistMatchCards`) when it opens, past it
 * (`expectMatchCardsSkipped`, landing as `lands` says) when every card matched. Never a race
 * between the two: a fixture that changes sides fails here by name. `keepChecklistOnly` needs rows
 * no card has, which always open the dialog.
 */
export async function settleChecklistFetch(
  page: Page,
  env: FlowEnv,
  {
    facts,
    what,
    keepChecklistOnly,
    lands,
  }: { facts: ChecklistFacts; what: string; keepChecklistOnly?: number; lands: SkippedLanding },
): Promise<void> {
  if (opensMatchCards(facts, env)) {
    await confirmChecklistMatchCards(page, { facts, what, keepChecklistOnly });
    return;
  }
  if (keepChecklistOnly !== undefined) {
    throw new Error(`settleChecklistFetch: ${what} keeps checklist-only rows, but its facts say Match Cards does not open.`);
  }
  await expectMatchCardsSkipped(page, { facts, what, lands });
}

/** The set panel's region, on the set level with its attributes open. Contract: a locator, nothing waited for. */
export function setChecklistPanel(page: Page): Locator {
  return page.getByRole("region", { name: "Official checklist" });
}

/**
 * NEO-496 — the `finally` of a sole-writer spec that stores a checklist on a SET filed under the
 * year's All Brands view, run only when the body went red with the checklist still saved: a fresh
 * drill back to the set, its attributes open, and the checklist removed through the UI, so the
 * next run starts with none. The body removes it itself on the green path.
 *
 * Contract: ENTRY anywhere signed in, the set holding a checklist. EXIT the set holds none.
 */
export async function removeSetChecklistUnderAllBrands(
  page: Page,
  env: FlowEnv,
  target: { year: string; set: string },
): Promise<void> {
  await drillToColdManufacturer(page, env, { sport: "Baseball", year: target.year, manufacturer: "All Brands" });
  await columnSearch(page, "Sets").fill(target.set);
  // NEO-527: the view reads each set's name, then the brand that files it ("Donruss Donruss"), and a
  // set named like its own brand is matched by every sibling's brand text, so pick by the option's
  // whole name: the set, then one word of brand.
  await page
    .getByRole("listbox", { name: "Sets" })
    .getByRole("option", { name: new RegExp(`^${escapeRe(target.set)} \\S+$`) })
    .click();
  await openAttributesPanel(page);
  const panel = setChecklistPanel(page);
  await panel.getByRole("button", { name: "Remove checklist" }).click();
  const confirm = page.getByRole("dialog", { name: "Remove this set's checklist?" });
  await confirm.getByRole("button", { name: "Yes, remove it" }).click();
  await expect(confirm).toBeHidden();
  await expect(panel.getByText(/^Got the official checklist\?/)).toBeVisible();
}
