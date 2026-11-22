/**
 * NEO-643 — the cleanse every externally sourced name passes through as it
 * comes in. The matching guarantees (cleansing never changes a key) live in
 * `normalize-name.test.ts`; this file locks the stored shape.
 */

import { describe, expect, test } from "vitest";
import * as cleanseModule from "./cleanse-name";
import { cleanseExternalName, stripNameJunk } from "./cleanse-name";

describe("stripNameJunk", () => {
  test("deletes the backslash, soft hyphen and zero-width characters", () => {
    expect(stripNameJunk("Wilmer R\\ios")).toBe("Wilmer Rios");
    expect(stripNameJunk("Wil\u00ADmer")).toBe("Wilmer");
    for (const zw of ["\u200B", "\u200C", "\u200D", "\u2060", "\uFEFF"]) {
      expect(stripNameJunk(`Ri${zw}os`)).toBe("Rios");
    }
  });

  test("deletes every Unicode format character", () => {
    const formats = [
      "\u00AD", "\u061C", "\u180E", "\u200B", "\u200C", "\u200D", "\u200E", "\u200F",
      "\u202A", "\u202B", "\u202C", "\u202D", "\u202E", "\u2060", "\u2066", "\u2067",
      "\u2068", "\u2069", "\uFEFF",
    ];
    for (const f of formats) expect(stripNameJunk(`Ri${f}os`), f.codePointAt(0)!.toString(16)).toBe("Rios");
  });

  test("deletes the variation selectors and the spacing accent marks", () => {
    const marks = [
      "\uFE00", "\uFE0F", "\u00B4", "\u00A8", "\u00B8", "\u02DC", "\u02C6", "`",
      "\u02D8", "\u02D9", "\u02DA", "\u02DB", "\u02DD",
    ];
    for (const m of marks) expect(stripNameJunk(`Ri${m}os`), m.codePointAt(0)!.toString(16)).toBe("Rios");
  });

  test("leaves ^ ~ / | and U+FFFD alone", () => {
    for (const c of ["^", "~", "/", "|", "\uFFFD"]) expect(stripNameJunk(`Ri${c}os`)).toBe(`Ri${c}os`);
  });

  test("exports no regex, so no caller can carry lastIndex between calls", () => {
    for (const value of Object.values(cleanseModule)) expect(value).not.toBeInstanceOf(RegExp);
    expect(Object.keys(cleanseModule).sort()).toEqual(["cleanseExternalName", "stripNameJunk"]);
  });

  test("turns a control character into a space and does not trim", () => {
    expect(stripNameJunk("A\tB")).toBe("A B");
    expect(stripNameJunk("A\u0000B\u009FC\u007FD")).toBe("A B C D");
    expect(stripNameJunk("  Rios  ")).toBe("  Rios  ");
  });

  test("leaves a replacement character, a question mark and other scripts alone", () => {
    expect(stripNameJunk("R�os")).toBe("R�os");
    expect(stripNameJunk("R?os")).toBe("R?os");
    expect(stripNameJunk("Bjørn Weiß 한글")).toBe("Bjørn Weiß 한글");
  });
});

describe("cleanseExternalName", () => {
  test("Wilmer R\\ios becomes Wilmer Rios", () => {
    expect(cleanseExternalName("Wilmer R\\ios")).toBe("Wilmer Rios");
  });

  test("collapses whitespace and trims", () => {
    expect(cleanseExternalName("  Wilmer \t\n  Rios  ")).toBe("Wilmer Rios");
    expect(cleanseExternalName("Wilmer  Rios")).toBe("Wilmer Rios");
  });

  test("composes accents to NFC and keeps case", () => {
    expect(cleanseExternalName("Rí\u0301os")).toBe("Rí\u0301os".normalize("NFC"));
    expect(cleanseExternalName("Re\u0301my")).toBe("Rémy");
    expect(cleanseExternalName("O'NEAL")).toBe("O'NEAL");
  });

  test("a clean name comes back unchanged", () => {
    for (const s of ["Mike Trout", "José Ramírez", "Wilkes-Barre Penguins", "Texas A&M"]) {
      expect(cleanseExternalName(s)).toBe(s);
    }
  });

  test("an all-junk name comes back empty", () => {
    expect(cleanseExternalName(" \\ \u200B ")).toBe("");
  });
});
