/**
 * NEO-592 — the Sets column has ONE toast box and ONE timer for it. The sync
 * report ("No longer listed on …") and the SportLots review's result both put
 * text in that box, so whichever came last must get a full six seconds and an
 * earlier message's timer must never take it down. Mocking joins
 * `EntityColumn.slReview.test.tsx` (the stubbed review dialog and its pill)
 * and `EntityColumn.suggestions-notice.test.tsx` (a controlled sync row).
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import type { GenericId } from "convex/values";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type OptionId = GenericId<"selectorOptions">;

vi.mock("../../convex/_generated/api", () => ({
  api: {
    selectorOptions: {
      getSelectorOptions: "getSelectorOptions",
      getSelectorSyncStatus: "getSelectorSyncStatus",
      getSelectorSyncSuggestions: "getSelectorSyncSuggestions",
      getAncestorChain: "getAncestorChain",
      addCustomSelectorOption: "addCustomSelectorOption",
      applySelectorSyncSuggestions: "applySelectorSyncSuggestions",
      dismissSelectorSyncNotice: "dismissSelectorSyncNotice",
      ensureSelectorOptions: "ensureSelectorOptions",
      findSelectorOptionElsewhere: "findSelectorOptionElsewhere",
    },
    slSetReview: { getSlSetReviewSummary: "getSlSetReviewSummary" },
  },
}));

const state: { status: unknown } = { status: null };

vi.mock("convex/react", () => ({
  useConvex: () => ({ query: vi.fn() }),
  useMutation: () => vi.fn(),
  useAction: () => vi.fn().mockResolvedValue({ scheduled: true }),
  useQuery: (ref: string, args: unknown) => {
    if (args === "skip") return undefined;
    if (ref === "getSelectorSyncStatus") return state.status;
    if (ref === "getSelectorSyncSuggestions") return [];
    if (ref === "getSlSetReviewSummary") return { pending: 3, partial: false, moreNextSync: 0 };
    // A populated column: an empty one auto-opens its sync form.
    if (ref === "getSelectorOptions") return [{ _id: "set-bowman", value: "Bowman" }];
    return undefined;
  },
}));

vi.mock("./SlSetReviewModal", () => ({
  default: (props: { onClose: () => void; onSaved: (text: string) => void }) => (
    <div role="dialog" aria-label="review stub">
      <button type="button" onClick={() => props.onSaved("Saved 1 set, 2 parallels.")}>
        stub save
      </button>
    </div>
  ),
}));

import EntityColumn from "./EntityColumn";

const BRAND_ID = "mfr-bowman" as unknown as OptionId;
const TOAST_MS = 6000;
const REVIEW_TEXT = "Saved 1 set, 2 parallels.";
const SYNC_TEXT = "No longer listed on BSC: 2 sets";

const doneWithUnlinked = {
  status: "done",
  unlinked: [
    { id: "r1", value: "Topps Heritage", side: "bsc" },
    { id: "r2", value: "Topps Chrome", side: "bsc" },
  ],
};

// A function, not a constant: a rerender needs a FRESH element or React bails out.
const column = () => (
  <EntityColumn
    selector={<div>selector</div>}
    renderForm={() => <div>form</div>}
    addButtonText="Sync Sets"
    isVisible={true}
    level="setName"
    parentId={BRAND_ID}
    useEnsureSync
    syncingLabel="Syncing Sets"
  />
);

async function renderColumn() {
  const view = render(column());
  await act(async () => {});
  return view;
}

/** The one toast box, or null. */
const toast = () => document.querySelector('[aria-live="polite"]');

/** Opens the (stubbed) review and saves it: the review's result goes in the toast box. */
async function saveReview() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "3 SportLots sets to sort" }));
  });
  await act(async () => {
    fireEvent.click(screen.getByText("stub save"));
  });
}

const tick = (ms: number) =>
  act(async () => {
    vi.advanceTimersByTime(ms);
  });

beforeEach(() => {
  state.status = null;
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("the Sets column's one toast and its one timer (NEO-592)", () => {
  it("a review result that lands while the sync report is up gets its own full six seconds", async () => {
    state.status = doneWithUnlinked;
    await renderColumn();
    expect(toast()!.textContent).toContain(SYNC_TEXT);
    await tick(4000);
    await saveReview();
    expect(toast()!.textContent).toBe(REVIEW_TEXT);
    // The sync report's timer would have fired at +2 s; it must not.
    await tick(TOAST_MS - 1);
    expect(toast()!.textContent).toBe(REVIEW_TEXT);
    await tick(1);
    expect(toast()).toBeNull();
  });

  it("a sync report that lands while the review's result is up replaces it and gets six seconds", async () => {
    const view = await renderColumn();
    await saveReview();
    expect(toast()!.textContent).toBe(REVIEW_TEXT);
    await tick(3000);
    state.status = doneWithUnlinked;
    await act(async () => {
      view.rerender(column());
    });
    expect(toast()!.textContent).toContain(SYNC_TEXT);
    // The review's timer would have fired at +3 s; it must not.
    await tick(TOAST_MS - 1);
    expect(toast()!.textContent).toContain(SYNC_TEXT);
    await tick(1);
    expect(toast()).toBeNull();
  });

  it("unmounting with a toast up leaves no timer running", async () => {
    const view = await renderColumn();
    await saveReview();
    expect(toast()).not.toBeNull();
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("unmounting with the sync report up leaves no timer running either", async () => {
    state.status = doneWithUnlinked;
    const view = await renderColumn();
    expect(toast()!.textContent).toContain(SYNC_TEXT);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
