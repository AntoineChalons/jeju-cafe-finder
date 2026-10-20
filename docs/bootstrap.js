(function () {
  "use strict";

  // Capture currentScript now: it is null after the asynchronous database load.
  // app.js must use the same revision as the HTML/dependencies, not a cached
  // pre-kind bundle that still looks for the removed regionList element.
  var assetVersion = document.currentScript
    ? new URL(document.currentScript.src, document.baseURI).searchParams.get("v")
    : null;

  function showPrefsNotice(status) {
    var notice = document.getElementById("prefsNotice");
    if (!notice) return;
    notice.textContent = "";
    notice.hidden = ["unavailable", "corrupt", "newer"].indexOf(status) === -1;
    if (notice.hidden) return;
    var strings = APP_TRANSLATIONS.en.prefs;
    var text = document.createElement("span");
    text.textContent = strings[status];
    var dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.className = "link-btn prefs-notice-dismiss";
    dismiss.textContent = strings.dismiss;
    dismiss.addEventListener("click", function () { notice.hidden = true; });
    notice.appendChild(text);
    notice.appendChild(dismiss);
  }

  // Unlike display config, bad personal data must never block startup.
  if (window.UserPrefs) {
    try {
      showPrefsNotice(window.UserPrefs.load().status);
      window.UserPrefs.onChange(function (change) {
        if (change.source === "save-failed" || change.source === "storage") {
          showPrefsNotice(window.UserPrefs.getStatus());
        }
      });
    } catch (error) {
      console.warn("[UserPrefs] Cannot load personal settings:", error);
      showPrefsNotice("unavailable");
    }
  }

  function showLoadError(error) {
    var alert = document.createElement("div");
    alert.className = "data-load-error";
    alert.setAttribute("role", "alert");
    alert.textContent = APP_TRANSLATIONS.en.errors.load;
    document.body.prepend(alert);
    console.error(error);
  }

  function loadApplicationScript() {
    return new Promise(function (resolve, reject) {
      var script = document.createElement("script");
      script.src = "app.js" + (assetVersion ? "?v=" + encodeURIComponent(assetVersion) : "");
      script.onload = resolve;
      script.onerror = function () {
        reject(new Error("Cannot load app.js."));
      };
      document.body.appendChild(script);
    });
  }

  Promise.all([window.loadCafeDatabase(), window.loadCafeFilters(), window.loadMapPins()])
    .then(function (results) {
      var data = results[0];
      window.CAFES = data.cafes;
      return loadApplicationScript();
    })
    .catch(showLoadError);
})();
