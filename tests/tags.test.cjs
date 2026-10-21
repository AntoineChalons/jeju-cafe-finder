const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const docs = path.join(__dirname, "..", "docs");
const app = fs.readFileSync(path.join(docs, "app.js"), "utf8");
const plain = (value) => JSON.parse(JSON.stringify(value));
const T1 = "2026-10-21T01:00:00.000Z";
const T2 = "2026-10-21T02:00:00.000Z";

function setup(stored = new Map()) {
  const nodes = new Map();
  function node(id) {
    if (!nodes.has(id)) nodes.set(id, {
      innerHTML: "", textContent: "", value: "", hidden: false, focused: false,
      focus() { this.focused = true; },
    });
    return nodes.get(id);
  }
  const scope = {
    console: { warn() {} }, setTimeout: () => 1, clearTimeout() {}, addEventListener() {},
    localStorage: {
      getItem: (key) => stored.get(key) || null,
      setItem: (key, value) => stored.set(key, value),
    },
    document: { getElementById: node },
    update() {}, hasCriterion: (cafe, key) => cafe[key] === true,
  };
  scope.window = scope;
  vm.createContext(scope);
  for (const name of ["data-config.js", "i18n.js", "user-prefs.js"]) {
    vm.runInContext(fs.readFileSync(path.join(docs, name), "utf8"), scope);
  }
  scope.message = (key, values = {}) => {
    const text = key.split(".").reduce((value, part) => value[part], scope.APP_TRANSLATIONS.en);
    return text.replace(/\{(\w+)\}/g, (_, token) => values[token]);
  };
  scope.UserPrefs._setNow(() => T1);
  scope.UserPrefs.load();
  vm.runInContext(app.slice(app.indexOf("  var state ="), app.indexOf("  var kindListEl")), scope);
  vm.runInContext(app.slice(app.indexOf("  function escapeHtml("), app.indexOf("  function safeUrl(")), scope);
  vm.runInContext(app.slice(app.indexOf("  function suggestedTagLabels("),
    app.indexOf('  document.addEventListener("submit"')), scope);
  scope.cafesById = { "a-cafe": { id: "a-cafe", kind: "cafe" }, "b-cafe": { id: "b-cafe", kind: "cafe" } };
  return { scope, prefs: scope.UserPrefs, node, stored };
}

test("suggested keys and UI/storage limits agree, with English-only labels", () => {
  const { scope, prefs } = setup();
  assert.deepEqual(plain(scope.SUGGESTED_TAGS),
    ["visited", "want-to-go", "favourite", "great-coffee", "great-vibe", "quiet"]);
  for (const [key, label] of Object.entries(scope.suggestedTagLabels())) {
    assert.equal(prefs.normalizeTag(" " + label.toUpperCase() + " ", scope.suggestedTagLabels()), key);
  }
  assert.equal(scope.TAG_MAX_LENGTH, 30);
  assert.equal(scope.TAG_MAX_PER_CAFE, 20);
});

test("NFC, whitespace, Unicode length and case-insensitive duplicates", () => {
  const { prefs } = setup();
  assert.equal(prefs.normalizeTag("  cafe\u0301 \t coffee "), "café coffee");
  assert.equal(prefs.normalizeTag("☕".repeat(30)), "☕".repeat(30));
  assert.equal(prefs.normalizeTag("😀".repeat(30)), "😀".repeat(30));
  assert.equal(prefs.normalizeTag("😀".repeat(31)), null);
  assert.equal(prefs.setTags("a-cafe", ["cozy", "COZY", "café", "cafe\u0301"]), true);
  assert.deepEqual(plain(prefs.getTags("a-cafe")), ["cozy", "café"]);
});

test("setTags rejects over-limit edits atomically without truncating existing tags", () => {
  const { prefs } = setup();
  prefs.setTags("a-cafe", ["kept"]);
  assert.equal(prefs.setTags("a-cafe", ["x".repeat(31)]), false);
  assert.deepEqual(plain(prefs.getTags("a-cafe")), ["kept"]);
  const twenty = Array.from({ length: 20 }, (_, i) => "tag " + i);
  assert.equal(prefs.setTags("a-cafe", twenty), true);
  assert.equal(prefs.setTags("a-cafe", twenty.concat("twenty-first")), false);
  assert.equal(prefs.getTags("a-cafe").length, 20);
  assert.equal(prefs.setTags("a-cafe", twenty.concat("TAG 0")), true);
});

test("rename merges duplicates across all cafes, including absent cafe ids, with timestamps", () => {
  const { prefs, stored } = setup();
  prefs.setTags("a-cafe", ["great vibe", "cozy"]);
  prefs.setTags("b-cafe", ["Great Vibe"]);
  prefs.setTags("absent-cafe", ["GREAT VIBE"]);
  prefs._setNow(() => T2);
  assert.equal(prefs.renameTag("great vibe", "cozy"), true);
  assert.deepEqual(plain(prefs.allTags()), [{ tag: "cozy", count: 3 }]);
  prefs.flush();
  const doc = JSON.parse(stored.get("jcf:prefs"));
  for (const id of ["a-cafe", "b-cafe", "absent-cafe"]) {
    assert.equal(doc.tags[id].updatedAt, T2);
    assert.deepEqual(doc.tags[id].tags, ["cozy"]);
  }
  assert.deepEqual(plain(setup(stored).prefs.allTags()), [{ tag: "cozy", count: 3 }]);
});

test("rename resolves suggested labels; invalid rename leaves records untouched", () => {
  const { scope, prefs } = setup();
  prefs.setTags("a-cafe", ["custom", "visited"]);
  assert.equal(prefs.renameTag("custom", "VISITED ", scope.suggestedTagLabels()), true);
  assert.deepEqual(plain(prefs.getTags("a-cafe")), ["visited"]);
  assert.equal(prefs.renameTag("visited", "x".repeat(31)), false);
  assert.deepEqual(plain(prefs.getTags("a-cafe")), ["visited"]);
});

test("delete is case-insensitive and keeps empty timestamped tombstones on reload", () => {
  const { prefs, stored } = setup();
  prefs.setTags("a-cafe", ["cozy"]);
  prefs.setTags("b-cafe", ["COZY", "visited"]);
  prefs._setNow(() => T2);
  assert.equal(prefs.deleteTag("Cozy"), true);
  prefs.flush();
  const doc = JSON.parse(stored.get("jcf:prefs"));
  assert.deepEqual(doc.tags["a-cafe"], { tags: [], updatedAt: T2 });
  assert.deepEqual(doc.tags["b-cafe"], { tags: ["visited"], updatedAt: T2 });
  assert.deepEqual(plain(setup(stored).prefs.getTags("a-cafe")), []);
});

test("allTags counts case-insensitively and sorts ties alphabetically", () => {
  const { prefs } = setup();
  prefs.setTags("a-cafe", ["alpha", "Beta", "popular"]);
  prefs.setTags("b-cafe", ["POPULAR"]);
  assert.deepEqual(plain(prefs.allTags()), [
    { tag: "popular", count: 2 }, { tag: "alpha", count: 1 }, { tag: "Beta", count: 1 },
  ]);
});

test("tag filter uses AND, combines with the other filters, and resets on both clear paths", () => {
  const { scope, prefs } = setup();
  prefs.setTags("a-cafe", ["visited", "great-vibe"]);
  prefs.setTags("b-cafe", ["visited"]);
  scope.state.tags.visited = true;
  scope.state.tags["great-vibe"] = true;
  assert.equal(scope.matchesFilters(scope.cafesById["a-cafe"]), true);
  assert.equal(scope.matchesFilters(scope.cafesById["b-cafe"]), false);
  scope.state.kind = "bakery";
  assert.equal(scope.matchesFilters(scope.cafesById["a-cafe"]), false);
  scope.clearFilters();
  assert.deepEqual(plain(scope.state.tags), {});
  scope.state.tags.visited = true;
  scope.applyDefaultFilters();
  assert.deepEqual(plain(scope.state.tags), {});
});

test("the __proto__ tag is safe as a checkbox key", () => {
  const { scope, prefs } = setup();
  prefs.setTags("a-cafe", ["__proto__"]);
  scope.state.tags["__proto__"] = true;
  assert.equal(scope.matchesFilters(scope.cafesById["a-cafe"]), true);
  assert.equal(scope.matchesFilters(scope.cafesById["b-cafe"]), false);
});

test("all four tag surfaces escape XSS text, attribute values, and autocomplete options", () => {
  const { scope, prefs, node } = setup();
  const payload = "<img src=x onerror=alert(1)>";
  prefs.setTags("a-cafe", [payload, 'a" onfocus="alert(1)']);
  const popup = scope.tagEditorHtml({ id: "a-cafe" });
  const table = scope.tableTagsHtml({ id: "a-cafe" });
  scope.renderTagFilters();
  scope.renderTagManagement();
  for (const html of [popup, table, node("tagFilterList").innerHTML, node("personalizeTags").innerHTML]) {
    assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt;"));
    assert.ok(html.includes('translate="no"'));
    assert.ok(!html.includes("<img"));
    assert.ok(!html.includes('" onfocus="'));
  }
  assert.ok(popup.includes('value="a&quot; onfocus=&quot;alert(1)"'));
});

test("popup limits show inline errors and keep input focus, without changing saved tags", () => {
  const { scope, prefs, node } = setup();
  const input = node("tag-input-a-cafe");
  input.value = "x".repeat(31);
  scope.editCafeTag("a-cafe", "", false);
  assert.equal(node("tag-error-a-cafe").textContent, "Tags can be up to 30 characters.");
  assert.equal(input.focused, true);
  prefs.setTags("a-cafe", Array.from({ length: 20 }, (_, i) => "tag " + i));
  input.value = "new";
  scope.editCafeTag("a-cafe", "", false);
  assert.equal(node("tag-error-a-cafe").textContent, "A cafe can have up to 20 tags.");
  assert.equal(prefs.getTags("a-cafe").length, 20);
  assert.equal(scope.tagInputError(""), "Enter a tag.");
});

test("table tags cap at three chips with a remainder count; sort starts descending", () => {
  const { scope, prefs } = setup();
  prefs.setTags("a-cafe", ["one", "two", "three", "four", "five"]);
  const html = scope.tableTagsHtml({ id: "a-cafe" });
  assert.equal((html.match(/class="user-tag"/g) || []).length, 3);
  assert.ok(html.includes("+2"));
  vm.runInContext(app.slice(app.indexOf("  function setSort("), app.indexOf("  var STATUS_ORDER")), scope);
  vm.runInContext(app.slice(app.indexOf("  function sortValue("), app.indexOf("  function compareMyRatings(")), scope);
  scope.setSort("myTags");
  assert.equal(scope.state.sort.dir, "desc");
  assert.equal(scope.sortValue({ id: "a-cafe" }, "myTags", []), 5);
  scope.setSort("myTags");
  assert.equal(scope.state.sort.dir, "asc");
});

test("sidebar counts and visibility follow stored tags; all asset revisions match", () => {
  const { scope, prefs, node } = setup();
  scope.renderTagFilters();
  assert.equal(node("tagFilterGroup").hidden, true);
  prefs.setTags("a-cafe", ["visited"]);
  prefs.setTags("b-cafe", ["visited"]);
  scope.renderTagFilters();
  assert.equal(node("tagFilterGroup").hidden, false);
  assert.ok(node("tagFilterList").innerHTML.includes("(2)"));
  const html = fs.readFileSync(path.join(docs, "index.html"), "utf8");
  const versions = [...html.matchAll(/\?v=([^"]+)/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(versions)], ["20261021-tags"]);
  assert.ok(html.includes('role="alert"'));
});
