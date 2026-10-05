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

  // Optional contact columns. Older databases may not have them yet, so they
  // are selected as NULL when missing.
  var CONTACT_FIELDS = {
    instagram_url: "instagramUrl",
    facebook_url: "facebookUrl",
    kakao: "kakao",
    phone: "phone",
    email: "email",
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
    Object.keys(CONTACT_FIELDS).forEach(function (column) {
      cafe[CONTACT_FIELDS[column]] = row[column] ? String(row[column]).trim() : "";
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
      var available = {};
      rows(database, "PRAGMA table_info(cafes)").forEach(function (column) {
        available[column.name] = true;
      });
      var contactColumns = Object.keys(CONTACT_FIELDS).map(function (column) {
        return available[column] ? column : "NULL AS " + column;
      });
      // Cafes with publish = 0 are drafts and are never shown. The public
      // database already leaves them out; this also covers full local builds
      // and databases from before the column existed.
      var publishFilter = available.publish ? " WHERE publish = 1" : "";
      var cafes = rows(
        database,
        "SELECT id, name, name_kr, region, lat, lng, size, price, " +
          Object.keys(BOOLEAN_FIELDS).join(", ") +
          ", blurb, hours_note, hours_checked, naver_url, source_url, " +
          contactColumns.join(", ") +
          " FROM cafes" + publishFilter + " ORDER BY rowid"
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
          if (!byId[row.cafe_id]) return;
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
