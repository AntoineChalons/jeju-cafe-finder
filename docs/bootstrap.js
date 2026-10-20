(function () {
  "use strict";

  // Capture currentScript now: it is null after the asynchronous database load.
  // app.js must use the same revision as the HTML/dependencies, not a cached
  // pre-kind bundle that still looks for the removed regionList element.
  var assetVersion = document.currentScript
    ? new URL(document.currentScript.src, document.baseURI).searchParams.get("v")
    : null;

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
