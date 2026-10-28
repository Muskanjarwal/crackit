(function () {
  var id = new URLSearchParams(location.search).get("id");
  var host = document.getElementById("article");
  var p = R.find(window.PATTERNS, id);
  var meta = R.find(window.PATH.filter(function (x) { return x.type === "pattern"; }), id);
  if (!p || !meta) {
    document.getElementById("missing").style.display = "block";
    return;
  }
  document.title = p.name + " – Design Patterns – CrackIt";

  var h = R.crumbs("Design Patterns", p.name);
  h += "<h1>" + R.esc(p.name) + "</h1>";
  h += '<div class="meta"><span class="badge ' + p.difficulty + '">' + p.difficulty + '</span> <span class="tag">' + R.esc(p.category) + "</span></div>";

  h += "<h2>Understanding the pattern</h2><blockquote>" + R.inline(p.understanding) + "</blockquote>";

  h += "<h2>The problem</h2><p>" + R.inline(p.problem.intro) + "</p>";
  if (p.problem.dialogue) h += R.dialogue(p.problem.dialogue);
  if (p.problem.requirements) h += "<h3>Distilled requirements</h3>" + R.list(p.problem.requirements);

  if (p.badApproach) {
    h += "<h2>The naive approach</h2>" + R.paragraphs(p.badApproach.text);
    h += R.codeTabs([{ file: "Naive.java", body: p.badApproach.code }]);
    if (p.badApproach.why) h += '<div class="callout warn"><b>Why it breaks</b>' + R.list(p.badApproach.why) + "</div>";
  }

  h += "<h2>Class design</h2>";
  p.design.forEach(function (step, i) {
    h += "<h3>" + (i + 1) + ". " + R.esc(step.heading) + "</h3>" + R.paragraphs(step.text) + R.codeTabs(step.code);
    if (step.note) h += '<div class="callout"><b>Note</b>' + R.inline(step.note) + "</div>";
  });

  h += "<h2>Putting it together</h2>" + R.paragraphs(p.usage.text) + R.codeTabs(p.usage.code);

  h += '<div class="two-col"><div><h2>Use it when</h2>' + R.list(p.whenToUse) + "</div>" +
       "<div><h2>Skip it when</h2>" + R.list(p.whenNotToUse) + "</div></div>";

  h += '<h2>Common mistakes</h2><div class="callout warn">' + R.list(p.mistakes) + "</div>";

  if (p.deepDive && p.deepDive.length) {
    h += "<h2>Deep dive</h2>";
    p.deepDive.forEach(function (d, i) {
      h += "<h3>" + (i + 1) + ". " + R.esc(d.title) + "</h3>" + R.paragraphs(d.text) + R.codeTabs(d.code);
    });
  }

  if (p.usedIn && p.usedIn.length) h += "<h2>Where it shows up in interviews</h2>" + R.list(p.usedIn);
  h += R.relatedChips(p.related) + R.pager("pattern", id);

  host.innerHTML = h;
  R.bindTabs(host);
})();
