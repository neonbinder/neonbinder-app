import { describe, expect, it } from "vitest";
import {
  cardNumbersDifferOnlyByPrefix,
  compareCardNumbers,
  splitCardNumberPrefix,
} from "./card-number";

/** Sort with the comparator and return the resulting order, for readable assertions. */
function sorted(values: string[]): string[] {
  return [...values].sort(compareCardNumbers);
}

describe("compareCardNumbers", () => {
  describe("plain numeric cards (pre-existing behaviour — must not regress)", () => {
    it("orders single and multi-digit numbers numerically, not lexicographically", () => {
      expect(sorted(["10", "2", "1", "11", "3"])).toEqual(["1", "2", "3", "10", "11"]);
    });

    it("sorts a lettered variation suffix after its parent card", () => {
      expect(sorted(["11b", "11", "11c"])).toEqual(["11", "11b", "11c"]);
    });

    it("sorts a numbered card ahead of a lettered insert code", () => {
      expect(sorted(["CC-JA", "1"])).toEqual(["1", "CC-JA"]);
    });

    it("returns 0 for identical card numbers", () => {
      expect(compareCardNumbers("42", "42")).toBe(0);
    });
  });

  describe("prefixed insert/parallel codes (NEO-200)", () => {
    it("sorts the real 2024 Topps Chrome Insert -> Future Stars sequence naturally", () => {
      // This is the exact fixture from the bug report: under the old
      // digit-prefix-only rule this fell back to localeCompare and produced
      // FS-1, FS-10, FS-11, FS-2, FS-20, FS-3, FS-9.
      const input = ["FS-1", "FS-2", "FS-3", "FS-9", "FS-10", "FS-11", "FS-20"];
      expect(sorted([...input].reverse())).toEqual(input);
    });

    it("sorts FS-2 before FS-10 (the core regression)", () => {
      expect(sorted(["FS-10", "FS-2"])).toEqual(["FS-2", "FS-10"]);
    });

    it("orders two purely-lettered codes by their text, unaffected by the digit fix", () => {
      expect(sorted(["MIR-AJ", "CC-JA"])).toEqual(["CC-JA", "MIR-AJ"]);
    });
  });

  describe("multi-segment and internally-numbered codes", () => {
    it("compares a numeric run in the middle of the string, not just a leading one", () => {
      // T206-1 / T206-10: shared "T206-" text prefix ties, final digit run decides.
      expect(sorted(["T206-10", "T206-2", "T206-1"])).toEqual(["T206-1", "T206-2", "T206-10"]);
    });

    it("handles more than two alternating digit/text segments", () => {
      expect(sorted(["A2B10", "A2B2", "A10B1"])).toEqual(["A2B2", "A2B10", "A10B1"]);
    });

    it("ties on a shared numeric run and falls through to the next text segment", () => {
      expect(sorted(["12B", "12A"])).toEqual(["12A", "12B"]);
    });
  });

  describe("mixed case", () => {
    it("orders lettered prefixes via localeCompare on the text token, same as before the fix", () => {
      // Case ordering here is whatever the environment's localeCompare says
      // (this repo's Node/ICU sorts lowercase before uppercase) — the point
      // of this test is that the *comparison basis* for the text token is
      // unchanged from the pre-NEO-200 behaviour, not a specific case rule.
      expect("rc-".localeCompare("RC-")).toBe(-1);
      expect(sorted(["RC-1", "rc-2"])).toEqual(["rc-2", "RC-1"]);
    });
  });

  describe("equal numeric value, different printed width (FS-1 vs FS-01)", () => {
    it("treats them as adjacent, not equal — shorter printed form sorts first", () => {
      const result = sorted(["FS-01", "FS-1"]);
      expect(result).toEqual(["FS-1", "FS-01"]);
      expect(compareCardNumbers("FS-1", "FS-01")).not.toBe(0);
    });

    it("is consistent for the bare-numeric shape too (01 vs 1)", () => {
      expect(sorted(["01", "1"])).toEqual(["1", "01"]);
    });
  });

  describe("shorter token sequence sorts first when a shared prefix ties", () => {
    it("sorts FS-1 before FS-1a (variation suffix on a prefixed code)", () => {
      expect(sorted(["FS-1a", "FS-1"])).toEqual(["FS-1", "FS-1a"]);
    });
  });

  describe("digit-vs-text divergence past the first token", () => {
    it("sorts a numbered continuation ahead of a lettered one after a tied text prefix", () => {
      // Shared "FS" text token ties; then a digit run ("FS1") should still
      // sort ahead of a text run ("FSA") at the point they diverge.
      expect(sorted(["FSA", "FS1"])).toEqual(["FS1", "FSA"]);
    });
  });

  describe("mixed numeric and prefixed sets", () => {
    it("orders a set containing both plain numbers and insert codes", () => {
      const input = ["FS-2", "3", "FS-1", "1", "2", "FS-10"];
      expect(sorted(input)).toEqual(["1", "2", "3", "FS-1", "FS-2", "FS-10"]);
    });
  });
});

// NEO-591 — what a card number says about two cards.
import {
  cardNumberClass,
  cardNumbersAgree,
  exactChecklistNumber,
  isNoNumber,
  normalizeChecklistNumber,
  preferCardNumber,
  stripLetterPrefix,
  strippedCardNumber,
} from "./card-number";

describe("cardNumberClass", () => {
  it("blank and NNO in any print are none", () => {
    for (const raw of ["", "  ", "NNO", "nno", "#NNO", "NNO.", "No. NNO"]) {
      expect(cardNumberClass(raw)).toBe("none");
    }
  });
  it("a bare number is digits, with or without a #", () => {
    for (const raw of ["1", "038", "#12", "No. 7"]) expect(cardNumberClass(raw)).toBe("digits");
  });
  it("any letter makes it letters: a suffix, a prefix, a code", () => {
    for (const raw of ["38a", "38A", "BCP-12", "OV-ANFI", "SIG-FT", "US12"]) {
      expect(cardNumberClass(raw)).toBe("letters");
    }
  });
});

describe("cardNumbersAgree", () => {
  it("same as printed, or case-folded", () => {
    expect(cardNumbersAgree("12", "#12")).toBe(true);
    expect(cardNumbersAgree("1a", "1A")).toBe(true);
    expect(cardNumbersAgree("bcp-12", "BCP-12")).toBe(true);
  });
  it("a letter prefix or the set's prefix is stripped from either side", () => {
    expect(cardNumbersAgree("BCP-12", "12")).toBe(true);
    expect(cardNumbersAgree("12", "BCP-12")).toBe(true);
    expect(cardNumbersAgree("DK-5", "5", { prefix: "DK-" })).toBe(true);
    expect(cardNumbersAgree("DK5", "5", { prefix: "dk" })).toBe(true);
  });
  it("NNO agrees with NNO and with nothing else", () => {
    expect(cardNumbersAgree("NNO", "")).toBe(true);
    expect(cardNumbersAgree("NNO", "12")).toBe(false);
    expect(cardNumbersAgree("12", "nno")).toBe(false);
  });
  it("a bare number and that number with an 'a' are one card (Jason, 2026-11-18); 38b is not 38", () => {
    expect(cardNumbersAgree("38a", "38")).toBe(true);
    expect(cardNumbersAgree("38", "38A")).toBe(true);
    expect(cardNumbersAgree("38b", "38")).toBe(false);
    expect(cardNumbersAgree("38aa", "38")).toBe(false);
    expect(cardNumbersAgree("BCP-38a", "38")).toBe(false);
  });
  it("different numbers and different codes do not agree", () => {
    expect(cardNumbersAgree("12", "13")).toBe(false);
    expect(cardNumbersAgree("OV-ANFI", "NNO")).toBe(false);
    expect(cardNumbersAgree("SIG-FT", "SIG-AB")).toBe(false);
  });
});

describe("preferCardNumber", () => {
  it("letters beat digits beat none, whichever side owns", () => {
    expect(preferCardNumber("38", "38a")).toBe("38a");
    expect(preferCardNumber("38a", "38")).toBe("38a");
    expect(preferCardNumber("NNO", "12")).toBe("12");
    expect(preferCardNumber("12", "NNO")).toBe("12");
    expect(preferCardNumber("NNO", "OV-ANFI")).toBe("OV-ANFI");
    expect(preferCardNumber("", "NNO")).toBe("");
  });
  it("lettered on both sides and disagreeing: the owner's lettering wins, no ERR / COR special case", () => {
    // Jason: follow the marketplace's lettering, a lot of it is industry accepted.
    expect(preferCardNumber("38ERR", "38COR")).toBe("38ERR");
    expect(preferCardNumber("38COR", "38ERR")).toBe("38COR");
    expect(preferCardNumber("38ERR", "38")).toBe("38ERR");
    expect(preferCardNumber("38", "38COR")).toBe("38COR");
  });
  it("the same class keeps the owner's number", () => {
    expect(preferCardNumber("12", "13")).toBe("12");
    expect(preferCardNumber("OV-A", "OV-B")).toBe("OV-A");
    expect(preferCardNumber("38a", "38b")).toBe("38a");
    expect(preferCardNumber("NNO", "")).toBe("NNO");
  });
});

describe("the number helpers moved here", () => {
  it("read a number the way the matchers do", () => {
    expect(exactChecklistNumber("No. 1 a")).toBe("1a");
    expect(normalizeChecklistNumber("bcp-12")).toBe("BCP-12");
    expect(stripLetterPrefix("BCP-12")).toBe("12");
    expect(stripLetterPrefix("SIG-FT")).toBeNull();
    expect(isNoNumber("nno")).toBe(true);
    expect(strippedCardNumber("bcp-12")).toBe("12");
    expect(strippedCardNumber("DK-5", "DK-")).toBe("5");
    expect(strippedCardNumber("38a")).toBe("38A");
  });
});

describe("splitCardNumberPrefix (NEO-616)", () => {
  it("splits the prefix from the trailing counting part", () => {
    expect(splitCardNumberPrefix("89B-1")).toEqual({ prefix: "89B-", remainder: "1" });
    expect(splitCardNumberPrefix("T88-12")).toEqual({ prefix: "T88-", remainder: "12" });
    expect(splitCardNumberPrefix("12")).toEqual({ prefix: "", remainder: "12" });
    expect(splitCardNumberPrefix("RC-10a")).toEqual({ prefix: "RC-", remainder: "10a" });
    expect(splitCardNumberPrefix("US12")).toEqual({ prefix: "US", remainder: "12" });
    expect(splitCardNumberPrefix("#89B-1")).toEqual({ prefix: "89B-", remainder: "1" });
  });

  it("reads the number as printed: case is kept", () => {
    expect(splitCardNumberPrefix("x-1A")).toEqual({ prefix: "x-", remainder: "1A" });
  });

  it("has no remainder when the number does not end in digits", () => {
    expect(splitCardNumberPrefix("NNO")).toBeNull();
    expect(splitCardNumberPrefix("OV-ANFI")).toBeNull();
    expect(splitCardNumberPrefix("")).toBeNull();
  });
});

describe("cardNumbersDifferOnlyByPrefix (NEO-616)", () => {
  it("is true when only the prefix differs", () => {
    expect(cardNumbersDifferOnlyByPrefix("89B-1", "89M-1")).toBe(true);
    expect(cardNumbersDifferOnlyByPrefix("12", "T88-12")).toBe(true);
    expect(cardNumbersDifferOnlyByPrefix("T88-12", "12")).toBe(true);
  });

  it("is false when the remainder differs", () => {
    expect(cardNumbersDifferOnlyByPrefix("89B-1", "89M-2")).toBe(false);
    expect(cardNumbersDifferOnlyByPrefix("89B-1", "89M-11")).toBe(false);
    expect(cardNumbersDifferOnlyByPrefix("1a", "T-1A")).toBe(false);
  });

  it("is false for the same number, or a prefix that differs only in case", () => {
    expect(cardNumbersDifferOnlyByPrefix("12", "12")).toBe(false);
    expect(cardNumbersDifferOnlyByPrefix("rc-10", "RC-10")).toBe(false);
  });

  it("is false when a number has no remainder", () => {
    expect(cardNumbersDifferOnlyByPrefix("NNO", "NNO")).toBe(false);
    expect(cardNumbersDifferOnlyByPrefix("OV-A", "XX-A")).toBe(false);
  });
});
