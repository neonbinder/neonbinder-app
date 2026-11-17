---
name: cloud-run-socket-destroy-restarts-instance
description: A Cloud Run container that destroys a socket mid-request gets its instance replaced; fault kinds in a single-instance in-memory fake must answer a status instead
metadata:
  type: reference
---

A fault that ends with `req.socket.destroy()` (hang cap, `reset`) is not a harmless drop on Cloud Run: the platform treats a container-side drop mid-request as a bad instance and replaces it. On a maxScale-1 service with in-memory state that wipes every namespace and answers 429 while the new one starts. End such faults with a 503 body instead, guarded by `res.headersSent || res.writableEnded`. The fake-bsc hang cap is injectable as `createApp({ hangCapMs })` so tests use a few ms.
