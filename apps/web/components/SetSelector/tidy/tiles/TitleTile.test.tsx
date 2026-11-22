/**
 * NEO-645 callout 7 — "Listing title": pink and open over 80, blue when cut,
 * Regenerate, the inline set-name panel with its live preview, the variation
 * trim, and the purple notes.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../convex/_generated/api", () => ({
  api: {
    selectorOptions: { updateCard: "updateCard", previewListingTitle: "previewListingTitle" },
    tidyCards: { applySetNameToTitles: "applySetNameToTitles", applyVariation: "applyVariation" },
  },
}));
const mockUpdateCard = vi.fn();
const mockApplySetName = vi.fn();
const mockApplyVariation = vi.fn();
let previewResult: unknown;
vi.mock("convex/react", () => ({
  useMutation: (ref: string) =>
    ref === "updateCard" ? mockUpdateCard : ref === "applySetNameToTitles" ? mockApplySetName : ref === "applyVariation" ? mockApplyVariation : vi.fn(),
  useQuery: (ref: string) => (ref === "previewListingTitle" ? previewResult : undefined),
}));

import { AnsweredProvider } from "../answered";
import TitleTile from "./TitleTile";
import { WRAP_LABEL_CLASS } from "../TidyTile";
import { assessListingTitle } from "../../../../convex/features/generateListing";
import type { TidyAttention, TidyRow, TidyTileProps } from "../tile-types";

const LONG = "2024 Topps Chrome Update Aaron Judge #USC118 Refractor Rookie Card RC New York Yankees Baseball Auto";
// What the generator itself writes for `inputs` below, so no "Left out" note shows.
const SHORT = "2024 Topps Chrome Update Aaron Judge #USC118 RC Rookie";

const inputs = {
  cardNumber: "USC118",
  playerNames: ["Aaron Judge"],
  year: "2024",
  setName: "Topps Chrome Update",
  isRookie: true,
};

const none: TidyAttention = { level: "none", items: [] };
const attn = (...items: Array<Record<string, unknown>>): TidyAttention =>
  ({ level: "fix", items }) as unknown as TidyAttention;

const cardOf = (id: string, extra: Record<string, unknown> = {}) =>
  ({ _id: id, cardNumber: "USC118", cardName: "Aaron Judge", listingTitle: SHORT, attributes: [], ...extra }) as unknown as TidyRow;

function renderTile(
  row: TidyRow,
  attention: TidyAttention = none,
  leafCards: TidyRow[] = [row],
  onAnswered: () => void = () => {},
  context: TidyTileProps["context"] = undefined,
) {
  const props: TidyTileProps = {
    row,
    context,
    attention,
    leafId: "leaf-1" as never,
    sportId: undefined,
    leafCards,
    setName: "Topps Chrome Update",
  };
  return render(
    <AnsweredProvider value={onAnswered}>
      <TitleTile {...props} />
    </AnsweredProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdateCard.mockResolvedValue(null);
  mockApplySetName.mockResolvedValue({ openCardRetitled: true, scheduled: true });
  mockApplyVariation.mockResolvedValue({ applied: 1, skipped: 0 });
  previewResult = { title: SHORT, coreFits: true, dropped: [], inputs };
});

const titleField = () => screen.getByLabelText("Card title for #USC118") as HTMLTextAreaElement;

describe("TitleTile Left out to fit: a name still waiting is not left out", () => {
  const stored = "2024 Topps Chrome Update #USC118";
  const waitingInputs = { ...inputs, playerNames: ["Dave Stewart"], isRookie: false };

  it("lists the name a card prints that is not answered yet as nothing left out to fit", () => {
    previewResult = { title: stored, coreFits: true, dropped: [], inputs: waitingInputs };
    renderTile(cardOf("c1", { listingTitle: stored, pendingPlayerNames: ["Dave Stewart"] }));
    expect(screen.queryByText(/Left out to fit/)).toBeNull();
  });

  it("still lists a name that was answered and did not fit", () => {
    previewResult = { title: stored, coreFits: true, dropped: [], inputs: waitingInputs };
    renderTile(cardOf("c1", { listingTitle: stored }));
    expect(screen.getByText("Left out to fit: Dave Stewart")).toBeTruthy();
  });

  it("lists only the answered name when another is waiting", () => {
    previewResult = {
      title: stored,
      coreFits: true,
      dropped: [],
      inputs: { ...waitingInputs, playerNames: ["Dave Stewart", "Rickey Henderson"] },
    };
    renderTile(cardOf("c1", { listingTitle: stored, pendingPlayerNames: ["Dave Stewart"] }));
    expect(screen.getByText("Left out to fit: Rickey Henderson")).toBeTruthy();
  });
});

describe("TitleTile levels", () => {
  it("is plain when the title fits, showing it as text with Edit title", () => {
    renderTile(cardOf("c1"));
    expect(screen.getByRole("group", { name: "Listing title" }).getAttribute("data-tidy-level")).toBe("plain");
    expect(screen.getByText(SHORT)).toBeTruthy();
    expect(screen.queryByLabelText("Card title for #USC118")).toBeNull();
    expect(screen.getByRole("button", { name: "Edit title" })).toBeTruthy();
  });

  it("is pink and opens ready to edit when over 80", () => {
    renderTile(cardOf("c1", { listingTitle: LONG }), attn({ level: "fix", kind: "titleOverLimit" }));
    expect(screen.getByRole("group", { name: "Listing title" }).getAttribute("data-tidy-level")).toBe("fix");
    expect(titleField().value).toBe(LONG);
    expect(screen.getByText("Over the limit, so it opens ready to edit.")).toBeTruthy();
    expect(titleField().getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("button", { name: "Save title" }).getAttribute("aria-disabled")).toBe("true");
  });

  it("is blue when the generated title was cut", () => {
    renderTile(cardOf("c1"), { level: "check", items: [{ level: "check", kind: "titleCut", key: "cut:1" }] } as unknown as TidyAttention);
    expect(screen.getByRole("group", { name: "Listing title" }).getAttribute("data-tidy-level")).toBe("check");
  });
});

describe("TitleTile editing", () => {
  it("Enter saves a title that fits and closes the editor", async () => {
    renderTile(cardOf("c1"));
    fireEvent.click(screen.getByRole("button", { name: "Edit title" }));
    fireEvent.change(titleField(), { target: { value: "Judge RC" } });
    await act(async () => {
      fireEvent.keyDown(titleField(), { key: "Enter" });
    });
    expect(mockUpdateCard).toHaveBeenCalledWith({ id: "c1", listingTitle: "Judge RC" });
    expect(screen.queryByLabelText("Card title for #USC118")).toBeNull();
  });

  it("is named by its visible words: Edit title, not 'Edit card title'", () => {
    renderTile(cardOf("c1"));
    const edit = screen.getByRole("button", { name: "Edit title" });
    expect(edit.textContent).toBe("Edit title");
    expect(edit.getAttribute("aria-label")).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit card title" })).toBeNull();
  });

  it("a save from the editor is an answer: the walk moves focus on, not back to Edit title", async () => {
    const onAnswered = vi.fn();
    renderTile(cardOf("c1"), none, undefined, onAnswered);
    fireEvent.click(screen.getByRole("button", { name: "Edit title" }));
    fireEvent.change(titleField(), { target: { value: "Judge RC" } });
    titleField().focus();
    await act(async () => {
      fireEvent.keyDown(titleField(), { key: "Enter" });
    });
    await waitFor(() => expect(onAnswered).toHaveBeenCalledTimes(1));
  });

  it("a Regenerate that saves leaves focus on Regenerate and does not tell the walk", async () => {
    const onAnswered = vi.fn();
    previewResult = { title: "Judge RC rebuilt", coreFits: true, dropped: [], inputs };
    renderTile(cardOf("c1"), none, undefined, onAnswered);
    const regen = screen.getByRole("button", { name: "Regenerate card title" });
    regen.focus();
    await act(async () => {
      fireEvent.click(regen);
    });
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect(onAnswered).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(regen);
  });

  it("refuses to save over 80 and says so", async () => {
    renderTile(cardOf("c1", { listingTitle: LONG }), attn({ level: "fix", kind: "titleOverLimit" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save title" }));
    });
    expect(mockUpdateCard).not.toHaveBeenCalled();
  });

  it("typing it under the limit says 'Fits now. Enter saves it.'", () => {
    renderTile(cardOf("c1", { listingTitle: LONG }), attn({ level: "fix", kind: "titleOverLimit" }));
    fireEvent.change(titleField(), { target: { value: SHORT } });
    expect(screen.getByText("Fits now. Enter saves it.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save title" }).getAttribute("aria-disabled")).toBeNull();
  });

  it("shows a refused save inline and keeps the text", async () => {
    mockUpdateCard.mockRejectedValueOnce(new Error("x"));
    renderTile(cardOf("c1"));
    fireEvent.click(screen.getByRole("button", { name: "Edit title" }));
    fireEvent.change(titleField(), { target: { value: "Judge RC" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save title" }));
    });
    expect(screen.getAllByRole("alert").some((a) => a.textContent === "Didn't save, try again.")).toBe(true);
    expect(titleField().value).toBe("Judge RC");
  });

  it("Regenerate saves the rebuilt title and rebuilds the description", async () => {
    previewResult = { title: "Judge RC rebuilt", coreFits: true, dropped: [], inputs };
    renderTile(cardOf("c1"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Regenerate card title" }));
    });
    expect(mockUpdateCard).toHaveBeenCalledWith({ id: "c1", listingTitle: "Judge RC rebuilt" });
    expect(mockUpdateCard).toHaveBeenCalledWith({ id: "c1", regenerateDescription: true });
  });

  it("Regenerate over typed text asks once more first", () => {
    renderTile(cardOf("c1"));
    fireEvent.click(screen.getByRole("button", { name: "Edit title" }));
    fireEvent.change(titleField(), { target: { value: "My own wording" } });
    fireEvent.click(screen.getByRole("button", { name: "Regenerate card title" }));
    expect(screen.getByText("Regenerate again to replace the title you have typed.")).toBeTruthy();
    expect(mockUpdateCard).not.toHaveBeenCalled();
  });

  it("the Regenerate confirmation is a live region mounted from the start, empty until asked", () => {
    renderTile(cardOf("c1"));
    const statuses = screen.getAllByRole("status");
    const confirm = statuses.find((el) => el.className.includes("text-neon-blue-text"));
    expect(confirm?.textContent).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Edit title" }));
    fireEvent.change(titleField(), { target: { value: "My own wording" } });
    fireEvent.click(screen.getByRole("button", { name: "Regenerate card title" }));
    // The same element, now with words in it.
    expect(confirm?.textContent).toBe("Regenerate again to replace the title you have typed.");
    expect(confirm?.isConnected).toBe(true);
  });
});

describe("TitleTile set name for every card: what the field opens on", () => {
  const open = () => fireEvent.click(screen.getByRole("button", { name: "Shorten the set name for every card" }));

  it("opens on the set's stored short name when it has one", () => {
    previewResult = { title: SHORT, coreFits: true, dropped: [], inputs: { ...inputs, setShortName: "2024 TC Update" } };
    renderTile(cardOf("c1"));
    open();
    expect((screen.getByLabelText("Set name in titles") as HTMLInputElement).value).toBe("2024 TC Update");
  });

  it("opens on the description with the insert in it, never the set row's name alone", () => {
    previewResult = {
      title: SHORT,
      coreFits: true,
      dropped: [],
      inputs: { ...inputs, setName: "Score", year: "1996", insertName: "Dugout Collection Artists Proofs" },
    };
    renderTile(cardOf("c1"));
    open();
    expect((screen.getByLabelText("Set name in titles") as HTMLInputElement).value).toBe(
      "1996 Score Dugout Collection Artists Proofs",
    );
  });

  it("is capped at the 80 characters a set name in titles may hold", () => {
    previewResult = {
      title: SHORT,
      coreFits: true,
      dropped: [],
      inputs: { ...inputs, setName: "Score ".repeat(30).trim(), year: "1996" },
    };
    renderTile(cardOf("c1"));
    open();
    expect((screen.getByLabelText("Set name in titles") as HTMLInputElement).value.length).toBeLessThanOrEqual(80);
  });
});

describe("TitleTile set name for every card", () => {
  const open = () => fireEvent.click(screen.getByRole("button", { name: "Shorten the set name for every card" }));

  it("opens inline with the name titles use now (the builder's description), the old one, and a live preview", () => {
    const leaf = [cardOf("c1"), cardOf("c2"), cardOf("c3")];
    renderTile(leaf[0], none, leaf);
    open();
    const box = screen.getByLabelText("Set name in titles") as HTMLInputElement;
    // The year and set the titles open with, not the set row's bare name.
    expect(box.value).toBe("2024 Topps Chrome Update");
    expect(screen.getByText("Was “Topps Chrome Update”")).toBeTruthy();
    expect(screen.getByText("The title above shows this card with the new set name as you type.")).toBeTruthy();
    fireEvent.change(box, { target: { value: "TC Update" } });
    // The title above is the generator's answer for this card with the typed name.
    expect(screen.getByText(SHORT)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Shorten the set name for every card" }).getAttribute("aria-expanded")).toBe("true");
  });

  describe("over 80, the title box is the live preview", () => {
    const longInputs = {
      ...inputs,
      setName: "Topps Chrome Update Series Extended Edition Collection",
    };
    const overRow = () => cardOf("c1", { listingTitle: LONG });
    const overAttn = () => attn({ level: "fix", kind: "titleOverLimit" });
    const typeSetName = (v: string) =>
      fireEvent.change(screen.getByLabelText("Set name in titles"), { target: { value: v } });

    it("the box follows the typed set name instead of staying on the old title", () => {
      previewResult = { title: LONG, coreFits: false, dropped: [], inputs: longInputs };
      renderTile(overRow(), overAttn());
      expect(titleField().value).toBe(LONG);
      open();
      typeSetName("TC Update");
      const next = assessListingTitle({ ...longInputs, setShortName: "TC Update" }).title;
      expect(next).not.toBe(LONG);
      expect(next).toContain("TC Update");
      expect(titleField().value).toBe(next);
      // Short enough now: the over-limit line is gone and Save title is open.
      expect(screen.queryByText("Over the limit, so it opens ready to edit.")).toBeNull();
      expect(screen.getByRole("button", { name: "Save title" }).getAttribute("aria-disabled")).toBeNull();
      typeSetName("TC");
      expect(titleField().value).toBe(assessListingTitle({ ...longInputs, setShortName: "TC" }).title);
    });

    it("a title the operator typed is theirs: the preview stops replacing it", () => {
      previewResult = { title: LONG, coreFits: false, dropped: [], inputs: longInputs };
      renderTile(overRow(), overAttn());
      open();
      fireEvent.change(titleField(), { target: { value: "My own title" } });
      typeSetName("TC Update");
      expect(titleField().value).toBe("My own title");
    });

    it("closing the set name puts the box back on the title it had", () => {
      previewResult = { title: LONG, coreFits: false, dropped: [], inputs: longInputs };
      renderTile(overRow(), overAttn());
      open();
      typeSetName("TC Update");
      fireEvent.click(screen.getByRole("button", { name: "Cancel set name change" }));
      expect(titleField().value).toBe(LONG);
    });

    it("Save title saves what the box shows", async () => {
      previewResult = { title: LONG, coreFits: false, dropped: [], inputs: longInputs };
      renderTile(overRow(), overAttn());
      open();
      typeSetName("TC Update");
      const next = assessListingTitle({ ...longInputs, setShortName: "TC Update" }).title;
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Save title" }));
      });
      expect(mockUpdateCard).toHaveBeenCalledWith({ id: "c1", listingTitle: next });
    });
  });

  it("Save and apply to all N cards writes the name for this card's leaf", async () => {
    const leaf = [cardOf("c1"), cardOf("c2"), cardOf("c3")];
    renderTile(leaf[0], none, leaf);
    open();
    fireEvent.change(screen.getByLabelText("Set name in titles"), { target: { value: "TC Update" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save and apply to all 3 cards" }));
    });
    expect(mockApplySetName).toHaveBeenCalledWith({ leafId: "leaf-1", cardId: "c1", listingShortName: "TC Update" });
    expect(screen.getByText("Set name saved. The other cards' titles are updating.")).toBeTruthy();
    expect(screen.queryByLabelText("Set name in titles")).toBeNull();
  });

  it("an applied set name is an answer: the walk moves focus on, not back to Shorten", async () => {
    const onAnswered = vi.fn();
    const leaf = [cardOf("c1"), cardOf("c2")];
    renderTile(leaf[0], none, leaf, onAnswered);
    open();
    fireEvent.change(screen.getByLabelText("Set name in titles"), { target: { value: "TC Update" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save and apply to all 2 cards" }));
    });
    expect(onAnswered).toHaveBeenCalledTimes(1);
  });

  it("Cancel hands focus back to the button that opened the panel (not an answer)", async () => {
    const onAnswered = vi.fn();
    renderTile(cardOf("c1"), none, undefined, onAnswered);
    open();
    fireEvent.click(screen.getByRole("button", { name: "Cancel set name change" }));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Shorten the set name for every card" })),
    );
    expect(onAnswered).not.toHaveBeenCalled();
  });

  it("offers no apply while the box is empty, and Cancel closes it", () => {
    renderTile(cardOf("c1"));
    open();
    fireEvent.change(screen.getByLabelText("Set name in titles"), { target: { value: "  " } });
    expect(screen.queryByRole("button", { name: /Save and apply/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancel set name change" }));
    expect(screen.queryByLabelText("Set name in titles")).toBeNull();
  });

  it("Esc in the field closes it without saving", () => {
    renderTile(cardOf("c1"));
    open();
    fireEvent.keyDown(screen.getByLabelText("Set name in titles"), { key: "Escape" });
    expect(screen.queryByLabelText("Set name in titles")).toBeNull();
    expect(mockApplySetName).not.toHaveBeenCalled();
  });
});

describe("TitleTile variation", () => {
  const OVER = "A variation that runs well past the eBay item-specific limit of sixty-five characters";
  const attention = { level: "check", items: [{ level: "check", kind: "variationOverLimit", key: "var:1" }] } as unknown as TidyAttention;

  it("shows the trim editor only when the variation is over", () => {
    renderTile(cardOf("c1", { cardVariation: "Short" }));
    expect(screen.queryByLabelText("Trim the variation")).toBeNull();
    renderTile(cardOf("c2", { cardVariation: OVER }), attention);
    expect(screen.getByLabelText("Trim the variation")).toBeTruthy();
  });

  it("saves the trim, then offers the cards with the same variation", async () => {
    const mine = cardOf("c1", { cardVariation: OVER });
    const twin = cardOf("c2", { cardVariation: OVER });
    const other = cardOf("c3", { cardVariation: "Different" });
    renderTile(mine, attention, [mine, twin, other]);
    fireEvent.change(screen.getByLabelText("Trim the variation"), { target: { value: "Sunglasses" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save variation" })));
    expect(mockUpdateCard).toHaveBeenCalledWith({ id: "c1", cardVariation: "Sunglasses", regenerateListing: true });
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Apply to the 1 card with the same variation" })),
    );
    expect(mockApplyVariation).toHaveBeenCalledWith({ cardIds: ["c2"], from: OVER, to: "Sunglasses" });
    expect(screen.getByText("Applied to 1 card.")).toBeTruthy();
  });

  it("says 'Variation saved.' in a status line that was on the page empty", async () => {
    const mine = cardOf("c1", { cardVariation: OVER });
    renderTile(mine, attention);
    const trim = screen.getByLabelText("Trim the variation");
    const note = trim.parentElement?.querySelector('p[role="status"].text-neon-green-text');
    expect(note).toBeTruthy();
    expect(note?.textContent).toBe("");
    fireEvent.change(trim, { target: { value: "Sunglasses" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save variation" })));
    expect(note?.textContent).toBe("Variation saved.");
  });

  it("says how many variations the server changed and left alone", async () => {
    mockApplyVariation.mockResolvedValueOnce({ applied: 1, skipped: 1 });
    const mine = cardOf("c1", { cardVariation: OVER });
    renderTile(mine, attention, [mine, cardOf("c2", { cardVariation: OVER }), cardOf("c3", { cardVariation: OVER })]);
    fireEvent.change(screen.getByLabelText("Trim the variation"), { target: { value: "Sunglasses" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save variation" })));
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Apply to the 2 cards with the same variation" })),
    );
    expect(screen.getByText("Applied to 1 card. 1 left as it was.")).toBeTruthy();
  });
});

describe("TitleTile variation: offered for a variation over the cap only", () => {
  // 63 characters: under the 65 cap, so the aspect rule never raises it.
  const LONG_FITS = "Image Variation; Jersey half on, wearing headphones and bandana";
  const over = attn({ level: "fix", kind: "titleOverLimit" });
  const cut = { level: "check", items: [{ level: "check", kind: "titleCut", key: "cut:1" }] } as unknown as TidyAttention;

  it("is not offered for a long variation on an over-80 title, or on a cut one", () => {
    expect(LONG_FITS.length).toBeLessThanOrEqual(65);
    renderTile(cardOf("c1", { listingTitle: LONG, cardVariation: LONG_FITS }), over);
    expect(screen.queryByLabelText("Trim the variation")).toBeNull();
    expect(screen.getByRole("button", { name: "Shorten the set name for every card" })).toBeTruthy();
    cleanup();
    renderTile(cardOf("c2", { cardVariation: LONG_FITS }), cut);
    expect(screen.queryByLabelText("Trim the variation")).toBeNull();
  });

  it("is not offered for a short variation, or when the title is fine", () => {
    renderTile(cardOf("c1", { listingTitle: LONG, cardVariation: "Image Variation" }), over);
    expect(screen.queryByLabelText("Trim the variation")).toBeNull();
    cleanup();
    renderTile(cardOf("c2", { cardVariation: LONG_FITS }));
    expect(screen.queryByLabelText("Trim the variation")).toBeNull();
  });

  it("is offered beside the over-80 title once the variation itself is over the cap", () => {
    const variationOver = { level: "check", kind: "variationOverLimit", length: 90, key: "var:1" };
    renderTile(cardOf("c1", { listingTitle: LONG, cardVariation: "x".repeat(90) }), attn({ level: "fix", kind: "titleOverLimit" }, variationOver));
    expect(screen.getByLabelText("Trim the variation")).toBeTruthy();
  });
});

describe("TitleTile purple notes", () => {
  it("says the numbers didn't match, from the stored source numbers", () => {
    renderTile(cardOf("c1", { sourceNumbers: { bsc: "USC118", sportlots: "118" } }));
    expect(screen.getByRole("note").textContent).toBe("Numbers didn't match: BSC USC118, SportLots 118");
  });

  it("says nothing when every source agrees", () => {
    renderTile(cardOf("c1", { sourceNumbers: { bsc: "USC118", checklist: "USC118" } }));
    expect(screen.queryByRole("note")).toBeNull();
  });
});

describe("TitleTile words and wrapping (NEO-645 audit)", () => {
  const cut = { level: "check", items: [{ level: "check", kind: "titleCut", key: "cut:1" }] } as unknown as TidyAttention;

  it("says 'Auto title was cut short. Rewrite it.' with a full stop, never a dash, when nothing is named as left out", () => {
    renderTile(cardOf("c1"), cut);
    expect(screen.getByText("Auto title was cut short. Rewrite it.")).toBeTruthy();
    expect(screen.queryByText(/—/)).toBeNull();
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("'Left out to fit' is the purple note whether or not the title was cut", () => {
    previewResult = { title: SHORT, coreFits: true, dropped: [], inputs: { ...inputs, teamNames: ["Seattle Mariners"] } };
    const { unmount } = renderTile(cardOf("c1"), cut);
    const cutNote = screen.getByRole("note");
    expect(cutNote.textContent).toBe("Left out to fit: Seattle Mariners");
    expect(cutNote.className).toContain("text-neon-purple-text");
    // With the note naming what went, the generic sentence is not said too.
    expect(screen.queryByText(/Auto title was cut short/)).toBeNull();
    unmount();

    renderTile(cardOf("c2"));
    const plainNote = screen.getByRole("note");
    expect(plainNote.textContent).toBe("Left out to fit: Seattle Mariners");
    expect(plainNote.className).toBe(cutNote.className);
  });

  it("the long 'Shorten the set name for every card' button wraps inside itself", () => {
    renderTile(cardOf("c1"));
    const shorten = screen.getByRole("button", { name: "Shorten the set name for every card" });
    for (const token of WRAP_LABEL_CLASS.split(" ")) expect(shorten.className).toContain(token);
  });

  it("Regenerate's name has no dash", () => {
    renderTile(cardOf("c1"));
    expect(screen.getByRole("button", { name: "Regenerate card title" })).toBeTruthy();
  });

  it("the set-name panel's edge is the strong rule", () => {
    renderTile(cardOf("c1"));
    fireEvent.click(screen.getByRole("button", { name: "Shorten the set name for every card" }));
    const panel = screen.getByLabelText("Set name in titles").closest("div")!;
    expect(panel.className).toContain("border-rule-strong");
  });
});
