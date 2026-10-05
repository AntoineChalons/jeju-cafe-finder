(function () {
  "use strict";

  /* ---------------------------------------------------------
   * Localization
   * --------------------------------------------------------- */
  var root = document.documentElement;
  var SUPPORTED_LOCALES = ["en", "ko"];
  var LOCALE_NAMES = { en: "English", ko: "한국어" };
  var LOCALE_CODES = { en: "EN", ko: "한" };

  function isSupportedLocale(locale) {
    return SUPPORTED_LOCALES.indexOf(locale) !== -1;
  }

  function browserLocale() {
    var languages = window.navigator.languages && window.navigator.languages.length
      ? window.navigator.languages
      : [window.navigator.language || "en"];

    for (var i = 0; i < languages.length; i += 1) {
      var language = String(languages[i]).toLowerCase();
      if (language.indexOf("ko") === 0) return "ko";
      if (language.indexOf("en") === 0) return "en";
    }
    return "en";
  }

  function initialLocale() {
    var requested = new URLSearchParams(window.location.search).get("lang");
    return isSupportedLocale(requested) ? requested : browserLocale();
  }

  var currentLocale = initialLocale();

  function message(key, values) {
    var parts = key.split(".");
    var value = APP_TRANSLATIONS[currentLocale] || APP_TRANSLATIONS.en;
    var fallback = APP_TRANSLATIONS.en;

    parts.forEach(function (part) {
      value = value && value[part];
      fallback = fallback && fallback[part];
    });

    var text = typeof value === "string" ? value : fallback;
    if (typeof text !== "string") return key;

    return text.replace(/\{(\w+)\}/g, function (_, token) {
      return values && values[token] !== undefined ? values[token] : "{" + token + "}";
    });
  }

  function criterionLabel(criterion) {
    return message("criteria." + criterion.key, { time: EARLY_OPENING });
  }

  function shortCriterionLabel(criterion) {
    return message("criteriaShort." + criterion.key);
  }

  function regionLabel(region) {
    return message("regions." + region);
  }

  function regionName(region) {
    return message("regionName", { region: regionLabel(region) });
  }

  function sizeLabel(size) {
    return size ? message("sizes." + size) : "";
  }

  function priceSymbol(price) {
    return price ? new Array(price + 1).join("$") : "";
  }

  function cafeText(cafe) {
    var translations = CAFE_TRANSLATIONS[cafe.id] || {};
    var localized = translations[currentLocale] || {};
    return {
      name: localized.name || (currentLocale === "ko" ? cafe.nameKr : cafe.name),
      blurb: localized.blurb || cafe.blurb,
      hoursNote: currentLocale === "en" ? cafe.hoursNote : (localized.hoursNote || cafe.hoursNote),
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
    root.lang = currentLocale;
    document.title = message("meta.title");
    document.querySelector('meta[name="description"]').setAttribute("content", message("meta.description"));
    document.getElementById("brandSub").setAttribute("data-i18n", brandSubtitleKey());

    document.querySelectorAll("[data-i18n]").forEach(function (element) {
      element.textContent = message(element.getAttribute("data-i18n"), values);
    });
    document.querySelectorAll("[data-i18n-aria-label]").forEach(function (element) {
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
    if (key === "openEarly") {
      return DAYS.some(function (day) {
        return (cafe.hours[day] || []).some(function (period) {
          return period.open <= EARLY_MINUTES;
        });
      });
    }
    if (key === "openSunday") return (cafe.hours.sun || []).length > 0;
    return false;
  }

  var COMPUTED_KEYS = {};
  CRITERIA.forEach(function (criterion) {
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

  function getInitialTheme() {
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }

  var currentTheme = getInitialTheme();

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

  /* ---------------------------------------------------------
   * Language menu
   * --------------------------------------------------------- */
  var languageToggle = document.getElementById("languageToggle");
  var languageMenu = document.getElementById("languageMenu");
  var languageCode = document.getElementById("languageCode");

  function setLanguageMenu(open) {
    languageMenu.hidden = !open;
    languageToggle.setAttribute("aria-expanded", String(open));
  }

  function renderLanguagePicker() {
    languageCode.textContent = LOCALE_CODES[currentLocale];
    languageToggle.setAttribute(
      "aria-label",
      message("language.current", { language: LOCALE_NAMES[currentLocale] })
    );
    languageMenu.setAttribute("aria-label", message("language.choose"));
    languageMenu.querySelectorAll("[data-language]").forEach(function (button) {
      var active = button.getAttribute("data-language") === currentLocale;
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
  }

  function updateLanguageUrl() {
    var url = new URL(window.location.href);
    url.searchParams.set("lang", currentLocale);
    window.history.replaceState({}, "", url);
  }

  languageToggle.addEventListener("click", function () {
    setLanguageMenu(languageMenu.hidden);
  });

  languageMenu.querySelectorAll("[data-language]").forEach(function (button) {
    button.addEventListener("click", function () {
      var locale = button.getAttribute("data-language");
      if (!isSupportedLocale(locale)) return;
      currentLocale = locale;
      updateLanguageUrl();
      applyStaticTranslations();
      renderThemeToggle();
      renderLanguagePicker();
      renderControls();
      renderLegend();
      renderTableHeader();
      update({ fit: false });
      setLanguageMenu(false);
      languageToggle.focus();
    });
  });

  document.addEventListener("click", function (event) {
    if (!languageMenu.hidden && !languageMenu.parentElement.contains(event.target)) {
      setLanguageMenu(false);
    }
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && !languageMenu.hidden) {
      setLanguageMenu(false);
      languageToggle.focus();
    }
  });

  applyStaticTranslations();
  applyTheme();
  renderLanguagePicker();

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
    region: "All",
    criteria: {},
    sizes: {},
    prices: {},
    sort: { key: "name", dir: "asc" },
  };

  function clearFilters() {
    state.region = "All";
    CRITERIA.forEach(function (criterion) {
      state.criteria[criterion.key] = false;
    });
    SIZES.forEach(function (size) { state.sizes[size] = false; });
    PRICES.forEach(function (price) { state.prices[price] = false; });
  }
  clearFilters();

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

  // Area, size and price narrow the pool; criteria are "must have".
  function matchesScope(cafe) {
    if (state.region !== "All" && cafe.region !== state.region) return false;
    var sizes = selectedValues(state.sizes);
    if (sizes.length && sizes.indexOf(cafe.size) === -1) return false;
    var prices = selectedValues(state.prices);
    if (prices.length && prices.indexOf(String(cafe.price)) === -1) return false;
    return true;
  }

  function matchesFilters(cafe) {
    if (!matchesScope(cafe)) return false;
    return selectedCriteriaKeys().every(function (key) {
      return hasCriterion(cafe, key);
    });
  }

  function matchCount(cafe, keys) {
    return keys.filter(function (key) {
      return hasCriterion(cafe, key);
    }).length;
  }

  /* ---------------------------------------------------------
   * Filter controls
   * --------------------------------------------------------- */
  var regionListEl = document.getElementById("regionList");
  var criteriaListEl = document.getElementById("criteriaList");
  var sizeListEl = document.getElementById("sizeList");
  var priceListEl = document.getElementById("priceList");

  function renderRegions() {
    regionListEl.innerHTML = "";
    ["All"].concat(REGIONS).forEach(function (region) {
      var label = document.createElement("label");
      label.className = "radio-chip";
      label.innerHTML =
        '<input type="radio" name="region" value="' + region + '" data-testid="radio-region-' + region.toLowerCase() + '" />' +
        "<span>" + escapeHtml(regionLabel(region)) + "</span>";
      var input = label.querySelector("input");
      input.checked = state.region === region;
      input.addEventListener("change", function () {
        if (input.checked) {
          state.region = region;
          update();
        }
      });
      regionListEl.appendChild(label);
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
        '<span class="crit-label">' + escapeHtml(criterionLabel(criterion)) + "</span>";
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
    renderRegions();
    renderCriteria();
    renderToggleChips(sizeListEl, SIZES, state.sizes, sizeLabel, function (size) {
      return message("sizes." + size + "Hint");
    }, "toggle-size-");
    renderToggleChips(priceListEl, PRICES, state.prices, priceSymbol, function (price) {
      return message("prices." + price);
    }, "toggle-price-");
  }

  document.getElementById("resetBtn").addEventListener("click", resetFilters);
  document.getElementById("mapEmptyReset").addEventListener("click", resetFilters);

  function resetFilters() {
    clearFilters();
    renderControls();
    update();
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
   * Map legend and map
   * --------------------------------------------------------- */
  var REGION_COLORS = {
    North: "#5C7A42",
    East: "#C08A12",
    South: "#C13E22",
    West: "#8A6842",
  };
  var legendEl = document.getElementById("mapLegend");

  function renderLegend() {
    legendEl.innerHTML = "";
    REGIONS.forEach(function (region) {
      var item = document.createElement("span");
      item.className = "legend-item";
      item.innerHTML =
        '<span class="legend-dot" style="background:' + REGION_COLORS[region] + '"></span>' +
        escapeHtml(regionLabel(region));
      legendEl.appendChild(item);
    });
    var closed = document.createElement("span");
    closed.className = "legend-item";
    closed.innerHTML = '<span class="legend-dot legend-closed"></span>' + escapeHtml(message("map.closedLegend"));
    legendEl.appendChild(closed);
  }

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
    var display = cafeText(cafe);
    var expanded = !!expandedHours[cafe.id];
    var weekId = "hours-week-" + cafe.id;
    var footer = [];
    if (display.hoursNote) footer.push('<p class="hours-note">' + escapeHtml(display.hoursNote) + "</p>");
    footer.push(
      '<p class="hours-checked">' +
        escapeHtml(message("hours.timeZone")) +
        (cafe.hoursChecked ? " · " + escapeHtml(message("hours.checked", { date: cafe.hoursChecked })) : "") +
      "</p>"
    );

    return (
      '<div class="hours-block">' +
        '<div class="hours-status">' + statusBadge(status) +
          (status.detail ? '<span class="hours-detail">' + escapeHtml(status.detail) + "</span>" : "") +
        "</div>" +
        (cafe.hasHours
          ? '<div class="hours-today">' +
              '<span class="hours-today-label">' + escapeHtml(message("hours.today")) + "</span>" +
              '<span class="hours-today-text periods">' + (periodsOn(cafe, now.day).length ? periodsHtml(periodsOn(cafe, now.day)) : escapeHtml(message("hours.closedToday"))) + "</span>" +
              '<button type="button" class="hours-toggle" data-cafe-id="' + escapeHtml(cafe.id) + '" aria-expanded="' + expanded + '" aria-controls="' + weekId + '" aria-label="' +
                escapeHtml(message(expanded ? "hours.hideWeek" : "hours.showWeek")) + '" data-testid="button-hours-' + escapeHtml(cafe.id) + '">' + CHEVRON_SVG + "</button>" +
            "</div>" +
            '<ul class="hours-week" id="' + weekId + '"' + (expanded ? "" : " hidden") + ">" + weekHoursHtml(cafe) + "</ul>"
          : "") +
        footer.join("") +
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
        return '<span class="popup-tag">' + escapeHtml(criterionLabel(criterion)) + "</span>";
      })
      .join("");
    var naver = safeUrl(cafe.naverUrl);

    return (
      '<a class="popup-title" href="' + naver + '" target="_blank" rel="noopener">' +
      escapeHtml(display.name) + EXTERNAL_SVG + "</a>" +
      '<div class="popup-kr">' + (secondaryName(cafe) ? escapeHtml(secondaryName(cafe)) + " · " : "") + escapeHtml(regionName(cafe.region)) + "</div>" +
      (cafe.size || cafe.price ? '<div class="popup-meta">' + metaPills(cafe) + "</div>" : "") +
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
  });

  function createMarkers() {
    CAFES.forEach(function (cafe) {
      var element = document.createElement("div");
      element.className = "cafe-marker";
      element.style.background = REGION_COLORS[cafe.region] || "#C13E22";
      element.setAttribute("data-testid", "marker-" + cafe.id);

      var popup = new maplibregl.Popup({ offset: 14, maxWidth: "290px", focusAfterOpen: false })
        .setHTML(buildPopupHtml(cafe));
      // Refresh the open/closed state each time the popup opens, and move the
      // marker into the lower part of the map so the popup has room above it.
      popup.on("open", function () {
        popup.setHTML(buildPopupHtml(cafe));
        var height = map.getContainer().clientHeight;
        var content = popup.getElement() && popup.getElement().querySelector(".maplibregl-popup-content");
        if (content) content.style.maxHeight = Math.round(height * 0.85 - 44) + "px";
        map.easeTo({
          center: [cafe.lng, cafe.lat],
          offset: [0, Math.round(height * 0.35)],
          duration: 500,
        });
        map.once("moveend", function () {
          if (popup.isOpen()) popup.setLngLat([cafe.lng, cafe.lat]);
        });
      });
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
        element.classList.toggle("is-closed", hoursStatus(cafe).state === "closed");
        marker.getPopup().setHTML(buildPopupHtml(cafe));
      }
    });

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
  }

  document.addEventListener("click", function (event) {
    var button = event.target.closest && event.target.closest("[data-show-on-map]");
    if (button) showOnMap(button.getAttribute("data-show-on-map"));
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
    updateMapMarkers(CAFES.filter(matchesFilters), true);
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
    ].concat(
      CRITERIA.map(function (criterion) {
        return { key: criterion.key, label: shortCriterionLabel(criterion), title: criterionLabel(criterion) };
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
      state.sort.dir = key === "match" || COMPUTED_KEYS[key] || !!CRITERIA.filter(function (c) { return c.key === key; }).length ? "desc" : "asc";
    }
    update({ fit: false });
  }

  var STATUS_ORDER = { open: 0, closed: 1, unknown: 2 };
  var SIZE_ORDER = { tiny: 0, medium: 1, large: 2 };

  function sortValue(cafe, key, comparedKeys) {
    if (key === "match") return matchCount(cafe, comparedKeys);
    if (key === "name") return cafeText(cafe).name.toLocaleLowerCase(currentLocale);
    if (key === "region") return regionLabel(cafe.region);
    if (key === "size") return cafe.size ? SIZE_ORDER[cafe.size] : 9;
    if (key === "price") return cafe.price || 9;
    if (key === "today") return STATUS_ORDER[hoursStatus(cafe).state];
    return hasCriterion(cafe, key) ? 1 : 0;
  }

  function renderTable(filteredSet) {
    var selectedKeys = selectedCriteriaKeys();
    var comparedKeys = selectedKeys.length ? selectedKeys : allCriteriaKeys();
    var rows = CAFES.slice();
    var direction = state.sort.dir === "asc" ? 1 : -1;
    rows.sort(function (a, b) {
      var aValue = sortValue(a, state.sort.key, comparedKeys);
      var bValue = sortValue(b, state.sort.key, comparedKeys);
      if (aValue < bValue) return -1 * direction;
      if (aValue > bValue) return 1 * direction;
      return cafeText(a).name.localeCompare(cafeText(b).name, currentLocale);
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
        '<td><div class="cell-today">' + statusBadge(status) + "<small>" + escapeHtml(cafe.hasHours ? todayHoursText(cafe) : "") + "</small></div></td>";

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
    return state.region !== "All"
      ? message("recommendations.scopeRegion", { region: regionName(state.region) })
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
        return cafeText(a.cafe).name.localeCompare(cafeText(b.cafe).name, currentLocale);
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
          return '<span class="rec-tag' + (hasCriterion(cafe, key) ? "" : " miss") + '">' +
            escapeHtml(criterionLabel(criterion)) + "</span>";
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

  function renderSummary(filteredCount) {
    var count = "<strong>" + filteredCount + "</strong>";
    resultsSummaryEl.innerHTML = state.region === "All"
      ? message("summary.all", { count: count, total: CAFES.length })
      : message("summary.region", { count: count, total: CAFES.length, region: escapeHtml(regionName(state.region)) });
  }

  function update(options) {
    var fit = !options || options.fit !== false;
    now = koreaNow();
    var filtered = CAFES.filter(matchesFilters);
    var filteredSet = {};
    filtered.forEach(function (cafe) {
      filteredSet[cafe.id] = true;
    });

    renderSummary(filtered.length);
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
  renderLegend();
  renderTableHeader();
  update();
})();
