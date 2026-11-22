/**
 * NEO-645 — the walk's footer, keys, order and end screen.
 *
 * The tiles and the card face are other builders' files and have their own
 * tests: here each is a stub, and one of them registers an inline part so the
 * Escape ordering can be driven. Router, URL, history and the sitting are real.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { MemoryRouter, useLocation } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../convex/_generated/api", () => ({
  api: {
    tidyNames: { lookupsPending: "lookupsPending" },
    tidyCards: { cardContext: "cardContext", markReviewed: "markReviewed" },
  },
}));

const markReviewed = vi.fn();
let pendingLookups: { names: Array<{ kind: "player" | "team"; nameNormalized: string }>; more: boolean } = {
  names: [],
  more: false,
};

vi.mock("convex/react", () => ({
  useQuery: (ref: string, args: unknown) => {
    if (args === "skip") return undefined;
    if (ref === "lookupsPending") return pendingLookups;
    if (ref === "cardContext") {
      const { cardId } = args as { cardId: string };
      return {
        cardId,
        names: [],
        players: [{ playerId: "p1", name: "Mike Trout", stints: [], stintsMore: false, sportId: "s" }],
        playersMore: false,
        teams: [],
        linkedFor: [],
      };
    }
    return undefined;
  },
  useMutation: (ref: string) => (ref === "markReviewed" ? markReviewed : vi.fn()),
}));

vi.mock("./TidyCardFace", () => ({ default: () => <div data-testid="face" /> }));
vi.mock("./tiles/SourcesDisagreeTile", () => ({ default: () => <div data-testid="tile-sources" /> }));
vi.mock("./tiles/PlayerTile", () => ({ default: () => <div data-testid="tile-player" /> }));
vi.mock("./tiles/CareerTile", () => ({ default: () => <div data-testid="tile-career" /> }));
vi.mock("./tiles/TeamTile", () => ({ default: () => <div data-testid="tile-team" /> }));
vi.mock("./tiles/AutographTile", () => ({ default: () => <div data-testid="tile-autograph" /> }));
vi.mock("./tiles/MoreAboutTile", () => ({ default: () => <div data-testid="tile-more" /> }));
vi.mock("./tiles/TitleTile", async () => {
  const { useInlinePart } = await import("./inline-stack");
  return {
    default: function TitleTile() {
      const [open, setOpen] = useState(false);
      useInlinePart(open, () => setOpen(false));
      return (
        <div data-testid="tile-title">
          <button type="button" onClick={() => setOpen(true)}>
            Open the editor
          </button>
          {open && <span>Editor open</span>}
        </div>
      );
    },
  };
});

import TidyUpWalk, { mustFixLine } from "./TidyUpWalk";
import { resetSitting } from "./walk-order";
import { currentReviewKeys, deriveCardAttention } from "../card-attention";
import type { CardChecklistRow } from "../card-checklist-row";

const LEAF = "leaf1" as never;

/** Pink: no team. */
const pink = (id: string, number: string, extra: Partial<CardChecklistRow> = {}) =>
  ({
    _id: id,
    cardNumber: number,
    cardName: "Mike Trout",
    playerIds: ["p1"],
    teamOnCardIds: [],
    ...extra,
  }) as unknown as CardChecklistRow;

/** Blue only: a title that was cut to fit. */
const blue = (id: string, number: string) =>
  ({
    _id: id,
    cardNumber: number,
    cardName: "Mike Trout",
    playerIds: ["p1"],
    teamOnCardIds: ["t1"],
    listingTitle: "2024 Topps Chrome #1 Mike Trout",
    listingTitleTruncated: true,
  }) as unknown as CardChecklistRow;

function UrlProbe() {
  const location = useLocation();
  return <output data-testid="url">{location.search}</output>;
}

function mount(cards: CardChecklistRow[], opts: { search?: string; onClose?: () => void } = {}) {
  const onClose = opts.onClose ?? vi.fn();
  const view = render(
    <MemoryRouter initialEntries={[`/${opts.search ?? "?tidy=first"}`]}>
      <UrlProbe />
      <TidyUpWalk
        leafId={LEAF}
        setName="2024 Topps Chrome"
        title="Tidy up 2024 Topps Chrome"
        cards={cards}
        onClose={onClose}
      />
    </MemoryRouter>,
  );
  return { onClose, ...view };
}

const url = () => screen.getByTestId("url").textContent;
const button = (name: string) => screen.getByRole("button", { name });

beforeEach(() => {
  window.sessionStorage.clear();
  resetSitting(LEAF);
  markReviewed.mockReset();
  markReviewed.mockResolvedValue({ keys: [] });
  pendingLookups = { names: [], more: false };
});

describe("the fixtures", () => {
  it("are pink and blue as the one rule says", () => {
    expect(deriveCardAttention(pink("a", "1")).level).toBe("fix");
    expect(deriveCardAttention(blue("b", "2")).level).toBe("check");
  });
});

describe("opening", () => {
  it("replaces `first` with the first card in card-number order", async () => {
    mount([pink("c10", "10"), pink("c2", "2")]);
    await waitFor(() => expect(url()).toBe("?tidy=c2"));
  });

  it("replaces an id that is not one of this checklist's cards with the first card", async () => {
    mount([pink("a", "1")], { search: "?tidy=not-a-card" });
    await waitFor(() => expect(url()).toBe("?tidy=a"));
  });

  it("goes straight to the end screen when nothing needs a person", async () => {
    mount([], { search: "?tidy=first" });
    await waitFor(() => expect(url()).toBe("?tidy=done"));
  });

  it("names the dialog, counts the cards left and prints the header and the tally", async () => {
    mount([pink("a", "38b", { cardVariation: "Image Variation" }), blue("b", "40")]);
    await screen.findByText("#38b · Image Variation · Mike Trout");
    expect(screen.getByRole("dialog", { name: "Tidy up 2024 Topps Chrome" })).toBeTruthy();
    expect(screen.getByText("2 cards left")).toBeTruthy();
    expect(screen.getByText("1 to fix")).toBeTruthy();
    expect(screen.getByTestId("face")).toBeTruthy();
  });

  it("mounts the tiles in the contract order", async () => {
    mount([pink("a", "1")]);
    await screen.findByTestId("tile-sources");
    const ids = screen.getAllByTestId(/^tile-/).map((el) => el.getAttribute("data-testid"));
    expect(ids).toEqual([
      "tile-sources",
      "tile-player",
      "tile-career",
      "tile-team",
      "tile-autograph",
      "tile-title",
      "tile-more",
    ]);
  });
});

describe("the footer", () => {
  it("has the four buttons, by their exact words", async () => {
    mount([pink("a", "1")]);
    await screen.findByTestId("tile-player");
    for (const name of [
      "Back",
      "Save for later (Esc)",
      "Skip: not ready to list",
      "Save & next (Enter)",
    ]) {
      expect(button(name)).toBeTruthy();
    }
  });

  it("holds Save & next while anything is pink, says why, and never blocks Skip", async () => {
    mount([pink("a", "1"), pink("b", "2")]);
    await screen.findByTestId("tile-player");
    const save = button("Save & next (Enter)");
    expect(save.getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByText(mustFixLine(1))).toBeTruthy();
    expect(mustFixLine(3)).toBe(
      "3 to fix before this card can save. Skip it and it can't be listed until it's fixed.",
    );
    fireEvent.click(save);
    expect(markReviewed).not.toHaveBeenCalled();
    expect(button("Skip: not ready to list").hasAttribute("disabled")).toBe(false);
  });

  it("Skip moves on with no write, and the end screen counts the skipped card", async () => {
    mount([pink("a", "1")]);
    await screen.findByTestId("tile-player");
    fireEvent.click(button("Skip: not ready to list"));
    await waitFor(() => expect(url()).toBe("?tidy=done"));
    expect(markReviewed).not.toHaveBeenCalled();
    expect(screen.getByText("1 card skipped, not ready to list")).toBeTruthy();
    expect(button("Done (Esc)")).toBeTruthy();
  });

  it("Save & next stores the card's blue keys, then moves to the next card", async () => {
    const first = blue("a", "1");
    mount([first, pink("b", "2")]);
    await screen.findByText("1 to check");
    fireEvent.click(button("Save & next (Enter)"));
    await waitFor(() => expect(url()).toBe("?tidy=b"));
    expect(markReviewed).toHaveBeenCalledWith({ cardId: "a", keys: currentReviewKeys(first) });
  });

  it("shows `Didn't save, try again` and stays on the card when the write fails", async () => {
    markReviewed.mockRejectedValueOnce(new Error("nope"));
    mount([blue("a", "1"), pink("b", "2")]);
    await screen.findByText("1 to check");
    fireEvent.click(button("Save & next (Enter)"));
    expect((await screen.findByRole("alert")).textContent).toBe("Didn't save, try again");
    expect(url()).toBe("?tidy=a");
    // Retry works.
    fireEvent.click(button("Save & next (Enter)"));
    await waitFor(() => expect(url()).toBe("?tidy=b"));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("Back steps to the card before, as it is now", async () => {
    mount([pink("a", "1"), pink("b", "2")]);
    await screen.findByTestId("tile-player");
    expect(button("Back").hasAttribute("disabled")).toBe(true);
    fireEvent.click(button("Skip: not ready to list"));
    await waitFor(() => expect(url()).toBe("?tidy=b"));
    fireEvent.click(button("Back"));
    await waitFor(() => expect(url()).toBe("?tidy=a"));
  });
});

describe("the keys", () => {
  it("Enter outside a field is Save & next", async () => {
    mount([blue("a", "1"), pink("b", "2")]);
    await screen.findByText("1 to check");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Enter" });
    await waitFor(() => expect(markReviewed).toHaveBeenCalledTimes(1));
  });

  it("Enter does nothing while the card is pink", async () => {
    mount([pink("a", "1")]);
    await screen.findByTestId("tile-player");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Enter" });
    expect(markReviewed).not.toHaveBeenCalled();
  });

  it("Esc is Save for later", async () => {
    const { onClose } = mount([pink("a", "1")]);
    await screen.findByTestId("tile-player");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Esc closes an open inline part first, then means Save for later", async () => {
    const { onClose } = mount([blue("a", "1")]);
    fireEvent.click(await screen.findByRole("button", { name: "Open the editor" }));
    expect(screen.getByText("Editor open")).toBeTruthy();
    // While it is open, Enter never means Save & next either.
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Enter" });
    expect(markReviewed).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByText("Editor open")).toBeNull());
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("the end screen", () => {
  it("says how many cards were skipped and what the team lookup is doing", async () => {
    const waiting = {
      _id: "w",
      cardNumber: "9",
      cardName: "X",
      playerIds: ["p1"],
      teamOnCardIds: [],
      platformData: { bsc: { ref: "r" } },
    } as unknown as CardChecklistRow;
    mount([pink("a", "1"), waiting], { search: "?tidy=done" });
    expect(await screen.findByText("Still looking up teams for 1 card. Nothing for you to do yet.")).toBeTruthy();
    expect(screen.queryByText(/skipped/)).toBeNull();
  });

  it("is all clear with nothing skipped and nothing waiting", async () => {
    mount([], { search: "?tidy=done" });
    expect(await screen.findByText("All tidy. Nothing on this checklist needs you.")).toBeTruthy();
  });

  it("Done and Enter both close the walk", async () => {
    const { onClose } = mount([], { search: "?tidy=done" });
    await screen.findByText("All tidy. Nothing on this checklist needs you.");
    fireEvent.click(button("Done (Esc)"));
    act(() => {
      fireEvent.keyDown(screen.getByRole("dialog"), { key: "Enter" });
    });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
