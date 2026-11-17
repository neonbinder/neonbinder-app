// FAKE_BSC_ID_TOKEN_FILE: the recorder's ID token can come from a file the
// caller refreshes, so no application-default login is needed.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { idTokenSource } = require("../dist/recorder/fake-client.js");

describe("idTokenSource", () => {
  let dir;
  before(async () => { dir = await mkdtemp(path.join(tmpdir(), "idtok-")); });
  after(async () => { await rm(dir, { recursive: true, force: true }); });
  const adcStub = () => { throw new Error("ADC must not be used"); };

  it("reads the file, trims it, and re-reads it after a change", async () => {
    const f = path.join(dir, "t");
    await writeFile(f, "token-one\n");
    const mint = idTokenSource("https://fake.example", { FAKE_BSC_ID_TOKEN_FILE: f }, adcStub);
    assert.equal(await mint(), "token-one");
    await writeFile(f, "token-two\n");
    assert.equal(await mint(), "token-two");
  });

  it("a missing file throws naming the variable, with no ADC fallback", async () => {
    const mint = idTokenSource("https://fake.example", { FAKE_BSC_ID_TOKEN_FILE: path.join(dir, "nope") }, adcStub);
    await assert.rejects(mint, /FAKE_BSC_ID_TOKEN_FILE/);
  });

  it("an empty or blank file throws naming the variable", async () => {
    const f = path.join(dir, "empty");
    await writeFile(f, " \n");
    const mint = idTokenSource("https://fake.example", { FAKE_BSC_ID_TOKEN_FILE: f }, adcStub);
    await assert.rejects(mint, /FAKE_BSC_ID_TOKEN_FILE.*empty/);
  });

  it("unset falls through to the ADC minter, for the same audience", async () => {
    let seen;
    const mint = idTokenSource("https://fake.example", {}, (aud) => { seen = aud; return async () => "from-adc"; });
    assert.equal(await mint(), "from-adc");
    assert.equal(seen, "https://fake.example");
  });
});
