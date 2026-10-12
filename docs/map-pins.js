(function () {
  "use strict";

  // Fixed semantic symbols; colours and map dimensions are editable in JSON.
  var ICONS = {
    bakery: "croissant.svg",
    roastery: "coffee-bean.svg",
    cafe: "coffee-cup.svg",
    pub: "beer-mug.svg",
  };
  var pinConfig;
  window.MAP_PIN_KINDS = ["bakery", "roastery", "cafe", "pub"];

  window.configureMapPins = function (config) {
    if (!config || typeof config !== "object" || Array.isArray(config)) {
      throw new Error("map-pins-config.json must contain a venue-type object.");
    }
    Object.keys(config).forEach(function (kind) {
      if (!Object.prototype.hasOwnProperty.call(ICONS, kind)) {
        throw new Error("Unknown map pin kind: " + kind);
      }
    });
    var validated = {};
    window.MAP_PIN_KINDS.forEach(function (kind) {
      var entry = config[kind];
      if (!entry || typeof entry.color !== "string" || !/^#[0-9a-f]{6}$/i.test(entry.color)) {
        throw new Error("Map pin " + kind + " requires a six-digit hex color, e.g. #B96745.");
      }
      ["width", "height"].forEach(function (dimension) {
        if (!Number.isSafeInteger(entry[dimension]) || entry[dimension] <= 0) {
          throw new Error("Map pin " + kind + " requires a positive integer " + dimension + " in pixels.");
        }
      });
      validated[kind] = { color: entry.color, width: entry.width, height: entry.height };
    });
    pinConfig = validated;
    return validated;
  };

  window.loadMapPins = function () {
    return fetch("map-pins-config.json", { cache: "no-cache" })
      .then(function (response) {
        if (!response.ok) throw new Error("Cannot load map-pins-config.json: HTTP " + response.status);
        return response.json();
      })
      .then(window.configureMapPins);
  };

  function pinSettings(kind) {
    if (!pinConfig) throw new Error("Map pin configuration has not loaded.");
    if (!Object.prototype.hasOwnProperty.call(ICONS, kind)) {
      throw new Error("Unknown map pin kind: " + kind);
    }
    return pinConfig[kind];
  }

  window.mapPinPopupOffset = function (kind) {
    var settings = pinSettings(kind);
    return Math.ceil(Math.max(settings.width, settings.height) / 2) + 2;
  };

  window.createMapPinSymbol = function (kind) {
    var settings = pinSettings(kind);
    var symbol = document.createElement("span");
    symbol.className = "map-pin-symbol";
    symbol.setAttribute("aria-hidden", "true");
    symbol.setAttribute("data-pin-kind", kind);
    symbol.style.setProperty("--pin-color", settings.color);
    symbol.style.setProperty("--pin-width", settings.width + "px");
    symbol.style.setProperty("--pin-height", settings.height + "px");
    symbol.style.setProperty("--pin-icon", 'url("icons/map-pins/' + ICONS[kind] + '")');
    // Mask the child, not the wrapper: otherwise the mask clips the halo.
    var glyph = document.createElement("span");
    glyph.className = "map-pin-glyph";
    symbol.appendChild(glyph);
    return symbol;
  };
})();
