import { foldNameForCompare } from "../entities/normalize-name";

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
 * Words of a name as a comparison reads them: folded (accents, case, dashes),
 * punctuation and the joiners between names ("/", "&", "and") dropped.
 */
function nameWords(text: string): string[] {
  return foldNameForCompare(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w !== "" && w !== "and");
}

function hasRun(words: readonly string[], phrase: readonly string[]): boolean {
  if (phrase.length === 0) return false;
  for (let i = 0; i + phrase.length <= words.length; i += 1) {
    if (phrase.every((w, j) => words[i + j] === w)) return true;
  }
  return false;
}

/**
 * NEO-645 (Jason, 2026-11-23: "Whatever name we put on a card should always
 * show up, whether that is checklist, Team Card, Boston Red Sox or just cool
 * card. If there is a name we include it in title.") — the name the title
 * carries for a card, or undefined when it has none to add:
 *
 *  - NB's placeholder and a blank are no name (`hasCardName`);
 *  - a name that adds nothing the title says anyway is left out: one made
 *    only of the people's own words (the players', the printed spellings of
 *    them, the cameos'), or one that already contains every player (or every
 *    printed name). On a normal player card the stored name IS the player's
 *    own printed name, so its title does not move.
 *
 * Pure, and the one place the question is answered: the stored-card reader,
 * the born row and the generator all call it.
 */
export function cardSubjectName(input: {
  cardName: string | undefined;
  playerNames?: readonly string[];
  /** The players' names as the card printed them (`playerLinks.nameOnCard`). */
  printedPlayerNames?: readonly string[];
  cameoNames?: readonly string[];
}): string | undefined {
  const name = (input.cardName ?? "").trim();
  if (!hasCardName(name)) return undefined;
  const words = nameWords(name);
  if (words.length === 0) return undefined;
  const clean = (list: readonly string[] | undefined) =>
    (list ?? []).map((n) => n.trim()).filter(Boolean);
  const players = clean(input.playerNames);
  const printed = clean(input.printedPlayerNames);
  const cameos = clean(input.cameoNames);
  const people = new Set([...players, ...printed, ...cameos].flatMap(nameWords));
  if (words.every((w) => people.has(w))) return undefined;
  const containsAll = (list: readonly string[]) =>
    list.length > 0 && list.every((n) => hasRun(words, nameWords(n)));
  const record = players.length > 0 ? players : cameos;
  if (containsAll(record) || (players.length > 0 && containsAll(printed))) return undefined;
  return name;
}
