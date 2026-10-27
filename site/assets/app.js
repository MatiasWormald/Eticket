(function () {
  "use strict";

  var config = window.ETICKET_CONFIG || {};
  var glpiUrl = (config.glpiUrl || "").replace(/\/+$/, "");

  if (glpiUrl) {
    document.querySelectorAll("[data-glpi-path]").forEach(function (link) {
      link.setAttribute("href", glpiUrl + link.getAttribute("data-glpi-path"));
    });
  }

  var toggle = document.querySelector(".nav-toggle");
  var nav = document.getElementById("main-nav");

  if (toggle && nav) {
    toggle.addEventListener("click", function () {
      var isOpen = nav.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", String(isOpen));
    });

    nav.addEventListener("click", function (event) {
      if (event.target.tagName === "A") {
        nav.classList.remove("is-open");
        toggle.setAttribute("aria-expanded", "false");
      }
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && nav.classList.contains("is-open")) {
        nav.classList.remove("is-open");
        toggle.setAttribute("aria-expanded", "false");
        toggle.focus();
      }
    });
  }

  document.querySelectorAll("[data-year]").forEach(function (node) {
    node.textContent = String(new Date().getFullYear());
  });

  var search = document.getElementById("help-search");
  if (search) {
    var targets = document.querySelectorAll(".service-card, .faq-list details");
    function normalize(value) {
      return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    }
    search.addEventListener("input", function () {
      var query = normalize(search.value.trim());
      var count = 0;
      targets.forEach(function (item) {
        var matches = normalize(item.textContent).indexOf(query) !== -1;
        item.hidden = !matches;
        if (matches) count++;
      });
      var status = document.getElementById("search-status");
      if (status) status.textContent = query ? count + " resultados" : "";
    });
  }
})();
