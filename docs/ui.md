# 🎨 UI

Mockups: **[Wander Buddy in Figma](https://www.figma.com/design/eHJRa1GYGJOchFUhApeLTm/Wander-Buddy)** - the source of truth
for how the app looks. The web app (step 07) is built from it.

## Pages of the Figma file

| Page | What is there |
| ---- | ------------- |
| 🎨 Основи | design tokens as Figma variables (collection "Wander Buddy"): 13 colors, 6 spacings, 4 radii; 7 text styles |
| 🧑‍🚀 Вандер | the companion character, a component with 11 moods |
| 🧩 Компоненти | Кнопка (primary/secondary), Чіп (neutral/primary/accent), Репліка Вандера, Картка міста, Крок квесту (todo/done), Шкала досвіду, Нижнє меню |
| 📱 Екрани | 1 Пошук · 2 Результати (map, AI verdict, top 3, warnings) · 3 Квест (steps with XP) · 4 Прогрес (level, visited towns, badges) - 390 px wide, mobile first |

Texts on screens 2-3 are a real `/api/verdict` answer from production (v0.4.0, Fulda, Sat 21.11.2026).

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
| `waiting` | app | the AI is thinking / a transfer | stares at the gadget showing `--:--` |
| `celebrating` | app | a new level | both arms up, confetti |
