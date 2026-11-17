# 🧮 Scoring

How attractive a destination is for a day trip - one number from 0 to 100. The code is a pure function,
`server/src/scoring.ts`; this page is its specification, and the worked example below is a unit test
(`server/src/scoring.test.ts`).

## The formula

$$
S = 100 \cdot (w_T \cdot T + w_W \cdot W + w_P \cdot P), \qquad w_T + w_W + w_P = 1 \tag{3.1}
$$

| Symbol | Meaning | Value |
| ------ | ------- | ----- |
| $S$ | score of the destination | 0 … 100 |
| $T$ | the trip: how easy it is to get there | 0 … 1 |
| $W$ | the weather on the trip day | 0 … 1 |
| $P$ | the places: how much there is to see | 0 … 1 |
| $w_T, w_W, w_P$ | weights | **0.4, 0.3, 0.3** ("Balance", chosen 17.11.2026) |

### T - the trip

$$
T = \left(1 - \frac{t}{t_{max}}\right) \cdot 0.85^{\,k}
$$

- $t$ - minutes from the chosen departure time to the arrival, **waiting for the first vehicle included**;
- $t_{max}$ - the user's limit ("up to 2 hours" → 120); $T$ is relative to it, never below 0;
- $k$ - transfers; each one keeps 85 % of $T$ (costs 15 %): a transfer is a risk of a missed connection.

### W - the weather

$$
W = 0.4 \cdot (1 - p) + 0.3 \cdot \min\!\left(1, \frac{h_{sun}}{10}\right) + 0.3 \cdot C(\tau_{max})
$$

- $p$ - probability of precipitation (0 … 1); without it, judged by the amount: $\min(1, \text{mm} / 5)$;
- $h_{sun}$ - hours of sunshine; 10 h counts as a fully sunny day;
- $C(\tau_{max})$ - comfort of the maximum temperature: 0 at ≤ 0 °C, rising linearly to 1 at 15 °C,
  1 up to 25 °C, falling linearly to 0 at 32 °C;
- $W$ is **halved** for severe weather (WMO codes 56, 57, 66, 67 freezing drizzle/rain; 75, 86 heavy snow;
  95, 96, 99 thunderstorm);
- no forecast (more than 15 days ahead) → $W = 0.5$, and the answer says `weatherUnknown: true`.

### P - the places

$$
P = 0.7 \cdot \min\!\left(1, \frac{\ln(1 + N)}{\ln(1 + 100)}\right) + 0.3 \cdot \min\!\left(1, \frac{K}{4}\right)
$$

- $N$ - **all** notable sights within 3 km of the town centre (OpenTripMap, top popularity rating 3):
  Frankfurt 265, Kassel 100, Eisenach 74, Hanau 39, Schlüchtern 7, Sontra 1. 100 counts as "plenty";
  the logarithm makes going from 1 to 10 sights matter more than from 200 to 265;
- $K$ - different kinds (museum, historic, architecture, nature, culture, other) among the best listed sights;
  4 kinds count as "varied"; cafés are not sights;
- places **not looked up** (no list and no count: the source failed or is paused, a village, beyond the 40-town cap)
  → $P = 0.5$ and `placesUnknown: true` - unknown is not "nothing to see", same rule as the weather. Looked up and
  really nothing there ($N = 0$) is a known 0.

> **Why $N$ and not the list.** A first version scored the list of the best 8 sights. Almost every town has 8 sights
> rated 3, so $P$ was 0.9-1.0 everywhere - Hünfeld scored like Frankfurt and the ranking was the trip time alone.
> The total count $N$ separates them.

## Worked example - Schlüchtern

From Fulda, Saturday 21.11.2026, departure 09:00, limit 120 min. Real data from `/api/destinations` (17.11.2026):
42 min, 0 transfers; WMO 61 (light rain), max 8.3 °C, rain 49 %, sunshine 6.8 h; 7 notable sights;
best sights of 4 kinds (architecture, historic, nature, museum).

| Part | Calculation | Value |
| ---- | ----------- | ----- |
| $T$ | $(1 - 42/120) \cdot 0.85^0 = 0.65 \cdot 1$ | **0.650** |
| $W$ | $0.4 \cdot (1 - 0.49) + 0.3 \cdot (6.8/10) + 0.3 \cdot (8.3/15) = 0.204 + 0.204 + 0.166$ | **0.574** |
| $P$ | $0.7 \cdot \ln 8 / \ln 101 + 0.3 \cdot 4/4 = 0.7 \cdot 0.4506 + 0.3$ | **0.615** |
| $S$ | $100 \cdot (0.4 \cdot 0.650 + 0.3 \cdot 0.574 + 0.3 \cdot 0.615) = 100 \cdot (0.260 + 0.172 + 0.185)$ | **61.7** |

## Choosing the weights

Three variants on the same real data (Fulda, Sat 21.11.2026 09:00, 120 min, 31 towns), top 6:

| # | Balance 0.4 / 0.3 / 0.3 ✅ | Closer 0.5 / 0.25 / 0.25 | Impressions 0.25 / 0.3 / 0.45 |
| -: | --- | --- | --- |
| 1 | Hünfeld 62.8 (35 min, 6 sights) | Hünfeld 64.1 | Kassel 67.3 (112 min, 100) |
| 2 | Schlüchtern 61.7 (42 min, 7) | Schlüchtern 62.2 | Offenbach 66.7 (87 min, 68) |
| 3 | Steinau a. d. Straße 60.4 (47 min, 7) | Steinau a. d. Straße 60.5 | Frankfurt 66.0 (91 min, 265) |
| 4 | Bad Hersfeld 58.3 (53 min, 8) | Bad Hersfeld 57.9 | Hanau 64.6 (78 min, 39) |
| 5 | Hanau 56.9 (78 min, 39) | Wächtersbach 53.6 (57 min, 6) | Eisenach 64.2 (92 min, 74) |
| 6 | Offenbach 56.7 (87 min, 68) | Hanau 53.3 | Schlüchtern 61.2 |

**Balance** was chosen: its top mixes short trips to small towns with bigger cities a bit further away, so the AI
verdict (step 06) has real alternatives to compare. "Closer" leaves out every bigger city; "Impressions" puts
trips of almost two hours first.

## Where the score is used

`GET /api/destinations` returns every town with `score: { total, parts: { trip, weather, places }, weatherUnknown, placesUnknown }`
and `weights`, **sorted by score**. The AI verdict gets the best candidates with their parts, so it can explain
the choice instead of inventing one.

## Changing it

The weights are `DEFAULT_WEIGHTS`, the constants `SCORING` in `scoring.ts`. Changing either changes the worked
example: update this page, the test, and formula 3.1 with its example in the coursework.
