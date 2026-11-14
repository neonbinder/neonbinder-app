/**
 * NEO-556 — "Mark N teamless cards No Team": the pure run steps and words,
 * and the control's offer → confirm → ledger flow against a hand-built
 * client (`cardNoTeamBulk.noTeamTargets` / `applyNoTeamPage`). The server's
 * verdicts and counts are `convex/cardNoTeamBulk`'s own tests; these are
 * about what the operator is shown and what is called.
 */

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import { ConvexError } from "convex/values";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../convex/_generated/api", () => ({
  api: {
    cardNoTeamBulk: {
      noTeamTargets: "cardNoTeamBulk.noTeamTargets",
      applyNoTeamPage: "cardNoTeamBulk.applyNoTeamPage",
    },
  },
}));

const mockQuery = vi.fn();
const mockMutation = vi.fn();
// One client for the whole test, as `useConvex()` is in the app.
const client = { query: mockQuery, mutation: mockMutation };
vi.mock("convex/react", () => ({
  useConvex: () => client,
}));

import NoTeamCardsControl, {
  NO_TEAM_CONFIRM_LABEL,
  NO_TEAM_COUNT_FAILED_TEXT,
  NO_TEAM_DISMISS_LABEL,
  NO_TEAM_RECOUNT_LABEL,
  NO_TEAM_STOP_LABEL,
  applyNoTeamPage,
  failNoTeamRun,
  keptReasonLines,
  noTeamConfirmCopy,
  noTeamHeading,
  noTeamLineText,
  offerLabel,
  startNoTeamRun,
  stopNoTeamRun,
  type NoTeamPageView,
  type NoTeamTargetsView,
} from "./NoTeamCardsControl";
import type { Id } from "../../convex/_generated/dataModel";

const ROW = "row-1" as unknown as Id<"selectorOptions">;
const sid = (s: string) => s as unknown as Id<"selectorOptions">;
const KEPT0 = {
  alreadyNoTeam: 0,
  hasTeam: 0,
  pendingName: 0,
  listingNamesTeam: 0,
  awaitingLookup: 0,
  lookupGaveUp: 0,
};

function view(overrides: Partial<NoTeamTargetsView> = {}): NoTeamTargetsView {
  return {
    targets: [
      { _id: sid("t-base"), name: "Base", toStamp: 3 },
      { _id: sid("t-gold"), name: "Gold", toStamp: 2 },
    ],
    toStamp: 5,
    kept: { ...KEPT0 },
    rowsWithOtherDefault: 0,
    truncated: false,
    ...overrides,
  };
}

function page(overrides: Partial<NoTeamPageView>): NoTeamPageView {
  return {
    targetId: sid("t-base"),
    targetIndex: 0,
    targetCount: 2,
    scanned: 0,
    stamped: 0,
    kept: { ...KEPT0 },
    cursor: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Words and pure steps
// ---------------------------------------------------------------------------

describe("No Team run — words", () => {
  it("the offer counts the cards and pluralises", () => {
    expect(offerLabel(1)).toBe("Mark 1 teamless card No Team");
    expect(offerLabel(1200)).toBe(`Mark ${(1200).toLocaleString()} teamless cards No Team`);
  });

  it("the confirm says no card gains or loses a team, and says a floor when the count stopped", () => {
    const copy = noTeamConfirmCopy(view());
    expect(copy.title).toBe("Mark 5 cards No Team?");
    expect(copy.description).toContain("No card gains or loses a team.");
    const floor = noTeamConfirmCopy(view({ truncated: true }));
    expect(floor.title).toBe("Mark at least 5 cards No Team?");
    expect(floor.description).toContain("the run checks every one");
  });

  it("lists every reason a card is left alone, only those with cards, in verdict order", () => {
    expect(keptReasonLines(view())).toEqual([]);
    expect(
      keptReasonLines(
        view({
          kept: {
            alreadyNoTeam: 1,
            hasTeam: 2,
            pendingName: 1,
            listingNamesTeam: 3,
            awaitingLookup: 1,
            lookupGaveUp: 2,
          },
          rowsWithOtherDefault: 1,
        }),
      ),
    ).toEqual([
      "1 card is already No Team.",
      "2 cards have a team, and keep it.",
      "1 card has a team name waiting for review.",
      "3 cards are listed with a team NB couldn't match. Pick those yourself.",
      "1 card is still waiting on a team check. Each gets No Team if the check finds none.",
      "2 cards never got an answer from the team check. Those are your call.",
      "1 checklist under this one has a team of its own and is left out.",
    ]);
  });
});

describe("No Team run — pure steps", () => {
  it("starts on the first checklist, the rest waiting", () => {
    const run = startNoTeamRun(view());
    expect(run.lines.map((l) => l.kind)).toEqual(["building", "waiting"]);
    expect(noTeamHeading(run)).toBe("Marking teamless cards No Team: checklist 1 of 2");
  });

  it("folds pages per checklist and finishes on the null cursor", () => {
    let run = startNoTeamRun(view());
    run = applyNoTeamPage(run, page({ scanned: 4, stamped: 3, kept: { ...KEPT0, hasTeam: 1 }, cursor: "c1" }));
    expect(run.lines[0].kind).toBe("building");
    // The next page starts on the second checklist: the first is finished.
    run = applyNoTeamPage(
      run,
      page({ targetId: sid("t-gold"), targetIndex: 1, scanned: 2, stamped: 2, cursor: null }),
    );
    expect(run.phase).toBe("done");
    expect(run.lines.map((l) => l.kind)).toEqual(["built", "built"]);
    expect(noTeamLineText(run.lines[0])).toBe("Base — marked 3 cards No Team, left 1 as it is");
    expect(noTeamLineText(run.lines[1])).toBe("Gold — marked 2 cards No Team");
    expect(noTeamHeading(run)).toBe("Marked 5 cards No Team");
    expect(run.announcement).toBe("Marked 5 cards No Team");
  });

  it("a checklist with no cards reads 'no cards yet'; nothing marked reads as such", () => {
    let run = startNoTeamRun(view({ targets: [{ _id: sid("t-base"), name: "Base", toStamp: 0 }] }));
    run = applyNoTeamPage(run, page({ targetCount: 1, scanned: 0, cursor: null }));
    expect(noTeamLineText(run.lines[0])).toBe("Base — no cards yet");
    expect(noTeamHeading(run)).toBe("No cards here yet; new cards get No Team");

    let again = startNoTeamRun(view({ targets: [{ _id: sid("t-base"), name: "Base", toStamp: 0 }] }));
    again = applyNoTeamPage(
      again,
      page({ targetCount: 1, scanned: 2, kept: { ...KEPT0, alreadyNoTeam: 2 }, cursor: null }),
    );
    expect(noTeamLineText(again.lines[0])).toBe("Base — nothing to mark, 2 already No Team");
    expect(noTeamHeading(again)).toBe("Nothing to mark: every card here already has an answer");
  });

  it("stop and fail say how far it got and that a rerun finishes", () => {
    let run = startNoTeamRun(view());
    run = applyNoTeamPage(run, page({ scanned: 2, stamped: 2, cursor: "c1" }));
    const stopped = stopNoTeamRun(run);
    expect(stopped.lines.map((l) => l.kind)).toEqual(["unfinished", "stopped"]);
    expect(noTeamHeading(stopped)).toBe(
      "Stopped, like you asked. So far: marked 2 cards No Team. Run it again to finish; cards already done are skipped.",
    );
    const failed = failNoTeamRun(run, "This checklist changed mid-way. Give it another go.");
    expect(failed.lines.map((l) => l.kind)).toEqual(["failed", "stopped"]);
    expect(noTeamLineText(failed.lines[0])).toBe("Base — This checklist changed mid-way. Give it another go.");
    expect(noTeamHeading(failed)).toBe(
      "Stopped at Base. So far: marked 2 cards No Team. Run it again to finish; cards already done are skipped.",
    );
  });
});

// ---------------------------------------------------------------------------
// The control
// ---------------------------------------------------------------------------

function renderControl(props: Partial<Parameters<typeof NoTeamCardsControl>[0]> = {}) {
  const onDismissed = vi.fn();
  const utils = render(
    <NoTeamCardsControl
      selectorOptionId={ROW}
      isNoTeam
      teamCascadeStartedAt={undefined}
      expanded
      onDismissed={onDismissed}
      {...props}
    />,
  );
  return { ...utils, onDismissed };
}

describe("NoTeamCardsControl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockResolvedValue(view());
  });

  it("reads the count once, on demand, and offers the run with it", async () => {
    renderControl();
    const offer = await screen.findByRole("button", { name: "Mark 5 teamless cards No Team" });
    expect(offer).toBeTruthy();
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery).toHaveBeenCalledWith("cardNoTeamBulk.noTeamTargets", { selectorOptionId: ROW });
    // The hint describes it: nothing moves until it is pressed.
    const hint = document.getElementById(offer.getAttribute("aria-describedby") ?? "");
    expect(hint?.textContent).toContain("only change when you mark them");
  });

  it("asks nothing and shows nothing for a row that is not No Team, or with the panel shut", () => {
    renderControl({ isNoTeam: false });
    renderControl({ expanded: false });
    expect(mockQuery).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /teamless/ })).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("waits while the row's team change is still cascading, then counts once it clears", async () => {
    const { rerender } = renderControl({ teamCascadeStartedAt: Date.now() });
    expect(mockQuery).not.toHaveBeenCalled();
    rerender(
      <NoTeamCardsControl
        selectorOptionId={ROW}
        isNoTeam
        teamCascadeStartedAt={undefined}
        expanded
        onDismissed={vi.fn()}
      />,
    );
    await waitFor(() => expect(mockQuery).toHaveBeenCalledTimes(1));
  });

  it("offers nothing when no card would be marked", async () => {
    mockQuery.mockResolvedValue(view({ toStamp: 0 }));
    renderControl();
    await waitFor(() => expect(mockQuery).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.queryByRole("button", { name: /teamless/ })).toBeNull();
  });

  it("a refused count shows the server's sentence and a retry the operator presses — never a timer", async () => {
    mockQuery.mockRejectedValueOnce(
      new ConvexError("Still applying the last team change. Try again in a moment."),
    );
    renderControl();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Still applying the last team change. Try again in a moment.");
    expect(mockQuery).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: NO_TEAM_RECOUNT_LABEL }));
    expect(await screen.findByRole("button", { name: "Mark 5 teamless cards No Team" })).toBeTruthy();
    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a failure the server did not word reads as the fallback, never raw text", async () => {
    mockQuery.mockRejectedValueOnce(new Error("[CONVEX Q(cardNoTeamBulk:noTeamTargets)] Server Error"));
    renderControl();
    expect((await screen.findByRole("alert")).textContent).toBe(NO_TEAM_COUNT_FAILED_TEXT);
  });

  it("confirms with the reasons cards are left alone; Cancel walks nothing and returns to the offer", async () => {
    mockQuery.mockResolvedValue(view({ kept: { ...KEPT0, listingNamesTeam: 2 } }));
    renderControl();
    fireEvent.click(await screen.findByRole("button", { name: "Mark 5 teamless cards No Team" }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Mark 5 cards No Team?")).toBeTruthy();
    const reasons = within(dialog).getByRole("group", { name: "Cards left as they are" });
    expect(within(reasons).getByText(/2 cards are listed with a team NB couldn't match/)).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mockMutation).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Mark 5 teamless cards No Team" }),
      ),
    );
  });

  it("Yes runs the pages until the cursor is null, shows the ledger, then counts again", async () => {
    mockMutation
      .mockResolvedValueOnce(page({ scanned: 3, stamped: 3, cursor: "c1" }))
      .mockResolvedValueOnce(page({ targetId: sid("t-gold"), targetIndex: 1, scanned: 2, stamped: 2, cursor: null }));
    renderControl();
    fireEvent.click(await screen.findByRole("button", { name: "Mark 5 teamless cards No Team" }));
    mockQuery.mockResolvedValue(view({ toStamp: 0 }));
    fireEvent.click(screen.getByRole("button", { name: NO_TEAM_CONFIRM_LABEL }));

    const ledger = await screen.findByRole("region", { name: "Marked 5 cards No Team" });
    expect(mockMutation).toHaveBeenNthCalledWith(1, "cardNoTeamBulk.applyNoTeamPage", {
      selectorOptionId: ROW,
      cursor: null,
    });
    expect(mockMutation).toHaveBeenNthCalledWith(2, "cardNoTeamBulk.applyNoTeamPage", {
      selectorOptionId: ROW,
      cursor: "c1",
    });
    expect(within(ledger).getByText("Base — marked 3 cards No Team")).toBeTruthy();
    expect(within(ledger).getByText("Gold — marked 2 cards No Team")).toBeTruthy();
    await waitFor(() => expect(mockQuery).toHaveBeenCalledTimes(2));
    // Nothing left to mark: no offer under the finished ledger.
    expect(screen.queryByRole("button", { name: /teamless/ })).toBeNull();
  });

  it("Stop finishes the page in flight and stops; the ledger says how far it got", async () => {
    let release: (p: NoTeamPageView) => void = () => {};
    mockMutation.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    renderControl();
    fireEvent.click(await screen.findByRole("button", { name: "Mark 5 teamless cards No Team" }));
    fireEvent.click(screen.getByRole("button", { name: NO_TEAM_CONFIRM_LABEL }));

    fireEvent.click(await screen.findByRole("button", { name: NO_TEAM_STOP_LABEL }));
    await act(async () => release(page({ scanned: 2, stamped: 2, cursor: "c1" })));

    expect(
      await screen.findByRole("region", { name: /^Stopped, like you asked\. So far: marked 2 cards No Team\./ }),
    ).toBeTruthy();
    expect(mockMutation).toHaveBeenCalledTimes(1);
  });

  it("a refused page fails its line with the server's sentence", async () => {
    mockMutation.mockRejectedValueOnce(
      new ConvexError("This isn't set to No Team anymore, so its cards were left as they are."),
    );
    renderControl();
    fireEvent.click(await screen.findByRole("button", { name: "Mark 5 teamless cards No Team" }));
    fireEvent.click(screen.getByRole("button", { name: NO_TEAM_CONFIRM_LABEL }));

    expect(
      await screen.findByText(
        "Base — This isn't set to No Team anymore, so its cards were left as they are.",
      ),
    ).toBeTruthy();
  });

  it("the finished ledger stays with the panel shut, and Dismiss hands focus back to the panel", async () => {
    mockMutation.mockResolvedValueOnce(page({ targetCount: 2, scanned: 5, stamped: 5, cursor: null }));
    const { rerender, onDismissed } = renderControl();
    fireEvent.click(await screen.findByRole("button", { name: "Mark 5 teamless cards No Team" }));
    fireEvent.click(screen.getByRole("button", { name: NO_TEAM_CONFIRM_LABEL }));
    await screen.findByRole("region", { name: "Marked 5 cards No Team" });

    rerender(
      <NoTeamCardsControl
        selectorOptionId={ROW}
        isNoTeam
        teamCascadeStartedAt={undefined}
        expanded={false}
        onDismissed={onDismissed}
      />,
    );
    expect(screen.getByRole("region", { name: "Marked 5 cards No Team" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: NO_TEAM_DISMISS_LABEL }));
    expect(screen.queryByRole("region")).toBeNull();
    expect(onDismissed).toHaveBeenCalledTimes(1);
  });

  it("its Stop and Dismiss are named apart from NEO-528's ledger, which can share the screen", () => {
    for (const [mine, theirs] of [
      [NO_TEAM_STOP_LABEL, "Stop after these cards"],
      [NO_TEAM_DISMISS_LABEL, "Dismiss this run"],
    ]) {
      expect(mine.toLowerCase().includes(theirs.toLowerCase())).toBe(false);
      expect(theirs.toLowerCase().includes(mine.toLowerCase())).toBe(false);
    }
  });
});
