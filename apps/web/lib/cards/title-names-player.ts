/**
 * NEO-645 — does a listing title name a player the card is about?
 *
 * The Listing title tile goes blue ("To check") when the card has a player
 * name but the title does not carry a player: a buyer searching for the player
 * would never find the card. Display only; it decides nothing and writes
 * nothing.
 *
 * The test is the player's SURNAME as a whole word in the title, accents and
 * case folded ("José Ramírez" is said by "Jose Ramirez"). The generator never
 * cuts a surname (the title rules: "never cut the surname"), so a title built
 * from a linked player always passes; what fails is a title built with no
 * player (a card whose name was never linked) or a hand edit that dropped the
 * name. A name that has no letters or digits says nothing and is ignored.
 */

const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);

const words = (text: string): string[] =>
  text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter(Boolean);

/** The word a title is expected to say for this name, or undefined for a name with none. */
export function surnameOf(name: string): string | undefined {
  const parts = words(name).filter((w) => !SUFFIXES.has(w));
  return parts[parts.length - 1];
}

/**
 * True when `names` holds at least one name with a surname and the title says
 * none of them. No usable name, nothing to miss: false.
 */
export function titleMissesPlayer(title: string, names: readonly string[]): boolean {
  const surnames = names.map(surnameOf).filter((s): s is string => s !== undefined);
  if (surnames.length === 0) return false;
  const said = new Set(words(title));
  return !surnames.some((s) => said.has(s));
}
