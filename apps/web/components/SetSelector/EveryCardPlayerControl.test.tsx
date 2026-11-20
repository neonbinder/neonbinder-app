/**
 * NEO-528 — the Attributes panel's "Player on every card" section: the pure
 * run steps (what each page does to the ledger, and the words), and the
 * control end to end against a stubbed client that answers like
 * `convex/cardPlayersBulk.ts` (the stored values, the run's checklists, the
 * store and clear, and the pages of a run).
 */

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import { ConvexError } from "convex/values";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../convex/_generated/api", () => ({
  api: {
    players: { getManyByIds: "players.getManyByIds" },
    cardPlayersBulk: {
      cardPlayerDefaults: "cardPlayersBulk.cardPlayerDefaults",
      everyCardTargets: "cardPlayersBulk.everyCardTargets",
      setCardPlayerDefault: "cardPlayersBulk.setCardPlayerDefault",
      clearCardPlayerDefault: "cardPlayersBulk.clearCardPlayerDefault",
      addPlayerToVariant: "cardPlayersBulk.addPlayerToVariant",
      addCameoToVariant: "cardPlayersBulk.addCameoToVariant",
    },
  },
}));

const mockQuery = vi.fn();
const mockMutation = vi.fn();
const subscribedArgs: unknown[] = [];
let playerRows: Array<{ _id: string; name: string }> | undefined;
let subscribedDefaults: unknown;

// One client for the whole test, as `useConvex()` is in the app: a fresh
// object per render would re-run every effect that lists it.
const client = { query: mockQuery, mutation: mockMutation };
vi.mock("convex/react", () => ({
  useConvex: () => client,
  useQuery: (ref: string, args: unknown) => {
    if (ref === "players.getManyByIds") return args !== "skip" ? playerRows : undefined;
    if (ref === "cardPlayersBulk.cardPlayerDefaults") {
      subscribedArgs.push(args);
      return args !== "skip" ? subscribedDefaults : undefined;
    }
    return undefined;
  },
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
    chipLook,
  }: {
    value: string[];
    onChange: (next: string[]) => void;
    labels?: { root: string; trigger: string };
    disabled?: boolean;
    ariaDescribedBy?: string;
    roomyTriggerOnPhones?: boolean;
    chipLook?: string;
  }) => (
    <div
      aria-label={labels?.root}
      data-described-by={ariaDescribedBy ?? ""}
      data-roomy={roomyTriggerOnPhones ? "yes" : "no"}
      data-chip-look={chipLook ?? "filled"}
    >
      <span>Stub value: {value.join(",")}</span>
      <button type="button" disabled={disabled} aria-label={labels?.trigger}>
        + Choose who
      </button>
      <button type="button" disabled={disabled} onClick={() => onChange([...value, "p1"])}>
        Stub pick p1
      </button>
      <button type="button" disabled={disabled} onClick={() => onChange([...value, "p2"])}>
        Stub pick p2
      </button>
    </div>
  ),
}));

import EveryCardPlayerControl, {
  BULK_ADD_CAMEO_LABEL,
  BULK_ADD_PLAYER_LABEL,
  BULK_CHECKING_TEXT,
  BULK_CHECKLIST_CHANGED_TEXT,
  BULK_CHOOSE_FIRST_TEXT,
  BULK_COUNTING_TEXT,
  BULK_TRUNCATED_TEXT,
  BULK_DISMISS_LABEL,
  BULK_PICKED_LABEL,
  BULK_PLAYER_GONE_TEXT,
  BULK_STOP_LABEL,
  applyPage,
  bulkErrorText,
  bulkHeading,
  cameoHintText,
  bulkLineText,
  confirmCopy,
  failRun,
  lineResultText,
  scopeText,
  startRun,
  stopRun,
  type BulkCounts,
  type BulkPage,
  type BulkTarget,
  type CardPlayerDefaultsView,
} from "./EveryCardPlayerControl";
import {
  EVERY_CARD_PLAYER_ACTION_LABELS,
  EVERY_CARD_PLAYER_PICKER_LABELS,
  PLAYER_ON_EVERY_CARD_HEADING,
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

const ZERO: BulkCounts = {
  scanned: 0,
  changed: 0,
  unchanged: 0,
  promoted: 0,
  skippedPrimary: 0,
  skippedFull: 0,
  skippedOther: 0,
  skippedPending: 0,
  skippedSport: 0,
  titlesRefreshed: 0,
  titlesKept: 0,
};
const counts = (over: Partial<BulkCounts>): BulkCounts => ({ ...ZERO, ...over });

function page(over: Partial<BulkPage> & Pick<BulkPage, "targetIndex" | "cursor">): BulkPage {
  return {
    targetId: TARGETS[over.targetIndex]._id,
    targetCount: TARGETS.length,
    ...ZERO,
    ...over,
  };
}

const pid = (s: string) => s as unknown as Id<"players">;
const oid = (s: string) => s as unknown as Id<"selectorOptions">;

/** Nothing stored here or above; 177 cards a run of either kind would walk. */
function defaultsWith(over: Partial<CardPlayerDefaultsView> = {}): CardPlayerDefaultsView {
  return {
    own: { cameos: [] },
    cardCount: 177,
    cardsToWalk: { player: 177, cameo: 177 },
    truncated: false,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Pure steps
// ---------------------------------------------------------------------------

describe("Player on every card — the words", () => {
  it("names the reach from the row: alone, with its parallels, or as so many checklists", () => {
    expect(scopeText("Base", [TARGETS[0]])).toBe("Base");
    expect(scopeText("Base", [])).toBe("Base");
    expect(scopeText("Base", TARGETS.slice(0, 2))).toBe("Base and its 1 parallel");
    expect(scopeText("Base", TARGETS)).toBe("Base and its 2 parallels");
    // A set (or anything above one) holds several checklists of its own.
    expect(
      scopeText("2024 Topps", [target("a", "Base", "home"), target("b", "Gold"), target("c", "Diamond Kings", "home")]),
    ).toBe("2024 Topps (3 checklists)");
  });

  it("a player line says what changed and every reason a card was left alone", () => {
    expect(
      lineResultText(
        "player",
        counts({
          scanned: 50,
          changed: 40,
          promoted: 3,
          unchanged: 5,
          skippedOther: 2,
          skippedPending: 1,
          titlesRefreshed: 38,
          titlesKept: 2,
        }),
        "Ken Griffey Jr.",
      ),
    ).toBe(
      "added to 40 cards, 3 moved up from cameo, 5 already Ken Griffey Jr.'s, skipped 2 that have a player, skipped 1 still waiting on a new name, 38 card titles updated, 2 kept as you typed them",
    );
    expect(lineResultText("player", counts({ scanned: 1, skippedOther: 1 }), "X")).toBe(
      "nothing new, skipped 1 that has a player",
    );
    expect(lineResultText("player", counts({ scanned: 2, changed: 2, titlesKept: 2 }), "X")).toBe(
      "added to 2 cards, 2 card titles kept as you typed them",
    );
    expect(lineResultText("player", counts({ scanned: 1, changed: 1, titlesRefreshed: 1 }), "Chris")).toBe(
      "added to 1 card, 1 card title updated",
    );
    expect(lineResultText("player", counts({ scanned: 3, changed: 1, skippedSport: 2 }), "X")).toBe(
      "added to 1 card, skipped 2 from a sport X doesn't play",
    );
    expect(lineResultText("player", counts({ scanned: 1, skippedSport: 1 }), "X")).toBe(
      "nothing new, skipped 1 from a sport X doesn't play",
    );
  });

  it("a cameo line says what changed and every reason a card was left alone", () => {
    expect(
      lineResultText("cameo", counts({ scanned: 50, changed: 45, unchanged: 2, skippedPrimary: 2, skippedFull: 1 }), "Dan Marino"),
    ).toBe("added to 45 cards, 2 already listed, skipped 2 of Dan Marino's own, skipped 1 that is full (20 players)");
    expect(
      lineResultText("cameo", counts({ scanned: 9, changed: 4, skippedFull: 2, skippedSport: 3 }), "Dan Marino"),
    ).toBe("added to 4 cards, skipped 2 that are full (20 players), skipped 3 from a sport Dan Marino doesn't play");
    expect(lineResultText("cameo", counts({ scanned: 1, skippedPrimary: 1 }), "Chris")).toBe(
      "nothing new, skipped 1 of Chris' own",
    );
  });

  it("a checklist with no cards says so rather than claiming a result", () => {
    expect(lineResultText("player", ZERO, "X")).toBe("no cards yet");
    expect(lineResultText("cameo", ZERO, "X")).toBe("no cards yet");
  });

  it("the cameo description says where a cameo shows", () => {
    expect(cameoHintText()).toBe('Tucks them under "Also on this card" on each card.');
  });

  it("the player confirm: who, where, what stays, and what new cards get", () => {
    expect(confirmCopy({ kind: "player", playerName: "Ken Griffey Jr.", scope: "Base and its 2 parallels", overridden: 0 })).toEqual({
      title: "Add Ken Griffey Jr. to every card in Base and its 2 parallels?",
      description:
        "Ken Griffey Jr. becomes the player on every card that doesn't have one yet. Cards with a player stay put; titles you haven't edited pick up Ken Griffey Jr.'s name. New cards get Ken Griffey Jr. too.",
      confirmLabel: "Yes, add them to every card",
    });
    const replacing = confirmCopy({
      kind: "player",
      playerName: "Q",
      scope: "Base",
      replacing: "A",
      overridden: 2,
    });
    expect(replacing.description).toBe(
      "Q becomes the player on every card that doesn't have one yet. Cards with a player stay put; titles you haven't edited pick up Q's name. Q replaces A for new cards. 2 checklists here have their own player and are left alone.",
    );
  });

  it("the cameo confirm keeps today's words and adds what new cards get", () => {
    expect(confirmCopy({ kind: "cameo", playerName: "Dan Marino", scope: "Base", overridden: 1 })).toEqual({
      title: "Add Dan Marino as a cameo on every card in Base?",
      description:
        `Each card gets Dan Marino under "Also on this card". Cards that are Dan Marino's own, or already have them, are left as they are. New cards get Dan Marino too. 1 checklist here has its own cameos and is left alone.`,
      confirmLabel: "Yes, add them as a cameo",
    });
  });

  it("never shows the run's bookkeeping words to the operator", () => {
    expect(BULK_CHECKLIST_CHANGED_TEXT).toBe("This checklist changed mid-way. Give it another go.");
    expect(BULK_PLAYER_GONE_TEXT).toBe("Can't find that player anymore. Pick them again.");
    expect(bulkErrorText(new ConvexError(BULK_CHECKLIST_CHANGED_TEXT))).toBe(BULK_CHECKLIST_CHANGED_TEXT);
    expect(bulkErrorText(new ConvexError(BULK_PLAYER_GONE_TEXT))).toBe(BULK_PLAYER_GONE_TEXT);
    expect(
      bulkErrorText(new ConvexError("That progress marker is not one this run handed out. Start again.")),
    ).toBe(BULK_CHECKLIST_CHANGED_TEXT);
    expect(bulkErrorText(new ConvexError("One of the selected players no longer exists."))).toBe(
      BULK_PLAYER_GONE_TEXT,
    );
    expect(bulkErrorText(new Error("Server Error"))).toBe("Something went sideways. Give it another go.");
    expect(bulkErrorText(new ConvexError("Every card can carry at most 20 cameos."))).toBe(
      "Every card can carry at most 20 cameos.",
    );
  });
});

describe("Player on every card — the ledger steps", () => {
  it("starts with the first line working and the rest waiting, and announces the scope", () => {
    const run = startRun("player", "Dan Marino", "Base and its 2 parallels", TARGETS, false);
    expect(run.lines.map((l) => l.kind)).toEqual(["building", "waiting", "waiting"]);
    expect(run.announcement).toBe("Adding Dan Marino to every card in Base and its 2 parallels.");
    expect(bulkHeading(run)).toBe("Adding Dan Marino to every card: checklist 1 of 3");
    const cameo = startRun("cameo", "Dan Marino", "Base", TARGETS, false);
    expect(cameo.announcement).toBe("Adding Dan Marino as a cameo on every card in Base.");
    expect(bulkHeading(cameo)).toBe("Adding Dan Marino as a cameo: checklist 1 of 3");
  });

  it("a page on the same checklist adds its counts and keeps the line working", () => {
    let run = startRun("player", "Dan Marino", "Base", TARGETS, false);
    run = applyPage(run, page({ targetIndex: 0, cursor: "c1", scanned: 50, changed: 50 }));
    expect(run.lines[0].kind).toBe("building");
    expect(bulkLineText(run.lines[0], run)).toBe("Base — working, 50 cards checked");
    run = applyPage(run, page({ targetIndex: 0, cursor: "c2", scanned: 20, changed: 18, promoted: 1, unchanged: 2 }));
    expect(run.lines[0].counts).toMatchObject({ scanned: 70, changed: 68, promoted: 1, unchanged: 2 });
  });

  it("a page on the next checklist finishes the ones before it, and pulses the count", () => {
    let run = startRun("player", "Dan Marino", "Base", TARGETS, false);
    run = applyPage(run, page({ targetIndex: 0, cursor: "c1", scanned: 10, changed: 10 }));
    run = applyPage(run, page({ targetIndex: 1, cursor: "c2", scanned: 5, changed: 5 }));
    expect(run.lines.map((l) => l.kind)).toEqual(["built", "building", "waiting"]);
    expect(bulkLineText(run.lines[0], run)).toBe("Base — added to 10 cards");
    expect(run.announcement).toBe("1 of 3 done");
    expect(bulkHeading(run)).toBe("Adding Dan Marino to every card: checklist 2 of 3");
  });

  it("a checklist the server skipped past with no cards reads as empty, not as a result", () => {
    let run = startRun("player", "Dan Marino", "Base", TARGETS, false);
    run = applyPage(run, page({ targetIndex: 1, cursor: "c", scanned: 3, changed: 3 }));
    expect(run.lines[0].kind).toBe("skipped");
    expect(bulkLineText(run.lines[0], run)).toBe("Base — no cards yet");
  });

  it("the last page finishes everything and sums the run in the heading", () => {
    let run = startRun("player", "Dan Marino", "Base", TARGETS, false);
    run = applyPage(run, page({ targetIndex: 0, cursor: "a", scanned: 10, changed: 10 }));
    run = applyPage(run, page({ targetIndex: 1, cursor: "b", scanned: 5, changed: 4, unchanged: 1 }));
    run = applyPage(run, page({ targetIndex: 2, cursor: null, scanned: 5, changed: 5 }));
    expect(run.phase).toBe("done");
    expect(run.lines.map((l) => l.kind)).toEqual(["built", "built", "built"]);
    expect(bulkHeading(run)).toBe("Added Dan Marino to 19 cards");
    expect(run.announcement).toBe("Added Dan Marino to 19 cards");

    let cameo = startRun("cameo", "Dan Marino", "Base", TARGETS, false);
    cameo = applyPage(cameo, page({ targetIndex: 2, cursor: null, scanned: 5, changed: 5 }));
    expect(bulkHeading(cameo)).toBe("Added Dan Marino as a cameo on 5 cards");
  });

  it("a run that changed nothing says why: no cards yet, or every card already settled", () => {
    const empty = applyPage(
      startRun("player", "Dan Marino", "Base", TARGETS, false),
      page({ targetIndex: 2, cursor: null }),
    );
    expect(bulkHeading(empty)).toBe("No cards here yet; new cards get Dan Marino");
    const settled = applyPage(
      startRun("player", "Dan Marino", "Base", TARGETS, false),
      page({ targetIndex: 2, cursor: null, scanned: 4, skippedOther: 4 }),
    );
    expect(bulkHeading(settled)).toBe("Nothing to add: every card here already has a player");
    const cameo = applyPage(
      startRun("cameo", "Dan Marino", "Base", TARGETS, false),
      page({ targetIndex: 2, cursor: null, scanned: 4, unchanged: 4 }),
    );
    expect(bulkHeading(cameo)).toBe("Nothing to add: Dan Marino is already on every card that can take them");
  });

  it("stop: the line in progress is unfinished, the rest not reached, and the heading says how to finish", () => {
    let run = startRun("player", "Dan Marino", "Base", TARGETS, false);
    run = applyPage(run, page({ targetIndex: 1, cursor: "c", scanned: 50, changed: 50 }));
    run = stopRun(run);
    expect(run.phase).toBe("stopped");
    expect(run.lines.map((l) => l.kind)).toEqual(["skipped", "unfinished", "stopped"]);
    expect(bulkLineText(run.lines[1], run)).toBe("Gold — stopped partway, 50 cards checked");
    expect(bulkLineText(run.lines[2], run)).toBe("Black — not reached");
    expect(bulkHeading(run)).toBe(
      "Stopped, like you asked. So far: added Dan Marino to 50 cards. Run it again to finish; cards already done are skipped.",
    );
  });

  it("fail: the line being worked on carries the reason, the rest are not reached", () => {
    let run = startRun("cameo", "Dan Marino", "Base", TARGETS, false);
    run = applyPage(run, page({ targetIndex: 1, cursor: "c", scanned: 4, changed: 4 }));
    run = failRun(run, BULK_CHECKLIST_CHANGED_TEXT);
    expect(run.lines.map((l) => l.kind)).toEqual(["skipped", "failed", "stopped"]);
    expect(bulkLineText(run.lines[1], run)).toBe(`Gold — ${BULK_CHECKLIST_CHANGED_TEXT}`);
    expect(bulkHeading(run)).toBe(
      "Stopped at Gold. So far: added Dan Marino as a cameo on 4 cards. Run it again to finish; cards already done are skipped.",
    );
  });

  it("fail before any card was read says nothing changed", () => {
    const run = failRun(startRun("player", "Dan Marino", "Base", TARGETS, false), BULK_PLAYER_GONE_TEXT);
    expect(bulkHeading(run)).toBe(
      "Stopped before any card changed. Run it again to finish; cards already done are skipped.",
    );
    expect(bulkLineText(run.lines[0], run)).toBe(`Base — ${BULK_PLAYER_GONE_TEXT}`);
  });
});

// ---------------------------------------------------------------------------
// The control
// ---------------------------------------------------------------------------

/** The section's status line: busy words, then a save's or a clear's note. */
const sectionStatus = () =>
  within(screen.getByRole("region", { name: PLAYER_ON_EVERY_CARD_HEADING })).getByRole("status");

/** An element whose whole text (across its child spans) is `text`, and none of whose children is. */
const byWholeText = (text: string) =>
  screen.getByText((_, el) => el?.textContent === text && ![...(el?.children ?? [])].some((c) => c.textContent === text));

function props(over: Partial<Parameters<typeof EveryCardPlayerControl>[0]> = {}) {
  return {
    variantId: VARIANT,
    level: "insert" as const,
    rowName: "Base",
    sportId: SPORT,
    expanded: true,
    ...over,
  };
}

function renderControl(over: Partial<Parameters<typeof EveryCardPlayerControl>[0]> = {}) {
  return render(<EveryCardPlayerControl {...props(over)} />);
}

const A = EVERY_CARD_PLAYER_ACTION_LABELS;
const playerButton = () => screen.getByRole("button", { name: BULK_ADD_PLAYER_LABEL });
const cameoButton = () => screen.getByRole("button", { name: BULK_ADD_CAMEO_LABEL });
const trigger = () => screen.getByRole("button", { name: EVERY_CARD_PLAYER_PICKER_LABELS.trigger });

/** The server's pages for TARGETS: two on Base, one on each parallel. */
function serverPages(): BulkPage[] {
  return [
    page({ targetIndex: 0, cursor: "base-2", scanned: 50, changed: 50, titlesRefreshed: 50 }),
    page({ targetIndex: 0, cursor: "gold-1", scanned: 20, changed: 19, skippedOther: 1, titlesRefreshed: 19 }),
    page({ targetIndex: 1, cursor: "black-1", scanned: 30, changed: 30, titlesRefreshed: 30 }),
    page({ targetIndex: 2, cursor: null, scanned: 30, changed: 28, unchanged: 2, titlesRefreshed: 27, titlesKept: 1 }),
  ];
}

/** The stubbed server: queries and mutations by function name. */
let targetsAnswer: () => Promise<unknown>;
let fetchedDefaults: () => Promise<unknown>;
let pageAnswer: () => Promise<BulkPage | undefined>;
let storeAnswer: () => Promise<unknown>;
let clearAnswer: () => Promise<unknown>;

const mutationCalls = (name: string) => mockMutation.mock.calls.filter((c) => c[0] === name);

async function pickAndPress(button: () => HTMLElement, pick = "Stub pick p1") {
  fireEvent.click(screen.getByText(pick));
  await act(async () => {
    fireEvent.click(button());
  });
}

const YES_PLAYER = "Yes, add them to every card";
const YES_CAMEO = "Yes, add them as a cameo";

async function confirmRun(label = YES_PLAYER) {
  const dialog = await screen.findByRole("dialog");
  await act(async () => {
    fireEvent.click(within(dialog).getByRole("button", { name: label }));
  });
}

describe("EveryCardPlayerControl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    subscribedArgs.length = 0;
    playerRows = [
      { _id: "p1", name: "Dan Marino" },
      { _id: "p2", name: "Don Shula" },
    ];
    subscribedDefaults = defaultsWith();
    targetsAnswer = async () => ({ targets: TARGETS, truncated: false, overridden: 0 });
    fetchedDefaults = async () => defaultsWith();
    const pages = serverPages();
    pageAnswer = async () => pages.shift();
    storeAnswer = async () => ({ playerId: "p1", cameoIds: [] });
    clearAnswer = async () => ({ playerId: null, cameoIds: [] });
    mockQuery.mockImplementation((name: string) =>
      name === "cardPlayersBulk.everyCardTargets" ? targetsAnswer() : fetchedDefaults(),
    );
    mockMutation.mockImplementation((name: string) => {
      if (name === "cardPlayersBulk.setCardPlayerDefault") return storeAnswer();
      if (name === "cardPlayersBulk.clearCardPlayerDefault") return clearAnswer();
      return pageAnswer();
    });
  });

  it("names itself, shows no hint text, and holds both actions until someone is chosen", () => {
    renderControl();
    expect(PLAYER_ON_EVERY_CARD_HEADING).toBe("Player on every card");
    const region = screen.getByRole("region", { name: PLAYER_ON_EVERY_CARD_HEADING });
    expect(within(region).getByRole("heading", { name: PLAYER_ON_EVERY_CARD_HEADING })).toBeTruthy();
    // NEO-569: no visible hint; only the cameo button is described, and only
    // with where a cameo shows (never a title only a mouse sees).
    const hint = screen.getByText(cameoHintText());
    expect(hint.className).toContain("sr-only");
    expect(screen.queryByText(/Same face on every card/)).toBeNull();
    expect(
      screen.getByLabelText(EVERY_CARD_PLAYER_PICKER_LABELS.root).getAttribute("data-described-by"),
    ).toBeFalsy();
    expect(cameoButton().getAttribute("aria-describedby")).toBe(hint.id);
    expect(playerButton().getAttribute("aria-describedby")).toBeNull();
    for (const button of [playerButton(), cameoButton()]) {
      expect((button as HTMLButtonElement).disabled).toBe(false);
      expect(button.getAttribute("aria-disabled")).toBe("true");
      expect(button.getAttribute("title")).toBeNull();
    }
    expect(A.addPlayer).toBe(BULK_ADD_PLAYER_LABEL);
    expect(A.addCameo).toBe(BULK_ADD_CAMEO_LABEL);
  });

  it("pressing an action before anyone is chosen says so and hands focus to the picker", () => {
    renderControl();
    act(() => cameoButton().focus());
    fireEvent.click(cameoButton());
    expect(screen.getByRole("alert").textContent).toBe(BULK_CHOOSE_FIRST_TEXT);
    expect(document.activeElement).toBe(trigger());
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockMutation).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
    // A second press is a new alert node, so it is read again.
    const first = screen.getByRole("alert");
    fireEvent.click(playerButton());
    const second = screen.getByRole("alert");
    expect(second.textContent).toBe(BULK_CHOOSE_FIRST_TEXT);
    expect(second).not.toBe(first);
    // Choosing someone clears it.
    fireEvent.click(screen.getByText("Stub pick p1"));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("the green action is the player, the blue outline the cameo", () => {
    renderControl();
    expect(playerButton().getAttribute("data-bulk-op")).toBe("player");
    expect(cameoButton().getAttribute("data-bulk-op")).toBe("cameo");
    // NeonButton paints inline: the hue and fill differ between the two.
    expect(playerButton().getAttribute("style")).not.toBe(cameoButton().getAttribute("style"));
  });

  it("on a phone its picker trigger and both actions are full size, compact from Radix's sm up", () => {
    renderControl();
    expect(screen.getByLabelText(EVERY_CARD_PLAYER_PICKER_LABELS.root).getAttribute("data-roomy")).toBe("yes");
    for (const button of [playerButton(), cameoButton()]) {
      const classes = button.className.split(/\s+/);
      expect(classes).toContain("rt-r-size-2");
      expect(classes).toContain("sm:rt-r-size-1");
    }
  });

  it("keeps one player at a time: a second pick replaces the first", () => {
    renderControl();
    fireEvent.click(screen.getByText("Stub pick p1"));
    expect(screen.getByText("Stub value: p1")).toBeTruthy();
    fireEvent.click(screen.getByText("Stub pick p2"));
    expect(screen.getByText("Stub value: p2")).toBeTruthy();
    expect(playerButton().getAttribute("aria-disabled")).toBeNull();
  });

  it("a pick not stored yet is labelled \"Picked:\" and drawn outlined, apart from the stored chips", () => {
    subscribedDefaults = defaultsWith({ own: { player: { _id: pid("k"), name: "Ken Griffey Jr." }, cameos: [] } });
    renderControl();
    // The picker always draws its pick outlined; the label shows only with a pick.
    expect(screen.getByLabelText(EVERY_CARD_PLAYER_PICKER_LABELS.root).getAttribute("data-chip-look")).toBe("outline");
    expect(screen.queryByText(BULK_PICKED_LABEL)).toBeNull();
    fireEvent.click(screen.getByText("Stub pick p1"));
    expect(screen.getByText(BULK_PICKED_LABEL)).toBeTruthy();
    expect(BULK_PICKED_LABEL).toBe("Picked:");
  });

  it("while the stored values load it says \"Checking…\" and holds both actions, names unchanged", () => {
    subscribedDefaults = undefined;
    renderControl();
    expect(sectionStatus().textContent).toBe(BULK_CHECKING_TEXT);
    expect(BULK_CHECKING_TEXT).toBe("Checking…");
    fireEvent.click(screen.getByText("Stub pick p1"));
    for (const button of [playerButton(), cameoButton()]) {
      expect(button.getAttribute("aria-disabled")).toBe("true");
      expect(button.getAttribute("aria-busy")).toBe("true");
      expect((button as HTMLButtonElement).disabled).toBe(false);
    }
    // A press asks nothing and stores nothing: the path (save, or confirm) is not known yet.
    fireEvent.click(playerButton());
    fireEvent.click(cameoButton());
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockMutation).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("once loaded, the actions are free and the line is quiet", () => {
    subscribedDefaults = undefined;
    const { rerender } = renderControl();
    fireEvent.click(screen.getByText("Stub pick p1"));
    subscribedDefaults = defaultsWith();
    rerender(<EveryCardPlayerControl {...props()} />);
    expect(sectionStatus().textContent).toBe("");
    expect(playerButton().getAttribute("aria-disabled")).toBeNull();
    expect(playerButton().getAttribute("aria-busy")).toBeNull();
  });

  // --- what is stored, and where the read comes from ----------------------------

  it.each(["setName", "variantType", "insert", "parallel"] as const)(
    "at %s it subscribes to the stored values while open, and never asks once",
    (level) => {
      const { rerender } = renderControl({ level });
      expect(subscribedArgs.at(-1)).toEqual({ selectorOptionId: VARIANT });
      rerender(<EveryCardPlayerControl {...props({ level, expanded: false })} />);
      expect(subscribedArgs.at(-1)).toBe("skip");
      expect(mockQuery).not.toHaveBeenCalled();
    },
  );

  it.each(["sport", "year", "manufacturer"] as const)(
    "at %s it never subscribes: it asks once when opened, and again after a save",
    async (level) => {
      subscribedDefaults = undefined;
      fetchedDefaults = async () => defaultsWith({ cardsToWalk: { player: 0, cameo: 0 }, cardCount: 0 });
      const { rerender } = renderControl({ level, expanded: false });
      expect(mockQuery).not.toHaveBeenCalled();
      rerender(<EveryCardPlayerControl {...props({ level })} />);
      await waitFor(() => expect(mockQuery).toHaveBeenCalledTimes(1));
      expect(mockQuery).toHaveBeenCalledWith("cardPlayersBulk.cardPlayerDefaults", { selectorOptionId: VARIANT });
      expect(subscribedArgs.every((a) => a === "skip")).toBe(true);
      // No cards to walk: the save is the whole job, then the read is asked again.
      await pickAndPress(playerButton);
      await waitFor(() => expect(mockQuery).toHaveBeenCalledTimes(2));
    },
  );

  it("shows this row's own player and cameos as chips with an ×", () => {
    subscribedDefaults = defaultsWith({
      own: {
        player: { _id: pid("k"), name: "Ken Griffey Jr." },
        cameos: [
          { _id: pid("a"), name: "Jay Buhner" },
          { _id: pid("b"), name: "Edgar Martinez" },
        ],
      },
    });
    renderControl();
    expect(screen.getByText("Player:")).toBeTruthy();
    expect(screen.getByText("Cameos:")).toBeTruthy();
    expect(screen.getByText("Ken Griffey Jr.")).toBeTruthy();
    expect(screen.getByRole("button", { name: A.stopPlayer("Ken Griffey Jr.") }).textContent).toBe("×");
    expect(screen.getByRole("button", { name: A.stopCameo("Jay Buhner") })).toBeTruthy();
    expect(screen.getByRole("button", { name: A.stopCameo("Edgar Martinez") })).toBeTruthy();
  });

  it("an inherited value reads muted with the row it comes from, and has no ×", () => {
    subscribedDefaults = defaultsWith({
      inherited: {
        player: { fromId: oid("set"), fromName: "1989 Upper Deck", _id: pid("k"), name: "Ken Griffey Jr." },
        cameos: { fromId: oid("yr"), fromName: "1989", list: [{ _id: pid("a"), name: "Jay Buhner" }, { _id: pid("b"), name: "Edgar Martinez" }] },
      },
    });
    renderControl();
    const player = byWholeText("Ken Griffey Jr. (from 1989 Upper Deck)");
    expect(byWholeText("Jay Buhner, Edgar Martinez (from 1989)")).toBeTruthy();
    // The value in the panel's quiet ink, where it came from quieter still.
    expect(within(player).getByText("Ken Griffey Jr.").className).toContain("text-ink-2");
    expect(within(player).getByText("(from 1989 Upper Deck)").className).toContain("text-ink-3");
    expect(screen.queryByRole("button", { name: /^Stop / })).toBeNull();
  });

  it("this row's own value hides the inherited one, per field", () => {
    subscribedDefaults = defaultsWith({
      own: { player: { _id: pid("k"), name: "Ken Griffey Jr." }, cameos: [] },
      inherited: {
        player: { fromId: oid("set"), fromName: "1989 Upper Deck", _id: pid("x"), name: "Someone Else" },
        cameos: { fromId: oid("set"), fromName: "1989 Upper Deck", list: [{ _id: pid("a"), name: "Jay Buhner" }] },
      },
    });
    renderControl();
    expect(screen.queryByText(/Someone Else/)).toBeNull();
    expect(byWholeText("Jay Buhner (from 1989 Upper Deck)")).toBeTruthy();
  });

  it("with nothing stored here or above, it draws no stored lines", () => {
    renderControl();
    expect(screen.queryByText("Player:")).toBeNull();
    expect(screen.queryByText("Cameos:")).toBeNull();
  });

  // --- storing --------------------------------------------------------------------

  it("no cards beneath: saves with no confirm, says so, and clears the pick", async () => {
    subscribedDefaults = defaultsWith({ cardCount: 0, cardsToWalk: { player: 0, cameo: 0 } });
    renderControl();
    await pickAndPress(playerButton);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mockMutation).toHaveBeenCalledWith("cardPlayersBulk.setCardPlayerDefault", {
      selectorOptionId: VARIANT,
      kind: "player",
      playerId: "p1",
    });
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mutationCalls("cardPlayersBulk.addPlayerToVariant")).toHaveLength(0);
    expect(sectionStatus().textContent).toBe("Saved, every new card gets Dan Marino");
    // The pick is stored: the picker is empty again, and nothing reads "Picked:".
    expect(screen.getByText("Stub value:")).toBeTruthy();
    expect(screen.queryByText(BULK_PICKED_LABEL)).toBeNull();
  });

  it("no cards beneath for a cameo: the cameo toast", async () => {
    subscribedDefaults = defaultsWith({ cardCount: 0, cardsToWalk: { player: 0, cameo: 0 } });
    renderControl();
    await pickAndPress(cameoButton, "Stub pick p2");
    expect(mockMutation).toHaveBeenCalledWith("cardPlayersBulk.setCardPlayerDefault", {
      selectorOptionId: VARIANT,
      kind: "cameo",
      playerId: "p2",
    });
    expect(sectionStatus().textContent).toBe("Saved, every new card gets Don Shula as a cameo");
  });

  it("a cameo of this row's own player is refused beside the buttons before anything is asked", async () => {
    subscribedDefaults = defaultsWith({ own: { player: { _id: pid("p1"), name: "Dan Marino" }, cameos: [] } });
    renderControl();
    await pickAndPress(cameoButton);
    expect((await screen.findByRole("alert")).textContent).toBe("Dan Marino is already the player on every card.");
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockMutation).not.toHaveBeenCalled();
  });

  it("cards beneath: lists the run's checklists for that kind and asks; Cancel writes nothing", async () => {
    renderControl();
    await pickAndPress(playerButton);
    expect(mockQuery).toHaveBeenCalledWith("cardPlayersBulk.everyCardTargets", { variantId: VARIANT, kind: "player" });
    const dialog = await screen.findByRole("dialog", {
      name: "Add Dan Marino to every card in Base and its 2 parallels?",
    });
    expect(within(dialog).getByText(/New cards get Dan Marino too\./)).toBeTruthy();
    // The form behind the modal is inert while it is up.
    expect(screen.getByText("Stub pick p1").closest("[inert]")).not.toBeNull();
    // The confirm never reuses the trigger's words.
    expect(within(dialog).queryByRole("button", { name: BULK_ADD_PLAYER_LABEL })).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mockMutation).not.toHaveBeenCalled();
    expect(screen.getByText("Stub pick p1").closest("[inert]")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(playerButton()));
  });

  it("while the confirm is up the stored chips are inert and locked too", async () => {
    subscribedDefaults = defaultsWith({ own: { player: undefined, cameos: [{ _id: pid("a"), name: "Jay Buhner" }] } });
    renderControl();
    await pickAndPress(playerButton);
    await screen.findByRole("dialog");
    const x = screen.getByRole("button", { name: A.stopCameo("Jay Buhner"), hidden: true });
    expect(x.closest("[inert]")).not.toBeNull();
    expect(x.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(x);
    expect(mutationCalls("cardPlayersBulk.clearCardPlayerDefault")).toHaveLength(0);
  });

  it("the confirm's yes is the green of adding, beside a pink Cancel", async () => {
    renderControl();
    await pickAndPress(playerButton);
    const dialog = await screen.findByRole("dialog");
    const fill = (el: HTMLElement) => el.style.getPropertyValue("--nb-fill");
    expect(fill(within(dialog).getByRole("button", { name: YES_PLAYER }))).toBe("var(--neon-green)");
    expect(fill(within(dialog).getByRole("button", { name: "Cancel" }))).toBe("var(--neon-pink)");
  });

  it("the note after a save goes quiet after a few seconds", async () => {
    vi.useFakeTimers();
    try {
      subscribedDefaults = defaultsWith({ cardCount: 0, cardsToWalk: { player: 0, cameo: 0 } });
      renderControl();
      await pickAndPress(playerButton);
      expect(sectionStatus().textContent).toBe("Saved, every new card gets Dan Marino");
      act(() => {
        vi.advanceTimersByTime(6000);
      });
      expect(sectionStatus().textContent).toBe("");
    } finally {
      vi.useRealTimers();
    }
  });

  it("an unknown card count asks too", async () => {
    subscribedDefaults = defaultsWith({ cardCount: undefined, cardsToWalk: undefined });
    renderControl();
    await pickAndPress(cameoButton);
    expect(mockQuery).toHaveBeenCalledWith("cardPlayersBulk.everyCardTargets", { variantId: VARIANT, kind: "cameo" });
    expect(
      await screen.findByRole("dialog", { name: "Add Dan Marino as a cameo on every card in Base and its 2 parallels?" }),
    ).toBeTruthy();
  });

  it("an unknown count that turns out to walk nothing just saves", async () => {
    subscribedDefaults = defaultsWith({ cardCount: undefined, cardsToWalk: undefined });
    targetsAnswer = async () => ({ targets: [], truncated: false, overridden: 1 });
    renderControl();
    await pickAndPress(playerButton);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mutationCalls("cardPlayersBulk.setCardPlayerDefault")).toHaveLength(1);
    expect(sectionStatus().textContent).toBe("Saved, every new card gets Dan Marino");
  });

  it("says who it replaces for new cards", async () => {
    subscribedDefaults = defaultsWith({
      inherited: { player: { fromId: oid("set"), fromName: "Set", _id: pid("k"), name: "Ken Griffey Jr." } },
    });
    renderControl();
    await pickAndPress(playerButton);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Dan Marino replaces Ken Griffey Jr\. for new cards\./)).toBeTruthy();
  });

  it("on yes: stores first, then walks page by page until the server says done, as a ledger", async () => {
    renderControl();
    await pickAndPress(playerButton);
    await confirmRun();
    await screen.findByRole("heading", { name: "Added Dan Marino to 127 cards" });
    const names = mockMutation.mock.calls.map((c) => c[0]);
    expect(names[0]).toBe("cardPlayersBulk.setCardPlayerDefault");
    expect(mockMutation.mock.calls[0][1]).toEqual({ selectorOptionId: VARIANT, kind: "player", playerId: "p1" });
    const pages = mutationCalls("cardPlayersBulk.addPlayerToVariant");
    expect(pages.map((c) => (c[1] as { cursor: string | null }).cursor)).toEqual([null, "base-2", "gold-1", "black-1"]);
    for (const call of pages) expect(call[1]).toMatchObject({ variantId: VARIANT, playerId: "p1" });
    const ledger = screen.getByRole("region", { name: "Added Dan Marino to 127 cards" });
    expect(
      within(ledger).getByText("Base — added to 69 cards, skipped 1 that has a player, 69 card titles updated"),
    ).toBeTruthy();
    expect(
      within(ledger).getByText("Black — added to 28 cards, 2 already Dan Marino's, 27 card titles updated, 1 kept as you typed them"),
    ).toBeTruthy();
    // Done: the actions are free again, nothing to stop, and the pick went to the stored chip.
    expect(screen.queryByRole("button", { name: BULK_STOP_LABEL })).toBeNull();
    expect(within(ledger).getByRole("button", { name: BULK_DISMISS_LABEL }).textContent).toBe("Dismiss");
    expect(screen.getByText("Stub value:")).toBeTruthy();
    expect(screen.queryByText(BULK_PICKED_LABEL)).toBeNull();
  });

  it("a cameo run stores a cameo and walks the cameo pages", async () => {
    pageAnswer = async () => page({ targetIndex: 2, cursor: null, scanned: 3, changed: 3 });
    renderControl();
    await pickAndPress(cameoButton, "Stub pick p2");
    await confirmRun(YES_CAMEO);
    await screen.findByRole("heading", { name: "Added Don Shula as a cameo on 3 cards" });
    expect(mockMutation.mock.calls[0]).toEqual([
      "cardPlayersBulk.setCardPlayerDefault",
      { selectorOptionId: VARIANT, kind: "cameo", playerId: "p2" },
    ]);
    expect(mockMutation).toHaveBeenCalledWith("cardPlayersBulk.addCameoToVariant", {
      variantId: VARIANT,
      playerId: "p2",
      cursor: null,
    });
  });

  it("a refused store fails the run before any card, with the reason on the line", async () => {
    storeAnswer = async () => {
      throw new ConvexError("Every card can carry at most 20 cameos.");
    };
    renderControl();
    await pickAndPress(cameoButton);
    await confirmRun(YES_CAMEO);
    await screen.findByRole("heading", { name: /^Stopped before any card changed\./ });
    expect(screen.getByText("Base — Every card can carry at most 20 cameos.")).toBeTruthy();
    expect(mutationCalls("cardPlayersBulk.addCameoToVariant")).toHaveLength(0);
  });

  it("while it counts, the pressed action stays focused and a second press asks nothing more", async () => {
    let answer: (v: unknown) => void = () => {};
    targetsAnswer = () => new Promise((resolve) => (answer = resolve));
    renderControl();
    fireEvent.click(screen.getByText("Stub pick p1"));
    act(() => playerButton().focus());
    fireEvent.click(playerButton());
    // Its name stays put; aria-busy and the polite line say what it is doing.
    const counting = playerButton();
    expect(counting.getAttribute("aria-busy")).toBe("true");
    expect(cameoButton().getAttribute("aria-busy")).toBeNull();
    expect(screen.getByText(BULK_COUNTING_TEXT).getAttribute("aria-live")).toBe("polite");
    expect(counting.getAttribute("aria-disabled")).toBe("true");
    expect((counting as HTMLButtonElement).disabled).toBe(false);
    expect(document.activeElement).toBe(counting);
    fireEvent.click(counting);
    fireEvent.click(cameoButton());
    expect(mockQuery).toHaveBeenCalledTimes(1);
    await act(async () => answer({ targets: TARGETS, truncated: false, overridden: 0 }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });

  // --- clearing --------------------------------------------------------------------

  it("× clears with no confirm, says the cards keep them, and hands focus to the picker", async () => {
    let done: (v: unknown) => void = () => {};
    clearAnswer = () => new Promise((resolve) => (done = resolve));
    subscribedDefaults = defaultsWith({
      own: { player: { _id: pid("k"), name: "Ken Griffey Jr." }, cameos: [{ _id: pid("a"), name: "Jay Buhner" }] },
    });
    renderControl();
    const x = screen.getByRole("button", { name: A.stopCameo("Jay Buhner") });
    act(() => x.focus());
    fireEvent.click(x);
    // Focus left the × before the write that takes it away.
    expect(document.activeElement).toBe(trigger());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mockMutation).toHaveBeenCalledWith("cardPlayersBulk.clearCardPlayerDefault", {
      selectorOptionId: VARIANT,
      kind: "cameo",
      playerId: "a",
    });
    // A second × while the first is in flight asks nothing more.
    fireEvent.click(screen.getByRole("button", { name: A.stopPlayer("Ken Griffey Jr.") }));
    expect(mutationCalls("cardPlayersBulk.clearCardPlayerDefault")).toHaveLength(1);
    await act(async () => done({ playerId: "k", cameoIds: [] }));
    expect(sectionStatus().textContent).toBe("Cleared, new cards won't get Jay Buhner; cards that have them keep them");
  });

  it("a refused clear says why beside the buttons", async () => {
    clearAnswer = async () => {
      throw new ConvexError("That part of the set isn't in Neon Binder anymore.");
    };
    subscribedDefaults = defaultsWith({ own: { player: { _id: pid("k"), name: "Ken Griffey Jr." }, cameos: [] } });
    renderControl();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: A.stopPlayer("Ken Griffey Jr.") }));
    });
    expect((await screen.findByRole("alert")).textContent).toBe("That part of the set isn't in Neon Binder anymore.");
    expect(sectionStatus().textContent).toBe("");
  });

  // --- the run --------------------------------------------------------------------

  it("Stop lets the page in flight land, then stops and says how to finish", async () => {
    let release: (p: BulkPage) => void = () => {};
    pageAnswer = () => new Promise<BulkPage>((resolve) => (release = resolve));
    renderControl();
    await pickAndPress(playerButton);
    await confirmRun();
    const stop = await screen.findByRole("button", { name: BULK_STOP_LABEL });
    // Busy: the picker and both actions are held.
    expect((screen.getByText("Stub pick p1") as HTMLButtonElement).disabled).toBe(true);
    expect(playerButton().getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(stop);
    expect(
      screen.getByRole("button", { name: "Stopping after these cards…" }).getAttribute("aria-disabled"),
    ).toBe("true");
    await act(async () => {
      release(page({ targetIndex: 0, cursor: "more", scanned: 50, changed: 50 }));
    });
    await screen.findByRole("heading", {
      name: "Stopped, like you asked. So far: added Dan Marino to 50 cards. Run it again to finish; cards already done are skipped.",
    });
    expect(mutationCalls("cardPlayersBulk.addPlayerToVariant")).toHaveLength(1);
    // The pick stays, so one press finishes the run; still drawn as a pick.
    expect(screen.getByText("Stub value: p1")).toBeTruthy();
    expect(screen.getByText(BULK_PICKED_LABEL)).toBeTruthy();
  });

  it("a refused page stops the run with the reason in the operator's words", async () => {
    const pages = [page({ targetIndex: 0, cursor: "x", scanned: 50, changed: 50 })];
    pageAnswer = async () => {
      const next = pages.shift();
      if (next) return next;
      throw new ConvexError("That progress marker is past the end of this checklist. Start again.");
    };
    renderControl();
    await pickAndPress(playerButton);
    await confirmRun();
    await screen.findByRole("heading", { name: /^Stopped at Base\./ });
    expect(screen.getByText(`Base — ${BULK_CHECKLIST_CHANGED_TEXT}`)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/progress marker|cursor/i);
  });

  it("a failed count shows the reason beside the buttons, opens no dialog, and keeps focus on the action", async () => {
    let refuse: (e: unknown) => void = () => {};
    targetsAnswer = () => new Promise((_, reject) => (refuse = reject));
    renderControl();
    fireEvent.click(screen.getByText("Stub pick p1"));
    act(() => cameoButton().focus());
    fireEvent.click(cameoButton());
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    act(() => outside.focus());
    await act(async () => {
      refuse(new ConvexError("That part of the set isn't in Neon Binder anymore."));
    });
    expect((await screen.findByRole("alert")).textContent).toBe("That part of the set isn't in Neon Binder anymore.");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(cameoButton());
    outside.remove();
  });

  it("collapsed, it shows nothing while idle", () => {
    const { container } = renderControl({ expanded: false });
    expect(container.textContent).toBe("");
  });

  it("collapsed mid-run, the ledger stays on screen", async () => {
    pageAnswer = () => new Promise(() => {});
    const { rerender } = renderControl();
    await pickAndPress(playerButton);
    await confirmRun();
    rerender(<EveryCardPlayerControl {...props({ expanded: false })} />);
    expect(screen.getByRole("heading", { name: "Adding Dan Marino to every card: checklist 1 of 3" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: BULK_ADD_PLAYER_LABEL })).toBeNull();
  });

  it("says when there are more checklists than one run reaches", async () => {
    targetsAnswer = async () => ({ targets: TARGETS, truncated: true, overridden: 0 });
    pageAnswer = async () => page({ targetIndex: 2, cursor: null });
    renderControl();
    await pickAndPress(playerButton);
    await confirmRun();
    expect(await screen.findByText(BULK_TRUNCATED_TEXT)).toBeTruthy();
    expect(BULK_TRUNCATED_TEXT).toBe(
      "Over 500 checklists here. This run covers the first 500; run the rest from their own set or insert.",
    );
  });

  it("mounts its live line before any run, so the start is announced", async () => {
    pageAnswer = () => new Promise(() => {});
    renderControl();
    // The run's own line, outside the section (its status line is the other).
    const liveLine = () => screen.getAllByRole("status").find((el) => !el.closest("section"))!;
    const status = liveLine();
    expect(status.textContent).toBe("");
    await pickAndPress(playerButton);
    await confirmRun();
    // The same node, now speaking: it was in the page before the run began.
    expect(liveLine()).toBe(status);
    expect(status.textContent).toBe("Adding Dan Marino to every card in Base and its 2 parallels.");
  });

  it("on yes, focus parks on the ledger", async () => {
    pageAnswer = () => new Promise(() => {});
    renderControl();
    await pickAndPress(playerButton);
    await confirmRun();
    const ledger = await screen.findByRole("region", { name: /^Adding Dan Marino to every card/ });
    await waitFor(() => expect(document.activeElement).toBe(ledger));
  });

  it("when the run ends with Stop gone from under focus, focus lands on the ledger", async () => {
    let release: (p: BulkPage) => void = () => {};
    pageAnswer = () => new Promise<BulkPage>((resolve) => (release = resolve));
    renderControl();
    await pickAndPress(playerButton);
    await confirmRun();
    const stop = await screen.findByRole("button", { name: BULK_STOP_LABEL });
    act(() => stop.focus());
    fireEvent.click(stop);
    await act(async () => {
      release(page({ targetIndex: 0, cursor: "more", scanned: 50, changed: 50 }));
    });
    const ledger = await screen.findByRole("region", { name: /^Stopped, like you asked\./ });
    await waitFor(() => expect(document.activeElement).toBe(ledger));
  });

  it("when the run ends while the operator is elsewhere, focus stays where they put it", async () => {
    let release: (p: BulkPage) => void = () => {};
    pageAnswer = () => new Promise<BulkPage>((resolve) => (release = resolve));
    renderControl();
    await pickAndPress(playerButton);
    await confirmRun();
    await screen.findByRole("button", { name: BULK_STOP_LABEL });
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
    pageAnswer = async () => page({ targetIndex: 2, cursor: null, scanned: 3, changed: 3 });
    const { rerender } = renderControl();
    await pickAndPress(playerButton);
    await confirmRun();
    await screen.findByRole("heading", { name: "Added Dan Marino to 3 cards" });

    rerender(<EveryCardPlayerControl {...props({ expanded: false })} />);
    expect(screen.getByRole("heading", { name: "Added Dan Marino to 3 cards" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: PLAYER_ON_EVERY_CARD_HEADING })).toBeNull();

    const onDismissedCollapsed = vi.fn();
    rerender(<EveryCardPlayerControl {...props({ onDismissedCollapsed })} />);
    fireEvent.click(screen.getByRole("button", { name: BULK_DISMISS_LABEL }));
    expect(onDismissedCollapsed).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "Added Dan Marino to 3 cards" })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(playerButton()));
  });

  it("Dismiss with the panel shut leaves nothing behind and tells the panel", async () => {
    pageAnswer = async () => page({ targetIndex: 2, cursor: null, scanned: 3, changed: 3 });
    const { rerender, container } = renderControl();
    await pickAndPress(playerButton);
    await confirmRun();
    await screen.findByRole("heading", { name: "Added Dan Marino to 3 cards" });
    const onDismissedCollapsed = vi.fn();
    rerender(<EveryCardPlayerControl {...props({ expanded: false, onDismissedCollapsed })} />);
    fireEvent.click(screen.getByRole("button", { name: BULK_DISMISS_LABEL }));
    expect(onDismissedCollapsed).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("heading")).toBeNull();
    expect(container.querySelectorAll("section")).toHaveLength(0);
  });
});
