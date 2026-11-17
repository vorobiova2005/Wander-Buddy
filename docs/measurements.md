# 📏 Measurements

Two questions, real numbers only:

1. **Accuracy** - does Wander Buddy (on [Transitous](https://transitous.org) data) find the same journeys as Deutsche
   Bahn's own planner?
2. **Speed** - how long does an answer take, for a new search and for the same search again (cache)?

Measured on **17.11.2026** with `npm run measure -w server -- routes | timing` (`server/scripts/measure.ts`). Raw
numbers: [`measurements-data/`](measurements-data/) (`routes.json`, `timing.json`, `timing-empty-server.json`).

## 1. Accuracy: 10 control routes vs bahn.de

Origin **Fulda**, **Saturday 21.11.2026**, departure from **09:00**, regional transport only (what the
Deutschland-Ticket covers). bahn.de side: [`control-routes.md`](control-routes.md) - the first connection at or after
09:00 with the filter "Deutschland-Ticket connections only". Wander Buddy side: production
(`/api/reachable?from=Fulda&date=2026-11-21&time=09:00&maxMinutes=180`, 233 towns), the fastest station of each town.

**Pass threshold** (fixed before measuring): arrival within **±10 min** of bahn.de.

| # | Town | bahn.de arrival | Wander Buddy arrival | Δ min | Min. from 09:00 (bahn.de / WB) | Transfers (bahn.de / WB) | WB arrives at |
| -: | ---- | --------------- | -------------------- | ----: | ------------------------------ | ------------------------ | ------------- |
| 1 | Schlüchtern | 09:37 | 09:42 | +5 | 37 / 42 | 0 / 0 | Schlüchtern Bahnhof |
| 2 | Bad Hersfeld | 09:48 | 09:53 | +5 | 48 / 53 | 0 / 0 | Bad Hersfeld Bahnhof |
| 3 | Gelnhausen | 09:59 | 10:04 | +5 | 59 / 64 | 0 / 0 | Gelnhausen Bahnhof |
| 4 | Hanau | 10:13 | 10:18 | +5 | 73 / 78 | 0 / 0 | Hanau Hauptbahnhof |
| 5 | Eisenach | 10:40 | 10:32 | −8 | 100 / 92 | 1 / 1 | Hörschel Hp |
| 6 | Frankfurt am Main | 10:33 | 10:31 | −2 | 93 / 91 | 0 / 0 | Frankfurt (Main) Süd |
| 7 | Kassel | 10:51 | 10:52 | +1 | 111 / 112 | 0 / 0 | Kassel-Wilhelmshöhe |
| 8 | Gießen | 11:16 | 11:16 | 0 | 136 / 136 | 0 / 0 | Gießen Licher Straße |
| 9 | Würzburg | 12:00 | 11:56 | −4 | 180 / 176 | 1 / 1 | Würzburg-Zell |
| 10 | Marburg | 11:34 | 11:39 | +5 | 154 / 159 | 2 / 2 | Marburg Hauptbahnhof |

**Result:** all **10 / 10** towns found; **10 / 10** within ±10 min; mean |Δ| **4.0 min**, largest 8 min;
transfers equal on **10 / 10** (including the 2-transfer train + bus journey to Marburg).

What the differences are:

- **+5 min on the direct trains** (rows 1-4, 10): the same train and line as on bahn.de, but Transitous' one-to-all
  search gives an arrival exactly 5 minutes later. The constant offset suggests a fixed allowance added at the
  destination by the routing engine; the cause is **not verified** here. For a day trip it errs on the safe side
  (the user arrives earlier than shown, never later).
- **Earlier arrivals** (rows 5, 6, 8, 9) are not errors: Wander Buddy counts a town reached at its **first** station,
  bahn.de was asked for the main station. Eisenach is reached at Hörschel (a stop inside Eisenach, 8 min earlier),
  Frankfurt at Frankfurt Süd, Würzburg at Würzburg-Zell. Weather and places are looked up at the town centre, not at
  that station (step 04), so the plan for the day is not affected.
- "Minutes from 09:00" includes waiting for the first departure (a user leaving at 09:00 cares about that); bahn.de's
  "duration" in `control-routes.md` does not.

## 2. Speed: a new search vs the same search again

What a visit asks, in this order: the towns (`/api/reachable`), towns with weather, places and score
(`/api/destinations`), the AI verdict (`/api/verdict`). Search: Fulda, Sat 28.11.2026, up to 120 min.

- **New search** - a departure time nobody asked before: the answer is computed (Transitous, Open-Meteo,
  OpenTripMap, Groq). Station → town and places stay known from earlier searches, as for a real user.
- **Repeated** - the same search again: answered from the server's cache (`x-cache: HIT`).
- Time measured on the client: from sending the request to the whole JSON received.

### Production (https://wander-buddy.zebaro.dev, a measuring laptop in Germany)

| Endpoint | New search: mean | median | min - max | n | Repeated: mean | median | min - max | n |
| -------- | ---: | ---: | ---: | -: | ---: | ---: | ---: | -: |
| `/api/health` | - | - | - | - | 63 ms | 49 ms | 36 - 147 ms | 10 |
| `/api/stations?q=Fulda` | - | - | - | - | 74 ms | 70 ms | 66 - 92 ms | 10 |
| `/api/reachable` | 363 ms | 377 ms | 332 - 380 ms | 3 | 42 ms | 37 ms | 36 - 65 ms | 30 |
| `/api/destinations` | 726 ms | 1.1 s | 57 ms - 1.1 s | 3 | 48 ms | 47 ms | 42 - 67 ms | 30 |
| `/api/verdict` (AI) | 2.5 s | 2.5 s | 2.1 - 2.7 s | 3 | 42 ms | 39 ms | 34 - 63 ms | 30 |

A whole new search (towns → details → verdict) takes **about 3.6 s**; the same search again about **0.13 s**
(≈ 28 times faster). Every verdict was checked and accepted on the first try (`ai.status = ok`).

### The worst case: an empty server (nothing known yet)

The same measurement on a local server started with an empty state folder (no station → town answers, no places):
every station has to be turned into a town and every town's places fetched.

| Endpoint | First search ever | The same search again (n = 3, mean) |
| -------- | ---: | ---: |
| `/api/reachable` | 8.5 s | 2 ms |
| `/api/destinations` | 13.6 s | 9 ms |
| `/api/verdict` (AI) | 2.9 s | 2 ms |

**About 25 s** for the very first search on an empty server - that is why the station → town answers and the places
are kept on the server's volume (30 days for places) and survive deploys: after the first searches of a region, a
new search is about 3-4 s.

## Limits of these measurements

- One origin (Fulda) and one day of the week (Saturday); timetables change in mid-December - after that the control
  routes are to be taken again on bahn.de (`control-routes.md`).
- Few new searches (3 on production, 1 on the empty server): new searches cost the free quotas of the sources
  (Groq: 8 000 tokens a minute, one verdict ≈ 3 400) and are spaced a minute apart; repeated searches cost nothing
  and are measured more often.
- Network time is included (client → server in Germany).
