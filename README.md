# CrackIt: SDE interview prep

A static site (plain HTML, CSS and JavaScript, no build step) with a single learning path for low level design interviews.

| Section | Count |
|---|---|
| Lessons (OOP, principles, UML, concurrency and locking, interview framework) | 34 |
| Design patterns | 23 |
| Interview questions, each with concurrency scenarios | 41 |
| Full compiled solutions (source, demo output, tests) | 24 |
| Scenario drills (options per scenario, tied to concepts) | 44 |

Start at `index.html`; the path itself is `lld.html`. Progress and theme are stored in the visitor's browser only (`localStorage`). The site makes no network requests.

Built by [@MuskanJarwal](https://github.com/MuskanJarwal).

## Run locally

```sh
python3 -m http.server 8000   # then open http://localhost:8000
```

Opening `index.html` directly also works.

## Deploy

All links are relative, so it works at the domain root or under a subpath.

**GitHub Pages**

```sh
git init && git add . && git commit -m "Initial site"
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

Then in the repo: Settings → Pages → Deploy from branch → `main` / root. The site is at `https://<you>.github.io/<repo>/`.

**Netlify**: drag the folder onto app.netlify.com/drop, or connect the repo (`netlify.toml` is included; publish directory is `.`).

**Vercel**: `npx vercel --prod` in this folder (`vercel.json` is included).

## Adding content

The curriculum order, ids and one-line summaries live in `path.js`. Article bodies live in `data-*.js` files keyed by the same ids. The exact formats are in [CONTENT-SCHEMA.md](CONTENT-SCHEMA.md).

```
path.js                    curriculum manifest (flow, ids, summaries)
data-lessons-*.js          theory lessons
data-patterns-*.js         design pattern breakdowns
data-questions-*.js        interview question breakdowns
data-solutions-*.js        full solutions (Java source, output, tests)
data-concurrency-*.js      per-question concurrency scenarios
data-scenarios-*.js        scenario drills
lesson.js / pattern.js / question.js / scenario.js   page renderers
render-utils.js            shared rendering helpers
```

## Notes

- The Java in the lessons, solutions and scenario drills was compiled with plain `javac`. Database (JDBC) and Redis examples are illustrative: they were compiled or run against in-memory fakes, not a real database or Redis.
- The topic list was inspired by public LLD curricula (AlgoMaster, a LeetCode community post). All explanations, code and structure are original.
