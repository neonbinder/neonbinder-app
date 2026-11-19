/**
 * NEO-555 — the fake eBay's consent screen. Three answers, each of which
 * REPLACES this entry with /profile/ebay carrying what eBay's own return
 * carries (`code` + `state`, or `error=access_denied` + `state`); Back never
 * lands here again. Testing only; the page is inert without the testing flag.
 */

import { useEffect } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router";
import { Theme } from "@radix-ui/themes";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { expectAccessibleInBothModes } from "@/lib/testing/axe";

const mocks = vi.hoisted(() => ({ authed: true, loading: false, mint: vi.fn() }));

vi.mock("@/convex/_generated/api", () => ({ api: { testing: { fakeEbayConsent: "testing:fakeEbayConsent" } } }));
vi.mock("convex/react", () => ({
  useConvexAuth: () => ({ isAuthenticated: mocks.authed, isLoading: mocks.loading }),
  useAction: () => mocks.mint,
}));

import FakeEbayAuthorizePage from "./page";

const AUTHORIZE = "/testing/fake-ebay/authorize";
const STATE = "n0nce.b64origin";
const CONSENT = `${AUTHORIZE}?client_id=x&redirect_uri=y&response_type=code&scope=s&state=${STATE}`;

let here = "";
let history: (() => void) | null = null;
function Where() {
  const loc = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    here = `${loc.pathname}${loc.search}`;
    history = () => navigate(-1);
  }, [loc, navigate]);
  return null;
}

function renderAt(entry: string) {
  return render(
    <Theme>
      <MemoryRouter initialEntries={["/profile/credentials?platform=ebay", entry]} initialIndex={1}>
        <Where />
        <Routes>
          <Route path={AUTHORIZE} element={<FakeEbayAuthorizePage />} />
          <Route path="*" element={<p>elsewhere</p>} />
        </Routes>
      </MemoryRouter>
    </Theme>,
  );
}

const button = (name: string) => screen.getByRole("button", { name });

describe("FakeEbayAuthorizePage", () => {
  beforeEach(() => {
    mocks.authed = true;
    mocks.loading = false;
    mocks.mint = vi.fn(async () => ({ code: "fake-code-1" }));
    vi.stubEnv("VITE_CLERK_TESTING_ENABLED", "true");
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
  });

  it("offers the three answers, each its own named button, and puts keyboard focus on Agree", async () => {
    renderAt(CONSENT);
    expect(screen.getByRole("heading", { level: 1, name: "Stand-in eBay sign-in" })).toBeTruthy();
    const names = screen.getAllByRole("button").map((b) => b.textContent);
    expect(names).toEqual(["Agree", "Agree as another eBay account", "Decline"]);
    await waitFor(() => expect(document.activeElement).toBe(button("Agree")));
  });

  it("Agree mints a code for the main seller and replaces this entry with the return", async () => {
    renderAt(CONSENT);
    fireEvent.click(button("Agree"));
    await waitFor(() => expect(here).toBe(`/profile/ebay?code=fake-code-1&state=${encodeURIComponent(STATE)}`));
    expect(mocks.mint).toHaveBeenCalledWith({});
    // Replaced, not pushed: Back leaves for the page before the consent screen.
    act(() => history?.());
    await waitFor(() => expect(here).toBe("/profile/credentials?platform=ebay"));
  });

  it("Agree as another eBay account asks for the second seller", async () => {
    renderAt(CONSENT);
    fireEvent.click(button("Agree as another eBay account"));
    await waitFor(() => expect(here).toContain("/profile/ebay?code="));
    expect(mocks.mint).toHaveBeenCalledWith({ seller: "alt" });
  });

  it("Decline sends eBay's no with the state, mints nothing, and replaces this entry", async () => {
    renderAt(CONSENT);
    fireEvent.click(button("Decline"));
    await waitFor(() => expect(here).toBe(`/profile/ebay?error=access_denied&state=${encodeURIComponent(STATE)}`));
    expect(mocks.mint).not.toHaveBeenCalled();
    act(() => history?.());
    await waitFor(() => expect(here).toBe("/profile/credentials?platform=ebay"));
  });

  it("passes a state it doesn't recognise back untouched; NeonBinder's own check refuses it", async () => {
    renderAt(`${AUTHORIZE}?state=bogus`);
    fireEvent.click(button("Agree"));
    await waitFor(() => expect(here).toBe("/profile/ebay?code=fake-code-1&state=bogus"));
  });

  it("a refused mint stays on the page, says so in an alert, and lets the collector answer again", async () => {
    mocks.mint = vi.fn(async () => {
      throw new Error("This deployment does not talk to the fake eBay");
    });
    renderAt(CONSENT);
    fireEvent.click(button("Agree"));
    const alert = await screen.findByText("Couldn't sign in to the stand-in eBay. Give it another try.");
    expect(alert.getAttribute("role")).toBe("alert");
    expect(here).toBe(CONSENT);
    expect((button("Agree") as HTMLButtonElement).disabled).toBe(false);
    // The server's sentence is never put on screen.
    expect(screen.queryByText(/does not talk to the fake/)).toBeNull();
  });

  it("while signing in, both Agree answers are held and the status says so", async () => {
    let finish: (v: { code: string }) => void = () => {};
    mocks.mint = vi.fn(() => new Promise<{ code: string }>((resolve) => (finish = resolve)));
    renderAt(CONSENT);
    fireEvent.click(button("Agree"));
    expect(await screen.findByText("Signing in to the stand-in eBay…")).toBeTruthy();
    expect((button("Agree") as HTMLButtonElement).disabled).toBe(true);
    expect((button("Agree as another eBay account") as HTMLButtonElement).disabled).toBe(true);
    await act(async () => finish({ code: "late" }));
    await waitFor(() => expect(here).toContain("code=late"));
    expect(mocks.mint).toHaveBeenCalledTimes(1);
  });

  it("holds the Agree answers until the Convex client has the session, and says so when signed out", () => {
    mocks.loading = true;
    mocks.authed = false; // Convex answers unauthenticated while it is still loading
    renderAt(CONSENT);
    expect((button("Agree") as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    mocks.loading = false;
    mocks.authed = false;
    renderAt(CONSENT);
    expect((button("Agree") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("You're signed out of NeonBinder. Sign in, then press Connect again.")).toBeTruthy();
    expect(mocks.mint).not.toHaveBeenCalled();
  });

  it("with no state there is nothing to answer: no buttons, and it says why", () => {
    renderAt(`${AUTHORIZE}?client_id=x`);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByText(/has no state/)).toBeTruthy();
  });

  it("outside testing mode it is inert", () => {
    vi.stubEnv("VITE_CLERK_TESTING_ENABLED", "false");
    renderAt(CONSENT);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByText("Testing mode is not enabled in this environment.")).toBeTruthy();
    expect(mocks.mint).not.toHaveBeenCalled();
  });

  it("has no accessibility violations in light or dark", async () => {
    const { container } = renderAt(CONSENT);
    await expectAccessibleInBothModes(container, { label: "the stand-in eBay consent screen" });
  });
});
