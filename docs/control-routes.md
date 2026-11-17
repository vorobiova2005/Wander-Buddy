# 🧪 Control routes

Reference journeys for checking the reachability results (step 03) and for the measurements (step 08):
what Wander Buddy computes from Transitous must come close to what Deutsche Bahn's own planner shows.

## How these were taken

| Parameter | Value |
| --------- | ----- |
| Source | [bahn.de](https://www.bahn.de) journey planner (int.bahn.de, English UI) |
| Checked on | 17.11.2026 |
| Travel date | **Saturday 21.11.2026**, departure from 09:00 |
| Origin | Fulda (EVA 8000115) |
| Filters | **"Deutschland-Ticket connections only"** (= regional transport, no ICE/IC), "Show fastest connections", normal transfer time |
| Taken | the first connection departing at or after 09:00 |

EVA numbers are the stations' IDs in the DB system (from the search URL); they help to match stops in tests.

## Routes

| # | Destination | EVA | Dep. | Arr. | Duration | Transfers | Lines | Next ones |
| -: | ----------- | --- | ---- | ---- | -------: | --------: | ----- | --------- |
| 1 | Schlüchtern | 8000891 | 09:12 | 09:37 | 25 min | 0 | RE50 | hourly (10:12, 11:12) |
| 2 | Bad Hersfeld | 8000020 | 09:20 | 09:48 | 28 min | 0 | RB5 | hourly (10:20; also RE50 10:50, 26 min) |
| 3 | Gelnhausen | 8000117 | 09:12 | 09:59 | 47 min | 0 | RE50 | hourly (10:12, 11:12) |
| 4 | Hanau Hbf | 8000150 | 09:12 | 10:13 | 61 min | 0 | RE50 | hourly (10:12, 11:12) |
| 5 | Eisenach Hbf | 8010097 | 09:20 | 10:40 | 80 min | 1 | RB5 → RB6 | hourly (10:20, 11:20) |
| 6 | Frankfurt(Main)Hbf | 8000105 | 09:12 | 10:33 | 81 min | 0 | RE50 | hourly (10:12, 11:12) |
| 7 | Kassel Hbf | 8000193 | 09:20 | 10:51 | 91 min | 0 | RB5 | hourly (10:20, 11:20) |
| 8 | Gießen | 8000124 | 09:33 | 11:16 | 103 min | 0 | RB45 | hourly (10:33, 105 min) |
| 9 | Würzburg Hbf | 8000260 | 10:12 | 12:00 | 108 min | 1 | RE50 → RB53 | every 2 h (12:12, 14:12) |
| 10 | Marburg(Lahn) | 8000337 | 09:33 | 11:34 | 121 min | 2 | RB45 → Bus X35 → RE30 | 10:33 via RB45 → RB41, 153 min |

## What the routes cover

- **Distance:** from 25 min (Schlüchtern) to about 2 h (Marburg) - the range a day trip uses.
- **Directions:** south-west (Schlüchtern, Gelnhausen, Hanau, Frankfurt), north (Bad Hersfeld, Kassel),
  east (Eisenach), west (Gießen, Marburg), south (Würzburg).
- **Transfers:** 0, 1 and 2, including a **bus leg** (Marburg) - the search must not drop mixed train + bus journeys.
- **Frequency:** hourly lines and a two-hourly one (Würzburg: the first connection after 09:00 leaves only at 10:12,
  so "travel time" must include waiting for the first departure, or be reported separately).
- **Several stations per city:** Marburg also has a bus stop "Hauptbahnhof, Marburg" reached in 2 h 10 min with
  1 transfer - grouping stops into cities (step 03) must pick the fastest one.

## How to compare (step 03 / step 08)

For each route: Wander Buddy's travel time to the city vs **Duration** above, and the number of transfers.
The pass threshold (for example ±10 minutes) is a proposal, to be fixed before step 08.

Timetables change: the yearly timetable change is in mid-December. If the measurements (step 08) happen after it,
take these routes again on bahn.de with the same parameters and keep both dates.
