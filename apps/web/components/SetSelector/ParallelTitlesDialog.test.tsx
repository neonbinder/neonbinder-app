/**
 * NEO-535 — the parallel Card titles door and dialog: it loads before it
 * opens, opens on its own once per key (and holds back when another dialog
 * is up or the operator is typing), saves every row it showed, asks before
 * tossing edits, and hands focus back to the door.
 *
 * Convex is a hand-built fake (`useConvex`): `failingTitles` answers one
 * page, `saveTitleFixes` answers counts. What the rows say is the real
 * `CardTitlesStep` over the real `parallel-titles` source.
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import { assessListingTitle, type ListingCardInputs } from "../../convex/features/generateListing";

vi.mock("../../convex/_generated/api", () => ({
  api: {
    parallelCopyTitles: {
      failingTitles: "failingTitles",
      saveTitleFixes: "saveTitleFixes",
    },
  },
}));

const mockQuery = vi.fn();
const mockMutation = vi.fn();
vi.mock("convex/react", () => ({
  useConvex: () => ({ query: mockQuery, mutation: mockMutation }),
}));

import {
  ALL_TITLES_FIT,
  LOADING_TITLES_LABEL,
  boxNotSavableLine,
  DISCARD_CONFIRM,
  DISCARD_TITLE,
  NOT_NOW_LABEL,
  ParallelTitlesDoor,
  SAVE_TITLES_LABEL,
  TITLES_DIALOG_TITLE,
  heldBackLine,
  resetParallelTitlesAutoOpen,
} from "./ParallelTitlesDialog";

const PARALLEL_ID = "parallel-1" as unknown as Id<"selectorOptions">;
const PARALLEL = "Kanji Orange Wave Refractor Sapphire Gold XYZW";
const LABEL = "Fix 2 card titles";

function inputs(cardNumber: string): ListingCardInputs & { playerNames: string[]; teamNames: string[] } {
  return {
    cardNumber,
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
}

function storedCard(n: string) {
  return {
    cardId: `card-${n}` as unknown as Id<"cardChecklist">,
    cardNumber: n,
    cardName: "Mike Trout",
    title: assessListingTitle(inputs(n)).title,
    inputs: inputs(n),
  };
}

function page(cards = [storedCard("3"), storedCard("4")]) {
  return {
    parallel: { _id: PARALLEL_ID, value: PARALLEL },
    boxPrefill: `2024 Topps Chrome Anime ${PARALLEL}`,
    cards,
    failingInPage: cards.length,
    cursor: null,
  };
}

const PARALLELS = [{ id: PARALLEL_ID, value: PARALLEL }];

const door = () => screen.getByRole("button", { name: LABEL });
const dialog = () => screen.queryByRole("dialog", { name: TITLES_DIALOG_TITLE });
const titleFields = () => screen.getAllByRole("textbox", { name: /^Title for/ }) as HTMLTextAreaElement[];

async function openByHand() {
  fireEvent.click(door());
  await waitFor(() => expect(dialog()).not.toBeNull());
}

beforeEach(() => {
  mockQuery.mockReset();
  mockMutation.mockReset();
  mockQuery.mockResolvedValue(page());
  mockMutation.mockResolvedValue({ saved: 1, rewritten: 0, kept: 1, skipped: 0, stillFailing: 0 });
  resetParallelTitlesAutoOpen();
});

describe("ParallelTitlesDoor — opening", () => {
  test("a press loads every failing card first, then opens the dialog with a row each", async () => {
    render(<ParallelTitlesDoor parallels={PARALLELS} label={LABEL} />);
    expect(door().getAttribute("aria-haspopup")).toBe("dialog");
    expect(dialog()).toBeNull();
    expect(mockQuery).not.toHaveBeenCalled();

    await openByHand();
    expect(mockQuery).toHaveBeenCalledWith("failingTitles", { parallelId: PARALLEL_ID });
    expect(titleFields()).toHaveLength(2);
    expect(titleFields()[0].value).toBe(storedCard("3").title);
    expect(screen.getByRole("textbox", { name: "Set name in titles" })).toBeTruthy();
  });

  test("nothing left to fix: no dialog, and the status line says so", async () => {
    mockQuery.mockResolvedValue(page([]));
    render(<ParallelTitlesDoor parallels={PARALLELS} label={LABEL} />);
    fireEvent.click(door());
    await waitFor(() => expect(screen.getByText(ALL_TITLES_FIT)).toBeTruthy());
    expect(dialog()).toBeNull();
  });

  test("a held door does nothing when pressed", async () => {
    render(<ParallelTitlesDoor parallels={PARALLELS} label={LABEL} held />);
    expect(door().getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(door());
    await act(async () => {});
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe("ParallelTitlesDoor — opening on its own", () => {
  test("opens once per key, never again for the same key", async () => {
    const { unmount } = render(
      <ParallelTitlesDoor parallels={PARALLELS} label={LABEL} autoOpenKey="run-1" />,
    );
    await waitFor(() => expect(dialog()).not.toBeNull());
    expect(mockQuery).toHaveBeenCalledTimes(1);
    unmount();

    render(<ParallelTitlesDoor parallels={PARALLELS} label={LABEL} autoOpenKey="run-1" />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(dialog()).toBeNull();
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  test("holds back while another dialog is open, and says so", async () => {
    render(
      <>
        <div role="dialog" aria-modal="true" aria-label="Something else" />
        <ParallelTitlesDoor parallels={PARALLELS} label={LABEL} autoOpenKey="run-2" />
      </>,
    );
    await waitFor(() => expect(screen.getByText(heldBackLine(LABEL))).toBeTruthy());
    expect(dialog()).toBeNull();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test("holds back while the operator is typing in a field", async () => {
    const field = document.createElement("textarea");
    document.body.appendChild(field);
    field.focus();
    try {
      render(<ParallelTitlesDoor parallels={PARALLELS} label={LABEL} autoOpenKey="run-3" />);
      await waitFor(() => expect(screen.getByText(heldBackLine(LABEL))).toBeTruthy());
      expect(mockQuery).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(field);
    } finally {
      field.remove();
    }
  });

  test("holds back while a build holds the checklist", async () => {
    render(<ParallelTitlesDoor parallels={PARALLELS} label={LABEL} autoOpenKey="run-4" held />);
    await waitFor(() => expect(screen.getByText(heldBackLine(LABEL))).toBeTruthy());
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test("a self-opened dialog never lands focus in a field", async () => {
    render(<ParallelTitlesDoor parallels={PARALLELS} label={LABEL} autoOpenKey="run-5" />);
    await waitFor(() => expect(dialog()).not.toBeNull());
    const active = document.activeElement as HTMLElement;
    expect(active.tagName).not.toBe("TEXTAREA");
    expect(dialog()!.contains(active)).toBe(true);
  });
});

describe("ParallelTitlesDialog — saving", () => {
  test("every row shown is answered: an own title, and the untouched row kept", async () => {
    render(<ParallelTitlesDoor parallels={PARALLELS} label={LABEL} />);
    await openByHand();

    const [three] = titleFields();
    fireEvent.change(three, { target: { value: "2024 Topps Chrome Anime Kanji XYZW Mike Trout #3" } });
    fireEvent.blur(three);
    fireEvent.click(screen.getByRole("button", { name: SAVE_TITLES_LABEL }));

    await waitFor(() => expect(dialog()).toBeNull());
    expect(mockMutation).toHaveBeenCalledTimes(1);
    expect(mockMutation).toHaveBeenCalledWith("saveTitleFixes", {
      parallelId: PARALLEL_ID,
      cards: [
        { cardId: storedCard("3").cardId, listingTitle: "2024 Topps Chrome Anime Kanji XYZW Mike Trout #3" },
        { cardId: storedCard("4").cardId, kept: storedCard("4").title },
      ],
    });
    expect(screen.getByText("Saved 2 titles.")).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(door()));
  });

  test("an edited box is sent once, and redraws the rows that it fixes", async () => {
    render(<ParallelTitlesDoor parallels={PARALLELS} label={LABEL} />);
    await openByHand();
    const box = screen.getByRole("textbox", { name: "Set name in titles" });
    fireEvent.change(box, { target: { value: "Anime Kanji XYZW" } });
    fireEvent.blur(box);
    await waitFor(() => expect(titleFields()[0].value).toContain("Anime Kanji XYZW Mike Trout"));

    fireEvent.click(screen.getByRole("button", { name: SAVE_TITLES_LABEL }));
    await waitFor(() => expect(dialog()).toBeNull());
    const [, args] = mockMutation.mock.calls[0];
    expect(args.listingShortName).toBe("Anime Kanji XYZW");
    expect(args.cards).toHaveLength(2);
    for (const card of args.cards) expect(card.kept).toContain("Anime Kanji XYZW Mike Trout");
  });

  test("a failed save keeps the dialog open and says why", async () => {
    mockMutation.mockRejectedValue(new Error("boom"));
    render(<ParallelTitlesDoor parallels={PARALLELS} label={LABEL} />);
    await openByHand();
    fireEvent.click(screen.getByRole("button", { name: SAVE_TITLES_LABEL }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/^Titles not saved:/));
    expect(dialog()).not.toBeNull();
  });
});

describe("NEO-535 (a11y) — the door while it loads", () => {
  test("keeps its name, is busy, and says Loading titles… politely", async () => {
    let answer: (value: unknown) => void = () => {};
    mockQuery.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    render(<ParallelTitlesDoor parallels={PARALLELS} label={LABEL} />);
    fireEvent.click(door());
    await waitFor(() => expect(door().getAttribute("aria-busy")).toBe("true"));
    expect(door().textContent).toBe(LABEL);
    expect(screen.getByRole("status").textContent).toBe(LOADING_TITLES_LABEL);
    await act(async () => answer(page()));
    await waitFor(() => expect(dialog()).not.toBeNull());
  });

  test("a full section reads later pages for counts only (wantCards: 0)", async () => {
    const many = Array.from({ length: 50 }, (_, i) => storedCard(String(i + 1)));
    mockQuery
      .mockResolvedValueOnce({ ...page(many), cursor: "c1" })
      .mockResolvedValueOnce({ ...page([]), failingInPage: 7, cursor: null });
    render(<ParallelTitlesDoor parallels={PARALLELS} label={LABEL} />);
    await openByHand();
    expect(mockQuery).toHaveBeenNthCalledWith(1, "failingTitles", { parallelId: PARALLEL_ID });
    expect(mockQuery).toHaveBeenNthCalledWith(2, "failingTitles", {
      parallelId: PARALLEL_ID,
      cursor: "c1",
      wantCards: 0,
    });
  });

  test("tells its host when it is busy and what it last said", async () => {
    const active = vi.fn();
    const lines = vi.fn();
    render(
      <ParallelTitlesDoor
        parallels={PARALLELS}
        label={LABEL}
        onActiveChange={active}
        onStatusChange={lines}
      />,
    );
    await openByHand();
    expect(active).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: SAVE_TITLES_LABEL }));
    await waitFor(() => expect(dialog()).toBeNull());
    expect(active).toHaveBeenLastCalledWith(false);
    expect(lines).toHaveBeenLastCalledWith("Saved 2 titles.");
  });

  test("with announceStatus off its line is plain text, never a live region", async () => {
    mockQuery.mockResolvedValue(page([]));
    render(<ParallelTitlesDoor parallels={PARALLELS} label={LABEL} announceStatus={false} />);
    fireEvent.click(door());
    await waitFor(() => expect(screen.getByText(ALL_TITLES_FIT)).toBeTruthy());
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("NEO-535 (a11y) — two doors, one dialog", () => {
  test("when the ticker's and the checklist's doors both self-open, the second holds back", async () => {
    const OTHER = "Fix card titles";
    render(
      <>
        <ParallelTitlesDoor parallels={PARALLELS} label={LABEL} autoOpenKey="run-a" />
        <ParallelTitlesDoor parallels={PARALLELS} label={OTHER} autoOpenKey="build-a" />
      </>,
    );
    await waitFor(() => expect(dialog()).not.toBeNull());
    expect(screen.getAllByRole("dialog", { name: TITLES_DIALOG_TITLE })).toHaveLength(1);
    expect(screen.getByText(heldBackLine(OTHER))).toBeTruthy();
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  test("once the first closes, a later self-open goes through", async () => {
    const { rerender } = render(
      <ParallelTitlesDoor parallels={PARALLELS} label={LABEL} autoOpenKey="run-b" />,
    );
    await waitFor(() => expect(dialog()).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: NOT_NOW_LABEL }));
    await waitFor(() => expect(dialog()).toBeNull());
    rerender(<ParallelTitlesDoor parallels={PARALLELS} label={LABEL} autoOpenKey="run-c" />);
    await waitFor(() => expect(dialog()).not.toBeNull());
  });
});

describe("NEO-535 (a11y) — refusals land where they can be fixed", () => {
  test("a box that won't save names its parallel and takes focus", async () => {
    render(<ParallelTitlesDoor parallels={PARALLELS} label={LABEL} />);
    await openByHand();
    const box = screen.getByRole("textbox", { name: "Set name in titles" });
    fireEvent.change(box, { target: { value: "x".repeat(81) } });
    fireEvent.blur(box);
    fireEvent.click(screen.getByRole("button", { name: SAVE_TITLES_LABEL }));
    await waitFor(() =>
      expect(screen.getByText(boxNotSavableLine(PARALLEL)).getAttribute("role")).toBe("alert"),
    );
    await waitFor(() => expect(document.activeElement).toBe(box));
    expect(mockMutation).not.toHaveBeenCalled();
  });

  test("after a failed save focus is back on Save", async () => {
    mockMutation.mockRejectedValue(new Error("boom"));
    render(<ParallelTitlesDoor parallels={PARALLELS} label={LABEL} />);
    await openByHand();
    const save = screen.getByRole("button", { name: SAVE_TITLES_LABEL });
    fireEvent.click(save);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/^Titles not saved:/));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: SAVE_TITLES_LABEL })),
    );
  });
});

describe("ParallelTitlesDialog — leaving", () => {
  test("Escape with nothing edited closes at once, writes nothing, and focus returns to the door", async () => {
    render(<ParallelTitlesDoor parallels={PARALLELS} label={LABEL} />);
    await openByHand();
    fireEvent.keyDown(dialog()!, { key: "Escape" });
    await waitFor(() => expect(dialog()).toBeNull());
    expect(screen.queryByRole("dialog", { name: DISCARD_TITLE })).toBeNull();
    expect(mockMutation).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(door()));
  });

  test("Escape after an edit asks first; tossing closes without saving", async () => {
    render(<ParallelTitlesDoor parallels={PARALLELS} label={LABEL} />);
    await openByHand();
    const [three] = titleFields();
    fireEvent.change(three, { target: { value: "My own words Trout #3" } });
    fireEvent.blur(three);

    fireEvent.keyDown(dialog()!, { key: "Escape" });
    const confirm = await screen.findByRole("dialog", { name: DISCARD_TITLE });
    expect(dialog()).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: DISCARD_CONFIRM }));
    await waitFor(() => expect(dialog()).toBeNull());
    expect(confirm.isConnected).toBe(false);
    expect(mockMutation).not.toHaveBeenCalled();
  });

  test("Not now after an edit asks too; Cancel keeps the edit", async () => {
    render(<ParallelTitlesDoor parallels={PARALLELS} label={LABEL} />);
    await openByHand();
    const [three] = titleFields();
    fireEvent.change(three, { target: { value: "My own words Trout #3" } });
    fireEvent.blur(three);

    fireEvent.click(screen.getByRole("button", { name: NOT_NOW_LABEL }));
    await screen.findByRole("dialog", { name: DISCARD_TITLE });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: DISCARD_TITLE })).toBeNull());
    expect(titleFields()[0].value).toBe("My own words Trout #3");
  });

  test("Not now with nothing edited closes and focus returns to the door", async () => {
    render(<ParallelTitlesDoor parallels={PARALLELS} label={LABEL} />);
    await openByHand();
    fireEvent.click(screen.getByRole("button", { name: NOT_NOW_LABEL }));
    await waitFor(() => expect(dialog()).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(door()));
  });
});

describe("NEO-581 — the live count goes back to the host", () => {
  const counts = (n: number) => [{ id: PARALLEL_ID, count: n }];
  const answerCount = (n: number) => ({ ...page([]), failingInPage: n, cursor: null });

  test("the load that opens the dialog reports each parallel's count", async () => {
    const onCounts = vi.fn();
    render(<ParallelTitlesDoor parallels={PARALLELS} label={LABEL} onCounts={onCounts} />);
    await openByHand();
    expect(onCounts).toHaveBeenCalledWith(counts(2));
  });

  test("nothing left to fix reports zero", async () => {
    mockQuery.mockResolvedValue(page([]));
    const onCounts = vi.fn();
    render(<ParallelTitlesDoor parallels={PARALLELS} label={LABEL} onCounts={onCounts} />);
    fireEvent.click(door());
    await waitFor(() => expect(screen.getByText(ALL_TITLES_FIT)).toBeTruthy());
    expect(onCounts).toHaveBeenLastCalledWith(counts(0));
  });

  test("a save recounts (counts only) and reports what is left before the door lets go", async () => {
    const onCounts = vi.fn();
    const active = vi.fn();
    render(
      <ParallelTitlesDoor
        parallels={PARALLELS}
        label={LABEL}
        onCounts={onCounts}
        onActiveChange={active}
      />,
    );
    await openByHand();
    mockQuery.mockResolvedValue(answerCount(1));
    active.mockClear();
    fireEvent.click(screen.getByRole("button", { name: SAVE_TITLES_LABEL }));
    await waitFor(() => expect(dialog()).toBeNull());
    await waitFor(() => expect(active).toHaveBeenLastCalledWith(false));
    expect(mockQuery).toHaveBeenLastCalledWith("failingTitles", {
      parallelId: PARALLEL_ID,
      wantCards: 0,
    });
    expect(onCounts).toHaveBeenLastCalledWith(counts(1));
    // Reported before it let go: the host never sees "idle" with a stale count.
    expect(onCounts.mock.invocationCallOrder.at(-1)!).toBeLessThan(
      active.mock.invocationCallOrder.at(-1)!,
    );
  });

  test("a recount reads every page", async () => {
    const onCounts = vi.fn();
    render(<ParallelTitlesDoor parallels={PARALLELS} label={LABEL} onCounts={onCounts} />);
    await openByHand();
    mockQuery
      .mockResolvedValueOnce({ ...answerCount(3), cursor: "c1" })
      .mockResolvedValueOnce(answerCount(4));
    fireEvent.click(screen.getByRole("button", { name: NOT_NOW_LABEL }));
    await waitFor(() => expect(dialog()).toBeNull());
    await waitFor(() => expect(onCounts).toHaveBeenLastCalledWith(counts(7)));
  });

  test("a recount that fails says nothing and still lets go", async () => {
    const onCounts = vi.fn();
    const active = vi.fn();
    render(
      <ParallelTitlesDoor
        parallels={PARALLELS}
        label={LABEL}
        onCounts={onCounts}
        onActiveChange={active}
      />,
    );
    await openByHand();
    onCounts.mockClear();
    mockQuery.mockRejectedValue(new Error("offline"));
    fireEvent.click(screen.getByRole("button", { name: NOT_NOW_LABEL }));
    await waitFor(() => expect(active).toHaveBeenLastCalledWith(false));
    expect(onCounts).not.toHaveBeenCalled();
  });

  test("countOnMount counts without opening or touching a card", async () => {
    mockQuery.mockResolvedValue(answerCount(1));
    const onCounts = vi.fn();
    render(
      <ParallelTitlesDoor parallels={PARALLELS} label={LABEL} onCounts={onCounts} countOnMount />,
    );
    await waitFor(() => expect(onCounts).toHaveBeenCalledWith(counts(1)));
    expect(mockQuery).toHaveBeenCalledWith("failingTitles", {
      parallelId: PARALLEL_ID,
      wantCards: 0,
    });
    expect(dialog()).toBeNull();
  });
  // A promise the test settles by hand, so two reads can land out of order.
  function held<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  }

  test("a mount recount still in flight when the button is pressed is dropped", async () => {
    const mount = held<ReturnType<typeof answerCount>>();
    mockQuery.mockReturnValueOnce(mount.promise);
    const onCounts = vi.fn();
    render(
      <ParallelTitlesDoor parallels={PARALLELS} label={LABEL} onCounts={onCounts} countOnMount />,
    );
    await waitFor(() => expect(mockQuery).toHaveBeenCalledTimes(1));
    // The press loads fresh (the default mock: two failing cards).
    await openByHand();
    expect(onCounts).toHaveBeenLastCalledWith(counts(2));
    // The stale mount read lands after the press's: it must not overwrite it.
    await act(async () => mount.resolve(answerCount(9)));
    expect(onCounts).toHaveBeenCalledTimes(1);
    expect(onCounts).toHaveBeenLastCalledWith(counts(2));
  });

  test("a mount recount that lands first is overtaken by a later press", async () => {
    const press = held<ReturnType<typeof page>>();
    mockQuery.mockResolvedValueOnce(answerCount(9));
    const onCounts = vi.fn();
    render(
      <ParallelTitlesDoor parallels={PARALLELS} label={LABEL} onCounts={onCounts} countOnMount />,
    );
    await waitFor(() => expect(onCounts).toHaveBeenCalledWith(counts(9)));
    mockQuery.mockReturnValueOnce(press.promise);
    fireEvent.click(door());
    await act(async () => press.resolve(page()));
    await waitFor(() => expect(onCounts).toHaveBeenLastCalledWith(counts(2)));
  });

  test("leaving without a save when the cards were fixed elsewhere says why the button goes", async () => {
    render(<ParallelTitlesDoor parallels={PARALLELS} label={LABEL} />);
    await openByHand();
    mockQuery.mockResolvedValue(answerCount(0));
    fireEvent.click(screen.getByRole("button", { name: NOT_NOW_LABEL }));
    await waitFor(() => expect(dialog()).toBeNull());
    await waitFor(() => expect(screen.getByText(ALL_TITLES_FIT)).toBeTruthy());
  });

  test("leaving without a save with titles still failing says nothing", async () => {
    render(<ParallelTitlesDoor parallels={PARALLELS} label={LABEL} />);
    await openByHand();
    mockQuery.mockResolvedValue(answerCount(2));
    fireEvent.click(screen.getByRole("button", { name: NOT_NOW_LABEL }));
    await waitFor(() => expect(dialog()).toBeNull());
    await act(async () => {});
    expect(screen.queryByText(ALL_TITLES_FIT)).toBeNull();
  });

  test("the silent recount on mount never speaks", async () => {
    mockQuery.mockResolvedValue(answerCount(0));
    const onCounts = vi.fn();
    render(
      <ParallelTitlesDoor parallels={PARALLELS} label={LABEL} onCounts={onCounts} countOnMount />,
    );
    await waitFor(() => expect(onCounts).toHaveBeenCalledWith(counts(0)));
    expect(screen.queryByText(ALL_TITLES_FIT)).toBeNull();
  });

  test("during the recount after a close the button is busy and a press does nothing", async () => {
    const active = vi.fn();
    render(<ParallelTitlesDoor parallels={PARALLELS} label={LABEL} onActiveChange={active} />);
    await openByHand();
    let answer: (value: unknown) => void = () => {};
    mockQuery.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    active.mockClear();
    fireEvent.click(screen.getByRole("button", { name: NOT_NOW_LABEL }));
    await waitFor(() => expect(dialog()).toBeNull());
    await waitFor(() => expect(door().getAttribute("aria-busy")).toBe("true"));
    expect(door().getAttribute("aria-disabled")).toBe("true");
    mockQuery.mockClear();
    fireEvent.click(door());
    fireEvent.keyDown(door(), { key: "Enter" });
    await act(async () => {});
    // No second open started, so nothing can be released out from under it.
    expect(mockQuery).not.toHaveBeenCalled();
    expect(active).not.toHaveBeenCalled();
    await act(async () => answer(answerCount(2)));
    await waitFor(() => expect(active).toHaveBeenLastCalledWith(false));
    expect(door().getAttribute("aria-busy")).toBeNull();
    expect(door().getAttribute("aria-disabled")).toBeNull();
  });
});
