/**
 * NEO-645 — where the sources still disagree about a card's players or teams,
 * built from the wire card the commit receives.
 *
 * The commit used to refuse a card that still carried `playersConflict` or
 * `checklistConflict` (the wizard had to settle each one first). The per-card
 * Tidy Up walk settles them after the save, so the commit now STORES the
 * disagreement on the new row (`cardChecklist.sourceDisagreements`) and the
 * field holds nothing until a value is chosen:
 *
 *  - values that agree after the shared name matcher ("Judge / Soto" and
 *    "Judge | Soto", Acuña and Acuna) are ONE value and never stored;
 *  - every disagreement is stored unsettled and the card carries nothing for
 *    the field: NB never picks a side (the operator does, in the walk).
 *
 * Source keys are labels for the tile, never a rule (product invariant 4).
 * Pure: strings in, entries out.
 */

import { ConvexError, getConvexSize } from "convex/values";
import { MAX_CARD_PLAYERS, MAX_CARD_TEAMS } from "./cardAttention";
import { normalizeEntityName } from "../../lib/entities/normalize-name";

export type SourceKey = "bsc" | "sportlots" | "checklist";
export type DisagreementField = "players" | "teams";

export type DisagreementValue = { value: string[]; sources: SourceKey[] };
export type DisagreementEntry = {
  field: DisagreementField;
  values: DisagreementValue[];
  chosen?: { value: string[]; by: "operator"; typed?: true };
};

/** Values one field may hold, names one value may hold, bytes one card may keep. */
export const MAX_DISAGREEMENT_VALUES = 3;
export const MAX_DISAGREEMENT_NAME_LENGTH = 120;
export const SOURCE_DISAGREEMENTS_MAX_BYTES = 4096;

/** The wire card's conflict fields. */
export type DisagreementInput = {
  cardNumber: string;
  players?: string[];
  teams?: string[];
  team?: string;
  playersConflict?: { bsc: string[]; sportlots: string[] };
  checklistConflict?: {
    players?: { marketplace: string[]; checklist: string[] };
    teams?: { marketplace: string[]; checklist: string[] };
  };
};

function cleanNames(raw: ReadonlyArray<string>, cap: number, cardNumber: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of raw) {
    const name = entry.replace(/\s+/g, " ").trim();
    if (!name) continue;
    if (name.length > MAX_DISAGREEMENT_NAME_LENGTH) {
      throw new ConvexError(
        `Card #${cardNumber} carries a name over ${MAX_DISAGREEMENT_NAME_LENGTH} characters, so it wasn't saved.`,
      );
    }
    const key = normalizeEntityName(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  if (out.length > cap) {
    throw new ConvexError(`Card #${cardNumber} lists more than ${cap} names for one field, so it wasn't saved.`);
  }
  return out;
}

const keysOf = (names: ReadonlyArray<string>) => names.map((n) => normalizeEntityName(n));

export function sameNames(a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean {
  const ka = keysOf(a);
  const kb = keysOf(b);
  return ka.length === kb.length && ka.every((k, i) => k === kb[i]);
}

function addValue(
  values: DisagreementValue[],
  names: string[],
  sources: SourceKey[],
): void {
  const found = values.find((v) => sameNames(v.value, names));
  if (found) {
    for (const s of sources) if (!found.sources.includes(s)) found.sources.push(s);
    return;
  }
  values.push({ value: names, sources: [...sources] });
}

/**
 * The entries a wire card's conflicts make, unsettled. `marketplaceSources` are
 * the labels of the marketplace refs the card carries (for the side of a
 * checklist disagreement the marketplace printed). A field whose values all
 * agree after cleaning has no entry.
 */
export function buildDisagreements(
  card: DisagreementInput,
  marketplaceSources: ReadonlyArray<SourceKey>,
): DisagreementEntry[] {
  const out: DisagreementEntry[] = [];
  const playerValues: DisagreementValue[] = [];
  const pc = card.playersConflict;
  if (pc) {
    addValue(playerValues, cleanNames(pc.bsc, MAX_CARD_PLAYERS, card.cardNumber), ["bsc"]);
    addValue(playerValues, cleanNames(pc.sportlots, MAX_CARD_PLAYERS, card.cardNumber), ["sportlots"]);
  }
  const cp = card.checklistConflict?.players;
  if (cp) {
    addValue(playerValues, cleanNames(cp.marketplace, MAX_CARD_PLAYERS, card.cardNumber), [
      ...marketplaceSources,
    ]);
    addValue(playerValues, cleanNames(cp.checklist, MAX_CARD_PLAYERS, card.cardNumber), ["checklist"]);
  }
  if (playerValues.length > 1) out.push({ field: "players", values: playerValues });

  const teamValues: DisagreementValue[] = [];
  const ct = card.checklistConflict?.teams;
  if (ct) {
    addValue(teamValues, cleanNames(ct.marketplace, MAX_CARD_TEAMS, card.cardNumber), [
      ...marketplaceSources,
    ]);
    addValue(teamValues, cleanNames(ct.checklist, MAX_CARD_TEAMS, card.cardNumber), ["checklist"]);
  }
  if (teamValues.length > 1) out.push({ field: "teams", values: teamValues });

  for (const entry of out) {
    if (entry.values.length > MAX_DISAGREEMENT_VALUES) {
      throw new ConvexError(
        `Card #${card.cardNumber} has more than ${MAX_DISAGREEMENT_VALUES} different ${entry.field} lists, so it wasn't saved.`,
      );
    }
  }
  assertDisagreementsFit(out, card.cardNumber);
  return out;
}

/** Refuse, naming the card by NB's own number, when the entries would not fit on the row. */
export function assertDisagreementsFit(
  entries: ReadonlyArray<DisagreementEntry>,
  cardNumber: string,
): void {
  if (entries.length > 0 && getConvexSize([...entries] as never) > SOURCE_DISAGREEMENTS_MAX_BYTES) {
    throw new ConvexError(
      `Card #${cardNumber} has too much disagreement between its sources to keep on the card, so it wasn't saved.`,
    );
  }
}

/**
 * The names a card holds for `field`: nothing while a disagreement stands.
 * `held` says whether the field is in dispute at all.
 */
export function namesHeld(
  entries: ReadonlyArray<DisagreementEntry>,
  field: DisagreementField,
): { held: boolean; names: string[] } {
  const entry = entries.find((e) => e.field === field);
  if (!entry) return { held: false, names: [] };
  return { held: true, names: [] };
}
