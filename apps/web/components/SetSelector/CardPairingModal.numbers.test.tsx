/**
 * NEO-591 — names first, numbers confirm, in Match Cards.
 *
 * Sources number the same card differently (BSC "OV-ANFI" against a
 * checklist's NNO; letters on one side, digits on the other). The server pairs
 * such a card by name and hands the numbers on as `sourceNumbers`; the dialog
 * shows the pair as Matched, at the lower confidence, with a state-only
 * "Numbers differ" note, and keeps every source's number so an Unlink puts
 * each half back as it was.
 *
 * Pinned here: the note, its tooltip and screen-reader words, the amber %,
 * the "Checklist: NNO" chip, the number a hand link picks, what an Unlink
 * restores, and that `sourceNumbers` never reaches the commit.
 */

import { describe, expect, test, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import CardPairingModal, {
  serverChecklistChipText,
  shownConfidence,
  type PairingCard,
} from "./CardPairingModal";
import type { ChecklistPairAnswer, ChecklistPairRequest } from "./checklist-match-apply";

const bscCard = (n: string, name: string): PairingCard => ({
  cardNumber: n,
  cardName: name,
  platformData: { bsc: { ref: `bsc-${n}`, setId: "set-1" } },
  unmatched: "sl",
});

const slCard = (n: string, name: string): PairingCard => ({
  cardNumber: n,
  cardName: name,
  platformData: { sportlots: { ref: `#${n} ${name}`, setId: "884412" } },
  unmatched: "bsc",
});

function mount(initial: {
  sources?: readonly ("bsc" | "sportlots" | "checklist")[];
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
      sources={initial.sources}
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

const confirmedCards = (onConfirm: ReturnType<typeof vi.fn>): PairingCard[] =>
  onConfirm.mock.calls[0][0].cards;

/** Onyx Base: BSC prints OV-ANFI, the checklist prints NNO, the names agree. */
const onyxCard = (): PairingCard => ({
  ...bscCard("OV-ANFI", "Anfernee Simons"),
  sourceNumbers: { bsc: "OV-ANFI", checklist: "NNO" },
  checklistLink: { via: "playerName", confidence: 0.9, checklistNumber: "NNO" },
});

describe("the Numbers differ note", () => {
  test("a name pair whose numbers differ is Matched, shows the lower % once and a state-only note", () => {
    mount({ sources: ["bsc", "checklist"], unmatchedBsc: [onyxCard()] });
    expect(screen.getByText(/Matched \(1\)/)).toBeTruthy();
    expandMatched();

    const note = screen.getByText("Numbers differ");
    expect(note.className).toContain("text-xs");
    // State only: the number picker carries each number.
    expect(note.getAttribute("title")).toBeNull();
    expect(note.textContent).toBe("Numbers differ");

    // The existing amber % carries the lower confidence, just before the note.
    const amber = screen.getByText("90%");
    expect(amber.className).toContain("text-notice-warn-ink");
    expect(amber.nextElementSibling).toBe(note);
    // Shown once: the chip keeps its words for a screen reader only, and the
    // amber one is hidden from it so the % is heard once.
    expect(amber.getAttribute("aria-hidden")).toBe("true");
    expect(screen.getAllByText(/90%/)).toHaveLength(2);
    const chipWords = screen.getByText("Name match 90%");
    expect(chipWords.className).toContain("sr-only");
  });

  test("a near-name pair with no scored row keeps the % in its chip, read as Name match", () => {
    mount({
      sources: ["bsc", "checklist"],
      unmatchedBsc: [
        { ...bscCard("FS-4", "Jackson Merrill"), checklistLink: { via: "playerFuzzy", confidence: 0.94 } },
      ],
    });
    expandMatched();
    const percent = screen.getByText("94%");
    expect(percent.textContent).toBe("Name match 94%");
    expect(percent.className).not.toContain("sr-only");
  });

  test("a pair whose numbers agree shows no note", () => {
    mount({
      sources: ["bsc", "checklist"],
      unmatchedBsc: [{ ...bscCard("FS-4", "Jackson Merrill"), checklistLink: { via: "number" } }],
    });
    expandMatched();
    expect(screen.queryByText(/Numbers differ/)).toBeNull();
    expect(screen.queryByRole("radiogroup", { name: /^Number for / })).toBeNull();
  });

  test("a pair the operator hand-linked with differing numbers shows the note but no %", () => {
    mount({ unmatchedBsc: [bscCard("12", "Alpha Card")], unmatchedSl: [slCard("13b", "Beta Card")] });
    fireEvent.click(screen.getByLabelText("Select BSC card #12 Alpha Card"));
    fireEvent.click(screen.getByLabelText("Link selected BSC card to #13b Beta Card"));
    expandMatched();
    expect(screen.getByText("Numbers differ")).toBeTruthy();
    expect(screen.queryByText(/%/)).toBeNull();
  });
});

describe("the number picker", () => {
  const picker = (scope: string) => screen.getByRole("radiogroup", { name: `Number for ${scope}` });
  const choice = (number: string, scope: string) =>
    screen.getByRole("radio", { name: `${number} — use this number for ${scope}` });

  test("offers one choice per distinct number, with the rule's pick preselected", () => {
    mount({ sources: ["bsc", "checklist"], unmatchedBsc: [onyxCard()] });
    expandMatched();
    expect(screen.getByRole("group", { name: "Number conflict on #OV-ANFI" })).toBeTruthy();
    const radios = Array.from(picker("#OV-ANFI").querySelectorAll('[role="radio"]'));
    expect(radios.map((r) => r.textContent?.replace(/^✓ /, ""))).toEqual(["#OV-ANFI", "NNO"]);
    expect(choice("#OV-ANFI", "#OV-ANFI").getAttribute("aria-checked")).toBe("true");
    expect(choice("NNO", "#OV-ANFI").getAttribute("aria-checked")).toBe("false");
  });

  test("picking the other number sets the card's number for Confirm, and the group keeps its name", async () => {
    const { onConfirm } = mount({ sources: ["bsc", "checklist"], unmatchedBsc: [onyxCard()] });
    expandMatched();
    fireEvent.click(choice("NNO", "#OV-ANFI"));
    expect(choice("NNO", "#OV-ANFI").getAttribute("aria-checked")).toBe("true");
    expect(picker("#OV-ANFI")).toBeTruthy();
    await confirm();
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    const [card] = confirmedCards(onConfirm);
    expect(card.cardNumber).toBe("NNO");
    expect(card).not.toHaveProperty("sourceNumbers");
  });

  test("arrow keys move the pick, and focus goes with it", async () => {
    mount({ sources: ["bsc", "checklist"], unmatchedBsc: [onyxCard()] });
    expandMatched();
    const first = choice("#OV-ANFI", "#OV-ANFI");
    expect(first.getAttribute("tabindex")).toBe("0");
    expect(choice("NNO", "#OV-ANFI").getAttribute("tabindex")).toBe("-1");
    fireEvent.keyDown(picker("#OV-ANFI"), { key: "ArrowRight" });
    expect(choice("NNO", "#OV-ANFI").getAttribute("aria-checked")).toBe("true");
    await waitFor(() => expect(document.activeElement).toBe(choice("NNO", "#OV-ANFI")));
  });

  test("38 and 38a agree: no note, but both are offered with the lettered one preselected", () => {
    const card: PairingCard = {
      ...bscCard("38a", "Ted Williams"),
      sourceNumbers: { bsc: "38", checklist: "38a" },
      checklistLink: { via: "playerName", confidence: 0.95, checklistNumber: "38a" },
    };
    mount({ sources: ["bsc", "checklist"], unmatchedBsc: [card] });
    expandMatched();
    expect(screen.queryByText("Numbers differ")).toBeNull();
    expect(choice("#38a", "#38a").getAttribute("aria-checked")).toBe("true");
    expect(choice("#38", "#38a").getAttribute("aria-checked")).toBe("false");
  });

  test("an untouched number pick closes at once", () => {
    const onClose = vi.fn();
    render(
      <CardPairingModal
        isOpen
        onClose={onClose}
        onConfirm={vi.fn()}
        sources={["bsc", "checklist"]}
        initialData={{ autoMatched: [], unmatchedBsc: [onyxCard()], unmatchedSl: [] }}
      />,
    );
    fireEvent.click(screen.getByLabelText("Cancel card matching"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("a pick off the rule makes a close ask first", () => {
    const onClose = vi.fn();
    render(
      <CardPairingModal
        isOpen
        onClose={onClose}
        onConfirm={vi.fn()}
        sources={["bsc", "checklist"]}
        initialData={{ autoMatched: [], unmatchedBsc: [onyxCard()], unmatchedSl: [] }}
      />,
    );
    expandMatched();
    fireEvent.click(choice("NNO", "#OV-ANFI"));
    fireEvent.click(screen.getByLabelText("Cancel card matching"));
    expect(onClose).not.toHaveBeenCalled();
  });

  test("a BSC and SportLots pair hand-linked on plain digits offers both, BSC preselected", () => {
    mount({ unmatchedBsc: [bscCard("38", "Alpha Card")], unmatchedSl: [slCard("250", "Beta Card")] });
    fireEvent.click(screen.getByLabelText("Select BSC card #38 Alpha Card"));
    fireEvent.click(screen.getByLabelText("Link selected BSC card to #250 Beta Card"));
    expandMatched();
    expect(choice("#38", "#38").getAttribute("aria-checked")).toBe("true");
    fireEvent.click(choice("#250", "#38"));
    expect(choice("#250", "#38").getAttribute("aria-checked")).toBe("true");
  });

  test("a checklist row linked by hand offers its number beside the card's, and the pick wins at Confirm", async () => {
    const row: PairingCard = {
      cardNumber: "NNO",
      cardName: "Ted Williams",
      players: ["Ted Williams"],
      platformData: {},
      checklistRowId: "row-0",
    };
    const resolve = vi.fn(async (pairs: ChecklistPairRequest[]) =>
      pairs.map((p) => ({ cardKey: p.cardKey })),
    );
    const { onConfirm } = mount({
      sources: ["bsc", "sportlots", "checklist"],
      unmatchedBsc: [bscCard("38", "Card One")],
      unmatchedSl: [slCard("38", "Card Two")],
      checklistOnly: [row],
      resolve,
    });
    fireEvent.click(screen.getByLabelText("Select BSC card #38 Card One"));
    fireEvent.click(screen.getByLabelText("Link selected BSC card to #38 Card Two"));
    expandMatched();
    fireEvent.click(screen.getByLabelText(/^Select NNO /));
    fireEvent.click(screen.getByLabelText("Link selected checklist row to #38 Card One"));
    // The rule keeps the digits over NNO; the operator takes NNO instead.
    expect(choice("#38", "#38").getAttribute("aria-checked")).toBe("true");
    fireEvent.click(choice("NNO", "#38"));
    await confirm();
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(confirmedCards(onConfirm)[0].cardNumber).toBe("NNO");
  });
});

describe("shownConfidence", () => {
  const card = (extra: Partial<PairingCard> = {}) => ({ ...bscCard("1", "A"), ...extra });

  test("the link's confidence lowers a pair whose numbers differ", () => {
    const pair = { confidence: 1, card: card(onyxCard()) };
    expect(shownConfidence(pair)).toBe(0.9);
    expect(shownConfidence({ ...pair, confidence: 0.85 })).toBe(0.85);
  });

  test("without differing numbers it is the pair's own, and a hand link stays unscored", () => {
    const link = { via: "playerFuzzy" as const, confidence: 0.93 };
    expect(shownConfidence({ confidence: 1, card: card({ checklistLink: link }) })).toBe(1);
    expect(shownConfidence({ confidence: 0, card: onyxCard() })).toBe(0);
  });
});

describe("the checklist chip for a no-number row", () => {
  test("reads Checklist: NNO, like the hand link's chip, and says there is no number", () => {
    expect(serverChecklistChipText({ via: "playerName", checklistNumber: "NNO" }).label).toBe(
      "Checklist: NNO",
    );
    mount({
      sources: ["bsc", "checklist"],
      unmatchedBsc: [
        { ...bscCard("7", "Seven"), checklistLink: { via: "playerName", checklistNumber: "NNO" } },
      ],
    });
    expandMatched();
    const chip = screen.getByText("Checklist: NNO");
    expect(chip.getAttribute("title")).toBe("Your checklist prints this card with no number");
    expect(screen.queryByText("On checklist")).toBeNull();
  });

  test("a numbered row still reads Checklist: #N", () => {
    expect(serverChecklistChipText({ via: "playerName", checklistNumber: "FS-3" }).label).toBe(
      "Checklist: #FS-3",
    );
  });
});

describe("a hand link between BSC and SportLots", () => {
  const link = (bsc: PairingCard, sl: PairingCard) => {
    fireEvent.click(screen.getByLabelText(`Select BSC card #${bsc.cardNumber} ${bsc.cardName}`));
    fireEvent.click(
      screen.getByLabelText(`Link selected BSC card to #${sl.cardNumber} ${sl.cardName}`),
    );
  };

  test("letters beat digits: the card takes the SportLots number, and the commit carries no sourceNumbers", async () => {
    const bsc = bscCard("12", "Alpha Card");
    const sl = slCard("13b", "Beta Card");
    const { onConfirm } = mount({ unmatchedBsc: [bsc], unmatchedSl: [sl] });
    link(bsc, sl);
    await confirm();
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    const [card] = confirmedCards(onConfirm);
    expect(card.cardNumber).toBe("13b");
    expect(card).not.toHaveProperty("sourceNumbers");
  });

  test("the same kind of number keeps BSC's", async () => {
    const bsc = bscCard("12", "Alpha Card");
    const sl = slCard("13", "Beta Card");
    const { onConfirm } = mount({ unmatchedBsc: [bsc], unmatchedSl: [sl] });
    link(bsc, sl);
    await confirm();
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(confirmedCards(onConfirm)[0].cardNumber).toBe("12");
  });

  test("Unlink hands SportLots back its own number when BSC's won", () => {
    const bsc = bscCard("13b", "Alpha Card");
    const sl = slCard("12", "Beta Card");
    mount({ unmatchedBsc: [bsc], unmatchedSl: [sl] });
    link(bsc, sl);
    expandMatched();
    fireEvent.click(screen.getByLabelText("Unlink #13b Alpha Card"));
    expect(screen.getByLabelText("Select BSC card #13b Alpha Card")).toBeTruthy();
    expect(screen.getByLabelText("Link selected BSC card to #12 Beta Card")).toBeTruthy();
  });

  test("Unlink gives each half the number its marketplace printed", () => {
    const bsc = bscCard("12", "Alpha Card");
    const sl = slCard("13b", "Beta Card");
    mount({ unmatchedBsc: [bsc], unmatchedSl: [sl] });
    link(bsc, sl);
    expandMatched();
    fireEvent.click(screen.getByLabelText("Unlink #13b Alpha Card"));
    expect(screen.getByLabelText("Select BSC card #12 Alpha Card")).toBeTruthy();
    expect(screen.getByLabelText("Link selected BSC card to #13b Beta Card")).toBeTruthy();
  });
});

describe("Unlink on the server's checklist pair", () => {
  const ROW = {
    number: "38a",
    players: ["Ted Williams"],
    teams: [],
    cardName: "Ted Williams",
  };
  /** BSC printed 38, the checklist 38a; the card took 38a and remembers 38. */
  const pair = (): PairingCard => ({
    ...bscCard("38a", "Ted Williams"),
    sourceNumbers: { bsc: "38", checklist: "38a" },
    checklistLink: {
      via: "playerName",
      confidence: 0.9,
      checklistNumber: "38a",
      row: ROW,
      revert: { teamsFromRow: false, cardNumber: "38" },
    },
  });

  test("the card gets its own number back and the picker goes with the link", async () => {
    const { onConfirm } = mount({ sources: ["bsc", "checklist"], unmatchedBsc: [pair()] });
    expandMatched();
    // 38 and 38a agree (no note), but the operator may still want either.
    expect(screen.queryByText("Numbers differ")).toBeNull();
    expect(screen.getByRole("radiogroup", { name: "Number for #38a" })).toBeTruthy();

    fireEvent.click(
      screen.getByLabelText("Unlink card #38a Ted Williams from checklist row #38a Ted Williams"),
    );

    expect(screen.queryByRole("radiogroup", { name: /^Number for / })).toBeNull();
    expect(screen.getByText("BSC: #38 Ted Williams")).toBeTruthy();
    await confirm();
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    const [card] = confirmedCards(onConfirm);
    expect(card.cardNumber).toBe("38");
    expect(card).not.toHaveProperty("sourceNumbers");
    expect(card).not.toHaveProperty("checklistLink");
  });
});

describe("a checklist row the operator links by hand", () => {
  test("the card takes the more specific number; the commit carries no sourceNumbers", async () => {
    const row: PairingCard = {
      cardNumber: "38a",
      cardName: "Ted Williams",
      players: ["Ted Williams"],
      platformData: {},
      checklistRowId: "row-0",
    };
    const resolve = vi.fn(async (pairs: ChecklistPairRequest[]) =>
      pairs.map((p) => ({ cardKey: p.cardKey })),
    );
    const { onConfirm } = mount({
      sources: ["bsc", "sportlots", "checklist"],
      unmatchedBsc: [bscCard("38", "Card One")],
      unmatchedSl: [slCard("5", "Card Two")],
      checklistOnly: [row],
      resolve,
    });
    // Pair the marketplaces by hand, then link the row to the pair.
    fireEvent.click(screen.getByLabelText("Select BSC card #38 Card One"));
    fireEvent.click(screen.getByLabelText("Link selected BSC card to #5 Card Two"));
    expandMatched();
    fireEvent.click(screen.getByLabelText(/^Select #38a /));
    fireEvent.click(screen.getByLabelText("Link selected checklist row to #38 Card One"));
    await confirm();
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(resolve).toHaveBeenCalledTimes(1);
    const [card] = confirmedCards(onConfirm);
    expect(card.cardNumber).toBe("38a");
    expect(card).not.toHaveProperty("sourceNumbers");
  });
});

describe("a minted variation card on the Keeping shelf", () => {
  const minted = (): PairingCard => ({
    ...slCard("38b", "Ted Williams"),
    isVariation: true,
    preKept: true,
    numberMinted: true,
    variationGroup: "grp-38",
    sourceNumbers: { sportlots: "38" },
  });
  const choice = (number: string) =>
    screen.getByRole("radio", { name: `${number} — use this number for #38b` });

  test("offers the minted number beside the printed one, minted preselected", () => {
    mount({ unmatchedSl: [minted()] });
    expect(screen.getByRole("radiogroup", { name: "Number for #38b" })).toBeTruthy();
    expect(choice("#38b").getAttribute("aria-checked")).toBe("true");
    expect(choice("#38").getAttribute("aria-checked")).toBe("false");
    // One card, not a pair: nothing to flag.
    expect(screen.queryByText("Numbers differ")).toBeNull();
  });

  test("picking the printed number keeps it minted and in its group, and the minted one stays on offer", async () => {
    const { onConfirm } = mount({ unmatchedSl: [minted()] });
    fireEvent.click(choice("#38"));
    expect(choice("#38").getAttribute("aria-checked")).toBe("true");
    // The group keeps its name and the minted number is still a choice.
    fireEvent.click(choice("#38b"));
    expect(choice("#38b").getAttribute("aria-checked")).toBe("true");
    fireEvent.click(choice("#38"));
    await confirm();
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    const [card] = confirmedCards(onConfirm);
    expect(card.cardNumber).toBe("38");
    expect(card.numberMinted).toBe(true);
    expect(card.variationGroup).toBe("grp-38");
    expect(card).not.toHaveProperty("preKept");
    expect(card).not.toHaveProperty("sourceNumbers");
  });
});

describe("a number swapped in by a hand link is minted", () => {
  test("BSC 12 against SportLots 13b: the card takes 13b and says it was not printed for it", async () => {
    const { onConfirm } = mount({
      unmatchedBsc: [bscCard("12", "Alpha Card")],
      unmatchedSl: [slCard("13b", "Beta Card")],
    });
    fireEvent.click(screen.getByLabelText("Select BSC card #12 Alpha Card"));
    fireEvent.click(screen.getByLabelText("Link selected BSC card to #13b Beta Card"));
    await confirm();
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(confirmedCards(onConfirm)[0]).toMatchObject({ cardNumber: "13b", numberMinted: true });
  });
});
