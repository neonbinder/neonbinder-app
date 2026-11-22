/**
 * NEO-645 — where the sources still disagree about a card's players or teams,
 * built from the wire card the commit receives.
 *
 * Pure: strings in, entries out. Pins what is stored (a REAL difference), what
 * is not (values that agree after the shared name matcher), NB's own pick
 * (exactly one value made only of NB rows), and the 4096-byte cap that keeps a
 * leaf-wide `getCardChecklist` read small (an overflow refuses and names the
 * card by NB's own number).
 */

import { describe, expect, test } from "vitest";
import { getConvexSize } from "convex/values";
import {
  SOURCE_DISAGREEMENTS_MAX_BYTES,
  MAX_DISAGREEMENT_VALUES,
  assertDisagreementsFit,
  buildDisagreements,
  namesHeld,
  pickByNb,
  sameNames,
  type DisagreementEntry,
} from "./sourceDisagreements";

const card = (over: Record<string, unknown> = {}) => ({ cardNumber: "17", ...over });

describe("buildDisagreements — what is stored", () => {
  test("two sources naming different players is one players entry with both values and their sources", () => {
    const out = buildDisagreements(
      card({ playersConflict: { bsc: ["Aaron Judge"], sportlots: ["Juan Soto"] } }),
      ["bsc"],
    );
    expect(out).toEqual([
      {
        field: "players",
        values: [
          { value: ["Aaron Judge"], sources: ["bsc"] },
          { value: ["Juan Soto"], sources: ["sportlots"] },
        ],
      },
    ]);
  });

  test("values that agree after the name matcher are one value and store NOTHING", () => {
    const out = buildDisagreements(
      card({
        playersConflict: {
          bsc: ["Aaron Judge", "Juan Soto"],
          // case, spacing and a repeat: the same two people
          sportlots: ["aaron  judge", "JUAN SOTO", "Juan Soto"],
        },
      }),
      ["bsc"],
    );
    expect(out).toEqual([]);
  });

  test("an accent is not a difference (Acuña / Acuna)", () => {
    const out = buildDisagreements(
      card({ playersConflict: { bsc: ["Ronald Acuña Jr."], sportlots: ["Ronald Acuna Jr."] } }),
      ["bsc"],
    );
    expect(out).toEqual([]);
  });

  test("a trailing period is not a difference (Jr. / Jr)", () => {
    const out = buildDisagreements(
      card({ playersConflict: { bsc: ["Ken Griffey Jr."], sportlots: ["Ken Griffey Jr"] } }),
      ["bsc"],
    );
    expect(out).toEqual([]);
  });

  test("the same two names in a different ORDER are a real difference (print order matters)", () => {
    const out = buildDisagreements(
      card({ playersConflict: { bsc: ["Aaron Judge", "Juan Soto"], sportlots: ["Juan Soto", "Aaron Judge"] } }),
      ["bsc"],
    );
    expect(out).toHaveLength(1);
    expect(out[0].values).toHaveLength(2);
  });

  test("a checklist difference labels the marketplace side with the card's marketplace refs", () => {
    const out = buildDisagreements(
      card({
        checklistConflict: {
          players: { marketplace: ["Aaron Judge"], checklist: ["Juan Soto"] },
        },
      }),
      ["bsc", "sportlots"],
    );
    expect(out).toEqual([
      {
        field: "players",
        values: [
          { value: ["Aaron Judge"], sources: ["bsc", "sportlots"] },
          { value: ["Juan Soto"], sources: ["checklist"] },
        ],
      },
    ]);
  });

  test("a bsc / sportlots disagreement that the checklist sides with joins that value's sources", () => {
    const out = buildDisagreements(
      card({
        playersConflict: { bsc: ["Aaron Judge"], sportlots: ["Juan Soto"] },
        checklistConflict: { players: { marketplace: ["Aaron Judge"], checklist: ["Juan Soto"] } },
      }),
      ["bsc"],
    );
    const byName = Object.fromEntries(out[0].values.map((v) => [v.value[0], v.sources]));
    expect(byName["Aaron Judge"]).toEqual(["bsc"]);
    expect(byName["Juan Soto"]).toEqual(["sportlots", "checklist"]);
  });

  test("a teams disagreement is its own entry beside a players one", () => {
    const out = buildDisagreements(
      card({
        playersConflict: { bsc: ["A"], sportlots: ["B"] },
        checklistConflict: { teams: { marketplace: ["Padres"], checklist: ["Mets"] } },
      }),
      ["bsc"],
    );
    expect(out.map((e) => e.field)).toEqual(["players", "teams"]);
  });

  test("a value of no names (the source named nobody) still counts as a value", () => {
    const out = buildDisagreements(
      card({ checklistConflict: { teams: { marketplace: ["Padres"], checklist: [] } } }),
      ["bsc"],
    );
    expect(out).toHaveLength(1);
    expect(out[0].values.map((v) => v.value)).toEqual([["Padres"], []]);
  });

  test("a card with no conflict stores nothing", () => {
    expect(buildDisagreements(card(), ["bsc"])).toEqual([]);
  });

  test("cleans each name to one line and drops blanks", () => {
    const out = buildDisagreements(
      card({ playersConflict: { bsc: ["  Aaron \n Judge ", ""], sportlots: ["Juan Soto"] } }),
      ["bsc"],
    );
    expect(out[0].values[0].value).toEqual(["Aaron Judge"]);
  });
});

describe("buildDisagreements — bounds", () => {
  test("a name over 120 characters refuses the commit and names the card, never the value", () => {
    const long = "X".repeat(121);
    let message = "";
    try {
      buildDisagreements(card({ playersConflict: { bsc: [long], sportlots: ["Juan Soto"] } }), ["bsc"]);
    } catch (e) {
      message = String((e as { data?: string }).data ?? (e as Error).message);
    }
    expect(message).toContain("#17");
    expect(message).not.toContain(long);
  });

  test("more than 20 players in one value refuses, naming the card", () => {
    const many = Array.from({ length: 21 }, (_, i) => `Player Number${i}`);
    expect(() =>
      buildDisagreements(card({ playersConflict: { bsc: many, sportlots: ["Juan Soto"] } }), ["bsc"]),
    ).toThrow();
  });

  test("more than 8 teams in one value refuses", () => {
    const many = Array.from({ length: 9 }, (_, i) => `Team Number${i}`);
    expect(() =>
      buildDisagreements(card({ checklistConflict: { teams: { marketplace: many, checklist: ["Mets"] } } }), ["bsc"]),
    ).toThrow();
  });

  test("more than three different values for one field refuses", () => {
    // bsc, sportlots, marketplace and checklist all different = 4 values.
    expect(MAX_DISAGREEMENT_VALUES).toBe(3);
    expect(() =>
      buildDisagreements(
        card({
          playersConflict: { bsc: ["A One"], sportlots: ["B Two"] },
          checklistConflict: { players: { marketplace: ["C Three"], checklist: ["D Four"] } },
        }),
        ["other" as never],
      ),
    ).toThrow(/#17/);
  });

  test("a payload that does not fit the 4096-byte cap refuses and names the card", () => {
    // 3 values x 20 names x ~100 chars is far over 4 KB.
    const names = (tag: string) =>
      Array.from({ length: 20 }, (_, i) => `${tag}${i} ${"x".repeat(90)}`);
    let message = "";
    try {
      buildDisagreements(
        card({
          playersConflict: { bsc: names("a"), sportlots: names("b") },
          checklistConflict: { players: { marketplace: names("a"), checklist: names("c") } },
        }),
        ["bsc"],
      );
    } catch (e) {
      message = String((e as { data?: string }).data ?? (e as Error).message);
    }
    expect(message).toContain("#17");
    expect(message).not.toContain("xxxxxxxxxx");
  });

  test("assertDisagreementsFit passes an entry just under the cap and refuses one just over", () => {
    const sized = (chars: number): DisagreementEntry[] => [
      {
        field: "players",
        values: [
          { value: ["x".repeat(chars)], sources: ["bsc"] },
          { value: ["y"], sources: ["sportlots"] },
        ],
      },
    ];
    // Find the largest single name that still fits, from the same size measure
    // the writer uses, so the test does not hard-code Convex's byte overhead.
    let fit = 1;
    while (getConvexSize([...sized(fit + 1)] as never) <= SOURCE_DISAGREEMENTS_MAX_BYTES) fit += 1;
    expect(() => assertDisagreementsFit(sized(fit), "9")).not.toThrow();
    expect(() => assertDisagreementsFit(sized(fit + 1), "9")).toThrow(/#9/);
  });

  test("no entries never throw", () => {
    expect(() => assertDisagreementsFit([], "1")).not.toThrow();
  });
});

describe("pickByNb — NB picks only when exactly one value is made of NB rows", () => {
  const entry: DisagreementEntry = {
    field: "players",
    values: [
      { value: ["Aaron Judge"], sources: ["bsc"] },
      { value: ["Zed Nobody"], sources: ["sportlots"] },
    ],
  };

  test("exactly one all-known value is chosen by nb", () => {
    const out = pickByNb(entry, (k) => k.includes("judge"));
    expect(out.chosen).toEqual({ value: ["Aaron Judge"], by: "nb" });
  });

  test("both values known is a question for the operator", () => {
    expect(pickByNb(entry, () => true).chosen).toBeUndefined();
  });

  test("neither value known is a question for the operator", () => {
    expect(pickByNb(entry, () => false).chosen).toBeUndefined();
  });

  test("a value is known only when EVERY name in it is", () => {
    const two: DisagreementEntry = {
      field: "players",
      values: [
        { value: ["Aaron Judge", "Zed Nobody"], sources: ["bsc"] },
        { value: ["Juan Soto"], sources: ["sportlots"] },
      ],
    };
    const out = pickByNb(two, (k) => k.includes("judge") || k.includes("soto"));
    expect(out.chosen?.value).toEqual(["Juan Soto"]);
  });

  test("a value naming nobody (No team) is never picked, even though every one of zero names is known", () => {
    const teams: DisagreementEntry = {
      field: "teams",
      values: [
        { value: [], sources: ["checklist"] },
        { value: ["Padres"], sources: ["bsc"] },
      ],
    };
    expect(pickByNb(teams, () => false).chosen).toBeUndefined();
    expect(pickByNb(teams, () => true).chosen?.value).toEqual(["Padres"]);
  });

  test("does not mutate the entry it is given", () => {
    const frozen = structuredClone(entry);
    pickByNb(entry, (k) => k.includes("judge"));
    expect(entry).toEqual(frozen);
  });
});

describe("namesHeld — an unsettled field holds NOTHING", () => {
  const unsettled: DisagreementEntry = {
    field: "players",
    values: [
      { value: ["A"], sources: ["bsc"] },
      { value: ["B"], sources: ["sportlots"] },
    ],
  };

  test("no entry for the field: not held", () => {
    expect(namesHeld([unsettled], "teams")).toEqual({ held: false, names: [] });
  });

  test("an unsettled entry holds the field and names no one", () => {
    expect(namesHeld([unsettled], "players")).toEqual({ held: true, names: [] });
  });

  test("a chosen entry holds the chosen value", () => {
    const chosen = { ...unsettled, chosen: { value: ["B"], by: "nb" as const } };
    expect(namesHeld([chosen], "players")).toEqual({ held: true, names: ["B"] });
  });
});

describe("sameNames", () => {
  test("compares by the shared key, in order", () => {
    expect(sameNames(["Aaron Judge"], ["aaron  JUDGE"])).toBe(true);
    expect(sameNames(["A", "B"], ["B", "A"])).toBe(false);
    expect(sameNames(["A"], ["A", "B"])).toBe(false);
  });
});
