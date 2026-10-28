window.SCENARIOS = window.SCENARIOS || [];
window.SCENARIOS.push(
  {
    "id": "add-new-payment-method",
    "prompt": "\"Today we accept cards and UPI. Next quarter product wants wallets, buy-now-pay-later and maybe crypto. How does your design absorb that?\"",
    "context": "You have a checkout that charges the customer and returns a receipt. The first version had two payment types, and the interviewer wants to see what happens to the code on the day a third, fourth and fifth arrive.\n\nThey are listening for two things: that you can name the thing that varies (how the money is collected), and that you can keep the code that does not vary (checkout, receipts, retries) from changing every time.",
    "whyHard": "The trap is that the first version works. A `switch` on the payment type is perfectly readable at two cases, so nothing hurts until the fifth case, when every new method edits the same method, each edit risks breaking the others, and every method pulls its own imports and SDK into the checkout class.\n\nThe skill is not memorising \"use Strategy\". It is knowing when the extra structure pays for itself, and what to do when a payment method is a third-party SDK whose shape you cannot change.",
    "options": [
      {
        "name": "Enum plus switch",
        "concept": "Keep it simple (KISS / YAGNI)",
        "conceptIds": [
          "kiss",
          "yagni"
        ],
        "how": "One enum value per method and a `switch` in the service. Each branch is a couple of lines. There are no interfaces, no registry and nothing to wire up, so a new engineer can read the whole flow top to bottom.",
        "code": [
          {
            "file": "PaymentService.java",
            "body": "enum PaymentType { CARD, UPI }\n\nrecord Receipt(String id, long amountPaise) {}\n\nclass PaymentService {\n    Receipt pay(PaymentType type, long amountPaise) {\n        switch (type) {\n            case CARD:\n                return new Receipt(\"card-\" + amountPaise, amountPaise);\n            case UPI:\n                return new Receipt(\"upi-\" + amountPaise, amountPaise);\n            default:\n                throw new IllegalArgumentException(\"Unsupported payment type: \" + type);\n        }\n    }\n}\n"
          }
        ],
        "pros": [
          "Fastest to write and easiest to read",
          "Everything about payments is in one place",
          "No indirection to debug"
        ],
        "cons": [
          "Every new method edits the same class (breaks the Open/Closed Principle)",
          "Branches grow and start sharing awkward state",
          "Hard to unit test one method in isolation"
        ],
        "pickWhen": "There are two or three fixed methods and no sign of more, or this is the first version and you want to ship."
      },
      {
        "name": "One class per method behind an interface",
        "concept": "Strategy pattern",
        "conceptIds": [
          "strategy",
          "ocp",
          "interfaces"
        ],
        "how": "Extract `PaymentMethod` with a single `pay` operation. Each way of paying is its own class, and the checkout depends only on the interface. Adding wallets is a new class: you do not edit `CheckoutService` or the other methods.",
        "code": [
          {
            "file": "CheckoutService.java",
            "body": "record Receipt(String id, long amountPaise) {}\n\ninterface PaymentMethod {\n    Receipt pay(long amountPaise);\n}\n\nclass CardPayment implements PaymentMethod {\n    public Receipt pay(long amountPaise) { return new Receipt(\"card-\" + amountPaise, amountPaise); }\n}\n\nclass UpiPayment implements PaymentMethod {\n    public Receipt pay(long amountPaise) { return new Receipt(\"upi-\" + amountPaise, amountPaise); }\n}\n\nclass CheckoutService {\n    private final PaymentMethod method;\n    CheckoutService(PaymentMethod method) { this.method = method; }\n    Receipt checkout(long amountPaise) { return method.pay(amountPaise); }\n}\n"
          }
        ],
        "pros": [
          "Open for extension, closed for modification",
          "Each method can be tested alone",
          "Checkout code stays the same as methods are added"
        ],
        "cons": [
          "More files and a little ceremony",
          "Something still has to choose which strategy to use"
        ],
        "pickWhen": "You expect several more methods, or different teams own different methods."
      },
      {
        "name": "Strategy plus a registry keyed by name",
        "concept": "Factory / registry on top of Strategy",
        "conceptIds": [
          "factory-method",
          "dip",
          "strategy"
        ],
        "how": "Keep the interface, and add a registry that maps a key from the request (`\"wallet\"`) to an implementation. The choice becomes data, so the new method is one `register` line at startup. Unknown keys fail fast with a clear message.",
        "code": [
          {
            "file": "PaymentRegistry.java",
            "body": "import java.util.HashMap;\nimport java.util.Map;\n\nrecord Receipt(String id, long amountPaise) {}\n\ninterface PaymentMethod {\n    Receipt pay(long amountPaise);\n}\n\nclass PaymentRegistry {\n    private final Map<String, PaymentMethod> methods = new HashMap<>();\n\n    void register(String key, PaymentMethod method) {\n        if (methods.putIfAbsent(key, method) != null) {\n            throw new IllegalStateException(\"Already registered: \" + key);\n        }\n    }\n\n    PaymentMethod get(String key) {\n        PaymentMethod method = methods.get(key);\n        if (method == null) throw new IllegalArgumentException(\"Unknown payment method: \" + key);\n        return method;\n    }\n}\n\nclass Bootstrap {\n    static PaymentRegistry build() {\n        PaymentRegistry registry = new PaymentRegistry();\n        registry.register(\"card\", amount -> new Receipt(\"card-\" + amount, amount));\n        registry.register(\"upi\", amount -> new Receipt(\"upi-\" + amount, amount));\n        registry.register(\"wallet\", amount -> new Receipt(\"wallet-\" + amount, amount)); // the new method: one line\n        return registry;\n    }\n}\n"
          }
        ],
        "pros": [
          "No `if` or `switch` anywhere in checkout",
          "Adding a method touches only the bootstrap code",
          "Can be driven from config or feature flags"
        ],
        "cons": [
          "Keys are strings, so typos surface at runtime",
          "Registration order and duplicates need care"
        ],
        "pickWhen": "The method comes from the request or config, or you want plug-ins and feature flags per method."
      },
      {
        "name": "Adapt each vendor SDK to your interface",
        "concept": "Adapter pattern",
        "conceptIds": [
          "adapter",
          "interfaces"
        ],
        "how": "When a method is really a third-party SDK with its own signature, wrap it in a small class that implements `PaymentMethod` and translates amounts, currencies and errors. The rest of the system never sees the vendor types.",
        "code": [
          {
            "file": "StripeAdapter.java",
            "body": "record Receipt(String id, long amountPaise) {}\n\ninterface PaymentMethod {\n    Receipt pay(long amountPaise);\n}\n\n// Third-party SDK: we cannot change its signature.\nclass StripeSdk {\n    String charge(int amountMinorUnits, String currency) {\n        return \"ch_\" + amountMinorUnits + currency;\n    }\n}\n\nclass StripeAdapter implements PaymentMethod {\n    private final StripeSdk sdk;\n    StripeAdapter(StripeSdk sdk) { this.sdk = sdk; }\n\n    public Receipt pay(long amountPaise) {\n        String chargeId = sdk.charge(Math.toIntExact(amountPaise), \"INR\");\n        return new Receipt(chargeId, amountPaise);\n    }\n}\n"
          }
        ],
        "pros": [
          "Vendor quirks stay in one class",
          "Swapping a provider changes one adapter",
          "Your domain stays free of SDK types"
        ],
        "cons": [
          "Adapters can leak vendor error semantics if you are careless",
          "One more layer to maintain"
        ],
        "pickWhen": "A payment method is an external SDK or API you cannot change, which is most real payment providers."
      }
    ],
    "recommendation": "I would start with the interface (option 2), because payment methods are the textbook case of behaviour that grows, and put real providers behind adapters (option 4). I would add the registry (option 3) only when methods become configurable per tenant or per request.\n\nIf the interviewer says there will only ever be card and UPI, I would happily keep the enum and switch and say why. The point is to show you can justify either, not that you always reach for a pattern.",
    "say": "\"The thing that varies is how we collect money, so I would put that behind a `PaymentMethod` interface and keep checkout ignorant of the details. Real providers go in adapters so vendor types never leak. A registry only if we need methods to be configurable. For two stable methods a switch is fine, and I would not add the structure until the third one shows up.\"",
    "appearsIn": [
      "movie-ticket-booking",
      "car-rental-system",
      "digital-wallet",
      "shopping-cart-system"
    ],
    "related": [
      "add-new-pricing-rule",
      "swap-storage-backend",
      "strategy",
      "ocp"
    ]
  },
  {
    "id": "add-new-pricing-rule",
    "prompt": "\"Add surge pricing. Then a 10% coupon. Then a loyalty discount. They can stack, and the order matters. How do you keep that manageable?\"",
    "context": "A ride or order has a base price. Pricing started as one formula, and now rules are arriving: some apply to everyone (surge), some only with a code (coupon), and some combine.\n\nThe interviewer is probing whether you can separate rules that replace each other from rules that stack, because those need different designs.",
    "whyHard": "\"Pricing rule\" hides two different relationships. Standard versus surge pricing are alternatives: you pick one. Surge plus coupon plus loyalty are layers: each takes the result of the previous one. If you model layers as alternatives, you either lose the stacking or explode into a class for every combination.\n\nOrder also matters: 10% off then 50% surge is not the same as the reverse, and a design that hides the order will be wrong in production before anyone notices.",
    "options": [
      {
        "name": "Flags and conditionals in one calculator",
        "concept": "Keep it simple (KISS / YAGNI)",
        "conceptIds": [
          "kiss",
          "yagni"
        ],
        "how": "One method takes the base price plus a boolean per rule and applies each in a fixed order. The order is visible on the page, which is its main virtue.",
        "code": [
          {
            "file": "FareCalculator.java",
            "body": "class FareCalculator {\n    long fare(long basePaise, boolean surge, boolean coupon) {\n        long fare = basePaise;\n        if (surge) fare = fare * 150 / 100;\n        if (coupon) fare = fare * 90 / 100;\n        return fare;\n    }\n}\n"
          }
        ],
        "pros": [
          "Order of rules is obvious",
          "Trivial to read and debug",
          "No abstractions to learn"
        ],
        "cons": [
          "Signature gets a new parameter per rule",
          "Every rule edits the same method",
          "Rules cannot be reordered or configured"
        ],
        "pickWhen": "Two rules, fixed order, and you do not expect a third."
      },
      {
        "name": "Pick one pricing strategy per ride",
        "concept": "Strategy pattern",
        "conceptIds": [
          "strategy",
          "ocp"
        ],
        "how": "Define `PricingStrategy` and give each ride exactly one implementation (standard, surge, flat airport rate). It is a clean answer when the rules are mutually exclusive.",
        "code": [
          {
            "file": "PricingStrategy.java",
            "body": "interface PricingStrategy {\n    long price(long basePaise);\n}\n\nclass StandardPricing implements PricingStrategy {\n    public long price(long basePaise) { return basePaise; }\n}\n\nclass SurgePricing implements PricingStrategy {\n    private final int percent;\n    SurgePricing(int percent) { this.percent = percent; }\n    public long price(long basePaise) { return basePaise * percent / 100; }\n}\n\nclass Ride {\n    private final long basePaise;\n    private final PricingStrategy pricing;\n    Ride(long basePaise, PricingStrategy pricing) { this.basePaise = basePaise; this.pricing = pricing; }\n    long fare() { return pricing.price(basePaise); }\n}\n"
          }
        ],
        "pros": [
          "Each rule is isolated and testable",
          "Adding a rule is a new class",
          "Very easy to explain"
        ],
        "cons": [
          "One strategy per ride, so stacking is not supported",
          "Combining rules needs a new class per combination"
        ],
        "pickWhen": "Rules are alternatives, not layers: you choose one by city, vehicle type or time."
      },
      {
        "name": "Wrap the price in stackable decorators",
        "concept": "Decorator pattern",
        "conceptIds": [
          "decorator",
          "composition"
        ],
        "how": "A `Price` interface with a base implementation. Surge and coupon are decorators that wrap another `Price` and adjust its amount. You build the stack that applies to this ride, and the nesting order is the application order.",
        "code": [
          {
            "file": "PriceDecorators.java",
            "body": "interface Price {\n    long amount();\n}\n\nclass BasePrice implements Price {\n    private final long paise;\n    BasePrice(long paise) { this.paise = paise; }\n    public long amount() { return paise; }\n}\n\nclass SurgeDecorator implements Price {\n    private final Price inner;\n    private final int percent;\n    SurgeDecorator(Price inner, int percent) { this.inner = inner; this.percent = percent; }\n    public long amount() { return inner.amount() * percent / 100; }\n}\n\nclass CouponDecorator implements Price {\n    private final Price inner;\n    private final int percentOff;\n    CouponDecorator(Price inner, int percentOff) { this.inner = inner; this.percentOff = percentOff; }\n    public long amount() { return inner.amount() * (100 - percentOff) / 100; }\n}\n\nclass Pricing {\n    // Stack whatever applies to this ride, in the order you want it applied.\n    static Price build() {\n        return new CouponDecorator(new SurgeDecorator(new BasePrice(10_000), 150), 10);\n    }\n}\n"
          }
        ],
        "pros": [
          "Rules stack in any combination without new classes",
          "Each layer is tiny and testable",
          "Order is explicit in how you nest them"
        ],
        "cons": [
          "Deep nesting is awkward to read and debug",
          "Someone must decide which decorators apply to which ride"
        ],
        "pickWhen": "Rules are layers that combine, and the set of layers differs per ride."
      },
      {
        "name": "An ordered list of rules run by an engine",
        "concept": "Chain of Responsibility / pipeline",
        "conceptIds": [
          "chain-of-responsibility",
          "ocp"
        ],
        "how": "Each rule decides for itself whether it applies, using a context object (peak hour, coupon code). A `PricingEngine` runs the list in order, feeding each output into the next. The list can come from config.",
        "code": [
          {
            "file": "PricingEngine.java",
            "body": "import java.util.List;\n\nrecord PricingContext(boolean peakHour, String couponCode) {}\n\ninterface PriceRule {\n    long apply(long pricePaise, PricingContext ctx);\n}\n\nclass SurgeRule implements PriceRule {\n    public long apply(long price, PricingContext ctx) {\n        return ctx.peakHour() ? price * 150 / 100 : price;\n    }\n}\n\nclass CouponRule implements PriceRule {\n    public long apply(long price, PricingContext ctx) {\n        return \"SAVE10\".equals(ctx.couponCode()) ? price * 90 / 100 : price;\n    }\n}\n\nclass PricingEngine {\n    private final List<PriceRule> rules; // order matters: surge first, then discounts\n\n    PricingEngine(List<PriceRule> rules) { this.rules = List.copyOf(rules); }\n\n    long price(long basePaise, PricingContext ctx) {\n        long price = basePaise;\n        for (PriceRule rule : rules) price = rule.apply(price, ctx);\n        return price;\n    }\n}\n"
          }
        ],
        "pros": [
          "Rules are data: reorder, add or disable without code changes",
          "Each rule keeps its applicability logic with it",
          "Easy to log the price after each step"
        ],
        "cons": [
          "The context object tends to grow",
          "Rules depending on each other's output are easy to get wrong"
        ],
        "pickWhen": "Many rules, often changing, with a clear order that the business wants to configure."
      }
    ],
    "recommendation": "I would first ask: do rules stack? If no, Strategy (option 2) is enough and I would stop there. If yes, I prefer the ordered rule list (option 4) over decorators, because pricing order is a business decision that should be visible, loggable and configurable, whereas decorator nesting hides it inside object construction.\n\nWhichever I choose, I would keep money in the smallest unit (paise or cents) as an integer, and add a test that pins the order of surge and discount.",
    "say": "\"First I would clarify whether rules replace each other or stack. Alternatives are a Strategy. Layers are a pipeline of rules applied in an explicit order, because the order changes the price and the business will want to see it. Decorators give the same stacking but hide the order in how objects are nested. I would test the order explicitly.\"",
    "appearsIn": [
      "ride-sharing",
      "car-rental-system",
      "parking-lot",
      "online-food-delivery"
    ],
    "related": [
      "add-new-payment-method",
      "strategy",
      "decorator",
      "chain-of-responsibility"
    ]
  },
  {
    "id": "add-new-notification-channel",
    "prompt": "\"We send order emails. Now product wants SMS, push and WhatsApp, and users choose which ones they get. How do you extend it?\"",
    "context": "Notifications start as one method that sends an email. The interviewer then adds new channels and per-user preferences, and finally asks you to send different kinds of messages (OTP, promo) on any channel.\n\nThis question is often really about how many things are varying: the channel, the message type, and who decides when to notify.",
    "whyHard": "Three concerns tend to get tangled: who triggers a notification (the order service), how a message is delivered (a channel), and what the message says (OTP versus promo). If you solve only one, the others grow `if` statements. If you subclass on both channel and message type you get a class per combination.\n\nYou also have to decide whether the order service should know about notifications at all, or whether it should just announce that something happened.",
    "options": [
      {
        "name": "If/else on the channel name",
        "concept": "Keep it simple (KISS / YAGNI)",
        "conceptIds": [
          "kiss",
          "yagni"
        ],
        "how": "A `Notifier` with a branch per channel. Perfectly reasonable while email is the only channel and SMS is a maybe.",
        "code": [
          {
            "file": "Notifier.java",
            "body": "class Notifier {\n    void notifyUser(String channel, String to, String message) {\n        if (channel.equals(\"email\")) {\n            System.out.println(\"EMAIL to \" + to + \": \" + message);\n        } else if (channel.equals(\"sms\")) {\n            System.out.println(\"SMS to \" + to + \": \" + message);\n        } else {\n            throw new IllegalArgumentException(\"Unknown channel: \" + channel);\n        }\n    }\n}\n"
          }
        ],
        "pros": [
          "Nothing to learn",
          "Fine for one or two channels"
        ],
        "cons": [
          "Each channel edits this class",
          "No per-user preferences",
          "Channel code and orchestration are mixed"
        ],
        "pickWhen": "A single channel today and you want to ship before designing for hypothetical ones."
      },
      {
        "name": "One class per channel, chosen by user preference",
        "concept": "Strategy pattern",
        "conceptIds": [
          "strategy",
          "interfaces",
          "ocp"
        ],
        "how": "A `Channel` interface with `Email` and `Sms` implementations. The service holds a map of channel name to implementation and sends on every channel the user has opted into. A new channel is a new class and one map entry.",
        "code": [
          {
            "file": "NotificationService.java",
            "body": "import java.util.Map;\n\ninterface Channel {\n    void send(String to, String message);\n}\n\nclass EmailChannel implements Channel {\n    public void send(String to, String message) { System.out.println(\"EMAIL to \" + to + \": \" + message); }\n}\n\nclass SmsChannel implements Channel {\n    public void send(String to, String message) { System.out.println(\"SMS to \" + to + \": \" + message); }\n}\n\nclass NotificationService {\n    private final Map<String, Channel> channels;\n\n    NotificationService(Map<String, Channel> channels) { this.channels = Map.copyOf(channels); }\n\n    // addresses: channel name -> the address the user chose to receive on\n    void notifyUser(Map<String, String> addresses, String message) {\n        for (Map.Entry<String, String> e : addresses.entrySet()) {\n            Channel channel = channels.get(e.getKey());\n            if (channel != null) channel.send(e.getValue(), message);\n        }\n    }\n}\n"
          }
        ],
        "pros": [
          "Adding a channel does not touch existing ones",
          "Natural place for user preferences",
          "Channels are easy to fake in tests"
        ],
        "cons": [
          "The caller still has to invoke the notification service explicitly",
          "Retries and rate limits need their own design"
        ],
        "pickWhen": "The main question is how to deliver, and callers are happy to call the service directly."
      },
      {
        "name": "Publish an event and let channels subscribe",
        "concept": "Observer pattern",
        "conceptIds": [
          "observer",
          "dip"
        ],
        "how": "The order service publishes an `OrderPlaced` event and knows nothing about notifications. Each channel (or a notification service) subscribes and decides whether to act. Adding WhatsApp is a new subscriber, with no change to the order code.",
        "code": [
          {
            "file": "EventBus.java",
            "body": "import java.util.ArrayList;\nimport java.util.List;\n\nrecord OrderPlaced(String userId, String orderId) {}\n\ninterface Subscriber<E> {\n    void on(E event);\n}\n\nclass EventBus<E> {\n    private final List<Subscriber<E>> subscribers = new ArrayList<>();\n\n    void subscribe(Subscriber<E> subscriber) { subscribers.add(subscriber); }\n\n    void publish(E event) {\n        for (Subscriber<E> s : subscribers) s.on(event);\n    }\n}\n\nclass SmsOnOrderPlaced implements Subscriber<OrderPlaced> {\n    public void on(OrderPlaced e) {\n        System.out.println(\"SMS to \" + e.userId() + \": order \" + e.orderId() + \" placed\");\n    }\n}\n\nclass OrderService {\n    private final EventBus<OrderPlaced> bus;\n\n    OrderService(EventBus<OrderPlaced> bus) { this.bus = bus; }\n\n    void place(String userId, String orderId) {\n        // ... persist the order ...\n        bus.publish(new OrderPlaced(userId, orderId)); // knows nothing about email, SMS or push\n    }\n}\n"
          }
        ],
        "pros": [
          "Producer and consumers are fully decoupled",
          "Many reactions per event (email, analytics, loyalty) for free",
          "Fits an async queue when you scale"
        ],
        "cons": [
          "Control flow is harder to follow",
          "In-process delivery is synchronous and can fail halfway"
        ],
        "pickWhen": "Several unrelated things should react to the same business event, or you plan to go async."
      },
      {
        "name": "Separate the message type from the channel",
        "concept": "Bridge pattern",
        "conceptIds": [
          "bridge",
          "composition"
        ],
        "how": "Message types (`OtpMessage`, `PromoMessage`) hold a `Channel` and decide the text. Channels decide how to deliver. Two independent hierarchies compose at runtime, so N message types and M channels cost N + M classes instead of N × M.",
        "code": [
          {
            "file": "Message.java",
            "body": "interface Channel {\n    void deliver(String to, String body);\n}\n\nclass EmailChannel implements Channel {\n    public void deliver(String to, String body) { System.out.println(\"EMAIL to \" + to + \": \" + body); }\n}\n\nclass WhatsAppChannel implements Channel {\n    public void deliver(String to, String body) { System.out.println(\"WHATSAPP to \" + to + \": \" + body); }\n}\n\nabstract class Message {\n    protected final Channel channel;\n    Message(Channel channel) { this.channel = channel; }\n    abstract void sendTo(String to);\n}\n\nclass OtpMessage extends Message {\n    private final String code;\n    OtpMessage(Channel channel, String code) { super(channel); this.code = code; }\n    void sendTo(String to) { channel.deliver(to, \"Your OTP is \" + code); }\n}\n\nclass PromoMessage extends Message {\n    private final String offer;\n    PromoMessage(Channel channel, String offer) { super(channel); this.offer = offer; }\n    void sendTo(String to) { channel.deliver(to, \"Special offer: \" + offer); }\n}\n"
          }
        ],
        "pros": [
          "Avoids the class-per-combination explosion",
          "Message and channel can evolve independently"
        ],
        "cons": [
          "Overkill if only one dimension varies",
          "Two hierarchies to understand"
        ],
        "pickWhen": "Both the message kinds and the delivery channels keep growing."
      }
    ],
    "recommendation": "I would use the channel interface with user preferences (option 2) as the core, and have the order service publish events (option 3) so it never depends on notifications. If message kinds multiply too, I would apply the bridge (option 4) on top.\n\nAt scale, I would also say that delivery should go through a queue with retries and idempotency keys, which the in-process event bus does not give you.",
    "say": "\"I would separate three things: who triggers the notification, which channel delivers it, and what the message says. Triggering becomes an event so order code stays clean. Channels sit behind an interface chosen by user preference. If both messages and channels keep growing, a bridge avoids a class for every pair.\"",
    "appearsIn": [
      "notification-system",
      "pub-sub-system",
      "social-network",
      "online-food-delivery"
    ],
    "related": [
      "add-new-payment-method",
      "fan-out-to-millions",
      "observer",
      "bridge"
    ]
  },
  {
    "id": "new-vehicle-or-seat-type",
    "prompt": "\"The parking lot handles bikes, cars and trucks. Now add electric vehicles and accessible spots. (Or: the cinema has Regular and Premium seats and now wants Recliners.) What changes?\"",
    "context": "Almost every booking-style design has a type that starts as an enum: vehicle, seat, room, ticket. The interviewer adds a new type and then asks how much of your code had to change.\n\nThe honest answer depends on whether the new type differs only in data (size, price) or in behaviour (needs a charger, special pricing rule).",
    "whyHard": "Candidates reach for inheritance by reflex, then discover that an electric truck is both an electric vehicle and a truck, and a deep class tree cannot express that. Others use an enum everywhere and end up with `switch` statements in six places.\n\nThe decision hinges on a single question: does the new type change what the code does, or only the numbers it uses?",
    "options": [
      {
        "name": "Enum that carries its data",
        "concept": "Simple data-driven enum",
        "conceptIds": [
          "kiss",
          "yagni"
        ],
        "how": "Put size and rate on the enum constants. A new type is one new line, and every `switch` on type disappears because the data lives with the type.",
        "code": [
          {
            "file": "VehicleType.java",
            "body": "enum VehicleType {\n    BIKE(1, 10),\n    CAR(2, 30),\n    TRUCK(4, 80);\n\n    final int slotsNeeded;\n    final long hourlyRate;\n\n    VehicleType(int slotsNeeded, long hourlyRate) {\n        this.slotsNeeded = slotsNeeded;\n        this.hourlyRate = hourlyRate;\n    }\n\n    long feeFor(long hours) { return hourlyRate * hours; }\n}\n"
          }
        ],
        "pros": [
          "Adding a type is one line",
          "No switch statements spread around",
          "Compact and type-safe"
        ],
        "cons": [
          "Only works when types differ by data, not behaviour",
          "Prices baked in the code need a redeploy to change"
        ],
        "pickWhen": "Types differ only in numbers like size, price or capacity."
      },
      {
        "name": "Enum as a key, values in configuration",
        "concept": "Configuration over code (OCP)",
        "conceptIds": [
          "ocp",
          "dip"
        ],
        "how": "Keep the enum only as an identifier, and look up price, size and rules from a table loaded from config or a database. Marketing can change a recliner price without a deploy, and missing config fails loudly.",
        "code": [
          {
            "file": "PriceList.java",
            "body": "import java.util.EnumMap;\nimport java.util.Map;\n\nenum SeatType { REGULAR, PREMIUM, RECLINER }\n\nclass PriceList {\n    private final Map<SeatType, Long> pricePaise = new EnumMap<>(SeatType.class);\n\n    PriceList(Map<SeatType, Long> prices) { pricePaise.putAll(prices); }\n\n    long priceOf(SeatType type) {\n        Long price = pricePaise.get(type);\n        if (price == null) throw new IllegalStateException(\"No price configured for \" + type);\n        return price;\n    }\n}\n"
          }
        ],
        "pros": [
          "Change numbers without redeploying",
          "Per-tenant or per-city overrides are natural",
          "Still simple to reason about"
        ],
        "cons": [
          "Config and enum can drift apart",
          "Does not help when behaviour differs"
        ],
        "pickWhen": "Types differ in data that the business wants to change often."
      },
      {
        "name": "Subclasses with different behaviour",
        "concept": "Polymorphism and inheritance",
        "conceptIds": [
          "polymorphism",
          "inheritance"
        ],
        "how": "When a type really behaves differently (an electric car needs a charger), model it as a subclass that overrides the relevant method. The spot asks the vehicle what it needs instead of switching on its type.",
        "code": [
          {
            "file": "Vehicle.java",
            "body": "abstract class Vehicle {\n    abstract int slotsNeeded();\n    boolean needsCharger() { return false; }\n}\n\nclass Car extends Vehicle {\n    int slotsNeeded() { return 2; }\n}\n\nclass ElectricCar extends Car {\n    @Override boolean needsCharger() { return true; }\n}\n\nclass Spot {\n    private final int slots;\n    private final boolean hasCharger;\n\n    Spot(int slots, boolean hasCharger) { this.slots = slots; this.hasCharger = hasCharger; }\n\n    boolean fits(Vehicle v) {\n        return slots >= v.slotsNeeded() && (!v.needsCharger() || hasCharger);\n    }\n}\n"
          }
        ],
        "pros": [
          "Caller code does not switch on type",
          "Behaviour lives with the type that owns it"
        ],
        "cons": [
          "Hierarchies get tangled (electric truck?)",
          "Inheritance couples subclasses to parents",
          "A new type means a new class and a redeploy"
        ],
        "pickWhen": "The new type has genuinely different behaviour, and the hierarchy stays shallow and single-axis."
      },
      {
        "name": "Compose capabilities instead of types",
        "concept": "Composition over inheritance",
        "conceptIds": [
          "composition",
          "polymorphism"
        ],
        "how": "Describe what a vehicle needs and what a spot offers as sets of capabilities (charger, accessible, covered). Matching is a subset check. A new requirement is a new enum value, and combinations (electric and accessible) cost nothing.",
        "code": [
          {
            "file": "Capabilities.java",
            "body": "import java.util.Set;\n\nenum Capability { CHARGER, ACCESSIBLE, COVERED }\n\nrecord VehicleNeeds(int slots, Set<Capability> required) {}\n\nrecord Spot(int slots, Set<Capability> offers) {\n    boolean fits(VehicleNeeds needs) {\n        return slots >= needs.slots() && offers.containsAll(needs.required());\n    }\n}\n"
          }
        ],
        "pros": [
          "Combinations need no new classes",
          "Matching logic is one line and easy to test",
          "New capabilities rarely touch existing code"
        ],
        "cons": [
          "Less obvious than named types for simple cases",
          "Capability explosion if you model everything as one"
        ],
        "pickWhen": "Types are really combinations of independent features."
      }
    ],
    "recommendation": "I ask first whether the difference is data or behaviour. Data: an enum that carries its data (option 1), moving to config (option 2) if the business edits values often. Behaviour on one axis: subclasses (option 3). Behaviour from combinable features, such as EV plus accessible plus covered: capabilities (option 4).\n\nIn a parking lot or cinema interview I usually land on the enum with data plus capability sets, because it handles every follow-up (EV spots, accessible seats) without a class hierarchy.",
    "say": "\"My test is whether the new type changes numbers or behaviour. Numbers go on an enum or in config. Behaviour from independent features becomes capabilities that a spot offers and a vehicle requires, which avoids classes like ElectricAccessibleTruck. I reserve subclasses for real behavioural differences on one axis.\"",
    "appearsIn": [
      "parking-lot",
      "movie-ticket-booking",
      "car-rental-system",
      "airline-management-system"
    ],
    "related": [
      "add-new-pricing-rule",
      "enum-vs-state-pattern",
      "polymorphism",
      "composition"
    ]
  },
  {
    "id": "country-specific-rules",
    "prompt": "\"We launch in India, then the EU and the US. Tax, refund windows and invoice formats differ by country, and some enterprise tenants override them. How do you design that?\"",
    "context": "Business rules that depend on where the customer is tend to leak into every service: tax in checkout, refund windows in support, invoice layout in billing. The interviewer asks how many places change when a new country arrives.\n\nThey also bring up tenant overrides, which means the answer cannot be purely hard-coded per country.",
    "whyHard": "There are two kinds of regional difference and they need different tools. Some are just parameters (a tax rate, a number of refund days). Others are real behaviour (an invoice with a different legal structure, a US sales-tax lookup per state). Treating everything as code makes you redeploy for a rate change. Treating everything as config pushes real behaviour into a rules engine nobody can debug.\n\nA second trap is mixing rules from different regions, such as an EU tax rate with a US invoice format.",
    "options": [
      {
        "name": "Switch on country code",
        "concept": "Keep it simple (KISS / YAGNI)",
        "conceptIds": [
          "kiss",
          "yagni"
        ],
        "how": "A `switch` in the one place that needs it. For two countries and one rule it is the shortest correct code.",
        "code": [
          {
            "file": "TaxCalculator.java",
            "body": "class TaxCalculator {\n    long tax(String country, long amountPaise) {\n        switch (country) {\n            case \"IN\": return amountPaise * 18 / 100;\n            case \"DE\": return amountPaise * 19 / 100;\n            default: throw new IllegalArgumentException(\"Unsupported country: \" + country);\n        }\n    }\n}\n"
          }
        ],
        "pros": [
          "Easy to read",
          "No design to maintain"
        ],
        "cons": [
          "Every service that cares about country grows its own switch",
          "A new country means finding all of them"
        ],
        "pickWhen": "Two countries, one rule, and no plan to add more soon."
      },
      {
        "name": "One policy per rule, looked up by country",
        "concept": "Strategy pattern",
        "conceptIds": [
          "strategy",
          "factory-method",
          "ocp"
        ],
        "how": "Make tax a `TaxPolicy` and look it up from a registry by country. The US policy can be a different implementation altogether. A new country is a new registry entry.",
        "code": [
          {
            "file": "TaxPolicies.java",
            "body": "import java.util.Map;\n\ninterface TaxPolicy {\n    long tax(long amountPaise);\n}\n\nclass FlatRateTax implements TaxPolicy {\n    private final int percent;\n    FlatRateTax(int percent) { this.percent = percent; }\n    public long tax(long amountPaise) { return amountPaise * percent / 100; }\n}\n\nclass TaxPolicies {\n    private final Map<String, TaxPolicy> byCountry = Map.of(\n        \"IN\", new FlatRateTax(18),\n        \"DE\", new FlatRateTax(19),\n        \"US\", amount -> 0L // sales tax is state level and handled by its own policy\n    );\n\n    TaxPolicy forCountry(String country) {\n        TaxPolicy policy = byCountry.get(country);\n        if (policy == null) throw new IllegalArgumentException(\"Unsupported country: \" + country);\n        return policy;\n    }\n}\n"
          }
        ],
        "pros": [
          "Different behaviour per country is possible",
          "Each policy is independently testable",
          "One lookup replaces scattered switches"
        ],
        "cons": [
          "You get one registry per kind of rule",
          "Policies from different registries can be mismatched"
        ],
        "pickWhen": "A single rule varies by region and some regions need genuinely different logic."
      },
      {
        "name": "A region kit that creates a consistent family",
        "concept": "Abstract Factory pattern",
        "conceptIds": [
          "abstract-factory",
          "dip"
        ],
        "how": "`RegionFactory` creates the tax policy, invoice formatter and refund policy together. Checkout takes one factory and cannot accidentally combine an EU tax with a US invoice.",
        "code": [
          {
            "file": "RegionFactory.java",
            "body": "interface TaxPolicy { long tax(long amountPaise); }\ninterface InvoiceFormatter { String format(String orderId, long totalPaise); }\ninterface RefundPolicy { boolean canRefund(int daysSincePurchase); }\n\ninterface RegionFactory {\n    TaxPolicy tax();\n    InvoiceFormatter invoice();\n    RefundPolicy refund();\n}\n\nclass IndiaFactory implements RegionFactory {\n    public TaxPolicy tax() { return amount -> amount * 18 / 100; }\n    public InvoiceFormatter invoice() { return (id, total) -> \"GST INVOICE \" + id + \" total=\" + total; }\n    public RefundPolicy refund() { return days -> days <= 7; }\n}\n\nclass EuFactory implements RegionFactory {\n    public TaxPolicy tax() { return amount -> amount * 19 / 100; }\n    public InvoiceFormatter invoice() { return (id, total) -> \"VAT INVOICE \" + id + \" total=\" + total; }\n    public RefundPolicy refund() { return days -> days <= 14; } // EU right of withdrawal\n}\n\nclass Checkout {\n    private final RegionFactory region;\n\n    Checkout(RegionFactory region) { this.region = region; }\n\n    String complete(String orderId, long netPaise, int daysSincePurchase) {\n        long total = netPaise + region.tax().tax(netPaise);\n        return region.invoice().format(orderId, total)\n            + \" refundable=\" + region.refund().canRefund(daysSincePurchase);\n    }\n}\n"
          }
        ],
        "pros": [
          "Rules that must go together stay together",
          "Checkout depends on one object per region",
          "Adding a region is one factory"
        ],
        "cons": [
          "Adding a new kind of rule changes every factory",
          "Heavy for rules that only differ by a number"
        ],
        "pickWhen": "A region brings a whole set of related rules that must stay consistent."
      },
      {
        "name": "Data-driven config with tenant overrides",
        "concept": "Configuration over code (OCP / YAGNI)",
        "conceptIds": [
          "ocp",
          "yagni"
        ],
        "how": "Model the parameters (tax percent, refund days, invoice template id) as a config record per country, and resolve it by applying tenant overrides on top. Code exists only for behaviour that truly differs.",
        "code": [
          {
            "file": "RegionConfigs.java",
            "body": "import java.util.HashMap;\nimport java.util.Map;\n\nrecord RegionConfig(int taxPercent, int refundDays, String invoiceTemplate) {}\n\nclass RegionConfigs {\n    private final Map<String, RegionConfig> byCountry = new HashMap<>();\n\n    RegionConfigs() { // in production this comes from a database or config service\n        byCountry.put(\"IN\", new RegionConfig(18, 7, \"gst-invoice\"));\n        byCountry.put(\"DE\", new RegionConfig(19, 14, \"vat-invoice\"));\n    }\n\n    RegionConfig resolve(String country, Map<String, Integer> tenantOverrides) {\n        RegionConfig base = byCountry.get(country);\n        if (base == null) throw new IllegalArgumentException(\"Unsupported country: \" + country);\n        return new RegionConfig(\n            tenantOverrides.getOrDefault(\"taxPercent\", base.taxPercent()),\n            tenantOverrides.getOrDefault(\"refundDays\", base.refundDays()),\n            base.invoiceTemplate());\n    }\n}\n"
          }
        ],
        "pros": [
          "A rate or window change needs no deploy",
          "Tenant overrides are a natural layer",
          "Smallest code for the common case"
        ],
        "cons": [
          "Config can encode logic nobody tests",
          "Needs validation and versioning of config"
        ],
        "pickWhen": "Regions differ mostly by parameters, and tenants need to override them."
      }
    ],
    "recommendation": "I would combine two layers: config records for parameters that differ (option 4), and strategies or a region factory (options 2 and 3) only for behaviour that is truly different, like a US sales-tax lookup. The resolver applies tenant overrides last.\n\nI would also mention that regulated rules (tax, invoice law) need versioning by effective date, because a rate changes on a day and old orders must keep the old rate.",
    "say": "\"I split regional differences into parameters and behaviour. Parameters like tax rate and refund days go into config with tenant overrides layered on top. Real behavioural differences get a strategy, or a region factory when several rules must stay consistent. And I would version rules by effective date so old orders keep their old rate.\"",
    "appearsIn": [
      "amazon",
      "shopping-cart-system",
      "online-bookstore",
      "airline-management-system"
    ],
    "related": [
      "add-new-payment-method",
      "swap-storage-backend",
      "abstract-factory",
      "strategy"
    ]
  },
  {
    "id": "add-undo-redo",
    "prompt": "\"Add undo and redo to the editor. (Or the drawing board, or the shopping cart.) How would you implement it, and what are the trade-offs?\"",
    "context": "Undo looks like a small feature until you ask what exactly gets undone, how many steps are kept, and what a new action does to the redo history.\n\nThe interviewer is checking that you know the standard approaches, and that you can compare memory cost, complexity and how well each handles operations with side effects.",
    "whyHard": "Two things trip people up. First, redo: a new action after an undo must clear the redo stack, otherwise redo replays the wrong thing. Second, cost: snapshotting the whole state for every keystroke is simple but expensive, while storing inverse operations is cheap but each operation must know how to reverse itself exactly (a delete must remember what it removed).\n\nOperations with external side effects, such as sending an email, cannot be undone at all, and a good answer says so.",
    "options": [
      {
        "name": "Command objects with execute and undo",
        "concept": "Command pattern",
        "conceptIds": [
          "command"
        ],
        "how": "Every user action is an object that knows how to apply itself and reverse itself. A history keeps an undo stack and a redo stack. Undo pops, reverses and pushes to redo. Running a new command clears redo.",
        "code": [
          {
            "file": "History.java",
            "body": "import java.util.ArrayDeque;\nimport java.util.Deque;\n\nclass Document {\n    private final StringBuilder text = new StringBuilder();\n\n    void insert(int pos, String s) { text.insert(pos, s); }\n\n    String delete(int pos, int len) {\n        String removed = text.substring(pos, pos + len);\n        text.delete(pos, pos + len);\n        return removed;\n    }\n\n    String text() { return text.toString(); }\n}\n\ninterface Command {\n    void execute();\n    void undo();\n}\n\nclass InsertText implements Command {\n    private final Document doc;\n    private final int pos;\n    private final String s;\n\n    InsertText(Document doc, int pos, String s) { this.doc = doc; this.pos = pos; this.s = s; }\n\n    public void execute() { doc.insert(pos, s); }\n    public void undo() { doc.delete(pos, s.length()); }\n}\n\nclass DeleteText implements Command {\n    private final Document doc;\n    private final int pos;\n    private final int len;\n    private String removed; // remembered so undo can put it back\n\n    DeleteText(Document doc, int pos, int len) { this.doc = doc; this.pos = pos; this.len = len; }\n\n    public void execute() { removed = doc.delete(pos, len); }\n    public void undo() { doc.insert(pos, removed); }\n}\n\nclass History {\n    private final Deque<Command> undoStack = new ArrayDeque<>();\n    private final Deque<Command> redoStack = new ArrayDeque<>();\n\n    void run(Command c) {\n        c.execute();\n        undoStack.push(c);\n        redoStack.clear(); // a new action invalidates the redo branch\n    }\n\n    boolean undo() {\n        if (undoStack.isEmpty()) return false;\n        Command c = undoStack.pop();\n        c.undo();\n        redoStack.push(c);\n        return true;\n    }\n\n    boolean redo() {\n        if (redoStack.isEmpty()) return false;\n        Command c = redoStack.pop();\n        c.execute();\n        undoStack.push(c);\n        return true;\n    }\n}\n"
          }
        ],
        "pros": [
          "Memory cost is proportional to the change, not the document",
          "Commands double as an audit log",
          "Fits macros and replays"
        ],
        "cons": [
          "Every operation needs a correct inverse",
          "Hard to undo operations whose effect depends on other state"
        ],
        "pickWhen": "Operations are small and well defined, such as an editor, a drawing board or a spreadsheet."
      },
      {
        "name": "Snapshots of the state",
        "concept": "Memento pattern",
        "conceptIds": [
          "memento"
        ],
        "how": "Before each change, save an immutable snapshot of the state. Undo restores the previous snapshot and pushes the current one onto redo. The editor never needs to know how to reverse an operation.",
        "code": [
          {
            "file": "Editor.java",
            "body": "import java.util.ArrayDeque;\nimport java.util.Deque;\n\nrecord Snapshot(String text, int cursor) {}\n\nclass Editor {\n    private String text = \"\";\n    private int cursor = 0;\n    private final Deque<Snapshot> undoStack = new ArrayDeque<>();\n    private final Deque<Snapshot> redoStack = new ArrayDeque<>();\n\n    private Snapshot save() { return new Snapshot(text, cursor); }\n\n    private void restore(Snapshot s) {\n        text = s.text();\n        cursor = s.cursor();\n    }\n\n    void type(String s) {\n        undoStack.push(save()); // snapshot BEFORE the change\n        redoStack.clear();\n        text = text.substring(0, cursor) + s + text.substring(cursor);\n        cursor += s.length();\n    }\n\n    boolean undo() {\n        if (undoStack.isEmpty()) return false;\n        redoStack.push(save());\n        restore(undoStack.pop());\n        return true;\n    }\n\n    boolean redo() {\n        if (redoStack.isEmpty()) return false;\n        undoStack.push(save());\n        restore(redoStack.pop());\n        return true;\n    }\n\n    String text() { return text; }\n}\n"
          }
        ],
        "pros": [
          "Very simple and hard to get wrong",
          "Works for any kind of change",
          "No per-operation undo code"
        ],
        "cons": [
          "Memory grows with state size times history length",
          "Can be wasteful for tiny edits to a large document"
        ],
        "pickWhen": "State is small or immutable, or correctness matters more than memory."
      },
      {
        "name": "An event log replayed to build state",
        "concept": "Event log and replay (Command in log form)",
        "conceptIds": [
          "command"
        ],
        "how": "Never store the state, only the list of events that produced it. Undo removes the last event, and state is rebuilt by replaying the log. Redo puts the event back. This also gives you history and auditing.",
        "code": [
          {
            "file": "EventLogDocument.java",
            "body": "import java.util.ArrayDeque;\nimport java.util.ArrayList;\nimport java.util.Deque;\nimport java.util.List;\n\nrecord Event(String type, String payload) {}\n\nclass EventLogDocument {\n    private final List<Event> log = new ArrayList<>();\n    private final Deque<Event> redoStack = new ArrayDeque<>();\n\n    void append(String s) { log.add(new Event(\"APPEND\", s)); redoStack.clear(); }\n\n    void clearAll() { log.add(new Event(\"CLEAR\", \"\")); redoStack.clear(); }\n\n    boolean undo() {\n        if (log.isEmpty()) return false;\n        redoStack.push(log.remove(log.size() - 1));\n        return true;\n    }\n\n    boolean redo() {\n        if (redoStack.isEmpty()) return false;\n        log.add(redoStack.pop());\n        return true;\n    }\n\n    // State is never stored, it is rebuilt by replaying the log.\n    String state() {\n        StringBuilder sb = new StringBuilder();\n        for (Event e : log) {\n            if (e.type().equals(\"APPEND\")) sb.append(e.payload());\n            else if (e.type().equals(\"CLEAR\")) sb.setLength(0);\n        }\n        return sb.toString();\n    }\n}\n"
          }
        ],
        "pros": [
          "Full history and auditing for free",
          "Undo is trivial: drop the last event",
          "Great for collaboration and sync"
        ],
        "cons": [
          "Replay cost grows with history (needs checkpoints)",
          "Events must be deterministic and versioned"
        ],
        "pickWhen": "You already need an audit trail, or you are building collaborative or sync-heavy features."
      },
      {
        "name": "Undo only the last action",
        "concept": "Keep it simple (KISS / YAGNI)",
        "conceptIds": [
          "kiss",
          "yagni"
        ],
        "how": "Many products only need a single-level \"undo remove\". Remember the last removed item and put it back, with no stacks and no redo.",
        "code": [
          {
            "file": "Cart.java",
            "body": "import java.util.ArrayList;\nimport java.util.List;\n\nclass Cart {\n    private final List<String> items = new ArrayList<>();\n    private String lastRemoved;\n\n    void add(String item) { items.add(item); }\n\n    void remove(String item) {\n        if (items.remove(item)) lastRemoved = item;\n    }\n\n    boolean undoRemove() {\n        if (lastRemoved == null) return false;\n        items.add(lastRemoved);\n        lastRemoved = null;\n        return true;\n    }\n\n    List<String> items() { return List.copyOf(items); }\n}\n"
          }
        ],
        "pros": [
          "A few lines",
          "Covers the case most users actually hit"
        ],
        "cons": [
          "No multi-step undo",
          "Easy to outgrow"
        ],
        "pickWhen": "The product only needs a safety net for accidental deletes, such as a cart or a mailbox."
      }
    ],
    "recommendation": "For an editor or drawing tool I would use commands (option 1) because they scale with the size of each change, and I would mention the redo-clearing rule and a cap on history length. If the interviewer stresses correctness or small state, snapshots (option 2) are the safe choice, and I would say I would start there for a first version.\n\nI would also call out the limit: side effects like emails or payments cannot be undone and need compensating actions instead.",
    "say": "\"There are two classic ways: store inverse operations as commands, or store snapshots. Commands are cheap in memory but each needs a correct inverse. Snapshots are simple but cost memory. Either way a new action clears the redo stack, and anything with external side effects needs a compensating action rather than a true undo.\"",
    "appearsIn": [
      "chess-game",
      "shopping-cart-system",
      "file-storage-system",
      "task-management-system"
    ],
    "related": [
      "cancel-mid-flow",
      "history-and-soft-delete",
      "command",
      "memento"
    ]
  },
  {
    "id": "add-approval-workflow",
    "prompt": "\"Expense claims under 5,000 are auto-approved, up to 50,000 need a manager, and above that a director and finance. The rules will change. How do you model approvals?\"",
    "context": "Approvals show up in expense tools, course registration, leave requests and pull requests. The interviewer starts with simple thresholds, then adds that approvals take days, can be rejected, and that the thresholds change every year.\n\nThe real question is how much of the flow is rules and how much is long-lived state.",
    "whyHard": "Two different problems share one name. Deciding who must approve is a pure function of the claim (a rules question). Tracking where a particular claim is right now, possibly for days, across restarts, is a state question. A design that handles only one will creak the moment the other appears.\n\nAlso, \"approved by a manager, then by a director\" is not the same as \"the first person who can handle it handles it\", which is what a naive chain of handlers does.",
    "options": [
      {
        "name": "If/else ladder on the amount",
        "concept": "Keep it simple (KISS / YAGNI)",
        "conceptIds": [
          "kiss",
          "yagni"
        ],
        "how": "One method returns who is needed based on thresholds. Perfectly fine while rules are stable and nobody asks for configuration.",
        "code": [
          {
            "file": "ApprovalService.java",
            "body": "class ApprovalService {\n    String route(long amount) {\n        if (amount < 5_000) {\n            return \"AUTO_APPROVED\";\n        } else if (amount < 50_000) {\n            return \"NEEDS_MANAGER\";\n        } else {\n            return \"NEEDS_DIRECTOR_AND_FINANCE\";\n        }\n    }\n}\n"
          }
        ],
        "pros": [
          "Obvious and quick",
          "Easy to test with a few numbers"
        ],
        "cons": [
          "Thresholds are baked into code",
          "No notion of progress through the flow"
        ],
        "pickWhen": "Few tiers, rarely changing, and approvals are instantaneous."
      },
      {
        "name": "A chain of approvers",
        "concept": "Chain of Responsibility pattern",
        "conceptIds": [
          "chain-of-responsibility",
          "ocp"
        ],
        "how": "Each approver has a limit and a link to the next. A request travels up the chain until someone whose limit covers it handles it. Adding a tier means inserting an approver in the chain.",
        "code": [
          {
            "file": "Approver.java",
            "body": "class Approver {\n    private final String role;\n    private final long limit;\n    private Approver next;\n\n    Approver(String role, long limit) { this.role = role; this.limit = limit; }\n\n    Approver then(Approver next) {\n        this.next = next;\n        return next;\n    }\n\n    boolean handle(long amount) {\n        if (amount <= limit) {\n            System.out.println(role + \" approved \" + amount);\n            return true;\n        }\n        if (next == null) return false; // nobody in the chain can approve this\n        return next.handle(amount);\n    }\n}\n\nclass ApprovalChain {\n    static Approver build() {\n        Approver manager = new Approver(\"Manager\", 50_000);\n        manager.then(new Approver(\"Director\", 500_000)).then(new Approver(\"CFO\", Long.MAX_VALUE));\n        return manager;\n    }\n}\n"
          }
        ],
        "pros": [
          "Tiers are independent and reorderable",
          "Easy to add a level",
          "Sender does not know who will handle it"
        ],
        "cons": [
          "Models \"first capable handler\", not \"all of these must sign\"",
          "Request can fall off the end if nobody handles it"
        ],
        "pickWhen": "A single approver at the right level is enough, and the tiers change occasionally."
      },
      {
        "name": "A state machine for each claim",
        "concept": "State pattern",
        "conceptIds": [
          "state",
          "polymorphism"
        ],
        "how": "Each claim moves through states (pending manager, pending director, approved, rejected). Each state defines which actions are legal and which state follows. Illegal moves, such as approving a rejected claim, are impossible by construction.",
        "code": [
          {
            "file": "Claim.java",
            "body": "interface ClaimState {\n    ClaimState approve(String by);\n    ClaimState reject(String by);\n}\n\nclass PendingManager implements ClaimState {\n    public ClaimState approve(String by) { return new PendingDirector(); }\n    public ClaimState reject(String by) { return new Rejected(by); }\n}\n\nclass PendingDirector implements ClaimState {\n    public ClaimState approve(String by) { return new Approved(); }\n    public ClaimState reject(String by) { return new Rejected(by); }\n}\n\nclass Approved implements ClaimState {\n    public ClaimState approve(String by) { throw new IllegalStateException(\"Already approved\"); }\n    public ClaimState reject(String by) { throw new IllegalStateException(\"Already approved\"); }\n}\n\nclass Rejected implements ClaimState {\n    final String rejectedBy;\n\n    Rejected(String rejectedBy) { this.rejectedBy = rejectedBy; }\n\n    public ClaimState approve(String by) { throw new IllegalStateException(\"Already rejected\"); }\n    public ClaimState reject(String by) { throw new IllegalStateException(\"Already rejected\"); }\n}\n\nclass Claim {\n    private ClaimState state = new PendingManager();\n\n    void approve(String by) { state = state.approve(by); }\n    void reject(String by) { state = state.reject(by); }\n    ClaimState state() { return state; }\n}\n"
          }
        ],
        "pros": [
          "Transitions are explicit and enforceable",
          "Perfect fit for a workflow that lasts days",
          "Easy to persist the current state"
        ],
        "cons": [
          "More classes than a simple status field",
          "Does not decide who must approve by itself"
        ],
        "pickWhen": "Claims live for days, can be rejected or reassigned, and you must prevent illegal transitions."
      },
      {
        "name": "A rules table that lists the required approvers",
        "concept": "Data-driven rules (OCP)",
        "conceptIds": [
          "ocp",
          "strategy"
        ],
        "how": "Store tiers as data: up to this amount, these approvers are required. A policy object turns an amount into a list of approvers. The list can be several people, which a plain chain cannot express.",
        "code": [
          {
            "file": "ApprovalPolicy.java",
            "body": "import java.util.List;\n\nrecord ApprovalRule(long upToPaise, List<String> approvers) {}\n\nclass ApprovalPolicy {\n    private final List<ApprovalRule> rules; // sorted by upToPaise, loaded from config\n\n    ApprovalPolicy(List<ApprovalRule> rules) { this.rules = List.copyOf(rules); }\n\n    List<String> approversFor(long amountPaise) {\n        for (ApprovalRule rule : rules) {\n            if (amountPaise <= rule.upToPaise()) return rule.approvers();\n        }\n        throw new IllegalArgumentException(\"No rule covers amount \" + amountPaise);\n    }\n\n    static ApprovalPolicy defaults() {\n        return new ApprovalPolicy(List.of(\n            new ApprovalRule(5_000, List.of()),\n            new ApprovalRule(50_000, List.of(\"MANAGER\")),\n            new ApprovalRule(Long.MAX_VALUE, List.of(\"DIRECTOR\", \"FINANCE\"))));\n    }\n}\n"
          }
        ],
        "pros": [
          "Thresholds change without a deploy",
          "Handles \"all of these must approve\"",
          "Easy to display why a claim needs whom"
        ],
        "cons": [
          "Needs validation (gaps, overlaps)",
          "Rules that depend on more than amount outgrow a table"
        ],
        "pickWhen": "Tiers are a business setting that finance or HR edits."
      }
    ],
    "recommendation": "I would use a rules table to decide who must approve (option 4) and a state machine to track each claim (option 3), because those are the two real problems. A chain of handlers (option 2) is a good answer only if the interviewer confirms that one capable approver is enough.\n\nI would also store approvals as an audit trail, with who, when and a comment, since approval flows get disputed.",
    "say": "\"I separate who must approve from where this claim is now. The first is a rules table keyed by amount, which finance can change. The second is a state machine so illegal transitions are impossible and the state survives restarts. A chain of handlers fits only if a single approver at the right level suffices.\"",
    "appearsIn": [
      "task-management-system",
      "course-registration-system",
      "restaurant-management-system",
      "library-management-system"
    ],
    "related": [
      "enum-vs-state-pattern",
      "payment-succeeds-order-fails",
      "chain-of-responsibility",
      "state"
    ]
  },
  {
    "id": "swap-storage-backend",
    "prompt": "\"We started with an in-memory map. Now we need Postgres, and later maybe DynamoDB. How do you avoid rewriting the business logic?\"",
    "context": "Almost every machine-coding round starts in memory, and the follow-up is \"now make it persistent\". The interviewer wants to see whether your business logic knows about the storage or whether it can be moved without edits.\n\nStrong answers also address migration: how do you move live data from the old store to the new one safely?",
    "whyHard": "The abstraction is easy to draw and easy to get wrong. If your interface exposes SQL concepts (transactions, joins), it will not fit a key-value store. If it is too generic, every call needs awkward workarounds. And on the day you actually switch, you need a way to run both stores side by side without losing writes.\n\nIt is also tempting to over-abstract before there is a second implementation, which adds layers that nobody needs.",
    "options": [
      {
        "name": "A repository interface with one implementation per backend",
        "concept": "Dependency Inversion and the Repository pattern",
        "conceptIds": [
          "dip",
          "interfaces"
        ],
        "how": "Business logic depends on `OrderRepository`. There are in-memory and JDBC implementations, and the service takes whichever it is given. Swapping storage is a wiring change. The interface speaks in domain terms (`save`, `findById`), not SQL.",
        "code": [
          {
            "file": "OrderService.java",
            "body": "import java.sql.Connection;\nimport java.sql.PreparedStatement;\nimport java.sql.ResultSet;\nimport java.sql.SQLException;\nimport java.util.Map;\nimport java.util.Optional;\nimport java.util.concurrent.ConcurrentHashMap;\n\nrecord Order(String id, long amountPaise) {}\n\ninterface OrderRepository {\n    void save(Order order);\n    Optional<Order> findById(String id);\n}\n\nclass InMemoryOrderRepository implements OrderRepository {\n    private final Map<String, Order> orders = new ConcurrentHashMap<>();\n\n    public void save(Order order) { orders.put(order.id(), order); }\n    public Optional<Order> findById(String id) { return Optional.ofNullable(orders.get(id)); }\n}\n\nclass JdbcOrderRepository implements OrderRepository {\n    private final Connection connection;\n\n    JdbcOrderRepository(Connection connection) { this.connection = connection; }\n\n    public void save(Order order) {\n        String sql = \"INSERT INTO orders(id, amount_paise) VALUES (?, ?) \"\n                   + \"ON CONFLICT (id) DO UPDATE SET amount_paise = EXCLUDED.amount_paise\";\n        try (PreparedStatement ps = connection.prepareStatement(sql)) {\n            ps.setString(1, order.id());\n            ps.setLong(2, order.amountPaise());\n            ps.executeUpdate();\n        } catch (SQLException e) {\n            throw new IllegalStateException(\"Could not save order \" + order.id(), e);\n        }\n    }\n\n    public Optional<Order> findById(String id) {\n        String sql = \"SELECT id, amount_paise FROM orders WHERE id = ?\";\n        try (PreparedStatement ps = connection.prepareStatement(sql)) {\n            ps.setString(1, id);\n            try (ResultSet rs = ps.executeQuery()) {\n                return rs.next() ? Optional.of(new Order(rs.getString(1), rs.getLong(2))) : Optional.empty();\n            }\n        } catch (SQLException e) {\n            throw new IllegalStateException(\"Could not load order \" + id, e);\n        }\n    }\n}\n\nclass OrderService {\n    private final OrderRepository orders; // the only storage detail the business logic knows\n\n    OrderService(OrderRepository orders) { this.orders = orders; }\n\n    Order place(String id, long amountPaise) {\n        Order order = new Order(id, amountPaise);\n        orders.save(order);\n        return order;\n    }\n}\n"
          }
        ],
        "pros": [
          "Business logic is storage-agnostic",
          "Tests use the in-memory version",
          "Easy to add a second backend"
        ],
        "cons": [
          "A leaky interface (joins, transactions) will not fit every store",
          "One more layer to maintain"
        ],
        "pickWhen": "You are certain storage will change, or you need fast tests without a database."
      },
      {
        "name": "Adapt a vendor client to your repository",
        "concept": "Adapter pattern",
        "conceptIds": [
          "adapter",
          "interfaces"
        ],
        "how": "A NoSQL or cloud client has its own shape. Wrap it in a class that implements your repository interface and translates between your domain objects and the vendor's attributes. The vendor API stays inside the adapter.",
        "code": [
          {
            "file": "DynamoOrderRepository.java",
            "body": "import java.util.HashMap;\nimport java.util.Map;\nimport java.util.Optional;\n\nrecord Order(String id, long amountPaise) {}\n\ninterface OrderRepository {\n    void save(Order order);\n    Optional<Order> findById(String id);\n}\n\n// Vendor client we do not control; its shape is nothing like our interface.\nclass DynamoClient {\n    private final Map<String, Map<String, String>> table = new HashMap<>();\n\n    void putItem(String key, Map<String, String> attributes) { table.put(key, attributes); }\n    Map<String, String> getItem(String key) { return table.get(key); }\n}\n\nclass DynamoOrderRepository implements OrderRepository {\n    private final DynamoClient client;\n\n    DynamoOrderRepository(DynamoClient client) { this.client = client; }\n\n    public void save(Order order) {\n        client.putItem(order.id(), Map.of(\"id\", order.id(), \"amount\", Long.toString(order.amountPaise())));\n    }\n\n    public Optional<Order> findById(String id) {\n        Map<String, String> item = client.getItem(id);\n        if (item == null) return Optional.empty();\n        return Optional.of(new Order(item.get(\"id\"), Long.parseLong(item.get(\"amount\"))));\n    }\n}\n"
          }
        ],
        "pros": [
          "Vendor types never reach the domain",
          "Replacing the vendor changes one class"
        ],
        "cons": [
          "Translation code needs tests",
          "Features unique to the vendor are hard to expose"
        ],
        "pickWhen": "The new backend is a third-party client you cannot change."
      },
      {
        "name": "Dual-write during migration",
        "concept": "Decorator / Proxy around the repository",
        "conceptIds": [
          "decorator",
          "proxy"
        ],
        "how": "Wrap two repositories in one that writes to both and reads from the old one until the new one is trusted. Failures in the shadow store are logged, not shown to the user. Later, flip reads, then remove the old store.",
        "code": [
          {
            "file": "DualWriteOrderRepository.java",
            "body": "import java.util.Optional;\n\nrecord Order(String id, long amountPaise) {}\n\ninterface OrderRepository {\n    void save(Order order);\n    Optional<Order> findById(String id);\n}\n\n// Migration helper: write to old and new, read from the old one until the new one is trusted.\nclass DualWriteOrderRepository implements OrderRepository {\n    private final OrderRepository primary;   // still the source of truth\n    private final OrderRepository secondary; // the new backend being warmed up\n\n    DualWriteOrderRepository(OrderRepository primary, OrderRepository secondary) {\n        this.primary = primary;\n        this.secondary = secondary;\n    }\n\n    public void save(Order order) {\n        primary.save(order);\n        try {\n            secondary.save(order);\n        } catch (RuntimeException e) {\n            // Never fail the user because the shadow store hiccuped; log and reconcile later.\n            System.err.println(\"Shadow write failed for \" + order.id() + \": \" + e.getMessage());\n        }\n    }\n\n    public Optional<Order> findById(String id) { return primary.findById(id); }\n}\n"
          }
        ],
        "pros": [
          "Zero-downtime migration path",
          "Callers do not change",
          "Lets you compare the two stores before switching"
        ],
        "cons": [
          "The stores can diverge, so you need reconciliation",
          "Not atomic across stores"
        ],
        "pickWhen": "You are moving live data and cannot afford downtime or a big-bang cutover."
      },
      {
        "name": "Wait: keep a small store class until a second backend is real",
        "concept": "YAGNI",
        "conceptIds": [
          "yagni",
          "kiss"
        ],
        "how": "Hide the map behind a small class with a clear API, but do not extract an interface yet. When the second backend actually arrives, extracting the interface is a mechanical refactor, and by then you know what it really needs.",
        "code": [
          {
            "file": "OrderStore.java",
            "body": "import java.util.Map;\nimport java.util.Optional;\nimport java.util.concurrent.ConcurrentHashMap;\n\nrecord Order(String id, long amountPaise) {}\n\n// Start here. Callers only see save/find, so extracting an interface later is a mechanical change.\nclass OrderStore {\n    private final Map<String, Order> orders = new ConcurrentHashMap<>();\n\n    void save(Order order) { orders.put(order.id(), order); }\n    Optional<Order> find(String id) { return Optional.ofNullable(orders.get(id)); }\n}\n"
          }
        ],
        "pros": [
          "No speculative abstraction",
          "The API you extract later is shaped by real needs"
        ],
        "cons": [
          "Tests that need a fake store will push you to the interface early",
          "Looks naive if the interviewer expects an interface"
        ],
        "pickWhen": "A first version or a time-boxed round where persistence is only a possible follow-up."
      }
    ],
    "recommendation": "In an interview I would introduce the repository interface (option 1) straight away, because \"make it persistent\" is the most predictable follow-up and the in-memory version doubles as a test fake. Real vendors go behind adapters (option 2), and for a live migration I would describe dual-write (option 3) with reconciliation.\n\nI would keep the interface in domain terms and say which operations deliberately are not on it, such as joins and cross-aggregate transactions.",
    "say": "\"The service depends on a repository in domain terms, so the in-memory version is just one implementation and the database is another. Vendor clients get adapters. For a live switch I would dual-write behind the same interface, read from the old store, compare, then flip reads and retire the old one. I would keep the interface free of SQL concepts.\"",
    "appearsIn": [
      "lru-cache",
      "file-storage-system",
      "task-management-system",
      "parking-lot"
    ],
    "related": [
      "add-new-payment-method",
      "country-specific-rules",
      "dip",
      "adapter"
    ]
  }
);
