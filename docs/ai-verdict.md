# 🤖 AI verdict

The formula ranks; the AI explains. `GET /api/verdict` takes the best towns by score, gives them to a language model
with their ids, and gets back a **verdict**: top 3, a comparison, warnings, a plan for the day as a quest and a line
of the companion character. The answer is checked before anyone sees it. Code: `server/src/verdict.ts`,
`server/src/ai/`.

## Data → computation → AI

```
 🚆 Transitous ─┐
 🌤️ Open-Meteo ─┼─► towns + weather + places ─► 🧮 score (formula 3.1) ─► top 5 candidates with ids
 🏰 OpenTripMap ┘                                                              │
                                                                               ▼
                                                     🤖 AI (Groq, JSON mode, schema in the prompt)
                                                                               │
                                                     ✅ check: JSON → schema → every id from the candidates
                                                          │ ok                       │ wrong → ask once more,
                                                          ▼                          ▼  telling what was wrong
                                                     verdict              still wrong / AI down / no key
                                                                                     ▼
                                                                      verdict: null, fallback = ranking by score
```

The user always gets an answer: without the AI it is the formula's ranking (`fallback`), never an error.

## Why ids

The model may only **choose** among the candidates and must name towns (`hunfeld`) and places (`otm:N1637963470`)
by the ids it was given. So every claim of the verdict points at real data, and a check can follow each id back.
The coursework checks that the ids exist and fit (the quest city is the first of the top, the quest's places belong
to it); the diploma can add checking the content against the data (times, weather, facts).

## The answer schema

`VerdictSchema` (zod) in `server/src/ai/types.ts`; the same schema goes to the model as JSON Schema
(`VERDICT_JSON_SCHEMA`).

| Field | Content | Rules |
| ----- | ------- | ----- |
| `top[]` | `{ id, reason }` | 1-3, ids of candidates, no repeats |
| `comparison` | text | ≤ 600 characters |
| `warnings[]` | `{ id?, text }` | ≤ 5; `id` - a candidate, or none for general advice |
| `quest` | `{ cityId, title, steps[] }` | `cityId` = `top[0].id`; 3-8 steps |
| `quest.steps[]` | `{ time, title, placeId?, description, xp }` | `time` HH:MM; `placeId` - a place of that city; `xp` 5-100 |
| `character` | `{ mood, line }` | mood: `happy` · `excited` · `thoughtful` · `worried` |

All texts in Ukrainian (the UI language).

## The prompt

System message (`SYSTEM_PROMPT` in `verdict.ts`), in English for the model, asking for Ukrainian texts:

- the role: Wander Buddy, a cheerful companion for exchange students; day trips with the Deutschland-Ticket;
- the candidates are already ranked by the formula (score and its parts are given);
- choose only among them and use only the given ids in the id fields; follow the ranking unless there is a clear
  reason, and say it;
- texts are for people: names of towns and places, never an id; quest steps are a plan for the day - imperative or
  future tense, never past;
- Ukrainian words ("кава", not "кофе") and never the letters ё, ы, э, ъ;
- names of towns and places exactly as given in the candidates - the original German name, as on the map and on
  signs ("Kloster Schlüchtern"), not translated or transliterated;
- warnings about rain, cold, long trips and transfers, always a reminder to check the train back;
- the quest starts at the arrival time in the first destination, has a lunch or coffee break, xp by effort;
- answer with one JSON object matching the JSON Schema that follows.

User message - the search and the candidates as JSON. One candidate from the real request below:

```json
{
  "origin": "Fulda",
  "date": "2026-11-21",
  "departure": "09:00",
  "maxMinutes": 120,
  "candidates": [
    {
      "id": "hunfeld",
      "name": "Hünfeld",
      "kind": "town",
      "minutes": 35,
      "transfers": 0,
      "arrival": "09:35",
      "station": "Hünfeld Bahnhof",
      "score": {
        "total": 62.8,
        "parts": {
          "trip": 0.708,
          "weather": 0.628,
          "places": 0.52
        },
        "weatherUnknown": false,
        "placesUnknown": false
      },
      "weather": {
        "code": 61,
        "tempMin": 1.2,
        "tempMax": 7.2,
        "rainChance": 39,
        "sunshineHours": 8
      },
      "sightsTotal": 6,
      "places": [
        {
          "id": "otm:N1637963470",
          "name": "Konrad-Zuse-Museum",
          "category": "museum"
        },
        {
          "id": "otm:W89743754",
          "name": "St. Jakobus",
          "category": "architecture"
        },
        {
          "id": "otm:Q106646394",
          "name": "Heilig-Kreuz-Kirche",
          "category": "architecture"
        },
        {
          "id": "otm:N1720838106",
          "name": "St. Bonifatiuskloster",
          "category": "architecture"
        },
        {
          "id": "otm:N7576018388",
          "name": "Roß-Berg",
          "category": "nature"
        },
        {
          "id": "otm:W346615598",
          "name": "St. Antonius",
          "category": "architecture"
        },
        {
          "id": "otm:Q11786767",
          "name": "Museum Modern Art Hünfeld",
          "category": "museum"
        },
        {
          "id": "otm:N1637963444",
          "name": "Kirschberg",
          "category": "nature"
        }
      ]
    },
    "… 4 more candidates of the same shape"
  ]
}
```

## A real answer

Fulda, Saturday 21.11.2026, 09:00, up to 120 min; model `openai/gpt-oss-120b` on Groq, 17.11.2026;
passed the schema and the id check on the first try (`ai.status = "ok"`). Recorded before the rule on place names
(18.11.2026): the translated names below ("Музей Конрада Цузе") are now asked for in the original German instead -
on 18.11.2026 the same search gave "Kloster Schlüchtern", "Lauterschlösschen".

```json
{
  "top": [
    {
      "id": "hunfeld",
      "reason": "Найвища оцінка (62.8), найкоротша поїздка (35 хв) і хороший баланс музеїв і природи."
    },
    {
      "id": "schluchtern",
      "reason": "Дуже хороший бал (61.7), подорож 42 хв, цікаві історичні та природні пам'ятки."
    },
    {
      "id": "steinau-an-der-strasse",
      "reason": "Бал 60.4, поїздка 47 хв, замок і багато природних маршрутів."
    }
  ],
  "comparison": "Hünfeld – найкоротша подорож (35 хв) і найвища загальна оцінка, погода прохолодна, дощ 39 %, 6 цікавих місць, серед яких музей та природа. Schlüchtern – 42 хв, трохи холодніше, дощ 49 %, 7 пам'яток, включаючи синагогу та музей. Steinau an der Straße – 47 хв, схожа погода, дощ 49 %, 7 пам'яток, зокрема замок і природні стежки. Всі три пропонують поєднання культури та природи, але Hünfeld найзручніше за часом і має найвищий бал.",
  "warnings": [
    {
      "id": "hunfeld",
      "text": "Температура 1‑7 °C, можливий дощ – одягайте теплі речі та візьміть парасолю."
    },
    {
      "id": "schluchtern",
      "text": "Температура 2‑8 °C, шанс дощу 49 % – підготуйтесь до вологого погоди."
    },
    {
      "id": "steinau-an-der-strasse",
      "text": "Температура 1.8‑8.5 °C, шанс дощу 49 % – не забудьте водонепроникний плащ."
    },
    {
      "text": "Переконайтеся, що ви знаєте час останнього поїзда назад у Фульду ввечері."
    }
  ],
  "quest": {
    "cityId": "hunfeld",
    "title": "Дослідження Hünfeld",
    "steps": [
      {
        "time": "09:35",
        "title": "Прибуття на станцію",
        "description": "Виходимо з Hünfeld Bahnhof, готові до пригод.",
        "xp": 10
      },
      {
        "time": "09:50",
        "title": "Музей Конрада Цузе",
        "placeId": "otm:N1637963470",
        "description": "Досліджуємо історію обчислювальної техніки.",
        "xp": 20
      },
      {
        "time": "11:30",
        "title": "Прогулянка до Roß‑Berg",
        "placeId": "otm:N7576018388",
        "description": "Насолоджуємося природою та панорамними видами.",
        "xp": 25
      },
      {
        "time": "13:00",
        "title": "Кава та обід",
        "description": "Зупиняємося у затишній кав'ярні в центрі.",
        "xp": 15
      },
      {
        "time": "14:30",
        "title": "Музей сучасного мистецтва",
        "placeId": "otm:Q11786767",
        "description": "Оцінюємо сучасні експозиції.",
        "xp": 20
      },
      {
        "time": "16:00",
        "title": "Повернення до станції",
        "description": "Готуємось до поїзда назад.",
        "xp": 10
      }
    ]
  },
  "character": {
    "mood": "excited",
    "line": "Готові до незабутньої подорожі!"
  }
}
```

## Failures and limits

| Case | `ai.status` | What the user gets |
| ---- | ----------- | ------------------ |
| no `GROQ_API_KEY` or `AI_PROVIDER=none` | `disabled` | the ranking (`fallback`) |
| Groq down, its own timeout, 429 | `unavailable` | the ranking; **the AI is paused for 60 s for every search** |
| our 40 s budget runs out (the AI is slow this once) | `unavailable` on the first try, `invalid` on the second (`problems` say "did not answer in time") | the ranking; kept 2 min; **no pause** for others |
| a search while the AI is paused | `unavailable` | the ranking, without asking the AI |
| more than **20 AI calls this minute** for the whole server | `unavailable` (`problems: ["too many AI calls this minute"]`) | the ranking; kept 10 s (a slot frees up soon) |
| answer not JSON / breaks the schema / unknown ids / fails a check below | (asked once more with the problems) | |
| … wrong again, or under 5 s of the budget left for the second try | `invalid` + `problems[]` | the ranking; not asked again for 2 min |
| no towns reachable | `no_candidates` | empty lists |
| checked verdict | `ok` | the verdict; reused for 6 h |

Groq free plan (17.11.2026): 1 000 requests a day and 8 000 tokens a minute per model. **One verdict costs
≈ 3 400 tokens** (measured: 2 428 in + 948 out with `reasoning_effort: low`), so the minute quota fits about two
fresh verdicts for the whole site - hence the cache (6 h), the shared in-flight call for identical requests, and the
60-second pause after a failure, and the server-wide limit of 20 AI calls a minute. Each call logs its token use.

**Time budget:** both tries together get at most **40 s** (the web proxy waits 90 s for the whole request, and the
towns may already have taken part of it). The rest of the budget goes to the provider as an `AbortSignal`; Groq's
own per-call timeout (45 s) stays as a backstop. Past the budget the user gets the ranking, not an error page.

**Incomplete data** (towns that could not be looked up, weather unavailable, places failed or paused): the verdict
is still made, but kept only 2 min, and the answer carries `enrichment` - the UI can tell "no weather" from "nice
weather".

**Structure checks beyond the schema** (cheap now, a base for the diploma's content checks):

- quest steps go forward in time from the arrival in the quest city, also past midnight after a late train
  (arrival 23:10 → a step at 00:20 is 70 min later, in order); the first step is not before the arrival and the
  last one is at most **16 h** after it;
- no text field contains an id (a city id or a place id like `otm:…`) - ids go only into the id fields;
- no text field contains ё, ы, э or ъ - letters Ukrainian does not have ("Лаутершлёсчен" is asked again).

**Swappable:** the source is `AiProvider` (`completeJson(messages, signal?)` - `signal` ends the wait early),
chosen with `AI_PROVIDER`; the model with
`GROQ_MODEL` (default `openai/gpt-oss-120b`; also available: `openai/gpt-oss-20b`, `qwen/qwen3.8-27b`).

## Measured locally 17.11.2026

| Case | Time |
| ---- | ---- |
| verdict, towns and places already known (default reasoning) | 11.1 s (≈ 10 s of it the model) |
| the same with `reasoning_effort: low` | 5.9 s, 3 376 tokens |
| same request again | 0.004 s |
