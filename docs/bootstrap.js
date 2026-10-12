(function () {
  "use strict";

  function showLoadError(error) {
    var alert = document.createElement("div");
    alert.className = "data-load-error";
    alert.setAttribute("role", "alert");
    var korean = /^ko\b/i.test(new URLSearchParams(window.location.search).get("lang") || navigator.language || "");
    alert.textContent = korean
      ? "카페 데이터 또는 필터 설정을 불러올 수 없습니다. 새로고침하거나 잠시 후 다시 시도해 주세요."
      : "Cafe data or filter configuration is not available. Refresh the page or try again later.";
    document.body.prepend(alert);
    console.error(error);
  }

  function loadApplicationScript() {
    return new Promise(function (resolve, reject) {
      var script = document.createElement("script");
      script.src = "app.js";
      script.onload = resolve;
      script.onerror = function () {
        reject(new Error("Cannot load app.js."));
      };
      document.body.appendChild(script);
    });
  }

  Promise.all([window.loadCafeDatabase(), window.loadCafeFilters()])
    .then(function (results) {
      var data = results[0];
      window.CAFES = data.cafes;
      window.CAFE_TRANSLATIONS = data.translations;
      return loadApplicationScript();
    })
    .catch(showLoadError);
})();
