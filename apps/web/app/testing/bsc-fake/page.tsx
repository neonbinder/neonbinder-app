import { useAction, useConvexAuth } from "convex/react";
import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { api } from "@/convex/_generated/api";

// Test-only hop (NEO-552). An E2E spec visits
//   /testing/bsc-fake?rules=<url-encoded JSON array of fault rules>   set the caller's fake BSC faults
//   /testing/bsc-fake?order=<url-encoded JSON order>                  add one order to the caller's fake seller history
//   /testing/bsc-fake?clear=faults|gate|all                           drop the faults and/or the deployment's BSC call gate
// This page waits for the Convex client to pick up the Clerk session, calls
// the matching auth-scoped testing action (the caller's own fake BuySportsCards
// account only), prints the outcome and STAYS: the spec reads the status line,
// then goes on. Exactly one parameter per visit.
//
// It exists because a spec has no other way to reach a Convex action, and the
// fake's faults (a 429, a hang, a delay, a 503) are how the suite makes
// BuySportsCards misbehave now that no spec talks to the real one.
//
// Only functional when VITE_CLERK_TESTING_ENABLED=true; every action also
// fails closed on production Convex (no TESTING_RESET_SECRET there) and on a
// deployment that talks to the real BuySportsCards.

type Op =
  | { kind: "rules"; rules: unknown }
  | { kind: "order"; order: unknown }
  | { kind: "clear"; what: "faults" | "gate" | "all" };

/** The one operation the URL asks for, or the reason it is malformed. */
function readOp(params: URLSearchParams): Op | string {
  const asked = (["rules", "order", "clear"] as const).filter((k) => params.has(k));
  if (asked.length !== 1) return "Give exactly one of ?rules=, ?order= or ?clear=.";
  const [which] = asked;
  if (which === "clear") {
    const what = params.get("clear");
    return what === "faults" || what === "gate" || what === "all" ? { kind: "clear", what } : "?clear= wants faults, gate or all.";
  }
  try {
    const parsed: unknown = JSON.parse(params.get(which) ?? "");
    return which === "rules" ? { kind: "rules", rules: parsed } : { kind: "order", order: parsed };
  } catch {
    return `?${which}= is not valid JSON.`;
  }
}

function TestingBscFakeContent() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const setFaults = useAction(api.testing.setMyBscFaults);
  const addOrder = useAction(api.testing.addMyBscOrder);
  const clearFaults = useAction(api.testing.clearMyBscFaults);
  const clearGate = useAction(api.testing.clearBscCallGate);
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
        if (op.kind === "rules") {
          setStatus("Setting fault rules...");
          const done = await setFaults({ rules: op.rules as Parameters<typeof setFaults>[0]["rules"] });
          setStatus(`Fault rules set: ${done.rules}.`);
        } else if (op.kind === "order") {
          setStatus("Adding the order...");
          const done = await addOrder({ order: op.order as Parameters<typeof addOrder>[0]["order"] });
          setStatus(`Order added: ${done.items} items.`);
        } else {
          setStatus("Clearing...");
          if (op.what === "faults" || op.what === "all") await clearFaults({});
          if (op.what === "gate" || op.what === "all") await clearGate({});
          setStatus(`Cleared: ${op.what}.`);
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : JSON.stringify(e);
        setStatus(`Error: ${msg}`);
      }
    })();
  }, [isAuthenticated, isLoading, query, setFaults, addOrder, clearFaults, clearGate]);

  return (
    <div className="flex items-center justify-center min-h-screen bg-surface">
      <p className="text-ink-3 font-mono text-sm">
        [testing-bsc-fake] {status}
      </p>
    </div>
  );
}

export default function TestingBscFakePage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-screen bg-surface">
          <p className="text-ink-3 font-mono text-sm">[testing-bsc-fake] Loading…</p>
        </div>
      }
    >
      <TestingBscFakeContent />
    </Suspense>
  );
}
