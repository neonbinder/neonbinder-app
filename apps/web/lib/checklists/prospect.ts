/**
 * "Prospect" in an official checklist's team cell (NEO-591).
 *
 * Jason, 2026-11-17: a team cell that is exactly "Prospect" or "Prospect (X)"
 * sets the card's existing Prospect Card attribute (`features.isProspect =
 * "true"`, `convex/features/expectedFeatures.ts`). It is a claim about the
 * card, never a team name, so it never travels as one:
 *
 *  - Bare "Prospect" (or "Prospect (N/A)", "Prospect ()"): the card is a
 *    prospect and shows no team, the same claim "No Team" makes. The parsed
 *    row carries `prospect: true` and, when the row names no other team,
 *    `noTeam: true` with `teams: []`.
 *  - "Prospect (X)": X is the card's team and must be a minor-league or
 *    college team, never an MLB club. X leaves `teams` and travels as
 *    `prospectTeams: [X]` beside `prospect: true`, because the commit resolves
 *    a team string by name alone and cannot enforce the league level. The
 *    server settles X at fetch (`convex/lib/prospectTeam.ts`): exactly one
 *    qualifying team becomes the card's team, anything else is held for the
 *    operator and never written as a team string (product invariant 8).
 *
 * Only a WHOLE cell makes the claim, singular "Prospect" only, any case and
 * spacing. "Prospects", "Top Prospect", "Prospect Autos" and a cell that
 * carries plain text after the closing bracket ("Prospect (Frisco) Rookie")
 * are not claims and read as the team text they always did. Brackets may nest
 * inside X ("Prospect (Frisco RoughRiders (AA))"). X is the FIRST bracket;
 * brackets after it are notes and are dropped, as every other name or team
 * cell drops its notes ("Prospect (Oklahoma) (RC)" is a prospect of
 * Oklahoma).
 *
 * Pure: the client parser and the server's re-check
 * (`checkPublishedChecklist`) read the claim through this one function, so
 * the two can never disagree.
 */
import { isNoClaimTeamText, isNoTeamText } from "./no-team";

/** What a prospect cell says: `team` is X, or null for a bare "Prospect". */
export type ProspectCell = { team: string | null };

/**
 * How one X was settled at fetch: the full name of the one qualifying team
 * (the string the card carries, which the commit resolves to the same row),
 * or held for the operator. Asked of `applyChecklistRow`'s `resolveProspect`.
 */
export type ProspectResolution = { kind: "team"; name: string } | { kind: "held" };

const PROSPECT_HEAD = /^prospect(?=\s*\(|$)/i;

/** The index of the bracket that closes the one opened at `open`, or -1. */
function closingBracket(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

const NOTE_CLOSERS: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
const BRACKET_KINDS = "([{";
const CLOSER_KIND: Record<string, number> = { ")": 0, "]": 1, "}": 2 };

/**
 * For every opening bracket in `text`, the index of the one that closes it
 * (same kind, counting only that kind), else -1; every other index is -1. One
 * pass, so a caller asking about many brackets of one long text never
 * rescans it.
 */
export function matchBrackets(text: string): Int32Array {
  const match = new Int32Array(text.length).fill(-1);
  const open: number[][] = [[], [], []];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const kind = BRACKET_KINDS.indexOf(c);
    if (kind >= 0) open[kind].push(i);
    else if (c in CLOSER_KIND) {
      const opener = open[CLOSER_KIND[c]].pop();
      if (opener !== undefined) match[opener] = i;
    }
  }
  return match;
}

/**
 * The index just past a run of bracketed notes ("(RC) [SP]") starting at
 * `from` (spaces between them allowed): `from` itself when none starts there.
 * Pass `match` (`matchBrackets(text)`) when asking about the same text again.
 */
export function bracketedNotesEnd(text: string, from: number, match?: Int32Array): number {
  const matched = match ?? matchBrackets(text);
  let end = from;
  let at = from;
  for (;;) {
    while (at < text.length && /\s/.test(text[at])) at++;
    if (NOTE_CLOSERS[text[at]] === undefined) return end;
    const found = matched[at];
    if (found < 0) return end;
    end = found + 1;
    at = end;
  }
}

function onlyBracketedNotes(tail: string): boolean {
  return tail.trim() === "" || bracketedNotesEnd(tail, 0) >= tail.trimEnd().length;
}

/**
 * Read one WHOLE team cell. `null` when it is not a prospect cell; otherwise
 * `{ team }`, with X trimmed and `null` for the bare forms. X that says
 * nothing ("N/A", "None", a dash: `isNoClaimTeamText`) or "No Team" is the
 * bare form too, so a prospect cell never plants a team named "N/A".
 */
export function readProspectCell(cell: string): ProspectCell | null {
  const folded = cell.normalize("NFKC").replace(/\s+/g, " ").trim();
  const head = PROSPECT_HEAD.exec(folded);
  if (!head) return null;
  const rest = folded.slice(head[0].length).trim();
  if (rest === "") return { team: null };
  // `rest` starts with "(" (the lookahead above). X is the bracket it opens;
  // only bracketed notes may follow it, anything else is not a prospect cell.
  const close = closingBracket(rest, 0);
  if (close < 0 || !onlyBracketedNotes(rest.slice(close + 1))) return null;
  const inner = rest.slice(1, close).trim();
  if (inner === "" || isNoClaimTeamText(inner) || isNoTeamText(inner)) return { team: null };
  return { team: inner };
}

/** True when `cell` is a prospect cell, bare or with a team. */
export function isProspectText(cell: string): boolean {
  return readProspectCell(cell) !== null;
}
