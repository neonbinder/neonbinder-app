/**
 * NEO-321 — the "Parallels of Base" section: copy helpers, the disabled
 * states (aria-disabled + the reason line as the button's description), the
 * D4 confirm, and the start through the hosted runner.
 *
 * The runner is a stub (`ParallelBuildRunner`), so what is asserted is the
 * section's own contract: which row it hands `start` (the Parallel variant
 * type, never the source), when it asks first, and when it holds. The runner
 * itself is covered by ParallelBuildPanel.test.tsx; visibility on the page is
 * covered by modules/SetSelector.baseParallels.test.tsx.
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";

vi.mock("../../convex/_generated/api", () => ({
  api: {
    parallelChecklistBuild: {
      getParallelsForBuild: "getParallelsForBuild",
      buildParallelChecklist: "buildParallelChecklist",
    },
    parallelTypeSource: { setParallelTypeSource: "setParallelTypeSource" },
  },
}));

const mockConvex = { query: vi.fn(), action: vi.fn(), mutation: vi.fn() };
vi.mock("convex/react", () => ({
  useConvex: () => mockConvex,
  useQuery: vi.fn(),
  useAction: () => vi.fn(),
}));

import { ConvexError } from "convex/values";
import BaseParallelsBuildSection, {
  CANCEL_CHANGE_ARIA,
  CHANGE_SOURCE_ARIA,
  PICK_FAILED_TEXT,
  PICK_SOURCE_QUESTION,
  copyFromLabel,
  copyingFromText,
  pickFailedText,
  ALL_BLOCKED_TEXT,
  CONFIRM_LABEL,
  LOADING_TEXT,
  NO_PARALLELS_TEXT,
  BASE_PARALLELS_REASON_ID,
  NO_SOURCE_TEXT,
  OTHER_RUN_TEXT,
  attentionText,
  buildAllLabel,
  noSourceText,
  replaceConfirmCopy,
  sectionHeading,
  sourceEmptyText,
  summaryText,
  tallyParallels,
} from "./BaseParallelsBuildSection";
import {
  PARALLEL_BUILD_HEADING_ID,
  moreText,
  planFailedText,
  truncatedText,
  type ParallelBuildPlan,
  type ParallelBuildRunner,
  type ParallelPlanEntry,
  type ParallelRun,
} from "./ParallelBuildPanel";

const TYPE_ID = "vt-parallel" as unknown as Id<"selectorOptions">;
const SOURCE_ID = "vt-base" as unknown as Id<"selectorOptions">;

const NO_SIDES = { bsc: false, sportlots: false };
const SL_ONLY = { bsc: false, sportlots: true };

const entry = (
  n: number,
  over: Partial<ParallelPlanEntry> = {},
): ParallelPlanEntry => ({
  _id: `p-${n}` as unknown as Id<"selectorOptions">,
  value: `Parallel ${n}`,
  owned: { bsc: true, sportlots: false },
  sides: { bsc: true, sportlots: false },
  hasCards: false,
  ...over,
});

const planOf = (
  parallels: ParallelPlanEntry[],
  over: Partial<ParallelBuildPlan> = {},
): ParallelBuildPlan => ({
  parallels,
  truncated: false,
  source: { id: SOURCE_ID, value: "Base", kind: "base", hasCards: true },
  ...over,
});

function runnerStub(over: Partial<ParallelBuildRunner> = {}): ParallelBuildRunner {
  return {
    run: null,
    active: false,
    inFlight: new Set(),
    start: vi.fn().mockResolvedValue(null),
    stop: vi.fn(),
    buildOne: vi.fn(),
    ...over,
  };
}

function renderSection(
  plan: ParallelBuildPlan | undefined,
  runner = runnerStub(),
  showsRun = false,
) {
  const view = render(
    <BaseParallelsBuildSection
      variantTypeId={TYPE_ID}
      plan={plan}
      runner={runner}
      showsRun={showsRun}
    />,
  );
  return { runner, ...view };
}

const button = () => screen.getByRole("button", { name: /^Build / });

/** The element the button's aria-describedby points at. */
function description(el: HTMLElement) {
  const id = el.getAttribute("aria-describedby");
  return id ? document.getElementById(id) : null;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("BaseParallelsBuildSection — copy helpers", () => {
  it("names the source in the heading, with a neutral fallback before it is known", () => {
    expect(sectionHeading("Base")).toBe("Parallels of Base");
    expect(sectionHeading(undefined)).toBe("Parallels of the base set");
  });

  it("button label counts parallels, singular for one", () => {
    expect(buildAllLabel("Base", 12)).toBe("Build 12 parallels from Base");
    expect(buildAllLabel("Base", 1)).toBe("Build 1 parallel from Base");
  });

  it("button label carries no count until the list is in", () => {
    expect(buildAllLabel("Base", undefined)).toBe("Build parallels from Base");
    expect(buildAllLabel(undefined, undefined)).toBe(
      "Build parallels from the base set",
    );
  });

  it("noSourceText uses the server's reason when it gave one, a fixed sentence otherwise", () => {
    expect(noSourceText("two variant types are marked as the base")).toBe(
      "Nothing to copy from — two variant types are marked as the base.",
    );
    expect(noSourceText()).toBe(NO_SOURCE_TEXT);
  });

  it("sourceEmptyText names the source", () => {
    expect(sourceEmptyText("Base")).toBe(
      "Base has no cards yet — save its checklist first.",
    );
  });

  describe("tallyParallels", () => {
    it("counts every parallel that is not blocked toward replaced and filled, unlinked included (NEO-496 NQ2)", () => {
      const tally = tallyParallels([
        entry(1, { hasCards: true }), // replaced
        entry(2), // filled
        entry(3, { hasCards: true, owned: NO_SIDES, sides: NO_SIDES }), // unlinked, has cards: replaced
        entry(4, { hasCards: true, blocked: "scans" }), // blocked, has cards
        entry(5, { owned: SL_ONLY, sides: SL_ONLY }), // filled via SportLots only
      ]);
      expect(tally).toEqual({
        total: 5,
        withCards: 3,
        replaced: 2,
        filled: 2,
        unlinked: 1,
        blocked: 1,
      });
    });

    // NEO-496 — the four ways the list once called a parallel buildable (or
    // "unlinked") while the build refused it. The server now marks each one
    // `blocked` with the build's own sentence; the tally reads ownership.
    describe("parallels the build would refuse (NEO-496)", () => {
      const cases: Array<[string, Partial<ParallelPlanEntry>]> = [
        [
          "owns ids it can't reach",
          {
            owned: { bsc: true, sportlots: false },
            sides: NO_SIDES,
            blocked: "its BSC links need 2024 linked too — link 2024 first",
          },
        ],
        [
          "every owned side paused",
          {
            owned: { bsc: true, sportlots: true },
            sides: NO_SIDES,
            blocked: "BSC and SportLots are paused right now — build it once they're back",
          },
        ],
        [
          "unlinked over cards that hold links",
          {
            owned: NO_SIDES,
            sides: NO_SIDES,
            hasCards: true,
            blocked: "its cards have marketplace links this parallel doesn't. Link the parallel in Sync Parallels first.",
          },
        ],
        [
          "one side reachable, old links on the other",
          {
            owned: { bsc: true, sportlots: true },
            sides: { bsc: true, sportlots: false },
            hasCards: true,
            blocked: "its SportLots links need 2024 linked too — link 2024 first",
          },
        ],
      ];

      it.each(cases)("%s: counted blocked, never unlinked, replaced or filled", (_name, over) => {
        const tally = tallyParallels([entry(1), entry(2, over)]);
        expect(tally).toMatchObject({ total: 2, blocked: 1, unlinked: 0, replaced: 0, filled: 1 });
      });

      it.each(cases)("%s: named with the server's reason", (_name, over) => {
        const blocked = entry(2, over);
        expect(attentionText(blocked)).toBe(`Parallel 2 — blocked: ${over.blocked}`);
      });
    });

    it("counts unlinked by ownership, not by reach: owning ids it can't ask now is not unlinked", () => {
      // The server blocks such a parallel; were it ever sent unblocked, it
      // still owns ids, so its copies are not "no marketplace links".
      const tally = tallyParallels([entry(1, { owned: SL_ONLY, sides: NO_SIDES })]);
      expect(tally.unlinked).toBe(0);
    });
  });

  describe("summaryText", () => {
    const tally = (over = {}) => ({
      total: 1,
      withCards: 0,
      replaced: 0,
      filled: 0,
      unlinked: 0,
      blocked: 0,
      ...over,
    });

    it("says all empty, singular for one", () => {
      expect(summaryText(tally())).toBe("1 parallel, all empty.");
      expect(summaryText(tally({ total: 3 }))).toBe("3 parallels, all empty.");
    });

    it("says all with cards", () => {
      expect(summaryText(tally({ total: 2, withCards: 2 }))).toBe(
        "2 parallels, all with cards.",
      );
      expect(summaryText(tally({ total: 1, withCards: 1 }))).toBe(
        "1 parallel, all with cards.",
      );
    });

    it("splits a mixed list into empty and with-cards", () => {
      expect(summaryText(tally({ total: 12, withCards: 3 }))).toBe(
        "12 parallels: 9 empty, 3 with cards.",
      );
    });

    it("adds the unlinked and blocked sentences only when true, singular and plural", () => {
      expect(summaryText(tally({ total: 4, unlinked: 1, blocked: 1 }))).toBe(
        "4 parallels, all empty. 1 has no marketplace link yet, so its cards copy over without one. 1 is blocked.",
      );
      expect(summaryText(tally({ total: 5, unlinked: 2, blocked: 3 }))).toBe(
        "5 parallels, all empty. 2 have no marketplace link yet, so their cards copy over without one. 3 are blocked.",
      );
    });
  });

  describe("replaceConfirmCopy", () => {
    const tally = (over = {}) => ({
      total: 4,
      withCards: 2,
      replaced: 2,
      filled: 2,
      unlinked: 0,
      blocked: 0,
      ...over,
    });

    it("names K of N in the title and says 'those parallels' for several", () => {
      const { title, description } = replaceConfirmCopy("Base", tally());
      expect(title).toContain("Replace the cards on 2 of 4 parallels");
      expect(description).toContain("Every card on those parallels");
      expect(description).toContain("The 2 empty ones just get filled.");
    });

    it("uses singular forms for one replaced and one empty", () => {
      const { title, description } = replaceConfirmCopy(
        "Base",
        tally({ total: 2, replaced: 1, filled: 1 }),
      );
      expect(title).toContain("Replace the cards on 1 of 2 parallels");
      expect(description).toContain("Every card on that parallel");
      expect(description).toContain("The empty one just gets filled.");
    });

    it("omits the filled sentence when nothing is empty, and says 1 parallel for a single-parallel list", () => {
      const { title, description } = replaceConfirmCopy(
        "Base",
        tally({ total: 1, replaced: 1, filled: 0 }),
      );
      expect(title).toContain("1 of 1 parallel with");
      expect(description).not.toContain("empty");
    });
  });
});

describe("BaseParallelsBuildSection — what the operator sees", () => {
  it("shows the heading, the summary and the explainer once the plan is in", () => {
    renderSection(planOf([entry(1, { hasCards: true }), entry(2)]));
    expect(
      screen.getByRole("heading", { name: "Parallels of Base" }),
    ).toBeTruthy();
    expect(screen.getByText(/2 parallels: 1 empty, 1 with cards\./)).toBeTruthy();
    expect(screen.getByText(/Each one gets a fresh copy of Base/)).toBeTruthy();
    expect(button().textContent).toBe("Build 2 parallels from Base");
  });

  it("the heading and button follow the server's source name, so a renamed Base reads the same way", () => {
    renderSection(
      planOf([entry(1)], {
        source: {
          id: SOURCE_ID,
          value: "Flagship",
          kind: "base",
          hasCards: true,
        },
      }),
    );
    expect(
      screen.getByRole("heading", { name: "Parallels of Flagship" }),
    ).toBeTruthy();
    expect(button().textContent).toBe("Build 1 parallel from Flagship");
  });
});

describe("BaseParallelsBuildSection — disabled states", () => {
  /**
   * Every held state: aria-disabled, never native `disabled` (so the reason
   * stays reachable and focus stays put), the reason line is the button's
   * description, and neither a click nor Enter starts anything.
   */
  function expectHeld(reasonText: string, runner: ParallelBuildRunner) {
    const b = button();
    expect(b.getAttribute("aria-disabled")).toBe("true");
    expect((b as HTMLButtonElement).disabled).toBe(false);
    expect(description(b)?.textContent).toBe(reasonText);

    fireEvent.click(b);
    fireEvent.keyDown(b, { key: "Enter" });
    expect(runner.start).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  }

  it("while the plan is loading: held, described by the counting line", () => {
    const { runner } = renderSection(undefined);
    expectHeld(LOADING_TEXT, runner);
  });

  it("when the server found no single source: held, with the server's reason", () => {
    const { runner } = renderSection(
      planOf([], {
        source: null,
        sourceBlocked: "two variant types are marked as the base",
      }),
    );
    expectHeld(
      "Nothing to copy from — two variant types are marked as the base.",
      runner,
    );
  });

  it("when there is no source and no reason: held, with the fixed sentence", () => {
    const { runner } = renderSection(planOf([entry(1)], { source: null }));
    expectHeld(NO_SOURCE_TEXT, runner);
  });

  it("when the source has no cards: held, even though parallels exist", () => {
    const { runner } = renderSection(
      planOf([entry(1)], {
        source: { id: SOURCE_ID, value: "Base", kind: "base", hasCards: false },
      }),
    );
    expectHeld("Base has no cards yet — save its checklist first.", runner);
  });

  it("when the list is empty: held, pointing at sync or add", () => {
    const { runner } = renderSection(planOf([]));
    expectHeld(NO_PARALLELS_TEXT, runner);
  });

  it("when every parallel is blocked: held, saying so, and no run starts", () => {
    const why = "SportLots is paused right now — build it once it's back";
    const { runner } = renderSection(
      planOf([entry(1, { blocked: why }), entry(2, { hasCards: true, blocked: why })]),
    );
    expectHeld(ALL_BLOCKED_TEXT, runner);
    expect(ALL_BLOCKED_TEXT).toBe(
      "Every parallel here is blocked. Clear what's listed above, then build.",
    );
  });

  it("with one parallel still buildable it is not held for the blocked ones", () => {
    const why = "SportLots is paused right now — build it once it's back";
    renderSection(planOf([entry(1, { blocked: why }), entry(2)]));
    expect(screen.queryByText(ALL_BLOCKED_TEXT)).toBeNull();
  });

  it("while another run is live: held, described by the other-run line", () => {
    const { runner } = renderSection(
      planOf([entry(1)]),
      runnerStub({ active: true }),
      false,
    );
    expectHeld(OTHER_RUN_TEXT, runner);
  });

  it("while its own run is live: held and described by the ledger heading, with no reason line", () => {
    const run: ParallelRun = {
      startedFrom: TYPE_ID,
      sourceId: SOURCE_ID,
      sourceValue: "Base",
      sourceKind: "base",
      entries: [
        { id: entry(1)._id, value: "Parallel 1", line: { kind: "building" } },
      ],
      truncated: false,
      phase: "running",
      atIndex: 0,
      announcement: "",
    };
    const runner = runnerStub({ run, active: true });
    renderSection(planOf([entry(1)]), runner, true);

    const b = button();
    expect(b.getAttribute("aria-disabled")).toBe("true");
    expect(b.getAttribute("aria-describedby")).toBe(PARALLEL_BUILD_HEADING_ID);
    expect(document.getElementById(PARALLEL_BUILD_HEADING_ID)).toBeTruthy();
    expect(screen.queryByText(OTHER_RUN_TEXT)).toBeNull();

    fireEvent.click(b);
    expect(runner.start).not.toHaveBeenCalled();
  });

  it("is not held when everything is in place", () => {
    renderSection(planOf([entry(1)]));
    const b = button();
    expect(b.getAttribute("aria-disabled")).toBeNull();
    expect(b.getAttribute("aria-describedby")).toBeNull();
  });
});

describe("BaseParallelsBuildSection — starting the run", () => {
  it("starts through the runner with the Parallel variant type as the start row, over empty parallels, with no confirm", () => {
    const { runner } = renderSection(planOf([entry(1), entry(2)]));
    fireEvent.click(button());

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(runner.start).toHaveBeenCalledTimes(1);
    // The row it stands on (the variant type), carrying the SOURCE's name —
    // not the source's id, which the server resolves itself.
    expect(runner.start).toHaveBeenCalledWith(
      { id: TYPE_ID, value: "Base" },
      mockConvex,
    );
  });

  it("Enter on the focused button starts it too", () => {
    const { runner } = renderSection(planOf([entry(1)]));
    fireEvent.keyDown(button(), { key: "Enter" });
    expect(runner.start).toHaveBeenCalledTimes(1);
  });

  it("says so in an alert when the list could not be read", async () => {
    const runner = runnerStub({
      start: vi.fn().mockResolvedValue("network down"),
    });
    renderSection(planOf([entry(1)]), runner);
    fireEvent.click(button());

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(planFailedText("network down"));
  });

  it("shows no alert when the run starts cleanly", async () => {
    const { runner } = renderSection(planOf([entry(1)]));
    fireEvent.click(button());
    await waitFor(() => expect(runner.start).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("BaseParallelsBuildSection — D4 confirm", () => {
  it("asks first when K > 0 buildable parallels already have cards, and starts nothing yet", () => {
    const { runner } = renderSection(
      planOf([entry(1, { hasCards: true }), entry(2, { hasCards: true }), entry(3)]),
    );
    expect(button().getAttribute("aria-haspopup")).toBe("dialog");
    fireEvent.click(button());

    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("Replace the cards on 2 of 3 parallels");
    expect(runner.start).not.toHaveBeenCalled();
  });

  it("does not ask when every parallel is empty", () => {
    const { runner } = renderSection(planOf([entry(1), entry(2)]));
    expect(button().getAttribute("aria-haspopup")).toBeNull();
    fireEvent.click(button());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(runner.start).toHaveBeenCalledTimes(1);
  });

  it("does not ask when the only parallels with cards are ones the run would refuse", () => {
    // K counts what a run would REPLACE: a blocked one is refused, so it
    // loses nothing.
    const { runner } = renderSection(
      planOf([entry(1), entry(3, { hasCards: true, blocked: "scans" })]),
    );
    fireEvent.click(button());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(runner.start).toHaveBeenCalledTimes(1);
  });

  it("asks when an unlinked parallel holds cards: the run replaces them too (NEO-496 NQ2)", () => {
    renderSection(
      planOf([entry(1), entry(2, { hasCards: true, owned: NO_SIDES, sides: NO_SIDES })]),
    );
    fireEvent.click(button());
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("Cancel closes it without starting, and puts focus back on the button", async () => {
    const { runner } = renderSection(planOf([entry(1, { hasCards: true })]));
    const trigger = button();
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(runner.start).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(button()));
  });

  it("Escape cancels without starting", () => {
    const { runner } = renderSection(planOf([entry(1, { hasCards: true })]));
    fireEvent.click(button());
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(runner.start).not.toHaveBeenCalled();
  });

  it("Confirm starts the run through the runner with the variant type as the start row", async () => {
    const { runner } = renderSection(planOf([entry(1, { hasCards: true })]));
    fireEvent.click(button());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: CONFIRM_LABEL }));
    });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(runner.start).toHaveBeenCalledTimes(1);
    expect(runner.start).toHaveBeenCalledWith(
      { id: TYPE_ID, value: "Base" },
      mockConvex,
    );
  });
});

const UNLINKED = { bsc: false, sportlots: false };

describe("BaseParallelsBuildSection — the attention list", () => {
  const items = () => screen.queryAllByRole("listitem").map((li) => li.textContent);

  it("attentionText names a blocked parallel with the server's reason", () => {
    expect(attentionText(entry(1, { blocked: "some cards have scans" }))).toBe(
      "Parallel 1 — blocked: some cards have scans",
    );
  });

  it("attentionText is null for an unlinked parallel: it builds an unlinked copy (NEO-496 NQ2)", () => {
    expect(attentionText(entry(2, { owned: UNLINKED, sides: UNLINKED }))).toBeNull();
  });

  it("attentionText is null for a parallel the run will build, and blocked wins over unlinked", () => {
    expect(attentionText(entry(3))).toBeNull();
    expect(attentionText(entry(4, { owned: UNLINKED, sides: UNLINKED, blocked: "scans" }))).toBe(
      "Parallel 4 — blocked: scans",
    );
  });

  it("lists one line per blocked parallel, with the reason, and none for the rest (an unlinked one builds)", () => {
    renderSection(
      planOf([
        entry(1),
        entry(2, { blocked: "scans" }),
        entry(3, { owned: UNLINKED, sides: UNLINKED }),
        entry(4, { hasCards: true }),
      ]),
    );
    expect(items()).toEqual(["Parallel 2 — blocked: scans"]);
  });

  it("a parallel the build would refuse for a paused side is listed blocked, not called unlinked (NEO-496)", () => {
    const paused = "SportLots is paused right now — build it once it's back";
    renderSection(
      planOf([entry(1), entry(2, { owned: SL_ONLY, sides: NO_SIDES, blocked: paused })]),
    );
    expect(items()).toEqual([`Parallel 2 — blocked: ${paused}`]);
    expect(screen.getByText(/1 is blocked\./)).toBeTruthy();
    expect(screen.queryByText(/no marketplace link yet/)).toBeNull();
  });

  it("is absent when nothing is blocked, unlinked parallels included", () => {
    renderSection(planOf([entry(1), entry(2, { hasCards: true }), entry(3, { owned: UNLINKED, sides: UNLINKED })]));
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("shows all of them at exactly 10, with no overflow line", () => {
    renderSection(planOf(Array.from({ length: 10 }, (_, i) => entry(i + 1, { blocked: "scans" }))));
    expect(items()).toHaveLength(10);
    expect(screen.queryByText(/…and \d+ more/)).toBeNull();
  });

  it("caps at 10 lines and says how many more", () => {
    renderSection(planOf(Array.from({ length: 13 }, (_, i) => entry(i + 1, { blocked: "scans" }))));
    const lines = items();
    expect(lines).toHaveLength(11);
    expect(lines[0]).toBe("Parallel 1 — blocked: scans");
    expect(lines[9]).toBe("Parallel 10 — blocked: scans");
    expect(lines[10]).toBe(moreText(3));
  });
});

describe("BaseParallelsBuildSection — truncated list", () => {
  it("appends the truncated sentence to the summary when the plan is truncated", () => {
    renderSection(planOf([entry(1), entry(2)], { truncated: true }));
    expect(screen.getByText(new RegExp(truncatedText(2).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))).toBeTruthy();
  });

  it("says nothing about truncation otherwise", () => {
    renderSection(planOf([entry(1), entry(2)]));
    expect(screen.queryByText(/Only the first/)).toBeNull();
  });
});

describe("BaseParallelsBuildSection — outline and reason id", () => {
  it("nests the run's heading one level under the section's own h3", () => {
    const run: ParallelRun = {
      startedFrom: TYPE_ID,
      sourceId: SOURCE_ID,
      sourceValue: "Base",
      sourceKind: "base",
      entries: [{ id: entry(1)._id, value: "Parallel 1", line: { kind: "building" } }],
      truncated: false,
      phase: "running",
      atIndex: 0,
      announcement: "",
    };
    renderSection(planOf([entry(1)]), runnerStub({ run, active: true }), true);
    expect(screen.getByRole("heading", { level: 3, name: "Parallels of Base" })).toBeTruthy();
    const nested = document.getElementById(PARALLEL_BUILD_HEADING_ID)!;
    expect(nested.tagName).toBe("H4");
  });

  it("the reason line carries the exported id the base-parallel rows point at", () => {
    renderSection(planOf([], { source: null, sourceBlocked: "no base" }));
    expect(document.getElementById(BASE_PARALLELS_REASON_ID)?.textContent).toBe(
      noSourceText("no base"),
    );
  });
});

/**
 * NEO-673 — a set with no Base asks which parallel the others copy from, and
 * lets the operator change the answer. The mutation goes through the client
 * the section already holds.
 */
describe("BaseParallelsBuildSection — picking the parallel the others copy from (NEO-673)", () => {
  const SILVER_ID = "p-silver" as unknown as Id<"selectorOptions">;
  const silver = (over: Partial<ParallelPlanEntry> = {}) =>
    entry(1, { _id: SILVER_ID, value: "Silver", hasCards: true, ...over });
  const gold = () => entry(2, { value: "Gold", hasCards: true });
  const ruby = () => entry(3, { value: "Ruby" });

  const pickablePlan = () =>
    planOf([silver(), gold(), ruby()], { source: null, sourcePickable: true });
  const chosenPlan = () =>
    planOf([gold(), ruby()], {
      source: { id: SILVER_ID, value: "Silver", kind: "chosenParallel", hasCards: true },
    });

  const radios = () => screen.queryAllByRole("radio");
  const copyFrom = () => screen.getByRole("button", { name: /^Copy from/ });
  const change = () => screen.getByRole("button", { name: CHANGE_SOURCE_ARIA });
  const cancel = () => screen.getByRole("button", { name: CANCEL_CHANGE_ARIA });

  beforeEach(() => {
    mockConvex.mutation.mockReset();
    mockConvex.mutation.mockResolvedValue(null);
  });

  it("a set with a Base shows no radiogroup and no Change", () => {
    renderSection(planOf([gold()]));
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.queryByRole("button", { name: CHANGE_SOURCE_ARIA })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Copy from/ })).toBeNull();
    expect(button().textContent).toBe("Build 1 parallel from Base");
  });

  it("with no Base and a pickable list, asks the question as a radiogroup, in server order, none checked", () => {
    renderSection(pickablePlan());
    const group = screen.getByRole("radiogroup", { name: PICK_SOURCE_QUESTION });
    expect(group).toBeTruthy();
    expect(radios().map((r) => r.textContent)).toEqual(["Silver", "Gold", "Ruby"]);
    expect(radios().map((r) => r.getAttribute("aria-checked"))).toEqual([
      "false",
      "false",
      "false",
    ]);
  });

  it("while picking, shows no card counts, no build button and no summary", () => {
    renderSection(pickablePlan());
    expect(screen.queryByText(/\bcards?\b/)).toBeNull();
    expect(screen.queryByRole("button", { name: /^Build / })).toBeNull();
    expect(screen.queryByText(summaryText(tallyParallels(pickablePlan().parallels)))).toBeNull();
  });

  it("while picking, the reason id is on the question, which is what a parallel row's stand-in is described by", () => {
    renderSection(pickablePlan());
    const el = document.getElementById(BASE_PARALLELS_REASON_ID);
    expect(el?.textContent).toBe(PICK_SOURCE_QUESTION);
    expect(screen.getByRole("radiogroup").getAttribute("aria-labelledby")).toBe(
      BASE_PARALLELS_REASON_ID,
    );
  });

  it("Copy from… is aria-disabled until a pick, and a click does nothing", () => {
    renderSection(pickablePlan());
    expect(copyFrom().textContent).toBe("Copy from…");
    expect(copyFrom().getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(copyFrom());
    expect(mockConvex.mutation).not.toHaveBeenCalled();
  });

  it("picking Silver names it on the button and enables it", () => {
    renderSection(pickablePlan());
    fireEvent.click(screen.getByRole("radio", { name: "Silver" }));
    expect(copyFrom().textContent).toBe(copyFromLabel("Silver"));
    expect(copyFrom().textContent).toBe("Copy from Silver");
    expect(copyFrom().getAttribute("aria-disabled")).toBeNull();
  });

  it("saving calls setParallelTypeSource with the type and the picked parallel", async () => {
    renderSection(pickablePlan());
    fireEvent.click(screen.getByRole("radio", { name: "Silver" }));
    await act(async () => {
      fireEvent.click(copyFrom());
    });
    expect(mockConvex.mutation).toHaveBeenCalledTimes(1);
    expect(mockConvex.mutation).toHaveBeenCalledWith("setParallelTypeSource", {
      parallelTypeId: TYPE_ID,
      sourceId: SILVER_ID,
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a ConvexError's own sentence shows in the alert", async () => {
    mockConvex.mutation.mockRejectedValue(new ConvexError("Silver has no cards yet."));
    renderSection(pickablePlan());
    fireEvent.click(screen.getByRole("radio", { name: "Silver" }));
    await act(async () => {
      fireEvent.click(copyFrom());
    });
    expect(screen.getByRole("alert").textContent).toBe("Silver has no cards yet.");
  });

  it("any other failure shows the fixed sentence", async () => {
    mockConvex.mutation.mockRejectedValue(new Error("Server Error: boom"));
    renderSection(pickablePlan());
    fireEvent.click(screen.getByRole("radio", { name: "Gold" }));
    await act(async () => {
      fireEvent.click(copyFrom());
    });
    expect(screen.getByRole("alert").textContent).toBe("Couldn't save that choice. Try again.");
    expect(PICK_FAILED_TEXT).toBe("Couldn't save that choice. Try again.");
  });

  it("pickFailedText falls back for an empty or non-string data and for non-errors", () => {
    expect(pickFailedText(new ConvexError(""))).toBe(PICK_FAILED_TEXT);
    expect(pickFailedText(new ConvexError({ code: 1 }))).toBe(PICK_FAILED_TEXT);
    expect(pickFailedText(undefined)).toBe(PICK_FAILED_TEXT);
    expect(pickFailedText("nope")).toBe(PICK_FAILED_TEXT);
  });

  it("a failed save leaves the pick in place for another try", async () => {
    mockConvex.mutation.mockRejectedValueOnce(new Error("boom"));
    renderSection(pickablePlan());
    fireEvent.click(screen.getByRole("radio", { name: "Silver" }));
    await act(async () => {
      fireEvent.click(copyFrom());
    });
    expect(screen.getByRole("radio", { name: "Silver" }).getAttribute("aria-checked")).toBe("true");
    await act(async () => {
      fireEvent.click(copyFrom());
    });
    expect(mockConvex.mutation).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  describe("focus, announcement and the held button (NEO-673 audit)", () => {
    const heading = () => screen.getByRole("heading", { level: 3 });
    const status = () => screen.getByRole("status");

    /** A mutation the test resolves by hand, after the "server" has moved. */
    function deferred() {
      let resolve!: (value: null) => void;
      let reject!: (error: Error) => void;
      const promise = new Promise<null>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    }

    it("the status line is always mounted, empty until there is something to say", () => {
      renderSection(pickablePlan());
      expect(status().textContent).toBe("");
    });

    it("a first pick parks focus on the heading before the write, then lands on Change", async () => {
      const write = deferred();
      mockConvex.mutation.mockReturnValue(write.promise);
      const { rerender, runner } = renderSection(pickablePlan());
      fireEvent.click(screen.getByRole("radio", { name: "Silver" }));
      screen.getByRole("radio", { name: "Silver" }).focus();
      await act(async () => {
        fireEvent.click(copyFrom());
      });
      // Parked, and the picker still shows the pick (no flash of "Copy from…").
      expect(document.activeElement).toBe(heading());
      expect(copyFrom().textContent).toBe("Copy from Silver");
      expect(status().textContent).toBe("Saving…");
      // The server moves: the plan now has a chosen source, and the write lands.
      rerender(
        <BaseParallelsBuildSection
          variantTypeId={TYPE_ID}
          plan={chosenPlan()}
          runner={runner}
          showsRun={false}
        />,
      );
      await act(async () => {
        write.resolve(null);
      });
      expect(screen.queryByRole("radiogroup")).toBeNull();
      expect(document.activeElement).toBe(change());
      expect(status().textContent).toBe(copyingFromText("Silver"));
    });

    it("a first pick that fails puts focus back on the button and says so in the alert", async () => {
      const write = deferred();
      mockConvex.mutation.mockReturnValue(write.promise);
      renderSection(pickablePlan());
      fireEvent.click(screen.getByRole("radio", { name: "Gold" }));
      await act(async () => {
        fireEvent.click(copyFrom());
      });
      expect(document.activeElement).toBe(heading());
      await act(async () => {
        write.reject(new Error("boom"));
      });
      expect(document.activeElement).toBe(copyFrom());
      expect(screen.getByRole("alert").textContent).toBe(PICK_FAILED_TEXT);
      expect(status().textContent).toBe("");
    });

    it("a first pick whose Change never draws (a run started) leaves focus on the heading", async () => {
      const write = deferred();
      mockConvex.mutation.mockReturnValue(write.promise);
      const { rerender } = renderSection(pickablePlan());
      fireEvent.click(screen.getByRole("radio", { name: "Silver" }));
      await act(async () => {
        fireEvent.click(copyFrom());
      });
      rerender(
        <BaseParallelsBuildSection
          variantTypeId={TYPE_ID}
          plan={chosenPlan()}
          runner={runnerStub({ active: true })}
          showsRun={false}
        />,
      );
      await act(async () => {
        write.resolve(null);
      });
      expect(screen.queryByRole("button", { name: CHANGE_SOURCE_ARIA })).toBeNull();
      expect(document.activeElement).toBe(heading());
    });

    it("saving a change says Saving…, then Copying from the new pick, and focuses Change", async () => {
      const write = deferred();
      mockConvex.mutation.mockReturnValue(write.promise);
      const { rerender, runner } = renderSection(chosenPlan());
      fireEvent.click(change());
      fireEvent.click(screen.getByRole("radio", { name: "Gold" }));
      await act(async () => {
        fireEvent.click(copyFrom());
      });
      expect(status().textContent).toBe("Saving…");
      const goldPlan = planOf([silver(), ruby()], {
        source: { id: gold()._id, value: "Gold", kind: "chosenParallel", hasCards: true },
      });
      rerender(
        <BaseParallelsBuildSection
          variantTypeId={TYPE_ID}
          plan={goldPlan}
          runner={runner}
          showsRun={false}
        />,
      );
      await act(async () => {
        write.resolve(null);
      });
      expect(status().textContent).toBe("Copying from Gold");
      expect(document.activeElement).toBe(change());
    });

    it("the save status and the alert are different regions: a failure is an alert, not a status", async () => {
      mockConvex.mutation.mockRejectedValue(new Error("boom"));
      renderSection(pickablePlan());
      fireEvent.click(screen.getByRole("radio", { name: "Silver" }));
      await act(async () => {
        fireEvent.click(copyFrom());
      });
      expect(status().textContent).toBe("");
      expect(screen.getByRole("alert")).toBeTruthy();
    });

    it("with no list yet, shows the loading text instead of an empty radiogroup", () => {
      const plan = { source: null, sourcePickable: true } as unknown as ParallelBuildPlan;
      renderSection(plan);
      expect(screen.queryByRole("radiogroup")).toBeNull();
      expect(screen.getByText(LOADING_TEXT)).toBeTruthy();
    });

    it("the group is required, and pressing the held button moves focus to it", () => {
      renderSection(pickablePlan());
      const group = screen.getByRole("radiogroup", { name: PICK_SOURCE_QUESTION });
      expect(group.getAttribute("aria-required")).toBe("true");
      fireEvent.click(copyFrom());
      expect(document.activeElement).toBe(group);
      expect(mockConvex.mutation).not.toHaveBeenCalled();
    });

    it("Enter on the held button does the same", () => {
      renderSection(pickablePlan());
      copyFrom().focus();
      fireEvent.keyDown(copyFrom(), { key: "Enter" });
      expect(document.activeElement).toBe(screen.getByRole("radiogroup"));
      expect(mockConvex.mutation).not.toHaveBeenCalled();
    });

    it("choosing again clears the last failure", async () => {
      mockConvex.mutation.mockRejectedValueOnce(new Error("boom"));
      renderSection(pickablePlan());
      fireEvent.click(screen.getByRole("radio", { name: "Silver" }));
      await act(async () => {
        fireEvent.click(copyFrom());
      });
      expect(screen.getByRole("alert")).toBeTruthy();
      fireEvent.click(screen.getByRole("radio", { name: "Gold" }));
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("Change is a roomy target: padded out, margin pulled back", () => {
      renderSection(chosenPlan());
      expect(change().className).toContain("p-2");
      expect(change().className).toContain("-m-2");
    });
  });

  describe("once chosen", () => {
    it("says what it copies from, offers Change, and builds from the pick", () => {
      renderSection(chosenPlan());
      expect(screen.getByText(copyingFromText("Silver"))).toBeTruthy();
      expect(change().textContent).toBe("Change");
      expect(button().textContent).toBe("Build 2 parallels from Silver");
      expect(screen.queryByRole("radiogroup")).toBeNull();
    });

    it("Change reopens the same list with nothing checked, and focuses its first radio", () => {
      renderSection(chosenPlan());
      fireEvent.click(change());
      expect(radios().map((r) => r.textContent)).toEqual(["Silver", "Gold", "Ruby"]);
      expect(radios().map((r) => r.getAttribute("aria-checked"))).toEqual([
        "false",
        "false",
        "false",
      ]);
      expect(document.activeElement).toBe(screen.getByRole("radio", { name: "Silver" }));
      expect(screen.queryByRole("button", { name: /^Build / })).toBeNull();
      expect(copyFrom().textContent).toBe("Copy from…");
      expect(copyFrom().getAttribute("aria-disabled")).toBe("true");
    });

    it("Change slots the standing pick in at the server's position, not first", () => {
      const plan = chosenPlan();
      renderSection({
        ...plan,
        source: { ...plan.source!, position: 1 },
      });
      fireEvent.click(change());
      expect(radios().map((r) => r.textContent)).toEqual(["Gold", "Silver", "Ruby"]);
      // Focus is the first radio (the group's tab stop), whatever is standing.
      expect(document.activeElement).toBe(screen.getByRole("radio", { name: "Gold" }));
    });

    it("a position past the end lands last", () => {
      const plan = chosenPlan();
      const { unmount } = renderSection({
        ...plan,
        source: { ...plan.source!, position: 9 },
      });
      fireEvent.click(change());
      expect(radios().map((r) => r.textContent)).toEqual(["Gold", "Ruby", "Silver"]);
      unmount();
    });

    it("saving a different pick while changing sends that parallel", async () => {
      renderSection(chosenPlan());
      fireEvent.click(change());
      fireEvent.click(screen.getByRole("radio", { name: "Gold" }));
      await act(async () => {
        fireEvent.click(copyFrom());
      });
      expect(mockConvex.mutation).toHaveBeenCalledWith("setParallelTypeSource", {
        parallelTypeId: TYPE_ID,
        sourceId: gold()._id,
      });
    });

    it("Cancel restores the summary and returns focus to Change", () => {
      renderSection(chosenPlan());
      fireEvent.click(change());
      fireEvent.click(cancel());
      expect(screen.queryByRole("radiogroup")).toBeNull();
      expect(document.activeElement).toBe(change());
      expect(mockConvex.mutation).not.toHaveBeenCalled();
      expect(button().textContent).toBe("Build 2 parallels from Silver");
    });

    it("Escape in the list restores it and returns focus to Change", () => {
      renderSection(chosenPlan());
      fireEvent.click(change());
      fireEvent.keyDown(screen.getByRole("radio", { name: "Silver" }), { key: "Escape" });
      expect(screen.queryByRole("radiogroup")).toBeNull();
      expect(document.activeElement).toBe(change());
    });

    it("the first pick has no Cancel: there is nothing to go back to", () => {
      renderSection(pickablePlan());
      expect(screen.queryByRole("button", { name: CANCEL_CHANGE_ARIA })).toBeNull();
    });

    it("Change is hidden while a run is active", () => {
      renderSection(chosenPlan(), runnerStub({ active: true }));
      expect(screen.getByText(copyingFromText("Silver"))).toBeTruthy();
      expect(screen.queryByRole("button", { name: CHANGE_SOURCE_ARIA })).toBeNull();
    });
  });
});
