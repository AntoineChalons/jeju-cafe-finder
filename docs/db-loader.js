(function () {
  "use strict";

  var DEFAULT_DATABASE_URL =
    "https://antoinechalons.github.io/public-data/cafes.db";
  var SQL_WASM_URL = "vendor/sql.js/sql-wasm.wasm";

  // Database column -> app field.
  var BOOLEAN_FIELDS = {
    work_friendly: "workFriendly",
    local_roast: "localRoast",
    sells_beans: "sellsBeans",
    outdoor: "outdoor",
    dessert: "dessert",
    brunch: "brunch",
    view: "view",
    arc_discount: "arcDiscount",
    loyalty: "loyalty",
    books: "books",
    board_games: "boardGames",
    pets: "pets",
    kids: "kids",
  };

  function databaseUrl() {
    var override = new URLSearchParams(window.location.search).get("database");
    return override || window.JEJU_CAFE_DATABASE_URL || DEFAULT_DATABASE_URL;
  }

  function rows(database, sql) {
    var result = database.exec(sql);
    if (!result.length) return [];
    return result[0].values.map(function (values) {
      var row = {};
      result[0].columns.forEach(function (column, index) {
        row[column] = values[index];
      });
      return row;
    });
  }

  function toMinutes(value) {
    var parts = String(value).split(":");
    return Number(parts[0]) * 60 + Number(parts[1]);
  }

  function toCafe(row) {
    var cafe = {
      id: row.id,
      name: row.name,
      nameKr: row.name_kr,
      region: row.region,
      lat: row.lat,
      lng: row.lng,
      size: row.size || null,
      price: row.price || null,
      blurb: row.blurb,
      hoursNote: row.hours_note || "",
      hoursChecked: row.hours_checked || "",
      naverUrl: row.naver_url,
      sourceUrl: row.source_url,
      // hours.mon = [{ open: 540, close: 1080 }, ...]; close <= open wraps
      // past midnight. hasHours is false when no periods exist at all.
      hours: {},
      hasHours: false,
    };
    Object.keys(BOOLEAN_FIELDS).forEach(function (column) {
      cafe[BOOLEAN_FIELDS[column]] = row[column] === 1;
    });
    return cafe;
  }

  async function loadCafeDatabase(url) {
    if (typeof window.initSqlJs !== "function") {
      throw new Error("The sql.js runtime did not load.");
    }

    var SQL = await window.initSqlJs({
      locateFile: function () { return SQL_WASM_URL; },
    });
    var response = await fetch(url || databaseUrl(), { cache: "no-store" });
    if (!response.ok) {
      throw new Error("Cannot load the cafe database: HTTP " + response.status);
    }

    var bytes = new Uint8Array(await response.arrayBuffer());
    var database = new SQL.Database(bytes);
    try {
      var cafes = rows(
        database,
        "SELECT id, name, name_kr, region, lat, lng, size, price, " +
          Object.keys(BOOLEAN_FIELDS).join(", ") +
          ", blurb, hours_note, hours_checked, naver_url, source_url " +
          "FROM cafes ORDER BY rowid"
      ).map(toCafe);

      var byId = {};
      cafes.forEach(function (cafe) {
        byId[cafe.id] = cafe;
      });

      rows(database, "SELECT cafe_id, day, open, close FROM cafe_hours ORDER BY cafe_id, day, open")
        .forEach(function (row) {
          var cafe = byId[row.cafe_id];
          if (!cafe) return;
          var close = toMinutes(row.close);
          if (!cafe.hours[row.day]) cafe.hours[row.day] = [];
          cafe.hours[row.day].push({ open: toMinutes(row.open), close: close });
          cafe.hasHours = true;
        });

      var translations = {};
      rows(database, "SELECT cafe_id, locale, name, blurb, hours_note FROM cafe_translations")
        .forEach(function (row) {
          if (!translations[row.cafe_id]) translations[row.cafe_id] = {};
          translations[row.cafe_id][row.locale] = {
            name: row.name,
            blurb: row.blurb,
            hoursNote: row.hours_note || "",
          };
        });
      return { cafes: cafes, translations: translations };
    } finally {
      database.close();
    }
  }

  window.loadCafeDatabase = loadCafeDatabase;
  window.getCafeDatabaseUrl = databaseUrl;
})();
