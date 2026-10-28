// The LLD track is the learning path defined in path.js, in order.
window.TRACKS = window.TRACKS || {};
window.TRACKS.lld = {
  sections: window.PATH_GROUPS.map(function (g) {
    return {
      id: g.id,
      title: g.title,
      blurb: g.blurb,
      items: g.items.map(function (it) {
        return {
          id: it.type + "-" + it.id,
          title: it.title,
          href: it.href,
          difficulty: it.type === "lesson" ? undefined : it.difficulty,
          tags: [{ pattern: "pattern", question: "interview", scenario: "scenario" }[it.type] || "theory"],
          desc: it.desc
        };
      })
    };
  })
};
