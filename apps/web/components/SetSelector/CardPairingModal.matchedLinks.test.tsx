/**
 * NEO-591 — a checklist row the operator links by hand to a marketplace-only
 * card leaves its list WITH the card and sits as one Matched row, like a pair
 * the server made. Unlink puts both back. Keeping holds only what the
 * operator kept, sits under Matched, and draws the same row as Matched.
 *
 * Pinned here: the move and the counts on a link and on an Unlink, the footer
 * count, a number pick that survives the move, the focus targets, and the
 * Keeping shelf as a Matched-style list (Remove sends a card home; rename).
 */

import { describe, expect, test, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

const pair = (n: string, name: string): PairingCard => ({
  cardNumber: n,
  cardName: name,
  platformData: {
    bsc: { ref: `bsc-${n}`, setId: "set-1" },
    sportlots: { ref: `#${n} ${name}`, setId: "884412" },
  },
});

const rowCard = (n: string, name: string, i: number): PairingCard => ({
  cardNumber: n,
  cardName: name,
  players: [name],
  platformData: {},
  checklistRowId: `row-${i}`,
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
const heading = (name: string) => screen.getByRole("heading", { name });
const announcer = () =>
  screen.getAllByRole("status").find((el) => !el.id) as HTMLElement;
const confirm = () =>
  act(async () => {
    fireEvent.click(screen.getByLabelText("Confirm card matches"));
  });
const confirmed = (onConfirm: ReturnType<typeof vi.fn>): PairingCard[] =>
  onConfirm.mock.calls[0][0].cards;
const footer = (n: number) => screen.getByText(`${n} card${n === 1 ? "" : "s"} will be saved`);
const keepingToggle = () => screen.getByRole("button", { name: /Keeping \(\d+\)/ });

const answered = (pairs: ChecklistPairRequest[]) => pairs.map((p) => ({ cardKey: p.cardKey }));

/** Jason's shape: a matched pair, BSC-only cards, and checklist-only rows. */
const world = () => ({
  autoMatched: [{ card: pair("1", "Pair One"), confidence: 1 }],
  unmatchedBsc: [
    bscCard("MEM-AA", "Aiva Arquette"),
    bscCard("MEM-BB", "Bo Bichette"),
    bscCard("MEM-CC", "Cy Cooper"),
  ],
  unmatchedSl: [slCard("S-1", "Sam Solo")],
  checklistOnly: [
    rowCard("2", "Aiva Arquette", 0),
    rowCard("3", "Bo Bichette", 1),
    rowCard("4", "Cy Cooper", 2),
  ],
  resolve: vi.fn(async (pairs: ChecklistPairRequest[]) => answered(pairs)),
});

const linkFirstRow = (card = "#MEM-AA Aiva Arquette") => {
  fireEvent.click(screen.getByLabelText("Select #2 Aiva Arquette"));
  fireEvent.click(screen.getByLabelText(`Link selected checklist row to ${card}`));
};

describe("a hand link moves both into Matched", () => {
  test("the pair leaves BSC only and Checklist only, joins Matched, and is not in Keeping", () => {
    mount(world());
    expect(heading("BSC only (3)")).toBeTruthy();
    expect(heading("Checklist only (3)")).toBeTruthy();
    expect(screen.getByText(/Matched \(1\)/)).toBeTruthy();
    expect(keepingToggle().textContent).toContain("Keeping (0)");

    linkFirstRow();

    expect(heading("BSC only (2)")).toBeTruthy();
    expect(heading("Checklist only (2)")).toBeTruthy();
    expect(screen.getByText(/Matched \(2\)/)).toBeTruthy();
    expect(keepingToggle().textContent).toContain("Keeping (0)");
    // The card and its row are gone from their lists…
    expect(screen.queryByLabelText("Select BSC card #MEM-AA Aiva Arquette")).toBeNull();
    expect(screen.queryByLabelText("Select #2 Aiva Arquette")).toBeNull();
    // …nothing "Linked to" is left behind, and nothing is on the shelf.
    expect(screen.queryByText(/^Linked to /)).toBeNull();
    expect(screen.queryByLabelText(/^Remove #MEM-AA/)).toBeNull();
  });

  test("Matched is left as it was (collapsed), and the row reads like any Matched row", () => {
    mount(world());
    linkFirstRow();
    // Not forced open.
    expect(screen.queryByLabelText(/^Collapse matched cards/)).toBeNull();
    expandMatched();
    expect(screen.getByRole("button", { name: "Edit name for #MEM-AA Aiva Arquette" })).toBeTruthy();
    expect(screen.getByText("Checklist: #2")).toBeTruthy();
    expect(
      screen.getByLabelText("Unlink card #MEM-AA Aiva Arquette from checklist row #2 Aiva Arquette"),
    ).toBeTruthy();
  });

  test("the numbers disagree (MEM-AA against 2): the picker is open, with the warning", () => {
    mount(world());
    linkFirstRow();
    expandMatched();
    expect(screen.getByText("Numbers differ")).toBeTruthy();
    expect(screen.getByRole("group", { name: "Number conflict on #MEM-AA" })).toBeTruthy();
    expect(
      screen.getByText("Sources disagree on the number. We picked one; check the card back."),
    ).toBeTruthy();
    expect(
      screen.getByRole("radio", { name: "#MEM-AA — use this number for #MEM-AA" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("radio", { name: "#2 · your checklist — use this number for #MEM-AA" }),
    ).toBeTruthy();
  });

  test("the footer counts the pair once", () => {
    mount(world());
    footer(1);
    linkFirstRow();
    footer(2);
  });

  test("a SportLots-only card moves the same way", () => {
    mount({
      ...world(),
      unmatchedSl: [slCard("S-1", "Sam Solo")],
      checklistOnly: [rowCard("9", "Sam Solo", 0)],
    });
    fireEvent.click(screen.getByLabelText("Select #9 Sam Solo"));
    fireEvent.click(screen.getByLabelText("Link selected checklist row to #S-1 Sam Solo"));
    expect(heading("SportLots only (0)")).toBeTruthy();
    expect(heading("Checklist only (0)")).toBeTruthy();
    expect(screen.getByText(/Matched \(2\)/)).toBeTruthy();
    expect(keepingToggle().textContent).toContain("Keeping (0)");
    expect(announcer().textContent).toContain("Moved to Matched.");
  });

  test("the live region says the card moved", () => {
    mount(world());
    linkFirstRow();
    expect(announcer().textContent).toBe(
      "Linked checklist row 2 to #MEM-AA Aiva Arquette. Moved to Matched. 2 rows left to link.",
    );
  });

  test("a pick on the hand link is saved: the card carries the number picked", async () => {
    const w = world();
    const { onConfirm } = mount(w);
    linkFirstRow();
    expandMatched();
    fireEvent.click(
      screen.getByRole("radio", { name: "#2 · your checklist — use this number for #MEM-AA" }),
    );
    expect(
      screen
        .getByRole("radio", { name: "#2 · your checklist — use this number for #MEM-AA" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    // The group keeps its name across the pick.
    expect(screen.getByRole("group", { name: "Number conflict on #MEM-AA" })).toBeTruthy();

    await confirm();
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    const cards = confirmed(onConfirm);
    // The Matched pair and the hand-linked card: two cards, one per card.
    expect(cards.map((c) => c.cardNumber)).toEqual(["1", "2"]);
    expect(w.resolve).toHaveBeenCalledTimes(1);
  });
});

describe("Unlink sends both back", () => {
  const unlink = () =>
    fireEvent.click(
      screen.getByLabelText("Unlink card #MEM-AA Aiva Arquette from checklist row #2 Aiva Arquette"),
    );

  test("the card returns to BSC only and the row to Checklist only, both unselected", () => {
    mount(world());
    linkFirstRow();
    expandMatched();
    unlink();

    expect(heading("BSC only (3)")).toBeTruthy();
    expect(heading("Checklist only (3)")).toBeTruthy();
    expect(screen.getByText(/Matched \(1\)/)).toBeTruthy();
    const card = screen.getByLabelText("Select BSC card #MEM-AA Aiva Arquette");
    const row = screen.getByLabelText("Select #2 Aiva Arquette");
    expect(card.getAttribute("aria-checked")).toBe("false");
    expect(row.getAttribute("aria-checked")).toBe("false");
    // Back in their places, in card-number order.
    const bscList = screen.getByRole("radiogroup", { name: "Pick a BSC card to link" });
    expect(
      within(bscList)
        .getAllByRole("radio")
        .map((r) => r.textContent),
    ).toEqual(["#MEM-AA Aiva Arquette", "#MEM-BB Bo Bichette", "#MEM-CC Cy Cooper"]);
    expect(screen.queryByText("Numbers differ")).toBeNull();
    footer(1);
  });

  test("the live region says where they went, and focus lands on the returned card", async () => {
    mount(world());
    linkFirstRow();
    expandMatched();
    unlink();
    expect(announcer().textContent).toBe(
      "Unlinked from #MEM-AA Aiva Arquette. Moved back to BSC only and Checklist only.",
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByLabelText("Select BSC card #MEM-AA Aiva Arquette"),
      ),
    );
  });

  test("a pick made on the link is dropped with it", async () => {
    const { onConfirm } = mount(world());
    linkFirstRow();
    expandMatched();
    fireEvent.click(
      screen.getByRole("radio", { name: "#2 · your checklist — use this number for #MEM-AA" }),
    );
    unlink();
    await confirm();
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(confirmed(onConfirm).map((c) => c.cardNumber)).toEqual(["1"]);
  });
});

describe("focus after a link", () => {
  test("goes to the next card in the list the operator linked from", async () => {
    mount(world());
    linkFirstRow();
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByLabelText("Select BSC card #MEM-BB Bo Bichette"),
      ),
    );
  });

  test("falls back to the list's filter when it was the last card", async () => {
    mount({
      ...world(),
      unmatchedBsc: [bscCard("MEM-AA", "Aiva Arquette")],
    });
    linkFirstRow();
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByLabelText("Filter BSC cards")),
    );
  });
});

describe("Keeping", () => {
  test("sits directly under Matched, above the BSC only and Checklist only lists", () => {
    mount(world());
    const keeping = keepingToggle();
    const bsc = heading("BSC only (3)");
    const checklist = heading("Checklist only (3)");
    const matched = screen.getByLabelText(/^(Expand|Collapse) matched cards/);
    const after = (a: Element, b: Element) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(after(matched, keeping)).toBe(true);
    expect(after(keeping, bsc)).toBe(true);
    expect(after(keeping, checklist)).toBe(true);
  });

  test("a card kept with Keep is a Matched-style row: title, tag, Remove; Remove sends it home", () => {
    mount(world());
    fireEvent.click(screen.getByLabelText("Keep #MEM-BB Bo Bichette as BSC-only"));
    expect(keepingToggle().textContent).toContain("Keeping (1)");
    expect(heading("BSC only (2)")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit name for #MEM-BB Bo Bichette" })).toBeTruthy();
    expect(screen.getByText("BSC")).toBeTruthy();
    footer(2);

    fireEvent.click(screen.getByLabelText("Remove #MEM-BB Bo Bichette from save list"));
    expect(keepingToggle().textContent).toContain("Keeping (0)");
    expect(heading("BSC only (3)")).toBeTruthy();
    footer(1);
  });

  test("Remove moves focus to the next Keeping row, else the one before, else the Keeping heading", async () => {
    mount(world());
    fireEvent.click(screen.getByLabelText("Keep #MEM-AA Aiva Arquette as BSC-only"));
    fireEvent.click(screen.getByLabelText("Keep #MEM-BB Bo Bichette as BSC-only"));
    fireEvent.click(screen.getByLabelText("Keep #MEM-CC Cy Cooper as BSC-only"));

    fireEvent.click(screen.getByLabelText("Remove #MEM-AA Aiva Arquette from save list"));
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Edit name for #MEM-BB Bo Bichette" }),
      ),
    );
    // The last one: the row before it.
    fireEvent.click(screen.getByLabelText("Remove #MEM-CC Cy Cooper from save list"));
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Edit name for #MEM-BB Bo Bichette" }),
      ),
    );
    // None left: the Keeping heading.
    fireEvent.click(screen.getByLabelText("Remove #MEM-BB Bo Bichette from save list"));
    await waitFor(() => expect(document.activeElement).toBe(keepingToggle()));
  });

  test("it folds away like Matched, with the count in its heading", () => {
    mount(world());
    fireEvent.click(screen.getByLabelText("Keep #MEM-BB Bo Bichette as BSC-only"));
    const toggle = keepingToggle();
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.textContent).toContain("Keeping (1)");
    expect(screen.queryByRole("button", { name: "Edit name for #MEM-BB Bo Bichette" })).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Edit name for #MEM-BB Bo Bichette" })).toBeTruthy();
  });

  test("its name is its words: the fold glyph is hidden from assistive tech (NEO-591)", () => {
    mount(world());
    const toggle = keepingToggle();
    const glyph = toggle.querySelector("span[aria-hidden='true']");
    expect(glyph?.textContent).toBe("▼");
    // The accessible name has no ▶/▼ in it, open or folded, and no extra label.
    expect(toggle.getAttribute("aria-label")).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.querySelector("span[aria-hidden='true']")?.textContent).toBe("▶");
    expect(screen.getByRole("button", { name: "Keeping (0)" })).toBe(toggle);
  });

  test("its title edits like Matched's, and the new name is saved", async () => {
    const { onConfirm } = mount(world());
    fireEvent.click(screen.getByLabelText("Keep #MEM-BB Bo Bichette as BSC-only"));
    fireEvent.click(screen.getByRole("button", { name: "Edit name for #MEM-BB Bo Bichette" }));
    const field = screen.getByRole("textbox", { name: /^Edit name for #MEM-BB/ });
    fireEvent.change(field, { target: { value: "Bo B." } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(screen.getByRole("button", { name: "Edit name for #MEM-BB Bo B." })).toBeTruthy();

    await confirm();
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(confirmed(onConfirm).map((c) => c.cardName)).toContain("Bo B.");
  });

  test("a kept checklist row is drawn the same, tagged, and Remove lists the row again", () => {
    mount(world());
    fireEvent.click(screen.getByLabelText("Keep #3 Bo Bichette as checklist-only"));
    expect(
      screen.getByRole("button", { name: "Edit name for checklist row #3 Bo Bichette" }),
    ).toBeTruthy();
    expect(screen.getByText("Checklist row")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Remove checklist row #3 Bo Bichette from save list"));
    expect(heading("Checklist only (3)")).toBeTruthy();
  });

  test("a card kept first and then linked leaves the shelf for Matched", () => {
    mount(world());
    fireEvent.click(screen.getByLabelText("Keep #MEM-AA Aiva Arquette as BSC-only"));
    fireEvent.click(screen.getByLabelText("Select #2 Aiva Arquette"));
    fireEvent.click(screen.getByLabelText("Link selected checklist row to #MEM-AA Aiva Arquette"));
    expect(keepingToggle().textContent).toContain("Keeping (0)");
    expect(screen.getByText(/Matched \(2\)/)).toBeTruthy();
    footer(2);
  });
});
