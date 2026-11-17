// Child process for ebay-recorder.test.mjs ("a closed stderr"): a production
// capture, against the stub eBay, whose stderr is a pipe the parent has
// already closed. It waits for "go" on stdin (sent after the parent closes the
// pipe), reports to stderr the way the CLI's `say` does, takes a SIGHUP when
// the listing goes live (a terminal hanging up), and prints what happened as
// JSON on stdout. Without the guard the first line to the closed pipe ends
// this process, uncaught, with the listing live.
import { createRequire } from "node:module";
import { api, prodRoutes, sink, PICTURE, PRD_SKU } from "../ebay-stubs.mjs";

const require = createRequire(import.meta.url);
const { runProdCapture } = require("../../dist/recorder/ebay-capture.js");

await new Promise((resolve) => process.stdin.once("data", resolve));
process.stdin.destroy();

// Notes each 'error' the stream emits without listening for it (a listener
// would be a guard of its own): stdio streams reset `errored` after each error.
const stderrErrors = [];
const emit = process.stderr.emit;
process.stderr.emit = function (event, ...args) {
  if (event === "error") stderrErrors.push(args[0]?.code ?? "error");
  return emit.call(this, event, ...args);
};

const listenersBefore = process.stderr.listenerCount("error") + process.stdout.listenerCount("error");
const { routes, state } = prodRoutes({
  "POST /sell/inventory/v1/offer/777/publish": (_ctx, st) => {
    st.live = true;
    process.emit("SIGHUP", "SIGHUP");
    return { status: 200, body: { listingId: "110000000001", warnings: [] } };
  },
});
const { api: a, stub } = api("production", routes);
let lines = 0;
const out = await runProdCapture({
  api: a,
  sink: sink(),
  sku: PRD_SKU,
  picture: PICTURE,
  report: (line) => {
    lines += 1;
    process.stderr.write(`${line}\n`);
  },
  exit: (code) => process.exit(code),
});
// Let a late 'error' event from the last write land (or kill us) before the answer.
await new Promise((resolve) => setTimeout(resolve, 50));
process.stdout.write(
  JSON.stringify({
    ok: out.ok,
    live: state.live,
    item: state.item,
    calls: stub.calls.map((c) => `${c.method} ${c.path}`),
    lines,
    stderrErrors,
    listenersBefore,
    listenersAfter: process.stderr.listenerCount("error") + process.stdout.listenerCount("error"),
  }),
);
