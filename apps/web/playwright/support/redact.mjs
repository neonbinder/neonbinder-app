// What the suite writes about a run (a red spec's console lines, a retried
// spec's first error) lands in PUBLIC artifacts and the run summary. This is
// the one scrubber for that text: it drops what could carry a secret and keeps
// what a reader needs to see what happened.
//
// - every URL's query string and fragment (Clerk FAPI calls carry the testing
//   token as `__clerk_testing_token=`; signed photo-store and storage
//   addresses carry their signature), the path kept;
// - `name=value` / `name: value` pairs whose name says secret (token, secret,
//   key, ticket, session, auth, password, signature, credential, cookie, jwt);
// - `Bearer <x>` and `Basic <x>`;
// - a Convex deployment's host (`<slug>.convex.cloud` / `.convex.site`): the
//   slug names a deployment, which the public repo never carries;
// - an email address (a test account's, or a fake BuySportsCards sign-in);
// - anything shaped like a JWT (`eyJ…`.`…`.`…`);
// - any unbroken run of 32 or more token characters that mixes letters and
//   digits (keys, hashes, opaque ids), unless it reads as lowercase words
//   joined by hyphens (a spec's file name).
//
// Plain .mjs (JSDoc types) so the flaky reporter (./flaky-reporter.mjs) and the
// TypeScript fixtures share it. Tested in scripts/flaky-reporter.test.mjs.

const URL_QUERY = /\b((?:https?|wss?):\/\/[^\s?#"'<>`)]+)[?#][^\s"'<>`)]*/gi;
const SECRET_PAIR =
  /\b([\w.-]*(?:token|secret|key|ticket|session|auth|passw(?:or)?d|signature|credential|cookie|jwt)[\w.-]*)(["']?\s*[:=]\s*["']?)[^\s"',;&)}\]]+/gi;
const SCHEME = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/g;
const CONVEX_HOST = /\b[a-z0-9-]+\.convex\.(cloud|site)\b/gi;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const JWT = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g;
const LONG_RUN = /[A-Za-z0-9_+=-]{32,}/g;
const WORDS = /^[a-z0-9]{1,16}(?:-[a-z0-9]{1,16})+$/;

/** @param {string} run */
function opaque(run) {
  return /\d/.test(run) && /[A-Za-z]/.test(run) && !WORDS.test(run);
}

/**
 * One line (or a block) with every secret-shaped part replaced.
 * @param {string} text
 * @returns {string}
 */
export function redact(text) {
  return String(text)
    .replace(URL_QUERY, "$1?[query removed]")
    .replace(CONVEX_HOST, "<deployment>.convex.$1")
    .replace(EMAIL, "[email removed]")
    .replace(JWT, "[jwt removed]")
    .replace(SCHEME, "$1 [removed]")
    .replace(SECRET_PAIR, "$1$2[removed]")
    .replace(LONG_RUN, (run) => (opaque(run) ? "[long token removed]" : run));
}

/** Terminal colour codes, which Playwright's error messages carry. */
const ANSI = /\u001b\[[0-9;]*m/g;

/**
 * @param {string} text
 * @returns {string}
 */
export function stripAnsi(text) {
  return String(text).replace(ANSI, "");
}
