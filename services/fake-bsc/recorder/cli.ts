#!/usr/bin/env node
/**
 * The fake-BSC recorder. Run by a person, on their own machine, never in CI.
 *
 *   bw get item <id> | node dist/recorder/cli.js record --fake <url> --prefix <p> [--watch]
 *   bw get item <id> | node dist/recorder/cli.js capture-write --fake <url> --request put.json [--file img.jpg] --yes
 *
 * BSC credentials come from stdin or a prompt only. The fake's caller and
 * admin keys come from FAKE_BSC_CALLER_KEY / FAKE_BSC_ADMIN_KEY in this
 * process's environment (README: read them from Secret Manager into the
 * command, never into a file). The fake is reached as the loader SA through
 * ADC impersonation.
 */
import { readCredentials } from "./credentials";
import { FakeClient, adcIdTokenMinter, isLoopback } from "./fake-client";
import { loadBrowserModules } from "./bsc";
import { bscCaller, runRecordSession } from "./record";
import { describeWrite, loadWriteRequest, runCaptureWrite } from "./capture-write";

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
  const fake = fakeClient(flags);
  const browser = loadBrowserModules(str(flags, "--browser-dist"));
  const creds = await readCredentials(process.stdin, process.stderr);
  const tokens = await browser.signIn(creds.username, creds.password);
  creds.password = "";
  say("signed in to BSC; walking the miss list");
  let interrupted = false;
  process.once("SIGINT", () => {
    interrupted = true;
    say("stopping after the current request");
  });
  const max = str(flags, "--max");
  const result = await runRecordSession({
    prefix,
    watch: flags.get("--watch") === true,
    fake,
    bsc: bscCaller({ apiBase: browser.apiBase, token: tokens.token, headers: (t) => browser.apiHeaders(t) }),
    tokenExpiresAt: tokens.expiresAt,
    ...(max ? { maxRequests: Number(max) } : {}),
    stopped: () => interrupted,
    report: say,
  });
  say(`sent ${result.sent}, recorded ${result.recorded}, stopped: ${result.stopReason}`);
  for (const n of result.needsModel) say(`needs a fake model: ${n}`);
  return result.stopReason === "done" || result.stopReason === "interrupted" || result.stopReason === "cap" ? 0 : 2;
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
  return r.verdict === "ok" ? 0 : 3;
}

async function main(argv: string[]): Promise<number> {
  const { command, flags } = parseArgs(argv);
  if (command === "record") return record(flags);
  if (command === "capture-write") return captureWrite(flags);
  say("usage: cli.js record --fake <url> --prefix <p> [--watch] [--max N] | capture-write --fake <url> --request <file> [--file <img>] [--yes]");
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
