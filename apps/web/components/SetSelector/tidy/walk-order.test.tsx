/**
 * NEO-645 — the order Tidy Up walks in, and the sitting's memory.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  EMPTY_SITTING,
  cardsLeft,
  cardsLeftText,
  cardsSkipped,
  cardsSkippedText,
  cardsTallyText,
  loadSitting,
  lookupKey,
  lookupsFinished,
  nextCardId,
  pendingLookupKeys,
  previousCardId,
  resetSitting,
  saveSitting,
  tallyText,
  walkOrder,
  withPassed,
  withShown,
  type WalkRow,
} from "./walk-order";
import { deriveCardAttention } from "../card-attention";

/** A card with a team and a pending player name: pink for the name. */
const pinkName = (id: string, cardNumber: string, extra: Partial<WalkRow> = {}): WalkRow => ({
  _id: id,
  cardNumber,
  teamOnCardIds: ["team"],
  pendingPlayerNames: [`Name ${id}`],
  ...extra,
});

/** A card with a team and nothing pending: not in the walk. */
const tidy = (id: string, cardNumber: string): WalkRow => ({
  _id: id,
  cardNumber,
  teamOnCardIds: ["team"],
  playerIds: ["p"],
});

describe("walkOrder", () => {
  it("holds only the cards that need a person", () => {
    const rows = [pinkName("a", "1"), tidy("b", "2"), pinkName("c", "3")];
    expect(walkOrder(rows).map((e) => e.row._id)).toEqual(["a", "c"]);
  });

  it("agrees with the attention rule the badge and the pill use", () => {
    const rows = [pinkName("a", "1"), tidy("b", "2")];
    const walked = new Set(walkOrder(rows).map((e) => e.row._id));
    for (const row of rows) {
      expect(walked.has(row._id)).toBe(deriveCardAttention(row).level !== "none");
    }
  });

  it("sorts card numbers naturally", () => {
    const rows = [pinkName("a", "USC10"), pinkName("b", "USC2"), pinkName("c", "USC1")];
    expect(walkOrder(rows).map((e) => e.row.cardNumber)).toEqual(["USC1", "USC2", "USC10"]);
  });

  it("puts cards whose lookups have finished before cards still looking", () => {
    const rows = [pinkName("late", "1"), pinkName("ready", "2")];
    const pending = pendingLookupKeys({
      names: [{ kind: "player", nameNormalized: lookupKey("player", "Name late").split(":")[1] }],
    });
    const order = walkOrder(rows, pending);
    expect(order.map((e) => e.row._id)).toEqual(["ready", "late"]);
    expect(order.map((e) => e.ready)).toEqual([true, false]);
  });

  it("puts a card still waiting on the automatic team lookup after the ready ones", () => {
    const waiting: WalkRow = {
      _id: "w",
      cardNumber: "1",
      pendingPlayerNames: ["X"],
      platformData: { bsc: { ref: "r" } },
    };
    const order = walkOrder([waiting, pinkName("r", "2")]);
    expect(order.map((e) => e.row._id)).toEqual(["r", "w"]);
  });

  it("orders by the leaf's rank between readiness and number", () => {
    const rows = [pinkName("a", "1"), pinkName("b", "2")];
    const order = walkOrder(rows, new Set(), (row) => (row._id === "b" ? 0 : 1));
    expect(order.map((e) => e.row._id)).toEqual(["b", "a"]);
  });

  it("never reads a marketplace value: a card is in the walk by its own data", () => {
    const row = pinkName("a", "1", { platformData: { sportlots: { ref: "x" } } });
    expect(walkOrder([row])).toHaveLength(1);
  });
});

describe("lookupsFinished", () => {
  it("is true when nothing is pending", () => {
    expect(lookupsFinished(pinkName("a", "1"), new Set())).toBe(true);
  });

  it("is false while one of the card's team names is still looking", () => {
    const row: WalkRow = { _id: "a", cardNumber: "1", pendingTeamNames: ["Padres"] };
    const keys = pendingLookupKeys({
      names: [{ kind: "team", nameNormalized: lookupKey("team", "Padres").split(":")[1] }],
    });
    expect(lookupsFinished(row, keys)).toBe(false);
  });

  it("matches a name through the one normaliser (accents, case)", () => {
    expect(lookupKey("player", "  José  RAMÍREZ ")).toBe(lookupKey("player", "jose ramirez"));
  });
});

describe("the sitting", () => {
  const order = ["a", "b", "c"].map((id) => ({ row: { _id: id } }));

  it("offers the first card not yet passed, never the current one", () => {
    expect(nextCardId(order, EMPTY_SITTING, null)).toBe("a");
    expect(nextCardId(order, EMPTY_SITTING, "a")).toBe("b");
    expect(nextCardId(order, withPassed(EMPTY_SITTING, "a"), "b")).toBe("c");
  });

  it("answers null when every card has been passed or is the current one", () => {
    const sitting = withPassed(withPassed(EMPTY_SITTING, "a"), "b");
    expect(nextCardId(order, sitting, "c")).toBeNull();
  });

  it("counts cards left (the current one included) and cards skipped", () => {
    const sitting = withPassed(EMPTY_SITTING, "a");
    expect(cardsLeft(order, sitting)).toBe(2);
    expect(cardsSkipped(order, sitting)).toBe(1);
  });

  it("does not count a passed card that was fixed (it left the order)", () => {
    const sitting = withPassed(EMPTY_SITTING, "z");
    expect(cardsSkipped(order, sitting)).toBe(0);
  });

  it("walks the trail back one card at a time", () => {
    let s = withShown(EMPTY_SITTING, "a");
    s = withShown(s, "b");
    s = withShown(s, "c");
    expect(previousCardId(s, "c")).toBe("b");
    s = withShown(s, "b");
    expect(s.trail).toEqual(["a", "b"]);
    expect(previousCardId(s, "b")).toBe("a");
    expect(previousCardId(s, "a")).toBeNull();
  });

  it("answers the last card shown when asked from the end screen", () => {
    const s = withShown(withShown(EMPTY_SITTING, "a"), "b");
    expect(previousCardId(s, null)).toBe("b");
  });

  it("returns the same sitting when nothing changed", () => {
    const s = withShown(EMPTY_SITTING, "a");
    expect(withShown(s, "a")).toBe(s);
    const p = withPassed(s, "a");
    expect(withPassed(p, "a")).toBe(p);
  });
});

describe("words", () => {
  it("says cards left in the singular and plural", () => {
    expect(cardsLeftText(31)).toBe("31 cards left");
    expect(cardsLeftText(1)).toBe("1 card left");
    expect(cardsLeftText(0)).toBe("No cards left");
  });

  it("says cards skipped", () => {
    expect(cardsSkippedText(6)).toBe("6 cards skipped, not ready to list");
    expect(cardsSkippedText(1)).toBe("1 card skipped, not ready to list");
    expect(cardsTallyText(9, 2)).toBe("9 cards fixed, 2 skipped.");
    expect(cardsTallyText(1, 1)).toBe("1 card fixed, 1 skipped.");
    expect(cardsTallyText(0, 6)).toBe("0 cards fixed, 6 skipped.");
    // Nothing skipped earns the sign-off; a sitting that fixed nothing does not.
    expect(cardsTallyText(9, 0)).toBe("9 cards fixed, 0 skipped. Totally rad.");
    expect(cardsTallyText(0, 0)).toBe("0 cards fixed, 0 skipped.");
  });

  it("tallies pink and blue, leaving out a zero half", () => {
    const attention = (fix: number, check: number) => ({
      level: fix ? ("fix" as const) : check ? ("check" as const) : ("none" as const),
      items: [
        ...Array.from({ length: fix }, () => ({ level: "fix" as const, kind: "noTeam" as const })),
        ...Array.from({ length: check }, (_, i) => ({
          level: "check" as const,
          kind: "titleCut" as const,
          key: `k${i}`,
        })),
      ],
    });
    expect(tallyText(attention(3, 1))).toBe("3 to fix · 1 to check");
    expect(tallyText(attention(2, 0))).toBe("2 to fix");
    expect(tallyText(attention(0, 2))).toBe("2 to check");
    expect(tallyText(attention(0, 0))).toBe("");
  });
});

describe("sessionStorage", () => {
  beforeEach(() => window.sessionStorage.clear());

  it("round-trips a sitting per leaf", () => {
    saveSitting("leaf1", { passed: ["a"], trail: ["a", "b"] });
    expect(loadSitting("leaf1")).toEqual({ passed: ["a"], trail: ["a", "b"] });
    expect(loadSitting("leaf2")).toEqual(EMPTY_SITTING);
  });

  it("starts a new sitting empty", () => {
    saveSitting("leaf1", { passed: ["a"], trail: ["a"] });
    resetSitting("leaf1");
    expect(loadSitting("leaf1")).toEqual(EMPTY_SITTING);
  });

  it("reads garbage as an empty sitting", () => {
    window.sessionStorage.setItem("nb:tidy-walk:leaf1", "{not json");
    expect(loadSitting("leaf1")).toEqual(EMPTY_SITTING);
    window.sessionStorage.setItem("nb:tidy-walk:leaf1", JSON.stringify({ passed: [1], trail: "x" }));
    expect(loadSitting("leaf1")).toEqual(EMPTY_SITTING);
  });
});
