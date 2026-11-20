import * as Sentry from "@sentry/react";
import { scrubUrlSecrets } from "./scrub-url-secrets";

/**
 * Where a caught error is reported from, and which step of it failed. Both are
 * fixed strings written at the call site, never derived from data, so they are
 * safe as tags and as the fingerprint.
 */
export type CaughtErrorContext = {
  feature: string;
  step: string;
};

/** Longest client-origin message sent. A browser-side message is short; this is a guard. */
const CLIENT_MESSAGE_CAP = 300;

/** A Convex server error's marker: `[Request ID: 1a2b3c]`. */
const REQUEST_ID = /\[Request ID: ([A-Za-z0-9_-]{1,64})\]/;
/** The function a Convex client error names: `[CONVEX M(module:function)]`. */
const FUNCTION_PATH = /\[CONVEX [A-Z]\(([\w./:-]{1,120})\)\]/;
/**
 * The prefix the Convex client puts on every server-returned failure
 * (createHybridErrorStacktrace), request id or not. Matched loosely on purpose:
 * a path that fails FUNCTION_PATH's shape is still server text.
 */
const CONVEX_PREFIX = /\[CONVEX [A-Z]\(/;
/**
 * Where Convex's value-conversion errors start quoting the call's args
 * (`... (present at path .x in original object {...})`, values/value.js).
 */
const ARGS_QUOTE_MARKERS = [" (present at path", " in original object"];
/**
 * An unsupported-type error leads with the offending value itself:
 * `Map[["k","v"]] is not a supported Convex type`. Keep the type word only.
 */
const UNSUPPORTED_TYPE = /^([A-Za-z_$][\w$]*)[\s\S]*? is not a supported Convex type/;

/** A client message with anything quoted from the call's args cut off. */
function withoutQuotedArgs(raw: string): string {
  let end = raw.length;
  for (const marker of ARGS_QUOTE_MARKERS) {
    const at = raw.indexOf(marker);
    if (at !== -1 && at < end) end = at;
  }
  let cut = raw.slice(0, end);
  cut = cut.replace(UNSUPPORTED_TYPE, (_m, type: string) => `${type} is not a supported Convex type`);
  return cut;
}

function nameOf(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const { name } = error as { name?: unknown };
    if (typeof name === "string" && /^[\w$.-]{1,60}$/.test(name)) return name;
    return "Error";
  }
  return "NonError";
}

function messageOf(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const { message } = error as { message?: unknown };
    return typeof message === "string" ? message : "";
  }
  return typeof error === "string" ? error : "";
}

/** A ConvexError carries a non-null `.data`; only a server can have sent one. */
function hasServerData(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { data?: unknown }).data != null;
}

/** A ConvexError's structured `code`, read without `instanceof` (see BaseMappingForm). */
function codeOf(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const data = (error as { data?: unknown }).data;
  if (typeof data !== "object" || data === null) return null;
  const { code } = data as { code?: unknown };
  return typeof code === "string" && /^[\w.-]{1,60}$/.test(code) ? code : null;
}

/**
 * Report an error a catch block swallowed behind fixed on-screen copy, so the
 * failure still reaches Sentry (NEO-625: Reconcile Inserts Save failed on
 * production and nothing was logged anywhere).
 *
 * Two origins. Detection fails closed: anything that looks like it came back
 * from Convex is server-origin, so unknown text is never sent:
 * - Server-origin (the `[CONVEX M(fn)]` prefix the client puts on every
 *   server-returned failure, the `[Request ID: x]` marker, or a ConvexError's
 *   `.data`): the message can carry a marketplace URL, a response body or a
 *   credential hint (NEO-211 F3), so only the error name, the function path,
 *   the request id (when present) and the `errorCode` go. The detail stays in
 *   the Convex logs, found by the request id.
 * - Client-origin (none of those: it never left the browser, such as a
 *   validator refusing an argument): the message is what says what broke, but
 *   Convex's value-conversion errors quote the call's args, so the message is
 *   cut at the first quote of them, then URL-scrubbed and capped.
 *
 * Never takes or attaches the call's args or items. The fingerprint is
 * [feature, step, origin, name], so one failing step is one issue however many
 * operators hit it, and each message does not become its own issue.
 *
 * Reports through the SDK that src/sentry.ts started; under E2E (no init) the
 * SDK drops it. Never throws: a reporting failure must not break the catch it
 * sits in.
 */
export function reportCaughtError(error: unknown, { feature, step }: CaughtErrorContext): void {
  try {
    const name = nameOf(error);
    const raw = messageOf(error);
    const requestId = REQUEST_ID.exec(raw)?.[1] ?? null;
    const isServer = requestId !== null || CONVEX_PREFIX.test(raw) || hasServerData(error);
    const origin = isServer ? "server" : "client";
    const errorCode = codeOf(error);

    let message: string;
    if (isServer) {
      const functionPath = FUNCTION_PATH.exec(raw)?.[1];
      message = functionPath ? `${name} from ${functionPath}` : name;
    } else {
      message = String(scrubUrlSecrets(withoutQuotedArgs(raw))).slice(0, CLIENT_MESSAGE_CAP) || name;
    }

    // A fresh error, not the caught one: its message is what was just decided.
    const safe = new Error(message);
    safe.name = name;

    Sentry.captureException(safe, {
      level: "error",
      tags: {
        feature,
        step,
        origin,
        ...(requestId ? { request_id: requestId } : {}),
        ...(errorCode ? { error_code: errorCode } : {}),
      },
      fingerprint: [feature, step, origin, name],
    });
  } catch {
    // Reporting is best effort.
  }
}
