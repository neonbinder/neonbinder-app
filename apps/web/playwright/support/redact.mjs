// What the suite and CI write about a run (a red spec's console lines, a retried
// spec's first error, the Convex function logs, the latency probe) lands in
// PUBLIC artifacts and the run summary. This is the ONE scrubber for all of it:
// `.github/scripts/redact-ci-log.sh` is a wrapper around `redact-cli.mjs`, which
// calls `redact` here, so the suite and CI cannot drift apart. It drops what could
// carry a secret or name private infrastructure and keeps what a reader needs to
// see what happened (function names, timings, review_gate_timing lines).
//
// - every URL's query string and fragment (Clerk FAPI calls carry the testing
//   token as `__clerk_testing_token=`; signed photo-store and storage
//   addresses carry their signature), the path kept;
// - object-store hosts (R2, S3, GCS, Azure blob, Spaces, B2, Vercel blob), a
//   path-style bucket segment, `gs://` `s3://` `r2://` buckets, and bucket
//   names in `bucket=x` / `"bucket":"x"` / `R2_BUCKET=x` / `bucket "x"` forms;
// - 32-hex account ids;
// - `name=value` / `name: value` pairs whose name says secret (token, secret,
//   key, ticket, session, auth, password, signature, credential, cookie, jwt);
//   `name:value` with no space is left alone, because Convex function names
//   (`auth:getSession`) look like that;
// - `Bearer <x>` and `Basic <x>`;
// - Convex (`.convex.cloud` / `.convex.site`), Vercel (`.vercel.app`) and
//   Cloud Run (`.run.app`) hosts, Convex deployment ids (`dev:happy-animal-1`)
//   and `"deployment":"..."` values;
// - an email address (a test account's, or a fake BuySportsCards sign-in);
// - anything shaped like a JWT (`eyJ...`.`...`.`...`);
// - any unbroken run of 32 or more token characters that mixes letters and
//   digits (keys, hashes, opaque ids), unless it reads as lowercase words
//   joined by hyphens (a spec's file name).
//
// Replacements hold no quote or backslash, and every rule skips text that is
// already a marker, so a masked line stays valid JSON where it was and
// `redact(redact(x)) === redact(x)`.
//
// Plain .mjs (JSDoc types) so the flaky reporter (./flaky-reporter.mjs) and the
// TypeScript fixtures share it. Tested in scripts/flaky-reporter.test.mjs.

// Already-masked text: `[...]` markers and `<...>` markers are never re-masked.
const MARKED = String.raw`(?!\[[a-z ]+\]|<[a-z0-9-]+>|(?:Bearer|Basic) \[removed\])`;

const URL_QUERY = /\b((?:https?|wss?):\/\/[^\s?#"'<>`)\\]+)[?#](?!\[query removed\])[^\s"'<>`)\\]*/gi;
// A scheme-less address (`/v1/client?__clerk_testing_token=...`).
const PATH_QUERY = /(\/[\w.~%+/-]*)\?(?=[\w.-]+=)[^\s"'<>`)\\]*/g;
const STORAGE_PATH_BUCKET =
  /(storage\.googleapis\.com|s3[A-Za-z0-9.-]*\.amazonaws\.com|r2\.cloudflarestorage\.com)\/(?!<)[^/"'\\\s?#]+/gi;
const STORAGE_HOST =
  /[A-Za-z0-9._-]+\.(?:r2\.cloudflarestorage\.com|r2\.dev|s3[A-Za-z0-9.-]*\.amazonaws\.com|storage\.googleapis\.com|digitaloceanspaces\.com|backblazeb2\.com|blob\.core\.windows\.net|public\.blob\.vercel-storage\.com)\b/gi;
const BUCKET_URI = /\b(?:r2|s3|gs):\/\/(?!<)[^/"'\\\s]+/gi;
// "bucket":"x"  \"bucketName\":\"x\"  Bucket=x  R2_BUCKET=x
const BUCKET_PAIR =
  /([A-Za-z0-9_]*bucket[A-Za-z0-9_]*(?:\\?")?\s*[:=]\s*(?:\\?")?)[A-Za-z0-9][A-Za-z0-9._-]*/gi;
// bucket "x"  bucket name `x`
const BUCKET_QUOTED = /(\bbucket (?:name )?\\?["'`])[^"'`\\\s<]+/gi;
const HEX32 = /(?<![0-9A-Za-z])[0-9a-f]{32}(?![0-9A-Za-z])/g;
const DEPLOYMENT_VALUE = /(\bdeployment[A-Za-z]*\\?"\s*:\s*\\?")(?!<)[^"\\]+/gi;
const DEPLOYMENT_ID = /\b(?:dev|prod|preview):[a-z]+-[a-z]+-[0-9]+\b/g;
const CONVEX_HOST = /\b[a-z0-9-]+\.convex\.(cloud|site)\b/gi;
const VERCEL_HOST = /\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.vercel\.app\b/gi;
const RUN_HOST = /\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.run\.app\b/gi;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const SCHEME = new RegExp(String.raw`\b(Bearer|Basic)\s+${MARKED}[A-Za-z0-9._~+/=-]+`, "g");
// name, then `=` (anything after) or `:` (only when a space or quote follows), then
// the value: up to the closing quote when quoted, else up to a delimiter.
const SECRET_PAIR = new RegExp(
  String.raw`\b([\w.-]*(?:token|secret|key|ticket|session|auth|passw(?:or)?d|signature|credential|cookie|jwt)[\w.-]*)` +
    String.raw`(\\?["']?\s*(?:=\s*|:(?=\s|\\?["']|(?<=["']\s*:)\d)\s*)\\?["']?)` +
    String.raw`${MARKED}(?:(?<=\\["'])[^"'\\]+|(?<=")(?:[^"\\]|\\.)+|(?<=')(?:[^'\\]|\\.)+|[^\s"',;&)}\]\\]+)`,
  "gi",
);
const JWT = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g;
const LONG_RUN = /[A-Za-z0-9_+=-]{32,}/g;
const WORDS = /^[a-z0-9]{1,16}(?:-[a-z0-9]{1,16})+$/;

/** @param {string} run */
function opaque(run) {
  return /\d/.test(run) && /[A-Za-z]/.test(run) && !WORDS.test(run);
}

/**
 * Literal strings to mask wherever they appear (this run's own Convex preview
 * deployment name). Entries under 4 characters are ignored; longest first so a
 * name containing another is masked whole.
 * @param {string} text
 * @param {readonly string[]} literals
 * @returns {string}
 */
export function redactLiterals(text, literals) {
  const list = literals.filter((l) => l.length >= 4).sort((a, b) => b.length - a.length);
  let out = String(text);
  for (const l of list) out = out.split(l).join("<redacted>");
  return out;
}

/**
 * One line (or a block) with every secret-shaped part replaced.
 * @param {string} text
 * @returns {string}
 */
export function redact(text) {
  return String(text)
    .replace(STORAGE_PATH_BUCKET, "$1/<bucket>")
    .replace(STORAGE_HOST, "<storage-host>")
    .replace(BUCKET_URI, "<bucket-uri>")
    .replace(BUCKET_PAIR, "$1<bucket>")
    .replace(BUCKET_QUOTED, "$1<bucket>")
    .replace(HEX32, "<hex32>")
    .replace(DEPLOYMENT_VALUE, "$1<convex-deployment>")
    .replace(URL_QUERY, "$1?[query removed]")
    .replace(PATH_QUERY, "$1?[query removed]")
    .replace(CONVEX_HOST, "<deployment>.convex.$1")
    .replace(VERCEL_HOST, "<preview-host>")
    .replace(RUN_HOST, "<run-host>")
    .replace(DEPLOYMENT_ID, "<convex-deployment>")
    .replace(EMAIL, "[email removed]")
    .replace(SCHEME, "$1 [removed]")
    .replace(SECRET_PAIR, "$1$2[removed]")
    .replace(JWT, "[jwt removed]")
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
