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
import { OutTheDoor } from "./ToDo";

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
    expect(screen.getByRole("button", { name: /Hide the cards/ })).toBeTruthy();
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
