import { describe, expect, it } from "vitest";
import {
  ruleCanUseSecondaryPlayers,
  ruleFit,
  ruleIds,
  ruleMatches,
  ruleProblem,
  yearOfSeason,
  type CardFacts,
  type StoredRule,
} from "./binder-rule";

const facts = (over: Partial<CardFacts> = {}): CardFacts => ({
  playerIds: new Set(["gooden"]),
  teamIds: new Set(["mets"]),
  playedForIds: new Set(["mets", "yankees"]),
  hallOfFame: false,
  sportId: "baseball",
  brandId: "topps-2024",
  setId: "chrome-2024",
  year: 2024,
  features: new Set(["RC"]),
  printRun: 50,
  ...over,
});

const rule = (match: "all" | "any", ...terms: StoredRule["terms"]): StoredRule => ({ version: 1, match, terms });

describe("ruleMatches (NEO-362)", () => {
  it("all: every line must hold; any: one is enough", () => {
    const r = (m: "all" | "any") =>
      rule(m, { test: { kind: "player", playerIds: ["gooden"] } }, { test: { kind: "team", teamIds: ["yankees"] } });
    expect(ruleMatches(r("all"), facts())).toBe(false);
    expect(ruleMatches(r("any"), facts())).toBe(true);
  });

  it("not turns a line around", () => {
    const r = rule(
      "all",
      { test: { kind: "player", playerIds: ["gooden"] } },
      { negate: true, test: { kind: "feature", feature: "AU" } },
    );
    expect(ruleMatches(r, facts())).toBe(true);
    expect(ruleMatches(r, facts({ features: new Set(["AU"]) }))).toBe(false);
  });

  it("played for reads every team of the card's players, not just the jersey", () => {
    const r = rule("all", { test: { kind: "playedFor", teamIds: ["yankees"] } });
    expect(ruleMatches(r, facts())).toBe(true);
    expect(ruleMatches(rule("all", { test: { kind: "team", teamIds: ["yankees"] } }), facts())).toBe(false);
  });

  it("years and print runs are inclusive, and unnumbered never matches a print run", () => {
    expect(ruleMatches(rule("all", { test: { kind: "year", from: 2024, to: 2024 } }), facts())).toBe(true);
    expect(ruleMatches(rule("all", { test: { kind: "year", to: 2023 } }), facts())).toBe(false);
    expect(ruleMatches(rule("all", { test: { kind: "printRun", max: 50 } }), facts())).toBe(true);
    expect(ruleMatches(rule("all", { test: { kind: "printRun", max: 49 } }), facts())).toBe(false);
    expect(ruleMatches(rule("all", { test: { kind: "printRun", max: 99 } }), facts({ printRun: null }))).toBe(false);
  });

  it("an empty rule matches nothing", () => {
    expect(ruleMatches(rule("any"), facts())).toBe(false);
  });
});

describe("ruleProblem", () => {
  it("is null for a whole rule", () => {
    expect(ruleProblem(rule("all", { test: { kind: "hallOfFame" } }))).toBeNull();
  });

  it("says what is missing, in the collector's words", () => {
    expect(ruleProblem(rule("all"))).toMatch(/at least one line/);
    expect(ruleProblem(rule("all", { test: { kind: "player", playerIds: [] } }))).toMatch(/Pick a player/);
    expect(ruleProblem(rule("all", { test: { kind: "year" } }))).toMatch(/first year, a last year/);
    expect(ruleProblem(rule("all", { test: { kind: "year", from: 2000, to: 1990 } }))).toMatch(/Swap them/);
  });

  it("refuses a rule that only leaves things out", () => {
    expect(ruleProblem(rule("all", { negate: true, test: { kind: "hallOfFame" } }))).toMatch(/what to include/);
  });
});

describe("ruleIds and yearOfSeason", () => {
  it("collects the ids by table", () => {
    const r = rule(
      "any",
      { test: { kind: "player", playerIds: ["p1"] } },
      { test: { kind: "playedFor", teamIds: ["t1"] } },
      { test: { kind: "set", setIds: ["s1"] } },
      { test: { kind: "brand", brandIds: ["b1", "b2"] } },
    );
    expect(ruleIds(r)).toEqual({ players: ["p1"], teams: ["t1"], options: ["s1", "b1", "b2"] });
  });

  it("files a season under its first year", () => {
    expect(yearOfSeason("1996-97")).toBe(1996);
    expect(yearOfSeason("Unknown")).toBeNull();
  });
});

describe("ruleFit: cameos (NEO-528)", () => {
  // Strawberry's card, with Gooden pictured in the background.
  const cameo = (over: Partial<CardFacts> = {}) =>
    facts({
      playerIds: new Set(["strawberry"]),
      playedForIds: new Set(["mets"]),
      secondaryPlayerIds: new Set(["gooden"]),
      ...over,
    });
  const withCameos = (r: StoredRule): StoredRule => ({ ...r, secondaryPlayers: true });
  const gooden = rule("all", { test: { kind: "player", playerIds: ["gooden"] } });

  it("off (the default) is exactly the old rule: a cameo never fits", () => {
    expect(ruleFit(gooden, cameo())).toBeNull();
    expect(ruleMatches(gooden, cameo())).toBe(false);
  });

  it("on, a positive player line sees who else is pictured, and says so", () => {
    expect(ruleFit(withCameos(gooden), cameo())).toBe("secondary");
    expect(ruleMatches(withCameos(gooden), cameo())).toBe(true);
  });

  it("a card that fits on its own players is primary, whether or not the option is on", () => {
    expect(ruleFit(gooden, facts())).toBe("primary");
    expect(ruleFit(withCameos(gooden), facts({ secondaryPlayerIds: new Set(["strawberry"]) }))).toBe("primary");
  });

  it("an any-of rule that holds on the card's own facts is primary even when a cameo also matches", () => {
    const r = withCameos(rule("any", { test: { kind: "player", playerIds: ["gooden"] } }, { test: { kind: "team", teamIds: ["mets"] } }));
    expect(ruleFit(r, cameo())).toBe("primary");
  });

  it("Hall of Fame reads a pictured Hall of Famer only with the option on", () => {
    const hof = rule("all", { test: { kind: "hallOfFame" } });
    expect(ruleFit(hof, cameo({ secondaryHallOfFame: true }))).toBeNull();
    expect(ruleFit(withCameos(hof), cameo({ secondaryHallOfFame: true }))).toBe("secondary");
  });

  it("a negated player line reads the card's own players only: 'not Gooden' keeps a card he is only pictured on", () => {
    const r = withCameos(
      rule("all", { test: { kind: "team", teamIds: ["mets"] } }, { negate: true, test: { kind: "player", playerIds: ["gooden"] } }),
    );
    expect(ruleFit(r, cameo())).toBe("primary");
    expect(ruleFit(r, facts())).toBeNull();
  });

  it("a negated Hall of Fame line ignores a pictured Hall of Famer", () => {
    const r = withCameos(
      rule("all", { test: { kind: "team", teamIds: ["mets"] } }, { negate: true, test: { kind: "hallOfFame" } }),
    );
    expect(ruleFit(r, cameo({ secondaryHallOfFame: true }))).toBe("primary");
  });

  it("played for and team read the card's own players only, even with the option on", () => {
    // Gooden (pictured) played for the Yankees; Strawberry's facts say Mets only.
    const r = withCameos(rule("all", { test: { kind: "playedFor", teamIds: ["yankees"] } }));
    expect(ruleFit(r, cameo())).toBeNull();
    const team = withCameos(rule("all", { test: { kind: "team", teamIds: ["yankees"] } }));
    expect(ruleFit(team, cameo())).toBeNull();
  });

  it("every all-of line must still hold: a cameo fills the player line, not the others", () => {
    const r = withCameos(
      rule("all", { test: { kind: "player", playerIds: ["gooden"] } }, { test: { kind: "feature", feature: "AU" } }),
    );
    expect(ruleFit(r, cameo())).toBeNull();
    expect(ruleFit(r, cameo({ features: new Set(["AU"]) }))).toBe("secondary");
  });

  it("facts without the cameo fields read as no cameos", () => {
    const { secondaryPlayerIds: _ids, secondaryHallOfFame: _hof, ...bare } = cameo();
    expect(ruleFit(withCameos(gooden), bare)).toBeNull();
  });

  it("the option means something only with a positive player or Hall of Fame line", () => {
    expect(ruleCanUseSecondaryPlayers(gooden)).toBe(true);
    expect(ruleCanUseSecondaryPlayers(rule("all", { test: { kind: "hallOfFame" } }))).toBe(true);
    expect(ruleCanUseSecondaryPlayers(rule("all", { test: { kind: "set", setIds: ["s"] } }))).toBe(false);
    expect(
      ruleCanUseSecondaryPlayers(
        rule("all", { test: { kind: "set", setIds: ["s"] } }, { negate: true, test: { kind: "player", playerIds: ["p"] } }),
      ),
    ).toBe(false);
    // Stored on a rule that cannot use it, it changes nothing.
    const team = { ...rule("all", { test: { kind: "playedFor", teamIds: ["yankees"] } }), secondaryPlayers: true as const };
    expect(ruleFit(team, cameo())).toBeNull();
  });
});
