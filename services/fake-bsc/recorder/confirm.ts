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

/** True only when the answer is exactly `expected` (the production capture's typed SKU). */
export async function askToType(input: Readable, output: Writable, question: string, expected: string): Promise<boolean> {
  const rl = createInterface({ input, output, terminal: false });
  try {
    const answer = await new Promise<string | null>((resolve) => {
      rl.once("close", () => resolve(null));
      rl.question(question, resolve);
    });
    return typeof answer === "string" && answer.trim() === expected;
  } finally {
    rl.close();
  }
}

/** Opens the controlling terminal; tests pass one that throws, as a run with no terminal does. */
export type TerminalOpener = () => number;
const openTty: TerminalOpener = () => openSync("/dev/tty", "r+");

/** Asks on the controlling terminal for `expected` typed back. Throws when there is no terminal. */
export async function typeOnTerminal(question: string, expected: string, openTerminal: TerminalOpener = openTty): Promise<boolean> {
  return withTerminal(openTerminal, "no terminal to confirm on: run it from a terminal", (input, output) => askToType(input, output, question, expected));
}

/** Asks on the controlling terminal. Throws when there is none: use `--yes`. */
export async function askOnTerminal(question: string, openTerminal: TerminalOpener = openTty): Promise<boolean> {
  return withTerminal(openTerminal, "no terminal to confirm on: run it from a terminal, or pass --yes", (input, output) => askYes(input, output, question));
}

async function withTerminal<T>(openTerminal: TerminalOpener, noTerminal: string, fn: (input: Readable, output: Writable) => Promise<T>): Promise<T> {
  let fd: number;
  try {
    fd = openTerminal();
  } catch {
    throw new Error(noTerminal);
  }
  const input = new ReadStream(fd);
  const output = new WriteStream(fd);
  try {
    return await fn(input, output);
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
