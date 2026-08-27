(function () {
  // ---------- תפריט ניווט נייד ----------
  var navBtn = document.getElementById("nav-toggle-btn");
  var mobileNav = document.getElementById("mobile-nav");
  if (navBtn && mobileNav) {
    var closeNav = function () {
      mobileNav.classList.remove("is-open");
      navBtn.setAttribute("aria-expanded", "false");
    };
    navBtn.addEventListener("click", function () {
      var open = mobileNav.classList.toggle("is-open");
      navBtn.setAttribute("aria-expanded", String(open));
    });
    mobileNav.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", closeNav);
    });
  }

  // ---------- טופס לידים ----------
  var LEAD_WEBHOOK_URL = "https://itaid04.app.n8n.cloud/webhook/nagariya-alon-lead-form";
  var form = document.getElementById("lead-form");
  var success = document.getElementById("form-success");
  var errorBox = document.getElementById("form-error");
  var submitBtn = document.getElementById("lead-submit-btn");
  if (form && success) {
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      if (!form.reportValidity()) return;

      if (errorBox) errorBox.hidden = true;
      submitBtn.disabled = true;
      submitBtn.textContent = "שולחים...";

      var payload = {
        name: form.name.value.trim(),
        phone: form.phone.value.trim(),
        email: form.email.value.trim(),
        service: form.service.value,
        preferred_time: form.preferred_time.value,
        message: form.message.value.trim()
      };

      fetch(LEAD_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      })
        .then(function (res) {
          if (!res.ok) throw new Error("webhook responded with " + res.status);
          return res.json().catch(function () { return {}; });
        })
        .then(function (data) {
          if (data && data.message) {
            success.querySelector("p").textContent = data.message;
          }
          form.hidden = true;
          success.hidden = false;
          success.focus({ preventScroll: false });
        })
        .catch(function () {
          submitBtn.disabled = false;
          submitBtn.textContent = "שליחת פרטים";
          if (errorBox) errorBox.hidden = false;
        });
    });
  }

  // ---------- גלילה חלקה בלחיצה על קישורים פנימיים ----------
  // מכוונת רק ידנית ל-JS (ולא scroll-behavior:smooth על ה-html), כדי
  // שגלילת מגע טבעית באצבע לא תתנגש עם אנימציית הגלילה של הדפדפן
  var prefersReducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.querySelectorAll('a[href^="#"]').forEach(function (link) {
    link.addEventListener("click", function (event) {
      var id = link.getAttribute("href");
      if (!id || id.length < 2) return;
      var target = document.querySelector(id);
      if (!target) return;
      event.preventDefault();
      target.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "start" });
    });
  });

  // ---------- חשיפה בגלילה ----------
  var revealEls = document.querySelectorAll(".reveal");
  if (revealEls.length && "IntersectionObserver" in window) {
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("in-view");
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15 }
    );
    revealEls.forEach(function (el) { io.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add("in-view"); });
  }
})();
