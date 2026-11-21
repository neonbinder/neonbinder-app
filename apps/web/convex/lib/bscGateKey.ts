/**
 * NEO-628 (NEO-629) — the key of a BSC call gate: the RATE-LIMIT DOMAIN a call
 * lands in, not "the user" as such. Runtime-free and env-free, so the default
 * runtime, the Node runtime and tests all derive it the same way.
 *
 *  - Against real BuySportsCards the key is always `"deployment"`: its 429s
 *    come from BSC's load balancer on a public, token-less endpoint, so the
 *    limit is by egress IP, and every user on a deployment shares one.
 *  - Against the fake BSC the key is `ns:<namespace>`, one per fake namespace
 *    (one per test user). A fault injected into a namespace lives only there,
 *    so only that key may trip.
 *
 * ONE value feeds both the gate and the `x-nb-fake-ns` header sent to the
 * fake (`bscCallDomainFor` in `bscCallGate.ts`): a site that keyed the gate on
 * one namespace and sent another would bring cross-shard refusals back.
 */

/** The one key of the real BSC (and of any fake call with no namespace of its own). */
import { resolveBscTarget } from "./bscHttp";

export const BSC_GATE_DEPLOYMENT_KEY = "deployment";

/** A fake namespace as the fake reads it: the same shape as `FAKE_NS_VALUE`. */
const NAMESPACE_SHAPE = /^[a-z0-9][a-z0-9-]{0,99}$/;

/** A stored gate key: `"deployment"`, or `ns:` and a namespace (never a prefix). */
// Ends in an alphanumeric character: a trailing hyphen is a deployment PREFIX,
// which `bscGateKey` never mints as a key (it is the deployment's).
const GATE_KEY_SHAPE = /^ns:[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/;

export type BscGateKeyKind = "deployment" | "ns";

/** True for a key this module could have produced. */
export function isBscGateKey(key: string): boolean {
  return key === BSC_GATE_DEPLOYMENT_KEY || GATE_KEY_SHAPE.test(key);
}

/** Which kind of domain a (valid) key names; for logs, which never carry the namespace. */
export function bscGateKeyKind(key: string): BscGateKeyKind {
  return key === BSC_GATE_DEPLOYMENT_KEY ? "deployment" : "ns";
}

/**
 * The gate key for a call.
 *
 * `"deployment"` in real mode (and misconfigured, which sends nothing), when
 * there is no namespace, for a deployment PREFIX (ends in `-`: a call with no
 * user of its own on the fake), and for a namespace the fake would not read.
 * Otherwise `ns:<namespace>`.
 */
export function bscGateKey(input: {
  mode: "real" | "fake" | "misconfigured";
  fakeNs?: string | undefined;
}): string {
  if (input.mode !== "fake") return BSC_GATE_DEPLOYMENT_KEY;
  const ns = input.fakeNs;
  if (ns === undefined || ns.length === 0 || ns.endsWith("-") || !NAMESPACE_SHAPE.test(ns)) {
    return BSC_GATE_DEPLOYMENT_KEY;
  }
  return `ns:${ns}`;
}

/**
 * The operator to record on a background-lane item (NEO-628 N2): the Clerk
 * subject on the fake, where the lane asks in that user's namespace and key;
 * `undefined` on real BSC (one gate, the subject would sit in scheduled args
 * and the pool's completion context for nothing). Every server site that mints
 * a `queuedBy` goes through this, and `enqueueBscTeamChecks` applies it again
 * as the sink, so a caller that forgets still stores nothing.
 */
export function queuedByForLane(userId: string | undefined): string | undefined {
  return resolveBscTarget(process.env).mode === "fake" ? userId : undefined;
}

/** `queuedByForLane` as a spreadable field: `{ queuedBy }` on the fake, `{}` otherwise. */
export function queuedByField(userId: string | undefined): { queuedBy?: string } {
  const queuedBy = queuedByForLane(userId);
  return queuedBy === undefined ? {} : { queuedBy };
}
