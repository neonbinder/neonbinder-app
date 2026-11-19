/**
 * NEO-555 — the hop a spec uses to set up and read its fake eBay seller
 * (`/testing/ebay-fake`). It must take exactly one of ?seller= / ?order= /
 * ?poll=1, call nothing on a malformed ask, and print a status line the
 * Playwright helper classifies. Every success line starts `[testing-ebay-fake]`
 * and every refusal starts `Error:`, `Give exactly`, a `?param=` or `Testing
 * mode`, as the BSC hop's do.
 */

import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authed: true,
  loading: false,
  setSeller: vi.fn(),
  addOrder: vi.fn(),
  pollNow: vi.fn(),
}));

vi.mock("@/convex/_generated/api", () => ({
  api: {
    testing: {
      setMyEbaySeller: "testing:setMyEbaySeller",
      addMyEbayOrder: "testing:addMyEbayOrder",
      pollMySalesNow: "testing:pollMySalesNow",
    },
  },
}));

vi.mock("convex/react", () => ({
  useConvexAuth: () => ({ isAuthenticated: mocks.authed, isLoading: mocks.loading }),
  useAction: (ref: string) =>
    ({
      "testing:setMyEbaySeller": mocks.setSeller,
      "testing:addMyEbayOrder": mocks.addOrder,
      "testing:pollMySalesNow": mocks.pollNow,
    })[ref],
}));

import TestingEbayFakePage from "./page";

const DONE = /^\[testing-ebay-fake\] (Seller set|Order added|Polled)/;
const FAILED = /^\[testing-ebay-fake\] (Error:|Give exactly|\?(seller|order|poll)=|Testing mode)/;
const enc = (v: unknown) => encodeURIComponent(JSON.stringify(v));

function renderPage(query: string) {
  return render(
    <MemoryRouter initialEntries={[`/testing/ebay-fake${query}`]}>
      <Routes>
        <Route path="/testing/ebay-fake" element={<TestingEbayFakePage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const statusText = async (): Promise<string> => {
  const el = await screen.findByText((text) => DONE.test(text) || FAILED.test(text));
  return el.textContent ?? "";
};

const noAction = () => {
  expect(mocks.setSeller).not.toHaveBeenCalled();
  expect(mocks.addOrder).not.toHaveBeenCalled();
  expect(mocks.pollNow).not.toHaveBeenCalled();
};

describe("TestingEbayFakePage", () => {
  beforeEach(() => {
    mocks.authed = true;
    mocks.loading = false;
    mocks.setSeller = vi.fn(async (a: { fulfillmentPolicies?: unknown[] }) => ({ policies: a.fulfillmentPolicies?.length ?? 0 }));
    mocks.addOrder = vi.fn(async (a: { order: { lines: unknown[] } }) => ({ lines: a.order.lines.length }));
    mocks.pollNow = vi.fn(async () => ({ ordersRead: 2, ordersStored: 1, linesApplied: 3 }));
    vi.stubEnv("VITE_CLERK_TESTING_ENABLED", "true");
  });

  describe("success lines are DONE and not FAILED", () => {
    it("?seller= passes the object through and says how many policies were set", async () => {
      const seller = { fulfillmentPolicies: [{ name: "Tracked", services: [{ code: "USPSGroundAdvantage" }] }] };
      renderPage(`?seller=${enc(seller)}`);
      const line = await statusText();
      expect(line).toBe("[testing-ebay-fake] Seller set: 1 shipping policies.");
      expect(DONE.test(line)).toBe(true);
      expect(FAILED.test(line)).toBe(false);
      expect(mocks.setSeller).toHaveBeenCalledWith(seller);
    });

    it("?seller= can opt the other account out of policies", async () => {
      renderPage(`?seller=${enc({ seller: "alt", optedIn: false })}`);
      expect(await statusText()).toBe("[testing-ebay-fake] Seller set: 0 shipping policies.");
      expect(mocks.setSeller).toHaveBeenCalledWith({ seller: "alt", optedIn: false });
    });

    it("?order= passes the order through and says how many lines it holds", async () => {
      const order = { lines: [{ sku: "NB2-1-NM", quantity: 1 }, { title: "Some other card", quantity: 2 }] };
      renderPage(`?order=${enc(order)}`);
      const line = await statusText();
      expect(line).toBe("[testing-ebay-fake] Order added: 2 lines.");
      expect(DONE.test(line)).toBe(true);
      expect(mocks.addOrder).toHaveBeenCalledWith({ order });
    });

    it("?order= with a top-level seller picks that account and keeps it out of the order", async () => {
      const lines = [{ quantity: 1 }];
      renderPage(`?order=${enc({ seller: "alt", lines })}`);
      await statusText();
      expect(mocks.addOrder).toHaveBeenCalledWith({ order: { lines }, seller: "alt" });
    });

    it("?poll=1 polls the ebay platform and says what it read", async () => {
      renderPage("?poll=1");
      const line = await statusText();
      expect(line).toBe("[testing-ebay-fake] Polled: 2 orders read, 1 stored, 3 lines applied.");
      expect(DONE.test(line)).toBe(true);
      expect(FAILED.test(line)).toBe(false);
      expect(mocks.pollNow).toHaveBeenCalledWith({ platform: "ebay" });
      expect(mocks.setSeller).not.toHaveBeenCalled();
      expect(mocks.addOrder).not.toHaveBeenCalled();
    });
  });

  describe("a malformed ask prints a FAILED line and calls nothing", () => {
    it.each([
      ["no parameter", ""],
      ["seller and order together", `?seller=${enc({})}&order=${enc({})}`],
      ["seller and poll together", `?seller=${enc({})}&poll=1`],
      ["order and poll together", `?order=${enc({})}&poll=1`],
    ])("%s: exactly one of seller, order or poll", async (_name, query) => {
      renderPage(query);
      const line = await statusText();
      expect(line).toBe("[testing-ebay-fake] Give exactly one of ?seller=, ?order= or ?poll=1.");
      expect(FAILED.test(line)).toBe(true);
      expect(DONE.test(line)).toBe(false);
      noAction();
    });

    it.each([
      ["seller", "?seller=%7Bnope"],
      ["order", "?order=%5Bnot-json"],
      ["seller", "?seller="],
    ])("?%s= with bad JSON (%s)", async (which, query) => {
      renderPage(query);
      const line = await statusText();
      expect(line).toBe(`[testing-ebay-fake] ?${which}= is not valid JSON.`);
      expect(FAILED.test(line)).toBe(true);
      noAction();
    });

    it.each([
      ["seller", `?seller=${enc([])}`],
      ["order", `?order=${enc("text")}`],
    ])("?%s= that is not an object (%s)", async (which, query) => {
      renderPage(query);
      const line = await statusText();
      expect(line).toBe(`[testing-ebay-fake] ?${which}= wants a JSON object.`);
      expect(FAILED.test(line)).toBe(true);
      noAction();
    });

    it.each(["", "0", "true"])("?poll=%j is refused", async (value) => {
      renderPage(`?poll=${value}`);
      const line = await statusText();
      expect(line).toBe("[testing-ebay-fake] Give exactly ?poll=1.");
      expect(FAILED.test(line)).toBe(true);
      noAction();
    });
  });

  it("outside testing mode, prints the FAILED 'Testing mode' line and calls nothing", async () => {
    vi.stubEnv("VITE_CLERK_TESTING_ENABLED", "false");
    renderPage("?poll=1");
    const line = await statusText();
    expect(line).toBe("[testing-ebay-fake] Testing mode is not enabled in this environment.");
    expect(FAILED.test(line)).toBe(true);
    noAction();
  });

  it("an action's refusal stays on the page as a FAILED 'Error:' line", async () => {
    mocks.addOrder = vi.fn(async () => {
      throw new Error("This deployment does not talk to the fake eBay");
    });
    renderPage(`?order=${enc({ lines: [{ quantity: 1 }] })}`);
    const line = await statusText();
    expect(line).toBe("[testing-ebay-fake] Error: This deployment does not talk to the fake eBay");
    expect(FAILED.test(line)).toBe(true);
    expect(DONE.test(line)).toBe(false);
  });

  it("the status line is the page's one live region, inside <main>, and its text is unchanged", async () => {
    renderPage("?poll=1");
    const line = await statusText();
    const region = screen.getByRole("status");
    expect(region.textContent).toBe(line);
    expect(region.closest("main")).not.toBeNull();
    expect(screen.getAllByRole("main")).toHaveLength(1);
  });

  it("signed out, waits for authentication and calls nothing", async () => {
    mocks.authed = false;
    renderPage("?poll=1");
    await waitFor(() => expect(screen.getByText(/Waiting for authentication/)).not.toBeNull());
    noAction();
  });

  it("while the Convex client is still loading, calls nothing yet", async () => {
    mocks.loading = true;
    renderPage("?poll=1");
    await waitFor(() => expect(screen.getByText(/Initializing/)).not.toBeNull());
    noAction();
  });
});
