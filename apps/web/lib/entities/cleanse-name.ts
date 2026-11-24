/**
 * NEO-643 — cleanse an externally sourced NAME as it comes in.
 *
 * BSC replaces an accented letter with a backslash ("Wilmer R\ios" for Ríos,
 * "B\eisbol" for Béisbol), and other sources leak soft hyphens and zero-width
 * characters into names. Left in place, each one is a stray character inside a
 * name NB then stores, shows, and keys.
 *
 * Applies to NAMES and DISPLAY LABELS only (player, team, league, set, brand,
 * variant and card names, and the labels shown for them). It must NEVER touch an
 * id, a slug or a `platformRef`: those are opaque keys read back verbatim by
 * adapters, and deleting a character from one silently breaks the link.
 *
 * Browser-safe on purpose: no env reads and no `_generated` imports, so the
 * browser, the adapters and the Convex modules all call the same function.
 * `normalize-name.ts` starts its fold with `stripNameJunk`, so the matcher and
 * the cleanser can never disagree about what counts as junk.
 */

/**
 * The characters that are noise inside a name, never meaning. They are DELETED,
 * not turned into separators, because the noise sits inside a word ("R\ios"):
 *
 * - every Unicode format character (`\p{Cf}`): the zero-width characters, the
 *   byte-order mark, the soft hyphen, LRM/RLM, U+061C, the bidi embeddings and
 *   isolates (U+202A-U+202E, U+2066-U+2069), U+180E and the rest;
 * - the backslash (BSC's stand-in for an accent);
 * - the variation selectors U+FE00-U+FE0F;
 * - the spacing accent marks that stand in for a letter's accent: acute U+00B4,
 *   diaeresis U+00A8, cedilla U+00B8, small tilde U+02DC, circumflex U+02C6,
 *   the grave accent (backtick) U+0060 and the spacing modifier letters
 *   U+02D8-U+02DD.
 *
 * Left alone on purpose: "^", "~", "/", "|", U+FFFD, and the control
 * characters, which are separators (`CONTROL_CHARS`), not junk.
 *
 * Module-private and global: it is only ever handed to `String.replace`, which
 * resets `lastIndex`. Exposing it would let a caller's `.test` or `.exec`
 * carry state between calls, so only the functions below are exported.
 * Written with `\u` escapes only: no invisible character appears in this file
 * (a literal one reads differently from what it does, "Trojan Source").
 */
const NAME_JUNK =
  /[\p{Cf}\\\uFE00-\uFE0F\u00B4\u00A8\u00B8\u02DC\u02C6\u0060\u02D8-\u02DD\u180E]/gu;

/** C0 and C1 control characters (tab and newline included). */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/g;

/**
 * Delete the junk characters and turn each control character into a space.
 * Does not trim or collapse anything else. `foldNameText` (the matcher's fold)
 * starts with this same function, so the stored text and the key agree on both.
 */
export function stripNameJunk(raw: string): string {
  return raw.replace(NAME_JUNK, "").replace(CONTROL_CHARS, " ");
}

/**
 * The form an external name is stored in: junk stripped, composed (NFC, so an
 * accent that survives is one code point), whitespace collapsed to single
 * spaces and the ends trimmed. An accent that BSC replaced with a backslash is
 * simply gone ("Wilmer R\\ios" becomes "Wilmer Rios"); the original letter
 * cannot be recovered, and is not guessed.
 */
export function cleanseExternalName(raw: string): string {
  return stripNameJunk(raw).normalize("NFC").replace(/\s+/g, " ").trim();
}
