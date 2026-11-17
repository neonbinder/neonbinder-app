#!/usr/bin/env node
/**
 * The fake-BSC recorder. Run by a person, on their own machine, never in CI.
 *
 *   bw get item <id> | node dist/recorder/cli.js record --fake <url> (--prefix <p> | --all) [--watch] [--max N] [--include-anon] [--yes]
 *   bw get item <id> | node dist/recorder/cli.js capture-write --fake <url> --request put.json [--file img.jpg] --yes
 *   bw get item <id> | node dist/recorder/cli.js undo-write --request put.json --yes
 *
 * BSC credentials come from stdin or a prompt only. The fake's caller and
 * admin keys come from FAKE_BSC_CALLER_KEY / FAKE_BSC_ADMIN_KEY in this
 * process's environment (README: read them from Secret Manager into the
 * command, never into a file). The fake is reached with a Google ID token:
 * from FAKE_BSC_ID_TOKEN_FILE (a file re-read on each request) when set,
 * otherwise from ADC.
 */
import { readCredentials } from "./credentials";
import { FakeClient, assertFakeUrl, idTokenSource, isLoopback } from "./fake-client";
import { bscSession, loadBrowserModules } from "./bsc";
import { MAX_REQUESTS_PER_SESSION, bscCaller, describeRequest, planMisses, runRecordSession } from "./record";
import { describeRefusal, describeUndo, describeUndoCheck, describeWrite, loadWriteRequest, runCaptureWrite, runUndoWrite, type CaptureResult, type UndoResult } from "./capture-write";
import { askOnTerminal, typeOnTerminal } from "./confirm";
import { EbayApi, EbayStop, type EbayEnv } from "./ebay-api";
import { promptEbayCreds, readCredsFile, readProductionCreds } from "./ebay-credentials";
import { ebayCallFor, ebayRecordPlan, runEbayRecord } from "./ebay-record";
import {
  captureSku,
  checkCaptureSku,
  prodFailureLines,
  prodPlanLines,
  runEbayUndo,
  runProdCapture,
  runSandboxCapture,
  sandboxPlanLines,
  captureDate,
  holdStdioErrors,
  type CaptureSink,
  type Picture,
} from "./ebay-capture";
import { imageMetadataProblem } from "./capture-write";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve } from "node:path";
import type { Shape } from "../src/shape";

const FORBIDDEN_FLAGS = new Set(["--password", "--username", "--user", "--pass", "--credentials"]);

export interface ParsedArgs {
  command: string;
  flags: Map<string, string | true>;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const [command = "", ...rest] = argv;
  const flags = new Map<string, string | true>();
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    const name = a.split("=")[0];
    if (FORBIDDEN_FLAGS.has(name)) throw new Error(`${name} is not accepted: pipe credentials on stdin (bw get item <id> | ...)`);
    if (!a.startsWith("--")) throw new Error(`unexpected argument: ${a}`);
    if (a.includes("=")) flags.set(name, a.slice(a.indexOf("=") + 1));
    else if (i + 1 < rest.length && !rest[i + 1].startsWith("--")) flags.set(a, rest[++i]);
    else flags.set(a, true);
  }
  return { command, flags };
}

function str(flags: Map<string, string | true>, name: string): string | undefined {
  const v = flags.get(name);
  return typeof v === "string" ? v : undefined;
}

/**
 * `--max N`: a positive whole number, clamped to the session cap. Anything
 * else is an error, never a silently uncapped session.
 */
export function readMax(value: string | true | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^[1-9][0-9]{0,8}$/.test(value)) throw new Error("--max must be a positive whole number");
  return Math.min(Number(value), MAX_REQUESTS_PER_SESSION);
}

export function fakeClient(flags: Map<string, string | true>): FakeClient {
  const url = str(flags, "--fake");
  if (!url) throw new Error("--fake <url> is required");
  assertFakeUrl(url);
  const callerKey = process.env.FAKE_BSC_CALLER_KEY ?? "";
  const adminKey = process.env.FAKE_BSC_ADMIN_KEY ?? "";
  if (!callerKey || !adminKey) throw new Error("FAKE_BSC_CALLER_KEY and FAKE_BSC_ADMIN_KEY must be set for this command (see README)");
  const noIdToken = flags.get("--no-id-token") === true;
  if (noIdToken && !isLoopback(url)) throw new Error("--no-id-token is only for a fake on localhost");
  const audience = str(flags, "--audience") ?? new URL(url).origin;
  return new FakeClient({ baseUrl: url, callerKey, adminKey, idToken: noIdToken ? null : idTokenSource(audience) });
}

const say = (line: string) => process.stderr.write(`${line}\n`);

/**
 * Which misses a session reads: `--prefix <p>` (one deployment, caller auth)
 * or `--all` (every owner, the admin-only `?all=1`). Exactly one.
 */
export function readMissScope(flags: Map<string, string | true>): { prefix: string } | { all: true } {
  const all = flags.get("--all");
  const prefix = flags.get("--prefix");
  if (all !== undefined) {
    if (all !== true) throw new Error("--all takes no value");
    if (prefix !== undefined) throw new Error("use --prefix or --all, not both");
    return { all: true };
  }
  if (typeof prefix !== "string" || prefix.length < 3) throw new Error("--prefix <convexSlug-> (at least 3 characters) or --all is required");
  return { prefix };
}

export interface RecordOptions {
  scope: { prefix: string } | { all: true };
  max: number | undefined;
  yes: boolean;
  watch: boolean;
  includeAnon: boolean;
}

/**
 * The `record` flags. `--all --yes` would replay every PR's misses with no one
 * reading the plan, so it needs an explicit `--max N` too.
 */
export function readRecordOptions(flags: Map<string, string | true>): RecordOptions {
  const scope = readMissScope(flags);
  const max = readMax(flags.get("--max"));
  const yes = flags.get("--yes") === true;
  if ("all" in scope && yes && max === undefined) {
    throw new Error("--all with --yes needs --max N: it replays every owner's misses without asking, so set how many");
  }
  return { scope, max, yes, watch: flags.get("--watch") === true, includeAnon: flags.get("--include-anon") === true };
}

async function record(flags: Map<string, string | true>): Promise<number> {
  const { scope, max, yes, watch, includeAnon } = readRecordOptions(flags);
  const fake = fakeClient(flags);
  // The one miss source for the plan and the session; `--all` reads every owner.
  let saidTruncated = false;
  const readAll = async () => {
    const page = await fake.allMissesPage();
    if (page.truncated && !saidTruncated) {
      say(`the fake has more misses than one read lists (${page.misses.length} shown, oldest first); run again after this session for the rest`);
      saidTruncated = true;
    }
    return page.misses;
  };
  const source =
    "all" in scope
      ? { misses: () => readAll(), uploadRecording: (r: unknown) => fake.uploadRecording(r) }
      : { misses: (p: string) => fake.misses(p), uploadRecording: (r: unknown) => fake.uploadRecording(r) };
  const prefix = "all" in scope ? "(all)" : scope.prefix;

  // Plan first, before any credential is read or BSC is contacted.
  const plan = planMisses(await source.misses(prefix), { includeAnon });
  for (const r of plan.refused) say(`refused (never sent): ${r.label}`);
  if (plan.anonSkipped) say(`${plan.anonSkipped} anonymous miss(es) left alone (--include-anon to replay them)`);
  const cap = max ?? MAX_REQUESTS_PER_SESSION;
  // Shows every request, then asks. Used for the plan below and again, inside
  // the session, for anything not in the confirmed set (new misses, --watch).
  const confirm = async (items: string[]): Promise<boolean> => {
    for (const line of items) say(`  ${line}`);
    if (yes) return true;
    return askOnTerminal(`Send ${items.length === 1 ? "this" : `these ${items.length}`} to real BSC under your account? Type yes: `);
  };
  say(`${plan.todo.length} request(s) to send to real BSC${watch ? ", then more as misses arrive (each new batch asked again)" : ""} (at most ${cap} this session):`);
  if (plan.todo.length === 0 && !watch) {
    say("nothing to send");
    return 0;
  }
  if (plan.todo.length > 0 && !(await confirm(plan.todo.map((t) => describeRequest(t.req))))) {
    say("not confirmed; nothing sent");
    return 0;
  }

  const browser = loadBrowserModules(str(flags, "--browser-dist"));
  const creds = await readCredentials(process.stdin, process.stderr);
  const session = bscSession(await browser.signIn(creds.username, creds.password), (rt) => browser.refresh(rt));
  creds.password = "";
  say("signed in to BSC; walking the miss list");
  let interrupted = false;
  process.once("SIGINT", () => {
    interrupted = true;
    say("stopping after the current request");
  });
  const result = await runRecordSession({
    prefix,
    watch,
    fake: source,
    bsc: bscCaller({ apiBase: browser.apiBase, token: () => session.token(), headers: (t) => browser.apiHeaders(t) }),
    tokenExpiresAt: session.expiresAt(),
    renewToken: () => session.renew(),
    ...(max !== undefined ? { maxRequests: max } : {}),
    includeAnon,
    // Only the keys shown above are confirmed; anything else is asked again.
    confirmedKeys: new Set(plan.todo.map((t) => t.key)),
    confirm,
    stopped: () => interrupted,
    report: say,
  });
  say(`sent ${result.sent}, recorded ${result.recorded}, stopped: ${result.stopReason}${result.renewals ? ` (session renewed ${result.renewals}x)` : ""}`);
  if (result.stopReason === "refresh_failed") say(`could not renew the BSC session (${result.refreshFailure ?? "unknown"}); nothing more was sent`);
  if (result.stopReason === "token_expiring") say("the BSC session is about to expire and could not be renewed; nothing more was sent");
  if (result.left > 0) say(`${result.left} request(s) not recorded; they stay on the fake's miss list: run the recorder again`);
  for (const n of result.needsModel) say(`needs a fake model: ${n}`);
  for (const r of result.refused) say(`refused (never sent): ${r}`);
  return ["done", "interrupted", "cap", "declined"].includes(result.stopReason) ? 0 : 2;
}

/**
 * What `capture-write` prints about its run: counts, statuses, reasons and
 * the fake's verdict. Built only from the result's own fields, which carry no
 * BSC value (no seller id, no row), so nothing BSC sent can reach the terminal.
 */
export function captureOutcomeLines(r: CaptureResult, requestFile: string, listing: boolean): string[] {
  const lines: string[] = [];
  if (r.ok) {
    lines.push(`sent ${r.sent} request(s); the write answered ${r.status}; ${r.paths} shape path(s) stored; fake verdict: ${r.verdict}`);
    for (const p of r.driftPaths) lines.push(`  differs: ${p}`);
    lines.push(...shapeLines(r.shape));
  } else if (r.reason === "read_refused") {
    return [`nothing written: ${describeRefusal(r.refusal)} (${r.sent} read(s) sent)`];
  } else if (r.reason === "already_listed") {
    return [`nothing written: the card is already listed in that condition; capture with a card this account does not list (${r.sent} read(s) sent)`];
  } else if (r.reason === "sheet_changed") {
    return [`nothing written: the card's row changed between the two sheet reads (something else is writing to it); pick a card nothing lists on this account (${r.sent} read(s) sent)`];
  } else if (r.reason === "upload_refused") {
    lines.push(`the write was sent (${r.sent} request(s) sent), but the fake refused its shape; nothing stored`);
  } else {
    lines.push(`capture failed after the write was sent: ${r.reason}; its answer was not read (${r.sent} request(s) sent)`);
  }
  // From here the write went out (writeSent): it may have changed the account.
  const certain = r.ok || r.reason === "upload_refused";
  const what = certain ? "THIS WAS A REAL" : "THIS MAY HAVE BEEN A REAL";
  if (listing) {
    lines.push(`${what} WRITE on the signed-in BSC account. To take the listing down again:`);
    lines.push(`  <same stdin> | node dist/recorder/cli.js undo-write --request ${requestFile}   (dry run; add --yes to send)`);
  } else {
    lines.push(`${what} PHOTO UPLOAD on the signed-in BSC account; there is no API undo (README, "Undoing a capture").`);
  }
  return lines;
}

/**
 * The shape the capture stored, one line per key path with its types: what
 * `putAnswer` / `photoAnswer` must match. Key names and types only, never a
 * value (`shapeOf` already turned any key that is really a value into `*`).
 */
export function shapeLines(shape: Shape): string[] {
  const paths = Object.keys(shape).sort();
  return [`stored shape (${paths.length} path(s), no values):`, ...paths.map((p) => `  ${p === "" ? "(root)" : p}: ${shape[p].join(" | ")}`)];
}

/** What `undo-write` prints about its run; like `captureOutcomeLines`, no BSC value. */
export function undoOutcomeLines(r: UndoResult): string[] {
  if (!r.ok && !r.writeSent) {
    if (r.reason === "read_refused") return [`nothing written: ${describeRefusal(r.refusal)} (${r.sent} read(s) sent)`];
    if (r.reason === "not_listed") return [`nothing written: the card is not listed in that condition (already taken down?) (${r.sent} read(s) sent)`];
    if (r.reason === "not_ours") return [`nothing written: the card's listing does not carry this request's capture SKU, so it is not the capture's; take it down by hand if it should go (${r.sent} read(s) sent)`];
    return [`nothing written: ${r.reason}`];
  }
  const first = r.ok ? `sent ${r.sent} request(s); the undo answered ${r.status}` : `the undo was sent but its answer was not read (${r.reason}); ${r.sent} request(s) sent`;
  return [first, describeUndoCheck(r.check)];
}

/** True when the undo is known to have taken the row down. */
export function undoSucceeded(r: UndoResult): boolean {
  return r.ok && r.status >= 200 && r.status < 300 && (r.check.state === "down" || r.check.state === "down_other_sku");
}

/** Prints the plan: every request sent to BSC after sign-in. Never a value. */
function sayPlan(lines: string[]): void {
  say(`would sign in to BSC, then send ${lines.length} request(s):`);
  lines.forEach((line, i) => say(`  ${i + 1}. ${line}`));
}

export async function captureWrite(flags: Map<string, string | true>): Promise<number> {
  const requestFile = str(flags, "--request");
  if (!requestFile) throw new Error("--request <file.json> is required");
  const request = await loadWriteRequest(requestFile, str(flags, "--file"));
  sayPlan(describeWrite(request));
  if (flags.get("--yes") !== true) {
    say("dry run: nothing sent; add --yes to send it");
    return 0;
  }
  const fake = fakeClient(flags);
  const browser = loadBrowserModules(str(flags, "--browser-dist"));
  const creds = await readCredentials(process.stdin, process.stderr);
  const tokens = await browser.signIn(creds.username, creds.password);
  creds.password = "";
  const r = await runCaptureWrite({
    request,
    apiBase: browser.apiBase,
    token: tokens.token,
    headers: (t, o) => browser.apiHeaders(t, o),
    fake,
  });
  for (const line of captureOutcomeLines(r, requestFile, request.intent !== undefined)) say(line);
  if (!r.ok) return 2;
  return r.verdict === "ok" ? 0 : 3;
}

export async function undoWrite(flags: Map<string, string | true>): Promise<number> {
  const requestFile = str(flags, "--request");
  if (!requestFile) throw new Error("--request <file.json> is required (the file capture-write sent)");
  const request = await loadWriteRequest(requestFile, str(flags, "--file"));
  if (!request.intent) {
    say("nothing to undo through the API: a photo upload cannot be removed this way (README, \"Undoing a capture\")");
    return 1;
  }
  sayPlan(describeUndo(request));
  if (flags.get("--yes") !== true) {
    say("dry run: nothing sent; add --yes to send it");
    return 0;
  }
  const browser = loadBrowserModules(str(flags, "--browser-dist"));
  const creds = await readCredentials(process.stdin, process.stderr);
  const tokens = await browser.signIn(creds.username, creds.password);
  creds.password = "";
  const r = await runUndoWrite({ request, apiBase: browser.apiBase, token: tokens.token, headers: (t, o) => browser.apiHeaders(t, o) });
  for (const line of undoOutcomeLines(r)) say(line);
  return undoSucceeded(r) ? 0 : 2;
}

// ── eBay (CONTRACT.md, "Recorder: eBay") ───────────────────────────────────

/** The fake's media/eBay flags never carry a credential: refuse the obvious ones. */
const EBAY_FORBIDDEN = new Set(["--cert-id", "--refresh-token", "--client-secret", "--token"]);

function refuseEbaySecrets(flags: Map<string, string | true>): void {
  for (const f of flags.keys()) if (EBAY_FORBIDDEN.has(f)) throw new Error(`${f} is not accepted: credentials come from --creds-file, a prompt, or gcloud`);
}

/** The production credential flags the private wrapper passes (no value is a secret). */
export function readProdCredFlags(flags: Map<string, string | true>): { clientId: string; certSecret: string; sessionSecret: string; project: string } {
  const clientId = str(flags, "--client-id");
  const certSecret = str(flags, "--cert-secret");
  const sessionSecret = str(flags, "--session-secret");
  const project = str(flags, "--project");
  if (!clientId || !certSecret || !sessionSecret || !project) throw new Error("--prod needs --client-id, --cert-secret <name>, --session-secret <name> and --project <id>");
  return { clientId, certSecret, sessionSecret, project };
}

/**
 * The eBay commands' seams (tests only; the CLI passes none). Each default is
 * the real thing: the controlling terminal, the credential readers, the fake.
 */
export interface EbayCliDeps {
  /** The production capture's typed-SKU confirmation. */
  typeToConfirm?: (question: string, expected: string) => Promise<boolean>;
  /** Reads the credentials and builds the client: the only step that reads a credential. */
  ebayApi?: (env: EbayEnv, flags: Map<string, string | true>) => Promise<EbayApi>;
  /** Where captures go. */
  sink?: (flags: Map<string, string | true>) => CaptureSink;
  /** The production capture's second-signal exit. */
  exit?: (code: number) => void;
}

async function ebayApi(env: EbayEnv, flags: Map<string, string | true>): Promise<EbayApi> {
  if (env === "production") {
    const creds = await readProductionCreds(readProdCredFlags(flags));
    return new EbayApi({ env, creds });
  }
  const file = str(flags, "--creds-file");
  const creds = file ? await readCredsFile(file) : await promptEbayCreds(process.stdin, process.stderr);
  return new EbayApi({ env, creds });
}

function stopLine(err: unknown): string {
  return err instanceof EbayStop ? `stopped: ${err.message}` : `error: ${err instanceof Error ? err.message : "unknown"}`;
}

export async function ebayRecord(flags: Map<string, string | true>): Promise<number> {
  refuseEbaySecrets(flags);
  const fake = fakeClient(flags);
  const prefix = str(flags, "--misses");
  if (flags.has("--misses") && (!prefix || prefix.length < 3)) throw new Error("--misses <prefix> needs a prefix of at least 3 characters");
  const plan = ebayRecordPlan(prefix ? await fake.misses(prefix) : null);
  for (const r of plan.refused) say(`refused (never sent): ${r}`);
  say(`would refresh one sandbox user token, then send ${plan.todo.length} read(s) to the eBay sandbox:`);
  plan.todo.forEach((p, i) => say(`  ${i + 1}. ${ebayCallFor(p).label}`));
  if (plan.todo.length === 0) return 0;
  if (flags.get("--yes") !== true && !(await askOnTerminal("Send these to the eBay sandbox? Type yes: "))) {
    say("not confirmed; nothing sent");
    return 0;
  }
  const api = await ebayApi("sandbox", flags);
  try {
    const r = await runEbayRecord({ api, fake, todo: plan.todo, report: say });
    for (const l of r.lines) say(l);
    return r.recorded === plan.todo.length ? 0 : 2;
  } catch (err) {
    say(stopLine(err));
    return 2;
  } finally {
    api.forget();
  }
}

/** The production picture: `--picture <file>`, else NB's public fictional test card. Exif refused. */
export async function loadPicture(file: string | undefined): Promise<Picture> {
  const path = file ?? resolve(__dirname, "../../../../apps/web/public/placeholder-fixtures/01-vorkle-front.jpg");
  const types: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif" };
  const contentType = types[extname(path).toLowerCase()];
  if (!contentType) throw new Error("--picture must be a .jpg, .png, .webp or .gif");
  const st = await stat(path).catch(() => null);
  if (!st || !st.isFile()) throw new Error("the picture file was not found");
  if (st.size > 4 * 1024 * 1024) throw new Error("the picture is over 4 MB");
  const bytes = await readFile(path);
  const problem = imageMetadataProblem(bytes, contentType);
  if (problem) throw new Error(`picture refused: ${problem}`);
  return { filename: `front${extname(path).toLowerCase()}`, contentType, bytes };
}

export async function ebayCapture(flags: Map<string, string | true>, now: () => number = Date.now, deps: EbayCliDeps = {}): Promise<number> {
  refuseEbaySecrets(flags);
  const makeApi = deps.ebayApi ?? ebayApi;
  const makeSink = deps.sink ?? fakeClient;
  if (flags.get("--prod") === true) {
    const sku = captureSku("production", now());
    const given = str(flags, "--sku");
    if (given !== undefined && given !== sku) throw new Error(`refusing SKU: the production capture uses ${sku} only`);
    checkCaptureSku("production", sku);
    say(`would refresh one production user token, run the read-only pre-checks, then send exactly 7 requests that change your eBay account:`);
    for (const l of prodPlanLines(sku)) say(`  ${l}`);
    if (flags.get("--yes") !== true) {
      say("dry run: nothing sent; add --yes to send it (you will be asked to type the SKU)");
      return 0;
    }
    const fake = makeSink(flags);
    const picture = await loadPicture(str(flags, "--picture"));
    // Before any credential is read: no terminal (a pipe, CI) throws here.
    const typed = await (deps.typeToConfirm ?? typeOnTerminal)(`This creates a REAL listing on your eBay account. Type ${sku} to go on: `, sku);
    if (!typed) {
      say("not confirmed; nothing sent");
      return 0;
    }
    const api = await makeApi("production", flags);
    try {
      const out = await runProdCapture({ api, sink: fake, sku, picture, report: say, ...(deps.exit ? { exit: deps.exit } : {}) });
      if (out.ok) {
        say(`done: ${out.stored} capture(s) stored; the listing was ended and the item deleted (verified)`);
        return 0;
      }
      for (const l of prodFailureLines(out, sku)) say(l);
      return 2;
    } catch (err) {
      say(stopLine(err));
      say(`check the account: node dist/recorder/cli.js ebay-undo --prod --sku ${sku} --yes   (same credential flags), or end it in Seller Hub`);
      return 2;
    } finally {
      api.forget();
    }
  }
  const sku = captureSku("sandbox", now());
  const kid = str(flags, "--public-key-id") ?? null;
  if (kid !== null && !/^[A-Za-z0-9-]{1,64}$/.test(kid)) throw new Error("--public-key-id is malformed");
  say("would refresh one sandbox user token and one app token, then:");
  for (const l of sandboxPlanLines(sku, captureDate(now()), kid)) say(`  ${l}`);
  if (flags.get("--yes") !== true) {
    say("dry run: nothing sent; add --yes to send it");
    return 0;
  }
  const fake = makeSink(flags);
  const api = await makeApi("sandbox", flags);
  try {
    const out = await runSandboxCapture({ api, sink: fake, now: now(), publicKeyId: kid, report: say });
    say(`stored ${out.stored} capture(s)${out.reason ? `; ${out.reason}` : ""}`);
    for (const l of out.leftovers) say(`LEFT ON THE SANDBOX: ${l}`);
    if (out.leftovers.length > 0) say(`  remove the item with: node dist/recorder/cli.js ebay-undo --sandbox --sku ${sku} --yes`);
    return out.ok ? 0 : 2;
  } finally {
    api.forget();
  }
}

export async function ebayUndo(flags: Map<string, string | true>, deps: Pick<EbayCliDeps, "ebayApi"> = {}): Promise<number> {
  refuseEbaySecrets(flags);
  const prod = flags.get("--prod") === true;
  const sandbox = flags.get("--sandbox") === true;
  if (prod === sandbox) throw new Error("ebay-undo needs exactly one of --sandbox or --prod");
  const env: EbayEnv = prod ? "production" : "sandbox";
  const sku = str(flags, "--sku");
  if (!sku) throw new Error("--sku NBCAPTURE-... is required");
  checkCaptureSku(env, sku);
  say(`would withdraw ${sku}'s live offer on eBay ${env}, delete the item, then check both are gone`);
  if (flags.get("--yes") !== true) {
    say("dry run: nothing sent; add --yes to send it");
    return 0;
  }
  const api = await (deps.ebayApi ?? ebayApi)(env, flags);
  try {
    const out = await runEbayUndo(api, sku);
    for (const l of out.lines) say(l);
    return out.ok ? 0 : 2;
  } catch (err) {
    say(stopLine(err));
    say("end it in Seller Hub if it is still live");
    return 2;
  } finally {
    api.forget();
  }
}

async function main(argv: string[]): Promise<number> {
  const { command, flags } = parseArgs(argv);
  if (command === "record") return record(flags);
  if (command === "capture-write") return captureWrite(flags);
  if (command === "undo-write") return undoWrite(flags);
  if (command === "ebay-record") return ebayRecord(flags);
  if (command === "ebay-capture") return ebayCapture(flags);
  if (command === "ebay-undo") return ebayUndo(flags);
  say(
    "usage: cli.js record --fake <url> (--prefix <p> | --all) [--watch] [--max N] [--include-anon] [--yes]\n" +
      "     | capture-write --fake <url> --request <file> [--file <img>] [--yes]\n" +
      "     | undo-write --request <file> [--yes]\n" +
      "     | ebay-record --fake <url> [--creds-file <path>] [--misses <prefix>] [--yes]\n" +
      "     | ebay-capture --fake <url> [--creds-file <path>] [--public-key-id <kid>] [--yes]\n" +
      "     | ebay-capture --prod --fake <url> --client-id <id> --cert-secret <name> --session-secret <name> --project <id> [--picture <file>] [--yes]\n" +
      "     | ebay-undo (--sandbox [--creds-file <path>] | --prod --client-id ... --cert-secret ... --session-secret ... --project ...) --sku <NBCAPTURE-...> [--yes]",
  );
  return 1;
}

if (require.main === module) {
  // A closed pipe or hung-up terminal must not end the process mid-command.
  holdStdioErrors();
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err: unknown) => {
      say(`error: ${err instanceof Error ? err.message : "unknown"}`);
      process.exit(1);
    },
  );
}
