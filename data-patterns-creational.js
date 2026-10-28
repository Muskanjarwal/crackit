window.PATTERNS = window.PATTERNS || [];
window.PATTERNS.push(
  {
    id: "singleton",
    name: "Singleton",
    category: "creational",
    difficulty: "easy",
    understanding: "Singleton guarantees a class has exactly one instance and gives the rest of the program a well-defined way to reach it. It earns its place for resources that are genuinely unique, like a connection pool or a configuration registry, and it is also the most over-used pattern in the book.",
    problem: {
      intro: "You are designing the logging module for a payments service. Dozens of classes need to write to the same log file, and the interviewer wants to see how you keep that safe.",
      dialogue: [
        { who: "you", text: "How many places write logs, and do they all write to the same destination?" },
        { who: "int", text: "Every service class logs. All of it goes to one rotating file." },
        { who: "you", text: "So two loggers opening the same file would interleave or corrupt writes?" },
        { who: "int", text: "Yes. There should be one writer that everyone shares." },
        { who: "you", text: "Is the service multi-threaded?" },
        { who: "int", text: "Very. Requests are handled on a thread pool." }
      ],
      requirements: [
        "Exactly one `Logger` instance exists for the whole process.",
        "Any class can obtain it without being handed a reference by hand.",
        "Creation and use are safe when many threads race to get it.",
        "The instance should not be built until it is first needed."
      ]
    },
    badApproach: {
      text: "The textbook lazy singleton looks right in a single-threaded demo and fails the moment two threads call it together.",
      code: `class Logger {
  private static Logger instance;

  private Logger() {
    // opens the log file
  }

  public static Logger getInstance() {
    if (instance == null) {
      instance = new Logger();
    }
    return instance;
  }
}`,
      why: [
        "Two threads can both see `instance == null` and each build a Logger, so two writers open the same file.",
        "The constructor is private, but nothing stops reflection or serialization from creating a second instance.",
        "Callers are glued to `Logger.getInstance()`, so tests cannot substitute a fake."
      ]
    },
    design: [
      {
        heading: "Lock down construction",
        text: "A singleton starts by making sure nobody else can create one. A private constructor handles ordinary callers, and a `final` class stops a subclass from sneaking in a second instance.",
        code: [
          { file: "Logger.java", body: `public final class Logger {
  private final Writer out;

  private Logger() {
    this.out = openRotatingFile("app.log");
  }

  public synchronized void log(String level, String msg) {
    out.write(level + " " + msg);
  }
}` }
        ],
        note: "`log` is `synchronized` because sharing one instance means sharing its state. A singleton makes thread safety of the **object** your problem, not just its creation."
      },
      {
        heading: "Create it lazily and safely with the holder idiom",
        text: "A static nested class is not loaded until it is first referenced. The JVM guarantees class initialization is thread-safe, so you get lazy creation with no explicit locking.",
        code: [
          { file: "Logger.java", body: `public final class Logger {
  private Logger() { /* open file */ }

  private static class Holder {
    static final Logger INSTANCE = new Logger();
  }

  public static Logger getInstance() {
    return Holder.INSTANCE;
  }
}` },
          { file: "Eager.java", body: `// Simplest option: create at class load.
public final class Logger {
  private static final Logger INSTANCE = new Logger();
  private Logger() { }
  public static Logger getInstance() { return INSTANCE; }
}` }
        ]
      },
      {
        heading: "Use an enum when you also need serialization safety",
        text: "Java enums are guaranteed to have one instance per constant, even against reflection and deserialization. For a plain stateless-ish service this is the most robust form.",
        code: [
          { file: "AppConfig.java", body: `public enum AppConfig {
  INSTANCE;

  private final Properties props = load("app.properties");

  public String get(String key) {
    return props.getProperty(key);
  }
}` }
        ]
      },
      {
        heading: "Inject it instead of reaching for it",
        text: "Callers should receive the logger through a constructor and not call `getInstance()` inside business logic. You keep a single instance at runtime while keeping classes testable.",
        code: [
          { file: "PaymentService.java", body: `public class PaymentService {
  private final Logger log;

  public PaymentService(Logger log) {
    this.log = log;
  }

  public void charge(Order order) {
    log.log("INFO", "charging " + order.id());
  }
}` },
          { file: "Main.java", body: `// The one place that knows it is a singleton.
Logger logger = Logger.getInstance();
PaymentService payments = new PaymentService(logger);` }
        ]
      }
    ],
    usage: {
      text: "Wire the singleton at the application's entry point and pass it down. In a framework with dependency injection, declare the bean as singleton-scoped and let the container enforce \"one instance\" instead of a static field.",
      code: [
        { file: "Main.java", body: `Logger logger = Logger.getInstance();

PaymentService payments = new PaymentService(logger);
RefundService refunds   = new RefundService(logger);

// Same instance everywhere
assert logger == Logger.getInstance();` }
      ]
    },
    whenToUse: [
      "Exactly one instance is required for correctness, e.g. a shared file writer or hardware handle.",
      "The resource is expensive to create and safe to share, like a connection pool.",
      "You need a single coordination point such as a registry or ID generator."
    ],
    whenNotToUse: [
      "You only want convenient global access. That is a global variable with extra steps.",
      "The object holds mutable state that tests need to reset between cases.",
      "Different tenants or requests may need different instances later."
    ],
    mistakes: [
      "Writing the unsynchronized lazy version and calling it thread-safe.",
      "Reaching for `getInstance()` deep inside business logic, which hides dependencies and kills testability.",
      "Forgetting that a singleton's mutable fields are shared across all threads and need their own protection.",
      "Using it for things that are not truly unique. Design patterns are good to have, but don't force one in just to impress the interviewer."
    ],
    deepDive: [
      {
        title: "Thread-safe variants compared",
        text: "There are four common ways to get it right, and interviewers like to hear the trade-offs.\n\n**Eager**: simplest and always safe, but creates the instance even if unused.\n\n**Synchronized method**: correct and lazy, but every call pays for the lock.\n\n**Double-checked locking**: lazy with a lock only on the first call, but `instance` must be `volatile` or another thread can see a half-built object.\n\n**Holder idiom or enum**: lazy and lock-free after load, and usually the best default.",
        code: [
          { file: "DoubleChecked.java", body: `public final class Logger {
  private static volatile Logger instance;

  private Logger() { }

  public static Logger getInstance() {
    Logger local = instance;
    if (local == null) {
      synchronized (Logger.class) {
        local = instance;
        if (local == null) {
          instance = local = new Logger();
        }
      }
    }
    return local;
  }
}` }
        ]
      },
      {
        title: "Why Singleton hurts testing",
        text: "A static accessor is a hidden dependency. A test that exercises `PaymentService` will quietly write to the real log and leak state into the next test. Extracting an interface and injecting it, as in step 4, keeps one instance in production while letting a test pass a fake.",
        code: [
          { file: "LogSink.java", body: `public interface LogSink {
  void log(String level, String msg);
}

public final class FileLogger implements LogSink { /* the singleton */ }

class InMemoryLogSink implements LogSink {
  final List<String> lines = new ArrayList<>();
  public void log(String level, String msg) { lines.add(level + " " + msg); }
}` }
        ]
      }
    ],
    usedIn: [
      "Logging Framework: one shared logger or appender manager.",
      "Parking Lot: a single ParkingLot facade instance.",
      "LRU Cache: a process-wide cache manager.",
      "Vending Machine: the single machine's inventory."
    ],
    related: ["factory-method", "flyweight", "facade"]
  },

  {
    id: "factory-method",
    name: "Factory Method",
    category: "creational",
    difficulty: "easy",
    understanding: "Factory Method defines an interface for creating an object but lets subclasses or a dedicated creator decide which concrete class to instantiate, so callers depend on an abstraction instead of a `new` keyword.",
    problem: {
      intro: "You are designing the notification module of an e-commerce app. Orders trigger messages, and the way each message is sent depends on user preference.",
      dialogue: [
        { who: "you", text: "Which channels do we support today?" },
        { who: "int", text: "Email and SMS. Push notifications are planned for next quarter." },
        { who: "you", text: "Does the code that triggers a notification care which channel it is?" },
        { who: "int", text: "It shouldn't. It just says \"notify this user\"." },
        { who: "you", text: "And who decides the channel?" },
        { who: "int", text: "The user's settings. Adding push shouldn't require editing the order flow." }
      ],
      requirements: [
        "Send a notification through email or SMS based on user preference.",
        "The order flow must not reference concrete channel classes.",
        "Adding a new channel must not modify existing order code."
      ]
    },
    badApproach: {
      text: "The order service instantiates whichever channel it needs directly.",
      code: `class OrderService {
  void onOrderPlaced(Order order, User user) {
    Notification n;
    if (user.channel().equals("EMAIL")) {
      n = new EmailNotification(user.email());
    } else if (user.channel().equals("SMS")) {
      n = new SmsNotification(user.phone());
    } else {
      throw new IllegalArgumentException(user.channel());
    }
    n.send("Order " + order.id() + " confirmed");
  }
}`,
      why: [
        "`OrderService` knows every concrete channel, so adding push edits order code.",
        "The same if/else will be copied into refund, shipping and promo flows.",
        "Constructing a channel is mixed with the business rule of when to notify."
      ]
    },
    design: [
      {
        heading: "Define the product interface",
        text: "Start with what every notification can do, regardless of channel. The rest of the system will only ever see this type.",
        code: [
          { file: "Notification.java", body: `public interface Notification {
  void send(String message);
}` }
        ]
      },
      {
        heading: "Implement each concrete product",
        text: "Each channel is its own class with the details it needs. None of them knows about orders.",
        code: [
          { file: "EmailNotification.java", body: `public class EmailNotification implements Notification {
  private final String address;
  public EmailNotification(String address) { this.address = address; }

  public void send(String message) {
    // call SMTP client
  }
}` },
          { file: "SmsNotification.java", body: `public class SmsNotification implements Notification {
  private final String phone;
  public SmsNotification(String phone) { this.phone = phone; }

  public void send(String message) {
    // call SMS gateway
  }
}` }
        ]
      },
      {
        heading: "Declare the factory method on a creator",
        text: "The creator holds the shared workflow and defers one step, which concrete product to build, to a subclass. This is the classic form of the pattern.",
        code: [
          { file: "NotificationCreator.java", body: `public abstract class NotificationCreator {
  // The factory method
  protected abstract Notification create(User user);

  // Shared logic that uses the product
  public void notifyUser(User user, String message) {
    Notification n = create(user);
    n.send(message);
  }
}` },
          { file: "EmailCreator.java", body: `public class EmailCreator extends NotificationCreator {
  protected Notification create(User user) {
    return new EmailNotification(user.email());
  }
}` }
        ],
        note: "In interviews a simpler **static factory** often suffices: one `NotificationFactory.forUser(user)` method with a map or switch. The idea, callers ask for an abstraction, is the same."
      },
      {
        heading: "Make the simple version registry-driven",
        text: "When subclassing a creator per product feels heavy, keep one factory and register builders by key. New channels register themselves without editing the factory.",
        code: [
          { file: "NotificationFactory.java", body: `public class NotificationFactory {
  private final Map<String, Function<User, Notification>> builders = new HashMap<>();

  public void register(String channel, Function<User, Notification> builder) {
    builders.put(channel, builder);
  }

  public Notification forUser(User user) {
    Function<User, Notification> b = builders.get(user.channel());
    if (b == null) throw new IllegalArgumentException("Unknown channel " + user.channel());
    return b.apply(user);
  }
}` }
        ]
      }
    ],
    usage: {
      text: "The order flow asks the factory for a notification and sends. Wiring of concrete classes happens once, at startup.",
      code: [
        { file: "Main.java", body: `NotificationFactory factory = new NotificationFactory();
factory.register("EMAIL", u -> new EmailNotification(u.email()));
factory.register("SMS",   u -> new SmsNotification(u.phone()));

OrderService orders = new OrderService(factory);
// Adding push later:
// factory.register("PUSH", u -> new PushNotification(u.deviceToken()));` },
        { file: "OrderService.java", body: `public class OrderService {
  private final NotificationFactory factory;
  public OrderService(NotificationFactory factory) { this.factory = factory; }

  void onOrderPlaced(Order order, User user) {
    factory.forUser(user).send("Order " + order.id() + " confirmed");
  }
}` }
      ]
    },
    whenToUse: [
      "A class cannot anticipate which concrete type it must create.",
      "You want callers to depend on an interface, not on `new ConcreteClass()`.",
      "New product types are added often and should not touch existing flows.",
      "Creation needs shared setup or validation in one place."
    ],
    whenNotToUse: [
      "There is a single concrete type and no realistic second one.",
      "Construction is trivial and `new` is clearer than an extra class.",
      "You need families of related objects; that is Abstract Factory."
    ],
    mistakes: [
      "Creating a factory that is just a pass-through to one `new` call.",
      "Leaking concrete types back out, for example by returning `EmailNotification` from the factory.",
      "Letting the factory grow business logic instead of only deciding what to create.",
      "Building a creator hierarchy when a static factory would do. Design patterns are good to have, but don't force one in just to impress the interviewer."
    ],
    deepDive: [
      {
        title: "Simple Factory vs Factory Method vs Abstract Factory",
        text: "**Simple (static) factory** is one method with a conditional. It is not a GoF pattern but is what most code actually uses.\n\n**Factory Method** is a method that subclasses override to choose the product, and the creator uses the product in its own workflow.\n\n**Abstract Factory** produces whole families of related products. If you only create one kind of object, you want one of the first two."
      },
      {
        title: "Open/Closed and the registry",
        text: "A switch-based factory still gets edited for each new type. The registry version moves that edit to a startup module, so new channels can ship as separate code. The trade-off is that a typo in a key fails at runtime instead of compile time, so fail loudly on unknown keys."
      }
    ],
    usedIn: [
      "Notification Service: pick email, SMS or push per user.",
      "Parking Lot: create the right Vehicle or Spot type.",
      "Elevator System: construct request handlers by request type.",
      "Logging Framework: build appenders from configuration."
    ],
    related: ["abstract-factory", "builder", "prototype", "strategy"]
  },

  {
    id: "abstract-factory",
    name: "Abstract Factory",
    category: "creational",
    difficulty: "medium",
    understanding: "Abstract Factory provides an interface for creating whole families of related objects without naming their concrete classes, so you can swap the entire family at once while guaranteeing the pieces always match.",
    problem: {
      intro: "You are designing the UI toolkit for a cross-platform app that must render natively on both a light and a dark theme, and on web and mobile later.",
      dialogue: [
        { who: "you", text: "What components does a screen need?" },
        { who: "int", text: "Buttons and checkboxes to start. Dialogs and menus later." },
        { who: "you", text: "Can a dark button appear next to a light checkbox?" },
        { who: "int", text: "Never. Mixing themes looks broken." },
        { who: "you", text: "So the choice of theme should apply to all components together?" },
        { who: "int", text: "Right. And adding a high-contrast theme shouldn't require editing screens." }
      ],
      requirements: [
        "Create buttons and checkboxes for a chosen theme (light, dark).",
        "All components on a screen must come from the same theme.",
        "Screen code must not reference theme-specific classes.",
        "Adding a theme must not modify existing screens."
      ]
    },
    badApproach: {
      text: "Each screen decides per component which concrete class to create based on the theme.",
      code: `class SettingsScreen {
  void render(String theme) {
    Button b;
    Checkbox c;
    if (theme.equals("DARK")) {
      b = new DarkButton();
      c = new DarkCheckbox();
    } else {
      b = new LightButton();
      c = new LightCheckbox();
    }
    b.draw();
    c.draw();
  }
}`,
      why: [
        "Every screen repeats the theme branching, and a missed branch gives a mismatched UI.",
        "Nothing enforces that the button and checkbox belong to the same theme.",
        "Adding a high-contrast theme means editing every screen."
      ]
    },
    design: [
      {
        heading: "Declare an interface per product type",
        text: "Each kind of component gets an abstraction. Screens program against these only.",
        code: [
          { file: "Button.java", body: `public interface Button {
  void draw();
}` },
          { file: "Checkbox.java", body: `public interface Checkbox {
  void draw();
}` }
        ]
      },
      {
        heading: "Implement a full family per theme",
        text: "Each theme supplies a concrete class for every product type. Because they are written together, they are consistent by construction.",
        code: [
          { file: "LightTheme.java", body: `class LightButton implements Button {
  public void draw() { /* white background, dark text */ }
}

class LightCheckbox implements Checkbox {
  public void draw() { /* white box, dark tick */ }
}` },
          { file: "DarkTheme.java", body: `class DarkButton implements Button {
  public void draw() { /* dark background, light text */ }
}

class DarkCheckbox implements Checkbox {
  public void draw() { /* dark box, light tick */ }
}` }
        ]
      },
      {
        heading: "Define the abstract factory",
        text: "One interface with a creation method per product. A concrete factory returns the matching family.",
        code: [
          { file: "UiFactory.java", body: `public interface UiFactory {
  Button createButton();
  Checkbox createCheckbox();
}` },
          { file: "LightUiFactory.java", body: `public class LightUiFactory implements UiFactory {
  public Button createButton()     { return new LightButton(); }
  public Checkbox createCheckbox() { return new LightCheckbox(); }
}` },
          { file: "DarkUiFactory.java", body: `public class DarkUiFactory implements UiFactory {
  public Button createButton()     { return new DarkButton(); }
  public Checkbox createCheckbox() { return new DarkCheckbox(); }
}` }
        ]
      },
      {
        heading: "Screens depend only on the factory",
        text: "The screen receives a factory and never learns which theme it is rendering. Switching themes means passing a different factory.",
        code: [
          { file: "SettingsScreen.java", body: `public class SettingsScreen {
  private final UiFactory ui;

  public SettingsScreen(UiFactory ui) {
    this.ui = ui;
  }

  public void render() {
    Button b = ui.createButton();
    Checkbox c = ui.createCheckbox();
    b.draw();
    c.draw();
  }
}` }
        ],
        note: "The factory is chosen **once**, at startup or when the user changes theme, which is why screens stay free of conditionals."
      }
    ],
    usage: {
      text: "Pick the concrete factory at the edge of the app from user settings, then hand it to everything that builds UI.",
      code: [
        { file: "Main.java", body: `UiFactory ui = prefs.isDark() ? new DarkUiFactory() : new LightUiFactory();

SettingsScreen settings = new SettingsScreen(ui);
ProfileScreen profile   = new ProfileScreen(ui);

settings.render();
profile.render();` }
      ]
    },
    whenToUse: [
      "Products come in families that must be used together, such as themes, OS widgets or database drivers.",
      "You want to swap an entire family by changing one object.",
      "Client code should stay ignorant of concrete classes."
    ],
    whenNotToUse: [
      "You create only one kind of product; Factory Method is lighter.",
      "Families are unlikely to vary, so the extra interfaces are pure overhead.",
      "Products do not need to be consistent with one another."
    ],
    mistakes: [
      "Using it for one product type, which is just a Factory Method with extra ceremony.",
      "Forgetting that adding a new product type, like `Dialog`, changes every factory.",
      "Letting clients cast the returned products to concrete types.",
      "Reaching for it too early. Design patterns are good to have, but don't force one in just to impress the interviewer."
    ],
    deepDive: [
      {
        title: "The cost: new product types are expensive",
        text: "Adding a new theme is easy: one new factory and its products. Adding a new product type is hard: you edit the `UiFactory` interface and every concrete factory. Abstract Factory optimizes for adding **families**, not adding **products**. If the product set changes often, consider a registry keyed by product type instead."
      },
      {
        title: "Abstract Factory built from Factory Methods",
        text: "Each method on an abstract factory is a Factory Method. Many implementations also make the concrete factory a Singleton since one theme object is enough per process. Combining them is common, but keep factories stateless so sharing is safe.",
        code: [
          { file: "ThemeRegistry.java", body: `public class ThemeRegistry {
  private final Map<String, UiFactory> themes = Map.of(
    "LIGHT", new LightUiFactory(),
    "DARK",  new DarkUiFactory()
  );

  public UiFactory get(String name) {
    UiFactory f = themes.get(name);
    if (f == null) throw new IllegalArgumentException("Unknown theme " + name);
    return f;
  }
}` }
        ]
      }
    ],
    usedIn: [
      "UI toolkits: themed or platform-specific widget families.",
      "Database layer: connection, statement and result classes per vendor.",
      "Game design: enemy, weapon and terrain sets per level theme.",
      "Cloud clients: storage, queue and compute clients per provider."
    ],
    related: ["factory-method", "builder", "prototype", "bridge"]
  },

  {
    id: "builder",
    name: "Builder",
    category: "creational",
    difficulty: "easy",
    understanding: "Builder separates the construction of a complex object from its representation, assembling it step by step so you can create immutable, validated objects without huge constructors or half-initialized state.",
    problem: {
      intro: "You are designing the request object for an HTTP client library. Requests have a few required fields and many optional ones, and the interviewer wants a clean API.",
      dialogue: [
        { who: "you", text: "What does every request need?" },
        { who: "int", text: "A URL and a method. Everything else is optional: headers, body, timeout, retries." },
        { who: "you", text: "Should a request be changeable after it is created?" },
        { who: "int", text: "No. Requests are shared across threads, so they must be immutable." },
        { who: "you", text: "And invalid combinations, like a GET with a body?" },
        { who: "int", text: "Reject them. It should be impossible to hold an invalid request." }
      ],
      requirements: [
        "Required fields: URL and method. Optional: headers, body, timeout, retries.",
        "Requests are immutable once built.",
        "Invalid combinations are rejected at build time.",
        "Call sites remain readable with many optional fields."
      ]
    },
    badApproach: {
      text: "A telescoping constructor, or a bag of setters on a mutable object.",
      code: `class HttpRequest {
  HttpRequest(String url, String method) { }
  HttpRequest(String url, String method, Map<String,String> headers) { }
  HttpRequest(String url, String method, Map<String,String> headers, String body) { }
  HttpRequest(String url, String method, Map<String,String> headers, String body, int timeoutMs) { }
  // ... and so on
}

// Which argument is the timeout again?
new HttpRequest("/pay", "POST", null, body, 3000);`,
      why: [
        "Positional arguments are unreadable, and swapping two same-typed ones compiles silently.",
        "Setters leave the object half-built and mutable, so it cannot be safely shared.",
        "Validation has no obvious home, so invalid objects slip through."
      ]
    },
    design: [
      {
        heading: "Make the product immutable with a private constructor",
        text: "The object has final fields and a constructor only the builder can reach. Once built, nothing changes it.",
        code: [
          { file: "HttpRequest.java", body: `public final class HttpRequest {
  private final String url;
  private final String method;
  private final Map<String, String> headers;
  private final String body;
  private final int timeoutMs;
  private final int retries;

  private HttpRequest(Builder b) {
    this.url = b.url;
    this.method = b.method;
    this.headers = Map.copyOf(b.headers);
    this.body = b.body;
    this.timeoutMs = b.timeoutMs;
    this.retries = b.retries;
  }

  public String url() { return url; }
  public String method() { return method; }
  // other getters

  public static Builder builder(String url, String method) {
    return new Builder(url, method);
  }
}` }
        ]
      },
      {
        heading: "Add a nested builder with fluent setters",
        text: "Required fields go in the builder's constructor so you cannot forget them. Optional fields get chainable methods with sensible defaults.",
        code: [
          { file: "HttpRequest.Builder.java", body: `public static class Builder {
  private final String url;
  private final String method;
  private final Map<String, String> headers = new HashMap<>();
  private String body;
  private int timeoutMs = 5000;
  private int retries = 0;

  private Builder(String url, String method) {
    this.url = url;
    this.method = method;
  }

  public Builder header(String k, String v) { headers.put(k, v); return this; }
  public Builder body(String body)          { this.body = body; return this; }
  public Builder timeoutMs(int ms)          { this.timeoutMs = ms; return this; }
  public Builder retries(int n)             { this.retries = n; return this; }
}` }
        ]
      },
      {
        heading: "Validate once, inside build()",
        text: "`build()` is the single gate. If it returns, the object is valid. Cross-field rules live here because no individual setter sees the whole picture.",
        code: [
          { file: "build().java", body: `public HttpRequest build() {
  if (url == null || url.isBlank()) {
    throw new IllegalStateException("url is required");
  }
  if (method.equals("GET") && body != null) {
    throw new IllegalStateException("GET cannot have a body");
  }
  if (timeoutMs <= 0) {
    throw new IllegalStateException("timeout must be positive");
  }
  return new HttpRequest(this);
}` }
        ],
        note: "Validate in `build()`, not in the setters. A setter cannot know whether the body is allowed until it knows the method."
      },
      {
        heading: "Optional: a director for common recipes",
        text: "If several callers repeat the same configuration, wrap it in a small director or a static helper. This is the original GoF \"Director\" role and is often overkill, so add it only when duplication appears.",
        code: [
          { file: "Requests.java", body: `public final class Requests {
  public static HttpRequest jsonPost(String url, String json) {
    return HttpRequest.builder(url, "POST")
        .header("Content-Type", "application/json")
        .body(json)
        .timeoutMs(3000)
        .build();
  }
}` }
        ]
      }
    ],
    usage: {
      text: "Call sites name every optional value, so they read like documentation, and the result is immutable and valid.",
      code: [
        { file: "Main.java", body: `HttpRequest req = HttpRequest.builder("https://api.pay.com/charge", "POST")
    .header("Authorization", "Bearer " + token)
    .body(payload)
    .timeoutMs(2500)
    .retries(2)
    .build();

client.send(req);` }
      ]
    },
    whenToUse: [
      "An object has many optional parameters or several required ones of the same type.",
      "You want immutable objects with validated invariants.",
      "Construction happens in steps or needs cross-field validation.",
      "You want call sites that read clearly without positional arguments."
    ],
    whenNotToUse: [
      "The object has two or three required fields; a plain constructor is simpler.",
      "It is a simple data holder where a Java `record` would do.",
      "The object is mutable by design and constructed incrementally anyway."
    ],
    mistakes: [
      "Making the product mutable, which defeats the main benefit.",
      "Reusing a builder across threads or calls without copying its mutable collections.",
      "Skipping validation in `build()` so invalid objects still escape.",
      "Writing a builder for a three-field class. Design patterns are good to have, but don't force one in just to impress the interviewer."
    ],
    deepDive: [
      {
        title: "Builder vs telescoping constructors vs records",
        text: "Telescoping constructors do not scale past three or four parameters. Java records give you a concise immutable type but still use positional construction. A builder shines when there are many optional fields or cross-field rules. For small value types, a record is usually the right answer."
      },
      {
        title: "Copying mutable state in the constructor",
        text: "The builder's `HashMap` is mutable and the builder may be reused. If the product keeps the same reference, a later `header()` call silently mutates an already-built request. Always take a defensive copy when building, as `Map.copyOf` does in step 1.",
        code: [
          { file: "Pitfall.java", body: `HttpRequest.Builder b = HttpRequest.builder(url, "GET");
HttpRequest first = b.header("A", "1").build();
b.header("B", "2");                 // must NOT affect 'first'
HttpRequest second = b.build();     // has A and B` }
        ]
      }
    ],
    usedIn: [
      "Notification Service: build messages with optional attachments and templates.",
      "BookMyShow: construct a Booking from selected show, seats and payment.",
      "Rate Limiter: configure limits, windows and clocks.",
      "Logging Framework: assemble loggers with appenders and formatters."
    ],
    related: ["factory-method", "abstract-factory", "prototype"]
  },

  {
    id: "prototype",
    name: "Prototype",
    category: "creational",
    difficulty: "medium",
    understanding: "Prototype creates new objects by copying an existing instance, called the prototype, instead of building them from scratch. It is useful when construction is expensive or when you want copies without depending on concrete classes.",
    problem: {
      intro: "You are designing a document editor with reusable templates. Users create a new contract from a template that already contains dozens of formatted sections.",
      dialogue: [
        { who: "you", text: "What makes creating a document from a template costly?" },
        { who: "int", text: "Templates are loaded from storage and parsed into a tree of sections. That is slow." },
        { who: "you", text: "Can we load a template once and reuse it?" },
        { who: "int", text: "Yes, but each new document must be independent. Editing one cannot change the template or another document." },
        { who: "you", text: "So we need a copy that is fully separate, including nested sections?" },
        { who: "int", text: "Exactly. A deep copy, and the editor shouldn't need to know which document type it is copying." }
      ],
      requirements: [
        "Create a new document by copying a pre-loaded template.",
        "Copies are independent, including nested sections.",
        "The editor copies documents without knowing their concrete type.",
        "Loading and parsing happens once per template."
      ]
    },
    badApproach: {
      text: "Rebuild each document from scratch, or copy only the top-level fields.",
      code: `class Contract {
  List<Section> sections;
  String title;

  // Slow: reloads and parses every time
  static Contract fromTemplate(String name) {
    return parse(storage.read(name));
  }

  // Broken: shares the same Section objects
  Contract shallowCopy() {
    Contract c = new Contract();
    c.title = this.title;
    c.sections = this.sections;   // same list!
    return c;
  }
}`,
      why: [
        "Re-parsing on every creation repeats expensive work.",
        "A shallow copy shares the `sections` list, so editing one document edits the template and all siblings.",
        "The editor must know the concrete class to call its static factory."
      ]
    },
    design: [
      {
        heading: "Declare a copy contract",
        text: "Give every copyable type a method that returns a copy of itself. Callers hold the abstraction and never name the concrete class.",
        code: [
          { file: "Document.java", body: `public interface Document {
  Document copy();
  String title();
  void setTitle(String title);
}` }
        ]
      },
      {
        heading: "Implement a deep copy",
        text: "Each class is responsible for copying itself, including the nested objects it owns. Immutable fields can be shared; mutable ones cannot.",
        code: [
          { file: "Section.java", body: `public class Section {
  private String heading;
  private String body;

  public Section(String heading, String body) {
    this.heading = heading;
    this.body = body;
  }

  // Copy constructor
  public Section(Section other) {
    this.heading = other.heading;   // String is immutable
    this.body = other.body;
  }
}` },
          { file: "Contract.java", body: `public class Contract implements Document {
  private String title;
  private final List<Section> sections = new ArrayList<>();

  public Contract(String title) { this.title = title; }

  private Contract(Contract other) {
    this.title = other.title;
    for (Section s : other.sections) {
      this.sections.add(new Section(s));   // deep copy
    }
  }

  public Document copy() { return new Contract(this); }
  public String title() { return title; }
  public void setTitle(String t) { this.title = t; }
}` }
        ],
        note: "Prefer a **copy constructor** or explicit `copy()` over Java's `Cloneable`. `clone()` is shallow by default, has awkward semantics and bypasses constructors."
      },
      {
        heading: "Keep a registry of prototypes",
        text: "Load each template once, store it, and hand out copies on demand. The expensive parse happens once per template.",
        code: [
          { file: "TemplateRegistry.java", body: `public class TemplateRegistry {
  private final Map<String, Document> templates = new HashMap<>();

  public void register(String name, Document prototype) {
    templates.put(name, prototype);
  }

  public Document create(String name) {
    Document proto = templates.get(name);
    if (proto == null) throw new IllegalArgumentException("No template " + name);
    return proto.copy();
  }
}` }
        ]
      }
    ],
    usage: {
      text: "Register prototypes at startup, then create documents by asking for a copy. The caller edits its copy freely.",
      code: [
        { file: "Main.java", body: `TemplateRegistry registry = new TemplateRegistry();
registry.register("NDA", loadAndParse("nda"));       // expensive, once
registry.register("EMPLOYMENT", loadAndParse("employment"));

Document a = registry.create("NDA");
Document b = registry.create("NDA");

a.setTitle("NDA - Acme");
// b.title() is unchanged, and so is the registered template` }
      ]
    },
    whenToUse: [
      "Creating an object is expensive and many instances are similar.",
      "You need independent copies of objects whose concrete type is unknown to the caller.",
      "You want runtime-configurable \"presets\" or templates that users clone and tweak.",
      "You want to avoid a parallel hierarchy of factories."
    ],
    whenNotToUse: [
      "Objects are cheap to construct, so a plain `new` is clearer.",
      "The object graph has cycles or external resources like open files that cannot be copied safely.",
      "Immutable objects make copying pointless; just share them."
    ],
    mistakes: [
      "Copying shallowly and discovering shared nested state later.",
      "Relying on `Cloneable` and `clone()` without understanding their pitfalls.",
      "Copying fields that should be unique, such as IDs or creation timestamps.",
      "Using it where construction is cheap. Design patterns are good to have, but don't force one in just to impress the interviewer."
    ],
    deepDive: [
      {
        title: "Shallow vs deep copy",
        text: "A shallow copy duplicates the object but shares references to everything it points to. A deep copy duplicates the whole graph that the object owns. The rule of thumb is that a copy must not share **mutable** state with its source. Immutable values like `String` or `LocalDate` can safely be shared, which keeps copies cheap."
      },
      {
        title: "What to reset when copying",
        text: "Copies often need fresh identity. Reset or regenerate fields that must be unique so two documents never share an ID, and decide whether metadata such as author or timestamps carries over.",
        code: [
          { file: "ContractWithId.java", body: `private Contract(Contract other) {
  this.id = UUID.randomUUID().toString();   // new identity
  this.createdAt = Instant.now();           // new timestamp
  this.title = other.title;
  for (Section s : other.sections) {
    this.sections.add(new Section(s));
  }
}` }
        ]
      }
    ],
    usedIn: [
      "Document or spreadsheet editors: duplicate a sheet or template.",
      "Game design: spawn many enemies from a configured prototype.",
      "Text editor: snapshot state for undo, together with Memento.",
      "Configuration presets: clone a base config and override a few values."
    ],
    related: ["factory-method", "abstract-factory", "memento", "singleton"]
  }
);
