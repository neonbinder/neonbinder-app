---
name: cross-service-ts-in-node-test
description: How a services/browser node --test file runs real TypeScript from another service (the fake BSC identity) without that service's install or module type — strip types into a temp .mjs and import it
metadata:
  type: reference
---

services/browser tests run against `dist/` (CommonJS) with only browser's
node_modules installed, and another service (services/fake-bsc) is CommonJS
TS with its own node_modules. To drive browser code against the OTHER
service's real module in-process (the fake BSC identity contract test):

- Keep the shared module dependency-free: node builtins only, no relative
  imports, only erasable TS (no enums, parameter properties, namespaces).
  Inject anything else (the namespace parser, the logger) as options.
- In the test, `stripTypeScriptTypes(readFileSync(file))` from `node:module`
  (Node >= 22.13, experimental warning is harmless), write it to a
  `mkdtemp` dir as `.mjs`, and `await import(pathToFileURL(...))`. This is
  immune to the other package's `"type"` field and needs no install there.
- Serve it with `node:http` on 127.0.0.1 and point the browser at it with
  `NEONBINDER_FAKE_BSC_URL=http://127.0.0.1:<port>` (http is allowed only on
  loopback, and then no ID token is minted).

**Why:** importing the `.ts` directly fails when the owning package is
`"type": "commonjs"` and the file uses ESM syntax, and requiring its `dist/`
needs that service built and installed in the browser CI job.

**How to apply:** any contract test between services/browser and a sibling
service. Remember the browser module cache: a process-wide breaker
(`bsc-fetch`) is module state, so tests that reload the adapter must reset
it or delete it from `require.cache` too.

Related: [[bsc-b2c-http-login]].
