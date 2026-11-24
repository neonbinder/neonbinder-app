/**
 * NEO-645 — "Printed on #1, #17": which cards print the same name.
 *
 * `tidyCards.cardContext` sends the first few card numbers and a count capped
 * at `CONTEXT_PRINTED_ON_COUNTED` (`more` says the count was capped). Null for
 * a name that is already answered, so an answered name says nothing.
 *
 * The open card's own number is left out of the "and N more" arithmetic only
 * by the server's own counting; the line lists every card that prints the name,
 * this one included, because that is what "printed on" means.
 */
export type PrintedOn = { cardNumbers: string[]; count: number; more: boolean };

export function printedOnText(printedOn: PrintedOn | null | undefined): string | null {
  if (!printedOn || printedOn.cardNumbers.length === 0) return null;
  const numbers = printedOn.cardNumbers.map((n) => `#${n}`).join(", ");
  const hidden = printedOn.count - printedOn.cardNumbers.length;
  if (hidden <= 0 && !printedOn.more) return `Printed on ${numbers}`;
  return `Printed on ${numbers} and ${Math.max(hidden, 1)}${printedOn.more ? "+" : ""} more`;
}
