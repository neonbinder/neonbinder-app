/**
 * NEO-645 (Jason, 2026-11-23: "A name for the card should be required, even if
 * not a player. So it could be Team Card or Checklist or something else but
 * there should always be a name associated with the card.").
 *
 * `cardChecklist.cardName` is a required string, so "no name" is a name NB made
 * up when nothing printed one: `Card #<number>` (a checklist row that names no
 * one, a listing that came with no name). That placeholder is NB's own text,
 * never a marketplace value, and it is the only thing this module reads, so
 * the Tidy Up walk and the checklist reader agree on what "unnamed" means.
 *
 * Pure: strings in, string or boolean out, so the browser and the server both
 * import it.
 */

/** The name NB gives a card that nothing named: "Card #38", "Card #NNO". */
export function placeholderCardName(cardNumber: string): string {
  return `Card #${cardNumber.trim() || "NNO"}`;
}

/** `Card #` and one token, as `placeholderCardName` writes it (and the merges' own fallback). */
const PLACEHOLDER = /^card\s*#\s*\S*$/i;

/**
 * Whether a stored card name says anything: not blank and not the placeholder
 * above. A card whose name fails this and that has no player is unnamed.
 */
export function hasCardName(cardName: string | undefined): boolean {
  const name = (cardName ?? "").trim();
  return name !== "" && !PLACEHOLDER.test(name);
}

/**
 * A card being born with nobody on it (no player, none waiting to be resolved)
 * and no name of its own. The commit stamps `needsName` on it; a card already
 * stored is never stamped (Jason, 2026-11-23).
 */
export function bornNameless(
  playerIds: readonly unknown[] | undefined,
  pendingPlayerNames: readonly unknown[],
  cardName: string | undefined,
): boolean {
  return (playerIds?.length ?? 0) === 0 && pendingPlayerNames.length === 0 && !hasCardName(cardName ?? "");
}
