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
