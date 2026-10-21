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
    get length() { return data.size; },
    key: (index) => Array.from(data.keys())[index] ?? null,
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

test("backup UI messages resolve in the English-only dictionary, with visible error/status regions", () => {
  const scope = {};
  vm.runInNewContext(fs.readFileSync(path.join(docs, "i18n.js"), "utf8"), scope);
  assert.deepEqual(Object.keys(scope.APP_TRANSLATIONS), ["en"]);
  const html = fs.readFileSync(path.join(docs, "index.html"), "utf8");
  for (const match of html.matchAll(/data-i18n="(data\.[^"]+)"/g)) {
    const value = match[1].split(".").reduce((obj, key) => obj && obj[key], scope.APP_TRANSLATIONS.en);
    assert.equal(typeof value, "string", match[1]);
  }
  for (const key of ["invalid", "tooLarge", "readOnly", "protected", "changed"]) {
    assert.equal(typeof scope.APP_TRANSLATIONS.en.data[key], "string");
  }
  assert.match(html, /id="dataError"[^>]+role="alert"/);
  assert.match(html, /id="dataStatus"[^>]+role="status"/);
  assert.match(html, /type="file"[^>]+id="dataImportFile"[^>]+hidden/);
  assert.match(html, /<textarea[^>]+id="dataText"/);
});

test("stale Clipboard completion after closing/reset never recreates export metadata", async () => {
  const app = fs.readFileSync(path.join(docs, "app.js"), "utf8");
  for (const stale of [false, true]) {
    let handler, resolveCopy, marks = 0;
    const scope = {
      document: { getElementById: () => ({ addEventListener(type, fn) { handler = fn; } }) },
      UserPrefs: { exportDoc: () => fullDoc(), markExported: () => { marks++; } },
      navigator: { clipboard: { writeText: () => new Promise(resolve => { resolveCopy = resolve; }) } },
      dataReadVersion: 0, personalizeDialog: { open: true }, dataError: {}, dataStatus: {},
      message: key => key, showBackupText() { throw new Error("Unexpected fallback"); },
    };
    scope.window = scope;
    vm.runInNewContext(app.slice(app.indexOf('  document.getElementById("dataCopy").addEventListener'),
      app.indexOf('  document.getElementById("dataImport").addEventListener')), scope);
    const pending = handler();
    if (stale) { scope.dataReadVersion++; scope.personalizeDialog.open = false; }
    resolveCopy();
    await pending;
    assert.equal(marks, stale ? 0 : 1);
  }
});

test("export is a detached whitelist with tombstones but no local-only or location fields", () => {
  const doc = fullDoc({ lastExportAt: T1, extra: "no", ratings: { old: { stars: null, updatedAt: T1 } },
    aroundMe: { enabled: true, radiusKm: 3, lat: 33.4, lng: 126.5, updatedAt: T1 } });
  const storage = memoryStorage({ "jcf:prefs": JSON.stringify(doc), "jcf:prefs:corrupt-old": "secret" });
  const { prefs } = setup(storage, { now: T2 });
  prefs.load();
  const backup = plain(prefs.exportDoc());
  assert.deepEqual(Object.keys(backup).sort(), ["app", "schema", "updatedAt", "exportedAt", "filters", "ratings", "tags", "ratingFilter", "aroundMe"].sort());
  assert.deepEqual(backup.aroundMe, { radiusKm: 3, updatedAt: T1 });
  assert.deepEqual(backup.ratings.old, { stars: null, updatedAt: T1 });
  assert.equal(backup.exportedAt, T2);
  backup.tags["codeine-coffee"].tags.push("detached");
  assert.equal(prefs.getTags("codeine-coffee").includes("detached"), false);
  assert.equal(prefs.getSummary().lastExportAt, T1);
});

test("export filename uses the Seoul date across a UTC midnight boundary", () => {
  const { prefs } = setup(memoryStorage());
  assert.equal(prefs.exportFilename("2026-10-19T15:01:00.000Z"), "jeju-cafe-finder-2026-10-20.json");
  assert.equal(prefs.exportFilename("2026-10-19T14:59:00.000Z"), "jeju-cafe-finder-2026-10-19.json");
});

test("preview never writes, schedules a save, logs input or changes preferences", () => {
  const storage = memoryStorage({ "jcf:prefs": JSON.stringify(fullDoc()) });
  const h = setup(storage);
  h.prefs.load();
  const before = storage.getItem("jcf:prefs");
  const preview = h.prefs.importDoc(JSON.stringify(fullDoc({ ratings: { unknown: { stars: 5, updatedAt: T3 } } })));
  assert.equal(preview.valid, true);
  assert.equal(preview.ratings, 1);
  assert.equal(preview.tagged, 1);
  assert.equal(preview.filters, true);
  assert.deepEqual(plain(preview.ids).sort(), ["codeine-coffee", "unknown"]);
  assert.equal(storage.getItem("jcf:prefs"), before);
  assert.equal(h.prefs.getRating("unknown"), null);
  assert.equal(h.sandbox.pending, null);
  assert.equal(h.warnings.length, 0);
});

test("export / replace round trip preserves records and ignores portable metadata", () => {
  const a = setup(memoryStorage({ "jcf:prefs": JSON.stringify(fullDoc({ aroundMe: { enabled: true, radiusKm: 5, updatedAt: T1 } })) }));
  a.prefs.load();
  const backup = a.prefs.exportDoc();
  const storage = memoryStorage({ "jcf:prefs": JSON.stringify(fullDoc({ lastExportAt: T3 })) });
  const b = setup(storage, { now: T2 });
  b.prefs.load();
  assert.equal(b.prefs.importDoc(JSON.stringify(backup), "replace").valid, true);
  const expected = plain(a.prefs.validate(fullDoc({ aroundMe: { enabled: false, radiusKm: 5, updatedAt: T1 } })).doc);
  expected.lastExportAt = T3;
  assert.deepEqual(stored(storage), expected);
});

test("merge imports newer tombstones, keeps local ties and preserves lastExportAt / local mode", () => {
  const local = fullDoc({ lastExportAt: T1, aroundMe: { enabled: true, radiusKm: 3, updatedAt: T1 } });
  const storage = memoryStorage({ "jcf:prefs": JSON.stringify(local) });
  const { prefs } = setup(storage, { now: T3 });
  prefs.load();
  const incoming = fullDoc({ lastExportAt: T3, ratings: {
    "codeine-coffee": { stars: 1, updatedAt: T1 }, "gone-cafe": { stars: null, updatedAt: T2 },
    unknown: { stars: 5, updatedAt: T2 },
  }, tags: { "codeine-coffee": { tags: [], updatedAt: T2 } },
  aroundMe: { enabled: false, radiusKm: 10, updatedAt: T2 } });
  assert.equal(prefs.importDoc(JSON.stringify(incoming), "merge").persistent, true);
  assert.equal(prefs.getRating("codeine-coffee"), 4);
  assert.equal(prefs.getRating("gone-cafe"), null);
  assert.equal(prefs.getRating("unknown"), 5);
  assert.deepEqual(plain(prefs.getTags("codeine-coffee")), []);
  assert.deepEqual(plain(prefs.getAroundMe()), { enabled: true, radiusKm: 10 });
  assert.equal(stored(storage).lastExportAt, T1);
});

test("replace cannot resurrect absent local records on the next edit or reload", () => {
  const storage = memoryStorage({ "jcf:prefs": JSON.stringify(fullDoc({ updatedAt: T3 })) });
  const { prefs } = setup(storage);
  prefs.load();
  assert.equal(prefs.importDoc(JSON.stringify(fullDoc({ ratings: {}, tags: {} })), "replace").valid, true);
  assert.deepEqual(stored(storage).ratings, {});
  prefs.setRating("new", 2);
  prefs.flush();
  assert.deepEqual(Object.keys(stored(storage).ratings), ["new"]);
  const reload = setup(storage).prefs;
  reload.load();
  assert.equal(reload.getRating("codeine-coffee"), null);
  assert.deepEqual(plain(reload.getTags("codeine-coffee")), []);
});

test("invalid backup headers / sections / modes leave disk and memory unchanged", () => {
  const storage = memoryStorage({ "jcf:prefs": JSON.stringify(fullDoc()) });
  const h = setup(storage);
  h.prefs.load();
  const before = storage.getItem("jcf:prefs");
  const bad = ["not json", "null", "[]", "1", JSON.stringify({ app: "other", schema: 1 }),
    JSON.stringify({ app: "jeju-cafe-finder" }), JSON.stringify(fullDoc({ schema: 2 })),
    JSON.stringify(fullDoc({ schema: 0 })), JSON.stringify(fullDoc({ updatedAt: 2 }))];
  for (const key of ["ratings", "tags", "filters", "ratingFilter", "aroundMe"]) {
    for (const value of [null, [], "text", 5]) bad.push(JSON.stringify(fullDoc({ [key]: value })));
  }
  for (const text of bad) assert.equal(h.prefs.importDoc(text, "replace").valid, false);
  assert.equal(h.prefs.importDoc(JSON.stringify(fullDoc()), "bad-mode").valid, false);
  assert.equal(storage.getItem("jcf:prefs"), before);
  assert.equal(h.prefs.getRating("codeine-coffee"), 4);
  assert.equal(h.sandbox.pending, null);
});

test("backup size is capped in UTF-8 bytes before parsing, including the exact boundary", () => {
  const { prefs } = setup(memoryStorage());
  assert.equal(prefs.importDoc("x".repeat(prefs.MAX_IMPORT_BYTES + 1)).error, "tooLarge");
  assert.equal(prefs.importDoc(JSON.stringify(fullDoc({ padding: "한".repeat(180000) }))).error, "tooLarge");
  const base = JSON.stringify(fullDoc({ padding: "" }));
  const exact = base.replace('"padding":""', '"padding":"' + "x".repeat(prefs.MAX_IMPORT_BYTES - base.length) + '"');
  assert.equal(exact.length, prefs.MAX_IMPORT_BYTES);
  assert.equal(prefs.importDoc(exact).valid, true);
});

test("invalid records are counted/dropped; reserved IDs never become object prototypes", () => {
  const h = setup(memoryStorage());
  h.prefs.load();
  const doc = fullDoc({
    ratings: JSON.parse('{"a-cafe":{"stars":4,"updatedAt":"' + T1 + '"},"cleared":{"stars":null,"updatedAt":"' + T1 +
      '"},"constructor":{"stars":5,"updatedAt":"' + T1 + '"},"prototype":{"stars":5,"updatedAt":"' + T1 +
      '"},"__proto__":{"stars":5,"updatedAt":"' + T1 + '"},"bad":{"stars":6,"updatedAt":"' + T1 + '"}}'),
    tags: { "a-cafe": { tags: ['<img src=x onerror="x()">'], updatedAt: T1 },
      long: { tags: ["x".repeat(31)], updatedAt: T2 }, many: { tags: Array.from({ length: 21 }, (_, i) => "tag" + i), updatedAt: T2 },
      mixed: { tags: [3], updatedAt: T2 }, blank: { tags: [" "], updatedAt: T2 },
      constructor: { tags: ["bad"], updatedAt: T2 } },
  });
  const preview = h.prefs.importDoc(JSON.stringify(doc));
  assert.equal(preview.ratings, 1);
  assert.equal(preview.tagged, 1);
  assert.equal(preview.skipped, 9);
  assert.equal(h.prefs.importDoc(JSON.stringify(doc), "replace").valid, true);
  assert.deepEqual(Object.keys(stored(h.sandbox.localStorage).ratings), ["a-cafe", "cleared"]);
  assert.equal(h.prefs.getTags("a-cafe")[0], '<img src=x onerror="x()">');
  assert.equal(h.warnings.length, 0);
  assert.equal({}.stars, undefined);
});

test("discarding an invalid tag record never turns it into a newer deletion tombstone", () => {
  const storage = memoryStorage({ "jcf:prefs": JSON.stringify(fullDoc()) });
  const { prefs } = setup(storage);
  prefs.load();
  const doc = fullDoc({ tags: { "codeine-coffee": { tags: ["x".repeat(31)], updatedAt: T3 } } });
  assert.equal(prefs.importDoc(JSON.stringify(doc), "merge").skipped, 1);
  assert.deepEqual(plain(prefs.getTags("codeine-coffee")), ["visited", "Great espresso"]);
});

test("imports retain unknown IDs but never import enabled / coordinates / lastExportAt", () => {
  const storage = memoryStorage();
  const { prefs } = setup(storage);
  prefs.load();
  const doc = fullDoc({ lastExportAt: T3, userLocation: { lat: 33.456789 }, aroundMe: {
    enabled: true, lat: 33.456789, lng: 126.654321, radiusKm: 5, updatedAt: T2,
  } });
  assert.equal(prefs.importDoc(JSON.stringify(doc), "merge").valid, true);
  assert.equal(prefs.getRating("gone-cafe"), 2);
  assert.equal(prefs.getAroundMe().enabled, false);
  assert.equal(stored(storage).lastExportAt, null);
  assert.equal(JSON.stringify(stored(storage)).includes("33.456789"), false);
  assert.equal(JSON.stringify(prefs.exportDoc()).includes('"enabled"'), false);
});

test("markExported changes only local export metadata, not record/root timestamps", () => {
  const storage = memoryStorage({ "jcf:prefs": JSON.stringify(fullDoc()) });
  const h = setup(storage, { now: T3 });
  h.prefs.load();
  assert.equal(h.prefs.markExported(), true);
  assert.equal(stored(storage).lastExportAt, T3);
  assert.equal(stored(storage).updatedAt, T1);
  assert.equal(stored(storage).ratings["codeine-coffee"].updatedAt, T1);
  assert.equal("lastExportAt" in h.prefs.exportDoc(), false);
});

test("newer local schema blocks import/export without overwriting it", () => {
  const raw = JSON.stringify(fullDoc({ schema: 2 }));
  const storage = memoryStorage({ "jcf:prefs": raw });
  const { prefs } = setup(storage);
  prefs.load();
  assert.equal(prefs.importDoc(JSON.stringify(fullDoc())).valid, true);
  assert.equal(prefs.importDoc(JSON.stringify(fullDoc()), "replace").error, "readOnly");
  assert.equal(prefs.exportDoc(), null);
  assert.equal(prefs.markExported(), false);
  assert.equal(storage.getItem("jcf:prefs"), raw);
});

test("a newer schema appearing during import restores the original in-memory document", () => {
  const storage = memoryStorage({ "jcf:prefs": JSON.stringify(fullDoc()) });
  const { prefs } = setup(storage);
  prefs.load();
  const get = storage.getItem;
  let reads = 0;
  const newer = JSON.stringify(fullDoc({ schema: 2 }));
  storage.getItem = (key) => { if (++reads === 2) storage.data.set("jcf:prefs", newer); return get(key); };
  const result = prefs.importDoc(JSON.stringify(fullDoc({ ratings: {} })), "replace");
  assert.equal(result.error, "readOnly");
  assert.equal(prefs.getRating("codeine-coffee"), 4);
  assert.equal(storage.getItem("jcf:prefs"), newer);
});

test("valid imports remain usable in memory when storage is blocked", () => {
  const { prefs } = setup(throwingStorage());
  prefs.load();
  const result = prefs.importDoc(JSON.stringify(fullDoc()), "replace");
  assert.equal(result.valid, true);
  assert.equal(result.persistent, false);
  assert.equal(prefs.getRating("codeine-coffee"), 4);
  assert.equal(prefs.getStatus(), "unavailable");
  assert.equal(prefs.exportDoc().ratings["gone-cafe"].stars, 2);
});

test("a failed replace write retries without resurrecting the old disk document", () => {
  const storage = memoryStorage({ "jcf:prefs": JSON.stringify(fullDoc()) });
  const { prefs } = setup(storage);
  prefs.load();
  const set = storage.setItem;
  storage.setItem = () => { throw new Error("QuotaExceededError"); };
  assert.equal(prefs.importDoc(JSON.stringify(fullDoc({ ratings: {}, tags: {} })), "replace").persistent, false);
  storage.setItem = set;
  prefs.setRating("new", 3);
  prefs.flush();
  assert.deepEqual(Object.keys(stored(storage).ratings), ["new"]);
});

test("delete cancels pending writes, removes only prefs and keeps recovery copies", () => {
  const storage = memoryStorage({ "jcf:prefs": JSON.stringify(fullDoc()), "jcf:prefs:corrupt-old": "original", unrelated: "keep" });
  const h = setup(storage);
  h.prefs.load();
  h.prefs.setRating("pending", 5);
  assert.equal(h.prefs.deleteAll().ok, true);
  assert.equal(h.sandbox.pending, null);
  h.events.pagehide();
  assert.equal(storage.getItem("jcf:prefs"), null);
  assert.equal(storage.getItem("jcf:prefs:corrupt-old"), "original");
  assert.equal(storage.getItem("unrelated"), "keep");
  assert.equal(h.prefs.getRating("codeine-coffee"), null);
  assert.equal(h.prefs.getSummary().lastExportAt, null);
  assert.deepEqual(plain(h.prefs.getAroundMe()), { enabled: false, radiusKm: null });
});

test("failed deletion preserves disk/memory and pending user edits", () => {
  const storage = memoryStorage({ "jcf:prefs": JSON.stringify(fullDoc()) });
  const h = setup(storage);
  h.prefs.load();
  h.prefs.setRating("pending", 5);
  storage.removeItem = () => { throw new Error("blocked"); };
  assert.equal(h.prefs.deleteAll().ok, false);
  assert.equal(h.prefs.getRating("pending"), 5);
  assert.equal(h.prefs.getRating("codeine-coffee"), 4);
  assert.notEqual(h.sandbox.pending, null);
});

test("blocked storage still permits an explicitly session-only reset", () => {
  const { prefs } = setup(throwingStorage());
  prefs.load();
  prefs.setRating("memory-only", 4);
  const result = prefs.deleteAll();
  assert.equal(result.ok, true);
  assert.equal(result.persistent, false);
  assert.equal(prefs.getRating("memory-only"), null);
});

test("failed recovery removal reports partial failure without touching unrelated keys", () => {
  const storage = memoryStorage({ "jcf:prefs:corrupt-one": "a", "jcf:prefs:corrupt-two": "b", unrelated: "keep" });
  const { prefs } = setup(storage);
  prefs.load();
  const remove = storage.removeItem;
  storage.removeItem = (key) => { if (key.endsWith("two")) throw new Error("blocked"); remove(key); };
  assert.equal(prefs.removeRecoveryCopies(), false);
  assert.equal(prefs.getSummary().recoveryCount, 1);
  assert.equal(storage.getItem("unrelated"), "keep");
});

test("failed corrupt-copy protection rejects import and preserves the original", () => {
  const storage = memoryStorage();
  const { prefs } = setup(storage);
  prefs.load();
  storage.data.set("jcf:prefs", "original broken data");
  storage.setItem = () => { throw new Error("QuotaExceededError"); };
  assert.equal(prefs.importDoc(JSON.stringify(fullDoc()), "replace").error, "protected");
  assert.equal(storage.getItem("jcf:prefs"), "original broken data");
  assert.equal(prefs.getRating("codeine-coffee"), null);
});

test("cross-tab deletion cancels an old pending write and resets local state", () => {
  const storage = memoryStorage({ "jcf:prefs": JSON.stringify(fullDoc()) });
  const h = setup(storage);
  h.prefs.load();
  h.prefs.setRating("pending", 5);
  storage.removeItem("jcf:prefs");
  h.events.storage({ key: "jcf:prefs", newValue: null, storageArea: storage });
  h.events.pagehide();
  assert.equal(storage.getItem("jcf:prefs"), null);
  assert.equal(h.sandbox.pending, null);
  assert.equal(h.prefs.getRating("pending"), null);
});

test("a flush racing the delete storage event also cannot resurrect old data", () => {
  const storage = memoryStorage({ "jcf:prefs": JSON.stringify(fullDoc()) });
  const h = setup(storage);
  h.prefs.load();
  h.prefs.setRating("pending", 5);
  storage.removeItem("jcf:prefs");
  assert.equal(h.prefs.flush(), false);
  assert.equal(storage.getItem("jcf:prefs"), null);
  assert.equal(h.prefs.getRating("codeine-coffee"), null);
});

test("recovery copies have a separate deletion API scoped strictly to their prefix", () => {
  const storage = memoryStorage({ "jcf:prefs": JSON.stringify(fullDoc()), "jcf:prefs:corrupt-one": "a",
    "jcf:prefs:corrupt-two": "b", "jcf:prefs.other": "keep", unrelated: "keep" });
  const { prefs } = setup(storage);
  prefs.load();
  assert.equal(prefs.getSummary().recoveryCount, 2);
  assert.equal(prefs.removeRecoveryCopies(), true);
  assert.equal(prefs.getSummary().recoveryCount, 0);
  assert.equal(prefs.getRating("codeine-coffee"), 4);
  assert.equal(storage.getItem("jcf:prefs.other"), "keep");
  assert.equal(storage.getItem("unrelated"), "keep");
});

test("import protects a corrupt disk copy before replacing it", () => {
  const storage = memoryStorage();
  const { prefs } = setup(storage);
  prefs.load();
  storage.data.set("jcf:prefs", "broken original");
  assert.equal(prefs.importDoc(JSON.stringify(fullDoc()), "replace").valid, true);
  assert.equal(storage.getItem("jcf:prefs:corrupt-" + T1.replace(/[^0-9]/g, "")), "broken original");
  assert.equal(prefs.getRating("codeine-coffee"), 4);
});

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
  assert.equal(prefs.normalizeTag("x".repeat(100)), null);
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

const configuredFilters = [
  { key: "openNow", enabled: true, index: 0 },
  { key: "workFriendly", enabled: true, index: 1 },
  { key: "pets", enabled: true, index: 2 },
  { key: "boardGames", enabled: false, index: 3 },
];

test("applyFilterPrefs starts with enabled config entries in index order", () => {
  const { prefs } = setup(memoryStorage());
  const configured = configuredFilters.slice().reverse();
  assert.deepEqual(plain(prefs.applyFilterPrefs(configured, {})).map((entry) => entry.key),
    ["openNow", "workFriendly", "pets"]);
});

test("applyFilterPrefs handles hidden and explicitly shown disabled filters", () => {
  const { prefs } = setup(memoryStorage());
  assert.deepEqual(plain(prefs.applyFilterPrefs(configuredFilters, {
    hidden: ["pets"], shown: ["boardGames"],
  })).map((entry) => entry.key), ["openNow", "workFriendly", "boardGames"]);
  assert.deepEqual(plain(prefs.applyFilterPrefs(configuredFilters, {
    hidden: ["boardGames"], shown: ["boardGames"],
  })).map((entry) => entry.key), ["openNow", "workFriendly", "pets", "boardGames"]);
});

test("applyFilterPrefs applies saved order first and appends new filters in config order", () => {
  const { prefs } = setup(memoryStorage());
  const configured = configuredFilters.concat([
    { key: "newFirst", enabled: true, index: 4 },
    { key: "newSecond", enabled: true, index: 5 },
  ]).reverse();
  assert.deepEqual(plain(prefs.applyFilterPrefs(configured, {
    order: ["removedFilter", "workFriendly", "workFriendly", "openNow"],
  })).map((entry) => entry.key), ["workFriendly", "openNow", "pets", "newFirst", "newSecond"]);
});

test("applyFilterPrefs never mutates the configured array, entries or saved preferences", () => {
  const { prefs } = setup(memoryStorage());
  const configured = Object.freeze(configuredFilters.map((entry) => Object.freeze({ ...entry })));
  const settings = Object.freeze({
    order: Object.freeze(["boardGames", "removedFilter"]),
    hidden: Object.freeze(["openNow"]),
    shown: Object.freeze(["boardGames", "removedFilter"]),
    defaultOn: Object.freeze(["workFriendly"]),
  });
  const before = JSON.stringify({ configured, settings });
  prefs.applyFilterPrefs(configured, settings);
  assert.equal(JSON.stringify({ configured, settings }), before);
});

test("applyFilterPrefs ignores bad preferences and unknown names without blocking", () => {
  const { prefs } = setup(memoryStorage());
  for (const settings of [undefined, null, 42, false, "", [], {
    order: "openNow", hidden: {}, shown: null,
  }, {
    order: ["bad-key", 42, null, "removedFilter"], hidden: ["unknown"], shown: ["unknown"],
  }]) {
    assert.deepEqual(plain(prefs.applyFilterPrefs(configuredFilters, settings)).map((entry) => entry.key),
      ["openNow", "workFriendly", "pets"]);
  }
  for (const configured of [undefined, null, {}, 42]) {
    assert.deepEqual(plain(prefs.applyFilterPrefs(configured, {})), []);
  }
});

test("applyFilterPrefs supports all hidden and stable equal-index order", () => {
  const { prefs } = setup(memoryStorage());
  assert.deepEqual(plain(prefs.applyFilterPrefs(configuredFilters, {
    hidden: ["openNow", "workFriendly", "pets"],
  })), []);
  const tied = configuredFilters.slice(0, 3).map((entry) => ({ ...entry, index: 0 }));
  assert.deepEqual(plain(prefs.applyFilterPrefs(tied, {})).map((entry) => entry.key),
    ["openNow", "workFriendly", "pets"]);
});

test("removed filter preferences survive persistence and apply when config reintroduces them", () => {
  const storage = memoryStorage();
  const { prefs } = setup(storage);
  prefs.load();
  prefs.setFilterPrefs({
    order: ["goneFilter", "workFriendly"], hidden: ["goneHidden"],
    shown: ["goneFilter"], defaultOn: ["goneFilter"],
  });
  const before = plain(prefs.getFilterPrefs());
  prefs.applyFilterPrefs(configuredFilters, before);
  prefs.flush();
  const reloaded = setup(storage);
  reloaded.prefs.load();
  assert.deepEqual(plain(reloaded.prefs.getFilterPrefs()), before);
  assert.equal(reloaded.prefs.applyFilterPrefs(configuredFilters.concat([
    { key: "goneFilter", enabled: false, index: 5 },
  ]), before)[0].key, "goneFilter");
});

test("ratings and their filter persist together, with clear tombstones and orphan IDs retained", () => {
  const storage = memoryStorage();
  const first = setup(storage);
  first.prefs.load();
  first.prefs.setRating("published-cafe", 5);
  first.prefs.setRating("unpublished-cafe", 2);
  first.prefs.setRatingFilter({ minStars: 3, includeUnrated: false });
  first.prefs.flush();
  const second = setup(storage, { now: T2 });
  second.prefs.load();
  assert.equal(second.prefs.getRating("published-cafe"), 5);
  assert.deepEqual(plain(second.prefs.getRatingFilter()), { minStars: 3, includeUnrated: false });
  second.prefs.setRating("published-cafe", null);
  second.prefs.flush();
  assert.deepEqual(stored(storage).ratings["published-cafe"], { stars: null, updatedAt: T2 });
  assert.equal(stored(storage).ratings["unpublished-cafe"].stars, 2);
  assert.equal(second.prefs.passesRatingFilter(null, second.prefs.getRatingFilter()), false);
});
