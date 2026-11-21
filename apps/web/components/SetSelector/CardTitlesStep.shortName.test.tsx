/**
 * NEO-535 — the Card titles step's "Set name in titles" box, and the
 * rendered-row cap.
 *
 * What the box decides (which titles it rewrites, what they become) is pinned
 * in `card-titles.test.tsx`; this pins what the operator sees, the keys, and
 * what the wizard is told.
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { TitleContext } from "../../convex/features/listingInputs";
import CardTitlesStep, { TITLE_ROWS_SHOWN } from "./CardTitlesStep";
import type { PreviewCardForTitles } from "./card-titles";

afterEach(() => {
  vi.useRealTimers();
});

/** "2026 Topps <this>" is 69 characters: titles keep the surname, not the first name. */
const FIRST_NAME_SET = "Chrome Update Series Sapphire Edition Platinum Anniversary";
const PREFILL = `2026 Topps ${FIRST_NAME_SET}`;

const CONTEXT: TitleContext = {
  sportValue: "Baseball",
  setNameValue: FIRST_NAME_SET,
  inheritedFeatures: { manufacturer: "Topps", season: "2026" },
  setTeamNames: [],
  players: [{ printed: "Shohei Ohtani", name: "Shohei Ohtani" }],
  teams: [],
};
const OVER: TitleContext = { ...CONTEXT, setNameValue: `${FIRST_NAME_SET} Collectors Box` };

const LABEL = "Set name in titles";
const LEAD = "Set name hogging the title? Trim it here and every title below gets it.";
const TITLES_LEAD = "These titles had to leave something out or still run long. Check what went, then keep 'em or make 'em yours.";
const BOX = "2026 Topps Chrome Sapphire";

function card(n: string, extra: Partial<PreviewCardForTitles> = {}): PreviewCardForTitles {
  return { cardNumber: n, cardName: `Card ${n}`, players: ["Shohei Ohtani"], ...extra };
}

function setup(props: {
  cards: PreviewCardForTitles[];
  titleContext?: TitleContext;
  shortName?: string;
  withCallback?: boolean;
  headingId?: string;
}) {
  const onShortNameChange = vi.fn();
  const onWizardKey = vi.fn();
  const utils = render(
    <div onKeyDown={(e) => onWizardKey(e.key)}>
      <CardTitlesStep
        cards={props.cards}
        titleContext={props.titleContext ?? CONTEXT}
        answers={[]}
        onAnswersChange={vi.fn()}
        shortName={props.shortName}
        onShortNameChange={props.withCallback === false ? undefined : onShortNameChange}
        headingId={props.headingId}
      />
    </div>,
  );
  return { ...utils, onShortNameChange, onWizardKey };
}

/** The box's own status region: the first in the step (each title row has one too). */
const boxStatus = () => screen.getAllByRole("status")[0];

const titleFields = () =>
  screen
    .queryAllByRole("textbox")
    .filter((el) => el.getAttribute("aria-label")?.startsWith("Title for")) as HTMLTextAreaElement[];

describe("CardTitlesStep — the box shows whenever the step lists titles", () => {
  test("prefilled with the builder's own description, with its lead and a meter", () => {
    setup({ cards: [card("1")] });
    expect(screen.getByRole("heading", { name: LEAD })).toBeTruthy();
    const field = screen.getByRole("textbox", { name: LABEL }) as HTMLInputElement;
    expect(field.value).toBe(PREFILL);
    expect(screen.getByText(`${PREFILL.length}/80`)).toBeTruthy();
    // No suggestion button any more: the box IS the suggestion.
    expect(screen.queryByRole("button", { name: "Use suggestion" })).toBeNull();
  });

  test("a stored value is the prefill, and over-cap titles still get the box", () => {
    setup({
      cards: [card("1")],
      titleContext: { ...OVER, listingShortName: `${OVER.setNameValue} Extra Words Here` },
    });
    expect((screen.getByRole("textbox", { name: LABEL }) as HTMLInputElement).value).toBe(
      `${OVER.setNameValue} Extra Words Here`,
    );
  });

  test("only a variation on the step: no box", () => {
    // A variation is never cut (NEO-609), so only a title short enough to
    // carry it whole leaves the variation as the sole fault.
    setup({
      cards: [card("1", { players: [], cardVariation: "v".repeat(66) })],
      titleContext: { ...CONTEXT, setNameValue: "X", inheritedFeatures: {} },
    });
    expect(screen.queryByRole("textbox", { name: LABEL })).toBeNull();
    expect(screen.getByRole("heading", { name: "Variation's too long to list. Trim it to 65." }))
      .toBeTruthy();
  });

  test("no callback from the wizard: no box", () => {
    setup({ cards: [card("1")], withCallback: false });
    expect(screen.queryByRole("textbox", { name: LABEL })).toBeNull();
  });
});

describe("CardTitlesStep — the box is a wrapping one-line field (NEO-535)", () => {
  test("a textarea that grows with its text; a pasted line break is a space; Enter settles in place", () => {
    const { onShortNameChange, onWizardKey } = setup({ cards: [card("1")] });
    const box = screen.getByRole("textbox", { name: LABEL }) as HTMLTextAreaElement;
    expect(box.tagName).toBe("TEXTAREA");
    expect(box.className).toContain("[field-sizing:content]");
    fireEvent.change(box, { target: { value: "2026 Topps\nChrome Sapphire" } });
    expect(box.value).toBe(BOX);
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onShortNameChange).toHaveBeenLastCalledWith(BOX);
    // Enter is the box's own: it never reaches the wizard behind it.
    expect(onWizardKey).not.toHaveBeenCalledWith("Enter");
  });
});

describe("CardTitlesStep — typing rewrites the listed titles live", () => {
  test("the titles follow the box; the list holds still", () => {
    setup({ cards: [card("1"), card("2")] });
    expect(titleFields()).toHaveLength(2);
    const box = screen.getByRole("textbox", { name: LABEL });
    fireEvent.change(box, { target: { value: BOX } });
    expect(titleFields().map((f) => f.value)).toEqual([
      `${BOX} Shohei Ohtani #1 Baseball`,
      `${BOX} Shohei Ohtani #2 Baseball`,
    ]);
    expect(screen.getByRole("heading", { name: TITLES_LEAD })).toBeTruthy();
    expect(screen.queryByText(/Left out to fit/)).toBeNull();
    fireEvent.blur(box);
    expect(boxStatus().textContent).toBe("Every title fits now.");
  });

  test("an edit that still runs long counts the titles over the cap", () => {
    setup({ cards: [card("1"), card("2", { players: ["Shohei Ohtani", "Shohei Ohtani"] })], titleContext: OVER });
    const long = `${OVER.setNameValue} Box`;
    const box = screen.getByRole("textbox", { name: LABEL });
    fireEvent.change(box, { target: { value: long } });
    fireEvent.blur(box);
    const fields = titleFields();
    expect(fields).toHaveLength(2);
    for (const f of fields) expect(f.value.startsWith(long)).toBe(true);
    expect(screen.getByText("2 titles still run long.")).toBeTruthy();
  });

  test("a refused value is an alert of its own, describes the box, and changes no title", () => {
    setup({ cards: [card("1")] });
    const before = titleFields()[0].value;
    const field = screen.getByRole("textbox", { name: LABEL });
    fireEvent.change(field, { target: { value: "Topps\u200bSapphire" } });
    expect(field.getAttribute("aria-invalid")).toBe("true");
    fireEvent.blur(field);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe(
      "Set name in titles can't hold zero-width or invisible characters.",
    );
    expect(alert.className).toContain("text-notice-danger-ink");
    expect((field.getAttribute("aria-describedby") ?? "").split(" ")).toContain(alert.id);
    // Progress stays in the status region; the refusal is not repeated there.
    expect(boxStatus().textContent).toBe("");
    expect(titleFields()[0].value).toBe(before);
    // Fixed: the alert goes, and the box is no longer described by it.
    fireEvent.change(field, { target: { value: BOX } });
    fireEvent.blur(field);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(field.getAttribute("aria-describedby")).not.toContain(alert.id);
  });

  test("the status is read at a settle, never per keystroke", () => {
    vi.useFakeTimers();
    setup({ cards: [card("1")] });
    const field = screen.getByRole("textbox", { name: LABEL });
    fireEvent.change(field, { target: { value: "2026 Topps" } });
    fireEvent.change(field, { target: { value: BOX } });
    expect(boxStatus().textContent).toBe("");
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(boxStatus().textContent).toBe("Every title fits now.");
  });

  test("past 80: the meter says so and the server's sentence explains; nothing is cut off", () => {
    setup({ cards: [card("1")] });
    const field = screen.getByRole("textbox", { name: LABEL }) as HTMLInputElement;
    expect(field.getAttribute("maxlength")).toBeNull();
    fireEvent.change(field, { target: { value: "x".repeat(84) } });
    expect(field.value).toHaveLength(84);
    expect(screen.getByText("84/80")).toBeTruthy();
    fireEvent.blur(field);
    expect(screen.getByRole("alert").textContent).toBe(
      "Set name in titles tops out at 80 characters.",
    );
  });

  test("an untouched prefill over 80 is no fault: it is never sent", () => {
    const longSet = "Chrome Update Series Sapphire Edition Platinum Anniversary Collectors Box Deluxe";
    const { onShortNameChange } = setup({ cards: [card("1")], titleContext: { ...CONTEXT, setNameValue: longSet } });
    const field = screen.getByRole("textbox", { name: LABEL }) as HTMLInputElement;
    expect(field.value.length).toBeGreaterThan(80);
    expect(field.getAttribute("aria-invalid")).toBeNull();
    expect(screen.queryByText(/tops out at/)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    // Said once, as status: the "N over" on the meter is no fault.
    expect(boxStatus().textContent).toBe(
      "Over 80, so it's sitting out. Trim it and your titles pick it up.",
    );
    fireEvent.blur(field);
    expect(onShortNameChange).not.toHaveBeenCalled();
  });

  test("an edit the wizard kept comes back when the step remounts", () => {
    setup({ cards: [card("1")], shortName: BOX });
    expect((screen.getByRole("textbox", { name: LABEL }) as HTMLInputElement).value).toBe(BOX);
    expect(titleFields()[0].value).toBe(`${BOX} Shohei Ohtani #1 Baseball`);
  });
});

describe("CardTitlesStep — the box's keys stay local; it reports only an edit", () => {
  test("Enter settles in place and never reaches the wizard", () => {
    const { onShortNameChange, onWizardKey } = setup({ cards: [card("1")] });
    const field = screen.getByRole("textbox", { name: LABEL });
    fireEvent.change(field, { target: { value: BOX } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onShortNameChange).toHaveBeenLastCalledWith(BOX);
    expect(onWizardKey).not.toHaveBeenCalled();
  });

  test("Escape undoes since focus in place; with nothing to undo it is the wizard's", () => {
    const { onWizardKey } = setup({ cards: [card("1")] });
    const field = screen.getByRole("textbox", { name: LABEL }) as HTMLInputElement;
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: BOX } });
    fireEvent.keyDown(field, { key: "Escape" });
    expect(field.value).toBe(PREFILL);
    expect(onWizardKey).not.toHaveBeenCalled();
    fireEvent.keyDown(field, { key: "Escape" });
    expect(onWizardKey).toHaveBeenCalledWith("Escape");
  });

  test("settles a beat after typing; back to the prefill, or blank, is no edit", () => {
    vi.useFakeTimers();
    const { onShortNameChange, unmount } = setup({ cards: [card("1")] });
    const field = screen.getByRole("textbox", { name: LABEL });
    fireEvent.change(field, { target: { value: `  ${BOX} ` } });
    expect(onShortNameChange).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(onShortNameChange).toHaveBeenLastCalledWith(BOX);
    fireEvent.change(field, { target: { value: ` ${PREFILL}` } });
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(onShortNameChange).toHaveBeenLastCalledWith(undefined);
    fireEvent.change(field, { target: { value: BOX } });
    fireEvent.change(field, { target: { value: "  " } });
    unmount();
    expect(onShortNameChange).toHaveBeenLastCalledWith(undefined);
  });

  test("described by its lead, its meter and its status line; the wizard's heading stays on the titles lead", () => {
    setup({ cards: [card("1")], headingId: "titles-lead" });
    const field = screen.getByRole("textbox", { name: LABEL });
    const described = () =>
      (field.getAttribute("aria-describedby") ?? "")
        .split(" ")
        .map((id) => document.getElementById(id)?.textContent);
    expect(described()).toContain(LEAD);
    expect(described()).toContain(`${PREFILL.length}/80`);
    expect(document.getElementById("titles-lead")?.textContent).toBe(TITLES_LEAD);
    fireEvent.change(field, { target: { value: BOX } });
    fireEvent.blur(field);
    expect(described()).toContain("Every title fits now.");
    expect(document.getElementById("titles-lead")?.textContent).toBe(TITLES_LEAD);
  });
});

describe("CardTitlesStep — a long list is capped", () => {
  test(`draws ${TITLE_ROWS_SHOWN} title rows and counts the rest`, () => {
    const cards = Array.from({ length: TITLE_ROWS_SHOWN + 12 }, (_, i) => card(String(i + 1)));
    setup({ cards, withCallback: false });
    expect(titleFields()).toHaveLength(TITLE_ROWS_SHOWN);
    expect(screen.getByText("And 12 more, saved as generated.")).toBeTruthy();
  });

  test("no count line when everything fits under the cap", () => {
    setup({ cards: [card("1")], withCallback: false });
    expect(screen.queryByText(/saved as generated/)).toBeNull();
  });
});

/**
 * NEO-637 (Jason, 2026-11-21) — the box rewrites only the titles whose field
 * shows the yellow "Left out to fit" line, hand-edited ones included. A hand
 * edit with the line gets the new set name in place of the old set-name text
 * (the rest of the edit kept), or the generated title when the old text is not
 * in it; a hand edit with no line is left exactly as typed.
 */
describe("CardTitlesStep — the box and a title the operator edited (NEO-637)", () => {
  /** The "Left out to fit" lines under a title field's own row (its group line is above the row). */
  const lineUnder = (field: HTMLElement) =>
    Array.from(field.closest("li")?.querySelectorAll("p") ?? []).filter((p) =>
      /^Left out to fit:/.test(p.textContent ?? ""),
    );

  test("a hand edit that shows the line: only the old set-name text is swapped, the rest is kept", () => {
    setup({ cards: [card("1"), card("2")] });
    const own = screen.getByRole("textbox", { name: "Title for #1 Card 1" }) as HTMLTextAreaElement;
    fireEvent.change(own, { target: { value: `${PREFILL} Ohtani my own #1 words` } });
    // The first name is out of that field and the other card's: the group's line shows.
    expect(screen.getAllByText(/^Left out to fit: Shohei/).length).toBeGreaterThan(0);
    fireEvent.change(screen.getByRole("textbox", { name: LABEL }), { target: { value: BOX } });
    expect(titleFields().map((f) => f.value)).toEqual([
      `${BOX} Ohtani my own #1 words`,
      `${BOX} Shohei Ohtani #2 Baseball`,
    ]);
    // Still the operator's own title: it can be taken back to the generated one.
    fireEvent.click(screen.getByRole("button", { name: "Use generated title for #1 Card 1" }));
    expect(titleFields()[0].value).toBe(`${BOX} Shohei Ohtani #1 Baseball`);
    expect(document.activeElement).toBe(titleFields()[0]);
  });

  test("the swap follows every keystroke of the box and lands on its last text", () => {
    setup({ cards: [card("1"), card("2")] });
    const own = screen.getByRole("textbox", { name: "Title for #1 Card 1" });
    fireEvent.change(own, { target: { value: `${PREFILL} Ohtani RC #1` } });
    const box = screen.getByRole("textbox", { name: LABEL });
    for (const text of ["2026", "2026 Topps", BOX]) {
      fireEvent.change(box, { target: { value: text } });
    }
    expect(titleFields()[0].value).toBe(`${BOX} Ohtani RC #1`);
  });

  test("a hand edit that shows the line but no longer holds the old set name is rebuilt", () => {
    setup({ cards: [card("1"), card("2")] });
    const own = screen.getByRole("textbox", { name: "Title for #1 Card 1" });
    fireEvent.change(own, { target: { value: "My Ohtani title #1" } });
    fireEvent.change(screen.getByRole("textbox", { name: LABEL }), { target: { value: BOX } });
    expect(titleFields().map((f) => f.value)).toEqual([
      `${BOX} Shohei Ohtani #1 Baseball`,
      `${BOX} Shohei Ohtani #2 Baseball`,
    ]);
    // Rebuilt means it is the generated title again, not an edit to take back.
    expect(screen.queryByRole("button", { name: "Use generated title for #1 Card 1" })).toBeNull();
  });

  test("a hand edit that shows no line is left as typed, old set name and all", () => {
    setup({ cards: [card("1"), card("2")] });
    const own = screen.getByRole("textbox", { name: "Title for #1 Card 1" }) as HTMLTextAreaElement;
    // Everything the card has is in it (the sport is never listed): no line.
    const whole = `${PREFILL} Shohei Ohtani #1 Baseball`;
    fireEvent.change(own, { target: { value: whole } });
    expect(lineUnder(own)).toHaveLength(0);
    fireEvent.change(screen.getByRole("textbox", { name: LABEL }), { target: { value: BOX } });
    expect(titleFields().map((f) => f.value)).toEqual([whole, `${BOX} Shohei Ohtani #2 Baseball`]);
  });

  test("Escape in the box takes the swap back with it", () => {
    setup({ cards: [card("1"), card("2")] });
    const own = screen.getByRole("textbox", { name: "Title for #1 Card 1" });
    fireEvent.change(own, { target: { value: `${PREFILL} Ohtani RC #1` } });
    const box = screen.getByRole("textbox", { name: LABEL });
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: BOX } });
    expect(titleFields()[0].value).toBe(`${BOX} Ohtani RC #1`);
    fireEvent.keyDown(box, { key: "Escape" });
    expect((box as HTMLTextAreaElement).value).toBe(PREFILL);
    expect(titleFields()[0].value).toBe(`${PREFILL} Ohtani RC #1`);
  });
});
