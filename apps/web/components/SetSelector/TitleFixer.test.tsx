/**
 * NEO-101 — `TitleFixer`, the attention-walker fixer for the three
 * title-shaped kinds.
 *
 * The behaviours worth pinning are the ones the locked fixer contract makes
 * possible but does not enforce:
 *
 *   1. it reads ALL of the card's items, not just the one that routed to it —
 *      a card flagged twice must be asked once;
 *   2. it writes only the fields it showed, so it cannot stomp a field it never
 *      asked about;
 *   3. it calls `onSaved()` only after the write lands, because the walker
 *      counts that call as "fixed" and advances on it;
 *   4. over the cap it refuses, in a way that a keyboard user can still reach
 *      the reason for.
 *
 * `convex/react` is module-mocked and routed by the (string-mocked) reference,
 * mirroring `CardAttentionWalker.test.tsx`.
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConvexError } from "convex/values";
import type { Id } from "../../convex/_generated/dataModel";

vi.mock("../../convex/_generated/api", () => ({
  api: {
    selectorOptions: {
      updateCard: "updateCard",
      previewListingTitle: "previewListingTitle",
    },
  },
}));

const mockUpdateCard = vi.fn();
let previewResult: unknown;

vi.mock("convex/react", () => ({
  useMutation: (ref: string) => (ref === "updateCard" ? mockUpdateCard : vi.fn()),
  useQuery: (ref: string, args: unknown) =>
    ref === "previewListingTitle" && args !== "skip" ? previewResult : undefined,
}));

import TitleFixer, {
  FITS_NOW,
  TOO_LONG,
  TOSS_TYPED_CONFIRM,
  TOSS_TYPED_TITLE,
} from "./TitleFixer";
import {
  useClosesForSetNameInTitles,
  useSetNameInTitlesTarget,
} from "./set-name-in-titles-jump";
import type { AttentionItem } from "./card-attention";
import type { CardChecklistRow } from "./cardAttentionRegistry";

const CARD_ID = "card-1" as unknown as Id<"cardChecklist">;

function makeRow(overrides: Partial<CardChecklistRow> = {}): CardChecklistRow {
  return {
    _id: CARD_ID,
    cardNumber: "300b",
    cardName: "Julio Rodriguez",
    listingTitle: "2024 Topps Chrome Julio Rodriguez #300b",
    ...overrides,
  };
}

function renderFixer(items: AttentionItem[], row = makeRow()) {
  const onSaved = vi.fn();
  const onSkip = vi.fn();
  render(<TitleFixer row={row} items={items} onSaved={onSaved} onSkip={onSkip} />);
  return { onSaved, onSkip };
}

const overLimit = (length: number): AttentionItem =>
  ({ kind: "titleOverLimit", length }) as AttentionItem;
const truncated = (): AttentionItem => ({ kind: "titleTruncated" }) as AttentionItem;
const aspectOver = (length: number): AttentionItem =>
  ({
    kind: "aspectValueOverLimit",
    field: "cardVariation",
    length,
  }) as AttentionItem;

const titleField = () =>
  screen.getByLabelText("Card title for #300b") as HTMLTextAreaElement;
const saveButton = () => screen.getByRole("button", { name: /^Save/ });

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdateCard.mockResolvedValue(undefined);
  previewResult = {
    title: "2024 Topps Chrome Julio Rodriguez #300b",
    coreFits: false,
    dropped: ["SP"],
    inputs: {
      cardNumber: "300b",
      playerNames: ["Julio Rodriguez"],
      year: "2024",
      setName: "Topps Chrome",
      teamNames: ["Seattle Mariners"],
      sport: "Baseball",
      shortPrint: "SP",
    },
  };
});

describe("TitleFixer (NEO-101)", () => {
  it("anchors on the card number and states every reason the card was flagged", () => {
    renderFixer([truncated(), aspectOver(70)]);

    const heading = screen.getByRole("heading", { level: 3 });
    expect(heading.textContent).toContain("#300b");
    expect(heading.textContent).toContain("Julio Rodriguez");
    expect(screen.getByText("auto-generated title was cut short")).toBeTruthy();
    expect(screen.getByText("variation text is over the 65-character limit")).toBeTruthy();
  });

  it("NEO-535: an over-cap card is not also called cut short — the longer problem speaks for both", () => {
    renderFixer([overLimit(84), truncated()], makeRow({ listingTitle: "z".repeat(84) }));

    expect(screen.getByText("title is over the 80-character limit")).toBeTruthy();
    expect(screen.queryByText("auto-generated title was cut short")).toBeNull();
    // One message under the field, not three: no "cut short" note and no
    // "Left out to fit" while the title is over the cap. On arrival it is a
    // polite status (the field's description reads it), never an alert.
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getAllByRole("status").filter((n) => n.textContent === TOO_LONG)).toHaveLength(1);
    expect(screen.queryByText(/cut short — rewrite it/)).toBeNull();
    expect(screen.queryByText(/^Left out to fit/)).toBeNull();
  });

  it("pre-fills the stored title and focuses it, so the operator can just type", async () => {
    renderFixer([truncated()], makeRow({ listingTitle: "2024 Topps Chrome #300b" }));

    expect(titleField().value).toBe("2024 Topps Chrome #300b");
    await waitFor(() => expect(document.activeElement).toBe(titleField()));
  });

  it("holds a whole 72/80 auto-generated title, and fills whatever width the dialog gives it", () => {
    /**
     * NEO-271 — the ticket's own case: a 72-character auto-generated title
     * with the meter reading `72/80`.
     *
     * Two things are pinned, and neither of them is a pixel (happy-dom
     * computes no layout): the field holds the WHOLE value — nothing caps or
     * clips it on the way in, which is why there is deliberately no
     * `maxLength` on the input — and it is `w-full`, so the width the walker's
     * chrome reserves for 80 characters actually reaches the field rather than
     * stopping at some intrinsic input size. The reserved width itself, and
     * the font measurement behind it, are pinned in
     * CardAttentionWalker.test.tsx, where that chrome lives.
     */
    const title = "2026 Bowman Chrome Prospects #BCP-100 Wyatt Langford Orange Wave Auto SP";
    expect(title).toHaveLength(72);
    renderFixer([truncated()], makeRow({ listingTitle: title }));

    expect(titleField().value).toBe(title);
    expect(titleField().hasAttribute("maxLength")).toBe(false);
    expect(titleField().className).toContain("w-full");
    expect(screen.getByText("72/80")).toBeTruthy();
    // 72 is past the search-clip band but inside the cap, so it warns and Save
    // stays live — there is nothing to "fix" except seeing the whole value.
    expect(screen.queryByRole("alert")).toBeNull();
    expect(saveButton().getAttribute("aria-disabled")).toBeNull();
  });

  it("refuses to save over the cap and keeps the reason reachable", async () => {
    renderFixer([overLimit(84)], makeRow({ listingTitle: "z".repeat(84) }));

    expect(screen.getByText("84/80")).toBeTruthy();
    const alert = screen.getByText(TOO_LONG);
    expect(alert.textContent).toBe(
      "Too long to list as-is. Trim it here, or shorten the set name for the whole row.",
    );
    expect(titleField().getAttribute("aria-describedby")).toContain(alert.id);

    const save = saveButton();
    expect(save.getAttribute("aria-disabled")).toBe("true");
    expect(save.hasAttribute("disabled")).toBe(false);
    expect(save.getAttribute("aria-describedby")).toBe(alert.id);

    await act(async () => {
      fireEvent.click(save);
    });
    expect(mockUpdateCard).not.toHaveBeenCalled();
  });

  it("writes the trimmed title, then reports the fix so the walker advances", async () => {
    const { onSaved } = renderFixer([overLimit(84)]);

    fireEvent.change(titleField(), { target: { value: "  2024 Topps Chrome #300b  " } });
    await act(async () => {
      fireEvent.click(saveButton());
    });

    await waitFor(() =>
      expect(mockUpdateCard).toHaveBeenCalledWith({
        id: CARD_ID,
        listingTitle: "2024 Topps Chrome #300b",
      }),
    );
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("saves on Enter in the title field", async () => {
    const { onSaved } = renderFixer([overLimit(84)]);

    fireEvent.change(titleField(), { target: { value: "2024 Topps Chrome #300b" } });
    await act(async () => {
      fireEvent.keyDown(titleField(), { key: "Enter" });
    });

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(mockUpdateCard.mock.calls[0][0].listingTitle).toBe(
      "2024 Topps Chrome #300b",
    );
  });

  it("does not save on Enter while the title is over the cap", async () => {
    const { onSaved } = renderFixer([overLimit(84)], makeRow({ listingTitle: "z".repeat(84) }));

    await act(async () => {
      fireEvent.keyDown(titleField(), { key: "Enter" });
    });

    expect(mockUpdateCard).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("NEO-535: the title is a wrapping field that grows, a pasted line break reads as a space, and Enter saves", async () => {
    const { onSaved } = renderFixer([truncated()]);
    const field = titleField();
    expect(field.tagName).toBe("TEXTAREA");
    expect(field.getAttribute("rows")).toBe("2");
    expect(field.className).toContain("[field-sizing:content]");

    fireEvent.change(field, { target: { value: "2024 Topps Chrome\nJulio Rodriguez #300b" } });
    expect(field.value).toBe("2024 Topps Chrome Julio Rodriguez #300b");

    await act(async () => {
      fireEvent.keyDown(field, { key: "Enter" });
    });
    await waitFor(() =>
      expect(mockUpdateCard).toHaveBeenCalledWith({
        id: CARD_ID,
        listingTitle: "2024 Topps Chrome Julio Rodriguez #300b",
      }),
    );
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("shows the variation field only when the variation is what is over the limit", () => {
    renderFixer([overLimit(84)]);
    expect(screen.queryByLabelText("Card variation for #300b")).toBeNull();
  });

  it("edits and writes the variation when that is the flagged field", async () => {
    const { onSaved } = renderFixer(
      [aspectOver(70)],
      makeRow({ listingTitle: "2024 Topps Chrome #300b", cardVariation: "v".repeat(70) }),
    );

    const variation = screen.getByLabelText(
      "Card variation for #300b",
    ) as HTMLInputElement;
    expect(variation.value.length).toBe(70);
    expect(screen.getByText("70/65")).toBeTruthy();
    // Warn-only: an over-length variation must not block the write.
    expect(saveButton().getAttribute("aria-disabled")).toBeNull();

    fireEvent.change(variation, { target: { value: " Image Variation " } });
    await act(async () => {
      fireEvent.click(saveButton());
    });

    await waitFor(() =>
      expect(mockUpdateCard).toHaveBeenCalledWith({
        id: CARD_ID,
        listingTitle: "2024 Topps Chrome #300b",
        cardVariation: "Image Variation",
      }),
    );
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("Regenerate rebuilds the title and shows what it was built from", async () => {
    renderFixer([truncated()], makeRow({ listingTitle: "2024 Topps #300b" }));

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Regenerate card title"));
    });

    await waitFor(() =>
      expect(titleField().value).toBe("2024 Topps Chrome Julio Rodriguez #300b"),
    );
    const chips = screen.getByLabelText("Title built from");
    expect(chips.textContent).toContain("Topps Chrome");
    expect(chips.textContent).toContain("#300b");
    expect(chips.textContent).toContain("Seattle Mariners");
    expect(chips.textContent).toContain("Baseball");
    expect(chips.querySelector("a")).toBeNull();
    // NEO-535: read from the field's text against the card's facts.
    expect(screen.getByText("Left out to fit: Seattle Mariners, SP")).toBeTruthy();
  });

  it("NEO-535: 'Left out to fit' follows the field — retyping a cut word takes it off", async () => {
    renderFixer([truncated()], makeRow({ listingTitle: "2024 Topps #300b" }));
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Regenerate card title"));
    });
    await waitFor(() =>
      expect(titleField().value).toBe("2024 Topps Chrome Julio Rodriguez #300b"),
    );
    fireEvent.change(titleField(), {
      target: { value: "2024 Topps Chrome Julio Rodriguez #300b SP Seattle Mariners" },
    });
    expect(screen.queryByText(/^Left out to fit/)).toBeNull();
    fireEvent.change(titleField(), { target: { value: "2024 Topps Chrome Rodriguez #300b SP" } });
    expect(screen.getByText("Left out to fit: Seattle Mariners, Julio")).toBeTruthy();
  });

  it("renders no team or sport chip when the preview carries neither", async () => {
    previewResult = {
      title: "2024 Topps Chrome Julio Rodriguez #300b",
      coreFits: true,
      dropped: [],
      inputs: { cardNumber: "300b", playerNames: ["Julio Rodriguez"], year: "2024" },
    };
    renderFixer([truncated()], makeRow({ listingTitle: "2024 Topps #300b" }));

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Regenerate card title"));
    });

    const chips = await screen.findByLabelText("Title built from");
    expect(chips.textContent).toContain("Julio Rodriguez");
    expect(chips.textContent).not.toContain("Team");
    expect(chips.textContent).not.toContain("Sport");
    expect(chips.textContent).not.toContain("undefined");
  });

  it("surfaces a refused write inline, and does not report a fix that did not land", async () => {
    mockUpdateCard.mockRejectedValueOnce(
      new ConvexError("Listing title is 84 characters; the limit is 80."),
    );
    const { onSaved } = renderFixer([overLimit(84)]);

    fireEvent.change(titleField(), { target: { value: "2024 Topps Chrome #300b" } });
    await act(async () => {
      fireEvent.click(saveButton());
    });

    await waitFor(() =>
      expect(
        screen.getByText("Listing title is 84 characters; the limit is 80."),
      ).toBeTruthy(),
    );
    expect(onSaved).not.toHaveBeenCalled();
  });

  describe("NEO-535 (a11y): the over-cap line is always mounted", () => {
    const line = () => document.getElementById(
      titleField().getAttribute("aria-describedby")!.split(" ").find((id) => id.endsWith("-title-limit"))!,
    );

    it("is an alert only when a keystroke takes the title over, and says when it fits again", () => {
      renderFixer([truncated()], makeRow({ listingTitle: "2024 Topps Chrome #300b" }));
      const node = document.querySelector('[id$="-title-limit"]') as HTMLElement;
      expect(node).not.toBeNull();
      expect(node.textContent).toBe("");
      expect(node.getAttribute("role")).toBe("status");

      fireEvent.change(titleField(), { target: { value: "x".repeat(81) } });
      expect(line()).toBe(node);
      expect(node.getAttribute("role")).toBe("alert");
      expect(node.textContent).toBe(TOO_LONG);

      fireEvent.change(titleField(), { target: { value: "x".repeat(80) } });
      expect(document.querySelector('[id$="-title-limit"]')).toBe(node);
      expect(node.getAttribute("role")).toBe("status");
      expect(node.textContent).toBe(FITS_NOW);
    });

    it("a card that arrives over the cap is said politely, then fits once trimmed", () => {
      renderFixer([overLimit(84)], makeRow({ listingTitle: "z".repeat(84) }));
      const node = line()!;
      expect(node.getAttribute("role")).toBe("status");
      expect(node.textContent).toBe(TOO_LONG);
      fireEvent.change(titleField(), { target: { value: "z".repeat(70) } });
      expect(document.querySelector('[id$="-title-limit"]')).toBe(node);
      expect(node.textContent).toBe(FITS_NOW);
    });

    it("the title field says Enter saves", () => {
      renderFixer([truncated()]);
      const ids = titleField().getAttribute("aria-describedby")!.split(" ");
      const said = ids.map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
      expect(said).toContain("Enter saves the title on this card.");
    });
  });

  describe("NEO-535: the way to the row's Set name in titles", () => {
    function Target({ open }: { open: () => void }) {
      useSetNameInTitlesTarget(open);
      return null;
    }
    function Closer({ close }: { close: () => void }) {
      useClosesForSetNameInTitles(close);
      return null;
    }

    it("is offered on an over-cap title when the row's box is on screen, and goes there", () => {
      const open = vi.fn();
      const close = vi.fn();
      render(
        <>
          <Target open={open} />
          <Closer close={close} />
        </>,
      );
      renderFixer([overLimit(84)], makeRow({ listingTitle: "z".repeat(84) }));

      expect(screen.getByText(/Set name hogging it\?/)).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Trim Set name in titles" }));
      // The dialog in front closes, then the box opens.
      expect(close).toHaveBeenCalledTimes(1);
      expect(open).toHaveBeenCalledTimes(1);
    });

    it("asks before tossing a typed title, and Cancel stays put", () => {
      const open = vi.fn();
      const close = vi.fn();
      render(
        <>
          <Target open={open} />
          <Closer close={close} />
        </>,
      );
      renderFixer([overLimit(84)], makeRow({ listingTitle: "z".repeat(84) }));
      fireEvent.change(titleField(), { target: { value: "y".repeat(85) } });

      fireEvent.click(screen.getByRole("button", { name: "Trim Set name in titles" }));
      expect(screen.getByRole("dialog", { name: TOSS_TYPED_TITLE })).toBeTruthy();
      expect(open).not.toHaveBeenCalled();
      expect(close).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(screen.queryByRole("dialog", { name: TOSS_TYPED_TITLE })).toBeNull();
      expect(titleField().value).toBe("y".repeat(85));
      expect(open).not.toHaveBeenCalled();
    });

    it("Escape in the toss question answers it, and never reaches the walker", () => {
      const walkerKeys = vi.fn();
      render(<Target open={vi.fn()} />);
      const onSaved = vi.fn();
      render(
        <div onKeyDown={(e) => walkerKeys(e.key)}>
          <TitleFixer
            row={makeRow({ listingTitle: "z".repeat(84) })}
            items={[overLimit(84)]}
            onSaved={onSaved}
            onSkip={vi.fn()}
          />
        </div>,
      );
      fireEvent.change(titleField(), { target: { value: "y".repeat(85) } });
      fireEvent.click(screen.getByRole("button", { name: "Trim Set name in titles" }));
      const question = screen.getByRole("dialog", { name: TOSS_TYPED_TITLE });
      fireEvent.keyDown(question, { key: "Escape" });
      expect(screen.queryByRole("dialog", { name: TOSS_TYPED_TITLE })).toBeNull();
      expect(walkerKeys).not.toHaveBeenCalledWith("Escape");
    });

    it("tossing the typed title goes on to the row's box", () => {
      const open = vi.fn();
      const close = vi.fn();
      render(
        <>
          <Target open={open} />
          <Closer close={close} />
        </>,
      );
      renderFixer([overLimit(84)], makeRow({ listingTitle: "z".repeat(84) }));
      fireEvent.change(titleField(), { target: { value: "y".repeat(85) } });
      fireEvent.click(screen.getByRole("button", { name: "Trim Set name in titles" }));
      fireEvent.click(screen.getByRole("button", { name: TOSS_TYPED_CONFIRM }));
      expect(close).toHaveBeenCalledTimes(1);
      expect(open).toHaveBeenCalledTimes(1);
      expect(mockUpdateCard).not.toHaveBeenCalled();
    });

    it("is never a dead end: no box on screen, no door", () => {
      renderFixer([overLimit(84)], makeRow({ listingTitle: "z".repeat(84) }));
      expect(screen.queryByRole("button", { name: "Trim Set name in titles" })).toBeNull();
    });

    it("is not offered on a title that fits", () => {
      render(<Target open={vi.fn()} />);
      renderFixer([truncated()]);
      expect(screen.queryByRole("button", { name: "Trim Set name in titles" })).toBeNull();
    });
  });
});
