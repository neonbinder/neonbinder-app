/**
 * NEO-657 — AddStintEntry with the real CareerTeamEntry beneath it: the
 * prefilled form (Enter on a year adds once and closes it) and the hand-opened
 * one (no draft reported to the host).
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
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

function mount(opts: { prefill?: typeof prefill } = {}) {
  const onAdd = vi.fn(async () => true);
  const onDraft = vi.fn();
  render(
    <AddStintEntry
      playerName="Jackson Merrill"
      sportId={SPORT}
      leafId={LEAF}
      disabled={false}
      onAdd={onAdd}
      onDraft={onDraft}
      {...opts}
    />,
  );
  return { onAdd, onDraft };
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
});
