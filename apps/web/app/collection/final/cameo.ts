import type { Card, SmartRule } from "./data/types";

/**
 * NEO-528 — a cameo: a card a smart binder takes in only because one of the
 * players its rule names is pictured on it, not its subject (the binder's
 * "Include cameos" option). The words the binder, list rows and Find cards
 * use for it, kept in one place so every surface reads the same.
 *
 * The collector never sees "secondary": it is a Cameo (tag), "Also on this
 * card" (card detail) and "Include cameos" (the rule's option).
 */

/**
 * Who makes the cameo on this card, as names. The pictured players the rule
 * names when any are (a Dan Marino binder on a Clayton card that also shows
 * Marino and Duper says Marino); otherwise every pictured player (a Hall of
 * Fame line names no one). Empty when the card's pictured players are not
 * known yet.
 */
export function cameoNames(card: Pick<Card, "secondaryPlayers">, rule?: SmartRule | null): string[] {
  const pictured = card.secondaryPlayers ?? [];
  const named = new Set<string>();
  for (const term of rule?.terms ?? []) {
    if (!term.negate && term.test.kind === "player") for (const id of term.test.playerIds) named.add(id);
  }
  const picked = pictured.filter((p) => named.has(p.id));
  return (picked.length > 0 ? picked : pictured).map((p) => p.name);
}

/** "Dan Marino", "Dan Marino and Mark Duper", "A, B and C". */
function listed(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * The cameo in one phrase, for an accessible name or a screen reader:
 * "Dan Marino is a cameo on this card", "Dan Marino and Mark Duper are
 * cameos on this card", or "a cameo card" while the names are unknown.
 */
export function cameoPhrase(names: readonly string[]): string {
  if (names.length === 0) return "a cameo card";
  return `${listed(names)} ${names.length === 1 ? "is a cameo" : "are cameos"} on this card`;
}

/** The rule's cameo option is on (`StoredRule.secondaryPlayers`). */
export function cameosOn(rule: SmartRule | null | undefined): boolean {
  return rule?.secondaryPlayers === true;
}
