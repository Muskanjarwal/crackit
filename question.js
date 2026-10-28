(function () {
  var id = new URLSearchParams(location.search).get("id");
  var host = document.getElementById("article");
  var q = R.find(window.QUESTIONS, id);
  var meta = R.find(window.PATH.filter(function (x) { return x.type === "question"; }), id);
  if (!q || !meta) {
    document.getElementById("missing").style.display = "block";
    return;
  }
  document.title = q.name + " – LLD Interview Question – CrackIt";

  var h = R.crumbs(meta.groupTitle, q.name);
  h += "<h1>" + R.esc(q.name) + "</h1>";
  h += '<div class="meta"><span class="badge ' + q.difficulty + '">' + q.difficulty + "</span></div>";

  h += "<h2>Understanding the system</h2><blockquote>" + R.inline(q.understanding) + "</blockquote>";

  h += "<h2>Requirements gathering</h2>";
  if (q.dialogue) h += R.dialogue(q.dialogue);
  h += "<h3>Distilled requirements</h3>";
  q.requirements.forEach(function (g) {
    h += "<h4>" + R.esc(g.group) + "</h4>" + '<ol class="reqs">' + g.items.map(function (i) { return "<li>" + R.inline(i) + "</li>"; }).join("") + "</ol>";
  });

  h += "<h2>Core entities</h2><ul>" + q.entities.map(function (e) {
    return "<li><strong>" + R.esc(e.name) + "</strong>: " + R.inline(e.text) + "</li>";
  }).join("") + "</ul>";

  h += "<h2>Class design</h2>";
  q.design.forEach(function (s) {
    h += "<h3>" + R.esc(s.heading) + "</h3>" + R.paragraphs(s.text) + R.codeTabs(s.code);
    if (s.note) h += '<div class="callout"><b>Note</b>' + R.inline(s.note) + "</div>";
  });

  var sol = R.find(window.SOLUTIONS, id);
  if (sol) {
    h += "<h2>Full solution</h2>" + R.paragraphs(sol.intro);
    h += "<h3>Build it step by step</h3>";
    sol.steps.forEach(function (s, i) {
      h += "<h4>Step " + (i + 1) + ": " + R.esc(s.title) + "</h4>" + R.paragraphs(s.text) + R.codeTabs(s.code);
    });
    h += "<h3>Complete source</h3><p>Every file, ready to compile together.</p>" + R.codeTabs(sol.files);
    h += "<h3>Run it</h3>" + R.paragraphs(sol.driver.text) + R.codeTabs([{ file: sol.driver.file, body: sol.driver.body }]);
    h += '<div class="output"><b>Output</b><pre><code>' + R.esc(sol.driver.output) + "</code></pre></div>";
    if (sol.tests) {
      h += "<h3>Test cases</h3>" + R.list(sol.tests.cases) + R.codeTabs([{ file: sol.tests.file, body: sol.tests.body }]);
      if (sol.tests.output) h += '<div class="output"><b>Test output</b><pre><code>' + R.esc(sol.tests.output) + "</code></pre></div>";
    }
    if (sol.complexity && sol.complexity.length) h += "<h3>Complexity</h3>" + R.list(sol.complexity);
  }

  if (q.deepDive && q.deepDive.length) {
    h += "<h2>Deep dive</h2>";
    q.deepDive.forEach(function (d, i) {
      h += "<h3>" + (i + 1) + ". " + R.esc(d.title) + "</h3>" + R.paragraphs(d.text) + R.codeTabs(d.code);
    });
  }

  var cc = R.find(window.CONCURRENCY, id);
  if (cc) {
    h += "<h2>Concurrency scenarios</h2>" +
      '<p>What happens when many users hit this system at the same moment, and how to stop it. New to locking? Read <a href="lesson.html?id=race-conditions">Race Conditions</a>, <a href="lesson.html?id=optimistic-vs-pessimistic-locking">Optimistic vs Pessimistic Locking</a> and <a href="lesson.html?id=reservation-with-ttl">Reservation with Expiry</a> first.</p>';
    cc.scenarios.forEach(function (s, i) {
      h += "<h3>" + (i + 1) + ". " + R.esc(s.title) + "</h3>";
      h += '<div class="callout warn"><b>The race</b>' + R.inline(s.race) + "</div>";
      h += "<h4>Why it breaks</h4>" + R.paragraphs(s.why);
      h += "<h4>The fix</h4>" + R.paragraphs(s.fix) + R.codeTabs(s.code);
      if (s.alternatives) h += "<h4>Other options</h4>" + R.list(s.alternatives);
      if (s.say) h += '<div class="callout"><b>How to say it in the interview</b>' + R.inline(s.say) + "</div>";
    });
  }

  if (q.mistakes && q.mistakes.length) h += '<h2>Common mistakes</h2><div class="callout warn">' + R.list(q.mistakes) + "</div>";
  if (q.followups && q.followups.length) h += "<h2>Follow-up questions</h2>" + R.list(q.followups);

  h += R.relatedChips(q.patterns) + R.pager("question", id);
  host.innerHTML = h;
  R.bindTabs(host);
})();
