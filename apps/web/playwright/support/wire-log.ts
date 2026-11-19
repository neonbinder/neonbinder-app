/**
 * What the browser saw, attached to a failed test (NEO-398).
 *
 * The server's call log shows a page that stopped asking (a binder delete
 * whose `remove` never arrived after `empty` answered). This records the
 * client side so a failure says whether the answer reached the page, whether
 * the next call was sent, and whether the Convex socket dropped.
 *
 * Recorded, for every page of the test's context: page errors, console errors
 * and warnings, main-frame navigations (the path only), Convex websocket opens
 * and closes, and one line per Convex frame naming its type, request id and
 * function path. NEVER recorded: arguments, results, query values, the
 * Authenticate token, a URL's query, or the Convex host. Blob reports are
 * public artifacts (playwright.config.ts), so every line also passes through
 * the suite's one scrubber (./redact.mjs) before it is kept.
 *
 * The opt-in `console` attachment (fixtures.ts `captureConsole`) is the full
 * console; this keeps only errors and warnings, interleaved with the socket
 * traffic so their order against the calls is visible.
 */
import type { BrowserContext, Page, TestInfo } from "@playwright/test";
import { redact } from "./redact.mjs";

/** The last lines kept: a hang is at the end of the test, not its start. */
const MAX_LINES = 4000;
const LINE_CHARS = 500;

// Shapes describeFrame will print. Anything else becomes a fixed marker, so a
// frame that carried text in one of these fields cannot smuggle it out.
const FRAME_TYPE = /^[A-Za-z]{1,40}$/;
const UDF_PATH = /^[\w/.-]{1,120}(?::[\w]{1,80})?$/;

type Frame = {
  type?: unknown;
  requestId?: unknown;
  udfPath?: unknown;
  success?: unknown;
  modifications?: unknown;
  endVersion?: { querySet?: unknown };
  partNumber?: unknown;
  totalParts?: unknown;
};

const num = (v: unknown): string => (typeof v === "number" && Number.isFinite(v) ? String(v) : "?");
const path = (v: unknown): string => (typeof v === "string" && UDF_PATH.test(v) ? v : "<path>");
type Mod = { type?: unknown; udfPath?: unknown };
const mods = (v: unknown): Mod[] =>
  Array.isArray(v) ? v.filter((m): m is Mod => typeof m === "object" && m !== null) : [];

/**
 * One Convex sync-protocol frame as a log line, or null for one not worth a
 * line (Ping). Only the frame's type, request id, function path, a success
 * flag and counts ever reach the output: never args, results, query values,
 * error messages, log lines or tokens.
 */
export function describeFrame(raw: string | Buffer): string | null {
  if (typeof raw !== "string") return "binary";
  let f: Frame;
  try {
    f = JSON.parse(raw) as Frame;
  } catch {
    return "unparsed";
  }
  if (typeof f !== "object" || f === null) return "unparsed";
  const type = typeof f.type === "string" && FRAME_TYPE.test(f.type) ? f.type : "unknown";
  switch (type) {
    case "Ping":
      return null;
    case "Mutation":
    case "Action":
      return `${type} #${num(f.requestId)} ${path(f.udfPath)}`;
    case "MutationResponse":
    case "ActionResponse":
      return `${type} #${num(f.requestId)} success=${f.success === true}`;
    case "ModifyQuerySet": {
      const all = mods(f.modifications);
      const added = all.filter((m) => m.type === "Add").map((m) => path(m.udfPath));
      const removed = all.filter((m) => m.type === "Remove").length;
      return `ModifyQuerySet +[${added.join(",")}] -${removed}`;
    }
    case "Transition": {
      const all = mods(f.modifications);
      const failed = all.filter((m) => m.type === "QueryFailed").length;
      return `Transition querySet=${num(f.endVersion?.querySet)} updates=${all.length}${failed ? ` failed=${failed}` : ""}`;
    }
    case "TransitionChunk":
      // A large Transition split in parts: the chunk itself is query values.
      return `TransitionChunk ${num(f.partNumber)}/${num(f.totalParts)}`;
    default:
      // Connect, Authenticate, AuthError, FatalError, ...: the type alone.
      return type;
  }
}

/** Scrubbed, then cut: a cut first could split a token past recognition. */
export function wireLine(text: string): string {
  return redact(text).slice(0, LINE_CHARS);
}

export function recordWire(context: BrowserContext): () => string[] {
  const start = Date.now();
  const lines: string[] = [];
  let dropped = 0;
  const add = (line: string) => {
    lines.push(`${String(Date.now() - start).padStart(7)}ms ${wireLine(line)}`);
    if (lines.length > MAX_LINES) {
      lines.shift();
      dropped += 1;
    }
  };

  const pages = new Map<Page, string>();
  let sockets = 0;
  const watch = (page: Page) => {
    if (pages.has(page)) return;
    // A test with one page reads unprefixed; a second page's lines say which.
    const tag = pages.size === 0 ? "" : `[page ${pages.size + 1}] `;
    pages.set(page, tag);
    page.on("framenavigated", (fr) => {
      if (fr === page.mainFrame()) add(`${tag}NAVIGATED ${new URL(fr.url()).pathname}`);
    });
    page.on("websocket", (ws) => {
      if (!new URL(ws.url()).host.includes("convex")) return;
      const n = ++sockets;
      add(`${tag}WS open #${n}`);
      ws.on("close", () => add(`${tag}WS close #${n}`));
      ws.on("socketerror", (e) => add(`${tag}WS error #${n} ${String(e)}`));
      ws.on("framesent", (f) => {
        const d = describeFrame(f.payload);
        if (d) add(`${tag}-> ${d}`);
      });
      ws.on("framereceived", (f) => {
        const d = describeFrame(f.payload);
        if (d) add(`${tag}<- ${d}`);
      });
    });
  };
  for (const page of context.pages()) watch(page);
  context.on("page", watch);
  context.on("weberror", (e) => add(`${pageTag(pages, e.page())}PAGEERROR ${e.error().message}`));
  context.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") add(`${pageTag(pages, m.page())}CONSOLE.${m.type()} ${m.text()}`);
  });
  return () => (dropped ? [`(${dropped} earlier lines dropped)`, ...lines] : lines);
}

function pageTag(pages: Map<Page, string>, page: Page | null): string {
  return page ? (pages.get(page) ?? "") : "";
}

export async function attachWireOnFailure(testInfo: TestInfo, lines: string[]): Promise<void> {
  if (testInfo.status === testInfo.expectedStatus) return;
  await testInfo.attach("client-wire.log", { contentType: "text/plain", body: lines.join("\n") });
}
