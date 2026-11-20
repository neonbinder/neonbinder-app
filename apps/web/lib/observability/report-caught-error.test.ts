import { convexToJson } from "convex/values";
import { beforeEach, describe, expect, test, vi } from "vitest";

const captureException = vi.hoisted(() => vi.fn());
vi.mock("@sentry/react", () => ({ captureException }));

import { reportCaughtError } from "./report-caught-error";

const CTX = { feature: "variant-form", step: "reconcile-save" };

/** The text the Convex browser client throws for a server-side failure (createHybridErrorStacktrace). */
const REAL_SERVER_MESSAGE =
  "[CONVEX M(setReconciliation:storeReconciledOptions)] [Request ID: 1a2b3c4d5e6f7a8b] Server Error\n  Called by client";

function sent(): { error: Error; options: Record<string, any> } {
  expect(captureException).toHaveBeenCalledTimes(1);
  const [error, options] = captureException.mock.calls[0];
  return { error, options };
}

beforeEach(() => {
  captureException.mockReset();
});

describe("reportCaughtError", () => {
  test("a server error keeps only its name, function path and request id", () => {
    const error = new Error(
      `${REAL_SERVER_MESSAGE.replace("Server Error", "Server Error Uncaught Error: fetch https://bsc.example/api?token=SECRET failed")}`,
    );
    reportCaughtError(error, CTX);

    const { error: out, options } = sent();
    expect(out.message).toBe("Error from setReconciliation:storeReconciledOptions");
    expect(out.message).not.toContain("SECRET");
    expect(options.tags).toMatchObject({
      feature: "variant-form",
      step: "reconcile-save",
      origin: "server",
      request_id: "1a2b3c4d5e6f7a8b",
    });
  });

  test("the real Convex client message for a server error is recognised as server-origin", () => {
    reportCaughtError(new Error(REAL_SERVER_MESSAGE), CTX);
    const { options } = sent();
    expect(options.tags.origin).toBe("server");
    expect(options.tags.request_id).toBe("1a2b3c4d5e6f7a8b");
  });

  test("a [CONVEX M(fn)] message with no request id is still server-origin and sends none of its text", () => {
    const error = new Error(
      "[CONVEX M(setReconciliation:storeReconciledOptions)] Uncaught Error: fetch https://bsc.example/api?token=SECRET failed with body {\"cardholder\":\"BODYFRAGMENT\"}\n  Called by client",
    );
    reportCaughtError(error, CTX);

    const { error: out, options } = sent();
    expect(options.tags.origin).toBe("server");
    expect(options.tags).not.toHaveProperty("request_id");
    expect(options.fingerprint).toEqual(["variant-form", "reconcile-save", "server", "Error"]);
    expect(out.message).toBe("Error from setReconciliation:storeReconciledOptions");
    const everything = JSON.stringify([out.message, out.stack ?? "", options]);
    expect(everything).not.toContain("bsc.example");
    expect(everything).not.toContain("SECRET");
    expect(everything).not.toContain("BODYFRAGMENT");
  });

  test("a ConvexError with data but no recognisable prefix is server-origin and its message is not sent", () => {
    const error = Object.assign(new Error("odd text https://bsc.example/x?token=SECRET"), {
      name: "ConvexError",
      data: { code: "NOT_ADMIN" },
    });
    reportCaughtError(error, CTX);
    const { error: out, options } = sent();
    expect(options.tags.origin).toBe("server");
    expect(options.tags.error_code).toBe("NOT_ADMIN");
    expect(out.message).toBe("ConvexError");
  });

  test("a ConvexError's structured code is tagged and its data is not sent", () => {
    const error = Object.assign(new Error(REAL_SERVER_MESSAGE), {
      name: "ConvexError",
      data: { code: "NOT_ADMIN", detail: "secret detail" },
    });
    reportCaughtError(error, CTX);
    const { error: out, options } = sent();
    expect(options.tags.error_code).toBe("NOT_ADMIN");
    expect(JSON.stringify([out.message, options])).not.toContain("secret detail");
    expect(out.name).toBe("ConvexError");
  });

  test("a client-origin message is URL-scrubbed", () => {
    reportCaughtError(new Error("bad arg at /profile/ebay?code=SECRETCODE&state=abc"), CTX);
    const { error, options } = sent();
    expect(options.tags.origin).toBe("client");
    expect(error.message).not.toContain("SECRETCODE");
    expect(error.message).toContain("bad arg");
  });

  test("a client-origin message is capped at 300 characters", () => {
    reportCaughtError(new Error("x".repeat(1000)), CTX);
    expect(sent().error.message).toHaveLength(300);
  });

  test("a value-conversion error never sends the call's args (undefined arg)", () => {
    // An undefined inside an array is the shape convexToJson rejects (object fields are skipped).
    const args = { name: "ARGVALUE-name", nested: { token: "ARGVALUE-token", list: ["ARGVALUE-item", undefined] } };
    let thrown: unknown;
    try {
      convexToJson(args as never);
    } catch (e) {
      thrown = e;
    }
    // The real Convex error does quote the args; this is what the helper must cut.
    expect((thrown as Error).message).toContain("ARGVALUE-token");

    reportCaughtError(thrown, CTX);
    const { error, options } = sent();
    expect(options.tags.origin).toBe("client");
    expect(error.message).toBe("undefined is not a valid Convex value");
    expect(JSON.stringify([error.message, error.stack ?? "", options])).not.toContain("ARGVALUE");
  });

  test("an unsupported-type conversion error never sends the offending value or the args", () => {
    const offenders = [new Map([["k", "ARGVALUE-map"]]), new Set(["ARGVALUE-set"]), new (class Thing { v = "ARGVALUE-class"; })()];
    for (const bad of offenders) {
      captureException.mockReset();
      let thrown: unknown;
      try {
        convexToJson({ keep: "ARGVALUE-keep", bad } as never);
      } catch (e) {
        thrown = e;
      }
      expect((thrown as Error).message).toContain("ARGVALUE");
      reportCaughtError(thrown, CTX);
      const { error, options } = sent();
      expect(error.message).toMatch(/^\w+ is not a supported Convex type$/);
      expect(JSON.stringify([error.message, error.stack ?? "", options])).not.toContain("ARGVALUE");
    }
  });

  test("the message is also cut at 'in original object' when it comes first", () => {
    reportCaughtError(new Error('bad shape in original object {"secret":"ARGVALUE"} (present at path .a)'), CTX);
    expect(sent().error.message).toBe("bad shape");
  });

  test("the fingerprint is feature, step, origin and name, never the message", () => {
    reportCaughtError(new TypeError("whatever 123"), CTX);
    expect(sent().options.fingerprint).toEqual(["variant-form", "reconcile-save", "client", "TypeError"]);
  });

  test("a thrown string is reported as client-origin text and a non-object has no name leak", () => {
    reportCaughtError("plain string failure", CTX);
    const { error } = sent();
    expect(error.message).toBe("plain string failure");
    expect(error.name).toBe("NonError");
  });

  test("an empty client message falls back to the error name", () => {
    reportCaughtError(new Error(""), CTX);
    expect(sent().error.message).toBe("Error");
  });

  test("never throws when the SDK throws", () => {
    captureException.mockImplementation(() => {
      throw new Error("sdk down");
    });
    expect(() => reportCaughtError(new Error("x"), CTX)).not.toThrow();
  });
});
