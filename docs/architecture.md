# 🏗️ Architecture

## Components

```
 📱 Browser
    │  HTTPS  wander-buddy.zebaro.dev
    ▼
 🔀 server's reverse proxy  →  host port SERVER_PORT
    ▼
 🌐 wander-buddy-web  (nginx, port 80)
    ├─ /             → index.html (React app, built by Vite; no-cache)
    ├─ /assets/*     → hashed build files (cached for a year; missing → 404)
    ├─ /VERSION      → the version file (health check of this container)
    ├─ /<any path>   → index.html (single-page app)
    └─ /api/*        → proxy ─┐
                              ▼
                     ⚙️ wander-buddy-server  (Node 24 + Hono, port 8080, not published on the host)
                              ├─► 🚆 Transitous      reachability by regional transport   (step 03)
                              ├─► 🌤️ Open-Meteo      weather                              (step 04)
                              ├─► 📍 OpenTripMap     places of interest                   (step 04)
                              └─► 🤖 AI (Groq)       verdict as JSON                       (step 06)
```

- **Two containers, one entry point.** nginx serves the site and proxies `/api` to the server by its compose
  service name. The browser sees one origin, so the site itself needs no CORS. nginx re-resolves the server's
  address through Docker's DNS, so a restarted server container does not leave it answering 502.
- **Development** has the same shape: Vite serves the app on `:5173` and proxies `/api` to the server on `:8080`.
- **Keys stay on the server.** The browser only talks to `/api`; every external call and every AI call is made
  by the server. Keys come from environment variables (`.env` locally, GitHub Actions secrets in production).
- **No accounts.** Player progress (experience, level, visited towns) lives in the browser's `localStorage`.

## One version

`VERSION` in the repository root is the only source:

| Who | How |
| --- | --- |
| web | `vite.config.ts` reads `../VERSION` at build time → `__APP_VERSION__`, shown on the screen |
| server | `server/src/version.ts` reads `../../VERSION` at start → `GET /api/health` returns it |
| images | both Docker targets copy the same file (`/app/VERSION`, `/usr/share/nginx/html/VERSION`) |
| release | CD stops if the tag `vX.Y.Z` differs from `VERSION` |

## API contract

Defined in `server/src/app.ts`.

| Outcome | Status | Body |
| ------- | ------ | ---- |
| success | 200 | `{ "ok": true, ...payload }` |
| unknown route | 404 | `{ "ok": false, "error": { "code": "not_found", "message": "..." } }` |
| unexpected failure | 500 | `{ "ok": false, "error": { "code": "internal", "message": "Internal server error" } }` |

`error.code` is machine-readable and stable; `error.message` is for logs, never shown to the user as is
(the web app maps codes to translated texts).

**CORS** (`/api/*`): `https://wander-buddy.zebaro.dev` and `http://localhost:5173` by default,
`CORS_ORIGINS` (comma-separated) overrides. Other origins get no `Access-Control-Allow-Origin`.

## Delivery

The same CI/CD pattern as [Zebaro24/Zebaro-Core-Bot](https://github.com/Zebaro24/Zebaro-Core-Bot), deployed to the same server.

```
 git push main ─────────► CI  (.github/workflows/ci.yml)
                           gate:   npm ci → web: eslint, tsc, vitest → server: tsc, vitest → build
                           docker: build --target server, build --target web

 git push tag vX.Y.Z ───► CD  (.github/workflows/cd.yml), one release at a time
                           1. the CI workflow again (red → stop)
                           2. tag == VERSION file?            (no → stop)
                           3. docker build → ghcr.io/vorobiova2005/wander-buddy-{server,web}:{X.Y.Z, latest}
                           4. scp docker-compose.yml → server:/srv/wander-buddy/
                           5. ssh: docker login ghcr.io; docker compose -p wander-buddy up -d --pull always;
                              docker image prune -f
```

- The local check (`python scripts/gate.py` in the workspace) runs the **same npm scripts** as CI:
  `npm run lint | typecheck | test` in `web/` and `server/`.
- Secrets reach the remote script as environment variables (`envs:` of `appleboy/ssh-action`), never as
  text pasted into it.
- Both containers restart on their own (`restart: unless-stopped`) and have a `HEALTHCHECK`; the web
  container starts only after the server is healthy.
- Secrets and variables the deploy needs are listed in the [README](../README.md#-cicd).

## Production

| What | Where |
| ---- | ----- |
| Site | https://wander-buddy.zebaro.dev |
| Health | `GET https://wander-buddy.zebaro.dev/api/health` → `{"ok":true,"version":"X.Y.Z"}` |
| Images | `ghcr.io/vorobiova2005/wander-buddy-server`, `ghcr.io/vorobiova2005/wander-buddy-web` |
| Server folder | `/srv/wander-buddy` (compose project `wander-buddy`) |
