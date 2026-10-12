# Jeju Cafe Finder

A filterable map, recommendation engine and sortable comparison table for
choosing a cafe on Jeju Island, South Korea — with live open/closed status and
weekly opening hours.

**Live app:** https://antoinechalons.github.io/jeju-cafe-finder/

## What this project does

Users can:

- Filter by venue type: All, Cafes, Roasters, Bakers or Pub. Region labels
  remain available in the comparison table and map popups.
- Require any of 13 criteria: open now, open tomorrow, work friendly, outdoor
  seating, desserts, brunch, beautiful view, opens early, books, board games,
  pet friendly, kids friendly and loyalty reward.
- Narrow by size (tiny ≤ 10 seats, medium 11–20, large > 20) and price range
  ($, $$, $$$). Selecting none includes all; unknown values never match a
  selected option.
- See synchronized map markers and table rows, with optional recommendations.
- Identify venue types by both pin shape and colour, with a legend banner above
  the map: croissant for bakery, coffee bean for roastery, cup for cafe and
  beer mug for pub.
- See transparent cafe names above map pins on non-phone landscape screens
  at least 768px wide. Overlapping names are hidden until there is room, for
  example after zooming in; all cafe pins remain visible. Smartphones never
  show map labels, including in landscape mode.
- Select a cafe on the map to see whether it is open now, today's hours,
  tomorrow's first opening time (or closed/unknown), and a `>` toggle for the
  full week.
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

## Display configuration

### Must-have filters

Edit **`docs/filters-config.json`** to configure the "Must have" list. No
JavaScript changes are needed to rename, hide, enable or reorder existing filters:

```json
{ "name": "openNow", "enabled": true, "displayedText": "Open now", "index": 0 }
```

- `name`: stable internal filter identifier. Do not rename it.
- `enabled`: `true` shows the filter; `false` removes it from the frontend,
  including its comparison column and recommendation criteria.
- `displayedText`: exact text shown in the filter list, comparison-column
  headings/tooltips, map-popup tags and recommendation tags. It never goes
  through application translations or changes when switching languages.
  These elements also use `translate="no"` and `notranslate` to opt out of
  browser/automatic page translation; the rest of the UI still translates.
- `index`: nonnegative integer controlling vertical order, sorted numerically
  from lowest to highest. `0` is first, `1` is second, and so on. Use distinct
  consecutive indexes for a predictable order; gaps are allowed and ties
  preserve file order.

The initial configuration keeps the current 13 filters enabled and includes
`localRoast`, `sellsBeans`, `openSunday` and `arcDiscount` as disabled entries.
Omitted filters are also hidden. Commit edits to `main`; GitHub Pages picks
them up through its normal deployment. The browser reloads the JSON on page
load, so refresh an already-open tab after deployment.

Invalid names, duplicate names, missing fields or invalid field types stop
startup with an error instead of silently using different settings.

### Recommendations

The "Recommended for you" panel is controlled by `SHOW_RECOMMENDATIONS` in
`docs/data-config.js`:

```js
var SHOW_RECOMMENDATIONS = false;
```

It is hidden by default. Set this option to `true` to display the panel again.
When disabled, the panel stays hidden during loading and its recommendation
cards are not rendered. Filters, map markers and the comparison table continue
to work normally.

### Map pin colours

Edit **`docs/map-pins-config.json`** to change pin colours. The map pins and
legend use this same configuration, so no CSS or JavaScript changes are needed:

```json
{
  "bakery": { "color": "#B96745" },
  "roastery": { "color": "#3C3C3C" },
  "cafe": { "color": "#55296E" },
  "pub": { "color": "#C2A13A" }
}
```

| Venue kind | Fixed symbol | Default colour |
|---|---|---|
| `bakery` | Croissant | Terra-cotta `#B96745` |
| `roastery` | Coffee bean | Dark grey `#3C3C3C` |
| `cafe` | Coffee cup | Deep purple `#55296E` |
| `pub` | Beer mug | Muted golden yellow `#C2A13A` |

Keep all four keys and use a six-digit hex colour (`#RRGGBB`). Invalid or
missing colours stop startup with an error instead of silently using other
settings. Shapes are fixed by venue kind and do not change when colours are
edited. Pin names/type labels remain accessible without relying on colour;
the legend translates with the English/Korean UI. Closed venues remain
slightly faded, preserving their type colour and shape.

Commit colour edits to `main`, wait for GitHub Pages deployment and refresh
the app. JSON is revalidated on each page load (`cache: "no-cache"`), so
colour-only edits do not need an asset revision bump. For JavaScript, CSS or
HTML changes, bump the shared `?v=` revision on all local assets in
`docs/index.html`; `bootstrap.js` passes it to dynamically loaded `app.js`.

The icons are vendored in `docs/icons/map-pins/` rather than loaded from a
new CDN: the croissant is from Lucide and the filled coffee bean, cup and
beer mug are from Phosphor. Their licence files are included in that folder.

## Opening hours

- Hours are stored as periods per weekday (`mon`…`sun`). A break time is two
  periods on the same day. A day with no periods is closed. A cafe with no
  periods at all shows "Hours unknown".
- A period whose close time is earlier than its open time ends after midnight
  (e.g. `18:00–02:00`), and the app keeps the cafe open into the next day.
- Status is always computed in Korea time (`Asia/Seoul`), whatever the
  visitor's device time zone is, and refreshes every minute.
- `Open now`, `Open tomorrow` and `Opens early` are derived from the hours,
  not stored. `Open tomorrow` matches cafes with any scheduled opening period
  tomorrow in Korea time, including today's overnight periods extending past
  midnight; unknown hours do not match. `Opens early` means opening strictly
  before `EARLY_OPENING` in `docs/data-config.js` (default `10:00`) on at least
  one day of the week.
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
├── bootstrap.js    # Loads database, filters and pin config before app.js starts
├── data-config.js  # Display options, regions, venue types, days, enums, internal filter behavior
├── filters-config.json # Editable filter labels, visibility and vertical order
├── filters-config.js   # Loads and validates the filter JSON
├── map-pins-config.json # Editable venue pin/legend colours
├── map-pins.js      # Loads pin config and creates shared marker/legend symbols
├── icons/map-pins/ # Vendored venue symbols and their licences
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
   and English names/hours notes. Set `publish` (second column) to `true` to show a cafe,
   or `false` to keep it as a hidden draft.
2. Edit `data/blurb.csv` for English descriptions, with columns `id,locale,blurb`
   and exactly one `en` row per cafe, including drafts.
3. Edit `data/hours.csv` for opening periods.
4. Edit `data/translations.csv` for the Korean name, description and hours note.
5. Run the local validation and tests.
6. Commit and push to `main`.
7. Confirm that the `Publish cafe database` workflow succeeds and
   `public-data/cafes.db` was updated.

The data importer joins English descriptions into the existing SQLite
`cafes.blurb` column. The finder database format is unchanged, so no runtime
loader changes are needed for the separate `blurb.csv` source file.

## Add a criterion

A stored criterion affects the data schema and the app. Update:

1. `tools/schema.py`, `tools/db.py` and `data/cafes.csv` in `jeju-cafe-data`.
2. `BOOLEAN_FIELDS` in `docs/db-loader.js`.
3. The `CRITERION_DEFINITIONS` array in `docs/data-config.js` and an entry in
   `docs/filters-config.json`.
4. `criteriaShort` labels for every locale in `docs/i18n.js`.

A criterion derived from hours only needs `computed: true` in
`CRITERION_DEFINITIONS`, a case in `computedValue()` in `docs/app.js`, a JSON
configuration entry and short labels.

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
- Theme defaults to light mode regardless of system preference. The manual
  toggle still supports dark mode, and the choice is not stored.
- Map pins use one theme-aware accent colour for every area. Closed cafes
  remain faded, as explained in the map subtitle; there is no colour legend.
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
