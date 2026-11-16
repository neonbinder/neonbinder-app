/**
 * Boot: read config (fail closed), listen, then load recordings and write
 * captures into memory (the app answers "loading" until they are in). The boot line carries the instance id and manifest
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
import { DurableMisses } from "./missStore";
import { GcsStore } from "./store/gcs";
import * as identityModule from "./identity";
import { LocalDirStore, MemoryStore } from "./store/local";
import type { MissObjectStore, ObjectStore } from "./store/types";

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
  const store: ObjectStore & MissObjectStore =
    config.store.kind === "gcs"
      ? new GcsStore(config.store.bucket)
      : config.store.kind === "local"
        ? new LocalDirStore(config.store.dir)
        : new MemoryStore();

  const instanceId = randomUUID();
  const started = Date.now();
  const catalogue = new Catalogue(store);
  const captures = new Captures(store);
  const identity = loadIdentity(identityModule);

  // Listen first: loading every recording from the bucket can outlast a
  // caller's timeout on a cold start. Until it is done, /api and the miss
  // list are held (up to 25 s) and admin uploads answer 503
  // `x-nb-fake: loading`; reset, faults and orders work at once.
  let loading = true;
  let markLoaded: () => void = () => undefined;
  const loadDone = new Promise<void>((r) => (markLoaded = r));
  // Durable misses restore after the recordings (CONTRACT.md, "Durable
  // misses"), on their own promise: only the miss list waits for them.
  let missesLoading = true;
  let markMissesLoaded: () => void = () => undefined;
  const missesDone = new Promise<void>((r) => (markMissesLoaded = r));
  const state = new StateStore(Date.now, new DurableMisses(store));
  const app = createApp({
    config,
    catalogue,
    captures,
    state,
    identity,
    verifyIdToken: googleIdTokenVerifier(),
    instanceId,
    loading: () => loading,
    loaded: loadDone,
    missesLoading: () => missesLoading,
    missesLoaded: missesDone,
  });

  await new Promise<void>((resolve) => {
    app.listen(config.port, () => {
      log("listening", { instanceId, revision: config.revision, ms: Date.now() - started });
      resolve();
    });
  });

  const { loaded, skipped } = await catalogue.load();
  const captureCount = await captures.load();
  for (const c of captures.list()) {
    const v = checkCapture(c);
    if (v.verdict !== "ok") log("write_capture_mismatch", { endpoint: c.endpoint, paths: v.paths.length });
  }

  const capturesMissing = captures.missing();
  if (capturesMissing.length > 0) {
    // Endpoint names are fixed vocabulary; no ids or bodies.
    log("write_captures_missing", { endpoints: capturesMissing.join(", "), fix: "recorder capture-write" });
  }

  loading = false;
  markLoaded();
  const missesStarted = Date.now();
  state
    .restoreMisses((key) => catalogue.get(key) !== undefined)
    .then(
      (restored) => log("misses_restore_done", { restored, ms: Date.now() - missesStarted }),
      (err: unknown) => log("misses_restore_failed", { error: err instanceof Error ? err.name : "unknown", ms: Date.now() - missesStarted }),
    )
    .finally(() => {
      missesLoading = false;
      markMissesLoaded();
    });
  log("boot", {
    instanceId,
    revision: config.revision,
    store: store.describe(),
    manifestVersion: catalogue.manifestVersion,
    allowlistVersion: SANITISE_ALLOWLIST_VERSION,
    recordings: loaded,
    recordingsSkipped: skipped,
    writeCaptures: captureCount,
    writeCapturesMissing: capturesMissing.length,
    localDevBypass: config.localDevBypass,
    ms: Date.now() - started,
  });
}

if (require.main === module) {
  main().catch((err) => {
    log("boot_failed", { error: err instanceof ConfigError ? err.message : err instanceof Error ? err.name : "unknown" });
    process.exit(1);
  });
}
