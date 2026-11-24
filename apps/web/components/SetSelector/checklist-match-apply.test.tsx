/**
 * NEO-490 — the operator's checklist links as pure functions: the question the
 * server is asked, and the answer folded back onto the cards.
 */

import { describe, expect, test } from "vitest";
import {
  applyChecklistAnswers,
  buildChecklistPairRequests,
  committable,
  distinctNumbers,
  numbersDifferInText,
  pairedRowCard,
  pickedNumber,
  pairedRowOf,
  revertServerChecklistPair,
  unlinkableServerPair,
  withoutChecklistNumber,
  type ChecklistLinkRow,
  type ChecklistPairAnswer,
  type ServerPairedRow,
  type ServerPairRevert,
} from "./checklist-match-apply";
import type { PairingCard } from "./CardPairingModal";
import type { ChecklistConflict, TeamLookupOutcome } from "./checklist-conflict";

type Card = {
  key: string;
  cardNumber: string;
  players?: string[];
  teams?: string[];
  teamLookup?: TeamLookupOutcome;
  checklistConflict?: ChecklistConflict;
  rawTeamName?: string;
  platformData?: { bsc?: { ref: string } };
};

const keyOf = (c: Card) => c.key;
const card = (key: string, extra: Partial<Card> = {}): Card => ({
  key,
  cardNumber: `N-${key}`,
  ...extra,
});

describe("buildChecklistPairRequests", () => {
  const rows: ChecklistLinkRow[] = [
    { number: "1", players: ["Frank Thomas"], teams: ["Chicago White Sox"] },
    { number: "2", players: ["Jacob Wilson"], teams: [] },
  ];

  test("asks about each linked card in card order, with the card's current values beside the row", () => {
    const cards = [
      card("a", { players: ["Jacob Wilson"], teams: ["Athletics"] }),
      card("b"),
      card("c", { players: ["Frank Thomas"] }),
    ];
    const links = new Map([
      ["c", 0],
      ["a", 1],
    ]);

    const out = buildChecklistPairRequests(cards, links, rows, keyOf);

    expect(out).toEqual([
      {
        cardKey: "a",
        card: { cardNumber: "N-a", players: ["Jacob Wilson"], teams: ["Athletics"] },
        row: { number: "2", players: ["Jacob Wilson"], teams: [] },
      },
      {
        cardKey: "c",
        card: { cardNumber: "N-c", players: ["Frank Thomas"], teams: [] },
        row: { number: "1", players: ["Frank Thomas"], teams: ["Chicago White Sox"] },
      },
    ]);
  });

  test("a link whose card is not being saved is left out", () => {
    const out = buildChecklistPairRequests(
      [card("a")],
      new Map([
        ["a", 0],
        ["discarded", 1],
      ]),
      rows,
      keyOf,
    );
    expect(out.map((r) => r.cardKey)).toEqual(["a"]);
  });

  test("a link to a row index that does not exist is left out", () => {
    expect(
      buildChecklistPairRequests([card("a")], new Map([["a", 9]]), rows, keyOf),
    ).toEqual([]);
  });

  test("no links, no questions", () => {
    expect(buildChecklistPairRequests([card("a")], new Map(), rows, keyOf)).toEqual([]);
  });

  test("blank names are trimmed away on both sides", () => {
    const [req] = buildChecklistPairRequests(
      [card("a", { players: [" Jacob Wilson ", "  "], teams: [""] })],
      new Map([["a", 0]]),
      [{ number: "1", players: ["  Frank Thomas", ""], teams: [" "] }],
      keyOf,
    );
    expect(req.card.players).toEqual(["Jacob Wilson"]);
    expect(req.card.teams).toEqual([]);
    expect(req.row.players).toEqual(["Frank Thomas"]);
    expect(req.row.teams).toEqual([]);
  });

  test("noNumber travels only when the row is flagged", () => {
    const flagged = buildChecklistPairRequests(
      [card("a")],
      new Map([["a", 0]]),
      [{ number: "NNO", players: ["X"], teams: [], noNumber: true }],
      keyOf,
    );
    const plain = buildChecklistPairRequests(
      [card("a")],
      new Map([["a", 0]]),
      [{ number: "1", players: ["X"], teams: [] }],
      keyOf,
    );
    expect(flagged[0].row.noNumber).toBe(true);
    expect(plain[0].row).not.toHaveProperty("noNumber");
  });

  test("the card's own number is sent, never the row's", () => {
    const [req] = buildChecklistPairRequests(
      [card("a", { cardNumber: "SIG-FT" })],
      new Map([["a", 0]]),
      rows,
      keyOf,
    );
    expect(req.card.cardNumber).toBe("SIG-FT");
    expect(req.row.number).toBe("1");
  });
});

describe("applyChecklistAnswers", () => {
  const sox = ["Chicago White Sox"];

  test("a settled team replaces the card's teams, marks the lookup, and drops BSC's raw hint", () => {
    const original = card("a", { teams: ["Cubs"], rawTeamName: "Chi Sox", teamLookup: "failed" });
    const [out] = applyChecklistAnswers(
      [original],
      [{ cardKey: "a", teams: sox, teamLookup: "checklist" }],
      keyOf,
    );
    expect(out.teams).toEqual(sox);
    expect(out.teamLookup).toBe("checklist");
    expect(out).not.toHaveProperty("rawTeamName");
  });

  test("players fill a card that has none, and never overwrite one that has some", () => {
    const [empty, has] = applyChecklistAnswers(
      [card("a"), card("b", { players: ["Existing Name"] })],
      [
        { cardKey: "a", fillPlayers: ["Frank Thomas"] },
        { cardKey: "b", fillPlayers: ["Frank Thomas"] },
      ],
      keyOf,
    );
    expect(empty.players).toEqual(["Frank Thomas"]);
    expect(has.players).toEqual(["Existing Name"]);
  });

  test("a disagreement rides on the card; the card's own teams stay even if the answer carries teams", () => {
    const conflict: ChecklistConflict = {
      teams: { marketplace: ["Cubs"], checklist: sox },
    };
    const [out] = applyChecklistAnswers(
      [card("a", { teams: ["Cubs"] })],
      [{ cardKey: "a", teams: sox, teamLookup: "checklist", checklistConflict: conflict }],
      keyOf,
    );
    expect(out.checklistConflict).toEqual(conflict);
    expect(out.teams).toEqual(["Cubs"]);
    expect(out.teamLookup).toBeUndefined();
  });

  test("a players-only disagreement still lets a settled team through", () => {
    const conflict: ChecklistConflict = {
      players: { marketplace: ["A"], checklist: ["B"] },
    };
    const [out] = applyChecklistAnswers(
      [card("a", { players: ["A"] })],
      [{ cardKey: "a", teams: sox, teamLookup: "checklist", checklistConflict: conflict }],
      keyOf,
    );
    expect(out.checklistConflict).toEqual(conflict);
    expect(out.teams).toEqual(sox);
    expect(out.players).toEqual(["A"]);
  });

  test("teams without the checklist lookup mark are not applied, nor are empty teams", () => {
    const [noMark, emptyTeams] = applyChecklistAnswers(
      [card("a", { teams: ["Cubs"] }), card("b", { teams: ["Cubs"] })],
      [
        { cardKey: "a", teams: sox },
        { cardKey: "b", teams: [" "], teamLookup: "checklist" },
      ],
      keyOf,
    );
    expect(noMark.teams).toEqual(["Cubs"]);
    expect(emptyTeams.teams).toEqual(["Cubs"]);
    expect(emptyTeams.teamLookup).toBeUndefined();
  });

  test("a row naming no team makes no claim: an answer with nothing in it changes nothing", () => {
    const original = card("a", { teams: ["Cubs"], players: ["A"] });
    const [out] = applyChecklistAnswers([original], [{ cardKey: "a" }], keyOf);
    expect(out).toEqual(original);
  });

  test("same order and length; an unanswered card is returned by reference", () => {
    const a = card("a");
    const b = card("b");
    const c = card("c");
    const out = applyChecklistAnswers(
      [a, b, c],
      [{ cardKey: "b", teams: sox, teamLookup: "checklist" }],
      keyOf,
    );
    expect(out.map((x) => x.key)).toEqual(["a", "b", "c"]);
    expect(out[0]).toBe(a);
    expect(out[2]).toBe(c);
    expect(out[1]).not.toBe(b);
  });

  test("no answers returns a copy of the same cards", () => {
    const cards = [card("a")];
    const out = applyChecklistAnswers(cards, [], keyOf);
    expect(out).toEqual(cards);
    expect(out).not.toBe(cards);
    expect(out[0]).toBe(cards[0]);
  });

  test("an answer for a card that is not here is ignored", () => {
    const cards = [card("a")];
    const out = applyChecklistAnswers(
      cards,
      [{ cardKey: "zzz", teams: sox, teamLookup: "checklist" }],
      keyOf,
    );
    expect(out).toEqual(cards);
  });

  test("the input cards are not mutated, and the number and platformData never change", () => {
    const original = card("a", {
      cardNumber: "SIG-FT",
      teams: ["Cubs"],
      rawTeamName: "Chi",
      platformData: { bsc: { ref: "bsc-1" } },
    });
    const snapshot = JSON.parse(JSON.stringify(original));
    const answer: ChecklistPairAnswer = {
      cardKey: "a",
      teams: sox,
      teamLookup: "checklist",
      fillPlayers: ["Frank Thomas"],
    };
    const [out] = applyChecklistAnswers([original], [answer], keyOf);
    expect(original).toEqual(snapshot);
    expect(out.cardNumber).toBe("SIG-FT");
    expect(out.platformData).toEqual({ bsc: { ref: "bsc-1" } });
  });

  test("the last answer for a key wins", () => {
    const [out] = applyChecklistAnswers(
      [card("a")],
      [
        { cardKey: "a", teams: ["First"], teamLookup: "checklist" },
        { cardKey: "a", teams: ["Second"], teamLookup: "checklist" },
      ],
      keyOf,
    );
    expect(out.teams).toEqual(["Second"]);
  });
});

// NEO-489 × NEO-490 — a "No Team" row the operator links in Match Cards is a
// claim: carried to the server, and its empty answer folds onto a teamless
// card as "the checklist says no team".
describe("checklist links: a No Team row (NEO-489)", () => {
  const noTeamRows: ChecklistLinkRow[] = [
    { number: "9", players: ["Show Card"], teams: [], noTeam: true },
    { number: "10", players: ["Plain Card"], teams: [] },
  ];

  test("the request carries the row's No Team claim, and only on that row", () => {
    const pairs = buildChecklistPairRequests(
      [card("a"), card("b")],
      new Map([
        ["a", 0],
        ["b", 1],
      ]),
      noTeamRows,
      keyOf,
    );
    expect(pairs.map((p) => p.row.noTeam)).toEqual([true, undefined]);
    expect(pairs[0].row.teams).toEqual([]);
  });

  test("an empty checklist answer marks a teamless card as checklist-answered with no team", () => {
    const [out] = applyChecklistAnswers(
      [card("a", { players: ["Show Card"], rawTeamName: "Boston Red Sox" })],
      [{ cardKey: "a", teams: [], teamLookup: "checklist" }],
      keyOf,
    );
    expect(out.teams).toEqual([]);
    expect(out.teamLookup).toBe("checklist");
    // BSC's raw text was a hint for a guess; the claim holds the guess back.
    expect(out.rawTeamName).toBeUndefined();
  });

  test("an empty checklist answer never wipes a card's own team", () => {
    const [out] = applyChecklistAnswers(
      [card("a", { teams: ["Boston Red Sox"] })],
      [{ cardKey: "a", teams: [], teamLookup: "checklist" }],
      keyOf,
    );
    expect(out.teams).toEqual(["Boston Red Sox"]);
    expect(out.teamLookup).toBeUndefined();
  });

  test("the No Team conflict rides on the card and its team stays", () => {
    const conflict = { teams: { marketplace: ["Boston Red Sox"], checklist: [] } };
    const [out] = applyChecklistAnswers(
      [card("a", { teams: ["Boston Red Sox"] })],
      [{ cardKey: "a", checklistConflict: conflict }],
      keyOf,
    );
    expect(out.checklistConflict).toEqual(conflict);
    expect(out.teams).toEqual(["Boston Red Sox"]);
  });
});

describe("NEO-496 — undoing the server's checklist pair", () => {
  const pairedRow: ServerPairedRow = {
    number: "FS-1",
    players: ["Jackson Holliday"],
    teams: ["Baltimore Orioles"],
    cardName: "Jackson Holliday",
  };
  /** A BSC card as the fetch hands it on after the row was applied. */
  const serverPaired = (
    revert: ServerPairRevert | undefined,
    extra: Partial<PairingCard> = {},
    row: ServerPairedRow | null = pairedRow,
  ): PairingCard => ({
    cardNumber: "FS-1",
    cardName: "Jackson Holliday",
    players: ["Jackson Holliday"],
    teams: ["Baltimore Orioles"],
    teamLookup: "checklist",
    platformData: { bsc: { ref: "bsc-FS-1", setId: "s" } },
    unmatched: "sl",
    checklistLink: {
      via: "number",
      ...(row ? { row } : {}),
      ...(revert ? { revert } : {}),
    },
    ...extra,
  });

  test("the row settled the team: the card's own players come back, it has no team, and its lookup reads failed", () => {
    const out = revertServerChecklistPair(
      serverPaired({ players: ["J. Holliday"], teamsFromRow: true, teamLookup: "failed" }),
    );
    expect(out).toEqual({
      cardNumber: "FS-1",
      cardName: "Jackson Holliday",
      players: ["J. Holliday"],
      teamLookup: "failed",
      platformData: { bsc: { ref: "bsc-FS-1", setId: "s" } },
      unmatched: "sl",
    });
    expect(out).not.toHaveProperty("teams");
    expect(out).not.toHaveProperty("checklistLink");
  });

  test("the row settled the team of a card that had its own: those teams come back and no lookup outcome is invented", () => {
    const out = revertServerChecklistPair(
      serverPaired({ players: ["Jackson Holliday"], teamsFromRow: true, teams: ["Orioles"] }),
    );
    expect(out?.teams).toEqual(["Orioles"]);
    expect(out).not.toHaveProperty("teamLookup");
  });

  test("the row did not settle the team: the card's teams and lookup are its own and stay", () => {
    const out = revertServerChecklistPair(
      serverPaired(
        { players: ["Jackson Holliday"], teamsFromRow: false },
        { teams: ["Baltimore Orioles"], teamLookup: "answered" },
      ),
    );
    expect(out?.teams).toEqual(["Baltimore Orioles"]);
    expect(out?.teamLookup).toBe("answered");
  });

  test("the row filled the players of a card that had none: it has none again", () => {
    const out = revertServerChecklistPair(serverPaired({ teamsFromRow: false }));
    expect(out).not.toHaveProperty("players");
  });

  test("the disagreement with the row goes with the row", () => {
    const out = revertServerChecklistPair(
      serverPaired(
        { players: ["Jackson Holliday"], teamsFromRow: false },
        {
          teams: ["Norfolk Tides"],
          teamLookup: "answered",
          checklistConflict: {
            teams: { marketplace: ["Norfolk Tides"], checklist: ["Baltimore Orioles"] },
          },
        },
      ),
    );
    expect(out).not.toHaveProperty("checklistConflict");
    expect(out?.teams).toEqual(["Norfolk Tides"]);
  });

  test("a pair stored before it carried its row and revert cannot be undone", () => {
    const noRevert = serverPaired(undefined);
    const noRow = serverPaired({ teamsFromRow: false }, {}, null);
    expect(unlinkableServerPair(noRevert)).toBe(false);
    expect(unlinkableServerPair(noRow)).toBe(false);
    expect(revertServerChecklistPair(noRevert)).toBeNull();
    expect(revertServerChecklistPair(noRow)).toBeNull();
    expect(unlinkableServerPair(serverPaired({ teamsFromRow: false }))).toBe(true);
  });

  test("the row is listed again as the row the dialog shows, flags included", () => {
    expect(
      pairedRowOf({ number: "NNO", players: [], teams: [], noNumber: true, noTeam: true, cardName: "Card #NNO" }),
    ).toEqual({ number: "NNO", players: [], teams: [], noNumber: true, noTeam: true });
    expect(pairedRowOf(pairedRow)).toEqual({
      number: "FS-1",
      players: ["Jackson Holliday"],
      teams: ["Baltimore Orioles"],
    });
  });

  test("the row as a card of its own is the checklist-only card the fetch publishes, and saves with no wire field", () => {
    const card = pairedRowCard(pairedRow, "unlinked:bsc-FS-1");
    expect(card).toEqual({
      cardNumber: "FS-1",
      cardName: "Jackson Holliday",
      players: ["Jackson Holliday"],
      teams: ["Baltimore Orioles"],
      teamLookup: "checklist",
      platformData: {},
      checklistRowId: "unlinked:bsc-FS-1",
    });
    expect(committable(card)).not.toHaveProperty("checklistRowId");
  });

  test("a Prospect (X) row is a prospect card whose X is one of its teams (NEO-591)", () => {
    const card = pairedRowCard({ ...pairedRow, teams: ["Dallas Baptist"], prospect: true }, "x");
    expect(card).toMatchObject({ teams: ["Dallas Baptist"], teamLookup: "checklist", isProspect: true });
    // The row the operator relinks keeps the claim.
    expect(pairedRowOf({ ...pairedRow, teams: ["Dallas Baptist"], prospect: true })).toMatchObject({
      teams: ["Dallas Baptist"],
      prospect: true,
    });
  });

  test("collector review: the printed claim rides on the relinkable row, for display", () => {
    expect(pairedRowOf({ ...pairedRow, teams: ["Oklahoma Sooners"], prospect: true, claim: "Prospect (Oklahoma)" }).claim).toBe(
      "Prospect (Oklahoma)",
    );
    expect(pairedRowOf(pairedRow)).not.toHaveProperty("claim");
  });

  test("NEO-591: an Unlink keeps a mixed Prospect row's printed cell for its row line, and the commit never sees it", () => {
    const card = pairedRowCard(
      {
        ...pairedRow,
        teams: ["Cincinnati Reds", "Frisco"],
        prospect: true,
        claim: "Cincinnati Reds / Prospect (Frisco)",
      },
      "x",
    );
    expect(card.teamCell).toBe("Cincinnati Reds / Prospect (Frisco)");
    expect(committable(card)).not.toHaveProperty("teamCell");
    expect(pairedRowCard({ ...pairedRow, teams: ["Dallas Baptist"], prospect: true }, "x")).not.toHaveProperty(
      "teamCell",
    );
  });

  test("a No Team row claims no team; a row naming no team claims nothing", () => {
    const noTeam = pairedRowCard({ ...pairedRow, teams: [], noTeam: true }, "x");
    expect(noTeam.teams).toEqual([]);
    expect(noTeam.teamLookup).toBe("checklist");
    const silent = pairedRowCard({ ...pairedRow, teams: [], players: [], cardName: "Card #FS-1" }, "x");
    expect(silent).not.toHaveProperty("teams");
    expect(silent).not.toHaveProperty("teamLookup");
    expect(silent).not.toHaveProperty("players");
    expect(silent.cardName).toBe("Card #FS-1");
  });
});

describe("NEO-591 — distinctNumbers", () => {
  test("spellings that differ only in case are one number, the first spelling kept", () => {
    expect(distinctNumbers({ bsc: "38A", sportlots: "38a", checklist: " 38 " })).toEqual(["38A", "38"]);
    expect(distinctNumbers({ bsc: "nno", checklist: "NNO" })).toEqual(["nno"]);
    expect(numbersDifferInText({ bsc: "38A", sportlots: "38a" })).toBe(false);
    expect(pickedNumber({ bsc: "38A", checklist: "38a" })).toBe("38A");
  });
});

describe("NEO-591 — names first, numbers confirm", () => {
  test("committable keeps sourceNumbers (the commit stores them), and still takes the dialog-only fields off", () => {
    const withNumbers = {
      cardNumber: "OV-ANFI",
      cardName: "A",
      platformData: {},
      sourceNumbers: { bsc: "OV-ANFI", checklist: "NNO" },
    } as PairingCard;
    // Nothing to take off: returned by reference, numbers and all.
    expect(committable(withNumbers)).toBe(withNumbers);
    const withLink = { ...withNumbers, checklistRowId: "row-1" } as PairingCard;
    const out = committable(withLink);
    expect(out).not.toHaveProperty("checklistRowId");
    expect(out.sourceNumbers).toEqual({ bsc: "OV-ANFI", checklist: "NNO" });
    expect(out.cardNumber).toBe("OV-ANFI");
    // The input is not mutated.
    expect(withLink.checklistRowId).toBe("row-1");
  });

  test("committable takes preKept off (the dialog's own business), and keeps the rest", () => {
    const made = {
      cardNumber: "38b",
      cardName: "Ted Williams",
      platformData: {},
      isVariation: true,
      preKept: true,
    } as PairingCard;
    const out = committable(made);
    expect(out).not.toHaveProperty("preKept");
    expect(out.isVariation).toBe(true);
    expect(made.preKept).toBe(true);
  });

  test("committable keeps numberMinted and variationGroup: the commit uses both", () => {
    const made = {
      cardNumber: "38b",
      cardName: "Ted Williams",
      platformData: {},
      preKept: true,
      numberMinted: true,
      variationGroup: "grp-38",
    } as PairingCard;
    const out = committable(made);
    expect(out.numberMinted).toBe(true);
    expect(out.variationGroup).toBe("grp-38");
    expect(out).not.toHaveProperty("preKept");
  });

  test("a row's variationName survives an Unlink and a relink", () => {
    const row: ServerPairedRow = {
      number: "38",
      players: ["Ted Williams"],
      teams: [],
      variationName: "Photo variation",
      cardName: "Ted Williams",
    };
    // Unlink lists the row again as the dialog's row ...
    const listed = pairedRowOf(row);
    expect(listed.variationName).toBe("Photo variation");
    // ... and a relink asks the server about it with the note intact.
    const [request] = buildChecklistPairRequests(
      [{ key: "a", cardNumber: "38b" }],
      new Map([["a", 0]]),
      [listed],
      (c) => c.key,
    );
    expect(request.row.variationName).toBe("Photo variation");
  });

  test("a no-player row's cardName (NEO-645) survives an Unlink and a relink", () => {
    const row: ServerPairedRow = {
      number: "3",
      players: [],
      teams: [],
      cardName: "Team Card",
    };
    // The unlinked row stands as the card it was, named for what it printed ...
    expect(pairedRowCard(row, "unlinked:1").cardName).toBe("Team Card");
    // ... and listed again as the dialog's row it keeps the name, so a relink asks about it.
    const listed = pairedRowOf(row);
    expect(listed.cardName).toBe("Team Card");
    const [request] = buildChecklistPairRequests(
      [{ key: "a", cardNumber: "3" }],
      new Map([["a", 0]]),
      [listed],
      (c) => c.key,
    );
    expect(request.row.cardName).toBe("Team Card");
  });

  test("a row that carries no name sends none (NB's placeholder is no name)", () => {
    const row: ServerPairedRow = { number: "3", players: [], teams: [], cardName: "Card #3" };
    expect(pairedRowOf(row).cardName).toBeUndefined();
  });

  test("withoutChecklistNumber keeps a picker while the numbers left differ in text", () => {
    // BCP-12 and 12 agree, but the operator may still want either.
    expect(withoutChecklistNumber({ bsc: "BCP-12", sportlots: "12", checklist: "x" })).toEqual({
      bsc: "BCP-12",
      sportlots: "12",
    });
  });

  describe("applyChecklistAnswers with the linked rows' numbers", () => {
    const bscCard = (key: string, cardNumber: string): Card => ({
      key,
      cardNumber,
      platformData: { bsc: { ref: `bsc-${key}` } },
    });
    const apply = (cards: Card[], rowNumber: string) =>
      applyChecklistAnswers(cards, [{ cardKey: cards[0].key }], keyOf, new Map([[cards[0].key, rowNumber]]));

    test("a row with letters outranks the card's digits; both numbers are kept", () => {
      const [out] = apply([bscCard("a", "38")], "38a");
      expect(out.cardNumber).toBe("38a");
      expect(out).toHaveProperty("sourceNumbers", { bsc: "38", checklist: "38a" });
    });

    test("a card with letters keeps them against a no-number row, and still says the numbers differ", () => {
      const [out] = apply([bscCard("a", "OV-ANFI")], "NNO");
      expect(out.cardNumber).toBe("OV-ANFI");
      expect(out).toHaveProperty("sourceNumbers", { bsc: "OV-ANFI", checklist: "NNO" });
    });

    test("numbers that agree change nothing and record nothing", () => {
      const [out] = apply([bscCard("a", "12")], "12");
      expect(out.cardNumber).toBe("12");
      expect(out).not.toHaveProperty("sourceNumbers");
    });

    test("numbers the server already recorded keep their marketplace entries", () => {
      const card: Card = { ...bscCard("a", "38"), sourceNumbers: { bsc: "38", sportlots: "39" } } as Card;
      const [out] = apply([card], "38a");
      expect(out).toHaveProperty("sourceNumbers", { bsc: "38", sportlots: "39", checklist: "38a" });
    });

    test("38 and 38a are still two numbers to choose between", () => {
      const [out] = apply([bscCard("a", "38")], "38a");
      expect(out).toHaveProperty("sourceNumbers", { bsc: "38", checklist: "38a" });
    });

    test("the operator's pick wins over the rule when it is one of the numbers", () => {
      const cards = [bscCard("a", "38")];
      const rows = new Map([["a", "38a"]]);
      const [picked] = applyChecklistAnswers(cards, [{ cardKey: "a" }], keyOf, rows, new Map([["a", "38"]]));
      expect(picked.cardNumber).toBe("38");
      // A pick that is neither printed number is ignored.
      const [stray] = applyChecklistAnswers(cards, [{ cardKey: "a" }], keyOf, rows, new Map([["a", "99"]]));
      expect(stray.cardNumber).toBe("38a");
    });

    test("a number swapped in from the row is flagged minted; one the card keeps is not", () => {
      const [swapped] = apply([bscCard("a", "38")], "38a");
      expect(swapped).toHaveProperty("numberMinted", true);
      const [kept] = apply([bscCard("a", "38a")], "38");
      expect(kept).not.toHaveProperty("numberMinted");
    });

    test("without rowNumbers the card's number is untouched, as before", () => {
      const cards = [bscCard("a", "38")];
      const [out] = applyChecklistAnswers(cards, [{ cardKey: "a" }], keyOf);
      expect(out.cardNumber).toBe("38");
    });
  });

  describe("revertServerChecklistPair puts the number back", () => {
    const paired = (
      revert: ServerPairRevert,
      extra: Partial<PairingCard> = {},
    ): PairingCard => ({
      cardNumber: "38a",
      cardName: "Ted Williams",
      platformData: { bsc: { ref: "bsc-38", setId: "s" } },
      unmatched: "sl",
      checklistLink: {
        via: "playerName",
        checklistNumber: "38a",
        row: { number: "38a", players: ["Ted Williams"], teams: [], cardName: "Ted Williams" },
        revert,
      },
      ...extra,
    });

    test("restores revert.cardNumber and drops the checklist's number", () => {
      const out = revertServerChecklistPair(
        paired(
          { teamsFromRow: false, cardNumber: "38" },
          { sourceNumbers: { bsc: "38", checklist: "38a" } },
        ),
      );
      expect(out?.cardNumber).toBe("38");
      expect(out).not.toHaveProperty("sourceNumbers");
    });

    test("a BSC + SportLots pair whose numbers still differ keeps its note", () => {
      const out = revertServerChecklistPair(
        paired(
          { teamsFromRow: false, cardNumber: "38" },
          { sourceNumbers: { bsc: "38", sportlots: "39", checklist: "38a" } },
        ),
      );
      expect(out?.sourceNumbers).toEqual({ bsc: "38", sportlots: "39" });
    });

    test("a row that did not change the number leaves it alone", () => {
      const out = revertServerChecklistPair(paired({ teamsFromRow: false }, { cardNumber: "12" }));
      expect(out?.cardNumber).toBe("12");
    });
  });

  test("withoutChecklistNumber is undefined once nothing differs", () => {
    expect(withoutChecklistNumber({ bsc: "1", checklist: "2" })).toBeUndefined();
    expect(withoutChecklistNumber({ bsc: "1", sportlots: "2", checklist: "3" })).toEqual({
      bsc: "1",
      sportlots: "2",
    });
    expect(withoutChecklistNumber(undefined)).toBeUndefined();
  });
});
