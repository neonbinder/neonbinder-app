/**
 * Boot: read config (fail closed), load recordings and write captures into
 * memory, then listen. The boot line carries the instance id and manifest
 * version, so a mid-run restart (which drops all run state) is visible in
 * the logs.
 */
import { randomUUID } from "node:crypto";
import { createApp, type IdentityModule } from "./app";
import { googleIdTokenVerifier } from "./auth";
import { Catalogue } from "./catalogue";
import { Captures, checkCapture } from "./captures";
import { ConfigError, readConfig } from "./config";
import { log } from "./log";
import { SANITISE_ALLOWLIST_VERSION } from "./sanitise";
import { StateStore } from "./state";
import { GcsStore } from "./store/gcs";
import * as identityModule from "./identity";
import { LocalDirStore, MemoryStore } from "./store/local";
import type { ObjectStore } from "./store/types";

/**
 * The identity module (CONTRACT.md, "Identity"), checked at boot so a
 * module that drifted from the agreed interface stops the process.
 */
export function loadIdentity(mod: unknown): IdentityModule {
  const m = mod as Partial<IdentityModule> | null;
  if (!m || typeof m.identityRouter !== "function" || typeof m.namespaceForToken !== "function") {
    throw new Error("src/identity must export identityRouter and namespaceForToken");
  }
  if (m.resetIdentity !== undefined && typeof m.resetIdentity !== "function") {
    throw new Error("src/identity resetIdentity must be a function");
  }
  return m as IdentityModule;
}

async function main(): Promise<void> {
  const env = process.env;
  if ((env.ENVIRONMENT ?? "").trim() === "prod") {
    throw new ConfigError("the fake never runs with ENVIRONMENT=prod");
  }
  const config = readConfig(env);
  const store: ObjectStore =
    config.store.kind === "gcs"
      ? new GcsStore(config.store.bucket)
      : config.store.kind === "local"
        ? new LocalDirStore(config.store.dir)
        : new MemoryStore();

  const instanceId = randomUUID();
  const started = Date.now();
  const catalogue = new Catalogue(store);
  const { loaded, skipped } = await catalogue.load();
  const captures = new Captures(store);
  const captureCount = await captures.load();
  for (const c of captures.list()) {
    const v = checkCapture(c);
    if (v.verdict !== "ok") log("write_capture_mismatch", { endpoint: c.endpoint, paths: v.paths.length });
  }

  const identity = loadIdentity(identityModule);
  const app = createApp({
    config,
    catalogue,
    captures,
    state: new StateStore(),
    identity,
    verifyIdToken: googleIdTokenVerifier(),
    instanceId,
  });

  app.listen(config.port, () => {
    log("boot", {
      instanceId,
      revision: config.revision,
      store: store.describe(),
      manifestVersion: catalogue.manifestVersion,
      allowlistVersion: SANITISE_ALLOWLIST_VERSION,
      recordings: loaded,
      recordingsSkipped: skipped,
      writeCaptures: captureCount,
      localDevBypass: config.localDevBypass,
      ms: Date.now() - started,
    });
  });
}

if (require.main === module) {
  main().catch((err) => {
    log("boot_failed", { error: err instanceof ConfigError ? err.message : err instanceof Error ? err.name : "unknown" });
    process.exit(1);
  });
}
