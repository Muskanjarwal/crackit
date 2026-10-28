window.SCENARIOS = window.SCENARIOS || [];
window.SCENARIOS.push(
  {
    "id": "enum-vs-state-pattern",
    "prompt": "An order moves through CREATED, PAID, SHIPPED, DELIVERED and CANCELLED. Would you model the status as an enum or with the State pattern?",
    "context": "Rules: you can only ship a paid order, you can cancel until it ships, and cancelling a paid order triggers a refund. Product says new states (RETURNED, REFUNDED) will arrive over the next quarter.\n\nThe interviewer is checking whether you can match the weight of the solution to the size of the problem, not whether you know the State pattern.",
    "whyHard": "Both answers can be right. An enum is the lightest thing that works, but guard checks scatter across every method that touches the status. The State pattern puts each state's rules in one place, but it adds a class per state and a lot of ceremony when states differ only by which transitions they allow.\n\nThe real question is whether states differ in *behaviour* or only in *which moves are legal*.",
    "options": [
      {
        "name": "Enum with guard checks",
        "concept": "Enum status with if-guards (encapsulation)",
        "conceptIds": [
          "encapsulation"
        ],
        "how": "Keep a `Status` enum and check it with `if` statements inside each operation that cares. Every method that changes or depends on the status carries its own guard.",
        "code": [
          {
            "file": "Order.java",
            "body": "enum Status { CREATED, PAID, SHIPPED, DELIVERED, CANCELLED }\n\nclass Order {\n  private Status status = Status.CREATED;\n\n  void ship() {\n    if (status != Status.PAID) {\n      throw new IllegalStateException(\"Cannot ship from \" + status);\n    }\n    status = Status.SHIPPED;\n  }\n\n  void cancel() {\n    if (status == Status.SHIPPED || status == Status.DELIVERED || status == Status.CANCELLED) {\n      throw new IllegalStateException(\"Cannot cancel from \" + status);\n    }\n    status = Status.CANCELLED;\n  }\n}"
          }
        ],
        "pros": [
          "Fewest moving parts, readable at a glance",
          "Fine when there are only a few states and rules",
          "Easy to persist: one enum column"
        ],
        "cons": [
          "Guards are duplicated across methods and drift apart",
          "Adding a state means finding every `if` that mentions the status",
          "Nothing lists the legal transitions in one place"
        ],
        "pickWhen": "Three or four states and a couple of rules, and the lifecycle is unlikely to grow."
      },
      {
        "name": "Enum plus a transition table",
        "concept": "Finite state machine expressed as data",
        "conceptIds": [
          "state-machine-diagram"
        ],
        "how": "Describe the lifecycle as data: a map from each status to the set of statuses it may move to. One method, `moveTo`, enforces it. Adding RETURNED means adding one row.",
        "code": [
          {
            "file": "Order.java",
            "body": "import java.util.EnumMap;\nimport java.util.EnumSet;\nimport java.util.Map;\nimport java.util.Set;\n\nenum Status { CREATED, PAID, SHIPPED, DELIVERED, CANCELLED }\n\nclass Order {\n  private static final Map<Status, Set<Status>> ALLOWED = new EnumMap<>(Status.class);\n\n  static {\n    ALLOWED.put(Status.CREATED,   EnumSet.of(Status.PAID, Status.CANCELLED));\n    ALLOWED.put(Status.PAID,      EnumSet.of(Status.SHIPPED, Status.CANCELLED));\n    ALLOWED.put(Status.SHIPPED,   EnumSet.of(Status.DELIVERED));\n    ALLOWED.put(Status.DELIVERED, EnumSet.noneOf(Status.class));\n    ALLOWED.put(Status.CANCELLED, EnumSet.noneOf(Status.class));\n  }\n\n  private Status status = Status.CREATED;\n\n  void moveTo(Status next) {\n    if (!ALLOWED.get(status).contains(next)) {\n      throw new IllegalStateException(status + \" -> \" + next + \" is not allowed\");\n    }\n    status = next;\n  }\n}"
          }
        ],
        "pros": [
          "The whole lifecycle fits on one screen and can be unit-tested as a table",
          "Illegal transitions are rejected in exactly one place",
          "Easy to draw as a state diagram or validate at startup"
        ],
        "cons": [
          "Says what is *allowed*, not what *happens* on a transition",
          "Side effects such as a refund or a notification still need a home, often an `if` after `moveTo`"
        ],
        "pickWhen": "States differ only by which transitions are legal. This is the default I would start with."
      },
      {
        "name": "Enum constants with behaviour",
        "concept": "Polymorphism on enum constants",
        "conceptIds": [
          "polymorphism"
        ],
        "how": "Give the enum default methods and override them per constant, so each status decides what `pay()` or `ship()` returns. The order just delegates: `status = status.pay()`. Anything a constant does not override is illegal by default.",
        "code": [
          {
            "file": "Status.java",
            "body": "enum Status {\n  CREATED {\n    Status pay()    { return PAID; }\n    Status cancel() { return CANCELLED; }\n  },\n  PAID {\n    Status ship()   { return SHIPPED; }\n    Status cancel() { return CANCELLED; }\n  },\n  SHIPPED {\n    Status deliver() { return DELIVERED; }\n  },\n  DELIVERED, CANCELLED;\n\n  Status pay()     { throw illegal(\"pay\"); }\n  Status ship()    { throw illegal(\"ship\"); }\n  Status deliver() { throw illegal(\"deliver\"); }\n  Status cancel()  { throw illegal(\"cancel\"); }\n\n  private IllegalStateException illegal(String action) {\n    return new IllegalStateException(\"Cannot \" + action + \" from \" + this);\n  }\n}\n\nclass Order {\n  private Status status = Status.CREATED;\n\n  void pay()     { status = status.pay(); }\n  void ship()    { status = status.ship(); }\n  void deliver() { status = status.deliver(); }\n  void cancel()  { status = status.cancel(); }\n}"
          }
        ],
        "pros": [
          "No `if` on the status: the constant is the rule",
          "Still a plain enum, so it persists and compares cheaply",
          "One place to read each state's rules"
        ],
        "cons": [
          "Constants cannot hold per-order data or injected collaborators",
          "Large enums with many overrides get hard to read",
          "Side effects need access to the order, which the enum does not have"
        ],
        "pickWhen": "States carry different behaviour but no per-instance data or dependencies."
      },
      {
        "name": "State pattern",
        "concept": "State pattern (one class per state)",
        "conceptIds": [
          "state"
        ],
        "how": "Make each state a class that implements the same interface. The order holds a reference to its current state and delegates every action to it. A state decides both whether the action is legal and what side effects it triggers, then returns the next state.",
        "code": [
          {
            "file": "OrderState.java",
            "body": "interface OrderState {\n  OrderState pay(Order order);\n  OrderState ship(Order order);\n  OrderState cancel(Order order);\n}\n\nclass Created implements OrderState {\n  public OrderState pay(Order order)    { order.chargeCard(); return new Paid(); }\n  public OrderState ship(Order order)   { throw new IllegalStateException(\"Pay before shipping\"); }\n  public OrderState cancel(Order order) { return new Cancelled(); }\n}\n\nclass Paid implements OrderState {\n  public OrderState pay(Order order)    { throw new IllegalStateException(\"Already paid\"); }\n  public OrderState ship(Order order)   { order.notifyWarehouse(); return new Shipped(); }\n  public OrderState cancel(Order order) { order.refund(); return new Cancelled(); }\n}\n\nclass Shipped implements OrderState {\n  public OrderState pay(Order order)    { throw new IllegalStateException(\"Already paid\"); }\n  public OrderState ship(Order order)   { throw new IllegalStateException(\"Already shipped\"); }\n  public OrderState cancel(Order order) { throw new IllegalStateException(\"Too late to cancel\"); }\n}\n\nclass Cancelled implements OrderState {\n  public OrderState pay(Order order)    { throw new IllegalStateException(\"Order is cancelled\"); }\n  public OrderState ship(Order order)   { throw new IllegalStateException(\"Order is cancelled\"); }\n  public OrderState cancel(Order order) { throw new IllegalStateException(\"Already cancelled\"); }\n}"
          },
          {
            "file": "Order.java",
            "body": "class Order {\n  private OrderState state = new Created();\n\n  void pay()    { state = state.pay(this); }\n  void ship()   { state = state.ship(this); }\n  void cancel() { state = state.cancel(this); }\n\n  void chargeCard()      { /* call the payment gateway */ }\n  void notifyWarehouse() { /* publish a ShipRequested event */ }\n  void refund()          { /* reverse the charge */ }\n}"
          }
        ],
        "pros": [
          "Each state's rules and side effects live in one class",
          "States can hold data and collaborators of their own",
          "A new state is a new class, and existing states stay untouched"
        ],
        "cons": [
          "A class per state and one method per action is heavy for a simple lifecycle",
          "Every new *action* touches all state classes",
          "Persisting means mapping the state class back to a stored value"
        ],
        "pickWhen": "States have different behaviour and side effects, or carry their own data such as retry counts, timers or a partial cart."
      }
    ],
    "recommendation": "Start with the transition table. It is small, testable and shows the lifecycle at a glance. Move to State classes when states start to differ in *behaviour* (different side effects, different data) rather than just in which moves are allowed. Persist the status as a plain enum or string either way.\n\nIf you do pick the State pattern in the interview, say why the enum stopped being enough. A pattern with no stated reason reads as pattern-dropping.",
    "say": "I'd model the status as an enum with an explicit transition table, so illegal moves are rejected in one place. If the states later need different behaviour or their own data, like the refund on a paid cancel, I'd promote them to State classes. Until then the pattern would only add classes.",
    "appearsIn": [
      "vending-machine",
      "atm",
      "elevator-system",
      "traffic-signal-control-system",
      "restaurant-management-system"
    ],
    "related": [
      "state",
      "state-machine-diagram",
      "polymorphism",
      "remove-if-else-on-type"
    ]
  },
  {
    "id": "remove-if-else-on-type",
    "prompt": "This discount method has an if-else chain on customer type. Marketing adds a new customer type every month. How would you refactor it?",
    "context": "The code works today, but every new type means opening the same method, and the same chain is starting to appear in three other places: shipping fees, loyalty points and email templates.\n\nThe interviewer wants to see you name the smell (switching on a type code), pick a technique, and say where the remaining decision lives.",
    "whyHard": "You cannot delete the decision. Somewhere, a customer type has to turn into a behaviour. The skill is moving that decision to one place that changes rarely, and making every other place ignorant of the type.\n\nCandidates often reach for inheritance by reflex, then get stuck when a customer has to change type at runtime.",
    "options": [
      {
        "name": "Subclass per type",
        "concept": "Polymorphism / Open-Closed Principle",
        "conceptIds": [
          "polymorphism",
          "ocp"
        ],
        "how": "Move the behaviour into the type. `Customer` declares `discountRate()` and each subclass answers for itself. Callers just call `apply`. The first tab shows the starting point.",
        "code": [
          {
            "file": "Before.java",
            "body": "enum CustomerType { REGULAR, PREMIUM, EMPLOYEE }\n\nclass DiscountCalculator {\n  double apply(CustomerType type, double amount) {\n    if (type == CustomerType.REGULAR) {\n      return amount;\n    } else if (type == CustomerType.PREMIUM) {\n      return amount * 0.90;\n    } else if (type == CustomerType.EMPLOYEE) {\n      return amount * 0.70;\n    }\n    throw new IllegalArgumentException(\"Unknown type \" + type);\n  }\n}"
          },
          {
            "file": "Customer.java",
            "body": "abstract class Customer {\n  abstract double discountRate();\n\n  double apply(double amount) {\n    return amount * (1 - discountRate());\n  }\n}\n\nclass RegularCustomer extends Customer {\n  double discountRate() { return 0.0; }\n}\n\nclass PremiumCustomer extends Customer {\n  double discountRate() { return 0.10; }\n}\n\nclass EmployeeCustomer extends Customer {\n  double discountRate() { return 0.30; }\n}"
          }
        ],
        "pros": [
          "No branching anywhere: adding a type means adding a class",
          "Each type's rules sit next to its data",
          "The compiler forces every subclass to answer"
        ],
        "cons": [
          "The type is fixed when the object is created, so a regular customer who becomes premium needs a new object",
          "One subclass per variation multiplies if types also vary on a second axis",
          "Persistence needs a type column and a mapper"
        ],
        "pickWhen": "The type never changes for the life of the object and behaviour differs in several methods."
      },
      {
        "name": "Inject a strategy",
        "concept": "Strategy pattern / composition",
        "conceptIds": [
          "strategy",
          "composition"
        ],
        "how": "Keep one `Customer` class and give it a discount policy to call. Changing type is swapping the policy, and policies can be shared, tested and reused by other classes.",
        "code": [
          {
            "file": "Customer.java",
            "body": "interface DiscountPolicy {\n  double apply(double amount);\n}\n\nclass Customer {\n  private final DiscountPolicy policy;\n\n  Customer(DiscountPolicy policy) { this.policy = policy; }\n\n  double priceFor(double amount) { return policy.apply(amount); }\n}\n\nclass Policies {\n  static final DiscountPolicy REGULAR  = amount -> amount;\n  static final DiscountPolicy PREMIUM  = amount -> amount * 0.90;\n  static final DiscountPolicy EMPLOYEE = amount -> amount * 0.70;\n}"
          }
        ],
        "pros": [
          "Behaviour can change at runtime",
          "Policies are tiny, reusable and unit-testable",
          "No subclass explosion when a second axis appears, such as a shipping or tax policy"
        ],
        "cons": [
          "Someone must still choose which policy to inject",
          "More objects to wire together",
          "Overkill if only one method varies and never changes"
        ],
        "pickWhen": "The behaviour can change over an object's life, or there is more than one axis of variation."
      },
      {
        "name": "Registry of rules",
        "concept": "Lookup table of behaviours",
        "conceptIds": [
          "ocp"
        ],
        "how": "Replace the chain with a map from type to a function. The calculator looks up the rule and applies it. Rules can be registered from configuration or other modules.",
        "code": [
          {
            "file": "DiscountCalculator.java",
            "body": "import java.util.EnumMap;\nimport java.util.Map;\nimport java.util.function.DoubleUnaryOperator;\n\nenum CustomerType { REGULAR, PREMIUM, EMPLOYEE }\n\nclass DiscountCalculator {\n  private final Map<CustomerType, DoubleUnaryOperator> rules = new EnumMap<>(CustomerType.class);\n\n  DiscountCalculator() {\n    rules.put(CustomerType.REGULAR,  amount -> amount);\n    rules.put(CustomerType.PREMIUM,  amount -> amount * 0.90);\n    rules.put(CustomerType.EMPLOYEE, amount -> amount * 0.70);\n  }\n\n  double apply(CustomerType type, double amount) {\n    DoubleUnaryOperator rule = rules.get(type);\n    if (rule == null) {\n      throw new IllegalArgumentException(\"Unknown type \" + type);\n    }\n    return rule.applyAsDouble(amount);\n  }\n}"
          }
        ],
        "pros": [
          "Very little code and no class per type",
          "Rules can be registered at startup or by plugins",
          "All types are visible in one place"
        ],
        "cons": [
          "An unknown type fails at runtime, not at compile time",
          "Rules that need several methods become awkward lambdas",
          "The map is shared state if you are not careful"
        ],
        "pickWhen": "Each type maps to one small behaviour and new types arrive through configuration."
      },
      {
        "name": "One factory at the edge",
        "concept": "Factory Method",
        "conceptIds": [
          "factory-method"
        ],
        "how": "Accept that the type code exists at the system's edge (a request field, a database column) and translate it once into an object. The `switch` lives in exactly one factory, and everything after it works with the object.",
        "code": [
          {
            "file": "Discounts.java",
            "body": "interface Discount {\n  double apply(double amount);\n}\n\nclass Discounts {\n  // The only place that knows the type codes. Callers never branch on them.\n  static Discount forType(String type) {\n    switch (type) {\n      case \"REGULAR\":  return amount -> amount;\n      case \"PREMIUM\":  return amount -> amount * 0.90;\n      case \"EMPLOYEE\": return amount -> amount * 0.70;\n      default: throw new IllegalArgumentException(\"Unknown type \" + type);\n    }\n  }\n}"
          }
        ],
        "pros": [
          "The honest answer when input arrives as a string or an enum",
          "One place to update for a new type",
          "Combines with any of the options above"
        ],
        "cons": [
          "The factory still changes for every new type, so it is not strictly open/closed",
          "It does nothing about the behaviour: you still need an interface to return"
        ],
        "pickWhen": "Types come from outside (API, database, config) and you only need the translation once."
      }
    ],
    "recommendation": "Define a small interface for the varying behaviour, implement it per type, and confine the type-to-object switch to one factory. Choose Strategy over subclassing when the type can change at runtime or when a second dimension of variation appears.\n\nDo not refactor a chain that has two branches and no growth. A plain `if` is fine until the third case or the second copy.",
    "say": "An if-else on a type code is a smell because every new type edits the same method. I'd pull the varying behaviour into an interface, implement it once per type, and keep a single factory that turns the incoming type into the right implementation. Then a new type means a new class and one factory line.",
    "appearsIn": [
      "parking-lot",
      "car-rental-system",
      "coffee-vending-machine",
      "splitwise",
      "online-food-delivery"
    ],
    "related": [
      "strategy",
      "polymorphism",
      "ocp",
      "add-new-pricing-rule",
      "enum-vs-state-pattern"
    ]
  },
  {
    "id": "inheritance-vs-composition",
    "prompt": "You model Vehicle, Car and Truck. Now the requirements add electric, petrol and hybrid versions of each. How do you structure the classes?",
    "context": "A teammate has started extending: `ElectricCar extends Car`, `ElectricTruck extends Truck`, and now wants `HybridTruck`. The charging code is already copy-pasted in two classes.\n\nThe interviewer is probing whether you recognise two independent axes of variation (body type and powertrain) and know the cost of expressing both with one inheritance tree.",
    "whyHard": "Inheritance expresses one axis. Two axes in one tree give you a class for every combination, and shared behaviour such as `charge()` ends up duplicated, or pushed up into a base class where it does not belong.\n\nFixing it later is expensive because callers depend on the hierarchy.",
    "options": [
      {
        "name": "Deep inheritance",
        "concept": "Class inheritance (the trap)",
        "conceptIds": [
          "inheritance"
        ],
        "how": "Add a subclass for each combination. It looks natural for the first two or three types, which is how teams slide into it.",
        "code": [
          {
            "file": "Vehicles.java",
            "body": "class Vehicle {\n  void drive() { }\n}\n\nclass Car extends Vehicle { }\nclass Truck extends Vehicle { }\n\nclass ElectricCar extends Car {\n  void charge() { }\n}\n\nclass ElectricTruck extends Truck {\n  void charge() { }              // copy of ElectricCar.charge()\n}\n\nclass HybridTruck extends Truck {\n  void charge() { }              // another copy\n  void refuel() { }\n}\n// Next: HybridCar, ElectricBus, HydrogenTruck... every new axis multiplies the classes."
          }
        ],
        "pros": [
          "Simple to read with two or three types",
          "Polymorphism works out of the box",
          "No wiring: `new ElectricTruck()`"
        ],
        "cons": [
          "Classes multiply with every new axis or value",
          "`charge()` is duplicated, or lifted into a base class that gets a method it should not have",
          "Cannot change the powertrain of an existing object"
        ],
        "pickWhen": "There is one axis of variation and a true, stable is-a relationship."
      },
      {
        "name": "Compose an Engine",
        "concept": "Composition over inheritance",
        "conceptIds": [
          "composition",
          "strategy"
        ],
        "how": "Pull the powertrain out into an `Engine` interface and let a `Vehicle` have one. The body is just data. Any body with any engine is one constructor call, and the engine can be faked in tests.",
        "code": [
          {
            "file": "Vehicle.java",
            "body": "interface Engine {\n  void start();\n  double rangeKm();\n}\n\nclass PetrolEngine implements Engine {\n  public void start()      { System.out.println(\"petrol engine on\"); }\n  public double rangeKm()  { return 700; }\n}\n\nclass ElectricEngine implements Engine {\n  public void start()      { System.out.println(\"electric motor on\"); }\n  public double rangeKm()  { return 400; }\n}\n\nenum Body { CAR, TRUCK, BUS }\n\nclass Vehicle {\n  private final Body body;\n  private final Engine engine;     // has-a, swappable and testable\n\n  Vehicle(Body body, Engine engine) {\n    this.body = body;\n    this.engine = engine;\n  }\n\n  void drive() {\n    engine.start();\n    System.out.println(body + \" moving, range \" + engine.rangeKm() + \" km\");\n  }\n}\n// new Vehicle(Body.TRUCK, new ElectricEngine()) needs no new class."
          }
        ],
        "pros": [
          "No new class for a new combination",
          "The engine can be swapped at runtime or replaced with a test double",
          "Each engine's behaviour is written once"
        ],
        "cons": [
          "Callers must wire the parts together (a factory or builder helps)",
          "If body types need different *behaviour*, a plain enum is not enough",
          "One more level of indirection to read"
        ],
        "pickWhen": "The behaviour you want to vary independently should be reusable across types."
      },
      {
        "name": "Bridge two hierarchies",
        "concept": "Bridge pattern",
        "conceptIds": [
          "bridge",
          "composition"
        ],
        "how": "Keep an abstraction hierarchy for what the vehicle *is* (`Car`, `Truck`) and an implementation hierarchy for how it is *powered* (`Engine`). The abstraction holds a reference to the implementation, so both hierarchies grow independently.",
        "code": [
          {
            "file": "Vehicle.java",
            "body": "interface Engine {\n  void start();\n}\n\nclass PetrolEngine implements Engine {\n  public void start() { System.out.println(\"petrol engine on\"); }\n}\n\nclass ElectricEngine implements Engine {\n  public void start() { System.out.println(\"electric motor on\"); }\n}\n\nabstract class Vehicle {\n  protected final Engine engine;           // the bridge\n\n  protected Vehicle(Engine engine) { this.engine = engine; }\n\n  abstract void drive();\n}\n\nclass Car extends Vehicle {\n  Car(Engine engine) { super(engine); }\n\n  void drive() {\n    engine.start();\n    System.out.println(\"car cruising\");\n  }\n}\n\nclass Truck extends Vehicle {\n  Truck(Engine engine) { super(engine); }\n\n  void drive() {\n    engine.start();\n    System.out.println(\"truck hauling\");\n  }\n}"
          }
        ],
        "pros": [
          "Body types keep their own behaviour (`drive()` differs)",
          "A new body or a new engine does not touch the other side",
          "Fits when both axes have real behaviour"
        ],
        "cons": [
          "The most ceremony of the options",
          "Easy to over-apply to something that is only two enum values",
          "Reads as pattern-dropping unless you name the two axes"
        ],
        "pickWhen": "Both axes carry real behaviour and each will keep growing."
      },
      {
        "name": "Capability interfaces",
        "concept": "Interfaces / Interface Segregation",
        "conceptIds": [
          "interfaces",
          "isp"
        ],
        "how": "Describe what a vehicle can do with small interfaces such as `Chargeable` and `Refuelable`. Code that needs a charger depends only on `Chargeable`, so it works with any vehicle that can charge, whatever its class.",
        "code": [
          {
            "file": "Capabilities.java",
            "body": "interface Chargeable {\n  void charge();\n}\n\ninterface Refuelable {\n  void refuel();\n}\n\nclass Vehicle {\n  void drive() { }\n}\n\nclass ElectricCar extends Vehicle implements Chargeable {\n  public void charge() { }\n}\n\nclass HybridTruck extends Vehicle implements Chargeable, Refuelable {\n  public void charge() { }\n  public void refuel() { }\n}\n\nclass ChargingStation {\n  void plugIn(Chargeable vehicle) {      // depends only on the capability\n    vehicle.charge();\n  }\n}"
          }
        ],
        "pros": [
          "Callers depend on a capability, not a class hierarchy",
          "A hybrid simply implements both",
          "Works alongside composition or inheritance"
        ],
        "cons": [
          "Each class still implements the method itself (delegate to share the code)",
          "Capability interfaces can proliferate",
          "Does not model state such as battery level"
        ],
        "pickWhen": "Unrelated classes should be usable by the same piece of code."
      }
    ],
    "recommendation": "Default to composition. Use inheritance only for a real is-a relationship on a single axis, and add small capability interfaces for the code that consumes the objects. For two independent axes with real behaviour, Bridge is the formal name for composition done deliberately.\n\nA useful test: if you can say 'a truck *has* an electric engine' more comfortably than 'an ElectricTruck *is a* Truck', compose.",
    "say": "Body type and powertrain are two independent axes, so one inheritance tree would need a class per combination. I'd keep the body as the main type and give it an Engine interface, so electric, petrol and hybrid are three implementations instead of nine classes. For code that only cares about charging, I'd depend on a Chargeable interface.",
    "appearsIn": [
      "parking-lot",
      "car-rental-system",
      "coffee-vending-machine",
      "ride-sharing",
      "spotify"
    ],
    "related": [
      "inheritance",
      "composition",
      "bridge",
      "strategy",
      "remove-if-else-on-type"
    ]
  },
  {
    "id": "seat-vs-showseat-modeling",
    "prompt": "In a movie booking system, where do you record that a seat is booked: on `Seat`, or somewhere else?",
    "context": "A theatre has 200 seats and runs five shows a day on each screen. The first version added a `booked` flag to `Seat`.\n\nThe interviewer is listening for whether you separate what is permanent (a physical seat) from what is temporary and contextual (its availability for a particular show).",
    "whyHard": "A seat is not booked or free in general. It is booked or free *for a show*. Putting the flag on `Seat` makes the second screening impossible, and the fix touches storage, locking and every query.\n\nThe modeling choice also decides where locks live and how contention behaves.",
    "options": [
      {
        "name": "Flag on Seat",
        "concept": "State stored on the physical entity (the trap)",
        "conceptIds": [
          "classes-objects"
        ],
        "how": "Add `boolean booked` to `Seat`. It is the first thing everyone tries, and it works for exactly one show.",
        "code": [
          {
            "file": "Seat.java",
            "body": "class Seat {\n  final String id;\n  boolean booked;          // booked for WHICH show? Breaks on the second screening.\n\n  Seat(String id) { this.id = id; }\n}"
          }
        ],
        "pros": [
          "Trivial to write",
          "One lookup to check availability"
        ],
        "cons": [
          "Wrong the moment a second show exists",
          "Resetting between shows loses booking history",
          "Cannot express HELD versus BOOKED per show"
        ],
        "pickWhen": "There is exactly one show and it will never repeat. In practice, never."
      },
      {
        "name": "ShowSeat join entity",
        "concept": "Association class between Show and Seat",
        "conceptIds": [
          "association",
          "aggregation"
        ],
        "how": "Introduce `ShowSeat`, one record per seat per show, holding status and a version. `Seat` stays an immutable physical fact. Each `ShowSeat` is a natural unit to lock, hold and confirm.",
        "code": [
          {
            "file": "ShowSeat.java",
            "body": "enum SeatStatus { AVAILABLE, HELD, BOOKED }\n\nclass Seat {                         // permanent physical fact\n  final String id;\n  final String type;\n\n  Seat(String id, String type) {\n    this.id = id;\n    this.type = type;\n  }\n}\n\nclass Show {\n  final String id;\n\n  Show(String id) { this.id = id; }\n}\n\nclass ShowSeat {                     // availability of one seat for one show\n  final Show show;\n  final Seat seat;\n  private SeatStatus status = SeatStatus.AVAILABLE;\n  private int version;             // for optimistic locking in a database\n\n  ShowSeat(Show show, Seat seat) {\n    this.show = show;\n    this.seat = seat;\n  }\n\n  synchronized boolean tryHold() {\n    if (status != SeatStatus.AVAILABLE) return false;\n    status = SeatStatus.HELD;\n    version++;\n    return true;\n  }\n\n  synchronized void confirm() {\n    if (status != SeatStatus.HELD) throw new IllegalStateException(\"Seat is not held\");\n    status = SeatStatus.BOOKED;\n    version++;\n  }\n}"
          }
        ],
        "pros": [
          "Per-seat state (AVAILABLE, HELD, BOOKED) with a clear owner",
          "A natural row to lock or version for concurrency",
          "Queries are simple: the seats of a show are its `ShowSeat`s"
        ],
        "cons": [
          "Many rows: seats times shows, created up front or lazily",
          "Two entities to keep in sync when the layout changes",
          "Slightly more to explain"
        ],
        "pickWhen": "You need per-seat holds, expiry or concurrency control. The usual choice for a real system."
      },
      {
        "name": "Show owns availability",
        "concept": "Aggregate that owns its own state",
        "conceptIds": [
          "composition"
        ],
        "how": "Let `Show` own a map of booked seats and expose `book` and `isAvailable`. `Seat` is a plain value (an id and a type). The show is the single place that enforces no double booking.",
        "code": [
          {
            "file": "Show.java",
            "body": "import java.util.HashMap;\nimport java.util.Map;\n\nclass Show {\n  private final Map<String, String> seatToBooking = new HashMap<>();\n\n  // The show owns its availability. Seat stays a plain value.\n  synchronized boolean book(String seatId, String bookingId) {\n    return seatToBooking.putIfAbsent(seatId, bookingId) == null;\n  }\n\n  synchronized boolean isAvailable(String seatId) {\n    return !seatToBooking.containsKey(seatId);\n  }\n}"
          }
        ],
        "pros": [
          "One owner and one lock, easy to reason about in memory",
          "No extra entity",
          "`putIfAbsent` makes booking atomic"
        ],
        "cons": [
          "A hot show serialises every booking on one lock",
          "Harder to persist as rows and to lock per seat",
          "The show object collects holds, expiry and pricing responsibilities"
        ],
        "pickWhen": "An in-memory design for an interview or a small system, with a lock per show."
      },
      {
        "name": "Derive from bookings",
        "concept": "Derived state from an append-only ledger",
        "conceptIds": [],
        "how": "Store only bookings. A seat is available if no active booking exists for that show and seat. Nothing is flipped, so nothing can drift out of sync.",
        "code": [
          {
            "file": "BookingLedger.java",
            "body": "import java.util.ArrayList;\nimport java.util.List;\n\nclass Booking {\n  final String showId;\n  final String seatId;\n  final boolean cancelled;\n\n  Booking(String showId, String seatId, boolean cancelled) {\n    this.showId = showId;\n    this.seatId = seatId;\n    this.cancelled = cancelled;\n  }\n}\n\nclass BookingLedger {\n  private final List<Booking> bookings = new ArrayList<>();\n\n  // Availability is derived, never stored.\n  boolean isAvailable(String showId, String seatId) {\n    return bookings.stream().noneMatch(b ->\n        b.showId.equals(showId) && b.seatId.equals(seatId) && !b.cancelled);\n  }\n}"
          }
        ],
        "pros": [
          "Full history for free and no status to keep consistent",
          "Cancellation is just another record",
          "A simple model for reporting"
        ],
        "cons": [
          "Availability needs a query, and a naive scan is slow",
          "Preventing double booking still needs a unique constraint or a lock on (show, seat)",
          "Holds with expiry are awkward without extra state"
        ],
        "pickWhen": "History and audit matter more than raw speed, and a database enforces uniqueness."
      }
    ],
    "recommendation": "Use `Seat` for the permanent fact and `ShowSeat` for per-show state. It gives you one object to hold, expire, version and lock, which is exactly what the double-booking and seat-hold requirements need. For a pure in-memory interview solution, a show-owned map is acceptable if you say so.\n\nSay the sentence out loud: a `Seat` never gets booked, a `ShowSeat` does.",
    "say": "A seat is not booked in general, it is booked for a show. So I'd keep Seat as an immutable physical fact and add ShowSeat for the per-show status, with a version for optimistic locking. That also gives me one unit to hold with an expiry and one row to lock.",
    "appearsIn": [
      "movie-ticket-booking",
      "concert-ticket-booking",
      "airline-management-system",
      "hotel-management-system",
      "course-registration-system"
    ],
    "related": [
      "association",
      "aggregation",
      "double-booking-same-slot",
      "reservation-with-ttl",
      "optimistic-vs-pessimistic-locking"
    ]
  },
  {
    "id": "history-and-soft-delete",
    "prompt": "A user deletes a saved address, or an admin cancels an order. Do you delete the row? Support wants to see what was there, restore it, and audit who changed what.",
    "context": "The first version used a hard `DELETE`. Two weeks later support asked for undo, finance asked for an audit trail, and a deleted address was still referenced by old orders.\n\nThe interviewer wants to hear that deleting is a product decision with trade-offs, not a technical default.",
    "whyHard": "Keeping old data makes every read more complicated: forgetting a filter shows deleted rows, unique constraints clash with deleted duplicates, and 'history' can mean three different things (who deleted it, what the old value was, or the exact sequence of changes).\n\nPick the weakest approach that answers the question actually being asked.",
    "options": [
      {
        "name": "Hard delete",
        "concept": "Hard delete, optionally with a separate audit log",
        "conceptIds": [
          "kiss"
        ],
        "how": "Remove the row. If an audit is required, write a row to a separate log table or file when it happens, outside the main model.",
        "code": [
          {
            "file": "AddressBook.java",
            "body": "import java.util.HashMap;\nimport java.util.Map;\n\nclass Address {\n  final String id;\n  final String line;\n\n  Address(String id, String line) {\n    this.id = id;\n    this.line = line;\n  }\n}\n\nclass AddressBook {\n  private final Map<String, Address> byId = new HashMap<>();\n\n  void save(Address address) { byId.put(address.id, address); }\n\n  void delete(String id) { byId.remove(id); }      // gone for good\n\n  Address find(String id) { return byId.get(id); }\n}"
          }
        ],
        "pros": [
          "Simplest model, smallest tables, no filters to forget",
          "Straightforward for privacy erasure requests",
          "Unique constraints behave"
        ],
        "cons": [
          "No undo",
          "Rows that reference it must be updated or blocked",
          "History only exists if you remembered to log it"
        ],
        "pickWhen": "The data is cheap, nothing references it, nobody needs it back, or the law demands erasure."
      },
      {
        "name": "Soft delete",
        "concept": "Soft delete (a deleted_at flag) behind a repository",
        "conceptIds": [
          "encapsulation"
        ],
        "how": "Add a nullable `deletedAt`. Delete sets it, restore clears it, and the repository filters on it in every read so callers cannot forget.",
        "code": [
          {
            "file": "AddressRepository.java",
            "body": "import java.time.Instant;\nimport java.util.HashMap;\nimport java.util.Map;\n\nclass Address {\n  final String id;\n  final String line;\n  Instant deletedAt;                       // null means active\n\n  Address(String id, String line) {\n    this.id = id;\n    this.line = line;\n  }\n}\n\nclass AddressRepository {\n  private final Map<String, Address> byId = new HashMap<>();\n\n  void save(Address address) { byId.put(address.id, address); }\n\n  // Every read path filters, so callers cannot forget.\n  Address findActive(String id) {\n    Address a = byId.get(id);\n    return (a == null || a.deletedAt != null) ? null : a;\n  }\n\n  void softDelete(String id) {\n    Address a = byId.get(id);\n    if (a != null && a.deletedAt == null) a.deletedAt = Instant.now();\n  }\n\n  void restore(String id) {\n    Address a = byId.get(id);\n    if (a != null) a.deletedAt = null;\n  }\n}"
          }
        ],
        "pros": [
          "Undo is trivial",
          "Old references stay valid",
          "A small change to an existing model"
        ],
        "cons": [
          "Every query must filter, and one missed filter leaks deleted data",
          "Unique constraints need to account for the flag, for example with a partial unique index",
          "Keeps data you may be required to erase",
          "Records that something was deleted, not what changed before"
        ],
        "pickWhen": "You need restore and valid references but not a full change history."
      },
      {
        "name": "Versioned rows",
        "concept": "Temporal records (valid_from / valid_to)",
        "conceptIds": [],
        "how": "Never update in place. Each change closes the current version (sets `validTo`) and inserts a new one. The current state is the version with no end, and any past state is a lookup by time.",
        "code": [
          {
            "file": "VersionedAddress.java",
            "body": "import java.time.Instant;\nimport java.util.ArrayList;\nimport java.util.List;\n\nclass AddressVersion {\n  final String line;\n  final Instant validFrom;\n  Instant validTo;                         // null means this is the current version\n\n  AddressVersion(String line, Instant validFrom) {\n    this.line = line;\n    this.validFrom = validFrom;\n  }\n}\n\nclass VersionedAddress {\n  private final List<AddressVersion> versions = new ArrayList<>();\n\n  void change(String newLine) {\n    Instant now = Instant.now();\n    if (!versions.isEmpty()) versions.get(versions.size() - 1).validTo = now;\n    versions.add(new AddressVersion(newLine, now));\n  }\n\n  String current() {\n    return versions.isEmpty() ? null : versions.get(versions.size() - 1).line;\n  }\n\n  List<AddressVersion> history() { return new ArrayList<>(versions); }\n}"
          }
        ],
        "pros": [
          "Answers 'what did this look like on date X?'",
          "Old orders can point at the exact version they used",
          "No data is overwritten"
        ],
        "cons": [
          "Every read must select the current version",
          "More storage and more complex updates",
          "Foreign keys must reference a version, or a stable id plus a time"
        ],
        "pickWhen": "Past values matter to other records, as with prices, addresses on orders and contract terms."
      },
      {
        "name": "Append-only event log",
        "concept": "Event sourcing with snapshots (Memento)",
        "conceptIds": [
          "memento",
          "command"
        ],
        "how": "Store each change as an immutable event and derive current state by replaying them. History, undo and audit are all the same data. A snapshot (a memento) every N events keeps replay fast.",
        "code": [
          {
            "file": "EventLog.java",
            "body": "import java.util.ArrayList;\nimport java.util.List;\n\ninterface AddressEvent {\n  AddressState applyTo(AddressState state);\n}\n\nclass AddressState {\n  final String line;\n  final boolean deleted;\n\n  AddressState(String line, boolean deleted) {\n    this.line = line;\n    this.deleted = deleted;\n  }\n}\n\nclass AddressChanged implements AddressEvent {\n  private final String line;\n\n  AddressChanged(String line) { this.line = line; }\n\n  public AddressState applyTo(AddressState state) { return new AddressState(line, state.deleted); }\n}\n\nclass AddressDeleted implements AddressEvent {\n  public AddressState applyTo(AddressState state) { return new AddressState(state.line, true); }\n}\n\nclass AddressEventLog {\n  private final List<AddressEvent> events = new ArrayList<>();     // append-only\n\n  void append(AddressEvent event) { events.add(event); }\n\n  // Current state, or any past state by replaying fewer events.\n  AddressState replay(int upTo) {\n    AddressState state = new AddressState(null, false);\n    for (int i = 0; i < upTo && i < events.size(); i++) {\n      state = events.get(i).applyTo(state);\n    }\n    return state;\n  }\n}"
          }
        ],
        "pros": [
          "A complete history of what happened and in what order",
          "Any past state can be rebuilt",
          "A natural fit for audit and undo"
        ],
        "cons": [
          "The hardest to build and to query: you need projections for current state",
          "Evolving the schema of old events is painful",
          "Erasing personal data from an immutable log needs a plan"
        ],
        "pickWhen": "The sequence of changes is itself the business record, such as ledgers, orders and compliance trails."
      }
    ],
    "recommendation": "Match the mechanism to the question being asked. Restore only: soft delete. What did it look like then: versioned rows. Who did what and when, in order: an event log. Hard delete when nothing references it and erasure is required.\n\nWhichever you choose, hide it behind a repository so callers never write the filter themselves.",
    "say": "Deleting is a product decision. If support just needs undo, I'd use a deleted-at flag and make the repository filter it everywhere. If old orders must keep the address they used, I'd version the rows. A full event log is only worth it when the sequence of changes is itself the record.",
    "appearsIn": [
      "file-storage-system",
      "stack-overflow",
      "social-network",
      "online-bookstore",
      "digital-wallet"
    ],
    "related": [
      "memento",
      "command",
      "add-undo-redo",
      "encapsulation"
    ]
  },
  {
    "id": "overlapping-time-intervals",
    "prompt": "Design the booking check for a meeting room. Given the existing bookings, how do you decide whether a new request overlaps, and how do you stop two people booking the same slot?",
    "context": "A room has up to a few hundred bookings a day. Times arrive as start and end timestamps. Two users can click Book on the same slot within milliseconds, and the system runs on more than one server.\n\nThe interviewer cares about three things: the correct overlap condition, how fast the check is, and what actually prevents double booking.",
    "whyHard": "The overlap condition is a classic off-by-one trap: do 10:00 to 11:00 and 11:00 to 12:00 conflict? The check also is not enough on its own. Two requests can both pass the check and both insert, so *check-then-insert* is a race, not a design.",
    "options": [
      {
        "name": "Linear scan",
        "concept": "Pairwise overlap test on half-open intervals",
        "conceptIds": [
          "kiss"
        ],
        "how": "Treat intervals as half-open `[start, end)`. Two intervals overlap exactly when each starts before the other ends. Scan the list and reject on the first conflict. Guard the list with a lock so the check and the insert happen together.",
        "code": [
          {
            "file": "RoomCalendar.java",
            "body": "import java.util.ArrayList;\nimport java.util.List;\n\nclass Interval {\n  final long start;\n  final long end;                          // half-open: [start, end)\n\n  Interval(long start, long end) {\n    if (start >= end) throw new IllegalArgumentException(\"empty interval\");\n    this.start = start;\n    this.end = end;\n  }\n\n  boolean overlaps(Interval other) {\n    return start < other.end && other.start < end;\n  }\n}\n\nclass RoomCalendar {\n  private final List<Interval> booked = new ArrayList<>();\n\n  synchronized boolean book(Interval wanted) {\n    for (Interval existing : booked) {\n      if (existing.overlaps(wanted)) return false;\n    }\n    booked.add(wanted);\n    return true;\n  }\n}"
          }
        ],
        "pros": [
          "Easy to get right and to explain",
          "The half-open condition handles back-to-back meetings",
          "Plenty fast for hundreds of bookings"
        ],
        "cons": [
          "O(n) per booking",
          "The lock is per process, so it does nothing across servers",
          "Does not scale to millions of bookings"
        ],
        "pickWhen": "Small calendars in a single process. The right first answer in an interview."
      },
      {
        "name": "Sorted map neighbours",
        "concept": "Sorted map neighbour check (TreeMap floor and ceiling)",
        "conceptIds": [],
        "how": "Keep non-overlapping bookings sorted by start. A new interval can only conflict with its nearest neighbours: the booking that starts at or before it, and the one that starts after it. Two lookups decide the answer.",
        "code": [
          {
            "file": "RoomCalendar.java",
            "body": "import java.util.Map;\nimport java.util.TreeMap;\n\nclass RoomCalendar {\n  // start -> end of non-overlapping bookings, half-open [start, end)\n  private final TreeMap<Long, Long> startToEnd = new TreeMap<>();\n\n  synchronized boolean book(long start, long end) {\n    if (start >= end) throw new IllegalArgumentException(\"empty interval\");\n\n    Map.Entry<Long, Long> before = startToEnd.floorEntry(start);\n    if (before != null && before.getValue() > start) return false;    // earlier booking runs into ours\n\n    Map.Entry<Long, Long> after = startToEnd.ceilingEntry(start);\n    if (after != null && after.getKey() < end) return false;           // later booking starts inside ours\n\n    startToEnd.put(start, end);\n    return true;\n  }\n}"
          }
        ],
        "pros": [
          "O(log n) check and insert",
          "Tiny code once you see the neighbour argument",
          "Easy to extend to 'find the next free gap'"
        ],
        "cons": [
          "Only correct if the stored bookings never overlap",
          "Still single-process: needs a lock, and the data lives in memory",
          "Harder to explain than a loop"
        ],
        "pickWhen": "A large number of bookings per room in memory, or you need next-free-slot queries."
      },
      {
        "name": "Database exclusion constraint",
        "concept": "Let the database enforce it",
        "conceptIds": [
          "database-locking",
          "optimistic-vs-pessimistic-locking"
        ],
        "how": "Let the database refuse overlaps. In PostgreSQL an exclusion constraint on `(room_id, time range)` rejects any insert whose range overlaps an existing one for the same room. The application just inserts and handles the violation.",
        "code": [
          {
            "file": "booking.sql",
            "body": "-- PostgreSQL: let the database reject overlaps, even across many app servers.\nCREATE EXTENSION IF NOT EXISTS btree_gist;\n\nCREATE TABLE booking (\n  id        BIGSERIAL PRIMARY KEY,\n  room_id   BIGINT      NOT NULL,\n  starts_at TIMESTAMPTZ NOT NULL,\n  ends_at   TIMESTAMPTZ NOT NULL,\n  CHECK (starts_at < ends_at),\n  EXCLUDE USING gist (\n    room_id WITH =,\n    tstzrange(starts_at, ends_at) WITH &&      -- ranges are half-open [starts_at, ends_at)\n  )\n);\n\n-- INSERT either succeeds or fails with an exclusion violation (SQLSTATE 23P01).\nINSERT INTO booking (room_id, starts_at, ends_at)\nVALUES (42, '2026-11-02 10:00+00', '2026-11-02 11:00+00');"
          }
        ],
        "pros": [
          "Correct across any number of servers",
          "No check-then-insert race: the database enforces it",
          "Less application code"
        ],
        "cons": [
          "Database-specific (PostgreSQL ranges and `btree_gist`)",
          "Violations arrive as exceptions you must turn into friendly errors",
          "Holds with expiry still need a design of their own"
        ],
        "pickWhen": "Bookings are persisted and several servers write them. The production answer."
      },
      {
        "name": "Fixed slots as keys",
        "concept": "Slot bucketing with atomic set-if-absent",
        "conceptIds": [
          "atomic-operations-cas"
        ],
        "how": "Snap time to a grid, for example 30 minutes, and treat each `(room, slot)` as a key. Claiming a booking means claiming every slot with `putIfAbsent` and releasing what you took if one is already claimed.",
        "code": [
          {
            "file": "SlotCalendar.java",
            "body": "import java.util.ArrayList;\nimport java.util.List;\nimport java.util.concurrent.ConcurrentHashMap;\nimport java.util.concurrent.ConcurrentMap;\n\nclass SlotCalendar {\n  // One entry per (room, 30-minute slot). The key is the lock.\n  private final ConcurrentMap<String, String> slots = new ConcurrentHashMap<>();\n\n  boolean book(String room, int fromSlot, int toSlot, String bookingId) {\n    List<String> taken = new ArrayList<>();\n    for (int s = fromSlot; s < toSlot; s++) {\n      String key = room + \":\" + s;\n      if (slots.putIfAbsent(key, bookingId) != null) {\n        taken.forEach(k -> slots.remove(k, bookingId));      // roll back what we claimed\n        return false;\n      }\n      taken.add(key);\n    }\n    return true;\n  }\n}"
          }
        ],
        "pros": [
          "Turns an interval problem into simple key claims",
          "Works with any store that has an atomic set-if-absent, such as Redis `SET NX` or a unique index",
          "Very easy to display and to reason about"
        ],
        "cons": [
          "Only works for fixed-size slots",
          "Multi-slot claims need rollback, and others may briefly see a partial claim",
          "Storage grows with slots, not bookings"
        ],
        "pickWhen": "Time is naturally discrete (appointments, lecture slots) and you want a key-value store to be the lock."
      }
    ],
    "recommendation": "Say the half-open overlap condition first, then give the simple scan. Then point out that the check alone is not enough: with more than one server, correctness has to come from the database (an exclusion constraint or a unique key per slot), not from an in-memory lock.\n\nA sorted map is the best in-memory answer if the interviewer pushes on performance.",
    "say": "I'd define intervals as half-open so back-to-back meetings are fine, and two intervals overlap when each starts before the other ends. A scan does for a small calendar. But check-then-insert is a race across servers, so the real guarantee has to come from the database, with an exclusion constraint or a unique slot key.",
    "appearsIn": [
      "hotel-management-system",
      "car-rental-system",
      "concert-ticket-booking",
      "airline-management-system",
      "course-registration-system"
    ],
    "related": [
      "double-booking-same-slot",
      "race-conditions",
      "database-locking",
      "atomic-operations-cas"
    ]
  },
  {
    "id": "unique-id-generation",
    "prompt": "Every order, ticket and booking needs a unique id. How do you generate it?",
    "context": "Today the app uses an auto-increment column. The team is about to run three application servers and expose ids in URLs, and support wants a short code that customers can read over the phone.\n\nThe interviewer is checking whether you know that 'unique' has costs: coordination, ordering, size and guessability.",
    "whyHard": "Ids pull in different directions. Sequential ids are compact and index-friendly but need coordination and leak how many orders you have. Random ids need no coordination but scatter writes across an index. And an id a human must read aloud has different rules again.",
    "options": [
      {
        "name": "UUID",
        "concept": "UUID v4 (random 128-bit)",
        "conceptIds": [],
        "how": "Generate a random 128-bit id on any machine with no coordination. Collisions are so unlikely that you do not check for them.",
        "code": [
          {
            "file": "OrderIds.java",
            "body": "import java.util.UUID;\n\nclass OrderIds {\n  static String next() {\n    return UUID.randomUUID().toString();     // 128 random bits, no coordination needed\n  }\n}"
          }
        ],
        "pros": [
          "No coordination between servers",
          "Safe to expose: not guessable or enumerable",
          "One line of code"
        ],
        "cons": [
          "Large: 16 bytes, 36 characters as text",
          "Random order scatters inserts across a B-tree index",
          "Unreadable for humans"
        ],
        "pickWhen": "Many writers, no shared database sequence, and nobody needs ordering or short codes."
      },
      {
        "name": "Counter or sequence",
        "concept": "Database sequence or atomic counter",
        "conceptIds": [
          "atomic-operations-cas"
        ],
        "how": "Let one authority hand out the next number: a database sequence, or an `AtomicLong` inside one process. The ids are ordered and compact.",
        "code": [
          {
            "file": "CounterIds.java",
            "body": "import java.util.concurrent.atomic.AtomicLong;\n\nclass CounterIds {\n  private final AtomicLong counter = new AtomicLong();\n\n  long next() {\n    return counter.incrementAndGet();        // unique and ordered, but only inside one process\n  }\n}"
          }
        ],
        "pros": [
          "Small, ordered and index-friendly",
          "Trivially unique within the authority",
          "Easy to debug"
        ],
        "cons": [
          "One authority is a bottleneck and a single point of failure",
          "An in-process counter breaks with a second server or a restart",
          "Ids are guessable and leak volume"
        ],
        "pickWhen": "A single database owns the ids, or the system is single-node."
      },
      {
        "name": "Snowflake-style id",
        "concept": "Timestamp + node id + sequence packed into 64 bits",
        "conceptIds": [],
        "how": "Pack a timestamp, a node id and a per-millisecond sequence into 64 bits. Each node generates ids on its own, and the ids are roughly time-ordered across nodes.",
        "code": [
          {
            "file": "SnowflakeIdGenerator.java",
            "body": "class SnowflakeIdGenerator {\n  private static final long EPOCH = 1_700_000_000_000L;     // custom epoch in millis\n  private static final int NODE_BITS = 10;\n  private static final int SEQ_BITS = 12;\n  private static final long MAX_SEQ = (1L << SEQ_BITS) - 1;\n\n  private final long nodeId;\n  private long lastTs = -1;\n  private long seq = 0;\n\n  SnowflakeIdGenerator(long nodeId) {\n    if (nodeId < 0 || nodeId >= (1L << NODE_BITS)) {\n      throw new IllegalArgumentException(\"node id out of range\");\n    }\n    this.nodeId = nodeId;\n  }\n\n  // layout: [ timestamp | node | sequence ]\n  synchronized long next() {\n    long now = System.currentTimeMillis();\n    if (now < lastTs) throw new IllegalStateException(\"clock moved backwards\");\n\n    if (now == lastTs) {\n      seq = (seq + 1) & MAX_SEQ;\n      if (seq == 0) {                                        // 4096 ids in this ms: wait for the next one\n        while ((now = System.currentTimeMillis()) <= lastTs) { }\n      }\n    } else {\n      seq = 0;\n    }\n    lastTs = now;\n    return ((now - EPOCH) << (NODE_BITS + SEQ_BITS)) | (nodeId << SEQ_BITS) | seq;\n  }\n}"
          }
        ],
        "pros": [
          "No coordination at generation time",
          "Time-ordered and fits in a `long`, so it is good for indexes",
          "Thousands of ids per millisecond per node"
        ],
        "cons": [
          "Node ids must be assigned uniquely somehow",
          "Depends on the clock: it must refuse or wait when the clock moves backwards",
          "More code to get right than the alternatives"
        ],
        "pickWhen": "High volume across many nodes, where you want sortable 64-bit ids."
      },
      {
        "name": "Short human-friendly code",
        "concept": "Random short code with a uniqueness check",
        "conceptIds": [],
        "how": "Generate a short random code from an alphabet that avoids look-alike characters (no `0` and `O`, no `1`, `I` or `L`), and rely on a unique index to catch the rare collision, retrying when it happens.",
        "code": [
          {
            "file": "BookingCodes.java",
            "body": "import java.security.SecureRandom;\nimport java.util.Set;\nimport java.util.concurrent.ConcurrentHashMap;\n\nclass BookingCodes {\n  // No I, L, O, 0 or 1: easy to read out over the phone.\n  private static final char[] ALPHABET = \"ABCDEFGHJKMNPQRSTUVWXYZ23456789\".toCharArray();\n\n  private final SecureRandom random = new SecureRandom();\n  private final Set<String> used = ConcurrentHashMap.newKeySet();   // a unique index in a real database\n\n  String next() {\n    while (true) {\n      StringBuilder code = new StringBuilder(6);\n      for (int i = 0; i < 6; i++) {\n        code.append(ALPHABET[random.nextInt(ALPHABET.length)]);\n      }\n      if (used.add(code.toString())) return code.toString();         // retry on the rare collision\n    }\n  }\n}"
          }
        ],
        "pros": [
          "Readable, dictation-friendly booking references",
          "Leaks no ordering information",
          "Simple, with the database as the arbiter"
        ],
        "cons": [
          "Needs a uniqueness check and a retry path",
          "Six characters from this 31-letter alphabet is only about 890 million codes, so length must grow with volume",
          "Not suitable as the only primary key"
        ],
        "pickWhen": "Customers must type or say the code. Keep it as a *second* id next to a normal primary key."
      }
    ],
    "recommendation": "Separate the internal id from the public reference. Use a database sequence or a snowflake id as the primary key, and add a short random code or an opaque UUID for anything customers see. Start with the simple sequence and move to snowflake or UUID when there are multiple writers.\n\nAlways state the trade-off you are accepting: ordering, size, coordination or guessability.",
    "say": "I'd ask what the id is for. As a primary key I want something compact and ordered, so a database sequence at first, or a snowflake id once there are many writers. For what customers see, I'd add a separate short random code with a unique index, so the primary key never leaks the order count.",
    "appearsIn": [
      "parking-lot",
      "movie-ticket-booking",
      "online-bookstore",
      "online-food-delivery",
      "file-storage-system"
    ],
    "related": [
      "atomic-operations-cas",
      "idempotency",
      "duplicate-charge-on-retry"
    ]
  },
  {
    "id": "money-and-precision",
    "prompt": "Calculate an order total with tax and a discount. Why not use `double`, and how would you model money?",
    "context": "Prices are shown to two decimals, tax is 8.25%, and the bill is split between three people. The first version used `double` everywhere, and finance reported totals that were off by a cent.\n\nThe interviewer is looking for three things: why floating point fails, where rounding happens, and whether you treat money as a type rather than a bare number.",
    "whyHard": "The bug is invisible until the numbers get big or the operations pile up. `0.1` has no exact binary representation, so errors accumulate silently.\n\nAnd even with exact arithmetic you must decide *when* to round and which way, how to split 10.00 three ways without losing a cent, and what to do when currencies differ.",
    "options": [
      {
        "name": "double",
        "concept": "Binary floating point (the trap)",
        "conceptIds": [],
        "how": "Use `double` and round at the end. This is the version that goes wrong: adding ten 10-cent items does not give exactly 1.00.",
        "code": [
          {
            "file": "DoubleMoney.java",
            "body": "class DoubleMoney {\n  public static void main(String[] args) {\n    double total = 0.0;\n    for (int i = 0; i < 10; i++) {\n      total += 0.10;                         // ten 10-cent items\n    }\n    System.out.println(total == 1.0);        // false\n    System.out.println(total);               // 0.9999999999999999\n  }\n}"
          }
        ],
        "pros": [
          "Fast and convenient",
          "Fine for approximate maths such as analytics or distances"
        ],
        "cons": [
          "Cannot represent most decimal fractions exactly, so errors accumulate",
          "Equality checks fail",
          "Rounding behaviour is easy to get subtly wrong"
        ],
        "pickWhen": "Never for money. Fine for estimates and statistics."
      },
      {
        "name": "BigDecimal",
        "concept": "BigDecimal with explicit scale and rounding mode",
        "conceptIds": [],
        "how": "`BigDecimal` is exact for decimal values. Construct it from a string, never from a `double`, and apply a rounding mode explicitly at each point where rounding is a business rule, for example tax per line item.",
        "code": [
          {
            "file": "Pricing.java",
            "body": "import java.math.BigDecimal;\nimport java.math.RoundingMode;\n\nclass Pricing {\n  static BigDecimal total(BigDecimal unitPrice, int qty, BigDecimal taxRate) {\n    BigDecimal subtotal = unitPrice.multiply(BigDecimal.valueOf(qty));\n    BigDecimal tax = subtotal.multiply(taxRate).setScale(2, RoundingMode.HALF_UP);\n    return subtotal.add(tax).setScale(2, RoundingMode.HALF_UP);\n  }\n}\n// total(new BigDecimal(\"19.99\"), 3, new BigDecimal(\"0.0825\")) -> 64.92"
          }
        ],
        "pros": [
          "Exact decimal arithmetic",
          "The rounding mode is explicit and reviewable",
          "Arbitrary size, so no overflow"
        ],
        "cons": [
          "Verbose and slower than primitives",
          "Easy to forget `setScale`, or to use `equals` where `compareTo` is needed (`2.0` is not `equals` to `2.00`)",
          "Still just a number: nothing stops you adding USD to EUR"
        ],
        "pickWhen": "Most Java business code, especially when intermediate values have more than two decimals."
      },
      {
        "name": "Integer minor units",
        "concept": "Whole numbers of the smallest unit (cents)",
        "conceptIds": [],
        "how": "Store money as a whole number of the smallest unit: 1999 means 19.99. Addition is exact, comparison is plain, and databases store it as a `BIGINT`. Do percentage maths with integers and round deliberately.",
        "code": [
          {
            "file": "Cart.java",
            "body": "class Cart {\n  private long totalCents;\n\n  void addItem(long priceCents, int qty) {\n    totalCents = Math.addExact(totalCents, Math.multiplyExact(priceCents, qty));   // overflow throws\n  }\n\n  // tax in basis points: 825 = 8.25%. Integer maths, rounds half up.\n  long totalWithTaxCents(int taxBasisPoints) {\n    long tax = Math.floorDiv(totalCents * taxBasisPoints + 5_000, 10_000);\n    return totalCents + tax;\n  }\n}"
          }
        ],
        "pros": [
          "Exact, fast and simple to store",
          "No hidden scale bugs",
          "Overflow can be detected with `Math.addExact`"
        ],
        "cons": [
          "Callers must remember the unit: is this cents or dollars?",
          "Currencies have different minor units (JPY has none)",
          "Percentages and splits still need a rounding rule"
        ],
        "pickWhen": "Storage and APIs, where the currency and its minor unit are clear."
      },
      {
        "name": "Money value object",
        "concept": "Immutable value object (encapsulation)",
        "conceptIds": [
          "encapsulation",
          "classes-objects"
        ],
        "how": "Wrap the amount and its currency in an immutable `Money` class. All arithmetic and rounding live in one place, adding different currencies is impossible, and `split` is written once so no cent is lost or invented.",
        "code": [
          {
            "file": "Money.java",
            "body": "import java.math.BigDecimal;\nimport java.math.RoundingMode;\nimport java.util.ArrayList;\nimport java.util.Currency;\nimport java.util.List;\nimport java.util.Objects;\n\nfinal class Money {\n  private final long minor;                  // 1050 means 10.50 for USD\n  private final Currency currency;\n\n  Money(long minor, Currency currency) {\n    this.minor = minor;\n    this.currency = Objects.requireNonNull(currency);\n  }\n\n  static Money of(String amount, Currency currency) {\n    BigDecimal scaled = new BigDecimal(amount)\n        .setScale(currency.getDefaultFractionDigits(), RoundingMode.HALF_EVEN);\n    return new Money(scaled.unscaledValue().longValueExact(), currency);\n  }\n\n  Money plus(Money other) {\n    requireSameCurrency(other);\n    return new Money(Math.addExact(minor, other.minor), currency);\n  }\n\n  Money times(BigDecimal factor) {\n    long result = BigDecimal.valueOf(minor).multiply(factor)\n        .setScale(0, RoundingMode.HALF_EVEN).longValueExact();\n    return new Money(result, currency);\n  }\n\n  // Split without losing or inventing a cent: 10.00 / 3 -> 3.34, 3.33, 3.33\n  List<Money> split(int parts) {\n    long base = minor / parts;\n    long remainder = minor % parts;\n    List<Money> out = new ArrayList<>();\n    for (int i = 0; i < parts; i++) {\n      out.add(new Money(base + (i < remainder ? 1 : 0), currency));\n    }\n    return out;\n  }\n\n  private void requireSameCurrency(Money other) {\n    if (!currency.equals(other.currency)) {\n      throw new IllegalArgumentException(\"Currency mismatch: \" + currency + \" vs \" + other.currency);\n    }\n  }\n\n  @Override public boolean equals(Object o) {\n    return o instanceof Money && ((Money) o).minor == minor && ((Money) o).currency.equals(currency);\n  }\n\n  @Override public int hashCode() { return Objects.hash(minor, currency); }\n\n  @Override public String toString() {\n    return BigDecimal.valueOf(minor, currency.getDefaultFractionDigits()).toPlainString()\n        + \" \" + currency.getCurrencyCode();\n  }\n}"
          }
        ],
        "pros": [
          "The compiler stops you mixing currencies or units",
          "Rounding and splitting rules live in one place",
          "Self-documenting APIs: `charge(Money)` rather than `charge(long)`"
        ],
        "cons": [
          "More code up front",
          "Mapping to and from the database and JSON needs care",
          "Over-engineering for a toy exercise"
        ],
        "pickWhen": "Anything that handles real money, or whenever more than one currency or a split is involved."
      }
    ],
    "recommendation": "Never `double`. Model a `Money` type that holds minor units and a currency, do arithmetic with exact integer or `BigDecimal` operations, and write the rounding rule once (half-even is the common banker's choice). Implement `split` so the parts always add back to the whole, with the extra cents going to the first parts.\n\nIn the interview, show the ten 10-cent items failure in one line, then the `Money` type.",
    "say": "Floating point can't represent most decimal fractions, so I'd never use double for money. I'd make a Money value object with an amount in minor units and a currency, so rounding and splitting live in one place and you can't add dollars to euros. Splitting ten dollars three ways gives 3.34, 3.33 and 3.33, so no cent disappears.",
    "appearsIn": [
      "digital-wallet",
      "splitwise",
      "shopping-cart-system",
      "online-bookstore",
      "amazon"
    ],
    "related": [
      "encapsulation",
      "add-new-pricing-rule",
      "duplicate-charge-on-retry"
    ]
  }
);
