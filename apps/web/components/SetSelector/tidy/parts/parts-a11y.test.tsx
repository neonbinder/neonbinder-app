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

function Chips({ onAnswered = () => {}, row = {} }: { onAnswered?: () => void; row?: Record<string, unknown> }) {
  const write = useTidyWrite();
  return (
    <AnsweredProvider value={onAnswered}>
      <TeamFillChips
        row={{ _id: "c1", cardNumber: "1", cardName: "X", ...row } as unknown as TidyRow}
        sportId={"sport-1" as never}
        leafId={"leaf-1" as never}
        players={[]}
        write={write}
      />
    </AnsweredProvider>
  );
}

const suggestion = (teamId: string, label: string, inSetYear: boolean) => ({
  teamId,
  label,
  playerName: "Jackson Merrill",
  inSetYear,
});

beforeEach(() => {
  for (const k of Object.keys(queryResults)) delete queryResults[k];
  for (const k of Object.keys(mutations)) delete mutations[k];
  queryResults["cardChecklist.suggestedTeamsForCard"] = [
    suggestion("t1", "San Diego Padres", true),
    suggestion("t2", "Seattle Mariners", false),
  ];
});

describe("TeamFillChips", () => {
  it("chips are 24px hit areas and carry a check glyph (not colour alone) when chosen", () => {
    render(<Chips />);
    const chosen = screen.getByRole("button", { name: /San Diego Padres/ });
    const idle = screen.getByRole("button", { name: /Seattle Mariners/ });
    expect(chosen.className).toContain("hit-area-24");
    expect(idle.className).toContain("hit-area-24");
    expect(chosen.getAttribute("aria-pressed")).toBe("true");
    expect(chosen.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(idle.querySelector("svg")).toBeNull();
    fireEvent.click(idle);
    expect(screen.getByRole("button", { name: /Seattle Mariners/ }).querySelector("svg")).not.toBeNull();
  });

  it("keeps the limit message in a live region that is on the page from the start", () => {
    render(<Chips />);
    const status = screen.getAllByRole("status").find((el) => el.className.includes("text-neon-blue-text"));
    expect(status).toBeTruthy();
    expect(status?.textContent).toBe("");
  });

  it("Save team is an answer: the walk is told once it lands", async () => {
    const onAnswered = vi.fn();
    render(<Chips onAnswered={onAnswered} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save team" })));
    expect(mutation("selectorOptions.updateCard")).toHaveBeenCalledWith({
      id: "c1",
      teamOnCardIds: ["t1"],
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

  it("a team picked with Other team… sends focus to Save team, so Enter saves instead of reopening the search", async () => {
    const onAnswered = vi.fn();
    render(<Chips onAnswered={onAnswered} />);
    const other = screen.getByRole("button", { name: "Other team…" });
    other.focus();
    fireEvent.click(other);
    const pick = screen.getByRole("button", { name: "Pick another team" });
    pick.focus();
    fireEvent.click(pick);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: /^Save teams?$/ })));
    expect(onAnswered).not.toHaveBeenCalled();
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
