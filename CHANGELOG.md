# 📝 Changelog

All notable changes. Versions follow [Semantic Versioning](https://semver.org); the version lives in [`VERSION`](VERSION).

## [0.4.0] - 2026-11-17

### ✨ Added
- 🧮 **Scoring formula** (3.1): S = 100 · (0.4 · trip + 0.3 · weather + 0.3 · places), each part 0-1;
  `/api/destinations` now gives every town a `score` with its parts and sorts the towns best first.
  Unknown weather or places count as average and are flagged. Specification and a worked example:
  `docs/scoring.md`.
- 🏰 `sightsTotal` - how many notable sights a town has around its centre in all (Frankfurt 265, Kassel 100,
  Sontra 1) - the scoring needs it to tell a small town from a city.
- 🤖 `GET /api/verdict` - the AI verdict over the best 5 towns: top 3 with reasons, a comparison, warnings, a plan for
  the day as a quest with xp, and a line of the companion character. Checked before it is shown (JSON, schema, every
  id from the data, quest times in order and after the arrival); otherwise the ranking by score - never an error.
  Prompt, schema and a real example: `docs/ai-verdict.md`.
- 🔁 The AI source is swappable too: `AI_PROVIDER`, `GROQ_MODEL` (default `openai/gpt-oss-120b`).
- 🛡️ Groq quota protection: verdicts cached 6 h, identical requests share one call, a 60-second pause after a
  failure, little reasoning (`reasoning_effort: low`, ≈ 3 400 tokens per verdict, ~6 s).

## [0.3.0] - 2026-11-17

### ✨ Added
- 🌤️🏰 `GET /api/destinations` - the reachable towns with the **weather on the trip day** (Open-Meteo: WMO code,
  min/max °C, rain chance and mm, wind, sunshine hours; `out_of_range` beyond 15 days) and **places to see**
  (OpenTripMap: sights rated 2+ and cafés, with category and rating), both looked up at the **town centre**.
- 🔁 Weather and places sources are swappable like transport: `WeatherProvider` / `PlacesProvider`,
  `WEATHER_PROVIDER` / `PLACES_PROVIDER` (`none` turns places off).
- 💾 Found places are kept 30 days on the server's volume, so deploys do not spend the daily quota again.
- 🛡️ Quota protection: places only for towns (not villages), at most 40 towns per search, requests spaced to
  5 per second with retries, and a 10-minute pause for a source that keeps failing.
- 🙏 Footer credits Open-Meteo and OpenTripMap.

### 🔧 Changed
- Each town now has a `center` (its place in OpenStreetMap): a suburban fastest station no longer means suburban
  sights (Eisenach: old town instead of Hörschel).

## [0.2.0] - 2026-11-17

### ✨ Added
- 🚆 `GET /api/reachable` - towns reachable by regional transport (what the Deutschland-Ticket covers) from a
  station or a point, for a date, time and travel limit (15-180 min). Each town: minutes with waiting included,
  transfers, arrival, the fastest station. Villages hidden unless `villages=true`.
- 🚉 `GET /api/stations?q=` - station search for the origin (Germany, real name matches only).
- 🔁 Swappable data sources: `TransitProvider` / `LocalityResolver` interfaces; Transitous is the first
  implementation; another API or library = one file + `TRANSIT_PROVIDER`.
- ⚡ Caching: whole answers for 6 h (`x-cache: HIT/MISS`), station → town for good on a Docker volume;
  identical concurrent searches share one request to the source.
- 🔑 `npm run keys:check -w server` - are the API keys accepted (prints verdicts, never keys).
- 🧪 Control routes from Fulda checked on bahn.de (`docs/control-routes.md`).
- 🙏 Footer credits Transitous and OpenStreetMap, as their licences require.

## [0.1.0] - 2026-11-17

### ✨ Added
- 🎨 Web app skeleton: one screen in Ukrainian, a live indicator that the server answers, the app version at the bottom.
- ⚙️ API server: `GET /api/health` → `{ "ok": true, "version": "0.1.0" }`, one JSON error format, CORS for the site.
- 🐳 Two containers: `wander-buddy-web` (nginx: site + `/api` proxy) and `wander-buddy-server` (API).
- 🔄 CI on every push to `main`; CD on a `vX.Y.Z` tag → images in GHCR → deploy to the server.
- 🏷️ One version for web and server from the `VERSION` file.
- 📄 MIT license.
