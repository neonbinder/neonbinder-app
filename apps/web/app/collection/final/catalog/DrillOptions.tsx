import { printRunLabel } from "../data/labels";
import type { DrillItem } from "../data/types";
import { LOOSE_SETS_LABEL, splitBrandColumn } from "./drill";

/**
 * A drill column's rows as a native select's options. NEO-527 — majors
 * first: in the brand column the brands come first, then the sets listed in
 * place of the brand-unknown row under a "More sets" group. Every other
 * column has no such sets and lists as it always has. A parallel that has a
 * print run reads it after its name ("Gold Refractor /5").
 */
export function DrillOptions({ items }: { items: readonly DrillItem[] }) {
  const { main, more } = splitBrandColumn(items);
  // NEO-616 — a native option has no second line, so a row's print run reads
  // after the name ("Gold Refractor /5", "Gold Refractor 1/1"). Only the run
  // goes in, from its own field: a description never leaks into a select. A
  // row with no run is its bare name, exactly as before.
  const option = (i: DrillItem) => {
    const run = i.printRun === undefined ? null : printRunLabel({ printRun: i.printRun });
    return (
      <option key={i.id} value={i.id}>
        {run ? `${i.name} ${run}` : i.name}
      </option>
    );
  };
  return (
    <>
      {main.map(option)}
      {more.length > 0 && <optgroup label={LOOSE_SETS_LABEL}>{more.map(option)}</optgroup>}
    </>
  );
}
