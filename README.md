# Jeju Cafe Finder

A filterable map, recommendation engine and sortable comparison table for
choosing a cafe on Jeju Island, South Korea — with live open/closed status and
weekly opening hours.

**Live app:** https://antoinechalons.github.io/jeju-cafe-finder/

## What this project does

Users can:

- Filter by area of the island (North, East, South, West).
- Require any of 16 criteria: open now, work friendly, local roast, sells beans
  or ground coffee, outdoor seating, desserts, brunch, overlooks a view, opens
  early, open on Sunday, ARC resident discount, loyalty reward, books, board
  games, pet friendly and kids friendly.
- Narrow by size (tiny ≤ 10 seats, medium 11–20, large > 20) and price range
  ($, $$, $$$). Selecting none includes all; unknown values never match a
  selected option.
- See synchronized recommendations, map markers and table rows.
- Select a cafe on the map to see whether it is open now, today's hours, and a
  `>` toggle for the full week.
- See contact details in the map popup when available: Instagram, Facebook
  and KakaoTalk logos (a channel URL opens it; a plain Kakao ID is copied),
  plus a tap-to-call phone number and an email link.
- Open each cafe in Naver Map.
- Only cafes marked `publish=true` in the data appear. Drafts
  (`publish=false`) are left out of the public database, and the app also
  ignores any row with `publish = 0`.
- Switch between English and Korean.
- Use the responsive interface in light or dark mode.

The browser downloads a generated SQLite database and queries it with sql.js.
The app is a static GitHub Pages site with no application server. Counts shown
in the interface come from the loaded database.

## Opening hours

- Hours are stored as periods per weekday (`mon`…`sun`). A break time is two
  periods on the same day. A day with no periods is closed. A cafe with no
  periods at all shows "Hours unknown".
- A period whose close time is earlier than its open time ends after midnight
  (e.g. `18:00–02:00`), and the app keeps the cafe open into the next day.
- Status is always computed in Korea time (`Asia/Seoul`), whatever the
  visitor's device time zone is, and refreshes every minute.
- `Open now`, `Opens early` and `Open on Sunday` are derived from the hours,
  not stored. The early threshold is `EARLY_OPENING` in `docs/data-config.js`
  (default `08:00`).
- For testing, `?at=sat-23:30` freezes the clock at that Korea weekday and time.

## Data architecture

| Repository | Visibility | Purpose |
|---|---|---|
| `AntoineChalons/jeju-cafe-finder` | Public | Static web app and UI translations |
| `AntoineChalons/jeju-cafe-data` | Private | Source CSV files, validation, tests and SQLite build tools |
| [`AntoineChalons/public-data`](https://github.com/AntoineChalons/public-data) | Public | Generated `cafes.db` artifact |

The CSV files in the private data repository are the source of truth. A GitHub
Actions workflow validates them, builds `cafes.db`, checks its integrity and
publishes only the database to `public-data`.

The production app loads:

```text
https://antoinechalons.github.io/public-data/cafes.db
```

Do not add source CSV files or generated database files to this repository.

## Tech stack

| Layer | Choice |
|---|---|
| Structure | Plain HTML5 |
| Styling | Plain CSS with custom properties |
| Logic | Vanilla JavaScript |
| Data query | sql.js and WebAssembly (vendored 1.13.0) |
| Map | MapLibre GL JS 5.24.0 |
| Tiles | OpenFreeMap |
| Icons | Lucide 1.52.0 |
| Fonts | Eczar, Hanken Grotesk, Inter, Noto Sans KR |
| Hosting | GitHub Pages |

There is no package manager, bundler or application backend. Third-party
scripts are pinned to exact versions.

## Project structure

```text
docs/
├── app.js          # Filters, hours logic, recommendations, map, table, UI
├── bootstrap.js    # Loads the database before app.js starts
├── data-config.js  # Areas, days, enums, criteria, early-opening threshold
├── db-loader.js    # Downloads and queries cafes.db with sql.js
├── i18n.js         # UI translations (en, ko)
├── index.html      # Page markup and third-party scripts
├── style.css       # Design tokens and responsive styling
└── vendor/sql.js/  # Pinned sql.js runtime and license
tools/
└── serve_cors.py   # Local static server with CORS, for testing a built cafes.db
```

Runtime data flow:

```text
private CSV files
  -> validation and SQLite build
  -> public-data/cafes.db
  -> db-loader.js
  -> CAFES and CAFE_TRANSLATIONS
  -> app.js
```

## Run locally

```bash
python3 -m http.server 8000 --directory docs
```

Then open `http://localhost:8000`. By default the local app uses the published
database.

To test a locally built database from `jeju-cafe-data`:

```bash
python3 tools/serve_cors.py 8001 /path/to/jeju-cafe-data/build
```

Then open:

```text
http://localhost:8000/?database=http://localhost:8001/cafes.db
```

You can also set `window.JEJU_CAFE_DATABASE_URL` before `db-loader.js` runs.

## Update cafe data

Data changes belong in the private `jeju-cafe-data` repository, whose README
documents every column.

1. Edit `data/cafes.csv` for facts, coordinates, size, price, criteria, links
   and English text. Set `publish` (second column) to `true` to show a cafe,
   or `false` to keep it as a hidden draft.
2. Edit `data/hours.csv` for opening periods.
3. Edit `data/translations.csv` for the Korean name, description and hours note.
4. Run the local validation and tests.
5. Commit and push to `main`.
6. Confirm that the `Publish cafe database` workflow succeeds and
   `public-data/cafes.db` was updated.

## Add a criterion

A stored criterion affects the data schema and the app. Update:

1. `tools/schema.py`, `tools/db.py` and `data/cafes.csv` in `jeju-cafe-data`.
2. `BOOLEAN_FIELDS` in `docs/db-loader.js`.
3. The `CRITERIA` array in `docs/data-config.js`.
4. `criteria` and `criteriaShort` labels for every locale in `docs/i18n.js`.

A criterion derived from hours only needs `computed: true` in `CRITERIA`, a
case in `computedValue()` in `docs/app.js`, and labels.

## Add a language

1. Add the locale to `LOCALES` in `tools/schema.py` and the `CHECK` constraint
   in `tools/db.py`, then add a `translations.csv` row per cafe.
2. Add a block to `APP_TRANSLATIONS` in `docs/i18n.js`.
3. Add it to `SUPPORTED_LOCALES`, `LOCALE_NAMES`, `LOCALE_CODES` and
   `browserLocale()` in `docs/app.js`, and a button in the language menu in
   `docs/index.html`.

## Design decisions

- Warm palette inspired by [Cafe Cartographer](https://cafecartographer.com/):
  cream paper, espresso ink, coral, sage and golden-hour accents.
- Theme follows the system preference and is not stored.
- Language follows browser preferences, with `?lang=en` or `?lang=ko` as a
  shareable override. No IP-based detection.
- MapLibre and OpenFreeMap provide the map without an API key; cafe names link
  to Naver Map rather than an embedded Naver SDK.
- Classifications are conservative: a criterion is `1` only when confirmed.
  Hours can change, so the app shows when they were last checked.
- Source URLs stay attached to each record and appear in map popups.

## Contributing

Use the in-app **Suggest an edit** link, which opens a structured issue form.
Code changes can use pull requests in this repository. Data changes require
access to the private `jeju-cafe-data` repository.

## License

MIT
