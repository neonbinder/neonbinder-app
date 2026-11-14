/**
 * CardDetailPanel — regression coverage.
 *
 * ## NEO-216 (2026-09-04): the drawer autosaves per field
 *
 * The panel used to seed a draft from the `card` prop and write the whole
 * draft back on Save. `card` is a row out of the LIVE `getCardChecklist`
 * query, so a full-replacement Save could (and did) overwrite fields the
 * server had patched underneath the draft — a `teamOnCardIds: []` sent a
 * moment after the BSC team queue filled it in was permanent, because that
 * queue never re-enqueues a card it has stamped.
 *
 * There is now no Save button, no draft, no `dirty`, and no discard bar. Each
 * control writes only its own field, immediately. What this file locks in:
 *
 *   1. No Save button is rendered, and closing never offers to discard.
 *   2. Editing the name and blurring calls `updateCard({ id, cardName })` —
 *      and NOTHING else. An untouched field never appears in a payload.
 *   3. **NEO-36 pin**: an external patch arriving while the name field is
 *      focused with typed text neither loses nor resets that text, the picker
 *      shows the newly-arrived team, and the commit sends the typed value.
 *   4. The attribute chips write `attributes` + the two derived booleans, and
 *      RC drives `isRookie` in BOTH directions (NEO-217 C — the old
 *      `|| card.isRookie` made RC a one-way switch).
 *   5. Print run: "99" → `printRun: 99`; cleared → `printRun: null`
 *      (NEO-217 B); a non-integer is refused inline and sends nothing.
 *   6. A rejected commit shows an inline error and keeps the typed value.
 *   7. Teams / players write their own array on change and read the live row.
 *
 * ## Still locked in from NEO-71-74
 *
 *   - The Autographed control renders as two toggle pills ("Auto (On Card)" /
 *     "Auto (Sticker)"), NOT a <select> or text input, and clicking a pill
 *     calls `setCardFeature` — never `updateCard`.
 *   - The Players picker renders with the card's playerIds.
 *   - The Variation field's label reads "Variation" (not "Variation /
 *     parallel").
 *
 * --- Mocking strategy ---
 * convex/react's useMutation is module-mocked, routed by the (string-mocked)
 * mutation reference (mirrors CardFeaturesEditor.test.tsx / BaseMappingForm
 * .test.tsx). `./TeamPicker` and `./PlayerPicker` are mocked to simple stub
 * components — both already have their own dedicated test files
 * (TeamPicker.test.tsx, PlayerPicker.test.tsx) covering their internal
 * query/typeahead behavior, so this file only needs to verify CardDetailPanel
 * wires their value/onChange into the right single-field write, not
 * re-exercise their popovers.
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Module mocks — declared before the component import
// ---------------------------------------------------------------------------

vi.mock("../../convex/_generated/api", () => ({
  api: {
    // NEO-254: the panel resolves canonical names for its "As printed" note.
    players: { getManyByIds: "players.getManyByIds" },
    selectorOptions: {
      updateCard: "updateCard",
      setCardFeature: "setCardFeature",
      // NEO-189: the "Variation of" control's mutation + the sibling lookup it
      // resolves a typed card number against.
      setCardVariationParent: "setCardVariationParent",
      getCardChecklist: "getCardChecklist",
    },
    // NEO-528: the Also pictured field's writer, called through useConvex().
    cardSecondaryPlayers: {
      setSecondaryPlayers: "cardSecondaryPlayers.setSecondaryPlayers",
    },
  },
}));

const mockUpdateCard = vi.fn();
const mockSetCardFeature = vi.fn();
const mockSetVariationParent = vi.fn();
// The checklist the panel resolves a typed card number against.
const mockSiblingCards = [
  { _id: "card-1", cardNumber: "1", cardName: "Fernando Tatis Jr." },
  { _id: "card-2", cardNumber: "2", cardName: "Roberto Osuna" },
];

/** NEO-528 — `useConvex().mutation`, the Also pictured field's one write. */
const mockConvexMutation = vi.fn();

vi.mock("convex/react", () => ({
  useConvex: () => ({ mutation: mockConvexMutation }),
  useMutation: (ref: string) => {
    if (ref === "updateCard") return mockUpdateCard;
    if (ref === "setCardFeature") return mockSetCardFeature;
    if (ref === "setCardVariationParent") return mockSetVariationParent;
    return vi.fn();
  },
  useQuery: (ref: string) =>
    ref === "getCardChecklist"
      ? mockSiblingCards
      : // NEO-254: canonical names for the "As printed" note.
        ref === "players.getManyByIds"
        ? currentPlayerRows
        : undefined,
}));

/** NEO-254 — rows served to `players.getManyByIds`. */
let currentPlayerRows: Array<{ _id: string; name: string }> | undefined;

vi.mock("./TeamPicker", () => ({
  default: ({
    value,
    onChange,
    contextOptionId,
    noTeam,
  }: {
    value: string[];
    onChange: (next: string[]) => void;
    contextOptionId?: string;
    noTeam?: { value: boolean; onChange: (next: boolean) => void; label?: string };
  }) => (
    <div aria-label="Team picker (stub)" data-context-option-id={contextOptionId ?? ""}>
      <span>Teams: {value.join(",")}</span>
      <button onClick={() => onChange(noTeam?.value ? ["team-new"] : [...value, "team-new"])}>
        Stub add team
      </button>
      {/* NEO-556 — the real toggle's contract: press → onChange(!value). */}
      {noTeam && (
        <button
          type="button"
          aria-label={noTeam.label}
          aria-pressed={noTeam.value}
          onClick={() => noTeam.onChange(!noTeam.value)}
        >
          No Team
        </button>
      )}
    </div>
  ),
}));

vi.mock("./PlayerPicker", () => ({
  default: ({
    value,
    onChange,
    labels,
    ariaDescribedBy,
  }: {
    value: string[];
    onChange: (next: string[]) => void;
    labels?: { root: string };
    ariaDescribedBy?: string;
  }) =>
    // NEO-528: the drawer mounts two — the labelled one is Also pictured.
    labels ? (
      <div aria-label={`${labels.root} (stub)`} data-described-by={ariaDescribedBy ?? ""}>
        <span>Also pictured: {value.join(",")}</span>
        <button onClick={() => onChange([...value, "cameo-new"])}>
          Stub add cameo
        </button>
        <button onClick={() => onChange([...value, "player-1"])}>
          Stub add the card's own player as a cameo
        </button>
        <button onClick={() => onChange(value.slice(0, -1))}>
          Stub remove last cameo
        </button>
      </div>
    ) : (
    <div aria-label="Player picker (stub)">
      <span>Players: {value.join(",")}</span>
      <button onClick={() => onChange([...value, "player-new"])}>
        Stub add player
      </button>
      <button onClick={() => onChange(value.slice(0, -1))}>
        Stub remove last player
      </button>
    </div>
    ),
}));

// ---------------------------------------------------------------------------
// Component under test — imported after mocks
// ---------------------------------------------------------------------------

import CardDetailPanel, {
  ALREADY_A_PLAYER_MESSAGE,
  ALSO_PICTURED_HINT,
} from "./CardDetailPanel";
import { ALSO_PICTURED_PICKER_LABELS } from "./player-picker-labels";
// NEO-272: the drawer-geometry block below reads the character budget from the
// server's own constant rather than restating 80.
import { LISTING_TITLE_MAX } from "../../convex/features/listingLimits";
import type { Id } from "../../convex/_generated/dataModel";

// ---------------------------------------------------------------------------
// Fixtures / helpers
// ---------------------------------------------------------------------------

const CARD_ID = "card-1" as unknown as Id<"cardChecklist">;

function makeCard(overrides: Partial<Parameters<typeof CardDetailPanel>[0]["card"]> = {}) {
  return {
    _id: CARD_ID,
    selectorOptionId: "vt-1" as unknown as Id<"selectorOptions">,
    cardNumber: "42",
    cardName: "Mike Trout",
    playerIds: ["player-1"] as unknown as Array<Id<"players">>,
    teamOnCardIds: [] as unknown as Array<Id<"teams">>,
    attributes: [],
    platformData: {},
    features: {},
    ...overrides,
  };
}

function renderPanel(
  props: Partial<Parameters<typeof CardDetailPanel>[0]> = {},
) {
  const onClose = vi.fn();
  const onPrev = vi.fn();
  const onNext = vi.fn();
  const utils = render(
    <CardDetailPanel
      card={makeCard()}
      ancestorSport="Baseball"
      onClose={onClose}
      onPrev={onPrev}
      onNext={onNext}
      hasPrev={false}
      hasNext={false}
      {...props}
    />,
  );
  return { ...utils, onClose, onPrev, onNext };
}

/**
 * Focus a reactive field the way a person does.
 *
 * BOTH the real `.focus()` and the synthetic React event are required:
 * `useReactiveField` guards its mirroring effect on `document.activeElement`
 * (only the real call sets that) and guards the commit no-op on its own
 * `focusedRef` (only the synthetic event sets that). See
 * components/forms/useReactiveField.test.tsx.
 */
function focusField(el: HTMLElement): void {
  el.focus();
  fireEvent.focus(el);
}

function blurField(el: HTMLElement): void {
  el.blur();
  fireEvent.blur(el);
}

/**
 * Type into an UNCONTROLLED field.
 *
 * `fireEvent.change`, not a direct `el.value =` assignment: React keeps a
 * tracker of the last value it saw on the node, and assigning the property
 * updates that tracker, so the event that follows looks like a no-change and
 * React skips `onChange` — which some of these fields use to drive their live
 * character counter. `fireEvent.change` sets the value through the native
 * setter, which is the path the tracker does not swallow.
 */
function typeInto(el: HTMLInputElement | HTMLTextAreaElement, text: string): void {
  fireEvent.change(el, { target: { value: text } });
}

/** Focus → type → blur, which is what commits a reactive field. */
async function editAndCommit(
  el: HTMLInputElement | HTMLTextAreaElement,
  text: string,
): Promise<void> {
  await act(async () => {
    focusField(el);
    typeInto(el, text);
    blurField(el);
  });
}

const nameInput = () => screen.getByLabelText("Card name") as HTMLInputElement;
const printRunInput = () =>
  screen.getByLabelText("Print run") as HTMLInputElement;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CardDetailPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateCard.mockResolvedValue(undefined);
    mockSetCardFeature.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Autographed control: toggle pills, not a <select>; setCardFeature.
  // -------------------------------------------------------------------------

  it("renders the Autographed control as toggle pills, not a <select>", () => {
    renderPanel({ card: makeCard({ features: { autographed: "On Card" } }) });

    // No <select> anymore — the base "Value for Autographed" aria-label is
    // no longer unique on its own (it's now a prefix shared by both pills:
    // "Value for Autographed: Auto (On Card)" / "Value for Autographed: Auto (Sticker)").
    expect(screen.queryByRole("combobox")).toBeNull();

    const onCardPill = screen.getByLabelText(
      "Value for Autographed: Auto (On Card)",
    );
    const stickerPill = screen.getByLabelText(
      "Value for Autographed: Auto (Sticker)",
    );
    expect(onCardPill.tagName).toBe("BUTTON");
    expect(stickerPill.tagName).toBe("BUTTON");
    expect(onCardPill.getAttribute("aria-pressed")).toBe("true");
    expect(stickerPill.getAttribute("aria-pressed")).toBe("false");
  });

  it("clicking the 'Auto (On Card)' pill calls setCardFeature (not updateCard) with the card id, key, and new value", async () => {
    renderPanel({ card: makeCard({ features: { autographed: "None" } }) });

    const onCardPill = screen.getByLabelText(
      "Value for Autographed: Auto (On Card)",
    );
    await act(async () => {
      fireEvent.click(onCardPill);
    });

    await waitFor(() => {
      expect(mockSetCardFeature).toHaveBeenCalledWith({
        cardChecklistId: CARD_ID,
        key: "autographed",
        value: "On Card",
      });
    });
    expect(mockUpdateCard).not.toHaveBeenCalled();
  });

  it("clicking the 'Auto (Sticker)' pill calls setCardFeature with the stored value 'Sticker/Label' (the display label differs, the stored value doesn't)", async () => {
    renderPanel({ card: makeCard({ features: { autographed: "None" } }) });

    const stickerPill = screen.getByLabelText(
      "Value for Autographed: Auto (Sticker)",
    );
    await act(async () => {
      fireEvent.click(stickerPill);
    });

    await waitFor(() => {
      expect(mockSetCardFeature).toHaveBeenCalledWith({
        cardChecklistId: CARD_ID,
        key: "autographed",
        value: "Sticker/Label",
      });
    });
    expect(mockUpdateCard).not.toHaveBeenCalled();
  });

  it("changing Autographed leaves the drawer closable with no discard prompt", async () => {
    const { onClose } = renderPanel({
      card: makeCard({ features: { autographed: "None" } }),
    });

    const onCardPill = screen.getByLabelText(
      "Value for Autographed: Auto (On Card)",
    );
    await act(async () => {
      fireEvent.click(onCardPill);
    });
    await waitFor(() => {
      expect(mockSetCardFeature).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByLabelText("Close card detail"));

    expect(screen.queryByText("Discard unsaved changes?")).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // Players picker: renders from the live row; writes only playerIds.
  // -------------------------------------------------------------------------

  it("renders the Players picker seeded with the card's playerIds", () => {
    renderPanel({
      card: makeCard({ playerIds: ["player-1", "player-2"] as unknown as Array<Id<"players">> }),
    });

    expect(screen.getByText("Players: player-1,player-2")).toBeTruthy();
  });

  it("adding a player writes playerIds immediately — and nothing else", async () => {
    renderPanel({ card: makeCard({ playerIds: ["player-1"] as unknown as Array<Id<"players">> }) });

    await act(async () => {
      fireEvent.click(screen.getByText("Stub add player"));
    });

    await waitFor(() => {
      expect(mockUpdateCard).toHaveBeenCalledWith({
        id: CARD_ID,
        playerIds: ["player-1", "player-new"],
      });
    });
  });

  it("removing a player writes the shortened playerIds array", async () => {
    renderPanel({
      card: makeCard({ playerIds: ["player-1", "player-2"] as unknown as Array<Id<"players">> }),
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Stub remove last player"));
    });

    await waitFor(() => {
      expect(mockUpdateCard).toHaveBeenCalledWith({
        id: CARD_ID,
        playerIds: ["player-1"],
      });
    });
  });

  it("shows the server's playerIds refusal inline, beside the picker (NEO-246)", async () => {
    // `updateCard.playerIds` is validated as of NEO-246 — an id that resolves
    // to no player, one from another sport, or more than the cap is refused
    // rather than written. This picker is one of the two clients that can be
    // told no, and the refusal has to land next to the control that caused it:
    // the panel autosaves per field, so there is no Save button to attach it
    // to and no draft the operator can inspect afterwards.
    mockUpdateCard.mockRejectedValue(
      new ConvexError('"LeBron James" is not a player in this card\'s sport.'),
    );
    renderPanel({ card: makeCard({ playerIds: ["player-1"] as unknown as Array<Id<"players">> }) });

    await act(async () => {
      fireEvent.click(screen.getByText("Stub add player"));
    });

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(
      '"LeBron James" is not a player in this card\'s sport.',
    );
    // The chips snap back to server truth: nothing was written, and leaving the
    // rejected pick on screen would read as if it had been.
    expect(screen.getByText("Players: player-1")).toBeTruthy();
  });

  it("falls back to a plain sentence when a player write fails with no user-facing text", async () => {
    mockUpdateCard.mockRejectedValue(new Error("Server Error"));
    renderPanel({ card: makeCard({ playerIds: ["player-1"] as unknown as Array<Id<"players">> }) });

    await act(async () => {
      fireEvent.click(screen.getByText("Stub add player"));
    });

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Could not save that change");
  });

  it("touching nothing writes nothing, and closing exits straight away", () => {
    const { onClose } = renderPanel();

    fireEvent.click(screen.getByLabelText("Close card detail"));

    expect(mockUpdateCard).not.toHaveBeenCalled();
    expect(screen.queryByText("Discard unsaved changes?")).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // Variation label (cosmetic rename from "Variation / parallel")
  // -------------------------------------------------------------------------

  it("labels the variation field 'Variation' (not 'Variation / parallel')", () => {
    renderPanel();

    expect(screen.getByText("Variation")).toBeTruthy();
    expect(screen.queryByText("Variation / parallel")).toBeNull();
    expect(screen.queryByText(/variation\s*\/\s*parallel/i)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// NEO-216 — per-field autosave on the live row
// ---------------------------------------------------------------------------

describe("CardDetailPanel — per-field autosave (NEO-216)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateCard.mockResolvedValue(undefined);
    mockSetCardFeature.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders no Save button and no Cancel button", () => {
    renderPanel();

    expect(screen.queryByLabelText("Save card edit")).toBeNull();
    expect(screen.queryByLabelText("Cancel card edit")).toBeNull();
    // The rule is stated where the button used to be — nobody guesses that a
    // drawer without a Save button has already saved.
    expect(
      screen.getByText("Changes save as you leave each field."),
    ).toBeTruthy();
    expect(screen.getByLabelText("Done editing card")).toBeTruthy();
  });

  it("editing the card name and blurring sends ONLY { id, cardName }", async () => {
    renderPanel({ card: makeCard({ cardName: "Mike Trout" }) });

    await editAndCommit(nameInput(), "Shohei Ohtani");

    await waitFor(() => expect(mockUpdateCard).toHaveBeenCalledTimes(1));
    expect(mockUpdateCard).toHaveBeenCalledWith({
      id: CARD_ID,
      cardName: "Shohei Ohtani",
    });
  });

  it("an untouched field never appears in any payload", async () => {
    // The whole point of the change: a name edit must not carry a
    // `teamOnCardIds` the server filled in a second ago.
    renderPanel({
      card: makeCard({
        cardName: "Mike Trout",
        teamOnCardIds: ["team-a"] as unknown as Array<Id<"teams">>,
        printRun: 99,
        cardVariation: "Gold",
        listingTitle: "a title",
      }),
    });

    await editAndCommit(nameInput(), "Shohei Ohtani");

    await waitFor(() => expect(mockUpdateCard).toHaveBeenCalledTimes(1));
    const payload = mockUpdateCard.mock.calls[0][0];
    expect(Object.keys(payload).sort()).toEqual(["cardName", "id"]);
  });

  it("committing an unchanged value writes nothing at all", async () => {
    renderPanel({ card: makeCard({ cardName: "Mike Trout" }) });

    await act(async () => {
      focusField(nameInput());
      blurField(nameInput());
    });

    expect(mockUpdateCard).not.toHaveBeenCalled();
  });

  it("confirms the save in a status region", async () => {
    renderPanel();

    await editAndCommit(nameInput(), "Shohei Ohtani");

    const status = await screen.findByRole("status");
    expect(status.textContent).toBe("Saved Card name");
  });

  it("shows the save in the drawer's footer, in place of the autosave rule, never over the fields", async () => {
    renderPanel();

    await editAndCommit(nameInput(), "Shohei Ohtani");

    const status = await screen.findByRole("status");
    // Inside the dialog (NEO-528 audit: the viewport-fixed toast sat on Card
    // name), beside Done, and not positioned over anything.
    const dialog = screen.getByRole("dialog");
    expect(dialog.contains(status)).toBe(true);
    const footer = screen.getByLabelText("Done editing card").parentElement!;
    expect(footer.contains(status)).toBe(true);
    expect(status.className).not.toMatch(/\bfixed\b|\babsolute\b/);
    // It stands in for the rule while it shows.
    expect(screen.queryByText("Changes save as you leave each field.")).toBeNull();
  });

  /**
   * NEO-36 pin — the bug class this whole drawer was rebuilt around.
   *
   * A reactive push landing mid-edit must not reset, lose, or cross-wire the
   * text in the field, the picker must show what the server just sent, and the
   * commit must send what the operator typed — not the value the push carried.
   */
  it("keeps typed text when the live row is patched externally, shows the new team, and commits the typed value", async () => {
    const onClose = vi.fn();
    const props = {
      ancestorSport: "Baseball",
      onClose,
      onPrev: vi.fn(),
      onNext: vi.fn(),
      hasPrev: false,
      hasNext: false,
    };
    const { rerender } = render(
      <CardDetailPanel card={makeCard({ cardName: "Mike Trout" })} {...props} />,
    );

    const input = nameInput();
    await act(async () => {
      focusField(input);
      typeInto(input, "Shohei Ohtani");
    });

    // The BSC per-card team queue lands, and the server also renamed the card
    // from another surface. Both arrive as a fresh `card` prop while the
    // operator is still typing.
    await act(async () => {
      rerender(
        <CardDetailPanel
          card={makeCard({
            cardName: "Renamed By Sync",
            teamOnCardIds: ["team-from-sync"] as unknown as Array<Id<"teams">>,
          })}
          {...props}
        />,
      );
    });

    // 1. The typed text survives untouched.
    expect(nameInput().value).toBe("Shohei Ohtani");
    // 2. The picker reads the LIVE row, so the team the queue wrote is visible
    //    while the drawer is open (it used to sit behind a mount-time draft).
    expect(screen.getByText("Teams: team-from-sync")).toBeTruthy();
    // 3. The commit reads the DOM, not the pushed value.
    await act(async () => {
      blurField(nameInput());
    });
    await waitFor(() => expect(mockUpdateCard).toHaveBeenCalledTimes(1));
    expect(mockUpdateCard).toHaveBeenCalledWith({
      id: CARD_ID,
      cardName: "Shohei Ohtani",
    });
    // And it carried no teamOnCardIds to overwrite the queue's write with.
    expect(mockUpdateCard.mock.calls[0][0]).not.toHaveProperty("teamOnCardIds");
  });

  it("mirrors an external change into an idle field", async () => {
    const props = {
      ancestorSport: "Baseball",
      onClose: vi.fn(),
      onPrev: vi.fn(),
      onNext: vi.fn(),
      hasPrev: false,
      hasNext: false,
    };
    const { rerender } = render(
      <CardDetailPanel card={makeCard({ cardName: "Mike Trout" })} {...props} />,
    );

    // The drawer focuses Card name on mount (each remount is a new card), and
    // a focused field is deliberately NOT mirrored into — so step away first.
    // "Idle" is the state this test is about.
    await act(async () => {
      blurField(nameInput());
    });

    await act(async () => {
      rerender(
        <CardDetailPanel
          card={makeCard({ cardName: "Renamed By Sync" })}
          {...props}
        />,
      );
    });

    expect(nameInput().value).toBe("Renamed By Sync");
  });

  it("the description commits on blur and on Cmd/Ctrl+Enter, but not on a bare Enter", async () => {
    // A bare Enter here is a paragraph break the operator typed. Swallowing it
    // to save would make a multi-line description impossible to write.
    renderPanel({ card: makeCard({ listingDescription: "old copy" }) });

    const description = screen.getByLabelText(
      "Card description",
    ) as HTMLTextAreaElement;

    await act(async () => {
      focusField(description);
      typeInto(description, "line one");
      fireEvent.keyDown(description, { key: "Enter" });
    });
    expect(mockUpdateCard).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.keyDown(description, { key: "Enter", metaKey: true });
    });
    await waitFor(() => expect(mockUpdateCard).toHaveBeenCalledTimes(1));
    expect(mockUpdateCard).toHaveBeenCalledWith({
      id: CARD_ID,
      listingDescription: "line one",
    });

    await act(async () => {
      typeInto(description, "line one\nline two");
      blurField(description);
    });
    await waitFor(() => expect(mockUpdateCard).toHaveBeenCalledTimes(2));
    expect(mockUpdateCard).toHaveBeenLastCalledWith({
      id: CARD_ID,
      listingDescription: "line one\nline two",
    });
  });

  it("NEO-367: notes commit only `notes`, keep line breaks, and clearing sends \"\"", async () => {
    renderPanel({ card: makeCard({ notes: "Short print" }) });
    const notes = screen.getByLabelText("Card notes") as HTMLTextAreaElement;
    expect(notes.value).toBe("Short print");

    await act(async () => {
      focusField(notes);
      typeInto(notes, "Error card\ncorrected later");
      fireEvent.keyDown(notes, { key: "Enter" });
    });
    expect(mockUpdateCard).not.toHaveBeenCalled();

    await act(async () => {
      blurField(notes);
    });
    await waitFor(() => expect(mockUpdateCard).toHaveBeenCalledTimes(1));
    expect(mockUpdateCard).toHaveBeenCalledWith({
      id: CARD_ID,
      notes: "Error card\ncorrected later",
    });

    await act(async () => {
      focusField(notes);
      typeInto(notes, "   ");
      blurField(notes);
    });
    await waitFor(() => expect(mockUpdateCard).toHaveBeenCalledTimes(2));
    expect(mockUpdateCard).toHaveBeenLastCalledWith({ id: CARD_ID, notes: "" });
  });

  it("the card variation writes only cardVariation", async () => {
    renderPanel({ card: makeCard({ cardVariation: "" }) });

    await editAndCommit(
      screen.getByLabelText("Card variation") as HTMLInputElement,
      "Gold Refractor",
    );

    await waitFor(() => expect(mockUpdateCard).toHaveBeenCalledTimes(1));
    expect(mockUpdateCard).toHaveBeenCalledWith({
      id: CARD_ID,
      cardVariation: "Gold Refractor",
    });
  });

  // -------------------------------------------------------------------------
  // Attribute chips (NEO-217 C)
  // -------------------------------------------------------------------------

  it("toggling RC on writes attributes plus both derived booleans", async () => {
    renderPanel({ card: makeCard({ attributes: [] }) });

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Toggle RC"));
    });

    await waitFor(() => expect(mockUpdateCard).toHaveBeenCalledTimes(1));
    expect(mockUpdateCard).toHaveBeenCalledWith({
      id: CARD_ID,
      attributes: ["RC"],
      isRookie: true,
      isRelic: false,
    });
  });

  it("toggling RC OFF sets isRookie back to false, even on a card already flagged rookie", async () => {
    // The old `isRookie: attributes.includes("RC") || card.isRookie === true`
    // made RC a one-way switch: unticking it left isRookie true and the
    // generated title kept its "RC" token forever.
    renderPanel({
      card: makeCard({ attributes: ["RC"], isRookie: true }),
    });

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Toggle RC"));
    });

    await waitFor(() => expect(mockUpdateCard).toHaveBeenCalledTimes(1));
    expect(mockUpdateCard).toHaveBeenCalledWith({
      id: CARD_ID,
      attributes: [],
      isRookie: false,
      isRelic: false,
    });
  });

  it("preserves reconciliation tokens it does not render as chips", async () => {
    renderPanel({ card: makeCard({ attributes: ["unmatched-sl"] }) });

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Toggle RELIC"));
    });

    await waitFor(() => expect(mockUpdateCard).toHaveBeenCalledTimes(1));
    expect(mockUpdateCard).toHaveBeenCalledWith({
      id: CARD_ID,
      attributes: ["unmatched-sl", "RELIC"],
      isRookie: false,
      isRelic: true,
    });
  });

  it("busy-guards the chip row so a second toggle cannot interleave with the first", async () => {
    // Both toggles would otherwise derive `attributes` from the same
    // pre-toggle array, and the second would silently undo the first.
    let release: (() => void) | undefined;
    mockUpdateCard.mockImplementation(
      () => new Promise<void>((resolve) => (release = resolve)),
    );

    renderPanel({ card: makeCard({ attributes: [] }) });

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Toggle RC"));
    });
    // In words, not only a dimmed pill.
    expect(screen.getByText("Saving…")).toBeTruthy();
    // a11y audit fix (concurrent w/ this test): NOT native `disabled` — that
    // would force a browser blur the instant it applied, dropping focus to
    // <body> mid-toggle for a keyboard user. `aria-disabled` keeps the
    // button focusable while still announcing/styling the busy state; the
    // `toggleAttribute` guard (asserted below) is what actually makes the
    // second click inert, not the DOM disabled behavior.
    expect(
      screen.getByLabelText("Toggle AU").getAttribute("aria-disabled"),
    ).toBe("true");

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Toggle AU"));
    });
    expect(mockUpdateCard).toHaveBeenCalledTimes(1);

    await act(async () => {
      release?.();
    });
  });

  // -------------------------------------------------------------------------
  // Print run (NEO-217 B)
  // -------------------------------------------------------------------------

  it("saves a typed print run as a number", async () => {
    renderPanel({ card: makeCard() });

    await editAndCommit(printRunInput(), "99");

    await waitFor(() => expect(mockUpdateCard).toHaveBeenCalledTimes(1));
    expect(mockUpdateCard).toHaveBeenCalledWith({
      id: CARD_ID,
      printRun: 99,
    });
  });

  it("clearing the print run sends null — the only spelling of 'not numbered'", async () => {
    renderPanel({ card: makeCard({ printRun: 99 }) });

    await editAndCommit(printRunInput(), "");

    await waitFor(() => expect(mockUpdateCard).toHaveBeenCalledTimes(1));
    expect(mockUpdateCard).toHaveBeenCalledWith({
      id: CARD_ID,
      printRun: null,
    });
    const status = await screen.findByRole("status");
    expect(status.textContent).toBe("Cleared Print run");
  });

  it("refuses a non-integer print run inline and sends nothing", async () => {
    renderPanel({ card: makeCard() });

    await editAndCommit(printRunInput(), "2.5");

    const alert = await screen.findByRole("alert");
    // Word-for-word the server's own refusal (minus its "received N" tail —
    // the value is still in the field beside the message). Two different
    // sentences for one rule would teach the operator two different rules.
    expect(alert.textContent).toBe(
      "Print run must be a whole number between 1 and 1,000,000.",
    );
    expect(mockUpdateCard).not.toHaveBeenCalled();
    // The rejected value stays put: it is corrected, never retyped.
    expect(printRunInput().value).toBe("2.5");
  });

  it("refuses a print run below 1", async () => {
    renderPanel({ card: makeCard({ printRun: 5 }) });

    await editAndCommit(printRunInput(), "0");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("between 1 and 1,000,000");
    expect(mockUpdateCard).not.toHaveBeenCalled();
  });

  it("refuses a print run past the server's 1,000,000 bound", async () => {
    // Mirrored client-side so the operator is not told one rule locally and a
    // different one by the round trip.
    renderPanel({ card: makeCard({ printRun: 99 }) });

    await editAndCommit(printRunInput(), "1000001");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("between 1 and 1,000,000");
    expect(mockUpdateCard).not.toHaveBeenCalled();
  });

  it("accepts exactly 1,000,000 — the bound is inclusive, as it is server-side", async () => {
    renderPanel({ card: makeCard({ printRun: 99 }) });

    await editAndCommit(printRunInput(), "1000000");

    await waitFor(() => expect(mockUpdateCard).toHaveBeenCalledTimes(1));
    expect(mockUpdateCard).toHaveBeenCalledWith({
      id: CARD_ID,
      printRun: 1_000_000,
    });
  });

  // -------------------------------------------------------------------------
  // Refusals
  // -------------------------------------------------------------------------

  it("a rejected commit shows an inline error and keeps the typed value", async () => {
    mockUpdateCard.mockRejectedValue(
      new ConvexError("That title is too long for eBay."),
    );
    renderPanel({ card: makeCard({ cardName: "Mike Trout" }) });

    await editAndCommit(nameInput(), "Shohei Ohtani");

    const alert = await screen.findByRole("alert");
    // A ConvexError's `data` is the message the backend chose for a person,
    // so it is shown verbatim rather than replaced by the fallback.
    expect(alert.textContent).toBe("That title is too long for eBay.");
    expect(nameInput().value).toBe("Shohei Ohtani");
    // The field is described by its own error, not merely followed by it.
    expect(nameInput().getAttribute("aria-invalid")).toBe("true");
    expect(nameInput().getAttribute("aria-describedby")).toBe(alert.id);
  });

  it("falls back to a plain sentence when the failure carries no user-facing text", async () => {
    // Production redacts a plain Error to "Server Error", and `.message`
    // arrives wrapped in "[CONVEX M(...)] [Request ID: ...]" noise either way.
    mockUpdateCard.mockRejectedValue(new Error("Server Error"));
    renderPanel();

    await editAndCommit(nameInput(), "Shohei Ohtani");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Could not save that change");
  });

  // -------------------------------------------------------------------------
  // Exits
  // -------------------------------------------------------------------------

  it("Escape closes with no discard bar", () => {
    const { onClose } = renderPanel();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Discard unsaved changes?")).toBeNull();
    expect(screen.queryByLabelText("Keep editing")).toBeNull();
    expect(screen.queryByLabelText("Discard changes")).toBeNull();
  });

  it("Escape closes even mid-edit — there is nothing left to discard", async () => {
    const { onClose } = renderPanel();

    await act(async () => {
      focusField(nameInput());
      typeInto(nameInput(), "half a name");
    });
    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Discard unsaved changes?")).toBeNull();
  });

  it("the Done button closes the drawer", () => {
    const { onClose } = renderPanel();

    fireEvent.click(screen.getByLabelText("Done editing card"));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

/**
 * NEO-189 — the escape hatch for a variation the import could not derive, and
 * the only way a custom set gets variations at all.
 */
describe("CardDetailPanel — Variation of", () => {
  // The suite's other clearAllMocks lives inside the first describe block, so
  // this one needs its own or calls leak between tests.
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves a typed card number to a sibling and links it", async () => {
    renderPanel({ card: makeCard() });
    const input = screen.getByLabelText(
      "Card number this one is a variation of",
    );
    fireEvent.change(input, { target: { value: "1" } });
    fireEvent.blur(input);
    await waitFor(() =>
      expect(mockSetVariationParent).toHaveBeenCalledWith(
        expect.objectContaining({ parentCardId: "card-1" }),
      ),
    );
  });

  it("reports a number that matches nothing rather than doing nothing", async () => {
    // A typo that silently no-ops is worse than one that says so.
    renderPanel({ card: makeCard() });
    const input = screen.getByLabelText(
      "Card number this one is a variation of",
    );
    fireEvent.change(input, { target: { value: "99999" } });
    fireEvent.blur(input);
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/No card #99999/),
    );
    expect(mockSetVariationParent).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// NEO-208 — unresolved typed team names, read-only above the picker
//
// `pendingTeamNames` rendered nowhere in this drawer before this ticket: an
// operator opening a card whose team they had typed saw an empty Teams picker
// and no explanation.
//
// It sits ABOVE the picker rather than inside it because a `TeamPicker` chip is
// a real `teams._id` the rest of the product can act on; putting a bare string
// among them would be claiming a link that does not exist. And it is never
// edited here: the server retires it, derived from a real team write
// (`updateCard` clears it in the same patch as a non-empty `teamOnCardIds`), so
// there is nothing here to edit or delete by hand.
// ---------------------------------------------------------------------------

describe("CardDetailPanel — NEO-208 pending team names", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateCard.mockResolvedValue(undefined);
    mockSetCardFeature.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows each unresolved name, marked", () => {
    renderPanel({
      card: makeCard({ pendingTeamNames: ["Savannah Bananas", "Yankees"] }),
    });

    expect(screen.getByText("Savannah Bananas")).toBeTruthy();
    expect(screen.getByText("Yankees")).toBeTruthy();
    expect(screen.getAllByText("(unconfirmed)")).toHaveLength(2);
  });

  it("says what will happen to the name — the two ways it resolves", () => {
    renderPanel({ card: makeCard({ pendingTeamNames: ["Savannah Bananas"] }) });

    expect(
      screen.getByText(
        /resolves at the next sync, or pick a team to replace it/,
      ),
    ).toBeTruthy();
  });

  it("renders the names as TEXT — never an anchor or a button", () => {
    // There is no action to offer, so there is no control. Offering one would
    // imply a delete/edit path that does not exist server-side.
    renderPanel({ card: makeCard({ pendingTeamNames: ["Savannah Bananas"] }) });
    const node = screen.getByText("Savannah Bananas");
    expect(node.closest("a")).toBeNull();
    expect(node.closest("button")).toBeNull();
  });

  it("renders them ABOVE the picker, not among its chips", () => {
    const { container } = renderPanel({
      card: makeCard({ pendingTeamNames: ["Savannah Bananas"] }),
    });

    const pending = screen.getByText("Savannah Bananas");
    const picker = screen.getByLabelText("Team picker (stub)");
    // Document order: the read-only list precedes the picker.
    expect(
      pending.compareDocumentPosition(picker) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // And it is genuinely outside the picker's subtree.
    expect(picker.contains(pending)).toBe(false);
    expect(container).toBeTruthy();
  });

  it("merely opening a card that has one writes nothing", () => {
    const { onClose } = renderPanel({
      card: makeCard({ pendingTeamNames: ["Savannah Bananas"] }),
    });

    fireEvent.click(screen.getByLabelText("Close card detail"));

    expect(mockUpdateCard).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("never sends pendingTeamNames back through updateCard", async () => {
    // The clear is DERIVED server-side from the team write. A client that sent
    // the field would be fabricating "the operator typed this", and the
    // mutation's validator rejects it outright.
    renderPanel({ card: makeCard({ pendingTeamNames: ["Savannah Bananas"] }) });

    await act(async () => {
      fireEvent.click(screen.getByText("Stub add team"));
    });

    await waitFor(() => expect(mockUpdateCard).toHaveBeenCalledTimes(1));
    expect(mockUpdateCard.mock.calls[0][0]).not.toHaveProperty(
      "pendingTeamNames",
    );
    // And the team write that retires it server-side did go out, on its own.
    expect(mockUpdateCard).toHaveBeenCalledWith({
      id: CARD_ID,
      teamOnCardIds: ["team-new"],
    });
  });

  it("shows nothing when there are no pending names", () => {
    renderPanel({ card: makeCard() });
    expect(screen.queryByText("(unconfirmed)")).toBeNull();
    expect(screen.queryByText(/resolves at the next sync/)).toBeNull();
  });

  it("renders duplicate pending names without a React key warning", () => {
    // `pendingTeamNames` is not deduplicated, and rows written before NEO-208
    // can carry the same typed name twice. The list was keyed on the name
    // itself, so React saw duplicate sibling keys — a dev-mode warning, and
    // mis-reconciliation of the second entry. The key is index-qualified now.
    //
    // Non-throwing spy deliberately: a spy that throws on console output turns
    // a warning into a worker-level failure in the shared fork pool.
    const errors: string[] = [];
    const spy = vi
      .spyOn(console, "error")
      .mockImplementation((...args: unknown[]) => {
        errors.push(args.map((a) => String(a)).join(" "));
      });

    try {
      renderPanel({
        card: makeCard({ pendingTeamNames: ["Yankees", "Yankees"] }),
      });

      expect(screen.getAllByText("Yankees")).toHaveLength(2);
      expect(screen.getAllByText("(unconfirmed)")).toHaveLength(2);
      expect(errors.filter((e) => e.includes("same key"))).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// NEO-254 — the name this card was PRINTED with
// ---------------------------------------------------------------------------

describe("CardDetailPanel — As printed", () => {
  it("shows the printed name when it differs from the player's own", () => {
    // A 1986 card says "Doc Gooden" and links to Dwight Gooden. The player's
    // name is NB data that can be corrected; the printed string is the card's
    // own fact, so the panel reports it rather than letting the canonical name
    // speak for the card.
    currentPlayerRows = [{ _id: "p1", name: "Dwight Gooden" }];
    renderPanel({
      card: makeCard({
        playerIds: ["p1"] as unknown as Array<Id<"players">>,
        playerLinks: [
          { playerId: "p1" as unknown as Id<"players">, nameOnCard: "Doc Gooden" },
        ],
      }),
    });

    expect(screen.getByText("As printed: Doc Gooden")).toBeTruthy();
  });

  it("says nothing when the card printed the canonical name", () => {
    // The overwhelming majority of cards. Repeating the name under itself
    // would be noise on every row.
    currentPlayerRows = [{ _id: "p1", name: "Dwight Gooden" }];
    renderPanel({
      card: makeCard({
        playerIds: ["p1"] as unknown as Array<Id<"players">>,
        playerLinks: [
          { playerId: "p1" as unknown as Id<"players">, nameOnCard: "Dwight Gooden" },
        ],
      }),
    });

    expect(screen.queryByText(/As printed:/)).toBeNull();
  });

  it("ignores case and surrounding space — those are not a different name", () => {
    currentPlayerRows = [{ _id: "p1", name: "Dwight Gooden" }];
    renderPanel({
      card: makeCard({
        playerIds: ["p1"] as unknown as Array<Id<"players">>,
        playerLinks: [
          {
            playerId: "p1" as unknown as Id<"players">,
            nameOnCard: "  dwight gooden ",
          },
        ],
      }),
    });

    expect(screen.queryByText(/As printed:/)).toBeNull();
  });

  it("says nothing on a row that predates the field", () => {
    // A backfilled row carries the canonical name, and a row not yet
    // backfilled carries none. Neither should caption anything.
    currentPlayerRows = [{ _id: "p1", name: "Dwight Gooden" }];
    renderPanel({
      card: makeCard({ playerIds: ["p1"] as unknown as Array<Id<"players">> }),
    });

    expect(screen.queryByText(/As printed:/)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// NEO-272 — the drawer's own geometry
// ---------------------------------------------------------------------------

/**
 * What is and is not assertable here.
 *
 * happy-dom computes no layout, so there is not a single rendered pixel in this
 * block: `getBoundingClientRect()` is all zeroes, and a test that asserted a
 * measured width would be asserting the test environment rather than the
 * product. What IS assertable is the ARITHMETIC the width was chosen by, read
 * back out of the class that carries it — so a future narrowing fails here with
 * the reason attached rather than silently shrinking the field whose budget the
 * meter counts in characters. Same approach, and the same measured px/char, as
 * `CardAttentionWalker.test.tsx`'s "dialog geometry (NEO-271)" block.
 */
describe("CardDetailPanel — drawer geometry (NEO-272)", () => {
  /** The drawer panel itself. */
  const panel = () => screen.getByRole("dialog");
  /** Its scrolling body: the middle of the panel's three rows. */
  const body = () => panel().children[1] as HTMLElement;

  /**
   * Measured with fontTools: summed glyph advances at `text-sm` (14px) over a
   * realistic worst-case title come to 8.07px per character in DejaVu Sans —
   * what `system-ui` resolves to on the Linux CI runner, and the widest of the
   * faces this portalled, nested-`<Theme>` drawer can pick up (Lexend 7.80,
   * Arial 7.25, SF Pro Text 6.84).
   */
  const WIDEST_PX_PER_CHAR = 8.07;
  /** The input's own `p-1.5` plus its 1px borders — space the text never gets. */
  const INPUT_CHROME_PX = 6 * 2 + 1 * 2;

  it("is wide enough for an 80-character title in the widest font this drawer can render in", () => {
    renderPanel();

    // Read both numbers OUT of the classes rather than restating them, so a
    // change to either the panel width or the body padding is what fails.
    const rem = /sm:w-\[(\d+(?:\.\d+)?)rem\]/.exec(panel().className);
    expect(rem).not.toBeNull();
    const panelPx = Number(rem?.[1]) * 16;

    // `px-4` on the scroll container that actually holds the title field —
    // NOT the walker's `p-6`, which is why the arithmetic is re-derived here
    // rather than inherited.
    expect(body().className).toContain("px-4");
    const bodyPaddingPx = 16 * 2;

    const charsVisible =
      (panelPx - bodyPaddingPx - INPUT_CHROME_PX) / WIDEST_PX_PER_CHAR;
    expect(charsVisible).toBeGreaterThanOrEqual(LISTING_TITLE_MAX);
  });

  it("still fits CI's 1024px viewport, and reflows below the sm breakpoint", () => {
    renderPanel();

    const rem = /sm:w-\[(\d+(?:\.\d+)?)rem\]/.exec(panel().className);
    const panelPx = Number(rem?.[1]) * 16;
    expect(panelPx).toBeLessThanOrEqual(1024);

    // The two clauses that carry narrow windows: `w-full` below `sm`, and the
    // viewport cap above it. Both predate NEO-272 and both are load-bearing —
    // without them a 45rem drawer would overhang a phone instead of leaving a
    // sliver of dismissable backdrop.
    expect(panel().className).toContain("w-full");
    expect(panel().className).toContain("max-w-[95vw]");
  });

  it("gives the whole width to the title field, so the reserved space reaches the text", () => {
    renderPanel();
    const title = screen.getByLabelText("Card title") as HTMLInputElement;

    // `w-full p-1.5 text-sm` is the exact class list the arithmetic above
    // assumes, and it is also what the walker's title field carries — which is
    // what makes the two surfaces' numbers comparable at all.
    expect(title.className).toContain("w-full");
    expect(title.className).toContain("p-1.5");
    expect(title.className).toContain("text-sm");
    // No `maxLength`, deliberately (see the input's own comment): the field
    // holds an over-cap value so the operator can SEE and fix it, which is the
    // whole reason the width has to cover the budget.
    expect(title.hasAttribute("maxLength")).toBe(false);
  });

  it("keeps a full-budget 80-character title whole in the field", () => {
    // The ticket's own case: `80/80 · may clip in search`, whose tail was the
    // part scrolled out of sight at 30rem.
    const title = "2026 Topps Chrome Update #USC-250 Jose Ramirez SSP Cleveland Guardians Gold";
    const padded = `${title}${"!".repeat(LISTING_TITLE_MAX - title.length)}`;
    expect(padded).toHaveLength(LISTING_TITLE_MAX);

    renderPanel({ card: makeCard({ listingTitle: padded }) });
    expect((screen.getByLabelText("Card title") as HTMLInputElement).value).toBe(
      padded,
    );
    expect(screen.getByText(`${LISTING_TITLE_MAX}/${LISTING_TITLE_MAX}`)).toBeTruthy();
  });

  it("leaves the panel's three-row shape and its slide-in intact", () => {
    renderPanel();

    // The resize touched one class list. Pinned here because the flows that
    // drive this drawer depend on the shape rather than on the width: the
    // header is a sibling ABOVE the only scroll container (it is what the
    // sticky-header trap in checklist-title-length-limits-and-fixer.yaml is
    // about), and the footer a sibling BELOW it, so no amount of body
    // scrolling can take "Done" out of reach.
    expect(panel().children).toHaveLength(3);
    expect(body().className).toContain("overflow-y-auto");
    expect(body().className).toContain("flex-1");

    const heading = screen.getByRole("heading", { level: 2 });
    const done = screen.getByLabelText("Done editing card");
    expect(body().contains(heading)).toBe(false);
    expect(body().contains(done)).toBe(false);
    expect(body().contains(screen.getByLabelText("Card title"))).toBe(true);

    // `translateX(100%)` is a percentage of the element's own width, so the
    // animation is width-independent — a wider panel still starts off-screen.
    expect(panel().className).toContain("animate-slide-in-right");
  });
});

describe("CardDetailPanel — NEO-331 the set context reaches the team picker", () => {
  it("passes contextOptionId through, so the drawer's picker ranks by the set", () => {
    renderPanel({ contextOptionId: "variant-1" as never });
    expect(
      screen.getByLabelText("Team picker (stub)").getAttribute("data-context-option-id"),
    ).toBe("variant-1");
  });

  it("passes nothing when the host has no set to offer", () => {
    renderPanel();
    expect(
      screen.getByLabelText("Team picker (stub)").getAttribute("data-context-option-id"),
    ).toBe("");
  });
});

// ---------------------------------------------------------------------------
// NEO-528 — Also pictured: a second player list, its own writer.
// ---------------------------------------------------------------------------

describe("CardDetailPanel — Also on this card (NEO-528)", () => {
  const ids = (...xs: string[]) => xs as unknown as Array<Id<"players">>;
  const ALSO = `${ALSO_PICTURED_PICKER_LABELS.root} (stub)`;

  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateCard.mockResolvedValue(null);
    mockConvexMutation.mockResolvedValue({ secondaryPlayerIds: [], strippedPrimary: 0 });
    currentPlayerRows = undefined;
  });

  it("mounts a second picker under its own labels, seeded with the card's also-pictured players", () => {
    renderPanel({ card: makeCard({ secondaryPlayerIds: ids("cameo-1", "cameo-2") }) });
    expect(screen.getByText("Also on this card", { selector: "label" })).toBeTruthy();
    expect(screen.getByLabelText(ALSO)).toBeTruthy();
    expect(screen.getByText("Also pictured: cameo-1,cameo-2")).toBeTruthy();
    // The Players picker is still the default-labelled one.
    expect(screen.getByLabelText("Player picker (stub)")).toBeTruthy();
  });

  it("describes the picker with the visible hint", () => {
    expect(ALSO_PICTURED_HINT).toBe(
      "Anyone on the card besides its main player: a teammate in the photo, a name on a team leaders card, the star a Profiles card is about. Smart binders can count these as cameos.",
    );
    expect(ALREADY_A_PLAYER_MESSAGE).toBe("They're already this card's player. No cameo needed.");
    renderPanel();
    const hint = screen.getByText(ALSO_PICTURED_HINT);
    expect(hint.id).not.toBe("");
    expect(screen.getByLabelText(ALSO).getAttribute("data-described-by")).toBe(hint.id);
  });

  it("an add writes ONLY the also-pictured list, through its own mutation, and says so", async () => {
    renderPanel({ card: makeCard({ secondaryPlayerIds: ids("cameo-1") }) });
    await act(async () => {
      fireEvent.click(screen.getByText("Stub add cameo"));
    });
    await waitFor(() => {
      expect(mockConvexMutation).toHaveBeenCalledWith(
        "cardSecondaryPlayers.setSecondaryPlayers",
        { cardId: CARD_ID, playerIds: ["cameo-1", "cameo-new"] },
      );
    });
    expect(mockUpdateCard).not.toHaveBeenCalled();
    expect(await screen.findByText("Saved Also on this card")).toBeTruthy();
  });

  it("a remove writes the shortened list; the last one off writes []", async () => {
    renderPanel({ card: makeCard({ secondaryPlayerIds: ids("cameo-1") }) });
    await act(async () => {
      fireEvent.click(screen.getByText("Stub remove last cameo"));
    });
    await waitFor(() => {
      expect(mockConvexMutation).toHaveBeenCalledWith(
        "cardSecondaryPlayers.setSecondaryPlayers",
        { cardId: CARD_ID, playerIds: [] },
      );
    });
  });

  it("refuses the card's own player beside the field, without a write", async () => {
    renderPanel({ card: makeCard({ playerIds: ids("player-1"), secondaryPlayerIds: [] }) });
    await act(async () => {
      fireEvent.click(screen.getByText("Stub add the card's own player as a cameo"));
    });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(ALREADY_A_PLAYER_MESSAGE);
    expect(mockConvexMutation).not.toHaveBeenCalled();
    // The picker reads the live row again: no chip appeared.
    expect(screen.getByText("Also pictured:")).toBeTruthy();
  });

  it("shows the server's refusal inline and snaps back to the live row", async () => {
    mockConvexMutation.mockRejectedValue(
      new ConvexError("A card can have at most 20 people under Also on this card."),
    );
    renderPanel({ card: makeCard({ secondaryPlayerIds: ids("cameo-1") }) });
    await act(async () => {
      fireEvent.click(screen.getByText("Stub add cameo"));
    });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("A card can have at most 20 people under Also on this card.");
    expect(screen.getByText("Also pictured: cameo-1")).toBeTruthy();
  });

  it("falls back to a plain sentence when the write fails with no user-facing text", async () => {
    mockConvexMutation.mockRejectedValue(new Error("Server Error"));
    renderPanel();
    await act(async () => {
      fireEvent.click(screen.getByText("Stub add cameo"));
    });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Couldn't save Also on this card. Give it another go.");
  });

  it("a player made one of the card's own players leaves Also pictured", async () => {
    // The stub's "add player" appends "player-new"; that player was a cameo.
    renderPanel({
      card: makeCard({
        playerIds: ids("player-1"),
        secondaryPlayerIds: ids("cameo-1", "player-new"),
      }),
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Stub add player"));
    });
    await waitFor(() => {
      expect(mockConvexMutation).toHaveBeenCalledWith(
        "cardSecondaryPlayers.setSecondaryPlayers",
        { cardId: CARD_ID, playerIds: ["cameo-1"] },
      );
    });
    expect(mockUpdateCard).toHaveBeenCalledWith({
      id: CARD_ID,
      playerIds: ["player-1", "player-new"],
    });
    expect(
      await screen.findByText("Saved Players and moved them out of Also on this card"),
    ).toBeTruthy();
  });

  it("a Players write that touches no cameo leaves Also pictured alone", async () => {
    renderPanel({
      card: makeCard({ playerIds: ids("player-1"), secondaryPlayerIds: ids("cameo-1") }),
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Stub add player"));
    });
    await waitFor(() => expect(mockUpdateCard).toHaveBeenCalled());
    expect(mockConvexMutation).not.toHaveBeenCalled();
  });

  it("a refused Players write never touches Also pictured", async () => {
    mockUpdateCard.mockRejectedValue(new ConvexError("Nope."));
    renderPanel({
      card: makeCard({ playerIds: ids("player-1"), secondaryPlayerIds: ids("player-new") }),
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Stub add player"));
    });
    await screen.findByRole("alert");
    expect(mockConvexMutation).not.toHaveBeenCalled();
  });
});

describe("CardDetailPanel — No Team (NEO-556)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateCard.mockResolvedValue(undefined);
  });

  const toggle = () => screen.getByRole("button", { name: "No Team for this card" });

  it("offers No Team beside the picker, off for a card with no answer", () => {
    renderPanel();
    expect(toggle().getAttribute("aria-pressed")).toBe("false");
  });

  it("pressing it asks the server for the stamp alone, and says so", async () => {
    renderPanel({ card: makeCard({ teamOnCardIds: ["team-1"] as unknown as Array<Id<"teams">> }) });
    await act(async () => {
      fireEvent.click(toggle());
    });
    expect(mockUpdateCard).toHaveBeenCalledTimes(1);
    expect(mockUpdateCard).toHaveBeenCalledWith({ id: CARD_ID, teamNone: true });
    expect(await screen.findByText("Saved No Team")).toBeTruthy();
  });

  it("while the save is out, the toggle reads pressed and the chips are gone", async () => {
    let resolve: () => void = () => {};
    mockUpdateCard.mockImplementationOnce(() => new Promise<void>((r) => (resolve = r)));
    renderPanel({ card: makeCard({ teamOnCardIds: ["team-1"] as unknown as Array<Id<"teams">> }) });
    act(() => {
      fireEvent.click(toggle());
    });
    expect(toggle().getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Teams:")).toBeTruthy();
    await act(async () => resolve());
  });

  it("a stamped card shows it pressed; pressing again clears No Team (the card is teamless again)", async () => {
    let resolve: () => void = () => {};
    mockUpdateCard.mockImplementationOnce(() => new Promise<void>((r) => (resolve = r)));
    renderPanel({ card: makeCard({ teamNoneConfirmedAt: 1 }) });
    expect(toggle().getAttribute("aria-pressed")).toBe("true");
    act(() => {
      fireEvent.click(toggle());
    });
    // Off at once, while the write is out.
    expect(toggle().getAttribute("aria-pressed")).toBe("false");
    expect(mockUpdateCard).toHaveBeenCalledTimes(1);
    expect(mockUpdateCard).toHaveBeenCalledWith({ id: CARD_ID, teamNone: false });
    await act(async () => resolve());
    expect(await screen.findByText("Cleared No Team")).toBeTruthy();
    expect(screen.queryByText(/No Team stays/)).toBeNull();
  });

  it("a refused clear shows the server's sentence and the toggle reads the stamp again", async () => {
    mockUpdateCard.mockRejectedValueOnce(new ConvexError("This card changed. Give it another go."));
    renderPanel({ card: makeCard({ teamNoneConfirmedAt: 1 }) });
    await act(async () => {
      fireEvent.click(toggle());
    });
    expect(await screen.findByText("This card changed. Give it another go.")).toBeTruthy();
    expect(toggle().getAttribute("aria-pressed")).toBe("true");
  });

  it("picking a team on a stamped card saves just the team (the server retires the stamp)", async () => {
    renderPanel({ card: makeCard({ teamNoneConfirmedAt: 1 }) });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Stub add team" }));
    });
    expect(mockUpdateCard).toHaveBeenCalledWith({ id: CARD_ID, teamOnCardIds: ["team-new"] });
    expect(mockUpdateCard.mock.calls[0][0]).not.toHaveProperty("teamNone");
  });

  it("a refused No Team shows the server's sentence and the toggle settles back", async () => {
    mockUpdateCard.mockRejectedValueOnce(new ConvexError("Pick No Team or a team, not both."));
    renderPanel();
    await act(async () => {
      fireEvent.click(toggle());
    });
    expect(await screen.findByText("Pick No Team or a team, not both.")).toBeTruthy();
    expect(toggle().getAttribute("aria-pressed")).toBe("false");
  });
});
