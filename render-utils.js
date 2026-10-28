// Shared helpers for article pages (pattern, lesson, question).
window.R = (function () {
  var uid = 0;

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  // **bold**, *italic* and `code` inside prose; code spans are left untouched
  function inline(s) {
    var codes = [];
    var text = esc(s).replace(/`([^`]+)`/g, function (_, c) {
      codes.push("<code>" + c + "</code>");
      return "\u0000" + (codes.length - 1) + "\u0000";
    });
    text = text
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^\w*])\*([^\s*][^*\n]*?[^\s*]|[^\s*])\*(?![\w*])/g, "$1<em>$2</em>");
    return text.replace(/\u0000(\d+)\u0000/g, function (_, i) { return codes[i]; });
  }
  function list(items) {
    return "<ul>" + items.map(function (i) { return "<li>" + inline(i) + "</li>"; }).join("") + "</ul>";
  }
  function paragraphs(text) {
    if (!text) return "";
    return String(text).split("\n\n").map(function (t) { return "<p>" + inline(t) + "</p>"; }).join("");
  }

  function codeTabs(files) {
    if (!files || !files.length) return "";
    var gid = "code" + (uid++);
    var tabs = files.map(function (f, i) {
      return '<button class="tab" role="tab" data-g="' + gid + '" data-i="' + i + '" aria-selected="' + (i === 0) + '">' + esc(f.file) + "</button>";
    }).join("");
    var panes = files.map(function (f, i) {
      return '<pre class="pane" data-g="' + gid + '" data-i="' + i + '"' + (i ? " hidden" : "") + "><code>" + esc(f.body) + "</code></pre>";
    }).join("");
    return '<div class="codebox"><div class="tabs" role="tablist">' + tabs + "</div>" + panes + "</div>";
  }

  function dialogue(lines) {
    return '<div class="dialogue">' + lines.map(function (l) {
      var me = l.who === "you";
      return '<div class="line ' + (me ? "you" : "int") + '"><span class="avatar" aria-hidden="true">' + (me ? "🧑‍💻" : "🧐") + '</span>' +
        '<div class="bubble"><b>' + (me ? "You" : "Interviewer") + "</b>" + inline(l.text) + "</div></div>";
    }).join("") + "</div>";
  }

  // Previous / next across the whole learning path.
  function pager(type, id) {
    var flat = window.PATH, i = flat.findIndex(function (p) { return p.type === type && p.id === id; });
    if (i === -1) return "";
    var prev = flat[i - 1], next = flat[i + 1];
    return '<nav class="pager">' +
      (prev ? '<a href="' + prev.href + '">← ' + esc(prev.title) + "</a>" : "<span></span>") +
      (next ? '<a href="' + next.href + '">' + esc(next.title) + " →</a>" : "<span></span>") + "</nav>";
  }

  function crumbs(groupTitle, title) {
    return '<div class="crumbs"><a href="index.html">Home</a> / <a href="lld.html">Low Level Design</a> / ' +
      esc(groupTitle.replace(/^\d+\.\s*/, "")) + " / " + esc(title) + "</div>";
  }

  function relatedChips(ids) {
    if (!ids || !ids.length) return "";
    var chips = ids.map(function (r) {
      var t = window.PATH.find(function (x) { return x.id === r; });
      return t ? '<a class="chip" href="' + t.href + '">' + esc(t.title) + "</a>" : "";
    }).join("");
    return '<h2>Related</h2><div class="chips">' + chips + "</div>";
  }

  function bindTabs(host) {
    host.addEventListener("click", function (e) {
      var tab = e.target.closest(".tab");
      if (!tab) return;
      var g = tab.dataset.g, i = tab.dataset.i;
      host.querySelectorAll('[data-g="' + g + '"]').forEach(function (el) {
        if (el.classList.contains("tab")) el.setAttribute("aria-selected", el.dataset.i === i);
        else el.hidden = el.dataset.i !== i;
      });
    });
  }

  function find(store, id) {
    return (store || []).find(function (x) { return x.id === id; });
  }

  return { esc: esc, inline: inline, list: list, paragraphs: paragraphs, codeTabs: codeTabs,
           dialogue: dialogue, pager: pager, crumbs: crumbs, relatedChips: relatedChips,
           bindTabs: bindTabs, find: find };
})();
