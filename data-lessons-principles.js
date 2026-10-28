window.LESSONS = window.LESSONS || [];
window.LESSONS.push(
  {
    id: "dry",
    name: "Don't Repeat Yourself (DRY)",
    summary: "Every piece of **knowledge** in a system should have a single, authoritative representation. DRY is about duplicated business rules and decisions, not about two lines of code that happen to look alike.",
    sections: [
      {
        heading: "The principle",
        text: "When the same rule lives in two places, they will eventually disagree. Someone fixes a bug in one copy, forgets the other, and the system now behaves inconsistently.\n\nDRY asks you to give each rule, constant, algorithm or schema exactly one home, and have everything else refer to it.",
        bullets: [
          "Duplicated **knowledge** is the enemy: tax rates, validation rules, pricing formulas, status transitions.",
          "Duplicated **text** is only a problem when both copies must change together."
        ]
      },
      {
        heading: "A violating example",
        text: "Tax is computed in the cart and again on the invoice. Product raises the rate from 18% to 20% and one place is missed.",
        code: [
          { file: "Cart.java", body: "public class Cart {\n  private final List<Item> items;\n\n  public double total() {\n    double subtotal = 0;\n    for (Item i : items) subtotal += i.price() * i.quantity();\n    return subtotal + subtotal * 0.18;   // tax rule #1\n  }\n}" },
          { file: "Invoice.java", body: "public class Invoice {\n  private final List<Item> items;\n\n  public double amountDue() {\n    double subtotal = 0;\n    for (Item i : items) subtotal += i.price() * i.quantity();\n    return subtotal + subtotal * 0.18;   // tax rule #2, same knowledge\n  }\n}" }
        ]
      },
      {
        heading: "The refactor",
        text: "Move the rule into one class and make both callers depend on it. Now the rate changes in exactly one line.",
        code: [
          { file: "PriceCalculator.java", body: "public class PriceCalculator {\n  private static final double TAX_RATE = 0.18;\n\n  public double subtotal(List<Item> items) {\n    double sum = 0;\n    for (Item i : items) sum += i.price() * i.quantity();\n    return sum;\n  }\n\n  public double totalWithTax(List<Item> items) {\n    double sub = subtotal(items);\n    return sub + sub * TAX_RATE;\n  }\n}" },
          { file: "Cart.java", body: "public class Cart {\n  private final List<Item> items;\n  private final PriceCalculator calculator;\n\n  public Cart(List<Item> items, PriceCalculator calculator) {\n    this.items = items;\n    this.calculator = calculator;\n  }\n\n  public double total() { return calculator.totalWithTax(items); }\n}" }
        ]
      },
      {
        heading: "Accidental duplication",
        text: "Two blocks that look identical but change for different reasons are **not** a DRY violation. A shipping-address validator and a billing-address validator may start the same and diverge once billing needs a tax ID.\n\nMerging them couples two reasons to change. A useful guideline is the rule of three: tolerate the second copy, extract on the third once you can see what is truly shared.",
        note: "A wrong abstraction is more expensive than duplication. If every caller needs a flag to bend the shared code, it was not the same knowledge."
      },
      {
        heading: "Benefits and trade-offs",
        bullets: [
          "Benefit: one place to fix bugs and change rules, so fewer inconsistencies.",
          "Benefit: smaller code, easier to read and test.",
          "Trade-off: a shared module is a dependency. Changing it affects every caller.",
          "Trade-off: over-eager extraction hides intent behind generic helpers."
        ]
      },
      {
        heading: "How to spot violations",
        bullets: [
          "Copy-pasted blocks with small edits.",
          "The same magic number or string literal in several files.",
          "A bug fix that needs the same change in more than one place (shotgun surgery).",
          "Parallel if/else or switch chains over the same type in several classes."
        ]
      }
    ],
    takeaways: [
      "DRY is about knowledge: one rule, one home.",
      "Extract after you understand what is genuinely shared, not at the first sign of similarity.",
      "Prefer a named constant or a small class over copying a number or formula."
    ],
    pitfalls: [
      "Merging code that only looks similar and then fighting flags and special cases.",
      "Creating a giant Utils class that everything depends on.",
      "Applying DRY across service boundaries and creating tight coupling between teams.",
      "Forgetting that tests are code too, and extracting so much that tests become unreadable."
    ],
    interviewQs: [
      { q: "Is duplicated code always a DRY violation?", a: "No. DRY targets duplicated knowledge. Two similar blocks that change for different reasons should stay separate, because merging them couples unrelated concerns. Ask: if one changes, must the other change too? If yes, extract; if not, leave them." },
      { q: "How does DRY relate to the Open/Closed Principle?", a: "Removing duplication usually creates the single extension point that OCP wants. Once a rule lives behind one abstraction, you can add behaviour by adding a class instead of editing every copy." },
      { q: "What is the downside of DRY taken too far?", a: "You get abstractions with many flags and conditionals, tangled dependencies, and utility classes that everything imports. Changing one use case then risks breaking the others. Duplication is cheaper than the wrong abstraction." },
      { q: "How would you remove duplication across two microservices?", a: "Usually accept some duplication, or share a versioned library or an API contract. A shared code module couples release cycles, so share only stable, well-defined knowledge." }
    ],
    related: ["kiss", "yagni", "srp", "ocp"]
  },

  {
    id: "kiss",
    name: "Keep It Simple Stupid (KISS)",
    summary: "Prefer the simplest design that solves the problem. Complexity should be earned by a real requirement, because every extra class, layer and abstraction is something a teammate has to read and maintain.",
    sections: [
      {
        heading: "The principle",
        text: "Simple does not mean easy or short. It means few moving parts and obvious behaviour. A reader should be able to predict what the code does without tracing through layers of indirection.\n\nSimplicity is a design goal you have to protect, since complexity accumulates one reasonable-looking decision at a time."
      },
      {
        heading: "A violating example",
        text: "A requirement says: orders over 100 get 10% off. The over-engineered version arrives with a factory, a strategy interface and a registry for a rule that is one line long.",
        code: [
          { file: "OverEngineered.java", body: "interface DiscountStrategy { double apply(double amount); }\n\nclass TenPercentDiscount implements DiscountStrategy {\n  public double apply(double amount) { return amount * 0.9; }\n}\n\nclass NoDiscount implements DiscountStrategy {\n  public double apply(double amount) { return amount; }\n}\n\nclass DiscountStrategyFactory {\n  private final Map<String, DiscountStrategy> registry = new HashMap<>();\n  DiscountStrategyFactory() {\n    registry.put(\"TEN\", new TenPercentDiscount());\n    registry.put(\"NONE\", new NoDiscount());\n  }\n  DiscountStrategy forAmount(double amount) {\n    return registry.get(amount > 100 ? \"TEN\" : \"NONE\");\n  }\n}" }
        ]
      },
      {
        heading: "The simple version",
        text: "One method that states the rule. If a second and third discount type genuinely arrive, refactor then. Moving from a simple method to Strategy is cheap, but removing an unneeded framework is not.",
        code: [
          { file: "Simple.java", body: "class PriceCalculator {\n  double discounted(double amount) {\n    return amount > 100 ? amount * 0.9 : amount;\n  }\n}" }
        ]
      },
      {
        heading: "Simple is not simplistic",
        text: "KISS does not forbid abstractions. A State pattern for an ATM with five distinct states is the simple option, because the alternative is a nest of flags and conditionals. Measure simplicity by how hard the whole design is to understand and change, not by class count.",
        note: "A useful test: could a new teammate explain this module back to you after reading it once?"
      },
      {
        heading: "Benefits and trade-offs",
        bullets: [
          "Benefit: faster onboarding, fewer bugs, easier debugging.",
          "Benefit: simple code is cheaper to change when requirements move.",
          "Trade-off: the simplest design today may need refactoring when a second variant appears.",
          "Trade-off: team members may disagree on what counts as simple."
        ]
      },
      {
        heading: "How to spot violations",
        bullets: [
          "Interfaces with exactly one implementation and no plan for a second.",
          "Several layers that only forward calls to the next layer.",
          "Clever one-liners, deep generics or reflection where a loop would do.",
          "You need a diagram to explain a feature that fits in three sentences."
        ]
      }
    ],
    takeaways: [
      "Solve today's problem in the most direct way that stays readable.",
      "Introduce patterns when a concrete pain shows up, not in anticipation of it.",
      "Fewer moving parts means fewer places for bugs to hide."
    ],
    pitfalls: [
      "Equating simple with short and writing cryptic one-liners.",
      "Using KISS as an excuse to skip structure, producing one 500-line method.",
      "Pattern-dropping in an interview to look sophisticated. Design patterns are good to have, but don't force one in just to impress the interviewer."
    ],
    interviewQs: [
      { q: "How do you decide between a simple design and a flexible one?", a: "Check whether the flexibility is backed by a stated or very likely requirement. If the interviewer said new payment methods will be added, an interface is the simple answer. If nobody asked for it, start direct and refactor when the second variant arrives." },
      { q: "Can a design pattern violate KISS?", a: "Yes, when it is applied without a problem to solve. Strategy for a single algorithm adds classes and indirection with no payoff. The same pattern is the simplest solution when you have many interchangeable behaviours." },
      { q: "How do KISS and extensibility coexist?", a: "Keep the current design simple but leave seams: small classes, clear interfaces at real variation points, dependencies injected. Those cost almost nothing and make later extension cheap." }
    ],
    related: ["yagni", "dry", "ocp", "strategy"]
  },

  {
    id: "yagni",
    name: "You Aren't Gonna Need It (YAGNI)",
    summary: "Do not build functionality, hooks or abstractions until a real requirement demands them. Speculative features cost time now and usually guess wrong anyway.",
    sections: [
      {
        heading: "The principle",
        text: "Developers are good at imagining future needs and bad at predicting them. Code written for a hypothetical use case still has to be written, tested, documented and kept compiling, and when the real requirement arrives it rarely matches the guess.\n\nYAGNI says: build what is needed now, keep the design clean enough to change, and add more when the need is real."
      },
      {
        heading: "A violating example",
        text: "The requirement is to send an email receipt. The design below adds a pluggable channel registry, priority levels and a retry policy that nobody asked for.",
        code: [
          { file: "Speculative.java", body: "class NotificationService {\n  private final Map<String, Channel> channels = new HashMap<>();\n  private RetryPolicy retryPolicy = new ExponentialBackoff();\n  private PriorityResolver priority = new DefaultPriorityResolver();\n\n  void register(String name, Channel channel) { channels.put(name, channel); }\n\n  void send(String channelName, Message m, Priority p) {\n    Channel c = channels.get(channelName);\n    retryPolicy.execute(() -> c.deliver(m, priority.resolve(p)));\n  }\n}" }
        ]
      },
      {
        heading: "The YAGNI version",
        text: "Send the email. The class is small, obvious and easy to extend later because nothing is baked in.",
        code: [
          { file: "ReceiptMailer.java", body: "class ReceiptMailer {\n  private final EmailClient client;\n\n  ReceiptMailer(EmailClient client) { this.client = client; }\n\n  void sendReceipt(Order order) {\n    client.send(order.customerEmail(), \"Your receipt\", render(order));\n  }\n}" }
        ],
        note: "If SMS arrives next quarter, extract a `Notifier` interface then. You will know the real shape of the abstraction because you will have two concrete cases."
      },
      {
        heading: "YAGNI in interviews",
        text: "YAGNI is not a license to ignore stated requirements. When the interviewer says new seat types or payment methods will be added, that is a **requirement** for extensibility and an interface is justified.\n\nThe skill is separating requirements you were given from features you imagined. Ask clarifying questions, and design for the first group."
      },
      {
        heading: "Benefits and trade-offs",
        bullets: [
          "Benefit: less code to write, test and maintain.",
          "Benefit: designs are shaped by real use, so abstractions fit.",
          "Trade-off: you may refactor later. That is acceptable when code is well tested and loosely coupled.",
          "Trade-off: some changes are genuinely expensive later, such as public APIs and database schemas. Weigh those separately."
        ]
      },
      {
        heading: "How to spot violations",
        bullets: [
          "Unused parameters, config flags and extension points.",
          "Interfaces, base classes or plugin systems with a single implementation.",
          "Comments such as 'in case we need this later'.",
          "Generic frameworks built before the second use case exists."
        ]
      }
    ],
    takeaways: [
      "Build for requirements you have, not requirements you imagine.",
      "Keep code clean and tested so adding features later is cheap.",
      "Stated extensibility needs are real requirements, not speculation."
    ],
    pitfalls: [
      "Using YAGNI to justify ignoring requirements the interviewer explicitly gave.",
      "Skipping cheap seams such as dependency injection that make later change easy.",
      "Applying it to irreversible decisions like public API shape or data model without thought.",
      "Treating any abstraction as speculative, even when two implementations already exist."
    ],
    interviewQs: [
      { q: "How is YAGNI different from KISS?", a: "KISS is about how complicated the solution to a current problem is. YAGNI is about whether you should solve a problem at all yet. A feature can be implemented simply and still violate YAGNI if nobody needs it." },
      { q: "The interviewer says 'more vehicle types may come later'. Is adding an interface a YAGNI violation?", a: "No. A stated extension point is a requirement. The interface is justified because the variation is explicit. YAGNI would object to adding unrelated hooks that nobody mentioned." },
      { q: "When is it right to build something before it is needed?", a: "When delaying is very costly: a public API contract, a data schema that is painful to migrate, or a security boundary. For ordinary internal code, wait." },
      { q: "How does good testing support YAGNI?", a: "Tests let you refactor safely when the requirement does show up. Without them, teams over-build upfront because they fear changing code later." }
    ],
    related: ["kiss", "ocp", "dry"]
  },

  {
    id: "law-of-demeter",
    name: "Law of Demeter (LoD)",
    summary: "A method should only talk to its immediate friends: itself, its parameters, objects it creates and its own fields. It should not reach through one object to manipulate another. Also called the principle of least knowledge.",
    sections: [
      {
        heading: "The principle",
        text: "Chains such as `order.getCustomer().getAddress().getCity()` force the caller to know the internal structure of three classes. If `Address` changes, code far away breaks.\n\nA method `m` of object `O` may call methods on:",
        bullets: [
          "`O` itself,",
          "`m`'s parameters,",
          "objects `m` creates or instantiates,",
          "`O`'s direct component objects (fields)."
        ],
        note: "A quick heuristic: count the dots. More than one dot on a non-fluent chain is a hint, not a hard rule."
      },
      {
        heading: "A violating example",
        text: "The shipping service digs through the order to find the city, so it knows the whole object graph.",
        code: [
          { file: "ShippingService.java", body: "class ShippingService {\n  double fee(Order order) {\n    String city = order.getCustomer().getAddress().getCity();\n    boolean metro = order.getCustomer().getAddress().isMetro();\n    return metro ? 40 : 90;\n  }\n}" }
        ]
      },
      {
        heading: "The refactor: tell, don't ask",
        text: "Ask the object you hold to do the work, and let it delegate internally. The caller depends on one class and its question, not on the structure behind it.",
        code: [
          { file: "Order.java", body: "class Order {\n  private final Customer customer;\n\n  boolean isDeliveredToMetro() {\n    return customer.livesInMetro();\n  }\n}" },
          { file: "Customer.java", body: "class Customer {\n  private final Address address;\n\n  boolean livesInMetro() {\n    return address.isMetro();\n  }\n}" },
          { file: "ShippingService.java", body: "class ShippingService {\n  double fee(Order order) {\n    return order.isDeliveredToMetro() ? 40 : 90;\n  }\n}" }
        ]
      },
      {
        heading: "Trade-offs",
        text: "Delegating methods reduce coupling but add small forwarding methods. Too many of them turn a class into a bag of pass-throughs.",
        bullets: [
          "Benefit: internal structure can change without rippling to callers.",
          "Benefit: behaviour lives next to the data it needs (better encapsulation).",
          "Cost: wrapper methods multiply if you apply it mechanically.",
          "Often a Facade is the right way to give callers one simple entry point."
        ]
      },
      {
        heading: "What is not a violation",
        bullets: [
          "Fluent builders and streams: `list.stream().filter(...).map(...)` operate on the same logical object.",
          "Plain data structures or DTOs whose purpose is to expose fields.",
          "Chains on values you were handed as parameters when the abstraction is the data itself."
        ]
      },
      {
        heading: "How to spot violations",
        bullets: [
          "Long getter chains, also called train wrecks.",
          "Callers that need to import classes they never directly use.",
          "A change to a deep class forces edits in distant callers.",
          "Tests need elaborate mock graphs to stub several levels deep."
        ]
      }
    ],
    takeaways: [
      "Talk to your direct collaborators, not to their collaborators.",
      "Tell objects what to do instead of pulling their data out to decide for them.",
      "Use delegation or a Facade to hide structure, but don't create pointless pass-throughs."
    ],
    pitfalls: [
      "Counting dots mechanically and flagging builders and streams.",
      "Creating dozens of one-line forwarding methods that add noise.",
      "Hiding a genuinely useful domain concept instead of modelling it properly."
    ],
    interviewQs: [
      { q: "What does 'tell, don't ask' mean?", a: "Instead of fetching an object's state and making decisions outside it, tell the object what you want done and let it use its own data. It keeps behaviour with the data and reduces coupling." },
      { q: "Is `a.getB().getC()` always a LoD violation?", a: "It is a warning sign, not an absolute rule. If `B` is a plain data holder or the chain is a fluent API, it is fine. The concern is knowing the internal structure of collaborators that may change." },
      { q: "How does LoD relate to encapsulation?", a: "LoD extends encapsulation from a single class to object graphs. Encapsulation hides a class's fields. LoD hides how objects are connected to each other." },
      { q: "How would you fix a violation without adding many wrapper methods?", a: "Introduce a Facade or a domain-level method that answers the real question, such as `order.shippingZone()`, instead of exposing every intermediate object." }
    ],
    related: ["encapsulation", "association", "facade", "dip"]
  },

  {
    id: "srp",
    name: "Single Responsibility Principle (SRP)",
    summary: "A class should have one, and only one, reason to change. A 'reason to change' maps to an actor or concern: when business, persistence or presentation requirements move, only the class that owns that concern should be edited.",
    sections: [
      {
        heading: "The principle",
        text: "SRP is not 'a class should do one thing'. It is 'a class should be responsible to one source of change'. If the finance team and the HR team can each request changes to the same class, that class has two responsibilities and two groups can break each other's work.\n\nMixing concerns also makes code hard to test, since you cannot exercise the business rule without a database."
      },
      {
        heading: "A violating example",
        text: "One class computes pay, writes to the database and renders a report. Finance, DBAs and the reporting team all have reasons to edit it.",
        code: [
          { file: "Employee.java", body: "class Employee {\n  private String name;\n  private double hourlyRate;\n  private int hours;\n\n  double calculatePay() {                // reason to change: finance rules\n    return hourlyRate * hours;\n  }\n\n  void save() {                          // reason to change: persistence\n    Connection c = Database.connect();\n    c.execute(\"INSERT INTO employees ...\");\n  }\n\n  String payslipHtml() {                 // reason to change: presentation\n    return \"<h1>\" + name + \"</h1><p>\" + calculatePay() + \"</p>\";\n  }\n}" }
        ]
      },
      {
        heading: "The refactor",
        text: "Split by reason to change. Each class is small, focused and testable in isolation.",
        code: [
          { file: "Employee.java", body: "class Employee {\n  private final String name;\n  private final double hourlyRate;\n  private final int hours;\n\n  Employee(String name, double hourlyRate, int hours) {\n    this.name = name;\n    this.hourlyRate = hourlyRate;\n    this.hours = hours;\n  }\n\n  String name() { return name; }\n  double calculatePay() { return hourlyRate * hours; }\n}" },
          { file: "EmployeeRepository.java", body: "interface EmployeeRepository {\n  void save(Employee employee);\n}\n\nclass SqlEmployeeRepository implements EmployeeRepository {\n  public void save(Employee e) {\n    // persistence only\n  }\n}" },
          { file: "PayslipRenderer.java", body: "class PayslipRenderer {\n  String html(Employee e) {\n    return \"<h1>\" + e.name() + \"</h1><p>\" + e.calculatePay() + \"</p>\";\n  }\n}" }
        ]
      },
      {
        heading: "Finding the right size",
        text: "Ask who would request this change. If the answer is two different people or teams, split. If it is the same person for the same reason, keep it together even if the class has several methods.",
        bullets: [
          "Cohesion is the goal: methods and fields in a class should belong together.",
          "A class named `Manager`, `Helper` or `Utils` often hides several responsibilities.",
          "Some orchestration classes legitimately coordinate collaborators. Coordination is one responsibility."
        ]
      },
      {
        heading: "Benefits and trade-offs",
        bullets: [
          "Benefit: changes are local, so fewer regressions and merge conflicts.",
          "Benefit: focused classes are easy to name, read and unit test.",
          "Trade-off: more classes and more wiring.",
          "Trade-off: splitting too early produces anemic pieces that are harder to follow than one cohesive class."
        ]
      },
      {
        heading: "How to spot violations",
        bullets: [
          "A class description that needs the word 'and'.",
          "Imports from unrelated layers: database, HTTP and UI in one file.",
          "Unit tests that need heavy setup unrelated to the behaviour under test.",
          "Frequent merge conflicts in the same file from different features."
        ]
      }
    ],
    takeaways: [
      "One reason to change means one actor or concern, not one method.",
      "Separate business rules, persistence and presentation.",
      "Cohesive classes are easier to test, name and evolve."
    ],
    pitfalls: [
      "Making a class per method, which scatters logic without improving cohesion.",
      "Splitting before there are two real reasons to change.",
      "Confusing SRP with 'small classes'. A cohesive 200-line class can satisfy SRP."
    ],
    interviewQs: [
      { q: "How do you define a 'responsibility'?", a: "A reason to change, tied to a stakeholder or concern such as business rules, storage format or output format. If two different groups could ask you to change the same class for different reasons, it has two responsibilities." },
      { q: "Does SRP mean every class has a single method?", a: "No. A class can have many methods as long as they serve one purpose and change together. Splitting every method into its own class destroys cohesion." },
      { q: "How does SRP help testing?", a: "With rules separated from I/O, you can unit test the business logic with plain objects and no database or network. Collaborators are replaced with fakes." },
      { q: "Give an SRP violation in a Parking Lot design.", a: "A `ParkingLot` class that finds spots, calculates fees, prints tickets and persists data. Split into a spot allocator, a pricing strategy, a ticket printer and a repository." }
    ],
    related: ["ocp", "isp", "encapsulation", "solid-summary"]
  },

  {
    id: "ocp",
    name: "Open/Closed Principle (OCP)",
    summary: "Software entities should be open for extension but closed for modification. You should be able to add new behaviour by writing new code, not by editing code that already works.",
    sections: [
      {
        heading: "The principle",
        text: "Every edit to a tested class risks breaking it. OCP says: identify the axis of change, put an abstraction in front of it, and let new variants be new classes.\n\nThe usual mechanism is polymorphism. Callers depend on an interface, and the set of implementations can grow without touching callers."
      },
      {
        heading: "A violating example",
        text: "Each new payment method forces an edit to this method, and every edit risks the existing branches.",
        code: [
          { file: "PaymentProcessor.java", body: "class PaymentProcessor {\n  Receipt pay(String type, double amount) {\n    if (type.equals(\"CARD\")) {\n      return chargeCard(amount);\n    } else if (type.equals(\"UPI\")) {\n      return chargeUpi(amount);\n    } else if (type.equals(\"WALLET\")) {\n      return chargeWallet(amount);\n    }\n    throw new IllegalArgumentException(type);\n  }\n}" }
        ]
      },
      {
        heading: "The refactor",
        text: "Pull the varying behaviour behind an interface. Adding Net Banking is a new class, with no change to `PaymentProcessor`.",
        code: [
          { file: "PaymentMethod.java", body: "interface PaymentMethod {\n  Receipt pay(double amount);\n}" },
          { file: "CardPayment.java", body: "class CardPayment implements PaymentMethod {\n  public Receipt pay(double amount) { /* charge card */ return new Receipt(amount); }\n}\n\nclass UpiPayment implements PaymentMethod {\n  public Receipt pay(double amount) { /* call UPI */ return new Receipt(amount); }\n}" },
          { file: "PaymentProcessor.java", body: "class PaymentProcessor {\n  Receipt checkout(PaymentMethod method, double amount) {\n    return method.pay(amount);\n  }\n}" }
        ]
      },
      {
        heading: "Where to apply it",
        text: "You cannot make everything closed to every kind of change. Pick the variation points that are real, stated or already observed, and protect those.",
        bullets: [
          "Good candidates: payment methods, pricing rules, notification channels, seat types, eviction policies.",
          "Good signal: a growing if/else or switch on a type code.",
          "Wait for the second variant if you are unsure, then refactor. Strategy and Decorator are common OCP tools."
        ]
      },
      {
        heading: "Benefits and trade-offs",
        bullets: [
          "Benefit: new features do not risk regressions in old ones.",
          "Benefit: variants can be developed and tested independently.",
          "Trade-off: more classes and an extra indirection to read through.",
          "Trade-off: the wrong abstraction is hard to extend and harder to remove."
        ]
      },
      {
        heading: "How to spot violations",
        bullets: [
          "A switch or if/else chain on type that grows with each feature.",
          "`instanceof` checks scattered through the code.",
          "Adding a feature requires editing several existing classes.",
          "Enum-based type codes that every caller branches on."
        ]
      }
    ],
    takeaways: [
      "Put an abstraction at the axis of change and extend with new classes.",
      "Apply OCP where variation is real, not everywhere.",
      "Replace type-code conditionals with polymorphism."
    ],
    pitfalls: [
      "Abstracting everything up front, which violates YAGNI and KISS.",
      "Choosing the abstraction before seeing two real variants.",
      "Believing a switch is always bad. A stable, closed set like days of the week is fine.",
      "Leaving the factory or wiring code as a new switch that still needs editing."
    ],
    interviewQs: [
      { q: "How do you get OCP without inheritance?", a: "Use composition: inject an interface implementation, such as a Strategy, or wrap behaviour with Decorators. The class stays closed while behaviour varies through the injected object." },
      { q: "Isn't adding a new class still a modification somewhere?", a: "Yes, you still wire the new class in at the composition root or a registry. OCP means the core logic stays untouched. The wiring is isolated and trivial compared with editing business logic." },
      { q: "When is a switch statement acceptable?", a: "When the cases are a small, closed, stable set, such as the four suits of cards, or at the boundary where objects are created. It is a problem when it recurs across the codebase and grows." },
      { q: "Which design patterns support OCP?", a: "Strategy, Decorator, Observer, Factory Method, Template Method and Command all provide extension points that let behaviour grow without editing the code that uses them." }
    ],
    related: ["strategy", "decorator", "lsp", "dip", "yagni"]
  },

  {
    id: "lsp",
    name: "Liskov Substitution Principle (LSP)",
    summary: "Objects of a subtype must be usable anywhere the base type is expected, without callers noticing or breaking. A subclass must honour the behavioural contract of its parent, not merely its method signatures.",
    sections: [
      {
        heading: "The principle",
        text: "Inheritance models 'is-a', but LSP says the relationship must hold in behaviour. If code written against `Rectangle` misbehaves when handed a `Square`, then `Square` is not a valid subtype of `Rectangle`, however natural it sounds in geometry.\n\nThe contract includes:",
        bullets: [
          "**Preconditions** cannot be strengthened in a subtype (it must accept at least what the parent accepts).",
          "**Postconditions** cannot be weakened (it must deliver at least what the parent promises).",
          "**Invariants** of the parent must be preserved.",
          "**No new checked failures**: don't throw exceptions callers do not expect."
        ]
      },
      {
        heading: "A violating example",
        text: "Callers assume that setting width does not change height. `Square` breaks that promise.",
        code: [
          { file: "Rectangle.java", body: "class Rectangle {\n  protected int width, height;\n\n  void setWidth(int w)  { this.width = w; }\n  void setHeight(int h) { this.height = h; }\n  int area() { return width * height; }\n}\n\nclass Square extends Rectangle {\n  @Override void setWidth(int w)  { this.width = w; this.height = w; }\n  @Override void setHeight(int h) { this.width = h; this.height = h; }\n}" },
          { file: "Client.java", body: "void resize(Rectangle r) {\n  r.setWidth(5);\n  r.setHeight(4);\n  assert r.area() == 20;   // fails for Square: area is 16\n}" }
        ]
      },
      {
        heading: "The refactor",
        text: "Stop forcing the hierarchy. Model the shared behaviour with an interface and let each shape own its invariants.",
        code: [
          { file: "Shape.java", body: "interface Shape {\n  int area();\n}\n\nfinal class Rectangle implements Shape {\n  private final int width, height;\n  Rectangle(int width, int height) { this.width = width; this.height = height; }\n  public int area() { return width * height; }\n}\n\nfinal class Square implements Shape {\n  private final int side;\n  Square(int side) { this.side = side; }\n  public int area() { return side * side; }\n}" }
        ],
        note: "Immutability also removes the whole class of problems: there are no setters to override in surprising ways."
      },
      {
        heading: "A second classic: the Bird that can't fly",
        text: "If `Bird` declares `fly()` and `Penguin` overrides it to throw `UnsupportedOperationException`, every caller iterating over birds can now crash. Split the hierarchy by capability.",
        code: [
          { file: "Birds.java", body: "interface Bird { void eat(); }\ninterface FlyingBird extends Bird { void fly(); }\n\nclass Sparrow implements FlyingBird {\n  public void eat() {}\n  public void fly() {}\n}\n\nclass Penguin implements Bird {\n  public void eat() {}\n}" }
        ]
      },
      {
        heading: "How to spot violations",
        bullets: [
          "Overrides that throw `UnsupportedOperationException` or do nothing.",
          "Callers that check `instanceof` before using a base-type reference.",
          "A subclass that adds stricter validation than its parent.",
          "Tests written for the base class that fail when run against a subclass."
        ]
      }
    ],
    takeaways: [
      "Subtypes must honour the parent's behavioural contract, not only its signatures.",
      "'Is-a' in the real world does not guarantee 'is-a' in code.",
      "Prefer composition or small capability interfaces when subtypes cannot fully substitute."
    ],
    pitfalls: [
      "Using inheritance only to reuse code even though the types are not substitutable.",
      "Overriding a method to throw or do nothing.",
      "Assuming a compiling subclass is a correct one."
    ],
    interviewQs: [
      { q: "Why does Square extending Rectangle violate LSP?", a: "Rectangle's contract lets callers set width and height independently. Square couples them, so code that sets width then height and expects an area of w*h is broken. The subclass changes behaviour that callers rely on." },
      { q: "How do you detect LSP violations during review?", a: "Run the parent's test suite against the subclass. Look for overrides that throw, no-op, narrow accepted inputs or return weaker results, and for `instanceof` checks on a base-type variable." },
      { q: "How are LSP and Design by Contract related?", a: "LSP is essentially the contract rules for inheritance: preconditions can only be weakened, postconditions only strengthened, and invariants preserved in every subtype." },
      { q: "What is the fix when a subclass cannot honour the contract?", a: "Do not inherit. Restructure: extract a smaller shared interface, use composition, or split the hierarchy by capability, as with FlyingBird and Bird." }
    ],
    related: ["inheritance", "polymorphism", "isp", "composition"]
  },

  {
    id: "isp",
    name: "Interface Segregation Principle (ISP)",
    summary: "No client should be forced to depend on methods it does not use. Prefer several small, role-specific interfaces over one large, general-purpose one.",
    sections: [
      {
        heading: "The principle",
        text: "A fat interface couples every implementer and every caller to operations they do not care about. When an unrelated method changes, classes that never used it must still recompile, and implementers must stub methods that make no sense for them.\n\nISP shapes interfaces around the needs of clients, not around the convenience of the implementer."
      },
      {
        heading: "A violating example",
        text: "A single `Worker` interface forces robots to implement `eat()` and `sleep()`.",
        code: [
          { file: "Worker.java", body: "interface Worker {\n  void work();\n  void eat();\n  void sleep();\n}\n\nclass Human implements Worker {\n  public void work()  { /* ... */ }\n  public void eat()   { /* ... */ }\n  public void sleep() { /* ... */ }\n}\n\nclass Robot implements Worker {\n  public void work()  { /* ... */ }\n  public void eat()   { throw new UnsupportedOperationException(); }\n  public void sleep() { throw new UnsupportedOperationException(); }\n}" }
        ]
      },
      {
        heading: "The refactor",
        text: "Split by role. Each class implements only what it genuinely supports, and each client asks for only the role it needs.",
        code: [
          { file: "Roles.java", body: "interface Workable { void work(); }\ninterface Eatable  { void eat(); }\ninterface Sleepable { void sleep(); }" },
          { file: "Implementations.java", body: "class Human implements Workable, Eatable, Sleepable {\n  public void work()  { /* ... */ }\n  public void eat()   { /* ... */ }\n  public void sleep() { /* ... */ }\n}\n\nclass Robot implements Workable {\n  public void work() { /* ... */ }\n}" },
          { file: "Scheduler.java", body: "class Scheduler {\n  void assign(Workable w) { w.work(); }   // needs only work()\n}\n\nclass Canteen {\n  void feed(Eatable e) { e.eat(); }       // needs only eat()\n}" }
        ]
      },
      {
        heading: "ISP and LSP together",
        text: "The `UnsupportedOperationException` in `Robot` is also an LSP violation: code holding a `Worker` cannot safely call `eat()`. Segregating the interface removes the impossible promise. Fat interfaces are a common root cause of substitutability problems."
      },
      {
        heading: "Benefits and trade-offs",
        bullets: [
          "Benefit: low coupling, since clients depend only on what they use.",
          "Benefit: easy to implement and to mock in tests.",
          "Trade-off: more interfaces to name and navigate.",
          "Trade-off: splitting too finely creates single-method interfaces everywhere, so group by cohesive role."
        ]
      },
      {
        heading: "How to spot violations",
        bullets: [
          "Implementations with empty methods or methods that throw.",
          "Interfaces with many unrelated methods, often ending in `Service` or `Manager`.",
          "Clients that use only two of ten interface methods.",
          "Mocks that must stub many irrelevant methods."
        ]
      }
    ],
    takeaways: [
      "Design interfaces from the client's point of view.",
      "Split by role, and let classes implement several roles.",
      "Empty or throwing implementations signal a too-wide interface."
    ],
    pitfalls: [
      "Over-splitting into one-method interfaces with no cohesive grouping.",
      "Fixing a fat interface by adding default methods that mask the problem.",
      "Ignoring ISP in public APIs, where changes affect many consumers."
    ],
    interviewQs: [
      { q: "How is ISP different from SRP?", a: "SRP is about a class having one reason to change. ISP is about the interface a client sees: it should expose only what that client needs. A class can satisfy SRP and still expose a fat interface." },
      { q: "Can a class implement multiple small interfaces?", a: "Yes, and that is the intent. `Human` implements Workable, Eatable and Sleepable, while clients depend only on the one role they use." },
      { q: "How would ISP apply to a multi-function printer?", a: "Define `Printer`, `Scanner` and `Fax` interfaces. A basic printer implements only `Printer`; an all-in-one implements all three. No class is forced to stub scanning." },
      { q: "Is ISP relevant in languages without interfaces?", a: "Yes. The idea applies to any API surface, including classes, modules and function parameters. Pass the narrowest thing a function needs." }
    ],
    related: ["srp", "lsp", "dip", "interfaces"]
  },

  {
    id: "dip",
    name: "Dependency Inversion Principle (DIP)",
    summary: "High-level modules should not depend on low-level modules. Both should depend on abstractions, and abstractions should not depend on details. Business rules own the interface; infrastructure implements it.",
    sections: [
      {
        heading: "The principle",
        text: "Normally, policy code (what the application does) calls detail code (how it talks to MySQL, SMTP or Stripe), so policy depends on detail. Change the database and the business logic must change.\n\nDIP flips the arrow: the business layer defines the interface it needs, and the infrastructure layer implements it. Source-code dependencies now point toward the abstraction."
      },
      {
        heading: "A violating example",
        text: "`OrderService` constructs its own MySQL repository and SMTP sender. It cannot be unit tested without a database and cannot switch storage.",
        code: [
          { file: "OrderService.java", body: "class OrderService {\n  private final MySqlOrderRepository repo = new MySqlOrderRepository();\n  private final SmtpEmailSender mailer = new SmtpEmailSender();\n\n  void place(Order order) {\n    repo.save(order);\n    mailer.send(order.customerEmail(), \"Order placed\");\n  }\n}" }
        ]
      },
      {
        heading: "The refactor",
        text: "Define abstractions in the business layer and inject implementations through the constructor.",
        code: [
          { file: "Abstractions.java", body: "interface OrderRepository {\n  void save(Order order);\n}\n\ninterface Notifier {\n  void send(String to, String message);\n}" },
          { file: "OrderService.java", body: "class OrderService {\n  private final OrderRepository repo;\n  private final Notifier notifier;\n\n  OrderService(OrderRepository repo, Notifier notifier) {\n    this.repo = repo;\n    this.notifier = notifier;\n  }\n\n  void place(Order order) {\n    repo.save(order);\n    notifier.send(order.customerEmail(), \"Order placed\");\n  }\n}" },
          { file: "Wiring.java", body: "// Production\nOrderService service = new OrderService(\n    new MySqlOrderRepository(),\n    new SmtpNotifier());\n\n// Test: no database or network needed\nOrderService testService = new OrderService(\n    new InMemoryOrderRepository(),\n    new FakeNotifier());" }
        ]
      },
      {
        heading: "DIP, dependency injection and IoC",
        text: "These terms are related but distinct.",
        bullets: [
          "**DIP** is the design principle: depend on abstractions.",
          "**Dependency Injection** is a technique: pass collaborators in rather than creating them inside.",
          "**Inversion of Control** is the broader idea of a framework or caller controlling object creation and flow.",
          "A DI container is optional. Constructor injection by hand satisfies DIP."
        ]
      },
      {
        heading: "Benefits and trade-offs",
        bullets: [
          "Benefit: business logic is testable without infrastructure.",
          "Benefit: implementations can be swapped (in-memory to Redis, one provider to another).",
          "Trade-off: more interfaces and wiring code.",
          "Trade-off: an interface per class with a single implementation is noise. Invert at real boundaries."
        ]
      },
      {
        heading: "How to spot violations",
        bullets: [
          "`new ConcreteDependency()` inside business classes.",
          "Domain code importing database, HTTP or framework packages.",
          "Static calls to singletons such as `Database.getInstance()` in business logic.",
          "Unit tests that need a running service to execute."
        ]
      }
    ],
    takeaways: [
      "Business rules own the abstractions; infrastructure implements them.",
      "Inject dependencies through constructors instead of constructing them inside.",
      "Invert at architectural boundaries, not between every pair of classes."
    ],
    pitfalls: [
      "Creating an interface for every class by reflex.",
      "Defining the abstraction in the low-level module, so the dependency is not truly inverted.",
      "Equating DIP with using a DI framework.",
      "Leaking implementation details, such as SQL types, through the interface."
    ],
    interviewQs: [
      { q: "What is the difference between DIP and dependency injection?", a: "DIP is a principle about the direction of dependencies: high-level code depends on abstractions. Dependency injection is one technique for achieving it, by handing collaborators to a class instead of letting it create them." },
      { q: "Where should the interface live?", a: "With the high-level module that uses it. The `OrderRepository` interface belongs to the business layer, and the SQL implementation lives in infrastructure and depends on it. That is the inversion." },
      { q: "How does DIP improve testability?", a: "You can inject in-memory fakes or mocks for repositories, clocks, payment gateways and notifiers, so tests of business logic are fast and deterministic." },
      { q: "Show DIP in a Parking Lot design.", a: "`ParkingLot` depends on `PricingStrategy` and `TicketRepository` interfaces, injected through the constructor, rather than constructing a concrete hourly pricing class or database access." }
    ],
    related: ["ocp", "isp", "strategy", "solid-summary"]
  },

  {
    id: "solid-summary",
    name: "SOLID Principles - Summary",
    summary: "SOLID bundles five object-oriented design principles: Single Responsibility, Open/Closed, Liskov Substitution, Interface Segregation and Dependency Inversion. Together they push you toward small, cohesive classes that depend on stable abstractions and can be extended without being rewritten.",
    sections: [
      {
        heading: "The five principles side by side",
        text: "Each principle answers a different question about a design.",
        bullets: [
          "**S: Single Responsibility.** How many reasons does this class have to change? Aim for one.",
          "**O: Open/Closed.** Can I add behaviour without editing tested code? Put abstractions at real variation points.",
          "**L: Liskov Substitution.** Can any subtype replace its parent without breaking callers? Honour the behavioural contract.",
          "**I: Interface Segregation.** Does any client depend on methods it does not use? Split interfaces by role.",
          "**D: Dependency Inversion.** Does business logic depend on details? Depend on abstractions and inject implementations."
        ]
      },
      {
        heading: "How they reinforce each other",
        bullets: [
          "SRP produces small classes; ISP gives them narrow interfaces.",
          "OCP needs an abstraction; DIP says who owns it and how it is wired.",
          "LSP makes OCP safe: new implementations must truly substitute or the extension breaks callers.",
          "ISP prevents many LSP violations, since a class never has to implement methods it cannot honour."
        ],
        note: "SOLID is a set of heuristics, not laws. They conflict with KISS and YAGNI when applied mechanically. Use them to explain trade-offs, not to decorate a design."
      },
      {
        heading: "A worked refactor: before",
        text: "A `ReportService` does everything. It builds a report from employees, picks a format with a switch, writes to a concrete MySQL database, and implements a fat `Exporter` interface that PDF and CSV exporters cannot fully honour.",
        code: [
          { file: "Before.java", body: "interface Exporter {\n  void exportPdf(Report r);\n  void exportCsv(Report r);\n  void sendEmail(Report r);\n}\n\nclass ReportService implements Exporter {\n  private final MySqlDatabase db = new MySqlDatabase();   // DIP violation\n\n  void generate(String format, String department) {\n    List<Employee> staff = db.query(\"SELECT * FROM employees WHERE dept = '\" + department + \"'\");\n    double total = 0;\n    for (Employee e : staff) total += e.pay();              // SRP: calculation\n\n    Report report = new Report(staff, total);               // SRP: formatting\n    if (format.equals(\"PDF\")) exportPdf(report);            // OCP violation\n    else if (format.equals(\"CSV\")) exportCsv(report);\n    else throw new IllegalArgumentException(format);\n  }\n\n  public void exportPdf(Report r) { /* ... */ }\n  public void exportCsv(Report r) { /* ... */ }\n  public void sendEmail(Report r) { throw new UnsupportedOperationException(); } // ISP / LSP\n}" }
        ]
      },
      {
        heading: "A worked refactor: after",
        text: "Each fix is labelled with the principle it applies.",
        code: [
          { file: "Interfaces.java", body: "// ISP: small role-specific interfaces\ninterface ReportWriter {\n  void write(Report report);\n}\n\ninterface EmployeeRepository {   // DIP: abstraction owned by business layer\n  List<Employee> byDepartment(String department);\n}" },
          { file: "Writers.java", body: "// OCP + LSP: new formats are new classes, all fully substitutable\nclass PdfReportWriter implements ReportWriter {\n  public void write(Report r) { /* render PDF */ }\n}\n\nclass CsvReportWriter implements ReportWriter {\n  public void write(Report r) { /* render CSV */ }\n}" },
          { file: "PayrollCalculator.java", body: "// SRP: calculation separated from I/O and formatting\nclass PayrollCalculator {\n  double total(List<Employee> staff) {\n    double total = 0;\n    for (Employee e : staff) total += e.pay();\n    return total;\n  }\n}" },
          { file: "ReportService.java", body: "// DIP: depends on abstractions injected via constructor\nclass ReportService {\n  private final EmployeeRepository repository;\n  private final PayrollCalculator calculator;\n\n  ReportService(EmployeeRepository repository, PayrollCalculator calculator) {\n    this.repository = repository;\n    this.calculator = calculator;\n  }\n\n  void generate(String department, ReportWriter writer) {\n    List<Employee> staff = repository.byDepartment(department);\n    writer.write(new Report(staff, calculator.total(staff)));\n  }\n}" },
          { file: "Main.java", body: "ReportService service = new ReportService(\n    new MySqlEmployeeRepository(),\n    new PayrollCalculator());\n\nservice.generate(\"Engineering\", new PdfReportWriter());\nservice.generate(\"Engineering\", new CsvReportWriter());" }
        ],
        note: "The format switch is gone because the caller chooses a `ReportWriter`. Adding Excel is a new class. Tests pass an in-memory repository and a fake writer."
      },
      {
        heading: "Using SOLID in an interview",
        text: "Do not recite the acronym. When you make a design choice, name the pressure behind it: 'new payment methods are expected, so I put them behind an interface (OCP) and inject it (DIP)'. That shows you understand why, and it lets the interviewer follow your reasoning.\n\nAlso know when you chose **not** to apply a principle, and say why, usually because the abstraction would not earn its keep."
      }
    ],
    takeaways: [
      "SRP: one reason to change. OCP: extend without editing. LSP: subtypes substitute safely. ISP: narrow interfaces. DIP: depend on abstractions.",
      "The principles support one another; OCP and LSP, and ISP and LSP, are especially tied.",
      "Justify each application with a concrete pressure such as an expected variation, a testing need or a coupling problem."
    ],
    pitfalls: [
      "Applying all five everywhere, which creates over-engineered code.",
      "Reciting definitions without being able to show a before and after.",
      "Treating SOLID as correctness instead of guidance that trades against KISS and YAGNI."
    ],
    interviewQs: [
      { q: "Which SOLID principle do you think matters most?", a: "It depends on the context, but SRP and DIP pay off earliest: focused classes and injected abstractions make most code testable and easy to change. OCP and LSP matter once you have genuine variation, and ISP when interfaces start to grow." },
      { q: "Can SOLID principles conflict with each other?", a: "Yes. Strict SRP can fragment a design into many tiny classes, and OCP can add abstractions that violate KISS or YAGNI. Choose the principle that addresses a real, current problem." },
      { q: "How would you apply SOLID to a Vending Machine?", a: "Separate inventory, payment and dispensing (SRP). Model machine states behind a State interface so new states do not edit existing ones (OCP). Ensure every state honours the same contract (LSP). Give clients narrow interfaces such as `CoinAcceptor` (ISP). Inject payment and inventory services (DIP)." },
      { q: "How do you explain the difference between OCP and DIP?", a: "OCP says design so that new behaviour is added by new code. DIP says how to structure dependencies, with high-level code depending on abstractions, so that this is possible and testable. DIP is often the mechanism that delivers OCP." }
    ],
    related: ["srp", "ocp", "lsp", "isp", "dip", "kiss", "yagni"]
  }
);
