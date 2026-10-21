const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const docs = path.join(__dirname, "..", "docs");
const sandbox = {
  Intl,
  URLSearchParams,
  window: { location: { search: "?at=sun-23:30" } },
  message: (key) => key,
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(docs, "data-config.js"), "utf8"), sandbox);
vm.runInContext(fs.readFileSync(path.join(docs, "filters-config.js"), "utf8"), sandbox);
const filterConfig = JSON.parse(fs.readFileSync(path.join(docs, "filters-config.json"), "utf8"));
sandbox.window.configureCafeFilters(filterConfig);
vm.runInContext(fs.readFileSync(path.join(docs, "i18n.js"), "utf8"), sandbox);
const app = fs.readFileSync(path.join(docs, "app.js"), "utf8");
vm.runInContext(
  app.slice(app.indexOf("  var MINUTES_PER_DAY"))
    .split("  /* ---------------------------------------------------------")[0],
  sandbox
);

function cafe(hours = {}, hasHours = Object.keys(hours).length > 0) {
  return { hours, hasHours };
}

test("venue kinds have the requested fixed values and English labels", () => {
  assert.deepEqual(Array.from(sandbox.KINDS), ["cafe", "roastery", "bakery", "pub"]);
  assert.deepEqual(
    ["All", ...sandbox.KINDS].map((kind) => sandbox.APP_TRANSLATIONS.en.kinds[kind]),
    ["All", "Cafes", "Roasters", "Bakers", "Pub"]
  );
  const html = fs.readFileSync(path.join(docs, "index.html"), "utf8");
  assert.match(html, /<div class="map-legend-banner"[\s\S]*?id="kindList"[\s\S]*?<\/div>/);
  assert.ok(html.indexOf('id="kindList"') < html.indexOf('id="map"'));
  assert.doesNotMatch(html, /id="regionList"/);
  assert.doesNotMatch(app, /state\.region|renderRegions/);
});

test("type filters narrow scope independently of region and combine with other filters", () => {
  const scope = {
    CRITERIA: [{ key: "outdoor" }], SIZES: sandbox.SIZES, PRICES: sandbox.PRICES,
    window: {},
    hasCriterion: (entry, key) => entry[key] === true,
  };
  vm.createContext(scope);
  vm.runInContext(app.slice(app.indexOf("  var state ="), app.indexOf("  var kindListEl")), scope);
  const entry = { kind: "roastery", region: "South", size: "medium", price: 2, outdoor: true };
  assert.equal(scope.matchesFilters(entry), true);
  for (const kind of sandbox.KINDS) {
    scope.state.kind = kind;
    assert.equal(scope.matchesScope(entry), kind === entry.kind);
    assert.equal(scope.matchesScope({ ...entry, kind }), true);
  }
  scope.state.kind = "roastery";
  assert.equal(scope.matchesScope({ ...entry, region: "North" }), true);
  scope.state.sizes.tiny = true;
  assert.equal(scope.matchesScope(entry), false);
  scope.state.sizes.tiny = false;
  scope.state.prices[1] = true;
  assert.equal(scope.matchesScope(entry), false);
  scope.state.prices[1] = false;
  scope.state.criteria.outdoor = true;
  assert.equal(scope.matchesFilters(entry), true);
  assert.equal(scope.matchesFilters({ ...entry, outdoor: false }), false);
  scope.clearFilters();
  assert.equal(scope.state.kind, "All");
  assert.equal(scope.matchesFilters({ ...entry, kind: "pub", outdoor: false }), true);
});

test("all filter labels use literal config text, never translation dictionaries", () => {
  const labels = {
    state: { userLocation: null },
    message() { throw new Error("Filter labels must not call the translator"); },
    CRITERIA: [{ key: "outdoor", displayedText: "Outdoor seating" }],
  };
  vm.createContext(labels);
  const start = app.indexOf("  function criterionLabel(");
  const end = app.indexOf("  function regionLabel(");
  vm.runInContext(app.slice(start, end), labels);
  // Only the ordinary, non-filter table headings may use the translator.
  labels.message = (key) => {
    assert.ok(!key.startsWith("criteria"), "Filter translation lookup: " + key);
    return key;
  };
  vm.runInContext(
    app.slice(app.indexOf("  function tableColumns("), app.indexOf("  function renderTableHeader(")),
    labels
  );
  const column = labels.tableColumns().find((entry) => entry.key === "outdoor");
  assert.equal(column.label, "Outdoor seating");
  assert.equal(column.title, "Outdoor seating");
  assert.equal(column.noTranslate, true);
  labels.message = () => { throw new Error("Unexpected translator call"); };
  for (const displayedText of ["Outdoor seating", "Custom label {time}", "한글 <&> label"]) {
    assert.equal(labels.criterionLabel({ displayedText }), displayedText);
  }
  assert.doesNotMatch(app, /message\("criteria(?:Short)?\./);
});

test("filter markup opts out of automatic translation and escapes literal text", () => {
  const labels = {};
  vm.createContext(labels);
  vm.runInContext(
    app.slice(app.indexOf("  function criterionLabel("), app.indexOf("  function regionLabel(")) +
    app.slice(app.indexOf("  function escapeHtml("), app.indexOf("  function safeUrl(")),
    labels
  );
  for (const className of ["crit-label", "popup-tag", "rec-tag", "rec-tag miss"]) {
    assert.equal(
      labels.criterionTextHtml({ displayedText: "Outdoor <&> {time}" }, className),
      '<span translate="no" class="' + className + ' notranslate">Outdoor &lt;&amp;&gt; {time}</span>'
    );
  }
  const html = fs.readFileSync(path.join(docs, "index.html"), "utf8");
  assert.match(html, /id="criteriaList" translate="no"/);
});

test("filter order, removals, and English labels", () => {
  assert.deepEqual(Array.from(sandbox.CRITERIA, (entry) => entry.key),
    filterConfig.filter((entry) => entry.enabled).sort((a, b) => a.index - b.index)
      .map((entry) => entry.name));
  assert.equal(sandbox.APP_TRANSLATIONS.en.criteria.view, "Beautiful view");
  assert.equal(sandbox.APP_TRANSLATIONS.en.criteria.openEarly, "Opens early");
  assert.equal(sandbox.APP_TRANSLATIONS.en.criteria.openTomorrow, "Open tomorrow");
  for (const criterion of sandbox.CRITERIA) {
    assert.ok(sandbox.APP_TRANSLATIONS.en.criteria[criterion.key]);
    assert.ok(sandbox.APP_TRANSLATIONS.en.criteriaShort[criterion.key]);
  }
});

test("JSON controls visibility and numeric order without mutating the config", () => {
  const config = [
    { name: "pets", enabled: true, displayedText: "My pet filter", index: 10 },
    { name: "books", enabled: false, displayedText: "Books", index: 0 },
    { name: "openNow", enabled: true, displayedText: "Open!", index: 2 },
  ];
  const original = JSON.stringify(config);
  const filters = sandbox.window.configureCafeFilters(config);
  assert.deepEqual(Array.from(filters, (entry) => entry.key), ["openNow", "pets"]);
  assert.equal(filters[0].displayedText, "Open!");
  assert.equal(filters[0].computed, true);
  assert.deepEqual(Array.from(sandbox.CONFIGURED_CRITERIA, (entry) => entry.key), ["books", "openNow", "pets"]);
  assert.equal(JSON.stringify(config), original);
  sandbox.window.configureCafeFilters(filterConfig);
});

test("invalid config edits fail with an actionable error", () => {
  const valid = { name: "pets", enabled: true, displayedText: "Pets", index: 0 };
  for (const config of [
    {},
    [{ ...valid, name: "unknown" }],
    [valid, valid],
    [{ ...valid, enabled: "false" }],
    [{ ...valid, displayedText: "" }],
    [{ ...valid, index: -1 }],
    [{ ...valid, index: 0.5 }],
    [{ ...valid, index: "0" }],
  ]) {
    assert.throws(() => sandbox.window.configureCafeFilters(config), /filter/i);
  }
  sandbox.window.configureCafeFilters(filterConfig);
});

test("empty or fully disabled config exposes no criteria", () => {
  assert.equal(sandbox.window.configureCafeFilters([]).length, 0);
  assert.equal(sandbox.CONFIGURED_CRITERIA.length, 0);
  assert.equal(sandbox.window.configureCafeFilters(filterConfig.map((entry) => ({
    ...entry, enabled: false,
  }))).length, 0);
  assert.equal(sandbox.CONFIGURED_CRITERIA.length, filterConfig.length);
  sandbox.window.configureCafeFilters(filterConfig);
});

test("disabled legacy filters can be enabled, including computed Sunday hours", () => {
  sandbox.window.configureCafeFilters(filterConfig);
  vm.runInContext(
    app.slice(app.indexOf("  var COMPUTED_KEYS ="), app.indexOf("  function hasCriterion(")),
    sandbox
  );
  assert.equal(sandbox.hasCriterion(cafe({ sun: [{ open: 600, close: 1080 }] }), "openSunday"), true);
  assert.equal(sandbox.hasCriterion(cafe({ mon: [{ open: 600, close: 1080 }] }), "openSunday"), false);
  sandbox.window.configureCafeFilters(filterConfig);
});

function personalFilterState(settings) {
  const scope = {
    CONFIGURED_CRITERIA: Array.from(sandbox.CONFIGURED_CRITERIA),
    CRITERIA: Array.from(sandbox.CONFIGURED_CRITERIA).filter((entry) => entry.enabled),
    SIZES: sandbox.SIZES, PRICES: sandbox.PRICES,
    hasCriterion: (entry, key) => entry[key] === true,
    console: { warn() {} },
    setTimeout: () => 1, clearTimeout() {},
    renderControls() {}, renderTableHeader() {}, update() {},
  };
  scope.window = scope;
  vm.createContext(scope);
  vm.runInContext(fs.readFileSync(path.join(docs, "user-prefs.js"), "utf8"), scope);
  scope.UserPrefs.setFilterPrefs(Object.assign({ order: [], hidden: [], shown: [], defaultOn: [] }, settings));
  vm.runInContext(app.slice(app.indexOf("  var state ="), app.indexOf("  var kindListEl")), scope);
  scope.tableColumns = () => [{ key: "name" }, ...scope.CRITERIA];
  vm.runInContext(app.slice(app.indexOf("  function refreshPersonalFilters("),
    app.indexOf("  /* ---------------------------------------------------------\n   * Shared markup helpers")), scope);
  return scope;
}

test("default-on filters apply on startup and Reset only when visible", () => {
  const scope = personalFilterState({ hidden: ["pets"], shown: ["boardGames"],
    defaultOn: ["workFriendly", "pets", "boardGames", "goneFilter"] });
  assert.equal(scope.state.criteria.workFriendly, true);
  assert.equal(scope.state.criteria.boardGames, true);
  assert.equal("pets" in scope.state.criteria, false);
  assert.equal("goneFilter" in scope.state.criteria, false);
  scope.state.criteria.workFriendly = false;
  scope.state.kind = "bakery";
  scope.state.sizes.tiny = true;
  scope.state.prices[3] = true;
  scope.UserPrefs.setRatingFilter({ minStars: 4, includeUnrated: false });
  scope.state.ratingFilter = scope.UserPrefs.getRatingFilter();
  scope.applyDefaultFilters();
  assert.equal(scope.state.criteria.workFriendly, true);
  assert.equal(scope.state.kind, "All");
  assert.equal(scope.state.sizes.tiny, false);
  assert.equal(scope.state.prices[3], false);
  assert.deepEqual(JSON.parse(JSON.stringify(scope.state.ratingFilter)), { minStars: 4, includeUnrated: false });
  scope.clearFilters();
  assert.equal(scope.state.criteria.workFriendly, false);
  assert.equal(scope.state.criteria.boardGames, false);
  assert.deepEqual(JSON.parse(JSON.stringify(scope.UserPrefs.getRatingFilter())), { minStars: null, includeUnrated: true });
});

test("saving visibility/order changes removes hidden active criteria and invalid sort", () => {
  const scope = personalFilterState({ defaultOn: ["pets", "workFriendly"] });
  scope.state.sort = { key: "pets", dir: "desc" };
  scope.UserPrefs.setFilterPrefs({
    order: ["boardGames", "workFriendly"], hidden: ["pets"], shown: ["boardGames"], defaultOn: ["workFriendly"],
  });
  scope.refreshPersonalFilters();
  assert.equal("pets" in scope.state.criteria, false);
  assert.equal(scope.state.criteria.workFriendly, true);
  assert.equal(scope.state.criteria.boardGames, false);
  assert.equal(scope.CRITERIA[0].key, "boardGames");
  assert.equal(scope.state.sort.key, "name");
  assert.equal(scope.state.sort.dir, "asc");
  assert.equal(scope.selectedCriteriaKeys().includes("pets"), false);
  assert.equal(scope.allCriteriaKeys().includes("boardGames"), true);
});

test("hiding every criterion leaves scope filters working and Reset safe", () => {
  const scope = personalFilterState({ hidden: filterConfig.map((entry) => entry.name),
    defaultOn: ["workFriendly"] });
  assert.equal(scope.CRITERIA.length, 0);
  assert.equal(scope.selectedCriteriaKeys().length, 0);
  assert.equal(scope.matchesFilters({ kind: "cafe", size: "tiny", price: 1 }), true);
  scope.state.kind = "bakery";
  assert.equal(scope.matchesFilters({ kind: "cafe", size: "tiny", price: 1 }), false);
  scope.applyDefaultFilters();
  assert.equal(Object.keys(scope.state.criteria).length, 0);
  assert.equal(scope.state.kind, "All");
});

test("unrelated UserPrefs changes do not rebuild controls or reset active filters", () => {
  const scope = personalFilterState({});
  scope.renderControls = () => assert.fail("Unchanged filter preferences must not rebuild controls");
  scope.state.criteria.workFriendly = true;
  scope.UserPrefs.setRating("a-cafe", 4);
  scope.refreshPersonalFilters();
  assert.equal(scope.state.criteria.workFriendly, true);
});

test("Personalize uses an accessible native modal, English strings and staged controls", () => {
  const html = fs.readFileSync(path.join(docs, "index.html"), "utf8");
  assert.match(html, /<dialog id="personalizeDialog"[^>]*aria-labelledby="personalizeTitle"/);
  assert.match(html, /id="personalizeBtn"[^>]*aria-haspopup="dialog"/);
  assert.match(html, /id="personalizeBtn"[^>]*aria-label="Personalize"[\s\S]*?data-lucide="settings-2"/);
  for (const key of ["open", "title", "filters", "description", "show", "defaultOn", "up", "down", "restore", "cancel", "save"]) {
    assert.equal(typeof sandbox.APP_TRANSLATIONS.en.personalize[key], "string");
  }
  assert.match(app, /personalizeDialog\.showModal\(\)/);
  assert.match(app, /personalizeDialog\.addEventListener\("close"[\s\S]*?personalizeBtn\.focus\(\)/);
  assert.match(app, /event\.target\.closest\("#personalizeDialog"\)/);
  assert.equal(sandbox.APP_TRANSLATIONS.en.filters.resetHint, "Back to your default filters");
});

test("saving a draft preserves removed filter names and their saved order slots", () => {
  const scope = {
    CONFIGURED_CRITERIA: [
      { key: "openNow", enabled: true }, { key: "workFriendly", enabled: true },
      { key: "boardGames", enabled: false },
    ],
    restoringFilterDefaults: false,
  };
  scope.filterDraft = scope.CONFIGURED_CRITERIA.map((criterion) => ({
    criterion, shown: criterion.key !== "openNow", defaultOn: criterion.key === "workFriendly",
  }));
  vm.createContext(scope);
  vm.runInContext(app.slice(app.indexOf("  function draftFilterPrefs("),
    app.indexOf('  document.getElementById("personalizeSave")')), scope);
  const previous = {
    order: ["goneFirst", "boardGames", "goneMiddle", "openNow"],
    hidden: ["goneHidden"], shown: ["goneShown"], defaultOn: ["goneDefault"],
  };
  const result = JSON.parse(JSON.stringify(scope.draftFilterPrefs(previous)));
  assert.deepEqual(result, {
    order: ["goneFirst", "openNow", "goneMiddle", "workFriendly", "boardGames"],
    hidden: ["openNow", "goneHidden"], shown: ["boardGames", "goneShown"],
    defaultOn: ["workFriendly", "goneDefault"],
  });
  assert.equal(previous.order[0], "goneFirst");
  scope.restoringFilterDefaults = true;
  scope.filterDraft = scope.CONFIGURED_CRITERIA.map((criterion) => ({
    criterion, shown: criterion.enabled, defaultOn: false,
  }));
  assert.deepEqual(JSON.parse(JSON.stringify(scope.draftFilterPrefs(previous))),
    { order: [], hidden: [], shown: [], defaultOn: [] });
});

test("Tab wraps inside the Personalize dialog and Escape uses native cancellation", () => {
  const controls = [{ focus() { scope.document.activeElement = this; } },
    { focus() { scope.document.activeElement = this; } }];
  let handler;
  const scope = {
    document: { activeElement: controls[0] },
    personalizeDialog: {
      addEventListener: (type, fn) => { assert.equal(type, "keydown"); handler = fn; },
      querySelectorAll: () => controls,
    },
  };
  vm.createContext(scope);
  vm.runInContext(app.slice(app.indexOf('  personalizeDialog.addEventListener("keydown"'),
    app.indexOf('  personalizeDialog.addEventListener("click"')), scope);
  let prevented = false;
  handler({ key: "Tab", shiftKey: true, preventDefault() { prevented = true; } });
  assert.equal(scope.document.activeElement, controls[1]);
  assert.equal(prevented, true);
  prevented = false;
  handler({ key: "Tab", shiftKey: false, preventDefault() { prevented = true; } });
  assert.equal(scope.document.activeElement, controls[0]);
  assert.equal(prevented, true);
  prevented = false;
  handler({ key: "Escape", preventDefault() { prevented = true; } });
  assert.equal(prevented, false);
});

test("Reset uses saved defaults while the empty-map Clear filters handler clears all", () => {
  const handlers = {};
  const calls = [];
  const scope = {
    document: { getElementById: (id) => ({
      addEventListener: (type, fn) => { handlers[id] = fn; },
    }) },
    message: (key) => key,
    applyDefaultFilters: () => calls.push("defaults"),
    clearFilters: () => calls.push("clear"),
    renderControls: () => calls.push("controls"),
    update: () => calls.push("update"),
  };
  vm.createContext(scope);
  vm.runInContext(app.slice(app.indexOf('  document.getElementById("resetBtn").title'),
    app.indexOf("  /* ---------------------------------------------------------\n   * Personal filter settings")), scope);
  handlers.resetBtn();
  assert.deepEqual(calls, ["defaults", "controls", "update"]);
  calls.length = 0;
  handlers.mapEmptyReset();
  assert.deepEqual(calls, ["clear", "controls", "update"]);
});

test("all computed criteria work even when every configured filter is hidden", () => {
  const previousNow = sandbox.now;
  sandbox.window.configureCafeFilters([]);
  vm.runInContext(app.slice(app.indexOf("  var COMPUTED_KEYS ="),
    app.indexOf("  function hasCriterion(")), sandbox);
  sandbox.now = { day: 0, minutes: 600 };
  for (const key of ["openNow", "openTomorrow", "openEarly", "openSunday"]) {
    assert.equal(sandbox.COMPUTED_KEYS[key], true);
    assert.equal(sandbox.hasCriterion(cafe({
      mon: [{ open: 540, close: 1080 }], tue: [{ open: 600, close: 1080 }],
      sun: [{ open: 600, close: 1080 }],
    }), key), true);
  }
  sandbox.now = previousNow;
  sandbox.window.configureCafeFilters(filterConfig);
});

test("Save flushes the debounced preferences before closing the dialog", () => {
  let save;
  const calls = [];
  const next = { order: [], hidden: ["pets"], shown: ["boardGames"], defaultOn: ["workFriendly"] };
  const scope = {
    document: { getElementById: () => ({ addEventListener: (type, fn) => { save = fn; } }) },
    window: { UserPrefs: {
      getFilterPrefs: () => ({}),
      setFilterPrefs: (value) => { assert.equal(value, next); calls.push("set"); },
      flush: () => calls.push("flush"),
    } },
    draftFilterPrefs: () => next,
    personalizeDialog: { close: () => calls.push("close") },
  };
  vm.createContext(scope);
  vm.runInContext(app.slice(app.indexOf('  document.getElementById("personalizeSave")'),
    app.indexOf("  function refreshPersonalFilters(")), scope);
  save();
  assert.deepEqual(calls, ["set", "flush", "close"]);
});

test("early means strictly before 10 am on any day", () => {
  for (const [opening, expected] of [[480, true], [599, true], [600, false], [601, false]]) {
    assert.equal(sandbox.hasCriterion(cafe({ wed: [{ open: opening, close: 1080 }] }), "openEarly"), expected);
  }
  assert.equal(sandbox.hasCriterion(cafe(), "openEarly"), false);
});

test("tomorrow follows Korea weekday and wraps Sunday to Monday", () => {
  assert.equal(sandbox.hasCriterion(cafe({ mon: [{ open: 600, close: 1080 }] }), "openTomorrow"), true);
  assert.equal(sandbox.hasCriterion(cafe({ tue: [{ open: 600, close: 1080 }] }), "openTomorrow"), false);
  assert.equal(sandbox.hasCriterion(cafe(), "openTomorrow"), false);
  sandbox.now = { day: 0, minutes: 1 };
  assert.equal(sandbox.hasCriterion(cafe({ tue: [{ open: 600, close: 1080 }] }), "openTomorrow"), true);
});

test("tomorrow includes overnight carryover but not a midnight closing", () => {
  sandbox.now = { day: 6, minutes: 1410 };
  assert.equal(sandbox.hasCriterion(cafe({ sun: [{ open: 1080, close: 120 }] }), "openTomorrow"), true);
  assert.equal(sandbox.hasCriterion(cafe({ sun: [{ open: 1080, close: 0 }] }), "openTomorrow"), false);
  assert.equal(sandbox.hasCriterion(cafe({ sun: [{ open: 1080, close: 1440 }] }), "openTomorrow"), false);
  assert.equal(sandbox.hasCriterion(cafe({ sun: [{ open: 0, close: 0 }] }), "openTomorrow"), false);
  assert.equal(sandbox.hasCriterion(cafe({ sun: [{ open: 600, close: 600 }] }), "openTomorrow"), true);
});

test("open now still respects breaks and overnight periods", () => {
  sandbox.now = { day: 0, minutes: 60 };
  assert.equal(sandbox.hasCriterion(cafe({ sun: [{ open: 1080, close: 120 }] }), "openNow"), true);
  sandbox.now = { day: 0, minutes: 780 };
  const split = cafe({ mon: [{ open: 540, close: 720 }, { open: 840, close: 1080 }] });
  assert.equal(sandbox.hasCriterion(split, "openNow"), false);
  sandbox.now.minutes = 840;
  assert.equal(sandbox.hasCriterion(split, "openNow"), true);
});
