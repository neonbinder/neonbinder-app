/**
 * What the browser saw, attached to a failed test (NEO-398).
 *
 * The server's call log shows a page that stopped asking (a binder delete
 * whose `remove` never arrived after `empty` answered). This records the
 * client side so a failure says whether the answer reached the page, whether
 * the next call was sent, and whether the Convex socket dropped.
 *
 * Recorded, for every page of the test's context: page errors, console errors
 * and warnings, main-frame navigations (the path only), Convex sync-socket
 * opens and closes, and one line per Convex frame naming its type, request id
 * and function path. NEVER recorded: arguments, results, query values, the
 * Authenticate token, a URL's query, or the Convex host. Blob reports are
 * public artifacts (playwright.config.ts), so every line is scrubbed before it
 * leaves the process: the run's private literals (runLiterals: the preview's
 * bare deployment name) are masked, then the suite's one scrubber
 * (./redact.mjs) runs, then the line is cut. Lines are scrubbed when read,
 * which is only on a red result, so a green test pays nothing for it.
 *
 * The opt-in `console` attachment (fixtures.ts `captureConsole`) is the full
 * console; this keeps only errors and warnings, interleaved with the socket
 * traffic so their order against the calls is visible.
 */
import type { BrowserContext, Page, TestInfo } from "@playwright/test";
import { redact, redactLiterals } from "./redact.mjs";

/** The last lines kept: a hang is at the end of the test, not its start. */
const MAX_LINES = 4000;
/** What a line keeps once scrubbed. */
const LINE_CHARS = 500;
/**
 * What a line keeps before it is scrubbed. redact's rules are slow on very long
 * runs (redact-cli.mjs), and the cut lands far past the LINE_CHARS kept, so a
 * token it splits is either wholly past the kept part or still a long run.
 */
const RAW_CHARS = 2000;
/** A frame this long has its type (and cheap fields) read without a full parse. */
export const BIG_FRAME = 8 * 1024;

// Shapes describeFrame will print. Anything else becomes a fixed marker, so a
// frame that carried text in one of these fields cannot smuggle it out.
const FRAME_TYPE = /^[A-Za-z]{1,40}$/;
const UDF_PATH = /^[\w/.-]{1,120}(?::[\w]{1,80})?$/;
// The Convex client opens `${ws}://${origin}/api/${version}/sync` (convex/browser).
const SYNC_PATH = /^\/api\/[^/]+\/sync$/;
const CLOUD_HOST = /^([a-z0-9-]+)\.convex\.(?:cloud|site)$/;

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

function describeParsed(f: unknown): string | null {
  if (typeof f !== "object" || f === null) return "unparsed";
  const frame = f as Frame;
  const type = typeof frame.type === "string" && FRAME_TYPE.test(frame.type) ? frame.type : "unknown";
  switch (type) {
    case "Ping":
      return null;
    case "Mutation":
    case "Action":
      return `${type} #${num(frame.requestId)} ${path(frame.udfPath)}`;
    case "MutationResponse":
    case "ActionResponse":
      return `${type} #${num(frame.requestId)} success=${frame.success === true}`;
    case "ModifyQuerySet": {
      const all = mods(frame.modifications);
      const added = all.filter((m) => m.type === "Add").map((m) => path(m.udfPath));
      const removed = all.filter((m) => m.type === "Remove").length;
      return `ModifyQuerySet +[${added.join(",")}] -${removed}`;
    }
    case "Transition": {
      const all = mods(frame.modifications);
      const failed = all.filter((m) => m.type === "QueryFailed").length;
      return `Transition querySet=${num(frame.endVersion?.querySet)} updates=${all.length}${failed ? ` failed=${failed}` : ""}`;
    }
    case "TransitionChunk":
      // A large Transition split in parts: the chunk itself is query values.
      return `TransitionChunk ${num(frame.partNumber)}/${num(frame.totalParts)}`;
    default:
      // Connect, Authenticate, AuthError, FatalError, ...: the type alone.
      return type;
  }
}

/** describeFrame's answer by a full parse. Exported so tests can hold the fast path to it. */
export function describeFrameByParse(raw: string): string | null {
  try {
    return describeParsed(JSON.parse(raw));
  } catch {
    return "unparsed";
  }
}

// Both the client and the server write `type` as a frame's first key.
const HEAD_TYPE = /^\{"type":"([A-Za-z]{1,40})"/;
// The types whose line needs a field that sits after (or among) raw JSON values.
const NEEDS_BODY = new Set(["Transition", "ModifyQuerySet", "MutationResponse", "ActionResponse"]);

/** A key's value read where the key can only be structural, or undefined. */
function structuralNumber(raw: string, key: string): unknown {
  // Inside a JSON string every `"` is escaped, so `,"key":` and `{"key":` only
  // occur as the frame's own keys.
  const at = raw.search(new RegExp(`[,{]"${key}":`));
  if (at < 0) return undefined;
  const m = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?(?=[,}])/.exec(raw.slice(at + key.length + 4, at + key.length + 40));
  return m ? Number(m[0]) : undefined;
}

/**
 * A big, well-formed frame's line without parsing its body, or undefined to fall
 * back to a full parse. Same line as describeFrameByParse for a well-formed frame.
 */
function describeBig(raw: string): string | null | undefined {
  const head = HEAD_TYPE.exec(raw);
  if (!head) return undefined;
  const type = head[1];
  if (NEEDS_BODY.has(type)) return undefined;
  if (type === "Mutation" || type === "Action") {
    // The client writes type, requestId, udfPath, componentPath, then args.
    const args = raw.indexOf(',"args":');
    if (args < 0) return undefined;
    try {
      return describeParsed(JSON.parse(`${raw.slice(0, args)}}`));
    } catch {
      return undefined;
    }
  }
  if (type === "TransitionChunk") {
    const partNumber = structuralNumber(raw, "partNumber");
    const totalParts = structuralNumber(raw, "totalParts");
    if (partNumber === undefined || totalParts === undefined) return undefined;
    return describeParsed({ type, partNumber, totalParts });
  }
  // Ping, Connect, Authenticate, AuthError, FatalError, Event, any other: the type alone.
  return describeParsed({ type });
}

/**
 * One Convex sync-protocol frame as a log line, or null for one not worth a
 * line (Ping). Only the frame's type, request id, function path, a success
 * flag and counts ever reach the output: never args, results, query values,
 * error messages, log lines or tokens. A frame over BIG_FRAME is read from its
 * head where the line allows (Mutation, Action, TransitionChunk and the
 * type-only frames); Transition, ModifyQuerySet and the responses still parse,
 * because their counts and flags sit among raw JSON values.
 */
export function describeFrame(raw: string | Buffer): string | null {
  if (typeof raw !== "string") return "binary";
  if (raw.length > BIG_FRAME) {
    const fast = describeBig(raw);
    if (fast !== undefined) return fast;
  }
  return describeFrameByParse(raw);
}

/** The Convex client's sync socket (`/api/<version>/sync`), on any host. */
export function isConvexSyncSocket(url: string): boolean {
  try {
    const u = new URL(url);
    return (u.protocol === "ws:" || u.protocol === "wss:") && SYNC_PATH.test(u.pathname);
  } catch {
    return false;
  }
}

/** A Convex cloud host's bare deployment name, or null. */
export function convexSlug(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return CLOUD_HOST.exec(new URL(url).host)?.[1] ?? null;
  } catch {
    return null;
  }
}

/** Deployment names seen on this worker's Convex sockets. */
const seenSlugs = new Set<string>();

/**
 * Literal strings every failure attachment masks: the bare names of the
 * deployment the run talks to, which redact.mjs cannot recognise without a
 * host or `dev:` prefix. CI passes the preview's as REDACT_LITERALS (e2e.yml,
 * one per line, as for redact-cli.mjs); VITE_CONVEX_URL's and every Convex
 * socket's host add theirs.
 */
export function runLiterals(env: NodeJS.ProcessEnv = process.env): string[] {
  const out = new Set<string>(seenSlugs);
  for (const l of (env.REDACT_LITERALS ?? "").split("\n")) if (l.trim()) out.add(l.trim());
  const fromUrl = convexSlug(env.VITE_CONVEX_URL);
  if (fromUrl) out.add(fromUrl);
  return [...out];
}

/** Private literals masked, scrubbed, then cut: a cut first could split a token past recognition. */
export function wireLine(text: string, literals: readonly string[] = []): string {
  return redact(redactLiterals(text.slice(0, RAW_CHARS), literals)).slice(0, LINE_CHARS);
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return "<url?>";
  }
}

/** Records the context's pages; the returned reader gives the scrubbed lines. */
export function recordWire(context: BrowserContext): () => string[] {
  const start = Date.now();
  const lines: string[] = []; // raw (cut to RAW_CHARS); scrubbed only when read
  let dropped = 0;
  const add = (line: string) => {
    lines.push(`${String(Date.now() - start).padStart(7)}ms ${line.slice(0, RAW_CHARS)}`);
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
      if (fr === page.mainFrame()) add(`${tag}NAVIGATED ${pathOf(fr.url())}`);
    });
    page.on("websocket", (ws) => {
      const url = ws.url();
      if (!isConvexSyncSocket(url)) return;
      const slug = convexSlug(url);
      if (slug) seenSlugs.add(slug);
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
  return () => {
    const literals = runLiterals();
    const out = lines.map((l) => wireLine(l, literals));
    return dropped ? [`(${dropped} earlier lines dropped)`, ...out] : out;
  };
}

/** The `[page N] ` prefix of a known page; "" for the first page, an unknown one, or none. */
export function pageTag(pages: Map<Page, string>, page: Page | null): string {
  return page ? (pages.get(page) ?? "") : "";
}

/** Attaches the scrubbed lines to a red result; a green one never reads (or scrubs) them. */
export async function attachWireOnFailure(
  testInfo: Pick<TestInfo, "status" | "expectedStatus" | "attach">,
  lines: () => string[],
): Promise<void> {
  if (testInfo.status === testInfo.expectedStatus) return;
  await testInfo.attach("client-wire.log", { contentType: "text/plain", body: lines().join("\n") });
}
