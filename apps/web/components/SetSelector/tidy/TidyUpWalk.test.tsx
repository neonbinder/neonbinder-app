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
    tidyNewPlayers: { newPlayerNames: "newPlayerNames", addNewPlayers: "addNewPlayers" },
  },
}));

// "Add all new players" asks the server on demand; the walk's own tests offer nobody
// (its control has its own test file).
const { convexQuery } = vi.hoisted(() => ({
  convexQuery: vi.fn(
    async (): Promise<{
      names: Array<{ name: string; cardNumbers: string[]; moreCards: boolean }>;
      more: boolean;
    }> => ({ names: [], more: false }),
  ),
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
  useConvex: () => ({ query: convexQuery }),
}));

vi.mock("./TidyCardFace", () => ({ default: () => <div data-testid="face" /> }));
vi.mock("./tiles/SourcesDisagreeTile", () => ({ default: () => <div data-testid="tile-sources" /> }));
// A tile's level is what the walk's "next pink tile" reads off the page.
let playerLevel: "fix" | "plain" = "plain";
// Off, the stub team tile answers without telling the walk: the focus repair for
// a tile that has not been taught to (an unmounted button must not strand focus).
let teamCallsAnswered = true;
vi.mock("./tiles/PlayerTile", () => ({
  default: () => (
    <section data-testid="tile-player" data-tidy-level={playerLevel}>
      <button type="button">Player control</button>
    </section>
  ),
}));
vi.mock("./tiles/CareerTile", () => ({ default: () => <div data-testid="tile-career" /> }));
vi.mock("./tiles/TeamTile", async () => {
  const { useAnswered } = await import("./answered");
  return {
    // The shape of "No team on this card": the pressed button leaves the page,
    // and the tile says it was answered (what every real tile does).
    default: function TeamTile() {
      const [answered, setAnswered] = useState(false);
      const onAnswered = useAnswered();
      return (
        <div data-testid="tile-team">
          {answered ? (
            <p>No team on this card: saved</p>
          ) : (
            <button
              type="button"
              onClick={() => {
                setAnswered(true);
                if (teamCallsAnswered) onAnswered();
              }}
            >
              No team on this card
            </button>
          )}
        </div>
      );
    },
  };
});
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

import TidyUpWalk, { mustFixLine, reviewSkippedLabel } from "./TidyUpWalk";
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

/** One animation frame, inside act, so the walk's focus repair has run. */
const nextFrame = () =>
  act(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  });

const url = () => screen.getByTestId("url").textContent;
const button = (name: string) => screen.getByRole("button", { name });

beforeEach(() => {
  window.sessionStorage.clear();
  resetSitting(LEAF);
  markReviewed.mockReset();
  markReviewed.mockResolvedValue({ keys: [] });
  pendingLookups = { names: [], more: false };
  playerLevel = "plain";
  teamCallsAnswered = true;
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
    await screen.findByRole("group", { name: "#38b · Image Variation · Mike Trout" });
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
    expect(button("Skip: not ready to list").getAttribute("aria-disabled")).toBeNull();
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
    // At the oldest card Back says so with aria-disabled (never native `disabled`,
    // which would drop a keyboard operator out of the tab order), and does nothing.
    expect(button("Back").getAttribute("aria-disabled")).toBe("true");
    expect(button("Back").hasAttribute("disabled")).toBe(false);
    fireEvent.click(button("Back"));
    expect(url()).toBe("?tidy=a");
    fireEvent.click(button("Skip: not ready to list"));
    await waitFor(() => expect(url()).toBe("?tidy=b"));
    expect(button("Back").getAttribute("aria-disabled")).toBeNull();
    fireEvent.click(button("Back"));
    await waitFor(() => expect(url()).toBe("?tidy=a"));
  });

  it("Back and Skip hold with aria-disabled while a save is in flight, and Back's focus goes to Save for later", async () => {
    let finish: (v: unknown) => void = () => {};
    markReviewed.mockReturnValueOnce(new Promise((r) => (finish = r)));
    mount([blue("a", "1"), blue("b", "2")]);
    await screen.findByText("1 to check");
    fireEvent.click(button("Skip: not ready to list"));
    await waitFor(() => expect(url()).toBe("?tidy=b"));
    await screen.findByText("1 to check");
    await nextFrame();
    const back = button("Back");
    act(() => back.focus());
    expect(document.activeElement).toBe(back);
    fireEvent.click(button("Save & next (Enter)"));
    expect(back.getAttribute("aria-disabled")).toBe("true");
    expect(button("Skip: not ready to list").getAttribute("aria-disabled")).toBe("true");
    // Still the same element in the page, so focus was not lost; it moves on to a live control.
    expect(document.activeElement).toBe(button("Save for later (Esc)"));
    fireEvent.click(button("Skip: not ready to list"));
    expect(url()).toBe("?tidy=b");
    await act(async () => finish({ keys: [] }));
  });

  it("the card header is a group named by the header line only, not the tally", async () => {
    mount([pink("a", "38b", { cardVariation: "Image Variation" })]);
    const group = await screen.findByRole("group", { name: "#38b · Image Variation · Mike Trout" });
    const line = document.getElementById(group.getAttribute("aria-labelledby")!) as HTMLElement;
    expect(group.getAttribute("tabindex")).toBe("-1");
    expect(line.textContent).toBe("#38b · Image Variation · Mike Trout");
    expect(group.textContent).toContain("1 to fix");
  });

  it("keeps the card number on one line: 'FS-3' never wraps to '#FS-' over '3'", async () => {
    mount([pink("a", "FS-3")]);
    const group = await screen.findByRole("group", { name: "#FS-3 · Mike Trout" });
    const line = document.getElementById(group.getAttribute("aria-labelledby")!) as HTMLElement;
    const number = line.querySelector("span") as HTMLElement;
    expect(number.textContent).toBe("#FS-3");
    expect(number.className).toContain("whitespace-nowrap");
    // The rest of the line still wraps anywhere.
    expect(line.className).toContain("wrap-anywhere");
  });

  it("draws the key hints in brackets and keeps them in the accessible names on a coarse pointer", async () => {
    mount([pink("a", "1")]);
    await screen.findByTestId("tile-player");
    for (const name of ["Save for later (Esc)", "Save & next (Enter)"]) {
      const control = button(name);
      const hint = control.querySelector("span") as HTMLElement;
      expect(hint.textContent).toMatch(/^ \((Esc|Enter)\)$/);
      // Out of sight on a touch screen, never out of the name.
      expect(hint.className).toContain("[@media(pointer:coarse)]:sr-only");
      expect(control.textContent).toBe(name);
    }
    // A label with no key is left whole.
    expect(button("Skip: not ready to list").querySelector("span")).toBeNull();
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

describe("focus", () => {
  it("lands on the card header when a card opens", async () => {
    mount([blue("a", "1")]);
    await screen.findByText("1 to check");
    await nextFrame();
    const dialog = screen.getByRole("dialog");
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement?.textContent).toContain("#1");
  });

  it("moves to the next card's header after Save & next", async () => {
    mount([blue("a", "1"), blue("b", "2")]);
    await screen.findByText("1 to check");
    await nextFrame();
    fireEvent.click(button("Save & next (Enter)"));
    await waitFor(() => expect(url()).toContain("tidy=b"));
    await nextFrame();
    expect(document.activeElement?.textContent).toContain("#2");
  });

  it("returns to the dialog when an answer unmounts the focused button, and Enter then saves", async () => {
    // Pink for the team, answered on the tile: the card is saveable once the
    // stub's answer lands, so use a blue card (nothing pink) for the Enter.
    teamCallsAnswered = false;
    mount([blue("a", "1"), blue("b", "2")]);
    const answer = await screen.findByRole("button", { name: "No team on this card" });
    await nextFrame();
    act(() => answer.focus());
    expect(document.activeElement).toBe(answer);

    fireEvent.click(answer);
    // The pressed button is gone; the browser would leave focus on <body>.
    expect(screen.queryByRole("button", { name: "No team on this card" })).toBeNull();
    await nextFrame();

    const dialog = screen.getByRole("dialog");
    expect(document.activeElement).not.toBe(document.body);
    expect(dialog.contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(document.activeElement as Element, { key: "Enter" });
    await waitFor(() => expect(markReviewed).toHaveBeenCalledTimes(1));
  });

  it("S1: after an answer with nothing pink left, focus is on Save & next, and Enter there saves and advances", async () => {
    mount([blue("a", "1"), blue("b", "2")]);
    const answer = await screen.findByRole("button", { name: "No team on this card" });
    await nextFrame();
    act(() => answer.focus());
    fireEvent.click(answer);
    await nextFrame();
    const save = button("Save & next (Enter)");
    expect(document.activeElement).toBe(save);
    // Enter on a focused button is the button's own click: the card saves and
    // the walk moves on, and the answer is not undone on the way.
    fireEvent.click(save);
    await waitFor(() => expect(markReviewed).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(url()).toBe("?tidy=b"));
    expect(screen.queryByRole("button", { name: /^Change/ })).toBeNull();
  });

  it("S1: the walk's Enter on that focused Save & next does not also act as a second save", async () => {
    mount([blue("a", "1"), blue("b", "2")]);
    const answer = await screen.findByRole("button", { name: "No team on this card" });
    await nextFrame();
    act(() => answer.focus());
    fireEvent.click(answer);
    await nextFrame();
    // A button owns Enter: the dialog's key handler leaves it to the click.
    fireEvent.keyDown(document.activeElement as Element, { key: "Enter" });
    expect(markReviewed).not.toHaveBeenCalled();
  });

  it("S1: with something still pink, focus goes to the first control of the first pink tile", async () => {
    playerLevel = "fix";
    mount([pink("a", "1"), pink("b", "2")]);
    const answer = await screen.findByRole("button", { name: "No team on this card" });
    await nextFrame();
    act(() => answer.focus());
    fireEvent.click(answer);
    await nextFrame();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Player control" }));
  });

  it("Esc still means Save for later after the focused button unmounts", async () => {
    const { onClose } = mount([blue("a", "1")]);
    const answer = await screen.findByRole("button", { name: "No team on this card" });
    await nextFrame();
    act(() => answer.focus());
    fireEvent.click(answer);
    await nextFrame();
    fireEvent.keyDown(document.activeElement as Element, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not take focus from a field being typed in", async () => {
    mount([blue("a", "1")]);
    const answer = await screen.findByRole("button", { name: "No team on this card" });
    await nextFrame();
    const field = document.createElement("input");
    field.setAttribute("aria-label", "A field on the card");
    screen.getByTestId("tile-title").appendChild(field);
    act(() => field.focus());
    fireEvent.click(answer);
    await nextFrame();
    expect(document.activeElement).toBe(field);
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
    // A pink card still needs the operator, so the line does not say there is nothing to do.
    expect(await screen.findByText("Still looking up teams for 1 card.")).toBeTruthy();
    expect(screen.queryByText(/Nothing for you to do yet/)).toBeNull();
    expect(screen.queryByText(/skipped/)).toBeNull();
  });

  it("keeps 'Nothing for you to do yet.' when no card needs the operator", async () => {
    const waiting = {
      _id: "w",
      cardNumber: "9",
      cardName: "X",
      playerIds: ["p1"],
      teamOnCardIds: [],
      platformData: { bsc: { ref: "r" } },
    } as unknown as CardChecklistRow;
    mount([waiting], { search: "?tidy=done" });
    expect(await screen.findByText("Still looking up teams for 1 card. Nothing for you to do yet.")).toBeTruthy();
  });

  it("holds one status line for the whole sitting, empty until the end screen says something", async () => {
    mount([pink("a", "1")]);
    await screen.findByTestId("tile-player");
    const statuses = screen.getAllByRole("status");
    const verdict = statuses.find((el) => el.className.includes("mb-2"));
    expect(verdict?.textContent).toBe("");
    fireEvent.click(button("Skip: not ready to list"));
    await waitFor(() => expect(url()).toBe("?tidy=done"));
    // The same element that was on the page all along.
    expect(verdict?.isConnected).toBe(true);
    expect(verdict?.textContent).toBe("1 card skipped, not ready to list");
  });

  it("tallies the sitting: cards that left the walk are fixed, the rest are skipped", async () => {
    const cards = [blue("a", "1"), pink("b", "2")];
    const tree = (rows: CardChecklistRow[]) => (
      <MemoryRouter initialEntries={["/?tidy=first"]}>
        <UrlProbe />
        <TidyUpWalk
          leafId={LEAF}
          setName="2024 Topps Chrome"
          title="Tidy up 2024 Topps Chrome"
          cards={rows}
          onClose={vi.fn()}
        />
      </MemoryRouter>
    );
    const view = render(tree(cards));
    await waitFor(() => expect(url()).toBe("?tidy=a"));
    fireEvent.click(button("Save & next (Enter)"));
    await waitFor(() => expect(url()).toBe("?tidy=b"));
    // The saved card now needs nobody; the other is skipped and stays flagged.
    view.rerender(tree([{ ...blue("a", "1"), listingTitleTruncated: false } as CardChecklistRow, cards[1]]));
    fireEvent.click(button("Skip: not ready to list"));
    await waitFor(() => expect(url()).toBe("?tidy=done"));
    expect(await screen.findByText("1 card fixed, 1 skipped.")).toBeTruthy();
    // The verdict stays the status line; the tally is its own sentence, named by the focus group.
    expect(screen.getByText("1 card skipped, not ready to list").getAttribute("role")).toBe("status");
    const group = document.querySelector('[role="group"][aria-labelledby]') as HTMLElement;
    expect(group.getAttribute("aria-labelledby")).toContain(screen.getByText("1 card fixed, 1 skipped.").id);
  });

  it("says nothing of a tally on a walk that opened on the end screen", async () => {
    mount([], { search: "?tidy=done" });
    await screen.findByText("All tidy. Nothing on this checklist needs you.");
    expect(screen.queryByText(/fixed/)).toBeNull();
  });

  it("names the end screen's focus group by what it says", async () => {
    mount([], { search: "?tidy=done" });
    await screen.findByText("All tidy. Nothing on this checklist needs you.");
    await nextFrame();
    const group = document.activeElement as HTMLElement;
    expect(group.getAttribute("role")).toBe("group");
    expect(group.getAttribute("aria-labelledby")).toContain(
      screen.getByText("All tidy. Nothing on this checklist needs you.").id,
    );
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

describe("the end screen: Review the skipped (NEO-645 audit)", () => {
  const skipAll = async (cards: CardChecklistRow[]) => {
    mount(cards);
    await waitFor(() => expect(url()).toBe(`?tidy=${cards[0]._id}`));
    for (let i = 0; i < cards.length; i++) fireEvent.click(button("Skip: not ready to list"));
    await waitFor(() => expect(url()).toBe("?tidy=done"));
  };

  it("words the button by how many were skipped", () => {
    expect(reviewSkippedLabel(1)).toBe("Review the skipped card");
    expect(reviewSkippedLabel(2)).toBe("Review the 2 skipped");
    expect(reviewSkippedLabel(31)).toBe("Review the 31 skipped");
  });

  it("is beside Done when cards were skipped, after Back and before Done in the footer", async () => {
    await skipAll([pink("a", "1"), pink("b", "2")]);
    const review = button("Review the 2 skipped");
    const done = button("Done (Esc)");
    expect(review.compareDocumentPosition(done) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(review.parentElement).toBe(done.parentElement);
  });

  it("is not there when nothing was skipped", async () => {
    mount([], { search: "?tidy=done" });
    await screen.findByText("All tidy. Nothing on this checklist needs you.");
    expect(screen.queryByRole("button", { name: /^Review the/ })).toBeNull();
  });

  it("goes back to the first skipped card, in walk order, as a history step, and offers them all again", async () => {
    await skipAll([pink("a", "1"), pink("b", "2"), pink("c", "3")]);
    expect(screen.getByText("3 cards skipped, not ready to list")).toBeTruthy();
    fireEvent.click(button("Review the 3 skipped"));
    await waitFor(() => expect(url()).toBe("?tidy=a"));
    // Offered again: the bar and the count start over for the skipped ones.
    expect(screen.getByText("3 cards left")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Review the/ })).toBeNull();
    // Skipping through them again lands on the end screen with the same count.
    for (let i = 0; i < 3; i++) fireEvent.click(button("Skip: not ready to list"));
    await waitFor(() => expect(url()).toBe("?tidy=done"));
    expect(screen.getByText("3 cards skipped, not ready to list")).toBeTruthy();
  });

  it("Back from the review returns to the same end screen: the button and the tally are as they were", async () => {
    await skipAll([pink("a", "1"), pink("b", "2"), pink("c", "3")]);
    expect(screen.getByText("0 cards fixed, 3 skipped.")).toBeTruthy();
    fireEvent.click(button("Review the 3 skipped"));
    await waitFor(() => expect(url()).toBe("?tidy=a"));
    fireEvent.click(button("Back"));
    await waitFor(() => expect(url()).toBe("?tidy=done"));
    expect(screen.getByRole("button", { name: "Review the 3 skipped" })).toBeTruthy();
    expect(screen.getByText("0 cards fixed, 3 skipped.")).toBeTruthy();
    expect(screen.getByText("3 cards skipped, not ready to list")).toBeTruthy();
    expect(screen.getByText("No cards left")).toBeTruthy();
  });

  it("Back after reviewing part of the skipped still shows every skipped card on the end screen", async () => {
    await skipAll([pink("a", "1"), pink("b", "2")]);
    fireEvent.click(button("Review the 2 skipped"));
    await waitFor(() => expect(url()).toBe("?tidy=a"));
    fireEvent.click(button("Skip: not ready to list"));
    await waitFor(() => expect(url()).toBe("?tidy=b"));
    expect(screen.getByText("1 card left")).toBeTruthy();
    fireEvent.click(button("Skip: not ready to list"));
    await waitFor(() => expect(url()).toBe("?tidy=done"));
    expect(screen.getByRole("button", { name: "Review the 2 skipped" })).toBeTruthy();
  });

  it("brings back only the skipped ones: a card that was fixed stays counted as fixed", async () => {
    const cards = [blue("a", "1"), pink("b", "2")];
    const tree = (rows: CardChecklistRow[]) => (
      <MemoryRouter initialEntries={["/?tidy=first"]}>
        <UrlProbe />
        <TidyUpWalk
          leafId={LEAF}
          setName="2024 Topps Chrome"
          title="Tidy up 2024 Topps Chrome"
          cards={rows}
          onClose={vi.fn()}
        />
      </MemoryRouter>
    );
    const view = render(tree(cards));
    await waitFor(() => expect(url()).toBe("?tidy=a"));
    fireEvent.click(button("Save & next (Enter)"));
    await waitFor(() => expect(url()).toBe("?tidy=b"));
    view.rerender(tree([{ ...blue("a", "1"), listingTitleTruncated: false } as CardChecklistRow, cards[1]]));
    fireEvent.click(button("Skip: not ready to list"));
    await waitFor(() => expect(url()).toBe("?tidy=done"));
    fireEvent.click(button("Review the skipped card"));
    await waitFor(() => expect(url()).toBe("?tidy=b"));
    expect(screen.getByText("1 card left")).toBeTruthy();
    fireEvent.click(button("Skip: not ready to list"));
    await waitFor(() => expect(url()).toBe("?tidy=done"));
    expect(await screen.findByText("1 card fixed, 1 skipped.")).toBeTruthy();
  });
});

describe("handing focus back when the walk closes", () => {
  it("asks for the target at close time: the pill when it is there then, else Sync", async () => {
    const sync = document.createElement("button");
    sync.textContent = "Sync";
    const pill = document.createElement("button");
    pill.textContent = "1 needs you";
    document.body.append(sync);
    let pillThere = false;
    const restoreFocusRef = {
      get current() {
        return pillThere ? pill : sync;
      },
    } as React.RefObject<HTMLElement | null>;
    const onClose = vi.fn();
    const { unmount } = render(
      <MemoryRouter initialEntries={["/?tidy=first"]}>
        <TidyUpWalk
          leafId={LEAF}
          setName="2024 Topps Chrome"
          cards={[blue("a", "1")]}
          restoreFocusRef={restoreFocusRef}
          onClose={onClose}
        />
      </MemoryRouter>,
    );
    await screen.findByText("1 to check");
    // The pill appears while the walk is open (cards still need someone).
    document.body.append(pill);
    pillThere = true;
    unmount();
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    });
    expect(document.activeElement).toBe(pill);
    pill.remove();
    sync.remove();
  });
});

describe("Add all new players, in the walk's header area (decision 32)", () => {
  const offered = (...names: string[]) => ({
    names: names.map((name, i) => ({ name, cardNumbers: [String(i + 1)], moreCards: false })),
    more: false,
  });

  beforeEach(() => {
    convexQuery.mockReset();
    convexQuery.mockResolvedValue({ names: [], more: false });
  });

  it("is not there when fewer than two names are offered", async () => {
    convexQuery.mockResolvedValue(offered("Quinn Rookie"));
    mount([pink("a", "1")]);
    await screen.findByTestId("tile-player");
    await waitFor(() => expect(convexQuery).toHaveBeenCalled());
    await nextFrame();
    expect(screen.queryByRole("button", { name: /^Add all/ })).toBeNull();
  });

  it("shows above the card for two or more, and asks the server about this checklist", async () => {
    convexQuery.mockResolvedValue(offered("Quinn Rookie", "Abe Rookie"));
    mount([pink("a", "1")]);
    const control = await screen.findByRole("button", { name: "Add all 2 new players" });
    expect(convexQuery).toHaveBeenCalledWith("newPlayerNames", { leafId: LEAF });
    // Header area: before the first tile in the page.
    const tile = screen.getByTestId("tile-sources");
    expect(control.compareDocumentPosition(tile) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("Esc closes its confirm first, and only then means Save for later", async () => {
    convexQuery.mockResolvedValue(offered("Quinn Rookie", "Abe Rookie"));
    const { onClose } = mount([pink("a", "1")]);
    fireEvent.click(await screen.findByRole("button", { name: "Add all 2 new players" }));
    const group = await screen.findByRole("group", { name: "New players to add" });
    await nextFrame();
    fireEvent.keyDown(document.activeElement ?? group, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("group", { name: "New players to add" })).toBeNull());
    expect(onClose).not.toHaveBeenCalled();
    await nextFrame();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Enter with the confirm open is not Save & next", async () => {
    convexQuery.mockResolvedValue(offered("Quinn Rookie", "Abe Rookie"));
    mount([blue("a", "1")]);
    fireEvent.click(await screen.findByRole("button", { name: "Add all 2 new players" }));
    await screen.findByRole("group", { name: "New players to add" });
    await nextFrame();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Enter" });
    expect(markReviewed).not.toHaveBeenCalled();
  });

  it("asks again when a card's waiting names change", async () => {
    convexQuery.mockResolvedValue(offered("Quinn Rookie", "Abe Rookie"));
    const first = [pink("a", "1", { pendingPlayerNames: ["Quinn Rookie", "Abe Rookie"] })];
    const { rerender } = mount(first);
    await screen.findByRole("button", { name: "Add all 2 new players" });
    const calls = convexQuery.mock.calls.length;
    rerender(
      <MemoryRouter initialEntries={["/?tidy=a"]}>
        <UrlProbe />
        <TidyUpWalk
          leafId={LEAF}
          setName="2024 Topps Chrome"
          title="Tidy up 2024 Topps Chrome"
          cards={[pink("a", "1", { pendingPlayerNames: ["Abe Rookie"] })]}
          onClose={vi.fn()}
        />
      </MemoryRouter>,
    );
    await waitFor(() => expect(convexQuery.mock.calls.length).toBeGreaterThan(calls));
  });
});

describe("Add all new players, in the walk's chrome (NEO-645 audit)", () => {
  const offered = (...names: string[]) => ({
    names: names.map((name, i) => ({ name, cardNumbers: [String(i + 1)], moreCards: false })),
    more: false,
  });

  beforeEach(() => {
    convexQuery.mockReset();
    convexQuery.mockResolvedValue({ names: [], more: false });
  });

  it("the control is on the title bar, in the header above the progress bar, not in the scrolling area", async () => {
    convexQuery.mockResolvedValue(offered("Quinn Rookie", "Abe Rookie"));
    mount([pink("a", "1")]);
    const control = await screen.findByRole("button", { name: "Add all 2 new players" });
    const header = control.closest("header");
    expect(header).not.toBeNull();
    expect(header?.querySelector('[role="progressbar"]')).not.toBeNull();
    // On the same row as the subtitle ("1 card left"), which keeps its room.
    const subtitle = screen.getByText("1 card left");
    expect(subtitle.parentElement).toBe(control.closest("div.flex.min-h-7"));
  });

  it("the row it sits in is the same height with or without the control, so nothing moves when it settles", async () => {
    mount([pink("a", "1")]);
    await screen.findByTestId("tile-player");
    const before = screen.getByText("1 card left").parentElement!;
    expect(before.className).toContain("min-h-7");
    expect(screen.queryByRole("button", { name: /^Add all/ })).toBeNull();
  });

  it("its confirm opens at the top of the scrolling area, under the chrome, and is what the control controls", async () => {
    convexQuery.mockResolvedValue(offered("Quinn Rookie", "Abe Rookie"));
    mount([pink("a", "1")]);
    const control = await screen.findByRole("button", { name: "Add all 2 new players" });
    fireEvent.click(control);
    const group = await screen.findByRole("group", { name: "New players to add" });
    expect(control.getAttribute("aria-expanded")).toBe("true");
    expect(control.getAttribute("aria-controls")).toBe(group.id);
    expect(group.closest("header")).toBeNull();
    // Before the card's first tile; the dialog still holds both.
    const tile = screen.getByTestId("tile-sources");
    expect(group.compareDocumentPosition(tile) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("dialog").contains(group)).toBe(true);
    expect(screen.getByRole("dialog").contains(control)).toBe(true);
  });
});

describe("the walk's own surface (NEO-645 audit)", () => {
  it("marks its panel so a coarse pointer gets size-2 buttons there and only there", async () => {
    mount([pink("a", "1")]);
    await screen.findByTestId("tile-player");
    const panel = screen.getByRole("dialog").firstElementChild as HTMLElement;
    expect(panel.className).toContain("tidy-walk");
  });

  it("the programmatic focus targets show the house focus ring, not none", async () => {
    mount([pink("a", "1")], { search: "?tidy=a" });
    await screen.findByTestId("tile-player");
    await nextFrame();
    const header = document.activeElement as HTMLElement;
    expect(header.getAttribute("role")).toBe("group");
    expect(header.className).toContain("focus-outline");
    expect(header.className).not.toContain("outline-none");
  });

  it("the end screen's focus group does too", async () => {
    mount([], { search: "?tidy=done" });
    await screen.findByText("All tidy. Nothing on this checklist needs you.");
    await nextFrame();
    const group = document.activeElement as HTMLElement;
    expect(group.className).toContain("focus-outline");
    expect(group.className).not.toContain("outline-none");
  });
});

