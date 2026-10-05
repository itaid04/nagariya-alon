(function () {
  // ---------- מעטפת הפאנל: סרגל צד ומסכים נפרדים ----------
  // כל כלי (קבלות / מסמכים לעוזר) הוא מסך נפרד, ורק אחד מוצג בכל רגע.
  // המסך הפעיל נשמר בכתובת (#receipts / #bot-docs), כך שרענון או קישור
  // ישיר נוחתים על אותו מסך.
  var SESSION_KEY = "alon-admin-unlocked";
  var DEFAULT_VIEW = "receipts";

  var content = document.getElementById("admin-content");
  var contentArea = content.querySelector(".admin-content-area");
  var views = Array.prototype.slice.call(document.querySelectorAll(".admin-view"));
  var navLinks = Array.prototype.slice.call(document.querySelectorAll(".admin-nav-link"));
  var logoutBtn = document.getElementById("admin-logout");

  var viewFromHash = function () {
    var name = (window.location.hash || "").replace("#", "");
    var exists = views.some(function (v) { return v.getAttribute("data-view") === name; });
    return exists ? name : DEFAULT_VIEW;
  };

  var showView = function (name) {
    views.forEach(function (view) {
      view.hidden = view.getAttribute("data-view") !== name;
    });
    navLinks.forEach(function (link) {
      var active = link.getAttribute("data-view") === name;
      link.classList.toggle("is-active", active);
      if (active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
    // כל מסך מתחיל מלמעלה - גם במחשב (שם רק אזור התוכן נגלל) וגם בטלפון
    contentArea.scrollTop = 0;
    window.scrollTo(0, 0);
  };

  window.addEventListener("hashchange", function () { showView(viewFromHash()); });
  showView(viewFromHash());

  // כפתור היציאה מופיע רק כשהאזור פתוח
  var syncLogout = function () { logoutBtn.hidden = content.hidden; };
  document.addEventListener("admin-unlocked", syncLogout);
  syncLogout();

  logoutBtn.addEventListener("click", function () {
    if (window.sessionStorage) sessionStorage.removeItem(SESSION_KEY);
    window.location.hash = "";
    window.location.reload();
  });
})();
