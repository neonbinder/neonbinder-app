/**
 * NEO-535 — the wizard carries the Card titles step's "Set name in titles"
 * box to the commit (`onListingShortNameChange`, the commit's batch-level
 * `listingShortName`) ONLY when the step was shown and the operator edited
 * the box away from its prefill — and the kept titles it reports are the
 * ones generated with that same text.
 *
 * The real CardTitlesStep renders here; its own behaviour is pinned in
 * CardTitlesStep.shortName.test.tsx.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";

vi.mock("../../convex/_generated/api", () => {
  const moduleProxy = (mod: string) =>
    new Proxy({}, { get: (_t, fn) => `${mod}.${String(fn)}` });
  return { api: new Proxy({}, { get: (_t, mod) => moduleProxy(String(mod)) }) };
});

vi.mock("convex/react", () => ({
  useQuery: () => undefined,
  useQueries: (queries: Record<string, unknown>) => {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(queries)) out[key] = undefined;
    return out;
  },
  useMutation: () => vi.fn(() => Promise.resolve(0)),
  useAction: () => vi.fn(() => Promise.resolve(undefined)),
}));

vi.mock("./EntityLinkSearch", () => ({ default: () => null }));

import EntityReviewWizard from "./EntityReviewWizard";

const LABEL = "Set name in titles";
/** Long enough that every new card's title runs over the cap. */
const LONG_TITLES = {
  sportValue: "Baseball",
  setNameValue: "Chrome Update Series Sapphire Edition Platinum Anniversary Collectors Box",
  inheritedFeatures: { manufacturer: "Topps", season: "2026" },
  setTeamNames: [],
  players: [],
  teams: [],
};
const PREFILL = `2026 Topps ${LONG_TITLES.setNameValue}`;
const BOX = "2026 Topps Sapphire";
const CARDS = [{ cardNumber: "1", cardName: "Base", players: ["Pete Rose"], teams: ["Reds"] }];

function setup(props: Record<string, unknown> = {}) {
  const onListingShortNameChange = vi.fn();
  const onTitleAnswersChange = vi.fn();
  render(
    <EntityReviewWizard
      isOpen
      teamsOnly
      selectorOptionId={"selopt-1" as unknown as Id<"selectorOptions">}
      batchId=""
      summary={{ cardCount: 1, deleteCount: 0, reviewDecisionCount: 0 }}
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
      previewCards={CARDS}
      onTeamAnswersChange={vi.fn()}
      titleContext={LONG_TITLES}
      onTitleAnswersChange={onTitleAnswersChange}
      onListingShortNameChange={onListingShortNameChange}
      {...props}
    />,
  );
  const sent = () =>
    onListingShortNameChange.mock.calls.map((c) => c[0]).filter((v) => v !== undefined);
  return { onListingShortNameChange, onTitleAnswersChange, sent };
}

describe("the box reaches the commit only when the step collected an edit", () => {
  it("edited on the titles step: reported, and the kept titles are the ones built with it", () => {
    const { onListingShortNameChange, onTitleAnswersChange } = setup();
    // Before anything is typed, the over-cap title is kept as shown.
    expect(onTitleAnswersChange.mock.calls.at(-1)?.[0]?.[0]?.listingTitleKept).toContain(PREFILL);
    const field = screen.getByRole("textbox", { name: LABEL });
    fireEvent.change(field, { target: { value: BOX } });
    fireEvent.blur(field);
    expect(onListingShortNameChange).toHaveBeenLastCalledWith(BOX);
    expect(onTitleAnswersChange).toHaveBeenLastCalledWith([
      { listingTitleKept: `${BOX} #1 Baseball` },
    ]);
  });

  it("a title the operator wrote before the box edit still rides on the commit", () => {
    const { onTitleAnswersChange } = setup();
    const own = screen.getByRole("textbox", { name: /^Title for #1/ });
    fireEvent.change(own, { target: { value: "My Pete Rose title #1" } });
    fireEvent.blur(own);
    const field = screen.getByRole("textbox", { name: LABEL });
    fireEvent.change(field, { target: { value: BOX } });
    fireEvent.blur(field);
    expect(onTitleAnswersChange).toHaveBeenLastCalledWith([
      { listingTitle: "My Pete Rose title #1" },
    ]);
  });

  it("the box shown but left as prefilled: nothing is sent", () => {
    const { sent } = setup();
    const field = screen.getByRole("textbox", { name: LABEL }) as HTMLInputElement;
    expect(field.value).toBe(PREFILL);
    fireEvent.blur(field);
    expect(sent()).toEqual([]);
  });

  it("a value the server would refuse is not sent, and the titles stay the builder's", () => {
    const { sent, onTitleAnswersChange } = setup();
    const field = screen.getByRole("textbox", { name: LABEL });
    fireEvent.change(field, { target: { value: "Topps\u200bSapphire" } });
    fireEvent.blur(field);
    expect(sent()).toEqual([]);
    expect(onTitleAnswersChange.mock.calls.at(-1)?.[0]?.[0]?.listingTitleKept).toContain(PREFILL);
  });

  it("a stored value: the box shows it, and nothing is sent until it is edited", () => {
    const stored = `${PREFILL} Plus`;
    const { sent } = setup({ titleContext: { ...LONG_TITLES, listingShortName: stored } });
    expect((screen.getByRole("textbox", { name: LABEL }) as HTMLInputElement).value).toBe(stored);
    expect(sent()).toEqual([]);
  });

  it("no titles step at all: nothing sent", () => {
    const { sent } = setup({ titleContext: { ...LONG_TITLES, setNameValue: "Chrome" } });
    expect(screen.queryByRole("textbox", { name: LABEL })).toBeNull();
    expect(sent()).toEqual([]);
  });

  it("without a commit to carry it, the step never asks", () => {
    setup({ onListingShortNameChange: undefined });
    expect(screen.queryByRole("textbox", { name: LABEL })).toBeNull();
  });
});

void React;
