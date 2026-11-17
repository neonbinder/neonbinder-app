// FAKE_BSC_ID_TOKEN_FILE: the recorder's ID token can come from a file the
// caller refreshes, so no application-default login is needed. Test tokens are
// built here; the payload is decoded but never verified by the recorder.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, writeFile, rm, chmod, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { idTokenSource, assertFakeUrl } = require("../dist/recorder/fake-client.js");
const { fakeClient, parseArgs } = require("../dist/recorder/cli.js");

const AUD = "https://fake.example";
const NOW = 1_800_000_000_000;
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jws = (claims) => `${b64({ alg: "RS256" })}.${b64(claims)}.c2ln`;
const good = (over = {}) => jws({ aud: AUD, exp: NOW / 1000 + 3600, ...over });

describe("idTokenSource", () => {
  let dir;
  before(async () => { dir = await mkdtemp(path.join(tmpdir(), "idtok-")); });
  after(async () => { await rm(dir, { recursive: true, force: true }); });
  const adcStub = () => { throw new Error("ADC must not be used"); };
  const src = (env, extra = {}) =>
    idTokenSource(AUD, env, extra.adc ?? adcStub, () => NOW, extra.warn ?? (() => {}));
  const file = async (name, text, mode = 0o600) => {
    const f = path.join(dir, name);
    await writeFile(f, text);
    await chmod(f, mode);
    return f;
  };

  it("reads the file, trims it, and re-reads it after a change", async () => {
    const one = good(), two = good({ exp: NOW / 1000 + 7200 });
    const f = await file("t", one + "\n");
    const mint = src({ FAKE_BSC_ID_TOKEN_FILE: f });
    assert.equal(await mint(), one);
    await writeFile(f, two + "\n");
    assert.equal(await mint(), two);
  });

  it("a missing file throws naming the variable, with no ADC fallback", async () => {
    await assert.rejects(src({ FAKE_BSC_ID_TOKEN_FILE: path.join(dir, "nope") }), /FAKE_BSC_ID_TOKEN_FILE/);
  });

  it("a directory is refused; a file over 16 KB is refused", async () => {
    const d = path.join(dir, "adir"); await mkdir(d);
    const same = /^FAKE_BSC_ID_TOKEN_FILE is set but is not a readable regular file under 16 KB$/;
    await assert.rejects(src({ FAKE_BSC_ID_TOKEN_FILE: d }), (e) => {
      assert.match(e.message, same); assert.equal(e.reason, "not-a-regular-file");
      assert.ok(!e.message.includes(dir)); return true;
    });
    const big = await file("big", "a".repeat(17 * 1024));
    await assert.rejects(src({ FAKE_BSC_ID_TOKEN_FILE: big }), (e) => {
      assert.match(e.message, same); assert.equal(e.reason, "too-large");
      assert.ok(!e.message.includes(dir)); return true;
    });
    await assert.rejects(src({ FAKE_BSC_ID_TOKEN_FILE: path.join(dir, "gone") }), (e) => {
      assert.match(e.message, same); assert.equal(e.reason, "unreadable"); return true;
    });
  });

  it("a three-part token whose middle part is not JSON is refused generically", async () => {
    const f = await file("nojson", "aaa.bbb.ccc");
    await assert.rejects(src({ FAKE_BSC_ID_TOKEN_FILE: f }), /does not hold a single ID token/);
  });

  it("a payload of null or a string is refused", async () => {
    for (const payload of [null, "x", [1]]) {
      const f = await file("pl", `${b64({ alg: "RS256" })}.${b64(payload)}.c2ln`);
      await assert.rejects(src({ FAKE_BSC_ID_TOKEN_FILE: f }), /single ID token/, JSON.stringify(payload));
    }
  });

  it("exp equal to now is refused; a string exp is refused", async () => {
    const f = await file("expnow", jws({ aud: AUD, exp: NOW / 1000 }));
    await assert.rejects(src({ FAKE_BSC_ID_TOKEN_FILE: f }), /expired/);
    const g = await file("expstr", jws({ aud: AUD, exp: String(NOW / 1000 + 3600) }));
    await assert.rejects(src({ FAKE_BSC_ID_TOKEN_FILE: g }), /expired/);
  });

  it("an empty or blank file throws naming the variable", async () => {
    const f = await file("empty", " \n");
    await assert.rejects(src({ FAKE_BSC_ID_TOKEN_FILE: f }), /FAKE_BSC_ID_TOKEN_FILE.*empty/);
  });

  it("set but empty is an error, never ADC", async () => {
    await assert.rejects(src({ FAKE_BSC_ID_TOKEN_FILE: "" }), /FAKE_BSC_ID_TOKEN_FILE is set but empty/);
  });

  it("unset falls through to the ADC minter, for the same audience", async () => {
    let seen;
    const mint = src({}, { adc: (aud) => { seen = aud; return async () => "from-adc"; } });
    assert.equal(await mint(), "from-adc");
    assert.equal(seen, AUD);
  });

  it("not a single compact token is refused without echoing the value", async () => {
    const f = await file("multi", "aaa.bbb.ccc\nwarning");
    await assert.rejects(src({ FAKE_BSC_ID_TOKEN_FILE: f }), (e) => {
      assert.match(e.message, /does not hold a single ID token/);
      assert.doesNotMatch(e.message, /aaa/);
      return true;
    });
  });

  it("a token for another audience is refused, printing neither audience", async () => {
    const f = await file("aud", jws({ aud: "https://other.example", exp: NOW / 1000 + 60 }));
    await assert.rejects(src({ FAKE_BSC_ID_TOKEN_FILE: f }), (e) => {
      assert.match(e.message, /different audience/);
      assert.doesNotMatch(e.message, /other\.example|fake\.example/);
      return true;
    });
  });

  it("an expired token is refused; a missing exp too", async () => {
    const f = await file("exp", jws({ aud: AUD, exp: NOW / 1000 - 1 }));
    await assert.rejects(src({ FAKE_BSC_ID_TOKEN_FILE: f }), /expired/);
    const g = await file("noexp", jws({ aud: AUD }));
    await assert.rejects(src({ FAKE_BSC_ID_TOKEN_FILE: g }), /expired/);
  });

  it("a group/other-readable file warns once but still works", async () => {
    const f = await file("open", good(), 0o644);
    const lines = [];
    const mint = src({ FAKE_BSC_ID_TOKEN_FILE: f }, { warn: (l) => lines.push(l) });
    await mint(); await mint();
    assert.equal(lines.length, 1);
    assert.match(lines[0], /FAKE_BSC_ID_TOKEN_FILE/);
  });
});

describe("fakeClient wiring and --fake pinning", () => {
  let dir, server, seen, base;
  const saved = process.env.FAKE_BSC_ID_TOKEN_FILE;
  before(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "idtok-wire-"));
    server = http.createServer((req, res) => { seen = req.headers; res.setHeader("content-type", "application/json"); res.end('{"misses":[]}'); });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${server.address().port}`;
    process.env.FAKE_BSC_CALLER_KEY = "c".repeat(40);
    process.env.FAKE_BSC_ADMIN_KEY = "a".repeat(40);
  });
  after(async () => {
    server.close();
    if (saved === undefined) delete process.env.FAKE_BSC_ID_TOKEN_FILE; else process.env.FAKE_BSC_ID_TOKEN_FILE = saved;
    await rm(dir, { recursive: true, force: true });
  });
  const flags = (...a) => parseArgs(["record", ...a]).flags;

  it("the token from the file reaches x-nb-fake-id-token", async () => {
    const tok = jws({ aud: base, exp: Date.now() / 1000 + 3600 });
    const f = path.join(dir, "t"); await writeFile(f, tok + "\n", { mode: 0o600 });
    process.env.FAKE_BSC_ID_TOKEN_FILE = f;
    await fakeClient(flags("--fake", base)).misses("abc-");
    assert.equal(seen["x-nb-fake-id-token"], tok);
    assert.equal(seen["x-serverless-authorization"], `Bearer ${tok}`);
  });

  it("--no-id-token with the variable set sends no token and never reads the file", async () => {
    process.env.FAKE_BSC_ID_TOKEN_FILE = path.join(dir, "does-not-exist");
    seen = undefined;
    await fakeClient(flags("--fake", base, "--no-id-token")).misses("abc-");
    assert.equal(seen["x-nb-fake-id-token"], undefined);
  });

  it("--fake host: the fake's Cloud Run host and loopback pass; others are refused", () => {
    for (const ok of ["https://neonbinder-fake-bsc-123456.us-central1.run.app", "https://neonbinder-fake-bsc-abc.run.app", "http://localhost:8080", "http://127.0.0.1:1"]) {
      assert.doesNotThrow(() => assertFakeUrl(ok), ok);
    }
    for (const bad of ["https://evil.example", "https://neonbinder-fake-bsc-1.run.app.evil.example", "http://neonbinder-fake-bsc-1.us-central1.run.app", "https://pr-1---neonbinder-fake-bsc-1.us-central1.run.app", "https://neonbinder-browser-1.us-central1.run.app", "https://user:pw@neonbinder-fake-bsc-1.run.app", "not a url"]) {
      assert.throws(() => assertFakeUrl(bad), /--fake/, bad);
    }
  });

  it("FAKE_BSC_EXPECTED_HOST pins the exact host; loopback stays allowed", () => {
    const host = "neonbinder-fake-bsc-1.us-central1.run.app";
    const env = { FAKE_BSC_EXPECTED_HOST: host };
    assert.doesNotThrow(() => assertFakeUrl(`https://${host}`, env));
    assert.throws(() => assertFakeUrl("https://neonbinder-fake-bsc-2.us-central1.run.app", env), /FAKE_BSC_EXPECTED_HOST/);
    assert.throws(() => assertFakeUrl(`https://${host}`, { FAKE_BSC_EXPECTED_HOST: "" }), /FAKE_BSC_EXPECTED_HOST/);
    assert.doesNotThrow(() => assertFakeUrl("http://127.0.0.1:9", env));
    assert.doesNotThrow(() => assertFakeUrl(`https://${host}`, {}));
  });

  it("keys with whitespace or control characters are refused by name, never by value", () => {
    const keep = [process.env.FAKE_BSC_CALLER_KEY, process.env.FAKE_BSC_ADMIN_KEY];
    try {
      for (const [name, bad] of [["FAKE_BSC_CALLER_KEY", "abc\ndef"], ["FAKE_BSC_ADMIN_KEY", "abc def"], ["FAKE_BSC_CALLER_KEY", "abc\u0001"], ["FAKE_BSC_ADMIN_KEY", "tab\there"]]) {
        process.env.FAKE_BSC_CALLER_KEY = "c".repeat(40); process.env.FAKE_BSC_ADMIN_KEY = "a".repeat(40);
        process.env[name] = bad;
        assert.throws(() => fakeClient(flags("--fake", base, "--no-id-token")), (e) => {
          assert.ok(e.message.includes(name)); assert.ok(!e.message.includes("def") && !e.message.includes("here"));
          return true;
        });
      }
    } finally {
      for (const [name, value] of [["FAKE_BSC_CALLER_KEY", keep[0]], ["FAKE_BSC_ADMIN_KEY", keep[1]]]) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });

  it("fakeClient refuses a bad --fake host before building anything", () => {
    assert.throws(() => fakeClient(flags("--fake", "https://evil.example")), /--fake/);
  });
});
