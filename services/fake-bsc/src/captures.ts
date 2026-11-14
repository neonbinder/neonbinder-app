/**
 * Write captures (CONTRACT.md, "Write capture"): the status and shape of one
 * real BSC write, uploaded by `recorder capture-write`. The latest per write
 * endpoint is kept, and the fake's synthesised answer is checked against it.
 */
import { WRITE_ENDPOINTS, isWriteEndpoint, type WriteEndpoint } from "./paths";
import { readShape, shapeOf, synthConformsTo, type Shape } from "./shape";
import { photoAnswer, putAnswer } from "./synth/sheet";
import type { Listing, NamespaceState } from "./state";
import type { ObjectStore } from "./store/types";

export interface WriteCapture {
  endpoint: WriteEndpoint;
  status: number;
  shape: Shape;
  capturedAt: string;
}

export type CaptureRead = { ok: true; capture: WriteCapture } | { ok: false; error: string };

export function readCapture(input: unknown, now: () => Date = () => new Date()): CaptureRead {
  if (!input || typeof input !== "object") return { ok: false, error: "body must be an object" };
  const b = input as Record<string, unknown>;
  if (!isWriteEndpoint(b.endpoint)) return { ok: false, error: `endpoint must be one of: ${Object.keys(WRITE_ENDPOINTS).join(", ")}` };
  if (typeof b.status !== "number" || !Number.isInteger(b.status) || b.status < 100 || b.status > 599) return { ok: false, error: "status" };
  const shape = readShape(b.shape);
  if (!shape) return { ok: false, error: "shape must map key paths to type lists" };
  const capturedAt = typeof b.capturedAt === "string" && !Number.isNaN(Date.parse(b.capturedAt)) ? b.capturedAt : now().toISOString();
  return { ok: true, capture: { endpoint: b.endpoint, status: b.status, shape, capturedAt } };
}

const SAMPLE_STATE: NamespaceState = {
  ns: "sample",
  sellerId: "fake-sample",
  storeName: "Fake Store sample",
  userId: "fake-user-sample",
  listings: new Map(),
  photos: 0,
  orders: new Map(),
  faults: [],
  misses: new Map(),
  lastSeen: 0,
};

const SAMPLE_LISTING: Listing = {
  cardId: "samplecard",
  condition: "near_mint",
  productId: "sampleproduct",
  availableQuantity: 1,
  price: 0.25,
  sellerSku: "1|1",
  sellerImgFront: null,
  sellerImgBack: null,
  updatedTimestamp: "2026-01-01T00:00:00.000000",
  card: null,
};

/** The status and shape the fake answers a successful write with. */
export function synthesisedWrite(endpoint: WriteEndpoint): { status: number; shape: Shape } {
  switch (endpoint) {
    case "PUT seller/bulk-upload":
      return { status: 200, shape: shapeOf(putAnswer([SAMPLE_LISTING], SAMPLE_STATE)) };
    case "POST common/card/undefined/product/undefined/attachment":
      return { status: 200, shape: shapeOf(photoAnswer("/prod/card/undefined/product/undefined/sample.jpg")) };
  }
}

export interface CaptureVerdict {
  endpoint: WriteEndpoint;
  capturedAt: string;
  verdict: "ok" | "shape_drift";
  paths: string[];
}

/** Does the fake's answer fit the real one? Paths only. */
export function checkCapture(capture: WriteCapture): CaptureVerdict {
  const synth = synthesisedWrite(capture.endpoint);
  const paths = synthConformsTo(synth.shape, capture.shape).paths;
  const statusClass = (s: number) => Math.floor(s / 100);
  if (statusClass(synth.status) !== statusClass(capture.status)) paths.unshift("$status");
  return { endpoint: capture.endpoint, capturedAt: capture.capturedAt, verdict: paths.length ? "shape_drift" : "ok", paths };
}

export class Captures {
  private readonly latest = new Map<WriteEndpoint, WriteCapture>();

  constructor(private readonly store: ObjectStore) {}

  async load(): Promise<number> {
    this.latest.clear();
    for (const [endpoint, slug] of Object.entries(WRITE_ENDPOINTS)) {
      const raw = await this.store.read(`write-captures/${slug}.json`);
      if (raw === null) continue;
      const r = readCapture(raw);
      if (r.ok && r.capture.endpoint === endpoint) this.latest.set(r.capture.endpoint, r.capture);
    }
    return this.latest.size;
  }

  async save(c: WriteCapture): Promise<void> {
    await this.store.write(`write-captures/${WRITE_ENDPOINTS[c.endpoint]}.json`, c);
    this.latest.set(c.endpoint, c);
  }

  list(): WriteCapture[] {
    return [...this.latest.values()];
  }

  /**
   * The write endpoints the specs drive that have no stored capture. Empty
   * once `recorder capture-write` has run for each. Without a capture the
   * fake's synthesised write answer is checked against nothing.
   */
  missing(): WriteEndpoint[] {
    return (Object.keys(WRITE_ENDPOINTS) as WriteEndpoint[]).filter((e) => !this.latest.has(e));
  }
}
