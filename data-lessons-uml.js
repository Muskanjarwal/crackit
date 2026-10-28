window.LESSONS = window.LESSONS || [];
window.LESSONS.push(
  {
    id: "class-diagram",
    name: "Class Diagram",
    summary: "A class diagram is a static picture of a system: the classes, their attributes and methods, and the relationships between them. It is the diagram you will draw most often in an LLD round, because it is the fastest way to show your entity model.",
    sections: [
      {
        heading: "Anatomy of a class box",
        text: "Each class is a rectangle split into three compartments: the name, the attributes and the operations. Visibility is shown with a prefix symbol. Abstract classes and interfaces are marked with a stereotype (or italic name).",
        bullets: [
          "`+` public, `-` private, `#` protected, `~` package-private.",
          "Attributes are written `name: Type`, for example `- balance: Money`.",
          "Operations are written `name(param: Type): ReturnType`.",
          "`<<interface>>` and `<<enum>>` stereotypes go above the class name; `static` members are underlined (or marked `{static}` in text).",
          "In an interview you can omit trivial getters and setters, and omit private helpers. Show only what matters to the design."
        ],
        code: [
          {
            file: "class-box.txt",
            body: `+---------------------------+
|          Account          |
+---------------------------+
| - id: String              |
| - balance: Money          |
| - status: AccountStatus   |
+---------------------------+
| + deposit(amount): void   |
| + withdraw(amount): void  |
| + getBalance(): Money     |
+---------------------------+`
          },
          {
            file: "Account.java",
            body: `public class Account {
  private String id;
  private Money balance;
  private AccountStatus status;

  public void deposit(Money amount) { ... }
  public void withdraw(Money amount) { ... }
  public Money getBalance() { return balance; }
}`
          }
        ]
      },
      {
        heading: "Relationship notation",
        text: "Relationships are what make a class diagram more than a list of boxes. Learn these six; they cover nearly everything an interviewer will ask for.",
        bullets: [
          "**Association** (`A ---> B`): A holds a reference to B and uses it. A plain solid line, optionally with an arrowhead showing navigability.",
          "**Aggregation** (`A <>--- B`, hollow diamond at the whole): A has B, but B can exist without A. Example: Team and Player.",
          "**Composition** (`A <#>--- B`, filled diamond at the whole): A owns B and controls its lifetime. Example: Order and OrderLine.",
          "**Inheritance / generalisation** (`B ---|> A`, hollow triangle at the parent): B is a kind of A.",
          "**Realisation** (`B - - -|> I`, dashed line with hollow triangle): B implements interface I.",
          "**Dependency** (`A - - -> B`, dashed arrow): A uses B only transiently, e.g. as a method parameter or local variable."
        ],
        code: [
          {
            file: "relationships.txt",
            body: `Association        Customer ------------> Address
Aggregation        Team <>------------- Player        (hollow diamond)
Composition        Order <#>------------ OrderLine    (filled diamond)
Inheritance        SavingsAccount ------|> Account
Realisation        UpiPayment - - - - -|> PaymentMethod
Dependency         Checkout - - - - - -> Logger`
          }
        ]
      },
      {
        heading: "Multiplicity and roles",
        text: "Put multiplicity at each end of an association to say how many instances take part. Without it, the reader cannot tell whether a customer has one address or many.",
        bullets: [
          "`1` exactly one, `0..1` optional, `*` or `0..*` zero or more, `1..*` one or more.",
          "Label the line with a verb or role name (`places`, `owns`) when it is not obvious.",
          "Multiplicity maps directly to code: `1` is a field, `0..1` is a nullable or Optional field, `*` is a collection."
        ]
      },
      {
        heading: "Worked example: a tiny online store",
        text: "A Customer places many Orders. An Order is composed of OrderLines (they die with it) and each line refers to a Product, which exists independently. Payment is an interface with two implementations.",
        code: [
          {
            file: "diagram.txt",
            body: `+-----------+ 1      0..* +-----------+ 1     1..* +-------------+
| Customer  |------------>|   Order   |<#>-------->| OrderLine   |
+-----------+   places    +-----------+            +-------------+
| - name    |             | - id      |            | - quantity  |
| - email   |             | - status  |            +------+------+
+-----------+             +-----+-----+                   | *
                                | uses                    | refers to
                                v                         v 1
                       +-----------------+          +-----------+
                       | <<interface>>   |          |  Product  |
                       |  PaymentMethod  |          +-----------+
                       +-----------------+          | - sku     |
                       | + pay(amount)   |          | - price   |
                       +--------^--------+          +-----------+
                                |  (realisation)
                  +-------------+-------------+
                  |                           |
            +-----------+              +-------------+
            | UpiPayment|              | CardPayment |
            +-----------+              +-------------+`
          },
          {
            file: "Store.java",
            body: `public class Customer {
  private String name;
  private String email;
  private List<Order> orders = new ArrayList<>();   // 1 .. 0..*
}

public class Order {
  private String id;
  private OrderStatus status;
  private final List<OrderLine> lines = new ArrayList<>(); // composition
  private PaymentMethod paymentMethod;                      // association
}

public class OrderLine {
  private int quantity;
  private Product product;   // association: Product lives on its own
}

public interface PaymentMethod { Receipt pay(Money amount); }
public class UpiPayment implements PaymentMethod { ... }
public class CardPayment implements PaymentMethod { ... }`
          }
        ]
      },
      {
        heading: "When to draw it in an interview",
        text: "Draw a class diagram right after you finalise requirements and entities, and keep refining it as you go. It anchors the conversation: the interviewer can point at a box and ask why it exists. Keep it small. Ten to twelve classes is plenty, and drawing every getter wastes your time."
      }
    ],
    takeaways: [
      "A class box has three compartments: name, attributes, operations.",
      "Know six relationships: association, aggregation, composition, inheritance, realisation, dependency.",
      "Composition means shared lifetime; aggregation does not.",
      "Always show multiplicity on associations that are not obviously one-to-one.",
      "The diagram is a communication tool. Omit anything that does not help the discussion."
    ],
    pitfalls: [
      "Drawing every relationship as a plain line, so the reader cannot tell ownership from usage.",
      "Putting persistence or UI classes in an LLD diagram when the question is about the domain model.",
      "Cluttering boxes with getters, setters and private helpers.",
      "Using inheritance arrows where composition is the right relationship.",
      "Drawing the diagram once and never updating it when the design changes."
    ],
    interviewQs: [
      { q: "What is the difference between aggregation and composition?", a: "Both model a has-a relationship. In composition the whole owns the part and controls its lifetime: delete the Order and its OrderLines go too (filled diamond). In aggregation the part can outlive the whole: delete a Team and the Players still exist (hollow diamond)." },
      { q: "How do you show that a class implements an interface?", a: "Use a realisation arrow: a dashed line with a hollow triangle pointing at the interface. In code that is `implements`. Inheritance between classes uses a solid line with a hollow triangle." },
      { q: "How does a dependency differ from an association?", a: "An association is a structural relationship, usually a field that lives as long as the object. A dependency is transient: the class only uses the other as a parameter, local variable or return type. Dependencies are drawn with a dashed arrow." },
      { q: "How much detail should a class diagram have in an LLD interview?", a: "Enough to show the entities, their key attributes, public methods that carry behaviour, and relationships with multiplicity. Skip getters and setters and anything incidental. The goal is to support the conversation, not to document the code." }
    ],
    related: ["association", "aggregation", "composition", "inheritance", "interfaces", "sequence-diagram", "lld-interview-framework"]
  },

  {
    id: "use-case-diagram",
    name: "Use Case Diagram",
    summary: "A use case diagram shows who uses a system (actors) and what they can do with it (use cases), without saying how it is implemented. It is a requirements tool: use it to agree on scope before you design any classes.",
    sections: [
      {
        heading: "The building blocks",
        text: "There are only a few elements. The power of the diagram comes from keeping it at the level of user goals.",
        bullets: [
          "**Actor**: a role that interacts with the system, drawn as a stick figure. It may be a person (Customer), another system (Payment Gateway) or time (Scheduler).",
          "**Use case**: one goal an actor wants to achieve, drawn as an oval and named with a verb phrase: \"Withdraw Cash\", \"Place Order\".",
          "**System boundary**: a rectangle around the use cases. Actors sit outside it.",
          "**Association**: a line from an actor to a use case they take part in.",
          "**Include** (`<<include>>`): a use case always invokes another. \"Withdraw Cash\" includes \"Authenticate\".",
          "**Extend** (`<<extend>>`): optional or conditional behaviour added to a base use case. \"Withdraw Cash\" can be extended by \"Print Receipt\".",
          "**Generalisation**: a specialised actor or use case inherits from a general one."
        ]
      },
      {
        heading: "Worked example: ATM",
        text: "The customer withdraws cash, checks balance and deposits cash. Every one of those requires authentication, so each includes it. A bank system is a secondary actor that approves transactions.",
        code: [
          {
            file: "diagram.txt",
            body: `            +-------------------- ATM System --------------------+
            |                                                      |
            |        ( Authenticate )<------------------+          |
            |            ^         ^                    |          |
            |  <<include>>|         |<<include>>        |          |
            |            |         |                    |          |
 [Customer]-+--( Withdraw Cash )  ( Check Balance )     |          |
     |      |        .                                  |          |
     |      |        . <<extend>>                       |          |
     |      |        v                                  |          |
     +------+--( Deposit Cash )  ( Print Receipt )      |          |
            |                                           |          |
            |      ( Approve Transaction )--------------+----[Bank]|
            +------------------------------------------------------+`
          },
          {
            file: "Mapping.java",
            body: `// Each use case becomes a public operation on a service,
// and each actor becomes a caller (or an external dependency).
public interface AtmService {
  Session authenticate(Card card, Pin pin);      // Authenticate
  Receipt withdraw(Session s, Money amount);     // Withdraw Cash
  Money checkBalance(Session s);                 // Check Balance
  Receipt deposit(Session s, Money amount);      // Deposit Cash
}

public interface BankGateway {                   // secondary actor: Bank
  boolean approve(Transaction tx);
}`
          }
        ]
      },
      {
        heading: "Use cases to requirements",
        text: "Each use case is a candidate functional requirement. After drawing the diagram, walk through it with the interviewer: \"So customers can do these four things, the bank is an external system, and admin features like refilling cash are out of scope?\" That confirmation is what the diagram is for."
      },
      {
        heading: "When to use it in an interview",
        text: "Use a use case diagram, or just a bulleted list of actors and goals, in the first five minutes. Do not spend time on include and extend notation unless the interviewer asks. A list like \"Customer: search, book, cancel. Admin: add movie, add show\" often does the same job faster."
      }
    ],
    takeaways: [
      "Actors are roles, not individual people, and may be external systems.",
      "Use case names are verb phrases describing a user goal.",
      "Include means always; extend means sometimes.",
      "The diagram describes what, never how. No classes, no methods.",
      "Each use case maps to a requirement and later to an operation on a service."
    ],
    pitfalls: [
      "Drawing use cases as technical steps (\"Query Database\") instead of user goals.",
      "Confusing include and extend: arrows and direction are easy to flip.",
      "Putting the actor inside the system boundary.",
      "Creating so many use cases that the diagram becomes a feature list nobody can read.",
      "Skipping secondary actors such as payment gateways or notification services."
    ],
    interviewQs: [
      { q: "What is the difference between include and extend?", a: "Include is mandatory reuse: the base use case always runs the included one (Withdraw includes Authenticate). Extend is optional and conditional: the extension adds behaviour only in some cases (Withdraw may be extended by Print Receipt). The extend arrow points from the extension to the base; the include arrow points from the base to the included case." },
      { q: "Who counts as an actor?", a: "Anyone or anything outside the system that interacts with it: human roles, external systems like payment gateways, or time-based triggers like a scheduler. If it is inside your system boundary it is not an actor." },
      { q: "How do you go from a use case diagram to classes?", a: "Each use case suggests an operation (often on a service or controller class). The nouns in the use case descriptions suggest entities. Actors suggest user or role classes, or external interfaces you depend on." },
      { q: "Is a use case diagram worth drawing in a 45-minute LLD round?", a: "Usually a short list of actors and goals is enough. Draw the full diagram only if the system has several actor types with different permissions, where seeing who can do what clarifies scope." }
    ],
    related: ["class-diagram", "sequence-diagram", "lld-interview-framework"]
  },

  {
    id: "sequence-diagram",
    name: "Sequence Diagram",
    summary: "A sequence diagram shows how objects interact over time for one scenario: who calls whom, in what order, and what comes back. It is the best way to validate that your classes can actually carry out a use case.",
    sections: [
      {
        heading: "Notation",
        text: "Participants are laid out left to right across the top. A vertical dashed line (the lifeline) drops from each one, and time flows downward. Horizontal arrows between lifelines are messages.",
        bullets: [
          "**Participant**: an object or actor, written as a box with `name: Type`.",
          "**Synchronous call**: a solid line with a filled arrowhead. The caller waits.",
          "**Return**: a dashed line with an open arrowhead, optional when obvious.",
          "**Asynchronous message**: a solid line with an open arrowhead. The caller does not wait.",
          "**Activation bar**: a thin rectangle on a lifeline showing when the object is executing.",
          "**Self-call**: an arrow that loops back to the same lifeline.",
          "**Combined fragments**: `alt` (if/else), `opt` (if), `loop`, `par` (parallel), drawn as labelled boxes around messages."
        ]
      },
      {
        heading: "Worked example: confirming a booking",
        text: "A user confirms a booking. The service checks the seat locks, charges the payment strategy, and marks the seats as booked. An `alt` fragment covers the failure path.",
        code: [
          {
            file: "diagram.txt",
            body: `User      BookingService      LockService     PaymentStrategy     SeatRepo
 |  confirm(id)  |                  |                |                |
 |-------------->|                  |                |                |
 |               | isHeldBy(id)?    |                |                |
 |               |----------------->|                |                |
 |               |<- - - true - - - |                |                |
 |               |                                   |                |
 |        +------+ alt [lock still held]             |                |
 |        |      | pay(amount)                       |                |
 |        |      |---------------------------------->|                |
 |        |      |<- - - - receipt - - - - - - - - - |                |
 |        |      | markBooked(seats)                                  |
 |        |      |--------------------------------------------------->|
 |        +------+ [else]                                             |
 |        |      | throw LockExpiredException                         |
 |        +------+                                                    |
 |<- - - booking - - |                                                |
 |               |                                                    |`
          },
          {
            file: "BookingService.java",
            body: `public Booking confirm(String bookingId) {
  Booking booking = bookings.get(bookingId);

  if (!lockService.isHeldBy(booking.seatIds(), bookingId)) {   // alt: else branch
    throw new LockExpiredException(bookingId);
  }

  Receipt receipt = paymentStrategy.pay(booking.total());      // PaymentStrategy
  seatRepo.markBooked(booking.seatIds());                      // SeatRepo
  booking.confirm(receipt);
  return booking;
}`
          }
        ]
      },
      {
        heading: "What the diagram reveals",
        text: "Drawing a sequence forces you to find missing methods and wrong responsibilities. If a message has no home (no class owns that operation), you are missing a method or class. If one participant appears in every message, it is probably doing too much. If the arrows zigzag between two classes repeatedly, they are too chatty and perhaps should be merged or one should hold the data the other keeps asking for."
      },
      {
        heading: "When to use it in an interview",
        text: "Pick one or two critical flows (the happy path of the core use case, and the trickiest failure or concurrent path) and sketch just those. Do not try to diagram every scenario. A sequence diagram is especially useful for explaining concurrency: it shows exactly where a lock is taken and released."
      }
    ],
    takeaways: [
      "Participants run left to right; time runs top to bottom.",
      "Solid arrows are calls, dashed arrows are returns.",
      "Use `alt`, `opt` and `loop` fragments for branches and repetition.",
      "One diagram describes one scenario; do not try to cover everything.",
      "Missing methods and overloaded classes show up quickly when you draw the flow."
    ],
    pitfalls: [
      "Drawing every getter call, which hides the interesting interaction.",
      "Using participants that are not in your class diagram.",
      "Including too many participants; more than five or six is hard to read.",
      "Showing implementation details (SQL, framework calls) instead of design-level messages.",
      "Forgetting the failure path when the problem is about correctness under failure."
    ],
    interviewQs: [
      { q: "When would you pick a sequence diagram over a class diagram?", a: "A class diagram shows structure; a sequence diagram shows behaviour over time. Choose a sequence diagram when the question is about the order of operations, collaboration between objects, or concurrency, for example where a lock is acquired during booking." },
      { q: "How do you represent an if/else in a sequence diagram?", a: "With an `alt` combined fragment: a box labelled `alt` divided by a dashed line into guarded regions such as `[seat available]` and `[else]`. Use `opt` for an if with no else and `loop` for repetition." },
      { q: "What does a dashed arrow mean?", a: "A return message: the value or control returning to the caller. Calls are solid lines. Returns are often omitted when the result is obvious from the call." },
      { q: "How can a sequence diagram expose design problems?", a: "If a message has no class that should own it, you are missing a responsibility. If one participant fans out to everything, it is a god class. If two participants exchange many messages, they may be too tightly coupled." }
    ],
    related: ["class-diagram", "activity-diagram", "state-machine-diagram", "law-of-demeter", "lld-interview-framework"]
  },

  {
    id: "activity-diagram",
    name: "Activity Diagram",
    summary: "An activity diagram is a flowchart for a process. It shows actions, decisions and parallel branches, so it is ideal for business workflows such as checkout, order fulfilment or approval chains.",
    sections: [
      {
        heading: "Notation",
        text: "Flow starts at a filled circle, moves through rounded action boxes, and ends at a bullseye. Diamonds branch and merge; thick bars split and join parallel flows.",
        bullets: [
          "**Initial node**: a filled black circle where the flow starts.",
          "**Action**: a rounded rectangle describing one step.",
          "**Decision / merge**: a diamond. Outgoing arrows carry guards such as `[in stock]` and `[out of stock]`.",
          "**Fork / join**: a thick bar that splits one flow into parallel flows (fork) and waits for all of them to finish (join).",
          "**Final node**: a bullseye ending the whole activity. A circle with an X ends only one flow.",
          "**Swimlanes**: vertical or horizontal bands that assign each action to an actor or component."
        ]
      },
      {
        heading: "Worked example: placing an order",
        text: "After the customer submits an order, the system checks stock. If available it takes payment and, in parallel, reserves inventory and sends a confirmation. When both finish the order is marked as placed.",
        code: [
          {
            file: "diagram.txt",
            body: `            (*)
             |
     [ Submit order ]
             |
        < In stock? >
         /         \\
   [no] /           \\ [yes]
       v             v
 [ Reject order ]  [ Take payment ]
       |             |
       |          < Paid? >
       |          /       \\
       |     [no]/         \\[yes]
       |        v           v
       |   [ Cancel ]    ====== fork ======
       |        |        |              |
       |        |  [ Reserve stock ] [ Send confirmation ]
       |        |        |              |
       |        |     ====== join ======
       |        |             |
       |        |      [ Mark order placed ]
       |        |             |
       +--------+-------------+
                     |
                    (O)`
          },
          {
            file: "OrderWorkflow.java",
            body: `public OrderResult place(Order order) {
  if (!inventory.inStock(order.items())) {        // decision: in stock?
    return OrderResult.rejected();
  }
  if (!payments.charge(order)) {                  // decision: paid?
    return OrderResult.cancelled();
  }

  // fork: both steps are independent, run them in parallel
  CompletableFuture<Void> reserve = CompletableFuture.runAsync(() -> inventory.reserve(order));
  CompletableFuture<Void> notify  = CompletableFuture.runAsync(() -> notifier.sendConfirmation(order));
  CompletableFuture.allOf(reserve, notify).join(); // join

  order.markPlaced();
  return OrderResult.placed(order);
}`
          }
        ]
      },
      {
        heading: "Activity vs state machine vs sequence",
        text: "These three diagrams are often confused. An activity diagram follows the flow of work through steps. A state machine diagram follows the life of one object through its states. A sequence diagram follows messages between objects. Use an activity diagram when the question is \"what are the steps and branches in this process?\""
      },
      {
        heading: "When to use it in an interview",
        text: "It is rarely required. Reach for it when the process has meaningful branching or parallelism, for example an order pipeline, a refund approval, or a CI-style workflow. A numbered list of steps is usually enough for simple flows."
      }
    ],
    takeaways: [
      "Activity diagrams model workflows: actions, decisions, forks and joins.",
      "Guards on decision arrows must be mutually exclusive and cover all cases.",
      "Fork and join show real parallelism; every fork needs a matching join.",
      "Swimlanes assign responsibility to actors or components.",
      "Prefer a state machine diagram when you are describing one object's lifecycle."
    ],
    pitfalls: [
      "Decisions with overlapping guards or missing an else branch.",
      "Forking without joining, leaving flows dangling.",
      "Putting low-level code steps (loops, assignments) into the diagram.",
      "Using an activity diagram for object lifecycles, which a state diagram models better.",
      "Making the diagram so detailed that it duplicates the code."
    ],
    interviewQs: [
      { q: "What do fork and join bars mean?", a: "A fork splits one flow into concurrent flows that can run in parallel. A join waits until all incoming flows finish before continuing. They show true concurrency, unlike a decision diamond, which picks one path." },
      { q: "How is an activity diagram different from a flowchart?", a: "It is very similar, but UML activity diagrams add parallelism (fork and join), swimlanes for responsibility, and object flows. They are intended to model workflows at the design level, not individual code lines." },
      { q: "When would you choose an activity diagram over a state machine diagram?", a: "Use an activity diagram to show the sequence of steps in a process. Use a state machine diagram to show the states one object passes through and the events that cause transitions, such as Order moving from Created to Paid to Shipped." },
      { q: "What are swimlanes for?", a: "They partition the diagram by actor or component, so you can see who performs each action: Customer, Payment Service, Warehouse. They make hand-offs and responsibilities visible." }
    ],
    related: ["sequence-diagram", "state-machine-diagram", "use-case-diagram", "lld-interview-framework"]
  },

  {
    id: "state-machine-diagram",
    name: "State Machine Diagram",
    summary: "A state machine diagram describes the life of one object: the states it can be in, the events that move it between states, and what happens on each transition. It is the best tool for ATMs, vending machines, orders and any object with a lifecycle.",
    sections: [
      {
        heading: "Notation",
        text: "States are rounded rectangles. Arrows are transitions labelled `event [guard] / action`. A filled circle marks the start and a bullseye marks the end.",
        bullets: [
          "**State**: a condition the object stays in for a while, such as `Idle`, `HasMoney`, `Dispensing`.",
          "**Transition**: an arrow from one state to another, labelled `event [guard] / action`. The event triggers it, the guard must be true, the action runs when it fires.",
          "**Initial state**: a filled circle pointing to the first state.",
          "**Final state**: a bullseye. Not every machine has one.",
          "**Entry / exit actions**: `entry / ...` and `exit / ...` inside a state run whenever it is entered or left.",
          "**Composite states**: a state that contains its own sub-states, useful to avoid repeating transitions such as `cancel`."
        ]
      },
      {
        heading: "Worked example: vending machine",
        text: "The machine waits idle until a coin arrives. Once enough money is inserted and a product is selected it dispenses and returns change. Cancel at any point before dispensing refunds the money.",
        code: [
          {
            file: "diagram.txt",
            body: `        (*)
         |
         v
   +-----------+   insertCoin    +------------+
   |   Idle    |---------------->|  HasMoney  |<-----+
   +-----------+                 +------------+      | insertCoin
        ^                          |   |   |---------+
        |                 cancel / |   | selectProduct
        |                  refund  |   | [credit >= price]
        |                          |   v
        |                          | +--------------+
        |                          | | Dispensing   |
        |                          | | entry/ drop  |
        |<-------------------------+ +------+-------+
        |  dispensed / return change        |
        +-----------------------------------+`
          },
          {
            file: "VendingMachine.java",
            body: `interface State {
  void insertCoin(VendingMachine m, Coin c);
  void selectProduct(VendingMachine m, Product p);
  void cancel(VendingMachine m);
}

class IdleState implements State {
  public void insertCoin(VendingMachine m, Coin c) {
    m.addCredit(c);
    m.setState(new HasMoneyState());          // Idle -> HasMoney
  }
  public void selectProduct(VendingMachine m, Product p) { throw new IllegalStateException("Insert coin first"); }
  public void cancel(VendingMachine m) { /* nothing to refund */ }
}

class HasMoneyState implements State {
  public void insertCoin(VendingMachine m, Coin c) { m.addCredit(c); }
  public void selectProduct(VendingMachine m, Product p) {
    if (m.credit().isLessThan(p.price())) throw new InsufficientCreditException();
    m.setState(new DispensingState(p));       // guard satisfied
  }
  public void cancel(VendingMachine m) {
    m.refund();                               // action on transition
    m.setState(new IdleState());
  }
}`
          }
        ]
      },
      {
        heading: "From diagram to code",
        text: "A state machine diagram translates almost one-to-one into code. For a small machine, an enum of states and a transition table or switch is enough. Once each state has meaningfully different behaviour for each event, the State pattern keeps the code clean: one class per state, and illegal events are rejected by default.",
        note: "Draw the diagram first. Gaps in the diagram (an event with no transition in some state) are exactly the bugs you would otherwise find in production."
      },
      {
        heading: "When to use it in an interview",
        text: "Use it whenever an entity has a lifecycle: Order (Created, Paid, Shipped, Delivered, Cancelled), Booking (Held, Confirmed, Expired), Elevator (Idle, MovingUp, MovingDown, DoorOpen). Listing the legal transitions is also the quickest way to specify what is not allowed, which is where interviewers probe."
      }
    ],
    takeaways: [
      "A state machine models one object's lifecycle: states, events, guards and actions.",
      "Transition labels follow `event [guard] / action`.",
      "Every state should handle (or explicitly reject) every event.",
      "Entry and exit actions remove duplicated code on transitions.",
      "Implement with an enum and switch for small machines, State pattern for richer ones."
    ],
    pitfalls: [
      "Missing transitions, leaving some events undefined in some states.",
      "Making a state out of something that is only a flag or attribute.",
      "Allowing illegal transitions to silently succeed instead of failing loudly.",
      "Modelling a workflow (steps in a process) as a state machine when an activity diagram fits better.",
      "Exploding the number of states when one orthogonal attribute should be modelled separately."
    ],
    interviewQs: [
      { q: "What do the parts of a transition label mean?", a: "`event [guard] / action`: the event triggers the transition, the guard is a boolean condition that must hold, and the action is behaviour executed when the transition fires. For example `selectProduct [credit >= price] / dispense()`." },
      { q: "When would you use the State pattern instead of an enum and switch?", a: "When behaviour differs substantially per state and the switch statements start spreading across many methods. The State pattern puts each state's behaviour in its own class, so adding a state does not touch the others. For a small machine with a few simple transitions an enum is simpler." },
      { q: "How does a state machine diagram differ from an activity diagram?", a: "A state machine tracks one object's states and the events that change them. An activity diagram tracks the flow of steps in a process, including parallelism and decisions. Order lifecycle is a state machine; order fulfilment workflow is an activity diagram." },
      { q: "How do you deal with an event that is not valid in the current state?", a: "Reject it explicitly, usually by throwing an exception or returning an error. Do not ignore it silently. Making the illegal-transition behaviour a deliberate decision per state is one of the main benefits of drawing the diagram." }
    ],
    related: ["state", "activity-diagram", "sequence-diagram", "lld-interview-framework"]
  },

  {
    id: "lld-interview-framework",
    name: "How to Answer a LLD Interview Question",
    summary: "A low level design round is a structured conversation, not a coding contest. Follow a repeatable framework: clarify requirements, identify entities, define relationships, design classes per requirement, handle extensibility and concurrency, then go deep where the interviewer pushes.",
    sections: [
      {
        heading: "What interviewers are actually evaluating",
        text: "The question is usually something familiar (a parking lot, a booking system). What is being tested is how you think, not whether you have seen the problem.",
        bullets: [
          "Requirement discipline: do you ask the right questions before writing code?",
          "Modelling: do your classes map cleanly to real concepts, with sensible responsibilities?",
          "Design principles: SOLID, composition over inheritance, low coupling.",
          "Extensibility: when a new requirement arrives, how much has to change?",
          "Correctness: are edge cases, invalid states and concurrency handled?",
          "Communication: can you explain trade-offs and take hints?"
        ]
      },
      {
        heading: "Step 1: Clarify requirements (5 minutes)",
        text: "Never start with classes. Treat the prompt as deliberately vague and ask questions until the scope is small enough to finish. Cover who the actors are, the core operations, the scale (single machine or distributed), what is explicitly out of scope, and any non-functional needs such as concurrency or extensibility.\n\nThen write the requirements down as a short numbered list and confirm it with the interviewer. Group them as core behaviour, concurrency or correctness, and extensibility. That list drives everything that follows: each requirement later gets its own design step.",
        note: "Ask about the things that change the design: \"Can two users book the same seat at once?\" matters; \"What colour is the button?\" does not."
      },
      {
        heading: "Step 2: Identify core entities (3 minutes)",
        text: "Read your requirements and underline the nouns. Each noun is a candidate entity. Keep the ones that have state or behaviour that matters, merge duplicates, and discard things that are just attributes. Write the final list: for a parking lot that might be ParkingLot, Floor, Spot, Vehicle, Ticket and Payment.\n\nA useful check: could this entity be a field on another class? If it has no behaviour of its own and nothing else refers to it, it probably should be."
      },
      {
        heading: "Step 3: Define relationships (3 minutes)",
        text: "Decide how entities relate: who owns whom, who refers to whom, and multiplicities. Is it composition or aggregation? One-to-many? A sketch of the class diagram makes this concrete. This is also where you decide what is an interface and what is a concrete class: anything with several interchangeable implementations is a candidate for an interface."
      },
      {
        heading: "Step 4: Design classes and APIs, one requirement at a time (15 minutes)",
        text: "Walk through the requirements in order. For each, show the classes involved, their fields and key methods, and write enough code to make the behaviour unambiguous. Prefer to write the public API first (method signatures), then fill in the body only where the logic is interesting.\n\nTwo habits keep this step clean. First, put behaviour with the data it uses: a Floor finds its own free spot rather than ParkingLot reaching into every Spot. Second, keep the entry point thin: a single service or facade class that exposes the use cases and delegates to the model.",
        code: [
          {
            file: "ParkingLotService.java",
            body: `public class ParkingLotService {
  private final ParkingLot lot;
  private final SpotAllocationStrategy allocation;
  private final PricingStrategy pricing;

  public Ticket park(Vehicle vehicle) {
    Spot spot = allocation.find(lot, vehicle.type())
        .orElseThrow(() -> new LotFullException(vehicle.type()));
    spot.assign(vehicle);
    return new Ticket(spot, vehicle, Instant.now());
  }

  public Receipt exit(Ticket ticket) {
    Money fee = pricing.fareFor(ticket, Instant.now());
    ticket.spot().release();
    return new Receipt(ticket, fee);
  }
}`
          }
        ]
      },
      {
        heading: "Step 5: Apply patterns only where justified",
        text: "Patterns are tools, not decorations. Reach for one when you can name the problem it solves in this design: pricing rules that vary (Strategy), an object with a lifecycle (State), notifying many listeners (Observer), constructing something complex (Builder). If you cannot say what breaks without the pattern, leave it out. Interviewers notice forced patterns just as readily as missing ones."
      },
      {
        heading: "Step 6: Concurrency and extensibility",
        text: "Spend the time you saved on the hard parts. For extensibility, take the extensibility requirements and show that each is a new class rather than an edit: a new payment method, a new vehicle type, a new pricing rule. For concurrency, identify shared mutable state, decide the unit of locking (per seat, per account, per row), and explain how you avoid deadlock (for example, always lock in a consistent order) and what happens when a lock expires or a request is retried."
      },
      {
        heading: "Step 7: Deep dive and wrap-up (remaining time)",
        text: "The interviewer will pick something and push: what if there are multiple servers, how would you test this, what if requirement X changes. Answer by stating the trade-off, naming the alternatives, and committing to one with a reason. If you realise a mistake, say so and fix it; adjusting a design in response to a new constraint is a positive signal."
      },
      {
        heading: "Time budget for a 45-minute round",
        text: "Treat these as rough guides. If requirements run long, shorten the code, not the thinking.",
        bullets: [
          "0 to 5 min: clarify requirements and write them down.",
          "5 to 8 min: list entities.",
          "8 to 11 min: relationships and class diagram sketch.",
          "11 to 30 min: design and code per requirement, core flow first.",
          "30 to 38 min: extensibility and concurrency.",
          "38 to 45 min: deep dive questions, trade-offs, and testing."
        ]
      },
      {
        heading: "Worked mini-example: a rate limiter",
        text: "Prompt: \"Design a rate limiter.\" Requirements after clarifying: limit requests per user key, configurable limit and window, thread-safe, and the algorithm must be swappable (extensibility). Entities: `RateLimiter`, `RateLimitConfig`, and an algorithm abstraction. Relationships: a `RateLimiter` has one `RateLimitStrategy` per configuration. Design: the public API is a single method `boolean allow(String key)`. Extensibility maps to the Strategy pattern (token bucket, sliding window) because the interviewer explicitly asked for swappable algorithms. Concurrency: state is per key, so lock per key (or use atomic counters) rather than one global lock. The deep dive is likely distributed limiting, which means moving state to a shared store.",
        code: [
          {
            file: "RateLimiter.java",
            body: `public interface RateLimitStrategy {
  boolean tryAcquire(String key, Instant now);
}

public class RateLimiter {
  private final RateLimitStrategy strategy;
  private final Clock clock;                  // injected for testability

  public RateLimiter(RateLimitStrategy strategy, Clock clock) {
    this.strategy = strategy;
    this.clock = clock;
  }

  public boolean allow(String key) {
    return strategy.tryAcquire(key, clock.instant());
  }
}

public class TokenBucketStrategy implements RateLimitStrategy {
  private final ConcurrentHashMap<String, Bucket> buckets = new ConcurrentHashMap<>();
  private final int capacity;
  private final double refillPerSecond;

  public boolean tryAcquire(String key, Instant now) {
    Bucket b = buckets.computeIfAbsent(key, k -> new Bucket(capacity, now));
    synchronized (b) {                         // lock per key, not global
      b.refill(now, refillPerSecond, capacity);
      return b.tryTake();
    }
  }
}`
          }
        ]
      },
      {
        heading: "Checklist before you say \"done\"",
        text: "Run through this in your head in the last minute of the design phase.",
        bullets: [
          "Requirements are written down and agreed.",
          "Every requirement has a corresponding class or method in the design.",
          "Each class has one clear responsibility and no public mutable state.",
          "Behaviour that varies is behind an interface; new variants are new classes.",
          "Invalid states are rejected (null checks, illegal transitions, over-capacity).",
          "Shared mutable state has a locking strategy.",
          "Dependencies are injected, including clocks and ID generators, so the code is testable.",
          "You can explain at least one trade-off you made and one thing you would change given more time."
        ]
      }
    ],
    takeaways: [
      "Requirements first, always. Classes come after you have agreed scope.",
      "Entities come from nouns; behaviour belongs with the data it uses.",
      "Design one requirement at a time, core flow first.",
      "Use a pattern only when you can name the problem it solves here.",
      "Extensibility means new classes, not edited switch statements.",
      "Name the unit of locking for concurrency and explain how deadlock is avoided.",
      "Communicate trade-offs; the reasoning matters more than the final diagram."
    ],
    pitfalls: [
      "Jumping straight into code without clarifying requirements.",
      "Designing for every possible feature instead of the agreed scope (YAGNI).",
      "Creating a god class that every other class talks to.",
      "Forcing design patterns to look sophisticated.",
      "Ignoring concurrency when the problem has shared resources such as seats or balances.",
      "Running out of time before reaching the interesting part of the problem.",
      "Defending a design when the interviewer's hint shows a flaw."
    ],
    interviewQs: [
      { q: "What is the first thing you do when you get a LLD question?", a: "Ask clarifying questions to define scope: who the actors are, the core operations, scale, what is out of scope, and non-functional needs like concurrency and extensibility. Then write the requirements down and confirm them before designing anything." },
      { q: "How do you decide which design patterns to use?", a: "Start from the requirements, not the pattern list. If a requirement says behaviour must vary or be added later (payment methods, pricing rules), that points to Strategy. If an object has a lifecycle, State. If many parties react to an event, Observer. If you cannot name the requirement the pattern serves, do not use it." },
      { q: "How do you handle concurrency in a LLD answer?", a: "Identify the shared mutable state, choose the smallest sensible unit of locking (per seat or per account, not global), acquire locks in a consistent order to avoid deadlock, and explain what happens on timeouts and retries. Mention how it would change if the system were distributed, for example a lock service such as Redis." },
      { q: "What if you do not know the domain, for example a stock exchange?", a: "Ask the interviewer to explain the essentials and state your assumptions out loud. Interviewers are testing modelling and communication, not domain trivia. Define the minimum concepts you need (orders, order book, matching) and design around them." }
    ],
    related: ["class-diagram", "sequence-diagram", "solid-summary", "strategy", "parking-lot", "movie-ticket-booking"]
  }
);
