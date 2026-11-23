/**
 * NEO-345 — the checklist header's stored-leaf autograph prompt (the wizard step is retired, NEO-645).
 *
 * Every string is a placeholder for Jason's wording, so the tests read the
 * exported copy rather than restating it.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { ConvexError } from "convex/values";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";

vi.mock("../../convex/_generated/api", () => ({
  api: {
    autographFormat: { setAutographFormat: "autographFormat.setAutographFormat" },
  },
}));

const mockSetAutographFormat = vi.fn();
vi.mock("convex/react", () => ({
  useMutation: (ref: string) =>
    ref === "autographFormat.setAutographFormat" ? mockSetAutographFormat : vi.fn(),
}));

import {
  AUTOGRAPH_PROMPT_SAVING,
  AutographFormatPrompt,
  autographPromptLine,
  autographPromptSaved,
} from "./AutographFormatPrompt";
import { AUTOGRAPH_CHOICE_LABEL, type AutographFormat } from "./autograph-format";

const LEAF = "leaf-1" as unknown as Id<"selectorOptions">;

beforeEach(() => {
  vi.clearAllMocks();
  mockSetAutographFormat.mockResolvedValue(null);
});

describe("AutographFormatPrompt — a stored leaf", () => {
  function PromptHost({ count = 3 }: { count?: number }) {
    const [saved, setSaved] = useState<AutographFormat | undefined>(undefined);
    return (
      <AutographFormatPrompt
        selectorOptionId={LEAF}
        count={count}
        saved={saved}
        onSaved={setSaved}
      />
    );
  }

  it("says how many cards and offers the two answers as buttons", () => {
    render(<PromptHost count={3} />);
    expect(screen.getByText(autographPromptLine(3))).toBeTruthy();
    expect(screen.getByRole("group", { name: autographPromptLine(3) })).toBeTruthy();
    expect(screen.getByRole("button", { name: AUTOGRAPH_CHOICE_LABEL["On Card"] })).toBeTruthy();
    expect(screen.getByRole("button", { name: AUTOGRAPH_CHOICE_LABEL["Sticker/Label"] })).toBeTruthy();
  });

  it("writes the leaf's format, then says so in place with focus on the line", async () => {
    render(<PromptHost />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: AUTOGRAPH_CHOICE_LABEL["Sticker/Label"] }));
    });
    expect(mockSetAutographFormat).toHaveBeenCalledWith({
      selectorOptionId: LEAF,
      value: "Sticker/Label",
    });
    const status = await screen.findByRole("status");
    expect(status.textContent).toBe(autographPromptSaved("Sticker/Label"));
    await waitFor(() => expect(document.activeElement).toBe(status));
    expect(screen.queryByRole("button", { name: AUTOGRAPH_CHOICE_LABEL["On Card"] })).toBeNull();
  });

  it("a refusal shows the server's sentence and keeps both answers", async () => {
    mockSetAutographFormat.mockRejectedValueOnce(new ConvexError("That leaf has no cards."));
    render(<PromptHost />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: AUTOGRAPH_CHOICE_LABEL["On Card"] }));
    });
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("That leaf has no cards."));
    expect(screen.getByRole("button", { name: AUTOGRAPH_CHOICE_LABEL["On Card"] })).toBeTruthy();
  });

  it("refuses a second press while the first is in flight", async () => {
    let resolve: () => void = () => {};
    mockSetAutographFormat.mockReturnValueOnce(new Promise<void>((r) => (resolve = r)));
    render(<PromptHost />);
    const onCard = screen.getByRole("button", { name: AUTOGRAPH_CHOICE_LABEL["On Card"] });
    const sticker = screen.getByRole("button", { name: AUTOGRAPH_CHOICE_LABEL["Sticker/Label"] });
    await act(async () => {
      fireEvent.click(onCard);
    });
    expect(onCard.getAttribute("aria-busy")).toBe("true");
    expect(sticker.getAttribute("aria-disabled")).toBe("true");
    await act(async () => {
      fireEvent.click(sticker);
    });
    expect(mockSetAutographFormat).toHaveBeenCalledTimes(1);
    await act(async () => resolve());
  });
});

describe("AutographFormatPrompt — live regions and focus (a11y)", () => {
  function Host({ saved }: { saved?: AutographFormat }) {
    return (
      <AutographFormatPrompt selectorOptionId={LEAF} count={2} saved={saved} onSaved={vi.fn()} />
    );
  }

  it("the alert and the saving status are mounted before anything is pressed, empty", () => {
    render(<Host />);
    expect(screen.getByRole("alert").textContent).toBe("");
    const statuses = screen.getAllByRole("status");
    expect(statuses).toHaveLength(1);
    expect(statuses[0].textContent).toBe("");
  });

  it("says Saving… politely while the write is in flight", async () => {
    let resolve: () => void = () => {};
    mockSetAutographFormat.mockReturnValueOnce(new Promise<void>((r) => (resolve = r)));
    render(<Host />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: AUTOGRAPH_CHOICE_LABEL["On Card"] }));
    });
    expect(screen.getByRole("status").textContent).toBe(AUTOGRAPH_PROMPT_SAVING);
    await act(async () => resolve());
  });

  it("the buttons are described by the error while it shows, and only then", async () => {
    mockSetAutographFormat.mockRejectedValueOnce(new ConvexError("That leaf has no cards."));
    render(<Host />);
    const onCard = () => screen.getByRole("button", { name: AUTOGRAPH_CHOICE_LABEL["On Card"] });
    expect(onCard().getAttribute("aria-describedby")).toBeNull();
    await act(async () => {
      fireEvent.click(onCard());
    });
    const alert = screen.getByRole("alert");
    await waitFor(() => expect(alert.textContent).toBe("That leaf has no cards."));
    for (const format of ["On Card", "Sticker/Label"] as const) {
      const button = screen.getByRole("button", { name: AUTOGRAPH_CHOICE_LABEL[format] });
      expect(button.getAttribute("aria-describedby")).toBe(alert.id);
    }
  });

  it("the saved line takes focus when focus fell to the page", () => {
    (document.activeElement as HTMLElement | null)?.blur();
    render(<Host saved="On Card" />);
    expect(document.activeElement).toBe(screen.getByRole("status"));
  });

  it("the saved line never takes focus from a control the operator is on", () => {
    render(
      <>
        <button type="button">Somewhere else</button>
        <Host />
      </>,
    );
    const elsewhere = screen.getByRole("button", { name: "Somewhere else" });
    act(() => elsewhere.focus());
    // A remount of the saved line (another render of the host, a return to
    // the leaf) must leave focus where the operator put it.
    render(<Host saved="Sticker/Label" />);
    expect(document.activeElement).toBe(elsewhere);
  });
});
