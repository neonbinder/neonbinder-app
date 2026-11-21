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
 * `normalize-name.ts` shares `NAME_JUNK` with this module, so the matcher and
 * the cleanser can never disagree about what counts as junk.
 */

/**
 * The characters that are noise inside a name, never meaning: the backslash
 * (BSC's stand-in for an accent), the soft hyphen, and the zero-width
 * characters U+200B-U+200D, U+2060 and U+FEFF. They are DELETED, not turned
 * into separators, because the noise sits inside a word ("R\ios").
 */
export const NAME_JUNK = /[\\­​-‍⁠﻿]/g;

/** C0 and C1 control characters (tab and newline included). */
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/g;

/**
 * Delete the junk characters and turn each control character into a space.
 * Does not trim or collapse anything else.
 */
export function stripNameJunk(raw: string): string {
  return raw.replace(NAME_JUNK, "").replace(CONTROL_CHARS, " ");
}

/**
 * The form an external name is stored in: junk stripped, composed (NFC, so an
 * accent that survives is one code point), whitespace collapsed to single
 * spaces and the ends trimmed. An accent that BSC replaced with a backslash is
 * simply gone ("Wilmer R\ios" becomes "Wilmer Rios"); the original letter
 * cannot be recovered, and is not guessed.
 */
export function cleanseExternalName(raw: string): string {
  return stripNameJunk(raw).normalize("NFC").replace(/\s+/g, " ").trim();
}
