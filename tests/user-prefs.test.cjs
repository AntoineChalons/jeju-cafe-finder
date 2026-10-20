const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const docs = path.join(__dirname, "..", "docs");
const source = fs.readFileSync(path.join(docs, "user-prefs.js"), "utf8");
const plain = (value) => JSON.parse(JSON.stringify(value));
const T1 = "2026-10-19T03:00:00.000Z";
const T2 = "2026-10-19T04:00:00.000Z";
const T3 = "2026-10-19T05:00:00.000Z";

function memoryStorage(initial) {
  const data = new Map(Object.entries(initial || {}));
  return {
    data,
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, String(value)); },
    removeItem: (key) => { data.delete(key); },
  };
}

function throwingStorage(message) {
  const fail = () => { throw new Error(message || "blocked"); };
  return { getItem: fail, setItem: fail, removeItem: fail };
}

function setup(storage, options) {
  const settings = options || {};
  const warnings = [];
  const events = {};
  const persistCalls = [];
  const sandbox = {
    console: { warn: (...args) => warnings.push(args.join(" ")), error() {} },
    setTimeout: (fn) => { sandbox.pending = fn; return 1; },
    clearTimeout: () => { sandbox.pending = null; },
    navigator: { storage: { persist: () => { persistCalls.push(1); return Promise.resolve(true); } } },
    addEventListener: (type, fn) => { events[type] = fn; },
    pending: null,
  };
  sandbox.window = sandbox;
  if (settings.storageGetterThrows) {
    Object.defineProperty(sandbox, "localStorage", { get() { throw new Error("SecurityError"); } });
  } else {
    sandbox.localStorage = storage;
  }
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  const prefs = sandbox.window.UserPrefs;
  let clock = settings.now || T1;
  prefs._setNow(() => clock);
  return { prefs, sandbox, warnings, events, persistCalls, setClock: (value) => { clock = value; } };
}

function fullDoc(overrides) {
  return Object.assign({
    app: "jeju-cafe-finder",
    schema: 1,
    updatedAt: T1,
    lastExportAt: null,
    filters: { order: ["workFriendly", "openNow"], hidden: ["pets"], shown: ["boardGames"], defaultOn: ["workFriendly"], updatedAt: T1 },
    ratings: { "codeine-coffee": { stars: 4, updatedAt: T1 }, "gone-cafe": { stars: 2, updatedAt: T1 } },
    tags: { "codeine-coffee": { tags: ["visited", "Great espresso"], updatedAt: T1 } },
    ratingFilter: { minStars: 3, includeUnrated: true, updatedAt: T1 },
    aroundMe: { enabled: false, radiusKm: null, updatedAt: T1 },
  }, overrides || {});
}

function stored(storage) {
  return JSON.parse(storage.getItem("jcf:prefs"));
}

test("validate accepts the v1 example with null or ISO lastExportAt", () => {
  const { prefs } = setup(memoryStorage());
  for (const lastExportAt of [null, T2]) {
    const result = prefs.validate(fullDoc({ lastExportAt }));
    assert.equal(result.valid, true);
    assert.equal(result.doc.lastExportAt, lastExportAt);
    assert.equal(result.doc.ratings["codeine-coffee"].stars, 4);
    assert.deepEqual(plain(result.doc.tags["codeine-coffee"].tags), ["visited", "Great espresso"]);
    assert.deepEqual(plain(result.dropped), []);
  }
});

test("validate rejects a wrong app, a missing schema and non-object sections", () => {
  const { prefs } = setup(memoryStorage());
  assert.equal(prefs.validate(fullDoc({ app: "other" })).valid, false);
  const noSchema = fullDoc();
  delete noSchema.schema;
  assert.equal(prefs.validate(noSchema).valid, false);
  assert.equal(prefs.validate(null).valid, false);
  assert.equal(prefs.validate([]).valid, false);
  for (const section of ["filters", "ratings", "tags", "ratingFilter", "aroundMe"]) {
    for (const bad of [[], "text", 5, null]) {
      assert.equal(prefs.validate(fullDoc({ [section]: bad })).valid, false, section);
    }
  }
});

test("validate drops invalid entries individually and keeps the rest", () => {
  const { prefs, warnings } = setup(memoryStorage());
  const doc = JSON.parse(JSON.stringify(fullDoc()));
  doc.ratings = JSON.parse(`{
    "Bad Id": {"stars": 3, "updatedAt": "${T1}"},
    "constructor": {"stars": 3, "updatedAt": "${T1}"},
    "prototype": {"stars": 3, "updatedAt": "${T1}"},
    "__proto__": {"stars": 3, "updatedAt": "${T1}"},
    "seven": {"stars": 7, "updatedAt": "${T1}"},
    "half": {"stars": 2.5, "updatedAt": "${T1}"},
    "no-date": {"stars": 3},
    "ok-cafe": {"stars": 3, "updatedAt": "${T1}"},
    "cleared": {"stars": null, "updatedAt": "${T1}"}
  }`);
  doc.tags = JSON.parse(`{
    "text-tags": {"tags": "nope", "updatedAt": "${T1}"},
    "number-tags": {"tags": [1, 2], "updatedAt": "${T1}"},
    "constructor": {"tags": ["x"], "updatedAt": "${T1}"},
    "ok-cafe": {"tags": ["visited"], "updatedAt": "${T1}"}
  }`);
  const result = prefs.validate(doc);
  assert.equal(result.valid, true);
  assert.deepEqual(Object.keys(result.doc.ratings).sort(), ["cleared", "ok-cafe"]);
  assert.deepEqual(Object.keys(result.doc.tags), ["ok-cafe"]);
  assert.equal(Object.getPrototypeOf(result.doc.ratings), null);
  assert.equal(result.dropped.length, 10);
  assert.ok(warnings.length > 0);
});

test("validate never keeps a location or unknown fields", () => {
  const { prefs } = setup(memoryStorage());
  const doc = fullDoc({ aroundMe: { enabled: true, radiusKm: 5, lat: 33.4, lng: 126.5, updatedAt: T1 }, extra: 1 });
  const clean = plain(prefs.validate(doc).doc);
  assert.deepEqual(clean.aroundMe, { enabled: true, radiusKm: 5, updatedAt: T1 });
  assert.equal("extra" in clean, false);
});

test("migrate is a no-op for schema 1 and refuses schema 2", () => {
  const { prefs } = setup(memoryStorage());
  const doc = fullDoc();
  assert.equal(prefs.migrate(doc), doc);
  assert.throws(() => prefs.migrate(fullDoc({ schema: 2 })));
  assert.throws(() => prefs.migrate({ app: "jeju-cafe-finder" }));
});

test("merge: newer updatedAt wins per record and ties keep local", () => {
  const { prefs } = setup(memoryStorage());
  const local = fullDoc({
    ratings: { a: { stars: 1, updatedAt: T2 }, b: { stars: 2, updatedAt: T2 }, "only-local": { stars: 5, updatedAt: T1 } },
  });
  const incoming = fullDoc({
    ratings: { a: { stars: 5, updatedAt: T3 }, b: { stars: 4, updatedAt: T2 }, "only-incoming": { stars: 3, updatedAt: T1 } },
  });
  const merged = plain(prefs.merge(local, incoming));
  assert.equal(merged.ratings.a.stars, 5);
  assert.equal(merged.ratings.b.stars, 2);
  assert.equal(merged.ratings["only-local"].stars, 5);
  assert.equal(merged.ratings["only-incoming"].stars, 3);
});

test("merge: tombstones win when newer and lose when older", () => {
  const { prefs } = setup(memoryStorage());
  const local = fullDoc({
    ratings: { a: { stars: null, updatedAt: T3 }, b: { stars: 4, updatedAt: T3 } },
    tags: { a: { tags: [], updatedAt: T3 }, b: { tags: ["kept"], updatedAt: T3 } },
  });
  const incoming = fullDoc({
    ratings: { a: { stars: 5, updatedAt: T2 }, b: { stars: null, updatedAt: T2 } },
    tags: { a: { tags: ["old"], updatedAt: T2 }, b: { tags: [], updatedAt: T2 } },
  });
  const merged = plain(prefs.merge(local, incoming));
  assert.equal(merged.ratings.a.stars, null);
  assert.equal(merged.ratings.b.stars, 4);
  assert.deepEqual(merged.tags.a.tags, []);
  assert.deepEqual(merged.tags.b.tags, ["kept"]);
  const reverse = plain(prefs.merge(incoming, local));
  assert.equal(reverse.ratings.a.stars, null);
  assert.equal(reverse.ratings.b.stars, 4);
});

test("merge: filters, ratingFilter and aroundMe merge as one block each; lastExportAt stays local", () => {
  const { prefs } = setup(memoryStorage());
  const local = fullDoc({
    lastExportAt: T1,
    filters: { order: ["a"], hidden: [], shown: [], defaultOn: [], updatedAt: T3 },
    ratingFilter: { minStars: 3, includeUnrated: true, updatedAt: T1 },
    aroundMe: { enabled: false, radiusKm: null, updatedAt: T2 },
  });
  const incoming = fullDoc({
    lastExportAt: T3,
    filters: { order: ["b"], hidden: ["c"], shown: [], defaultOn: [], updatedAt: T2 },
    ratingFilter: { minStars: 5, includeUnrated: false, updatedAt: T2 },
    aroundMe: { enabled: true, radiusKm: 3, updatedAt: T2 },
  });
  const merged = plain(prefs.merge(local, incoming));
  assert.deepEqual(merged.filters, local.filters);
  assert.deepEqual(merged.ratingFilter, incoming.ratingFilter);
  assert.deepEqual(merged.aroundMe, local.aroundMe);
  assert.equal(merged.lastExportAt, T1);
});

test("merge ignores an invalid incoming document", () => {
  const { prefs } = setup(memoryStorage());
  assert.equal(prefs.merge(fullDoc(), { app: "other" }).ratings["codeine-coffee"].stars, 4);
});

test("normalizeTag cleans text and maps suggested labels to their key", () => {
  const { prefs } = setup(memoryStorage());
  assert.equal(prefs.normalizeTag("  Great \n  espresso\t"), "Great espresso");
  assert.equal(prefs.normalizeTag("   "), null);
  assert.equal(prefs.normalizeTag(7), null);
  assert.equal(prefs.normalizeTag("x".repeat(100)).length, 40);
  const labels = { visited: "Visited", wantToGo: "Want to go" };
  assert.equal(prefs.normalizeTag("visited", labels), "visited");
  assert.equal(prefs.normalizeTag(" want TO go ", labels), "wantToGo");
  assert.equal(prefs.normalizeTag("Want to go"), "Want to go");
});

test("load reports empty, then round-trips a full document and keeps unknown ids", () => {
  const storage = memoryStorage();
  const empty = setup(storage);
  assert.equal(empty.prefs.load().status, "empty");

  const original = fullDoc();
  const storage2 = memoryStorage({ "jcf:prefs": JSON.stringify(original) });
  const { prefs, setClock, persistCalls } = setup(storage2);
  assert.equal(prefs.load().status, "ok");
  assert.equal(prefs.getRating("codeine-coffee"), 4);
  assert.deepEqual(plain(prefs.getTags("codeine-coffee")), ["visited", "Great espresso"]);
  assert.deepEqual(plain(prefs.getFilterPrefs()),
    { order: ["workFriendly", "openNow"], hidden: ["pets"], shown: ["boardGames"], defaultOn: ["workFriendly"] });
  assert.deepEqual(plain(prefs.getRatingFilter()), { minStars: 3, includeUnrated: true });
  assert.deepEqual(plain(prefs.getAroundMe()), { enabled: false, radiusKm: null });

  setClock(T2);
  assert.equal(prefs.setRating("codeine-coffee", 5), true);
  assert.equal(prefs.flush(), true);
  const after = stored(storage2);
  assert.equal(after.ratings["codeine-coffee"].stars, 5);
  assert.equal(after.ratings["codeine-coffee"].updatedAt, T2);
  assert.equal(after.ratings["gone-cafe"].stars, 2);
  assert.deepEqual(after.tags, original.tags);
  assert.deepEqual(after.filters, original.filters);
  assert.equal(after.updatedAt, T2);
  assert.equal(persistCalls.length, 1);
  prefs.flush();
  assert.equal(persistCalls.length, 1);
});

test("setters validate input, debounce writes and notify listeners", () => {
  const storage = memoryStorage();
  const { prefs, sandbox } = setup(storage);
  prefs.load();
  const changes = [];
  const stop = prefs.onChange((change) => changes.push(change.source));
  assert.equal(prefs.setRating("codeine-coffee", 6), false);
  assert.equal(prefs.setRating("constructor", 3), false);
  assert.equal(prefs.setRating("codeine-coffee", 4), true);
  assert.equal(storage.getItem("jcf:prefs"), null);
  assert.equal(typeof sandbox.pending, "function");
  sandbox.pending();
  assert.equal(stored(storage).ratings["codeine-coffee"].stars, 4);
  assert.equal(prefs.setRatingFilter({ minStars: 4, includeUnrated: false }), true);
  assert.equal(prefs.setRatingFilter({ minStars: 2, includeUnrated: false }), false);
  assert.equal(prefs.setAroundMe({ enabled: true, radiusKm: 5 }), true);
  assert.equal(prefs.setAroundMe({ enabled: true, radiusKm: -1 }), false);
  assert.equal(prefs.setFilterPrefs({ order: ["openNow"], hidden: [], shown: [], defaultOn: ["openNow"] }), true);
  assert.equal(prefs.setFilterPrefs({ order: "openNow" }), false);
  assert.deepEqual(changes, ["local", "local", "local", "local"]);
  stop();
  prefs.setRating("codeine-coffee", 3);
  assert.equal(changes.length, 4);
});

test("clearing a rating or tags writes a tombstone instead of deleting the key", () => {
  const storage = memoryStorage({ "jcf:prefs": JSON.stringify(fullDoc()) });
  const { prefs, setClock } = setup(storage);
  prefs.load();
  setClock(T3);
  prefs.setRating("codeine-coffee", null);
  prefs.setTags("codeine-coffee", []);
  prefs.flush();
  const after = stored(storage);
  assert.deepEqual(after.ratings["codeine-coffee"], { stars: null, updatedAt: T3 });
  assert.deepEqual(after.tags["codeine-coffee"], { tags: [], updatedAt: T3 });
  assert.equal(prefs.getRating("codeine-coffee"), null);
  assert.deepEqual(plain(prefs.getTags("codeine-coffee")), []);
});

test("tags are normalised, de-duplicated and counted across cafes", () => {
  const storage = memoryStorage();
  const { prefs } = setup(storage);
  prefs.load();
  prefs.setTags("a-cafe", ["Great espresso", "great ESPRESSO", " Quiet ", ""]);
  prefs.setTags("b-cafe", ["great espresso", "Visited"]);
  assert.deepEqual(plain(prefs.getTags("a-cafe")), ["Great espresso", "Quiet"]);
  assert.deepEqual(plain(prefs.allTags()), [
    { tag: "Great espresso", count: 2 },
    { tag: "Quiet", count: 1 },
    { tag: "Visited", count: 1 },
  ]);
});

test("unavailable storage keeps the app working in memory", () => {
  for (const options of [{ throwing: true }, { storageGetterThrows: true }]) {
    const { prefs, sandbox } = setup(options.throwing ? throwingStorage() : null, options);
    const result = prefs.load();
    assert.equal(result.status, "unavailable");
    assert.equal(prefs.setRating("codeine-coffee", 4), true);
    assert.equal(prefs.getRating("codeine-coffee"), 4);
    assert.equal(prefs.flush(), false);
    assert.equal(sandbox.pending, null);
  }
});

test("a failed save (quota) is reported once and keeps the value in memory", () => {
  const storage = memoryStorage();
  const { prefs } = setup(storage);
  prefs.load();
  storage.setItem = () => { throw new Error("QuotaExceededError"); };
  const sources = [];
  prefs.onChange((change) => sources.push(change.source));
  prefs.setRating("codeine-coffee", 4);
  assert.equal(prefs.flush(), false);
  prefs.setRating("codeine-coffee", 5);
  assert.equal(prefs.flush(), false);
  assert.deepEqual(sources, ["local", "save-failed", "local"]);
  assert.equal(prefs.getRating("codeine-coffee"), 5);
});

test("garbage JSON is preserved under a corrupt key and the app starts fresh", () => {
  for (const raw of ["{bad", JSON.stringify({ app: "other", schema: 1 }), JSON.stringify({ app: "jeju-cafe-finder", schema: 1, ratings: [] }), "null"]) {
    const storage = memoryStorage({ "jcf:prefs": raw });
    const { prefs } = setup(storage, { now: T2 });
    assert.equal(prefs.load().status, "corrupt");
    const keys = Array.from(storage.data.keys()).filter((key) => key.startsWith("jcf:prefs:corrupt-"));
    assert.equal(keys.length, 1);
    assert.equal(storage.getItem(keys[0]), raw);
    assert.equal(prefs.getRating("codeine-coffee"), null);
    prefs.setRating("codeine-coffee", 4);
    prefs.flush();
    assert.equal(stored(storage).ratings["codeine-coffee"].stars, 4);
    assert.equal(storage.getItem(keys[0]), raw);
  }
});

test("corrupt data is never overwritten if it cannot be copied aside", () => {
  const storage = memoryStorage({ "jcf:prefs": "{bad" });
  const realSet = storage.setItem;
  storage.setItem = (key, value) => {
    if (key.startsWith("jcf:prefs:corrupt-")) throw new Error("QuotaExceededError");
    realSet(key, value);
  };
  const { prefs } = setup(storage);
  assert.equal(prefs.load().status, "corrupt");
  prefs.setRating("codeine-coffee", 4);
  assert.equal(prefs.flush(), false);
  assert.equal(storage.getItem("jcf:prefs"), "{bad");
});

test("a newer schema loads read-only and is never overwritten", () => {
  const raw = JSON.stringify(fullDoc({ schema: 2 }));
  const storage = memoryStorage({ "jcf:prefs": raw });
  const { prefs } = setup(storage);
  assert.equal(prefs.load().status, "newer");
  prefs.setRating("codeine-coffee", 4);
  assert.equal(prefs.flush(), false);
  assert.equal(storage.getItem("jcf:prefs"), raw);
  assert.equal(Array.from(storage.data.keys()).length, 1);
});

test("two tabs pick up each other's changes through the storage event", () => {
  const storage = memoryStorage();
  const tabA = setup(storage, { now: T1 });
  const tabB = setup(storage, { now: T1 });
  tabA.prefs.load();
  tabB.prefs.load();
  const seen = [];
  tabB.prefs.onChange((change) => seen.push(change.source));
  tabA.setClock(T2);
  tabA.prefs.setRating("codeine-coffee", 4);
  tabA.prefs.flush();
  tabB.events.storage({ key: "jcf:prefs", newValue: storage.getItem("jcf:prefs") });
  assert.equal(tabB.prefs.getRating("codeine-coffee"), 4);
  assert.deepEqual(seen, ["storage"]);
  tabB.events.storage({ key: "other", newValue: "{}" });
  tabB.events.storage({ key: "jcf:prefs", newValue: "{bad" });
  assert.deepEqual(seen, ["storage"]);
});

test("a storage event merges with a pending local write instead of discarding it", () => {
  const storage = memoryStorage();
  const tabA = setup(storage, { now: T1 });
  const tabB = setup(storage, { now: T1 });
  tabA.prefs.load();
  tabB.prefs.load();
  tabA.setClock(T2);
  tabA.prefs.setRating("a-cafe", 4);
  tabA.prefs.flush();
  tabB.setClock(T3);
  tabB.prefs.setRating("b-cafe", 2);
  tabB.events.storage({ key: "jcf:prefs", newValue: storage.getItem("jcf:prefs") });
  assert.equal(tabB.prefs.getRating("a-cafe"), 4);
  assert.equal(tabB.prefs.getRating("b-cafe"), 2);
});

test("the module makes no network request and uses only localStorage", () => {
  assert.doesNotMatch(source, /fetch\(|XMLHttpRequest|sendBeacon|WebSocket|geolocation|sessionStorage|document\.cookie/);
});

test("Object prototype names are valid tag text and are counted safely", () => {
  const storage = memoryStorage();
  const { prefs } = setup(storage);
  prefs.load();
  const tags = ["constructor", "prototype", "__proto__", "toString", "hasOwnProperty"];
  prefs.setTags("a-cafe", tags);
  prefs.setTags("b-cafe", ["CONSTRUCTOR", "__proto__"]);
  assert.deepEqual(plain(prefs.getTags("a-cafe")), tags);
  assert.deepEqual(plain(prefs.allTags()).slice(0, 2), [
    { tag: "__proto__", count: 2 }, { tag: "constructor", count: 2 },
  ]);
  prefs.flush();
  const reloaded = setup(storage);
  reloaded.prefs.load();
  assert.deepEqual(plain(reloaded.prefs.getTags("a-cafe")), tags);
});

test("pagehide writes only when a local save is pending", () => {
  const storage = memoryStorage();
  const { prefs, events, persistCalls } = setup(storage);
  prefs.load();
  events.pagehide();
  assert.equal(storage.getItem("jcf:prefs"), null);
  assert.equal(persistCalls.length, 0);
  prefs.setRating("a-cafe", 4);
  events.pagehide();
  assert.equal(stored(storage).ratings["a-cafe"].stars, 4);
  assert.equal(persistCalls.length, 1);
});

test("a newer schema from another tab cancels pending writes and becomes read-only", () => {
  const storage = memoryStorage();
  const { prefs, sandbox, events } = setup(storage);
  prefs.load();
  prefs.setRating("a-cafe", 4);
  const raw = JSON.stringify(fullDoc({ schema: 2 }));
  storage.setItem("jcf:prefs", raw);
  const seen = [];
  prefs.onChange((change) => seen.push(change.source));
  events.storage({ key: "jcf:prefs", newValue: raw });
  assert.equal(prefs.getStatus(), "newer");
  assert.equal(sandbox.pending, null);
  assert.deepEqual(seen, ["storage"]);
  assert.equal(prefs.flush(), false);
  assert.equal(storage.getItem("jcf:prefs"), raw);
});

test("flush checks for a newer schema even before its storage event arrives", () => {
  const storage = memoryStorage();
  const { prefs } = setup(storage);
  prefs.load();
  prefs.setRating("a-cafe", 4);
  const raw = JSON.stringify(fullDoc({ schema: 2 }));
  storage.setItem("jcf:prefs", raw);
  assert.equal(prefs.flush(), false);
  assert.equal(prefs.getStatus(), "newer");
  assert.equal(storage.getItem("jcf:prefs"), raw);
});

test("flush merges another tab's write even before its storage event arrives", () => {
  const storage = memoryStorage();
  const a = setup(storage, { now: T2 });
  const b = setup(storage, { now: T3 });
  a.prefs.load();
  b.prefs.load();
  a.prefs.setRating("a-cafe", 4);
  b.prefs.setRating("b-cafe", 5);
  a.prefs.flush();
  b.prefs.flush();
  assert.equal(stored(storage).ratings["a-cafe"].stars, 4);
  assert.equal(stored(storage).ratings["b-cafe"].stars, 5);
});

test("flush preserves corrupt data written by another tab before replacing it", () => {
  for (const backupFails of [false, true]) {
    const storage = memoryStorage();
    const { prefs } = setup(storage);
    prefs.load();
    prefs.setRating("a-cafe", 4);
    storage.setItem("jcf:prefs", "{bad");
    if (backupFails) {
      storage.setItem = () => { throw new Error("QuotaExceededError"); };
    }
    assert.equal(prefs.flush(), !backupFails);
    assert.equal(prefs.getStatus(), "corrupt");
    if (backupFails) {
      assert.equal(storage.getItem("jcf:prefs"), "{bad");
    } else {
      const backup = Array.from(storage.data.keys()).find((key) => key.startsWith("jcf:prefs:corrupt-"));
      assert.equal(storage.getItem(backup), "{bad");
      assert.equal(stored(storage).ratings["a-cafe"].stars, 4);
    }
  }
});

test("storage events from another storage area are ignored", () => {
  const { prefs, events } = setup(memoryStorage());
  prefs.load();
  events.storage({ key: "jcf:prefs", newValue: JSON.stringify(fullDoc()), storageArea: {} });
  assert.equal(prefs.getRating("codeine-coffee"), null);
});

test("getStatus reports a failed write and recovers after a successful retry", () => {
  const storage = memoryStorage();
  const { prefs } = setup(storage);
  prefs.load();
  const realSet = storage.setItem;
  storage.setItem = () => { throw new Error("QuotaExceededError"); };
  prefs.setRating("a-cafe", 4);
  prefs.flush();
  assert.equal(prefs.getStatus(), "unavailable");
  storage.setItem = realSet;
  assert.equal(prefs.flush(), true);
  assert.notEqual(prefs.getStatus(), "unavailable");
});

test("HTML loads UserPrefs before bootstrap and places the status notice first in main", () => {
  const html = fs.readFileSync(path.join(docs, "index.html"), "utf8");
  assert.ok(html.indexOf('src="user-prefs.js?') < html.indexOf('src="bootstrap.js?'));
  assert.match(html, /<main class="main">\s*<div id="prefsNotice" class="prefs-notice" role="status" hidden><\/div>/);
  assert.match(html, /href="prefs-notice\.css\?v=/);
});

async function bootstrapPrefs(prefs, storage) {
  function element() {
    return {
      hidden: true, children: [], handlers: {},
      appendChild(child) { this.children.push(child); },
      addEventListener(type, fn) { this.handlers[type] = fn; },
      set textContent(value) { this.text = value; this.children = []; },
      get textContent() { return this.text; },
    };
  }
  const notice = element();
  const appended = [];
  const warnings = [];
  const sandbox = {
    URL,
    setTimeout: () => 1, clearTimeout() {},
    console: { warn: (...args) => warnings.push(args), error() {} },
    addEventListener() {},
    localStorage: storage,
    document: {
      currentScript: null,
      getElementById: (id) => id === "prefsNotice" ? notice : null,
      createElement: element,
      body: {
        appendChild: (child) => appended.push(child),
        prepend: () => assert.fail("Bad preferences must not block startup"),
      },
    },
    loadCafeDatabase: async () => ({ cafes: [] }),
    loadCafeFilters: async () => [],
    loadMapPins: async () => ({}),
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(docs, "i18n.js"), "utf8"), sandbox);
  if (storage) vm.runInContext(source, sandbox);
  else sandbox.UserPrefs = prefs;
  vm.runInContext(fs.readFileSync(path.join(docs, "bootstrap.js"), "utf8"), sandbox);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(appended.length, 1);
  assert.equal(appended[0].src, "app.js");
  return { notice, sandbox, warnings };
}

test("bootstrap loads preferences once, renders each failure and supports dismissal", async () => {
  for (const status of ["empty", "ok", "unavailable", "corrupt", "newer"]) {
    let loads = 0;
    const { notice, sandbox } = await bootstrapPrefs({
      load() { loads += 1; return { status }; },
      onChange() {},
    });
    assert.equal(loads, 1);
    assert.equal(notice.hidden, ["empty", "ok"].includes(status));
    if (!notice.hidden) {
      assert.equal(notice.children[0].textContent, sandbox.APP_TRANSLATIONS.en.prefs[status]);
      const button = notice.children[1];
      assert.equal(button.type, "button");
      assert.equal(button.textContent, "Dismiss");
      button.handlers.click();
      assert.equal(notice.hidden, true);
    }
  }
});

test("bootstrap still starts when UserPrefs is missing or load throws", async () => {
  const missing = await bootstrapPrefs(undefined);
  assert.equal(missing.notice.hidden, true);
  const broken = await bootstrapPrefs({ load() { throw new Error("Broken prefs"); } });
  assert.equal(broken.notice.hidden, false);
  assert.equal(broken.warnings.length, 1);
  assert.equal(broken.notice.children[0].textContent, broken.sandbox.APP_TRANSLATIONS.en.prefs.unavailable);
});

test("a real failed write displays the non-blocking notice after startup", async () => {
  const storage = memoryStorage();
  const { notice, sandbox } = await bootstrapPrefs(null, storage);
  assert.equal(notice.hidden, true);
  storage.setItem = () => { throw new Error("QuotaExceededError"); };
  sandbox.UserPrefs.setRating("a-cafe", 4);
  sandbox.UserPrefs.flush();
  assert.equal(notice.hidden, false);
  assert.equal(notice.children[0].textContent, sandbox.APP_TRANSLATIONS.en.prefs.unavailable);
});

test("bootstrap displays a newer-schema notice received after startup", async () => {
  let listener;
  const { notice, sandbox } = await bootstrapPrefs({
    load: () => ({ status: "empty" }),
    onChange: (fn) => { listener = fn; },
    getStatus: () => "newer",
  });
  listener({ source: "storage" });
  assert.equal(notice.hidden, false);
  assert.equal(notice.children[0].textContent, sandbox.APP_TRANSLATIONS.en.prefs.newer);
});

test("a newer-schema warning takes priority over an earlier write failure", () => {
  const storage = memoryStorage();
  const { prefs, events } = setup(storage);
  prefs.load();
  const realSet = storage.setItem;
  storage.setItem = () => { throw new Error("QuotaExceededError"); };
  prefs.setRating("a-cafe", 4);
  prefs.flush();
  assert.equal(prefs.getStatus(), "unavailable");
  storage.setItem = realSet;
  const raw = JSON.stringify(fullDoc({ schema: 2 }));
  storage.setItem("jcf:prefs", raw);
  events.storage({ key: "jcf:prefs", newValue: raw });
  assert.equal(prefs.getStatus(), "newer");
  assert.equal(prefs.flush(), false);
  assert.equal(storage.getItem("jcf:prefs"), raw);
});
