/**
 * NEO-552 — a call gate that grants every call and records nothing, for a
 * convex-test file that pins something else (call telemetry, a drain's
 * bookkeeping) through a run of mixed BSC failures that the real gate would
 * turn into a breaker opening. Install it with `vi.mock`, so every module of
 * the file's graph gets it:
 *
 *   vi.mock("./bscCallGate", async (importOriginal) => ({
 *     ...(await importOriginal<typeof import("./bscCallGate")>()),
 *     bscCallGateFor: () => openBscCallGate(),
 *   }));
 *
 * Imports nothing from `bscCallGate` itself, so the mock factory cannot
 * import the module it is replacing. The real gate is pinned in
 * `bscCallGate.test.ts`.
 */
import type { BscCallGate } from "../../convex/lib/bscHttp";

export function openBscCallGate(): BscCallGate {
  return {
    acquire: async (count) => ({
      ok: true,
      granted: Math.min(Math.max(Math.floor(count), 1), 10),
      grant: { grantedAt: Date.now(), reportOutcome: false, probe: false },
    }),
    record: async () => {},
    release: async () => {},
    wantsSuccess: () => false,
    blockedUntil: async () => null,
  };
}
