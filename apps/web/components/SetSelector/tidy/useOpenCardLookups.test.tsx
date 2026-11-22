/**
 * NEO-645 — opening a card asks Wikidata about names nobody has asked about.
 *
 * A name row the legacy-name migration (M2) wrote is born `ready` with no
 * enrichment, so nothing would ever look it up. The walk offers each such name
 * once per sitting; the server decides whether it was really never asked.
 */
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../convex/_generated/api", () => ({
  api: {
    tidyNames: { requestLookup: "requestLookup", requestTeamLookup: "requestTeamLookup" },
  },
}));

const requestLookup = vi.fn();
const requestTeamLookup = vi.fn();
vi.mock("convex/react", () => ({
  useMutation: (ref: string) => (ref === "requestLookup" ? requestLookup : requestTeamLookup),
}));

import { namesToAskAbout, useOpenCardLookups } from "./useOpenCardLookups";
import type { TidyCardContext } from "./tile-types";

type Context = NonNullable<TidyCardContext>;
type Name = Context["names"][number];

const name = (over: Partial<Name> & { kind: Name["kind"]; printed: string }): Name =>
  ({
    nameNormalized: over.printed.toLowerCase(),
    order: 0,
    cardOverride: false,
    scopeId: "leaf1",
    printedOn: null,
    row: { name: over.printed, sportId: "sport1", status: "ready", neverLooked: true },
    ...over,
  }) as unknown as Name;

const context = (names: Name[], cardId = "card1"): Context =>
  ({ cardId, names, players: [], playersMore: false, teams: [], linkedFor: [] }) as unknown as Context;

function Probe({ ctx }: { ctx: Context | undefined | null }) {
  useOpenCardLookups(ctx);
  return null;
}

beforeEach(() => {
  requestLookup.mockReset().mockResolvedValue(null);
  requestTeamLookup.mockReset().mockResolvedValue(null);
});

describe("namesToAskAbout", () => {
  it("keeps only the names the server says were never looked up", () => {
    const row = (over: Record<string, unknown>) =>
      ({ sportId: "s", status: "ready", neverLooked: false, ...over }) as never;
    const ctx = context([
      name({ kind: "player", printed: "Never Asked" }),
      // A lookup that finished and found nothing: ready, bare, unanswered, but asked.
      name({ kind: "player", printed: "Finished Miss", row: row({ name: "Finished Miss" }) }),
      name({ kind: "team", printed: "Pending", row: row({ name: "Pending", status: "pending" }) }),
      name({
        kind: "player",
        printed: "Answered",
        row: row({ name: "Answered", answer: { kind: "notEntity", by: "operator" } }),
      }),
      name({ kind: "team", printed: "Enriched", row: row({ name: "Enriched", enrichment: { league: "X" } }) }),
      name({ kind: "team", printed: "No Row", row: null }),
    ]);
    expect(namesToAskAbout(ctx).map((n) => n.printed)).toEqual(["Never Asked"]);
  });
});

describe("useOpenCardLookups", () => {
  it("asks a player name through requestLookup and a team name through requestTeamLookup, in the row's sport", () => {
    render(
      <Probe
        ctx={context([
          name({ kind: "player", printed: "Rookie Newguy" }),
          name({ kind: "team", printed: "Pads" }),
        ])}
      />,
    );
    expect(requestLookup).toHaveBeenCalledWith({ cardId: "card1", kind: "player", name: "Rookie Newguy" });
    expect(requestTeamLookup).toHaveBeenCalledWith({ cardId: "card1", name: "Pads", sportId: "sport1" });
  });

  it("sends nothing for a name whose lookup already finished", () => {
    render(
      <Probe
        ctx={context([
          name({
            kind: "player",
            printed: "Finished Miss",
            row: { name: "Finished Miss", sportId: "sport1", status: "ready", neverLooked: false } as never,
          }),
          name({
            kind: "team",
            printed: "Finished Team",
            row: { name: "Finished Team", sportId: "sport1", status: "ready", neverLooked: false } as never,
          }),
        ])}
      />,
    );
    expect(requestLookup).not.toHaveBeenCalled();
    expect(requestTeamLookup).not.toHaveBeenCalled();
  });

  it("offers each name once per sitting, however often the context re-renders", () => {
    const ctx = context([name({ kind: "player", printed: "Rookie Newguy" })]);
    const { rerender } = render(<Probe ctx={ctx} />);
    rerender(<Probe ctx={{ ...ctx }} />);
    rerender(<Probe ctx={{ ...ctx }} />);
    expect(requestLookup).toHaveBeenCalledTimes(1);
  });

  it("asks again for the same name on another card", () => {
    const names = [name({ kind: "player", printed: "Rookie Newguy" })];
    const { rerender } = render(<Probe ctx={context(names, "card1")} />);
    rerender(<Probe ctx={context(names, "card2")} />);
    expect(requestLookup).toHaveBeenCalledTimes(2);
  });

  it("does nothing while the context is loading or the card is gone", () => {
    const { rerender } = render(<Probe ctx={undefined} />);
    rerender(<Probe ctx={null} />);
    expect(requestLookup).not.toHaveBeenCalled();
    expect(requestTeamLookup).not.toHaveBeenCalled();
  });

  it("a failed ask is swallowed: the tile stays as it was", async () => {
    requestLookup.mockRejectedValue(new Error("nope"));
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    render(<Probe ctx={context([name({ kind: "player", printed: "Rookie Newguy" })])} />);
    await new Promise((r) => setTimeout(r, 0));
    process.off("unhandledRejection", unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });
});
