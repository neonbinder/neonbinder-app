---
name: patterns-local-production-build-with-testing-sign-in
description: Plain `vite preview` has no /api/auth/testing (the clerk-testing-api plugin is configureServer-only), so signIn fails on a prod build; hook the same plugin into configurePreviewServer from a scratch script
metadata:
  type: reference
---

To reproduce a CI-only red (one a dev server hides, e.g. StrictMode double
effects, [[strictmode-masks-single-invocation-effect-bugs]]) you need a
production bundle that the specs can still sign in to.

- `vite.config.ts`'s `clerk-testing-api` plugin is `apply: "serve"` with only a
  `configureServer` hook, so `vite preview` serves the SPA but POST
  `/api/auth/testing` falls through (no sign-in). CI does not hit this: its
  `bypass-proxy.mjs` forwards to the Vercel preview, where `api/auth/testing.ts`
  answers.
- Without editing product files: a scratch Node script imports the worktree's
  `node_modules/vite/dist/node/index.js` and calls `vite.preview({ configFile:
  <apps/web>/vite.config.ts, mode: "production", build: { outDir }, preview: {
  port, strictPort: true }, plugins: [extra] })`, where `extra` finds the
  `clerk-testing-api` plugin in `configResolved` and calls its
  `configureServer(server)` from `configurePreviewServer` (the handler only uses
  `server.middlewares`). Run it with cwd = `apps/web` and
  `VITE_DEV_DISABLE_HTTPS=1`, so the config's `loadEnv` reads `.env.local`.
- Build with `npx vite build --mode production --outDir <scratch>/dist-x`
  (about 1 s on Vite 8). A second commit's build comes from a temporary
  `git worktree add --detach` with `apps/web/node_modules` symlinked and
  `.env.local` copied (remove both with the worktree), served by the same script
  from the branch worktree's config.
- Check it: POST `/api/auth/testing` with no header gives 401 (middleware up);
  the dist's `react-dom-*.js` carries "Minified React error" (production React:
  no StrictMode double effects); the served index.html names the dist's
  `index-<hash>.js`.
- Drive Playwright with `APP_URL=http://localhost:<port>`; e2e-run starts a dev
  Vite instead, so call `npx playwright test` directly with `--output` in the
  scratchpad and `PW_REPORT_DIR` pointed there too.

**Why:** NEO-645's walk URL race showed only on CI's production build; this
setup reproduced the red locally on the pre-fix commit and cleared it on the fix.

**Never move the hook into `vite.config.ts`:** the testing sign-in hook into `vite preview` lives only in the scratch script; putting it in `vite.config.ts` would ship the testing sign-in in a build path.
