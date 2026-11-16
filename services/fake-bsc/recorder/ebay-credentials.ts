/**
 * eBay credentials for one recorder run (CONTRACT.md, "Recorder: eBay").
 *
 *   Sandbox: `--creds-file <path>`, JSON `{clientId, certId, refreshToken}`,
 *     a regular file (not a link) owned by this user, mode 600 or tighter, at
 *     most 16 KB, outside any git checkout. Else a terminal prompt with the
 *     Cert ID and refresh token hidden.
 *   Production: read with the person's own gcloud (`gcloud secrets versions
 *     access`), stdout kept in memory: NB's stored session (its
 *     `refreshToken`) and the app's Cert ID. The secret names and project come
 *     from flags; the client id is public.
 *
 * Errors never quote a value.
 */
import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { open, realpath, stat, type FileHandle } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import type { EbayAppCredentials } from "./ebay-api";

export const MAX_CREDS_FILE_BYTES = 16 * 1024;
const CLIENT_ID_RE = /^[A-Za-z0-9._-]{1,128}$/;
const TOKENISH_RE = /^[\x21-\x7e]{1,8192}$/;

function check(o: Record<string, unknown>): EbayAppCredentials {
  const { clientId, certId, refreshToken } = o;
  if (typeof clientId !== "string" || !CLIENT_ID_RE.test(clientId)) throw new Error("credentials: clientId is missing or malformed");
  if (typeof certId !== "string" || !TOKENISH_RE.test(certId)) throw new Error("credentials: certId is missing or malformed");
  if (typeof refreshToken !== "string" || !TOKENISH_RE.test(refreshToken)) throw new Error("credentials: refreshToken is missing or malformed");
  return { clientId, certId, refreshToken };
}

/** The nearest ancestor holding `.git`, or null. */
export async function gitCheckoutOf(path: string): Promise<string | null> {
  let dir = dirname(path);
  for (let i = 0; i < 64; i++) {
    try {
      await stat(join(dir, ".git"));
      return dir;
    } catch {
      // not here
    }
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
  return null;
}

export interface CredsFileDeps {
  uid?: number;
}

/**
 * Reads and checks the sandbox credentials file. Refuses anything loose.
 *
 * Opened once with O_NOFOLLOW (a link is refused by the kernel, not by an
 * earlier look that a swap could beat) and O_NONBLOCK (a FIFO cannot hang the
 * open); every check is then `fstat` on that handle, and the bytes come from
 * the same handle, at most one byte past the limit.
 */
export async function readCredsFile(path: string, deps: CredsFileDeps = {}): Promise<EbayAppCredentials> {
  let fh: FileHandle;
  try {
    fh = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | null)?.code;
    if (code === "ENOENT" || code === "ENOTDIR") throw new Error("credentials file: not found");
    if (code === "ELOOP" || code === "EMLINK") throw new Error("credentials file: is a link; point at the file itself");
    throw new Error("credentials file: could not be opened");
  }
  let text: string;
  try {
    const st = await fh.stat();
    if (!st.isFile()) throw new Error("credentials file: not a regular file");
    const uid = deps.uid ?? (typeof process.getuid === "function" ? process.getuid() : -1);
    if (uid >= 0 && st.uid !== uid) throw new Error("credentials file: not owned by you");
    if ((st.mode & 0o077) !== 0) throw new Error("credentials file: readable by others; chmod 600 it");
    if (st.size > MAX_CREDS_FILE_BYTES) throw new Error("credentials file: larger than a credentials file");
    if (await gitCheckoutOf(await realpath(path))) throw new Error("credentials file: inside a git checkout; keep it outside every repository");
    // The size can change after the fstat: read at most one byte past the limit.
    const buf = Buffer.alloc(MAX_CREDS_FILE_BYTES + 1);
    let got = 0;
    while (got < buf.length) {
      const { bytesRead } = await fh.read(buf, got, buf.length - got, got);
      if (bytesRead === 0) break;
      got += bytesRead;
    }
    if (got > MAX_CREDS_FILE_BYTES) throw new Error("credentials file: larger than a credentials file");
    text = buf.subarray(0, got).toString("utf8");
    buf.fill(0);
  } finally {
    await fh.close().catch(() => undefined);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("credentials file: not valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("credentials file: not a JSON object");
  return check(parsed as Record<string, unknown>);
}

/** Prompts on a terminal; the Cert ID and refresh token are not echoed. */
export async function promptEbayCreds(input: Readable, output: Writable): Promise<EbayAppCredentials> {
  const rl = createInterface({ input, output, terminal: true });
  const ask = (q: string, hidden: boolean) =>
    new Promise<string>((resolve) => {
      const r = rl as unknown as { _writeToOutput?: (s: string) => void };
      const original = r._writeToOutput;
      rl.question(q, (answer) => {
        if (hidden) {
          r._writeToOutput = original;
          output.write("\n");
        }
        resolve(answer.trim());
      });
      if (hidden) r._writeToOutput = () => undefined;
    });
  try {
    const clientId = await ask("eBay sandbox App ID (client id): ", false);
    const certId = await ask("eBay sandbox Cert ID (hidden): ", true);
    const refreshToken = await ask("eBay sandbox refresh token (hidden): ", true);
    return check({ clientId, certId, refreshToken });
  } finally {
    rl.close();
  }
}

const SECRET_NAME_RE = /^[A-Za-z0-9_-]{1,255}$/;
const PROJECT_RE = /^[a-z][a-z0-9-]{4,29}$/;

/** Runs `gcloud secrets versions access latest` with no shell; stdout stays in memory. */
export type SecretReader = (name: string, project: string) => Promise<string>;

export const gcloudSecret: SecretReader = (name, project) => {
  if (!SECRET_NAME_RE.test(name)) return Promise.reject(new Error("secret name is malformed"));
  if (!PROJECT_RE.test(project)) return Promise.reject(new Error("project id is malformed"));
  return new Promise((resolve, reject) => {
    execFile(
      "gcloud",
      ["secrets", "versions", "access", "latest", `--secret=${name}`, `--project=${project}`],
      { maxBuffer: 64 * 1024, timeout: 60_000, shell: false },
      (err, stdout) => {
        // gcloud's own stderr is not read: it can name the secret or the account.
        if (err) reject(new Error("gcloud could not read the secret (is your gcloud signed in with access to it?)"));
        else resolve(stdout);
      },
    );
  });
};

/**
 * Production: the client id (public), the Cert ID secret, and NB's stored
 * session (JSON with `refreshToken`) for the seller's account.
 */
export async function readProductionCreds(opts: { clientId: string; certSecret: string; sessionSecret: string; project: string; read?: SecretReader }): Promise<EbayAppCredentials> {
  const read = opts.read ?? gcloudSecret;
  const certId = (await read(opts.certSecret, opts.project)).trim();
  let session: unknown;
  try {
    session = JSON.parse(await read(opts.sessionSecret, opts.project));
  } catch {
    throw new Error("the stored eBay session is not JSON");
  }
  const refreshToken = session && typeof session === "object" ? (session as { refreshToken?: unknown }).refreshToken : undefined;
  return check({ clientId: opts.clientId, certId, refreshToken });
}
