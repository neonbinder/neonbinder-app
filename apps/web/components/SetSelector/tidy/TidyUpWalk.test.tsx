/**
 * NEO-645 — the walk's footer, keys, order and end screen.
 *
 * The tiles and the card face are other builders' files and have their own
 * tests: here each is a stub, and one of them registers an inline part so the
 * Escape ordering can be driven. Router, URL, history and the sitting are real.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement, useEffect, useRef, useState } from "react";
import { MemoryRouter, useLocation, useSearchParams } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../convex/_generated/api", () => ({
  api: {
    tidyCards: { cardContext: "cardContext", saveCard: "saveCard" },
    selectorOptions: { updateCard: "updateCard", tidyLeafFacts: "tidyLeafFacts" },
    adapters: { wikidata: { lookupTidyName: "lookupTidyName" } },
    drillPath: { resolveDrillPath: "resolveDrillPath" },
  },
}));

// Nothing in the walk asks the server on demand; any call that does lands here.
const { convexQuery } = vi.hoisted(() => ({ convexQuery: vi.fn(async (): Promise<unknown> => undefined) }));

const saveCard = vi.fn();
const updateCard = vi.fn();
const tidyLeafFacts = vi.fn(async (): Promise<unknown> => ({ gateItems: [] }));
const lookupTidyName = vi.fn(async (): Promise<unknown> => ({ status: "ready" }));

vi.mock("convex/react", () => ({
  useQuery: (ref: string, args: unknown) => {
    if (args === "skip") return undefined;
    // The drill hook above the walk (NEO-645 race test): every id in the URL is real.
    if (ref === "resolveDrillPath") return (args as { ids: string[] }).ids.map((_id) => ({ _id }));
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
  useMutation: (ref: string) =>
    ref === "saveCard" ? saveCard : ref === "updateCard" ? updateCard : vi.fn(),
  useAction: (ref: string) =>
    ref === "tidyLeafFacts" ? tidyLeafFacts : ref === "lookupTidyName" ? lookupTidyName : vi.fn(),
  useConvex: () => ({ query: convexQuery }),
}));

vi.mock("./TidyCardFace", () => ({ default: () => <div data-testid="face" /> }));
vi.mock("./tiles/SourcesDisagreeTile", () => ({ default: () => <div data-testid="tile-sources" /> }));
// A tile's level is what the walk's "next pink tile" reads off the page.
let playerLevel: "fix" | "plain" = "plain";
// What the pink tile's first control is, and when it arrives: `late` mounts it
// after the card is shown (a tile whose controls wait for the card's context).
let playerControl: "button" | "combobox" = "button";
let playerControlLate = false;
const comboboxFocus = { quiet: null as boolean | null };
// Off, the stub team tile answers without telling the walk: the focus repair for
// a tile that has not been taught to (an unmounted button must not strand focus).
let teamCallsAnswered = true;
vi.mock("./tiles/PlayerTile", () => ({
  default: function PlayerTile() {
    const [ready, setReady] = useState(!playerControlLate);
    useEffect(() => {
      if (ready) return;
      const t = setTimeout(() => setReady(true), 60);
      return () => clearTimeout(t);
    }, [ready]);
    return (
      <section data-testid="tile-player" data-tidy-level={playerLevel}>
        {ready &&
          (playerControl === "combobox" ? (
            createElement("input", {
              role: "combobox",
              "aria-label": "Find a player",
              defaultValue: "Mike Trout",
              onFocus: (e: { currentTarget: HTMLElement }) => {
                comboboxFocus.quiet = e.currentTarget.hasAttribute("data-quiet-focus");
              },
            })
          ) : (
            <button type="button">Player control</button>
          ))}
      </section>
    );
  },
}));
// The real Card name tile when a test asks for it, the stub otherwise.
let realCardName = false;
vi.mock("./tiles/CardNameTile", async () => {
  const actual = await vi.importActual<typeof import("./tiles/CardNameTile")>("./tiles/CardNameTile");
  return {
    default: (props: React.ComponentProps<typeof actual.default>) =>
      realCardName ? <actual.default {...props} /> : <div data-testid="tile-card-name" />,
  };
});
// NEO-657: a tile's before-save hook, when a test sets one (the open "+ Add stint" form's).
let careerBeforeSave: ((wrote: (playerId: string) => void) => Promise<boolean>) | null = null;
vi.mock("./tiles/CareerTile", async () => {
  const { useBeforeSave } = await import("./before-save");
  return {
    default: function CareerTile() {
      useBeforeSave(careerBeforeSave !== null, (wrote) => careerBeforeSave!(wrote));
      return <div data-testid="tile-career" />;
    },
  };
});
vi.mock("./tiles/TeamTile", async () => {
  const { useAnswered } = await import("./answered");
  return {
    // The shape of "No team on this card": the pressed button leaves the page,
    // and the tile says it was answered (what every real tile does).
    default: function TeamTile({ setNoTeam }: { setNoTeam?: boolean }) {
      const [answered, setAnswered] = useState(false);
      const onAnswered = useAnswered();
      return (
        <div data-testid="tile-team" data-set-no-team={setNoTeam ? "yes" : "no"}>
          {answered ? (
            <p>No team on this card: saved</p>
          ) : (
            <button
              type="button"
              onClick={() => {
                setAnswered(true);
                if (teamCallsAnswered) onAnswered("Saved Padres.");
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

import TidyUpWalk, { checkStillToCheckLabel, mustFixLine, reviewButtonLabel, reviewSkippedLabel } from "./TidyUpWalk";
import { useDrillUrlState } from "../useDrillUrlState";
import { useTidyWalkUrl } from "./useTidyWalkUrl";
import { forgetSearchWrite } from "../live-search-params";
import { resetSitting } from "./walk-order";
import { deriveCardAttention } from "../card-attention";
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

/**
 * Blue by a live career gap: one player, one team, nothing else wrong. The gap
 * itself is data the walk is handed (`careerGaps`, read live), never stored.
 */
const gapCard = (id: string, number: string) =>
  ({
    _id: id,
    cardNumber: number,
    cardName: "Mike Trout",
    playerIds: ["p1"],
    teamOnCardIds: ["t1"],
  }) as unknown as CardChecklistRow;
const GAP = { playerId: "p1", teamId: "t1" };
const gapsFor = (...ids: string[]) => new Map(ids.map((id) => [id, [GAP]]));

function UrlProbe() {
  const location = useLocation();
  return <output data-testid="url">{location.search}</output>;
}

function mount(
  cards: CardChecklistRow[],
  opts: {
    search?: string;
    onClose?: () => void;
    setNoTeam?: boolean;
    careerGaps?: ReadonlyMap<string, readonly { playerId: string; teamId: string }[]>;
    careerGapsReady?: boolean;
    sportId?: string;
  } = {},
) {
  const onClose = opts.onClose ?? vi.fn();
  const tree = (o: typeof opts) => (
    <MemoryRouter initialEntries={[`/${opts.search ?? "?tidy=first"}`]}>
      <UrlProbe />
      <TidyUpWalk
        leafId={LEAF}
        {...(opts.sportId ? { sportId: opts.sportId as never } : {})}
        setName="2024 Topps Chrome"
        title="Tidy up 2024 Topps Chrome"
        cards={cards}
        onClose={onClose}
        {...(o.careerGaps ? { careerGaps: o.careerGaps } : {})}
        {...(o.careerGapsReady !== undefined ? { careerGapsReady: o.careerGapsReady } : {})}
        {...(opts.setNoTeam !== undefined ? { setNoTeam: opts.setNoTeam } : {})}
      />
    </MemoryRouter>
  );
  const view = render(tree(opts));
  return { onClose, ...view, rerenderWith: (o: typeof opts) => view.rerender(tree({ ...opts, ...o })) };
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
  saveCard.mockReset();
  saveCard.mockResolvedValue({ keys: [] });
  tidyLeafFacts.mockClear();
  lookupTidyName.mockClear();
  playerLevel = "plain";
  playerControl = "button";
  playerControlLate = false;
  comboboxFocus.quiet = null;
  realCardName = false;
  updateCard.mockReset();
  teamCallsAnswered = true;
  careerBeforeSave = null;
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

  it("names the dialog, counts the cards left and prints the header; the pink count lives in the footer line only", async () => {
    mount([pink("a", "38b", { cardVariation: "Image Variation" }), blue("b", "40")]);
    await screen.findByRole("group", { name: "#38b · Image Variation · Mike Trout" });
    expect(screen.getByRole("dialog", { name: "Tidy up 2024 Topps Chrome" })).toBeTruthy();
    expect(screen.getByText("2 cards left")).toBeTruthy();
    // T7: no "1 to fix" under the header; the footer's status line says it (and describes Save).
    expect(screen.queryByText("1 to fix")).toBeNull();
    expect(screen.getByText(/^1 to fix before this card can save\./)).toBeTruthy();
    expect(screen.getByTestId("face")).toBeTruthy();
  });

  it("prints no count of cards to check under the header either: the blue tiles say what to check", async () => {
    mount([blue("a", "1")]);
    const group = await screen.findByRole("group", { name: "#1 · Mike Trout" });
    expect(screen.queryByText(/to check/)).toBeNull();
    expect(screen.queryByText(/to fix/)).toBeNull();
    expect(group.querySelectorAll("p")).toHaveLength(1);
  });

  it("mounts the tiles in the contract order", async () => {
    mount([pink("a", "1")]);
    await screen.findByTestId("tile-sources");
    const ids = screen.getAllByTestId(/^tile-/).map((el) => el.getAttribute("data-testid"));
    expect(ids).toEqual([
      "tile-sources",
      "tile-player",
      "tile-card-name",
      "tile-career",
      "tile-team",
      "tile-autograph",
      "tile-title",
      "tile-more",
    ]);
  });
});

describe("the set's own No Team (NEO-639, decision A)", () => {
  it("reaches the Team tile when the checklist says so", async () => {
    mount([pink("a", "1")], { setNoTeam: true });
    expect((await screen.findByTestId("tile-team")).getAttribute("data-set-no-team")).toBe("yes");
  });

  it("is not told to the Team tile otherwise", async () => {
    mount([pink("a", "1")]);
    expect((await screen.findByTestId("tile-team")).getAttribute("data-set-no-team")).toBe("no");
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
    expect(saveCard).not.toHaveBeenCalled();
    expect(button("Skip: not ready to list").getAttribute("aria-disabled")).toBeNull();
  });

  it("Skip moves on with no write, and the end screen counts the skipped card", async () => {
    mount([pink("a", "1")]);
    await screen.findByTestId("tile-player");
    fireEvent.click(button("Skip: not ready to list"));
    await waitFor(() => expect(url()).toBe("?tidy=done"));
    expect(saveCard).not.toHaveBeenCalled();
    expect(screen.getByText("1 card skipped, not ready to list")).toBeTruthy();
    expect(button("Done (Esc)")).toBeTruthy();
  });

  it("Save & next adds the default stint for each career gap shown (saveCard), then moves to the next card", async () => {
    mount([gapCard("a", "1"), pink("b", "2")], { careerGaps: gapsFor("a") });
    await screen.findByTestId("tile-team");
    fireEvent.click(button("Save & next (Enter)"));
    await waitFor(() => expect(url()).toBe("?tidy=b"));
    expect(saveCard).toHaveBeenCalledWith({ cardId: "a", gaps: [GAP] });
  });

  it("Save & next moves to the next card that still needs you after the stint lands: the same player's other cards it cleared are skipped", async () => {
    // a, b and c are the same player and club: one default stint clears all three gaps.
    const cards = [gapCard("a", "1"), gapCard("b", "2"), gapCard("c", "3"), pink("d", "4")];
    const gaps = gapsFor("a", "b", "c");
    const view = mount(cards, { careerGaps: gaps });
    await screen.findByTestId("tile-team");
    saveCard.mockImplementationOnce(async () => {
      // The write lands: the live gaps are now empty for every card of that player.
      view.rerender(
        <MemoryRouter initialEntries={["/?tidy=a"]}>
          <UrlProbe />
          <TidyUpWalk
            leafId={LEAF}
            setName="2024 Topps Chrome"
            title="Tidy up 2024 Topps Chrome"
            cards={cards}
            onClose={vi.fn()}
            careerGaps={new Map()}
          />
        </MemoryRouter>,
      );
      return { keys: [] };
    });
    fireEvent.click(button("Save & next (Enter)"));
    await waitFor(() => expect(url()).toBe("?tidy=d"));
  });

  it("holds Save & next while the career question is in flight, so a gap not shown yet is never saved without its stint", async () => {
    const view = mount([gapCard("a", "1"), pink("b", "2")], { careerGaps: gapsFor("a") });
    await screen.findByTestId("tile-team");
    view.rerenderWith({ careerGapsReady: false });
    const save = button("Save & next (Enter)");
    expect(save.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(save);
    expect(saveCard).not.toHaveBeenCalled();
    expect(url()).toBe("?tidy=a");
    view.rerenderWith({ careerGaps: gapsFor("a"), careerGapsReady: true });
    await waitFor(() => expect(button("Save & next (Enter)").getAttribute("aria-disabled")).toBeNull());
    fireEvent.click(button("Save & next (Enter)"));
    await waitFor(() => expect(saveCard).toHaveBeenCalledWith({ cardId: "a", gaps: [GAP] }));
  });

  it("Save & next on a blue card with no career gap writes nothing: nothing records that it was seen", async () => {
    mount([blue("a", "1"), pink("b", "2")]);
    await screen.findByTestId("tile-team");
    fireEvent.click(button("Save & next (Enter)"));
    await waitFor(() => expect(url()).toBe("?tidy=b"));
    expect(saveCard).not.toHaveBeenCalled();
  });

  it("shows `Didn't save, try again` and stays on the card when the write fails", async () => {
    saveCard.mockRejectedValueOnce(new Error("nope"));
    mount([gapCard("a", "1"), pink("b", "2")], { careerGaps: gapsFor("a") });
    await screen.findByTestId("tile-team");
    fireEvent.click(button("Save & next (Enter)"));
    expect((await screen.findByRole("alert")).textContent).toBe("Didn't save, try again");
    expect(url()).toBe("?tidy=a");
    // Retry works.
    fireEvent.click(button("Save & next (Enter)"));
    await waitFor(() => expect(url()).toBe("?tidy=b"));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("NEO-657: Save & next runs a tile's before-save hook first, then saves the card's career gaps", async () => {
    const order: string[] = [];
    careerBeforeSave = vi.fn(async () => {
      order.push("hook");
      return true;
    });
    saveCard.mockImplementation(async () => {
      order.push("saveCard");
      return { keys: [] };
    });
    mount([gapCard("a", "1"), pink("b", "2")], { careerGaps: gapsFor("a") });
    await screen.findByTestId("tile-team");
    fireEvent.click(button("Save & next (Enter)"));
    await waitFor(() => expect(url()).toBe("?tidy=b"));
    expect(order).toEqual(["hook", "saveCard"]);
  });

  it("NEO-657: a gap player the before-save hook wrote a stint to is not given the default stint on top of it", async () => {
    // The open form was edited to another team: its stint is the one written.
    careerBeforeSave = vi.fn(async (wrote) => {
      wrote(GAP.playerId);
      return true;
    });
    mount([gapCard("a", "1"), pink("b", "2")], { careerGaps: gapsFor("a") });
    await screen.findByTestId("tile-team");
    fireEvent.click(button("Save & next (Enter)"));
    await waitFor(() => expect(url()).toBe("?tidy=b"));
    expect(saveCard).not.toHaveBeenCalled();
  });

  it("NEO-657: a hook that wrote for one player leaves the other gaps' default stints to saveCard", async () => {
    careerBeforeSave = vi.fn(async (wrote) => {
      wrote("other-player");
      return true;
    });
    mount([gapCard("a", "1"), pink("b", "2")], { careerGaps: gapsFor("a") });
    await screen.findByTestId("tile-team");
    fireEvent.click(button("Save & next (Enter)"));
    await waitFor(() => expect(url()).toBe("?tidy=b"));
    expect(saveCard).toHaveBeenCalledWith({ cardId: "a", gaps: [GAP] });
  });

  it("NEO-657: a before-save hook that reports false holds the card, with the save-failed line, and writes nothing", async () => {
    careerBeforeSave = vi.fn(async () => false);
    mount([gapCard("a", "1"), pink("b", "2")], { careerGaps: gapsFor("a") });
    await screen.findByTestId("tile-team");
    fireEvent.click(button("Save & next (Enter)"));
    expect((await screen.findByRole("alert")).textContent).toBe("Didn't save, try again");
    expect(saveCard).not.toHaveBeenCalled();
    expect(url()).toBe("?tidy=a");
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
    saveCard.mockReturnValueOnce(new Promise((r) => (finish = r)));
    mount([gapCard("a", "1"), gapCard("b", "2")], { careerGaps: gapsFor("a", "b") });
    await screen.findByTestId("tile-team");
    fireEvent.click(button("Skip: not ready to list"));
    await waitFor(() => expect(url()).toBe("?tidy=b"));
    await screen.findByTestId("tile-team");
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
    expect(group.textContent).not.toContain("to fix");
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
    mount([gapCard("a", "1"), pink("b", "2")], { careerGaps: gapsFor("a") });
    await screen.findByTestId("tile-team");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Enter" });
    await waitFor(() => expect(saveCard).toHaveBeenCalledTimes(1));
  });

  it("Enter does nothing while the card is pink", async () => {
    mount([pink("a", "1")]);
    await screen.findByTestId("tile-player");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Enter" });
    expect(saveCard).not.toHaveBeenCalled();
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
    expect(saveCard).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByText("Editor open")).toBeNull());
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("focus", () => {
  // One rule for every way a card is shown, and for every answer: the first
  // control of the first pink tile, and Save & next when nothing is pink.
  const playerControlButton = () => screen.getByRole("button", { name: "Player control" });

  it("on opening, lands on Save & next when nothing on the card is pink", async () => {
    mount([blue("a", "1")]);
    await screen.findByTestId("tile-team");
    await nextFrame();
    expect(document.activeElement).toBe(button("Save & next (Enter)"));
  });

  it("on opening, lands on the first control of the first pink tile", async () => {
    playerLevel = "fix";
    mount([pink("a", "1")]);
    await screen.findByTestId("tile-team");
    await nextFrame();
    expect(document.activeElement).toBe(playerControlButton());
  });

  it("after Save & next, the next card gets the same rule: Save & next when it is clear, else its first pink control", async () => {
    mount([blue("a", "1"), blue("b", "2")]);
    await screen.findByTestId("tile-team");
    await nextFrame();
    fireEvent.click(button("Save & next (Enter)"));
    await waitFor(() => expect(url()).toContain("tidy=b"));
    await nextFrame();
    expect(document.activeElement).toBe(button("Save & next (Enter)"));
  });

  it("after Save & next onto a pink card, lands on that card's first pink control", async () => {
    mount([blue("a", "1"), pink("b", "2")]);
    await screen.findByTestId("tile-team");
    await nextFrame();
    playerLevel = "fix";
    fireEvent.click(button("Save & next (Enter)"));
    await waitFor(() => expect(url()).toContain("tidy=b"));
    await nextFrame();
    expect(document.activeElement).toBe(playerControlButton());
  });

  it("after Skip and after Back, each card gets the rule again", async () => {
    playerLevel = "fix";
    mount([pink("a", "1"), pink("b", "2")]);
    await screen.findByTestId("tile-team");
    await nextFrame();
    fireEvent.click(button("Skip: not ready to list"));
    await waitFor(() => expect(url()).toBe("?tidy=b"));
    await nextFrame();
    expect(document.activeElement).toBe(playerControlButton());
    fireEvent.click(button("Back"));
    await waitFor(() => expect(url()).toBe("?tidy=a"));
    await nextFrame();
    expect(document.activeElement).toBe(playerControlButton());
  });

  it("a pink tile whose control has not arrived yet holds focus on the header, and the control gets it when it does", async () => {
    playerLevel = "fix";
    playerControlLate = true;
    mount([pink("a", "1")]);
    await screen.findByTestId("tile-team");
    await nextFrame();
    // Something is pink, so Save & next is not the answer; the card header holds focus.
    expect(document.activeElement).not.toBe(button("Save & next (Enter)"));
    expect(document.activeElement?.textContent).toContain("#1");
    await screen.findByRole("button", { name: "Player control" });
    await waitFor(() => expect(document.activeElement).toBe(playerControlButton()));
  });

  it("a control that arrives late does not pull focus from someone who has already moved on", async () => {
    playerLevel = "fix";
    playerControlLate = true;
    mount([pink("a", "1")]);
    await screen.findByTestId("tile-team");
    await nextFrame();
    act(() => button("Back").focus());
    await screen.findByRole("button", { name: "Player control" });
    await nextFrame();
    expect(document.activeElement).toBe(button("Back"));
  });

  it("hands focus to a combobox without opening its list", async () => {
    playerLevel = "fix";
    playerControl = "combobox";
    mount([pink("a", "1")]);
    const box = await screen.findByRole("combobox", { name: "Find a player" });
    await nextFrame();
    expect(document.activeElement).toBe(box);
    expect(comboboxFocus.quiet).toBe(true);
    expect(box.hasAttribute("data-quiet-focus")).toBe(false);
  });

  it("returns to the dialog when an answer unmounts the focused button, on Save & next", async () => {
    // Pink for the team, answered on the tile: the card is saveable once the
    // stub's answer lands, so use a blue card (nothing pink) for the Enter.
    teamCallsAnswered = false;
    mount([gapCard("a", "1"), gapCard("b", "2")], { careerGaps: gapsFor("a", "b") });
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
    // Nothing is pink, so it is Save & next that holds focus (the rule); Enter
    // on a focused button is the button's own click.
    expect(document.activeElement).toBe(button("Save & next (Enter)"));

    fireEvent.click(document.activeElement as Element);
    await waitFor(() => expect(saveCard).toHaveBeenCalledTimes(1));
  });

  it("S1: after an answer with nothing pink left, focus is on Save & next, and Enter there saves and advances", async () => {
    mount([gapCard("a", "1"), gapCard("b", "2")], { careerGaps: gapsFor("a", "b") });
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
    await waitFor(() => expect(saveCard).toHaveBeenCalledTimes(1));
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
    expect(saveCard).not.toHaveBeenCalled();
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

describe("focus: Enter in the Card name tile (NEO-645, Jason 2026-11-23)", () => {
  // Two nameless cards, the real Card name tile, and a card list that changes
  // the way the live query does: the saved name leaves the row, the tile goes.
  const nameless = (id: string, n: string) =>
    ({
      _id: id,
      cardNumber: n,
      cardName: `Card #${n}`,
      playerIds: [],
      teamOnCardIds: ["t1"],
    }) as unknown as CardChecklistRow;

  function Host() {
    const [cards, setCards] = useState<CardChecklistRow[]>([nameless("a", "1"), nameless("b", "2")]);
    updateCard.mockImplementation(async (args: { id: string; cardName: string }) => {
      await Promise.resolve();
      setCards((rows) => rows.map((r) => (r._id === args.id ? { ...r, cardName: args.cardName } : r)));
    });
    return (
      <MemoryRouter initialEntries={["/?tidy=first"]}>
        <UrlProbe />
        <TidyUpWalk
          leafId={LEAF}
          setName="2024 Topps Chrome"
          title="Tidy up 2024 Topps Chrome"
          cards={cards}
          onClose={vi.fn()}
        />
      </MemoryRouter>
    );
  }
  const nameField = () => screen.getByRole("textbox", { name: "Card name" });

  beforeEach(() => {
    realCardName = true;
  });

  it("a card with a nameless card opens with the focus in its Card name box, the first error", async () => {
    render(<Host />);
    const field = await screen.findByRole("textbox", { name: "Card name" });
    await nextFrame();
    expect(document.activeElement).toBe(field);
  });

  it("Enter saves the name in place and focus lands on Save & next; that Enter is neither a second save nor a press of Save & next", async () => {
    render(<Host />);
    const field = await screen.findByRole("textbox", { name: "Card name" });
    await nextFrame();
    fireEvent.change(field, { target: { value: "Checklist" } });
    // fireEvent returns false when the handler called preventDefault: the walk's
    // own key handler (which is Save & next outside a field) never sees this Enter.
    let notPrevented = true;
    await act(async () => {
      notPrevented = fireEvent.keyDown(field, { key: "Enter" });
    });
    expect(notPrevented).toBe(false);
    await nextFrame();
    expect(updateCard).toHaveBeenCalledTimes(1);
    expect(saveCard).not.toHaveBeenCalled();
    expect(url()).toBe("?tidy=a");
    expect(screen.queryByRole("textbox", { name: "Card name" })).toBeNull();
    expect(document.activeElement).toBe(button("Save & next (Enter)"));
    // The walk is still on the same card, saved only once the operator says so.
    expect(saveCard).not.toHaveBeenCalled();
  });

  it("the next card then opens on its own first error, the Card name box, never on a box that was already focused", async () => {
    render(<Host />);
    const field = await screen.findByRole("textbox", { name: "Card name" });
    await nextFrame();
    fireEvent.change(field, { target: { value: "Checklist" } });
    await act(async () => {
      fireEvent.keyDown(field, { key: "Enter" });
    });
    await nextFrame();
    fireEvent.click(button("Save & next (Enter)"));
    await waitFor(() => expect(url()).toBe("?tidy=b"));
    await nextFrame();
    expect(document.activeElement).toBe(nameField());
    expect((nameField() as HTMLInputElement).value).toBe("");
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

  it("says what a team answer saved in its own always-mounted status line, which outlives the tile and is not the alert", async () => {
    mount([pink("a", "1")]);
    await screen.findByTestId("tile-team");
    const line = screen.getAllByRole("status").find((el) => el.className.includes("sr-only"));
    expect(line?.textContent).toBe("");
    fireEvent.click(button("No team on this card"));
    await waitFor(() => expect(line?.textContent).toBe("Saved Padres."));
    // The tile's own button is gone; the line is the same element, still on the page.
    expect(screen.queryByRole("button", { name: "No team on this card" })).toBeNull();
    expect(line?.isConnected).toBe(true);
    expect(screen.queryByRole("alert")).toBeNull();
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

  it("opens on the first pink card when a blue one with a lower number was passed too (C3)", async () => {
    await skipAll([blue("a", "1"), pink("b", "2")]);
    fireEvent.click(button("Review the skipped card"));
    await waitFor(() => expect(url()).toBe("?tidy=b"));
    // The blue card is still offered, after the pink one.
    expect(screen.getByText("2 cards left")).toBeTruthy();
    fireEvent.click(button("Skip: not ready to list"));
    await waitFor(() => expect(url()).toBe("?tidy=a"));
  });

  it("keeps a review through a refresh: no 'No cards left' while cards remain (C6)", async () => {
    const cards = [pink("a", "1"), pink("b", "2")];
    await skipAll(cards);
    fireEvent.click(button("Review the 2 skipped"));
    await waitFor(() => expect(url()).toBe("?tidy=a"));
    expect(screen.getByText("2 cards left")).toBeTruthy();
    cleanup();
    mount(cards, { search: "?tidy=a" });
    await waitFor(() => expect(url()).toBe("?tidy=a"));
    expect(screen.getByText("2 cards left")).toBeTruthy();
    expect(screen.queryByText("No cards left")).toBeNull();
  });

  it("activated by keyboard, it lands focus on the first skipped card's header", async () => {
    await skipAll([pink("a", "1"), pink("b", "2")]);
    const review = button("Review the 2 skipped");
    act(() => review.focus());
    expect(document.activeElement).toBe(review);
    // Enter on a button is the button's own: the walk's key handler leaves it alone.
    fireEvent.keyDown(review, { key: "Enter" });
    expect(url()).toBe("?tidy=done");
    fireEvent.click(review);
    await waitFor(() => expect(url()).toBe("?tidy=a"));
    await screen.findByTestId("tile-player");
    await nextFrame();
    const header = document.activeElement as HTMLElement;
    expect(header).not.toBe(document.body);
    expect(header.getAttribute("role")).toBe("group");
    expect(header.textContent).toContain("#1");
    expect(header.textContent).not.toContain("#2");
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
    await screen.findByTestId("tile-team");
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

describe("no bulk Add all (Jason, 2026-11-22: remove that button)", () => {
  beforeEach(() => convexQuery.mockClear());

  it("the walk's chrome carries no Add all control, and the walk asks the server for no new-player list", async () => {
    mount([pink("a", "1", { pendingPlayerNames: ["Quinn Rookie", "Abe Rookie"] })]);
    await screen.findByTestId("tile-player");
    await nextFrame();
    expect(screen.queryByRole("button", { name: /^Add (all|the first)/ })).toBeNull();
    expect(screen.queryByRole("group", { name: "New players to add" })).toBeNull();
    expect(convexQuery).not.toHaveBeenCalled();
  });

  it("the end screen carries none either", async () => {
    mount([]);
    await screen.findByRole("group");
    expect(screen.queryByRole("button", { name: /^Add (all|the first)/ })).toBeNull();
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


describe("opening the walk beside the drill and other writers (NEO-645: a production-only race)", () => {
  // No StrictMode here, on purpose: production runs every effect once, and the
  // double mount-effects of StrictMode (the dev server) hide the bug.
  const DRILL = "sport=s&year=y&brand=b&set=t&type=v";

  /** The real set builder shape: the drill hook above the checklist that opens the walk. */
  function Page({ cards, extra, after }: { cards: CardChecklistRow[]; extra?: React.ReactNode; after?: React.ReactNode }) {
    useDrillUrlState();
    const tidy = useTidyWalkUrl();
    return (
      <>
        <UrlProbe />
        {extra}
        <button type="button" onClick={tidy.open}>
          Open the walk
        </button>
        {tidy.location.kind !== "closed" && (
          <TidyUpWalk
            leafId={LEAF}
            setName="2024 Topps Chrome"
            title="Tidy up 2024 Topps Chrome"
            cards={cards}
            onClose={vi.fn()}
          />
        )}
        {after}
      </>
    );
  }

  beforeEach(() => forgetSearchWrite());

  it("the real drill and the real walk: opening ends on the first card, not on `first`", async () => {
    render(
      <MemoryRouter initialEntries={[`/?${DRILL}`]}>
        <Page cards={[pink("c10", "10"), pink("c2", "2")]} />
      </MemoryRouter>,
    );
    await act(async () => {});
    fireEvent.click(button("Open the walk"));
    await waitFor(() => expect(url()).toBe(`?${DRILL}&tidy=c2`));
    expect(screen.queryByText("Finding the next card.")).toBeNull();
    await screen.findByTestId("tile-player");
  });

  it("belt and braces: a writer that puts `tidy=first` back in the walk's own flush is resolved again", async () => {
    // A rogue writer, built on the RENDERED params with no live-params protocol
    // (the bug's shape). It sits AFTER the walk, so in the flush where the walk
    // replaces `first` with a card it writes last and restores `first`: the walk
    // never renders the card, its inputs (`needsResolve`, `firstTarget`) do not
    // change, and only watching the URL's `tidy` value gets it out.
    function Rogue() {
      const [params, setParams] = useSearchParams();
      const done = useRef(false);
      useEffect(() => {
        if (done.current || params.get("tidy") !== "first") return;
        done.current = true;
        setParams(new URLSearchParams(params), { replace: true });
      }, [params, setParams]);
      return null;
    }
    render(
      <MemoryRouter initialEntries={[`/?${DRILL}`]}>
        <Page cards={[pink("c10", "10"), pink("c2", "2")]} after={<Rogue />} />
      </MemoryRouter>,
    );
    await act(async () => {});
    fireEvent.click(button("Open the walk"));
    await waitFor(() => expect(url()).toBe(`?${DRILL}&tidy=c2`));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(url()).toBe(`?${DRILL}&tidy=c2`);
    expect(screen.queryByText("Finding the next card.")).toBeNull();
  });

  it("is idempotent: a walk already on a card of the checklist writes nothing more", async () => {
    const writes: string[] = [];
    function Spy() {
      const location = useLocation();
      useEffect(() => {
        writes.push(location.search);
      }, [location]);
      return null;
    }
    render(
      <MemoryRouter initialEntries={[`/?${DRILL}&tidy=c2`]}>
        <Page cards={[pink("c10", "10"), pink("c2", "2")]} extra={<Spy />} />
      </MemoryRouter>,
    );
    await screen.findByTestId("tile-player");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(writes).toEqual([`?${DRILL}&tidy=c2`]);
  });
});

describe("NEO-656: the walk reads live data and keeps nothing", () => {
  it("asks the set's facts once when it opens", async () => {
    mount([pink("a", "1"), pink("b", "2")]);
    await screen.findByTestId("tile-player");
    expect(tidyLeafFacts).toHaveBeenCalledTimes(1);
    expect(tidyLeafFacts).toHaveBeenCalledWith({ selectorOptionId: LEAF });
  });

  it("asks about the open card's pending names, and the next card's, once each, when it opens", async () => {
    mount(
      [
        pink("a", "1", { pendingPlayerNames: ["Mike Trout"], pendingTeamNames: ["Angels"] }),
        pink("b", "2", { pendingPlayerNames: ["Shohei Ohtani"] }),
        pink("c", "3", { pendingPlayerNames: ["Not Yet"] }),
      ],
      { sportId: "sport-1" },
    );
    await screen.findByTestId("tile-player");
    await waitFor(() => expect(lookupTidyName).toHaveBeenCalledTimes(3));
    const asked = lookupTidyName.mock.calls.map((c) => c[0] as { cardId: string; kind: string; name: string });
    expect(asked.map((a) => `${a.cardId}|${a.kind}|${a.name}`).sort()).toEqual([
      "a|player|Mike Trout",
      "a|team|Angels",
      "b|player|Shohei Ohtani",
    ]);
  });

  it("a lookup that errors never blocks the walk or Skip", async () => {
    lookupTidyName.mockRejectedValue(new Error("down"));
    mount([pink("a", "1", { pendingPlayerNames: ["Mike Trout"] })]);
    await screen.findByTestId("tile-player");
    await nextFrame();
    expect(button("Skip: not ready to list").getAttribute("aria-disabled")).toBeNull();
    lookupTidyName.mockResolvedValue({ status: "ready" });
  });

  it("keeps nothing in storage but the sitting's own place", async () => {
    mount([pink("a", "1", { pendingPlayerNames: ["Mike Trout"] })]);
    await screen.findByTestId("tile-player");
    await nextFrame();
    const keys = Object.keys(window.sessionStorage);
    expect(keys.every((k) => k.startsWith("nb:tidy-walk:"))).toBe(true);
    expect(window.localStorage.length).toBe(0);
  });

  it("holds its first card until the live career gaps have answered, so a gap-only card is in the order", async () => {
    const view = mount([gapCard("a", "1")], { careerGapsReady: false });
    await nextFrame();
    expect(url()).toBe("?tidy=first");
    view.unmount();
    mount([gapCard("a", "1")], { careerGaps: gapsFor("a"), careerGapsReady: true });
    await waitFor(() => expect(url()).toBe("?tidy=a"));
  });

  it("the end screen counts a passed card by its live level: pink is skipped, blue alone is still to check", async () => {
    mount([pink("a", "1"), gapCard("b", "2")], { careerGaps: gapsFor("b") });
    await screen.findByTestId("tile-player");
    fireEvent.click(button("Skip: not ready to list"));
    await waitFor(() => expect(url()).toBe("?tidy=b"));
    fireEvent.click(button("Skip: not ready to list"));
    await waitFor(() => expect(url()).toBe("?tidy=done"));
    expect(screen.getByText("1 card skipped, not ready to list")).toBeTruthy();
    expect(screen.getByText("0 cards fixed, 1 skipped, 1 still to check.")).toBeTruthy();
  });

  it("a blue-only passed card says 'still to check', never 'skipped'", async () => {
    mount([gapCard("a", "1")], { careerGaps: gapsFor("a") });
    await screen.findByTestId("tile-team");
    fireEvent.click(button("Skip: not ready to list"));
    await waitFor(() => expect(url()).toBe("?tidy=done"));
    expect(screen.getByText("1 card still to check")).toBeTruthy();
    expect(screen.queryByText(/skipped, not ready to list/)).toBeNull();
    // The review button names what it reviews: no "skipped" beside "0 skipped, 1 still to check".
    expect(button("Check the card still to check")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /skipped/ })).toBeNull();
  });

  it("words the end-screen review button by what remains: pink is skipped, blue alone is still to check", () => {
    expect(checkStillToCheckLabel(1)).toBe("Check the card still to check");
    expect(checkStillToCheckLabel(2)).toBe("Check the 2 cards still to check");
    expect(reviewButtonLabel(1, 0)).toBe("Review the skipped card");
    expect(reviewButtonLabel(3, 2)).toBe("Review the 3 skipped");
    expect(reviewButtonLabel(0, 4)).toBe("Check the 4 cards still to check");
  });
});
