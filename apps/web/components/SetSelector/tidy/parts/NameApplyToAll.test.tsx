/**
 * NEO-656 — "Apply to all" for a printed name. An answer links the open card
 * only; this offers it to the checklist's OTHER cards still waiting on the name
 * (J3: a card already linked to something else is never offered), and the
 * result line says what the server did.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../convex/_generated/api", () => ({
  api: { tidyNames: { applyNameToAll: "tidyNames.applyNameToAll" } },
}));
const mockApply = vi.fn();
vi.mock("convex/react", () => ({
  useAction: (ref: string) => (ref === "tidyNames.applyNameToAll" ? mockApply : vi.fn()),
}));

import NameApplyToAll from "./NameApplyToAll";
import type { TidyRow } from "../tile-types";

const card = (id: string, extra: Record<string, unknown> = {}) =>
  ({ _id: id, cardNumber: id.toUpperCase(), ...extra }) as unknown as TidyRow;

function renderApply(
  over: {
    kind?: "player" | "team";
    answer?: React.ComponentProps<typeof NameApplyToAll>["answer"];
    leafCards?: TidyRow[];
  } = {},
) {
  return render(
    <NameApplyToAll
      cardId={"c1" as never}
      kind={over.kind ?? "player"}
      printed="Jackson Merrill"
      answer={over.answer ?? { kind: "linkPlayer", playerId: "player-1" as never }}
      leafCards={
        over.leafCards ?? [
          card("c1", { playerIds: ["player-1"] }),
          card("c2", { pendingPlayerNames: ["Jackson Merrill"] }),
          card("c3", { pendingPlayerNames: ["jackson merrill"] }),
        ]
      }
    />,
  );
}

const button = () => screen.getByRole("button", { name: /^Apply to all cards printing/ });

beforeEach(() => {
  mockApply.mockReset();
  mockApply.mockResolvedValue({ linked: 2, skipped: 0 });
});

describe("NameApplyToAll", () => {
  it("is offered only while another card still waits on the name, and never counts the open card", () => {
    renderApply();
    expect(button().textContent).toBe("Apply to all cards printing “Jackson Merrill”");
  });

  it("offers nothing when every other card is linked already (a card linked elsewhere is never moved)", () => {
    const { container } = renderApply({
      leafCards: [card("c1", { pendingPlayerNames: ["Jackson Merrill"] }), card("c2", { playerIds: ["player-9"] })],
    });
    expect(container.querySelector("button")).toBeNull();
  });

  it("a name waiting as a TEAM on another card is not a player's waiting card", () => {
    const { container } = renderApply({
      leafCards: [card("c1"), card("c2", { pendingTeamNames: ["Jackson Merrill"] })],
    });
    expect(container.querySelector("button")).toBeNull();
  });

  it("sends the open card's own answer and name, and says how many cards were linked", async () => {
    renderApply();
    await act(async () => fireEvent.click(button()));
    expect(mockApply).toHaveBeenCalledWith({
      cardId: "c1",
      kind: "player",
      name: "Jackson Merrill",
      answer: { kind: "linkPlayer", playerId: "player-1" },
    });
    expect(screen.getByText("Linked 2 more cards.")).toBeTruthy();
  });

  it("says how many it left as they were", async () => {
    mockApply.mockResolvedValueOnce({ linked: 1, skipped: 1 });
    renderApply();
    await act(async () => fireEvent.click(button()));
    expect(screen.getByText("Linked 1 more card. 1 left as it was.")).toBeTruthy();
  });

  it("says no cards changed when the server linked none", async () => {
    mockApply.mockResolvedValueOnce({ linked: 0, skipped: 2 });
    renderApply();
    await act(async () => fireEvent.click(button()));
    expect(screen.getByText("No cards changed.")).toBeTruthy();
  });

  it("'Not a player' is applied as 'Cleared', never 'Linked'", async () => {
    mockApply.mockResolvedValueOnce({ linked: 3, skipped: 0 });
    renderApply({ answer: { kind: "notEntity" } });
    await act(async () => fireEvent.click(button()));
    expect(mockApply.mock.calls[0][0].answer).toEqual({ kind: "notEntity" });
    expect(screen.getByText("Cleared 3 more cards.")).toBeTruthy();
  });

  it("a team answer reads the team's waiting names", async () => {
    renderApply({
      kind: "team",
      answer: { kind: "linkTeam", teamId: "team-1" as never },
      leafCards: [card("c1"), card("c2", { pendingTeamNames: ["Jackson Merrill"] })],
    });
    await act(async () => fireEvent.click(button()));
    expect(mockApply.mock.calls[0][0]).toMatchObject({ kind: "team", answer: { kind: "linkTeam", teamId: "team-1" } });
  });

  it("a refused apply says so inline and offers the button again", async () => {
    mockApply.mockRejectedValueOnce(new Error("nope"));
    renderApply();
    await act(async () => fireEvent.click(button()));
    expect(screen.getByRole("alert").textContent).toBe("Didn't apply, try again.");
    expect(button().getAttribute("aria-disabled")).toBeNull();
  });
});
