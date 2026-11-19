// NEO-398: client-wire.log (playwright/support/wire-log.ts) lands in PUBLIC blob
// reports. These pin that a Convex frame's line carries only its type, request id,
// function path, success flag and counts, never what the frame carried, and that
// every other line goes through the suite's one scrubber (redact.mjs) before the cut.
// The test sits here, where vitest collects .mjs (vitest.include.mjs).
import { describe, expect, it } from "vitest";
import { describeFrame, wireLine } from "../playwright/support/wire-log.ts";

// Values a frame may carry that must never reach a line.
const JWT = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyXzEyMyJ9.c2lnbmF0dXJlLXZhbHVl";
const SECRET = "card-title-Mantle-1952-SECRETVALUE";
const EMAIL = "worker@example.com";
const SENTINELS = [JWT, SECRET, EMAIL, "SECRETVALUE", "errorData", "logLine"];

const frames = {
  Connect: { type: "Connect", sessionId: SECRET, connectionCount: 2, lastCloseReason: SECRET, clientTs: 1 },
  AuthenticateUser: { type: "Authenticate", tokenType: "User", value: JWT, baseVersion: 0 },
  AuthenticateAdmin: { type: "Authenticate", tokenType: "Admin", value: SECRET, baseVersion: 0, impersonating: { email: EMAIL } },
  ModifyQuerySet: {
    type: "ModifyQuerySet",
    baseVersion: 3,
    newVersion: 4,
    modifications: [
      { type: "Add", queryId: 7, udfPath: "binders:list", args: [{ owner: EMAIL, token: JWT }] },
      { type: "Add", queryId: 8, udfPath: "collection/cards:byBinder", args: [SECRET] },
      { type: "Remove", queryId: 2 },
    ],
  },
  Mutation: { type: "Mutation", requestId: 12, udfPath: "binders:remove", args: [{ name: SECRET, email: EMAIL }] },
  Action: { type: "Action", requestId: 13, udfPath: "bsc:fetchSets", args: [{ password: SECRET, jwt: JWT }] },
  Event: { type: "Event", eventType: SECRET, event: { email: EMAIL } },
  MutationResponseOk: { type: "MutationResponse", requestId: 12, success: true, result: { name: SECRET }, ts: "AAA", logLines: [`logLine ${EMAIL}`] },
  MutationResponseFailed: { type: "MutationResponse", requestId: 12, success: false, result: `Uncaught ${SECRET}`, logLines: [], errorData: { email: EMAIL } },
  ActionResponseOk: { type: "ActionResponse", requestId: 13, success: true, result: [SECRET], logLines: [JWT] },
  ActionResponseFailed: { type: "ActionResponse", requestId: 13, success: false, result: SECRET, logLines: [], errorData: SECRET },
  Transition: {
    type: "Transition",
    startVersion: { querySet: 3, ts: "AAA", identity: 0 },
    endVersion: { querySet: 4, ts: "BBB", identity: 1 },
    modifications: [
      { type: "QueryUpdated", queryId: 7, value: [{ title: SECRET, owner: EMAIL }], logLines: [`logLine ${JWT}`], journal: null },
      { type: "QueryFailed", queryId: 8, errorMessage: SECRET, logLines: [], errorData: EMAIL, journal: null },
      { type: "QueryRemoved", queryId: 2 },
    ],
  },
  TransitionChunk: { type: "TransitionChunk", chunk: JSON.stringify({ value: SECRET, jwt: JWT }), partNumber: 1, totalParts: 3, transitionId: SECRET },
  AuthError: { type: "AuthError", error: `Token ${JWT} expired for ${EMAIL}`, baseVersion: 1, authUpdateAttempted: true },
  FatalError: { type: "FatalError", error: SECRET },
};

const expected = {
  Connect: "Connect",
  AuthenticateUser: "Authenticate",
  AuthenticateAdmin: "Authenticate",
  ModifyQuerySet: "ModifyQuerySet +[binders:list,collection/cards:byBinder] -1",
  Mutation: "Mutation #12 binders:remove",
  Action: "Action #13 bsc:fetchSets",
  Event: "Event",
  MutationResponseOk: "MutationResponse #12 success=true",
  MutationResponseFailed: "MutationResponse #12 success=false",
  ActionResponseOk: "ActionResponse #13 success=true",
  ActionResponseFailed: "ActionResponse #13 success=false",
  Transition: "Transition querySet=4 updates=3 failed=1",
  TransitionChunk: "TransitionChunk 1/3",
  AuthError: "AuthError",
  FatalError: "FatalError",
};

describe("describeFrame", () => {
  for (const [name, frame] of Object.entries(frames)) {
    it(`${name}: names the frame and carries none of its values`, () => {
      const line = describeFrame(JSON.stringify(frame));
      expect(line).toBe(expected[name]);
      for (const s of SENTINELS) expect(line).not.toContain(s);
    });
  }

  it("drops Ping", () => {
    expect(describeFrame(JSON.stringify({ type: "Ping" }))).toBeNull();
  });

  it("reads binary, unparseable and non-object payloads as a fixed marker", () => {
    expect(describeFrame(Buffer.from(JWT))).toBe("binary");
    expect(describeFrame(`{"type":"Mutation","args":["${SECRET}"`)).toBe("unparsed");
    expect(describeFrame("null")).toBe("unparsed");
    expect(describeFrame(JSON.stringify(SECRET))).toBe("unparsed");
    expect(describeFrame("42")).toBe("unparsed");
  });

  it("never echoes a type, path or id that is not shaped like one", () => {
    expect(describeFrame(JSON.stringify({ type: JWT }))).toBe("unknown");
    expect(describeFrame(JSON.stringify({ type: `Mutation ${SECRET}` }))).toBe("unknown");
    expect(describeFrame(JSON.stringify({ type: "Mutation", requestId: SECRET, udfPath: `binders:remove ${JWT}` }))).toBe(
      "Mutation #? <path>",
    );
    expect(describeFrame(JSON.stringify({ type: "Action", requestId: 1, udfPath: { email: EMAIL } }))).toBe("Action #1 <path>");
    expect(
      describeFrame(JSON.stringify({ type: "ModifyQuerySet", modifications: [{ type: "Add", udfPath: EMAIL }, "x", null] })),
    ).toBe("ModifyQuerySet +[<path>] -0");
    expect(describeFrame(JSON.stringify({ type: "MutationResponse", requestId: 1, success: SECRET }))).toBe(
      "MutationResponse #1 success=false",
    );
    expect(describeFrame(JSON.stringify({ type: "Transition", endVersion: { querySet: SECRET }, modifications: SECRET }))).toBe(
      "Transition querySet=? updates=0",
    );
  });
});

describe("wireLine", () => {
  it("scrubs with the shared redactor: JWTs, Convex hosts, URL queries, emails", () => {
    const line = wireLine(
      `PAGEERROR fetch https://happy-animal-123.convex.cloud/api/sync?token=${JWT} for ${EMAIL} with ${JWT}`,
    );
    for (const s of [JWT, "happy-animal-123", EMAIL, "token="]) expect(line).not.toContain(s);
    expect(line).toContain("<deployment>.convex.cloud/api/sync");
  });

  it("scrubs before it cuts, so a token across the 500th character is still removed", () => {
    const line = wireLine(`${"x ".repeat(240)}${JWT}`);
    expect(line.length).toBeLessThanOrEqual(500);
    expect(line).not.toContain("eyJ");
  });

  it("keeps a Convex function name readable", () => {
    expect(wireLine("CONSOLE.error [CONVEX M(binders:remove)] Server Error")).toBe(
      "CONSOLE.error [CONVEX M(binders:remove)] Server Error",
    );
  });
});
