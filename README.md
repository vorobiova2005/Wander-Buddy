# 🧭 Wander Buddy

> **Where can I go this weekend?** 🚆 A trip planner for exchange students that turns open transit data
> and AI into a ready-made day trip, played as a little quest. 🗺️✨

[![CI](https://github.com/vorobiova2005/Wander-Buddy/actions/workflows/ci.yml/badge.svg)](https://github.com/vorobiova2005/Wander-Buddy/actions/workflows/ci.yml)
[![CD](https://github.com/vorobiova2005/Wander-Buddy/actions/workflows/cd.yml/badge.svg)](https://github.com/vorobiova2005/Wander-Buddy/actions/workflows/cd.yml)
![Node](https://img.shields.io/badge/node-24-339933?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![Status](https://img.shields.io/badge/status-in%20development-orange)

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
| 🧱 Skeleton | web app + API server, CI/CD, Docker deploy | ✅ done |
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
| 🧪 Quality | ESLint · `tsc --strict` · [Vitest](https://vitest.dev) · Testing Library |
| 🐳 Delivery | Docker · GitHub Actions · GitHub Container Registry · `docker compose` over SSH |

## 🏗️ How it fits together

```
 📱 Browser ──► 🐳 wander-buddy container (Node + Hono)
                   ├─ /          the built web app (React)
                   └─ /api/*     JSON API ──► 🚆 Transitous · 🌤️ Open-Meteo · 📍 OpenTripMap · 🤖 AI
```

One image, one process: the server answers the API and serves the web app.
All calls to external services and to the AI go **through the server**, so API keys never reach the browser. 🔐

More: [`docs/architecture.md`](docs/architecture.md).

## 📁 Project structure

```
.
├── 🎨 web/                  React app (Vite)
│   └── src/
│       ├── App.tsx          main screen
│       └── i18n/locales/    UI texts (uk.json)
├── ⚙️ server/               API server (Hono)
│   └── src/
│       ├── app.ts           routes and the JSON response format
│       └── index.ts         entry point
├── 📚 docs/                 technical pages
├── 🔄 .github/workflows/    ci.yml (checks) · cd.yml (deploy)
├── 🐳 Dockerfile            one production image
├── 🧩 docker-compose.yml    how the server runs it
└── 🏷️ VERSION               current version
```

## 🚀 Getting started

**You need:** Node.js 24+ and npm.

```bash
git clone https://github.com/vorobiova2005/Wander-Buddy.git
cd Wander-Buddy
npm ci                  # 📦 installs web + server (npm workspaces)
cp .env.example .env    # 🔑 fill in the keys when a step needs them

npm run dev:server      # ⚙️ API on http://localhost:8080
npm run dev:web         # 🎨 app on http://localhost:5173 (proxies /api to :8080)
```

Open http://localhost:5173. A green dot 🟢 at the bottom means the app reaches the server.

### 🧰 Useful commands

| Command | What it does |
| ------- | ------------ |
| `npm run check` | ✅ everything CI checks: lint, types, tests for web and server |
| `npm run build` | 📦 production build of both parts |
| `npm start` | ▶️ run the built server (serves the API, and the app when `STATIC_ROOT` is set) |
| `docker compose up --build` | 🐳 build and run the production image locally on :8080 |

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
| `GET` | `/api/health` | `{ "ok": true }` - the server is alive 💚 |

New endpoints are added step by step (reachability, enrichment, scoring, AI verdict).

## 🔄 CI/CD

| When | Workflow | What happens |
| ---- | -------- | ------------ |
| push to `main` / pull request | **CI** | 🧪 install → lint → typecheck → tests → build |
| tag `vX.Y.Z` | **CD** | 🧪 the same checks → 🐳 build image → 📤 push to `ghcr.io/vorobiova2005/wander-buddy` → 🚀 `docker compose up` on the server over SSH |

A tag on a red commit never reaches the server, and the tag must match the `VERSION` file.

**Repository settings the deploy needs** (Settings → Secrets and variables → Actions, environment `prod`):

| Name | Kind | What |
| ---- | ---- | ---- |
| `SERVER_HOST` | secret | server address |
| `SERVER_USER` | secret | SSH user |
| `SSH_PRIVATE_KEY` | secret | SSH key for that user |
| `GROQ_API_KEY`, `OPENTRIPMAP_API_KEY` | secret | API keys (from the enrichment / AI steps) |
| `SERVER_PORT` | variable | host port the container is published on (default `8080`) |

## 🎓 About

Wander Buddy starts as a bachelor coursework in Computer Engineering: the **weekend quest** module of a
companion web platform for students in academic mobility programmes. The diploma project builds on the
same code (accounts, PWA, "First 30 days", travelling across Europe).

Made with ☕ and 🚆 by [@vorobiova2005](https://github.com/vorobiova2005).
