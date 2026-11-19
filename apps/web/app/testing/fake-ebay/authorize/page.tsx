import { useAction, useConvexAuth } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { api } from "@/convex/_generated/api";
import NeonButton from "@/components/modules/NeonButton";
import { useDocumentTitle } from "@/src/hooks/useDocumentTitle";

// The fake eBay's consent screen (NEO-555). On a deployment wired to the
// stand-in eBay, Connect sends the collector to
//   /testing/fake-ebay/authorize?client_id=…&redirect_uri=…&response_type=code&scope=…&state=<nonce>
// instead of eBay's. This page is what eBay's page is there: three answers.
//   Agree                           mint a code for the main fake seller
//   Agree as another eBay account   mint a code for the second fake seller (an account switch)
//   Decline                         send the collector home with eBay's "no"
// and each REPLACES this entry with /profile/ebay, carrying `code` and `state`
// (or `error=access_denied` and `state`) exactly as eBay's return does, so
// Back never lands on a consent screen whose code is spent.
//
// Testing only: the route is reachable on any build, but it does nothing
// unless VITE_CLERK_TESTING_ENABLED=true, and the action that mints the code
// fails closed off a testing deployment and off the fake eBay. It is not a
// product screen; `state` is passed back untouched, and NeonBinder's own
// connect check is what accepts or refuses it.

const WORKING = "Signing in to the stand-in eBay…";
const FAILED = "Couldn't sign in to the stand-in eBay. Give it another try.";
const SIGNED_OUT = "You're signed out of NeonBinder. Sign in, then press Connect again.";
const NO_STATE = "This sign-in link has no state, so there is nothing to send back. Press Connect from Credentials again.";
const NOT_ENABLED = "Testing mode is not enabled in this environment.";

type Answer = "agree" | "alt" | "decline";

export default function FakeEbayAuthorizePage() {
  useDocumentTitle("Stand-in eBay sign-in");
  const { isAuthenticated, isLoading } = useConvexAuth();
  const mintConsent = useAction(api.testing.fakeEbayConsent);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const state = searchParams.get("state");
  const enabled = import.meta.env.VITE_CLERK_TESTING_ENABLED === "true";
  const [busy, setBusy] = useState<Answer | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const agreeRef = useRef<HTMLButtonElement>(null);
  const live = enabled && state !== null && state !== "";
  const canAgree = live && isAuthenticated && busy === null;

  // Keyboard-first: Agree is the default answer, so it holds focus once it can act.
  useEffect(() => {
    if (canAgree) agreeRef.current?.focus({ preventScroll: true });
  }, [canAgree]);

  const goHome = (params: Record<string, string>) => {
    navigate({ pathname: "/profile/ebay", search: `?${new URLSearchParams(params).toString()}` }, { replace: true });
  };

  const answer = async (which: Answer) => {
    if (!live || busy !== null) return;
    setFailure(null);
    if (which === "decline") {
      goHome({ error: "access_denied", state });
      return;
    }
    setBusy(which);
    try {
      const { code } = await mintConsent(which === "alt" ? { seller: "alt" } : {});
      goHome({ code, state });
    } catch {
      setBusy(null);
      setFailure(FAILED);
    }
  };

  const note = !enabled ? NOT_ENABLED : !live ? NO_STATE : isLoading ? null : !isAuthenticated ? SIGNED_OUT : null;

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface px-4 py-8">
      <section aria-labelledby="fake-ebay-heading" className="flex w-full max-w-sm flex-col gap-5">
        <div className="flex flex-col gap-2">
          <h1 id="fake-ebay-heading" className="text-xl font-semibold text-ink">
            Stand-in eBay sign-in
          </h1>
          <p className="text-sm text-ink-3">NeonBinder is asking to connect an eBay account. This is the test stand-in, so nothing here is real.</p>
        </div>

        {live && (
          <div className="flex flex-col gap-3">
            <NeonButton
              ref={agreeRef}
              type="button"
              variant="primary"
              disabled={!canAgree}
              onClick={() => void answer("agree")}
              className="max-sm:min-h-11"
            >
              Agree
            </NeonButton>
            <NeonButton
              type="button"
              variant="secondary"
              disabled={!canAgree}
              onClick={() => void answer("alt")}
              className="max-sm:min-h-11"
            >
              Agree as another eBay account
            </NeonButton>
            <NeonButton
              type="button"
              variant="negative"
              outline
              disabled={busy !== null}
              onClick={() => void answer("decline")}
              className="max-sm:min-h-11"
            >
              Decline
            </NeonButton>
          </div>
        )}

        {/* Always mounted, so what fills it is announced. */}
        <p role="status" className="min-h-5 text-sm text-ink-3">
          {busy !== null ? WORKING : note}
        </p>
        <p role="alert" className="min-h-5 text-sm text-neon-pink-text">
          {failure}
        </p>
      </section>
    </main>
  );
}
