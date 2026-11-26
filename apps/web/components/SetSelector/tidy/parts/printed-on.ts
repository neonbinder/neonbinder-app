import { normalizeEntityName } from "@/lib/entities/normalize-name";
import type { TidyRow } from "../tile-types";

/**
 * NEO-645 — "Printed on #1, #17": which cards print the same name.
 *
 * NEO-656: counted from the checklist's cards the walk already holds, this
 * leaf only (a card names the players and teams still waiting on it in
 * `pendingPlayerNames` / `pendingTeamNames`). `more` is never set: the count is
 * exact. Null for a name that is already answered, so an answered name says
 * nothing.
 */
export type PrintedOn = { cardNumbers: string[]; count: number; more: boolean };

/** The first few card numbers the line lists; the rest read "and N more". */
const PRINTED_ON_SHOWN = 8;

/** The cards of this checklist still waiting on `name`, as the kind of name it is. */
export function cardsWaitingOn(
  leafCards: readonly TidyRow[],
  kind: "player" | "team",
  name: string,
): TidyRow[] {
  const key = normalizeEntityName(name.trim());
  if (!key) return [];
  return leafCards.filter((card) =>
    ((kind === "player" ? card.pendingPlayerNames : card.pendingTeamNames) ?? []).some(
      (pending) => normalizeEntityName(pending.trim()) === key,
    ),
  );
}

export function printedOnOf(
  leafCards: readonly TidyRow[],
  kind: "player" | "team",
  name: string,
): PrintedOn | null {
  const waiting = cardsWaitingOn(leafCards, kind, name);
  if (waiting.length === 0) return null;
  return {
    cardNumbers: waiting.slice(0, PRINTED_ON_SHOWN).map((c) => c.cardNumber),
    count: waiting.length,
    more: false,
  };
}

export function printedOnText(printedOn: PrintedOn | null | undefined): string | null {
  if (!printedOn || printedOn.cardNumbers.length === 0) return null;
  const numbers = printedOn.cardNumbers.map((n) => `#${n}`).join(", ");
  const hidden = printedOn.count - printedOn.cardNumbers.length;
  if (hidden <= 0 && !printedOn.more) return `Printed on ${numbers}`;
  return `Printed on ${numbers} and ${Math.max(hidden, 1)}${printedOn.more ? "+" : ""} more`;
}
