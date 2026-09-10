(function () {
  // הגנת סיסמה בצד לקוח בלבד - חוסם גולש מקרי, לא אבטחה אמיתית (הסיסמה
  // גלויה בקוד המקור). מספיק לשלב הפיתוח; לפני שקבלות אמיתיות עולות כאן
  // צריך הגנה אמיתית בצד שרת.
  var ADMIN_PASSWORD = "nagariya2026";
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

  var dropzone = document.getElementById("dropzone");
  var fileInput = document.getElementById("file-input");
  var fileList = document.getElementById("file-list");
  var submitBtn = document.getElementById("upload-submit-btn");
  var statusEl = document.getElementById("admin-status");

  var files = [];

  var formatSize = function (bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  };

  var render = function () {
    fileList.innerHTML = "";
    files.forEach(function (file, index) {
      var li = document.createElement("li");
      li.className = "file-item";
      li.innerHTML =
        '<svg><use href="#i-file"/></svg>' +
        '<span class="file-item-name"></span>' +
        '<span class="file-item-size"></span>' +
        '<button type="button" class="file-item-remove" aria-label="הסרת קובץ"><svg><use href="#i-x"/></svg></button>';
      li.querySelector(".file-item-name").textContent = file.name;
      li.querySelector(".file-item-size").textContent = formatSize(file.size);
      li.querySelector(".file-item-remove").addEventListener("click", function () {
        files.splice(index, 1);
        render();
      });
      fileList.appendChild(li);
    });

    submitBtn.disabled = files.length === 0;
    statusEl.textContent = files.length === 0
      ? "בחרו קובץ אחד לפחות כדי להמשיך."
      : files.length + " קבצים מוכנים להעלאה.";
  };

  var addFiles = function (fileListObj) {
    Array.prototype.forEach.call(fileListObj, function (file) {
      files.push(file);
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

  submitBtn.addEventListener("click", function () {
    // עדיין לא מחובר לשום בק-אנד — זה השלב הבא, אחרי שנסגור מה קורה עם הקבלות.
    statusEl.textContent = "החיבור להעלאה בפועל עוד לא מוכן — זה השלב הבא.";
  });

  render();
})();
