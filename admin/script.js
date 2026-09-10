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

  // ---------- חיבור לאוטומציות ב-n8n ----------
  // שלושה שלבים, שני וורקפלואו:
  // 1. submit  -> "פירסור קבלות" שולח את הקובץ ל-LlamaParse ומחזיר jobId מיד
  // 2. status  -> נשאל שוב ושוב; כשהסריקה נגמרת הוא גם מחלץ שדות ובודק אם
  //               זו בכלל קבלה (valid), ואם לא - שולח לאלון מייל כישלון
  // 3. finalize-> "שמירת קבלה מאושרת" שומר בדרייב, בשיטס ושולח מייל הצלחה.
  //               נקרא רק אחרי valid=true, כדי שלא יישמר כלום שאינו קבלה.
  var SUBMIT_URL = "https://itaid04.app.n8n.cloud/webhook/nagariya-alon-receipt-submit";
  var STATUS_URL = "https://itaid04.app.n8n.cloud/webhook/nagariya-alon-receipt-status";
  var FINALIZE_URL = "https://itaid04.app.n8n.cloud/webhook/nagariya-alon-receipt-finalize";
  var POLL_INTERVAL_MS = 3000;
  var POLL_MAX_ATTEMPTS = 60; // עד כ-3 דקות לקבלה אחת
  var MAX_FILES_MOBILE = 4;

  var dropzone = document.getElementById("dropzone");
  var fileInput = document.getElementById("file-input");
  var cameraBtn = document.getElementById("camera-btn");
  var cameraInput = document.getElementById("camera-input");
  var mobileHint = document.getElementById("mobile-hint");
  var fileList = document.getElementById("file-list");
  var submitBtn = document.getElementById("upload-submit-btn");
  var clearDoneBtn = document.getElementById("clear-done-btn");
  var statusEl = document.getElementById("admin-status");

  // מסך המצלמה וההגבלה ל-4 קבצים רלוונטיים רק למכשיר מגע (טלפון/טאבלט);
  // בדסקטופ אין סיבה להגביל, ולכפתור מצלמה אין שם משמעות.
  var isTouchDevice = !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
  if (isTouchDevice) {
    cameraBtn.hidden = false;
    mobileHint.hidden = false;
  }

  // כל פריט: { file, status, message, fields, li }
  // status: pending | uploading | processing | saving | done | rejected | error
  var entries = [];

  var formatSize = function (bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  };

  var isActive = function (entry) {
    return entry.status === "uploading" || entry.status === "processing" || entry.status === "saving";
  };

  var statusLabel = function (entry) {
    if (entry.status === "uploading") return "מעלה...";
    if (entry.status === "processing") return "בסריקה...";
    if (entry.status === "saving") return "שומר...";
    if (entry.status === "done") return "נשמר";
    if (entry.status === "rejected") return entry.message || "לא זוהתה קבלה";
    if (entry.status === "error") return entry.message || "נכשל";
    return "";
  };

  var summarize = function () {
    if (entries.length === 0) return "בחרו קובץ אחד לפחות כדי להמשיך.";

    var pendingCount = 0, doneCount = 0, failedCount = 0, activeCount = 0;
    entries.forEach(function (entry) {
      if (entry.status === "pending") pendingCount += 1;
      else if (entry.status === "done") doneCount += 1;
      else if (entry.status === "rejected" || entry.status === "error") failedCount += 1;
      else activeCount += 1;
    });

    if (activeCount > 0) {
      return "מעבד " + activeCount + " קבלות... (" + doneCount + " נשמרו מתוך " + entries.length + ")";
    }
    if (pendingCount === entries.length) {
      return entries.length === 1 ? "קבלה אחת מוכנה להעלאה." : entries.length + " קבלות מוכנות להעלאה.";
    }
    return "הושלם: " + doneCount + " נשמרו" + (failedCount > 0 ? ", " + failedCount + " לא עברו" : "") + ".";
  };

  var updateEntryUi = function (entry) {
    if (!entry.li) return;
    entry.li.setAttribute("data-status", entry.status);

    var icon = entry.li.querySelector(".file-item-icon");
    icon.innerHTML =
      isActive(entry) ? '<span class="file-item-spinner" aria-hidden="true"></span>' :
      entry.status === "done" ? '<svg><use href="#i-check"/></svg>' :
      entry.status === "rejected" ? '<svg><use href="#i-alert"/></svg>' :
      entry.status === "error" ? '<svg><use href="#i-x"/></svg>' :
      '<svg><use href="#i-file"/></svg>';

    entry.li.querySelector(".file-item-status-text").textContent = statusLabel(entry);

    var detail = entry.li.querySelector(".file-item-detail");
    if (entry.status === "done" && entry.fields) {
      var parts = [];
      if (entry.fields.supplier) parts.push(entry.fields.supplier);
      if (entry.fields.amount_after_vat) parts.push(entry.fields.amount_after_vat + " ש\"ח");
      if (entry.folder) parts.push("תיקייה " + entry.folder);
      detail.textContent = parts.join(" · ");
      detail.hidden = parts.length === 0;
    } else {
      detail.hidden = true;
    }

    entry.li.querySelector(".file-item-remove").hidden = isActive(entry);
  };

  var render = function () {
    fileList.innerHTML = "";
    entries.forEach(function (entry) {
      var li = document.createElement("li");
      li.className = "file-item";
      li.innerHTML =
        '<span class="file-item-icon"><svg><use href="#i-file"/></svg></span>' +
        '<span class="file-item-main">' +
        '<span class="file-item-name"></span>' +
        '<span class="file-item-detail" hidden></span>' +
        '</span>' +
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

    var retryable = entries.filter(function (e) { return e.status === "pending" || e.status === "error"; });
    var anyActive = entries.some(isActive);
    var anyFinished = entries.some(function (e) {
      return e.status === "done" || e.status === "rejected";
    });

    submitBtn.disabled = retryable.length === 0 || anyActive;
    submitBtn.textContent = retryable.length > 1 ? "העלאת " + retryable.length + " קבלות" : "העלאת קבלות";
    clearDoneBtn.hidden = !anyFinished || anyActive;
    statusEl.textContent = summarize();
    statusEl.classList.toggle(
      "is-error",
      !anyActive && entries.some(function (e) { return e.status === "rejected" || e.status === "error"; })
    );
  };

  var addFiles = function (fileListObj) {
    var incoming = Array.prototype.slice.call(fileListObj);
    var notAdded = 0;

    if (isTouchDevice) {
      var openSlots = MAX_FILES_MOBILE - entries.filter(function (e) {
        return e.status === "pending" || isActive(e);
      }).length;
      if (incoming.length > openSlots) {
        notAdded = incoming.length - Math.max(0, openSlots);
        incoming = incoming.slice(0, Math.max(0, openSlots));
      }
    }

    incoming.forEach(function (file) {
      entries.push({ file: file, status: "pending", message: null, fields: null, folder: null, li: null });
    });
    render();

    if (notAdded > 0) {
      statusEl.textContent = "אפשר עד " + MAX_FILES_MOBILE + " קבלות בכל פעם. " + notAdded + " לא נוספו — אפשר להעלות אותן בסבב הבא.";
      statusEl.classList.add("is-error");
    }
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
  cameraBtn.addEventListener("click", function () {
    cameraInput.click();
  });

  fileInput.addEventListener("change", function () {
    addFiles(fileInput.files);
    fileInput.value = "";
  });
  cameraInput.addEventListener("change", function () {
    addFiles(cameraInput.files);
    cameraInput.value = "";
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

  clearDoneBtn.addEventListener("click", function () {
    entries = entries.filter(function (e) {
      return e.status !== "done" && e.status !== "rejected";
    });
    render();
  });

  var fail = function (entry, message) {
    entry.status = "error";
    entry.message = message;
    render();
  };

  // שלב 3: שמירה בדרייב + שיטס + מייל הצלחה. הקובץ נשלח שוב מהדפדפן,
  // כי ה-webhook של הסטטוס מקבל רק jobId ואין לו גישה לקובץ המקורי.
  var finalizeEntry = function (entry, fields) {
    entry.status = "saving";
    entry.fields = fields;
    render();

    var formData = new FormData();
    formData.append("document", entry.file, entry.file.name);
    formData.append("fileName", entry.file.name);
    formData.append("supplier", fields.supplier || "");
    formData.append("date", fields.date || "");
    formData.append("invoice_number", fields.invoice_number || "");
    formData.append("amount_before_vat", fields.amount_before_vat || "");
    formData.append("amount_after_vat", fields.amount_after_vat || "");
    formData.append("service_type", fields.service_type || "");

    fetch(FINALIZE_URL, { method: "POST", body: formData })
      .then(function (res) {
        if (!res.ok) throw new Error("finalize webhook responded with " + res.status);
        return res.json().catch(function () { return {}; });
      })
      .then(function (data) {
        if (data && data.ok === false) throw new Error("finalize reported failure");
        entry.status = "done";
        entry.folder = data && data.folder ? data.folder : null;
        render();
      })
      .catch(function () {
        fail(entry, "הקבלה נסרקה אבל השמירה נכשלה. נסו שוב.");
      });
  };

  // שלב 2: פולינג. הבקשה הבאה נשלחת רק אחרי שהתשובה הקודמת חזרה, כדי
  // שלא ירוצו שתי בדיקות במקביל על אותה עבודה.
  var pollStatus = function (entry, jobId, attemptsLeft) {
    if (attemptsLeft <= 0) {
      fail(entry, "הסריקה לקחה יותר מדי זמן. נסו שוב.");
      return;
    }
    window.setTimeout(function () {
      fetch(STATUS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: jobId, fileName: entry.file.name })
      })
        .then(function (res) {
          if (!res.ok) throw new Error("status webhook responded with " + res.status);
          return res.json();
        })
        .then(function (data) {
          if (!data || !data.done) {
            pollStatus(entry, jobId, attemptsLeft - 1);
            return;
          }
          if (data.valid === true) {
            finalizeEntry(entry, {
              supplier: data.supplier,
              date: data.date,
              invoice_number: data.invoice_number,
              amount_before_vat: data.amount_before_vat,
              amount_after_vat: data.amount_after_vat,
              service_type: data.service_type
            });
            return;
          }
          entry.status = "rejected";
          entry.message = data.message || "המסמך לא זוהה כקבלה.";
          render();
        })
        .catch(function () {
          fail(entry, "שגיאה בבדיקת הסטטוס. נסו שוב.");
        });
    }, POLL_INTERVAL_MS);
  };

  // שלב 1: העלאה ל-LlamaParse דרך n8n
  var uploadEntry = function (entry) {
    entry.status = "uploading";
    entry.message = null;
    render();

    var formData = new FormData();
    formData.append("document", entry.file, entry.file.name);
    formData.append("fileName", entry.file.name);

    fetch(SUBMIT_URL, { method: "POST", body: formData })
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
        fail(entry, "ההעלאה נכשלה. נסו שוב.");
      });
  };

  submitBtn.addEventListener("click", function () {
    var toUpload = entries.filter(function (entry) {
      return entry.status === "pending" || entry.status === "error";
    });
    if (toUpload.length === 0) return;
    // במקביל - כל הקבלות יוצאות יחד, כל אחת עם הפולינג שלה
    toUpload.forEach(uploadEntry);
  });

  render();
})();
