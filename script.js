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
      // בדסקטופ (מ-960px) הטופס והתמונה יושבים זה לצד זה, אז יש מקום
      // להראות גם את כותרת "יצירת קשר" מעל הטופס; רק במובייל (שם הטופס
      // מוצג ראשון, לפני התמונה) יש קפיצה ישירה לשדות עצמם
      if (id === "#lead-panel" && window.matchMedia && window.matchMedia("(min-width: 960px)").matches) {
        id = "#contact";
      }
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

  // ---------- צ'אט עם העוזר הדיגיטלי ----------
  var CHAT_WEBHOOK_URL = "https://itaid04.app.n8n.cloud/webhook/nagariya-alon-agent-chat";
  var chatWidget = document.getElementById("chat-widget");
  var chatToggle = document.getElementById("chat-toggle");
  var chatPanel = document.getElementById("chat-panel");
  var chatClose = document.getElementById("chat-close");
  var chatMessages = document.getElementById("chat-messages");
  var chatForm = document.getElementById("chat-form");
  var chatInput = document.getElementById("chat-input");
  var chatSendBtn = chatForm ? chatForm.querySelector(".chat-send") : null;
  var chatTeaser = document.getElementById("chat-teaser");
  var chatTeaserClose = document.getElementById("chat-teaser-close");

  if (chatWidget && chatToggle && chatPanel && chatForm && chatInput && chatMessages) {
    var chatGreeted = false;
    var chatSending = false;

    var getSessionId = function () {
      var key = "alon-chat-session-id";
      var existing = window.sessionStorage ? sessionStorage.getItem(key) : null;
      if (existing) return existing;
      var id = (window.crypto && crypto.randomUUID)
        ? crypto.randomUUID()
        : ("s-" + Date.now() + "-" + Math.random().toString(16).slice(2));
      if (window.sessionStorage) sessionStorage.setItem(key, id);
      return id;
    };
    var chatSessionId = getSessionId();

    var addMessage = function (text, from) {
      var row = document.createElement("div");
      row.className = "chat-msg " + from;
      var bubble = document.createElement("div");
      bubble.className = "chat-bubble";
      bubble.textContent = text;
      row.appendChild(bubble);
      chatMessages.appendChild(row);
      chatMessages.scrollTop = chatMessages.scrollHeight;
    };

    var showTyping = function () {
      var row = document.createElement("div");
      row.className = "chat-msg bot";
      row.id = "chat-typing-row";
      var bubble = document.createElement("div");
      bubble.className = "chat-bubble chat-typing-dots";
      bubble.innerHTML = "<span></span><span></span><span></span>";
      row.appendChild(bubble);
      chatMessages.appendChild(row);
      chatMessages.scrollTop = chatMessages.scrollHeight;
    };

    var hideTyping = function () {
      var row = document.getElementById("chat-typing-row");
      if (row) row.remove();
    };

    var dismissTeaser = function () {
      if (!chatTeaser) return;
      chatTeaser.hidden = true;
      if (window.sessionStorage) sessionStorage.setItem("alon-chat-teaser-shown", "1");
    };

    var openChat = function () {
      chatPanel.hidden = false;
      chatWidget.classList.add("is-open");
      chatToggle.setAttribute("aria-expanded", "true");
      dismissTeaser();
      if (!chatGreeted) {
        chatGreeted = true;
        addMessage(
          "היי! אני העוזר הדיגיטלי של אלון. אפשר לשאול אותי על סוגי העבודה, החומרים או תהליך העבודה - ואם תרצו, אני יכול גם להשאיר לאלון את הפרטים שלכם.",
          "bot"
        );
      }
      chatInput.focus();
    };

    var closeChat = function () {
      chatPanel.hidden = true;
      chatWidget.classList.remove("is-open");
      chatToggle.setAttribute("aria-expanded", "false");
    };

    chatToggle.addEventListener("click", function () {
      if (chatPanel.hidden) openChat(); else closeChat();
    });
    if (chatClose) chatClose.addEventListener("click", closeChat);
    if (chatTeaserClose) {
      chatTeaserClose.addEventListener("click", function (event) {
        event.stopPropagation();
        dismissTeaser();
      });
    }
    if (chatTeaser) chatTeaser.addEventListener("click", openChat);

    if (chatTeaser && !(window.sessionStorage && sessionStorage.getItem("alon-chat-teaser-shown"))) {
      window.setTimeout(function () {
        if (!chatPanel.hidden) return;
        chatTeaser.hidden = false;
      }, 4500);
    }

    chatForm.addEventListener("submit", function (event) {
      event.preventDefault();
      var text = chatInput.value.trim();
      if (!text || chatSending) return;

      addMessage(text, "user");
      chatInput.value = "";
      chatSending = true;
      if (chatSendBtn) chatSendBtn.disabled = true;
      showTyping();

      fetch(CHAT_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, sessionId: chatSessionId })
      })
        .then(function (res) {
          if (!res.ok) throw new Error("agent webhook responded with " + res.status);
          return res.json().catch(function () { return {}; });
        })
        .then(function (data) {
          hideTyping();
          addMessage(
            (data && data.reply) ? data.reply : "מצטער, לא הצלחתי לענות כרגע. אפשר להתקשר לאלון ל-054-000-0000.",
            "bot"
          );
        })
        .catch(function () {
          hideTyping();
          addMessage("משהו השתבש בשליחה. אפשר לנסות שוב, או להתקשר לאלון ל-054-000-0000.", "bot");
        })
        .then(function () {
          chatSending = false;
          if (chatSendBtn) chatSendBtn.disabled = false;
        });
    });
  }
})();
