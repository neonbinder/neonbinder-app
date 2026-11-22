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
 *  - when exactly one value has every one of its names already an NB row, NB
 *    picks it (`chosen.by = "nb"`), so the common case is never a question;
 *  - otherwise the field is left unsettled and the card carries nothing for it.
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
  chosen?: { value: string[]; by: "nb" | "operator"; typed?: true };
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
 * NB's own pick: exactly one non-empty value whose every name is already an NB
 * row (`isKnown` takes the normalised key). Two such values, or none, is a
 * question for the operator. A value naming nobody ("No team") is never picked
 * here.
 */
export function pickByNb(
  entry: DisagreementEntry,
  isKnown: (nameKey: string) => boolean,
): DisagreementEntry {
  const known = entry.values.filter(
    (v) => v.value.length > 0 && v.value.every((n) => isKnown(normalizeEntityName(n))),
  );
  if (known.length !== 1) return entry;
  return { ...entry, chosen: { value: known[0].value, by: "nb" } };
}

/** The names a card holds for `field`: the chosen value, or nothing while unsettled. */
export function namesHeld(
  entries: ReadonlyArray<DisagreementEntry>,
  field: DisagreementField,
): { held: boolean; names: string[] } {
  const entry = entries.find((e) => e.field === field);
  if (!entry) return { held: false, names: [] };
  return { held: true, names: entry.chosen ? entry.chosen.value : [] };
}

/**
 * NEO-645 (schema doc 4) — the names the review gate writes NO `tidyNames` row
 * for: a name that sits only on the sides of a disagreement nobody has
 * settled, or only on the side NB's own pick did not take. Nothing is looked
 * up for a side that may never be used; when the operator picks a side, the
 * walk creates the row then (`ensureTidyNameRow`).
 *
 * A name that is ALSO printed somewhere settled (a card with no disagreement
 * for that field, or the value NB picked) keeps its row. `heldElsewhere` are
 * the normalised names the caller found on settled places; `isKnown` is the
 * same test `pickByNb` uses at the commit, so the gate and the commit agree on
 * which entries are unsettled. Pure: normalised keys in, normalised keys out.
 */
export function namesOnlyOnUnsettledSides(input: {
  entries: ReadonlyArray<Pick<DisagreementEntry, "field" | "values">>;
  heldElsewhere: { players: ReadonlySet<string>; teams: ReadonlySet<string> };
  isKnown: { players: (nameKey: string) => boolean; teams: (nameKey: string) => boolean };
}): { players: Set<string>; teams: Set<string> } {
  const kept = {
    players: new Set(input.heldElsewhere.players),
    teams: new Set(input.heldElsewhere.teams),
  };
  const sides = { players: new Set<string>(), teams: new Set<string>() };
  for (const raw of input.entries) {
    const entry = pickByNb({ ...raw }, (key) => input.isKnown[raw.field](key));
    for (const value of entry.values) {
      const taken = entry.chosen !== undefined && entry.chosen.value === value.value;
      for (const name of value.value) {
        (taken ? kept : sides)[raw.field].add(normalizeEntityName(name));
      }
    }
  }
  for (const field of ["players", "teams"] as const) {
    for (const key of kept[field]) sides[field].delete(key);
  }
  return sides;
}
