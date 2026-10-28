// Curriculum manifest: defines the learning flow, ids and one-line summaries.
// Article content lives in data-*.js files keyed by the same ids.
(function () {
  var G = [
    { id: "oop", type: "lesson", title: "1. Object-Oriented Programming", blurb: "The vocabulary every LLD round assumes you have.", items: [
      ["classes-objects", "Classes & Objects", "Blueprints and instances: state, behaviour and identity."],
      ["interfaces", "Interfaces", "Contracts that decouple what a type does from how it does it."],
      ["inheritance", "Inheritance", "Reusing and specialising behaviour, and its costs."],
      ["polymorphism", "Polymorphism", "One call site, many behaviours chosen at runtime."],
      ["abstraction", "Abstraction", "Exposing essentials and hiding detail."],
      ["encapsulation", "Encapsulation", "Protecting invariants by bundling state with behaviour."],
      ["aggregation", "Aggregation", "A has-a relationship where the part outlives the whole."],
      ["composition", "Composition", "A has-a relationship where the whole owns the part's lifetime."],
      ["association", "Association", "How objects know about and use one another."]
    ] },
    { id: "principles", type: "lesson", title: "2. Design Principles", blurb: "The rules of thumb interviewers use to judge your class design.", items: [
      ["dry", "Don't Repeat Yourself (DRY)", "One source of truth for every piece of knowledge."],
      ["kiss", "Keep It Simple Stupid (KISS)", "Prefer the simplest design that works."],
      ["yagni", "You Aren't Gonna Need It (YAGNI)", "Don't build for requirements that don't exist yet."],
      ["law-of-demeter", "Law of Demeter (LoD)", "Talk to friends, not strangers."],
      ["srp", "Single Responsibility Principle (SRP)", "A class should have one reason to change."],
      ["ocp", "Open/Closed Principle (OCP)", "Open for extension, closed for modification."],
      ["lsp", "Liskov Substitution Principle (LSP)", "Subtypes must be usable wherever the base type is expected."],
      ["isp", "Interface Segregation Principle (ISP)", "Prefer several small interfaces over one fat one."],
      ["dip", "Dependency Inversion Principle (DIP)", "Depend on abstractions, not concretions."],
      ["solid-summary", "SOLID Principles - Summary", "All five principles side by side, with one worked refactor."]
    ] },
    { id: "uml", type: "lesson", title: "3. UML", blurb: "Just enough UML to sketch a design on a whiteboard.", items: [
      ["class-diagram", "Class Diagram", "Classes, attributes, methods and relationships."],
      ["use-case-diagram", "Use Case Diagram", "Actors and what the system lets them do."],
      ["sequence-diagram", "Sequence Diagram", "Interactions between objects over time."],
      ["activity-diagram", "Activity Diagram", "Workflows with branches and parallel steps."],
      ["state-machine-diagram", "State Machine Diagram", "States and the transitions between them."]
    ] },
    { id: "creational", type: "pattern", title: "4. Design Patterns: Creational", blurb: "Control how objects get created.", items: [
      ["singleton", "Singleton", "One instance with a global access point, and why it's often a smell.", "easy"],
      ["factory-method", "Factory Method", "Let subclasses decide which class to instantiate.", "easy"],
      ["abstract-factory", "Abstract Factory", "Create families of related objects without naming concrete classes.", "medium"],
      ["builder", "Builder", "Construct complex objects step by step.", "easy"],
      ["prototype", "Prototype", "Create new objects by cloning existing ones.", "easy"]
    ] },
    { id: "structural", type: "pattern", title: "5. Design Patterns: Structural", blurb: "Compose classes and objects into larger structures.", items: [
      ["adapter", "Adapter", "Make incompatible interfaces work together.", "easy"],
      ["facade", "Facade", "One simple entry point to a complicated subsystem.", "easy"],
      ["decorator", "Decorator", "Add behaviour by wrapping, without subclass explosions.", "medium"],
      ["composite", "Composite", "Treat single objects and trees of objects uniformly.", "medium"],
      ["proxy", "Proxy", "A stand-in that controls access to another object.", "medium"],
      ["bridge", "Bridge", "Decouple an abstraction from its implementation.", "hard"],
      ["flyweight", "Flyweight", "Share common state to support huge numbers of objects.", "hard"]
    ] },
    { id: "behavioral", type: "pattern", title: "6. Design Patterns: Behavioral", blurb: "Define how objects communicate and share responsibility.", items: [
      ["iterator", "Iterator", "Traverse a collection without exposing its internals.", "easy"],
      ["observer", "Observer", "Notify many dependents when one subject changes.", "easy"],
      ["strategy", "Strategy", "Swap algorithms at runtime behind one interface.", "easy"],
      ["command", "Command", "Turn requests into objects to queue, log and undo.", "medium"],
      ["state", "State", "Change behaviour when internal state changes.", "medium"],
      ["template-method", "Template Method", "Fix the skeleton of an algorithm and let subclasses fill in steps.", "easy"],
      ["visitor", "Visitor", "Add operations to a class hierarchy without modifying it.", "hard"],
      ["mediator", "Mediator", "Centralise how a group of objects interact.", "medium"],
      ["memento", "Memento", "Capture and restore an object's state for undo.", "medium"],
      ["chain-of-responsibility", "Chain of Responsibility", "Pass a request along handlers until one handles it.", "medium"],
      ["interpreter", "Interpreter (bonus)", "Represent a small grammar as objects and evaluate it.", "hard"]
    ] },
    { id: "concurrency", type: "lesson", title: "7. Concurrency & Locking", blurb: "How to keep data correct when many users hit the same row at once, such as the last item in stock.", items: [
      ["race-conditions", "Race Conditions & Check-Then-Act", "Why 'if stock > 0 then decrement' breaks under concurrency."],
      ["locks-synchronization", "Locks & Synchronization", "synchronized, ReentrantLock, per-key locks and lock granularity."],
      ["atomic-operations-cas", "Atomic Operations & Compare-And-Swap", "Lock-free updates with AtomicInteger, CAS loops and ConcurrentHashMap."],
      ["optimistic-vs-pessimistic-locking", "Optimistic vs Pessimistic Locking", "Detect conflicts with a version, or prevent them with a lock. When each wins."],
      ["database-locking", "Database Locking", "Row locks, SELECT FOR UPDATE, SKIP LOCKED, conditional UPDATE and isolation levels."],
      ["distributed-locks", "Distributed Locks", "Redis SET NX PX, expiry, fencing tokens and why a lock alone isn't enough."],
      ["reservation-with-ttl", "Reservation / Hold with Expiry", "Hold the last item for a few minutes, then confirm or release it."],
      ["idempotency", "Idempotency & Safe Retries", "Make duplicate requests and retries harmless."],
      ["deadlock-and-lock-ordering", "Deadlocks & Lock Ordering", "How deadlocks happen and how to prevent them."]
    ] },
    { id: "tips", type: "lesson", title: "8. LLD Interview Tips", blurb: "A repeatable framework for any LLD question.", items: [
      ["lld-interview-framework", "How to Answer a LLD Interview Question", "Requirements, entities, class design, extensibility and deep dives, step by step."]
    ] },
    { id: "q-easy", type: "question", title: "9. Interview Questions: Easy", blurb: "Warm-ups that test entity modelling and clean code.", items: [
      ["tic-tac-toe", "Design Tic Tac Toe", "N×N board with O(1) win detection.", "easy"],
      ["snake-and-ladder", "Design Snake and Ladder game", "Board, dice, players and jumps.", "easy"],
      ["lru-cache", "Design LRU Cache", "O(1) get/put with pluggable eviction.", "easy"],
      ["parking-lot", "Design Parking Lot", "Spots, tickets, allocation and pricing.", "easy"],
      ["task-management-system", "Design Task Management System", "Tasks, assignees, statuses and filtering.", "easy"]
    ] },
    { id: "q-medium", type: "question", title: "10. Interview Questions: Medium", blurb: "Multiple actors, state machines and extensibility.", items: [
      ["stack-overflow", "Design Stack Overflow", "Questions, answers, votes, tags and reputation.", "medium"],
      ["atm", "Design ATM", "Card, PIN, cash dispensing as a state machine.", "medium"],
      ["logging-framework", "Design Logging Framework", "Levels, appenders and formatters.", "medium"],
      ["pub-sub-system", "Design Pub Sub System", "Topics, publishers and subscribers.", "medium"],
      ["elevator-system", "Design Elevator System", "Dispatching requests across several elevators.", "medium"],
      ["splitwise", "Design Splitwise", "Shared expenses, splits and debt simplification.", "medium"],
      ["vending-machine", "Design Vending Machine", "Inventory, payment and dispensing states.", "medium"],
      ["car-rental-system", "Design Car Rental System", "Vehicles, reservations, availability and billing.", "medium"],
      ["hotel-management-system", "Design Hotel Management System", "Rooms, bookings, check-in and billing.", "medium"],
      ["digital-wallet", "Design a Digital Wallet Service", "Balances, transfers and transaction safety.", "medium"],
      ["airline-management-system", "Design Airline Management System", "Flights, schedules, seats and bookings.", "medium"],
      ["library-management-system", "Design Library Management System", "Books, members, loans and fines.", "medium"],
      ["traffic-signal-control-system", "Design Traffic Signal Control System", "Intersections, signal states and timing.", "medium"],
      ["concert-ticket-booking", "Design Concert Ticket Booking System", "Seat holds, payments and concurrent buyers.", "medium"],
      ["social-network", "Design Social Network Service like Facebook", "Profiles, friendships, posts and feeds.", "medium"]
    ] },
    { id: "q-hard", type: "question", title: "11. Interview Questions: Hard", blurb: "Large domains, concurrency and many collaborating services.", items: [
      ["spotify", "Design Spotify", "Catalogue, playlists, playback and recommendations.", "hard"],
      ["amazon", "Design Amazon", "Catalogue, cart, orders, payments and inventory.", "hard"],
      ["linkedin", "Design LinkedIn", "Profiles, connections, jobs and feed.", "hard"],
      ["cricinfo", "Design CricInfo", "Matches, live scorecards and commentary.", "hard"],
      ["chess-game", "Design Chess Game", "Pieces, move validation and game state.", "hard"],
      ["coffee-vending-machine", "Design Coffee Vending Machine", "Recipes, ingredients and extensible drinks.", "hard"],
      ["restaurant-management-system", "Design Restaurant Management System", "Tables, orders, kitchen and billing.", "hard"],
      ["online-stock-exchange", "Design Online Stock Exchange", "Order book, matching engine and trades.", "hard"],
      ["course-registration-system", "Design Course Registration System", "Courses, capacity, prerequisites and waitlists.", "hard"],
      ["movie-ticket-booking", "Design Movie Ticket Booking System", "BookMyShow: shows, seats and double-booking prevention.", "hard"],
      ["online-auction-system", "Design Online Auction System", "Listings, bidding rules and auction closing.", "hard"],
      ["online-food-delivery", "Design Online Food Delivery Service", "Restaurants, orders, delivery assignment and tracking.", "hard"],
      ["ride-sharing", "Design Ride-Sharing Service like Uber", "Rider-driver matching, trips and pricing.", "hard"]
    ] },
    { id: "q-more", type: "question", title: "12. More Frequently Asked Questions", blurb: "Other commonly reported LLD questions that round out the list.", items: [
      ["online-bookstore", "Design Online Bookstore", "Catalogue search, inventory, orders and payment.", "medium"],
      ["shopping-cart-system", "Design Shopping Cart System", "Cart operations, pricing rules and checkout.", "medium"],
      ["notification-system", "Design Notification System", "Email, SMS and push with reliable delivery.", "medium"],
      ["file-storage-system", "Design File Storage System like Google Drive", "Folders, sharing, permissions and versioning.", "hard"],
      ["chat-application", "Design Chat Application", "Users, chat rooms, messages and delivery.", "medium"],
      ["otp-generation-system", "Design OTP Generation System", "Generation, expiry, retry limits and verification.", "easy"],
      ["limited-stock-cart", "Design a Limited-Stock Cart (Flash Sale)", "Only 1 unit left and many buyers: who gets it? Locking, reservation and oversell prevention.", "hard"],
      ["quick-commerce-delivery-app", "Design a Quick-Commerce Delivery App", "Blinkit/Zepto style: dark-store inventory, cart holds, order packing and rider assignment.", "hard"]
    ] },
    { id: "sc-concurrency", type: "scenario", title: "13. Scenario Drills: Concurrency & Consistency", blurb: "Many users, one resource. Pick the right guard.", items: [
      ["last-item-in-stock", "Only 1 item left and many buyers", "Only one buyer may get the last unit. Which lock or hold stops oversell?", "hard"],
      ["double-booking-same-slot", "Two users book the same seat, slot or room", "Prevent double booking without making everyone wait.", "medium"],
      ["duplicate-charge-on-retry", "A retry charges the customer twice", "Make payments and other side effects safe to repeat.", "medium"],
      ["lost-update-counter", "Concurrent likes or views lose counts", "Increment counters correctly under contention.", "easy"],
      ["money-transfer-deadlock", "Two transfers A to B and B to A deadlock", "Move money between accounts without freezing.", "hard"],
      ["hold-expires-during-payment", "The hold expires while the user is paying", "Handle the race between a timeout and a late payment.", "hard"],
      ["stale-cache-after-update", "Users see old data after an update", "Keep a cache consistent with the source of truth.", "medium"],
      ["job-picked-by-two-workers", "Two workers pick up the same task", "Make sure each job runs exactly once.", "medium"]
    ] },
    { id: "sc-extensibility", type: "scenario", title: "14. Scenario Drills: Extensibility & Change", blurb: "The requirement changes tomorrow. Will your design bend or break?", items: [
      ["add-new-payment-method", "Add a new payment method", "Support UPI, wallet or crypto without editing existing code.", "easy"],
      ["add-new-pricing-rule", "Add surge, discount or coupon rules", "Combine and stack pricing rules cleanly.", "medium"],
      ["add-new-notification-channel", "Add a new notification channel", "Send via email, SMS, push and whatever comes next.", "easy"],
      ["new-vehicle-or-seat-type", "A new vehicle, seat or room type appears", "Enum lookup or polymorphism? Choose and justify.", "easy"],
      ["country-specific-rules", "Different rules per country or tenant", "Vary tax, limits and flows by region without if-else forests.", "medium"],
      ["add-undo-redo", "Add undo and redo", "Reverse operations and restore earlier states.", "medium"],
      ["add-approval-workflow", "Add a multi-step approval flow", "Route a request through configurable approvers.", "medium"],
      ["swap-storage-backend", "Swap in-memory storage for a database", "Change persistence without rewriting business logic.", "medium"]
    ] },
    { id: "sc-failure", type: "scenario", title: "15. Scenario Drills: Failure & Reliability", blurb: "Things break halfway. Show you planned for it.", items: [
      ["payment-succeeds-order-fails", "Payment succeeded but the order failed", "Handle partial failure across steps with compensation.", "hard"],
      ["downstream-service-down", "A dependency is down or slow", "Timeouts, retries, circuit breakers and fallbacks.", "medium"],
      ["retry-storm", "Retries make the outage worse", "Back off, add jitter and cap retries.", "medium"],
      ["crash-midway-recovery", "The process crashes mid-operation", "Persist state so work can resume safely.", "hard"],
      ["partial-batch-failure", "Some items in a batch fail", "All-or-nothing, best-effort or per-item results?", "medium"],
      ["message-delivery-guarantees", "Messages are lost or delivered twice", "At-most-once, at-least-once and effectively-once.", "hard"],
      ["cancel-mid-flow", "The user cancels halfway through", "Roll back or compensate in-progress work.", "medium"]
    ] },
    { id: "sc-scale", type: "scenario", title: "16. Scenario Drills: Scale & Performance", blurb: "Same design, a thousand times the traffic.", items: [
      ["hot-key-contention", "One product or row gets all the traffic", "Spread load off a single hot key.", "hard"],
      ["read-heavy-caching", "Reads vastly outnumber writes", "Choose a caching strategy and invalidation approach.", "medium"],
      ["fan-out-to-millions", "Notify a million followers", "Observer at scale: queues, batching and fan-out strategies.", "hard"],
      ["search-and-filter-speed", "Search and filtering are too slow", "Indexes, inverted indexes and precomputed views.", "medium"],
      ["large-collections-memory", "Too many objects or a huge result set", "Pagination, streaming and sharing state with Flyweight.", "medium"],
      ["rate-limit-abuse", "One client floods the system", "Token bucket, sliding window and per-key limits.", "medium"],
      ["expiry-at-scale", "Millions of things need to expire on time", "Timers vs sweepers vs delay queues.", "hard"]
    ] },
    { id: "sc-data", type: "scenario", title: "17. Scenario Drills: Data Modeling & State", blurb: "Modeling choices that decide how painful the next feature is.", items: [
      ["enum-vs-state-pattern", "Enum status or the State pattern?", "Model lifecycle and allowed transitions.", "medium"],
      ["remove-if-else-on-type", "A growing if-else on type codes", "Replace conditionals with polymorphism or a strategy map.", "easy"],
      ["inheritance-vs-composition", "Inheritance or composition here?", "Decide how to share behaviour without tight coupling.", "easy"],
      ["seat-vs-showseat-modeling", "Physical thing vs per-event state", "Separate permanent facts from per-context availability.", "medium"],
      ["history-and-soft-delete", "Keep history, audit and deleted records", "Soft delete, versioning and event logs.", "medium"],
      ["overlapping-time-intervals", "Bookings with overlapping time ranges", "Check and index intervals correctly.", "medium"],
      ["unique-id-generation", "Generate unique ids", "UUID, DB sequence, snowflake and human-friendly codes.", "easy"],
      ["money-and-precision", "Handle money and rounding", "Why not double, and how to model currency.", "easy"]
    ] },
    { id: "sc-quality", type: "scenario", title: "18. Scenario Drills: Design Quality & Testing", blurb: "The meta-questions: is this design actually good?", items: [
      ["make-class-testable", "Make this class unit-testable", "Dependency injection, interfaces and fake clocks.", "easy"],
      ["god-class-refactor", "One giant class does everything", "Split by responsibility without over-fragmenting.", "medium"],
      ["overengineering-patterns", "You used five patterns for a simple problem", "When a pattern is justified and when it is noise.", "medium"],
      ["singleton-global-state", "Global state is causing bugs", "Alternatives to Singleton and shared mutable state.", "medium"],
      ["evolve-api-without-breaking", "Change an interface without breaking callers", "Interface segregation, versioning and defaults.", "medium"],
      ["circular-dependencies", "Two classes depend on each other", "Break cycles with Dependency Inversion, events or a mediator.", "medium"]
    ] }
  ];

  var PAGES = { lesson: "lesson.html", pattern: "pattern.html", question: "question.html", scenario: "scenario.html" };
  var flat = [];
  G.forEach(function (g) {
    g.items = g.items.map(function (it) {
      var item = {
        id: it[0], title: it[1], desc: it[2], difficulty: it[3] || "easy",
        type: g.type, group: g.id, groupTitle: g.title,
        href: PAGES[g.type] + "?id=" + it[0]
      };
      flat.push(item);
      return item;
    });
  });
  window.PATH_GROUPS = G;
  window.PATH = flat;
})();
