(function () {
  "use strict";

  // Browser-only personal settings: one versioned JSON document in localStorage.
  // Nothing here touches the network, and the visitor's location is never stored.
  var STORAGE_KEY = "jcf:prefs";
  var CORRUPT_PREFIX = "jcf:prefs:corrupt-";
  var APP_NAME = "jeju-cafe-finder";
  var SCHEMA_VERSION = 1;
  var SAVE_DELAY_MS = 250;
  var MAX_TAG_LENGTH = typeof TAG_MAX_LENGTH === "number" ? TAG_MAX_LENGTH : 30;
  var MAX_TAGS_PER_CAFE = typeof TAG_MAX_PER_CAFE === "number" ? TAG_MAX_PER_CAFE : 20;
  var MAX_RADIUS_KM = 100;
  var ID_PATTERN = /^[a-z][a-z0-9-]*$/;
  var NAME_PATTERN = /^[A-Za-z][A-Za-z0-9]*$/;
  var ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
  var RESERVED_IDS = ["constructor", "prototype"];
  var SECTIONS = ["filters", "ratings", "tags", "ratingFilter", "aroundMe"];
  var MIN_STARS_VALUES = [3, 4, 5];

  var nowFn = function () { return new Date().toISOString(); };

  var state = {
    doc: null,
    status: "empty",
    persistent: false,
    readOnly: false,
    saveFailed: false,
    persistAsked: false,
    attached: false,
    timer: null,
    listeners: [],
  };

  function warn(message, detail) {
    console.warn("[UserPrefs] " + message + (detail === undefined ? "" : " " + String(detail)));
  }

  function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function isIso(value) {
    return typeof value === "string" && ISO_PATTERN.test(value) && !isNaN(Date.parse(value));
  }

  function timeOf(value) {
    return isIso(value) ? Date.parse(value) : -Infinity;
  }

  // Ids can come from untrusted imported files: reject names that clash with Object.prototype.
  function isValidId(id) {
    return typeof id === "string" && ID_PATTERN.test(id) && RESERVED_IDS.indexOf(id) === -1;
  }

  function isValidStars(value) {
    return Number.isInteger(value) && value >= 1 && value <= 5;
  }

  function isValidRadius(value) {
    return typeof value === "number" && isFinite(value) && value > 0 && value <= MAX_RADIUS_KM;
  }

  function cleanText(text) {
    return String(text).normalize("NFC").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  }

  // Returns the stored form of a tag, or null when nothing is left after cleaning.
  // With suggestedLabels ({ key: "English label" }) a suggested tag is stored as its key.
  function normalizeTag(text, suggestedLabels) {
    if (typeof text !== "string") return null;
    var clean = cleanText(text);
    if (!clean || Array.from(clean).length > MAX_TAG_LENGTH) return null;
    if (isObject(suggestedLabels)) {
      var lower = clean.toLocaleLowerCase();
      var keys = Object.keys(suggestedLabels);
      for (var i = 0; i < keys.length; i += 1) {
        var label = suggestedLabels[keys[i]];
        if (keys[i].toLocaleLowerCase() === lower ||
            (typeof label === "string" && label.toLocaleLowerCase() === lower)) {
          return keys[i];
        }
      }
    }
    return clean;
  }

  function normalizeTagList(tags, suggestedLabels) {
    var seen = Object.create(null);
    var out = [];
    tags.forEach(function (tag) {
      var normalized = normalizeTag(tag, suggestedLabels);
      if (normalized === null) return;
      var folded = normalized.toLocaleLowerCase();
      if (seen[folded] || out.length >= MAX_TAGS_PER_CAFE) return;
      seen[folded] = true;
      out.push(normalized);
    });
    return out;
  }

  function cleanNameList(value) {
    if (!Array.isArray(value)) return null;
    var out = [];
    value.forEach(function (item) {
      if (typeof item === "string" && NAME_PATTERN.test(item) && out.indexOf(item) === -1) out.push(item);
    });
    return out;
  }

  function defaultFilters() {
    return { order: [], hidden: [], shown: [], defaultOn: [], updatedAt: null };
  }

  function defaultRatingFilter() {
    return { minStars: null, includeUnrated: true, updatedAt: null };
  }

  function defaultAroundMe() {
    return { enabled: false, radiusKm: null, updatedAt: null };
  }

  function cleanFilters(value, dropped) {
    if (!isObject(value)) return defaultFilters();
    var order = cleanNameList(value.order);
    var hidden = cleanNameList(value.hidden);
    var shown = cleanNameList(value.shown);
    var defaultOn = cleanNameList(value.defaultOn);
    var updatedAt = value.updatedAt === null || value.updatedAt === undefined ? null : value.updatedAt;
    if (!order || !hidden || !shown || !defaultOn || (updatedAt !== null && !isIso(updatedAt))) {
      dropped.push("filters");
      return defaultFilters();
    }
    return { order: order, hidden: hidden, shown: shown, defaultOn: defaultOn, updatedAt: updatedAt };
  }

  function cleanRatingFilter(value, dropped) {
    if (!isObject(value)) return defaultRatingFilter();
    var updatedAt = value.updatedAt === null || value.updatedAt === undefined ? null : value.updatedAt;
    var minOk = value.minStars === null || MIN_STARS_VALUES.indexOf(value.minStars) !== -1;
    if (!minOk || typeof value.includeUnrated !== "boolean" || (updatedAt !== null && !isIso(updatedAt))) {
      dropped.push("ratingFilter");
      return defaultRatingFilter();
    }
    return { minStars: value.minStars, includeUnrated: value.includeUnrated, updatedAt: updatedAt };
  }

  // Only whitelisted fields are copied, so a stray lat/lng in a file can never be kept.
  function cleanAroundMe(value, dropped) {
    if (!isObject(value)) return defaultAroundMe();
    var updatedAt = value.updatedAt === null || value.updatedAt === undefined ? null : value.updatedAt;
    var radiusOk = value.radiusKm === null || isValidRadius(value.radiusKm);
    if (typeof value.enabled !== "boolean" || !radiusOk || (updatedAt !== null && !isIso(updatedAt))) {
      dropped.push("aroundMe");
      return defaultAroundMe();
    }
    return { enabled: value.enabled, radiusKm: value.radiusKm, updatedAt: updatedAt };
  }

  function cleanRatings(value, dropped) {
    var out = Object.create(null);
    if (!isObject(value)) return out;
    Object.keys(value).forEach(function (id) {
      var record = value[id];
      if (!isValidId(id) || !isObject(record) || !isIso(record.updatedAt) ||
          !(record.stars === null || isValidStars(record.stars))) {
        dropped.push("ratings." + id);
        return;
      }
      out[id] = { stars: record.stars, updatedAt: record.updatedAt };
    });
    return out;
  }

  function cleanTags(value, dropped) {
    var out = Object.create(null);
    if (!isObject(value)) return out;
    Object.keys(value).forEach(function (id) {
      var record = value[id];
      var valid = isValidId(id) && isObject(record) && isIso(record.updatedAt) &&
        Array.isArray(record.tags) && record.tags.every(function (tag) { return typeof tag === "string"; });
      if (!valid) {
        dropped.push("tags." + id);
        return;
      }
      out[id] = { tags: normalizeTagList(record.tags), updatedAt: record.updatedAt };
    });
    return out;
  }

  function cleanDoc(doc, dropped) {
    return {
      app: APP_NAME,
      schema: SCHEMA_VERSION,
      updatedAt: isIso(doc.updatedAt) ? doc.updatedAt : nowFn(),
      lastExportAt: isIso(doc.lastExportAt) ? doc.lastExportAt : null,
      filters: cleanFilters(doc.filters, dropped),
      ratings: cleanRatings(doc.ratings, dropped),
      tags: cleanTags(doc.tags, dropped),
      ratingFilter: cleanRatingFilter(doc.ratingFilter, dropped),
      aroundMe: cleanAroundMe(doc.aroundMe, dropped),
    };
  }

  function emptyDoc() {
    return cleanDoc({}, []);
  }

  // Fatal problems make the whole document invalid. Bad individual entries are dropped.
  function validate(doc) {
    var errors = [];
    var dropped = [];
    if (!isObject(doc)) {
      return { valid: false, errors: ["Document must be an object."], dropped: dropped, doc: null };
    }
    if (doc.app !== APP_NAME) errors.push("Wrong app.");
    if (!Number.isInteger(doc.schema)) errors.push("Missing or invalid schema.");
    else if (doc.schema !== SCHEMA_VERSION) errors.push("Unsupported schema " + doc.schema + ".");
    SECTIONS.forEach(function (name) {
      if (doc[name] !== undefined && !isObject(doc[name])) errors.push(name + " must be an object.");
    });
    if (errors.length) return { valid: false, errors: errors, dropped: dropped, doc: null };
    var clean = cleanDoc(doc, dropped);
    dropped.forEach(function (entry) { warn("Dropped invalid entry:", entry); });
    return { valid: true, errors: errors, dropped: dropped, doc: clean };
  }

  function migrate(doc) {
    if (!isObject(doc) || !Number.isInteger(doc.schema)) throw new Error("Cannot migrate: missing schema.");
    if (doc.schema !== SCHEMA_VERSION) throw new Error("Cannot migrate schema " + doc.schema + ".");
    return doc;
  }

  function newer(a, b) {
    return timeOf(b && b.updatedAt) > timeOf(a && a.updatedAt) ? b : a;
  }

  function mergeRecords(local, incoming) {
    var out = Object.create(null);
    Object.keys(local).forEach(function (id) { out[id] = local[id]; });
    Object.keys(incoming).forEach(function (id) {
      out[id] = local[id] === undefined ? incoming[id] : newer(local[id], incoming[id]);
    });
    return out;
  }

  // Newer updatedAt wins per record; ties keep local. Tombstones are ordinary records.
  function merge(local, incoming) {
    var a = validate(local);
    var b = validate(incoming);
    if (!a.valid) return b.valid ? b.doc : emptyDoc();
    if (!b.valid) return a.doc;
    var l = a.doc;
    var i = b.doc;
    return cleanDoc({
      updatedAt: newer(l, i).updatedAt,
      lastExportAt: l.lastExportAt,
      filters: newer(l.filters, i.filters),
      ratings: mergeRecords(l.ratings, i.ratings),
      tags: mergeRecords(l.tags, i.tags),
      ratingFilter: newer(l.ratingFilter, i.ratingFilter),
      aroundMe: newer(l.aroundMe, i.aroundMe),
    }, []);
  }

  function getStorage() {
    try {
      return window.localStorage || null;
    } catch (error) {
      return null;
    }
  }

  function interpret(raw) {
    var parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      return { status: "corrupt", doc: null };
    }
    if (isObject(parsed) && parsed.app === APP_NAME && Number.isInteger(parsed.schema) &&
        parsed.schema > SCHEMA_VERSION) {
      return { status: "newer", doc: null };
    }
    var result;
    try {
      result = validate(migrate(parsed));
    } catch (error) {
      return { status: "corrupt", doc: null };
    }
    return result.valid ? { status: "ok", doc: result.doc } : { status: "corrupt", doc: null };
  }

  // Copy first, then clear the original key. If the copy fails, stay read-only so nothing is lost.
  function setAside(storage, raw) {
    try {
      storage.setItem(CORRUPT_PREFIX + nowFn().replace(/[^0-9]/g, ""), raw);
      storage.removeItem(STORAGE_KEY);
    } catch (error) {
      state.readOnly = true;
      warn("Cannot set aside corrupt settings:", error);
    }
  }

  function notify(change) {
    state.listeners.slice().forEach(function (listener) {
      try {
        listener(change);
      } catch (error) {
        warn("Listener failed:", error);
      }
    });
  }

  function onStorage(event) {
    if (!event || event.key !== STORAGE_KEY || typeof event.newValue !== "string" || state.readOnly) return;
    if (event.storageArea && event.storageArea !== getStorage()) return;
    var result = interpret(event.newValue);
    if (result.status === "newer") {
      state.status = "newer";
      state.saveFailed = false;
      state.readOnly = true;
      if (state.timer !== null) {
        clearTimeout(state.timer);
        state.timer = null;
      }
      notify({ source: "storage" });
      return;
    }
    if (result.status !== "ok") return;
    state.doc = state.timer === null ? result.doc : merge(state.doc, result.doc);
    notify({ source: "storage" });
  }

  function attachListeners() {
    if (state.attached || typeof window.addEventListener !== "function") return;
    state.attached = true;
    window.addEventListener("storage", onStorage);
    window.addEventListener("pagehide", function () {
      if (state.timer !== null) flush();
    });
  }

  function load() {
    if (state.timer !== null) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    var storage = getStorage();
    var raw = null;
    var unreadable = !storage;
    state.readOnly = false;
    state.saveFailed = false;
    state.doc = emptyDoc();
    if (storage) {
      try {
        raw = storage.getItem(STORAGE_KEY);
      } catch (error) {
        unreadable = true;
      }
    }
    if (unreadable) {
      state.persistent = false;
      state.status = "unavailable";
      return { doc: state.doc, status: state.status };
    }
    state.persistent = true;
    state.status = "empty";
    if (raw !== null) {
      var result = interpret(raw);
      state.status = result.status;
      if (result.status === "ok") {
        state.doc = result.doc;
      } else if (result.status === "corrupt") {
        setAside(storage, raw);
      } else if (result.status === "newer") {
        state.readOnly = true;
      }
    }
    attachListeners();
    return { doc: state.doc, status: state.status };
  }

  function askForDurableStorage() {
    if (state.persistAsked) return;
    state.persistAsked = true;
    try {
      var manager = window.navigator && window.navigator.storage;
      if (manager && typeof manager.persist === "function") {
        var request = manager.persist();
        if (request && typeof request.catch === "function") request.catch(function () {});
      }
    } catch (error) {
      // The result is ignored on purpose.
    }
  }

  function flush() {
    if (state.timer !== null) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    if (state.readOnly || !state.persistent) return false;
    var storage = getStorage();
    try {
      if (!storage) throw new Error("localStorage is not available.");
      // A different tab may have written before its storage event reaches us.
      var raw = storage.getItem(STORAGE_KEY);
      if (raw !== null) {
        var result = interpret(raw);
        if (result.status === "newer") {
          state.status = "newer";
          state.saveFailed = false;
          state.readOnly = true;
          notify({ source: "storage" });
          return false;
        }
        if (result.status === "corrupt") {
          setAside(storage, raw);
          state.status = "corrupt";
          notify({ source: "storage" });
          if (state.readOnly) return false;
        } else {
          state.doc = merge(state.doc, result.doc);
        }
      }
      storage.setItem(STORAGE_KEY, JSON.stringify(state.doc));
    } catch (error) {
      warn("Cannot save settings:", error);
      if (!state.saveFailed) {
        state.saveFailed = true;
        notify({ source: "save-failed" });
      }
      return false;
    }
    state.saveFailed = false;
    askForDurableStorage();
    return true;
  }

  function save() {
    if (state.timer !== null) clearTimeout(state.timer);
    state.timer = setTimeout(flush, SAVE_DELAY_MS);
  }

  function commit(stamp) {
    state.doc.updatedAt = stamp;
    save();
    notify({ source: "local" });
  }

  function ensureDoc() {
    if (!state.doc) state.doc = emptyDoc();
    return state.doc;
  }

  function getRating(id) {
    var record = isValidId(id) ? ensureDoc().ratings[id] : undefined;
    return record && record.stars !== null ? record.stars : null;
  }

  function setRating(id, stars) {
    var doc = ensureDoc();
    if (!isValidId(id) || !(stars === null || isValidStars(stars))) {
      warn("Ignored invalid rating for", id);
      return false;
    }
    var current = doc.ratings[id];
    var currentStars = current ? current.stars : null;
    if (currentStars === stars) return true;
    var stamp = nowFn();
    doc.ratings[id] = { stars: stars, updatedAt: stamp };
    commit(stamp);
    return true;
  }

  function getTags(id) {
    var record = isValidId(id) ? ensureDoc().tags[id] : undefined;
    return record ? record.tags.slice() : [];
  }

  function setTags(id, tags, suggestedLabels) {
    var doc = ensureDoc();
    if (!isValidId(id) || !Array.isArray(tags)) {
      warn("Ignored invalid tags for", id);
      return false;
    }
    var next = normalizeTagList(tags, suggestedLabels);
    // Setters reject invalid input rather than silently truncating the visitor's edit.
    if (tags.some(function (tag) {
      return typeof tag !== "string" || Array.from(cleanText(tag)).length > MAX_TAG_LENGTH;
    })) return false;
    var unique = Object.create(null);
    tags.forEach(function (tag) {
      var normalized = normalizeTag(tag, suggestedLabels);
      if (normalized !== null) unique[normalized.toLocaleLowerCase()] = true;
    });
    if (Object.keys(unique).length > MAX_TAGS_PER_CAFE) return false;
    var current = doc.tags[id] ? doc.tags[id].tags : [];
    if (JSON.stringify(current) === JSON.stringify(next)) return true;
    var stamp = nowFn();
    doc.tags[id] = { tags: next, updatedAt: stamp };
    commit(stamp);
    return true;
  }

  function allTags() {
    var counts = Object.create(null);
    var order = [];
    var tags = ensureDoc().tags;
    Object.keys(tags).forEach(function (id) {
      tags[id].tags.forEach(function (tag) {
        var folded = tag.toLocaleLowerCase();
        if (!counts[folded]) {
          counts[folded] = { tag: tag, count: 0 };
          order.push(folded);
        }
        counts[folded].count += 1;
      });
    });
    return order.map(function (folded) { return counts[folded]; }).sort(function (a, b) {
      return b.count - a.count || a.tag.toLocaleLowerCase().localeCompare(b.tag.toLocaleLowerCase());
    });
  }

  function renameTag(from, to, suggestedLabels) {
    var old = normalizeTag(from, suggestedLabels);
    var next = normalizeTag(to, suggestedLabels);
    if (old === null || next === null) return false;
    var tags = ensureDoc().tags;
    var stamp = nowFn();
    var changed = false;
    Object.keys(tags).forEach(function (id) {
      var current = tags[id].tags;
      if (!current.some(function (tag) {
        return tag.toLocaleLowerCase() === old.toLocaleLowerCase();
      })) return;
      var renamed = normalizeTagList(current.map(function (tag) {
        return tag.toLocaleLowerCase() === old.toLocaleLowerCase() ? next : tag;
      }), suggestedLabels);
      if (JSON.stringify(current) === JSON.stringify(renamed)) return;
      tags[id] = { tags: renamed, updatedAt: stamp };
      changed = true;
    });
    if (changed) commit(stamp);
    return true;
  }

  function deleteTag(tag) {
    var clean = normalizeTag(tag);
    if (clean === null) return false;
    var tags = ensureDoc().tags;
    var stamp = nowFn();
    var changed = false;
    Object.keys(tags).forEach(function (id) {
      var kept = tags[id].tags.filter(function (value) {
        return value.toLocaleLowerCase() !== clean.toLocaleLowerCase();
      });
      if (kept.length === tags[id].tags.length) return;
      tags[id] = { tags: kept, updatedAt: stamp };
      changed = true;
    });
    if (changed) commit(stamp);
    return true;
  }

  // Config has already been validated. Saved preferences are untrusted and
  // may mention filters no longer in config; ignore those names, don't erase them.
  function applyFilterPrefs(configured, prefs) {
    if (!Array.isArray(configured)) return [];
    prefs = isObject(prefs) ? prefs : {};
    var order = cleanNameList(prefs.order) || [];
    var hidden = cleanNameList(prefs.hidden) || [];
    var shown = cleanNameList(prefs.shown) || [];
    var seen = Object.create(null);
    return configured.filter(function (entry) {
      if (!isObject(entry) || typeof entry.key !== "string" || seen[entry.key]) return false;
      seen[entry.key] = true;
      return shown.indexOf(entry.key) !== -1 ||
        (entry.enabled === true && hidden.indexOf(entry.key) === -1);
    }).sort(function (a, b) {
      var aOrder = order.indexOf(a.key);
      var bOrder = order.indexOf(b.key);
      if (aOrder !== -1 || bOrder !== -1) {
        if (aOrder === -1) return 1;
        if (bOrder === -1) return -1;
        return aOrder - bOrder;
      }
      return a.index - b.index;
    });
  }

  function getFilterPrefs() {
    var f = ensureDoc().filters;
    return { order: f.order.slice(), hidden: f.hidden.slice(), shown: f.shown.slice(), defaultOn: f.defaultOn.slice() };
  }

  function setFilterPrefs(prefs) {
    var doc = ensureDoc();
    var next = isObject(prefs) ? {
      order: cleanNameList(prefs.order),
      hidden: cleanNameList(prefs.hidden),
      shown: cleanNameList(prefs.shown),
      defaultOn: cleanNameList(prefs.defaultOn),
    } : null;
    if (!next || !next.order || !next.hidden || !next.shown || !next.defaultOn) {
      warn("Ignored invalid filter preferences.");
      return false;
    }
    var stamp = nowFn();
    next.updatedAt = stamp;
    doc.filters = next;
    commit(stamp);
    return true;
  }

  function passesRatingFilter(stars, filter) {
    if (!isObject(filter) || MIN_STARS_VALUES.indexOf(filter.minStars) === -1) return true;
    if (!isValidStars(stars)) return filter.includeUnrated !== false;
    return stars >= filter.minStars;
  }

  function getRatingFilter() {
    var r = ensureDoc().ratingFilter;
    return { minStars: r.minStars, includeUnrated: r.includeUnrated };
  }

  function setRatingFilter(value) {
    var doc = ensureDoc();
    if (!isObject(value) || !(value.minStars === null || MIN_STARS_VALUES.indexOf(value.minStars) !== -1) ||
        typeof value.includeUnrated !== "boolean") {
      warn("Ignored invalid rating filter.");
      return false;
    }
    var stamp = nowFn();
    doc.ratingFilter = { minStars: value.minStars, includeUnrated: value.includeUnrated, updatedAt: stamp };
    commit(stamp);
    return true;
  }

  function getAroundMe() {
    var a = ensureDoc().aroundMe;
    return { enabled: a.enabled, radiusKm: a.radiusKm };
  }

  function setAroundMe(value) {
    var doc = ensureDoc();
    if (!isObject(value) || typeof value.enabled !== "boolean" ||
        !(value.radiusKm === null || isValidRadius(value.radiusKm))) {
      warn("Ignored invalid around-me settings.");
      return false;
    }
    var stamp = nowFn();
    doc.aroundMe = { enabled: value.enabled, radiusKm: value.radiusKm, updatedAt: stamp };
    commit(stamp);
    return true;
  }

  function onChange(listener) {
    if (typeof listener !== "function") return function () {};
    state.listeners.push(listener);
    return function () {
      var index = state.listeners.indexOf(listener);
      if (index !== -1) state.listeners.splice(index, 1);
    };
  }

  window.UserPrefs = {
    STORAGE_KEY: STORAGE_KEY,
    CORRUPT_PREFIX: CORRUPT_PREFIX,
    SCHEMA_VERSION: SCHEMA_VERSION,
    load: load,
    save: save,
    flush: flush,
    getStatus: function () { return state.saveFailed ? "unavailable" : state.status; },
    getRating: getRating,
    setRating: setRating,
    getTags: getTags,
    setTags: setTags,
    allTags: allTags,
    renameTag: renameTag,
    deleteTag: deleteTag,
    getFilterPrefs: getFilterPrefs,
    applyFilterPrefs: applyFilterPrefs,
    setFilterPrefs: setFilterPrefs,
    getRatingFilter: getRatingFilter,
    passesRatingFilter: passesRatingFilter,
    setRatingFilter: setRatingFilter,
    getAroundMe: getAroundMe,
    setAroundMe: setAroundMe,
    onChange: onChange,
    validate: validate,
    migrate: migrate,
    merge: merge,
    normalizeTag: normalizeTag,
    emptyDoc: emptyDoc,
    _setNow: function (fn) { nowFn = fn; },
  };
})();
