const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const docs = path.join(__dirname, "..", "docs");
const initSqlJs = require(path.join(docs, "vendor/sql.js/sql-wasm.js"));
const sqlPromise = initSqlJs({
  locateFile: (file) => path.join(docs, "vendor/sql.js", file),
});

async function loadKinds(withKind, withTranslations = false) {
  const SQL = await sqlPromise;
  const db = new SQL.Database();
  const booleans = [
    "work_friendly", "local_roast", "sells_beans", "outdoor", "dessert", "brunch",
    "view", "arc_discount", "loyalty", "books", "board_games", "pets", "kids",
  ];
  db.run("CREATE TABLE cafes (id TEXT, publish INTEGER, name TEXT, name_kr TEXT, " +
    (withKind ? "kind TEXT, " : "") +
    "region TEXT, lat REAL, lng REAL, size TEXT, price INTEGER, " +
    booleans.map((column) => column + " INTEGER").join(", ") +
    ", blurb TEXT, hours_note TEXT, hours_checked TEXT, naver_url TEXT, source_url TEXT)");
  db.run("CREATE TABLE cafe_hours (cafe_id TEXT, day TEXT, open TEXT, close TEXT)");
  if (withTranslations) {
    // Deliberately incompatible legacy schema: the loader must never query it.
    db.run("CREATE TABLE cafe_translations (unused TEXT)");
    db.run("INSERT INTO cafe_translations VALUES ('ignored')");
  }
  for (const kind of ["cafe", "roastery", "bakery", "pub"]) {
    const columns = ["id", "publish", "name", "name_kr", "region", "lat", "lng"];
    const values = [kind, 1, kind, "카페 " + kind, "North", 33.5, 126.5];
    if (withKind) {
      columns.push("kind");
      values.push(kind);
    }
    db.run("INSERT INTO cafes (" + columns.join(", ") + ") VALUES (" +
      columns.map(() => "?").join(", ") + ")", values);
  }
  db.run("INSERT INTO cafes (id, publish) VALUES ('draft', 0)");
  const bytes = db.export();
  db.close();
  const sandbox = {
    URLSearchParams, Uint8Array,
    window: { location: { search: "" }, initSqlJs: async () => SQL },
    fetch: async () => ({ ok: true, arrayBuffer: async () => bytes }),
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(docs, "db-loader.js"), "utf8"), sandbox);
  return sandbox.window.loadCafeDatabase();
}

test("database loader preserves all four kinds and excludes unpublished rows", async () => {
  const loaded = await loadKinds(true);
  assert.deepEqual(Array.from(loaded.cafes, (cafe) => cafe.kind), ["cafe", "roastery", "bakery", "pub"]);
  assert.equal(loaded.cafes.length, 4);
  assert.equal(loaded.cafes[0].nameKr, "카페 cafe");
  assert.deepEqual(Object.keys(loaded), ["cafes"]);
});

test("database loader ignores a legacy translations table", async () => {
  const loaded = await loadKinds(true, true);
  assert.deepEqual(JSON.parse(JSON.stringify(loaded)), JSON.parse(JSON.stringify(await loadKinds(true))));
});

test("database loader supports older databases with no kind or contact columns", async () => {
  const loaded = await loadKinds(false);
  assert.equal(loaded.cafes.length, 4);
  assert.ok(loaded.cafes.every((cafe) => cafe.kind === "cafe" && cafe.instagramUrl === ""));
});
