function safeStorage(op, key, value) {
  try {
    return op === "get" ? localStorage.getItem(key) : localStorage.setItem(key, value);
  } catch (e) {
    return null;
  }
}

(function applySavedTheme() {
  var saved = safeStorage("get", "theme");
  if (saved) document.documentElement.setAttribute("data-theme", saved);
})();

function initThemeButton() {
  var btn = document.getElementById("theme");
  if (!btn) return;
  btn.addEventListener("click", function () {
    var root = document.documentElement;
    var current = root.getAttribute("data-theme") ||
      (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    var next = current === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    safeStorage("set", "theme", next);
  });
}
