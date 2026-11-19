import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  EBAY_SCOPES,
  FAKE_EBAY_CLIENT_ID,
  FAKE_EBAY_RU_NAME,
  __resetEbayFakeLogThrottle,
  ebayAuthorizeUrl,
  ebayConfig,
  ebayConfigured,
  ebayHasPictureUpload,
  ebaySellerConflictsEnforced,
  ebayTargetMode,
  fakeEbayRequested,
} from "./ebayEnv";

function setEnv(env: Partial<Record<string, string>>) {
  vi.stubEnv("EBAY_CLIENT_ID", env.EBAY_CLIENT_ID ?? "");
  vi.stubEnv("EBAY_RU_NAME", env.EBAY_RU_NAME ?? "");
  vi.stubEnv("EBAY_ENVIRONMENT", env.EBAY_ENVIRONMENT ?? "");
  vi.stubEnv("TESTING_RESET_SECRET", env.TESTING_RESET_SECRET ?? "");
}

afterEach(() => vi.unstubAllEnvs());

describe("ebayConfig (NEO-415)", () => {
  test("is null when nothing is set", () => {
    setEnv({});
    expect(ebayConfig()).toBeNull();
    expect(ebayConfigured()).toBe(false);
  });

  test("sandbox env picks the sandbox hosts", () => {
    setEnv({ EBAY_CLIENT_ID: "cid", EBAY_RU_NAME: "ru", EBAY_ENVIRONMENT: "sandbox" });
    expect(ebayConfig()).toEqual({
      clientId: "cid",
      ruName: "ru",
      environment: "sandbox",
      apiBase: "https://api.sandbox.ebay.com",
      mediaBase: "https://apim.sandbox.ebay.com",
      authBase: "https://auth.sandbox.ebay.com",
      webBase: "https://www.sandbox.ebay.com",
    });
    expect(ebayConfigured()).toBe(true);
  });

  test("production env picks the production hosts", () => {
    setEnv({ EBAY_CLIENT_ID: "cid", EBAY_RU_NAME: "ru", EBAY_ENVIRONMENT: "production" });
    expect(ebayConfig()?.apiBase).toBe("https://api.ebay.com");
    expect(ebayConfig()?.authBase).toBe("https://auth.ebay.com");
  });

  test("an unknown environment is not configured", () => {
    setEnv({ EBAY_CLIENT_ID: "cid", EBAY_RU_NAME: "ru", EBAY_ENVIRONMENT: "staging" });
    expect(ebayConfig()).toBeNull();
  });

  test("a missing id or RuName is not configured, and whitespace counts as unset", () => {
    setEnv({ EBAY_CLIENT_ID: "  ", EBAY_RU_NAME: "ru", EBAY_ENVIRONMENT: "sandbox" });
    expect(ebayConfig()).toBeNull();
    setEnv({ EBAY_CLIENT_ID: "cid", EBAY_ENVIRONMENT: "sandbox" });
    expect(ebayConfig()).toBeNull();
  });
});

describe("ebayAuthorizeUrl (NEO-415)", () => {
  test("carries client id, RuName, code response, every scope and the state", () => {
    setEnv({ EBAY_CLIENT_ID: "cid", EBAY_RU_NAME: "ru", EBAY_ENVIRONMENT: "sandbox" });
    const url = new URL(ebayAuthorizeUrl(ebayConfig()!, "nonce-1"));
    expect(url.origin + url.pathname).toBe("https://auth.sandbox.ebay.com/oauth2/authorize");
    expect(url.searchParams.get("client_id")).toBe("cid");
    expect(url.searchParams.get("redirect_uri")).toBe("ru");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("state")).toBe("nonce-1");
    expect(url.searchParams.get("scope")?.split(" ")).toEqual([...EBAY_SCOPES]);
  });
});

describe("ebaySellerConflictsEnforced (NEO-415)", () => {
  test("enforced in production even with a testing secret", () => {
    setEnv({ EBAY_CLIENT_ID: "c", EBAY_RU_NAME: "r", EBAY_ENVIRONMENT: "production", TESTING_RESET_SECRET: "s" });
    expect(ebaySellerConflictsEnforced()).toBe(true);
  });

  test("enforced on a sandbox without a testing secret", () => {
    setEnv({ EBAY_CLIENT_ID: "c", EBAY_RU_NAME: "r", EBAY_ENVIRONMENT: "sandbox" });
    expect(ebaySellerConflictsEnforced()).toBe(true);
  });

  test("relaxed only on a testing deployment on the sandbox", () => {
    setEnv({ EBAY_CLIENT_ID: "c", EBAY_RU_NAME: "r", EBAY_ENVIRONMENT: "sandbox", TESTING_RESET_SECRET: "s" });
    expect(ebaySellerConflictsEnforced()).toBe(false);
  });
});

describe("the fake eBay (NEO-555)", () => {
  const FAKE_ROOT = "https://neonbinder-fake-bsc-0000-uc.a.run.app";
  let errors: string[];

  /** A fully wired fake-mode deployment, then `over` on top (a "" unsets). */
  function fakeEnv(over: Partial<Record<string, string>> = {}) {
    const env: Record<string, string> = {
      EBAY_ENVIRONMENT: "fake",
      EBAY_CLIENT_ID: "",
      EBAY_RU_NAME: "",
      TESTING_RESET_SECRET: "armed",
      NEONBINDER_BSC_API_BASE: FAKE_ROOT,
      NEONBINDER_FAKE_BSC_KEY: "caller-key",
      ...over,
    };
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  }

  beforeEach(() => {
    __resetEbayFakeLogThrottle();
    errors = [];
    vi.spyOn(console, "error").mockImplementation((line: unknown) => {
      errors.push(String(line));
    });
  });
  afterEach(() => vi.restoreAllMocks());

  test("a wired deployment points apiBase and mediaBase at the fake and uses its public constants", () => {
    fakeEnv();
    expect(ebayConfig()).toEqual({
      clientId: FAKE_EBAY_CLIENT_ID,
      ruName: FAKE_EBAY_RU_NAME,
      environment: "fake",
      apiBase: `${FAKE_ROOT}/ebay/api`,
      mediaBase: `${FAKE_ROOT}/ebay/apim`,
      authBase: "",
      webBase: "https://www.ebay.com",
    });
    expect(ebayConfigured()).toBe(true);
    expect(errors).toEqual([]);
  });

  test("EBAY_CLIENT_ID and EBAY_RU_NAME are ignored in fake mode", () => {
    fakeEnv({ EBAY_CLIENT_ID: "real-client", EBAY_RU_NAME: "real-ru" });
    expect(ebayConfig()).toMatchObject({ clientId: FAKE_EBAY_CLIENT_ID, ruName: FAKE_EBAY_RU_NAME });
  });

  test("the fake uploads pictures (it is not the sandbox)", () => {
    fakeEnv();
    expect(ebayHasPictureUpload(ebayConfig()!)).toBe(true);
  });

  test("the consent URL is the relative testing page with the same params and the bare nonce", () => {
    fakeEnv();
    const url = ebayAuthorizeUrl(ebayConfig()!, "nonce-9");
    expect(url.startsWith("/testing/fake-ebay/authorize?")).toBe(true);
    const params = new URL(url, "https://x.invalid").searchParams;
    expect(params.get("client_id")).toBe(FAKE_EBAY_CLIENT_ID);
    expect(params.get("redirect_uri")).toBe(FAKE_EBAY_RU_NAME);
    expect(params.get("response_type")).toBe("code");
    expect(params.get("state")).toBe("nonce-9");
    expect(params.get("scope")?.split(" ")).toEqual([...EBAY_SCOPES]);
  });

  test("seller conflicts stay enforced in fake mode", () => {
    fakeEnv();
    expect(ebaySellerConflictsEnforced()).toBe(true);
  });

  // The rule: unusable fake settings are "not configured", loudly, and never
  // another eBay, even with a full sandbox or production wiring present.
  test.each([
    ["no testing flag (a production deployment)", { TESTING_RESET_SECRET: "" }, "not_a_test_deployment"],
    ["no fake BSC base (the BSC is real)", { NEONBINDER_BSC_API_BASE: "" }, "bsc_target_not_fake"],
    ["a base that is not the fake's host", { NEONBINDER_BSC_API_BASE: "https://example.com" }, "fake_target_misconfigured"],
    ["a base over http", { NEONBINDER_BSC_API_BASE: "http://neonbinder-fake-bsc-0000-uc.a.run.app" }, "fake_target_misconfigured"],
    ["no caller key", { NEONBINDER_FAKE_BSC_KEY: "" }, "fake_target_misconfigured"],
  ])("%s: not configured, logged, never the sandbox or production", (_name, over, reason) => {
    fakeEnv({ EBAY_CLIENT_ID: "cid", EBAY_RU_NAME: "ru", ...over });
    expect(ebayConfig()).toBeNull();
    expect(ebayConfigured()).toBe(false);
    expect(ebayTargetMode()).toBe("unconfigured");
    const logged = errors.map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ msg: "ebay_fake_misconfigured", platform: "ebay", reason, outcome: "not_configured" });
    // Platform and reason only: no key, URL or env value.
    expect(errors.join("")).not.toMatch(/caller-key|cid|example\.com|a\.run\.app/);
  });

  test("the misconfiguration log repeats at most once a minute per reason", () => {
    fakeEnv({ TESTING_RESET_SECRET: "" });
    ebayConfig();
    ebayConfig();
    ebayConfig();
    expect(errors).toHaveLength(1);
    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.now() + 61_000);
      ebayConfig();
    } finally {
      vi.useRealTimers();
    }
    expect(errors).toHaveLength(2);
  });

  test("only the exact word fake asks for it", () => {
    fakeEnv({ EBAY_ENVIRONMENT: "Fake" });
    expect(fakeEbayRequested()).toBe(false);
    expect(ebayConfig()).toBeNull();
    fakeEnv({ EBAY_ENVIRONMENT: " fake " });
    expect(fakeEbayRequested()).toBe(true);
    fakeEnv({ EBAY_ENVIRONMENT: "sandbox" });
    expect(fakeEbayRequested()).toBe(false);
    fakeEnv({ EBAY_ENVIRONMENT: "" });
    expect(fakeEbayRequested()).toBe(false);
  });

  test("ebayTargetMode names each of the four answers", () => {
    fakeEnv();
    expect(ebayTargetMode()).toBe("fake");
    fakeEnv({ EBAY_ENVIRONMENT: "sandbox", EBAY_CLIENT_ID: "c", EBAY_RU_NAME: "r" });
    expect(ebayTargetMode()).toBe("sandbox");
    fakeEnv({ EBAY_ENVIRONMENT: "production", EBAY_CLIENT_ID: "c", EBAY_RU_NAME: "r" });
    expect(ebayTargetMode()).toBe("production");
    fakeEnv({ EBAY_ENVIRONMENT: "" });
    expect(ebayTargetMode()).toBe("unconfigured");
  });

  test("a sandbox or production deployment is unchanged by the fake's variables", () => {
    fakeEnv({ EBAY_ENVIRONMENT: "sandbox", EBAY_CLIENT_ID: "cid", EBAY_RU_NAME: "ru" });
    expect(ebayConfig()).toMatchObject({ environment: "sandbox", clientId: "cid", apiBase: "https://api.sandbox.ebay.com" });
    fakeEnv({ EBAY_ENVIRONMENT: "production", EBAY_CLIENT_ID: "cid", EBAY_RU_NAME: "ru" });
    expect(ebayConfig()).toMatchObject({ environment: "production", apiBase: "https://api.ebay.com" });
  });
});
