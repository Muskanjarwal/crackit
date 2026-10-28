window.QUESTIONS = window.QUESTIONS || [];
window.QUESTIONS.push({
  "id": "quick-commerce-delivery-app",
  "name": "Design a Quick-Commerce Delivery App",
  "difficulty": "hard",
  "understanding": "A quick-commerce app (Blinkit, Zepto) delivers groceries in about ten minutes from a small neighbourhood warehouse called a dark store. The design looks like a normal cart-and-order system, but three things are scarce at the same moment: the last unit of a product in a store, the rider closest to that store, and the customer's attention while an order is being packed. The hard part is making every one of those contested resources go to exactly one order, with no oversell and no double-booked rider, while staying fast.",
  "dialogue": [
    {
      "who": "you",
      "text": "Is a customer served by one store, or do we aggregate stock across the city?"
    },
    {
      "who": "int",
      "text": "One store. Each customer is served by the nearest dark store inside its delivery radius, so inventory is **per store**, not global."
    },
    {
      "who": "you",
      "text": "What should happen when two customers add the last packet of milk at the same moment?"
    },
    {
      "who": "int",
      "text": "That is the heart of this problem. Exactly one of them gets it. Nobody is ever oversold."
    },
    {
      "who": "you",
      "text": "Should adding to the cart reserve the item, or only checkout?"
    },
    {
      "who": "int",
      "text": "Reserve it at add-to-cart, but not forever. If the customer wanders off, the unit has to come back."
    },
    {
      "who": "you",
      "text": "After payment, what is the order flow?"
    },
    {
      "who": "int",
      "text": "A picker packs it, then a rider collects it. The customer follows the status live."
    },
    {
      "who": "you",
      "text": "How do we pick the rider?"
    },
    {
      "who": "int",
      "text": "Nearest available rider. Two orders must never end up with the same rider, even if they are dispatched in the same millisecond."
    },
    {
      "who": "you",
      "text": "And cancellation?"
    },
    {
      "who": "int",
      "text": "Allowed until the rider has picked the order up. The stock goes back to the shelf."
    },
    {
      "who": "you",
      "text": "I will keep payment and map routing out of scope and treat rider locations as fixed points. Does that work?"
    },
    {
      "who": "int",
      "text": "Yes. Focus on correctness under concurrency."
    }
  ],
  "requirements": [
    {
      "group": "Core",
      "items": [
        "A customer is served by the nearest dark store inside its delivery radius.",
        "Each dark store owns its own inventory per SKU.",
        "Adding an item to the cart holds that stock for a limited time (10 minutes).",
        "Placing an order turns the holds into a sale: all items or none.",
        "An order moves PLACED, PACKING, PACKED, OUT_FOR_DELIVERY, DELIVERED, and the customer can follow it live.",
        "The nearest available rider is assigned at dispatch.",
        "Cancelling before pickup returns the stock."
      ]
    },
    {
      "group": "Concurrency",
      "items": [
        "The last unit of a product goes to exactly one cart. Stock never goes negative.",
        "A rider is never assigned to two orders, even under simultaneous dispatch.",
        "Double-clicking Place order creates one order and decrements stock once.",
        "Several simultaneous cancel clicks restock exactly once."
      ]
    },
    {
      "group": "Extensibility",
      "items": [
        "New store-selection rules (stock-aware, load-aware) without changing the cart.",
        "New rider-ranking rules (rating, batching) without changing dispatch."
      ]
    }
  ],
  "entities": [
    {
      "name": "Location",
      "text": "A latitude/longitude pair that can compute its distance to another."
    },
    {
      "name": "DarkStore",
      "text": "A neighbourhood warehouse. Owns its inventory and its location."
    },
    {
      "name": "StockEntry",
      "text": "Stock for one SKU in one store: units on hand plus the live holds against them. Guarded by one lock."
    },
    {
      "name": "Hold",
      "text": "A time-limited claim on some units. Not yet a sale."
    },
    {
      "name": "Cart",
      "text": "Bound to one store; owns the holds for its items."
    },
    {
      "name": "Order / OrderStatus",
      "text": "The purchase and its state machine."
    },
    {
      "name": "Rider / RiderPool",
      "text": "A delivery partner with an atomic available/busy flag, and the pool that assigns them."
    },
    {
      "name": "StoreSelector, AssignmentStrategy",
      "text": "Pluggable rules for choosing a store and ranking riders."
    },
    {
      "name": "CartService, OrderService",
      "text": "Orchestration: add to cart, checkout, pack, dispatch, deliver, cancel."
    }
  ],
  "design": [
    {
      "heading": "Requirement 1: Serve each customer from the nearest dark store",
      "text": "Location knows how to measure distance. Choosing a store is a rule that may change (nearest, least busy, has stock), so it sits behind a `StoreSelector` interface and the cart never knows which rule is in use.",
      "code": [
        {
          "file": "Location.java",
          "body": "public record Location(double lat, double lon) {\n    private static final double EARTH_RADIUS_KM = 6371.0;\n\n    public double distanceKm(Location other) {\n        double dLat = Math.toRadians(other.lat - lat);\n        double dLon = Math.toRadians(other.lon - lon);\n        double a = Math.sin(dLat / 2) * Math.sin(dLat / 2)\n                + Math.cos(Math.toRadians(lat)) * Math.cos(Math.toRadians(other.lat))\n                * Math.sin(dLon / 2) * Math.sin(dLon / 2);\n        return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));\n    }\n}"
        },
        {
          "file": "StoreSelector.java",
          "body": "import java.util.Optional;\n\n/** Strategy for choosing which dark store serves a customer. */\npublic interface StoreSelector {\n    Optional<DarkStore> select(Location customer);\n}"
        },
        {
          "file": "NearestStoreSelector.java",
          "body": "import java.util.Comparator;\nimport java.util.List;\nimport java.util.Optional;\n\n/** Nearest store, but only if it is inside its delivery radius. */\npublic class NearestStoreSelector implements StoreSelector {\n    private final List<DarkStore> stores;\n    private final double maxRadiusKm;\n\n    public NearestStoreSelector(List<DarkStore> stores, double maxRadiusKm) {\n        this.stores = List.copyOf(stores);\n        this.maxRadiusKm = maxRadiusKm;\n    }\n\n    @Override\n    public Optional<DarkStore> select(Location customer) {\n        return stores.stream()\n                .filter(s -> s.location().distanceKm(customer) <= maxRadiusKm)\n                .min(Comparator.comparingDouble(s -> s.location().distanceKm(customer)));\n    }\n}"
        }
      ],
      "note": "A customer outside every radius gets an empty result, not a far-away store. Promising a ten-minute delivery from 40 km away would be worse than saying no."
    },
    {
      "heading": "Requirement 2: Each dark store owns its inventory, one lock per SKU",
      "text": "`DarkStore` holds a map from SKU to `StockEntry`. All the state for one SKU (on-hand units and live holds) lives in one object behind one lock, so \"is there enough?\" and \"take it\" are a single atomic step. Different SKUs never contend with each other.",
      "code": [
        {
          "file": "DarkStore.java",
          "body": "import java.time.Duration;\nimport java.time.Instant;\nimport java.util.Map;\nimport java.util.Optional;\nimport java.util.concurrent.ConcurrentHashMap;\nimport java.util.concurrent.atomic.AtomicLong;\n\n/** A small warehouse that serves one neighbourhood. Owns its own inventory. */\npublic class DarkStore {\n    private static final AtomicLong HOLD_IDS = new AtomicLong();\n\n    private final String name;\n    private final Location location;\n    private final Map<String, StockEntry> stock = new ConcurrentHashMap<>();\n\n    public DarkStore(String name, Location location) {\n        this.name = name;\n        this.location = location;\n    }\n\n    public String name() { return name; }\n    public Location location() { return location; }\n\n    public void addStock(String sku, int qty) {\n        stock.computeIfAbsent(sku, k -> new StockEntry(0)).restock(qty);\n    }\n\n    public Optional<Hold> hold(String cartId, String sku, int qty, Instant now, Duration ttl) {\n        StockEntry entry = stock.get(sku);\n        if (entry == null) return Optional.empty();\n        return entry.tryHold(\"H-\" + HOLD_IDS.incrementAndGet(), cartId, sku, qty, now, ttl);\n    }\n\n    public boolean commit(Hold hold, Instant now) {\n        StockEntry entry = stock.get(hold.sku());\n        return entry != null && entry.commit(hold.id(), now);\n    }\n\n    public void release(Hold hold) {\n        StockEntry entry = stock.get(hold.sku());\n        if (entry != null) entry.release(hold.id());\n    }\n\n    public void restock(String sku, int qty) {\n        addStock(sku, qty);\n    }\n\n    public void restockAll(Map<String, Integer> items) {\n        items.forEach(this::restock);\n    }\n\n    public int available(String sku, Instant now) {\n        StockEntry entry = stock.get(sku);\n        return entry == null ? 0 : entry.available(now);\n    }\n\n    public int onHand(String sku) {\n        StockEntry entry = stock.get(sku);\n        return entry == null ? 0 : entry.onHand();\n    }\n}"
        },
        {
          "file": "StockEntry.tryHold",
          "body": "Optional<Hold> tryHold(String holdId, String cartId, String sku, int qty, Instant now, Duration ttl) {\n    if (qty <= 0) throw new IllegalArgumentException(\"qty must be positive\");\n    lock.lock();\n    try {\n        purgeExpired(now);\n        if (onHand - heldQty() < qty) return Optional.empty();\n        Hold hold = new Hold(holdId, cartId, sku, qty, now.plus(ttl));\n        holds.put(holdId, hold);\n        return Optional.of(hold);\n    } finally {\n        lock.unlock();\n    }\n}"
        }
      ],
      "note": "The common bug is `if (stock > 0) stock--;` with the check and the decrement outside any lock. Two threads both see `1`, both pass, and the count goes to -1."
    },
    {
      "heading": "Requirement 3: Add to cart means place a time-limited hold",
      "text": "Adding to the cart does not touch `onHand`. It records a `Hold` that expires. Available stock is `onHand` minus live holds, and expired holds are purged under the same lock whenever anyone asks. So the last unit goes to exactly one cart, and it returns by itself if that customer never pays.",
      "code": [
        {
          "file": "Hold.java",
          "body": "import java.time.Instant;\n\n/** A temporary claim on `qty` units of one SKU. Not yet a sale. */\npublic record Hold(String id, String cartId, String sku, int qty, Instant expiresAt) {\n    boolean expiredAt(Instant now) {\n        return !now.isBefore(expiresAt);\n    }\n}"
        },
        {
          "file": "AddResult.java",
          "body": "public record AddResult(boolean added, int requested, int availableNow, String message) {\n    static AddResult ok(int qty) {\n        return new AddResult(true, qty, -1, \"held \" + qty);\n    }\n\n    static AddResult soldOut(int qty, int availableNow) {\n        return new AddResult(false, qty, availableNow,\n                availableNow == 0 ? \"sold out\" : \"only \" + availableNow + \" left\");\n    }\n}"
        },
        {
          "file": "CartService.addItem",
          "body": "/** Adding to cart = placing a time-limited hold. Never a check followed by a write. */\npublic AddResult addItem(String cartId, String sku, int qty) {\n    Cart cart = cart(cartId);\n    Optional<Hold> hold = cart.store().hold(cartId, sku, qty, clock.instant(), holdTtl);\n    if (hold.isEmpty()) {\n        return AddResult.soldOut(qty, cart.store().available(sku, clock.instant()));\n    }\n    cart.addHold(hold.get());\n    return AddResult.ok(qty);\n}"
        },
        {
          "file": "Cart.java",
          "body": "import java.util.ArrayList;\nimport java.util.List;\nimport java.util.Map;\nimport java.util.TreeMap;\n\n/**\n * A cart is bound to one dark store and owns the stock holds for its items.\n * Holds are kept in a TreeMap so checkout always commits SKUs in the same order.\n */\npublic class Cart {\n    private final String id;\n    private final DarkStore store;\n    private final Location deliverTo;\n    private final Map<String, List<Hold>> holds = new TreeMap<>();\n    private Order order;\n\n    Cart(String id, DarkStore store, Location deliverTo) {\n        this.id = id;\n        this.store = store;\n        this.deliverTo = deliverTo;\n    }\n\n    public String id() { return id; }\n    public DarkStore store() { return store; }\n    public Location deliverTo() { return deliverTo; }\n\n    synchronized void addHold(Hold hold) {\n        holds.computeIfAbsent(hold.sku(), k -> new ArrayList<>()).add(hold);\n    }\n\n    synchronized List<Hold> removeHolds(String sku) {\n        List<Hold> removed = holds.remove(sku);\n        return removed == null ? List.of() : removed;\n    }\n\n    synchronized List<Hold> allHolds() {\n        List<Hold> all = new ArrayList<>();\n        holds.values().forEach(all::addAll);\n        return all;\n    }\n\n    synchronized void clearHolds() {\n        holds.clear();\n    }\n\n    synchronized Map<String, Integer> quantities() {\n        Map<String, Integer> result = new TreeMap<>();\n        holds.forEach((sku, list) -> result.put(sku, list.stream().mapToInt(Hold::qty).sum()));\n        return result;\n    }\n\n    synchronized Order order() { return order; }\n    synchronized void setOrder(Order order) { this.order = order; }\n}"
        }
      ]
    },
    {
      "heading": "Requirement 4: Checkout is idempotent and all-or-nothing",
      "text": "`placeOrder` is synchronized per cart, so a double-click is harmless: the second call returns the first order. It commits holds in a fixed (sorted SKU) order. If any hold has expired, everything already committed is put back and the checkout fails with a clear message.",
      "code": [
        {
          "file": "OrderService.placeOrder",
          "body": "/** Idempotent: calling it twice for the same cart returns the same order. */\npublic Order placeOrder(String cartId) {\n    Cart cart = carts.cart(cartId);\n    synchronized (cart) {\n        if (cart.order() != null) return cart.order();\n        List<Hold> holds = cart.allHolds();\n        if (holds.isEmpty()) throw new CheckoutException(\"cart is empty\");\n\n        Instant now = clock.instant();\n        DarkStore store = cart.store();\n        List<Hold> committed = new ArrayList<>();\n        for (Hold hold : holds) {\n            if (!store.commit(hold, now)) {\n                // All-or-nothing: put back what we already took and free the rest.\n                committed.forEach(c -> store.restock(c.sku(), c.qty()));\n                holds.stream().filter(h -> !committed.contains(h)).forEach(store::release);\n                cart.clearHolds();\n                throw new CheckoutException(\"hold on \" + hold.sku() + \" expired, please add it again\");\n            }\n            committed.add(hold);\n        }\n\n        Order order = new Order(\"O-\" + orderIds.incrementAndGet(), store, cart.deliverTo(), cart.quantities());\n        orders.put(order.id(), order);\n        cart.setOrder(order);\n        return order;\n    }\n}"
        }
      ],
      "note": "`commit` removes the hold and decrements `onHand` inside the same lock acquisition, so a hold can be committed at most once even if two checkouts race."
    },
    {
      "heading": "Requirement 5: The order lifecycle is a state machine with live status",
      "text": "Each `OrderStatus` knows its next status and whether it may still be cancelled. Illegal moves are impossible to express: a terminal state has no next, and OUT_FOR_DELIVERY is not cancellable. `Order` publishes every transition to subscribers, which is what drives push notifications and the live tracking screen.",
      "code": [
        {
          "file": "OrderStatus.java",
          "body": "/** State pattern: each status knows its next status and whether it can be cancelled. */\npublic enum OrderStatus {\n    PLACED {\n        @Override OrderStatus next() { return PACKING; }\n        @Override boolean canCancel() { return true; }\n    },\n    PACKING {\n        @Override OrderStatus next() { return PACKED; }\n        @Override boolean canCancel() { return true; }\n    },\n    PACKED {\n        @Override OrderStatus next() { return OUT_FOR_DELIVERY; }\n        @Override boolean canCancel() { return true; }\n    },\n    OUT_FOR_DELIVERY {\n        @Override OrderStatus next() { return DELIVERED; }\n    },\n    DELIVERED {\n        @Override OrderStatus next() { throw new IllegalStateException(\"DELIVERED is terminal\"); }\n    },\n    CANCELLED {\n        @Override OrderStatus next() { throw new IllegalStateException(\"CANCELLED is terminal\"); }\n    };\n\n    abstract OrderStatus next();\n\n    boolean canCancel() {\n        return false;\n    }\n}"
        },
        {
          "file": "Order.transitionTo",
          "body": "/** Live status: anyone (the app, push notifications) can subscribe. */\npublic void onStatusChange(Consumer<String> listener) {\n    listeners.add(listener);\n}\n\nvoid transitionTo(OrderStatus next) {\n    status = next;\n    String event = id + \" -> \" + next;\n    timeline.add(event);\n    listeners.forEach(l -> l.accept(event));\n}"
        }
      ]
    },
    {
      "heading": "Requirement 6: Assign the nearest rider, claiming atomically",
      "text": "Ranking riders and claiming a rider are two separate jobs. The strategy only ranks the available riders by distance. The claim is a compare-and-set on the rider's status, so exactly one dispatch can win a given rider. The pool walks the ranking until one claim succeeds.",
      "code": [
        {
          "file": "Rider.java",
          "body": "import java.util.concurrent.atomic.AtomicReference;\n\npublic class Rider {\n    public enum Status { AVAILABLE, BUSY }\n\n    private final String id;\n    private final Location location;\n    private final AtomicReference<Status> status = new AtomicReference<>(Status.AVAILABLE);\n\n    public Rider(String id, Location location) {\n        this.id = id;\n        this.location = location;\n    }\n\n    public String id() { return id; }\n    public Location location() { return location; }\n    public boolean isAvailable() { return status.get() == Status.AVAILABLE; }\n\n    /** The ONLY way to take a rider. Compare-and-set: exactly one caller can win. */\n    boolean tryClaim() {\n        return status.compareAndSet(Status.AVAILABLE, Status.BUSY);\n    }\n\n    void release() {\n        status.set(Status.AVAILABLE);\n    }\n}"
        },
        {
          "file": "AssignmentStrategy.java",
          "body": "import java.util.Collection;\nimport java.util.List;\n\n/** Orders candidate riders from best to worst. It only ranks; it never claims. */\npublic interface AssignmentStrategy {\n    List<Rider> rank(Location pickup, Collection<Rider> riders);\n}"
        },
        {
          "file": "NearestRiderStrategy.java",
          "body": "import java.util.Collection;\nimport java.util.Comparator;\nimport java.util.List;\n\npublic class NearestRiderStrategy implements AssignmentStrategy {\n    @Override\n    public List<Rider> rank(Location pickup, Collection<Rider> riders) {\n        return riders.stream()\n                .filter(Rider::isAvailable)\n                .sorted(Comparator.comparingDouble((Rider r) -> r.location().distanceKm(pickup)))\n                .toList();\n    }\n}"
        },
        {
          "file": "RiderPool.java",
          "body": "import java.util.List;\nimport java.util.Optional;\nimport java.util.concurrent.CopyOnWriteArrayList;\n\npublic class RiderPool {\n    private final List<Rider> riders = new CopyOnWriteArrayList<>();\n    private final AssignmentStrategy strategy;\n\n    public RiderPool(AssignmentStrategy strategy) {\n        this.strategy = strategy;\n    }\n\n    public void add(Rider rider) {\n        riders.add(rider);\n    }\n\n    /**\n     * The ranking is only a snapshot: another order may take the top rider a\n     * microsecond later. So we walk the ranking and keep trying to claim until\n     * one compare-and-set succeeds.\n     */\n    public Optional<Rider> claimFor(Location pickup) {\n        for (Rider candidate : strategy.rank(pickup, riders)) {\n            if (candidate.tryClaim()) return Optional.of(candidate);\n        }\n        return Optional.empty();\n    }\n}"
        }
      ],
      "note": "The ranking is a snapshot. Five orders can all see the same nearest rider; the compare-and-set lets one keep it and sends the other four to the next candidate."
    },
    {
      "heading": "Requirement 7: Cancellation returns the stock, once",
      "text": "Cancel and dispatch lock the same order, so they cannot both succeed. Only the thread whose state transition succeeds restocks, so six simultaneous cancel clicks put the units back exactly once. Riders are claimed only at dispatch, and dispatch makes the order non-cancellable, so a cancelled order never holds a rider.",
      "code": [
        {
          "file": "OrderService.cancel",
          "body": "/** Only the thread whose transition succeeds restocks, so stock is never returned twice. */\npublic boolean cancel(Order order) {\n    synchronized (order) {\n        if (!order.status().canCancel()) return false;\n        order.transitionTo(OrderStatus.CANCELLED);\n        order.store().restockAll(order.items());\n        return true;\n    }\n}"
        }
      ]
    }
  ],
  "deepDive": [
    {
      "title": "Why a hold, and not a lock held for the whole session",
      "text": "It is tempting to \"lock the row\" when a customer adds the last item. Don't. A lock is held by a running thread or a DB transaction for milliseconds; a customer may wait ten minutes. Holding a lock across human think-time ties up connections and threads, and a crashed client leaves it held. A **hold is data, not a lock**: a row with an expiry. The only locks are short ones around the check-and-record step.\n\nThe same idea works in a database, where the `WHERE` clause performs the check and the update performs the act, in one statement. No separate SELECT, so there is no window for another buyer.",
      "code": [
        {
          "file": "stock.sql",
          "body": "-- Atomic hold: the WHERE is the check, the UPDATE is the act.\nUPDATE stock\n   SET held = held + :qty\n WHERE store_id = :store AND sku = :sku\n   AND on_hand - held >= :qty;\n-- 1 row updated -> you got it. 0 rows -> sold out.\n\n-- A sweeper job releases expired holds (aggregate per SKU first).\nBEGIN;\nWITH expired AS (\n  UPDATE holds SET status = 'EXPIRED'\n   WHERE status = 'ACTIVE' AND expires_at <= now()\n   RETURNING store_id, sku, qty)\nUPDATE stock s SET held = s.held - e.qty\n  FROM (SELECT store_id, sku, SUM(qty) AS qty FROM expired GROUP BY 1, 2) e\n WHERE s.store_id = e.store_id AND s.sku = e.sku;\nCOMMIT;"
        }
      ]
    },
    {
      "title": "What if the nearest store is out of stock but another store has it?",
      "text": "With a store chosen at cart creation, a customer next to an empty store sees \"sold out\" even though a store 2 km further away has plenty. A stock-aware selector fixes that by choosing the nearest store that can serve **every** item in the request. This is why `StoreSelector` is an interface: the rule can change without touching the cart.\n\nBe clear about what this check is. It is a **hint**, not a guarantee, because stock can change between selecting the store and adding the item. The hold is still the only thing that guarantees the unit, so a failed hold must fall back gracefully (try the next store, or tell the customer).",
      "code": [
        {
          "file": "StockAwareStoreSelector.java",
          "body": "import java.time.Instant;\nimport java.util.Comparator;\nimport java.util.List;\nimport java.util.Map;\nimport java.util.Optional;\n\n/** Nearest store that currently has every requested item. A hint only: holds are the guarantee. */\npublic class StockAwareStoreSelector {\n    private final List<DarkStore> stores;\n    private final double maxRadiusKm;\n\n    public StockAwareStoreSelector(List<DarkStore> stores, double maxRadiusKm) {\n        this.stores = List.copyOf(stores);\n        this.maxRadiusKm = maxRadiusKm;\n    }\n\n    public Optional<DarkStore> select(Location customer, Map<String, Integer> items, Instant now) {\n        return stores.stream()\n                .filter(s -> s.location().distanceKm(customer) <= maxRadiusKm)\n                .filter(s -> items.entrySet().stream()\n                        .allMatch(e -> s.available(e.getKey(), now) >= e.getValue()))\n                .min(Comparator.comparingDouble(s -> s.location().distanceKm(customer)));\n    }\n}"
        }
      ]
    },
    {
      "title": "Claiming a rider across many servers",
      "text": "In one JVM, a compare-and-set on the rider's status is enough. With many app servers, the same idea moves into the database: make the claim a single conditional update, and let the database pick a free row without blocking. `FOR UPDATE SKIP LOCKED` skips riders another dispatcher is already claiming instead of waiting on them, so concurrent dispatches each get a different rider.\n\nDispatch must also be idempotent. If the claim succeeded but the response was lost and the request retries, the retry must find the rider already assigned to **this** order rather than claim a second one. Key the claim on the order id.",
      "code": [
        {
          "file": "claim_rider.sql",
          "body": "UPDATE riders\n   SET status = 'BUSY', order_id = :order\n WHERE id = (\n   SELECT id FROM riders\n    WHERE store_id = :store AND status = 'AVAILABLE'\n    ORDER BY point(lon, lat) <-> point(:lon, :lat)\n    LIMIT 1\n    FOR UPDATE SKIP LOCKED)\nRETURNING id;"
        }
      ]
    }
  ],
  "mistakes": [
    "Checking stock and decrementing it in two separate steps without a lock or an atomic update. This is the classic oversell.",
    "Holding a lock or an open database transaction while the customer is deciding. Holds are data with an expiry, not locks.",
    "Never expiring holds, so abandoned carts permanently hide stock.",
    "Checking out holds one by one without rolling back: a failure halfway leaves some items sold and the order half-created.",
    "Letting the rider-ranking step also assign the rider. Ranking is a snapshot and goes stale; only an atomic claim is trustworthy.",
    "Restocking in every cancel call instead of only in the one whose state transition succeeded, which doubles the stock on a double-click.",
    "Forcing patterns everywhere. State, Strategy and Observer each earn their place here because the rules change or the transitions are real; a pattern for a rule that never changes is just extra classes."
  ],
  "followups": [
    "How would you make this work when the inventory lives in a database shared by many app servers?",
    "A rider cancels after being assigned. How do you re-dispatch without double-assigning?",
    "How would you batch two nearby orders onto one rider?",
    "How do you keep holds from being gamed by a bot that adds every last unit and never pays?",
    "How would flash-sale items (1000 buyers, 10 units) change the design?"
  ],
  "patterns": [
    "state",
    "strategy",
    "observer"
  ]
});
