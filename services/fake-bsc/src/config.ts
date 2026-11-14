/**
 * The fake's configuration, read once at boot. Fails closed: a missing key or
 * caller list stops the process rather than serving an open fake.
 */

export interface FakeConfig {
  port: number;
  callerKey: string;
  adminKey: string;
  allowedCallers: ReadonlySet<string>;
  adminCallers: ReadonlySet<string>;
  /** The service URL an ID token's `aud` must name. Needed for signed tokens. */
  audience: string | null;
  /** Skips the ID-token check (keys still required). Never on Cloud Run. */
  localDevBypass: boolean;
  /** True on Cloud Run (`K_SERVICE` set). */
  onCloudRun: boolean;
  store: { kind: "gcs"; bucket: string } | { kind: "local"; dir: string } | { kind: "memory" };
  revision: string | null;
}

export class ConfigError extends Error {}

const MIN_KEY_LENGTH = 32;

function list(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): FakeConfig {
  const onCloudRun = !!env.K_SERVICE;
  const bypassRaw = env.FAKE_BSC_LOCAL_DEV_BYPASS;
  const localDevBypass = bypassRaw === "1" || bypassRaw === "true";
  if (localDevBypass && onCloudRun) {
    throw new ConfigError("FAKE_BSC_LOCAL_DEV_BYPASS is set on Cloud Run (K_SERVICE): refusing to boot");
  }

  const callerKey = env.FAKE_BSC_CALLER_KEY ?? "";
  const adminKey = env.FAKE_BSC_ADMIN_KEY ?? "";
  if (callerKey.length < MIN_KEY_LENGTH) throw new ConfigError(`FAKE_BSC_CALLER_KEY must be at least ${MIN_KEY_LENGTH} characters`);
  if (adminKey.length < MIN_KEY_LENGTH) throw new ConfigError(`FAKE_BSC_ADMIN_KEY must be at least ${MIN_KEY_LENGTH} characters`);
  if (callerKey === adminKey) throw new ConfigError("FAKE_BSC_CALLER_KEY and FAKE_BSC_ADMIN_KEY must differ");

  const allowedCallers = list(env.FAKE_BSC_ALLOWED_CALLERS);
  const adminCallers = list(env.FAKE_BSC_ADMIN_CALLERS);
  if (!localDevBypass && allowedCallers.size === 0) throw new ConfigError("FAKE_BSC_ALLOWED_CALLERS is empty");
  for (const a of adminCallers) {
    if (!allowedCallers.has(a) && !localDevBypass) {
      throw new ConfigError("every FAKE_BSC_ADMIN_CALLERS entry must also be on FAKE_BSC_ALLOWED_CALLERS");
    }
  }

  // Optional on Cloud Run (it checks the audience before the token arrives);
  // without it a signed token, i.e. any call off Cloud Run, is refused.
  const audience = env.FAKE_BSC_AUDIENCE?.trim() || null;

  let store: FakeConfig["store"];
  if (env.FAKE_BSC_BUCKET) store = { kind: "gcs", bucket: env.FAKE_BSC_BUCKET };
  else if (env.FAKE_BSC_STORE_DIR) store = { kind: "local", dir: env.FAKE_BSC_STORE_DIR };
  else store = { kind: "memory" };
  if (onCloudRun && store.kind !== "gcs") throw new ConfigError("FAKE_BSC_BUCKET is required on Cloud Run");

  const port = Number(env.PORT ?? 8080);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new ConfigError("PORT is not a port");

  return {
    port,
    callerKey,
    adminKey,
    allowedCallers,
    adminCallers,
    audience,
    localDevBypass,
    onCloudRun,
    store,
    revision: env.K_REVISION ?? null,
  };
}
