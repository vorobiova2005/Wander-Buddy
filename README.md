# 🧭 Wander Buddy

> **Where can I go this weekend?** 🚆 A trip planner for exchange students that turns open transit data
> and AI into a ready-made day trip, played as a little quest. 🗺️✨

[![CI](https://github.com/vorobiova2005/Wander-Buddy/actions/workflows/ci.yml/badge.svg)](https://github.com/vorobiova2005/Wander-Buddy/actions/workflows/ci.yml)
[![CD](https://github.com/vorobiova2005/Wander-Buddy/actions/workflows/cd.yml/badge.svg)](https://github.com/vorobiova2005/Wander-Buddy/actions/workflows/cd.yml)
![Node](https://img.shields.io/badge/node-24-339933?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
![Status](https://img.shields.io/badge/status-in%20development-orange)

🌐 **Live:** [wander-buddy.zebaro.dev](https://wander-buddy.zebaro.dev)

---

## 💡 The idea

You have just arrived in a new country for a semester abroad 🎒. You have a regional transport ticket,
a free Saturday, and no idea which of the towns around you are worth the trip.

**Wander Buddy** answers that in one screen:

1. 📍 **Pick a start** - your city (or your location), the day and how long you are ready to travel.
2. 🚉 **See what is reachable** - towns you can get to by regional trains and buses, with travel time and changes.
3. 🌤️ **Add the context** - the weather on that day and interesting places in each town.
4. 🧮 **Rank the options** - an own scoring formula weighs travel time, weather and things to see.
5. 🤖 **Get an AI verdict** - top 3 picks, a comparison, warnings and a plan for the day, as structured JSON.
6. 🗺️ **Look at the map** - destinations and routes on OpenStreetMap.
7. 🏆 **Play the quest** - a companion character, experience points, levels and visited towns.
   Progress stays in your browser, no account needed.

> 🇺🇦 The interface is in Ukrainian for now. English arrives in the next stage.

## 🚦 Project status

| Stage | What | State |
| ----- | ---- | ----- |
| 🧱 Skeleton | web + API containers, CI/CD, deploy | ✅ done |
| 🚆 Reachability | towns reachable by regional transport ([Transitous](https://transitous.org)) | ⏳ next |
| 🌤️ Enrichment | weather ([Open-Meteo](https://open-meteo.com)) and places ([OpenTripMap](https://opentripmap.io)) | 🔜 |
| 🧮 Scoring | own ranking formula with unit tests | 🔜 |
| 🤖 AI verdict | top 3, plan for the day, JSON schema with a fallback | 🔜 |
| 🗺️ UI | map (Leaflet + OSM), character, quest | 🔜 |
| 📏 Measurements | ~10 routes checked against bahn.de, response time with and without cache | 🔜 |

## 🛠️ Tech stack

| Part | Technology |
| ---- | ---------- |
| 🎨 Web app | [Vite](https://vite.dev) · [React](https://react.dev) · TypeScript · [Tailwind CSS](https://tailwindcss.com) · [react-i18next](https://react.i18next.com) · [Leaflet](https://leafletjs.com) *(map, coming)* |
| ⚙️ API server | [Node.js](https://nodejs.org) 24 · [Hono](https://hono.dev) · TypeScript |
| 🌐 Web server | [nginx](https://nginx.org) - static files + `/api` proxy |
| 🧪 Quality | ESLint · `tsc --strict` · [Vitest](https://vitest.dev) · Testing Library |
| 🐳 Delivery | Docker · GitHub Actions · GitHub Container Registry · `docker compose` over SSH |

## 🏗️ How it fits together

```
 📱 Browser ──► 🌐 wander-buddy-web (nginx)
                   ├─ /          the built React app
                   └─ /api/*  ──► ⚙️ wander-buddy-server (Node + Hono)
                                     └─► 🚆 Transitous · 🌤️ Open-Meteo · 📍 OpenTripMap · 🤖 AI
```

Two containers, one entry point: nginx serves the site and proxies `/api` to the server, so the browser
sees a single origin. The server is not published on the host at all.
All calls to external services and to the AI go **through the server**, so API keys never reach the browser. 🔐

More: [`docs/architecture.md`](docs/architecture.md).

## 🏷️ One version

The [`VERSION`](VERSION) file is the only place the version lives:

- 🎨 the web app reads it at build time and shows it at the bottom of the screen;
- ⚙️ the server reads it at start and returns it from `/api/health`;
- 🚀 a release tag must match it (`v0.1.0` ↔ `0.1.0`), or the deploy stops.

## 📁 Project structure

```
.
├── 🎨 web/                  React app (Vite)
│   ├── nginx.conf           production web server: static files + /api proxy
│   └── src/
│       ├── App.tsx          main screen
│       └── i18n/locales/    UI texts (uk.json)
├── ⚙️ server/               API server (Hono)
│   └── src/
│       ├── app.ts           routes, CORS and the JSON response format
│       ├── version.ts       reads VERSION
│       └── index.ts         entry point
├── 📚 docs/                 technical pages
├── 🔄 .github/workflows/    ci.yml (checks) · cd.yml (deploy)
├── 🐳 Dockerfile            two targets: web and server
├── 🧩 docker-compose.yml    how the server runs both containers
├── 🏷️ VERSION               the one version of the app
└── 📄 LICENSE               MIT
```

## 🚀 Getting started

**You need:** Node.js 24+ and npm. Docker is optional.

```bash
git clone https://github.com/vorobiova2005/Wander-Buddy.git
cd Wander-Buddy
npm ci                  # 📦 installs web + server (npm workspaces)
cp .env.example .env    # 🔑 fill in the keys when a step needs them

npm run dev:server      # ⚙️ API on http://localhost:8080
npm run dev:web         # 🎨 app on http://localhost:5173 (proxies /api to :8080)
```

Open http://localhost:5173. A green dot 🟢 means the app reaches the server.

### 🧰 Useful commands

| Command | What it does |
| ------- | ------------ |
| `npm run check` | ✅ everything CI checks: lint, types, tests for web and server |
| `npm run build` | 📦 production build of both parts |
| `docker compose up --build` | 🐳 both production containers locally → http://localhost:8080 |
| `npm run keys:check -w server` | 🔑 are the API keys in `.env` accepted? (prints verdicts and limits, never the keys) |

## 🔌 API

Every response is JSON with an `ok` flag:

```jsonc
// ✅ success
{ "ok": true, ... }
// ❌ failure
{ "ok": false, "error": { "code": "not_found", "message": "No route GET /api/x" } }
```

| Method | Path | Answer |
| ------ | ---- | ------ |
| `GET` | `/api/health` | `{ "ok": true, "version": "0.1.0" }` - the server is alive 💚 |

CORS allows `https://wander-buddy.zebaro.dev` and `http://localhost:5173` (override with `CORS_ORIGINS`).
New endpoints are added step by step (reachability, enrichment, scoring, AI verdict).

## 🔄 CI/CD

| When | Workflow | What happens |
| ---- | -------- | ------------ |
| push to `main` / pull request | **CI** | 🧪 install → lint → typecheck → tests → build · 🐳 both images build |
| tag `vX.Y.Z` | **CD** | 🧪 the same checks → 🏷️ tag == `VERSION`? → 🐳 build `wander-buddy-server` and `wander-buddy-web` → 📤 push to GHCR → 🚀 `docker compose up` on the server over SSH |

A tag on a red commit never reaches the server.

**Repository settings the deploy needs** (Settings → Environments → `prod`):

| Name | Kind | What |
| ---- | ---- | ---- |
| `SERVER_HOST` | secret | server address |
| `SERVER_USER` | secret | SSH user |
| `SSH_PRIVATE_KEY` | secret | SSH key for that user |
| `GROQ_API_KEY`, `OPENTRIPMAP_API_KEY` | secret | API keys (from the enrichment / AI steps) |
| `SERVER_PORT` | variable | host port of the web container |

## 🎓 About

Wander Buddy starts as a bachelor coursework in Computer Engineering: the **weekend quest** module of a
companion web platform for students in academic mobility programmes. The diploma project builds on the
same code (accounts, PWA, "First 30 days", travelling across Europe).

## 📄 License

[MIT](LICENSE) © 2026 Valentyna Vorobiova. Use it, learn from it, build on it - just keep the copyright notice. 🙌

Made with ☕ and 🚆 by [@vorobiova2005](https://github.com/vorobiova2005).
