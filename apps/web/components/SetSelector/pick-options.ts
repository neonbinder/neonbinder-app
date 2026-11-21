/**
 * NEO-591 — the pick-one pickers (a card's name, a card's number) speak one
 * language: a list of `{source, value}` options, however many sources the row
 * has. The pickers never ask which marketplace there is; a future marketplace
 * or a second checklist is one more entry in the list the adapter builds, and
 * no change to the picker.
 *
 * Pure: no React, no Convex.
 */

/** One source's answer. `own` marks the operator's own upload (a checklist). */
export type PickOption = {
  /** Who said it. Opaque to the picker; only the adapter that built it reads it. */
  source: string;
  value: string;
  /** The operator's own data, which the picker names as theirs. */
  own?: true;
  /**
   * A value the operator typed: case counts, so it is never folded into a
   * source's spelling ("mike" typed over "Mike" is a correction, not a pick).
   */
  exact?: true;
};

/** One pill: a distinct value and everyone who said it. */
export type PickChoice = {
  /** The first spelling seen. */
  value: string;
  sources: string[];
  /** Every source behind this value is the operator's own. */
  own: boolean;
};

/** The comparison key: trimmed, case-folded. */
export function pickKey(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * One pill per distinct value, in the order the sources were listed. Spellings
 * that differ only in case or outer spacing are one value, and the first
 * spelling is the one kept. A value the operator's checklist shares with a
 * marketplace is not "theirs": the marketplace said it too, so it stays bare.
 */
export function pickChoices(options: readonly PickOption[]): PickChoice[] {
  const out: PickChoice[] = [];
  const at = new Map<string, number>();
  for (const option of options) {
    const value = option.value.trim();
    if (!value) continue;
    const key = option.exact ? `\u0000${value}` : pickKey(value);
    // A typed value the sources already spell exactly so is theirs.
    const found = at.get(key) ?? (option.exact ? out.findIndex((c) => c.value === value) : -1);
    if (found === undefined || found === -1) {
      at.set(key, out.length);
      out.push({ value, sources: [option.source], own: option.own === true });
      continue;
    }
    const choice = out[found];
    choice.sources.push(option.source);
    if (option.own !== true) choice.own = false;
  }
  return out;
}

/**
 * The choice a name stands for: the one spelled exactly so, else the one that
 * folds to it.
 */
export function findChoice(
  choices: readonly PickChoice[],
  name: string | undefined,
): PickChoice | undefined {
  if (name === undefined) return undefined;
  const exact = name.trim();
  return (
    choices.find((c) => c.value === exact) ??
    choices.find((c) => pickKey(c.value) === pickKey(exact))
  );
}

/** The text after a value only the operator's checklist printed. */
export const YOUR_CHECKLIST = " · your checklist";

/**
 * The radiogroup's options for a list of choices. The pill is the value, and
 * only a value the operator's own checklist alone said carries the suffix; a
 * marketplace's pill stays bare. `format` prints the value (a number reads
 * "#12", "NNO").
 */
export function pickRadioOptions(
  choices: readonly PickChoice[],
  noun: string,
  scope: string,
  format: (value: string) => string = (value) => value,
): Array<{ side: string; label: string; ariaLabel: string }> {
  return choices.map((choice) => {
    const label = `${format(choice.value)}${choice.own ? YOUR_CHECKLIST : ""}`;
    return {
      side: choice.value,
      label,
      ariaLabel: `${label} — use this ${noun} for ${scope}`,
    };
  });
}
