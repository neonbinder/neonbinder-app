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
