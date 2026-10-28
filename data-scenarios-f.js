window.SCENARIOS = window.SCENARIOS || [];
window.SCENARIOS.push(
  {
    "id": "make-class-testable",
    "prompt": "Here is an `InvoiceService` that builds its own `SmtpClient`, calls a static `Database.save`, and reads `LocalDate.now()`. You are asked to write a unit test for the late-fee rule. How do you make this class testable?",
    "context": "The rule itself is simple: an invoice past its due date gets a late fee. But to test it today you need a real SMTP server, a database, and a date that happens to be after the due date.\n\nThe interviewer is not asking about test frameworks. They want to hear where the testability problem actually comes from.",
    "whyHard": "A class is hard to test when it reaches out for things instead of being handed them: objects it constructs itself (`new`), static calls, the system clock and randomness. These are hidden dependencies, so a test cannot substitute them.\n\nThe core idea is always the same (make the dependency visible and replaceable), but *how far* you go depends on whether you can change the class, whether the logic is worth isolating, and whether the dependency is real I/O or just non-determinism.",
    "options": [
      {
        "name": "Constructor injection of interfaces",
        "concept": "Dependency Inversion",
        "conceptIds": [
          "dip",
          "interfaces"
        ],
        "how": "Replace `new SmtpClient(...)` and `Database.save(...)` with small interfaces owned by the service (`Mailer`, `InvoiceRepository`) and receive them in the constructor. Production wiring passes the real implementations; a test passes lambdas or in-memory fakes.\n\nThe service no longer knows or cares what sits behind the interface.",
        "code": [
          {
            "file": "Before.java",
            "body": "import java.time.LocalDate;\n\n// Hidden dependencies: a static database call, a hand-built SMTP client and the system clock.\nclass InvoiceService {\n    void sendInvoice(Invoice invoice) {\n        if (invoice.dueDate().isBefore(LocalDate.now())) {\n            invoice = invoice.withLateFee();\n        }\n        Database.save(invoice);\n        new SmtpClient(\"smtp.corp.example\").send(invoice.customerEmail(), \"Invoice \" + invoice.id());\n    }\n}\n\nclass Database {\n    static void save(Invoice invoice) { /* real JDBC call */ }\n}\n\nclass SmtpClient {\n    SmtpClient(String host) { }\n    void send(String to, String body) { /* opens a real socket */ }\n}\n\nrecord Invoice(String id, String customerEmail, LocalDate dueDate, long cents) {\n    Invoice withLateFee() { return new Invoice(id, customerEmail, dueDate, cents + 500); }\n}"
          },
          {
            "file": "After.java",
            "body": "import java.time.Clock;\nimport java.time.Instant;\nimport java.time.LocalDate;\nimport java.time.ZoneOffset;\nimport java.util.ArrayList;\nimport java.util.List;\n\ninterface Mailer { void send(String to, String body); }\ninterface InvoiceRepository { void save(Invoice invoice); }\n\nrecord Invoice(String id, String customerEmail, LocalDate dueDate, long cents) {\n    Invoice withLateFee() { return new Invoice(id, customerEmail, dueDate, cents + 500); }\n}\n\nclass InvoiceService {\n    private final Mailer mailer;\n    private final InvoiceRepository repository;\n    private final Clock clock;\n\n    InvoiceService(Mailer mailer, InvoiceRepository repository, Clock clock) {\n        this.mailer = mailer;\n        this.repository = repository;\n        this.clock = clock;\n    }\n\n    void sendInvoice(Invoice invoice) {\n        if (invoice.dueDate().isBefore(LocalDate.now(clock))) {\n            invoice = invoice.withLateFee();\n        }\n        repository.save(invoice);\n        mailer.send(invoice.customerEmail(), \"Invoice \" + invoice.id());\n    }\n}\n\nclass InvoiceServiceTest {\n    public static void main(String[] args) {\n        List<String> mails = new ArrayList<>();\n        List<Invoice> saved = new ArrayList<>();\n        Clock today = Clock.fixed(Instant.parse(\"2026-03-01T00:00:00Z\"), ZoneOffset.UTC);\n        InvoiceService service = new InvoiceService((to, body) -> mails.add(to + \":\" + body), saved::add, today);\n\n        service.sendInvoice(new Invoice(\"42\", \"a@b.c\", LocalDate.of(2026, 2, 1), 1000));\n\n        if (saved.get(0).cents() != 1500) throw new AssertionError(\"late fee missing\");\n        if (!mails.get(0).equals(\"a@b.c:Invoice 42\")) throw new AssertionError(mails);\n        System.out.println(\"PASS late invoice gets a fee and is mailed\");\n    }\n}"
          }
        ],
        "pros": [
          "Tests run in microseconds with no I/O",
          "Dependencies are visible in the constructor, which documents the class",
          "Works with any test framework, or none"
        ],
        "cons": [
          "Needs a composition root that wires the real objects",
          "Many constructor parameters is a hint that the class does too much"
        ],
        "pickWhen": "You own the class and it talks to I/O (network, database, files). This is the default answer."
      },
      {
        "name": "Inject the clock and the id generator",
        "concept": "Dependency Inversion for non-determinism",
        "conceptIds": [
          "dip"
        ],
        "how": "Time and randomness are dependencies too. Pass a `java.time.Clock` and a `Supplier<UUID>` instead of calling `Instant.now()` and `UUID.randomUUID()`.\n\nA test supplies a mutable clock and advances it by 16 minutes instead of sleeping for 16 minutes.",
        "code": [
          {
            "file": "Before.java",
            "body": "import java.time.Instant;\nimport java.util.UUID;\n\nclass SessionTokens {\n    String issue(String user) {\n        return user + \":\" + UUID.randomUUID() + \":\" + Instant.now().plusSeconds(900);\n    }\n\n    boolean expired(Instant expiresAt) {\n        return Instant.now().isAfter(expiresAt);   // can only be tested by sleeping\n    }\n}"
          },
          {
            "file": "After.java",
            "body": "import java.time.Clock;\nimport java.time.Duration;\nimport java.time.Instant;\nimport java.time.ZoneId;\nimport java.time.ZoneOffset;\nimport java.util.UUID;\nimport java.util.function.Supplier;\n\nclass SessionTokens {\n    record Token(String user, UUID id, Instant expiresAt) { }\n\n    private final Clock clock;\n    private final Supplier<UUID> ids;\n\n    SessionTokens(Clock clock, Supplier<UUID> ids) {\n        this.clock = clock;\n        this.ids = ids;\n    }\n\n    Token issue(String user) {\n        return new Token(user, ids.get(), clock.instant().plus(Duration.ofMinutes(15)));\n    }\n\n    boolean expired(Token token) {\n        return clock.instant().isAfter(token.expiresAt());\n    }\n}\n\nclass MutableClock extends Clock {\n    private Instant now;\n    MutableClock(Instant start) { this.now = start; }\n    void advance(Duration d) { now = now.plus(d); }\n    public ZoneId getZone() { return ZoneOffset.UTC; }\n    public Clock withZone(ZoneId zone) { return this; }\n    public Instant instant() { return now; }\n}\n\nclass SessionTokensTest {\n    public static void main(String[] args) {\n        MutableClock clock = new MutableClock(Instant.parse(\"2026-01-01T10:00:00Z\"));\n        SessionTokens tokens = new SessionTokens(clock, () -> new UUID(0, 1));\n\n        SessionTokens.Token token = tokens.issue(\"asha\");\n        if (tokens.expired(token)) throw new AssertionError(\"fresh token expired\");\n\n        clock.advance(Duration.ofMinutes(16));          // no sleeping\n        if (!tokens.expired(token)) throw new AssertionError(\"token should have expired\");\n        System.out.println(\"PASS expiry tested in microseconds\");\n    }\n}"
          }
        ],
        "pros": [
          "Expiry, timeout and retry logic becomes deterministic",
          "No `Thread.sleep` in tests, so no slow or flaky tests"
        ],
        "cons": [
          "A little ceremony for something that looks trivial",
          "Every caller must be given the clock"
        ],
        "pickWhen": "The logic depends on 'now', timeouts, expiry or random values."
      },
      {
        "name": "Extract a pure function",
        "concept": "Separate computation from I/O (Single Responsibility)",
        "conceptIds": [
          "srp",
          "kiss"
        ],
        "how": "Pull the decision-making (totals, tax, late fee) into a class that takes values in and returns a value out. The remaining service becomes a thin shell that fetches data, calls the pure code and saves the result.\n\nThe pure part needs no fakes at all.",
        "code": [
          {
            "file": "After.java",
            "body": "import java.util.List;\n\nrecord Line(String sku, int qty, long unitCents) { }\n\ninterface TaxPolicy { long taxOn(long subtotalCents); }\n\n// Pure function: no clock, no database, no mailer. Nothing to mock.\nfinal class InvoiceCalculator {\n    static long total(List<Line> lines, TaxPolicy tax) {\n        long subtotal = 0;\n        for (Line line : lines) subtotal += line.qty() * line.unitCents();\n        return subtotal + tax.taxOn(subtotal);\n    }\n}\n\nclass InvoiceCalculatorTest {\n    public static void main(String[] args) {\n        long total = InvoiceCalculator.total(List.of(new Line(\"A\", 2, 500), new Line(\"B\", 1, 250)), s -> s / 10);\n        if (total != 1375) throw new AssertionError(total);\n        System.out.println(\"PASS total=\" + total);\n    }\n}"
          }
        ],
        "pros": [
          "The simplest possible tests: inputs and outputs",
          "Pure code is easy to reason about and reuse",
          "Often removes the need for mocks entirely"
        ],
        "cons": [
          "The thin shell is still untested without fakes",
          "Needs real logic worth extracting; for a one-liner it is overkill"
        ],
        "pickWhen": "There is genuine business logic tangled up with I/O."
      },
      {
        "name": "Create a seam by subclassing",
        "concept": "Template Method / Factory Method seam",
        "conceptIds": [
          "template-method",
          "factory-method"
        ],
        "how": "When you cannot restructure a legacy class right now, extract the hard-wired construction into a protected method (`createMailer()`). A test subclass overrides just that method.\n\nIt is a stepping stone: you get a safety-net test today and can move to constructor injection when you next touch the code.",
        "code": [
          {
            "file": "After.java",
            "body": "interface Mailer { void send(String to, String body); }\n\nclass SmtpMailer implements Mailer {\n    SmtpMailer(String host) { }\n    public void send(String to, String body) { throw new IllegalStateException(\"would hit the real SMTP server\"); }\n}\n\n// Legacy class we cannot restructure today: add one small seam instead.\nclass LegacyReportJob {\n    void run() {\n        createMailer().send(\"ops@corp.example\", buildReport());\n    }\n\n    protected Mailer createMailer() { return new SmtpMailer(\"smtp.corp.example\"); }   // the seam\n    protected String buildReport() { return \"report\"; }\n}\n\nclass LegacyReportJobTest {\n    public static void main(String[] args) {\n        StringBuilder out = new StringBuilder();\n        new LegacyReportJob() {\n            @Override protected Mailer createMailer() {\n                return (to, body) -> out.append(to).append(':').append(body);\n            }\n        }.run();\n        if (!out.toString().equals(\"ops@corp.example:report\")) throw new AssertionError(out);\n        System.out.println(\"PASS legacy job tested through the seam\");\n    }\n}"
          }
        ],
        "pros": [
          "Minimal change to risky legacy code",
          "Gets a safety-net test in place quickly"
        ],
        "cons": [
          "Tests depend on inheritance and implementation details",
          "Hides the dependency instead of exposing it, so it does not scale"
        ],
        "pickWhen": "Legacy code you must test before you are allowed to refactor it."
      }
    ],
    "recommendation": "Constructor injection of small interfaces, plus an injected `Clock` wherever time matters. If the class holds real rules, pull them into a pure function so most tests need no fakes at all. Use the subclass seam only as a temporary step on legacy code.\n\nNotice that all four options do the same thing: they stop the class from reaching out and let the test hand it what it needs.",
    "say": "The class is hard to test because it creates and calls its own collaborators. I would make those dependencies explicit: an interface for the mailer and the repository passed through the constructor, and a `Clock` for time. In the test I pass a fake mailer, an in-memory repository and a fixed clock, so the late-fee rule runs in microseconds. If there is a lot of arithmetic I would pull it into a pure function. If this were legacy code I could not change yet, I would add a protected factory method as a temporary seam.",
    "appearsIn": [
      "parking-lot",
      "digital-wallet",
      "logging-framework",
      "library-management-system"
    ],
    "related": [
      "dip",
      "srp",
      "god-class-refactor",
      "swap-storage-backend"
    ]
  },
  {
    "id": "god-class-refactor",
    "prompt": "`OrderManager` is 1,500 lines. It validates orders, prices them, saves them, sends the receipt email and builds the PDF invoice. Forty classes call it. How do you break it up without a big-bang rewrite?",
    "context": "Every change to emails or pricing touches the same file, merge conflicts are constant, and nobody can test one concern without setting up all the others.\n\nThe interviewer wants to see both the target design and a safe way to get there.",
    "whyHard": "Splitting by guesswork produces many tiny classes that are still tangled. Splitting everything at once breaks forty callers. And some parts (pricing rules, validations) will keep growing, so a clean split of today's code is not enough: you also need the right seam for tomorrow's changes.",
    "options": [
      {
        "name": "Split by responsibility behind a thin orchestrator",
        "concept": "Single Responsibility Principle",
        "conceptIds": [
          "srp",
          "composition"
        ],
        "how": "Group the code by *reason to change*: validation, pricing, persistence, notification. Give each a class (or an interface where it touches I/O) and leave one small orchestrator, `PlaceOrderService`, that calls them in order.\n\nExtract one responsibility at a time, with a test around it, instead of all at once.",
        "code": [
          {
            "file": "Before.java",
            "body": "import java.util.List;\n\n// 1,500 lines in real life. Everything about an order lives here.\nclass OrderManager {\n    long placeOrder(Order order) {\n        if (order.items().isEmpty()) throw new IllegalArgumentException(\"empty order\");       // validation\n        long total = 0;                                                                        // pricing\n        for (Item i : order.items()) total += i.qty() * i.unitCents();\n        /* INSERT INTO orders ... */                                                           // persistence\n        /* SMTP: send receipt email ... */                                                     // notification\n        /* build PDF invoice ... */                                                            // documents\n        return total;\n    }\n}\n\nrecord Item(String sku, int qty, long unitCents) { }\nrecord Order(String id, List<Item> items) { }"
          },
          {
            "file": "After.java",
            "body": "import java.util.ArrayList;\nimport java.util.List;\n\nrecord Item(String sku, int qty, long unitCents) { }\nrecord Order(String id, List<Item> items) { }\n\nclass OrderValidator {\n    void validate(Order order) {\n        if (order.items().isEmpty()) throw new IllegalArgumentException(\"empty order\");\n    }\n}\n\nclass PriceCalculator {\n    long total(Order order) {\n        return order.items().stream().mapToLong(i -> i.qty() * i.unitCents()).sum();\n    }\n}\n\ninterface OrderStore { void save(Order order, long totalCents); }\ninterface ReceiptSender { void send(Order order, long totalCents); }\n\n// Thin orchestrator: each step is owned by a class with one reason to change.\nclass PlaceOrderService {\n    private final OrderValidator validator;\n    private final PriceCalculator pricing;\n    private final OrderStore store;\n    private final ReceiptSender receipts;\n\n    PlaceOrderService(OrderValidator v, PriceCalculator p, OrderStore s, ReceiptSender r) {\n        this.validator = v; this.pricing = p; this.store = s; this.receipts = r;\n    }\n\n    long place(Order order) {\n        validator.validate(order);\n        long total = pricing.total(order);\n        store.save(order, total);\n        receipts.send(order, total);\n        return total;\n    }\n}\n\nclass PlaceOrderServiceTest {\n    public static void main(String[] args) {\n        List<String> log = new ArrayList<>();\n        PlaceOrderService service = new PlaceOrderService(new OrderValidator(), new PriceCalculator(),\n                (o, t) -> log.add(\"saved \" + t), (o, t) -> log.add(\"mailed \" + t));\n        long total = service.place(new Order(\"o1\", List.of(new Item(\"A\", 2, 300))));\n        if (total != 600 || !log.equals(List.of(\"saved 600\", \"mailed 600\"))) throw new AssertionError(log);\n        System.out.println(\"PASS \" + log);\n    }\n}"
          }
        ],
        "pros": [
          "Each class has one reason to change and is testable alone",
          "Teams stop colliding in one file",
          "The orchestrator reads like the business process"
        ],
        "cons": [
          "More classes to navigate",
          "Splitting by size instead of by reason to change just spreads the mess around"
        ],
        "pickWhen": "Always as the starting point; it is the default structure."
      },
      {
        "name": "Keep the old class as a Facade while you migrate",
        "concept": "Facade",
        "conceptIds": [
          "facade"
        ],
        "how": "Leave `OrderManager` and its `placeOrder` method in place, but make it delegate to the new services. All 40 callers keep compiling.\n\nMark the method `@Deprecated`, migrate callers gradually, and delete the facade when the last one is gone.",
        "code": [
          {
            "file": "After.java",
            "body": "import java.util.List;\n\nrecord Item(String sku, int qty, long unitCents) { }\nrecord Order(String id, List<Item> items) { }\n\ninterface PlaceOrderService { long place(Order order); }   // the new, small service\n\n// Old name and old method signature stay, so the 40 existing callers compile unchanged.\nclass OrderManager {\n    private final PlaceOrderService delegate;\n\n    OrderManager(PlaceOrderService delegate) { this.delegate = delegate; }\n\n    /** @deprecated call PlaceOrderService directly. */\n    @Deprecated\n    long placeOrder(Order order) { return delegate.place(order); }\n}\n\nclass OrderManagerTest {\n    public static void main(String[] args) {\n        OrderManager legacy = new OrderManager(o -> 123);\n        if (legacy.placeOrder(new Order(\"o1\", List.of())) != 123) throw new AssertionError();\n        System.out.println(\"PASS old API still works, new code behind it\");\n    }\n}"
          }
        ],
        "pros": [
          "Zero breakage for existing callers",
          "Lets you ship in small, reviewable steps",
          "Easy to roll back"
        ],
        "cons": [
          "Temporary duplication of entry points",
          "Needs discipline to finish the migration and delete the facade"
        ],
        "pickWhen": "The class has many callers, or callers you do not own."
      },
      {
        "name": "Make the growing parts pluggable",
        "concept": "Strategy / Chain of Responsibility and Open/Closed",
        "conceptIds": [
          "strategy",
          "chain-of-responsibility",
          "ocp"
        ],
        "how": "Validation rules and pricing rules keep multiplying. Turn each rule into a small class behind an interface and let the validator (or calculator) run a list of them.\n\nAdding a rule becomes a new class plus one line of wiring, with no edits to existing code.",
        "code": [
          {
            "file": "After.java",
            "body": "import java.util.List;\n\nrecord Item(String sku, int qty, long unitCents) { }\nrecord Order(String id, List<Item> items) { }\n\ninterface OrderRule { void check(Order order); }\n\nclass NotEmptyRule implements OrderRule {\n    public void check(Order order) {\n        if (order.items().isEmpty()) throw new IllegalArgumentException(\"empty order\");\n    }\n}\n\nclass MaxQuantityRule implements OrderRule {\n    public void check(Order order) {\n        for (Item i : order.items()) {\n            if (i.qty() > 100) throw new IllegalArgumentException(\"too many of \" + i.sku());\n        }\n    }\n}\n\n// New rule = new class + one line of wiring. The validator never changes.\nclass OrderValidator {\n    private final List<OrderRule> rules;\n    OrderValidator(List<OrderRule> rules) { this.rules = rules; }\n    void validate(Order order) { rules.forEach(rule -> rule.check(order)); }\n}\n\nclass OrderValidatorTest {\n    public static void main(String[] args) {\n        OrderValidator validator = new OrderValidator(List.of(new NotEmptyRule(), new MaxQuantityRule()));\n        validator.validate(new Order(\"ok\", List.of(new Item(\"A\", 1, 100))));\n        try {\n            validator.validate(new Order(\"big\", List.of(new Item(\"A\", 101, 100))));\n            throw new AssertionError(\"should reject\");\n        } catch (IllegalArgumentException expected) {\n            System.out.println(\"PASS \" + expected.getMessage());\n        }\n    }\n}"
          }
        ],
        "pros": [
          "Open/Closed: new rules do not touch old ones",
          "Each rule is trivially testable",
          "Rules can be reordered or toggled by configuration"
        ],
        "cons": [
          "Indirection: harder to see the full rule set at a glance",
          "Overkill if there are only two stable rules"
        ],
        "pickWhen": "One part of the class changes often, always by adding cases."
      },
      {
        "name": "Decouple side effects with events",
        "concept": "Observer",
        "conceptIds": [
          "observer"
        ],
        "how": "Emailing, PDF generation and analytics are reactions to an order being placed, not part of placing it. Publish an `OrderPlaced` event and let each of them subscribe.\n\nThe core flow shrinks to validate, price, save, publish.",
        "code": [
          {
            "file": "After.java",
            "body": "import java.util.ArrayList;\nimport java.util.List;\nimport java.util.function.Consumer;\n\nrecord OrderPlaced(String orderId, long totalCents) { }\n\nclass OrderEvents {\n    private final List<Consumer<OrderPlaced>> listeners = new ArrayList<>();\n    void subscribe(Consumer<OrderPlaced> listener) { listeners.add(listener); }\n    void publish(OrderPlaced event) { listeners.forEach(l -> l.accept(event)); }\n}\n\n// The core flow only knows \"an order was placed\". Email, PDF, analytics subscribe on their own.\nclass PlaceOrderService {\n    private final OrderEvents events;\n    PlaceOrderService(OrderEvents events) { this.events = events; }\n\n    long place(String orderId, long totalCents) {\n        /* validate, price, persist ... */\n        events.publish(new OrderPlaced(orderId, totalCents));\n        return totalCents;\n    }\n}\n\nclass PlaceOrderServiceTest {\n    public static void main(String[] args) {\n        OrderEvents events = new OrderEvents();\n        List<String> log = new ArrayList<>();\n        events.subscribe(e -> log.add(\"email \" + e.orderId()));\n        events.subscribe(e -> log.add(\"pdf \" + e.orderId()));\n        new PlaceOrderService(events).place(\"o1\", 500);\n        if (!log.equals(List.of(\"email o1\", \"pdf o1\"))) throw new AssertionError(log);\n        System.out.println(\"PASS \" + log);\n    }\n}"
          }
        ],
        "pros": [
          "Adding a new reaction never touches the core flow",
          "The core no longer depends on email or PDF libraries"
        ],
        "cons": [
          "Control flow is harder to follow and debug",
          "In-process events share failures; use a queue if one listener must not break checkout"
        ],
        "pickWhen": "Several independent follow-up actions hang off one main action."
      }
    ],
    "recommendation": "Start with option 1 to find the real boundaries, and use option 2 so you can ship it incrementally. Then apply option 3 only to the parts that actually keep growing, and option 4 for side effects such as emails.\n\nThe order matters: first make the structure honest, then make the volatile parts pluggable.",
    "say": "I would not rewrite it in one go. I would split by reason to change (validation, pricing, persistence, notification) into small collaborators behind a thin `PlaceOrderService`, one extraction at a time with a test around each. `OrderManager` stays as a deprecated facade so the forty callers keep working. Then I would turn the rules that keep growing into strategies, and make emails and PDFs subscribers of an `OrderPlaced` event.",
    "appearsIn": [
      "restaurant-management-system",
      "amazon",
      "online-food-delivery",
      "hotel-management-system"
    ],
    "related": [
      "srp",
      "solid-summary",
      "make-class-testable",
      "remove-if-else-on-type"
    ]
  },
  {
    "id": "overengineering-patterns",
    "prompt": "You used a Factory, a Builder, a Strategy, an Observer and a Singleton for a parking lot that has three spots. Walk me through why each one is there. What would you remove?",
    "context": "This usually comes up after a candidate has pattern-matched too eagerly. The interviewer is not against patterns. They want to know whether you can tell a pattern that solves a real problem from one that only adds files.",
    "whyHard": "Patterns look impressive, so removing one feels like losing points. But every pattern adds indirection that a reader must follow, and it only pays off when the thing it abstracts actually varies.\n\nThe skill is justifying each pattern with a concrete change it makes cheap, and having the nerve to delete the ones you cannot justify.",
    "options": [
      {
        "name": "Start with the simplest design that meets the stated requirements",
        "concept": "KISS and YAGNI",
        "conceptIds": [
          "kiss",
          "yagni"
        ],
        "how": "State the requirements, then write plain classes. For three spots, a `ParkingLot` with a counter is enough.\n\nName the extension points you *were told about* and design only for those; mention the rest as 'I would add an interface here if a second variant appears'.",
        "code": [
          {
            "file": "Bloated.java",
            "body": "// What the interviewer sees: five patterns, one hundred lines, and a lot with 3 spots.\ninterface SpotAllocationStrategy { int allocate(boolean[] taken); }\n\nclass NearestSpotStrategy implements SpotAllocationStrategy {\n    public int allocate(boolean[] taken) {\n        for (int i = 0; i < taken.length; i++) if (!taken[i]) return i;\n        return -1;\n    }\n}\n\nclass SpotAllocationStrategyFactory {\n    static SpotAllocationStrategy create(String type) { return new NearestSpotStrategy(); }   // only one type exists\n}\n\nfinal class ParkingLotManager {\n    private static final ParkingLotManager INSTANCE = new ParkingLotManager();\n    private ParkingLotManager() { }\n    static ParkingLotManager getInstance() { return INSTANCE; }\n}\n\nclass ParkingLotBuilder {\n    private int capacity;\n    ParkingLotBuilder capacity(int c) { this.capacity = c; return this; }\n    boolean[] build() { return new boolean[capacity]; }\n}"
          },
          {
            "file": "Simple.java",
            "body": "// Enough to satisfy the stated requirements. Add structure when a requirement forces it.\nclass ParkingLot {\n    private final int capacity;\n    private int occupied;\n\n    ParkingLot(int capacity) { this.capacity = capacity; }\n\n    boolean park() {\n        if (occupied == capacity) return false;\n        occupied++;\n        return true;\n    }\n\n    void leave() {\n        if (occupied > 0) occupied--;\n    }\n}"
          }
        ],
        "pros": [
          "Less code to write, review and explain in 45 minutes",
          "Shows judgment, not just vocabulary",
          "Still leaves room to grow"
        ],
        "cons": [
          "If the interviewer says 'assume pricing changes often', ignoring it looks naive",
          "Needs a short explanation so it does not look like you did not know the patterns"
        ],
        "pickWhen": "Requirements are stable or vague. This is the safest opening."
      },
      {
        "name": "Keep exactly one pattern, where the change is real",
        "concept": "Strategy and the Open/Closed Principle",
        "conceptIds": [
          "strategy",
          "ocp"
        ],
        "how": "If the interviewer says pricing will change, put a `PricingStrategy` interface there and nowhere else. One justified axis of variation beats five decorative ones.\n\nSay out loud what the second implementation would be.",
        "code": [
          {
            "file": "After.java",
            "body": "import java.time.Duration;\n\n// Pricing is the one thing the interviewer said will change, so it gets the one interface.\ninterface PricingStrategy { long priceCents(Duration stayed); }\n\nclass HourlyPricing implements PricingStrategy {\n    public long priceCents(Duration stayed) {\n        long hours = Math.max(1, (stayed.toMinutes() + 59) / 60);\n        return hours * 200;\n    }\n}\n\nclass FlatPricing implements PricingStrategy {\n    public long priceCents(Duration stayed) { return 1000; }\n}\n\nclass ParkingLot {\n    private final PricingStrategy pricing;\n    ParkingLot(PricingStrategy pricing) { this.pricing = pricing; }\n    long checkout(Duration stayed) { return pricing.priceCents(stayed); }\n}\n\nclass ParkingLotTest {\n    public static void main(String[] args) {\n        if (new ParkingLot(new HourlyPricing()).checkout(Duration.ofMinutes(90)) != 400) throw new AssertionError();\n        if (new ParkingLot(new FlatPricing()).checkout(Duration.ofMinutes(90)) != 1000) throw new AssertionError();\n        System.out.println(\"PASS one interface, one axis of change\");\n    }\n}"
          }
        ],
        "pros": [
          "Every pattern has a story you can defend",
          "The design is small but visibly extensible where it matters"
        ],
        "cons": [
          "You must correctly guess which axis will move",
          "A strategy with one implementation is still speculative"
        ],
        "pickWhen": "You have been given, or can name, a concrete second variant."
      },
      {
        "name": "Use a language feature instead of the full pattern",
        "concept": "Strategy as a lambda, Factory as an enum",
        "conceptIds": [
          "strategy",
          "factory-method"
        ],
        "how": "A Strategy with one method is just a function: pass a `Function<Duration, Long>`. A Factory that maps a few fixed types to objects is often an `enum` with a field.\n\nYou get the same flexibility with no extra classes.",
        "code": [
          {
            "file": "After.java",
            "body": "import java.time.Duration;\nimport java.util.function.Function;\n\n// A one-method Strategy is just a function.\nclass ParkingLot {\n    private final Function<Duration, Long> pricing;\n    ParkingLot(Function<Duration, Long> pricing) { this.pricing = pricing; }\n    long checkout(Duration stayed) { return pricing.apply(stayed); }\n}\n\n// An enum replaces a Factory and a type hierarchy when the variants are just data.\nenum VehicleType {\n    BIKE(1), CAR(1), TRUCK(2);\n\n    final int spotsNeeded;\n    VehicleType(int spotsNeeded) { this.spotsNeeded = spotsNeeded; }\n}\n\nclass ParkingLotTest {\n    public static void main(String[] args) {\n        ParkingLot lot = new ParkingLot(d -> d.toHours() * 200);\n        if (lot.checkout(Duration.ofHours(3)) != 600) throw new AssertionError();\n        if (VehicleType.TRUCK.spotsNeeded != 2) throw new AssertionError();\n        System.out.println(\"PASS lambdas and enums, no extra classes\");\n    }\n}"
          }
        ],
        "pros": [
          "A fraction of the code of the classic pattern",
          "Idiomatic modern Java, easy to read"
        ],
        "cons": [
          "Lambdas have no names or state, so complex strategies become unwieldy",
          "Some interviewers expect to see the classic structure drawn"
        ],
        "pickWhen": "The variation is one small behaviour or a fixed set of values."
      },
      {
        "name": "Refactor to the pattern when the second case arrives",
        "concept": "YAGNI and Open/Closed, applied late",
        "conceptIds": [
          "yagni",
          "ocp"
        ],
        "how": "Write the rule inline today. When weekend pricing is requested, extract an interface from the existing code and add the second implementation.\n\nExtracting an interface from working code is a mechanical, low-risk change, so waiting costs little.",
        "code": [
          {
            "file": "Today.java",
            "body": "import java.time.Duration;\n\n// Day 1: one pricing rule, written inline. Nothing to abstract yet.\nclass ParkingLot {\n    long checkout(Duration stayed) {\n        long hours = Math.max(1, (stayed.toMinutes() + 59) / 60);\n        return hours * 200;\n    }\n}"
          },
          {
            "file": "WhenSecondRuleArrives.java",
            "body": "import java.time.Duration;\n\n// Day 90: weekend pricing is requested. NOW extract the interface; the change is mechanical and safe.\ninterface PricingRule { long priceCents(Duration stayed); }\n\nclass WeekdayPricing implements PricingRule {\n    public long priceCents(Duration stayed) {\n        long hours = Math.max(1, (stayed.toMinutes() + 59) / 60);\n        return hours * 200;\n    }\n}\n\nclass WeekendPricing implements PricingRule {\n    public long priceCents(Duration stayed) { return 1500; }\n}\n\nclass ParkingLot {\n    private final PricingRule rule;\n    ParkingLot(PricingRule rule) { this.rule = rule; }\n    long checkout(Duration stayed) { return rule.priceCents(stayed); }\n}"
          }
        ],
        "pros": [
          "You never build abstractions that turn out to be wrong",
          "The abstraction is shaped by two real cases, not one imagined case"
        ],
        "cons": [
          "In an interview you must say it out loud, or it sounds like a gap",
          "Needs tests so the later refactor is safe"
        ],
        "pickWhen": "A second variant is plausible but not yet required."
      }
    ],
    "recommendation": "Open with option 1, add at most the patterns the requirements demand (option 2), and prefer the lighter forms in option 3 for tiny variations. Be ready to describe option 4: 'I would extract the interface when the second rule shows up.'\n\nThe rule of thumb: if you cannot name the second implementation, or the specific change a pattern makes cheap, delete the pattern.",
    "say": "I introduced patterns too early. For three spots a counter and one class are enough. If pricing is the part expected to change, I would keep a single `PricingStrategy` and nothing else, and I can tell you the second implementation: weekend pricing. The Singleton and the factory add indirection without solving a problem here, so I would remove them and add structure only when a second variant actually appears.",
    "appearsIn": [
      "parking-lot",
      "tic-tac-toe",
      "vending-machine",
      "elevator-system"
    ],
    "related": [
      "kiss",
      "yagni",
      "strategy",
      "lld-interview-framework"
    ]
  },
  {
    "id": "singleton-global-state",
    "prompt": "Your `Config.getInstance()` and `Logger.getInstance()` are called from everywhere. Tests leak state into each other and fail when run in parallel. What would you do?",
    "context": "Test A sets a flag on the singleton, test B runs afterwards and sees it. On CI the suite runs in parallel and the failures turn random.\n\nThe interviewer wants more than 'singletons are bad'. They want to hear what you replace them with, and when a singleton is still acceptable.",
    "whyHard": "A Singleton bundles two separate ideas: *only one instance exists* and *anyone can reach it globally*. The first is occasionally useful. The second is the source of hidden coupling and shared mutable state.\n\nFixing it means pulling those apart, and you also need a plan for the hundreds of call sites that currently reach for the static accessor.",
    "options": [
      {
        "name": "Constructor injection, with one instance wired at the edge",
        "concept": "Dependency Inversion",
        "conceptIds": [
          "dip",
          "singleton"
        ],
        "how": "Keep a single instance if you want one, but create it once in `main` (the composition root) and pass it to whoever needs it. Classes depend on an interface (`AppConfig`), not on a static accessor.\n\nEach test builds its own config, so nothing is shared.",
        "code": [
          {
            "file": "After.java",
            "body": "import java.util.Map;\n\ninterface AppConfig { String get(String key); }\n\nclass MapConfig implements AppConfig {\n    private final Map<String, String> values;\n    MapConfig(Map<String, String> values) { this.values = Map.copyOf(values); }\n    public String get(String key) { return values.get(key); }\n}\n\nclass PaymentClient {\n    private final AppConfig config;\n    PaymentClient(AppConfig config) { this.config = config; }       // dependency is visible\n    String endpoint() { return config.get(\"payment.url\"); }\n}\n\n// \"Single instance\" is a wiring decision made once, at the edge of the program.\nclass CompositionRoot {\n    public static void main(String[] args) {\n        AppConfig prod = new MapConfig(Map.of(\"payment.url\", \"https://pay.example.com\"));\n        AppConfig test = new MapConfig(Map.of(\"payment.url\", \"http://localhost:9999\"));   // each test gets its own\n        if (!new PaymentClient(prod).endpoint().startsWith(\"https\")) throw new AssertionError();\n        if (!new PaymentClient(test).endpoint().contains(\"localhost\")) throw new AssertionError();\n        System.out.println(\"PASS two configs coexist, tests cannot interfere\");\n    }\n}"
          }
        ],
        "pros": [
          "No shared state between tests; parallel runs are safe",
          "Dependencies are visible in constructors",
          "'Exactly one instance' is still achieved, by wiring"
        ],
        "cons": [
          "Touches every call site, so it needs a gradual migration",
          "Long constructor parameter lists if a class uses many services"
        ],
        "pickWhen": "You can change the callers. This is the target state."
      },
      {
        "name": "Keep the singleton, but make its source swappable",
        "concept": "Singleton behind an interface",
        "conceptIds": [
          "singleton",
          "interfaces"
        ],
        "how": "Hide the implementation behind an interface and give the holder `setSourceForTesting` and `resetForTesting` methods. Existing call sites do not change.\n\nTests install a stub inside a `try/finally` block and restore the real source afterwards.",
        "code": [
          {
            "file": "After.java",
            "body": "interface ConfigSource { String get(String key); }\n\nclass EnvConfigSource implements ConfigSource {\n    public String get(String key) { return System.getenv(key); }\n}\n\n// Pragmatic: still global, but the source is swappable so tests can control it.\nfinal class Config {\n    private static volatile ConfigSource source = new EnvConfigSource();\n\n    private Config() { }\n    static String get(String key) { return source.get(key); }\n    static void setSourceForTesting(ConfigSource s) { source = s; }\n    static void resetForTesting() { source = new EnvConfigSource(); }\n}\n\nclass ConfigTest {\n    public static void main(String[] args) {\n        Config.setSourceForTesting(key -> \"stub-\" + key);\n        try {\n            if (!Config.get(\"db.url\").equals(\"stub-db.url\")) throw new AssertionError();\n            System.out.println(\"PASS swapped source, restored in finally\");\n        } finally {\n            Config.resetForTesting();      // forget this and every later test sees the stub\n        }\n    }\n}"
          }
        ],
        "pros": [
          "Tiny, low-risk change",
          "Unblocks tests without touching hundreds of callers"
        ],
        "cons": [
          "Still global: parallel tests that swap the source will collide",
          "Forgetting to reset leaks state into later tests"
        ],
        "pickWhen": "As a stepping stone in a large codebase you cannot rewire yet."
      },
      {
        "name": "Make it immutable and stateless, then it is harmless",
        "concept": "Safe Singleton (holder idiom or enum)",
        "conceptIds": [
          "singleton"
        ],
        "how": "The trouble comes from *mutable* global state. If the object is immutable (constants, defaults) or stateless (a formatter), sharing it is safe.\n\nUse the initialization-on-demand holder idiom or an `enum` singleton: both are lazy and thread-safe without locking.",
        "code": [
          {
            "file": "After.java",
            "body": "import java.time.Duration;\n\n// Safe singleton: immutable, stateless, nothing for tests to fight over.\nfinal class Defaults {\n    private static class Holder { static final Defaults INSTANCE = new Defaults(); }\n\n    final int maxRetries = 3;\n    final Duration timeout = Duration.ofSeconds(5);\n\n    private Defaults() { }\n    static Defaults get() { return Holder.INSTANCE; }     // lazy, thread-safe, no locking\n}\n\n// For a stateless service, an enum is the shortest correct singleton.\nenum IdFormatter {\n    INSTANCE;\n    String format(long id) { return String.format(\"ORD-%08d\", id); }\n}\n\nclass DefaultsTest {\n    public static void main(String[] args) {\n        if (Defaults.get() != Defaults.get()) throw new AssertionError();\n        if (!IdFormatter.INSTANCE.format(42).equals(\"ORD-00000042\")) throw new AssertionError();\n        System.out.println(\"PASS immutable singletons are harmless\");\n    }\n}"
          }
        ],
        "pros": [
          "Simple, thread-safe and fast",
          "Nothing for tests to interfere with"
        ],
        "cons": [
          "Only works when there is no mutable state",
          "Hard-coded globals still cannot be swapped in tests"
        ],
        "pickWhen": "The shared object truly never changes."
      },
      {
        "name": "Service Locator, and why it is a trap",
        "concept": "Service Locator vs Dependency Injection",
        "conceptIds": [
          "dip",
          "law-of-demeter"
        ],
        "how": "A registry (`ServiceLocator.get(Mailer.class)`) lets tests register fakes without changing signatures. The catch is that the dependency becomes invisible: it is not in the constructor, and a missing registration fails at runtime.\n\nIt is tolerated at the very edge of a framework, not inside business classes.",
        "code": [
          {
            "file": "After.java",
            "body": "import java.util.HashMap;\nimport java.util.Map;\n\ninterface Mailer { void send(String to, String body); }\n\nfinal class ServiceLocator {\n    private static final Map<Class<?>, Object> services = new HashMap<>();\n    static <T> void register(Class<T> type, T impl) { services.put(type, impl); }\n    static <T> T get(Class<T> type) { return type.cast(services.get(type)); }\n}\n\n// Smell: the dependency on Mailer is invisible in the constructor and fails at runtime if unregistered.\nclass ReportJobWithLocator {\n    void run() { ServiceLocator.get(Mailer.class).send(\"ops@corp.example\", \"report\"); }\n}\n\n// Preferred: same wiring work, but the dependency is explicit and checked by the compiler.\nclass ReportJob {\n    private final Mailer mailer;\n    ReportJob(Mailer mailer) { this.mailer = mailer; }\n    void run() { mailer.send(\"ops@corp.example\", \"report\"); }\n}\n\nclass ReportJobTest {\n    public static void main(String[] args) {\n        StringBuilder out = new StringBuilder();\n        new ReportJob((to, body) -> out.append(to)).run();\n        if (!out.toString().equals(\"ops@corp.example\")) throw new AssertionError();\n        try {\n            new ReportJobWithLocator().run();                  // nothing registered\n            throw new AssertionError(\"expected failure\");\n        } catch (NullPointerException expected) {\n            System.out.println(\"PASS locator fails at runtime, constructor injection fails at compile time\");\n        }\n    }\n}"
          }
        ],
        "pros": [
          "Easy to retrofit into legacy code",
          "Tests can register fakes"
        ],
        "cons": [
          "Hidden dependencies and runtime failures",
          "It is still global state, just renamed"
        ],
        "pickWhen": "Only as a migration aid or at framework boundaries."
      }
    ],
    "recommendation": "Aim for option 1: inject interfaces and create the single instance once at the composition root. Use option 2 as a short-term bridge while you migrate, and keep option 3 for genuinely immutable or stateless helpers. Avoid option 4 inside business code.\n\n'One instance' is a lifetime decision made by whoever wires the program. It should not be enforced by a static accessor that every class can grab.",
    "say": "The real problem is global access to mutable state, not that there is one instance. I would extract an interface for config and logging, create one instance at startup, and pass it through constructors, so tests build their own. While migrating I could keep the static accessor with a test-only reset hook, and I would leave truly immutable singletons, like constants or a stateless formatter, as they are.",
    "appearsIn": [
      "logging-framework",
      "lru-cache",
      "notification-system"
    ],
    "related": [
      "singleton",
      "dip",
      "make-class-testable",
      "swap-storage-backend"
    ]
  },
  {
    "id": "evolve-api-without-breaking",
    "prompt": "You published `interface PaymentGateway { Receipt charge(Money amount); }` and twenty teams implement or call it. Now you need idempotency keys, currencies and refunds. How do you evolve the interface without breaking anyone?",
    "context": "Adding an abstract method to an interface breaks every implementer at compile time. Changing a signature breaks every caller. You do not control those teams' release schedules, so the change has to be safe to ship before they react.",
    "whyHard": "Interfaces are contracts, and the cost of changing a contract grows with the number of parties who rely on it. Backward compatibility, a clean design and your own ability to keep evolving pull in different directions.\n\nThe quick fix (default methods) can leave a muddled contract, and the clean fix (a new version) pushes work onto other teams.",
    "options": [
      {
        "name": "Add default methods",
        "concept": "Open/Closed and interface evolution",
        "conceptIds": [
          "interfaces",
          "ocp"
        ],
        "how": "Add the new operations as `default` methods whose body is a safe fallback: `charge(amount, key)` delegates to `charge(amount)`, and `refund` throws `UnsupportedOperationException`.\n\nExisting implementers compile unchanged, and new ones override what they support.",
        "code": [
          {
            "file": "After.java",
            "body": "record Money(long cents) { }\nrecord Receipt(String id, long cents) { }\n\ninterface PaymentGateway {\n    Receipt charge(Money amount);                                    // the original method, untouched\n\n    // New capabilities arrive as default methods, so existing implementations still compile.\n    default Receipt charge(Money amount, String idempotencyKey) { return charge(amount); }\n\n    default Receipt refund(Receipt original) {\n        throw new UnsupportedOperationException(\"refunds not supported by this gateway\");\n    }\n}\n\n// Written years ago, never touched, still compiles.\nclass LegacyGateway implements PaymentGateway {\n    public Receipt charge(Money amount) { return new Receipt(\"legacy-1\", amount.cents()); }\n}\n\nclass PaymentGatewayTest {\n    public static void main(String[] args) {\n        PaymentGateway g = new LegacyGateway();\n        if (g.charge(new Money(500), \"key-1\").cents() != 500) throw new AssertionError();\n        try { g.refund(g.charge(new Money(500))); throw new AssertionError(); }\n        catch (UnsupportedOperationException expected) { System.out.println(\"PASS old implementer unaffected\"); }\n    }\n}"
          }
        ],
        "pros": [
          "Zero breakage, and the quickest option",
          "New implementers opt in method by method"
        ],
        "cons": [
          "A default `refund` that throws breaks substitutability: callers cannot know whether it works",
          "The interface grows into a grab-bag over time"
        ],
        "pickWhen": "The behaviour is additive and has a sensible fallback."
      },
      {
        "name": "Split into small capability interfaces",
        "concept": "Interface Segregation Principle",
        "conceptIds": [
          "isp"
        ],
        "how": "Leave `PaymentGateway` frozen. Introduce `Refundable` and `IdempotentCharges` as separate interfaces. A gateway implements the ones it supports, and callers check `instanceof Refundable` before refunding.\n\nThe type system now says what a gateway can do.",
        "code": [
          {
            "file": "After.java",
            "body": "record Money(long cents) { }\nrecord Receipt(String id, long cents) { }\n\ninterface PaymentGateway { Receipt charge(Money amount); }          // v1 contract is frozen\n\n// New capabilities are separate, opt-in interfaces (Interface Segregation).\ninterface Refundable { Receipt refund(Receipt original); }\ninterface IdempotentCharges { Receipt charge(Money amount, String idempotencyKey); }\n\nclass StripeGateway implements PaymentGateway, Refundable, IdempotentCharges {\n    public Receipt charge(Money amount) { return new Receipt(\"st-1\", amount.cents()); }\n    public Receipt charge(Money amount, String key) { return charge(amount); }\n    public Receipt refund(Receipt original) { return new Receipt(\"rf-\" + original.id(), -original.cents()); }\n}\n\nclass CashGateway implements PaymentGateway {                       // supports only what it can do\n    public Receipt charge(Money amount) { return new Receipt(\"cash-1\", amount.cents()); }\n}\n\nclass RefundService {\n    Receipt refund(PaymentGateway gateway, Receipt receipt) {\n        if (gateway instanceof Refundable refundable) return refundable.refund(receipt);\n        throw new IllegalArgumentException(\"gateway cannot refund\");\n    }\n}\n\nclass RefundServiceTest {\n    public static void main(String[] args) {\n        RefundService service = new RefundService();\n        Receipt r = new StripeGateway().charge(new Money(900));\n        if (service.refund(new StripeGateway(), r).cents() != -900) throw new AssertionError();\n        try { service.refund(new CashGateway(), r); throw new AssertionError(); }\n        catch (IllegalArgumentException expected) { System.out.println(\"PASS capabilities are opt-in\"); }\n    }\n}"
          }
        ],
        "pros": [
          "No fake or throwing methods",
          "Each interface evolves independently",
          "Capabilities are explicit in the types"
        ],
        "cons": [
          "More interfaces and capability checks in callers",
          "Callers must handle gateways that lack a capability"
        ],
        "pickWhen": "Capabilities genuinely differ between implementations."
      },
      {
        "name": "Replace parameters with a request object",
        "concept": "Parameter Object / Builder",
        "conceptIds": [
          "builder",
          "ocp"
        ],
        "how": "Move the arguments into `ChargeRequest` with `withCurrency(...)` and `withIdempotencyKey(...)`. The signature becomes `charge(ChargeRequest)` and future fields never change it again.\n\nKeep `charge(Money)` as a deprecated default method that builds a request, so existing callers do not break.",
        "code": [
          {
            "file": "After.java",
            "body": "record Money(long cents) { }\nrecord Receipt(String id, long cents) { }\n\n// Future fields (currency, metadata, risk score) are added here, never to a method signature.\nrecord ChargeRequest(Money amount, String currency, String idempotencyKey) {\n    static ChargeRequest of(Money amount) { return new ChargeRequest(amount, \"INR\", null); }\n    ChargeRequest withIdempotencyKey(String key) { return new ChargeRequest(amount, currency, key); }\n    ChargeRequest withCurrency(String c) { return new ChargeRequest(amount, c, idempotencyKey); }\n}\n\ninterface PaymentGateway {\n    Receipt charge(ChargeRequest request);\n\n    @Deprecated\n    default Receipt charge(Money amount) { return charge(ChargeRequest.of(amount)); }   // old callers keep working\n}\n\nclass DemoGateway implements PaymentGateway {\n    public Receipt charge(ChargeRequest r) { return new Receipt(r.currency() + \"-\" + r.idempotencyKey(), r.amount().cents()); }\n}\n\nclass PaymentGatewayTest {\n    public static void main(String[] args) {\n        PaymentGateway g = new DemoGateway();\n        Receipt r = g.charge(ChargeRequest.of(new Money(700)).withCurrency(\"USD\").withIdempotencyKey(\"k1\"));\n        if (!r.id().equals(\"USD-k1\")) throw new AssertionError(r);\n        System.out.println(\"PASS \" + r);\n    }\n}"
          }
        ],
        "pros": [
          "Fixes the problem permanently: new fields never alter a signature",
          "Call sites stay readable"
        ],
        "cons": [
          "This one-time change *does* break existing implementers, because `charge(ChargeRequest)` is new and abstract",
          "Pair it with a deprecation window or the adapter in the next option"
        ],
        "pickWhen": "You expect many more fields and can afford one planned migration."
      },
      {
        "name": "Ship a v2 interface with an adapter for v1",
        "concept": "Adapter and versioned interfaces",
        "conceptIds": [
          "adapter",
          "interfaces"
        ],
        "how": "Publish `PaymentGatewayV2` with the clean contract. A `V1ToV2Adapter` wraps any old gateway so it can be used wherever v2 is expected.\n\nTeams migrate on their own schedule, and you delete v1 after the deprecation period.",
        "code": [
          {
            "file": "After.java",
            "body": "record Money(long cents) { }\nrecord Receipt(String id, long cents) { }\nrecord ChargeRequest(Money amount, String idempotencyKey) { }\n\ninterface PaymentGatewayV1 { Receipt charge(Money amount); }\n\ninterface PaymentGatewayV2 {\n    Receipt charge(ChargeRequest request);\n    Receipt refund(Receipt original);\n}\n\n// Old implementations are wrapped, not rewritten, so teams migrate on their own schedule.\nclass V1ToV2Adapter implements PaymentGatewayV2 {\n    private final PaymentGatewayV1 legacy;\n    V1ToV2Adapter(PaymentGatewayV1 legacy) { this.legacy = legacy; }\n\n    public Receipt charge(ChargeRequest request) { return legacy.charge(request.amount()); }   // key is ignored\n    public Receipt refund(Receipt original) { throw new UnsupportedOperationException(\"v1 gateways cannot refund\"); }\n}\n\nclass AdapterTest {\n    public static void main(String[] args) {\n        PaymentGatewayV1 v1 = amount -> new Receipt(\"v1\", amount.cents());\n        PaymentGatewayV2 v2 = new V1ToV2Adapter(v1);\n        if (v2.charge(new ChargeRequest(new Money(300), \"k\")).cents() != 300) throw new AssertionError();\n        System.out.println(\"PASS v1 code usable behind the v2 interface\");\n    }\n}"
          }
        ],
        "pros": [
          "No forced breaking change, and the new contract is clean",
          "Migration is incremental"
        ],
        "cons": [
          "Two versions to maintain for a while",
          "The adapter cannot invent missing features (refund fails for v1)"
        ],
        "pickWhen": "The new contract is substantially different from the old one."
      }
    ],
    "recommendation": "For small additive features use default methods (option 1), but only when a safe fallback exists. For capabilities that genuinely differ across implementations, use separate interfaces (option 2).\n\nIf the shape of the call itself is the problem, introduce a request object (option 3) together with a v2 interface and an adapter (option 4), then deprecate v1. Whatever you choose, announce it, deprecate before removing, and never break twenty teams in one release.",
    "say": "I would first ask which changes are additive. Idempotency can be a default method with a fallback. Refunds are a capability not every gateway has, so I would make a separate `Refundable` interface rather than a default method that throws. For the larger change I would introduce a `ChargeRequest` object so we never change the signature again, publish a v2 interface with an adapter for v1, and give teams a deprecation window.",
    "appearsIn": [
      "digital-wallet",
      "notification-system",
      "shopping-cart-system"
    ],
    "related": [
      "isp",
      "ocp",
      "add-new-payment-method",
      "lsp"
    ]
  },
  {
    "id": "circular-dependencies",
    "prompt": "`Order` calls `Customer` to apply a loyalty discount, and `Customer` calls `Order` to compute lifetime spend. The `orders` package imports `customers` and vice versa. How do you break the cycle?",
    "context": "The build is already painful: neither package can be compiled, tested or released without the other, and a change in one ripples into the other.\n\nThe interviewer is looking for a way to make the dependency point in only one direction.",
    "whyHard": "A cycle means the two classes are really one tangled unit, or that they share a responsibility that belongs somewhere else. You can hide the cycle (an interface here, a callback there) without fixing the design.\n\nSo you have to decide *which* direction should win and where the shared concept actually lives.",
    "options": [
      {
        "name": "Invert one dependency with an interface",
        "concept": "Dependency Inversion Principle",
        "conceptIds": [
          "dip",
          "interfaces"
        ],
        "how": "`orders` needs 'the discount for this customer', so it declares a small interface, `DiscountProvider`, and uses only that. The `customers` package implements it (`LoyaltyService`) and depends on `orders` for order history.\n\nNow the arrow runs from customers to orders only.",
        "code": [
          {
            "file": "After.java",
            "body": "// \"orders\" package: owns the abstraction it needs, so it never imports \"customers\".\ninterface DiscountProvider { int percentFor(String customerId); }\n\nrecord Order(String customerId, long cents) {\n    long payable(DiscountProvider discounts) {\n        return cents - cents * discounts.percentFor(customerId) / 100;\n    }\n}\n\ninterface OrderHistory { long lifetimeSpendCents(String customerId); }\n\n// \"customers\" package: depends on orders (one direction only) and implements its interface.\nclass LoyaltyService implements DiscountProvider {\n    private final OrderHistory history;\n    LoyaltyService(OrderHistory history) { this.history = history; }\n\n    public int percentFor(String customerId) {\n        return history.lifetimeSpendCents(customerId) >= 100_000 ? 10 : 0;\n    }\n}\n\nclass DipTest {\n    public static void main(String[] args) {\n        LoyaltyService loyalty = new LoyaltyService(id -> 250_000);\n        if (new Order(\"c1\", 10_000).payable(loyalty) != 9_000) throw new AssertionError();\n        System.out.println(\"PASS dependency now points one way\");\n    }\n}"
          }
        ],
        "pros": [
          "Surgical and idiomatic; the cycle is gone at compile time",
          "`Order` can be tested with a fake provider"
        ],
        "cons": [
          "Adds an interface purely to flip an arrow",
          "You must choose which package is the 'low-level' one"
        ],
        "pickWhen": "One side clearly needs only a narrow capability from the other."
      },
      {
        "name": "Introduce a coordinator between them",
        "concept": "Mediator",
        "conceptIds": [
          "mediator"
        ],
        "how": "`Order` and `Customer` stop knowing about each other. A `CheckoutCoordinator` fetches the lifetime spend from the order repository, asks `LoyaltyPolicy` for the discount and applies it.\n\nCross-cutting rules live in one place.",
        "code": [
          {
            "file": "After.java",
            "body": "record Order(String customerId, long cents) { }          // knows nothing about customers\nrecord Customer(String id, String name) { }               // knows nothing about orders\n\ninterface OrderRepository { long lifetimeSpendCents(String customerId); }\n\nclass LoyaltyPolicy {\n    int percentFor(long lifetimeSpendCents) { return lifetimeSpendCents >= 100_000 ? 10 : 0; }\n}\n\n// The coordinator is the only class that knows both sides, so the two never reference each other.\nclass CheckoutCoordinator {\n    private final OrderRepository orders;\n    private final LoyaltyPolicy loyalty;\n\n    CheckoutCoordinator(OrderRepository orders, LoyaltyPolicy loyalty) {\n        this.orders = orders;\n        this.loyalty = loyalty;\n    }\n\n    long payable(Order order) {\n        long spend = orders.lifetimeSpendCents(order.customerId());\n        int percent = loyalty.percentFor(spend);\n        return order.cents() - order.cents() * percent / 100;\n    }\n}\n\nclass MediatorTest {\n    public static void main(String[] args) {\n        CheckoutCoordinator checkout = new CheckoutCoordinator(id -> 500_000, new LoyaltyPolicy());\n        if (checkout.payable(new Order(\"c1\", 20_000)) != 18_000) throw new AssertionError();\n        System.out.println(\"PASS coordinator owns the cross-cutting rule\");\n    }\n}"
          }
        ],
        "pros": [
          "Both domain classes become simple and independent",
          "The interaction rule has a single home"
        ],
        "cons": [
          "The coordinator can grow into a new god class",
          "Another layer for readers to follow"
        ],
        "pickWhen": "The interaction is a real business rule that involves both sides."
      },
      {
        "name": "Communicate through events",
        "concept": "Observer / domain events",
        "conceptIds": [
          "observer"
        ],
        "how": "When an order is paid, `OrderService` publishes `OrderPaid`. The loyalty side subscribes and keeps its own running total.\n\n`orders` does not reference `customers` at all, and `customers` only knows about the event type.",
        "code": [
          {
            "file": "After.java",
            "body": "import java.util.HashMap;\nimport java.util.Map;\nimport java.util.function.Consumer;\nimport java.util.ArrayList;\nimport java.util.List;\n\nrecord OrderPaid(String customerId, long cents) { }\n\nclass EventBus {\n    private final List<Consumer<OrderPaid>> subscribers = new ArrayList<>();\n    void subscribe(Consumer<OrderPaid> s) { subscribers.add(s); }\n    void publish(OrderPaid e) { subscribers.forEach(s -> s.accept(e)); }\n}\n\n// Orders publishes facts and does not know who listens.\nclass OrderService {\n    private final EventBus bus;\n    OrderService(EventBus bus) { this.bus = bus; }\n    void pay(String customerId, long cents) { bus.publish(new OrderPaid(customerId, cents)); }\n}\n\n// Customers listens. The arrow points from customers to the bus, never back to orders.\nclass LoyaltyAccounts {\n    private final Map<String, Long> spend = new HashMap<>();\n    LoyaltyAccounts(EventBus bus) { bus.subscribe(this::onOrderPaid); }\n    private void onOrderPaid(OrderPaid e) { spend.merge(e.customerId(), e.cents(), Long::sum); }\n    long lifetimeSpend(String customerId) { return spend.getOrDefault(customerId, 0L); }\n}\n\nclass EventsTest {\n    public static void main(String[] args) {\n        EventBus bus = new EventBus();\n        LoyaltyAccounts accounts = new LoyaltyAccounts(bus);\n        OrderService orders = new OrderService(bus);\n        orders.pay(\"c1\", 400);\n        orders.pay(\"c1\", 600);\n        if (accounts.lifetimeSpend(\"c1\") != 1000) throw new AssertionError();\n        System.out.println(\"PASS no direct reference between orders and customers\");\n    }\n}"
          }
        ],
        "pros": [
          "Fully decoupled, and more subscribers can be added later",
          "Scales naturally to asynchronous processing"
        ],
        "cons": [
          "The flow is implicit and harder to trace",
          "Eventual consistency: the total may lag behind the order"
        ],
        "pickWhen": "Customers only needs to *react* to orders, not ask them questions."
      },
      {
        "name": "Pass data instead of objects",
        "concept": "Law of Demeter and a shared leaf class",
        "conceptIds": [
          "law-of-demeter",
          "srp"
        ],
        "how": "The discount rule is the real shared concept. Move it into `LoyaltyPolicy`, a leaf class with no dependencies, and let callers pass in plain values (`lifetimeSpendCents`).\n\n`Order` and `Customer` both depend on the leaf and on nothing else.",
        "code": [
          {
            "file": "After.java",
            "body": "// A leaf class with no dependencies: both sides may use it, and it uses neither.\nfinal class LoyaltyPolicy {\n    private LoyaltyPolicy() { }\n    static int percentFor(long lifetimeSpendCents) { return lifetimeSpendCents >= 100_000 ? 10 : 0; }\n}\n\n// Pass the data (a number), not the object that owns it.\nrecord Order(String customerId, long cents) {\n    long payable(long customersLifetimeSpendCents) {\n        return cents - cents * LoyaltyPolicy.percentFor(customersLifetimeSpendCents) / 100;\n    }\n}\n\nclass Customer {\n    private long lifetimeSpendCents;\n    void recordPurchase(long cents) { lifetimeSpendCents += cents; }\n    long lifetimeSpendCents() { return lifetimeSpendCents; }\n}\n\nclass DataNotObjectsTest {\n    public static void main(String[] args) {\n        Customer c = new Customer();\n        c.recordPurchase(150_000);\n        if (new Order(\"c1\", 10_000).payable(c.lifetimeSpendCents()) != 9_000) throw new AssertionError();\n        System.out.println(\"PASS Order and Customer never import each other\");\n    }\n}"
          }
        ],
        "pros": [
          "The simplest fix: no interfaces, no events",
          "The rule is a pure function that is trivial to test"
        ],
        "cons": [
          "Callers must fetch and pass the data themselves",
          "Does not help if the two classes need rich behaviour from each other"
        ],
        "pickWhen": "The cycle exists only to answer one question that a value can answer."
      }
    ],
    "recommendation": "Try option 4 first: if the cycle exists to share one rule, extract that rule into a dependency-free class and pass values. If a narrow capability is needed, invert it with an interface (option 1).\n\nUse a mediator (option 2) when the interaction is real business logic, and events (option 3) when one side only reacts. Whichever you pick, finish by checking that the package dependency graph has no cycles.",
    "say": "A cycle tells me a shared responsibility is in the wrong place. Here the discount rule is the shared concept, so I would move it into a small `LoyaltyPolicy` with no dependencies and pass the lifetime spend as a number. If `Order` really needs a capability from customers, I would declare an interface on the order side and let customers implement it, so the arrow points one way. For something like loyalty points that only reacts to orders, I would use a domain event.",
    "appearsIn": [
      "library-management-system",
      "social-network",
      "hotel-management-system"
    ],
    "related": [
      "dip",
      "mediator",
      "observer",
      "god-class-refactor"
    ]
  }
);
