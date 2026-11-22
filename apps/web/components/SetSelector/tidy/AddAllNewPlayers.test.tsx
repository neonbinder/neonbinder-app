/**
 * NEO-645 (decision 32) — "Add all N new players": shown only for two or more,
 * an inline confirm (a group, never a dialog) that lists the names with their
 * card numbers, Esc and Enter as the walk means them, and the counts line.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../convex/_generated/api", () => ({
  api: { tidyNewPlayers: { newPlayerNames: "newPlayerNames", addNewPlayers: "addNewPlayers" } },
}));

const { convexQuery, addNewPlayers } = vi.hoisted(() => ({
  convexQuery: vi.fn(),
  addNewPlayers: vi.fn(),
}));
vi.mock("convex/react", () => ({
  useConvex: () => ({ query: convexQuery }),
  useMutation: (ref: string) => (ref === "addNewPlayers" ? addNewPlayers : vi.fn()),
}));

import AddAllNewPlayers, { cardNumbersText } from "./AddAllNewPlayers";
import { InlineStackProvider, useCloseTopInlinePart, useInlineStackOpen } from "./inline-stack";
import { useTidyKeys } from "./useTidyKeys";

const LEAF = "leaf1" as never;
const QUINN = { name: "Quinn Rookie", cardNumbers: ["4", "17"], moreCards: false };
const ABE = { name: "Abe Rookie", cardNumbers: ["9"], moreCards: true };

const onSave = vi.fn();
const onSaveForLater = vi.fn();

/** The walk's own key wiring around the control: Esc and Enter mean what they mean there. */
function Walk({ refreshKey = "k1" }: { refreshKey?: string }) {
  const inlineOpen = useInlineStackOpen();
  const closeTopInlinePart = useCloseTopInlinePart();
  const onKeys = useTidyKeys({ canSave: true, inlineOpen, closeTopInlinePart, onSave, onSaveForLater });
  return (
    <div onKeyDown={onKeys}>
      <AddAllNewPlayers leafId={LEAF} refreshKey={refreshKey} />
    </div>
  );
}
const ui = (refreshKey?: string) => (
  <InlineStackProvider>
    <Walk refreshKey={refreshKey} />
  </InlineStackProvider>
);

/** Let the settle timer run and the reply land. */
const settle = () => act(async () => void (await vi.advanceTimersByTimeAsync(500)));

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  convexQuery.mockResolvedValue({ names: [QUINN, ABE], more: false });
  addNewPlayers.mockResolvedValue({ created: 2, skipped: 0 });
});
afterEach(() => {
  vi.useRealTimers();
});

const trigger = () => screen.getByRole("button", { name: /^Add (all|the first) \d+ new players$/ });

describe("AddAllNewPlayers — when it shows", () => {
  it("shows nothing until the server has answered, and for none or one name", async () => {
    convexQuery.mockResolvedValue({ names: [QUINN], more: false });
    const { container } = render(ui());
    expect(container.textContent).toBe("");
    await settle();
    expect(screen.queryByRole("button")).toBeNull();
    convexQuery.mockResolvedValue({ names: [], more: false });
    render(ui("k2"));
    await settle();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("reads 'Add all N new players' for two or more", async () => {
    render(ui());
    await settle();
    expect(trigger().textContent).toBe("Add all 2 new players");
    expect(convexQuery).toHaveBeenCalledWith("newPlayerNames", { leafId: LEAF });
  });

  it("reads 'Add the first N new players' when the server cut the list", async () => {
    convexQuery.mockResolvedValue({ names: [QUINN, ABE], more: true });
    render(ui());
    await settle();
    expect(trigger().textContent).toBe("Add the first 2 new players");
  });

  it("asks again when what it depends on changes, once for a run of changes, and the older reply never wins", async () => {
    let release: (v: unknown) => void = () => {};
    convexQuery.mockImplementationOnce(() => new Promise((r) => (release = r)));
    const { rerender } = render(ui("k1"));
    await act(async () => void (await vi.advanceTimersByTimeAsync(450)));
    expect(convexQuery).toHaveBeenCalledTimes(1);
    convexQuery.mockResolvedValue({ names: [QUINN, ABE], more: false });
    rerender(ui("k2"));
    rerender(ui("k3"));
    await settle();
    expect(convexQuery).toHaveBeenCalledTimes(2);
    expect(trigger().textContent).toBe("Add all 2 new players");
    // The first ask answers late with a different list: dropped.
    await act(async () => release({ names: [QUINN, ABE, { ...QUINN, name: "Zed" }], more: false }));
    expect(trigger().textContent).toBe("Add all 2 new players");
  });

  it("a failed read leaves nothing on screen", async () => {
    convexQuery.mockRejectedValue(new Error("down"));
    render(ui());
    await settle();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("AddAllNewPlayers — the inline confirm", () => {
  async function opened() {
    render(ui());
    await settle();
    fireEvent.click(trigger());
    await act(async () => void (await vi.advanceTimersByTimeAsync(20)));
  }

  it("lists the names with their card numbers in a scrolling list, inline and not a dialog", async () => {
    await opened();
    expect(screen.queryByRole("dialog")).toBeNull();
    const group = screen.getByRole("group", { name: "New players to add" });
    expect(group).toBeTruthy();
    const list = screen.getByRole("list", { name: "Names to add" });
    expect(list.getAttribute("tabindex")).toBe("0");
    const items = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toEqual(["Quinn Rookie#4, #17", "Abe Rookie#9 and more"]);
    expect(screen.getByRole("button", { name: "Add 2 players" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel adding new players" })).toBeTruthy();
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
  });

  it("opens with focus on the list, so a second Enter never confirms", async () => {
    await opened();
    expect(document.activeElement).toBe(screen.getByRole("list", { name: "Names to add" }));
    fireEvent.keyDown(document.activeElement!, { key: "Enter" });
    expect(addNewPlayers).not.toHaveBeenCalled();
    // And it is not the walk's Save & next either.
    expect(onSave).not.toHaveBeenCalled();
  });

  it("Esc closes the confirm and gives focus back, and is not Save for later", async () => {
    await opened();
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await act(async () => void (await vi.advanceTimersByTimeAsync(20)));
    expect(screen.queryByRole("group", { name: "New players to add" })).toBeNull();
    expect(onSaveForLater).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger());
    // Nothing inline open any more: the next Esc is the walk's.
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(onSaveForLater).toHaveBeenCalledTimes(1);
  });

  it("Cancel closes it, writes nothing and gives focus back", async () => {
    await opened();
    fireEvent.click(screen.getByRole("button", { name: "Cancel adding new players" }));
    await act(async () => void (await vi.advanceTimersByTimeAsync(20)));
    expect(screen.queryByRole("group", { name: "New players to add" })).toBeNull();
    expect(addNewPlayers).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger());
  });

  it("pressing the control again closes it", async () => {
    await opened();
    fireEvent.click(trigger());
    expect(screen.queryByRole("group", { name: "New players to add" })).toBeNull();
  });

  it("Enter on the confirm button is the button's own (a click), never also Save & next", async () => {
    await opened();
    const add = screen.getByRole("button", { name: "Add 2 players" });
    add.focus();
    // A button activates on Enter itself; the walk's handler must leave it alone.
    const event = fireEvent.keyDown(add, { key: "Enter" });
    expect(event).toBe(true);
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe("AddAllNewPlayers — the write", () => {
  async function confirmed(counts: { created: number; skipped: number }) {
    addNewPlayers.mockResolvedValue(counts);
    render(ui());
    await settle();
    fireEvent.click(trigger());
    await act(async () => void (await vi.advanceTimersByTimeAsync(20)));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add 2 players" })));
    await act(async () => void (await vi.advanceTimersByTimeAsync(20)));
  }

  it("sends the leaf and every offered name, then says how many were added", async () => {
    await confirmed({ created: 2, skipped: 0 });
    expect(addNewPlayers).toHaveBeenCalledWith({ leafId: LEAF, names: ["Quinn Rookie", "Abe Rookie"] });
    expect(screen.getByRole("status").textContent).toBe("Added 2 players.");
    expect(screen.queryByRole("group", { name: "New players to add" })).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it("counts the names it left as they were", async () => {
    await confirmed({ created: 1, skipped: 1 });
    expect(screen.getByRole("status").textContent).toBe("Added 1 player. 1 left as it was.");
  });

  it("says so when nothing was added", async () => {
    await confirmed({ created: 0, skipped: 2 });
    expect(screen.getByRole("status").textContent).toBe("No players added.");
  });

  it("says Adding… while it runs, and holds both buttons", async () => {
    let finish: (v: unknown) => void = () => {};
    addNewPlayers.mockImplementation(() => new Promise((r) => (finish = r)));
    render(ui());
    await settle();
    fireEvent.click(trigger());
    await act(async () => void (await vi.advanceTimersByTimeAsync(20)));
    fireEvent.click(screen.getByRole("button", { name: "Add 2 players" }));
    expect(screen.getByRole("status").textContent).toBe("Adding…");
    expect(screen.getByRole("button", { name: "Add 2 players" }).getAttribute("aria-disabled")).toBe("true");
    // A second press while it runs does not send a second write.
    fireEvent.click(screen.getByRole("button", { name: "Add 2 players" }));
    expect(addNewPlayers).toHaveBeenCalledTimes(1);
    await act(async () => finish({ created: 2, skipped: 0 }));
    expect(screen.getByRole("status").textContent).toBe("Added 2 players.");
  });

  it("stays on the page after the offer empties, disabled, and a bigger offer is a new question", async () => {
    addNewPlayers.mockResolvedValue({ created: 2, skipped: 0 });
    const { rerender } = render(ui("k1"));
    await settle();
    fireEvent.click(trigger());
    await act(async () => void (await vi.advanceTimersByTimeAsync(20)));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add 2 players" })));
    // The names are answered now: nobody left to offer.
    convexQuery.mockResolvedValue({ names: [], more: false });
    rerender(ui("k2"));
    await settle();
    const held = screen.getByRole("button", { name: "Add all 2 new players" });
    expect(held.getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByRole("status").textContent).toBe("Added 2 players.");
    // The next hundred arrive: a new question, the old result goes.
    convexQuery.mockResolvedValue({ names: [QUINN, ABE, { ...QUINN, name: "Cy Rookie" }], more: false });
    rerender(ui("k3"));
    await settle();
    expect(screen.getByRole("button", { name: "Add all 3 new players" }).getAttribute("aria-disabled")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("a failed write keeps the confirm open with a way to try again", async () => {
    addNewPlayers.mockRejectedValue(new Error("nope"));
    render(ui());
    await settle();
    fireEvent.click(trigger());
    await act(async () => void (await vi.advanceTimersByTimeAsync(20)));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add 2 players" })));
    expect(screen.getByRole("alert").textContent).toBe("Didn't add the players, try again.");
    expect(screen.getByRole("group", { name: "New players to add" })).toBeTruthy();
    addNewPlayers.mockResolvedValue({ created: 2, skipped: 0 });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add 2 players" })));
    expect(screen.getByRole("status").textContent).toBe("Added 2 players.");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("cardNumbersText", () => {
  it("lists numbers with a hash, and 'and more' when the list was cut", () => {
    expect(cardNumbersText({ cardNumbers: ["4", "17"], moreCards: false })).toBe("#4, #17");
    expect(cardNumbersText({ cardNumbers: ["4"], moreCards: true })).toBe("#4 and more");
  });
});

describe("AddAllNewPlayers — the confirm's host (NEO-645 audit)", () => {
  function Hosted({ host }: { host: HTMLElement | null }) {
    return (
      <InlineStackProvider>
        <AddAllNewPlayers leafId={LEAF} refreshKey="k1" panelHost={host} />
      </InlineStackProvider>
    );
  }

  it("draws the confirm into the host element, while the control stays where it was put", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const { container } = render(<Hosted host={host} />);
    await settle();
    fireEvent.click(trigger());
    await act(async () => void (await vi.advanceTimersByTimeAsync(20)));
    const group = screen.getByRole("group", { name: "New players to add" });
    expect(host.contains(group)).toBe(true);
    expect(container.contains(group)).toBe(false);
    expect(container.contains(trigger())).toBe(true);
    // The control still names what it controls, across the two places.
    expect(trigger().getAttribute("aria-controls")).toBe(group.id);
    // Closing takes the confirm out of the host again, which leaves it empty.
    fireEvent.click(screen.getByRole("button", { name: "Cancel adding new players" }));
    expect(host.childElementCount).toBe(0);
    host.remove();
  });

  it("with no host yet, opens right under the control as before", async () => {
    const { container } = render(<Hosted host={null} />);
    await settle();
    fireEvent.click(trigger());
    await act(async () => void (await vi.advanceTimersByTimeAsync(20)));
    expect(container.contains(screen.getByRole("group", { name: "New players to add" }))).toBe(true);
  });

  it("its confirm and list take the strong edge", async () => {
    render(<Hosted host={null} />);
    await settle();
    fireEvent.click(trigger());
    await act(async () => void (await vi.advanceTimersByTimeAsync(20)));
    expect(screen.getByRole("group", { name: "New players to add" }).className).toContain("border-rule-strong");
    expect(screen.getByRole("list", { name: "Names to add" }).className).toContain("border-rule-strong");
  });
});

