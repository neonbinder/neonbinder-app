/**
 * NEO-535 — `CardTitlesStep` fed a `source` instead of preview cards: the
 * parallel Card titles dialog draws each parallel's stored cards through it.
 * Pinned: the count and prefill come from the source, a scope names the box
 * and every row apart from another section's, the heading level follows the
 * host, the "more" line shows, and a box edit regroups through the source.
 *
 * The wizard's own path (`cards` + `titleContext`) is pinned, unchanged, in
 * CardTitlesStep.test.tsx and CardTitlesStep.shortName.test.tsx.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, test, vi } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import { assessListingTitle } from "../../convex/features/generateListing";
import CardTitlesStep from "./CardTitlesStep";
import { parallelTitlesSource, type ParallelTitlesSection, type StoredTitleCard } from "./parallel-titles";

const PARALLEL = "Kanji Orange Wave Refractor Sapphire Gold XYZW";

function stored(n: string): StoredTitleCard {
  const inputs = {
    cardNumber: n,
    playerNames: ["Mike Trout"],
    teamNames: [],
    year: "2024",
    manufacturer: "Topps",
    setName: "Topps Chrome",
    insertName: "Anime",
    parallelName: PARALLEL,
    parallelIsRole: true,
    sport: "Baseball",
  };
  return {
    cardId: `card-${n}` as unknown as Id<"cardChecklist">,
    cardNumber: n,
    cardName: "Mike Trout",
    title: assessListingTitle(inputs).title,
    inputs,
  };
}

const SECTION: ParallelTitlesSection = {
  parallelId: "parallel-1" as unknown as Id<"selectorOptions">,
  parallelValue: "Kanji XYZW",
  boxPrefill: `2024 Topps Chrome Anime ${PARALLEL}`,
  cards: [stored("3"), stored("4")],
  moreCount: 12,
};

function setup(scope?: string, headingLevel?: 3 | 4) {
  const onShortNameChange = vi.fn();
  const utils = render(
    <CardTitlesStep
      source={parallelTitlesSource(SECTION, scope)}
      answers={[]}
      onAnswersChange={vi.fn()}
      onShortNameChange={onShortNameChange}
      headingLevel={headingLevel}
    />,
  );
  return { ...utils, onShortNameChange };
}

describe("CardTitlesStep — fed a source (NEO-535)", () => {
  test("rows and the box come from the source, with the more line under them", () => {
    setup();
    const fields = screen.getAllByRole("textbox", { name: /^Title for/ }) as HTMLTextAreaElement[];
    expect(fields.map((f) => f.value)).toEqual([stored("3").title, stored("4").title]);
    const box = screen.getByRole("textbox", { name: "Set name in titles" }) as HTMLTextAreaElement;
    expect(box.value).toBe(SECTION.boxPrefill);
    expect(screen.getByText(/^And 12 more after these\./)).toBeTruthy();
  });

  test("a scope names the box and every row apart", () => {
    setup("Kanji XYZW");
    expect(screen.getByRole("textbox", { name: "Set name in titles for Kanji XYZW" })).toBeTruthy();
    for (const field of screen.getAllByRole("textbox", { name: /^Title for/ })) {
      expect(field.getAttribute("aria-label")).toMatch(/^Title for Kanji XYZW /);
    }
  });

  test("the headings follow the host's level", () => {
    const { unmount } = setup(undefined, 4);
    expect(screen.getAllByRole("heading", { level: 4 }).length).toBeGreaterThan(0);
    expect(screen.queryAllByRole("heading", { level: 3 })).toHaveLength(0);
    unmount();
    setup();
    expect(screen.getAllByRole("heading", { level: 3 }).length).toBeGreaterThan(0);
  });

  test("a box edit is told to the host when it settles", () => {
    const { onShortNameChange } = setup();
    const box = screen.getByRole("textbox", { name: "Set name in titles" });
    fireEvent.change(box, { target: { value: "Anime Kanji XYZW" } });
    fireEvent.blur(box);
    expect(onShortNameChange).toHaveBeenLastCalledWith("Anime Kanji XYZW");
  });
});
