/**
 * NEO-645 — the shared parts' accessibility: 24px checkbox rows that hold with
 * aria-disabled (never native `disabled`), and the team chips' non-colour mark.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../convex/_generated/api", () => ({
  api: new Proxy(
    {},
    {
      get: (_t, mod) =>
        typeof mod !== "string" || mod === "then"
          ? undefined
          : new Proxy(
              {},
              {
                get: (_t2, fn) => (typeof fn !== "string" || fn === "then" ? undefined : `${mod}.${fn}`),
              },
            ),
    },
  ),
}));
const queryResults: Record<string, unknown> = {};
const mutations: Record<string, ReturnType<typeof vi.fn>> = {};
const mutation = (ref: string) => (mutations[ref] ??= vi.fn().mockResolvedValue({ confirmed: true }));
vi.mock("convex/react", () => ({
  useQuery: (ref: string, args: unknown) => (args === "skip" ? undefined : queryResults[ref]),
  useMutation: (ref: string) => mutation(ref),
  useConvex: () => ({ query: vi.fn() }),
}));
vi.mock("../../EntityLinkSearch", () => ({
  default: ({ onSelect, onCancel }: { onSelect: (id: string, n: string) => void; onCancel: () => void }) => (
    <div>
      <button type="button" onClick={() => onSelect("team-9", "Other")}>
        Pick another team
      </button>
      <button type="button" onClick={onCancel}>
        Cancel linking
      </button>
    </div>
  ),
}));

import { AnsweredProvider } from "../answered";
import TeamFillChips from "./TeamFillChips";
import WikidataBlock from "./WikidataBlock";
import { useTidyWrite } from "./tidy-write";
import type { TidyRow } from "../tile-types";

const careerTeams = [
  { name: "Padres", fromYear: 2020, toYear: 2022 },
  { name: "Dodgers", fromYear: 2023 },
];

describe("WikidataBlock career-team boxes", () => {
  it("are 24px targets in rows that do not touch, and hold with aria-disabled", () => {
    const onToggle = vi.fn();
    const { rerender } = render(
      <WikidataBlock
        status="ready"
        enrichment={{ careerTeams, description: "Pitcher" }}
        onToggleCareerTeam={onToggle}
      />,
    );
    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes).toHaveLength(2);
    for (const box of boxes) {
      expect(box.className).toContain("h-6");
      expect(box.className).toContain("w-6");
      expect(box.closest("label")?.className).toContain("min-h-6");
    }
    expect(boxes[0].closest("ul")?.className).toContain("gap-1");
    fireEvent.click(boxes[0]);
    expect(onToggle).toHaveBeenCalledWith("Padres");

    onToggle.mockClear();
    rerender(
      <WikidataBlock
        status="ready"
        enrichment={{ careerTeams, description: "Pitcher" }}
        onToggleCareerTeam={onToggle}
        disabled
      />,
    );
    const held = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(held[0].getAttribute("aria-disabled")).toBe("true");
    // Never native `disabled`: focus stays on the box through a write.
    expect(held[0].disabled).toBe(false);
    fireEvent.click(held[0]);
    expect(onToggle).not.toHaveBeenCalled();
  });
});

function Chips({
  onAnswered = () => {},
  row = {},
  players = [{ playerId: "player-1", name: "Jackson Merrill", sportId: "sport-1", stints: [], stintsMore: false }],
}: {
  onAnswered?: () => void;
  row?: Record<string, unknown>;
  players?: Array<Record<string, unknown>>;
}) {
  const write = useTidyWrite();
  return (
    <AnsweredProvider value={onAnswered}>
      <TeamFillChips
        row={{ _id: "c1", cardNumber: "1", cardName: "X", playerIds: ["player-1"], ...row } as unknown as TidyRow}
        sportId={"sport-1" as never}
        leafId={"leaf-1" as never}
        players={players as never}
        leafCards={[]}
        write={write}
      />
    </AnsweredProvider>
  );
}

/** main's wizard query, for one player: Padres answer, Mariners offered beside them. */
const evidence = () => ({
  setYear: 2024,
  sportId: "sport-1",
  setLeagueIds: [],
  setLeagueId: null,
  teamNames: [],
  players: [
    {
      playerId: "player-1",
      answer: { tier: "career", teams: [{ teamId: "t1", name: "San Diego Padres" }] },
      candidates: [
        { teamId: "t1", name: "San Diego Padres" },
        { teamId: "t2", name: "Seattle Mariners" },
      ],
      stints: [{ teamId: "t2", fromYear: 2015, toYear: 2019 }],
    },
  ],
});

beforeEach(() => {
  for (const k of Object.keys(queryResults)) delete queryResults[k];
  for (const k of Object.keys(mutations)) delete mutations[k];
  queryResults["cardChecklist.teamSuggestionsForPreview"] = evidence();
});

describe("TeamFillChips", () => {
  it("chips are 24px hit areas and carry a check glyph (not colour alone) when chosen", () => {
    render(<Chips />);
    const chosen = screen.getByRole("button", { name: /San Diego Padres/ });
    const idle = screen.getByRole("button", { name: /Seattle Mariners/ });
    expect(chosen.className).toContain("hit-area-24");
    expect(idle.className).toContain("hit-area-24");
    // A chip acts (a click saves it), so it is a plain button, not a toggle.
    expect(chosen.getAttribute("aria-pressed")).toBeNull();
    expect(idle.getAttribute("aria-pressed")).toBeNull();
    expect(chosen.getAttribute("aria-current")).toBe("true");
    expect(idle.getAttribute("aria-current")).toBeNull();
    expect(chosen.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(idle.querySelector("svg")).toBeNull();
  });

  it("reads its headings, status and chip suffixes in the quiet ink, not link blue", () => {
    const { container } = render(<Chips />);
    // The line over the career chips, and the played-here suffix on a chip.
    const heading = container.querySelector<HTMLElement>('p[id^="fill-career-"]');
    expect(heading?.className).toContain("text-ink-2");
    const suffix = screen
      .getByRole("button", { name: /San Diego Padres/ })
      .querySelector<HTMLElement>("span.block");
    expect(suffix?.className).toContain("text-ink-2");
    // Blue stays on hover only: no resting text in the chips' area is blue.
    const resting = Array.from(container.querySelectorAll<HTMLElement>("p, li span")).filter((el) =>
      el.className.split(/\s+/).includes("text-neon-blue-text"),
    );
    expect(resting).toHaveLength(0);
  });

  it("each chip list is labelled by the heading above it, and a chip reads 'Team · Player years' with the separator", () => {
    const { container } = render(<Chips />);
    const lists = Array.from(container.querySelectorAll<HTMLElement>("ul[aria-labelledby]"));
    expect(lists.length).toBeGreaterThan(0);
    for (const ul of lists) {
      const id = ul.getAttribute("aria-labelledby") ?? "";
      expect(id).toMatch(/^fill-(listing|career)-c1$/);
      const heading = container.querySelector<HTMLElement>(`[id="${id}"]`);
      expect(heading).not.toBeNull();
      expect(heading?.textContent?.trim()).not.toBe("");
      expect(screen.getByRole("list", { name: heading?.textContent?.trim() ?? "" })).toBe(ul);
    }
    // The Mariners chip is not preselected, so it shows the player's years there.
    expect(screen.getByRole("button", { name: "Seattle Mariners · 2015–2019" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "San Diego Padres · Jackson Merrill played here" })).toBeTruthy();
  });

  it("with two players on the card the years line names each player after the separator", () => {
    const two = evidence();
    two.players.push({
      playerId: "player-2",
      answer: { tier: "career", teams: [{ teamId: "t1", name: "San Diego Padres" }] },
      candidates: [{ teamId: "t2", name: "Seattle Mariners" }],
      stints: [{ teamId: "t2", fromYear: 2010, toYear: 2012 }],
    } as never);
    queryResults["cardChecklist.teamSuggestionsForPreview"] = two;
    render(
      <Chips
        row={{ playerIds: ["player-1", "player-2"] }}
        players={[
          { playerId: "player-1", name: "Jackson Merrill", sportId: "sport-1", stints: [], stintsMore: false },
          { playerId: "player-2", name: "Pete Rose", sportId: "sport-1", stints: [], stintsMore: false },
        ]}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Seattle Mariners · Jackson Merrill 2015–2019; Pete Rose 2010–2012" }),
    ).toBeTruthy();
  });

  it("clicking a chip saves it, and that is an answer: the walk is told once it lands", async () => {
    const onAnswered = vi.fn();
    render(<Chips onAnswered={onAnswered} />);
    expect(screen.queryByRole("button", { name: /^Save teams?$/ })).toBeNull();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /San Diego Padres/ })));
    expect(mutation("selectorOptions.updateCard")).toHaveBeenCalledWith({
      id: "c1",
      teamOnCardIds: ["t1"],
      regenerateListing: true,
    });
    expect(onAnswered).toHaveBeenCalledTimes(1);
  });

  it("'No team on this card' is an answer, and a refused one is not", async () => {
    const onAnswered = vi.fn();
    render(<Chips onAnswered={onAnswered} />);
    mutation("cardChecklist.confirmCardNoTeam").mockResolvedValueOnce({ confirmed: false });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "No team on this card" })));
    expect(onAnswered).not.toHaveBeenCalled();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "No team on this card" })));
    expect(onAnswered).toHaveBeenCalledTimes(1);
  });

  it("a team picked with Other team… is saved right away and is an answer", async () => {
    const onAnswered = vi.fn();
    render(<Chips onAnswered={onAnswered} />);
    fireEvent.click(screen.getByRole("button", { name: "Other team…" }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Pick another team" })));
    expect(mutation("selectorOptions.updateCard")).toHaveBeenCalledWith({
      id: "c1",
      teamOnCardIds: ["team-9"],
      regenerateListing: true,
    });
    expect(onAnswered).toHaveBeenCalledTimes(1);
  });

  it("Cancel on the search returns focus to Other team…", async () => {
    render(<Chips />);
    const other = screen.getByRole("button", { name: "Other team…" });
    other.focus();
    fireEvent.click(other);
    fireEvent.click(screen.getByRole("button", { name: "Cancel linking" }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Other team…" })));
  });
});
