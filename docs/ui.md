# 🎨 UI

Mockups: **[Wander Buddy in Figma](https://www.figma.com/design/eHJRa1GYGJOchFUhApeLTm/Wander-Buddy)** - the source of truth
for how the app looks. The web app (step 07) is built from it.

## Pages of the Figma file

| Page | What is there |
| ---- | ------------- |
| 🎨 Основи | design tokens as Figma variables (collection "Wander Buddy"): 13 colors, 6 spacings, 4 radii; 7 text styles |
| 🧑‍🚀 Вандер | the companion character, a component with 11 moods |
| 🧩 Компоненти | Кнопка (primary/secondary), Чіп (neutral/primary/accent), Репліка Вандера, Картка міста, Крок квесту (todo/done), Шкала досвіду, Нижнє меню, Верхнє меню (desktop) |
| 📱 Екрани | 1 Пошук · 2 Результати (map, AI verdict, top 3, warnings) · 3 Квест (steps with XP) · 4 Прогрес (level, visited towns, badges) - phone 390 px (mobile first) and desktop 1440 px (D1-D4) |

Texts on screens 2-3 are a real `/api/verdict` answer from production (v0.4.0, Fulda, Sat 21.11.2026).

## Screen sizes

| Width | Layout |
| ----- | ------ |
| < 1024 px | one column, bottom bar; on tablets the column is at most 640 px, centred |
| ≥ 1024 px | top bar (logo, tabs, level), content up to 1200 px; two columns: map or hero on the left, the decision on the right; the results map stays in view while the list scrolls |

The same components and tokens on both; checked by the e2e test on a Pixel 7 and a 1440 × 900 desktop (no sideways
scrolling, the right navigation).

## In the web app

| Screen | What happens |
| ------ | ------------ |
| Пошук | where from (station suggestions from `/api/stations`, or "Я тут" - the browser's location), this weekend's days or another date, departure time, travel limit 30 min - 3 h |
| Результати | the towns appear first, then Вандер's verdict; the map shows the start, the top 3 (orange) and two more; the other towns only when their list is open; pointing at a card highlights its pin; a card or a pin opens the town's quest |
| Квест | the AI's plan for its first town, for any other town a plan from its places (arrival, sights, a café, the way back); a step is done by tapping it (tap again to undo), "+XP" pops up; the way back opens on bahn.de |
| Прогрес | level and title, XP to the next level, towns, quests, the visited towns on a map, 6 badges |

The search is in the URL (`#/results?from=Fulda&date=…`): back works, a reload keeps the screen, a link can be shared.
Progress lives only in this browser (localStorage, no accounts).

**Levels:** level n starts at 25·n·(n−1) XP (0, 50, 150, 300, 500, 750 …) - the first quest (≈ 90 XP) brings
level 2. Titles: Новачок, Пасажир, Мандрівник, Дослідник, Слідопит, Легенда D-Ticket.
**Badges:** Перший потяг (a first step), Замки й мури (a historic or architecture place), Під дощем (a step on a
rainy day), Рання пташка (departure before 07:00), Квест пройдено (all steps of one quest), 10 міст.

**Map:** OpenStreetMap tiles, toned down a little to the palette; attribution in the map corner and in the footer.
Leaflet loads in its own chunk when a screen with a map opens. **Fonts** are served by the app itself
(`@fontsource-variable`), not from Google: no third-party request on page load.

## Tokens

| Token | Value | Use |
| ----- | ----- | --- |
| `color/bg` | `#FFF6E5` | page background |
| `color/surface` | `#FFFFFF` | cards, inputs |
| `color/surface-alt` | `#FCEBD0` | neutral chips, tracks |
| `color/ink` | `#1B2A41` | text, outlines |
| `color/ink-muted` | `#5B6577` | secondary text |
| `color/primary` | `#127C7A` | main actions, scores |
| `color/primary-soft` | `#D5EEEC` | map, done steps |
| `color/on-primary` | `#FFFFFF` | text on primary |
| `color/accent` | `#F2994A` | XP, selected chips, top 3 pins |
| `color/sun` | `#F2C94C` | rank badges, earned badges |
| `color/danger` | `#D9534F` | errors |
| `color/success` | `#3BA776` | done |
| `color/line` | `#E9DCC4` | borders |
| `space/*` | 4, 8, 12, 16, 24, 32 | gaps, paddings |
| `radius/*` | sm 8, md 16, lg 24, pill 999 | corners |

Fonts (Google Fonts, both with Cyrillic): **Unbounded** for headings (Display 28/34 Bold, H1 22/28 SemiBold,
H2 17/22 Medium), **Manrope** for text (Body 15/22, Body Bold, Caption 13/18 Medium, Label 12/16 ExtraBold +6 %).

## Вандер - the companion

An original character: a little traveller with a cap and goggles, an orange bomber jacket with a ticket badge, a
backpack with an antenna lamp and a retro wrist gadget that turns with his forearm. Retro-futuristic in spirit,
but his own design.

| Mood | Who chooses | When | What he does |
| ---- | ----------- | ---- | ------------ |
| `happy` | AI (`character.mood`) | a good plan | smiles |
| `excited` | AI | a great plan | waves, gadget glows, sparkles |
| `thoughtful` | AI | a close call between towns | hand on chin, thought bubbles |
| `worried` | AI | bad weather, long trip | worried brows, sweat drop |
| `sleepy` | app | departure before 07:00 | yawns, coffee, Zzz |
| `rainy` | app | rain ≥ 60 % | umbrella turned inside out |
| `cold` | app | max ≤ 3 °C | scarf, red nose, chattering teeth |
| `hungry` | app | the lunch step of a quest | giant pretzel, drool |
| `lost` | app | nothing found / an error | map upside down, question marks |
| `waiting` | app | the towns or the AI are loading | stares at the gadget showing `--:--` |
| `celebrating` | app | a new level | both arms up, confetti |

The app picks in this order: celebrating → lost → waiting → hungry → cold → rainy → sleepy → the AI's mood → happy
(`web/src/lib/mood.ts`). Each mood has its own funny lines (`wander.lines.*` in `uk.json`); the AI's own line is
shown when its mood wins.
