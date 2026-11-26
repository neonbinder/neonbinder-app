// NEO-398: client-wire.log (playwright/support/wire-log.ts) lands in PUBLIC blob
// reports. These pin that a Convex frame's line carries only its type, request id,
// function path, success flag and counts, never what the frame carried, and that
// every other line goes through the suite's one scrubber (redact.mjs) before the cut;
// and the recorder itself, on fake contexts, pages and sockets.
// The test sits here, where vitest collects .mjs (vitest.include.mjs).
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  attachWireOnFailure,
  BIG_FRAME,
  convexSlug,
  describeFrame,
  describeFrameByParse,
  isConvexSyncSocket,
  pageTag,
  recordWire,
  runLiterals,
  wireLine,
} from "../playwright/support/wire-log.ts";

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

describe("wireLine literals", () => {
  it("masks the run's bare deployment name, which redact alone cannot recognise", () => {
    expect(wireLine("CONSOLE.error deployment happy-otter-42 is busy")).toContain("happy-otter-42");
    expect(wireLine("CONSOLE.error deployment happy-otter-42 is busy", ["happy-otter-42"])).toBe(
      "CONSOLE.error deployment <redacted> is busy",
    );
  });
});

describe("runLiterals / convexSlug", () => {
  it("reads REDACT_LITERALS (one per line) and VITE_CONVEX_URL's deployment name", () => {
    const got = runLiterals({ REDACT_LITERALS: "brave-fox-7\n\n  calm-owl-9 ", VITE_CONVEX_URL: "https://quiet-elk-3.convex.cloud" });
    expect(got).toEqual(expect.arrayContaining(["brave-fox-7", "calm-owl-9", "quiet-elk-3"]));
  });

  it("names a deployment only from a Convex cloud host", () => {
    expect(convexSlug("wss://quiet-elk-3.convex.cloud/api/1.39.1/sync")).toBe("quiet-elk-3");
    expect(convexSlug("https://quiet-elk-3.convex.site")).toBe("quiet-elk-3");
    expect(convexSlug("ws://127.0.0.1:3210/api/1/sync")).toBeNull();
    expect(convexSlug("")).toBeNull();
    expect(convexSlug("not a url")).toBeNull();
  });
});

describe("isConvexSyncSocket", () => {
  it("records the Convex client's sync socket on any host, and nothing else", () => {
    expect(isConvexSyncSocket("wss://quiet-elk-3.convex.cloud/api/1.39.1/sync")).toBe(true);
    expect(isConvexSyncSocket("ws://127.0.0.1:3210/api/1.39.1/sync")).toBe(true);
    expect(isConvexSyncSocket("ws://localhost:3000/")).toBe(false); // Vite HMR
    expect(isConvexSyncSocket("wss://clerk.example.com/v1/socket")).toBe(false);
    expect(isConvexSyncSocket("wss://convex.example.com/feed")).toBe(false); // "convex" in the host is not enough
    expect(isConvexSyncSocket("https://quiet-elk-3.convex.cloud/api/1.39.1/sync")).toBe(false);
    expect(isConvexSyncSocket("")).toBe(false);
  });
});

describe("describeFrame on big frames", () => {
  const pad = "x".repeat(BIG_FRAME + 10);
  const big = {
    Mutation: { type: "Mutation", requestId: 12, udfPath: "binders:remove", args: [{ blob: pad, email: EMAIL }] },
    Action: { type: "Action", requestId: 13, udfPath: "bsc:fetchSets", componentPath: "c", args: [{ blob: pad }] },
    TransitionChunk: { type: "TransitionChunk", chunk: JSON.stringify({ v: pad, jwt: JWT, partNumber: 99 }), partNumber: 2, totalParts: 5, transitionId: "t" },
    Authenticate: { type: "Authenticate", tokenType: "User", value: JWT + pad, baseVersion: 0 },
    FatalError: { type: "FatalError", error: pad },
    Transition: {
      type: "Transition",
      endVersion: { querySet: 9 },
      modifications: [
        { type: "QueryUpdated", value: pad },
        { type: "QueryFailed", errorMessage: SECRET },
      ],
    },
    ModifyQuerySet: { type: "ModifyQuerySet", modifications: [{ type: "Add", udfPath: "binders:list", args: [pad] }, { type: "Remove" }] },
    MutationResponse: { type: "MutationResponse", requestId: 12, success: true, result: pad },
  };
  let parse;
  afterEach(() => parse?.mockRestore());

  for (const [name, frame] of Object.entries(big)) {
    it(`${name}: the same line as a full parse`, () => {
      const raw = JSON.stringify(frame);
      expect(raw.length).toBeGreaterThan(BIG_FRAME);
      expect(describeFrame(raw)).toBe(describeFrameByParse(raw));
      for (const s of SENTINELS) expect(describeFrame(raw)).not.toContain(s);
    });
  }

  it("reads Mutation, Action, TransitionChunk and type-only frames without parsing the body", () => {
    parse = vi.spyOn(JSON, "parse");
    for (const name of ["Mutation", "Action", "TransitionChunk", "Authenticate", "FatalError"]) {
      describeFrame(JSON.stringify(big[name]));
    }
    expect(parse.mock.calls.every(([text]) => String(text).length < 200)).toBe(true);
  });

  it("falls back to a full parse when the head is not the expected shape", () => {
    const raw = JSON.stringify({ requestId: 1, type: "Mutation", udfPath: "a:b", args: [pad] });
    expect(describeFrame(raw)).toBe("Mutation #1 a:b");
    const noArgs = `{"type":"Mutation","requestId":1,"udfPath":"a:b","blob":"${pad}"}`;
    expect(describeFrame(noArgs)).toBe("Mutation #1 a:b");
  });
});

// Fakes with just what recordWire reads from Playwright's objects.
class FakeSocket extends EventEmitter {
  constructor(url) {
    super();
    this._url = url;
  }
  url() {
    return this._url;
  }
}
class FakePage extends EventEmitter {
  constructor() {
    super();
    this.frame = { url: () => "https://app.example/start" };
  }
  mainFrame() {
    return this.frame;
  }
  navigate(url) {
    this.frame.url = () => url;
    this.emit("framenavigated", this.frame);
  }
  socket(url) {
    const ws = new FakeSocket(url);
    this.emit("websocket", ws);
    return ws;
  }
}
class FakeContext extends EventEmitter {
  constructor(pages = []) {
    super();
    this._pages = pages;
  }
  pages() {
    return this._pages;
  }
  newPage() {
    const p = new FakePage();
    this._pages.push(p);
    this.emit("page", p);
    return p;
  }
}
const SYNC = "wss://quiet-elk-3.convex.cloud/api/1.39.1/sync";
const body = (lines) => lines.map((l) => l.replace(/^\s*\d+ms /, ""));

describe("recordWire", () => {
  it("records a page that already existed, its navigations, the sync socket and its frames", () => {
    const page = new FakePage();
    const ctx = new FakeContext([page]);
    const read = recordWire(ctx);
    page.navigate("https://app.example/binders?token=abc#x");
    const ws = page.socket(SYNC);
    ws.emit("framesent", { payload: JSON.stringify({ type: "Mutation", requestId: 1, udfPath: "binders:remove", args: [SECRET] }) });
    ws.emit("framereceived", { payload: JSON.stringify({ type: "Ping" }) });
    ws.emit("framereceived", { payload: JSON.stringify({ type: "MutationResponse", requestId: 1, success: true, result: SECRET }) });
    ws.emit("socketerror", `boom ${JWT}`);
    ws.emit("close");
    expect(body(read())).toEqual([
      "NAVIGATED /binders",
      "WS open #1",
      "-> Mutation #1 binders:remove",
      "<- MutationResponse #1 success=true",
      "WS error #1 boom [jwt removed]",
      "WS close #1",
    ]);
  });

  it("ignores a socket that is not the Convex sync socket", () => {
    const page = new FakePage();
    const read = recordWire(new FakeContext([page]));
    const hmr = page.socket("ws://localhost:3000/");
    hmr.emit("framesent", { payload: JSON.stringify({ type: "Mutation", requestId: 1, udfPath: "a:b" }) });
    expect(read()).toEqual([]);
  });

  it("records an unparseable or empty URL as NAVIGATED <url?>", () => {
    const page = new FakePage();
    const read = recordWire(new FakeContext([page]));
    page.navigate("");
    expect(body(read())).toEqual(["NAVIGATED <url?>"]);
  });

  it("tags a second page's lines [page 2] and leaves the first page and pageless events untagged", () => {
    const first = new FakePage();
    const ctx = new FakeContext([first]);
    const read = recordWire(ctx);
    const second = ctx.newPage();
    second.navigate("https://app.example/second");
    first.navigate("https://app.example/first");
    ctx.emit("weberror", { page: () => null, error: () => new Error("no page") });
    ctx.emit("weberror", { page: () => second, error: () => new Error("on second") });
    ctx.emit("console", { type: () => "error", text: () => "first said", page: () => first });
    ctx.emit("console", { type: () => "warning", text: () => "second warned", page: () => second });
    ctx.emit("console", { type: () => "log", text: () => "ignored", page: () => first });
    expect(body(read())).toEqual([
      "[page 2] NAVIGATED /second",
      "NAVIGATED /first",
      "PAGEERROR no page",
      "[page 2] PAGEERROR on second",
      "CONSOLE.error first said",
      "[page 2] CONSOLE.warning second warned",
    ]);
  });

  it("keeps the newest 4000 lines and says how many earlier ones were dropped", () => {
    const page = new FakePage();
    const ctx = new FakeContext([page]);
    const read = recordWire(ctx);
    for (let i = 0; i < 4010; i++) ctx.emit("console", { type: () => "error", text: () => `line ${i}`, page: () => page });
    const lines = read();
    expect(lines).toHaveLength(4001);
    expect(lines[0]).toBe("(10 earlier lines dropped)");
    expect(body([lines[1]])).toEqual(["CONSOLE.error line 10"]);
    expect(body([lines[4000]])).toEqual(["CONSOLE.error line 4009"]);
  });

  it("masks the deployment name its Convex socket used, in every line, when read", () => {
    const page = new FakePage();
    const ctx = new FakeContext([page]);
    const read = recordWire(ctx);
    // A name no earlier test's socket used: only this socket can teach it.
    ctx.emit("console", { type: () => "error", text: () => "lost deployment brisk-lynx-8", page: () => page });
    expect(body(read())).toEqual(["CONSOLE.error lost deployment brisk-lynx-8"]);
    page.socket("wss://brisk-lynx-8.convex.cloud/api/1.39.1/sync");
    expect(body(read())).toEqual(["CONSOLE.error lost deployment <redacted>", "WS open #1"]);
  });
});

describe("pageTag", () => {
  it("is the known page's tag, else empty", () => {
    const a = new FakePage();
    const b = new FakePage();
    const pages = new Map([
      [a, ""],
      [b, "[page 2] "],
    ]);
    expect(pageTag(pages, b)).toBe("[page 2] ");
    expect(pageTag(pages, a)).toBe("");
    expect(pageTag(pages, new FakePage())).toBe("");
    expect(pageTag(pages, null)).toBe("");
  });
});

describe("attachWireOnFailure", () => {
  const spy = (status, expectedStatus = "passed") => ({ status, expectedStatus, attach: vi.fn(async () => {}) });

  for (const [status, expected, red] of [
    ["passed", "passed", false],
    ["failed", "passed", true],
    ["timedOut", "passed", true],
    ["failed", "failed", false],
  ]) {
    it(`${status} (expected ${expected}): ${red ? "attaches" : "attaches nothing and reads nothing"}`, async () => {
      const info = spy(status, expected);
      const lines = vi.fn(() => ["  1ms WS open #1", "  2ms WS close #1"]);
      await attachWireOnFailure(info, lines);
      if (red) {
        expect(info.attach).toHaveBeenCalledWith("client-wire.log", {
          contentType: "text/plain",
          body: "  1ms WS open #1\n  2ms WS close #1",
        });
      } else {
        expect(info.attach).not.toHaveBeenCalled();
        expect(lines).not.toHaveBeenCalled();
      }
    });
  }
});
