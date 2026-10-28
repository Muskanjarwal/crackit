window.PATTERNS = window.PATTERNS || [];
window.PATTERNS.push(
  {
    id: "strategy",
    name: "Strategy",
    category: "behavioral",
    difficulty: "easy",
    understanding: "Strategy defines a family of interchangeable algorithms behind one interface, so the code that uses them can pick or swap one at runtime without knowing how any of them work.",
    problem: {
      intro: "You are asked to design the checkout of a ride-hailing app. Fare calculation looks simple until the interviewer starts adding rules.",
      dialogue: [
        { who: "you", text: "How is the fare calculated today?" },
        { who: "int", text: "Base fare plus distance. But surge pricing is coming next month, and the airport has flat-rate pricing." },
        { who: "you", text: "Will pricing rules change per city or per ride type?" },
        { who: "int", text: "Yes. Product wants to add new rules every few weeks without touching the booking flow." },
        { who: "you", text: "So adding a rule should not risk breaking existing ones." },
        { who: "int", text: "Exactly." }
      ],
      requirements: [
        "Compute a fare for a ride using different pricing rules (standard, surge, flat-rate).",
        "Choose the rule per ride at runtime.",
        "Adding a new rule must not modify existing booking code."
      ]
    },
    badApproach: {
      text: "The first instinct is a single method with a branch per pricing type.",
      code: "class FareCalculator {\n  double calculate(Ride ride, String type) {\n    if (type.equals(\"STANDARD\")) {\n      return 50 + ride.km() * 12;\n    } else if (type.equals(\"SURGE\")) {\n      return (50 + ride.km() * 12) * ride.surgeMultiplier();\n    } else if (type.equals(\"AIRPORT\")) {\n      return 450;\n    }\n    throw new IllegalArgumentException(type);\n  }\n}",
      why: [
        "Every new rule edits this method, which violates Open/Closed.",
        "Rules share one file, so a bug in one can break all of them.",
        "String type codes are easy to mistype and hard to test in isolation."
      ]
    },
    design: [
      {
        heading: "Extract the algorithm behind an interface",
        text: "Pull the thing that varies, the pricing calculation, into its own interface. Callers depend only on this contract.",
        code: [
          { file: "PricingStrategy.java", body: "public interface PricingStrategy {\n  Money fareFor(Ride ride);\n}" }
        ]
      },
      {
        heading: "One class per rule",
        text: "Each rule is a small, independently testable class. A new rule is a new file, with no edits to the others.",
        code: [
          { file: "StandardPricing.java", body: "public class StandardPricing implements PricingStrategy {\n  public Money fareFor(Ride ride) {\n    return Money.of(50).plus(Money.of(12).times(ride.km()));\n  }\n}" },
          { file: "SurgePricing.java", body: "public class SurgePricing implements PricingStrategy {\n  private final PricingStrategy base;\n  private final double multiplier;\n\n  public SurgePricing(PricingStrategy base, double multiplier) {\n    this.base = base;\n    this.multiplier = multiplier;\n  }\n\n  public Money fareFor(Ride ride) {\n    return base.fareFor(ride).times(multiplier);\n  }\n}" },
          { file: "FlatRatePricing.java", body: "public class FlatRatePricing implements PricingStrategy {\n  private final Money flat;\n  public FlatRatePricing(Money flat) { this.flat = flat; }\n  public Money fareFor(Ride ride) { return flat; }\n}" }
        ],
        note: "`SurgePricing` wraps another strategy. That is composition: surge is a modifier on top of a base rule, not a copy of it."
      },
      {
        heading: "The context holds a strategy and delegates",
        text: "The class that needs a fare owns a reference to the interface and never branches on the concrete type.",
        code: [
          { file: "RideService.java", body: "public class RideService {\n  private final PricingStrategy pricing;\n\n  public RideService(PricingStrategy pricing) {\n    this.pricing = pricing;\n  }\n\n  public Receipt complete(Ride ride) {\n    Money fare = pricing.fareFor(ride);\n    return new Receipt(ride, fare);\n  }\n}" }
        ]
      }
    ],
    usage: {
      text: "Selecting the strategy is a separate concern. Keep it at the edge of the system, in configuration or a small factory, not inside `RideService`.",
      code: [
        { file: "Main.java", body: "PricingStrategy standard = new StandardPricing();\nPricingStrategy surge    = new SurgePricing(standard, 1.8);\n\nRideService service = new RideService(isPeakHour() ? surge : standard);\nservice.complete(ride);" }
      ]
    },
    whenToUse: [
      "You have several ways to do the same job and need to switch between them.",
      "You see a growing if/else or switch on a type code.",
      "You want to test each algorithm in isolation.",
      "Behaviour should be chosen at runtime, e.g. per user, city or feature flag."
    ],
    whenNotToUse: [
      "There are only two stable variants and no growth expected.",
      "The algorithms differ by a single constant; use a parameter instead.",
      "A lambda or function reference does the job and a named class adds ceremony."
    ],
    mistakes: [
      "Putting strategy selection logic back inside the context, recreating the if/else.",
      "Letting strategies reach into the context's private state. Pass in what they need.",
      "Making the interface too wide, so implementations throw UnsupportedOperationException.",
      "Forcing Strategy in just to name-drop a pattern. Design patterns are good to have, but don't force one in just to impress the interviewer."
    ],
    deepDive: [
      {
        title: "Strategy vs State",
        text: "The class diagrams are identical, but the intent differs. With Strategy the **client** chooses the algorithm and it rarely changes during the object's life. With State the **object itself** changes its behaviour as its internal state transitions. If implementations know about each other and trigger transitions, you are looking at State."
      },
      {
        title: "Strategies as lambdas",
        text: "When the interface has a single method, a lambda is often enough and removes boilerplate. Reach for named classes once a strategy needs its own fields, dependencies or tests.",
        code: [
          { file: "Lambda.java", body: "PricingStrategy standard = ride -> Money.of(50).plus(Money.of(12).times(ride.km()));\nPricingStrategy airport  = ride -> Money.of(450);" }
        ]
      }
    ],
    usedIn: [
      "Parking Lot: spot-allocation and pricing strategies.",
      "Rate Limiter: token bucket vs sliding window.",
      "Splitwise: equal, exact and percentage splits.",
      "LRU Cache: pluggable eviction policy."
    ],
    related: ["state", "template-method", "decorator"]
  },
  {
    id: "observer",
    name: "Observer",
    category: "behavioral",
    difficulty: "easy",
    understanding: "Observer lets one object, the subject, notify any number of dependents, the observers, when its state changes, without the subject knowing who they are or what they do with the news.",
    problem: {
      intro: "You are designing price-drop alerts for a shopping app. Users watch products and want to hear when the price falls.",
      dialogue: [
        { who: "you", text: "How do users want to be notified?" },
        { who: "int", text: "Email and push today. SMS and a Slack integration are on the roadmap." },
        { who: "you", text: "Does the product code need to know which channels a user picked?" },
        { who: "int", text: "Ideally not. The catalog team owns Product and they don't want to touch it every time marketing adds a channel." },
        { who: "you", text: "And users can stop watching at any time?" },
        { who: "int", text: "Yes, and a product can have thousands of watchers." }
      ],
      requirements: [
        "When a product's price changes, every watcher is told the old and new price.",
        "Watchers can subscribe and unsubscribe at runtime.",
        "Adding a new notification channel must not modify Product."
      ]
    },
    badApproach: {
      text: "The direct approach is to have Product call each notification service itself.",
      code: "class Product {\n  private Money price;\n  private final EmailService email;\n  private final PushService push;\n\n  void setPrice(Money newPrice) {\n    Money old = this.price;\n    this.price = newPrice;\n    if (newPrice.lessThan(old)) {\n      email.sendPriceDrop(this, old, newPrice);\n      push.sendPriceDrop(this, old, newPrice);\n      // add SmsService here next quarter...\n    }\n  }\n}",
      why: [
        "Product depends on every channel, so catalog code changes whenever marketing adds one.",
        "Product cannot be tested without mocking all channels.",
        "There is no way to attach a per-user watcher; the recipients are hard-wired."
      ]
    },
    design: [
      {
        heading: "Define the observer contract",
        text: "Observers share a tiny interface. The subject only ever talks to this type.",
        code: [
          { file: "PriceObserver.java", body: "public interface PriceObserver {\n  void onPriceChanged(Product product, Money oldPrice, Money newPrice);\n}" }
        ]
      },
      {
        heading: "Make the subject manage subscriptions",
        text: "Product keeps a list of observers and exposes subscribe and unsubscribe. Notification happens after the state change is complete, so observers always see a consistent object.",
        code: [
          { file: "Product.java", body: "public class Product {\n  private final String id;\n  private Money price;\n  private final List<PriceObserver> observers = new CopyOnWriteArrayList<>();\n\n  public void subscribe(PriceObserver o)   { observers.add(o); }\n  public void unsubscribe(PriceObserver o) { observers.remove(o); }\n\n  public void setPrice(Money newPrice) {\n    Money old = this.price;\n    this.price = newPrice;\n    if (!newPrice.equals(old)) {\n      notifyObservers(old, newPrice);\n    }\n  }\n\n  private void notifyObservers(Money old, Money neu) {\n    for (PriceObserver o : observers) {\n      o.onPriceChanged(this, old, neu);\n    }\n  }\n}" }
        ],
        note: "`CopyOnWriteArrayList` lets an observer unsubscribe itself from inside a callback without a `ConcurrentModificationException`."
      },
      {
        heading: "One class per channel",
        text: "Each channel is an observer. Product has no idea they exist.",
        code: [
          { file: "EmailAlert.java", body: "public class EmailAlert implements PriceObserver {\n  private final EmailService email;\n  private final User user;\n\n  public EmailAlert(EmailService email, User user) {\n    this.email = email;\n    this.user = user;\n  }\n\n  public void onPriceChanged(Product p, Money oldPrice, Money newPrice) {\n    if (newPrice.lessThan(oldPrice)) {\n      email.sendPriceDrop(user, p, oldPrice, newPrice);\n    }\n  }\n}" },
          { file: "PushAlert.java", body: "public class PushAlert implements PriceObserver {\n  private final PushService push;\n  private final User user;\n\n  public PushAlert(PushService push, User user) {\n    this.push = push;\n    this.user = user;\n  }\n\n  public void onPriceChanged(Product p, Money oldPrice, Money newPrice) {\n    push.send(user, p.id(), newPrice);\n  }\n}" }
        ]
      }
    ],
    usage: {
      text: "Wiring happens where the user chooses to watch. A new channel is a new class plus one extra subscribe call.",
      code: [
        { file: "WatchService.java", body: "public void watch(User user, Product product) {\n  product.subscribe(new EmailAlert(email, user));\n  if (user.pushEnabled()) {\n    product.subscribe(new PushAlert(push, user));\n  }\n}\n\n// catalog side, unchanged by any of the above\nproduct.setPrice(Money.of(799));" }
      ]
    },
    whenToUse: [
      "A change in one object must trigger reactions in an unknown or changing set of others.",
      "You want publishers decoupled from consumers.",
      "The set of listeners changes at runtime.",
      "Building event systems, UI listeners, or live dashboards."
    ],
    whenNotToUse: [
      "There is exactly one fixed dependent; a direct call is clearer.",
      "Order of reactions matters and must be guaranteed; use an explicit pipeline.",
      "You need durable, cross-process delivery; reach for a message queue instead."
    ],
    mistakes: [
      "Forgetting to unsubscribe, so observers are kept alive by the subject and leak memory.",
      "Notifying before the subject's state is fully updated, so observers see a half-changed object.",
      "Doing slow work (network calls) inside the callback on the caller's thread.",
      "Letting an exception from one observer stop the others from being notified."
    ],
    deepDive: [
      {
        title: "Push vs pull notifications",
        text: "In the push model the subject sends the changed data in the callback, as above. It is simple and observers need no reference back, but the subject must guess what everyone wants. In the pull model the subject only says 'I changed' and observers query what they need. Pull is flexible but couples observers to the subject's getters. Pass a small immutable event object as a middle ground."
      },
      {
        title: "Synchronous vs asynchronous delivery",
        text: "A synchronous loop means one slow or failing observer delays every other one, and the `setPrice` caller. For anything that touches the network, hand the event to an executor or queue and isolate failures per observer.",
        code: [
          { file: "SafeNotify.java", body: "private void notifyObservers(Money old, Money neu) {\n  for (PriceObserver o : observers) {\n    executor.submit(() -> {\n      try {\n        o.onPriceChanged(this, old, neu);\n      } catch (Exception e) {\n        log.warn(\"observer failed\", e);\n      }\n    });\n  }\n}" }
        ]
      }
    ],
    usedIn: [
      "Notification Service: fan-out to email, SMS and push channels.",
      "Stock ticker or order-status tracking with multiple listeners.",
      "Logging Framework: appenders listening for log events.",
      "Any UI or game event system."
    ],
    related: ["mediator", "command", "chain-of-responsibility"]
  },
  {
    id: "state",
    name: "State",
    category: "behavioral",
    difficulty: "medium",
    understanding: "State lets an object change its behaviour when its internal state changes, by moving each state's behaviour into its own class and delegating to the current one, so the object appears to change class.",
    problem: {
      intro: "You are designing the order lifecycle for an e-commerce platform. Which actions are legal depends entirely on where the order is in its journey.",
      dialogue: [
        { who: "you", text: "What states can an order be in?" },
        { who: "int", text: "Placed, paid, shipped, delivered and cancelled." },
        { who: "you", text: "Are all actions valid in all states? Can I ship an unpaid order?" },
        { who: "int", text: "No. You can only ship a paid order, and you can cancel before shipping but not after." },
        { who: "you", text: "What happens if someone tries an illegal action?" },
        { who: "int", text: "Reject it clearly. And we expect more states, like returned and refunded, later." }
      ],
      requirements: [
        "An order supports pay, ship, deliver and cancel.",
        "Each action is only valid in specific states and otherwise rejected.",
        "New states must be addable without rewriting every method."
      ]
    },
    badApproach: {
      text: "Store the status as an enum and check it inside every method.",
      code: "class Order {\n  private Status status = Status.PLACED;\n\n  void pay() {\n    if (status == Status.PLACED) status = Status.PAID;\n    else throw new IllegalStateException(\"cannot pay\");\n  }\n\n  void ship() {\n    if (status == Status.PAID) status = Status.SHIPPED;\n    else throw new IllegalStateException(\"cannot ship\");\n  }\n\n  void cancel() {\n    if (status == Status.PLACED || status == Status.PAID) status = Status.CANCELLED;\n    else throw new IllegalStateException(\"cannot cancel\");\n  }\n}",
      why: [
        "Every new state touches every method, and it's easy to miss one.",
        "The rules for a single state are scattered across the class.",
        "Conditionals multiply as states and actions grow, a state-by-action matrix hidden in if statements."
      ]
    },
    design: [
      {
        heading: "One interface for every action",
        text: "The state interface lists every action the context supports. Each state implements all of them: either performing the action or rejecting it.",
        code: [
          { file: "OrderState.java", body: "public interface OrderState {\n  void pay(Order order);\n  void ship(Order order);\n  void deliver(Order order);\n  void cancel(Order order);\n}" }
        ]
      },
      {
        heading: "Concrete states own their rules",
        text: "Each class answers one question: what happens in this state? Legal actions perform the transition; everything else is rejected.",
        code: [
          { file: "PlacedState.java", body: "public class PlacedState implements OrderState {\n  public void pay(Order order)     { order.setState(new PaidState()); }\n  public void ship(Order order)    { throw new IllegalStateException(\"Pay first\"); }\n  public void deliver(Order order) { throw new IllegalStateException(\"Not shipped\"); }\n  public void cancel(Order order)  { order.setState(new CancelledState()); }\n}" },
          { file: "PaidState.java", body: "public class PaidState implements OrderState {\n  public void pay(Order order)     { throw new IllegalStateException(\"Already paid\"); }\n  public void ship(Order order)    { order.setState(new ShippedState()); }\n  public void deliver(Order order) { throw new IllegalStateException(\"Not shipped\"); }\n  public void cancel(Order order) {\n    order.refund();\n    order.setState(new CancelledState());\n  }\n}" },
          { file: "ShippedState.java", body: "public class ShippedState implements OrderState {\n  public void pay(Order order)     { throw new IllegalStateException(\"Already paid\"); }\n  public void ship(Order order)    { throw new IllegalStateException(\"Already shipped\"); }\n  public void deliver(Order order) { order.setState(new DeliveredState()); }\n  public void cancel(Order order)  { throw new IllegalStateException(\"Too late to cancel\"); }\n}" }
        ]
      },
      {
        heading: "The context delegates",
        text: "Order holds the current state and forwards every call. It has no conditionals on status.",
        code: [
          { file: "Order.java", body: "public class Order {\n  private OrderState state = new PlacedState();\n\n  public void pay()     { state.pay(this); }\n  public void ship()    { state.ship(this); }\n  public void deliver() { state.deliver(this); }\n  public void cancel()  { state.cancel(this); }\n\n  void setState(OrderState next) { this.state = next; }\n  void refund() { /* call payment gateway */ }\n}" }
        ],
        note: "`setState` is package-private on purpose. Only the state classes should drive transitions, not outside callers."
      }
    ],
    usage: {
      text: "The caller just invokes actions. Illegal ones fail loudly because the current state refuses them.",
      code: [
        { file: "Main.java", body: "Order order = new Order();\norder.pay();      // Placed -> Paid\norder.ship();     // Paid   -> Shipped\norder.cancel();   // throws: Too late to cancel" }
      ]
    },
    whenToUse: [
      "An object's behaviour depends on its state and changes at runtime.",
      "You have big conditionals that switch on a status field in many methods.",
      "The state machine is expected to grow: vending machines, ATMs, order or ticket lifecycles.",
      "You want each state's rules in one place for review and testing."
    ],
    whenNotToUse: [
      "Only two or three states with trivial behaviour; an enum and a switch is clearer.",
      "States only differ by data, not behaviour.",
      "Transitions are driven by a large declarative table or a workflow engine."
    ],
    mistakes: [
      "Letting external callers call `setState` and bypass the transition rules.",
      "Forgetting to reject illegal actions, so they silently do nothing.",
      "Giving state classes their own mutable data that should live in the context.",
      "Using State when the client picks the behaviour once and never changes it; that is Strategy."
    ],
    deepDive: [
      {
        title: "Who decides the next state?",
        text: "Here each state names its successor, which keeps rules local and is easy to extend. The alternative is to centralise transitions in the context or a transition table. That gives you one place to see the whole machine, which is better when many states share transitions, at the cost of the context knowing every state. Pick the first for behaviour-heavy states and the second for large, mostly data-driven machines."
      },
      {
        title: "Stateless states can be shared",
        text: "If a state holds no fields, create it once and reuse it instead of allocating on every transition. An enum with behaviour is a neat way to do this.",
        code: [
          { file: "OrderState.java", body: "public enum OrderState {\n  PLACED {\n    OrderState pay()    { return PAID; }\n    OrderState cancel() { return CANCELLED; }\n  },\n  PAID {\n    OrderState ship()   { return SHIPPED; }\n    OrderState cancel() { return CANCELLED; }\n  },\n  SHIPPED   { OrderState deliver() { return DELIVERED; } },\n  DELIVERED {},\n  CANCELLED {};\n\n  OrderState pay()     { throw illegal(\"pay\"); }\n  OrderState ship()    { throw illegal(\"ship\"); }\n  OrderState deliver() { throw illegal(\"deliver\"); }\n  OrderState cancel()  { throw illegal(\"cancel\"); }\n\n  private IllegalStateException illegal(String action) {\n    return new IllegalStateException(action + \" not allowed in \" + this);\n  }\n}" }
        ]
      }
    ],
    usedIn: [
      "Vending Machine: idle, has money, dispensing, out of stock.",
      "Elevator System: moving up, moving down, idle, door open.",
      "BookMyShow: seat and booking statuses.",
      "ATM and traffic-light style machines."
    ],
    related: ["strategy", "memento", "command"]
  },
  {
    id: "command",
    name: "Command",
    category: "behavioral",
    difficulty: "medium",
    understanding: "Command turns a request into a standalone object holding everything needed to perform it, so requests can be queued, logged, passed around and undone.",
    problem: {
      intro: "You are designing the editing core of a text editor. Typing, deleting and pasting all need to be undoable and redoable.",
      dialogue: [
        { who: "you", text: "What actions need undo?" },
        { who: "int", text: "Inserting text and deleting a range, for now. Formatting commands come later." },
        { who: "you", text: "Is redo needed too?" },
        { who: "int", text: "Yes, and a new edit after an undo should clear the redo history." },
        { who: "you", text: "Will the same actions be triggered from several places, like menus and shortcuts?" },
        { who: "int", text: "Menu, keyboard and a macro recorder. They shouldn't each reimplement the logic." }
      ],
      requirements: [
        "Every edit is an operation that can be executed and undone.",
        "The editor supports unlimited undo and redo.",
        "Menus, shortcuts and macros trigger the same operations without duplicating logic."
      ]
    },
    badApproach: {
      text: "Wire each button directly to editor methods, and bolt undo on with ad-hoc snapshots.",
      code: "class Editor {\n  private StringBuilder text = new StringBuilder();\n  private final Deque<String> history = new ArrayDeque<>();\n\n  void insert(int pos, String s) {\n    history.push(text.toString());   // full copy every time\n    text.insert(pos, s);\n  }\n\n  void delete(int from, int to) {\n    history.push(text.toString());\n    text.delete(from, to);\n  }\n\n  void undo() { text = new StringBuilder(history.pop()); }\n}",
      why: [
        "Copies the whole document on every keystroke, which is wasteful for large files.",
        "Redo is impossible without more bookkeeping.",
        "Callers invoke editor methods directly, so there is nothing to queue, log or replay as a macro."
      ]
    },
    design: [
      {
        heading: "The command interface",
        text: "A command knows how to do something and how to undo it. That is the whole contract.",
        code: [
          { file: "Command.java", body: "public interface Command {\n  void execute();\n  void undo();\n}" }
        ]
      },
      {
        heading: "Concrete commands carry their own data",
        text: "Each command stores the receiver and just enough information to reverse itself. Storing a delta is far cheaper than storing a snapshot.",
        code: [
          { file: "InsertCommand.java", body: "public class InsertCommand implements Command {\n  private final Document doc;\n  private final int pos;\n  private final String text;\n\n  public InsertCommand(Document doc, int pos, String text) {\n    this.doc = doc;\n    this.pos = pos;\n    this.text = text;\n  }\n\n  public void execute() { doc.insert(pos, text); }\n  public void undo()    { doc.delete(pos, pos + text.length()); }\n}" },
          { file: "DeleteCommand.java", body: "public class DeleteCommand implements Command {\n  private final Document doc;\n  private final int from, to;\n  private String removed;   // captured on execute so we can restore it\n\n  public DeleteCommand(Document doc, int from, int to) {\n    this.doc = doc;\n    this.from = from;\n    this.to = to;\n  }\n\n  public void execute() {\n    removed = doc.substring(from, to);\n    doc.delete(from, to);\n  }\n\n  public void undo() { doc.insert(from, removed); }\n}" }
        ]
      },
      {
        heading: "The invoker keeps history",
        text: "The editor runs commands and maintains two stacks. It never needs to know what a command does.",
        code: [
          { file: "CommandHistory.java", body: "public class CommandHistory {\n  private final Deque<Command> undoStack = new ArrayDeque<>();\n  private final Deque<Command> redoStack = new ArrayDeque<>();\n\n  public void run(Command c) {\n    c.execute();\n    undoStack.push(c);\n    redoStack.clear();          // a new edit invalidates redo\n  }\n\n  public void undo() {\n    if (undoStack.isEmpty()) return;\n    Command c = undoStack.pop();\n    c.undo();\n    redoStack.push(c);\n  }\n\n  public void redo() {\n    if (redoStack.isEmpty()) return;\n    Command c = redoStack.pop();\n    c.execute();\n    undoStack.push(c);\n  }\n}" }
        ],
        note: "Clearing the redo stack on a fresh command is a rule interviewers like to hear you state out loud."
      }
    ],
    usage: {
      text: "Every trigger, whether menu, shortcut or macro, builds a command and hands it to the same history.",
      code: [
        { file: "Main.java", body: "Document doc = new Document();\nCommandHistory history = new CommandHistory();\n\nhistory.run(new InsertCommand(doc, 0, \"Hello\"));\nhistory.run(new InsertCommand(doc, 5, \" world\"));\nhistory.undo();   // removes \" world\"\nhistory.redo();   // puts it back" }
      ]
    },
    whenToUse: [
      "You need undo/redo.",
      "Requests must be queued, scheduled, retried or logged.",
      "You want to decouple whoever triggers an action from whoever performs it.",
      "Building macro recorders, job queues or transactional operations."
    ],
    whenNotToUse: [
      "A simple callback is enough and nothing needs undoing or queuing.",
      "The operation can't be reversed and you don't need to log it.",
      "Wrapping every method call in a class would just add boilerplate."
    ],
    mistakes: [
      "Storing a full document snapshot per command instead of a delta.",
      "Forgetting to capture state at execute time, so undo restores the wrong data.",
      "Not clearing the redo stack after a new command.",
      "Putting business logic in the command instead of the receiver, turning commands into God objects."
    ],
    deepDive: [
      {
        title: "Macro commands",
        text: "A composite command runs a list of commands as one unit, and undoes them in reverse order. That gives you macros and 'replace all' as a single undo step.",
        code: [
          { file: "MacroCommand.java", body: "public class MacroCommand implements Command {\n  private final List<Command> commands;\n\n  public MacroCommand(List<Command> commands) { this.commands = commands; }\n\n  public void execute() { commands.forEach(Command::execute); }\n\n  public void undo() {\n    for (int i = commands.size() - 1; i >= 0; i--) {\n      commands.get(i).undo();\n    }\n  }\n}" }
        ]
      },
      {
        title: "Bounding history and merging keystrokes",
        text: "Unbounded undo history eats memory, so cap the stack size and drop the oldest entries. Editors also merge consecutive single-character inserts into one command so that undo removes a word, not a letter. Give commands an optional `mergeWith(Command other)` that returns true when they can coalesce."
      }
    ],
    usedIn: [
      "Text editor or drawing app: undo and redo.",
      "Task or job queues that execute work later.",
      "Smart-home remotes and macro recorders.",
      "Transactional operations that must be rolled back."
    ],
    related: ["memento", "chain-of-responsibility", "strategy"]
  },
  {
    id: "chain-of-responsibility",
    name: "Chain of Responsibility",
    category: "behavioral",
    difficulty: "medium",
    understanding: "Chain of Responsibility passes a request along a line of handlers, where each one either handles it or forwards it to the next, so the sender doesn't need to know which handler will act.",
    problem: {
      intro: "You are designing the cash dispensing logic of an ATM. It must pay out a requested amount using the available note denominations.",
      dialogue: [
        { who: "you", text: "Which denominations does the ATM hold?" },
        { who: "int", text: "2000, 500 and 100 notes." },
        { who: "you", text: "Should it use the largest notes first?" },
        { who: "int", text: "Yes, then fall back to smaller ones for the remainder." },
        { who: "you", text: "What if the amount can't be paid exactly?" },
        { who: "int", text: "Reject it. Also, the bank may add 200 and 50 notes in some regions." }
      ],
      requirements: [
        "Dispense an amount using the fewest, largest notes first.",
        "Each denomination decides how many notes it contributes and passes the rest on.",
        "Adding or removing a denomination must not change existing handlers."
      ]
    },
    badApproach: {
      text: "One method with a block for each denomination, in a fixed order.",
      code: "class Dispenser {\n  void dispense(int amount) {\n    int n2000 = amount / 2000;\n    amount = amount % 2000;\n    int n500 = amount / 500;\n    amount = amount % 500;\n    int n100 = amount / 100;\n    amount = amount % 100;\n    if (amount != 0) throw new IllegalArgumentException(\"invalid amount\");\n    // print n2000, n500, n100 ...\n  }\n}",
      why: [
        "Adding a 200 note means editing the method and re-checking the order.",
        "The denomination logic, ordering and stock tracking are tangled together.",
        "Ignores note stock: it can't fall through to a smaller note when 2000s run out."
      ]
    },
    design: [
      {
        heading: "A handler links to its successor",
        text: "Every handler has the same shape: try to handle, then pass the remainder to the next handler. A small abstract class holds the link.",
        code: [
          { file: "NoteHandler.java", body: "public abstract class NoteHandler {\n  private NoteHandler next;\n\n  public NoteHandler setNext(NoteHandler next) {\n    this.next = next;\n    return next;               // enables fluent chaining\n  }\n\n  public final void handle(int amount) {\n    int remaining = dispenseNotes(amount);\n    if (remaining == 0) return;\n    if (next == null) {\n      throw new IllegalStateException(\"Cannot dispense \" + remaining);\n    }\n    next.handle(remaining);\n  }\n\n  /** Dispenses what it can and returns the amount still owed. */\n  protected abstract int dispenseNotes(int amount);\n}" }
        ]
      },
      {
        heading: "Each denomination is a handler",
        text: "Concrete handlers contain only their own rule: take as many notes as I can, respecting my stock.",
        code: [
          { file: "DenominationHandler.java", body: "public class DenominationHandler extends NoteHandler {\n  private final int value;\n  private int stock;\n\n  public DenominationHandler(int value, int stock) {\n    this.value = value;\n    this.stock = stock;\n  }\n\n  protected int dispenseNotes(int amount) {\n    int count = Math.min(amount / value, stock);\n    if (count > 0) {\n      stock -= count;\n      System.out.println(count + \" x \" + value);\n    }\n    return amount - count * value;\n  }\n}" }
        ]
      },
      {
        heading: "Build the chain at the edge",
        text: "The order of the chain is configuration. Changing denominations or order never touches handler code.",
        code: [
          { file: "Atm.java", body: "public class Atm {\n  private final NoteHandler chain;\n\n  public Atm() {\n    NoteHandler h2000 = new DenominationHandler(2000, 10);\n    NoteHandler h500  = new DenominationHandler(500, 20);\n    NoteHandler h100  = new DenominationHandler(100, 50);\n    h2000.setNext(h500).setNext(h100);\n    this.chain = h2000;\n  }\n\n  public void withdraw(int amount) { chain.handle(amount); }\n}" }
        ],
        note: "The chain mutates stock as it goes. In a real ATM, check feasibility first so a failure part-way doesn't leave notes already dispensed."
      }
    ],
    usage: {
      text: "The caller submits one request to the head of the chain and has no idea how many handlers participate.",
      code: [
        { file: "Main.java", body: "Atm atm = new Atm();\natm.withdraw(4700);\n// 2 x 2000\n// 1 x 500\n// 2 x 100" }
      ]
    },
    whenToUse: [
      "More than one object may handle a request and the handler isn't known upfront.",
      "You want to issue a request without coupling to a specific receiver.",
      "Handlers and their order should be configurable at runtime.",
      "Approval flows, middleware, validation pipelines, logging levels."
    ],
    whenNotToUse: [
      "Exactly one handler is always responsible; call it directly.",
      "You need a guarantee that the request is handled; a chain can fall off the end.",
      "A plain loop over a list of rules is simpler and clearer."
    ],
    mistakes: [
      "Forgetting a terminal case, so an unhandled request silently disappears.",
      "Creating cycles in the chain, which loop forever.",
      "Making handlers depend on their position, so reordering breaks them.",
      "Mutating shared state mid-chain without a way to roll back on failure."
    ],
    deepDive: [
      {
        title: "Stop at first handler vs every handler",
        text: "In the classic form, the first handler that can act does so and the chain stops. In pipeline form (servlet filters, middleware) every handler runs and each decides whether to continue. Both are the same structure; what differs is whether `handle` always calls `next`. State which one you mean before you code it."
      },
      {
        title: "Building the chain from a list",
        text: "Hand-wiring `setNext` is fine for a few handlers. For configurable chains, build it from an ordered list so order lives in config.",
        code: [
          { file: "ChainBuilder.java", body: "static NoteHandler build(List<NoteHandler> handlers) {\n  for (int i = 0; i < handlers.size() - 1; i++) {\n    handlers.get(i).setNext(handlers.get(i + 1));\n  }\n  return handlers.get(0);\n}" }
        ]
      }
    ],
    usedIn: [
      "ATM cash dispensing.",
      "Logging Framework: log levels passing to appenders.",
      "Expense or leave approval by amount thresholds.",
      "Request validation and middleware pipelines."
    ],
    related: ["command", "decorator", "observer"]
  },
  {
    id: "template-method",
    name: "Template Method",
    category: "behavioral",
    difficulty: "easy",
    understanding: "Template Method defines the skeleton of an algorithm in a base class and lets subclasses fill in specific steps, without changing the order or structure of the overall algorithm.",
    problem: {
      intro: "You are designing a report export feature. Users can export the same data as CSV or JSON today, and PDF is expected soon.",
      dialogue: [
        { who: "you", text: "What are the steps of an export?" },
        { who: "int", text: "Fetch the data, format it, write it out, and record an audit entry." },
        { who: "you", text: "Which of those differ between formats?" },
        { who: "int", text: "Only the formatting and the file extension. Fetching and auditing are identical." },
        { who: "you", text: "Must the order always be the same?" },
        { who: "int", text: "Yes. Nobody should be able to skip the audit step." }
      ],
      requirements: [
        "Every export follows the same sequence: fetch, format, write, audit.",
        "Only formatting varies by format.",
        "Subclasses must not be able to reorder or skip the shared steps."
      ]
    },
    badApproach: {
      text: "Each exporter is written independently and copies the common steps.",
      code: "class CsvExporter {\n  void export(Report r) {\n    List<Row> rows = repo.fetch(r.id());\n    String out = toCsv(rows);\n    storage.write(r.id() + \".csv\", out);\n    audit.log(\"exported \" + r.id());\n  }\n}\n\nclass JsonExporter {\n  void export(Report r) {\n    List<Row> rows = repo.fetch(r.id());\n    String out = toJson(rows);\n    storage.write(r.id() + \".json\", out);\n    // someone forgot the audit call here\n  }\n}",
      why: [
        "Shared steps are duplicated, so a fix must be repeated in every exporter.",
        "Nothing enforces the sequence: the JSON exporter already skipped the audit.",
        "Each new format re-implements the whole flow."
      ]
    },
    design: [
      {
        heading: "Put the skeleton in the base class",
        text: "The template method is `final`, so subclasses cannot change the order. It calls abstract steps for the parts that vary and implements the shared parts itself.",
        code: [
          { file: "ReportExporter.java", body: "public abstract class ReportExporter {\n  protected final ReportRepository repo;\n  protected final Storage storage;\n  protected final AuditLog audit;\n\n  protected ReportExporter(ReportRepository repo, Storage storage, AuditLog audit) {\n    this.repo = repo;\n    this.storage = storage;\n    this.audit = audit;\n  }\n\n  // The template method: the order is fixed.\n  public final void export(Report report) {\n    List<Row> rows = repo.fetch(report.id());\n    String content = format(rows);\n    storage.write(report.id() + \".\" + extension(), content);\n    audit.log(\"exported \" + report.id() + \" as \" + extension());\n    afterExport(report);\n  }\n\n  protected abstract String format(List<Row> rows);\n  protected abstract String extension();\n\n  // Hook: optional, does nothing by default.\n  protected void afterExport(Report report) { }\n}" }
        ],
        note: "Abstract methods are steps subclasses must provide. Hooks like `afterExport` are optional extension points with a harmless default."
      },
      {
        heading: "Subclasses supply only what differs",
        text: "A concrete exporter implements the varying steps and nothing else.",
        code: [
          { file: "CsvExporter.java", body: "public class CsvExporter extends ReportExporter {\n  public CsvExporter(ReportRepository r, Storage s, AuditLog a) { super(r, s, a); }\n\n  protected String format(List<Row> rows) {\n    return rows.stream()\n               .map(Row::toCsvLine)\n               .collect(Collectors.joining(\"\\n\"));\n  }\n\n  protected String extension() { return \"csv\"; }\n}" },
          { file: "JsonExporter.java", body: "public class JsonExporter extends ReportExporter {\n  public JsonExporter(ReportRepository r, Storage s, AuditLog a) { super(r, s, a); }\n\n  protected String format(List<Row> rows) {\n    return Json.array(rows.stream().map(Row::toJson).toList());\n  }\n\n  protected String extension() { return \"json\"; }\n\n  @Override\n  protected void afterExport(Report report) {\n    // e.g. notify a downstream consumer that only wants JSON\n  }\n}" }
        ]
      }
    ],
    usage: {
      text: "Callers use the base type. Adding PDF later means one new subclass that implements `format` and `extension`.",
      code: [
        { file: "Main.java", body: "ReportExporter exporter = new CsvExporter(repo, storage, audit);\nexporter.export(report);   // fetch -> format -> write -> audit, always" }
      ]
    },
    whenToUse: [
      "Several classes share the same algorithm structure and differ in a few steps.",
      "You must enforce the order of steps.",
      "You want to avoid duplicating the common parts.",
      "Frameworks that call your code at defined extension points."
    ],
    whenNotToUse: [
      "Variation is large and behaviour should be swapped at runtime; prefer Strategy.",
      "You would need deep inheritance hierarchies to express the variants.",
      "Steps rarely share structure, so the base class would be mostly empty."
    ],
    mistakes: [
      "Forgetting `final` on the template method, so a subclass overrides the whole flow.",
      "Making every step abstract, forcing subclasses to implement trivial defaults.",
      "Calling overridable methods from the base class constructor; subclass fields aren't initialised yet.",
      "Growing the number of hooks until the base class is a configuration maze."
    ],
    deepDive: [
      {
        title: "Template Method vs Strategy",
        text: "Both vary part of an algorithm. Template Method uses **inheritance**: the variation is fixed at compile time by choosing a subclass, and the base class controls the flow. Strategy uses **composition**: the variation is an object you can swap at runtime. If you need to change the variation per call, or a subclass would otherwise have to pick up unrelated behaviour, choose Strategy."
      },
      {
        title: "The Hollywood Principle",
        text: "Template Method inverts control: the base class calls the subclass, not the other way round. 'Don't call us, we'll call you.' This is how frameworks work, from JUnit's setup and teardown to servlet lifecycle methods. You write the steps and the framework owns the sequence."
      }
    ],
    usedIn: [
      "Report or data exporters with a shared pipeline.",
      "Game turns: initialise, play, check win, end.",
      "Test frameworks: setup, run, teardown.",
      "Data migration jobs: extract, transform, load."
    ],
    related: ["strategy", "factory-method", "state"]
  }
);
