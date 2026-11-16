/**
 * `ebay-record` (CONTRACT.md, "Recorder: eBay"): reads rows 5 and 7 from the
 * eBay sandbox, the two pinned requests only, sanitises them with the fake's
 * allowlists and uploads them as recordings. `--misses <prefix>` sends only
 * the pinned requests the fake lists as misses for that prefix.
 */
import { EBAY_PINNED_REQUESTS, ebayReplayRefusal } from "../src/replayAllowlist";
import { SANITISE_ALLOWLIST_VERSION, sanitiseCatalogue } from "../src/sanitise";
import type { EbayApi, EbayCall } from "./ebay-api";
import type { MissEntry } from "./fake-client";

type Pinned = (typeof EBAY_PINNED_REQUESTS)[number];

/** The real eBay request a pinned fake request is: the fake path minus its `ebay/api/` prefix. */
export function ebayCallFor(p: Pinned): EbayCall {
  const path = `/${p.path.replace(/^ebay\/api\//, "")}`;
  return { label: `GET ${p.path.replace(/^ebay\/api\//, "")}`, method: "GET", host: "api", path, query: Object.fromEntries(p.query), token: "user" };
}

/** Which pinned requests a run sends: all, or those missed under `prefix` (plus anonymous). */
export function ebayRecordPlan(misses: MissEntry[] | null): { todo: Pinned[]; refused: string[] } {
  if (misses === null) return { todo: [...EBAY_PINNED_REQUESTS], refused: [] };
  const todo = new Set<Pinned>();
  const refused: string[] = [];
  for (const m of misses) {
    if (m.kind !== "catalogue" || !m.request || !m.path.startsWith("ebay/")) continue;
    const reason = ebayReplayRefusal({ method: m.request.method, path: m.request.path, query: m.request.query ?? [], body: m.request.body });
    if (reason) {
      refused.push(`${m.method} ${m.path} (${reason})`);
      continue;
    }
    const pinned = EBAY_PINNED_REQUESTS.find((p) => p.path === m.request!.path);
    if (pinned) todo.add(pinned);
  }
  return { todo: [...todo], refused };
}

export interface EbayRecordDeps {
  api: EbayApi;
  fake: { uploadRecording(r: unknown): Promise<unknown> };
  todo: Pinned[];
  report: (line: string) => void;
}

export interface EbayRecordResult {
  recorded: number;
  /** Per request: what happened, never a value. */
  lines: string[];
}

export async function runEbayRecord(deps: EbayRecordDeps): Promise<EbayRecordResult> {
  const { api, fake, todo, report } = deps;
  const lines: string[] = [];
  let recorded = 0;
  await api.grantUser();
  for (const p of todo) {
    const call = ebayCallFor(p);
    const r = await api.call(call);
    if (r.status !== 200) {
      lines.push(`${call.label}: HTTP ${r.status}; not recorded`);
      continue;
    }
    const s = sanitiseCatalogue(p.endpoint, r.body);
    if (s.value === undefined) {
      lines.push(`${call.label}: the answer is outside the allowlist; not recorded`);
      continue;
    }
    if (s.dropped.length > 0) report(`${call.label}: dropped ${s.dropped.length} path(s) outside the allowlist: ${s.dropped.slice(0, 20).join(", ")}`);
    await fake.uploadRecording({
      allowlistVersion: SANITISE_ALLOWLIST_VERSION,
      request: { method: p.method, path: p.path, query: p.query },
      response: { status: 200, body: s.value },
    });
    recorded += 1;
    lines.push(`${call.label}: recorded`);
  }
  return { recorded, lines };
}
