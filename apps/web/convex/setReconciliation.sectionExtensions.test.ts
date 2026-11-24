/**
 * NEO-616 — a checklist section that several marketplace sets extend.
 *
 * Pass 3 of `matchChecklistSections` (near name) used to pair "1989 Pro Set
 * Base" with the one shortest of 28 "... Base <Foil> <Colour>" lines. When
 * more than one target holds every word of the section's name plus more, the
 * section is a tie (rule 8): unmatched, the extensions offered. A single
 * extension still near-matches.
 */

import { describe, expect, test } from "vitest";
import { matchChecklistSections, type ChecklistTarget } from "./setReconciliation";

const bscItem = (pv: string): ChecklistTarget => ({ kind: "item", side: "bsc", platformValue: pv });
const sec = (name: string) => ({ sectionKey: name.toLowerCase(), name, kind: "other" as const });

describe("matchChecklistSections: several extensions of a name are a tie", () => {
  test("two targets extend the section: unmatched, both offered", () => {
    const result = matchChecklistSections(
      [sec("Future Stars")],
      [
        { target: bscItem("a"), labels: ["Future Stars Die"] },
        { target: bscItem("b"), labels: ["Future Stars Gold"] },
      ],
    );
    expect(result.matches).toEqual([]);
    expect(result.unmatchedSectionKeys).toEqual(["future stars"]);
    expect(result.candidates[0].candidates.map((c) => c.target)).toEqual(
      expect.arrayContaining([bscItem("a"), bscItem("b")]),
    );
  });

  test("one extension still near-matches", () => {
    const result = matchChecklistSections(
      [sec("Future Stars")],
      [
        { target: bscItem("a"), labels: ["Future Stars Die"] },
        { target: bscItem("b"), labels: ["Radiating Rookies"] },
      ],
    );
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].target).toEqual(bscItem("a"));
    expect(result.unmatchedSectionKeys).toEqual([]);
  });

  test("an exact name still wins over several extensions", () => {
    const result = matchChecklistSections(
      [sec("Future Stars")],
      [
        { target: bscItem("a"), labels: ["Future Stars Die"] },
        { target: bscItem("b"), labels: ["Future Stars Gold"] },
        { target: bscItem("c"), labels: ["Future Stars"] },
      ],
    );
    expect(result.matches).toEqual([
      { sectionKey: "future stars", target: bscItem("c"), confidence: 1 },
    ]);
  });

  test("Pro Set: 28 '<Subset> <Foil> <Colour>' targets leave the plain subset unmatched", () => {
    const foils = ["Lazer", "Holo", "Prism", "Chrome"];
    const colours = ["Red", "Blue", "Green", "Gold", "Black", "Silver", "Purple"];
    const targets = foils.flatMap((foil) =>
      colours.map((colour) => ({
        target: bscItem(`${foil}-${colour}`),
        labels: [`1989 Pro Set Base ${foil} ${colour}`],
      })),
    );
    expect(targets).toHaveLength(28);
    const result = matchChecklistSections(
      [sec("1989 Pro Set Base"), sec("1989 Pro Set Base Mini")],
      targets,
    );
    expect(result.matches).toEqual([]);
    expect(result.unmatchedSectionKeys).toEqual(["1989 pro set base", "1989 pro set base mini"]);
  });
});
