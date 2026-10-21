(function () {
  "use strict";

  /* ---------------------------------------------------------
   * Localization
   * --------------------------------------------------------- */
  var root = document.documentElement;

  function message(key, values) {
    var parts = key.split(".");
    var text = APP_TRANSLATIONS.en;

    parts.forEach(function (part) {
      text = text && text[part];
    });

    if (typeof text !== "string") return key;

    return text.replace(/\{(\w+)\}/g, function (_, token) {
      return values && values[token] !== undefined ? values[token] : "{" + token + "}";
    });
  }

  function criterionLabel(criterion) {
    // Configuration text is literal, never an i18n key or translated fallback.
    return criterion.displayedText;
  }

  function criterionTextHtml(criterion, className) {
    // Both the browser and external translation services must leave this alone.
    return '<span translate="no" class="' + className + ' notranslate">' +
      escapeHtml(criterionLabel(criterion)) + "</span>";
  }

  function regionLabel(region) {
    return message("regions." + region);
  }

  function regionName(region) {
    return message("regionName", { region: regionLabel(region) });
  }

  function kindLabel(kind) {
    return message("kinds." + kind);
  }

  function sizeLabel(size) {
    return size ? message("sizes." + size) : "";
  }

  function priceSymbol(price) {
    return price ? new Array(price + 1).join("$") : "";
  }

  function cafeText(cafe) {
    return {
      name: cafe.name,
      blurb: cafe.blurb,
      hoursNote: cafe.hoursNote,
    };
  }

  // The official Korean name is shown under the display name, unless it is
  // already the display name.
  function secondaryName(cafe) {
    return cafeText(cafe).name === cafe.nameKr ? "" : cafe.nameKr;
  }

  function brandSubtitleKey() {
    return CAFES.length ? "brand.subtitle" : "brand.subtitleEmpty";
  }

  function applyStaticTranslations() {
    var values = { count: CAFES.length };
    document.title = message("meta.title");
    document.querySelector('meta[name="description"]').setAttribute("content", message("meta.description"));
    document.getElementById("brandSub").setAttribute("data-i18n", brandSubtitleKey());

    document.querySelectorAll("[data-i18n]").forEach(function (element) {
      if (element.closest('[translate="no"]')) return;
      element.textContent = message(element.getAttribute("data-i18n"), values);
    });
    document.querySelectorAll("[data-i18n-aria-label]").forEach(function (element) {
      if (element.closest('[translate="no"]')) return;
      element.setAttribute("aria-label", message(element.getAttribute("data-i18n-aria-label")));
    });
  }

  /* ---------------------------------------------------------
   * Opening hours (always evaluated in Korea time)
   * --------------------------------------------------------- */
  var MINUTES_PER_DAY = 24 * 60;
  var EARLY_MINUTES = toMinutes(EARLY_OPENING);
  var WEEKDAY_INDEX = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  var clockFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: CAFE_TIME_ZONE,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

  function toMinutes(value) {
    var parts = String(value).split(":");
    return Number(parts[0]) * 60 + Number(parts[1]);
  }

  // `?at=sat-14:30` freezes the clock for testing.
  function clockOverride() {
    var value = new URLSearchParams(window.location.search).get("at");
    var match = value && /^(mon|tue|wed|thu|fri|sat|sun)-(\d{2}):(\d{2})$/.exec(value);
    if (!match) return null;
    return { day: DAYS.indexOf(match[1]), minutes: Number(match[2]) * 60 + Number(match[3]) };
  }

  var frozenClock = clockOverride();

  function koreaNow() {
    if (frozenClock) return frozenClock;
    var parts = {};
    clockFormatter.formatToParts(new Date()).forEach(function (part) {
      parts[part.type] = part.value;
    });
    return {
      day: WEEKDAY_INDEX[parts.weekday],
      minutes: (Number(parts.hour) % 24) * 60 + Number(parts.minute),
    };
  }

  var now = koreaNow();

  function periodsOn(cafe, dayIndex) {
    return cafe.hours[DAYS[(dayIndex + 7) % 7]] || [];
  }

  function periodEnd(period) {
    return period.close > period.open ? period.close : period.close + MINUTES_PER_DAY;
  }

  function formatTime(minutes) {
    if (minutes === MINUTES_PER_DAY) return "24:00";
    var value = minutes % MINUTES_PER_DAY;
    var hours = Math.floor(value / 60);
    var mins = value % 60;
    return (hours < 10 ? "0" : "") + hours + ":" + (mins < 10 ? "0" : "") + mins;
  }

  function formatPeriods(periods) {
    return periods
      .map(function (period) {
        return formatTime(period.open) + "–" + formatTime(period.close);
      })
      .join(message("hours.separator"));
  }

  function periodsHtml(periods) {
    return periods
      .map(function (period) {
        return '<span class="period">' + formatTime(period.open) + "–" + formatTime(period.close) + "</span>";
      })
      .join("");
  }

  function hoursStatus(cafe) {
    if (!cafe.hasHours) return { state: "unknown" };

    var today = periodsOn(cafe, now.day);
    for (var i = 0; i < today.length; i += 1) {
      if (today[i].open <= now.minutes && now.minutes < periodEnd(today[i])) {
        return { state: "open", detail: message("hours.closesAt", { time: formatTime(today[i].close) }) };
      }
    }

    var yesterday = periodsOn(cafe, now.day - 1);
    for (var j = 0; j < yesterday.length; j += 1) {
      var period = yesterday[j];
      if (period.close < period.open && now.minutes < period.close) {
        return { state: "open", detail: message("hours.closesAt", { time: formatTime(period.close) }) };
      }
    }

    for (var k = 0; k < today.length; k += 1) {
      if (today[k].open > now.minutes) {
        return { state: "closed", detail: message("hours.opensAt", { time: formatTime(today[k].open) }) };
      }
    }

    for (var offset = 1; offset <= 7; offset += 1) {
      var next = periodsOn(cafe, now.day + offset);
      if (next.length) {
        var dayKey = DAYS[(now.day + offset) % 7];
        return {
          state: "closed",
          detail: message("hours.opensDayAt", {
            day: message("days.short." + dayKey),
            time: formatTime(next[0].open),
          }),
        };
      }
    }
    return { state: "closed", detail: "" };
  }

  function todayHoursText(cafe) {
    if (!cafe.hasHours) return message("hours.unknown");
    var today = periodsOn(cafe, now.day);
    return today.length ? formatPeriods(today) : message("hours.closedToday");
  }

  function computedValue(cafe, key) {
    if (key === "openNow") return hoursStatus(cafe).state === "open";
    if (key === "openTomorrow") {
      if (!cafe.hasHours) return false;
      // Include both tomorrow's scheduled periods and today's periods that
      // continue into tomorrow. Closing exactly at midnight does not count.
      return periodsOn(cafe, now.day + 1).length > 0 ||
        periodsOn(cafe, now.day).some(function (period) {
          return periodEnd(period) > MINUTES_PER_DAY;
        });
    }
    if (key === "openEarly") {
      return DAYS.some(function (day) {
        return (cafe.hours[day] || []).some(function (period) {
          return period.open < EARLY_MINUTES;
        });
      });
    }
    if (key === "openSunday") return periodsOn(cafe, 6).length > 0;
    return false;
  }

  var COMPUTED_KEYS = {};
  CRITERION_DEFINITIONS.forEach(function (criterion) {
    if (criterion.computed) COMPUTED_KEYS[criterion.key] = true;
  });

  function hasCriterion(cafe, key) {
    return COMPUTED_KEYS[key] ? computedValue(cafe, key) : cafe[key] === true;
  }

  /* ---------------------------------------------------------
   * Theme
   * --------------------------------------------------------- */
  var themeToggleBtn = document.querySelector("[data-theme-toggle]");
  var themeColorMeta = document.querySelector('meta[name="theme-color"]');

  var currentTheme = "light";

  function renderThemeToggle() {
    themeToggleBtn.innerHTML =
      currentTheme === "dark"
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"></path></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"></path></svg>';
    themeToggleBtn.setAttribute(
      "aria-label",
      currentTheme === "dark" ? message("theme.toLight") : message("theme.toDark")
    );
  }

  function applyTheme() {
    root.setAttribute("data-theme", currentTheme);
    themeColorMeta.setAttribute("content", currentTheme === "dark" ? "#1A1410" : "#FFF8F0");
    renderThemeToggle();
  }

  themeToggleBtn.addEventListener("click", function () {
    currentTheme = currentTheme === "dark" ? "light" : "dark";
    applyTheme();
  });

  applyStaticTranslations();
  applyTheme();

  /* ---------------------------------------------------------
   * Mobile sidebar toggle
   * --------------------------------------------------------- */
  var sidebar = document.getElementById("sidebar");
  var sidebarToggle = document.getElementById("sidebarToggle");
  sidebarToggle.addEventListener("click", function () {
    sidebar.classList.toggle("open");
  });
  document.addEventListener("click", function (event) {
    if (
      sidebar.classList.contains("open") &&
      !(personalizeDialog && personalizeDialog.open) &&
      !(event.target.closest && event.target.closest("#personalizeDialog")) &&
      !sidebar.contains(event.target) &&
      !sidebarToggle.contains(event.target)
    ) {
      sidebar.classList.remove("open");
    }
  });

  /* ---------------------------------------------------------
   * Filter state
   * --------------------------------------------------------- */
  var state = {
    kind: "All",
    criteria: {},
    sizes: {},
    prices: {},
    userLocation: null,
    distances: Object.create(null),
    aroundMe: window.UserPrefs ? window.UserPrefs.getAroundMe() : { enabled: false, radiusKm: null },
    tags: Object.create(null),
    ratingFilter: window.UserPrefs ? window.UserPrefs.getRatingFilter() : { minStars: null, includeUnrated: true },
    sort: { key: "name", dir: "asc" },
  };
  var filterPrefs = window.UserPrefs ? window.UserPrefs.getFilterPrefs() : {
    order: [], hidden: [], shown: [], defaultOn: [],
  };
  var filterPrefsSignature = JSON.stringify(filterPrefs);
  if (window.UserPrefs) CRITERIA = window.UserPrefs.applyFilterPrefs(CONFIGURED_CRITERIA, filterPrefs);

  function clearFilters(options) {
    state.kind = "All";
    state.tags = Object.create(null);
    state.criteria = {};
    CRITERIA.forEach(function (criterion) {
      state.criteria[criterion.key] = false;
    });
    SIZES.forEach(function (size) { state.sizes[size] = false; });
    PRICES.forEach(function (price) { state.prices[price] = false; });
    if (!options || !options.keepRating) {
      if (state.aroundMe.radiusKm !== null) {
        state.aroundMe.radiusKm = null;
        if (window.UserPrefs) {
          window.UserPrefs.setAroundMe(state.aroundMe);
          window.UserPrefs.flush();
        }
      }
      var changed = state.ratingFilter.minStars !== null || !state.ratingFilter.includeUnrated;
      state.ratingFilter = { minStars: null, includeUnrated: true };
      if (changed && window.UserPrefs) {
        window.UserPrefs.setRatingFilter(state.ratingFilter);
        window.UserPrefs.flush();
      }
    }
  }

  function applyDefaultFilters() {
    clearFilters({ keepRating: true });
    filterPrefs.defaultOn.forEach(function (key) {
      if (Object.prototype.hasOwnProperty.call(state.criteria, key)) state.criteria[key] = true;
    });
  }
  applyDefaultFilters();

  function selectedCriteriaKeys() {
    return CRITERIA.filter(function (criterion) {
      return state.criteria[criterion.key];
    }).map(function (criterion) {
      return criterion.key;
    });
  }

  function allCriteriaKeys() {
    return CRITERIA.map(function (criterion) { return criterion.key; });
  }

  function selectedValues(map) {
    return Object.keys(map).filter(function (key) { return map[key]; });
  }

  // Venue type, size and price narrow the pool; criteria are "must have".
  function myRating(cafe) {
    return window.UserPrefs ? window.UserPrefs.getRating(cafe.id) : null;
  }

  function matchesScope(cafe, ignoreRating) {
    if (state.kind !== "All" && cafe.kind !== state.kind) return false;
    var sizes = selectedValues(state.sizes);
    if (sizes.length && sizes.indexOf(cafe.size) === -1) return false;
    var prices = selectedValues(state.prices);
    if (prices.length && prices.indexOf(String(cafe.price)) === -1) return false;
    if (state.userLocation && CafeGeo.isInsideJeju(state.userLocation) &&
        state.aroundMe.radiusKm !== null && state.distances[cafe.id] > state.aroundMe.radiusKm) return false;
    // Array.filter supplies a numeric index as the second argument.
    return ignoreRating === true || !window.UserPrefs ||
      window.UserPrefs.passesRatingFilter(myRating(cafe), state.ratingFilter);
  }

  function matchesFilters(cafe, ignoreRating) {
    if (!matchesScope(cafe, ignoreRating)) return false;
    if (!matchesTags(cafe)) return false;
    return selectedCriteriaKeys().every(function (key) {
      return hasCriterion(cafe, key);
    });
  }

  function myTags(cafe) {
    return window.UserPrefs ? window.UserPrefs.getTags(cafe.id) : [];
  }

  function matchesTags(cafe) {
    var tags = myTags(cafe).map(function (tag) { return tag.toLocaleLowerCase(); });
    return selectedValues(state.tags).every(function (tag) { return tags.indexOf(tag) !== -1; });
  }

  function matchCount(cafe, keys) {
    return keys.filter(function (key) {
      return hasCriterion(cafe, key);
    }).length;
  }

  /* ---------------------------------------------------------
   * Filter controls
   * --------------------------------------------------------- */
  var kindListEl = document.getElementById("kindList");
  var criteriaListEl = document.getElementById("criteriaList");
  var sizeListEl = document.getElementById("sizeList");
  var priceListEl = document.getElementById("priceList");
  var ratingFilterListEl = document.getElementById("ratingFilterList");
  var includeUnratedEl = document.getElementById("includeUnrated");

  function saveRatingFilter() {
    if (window.UserPrefs) {
      window.UserPrefs.setRatingFilter(state.ratingFilter);
      window.UserPrefs.flush();
    }
    update();
  }

  function renderRatingFilters() {
    ratingFilterListEl.innerHTML = "";
    [null, 3, 4, 5].forEach(function (minimum) {
      var label = document.createElement("label");
      label.className = "radio-chip";
      label.innerHTML =
        '<input type="radio" name="my-rating-filter" value="' + (minimum === null ? "any" : minimum) + '" aria-label="' +
          escapeHtml(message(minimum === null ? "rating.any" : "rating.minLabel", { n: minimum })) + '" />' +
        "<span>" + (minimum === null ? "" : starHtml(true)) +
          escapeHtml(message(minimum === null ? "rating.any" : "rating.min" + minimum)) + "</span>";
      var input = label.querySelector("input");
      input.checked = state.ratingFilter.minStars === minimum;
      input.addEventListener("change", function () {
        if (!input.checked) return;
        state.ratingFilter.minStars = minimum;
        includeUnratedEl.disabled = minimum === null;
        saveRatingFilter();
      });
      ratingFilterListEl.appendChild(label);
    });
    includeUnratedEl.checked = state.ratingFilter.includeUnrated;
    includeUnratedEl.disabled = state.ratingFilter.minStars === null;
  }

  includeUnratedEl.addEventListener("change", function () {
    state.ratingFilter.includeUnrated = includeUnratedEl.checked;
    saveRatingFilter();
  });

  function renderKinds() {
    kindListEl.innerHTML = "";
    ["All"].concat(KINDS).forEach(function (kind) {
      var label = document.createElement("label");
      label.className = "radio-chip";
      label.innerHTML =
        '<input type="radio" name="kind" value="' + kind + '" data-testid="radio-kind-' + kind.toLowerCase() + '" />' +
        "<span>" + escapeHtml(kindLabel(kind)) + "</span>";
      var input = label.querySelector("input");
      input.checked = state.kind === kind;
      input.addEventListener("change", function () {
        if (input.checked) {
          state.kind = kind;
          update();
        }
      });
      kindListEl.appendChild(label);
    });
  }

  function renderCriteria() {
    criteriaListEl.innerHTML = "";
    CRITERIA.forEach(function (criterion) {
      var label = document.createElement("label");
      label.className = "checkbox-item";
      label.innerHTML =
        '<input type="checkbox" data-testid="checkbox-' + criterion.key + '" />' +
        '<span class="crit-icon"><i data-lucide="' + criterion.icon + '"></i></span>' +
        criterionTextHtml(criterion, "crit-label");
      var input = label.querySelector("input");
      input.checked = state.criteria[criterion.key];
      input.addEventListener("change", function () {
        state.criteria[criterion.key] = input.checked;
        update();
      });
      criteriaListEl.appendChild(label);
    });
  }

  function renderToggleChips(container, values, selected, labelFor, hintFor, testPrefix) {
    container.innerHTML = "";
    values.forEach(function (value) {
      var label = document.createElement("label");
      label.className = "toggle-chip";
      var hint = hintFor(value);
      if (hint) label.title = hint;
      label.innerHTML =
        '<input type="checkbox" data-testid="' + testPrefix + value + '" />' +
        '<span><strong>' + escapeHtml(labelFor(value)) + "</strong>" +
        (hint ? "<small>" + escapeHtml(hint) + "</small>" : "") + "</span>";
      var input = label.querySelector("input");
      input.checked = selected[value];
      input.addEventListener("change", function () {
        selected[value] = input.checked;
        update();
      });
      container.appendChild(label);
    });
  }

  function renderControls() {
    renderKinds();
    renderCriteria();
    renderToggleChips(sizeListEl, SIZES, state.sizes, sizeLabel, function (size) {
      return message("sizes." + size + "Hint");
    }, "toggle-size-");
    renderToggleChips(priceListEl, PRICES, state.prices, priceSymbol, function (price) {
      return message("prices." + price);
    }, "toggle-price-");
    renderRatingFilters();
    renderDistanceFilter();
    renderTagFilters();
  }

  document.getElementById("resetBtn").title = message("filters.resetHint");
  document.getElementById("resetBtn").addEventListener("click", resetFilters);
  document.getElementById("mapEmptyReset").addEventListener("click", function () {
    clearFilters();
    renderControls();
    update();
  });

  function resetFilters() {
    applyDefaultFilters();
    renderControls();
    update();
  }

  /* ---------------------------------------------------------
   * Personal filter settings (draft until Save)
   * --------------------------------------------------------- */
  var personalizeBtn = document.getElementById("personalizeBtn");
  var personalizeDialog = document.getElementById("personalizeDialog");
  var personalizeList = document.getElementById("personalizeList");
  var personalizeStatus = document.getElementById("personalizeStatus");
  var filterDraft = [];
  var restoringFilterDefaults = false;

  function makeFilterDraft(prefs) {
    var visible = window.UserPrefs.applyFilterPrefs(CONFIGURED_CRITERIA, prefs).map(function (entry) { return entry.key; });
    // Include every configured row while retaining the visitor's chosen order.
    return window.UserPrefs.applyFilterPrefs(CONFIGURED_CRITERIA, {
      order: prefs.order, shown: CONFIGURED_CRITERIA.map(function (entry) { return entry.key; }),
    }).map(function (entry) {
      return { criterion: entry, shown: visible.indexOf(entry.key) !== -1, defaultOn: prefs.defaultOn.indexOf(entry.key) !== -1 };
    });
  }

  function renderFilterDraft() {
    personalizeList.innerHTML = "";
    filterDraft.forEach(function (row, index) {
      var criterion = row.criterion;
      var item = document.createElement("li");
      item.className = "personalize-row";
      item.setAttribute("data-filter-key", criterion.key);
      item.innerHTML =
        '<span class="personalize-name notranslate" translate="no">' + escapeHtml(criterionLabel(criterion)) + "</span>" +
        '<div class="personalize-options">' +
          '<label><input type="checkbox" data-action="show" aria-label="' + escapeHtml(message("personalize.showFilter", { name: criterionLabel(criterion) })) + '"' + (row.shown ? " checked" : "") + '><span>' + escapeHtml(message("personalize.show")) + "</span></label>" +
          '<label><input type="checkbox" data-action="default" aria-label="' + escapeHtml(message("personalize.defaultFor", { name: criterionLabel(criterion) })) + '"' + (row.defaultOn ? " checked" : "") + (row.shown ? "" : " disabled") + '><span>' + escapeHtml(message("personalize.defaultOn")) + "</span></label>" +
        "</div>" +
        '<div class="personalize-moves">' +
          '<button type="button" data-action="up" aria-label="' + escapeHtml(message("personalize.moveUp", { name: criterionLabel(criterion) })) + '"' + (index === 0 ? " disabled" : "") + '><i data-lucide="arrow-up" aria-hidden="true"></i><span class="sr-only">' + escapeHtml(message("personalize.up")) + "</span></button>" +
          '<button type="button" data-action="down" aria-label="' + escapeHtml(message("personalize.moveDown", { name: criterionLabel(criterion) })) + '"' + (index === filterDraft.length - 1 ? " disabled" : "") + '><i data-lucide="arrow-down" aria-hidden="true"></i><span class="sr-only">' + escapeHtml(message("personalize.down")) + "</span></button>" +
        "</div>";
      item.querySelector('[data-action="show"]').addEventListener("change", function (event) {
        row.shown = event.target.checked;
        item.querySelector('[data-action="default"]').disabled = !row.shown;
      });
      item.querySelector('[data-action="default"]').addEventListener("change", function (event) {
        row.defaultOn = event.target.checked;
      });
      ["up", "down"].forEach(function (direction) {
        item.querySelector('[data-action="' + direction + '"]').addEventListener("click", function () {
          var destination = index + (direction === "up" ? -1 : 1);
          if (destination < 0 || destination >= filterDraft.length) return;
          filterDraft.splice(index, 1);
          filterDraft.splice(destination, 0, row);
          renderFilterDraft();
          var moved = personalizeList.children[destination];
          var target = moved.querySelector('[data-action="' + direction + '"]');
          (target.disabled ? moved.querySelector('[data-action="show"]') : target).focus();
          personalizeStatus.textContent = message("personalize.moved", {
            name: criterionLabel(criterion), position: destination + 1, count: filterDraft.length,
          });
        });
      });
      personalizeList.appendChild(item);
    });
    if (window.lucide) lucide.createIcons();
  }

  personalizeBtn.disabled = !window.UserPrefs;
  personalizeBtn.addEventListener("click", function () {
    filterDraft = makeFilterDraft(window.UserPrefs.getFilterPrefs());
    restoringFilterDefaults = false;
    personalizeStatus.textContent = "";
    document.getElementById("personalizeTagError").textContent = "";
    document.getElementById("personalizeTagStatus").textContent = "";
    renderFilterDraft();
    renderTagManagement();
    personalizeDialog.showModal();
  });
  personalizeDialog.addEventListener("close", function () {
    filterDraft = [];
    personalizeBtn.focus();
  });
  personalizeDialog.addEventListener("keydown", function (event) {
    if (event.key !== "Tab") return;
    var controls = personalizeDialog.querySelectorAll("button:not(:disabled), input:not(:disabled)");
    var first = controls[0];
    var last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  personalizeDialog.addEventListener("click", function (event) {
    // A click outside the dialog's rectangle is a backdrop click.
    var rect = personalizeDialog.getBoundingClientRect();
    if (event.target === personalizeDialog &&
        (event.clientX < rect.left || event.clientX > rect.right ||
         event.clientY < rect.top || event.clientY > rect.bottom)) personalizeDialog.close();
  });
  document.getElementById("personalizeCancel").addEventListener("click", function () {
    personalizeDialog.close();
  });
  document.getElementById("personalizeRestore").addEventListener("click", function () {
    filterDraft = makeFilterDraft({ order: [], hidden: [], shown: [], defaultOn: [] });
    restoringFilterDefaults = true;
    renderFilterDraft();
    personalizeStatus.textContent = message("personalize.restored");
  });
  function draftFilterPrefs(previous) {
    var configuredKeys = CONFIGURED_CRITERIA.map(function (entry) { return entry.key; });
    var order = filterDraft.map(function (row) { return row.criterion.key; });
    function keepRemoved(list) {
      return restoringFilterDefaults ? [] : list.filter(function (key) { return configuredKeys.indexOf(key) === -1; });
    }
    if (!restoringFilterDefaults) {
      previous.order.forEach(function (key, index) {
        if (configuredKeys.indexOf(key) === -1) order.splice(Math.min(index, order.length), 0, key);
      });
    }
    return {
      order: JSON.stringify(order) === JSON.stringify(configuredKeys) ? [] : order,
      hidden: filterDraft.filter(function (row) { return !row.shown && row.criterion.enabled; })
        .map(function (row) { return row.criterion.key; }).concat(keepRemoved(previous.hidden)),
      shown: filterDraft.filter(function (row) { return row.shown && !row.criterion.enabled; })
        .map(function (row) { return row.criterion.key; }).concat(keepRemoved(previous.shown)),
      defaultOn: filterDraft.filter(function (row) { return row.defaultOn; })
        .map(function (row) { return row.criterion.key; }).concat(keepRemoved(previous.defaultOn)),
    };
  }
  document.getElementById("personalizeSave").addEventListener("click", function () {
    window.UserPrefs.setFilterPrefs(draftFilterPrefs(window.UserPrefs.getFilterPrefs()));
    window.UserPrefs.flush();
    personalizeDialog.close();
  });

  function refreshPersonalFilters() {
    var next = window.UserPrefs.getFilterPrefs();
    var signature = JSON.stringify(next);
    if (signature === filterPrefsSignature) return;
    filterPrefs = next;
    filterPrefsSignature = signature;
    CRITERIA = window.UserPrefs.applyFilterPrefs(CONFIGURED_CRITERIA, filterPrefs);
    var visible = allCriteriaKeys();
    Object.keys(state.criteria).forEach(function (key) {
      if (visible.indexOf(key) === -1) delete state.criteria[key];
    });
    visible.forEach(function (key) {
      if (!Object.prototype.hasOwnProperty.call(state.criteria, key)) state.criteria[key] = false;
    });
    if (!tableColumns().some(function (column) { return column.key === state.sort.key; })) {
      state.sort = { key: "name", dir: "asc" };
    }
    renderControls();
    renderTableHeader();
    update({ fit: false });
  }

  /* ---------------------------------------------------------
   * Shared markup helpers
   * --------------------------------------------------------- */
  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (character) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character];
    });
  }

  function safeUrl(value) {
    return /^https?:\/\//i.test(value || "") ? escapeHtml(value) : "#";
  }

  var CHECK_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
  var CROSS_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  var EXTERNAL_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 17 17 7M8 7h9v9"/></svg>';
  var CHEVRON_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>';
  var PIN_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 5-8 12-8 12s-8-7-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/></svg>';

  var INSTAGRAM_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1.1" fill="currentColor" stroke="none"/></svg>';
  var FACEBOOK_SVG =
    '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M14 8.5V6.8c0-.8.5-1.3 1.4-1.3H17V2.2C16.6 2.1 15.4 2 14.1 2 11.3 2 9.6 3.7 9.6 6.6v1.9H6.8v3.6h2.8V22H14v-9.9h2.9l.5-3.6H14z"/></svg>';
  var KAKAO_SVG =
    '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3.2c-5.4 0-9.8 3.4-9.8 7.7 0 2.7 1.8 5.1 4.5 6.5l-1 3.6c-.1.3.3.6.6.4l4.3-2.8c.5.1.9.1 1.4.1 5.4 0 9.8-3.4 9.8-7.8S17.4 3.2 12 3.2z"/></svg>';
  var PHONE_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/></svg>';
  var MAIL_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/></svg>';
  var COPY_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';

  function isUrl(value) {
    return /^https?:\/\//i.test(value || "");
  }

  // Social logos (Instagram, Facebook, Kakao) and phone/email lines, shown
  // only for fields that are filled in.
  function contactHtml(cafe) {
    var socials = [];
    if (isUrl(cafe.instagramUrl)) {
      socials.push('<a class="social-btn social-instagram" href="' + safeUrl(cafe.instagramUrl) + '" target="_blank" rel="noopener" aria-label="' +
        escapeHtml(message("contact.instagram")) + '" title="' + escapeHtml(message("contact.instagram")) + '" data-testid="link-instagram-' + escapeHtml(cafe.id) + '">' + INSTAGRAM_SVG + "</a>");
    }
    if (isUrl(cafe.facebookUrl)) {
      socials.push('<a class="social-btn social-facebook" href="' + safeUrl(cafe.facebookUrl) + '" target="_blank" rel="noopener" aria-label="' +
        escapeHtml(message("contact.facebook")) + '" title="' + escapeHtml(message("contact.facebook")) + '" data-testid="link-facebook-' + escapeHtml(cafe.id) + '">' + FACEBOOK_SVG + "</a>");
    }
    if (cafe.kakao) {
      socials.push(isUrl(cafe.kakao)
        ? '<a class="social-btn social-kakao" href="' + safeUrl(cafe.kakao) + '" target="_blank" rel="noopener" aria-label="' +
          escapeHtml(message("contact.kakaoChannel")) + '" title="' + escapeHtml(message("contact.kakaoChannel")) + '" data-testid="link-kakao-' + escapeHtml(cafe.id) + '">' + KAKAO_SVG + "</a>"
        : '<button type="button" class="social-btn social-kakao" data-copy="' + escapeHtml(cafe.kakao) + '" aria-label="' +
          escapeHtml(message("contact.copyKakao", { id: cafe.kakao })) + '" title="' + escapeHtml(message("contact.copyKakao", { id: cafe.kakao })) + '" data-testid="button-kakao-' + escapeHtml(cafe.id) + '">' + KAKAO_SVG + "</button>");
    }

    var lines = [];
    if (cafe.phone) {
      lines.push('<a class="contact-line" href="tel:' + escapeHtml(cafe.phone.replace(/[^0-9+]/g, "")) + '" aria-label="' +
        escapeHtml(message("contact.call", { phone: cafe.phone })) + '" data-testid="link-phone-' + escapeHtml(cafe.id) + '">' + PHONE_SVG + "<span>" + escapeHtml(cafe.phone) + "</span></a>");
    }
    if (cafe.email) {
      lines.push('<a class="contact-line" href="mailto:' + escapeHtml(cafe.email) + '" aria-label="' +
        escapeHtml(message("contact.email", { email: cafe.email })) + '" data-testid="link-email-' + escapeHtml(cafe.id) + '">' + MAIL_SVG + "<span>" + escapeHtml(cafe.email) + "</span></a>");
    }
    if (cafe.kakao && !isUrl(cafe.kakao)) {
      lines.push('<button type="button" class="contact-line" data-copy="' + escapeHtml(cafe.kakao) + '" aria-label="' +
        escapeHtml(message("contact.copyKakao", { id: cafe.kakao })) + '">' + KAKAO_SVG + "<span>" +
        escapeHtml(message("contact.kakaoId")) + " <strong>" + escapeHtml(cafe.kakao) + "</strong></span>" +
        '<span class="copy-icon">' + COPY_SVG + "</span></button>");
    }

    if (!socials.length && !lines.length) return "";
    return '<div class="contact-block" aria-label="' + escapeHtml(message("contact.title")) + '">' +
      (socials.length ? '<div class="social-row">' + socials.join("") + "</div>" : "") +
      (lines.length ? '<div class="contact-lines">' + lines.join("") + "</div>" : "") +
      "</div>";
  }

  // Copy a KakaoTalk ID to the clipboard and confirm briefly.
  document.addEventListener("click", function (event) {
    var button = event.target.closest && event.target.closest("[data-copy]");
    if (!button) return;
    var value = button.getAttribute("data-copy");
    var done = function () {
      document.querySelectorAll('[data-copy="' + CSS.escape(value) + '"]').forEach(function (element) {
        element.classList.add("is-copied");
        element.setAttribute("data-copied-label", message("contact.copied"));
        window.setTimeout(function () { element.classList.remove("is-copied"); }, 1600);
      });
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(value).then(done, done);
    } else {
      done();
    }
  });

  function statusBadge(status) {
    var label = status.state === "open"
      ? message("hours.open")
      : status.state === "closed" ? message("hours.closed") : message("hours.unknown");
    return '<span class="status-badge status-' + status.state + '"><span class="status-dot"></span>' + escapeHtml(label) + "</span>";
  }

  function metaPills(cafe) {
    var pills = [];
    if (cafe.size) {
      pills.push('<span class="meta-pill" title="' + escapeHtml(message("sizes." + cafe.size + "Hint")) + '">' + escapeHtml(sizeLabel(cafe.size)) + "</span>");
    }
    if (cafe.price) {
      pills.push('<span class="meta-pill price" title="' + escapeHtml(message("prices." + cafe.price)) + '">' + priceSymbol(cafe.price) + "</span>");
    }
    return pills.join("");
  }

  /* ---------------------------------------------------------
   * Map
   * --------------------------------------------------------- */
  var map = new maplibregl.Map({
    container: "map",
    style: "https://tiles.openfreemap.org/styles/positron",
    center: [126.55, 33.38],
    zoom: 9.6,
    attributionControl: { compact: true },
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
  var markers = {};
  var expandedHours = {};
  var cafesById = {};
  CAFES.forEach(function (cafe) { cafesById[cafe.id] = cafe; });

  /* A separate user marker never enters the cafe marker/label collection. */
  var aroundMeActive = false;
  var positionWatch = null;
  var positionGeneration = 0;
  var userMarker = null;
  var locationButton = null;
  var distanceOrigin = null;
  var pendingLocationFit = false;
  var nearOverride = CafeGeo.parseNearOverride(window.location.search);
  var locationStatus = "";

  function supportsLocation() {
    return nearOverride !== null || !!(navigator.geolocation &&
      typeof navigator.geolocation.watchPosition === "function" &&
      typeof navigator.geolocation.clearWatch === "function");
  }

  function saveAroundMe() {
    if (!window.UserPrefs) return;
    window.UserPrefs.setAroundMe(state.aroundMe);
    window.UserPrefs.flush();
  }

  function renderLocationState() {
    if (locationButton) {
      var label = message(aroundMeActive ? "aroundMe.stop" : "aroundMe.button");
      locationButton.setAttribute("aria-label", label);
      locationButton.setAttribute("title", label);
      locationButton.setAttribute("aria-pressed", String(aroundMeActive));
      locationButton.innerHTML = '<i data-lucide="' + (aroundMeActive ? "locate-fixed" : "locate") + '" aria-hidden="true"></i>';
      if (window.lucide) lucide.createIcons();
    }
    document.getElementById("aroundMeStatus").textContent = locationStatus ? message(locationStatus) : "";
  }

  function renderDistanceFilter() {
    var available = !!state.userLocation && CafeGeo.isInsideJeju(state.userLocation);
    var container = document.getElementById("distanceFilterList");
    container.innerHTML = [null].concat(AROUND_ME_RADII_KM).map(function (radius) {
      var value = radius === null ? "any" : String(radius);
      return '<label class="radio-chip"><input type="radio" name="distance-filter" value="' + value +
        '" data-testid="radio-distance-' + value + '"' +
        (state.aroundMe.radiusKm === radius ? " checked" : "") + (!available ? " disabled" : "") +
        '><span>' + escapeHtml(message(radius === null ? "aroundMe.any" : "aroundMe.radiusKm", { n: radius })) + "</span></label>";
    }).join("");
    document.getElementById("distanceHint").textContent = available ? "" :
      message(!supportsLocation() ? "aroundMe.unavailable" :
        state.userLocation ? "aroundMe.outside" : "aroundMe.needsLocation");
  }

  document.getElementById("distanceFilterList").addEventListener("change", function (event) {
    var input = event.target;
    if (!input.matches("input") || !state.userLocation || !CafeGeo.isInsideJeju(state.userLocation)) return;
    var radius = input.value === "any" ? null : Number(input.value);
    if (radius !== null && AROUND_ME_RADII_KM.indexOf(radius) === -1) return;
    state.aroundMe.radiusKm = radius;
    saveAroundMe();
    update();
  });

  function clearPositionWatch() {
    positionGeneration += 1;
    if (positionWatch !== null) {
      navigator.geolocation.clearWatch(positionWatch);
      positionWatch = null;
    }
  }

  function stopAroundMe(status, persist) {
    clearPositionWatch();
    aroundMeActive = false;
    pendingLocationFit = false;
    state.aroundMe.enabled = false;
    state.userLocation = null;
    state.distances = Object.create(null);
    distanceOrigin = null;
    if (userMarker) userMarker.remove();
    userMarker = null;
    if (state.sort.key === "distance") state.sort = { key: "name", dir: "asc" };
    locationStatus = status || "";
    if (persist !== false) saveAroundMe();
    renderLocationState();
    renderDistanceFilter();
    renderTableHeader();
    update({ fit: false });
  }

  function fitUserNearby() {
    if (!state.userLocation || !CafeGeo.isInsideJeju(state.userLocation)) return;
    if (!mapReady) {
      pendingLocationFit = true;
      return;
    }
    pendingLocationFit = false;
    var bounds = new maplibregl.LngLatBounds();
    bounds.extend([state.userLocation.lng, state.userLocation.lat]);
    CAFES.filter(matchesFilters).sort(function (a, b) {
      return state.distances[a.id] - state.distances[b.id];
    }).slice(0, 5).forEach(function (cafe) { bounds.extend([cafe.lng, cafe.lat]); });
    map.fitBounds(bounds, { padding: 56, duration: 500, maxZoom: 12.5 });
  }

  function receiveLocation(position) {
    var coords = position && position.coords;
    var point = coords && { lat: coords.latitude, lng: coords.longitude };
    if (!point || !Number.isFinite(CafeGeo.distanceKm(point, point))) {
      stopAroundMe("aroundMe.unavailable");
      return;
    }
    var first = state.userLocation === null;
    var changedArea = !distanceOrigin || CafeGeo.isInsideJeju(point) !== CafeGeo.isInsideJeju(distanceOrigin);
    state.userLocation = point;
    if (!userMarker) {
      var element = document.createElement("div");
      element.className = "user-location-marker";
      element.setAttribute("role", "img");
      element.setAttribute("data-testid", "marker-user-location");
      userMarker = new maplibregl.Marker({ element: element }).setLngLat([point.lng, point.lat]).addTo(map);
    } else {
      userMarker.setLngLat([point.lng, point.lat]);
    }
    var accuracy = Number.isFinite(coords.accuracy) && coords.accuracy >= 0 ? Math.round(coords.accuracy) : null;
    userMarker.getElement().setAttribute("aria-label", message(accuracy === null ? "aroundMe.youUnknown" : "aroundMe.you", { accuracy: accuracy }));
    locationStatus = CafeGeo.isInsideJeju(point) ? "" : "aroundMe.outside";
    if (locationStatus) pendingLocationFit = false;
    renderLocationState();
    if (!first && !changedArea && CafeGeo.distanceKm(distanceOrigin, point) <= 0.05) return;
    distanceOrigin = point;
    state.distances = Object.create(null);
    CAFES.forEach(function (cafe) { state.distances[cafe.id] = CafeGeo.distanceKm(point, cafe); });
    if (first) {
      state.sort = { key: "distance", dir: "asc" };
      renderTableHeader();
    }
    renderDistanceFilter();
    update({ fit: false });
    if (first) fitUserNearby();
  }

  function beginLocationWatch() {
    if (!aroundMeActive || document.hidden || positionWatch !== null) return;
    var generation = ++positionGeneration;
    function fix(position) {
      if (generation === positionGeneration && aroundMeActive && !document.hidden) receiveLocation(position);
    }
    function error(reason) {
      if (generation !== positionGeneration || !aroundMeActive || document.hidden) return;
      stopAroundMe(reason && reason.code === 1 ? "aroundMe.denied" : "aroundMe.unavailable");
    }
    if (nearOverride !== null) {
      if (typeof nearOverride === "string") error({ code: nearOverride === "denied" ? 1 : 2 });
      else fix({ coords: { latitude: nearOverride.lat, longitude: nearOverride.lng, accuracy: 0 } });
      return;
    }
    try {
      var watch = navigator.geolocation.watchPosition(fix, error, {
        enableHighAccuracy: true, maximumAge: 60000, timeout: 15000,
      });
      if (generation === positionGeneration && aroundMeActive && !document.hidden) positionWatch = watch;
      else navigator.geolocation.clearWatch(watch);
    } catch (ignored) {
      error({ code: 2 });
    }
  }

  function startAroundMe() {
    if (aroundMeActive || !supportsLocation()) return;
    aroundMeActive = true;
    state.aroundMe.enabled = true;
    locationStatus = "aroundMe.locating";
    saveAroundMe();
    renderLocationState();
    beginLocationWatch();
  }

  function autoStartAroundMe() {
    if (!state.aroundMe.enabled || aroundMeActive || !supportsLocation()) return;
    if (nearOverride !== null) {
      startAroundMe();
      return;
    }
    if (!navigator.permissions || typeof navigator.permissions.query !== "function") return;
    var generation = positionGeneration;
    try {
      navigator.permissions.query({ name: "geolocation" }).then(function (permission) {
        if (permission.state === "granted" && generation === positionGeneration && state.aroundMe.enabled) startAroundMe();
      }).catch(function () { /* Without a reliable permission check, wait for a click. */ });
    } catch (ignored) { /* Some browsers do not support this permission name. */ }
  }

  function initializeAroundMe() {
    if (state.aroundMe.radiusKm !== null && AROUND_ME_RADII_KM.indexOf(state.aroundMe.radiusKm) === -1) {
      state.aroundMe.radiusKm = null;
    }
    if (supportsLocation()) map.addControl({
      onAdd: function () {
        var control = document.createElement("div");
        control.className = "maplibregl-ctrl maplibregl-ctrl-group around-me-control";
        locationButton = document.createElement("button");
        locationButton.type = "button";
        locationButton.className = "around-me-button";
        locationButton.setAttribute("data-testid", "button-around-me");
        locationButton.setAttribute("aria-controls", "distanceFilterList");
        locationButton.addEventListener("click", function () {
          if (aroundMeActive) stopAroundMe();
          else startAroundMe();
        });
        control.appendChild(locationButton);
        return control;
      },
      onRemove: function () {
        clearPositionWatch();
        if (userMarker) userMarker.remove();
        userMarker = null;
        aroundMeActive = false;
        if (locationButton) locationButton.parentNode.remove();
        locationButton = null;
      },
    }, "top-right");
    else locationStatus = "aroundMe.unavailable";
    renderLocationState();
    renderDistanceFilter();
    autoStartAroundMe();
  }

  function resumeLocationWatch() {
    if (aroundMeActive) beginLocationWatch();
    else autoStartAroundMe();
  }

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) clearPositionWatch();
    else resumeLocationWatch();
  });
  window.addEventListener("pagehide", clearPositionWatch);
  window.addEventListener("pageshow", resumeLocationWatch);
  if (window.UserPrefs) window.UserPrefs.onChange(function (change) {
    if (!change || change.source !== "storage") return;
    var next = window.UserPrefs.getAroundMe();
    state.aroundMe = { enabled: next.enabled, radiusKm: AROUND_ME_RADII_KM.indexOf(next.radiusKm) === -1 ? null : next.radiusKm };
    if (!next.enabled && aroundMeActive) stopAroundMe("", false);
    else {
      renderDistanceFilter();
      update({ fit: false });
      autoStartAroundMe();
    }
  });

  var labelLayoutFrame = null;

  function canShowMapLabels() {
    var tablet = /iPad|Android(?!.*Mobile)/i.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    var mobile = !tablet && ((navigator.userAgentData && navigator.userAgentData.mobile) ||
      /iPhone|iPod|Android.*Mobile|Windows Phone/i.test(navigator.userAgent));
    // Also cover phones requesting a desktop user agent.
    var smallTouchScreen = window.matchMedia("(pointer: coarse)").matches &&
      Math.min(window.screen.width, window.screen.height) < 600;
    return !mobile && !smallTouchScreen &&
      window.innerWidth >= 768 && window.innerWidth > window.innerHeight;
  }

  function labelRectsOverlap(a, b, gap) {
    return a.left < b.right + gap && a.right + gap > b.left &&
      a.top < b.bottom + gap && a.bottom + gap > b.top;
  }

  function layoutMapLabels() {
    labelLayoutFrame = null;
    var container = map.getContainer();
    var enabled = canShowMapLabels();
    container.classList.toggle("map-labels-enabled", enabled);
    var candidates = [];
    var obstacles = [];
    var bounds = container.getBoundingClientRect();

    Object.keys(markers).forEach(function (id) {
      var marker = markers[id];
      var element = marker.getElement();
      var label = element.querySelector(".cafe-marker-label");
      label.style.visibility = "hidden";
      if (!enabled || element.style.display === "none") return;
      var pinRect = element.getBoundingClientRect();
      if (pinRect.right < bounds.left || pinRect.left > bounds.right ||
          pinRect.bottom < bounds.top || pinRect.top > bounds.bottom) return;
      obstacles.push(pinRect);
      var rect = label.getBoundingClientRect();
      // Do not show names that would be cut off at the map's edge.
      if (rect.left < bounds.left + 4 || rect.right > bounds.right - 4 ||
          rect.top < bounds.top + 4 || rect.bottom > bounds.bottom - 4) return;
      candidates.push({ id: id, label: label, rect: rect });
    });

    if (!enabled) return;
    container.querySelectorAll(".maplibregl-popup, .maplibregl-ctrl").forEach(function (element) {
      obstacles.push(element.getBoundingClientRect());
    });
    // Prefer compact names, using the ID as a stable tie-breaker so labels
    // do not flicker or change priority while panning.
    candidates.sort(function (a, b) {
      return a.rect.width - b.rect.width || a.id.localeCompare(b.id);
    });
    candidates.forEach(function (candidate) {
      if (obstacles.some(function (rect) {
        return labelRectsOverlap(candidate.rect, rect, 5);
      })) return;
      candidate.label.style.visibility = "visible";
      obstacles.push(candidate.rect);
    });
  }

  function scheduleMapLabels() {
    if (labelLayoutFrame === null) {
      labelLayoutFrame = window.requestAnimationFrame(layoutMapLabels);
    }
  }

  map.on("render", scheduleMapLabels);
  map.on("resize", scheduleMapLabels);
  window.addEventListener("resize", scheduleMapLabels);
  if (document.fonts) document.fonts.ready.then(scheduleMapLabels);

  function weekHoursHtml(cafe) {
    return DAYS.map(function (day, index) {
      var periods = cafe.hours[day] || [];
      var isToday = index === now.day;
      return '<li class="' + (isToday ? "is-today" : "") + (periods.length ? "" : " is-closed") + '">' +
        "<span>" + escapeHtml(message("days.long." + day)) + "</span>" +
        '<span class="periods">' + (periods.length ? periodsHtml(periods) : escapeHtml(message("hours.closed"))) + "</span></li>";
    }).join("");
  }

  function hoursBlockHtml(cafe) {
    var status = hoursStatus(cafe);
    var expanded = !!expandedHours[cafe.id];
    var weekId = "hours-week-" + cafe.id;
    var today = periodsOn(cafe, now.day);
    var tomorrow = periodsOn(cafe, now.day + 1);

    return (
      '<div class="hours-block">' +
        '<div class="hours-status">' + statusBadge(status) +
          (cafe.hasHours
            ? '<button type="button" class="hours-toggle" data-cafe-id="' + escapeHtml(cafe.id) + '" aria-expanded="' + expanded + '" aria-controls="' + weekId + '" aria-label="' +
                escapeHtml(message(expanded ? "hours.hideWeek" : "hours.showWeek")) + '" data-testid="button-hours-' + escapeHtml(cafe.id) + '">' + CHEVRON_SVG + "</button>"
            : "") +
        "</div>" +
        '<div class="hours-summary">' +
          '<span class="hours-day-label">' + escapeHtml(message("hours.today")) + "</span>" +
          '<span class="hours-day-text periods">' + (cafe.hasHours
            ? (today.length ? periodsHtml(today) : escapeHtml(message("hours.closedToday")))
            : escapeHtml(message("hours.unknown"))) + "</span>" +
          '<span class="hours-day-label">' + escapeHtml(message("hours.tomorrow")) + "</span>" +
          '<span class="hours-day-text">' + escapeHtml(cafe.hasHours
            ? (tomorrow.length ? formatTime(tomorrow[0].open) : message("hours.closed"))
            : message("hours.unknown")) + "</span>" +
        "</div>" +
        (cafe.hasHours
          ? '<ul class="hours-week" id="' + weekId + '"' + (expanded ? "" : " hidden") + ">" + weekHoursHtml(cafe) + "</ul>"
          : "") +
      "</div>"
    );
  }

  function buildPopupHtml(cafe) {
    var display = cafeText(cafe);
    var keys = selectedCriteriaKeys();
    var tagKeys = keys.length
      ? keys
      : CRITERIA.filter(function (criterion) {
          return !criterion.computed && cafe[criterion.key];
        }).map(function (criterion) { return criterion.key; });
    var tags = tagKeys
      .slice(0, 6)
      .map(function (key) {
        var criterion = CRITERIA.filter(function (item) { return item.key === key; })[0];
        return criterionTextHtml(criterion, "popup-tag");
      })
      .join("");
    var naver = safeUrl(cafe.naverUrl);

    return (
      '<a class="popup-title" href="' + naver + '" target="_blank" rel="noopener">' +
      escapeHtml(display.name) + EXTERNAL_SVG + "</a>" +
      '<div class="popup-kr">' + (secondaryName(cafe) ? escapeHtml(secondaryName(cafe)) + " · " : "") + escapeHtml(regionName(cafe.region)) + "</div>" +
      (state.userLocation ? '<p class="popup-distance">' + escapeHtml(message("aroundMe.fromYou", {
        distance: CafeGeo.formatDistance(state.distances[cafe.id], "en"),
      })) + "</p>" : "") +
      (cafe.size || cafe.price ? '<div class="popup-meta">' + metaPills(cafe) + "</div>" : "") +
      ratingControlHtml(cafe) +
      tagEditorHtml(cafe) +
      hoursBlockHtml(cafe) +
      contactHtml(cafe) +
      '<p class="popup-blurb">' + escapeHtml(display.blurb) + "</p>" +
      (tags ? '<div class="popup-tags">' + tags + "</div>" : "") +
      '<a class="popup-link" href="' + naver + '" target="_blank" rel="noopener">' +
      escapeHtml(message("map.viewNaver")) + EXTERNAL_SVG + "</a>" +
      (cafe.sourceUrl
        ? '<span class="popup-source">' + escapeHtml(message("map.source")) + ' <a href="' + safeUrl(cafe.sourceUrl) + '" target="_blank" rel="noopener">' + escapeHtml(message("map.reference")) + "</a></span>"
        : "")
    );
  }

  /* Personal tags: user text is escaped on every HTML render path. */
  function suggestedTagLabels() {
    var labels = Object.create(null);
    SUGGESTED_TAGS.forEach(function (key) { labels[key] = message("tags.suggested." + key); });
    return labels;
  }

  function tagLabel(tag) {
    return SUGGESTED_TAGS.indexOf(tag) !== -1 ? message("tags.suggested." + tag) : tag;
  }

  function tagTextHtml(tag) {
    return '<span' + (SUGGESTED_TAGS.indexOf(tag) === -1 ? ' translate="no"' : "") + ">" +
      escapeHtml(tagLabel(tag)) + "</span>";
  }

  function tagEditorHtml(cafe) {
    if (!window.UserPrefs) return "";
    var id = escapeHtml(cafe.id);
    var tags = myTags(cafe);
    var folded = tags.map(function (tag) { return tag.toLocaleLowerCase(); });
    var current = tags.map(function (tag) {
      return '<span class="user-tag">' + tagTextHtml(tag) +
        '<button type="button" data-tag-cafe="' + id + '" data-tag-remove="' + escapeHtml(tag) +
        '" aria-label="' + escapeHtml(message("tags.remove", { tag: tagLabel(tag) })) + '">×</button></span>';
    }).join("");
    var suggestions = SUGGESTED_TAGS.filter(function (tag) {
      return folded.indexOf(tag) === -1;
    }).map(function (tag) {
      return '<button type="button" class="user-tag tag-suggestion" data-tag-cafe="' + id +
        '" data-tag-add="' + escapeHtml(tag) + '">+ ' + escapeHtml(tagLabel(tag)) + "</button>";
    }).join("");
    var options = window.UserPrefs.allTags().map(function (entry) {
      return '<option value="' + escapeHtml(tagLabel(entry.tag)) + '"></option>';
    }).join("");
    return '<section class="tag-editor" aria-labelledby="tag-title-' + id + '">' +
      '<h3 id="tag-title-' + id + '">' + escapeHtml(message("tags.title")) + "</h3>" +
      '<div class="user-tags">' + current + '</div><div class="user-tags tag-suggestions">' + suggestions + "</div>" +
      '<form class="tag-form" data-tag-cafe="' + id + '">' +
      '<input type="text" id="tag-input-' + id + '" data-tag-cafe="' + id + '" list="tag-options-' + id +
        '" aria-label="' + escapeHtml(message("tags.add")) + '" placeholder="' + escapeHtml(message("tags.placeholder")) +
        '" aria-describedby="tag-error-' + id + '" autocomplete="off">' +
      '<datalist id="tag-options-' + id + '">' + options + "</datalist>" +
      '<button type="submit" class="personalize-button" data-tag-cafe="' + id + '" data-tag-add="">' +
        escapeHtml(message("tags.add")) + "</button></form>" +
      '<p id="tag-error-' + id + '" class="tag-error" role="alert"></p></section>';
  }

  function tableTagsHtml(cafe) {
    var tags = myTags(cafe);
    return '<div class="user-tags">' + tags.slice(0, 3).map(function (tag) {
      return '<span class="user-tag">' + tagTextHtml(tag) + "</span>";
    }).join("") + (tags.length > 3 ? '<span class="tag-overflow">' +
      escapeHtml(message("tags.more", { count: tags.length - 3 })) + "</span>" : "") + "</div>";
  }

  function renderTagFilters() {
    var group = document.getElementById("tagFilterGroup");
    var list = document.getElementById("tagFilterList");
    var tags = window.UserPrefs ? window.UserPrefs.allTags() : [];
    group.hidden = tags.length === 0;
    list.innerHTML = tags.map(function (entry) {
      var folded = entry.tag.toLocaleLowerCase();
      return '<label class="checkbox-item"><input type="checkbox" data-tag-filter="' + escapeHtml(folded) + '"' +
        (state.tags[folded] ? " checked" : "") + ">" + tagTextHtml(entry.tag) +
        '<span class="tag-count">(' + entry.count + ")</span></label>";
    }).join("");
  }

  function renderTagManagement() {
    var tags = window.UserPrefs ? window.UserPrefs.allTags() : [];
    document.getElementById("personalizeTags").innerHTML = tags.length ? tags.map(function (entry, index) {
      return '<form class="tag-management-row" data-tag-from="' + escapeHtml(entry.tag) + '">' +
        '<div class="tag-management-label">' + tagTextHtml(entry.tag) +
        '<span class="tag-count">' + escapeHtml(message("tags.count", { count: entry.count })) + "</span></div>" +
        '<input type="text" id="tag-rename-' + index + '" value="' + escapeHtml(tagLabel(entry.tag)) +
        '" aria-label="' + escapeHtml(message("tags.renameLabel", { tag: tagLabel(entry.tag) })) +
        '" aria-describedby="personalizeTagError" translate="no">' +
        '<button type="submit" class="personalize-button">' + escapeHtml(message("tags.rename")) + "</button>" +
        '<button type="button" class="link-btn" data-tag-delete="' + escapeHtml(entry.tag) + '" data-tag-count="' + entry.count + '">' +
        escapeHtml(message("tags.delete")) + "</button></form>";
    }).join("") : '<p class="tag-management-hint">' + escapeHtml(message("tags.empty")) + "</p>";
  }

  function tagInputError(value) {
    var clean = typeof value === "string" ? value.normalize("NFC").replace(/\s+/g, " ").trim() : "";
    if (!clean) return message("tags.required");
    return Array.from(clean).length > TAG_MAX_LENGTH ? message("tags.tooLong") : "";
  }

  function restoreTagFocus(id) {
    var input = document.getElementById("tag-input-" + id);
    var fallback = window.matchMedia("(max-width: 900px)").matches && !sidebar.classList.contains("open")
      ? sidebarToggle : document.querySelector("#tagFilterList input") || document.getElementById("resetBtn");
    (input || fallback).focus({ preventScroll: true });
  }

  function editCafeTag(id, value, remove) {
    if (!window.UserPrefs || !Object.prototype.hasOwnProperty.call(cafesById, id)) return;
    var input = document.getElementById("tag-input-" + id);
    var error = document.getElementById("tag-error-" + id);
    var text = value || (input ? input.value : "");
    var problem = remove ? "" : tagInputError(text);
    var normalized = window.UserPrefs.normalizeTag(text, suggestedTagLabels());
    if (!normalized && !problem) problem = message("tags.required");
    var tags = myTags(cafesById[id]);
    var exists = normalized && tags.some(function (tag) {
      return tag.toLocaleLowerCase() === normalized.toLocaleLowerCase();
    });
    if (!remove && !exists && tags.length >= TAG_MAX_PER_CAFE) problem = message("tags.tooMany");
    if (problem) {
      if (error) error.textContent = problem;
      if (input) input.focus({ preventScroll: true });
      return;
    }
    var next = remove ? tags.filter(function (tag) {
      return tag.toLocaleLowerCase() !== normalized.toLocaleLowerCase();
    }) : tags.concat(normalized);
    window.UserPrefs.setTags(id, next, suggestedTagLabels());
    window.UserPrefs.flush();
    // Also refresh a no-op duplicate, clearing the input and any prior error.
    update({ fit: false });
    restoreTagFocus(id);
  }

  document.addEventListener("submit", function (event) {
    var form = event.target;
    if (form.matches(".tag-form")) {
      event.preventDefault();
      editCafeTag(form.getAttribute("data-tag-cafe"), "", false);
    } else if (form.matches(".tag-management-row")) {
      event.preventDefault();
      var from = form.getAttribute("data-tag-from");
      var value = form.querySelector("input").value;
      var problem = tagInputError(value);
      document.getElementById("personalizeTagError").textContent = problem;
      if (problem) return;
      var folded = from.toLocaleLowerCase();
      var renamed = window.UserPrefs.normalizeTag(value, suggestedTagLabels());
      if (state.tags[folded] && renamed) {
        delete state.tags[folded];
        state.tags[renamed.toLocaleLowerCase()] = true;
      }
      window.UserPrefs.renameTag(from, value, suggestedTagLabels());
      window.UserPrefs.flush();
      document.getElementById("personalizeTagStatus").textContent = message("tags.renamed");
      var first = document.querySelector("#personalizeTags input");
      if (first) first.focus();
    }
  });

  document.addEventListener("click", function (event) {
    var button = event.target.closest && event.target.closest("[data-tag-add], [data-tag-remove], [data-tag-delete]");
    if (!button) return;
    if (button.hasAttribute("data-tag-delete")) {
      var tag = button.getAttribute("data-tag-delete");
      if (!window.confirm(message("tags.confirmDelete", {
        tag: tagLabel(tag), count: button.getAttribute("data-tag-count"),
      }))) return;
      window.UserPrefs.deleteTag(tag);
      window.UserPrefs.flush();
      document.getElementById("personalizeTagStatus").textContent = message("tags.deleted");
      document.getElementById("personalizeTagError").textContent = "";
      var next = document.querySelector("#personalizeTags input") || document.getElementById("personalizeSave");
      next.focus();
      return;
    }
    event.preventDefault();
    editCafeTag(button.getAttribute("data-tag-cafe"),
      button.getAttribute("data-tag-remove") || button.getAttribute("data-tag-add"),
      button.hasAttribute("data-tag-remove"));
  });

  var personalTagsSignature = window.UserPrefs
    ? JSON.stringify([CAFES.map(myTags), window.UserPrefs.allTags()]) : "";
  function refreshPersonalTags() {
    var signature = JSON.stringify([CAFES.map(myTags), window.UserPrefs.allTags()]);
    if (signature === personalTagsSignature) return;
    personalTagsSignature = signature;
    var active = document.activeElement;
    var id = active && active.getAttribute("data-tag-cafe");
    var value = id && active.tagName === "INPUT" ? active.value : null;
    var filter = active && active.getAttribute("data-tag-filter");
    var available = window.UserPrefs.allTags().map(function (entry) { return entry.tag.toLocaleLowerCase(); });
    Object.keys(state.tags).forEach(function (tag) {
      if (available.indexOf(tag) === -1) delete state.tags[tag];
    });
    renderTagFilters();
    if (personalizeDialog.open) renderTagManagement();
    update({ fit: false });
    if (id) {
      var input = document.getElementById("tag-input-" + id);
      if (input && value !== null) input.value = value;
      restoreTagFocus(id);
    } else if (filter) {
      var controls = document.querySelectorAll("#tagFilterList input");
      var replacement = Array.from(controls).filter(function (control) {
        return control.getAttribute("data-tag-filter") === filter;
      })[0];
      (replacement || document.getElementById("resetBtn")).focus();
    }
  }

  function starHtml(filled) {
    return '<svg class="rating-star' + (filled ? " is-filled" : "") + '" viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="m12 2.5 2.9 5.9 6.5.9-4.7 4.6 1.1 6.5-5.8-3-5.8 3 1.1-6.5-4.7-4.6 6.5-.9z"/></svg>';
  }

  function ratingControlHtml(cafe) {
    var stars = myRating(cafe);
    var radios = [1, 2, 3, 4, 5].map(function (n) {
      return '<label class="rating-choice"><input type="radio" name="rating-' + escapeHtml(cafe.id) +
        '" id="rating-' + escapeHtml(cafe.id) + "-" + n + '" data-rating-cafe="' + escapeHtml(cafe.id) +
        '" value="' + n + '" aria-label="' + escapeHtml(message("rating.star", { n: n })) + '"' +
        (stars === n ? " checked" : "") + (window.UserPrefs ? "" : " disabled") + ">" + starHtml(stars !== null && n <= stars) + "</label>";
    }).join("");
    return '<fieldset class="rating-control"><legend class="sr-only">' + escapeHtml(message("rating.title")) + "</legend>" +
      '<span class="rating-title" aria-hidden="true">' + escapeHtml(message("rating.title")) + "</span>" +
      '<div class="rating-line"><div class="rating-choices">' + radios + '</div><span class="rating-value">' +
        escapeHtml(stars === null ? message("table.unknown") : message("rating.score", { n: stars })) + "</span></div>" +
      (stars === null ? "" : '<button type="button" class="link-btn rating-clear" data-clear-rating="' + escapeHtml(cafe.id) + '">' +
        escapeHtml(message("rating.clear")) + "</button>") + "</fieldset>";
  }

  function refreshPopup(popup, cafe) {
    popup.setHTML(buildPopupHtml(cafe));
    if (!popup.isOpen()) return;
    var content = popup.getElement().querySelector(".maplibregl-popup-content");
    if (content) content.style.maxHeight = Math.round(map.getContainer().clientHeight * 0.85 - 44) + "px";
    popup.setLngLat([cafe.lng, cafe.lat]);
  }

  function restoreRatingFocus(id, stars) {
    var input = document.getElementById("rating-" + id + "-" + (stars === null ? 1 : stars));
    if (input) {
      input.focus({ preventScroll: true });
      return;
    }
    // A low rating can hide this cafe and close its popup.
    var fallback = window.matchMedia("(max-width: 900px)").matches && !sidebar.classList.contains("open")
      ? sidebarToggle : ratingFilterListEl.querySelector("input:checked");
    if (fallback) fallback.focus();
  }

  function saveCafeRating(id, stars) {
    if (!Object.prototype.hasOwnProperty.call(cafesById, id) ||
        !window.UserPrefs || !window.UserPrefs.setRating(id, stars)) return;
    window.UserPrefs.flush();
    update({ fit: false });
    restoreRatingFocus(id, stars);
  }

  document.addEventListener("change", function (event) {
    var input = event.target;
    if (input.matches && input.matches("input[data-rating-cafe]") && input.checked) {
      saveCafeRating(input.getAttribute("data-rating-cafe"), Number(input.value));
    }
    if (input.matches && input.matches("input[data-tag-filter]")) {
      state.tags[input.getAttribute("data-tag-filter")] = input.checked;
      update();
    }
  });
  document.addEventListener("click", function (event) {
    var button = event.target.closest && event.target.closest("[data-clear-rating]");
    if (button) saveCafeRating(button.getAttribute("data-clear-rating"), null);
  });

  function refreshPersonalRatings(change) {
    if (change.source !== "storage") return;
    var focused = document.activeElement;
    var id = focused && focused.getAttribute("data-rating-cafe");
    var stars = id ? Number(focused.value) : null;
    state.ratingFilter = window.UserPrefs.getRatingFilter();
    renderRatingFilters();
    update({ fit: false });
    if (id) restoreRatingFocus(id, stars);
  }

  // The weekly hours toggle lives inside popup HTML, so use delegation and
  // remember the choice so later re-renders keep it.
  document.addEventListener("click", function (event) {
    var button = event.target.closest && event.target.closest(".hours-toggle");
    if (!button) return;
    var id = button.getAttribute("data-cafe-id");
    expandedHours[id] = !expandedHours[id];
    var list = document.getElementById(button.getAttribute("aria-controls"));
    if (list) list.hidden = !expandedHours[id];
    button.setAttribute("aria-expanded", String(expandedHours[id]));
    button.setAttribute("aria-label", message(expandedHours[id] ? "hours.hideWeek" : "hours.showWeek"));
    // Re-run popup placement now that its height changed.
    var marker = markers[id];
    if (marker && marker.getPopup().isOpen()) marker.getPopup().setLngLat(marker.getLngLat());
    scheduleMapLabels();
  });

  function renderMapLegend() {
    var legend = document.getElementById("mapLegend");
    legend.innerHTML = "";
    window.MAP_PIN_KINDS.forEach(function (kind) {
      var item = document.createElement("li");
      item.className = "map-legend-item";
      item.appendChild(window.createMapPinSymbol(kind));
      var text = document.createElement("span");
      text.textContent = message("map.pinTypes." + kind);
      item.appendChild(text);
      legend.appendChild(item);
    });
  }

  function mapPinTitle(cafe) {
    return cafeText(cafe).name + " · " + message("map.pinTypes." + cafe.kind);
  }

  function createMarkers() {
    CAFES.forEach(function (cafe) {
      var element = document.createElement("div");
      element.className = "cafe-marker";
      element.setAttribute("data-testid", "marker-" + cafe.id);
      element.setAttribute("data-kind", cafe.kind);
      element.appendChild(window.createMapPinSymbol(cafe.kind));
      var label = document.createElement("span");
      label.className = "cafe-marker-label";
      label.textContent = cafeText(cafe).name;
      label.setAttribute("aria-hidden", "true");
      element.appendChild(label);
      element.setAttribute("aria-label", mapPinTitle(cafe));
      element.title = mapPinTitle(cafe);

      var popup = new maplibregl.Popup({ offset: window.mapPinPopupOffset(cafe.kind), maxWidth: "290px", focusAfterOpen: false })
        .setHTML(buildPopupHtml(cafe));
      // Refresh the open/closed state each time the popup opens, and move the
      // marker into the lower part of the map so the popup has room above it.
      popup.on("open", function () {
        refreshPopup(popup, cafe);
        var height = map.getContainer().clientHeight;
        map.easeTo({
          center: [cafe.lng, cafe.lat],
          offset: [0, Math.round(height * 0.35)],
          duration: 500,
        });
        map.once("moveend", function () {
          if (popup.isOpen()) popup.setLngLat([cafe.lng, cafe.lat]);
        });
        scheduleMapLabels();
      });
      popup.on("close", scheduleMapLabels);
      markers[cafe.id] = new maplibregl.Marker({ element: element })
        .setLngLat([cafe.lng, cafe.lat])
        .setPopup(popup)
        .addTo(map);
    });
  }

  function updateMapMarkers(filtered, fit) {
    var visibleIds = {};
    filtered.forEach(function (cafe) {
      visibleIds[cafe.id] = true;
    });

    Object.keys(markers).forEach(function (id) {
      var marker = markers[id];
      var element = marker.getElement();
      element.style.display = visibleIds[id] ? "" : "none";
      if (!visibleIds[id] && marker.getPopup().isOpen()) marker.togglePopup();
      if (visibleIds[id]) {
        var cafe = cafesById[id];
        element.querySelector(".cafe-marker-label").textContent = cafeText(cafe).name;
        element.setAttribute("aria-label", mapPinTitle(cafe));
        element.title = mapPinTitle(cafe);
        element.classList.toggle("is-closed", hoursStatus(cafe).state === "closed");
        refreshPopup(marker.getPopup(), cafe);
      }
    });
    scheduleMapLabels();

    var mapEmpty = document.getElementById("mapEmpty");
    if (filtered.length === 0) {
      document.getElementById("mapEmptyText").textContent = message(CAFES.length ? "map.empty" : "map.noData");
      document.getElementById("mapEmptyReset").hidden = !CAFES.length;
      mapEmpty.hidden = false;
      return;
    }
    mapEmpty.hidden = true;
    if (!fit) return;

    if (filtered.length === 1) {
      map.easeTo({ center: [filtered[0].lng, filtered[0].lat], zoom: 12, duration: 500 });
      return;
    }

    var bounds = new maplibregl.LngLatBounds();
    filtered.forEach(function (cafe) {
      bounds.extend([cafe.lng, cafe.lat]);
    });
    map.fitBounds(bounds, { padding: 56, duration: 500, maxZoom: 12.5 });
  }

  function showOnMap(id) {
    var marker = markers[id];
    if (!marker) return;
    document.getElementById("map").scrollIntoView({ behavior: "smooth", block: "center" });
    map.jumpTo({ zoom: Math.max(map.getZoom(), 12) });
    Object.keys(markers).forEach(function (other) {
      if (other !== id && markers[other].getPopup().isOpen()) markers[other].togglePopup();
    });
    if (!marker.getPopup().isOpen()) marker.togglePopup();
    var cafe = cafesById[id];
    map.easeTo({
      center: [cafe.lng, cafe.lat],
      offset: [0, Math.round(map.getContainer().clientHeight * 0.35)], duration: 500,
    });
  }

  document.addEventListener("click", function (event) {
    var button = event.target.closest && event.target.closest("[data-show-on-map]");
    if (button) {
      var id = button.getAttribute("data-show-on-map");
      showOnMap(id);
      if (button.classList.contains("table-rating")) restoreRatingFocus(id, myRating(cafesById[id]));
    }
  });

  function showOnMapButton(cafe) {
    return '<button type="button" class="pin-btn" data-show-on-map="' + escapeHtml(cafe.id) + '" aria-label="' +
      escapeHtml(message("map.showOnMap")) + '" title="' + escapeHtml(message("map.showOnMap")) +
      '" data-testid="button-show-' + escapeHtml(cafe.id) + '">' + PIN_SVG + "</button>";
  }

  var mapReady = false;
  map.on("load", function () {
    createMarkers();
    mapReady = true;
    updateMapMarkers(CAFES.filter(matchesFilters), !state.userLocation);
    if (pendingLocationFit) fitUserNearby();
  });

  /* ---------------------------------------------------------
   * Comparison table
   * --------------------------------------------------------- */
  var headRow = document.getElementById("tableHeadRow");
  var tableBody = document.getElementById("tableBody");

  function tableColumns() {
    return [
      { key: "name", label: message("table.cafe") },
      { key: "region", label: message("table.area") },
      { key: "size", label: message("table.size") },
      { key: "price", label: message("table.price") },
      { key: "today", label: message("table.today") },
      { key: "myRating", label: message("table.myRating") },
      { key: "myTags", label: message("table.myTags") },
    ].concat(state.userLocation ? [{ key: "distance", label: message("table.distance") }] : []).concat(
      CRITERIA.map(function (criterion) {
        return { key: criterion.key, label: criterionLabel(criterion), title: criterionLabel(criterion), noTranslate: true };
      })
    ).concat([{ key: "match", label: message("table.match") }]);
  }

  function renderTableHeader() {
    headRow.innerHTML = "";
    tableColumns().forEach(function (column) {
      var th = document.createElement("th");
      th.setAttribute("data-sort-key", column.key);
      th.setAttribute("data-testid", "th-" + column.key);
      th.setAttribute("tabindex", "0");
      th.setAttribute("role", "button");
      if (column.noTranslate) {
        th.setAttribute("translate", "no");
        th.classList.add("notranslate");
      }
      if (column.title) th.title = column.title;
      var inner = document.createElement("span");
      inner.className = "th-inner";
      var label = document.createElement("span");
      label.textContent = column.label;
      inner.appendChild(label);
      var arrow = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      arrow.setAttribute("class", "sort-arrow");
      arrow.setAttribute("viewBox", "0 0 24 24");
      arrow.setAttribute("fill", "none");
      arrow.setAttribute("stroke", "currentColor");
      arrow.setAttribute("stroke-width", "2.5");
      arrow.innerHTML = '<path d="M6 9l6 6 6-6"/>';
      inner.appendChild(arrow);
      th.appendChild(inner);
      th.addEventListener("click", function () { setSort(column.key); });
      th.addEventListener("keydown", function (event) {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          setSort(column.key);
        }
      });
      headRow.appendChild(th);
    });
  }

  function setSort(key) {
    if (state.sort.key === key) {
      state.sort.dir = state.sort.dir === "asc" ? "desc" : "asc";
    } else {
      state.sort.key = key;
      state.sort.dir = key === "myRating" || key === "myTags" || key === "match" || COMPUTED_KEYS[key] || !!CRITERIA.filter(function (c) { return c.key === key; }).length ? "desc" : "asc";
    }
    update({ fit: false });
  }

  var STATUS_ORDER = { open: 0, closed: 1, unknown: 2 };
  var SIZE_ORDER = { tiny: 0, medium: 1, large: 2 };

  function sortValue(cafe, key, comparedKeys) {
    if (key === "distance") return state.distances[cafe.id];
    if (key === "myRating") return myRating(cafe);
    if (key === "myTags") return myTags(cafe).length;
    if (key === "match") return matchCount(cafe, comparedKeys);
    if (key === "name") return cafeText(cafe).name.toLocaleLowerCase("en");
    if (key === "region") return regionLabel(cafe.region);
    if (key === "size") return cafe.size ? SIZE_ORDER[cafe.size] : 9;
    if (key === "price") return cafe.price || 9;
    if (key === "today") return STATUS_ORDER[hoursStatus(cafe).state];
    return hasCriterion(cafe, key) ? 1 : 0;
  }

  function compareMyRatings(a, b, direction) {
    if (a === null && b === null) return 0;
    if (a === null) return 1;
    if (b === null) return -1;
    return (a - b) * direction;
  }

  function tableRatingHtml(cafe) {
    var stars = myRating(cafe);
    var label = stars === null ? message("rating.none") : message("rating.label", { n: stars });
    return '<button type="button" class="table-rating" data-show-on-map="' + escapeHtml(cafe.id) +
      '" aria-label="' + escapeHtml(label) + '" title="' + escapeHtml(message("rating.edit", { name: cafeText(cafe).name })) + '">' +
      (stars === null ? escapeHtml(message("table.unknown")) : '<span class="table-rating-stars">' +
        [1, 2, 3, 4, 5].map(function (n) { return starHtml(n <= stars); }).join("") +
        '</span><span aria-hidden="true">' + escapeHtml(message("rating.score", { n: stars })) + "</span>") + "</button>";
  }

  function renderTable(filteredSet) {
    var selectedKeys = selectedCriteriaKeys();
    var comparedKeys = selectedKeys.length ? selectedKeys : allCriteriaKeys();
    var rows = CAFES.slice();
    var direction = state.sort.dir === "asc" ? 1 : -1;
    rows.sort(function (a, b) {
      if (state.sort.key === "myRating") {
        var byRating = compareMyRatings(myRating(a), myRating(b), direction);
        if (byRating) return byRating;
      }
      var aValue = sortValue(a, state.sort.key, comparedKeys);
      var bValue = sortValue(b, state.sort.key, comparedKeys);
      if (aValue < bValue) return -1 * direction;
      if (aValue > bValue) return 1 * direction;
      return cafeText(a).name.localeCompare(cafeText(b).name, "en");
    });

    tableBody.innerHTML = "";
    rows.forEach(function (cafe) {
      var display = cafeText(cafe);
      var status = hoursStatus(cafe);
      var row = document.createElement("tr");
      row.setAttribute("data-testid", "row-cafe-" + cafe.id);
      if (!filteredSet[cafe.id]) row.classList.add("no-match");

      var cells =
        '<td><div class="cell-name-wrap">' + showOnMapButton(cafe) +
          '<div class="cell-name"><a href="' + safeUrl(cafe.naverUrl) + '" target="_blank" rel="noopener" data-testid="link-cafe-' + escapeHtml(cafe.id) + '">' +
          escapeHtml(display.name) + EXTERNAL_SVG + "</a>" + (secondaryName(cafe) ? "<small>" + escapeHtml(secondaryName(cafe)) + "</small>" : "") + "</div></div></td>" +
        '<td><span class="region-pill region-' + cafe.region + '">' + escapeHtml(regionLabel(cafe.region)) + "</span></td>" +
        "<td>" + (cafe.size ? escapeHtml(sizeLabel(cafe.size)) : '<span class="cell-unknown">' + message("table.unknown") + "</span>") + "</td>" +
        '<td class="cell-price">' + (cafe.price ? priceSymbol(cafe.price) : '<span class="cell-unknown">' + message("table.unknown") + "</span>") + "</td>" +
        '<td><div class="cell-today">' + statusBadge(status) + "<small>" + escapeHtml(cafe.hasHours ? todayHoursText(cafe) : "") + "</small></div></td>" +
        "<td>" + tableRatingHtml(cafe) + "</td>" +
        '<td class="cell-user-tags">' + tableTagsHtml(cafe) + "</td>";
      if (state.userLocation) cells += '<td class="cell-distance">' +
        escapeHtml(CafeGeo.formatDistance(state.distances[cafe.id], "en")) + "</td>";

      CRITERIA.forEach(function (criterion) {
        cells += hasCriterion(cafe, criterion.key)
          ? '<td><span class="bool-yes">' + CHECK_SVG + "</span></td>"
          : '<td><span class="bool-no">' + CROSS_SVG + "</span></td>";
      });

      cells += '<td><span class="match-score">' + matchCount(cafe, comparedKeys) + "/" + comparedKeys.length + "</span></td>";
      row.innerHTML = cells;
      tableBody.appendChild(row);
    });

    headRow.querySelectorAll("th").forEach(function (header) {
      var key = header.getAttribute("data-sort-key");
      header.setAttribute(
        "aria-sort",
        key === state.sort.key ? (state.sort.dir === "asc" ? "ascending" : "descending") : "none"
      );
    });
    var tableEmpty = document.getElementById("tableEmpty");
    tableEmpty.textContent = message(CAFES.length ? "table.empty" : "table.noData");
    tableEmpty.hidden = Object.keys(filteredSet).length > 0;
  }

  /* ---------------------------------------------------------
   * Recommendation engine
   * --------------------------------------------------------- */
  var recommendPanel = document.getElementById("recommendPanel");
  var recommendCards = document.getElementById("recommendCards");
  var recommendSub = document.getElementById("recommendSub");

  function recommendationScope() {
    return state.kind !== "All"
      ? message("recommendations.scopeKind", { kind: kindLabel(state.kind) })
      : message("recommendations.scopeAll");
  }

  function renderRecommendations() {
    recommendPanel.hidden = SHOW_RECOMMENDATIONS !== true;
    if (recommendPanel.hidden) {
      recommendCards.innerHTML = "";
      return;
    }

    var selectedKeys = selectedCriteriaKeys();
    var comparedKeys = selectedKeys.length ? selectedKeys : allCriteriaKeys();

    recommendSub.textContent = selectedKeys.length
      ? message("recommendations.selected", { count: selectedKeys.length, scope: recommendationScope() })
      : message("recommendations.none", { scope: recommendationScope() });

    recommendSub.hidden = CAFES.length === 0;
    var pool = CAFES.filter(matchesScope);
    if (pool.length === 0) {
      recommendCards.innerHTML = '<p class="rec-empty">' +
        escapeHtml(message(CAFES.length ? "recommendations.empty" : "recommendations.noData")) + "</p>";
      return;
    }

    var ranked = pool
      .map(function (cafe) {
        return { cafe: cafe, score: matchCount(cafe, comparedKeys) };
      })
      .sort(function (a, b) {
        if (b.score !== a.score) return b.score - a.score;
        return cafeText(a.cafe).name.localeCompare(cafeText(b.cafe).name, "en");
      })
      .slice(0, 3);

    recommendCards.innerHTML = "";
    ranked.forEach(function (item, index) {
      var cafe = item.cafe;
      var display = cafeText(cafe);
      var status = hoursStatus(cafe);
      var tags = comparedKeys
        .map(function (key) {
          var criterion = CRITERIA.filter(function (entry) { return entry.key === key; })[0];
          return criterionTextHtml(criterion, "rec-tag" + (hasCriterion(cafe, key) ? "" : " miss"));
        })
        .join("");

      var card = document.createElement("div");
      card.className = "rec-card" + (index === 0 ? " rank-0" : "");
      card.setAttribute("data-testid", "card-recommendation-" + cafe.id);
      card.innerHTML =
        '<span class="rec-rank">#' + (index + 1) + "</span>" +
        '<div class="rec-head"><a class="rec-name" href="' + safeUrl(cafe.naverUrl) + '" target="_blank" rel="noopener" data-testid="link-recommendation-' + escapeHtml(cafe.id) + '">' +
        escapeHtml(display.name) + '</a><span class="rec-score">' +
        escapeHtml(message("recommendations.score", { score: item.score, total: comparedKeys.length })) + "</span></div>" +
        '<div class="rec-meta"><span class="rec-region">' + escapeHtml(regionName(cafe.region)) + "</span>" + metaPills(cafe) + "</div>" +
        '<div class="rec-hours">' + statusBadge(status) +
          '<span class="rec-hours-text">' + escapeHtml(cafe.hasHours ? todayHoursText(cafe) : "") + "</span>" +
          showOnMapButton(cafe) + "</div>" +
        '<p class="rec-blurb">' + escapeHtml(display.blurb) + "</p>" +
        '<div class="rec-tags">' + tags + "</div>";
      recommendCards.appendChild(card);
    });
  }

  /* ---------------------------------------------------------
   * Results summary and master update
   * --------------------------------------------------------- */
  var resultsSummaryEl = document.getElementById("resultsSummary");

  function renderSummary(filteredCount, hiddenByRating) {
    var count = "<strong>" + filteredCount + "</strong>";
    resultsSummaryEl.innerHTML = state.kind === "All"
      ? message("summary.all", { count: count, total: CAFES.length })
      : message("summary.kind", { count: count, total: CAFES.length, kind: escapeHtml(kindLabel(state.kind)) });
    if (hiddenByRating > 0) {
      resultsSummaryEl.innerHTML += '<span class="summary-rating-hidden"> · ' +
        escapeHtml(message("summary.hiddenByRating", { count: hiddenByRating })) + "</span>";
    }
  }

  function update(options) {
    var fit = !options || options.fit !== false;
    now = koreaNow();
    var filtered = CAFES.filter(matchesFilters);
    var filteredSet = {};
    filtered.forEach(function (cafe) {
      filteredSet[cafe.id] = true;
    });

    var hiddenByRating = state.ratingFilter.minStars === null ? 0 :
      CAFES.filter(function (cafe) { return matchesFilters(cafe, true); }).length - filtered.length;
    renderSummary(filtered.length, hiddenByRating);
    renderTable(filteredSet);
    renderRecommendations();
    if (mapReady) updateMapMarkers(filtered, fit);
    if (window.lucide) lucide.createIcons();
  }

  // Keep "open now" and the status badges current without moving the map.
  var lastClock = now.day + ":" + now.minutes;
  window.setInterval(function () {
    var current = koreaNow();
    var key = current.day + ":" + current.minutes;
    if (key === lastClock) return;
    lastClock = key;
    update({ fit: false });
  }, 30000);

  renderControls();
  renderMapLegend();
  renderTableHeader();
  update();
  if (window.UserPrefs) window.UserPrefs.onChange(refreshPersonalFilters);
  if (window.UserPrefs) window.UserPrefs.onChange(refreshPersonalRatings);
  if (window.UserPrefs) window.UserPrefs.onChange(refreshPersonalTags);
  initializeAroundMe();
})();
