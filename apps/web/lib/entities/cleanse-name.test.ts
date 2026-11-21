/**
 * NEO-643 — the cleanse every externally sourced name passes through as it
 * comes in. The matching guarantees (cleansing never changes a key) live in
 * `normalize-name.test.ts`; this file locks the stored shape.
 */

import { describe, expect, test } from "vitest";
import { cleanseExternalName, stripNameJunk } from "./cleanse-name";

describe("stripNameJunk", () => {
  test("deletes the backslash, soft hyphen and zero-width characters", () => {
    expect(stripNameJunk("Wilmer R\\ios")).toBe("Wilmer Rios");
    expect(stripNameJunk("Wil­mer")).toBe("Wilmer");
    for (const zw of ["​", "‌", "‍", "⁠", "﻿"]) {
      expect(stripNameJunk(`Ri${zw}os`)).toBe("Rios");
    }
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
    expect(cleanseExternalName("Rí́os")).toBe("Rí́os".normalize("NFC"));
    expect(cleanseExternalName("Rémy")).toBe("Rémy");
    expect(cleanseExternalName("O'NEAL")).toBe("O'NEAL");
  });

  test("a clean name comes back unchanged", () => {
    for (const s of ["Mike Trout", "José Ramírez", "Wilkes-Barre Penguins", "Texas A&M"]) {
      expect(cleanseExternalName(s)).toBe(s);
    }
  });

  test("an all-junk name comes back empty", () => {
    expect(cleanseExternalName(" \\ ​ ")).toBe("");
  });
});
