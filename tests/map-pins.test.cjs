const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const docs = path.join(__dirname, "..", "docs");
const source = fs.readFileSync(path.join(docs, "map-pins.js"), "utf8");
const config = JSON.parse(fs.readFileSync(path.join(docs, "map-pins-config.json"), "utf8"));
const app = fs.readFileSync(path.join(docs, "app.js"), "utf8");
const html = fs.readFileSync(path.join(docs, "index.html"), "utf8");

function runtime(fetch = async () => ({ ok: true, json: async () => config })) {
  const sandbox = {
    window: {}, fetch,
    document: {
      createElement: () => ({
        attributes: {}, properties: {}, children: [],
        setAttribute(key, value) { this.attributes[key] = value; },
        appendChild(child) { this.children.push(child); },
        style: { values: {}, setProperty(key, value) { this.values[key] = value; } },
      }),
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return sandbox;
}

test("fixed venue symbols and default colours follow the requested mapping", () => {
  const sandbox = runtime();
  sandbox.window.configureMapPins(config);
  const expected = {
    bakery: ["#B96745", "croissant.svg"],
    roastery: ["#3C3C3C", "coffee-bean.svg"],
    cafe: ["#55296E", "coffee-cup.svg"],
    pub: ["#C2A13A", "beer-mug.svg"],
  };
  assert.deepEqual(Array.from(sandbox.window.MAP_PIN_KINDS), Object.keys(expected));
  for (const [kind, [color, file]] of Object.entries(expected)) {
    const symbol = sandbox.window.createMapPinSymbol(kind);
    assert.equal(symbol.className, "map-pin-symbol");
    assert.equal(symbol.attributes["data-pin-kind"], kind);
    assert.equal(symbol.attributes["aria-hidden"], "true");
    assert.equal(symbol.children[0].className, "map-pin-glyph");
    assert.equal(symbol.style.values["--pin-color"], color);
    assert.equal(symbol.style.values["--pin-icon"], `url("icons/map-pins/${file}")`);
    assert.match(fs.readFileSync(path.join(docs, "icons/map-pins", file), "utf8"), /<svg/);
  }
});

test("editing only JSON changes marker and legend colours without changing shapes", () => {
  const sandbox = runtime();
  const edited = structuredClone(config);
  edited.bakery.color = "#123abc";
  sandbox.window.configureMapPins(edited);
  const first = sandbox.window.createMapPinSymbol("bakery");
  const second = sandbox.window.createMapPinSymbol("bakery");
  assert.equal(first.style.values["--pin-color"], "#123abc");
  assert.equal(second.style.values["--pin-color"], "#123abc");
  assert.equal(first.style.values["--pin-icon"], 'url("icons/map-pins/croissant.svg")');
  // Stored config is a validated snapshot, not a mutable reference.
  edited.bakery.color = "#ffffff";
  assert.equal(sandbox.window.createMapPinSymbol("bakery").style.values["--pin-color"], "#123abc");
});

test("invalid/missing colour entries and unknown kinds fail with actionable errors", () => {
  const sandbox = runtime();
  for (const invalid of [null, [], "not an object"]) {
    assert.throws(() => sandbox.window.configureMapPins(invalid), /venue-type object/);
  }
  for (const color of ["#abc", "purple", " #123456", "#12345G", "url(evil)", null]) {
    const edited = structuredClone(config);
    edited.cafe.color = color;
    assert.throws(() => sandbox.window.configureMapPins(edited), /cafe requires a six-digit hex color/);
  }
  const missing = structuredClone(config);
  delete missing.pub;
  assert.throws(() => sandbox.window.configureMapPins(missing), /pub requires/);
  assert.throws(() => sandbox.window.configureMapPins({ ...config, unknown: { color: "#123456" } }), /Unknown map pin kind/);
  assert.throws(() => sandbox.window.createMapPinSymbol("cafe"), /has not loaded/);
  sandbox.window.configureMapPins(config);
  assert.throws(() => sandbox.window.createMapPinSymbol("__proto__"), /Unknown map pin kind/);
});

test("config load revalidates JSON on every page load and rejects HTTP errors", async () => {
  const calls = [];
  const sandbox = runtime(async (url, options) => {
    calls.push({ url, cache: options.cache });
    return { ok: true, json: async () => config };
  });
  await sandbox.window.loadMapPins();
  assert.deepEqual(calls, [{ url: "map-pins-config.json", cache: "no-cache" }]);
  assert.equal(sandbox.window.createMapPinSymbol("pub").style.values["--pin-color"], config.pub.color);
  const broken = runtime(async () => ({ ok: false, status: 404 }));
  await assert.rejects(broken.window.loadMapPins(), /map-pins-config.json: HTTP 404/);
});

test("legend precedes map and shares the marker symbol factory and translated type labels", () => {
  assert.ok(html.indexOf('id="mapLegend"') < html.indexOf('id="map"'));
  assert.match(app.slice(app.indexOf("  function renderMapLegend()"), app.indexOf("  function mapPinTitle")), /createMapPinSymbol\(kind\)/);
  assert.match(app.slice(app.indexOf("  function createMarkers()"), app.indexOf("  function updateMapMarkers")), /createMapPinSymbol\(cafe.kind\)/);
  assert.ok((app.match(/renderMapLegend\(\);/g) || []).length >= 2);
  const translations = {};
  vm.createContext(translations);
  vm.runInContext(fs.readFileSync(path.join(docs, "i18n.js"), "utf8"), translations);
  for (const locale of ["en", "ko"]) {
    assert.ok(translations.APP_TRANSLATIONS[locale].map.legend);
    for (const kind of Object.keys(config)) {
      assert.ok(translations.APP_TRANSLATIONS[locale].map.pinTypes[kind]);
    }
  }
});
