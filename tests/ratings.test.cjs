const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const docs = path.join(__dirname, "..", "docs");
const app = fs.readFileSync(path.join(docs, "app.js"), "utf8");
const prefsSource = fs.readFileSync(path.join(docs, "user-prefs.js"), "utf8");
const plain = (value) => JSON.parse(JSON.stringify(value));

function runtime(filter = { minStars: null, includeUnrated: true }) {
  const stored = new Map();
  const scope = {
    console: { warn() {} },
    setTimeout: () => 1, clearTimeout() {}, addEventListener() {},
    localStorage: {
      getItem: (key) => stored.get(key) || null,
      setItem: (key, value) => stored.set(key, value),
    },
    CRITERIA: [{ key: "workFriendly" }],
    CONFIGURED_CRITERIA: [{ key: "workFriendly", enabled: true, index: 0 }],
    COMPUTED_KEYS: {}, SIZES: ["tiny", "medium", "large"], PRICES: [1, 2, 3],
    hasCriterion: (cafe, key) => cafe[key] === true,
    cafeText: (cafe) => cafe,
    criterionLabel: (criterion) => criterion.key,
    update() {},
  };
  scope.window = scope;
  vm.createContext(scope);
  vm.runInContext(prefsSource, scope);
  scope.UserPrefs.load();
  scope.UserPrefs.setRatingFilter(filter);
  scope.UserPrefs.setFilterPrefs({ order: [], hidden: [], shown: [], defaultOn: ["workFriendly"] });
  vm.runInContext(app.slice(app.indexOf("  var state ="), app.indexOf("  var kindListEl")), scope);
  return { scope, stored };
}

for (const minStars of [null, 3, 4, 5]) {
  for (const includeUnrated of [false, true]) {
    test(`rating filter ${minStars === null ? "Any" : minStars + "+"}, unrated ${includeUnrated}`, () => {
      const { scope } = runtime();
      const filter = { minStars, includeUnrated };
      for (const stars of [null, 1, 2, 3, 4, 5]) {
        const expected = minStars === null || (stars === null ? includeUnrated : stars >= minStars);
        assert.equal(scope.UserPrefs.passesRatingFilter(stars, filter), expected);
      }
    });
  }
}

test("malformed rating filters never block, and invalid stars are treated as unrated", () => {
  const { scope } = runtime();
  for (const filter of [undefined, null, [], false, 42, {}, { minStars: "3" }, { minStars: 2 }]) {
    assert.equal(scope.UserPrefs.passesRatingFilter(1, filter), true);
  }
  for (const stars of [undefined, NaN, "5", 0, 6, {}, false]) {
    assert.equal(scope.UserPrefs.passesRatingFilter(stars, { minStars: 3, includeUnrated: true }), true);
    assert.equal(scope.UserPrefs.passesRatingFilter(stars, { minStars: 3, includeUnrated: false }), false);
  }
});

test("scope combines ratings with kind, size, price and must-have criteria", () => {
  const { scope } = runtime({ minStars: 3, includeUnrated: true });
  scope.UserPrefs.setRating("low-cafe", 2);
  scope.UserPrefs.setRating("good-cafe", 4);
  const low = { id: "low-cafe", kind: "cafe", size: "tiny", price: 1, workFriendly: true };
  const good = { ...low, id: "good-cafe" };
  assert.equal(scope.matchesFilters(low), false);
  assert.equal(scope.matchesFilters(good), true);
  assert.equal(scope.matchesFilters({ ...good, workFriendly: false }), false);
  assert.equal(scope.matchesScope({ ...low, id: "unrated-cafe" }), true);
  scope.state.kind = "bakery";
  assert.equal(scope.matchesScope(good), false);
  scope.state.kind = "All";
  scope.state.sizes.large = true;
  assert.equal(scope.matchesScope(good), false);
  scope.state.sizes.large = false;
  scope.state.prices[3] = true;
  assert.equal(scope.matchesScope(good), false);
});

test("Array.filter's numeric index cannot bypass ratings for later cafes", () => {
  const { scope } = runtime({ minStars: 3, includeUnrated: true });
  const cafes = ["first-cafe", "second-cafe", "third-cafe"].map((id) => {
    scope.UserPrefs.setRating(id, 2);
    return { id, kind: "cafe", size: "tiny", price: 1, workFriendly: true };
  });
  assert.equal(cafes.filter(scope.matchesScope).length, 0);
  assert.equal(cafes.filter(scope.matchesFilters).length, 0);
  assert.equal(cafes.filter((cafe) => scope.matchesFilters(cafe, true)).length, 3);
});

test("Reset keeps the saved rating filter; Clear resets and persists Any", () => {
  const { scope, stored } = runtime({ minStars: 4, includeUnrated: false });
  assert.deepEqual(plain(scope.state.ratingFilter), { minStars: 4, includeUnrated: false });
  scope.state.criteria.workFriendly = false;
  scope.applyDefaultFilters();
  assert.equal(scope.state.criteria.workFriendly, true);
  assert.deepEqual(plain(scope.state.ratingFilter), { minStars: 4, includeUnrated: false });
  scope.clearFilters();
  assert.equal(scope.state.criteria.workFriendly, false);
  assert.deepEqual(plain(scope.UserPrefs.getRatingFilter()), { minStars: null, includeUnrated: true });
  const raw = JSON.parse(stored.get("jcf:prefs"));
  assert.equal(raw.ratingFilter.minStars, null);
  assert.equal(raw.ratingFilter.includeUnrated, true);
});

test("hidden-by-rating counts respect other filters and only loaded public cafes", () => {
  const { scope } = runtime({ minStars: 3, includeUnrated: true });
  scope.UserPrefs.setRating("low-cafe", 2);
  scope.UserPrefs.setRating("other-low", 1);
  scope.UserPrefs.setRating("orphan-cafe", 1);
  const cafes = [
    { id: "low-cafe", kind: "cafe", workFriendly: true },
    { id: "other-low", kind: "bakery", workFriendly: true },
    { id: "good-cafe", kind: "cafe", workFriendly: true },
    { id: "not-work", kind: "cafe", workFriendly: false },
  ];
  scope.state.kind = "cafe";
  assert.equal(cafes.filter((cafe) => scope.matchesFilters(cafe, true)).length -
    cafes.filter(scope.matchesFilters).length, 1);
  assert.equal(scope.UserPrefs.getRating("orphan-cafe"), 1);
});

function sortRuntime(direction) {
  const { scope } = runtime();
  const cafes = [
    { id: "unrated-z", name: "Zulu" }, { id: "four-cafe", name: "Four" },
    { id: "two-cafe", name: "Two" }, { id: "five-cafe", name: "Five" },
    { id: "unrated-a", name: "Alpha" }, { id: "four-other", name: "Another four" },
  ];
  for (const [id, stars] of [["four-cafe", 4], ["two-cafe", 2], ["five-cafe", 5], ["four-other", 4]]) {
    scope.UserPrefs.setRating(id, stars);
  }
  vm.runInContext(app.slice(app.indexOf("  function sortValue("), app.indexOf("  function tableRatingHtml(")), scope);
  scope.rows = cafes.slice();
  scope.direction = direction;
  scope.state.sort = { key: "myRating", dir: direction === 1 ? "asc" : "desc" };
  scope.comparedKeys = [];
  vm.runInContext(app.slice(app.indexOf("    rows.sort(function (a, b)"),
    app.indexOf('    tableBody.innerHTML = ""')), scope);
  return Array.from(scope.rows, (cafe) => cafe.id);
}

test("My rating sorts descending with unrated last and alphabetical ties", () => {
  assert.deepEqual(sortRuntime(-1),
    ["five-cafe", "four-other", "four-cafe", "two-cafe", "unrated-a", "unrated-z"]);
});

test("My rating sorts ascending with unrated still last", () => {
  assert.deepEqual(sortRuntime(1),
    ["two-cafe", "four-other", "four-cafe", "five-cafe", "unrated-a", "unrated-z"]);
});

test("My rating's first sort is descending, then toggles ascending", () => {
  const { scope } = runtime();
  vm.runInContext(app.slice(app.indexOf("  function setSort("), app.indexOf("  var STATUS_ORDER")), scope);
  scope.setSort("myRating");
  assert.equal(scope.state.sort.dir, "desc");
  scope.setSort("myRating");
  assert.equal(scope.state.sort.dir, "asc");
});

test("the column follows Today and native rating controls have escaped names and 44px targets", () => {
  const { scope } = runtime();
  scope.message = (key) => key;
  vm.runInContext(app.slice(app.indexOf("  function tableColumns("), app.indexOf("  function renderTableHeader(")), scope);
  assert.deepEqual(Array.from(scope.tableColumns(), (column) => column.key).slice(0, 6),
    ["name", "region", "size", "price", "today", "myRating"]);
  vm.runInContext(fs.readFileSync(path.join(docs, "i18n.js"), "utf8"), scope);
  scope.message = (key, args = {}) => {
    const text = key.split(".").reduce((value, part) => value[part], scope.APP_TRANSLATIONS.en);
    return text.replace(/\{(\w+)\}/g, (_, name) => args[name]);
  };
  vm.runInContext(app.slice(app.indexOf("  function escapeHtml("), app.indexOf("  function safeUrl(")), scope);
  vm.runInContext(app.slice(app.indexOf("  function starHtml("), app.indexOf("  function restoreRatingFocus(")), scope);
  const html = scope.ratingControlHtml({ id: 'cafe"><img src=x>' });
  assert.match(html, /<fieldset[^>]*><legend class="sr-only">Your rating<\/legend>/);
  assert.equal((html.match(/type="radio"/g) || []).length, 5);
  assert.match(html, /aria-label="5 of 5 stars"/);
  assert.match(html, /cafe&quot;&gt;&lt;img/);
  assert.doesNotMatch(html, /<img/);
  assert.match(fs.readFileSync(path.join(docs, "style.css"), "utf8"),
    /\.rating-choice \{[^}]*width: 44px; height: 44px;/);
  assert.match(fs.readFileSync(path.join(docs, "style.css"), "utf8"),
    /\.maplibregl-popup \{ z-index: 3; \}/);
});

test("cross-tab rating updates refresh the filter and keep an active star focused", () => {
  let listener;
  const calls = [];
  const scope = {
    document: { activeElement: { value: "4", getAttribute: () => "a-cafe" } },
    state: {},
    window: { UserPrefs: { getRatingFilter: () => ({ minStars: 3, includeUnrated: false }) } },
    renderRatingFilters: () => calls.push("controls"),
    update: (options) => { assert.equal(options.fit, false); calls.push("update"); },
    restoreRatingFocus: (id, stars) => { assert.equal(id, "a-cafe"); assert.equal(stars, 4); calls.push("focus"); },
  };
  vm.createContext(scope);
  vm.runInContext(app.slice(app.indexOf("  function refreshPersonalRatings("),
    app.indexOf("  // The weekly hours toggle")), scope);
  listener = scope.refreshPersonalRatings;
  listener({ source: "local" });
  assert.deepEqual(calls, []);
  listener({ source: "storage" });
  assert.deepEqual(calls, ["controls", "update", "focus"]);
});

test("popup edits flush before repainting and reject IDs not in the published data", () => {
  const calls = [];
  const scope = {
    cafesById: { "a-cafe": {} },
    window: { UserPrefs: {
      setRating: (id, stars) => { calls.push(["set", id, stars]); return true; },
      flush: () => calls.push(["flush"]),
    } },
    update: (options) => { assert.equal(options.fit, false); calls.push(["update"]); },
    restoreRatingFocus: (id, stars) => calls.push(["focus", id, stars]),
  };
  vm.createContext(scope);
  vm.runInContext(app.slice(app.indexOf("  function saveCafeRating("),
    app.indexOf('  document.addEventListener("change"')), scope);
  scope.saveCafeRating("orphan-cafe", 5);
  scope.saveCafeRating("constructor", 5);
  assert.deepEqual(calls, []);
  scope.saveCafeRating("a-cafe", null);
  assert.deepEqual(calls, [["set", "a-cafe", null], ["flush"], ["update"], ["focus", "a-cafe", null]]);
});

test("focus returns to the edited star, or a visible filter/toggle when the cafe disappears", () => {
  let target = null;
  let mobile = false;
  let drawerOpen = false;
  const calls = [];
  const scope = {
    document: { getElementById: (id) => { assert.match(id, /^rating-a-cafe-/); return target; } },
    window: { matchMedia: () => ({ matches: mobile }) },
    sidebar: { classList: { contains: () => drawerOpen } },
    sidebarToggle: { focus: () => calls.push("toggle") },
    ratingFilterListEl: { querySelector: () => ({ focus: () => calls.push("filter") }) },
  };
  vm.createContext(scope);
  vm.runInContext(app.slice(app.indexOf("  function restoreRatingFocus("),
    app.indexOf("  function saveCafeRating(")), scope);
  target = { focus: () => calls.push("star") };
  scope.restoreRatingFocus("a-cafe", 4);
  target = null;
  scope.restoreRatingFocus("a-cafe", 2);
  mobile = true;
  scope.restoreRatingFocus("a-cafe", 2);
  drawerOpen = true;
  scope.restoreRatingFocus("a-cafe", 2);
  assert.deepEqual(calls, ["star", "filter", "toggle", "filter"]);
});

test("popup refresh reapplies its map-relative height and placement after HTML replacement", () => {
  let open = true;
  const calls = [];
  const content = { style: {} };
  const scope = {
    buildPopupHtml: () => "popup",
    map: { getContainer: () => ({ clientHeight: 460 }) },
  };
  const popup = {
    setHTML: (html) => calls.push(html),
    isOpen: () => open,
    getElement: () => ({ querySelector: () => content }),
    setLngLat: (coordinates) => calls.push(Array.from(coordinates)),
  };
  vm.createContext(scope);
  vm.runInContext(app.slice(app.indexOf("  function refreshPopup("),
    app.indexOf("  function restoreRatingFocus(")), scope);
  scope.refreshPopup(popup, { lng: 126.5, lat: 33.3 });
  assert.equal(content.style.maxHeight, "347px");
  assert.deepEqual(calls, ["popup", [126.5, 33.3]]);
  open = false;
  calls.length = 0;
  scope.refreshPopup(popup, {});
  assert.deepEqual(calls, ["popup"]);
  assert.match(app, /function showOnMap\([\s\S]*?offset: \[0, Math\.round\(map\.getContainer\(\)\.clientHeight \* 0\.35\)\]/);
});
