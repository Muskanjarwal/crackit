(function () {
  var id = new URLSearchParams(location.search).get("id");
  var host = document.getElementById("article");
  var l = R.find(window.LESSONS, id);
  var meta = R.find(window.PATH.filter(function (x) { return x.type === "lesson"; }), id);
  if (!l || !meta) {
    document.getElementById("missing").style.display = "block";
    return;
  }
  document.title = l.name + " – CrackIt";

  var h = R.crumbs(meta.groupTitle, l.name);
  h += "<h1>" + R.esc(l.name) + "</h1>";
  h += "<h2>In a nutshell</h2><blockquote>" + R.inline(l.summary) + "</blockquote>";

  l.sections.forEach(function (s) {
    h += "<h2>" + R.esc(s.heading) + "</h2>" + R.paragraphs(s.text) + R.codeTabs(s.code);
    if (s.bullets) h += R.list(s.bullets);
    if (s.note) h += '<div class="callout"><b>Note</b>' + R.inline(s.note) + "</div>";
  });

  if (l.takeaways && l.takeaways.length) h += "<h2>Key takeaways</h2>" + R.list(l.takeaways);
  if (l.pitfalls && l.pitfalls.length) h += '<h2>Common mistakes</h2><div class="callout warn">' + R.list(l.pitfalls) + "</div>";

  if (l.interviewQs && l.interviewQs.length) {
    h += "<h2>Interview questions</h2>";
    l.interviewQs.forEach(function (q) {
      h += '<details class="qa"><summary>' + R.inline(q.q) + "</summary>" + R.paragraphs(q.a) + "</details>";
    });
  }

  h += R.relatedChips(l.related) + R.pager("lesson", id);
  host.innerHTML = h;
  R.bindTabs(host);
})();
