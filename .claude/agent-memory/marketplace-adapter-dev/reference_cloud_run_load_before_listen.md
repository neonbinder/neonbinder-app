---
name: reference-cloud-run-load-before-listen
description: On a CPU-throttled Cloud Run service, boot work after listen() crawls between requests; load before listen. Test it by spying http.Server.prototype.listen
metadata:
  type: reference
---

A Cloud Run service with request-based CPU (throttling on) gets full CPU only
until its port opens (startup phase; requests are held by the frontend) and
afterwards only while a request is in flight. A "listen first, load in the
background" boot therefore stalls between requests: the same load can take
seconds or minutes depending on traffic. Do the loads the service answers
from BEFORE `listen`, keep a bounded budget for any optional load (the fake
BSC's durable-miss restore: 30 s, then it finishes in the background behind
the existing hold), and keep the total well inside the startup probe timeout.

**Why:** the fake BSC (services/fake-bsc) shipped listen-then-load and its
boot time ranged from ~3 s to minutes with an unchanged recording set.

**How to apply:** for any services/* boot under Cloud Run, check the order.
To prove it in node --test: wrap `http.Server.prototype.listen` with a
counting spy (restore in finally), gate the store's first read on a promise,
assert 0 listens while gated, and assert a load failure rejects with 0
listens. A spawned `dist/src/index.js` on a local dir store with a bad
manifest proves the exit-1-without-listening path end to end. Plant an early
listen to confirm the tests go red. Related: [[agent-bash-is-zsh-no-word-split]].
