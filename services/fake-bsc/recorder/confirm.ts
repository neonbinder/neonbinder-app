/**
 * The recorder's "are you sure" before it sends anything to real BSC. Asked
 * on the terminal itself (`/dev/tty`), because stdin carries the piped
 * Bitwarden item. Only the word "yes" confirms.
 */
import { openSync, closeSync } from "node:fs";
import { createInterface } from "node:readline";
import { ReadStream, WriteStream } from "node:tty";
import type { Readable, Writable } from "node:stream";

export async function askYes(input: Readable, output: Writable, question: string): Promise<boolean> {
  const rl = createInterface({ input, output, terminal: false });
  try {
    const answer = await new Promise<string | null>((resolve) => {
      rl.once("close", () => resolve(null));
      rl.question(question, resolve);
    });
    return typeof answer === "string" && answer.trim().toLowerCase() === "yes";
  } finally {
    rl.close();
  }
}

/** Asks on the controlling terminal. Throws when there is none: use `--yes`. */
export async function askOnTerminal(question: string): Promise<boolean> {
  let fd: number;
  try {
    fd = openSync("/dev/tty", "r+");
  } catch {
    throw new Error("no terminal to confirm on: run it from a terminal, or pass --yes");
  }
  const input = new ReadStream(fd);
  const output = new WriteStream(fd);
  try {
    return await askYes(input, output, question);
  } finally {
    input.destroy();
    output.destroy();
    try {
      closeSync(fd);
    } catch {
      // already closed by the streams
    }
  }
}
