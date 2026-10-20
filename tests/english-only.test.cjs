const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const docs = path.join(__dirname, "..", "docs");
const app = fs.readFileSync(path.join(docs, "app.js"), "utf8");
const html = fs.readFileSync(path.join(docs, "index.html"), "utf8");

function messages(search) {
  const sandbox = {
    URLSearchParams,
    document: { documentElement: {} },
    window: {
      location: { search },
      navigator: { language: "ko-KR", languages: ["ko-KR"] },
      history: { replaceState: () => assert.fail("The URL must not be rewritten") },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(docs, "i18n.js"), "utf8"), sandbox);
  vm.runInContext(app.slice(app.indexOf("  var root ="), app.indexOf("  function brandSubtitleKey(")), sandbox);
  return sandbox;
}

test("only English UI strings remain, regardless of URL or browser language", () => {
  for (const search of ["", "?lang=ko", "?lang=unknown"]) {
    const sandbox = messages(search);
    assert.deepEqual(Object.keys(sandbox.APP_TRANSLATIONS), ["en"]);
    assert.equal("language" in sandbox.APP_TRANSLATIONS.en, false);
    assert.equal(sandbox.message("filters.reset"), "Reset");
    assert.equal(sandbox.message("brand.subtitle", { count: 3 }), "3 cafes, one good cup");
    assert.equal(sandbox.message("brand.subtitle"), "{count} cafes, one good cup");
    assert.equal(sandbox.message("missing.key"), "missing.key");
    assert.equal(sandbox.message("filters"), "filters");
    assert.equal(sandbox.window.location.search, search);
  }
});

test("cafe text uses English fields while retaining the Korean secondary name", () => {
  const sandbox = messages("?lang=ko");
  const cafe = { name: "Example", nameKr: "예시", blurb: "English description", hoursNote: "English note" };
  assert.deepEqual(JSON.parse(JSON.stringify(sandbox.cafeText(cafe))),
    { name: "Example", blurb: "English description", hoursNote: "English note" });
  assert.equal(sandbox.secondaryName(cafe), "예시");
  assert.equal(sandbox.secondaryName({ ...cafe, name: "예시" }), "");
  assert.match(app, /class="popup-kr">.*secondaryName\(cafe\)/);
  assert.match(app, /<small>.*escapeHtml\(secondaryName\(cafe\)\)/);
});

test("language picker and locale selection are removed without removing the Korean font", () => {
  assert.match(html, /<html lang="en"/);
  assert.match(html, /Noto\+Sans\+KR/);
  assert.doesNotMatch(html, /language-picker|languageToggle|languageMenu|data-language/);
  assert.doesNotMatch(fs.readFileSync(path.join(docs, "style.css"), "utf8"), /\.language-|html\[lang="ko"\]/);
  for (const file of ["app.js", "bootstrap.js", "db-loader.js"]) {
    const source = fs.readFileSync(path.join(docs, file), "utf8");
    assert.doesNotMatch(source, /CAFE_TRANSLATIONS|currentLocale|SUPPORTED_LOCALES|browserLocale|initialLocale|renderLanguagePicker|updateLanguageUrl/);
    assert.doesNotMatch(source, /(?:get|set)\("lang"/);
  }
  assert.doesNotMatch(fs.readFileSync(path.join(docs, "db-loader.js"), "utf8"), /cafe_translations/);
});
