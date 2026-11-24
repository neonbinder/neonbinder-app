/**
 * NEO-312 — `linkCardsToSide`: which of the PARALLEL's fetched cards is each
 * of the INSERT's NB cards, on one marketplace side.
 *
 * Pure function, no database — plain unit tests over small fixtures, in the
 * style of `bscFacets.test.ts` / `marketplaceResolvability.test.ts`.
 */

import { describe, expect, test } from "vitest";
import {
  cardKey,
  linkCardsToSide,
  type FetchedParallelCard,
  type LinkableNbCard,
} from "./parallelCardLink";

/** An NB card, with sensible defaults so a test states only what it means. */
function nb(opts: Partial<LinkableNbCard> & { id: string }): LinkableNbCard {
  return {
    cardNumber: "1",
    cardName: "Some Player",
    namesOnCard: ["Some Player"],
    isTeamCard: false,
    isVariation: false,
    ...opts,
  };
}

/** A fetched parallel card, with sensible defaults. */
function fetched(opts: Partial<FetchedParallelCard> & { ref: string }): FetchedParallelCard {
  return {
    cardNumber: "1",
    cardName: "Some Player",
    players: ["Some Player"],
    ...opts,
  };
}

describe("linkCardsToSide — the number key", () => {
  test("an exact number + name match links", () => {
    const nbCards = [nb({ id: "n1", cardNumber: "10", cardName: "Ken Griffey" })];
    const parallelCards = [fetched({ ref: "p1", cardNumber: "10", cardName: "Ken Griffey" })];
    const result = linkCardsToSide(nbCards, parallelCards);
    expect(result.outcomes.get("n1")).toEqual({ kind: "linked", card: parallelCards[0], via: "key" });
    expect(result.linked).toBe(1);
    expect(result.ambiguous).toBe(0);
    expect(result.none).toBe(0);
  });

  test("a prefix on one side only still matches once stripped", () => {
    // The insert's chain carries `RC-`, the parallel's fetch does not.
    const nbCards = [nb({ id: "n1", cardNumber: "RC-10", cardName: "Ken Griffey" })];
    const parallelCards = [fetched({ ref: "p1", cardNumber: "10", cardName: "Ken Griffey" })];
    const result = linkCardsToSide(nbCards, parallelCards, { nb: "RC-" });
    expect(result.outcomes.get("n1")?.kind).toBe("linked");
  });

  test("prefixes stripped on both sides independently", () => {
    const nbCards = [nb({ id: "n1", cardNumber: "RC-10", cardName: "Ken Griffey" })];
    const parallelCards = [fetched({ ref: "p1", cardNumber: "GOLD-10", cardName: "Ken Griffey" })];
    const result = linkCardsToSide(nbCards, parallelCards, { nb: "RC-", fetched: "GOLD-" });
    expect(result.outcomes.get("n1")?.kind).toBe("linked");
  });

  test("a bare number and a prefixed one, neither prefix declared, pair when the player matches (Jason, 2026-11-24)", () => {
    // Was "never matches": a number that differs only in its prefix is the
    // same card of a parallel (NEO-616). Jason, 2026-11-24: "if just the prefix
    // varies then it is still a prallel and should keep its proper number".
    const nbCards = [nb({ id: "n1", cardNumber: "RC-10", cardName: "Ken Griffey" })];
    const parallelCards = [fetched({ ref: "p1", cardNumber: "10", cardName: "Ken Griffey" })];
    const result = linkCardsToSide(nbCards, parallelCards); // no prefixes given
    expect(result.outcomes.get("n1")).toEqual({ kind: "linked", card: parallelCards[0], via: "prefix" });
  });

  test("a bare number and a prefixed one never pair when the player differs", () => {
    const nbCards = [nb({ id: "n1", cardNumber: "RC-10", cardName: "Ken Griffey", namesOnCard: ["Ken Griffey"] })];
    const parallelCards = [
      fetched({ ref: "p1", cardNumber: "10", cardName: "Someone Else", players: ["Someone Else"] }),
    ];
    const result = linkCardsToSide(nbCards, parallelCards);
    expect(result.outcomes.get("n1")).toEqual({ kind: "none" });
  });

  test("a variation's stem matches the other side's bare number — variations only", () => {
    const nbCards = [
      nb({
        id: "n1",
        cardNumber: "11b",
        cardName: "Ken Griffey",
        isVariation: true,
        cardVariation: "Action",
      }),
    ];
    const parallelCards = [
      fetched({
        ref: "p1",
        cardNumber: "11",
        cardName: "Ken Griffey",
        isVariation: true,
        cardVariation: "Action",
      }),
    ];
    const result = linkCardsToSide(nbCards, parallelCards);
    expect(result.outcomes.get("n1")?.kind).toBe("linked");
  });

  test("stem matching never applies to a non-variation card", () => {
    // "11" on the NB side is NOT a variation; a fetched "11b" that is a
    // variation must not fall back to a stem match for it.
    const nbCards = [nb({ id: "n1", cardNumber: "11", cardName: "Ken Griffey" })];
    const parallelCards = [
      fetched({
        ref: "p1",
        cardNumber: "11b",
        cardName: "Ken Griffey",
        isVariation: true,
        cardVariation: "Action",
      }),
    ];
    const result = linkCardsToSide(nbCards, parallelCards);
    expect(result.outcomes.get("n1")).toEqual({ kind: "none" });
  });

  test("a later number tier never widens an earlier one that already found candidates", () => {
    // Two fetched rows share the exact number; a stripped/stem tier that would
    // otherwise find only one must not be consulted once the exact tier has
    // already produced (ambiguous) candidates.
    const nbCards = [nb({ id: "n1", cardNumber: "10", cardName: "Someone Else" })];
    const parallelCards = [
      fetched({ ref: "p1", cardNumber: "10", cardName: "Someone Else" }),
      fetched({ ref: "p2", cardNumber: "10", cardName: "Someone Else" }),
    ];
    const result = linkCardsToSide(nbCards, parallelCards);
    expect(result.outcomes.get("n1")).toEqual({ kind: "ambiguous" });
  });
});

describe("linkCardsToSide — who is on the card", () => {
  test("pendingPlayerNames count as names on the card", () => {
    const nbCards = [
      nb({ id: "n1", cardNumber: "5", cardName: "Rookie Card", namesOnCard: ["Some Rookie"] }),
    ];
    const parallelCards = [
      fetched({ ref: "p1", cardNumber: "5", cardName: "Some Rookie", players: ["Some Rookie"] }),
    ];
    const result = linkCardsToSide(nbCards, parallelCards);
    expect(result.outcomes.get("n1")?.kind).toBe("linked");
  });

  test("a card with no fetched players falls back to the fetched cardName", () => {
    const nbCards = [
      nb({ id: "n1", cardNumber: "5", cardName: "Ken Griffey", namesOnCard: ["Ken Griffey"] }),
    ];
    const parallelCards = [
      fetched({ ref: "p1", cardNumber: "5", cardName: "Ken Griffey", players: [] }),
    ];
    const result = linkCardsToSide(nbCards, parallelCards);
    expect(result.outcomes.get("n1")?.kind).toBe("linked");
  });

  test("a team card matches on number alone, ignoring name", () => {
    const nbCards = [
      nb({ id: "n1", cardNumber: "7", cardName: "Yankees Team Card", namesOnCard: [], isTeamCard: true }),
    ];
    const parallelCards = [
      fetched({ ref: "p1", cardNumber: "7", cardName: "New York Yankees", players: [] }),
    ];
    const result = linkCardsToSide(nbCards, parallelCards);
    expect(result.outcomes.get("n1")?.kind).toBe("linked");
  });

  test("mismatched names on an otherwise-matching number leave the card unlinked", () => {
    const nbCards = [nb({ id: "n1", cardNumber: "5", namesOnCard: ["Ken Griffey"] })];
    const parallelCards = [
      fetched({ ref: "p1", cardNumber: "5", cardName: "Someone Else", players: ["Someone Else"] }),
    ];
    const result = linkCardsToSide(nbCards, parallelCards);
    expect(result.outcomes.get("n1")).toEqual({ kind: "none" });
    expect(result.none).toBe(1);
  });
});

describe("linkCardsToSide — several variations of one card, by variation name", () => {
  test("the variation's own name narrows several same-number candidates to one", () => {
    const nbCards = [
      nb({
        id: "n1",
        cardNumber: "11",
        cardName: "Ken Griffey",
        isVariation: true,
        cardVariation: "Team Color",
      }),
    ];
    const parallelCards = [
      fetched({
        ref: "p-action",
        cardNumber: "11",
        cardName: "Ken Griffey",
        isVariation: true,
        cardVariation: "Action",
      }),
      fetched({
        ref: "p-color",
        cardNumber: "11",
        cardName: "Ken Griffey",
        isVariation: true,
        cardVariation: "Team Color",
      }),
    ];
    const result = linkCardsToSide(nbCards, parallelCards);
    expect(result.outcomes.get("n1")).toEqual({
      kind: "linked",
      card: parallelCards[1],
      via: "key",
    });
  });

  test("when the variation name still leaves more than one, the card is ambiguous", () => {
    const nbCards = [
      nb({
        id: "n1",
        cardNumber: "11",
        cardName: "Ken Griffey",
        isVariation: true,
        cardVariation: "Action",
      }),
    ];
    const parallelCards = [
      fetched({ ref: "p1", cardNumber: "11", cardName: "Ken Griffey", isVariation: true, cardVariation: "Action" }),
      fetched({ ref: "p2", cardNumber: "11", cardName: "Ken Griffey", isVariation: true, cardVariation: "Action" }),
    ];
    const result = linkCardsToSide(nbCards, parallelCards);
    expect(result.outcomes.get("n1")).toEqual({ kind: "ambiguous" });
  });
});

describe("linkCardsToSide — the spelling fallback (number + shared surname)", () => {
  test("a differently-spelled name still links by number when a surname agrees", () => {
    const nbCards = [
      nb({ id: "n1", cardNumber: "5", cardName: "Jose Ramirez Jr.", namesOnCard: ["Jose Ramirez Jr."] }),
    ];
    const parallelCards = [
      fetched({ ref: "p1", cardNumber: "5", cardName: "José Ramírez", players: ["José Ramírez"] }),
    ];
    const result = linkCardsToSide(nbCards, parallelCards);
    expect(result.outcomes.get("n1")).toEqual({ kind: "linked", card: parallelCards[0], via: "number" });
  });

  test("a different player on the same number is never linked by the spelling fallback", () => {
    const nbCards = [
      nb({ id: "n1", cardNumber: "5", cardName: "Ken Griffey", namesOnCard: ["Ken Griffey"] }),
    ];
    const parallelCards = [
      fetched({ ref: "p1", cardNumber: "5", cardName: "Someone Else", players: ["Someone Else"] }),
    ];
    const result = linkCardsToSide(nbCards, parallelCards);
    expect(result.outcomes.get("n1")).toEqual({ kind: "none" });
  });

  test("the fallback never fires when the full key already found a candidate elsewhere", () => {
    // n1's full key is ambiguous (ties with n2); the number fallback must not
    // rescue it even though a surname would otherwise agree.
    const nbCards = [
      nb({ id: "n1", cardNumber: "5", cardName: "Ken Griffey", namesOnCard: ["Ken Griffey"] }),
      nb({ id: "n2", cardNumber: "5", cardName: "Ken Griffey Jr.", namesOnCard: ["Ken Griffey Jr."] }),
    ];
    const parallelCards = [
      fetched({ ref: "p1", cardNumber: "5", cardName: "Ken Griffey", players: ["Ken Griffey"] }),
    ];
    const result = linkCardsToSide(nbCards, parallelCards);
    // n1 matches exactly by key (Ken Griffey == Ken Griffey) — fine, it links.
    // n2 has no full-key candidate, but the ref is already claimed via n1's
    // full key, so the fallback must not also propose it for n2.
    expect(result.outcomes.get("n1")?.kind).toBe("linked");
    expect(result.outcomes.get("n2")).toEqual({ kind: "none" });
  });
});

describe("linkCardsToSide — the earlier-link tiebreak", () => {
  test("an ambiguous card resolves to the ref its earlier link already held", () => {
    const nbCards = [
      nb({ id: "n1", cardNumber: "10", namesOnCard: [], cardName: "Team Card", isTeamCard: true }),
    ];
    const parallelCards = [
      fetched({ ref: "p1", cardNumber: "10", cardName: "A" }),
      fetched({ ref: "p2", cardNumber: "10", cardName: "B" }),
    ];
    const earlierRefsByKey = new Map([
      [
        "10\u0000#team\u00000",
        new Set(["p2"]),
      ],
    ]);
    const result = linkCardsToSide(nbCards, parallelCards, {}, { earlierRefsByKey });
    expect(result.outcomes.get("n1")).toEqual({ kind: "linked", card: parallelCards[1], via: "earlierLink" });
  });

  test("two cards whose earlier links both point at the same ref both stay ambiguous", () => {
    const nbCards = [
      nb({ id: "n1", cardNumber: "10", namesOnCard: [], cardName: "Team Card", isTeamCard: true }),
      nb({ id: "n2", cardNumber: "10", namesOnCard: [], cardName: "Team Card 2", isTeamCard: true }),
    ];
    const parallelCards = [
      fetched({ ref: "p1", cardNumber: "10", cardName: "A" }),
      fetched({ ref: "p2", cardNumber: "10", cardName: "B" }),
    ];
    // Both n1 and n2 key the same (identical isTeamCard cardKey), so both
    // propose the same earlier ref p2 — the proposal is refused for both.
    const earlierRefsByKey = new Map([["10\u0000#team\u00000", new Set(["p2"])]]);
    const result = linkCardsToSide(nbCards, parallelCards, {}, { earlierRefsByKey });
    expect(result.outcomes.get("n1")).toEqual({ kind: "ambiguous" });
    expect(result.outcomes.get("n2")).toEqual({ kind: "ambiguous" });
  });
});

describe("linkCardsToSide — unclaimed", () => {
  test("a fetched card no NB card ever proposed for is unclaimed", () => {
    const nbCards = [nb({ id: "n1", cardNumber: "1", cardName: "A", namesOnCard: ["A"] })];
    const parallelCards = [
      fetched({ ref: "p1", cardNumber: "1", cardName: "A", players: ["A"] }),
      fetched({ ref: "p2", cardNumber: "2", cardName: "B", players: ["B"] }),
    ];
    const result = linkCardsToSide(nbCards, parallelCards);
    expect(result.unclaimed).toEqual([parallelCards[1]]);
  });

  test("a fetched card that was a candidate but lost the guard is not unclaimed", () => {
    const nbCards = [nb({ id: "n1", cardNumber: "10", namesOnCard: [], cardName: "Team Card", isTeamCard: true })];
    const parallelCards = [
      fetched({ ref: "p1", cardNumber: "10", cardName: "A" }),
      fetched({ ref: "p2", cardNumber: "10", cardName: "B" }),
    ];
    const result = linkCardsToSide(nbCards, parallelCards);
    expect(result.outcomes.get("n1")).toEqual({ kind: "ambiguous" });
    expect(result.unclaimed).toEqual([]);
  });
});

describe("linkCardsToSide — the guard (invariant 7)", () => {
  test("two candidates for one card leaves it ambiguous, not a guess", () => {
    const nbCards = [nb({ id: "n1", cardNumber: "10", namesOnCard: [], cardName: "Team Card", isTeamCard: true })];
    const parallelCards = [
      fetched({ ref: "p1", cardNumber: "10", cardName: "A" }),
      fetched({ ref: "p2", cardNumber: "10", cardName: "B" }),
    ];
    const result = linkCardsToSide(nbCards, parallelCards);
    expect(result.outcomes.get("n1")).toEqual({ kind: "ambiguous" });
    expect(result.ambiguous).toBe(1);
  });

  test("one fetched card two NB cards both want is claimed by neither", () => {
    const nbCards = [
      nb({ id: "n1", cardNumber: "10", namesOnCard: [], cardName: "Team Card", isTeamCard: true }),
      nb({ id: "n2", cardNumber: "10", namesOnCard: [], cardName: "Team Card 2", isTeamCard: true }),
    ];
    const parallelCards = [fetched({ ref: "p1", cardNumber: "10", cardName: "Whatever" })];
    const result = linkCardsToSide(nbCards, parallelCards);
    expect(result.outcomes.get("n1")).toEqual({ kind: "ambiguous" });
    expect(result.outcomes.get("n2")).toEqual({ kind: "ambiguous" });
    expect(result.ambiguous).toBe(2);
    expect(result.linked).toBe(0);
  });

  test("no candidate at all counts the card as none, not ambiguous", () => {
    const nbCards = [nb({ id: "n1", cardNumber: "99", namesOnCard: ["Nobody Fetched"] })];
    const parallelCards = [fetched({ ref: "p1", cardNumber: "10", cardName: "Someone" })];
    const result = linkCardsToSide(nbCards, parallelCards);
    expect(result.outcomes.get("n1")).toEqual({ kind: "none" });
    expect(result.none).toBe(1);
    expect(result.ambiguous).toBe(0);
  });

  test("results carry one entry per NB card, in input order, for a mixed batch", () => {
    const nbCards = [
      nb({ id: "linked", cardNumber: "1", cardName: "A", namesOnCard: ["A"] }),
      nb({ id: "none", cardNumber: "2", cardName: "B", namesOnCard: ["B"] }),
    ];
    const parallelCards = [fetched({ ref: "p1", cardNumber: "1", cardName: "A", players: ["A"] })];
    const result = linkCardsToSide(nbCards, parallelCards);
    expect([...result.outcomes.keys()]).toEqual(["linked", "none"]);
    expect(result.linked).toBe(1);
    expect(result.none).toBe(1);
  });
});

describe("linkCardsToSide — numbers read as printed (NEO-489)", () => {
  const who = (name: string) => ({ cardName: name, namesOnCard: [name] });
  const theirs = (name: string) => ({ cardName: name, players: [name] });

  test("1a and 1A on both sides each link to their own exact card", () => {
    const nbCards = [
      nb({ id: "lo", cardNumber: "1a", ...who("Low Player") }),
      nb({ id: "up", cardNumber: "1A", ...who("Up Player") }),
    ];
    const parallelCards = [
      fetched({ ref: "pLo", cardNumber: "1a", ...theirs("Low Player") }),
      fetched({ ref: "pUp", cardNumber: "1A", ...theirs("Up Player") }),
    ];
    const r = linkCardsToSide(nbCards, parallelCards);
    expect(r.outcomes.get("lo")).toMatchObject({ kind: "linked", card: parallelCards[0] });
    expect(r.outcomes.get("up")).toMatchObject({ kind: "linked", card: parallelCards[1] });
  });

  test("with a case-only twin on the NB side, 1A links to 1A and 1a is left unlinked, not folded onto 1A", () => {
    const nbCards = [nb({ id: "up", cardNumber: "1A" }), nb({ id: "lo", cardNumber: "1a" })];
    const parallelCards = [fetched({ ref: "pUp", cardNumber: "1A" })];
    const r = linkCardsToSide(nbCards, parallelCards);
    expect(r.outcomes.get("up")).toMatchObject({ kind: "linked", card: parallelCards[0] });
    expect(r.outcomes.get("lo")).toEqual({ kind: "none" });
  });

  test("with a case-only twin on the fetched side, a differently-cased NB number does not fold onto either", () => {
    const nbCards = [nb({ id: "n", cardNumber: "x1a" })];
    const parallelCards = [
      fetched({ ref: "p1", cardNumber: "X1A" }),
      fetched({ ref: "p2", cardNumber: "X1a" }),
    ];
    const r = linkCardsToSide(nbCards, parallelCards);
    expect(r.outcomes.get("n")).toEqual({ kind: "none" });
  });

  test("a twin also blocks the variation stem tier for that number", () => {
    const nbCards = [
      nb({ id: "a", cardNumber: "11B", isVariation: true }),
      nb({ id: "b", cardNumber: "11b", isVariation: true }),
    ];
    const parallelCards = [fetched({ ref: "p", cardNumber: "11" })];
    const r = linkCardsToSide(nbCards, parallelCards);
    expect(r.outcomes.get("a")).toEqual({ kind: "none" });
    expect(r.outcomes.get("b")).toEqual({ kind: "none" });
  });

  test("with no twin, a case-only difference still links through the folded tier", () => {
    const nbCards = [nb({ id: "n", cardNumber: "ppr-dla" })];
    const parallelCards = [fetched({ ref: "p", cardNumber: "PPR-DLA" })];
    const r = linkCardsToSide(nbCards, parallelCards);
    expect(r.outcomes.get("n")).toMatchObject({ kind: "linked", card: parallelCards[0] });
  });

  test("a prefix strip keeps case: RC-10a links to 10a before any folding", () => {
    const nbCards = [nb({ id: "n", cardNumber: "RC-10a" })];
    const parallelCards = [fetched({ ref: "p", cardNumber: "10a" })];
    const r = linkCardsToSide(nbCards, parallelCards, { nb: "RC-" });
    expect(r.outcomes.get("n")).toMatchObject({ kind: "linked", card: parallelCards[0] });
  });

  test("cardKey keeps number case: 1a and 1A are different keys, spacing is still trimmed", () => {
    const base = { cardName: "P", namesOnCard: ["P"], isTeamCard: false, isVariation: false };
    expect(cardKey({ ...base, cardNumber: "1a" })).not.toBe(cardKey({ ...base, cardNumber: "1A" }));
    expect(cardKey({ ...base, cardNumber: " 1a " })).toBe(cardKey({ ...base, cardNumber: "1a" }));
  });
});

describe("linkCardsToSide — a number that differs only in its prefix (NEO-616)", () => {
  // Jason, 2026-11-24: "this should have nothing to do with mini, sometimes
  // parallels just have a different prefix. ... If the remainder of the number
  // & player don't match the base then it is a seperate insert not a parallel,
  // but if just the prefix varies then it is still a prallel and should keep
  // its proper number not reuse the base".
  const who = (name: string) => ({ cardName: name, namesOnCard: [name] });
  const theirs = (name: string) => ({ cardName: name, players: [name] });

  test("89B-1 pairs with 89M-1, and carries via prefix", () => {
    const nbCards = [nb({ id: "n1", cardNumber: "89B-1", ...who("Joe Montana") })];
    const parallelCards = [fetched({ ref: "p1", cardNumber: "89M-1", ...theirs("Joe Montana") })];
    const r = linkCardsToSide(nbCards, parallelCards);
    expect(r.outcomes.get("n1")).toEqual({ kind: "linked", card: parallelCards[0], via: "prefix" });
    expect(r.linked).toBe(1);
    expect(r.unclaimed).toEqual([]);
  });

  test("12 pairs with T88-12", () => {
    const nbCards = [nb({ id: "n1", cardNumber: "12", ...who("Joe Montana") })];
    const parallelCards = [fetched({ ref: "p1", cardNumber: "T88-12", ...theirs("Joe Montana") })];
    const r = linkCardsToSide(nbCards, parallelCards);
    expect(r.outcomes.get("n1")).toEqual({ kind: "linked", card: parallelCards[0], via: "prefix" });
  });

  test("the same prefix difference with a different player is a separate card: none", () => {
    const nbCards = [nb({ id: "n1", cardNumber: "89B-1", ...who("Joe Montana") })];
    const parallelCards = [fetched({ ref: "p1", cardNumber: "89M-1", ...theirs("Jerry Rice") })];
    const r = linkCardsToSide(nbCards, parallelCards);
    expect(r.outcomes.get("n1")).toEqual({ kind: "none" });
  });

  test("a multi-player card needs every name to agree", () => {
    const nbCards = [
      nb({
        id: "n1",
        cardNumber: "89B-1",
        cardName: "Joe Montana / Jerry Rice",
        namesOnCard: ["Joe Montana", "Jerry Rice"],
      }),
    ];
    const both = [
      fetched({
        ref: "both",
        cardNumber: "89M-1",
        cardName: "Joe Montana / Jerry Rice",
        players: ["Jerry Rice", "Joe Montana"],
      }),
    ];
    expect(linkCardsToSide(nbCards, both).outcomes.get("n1")).toMatchObject({
      kind: "linked",
      via: "prefix",
    });
    const one = [
      fetched({ ref: "one", cardNumber: "89M-1", cardName: "Joe Montana", players: ["Joe Montana"] }),
    ];
    expect(linkCardsToSide(nbCards, one).outcomes.get("n1")).toEqual({ kind: "none" });
  });

  test("a different remainder (89M-2 against 89B-1) never pairs", () => {
    const nbCards = [nb({ id: "n1", cardNumber: "89B-1", ...who("Joe Montana") })];
    const parallelCards = [fetched({ ref: "p1", cardNumber: "89M-2", ...theirs("Joe Montana") })];
    const r = linkCardsToSide(nbCards, parallelCards);
    expect(r.outcomes.get("n1")).toEqual({ kind: "none" });
    expect(r.unclaimed).toEqual(parallelCards);
  });

  test("two fetched candidates for one card is a tie: none, never the first", () => {
    const nbCards = [nb({ id: "n1", cardNumber: "89B-1", ...who("Joe Montana") })];
    const parallelCards = [
      fetched({ ref: "p1", cardNumber: "89M-1", ...theirs("Joe Montana") }),
      fetched({ ref: "p2", cardNumber: "89X-1", ...theirs("Joe Montana") }),
    ];
    const r = linkCardsToSide(nbCards, parallelCards);
    expect(r.outcomes.get("n1")).toEqual({ kind: "none" });
  });

  test("two NB cards that want one fetched card is a tie: neither links", () => {
    const nbCards = [
      nb({ id: "n1", cardNumber: "89B-1", ...who("Joe Montana") }),
      nb({ id: "n2", cardNumber: "89C-1", ...who("Joe Montana") }),
    ];
    const parallelCards = [fetched({ ref: "p1", cardNumber: "89M-1", ...theirs("Joe Montana") })];
    const r = linkCardsToSide(nbCards, parallelCards);
    expect(r.outcomes.get("n1")).toEqual({ kind: "none" });
    expect(r.outcomes.get("n2")).toEqual({ kind: "none" });
  });

  test("a fetched card another card's full key already wants is not reused", () => {
    // n1 links to 89M-1 by its exact number; n2 (89B-1, same player) would
    // pair to the same card by prefix, but it is taken.
    const nbCards = [
      nb({ id: "n1", cardNumber: "89M-1", ...who("Joe Montana") }),
      nb({ id: "n2", cardNumber: "89B-1", ...who("Joe Montana") }),
    ];
    const parallelCards = [fetched({ ref: "p1", cardNumber: "89M-1", ...theirs("Joe Montana") })];
    const r = linkCardsToSide(nbCards, parallelCards);
    expect(r.outcomes.get("n1")).toEqual({ kind: "linked", card: parallelCards[0], via: "key" });
    expect(r.outcomes.get("n2")).toEqual({ kind: "none" });
  });

  test("a case-only twin is never paired onto its claimed twin", () => {
    // x-1A links to X-1A (case-folded tier is blocked by the twin, so exact);
    // y-1a differs from it by prefix AND case of the remainder: not the same
    // number, so it stays unlinked.
    const nbCards = [
      nb({ id: "up", cardNumber: "x-1A", ...who("Joe Montana") }),
      nb({ id: "lo", cardNumber: "y-1a", ...who("Joe Montana") }),
    ];
    const parallelCards = [fetched({ ref: "p1", cardNumber: "x-1A", ...theirs("Joe Montana") })];
    const r = linkCardsToSide(nbCards, parallelCards);
    expect(r.outcomes.get("up")).toMatchObject({ kind: "linked", via: "key" });
    expect(r.outcomes.get("lo")).toEqual({ kind: "none" });
  });

  test("1a and 1A under a new prefix each pair with their own spelling only", () => {
    const nbCards = [
      nb({ id: "lo", cardNumber: "89B-1a", ...who("Joe Montana") }),
      nb({ id: "up", cardNumber: "89B-1A", ...who("Joe Montana") }),
    ];
    const parallelCards = [fetched({ ref: "pUp", cardNumber: "89M-1A", ...theirs("Joe Montana") })];
    const r = linkCardsToSide(nbCards, parallelCards);
    expect(r.outcomes.get("up")).toMatchObject({ kind: "linked", card: parallelCards[0], via: "prefix" });
    expect(r.outcomes.get("lo")).toEqual({ kind: "none" });
  });

  test("the prefix tier never cancels a link the number tier makes", () => {
    // A (T88-12, name spelled loosely) links to the fetched T88-12 by its
    // number. B (12, same player) would prefix-propose the same card: it sits
    // out, and A keeps the link it has without B.
    const nbCards = [
      nb({ id: "a", cardNumber: "T88-12", cardName: "Jon Smith", namesOnCard: ["Jon Smith"] }),
      nb({ id: "b", cardNumber: "12", ...who("John Smith") }),
    ];
    const parallelCards = [fetched({ ref: "p1", cardNumber: "T88-12", ...theirs("John Smith") })];
    const r = linkCardsToSide(nbCards, parallelCards);
    expect(r.outcomes.get("a")).toMatchObject({ kind: "linked", card: parallelCards[0], via: "number" });
    expect(r.outcomes.get("b")).toEqual({ kind: "none" });
    const alone = linkCardsToSide([nbCards[0]], parallelCards);
    expect(alone.outcomes.get("a")).toMatchObject({ kind: "linked", via: "number" });
  });

  test("an ambiguous card that is as good a prefix candidate blocks the pair: a tie", () => {
    // y (12a) is ambiguous: two fetched 12A cards fit it by its case-folded
    // number. It is also a prefix candidate of T88-12a, as x (89B-12a) is, so
    // x is not that card's only taker: the pair is a tie and stays unmatched.
    const nbCards = [
      nb({ id: "x", cardNumber: "89B-12a", ...who("John Smith") }),
      nb({ id: "y", cardNumber: "12a", ...who("John Smith") }),
    ];
    const parallelCards = [
      fetched({ ref: "p1", cardNumber: "T88-12a", ...theirs("John Smith") }),
      fetched({ ref: "p2", cardNumber: "12A", ...theirs("John Smith") }),
      fetched({ ref: "p3", cardNumber: "12A", ...theirs("John Smith") }),
    ];
    const r = linkCardsToSide(nbCards, parallelCards);
    expect(r.outcomes.get("y")).toEqual({ kind: "ambiguous" });
    expect(r.outcomes.get("x")).toEqual({ kind: "none" });
    // Without y in the way, x is the only taker and pairs by prefix.
    const alone = linkCardsToSide([nbCards[0]], parallelCards);
    expect(alone.outcomes.get("x")).toMatchObject({ kind: "linked", card: parallelCards[0], via: "prefix" });
  });

  test("a variation only pairs with a variation", () => {
    const nbCards = [
      nb({ id: "n1", cardNumber: "89B-1", ...who("Joe Montana"), isVariation: true, cardVariation: "Action" }),
    ];
    const parallelCards = [fetched({ ref: "p1", cardNumber: "89M-1", ...theirs("Joe Montana") })];
    expect(linkCardsToSide(nbCards, parallelCards).outcomes.get("n1")).toEqual({ kind: "none" });
  });
});
