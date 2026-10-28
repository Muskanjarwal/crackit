(function () {
  var key = document.body.dataset.track;
  var track = window.TRACKS[key];
  var storeKey = "progress:" + key;
  var done = {};
  try { done = JSON.parse(safeStorage("get", storeKey) || "{}"); } catch (e) { done = {}; }

  var state = { q: "", diff: "all" };
  var root = document.getElementById("groups");
  var toc = document.getElementById("toc");
  var empty = document.getElementById("empty");

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function details(it) {
    var html = "";
    if (it.points && it.points.length) {
      html += "<h4>" + esc(it.pointsLabel || "Key points") + "</h4><ul>" +
        it.points.map(function (p) { return "<li>" + esc(p) + "</li>"; }).join("") + "</ul>";
    }
    if (it.code) html += "<h4>Sketch</h4><pre><code>" + esc(it.code) + "</code></pre>";
    if (it.followups && it.followups.length) {
      html += "<h4>Follow-up questions</h4><ul>" +
        it.followups.map(function (p) { return "<li>" + esc(p) + "</li>"; }).join("") + "</ul>";
    }
    return html;
  }

  function itemHtml(it) {
    var diff = it.difficulty
      ? '<span class="badge ' + it.difficulty + '">' + it.difficulty + "</span>" : "";
    var tags = (it.tags || []).map(function (t) { return '<span class="tag">' + esc(t) + "</span>"; }).join("");
    var hasDetails = (it.points && it.points.length) || it.code || (it.followups && it.followups.length);
    return '<article class="item' + (done[it.id] ? " done" : "") + '" data-id="' + it.id + '">' +
      '<div class="item-head">' +
        '<input type="checkbox" aria-label="Mark ' + esc(it.title) + ' as done"' + (done[it.id] ? " checked" : "") + ">" +
        '<div class="item-main">' +
          '<h3 class="item-title"><span class="name">' + (it.href ? '<a href="' + it.href + '">' + esc(it.title) + "</a>" : esc(it.title)) + "</span>" + diff + "</h3>" +
          '<p class="item-desc">' + esc(it.desc) + "</p>" +
          (tags ? '<div class="tags">' + tags + "</div>" : "") +
        "</div>" +
        (hasDetails ? '<button class="toggle" aria-expanded="false">Details</button>' : "") +
      "</div>" +
      (hasDetails ? '<div class="details">' + details(it) + "</div>" : "") +
    "</article>";
  }

  function matches(it) {
    if (state.diff !== "all" && it.difficulty !== state.diff) return false;
    if (!state.q) return true;
    var hay = (it.title + " " + it.desc + " " + (it.tags || []).join(" ")).toLowerCase();
    return hay.indexOf(state.q) !== -1;
  }

  function render() {
    var shown = 0;
    root.innerHTML = track.sections.map(function (sec) {
      var items = sec.items.filter(matches);
      shown += items.length;
      if (!items.length) return "";
      return '<section class="group" id="' + sec.id + '"><h2>' + esc(sec.title) + "</h2>" +
        "<p>" + esc(sec.blurb) + '</p><div class="items">' + items.map(itemHtml).join("") + "</div></section>";
    }).join("");
    empty.style.display = shown ? "none" : "block";
    updateProgress();
  }

  function updateProgress() {
    var all = [];
    track.sections.forEach(function (s) { all = all.concat(s.items); });
    var n = all.filter(function (it) { return done[it.id]; }).length;
    document.getElementById("progress-text").textContent = n + " / " + all.length + " completed";
    document.getElementById("progress-bar").style.width = (all.length ? (n / all.length) * 100 : 0) + "%";
  }

  toc.innerHTML = track.sections.map(function (s) {
    return '<a href="#' + s.id + '">' + esc(s.title) + "</a>";
  }).join("");

  root.addEventListener("change", function (e) {
    if (e.target.type !== "checkbox") return;
    var card = e.target.closest(".item");
    done[card.dataset.id] = e.target.checked;
    if (!e.target.checked) delete done[card.dataset.id];
    card.classList.toggle("done", e.target.checked);
    safeStorage("set", storeKey, JSON.stringify(done));
    updateProgress();
  });

  root.addEventListener("click", function (e) {
    var btn = e.target.closest(".toggle");
    if (!btn) return;
    var card = btn.closest(".item");
    var open = card.classList.toggle("open");
    btn.setAttribute("aria-expanded", open);
    btn.textContent = open ? "Hide" : "Details";
  });

  document.getElementById("search").addEventListener("input", function (e) {
    state.q = e.target.value.trim().toLowerCase();
    render();
  });

  document.getElementById("chips").addEventListener("click", function (e) {
    var chip = e.target.closest(".chip");
    if (!chip) return;
    state.diff = chip.dataset.diff;
    document.querySelectorAll(".chip").forEach(function (c) {
      c.setAttribute("aria-pressed", c === chip);
    });
    render();
  });

  render();
})();
