(function () {
  // ---------- מסמכים לעוזר הדיגיטלי ----------
  // וורקפלואו אחד ב-n8n: "מאגר מסמכים – נגריית אלון (RAG)".
  // 1. upload -> מקבל את הקובץ, עונה מיד, וממשיך לעבוד ברקע:
  //              מכניס את החתיכות החדשות ל-Supabase, ורק אם הכול הצליח
  //              מוחק את הגרסה הקודמת של אותו סוג מסמך. בכישלון - מוחק רק
  //              את החתיכות של ההעלאה הנוכחית, והגרסה הקודמת נשארת.
  // 2. status -> נשאל כל 2 שניות באיזה שלב ההעלאה (לפי uploadId).
  // 3. list   -> המסמכים הפעילים בטבלה: כמה חתיכות ומתי הועלו.
  var UPLOAD_URL = "https://itaid04.app.n8n.cloud/webhook/nagariya-alon-docs-upload";
  var STATUS_URL = "https://itaid04.app.n8n.cloud/webhook/nagariya-alon-docs-status";
  var LIST_URL = "https://itaid04.app.n8n.cloud/webhook/nagariya-alon-docs-list";
  var POLL_INTERVAL_MS = 2000;
  var POLL_MAX_ATTEMPTS = 90; // 3 דקות
  var DOC_TYPES = ["מחירון", "תנאי הזמנה"];
  var STEP_ORDER = ["upload", "saving", "replacing", "done"];
  // "המחירון הוחלף" אבל "תנאי ההזמנה הוחלפו" - ה' הידיעה והפועל תלויים בסוג המסמך
  var DOC_WORDING = {
    "מחירון": { definite: "המחירון", replaced: "הוחלף" },
    "תנאי הזמנה": { definite: "תנאי ההזמנה", replaced: "הוחלפו" }
  };
  var docWording = function (docType) {
    return DOC_WORDING[docType] || { definite: "המסמך " + docType, replaced: "הוחלף" };
  };
  var STEP_NAMES = {
    upload: "שליחת הקובץ",
    saving: "פירוק לחתיכות ושמירה במאגר",
    replacing: "מחיקת הגרסה הקודמת",
    done: "אישור"
  };

  var content = document.getElementById("admin-content");
  var dropzone = document.getElementById("doc-dropzone");
  var fileInput = document.getElementById("doc-file-input");
  var selectedEl = document.getElementById("doc-selected");
  var selectedNameEl = document.getElementById("doc-selected-name");
  var selectedSizeEl = document.getElementById("doc-selected-size");
  var selectedRemoveBtn = document.getElementById("doc-selected-remove");
  var stepsEl = document.getElementById("doc-steps");
  var resultEl = document.getElementById("doc-result");
  var resultTitleEl = document.getElementById("doc-result-title");
  var resultDetailEl = document.getElementById("doc-result-detail");
  var submitBtn = document.getElementById("doc-submit-btn");
  var statusEl = document.getElementById("doc-status");
  var simulateFailureInput = document.getElementById("doc-simulate-failure");
  var listEl = document.getElementById("docs-list");
  var listStatusEl = document.getElementById("docs-list-status");
  var refreshBtn = document.getElementById("docs-refresh-btn");

  var selectedFile = null;
  var busy = false;

  var formatSize = function (bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  };

  // תאריך ושעה בעברית נוטים להתהפך כשהם באמצע משפט RTL - עוטפים ב-LTR מבודד.
  var formatDateTime = function (iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    var pad = function (n) { return n < 10 ? "0" + n : String(n); };
    return pad(d.getDate()) + "." + pad(d.getMonth() + 1) + "." + d.getFullYear() + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  };

  // שם קובץ עברי עם מספר וסיומת ("מחירון יוני 2026.docx") מתהפך בתצוגת RTL -
  // מציגים את השם בלי הסיומת, ואת הסיומת בנפרד כתגית.
  var splitFileName = function (name) {
    var match = /^(.*)\.([^.]+)$/.exec(name || "");
    return match ? { base: match[1], ext: match[2].toUpperCase() } : { base: name || "", ext: "" };
  };
  var renderFileName = function (el, name) {
    var parts = splitFileName(name);
    el.textContent = parts.base;
    if (parts.ext) {
      var tag = document.createElement("span");
      tag.className = "file-ext-tag";
      tag.textContent = parts.ext;
      el.appendChild(tag);
    }
  };

  // "חתיכה אחת" ולא "1 חתיכות"
  var chunksLabel = function (count) {
    return count === 1 ? "חתיכה אחת" : count + " חתיכות";
  };

  var newUploadId = function () {
    return (window.crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : ("u-" + Date.now() + "-" + Math.random().toString(16).slice(2));
  };

  var selectedDocType = function () {
    var checked = document.querySelector('input[name="doc-type"]:checked');
    return checked ? checked.value : null;
  };

  var refreshControls = function () {
    submitBtn.disabled = busy || !selectedFile || !selectedDocType();
    dropzone.classList.toggle("is-disabled", busy);
    selectedRemoveBtn.hidden = busy;
    Array.prototype.forEach.call(document.querySelectorAll('input[name="doc-type"]'), function (input) {
      input.disabled = busy;
    });
    simulateFailureInput.disabled = busy;
  };

  var setFile = function (file) {
    if (busy) return;
    selectedFile = file || null;
    if (selectedFile) {
      renderFileName(selectedNameEl, selectedFile.name);
      selectedSizeEl.textContent = formatSize(selectedFile.size);
      selectedEl.hidden = false;
      statusEl.textContent = "מוכן להעלאה: " + selectedDocType() + ".";
    } else {
      selectedEl.hidden = true;
      statusEl.textContent = "בחרו סוג מסמך וקובץ כדי להמשיך.";
    }
    statusEl.classList.remove("is-error");
    refreshControls();
  };

  // ---------- פס השלבים ----------
  // state לכל שלב: pending | active | done | failed
  var setSteps = function (activeStep, failedStep) {
    stepsEl.hidden = false;
    var reachedActive = false;
    STEP_ORDER.forEach(function (step) {
      var li = stepsEl.querySelector('[data-step="' + step + '"]');
      var state;
      if (failedStep) {
        if (step === failedStep) { state = "failed"; reachedActive = true; }
        else state = reachedActive ? "pending" : "done";
      } else if (activeStep === "complete") {
        state = "done";
      } else if (step === activeStep) {
        state = "active"; reachedActive = true;
      } else {
        state = reachedActive ? "pending" : "done";
      }
      li.setAttribute("data-state", state);
      var dot = li.querySelector(".doc-step-dot");
      dot.innerHTML =
        state === "done" ? '<svg><use href="#i-check"/></svg>' :
        state === "failed" ? '<svg><use href="#i-x"/></svg>' :
        state === "active" ? '<span class="file-item-spinner" aria-hidden="true"></span>' : "";
    });
  };

  var showResult = function (kind, title, detail) {
    resultEl.hidden = false;
    resultEl.setAttribute("data-kind", kind);
    resultTitleEl.textContent = title;
    resultDetailEl.textContent = detail || "";
    resultDetailEl.hidden = !detail;
  };

  var finish = function () {
    busy = false;
    selectedFile = null;
    selectedEl.hidden = true;
    simulateFailureInput.checked = false;
    refreshControls();
    loadList();
  };

  // ---------- פולינג על הסטטוס ----------
  var pollStatus = function (uploadId, docType, attemptsLeft) {
    if (attemptsLeft <= 0) {
      setSteps(null, "saving");
      showResult(
        "warning",
        "לא התקבלה תשובה סופית בזמן",
        "ייתכן שההעלאה עדיין רצה ברקע. בדקו ברשימת המסמכים הפעילים בעוד דקה."
      );
      statusEl.textContent = "";
      finish();
      return;
    }

    fetch(STATUS_URL + "?uploadId=" + encodeURIComponent(uploadId))
      .then(function (res) {
        if (!res.ok) throw new Error("status webhook responded with " + res.status);
        return res.json();
      })
      .then(function (data) {
        if (!data || !data.found) {
          window.setTimeout(function () { pollStatus(uploadId, docType, attemptsLeft - 1); }, POLL_INTERVAL_MS);
          return;
        }

        if (data.status === "done") {
          setSteps("complete");
          showResult(
            "success",
            docWording(docType).definite + " " + docWording(docType).replaced + " בהצלחה",
            (data.chunkCount === 1 ? "נכנסה חתיכה אחת חדשה" : "נכנסו " + data.chunkCount + " חתיכות חדשות") + " למאגר, והגרסה הקודמת נמחקה. העוזר הדיגיטלי עונה מעכשיו לפי \"" + (splitFileName(data.fileName).base || "הקובץ החדש") + "\"."
          );
          statusEl.textContent = "";
          finish();
          return;
        }

        if (data.status === "failed" || data.status === "rolling_back") {
          var failedStep = data.failedStage === "replacing" ? "replacing" : "saving";
          setSteps(null, failedStep);
          if (data.status === "rolling_back") {
            statusEl.textContent = "ההעלאה נכשלה. מנקה את החתיכות של ההעלאה הזו...";
            window.setTimeout(function () { pollStatus(uploadId, docType, attemptsLeft - 1); }, POLL_INTERVAL_MS);
            return;
          }
          showResult(
            "error",
            "ההעלאה נכשלה בשלב: " + STEP_NAMES[failedStep],
            (data.errorMessage ? data.errorMessage + ". " : "") +
              "החתיכות של ההעלאה הזו נמחקו, והגרסה הקודמת של " + docWording(docType).definite + " עדיין פעילה. העוזר הדיגיטלי ממשיך לענות לפיה."
          );
          statusEl.textContent = "";
          finish();
          return;
        }

        // עדיין רץ: received / saving / replacing
        setSteps(data.stage === "replacing" ? "replacing" : "saving");
        statusEl.textContent = data.stage === "replacing" ? "החתיכות החדשות נשמרו. מוחק את הגרסה הקודמת..." : "מפרק את המסמך לחתיכות ושומר במאגר...";
        window.setTimeout(function () { pollStatus(uploadId, docType, attemptsLeft - 1); }, POLL_INTERVAL_MS);
      })
      .catch(function () {
        // תקלת רשת רגעית בפולינג לא אומרת שההעלאה נכשלה - ממשיכים לנסות
        window.setTimeout(function () { pollStatus(uploadId, docType, attemptsLeft - 1); }, POLL_INTERVAL_MS);
      });
  };

  // ---------- העלאה ----------
  var upload = function () {
    var docType = selectedDocType();
    if (!selectedFile || !docType || busy) return;
    busy = true;
    refreshControls();
    resultEl.hidden = true;
    setSteps("upload");
    statusEl.classList.remove("is-error");
    statusEl.textContent = "שולח את הקובץ...";

    var uploadId = newUploadId();
    var formData = new FormData();
    formData.append("file", selectedFile, selectedFile.name);
    formData.append("fileName", selectedFile.name);
    formData.append("docType", docType);
    formData.append("uploadId", uploadId);
    formData.append("simulateFailure", simulateFailureInput.checked ? "true" : "false");

    fetch(UPLOAD_URL, { method: "POST", body: formData })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          if (!res.ok || !data.ok) throw new Error(data.error || ("upload webhook responded with " + res.status));
          return data;
        });
      })
      .then(function () {
        setSteps("saving");
        statusEl.textContent = "מפרק את המסמך לחתיכות ושומר במאגר...";
        pollStatus(uploadId, docType, POLL_MAX_ATTEMPTS);
      })
      .catch(function (err) {
        setSteps(null, "upload");
        showResult(
          "error",
          "ההעלאה נכשלה בשלב: " + STEP_NAMES.upload,
          "הקובץ לא הגיע לשרת (" + err.message + "), ולכן שום דבר במאגר לא השתנה. אפשר לנסות שוב."
        );
        statusEl.textContent = "";
        busy = false;
        refreshControls();
      });
  };

  // ---------- רשימת המסמכים הפעילים ----------
  var renderList = function (documents) {
    listEl.innerHTML = "";
    var byType = {};
    documents.forEach(function (d) { byType[d.docType] = d; });

    // סוגי המסמכים הקבועים תמיד מוצגים (גם אם עוד לא הועלו), ואחריהם כל
    // סוג אחר שנמצא בטבלה - כדי שהרשימה תשקף בדיוק את מה שהעוזר רואה.
    var types = DOC_TYPES.slice();
    documents.forEach(function (d) { if (types.indexOf(d.docType) === -1) types.push(d.docType); });

    types.forEach(function (type) {
      var doc = byType[type];
      var li = document.createElement("li");
      li.className = "doc-card" + (doc ? "" : " is-empty");
      li.innerHTML =
        '<div class="doc-card-head">' +
        '<span class="doc-card-type"></span>' +
        '<span class="doc-card-chunks"></span>' +
        "</div>" +
        '<p class="doc-card-file"></p>' +
        '<p class="doc-card-updated"></p>' +
        '<p class="doc-card-pending" hidden></p>';
      li.querySelector(".doc-card-type").textContent = type;

      if (!doc) {
        li.querySelector(".doc-card-chunks").textContent = "";
        li.querySelector(".doc-card-file").textContent = "עדיין לא הועלה. העוזר לא יודע לענות על נושא זה.";
        li.querySelector(".doc-card-updated").hidden = true;
      } else {
        li.querySelector(".doc-card-chunks").textContent = chunksLabel(doc.active.chunkCount);
        renderFileName(li.querySelector(".doc-card-file"), doc.active.fileName || "קובץ ללא שם");
        var updated = li.querySelector(".doc-card-updated");
        var when = doc.active.uploadedAt ? formatDateTime(doc.active.uploadedAt) : "";
        updated.innerHTML = "עודכן: ";
        var whenSpan = document.createElement("span");
        whenSpan.className = "ltr-iso";
        whenSpan.textContent = when || "לא ידוע";
        updated.appendChild(whenSpan);
        if (doc.pending && doc.pending.length) {
          var pendingEl = li.querySelector(".doc-card-pending");
          pendingEl.hidden = false;
          pendingEl.textContent = "גרסה חדשה בתהליך העלאה (" + chunksLabel(doc.pending[0].chunkCount) + " עד עכשיו). עד שתסתיים, העוזר עונה גם לפי הגרסה הזו.";
        }
      }
      listEl.appendChild(li);
    });
  };

  var loadList = function () {
    refreshBtn.disabled = true;
    refreshBtn.classList.add("is-loading");
    listStatusEl.hidden = false;
    listStatusEl.classList.remove("is-error");
    listStatusEl.textContent = "טוען מסמכים...";

    fetch(LIST_URL)
      .then(function (res) {
        if (!res.ok) throw new Error("list webhook responded with " + res.status);
        return res.json();
      })
      .then(function (data) {
        renderList((data && data.documents) || []);
        listStatusEl.hidden = true;
      })
      .catch(function () {
        listStatusEl.textContent = "לא הצלחתי לטעון את רשימת המסמכים. נסו לרענן.";
        listStatusEl.classList.add("is-error");
      })
      .then(function () {
        refreshBtn.disabled = false;
        refreshBtn.classList.remove("is-loading");
      });
  };

  // ---------- אירועים ----------
  dropzone.addEventListener("click", function () { if (!busy) fileInput.click(); });
  dropzone.addEventListener("keydown", function (event) {
    if ((event.key === "Enter" || event.key === " ") && !busy) {
      event.preventDefault();
      fileInput.click();
    }
  });
  fileInput.addEventListener("change", function () {
    setFile(fileInput.files[0]);
    fileInput.value = "";
  });
  ["dragenter", "dragover"].forEach(function (name) {
    dropzone.addEventListener(name, function (event) {
      event.preventDefault();
      if (!busy) dropzone.classList.add("is-dragover");
    });
  });
  ["dragleave", "drop"].forEach(function (name) {
    dropzone.addEventListener(name, function (event) {
      event.preventDefault();
      dropzone.classList.remove("is-dragover");
    });
  });
  dropzone.addEventListener("drop", function (event) {
    if (event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0]) {
      setFile(event.dataTransfer.files[0]);
    }
  });
  selectedRemoveBtn.addEventListener("click", function () { setFile(null); });
  Array.prototype.forEach.call(document.querySelectorAll('input[name="doc-type"]'), function (input) {
    input.addEventListener("change", function () {
      if (selectedFile) statusEl.textContent = "מוכן להעלאה: " + selectedDocType() + ".";
      refreshControls();
    });
  });
  submitBtn.addEventListener("click", upload);
  refreshBtn.addEventListener("click", loadList);

  var listLoaded = false;
  var loadListOnce = function () {
    if (listLoaded) return;
    listLoaded = true;
    loadList();
  };
  document.addEventListener("admin-unlocked", loadListOnce);
  // script.js נטען לפני הקובץ הזה, ואם הסשן כבר פתוח הוא פתח את האזור עוד לפני שהמאזין נרשם
  if (!content.hidden) loadListOnce();

  refreshControls();
})();
