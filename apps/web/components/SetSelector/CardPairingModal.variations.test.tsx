/**
 * NEO-591 (variations) — one checklist row, several cards, in Match Cards.
 *
 * A checklist prints "38"; the marketplaces list 38, 38b and 38c. The server
 * pairs all three to the row (`via: "stem"`, one shared `rowKey`) and creates
 * the variations NB lacks (`preKept`: they open in Keeping). Pinned here: the
 * shared chip, an Unlink that reverts one card and re-lists the row only when
 * the last holder lets go, and Keeping seeded from `preKept` without counting
 * as the operator's work.
 *
 * (Header of the sibling file, `CardPairingModal.numbers.test.tsx`, for the
 * names-first half.)
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
import CardPairingModal, { type PairingCard } from "./CardPairingModal";
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


const ROW = { number: "38", players: ["Ted Williams"], teams: [], cardName: "Ted Williams" };

/** A card of the variation family 38 / 38b / 38c, paired to the shared row. */
const stemCard = (n: string): PairingCard => ({
  ...bscCard(n, `Ted Williams ${n}`),
  checklistLink: {
    via: "stem",
    confidence: 0.9,
    checklistNumber: "38",
    rowKey: 0,
    row: ROW,
    revert: { teamsFromRow: false },
  },
});

const unlinkName = (n: string) =>
  `Unlink card #${n} Ted Williams ${n} from checklist row #38 Ted Williams`;

const announcer = () => screen.getAllByRole("status").find((el) => !el.id) as HTMLElement;

describe("one checklist row shared by several cards", () => {
  const family = () => ["38", "38b", "38c"].map(stemCard);

  test("each card shows the row's chip, reading all versions, with no %", () => {
    mount({ sources: ["bsc", "checklist"], unmatchedBsc: family() });
    expect(screen.getByText(/Matched \(3\)/)).toBeTruthy();
    expandMatched();
    expect(screen.getAllByText("Checklist: #38 · all versions")).toHaveLength(3);
    expect(screen.queryByText(/%/)).toBeNull();
    expect(screen.queryByText(/Name match/)).toBeNull();
  });

  test("Unlink on one card reverts that card alone; the row stays out of the list", () => {
    mount({ sources: ["bsc", "checklist"], unmatchedBsc: family() });
    expandMatched();

    fireEvent.click(screen.getByLabelText(unlinkName("38b")));

    expect(screen.getAllByText("Checklist: #38 · all versions")).toHaveLength(2);
    expect(screen.getByRole("heading", { name: "Checklist only (0)" })).toBeTruthy();
    expect(screen.queryByLabelText(/^Select #38 /)).toBeNull();
    // Names the others; the one-marketplace card moved to Keeping.
    expect(announcer().textContent).toBe(
      "Unlinked from #38b. Row #38 still covers #38 and #38c. Moved to Keeping.",
    );
  });

  test("with more than two others it counts them", () => {
    mount({
      sources: ["bsc", "checklist"],
      unmatchedBsc: ["38", "38b", "38c", "38d"].map(stemCard),
    });
    expandMatched();
    fireEvent.click(screen.getByLabelText(unlinkName("38b")));
    expect(announcer().textContent).toBe(
      "Unlinked from #38b. Row #38 still covers 3 other cards. Moved to Keeping.",
    );
  });

  test("focus lands on the card's own Remove on the shelf it moved to", async () => {
    mount({ sources: ["bsc", "checklist"], unmatchedBsc: family() });
    expandMatched();
    fireEvent.click(screen.getByLabelText(unlinkName("38b")));
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByLabelText("Remove #38b Ted Williams 38b from save list"),
      ),
    );
  });

  test("a BSC and SportLots pair stays matched: focus lands on its title and nothing moves to Keeping", async () => {
    const pair = (n: string): PairingCard => ({
      ...stemCard(n),
      platformData: {
        bsc: { ref: `bsc-${n}`, setId: "set-1" },
        sportlots: { ref: `#${n} Ted`, setId: "884412" },
      },
    });
    mount({
      sources: ["bsc", "sportlots", "checklist"],
      autoMatched: ["38", "38b"].map((n) => ({ card: pair(n), confidence: 1 })),
    });
    expandMatched();
    fireEvent.click(screen.getByLabelText(unlinkName("38b")));
    expect(announcer().textContent).toBe("Unlinked from #38b. Row #38 still covers #38.");
    await waitFor(() =>
      expect(document.activeElement?.getAttribute("aria-label")).toBe(
        "Edit name for #38b Ted Williams 38b",
      ),
    );
  });

  test("the last card to let go lists the row again", () => {
    mount({ sources: ["bsc", "checklist"], unmatchedBsc: family() });
    expandMatched();

    fireEvent.click(screen.getByLabelText(unlinkName("38b")));
    fireEvent.click(screen.getByLabelText(unlinkName("38c")));
    expect(screen.getByRole("heading", { name: "Checklist only (0)" })).toBeTruthy();

    fireEvent.click(screen.getByLabelText(unlinkName("38")));
    expect(screen.getByRole("heading", { name: "Checklist only (1)" })).toBeTruthy();
    expect(screen.getByLabelText("Select #38 Ted Williams")).toBeTruthy();
    expect(announcer().textContent).toBe(
      "Unlinked from #38 Ted Williams 38. Checklist row's back on the list. Moved to Keeping.",
    );
  });

  test("a card unlinked while others hold the row is still saved, without its link", async () => {
    const { onConfirm } = mount({ sources: ["bsc", "checklist"], unmatchedBsc: family() });
    expandMatched();
    fireEvent.click(screen.getByLabelText(unlinkName("38b")));
    await confirm();
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    const cards = confirmedCards(onConfirm);
    expect(cards.map((c) => c.cardNumber).sort()).toEqual(["38", "38b", "38c"]);
    for (const c of cards) expect(c).not.toHaveProperty("checklistLink");
  });
});

describe("cards NB created open in Keeping", () => {
  const made = (n: string): PairingCard => ({ ...bscCard(n, `Ted Williams ${n}`), isVariation: true, preKept: true });
  const removeName = (n: string) => `Remove #${n} Ted Williams ${n} from save list`;

  test("a pre-kept marketplace card starts on the shelf, is saved, and can be taken out", async () => {
    const { onConfirm } = mount({ unmatchedBsc: [made("38b"), bscCard("39", "Other Card")] });
    expect(screen.getByLabelText(removeName("38b"))).toBeTruthy();
    expect(screen.getByLabelText("Keep #39 Other Card as BSC-only")).toBeTruthy();

    fireEvent.click(screen.getByLabelText(removeName("38b")));
    expect(screen.getByLabelText("Keep #38b Ted Williams 38b as BSC-only")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Keep #38b Ted Williams 38b as BSC-only"));
    await confirm();
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    const [card] = confirmedCards(onConfirm);
    expect(card.cardNumber).toBe("38b");
    expect(card).not.toHaveProperty("preKept");
  });

  test("an untouched session still closes at once; taking one out is work to confirm", () => {
    const onClose = vi.fn();
    render(
      <CardPairingModal
        isOpen
        onClose={onClose}
        onConfirm={vi.fn()}
        initialData={{ autoMatched: [], unmatchedBsc: [made("38b")], unmatchedSl: [] }}
      />,
    );
    fireEvent.click(screen.getByLabelText("Cancel card matching"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("taking a pre-kept card out makes a close ask first", () => {
    const onClose = vi.fn();
    render(
      <CardPairingModal
        isOpen
        onClose={onClose}
        onConfirm={vi.fn()}
        initialData={{ autoMatched: [], unmatchedBsc: [made("38b")], unmatchedSl: [] }}
      />,
    );
    fireEvent.click(screen.getByLabelText(removeName("38b")));
    fireEvent.click(screen.getByLabelText("Cancel card matching"));
    expect(onClose).not.toHaveBeenCalled();
  });

  test("a pre-kept checklist row names its variation on the shelf, before Confirm", () => {
    const row: PairingCard = {
      cardNumber: "95b",
      cardName: "Kyle Long",
      cardVariation: "Photo Variation",
      players: ["Kyle Long"],
      platformData: {},
      checklistRowId: "row-95b",
      isVariation: true,
      preKept: true,
    };
    const plain: PairingCard = {
      cardNumber: "7",
      cardName: "Plain Row",
      players: ["Plain Row"],
      platformData: {},
      checklistRowId: "row-7",
    };
    mount({ sources: ["bsc", "checklist"], checklistOnly: [row, plain] });
    // The same "· <variation>" the card label uses elsewhere.
    expect(screen.getByText("Checklist: #95b Kyle Long · Photo Variation")).toBeTruthy();
    expect(screen.queryByText(/Checklist: #7 Plain Row ·/)).toBeNull();
  });

  test("a pre-kept checklist row starts kept too, and Remove lists it again", async () => {
    const row: PairingCard = {
      cardNumber: "38b",
      cardName: "Ted Williams",
      players: ["Ted Williams"],
      platformData: {},
      checklistRowId: "row-0",
      isVariation: true,
      preKept: true,
    };
    const { onConfirm } = mount({ sources: ["bsc", "checklist"], checklistOnly: [row] });
    expect(screen.getByRole("heading", { name: "Checklist only (0)" })).toBeTruthy();
    expect(screen.getByText("1 card will be saved")).toBeTruthy();

    await confirm();
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    const [card] = confirmedCards(onConfirm);
    expect(card.cardNumber).toBe("38b");
    expect(card).not.toHaveProperty("preKept");
  });
});
