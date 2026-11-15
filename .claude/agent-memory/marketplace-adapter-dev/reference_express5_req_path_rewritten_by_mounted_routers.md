---
name: express5-req-path-rewritten-by-mounted-routers
description: In Express 5, an app-level res.on("finish") logger that reads req.path sees the mounted router's stripped path; capture req.originalUrl at entry
metadata:
  type: reference
---

An app-level request logger that reads `req.path` inside `res.on("finish")` logged `/reset` for `/__fake/reset`: by the time the response finishes, a mounted router (`app.use("/__fake", router)`) has rewritten `req.url`, and it is not restored for a response sent from inside the router.

**How to apply:** read `req.originalUrl.split("?")[0]` when the middleware runs and use that captured value in the finish handler. Same trap for anything that classifies a request by area after routing (services/fake-bsc `src/app.ts`, services/browser loggers).
