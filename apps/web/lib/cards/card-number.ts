/**
 * Natural card-number ordering — "#2" before "#10", and "11" before "11b".
 *
 * A card number is not a number. It is a printed label: `1`, `11b`, `232C`,
 * `CC-JA`, `MIR-AJ`, `FS-1`. Sorting it as a string puts #10 before #2;
 * sorting it as an integer throws away everything after the digits, which is
 * exactly where a variation lives.
 *
 * ## Why this lives in lib/ rather than being copied
 *
 * It had three homes: `convex/selectorOptions.ts`, `components/SetSelector/
 * CardChecklist.tsx`, and — once the pairing modal started streaming — very
 * nearly a third in `CardPairingModal.tsx`. The component copy carried a note
 * explaining the duplication as unavoidable because "convex/ is a separate
 * deploy/typecheck unit and the frontend shouldn't pull server modules in for
 * twelve lines."
 *
 * That reasoning is right about convex/ and wrong about the conclusion: `lib/`
 * is neither side's server code, and convex already imports from it (see
 * lib/cards/variations.ts). One home, imported by both, pulls no server module
 * into the browser and removes the drift.
 *
 * Drift here is not cosmetic. The checklist and the pairing modal show the same
 * cards, and if their orderings disagree the operator reviews a set in one
 * order and then finds it saved in another.
 *
 * ## NEO-200 — prefixed insert/parallel codes did not sort naturally
 *
 * The original implementation only tokenised a number that *started* with a
 * digit (`^(\d+)(.*)`); anything else — which is the normal shape for an
 * insert or parallel (`FS-1`, `CC-JA`, `MIR-AJ`) — fell straight through to
 * `localeCompare`, so a real "2024 Topps Chrome → Insert → Future Stars"
 * checklist sorted `FS-1, FS-10, FS-11, FS-2, FS-20, FS-3, FS-9` instead of
 * `FS-1, FS-2, FS-3, FS-9, FS-10, FS-11, FS-20`.
 *
 * The fix generalises the same idea to the whole string instead of only its
 * head: split into alternating runs of digits and non-digits ("tokens"), then
 * compare token by token — numerically where both sides are a digit run,
 * `localeCompare` where both are text. This is a superset of the old
 * behaviour (a card number that starts with digits and has no further digits
 * anywhere, e.g. `11b`, tokenises to the same two pieces the old regex
 * produced) and it now also handles a digit run anywhere else in the string:
 *
 *  - **Multi-segment codes** (`T206-1` vs `T206-10`): tokens are
 *    `["T", "206", "-", "1"]` vs `["T", "206", "-", "10"]` — the shared
 *    "T206-" prefix ties token-by-token and the final numeric token decides.
 *  - **A prefix with an internal digit** is exactly the case above; there is
 *    no separate "prefix" concept, just a sequence of tokens, so an internal
 *    digit run is compared numerically like any other.
 *  - **Mixed case** (`Rc-1` vs `rc-2`): the text tokens ("Rc-" / "rc-") are
 *    ordered with the same `localeCompare` the previous implementation used
 *    for a lettered code, so this is unchanged, not new behaviour.
 *  - **`FS-1` vs `FS-01`**: same numeric value, different printed width.
 *    These are NOT collapsed to equal — a comparator that returns 0 for two
 *    different strings makes `Array.prototype.sort` order them arbitrarily
 *    (unstable relative to whatever produced them), and callers upstream
 *    (`CardPairingModal.tsx`'s `compareCards`) rely on `compareCardNumbers`
 *    returning 0 *only* for equal card numbers to know a further tiebreak is
 *    needed. So: equal numeric value ties, then the shorter printed form
 *    (`1`) sorts before the zero-padded one (`01`) — the same "shorter comes
 *    first" rule already used for `11` vs `11b`.
 *
 * Two structural rules carry over unchanged from the original function:
 *
 *  - When the token sequences run out at different lengths with every shared
 *    token equal so far (`11` vs `11b`), the shorter one — the parent card —
 *    sorts first.
 *  - When the two token streams disagree in *kind* at the same position (one
 *    side has a digit run, the other has a text run, e.g. `1` vs `CC-JA`),
 *    the digit run sorts first — a numbered card sorts ahead of a lettered
 *    insert code, so the numeric run of a set reads top to bottom without
 *    codes interleaved. This is now evaluated at whichever token position the
 *    two strings first diverge, not only at position zero, so it keeps
 *    working if a shared prefix ties before the divergence.
 */

type CardNumberToken = { readonly kind: "digits" | "text"; readonly value: string };

function tokenizeCardNumber(value: string): CardNumberToken[] {
  const runs = value.match(/\d+|\D+/g) ?? [];
  return runs.map((run) => ({
    kind: /^\d+$/.test(run) ? "digits" : "text",
    value: run,
  }));
}

export function compareCardNumbers(a: string, b: string): number {
  if (a === b) return 0;

  const aTokens = tokenizeCardNumber(a);
  const bTokens = tokenizeCardNumber(b);
  const length = Math.max(aTokens.length, bTokens.length);

  for (let i = 0; i < length; i++) {
    const aToken = aTokens[i];
    const bToken = bTokens[i];

    // One side ran out of tokens with everything before this tied: the
    // shorter card number is the parent ("11" before "11b").
    if (!aToken) return -1;
    if (!bToken) return 1;

    if (aToken.kind !== bToken.kind) {
      // A digit run sorts ahead of a text run wherever the two diverge, so a
      // numbered card ("1") sorts ahead of a lettered insert code ("CC-JA")
      // even if they share a tied prefix first.
      return aToken.kind === "digits" ? -1 : 1;
    }

    if (aToken.kind === "digits") {
      const aNum = parseInt(aToken.value, 10);
      const bNum = parseInt(bToken.value, 10);
      if (aNum !== bNum) return aNum - bNum;
      // Same value, different printed width ("1" vs "01"): not equal, but
      // adjacent — shorter printed form first.
      if (aToken.value.length !== bToken.value.length) {
        return aToken.value.length - bToken.value.length;
      }
      continue;
    }

    const byText = aToken.value.localeCompare(bToken.value);
    if (byText !== 0) return byText;
  }

  // Every token compared equal (can only happen via a localeCompare that
  // treats two differently-cased runs as equivalent) but a !== b — fall back
  // to a stable, total ordering rather than reporting a tie for distinct
  // strings.
  return a < b ? -1 : 1;
}

// ---------------------------------------------------------------------------
// NEO-591 — what a card number SAYS about two cards (product rule 7, names
// first). These were born in `lib/checklists/match-published-checklist.ts`,
// which re-exports them so its importers stay put.
// ---------------------------------------------------------------------------

/**
 * A card number as printed, as the exact pass compares it: trimmed, a
 * leading "#" or "No." dropped, inner whitespace removed, case KEPT.
 * "#12" = "No. 12" = "12"; "1a" and "1A" stay two numbers.
 */
export function exactChecklistNumber(raw: string): string {
  let n = raw.normalize("NFKC").trim();
  n = n.replace(/^(?:#|no\.?(?=\s|\d|#))\s*/i, "");
  n = n.replace(/^#\s*/, "");
  return n.replace(/\s+/g, "");
}

/**
 * The case-folded number: `exactChecklistNumber` upper-cased. "bcp-12" =
 * "BCP-12".
 */
export function normalizeChecklistNumber(raw: string): string {
  return exactChecklistNumber(raw).toUpperCase();
}

/**
 * The number without a leading letter prefix ("BCP-12" → "12", "US12" →
 * "12"), or null when there is none to strip. Only letters followed by an
 * optional "-" and then a digit count as a prefix.
 */
export function stripLetterPrefix(normalized: string): string | null {
  const m = /^[A-Z]+-?(?=\d)/.exec(normalized);
  if (!m) return null;
  const rest = normalized.slice(m[0].length);
  return rest.length > 0 ? rest : null;
}

/**
 * A card number that is no number: blank, or "NNO" ("#NNO", "nno.") as
 * checklists and marketplaces print an unnumbered card.
 */
export function isNoNumber(raw: string): boolean {
  const n = normalizeChecklistNumber(raw).replace(/[.:]$/, "");
  return n === "" || n === "NNO";
}

/**
 * What kind of number a card carries, for choosing which one NB keeps.
 * "none" is blank or NNO; "letters" is any letter once the number is read as
 * printed ("38a", "OV-ANFI", "BCP-12"); everything else is "digits".
 */
export type CardNumberClass = "none" | "digits" | "letters";

export function cardNumberClass(n: string): CardNumberClass {
  if (isNoNumber(n)) return "none";
  return /\p{L}/u.test(exactChecklistNumber(n)) ? "letters" : "digits";
}

const CLASS_RANK: Record<CardNumberClass, number> = { none: 0, digits: 1, letters: 2 };

/**
 * The number `bare` holds once the set's own prefix ("DK-") is taken off the
 * folded form, or null when it does not start with it (or nothing is left).
 */
function stripSetPrefix(folded: string, prefix: string | undefined): string | null {
  if (!prefix) return null;
  const p = normalizeChecklistNumber(prefix);
  if (!p || !folded.startsWith(p)) return null;
  const rest = folded.slice(p.length).replace(/^-/, "");
  return rest.length > 0 ? rest : null;
}

/**
 * The case-folded number with the set's own `cardNumberPrefix` taken off, or,
 * when `letters` is true (the default), a leading letter prefix ("BCP-12" →
 * "12"); the folded number itself when neither applies. The key the
 * prefix-stripped passes compare. `letters: false` is for number-only pairing,
 * where an arbitrary letter prefix may mark a different subset ("T-10" is not
 * "10").
 */
export function strippedCardNumber(raw: string, prefix?: string, letters = true): string {
  const folded = normalizeChecklistNumber(raw);
  return stripSetPrefix(folded, prefix) ?? (letters ? stripLetterPrefix(folded) : null) ?? folded;
}

/**
 * Do two card numbers name the same printed number? Yes when they are:
 * - the same as printed, or the same case-folded ("1a" = "1A");
 * - a bare number and that number with an "a" ("38" = "38a"; "38b" is not);
 * - the same once a leading letter prefix ("BCP-12" → "12") or the set's own
 *   `cardNumberPrefix` is stripped from either;
 * - both no-number (blank / NNO).
 * A no-number against a numbered card never agrees. "38" and "38b" do not.
 */
export function cardNumbersAgree(
  a: string,
  b: string,
  options?: { prefix?: string },
): boolean {
  const aNone = isNoNumber(a);
  const bNone = isNoNumber(b);
  if (aNone || bNone) return aNone && bNone;
  const fa = normalizeChecklistNumber(a);
  const fb = normalizeChecklistNumber(b);
  if (fa === fb) return true;
  // A bare number and the same number with an "a" are one card ("38" and
  // "38a": a lettered base prints 38a where the other source prints 38).
  // "38b" is a different card.
  if (/^\d+$/.test(fa) && fb === fa + "A") return true;
  if (/^\d+$/.test(fb) && fa === fb + "A") return true;
  const reads = (folded: string) => {
    const out = new Set<string>();
    const letters = stripLetterPrefix(folded);
    if (letters) out.add(letters);
    const set = stripSetPrefix(folded, options?.prefix);
    if (set) out.add(set);
    out.add(folded);
    return out;
  };
  const ra = reads(fa);
  for (const r of reads(fb)) if (ra.has(r)) return true;
  return false;
}

/**
 * NEO-616 — a card number split into its PREFIX and its REMAINDER.
 *
 * The remainder is the number's trailing counting part: a run of digits,
 * optionally followed by one letter ("1", "12", "10a"); the prefix is
 * everything before it ("89B-", "T88-", "RC-", "US", or nothing). Read as
 * printed (`exactChecklistNumber`: "#" and spaces dropped, case kept).
 *
 *   "89B-1"  -> { prefix: "89B-", remainder: "1" }
 *   "T88-12" -> { prefix: "T88-",  remainder: "12" }
 *   "12"     -> { prefix: "",      remainder: "12" }
 *   "RC-10a" -> { prefix: "RC-",   remainder: "10a" }
 *
 * `null` when the number has no remainder to read (no trailing digits: "NNO",
 * "OV-ANFI", "CC-JA", blank).
 */
export function splitCardNumberPrefix(
  raw: string,
): { prefix: string; remainder: string } | null {
  const m = /^(.*?)(\d+[A-Za-z]?)$/.exec(exactChecklistNumber(raw));
  return m ? { prefix: m[1], remainder: m[2] } : null;
}

/**
 * Do two card numbers differ ONLY in their prefix (Jason, 2026-11-24: "sometimes
 * parallels just have a different prefix")? Their remainders are the same as
 * printed (case kept: "1a" and "1A" stay two numbers) and their prefixes are
 * not the same once case and punctuation (hyphens, spaces, dots) are folded
 * ("89B-1" / "89M-1", "12" / "T88-12"). Two identical numbers, or ones that
 * differ only in the case or punctuation of the prefix ("BCP12" / "BCP-12"),
 * do not: those are the same number spelled differently, not a different
 * prefix.
 */
export function cardNumbersDifferOnlyByPrefix(a: string, b: string): boolean {
  const sa = splitCardNumberPrefix(a);
  const sb = splitCardNumberPrefix(b);
  if (!sa || !sb) return false;
  const bare = (prefix: string) => prefix.replace(/[-.\s]/g, "").toUpperCase();
  return sa.remainder === sb.remainder && bare(sa.prefix) !== bare(sb.prefix);
}

/**
 * Which of two numbers NB keeps when two sources name the same card: letters
 * over digits over none (a number with a letter is the more specific print:
 * "38a" over "38", "OV-ANFI" over "NNO"). The same class keeps `own`, so the
 * caller passes the owner first (BSC over SportLots, a marketplace over the
 * operator's checklist).
 */
export function preferCardNumber(own: string, other: string): string {
  return CLASS_RANK[cardNumberClass(other)] > CLASS_RANK[cardNumberClass(own)] ? other : own;
}
