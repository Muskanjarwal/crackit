window.PATTERNS = window.PATTERNS || [];
window.PATTERNS.push(
  {
    id: "adapter",
    name: "Adapter",
    category: "structural",
    difficulty: "easy",
    understanding: "Adapter wraps an existing class with an incompatible interface and exposes the interface your code expects, so the two can work together without changing either one.",
    problem: {
      intro: "You are designing the payment layer of an e-commerce app. Checkout already talks to a clean `PaymentProcessor` interface, but a new third-party gateway ships its own SDK with a very different API.",
      dialogue: [
        { who: "you", text: "How does checkout call payments today?" },
        { who: "int", text: "Through `PaymentProcessor.pay(orderId, amount)`. Everything in the app uses it." },
        { who: "you", text: "And the new gateway?" },
        { who: "int", text: "It's a vendor SDK: `charge(cents, currencyCode, customerToken)`. We can't edit it." },
        { who: "you", text: "Then I shouldn't change checkout or the SDK. I need something in between." },
        { who: "int", text: "Right. And next quarter we may integrate a second vendor with yet another shape." }
      ],
      requirements: [
        "Checkout keeps calling the existing `PaymentProcessor` interface.",
        "The vendor SDK must be used as-is, since we cannot modify it.",
        "Adding another vendor must not touch checkout code."
      ]
    },
    badApproach: {
      text: "The quick fix is to call the vendor SDK straight from checkout and convert values inline.",
      code: `class CheckoutService {
  private final VendorGatewaySdk sdk = new VendorGatewaySdk();

  void checkout(Order order) {
    long cents = Math.round(order.total() * 100);
    VendorResult r = sdk.charge(cents, "INR", order.customer().vendorToken());
    if (r.getCode() != 0) {
      throw new PaymentException(r.getMessage());
    }
  }
}`,
      why: [
        "Checkout now knows vendor details: cents, currency codes and result codes.",
        "A second vendor means another branch inside checkout.",
        "The conversion logic cannot be unit tested without the real SDK."
      ]
    },
    design: [
      {
        heading: "Keep the target interface",
        text: "The target is the interface your application already depends on. It stays exactly as it is.",
        code: [
          { file: "PaymentProcessor.java", body: `public interface PaymentProcessor {
  PaymentResult pay(String orderId, Money amount);
}` }
        ]
      },
      {
        heading: "Identify the adaptee",
        text: "The adaptee is the incompatible class. Treat it as a black box and never edit it. Here it is the vendor SDK.",
        code: [
          { file: "VendorGatewaySdk.java", body: `// Third-party code. Cannot be modified.
public class VendorGatewaySdk {
  public VendorResult charge(long cents, String currencyCode, String customerToken) { ... }
}` }
        ]
      },
      {
        heading: "Write the adapter",
        text: "The adapter implements the target interface, holds the adaptee, and translates both the call and the result. All vendor knowledge lives in this one class.",
        code: [
          { file: "VendorGatewayAdapter.java", body: `public class VendorGatewayAdapter implements PaymentProcessor {
  private final VendorGatewaySdk sdk;
  private final CustomerDirectory customers;

  public VendorGatewayAdapter(VendorGatewaySdk sdk, CustomerDirectory customers) {
    this.sdk = sdk;
    this.customers = customers;
  }

  @Override
  public PaymentResult pay(String orderId, Money amount) {
    String token = customers.tokenForOrder(orderId);
    long cents = amount.toMinorUnits();
    VendorResult r = sdk.charge(cents, amount.currency().code(), token);
    return r.getCode() == 0
        ? PaymentResult.success(r.getReference())
        : PaymentResult.failure(r.getMessage());
  }
}` },
          { file: "PaymentResult.java", body: `public final class PaymentResult {
  private final boolean ok;
  private final String detail;

  private PaymentResult(boolean ok, String detail) {
    this.ok = ok;
    this.detail = detail;
  }

  public static PaymentResult success(String reference) { return new PaymentResult(true, reference); }
  public static PaymentResult failure(String reason)    { return new PaymentResult(false, reason); }
  public boolean isOk() { return ok; }
  public String detail() { return detail; }
}` }
        ],
        note: "The adapter also translates the **result**, not just the request. Leaking `VendorResult` upward would defeat the point."
      }
    ],
    usage: {
      text: "Checkout receives a `PaymentProcessor` and has no idea which vendor is behind it. Wiring happens at the edge of the app.",
      code: [
        { file: "Main.java", body: `PaymentProcessor processor =
    new VendorGatewayAdapter(new VendorGatewaySdk(), customerDirectory);

CheckoutService checkout = new CheckoutService(processor);
checkout.checkout(order);` },
        { file: "CheckoutService.java", body: `public class CheckoutService {
  private final PaymentProcessor processor;

  public CheckoutService(PaymentProcessor processor) {
    this.processor = processor;
  }

  public void checkout(Order order) {
    PaymentResult result = processor.pay(order.id(), order.total());
    if (!result.isOk()) throw new PaymentException(result.detail());
  }
}` }
      ]
    },
    whenToUse: [
      "You must integrate a third-party or legacy class you cannot change.",
      "Several classes do the same job with different method signatures.",
      "You want to isolate vendor-specific details in one replaceable place.",
      "You are migrating gradually from an old API to a new one."
    ],
    whenNotToUse: [
      "You own both sides and can simply change the interface.",
      "The mismatch is trivial, such as a single method rename that one call site uses.",
      "You are adapting your own code just to follow a pattern."
    ],
    mistakes: [
      "Letting adaptee types leak through the adapter's public API.",
      "Putting business rules in the adapter. It should translate, not decide.",
      "Creating one giant adapter for many unrelated vendors instead of one per vendor.",
      "Confusing it with Facade. Adapter changes an interface to match an expected one; Facade simplifies a subsystem."
    ],
    deepDive: [
      {
        title: "Object adapter vs class adapter",
        text: "The version above is an **object adapter**: it holds the adaptee by composition. A **class adapter** inherits from the adaptee and implements the target interface. Java has no multiple class inheritance, so object adapters are the practical default, and they can wrap subclasses of the adaptee too."
      },
      {
        title: "Two-way translation of errors",
        text: "Vendors report errors in their own style: codes, checked exceptions or nulls. Translate them into your domain's error model inside the adapter so callers handle one failure style.",
        code: [
          { file: "ErrorMapping.java", body: `try {
  VendorResult r = sdk.charge(cents, code, token);
  return map(r);
} catch (VendorTimeoutException e) {
  return PaymentResult.failure("TIMEOUT");
} catch (VendorAuthException e) {
  throw new PaymentConfigurationException(e);
}` }
        ]
      }
    ],
    usedIn: [
      "Payment gateways: wrapping Stripe, Razorpay or PayPal behind one interface.",
      "Notification Service: one adapter per email, SMS or push provider.",
      "Logging Framework: adapting third-party appenders to your appender interface.",
      "Legacy migration questions: new service layer over an old data access API."
    ],
    related: ["facade", "bridge", "proxy", "decorator"]
  },
  {
    id: "bridge",
    name: "Bridge",
    category: "structural",
    difficulty: "medium",
    understanding: "Bridge splits a concept into two independent hierarchies, an abstraction and an implementation, and connects them by composition so each can vary without multiplying classes.",
    problem: {
      intro: "You are designing a remote control system for home devices. There are different remotes and different devices, and the product team keeps adding both.",
      dialogue: [
        { who: "you", text: "What kinds of remotes and devices are in scope?" },
        { who: "int", text: "A basic remote and an advanced remote with mute. Devices are TV and Radio for now." },
        { who: "you", text: "Will more of either be added?" },
        { who: "int", text: "Yes. Voice remotes next quarter, and smart speakers after that." },
        { who: "you", text: "So remotes and devices need to evolve independently." },
        { who: "int", text: "Exactly. Any remote should work with any device." }
      ],
      requirements: [
        "Support multiple remote types and multiple device types.",
        "Any remote must work with any device.",
        "Adding a new remote or device must not require classes for every combination."
      ]
    },
    badApproach: {
      text: "Subclass for every combination of remote and device.",
      code: `class BasicTvRemote { ... }
class BasicRadioRemote { ... }
class AdvancedTvRemote { ... }
class AdvancedRadioRemote { ... }
// VoiceTvRemote, VoiceRadioRemote, VoiceSpeakerRemote ...`,
      why: [
        "Classes grow as remotes times devices. Three of each already means nine.",
        "Fixing the mute logic means editing every advanced remote class.",
        "The device-specific code is duplicated across every remote type."
      ]
    },
    design: [
      {
        heading: "Define the implementation interface",
        text: "This is the low-level API devices expose. It knows nothing about remotes.",
        code: [
          { file: "Device.java", body: `public interface Device {
  boolean isOn();
  void powerOn();
  void powerOff();
  int volume();
  void setVolume(int volume);
}` }
        ]
      },
      {
        heading: "Implement concrete devices",
        text: "Each device implements the interface in its own way.",
        code: [
          { file: "Tv.java", body: `public class Tv implements Device {
  private boolean on;
  private int volume = 20;

  public boolean isOn() { return on; }
  public void powerOn() { on = true; }
  public void powerOff() { on = false; }
  public int volume() { return volume; }
  public void setVolume(int v) { volume = Math.max(0, Math.min(100, v)); }
}` },
          { file: "Radio.java", body: `public class Radio implements Device {
  private boolean on;
  private int volume = 10;

  public boolean isOn() { return on; }
  public void powerOn() { on = true; }
  public void powerOff() { on = false; }
  public int volume() { return volume; }
  public void setVolume(int v) { volume = Math.max(0, Math.min(30, v)); }
}` }
        ]
      },
      {
        heading: "Build the abstraction that holds a device",
        text: "The abstraction is the high-level control. It owns a reference to a `Device`, and that reference is the bridge. Refined abstractions extend it with extra features.",
        code: [
          { file: "RemoteControl.java", body: `public class RemoteControl {
  protected final Device device;

  public RemoteControl(Device device) {
    this.device = device;
  }

  public void togglePower() {
    if (device.isOn()) device.powerOff();
    else device.powerOn();
  }

  public void volumeUp()   { device.setVolume(device.volume() + 10); }
  public void volumeDown() { device.setVolume(device.volume() - 10); }
}` },
          { file: "AdvancedRemote.java", body: `public class AdvancedRemote extends RemoteControl {
  public AdvancedRemote(Device device) {
    super(device);
  }

  public void mute() {
    device.setVolume(0);
  }
}` }
        ],
        note: "Only two extra classes were needed for the advanced remote across **every** device, because the device is plugged in rather than baked in."
      }
    ],
    usage: {
      text: "Pick any remote and any device at runtime. Adding a Speaker device or a VoiceRemote adds exactly one class each.",
      code: [
        { file: "Main.java", body: `RemoteControl basicTv   = new RemoteControl(new Tv());
AdvancedRemote advRadio = new AdvancedRemote(new Radio());

basicTv.togglePower();
basicTv.volumeUp();

advRadio.togglePower();
advRadio.mute();` }
      ]
    },
    whenToUse: [
      "You see a class explosion from two independent dimensions of variation.",
      "You want to switch the implementation at runtime.",
      "Both the abstraction and the implementation need to be extended separately.",
      "You want to hide implementation details from client code."
    ],
    whenNotToUse: [
      "There is only one dimension of variation. Plain inheritance or Strategy is simpler.",
      "The hierarchy is small and stable.",
      "You cannot clearly separate high-level logic from low-level operations."
    ],
    mistakes: [
      "Making the implementation interface mirror the abstraction method for method, so nothing is really decoupled.",
      "Letting the abstraction check `instanceof` on the device, which re-couples them.",
      "Using Bridge when a simple Strategy would do. If there is no hierarchy on the abstraction side, it is probably Strategy.",
      "Designing the bridge up front for a variation that never arrives."
    ],
    deepDive: [
      {
        title: "Bridge vs Strategy vs Adapter",
        text: "All three use composition. **Adapter** fixes an interface mismatch after the fact. **Strategy** swaps one algorithm inside a single class. **Bridge** is designed up front so two whole hierarchies evolve independently. If both sides have subclasses, it is Bridge."
      },
      {
        title: "Dependency injection makes the bridge visible",
        text: "The bridge is the constructor parameter. Using it with dependency injection lets you assemble combinations in configuration and swap in a fake device for tests.",
        code: [
          { file: "RemoteTest.java", body: `class FakeDevice implements Device {
  int volume = 50;
  boolean on;
  public boolean isOn() { return on; }
  public void powerOn() { on = true; }
  public void powerOff() { on = false; }
  public int volume() { return volume; }
  public void setVolume(int v) { volume = v; }
}

AdvancedRemote remote = new AdvancedRemote(new FakeDevice());
remote.mute();` }
        ]
      }
    ],
    usedIn: [
      "Notification Service: message types (alert, receipt) bridged to channels (email, SMS, push).",
      "Logging Framework: loggers bridged to appenders.",
      "Shapes with renderers: Circle and Square bridged to Vector and Raster drawing APIs.",
      "Cross-platform UI toolkits: widgets bridged to OS-specific implementations."
    ],
    related: ["strategy", "adapter", "abstract-factory", "state"]
  },
  {
    id: "composite",
    name: "Composite",
    category: "structural",
    difficulty: "medium",
    understanding: "Composite lets you treat a single object and a group of objects through the same interface, so clients can work with trees of items without caring whether a node is a leaf or a container.",
    problem: {
      intro: "You are designing the file system for a cloud storage app. Users can browse files and folders, and folders can contain other folders.",
      dialogue: [
        { who: "you", text: "What operations should the file system support?" },
        { who: "int", text: "Show size, list contents, and search by name." },
        { who: "you", text: "Is the size of a folder the sum of everything inside it?" },
        { who: "int", text: "Yes, recursively. Folders can nest to any depth." },
        { who: "you", text: "Should callers need to know whether they hold a file or a folder?" },
        { who: "int", text: "Ideally not. The UI just asks any item for its size." }
      ],
      requirements: [
        "Files and folders can both report their size.",
        "Folders can contain files and other folders to any depth.",
        "Client code should not branch on file versus folder."
      ]
    },
    badApproach: {
      text: "Keep two unrelated classes and make callers check which one they have.",
      code: `long totalSize(Object node) {
  if (node instanceof File) {
    return ((File) node).bytes();
  } else if (node instanceof Folder) {
    long sum = 0;
    for (Object child : ((Folder) node).children()) {
      sum += totalSize(child);
    }
    return sum;
  }
  throw new IllegalArgumentException();
}`,
      why: [
        "Every operation, such as size, search or delete, repeats the same instanceof ladder.",
        "A new node type, for example a shortcut, forces edits everywhere.",
        "The recursion logic lives in callers instead of the tree itself."
      ]
    },
    design: [
      {
        heading: "Define the component interface",
        text: "One interface for both leaves and containers. This is what clients depend on.",
        code: [
          { file: "FileSystemNode.java", body: `public interface FileSystemNode {
  String name();
  long size();
  List<FileSystemNode> search(String namePart);
}` }
        ]
      },
      {
        heading: "Implement the leaf",
        text: "A file has no children. It does the real work directly.",
        code: [
          { file: "FileNode.java", body: `public class FileNode implements FileSystemNode {
  private final String name;
  private final long bytes;

  public FileNode(String name, long bytes) {
    this.name = name;
    this.bytes = bytes;
  }

  public String name() { return name; }
  public long size() { return bytes; }

  public List<FileSystemNode> search(String namePart) {
    return name.contains(namePart) ? List.of(this) : List.of();
  }
}` }
        ]
      },
      {
        heading: "Implement the composite",
        text: "A folder holds children typed as the **interface** and delegates to them. The recursion falls out naturally.",
        code: [
          { file: "FolderNode.java", body: `public class FolderNode implements FileSystemNode {
  private final String name;
  private final List<FileSystemNode> children = new ArrayList<>();

  public FolderNode(String name) { this.name = name; }

  public void add(FileSystemNode node) { children.add(node); }
  public void remove(FileSystemNode node) { children.remove(node); }

  public String name() { return name; }

  public long size() {
    long total = 0;
    for (FileSystemNode child : children) {
      total += child.size();
    }
    return total;
  }

  public List<FileSystemNode> search(String namePart) {
    List<FileSystemNode> hits = new ArrayList<>();
    if (name.contains(namePart)) hits.add(this);
    for (FileSystemNode child : children) {
      hits.addAll(child.search(namePart));
    }
    return hits;
  }
}` }
        ],
        note: "`add` and `remove` live on `FolderNode`, not the interface. This keeps leaves from exposing operations that make no sense for them."
      }
    ],
    usage: {
      text: "Build the tree once and treat the root like any other node.",
      code: [
        { file: "Main.java", body: `FolderNode root = new FolderNode("root");
FolderNode photos = new FolderNode("photos");
photos.add(new FileNode("beach.png", 2_000_000));
photos.add(new FileNode("city.png", 3_000_000));
root.add(photos);
root.add(new FileNode("notes.txt", 4_000));

long total = root.size();             // 5_004_000
var hits = root.search("png");        // beach.png, city.png` }
      ]
    },
    whenToUse: [
      "Your data is naturally a tree: files and folders, menus, org charts, UI widgets.",
      "Clients should treat individual items and groups uniformly.",
      "An operation should apply recursively across the whole structure."
    ],
    whenNotToUse: [
      "The structure is flat or has a fixed depth.",
      "Leaves and containers have very different behaviour that cannot share an interface.",
      "You need strict type safety on what can contain what."
    ],
    mistakes: [
      "Putting `add` and `remove` on the shared interface so leaves throw UnsupportedOperationException.",
      "Forgetting a parent reference when you need to walk up the tree.",
      "Recomputing expensive values such as folder size on every call without caching.",
      "Allowing cycles, such as adding a folder to itself, which causes infinite recursion."
    ],
    deepDive: [
      {
        title: "Transparency vs safety",
        text: "If `add` is on the interface, clients treat everything uniformly (transparent) but leaves must reject the call. If `add` lives only on the composite, the API is safer but clients sometimes need a cast. Most interview answers pick safety: keep child management on the composite."
      },
      {
        title: "Caching the size",
        text: "Recursive size is O(n) on every call. For big trees, cache it in each folder and invalidate upward when a child changes. That requires a parent pointer.",
        code: [
          { file: "CachedFolder.java", body: `private Long cachedSize;
private FolderNode parent;

public long size() {
  if (cachedSize == null) {
    cachedSize = children.stream().mapToLong(FileSystemNode::size).sum();
  }
  return cachedSize;
}

void invalidate() {
  cachedSize = null;
  if (parent != null) parent.invalidate();
}` }
        ]
      }
    ],
    usedIn: [
      "File System design: files and directories.",
      "Menu or UI component trees: panels containing buttons and other panels.",
      "Org chart or employee hierarchy questions.",
      "Expression trees and nested permission groups."
    ],
    related: ["iterator", "visitor", "decorator", "flyweight"]
  },
  {
    id: "decorator",
    name: "Decorator",
    category: "structural",
    difficulty: "medium",
    understanding: "Decorator adds behaviour to an object by wrapping it in another object that shares the same interface, so you can stack features at runtime instead of creating a subclass for every combination.",
    problem: {
      intro: "You are designing the ordering system for a coffee shop. Customers pick a base drink and then add any number of extras.",
      dialogue: [
        { who: "you", text: "What base drinks and add-ons exist?" },
        { who: "int", text: "Espresso and Latte. Add-ons are milk, caramel and whipped cream." },
        { who: "you", text: "Can a customer add the same extra twice or mix them freely?" },
        { who: "int", text: "Yes. Double caramel with whipped cream on an espresso is valid." },
        { who: "you", text: "And the price and description both reflect the extras?" },
        { who: "int", text: "Right. Next month we're adding oat milk and seasonal syrups." }
      ],
      requirements: [
        "Compute cost and description for a drink with any combination of add-ons.",
        "The same add-on can be applied multiple times.",
        "New add-ons must not require changes to existing drinks."
      ]
    },
    badApproach: {
      text: "Create a subclass for each combination, or pile boolean flags onto one class.",
      code: `class EspressoWithMilk { ... }
class EspressoWithCaramel { ... }
class EspressoWithMilkAndCaramel { ... }
class LatteWithCaramelAndWhip { ... }

// or a flag-heavy single class
class Drink {
  boolean milk, caramel, whip;
  double cost() {
    double c = base;
    if (milk) c += 15;
    if (caramel) c += 20;
    if (whip) c += 25;
    return c;
  }
}`,
      why: [
        "Subclasses explode: n add-ons means 2^n combinations.",
        "Boolean flags cannot express double caramel.",
        "Every new add-on edits the central class, breaking Open/Closed."
      ]
    },
    design: [
      {
        heading: "Define the shared component interface",
        text: "Both base drinks and add-ons implement it. That is what lets wrappers stack.",
        code: [
          { file: "Beverage.java", body: `public interface Beverage {
  String description();
  double cost();
}` }
        ]
      },
      {
        heading: "Create the concrete components",
        text: "Base drinks are the innermost objects being decorated.",
        code: [
          { file: "Espresso.java", body: `public class Espresso implements Beverage {
  public String description() { return "Espresso"; }
  public double cost() { return 80; }
}` },
          { file: "Latte.java", body: `public class Latte implements Beverage {
  public String description() { return "Latte"; }
  public double cost() { return 120; }
}` }
        ]
      },
      {
        heading: "Create an abstract decorator",
        text: "The decorator implements the interface **and** holds one. By default it just forwards, and concrete decorators override what they change.",
        code: [
          { file: "BeverageDecorator.java", body: `public abstract class BeverageDecorator implements Beverage {
  protected final Beverage inner;

  protected BeverageDecorator(Beverage inner) {
    this.inner = inner;
  }

  public String description() { return inner.description(); }
  public double cost() { return inner.cost(); }
}` }
        ]
      },
      {
        heading: "Add concrete decorators",
        text: "Each add-on wraps a beverage and adjusts description and cost.",
        code: [
          { file: "Caramel.java", body: `public class Caramel extends BeverageDecorator {
  public Caramel(Beverage inner) { super(inner); }

  public String description() { return inner.description() + ", Caramel"; }
  public double cost() { return inner.cost() + 20; }
}` },
          { file: "WhippedCream.java", body: `public class WhippedCream extends BeverageDecorator {
  public WhippedCream(Beverage inner) { super(inner); }

  public String description() { return inner.description() + ", Whipped Cream"; }
  public double cost() { return inner.cost() + 25; }
}` }
        ]
      }
    ],
    usage: {
      text: "Wrap in any order and any number of times. The result is still a `Beverage`.",
      code: [
        { file: "Main.java", body: `Beverage order = new Espresso();
order = new Caramel(order);
order = new Caramel(order);
order = new WhippedCream(order);

System.out.println(order.description()); // Espresso, Caramel, Caramel, Whipped Cream
System.out.println(order.cost());        // 145.0` }
      ]
    },
    whenToUse: [
      "You need to add responsibilities to individual objects dynamically.",
      "Subclassing would cause a combinatorial explosion.",
      "Features should be optional and combinable, like toppings, middleware or stream wrappers."
    ],
    whenNotToUse: [
      "The behaviour is fixed for a type. A plain subclass or field is simpler.",
      "Order of wrapping matters a lot and is easy to get wrong.",
      "You need to inspect or remove one specific wrapper later. Decorators hide what is inside."
    ],
    mistakes: [
      "Decorators that do not share the exact interface, so they cannot be stacked.",
      "Relying on object identity or `instanceof` for the wrapped type, which the wrapper breaks.",
      "Putting unrelated logic into a decorator instead of a single focused responsibility.",
      "Confusing it with Proxy. Decorator adds behaviour; Proxy controls access to the same behaviour."
    ],
    deepDive: [
      {
        title: "Decorator in the Java standard library",
        text: "Java I/O is the classic example. Each wrapper adds one capability around a plain stream.",
        code: [
          { file: "IoExample.java", body: `InputStream in = new BufferedInputStream(
    new GZIPInputStream(
        new FileInputStream("data.gz")));` }
        ]
      },
      {
        title: "Decorator vs inheritance vs Strategy",
        text: "Inheritance fixes behaviour at compile time. Strategy swaps one algorithm. Decorator **layers** many small behaviours around the same core and lets callers choose the stack at runtime. If you can say wrap it with X and then with Y, it is Decorator."
      }
    ],
    usedIn: [
      "Pizza or coffee ordering with toppings and add-ons.",
      "Notification Service: wrapping a sender with logging, retry and rate limiting.",
      "Logging Framework: formatters wrapped with timestamp or thread-name decorators.",
      "Web middleware stacks: auth, compression and caching wrapped around a handler."
    ],
    related: ["proxy", "composite", "strategy", "chain-of-responsibility"]
  },
  {
    id: "facade",
    name: "Facade",
    category: "structural",
    difficulty: "easy",
    understanding: "Facade gives a complicated subsystem one simple entry point, so clients call a single method instead of coordinating many classes themselves.",
    problem: {
      intro: "You are designing a home theater app. Watching a movie means working with a projector, sound system, lights, streaming player and screen, all in the right order.",
      dialogue: [
        { who: "you", text: "What happens when a user presses Watch Movie?" },
        { who: "int", text: "Lights dim, screen comes down, projector and amp turn on, input is set, then the player starts." },
        { who: "you", text: "Is that sequence the same every time?" },
        { who: "int", text: "Yes. And there's a reverse sequence for shutting down." },
        { who: "you", text: "Do power users still need direct control of each device?" },
        { who: "int", text: "Sometimes. But most callers only want to watch or stop." }
      ],
      requirements: [
        "One call starts a movie, one call ends it.",
        "The startup and shutdown order is encapsulated.",
        "Individual devices remain accessible for advanced use."
      ]
    },
    badApproach: {
      text: "Every screen in the app orchestrates the devices itself.",
      code: `// Inside the mobile UI
lights.dim(10);
screen.down();
projector.on();
projector.setInput("HDMI1");
amp.on();
amp.setVolume(30);
player.on();
player.play(movie);

// And again, slightly different, inside the voice assistant...`,
      why: [
        "Orchestration order is duplicated in every caller.",
        "Callers are tightly coupled to six subsystem classes.",
        "Changing the sequence, such as adding a blind controller, means hunting down every copy."
      ]
    },
    design: [
      {
        heading: "Leave the subsystem classes alone",
        text: "They keep their own focused APIs. The facade adds to them and does not replace them.",
        code: [
          { file: "Subsystems.java", body: `class Lights    { void dim(int pct) {...}  void on() {...} }
class Screen    { void down() {...}        void up() {...} }
class Projector { void on() {...}  void off() {...}  void setInput(String in) {...} }
class Amplifier { void on() {...}  void off() {...}  void setVolume(int v) {...} }
class Player    { void on() {...}  void off() {...}  void play(String m) {...}  void stop() {...} }` }
        ]
      },
      {
        heading: "Create the facade",
        text: "It holds the subsystems and exposes a few intent-level methods. The orchestration lives here, once.",
        code: [
          { file: "HomeTheaterFacade.java", body: `public class HomeTheaterFacade {
  private final Lights lights;
  private final Screen screen;
  private final Projector projector;
  private final Amplifier amp;
  private final Player player;

  public HomeTheaterFacade(Lights lights, Screen screen, Projector projector,
                           Amplifier amp, Player player) {
    this.lights = lights;
    this.screen = screen;
    this.projector = projector;
    this.amp = amp;
    this.player = player;
  }

  public void watchMovie(String movie) {
    lights.dim(10);
    screen.down();
    projector.on();
    projector.setInput("HDMI1");
    amp.on();
    amp.setVolume(30);
    player.on();
    player.play(movie);
  }

  public void endMovie() {
    player.stop();
    player.off();
    amp.off();
    projector.off();
    screen.up();
    lights.on();
  }
}` }
        ]
      },
      {
        heading: "Callers use the simple API",
        text: "Clients depend on one class and one intent-level method.",
        code: [
          { file: "RemoteApp.java", body: `HomeTheaterFacade theater = new HomeTheaterFacade(lights, screen, projector, amp, player);

theater.watchMovie("Inception");
// ...
theater.endMovie();` }
        ],
        note: "The facade does not hide the subsystem. Power users can still hold a `Projector` directly. It just offers a convenient default path."
      }
    ],
    usage: {
      text: "Facades are commonly exposed at module boundaries. A service class that orchestrates repositories, validators and notifiers behind one method is a facade in practice.",
      code: [
        { file: "OrderFacade.java", body: `public class OrderFacade {
  private final InventoryService inventory;
  private final PaymentService payments;
  private final ShippingService shipping;
  private final NotificationService notifications;

  public OrderConfirmation placeOrder(Cart cart, PaymentDetails details) {
    inventory.reserve(cart.items());
    Receipt receipt = payments.charge(details, cart.total());
    Shipment shipment = shipping.schedule(cart.address(), cart.items());
    notifications.sendConfirmation(cart.customer(), receipt, shipment);
    return new OrderConfirmation(receipt, shipment);
  }
}` }
      ]
    },
    whenToUse: [
      "A subsystem has many classes and most callers need only a simple use case.",
      "You want to reduce coupling between clients and subsystem internals.",
      "You are layering a system and want a clear entry point per layer.",
      "You want a clean API over a messy legacy module."
    ],
    whenNotToUse: [
      "The subsystem is already simple.",
      "Clients need fine-grained control and the facade would just forward every call.",
      "You would be hiding important failures behind an oversimplified API."
    ],
    mistakes: [
      "Growing the facade into a god class that contains business logic instead of orchestration.",
      "Making the facade the only way in, so power users have no escape hatch.",
      "Swallowing subsystem errors and returning vague results.",
      "Calling any service class a facade. A facade specifically simplifies access to a group of collaborators."
    ],
    deepDive: [
      {
        title: "Facade vs Adapter vs Mediator",
        text: "**Adapter** changes one interface into another. **Facade** defines a new, simpler interface over many classes. **Mediator** coordinates peers that talk to each other, and the peers know about the mediator. A facade is one-directional: clients call it, the subsystem is unaware of it."
      },
      {
        title: "Multiple facades per subsystem",
        text: "Avoid a single bloated facade. Split by use case, such as `OrderFacade` and `ReturnsFacade`, so each remains small and focused. They can share the same underlying services."
      }
    ],
    usedIn: [
      "Online ordering: checkout orchestrating inventory, payment, shipping and notifications.",
      "Library management or hotel booking: one service over several managers.",
      "Video converter or media library wrappers hiding codecs and file handling.",
      "SDK design: a single client object over many low-level API calls."
    ],
    related: ["adapter", "mediator", "singleton", "abstract-factory"]
  },
  {
    id: "flyweight",
    name: "Flyweight",
    category: "structural",
    difficulty: "hard",
    understanding: "Flyweight saves memory by sharing the common, unchanging part of many similar objects, and passing the unique, changing part in from outside when it is needed.",
    problem: {
      intro: "You are designing a text editor that must render documents with hundreds of thousands of characters. Memory usage is becoming a problem.",
      dialogue: [
        { who: "you", text: "How is each character represented right now?" },
        { who: "int", text: "As a `Character` object holding its value, font, size, colour and position." },
        { who: "you", text: "Do many characters share the same font, size and colour?" },
        { who: "int", text: "Almost all of them. A document might use five style combinations." },
        { who: "you", text: "Then the style data is duplicated hundreds of thousands of times." },
        { who: "int", text: "Exactly. Memory grows with the document, and we're hitting limits." }
      ],
      requirements: [
        "Render documents with hundreds of thousands of characters.",
        "Each character can have its own position.",
        "Memory should scale with the number of distinct styles, not characters."
      ]
    },
    badApproach: {
      text: "Every character carries its own full copy of the styling data.",
      code: `class Glyph {
  char value;
  String fontFamily;   // "Arial" repeated everywhere
  int fontSize;        // 12 repeated everywhere
  String color;        // "black" repeated everywhere
  int x, y;
}

List<Glyph> doc = new ArrayList<>();  // 500,000 of these`,
      why: [
        "Font family, size and colour are copied into every object.",
        "Memory grows linearly with document length for data that barely varies.",
        "Changing a shared style means updating every glyph."
      ]
    },
    design: [
      {
        heading: "Split intrinsic from extrinsic state",
        text: "**Intrinsic** state is shared and immutable, here the style. **Extrinsic** state is unique per use and supplied by the caller, here the position and the character itself.",
        code: [
          { file: "StateSplit.txt", body: `Intrinsic (shared, immutable):  fontFamily, fontSize, color
Extrinsic (per use, passed in): value, x, y` }
        ]
      },
      {
        heading: "Create the immutable flyweight",
        text: "The flyweight stores only intrinsic state and must be immutable, because many clients share one instance.",
        code: [
          { file: "TextStyle.java", body: `public final class TextStyle {
  private final String fontFamily;
  private final int fontSize;
  private final String color;

  TextStyle(String fontFamily, int fontSize, String color) {
    this.fontFamily = fontFamily;
    this.fontSize = fontSize;
    this.color = color;
  }

  public void draw(char value, int x, int y, Canvas canvas) {
    canvas.drawChar(value, x, y, fontFamily, fontSize, color);
  }
}` }
        ]
      },
      {
        heading: "Add a flyweight factory that caches instances",
        text: "Clients never call `new TextStyle(...)`. They ask the factory, which returns an existing instance when one matches.",
        code: [
          { file: "TextStyleFactory.java", body: `public class TextStyleFactory {
  private final Map<String, TextStyle> cache = new HashMap<>();

  public TextStyle get(String fontFamily, int fontSize, String color) {
    String key = fontFamily + "|" + fontSize + "|" + color;
    return cache.computeIfAbsent(key,
        k -> new TextStyle(fontFamily, fontSize, color));
  }

  public int distinctStyles() { return cache.size(); }
}` }
        ]
      },
      {
        heading: "Keep lightweight context objects",
        text: "Each glyph now stores only a character, a position and a reference to a shared style.",
        code: [
          { file: "Glyph.java", body: `public class Glyph {
  private final char value;
  private final int x, y;
  private final TextStyle style;   // shared, not copied

  public Glyph(char value, int x, int y, TextStyle style) {
    this.value = value;
    this.x = x;
    this.y = y;
    this.style = style;
  }

  public void draw(Canvas canvas) {
    style.draw(value, x, y, canvas);
  }
}` }
        ],
        note: "500,000 glyphs with 5 styles now means 500,000 small objects and only **5** style objects instead of 500,000 copies."
      }
    ],
    usage: {
      text: "Build the document by asking the factory for styles. Equal styles are literally the same object.",
      code: [
        { file: "Main.java", body: `TextStyleFactory styles = new TextStyleFactory();
List<Glyph> doc = new ArrayList<>();

TextStyle body = styles.get("Arial", 12, "black");
TextStyle heading = styles.get("Arial", 24, "navy");

doc.add(new Glyph('H', 0, 0, heading));
doc.add(new Glyph('i', 20, 0, heading));
doc.add(new Glyph('a', 0, 40, body));

System.out.println(styles.distinctStyles()); // 2
System.out.println(styles.get("Arial", 12, "black") == body); // true` }
      ]
    },
    whenToUse: [
      "An application creates a huge number of similar objects.",
      "Memory is measurably the bottleneck.",
      "Most object state can be made intrinsic and immutable.",
      "Object identity does not matter to clients."
    ],
    whenNotToUse: [
      "You have only a few objects. The added indirection is not worth it.",
      "There is little shared state between objects.",
      "You have not measured memory and are optimising early."
    ],
    mistakes: [
      "Making the flyweight mutable, so changing one user's value affects every other user.",
      "Forgetting the factory and constructing duplicates, which defeats the purpose.",
      "Storing extrinsic state in the flyweight.",
      "Using it for readability rather than memory. Its only purpose is to save memory."
    ],
    deepDive: [
      {
        title: "Java already does this",
        text: "`Integer.valueOf(127)` returns a cached instance for small values, and string literals are interned. These are flyweight-style optimisations built on immutable shared objects.",
        code: [
          { file: "JdkFlyweights.java", body: `Integer a = Integer.valueOf(100);
Integer b = Integer.valueOf(100);
System.out.println(a == b);   // true, cached

String s1 = "hello";
String s2 = "hello";
System.out.println(s1 == s2); // true, interned` }
        ]
      },
      {
        title: "Thread safety and cache growth",
        text: "A shared factory used from many threads needs a thread-safe map such as `ConcurrentHashMap`. Also bound the cache if the key space is large, or you trade object duplication for a memory leak. Weak references or an LRU policy are common solutions."
      }
    ],
    usedIn: [
      "Text editor character rendering.",
      "Game engines: thousands of trees or bullets sharing mesh and texture data.",
      "Chess or board game piece types shared across positions.",
      "Map applications with many markers sharing icon data."
    ],
    related: ["singleton", "factory-method", "composite", "state"]
  },
  {
    id: "proxy",
    name: "Proxy",
    category: "structural",
    difficulty: "medium",
    understanding: "Proxy places a stand-in object with the same interface in front of a real one, so it can control access, delay creation, or add checks before the real object is used.",
    problem: {
      intro: "You are designing an image gallery that shows high-resolution photos. Loading each image from disk or network is expensive, but most images are never opened.",
      dialogue: [
        { who: "you", text: "How many images does the gallery list at once?" },
        { who: "int", text: "Thousands. Users scroll through thumbnails and open only a few." },
        { who: "you", text: "Is loading an image the expensive part?" },
        { who: "int", text: "Yes, a full-resolution load takes hundreds of milliseconds." },
        { who: "you", text: "So we shouldn't load until someone actually views it." },
        { who: "int", text: "Right. But the rest of the app should not need to know about that." }
      ],
      requirements: [
        "Listing images must be cheap and must not load pixel data.",
        "The image loads the first time it is displayed, and is reused afterwards.",
        "Calling code uses one common interface for any image."
      ]
    },
    badApproach: {
      text: "Load every image up front when the gallery is created.",
      code: `class Gallery {
  private final List<Image> images = new ArrayList<>();

  Gallery(List<String> paths) {
    for (String path : paths) {
      images.add(new RealImage(path));   // reads full file from disk
    }
  }
}`,
      why: [
        "Startup time and memory scale with the whole library, not what the user views.",
        "Most loaded images are never displayed.",
        "Adding lazy loading directly into `RealImage` mixes loading policy with rendering."
      ]
    },
    design: [
      {
        heading: "Define the subject interface",
        text: "The real object and the proxy both implement it, so clients cannot tell them apart.",
        code: [
          { file: "Image.java", body: `public interface Image {
  String name();
  void display();
}` }
        ]
      },
      {
        heading: "Implement the real subject",
        text: "`RealImage` does the expensive work in its constructor, which is exactly what we want to postpone.",
        code: [
          { file: "RealImage.java", body: `public class RealImage implements Image {
  private final String path;
  private final byte[] pixels;

  public RealImage(String path) {
    this.path = path;
    this.pixels = Disk.readAll(path);   // slow
  }

  public String name() { return path; }

  public void display() {
    Screen.render(pixels);
  }
}` }
        ]
      },
      {
        heading: "Write the virtual proxy",
        text: "The proxy knows only the path. It creates the real image on first use and delegates afterwards.",
        code: [
          { file: "LazyImageProxy.java", body: `public class LazyImageProxy implements Image {
  private final String path;
  private RealImage real;   // created lazily

  public LazyImageProxy(String path) {
    this.path = path;
  }

  public String name() { return path; }   // cheap, no load

  public void display() {
    if (real == null) {
      real = new RealImage(path);
    }
    real.display();
  }
}` }
        ],
        note: "`name()` never triggers a load. Listing thousands of proxies costs almost nothing."
      },
      {
        heading: "A second kind: protection proxy",
        text: "The same structure can guard access. This proxy checks permissions before forwarding.",
        code: [
          { file: "ProtectedImageProxy.java", body: `public class ProtectedImageProxy implements Image {
  private final Image target;
  private final User viewer;

  public ProtectedImageProxy(Image target, User viewer) {
    this.target = target;
    this.viewer = viewer;
  }

  public String name() { return target.name(); }

  public void display() {
    if (!viewer.canView(target)) {
      throw new AccessDeniedException(target.name());
    }
    target.display();
  }
}` }
        ]
      }
    ],
    usage: {
      text: "The gallery holds `Image` references and never knows which kind it received.",
      code: [
        { file: "Main.java", body: `List<Image> gallery = new ArrayList<>();
for (String path : paths) {
  gallery.add(new LazyImageProxy(path));   // instant
}

gallery.get(42).display();   // loads now
gallery.get(42).display();   // already loaded` }
      ]
    },
    whenToUse: [
      "Lazy initialisation of expensive objects (virtual proxy).",
      "Access control or authorisation in front of an object (protection proxy).",
      "A local stand-in for something remote (remote proxy).",
      "Caching, logging or metrics around calls without changing the target (smart proxy)."
    ],
    whenNotToUse: [
      "The object is cheap and always needed.",
      "You are adding new capabilities rather than controlling access. That is closer to Decorator.",
      "A simple null check or lazy field in the class is clearer."
    ],
    mistakes: [
      "A proxy that exposes a different interface from the real subject, which breaks substitution.",
      "Not making lazy initialisation thread-safe when the proxy is shared.",
      "Putting business logic in the proxy instead of access control or lifecycle concerns.",
      "Confusing it with Decorator. Both wrap, but Proxy manages access and lifecycle of the same object, while Decorator enriches behaviour."
    ],
    deepDive: [
      {
        title: "Thread-safe lazy loading",
        text: "If several threads call `display()` at once on a shared proxy, the image may load more than once. Guard creation with double-checked locking and a `volatile` field, or use a holder class.",
        code: [
          { file: "SafeLazyProxy.java", body: `private volatile RealImage real;

public void display() {
  RealImage local = real;
  if (local == null) {
    synchronized (this) {
      local = real;
      if (local == null) {
        real = local = new RealImage(path);
      }
    }
  }
  local.display();
}` }
        ]
      },
      {
        title: "Dynamic proxies for cross-cutting concerns",
        text: "Writing one proxy class per interface becomes tedious. Java's `java.lang.reflect.Proxy` generates them at runtime, which is how frameworks implement logging, transactions and security around arbitrary interfaces.",
        code: [
          { file: "LoggingProxy.java", body: `Image logged = (Image) Proxy.newProxyInstance(
    Image.class.getClassLoader(),
    new Class<?>[] { Image.class },
    (proxy, method, args) -> {
      System.out.println("calling " + method.getName());
      return method.invoke(realImage, args);
    });` }
        ]
      }
    ],
    usedIn: [
      "Image or document viewers with lazy loading.",
      "Rate Limiter or access-control wrappers in front of a service.",
      "Caching layers in front of a database or API client.",
      "ORM lazy-loaded relationships and RPC client stubs."
    ],
    related: ["decorator", "adapter", "facade", "singleton"]
  }
);
