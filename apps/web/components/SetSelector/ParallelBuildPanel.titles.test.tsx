/**
 * NEO-535 — the build ticker's half of the parallel Card titles flow: the
 * built line's clause, the end-of-run sentence, and the "Fix N card titles"
 * door, which shows only once a run has ended with titles to fix and opens on
 * its own only for a run that ended while the operator was here.
 *
 * The dialog itself is covered in ParallelTitlesDialog.test.tsx; here the
 * fake `useConvex().query` only proves whether it was asked to load.
 */

import { act, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";

vi.mock("../../convex/_generated/api", () => ({
  api: {
    parallelChecklistBuild: {
      getParallelsForBuild: "getParallelsForBuild",
      buildParallelChecklist: "buildParallelChecklist",
    },
    parallelCopyTitles: {
      failingTitles: "failingTitles",
      saveTitleFixes: "saveTitleFixes",
    },
  },
}));

const mockQuery = vi.fn();
vi.mock("convex/react", () => ({
  useConvex: () => ({ query: mockQuery, mutation: vi.fn(), action: vi.fn() }),
  useAction: () => vi.fn(),
}));

import ParallelBuildPanel, {
  builtText,
  fixRunTitlesLabel,
  runTitlesAnnouncement,
  runTitlesToFix,
  titlesToFixText,
  type ParallelBuildResult,
  type ParallelRun,
} from "./ParallelBuildPanel";
import { resetParallelTitlesAutoOpen } from "./ParallelTitlesDialog";

const INSERT_ID = "insert-1" as unknown as Id<"selectorOptions">;
const A = "parallel-a" as unknown as Id<"selectorOptions">;
const B = "parallel-b" as unknown as Id<"selectorOptions">;
const C = "parallel-c" as unknown as Id<"selectorOptions">;

function built(titlesToFix?: number): ParallelBuildResult {
  return {
    status: "built",
    copied: 10,
    notCopied: 0,
    unlinked: { bsc: 0, sportlots: 0 },
    ambiguous: { bsc: 0, sportlots: 0 },
    sidesFetched: ["bsc"],
    sidesSkipped: ["sportlots"],
    earlierLinksMissing: { bsc: 0, sportlots: 0 },
    rebuilt: false,
    stillListedNotRelinked: { bsc: 0, sportlots: 0 },
    legacyLinksRemoved: { bsc: 0, sportlots: 0 },
    skippedChangedSource: 0,
    extraOnMarketplace: { bsc: { count: 0, cards: [] }, sportlots: { count: 0, cards: [] } },
    cards: {
      leftOff: [],
      unlinked: { bsc: [], sportlots: [] },
      ambiguous: { bsc: [], sportlots: [] },
    },
    ...(titlesToFix !== undefined ? { titlesToFix } : {}),
  };
}

function run(overrides: Partial<ParallelRun> = {}): ParallelRun {
  return {
    startedFrom: INSERT_ID,
    sourceId: INSERT_ID,
    sourceValue: "Anime",
    sourceKind: "insert",
    entries: [
      { id: A, value: "Anime Gold", line: { kind: "built", result: built(2) } },
      { id: B, value: "Anime Silver", line: { kind: "built", result: built() } },
      { id: C, value: "Anime Bronze", line: { kind: "built", result: built(1) } },
    ],
    truncated: false,
    phase: "finished",
    atIndex: null,
    announcement: "",
    ...overrides,
  };
}

const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });

beforeEach(() => {
  mockQuery.mockReset();
  // Nothing left to fix by the time it loads: no dialog, just the status line.
  mockQuery.mockResolvedValue({
    parallel: { _id: A, value: "Anime Gold" },
    boxPrefill: "",
    cards: [],
    failingInPage: 0,
    cursor: null,
  });
  resetParallelTitlesAutoOpen();
});

describe("the words", () => {
  test("the built line names the titles to fix", () => {
    expect(titlesToFixText(1)).toBe("1 title needs a fix");
    expect(titlesToFixText(3)).toBe("3 titles need a fix");
    expect(builtText(built(3))).toContain("3 titles need a fix");
    expect(builtText(built())).not.toContain("title");
    expect(builtText(built(0))).not.toContain("title");
  });

  test("the door and the end-of-run sentence count every parallel's", () => {
    expect(fixRunTitlesLabel(1)).toBe("Fix 1 card title");
    expect(fixRunTitlesLabel(3)).toBe("Fix 3 card titles");
    expect(runTitlesAnnouncement(1)).toBe("1 card title needs a fix.");
    expect(runTitlesAnnouncement(3)).toBe("3 card titles need a fix.");
  });

  test("runTitlesToFix lists only the built parallels with titles to fix", () => {
    expect(runTitlesToFix(run())).toEqual({
      parallels: [
        { id: A, value: "Anime Gold" },
        { id: C, value: "Anime Bronze" },
      ],
      total: 3,
    });
  });
});

describe("the Fix card titles door on the ticker", () => {
  test("shows once the run has finished with titles to fix, and opens on its own once", async () => {
    render(<ParallelBuildPanel run={run()} onStop={() => {}} />);
    expect(screen.getByRole("button", { name: "Fix 3 card titles" })).toBeTruthy();
    await waitFor(() => expect(mockQuery).toHaveBeenCalled());
    expect(mockQuery.mock.calls.map((c) => c[1].parallelId)).toEqual([A, C]);
  });

  test("is not there while the run is live", async () => {
    render(<ParallelBuildPanel run={run({ phase: "running", atIndex: 2 })} onStop={() => {}} />);
    expect(screen.queryByRole("button", { name: /card titles?$/ })).toBeNull();
    await settle();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test("is not there when no title needs a fix", () => {
    const entries = run().entries.map((e) => ({ ...e, line: { kind: "built" as const, result: built() } }));
    render(<ParallelBuildPanel run={run({ entries })} onStop={() => {}} />);
    expect(screen.queryByRole("button", { name: /card titles?$/ })).toBeNull();
  });

  test("a run picked up after leaving gets the button but never opens on its own", async () => {
    render(<ParallelBuildPanel run={run({ phase: "left" })} onStop={() => {}} />);
    expect(screen.getByRole("button", { name: "Fix 3 card titles" })).toBeTruthy();
    await settle();
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe("the door's lines go through the ticker's one live line (a11y)", () => {
  test("no second live region in the banner; the live line says the door's line", async () => {
    const { container } = render(
      <ParallelBuildPanel run={run({ announcement: "Built 3 parallels." })} onStop={() => {}} />,
    );
    // Self-opens, finds nothing left to fix, says so.
    await waitFor(() =>
      expect(screen.getByText("Every title fits now. Nothing to fix.")).toBeTruthy(),
    );
    const live = container.querySelectorAll('[role="status"]');
    expect(live).toHaveLength(1);
    expect(live[0].textContent).toBe("Every title fits now. Nothing to fix.");
    // The visible line is plain text, outside any live region.
    const shown = screen.getByText("Every title fits now. Nothing to fix.", { selector: "span" });
    expect(shown.closest('[role="status"]')).toBeNull();
  });

  test("a new run's announcement takes the live line back", async () => {
    const { container, rerender } = render(
      <ParallelBuildPanel run={run({ announcement: "Built 3 parallels." })} onStop={() => {}} />,
    );
    await waitFor(() =>
      expect(container.querySelector('[role="status"]')!.textContent).toBe(
        "Every title fits now. Nothing to fix.",
      ),
    );
    rerender(
      <ParallelBuildPanel
        run={run({ startedFrom: B, phase: "running", atIndex: 0, announcement: "Building 3 parallels." })}
        onStop={() => {}}
      />,
    );
    expect(container.querySelector('[role="status"]')!.textContent).toBe("Building 3 parallels.");
  });
});
