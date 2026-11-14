#!/usr/bin/env node
/**
 * The fake-BSC recorder. Run by a person, on their own machine, never in CI.
 *
 *   bw get item <id> | node dist/recorder/cli.js record --fake <url> --prefix <p> [--watch] [--max N] [--include-anon] [--yes]
 *   bw get item <id> | node dist/recorder/cli.js capture-write --fake <url> --request put.json [--file img.jpg] --yes
 *   bw get item <id> | node dist/recorder/cli.js undo-write --request put.json --yes
 *
 * BSC credentials come from stdin or a prompt only. The fake's caller and
 * admin keys come from FAKE_BSC_CALLER_KEY / FAKE_BSC_ADMIN_KEY in this
 * process's environment (README: read them from Secret Manager into the
 * command, never into a file). The fake is reached as the loader SA through
 * ADC impersonation.
 */
import { readCredentials } from "./credentials";
import { FakeClient, adcIdTokenMinter, isLoopback } from "./fake-client";
import { bscSession, loadBrowserModules } from "./bsc";
import { MAX_REQUESTS_PER_SESSION, bscCaller, describeRequest, planMisses, runRecordSession } from "./record";
import { buildUndoRequest, describeUndo, describeWrite, loadWriteRequest, runCaptureWrite, runUndoWrite } from "./capture-write";
import { askOnTerminal } from "./confirm";

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

function fakeClient(flags: Map<string, string | true>): FakeClient {
  const url = str(flags, "--fake");
  if (!url) throw new Error("--fake <url> is required");
  const callerKey = process.env.FAKE_BSC_CALLER_KEY ?? "";
  const adminKey = process.env.FAKE_BSC_ADMIN_KEY ?? "";
  if (!callerKey || !adminKey) throw new Error("FAKE_BSC_CALLER_KEY and FAKE_BSC_ADMIN_KEY must be set for this command (see README)");
  const noIdToken = flags.get("--no-id-token") === true;
  if (noIdToken && !isLoopback(url)) throw new Error("--no-id-token is only for a fake on localhost");
  const audience = str(flags, "--audience") ?? new URL(url).origin;
  return new FakeClient({ baseUrl: url, callerKey, adminKey, idToken: noIdToken ? null : adcIdTokenMinter(audience) });
}

const say = (line: string) => process.stderr.write(`${line}\n`);

async function record(flags: Map<string, string | true>): Promise<number> {
  const prefix = str(flags, "--prefix");
  if (!prefix || prefix.length < 3) throw new Error("--prefix <convexSlug-> is required (at least 3 characters)");
  const max = readMax(flags.get("--max"));
  const includeAnon = flags.get("--include-anon") === true;
  const watch = flags.get("--watch") === true;
  const fake = fakeClient(flags);

  // Plan first, before any credential is read or BSC is contacted.
  const plan = planMisses(await fake.misses(prefix), { includeAnon });
  for (const r of plan.refused) say(`refused (never sent): ${r.label}`);
  if (plan.anonSkipped) say(`${plan.anonSkipped} anonymous miss(es) left alone (--include-anon to replay them)`);
  const cap = max ?? MAX_REQUESTS_PER_SESSION;
  const yes = flags.get("--yes") === true;
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
    fake,
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

async function captureWrite(flags: Map<string, string | true>): Promise<number> {
  const requestFile = str(flags, "--request");
  if (!requestFile) throw new Error("--request <file.json> is required");
  const request = await loadWriteRequest(requestFile, str(flags, "--file"));
  say(`would send exactly one write: ${describeWrite(request)}`);
  if (flags.get("--yes") !== true) {
    say("dry run: add --yes to send it");
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
  if (!r.ok) {
    say(`capture failed: ${r.reason}`);
    return 2;
  }
  say(`BSC answered ${r.status}; ${r.paths} shape path(s) stored; fake verdict: ${r.verdict}`);
  for (const p of r.driftPaths) say(`  differs: ${p}`);
  if (buildUndoRequest(request)) {
    say("THIS WAS A REAL WRITE on the signed-in BSC account. To take the listing(s) down again:");
    say(`  <same stdin> | node dist/recorder/cli.js undo-write --request ${requestFile}   (dry run; add --yes to send)`);
  } else {
    say("THIS WAS A REAL PHOTO UPLOAD on the signed-in BSC account; there is no API undo (README, \"Undoing a capture\").");
  }
  return r.verdict === "ok" ? 0 : 3;
}

async function undoWrite(flags: Map<string, string | true>): Promise<number> {
  const requestFile = str(flags, "--request");
  if (!requestFile) throw new Error("--request <file.json> is required (the file capture-write sent)");
  const request = await loadWriteRequest(requestFile, str(flags, "--file"));
  const undo = buildUndoRequest(request);
  if (!undo) {
    say("nothing to undo through the API: a photo upload cannot be removed this way (README, \"Undoing a capture\")");
    return 1;
  }
  say(`would send exactly one write: ${describeUndo(undo)}`);
  if (flags.get("--yes") !== true) {
    say("dry run: add --yes to send it");
    return 0;
  }
  const browser = loadBrowserModules(str(flags, "--browser-dist"));
  const creds = await readCredentials(process.stdin, process.stderr);
  const tokens = await browser.signIn(creds.username, creds.password);
  creds.password = "";
  const r = await runUndoWrite({ request, apiBase: browser.apiBase, token: tokens.token, headers: (t, o) => browser.apiHeaders(t, o) });
  if (!r.ok) {
    say(`undo failed: ${r.reason}`);
    return 2;
  }
  say(`BSC answered ${r.status}`);
  return r.status >= 200 && r.status < 300 ? 0 : 2;
}

async function main(argv: string[]): Promise<number> {
  const { command, flags } = parseArgs(argv);
  if (command === "record") return record(flags);
  if (command === "capture-write") return captureWrite(flags);
  if (command === "undo-write") return undoWrite(flags);
  say(
    "usage: cli.js record --fake <url> --prefix <p> [--watch] [--max N] [--include-anon] [--yes]\n" +
      "     | capture-write --fake <url> --request <file> [--file <img>] [--yes]\n" +
      "     | undo-write --request <file> [--yes]",
  );
  return 1;
}

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err: unknown) => {
      say(`error: ${err instanceof Error ? err.message : "unknown"}`);
      process.exit(1);
    },
  );
}
