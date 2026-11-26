/**
 * NEO-591 — ONE name picker for every name difference, whatever the sources
 * are: a marketplace against the operator's checklist (hand-linked or the
 * server's pairing), the two marketplaces against each other, or all three.
 * One pill per distinct name; the checklist's carries "· your checklist".
 *
 * Pinned here: the Dax/Max hand link, a pick that saves as the card's name, a
 * server near-name pair, BSC/SL unchanged, a three-source row, de-dupe, a pick
 * dropped on Unlink, and a pick that answers the wizard's "Checklist
 * disagreements" question (the card leaves Match Cards with no players
 * disagreement left to ask about).
 */

import { describe, expect, test, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import CardPairingModal, { type PairingCard } from "./CardPairingModal";
import type { ChecklistPairAnswer, ChecklistPairRequest } from "./checklist-match-apply";

const DAX = "Dax Kilby";
const MAX = "Max Kilby";
const MAX_PILL = `${MAX} · your checklist`;

const bscCard = (n: string, name: string, extra: Partial<PairingCard> = {}): PairingCard => ({
  cardNumber: n,
  cardName: name,
  players: [name],
  platformData: { bsc: { ref: `bsc-${n}`, setId: "set-1" } },
  unmatched: "sl",
  ...extra,
});

const rowCard = (n: string, name: string, i: number): PairingCard => ({
  cardNumber: n,
  cardName: name,
  players: [name],
  platformData: {},
  checklistRowId: `row-${i}`,
});

const players = (marketplace: string[], checklist: string[]) => ({
  players: { marketplace, checklist },
});

function mount(initial: {
  autoMatched?: Array<{ card: PairingCard; confidence: number }>;
  unmatchedBsc?: PairingCard[];
  unmatchedSl?: PairingCard[];
  checklistOnly?: PairingCard[];
  resolve?: (pairs: ChecklistPairRequest[]) => Promise<ChecklistPairAnswer[]>;
}) {
  const onConfirm = vi.fn().mockResolvedValue(undefined);
  render(
    <CardPairingModal
      isOpen
      onClose={vi.fn()}
      onConfirm={onConfirm}
      sources={["bsc", "sportlots", "checklist"]}
      resolveChecklistPairs={initial.resolve}
      initialData={{
        autoMatched: initial.autoMatched ?? [],
        unmatchedBsc: initial.unmatchedBsc ?? [],
        unmatchedSl: initial.unmatchedSl ?? [],
        checklistOnly: initial.checklistOnly ?? [],
      }}
    />,
  );
  return { onConfirm };
}

const expandMatched = () => {
  const toggle = screen.queryByLabelText(/^Expand matched cards/);
  if (toggle) fireEvent.click(toggle);
};
const confirm = () =>
  act(async () => {
    fireEvent.click(screen.getByLabelText("Confirm card matches"));
  });
const confirmed = (onConfirm: ReturnType<typeof vi.fn>): PairingCard[] =>
  onConfirm.mock.calls[0][0].cards;
const pill = (name: string, scope = "#OV-MAKI") =>
  screen.getByRole("radio", { name: `${name} — use this name for ${scope}` });
const namePills = () =>
  screen
    .queryAllByRole("radio")
    .filter((r) => /— use this name for /.test(r.getAttribute("aria-label") ?? ""));
const pillNames = () => namePills().map((r) => r.getAttribute("aria-label")!.split(" — ")[0]);
const checkedName = () =>
  namePills()
    .filter((r) => r.getAttribute("aria-checked") === "true")
    .map((r) => r.getAttribute("aria-label")!.split(" — ")[0]);

/** The server's answer for a link: the row and the card name different players. */
const disagree = vi.fn(async (pairs: ChecklistPairRequest[]) =>
  pairs.map((p) => ({
    cardKey: p.cardKey,
    checklistConflict: players(p.card.players, p.row.players),
  })),
);

const daxWorld = () => ({
  unmatchedBsc: [bscCard("OV-MAKI", DAX)],
  checklistOnly: [rowCard("NNO", MAX, 0)],
  resolve: disagree,
});

const linkDax = () => {
  fireEvent.click(screen.getByLabelText(/^Select .*Max Kilby/));
  fireEvent.click(screen.getByLabelText(`Link selected checklist row to #OV-MAKI ${DAX}`));
  expandMatched();
};

describe("a hand link between a marketplace card and a checklist row that names someone else", () => {
  test("shows one pill per name, the card's own preselected, the checklist's marked as theirs", () => {
    mount(daxWorld());
    linkDax();
    expect(pillNames()).toEqual([DAX, MAX_PILL]);
    expect(checkedName()).toEqual([DAX]);
    expect(screen.getByRole("group", { name: "Name conflict on #OV-MAKI" })).toBeTruthy();
    expect(screen.getByRole("radiogroup", { name: "Name for #OV-MAKI" })).toBeTruthy();
    expect(
      screen.getByText("Potential names for this card — pick the right one before it is listed."),
    ).toBeTruthy();
  });

  test("picking the checklist's name saves it as the card's name", async () => {
    const { onConfirm } = mount(daxWorld());
    linkDax();
    fireEvent.click(pill(MAX_PILL));
    expect(checkedName()).toEqual([MAX_PILL]);
    await confirm();
    const [card] = confirmed(onConfirm);
    expect(card.cardName).toBe(MAX);
    expect(card.players).toEqual([MAX]);
  });

  test("a pick answers the wizard's players question: nothing is left to ask", async () => {
    const picked = mount(daxWorld());
    linkDax();
    fireEvent.click(pill(MAX_PILL));
    await confirm();
    expect(confirmed(picked.onConfirm)[0].checklistConflict).toBeUndefined();
  });

  test("an untouched row keeps the disagreement for the wizard to ask", async () => {
    const { onConfirm } = mount(daxWorld());
    linkDax();
    await confirm();
    const [card] = confirmed(onConfirm);
    expect(card.cardName).toBe(DAX);
    expect(card.checklistConflict?.players).toEqual({ marketplace: [DAX], checklist: [MAX] });
  });

  test("clicking the preselected name is an answer too: the card keeps Dax and nothing is asked", async () => {
    const { onConfirm } = mount(daxWorld());
    linkDax();
    fireEvent.click(pill(DAX));
    await confirm();
    const [card] = confirmed(onConfirm);
    expect(card.cardName).toBe(DAX);
    expect(card.players).toEqual([DAX]);
    expect(card.checklistConflict).toBeUndefined();
  });

  test("a teams disagreement on the same card is a different question and stays", async () => {
    const { onConfirm } = mount({
      ...daxWorld(),
      resolve: vi.fn(async (pairs: ChecklistPairRequest[]) =>
        pairs.map((p) => ({
          cardKey: p.cardKey,
          checklistConflict: {
            ...players(p.card.players, p.row.players),
            teams: { marketplace: ["Mets"], checklist: ["Yankees"] },
          },
        })),
      ),
    });
    linkDax();
    fireEvent.click(pill(MAX_PILL));
    await confirm();
    const [card] = confirmed(onConfirm);
    expect(card.players).toEqual([MAX]);
    expect(card.checklistConflict).toEqual({
      teams: { marketplace: ["Mets"], checklist: ["Yankees"] },
    });
  });

  test("a pick is dropped on Unlink: relinking offers Dax again, and nothing is saved as Max", async () => {
    const { onConfirm } = mount(daxWorld());
    linkDax();
    fireEvent.click(pill(MAX_PILL));
    fireEvent.click(screen.getByLabelText(/^Unlink card #OV-MAKI .* from checklist row/));
    expect(namePills()).toHaveLength(0);
    linkDax();
    expect(checkedName()).toEqual([DAX]);
    await confirm();
    expect(confirmed(onConfirm)[0].cardName).toBe(DAX);
  });

  test("arrow keys move through the names like any radiogroup", () => {
    mount(daxWorld());
    linkDax();
    fireEvent.keyDown(pill(DAX), { key: "ArrowRight" });
    expect(checkedName()).toEqual([MAX_PILL]);
  });
});

describe("the server's near-name pair", () => {
  const nearName = (): PairingCard =>
    bscCard("OV-MAKI", DAX, {
      checklistLink: {
        via: "playerFuzzy",
        confidence: 0.82,
        row: {
          number: "NNO",
          noNumber: true,
          players: [MAX],
          teams: [],
          cardName: MAX,
        },
        revert: { teamsFromRow: false },
      },
      checklistConflict: players([DAX], [MAX]),
    });

  test("shows the pills, and a pick saves and answers the question", async () => {
    const { onConfirm } = mount({ unmatchedBsc: [nearName()] });
    expandMatched();
    expect(pillNames()).toEqual([DAX, MAX_PILL]);
    expect(checkedName()).toEqual([DAX]);
    fireEvent.click(pill(MAX_PILL));
    await confirm();
    const [card] = confirmed(onConfirm);
    expect(card.cardName).toBe(MAX);
    expect(card.players).toEqual([MAX]);
    expect(card.checklistConflict).toBeUndefined();
  });

  test("a pair stored without its row still names the checklist's side from the disagreement", () => {
    const stored = nearName();
    delete stored.checklistLink!.row;
    delete stored.checklistLink!.revert;
    mount({ unmatchedBsc: [stored] });
    expandMatched();
    expect(pillNames()).toEqual([DAX, MAX_PILL]);
  });

  test("a server pair whose row spells the same name has no picker", () => {
    const same = nearName();
    same.checklistLink!.row!.players = ["dax kilby"];
    delete same.checklistConflict;
    mount({ unmatchedBsc: [same] });
    expandMatched();
    expect(namePills()).toHaveLength(0);
  });
});

describe("BSC against SportLots is unchanged", () => {
  const conflicted = (): PairingCard => ({
    cardNumber: "227c",
    cardName: "Mike Yastrzemski",
    platformData: {
      bsc: { ref: "bsc-227c", setId: "set-1" },
      sportlots: { ref: "#227c", setId: "884412" },
    },
    nameConflict: { bsc: "Mike Yastrzemski", sportlots: "Carl Yastrzemski" },
  });

  test("two bare pills, BSC's chosen, and a pick still saves", async () => {
    const { onConfirm } = mount({ autoMatched: [{ card: conflicted(), confidence: 1 }] });
    expandMatched();
    expect(pillNames()).toEqual(["Mike Yastrzemski", "Carl Yastrzemski"]);
    expect(checkedName()).toEqual(["Mike Yastrzemski"]);
    fireEvent.click(pill("Carl Yastrzemski", "#227c"));
    await confirm();
    expect(confirmed(onConfirm)[0].cardName).toBe("Carl Yastrzemski");
  });
});

describe("three sources", () => {
  test("a pair the marketplaces name differently AND the checklist names a third way has three pills", async () => {
    const three: PairingCard = {
      cardNumber: "OV-MAKI",
      cardName: DAX,
      players: [DAX],
      platformData: {
        bsc: { ref: "bsc-OV-MAKI", setId: "set-1" },
        sportlots: { ref: "#OV-MAKI", setId: "884412" },
      },
      nameConflict: { bsc: DAX, sportlots: "Dax Kilbey" },
      checklistLink: {
        via: "playerFuzzy",
        confidence: 0.8,
        row: { number: "NNO", noNumber: true, players: [MAX], teams: [], cardName: MAX },
        revert: { teamsFromRow: false },
      },
      checklistConflict: players([DAX], [MAX]),
    };
    const { onConfirm } = mount({ autoMatched: [{ card: three, confidence: 0.8 }] });
    expandMatched();
    expect(pillNames()).toEqual([DAX, "Dax Kilbey", MAX_PILL]);
    expect(checkedName()).toEqual([DAX]);
    fireEvent.click(pill(MAX_PILL));
    await confirm();
    expect(confirmed(onConfirm)[0].cardName).toBe(MAX);
  });
});

describe("de-dupe", () => {
  test("names that differ only in case are one pill, and the checklist sharing a marketplace's name is bare", () => {
    const sharing: PairingCard = {
      cardNumber: "OV-MAKI",
      cardName: DAX,
      platformData: {
        bsc: { ref: "bsc-OV-MAKI", setId: "set-1" },
        sportlots: { ref: "#OV-MAKI", setId: "884412" },
      },
      nameConflict: { bsc: DAX, sportlots: MAX },
      checklistLink: {
        via: "playerFuzzy",
        confidence: 0.8,
        row: { number: "NNO", noNumber: true, players: ["max kilby"], teams: [], cardName: MAX },
        revert: { teamsFromRow: false },
      },
    };
    mount({ autoMatched: [{ card: sharing, confidence: 0.8 }] });
    expandMatched();
    // SportLots said Max first; the checklist's "max kilby" is the same name,
    // and a name a marketplace also said is not marked as the checklist's.
    expect(pillNames()).toEqual([DAX, MAX]);
  });

  test("a checklist name that differs only in case from the card has no picker", async () => {
    mount({
      unmatchedBsc: [bscCard("OV-MAKI", MAX)],
      checklistOnly: [rowCard("NNO", "max kilby", 0)],
      resolve: vi.fn(async (pairs: ChecklistPairRequest[]) => pairs.map((p) => ({ cardKey: p.cardKey }))),
    });
    fireEvent.click(screen.getByLabelText(/^Select .*max kilby/));
    fireEvent.click(screen.getByLabelText(`Link selected checklist row to #OV-MAKI ${MAX}`));
    expandMatched();
    expect(namePills()).toHaveLength(0);
  });
});
