# AGENTS.md - jeju-cafe-finder (public, static web app)

Guidance for AI coding assistants working in this repository. Read README.md first.

## Scope

This repo is the public front end, served by GitHub Pages from `docs/`.
Source data, validation and database build live in the private `AntoineChalons/jeju-cafe-data` repo.
Generated `cafes.db` is published to `AntoineChalons/public-data`.

Runtime data flow: CSV -> validate -> SQLite -> public-data/cafes.db -> `docs/db-loader.js` -> `docs/app.js`.

## Before you code

1. State which repo each change belongs to: finder (`docs/`, `tests/`, `tools/serve_cors.py`) or data (CSV, `tools/*.py` in jeju-cafe-data).
2. List the files you will touch before writing code.
3. If you need a file that has not been shown, ask for it. Never invent function names, columns or config keys.
4. Keep diffs minimal and keep the existing code style and naming. No unrelated refactors.
5. If unsure, ask one targeted question or state your assumption explicitly.

## Architecture rules (non-negotiable)

- Plain HTML, CSS and vanilla JavaScript only. No frameworks, bundlers, npm packages, TypeScript, build steps or backend.
- Third-party libraries are vendored or pinned to exact versions. Do not add a CDN dependency. Flag anything that would break the "no build step, no backend" principle before proposing it.
- Never add source CSV files or `cafes.db` to this repo. Never edit `cafes.db` directly.
- Drafts (`publish=false`) must never reach the public DB. The app also ignores rows with `publish = 0`.
- Time logic always uses `Asia/Seoul`, never the device time zone. Hours are periods per weekday (`mon`..`sun`). A close earlier than the open means the cafe closes after midnight. `24:00` is a valid close. Overlapping periods are rejected. `?at=sat-23:30` freezes the clock for testing.
- Classification is conservative: a boolean criterion is `1` only when confirmed.
- Config-driven UI:
  - `docs/filters-config.json` holds filter labels and default visibility/order. `enabled` means visible by default, not globally available. Visitors can show, hide and reorder any listed filter through Personalize. Remove an entry to make it unavailable to everyone; never rename `name`. `displayedText` is intentionally not translated (`translate="no"`).
  - `docs/map-pins-config.json` holds pin colours and sizes. Keep all 4 keys (bakery, roastery, cafe, pub), `#RRGGBB` colours and integer pixel sizes.
  - Invalid config must fail at startup with a clear error, never fall back silently.
- The UI is English-only. Every UI string lives in `docs/i18n.js` under `en`. Do not add other locales, a language picker or translated data. The Korean cafe name (`name_kr`) stays as data and is shown under the display name.
- Cache busting: after any JS, CSS or HTML change, bump the shared `?v=` revision on all local assets in `docs/index.html`. JSON config changes need no bump.
- Smartphones never show map labels, even in landscape. Labels appear only on non-phone landscape screens >= 768px, and overlapping labels are hidden.
- Accessibility: do not rely on colour alone, support light and dark mode, test at mobile widths.

## Checklists

### Add a criterion

Data repo: `tools/schema.py`, `tools/db.py`, `data/cafes.csv`.
Finder: `BOOLEAN_FIELDS` in `docs/db-loader.js`; `CRITERION_DEFINITIONS` in `docs/data-config.js`; an entry in `docs/filters-config.json`; English `criteriaShort` labels in `docs/i18n.js`.
If derived from hours: `computed: true` in `CRITERION_DEFINITIONS` plus a case in `computedValue()` in `docs/app.js`.

## Output format

- Give changes as unified diffs, or as a complete replacement of the affected function or file section. Say which. No `...` placeholders.
- Add or update tests as Node `.cjs` files in `tests/`.
- End every answer with: (a) commands to verify, (b) manual test steps, (c) risks.

## Verify

```bash
python3 -m http.server 8000 --directory docs
node --test tests/
```

Cross-repo preview with a locally built database:

```bash
python3 tools/serve_cors.py 8001 /path/to/jeju-cafe-data/build
# open http://localhost:8000/?database=http://localhost:8001/cafes.db
```

## Data safety

Never fabricate cafe facts, hours, phone numbers or coordinates. Leave unknowns blank or `0` and flag them for review. Keep a `source_url` on every record. Do not put private data repo content in this public repo.
