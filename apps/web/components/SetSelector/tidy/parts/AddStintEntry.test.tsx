/**
 * NEO-657 — AddStintEntry with the real CareerTeamEntry beneath it: the
 * prefilled form (Enter on a year adds once and closes it) and the hand-opened
 * one (no draft reported to the host).
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../../../convex/_generated/dataModel";

vi.mock("../../../../convex/_generated/api", () => ({
  api: { teams: { pickerCandidates: "teams.pickerCandidates" } },
}));

// One array, as Convex hands back: the form holds the last answer by identity.
const NO_TEAMS: unknown[] = [];
vi.mock("convex/react", () => ({
  useQuery: (_ref: string, args: unknown) => (args === "skip" ? undefined : NO_TEAMS),
}));

import AddStintEntry from "./AddStintEntry";

const SPORT = "sport-1" as unknown as Id<"selectorOptions">;
const LEAF = "leaf-1" as unknown as Id<"selectorOptions">;
const PADRES = "team-pad" as unknown as Id<"teams">;
const prefill = { teamId: PADRES, name: "San Diego Padres", fromYear: 2024, toYear: 2024 };

const GROUP = "New stint for Jackson Merrill, prefilled from the card";

function element(onAdd: () => Promise<boolean>, onDraft: () => void, opts: { prefill?: typeof prefill }) {
  return (
    <AddStintEntry
      playerName="Jackson Merrill"
      sportId={SPORT}
      leafId={LEAF}
      disabled={false}
      onAdd={onAdd}
      onDraft={onDraft}
      {...opts}
    />
  );
}

function mount(opts: { prefill?: typeof prefill } = {}) {
  const onAdd = vi.fn(async () => true);
  const onDraft = vi.fn();
  const view = render(element(onAdd, onDraft, opts));
  return {
    onAdd,
    onDraft,
    /** Re-render the same instance with a different prefill (no remount). */
    setPrefill: (next: typeof prefill | undefined) =>
      view.rerender(element(onAdd, onDraft, { prefill: next })),
  };
}

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
    cb();
    return 0;
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("AddStintEntry (NEO-657)", () => {
  it("Enter on a year field of the prefilled form adds the stint once and closes the form", async () => {
    const { onAdd } = mount({ prefill });
    const from = screen.getByLabelText(/^From year/);
    await act(async () => {
      fireEvent.keyDown(from, { key: "Enter" });
    });
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd).toHaveBeenCalledWith({
      name: "San Diego Padres",
      fromYear: 2024,
      toYear: 2024,
      teamId: PADRES,
    });
    expect(screen.queryByLabelText(/^From year/)).toBeNull();
    expect(screen.getByRole("button", { name: "+ Add stint for Jackson Merrill" })).toBeTruthy();
  });

  it("a hand-opened form reports no draft", async () => {
    const { onDraft } = mount();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "+ Add stint for Jackson Merrill" }));
    });
    expect(screen.getByLabelText(/^From year/)).toBeTruthy();
    expect(onDraft).not.toHaveBeenCalled();
  });

  it("the auto-opened prefilled form takes focus on From year", () => {
    mount({ prefill });
    expect(document.activeElement).toBe(screen.getByLabelText(/^From year/));
  });

  it("the prefilled form is a named group", () => {
    mount({ prefill });
    expect(screen.getByRole("group", { name: GROUP })).toBeTruthy();
  });

  it("the hand-opened form is not a named group", async () => {
    mount();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "+ Add stint for Jackson Merrill" }));
    });
    expect(screen.getByLabelText(/^From year/)).toBeTruthy();
    expect(screen.queryByRole("group", { name: GROUP })).toBeNull();
  });

  it("focus returns to '+ Add stint' after + Add on the prefilled form", async () => {
    // A real frame later, as in the browser: the button exists by then.
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => setTimeout(cb, 0));
    const { onAdd } = mount({ prefill });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add career team for Jackson Merrill" }));
    });
    expect(onAdd).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "+ Add stint for Jackson Merrill" }),
      ),
    );
  });

  it("a prefill arriving later opens the form; going away closes it", async () => {
    const view = mount();
    expect(screen.queryByLabelText(/^From year/)).toBeNull();
    await act(async () => {
      view.setPrefill(prefill);
    });
    expect((screen.getByLabelText(/^From year/) as HTMLInputElement).value).toBe("2024");
    expect(screen.getByRole("group", { name: GROUP })).toBeTruthy();
    await act(async () => {
      view.setPrefill(undefined);
    });
    expect(screen.queryByLabelText(/^From year/)).toBeNull();
    expect(screen.queryByRole("group", { name: GROUP })).toBeNull();
  });
});
