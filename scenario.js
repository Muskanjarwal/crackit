(function () {
  var id = new URLSearchParams(location.search).get("id");
  var host = document.getElementById("article");
  var s = R.find(window.SCENARIOS, id);
  var meta = R.find(window.PATH.filter(function (x) { return x.type === "scenario"; }), id);
  if (!s || !meta) {
    document.getElementById("missing").style.display = "block";
    return;
  }
  document.title = meta.title + " – Scenario Drill – CrackIt";

  function conceptChips(ids) {
    return (ids || []).map(function (c) {
      var t = window.PATH.find(function (x) { return x.id === c; });
      return t ? '<a class="chip" href="' + t.href + '">' + R.esc(t.title) + "</a>" : "";
    }).join("");
  }

  var h = R.crumbs(meta.groupTitle, meta.title);
  h += "<h1>" + R.esc(meta.title) + "</h1>";
  h += '<div class="meta"><span class="badge ' + meta.difficulty + '">' + meta.difficulty + "</span></div>";

  h += "<h2>The scenario</h2><blockquote>" + R.inline(s.prompt) + "</blockquote>" + R.paragraphs(s.context);
  h += "<h2>Why it's hard</h2>" + R.paragraphs(s.whyHard);

  h += "<h2>Ways to handle it</h2>";
  s.options.forEach(function (o, i) {
    h += '<section class="option"><h3>Option ' + (i + 1) + ": " + R.esc(o.name) + "</h3>";
    h += '<div class="concept"><b>Concept</b> ' + R.esc(o.concept) + (o.conceptIds && o.conceptIds.length ? ' <span class="chips">' + conceptChips(o.conceptIds) + "</span>" : "") + "</div>";
    h += R.paragraphs(o.how) + R.codeTabs(o.code);
    h += '<div class="two-col"><div><h4>Pros</h4>' + R.list(o.pros) + "</div><div><h4>Cons</h4>" + R.list(o.cons) + "</div></div>";
    h += '<div class="callout"><b>Pick it when</b>' + R.inline(o.pickWhen) + "</div></section>";
  });

  h += "<h2>At a glance</h2>" + '<div class="tablewrap"><table class="compare"><thead><tr><th>Option</th><th>Concept</th><th>Best when</th></tr></thead><tbody>' +
    s.options.map(function (o) {
      return "<tr><td>" + R.esc(o.name) + "</td><td>" + R.esc(o.concept) + "</td><td>" + R.inline(o.pickWhen) + "</td></tr>";
    }).join("") + "</tbody></table></div>";

  h += "<h2>What I'd choose</h2>" + R.paragraphs(s.recommendation);
  if (s.say) h += '<div class="callout"><b>How to say it in the interview</b>' + R.inline(s.say) + "</div>";

  if (s.appearsIn && s.appearsIn.length) {
    h += "<h2>Where it shows up</h2><div class=\"chips\">" + conceptChips(s.appearsIn) + "</div>";
  }
  h += R.relatedChips(s.related) + R.pager("scenario", id);

  host.innerHTML = h;
  R.bindTabs(host);
})();
