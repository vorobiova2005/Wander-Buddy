# 🏗️ Architecture

## Components

```
 📱 Browser
    │  HTTPS
    ▼
 🐳 wander-buddy container  (Node 24 + Hono, port 8080)
    ├─ GET /            → web/dist (React app, built by Vite)
    ├─ GET /<any path>  → index.html (single-page app)
    └─ /api/*           → JSON API
                            ├─► 🚆 Transitous      reachability by regional transport   (step 03)
                            ├─► 🌤️ Open-Meteo      weather                              (step 04)
                            ├─► 📍 OpenTripMap     places of interest                   (step 04)
                            └─► 🤖 AI (Groq)       verdict as JSON                       (step 06)
```

- **One image, one process.** In production the server also serves the built web app (`STATIC_ROOT=./public`),
  so there is one port, one container and no CORS. In development Vite serves the app on `:5173` and proxies
  `/api` to the server on `:8080`.
- **Keys stay on the server.** The browser only talks to `/api`; every external call and every AI call is made
  by the server. Keys come from environment variables (`.env` locally, GitHub Actions secrets in production).
- **No accounts.** Player progress (experience, level, visited towns) lives in the browser's `localStorage`.

## API contract

Defined in `server/src/app.ts`.

| Outcome | Status | Body |
| ------- | ------ | ---- |
| success | 200 | `{ "ok": true, ...payload }` |
| unknown API route | 404 | `{ "ok": false, "error": { "code": "not_found", "message": "..." } }` |
| unexpected failure | 500 | `{ "ok": false, "error": { "code": "internal", "message": "Internal server error" } }` |

`error.code` is machine-readable and stable; `error.message` is for logs, never shown to the user as is
(the web app maps codes to translated texts).

## Delivery

The same CI/CD pattern as [Zebaro24/Zebaro-Core-Bot](https://github.com/Zebaro24/Zebaro-Core-Bot), deployed to the same server.

```
 git push main ─────────► CI  (.github/workflows/ci.yml)
                           npm ci → web: eslint, tsc, vitest → server: tsc, vitest → build

 git push tag vX.Y.Z ───► CD  (.github/workflows/cd.yml)
                           1. the CI workflow again (red → stop)
                           2. tag == VERSION file?            (no → stop)
                           3. docker build → ghcr.io/vorobiova2005/wander-buddy:{X.Y.Z, latest}
                           4. scp docker-compose.yml → server:/srv/wander-buddy/
                           5. ssh: docker compose -p wander-buddy up -d --pull always; docker image prune -f
```

- The local check (`python scripts/gate.py` in the workspace) runs the **same npm scripts** as CI:
  `npm run lint | typecheck | test` in `web/` and `server/`.
- The container restarts on its own (`restart: unless-stopped`) and reports health through
  `HEALTHCHECK` → `GET /api/health`.
- Secrets and variables the deploy needs are listed in the [README](../README.md#-cicd).

## Production

| What | Where |
| ---- | ----- |
| Image | `ghcr.io/vorobiova2005/wander-buddy` |
| Server folder | `/srv/wander-buddy` |
| Public URL | *to be filled after the first deploy* |
| Health | `GET <public URL>/api/health` → `{"ok":true}` |
