# 🚆 Data sources

Where the server gets its data, what it may do with it, and how to swap a source.

## Swappable by design

The server talks to every external source only through an interface:

| Interface | File | Answers | Used for | Now |
| --------- | ---- | ------- | -------- | --- |
| `TransitProvider` | `transit/types.ts` | `findStations(text)`, `reachableStops({origin, departure, maxMinutes})` | origin search, "where can I get to" | Transitous |
| `LocalityResolver` | `transit/types.ts` | `localityAt({lat, lon})` → `{ name, kind, center }` | grouping stations into towns, the town centre | Transitous |
| `WeatherProvider` | `enrichment/types.ts` | `daily(points, date)` → forecasts | weather on the trip day | Open-Meteo |
| `PlacesProvider` | `enrichment/types.ts` | `near(point, radius)` → places | what to see | OpenTripMap |

Everything else (`reachability.ts`, `destinations.ts`, the API) knows no source by name. Each kind has a
registry (`transit/index.ts`, `enrichment/index.ts`) and a variable: `TRANSIT_PROVIDER`, `LOCALITY_RESOLVER`,
`WEATHER_PROVIDER`, `PLACES_PROVIDER` (`none` turns places off).

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
| heavy requests (`/one-to-all` etc.) light, coordinate above ~720 / 24 h | one-to-all only when a user searches; answers cached 6 h; at most **30 new (uncached) searches a minute for the whole server** - beyond that `429 busy` (joining an identical search already running is free) |
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
5. **Fastest station per town**, sorted by minutes. Stations belong to one town when the town names match and the
   town centres are **at most 15 km** apart; two towns with the same name farther apart (two "Neuhof"s) stay two
   entries. The origin's own town is left out only when its centre is within 15 km of the origin town's centre - a namesake far
   away stays in.

City ids are slugs of the name (`bad-hersfeld`). When several towns in one answer share a name, each of them gets
its centre added (`neuhof-5045-961`, `neuhof-5135-961`), so a town keeps its id whichever of them is faster to reach.
The AI verdict refers to cities by them; the player's visited towns are counted by name and place, not by id.

## Caching

| What | Where | How long | Why |
| ---- | ----- | -------- | --- |
| whole answer of `/api/reachable` | memory | 6 h (2 min if some towns could not be looked up) | the heaviest request; `x-cache: HIT/MISS` header |
| origin name → station | memory | 24 h | the same names are searched again and again |
| station suggestions (`/api/stations`) | memory | 24 h | the same letters are typed again and again |
| origin point → town | memory only | 24 h | an origin can be the user's own location - never written to disk |
| station → town | `STATE_DIR/localities.<resolver>.v2.json` (Docker volume `wander-buddy-state`) | forever | towns do not move; survives restarts and deploys; one file per resolver |
| station → "no town" | memory | 24 h | retried later, never stored for good |

Identical requests that arrive while the first is still running wait for it instead of asking the source again
(a double click, two users searching the same at once). A shared station lookup that fails counts as a gap for
every search waiting on it, so each of them gets the short 2-min cache. The stores on disk are rewritten only when
something changed (a search that learnt nothing new does not touch the file). If a store cannot be saved, the
answer is still given.

Measured locally on 17.11.2026 (Fulda, 120 min):

| Case | Time | Geocoder lookups |
| ---- | ---- | ---------------- |
| first search ever (cold) | 13.2 s | 132 |
| two identical cold searches at once | 13.3 s each | 132 in total (shared) |
| same search again | 0.004 s | 0 |
| new departure time, towns known | 1.4-1.8 s | 0-17 |

## Weather - Open-Meteo

[Open-Meteo](https://open-meteo.com) - no key; free for non-commercial use (no ads or subscriptions; education is
named as non-commercial); data CC BY 4.0 → credit in the footer. Limits (terms, 17.11.2026): under 10 000 calls a
day, 5 000 an hour, 600 a minute.

- `GET /v1/forecast` with **all towns of a search in one call** (comma lists of latitude/longitude, 50 per call):
  `weather_code` (WMO), max/min temperature, precipitation probability and sum, max wind, sunshine duration,
  `timezone=Europe/Berlin`, `start_date = end_date = the trip day`.
- Forecasts reach **15 days ahead**. A later (or past) day is not an error: `enrichment.weather = "out_of_range"`,
  each town's `weather` is `null`. Source down → `"unavailable"`, the rest of the answer still comes.
- Looked up at the **town centre**. Cached 1 h per day and point (memory).

## Places - OpenTripMap

[OpenTripMap](https://dev.opentripmap.org) - free plan: non-commercial, 5 000 requests a day, 10 a second; data
ODbL (OpenStreetMap, Wikidata, Wikipedia) → credit in the footer. Key: `OPENTRIPMAP_API_KEY` (none → no places).

- `GET /0.1/en/places/radius` three times per town, **3 km around the town centre**: sights
  (`museums,historic,architecture,natural,cultural,religion`, rating 2+, up to 8), cafés (up to 3), and
  `format=count` of the sights rated 3 - **how many there are in all** (`sightsTotal`: Frankfurt 265,
  Kassel 100, Sontra 1). The scoring uses that count; the list alone could not tell a town from a city.
- Unnamed objects dropped; one entry per name (a railway or a park can come in many pieces).
- Categories for the app: `museum`, `historic`, `architecture`, `nature`, `culture`, `food`, `other`;
  rating 1-3 (their "heritage" ratings 5-7 / "1h"-"3h" become 1-3).
- **Their limiter is stricter than 10/s in bursts**: at 8/s about 4 of 62 calls still got `429`. Now requests are
  spaced to **5 a second** and a `429` is retried twice (after 1 s and 2 s) → 0 failures in a cold search of 31 towns.
- Found places are kept **30 days** in `STATE_DIR/places.<provider>.v2.json` (Docker volume): sights hardly change, and
  a deploy does not cost the daily quota again. Lists older than 30 days are dropped when the server starts, so the
  file does not grow for ever. A failed town is not stored and is asked again next time.
- **Quota protection** (code review, 17.11.2026): places are asked only for towns, **never for villages** (even with
  `villages=true`), and for at most **40 towns per search**, fastest first - one anonymous request with
  `maxMinutes=180&villages=true` cannot spend the day's 5 000 calls. The rest get `places: []`
  (`enrichment.placesSkipped` counts them).
- **Circuit breaker**: after **3 failures in a row** (source down, or the day's quota spent) the places source is left
  alone for **10 minutes**; meanwhile stored (even outdated) or empty lists are served and
  `enrichment.placesPaused` is `true`. Without it a dead source got ~186 requests per search.
- `x-cache` on `/api/destinations` tells about the reachability part only; weather and places have their own caches.

## Town centre vs fastest station

The time to a town is the time to its **fastest** station - sometimes a suburban stop (Eisenach → "Hörschel Hp",
Frankfurt → "Frankfurt (Main) Süd"). Weather and places around that stop gave the suburb (Hörschel churches instead of
the old town). So the locality resolver also returns the town's **centre** - its place node in OSM - and weather and
places are looked up there. With it Eisenach gets Georgenkirche, Stadtschloss and Rathaus; Frankfurt gets the Römer.

## `/api/destinations` - measured locally 17.11.2026

Fulda, Sat 21.11.2026 09:00, 120 min → 31 towns, every one with weather and places, 0 failures.

| Case | Time | What was asked |
| ---- | ---- | -------------- |
| first search ever (nothing known) | 29 s | one-to-all, 132 station lookups, 1 weather call, 62 places calls |
| same search again | 0.009 s | nothing |
| another departure time (towns, places known) | 0.5 s | one-to-all + weather from cache |

## Origin search safety

Geocoders are fuzzy: "Atlantisxyz" once came back as "Atlantic Av" in New York and started a search there.
So an origin must be in `ORIGIN_COUNTRIES` (default `DE`) and every word of the query (3+ letters) must start a
word of the station name. Otherwise the API answers `404 origin_not_found` without a routing request.

A start given as `lat`/`lon` is checked against rough boxes of the `ORIGIN_COUNTRIES` (`COUNTRY_BOXES` in
`reachability.ts`: DE, AT, CH, NL, BE, LU, DK, CZ, PL, FR): a point outside every allowed country's box gets
`400 origin_outside` before any request; a country without a box is not checked. An empty `lat=` or `lon=` is
`400 bad_request` (it must not become the point 0,0).

`/api/stations` takes `q` of 2-100 characters (anything else is `400 bad_request`).
