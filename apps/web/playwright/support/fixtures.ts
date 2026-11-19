/**
 * The `test` every idiomatic spec imports (never import `test` from
 * @playwright/test directly).
 *
 * Fixtures:
 *   env    — the per-test variables the Maestro runners pass with `-e`
 *            (WORKER_INDEX, WORKER_KEY, ATTEMPT_ID/ATTEMPT_TOKEN,
 *            TEST_USERNAME, PAUSED_PLATFORMS, SL_PAUSED), minted per
 *            project so the desktop and mobile runs never share a name.
 *            Shared with the first port: ./env.ts.
 *   signIn — opens the per-flow Clerk handshake the Maestro flows enter
 *            through (`url: /testing/sign-in?redirect=<R>&worker=<n>`) and
 *            returns once the browser is on its way to <R>. The caller then
 *            asserts the destination's heading (the launch gate).
 *
 *   bscFake — the worker's fake BuySportsCards account (NEO-552, ./bscFake.ts):
 *            `setFaults` / `addOrder` / `pollNow` / `clear`. Teardown clears the
 *            rules, both sites' (and the deployment's BSC call gate when a rule
 *            could have opened it).
 *   ebayFake — the worker's fake eBay seller (NEO-555, ./ebayFake.ts):
 *            `holdShippingPolicy` / `addOrder` / `pollNow` / `setFaults`. Its
 *            faults share `bscFake`'s list (one per worker) and its teardown.
 *
 * Harness fixtures no spec names (NEO-592):
 *   noRetryOnSharedAccounts — automatic. Refuses a retry of a `@bsc-breaker`
 *            spec (GUIDE hard rule 5): each such file says
 *            `test.describe.configure({ retries: 0 })`; this catches one that forgot.
 *   resetAfterFailure — automatic. After a test on `e2e` or `e2e-mobile` ends
 *            red, resets the worker's main account by the bootstrap's own route
 *            (./worker-reset.ts) before the worker's next test or retry. Bounded;
 *            its own failure is logged and attached, never thrown over the
 *            spec's error. On in CI; locally only with PW_FAILURE_RESET=1.
 *   captureConsole — an option, off by default: `test.use({ captureConsole: true })`
 *            keeps the page's console lines and attaches them, scrubbed
 *            (./redact.mjs), to a red result as `console`.
 *
 * Plus `expectAccessible(page, { within?, label? })`, the axe check (below),
 * and Playwright's own `isMobile` fixture for the rare genuine layout branch.
 *
 *   test("<Maestro name: verbatim>", { tag: ["@set-selector"] }, async ({ page, signIn }) => {
 *     await signIn("/set-selector");
 *     await expect(page.getByText("Build set parameters using marketplace APIs")).toBeVisible({ timeout: LAUNCH_GATE });
 *   });
 */
import { test as base, expect, type Browser, type BrowserContext, type Page, type TestInfo } from "@playwright/test";
import { BREAKER_TAG } from "../project-scope.mjs";
import { checkAccessibility, type AccessibleOptions } from "./a11y";
import { BscFake } from "./bscFake";
import { EbayFake } from "./ebayFake";
import { makeEnv, type FlowEnv } from "./env";
import { redact } from "./redact.mjs";
import { expectWorkerReset, WORKER_RESET_CAP_MS, WORKER_RESET_LAUNCH_MS, WORKER_RESET_REDIRECT } from "./worker-reset";

export type SignIn = (
  redirect: string,
  opts?: {
    /** A dedicated account key (`account=` in the flow url), e.g. "admin-no-credentials". */
    account?: string;
  },
) => Promise<void>;

/**
 * The sign-in URL exactly as the Maestro flows spell it. `redirect` is
 * passed through unencoded, nested `?` and `%26` included, because that is
 * what the flows send and what /testing/sign-in parses
 * (e.g. "/testing/reset?redirect=/testing/seed-credentials?redirect=/admin").
 */
export function signInUrl(redirect: string, worker: string, account?: string): string {
  const acct = account ? `&account=${account}` : "";
  return `/testing/sign-in?redirect=${redirect}${acct}&worker=${worker}`;
}

/**
 * The failure reset runs in CI by default (PW_FAILURE_RESET=0 turns it off) and
 * locally only on opt-in (PW_FAILURE_RESET=1). Locally a worker is often a user
 * other sessions share (shared dev, or a worker with its own TEST_EMAIL_<n> that CI
 * also signs in as), and the reset wipes that user's rows and re-saves its
 * marketplace sign-ins, which are keyed by the Clerk user, not the deployment.
 */
const FAILURE_RESET_ON = process.env.PW_FAILURE_RESET ? process.env.PW_FAILURE_RESET === "1" : !!process.env.CI;

/** The tags whose specs never retry (hard rule 5): the deployment-wide BSC call gate. */
const NO_RETRY_TAGS: ReadonlySet<string> = new Set([BREAKER_TAG]);

/** The reset's teardown: the page sent to about:blank, then its context closed (one UX budget each). */
const RESET_STEP_MS = 7_000;
const RESET_TEARDOWN_MS = 2 * RESET_STEP_MS;
/** Margin over the reset's own cap and teardown before the fixture's timeout fires. */
const RESET_HEADROOM_MS = 30_000;

export const test = base.extend<{
  env: FlowEnv;
  signIn: SignIn;
  bscFake: BscFake;
  ebayFake: EbayFake;
  captureConsole: boolean;
  consoleOnFailure: void;
  noRetryOnSharedAccounts: void;
  resetAfterFailure: void;
}>({
  env: async ({}, use, testInfo) => {
    // The project feeds the d/m marker in every minted name, and the retry the
    // attempt number (./env.ts).
    await use(makeEnv(testInfo.project.name, testInfo.retry));
  },
  // NEO-392: stamp every page with the run, worker and test, before the app
  // loads, so the app's E2E diagnostic events in PostHog can be filtered to
  // the one test that went red (lib/observability/e2e-diagnostics.ts).
  // Identifiers only: no URL, credential or test data goes on the window.
  context: async ({ context, env }, use, testInfo) => {
    await context.addInitScript((tags) => {
      (window as unknown as { __NB_E2E?: unknown }).__NB_E2E = tags;
    }, {
      run_id: process.env.GITHUB_RUN_ID ?? "local",
      run_attempt: process.env.GITHUB_RUN_ATTEMPT ?? "0",
      worker: env.WORKER_INDEX,
      project: testInfo.project.name,
      test: testInfo.titlePath.slice(1).join(" > "),
      file: testInfo.file.split("/playwright/").pop() ?? "",
      retry: testInfo.retry,
    });
    await use(context);
  },
  signIn: async ({ page, env }, use) => {
    await use(async (redirect, opts = {}) => {
      await page.goto(signInUrl(redirect, env.WORKER_INDEX, opts.account), {
        waitUntil: "domcontentloaded",
      });
    });
  },
  // NEO-552: faults and orders on the worker's own fake BuySportsCards account
  // (./bscFake.ts). Teardown clears the rules (and the deployment's BSC call
  // gate when a rule could have opened it), red or green, so a rule never
  // outlives its test. Depends on `context` only, so it tears down while the
  // context is still open and can use a page of its own. A test that never
  // calls it costs nothing: teardown sends nothing when nothing was set.
  bscFake: async ({ context }, use, testInfo) => {
    const fake = new BscFake(context, testInfo.tags, LAUNCH_GATE);
    await use(fake);
    await fake.teardown();
  },
  // NEO-555: the worker's own fake eBay seller (./ebayFake.ts). Its fault rules
  // live on `bscFake`'s list (the fake keeps one per worker for both sites), so
  // `bscFake`'s teardown drops them; this fixture has no teardown of its own.
  // Seller state (policies, listings, orders) stays on the fake until the
  // pass's reset: see ./ebayFake.ts.
  ebayFake: async ({ context, bscFake }, use) => {
    await use(new EbayFake(context, bscFake, LAUNCH_GATE));
  },
  // NEO-592, GUIDE hard rule 5: a `@bsc-breaker` spec opens the deployment-wide BSC
  // call gate, which the failure reset does not undo, so it never retries. (NEO-555
  // retired the other no-retry tag with the shared eBay sandbox seller: eBay is the
  // fake, one seller per test user.) Each such file says
  // `test.describe.configure({ retries: 0 })`; this refuses the retry of one that
  // forgot, before its body writes anything. Registered before `resetAfterFailure`,
  // so a refused retry is not followed by a second reset.
  noRetryOnSharedAccounts: [
    async ({}, use, testInfo) => {
      const tag = testInfo.tags.find((t) => NO_RETRY_TAGS.has(t));
      if (tag && testInfo.retry > 0) {
        throw new Error(
          `A ${tag} spec never retries (GUIDE hard rule 5): add \`test.describe.configure({ retries: 0 })\` to ${testInfo.file.split("/playwright/").pop()}.`,
        );
      }
      await use();
    },
    { auto: true },
  ],
  // NEO-592 (Jason, 2026-11-18): after a red test the worker's account is reset by
  // the bootstrap's own route, so the worker's next test, or the CI retry, starts
  // clean instead of inheriting the red spec's half-done writes (a copy left on a
  // shared Base row, a box, an open report). Harness only: no spec names it. Set
  // up before every fixture after it (it is registered first of the automatic ones
  // and depends on no page or context), so it is torn down last: the spec's own
  // afterEach, `bscFake`'s teardown and the red test's context close all finish
  // before it runs, and no write from the red page can land after the reset.
  // On in CI; locally only with PW_FAILURE_RESET=1 (FAILURE_RESET_ON, below).
  resetAfterFailure: [
    async ({ browser, baseURL, env }, use, testInfo) => {
      await use();
      if (!FAILURE_RESET_ON) return;
      if (!RESET_PROJECTS.has(testInfo.project.name)) return;
      if (testInfo.status === testInfo.expectedStatus) return;
      // Interrupted (a local Ctrl-C) or skipped: nothing ran to completion, nothing to undo.
      if (testInfo.status === "interrupted" || testInfo.status === "skipped") return;
      await resetWorkerAccount(browser, baseURL, env, testInfo);
    },
    // The reset gives itself up at WORKER_RESET_CAP_MS (resetWorkerAccount), then
    // blanks and closes its page; the fixture's timeout leaves room for both and a
    // margin, so the blank page is always reached before Playwright gives up on it.
    { auto: true, timeout: WORKER_RESET_CAP_MS + RESET_TEARDOWN_MS + RESET_HEADROOM_MS },
  ],
  // NEO-592: a red result carries the page's console, so the next red is readable
  // from its artifacts. Opt-in per file (`test.use({ captureConsole: true })`).
  captureConsole: [false, { option: true }],
  consoleOnFailure: [
    async ({ context, captureConsole }, use, testInfo) => {
      if (!captureConsole) {
        await use();
        return;
      }
      const lines: string[] = [];
      const keep = (line: string) => {
        lines.push(line);
        if (lines.length > CONSOLE_LINES) lines.shift();
      };
      const onConsole = (message: { type(): string; text(): string }) =>
        keep(`${new Date().toISOString()} ${message.type()}: ${message.text()}`);
      const onError = (error: { error(): Error }) =>
        keep(`${new Date().toISOString()} pageerror: ${error.error().message}`);
      context.on("console", onConsole);
      context.on("weberror", onError);
      await use();
      context.off("console", onConsole);
      context.off("weberror", onError);
      if (testInfo.status === testInfo.expectedStatus || lines.length === 0) return;
      // Scrubbed line by line: a Clerk call carries the testing token in its query,
      // a signed storage address its signature (./redact.mjs). Never raw.
      const body = lines.map((line) => redact(line).slice(0, CONSOLE_LINE_CHARS)).join("\n");
      await testInfo.attach("console", { body, contentType: "text/plain" });
    },
    { auto: true },
  ],
});

/** The console lines a red result keeps (the last ones), and how long each may be. */
const CONSOLE_LINES = 400;
const CONSOLE_LINE_CHARS = 1_000;

/** The spec projects. Never `setup` (the seed) or `bootstrap` (it IS the reset). */
const RESET_PROJECTS = new Set(["e2e", "e2e-mobile"]);

/**
 * The failure reset itself, on a page of its own in a context of its own (the red
 * test's page is closed by now, its screenshot and ARIA snapshot already taken).
 * Never throws: the spec's error stays the one the report shows. The outcome is a
 * `failure-reset` annotation (with its seconds) and, when it failed, an attachment
 * and a warning in the log.
 */
async function resetWorkerAccount(
  browser: Browser,
  baseURL: string | undefined,
  env: FlowEnv,
  testInfo: TestInfo,
): Promise<void> {
  const started = Date.now();
  const seconds = () => `${((Date.now() - started) / 1000).toFixed(1)} s`;
  let context: BrowserContext | undefined;
  let gaveUp = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const chain = (async () => {
      const opened = await browser.newContext({ baseURL, colorScheme: "dark" });
      if (gaveUp) {
        // The cap passed while the context opened: nobody else will close it.
        await opened.close().catch(() => {});
        throw new Error("gave up before the reset's page opened");
      }
      context = opened;
      const page = await opened.newPage();
      // The step budgets inside expectWorkerReset bound every wait but the first
      // navigation, which gets the launch gate.
      await page.goto(signInUrl(WORKER_RESET_REDIRECT, env.WORKER_INDEX), {
        waitUntil: "domcontentloaded",
        timeout: WORKER_RESET_LAUNCH_MS,
      });
      await expectWorkerReset(page, env);
    })();
    // The chain loses the race when the cap passes; its late rejection (its page
    // blanked and closed under it) is expected and has nowhere to go.
    chain.catch(() => {});
    const cap = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        gaveUp = true;
        reject(new Error(`the reset passed its cap of ${WORKER_RESET_CAP_MS / 1000} s (its summed step budgets)`));
      }, WORKER_RESET_CAP_MS);
    });
    await Promise.race([chain, cap]);
    testInfo.annotations.push({
      type: "failure-reset",
      description: `worker ${env.WORKER_INDEX}'s account reset and re-seeded after the red result, in ${seconds()}`,
    });
  } catch (error) {
    const message = redact(error instanceof Error ? error.message : String(error)).slice(0, 2_000);
    testInfo.annotations.push({
      type: "failure-reset",
      description: `FAILED after ${seconds()}: the worker's next test may inherit this one's state`,
    });
    await testInfo
      .attach("failure-reset", { body: `The reset after this red result failed after ${seconds()}:\n${message}`, contentType: "text/plain" })
      .catch(() => {});
    console.warn(`failure-reset: worker ${env.WORKER_INDEX}: ${message.split("\n")[0]}`);
  } finally {
    clearTimeout(timer);
    gaveUp = true;
    // Playwright screenshots every page of a red test as its context closes, and
    // this page shows the account's credentials: leave it blank first (hard rule 7).
    // A hung renderer can refuse the blank page, so close every page as well:
    // Playwright captures only pages still open when the context closes.
    if (context) {
      for (const page of context.pages()) {
        await page.goto("about:blank", { timeout: RESET_STEP_MS }).catch(() => {});
        await page.close().catch(() => {});
      }
      await context.close().catch(() => {});
    }
  }
}

export { expect };

/**
 * Fails the test if axe finds any WCAG 2.0/2.1/2.2 A or AA violation on the
 * page (or only `within` a region), listing each violated rule with the mode
 * (light or dark) it came from. It checks BOTH modes by flipping the OS
 * colour scheme, and ends with the OS dark; a page that cannot flip is
 * checked in the mode it is in and says so. A spec that saved an explicit
 * theme restores System before calling. Call it once
 * the screen or state is on show, i.e. right after the assertion that proves
 * it, at every new screen or state a spec reaches; it runs on both projects.
 * See ./a11y.ts and playwright/GUIDE.md, "Accessibility checks".
 *
 *   await expect(dialog.getByRole("heading", { name: "New Team" })).toBeVisible();
 *   await expectAccessible(page, { within: dialog, label: "New Team dialog" });
 */
export async function expectAccessible(page: Page, opts: AccessibleOptions = {}): Promise<void> {
  const label = opts.label ?? new URL(page.url()).pathname;

  await test.step(`accessibility: ${label}`, () => checkAccessibility(page, test.info(), opts), { box: true });
}

/**
 * Explicit long budgets, named for WHY they exceed the 7 s UX budget. Use
 * one only where the Maestro flow states that timeout on that step; pass the
 * flow's own number inline if it differs from these.
 */
export const LAUNCH_GATE = 45_000; // cold launch + Clerk handshake (README "Launching a flow")
