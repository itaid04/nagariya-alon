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
  // אין עדיין חיבור לשרת/n8n, לכן מוצג מצב הצלחה מקומי בלבד.
  // כשמתחברים ל-n8n: להחליף את ה-preventDefault בשליחת fetch/POST אמיתית ל-webhook.
  var form = document.getElementById("lead-form");
  var success = document.getElementById("form-success");
  if (form && success) {
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      if (!form.reportValidity()) return;
      form.hidden = true;
      success.hidden = false;
      success.focus({ preventScroll: false });
    });
  }

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
