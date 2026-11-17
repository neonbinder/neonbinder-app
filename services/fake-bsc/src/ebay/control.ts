/**
 * The fake eBay's test controls (CONTRACT.md, "Consent and seller seeding"):
 * run-scoped, rules 1 and 2 like `/__fake/orders`, mounted on the control
 * router under `/ebay/...`.
 */
import type { Router } from "express";
import type { RequestHandler } from "express";
import { isNamespace } from "../namespace";
import type { StateStore } from "../state";
import { AUTH_CODE_TTL_S, isSeller, type EbaySeller, type EbayTokens } from "./tokens";
import { sellerOf } from "./state";
import { addEbayOrder, readFakeEbayOrder, seedFulfillmentPolicies, SELLING_POLICY_MANAGEMENT, type FakeEbayOrder, type SeedFulfillmentPolicy } from "./synth";

const SERVICE_CODE_RE = /^[A-Za-z0-9_]{1,64}$/;
const NAME_MAX = 64;

function readSeller(v: unknown): EbaySeller | null {
  if (v === undefined) return "main";
  return isSeller(v) ? v : null;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

export function readFulfillmentSeeds(input: unknown): { ok: true; seeds: SeedFulfillmentPolicy[] } | { ok: false; error: string } {
  if (!Array.isArray(input) || input.length < 1 || input.length > 10) return { ok: false, error: "fulfillmentPolicies must hold 1-10" };
  const seeds: SeedFulfillmentPolicy[] = [];
  for (const [i, raw] of input.entries()) {
    const bad = (why: string) => ({ ok: false as const, error: `fulfillmentPolicies[${i}].${why}` });
    if (!isObj(raw)) return bad("not an object");
    if (typeof raw.name !== "string" || raw.name.length < 1 || raw.name.length > NAME_MAX || /[\u0000-\u001f\u007f]/.test(raw.name)) return bad("name");
    const costType = raw.costType === undefined ? "FLAT_RATE" : raw.costType;
    if (costType !== "FLAT_RATE" && costType !== "CALCULATED") return bad("costType");
    if (!Array.isArray(raw.services) || raw.services.length < 1 || raw.services.length > 5) return bad("services must hold 1-5");
    const services: SeedFulfillmentPolicy["services"] = [];
    for (const [j, sv] of raw.services.entries()) {
      if (!isObj(sv) || typeof sv.code !== "string" || !SERVICE_CODE_RE.test(sv.code)) return bad(`services[${j}].code`);
      if (sv.costCents !== undefined && !(typeof sv.costCents === "number" && Number.isInteger(sv.costCents) && sv.costCents >= 0 && sv.costCents <= 100_000)) {
        return bad(`services[${j}].costCents`);
      }
      if (sv.freeShipping !== undefined && typeof sv.freeShipping !== "boolean") return bad(`services[${j}].freeShipping`);
      if (sv.carrier !== undefined && !(typeof sv.carrier === "string" && SERVICE_CODE_RE.test(sv.carrier))) return bad(`services[${j}].carrier`);
      const free = sv.freeShipping === true;
      services.push({
        code: sv.code,
        carrier: typeof sv.carrier === "string" ? sv.carrier : "USPS",
        costCents: free ? 0 : typeof sv.costCents === "number" ? sv.costCents : costType === "FLAT_RATE" ? 0 : null,
        freeShipping: free,
      });
    }
    seeds.push({ name: raw.name, costType, services });
  }
  return { ok: true, seeds };
}

export function mountEbayControls(router: Router, deps: { state: StateStore; tokens: EbayTokens; now: () => number; json: RequestHandler }): void {
  const { state, tokens, now, json } = deps;

  router.post("/ebay/consent", json, (req, res) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const seller = readSeller(b.seller);
    if (!isNamespace(b.ns) || seller === null) {
      res.status(400).json({ error: "body needs {ns, seller?: \"main\"|\"alt\"}" });
      return;
    }
    const { code } = tokens.mintCode({ ns: b.ns, seller });
    res.json({ code, expiresIn: AUTH_CODE_TTL_S });
  });

  router.post("/ebay/seller", json, (req, res) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const seller = readSeller(b.seller);
    if (!isNamespace(b.ns) || seller === null) {
      res.status(400).json({ error: "body needs {ns, seller?}" });
      return;
    }
    if (b.optedIn !== undefined && typeof b.optedIn !== "boolean") {
      res.status(400).json({ error: "optedIn" });
      return;
    }
    let seeds: SeedFulfillmentPolicy[] = [];
    if (b.fulfillmentPolicies !== undefined) {
      const read = readFulfillmentSeeds(b.fulfillmentPolicies);
      if (!read.ok) {
        res.status(400).json({ error: read.error });
        return;
      }
      seeds = read.seeds;
    }
    const s = sellerOf(state.get(b.ns), seller);
    let ids: string[] = [];
    if (seeds.length > 0) {
      const out = seedFulfillmentPolicies(s, seeds);
      if (!out.ok) {
        res.status(409).json({ error: out.error });
        return;
      }
      ids = out.ids;
    }
    const optIn = b.optedIn ?? (seeds.length > 0 ? true : undefined);
    if (optIn === true) s.optedIn.add(SELLING_POLICY_MANAGEMENT);
    else if (optIn === false) s.optedIn.delete(SELLING_POLICY_MANAGEMENT);
    res.json({ ok: true, fulfillmentPolicyIds: ids, optedIn: s.optedIn.has(SELLING_POLICY_MANAGEMENT) });
  });

  router.post("/ebay/orders", json, (req, res) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const seller = readSeller(b.seller);
    if (!isNamespace(b.ns) || seller === null) {
      res.status(400).json({ error: "body needs {ns, seller?}" });
      return;
    }
    const raw = b.order !== undefined ? [b.order] : Array.isArray(b.orders) ? b.orders : null;
    if (!raw || raw.length === 0 || raw.length > 20) {
      res.status(400).json({ error: "body needs {order} or {orders: 1-20}" });
      return;
    }
    const orders: FakeEbayOrder[] = [];
    for (const o of raw) {
      const read = readFakeEbayOrder(o);
      if (!read.ok) {
        res.status(400).json({ error: read.error });
        return;
      }
      orders.push(read.order);
    }
    const s = sellerOf(state.get(b.ns), seller);
    const added: Array<{ orderId: string; lines: Array<{ sku: string | null; listingId: string; quantity: number; priceCents: number }> }> = [];
    for (const o of orders) {
      const r = addEbayOrder(s, o, now());
      if (!r.ok) {
        res.status(409).json({ error: r.error, added });
        return;
      }
      added.push({ orderId: r.order.orderId, lines: r.order.lines.map((l) => ({ sku: l.sku, listingId: l.legacyItemId, quantity: l.quantity, priceCents: l.priceCents })) });
    }
    res.json({ ok: true, orderIds: added.map((o) => o.orderId), orders: added });
  });
}
