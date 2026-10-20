const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const docs = path.join(__dirname, "..", "docs");
const html = fs.readFileSync(path.join(docs, "index.html"), "utf8");
const bootstrap = fs.readFileSync(path.join(docs, "bootstrap.js"), "utf8");

test("HTML versions all local app assets with the same nonempty revision", () => {
  const files = Array.from(html.matchAll(/(?:src|href)="([^"]+\.(?:js|css)(?:\?[^"]*)?)"/g),
    (match) => match[1]).filter((url) => !/^(?:https?:)?\/\//.test(url))
    .map((url) => url.split("?")[0]);
  assert.ok(files.includes("map-type-bar.css"));
  assert.ok(files.includes("vendor/sql.js/sql-wasm.js"));
  const revisions = files.map((file) => {
    const escaped = file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = html.match(new RegExp('(?:src|href)="' + escaped + '\\?v=([^"]+)"'));
    assert.ok(match, file + " must have a cache-busting version");
    return match[1];
  });
  assert.equal(new Set(revisions).size, 1);
  assert.ok(revisions[0].length > 0);
});

async function loadedAppSource(scriptSource) {
  const appended = [];
  const document = {
    baseURI: "https://example.test/jeju-cafe-finder/",
    currentScript: { src: scriptSource },
    getElementById: () => ({ textContent: "" }),
    createElement: () => ({}),
    body: { appendChild: (element) => appended.push(element) },
  };
  const sandbox = {
    URL, document, console,
    window: {
      loadCafeFilters: async () => [],
      loadMapPins: async () => ({}),
      loadCafeDatabase: async () => {
        // The bootstrap executes synchronously, but the script is no longer
        // current when the database promise settles in a real browser.
        document.currentScript = null;
        return { cafes: [], databaseUrl: "cafes.db" };
      },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(bootstrap, sandbox);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(appended.length, 1);
  assert.equal("CAFE_TRANSLATIONS" in sandbox.window, false);
  return appended[0].src;
}

test("bootstrap passes its asset revision to app.js after asynchronous data loading", async () => {
  const source = html.match(/src="(bootstrap\.js[^"]*)"/)[1];
  const revision = new URL(source, "https://example.test/").searchParams.get("v");
  assert.equal(
    await loadedAppSource("https://example.test/jeju-cafe-finder/" + source),
    "app.js?v=" + encodeURIComponent(revision)
  );
});

test("bootstrap preserves unversioned local usage and safely encodes revision values", async () => {
  assert.equal(await loadedAppSource("https://example.test/bootstrap.js"), "app.js");
  assert.equal(await loadedAppSource("https://example.test/bootstrap.js?v=release%20candidate"), "app.js?v=release%20candidate");
});

test("load errors are English even for a Korean browser and a legacy lang parameter", async () => {
  for (const search of ["", "?lang=ko"]) {
    const alerts = [];
    const logged = [];
    const error = new Error("Database unavailable");
    const sandbox = {
      URL, URLSearchParams,
      navigator: { language: "ko-KR" },
      console: { error: (value) => logged.push(value) },
      document: {
        currentScript: null,
        createElement: () => ({ setAttribute(key, value) { this[key] = value; } }),
        body: {
          prepend: (element) => alerts.push(element),
          appendChild: () => assert.fail("App must not load after a database error"),
        },
      },
      window: {
        location: { search },
        loadCafeDatabase: async () => { throw error; },
        loadCafeFilters: async () => [],
        loadMapPins: async () => ({}),
      },
    };
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(docs, "i18n.js"), "utf8"), sandbox);
    vm.runInContext(bootstrap, sandbox);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].role, "alert");
    assert.equal(alerts[0].textContent,
      "Cafe data or display configuration is not available. Refresh the page or try again later.");
    assert.deepEqual(logged, [error]);
  }
});
