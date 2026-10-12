const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const docs = path.join(__dirname, "..", "docs");
const html = fs.readFileSync(path.join(docs, "index.html"), "utf8");
const bootstrap = fs.readFileSync(path.join(docs, "bootstrap.js"), "utf8");

test("HTML versions all local app assets with the same nonempty revision", () => {
  const files = ["style.css", "i18n.js", "data-config.js", "filters-config.js", "map-pins.js", "db-loader.js", "bootstrap.js"];
  const revisions = files.map((file) => {
    const escaped = file.replace(/\./g, "\\.");
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
