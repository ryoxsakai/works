(function () {
  "use strict";

  var storageKey = "works_admission_view";
  var tabs = Array.prototype.slice.call(document.querySelectorAll("[data-admission-view-tab]"));
  var views = Array.prototype.slice.call(document.querySelectorAll("[data-admission-view]"));

  function activateView(viewName) {
    var exists = tabs.some(function (tab) {
      return tab.dataset.admissionViewTab === viewName;
    });
    var active = exists ? viewName : "list";

    tabs.forEach(function (tab) {
      var selected = tab.dataset.admissionViewTab === active;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });

    views.forEach(function (view) {
      view.hidden = view.dataset.admissionView !== active;
    });

    localStorage.setItem(storageKey, active);
  }

  tabs.forEach(function (tab) {
    tab.addEventListener("click", function () {
      activateView(tab.dataset.admissionViewTab);
    });

    tab.addEventListener("keydown", function (event) {
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      event.preventDefault();
      var index = tabs.indexOf(tab);
      var next = event.key === "ArrowRight"
        ? (index + 1) % tabs.length
        : (index - 1 + tabs.length) % tabs.length;
      tabs[next].focus();
      activateView(tabs[next].dataset.admissionViewTab);
    });
  });

  activateView(localStorage.getItem(storageKey) || "list");
}());