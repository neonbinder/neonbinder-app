import { useAction, useConvexAuth } from "convex/react";
import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { api } from "@/convex/_generated/api";

// Test-only hop (NEO-555). An E2E spec visits
//   /testing/ebay-fake?seller=<url-encoded JSON>   set up the caller's fake eBay seller:
//                                                  {optedIn?, fulfillmentPolicies?, seller?: "alt"}
//   /testing/ebay-fake?order=<url-encoded JSON>    add one order to the caller's fake seller history:
//                                                  the order, plus an optional top-level seller: "alt"
//   /testing/ebay-fake?poll=1                      run the caller's eBay sales poll now and wait for it
// This page waits for the Convex client to pick up the Clerk session, calls
// the matching auth-scoped testing action (the caller's own fake eBay seller
// only), prints the outcome and STAYS: the spec reads the status line, then
// goes on. Exactly one parameter per visit. It mirrors /testing/bsc-fake.
//
// It exists because a spec has no other way to reach a Convex action, and the
// fake seller's policies and orders are how the suite sets up what a real eBay
// account would already have.
//
// Only functional when VITE_CLERK_TESTING_ENABLED=true; every action also
// fails closed on production Convex (no TESTING_RESET_SECRET there) and on a
// deployment whose eBay is not the fake.

type Op =
  | { kind: "seller"; seller: Record<string, unknown> }
  | { kind: "order"; order: Record<string, unknown> }
  | { kind: "poll" };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The one operation the URL asks for, or the reason it is malformed. */
function readOp(params: URLSearchParams): Op | string {
  const asked = (["seller", "order", "poll"] as const).filter((k) => params.has(k));
  if (asked.length !== 1) return "Give exactly one of ?seller=, ?order= or ?poll=1.";
  const [which] = asked;
  if (which === "poll") return params.get("poll") === "1" ? { kind: "poll" } : "Give exactly ?poll=1.";
  let parsed: unknown;
  try {
    parsed = JSON.parse(params.get(which) ?? "");
  } catch {
    return `?${which}= is not valid JSON.`;
  }
  if (!isObject(parsed)) return `?${which}= wants a JSON object.`;
  return which === "seller" ? { kind: "seller", seller: parsed } : { kind: "order", order: parsed };
}

function TestingEbayFakeContent() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const setSeller = useAction(api.testing.setMyEbaySeller);
  const addOrder = useAction(api.testing.addMyEbayOrder);
  const pollNow = useAction(api.testing.pollMySalesNow);
  const [searchParams] = useSearchParams();
  const query = searchParams.toString();
  const [status, setStatus] = useState("Initializing...");
  const ranRef = useRef(false);

  useEffect(() => {
    if (import.meta.env.VITE_CLERK_TESTING_ENABLED !== "true") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- status readout of an async driver effect; test-only page
      setStatus("Testing mode is not enabled in this environment.");
      return;
    }
    const op = readOp(new URLSearchParams(query));
    if (typeof op === "string") {
      setStatus(op);
      return;
    }
    if (isLoading) return;
    if (!isAuthenticated) {
      setStatus("Waiting for authentication...");
      return;
    }
    if (ranRef.current) return;
    ranRef.current = true;

    (async () => {
      try {
        if (op.kind === "seller") {
          setStatus("Setting the seller up...");
          const done = await setSeller(op.seller as Parameters<typeof setSeller>[0]);
          setStatus(`Seller set: ${done.policies} shipping policies.`);
        } else if (op.kind === "order") {
          setStatus("Adding the order...");
          // An optional top-level `seller` picks the account; the rest is the order.
          const { seller, ...order } = op.order;
          const done = await addOrder({
            order: order as Parameters<typeof addOrder>[0]["order"],
            ...(seller === "alt" ? { seller: "alt" as const } : {}),
          });
          setStatus(`Order added: ${done.lines} lines.`);
        } else {
          setStatus("Polling...");
          const done = await pollNow({ platform: "ebay" });
          setStatus(`Polled: ${done.ordersRead} orders read, ${done.ordersStored} stored, ${done.linesApplied} lines applied.`);
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : JSON.stringify(e);
        setStatus(`Error: ${msg}`);
      }
    })();
  }, [isAuthenticated, isLoading, query, setSeller, addOrder, pollNow]);

  return (
    <main className="flex items-center justify-center min-h-screen bg-surface">
      <p role="status" className="text-ink-3 font-mono text-sm">
        [testing-ebay-fake] {status}
      </p>
    </main>
  );
}

export default function TestingEbayFakePage() {
  return (
    <Suspense
      fallback={
        <main className="flex items-center justify-center min-h-screen bg-surface">
          <p role="status" className="text-ink-3 font-mono text-sm">[testing-ebay-fake] Loading…</p>
        </main>
      }
    >
      <TestingEbayFakeContent />
    </Suspense>
  );
}
