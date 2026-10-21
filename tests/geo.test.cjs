const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const docs = path.join(__dirname, "..", "docs");
const app = fs.readFileSync(path.join(docs, "app.js"), "utf8");
const plain = (value) => JSON.parse(JSON.stringify(value));
const HERE = { lat: 33.4996, lng: 126.5312 };
const THERE = { lat: 33.2541, lng: 126.56 };

function harness(options = {}) {
  const nodes = new Map();
  const windowEvents = {};
  const documentEvents = {};
  const watchers = new Map();
  const active = new Set();
  const cleared = [];
  const stored = new Map();
  const updates = [];
  const fits = [];
  let nextWatch = 0;
  let permissionQueries = 0;
  function element() {
    return {
      attrs: {}, children: [], events: {}, innerHTML: "", textContent: "",
      setAttribute(key, value) { this.attrs[key] = value; },
      addEventListener(type, fn) { this.events[type] = fn; },
      appendChild(child) { this.children.push(child); child.parentNode = this; },
      remove() { this.removed = true; },
    };
  }
  function node(id) {
    if (!nodes.has(id)) nodes.set(id, element());
    return nodes.get(id);
  }
  const navigator = {
    geolocation: {
      watchPosition(fix, error, settings) {
        if (options.throwOnWatch) throw new Error("Unavailable");
        const id = nextWatch++;
        watchers.set(id, { fix, error, settings });
        active.add(id);
        if (options.synchronousError) error({ code: 1 });
        return id;
      },
      clearWatch(id) { cleared.push(id); active.delete(id); },
    },
    permissions: {
      query() {
        permissionQueries++;
        if (options.permissionThrows) throw new Error("Unsupported");
        if (options.permissionRejects) return Promise.reject(new Error("Unsupported"));
        return Promise.resolve({ state: options.permission || "prompt" });
      },
    },
  };
  if (options.unsupported) delete navigator.geolocation;
  if (options.noPermissions) delete navigator.permissions;
  class Marker {
    constructor(value) { this.element = value.element; }
    setLngLat(point) { this.point = point; return this; }
    addTo() { return this; }
    getElement() { return this.element; }
    remove() { this.removed = true; }
  }
  class Bounds {
    constructor() { this.points = []; }
    extend(point) { this.points.push(point); return this; }
  }
  const scope = {
    URLSearchParams, Intl, navigator, console: { warn() {} },
    setTimeout: () => 1, clearTimeout() {},
    location: { search: options.search || "" },
    localStorage: {
      getItem: (key) => stored.get(key) || null,
      setItem: (key, value) => stored.set(key, value),
    },
    addEventListener(type, fn) { (windowEvents[type] ||= []).push(fn); },
    document: {
      hidden: false, createElement: element, getElementById: node,
      addEventListener(type, fn) { (documentEvents[type] ||= []).push(fn); },
    },
    maplibregl: { Marker, LngLatBounds: Bounds },
    map: {
      addControl(control) { control.onAdd(); },
      fitBounds(bounds, settings) { fits.push({ points: plain(bounds.points), settings }); },
    },
    mapReady: options.mapReady !== false,
    renderTableHeader() {},
    update(value) { updates.push(value); },
    hasCriterion: () => true,
    CRITERIA: [], CONFIGURED_CRITERIA: [],
    CAFES: Array.from({ length: 7 }, (_, i) => ({
      id: "cafe-" + i, lat: HERE.lat + i * 0.01, lng: HERE.lng, kind: "cafe",
    })),
  };
  scope.window = scope;
  vm.createContext(scope);
  for (const file of ["data-config.js", "i18n.js", "geo.js", "user-prefs.js"]) {
    vm.runInContext(fs.readFileSync(path.join(docs, file), "utf8"), scope);
  }
  scope.message = (key, values = {}) => {
    const text = key.split(".").reduce((value, part) => value[part], scope.APP_TRANSLATIONS.en);
    return text.replace(/\{(\w+)\}/g, (_, token) => values[token]);
  };
  scope.UserPrefs.load();
  scope.UserPrefs.setAroundMe({ enabled: !!options.remembered, radiusKm: options.radius ?? null });
  vm.runInContext(app.slice(app.indexOf("  var state ="), app.indexOf("  var kindListEl")), scope);
  vm.runInContext(app.slice(app.indexOf("  function escapeHtml("), app.indexOf("  function safeUrl(")), scope);
  vm.runInContext(app.slice(app.indexOf("  var aroundMeActive ="), app.indexOf("  var labelLayoutFrame")), scope);
  function fix(point = HERE, id = nextWatch - 1) {
    watchers.get(id).fix({ coords: { latitude: point.lat, longitude: point.lng, accuracy: 12.4 } });
  }
  return {
    scope, geo: scope.CafeGeo, node, watchers, active, cleared, stored, updates, fits, fix,
    documentEvents, windowEvents, permissionQueries: () => permissionQueries,
  };
}

test("haversine: identical, Jeju city halls, 127-degree and antimeridian crossings", () => {
  const { geo } = harness();
  assert.equal(geo.distanceKm(HERE, HERE), 0);
  assert.ok(Math.abs(geo.distanceKm(HERE, THERE) - 27) < 1);
  const crossing = geo.distanceKm({ lat: 33, lng: 126.99 }, { lat: 33, lng: 127.01 });
  assert.ok(crossing > 1 && crossing < 3);
  assert.ok(geo.distanceKm({ lat: 0, lng: 179.9 }, { lat: 0, lng: -179.9 }) < 23);
  assert.ok(Number.isFinite(geo.distanceKm({ lat: 0, lng: 0 }, { lat: 0, lng: 180 })));
  assert.equal(geo.distanceKm({ lat: NaN, lng: 0 }, HERE), Infinity);
});

test("Jeju bounds exactly match validate.py, including all edges", () => {
  const { geo, scope } = harness();
  assert.deepEqual(plain(scope.JEJU_BOUNDS), { south: 33, north: 34, west: 126, east: 127 });
  for (const point of [HERE, { lat: 33, lng: 126 }, { lat: 34, lng: 127 }]) {
    assert.equal(geo.isInsideJeju(point), true);
  }
  for (const point of [{ lat: 32.99, lng: 126.5 }, { lat: 34.01, lng: 126.5 },
    { lat: 33.5, lng: 125.99 }, { lat: 33.5, lng: 127.01 }, null]) {
    assert.equal(geo.isInsideJeju(point), false);
  }
});

test("formatDistance uses metres, tenths of km, then whole km", () => {
  const { geo } = harness();
  assert.equal(geo.formatDistance(0.85, "en"), "850 m");
  assert.equal(geo.formatDistance(2.44, "en"), "2.4 km");
  assert.equal(geo.formatDistance(14.2, "en"), "14 km");
  assert.equal(geo.formatDistance(0, "en"), "0 m");
  for (const km of [-1, Infinity, NaN]) assert.equal(geo.formatDistance(km, "en"), "");
});

test("near parser accepts synthetic coordinates/errors and rejects malformed input", () => {
  const { geo } = harness();
  assert.deepEqual(plain(geo.parseNearOverride("?near=33.4996,126.5312")), HERE);
  assert.equal(geo.parseNearOverride("?near=denied"), "denied");
  assert.equal(geo.parseNearOverride("?near=unavailable"), "unavailable");
  for (const search of ["", "?near=", "?near=,126", "?near=33,", "?near=33,126,9",
    "?near=91,126", "?near=33,181", "?near=NaN,126", "?near=Infinity,126", "?near=garbage"]) {
    assert.equal(geo.parseNearOverride(search), null);
  }
});

test("fresh visitors never query permission or start a watcher on load", () => {
  const h = harness({ permission: "granted" });
  h.scope.initializeAroundMe();
  assert.equal(h.active.size, 0);
  assert.equal(h.permissionQueries(), 0);
  assert.equal(h.scope.locationButton.attrs["aria-pressed"], "false");
});

test("remembered mode only auto-starts with already-granted permission", async () => {
  for (const permission of ["granted", "prompt", "denied"]) {
    const h = harness({ remembered: true, permission });
    h.scope.initializeAroundMe();
    await Promise.resolve();
    assert.equal(h.active.size, permission === "granted" ? 1 : 0);
  }
  for (const extra of [{ noPermissions: true }, { permissionThrows: true }, { permissionRejects: true }]) {
    const h = harness({ remembered: true, ...extra });
    h.scope.initializeAroundMe();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(h.active.size, 0);
  }
});

test("late permission result cannot restart a mode the visitor turned off", async () => {
  const h = harness({ remembered: true, permission: "granted" });
  h.scope.initializeAroundMe();
  h.scope.stopAroundMe();
  await Promise.resolve();
  assert.equal(h.active.size, 0);
});

test("a remembered mode still starts when a tab opened hidden becomes visible", async () => {
  const h = harness({ remembered: true, permission: "granted" });
  h.scope.document.hidden = true;
  h.scope.initializeAroundMe();
  h.documentEvents.visibilitychange[0]();
  await Promise.resolve();
  assert.equal(h.active.size, 0);
  h.scope.document.hidden = false;
  h.documentEvents.visibilitychange[0]();
  await Promise.resolve();
  assert.equal(h.active.size, 1);
});

test("an unsupported saved radius is ignored without blocking startup or rewriting storage", () => {
  const h = harness({ radius: 99 });
  h.scope.initializeAroundMe();
  assert.equal(h.scope.state.aroundMe.radiusKm, null);
  assert.equal(h.scope.UserPrefs.getAroundMe().radiusKm, 99);
  assert.equal(h.active.size, 0);
});

test("first fix sorts by distance and fits only user plus five nearest matches", () => {
  const h = harness();
  h.scope.startAroundMe();
  assert.deepEqual(plain(h.watchers.get(0).settings),
    { enableHighAccuracy: true, maximumAge: 60000, timeout: 15000 });
  h.fix();
  assert.deepEqual(plain(h.scope.state.sort), { key: "distance", dir: "asc" });
  assert.equal(h.scope.state.distances["cafe-0"], 0);
  assert.equal(h.fits.length, 1);
  assert.equal(h.fits[0].points.length, 6);
  assert.deepEqual(h.fits[0].points[0], [HERE.lng, HERE.lat]);
  assert.deepEqual(h.fits[0].points.at(-1), [HERE.lng, HERE.lat + 0.04]);
  assert.equal(h.scope.userMarker.element.attrs["aria-label"], "Your location (±12 m)");
});

test("first fix before map load defers fit without dropping location", () => {
  const h = harness({ mapReady: false });
  h.scope.startAroundMe();
  h.fix();
  assert.equal(h.scope.pendingLocationFit, true);
  assert.equal(h.fits.length, 0);
  h.scope.mapReady = true;
  h.scope.fitUserNearby();
  assert.equal(h.fits.length, 1);
  assert.equal(h.scope.pendingLocationFit, false);
});

test("small fixes move the pin; >50m rebuilds distances but never recenters", () => {
  const h = harness();
  h.scope.startAroundMe();
  h.fix();
  const cache = h.scope.state.distances;
  const updates = h.updates.length;
  h.fix({ lat: HERE.lat + 0.0001, lng: HERE.lng });
  assert.equal(h.scope.state.distances, cache);
  assert.equal(h.updates.length, updates);
  assert.deepEqual(plain(h.scope.userMarker.point), [HERE.lng, HERE.lat + 0.0001]);
  h.fix({ lat: HERE.lat + 0.001, lng: HERE.lng });
  assert.notEqual(h.scope.state.distances, cache);
  assert.deepEqual(plain(h.updates.at(-1)), { fit: false });
  assert.equal(h.fits.length, 1);
});

test("radius combines with scope, persists only settings, Reset keeps it and Clear removes it", () => {
  const h = harness();
  h.scope.startAroundMe();
  h.fix();
  h.scope.state.aroundMe.radiusKm = 1;
  h.scope.saveAroundMe();
  assert.equal(h.scope.matchesScope(h.scope.CAFES[0]), true);
  assert.equal(h.scope.matchesScope(h.scope.CAFES[1]), false);
  h.scope.applyDefaultFilters();
  assert.equal(h.scope.state.aroundMe.radiusKm, 1);
  h.scope.clearFilters();
  assert.equal(h.scope.state.aroundMe.radiusKm, null);
  const stored = JSON.parse(h.stored.get("jcf:prefs"));
  assert.deepEqual(Object.keys(stored.aroundMe).sort(), ["enabled", "radiusKm", "updatedAt"]);
  assert.equal(JSON.stringify(stored).includes(String(HERE.lat)), false);
  assert.equal(JSON.stringify(stored).includes(String(HERE.lng)), false);
  assert.equal(h.scope.location.search, "");
});

test("outside Jeju retains distances but disables radius and does not fit the map", () => {
  const h = harness({ radius: 1 });
  h.scope.startAroundMe();
  h.fix({ lat: 37.5, lng: 127 });
  assert.equal(h.fits.length, 0);
  assert.ok(h.scope.state.distances["cafe-0"] > 100);
  assert.equal(h.scope.matchesScope(h.scope.CAFES[0]), true);
  assert.match(h.node("distanceFilterList").innerHTML, / disabled/);
  assert.match(h.node("aroundMeStatus").textContent, /outside Jeju/);
});

test("stopping removes pin/distances, clears watch id zero and rejects late callbacks", () => {
  const h = harness();
  h.scope.startAroundMe();
  h.fix();
  const pin = h.scope.userMarker;
  h.scope.stopAroundMe();
  assert.deepEqual(h.cleared, [0]);
  assert.equal(pin.removed, true);
  assert.equal(h.scope.state.userLocation, null);
  assert.deepEqual(plain(h.scope.state.distances), {});
  assert.deepEqual(plain(h.scope.state.sort), { key: "name", dir: "asc" });
  h.fix();
  assert.equal(h.scope.state.userLocation, null);
});

for (const code of [1, 2, 3]) {
  test(`location error ${code} safely clears the watcher and reports the right state`, () => {
    const h = harness();
    h.scope.startAroundMe();
    h.watchers.get(0).error({ code });
    assert.equal(h.active.size, 0);
    assert.match(h.node("aroundMeStatus").textContent, code === 1 ? /Location access is off/ : /isn't available/);
  });
}

test("synchronous errors and browser exceptions leave no orphan watcher", () => {
  for (const options of [{ synchronousError: true }, { throwOnWatch: true }]) {
    const h = harness(options);
    h.scope.startAroundMe();
    assert.equal(h.active.size, 0);
    assert.equal(h.scope.aroundMeActive, false);
  }
});

test("hidden/pagehide pauses the watcher, visible/pageshow resumes without refit", () => {
  const h = harness();
  h.scope.startAroundMe();
  h.fix();
  h.scope.document.hidden = true;
  h.documentEvents.visibilitychange[0]();
  assert.equal(h.active.size, 0);
  h.fix({ lat: 34, lng: 127 }, 0);
  assert.deepEqual(plain(h.scope.state.userLocation), HERE);
  h.scope.document.hidden = false;
  h.documentEvents.visibilitychange[0]();
  assert.equal(h.active.size, 1);
  h.fix({ lat: HERE.lat + 0.001, lng: HERE.lng }, 1);
  assert.equal(h.fits.length, 1);
  h.windowEvents.pagehide.forEach((listener) => listener());
  assert.equal(h.active.size, 0);
  h.windowEvents.pageshow.forEach((listener) => listener());
  assert.equal(h.active.size, 1);
});

test("unsupported geolocation hides control; near overrides never use the API", () => {
  const unsupported = harness({ unsupported: true });
  unsupported.scope.initializeAroundMe();
  assert.equal(unsupported.scope.locationButton, null);
  assert.match(unsupported.node("aroundMeStatus").textContent, /isn't available/);
  for (const search of ["?near=33.4996,126.5312", "?near=denied", "?near=unavailable"]) {
    const h = harness({ unsupported: true, search });
    h.scope.initializeAroundMe();
    h.scope.startAroundMe();
    assert.equal(h.watchers.size, 0);
    if (search.includes("33.4996")) assert.deepEqual(plain(h.scope.state.userLocation), HERE);
    else assert.equal(h.scope.state.userLocation, null);
  }
});

test("distance column is conditional and all local revisions include geo.js", () => {
  const h = harness();
  vm.runInContext(app.slice(app.indexOf("  function tableColumns("), app.indexOf("  function renderTableHeader(")), h.scope);
  assert.equal(h.scope.tableColumns().some((column) => column.key === "distance"), false);
  h.scope.state.userLocation = HERE;
  assert.equal(h.scope.tableColumns().some((column) => column.key === "distance"), true);
  const html = fs.readFileSync(path.join(docs, "index.html"), "utf8");
  assert.match(html, /geo\.js\?v=20261021-around-me/);
  assert.deepEqual([...new Set([...html.matchAll(/\?v=([^"]+)/g)].map((match) => match[1]))], ["20261021-around-me"]);
  assert.match(html, /id="aroundMeStatus"[^>]*role="status"/);
  const css = fs.readFileSync(path.join(docs, "style.css"), "utf8");
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /width: 44px; height: 44px/);
});
