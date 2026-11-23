/**
 * The server's re-check of publisher checklist rows, shared by every door that
 * takes them: a checklist pasted on one fetch (`selectorOptions.
 * fetchCardChecklist`), the operator's Match Cards links
 * (`publishedChecklistPairs`), each section of a stored checklist as it is
 * uploaded (NEO-496, `publishedChecklists.addSections`), and the stored rows
 * again as a fetch reads them. Moved here from `convex/selectorOptions.ts` in
 * NEO-496, unchanged; `selectorOptions.ts` re-exports every name.
 *
 * Pure: no database, so the stored rows and a paste are checked by the same
 * code. `noNumber` / `noTeam` are only ever emitted as `true`.
 */
import { ConvexError, v, type Infer } from "convex/values";
import { MAX_PLAYER_NAME_LENGTH } from "../../lib/players/name-limits";
import { rowHasNoNumber } from "../../lib/checklists/match-published-checklist";
import { isNoClaimTeamText, isNoTeamText } from "../../lib/checklists/no-team";
import { readProspectCell } from "../../lib/checklists/prospect";
import { mixedProspectClaim } from "../../lib/checklists/prospect-team-text";
import { MAX_VARIATION_NAME } from "../../lib/checklists/parse-published-checklist";
import { cleanseExternalName } from "../../lib/entities/cleanse-name";
import { normalizeEntityName } from "../../lib/entities/normalize-name";
import { MAX_CARD_PLAYERS, MAX_CARD_TEAMS } from "../features/cardAttention";
import type { publishedChecklistStoredRowValidator } from "../schema";

/**
 * PR 451 (NEO-478) — the most rows one re-check takes: a pasted checklist on
 * one fetch, or one stored section (NEO-496, `MAX_SECTION_ROWS` is the same
 * number).
 */
export const MAX_PUBLISHED_CHECKLIST_ROWS = 2000;

/**
 * One publisher-checklist row as it crosses the wire. NEO-490 — exported for
 * `publishedChecklistPairs.applyPublishedChecklistPairs`, which takes the rows
 * the operator linked in Match Cards in this same shape.
 */
export const publishedChecklistRowValidator = v.object({
  number: v.string(),
  players: v.array(v.string()),
  teams: v.array(v.string()),
  // PR 451 (D-B) — the publisher printed no number ("NNO"). The re-check
  // below sets it from the number too, so a row sent without the flag
  // reads the same; the matcher pairs such a row by player only.
  noNumber: v.optional(v.boolean()),
  // NEO-489 — the checklist says the card shows no team ("No Team");
  // `teams` is then empty. The re-check below also reads it from a team
  // string that is exactly "No Team", so a row sent either way reads the
  // same, and refuses a row that says No Team and names a team.
  noTeam: v.optional(v.boolean()),
  // NEO-591 — the team cell said "Prospect" / "Prospect (X)": the card is a
  // prospect, and X is its printed team (already in `teams`). The re-check
  // below also reads a prospect cell from a lone team string, so a row sent
  // either way reads the same.
  prospect: v.optional(v.boolean()),
  // NEO-591 — which of `teams` sat inside the Prospect parens (display only; see
  // `publishedChecklistStoredRowValidator`). The re-check keeps it only on a
  // Prospect row, only as a strict subset of `teams`, and within the team caps.
  prospectClaimedTeams: v.optional(v.array(v.string())),
  // NEO-591 (variations) — the checklist's note for a variation row ("photo
  // variation"). Control characters are stripped and a name over
  // `MAX_VARIATION_NAME` is refused by the re-check below.
  variationName: v.optional(v.string()),
  // NEO-645 — the subject of a row that names no person ("Checklist", "Team
  // Card"): the card's own name. Cleansed and bounded like a player name by the
  // re-check below; kept only on a row with no players.
  cardName: v.optional(v.string()),
  // The parser's subset label (a file's "set" / "insert" column). The
  // client chooses rows by it; the fetch never reads it and drops it in
  // `checkPublishedChecklist`. Accepted so a row is sent as parsed.
  subset: v.optional(v.string()),
});
export const publishedChecklistValidator = v.object({
  rows: v.array(publishedChecklistRowValidator),
});
export type PublishedChecklist = Infer<typeof publishedChecklistValidator>;
/** NEO-496 — what the re-check returns, and what a stored chunk holds. */
export type PublishedChecklistStoredRow = Infer<typeof publishedChecklistStoredRowValidator>;

/**
 * The most player or team strings one row may send, blanks included, before
 * any is trimmed or dropped. Generous next to a card's caps (20 players,
 * 8 teams) so a real row is never near it, but small enough that a row
 * padded with thousands of blank strings is refused before any is read.
 */
export const MAX_PUBLISHED_ROW_NAMES = 40;

/** The characters a publisher checklist's card number may hold. */
const PUBLISHED_CHECKLIST_NUMBER_CHARS = /^[#A-Za-z0-9. -]*$/;

/**
 * The server's re-check of a publisher checklist (the client's parser applies
 * the same limits): at most `MAX_PUBLISHED_CHECKLIST_ROWS` rows, every number,
 * player and team within the stored-name cap, players and teams within a
 * card's caps, and no row sending more than `MAX_PUBLISHED_ROW_NAMES` player
 * or team strings before blanks are dropped. Refused whole, never trimmed, and
 * named by row position only.
 * Strings are trimmed; empty names dropped. A row is a no-number row
 * (`noNumber: true`) when the client flagged it or its number is blank or
 * "NNO", by the matcher's own test (`rowHasNoNumber`), so the client's parse
 * and this re-check always agree on which rows pair by player.
 *
 * NEO-489: a row is a No Team row (`noTeam: true`, `teams: []`) when the
 * client flagged it or every team string is exactly "No Team"
 * (`isNoTeamText`, the parser's own test), so "No Team" never reaches the
 * fetch as a team name. A row that says No Team and also names a team
 * contradicts itself and refuses the whole checklist. A team string that
 * says nothing ("None", "N/A", a dash, "TBD": `isNoClaimTeamText`,
 * the parser's own list) as the row's only team is dropped, the same as a
 * blank cell, so a caller cannot plant a team named "None". Beside another
 * team it is kept as sent, exactly as the parser keeps it.
 *
 * NEO-591: a row is a Prospect row (`prospect: true`) when the client flagged
 * it or any of its team strings is a whole prospect cell (`readProspectCell`,
 * read string by string; the other strings stay teams). Each X is the card's
 * printed team: it joins `teams` after the others, deduped, within a card's
 * team cap. A bare Prospect (no X, no other team) is a No Team row
 * (`noTeam: true`); a No Team row that names an X contradicts itself and
 * refuses the whole checklist. `prospectClaimedTeams` (display only) is kept
 * only on a Prospect row, only when some but not all of `teams` were inside
 * the parens, and never names a team the row does not (`mixedProspectClaim`).
 */
export function checkPublishedChecklist(
  published: PublishedChecklist | undefined,
  options: { label?: string } = {},
): { rows: PublishedChecklistStoredRow[] } | undefined {
  if (!published) return undefined;
  // NEO-496: a stored section names itself ("section “Future Stars”"); a
  // pasted checklist reads as it always has.
  const label = options.label ?? "the official checklist";
  const whole = label.charAt(0).toUpperCase() + label.slice(1);
  if (published.rows.length > MAX_PUBLISHED_CHECKLIST_ROWS) {
    throw new ConvexError(
      `${whole} has ${published.rows.length} rows; the limit is ${MAX_PUBLISHED_CHECKLIST_ROWS}.`,
    );
  }
  const rows = published.rows.map((row, index): PublishedChecklistStoredRow => {
    const where = `Row ${index + 1} of ${label}`;
    const number = row.number.trim();
    if (number.length > MAX_PLAYER_NAME_LENGTH) {
      throw new ConvexError(`${where} has a card number over ${MAX_PLAYER_NAME_LENGTH} characters.`);
    }
    // Defence in depth (NEO-489 security audit): the client parser only ever
    // sends letters, digits, ".", "-" (and "NNO"); "#" and spaces are what a
    // hand-written number may still carry. Anything else is refused.
    if (!PUBLISHED_CHECKLIST_NUMBER_CHARS.test(number)) {
      throw new ConvexError(`${where} has a card number with characters a card number never has.`);
    }
    // The subset is dropped below, but it still crossed the wire: held to the
    // same cap as a name, so an unread field cannot carry an unbounded string.
    if (row.subset !== undefined && row.subset.trim().length > MAX_PLAYER_NAME_LENGTH) {
      throw new ConvexError(`${where} has a set name over ${MAX_PLAYER_NAME_LENGTH} characters.`);
    }
    // NEO-591 — the variation note: control, bidi and zero-width format
    // characters out (a name never carries one; the set is the parser's own:
    // U+061C, U+200B-200F, U+2028/2029, U+202A-202E, U+2066-2069, U+FEFF), whitespace
    // folded, its own bound (not a player's).
    const variationName = cleanseExternalName(
      cleanseExternalName(row.variationName ?? "").replace(
        /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/g,
        " ",
      ),
    );
    if (variationName.length > MAX_VARIATION_NAME) {
      throw new ConvexError(
        `${where} has a variation name over ${MAX_VARIATION_NAME} characters.`,
      );
    }
    // NEO-645 — the card's own name, for a row with no player. Cleansed as a
    // name is (the parser already did; this is the backstop) and held to a
    // name's bound.
    const cardName = cleanseExternalName(row.cardName ?? "");
    if (cardName.length > MAX_PLAYER_NAME_LENGTH) {
      throw new ConvexError(`${where} has a card name over ${MAX_PLAYER_NAME_LENGTH} characters.`);
    }
    const clean = (names: string[], max: number, unit: string) => {
      if (names.length > MAX_PUBLISHED_ROW_NAMES) {
        throw new ConvexError(
          `${where} sends ${names.length} ${unit} names; the limit is ${MAX_PUBLISHED_ROW_NAMES}.`,
        );
      }
      // NEO-643: the server-side backstop for the client's cleansing. A name is
      // stored the way `cleanseExternalName` writes it, whatever the caller sent.
      const kept = names.map((n) => cleanseExternalName(n)).filter(Boolean);
      if (kept.length > max) {
        throw new ConvexError(`${where} names ${kept.length} ${unit}s; the limit is ${max}.`);
      }
      for (const n of kept) {
        if (n.length > MAX_PLAYER_NAME_LENGTH) {
          throw new ConvexError(
            `${where} has a ${unit} name over ${MAX_PLAYER_NAME_LENGTH} characters.`,
          );
        }
      }
      return kept;
    };
    // A no-claim word is dropped only as the whole cell (one string), as the
    // parser reads it; beside a team it is left as it is, like the client.
    const cleaned = clean(row.teams, MAX_CARD_TEAMS, "team");
    // NEO-591 — each team string is read on its own: a string that is a whole
    // prospect cell (`readProspectCell`) is the claim, any other stays a team,
    // so ["Mets", "Prospect (Oklahoma)"] reads as the parser reads a cell
    // "Mets / Prospect (Oklahoma)": Mets and Oklahoma. The parser's own row
    // carries the claim as a flag and leaves no such string.
    const prospectCells = cleaned.map((team) => readProspectCell(team));
    const cellTeams = cleaned.filter((_, i) => prospectCells[i] === null);
    const claimedX = prospectCells
      .flatMap((cell) => (cell?.team ? [cell.team] : []))
      .filter((x) => !isNoClaimTeamText(x) && !isNoTeamText(x));
    const prospect = row.prospect === true || prospectCells.some((cell) => cell !== null);
    const named = cellTeams.length === 1 && isNoClaimTeamText(cellTeams[0]) ? [] : cellTeams;
    const plainTeams = named.filter((t) => !isNoTeamText(t));
    // Each X joins the other teams, deduped as a card's teams are (the same
    // folded key), in sent order.
    const seen = new Set(plainTeams.map((t) => normalizeEntityName(t)));
    const teams = [...plainTeams];
    for (const x of claimedX) {
      const key = normalizeEntityName(x);
      if (seen.has(key)) continue;
      seen.add(key);
      teams.push(x);
    }
    if (teams.length > MAX_CARD_TEAMS) {
      throw new ConvexError(
        `${where} names ${teams.length} teams; the limit is ${MAX_CARD_TEAMS}.`,
      );
    }
    // Display only: the teams inside the Prospect parens, when only some were.
    // The X of each prospect cell sent as a string, plus the list the client
    // sent (held to the same caps as teams), narrowed to `teams` by
    // `mixedProspectClaim`; a row that is not a Prospect row keeps none.
    const sentClaimed = clean(row.prospectClaimedTeams ?? [], MAX_CARD_TEAMS, "prospect team");
    // A row that says nothing about it (the client sent no list and no cell
    // string was a prospect cell) keeps none: every team was inside.
    const claimKnown = row.prospectClaimedTeams !== undefined || prospectCells.some((cell) => cell !== null);
    const prospectClaimedTeams =
      prospect && claimKnown ? mixedProspectClaim(teams, [...claimedX, ...sentClaimed]) : undefined;
    // A bare "Prospect" is the No Team claim, unless the row names a team.
    const bareProspect = prospect && teams.length === 0;
    const noTeam = row.noTeam === true || plainTeams.length < named.length || bareProspect;
    if (noTeam && teams.length > 0) {
      throw new ConvexError(`${where} says No Team and names a team.`);
    }
    const players = clean(row.players, MAX_CARD_PLAYERS, "player");
    return {
      number,
      players,
      teams,
      // A card with a player is named for the player; the subject stands in
      // only where there is none.
      ...(cardName && players.length === 0 ? { cardName } : {}),
      ...(rowHasNoNumber({ number, noNumber: row.noNumber }) ? { noNumber: true } : {}),
      ...(noTeam ? { noTeam: true } : {}),
      ...(prospect ? { prospect: true } : {}),
      ...(prospectClaimedTeams ? { prospectClaimedTeams } : {}),
      ...(variationName ? { variationName } : {}),
    };
  });
  return { rows };
}
