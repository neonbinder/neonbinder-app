/**
 * NEO-645 T3 — the surname of an NB player's name, for a button label
 * ("Lindor as a cameo").
 *
 * NB stores one `name` per player, so the surname is read off it: the last
 * word, with a trailing generational suffix set aside ("Ronald Acuña Jr." ->
 * "Acuña"; Jr., Sr., II, III, IV or V, with or without the period or a comma
 * before it, in any case). Accents stay as stored. A name of one word is its
 * own surname, whole, and so is a name that is only a suffix.
 *
 * The suffix test is the shared one (`isGenerationalSuffix`, which the
 * player-fragment guard and the carried-title reader use); "V" is added here
 * and nowhere else, because widening the shared set would change what the
 * fragment guard treats as one token.
 *
 * Pure, and read by the server (`tidyCards.cardContext`): the label is the
 * server's, so the button and its write cannot disagree about the name.
 */
import { entityNameTokens } from "../entities/normalize-name";
import { isGenerationalSuffix } from "./name-fragment";

const isSuffix = (word: string): boolean => {
  if (isGenerationalSuffix(word)) return true;
  const tokens = entityNameTokens(word);
  return tokens.length === 1 && tokens[0] === "v";
};

/** A word without the punctuation around it ("Acuña," -> "Acuña"). */
const trimEdges = (word: string): string =>
  word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");

export function playerSurname(name: string): string {
  const whole = name.trim();
  const words = whole.split(/\s+/).filter((w) => trimEdges(w) !== "");
  if (words.length < 2) return whole;
  const body = isSuffix(words[words.length - 1]) ? words.slice(0, -1) : words;
  return trimEdges(body[body.length - 1]);
}
