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
