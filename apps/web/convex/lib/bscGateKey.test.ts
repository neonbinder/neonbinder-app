/**
 * NEO-628 — the BSC call gate's key (`lib/bscGateKey.ts`): the rate-limit
 * domain a call lands in. Pure; no env.
 */
import { describe, expect, test } from "vitest";
import { BSC_GATE_DEPLOYMENT_KEY, bscGateKey, bscGateKeyKind, isBscGateKey } from "./bscGateKey";

const NS = "happy-otter-123-aaaabbbbcccc";

describe("bscGateKey", () => {
  test("real BSC is one key whatever the namespace", () => {
    expect(bscGateKey({ mode: "real" })).toBe("deployment");
    expect(bscGateKey({ mode: "real", fakeNs: NS })).toBe("deployment");
    expect(bscGateKey({ mode: "real", fakeNs: undefined })).toBe("deployment");
  });

  test("a misconfigured deployment sends nothing and keys on the deployment", () => {
    expect(bscGateKey({ mode: "misconfigured", fakeNs: NS })).toBe("deployment");
  });

  test("the fake keys on the namespace", () => {
    expect(bscGateKey({ mode: "fake", fakeNs: NS })).toBe(`ns:${NS}`);
    expect(bscGateKey({ mode: "fake", fakeNs: "a" })).toBe("ns:a");
    expect(bscGateKey({ mode: "fake", fakeNs: "a".repeat(100) })).toBe(`ns:${"a".repeat(100)}`);
  });

  test("the fake with no namespace, or only a deployment prefix, is the deployment's key", () => {
    expect(bscGateKey({ mode: "fake" })).toBe("deployment");
    expect(bscGateKey({ mode: "fake", fakeNs: undefined })).toBe("deployment");
    expect(bscGateKey({ mode: "fake", fakeNs: "" })).toBe("deployment");
    expect(bscGateKey({ mode: "fake", fakeNs: "happy-otter-123-" })).toBe("deployment");
  });

  test("a namespace the fake would not read is the deployment's key, never a malformed ns: key", () => {
    for (const bad of ["Upper", "-lead", "has space", "a/b", "a:b", "a".repeat(101), "ns:x", "é"]) {
      expect(bscGateKey({ mode: "fake", fakeNs: bad })).toBe("deployment");
    }
  });

  test("every key it returns is a valid gate key", () => {
    for (const fakeNs of [undefined, "", NS, "happy-", "x", "Bad Ns"]) {
      for (const mode of ["real", "fake", "misconfigured"] as const) {
        expect(isBscGateKey(bscGateKey({ mode, fakeNs }))).toBe(true);
      }
    }
  });
});

describe("isBscGateKey / bscGateKeyKind", () => {
  test("accepts exactly 'deployment' and ns:<namespace>", () => {
    expect(isBscGateKey(BSC_GATE_DEPLOYMENT_KEY)).toBe(true);
    expect(isBscGateKey(`ns:${NS}`)).toBe(true);
    for (const bad of ["", "Deployment", "deployment ", "ns:", "ns:-a", "ns:A", "ns:a b", "ns:a:b", `ns:${"a".repeat(101)}`, "scope", " ns:a"]) {
      expect(isBscGateKey(bad)).toBe(false);
    }
  });

  test("the kind never carries the namespace", () => {
    expect(bscGateKeyKind("deployment")).toBe("deployment");
    expect(bscGateKeyKind(`ns:${NS}`)).toBe("ns");
  });
});
