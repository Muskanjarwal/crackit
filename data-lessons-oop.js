window.LESSONS = window.LESSONS || [];
window.LESSONS.push(
  {
    id: "classes-objects",
    name: "Classes & Objects",
    summary: "A **class** is a blueprint that describes the state and behaviour of a kind of thing; an **object** is one concrete instance of that blueprint, with its own state and identity. Every LLD answer starts by deciding which classes exist and what each one is responsible for.",
    sections: [
      {
        heading: "Class vs object",
        text: "A class defines fields (state) and methods (behaviour). An object is created from the class with `new` and holds its own copy of the fields. Two objects of the same class share behaviour but not state.\n\nThink of `Car` as the blueprint and the red Honda in your driveway as an object.",
        code: [
          { file: "Car.java", body: `public class Car {
  private final String plate;
  private int speed;

  public Car(String plate) {
    this.plate = plate;
    this.speed = 0;
  }

  public void accelerate(int delta) { speed += delta; }
  public int speed() { return speed; }
}` },
          { file: "Main.java", body: `Car a = new Car("KA-01-1234");
Car b = new Car("MH-12-9999");
a.accelerate(30);

System.out.println(a.speed()); // 30
System.out.println(b.speed()); // 0, separate state` }
        ]
      },
      {
        heading: "State, behaviour and identity",
        text: "Every object has three things: **state** (the current field values), **behaviour** (what it can do) and **identity** (it is distinct from every other object, even one with equal state).\n\nThis matters when you choose between `==` and `equals`. Two `Money(100, USD)` values are equal by value; two `Account` objects with the same balance are still different accounts.",
        bullets: [
          "Entities have identity (Account, Order, User). Compare by id.",
          "Value objects are defined by their values (Money, Address). Make them immutable and compare by value."
        ]
      },
      {
        heading: "Constructors and object lifecycle",
        text: "A constructor's job is to leave the object in a valid state. If an object can exist half-initialised, every method has to defend against that.\n\nPrefer passing required data into the constructor over a no-arg constructor plus setters.",
        code: [
          { file: "Bad.java", body: `// Can exist in an invalid state
Order order = new Order();
order.setCustomer(customer);   // easy to forget
order.process();               // NullPointerException if items not set` },
          { file: "Good.java", body: `public class Order {
  private final Customer customer;
  private final List<Item> items;

  public Order(Customer customer, List<Item> items) {
    if (items.isEmpty()) throw new IllegalArgumentException("empty order");
    this.customer = customer;
    this.items = List.copyOf(items);
  }
}` }
        ]
      },
      {
        heading: "Static vs instance members",
        text: "Instance members belong to each object. `static` members belong to the class itself and are shared by all instances.\n\nUse static for stateless utilities and constants. Mutable static state is global state in disguise: it hurts testing and breaks under concurrency.",
        code: [
          { file: "Counter.java", body: `class Ticket {
  private static int nextId = 1;      // shared across all tickets, not thread-safe
  private final int id;

  Ticket() { this.id = nextId++; }
}` }
        ],
        note: "In an interview, replace a static counter with an injected `IdGenerator` so it can be tested and made thread-safe."
      },
      {
        heading: "Finding the classes in an LLD problem",
        text: "A reliable starting heuristic is to underline the **nouns** in the requirements: those are candidate classes. Verbs become methods. Then ask of each noun: does it have its own state or rules? If not, it is probably just a field.\n\nFor a parking lot: `ParkingLot`, `Floor`, `Spot`, `Vehicle`, `Ticket` are classes. 'Fee' is better as a method result or a value object than a class with identity."
      }
    ],
    takeaways: [
      "A class is a blueprint; an object is an instance with its own state and identity.",
      "Constructors should produce valid objects. Avoid half-built objects.",
      "Distinguish entities (identity) from value objects (equality by value).",
      "Nouns in the requirements suggest classes; verbs suggest methods."
    ],
    pitfalls: [
      "Creating a class per noun without checking it has behaviour (anemic classes that only hold data).",
      "Public mutable fields instead of controlled access.",
      "Overusing static state for convenience.",
      "God classes that hold every responsibility of the system."
    ],
    interviewQs: [
      { q: "What is the difference between a class and an object?", a: "A class is a compile-time blueprint that declares fields and methods. An object is a runtime instance created from it, occupying memory and holding its own field values. Many objects can come from one class." },
      { q: "What is the difference between an entity and a value object?", a: "An entity is identified by an id and can change over time while remaining the same thing (a User). A value object is identified purely by its values, is usually immutable and interchangeable (Money, DateRange)." },
      { q: "Why might `==` and `equals` give different results?", a: "`==` compares references, i.e. whether two variables point to the same object. `equals` compares logical equality as defined by the class. Two distinct `String` objects with the same characters are `equals` but not `==`." },
      { q: "When would you use a static method?", a: "For behaviour that does not depend on instance state, such as pure helpers (`Math.max`) or factory methods. Avoid static methods that touch shared mutable state." }
    ],
    related: ["encapsulation", "interfaces", "srp"]
  },

  {
    id: "interfaces",
    name: "Interfaces",
    summary: "An **interface** is a contract: it declares *what* a type can do without saying *how*. Code that depends on an interface can work with any implementation, which is the foundation of loose coupling and most design patterns.",
    sections: [
      {
        heading: "What an interface gives you",
        text: "An interface lists method signatures that implementing classes must provide. Callers hold a reference to the interface type and never see the concrete class.",
        code: [
          { file: "Notifier.java", body: `public interface Notifier {
  void send(String userId, String message);
}` },
          { file: "EmailNotifier.java", body: `public class EmailNotifier implements Notifier {
  public void send(String userId, String message) {
    // call SMTP provider
  }
}` },
          { file: "SmsNotifier.java", body: `public class SmsNotifier implements Notifier {
  public void send(String userId, String message) {
    // call SMS gateway
  }
}` }
        ]
      },
      {
        heading: "Why depend on the interface",
        text: "Compare a service wired directly to a concrete class with one that takes the interface.",
        code: [
          { file: "Bad.java", body: `class OrderService {
  private final EmailNotifier notifier = new EmailNotifier(); // hard-wired

  void place(Order o) {
    // ...
    notifier.send(o.userId(), "Order placed");
  }
}
// Switching to SMS means editing OrderService. Testing means sending real emails.` },
          { file: "Good.java", body: `class OrderService {
  private final Notifier notifier;

  OrderService(Notifier notifier) { this.notifier = notifier; }

  void place(Order o) {
    // ...
    notifier.send(o.userId(), "Order placed");
  }
}
// Pass EmailNotifier in production and a fake in tests.` }
        ],
        note: "This is the seed of Dependency Inversion (DIP) and the Strategy pattern."
      },
      {
        heading: "Interface vs abstract class",
        text: "Both let you define a type with unimplemented methods. The practical difference is state and inheritance.",
        bullets: [
          "A class can implement many interfaces but extend only one class.",
          "Interfaces describe a capability (`Comparable`, `Runnable`). Abstract classes describe a family with shared state or code.",
          "Default methods let interfaces ship behaviour, but still cannot hold instance fields.",
          "Start with an interface. Add an abstract base class only when implementations really share state."
        ]
      },
      {
        heading: "Designing good interfaces",
        text: "An interface is a promise you will keep for every implementation, so keep it small and focused. A wide interface forces implementers to write methods they cannot support, which tends to end in `UnsupportedOperationException`.\n\nName interfaces by role or capability (`PaymentGateway`, `Cache`, `Clock`), not with an `I` prefix or an `Impl` suffix on the class."
      },
      {
        heading: "Interfaces for testing and extension",
        text: "Wrap anything slow, random or external (clock, network, id generation, payment provider) behind an interface. Tests inject deterministic fakes, and adding a new provider becomes adding a class, not editing callers.",
        code: [
          { file: "Clock.java", body: `public interface Clock { Instant now(); }

class SystemClock implements Clock { public Instant now() { return Instant.now(); } }
class FixedClock implements Clock {
  private final Instant t;
  FixedClock(Instant t) { this.t = t; }
  public Instant now() { return t; }
}` }
        ]
      }
    ],
    takeaways: [
      "An interface is a contract describing what, not how.",
      "Depend on interfaces; construct concrete classes at the edges.",
      "Keep interfaces small and role-focused.",
      "Interfaces unlock polymorphism, testing and most behavioural patterns."
    ],
    pitfalls: [
      "Creating an interface for every class with exactly one implementation and no reason to vary.",
      "Fat interfaces that force empty or throwing implementations.",
      "Leaking implementation details (`MySqlUserRepository`) into the interface's name or signature.",
      "Using an abstract class where no shared state exists."
    ],
    interviewQs: [
      { q: "Interface or abstract class: how do you choose?", a: "Default to an interface for a capability or contract. Choose an abstract class when subclasses share fields or substantial implementation, and you want to enforce a template. Since a class can only extend one parent, interfaces keep options open." },
      { q: "Can an interface have implemented methods?", a: "Yes, via `default` and `static` methods since Java 8. They help evolve an interface without breaking implementers, but interfaces still cannot hold instance state." },
      { q: "How do interfaces relate to loose coupling?", a: "Callers know only the contract, so implementations can change or be replaced (mocks, new providers) without touching callers. This is the basis of the Dependency Inversion Principle." },
      { q: "Why is a marker or empty interface sometimes used?", a: "It tags a type with a capability for the runtime or framework to check (`Serializable`). Modern code often prefers annotations, but the idea is the same." }
    ],
    related: ["abstraction", "polymorphism", "dip", "isp", "strategy"]
  },

  {
    id: "inheritance",
    name: "Inheritance",
    summary: "**Inheritance** lets a subclass reuse and specialise the fields and methods of a superclass, modelling an 'is-a' relationship. It is powerful but is the tightest coupling in OOP, so use it only for true substitutable subtypes.",
    sections: [
      {
        heading: "The basics",
        text: "A subclass `extends` a superclass, inherits its non-private members and may override methods. `super` refers to the parent.",
        code: [
          { file: "Account.java", body: `public class Account {
  protected double balance;

  public void deposit(double amount) { balance += amount; }
  public double balance() { return balance; }
}` },
          { file: "SavingsAccount.java", body: `public class SavingsAccount extends Account {
  private final double rate;

  public SavingsAccount(double rate) { this.rate = rate; }

  public void addInterest() { deposit(balance * rate); }
}` }
        ]
      },
      {
        heading: "When 'is-a' really holds",
        text: "Inheritance is justified when every instance of the subclass can be used wherever the parent is expected, with no surprises. This is the Liskov Substitution Principle in practice.\n\nA `SavingsAccount` is an `Account`. A `Stack` is not a `Vector`, even if it reuses its storage: callers could insert in the middle and break stack semantics.",
        code: [
          { file: "Bad.java", body: `// Reusing code, but not a true is-a
class Stack<T> extends ArrayList<T> {
  void push(T x) { add(x); }
  T pop() { return remove(size() - 1); }
}
stack.add(0, x);   // allowed! breaks LIFO guarantee` },
          { file: "Good.java", body: `class Stack<T> {
  private final List<T> items = new ArrayList<>();
  void push(T x) { items.add(x); }
  T pop() { return items.remove(items.size() - 1); }
}` }
        ]
      },
      {
        heading: "The fragile base class problem",
        text: "A subclass depends on how the parent works internally, not just on its public contract. When the parent changes, subclasses can break without any compile error.",
        code: [
          { file: "Fragile.java", body: `class Counter {
  int count;
  void add(int x) { count += x; }
  void addAll(int[] xs) { for (int x : xs) add(x); }  // calls add()
}

class LoggingCounter extends Counter {
  @Override void add(int x) { count++; super.add(x); } // double counts via addAll
}` }
        ],
        note: "If the parent later changes `addAll` to not call `add`, behaviour changes silently. Document or prevent overriding with `final` where it matters."
      },
      {
        heading: "Deep hierarchies and the diamond",
        text: "Every extra level adds coupling and makes behaviour harder to trace. Adding new dimensions (flying, swimming, colours) multiplies subclasses: `FlyingSwimmingDuck`, `RubberDuck`, and so on.\n\nJava avoids the diamond problem for classes by allowing single inheritance only. Interfaces with default methods can still conflict, and the implementing class must resolve it explicitly.",
        bullets: [
          "Keep hierarchies shallow, ideally two or three levels.",
          "Prefer composition when behaviour varies along several axes (see Composition).",
          "Mark classes `final` unless designed for extension."
        ]
      },
      {
        heading: "Inheritance vs composition at a glance",
        text: "Inheritance reuses by **being**; composition reuses by **having**. Use inheritance for a stable taxonomy with real substitutability, and composition and interfaces for everything else. The Strategy and Decorator patterns exist largely to avoid inheritance explosions."
      }
    ],
    takeaways: [
      "Inheritance models 'is-a' and reuses implementation.",
      "Only inherit when the subclass is fully substitutable (LSP).",
      "It creates the tightest coupling; expect fragile base class problems.",
      "Prefer composition for varying behaviour."
    ],
    pitfalls: [
      "Inheriting purely to reuse code, such as `Stack extends ArrayList`.",
      "Overriding methods whose parent contract is not documented.",
      "Subclasses that throw `UnsupportedOperationException` for inherited methods.",
      "Deep hierarchies that double with each new feature."
    ],
    interviewQs: [
      { q: "What is the fragile base class problem?", a: "Subclasses rely on the parent's internal behaviour, such as which methods it calls. A harmless-looking change in the parent then breaks subclasses. It is a main reason to prefer composition or make classes final." },
      { q: "Why does Java not allow multiple inheritance of classes?", a: "To avoid ambiguity in the diamond problem, where two parents provide the same member. Java allows multiple interface implementation, and requires explicit resolution if default methods clash." },
      { q: "What is the difference between overriding and overloading?", a: "Overriding replaces a parent's method with the same signature in a subclass and is resolved at runtime. Overloading defines methods with the same name but different parameters and is resolved at compile time." },
      { q: "When is inheritance the right choice?", a: "When there is a genuine is-a relationship, subclasses are substitutable for the parent, and they share substantial implementation or state that would be awkward to compose." }
    ],
    related: ["polymorphism", "composition", "lsp", "template-method"]
  },

  {
    id: "polymorphism",
    name: "Polymorphism",
    summary: "**Polymorphism** means 'many forms': code written against a type works with any subtype, and the right behaviour is chosen at runtime. It is how you replace `if/else` chains on type codes with clean, extensible designs.",
    sections: [
      {
        heading: "Two kinds of polymorphism",
        text: "**Compile-time (static)** polymorphism is method overloading: the compiler picks the method from the argument types. **Runtime (dynamic)** polymorphism is method overriding through a base type or interface: the JVM picks the implementation from the actual object.\n\nIn LLD interviews, 'polymorphism' almost always means the runtime kind.",
        code: [
          { file: "Overload.java", body: `class Printer {
  void print(int x)    { System.out.println("int " + x); }
  void print(String s) { System.out.println("string " + s); }
}
// chosen at compile time from the argument type` },
          { file: "Override.java", body: `interface Shape { double area(); }
class Circle implements Shape { /* ... */ public double area() { return Math.PI * r * r; } }
class Square implements Shape { /* ... */ public double area() { return side * side; } }

Shape s = pick();      // type known only at runtime
s.area();              // correct implementation is called` }
        ]
      },
      {
        heading: "Replacing conditionals with polymorphism",
        text: "A switch over a type code is a signal. Each new type means editing every switch in the codebase. With polymorphism, each type carries its own behaviour and adding a type is adding a class.",
        code: [
          { file: "Bad.java", body: `double fee(Vehicle v) {
  switch (v.type) {
    case BIKE:  return 10;
    case CAR:   return 20;
    case TRUCK: return 50;     // add a type -> edit here and everywhere else
  }
  throw new IllegalStateException();
}` },
          { file: "Good.java", body: `interface Vehicle { double hourlyFee(); }
class Bike  implements Vehicle { public double hourlyFee() { return 10; } }
class Car   implements Vehicle { public double hourlyFee() { return 20; } }
class Truck implements Vehicle { public double hourlyFee() { return 50; } }

double fee(Vehicle v) { return v.hourlyFee(); }` }
        ]
      },
      {
        heading: "How dynamic dispatch works",
        text: "When you call `s.area()`, the compiler checks that `Shape` has `area()`. At runtime the JVM looks at the real class of the object and calls its override (via a virtual method table). Fields and `static` methods are not polymorphic; only instance methods are.",
        note: "Calling an overridable method from a constructor is risky: the subclass override runs before the subclass's fields are initialised."
      },
      {
        heading: "Polymorphism through interfaces and generics",
        text: "Subtype polymorphism works via inheritance and interfaces. Parametric polymorphism (generics) lets one `List<T>` work for any `T`. Both reduce duplication, and design patterns like Strategy, State, Command and Observer rely on subtype polymorphism.",
        code: [
          { file: "Generic.java", body: `static <T extends Comparable<T>> T max(List<T> xs) {
  T best = xs.get(0);
  for (T x : xs) if (x.compareTo(best) > 0) best = x;
  return best;
}` }
        ]
      },
      {
        heading: "Limits",
        text: "Polymorphism fits when behaviour belongs to the type. If an operation spans many types and is unrelated to their core job (exporting to XML), pushing it into each class bloats them. The Visitor pattern or a separate service may be better."
      }
    ],
    takeaways: [
      "Runtime polymorphism picks behaviour from the actual object, not the declared type.",
      "It replaces type-code switches and makes designs open for extension (OCP).",
      "It requires a common supertype, usually an interface.",
      "Overloading is compile-time; overriding is runtime."
    ],
    pitfalls: [
      "Using `instanceof` chains where an override would do.",
      "Overriding with different semantics, which violates LSP.",
      "Calling overridable methods in constructors.",
      "Expecting fields or static methods to be polymorphic."
    ],
    interviewQs: [
      { q: "What is the difference between compile-time and runtime polymorphism?", a: "Compile-time polymorphism is overloading, where the compiler selects a method by argument types. Runtime polymorphism is overriding, where the JVM selects the implementation based on the object's actual class when the call executes." },
      { q: "How does polymorphism support the Open/Closed Principle?", a: "New behaviour is added by writing a new subtype. Existing callers that use the base type need no modification, so the system is open for extension and closed for modification." },
      { q: "Is a static method polymorphic?", a: "No. Static methods are bound to the class at compile time. Declaring a same-named static method in a subclass hides the parent's one rather than overriding it." },
      { q: "Give a real example of replacing a conditional with polymorphism.", a: "Pricing by vehicle type in a parking lot: instead of switching on a type enum, each `Vehicle` implementation or a `PricingStrategy` provides its own rate. Adding a type adds a class and leaves existing code unchanged." }
    ],
    related: ["inheritance", "interfaces", "ocp", "strategy", "state"]
  },

  {
    id: "abstraction",
    name: "Abstraction",
    summary: "**Abstraction** means exposing only the essential operations of something and hiding the details behind them. It lets you reason at the right level (call `pay()`) without caring about the mechanism (which gateway, which protocol).",
    sections: [
      {
        heading: "Abstraction in everyday terms",
        text: "You drive a car using a steering wheel and pedals. You do not manage fuel injection. The pedals are the abstraction; the engine is the hidden detail. In code, abstractions are the public interfaces, abstract classes and method names that let callers ignore how work gets done."
      },
      {
        heading: "Abstraction with interfaces and abstract classes",
        text: "Define the capability once, then hide variations behind it.",
        code: [
          { file: "PaymentGateway.java", body: `public interface PaymentGateway {
  PaymentResult charge(String customerId, Money amount);
}` },
          { file: "Checkout.java", body: `class Checkout {
  private final PaymentGateway gateway;
  Checkout(PaymentGateway gateway) { this.gateway = gateway; }

  Receipt complete(Cart cart) {
    PaymentResult r = gateway.charge(cart.customerId(), cart.total());
    return Receipt.from(cart, r);
  }
}
// Checkout never learns about Stripe, retries, tokens, or HTTP.` }
        ]
      },
      {
        heading: "Choosing the right level",
        text: "A good abstraction hides detail that is likely to change and exposes what callers need. A leaky abstraction forces callers to know internals.",
        code: [
          { file: "Leaky.java", body: `// Caller must know it's SQL and manage connections
interface UserStore {
  Connection getConnection();
  ResultSet runQuery(String sql);
}` },
          { file: "Clean.java", body: `// Caller expresses intent; storage is hidden
interface UserRepository {
  Optional<User> findById(String id);
  void save(User user);
}` }
        ]
      },
      {
        heading: "Abstraction vs encapsulation",
        text: "They are related but not the same. **Abstraction** is a design-level idea: choosing what to expose to simplify usage. **Encapsulation** is the mechanism: bundling data with methods and restricting access so internals cannot be touched. Abstraction decides *what* the interface is; encapsulation enforces that nothing else is reachable."
      },
      {
        heading: "Layers of abstraction",
        text: "Systems stack abstractions: controller calls service, service calls repository, repository calls a database driver. Each layer should speak at one level of detail. When a method mixes `if (user.isActive())` with raw SQL string building, the levels are mixed and the method is harder to read and change.",
        note: "Over-abstraction is also a cost. Do not add an interface layer until there is a real second implementation or a testing need (see YAGNI)."
      }
    ],
    takeaways: [
      "Abstraction hides details and exposes essential operations.",
      "Implemented with interfaces, abstract classes and well-named methods.",
      "Good abstractions hide what changes; leaky ones expose internals.",
      "Abstraction is the design idea, encapsulation is the enforcement."
    ],
    pitfalls: [
      "Leaky abstractions that expose SQL, HTTP or framework types.",
      "Premature abstraction with a single implementation and no variation.",
      "Mixing multiple levels of detail in one method.",
      "Naming by implementation (`MySqlRepo`) instead of role."
    ],
    interviewQs: [
      { q: "What is abstraction and why does it matter?", a: "Abstraction exposes only what callers need and hides how it is done. It reduces cognitive load, lets implementations change independently and limits the blast radius of changes." },
      { q: "What is the difference between abstraction and encapsulation?", a: "Abstraction is about designing a simple interface that hides complexity. Encapsulation is bundling state with behaviour and restricting direct access to it. One shapes the public surface; the other protects the internals." },
      { q: "What is a leaky abstraction?", a: "One that forces callers to understand its hidden details to use it correctly, for example an interface requiring SQL strings or connection management. The details leaked through the supposed boundary." },
      { q: "How do you implement abstraction in Java?", a: "Mainly with interfaces and abstract classes, plus access modifiers and well-chosen public methods. Callers depend on the abstract type while concrete classes remain hidden." }
    ],
    related: ["interfaces", "encapsulation", "dip", "yagni"]
  },

  {
    id: "encapsulation",
    name: "Encapsulation",
    summary: "**Encapsulation** bundles data with the methods that operate on it and restricts direct access to that data. The goal is to protect **invariants**: an object should never be observable or constructible in an invalid state.",
    sections: [
      {
        heading: "Hiding state behind behaviour",
        text: "Make fields private and expose behaviour, not raw data. The object decides how its state changes, so it can enforce rules in one place.",
        code: [
          { file: "Bad.java", body: `public class BankAccount {
  public double balance;     // anyone can write anything
}

account.balance = -500;      // invariant broken` },
          { file: "Good.java", body: `public class BankAccount {
  private double balance;

  public void withdraw(double amount) {
    if (amount <= 0) throw new IllegalArgumentException("amount must be positive");
    if (amount > balance) throw new IllegalStateException("insufficient funds");
    balance -= amount;
  }

  public double balance() { return balance; }
}` }
        ]
      },
      {
        heading: "Access modifiers",
        text: "Java gives four levels. Choose the narrowest one that works.",
        bullets: [
          "`private`: this class only. The default for fields.",
          "package-private (no keyword): classes in the same package.",
          "`protected`: the package plus subclasses. Subclasses see internals, so use sparingly.",
          "`public`: everyone. This is your API; changing it breaks callers."
        ]
      },
      {
        heading: "Getters and setters are not encapsulation",
        text: "A private field with a public getter and setter for every field is just a public field with extra typing. True encapsulation exposes meaningful operations ('tell, don't ask').",
        code: [
          { file: "Ask.java", body: `// Caller pulls data out and makes the decision itself
if (account.getBalance() >= amount) {
  account.setBalance(account.getBalance() - amount);
}` },
          { file: "Tell.java", body: `// The object makes the decision
account.withdraw(amount);` }
        ]
      },
      {
        heading: "Defensive copies and immutability",
        text: "Returning a reference to an internal mutable collection lets callers bypass your rules. Return a copy or an unmodifiable view. Immutable objects (final fields, no setters) are the strongest form of encapsulation and are inherently thread-safe.",
        code: [
          { file: "Leak.java", body: `class Team {
  private final List<Player> players = new ArrayList<>();
  public List<Player> players() { return players; }   // caller can clear() it
}` },
          { file: "Safe.java", body: `class Team {
  private final List<Player> players = new ArrayList<>();
  public List<Player> players() { return List.copyOf(players); }
  public void add(Player p) {
    if (players.size() >= 11) throw new IllegalStateException("team full");
    players.add(p);
  }
}` }
        ]
      },
      {
        heading: "Encapsulation and the Law of Demeter",
        text: "When objects expose their internals, callers chain through them (`order.getCustomer().getAddress().getCity()`). Encapsulation reduces such coupling: ask the order for what you need (`order.shippingCity()`) and keep the structure private."
      }
    ],
    takeaways: [
      "Keep fields private and expose behaviour that enforces invariants.",
      "Getter/setter pairs on every field are not real encapsulation.",
      "Do not leak mutable internals; copy or expose read-only views.",
      "Immutability is encapsulation at its strongest."
    ],
    pitfalls: [
      "Public fields or auto-generated getters and setters for everything.",
      "Returning internal collections directly.",
      "Letting callers make decisions that the object should own.",
      "Overusing `protected`, which exposes internals to subclasses."
    ],
    interviewQs: [
      { q: "What is encapsulation?", a: "Bundling data and the behaviour that manipulates it in one class, and hiding the data behind a controlled interface so the object can guarantee its own invariants." },
      { q: "Are getters and setters encapsulation?", a: "Not by themselves. If every field has a public getter and setter, the internals are effectively public. Encapsulation means exposing operations with meaning and validation, such as `withdraw`, instead of `setBalance`." },
      { q: "How do you prevent a mutable internal list from being modified externally?", a: "Return a defensive copy or an unmodifiable view (`List.copyOf`, `Collections.unmodifiableList`), and provide explicit methods like `add` that enforce rules." },
      { q: "Why are immutable objects considered well-encapsulated?", a: "Their state cannot change after construction, so invariants established in the constructor always hold, and they can be shared across threads without synchronisation." }
    ],
    related: ["abstraction", "classes-objects", "law-of-demeter", "srp"]
  },

  {
    id: "aggregation",
    name: "Aggregation",
    summary: "**Aggregation** is a weak 'has-a' relationship: a whole object holds references to part objects, but the parts have an independent lifecycle and can exist without the whole. A `Team` has `Player`s, yet players exist when the team is disbanded.",
    sections: [
      {
        heading: "Definition and example",
        text: "In aggregation the whole does not create or own the parts. They are created elsewhere and passed in, and may be shared by several wholes. If the whole is destroyed, the parts live on.",
        code: [
          { file: "Player.java", body: `public class Player {
  private final String name;
  public Player(String name) { this.name = name; }
  public String name() { return name; }
}` },
          { file: "Team.java", body: `public class Team {
  private final String name;
  private final List<Player> players = new ArrayList<>();

  public Team(String name) { this.name = name; }

  public void add(Player p) { players.add(p); }   // player created elsewhere
  public void disband() { players.clear(); }      // players still exist
}` },
          { file: "Main.java", body: `Player asha = new Player("Asha");
Team a = new Team("Falcons");
Team b = new Team("Hawks");
a.add(asha);          // the same player can be referenced by multiple teams
b.add(asha);
a.disband();          // asha is unaffected` }
        ]
      },
      {
        heading: "Spotting aggregation",
        text: "Ask three questions. Can the part exist alone? Can the same part belong to several wholes? Is the part created outside the whole? If the answers are yes, it is aggregation.",
        bullets: [
          "Department has Professors (professors outlive the department).",
          "Playlist has Songs (songs belong to many playlists).",
          "Library has Books, Team has Players, Cart has Products."
        ]
      },
      {
        heading: "How it looks in UML",
        text: "Aggregation is drawn with an empty (hollow) diamond at the whole's end of the line.",
        code: [
          { file: "diagram.txt", body: `  +--------+ 1      0..*  +---------+
  |  Team  |<>------------| Player  |
  +--------+               +---------+
   whole      hollow         part
              diamond` }
        ]
      },
      {
        heading: "Aggregation vs association vs composition",
        text: "Association is the general idea that objects know each other. Aggregation narrows it to whole/part with independent lifetimes. Composition (next lessons) narrows it again to whole/part where the part's lifetime is bound to the whole.\n\nIn practice the code for aggregation and plain association looks nearly identical: a field holding a reference. The difference is in the semantics you intend and document. Many teams skip aggregation entirely and just say 'association'."
      }
    ],
    takeaways: [
      "Aggregation: whole has parts, but parts live independently.",
      "Parts are created outside and may be shared.",
      "UML uses a hollow diamond.",
      "It sits between association (weakest) and composition (strongest)."
    ],
    pitfalls: [
      "Using aggregation where the part should not exist without the whole (that is composition).",
      "Treating aggregation as ownership and cascading deletes.",
      "Exposing the internal list so outsiders mutate the group.",
      "Spending interview time on the UML diamond instead of design behaviour."
    ],
    interviewQs: [
      { q: "What is aggregation?", a: "A has-a relationship where the contained objects can exist independently of the container. The container references parts it did not create and does not control their lifetime." },
      { q: "Give an example of aggregation and why it is not composition.", a: "A `Team` with `Player`s. Players exist before joining and after the team is disbanded, and can belong to several teams, so the lifecycles are independent. In composition, like `House` and `Room`, the part would be destroyed with the whole." },
      { q: "How is aggregation shown in UML?", a: "A line with an empty diamond attached to the whole's end." },
      { q: "How would you decide between aggregation and composition in an LLD interview?", a: "Ask who creates the part and what happens to it when the whole goes away. If the part is meaningless without the whole and is destroyed with it, use composition. Otherwise use aggregation or plain association." }
    ],
    related: ["composition", "association", "classes-objects"]
  },

  {
    id: "composition",
    name: "Composition",
    summary: "**Composition** is a strong 'has-a' relationship where the whole creates and owns its parts, and the parts cannot meaningfully exist without it. It is also the design technique of building behaviour by combining objects, and is usually preferred over inheritance.",
    sections: [
      {
        heading: "Composition as ownership",
        text: "In the UML sense, composition means the part's lifetime is bound to the whole: the whole creates the part, no one else holds it, and it goes away with the whole. A `House` has `Room`s. Destroy the house and the rooms are gone.",
        code: [
          { file: "House.java", body: `public class House {
  private final List<Room> rooms = new ArrayList<>();

  public House(int bedrooms) {
    for (int i = 0; i < bedrooms; i++) {
      rooms.add(new Room("Bedroom " + (i + 1)));   // the house creates its rooms
    }
  }
}` }
        ]
      },
      {
        heading: "Composition as a design technique",
        text: "The second, broader meaning is reusing behaviour by holding collaborators instead of inheriting from them. The class delegates work to injected objects. Behaviour can change by swapping parts, even at runtime.",
        code: [
          { file: "Inheritance.java", body: `// Explosion of subclasses as behaviours combine
class Duck {}
class FlyingDuck extends Duck {}
class FlyingQuackingDuck extends FlyingDuck {}
class SwimmingQuackingDuck extends Duck {}
class RubberDuck extends Duck {}  // can't fly, must override and disable` },
          { file: "Composition.java", body: `class Duck {
  private final FlyBehavior fly;
  private final QuackBehavior quack;

  Duck(FlyBehavior fly, QuackBehavior quack) {
    this.fly = fly;
    this.quack = quack;
  }

  void performFly()   { fly.fly(); }
  void performQuack() { quack.quack(); }
}

Duck rubber = new Duck(new NoFly(), new Squeak());
Duck mallard = new Duck(new WingFly(), new LoudQuack());` }
        ]
      },
      {
        heading: "Why prefer composition over inheritance",
        text: "Composition couples classes only through public interfaces, while inheritance couples a subclass to its parent's internals.",
        bullets: [
          "Behaviour can change at runtime by swapping the held object.",
          "No fragile base class: the part's internals are hidden.",
          "Combinations come from mixing parts, not creating subclasses.",
          "Each part is small, focused and testable (SRP)."
        ],
        note: "This is the idea behind Strategy, Decorator, State and Bridge."
      },
      {
        heading: "Delegation",
        text: "A composed object forwards calls to its parts. Keep the forwarding thin and meaningful. If a class only forwards everything, it may not be adding value.",
        code: [
          { file: "Delegation.java", body: `class Car {
  private final Engine engine;     // composed part
  Car(Engine engine) { this.engine = engine; }

  void start() {
    engine.ignite();                // delegate
    // plus car-level behaviour: dashboard lights, seatbelt check...
  }
}` }
        ]
      },
      {
        heading: "Composition vs aggregation vs inheritance",
        text: "Inheritance is 'is-a' and static, fixed at compile time. Aggregation and composition are 'has-a'. Aggregation has independent lifetimes; composition has dependent lifetimes. For choosing in an LLD answer: reach for composition and interfaces first, and use inheritance only for true subtypes."
      }
    ],
    takeaways: [
      "Composition means the whole owns and creates the parts.",
      "As a technique, it builds behaviour from collaborating objects.",
      "It avoids fragile base classes and subclass explosions.",
      "Prefer composition over inheritance by default."
    ],
    pitfalls: [
      "Calling something composition while sharing the part with other objects.",
      "Hard-coding concrete parts in the constructor, so they cannot be swapped or mocked.",
      "Pure forwarding wrappers that add no value.",
      "Leaking owned parts through getters so others can mutate or hold them."
    ],
    interviewQs: [
      { q: "What is composition and how is it different from aggregation?", a: "Both are has-a. In composition the whole creates and owns the part, and the part cannot outlive it (House and Room). In aggregation the part is independent and may be shared (Team and Player)." },
      { q: "Why do people say 'favour composition over inheritance'?", a: "Inheritance binds a subclass tightly to its parent and fixes the relationship at compile time. Composition uses public interfaces, allows swapping behaviour at runtime, avoids subclass explosions and keeps classes decoupled." },
      { q: "How would you fix a class hierarchy that grows with every new feature combination?", a: "Extract the varying behaviours into interfaces (fly, quack), implement them as small classes, and compose them into the main class. New combinations come from wiring objects, not writing subclasses." },
      { q: "Which design patterns rely on composition?", a: "Strategy, Decorator, State, Bridge, Composite and Command all work by holding and delegating to other objects instead of inheriting behaviour." }
    ],
    related: ["aggregation", "inheritance", "strategy", "decorator", "dip"]
  },

  {
    id: "association",
    name: "Association",
    summary: "**Association** is the general relationship in which one object knows about and uses another. Aggregation and composition are special, stronger forms of it. Getting associations right (direction, multiplicity, ownership) is a large part of a good class diagram.",
    sections: [
      {
        heading: "What an association is",
        text: "Two classes are associated when instances of one hold a reference to, or call methods on, instances of the other. Neither owns the other. A `Doctor` treats `Patient`s; a `Patient` visits `Doctor`s.",
        code: [
          { file: "Doctor.java", body: `public class Doctor {
  private final String name;
  private final List<Patient> patients = new ArrayList<>();

  public void assign(Patient p) { patients.add(p); }
}` },
          { file: "Patient.java", body: `public class Patient {
  private final String name;
  private final List<Doctor> doctors = new ArrayList<>();   // bidirectional

  public void visit(Doctor d) { doctors.add(d); }
}` }
        ]
      },
      {
        heading: "Direction and multiplicity",
        text: "Two decisions define an association. **Direction**: does A know B, B know A, or both? **Multiplicity**: one-to-one, one-to-many or many-to-many?\n\nPrefer unidirectional links. Each direction is another reference to keep consistent, and bidirectional links tend to drift out of sync.",
        code: [
          { file: "diagram.txt", body: `  +--------+ 1         0..* +---------+
  | Order  |--------------->| Item    |   one order has many items
  +--------+                +---------+   (Order knows Items, not vice versa)

  +---------+ *        * +----------+
  | Student |<---------->| Course   |   many-to-many, bidirectional
  +---------+            +----------+` }
        ],
        note: "Many-to-many associations often deserve their own class, such as `Enrollment` holding grade and date."
      },
      {
        heading: "Association vs dependency",
        text: "A dependency is a weaker, temporary 'uses': a class takes another as a method parameter or creates it locally, but does not keep a reference. An association is longer-lived, typically a field.",
        code: [
          { file: "Dependency.java", body: `class ReportPrinter {
  // Dependency: Printer only appears as a parameter
  void print(Report r, Printer p) { p.print(r.text()); }
}` },
          { file: "Association.java", body: `class ReportService {
  private final Printer printer;       // Association: held as a field
  ReportService(Printer printer) { this.printer = printer; }
}` }
        ]
      },
      {
        heading: "Choosing the strength of a relationship",
        text: "A quick decision guide when modelling:",
        bullets: [
          "Only needed during one call: **dependency** (parameter).",
          "Held and used over time, independent lifetimes: **association** or **aggregation**.",
          "Part's lifetime tied to the whole: **composition**.",
          "A is-a B and substitutable: **inheritance**."
        ]
      },
      {
        heading: "Associations in LLD interviews",
        text: "When you list entities, sketch the links between them: `Booking` associates `User`, `Show` and `ShowSeat`. Decide direction by who needs to navigate. If you rarely look up all bookings from a seat, do not store that back-reference; query it instead."
      }
    ],
    takeaways: [
      "Association is the general 'knows about / uses' relationship.",
      "Define direction and multiplicity explicitly.",
      "Prefer unidirectional associations to avoid inconsistent state.",
      "Aggregation and composition are stronger special cases."
    ],
    pitfalls: [
      "Bidirectional links without a single place that keeps both sides consistent.",
      "Modelling many-to-many with two lists instead of an association class.",
      "Confusing a temporary dependency with a long-lived association.",
      "Making every relationship composition or inheritance by default."
    ],
    interviewQs: [
      { q: "What is the difference between association, aggregation and composition?", a: "Association is any 'uses/knows' link. Aggregation is a has-a whole/part link with independent lifetimes. Composition is a has-a link where the part's lifetime is bound to the whole. Each is a stronger special case of the previous." },
      { q: "What is the difference between association and dependency?", a: "A dependency is temporary, usually through a method parameter or a local variable. An association is a lasting relationship, typically a field. Dependencies are weaker and drawn as dashed arrows in UML." },
      { q: "How do you model a many-to-many relationship?", a: "Often with an association class such as `Enrollment` between `Student` and `Course`, so extra attributes (grade, date) have a home and each side keeps a manageable collection." },
      { q: "Why prefer unidirectional associations?", a: "A bidirectional link needs both references updated together. Forgetting one leaves inconsistent state, and it increases coupling between the two classes." }
    ],
    related: ["aggregation", "composition", "class-diagram", "law-of-demeter"]
  }
);
