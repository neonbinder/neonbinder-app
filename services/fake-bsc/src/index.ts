/**
 * Boot: read config (fail closed), load the recordings and write captures,
 * restore the durable misses, and only then listen. Cloud Run gives the
 * container full CPU until the port opens and holds requests until then; a
 * load run after `listen` gets CPU only while a request is in flight, so it
 * crawls between requests. Loading first keeps the whole boot inside the
 * startup window, and the server never answers from a half-loaded state.
 * A recordings or captures load error exits the process before it listens.
 * The boot line carries the instance id and manifest version, so a mid-run
 * restart (which drops all run state) is visible in the logs.
 */
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { createApp, type IdentityModule } from "./app";
import { googleIdTokenVerifier, type IdTokenVerifier } from "./auth";
import { Catalogue } from "./catalogue";
import { Captures, checkCapture } from "./captures";
import { ConfigError, readConfig, type FakeConfig } from "./config";
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

/**
 * How long boot waits for the durable-miss restore before it listens anyway.
 * The restore is bounded (at most 5,000 objects listed, read 16 at a time)
 * and takes seconds; this cap only keeps a pathologically slow bucket from
 * pushing the boot past the startup probe. Past it the restore finishes in
 * the background and the miss list (plus the admin writes that remove misses
 * in bulk) is held for it, as CONTRACT.md, "Durable misses", describes.
 */
export const MISSES_BOOT_BUDGET_MS = 30_000;

export interface BootOptions {
  config: FakeConfig;
  store: ObjectStore & MissObjectStore;
  identity: IdentityModule;
  verifyIdToken: IdTokenVerifier;
  /** Interface to bind (default: all). Tests bind loopback. */
  host?: string;
  /** Test seam for `MISSES_BOOT_BUDGET_MS`. */
  missesBootBudgetMs?: number;
}

export interface Booted {
  server: Server;
  instanceId: string;
  /** Settles when the durable-miss restore is done (already settled on the normal path). */
  missesRestored: Promise<void>;
}

/**
 * Loads everything the fake answers from, then listens. Rejects, never
 * having listened, when the recordings or write captures cannot be read.
 */
export async function boot(opts: BootOptions): Promise<Booted> {
  const { config, store } = opts;
  const instanceId = randomUUID();
  const started = Date.now();
  const catalogue = new Catalogue(store);
  const captures = new Captures(store);
  const state = new StateStore(Date.now, new DurableMisses(store));

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
  const loadMs = Date.now() - started;

  // Durable misses restore after the recordings (a recorded key is dropped,
  // not restored). The restore settles and never rejects: a failure is
  // logged and the fake carries on with an empty list (CONTRACT.md, "Durable
  // misses"), so it never stops the boot.
  let missesLoading = true;
  const missesStarted = Date.now();
  const missesRestored = state
    .restoreMisses((key) => catalogue.get(key) !== undefined)
    .then(
      (restored) => log("misses_restore_done", { restored, ms: Date.now() - missesStarted }),
      (err: unknown) => log("misses_restore_failed", { error: err instanceof Error ? err.name : "unknown", ms: Date.now() - missesStarted }),
    )
    .finally(() => {
      missesLoading = false;
    });
  const budgetMs = opts.missesBootBudgetMs ?? MISSES_BOOT_BUDGET_MS;
  let budgetTimer: NodeJS.Timeout | undefined;
  const restoredInBudget = await Promise.race([
    missesRestored.then(() => true),
    new Promise<boolean>((r) => {
      budgetTimer = setTimeout(() => r(false), budgetMs);
    }),
  ]);
  clearTimeout(budgetTimer);
  if (!restoredInBudget) log("misses_restore_deferred", { ms: Date.now() - missesStarted });

  // Recordings and captures are in, so no `loading` flag: health answers
  // `loading: false` from the first request and nothing is held for them.
  const app = createApp({
    config,
    catalogue,
    captures,
    state,
    identity: opts.identity,
    verifyIdToken: opts.verifyIdToken,
    instanceId,
    missesLoading: () => missesLoading,
    missesLoaded: missesRestored,
  });

  const server = await new Promise<Server>((resolve, reject) => {
    const done = (err?: Error): void => (err ? reject(err) : resolve(s));
    const s = opts.host === undefined ? app.listen(config.port, done) : app.listen(config.port, opts.host, done);
  });
  log("listening", { instanceId, revision: config.revision, ms: Date.now() - started });
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
    missesDeferred: !restoredInBudget,
    localDevBypass: config.localDevBypass,
    loadMs,
    ms: Date.now() - started,
  });
  return { server, instanceId, missesRestored };
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
  await boot({ config, store, identity: loadIdentity(identityModule), verifyIdToken: googleIdTokenVerifier() });
}

if (require.main === module) {
  main().catch((err) => {
    log("boot_failed", { error: err instanceof ConfigError ? err.message : err instanceof Error ? err.name : "unknown" });
    process.exit(1);
  });
}
