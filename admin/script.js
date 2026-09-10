(function () {
  // הגנת סיסמה בצד לקוח בלבד - חוסם גולש מקרי, לא אבטחה אמיתית (הסיסמה
  // גלויה בקוד המקור). מספיק לשלב הפיתוח; לפני שקבלות אמיתיות עולות כאן
  // צריך הגנה אמיתית בצד שרת.
  var ADMIN_PASSWORD = "Zohar";
  var SESSION_KEY = "alon-admin-unlocked";

  var gateSection = document.getElementById("admin-gate-section");
  var content = document.getElementById("admin-content");
  var gateForm = document.getElementById("gate-form");
  var gatePassword = document.getElementById("gate-password");
  var gateError = document.getElementById("gate-error");

  var unlock = function () {
    gateSection.hidden = true;
    content.hidden = false;
  };

  if (window.sessionStorage && sessionStorage.getItem(SESSION_KEY) === "1") {
    unlock();
  }

  gateForm.addEventListener("submit", function (event) {
    event.preventDefault();
    if (gatePassword.value === ADMIN_PASSWORD) {
      if (window.sessionStorage) sessionStorage.setItem(SESSION_KEY, "1");
      gateError.hidden = true;
      unlock();
    } else {
      gateError.hidden = false;
      gatePassword.value = "";
      gatePassword.focus();
    }
  });

  // חיבור לוורקפלואו "פירסור קבלות – נגריית אלון (LlamaParse)" ב-n8n
  // (עותק ייעודי של פירסור מסמך (LlamaParse), ראו lesson-9/הנגרייה של
  // אלון - העלאת קבלות). כניסה אחת מקבלת את הקובץ ומחזירה jobId מיד,
  // שנייה נשאלת שוב ושוב (polling) עד שהעבודה הושלמה או נכשלה.
  var SUBMIT_URL = "https://itaid04.app.n8n.cloud/webhook/nagariya-alon-receipt-submit";
  var STATUS_URL = "https://itaid04.app.n8n.cloud/webhook/nagariya-alon-receipt-status";
  var POLL_INTERVAL_MS = 3000;
  var POLL_MAX_ATTEMPTS = 60; // עד כ-3 דקות לקבלה אחת

  var dropzone = document.getElementById("dropzone");
  var fileInput = document.getElementById("file-input");
  var fileList = document.getElementById("file-list");
  var submitBtn = document.getElementById("upload-submit-btn");
  var statusEl = document.getElementById("admin-status");

  // כל פריט: { file, status, message, li } — status אחד מתוך:
  // pending | uploading | processing | done | error
  var entries = [];

  var formatSize = function (bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  };

  var isProcessing = function () {
    return entries.some(function (entry) {
      return entry.status === "uploading" || entry.status === "processing";
    });
  };

  var summarize = function () {
    var pendingCount = 0, doneCount = 0, errorCount = 0, activeCount = 0;
    entries.forEach(function (entry) {
      if (entry.status === "pending") pendingCount += 1;
      else if (entry.status === "done") doneCount += 1;
      else if (entry.status === "error") errorCount += 1;
      else activeCount += 1;
    });

    if (entries.length === 0) return "בחרו קובץ אחד לפחות כדי להמשיך.";
    if (activeCount > 0) return "מעבד קבלות... (" + doneCount + " הושלמו מתוך " + entries.length + ")";
    if (pendingCount === entries.length) return entries.length + " קבצים מוכנים להעלאה.";
    return "הושלם: " + doneCount + " הצליחו" + (errorCount > 0 ? ", " + errorCount + " נכשלו" : "") + ".";
  };

  var updateEntryUi = function (entry) {
    if (!entry.li) return;
    entry.li.setAttribute("data-status", entry.status);

    var icon = entry.li.querySelector(".file-item-icon");
    icon.innerHTML =
      entry.status === "uploading" || entry.status === "processing" ? '<span class="file-item-spinner" aria-hidden="true"></span>' :
      entry.status === "done" ? '<svg><use href="#i-check"/></svg>' :
      entry.status === "error" ? '<svg><use href="#i-x"/></svg>' :
      '<svg><use href="#i-file"/></svg>';

    var statusText = entry.li.querySelector(".file-item-status-text");
    statusText.textContent =
      entry.status === "uploading" ? "מעלה..." :
      entry.status === "processing" ? "בסריקה..." :
      entry.status === "done" ? "הושלם" :
      entry.status === "error" ? (entry.message || "נכשל") :
      "";

    var removeBtn = entry.li.querySelector(".file-item-remove");
    removeBtn.hidden = entry.status === "uploading" || entry.status === "processing";
  };

  var render = function () {
    fileList.innerHTML = "";
    entries.forEach(function (entry) {
      var li = document.createElement("li");
      li.className = "file-item";
      li.innerHTML =
        '<span class="file-item-icon"><svg><use href="#i-file"/></svg></span>' +
        '<span class="file-item-name"></span>' +
        '<span class="file-item-status-text"></span>' +
        '<span class="file-item-size"></span>' +
        '<button type="button" class="file-item-remove" aria-label="הסרת קובץ"><svg><use href="#i-x"/></svg></button>';
      li.querySelector(".file-item-name").textContent = entry.file.name;
      li.querySelector(".file-item-size").textContent = formatSize(entry.file.size);
      li.querySelector(".file-item-remove").addEventListener("click", function () {
        entries = entries.filter(function (e) { return e !== entry; });
        render();
      });
      entry.li = li;
      fileList.appendChild(li);
      updateEntryUi(entry);
    });

    submitBtn.disabled = entries.length === 0 || isProcessing();
    statusEl.textContent = summarize();
    statusEl.classList.toggle("is-error", entries.some(function (e) { return e.status === "error"; }) && !isProcessing());
  };

  var addFiles = function (fileListObj) {
    Array.prototype.forEach.call(fileListObj, function (file) {
      entries.push({ file: file, status: "pending", message: null, li: null });
    });
    render();
  };

  dropzone.addEventListener("click", function () {
    fileInput.click();
  });
  dropzone.addEventListener("keydown", function (event) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      fileInput.click();
    }
  });

  fileInput.addEventListener("change", function () {
    addFiles(fileInput.files);
    fileInput.value = "";
  });

  ["dragenter", "dragover"].forEach(function (eventName) {
    dropzone.addEventListener(eventName, function (event) {
      event.preventDefault();
      dropzone.classList.add("is-dragover");
    });
  });
  ["dragleave", "drop"].forEach(function (eventName) {
    dropzone.addEventListener(eventName, function (event) {
      event.preventDefault();
      dropzone.classList.remove("is-dragover");
    });
  });
  dropzone.addEventListener("drop", function (event) {
    if (event.dataTransfer && event.dataTransfer.files) {
      addFiles(event.dataTransfer.files);
    }
  });

  var pollStatus = function (entry, jobId, attemptsLeft) {
    if (attemptsLeft <= 0) {
      entry.status = "error";
      entry.message = "לקח יותר מדי זמן. נסו שוב.";
      render();
      return;
    }
    window.setTimeout(function () {
      fetch(STATUS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: jobId })
      })
        .then(function (res) {
          if (!res.ok) throw new Error("status webhook responded with " + res.status);
          return res.json();
        })
        .then(function (data) {
          if (data && data.done && data.status === "COMPLETED") {
            entry.status = "done";
            render();
          } else if (data && data.done) {
            entry.status = "error";
            entry.message = data.message || "העיבוד נכשל.";
            render();
          } else {
            pollStatus(entry, jobId, attemptsLeft - 1);
          }
        })
        .catch(function () {
          entry.status = "error";
          entry.message = "שגיאה בבדיקת סטטוס.";
          render();
        });
    }, POLL_INTERVAL_MS);
  };

  var uploadEntry = function (entry) {
    entry.status = "uploading";
    render();

    var formData = new FormData();
    formData.append("document", entry.file, entry.file.name);
    formData.append("fileName", entry.file.name);

    return fetch(SUBMIT_URL, { method: "POST", body: formData })
      .then(function (res) {
        if (!res.ok) throw new Error("submit webhook responded with " + res.status);
        return res.json();
      })
      .then(function (data) {
        if (!data || !data.ok || !data.jobId) throw new Error("missing jobId in response");
        entry.status = "processing";
        render();
        pollStatus(entry, data.jobId, POLL_MAX_ATTEMPTS);
      })
      .catch(function () {
        entry.status = "error";
        entry.message = "שגיאה בהעלאה. נסו שוב.";
        render();
      });
  };

  submitBtn.addEventListener("click", function () {
    var pending = entries.filter(function (entry) { return entry.status === "pending" || entry.status === "error"; });
    if (pending.length === 0) return;

    // מעלים ברצף, קובץ אחרי קובץ - פשוט וקל למעקב לשלב הראשוני הזה.
    var chain = Promise.resolve();
    pending.forEach(function (entry) {
      chain = chain.then(function () { return uploadEntry(entry); });
    });
  });

  render();
})();
