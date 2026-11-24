/**
 * NEO-645 tile 5, "Team": a skeleton while the spelling is unsettled; an
 * unanswered printed team name (candidates, link with "Remember as a name",
 * New team, Not a team); a card with no team (chips and their pre-fill rules,
 * "No team on this card"); the purple fill note; and the guarded "Apply to all".
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../convex/_generated/api", () => ({
  api: new Proxy(
    {},
    {
      get: (_t, mod) =>
        typeof mod !== "string" || mod === "then"
          ? undefined
          : mod === "adapters"
            ? // `adapters.wikidata.lookupTidyName` is one level deeper than the other modules.
              new Proxy({}, { get: (_a, sub) => new Proxy({}, { get: (_b, fn) => `adapters.${String(sub)}.${String(fn)}` }) })
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
const mutation = (ref: string) => (mutations[ref] ??= vi.fn().mockResolvedValue(null));
// An action that never answers by default: a name's lookup stays "pending" until a test seeds it.
const actions: Record<string, ReturnType<typeof vi.fn>> = {};
const action = (ref: string) => (actions[ref] ??= vi.fn(() => new Promise(() => {})));
vi.mock("convex/react", () => ({
  useQuery: (ref: string, args: unknown) => (args === "skip" ? undefined : queryResults[ref]),
  useMutation: (ref: string) => mutation(ref),
  useAction: (ref: string) => action(ref),
  useConvex: () => ({ query: vi.fn() }),
}));

vi.mock("../../EntityLinkSearch", () => ({
  default: ({
    kind,
    onSelect,
    onCancel,
  }: {
    kind: string;
    onSelect: (id: string, n: string) => void;
    onCancel: () => void;
  }) => (
    <div>
      <button type="button" onClick={() => onSelect("team-9", "Someone")}>
        {`Pick a ${kind}`}
      </button>
      <button type="button" onClick={onCancel}>
        Cancel linking
      </button>
    </div>
  ),
}));

/** The search owns its own test file; here it is a pick button and the caller's checkbox. */
vi.mock("../../../entities/TeamMatchSearch", () => ({
  TeamMatchSearch: ({
    onPick,
    children,
  }: {
    onPick: (id: string, n: string) => void;
    children?: React.ReactNode;
  }) => (
    <div>
      <button type="button" onClick={() => onPick("team-7", "San Diego Padres")}>
        Pick San Diego Padres
      </button>
      {children}
    </div>
  ),
}));

vi.mock("../../NewTeamForm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../NewTeamForm")>()),
  default: ({ onSubmit }: { onSubmit?: () => void }) => (
    <button type="button" onClick={() => onSubmit?.()}>
      Submit new team form
    </button>
  ),
}));

import { AnsweredProvider } from "../answered";
import { WalkMemory, WalkMemoryProvider, lookupKeyOf, nameKeyOf } from "../walk-memory";
import { normalizeEntityName } from "@/lib/entities/normalize-name";
import TeamTile from "./TeamTile";
import type { TidyAttentionItem } from "../../../../convex/features/cardAttention";
import type { TidyAttention, TidyCardContext, TidyRow, TidyTileProps } from "../tile-types";

const CARD = "card-1";
const SPORT = "sport-1";

const card = (extra: Record<string, unknown> = {}) =>
  ({ _id: CARD, cardNumber: "USC42", cardName: "Jackson Merrill", ...extra }) as unknown as TidyRow;

/**
 * A printed team name as `tidyCards.cardContext` reads it off the card (kind,
 * printed, pending). `row` stands for what the walk holds for it: the lookup
 * (`status`, `enrichment`) and the rows the set's facts say it reached
 * (`candidateTeamIds`, `candidatePlace`). A linked team has no name of its own
 * (it is in `teams`, onCard), and "Not a team" lives in the walk's memory.
 */
const teamName = (over: Record<string, unknown> = {}) => {
  const { row = {}, ...rest } = over as {
    row?: { status?: string; enrichment?: unknown; candidateTeamIds?: string[]; candidatePlace?: boolean };
    [k: string]: unknown;
  };
  const printed = (rest.printed as string | undefined) ?? "Padres";
  return {
    kind: "team" as const,
    nameNormalized: normalizeEntityName(printed),
    printed,
    order: 0,
    pending: true,
    ...rest,
    // Read by `renderTile` to seed the walk's memory; not part of the context.
    seed: row,
  };
};

const context = (over: Record<string, unknown> = {}) =>
  ({
    cardId: CARD,
    names: [],
    players: [],
    playersMore: false,
    teams: [],
    linkedFor: [],
    ...over,
  }) as unknown as NonNullable<TidyCardContext>;

const nameItem: TidyAttentionItem = { level: "fix", kind: "teamName", names: ["Padres"] };
const noTeamItem: TidyAttentionItem = { level: "fix", kind: "noTeam" };

let memory: WalkMemory;

/** Put the lookup and the set's facts for a name straight into the walk's memory. */
function seedName(
  m: WalkMemory,
  printed: string,
  seed: { status?: string; enrichment?: unknown; candidateTeamIds?: string[]; candidatePlace?: boolean },
) {
  const inner = m as unknown as { lookups: Map<string, unknown>; gateItems: Map<string, unknown> };
  inner.lookups.set(lookupKeyOf(CARD, "team", printed, SPORT), {
    status: seed.status ?? "ready",
    ...(seed.enrichment ? { enrichment: seed.enrichment } : {}),
  });
  if (seed.candidateTeamIds || seed.candidatePlace) {
    inner.gateItems.set(nameKeyOf("team", printed), {
      kind: "team",
      name: printed,
      sportId: SPORT,
      ...(seed.candidateTeamIds ? { candidateTeamIds: seed.candidateTeamIds } : {}),
      ...(seed.candidatePlace ? { candidatePlace: true } : {}),
    });
  }
}

function renderTile(
  opts: {
    row?: TidyRow;
    ctx?: TidyCardContext | undefined;
    items?: TidyAttentionItem[];
    leafCards?: TidyRow[];
    setNoTeam?: boolean;
    onAnswered?: () => void;
    /** Leave every name's lookup unseeded: still pending. */
    unseeded?: boolean;
  } = {},
) {
  const ctxIn = "ctx" in opts ? opts.ctx : context({ names: [teamName()] });
  if (!opts.unseeded) {
    for (const n of (ctxIn?.names ?? []) as unknown as Array<{
      kind: string;
      printed: string;
      seed?: Parameters<typeof seedName>[2];
    }>) {
      if (n.kind === "team" && n.seed) seedName(memory, n.printed, n.seed);
    }
  }
  const props: TidyTileProps = {
    row: opts.row ?? card({ pendingTeamNames: ["Padres"] }),
    context: ctxIn,
    attention: { level: "fix", items: opts.items ?? [nameItem] },
    leafId: "leaf-1" as never,
    sportId: SPORT as never,
    leafCards: opts.leafCards ?? [],
    setName: "Set",
    ...(opts.setNoTeam !== undefined ? { setNoTeam: opts.setNoTeam } : {}),
  };
  return render(
    <WalkMemoryProvider value={memory}>
      <AnsweredProvider value={opts.onAnswered ?? (() => {})}>
        <TeamTile {...props} />
      </AnsweredProvider>
    </WalkMemoryProvider>,
  );
}

const click = (el: HTMLElement) => act(async () => fireEvent.click(el));

beforeEach(() => {
  memory = new WalkMemory();
  for (const k of Object.keys(actions)) delete actions[k];
  for (const k of Object.keys(queryResults)) delete queryResults[k];
  for (const k of Object.keys(mutations)) delete mutations[k];
});

describe("TeamTile", () => {
  it("is a skeleton, with nothing to press, while a teams disagreement is unsettled", () => {
    renderTile({ items: [{ level: "fix", kind: "sourcesDisagree", field: "teams" }] });
    expect(screen.getByRole("group", { name: "Team" }).getAttribute("data-tidy-level")).toBe("waiting");
    expect(screen.getByText("Waiting on the spelling above")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders nothing for a card with no team names, no team and nothing to ask", () => {
    const { container } = renderTile({ row: card(), ctx: context(), items: [] });
    expect(container.textContent).toBe("");
  });

  describe("an unanswered printed name", () => {
    it("links the lone exact match and remembers the printed name as an alias for it", async () => {
      queryResults["teams.nearMatches"] = [
        { _id: "team-7", name: "San Diego Padres", confidence: "exact", yearsActive: { from: 1969 } },
      ];
      renderTile();
      expect(screen.getByRole("group", { name: "Team" }).getAttribute("data-tidy-level")).toBe("fix");
      // A team's name and years are data: the label wraps inside the button.
      expect(screen.getByRole("button", { name: "Link to San Diego Padres · 1969–present" }).className).toContain(
        "wrap-anywhere",
      );
      await click(screen.getByRole("button", { name: "Link to San Diego Padres · 1969–present" }));
      expect(mutation("tidyNames.answerName")).toHaveBeenCalledWith({
        cardId: CARD,
        kind: "team",
        name: "Padres",
        sportId: SPORT,
        answer: { kind: "linkTeam", teamId: "team-7", saveAsAlias: true },
      });
    });

    it("a string that is another team's LOCATION starts with 'Remember' unticked", async () => {
      queryResults["teams.nearMatches"] = [
        { _id: "team-1", name: "Padres", confidence: "close", locationMatch: true },
      ];
      renderTile();
      const box = screen.getByRole("checkbox", { name: "Remember “Padres” as a name for this team" });
      expect((box as HTMLInputElement).checked).toBe(false);
      await click(screen.getByRole("button", { name: "Pick San Diego Padres" }));
      expect(mutation("tidyNames.answerName")).toHaveBeenCalledWith({
        cardId: CARD,
        kind: "team",
        name: "Padres",
        sportId: SPORT,
        answer: { kind: "linkTeam", teamId: "team-7" },
      });
    });

    it("the 'Remember' box is a 24px target and holds with aria-disabled while a write is in flight", async () => {
      queryResults["teams.nearMatches"] = [];
      renderTile();
      const box = screen.getByRole("checkbox", { name: "Remember “Padres” as a name for this team" }) as HTMLInputElement;
      expect(box.className).toContain("h-6");
      expect(box.closest("label")?.className).toContain("min-h-6");
      mutation("tidyNames.answerName").mockReturnValueOnce(new Promise(() => {}));
      await click(screen.getByRole("button", { name: "Not a team" }));
      expect(box.getAttribute("aria-disabled")).toBe("true");
      expect(box.disabled).toBe(false);
      const before = box.checked;
      await click(box);
      expect(box.checked).toBe(before);
    });

    it("a pick from the search remembers the name unless the box is cleared", async () => {
      queryResults["teams.nearMatches"] = [];
      renderTile();
      const box = screen.getByRole("checkbox", { name: "Remember “Padres” as a name for this team" });
      expect((box as HTMLInputElement).checked).toBe(true);
      await click(box);
      await click(screen.getByRole("button", { name: "Pick San Diego Padres" }));
      expect(mutation("tidyNames.answerName")).toHaveBeenCalledWith({
        cardId: CARD,
        kind: "team",
        name: "Padres",
        sportId: SPORT,
        answer: { kind: "linkTeam", teamId: "team-7" },
      });
    });

    it("offers each team the name could mean, by era, and links the one picked", async () => {
      queryResults["teams.nearMatches"] = [];
      queryResults["teams.getManyByIds"] = [
        { _id: "t-new", name: "Padres", location: "San Diego", yearsActive: { from: 1969 } },
        { _id: "t-old", name: "Padres", location: "San Diego", yearsActive: { from: 1936, to: 1968 } },
      ];
      renderTile({
        ctx: context({
          names: [teamName({ row: { name: "Padres", sportId: SPORT, status: "ready", candidateTeamIds: ["t-new", "t-old"] } })],
        }),
      });
      // The lead-in is a live region: announced a beat after the rows are there.
      expect(await screen.findByText("We've got 2 teams by that name. Pick the one on this card.")).toBeTruthy();
      const links = screen.getAllByRole("button", { name: /^Link to San Diego Padres/ });
      expect(links).toHaveLength(2);
      expect(new Set(links.map((b) => b.getAttribute("aria-label") ?? b.textContent)).size).toBe(2);
      await click(links[0]);
      expect(mutation("tidyNames.answerName")).toHaveBeenCalledTimes(1);
    });

    it("the candidates sit in a plain recessed panel with an icon, not a side rail, and wrap their long labels", async () => {
      queryResults["teams.nearMatches"] = [];
      queryResults["teams.getManyByIds"] = [
        { _id: "t-new", name: "Padres", location: "San Diego", yearsActive: { from: 1969 } },
        { _id: "t-old", name: "Padres", location: "San Diego", yearsActive: { from: 1936, to: 1968 } },
      ];
      renderTile({
        ctx: context({
          names: [teamName({ row: { name: "Padres", sportId: SPORT, status: "ready", candidateTeamIds: ["t-new", "t-old"] } })],
        }),
      });
      const intro = await screen.findByText("We've got 2 teams by that name. Pick the one on this card.");
      const panel = screen.getByRole("list", { name: /We've got 2 teams/ }).parentElement!;
      expect(panel.className).toContain("bg-raised-deep");
      expect(panel.className).not.toContain("border-l-4");
      // The icon is beside the words, and only with them.
      expect(intro.parentElement?.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
      for (const link of screen.getAllByRole("button", { name: /^Link to San Diego Padres/ })) {
        for (const token of ["h-auto", "min-h-6", "max-w-full", "py-1", "text-left", "wrap-anywhere"]) {
          expect(link.className).toContain(token);
        }
      }
    });

    it("lists the candidates newest era first, not in candidateTeamIds order, undated last", () => {
      queryResults["teams.nearMatches"] = [];
      queryResults["teams.getManyByIds"] = [
        { _id: "t-undated", name: "Athletics", location: "Oakland" },
        { _id: "t-old", name: "Athletics", location: "Oakland", yearsActive: { from: 1968, to: 2024 } },
        { _id: "t-new", name: "Athletics", yearsActive: { from: 2025 } },
      ];
      renderTile({
        ctx: context({
          names: [
            teamName({
              row: {
                name: "Athletics",
                sportId: SPORT,
                status: "ready",
                candidateTeamIds: ["t-undated", "t-old", "t-new"],
              },
            }),
          ],
        }),
      });
      const links = screen.getAllByRole("button", { name: /^Link to / });
      expect(links.map((b) => b.textContent)).toEqual([
        "Link to Athletics · 2025–present",
        "Link to Oakland Athletics · 1968–2024",
        "Link to Oakland Athletics",
      ]);
    });

    it("holds '+ New team' until the near matches answer, and says why", async () => {
      renderTile();
      expect(screen.getByText("Checking for teams by that name…").getAttribute("role")).toBe("status");
      const add = screen.getByRole("button", { name: "+ New team" });
      expect(add.getAttribute("aria-disabled")).toBe("true");
      await click(add);
      expect(screen.queryByRole("group", { name: "New team: Padres" })).toBeNull();
    });

    it("says nothing about checking once the near matches answered", () => {
      queryResults["teams.nearMatches"] = [];
      renderTile();
      expect(screen.queryByText("Checking for teams by that name…")).toBeNull();
      expect(screen.getByRole("button", { name: "+ New team" }).getAttribute("aria-disabled")).toBeNull();
    });

    it("the candidates list is named from its first render", () => {
      queryResults["teams.nearMatches"] = [];
      queryResults["teams.getManyByIds"] = [
        { _id: "t-new", name: "Padres", location: "San Diego", yearsActive: { from: 1969 } },
        { _id: "t-old", name: "Padres", location: "San Diego", yearsActive: { from: 1936, to: 1968 } },
      ];
      renderTile({
        ctx: context({
          names: [teamName({ row: { name: "Padres", sportId: SPORT, status: "ready", candidateTeamIds: ["t-new", "t-old"] } })],
        }),
      });
      expect(screen.getByRole("list", { name: "We've got 2 teams by that name. Pick the one on this card." })).toBeTruthy();
    });

    it("'Not a team' answers notEntity for the name", async () => {
      queryResults["teams.nearMatches"] = [];
      renderTile();
      await click(screen.getByRole("button", { name: "Not a team" }));
      expect(mutation("tidyNames.answerName")).toHaveBeenCalledWith({
        cardId: CARD,
        kind: "team",
        name: "Padres",
        sportId: SPORT,
        answer: { kind: "notEntity" },
      });
    });

    it("'+ New team' opens the form inside the tile; creating it links the name", async () => {
      queryResults["teams.nearMatches"] = [];
      mutation("teams.findOrCreate").mockResolvedValue("team-new");
      renderTile();
      await click(screen.getByRole("button", { name: "+ New team" }));
      expect(screen.getByRole("group", { name: "New team: Padres" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Cancel new team" })).toBeTruthy();
      await click(screen.getByRole("button", { name: "Submit new team form" }));
      expect(mutation("teams.findOrCreate")).toHaveBeenCalledWith(expect.objectContaining({ name: "Padres", sportId: SPORT }));
      expect(mutation("tidyNames.answerName")).toHaveBeenCalledWith({
        cardId: CARD,
        kind: "team",
        name: "Padres",
        sportId: SPORT,
        answer: { kind: "linkTeam", teamId: "team-new" },
      });
      // Closed again once it is made.
      expect(screen.queryByRole("group", { name: "New team: Padres" })).toBeNull();
    });

    it("a new team keeps the lookup's league suggestion, era, colours and ids (NEO-645)", async () => {
      queryResults["teams.nearMatches"] = [];
      mutation("teams.findOrCreate").mockResolvedValue("team-new");
      renderTile({
        ctx: context({
          names: [
            teamName({
              row: {
                name: "Padres",
                sportId: SPORT,
                status: "ready",
                enrichment: {
                  league: "Major League Baseball",
                  location: "San Diego",
                  yearsActive: { from: 1969 },
                  colors: { primary: "#2f241d", secondary: "#ffc425" },
                  espnId: "25",
                  wikidataId: "Q650850",
                  // Not team facts: never forwarded.
                  description: "ignored",
                },
              },
            }),
          ],
        }),
      });
      await click(screen.getByRole("button", { name: "+ New team" }));
      await click(screen.getByRole("button", { name: "Submit new team form" }));
      const sent = mutation("teams.findOrCreate").mock.calls[0][0] as Record<string, unknown>;
      expect(sent.enrichment).toEqual({
        league: "Major League Baseball",
        yearsActive: { from: 1969 },
        colors: { primary: "#2f241d", secondary: "#ffc425" },
        espnId: "25",
        wikidataId: "Q650850",
      });
    });

    it("a lookup with nothing to carry sends no enrichment key", async () => {
      queryResults["teams.nearMatches"] = [];
      mutation("teams.findOrCreate").mockResolvedValue("team-new");
      renderTile();
      await click(screen.getByRole("button", { name: "+ New team" }));
      await click(screen.getByRole("button", { name: "Submit new team form" }));
      expect(mutation("teams.findOrCreate").mock.calls[0][0]).not.toHaveProperty("enrichment");
    });

    it("a name another team holds as an alias becomes 'Link to {holder}', and creating is held", async () => {
      queryResults["teams.nearMatches"] = [];
      queryResults["teams.nameHeldAsAliasBy"] = [
        { id: "team-holder", name: "San Diego Padres", yearsActive: { from: 1969 } },
      ];
      renderTile();
      await click(screen.getByRole("button", { name: "+ New team" }));
      await click(screen.getByRole("button", { name: "Link to San Diego Padres · 1969–present" }));
      expect(mutation("tidyNames.answerName")).toHaveBeenCalledWith(
        expect.objectContaining({ answer: expect.objectContaining({ kind: "linkTeam", teamId: "team-holder" }) }),
      );
      expect(mutation("teams.findOrCreate")).not.toHaveBeenCalled();
    });

    it("two names on one card carry the printed name in every control", () => {
      queryResults["teams.nearMatches"] = [];
      renderTile({
        ctx: context({
          names: [
            teamName(),
            teamName({ nameNormalized: "dodgers", printed: "Dodgers", order: 1, row: { name: "Dodgers", sportId: SPORT, status: "ready" } }),
          ],
        }),
      });
      expect(screen.getByRole("button", { name: "Not a team Padres" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Not a team Dodgers" })).toBeTruthy();
    });
  });

  describe("an answered name", () => {
    it("a team linked to the card is plain, with Edit at the end of its line; no 'Linked for you' note", async () => {
      renderTile({
        row: card({ teamOnCardIds: ["team-7"] }),
        items: [],
        ctx: context({
          teams: [{ teamId: "team-7", name: "San Diego Padres", onCard: true, candidate: false }],
          linkedFor: [{ kind: "team", teamId: "team-7", reason: "careerTeam" }],
        }),
      });
      expect(screen.getByRole("group", { name: "Team" }).getAttribute("data-tidy-level")).toBe("plain");
      expect(screen.getByText("San Diego Padres")).toBeTruthy();
      expect(screen.queryByText(/Linked for you/)).toBeNull();
      expect(screen.getByRole("button", { name: "Edit San Diego Padres" })).toBeTruthy();
    });

    it("'Not a team' reads as answered while the card is open, and Edit brings the question back", async () => {
      queryResults["teams.nearMatches"] = [];
      const { rerender } = renderTile();
      await click(screen.getByRole("button", { name: "Not a team" }));
      // The card no longer lists the name as waiting (Convex delivers the new row); only memory holds the ruling.
      rerender(
        <WalkMemoryProvider value={memory}>
          <AnsweredProvider value={() => {}}>
            <TeamTile
              row={card()}
              context={context()}
              attention={{ level: "none", items: [] } as never}
              leafId={"leaf-1" as never}
              sportId={SPORT as never}
              leafCards={[]}
              setName="Set"
            />
          </AnsweredProvider>
        </WalkMemoryProvider>,
      );
      expect(screen.getByText("is not a team.", { exact: false })).toBeTruthy();
      await click(screen.getByRole("button", { name: "Edit Padres" }));
      expect(mutation("tidyNames.answerName")).toHaveBeenLastCalledWith({
        cardId: CARD,
        kind: "team",
        name: "Padres",
        sportId: SPORT,
        answer: { kind: "clear" },
      });
      // The ruling is taken back out of memory.
      expect(memory.answersOn(CARD, "team")).toEqual([]);
    });

    it("answers are never stored: the ruling is gone once the walk leaves the card", async () => {
      queryResults["teams.nearMatches"] = [];
      renderTile();
      await click(screen.getByRole("button", { name: "Not a team" }));
      expect(memory.answersOn(CARD, "team")).toHaveLength(1);
      memory.leaveCard(CARD);
      expect(memory.answersOn(CARD, "team")).toEqual([]);
    });

    it("a refused 'Edit' on a ruled-out name keeps the ruling", async () => {
      memory.rememberAnswer(CARD, "team", "Padres", { kind: "notEntity", printed: "Padres" });
      mutation("tidyNames.answerName").mockRejectedValueOnce(new Error("Server Error"));
      renderTile({ row: card(), items: [], ctx: context() });
      await click(screen.getByRole("button", { name: "Edit Padres" }));
      expect(screen.getByRole("alert").textContent).toBe("Couldn't change that answer. Try again.");
      expect(memory.answersOn(CARD, "team")).toHaveLength(1);
    });

    it("a link made on the open card is offered to the other cards still waiting on the name (Apply to all)", async () => {
      queryResults["teams.nearMatches"] = [];
      const waiting = card({ _id: "card-2", cardNumber: "USC43", pendingTeamNames: ["Padres"] });
      const { rerender } = renderTile({ leafCards: [card({ pendingTeamNames: ["Padres"] }), waiting] });
      await click(screen.getByRole("button", { name: "Pick San Diego Padres" }));
      rerender(
        <WalkMemoryProvider value={memory}>
          <AnsweredProvider value={() => {}}>
            <TeamTile
              row={card({ teamOnCardIds: ["team-7"] })}
              context={context({ teams: [{ teamId: "team-7", name: "San Diego Padres", onCard: true, candidate: false }] })}
              attention={{ level: "none", items: [] } as never}
              leafId={"leaf-1" as never}
              sportId={SPORT as never}
              leafCards={[card({ teamOnCardIds: ["team-7"] }), waiting]}
              setName="Set"
            />
          </AnsweredProvider>
        </WalkMemoryProvider>,
      );
      expect(screen.getByRole("button", { name: "Apply to all cards printing “Padres”" })).toBeTruthy();
    });
  });

  describe("the lookup is the walk's, read live", () => {
    it("is asked once through the lookup action, in the set's sport, and holds nothing in storage", async () => {
      const setItem = vi.spyOn(Storage.prototype, "setItem");
      queryResults["teams.nearMatches"] = [];
      renderTile({ unseeded: true });
      expect(action("adapters.wikidata.lookupTidyName")).toHaveBeenCalledTimes(1);
      expect(action("adapters.wikidata.lookupTidyName")).toHaveBeenCalledWith({
        cardId: CARD,
        kind: "team",
        name: "Padres",
        sportId: SPORT,
      });
      expect(setItem).not.toHaveBeenCalled();
      setItem.mockRestore();
    });

    it("a lookup that failed says so, offers Try again, and leaves the rest working", async () => {
      queryResults["teams.nearMatches"] = [];
      renderTile({ ctx: context({ names: [teamName({ row: { status: "error" } })] }) });
      expect(screen.getByText("Couldn't look this one up.")).toBeTruthy();
      // Missing data is not a claim: the normal answers are all still on offer.
      expect(screen.getByRole("button", { name: "Not a team" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "+ New team" }).getAttribute("aria-disabled")).toBeNull();
      await click(screen.getByRole("button", { name: "Try again" }));
      expect(action("adapters.wikidata.lookupTidyName")).toHaveBeenCalledTimes(1);
    });

    it("no Try again while the lookup is pending or ready", () => {
      queryResults["teams.nearMatches"] = [];
      renderTile();
      expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    });
  });

  describe("a card with no team", () => {
    const player = {
      playerId: "player-1",
      name: "Jimmie Foxx",
      sportId: SPORT,
      stints: [
        { teamId: "t-a", teamName: "Philadelphia Athletics", fromYear: 1925, toYear: 1935 },
        { teamId: "t-b", teamName: "Boston Red Sox", fromYear: 1936, toYear: 1942 },
      ],
      stintsMore: false,
    };
    const items = [noTeamItem];
    const row = (extra: Record<string, unknown> = {}) => card({ playerIds: ["player-1"], ...extra });
    const ctx = () => context({ players: [player] });

    // ── The evidence is main's Tidy Up wizard's own query (`teamSuggestionsForPreview`):
    //    per player an answer (or none), the candidates, and his dated stints. ──
    const T = (teamId: string, name: string, rank?: number) => ({ teamId, name, ...(rank === undefined ? {} : { rank }) });
    const S = (teamId: string, fromYear: number, toYear?: number) => ({
      teamId,
      fromYear,
      ...(toYear !== undefined ? { toYear } : {}),
    });
    type Ev = {
      answer?: { tier: string; teams: ReturnType<typeof T>[] } | null;
      candidates?: ReturnType<typeof T>[];
      stints?: ReturnType<typeof S>[];
    };
    const evidence = (setYear: number | null, ...players: Ev[]) => {
      queryResults["cardChecklist.teamSuggestionsForPreview"] = {
        setYear,
        sportId: SPORT,
        setLeagueIds: [],
        setLeagueId: null,
        teamNames: [],
        players: players.map((p, i) => ({
          playerId: `player-${i + 1}`,
          answer: p.answer ?? null,
          candidates: p.candidates ?? p.answer?.teams ?? [],
          ...(p.stints ? { stints: p.stints } : {}),
        })),
      };
    };
    const career = (...teams: ReturnType<typeof T>[]) => ({ tier: "career", teams });
    // A preselected chip carries the check mark; a chip is a plain button (a click saves it).
    const marked = (chip: HTMLElement) => String(chip.getAttribute("aria-current") === "true");
    const pressed = (name: RegExp | string) => marked(screen.getByRole("button", { name }));
    const allChips = (name: RegExp) => screen.getAllByRole("button", { name });
    // There is no Save button: nothing is written until a team is clicked.
    const none = () => {
      expect(screen.queryByRole("button", { name: /^Save teams?$/ })).toBeNull();
      expect(mutation("selectorOptions.updateCard")).not.toHaveBeenCalled();
    };

    const foxx = [S("t-a", 1925, 1935), S("t-b", 1936, 1942)];

    it("pre-fills a stint that covers the set's year, and clicking it saves it", async () => {
      evidence(1940, { answer: career(T("t-b", "Boston Red Sox")), candidates: [T("t-b", "Boston Red Sox")], stints: foxx });
      renderTile({ row: row(), ctx: ctx(), items });
      expect(pressed(/Boston Red Sox/)).toBe("true");
      expect(screen.getByText("Suggested from career history.")).toBeTruthy();
      expect(screen.queryByRole("button", { name: /^Save teams?$/ })).toBeNull();
      expect(mutation("selectorOptions.updateCard")).not.toHaveBeenCalled();
      await click(screen.getByRole("button", { name: /Boston Red Sox/ }));
      expect(mutation("selectorOptions.updateCard")).toHaveBeenCalledWith({
        id: CARD,
        teamOnCardIds: ["t-b"],
        regenerateListing: true,
      });
    });

    it("A12: nothing is pre-filled until the evidence has arrived", () => {
      renderTile({ row: row(), ctx: ctx(), items });
      none();
      expect(screen.queryByRole("button", { name: /Red Sox/ })).toBeNull();
    });

    it("never pre-fills a whole-career fallback, and shows the player's years with each team (A15: bare, one player)", async () => {
      evidence(2025, {
        answer: null,
        candidates: [T("t-a", "Philadelphia Athletics"), T("t-b", "Boston Red Sox")],
        stints: foxx,
      });
      renderTile({ row: row(), ctx: ctx(), items });
      for (const chip of allChips(/Athletics|Red Sox/)) expect(marked(chip)).toBe("false");
      expect(screen.getByRole("button", { name: "Philadelphia Athletics · 1925–1935" })).toBeTruthy();
      expect(screen.getByText("No 2025 team on file. Here's the whole career, so pick the one on the card.")).toBeTruthy();
      // Nothing is written until a team is clicked, and a click saves it.
      none();
      await click(screen.getByRole("button", { name: /Boston Red Sox/ }));
      expect(mutation("selectorOptions.updateCard")).toHaveBeenCalledWith({
        id: CARD,
        teamOnCardIds: ["t-b"],
        regenerateListing: true,
      });
    });

    it("A15: an open stint reads 'present', in main's format", () => {
      evidence(2020, { answer: null, candidates: [T("t-a", "Philadelphia Athletics")], stints: [S("t-a", 2024)] });
      renderTile({ row: row(), ctx: ctx(), items });
      expect(screen.getByRole("button", { name: "Philadelphia Athletics · 2024–present" })).toBeTruthy();
    });

    describe("a listing that names a team (B7)", () => {
      it("pre-fills nothing, offers the listing's NB team first, then the career's, and says why", () => {
        evidence(1940, { answer: career(T("t-b", "Boston Red Sox")), candidates: [T("t-b", "Boston Red Sox")], stints: foxx });
        queryResults["teams.erasByNameAndSport"] = [
          { _id: "t-a", name: "Philadelphia Athletics", label: "Philadelphia Athletics" },
        ];
        renderTile({ row: row({ bscTeamName: "Philadelphia Athletics" }), ctx: ctx(), items });
        for (const chip of allChips(/Athletics|Red Sox/)) expect(marked(chip)).toBe("false");
        expect(screen.getByText("From the career. The listing names a team, so pick the one on the card.")).toBeTruthy();
        expect(screen.getByText("The listing names “Philadelphia Athletics”. Pick it if it matches the card.")).toBeTruthy();
        const order = allChips(/Athletics|Red Sox/).map((b) => b.textContent);
        expect(order[0]).toContain("Athletics");
        none();
      });

      it("the career agreeing with the listing preselects nothing either (no 'preselect when career agrees')", () => {
        evidence(1940, { answer: career(T("t-b", "Boston Red Sox")), candidates: [T("t-b", "Boston Red Sox")], stints: foxx });
        queryResults["teams.erasByNameAndSport"] = [{ _id: "t-b", name: "Boston Red Sox", label: "Boston Red Sox" }];
        renderTile({ row: row({ bscTeamName: "Boston Red Sox" }), ctx: ctx(), items });
        for (const chip of allChips(/Red Sox/)) expect(marked(chip)).toBe("false");
        expect(screen.queryByText("The listing names “Boston Red Sox” and the career agrees.")).toBeNull();
        none();
      });
    });

    it("B8: a team the publisher's checklist settled holds the pre-fill back for the chips too", () => {
      evidence(1940, { answer: career(T("t-b", "Boston Red Sox")), candidates: [T("t-b", "Boston Red Sox")], stints: foxx });
      renderTile({ row: row({ teamCheckOutcome: "checklist" }), ctx: ctx(), items });
      expect(pressed(/Boston Red Sox/)).toBe("false");
      expect(screen.getByText("From the career. The official checklist settled the team, so pick the one on the card.")).toBeTruthy();
      none();
    });

    it("a lookup that never answered holds nothing back: the career pre-fills as usual (NEO-639)", () => {
      evidence(1940, { answer: career(T("t-b", "Boston Red Sox")), candidates: [T("t-b", "Boston Red Sox")], stints: foxx });
      renderTile({ row: row({ teamCheckOutcome: "gaveUp" }), ctx: ctx(), items });
      expect(pressed(/Boston Red Sox/)).toBe("true");
      expect(screen.getByText("We couldn't get a team from the listing for this card. Pick the one on the card.")).toBeTruthy();
    });

    describe("A12/B5: the batch tier, the player's other cards in this checklist", () => {
      const other = (extra: Record<string, unknown> = {}) =>
        ({ _id: "card-2", cardNumber: "2", playerIds: ["player-1"], teamOnCardIds: ["t-a"], ...extra }) as unknown as TidyRow;

      it("pre-fills the team the same player set carries, ahead of the career, and names where it came from", async () => {
        evidence(1940, { answer: career(T("t-b", "Boston Red Sox")), candidates: [T("t-b", "Boston Red Sox")], stints: foxx });
        queryResults["teams.getManyByIds"] = [{ _id: "t-a", name: "Athletics", location: "Philadelphia" }];
        renderTile({ row: row(), ctx: ctx(), items, leafCards: [other()] });
        expect(pressed(/Philadelphia Athletics/)).toBe("true");
        expect(screen.getByText("Suggested from the player's other cards.")).toBeTruthy();
        await click(screen.getByRole("button", { name: /Philadelphia Athletics/ }));
        expect(mutation("selectorOptions.updateCard")).toHaveBeenCalledWith({
        id: CARD,
        teamOnCardIds: ["t-a"],
        regenerateListing: true,
      });
      });

      it("two other cards that disagree stop the search: nothing preselected, the career does not speak", () => {
        evidence(1940, { answer: career(T("t-b", "Boston Red Sox")), candidates: [T("t-b", "Boston Red Sox")], stints: foxx });
        queryResults["teams.getManyByIds"] = [
          { _id: "t-a", name: "Athletics", location: "Philadelphia" },
          { _id: "t-c", name: "Yankees", location: "New York" },
        ];
        renderTile({
          row: row(),
          ctx: ctx(),
          items,
          leafCards: [other(), other({ _id: "card-3", teamOnCardIds: ["t-c"] })],
        });
        for (const chip of allChips(/Athletics|Yankees/)) expect(marked(chip)).toBe("false");
        expect(screen.queryByRole("button", { name: /Red Sox/ })).toBeNull();
        none();
      });

      it("a card of another player set and a teamless card are not evidence", () => {
        evidence(1940, { answer: career(T("t-b", "Boston Red Sox")), candidates: [T("t-b", "Boston Red Sox")], stints: foxx });
        renderTile({
          row: row(),
          ctx: ctx(),
          items,
          leafCards: [
            other({ _id: "card-2", playerIds: ["player-9"] }),
            other({ _id: "card-4", teamOnCardIds: [] }),
          ],
        });
        expect(pressed(/Boston Red Sox/)).toBe("true");
        expect(screen.getByText("Suggested from career history.")).toBeTruthy();
      });

      it("J8: a team on a card is the card's team whoever wrote it, so a filled card counts as evidence", () => {
        evidence(1940, { answer: career(T("t-b", "Boston Red Sox")), candidates: [T("t-b", "Boston Red Sox")], stints: foxx });
        queryResults["teams.getManyByIds"] = [{ _id: "t-a", name: "Athletics", location: "Philadelphia" }];
        // Nothing on the card says who set the team (no stored fill note): it votes like any other.
        renderTile({ row: row(), ctx: ctx(), items, leafCards: [other({ _id: "card-3" })] });
        expect(pressed(/Philadelphia Athletics/)).toBe("true");
        expect(screen.getByText("Suggested from the player's other cards.")).toBeTruthy();
      });

      it("a claim holds the batch answer back too", () => {
        evidence(1940, { answer: career(T("t-b", "Boston Red Sox")), candidates: [T("t-b", "Boston Red Sox")], stints: foxx });
        queryResults["teams.getManyByIds"] = [{ _id: "t-a", name: "Athletics", location: "Philadelphia" }];
        renderTile({ row: row({ teamCheckOutcome: "checklist" }), ctx: ctx(), items, leafCards: [other()] });
        expect(pressed(/Philadelphia Athletics/)).toBe("false");
        expect(screen.getByText("From the player's other cards. The official checklist settled the team, so pick the one on the card.")).toBeTruthy();
      });
    });

    // ── NEO-639: a tie, years, the set's own No Team ──

    describe("a tie in the window (NEO-639, B12)", () => {
      const tied: Ev = {
        answer: null,
        candidates: [T("t-a", "Los Angeles Angels"), T("t-b", "Los Angeles Dodgers")],
        stints: [S("t-a", 2018, 2024), S("t-b", 2025)],
      };
      const TIE = "From the career. More than one team that season, so pick the one on the card.";

      it("preselects neither team, says why, and every chip carries the player's years", () => {
        evidence(2025, tied);
        renderTile({ row: row(), ctx: ctx(), items });
        expect(pressed(/Los Angeles Angels/)).toBe("false");
        expect(pressed(/Los Angeles Dodgers/)).toBe("false");
        expect(screen.getByRole("button", { name: "Los Angeles Angels · 2018–2024" })).toBeTruthy();
        expect(screen.getByRole("button", { name: "Los Angeles Dodgers · 2025–present" })).toBeTruthy();
        expect(screen.getByText(TIE)).toBeTruthy();
        // The tie is not "no year on this set".
        expect(screen.queryByText(/No year on this set/)).toBeNull();
        none();
      });

      it("a co-player's one team is not preselected over a tied player: the card is asked as a whole", () => {
        evidence(2025, tied, {
          answer: career(T("t-c", "Cincinnati Reds")),
          candidates: [T("t-c", "Cincinnati Reds")],
          stints: [S("t-c", 1967, 1983)],
        });
        const bench = { playerId: "player-2", name: "Johnny Bench", sportId: SPORT, stints: [], stintsMore: false };
        renderTile({
          row: card({ playerIds: ["player-1", "player-2"] }),
          ctx: context({ players: [player, bench] }),
          items,
        });
        for (const chip of allChips(/Reds|Angels|Dodgers/)) expect(marked(chip)).toBe("false");
        expect(screen.getByText(TIE)).toBeTruthy();
        none();
      });

      it("the set's No Team outranks the tie line", () => {
        evidence(2025, tied);
        renderTile({ row: row(), ctx: ctx(), items, setNoTeam: true });
        expect(
          screen.getByText("From the career. This set says No Team, so pick one only if it's on the card."),
        ).toBeTruthy();
        expect(screen.queryByText(/More than one team that season/)).toBeNull();
      });

      it("the years sit on their own wrapping line inside the chip, never clipped, with the same accessible name", () => {
        evidence(2025, tied);
        renderTile({ row: row(), ctx: ctx(), items });
        const chip = screen.getByRole("button", { name: "Los Angeles Angels · 2018–2024" });
        expect(chip.className).toContain("max-w-full");
        expect(chip.className).toContain("flex-col");
        expect(chip.className).toContain("rounded-2xl");
        expect(chip.className).not.toContain("rounded-full");
        expect(chip.className).toContain("hit-area-24");
        const years = screen.getByText("2018–2024");
        expect(years.className).toContain("wrap-anywhere");
        expect(years.className).not.toMatch(/truncate|overflow-hidden|whitespace-nowrap/);
      });

      it("the operator's pick of one tied team saves it", async () => {
        evidence(2025, tied);
        renderTile({ row: row(), ctx: ctx(), items });
        await click(screen.getByRole("button", { name: /Los Angeles Dodgers/ }));
        expect(mutation("selectorOptions.updateCard")).toHaveBeenCalledWith({
        id: CARD,
        teamOnCardIds: ["t-b"],
        regenerateListing: true,
      });
      });
    });

    describe("the years on a chip outside the pre-fill (NEO-639, A15)", () => {
      it("merges one player's stints at a team: touching and overlapping spans join, separate ones list oldest first", () => {
        evidence(2030, {
          answer: null,
          candidates: [T("t-a", "Philadelphia Athletics")],
          stints: [S("t-a", 2021, 2022), S("t-a", 2015, 2017), S("t-a", 2018, 2019), S("t-a", 2016, 2016), S("t-b", 1990, 1995)],
        });
        renderTile({ row: row(), ctx: ctx(), items });
        expect(screen.getByRole("button", { name: "Philadelphia Athletics · 2015–2019, 2021–2022" })).toBeTruthy();
      });

      it("names each player with a dated stint at the team, in card order, and skips the one with none", () => {
        const stintsOf = (id: string, from: number, to: number) => [S(id, from, to)];
        evidence(
          2030,
          { answer: null, candidates: [T("t-r", "Cincinnati Reds")], stints: stintsOf("t-r", 1963, 1978) },
          { answer: null, candidates: [T("t-r", "Cincinnati Reds")], stints: stintsOf("t-r", 1967, 1983) },
          { answer: null, candidates: [], stints: stintsOf("t-x", 1972, 1979) },
        );
        const players = [
          { playerId: "p-1", name: "Pete Rose", sportId: SPORT, stints: [], stintsMore: false },
          { playerId: "p-2", name: "Johnny Bench", sportId: SPORT, stints: [], stintsMore: false },
          { playerId: "p-3", name: "Joe Morgan", sportId: SPORT, stints: [], stintsMore: false },
        ];
        renderTile({ row: card({ playerIds: ["p-1", "p-2", "p-3"] }), ctx: context({ players }), items });
        expect(
          screen.getByRole("button", { name: "Cincinnati Reds · Pete Rose 1963–1978; Johnny Bench 1967–1983" }),
        ).toBeTruthy();
      });

      it("a click saves only the team it names, and the labels follow the pre-fill", async () => {
        evidence(1940, {
          answer: career(T("t-b", "Boston Red Sox")),
          candidates: [T("t-b", "Boston Red Sox"), T("t-a", "Philadelphia Athletics")],
          stints: foxx,
        });
        renderTile({ row: row(), ctx: ctx(), items });
        // The pre-filled chip says who played there; the one beside it says the years.
        expect(pressed("Boston Red Sox · Jimmie Foxx played here")).toBe("true");
        expect(pressed("Philadelphia Athletics · 1925–1935")).toBe("false");
        await click(screen.getByRole("button", { name: "Philadelphia Athletics · 1925–1935" }));
        expect(mutation("selectorOptions.updateCard")).toHaveBeenCalledWith({
          id: CARD,
          teamOnCardIds: ["t-a"],
          regenerateListing: true,
        });
        expect(pressed("Philadelphia Athletics · 1925–1935")).toBe("false");
        expect(pressed("Boston Red Sox · Jimmie Foxx played here")).toBe("true");
      });

      it("clicking the preselected chip saves it", async () => {
        evidence(1940, { answer: career(T("t-b", "Boston Red Sox")), candidates: [T("t-b", "Boston Red Sox")], stints: foxx });
        renderTile({ row: row(), ctx: ctx(), items });
        await click(screen.getByRole("button", { name: "Boston Red Sox · Jimmie Foxx played here" }));
        expect(mutation("selectorOptions.updateCard")).toHaveBeenCalledWith({
          id: CARD,
          teamOnCardIds: ["t-b"],
          regenerateListing: true,
        });
      });

      it("an undated career lead prints no years, even offered unselected", () => {
        evidence(2025, { answer: null, candidates: [T("t-a", "Philadelphia Athletics")], stints: [] });
        renderTile({ row: row(), ctx: ctx(), items });
        expect(screen.getByRole("button", { name: "Philadelphia Athletics · Jimmie Foxx played here" })).toBeTruthy();
      });
    });

    describe("the set's own No Team (NEO-639, decision A)", () => {
      const lone = () =>
        evidence(1940, { answer: career(T("t-b", "Boston Red Sox")), candidates: [T("t-b", "Boston Red Sox")], stints: foxx });

      it("offers the card's one set-year team with the player's years and preselects nothing", () => {
        lone();
        renderTile({ row: row(), ctx: ctx(), items, setNoTeam: true });
        expect(pressed("Boston Red Sox · 1936–1942")).toBe("false");
        expect(
          screen.getByText("From the career. This set says No Team, so pick one only if it's on the card."),
        ).toBeTruthy();
        none();
        expect(screen.getByRole("button", { name: "No team on this card" })).toBeTruthy();
      });

      it("the operator can still pick it, and the pick saves", async () => {
        lone();
        renderTile({ row: row(), ctx: ctx(), items, setNoTeam: true });
        await click(screen.getByRole("button", { name: /Boston Red Sox/ }));
        expect(mutation("selectorOptions.updateCard")).toHaveBeenCalledWith({
        id: CARD,
        teamOnCardIds: ["t-b"],
        regenerateListing: true,
      });
      });

      it("a set with a team default, or none, still preselects the same team", () => {
        lone();
        renderTile({ row: row(), ctx: ctx(), items, setNoTeam: false });
        expect(pressed("Boston Red Sox · Jimmie Foxx played here")).toBe("true");
        expect(screen.getByText("Suggested from career history.")).toBeTruthy();
      });
    });

    it("'No team on this card' records the answer", async () => {
      evidence(2024, { answer: null, candidates: [] });
      mutation("cardChecklist.confirmCardNoTeam").mockResolvedValue({ confirmed: true, stamped: true });
      renderTile({ row: row(), ctx: ctx(), items });
      await click(screen.getByRole("button", { name: "No team on this card" }));
      expect(mutation("cardChecklist.confirmCardNoTeam")).toHaveBeenCalledWith({
        cardId: CARD,
        regenerateListing: true,
      });
    });

    it("says so when the card turned out to have teams", async () => {
      evidence(2024, { answer: null, candidates: [] });
      mutation("cardChecklist.confirmCardNoTeam").mockResolvedValue({ confirmed: false, stamped: false });
      renderTile({ row: row(), ctx: ctx(), items });
      await click(screen.getByRole("button", { name: "No team on this card" }));
      expect(screen.getByRole("alert").textContent).toMatch(/nothing to confirm/);
    });

    it("has no Save button: the chips, Other team… and the way out are all there is", () => {
      evidence(2025, { answer: null, candidates: [T("t-b", "Boston Red Sox")], stints: foxx });
      renderTile({ row: row(), ctx: ctx(), items });
      expect(screen.queryByRole("button", { name: /^Save teams?$/ })).toBeNull();
      expect(screen.getByRole("button", { name: "No team on this card" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Other team…" })).toBeTruthy();
      expect(screen.getByRole("button", { name: /Boston Red Sox/ }).getAttribute("aria-pressed")).toBeNull();
    });

    it("a team picked with Other team… before the card's context arrives is saved right away", async () => {
      evidence(2024, { answer: null, candidates: [] });
      const props = (ctx: TidyCardContext | undefined): TidyTileProps => ({
        row: row(),
        context: ctx,
        attention: { level: "fix", items },
        leafId: "leaf-1" as never,
        sportId: SPORT as never,
        leafCards: [],
        setName: "Set",
      });
      render(
        <AnsweredProvider value={() => {}}>
          <TeamTile {...props(undefined)} />
        </AnsweredProvider>,
      );
      await click(screen.getByRole("button", { name: "Other team…" }));
      await click(screen.getByRole("button", { name: "Pick a team" }));
      expect(mutation("selectorOptions.updateCard")).toHaveBeenCalledWith({
        id: CARD,
        teamOnCardIds: ["team-9"],
        regenerateListing: true,
      });
    });

    it("keeps the Other team… search itself open across the same switch", async () => {
      evidence(2024, { answer: null, candidates: [] });
      const props = (ctx: TidyCardContext | undefined): TidyTileProps => ({
        row: row(),
        context: ctx,
        attention: { level: "fix", items },
        leafId: "leaf-1" as never,
        sportId: SPORT as never,
        leafCards: [],
        setName: "Set",
      });
      const tree = (ctx: TidyCardContext | undefined) => (
        <AnsweredProvider value={() => {}}>
          <TeamTile {...props(ctx)} />
        </AnsweredProvider>
      );
      const { rerender } = render(tree(undefined));
      await click(screen.getByRole("button", { name: "Other team…" }));
      const pick = screen.getByRole("button", { name: "Pick a team" });
      rerender(tree(ctx()));
      expect(screen.getByRole("button", { name: "Pick a team" })).toBe(pick);
    });

    it("'Other team…' saves the searched team right away", async () => {
      evidence(2024, { answer: null, candidates: [] });
      renderTile({ row: row(), ctx: ctx(), items });
      await click(screen.getByRole("button", { name: "Other team…" }));
      await click(screen.getByRole("button", { name: "Pick a team" }));
      expect(mutation("selectorOptions.updateCard")).toHaveBeenCalledWith({
        id: CARD,
        teamOnCardIds: ["team-9"],
        regenerateListing: true,
      });
    });
  });

  describe("a card that has its team", () => {
    const base = () => ({
      row: card({
        playerIds: ["player-1"],
        teamOnCardIds: ["team-7"],
        tidyChecks: [{ kind: "teamFill", teamIds: ["team-7"], reason: "career" }],
      }),
      items: [] as TidyAttention["items"],
      ctx: context({
        players: [{ playerId: "player-1", name: "Jackson Merrill", sportId: SPORT, stints: [], stintsMore: false }],
        teams: [{ teamId: "team-7", name: "San Diego Padres", onCard: true, candidate: false }],
      }),
    });

    it("a team the commit filled shows no purple note: it is the card's team like any other", () => {
      renderTile({
        row: card({
          playerIds: ["player-1"],
          teamOnCardIds: ["team-7"],
          // An old card may still carry the dead field: the client reads nothing from it.
          tidyChecks: [{ kind: "teamFill", teamIds: ["team-7"], reason: "career" }],
        }),
        items: [] as TidyAttention["items"],
        ctx: context({
          players: [{ playerId: "player-1", name: "Jackson Merrill", sportId: SPORT, stints: [], stintsMore: false }],
          teams: [{ teamId: "team-7", name: "San Diego Padres", onCard: true, candidate: false }],
        }),
      });
      expect(screen.queryByText(/Team filled from/)).toBeNull();
      expect(screen.queryByRole("note")).toBeNull();
      expect(screen.getByRole("button", { name: "Edit San Diego Padres" })).toBeTruthy();
    });

    it("Edit swaps the team on this card only", async () => {
      renderTile(base());
      await click(screen.getByRole("button", { name: "Edit San Diego Padres" }));
      await click(screen.getByRole("button", { name: "Pick a team" }));
      expect(mutation("selectorOptions.updateCard")).toHaveBeenCalledWith({
        id: CARD,
        teamOnCardIds: ["team-9"],
        regenerateListing: true,
      });
    });

    it("'+ Another team' adds one", async () => {
      renderTile(base());
      await click(screen.getByRole("button", { name: "+ Another team" }));
      await click(screen.getByRole("button", { name: "Pick a team" }));
      expect(mutation("selectorOptions.updateCard")).toHaveBeenCalledWith({
        id: CARD,
        teamOnCardIds: ["team-7", "team-9"],
        regenerateListing: true,
      });
    });

    describe("Apply to all (A13, A14: main's wizard line, no career gate)", () => {
      const sibling = (id: string, extra: Record<string, unknown> = {}) =>
        card({ _id: id, playerIds: ["player-1"], ...extra });
      const applied = () => mutation("tidyCards.applyTeamToPlayerCards");

      it("proposes this card's line: the same player set and claim key, teamless, and the server decides", async () => {
        const b = base();
        renderTile({
          ...b,
          leafCards: [
            b.row,
            sibling("c2"),
            sibling("c3"),
            sibling("c4", { teamOnCardIds: ["team-1"] }),
            // A claim of its own is another line (rule 8): the listing's name, the publisher's checklist.
            sibling("c5", { bscTeamName: "Padres" }),
            sibling("c9", { teamCheckOutcome: "checklist" }),
            sibling("c6", { pendingTeamNames: ["Padres"] }),
            sibling("c7", { teamNoneConfirmedAt: 1 }),
            sibling("c8", { sourceDisagreements: [{ field: "teams", values: [] }] }),
            sibling("c10", { playerIds: ["player-1", "player-2"] }),
            sibling("c11", { playerIds: ["player-2"] }),
          ],
        });
        await click(screen.getByRole("button", { name: "Apply to all 2 other Jackson Merrill cards" }));
        expect(applied()).toHaveBeenCalledWith({
          sourceCardId: CARD,
          teamIds: ["team-7"],
          cardIds: ["c2", "c3"],
        });
      });

      it("there is no career gate: it is offered whatever the career says (a card the career never gave this team)", async () => {
        const b = base();
        renderTile({ ...b, leafCards: [b.row, sibling("c2")] });
        await click(screen.getByRole("button", { name: "Apply to the other Jackson Merrill card" }));
        expect(applied()).toHaveBeenCalledTimes(1);
      });

      it("a card under the same listing claim is on the line; one under another claim, or none, is not", async () => {
        const b = base();
        renderTile({
          ...b,
          row: card({ ...b.row, bscTeamName: "  Some   Club " } as Record<string, unknown>),
          leafCards: [
            b.row,
            sibling("c2", { bscTeamName: "some club" }),
            sibling("c3", { bscTeamName: "Other Club" }),
            sibling("c4"),
          ],
        });
        await click(screen.getByRole("button", { name: "Apply to the other Jackson Merrill card" }));
        expect(applied()).toHaveBeenCalledWith({ sourceCardId: CARD, teamIds: ["team-7"], cardIds: ["c2"] });
      });

      it("a card the publisher's checklist settled shares a line only with cards it settled too", async () => {
        const b = base();
        renderTile({
          ...b,
          row: card({ ...b.row, teamCheckOutcome: "checklist" } as Record<string, unknown>),
          leafCards: [b.row, sibling("c2", { teamCheckOutcome: "checklist" }), sibling("c3"), sibling("c4", { teamCheckOutcome: "gaveUp" })],
        });
        await click(screen.getByRole("button", { name: "Apply to the other Jackson Merrill card" }));
        expect(applied()).toHaveBeenCalledWith({ sourceCardId: CARD, teamIds: ["team-7"], cardIds: ["c2"] });
      });

      it("a multi-player card applies to the cards with the same player set, in any order, with every team", async () => {
        const two = {
          row: card({ playerIds: ["player-1", "player-2"], teamOnCardIds: ["team-7", "team-8"] }),
          items: [] as TidyAttention["items"],
          ctx: context({
            players: [
              { playerId: "player-1", name: "Jackson Merrill", sportId: SPORT, stints: [], stintsMore: false },
              { playerId: "player-2", name: "Somebody Else", sportId: SPORT, stints: [], stintsMore: false },
            ],
          }),
        };
        renderTile({
          ...two,
          leafCards: [
            two.row,
            card({ _id: "c2", playerIds: ["player-1", "player-2"] }),
            card({ _id: "c3", playerIds: ["player-2", "player-1"] }),
            card({ _id: "c4", playerIds: ["player-1"] }),
            card({ _id: "c5", playerIds: ["player-1", "player-2", "player-3"] }),
          ],
        });
        await click(screen.getByRole("button", { name: "Apply to all 2 other Jackson Merrill & Somebody Else cards" }));
        expect(applied()).toHaveBeenCalledWith({
          sourceCardId: CARD,
          teamIds: ["team-7", "team-8"],
          cardIds: ["c2", "c3"],
        });
      });

      it("a card with nobody on it is offered no Apply to all, however many other cards have no player (Jason, 2026-11-23)", () => {
        const none = {
          row: card({ teamOnCardIds: ["team-7"] }),
          items: [] as TidyAttention["items"],
          ctx: context({ players: [] }),
        };
        renderTile({
          ...none,
          leafCards: [none.row, card({ _id: "c2" }), card({ _id: "c3", bscTeamName: "League Leaders" }), sibling("c4")],
        });
        expect(screen.queryByRole("button", { name: /Apply to/ })).toBeNull();
        expect(screen.queryByRole("button", { name: /with no player/ })).toBeNull();
        expect(applied()).not.toHaveBeenCalled();
        // The rest of the tile is untouched: the team and the way to add another.
        expect(screen.getByRole("button", { name: "+ Another team" })).toBeTruthy();
      });

      it("reads every refusal the way the server does: a pending player name, a blank pending team name; a whitespace listing team is no claim", async () => {
        const b = base();
        renderTile({
          ...b,
          leafCards: [
            b.row,
            sibling("c2"),
            // A second name nobody has answered: `isTeamlessOnLine` refuses on its length.
            sibling("c3", { pendingPlayerNames: ["Jackson Merril"] }),
            sibling("c4", { pendingPlayerNames: [""] }),
            sibling("c5", { pendingTeamNames: [""] }),
            sibling("c6", { bscTeamName: " " }),
          ],
        });
        await click(screen.getByRole("button", { name: "Apply to all 2 other Jackson Merrill cards" }));
        expect(applied()).toHaveBeenCalledWith({ sourceCardId: CARD, teamIds: ["team-7"], cardIds: ["c2", "c6"] });
      });

      it("offers nothing when the only other cards still have a pending player name", () => {
        const b = base();
        renderTile({
          ...b,
          leafCards: [b.row, sibling("c2", { pendingPlayerNames: ["Jackson Merril"] })],
        });
        expect(screen.queryByRole("button", { name: /Apply to/ })).toBeNull();
      });

      it.each([
        [{ applied: 2, skipped: 0 }, "Applied to 2 cards."],
        [{ applied: 1, skipped: 1 }, "Applied to 1 card. 1 left as it was."],
        [{ applied: 0, skipped: 2 }, "No cards changed."],
      ])("shows the server's %j as %j", async (result, text) => {
        applied().mockResolvedValue(result);
        const b = base();
        renderTile({ ...b, leafCards: [b.row, sibling("c2"), sibling("c3")] });
        await click(screen.getByRole("button", { name: "Apply to all 2 other Jackson Merrill cards" }));
        expect(screen.getByText(text)).toBeTruthy();
      });

      it("is not offered with nothing to apply to, or while the card has no team", () => {
        const b = base();
        const { unmount } = renderTile({ ...b, leafCards: [b.row] });
        expect(screen.queryByRole("button", { name: /Apply to/ })).toBeNull();
        unmount();
        const teamless = { ...b, row: card({ playerIds: ["player-1"] }), items: [noTeamItem] };
        renderTile({ ...teamless, leafCards: [sibling("c2")] });
        expect(screen.queryByRole("button", { name: /Apply to/ })).toBeNull();
      });

      it("A14: under the set's own No Team it is shown and accepted (the pre-fill stays off, the answer is the operator's)", async () => {
        const b = base();
        renderTile({ ...b, leafCards: [b.row, sibling("c2"), sibling("c3")], setNoTeam: true });
        await click(screen.getByRole("button", { name: "Apply to all 2 other Jackson Merrill cards" }));
        expect(applied()).toHaveBeenCalledWith({ sourceCardId: CARD, teamIds: ["team-7"], cardIds: ["c2", "c3"] });
        expect(screen.getByRole("button", { name: "Edit San Diego Padres" })).toBeTruthy();
      });

      it("a single card reads in the singular", () => {
        const b = base();
        renderTile({ ...b, leafCards: [b.row, sibling("c2")] });
        expect(screen.getByRole("button", { name: "Apply to the other Jackson Merrill card" })).toBeTruthy();
      });
    });
  });

  it("shows a refused write inline, in the tile", async () => {
    queryResults["teams.nearMatches"] = [];
    mutation("tidyNames.answerName").mockRejectedValueOnce(new Error("Server Error"));
    renderTile();
    await click(screen.getByRole("button", { name: "Not a team" }));
    const tile = screen.getByRole("group", { name: "Team" });
    expect(within(tile).getByRole("alert").textContent).toBe("Couldn't save that answer. Try again.");
  });

  describe("focus after an answer (S1) and after a cancel", () => {
    const base = () => ({
      row: card({ playerIds: ["player-1"], teamOnCardIds: ["team-7"] }),
      items: [] as TidyAttention["items"],
      ctx: context({
        players: [{ playerId: "player-1", name: "Jackson Merrill", sportId: SPORT, stints: [], stintsMore: false }],
        teams: [{ teamId: "team-7", name: "San Diego Padres", onCard: true, candidate: false }],
      }),
    });

    it("a team link with no name row draws no note, whatever an older server says in linkedFor", () => {
      const b = base();
      renderTile({
        ...b,
        ctx: { ...b.ctx, linkedFor: [{ kind: "team", teamId: "team-7", reason: "setHistory" }] } as never,
      });
      expect(screen.queryByRole("note")).toBeNull();
      expect(screen.queryByText(/Linked for you/)).toBeNull();
    });

    it("T2: 'Edit' is 'Edit <team>' to a reader, so the name holds the visible word, at the end of the team's line", () => {
      renderTile(base());
      const change = screen.getByRole("button", { name: "Edit San Diego Padres" });
      expect(change.textContent).toBe("Edit");
      expect(change.getAttribute("aria-label")).toBe("Edit San Diego Padres");
      const line = change.parentElement as HTMLElement;
      expect(line.lastElementChild).toBe(change);
      expect(line.className).toContain("flex-wrap");
      expect(line.textContent).toBe("San Diego PadresEdit");
      // No "Change team" row, and the one "+ Another team" stays at the bottom.
      expect(screen.queryByRole("button", { name: /^Change/ })).toBeNull();
      expect(screen.getAllByRole("button", { name: "+ Another team" })).toHaveLength(1);
    });

    it("a pick is an answer: the walk is told, focus is not sent back to the opener", async () => {
      const onAnswered = vi.fn();
      renderTile({ ...base(), onAnswered });
      const change = screen.getByRole("button", { name: "Edit San Diego Padres" });
      change.focus();
      await click(change);
      const pick = screen.getByRole("button", { name: "Pick a team" });
      pick.focus();
      await click(pick);
      expect(onAnswered).toHaveBeenCalledTimes(1);
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      expect(document.activeElement).not.toBe(screen.getByRole("button", { name: "Edit San Diego Padres" }));
    });

    it("Cancel gives focus back to the control that opened the search, and tells the walk nothing", async () => {
      const onAnswered = vi.fn();
      renderTile({ ...base(), onAnswered });
      const add = screen.getByRole("button", { name: "+ Another team" });
      add.focus();
      await click(add);
      fireEvent.click(screen.getByRole("button", { name: "Cancel linking" }));
      await waitFor(() =>
        expect(document.activeElement).toBe(screen.getByRole("button", { name: "+ Another team" })),
      );
      expect(onAnswered).not.toHaveBeenCalled();
    });

    it("'Not a team' is an answer; a refused one is not", async () => {
      queryResults["teams.nearMatches"] = [];
      const onAnswered = vi.fn();
      renderTile({ onAnswered });
      mutation("tidyNames.answerName").mockRejectedValueOnce(new Error("Server Error"));
      await click(screen.getByRole("button", { name: "Not a team" }));
      expect(onAnswered).not.toHaveBeenCalled();
      await click(screen.getByRole("button", { name: "Not a team" }));
      expect(onAnswered).toHaveBeenCalledTimes(1);
    });
  });
});
