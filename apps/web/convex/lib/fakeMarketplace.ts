/**
 * NEO-555 — what BuySportsCards and eBay share about reaching the standing
 * fake (`services/fake-bsc`, CONTRACT.md): the one pin on WHICH host may be
 * the fake, and how a request to it is signed. Pulled out of `lib/bscHttp.ts`
 * (NEO-552) so the BSC door (`bscFetch`) and the eBay seller client
 * (`adapters/ebaySeller.ts`) read one definition and cannot drift apart.
 *
 * Runtime-free and sends nothing: it builds headers and names a host. The
 * callers own `fetch` (`bscHttp.ts` for BSC, the eBay adapter for eBay).
 *
 * A request to the fake carries three things beside its own headers: the
 * caller secret (`x-nb-fake-bsc-key`), a Google ID token for the fake's origin
 * in `X-Serverless-Authorization` (Cloud Run IAM reads it there because the
 * marketplace's own `Authorization: Bearer` is already taken), and the same
 * token again, bare, in `x-nb-fake-id-token` (Cloud Run strips the signature
 * from the first, so the fake verifies this copy itself).
 */

/** The caller secret the fake checks on every request. */
export const FAKE_BSC_KEY_HEADER = "x-nb-fake-bsc-key";
export const FAKE_BSC_ID_TOKEN_HEADER = "X-Serverless-Authorization";
/**
 * The same signed ID token again, bare (no `Bearer`). Cloud Run strips the
 * signature from what it passes on in `X-Serverless-Authorization`, so the
 * fake verifies the signature of this copy itself.
 */
export const FAKE_BSC_SIGNED_ID_TOKEN_HEADER = "x-nb-fake-id-token";

/**
 * Fake mode only: the run a call with no marketplace token belongs to
 * (CONTRACT.md, "Module seams"). `card-listing` is public, so without it the
 * fake cannot tell one run's call from another's and a card-scoped fault hits
 * them all.
 */
export const FAKE_BSC_NS_HEADER = "x-nb-fake-ns";

/** A fake namespace (`<convexSlug>-<userTag>`) or a deployment prefix (`<convexSlug>-`). */
export const FAKE_NS_VALUE = /^[a-z0-9][a-z0-9-]{0,99}$/;

/**
 * The fake's own Cloud Run service host, and no other: the service name
 * `neonbinder-fake-bsc-` starts the first label (so a tagged revision
 * `pr-N---…` or any other service is refused), then DNS labels, then
 * `run.app`. The first label stays within 63 characters. The ONE pin: the
 * BSC target (`resolveBscTarget`) and therefore the eBay target both pass
 * through it.
 */
const FAKE_SERVICE_HOST =
  /^neonbinder-fake-bsc-(?:[a-z0-9-]{0,42}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.run\.app$/;

/** True when `hostname` is the fake's own service host. */
export function isFakeServiceHost(hostname: string): boolean {
  return FAKE_SERVICE_HOST.test(hostname);
}

/**
 * Mints a Google ID token whose audience is `audience` (the fake's origin).
 * Called only in fake mode; a real-mode call never reaches it.
 */
export type FakeIdTokenSource = (audience: string) => Promise<string>;

/** What a request to the fake needs to be signed: its origin and the caller secret. */
export interface FakeCallerTarget {
  origin: string;
  callerKey: string;
}

/**
 * `init` with the fake's caller headers and no redirect. `fakeNs` names the
 * run for a request that carries no marketplace token (BSC `card-listing`),
 * and only in a form the fake reads; a request that has an `authorization`
 * header is namespaced by its token, so the header is left off.
 *
 * The ID token and the caller secret go to the fake's origin and nowhere else:
 * a redirect is a failure, never followed.
 */
export async function signForFake(
  target: FakeCallerTarget,
  init: RequestInit,
  idToken: FakeIdTokenSource,
  fakeNs?: string,
): Promise<RequestInit> {
  const token = await idToken(target.origin);
  const headers = new Headers(init.headers);
  headers.set(FAKE_BSC_KEY_HEADER, target.callerKey);
  headers.set(FAKE_BSC_ID_TOKEN_HEADER, `Bearer ${token}`);
  headers.set(FAKE_BSC_SIGNED_ID_TOKEN_HEADER, token);
  if (fakeNs !== undefined && !headers.has("authorization") && FAKE_NS_VALUE.test(fakeNs)) {
    headers.set(FAKE_BSC_NS_HEADER, fakeNs);
  }
  return { ...init, headers, redirect: "error" };
}
