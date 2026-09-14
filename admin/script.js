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

  var receiptsListLoaded = false;
  var unlock = function () {
    gateSection.hidden = true;
    content.hidden = false;
    if (!receiptsListLoaded) {
      receiptsListLoaded = true;
      loadReceiptsList();
    }
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
  // פולינג בשני קצבים: מהיר לרוב המקרים (קבלה בודדת נגמרת תוך שניות-עשרות
  // שניות), ואיטי יותר אחרי זה - למסמכים גדולים/מרובי-עמודים שלוקחים יותר
  // זמן ל-LlamaParse. ה"איטי" לא נועד לחסוך על עומס - הוא נועד לא לוותר
  // מוקדם מדי על עבודה שעדיין רצה בהצלחה בצד LlamaParse.
  var FAST_POLL_INTERVAL_MS = 5000;
  var FAST_POLL_MAX_ATTEMPTS = 36; // 3 דקות
  var SLOW_POLL_INTERVAL_MS = 15000;
  var SLOW_POLL_MAX_ATTEMPTS = 28; // עוד כ-7 דקות, סה"כ כ-10 דקות
  var MAX_FILES_MOBILE = 4;

  var LIST_URL = "https://itaid04.app.n8n.cloud/webhook/nagariya-alon-receipts-list";

  var dropzone = document.getElementById("dropzone");
  var fileInput = document.getElementById("file-input");
  var cameraBtn = document.getElementById("camera-btn");
  var cameraInput = document.getElementById("camera-input");
  var mobileHint = document.getElementById("mobile-hint");
  var fileList = document.getElementById("file-list");
  var submitBtn = document.getElementById("upload-submit-btn");
  var clearDoneBtn = document.getElementById("clear-done-btn");
  var statusEl = document.getElementById("admin-status");

  var receiptsListEl = document.getElementById("receipts-list");
  var receiptsStatusEl = document.getElementById("receipts-status");
  var receiptsRefreshBtn = document.getElementById("receipts-refresh-btn");
  var receiptsMonthlyTotalEl = document.getElementById("receipts-monthly-total");
  var receiptsMonthsEl = document.getElementById("receipts-months");

  var HEBREW_MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];
  var selectedMonth = null;

  var resultModalBackdrop = document.getElementById("result-modal-backdrop");
  var resultModalIcon = document.getElementById("result-modal-icon");
  var resultModalTitle = document.getElementById("result-modal-title");
  var resultModalList = document.getElementById("result-modal-list");
  var resultModalCloseBtn = document.getElementById("result-modal-close-btn");
  var resultModalCloseX = document.getElementById("result-modal-close-x");

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

  // אחוז התקדמות מוצג לפי שלב. בשלב הסריקה (הכי ארוך ובלתי-צפוי) האחוז
  // מתקדם בהדרגה לפי כמות ניסיונות הפולינג שכבר בוצעו. בכישלון/דחייה
  // האחוז "קופא" במקום שבו נעצר (entry.progress), כדי לא להטעות.
  var computeProgress = function (entry) {
    if (entry.status === "pending") return 0;
    if (entry.status === "uploading") return 12;
    if (entry.status === "processing") {
      // בקצב האיטי אין דרך לדעת כמה עוד נשאר, אז הבר קופא במקום שבו הגיע
      // בסוף הקצב המהיר - החיות מגיעה מהטיימר המתקתק בטקסט, לא מהבר.
      if (entry.pollPhase === "slow") {
        return entry.slowPhaseProgress != null ? entry.slowPhaseProgress : 80;
      }
      var attemptsUsed = FAST_POLL_MAX_ATTEMPTS - (entry.pollAttemptsLeft != null ? entry.pollAttemptsLeft : FAST_POLL_MAX_ATTEMPTS);
      var frac = Math.min(1, Math.max(0, attemptsUsed / FAST_POLL_MAX_ATTEMPTS));
      return Math.round(25 + frac * 55);
    }
    if (entry.status === "saving") return 90;
    if (entry.status === "done") return 100;
    return entry.progress || 0;
  };

  var formatElapsed = function (ms) {
    var totalSec = Math.max(0, Math.floor(ms / 1000));
    var m = Math.floor(totalSec / 60);
    var s = totalSec % 60;
    return m + ":" + (s < 10 ? "0" + s : s);
  };

  var statusLabel = function (entry) {
    if (entry.status === "uploading") return "מעלה...";
    if (entry.status === "processing") {
      if (entry.pollPhase === "slow") {
        var elapsed = entry.uploadStartedAt ? formatElapsed(Date.now() - entry.uploadStartedAt) : "0:00";
        return "הקובץ גדול, הסריקה לוקחת יותר זמן... עדיין סורק (" + elapsed + ")";
      }
      return "בסריקה ובזיהוי... " + computeProgress(entry) + "%";
    }
    if (entry.status === "saving") return "שומר...";
    if (entry.status === "done") return "נשמר";
    if (entry.status === "rejected") return entry.message || "לא זוהתה קבלה";
    if (entry.status === "error") return entry.message || "נכשל";
    if (entry.status === "timeout") return entry.message || "לא הסתיים בזמן";
    return "";
  };

  var summarize = function () {
    if (entries.length === 0) return "בחרו קובץ אחד לפחות כדי להמשיך.";

    var pendingCount = 0, doneCount = 0, failedCount = 0, activeCount = 0;
    entries.forEach(function (entry) {
      if (entry.status === "pending") pendingCount += 1;
      else if (entry.status === "done") doneCount += 1;
      else if (entry.status === "rejected" || entry.status === "error" || entry.status === "timeout") failedCount += 1;
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
      entry.status === "timeout" ? '<svg><use href="#i-clock"/></svg>' :
      '<svg><use href="#i-file"/></svg>';

    entry.li.querySelector(".file-item-status-text").textContent = statusLabel(entry);

    var bar = entry.li.querySelector(".file-item-progress");
    var fill = entry.li.querySelector(".file-item-progress-fill");
    if (entry.status === "pending") {
      bar.hidden = true;
    } else {
      bar.hidden = false;
      fill.style.width = computeProgress(entry) + "%";
    }

    var detail = entry.li.querySelector(".file-item-detail");
    if (entry.status === "done" && entry.fields) {
      var parts = [];
      if (entry.fields.supplier) parts.push(entry.fields.supplier);
      if (entry.fields.amount_after_vat) parts.push(entry.fields.amount_after_vat + " ש\"ח");
      if (entry.monthTab) parts.push("טאב " + entry.monthTab);
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
        '<div class="file-item-row">' +
        '<span class="file-item-icon"><svg><use href="#i-file"/></svg></span>' +
        '<span class="file-item-main">' +
        '<span class="file-item-name"></span>' +
        '<span class="file-item-detail" hidden></span>' +
        '</span>' +
        '<span class="file-item-status-text"></span>' +
        '<span class="file-item-size"></span>' +
        '<button type="button" class="file-item-remove" aria-label="הסרת קובץ"><svg><use href="#i-x"/></svg></button>' +
        '</div>' +
        '<div class="file-item-progress" hidden><div class="file-item-progress-fill"></div></div>';
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

    var retryable = entries.filter(function (e) { return e.status === "pending" || e.status === "error" || e.status === "timeout"; });
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
      !anyActive && entries.some(function (e) { return e.status === "rejected" || e.status === "error" || e.status === "timeout"; })
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
      entries.push({ file: file, status: "pending", message: null, fields: null, monthTab: null, li: null });
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

  // טיימר מקומי שמרענן את הטקסט כל שנייה בלי לגעת ברשת - כדי שבקצב האיטי
  // (בדיקות אמיתיות מול השרת רחוקות זו מזו) המסך עדיין ירגיש חי.
  var stopTicker = function (entry) {
    if (entry._tickInterval) {
      window.clearInterval(entry._tickInterval);
      entry._tickInterval = null;
    }
  };
  var startTicker = function (entry) {
    stopTicker(entry);
    entry._tickInterval = window.setInterval(function () {
      if (entry.status !== "processing") { stopTicker(entry); return; }
      updateEntryUi(entry);
    }, 1000);
  };

  var fail = function (entry, message) {
    stopTicker(entry);
    entry.progress = computeProgress(entry);
    entry.status = "error";
    entry.message = message;
    render();
    if (entry._resolveBatch) { entry._resolveBatch(); entry._resolveBatch = null; }
  };

  // שלב 3: שמירה בדרייב + שיטס + מייל הצלחה. הקובץ נשלח שוב מהדפדפן,
  // כי ה-webhook של הסטטוס מקבל רק jobId ואין לו גישה לקובץ המקורי.
  var finalizeEntry = function (entry, fields) {
    stopTicker(entry);
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
        entry.monthTab = data && data.monthTab ? data.monthTab : null;
        render();
        if (entry._resolveBatch) { entry._resolveBatch(); entry._resolveBatch = null; }
      })
      .catch(function () {
        fail(entry, "הקבלה נסרקה אבל השמירה נכשלה. נסו שוב.");
      });
  };

  // שלב 2: פולינג. הבקשה הבאה נשלחת רק אחרי שהתשובה הקודמת חזרה, כדי
  // שלא ירוצו שתי בדיקות במקביל על אותה עבודה. שני קצבים - ראו הגדרת
  // FAST_/SLOW_ למעלה. כשהקצב המהיר נגמר בלי תוצאה, לא מוותרים - עוברים
  // לקצב האיטי במקום ישר ל-timeout.
  var pollStatus = function (entry, jobId, phase, attemptsLeft) {
    entry.pollPhase = phase;
    if (attemptsLeft <= 0) {
      if (phase === "fast") {
        entry.slowPhaseProgress = computeProgress(entry);
        pollStatus(entry, jobId, "slow", SLOW_POLL_MAX_ATTEMPTS);
        return;
      }
      stopTicker(entry);
      entry.progress = computeProgress(entry);
      entry.status = "timeout";
      entry.message = "הסריקה עדיין לא הסתיימה. אפשר לבדוק שוב בלי להעלות את הקובץ מחדש.";
      render();
      if (entry._resolveBatch) { entry._resolveBatch(); entry._resolveBatch = null; }
      return;
    }
    entry.pollAttemptsLeft = attemptsLeft;
    updateEntryUi(entry);
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
            pollStatus(entry, jobId, phase, attemptsLeft - 1);
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
          stopTicker(entry);
          entry.progress = computeProgress(entry);
          entry.status = "rejected";
          entry.message = data.message || "המסמך לא זוהה כקבלה.";
          render();
          if (entry._resolveBatch) { entry._resolveBatch(); entry._resolveBatch = null; }
        })
        .catch(function () {
          fail(entry, "שגיאה בבדיקת הסטטוס. נסו שוב.");
        });
    }, phase === "slow" ? SLOW_POLL_INTERVAL_MS : FAST_POLL_INTERVAL_MS);
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
        entry.jobId = data.jobId;
        entry.status = "processing";
        entry.uploadStartedAt = Date.now();
        render();
        startTicker(entry);
        pollStatus(entry, data.jobId, "fast", FAST_POLL_MAX_ATTEMPTS);
      })
      .catch(function () {
        fail(entry, "ההעלאה נכשלה. נסו שוב.");
      });
  };

  // "נסה שוב" על קבלה שהגיעה ל-timeout לא מעלה את הקובץ מחדש (שיפתח עבודת
  // LlamaParse כפולה ומיותרת) - הוא פשוט ממשיך לבדוק את אותה עבודה, כי
  // ה-jobId וקובץ המקור עדיין חיים בזיכרון הדפדפן מהניסיון הקודם.
  var retryEntry = function (entry) {
    if (entry.status === "timeout" && entry.jobId) {
      entry.message = null;
      entry.status = "processing";
      entry.uploadStartedAt = Date.now();
      render();
      startTicker(entry);
      pollStatus(entry, entry.jobId, "fast", FAST_POLL_MAX_ATTEMPTS);
      return;
    }
    uploadEntry(entry);
  };

  submitBtn.addEventListener("click", function () {
    var toUpload = entries.filter(function (entry) {
      return entry.status === "pending" || entry.status === "error" || entry.status === "timeout";
    });
    if (toUpload.length === 0) return;

    // כל קבלה מקבלת Promise שנפתר כשהיא מגיעה למצב סופי (done/rejected/error).
    // כשכולן נפתרות - הסבב הזה הסתיים ואפשר להציג פופאפ סיכום.
    var batchPromises = toUpload.map(function (entry) {
      return new Promise(function (resolve) {
        entry._resolveBatch = resolve;
      });
    });

    // במקביל - כל הקבלות יוצאות יחד, כל אחת עם הפולינג שלה. קבלות ב-timeout
    // ממשיכות על אותה עבודה קיימת במקום להעלות מחדש - ראו retryEntry.
    toUpload.forEach(retryEntry);

    Promise.all(batchPromises).then(function () {
      showResultModal(toUpload);
      loadReceiptsList();
    });
  });

  // ---------- פופאפ תוצאת העלאה ----------
  function showResultModal(finishedEntries) {
    var doneList = finishedEntries.filter(function (e) { return e.status === "done"; });
    var okAll = finishedEntries.every(function (e) { return e.status === "done"; });

    resultModalIcon.className = "modal-icon " + (okAll ? "is-success" : "is-warning");
    resultModalIcon.innerHTML = okAll ?
      '<svg><use href="#i-check"/></svg>' :
      '<svg><use href="#i-alert"/></svg>';

    if (okAll) {
      resultModalTitle.textContent = doneList.length === 1 ? "הקבלה נשמרה בהצלחה!" : doneList.length + " קבלות נשמרו בהצלחה!";
    } else if (doneList.length === 0) {
      resultModalTitle.textContent = finishedEntries.length === 1 ? "ההעלאה לא הצליחה" : "ההעלאות לא הצליחו";
    } else {
      resultModalTitle.textContent = "נשמרו " + doneList.length + " מתוך " + finishedEntries.length + " קבלות";
    }

    resultModalList.innerHTML = "";
    finishedEntries.forEach(function (entry) {
      var li = document.createElement("li");
      li.className = "modal-result-item is-" + entry.status;
      var iconHref = entry.status === "done" ? "#i-check" :
        entry.status === "rejected" ? "#i-alert" :
        entry.status === "timeout" ? "#i-clock" : "#i-x";
      li.innerHTML =
        '<span class="modal-result-icon"><svg><use href="' + iconHref + '"/></svg></span>' +
        '<span class="modal-result-text">' +
        '<span class="modal-result-name"></span>' +
        '</span>';
      li.querySelector(".modal-result-name").textContent = entry.file.name;
      var textEl = li.querySelector(".modal-result-text");

      if (entry.status === "done" && entry.fields) {
        // אותם שדות שנכנסים לגיליון בדיוק - כדי שאפשר יהיה להשוות מול הנייר
        var grid = document.createElement("div");
        grid.className = "modal-result-fields";
        var displayDate = entry.fields.date && /^\d{4}-\d{2}-\d{2}$/.test(entry.fields.date)
          ? entry.fields.date.split("-").reverse().join("-")
          : entry.fields.date;
        var rows = [
          ["ספק", entry.fields.supplier, false],
          ["תאריך", displayDate, true],
          ["מס' חשבונית", entry.fields.invoice_number, true],
          ["לפני מע\"מ", entry.fields.amount_before_vat ? entry.fields.amount_before_vat + ' ש"ח' : "", false],
          ["אחרי מע\"מ", entry.fields.amount_after_vat ? entry.fields.amount_after_vat + ' ש"ח' : "", false],
          ["סוג שירות", entry.fields.service_type, false]
        ];
        rows.forEach(function (row) {
          var field = document.createElement("div");
          var label = document.createElement("span");
          label.className = "mrf-label";
          label.textContent = row[0];
          var value = document.createElement("span");
          value.className = "mrf-value" + (row[2] ? " ltr" : "");
          value.textContent = row[1] || "—";
          field.appendChild(label);
          field.appendChild(value);
          grid.appendChild(field);
        });
        textEl.appendChild(grid);
      } else {
        var detail = document.createElement("span");
        detail.className = "modal-result-detail";
        detail.textContent = entry.message || (entry.status === "rejected" ? "לא זוהתה קבלה" : entry.status === "timeout" ? "לא הסתיים בזמן" : "נכשל");
        textEl.appendChild(detail);
      }
      resultModalList.appendChild(li);
    });

    resultModalBackdrop.hidden = false;
  }

  function hideResultModal() {
    resultModalBackdrop.hidden = true;
  }

  resultModalCloseBtn.addEventListener("click", hideResultModal);
  resultModalCloseX.addEventListener("click", hideResultModal);
  resultModalBackdrop.addEventListener("click", function (event) {
    if (event.target === resultModalBackdrop) hideResultModal();
  });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && !resultModalBackdrop.hidden) hideResultModal();
  });

  // ---------- קבלות שהועלו (נקרא מהגיליון "קבלות" בפועל, לא מיומן הסריקות) ----------
  function loadReceiptsList() {
    receiptsRefreshBtn.disabled = true;
    receiptsRefreshBtn.classList.add("is-loading");
    receiptsStatusEl.hidden = false;
    receiptsStatusEl.textContent = "טוען קבלות...";
    receiptsStatusEl.classList.remove("is-error");

    fetch(LIST_URL)
      .then(function (res) {
        if (!res.ok) throw new Error("list webhook responded with " + res.status);
        return res.json();
      })
      .then(function (data) {
        renderReceiptsList((data && data.receipts) || []);
      })
      .catch(function () {
        receiptsListEl.innerHTML = "";
        receiptsStatusEl.hidden = false;
        receiptsStatusEl.textContent = "לא הצלחנו לטעון את רשימת הקבלות. אפשר לנסות לרענן.";
        receiptsStatusEl.classList.add("is-error");
      })
      .then(function () {
        receiptsRefreshBtn.disabled = false;
        receiptsRefreshBtn.classList.remove("is-loading");
      });
  }

  // מקבץ קבלות לפי חודש-שנה (dateIso, לא תאריך ההעלאה), בסדר שבו הן כבר
  // ממוינות (מהחדש לישן) - כך שסדר החודשים בכפתורים יוצא נכון בלי מיון נוסף.
  function groupReceiptsByMonth(receipts) {
    var order = [];
    var map = {};
    receipts.forEach(function (r) {
      var ym = (r.dateIso || "").slice(0, 7);
      if (!ym) return;
      if (!map[ym]) {
        map[ym] = [];
        order.push(ym);
      }
      map[ym].push(r);
    });
    return { order: order, map: map };
  }

  function monthLabel(ym) {
    var parts = ym.split("-");
    var monthIndex = parseInt(parts[1], 10) - 1;
    var name = HEBREW_MONTHS[monthIndex] || parts[1];
    return name + " " + parts[0];
  }

  function renderReceiptsList(receipts) {
    updateMonthlyTotal(receipts);

    if (receipts.length === 0) {
      receiptsMonthsEl.hidden = true;
      receiptsMonthsEl.innerHTML = "";
      receiptsListEl.innerHTML = "";
      receiptsStatusEl.hidden = false;
      receiptsStatusEl.textContent = "עדיין לא הועלו קבלות.";
      receiptsStatusEl.classList.remove("is-error");
      return;
    }
    receiptsStatusEl.hidden = true;

    var grouped = groupReceiptsByMonth(receipts);
    if (!selectedMonth || grouped.order.indexOf(selectedMonth) === -1) {
      selectedMonth = grouped.order[0];
    }

    receiptsMonthsEl.hidden = false;
    receiptsMonthsEl.innerHTML = "";
    grouped.order.forEach(function (ym) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "month-btn" + (ym === selectedMonth ? " is-active" : "");
      btn.textContent = monthLabel(ym) + " (" + grouped.map[ym].length + ")";
      btn.addEventListener("click", function () {
        selectedMonth = ym;
        renderReceiptsList(receipts);
      });
      receiptsMonthsEl.appendChild(btn);
    });

    receiptsListEl.innerHTML = "";
    (grouped.map[selectedMonth] || []).forEach(function (r) {
      receiptsListEl.appendChild(buildReceiptCard(r));
    });
  }

  // סה"כ לפי תאריך הקבלה בפועל (dateIso), לא לפי תאריך ההעלאה - כדי
  // שההוצאות ישתייכו לחודש שבו הן נוצרו, כמו שרואה חשבון היה מצפה.
  function currentYearMonth() {
    var now = new Date();
    var mm = String(now.getMonth() + 1);
    if (mm.length < 2) mm = "0" + mm;
    return now.getFullYear() + "-" + mm;
  }

  function updateMonthlyTotal(receipts) {
    var ym = currentYearMonth();
    var sum = 0;
    var count = 0;
    receipts.forEach(function (r) {
      if (r.dateIso && r.dateIso.slice(0, 7) === ym) {
        var n = parseFloat(r.amountAfterVat);
        if (!isNaN(n)) {
          sum += n;
          count += 1;
        }
      }
    });
    if (count === 0) {
      receiptsMonthlyTotalEl.hidden = true;
      return;
    }
    var sumText = sum.toLocaleString("he-IL", { maximumFractionDigits: 2 });
    receiptsMonthlyTotalEl.hidden = false;
    receiptsMonthlyTotalEl.innerHTML =
      'סה"כ החודש: <b>' + sumText + ' ש"ח</b> (' + count + (count === 1 ? " קבלה" : " קבלות") + ")";
  }

  function buildReceiptCard(r) {
    var li = document.createElement("li");
    li.className = "receipt-card";
    li.innerHTML =
      '<div class="receipt-card-head">' +
      '<span class="receipt-card-supplier"></span>' +
      '<span class="receipt-card-amount"></span>' +
      '</div>' +
      '<div class="receipt-card-grid">' +
      '<div class="receipt-field"><span class="receipt-label">תאריך</span><span class="receipt-value rv-date"></span></div>' +
      '<div class="receipt-field"><span class="receipt-label">מס\' חשבונית</span><span class="receipt-value rv-invoice"></span></div>' +
      '<div class="receipt-field"><span class="receipt-label">לפני מע״מ</span><span class="receipt-value rv-before"></span></div>' +
      '<div class="receipt-field"><span class="receipt-label">סוג שירות</span><span class="receipt-value rv-service"></span></div>' +
      '</div>' +
      '<div class="receipt-card-foot">הועלה <span class="rv-uploaded"></span></div>';

    li.querySelector(".receipt-card-supplier").textContent = r.supplier || "ספק לא ידוע";
    li.querySelector(".receipt-card-amount").textContent = r.amountAfterVat ? (r.amountAfterVat + ' ש"ח') : "";
    li.querySelector(".rv-date").textContent = r.date || "—";
    li.querySelector(".rv-invoice").textContent = r.invoiceNumber || "—";
    li.querySelector(".rv-before").textContent = r.amountBeforeVat ? (r.amountBeforeVat + ' ש"ח') : "—";
    li.querySelector(".rv-service").textContent = r.serviceType || "—";
    li.querySelector(".rv-uploaded").textContent = r.uploadedAt || "";
    return li;
  }

  receiptsRefreshBtn.addEventListener("click", loadReceiptsList);

  render();
})();
