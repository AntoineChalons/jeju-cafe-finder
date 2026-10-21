/* Pure location helpers. Coordinates are used only in memory. */
(function () {
  "use strict";

  function validPoint(point) {
    return !!point && typeof point.lat === "number" && typeof point.lng === "number" &&
      Number.isFinite(point.lat) && Number.isFinite(point.lng) &&
      Math.abs(point.lat) <= 90 && Math.abs(point.lng) <= 180;
  }

  function distanceKm(a, b) {
    if (!validPoint(a) || !validPoint(b)) return Infinity;
    var radians = Math.PI / 180;
    var dLat = (b.lat - a.lat) * radians;
    var dLng = (b.lng - a.lng) * radians;
    var h = Math.sin(dLat / 2) ** 2 +
      Math.cos(a.lat * radians) * Math.cos(b.lat * radians) * Math.sin(dLng / 2) ** 2;
    return 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
  }

  function isInsideJeju(point) {
    return validPoint(point) && point.lat >= JEJU_BOUNDS.south && point.lat <= JEJU_BOUNDS.north &&
      point.lng >= JEJU_BOUNDS.west && point.lng <= JEJU_BOUNDS.east;
  }

  function formatDistance(km, locale) {
    if (!Number.isFinite(km) || km < 0) return "";
    var metres = km < 1;
    var formatter = new Intl.NumberFormat(locale || "en", { maximumFractionDigits: metres || km >= 10 ? 0 : 1 });
    return formatter.format(metres ? km * 1000 : km) + (metres ? " m" : " km");
  }

  function parseNearOverride(search) {
    var value = new URLSearchParams(search).get("near");
    if (value === "denied" || value === "unavailable") return value;
    if (value === null) return null;
    var parts = value.split(",");
    if (parts.length !== 2 || parts.some(function (part) { return part.trim() === ""; })) return null;
    var point = { lat: Number(parts[0]), lng: Number(parts[1]) };
    return validPoint(point) ? point : null;
  }

  window.CafeGeo = {
    distanceKm: distanceKm,
    isInsideJeju: isInsideJeju,
    formatDistance: formatDistance,
    parseNearOverride: parseNearOverride,
  };
})();
