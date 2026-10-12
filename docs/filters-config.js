(function () {
  "use strict";

  // Reject invalid edits rather than silently showing unexpected filters.
  window.configureCafeFilters = function (config) {
    if (!Array.isArray(config)) throw new Error("filters-config.json must contain an array.");
    var seen = {};
    var configured = config.map(function (entry) {
      if (!entry || typeof entry.name !== "string") {
        throw new Error("Each filter must have a name.");
      }
      var definition = CRITERION_DEFINITIONS.find(function (item) {
        return item.key === entry.name;
      });
      if (!definition) throw new Error("Unknown filter name: " + entry.name);
      if (seen[entry.name]) throw new Error("Duplicate filter name: " + entry.name);
      seen[entry.name] = true;
      if (typeof entry.enabled !== "boolean" ||
          typeof entry.displayedText !== "string" || !entry.displayedText.trim() ||
          !Number.isInteger(entry.index) || entry.index < 0) {
        throw new Error("Invalid configuration for filter: " + entry.name);
      }
      return Object.assign({}, definition, entry);
    });
    CRITERIA = configured.filter(function (entry) { return entry.enabled; })
      .sort(function (a, b) { return a.index - b.index; });
    return CRITERIA;
  };

  window.loadCafeFilters = function () {
    return fetch("filters-config.json", { cache: "no-cache" })
      .then(function (response) {
        if (!response.ok) throw new Error("Cannot load filters-config.json: HTTP " + response.status);
        return response.json();
      })
      .then(window.configureCafeFilters);
  };
})();
