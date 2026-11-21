/**
 * NEO-569 — the card panel over the dashboard offers the crew's Report under a
 * held-back notice whose fix is the crew's (a missing league, a link, a sheet
 * row): the same `ReportToCrew` form Sync status shows, about the card's set
 * (its variant) on the platform that held it back. Never for a reason the
 * collector fixes (a price, a photo), and never where there is no crew (the
 * logged-out demo).
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { Theme } from "@radix-ui/themes";
import { getDashboard } from "../fake-data";
import CardPanelHost from "./CardPanelHost";
import { CrewProvider, type Crew, type CrewDeskData } from "./crew";

vi.mock("@clerk/clerk-react", () => ({ useAuth: () => ({ isLoaded: true, isSignedIn: false }) }));
vi.mock("convex/react", () => ({}));

afterEach(cleanup);

const EMPTY_DESK: CrewDeskData = { mine: [], mineMore: 0, waiting: null, waitingMore: false };

function crewOf(over: Partial<Crew> = {}): Crew {
  return {
    desk: EMPTY_DESK,
    isReported: () => false,
    report: vi.fn(async () => null),
    withdraw: vi.fn(async () => null),
    ...over,
  };
}

/** A card the demo's Sync status holds back, its panel opened with `held`. */
function open(held: string, crew: Crew | null) {
  const data = getDashboard();
  const card = data.syncStatus!.problems[0].cards[0].card;
  const entry = `/demo?detail=${encodeURIComponent(card.id)}&side=inventory&held=${held}`;
  // Only the panel host: the report lives in the panel, not the dashboard under it.
  const screenEl = <CardPanelHost />;
  render(
    <Theme>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/demo" element={crew ? <CrewProvider value={crew}>{screenEl}</CrewProvider> : screenEl} />
        </Routes>
      </MemoryRouter>
    </Theme>,
  );
  return card;
}

// The panel's code and the demo store it mounts load lazily on first open; open one once here
// so that load is not charged to whichever test runs first.
beforeAll(async () => {
  open("ebay.noPrice", null);
  await screen.findByRole("dialog");
  cleanup();
});

describe("Report in the card panel (NEO-569)", () => {
  it("a card held back for want of a league says so and offers the crew's Report, about its set", async () => {
    const crew = crewOf();
    const card = open("ebay.noLeague", crew);
    const panel = await screen.findByRole("dialog");
    expect(
      within(panel).getByText(
        "Held back from eBay: listings there need a league, and this card doesn't have one yet. Report it and our crew sets it.",
      ),
    ).toBeTruthy();
    // No way to pick a league here: that is an admin's, in the set builder.
    expect(within(panel).queryByRole("combobox", { name: /league/i })).toBeNull();

    fireEvent.click(within(panel).getByRole("button", { name: /^Report to our crew about .+ on eBay$/ }));
    const note = await within(panel).findByRole("textbox", { name: /^Note for our crew/ });
    await waitFor(() => expect(document.activeElement).toBe(note));
    fireEvent.change(note, { target: { value: "Rookie card, AL" } });
    await act(async () => {
      fireEvent.click(within(panel).getByRole("button", { name: /^Send/ }));
    });
    expect(crew.report).toHaveBeenCalledWith({
      variantId: card.card.variant.id,
      platform: "ebay",
      note: "Rookie card, AL",
    });
  });

  it("once reported, the panel says so instead", async () => {
    open("ebay.noLeague", crewOf({ isReported: () => true }));
    const panel = await screen.findByRole("dialog");
    expect(within(panel).getByText(/Reported\. Our crew.s on it\./)).toBeTruthy();
    expect(within(panel).queryByRole("button", { name: /^Report to our crew/ })).toBeNull();
  });

  it("a reason the collector fixes offers no Report", async () => {
    open("ebay.noPrice", crewOf());
    const panel = await screen.findByRole("dialog");
    expect(within(panel).getByText(/^Held back from eBay: no price yet\./)).toBeTruthy();
    expect(within(panel).queryByRole("button", { name: /^Report to our crew/ })).toBeNull();
  });

  it("with no crew (the logged-out demo) there is no Report", async () => {
    open("ebay.noLeague", null);
    const panel = await screen.findByRole("dialog");
    expect(
      within(panel).getByText(
        "Held back from eBay: listings there need a league, and this card doesn't have one yet. Report it from Sync status on your dashboard and our crew sets it.",
      ),
    ).toBeTruthy();
    expect(within(panel).queryByRole("button", { name: /^Report to our crew/ })).toBeNull();
  });
});
