import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { Theme } from "@radix-ui/themes";
import type { Card, Copy, SmartRule } from "../data/types";

// The rule builder's pickers read the catalog: nothing to look up here.
vi.mock("../data/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../data/store")>()),
  searchable: () => false,
  useDrill: () => [],
  useRuleBrands: () => [],
  useSuggestions: () => [],
}));

vi.mock("../catalog/search", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../catalog/search")>()),
  useSearchText: (q: string) => q,
}));

import Pocket from "./Pocket";
import CardFace from "../../prototypes/_shared/CardFace";
import RuleBuilder, { CAMEOS_DROPPED_NOTE } from "./RuleBuilder";
import { markOutside, paginate, sortedPages, type CameoOf, type PocketModel } from "./model";
import { Cover } from "./parts";
import type { OpenView } from "./openView";

/**
 * NEO-528 — a smart binder that includes cameos: its pockets wear the Cameo
 * brooch and say who in their names, its cover counts cameos apart, and its
 * rule builder offers "Include cameos" only where a line can use it.
 */

beforeEach(() => {
  window.matchMedia = ((query: string) => ({
    matches: query.includes("reduced-motion"),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
});
afterEach(cleanup);

const MARINO = { id: "p-marino", name: "Dan Marino" };
const CLAYTON = { id: "p-clayton", name: "Mark Clayton" };
const SET = { id: "s1", year: 1990, season: "1990", name: "Score" } as unknown as Card["set"];
const BASE = { id: "v1", kind: "base", name: null, order: 0 } as unknown as Card["variant"];

const card = (n: number, over: Partial<Card> = {}): Card =>
  ({
    id: `c${n}`,
    set: SET,
    variant: BASE,
    cardNumber: String(n),
    players: [MARINO],
    teams: [],
    printRun: null,
    features: [],
    cardVariation: null,
    isVariation: false,
    sortOrder: n,
    finish: { kind: "standard" },
    ...over,
  }) as Card;
const copy = (c: Card, over: Partial<Copy> = {}): Copy =>
  ({
    id: `k-${c.id}`,
    cardId: c.id,
    homeId: "b1",
    homeKind: "binder",
    upForTrade: false,
    quantity: 1,
    acquiredAt: "2026-01-01",
    notes: "",
    ...over,
  }) as Copy;

// #1 is Marino's own card; #2 is Clayton's, with Marino pictured; #3 Clayton's
// with Marino pictured, still needed.
const own = card(1);
const cameoHeld = card(2, { players: [CLAYTON], secondaryPlayers: [MARINO] });
const cameoNeed = card(3, { players: [CLAYTON], secondaryPlayers: [MARINO] });
const cameoIds = new Set([cameoHeld.id, cameoNeed.id]);
const cameo: CameoOf = (c) => (cameoIds.has(c.id) ? ["Dan Marino"] : undefined);

function pockets(pages: ReturnType<typeof sortedPages>): PocketModel[] {
  return pages.flatMap((p) => p.pockets).filter((p) => p.content.kind !== "empty");
}

describe("the binder model marks cameos", () => {
  it("a sorted binder marks held and needed cameo cards with who is pictured, and never its own player's card", () => {
    const pages = sortedPages({
      copies: [copy(own), copy(cameoHeld)],
      cards: new Map([own, cameoHeld, cameoNeed].map((c) => [c.id, c])),
      sort: "checklist",
      emptySlots: true,
      needs: [cameoNeed],
      fits: () => true,
      cameo,
    });
    const byCard = new Map(pockets(pages).map((p) => [p.content.kind === "empty" ? "" : p.content.card.id, p]));
    expect(byCard.get(own.id)?.cameo).toBeUndefined();
    expect(byCard.get(cameoHeld.id)?.cameo).toEqual(["Dan Marino"]);
    expect(byCard.get(cameoNeed.id)?.content.kind).toBe("need");
    expect(byCard.get(cameoNeed.id)?.cameo).toEqual(["Dan Marino"]);
  });

  it("a card outside the rule is never a cameo", () => {
    const pages = sortedPages({
      copies: [copy(cameoHeld)],
      cards: new Map([[cameoHeld.id, cameoHeld]]),
      sort: "checklist",
      emptySlots: false,
      fits: () => false,
      cameo,
    });
    const [pocket] = pockets(pages);
    expect(pocket.outside).toBe(true);
    expect(pocket.cameo).toBeUndefined();
  });

  it("a binder laid out by hand marks its cameo cards too", () => {
    const pages = paginate(
      [own, cameoHeld].map((c) => ({ content: { kind: "have" as const, card: c, copies: [copy(c)] } })),
      null,
    );
    const marked = pockets(markOutside(pages, () => true, cameo));
    expect(marked.map((p) => p.cameo)).toEqual([undefined, ["Dan Marino"]]);
  });
});

function renderPocket(pocket: PocketModel, saleTag = false, variant: "binder" | "browse" = "binder") {
  render(
    <Theme>
      <Pocket
        pocket={pocket}
        variant={variant}
        index={0}
        pageNumber={1}
        aimed={false}
        saleTag={saleTag}
        onOpen={vi.fn()}
        onAdd={vi.fn()}
        onAim={vi.fn()}
      />
    </Theme>,
  );
}

describe("a cameo pocket", () => {
  it("a held cameo wears the brooch and its name says who, at the end", () => {
    renderPocket({ content: { kind: "have", card: cameoHeld, copies: [copy(cameoHeld)] }, cameo: ["Dan Marino"] });
    const button = screen.getByRole("button", { name: /Mark Clayton.*, Dan Marino is a cameo on this card$/ });
    const tag = within(button).getByText("Cameo");
    expect(tag.className).toBe("nb-cameo-tag");
    expect(tag.getAttribute("aria-hidden")).toBe("true");
  });

  it("stacks with the For sale sticker: both drawn, on different edges", () => {
    renderPocket(
      {
        content: { kind: "have", card: cameoHeld, copies: [copy(cameoHeld, { homeKind: "box" })] },
        cameo: ["Dan Marino"],
      },
      true,
    );
    const button = screen.getByRole("button", { name: /for sale, Dan Marino is a cameo on this card$/ });
    expect(within(button).getByText("For sale").className).toContain("p2-tag");
    expect(within(button).getByText("Cameo").className).toBe("nb-cameo-tag");
  });

  it("a needed cameo says who before what to do", () => {
    renderPocket({ content: { kind: "need", card: cameoNeed }, cameo: ["Dan Marino"] });
    expect(
      screen.getByRole("button", { name: /Mark Clayton.*, Dan Marino is a cameo on this card, need\. Add it$/ }),
    ).toBeTruthy();
    expect(screen.getByText("Cameo").className).toBe("nb-cameo-tag");
  });

  it("in browse, a held cameo's name says who too", () => {
    renderPocket(
      { content: { kind: "have", card: cameoHeld, copies: [copy(cameoHeld)] }, cameo: ["Dan Marino"] },
      false,
      "browse",
    );
    expect(
      screen.getByRole("button", { name: /Mark Clayton.*, have, Dan Marino is a cameo on this card$/ }),
    ).toBeTruthy();
    expect(screen.getByText("Cameo").className).toBe("nb-cameo-tag");
  });

  it("in browse, a needed cameo wears the brooch and its Add chip says who", () => {
    renderPocket({ content: { kind: "need", card: cameoNeed }, cameo: ["Dan Marino"] }, false, "browse");
    expect(
      screen.getByRole("button", { name: /^Add .*Mark Clayton.*, Dan Marino is a cameo on this card$/ }),
    ).toBeTruthy();
    const tag = screen.getByText("Cameo");
    expect(tag.className).toBe("nb-cameo-tag");
    expect(tag.getAttribute("aria-hidden")).toBe("true");
  });

  it("the player's own card wears no brooch", () => {
    renderPocket({ content: { kind: "have", card: own, copies: [copy(own)] } });
    expect(screen.queryByText("Cameo")).toBeNull();
    expect(screen.getByRole("button").getAttribute("aria-label")).not.toContain("cameo");
  });
});

const OPEN = {
  key: "b1",
  title: "Marino",
  badge: null,
  share: null,
  settings: true,
  findCards: true,
  pileTools: false,
  label: null,
  editable: null,
  want: false,
  blurb: [],
  vinyl: "#000",
  pockets: "binder",
  saleTags: false,
  box: false,
} as unknown as OpenView;

describe("the cover counts cameos apart", () => {
  it("own cards and cameos each get their own have and need", () => {
    render(
      <Cover
        open={{ ...OPEN, tally: { have: 12, need: 30, cards: 14, cameos: { have: 2, need: 5 } } }}
        actions={{ onEditLabel: vi.fn(), onEditContainer: vi.fn() }}
      />,
    );
    expect(screen.getByText("12 have, 30 need")).toBeTruthy();
    expect(screen.getByText("Cameos: 2 have, 5 need")).toBeTruthy();
  });

  it("no cameo line when the binder does not include cameos", () => {
    render(
      <Cover
        open={{ ...OPEN, tally: { have: 12, need: 30, cards: 14 } }}
        actions={{ onEditLabel: vi.fn(), onEditContainer: vi.fn() }}
      />,
    );
    expect(screen.queryByText(/Cameos/)).toBeNull();
  });
});

describe("Include cameos in the rule builder", () => {
  function renderRule(rule: SmartRule) {
    const onChange = vi.fn();
    render(<RuleBuilder rule={rule} names={{}} onChange={onChange} showProblems={false} />);
    return onChange;
  }
  const marino: SmartRule = { version: 1, match: "all", terms: [{ test: { kind: "player", playerIds: [MARINO.id] } }] };

  it("is offered, off, beside a player line, and turning it on sets the option", () => {
    const onChange = renderRule(marino);
    const box = screen.getByRole("checkbox", { name: "Include cameos" });
    expect((box as HTMLInputElement).checked).toBe(false);
    expect(box.getAttribute("aria-describedby")).toBeTruthy();
    fireEvent.click(box);
    expect(onChange.mock.calls[0][0]).toEqual({ ...marino, secondaryPlayers: true });
  });

  it("turning it off drops the option", () => {
    const onChange = renderRule({ ...marino, secondaryPlayers: true });
    fireEvent.click(screen.getByRole("checkbox", { name: "Include cameos" }));
    expect(onChange.mock.calls[0][0]).toEqual(marino);
    expect("secondaryPlayers" in onChange.mock.calls[0][0]).toBe(false);
  });

  it("is offered beside a Hall of Famers line", () => {
    renderRule({ version: 1, match: "all", terms: [{ test: { kind: "hallOfFame" } }] });
    expect(screen.getByRole("checkbox", { name: "Include cameos" })).toBeTruthy();
  });

  it("is not offered when no line could use it: a team line, or a player left out", () => {
    renderRule({ version: 1, match: "all", terms: [{ test: { kind: "team", teamIds: ["t1"] } }] });
    expect(screen.queryByRole("checkbox", { name: "Include cameos" })).toBeNull();
    cleanup();
    renderRule({ version: 1, match: "all", terms: [{ negate: true, test: { kind: "player", playerIds: [MARINO.id] } }] });
    expect(screen.queryByRole("checkbox", { name: "Include cameos" })).toBeNull();
  });

  it("says what it adds, in the collector's words", () => {
    renderRule(marino);
    const box = screen.getByRole("checkbox", { name: "Include cameos" });
    const help = document.getElementById(box.getAttribute("aria-describedby")!);
    expect(help?.textContent).toBe(
      "Pull in cards they only cameo on too, like a team leaders card or a teammate's highlight. Cameos get their own count.",
    );
  });

  it("says so, politely, when an edit takes the option away with its last player line", () => {
    function Harness() {
      const [rule, setRule] = useState<SmartRule>({ ...marino, secondaryPlayers: true });
      return <RuleBuilder rule={rule} names={{}} onChange={(next) => setRule(next)} showProblems={false} />;
    }
    render(<Harness />);
    const status = screen.getByRole("status");
    expect(status.textContent).toBe("");
    fireEvent.click(screen.getByRole("checkbox", { name: "Leave these out" }));
    expect(screen.queryByRole("checkbox", { name: "Include cameos" })).toBeNull();
    // The same node, mounted before it spoke.
    expect(screen.getByRole("status")).toBe(status);
    expect(status.textContent).toBe(CAMEOS_DROPPED_NOTE);
    // A player line again: the box is back and the note goes.
    fireEvent.click(screen.getByRole("checkbox", { name: "Leave these out" }));
    expect(screen.getByRole("checkbox", { name: "Include cameos" })).toBeTruthy();
    expect(status.textContent).toBe("");
  });

  it("no note when the option was never on", () => {
    function Harness() {
      const [rule, setRule] = useState<SmartRule>(marino);
      return <RuleBuilder rule={rule} names={{}} onChange={(next) => setRule(next)} showProblems={false} />;
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Leave these out" }));
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("turning the last player line around drops the option from the draft", () => {
    const onChange = renderRule({ ...marino, secondaryPlayers: true });
    fireEvent.click(screen.getByRole("checkbox", { name: "Leave these out" }));
    const next = onChange.mock.calls[0][0] as SmartRule;
    expect(next.terms[0].negate).toBe(true);
    expect(next.secondaryPlayers).toBeUndefined();
  });
});

describe("a cameo-only card's face (NEO-528 audit)", () => {
  const face = (c: Card) => {
    const { container } = render(
      <Theme>
        <CardFace model={c} size="lg" />
      </Theme>,
    );
    return container;
  };
  const RED_SOX = { id: "t-bos", name: "Red Sox", location: "Boston" };

  it("puts the card's own name on the nameplate, and leaves the team out of the line under it when none is known", () => {
    const c = card(9, { players: [], cardName: "Dolphins Leaders", secondaryPlayers: [MARINO] });
    const el = face(c);
    expect(screen.getByText("Dolphins Leaders")).toBeTruthy();
    // No leading ", " where the team would go.
    const lines = Array.from(el.querySelectorAll("span")).map((s) => s.textContent ?? "");
    expect(lines.some((t) => t.startsWith(", "))).toBe(false);
    // Monogram from the card's own name, not "?".
    expect(screen.getByText("DL")).toBeTruthy();
  });

  it("with no name either, says who is pictured", () => {
    face(card(9, { players: [], secondaryPlayers: [MARINO] }));
    expect(screen.getByText("With Dan Marino")).toBeTruthy();
    expect(screen.getByText("DM")).toBeTruthy();
  });

  it("joins team, variation and variant with commas, skipping the blanks", () => {
    const el = face(
      card(9, {
        teams: [RED_SOX] as Card["teams"],
        cardVariation: "Sliding",
        variant: { id: "v2", kind: "parallel", name: "Gold", order: 1 } as unknown as Card["variant"],
      }),
    );
    expect(screen.getByText("Red Sox, Sliding, Gold")).toBeTruthy();
    cleanup();
    const bare = face(card(9, { cardVariation: "Sliding" }));
    const texts = Array.from(bare.querySelectorAll("span")).map((s) => s.textContent);
    expect(texts).toContain("Sliding");
  });
});
