/**
 * NEO-590 — Out the Door and Needs a Look name a sale line NB holds no card
 * for by the sale's own words, never as a problem: all that matters is that
 * it sold. Only an oversold line is a problem.
 */

import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { getDashboard, type DashboardData, type SaleLine, type UnshippedSale } from "../fake-data";
import DashboardScreen from "./DashboardScreen";
import { OutTheDoor, unitOf } from "./ToDo";

function wrapper({ children }: { children: ReactNode }) {
  return <MemoryRouter initialEntries={["/dashboard"]}>{children}</MemoryRouter>;
}

const demo = getDashboard();
const someCard = demo.sales!.unshipped.flatMap((o) => o.lines).find((l) => l.card)!.card!;

function order(id: string, orderNumber: string, lines: SaleLine[]): UnshippedSale {
  return {
    id,
    marketplace: "ebay",
    orderNumber,
    daysSinceSold: 0,
    statusText: "Paid",
    lines,
    cardCount: lines.reduce((n, l) => n + l.quantity, 0),
    firstCard: lines.find((l) => l.card)?.card ?? null,
    hasProblem: lines.some((l) => l.problem),
  };
}

function dataWith(orders: UnshippedSale[]): DashboardData {
  return { ...demo, sales: { unshipped: orders }, unlistedBoxes: [] };
}

function drawOut(orders: UnshippedSale[]) {
  return render(<OutTheDoor sales={{ unshipped: orders }} />, { wrapper });
}

describe("Out the Door, a sale NB holds no card for", () => {
  it("a title-only order leads with its title, counts an item, and says nothing about a match", () => {
    drawOut([order("o1", "11-1", [{ card: null, quantity: 1, title: "2023 Topps Chrome #121 Gunnar Henderson RC" }])]);
    expect(screen.getByText("2023 Topps Chrome #121 Gunnar Henderson RC")).toBeTruthy();
    expect(screen.getByText(/1 item\. Sold today\./)).toBeTruthy();
    expect(screen.getByText(/1 order, 1 item\./)).toBeTruthy();
    expect(screen.queryByText(/matched/i)).toBeNull();
    expect(screen.queryByText(/\bcards?\b/)).toBeNull();
  });

  it("a cardless line with no title reads A sale with no title", () => {
    drawOut([order("o1", "11-2", [{ card: null, quantity: 1 }])]);
    expect(screen.getByText("A sale with no title")).toBeTruthy();
    expect(screen.queryByText(/matched/i)).toBeNull();
  });

  it("inside an opened order an untitled line is an item, not a sale; the order's lead keeps A sale with no title", () => {
    drawOut([
      order("o1", "11-2b", [
        { card: null, quantity: 1 },
        { card: null, quantity: 1 },
      ]),
    ]);
    // The lead (the first line, cardless and untitled) names the sale.
    expect(screen.getAllByText("A sale with no title")).toHaveLength(1);
    // Each opened line names an item.
    expect(screen.getAllByText("An item with no title")).toHaveLength(2);
  });

  it("an order of a card and a titled cardless line says items, and the opened line shows its title", () => {
    drawOut([
      order("o1", "11-3", [
        { card: someCard, quantity: 1 },
        { card: null, quantity: 2, title: "Some Rookie Lot" },
      ]),
    ]);
    expect(screen.getByText("and 2 more items")).toBeTruthy();
    const open = screen.getByRole("button", { name: /Show all 3 items/ });
    fireEvent.click(open);
    // The toggle keeps its noun: items when the closed label said items.
    expect(screen.getByRole("button", { name: /Hide the items/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Hide the cards/ })).toBeNull();
    expect(screen.getByText("Some Rookie Lot")).toBeTruthy();
    expect(screen.getByText(/×2/)).toBeTruthy();
    expect(screen.queryByText(/unmatched/i)).toBeNull();
    expect(screen.queryByText(/matched/i)).toBeNull();
  });

  it("an order of cards only keeps the word card", () => {
    drawOut([order("o1", "11-4", [{ card: someCard, quantity: 2 }])]);
    expect(screen.getByText(/2 cards\. Sold today\./)).toBeTruthy();
    expect(screen.getByText(/1 order, 2 cards\./)).toBeTruthy();
  });

  it("the toggle reads cards on both labels when the order is all cards", () => {
    drawOut([order("o1", "11-4b", [{ card: someCard, quantity: 1 }, { card: someCard, quantity: 1 }])]);
    const open = screen.getByRole("button", { name: /Show all 2 cards/ });
    fireEvent.click(open);
    expect(screen.getByRole("button", { name: /Hide the cards/ })).toBeTruthy();
  });

  it("a BuySportsCards order with a cardless line still counts cards, never items", () => {
    const bsc = { ...order("o1", "11-4c", [{ card: someCard, quantity: 1 }, { card: null, quantity: 1, title: "Whatever" }]), marketplace: "bsc" as const };
    expect(unitOf(bsc)).toBe("card");
    expect(unitOf({ ...bsc, marketplace: "ebay" })).toBe("item");
    drawOut([bsc]);
    expect(screen.getByText(/2 cards\. Sold today\./)).toBeTruthy();
    expect(screen.getByText(/1 order, 2 cards\./)).toBeTruthy();
    expect(screen.getByText("and 1 more card")).toBeTruthy();
    expect(screen.queryByText(/\bitems?\b/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Show all 2 cards/ }));
    expect(screen.getByRole("button", { name: /Hide the cards/ })).toBeTruthy();
  });

  it("a single line of several copies shows x N on the lead, not 'and N more' with nothing to open", () => {
    drawOut([order("o1", "11-4d", [{ card: someCard, quantity: 2 }])]);
    expect(screen.getByText("×2")).toBeTruthy();
    expect(screen.queryByText(/and \d+ more/)).toBeNull();
    expect(screen.queryByRole("button", { name: /Show all/ })).toBeNull();
    expect(screen.getByText(/2 cards\. Sold today\./)).toBeTruthy();
  });

  it("a single cardless titled line of several copies does the same", () => {
    drawOut([order("o1", "11-4e", [{ card: null, quantity: 3, title: "Some Rookie Lot" }])]);
    expect(screen.getByText("×3")).toBeTruthy();
    expect(screen.queryByText(/and \d+ more/)).toBeNull();
  });

  it("a single copy shows no x N, and several lines still say 'and N more'", () => {
    drawOut([order("o1", "11-4f", [{ card: someCard, quantity: 1 }])]);
    expect(screen.queryByText(/×/)).toBeNull();
    expect(screen.queryByText(/and \d+ more/)).toBeNull();
  });

  it("the empty sleeve of an order's lead sits at the top of a tall row", () => {
    const { container } = drawOut([order("o1", "11-4g", [{ card: null, quantity: 1, title: "A lot" }])]);
    const sleeve = container.querySelector(".aspect-\\[5\\/7\\]");
    expect(sleeve?.className).toContain("self-start");
  });

  it("an oversold line still warns, with its sold and held counts", () => {
    drawOut([order("o1", "11-5", [{ card: someCard, quantity: 3, problem: { kind: "oversold", sold: 3, inBoxes: 1 } }])]);
    expect(screen.getAllByText(/Oversold/).length).toBeGreaterThan(0);
    const region = document.body;
    expect(within(region).getByText(/sold 3, your boxes hold 1/)).toBeTruthy();
  });
});

describe("Needs a Look", () => {
  it("a title-only order is no entry: no Jump to order link for it", () => {
    render(
      <DashboardScreen
        data={dataWith([order("o1", "11-6", [{ card: null, quantity: 1, title: "A Listing Title" }])])}
      />,
      { wrapper },
    );
    expect(screen.getByText("A Listing Title")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Jump to order #11-6/ })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Needs a Look", level: 2 })).toBeNull();
  });

  it("an oversold order is an entry, and the demo still has Needs a Look", () => {
    const over = order("o2", "11-7", [{ card: someCard, quantity: 2, problem: { kind: "oversold", sold: 2, inBoxes: 1 } }]);
    render(<DashboardScreen data={dataWith([over])} />, { wrapper });
    expect(screen.getByRole("heading", { name: "Needs a Look", level: 2 })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Jump to order #11-7/ })).toBeTruthy();
  });

  it("the demo shows Needs a Look and its title-only order, and nothing unmatched", () => {
    render(<DashboardScreen data={demo} />, { wrapper });
    expect(screen.getByRole("heading", { name: "Needs a Look", level: 2 })).toBeTruthy();
    const out = screen.getByRole("region", { name: "Out the Door" });
    expect(within(out).getByText("2023 Topps Chrome #121 Gunnar Henderson RC Orioles")).toBeTruthy();
    expect(within(out).queryByText(/matched/i)).toBeNull();
  });
});
