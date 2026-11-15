/**
 * BSC credentials for one recorder run: from stdin (the documented way is
 * piping `bw get item <id>`), or typed at a prompt. Never from arguments,
 * environment variables or files. Held in memory for the sign-in only.
 */
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";

export interface BscCredentials {
  username: string;
  password: string;
}

const MAX_STDIN_BYTES = 64 * 1024;

export async function readAll(stream: Readable, max = MAX_STDIN_BYTES): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += b.length;
    if (size > max) throw new Error("stdin is larger than a credential item");
    chunks.push(b);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Reads a Bitwarden item (`{"login": {"username", "password"}}`), a plain
 * `{"username", "password"}` object, or two lines (username, then password).
 * The error never quotes the input.
 */
export function parseCredentials(text: string): BscCredentials {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    let v: unknown;
    try {
      v = JSON.parse(trimmed);
    } catch {
      throw new Error("stdin is not valid JSON");
    }
    const o = (v ?? {}) as Record<string, unknown>;
    const src = o.login && typeof o.login === "object" ? (o.login as Record<string, unknown>) : o;
    if (typeof src.username === "string" && typeof src.password === "string" && src.username && src.password) {
      return { username: src.username, password: src.password };
    }
    throw new Error("stdin JSON has no login.username and login.password");
  }
  const lines = trimmed.split(/\r?\n/);
  if (lines.length === 2 && lines[0] && lines[1]) return { username: lines[0].trim(), password: lines[1] };
  throw new Error("stdin must be a Bitwarden item (bw get item <id>) or two lines: username, password");
}

/** Prompts on a terminal; the password is not echoed. */
export async function promptCredentials(input: Readable, output: Writable): Promise<BscCredentials> {
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
        resolve(answer);
      });
      if (hidden) r._writeToOutput = () => undefined;
    });
  try {
    const username = (await ask("BSC username: ", false)).trim();
    const password = await ask("BSC password: ", true);
    if (!username || !password) throw new Error("username and password are required");
    return { username, password };
  } finally {
    rl.close();
  }
}

export async function readCredentials(stdin: Readable & { isTTY?: boolean }, stderr: Writable): Promise<BscCredentials> {
  if (stdin.isTTY) return promptCredentials(stdin, stderr);
  return parseCredentials(await readAll(stdin));
}
