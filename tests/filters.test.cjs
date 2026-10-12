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

test("all filter labels use literal config text, never translation dictionaries", () => {
  const labels = {
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

test("filter order, removals, and English/Korean labels", () => {
  assert.deepEqual(Array.from(sandbox.CRITERIA, (entry) => entry.key), [
    "openNow", "openTomorrow", "workFriendly", "outdoor", "dessert",
    "brunch", "view", "openEarly", "books", "boardGames", "pets", "kids", "loyalty",
  ]);
  assert.equal(sandbox.APP_TRANSLATIONS.en.criteria.view, "Beautiful view");
  assert.equal(sandbox.APP_TRANSLATIONS.en.criteria.openEarly, "Opens early");
  assert.equal(sandbox.APP_TRANSLATIONS.en.criteria.openTomorrow, "Open tomorrow");
  for (const locale of ["en", "ko"]) {
    for (const criterion of sandbox.CRITERIA) {
      assert.ok(sandbox.APP_TRANSLATIONS[locale].criteria[criterion.key]);
      assert.ok(sandbox.APP_TRANSLATIONS[locale].criteriaShort[criterion.key]);
    }
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
  assert.equal(sandbox.window.configureCafeFilters(filterConfig.map((entry) => ({
    ...entry, enabled: false,
  }))).length, 0);
  sandbox.window.configureCafeFilters(filterConfig);
});

test("disabled legacy filters can be enabled, including computed Sunday hours", () => {
  sandbox.window.configureCafeFilters(filterConfig.map((entry) => ({ ...entry, enabled: true })));
  vm.runInContext(
    "COMPUTED_KEYS = {}; CRITERIA.forEach(function (entry) { if (entry.computed) COMPUTED_KEYS[entry.key] = true; });",
    sandbox
  );
  assert.equal(sandbox.hasCriterion(cafe({ sun: [{ open: 600, close: 1080 }] }), "openSunday"), true);
  assert.equal(sandbox.hasCriterion(cafe({ mon: [{ open: 600, close: 1080 }] }), "openSunday"), false);
  sandbox.window.configureCafeFilters(filterConfig);
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
