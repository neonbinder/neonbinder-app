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
// NEO-591: the product's own parser, matcher and pairing core, so the facts below are what the
// fetch computes, never a second copy of its rules (a restated matcher went stale silently when
// the matcher became names-first).
import { parsePublishedChecklist, type PublishedChecklistRow } from "../../lib/checklists/parse-published-checklist";
import { matchPublishedChecklist, type ChecklistMatchResult } from "../../lib/checklists/match-published-checklist";
import { pairNamesFirst } from "../../lib/cards/pair-names-first";
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
   * out). No number is a BSC `FS-n` or a SportLots number, so every row pairs to its card by player name
   * (names first, NEO-591: digits against FS-n letters pair at the lower confidence) and FS-20 has no row.
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
  /** The same file with row 17 (Mike Lowell) left out: 13 rows against BSC's 14 cards, so Lowell's card has no row. */
  signatureSeries2026WithoutLowell: "2026-donruss-insert-retro-1997-donruss-signature-series-autographs-without-lowell",
  /**
   * The whole file with row 11 misspelled ("Rhett Lowdr"): the 13 exact names pair, and Rhett Lowder's card
   * pairs with the misspelled row by a near name, its score lowered because the numbers differ (NEO-591).
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
 * `paused` is for a SportLots-paused deployment (the run's sources are BSC and the file): each
 * entry agrees with the product's own matcher run over the file against BSC's cards (a capture IS
 * BSC's cards; a trimmed file is matched against its whole one), and every file a spec uploads as
 * is was confirmed on a run (SET-REGISTRY.md, "Published-checklist fixtures", lists the few that
 * are read off the file only).
 * `live` is what the set's SportLots side changes: a set with no SportLots id fetches the same two
 * sources live, so it equals `paused`; a set the seed maps to SportLots too (Topps Chrome 2024,
 * Stars of MLB Network) adds a third source, UNMEASURED since the pause, and is written `true`
 * (a guess that opens costs the first live run one red, a guess that skips would commit unseen).
 * A file nothing uploads whole (`...Full`) is read off the file. A spec's own edit to the rows
 * (appended, dropped, renumbered or split) always opens it, which `usePublishersChecklist` applies.
 * A repeated number blocks only the number pass (rule 7, D2): an exactly-one name still pairs.
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
  // PPR-CR and PPR-DU are each on two rows, so neither number pairs (rule 7, D2). PPR-CR's two
  // players still pair by name; PPR-DU's two rows are both Dan Uggla, a tie left to the operator.
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

/**
 * What a fixture file holds, read through the product's own parser and matcher so the spec never
 * restates a count (NEO-591: the matcher is names first, and a copy of its rules here went stale
 * the day it changed).
 */
export interface ChecklistFacts {
  /** The file's absolute path, for `setInputFiles` (an edited upload is built from it). */
  path: string;
  /** NEO-640: does a fetch with it open Match Cards (`opensMatchCards`)? */
  matchCards: MatchCardsFact;
  /** Data rows the dialog reads (`parsePublishedChecklist`): what its preview and the chip call "N rows". */
  rows: number;
  /** The cards the rows were matched against (the capture's own rows, unless `cardsOf` names another file). */
  cards: number;
  /** Cards a row pairs with, by any tier (name, number, near name, a shared stem): the "Matched (n)" of a one-marketplace fetch. */
  paired: number;
  /**
   * The cards whose team the rows answer: N in "Teams from your checklist: N of M cards"
   * (lib/checklists/checklist-teams-tally.ts). A paired card counts when its row names a team, says
   * "No Team" or makes a Prospect claim. Not counted: a card no row pairs (a tie, or no row), a
   * checklist-only row (not a card until kept), a row that makes no claim (blank, "None").
   * The cards here carry no team of their own (a bulk answer names none), so a team
   * disagreement with the marketplace is the caller's to subtract (the 2014 Topps Football
   * team-leader cards are the one registered set where it arises).
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

/**
 * Changes made to a captured file before it is uploaded, each keyed by a card number the file
 * prints on exactly one row (anything else throws, so a spec never uploads an unchanged file by
 * mistake). Applied in this order: team cells, renumbering, splitting, dropping.
 */
export interface ChecklistEdits {
  /** A row's team cell replaced: `No Team` (the publisher's claim, NEO-489) or `Prospect (X)` (NEO-591). */
  teamCells?: Readonly<Record<string, string>>;
  /** A row printed under another number ("9a" -> "9": a checklist listing only the stem). */
  renumber?: Readonly<Record<string, string>>;
  /**
   * A row printed as several (the publisher lists a variation the marketplace does not): each new row
   * keeps the player and team, takes its own number, and `note` follows the player in the player
   * cell ("(Photo Variation)", which the parser reads as the row's variation name).
   */
  split?: Readonly<Record<string, ReadonlyArray<{ number: string; note?: string }>>>;
  /** Rows left out (a variation the publisher does not list). */
  drop?: readonly string[];
  /**
   * Rows appended (NEO-574): rows the publisher lists that the marketplace has no card for (a spec's
   * own player on cards only the checklist names, kept in Match Cards). Throws when a row's number is
   * already in the file, so it can only ever ADD checklist-only rows. Applied after every other edit.
   */
  extraRows?: readonly ChecklistRow[];
}

/** One cell into CSV (quoted when it holds a comma, a quote or a newline). */
function csvCell(cell: string): string {
  return /[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

/** A captured file's text with `edits` applied (the file as it is when there are none). */
function editedCsv(name: ChecklistName, edits: ChecklistEdits = {}): string {
  const changed = changedCsv(name, edits);
  return edits.extraRows === undefined ? changed : withExtraRows(name, changed, edits.extraRows);
}

/** `editedCsv` without the appended rows: team cells, renumbering, splitting and dropping. */
function changedCsv(name: ChecklistName, edits: ChecklistEdits): string {
  const text = readFileSync(`${DIRECTORY}${name}.csv`, "utf8");
  const keys = [
    ...Object.keys(edits.teamCells ?? {}),
    ...Object.keys(edits.renumber ?? {}),
    ...Object.keys(edits.split ?? {}),
    ...(edits.drop ?? []),
  ];
  if (keys.length === 0) return text;
  const lines = text.split("\n").filter((l) => l.trim() !== "");
  const header = cells(lines[0]);
  const numberAt = header.indexOf("number");
  const playerAt = header.indexOf("player");
  const teamAt = header.indexOf("team");
  const seen = new Map<string, number>();
  const out: string[] = [lines[0]];
  for (const line of lines.slice(1)) {
    const row = cells(line);
    const number = row[numberAt];
    if (!keys.includes(number)) {
      out.push(line);
      continue;
    }
    seen.set(number, (seen.get(number) ?? 0) + 1);
    if (edits.teamCells?.[number] !== undefined) row[teamAt] = edits.teamCells[number];
    if (edits.renumber?.[number] !== undefined) row[numberAt] = edits.renumber[number];
    if (edits.drop?.includes(number)) continue;
    const parts = edits.split?.[number];
    if (parts === undefined) {
      out.push(row.map(csvCell).join(","));
      continue;
    }
    for (const part of parts) {
      const copy = [...row];
      copy[numberAt] = part.number;
      if (part.note !== undefined) copy[playerAt] = `${row[playerAt]} ${part.note}`;
      out.push(copy.map(csvCell).join(","));
    }
  }
  for (const number of new Set(keys)) {
    const n = seen.get(number) ?? 0;
    if (n !== 1) throw new Error(`${name}.csv has ${n} rows numbered "${number}": expected exactly one to change.`);
  }
  return `${out.join("\n")}\n`;
}

/** The rows the dialog reads from a CSV's text: the product's own parser, default options (as the upload). */
function parsedRows(text: string): PublishedChecklistRow[] {
  return parsePublishedChecklist(text).rows;
}

/** Does this row answer its card's team: a named team (a `Prospect (X)` cell's X is one) or "No Team" (`applyChecklistRow`'s `answered`). */
function answersTeam(row: PublishedChecklistRow): boolean {
  return row.teams.length > 0 || row.noTeam === true;
}

/**
 * The marketplace's cards a file is matched against. A capture IS BSC's own per-card answers, so by
 * default its rows are the cards (numbers and players; a bulk answer names no team). A publisher's
 * own file (Panini's Signature Series) is matched against the capture it numbers differently:
 * `cardsOf` names that file and `cardNumber` gives each of its rows the number BSC prints.
 */
export interface ChecklistCards {
  cardsOf?: ChecklistName;
  cardNumber?: (row: ChecklistRow) => string;
}

/** The product's match of a file's rows (as edited) against the cards, plus the rows it read. */
export function checklistMatch(
  name: ChecklistName,
  options: { edits?: ChecklistEdits } & ChecklistCards = {},
): { rows: PublishedChecklistRow[]; cards: ChecklistRow[]; match: ChecklistMatchResult } {
  const rows = parsedRows(editedCsv(name, options.edits));
  const cards = checklistRows(options.cardsOf ?? name).map((r) => ({
    ...r,
    number: options.cardNumber ? options.cardNumber(r) : r.number,
  }));
  const match = matchPublishedChecklist(
    cards.map((c) => ({
      cardNumber: c.number,
      players: c.player.split(";").map((p) => p.trim()).filter(Boolean),
    })),
    rows,
  );
  return { rows, cards, match };
}

/**
 * A file's facts (`ChecklistFacts`), as the fetch will compute them: the rows the dialog reads
 * (after `edits`), matched against the cards by `matchPublishedChecklist` itself.
 */
export function checklistFacts(
  name: ChecklistName,
  options: { edits?: ChecklistEdits } & ChecklistCards = {},
): ChecklistFacts {
  const { rows, cards, match } = checklistMatch(name, options);
  return {
    path: `${DIRECTORY}${name}.csv`,
    matchCards: MATCH_CARDS[name],
    rows: rows.length,
    cards: cards.length,
    paired: match.matches.length,
    matched: match.matches.filter((m) => !m.conflict?.teams && answersTeam(rows[m.rowIndex])).length,
  };
}

/**
 * NEO-591: one card and one row the product pairs by a NEAR name (the names-first core's third
 * tier), as the core scores them: `score` is the names' similarity, `confidence` what Match Cards
 * shows (the score, lowered when the numbers differ). Throws when the core does not pair them by
 * a near name, so a spec's fixture fails by name rather than asserting a percentage that never shows.
 */
export function nearNamePair(
  card: { number: string; player: string },
  row: { number: string; player: string },
): { score: number; confidence: number; numbersAgree: boolean } {
  const { pairs } = pairNamesFirst([{ names: [card.player], number: card.number }], [{ names: [row.player], number: row.number }], {
    stripLetterPrefix: true,
    stemSiblingSide: "right",
  });
  const pair = pairs[0];
  if (pair?.by !== "nearName" || pair.nameScore === undefined) {
    throw new Error(`"${card.player}" (#${card.number}) and "${row.player}" (#${row.number}) are not a near-name pair.`);
  }
  return { score: pair.nameScore, confidence: pair.confidence, numbersAgree: pair.numbersAgree };
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

/**
 * `text` (a captured file, perhaps edited) with `extra` rows appended. Throws when an extra row's
 * number is already in the file, so it can only ever ADD checklist-only rows.
 */
function withExtraRows(name: ChecklistName, text: string, extra: readonly ChecklistRow[]): string {
  const lines = text.split("\n").filter((l) => l.trim() !== "");
  const header = cells(lines[0]);
  const numberAt = header.indexOf("number");
  const taken = new Set(lines.slice(1).map((line) => cells(line)[numberAt]));
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
 * `edits` uploads the file changed (`ChecklistEdits`: team cells such as `No Team` or
 * `Prospect (X)`, a row renumbered, split or dropped), and the facts are the EDITED file's,
 * read through the product's parser and matcher. A card the marketplace already gives a team
 * and whose row disagrees is the operator's to settle, which the fetch does not count as
 * answered by the checklist (the caller subtracts each from `matched`).
 *
 * `edits.extraRows` (NEO-574) appends rows to the file. Each must carry a number the
 * marketplace does not list for the set (and the file does not hold): a checklist-only
 * row, so the facts' `rows` grow by them and `matched` does not (a checklist-only row is
 * not a card until it is kept in Match Cards). Once kept and saved, each is a card its
 * checklist row gives a team, so the line the save lands with counts them: N there is
 * `matched` plus the kept rows (measured NEO-574).
 */
export async function usePublishersChecklist(
  page: Page,
  name: ChecklistName,
  edits: ChecklistEdits = {},
): Promise<ChecklistFacts> {
  const captured = checklistFacts(name, { edits });
  // NEO-640: an edit to the rows themselves opens Match Cards: an appended row is "Checklist only",
  // a dropped one leaves its card without a row, and a renumbered or split one pairs by its stem
  // with a number for the operator to choose. A team cell changes no pair (the wizard settles it).
  const structural =
    (edits.extraRows?.length ?? 0) > 0 ||
    (edits.drop?.length ?? 0) > 0 ||
    Object.keys(edits.renumber ?? {}).length > 0 ||
    Object.keys(edits.split ?? {}).length > 0;
  const facts: ChecklistFacts = { ...captured, matchCards: structural ? opens(true) : captured.matchCards };
  // A second visit to the same open checklist (a discarded review fetched again)
  // may still hold the file the first visit used: the chip is then the proof.
  const chip = publishersChecklistChip(page, facts.rows);
  await expect(publishersChecklistButton(page).or(chip).first()).toBeVisible();
  if (await chip.isVisible()) return facts;
  await publishersChecklistButton(page).click();
  const dialog = publishersChecklistDialog(page);
  await expect(dialog).toBeVisible();
  const file = dialog.getByLabel("Choose a file");
  if (Object.keys(edits).length === 0) await file.setInputFiles(facts.path);
  else await file.setInputFiles({ name: `${name}.csv`, mimeType: "text/csv", buffer: Buffer.from(editedCsv(name, edits)) });
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
  const facts: ChecklistFacts = { path: "(pasted)", matchCards: opens(true), rows, cards: rows, paired: rows, matched: rows };
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
  return page.getByText(new RegExp(`^${escapeRe(matchedKeptSentence(cards))}`)).filter({ visible: true });
}

/** NEO-640: the kept sentence itself, as `matchedKeptLine` and the saved line carry it. */
export function matchedKeptSentence(cards: number): string {
  return cards === 1
    ? "Kept the 1 card. It matched across BSC and your checklist."
    : `Kept all ${cards} cards. Every card matched across BSC and your checklist.`;
}

/**
 * The line a save lands with, "Saved N cards." and whatever the run says after it (the kept
 * sentence on a skipped run, the teams line). Only its start is pinned: the sentences after it are
 * asserted one by one (`toContainText`). Contract: a locator, nothing waited for.
 */
export function savedLine(page: Page, cards: number): Locator {
  return page.getByText(new RegExp(`^Saved ${cards} cards?\\.`)).filter({ visible: true });
}

/**
 * NEO-640: a fetch whose every card paired with its own row at 100% skips Match Cards. The run
 * starts on the progress line (with its Cancel), and when the fetch ends the line goes with no
 * dialog standing. Where it lands is the caller's `lands`, which the fixture decides:
 *  - `"review"`: names (or teams, titles, a career check) are left to settle, so the tidy-up
 *    dialog opens, and the kept line ("Kept all N cards. Every card matched across BSC and your
 *    checklist.", N the file's rows: on a skip each row is exactly one card) stays in front of
 *    it with the teams line;
 *  - `"saved"`: nothing is left to ask, so the cards are saved at once, and the line the save
 *    lands with starts "Saved N cards." and says the kept sentence again (the kept line itself is
 *    on screen only for the write, so it is read off the saved line);
 *  - `"either"`: whichever of the two comes, read as above.
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
  const review = page.getByRole("dialog", { name: /^Tidy up / });
  const saved = savedLine(page, facts.rows);
  // Our own queueing once the fetch has landed (measured 1.3 s at most, #487): the standard 7 s.
  if (lands === "either") await expect(review.or(saved).first()).toBeVisible();
  if (lands === "review" || (lands === "either" && (await review.isVisible()))) {
    await expect(review).toBeVisible();
    await expect(matchedKeptLine(page, facts.rows)).toBeVisible();
  } else {
    await expect(saved).toBeVisible();
    await expect(saved).toContainText(matchedKeptSentence(facts.rows));
  }
  await expectTeamsFromChecklist(page, facts);
  // Paired with the landing just above (R2): the dialog never stood, and nobody confirmed one.
  await expect(matchCardsDialog(page)).toHaveCount(0);
}

/**
 * NEO-640: where a skipped Match Cards lands (`expectMatchCardsSkipped`). `"either"` is for a
 * spec that already accepts both (the catalogue decides whether a name is left to review); the
 * helper waits for one of them, then asserts the kept sentence where that one carries it.
 */
export type SkippedLanding = "review" | "saved" | "either";

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
