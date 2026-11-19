// NEO-555: the bucketed operator hint for missing fake write captures.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "fake-capture-hints.sh");

// EBAY_REQUIRED_CAPTURES (services/fake-bsc/src/ebay/captures.ts), expanded.
const A = "ebay/api/sell/inventory/v1";
const SANDBOX = [
  `POST ${A}/bulk_create_or_replace_inventory_item`,
  `POST ${A}/bulk_create_offer`,
  `DELETE ${A}/inventory_item/:sku`,
  `POST ${A}/location/:merchantLocationKey`,
  `POST ${A}/location/:merchantLocationKey/update_location_details`,
  `POST ${A}/location/:merchantLocationKey/enable`,
  `PUT ${A}/offer/:offerId`,
  `POST ${A}/offer/:offerId/publish #refused`,
];
const PROD = [
  "POST ebay/apim/commerce/media/v1_beta/image/create_image_from_file",
  "GET ebay/apim/commerce/media/v1_beta/image/:imageId",
  `POST ${A}/offer/:offerId/publish`,
  `POST ${A}/bulk_update_price_quantity`,
  `POST ${A}/offer/:offerId/withdraw`,
];
const BSC = ["PUT seller/bulk-upload", "POST common/card/undefined/product/undefined/attachment"];

function hints(missing) {
  const dir = mkdtempSync(join(tmpdir(), "capturehints-"));
  const f = join(dir, "s.json");
  writeFileSync(f, JSON.stringify({ missing }));
  const r = spawnSync("bash", [SCRIPT, f], { encoding: "utf8" });
  return { status: r.status, lines: r.stdout.split("\n").filter(Boolean) };
}

test("all 13 eBay names and the 2 BSC names land in their three buckets", () => {
  assert.equal(SANDBOX.length + PROD.length, 13);
  const r = hints([...BSC, ...SANDBOX, ...PROD]);
  assert.equal(r.status, 0);
  assert.equal(r.lines.length, 3);
  const [bsc, sandbox, prod] = r.lines;
  assert.match(bsc, /^::error::BSC: run 'recorder capture-write' for each of: /);
  assert.match(sandbox, /^::error::eBay \(sandbox\): run 'fake-bsc\.sh ebay-capture' for: /);
  assert.match(prod, /ebay-capture --prod' for: /);
  const names = (line) => line.slice(line.lastIndexOf(" for: ") + 6).replace(/\.$/, "").split(", ");
  assert.deepEqual(names(sandbox), SANDBOX);
  assert.deepEqual(names(prod), PROD);
  assert.deepEqual(names(bsc.replace("for each of:", "for:")), BSC);
});

test("publish #refused is the sandbox's; plain publish is production's", () => {
  const r = hints([`POST ${A}/offer/:offerId/publish #refused`]);
  assert.equal(r.lines.length, 1);
  assert.match(r.lines[0], /\(sandbox\)/);
  const p = hints([`POST ${A}/offer/:offerId/publish`]);
  assert.equal(p.lines.length, 1);
  assert.match(p.lines[0], /production only/);
});

test("an unknown new ebay/ name lands in the sandbox bucket", () => {
  const r = hints(["POST ebay/api/sell/new/v1/thing"]);
  assert.equal(r.lines.length, 1);
  assert.match(r.lines[0], /\(sandbox\).*POST ebay\/api\/sell\/new\/v1\/thing/);
});

test("an empty bucket prints nothing", () => {
  assert.deepEqual(hints([]).lines, []);
  const r = hints(BSC);
  assert.equal(r.lines.length, 1);
  assert.match(r.lines[0], /BSC/);
});

test("the hint names no person", () => {
  assert.ok(!hints(PROD).lines.join("\n").includes("Jason"));
});
