// GcsStore's miss methods against a stubbed bucket (no network): the
// preconditions and generation scoping that keep the versioned bucket clean.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { GcsStore } = require("../dist/src/store/gcs.js");

/** A stub Storage whose bucket records every call and answers from `behave`. */
function stub(behave = {}) {
  const calls = { files: [], saves: [], deletes: [], downloads: [], getFiles: [] };
  const bucket = {
    file(name, opts) {
      const f = {
        name,
        metadata: behave.metadataFor ? behave.metadataFor(name) : { generation: "7" },
        async save(body, o) {
          calls.saves.push({ name, body, opts: o });
          if (behave.save) await behave.save(name);
          if (behave.afterSave) f.metadata = behave.afterSave;
        },
        async download() {
          calls.downloads.push({ name, opts });
          if (behave.download) return behave.download(name, opts);
          return [Buffer.from('{"a":1}')];
        },
        async delete(o) {
          calls.deletes.push({ name, fileOpts: opts, opts: o });
          if (behave.delete) await behave.delete();
        },
      };
      calls.files.push({ name, opts });
      return f;
    },
    async getFiles(o) {
      calls.getFiles.push(o);
      return [behave.files ?? []];
    },
  };
  const store = new GcsStore("b", { bucket: () => bucket });
  return { store, calls };
}

const err = (code) => Object.assign(new Error("x"), { code });

describe("GcsStore miss methods", () => {
  it("createOnce is create-only: ifGenerationMatch 0, and answers the new generation as a string", async () => {
    const { store, calls } = stub({ afterSave: { generation: 12345 } });
    assert.equal(await store.createOnce("misses/o.json", { k: 1 }), "12345");
    assert.equal(calls.saves[0].opts.preconditionOpts.ifGenerationMatch, 0);
    assert.equal(calls.saves[0].body, '{"k":1}');
    assert.equal(calls.saves[0].opts.resumable, false);
  });

  it("createOnce answers null on a 412 (already there) and throws any other error", async () => {
    const exists = stub({ save: async () => { throw err(412); } });
    assert.equal(await exists.store.createOnce("o", {}), null);
    for (const code of [403, 404, 500, undefined]) {
      const { store } = stub({ save: async () => { throw err(code); } });
      await assert.rejects(store.createOnce("o", {}), (e) => e.code === code, String(code));
    }
  });

  it("createOnce throws when the upload answers no generation", async () => {
    for (const metadata of [{}, { generation: null }, undefined]) {
      const { store } = stub({ afterSave: metadata, metadataFor: () => undefined });
      await assert.rejects(store.createOnce("o", {}), /no generation/);
    }
  });

  it("listVersions passes the prefix and the limit, drops files with no generation, and sorts by name", async () => {
    const { store, calls } = stub({
      files: [
        { name: "misses/b.json", metadata: { generation: 2 } },
        { name: "misses/a.json", metadata: { generation: "1" } },
        { name: "misses/none.json", metadata: {} },
        { name: "misses/c.json", metadata: { generation: null } },
      ],
    });
    assert.deepEqual(await store.listVersions("misses/", 50), [
      { name: "misses/a.json", generation: "1" },
      { name: "misses/b.json", generation: "2" },
    ]);
    assert.equal(calls.getFiles[0].prefix, "misses/");
    assert.equal(calls.getFiles[0].maxResults, 50);
  });

  it("readVersion reads that generation, answers null on a 404 and throws any other error", async () => {
    const { store, calls } = stub();
    assert.deepEqual(await store.readVersion("o", "99"), { a: 1 });
    assert.deepEqual(calls.files[0], { name: "o", opts: { generation: "99" } });
    const gone = stub({ download: async () => { throw err(404); } });
    assert.equal(await gone.store.readVersion("o", "99"), null);
    const down = stub({ download: async () => { throw err(500); } });
    await assert.rejects(down.store.readVersion("o", "99"), (e) => e.code === 500);
  });

  it("deleteVersion scopes the file to the generation and ignores not-found", async () => {
    const { store, calls } = stub();
    await store.deleteVersion("o", "99");
    assert.deepEqual(calls.deletes[0].fileOpts, { generation: "99" });
    assert.deepEqual(calls.deletes[0].opts, { ignoreNotFound: true });
  });

  it("deleteVersion lets a real failure through", async () => {
    const { store } = stub({ delete: async () => { throw err(403); } });
    await assert.rejects(store.deleteVersion("o", "1"), (e) => e.code === 403);
  });
});
