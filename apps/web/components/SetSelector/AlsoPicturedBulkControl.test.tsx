/**
 * NEO-528 — the Attributes panel's "Also on every card" control:
 * the pure run steps (what each page does to the ledger, and the words), and
 * the control end to end against a stubbed client that pages like the
 * server (`cardSecondaryPlayers.addSecondaryPlayerToVariant` and friends).
 */

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import { ConvexError } from "convex/values";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../convex/_generated/api", () => ({
  api: {
    players: { getManyByIds: "players.getManyByIds" },
    cardSecondaryPlayers: {
      secondaryPlayerBulkTargets: "cardSecondaryPlayers.secondaryPlayerBulkTargets",
      addSecondaryPlayerToVariant: "cardSecondaryPlayers.addSecondaryPlayerToVariant",
      removeSecondaryPlayerFromVariant: "cardSecondaryPlayers.removeSecondaryPlayerFromVariant",
    },
  },
}));

const mockQuery = vi.fn();
const mockMutation = vi.fn();
let playerRows: Array<{ _id: string; name: string }> | undefined;

vi.mock("convex/react", () => ({
  useConvex: () => ({ query: mockQuery, mutation: mockMutation }),
  useQuery: (ref: string, args: unknown) =>
    ref === "players.getManyByIds" && args !== "skip" ? playerRows : undefined,
}));

/** A stand-in picker: one press picks "p1", another picks "p2". */
vi.mock("./PlayerPicker", () => ({
  default: ({
    value,
    onChange,
    labels,
    disabled,
    ariaDescribedBy,
    roomyTriggerOnPhones,
  }: {
    value: string[];
    onChange: (next: string[]) => void;
    labels?: { root: string };
    disabled?: boolean;
    ariaDescribedBy?: string;
    roomyTriggerOnPhones?: boolean;
  }) => (
    <div
      aria-label={labels?.root}
      data-described-by={ariaDescribedBy ?? ""}
      data-roomy={roomyTriggerOnPhones ? "yes" : "no"}
    >
      <span>Picked: {value.join(",")}</span>
      <button type="button" disabled={disabled} onClick={() => onChange([...value, "p1"])}>
        Stub pick p1
      </button>
      <button type="button" disabled={disabled} onClick={() => onChange([...value, "p2"])}>
        Stub pick p2
      </button>
    </div>
  ),
}));

import AlsoPicturedBulkControl, {
  BULK_ADD_LABEL,
  BULK_CHECKLIST_CHANGED_TEXT,
  BULK_DISMISS_LABEL,
  BULK_PLAYER_GONE_TEXT,
  BULK_REMOVE_LABEL,
  BULK_STOP_LABEL,
  applyPage,
  bulkErrorText,
  bulkHeading,
  bulkHintText,
  bulkLineText,
  failRun,
  lineResultText,
  scopeText,
  startRun,
  stopRun,
  type BulkPage,
  type BulkTarget,
} from "./AlsoPicturedBulkControl";
import {
  ALSO_ON_EVERY_CARD_HEADING,
  BULK_ALSO_PICTURED_PICKER_LABELS,
} from "./player-picker-labels";
import type { Id } from "../../convex/_generated/dataModel";

const VARIANT = "variant-1" as unknown as Id<"selectorOptions">;
const SPORT = "sport-1" as unknown as Id<"selectorOptions">;

const target = (id: string, name: string, role: "home" | "parallel" = "parallel"): BulkTarget => ({
  _id: id as unknown as Id<"selectorOptions">,
  name,
  role,
});

const TARGETS = [target("t0", "Base", "home"), target("t1", "Gold"), target("t2", "Black")];

function page(over: Partial<BulkPage> & Pick<BulkPage, "targetIndex" | "cursor">): BulkPage {
  return {
    targetId: TARGETS[over.targetIndex]._id,
    targetCount: TARGETS.length,
    scanned: 0,
    changed: 0,
    unchanged: 0,
    skippedPrimary: 0,
    skippedFull: 0,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Pure steps
// ---------------------------------------------------------------------------

describe("also-pictured bulk run — the words", () => {
  it("names the scope by the checklist and how many parallels come with it", () => {
    expect(scopeText([TARGETS[0]])).toBe("Base");
    expect(scopeText(TARGETS.slice(0, 2))).toBe("Base and its 1 parallel");
    expect(scopeText(TARGETS)).toBe("Base and its 2 parallels");
  });

  it("an add line says what changed and every reason a card was left alone", () => {
    expect(
      lineResultText(
        "add",
        { scanned: 50, changed: 45, unchanged: 2, skippedPrimary: 2, skippedFull: 1 },
        "Dan Marino",
      ),
    ).toBe(
      "added to 45 cards, 2 already listed, skipped 2 of Dan Marino's own, skipped 1 already listing 20",
    );
    expect(
      lineResultText("add", { scanned: 3, changed: 0, unchanged: 3, skippedPrimary: 0, skippedFull: 0 }, "Ross"),
    ).toBe("nothing new, 3 already listed");
    expect(
      lineResultText("add", { scanned: 1, changed: 0, unchanged: 0, skippedPrimary: 1, skippedFull: 0 }, "Chris"),
    ).toBe("nothing new, skipped 1 of Chris' own");
  });

  it("a remove line says how many it came off, or that he was on none", () => {
    expect(
      lineResultText("remove", { scanned: 9, changed: 1, unchanged: 8, skippedPrimary: 0, skippedFull: 0 }, "X"),
    ).toBe("taken off 1 card");
    expect(
      lineResultText("remove", { scanned: 9, changed: 0, unchanged: 9, skippedPrimary: 0, skippedFull: 0 }, "X"),
    ).toBe("not on any card here");
  });

  it("a checklist with no cards says so rather than claiming a result", () => {
    expect(lineResultText("add", { scanned: 0, changed: 0, unchanged: 0, skippedPrimary: 0, skippedFull: 0 }, "X")).toBe(
      "no cards yet",
    );
  });

  it("the hint drops 'and its parallels' on a parallel", () => {
    expect(bulkHintText("insert")).toContain("here and its parallels");
    expect(bulkHintText("variantType")).toContain("here and its parallels");
    expect(bulkHintText("parallel")).toContain("every card in this parallel");
    expect(bulkHintText("parallel")).not.toContain("its parallels");
  });

  it("never shows the run's bookkeeping words to the operator", () => {
    expect(BULK_CHECKLIST_CHANGED_TEXT).toBe("This checklist changed mid-way. Give it another go.");
    expect(BULK_PLAYER_GONE_TEXT).toBe("Can't find that player anymore. Pick them again.");
    // The server's own words now (`cardSecondaryPlayers.BULK_*`), shown as they are.
    expect(bulkErrorText(new ConvexError(BULK_CHECKLIST_CHANGED_TEXT))).toBe(BULK_CHECKLIST_CHANGED_TEXT);
    expect(bulkErrorText(new ConvexError(BULK_PLAYER_GONE_TEXT))).toBe(BULK_PLAYER_GONE_TEXT);
    // An older server's wording is mapped onto them.
    expect(
      bulkErrorText(new ConvexError("That progress marker is not one this run handed out. Start again.")),
    ).toBe(BULK_CHECKLIST_CHANGED_TEXT);
    expect(
      bulkErrorText(new ConvexError("That progress marker is past the end of this checklist. Start again.")),
    ).toBe(BULK_CHECKLIST_CHANGED_TEXT);
    expect(bulkErrorText(new ConvexError("One of the selected players no longer exists."))).toBe(
      BULK_PLAYER_GONE_TEXT,
    );
    for (const text of [BULK_CHECKLIST_CHANGED_TEXT, BULK_PLAYER_GONE_TEXT]) {
      expect(text).not.toMatch(/progress marker|cursor|\brun\b|\bNB\b/);
    }
    expect(bulkErrorText(new Error("Server Error"))).toBe(
      "The connection dropped before these cards saved.",
    );
    // Anything else the server says is already the operator's words.
    expect(bulkErrorText(new ConvexError("Pick a checklist (a variant type, insert or parallel) to change its cards."))).toBe(
      "Pick a checklist (a variant type, insert or parallel) to change its cards.",
    );
  });
});

describe("also-pictured bulk run — the ledger steps", () => {
  it("starts with the first line working and the rest waiting, and announces the scope", () => {
    const run = startRun("add", "Dan Marino", TARGETS, false);
    expect(run.lines.map((l) => l.kind)).toEqual(["building", "waiting", "waiting"]);
    expect(run.announcement).toBe("Adding Dan Marino to every card in Base and its 2 parallels.");
    expect(bulkHeading(run)).toBe("Adding Dan Marino to every card: checklist 1 of 3");
  });

  it("a page on the same checklist adds its counts and keeps the line working", () => {
    let run = startRun("add", "Dan Marino", TARGETS, false);
    run = applyPage(run, page({ targetIndex: 0, cursor: "c1", scanned: 100, changed: 100 }));
    expect(run.lines[0].kind).toBe("building");
    expect(bulkLineText(run.lines[0], run)).toBe("Base — working, 100 cards checked");
    run = applyPage(run, page({ targetIndex: 0, cursor: "c2", scanned: 20, changed: 18, unchanged: 2 }));
    expect(run.lines[0].counts).toMatchObject({ scanned: 120, changed: 118, unchanged: 2 });
  });

  it("a page on the next checklist finishes the ones before it, and pulses the count", () => {
    let run = startRun("add", "Dan Marino", TARGETS, false);
    run = applyPage(run, page({ targetIndex: 0, cursor: "c1", scanned: 10, changed: 10 }));
    run = applyPage(run, page({ targetIndex: 1, cursor: "c2", scanned: 5, changed: 5 }));
    expect(run.lines.map((l) => l.kind)).toEqual(["built", "building", "waiting"]);
    expect(bulkLineText(run.lines[0], run)).toBe("Base — added to 10 cards");
    expect(run.announcement).toBe("1 of 3 done");
    expect(bulkHeading(run)).toBe("Adding Dan Marino to every card: checklist 2 of 3");
  });

  it("the running heading counts checklists, says so, and never runs past the last", () => {
    let run = startRun("remove", "Dan Marino", TARGETS, false);
    expect(bulkHeading(run)).toBe("Taking Dan Marino off every card: checklist 1 of 3");
    run = applyPage(run, page({ targetIndex: 2, cursor: "c", scanned: 4, changed: 4 }));
    expect(run.lines.map((l) => l.kind)).toEqual(["skipped", "skipped", "building"]);
    expect(bulkHeading(run)).toBe("Taking Dan Marino off every card: checklist 3 of 3");
    // Every line finished but the run not yet told it is over: still "3 of 3".
    run = { ...run, lines: run.lines.map((l) => ({ ...l, kind: "built" as const })) };
    expect(bulkHeading(run)).toBe("Taking Dan Marino off every card: checklist 3 of 3");
  });

  it("a checklist the server skipped past with no cards reads as empty, not as a result", () => {
    let run = startRun("add", "Dan Marino", TARGETS, false);
    run = applyPage(run, page({ targetIndex: 1, cursor: "c", scanned: 3, changed: 3 }));
    expect(run.lines[0].kind).toBe("skipped");
    expect(bulkLineText(run.lines[0], run)).toBe("Base — no cards yet");
  });

  it("the last page finishes everything and sums the run in the heading", () => {
    let run = startRun("add", "Dan Marino", TARGETS, false);
    run = applyPage(run, page({ targetIndex: 0, cursor: "a", scanned: 10, changed: 10 }));
    run = applyPage(run, page({ targetIndex: 1, cursor: "b", scanned: 5, changed: 4, unchanged: 1 }));
    run = applyPage(run, page({ targetIndex: 2, cursor: null, scanned: 5, changed: 5 }));
    expect(run.phase).toBe("done");
    expect(run.lines.map((l) => l.kind)).toEqual(["built", "built", "built"]);
    expect(bulkHeading(run)).toBe("Added Dan Marino to 19 cards");
    expect(run.announcement).toBe("Added Dan Marino to 19 cards");
  });

  it("a remove that changed nothing says he was on none of them", () => {
    let run = startRun("remove", "Dan Marino", TARGETS, false);
    run = applyPage(run, page({ targetIndex: 2, cursor: null, scanned: 5, unchanged: 5 }));
    expect(bulkHeading(run)).toBe("Dan Marino wasn't on any of these cards");
  });

  it("stop: the line in progress is unfinished, the rest not reached, and the heading says how to finish", () => {
    let run = startRun("add", "Dan Marino", TARGETS, false);
    run = applyPage(run, page({ targetIndex: 1, cursor: "c", scanned: 100, changed: 100 }));
    run = stopRun(run);
    expect(run.phase).toBe("stopped");
    expect(run.lines.map((l) => l.kind)).toEqual(["skipped", "unfinished", "stopped"]);
    expect(bulkLineText(run.lines[1], run)).toBe("Gold — stopped partway, 100 cards checked");
    expect(bulkLineText(run.lines[2], run)).toBe("Black — not reached");
    expect(bulkHeading(run)).toBe(
      "Stopped after you asked. So far: added Dan Marino to 100 cards. Run it again to finish; cards already done are skipped.",
    );
  });

  it("fail: the line being worked on carries the reason, the rest are not reached", () => {
    let run = startRun("remove", "Dan Marino", TARGETS, false);
    run = applyPage(run, page({ targetIndex: 1, cursor: "c", scanned: 4, changed: 4 }));
    run = failRun(run, BULK_CHECKLIST_CHANGED_TEXT);
    expect(run.lines.map((l) => l.kind)).toEqual(["skipped", "failed", "stopped"]);
    expect(bulkLineText(run.lines[1], run)).toBe(`Gold — ${BULK_CHECKLIST_CHANGED_TEXT}`);
    expect(bulkHeading(run)).toBe(
      "Stopped at Gold. So far: took Dan Marino off 4 cards. Run it again to finish; cards already done are skipped.",
    );
  });
});

// ---------------------------------------------------------------------------
// The control
// ---------------------------------------------------------------------------

function renderControl(props: Partial<Parameters<typeof AlsoPicturedBulkControl>[0]> = {}) {
  return render(
    <AlsoPicturedBulkControl
      variantId={VARIANT}
      level="insert"
      sportId={SPORT}
      expanded={true}
      {...props}
    />,
  );
}

const addButton = () => screen.getByRole("button", { name: BULK_ADD_LABEL });
const removeButton = () => screen.getByRole("button", { name: BULK_REMOVE_LABEL });

/** The server's pages for TARGETS: two on Base, one on each parallel. */
function serverPages(): BulkPage[] {
  return [
    page({ targetIndex: 0, cursor: "base-2", scanned: 100, changed: 100 }),
    page({ targetIndex: 0, cursor: "gold-1", scanned: 20, changed: 19, skippedPrimary: 1 }),
    page({ targetIndex: 1, cursor: "black-1", scanned: 30, changed: 30 }),
    page({ targetIndex: 2, cursor: null, scanned: 30, changed: 28, unchanged: 2 }),
  ];
}

describe("AlsoPicturedBulkControl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    playerRows = [
      { _id: "p1", name: "Dan Marino" },
      { _id: "p2", name: "Don Shula" },
    ];
    mockQuery.mockResolvedValue({ targets: TARGETS, truncated: false });
  });

  it("names itself, describes its picker with the hint, and holds both actions until someone is chosen", () => {
    renderControl();
    expect(ALSO_ON_EVERY_CARD_HEADING).toBe("Also on every card");
    expect(screen.getByRole("region", { name: ALSO_ON_EVERY_CARD_HEADING })).toBeTruthy();
    const hint = screen.getByText(bulkHintText("insert"));
    expect(hint.textContent).toBe(
      "Same face on every card? Pick them once to add them to every card here and its parallels, or take them off. Cards that already have them are skipped.",
    );
    expect(
      screen.getByLabelText(BULK_ALSO_PICTURED_PICKER_LABELS.root).getAttribute("data-described-by"),
    ).toBe(hint.id);
    // Held with aria-disabled, never native disabled: still reachable, so its title can say why.
    for (const button of [addButton(), removeButton()]) {
      expect((button as HTMLButtonElement).disabled).toBe(false);
      expect(button.getAttribute("aria-disabled")).toBe("true");
      expect(button.getAttribute("title")).toBe("Choose who first");
    }
  });

  it("on a phone its picker trigger and both actions are full size, compact from Radix's sm up", () => {
    renderControl();
    expect(
      screen.getByLabelText(BULK_ALSO_PICTURED_PICKER_LABELS.root).getAttribute("data-roomy"),
    ).toBe("yes");
    for (const button of [addButton(), removeButton()]) {
      const classes = button.className.split(/\s+/);
      expect(classes).toContain("rt-r-size-2");
      expect(classes).toContain("sm:rt-r-size-1");
    }
  });

  it("a press before anyone is chosen does nothing and keeps focus on the button", () => {
    renderControl();
    act(() => addButton().focus());
    fireEvent.click(addButton());
    fireEvent.click(removeButton());
    expect(mockQuery).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(addButton());
  });

  it("while it counts, the pressed action stays focused and a second press asks nothing more", async () => {
    let answer: (v: unknown) => void = () => {};
    mockQuery.mockImplementation(() => new Promise((resolve) => (answer = resolve)));
    renderControl();
    fireEvent.click(screen.getByText("Stub pick p1"));
    act(() => addButton().focus());
    fireEvent.click(addButton());
    const counting = screen.getByRole("button", { name: "Counting cards…" });
    expect(counting.getAttribute("aria-disabled")).toBe("true");
    expect((counting as HTMLButtonElement).disabled).toBe(false);
    expect(document.activeElement).toBe(counting);
    fireEvent.click(counting);
    fireEvent.click(removeButton());
    expect(mockQuery).toHaveBeenCalledTimes(1);
    await act(async () => answer({ targets: TARGETS, truncated: false }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });

  it("keeps one player at a time: a second pick replaces the first", () => {
    renderControl();
    fireEvent.click(screen.getByText("Stub pick p1"));
    expect(screen.getByText("Picked: p1")).toBeTruthy();
    fireEvent.click(screen.getByText("Stub pick p2"));
    expect(screen.getByText("Picked: p2")).toBeTruthy();
    expect((addButton() as HTMLButtonElement).disabled).toBe(false);
  });

  it("asks before writing, naming the player and the scope; Cancel writes nothing", async () => {
    renderControl();
    fireEvent.click(screen.getByText("Stub pick p1"));
    await act(async () => {
      fireEvent.click(addButton());
    });
    expect(mockQuery).toHaveBeenCalledWith(
      "cardSecondaryPlayers.secondaryPlayerBulkTargets",
      { variantId: VARIANT },
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Add Dan Marino to every card in Base and its 2 parallels?",
    });
    // The form behind the modal is inert while it is up.
    expect(screen.getByText("Stub pick p1").closest("[inert]")).not.toBeNull();
    // The confirm never reuses the trigger's words.
    expect(within(dialog).queryByRole("button", { name: BULK_ADD_LABEL })).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mockMutation).not.toHaveBeenCalled();
    expect(screen.getByText("Stub pick p1").closest("[inert]")).toBeNull();
  });

  it("adds page by page until the server says done, and shows the run as a ledger", async () => {
    const pages = serverPages();
    mockMutation.mockImplementation(async () => pages.shift());
    renderControl();
    fireEvent.click(screen.getByText("Stub pick p1"));
    await act(async () => {
      fireEvent.click(addButton());
    });
    const dialog = await screen.findByRole("dialog");
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Yes, add Dan Marino" }));
    });

    await screen.findByRole("heading", { name: "Added Dan Marino to 177 cards" });
    const cursors = mockMutation.mock.calls.map((c) => (c[1] as { cursor: string | null }).cursor);
    expect(cursors).toEqual([null, "base-2", "gold-1", "black-1"]);
    for (const call of mockMutation.mock.calls) {
      expect(call[0]).toBe("cardSecondaryPlayers.addSecondaryPlayerToVariant");
      expect(call[1]).toMatchObject({ variantId: VARIANT, playerId: "p1" });
    }
    const ledger = screen.getByRole("region", { name: "Added Dan Marino to 177 cards" });
    expect(within(ledger).getByText("Base — added to 119 cards, skipped 1 of Dan Marino's own")).toBeTruthy();
    expect(within(ledger).getByText("Gold — added to 30 cards")).toBeTruthy();
    expect(within(ledger).getByText("Black — added to 28 cards, 2 already listed")).toBeTruthy();
    // Done: the actions are free again, and there is nothing to stop.
    expect(addButton().getAttribute("aria-disabled")).toBeNull();
    expect(screen.queryByRole("button", { name: BULK_STOP_LABEL })).toBeNull();
    expect(within(ledger).getByRole("button", { name: BULK_DISMISS_LABEL }).textContent).toBe("Dismiss");
  });

  it("removes through the remove mutation", async () => {
    mockMutation.mockResolvedValue(page({ targetIndex: 2, cursor: null, scanned: 3, changed: 3 }));
    renderControl();
    fireEvent.click(screen.getByText("Stub pick p2"));
    await act(async () => {
      fireEvent.click(removeButton());
    });
    const dialog = await screen.findByRole("dialog", {
      name: "Take Don Shula off every card in Base and its 2 parallels?",
    });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Yes, take Don Shula off" }));
    });
    await screen.findByRole("heading", { name: "Took Don Shula off 3 cards" });
    expect(mockMutation).toHaveBeenCalledWith(
      "cardSecondaryPlayers.removeSecondaryPlayerFromVariant",
      { variantId: VARIANT, playerId: "p2", cursor: null },
    );
  });

  it("Stop lets the page in flight land, then stops and says how to finish", async () => {
    let release: (p: BulkPage) => void = () => {};
    mockMutation.mockImplementationOnce(
      () => new Promise<BulkPage>((resolve) => (release = resolve)),
    );
    renderControl();
    fireEvent.click(screen.getByText("Stub pick p1"));
    await act(async () => {
      fireEvent.click(addButton());
    });
    await act(async () => {
      fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Yes, add Dan Marino" }));
    });
    const stop = await screen.findByRole("button", { name: BULK_STOP_LABEL });
    // Busy: the picker and both actions are held.
    expect((screen.getByText("Stub pick p1") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(stop);
    expect(
      screen.getByRole("button", { name: "Stopping after these cards…" }).getAttribute("aria-disabled"),
    ).toBe("true");
    await act(async () => {
      release(page({ targetIndex: 0, cursor: "more", scanned: 100, changed: 100 }));
    });
    await screen.findByRole("heading", {
      name: "Stopped after you asked. So far: added Dan Marino to 100 cards. Run it again to finish; cards already done are skipped.",
    });
    expect(mockMutation).toHaveBeenCalledTimes(1);
  });

  it("a refused page stops the run with the reason in the operator's words", async () => {
    mockMutation
      .mockResolvedValueOnce(page({ targetIndex: 0, cursor: "x", scanned: 100, changed: 100 }))
      .mockRejectedValueOnce(
        new ConvexError("That progress marker is past the end of this checklist. Start again."),
      );
    renderControl();
    fireEvent.click(screen.getByText("Stub pick p1"));
    await act(async () => {
      fireEvent.click(addButton());
    });
    await act(async () => {
      fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Yes, add Dan Marino" }));
    });
    await screen.findByRole("heading", { name: /^Stopped at Base\./ });
    expect(screen.getByText(`Base — ${BULK_CHECKLIST_CHANGED_TEXT}`)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/progress marker|cursor/i);
  });

  it("a failed count shows the reason beside the buttons and opens no dialog", async () => {
    mockQuery.mockRejectedValue(new ConvexError("Pick a checklist (a variant type, insert or parallel) to change its cards."));
    renderControl();
    fireEvent.click(screen.getByText("Stub pick p1"));
    await act(async () => {
      fireEvent.click(addButton());
    });
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Pick a checklist (a variant type, insert or parallel) to change its cards.",
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("collapsed, it shows nothing while idle", () => {
    const { container } = renderControl({ expanded: false });
    expect(container.textContent).toBe("");
  });

  it("collapsed mid-run, the ledger stays on screen", async () => {
    mockMutation.mockImplementation(() => new Promise(() => {}));
    const { rerender } = renderControl();
    fireEvent.click(screen.getByText("Stub pick p1"));
    await act(async () => {
      fireEvent.click(addButton());
    });
    await act(async () => {
      fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Yes, add Dan Marino" }));
    });
    rerender(
      <AlsoPicturedBulkControl variantId={VARIANT} level="insert" sportId={SPORT} expanded={false} />,
    );
    expect(screen.getByRole("heading", { name: "Adding Dan Marino to every card: checklist 1 of 3" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: BULK_ADD_LABEL })).toBeNull();
  });

  it("says when the checklist has more parallels than one run reaches", async () => {
    mockQuery.mockResolvedValue({ targets: TARGETS, truncated: true });
    mockMutation.mockResolvedValue(page({ targetIndex: 2, cursor: null }));
    renderControl();
    fireEvent.click(screen.getByText("Stub pick p1"));
    await act(async () => {
      fireEvent.click(addButton());
    });
    await act(async () => {
      fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Yes, add Dan Marino" }));
    });
    expect(await screen.findByText(/more parallels than one run reaches/)).toBeTruthy();
  });
  it("a failed count puts focus back on the action that was pressed", async () => {
    let refuse: (e: unknown) => void = () => {};
    mockQuery.mockImplementation(() => new Promise((_, reject) => (refuse = reject)));
    renderControl();
    fireEvent.click(screen.getByText("Stub pick p1"));
    act(() => removeButton().focus());
    fireEvent.click(removeButton());
    // Focus wandered off while it counted (a stray click on the page).
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    act(() => outside.focus());
    await act(async () => {
      refuse(new ConvexError("Pick a checklist (a variant type, insert or parallel) to change its cards."));
    });
    await screen.findByRole("alert");
    expect(document.activeElement).toBe(removeButton());
    outside.remove();
  });

  it("mounts its live line before any run, so the start is announced", async () => {
    mockMutation.mockImplementation(() => new Promise(() => {}));
    renderControl();
    const status = screen.getByRole("status");
    expect(status.textContent).toBe("");
    fireEvent.click(screen.getByText("Stub pick p1"));
    await act(async () => {
      fireEvent.click(addButton());
    });
    await act(async () => {
      fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Yes, add Dan Marino" }));
    });
    // The same node, now speaking: it was in the page before the run began.
    expect(screen.getByRole("status")).toBe(status);
    expect(status.textContent).toBe("Adding Dan Marino to every card in Base and its 2 parallels.");
  });

  it("when the run ends with Stop gone from under focus, focus lands on the ledger", async () => {
    let release: (p: BulkPage) => void = () => {};
    mockMutation.mockImplementationOnce(() => new Promise<BulkPage>((resolve) => (release = resolve)));
    renderControl();
    fireEvent.click(screen.getByText("Stub pick p1"));
    await act(async () => {
      fireEvent.click(addButton());
    });
    await act(async () => {
      fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Yes, add Dan Marino" }));
    });
    const stop = await screen.findByRole("button", { name: BULK_STOP_LABEL });
    act(() => stop.focus());
    fireEvent.click(stop);
    await act(async () => {
      release(page({ targetIndex: 0, cursor: "more", scanned: 100, changed: 100 }));
    });
    const ledger = await screen.findByRole("region", { name: /^Stopped after you asked\./ });
    await waitFor(() => expect(document.activeElement).toBe(ledger));
  });

  it("when the run ends while the operator is elsewhere, focus stays where they put it", async () => {
    let release: (p: BulkPage) => void = () => {};
    mockMutation.mockImplementationOnce(() => new Promise<BulkPage>((resolve) => (release = resolve)));
    renderControl();
    fireEvent.click(screen.getByText("Stub pick p1"));
    await act(async () => {
      fireEvent.click(addButton());
    });
    await act(async () => {
      fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Yes, add Dan Marino" }));
    });
    await screen.findByRole("button", { name: BULK_STOP_LABEL });
    // Let the start's own park on the ledger settle, then move on (the
    // picker is held while running, so to a stable element outside).
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    act(() => outside.focus());
    await act(async () => {
      release(page({ targetIndex: 2, cursor: null, scanned: 3, changed: 3 }));
    });
    await screen.findByRole("heading", { name: "Added Dan Marino to 3 cards" });
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it("a finished ledger stays, panel open or shut, until Dismiss clears it", async () => {
    mockMutation.mockResolvedValue(page({ targetIndex: 2, cursor: null, scanned: 3, changed: 3 }));
    const { rerender } = renderControl();
    fireEvent.click(screen.getByText("Stub pick p1"));
    await act(async () => {
      fireEvent.click(addButton());
    });
    await act(async () => {
      fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Yes, add Dan Marino" }));
    });
    await screen.findByRole("heading", { name: "Added Dan Marino to 3 cards" });

    // Shut: the outcome is still on screen, with its Dismiss.
    rerender(<AlsoPicturedBulkControl variantId={VARIANT} level="insert" sportId={SPORT} expanded={false} />);
    expect(screen.getByRole("heading", { name: "Added Dan Marino to 3 cards" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: ALSO_ON_EVERY_CARD_HEADING })).toBeNull();

    // Open again, Dismiss: the ledger goes and focus starts the next run.
    const onDismissedCollapsed = vi.fn();
    rerender(
      <AlsoPicturedBulkControl
        variantId={VARIANT}
        level="insert"
        sportId={SPORT}
        expanded={true}
        onDismissedCollapsed={onDismissedCollapsed}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: BULK_DISMISS_LABEL }));
    expect(onDismissedCollapsed).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "Added Dan Marino to 3 cards" })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(addButton()));
  });

  it("Dismiss with the panel shut leaves nothing behind", async () => {
    mockMutation.mockResolvedValue(page({ targetIndex: 2, cursor: null, scanned: 3, changed: 3 }));
    const { rerender, container } = renderControl();
    fireEvent.click(screen.getByText("Stub pick p1"));
    await act(async () => {
      fireEvent.click(addButton());
    });
    await act(async () => {
      fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Yes, add Dan Marino" }));
    });
    await screen.findByRole("heading", { name: "Added Dan Marino to 3 cards" });
    const onDismissedCollapsed = vi.fn();
    rerender(
      <AlsoPicturedBulkControl
        variantId={VARIANT}
        level="insert"
        sportId={SPORT}
        expanded={false}
        onDismissedCollapsed={onDismissedCollapsed}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: BULK_DISMISS_LABEL }));
    // The panel is told, so it can take focus (the control has nothing left).
    expect(onDismissedCollapsed).toHaveBeenCalledTimes(1);
    // Only the (now quiet) live line is left; nothing visible.
    expect(screen.queryByRole("heading")).toBeNull();
    expect(container.querySelectorAll("section")).toHaveLength(0);
  });
});
