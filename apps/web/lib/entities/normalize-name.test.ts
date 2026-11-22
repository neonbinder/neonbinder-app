/**
 * NEO-253 — the one normalisation of an entity name.
 *
 * Two things are locked here and they fail differently:
 *
 *  1. **The fold.** "José Ramírez" and "Jose Ramirez" must key identically, in
 *     both directions and for teams and leagues as well as players. This is the
 *     behaviour the ticket exists for.
 *  2. **Everything else is unchanged.** The fold was inserted ahead of a chain
 *     that six modules depended on the exact output of, and every stored
 *     `nameNormalized` for an unaccented name has to keep the value it already
 *     has. The ASCII cases below are transcribed from the assertions that used
 *     to live in `convex/lib/entityNearMatch.test.ts` for precisely that reason:
 *     they are the regression surface, not decoration.
 */

import { describe, expect, test } from "vitest";
import { cleanseExternalName } from "./cleanse-name";
import {
  entityNameTokens,
  foldDiacritics,
  foldNameText,
  normalizeEntityName,
  normalizeOrderedEntityName,
} from "./normalize-name";

describe("foldDiacritics", () => {
  test("is foldNameText under its old name", () => {
    expect(foldDiacritics).toBe(foldNameText);
  });

  test("strips combining marks and lowercases, nothing else", () => {
    expect(foldDiacritics("José Ramírez")).toBe("jose ramirez");
    expect(foldDiacritics("Montréal Expos")).toBe("montreal expos");
    // Spacing and punctuation are somebody else's job.
    expect(foldDiacritics("  St. Ástor's  ")).toBe("  st. astor's  ");
  });

  test("is the identity on lowercase ASCII", () => {
    // The property that lets the fold be inserted ahead of the old chain
    // without changing a single existing unaccented key.
    for (const s of ["mike trout", "o'neal, shaquille", "wilkes barre", "..."]) {
      expect(foldDiacritics(s)).toBe(s);
    }
  });

  test("NEO-643: every dash folds to a space, the compatibility forms included", () => {
    // Hyphen-minus, hyphen, non-breaking hyphen, figure dash, en and em dash,
    // horizontal bar, minus sign, and the small and full-width forms.
    for (const dash of ["-", "\u2010", "\u2011", "\u2012", "\u2013", "\u2014", "\u2015", "\u2212", "\uFE58", "\uFE63", "\uFF0D"]) {
      expect(foldDiacritics(`Wilkes${dash}Barre`)).toBe("wilkes barre");
    }
  });

  test("leaves a letter with no canonical decomposition alone", () => {
    // "ø", "ß", "Æ", "Ł" carry no combining mark, so NFD does not separate
    // anything to strip. Deliberate: transliterating them needs per-language
    // rules, and a wrong rule MERGES two different people.
    //
    // All four are asserted rather than one standing in for the rest: they fail
    // for the same reason but in different scripts' worth of Unicode, and a
    // future "let us just add a small transliteration table" would plausibly
    // catch one and miss the others.
    expect(foldDiacritics("Bjørn Nielsen")).toBe("bjørn nielsen");
    expect(foldDiacritics("Weiß")).toBe("weiß");
    expect(foldDiacritics("Ægir Hansen")).toBe("ægir hansen");
    expect(foldDiacritics("Łukasz Nowak")).toBe("łukasz nowak");
  });
});

describe("normalizeEntityName — the players/teams dedup key", () => {
  test("folds diacritics, in both directions", () => {
    expect(normalizeEntityName("José Ramírez")).toBe(
      normalizeEntityName("Jose Ramirez"),
    );
    expect(normalizeEntityName("José Ramírez")).toBe("jose ramirez");
    expect(normalizeEntityName("Montréal Expos")).toBe("expos montreal");
    expect(normalizeEntityName("Montréal Expos")).toBe(
      normalizeEntityName("Montreal Expos"),
    );
  });

  test("an accented name no longer shreds into fragments", () => {
    // The old chain lowercased and THEN dropped everything outside
    // `[a-z0-9\s-]`, so "é" became a separator: the key was "e jos", which
    // resembles neither spelling and shares no token with either.
    expect(entityNameTokens("José Ramírez")).toEqual(["jose", "ramirez"]);
  });

  test("token-sorts, so word order stops mattering", () => {
    expect(normalizeEntityName("New York Yankees")).toBe(
      normalizeEntityName("Yankees, New York"),
    );
    expect(normalizeEntityName("New York Yankees")).toBe("new yankees york");
  });

  test("strips punctuation and collapses whitespace", () => {
    expect(normalizeEntityName("  St. Louis   Cardinals ")).toBe(
      "cardinals louis st",
    );
    expect(normalizeEntityName("O'Neal, Shaquille")).toBe("oneal shaquille");
    expect(normalizeEntityName("Green Bay (Packers)")).toBe("bay green packers");
  });

  test("NEO-643: a hyphen is a space, so a hyphenated name is the spaced name", () => {
    expect(normalizeEntityName("Wilkes-Barre Barons")).toBe(
      "barons barre wilkes",
    );
    expect(normalizeEntityName("Wilkes-Barre")).toBe(normalizeEntityName("Wilkes Barre"));
    expect(normalizeEntityName("Smith-Jones")).toBe(normalizeEntityName("Smith Jones"));
    expect(normalizeEntityName("Smith - Jones")).toBe(normalizeEntityName("Smith Jones"));
    expect(normalizeEntityName("Smith\u2011Jones")).toBe(normalizeEntityName("Smith Jones"));
    expect(normalizeEntityName("Smith\u2013Jones")).toBe(normalizeEntityName("Smith Jones"));
    expect(normalizeEntityName("Smith\u2012Jones")).toBe(normalizeEntityName("Smith Jones"));
  });

  test("a punctuation-only name normalises to the empty key", () => {
    expect(normalizeEntityName("...")).toBe("");
    expect(normalizeEntityName("   ")).toBe("");
  });
});

describe("entityNameTokens — source order", () => {
  test("preserves source order, unlike the sorted dedup key", () => {
    expect(entityNameTokens("New York Yankees")).toEqual([
      "new",
      "york",
      "yankees",
    ]);
  });

  test("the surname is the last token even when it is accented", () => {
    // `players.nearMatches` falls back to searching the last token. Before the
    // fold that token was "rez".
    const tokens = entityNameTokens("José Ramírez");
    expect(tokens[tokens.length - 1]).toBe("ramirez");
  });
});

describe("normalizeOrderedEntityName — the leagues key", () => {
  test("folds, but does NOT sort", () => {
    expect(normalizeOrderedEntityName("Liga Mexicana de Béisbol")).toBe(
      "liga mexicana de beisbol",
    );
    // The reason leagues have their own entry point at all.
    expect(normalizeOrderedEntityName("National League")).not.toBe(
      normalizeOrderedEntityName("League National"),
    );
  });
});

describe("initials — NEO-322", () => {
  const key = normalizeEntityName;
  const ordered = normalizeOrderedEntityName;

  test("every spelling of C. J. Kayfus is one key", () => {
    for (const spelling of [
      "C.J. Kayfus",
      "C. J. Kayfus",
      "CJ Kayfus",
      "C J Kayfus",
    ]) {
      expect(key(spelling)).toBe("cj kayfus");
    }
  });

  test("entityNameTokens joins the run and keeps source order", () => {
    expect(entityNameTokens("C. J. Kayfus")).toEqual(["cj", "kayfus"]);
  });

  test.each([
    ["J.J. Watt", "J. J. Watt"],
    ["A.J. Brown", "A. J. Brown"],
  ])("%s and %s are one key", (a, b) => {
    expect(key(a)).toBe(key(b));
  });

  test("two initials before a surname sort as one token", () => {
    expect(key("R. A. Dickey")).toBe("dickey ra");
    expect(key("J. D. Martinez")).toBe("jd martinez");
  });

  test("three initials join into one token", () => {
    expect(key("J. R. R. Tolkien")).toBe("jrr tolkien");
  });

  test("A. J. Smith and J. A. Smith are different keys", () => {
    // Regression: the sort used to scatter initials, so both keyed "a j smith".
    expect(key("A. J. Smith")).not.toBe(key("J. A. Smith"));
    expect(key("A. J. Smith")).toBe("aj smith");
    expect(key("J. A. Smith")).toBe("ja smith");
  });

  test("a lone initial is left as its own token", () => {
    expect(entityNameTokens("P. Mahomes")).toEqual(["p", "mahomes"]);
    expect(key("Michael A. Taylor")).toBe("a michael taylor");
  });

  test("digits are never joined", () => {
    expect(key("Big 12")).toBe("12 big");
    expect(key("Formula 1")).toBe("1 formula");
    expect(ordered("Big 1 2")).toBe("big 1 2");
  });

  test("a letter between digits does not pull the digits in", () => {
    expect(entityNameTokens("Big 1 A 2")).toEqual(["big", "1", "a", "2"]);
  });

  test("team names with initials agree across spellings", () => {
    for (const spelling of ["Texas A&M", "Texas AM", "Texas A & M"]) {
      expect(key(spelling)).toBe("am texas");
    }
    expect(key("Oakland A's")).toBe("as oakland");
    expect(key("D.C. United")).toBe(key("D C United"));
    expect(key("D.C. United")).toBe("dc united");
    expect(key("U.S.A. Hockey")).toBe(key("U S A Hockey"));
    expect(key("U.S.A. Hockey")).toBe("hockey usa");
  });

  test("a name with no initials is unchanged", () => {
    expect(key("St. Louis Cardinals")).toBe("cardinals louis st");
  });

  test("the ordered league key joins initials and keeps order", () => {
    expect(ordered("N. H. L.")).toBe("nhl");
    expect(ordered("N. H. L.")).toBe(ordered("NHL"));
    expect(ordered("Class A")).toBe("class a");
    // A hyphen is a space (NEO-643), so the two letters join like any initials.
    expect(ordered("Division I-A")).toBe("division ia");
    expect(ordered("Division I-A")).toBe(ordered("Division I A"));
    expect(ordered("Liga MX")).toBe("liga mx");
  });
});

describe("normalizeEntityName — a stored key is not a name", () => {
  test("the sorted key is NOT idempotent under re-normalising", () => {
    // Joining initials runs BEFORE the token sort, so the sort can leave two
    // single-letter tokens side by side, and a second pass then joins them.
    // NOTHING may re-normalise a stored key (or a value read back from one):
    // always normalise the original NAME. `rekeyEntityNames` recomputes from
    // the row's name for exactly this reason.
    const once = normalizeEntityName("J. Doe K.");
    expect(once).toBe("doe j k");
    expect(normalizeEntityName(once)).toBe("doe jk");
    expect(normalizeEntityName(once)).not.toBe(once);
  });
});

describe("foldNameText — NEO-643 junk characters", () => {
  test("deletes the backslash, soft hyphen and zero-width characters", () => {
    expect(foldNameText("Wilmer R\\ios")).toBe("wilmer rios");
    expect(foldNameText("Wil\u00ADmer")).toBe("wilmer");
    for (const zw of ["\u200B", "\u200C", "\u200D", "\u2060", "\uFEFF"]) {
      expect(foldNameText(`Ri${zw}os`)).toBe("rios");
    }
  });

  test("a control character is a space, exactly as stripNameJunk makes it", () => {
    // NEO-643 audit: the fold used to leave a control character for the
    // separator step further down, so a caller using the fold alone saw the
    // raw character while the stored text (stripNameJunk) had a space.
    expect(foldNameText("A\tB")).toBe("a b");
    expect(foldNameText("A\u0000B\u009FC\u007FD")).toBe("a b c d");
    expect(normalizeEntityName("Ruth\tBabe")).toBe("babe ruth");
    expect(normalizeEntityName("Ruth\u0000Babe")).toBe("babe ruth");
  });

  test("every Unicode format character is deleted, inside a word", () => {
    const formats = [
      "\u00AD", "\u061C", "\u180E", "\u200B", "\u200C", "\u200D", "\u200E", "\u200F",
      "\u202A", "\u202B", "\u202C", "\u202D", "\u202E", "\u2060", "\u2066", "\u2067",
      "\u2068", "\u2069", "\uFEFF",
    ];
    for (const f of formats) {
      expect(foldNameText(`Ri${f}os`), `U+${f.codePointAt(0)!.toString(16)}`).toBe("rios");
      expect(normalizeEntityName(`Wilmer Ri${f}os`)).toBe("rios wilmer");
    }
  });

  test("the variation selectors and the spacing accent marks are deleted", () => {
    const marks = [
      "\uFE00", "\uFE0F", "\u00B4", "\u00A8", "\u00B8", "\u02DC", "\u02C6", "`",
      "\u02D8", "\u02D9", "\u02DA", "\u02DB", "\u02DD",
    ];
    for (const m of marks) {
      expect(foldNameText(`Ri${m}os`), `U+${m.codePointAt(0)!.toString(16)}`).toBe("rios");
      expect(normalizeEntityName(`Wilmer Ri${m}os`)).toBe("rios wilmer");
    }
    // A stand-in accent in front of the letter, as the sources write it.
    expect(normalizeEntityName("Jos\u00B4e Ram\u00A8irez")).toBe(normalizeEntityName("Jose Ramirez"));
  });

  test("^ ~ / | and U+FFFD are not junk: they stay separators", () => {
    for (const c of ["^", "~", "/", "|", "\uFFFD"]) {
      expect(normalizeEntityName(`Ri${c}os`), c).toBe("os ri");
    }
  });

  test("a compatibility letter folds onto its plain letters (NFKD)", () => {
    expect(foldNameText("\uFF2Dike")).toBe("mike");
    expect(normalizeEntityName("\uFF2Dike Trout")).toBe(normalizeEntityName("Mike Trout"));
    expect(foldNameText("\uFB01nn")).toBe("finn");
    expect(normalizeEntityName("Fe\uFB01n")).toBe(normalizeEntityName("Fefin"));
    expect(normalizeEntityName("\uFF2A\uFF4F\u0073\u00E9")).toBe(normalizeEntityName("Jose"));
  });

  test("a trademark sign stays a separator, NFKD does not spell it TM", () => {
    expect(normalizeEntityName("Topps\u2122 Chrome")).toBe(normalizeEntityName("Topps Chrome"));
    expect(foldNameText("Chrome\u2120")).toBe("chrome ");
  });
});

describe("normalizeEntityName — NEO-643 one matcher for BSC's backslash", () => {
  test("Wilmer R\\ios, Wilmer Ríos and Wilmer Rios are one key", () => {
    const key = normalizeEntityName("Wilmer Rios");
    expect(key).toBe("rios wilmer");
    expect(normalizeEntityName("Wilmer R\\ios")).toBe(key);
    expect(normalizeEntityName("Wilmer Ríos")).toBe(key);
  });

  test("a zero-width character inside a name does not split it", () => {
    expect(normalizeEntityName("Wil\u200Bmer R\u200Dios")).toBe("rios wilmer");
    expect(normalizeEntityName("Ri\u00ADos\uFEFF")).toBe("rios");
  });

  test("O\\'Neal and O'Neal are one key", () => {
    expect(normalizeEntityName("O\\'Neal")).toBe(normalizeEntityName("O'Neal"));
    expect(normalizeEntityName("O\\'Neal")).toBe("oneal");
  });

  test("a replacement character stays apart from the letter it lost", () => {
    expect(normalizeEntityName("R\uFFFDos")).not.toBe(normalizeEntityName("Rios"));
    expect(normalizeEntityName("R?os")).not.toBe(normalizeEntityName("Rios"));
  });

  test("initial order still matters", () => {
    expect(normalizeEntityName("A. J. Smith")).not.toBe(normalizeEntityName("J. A. Smith"));
  });

  test("Ø and ß are unchanged by the junk step", () => {
    expect(normalizeEntityName("Bjørn")).toBe(normalizeEntityName("Bj\u00F8rn"));
    expect(normalizeEntityName("Bjørn")).not.toBe(normalizeEntityName("Bjorn"));
    expect(normalizeEntityName("Weiß")).not.toBe(normalizeEntityName("Weiss"));
  });

  test("pinned: a mid-word backslash is deleted, not a separator", () => {
    expect(normalizeEntityName("Smith\\Jones")).toBe("smithjones");
  });

  test("cleansing a name never changes its key (generated corpus)", () => {
    const pieces = [
      "Wilmer", "R\\ios", "Ríos", "O\\'Neal", "Smith", "\\", "\u00AD", "\u200B",
      "\u200C", "\u200D", "\u2060", "\uFEFF", "\uFFFD", "?", "Ø", "ß", "A.", "J.",
      "Jr.", "St.", "Louis", " ", "  ", "\t", "\n", "\u0000", "\u007F", "\u009F",
      "\u00A0", "-", "'", "’", "e\u0301", "é", "Å", "\u212B", "한글", "12", "&",
      "Montréal", "B\\eisbol",
      // NEO-643 audit: the widened junk class and compatibility letters.
      "\u061C", "\u180E", "\u200E", "\u200F", "\u202A", "\u202E", "\u2066", "\u2069",
      "\uFE0F", "\u00B4", "\u00A8", "\u00B8", "\u02DC", "\u02C6", "`", "\u02D8", "\u02DD",
      "\uFF2Dike", "\uFB01", "\u2122", "\u00BD", "\u2460", "\u00AA", "^", "~", "/", "|",
      "Jos\u00B4e", "R\u00A8ios",
    ];
    // Deterministic LCG, so a failure names the same input on every run.
    let seed = 643;
    const next = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed;
    };
    for (let i = 0; i < 2000; i++) {
      const n = 1 + (next() % 6);
      let x = "";
      for (let j = 0; j < n; j++) x += pieces[next() % pieces.length];
      expect(normalizeEntityName(cleanseExternalName(x)), JSON.stringify(x)).toBe(
        normalizeEntityName(x),
      );
      expect(normalizeOrderedEntityName(cleanseExternalName(x)), JSON.stringify(x)).toBe(
        normalizeOrderedEntityName(x),
      );
    }
  });
});
