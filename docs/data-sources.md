# 🚆 Data sources

Where the server gets its data, what it may do with it, and how to swap a source.

## Swappable by design

The server talks to transport data only through two interfaces (`server/src/transit/types.ts`):

| Interface | Answers | Used for |
| --------- | ------- | -------- |
| `TransitProvider` | `findStations(text)`, `reachableStops({origin, departure, maxMinutes})` | origin search, "where can I get to" |
| `LocalityResolver` | `localityAt({lat, lon})` → `{ name, kind: city \| town \| village }` | grouping stations into towns |

Everything else (`reachability.ts`, the API) knows nothing about Transitous.

**To switch to another API or library** (an unofficial DB client, a self-hosted MOTIS, ...):

1. Write `server/src/transit/<name>.ts` implementing one or both interfaces - map the source's data to
   `Station` / `ReachableStop` (minutes from the departure time with waiting included, vehicles used,
   `rail: true` for railway stations).
2. Add one line to the registry in `server/src/transit/index.ts`.
3. Set `TRANSIT_PROVIDER=<name>` and/or `LOCALITY_RESOLVER=<name>` (`.env`, docker-compose, CD).

The tests in `reachability.test.ts` already run the service on a fake provider - a new source only needs its own
mapping tests (like `transit/transitous.test.ts`).

## Transitous (current provider for both)

[Transitous](https://transitous.org) is a free, community-run [MOTIS](https://github.com/motis-project/motis)
instance with European timetables. No key.

| Endpoint | What for | Weight |
| -------- | -------- | ------ |
| `GET /api/v6/one-to-all` | every stop reachable within N minutes | **heavy** - only on a user's search, cached |
| `GET /api/v1/geocode` (`type=STOP`) | origin search | light |
| `GET /api/v1/reverse-geocode` (`type=STOP`) | the municipality of a station (OSM admin areas) | light, cached forever |
| `GET /api/v1/geocode` (`type=PLACE`) | is that municipality a town or a village (OSM place category) | light, cached forever |

**Usage policy** ([transitous.org/api](https://transitous.org/api/), checked 17.11.2026) and how we follow it:

| Policy | Here |
| ------ | ---- |
| open-source, non-commercial | MIT, no ads or subscriptions |
| User-Agent with name, version, contact | `WanderBuddy/<VERSION> (+https://wander-buddy.zebaro.dev)` |
| heavy requests (`/one-to-all` etc.) light, coordinate above ~720 / 24 h | one-to-all only when a user searches; answers cached 6 h |
| link to the sources page, OpenStreetMap attribution | footer of the site |

### Query

`one=<lat>,<lon>`, `time=<departure, UTC>`, `maxTravelTime=<minutes>`, `arriveBy=false`,
`transitModes=REGIONAL_FAST_RAIL,REGIONAL_RAIL,SUBURBAN,BUS,TRAM,SUBWAY,FERRY` - what the Deutschland-Ticket
covers (no high-speed, long-distance, night trains, coaches, planes).

`duration` in the answer counts from the departure time, **waiting for the first vehicle included**; `k` is the
number of vehicles used (transfers = k - 1).

## From stops to towns

One search from Fulda (Sat 21.11.2026 09:00, 120 min) returns about **3 600 stops** (1.2 MB). The server turns them
into about **30 towns**:

1. **Rail stops only** (~730): a day trip goes to a town with a station. A town reachable only by bus is not shown.
2. **Merge stops within 400 m** (~130 stations): platforms and the same station from several timetable feeds.
3. **Municipality of each station**: OSM admin level 8 (Gemeinde/Stadt), or level 6 for a city that is its own
   district (Frankfurt, Kassel, Hanau, Würzburg) - districts (Landkreis, ...-Kreis) are never taken for a town.
4. **Town or village**: OSM place category of the municipality - `city`/`town` → town, anything else → village.
   Villages are hidden unless `villages=true`.
5. **Fastest station per town**, the origin's own town left out, sorted by minutes.

City ids are slugs of the name (`bad-hersfeld`) - the AI verdict refers to cities by them.

## Caching

| What | Where | How long | Why |
| ---- | ----- | -------- | --- |
| whole answer of `/api/reachable` | memory | 6 h (2 min if some towns could not be looked up) | the heaviest request; `x-cache: HIT/MISS` header |
| origin name → station | memory | 24 h | the same names are searched again and again |
| origin point → town | memory only | 24 h | an origin can be the user's own location - never written to disk |
| station → town | `STATE_DIR/localities.<resolver>.json` (Docker volume `wander-buddy-state`) | forever | towns do not move; survives restarts and deploys; one file per resolver |
| station → "no town" | memory | 24 h | retried later, never stored for good |

Identical requests that arrive while the first is still running wait for it instead of asking the source again
(a double click, two users searching the same at once). If the store cannot be saved, the answer is still given.

Measured locally on 17.11.2026 (Fulda, 120 min):

| Case | Time | Geocoder lookups |
| ---- | ---- | ---------------- |
| first search ever (cold) | 13.2 s | 132 |
| two identical cold searches at once | 13.3 s each | 132 in total (shared) |
| same search again | 0.004 s | 0 |
| new departure time, towns known | 1.4-1.8 s | 0-17 |

## Origin search safety

Geocoders are fuzzy: "Atlantisxyz" once came back as "Atlantic Av" in New York and started a search there.
So an origin must be in `ORIGIN_COUNTRIES` (default `DE`) and every word of the query (3+ letters) must start a
word of the station name. Otherwise the API answers `404 origin_not_found` without a routing request.
