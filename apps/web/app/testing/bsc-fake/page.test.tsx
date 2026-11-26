/**
 * NEO-552 — the hop a spec uses to make the fake BuySportsCards misbehave
 * (`/testing/bsc-fake`). It must take exactly one of ?rules= / ?order= /
 * ?clear=, call nothing on a malformed ask, and print a status line that the
 * Playwright helper (`playwright/support/bscFake.ts`) classifies with its own
 * DONE / FAILED patterns. Those patterns are imported here, not copied, so a
 * reworded line on either side turns this red.
 */

import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DONE, FAILED } from "../../../playwright/support/bscFake";

const mocks = vi.hoisted(() => ({
  authed: true,
  loading: false,
  setFaults: vi.fn(),
  addOrder: vi.fn(),
  clearFaults: vi.fn(),
  clearGate: vi.fn(),
  pollNow: vi.fn(),
  cancelLane: vi.fn(),
}));

vi.mock("@/convex/_generated/api", () => ({
  api: {
    testing: {
      setMyBscFaults: "testing:setMyBscFaults",
      addMyBscOrder: "testing:addMyBscOrder",
      clearMyBscFaults: "testing:clearMyBscFaults",
      clearBscCallGate: "testing:clearBscCallGate",
      pollMySalesNow: "testing:pollMySalesNow",
      cancelMyBscTeamChecks: "testing:cancelMyBscTeamChecks",
    },
  },
}));

// bscFake.ts imports Playwright's runtime, which must not load under happy-dom
// (its module load trips the network guard). Only the two regexes are used.
vi.mock("@playwright/test", () => ({ expect: vi.fn() }));

vi.mock("convex/react", () => ({
  useConvexAuth: () => ({ isAuthenticated: mocks.authed, isLoading: mocks.loading }),
  useAction: (ref: string) =>
    ({
      "testing:setMyBscFaults": mocks.setFaults,
      "testing:addMyBscOrder": mocks.addOrder,
      "testing:clearMyBscFaults": mocks.clearFaults,
      "testing:clearBscCallGate": mocks.clearGate,
      "testing:pollMySalesNow": mocks.pollNow,
    })[ref],
  useMutation: (ref: string) =>
    ({
      "testing:cancelMyBscTeamChecks": mocks.cancelLane,
    })[ref],
}));

import TestingBscFakePage from "./page";

const enc = (v: unknown) => encodeURIComponent(JSON.stringify(v));

function renderPage(query: string) {
  return render(
    <MemoryRouter initialEntries={[`/testing/bsc-fake${query}`]}>
      <Routes>
        <Route path="/testing/bsc-fake" element={<TestingBscFakePage />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** The status line, once it has settled on a done or a failed message. */
const statusText = async (): Promise<string> => {
  const el = await screen.findByText((text) => DONE.test(text) || FAILED.test(text));
  return el.textContent ?? "";
};

const noAction = () => {
  expect(mocks.setFaults).not.toHaveBeenCalled();
  expect(mocks.addOrder).not.toHaveBeenCalled();
  expect(mocks.clearFaults).not.toHaveBeenCalled();
  expect(mocks.clearGate).not.toHaveBeenCalled();
  expect(mocks.pollNow).not.toHaveBeenCalled();
  expect(mocks.cancelLane).not.toHaveBeenCalled();
};

describe("TestingBscFakePage", () => {
  beforeEach(() => {
    mocks.authed = true;
    mocks.loading = false;
    mocks.setFaults = vi.fn(async (a: { rules: unknown[] }) => ({ rules: a.rules.length }));
    mocks.addOrder = vi.fn(async (a: { order: { items: unknown[] } }) => ({ items: a.order.items.length }));
    mocks.clearFaults = vi.fn(async () => ({}));
    mocks.clearGate = vi.fn(async () => ({}));
    mocks.pollNow = vi.fn(async () => ({ ordersRead: 2, ordersStored: 1, linesApplied: 3 }));
    mocks.cancelLane = vi.fn(async () => ({ cancelled: 28 }));
    vi.stubEnv("VITE_CLERK_TESTING_ENABLED", "true");
  });

  describe("success lines match the helper's DONE pattern, and not its FAILED one", () => {
    it("?rules= passes the parsed rules through and says how many were set", async () => {
      const rules = [
        { match: { method: "GET", pathTemplate: "marketplace/user/profile" }, kind: "delay", delayMs: 100 },
        { match: { method: "POST", pathTemplate: "search/bulk-upload/filters" }, kind: "429" },
      ];
      renderPage(`?rules=${enc(rules)}`);
      const line = await statusText();
      expect(line).toBe("[testing-bsc-fake] Fault rules set: 2.");
      expect(DONE.test(line)).toBe(true);
      expect(FAILED.test(line)).toBe(false);
      expect(mocks.setFaults).toHaveBeenCalledWith({ rules });
    });

    it("?order= passes the order through and says how many items it holds", async () => {
      const order = { items: [{ cardId: "1", condition: "NM", quantity: 1 }] };
      renderPage(`?order=${enc(order)}`);
      const line = await statusText();
      expect(line).toBe("[testing-bsc-fake] Order added: 1 items.");
      expect(DONE.test(line)).toBe(true);
      expect(FAILED.test(line)).toBe(false);
      expect(mocks.addOrder).toHaveBeenCalledWith({ order });
    });

    it.each([
      ["faults", 1, 0],
      ["gate", 0, 1],
      ["all", 1, 1],
    ])("?clear=%s clears what it names and nothing else", async (what, faults, gate) => {
      renderPage(`?clear=${what}`);
      const line = await statusText();
      expect(line).toBe(`[testing-bsc-fake] Cleared: ${what}.`);
      expect(DONE.test(line)).toBe(true);
      expect(FAILED.test(line)).toBe(false);
      expect(mocks.clearFaults).toHaveBeenCalledTimes(faults);
      expect(mocks.clearGate).toHaveBeenCalledTimes(gate);
      expect(mocks.setFaults).not.toHaveBeenCalled();
      expect(mocks.addOrder).not.toHaveBeenCalled();
      expect(mocks.cancelLane).not.toHaveBeenCalled();
    });

    it("?clear=lane (NEO-644) cancels the caller's queued team lookups and nothing else", async () => {
      renderPage("?clear=lane");
      const line = await statusText();
      expect(line).toBe("[testing-bsc-fake] Cleared: lane, 28 queued team lookups.");
      expect(DONE.test(line)).toBe(true);
      expect(FAILED.test(line)).toBe(false);
      expect(mocks.cancelLane).toHaveBeenCalledWith({});
      expect(mocks.clearFaults).not.toHaveBeenCalled();
      expect(mocks.clearGate).not.toHaveBeenCalled();
      expect(mocks.setFaults).not.toHaveBeenCalled();
    });

    it("a refused ?clear=lane stays on the page as a FAILED 'Error:' line", async () => {
      mocks.cancelLane = vi.fn(async () => {
        throw new Error("Not authenticated");
      });
      renderPage("?clear=lane");
      const line = await statusText();
      expect(line).toBe("[testing-bsc-fake] Error: Not authenticated");
      expect(FAILED.test(line)).toBe(true);
      expect(DONE.test(line)).toBe(false);
    });
  });

  describe("?poll=1 (NEO-555) runs the caller's BSC sales poll now", () => {
    // The helper's DONE pattern (playwright/support/bscFake.ts) learns "Polled"
    // with the spec work that drives this hop; until then the line is pinned here.
    it("polls the bsc platform and says what it read", async () => {
      renderPage("?poll=1");
      const el = await screen.findByText(/^\[testing-bsc-fake\] Polled/);
      expect(el.textContent).toBe("[testing-bsc-fake] Polled: 2 orders read, 1 stored, 3 lines applied.");
      expect(mocks.pollNow).toHaveBeenCalledWith({ platform: "bsc" });
      expect(mocks.setFaults).not.toHaveBeenCalled();
      expect(mocks.addOrder).not.toHaveBeenCalled();
    });

    it.each(["", "0", "true"])("?poll=%j is refused and polls nothing", async (value) => {
      renderPage(`?poll=${value}`);
      const line = await statusText();
      expect(line).toBe("[testing-bsc-fake] Give exactly ?poll=1.");
      expect(FAILED.test(line)).toBe(true);
      noAction();
    });

    it("a poll that fails stays on the page as a FAILED 'Error:' line", async () => {
      mocks.pollNow = vi.fn(async () => {
        throw new Error("The sales check failed: BSC did not answer");
      });
      renderPage("?poll=1");
      const line = await statusText();
      expect(line).toBe("[testing-bsc-fake] Error: The sales check failed: BSC did not answer");
      expect(FAILED.test(line)).toBe(true);
    });
  });

  describe("a malformed ask prints a FAILED line and calls nothing", () => {
    it.each([
      ["no parameter", ""],
      ["rules and order together", `?rules=${enc([])}&order=${enc({})}`],
      ["rules and clear together", `?rules=${enc([])}&clear=all`],
      ["order and clear together", `?order=${enc({})}&clear=gate`],
      ["poll and clear together", "?poll=1&clear=all"],
    ])("%s: exactly one of rules, order or clear", async (_name, query) => {
      renderPage(query);
      const line = await statusText();
      expect(line).toBe("[testing-bsc-fake] Give exactly one of ?rules=, ?order=, ?clear= or ?poll=1.");
      expect(FAILED.test(line)).toBe(true);
      expect(DONE.test(line)).toBe(false);
      noAction();
    });

    it.each([
      ["rules", "?rules=%5Bnot-json"],
      ["order", "?order=%7Bnope"],
      ["rules", "?rules="],
    ])("?%s= with bad JSON (%s)", async (which, query) => {
      renderPage(query);
      const line = await statusText();
      expect(line).toBe(`[testing-bsc-fake] ?${which}= is not valid JSON.`);
      expect(FAILED.test(line)).toBe(true);
      expect(DONE.test(line)).toBe(false);
      noAction();
    });

    it.each(["", "everything", "ALL", "faults,gate", "LANE", "lane,all"])("?clear=%j is refused", async (value) => {
      renderPage(`?clear=${value}`);
      const line = await statusText();
      expect(line).toBe("[testing-bsc-fake] ?clear= wants faults, gate, all or lane.");
      expect(FAILED.test(line)).toBe(true);
      expect(DONE.test(line)).toBe(false);
      noAction();
    });
  });

  it("outside testing mode, prints the FAILED 'Testing mode' line and calls nothing", async () => {
    vi.stubEnv("VITE_CLERK_TESTING_ENABLED", "false");
    renderPage("?clear=all");
    const line = await statusText();
    expect(line).toBe("[testing-bsc-fake] Testing mode is not enabled in this environment.");
    expect(FAILED.test(line)).toBe(true);
    noAction();
  });

  it("an action's refusal stays on the page as a FAILED 'Error:' line", async () => {
    mocks.setFaults = vi.fn(async () => {
      throw new Error("This deployment talks to the real BuySportsCards");
    });
    renderPage(`?rules=${enc([])}`);
    const line = await statusText();
    expect(line).toBe("[testing-bsc-fake] Error: This deployment talks to the real BuySportsCards");
    expect(FAILED.test(line)).toBe(true);
    expect(DONE.test(line)).toBe(false);
  });

  it("the status line is the page's one live region, inside <main>, and its text is unchanged", async () => {
    renderPage("?clear=all");
    const line = await statusText();
    const region = screen.getByRole("status");
    expect(region.textContent).toBe(line);
    expect(region.closest("main")).not.toBeNull();
    expect(screen.getAllByRole("main")).toHaveLength(1);
  });

  it("signed out, waits for authentication and calls nothing", async () => {
    mocks.authed = false;
    renderPage("?clear=all");
    await waitFor(() => expect(screen.getByText(/Waiting for authentication/)).not.toBeNull());
    noAction();
  });

  it("while the Convex client is still loading, calls nothing yet", async () => {
    mocks.loading = true;
    renderPage("?clear=all");
    await waitFor(() => expect(screen.getByText(/Initializing/)).not.toBeNull());
    noAction();
  });
});
