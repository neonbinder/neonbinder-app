import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { Card } from "./data/types";

// The row reads the collection's store for capabilities, binders, scope and
// wants: none of it matters to the line that names the card.
vi.mock("./data/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./data/store")>()),
  useCapabilities: () => ({ wants: false, trade: false }),
  useContainers: () => [],
  useScope: () => "all",
  useReadOnlyAll: () => false,
  useWants: () => [],
}));

import CardRowGroup, { type RowActions } from "./CardRows";

/**
 * NEO-528 audit — the line a checklist row leads with. A card with no player
 * (a cameo-only card) names itself by its own name, else by who is pictured,
 * and never says "Player unknown" beside its Cameo tag.
 */

afterEach(cleanup);

const SET = { id: "s1", year: 1990, season: "1990", name: "Score" } as unknown as Card["set"];
const BASE = { id: "v1", kind: "base", name: null, order: 0 } as unknown as Card["variant"];
const MARINO = { id: "p-marino", name: "Dan Marino" };

const card = (over: Partial<Card> = {}): Card =>
  ({
    id: "c528",
    set: SET,
    variant: BASE,
    cardNumber: "528",
    players: [],
    teams: [],
    printRun: null,
    features: [],
    cardVariation: null,
    isVariation: false,
    sortOrder: 0,
    finish: { kind: "standard" },
    ...over,
  }) as Card;

const actions = new Proxy({}, { get: () => vi.fn() }) as unknown as RowActions;

function renderRow(c: Card, cameo?: readonly string[]) {
  return render(
    <ul>
      <CardRowGroup card={c} copies={[]} actions={actions} cameo={cameo} />
    </ul>,
  );
}

describe("a checklist row's lead line", () => {
  it("a cameo-only card with its own name leads with that name, beside the Cameo tag", () => {
    renderRow(card({ cardName: "Dolphins Leaders", secondaryPlayers: [MARINO] }), ["Dan Marino"]);
    expect(screen.getByText("Dolphins Leaders")).toBeTruthy();
    expect(screen.getByText("Cameo")).toBeTruthy();
    expect(screen.queryByText(/Player unknown/)).toBeNull();
  });

  it("with no name, says who is pictured", () => {
    renderRow(card({ secondaryPlayers: [MARINO] }), ["Dan Marino"]);
    expect(screen.getByText("With Dan Marino")).toBeTruthy();
    expect(screen.queryByText(/Player unknown/)).toBeNull();
  });

  it("a cameo row with nothing known leaves the line to its tag, never 'Player unknown'", () => {
    renderRow(card(), []);
    expect(screen.getByText("Cameo")).toBeTruthy();
    expect(screen.queryByText(/Player unknown/)).toBeNull();
  });

  it("a card that is no cameo and names no one still says Player unknown", () => {
    renderRow(card());
    expect(screen.getByText("Player unknown")).toBeTruthy();
  });

  it("a card with a player leads with the player, whatever its own name", () => {
    renderRow(card({ players: [MARINO], cardName: "Marino Record Breaker" }));
    expect(screen.getByText("Dan Marino")).toBeTruthy();
    expect(screen.queryByText("Marino Record Breaker")).toBeNull();
  });
});
