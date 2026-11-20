/**
 * NEO-574 — the pure career-coverage rule and the pair derivation.
 *
 * The rule: a stint counts for a card of year Y when it is undated or began in
 * or before Y (strict, no tolerance), and covers the card's team when the two
 * teams share a key (id, franchise, name). An empty career covers nothing.
 */
import { describe, expect, test } from "vitest";
import {
  careerCoversCardTeam,
  deriveCareerPairs,
  franchiseIdKey,
  stintCountsForYear,
  teamIdKey,
  teamNameKey,
  teamRowCardKeys,
  teamRowKeys,
  type CareerCheckCard,
  type CoverageStint,
} from "./careerCoverage";

const padresStint = (extra: Partial<CoverageStint> = {}): CoverageStint => ({
  keys: teamRowKeys({ id: "padres1", fullName: "San Diego Padres", name: "Padres" }),
  fromYear: 1990,
  toYear: 1995,
  ...extra,
});

describe("stintCountsForYear", () => {
  test("a stint begun in or before the card's year counts", () => {
    expect(stintCountsForYear({ fromYear: 1990 }, 1990)).toBe(true);
    expect(stintCountsForYear({ fromYear: 1989 }, 1990)).toBe(true);
  });

  test("a stint begun after the card's year does not, with no tolerance at all", () => {
    expect(stintCountsForYear({ fromYear: 1991 }, 1990)).toBe(false);
  });

  test("an undated stint always counts", () => {
    expect(stintCountsForYear({}, 1990)).toBe(true);
  });
});

describe("careerCoversCardTeam", () => {
  test("matches by team id", () => {
    expect(careerCoversCardTeam([padresStint()], [teamIdKey("padres1")], 1992)).toBe(true);
  });

  test("matches by franchise across differently-named rows", () => {
    const oilers = {
      keys: teamRowKeys({ id: "oilers", franchiseId: "titans", fullName: "Houston Oilers", name: "Oilers" }),
      fromYear: 1985,
    };
    const titansCard = teamRowCardKeys({ id: "titans-row", franchiseId: "titans", fullName: "Tennessee Titans" });
    expect(careerCoversCardTeam([oilers], titansCard, 1999)).toBe(true);
    // Without the franchise link the two rows share nothing.
    const unlinked = teamRowCardKeys({ id: "titans-row", fullName: "Tennessee Titans" });
    expect(careerCoversCardTeam([oilers], unlinked, 1999)).toBe(false);
  });

  test("matches a printed nickname against the stint team's nickname key", () => {
    const printed = [teamNameKey("Padres")!];
    expect(careerCoversCardTeam([padresStint()], printed, 1992)).toBe(true);
  });

  test("two clubs sharing a nickname are NOT confused when the card's team is a known row", () => {
    // A known row carries id, franchise and FULL name, never its nickname.
    const auburn = teamRowCardKeys({ id: "auburn", fullName: "Auburn Tigers" });
    const lsu = {
      keys: teamRowKeys({ id: "lsu", fullName: "LSU Tigers", name: "Tigers" }),
      fromYear: 1980,
    };
    expect(careerCoversCardTeam([lsu], auburn, 1990)).toBe(false);
  });

  test("a stint that begins after the card's year does not cover it", () => {
    expect(careerCoversCardTeam([padresStint({ fromYear: 1993 })], [teamIdKey("padres1")], 1992)).toBe(false);
  });

  test("an undated stint covers", () => {
    const undated: CoverageStint = { keys: [teamIdKey("padres1")] };
    expect(careerCoversCardTeam([undated], [teamIdKey("padres1")], 1992)).toBe(true);
  });

  test("an empty career covers nothing", () => {
    expect(careerCoversCardTeam([], [teamIdKey("padres1")], 1992)).toBe(false);
  });

  test("a stint whose team row is gone (no keys) covers nothing", () => {
    expect(careerCoversCardTeam([{ keys: [], fromYear: 1990 }], [teamIdKey("padres1")], 1992)).toBe(false);
  });

  test("no card keys cover nothing", () => {
    expect(careerCoversCardTeam([padresStint()], [], 1992)).toBe(false);
    expect(careerCoversCardTeam([padresStint()], new Set<string>(), 1992)).toBe(false);
  });

  test("the end year is irrelevant: a player who left before the card still played for the club", () => {
    expect(
      careerCoversCardTeam([padresStint({ fromYear: 1980, toYear: 1982 })], [teamIdKey("padres1")], 2005),
    ).toBe(true);
  });

  test("franchise keys are distinct from team keys with the same text", () => {
    expect(franchiseIdKey("x")).not.toBe(teamIdKey("x"));
  });
});

describe("deriveCareerPairs", () => {
  const resolver = {
    playerIdFor: (printed: string) =>
      ({ "Ken Griffey Jr.": "p-griffey", "Bob Allen": "p-allen", "Bob Allen Jr.": "p-allen2" } as Record<string, string>)[printed],
    teamFor: (printed: string) =>
      ({ Mariners: { teamId: "t-mariners" }, "New Team": { teamName: "New Team" } } as Record<
        string,
        { teamId?: string; teamName?: string }
      >)[printed],
  };

  const card = (over: Partial<CareerCheckCard> & { cardNumber: string }): CareerCheckCard => over;

  test("a single-player card with a resolved team gives one pair, with its card numbers", () => {
    const pairs = deriveCareerPairs({
      cards: [
        card({ cardNumber: "1", players: ["Ken Griffey Jr."], teams: ["Mariners"] }),
        card({ cardNumber: "2", players: ["Ken Griffey Jr."], teams: ["Mariners"] }),
      ],
      setYear: 1990,
      ...resolver,
    });
    expect(pairs).toEqual([
      {
        playerId: "p-griffey",
        printedPlayer: "Ken Griffey Jr.",
        teamId: "t-mariners",
        teamName: "Mariners",
        cardIndexes: [0, 1],
        cardNumbers: ["1", "2"],
      },
    ]);
  });

  test("a multi-player card is never checked", () => {
    const pairs = deriveCareerPairs({
      cards: [card({ cardNumber: "1", players: ["Ken Griffey Jr.", "Bob Allen"], teams: ["Mariners"] })],
      setYear: 1990,
      ...resolver,
    });
    expect(pairs).toEqual([]);
  });

  test("the same name printed twice is still one player", () => {
    const pairs = deriveCareerPairs({
      cards: [card({ cardNumber: "1", players: ["Ken Griffey Jr.", " ken griffey jr. "], teams: ["Mariners"] })],
      setYear: 1990,
      ...resolver,
      playerIdFor: (p) => (p.trim().toLowerCase() === "ken griffey jr." ? "p-griffey" : undefined),
    });
    expect(pairs).toHaveLength(1);
  });

  test("no set year, no pairs", () => {
    expect(
      deriveCareerPairs({
        cards: [card({ cardNumber: "1", players: ["Ken Griffey Jr."], teams: ["Mariners"] })],
        setYear: undefined,
        ...resolver,
      }),
    ).toEqual([]);
  });

  test("cards the save will not create are skipped", () => {
    const pairs = deriveCareerPairs({
      cards: [
        card({ cardNumber: "1", players: ["Ken Griffey Jr."], teams: ["Mariners"] }),
        card({ cardNumber: "2", players: ["Bob Allen"], teams: ["Mariners"] }),
      ],
      existingIndexes: new Set([0]),
      setYear: 1990,
      ...resolver,
    });
    expect(pairs.map((p) => p.playerId)).toEqual(["p-allen"]);
  });

  test("a player that is not an existing NB player, and a team that did not resolve, are skipped", () => {
    const pairs = deriveCareerPairs({
      cards: [
        card({ cardNumber: "1", players: ["Somebody New"], teams: ["Mariners"] }),
        card({ cardNumber: "2", players: ["Ken Griffey Jr."], teams: ["Unknown Club"] }),
      ],
      setYear: 1990,
      ...resolver,
    });
    expect(pairs).toEqual([]);
  });

  test("a team this batch creates is a pair by its text, deduped case-insensitively", () => {
    const pairs = deriveCareerPairs({
      cards: [
        card({ cardNumber: "1", players: ["Bob Allen"], teams: ["New Team"] }),
        card({ cardNumber: "2", players: ["Bob Allen"], teams: ["New Team"] }),
      ],
      setYear: 1990,
      ...resolver,
    });
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ playerId: "p-allen", teamName: "New Team", cardNumbers: ["1", "2"] });
    expect(pairs[0].teamId).toBeUndefined();
  });

  test("a card with two teams gives a pair per team, and an operator-picked team id joins them", () => {
    const pairs = deriveCareerPairs({
      cards: [card({ cardNumber: "1", players: ["Bob Allen"], teams: ["Mariners"], teamIds: ["t-picked"] })],
      setYear: 1990,
      ...resolver,
    });
    expect(pairs.map((p) => p.teamId)).toEqual(["t-picked", "t-mariners"]);
  });

  test("a picked team id that is also the printed team's resolution is one pair", () => {
    const pairs = deriveCareerPairs({
      cards: [card({ cardNumber: "1", players: ["Bob Allen"], teams: ["Mariners"], teamIds: ["t-mariners"] })],
      setYear: 1990,
      ...resolver,
    });
    expect(pairs).toHaveLength(1);
  });

  test("the legacy singular team is read when `teams` is empty", () => {
    const pairs = deriveCareerPairs({
      cards: [card({ cardNumber: "1", players: ["Bob Allen"], team: "Mariners" })],
      setYear: 1990,
      ...resolver,
    });
    expect(pairs).toHaveLength(1);
  });

  test("pair order is first appearance in card order", () => {
    const pairs = deriveCareerPairs({
      cards: [
        card({ cardNumber: "1", players: ["Bob Allen"], teams: ["Mariners"] }),
        card({ cardNumber: "2", players: ["Ken Griffey Jr."], teams: ["Mariners"] }),
        card({ cardNumber: "3", players: ["Bob Allen"], teams: ["Mariners"] }),
      ],
      setYear: 1990,
      ...resolver,
    });
    expect(pairs.map((p) => p.playerId)).toEqual(["p-allen", "p-griffey"]);
    expect(pairs[0].cardIndexes).toEqual([0, 2]);
  });
});

describe("adversarial: keys and edges", () => {
  test("text that normalises to nothing gives no name key", () => {
    expect(teamNameKey("   ")).toBeNull();
    expect(teamNameKey("")).toBeNull();
  });

  test("a team row never contributes an empty or duplicate key", () => {
    const keys = teamRowKeys({ id: "x", fullName: "Padres", name: "Padres" });
    expect(keys.filter((k) => k === teamNameKey("Padres"))).toHaveLength(1);
    const blank = teamRowKeys({ id: "x", fullName: "  ", name: "" });
    expect(blank).toEqual([teamIdKey("x")]);
  });

  test("a known card row carries no nickname key", () => {
    const keys = teamRowCardKeys({ id: "auburn", fullName: "Auburn Tigers" });
    expect(keys).not.toContain(teamNameKey("Tigers"));
  });

  test("a later stint on the card's team does not count while an earlier one on another team does", () => {
    const later = padresStint({ fromYear: 2000 });
    const other: CoverageStint = { keys: [teamIdKey("cubs")], fromYear: 1980 };
    expect(careerCoversCardTeam([other, later], [teamIdKey("padres1")], 1999)).toBe(false);
    expect(careerCoversCardTeam([other, later], [teamIdKey("padres1")], 2000)).toBe(true);
  });

  test("a stint dated year 0 is dated, not undated", () => {
    expect(stintCountsForYear({ fromYear: 0 }, -1)).toBe(false);
  });

  test("a franchise stint covers across sports-neutral keys only through the franchise id", () => {
    const stint: CoverageStint = { keys: teamRowKeys({ id: "a", franchiseId: "f1", fullName: "A B", name: "B" }) };
    expect(careerCoversCardTeam([stint], [franchiseIdKey("f2")], 2000)).toBe(false);
    expect(careerCoversCardTeam([stint], [franchiseIdKey("f1")], 2000)).toBe(true);
  });
});

describe("adversarial: deriveCareerPairs", () => {
  const base = {
    playerIdFor: (p: string) => ({ A: "pa", B: "pb" } as Record<string, string>)[p],
    teamFor: (p: string) => (p === "Mariners" ? { teamId: "tm" } : p === "Fresh" ? { teamName: "Fresh" } : undefined),
  };

  test("a fractional set year checks nothing", () => {
    expect(
      deriveCareerPairs({ cards: [{ cardNumber: "1", players: ["A"], teams: ["Mariners"] }], setYear: 1990.5, ...base }),
    ).toEqual([]);
  });

  test("two printed players, one of them unresolved, is still a multi-player card and never checked", () => {
    expect(
      deriveCareerPairs({
        cards: [{ cardNumber: "1", players: ["A", "Nobody"], teams: ["Mariners"] }],
        setYear: 1990,
        ...base,
      }),
    ).toEqual([]);
  });

  test("blank player entries do not make a solo card multi-player", () => {
    const pairs = deriveCareerPairs({
      cards: [{ cardNumber: "1", players: ["", "  ", "A"], teams: ["Mariners"] }],
      setYear: 1990,
      ...base,
    });
    expect(pairs).toHaveLength(1);
  });

  test("a blank printed team and a team ref with blank text are skipped", () => {
    const pairs = deriveCareerPairs({
      cards: [{ cardNumber: "1", players: ["A"], teams: ["  "] }],
      setYear: 1990,
      playerIdFor: base.playerIdFor,
      teamFor: () => ({ teamName: "   " }),
    });
    expect(pairs).toEqual([]);
  });

  test("the same team printed twice on one card is one pair with the card listed once", () => {
    const pairs = deriveCareerPairs({
      cards: [{ cardNumber: "1", players: ["A"], teams: ["Mariners", "Mariners"] }],
      setYear: 1990,
      ...base,
    });
    expect(pairs).toHaveLength(1);
    expect(pairs[0].cardNumbers).toEqual(["1"]);
  });

  test("two cards sharing a card number stay two entries (card number is not a key)", () => {
    const pairs = deriveCareerPairs({
      cards: [
        { cardNumber: "7", players: ["A"], teams: ["Mariners"] },
        { cardNumber: "7", players: ["A"], teams: ["Mariners"] },
      ],
      setYear: 1990,
      ...base,
    });
    expect(pairs[0].cardIndexes).toEqual([0, 1]);
    expect(pairs[0].cardNumbers).toEqual(["7", "7"]);
  });

  test("one player on two different new-team texts gives two pairs", () => {
    const pairs = deriveCareerPairs({
      cards: [
        { cardNumber: "1", players: ["A"], teams: ["Fresh"] },
        { cardNumber: "2", players: ["A"], teams: ["Mariners"] },
      ],
      setYear: 1990,
      ...base,
    });
    expect(pairs.map((p) => p.teamId ?? p.teamName)).toEqual(["Fresh", "tm"]);
  });
});
