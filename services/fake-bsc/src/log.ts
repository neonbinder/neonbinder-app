/**
 * One JSON line per event: platform, operation and timing. Never a token, a
 * key, a password or a request or response body.
 */
export type LogFields = Record<string, string | number | boolean | null | undefined>;

let sink: (line: string) => void = (line) => console.log(line);

export function setLogSink(fn: (line: string) => void): void {
  sink = fn;
}

export function log(operation: string, fields: LogFields = {}): void {
  sink(JSON.stringify({ platform: "fake-bsc", operation, ts: new Date().toISOString(), ...fields }));
}
