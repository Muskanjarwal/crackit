# Content schema

Curriculum order, ids and one-line summaries live in `path.js`. Article content lives in `data-*.js` files and is keyed by the same ids. Inline markup allowed in any prose string: `**bold**` and `` `code` ``. Paragraphs inside `text` are separated by a blank line (`\n\n`). Code is Java unless a diagram.

## Lesson (`window.LESSONS.push({...})`, files `data-lessons-*.js`)

```js
{
  id: "composition",            // must match path.js
  name: "Composition",
  summary: "One-paragraph definition.",
  sections: [{ heading, text, code: [{file, body}]?, bullets: [..]?, note: ".."? }],
  takeaways: [".."],
  pitfalls: [".."],
  interviewQs: [{ q: "..", a: ".." }],
  related: ["aggregation", "inheritance"]   // any ids from path.js
}
```

## Pattern (`window.PATTERNS.push({...})`, files `data-patterns-*.js`)

See the Strategy entry in `data-patterns-behavioral-a.js`.

## Interview question (`window.QUESTIONS.push({...})`, files `data-questions-*.js`)

Modelled on a long-form breakdown: requirements dialogue, entities, one design step per requirement, deep dives.

```js
{
  id: "parking-lot",            // must match path.js
  name: "Design Parking Lot",
  difficulty: "easy",
  understanding: "One paragraph on what the system must do and the central difficulty.",
  dialogue: [{ who: "you" | "int", text }],            // requirements Q&A
  requirements: [{ group: "Core" | "Concurrency" | "Extensibility", items: [".."] }],
  entities: [{ name: "Vehicle", text: "what it models" }],
  design: [{ heading: "Requirement 1: ...", text, code: [{file, body}], note? }],
  deepDive: [{ title, text, code? }],
  mistakes: [".."],
  followups: [".."],
  patterns: ["strategy", "state"]                       // pattern ids actually used
}
```

## Full solution (`window.SOLUTIONS.push({...})`, files `data-solutions-*.js`)

Optional deeper layer for an interview question, keyed by the same id. Rendered after "Class design". All Java must compile and run with plain `javac` (no external libraries); `driver.output` and `tests.output` are the real output of running it.

```js
{
  id: "parking-lot",
  intro: "How the solution is organised and which requirement each step satisfies.",
  steps: [{ title: "Requirement 1: ...", text, code: [{file, body}] }],   // incremental build-up, in requirement order
  files: [{ file: "ParkingLot.java", body }],                           // every class, consolidated and compilable
  driver: { text, file: "Main.java", body, output },                    // runnable demo + captured stdout
  tests: { file: "Tests.java", cases: ["what each test asserts", ...], body, output },   // plain-Java assertions, runnable with `java`
  complexity: ["get: O(1)", ...]
}
```

## Concurrency scenarios (`window.CONCURRENCY.push({...})`, files `data-concurrency-*.js`)

One entry per interview question id, 2-3 scenarios each, rendered after "Deep dive". Scenarios must be specific to that domain (last parking spot, two withdrawals from one account, last copy of a book...). Code snippets must be self-contained, compile with `javac`, and show the fix (a bad version may appear in the `race` text or as a first code tab).

```js
{
  id: "parking-lot",
  scenarios: [{
    title: "Two cars, one last spot",
    race: "Concrete interleaving that causes the bug, step by step.",
    why: "Root cause (check-then-act, lost update, ...).",
    fix: "The chosen technique and why it fits here.",
    code: [{ file: "SpotAllocator.java", body }],
    alternatives: ["Other valid approaches and when to prefer them"],
    say: "A short script of how to explain this to the interviewer."
  }]
}
```

## Scenario drill (`window.SCENARIOS.push({...})`, files `data-scenarios-*.js`)

A short, design-independent interview scenario with several ways to handle it, each tied to a concept. Ids and titles live in `path.js` (groups `sc-*`). Concept ids may be any lesson, pattern, question or scenario id from `path.js`.

```js
{
  id: "last-item-in-stock",
  prompt: "How the interviewer phrases it, in one or two sentences.",
  context: "Realistic setup, 1-2 short paragraphs (blank line separated).",
  whyHard: "Why the naive approach fails / what makes it subtle.",
  options: [{                        // 3-4 genuinely different approaches
    name: "Atomic conditional update",
    concept: "Atomic operations / compare-and-swap",
    conceptIds: ["atomic-operations-cas", "database-locking"],
    how: "How it works.",
    code: [{ file: "X.java", body }],   // optional, must compile when self-contained
    pros: [".."], cons: [".."],
    pickWhen: "One-line decision rule."
  }],
  recommendation: "What you would choose and why, and what you would revisit as constraints change.",
  say: "Short script for saying it aloud.",
  appearsIn: ["limited-stock-cart", "movie-ticket-booking"],   // question ids
  related: ["race-conditions"]
}
```
