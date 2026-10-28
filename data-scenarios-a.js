window.SCENARIOS = window.SCENARIOS || [];
window.SCENARIOS.push(
{
  "id": "last-item-in-stock",
  "prompt": "Only one unit of an item is left and a thousand people press Buy at the same time. Exactly one should get it. How do you design that?",
  "context": "You are building checkout for a flash sale. Stock says 1. Two requests arrive within the same millisecond, both read 1, both decide 'in stock', and both decrement. You have just sold two items you do not have.\n\nThe interviewer wants more than 'use a lock'. They want to hear which kind of guard, where it lives, and what happens to the 999 people who lose.",
  "whyHard": "The bug is the gap between *checking* the stock and *taking* it. Closing that gap is easy in one process and harder across servers, where the truth has to live in a shared place such as the database.\n\nThere is a second problem: buying is not instant. A shopper who holds the last unit while typing card details must not block everyone forever, and must not lose the item if they are merely slow.",
  "options": [
    {
      "name": "One lock around check and take",
      "concept": "Mutual exclusion (synchronized / locks)",
      "conceptIds": [
        "locks-synchronization",
        "race-conditions"
      ],
      "how": "Wrap the check and the decrement in one critical section, so no other thread can run between them. Only one buyer at a time can see the 1.",
      "code": [
        {
          "file": "StockSynchronized.java",
          "body": "import java.util.HashMap;\nimport java.util.Map;\n\npublic class StockSynchronized {\n    private final Map<String, Integer> stock = new HashMap<>();\n\n    public synchronized void load(String sku, int units) {\n        stock.put(sku, units);\n    }\n\n    // check and take happen under one lock, so no one can slip in between them\n    public synchronized boolean tryTake(String sku) {\n        int left = stock.getOrDefault(sku, 0);\n        if (left <= 0) return false;\n        stock.put(sku, left - 1);\n        return true;\n    }\n}"
        }
      ],
      "pros": [
        "Simplest option and obviously correct.",
        "Easy to explain and to test."
      ],
      "cons": [
        "Works inside one process only.",
        "A single lock serialises unrelated products; use one lock per SKU when you scale it."
      ],
      "pickWhen": "One server, modest traffic, or a machine-coding round where one process is the whole system."
    },
    {
      "name": "Atomic counter with compare-and-swap",
      "concept": "Atomic operations / CAS",
      "conceptIds": [
        "atomic-operations-cas"
      ],
      "how": "Keep stock in an `AtomicInteger`. Read the value, and only decrement it if nobody changed it in the meantime (`compareAndSet`). If you lose the race, re-read and try again, and stop when the value reaches 0.",
      "code": [
        {
          "file": "StockCas.java",
          "body": "import java.util.concurrent.ConcurrentHashMap;\nimport java.util.concurrent.atomic.AtomicInteger;\n\npublic class StockCas {\n    private final ConcurrentHashMap<String, AtomicInteger> stock = new ConcurrentHashMap<>();\n\n    public void load(String sku, int units) {\n        stock.put(sku, new AtomicInteger(units));\n    }\n\n    public boolean tryTake(String sku) {\n        AtomicInteger left = stock.get(sku);\n        if (left == null) return false;\n        while (true) {\n            int current = left.get();\n            if (current <= 0) return false;                        // sold out\n            if (left.compareAndSet(current, current - 1)) return true;  // we won the unit\n            // someone else changed it first: re-read and try again\n        }\n    }\n\n    public void release(String sku) {\n        stock.get(sku).incrementAndGet();\n    }\n}"
        }
      ],
      "pros": [
        "No lock, so nothing blocks.",
        "Fast for a single hot number."
      ],
      "cons": [
        "Still one process only.",
        "Hard to extend when one purchase must change several numbers atomically (item plus coupon)."
      ],
      "pickWhen": "Stock lives in memory on one node and the whole check-and-update touches a single number."
    },
    {
      "name": "Conditional UPDATE in the database",
      "concept": "Database-enforced atomicity",
      "conceptIds": [
        "database-locking",
        "optimistic-vs-pessimistic-locking"
      ],
      "how": "Let the database do the check and the decrement in one statement: `UPDATE ... SET stock = stock - 1 WHERE sku = ? AND stock > 0`. Count the rows changed. One row means you got the unit; zero means sold out.",
      "code": [
        {
          "file": "stock-conditional-update.sql",
          "body": "-- One statement checks and decrements atomically inside the database.\nUPDATE inventory\n   SET stock = stock - 1\n WHERE sku = ?\n   AND stock > 0;\n\n-- rows updated = 1  -> you got the unit\n-- rows updated = 0  -> sold out (or unknown sku)"
        },
        {
          "file": "StockSql.java",
          "body": "import java.sql.Connection;\nimport java.sql.PreparedStatement;\nimport java.sql.SQLException;\n\npublic class StockSql {\n    public boolean tryTake(Connection db, String sku) throws SQLException {\n        String sql = \"UPDATE inventory SET stock = stock - 1 WHERE sku = ? AND stock > 0\";\n        try (PreparedStatement ps = db.prepareStatement(sql)) {\n            ps.setString(1, sku);\n            return ps.executeUpdate() == 1;   // exactly one row changed = this caller got the unit\n        }\n    }\n}"
        }
      ],
      "pros": [
        "Correct across any number of app servers.",
        "Truth survives crashes and restarts.",
        "One round trip."
      ],
      "cons": [
        "A very hot row makes all buyers queue on one row lock.",
        "Stock must be stored in the database, not in a cache."
      ],
      "pickWhen": "More than one app server, and the database is already your source of truth."
    },
    {
      "name": "Hold the unit with an expiry",
      "concept": "Reservation with TTL",
      "conceptIds": [
        "reservation-with-ttl"
      ],
      "how": "Moving to checkout takes the unit out of 'available' and parks it under a hold id for a few minutes. Confirming uses `remove`, which only one caller can win. A sweeper returns expired holds to the shelf. The take itself still uses one of the options above.",
      "code": [
        {
          "file": "StockHold.java",
          "body": "import java.time.Clock;\nimport java.time.Duration;\nimport java.time.Instant;\nimport java.util.Map;\nimport java.util.UUID;\nimport java.util.concurrent.ConcurrentHashMap;\n\npublic class StockHold {\n    record Hold(String sku, String buyer, Instant expiresAt) {}\n\n    private final Clock clock;\n    private final StockCas stock;\n    private final Map<String, Hold> holds = new ConcurrentHashMap<>();\n\n    public StockHold(Clock clock, StockCas stock) {\n        this.clock = clock;\n        this.stock = stock;\n    }\n\n    /** Takes the unit out of \"available\" and parks it under a hold id. */\n    public String hold(String sku, String buyer, Duration ttl) {\n        if (!stock.tryTake(sku)) return null;\n        String holdId = UUID.randomUUID().toString();\n        holds.put(holdId, new Hold(sku, buyer, clock.instant().plus(ttl)));\n        return holdId;\n    }\n\n    /** Called after payment. remove() is atomic, so only one caller can confirm a hold. */\n    public boolean confirm(String holdId) {\n        Hold hold = holds.remove(holdId);\n        if (hold == null) return false;                      // already confirmed or swept\n        if (!clock.instant().isBefore(hold.expiresAt())) {   // too late: give the unit back\n            stock.release(hold.sku());\n            return false;\n        }\n        return true;\n    }\n\n    /** Run every few seconds: expired holds return their unit to the shelf. */\n    public void sweep() {\n        Instant now = clock.instant();\n        holds.forEach((id, hold) -> {\n            if (!now.isBefore(hold.expiresAt()) && holds.remove(id, hold)) {\n                stock.release(hold.sku());\n            }\n        });\n    }\n}"
        }
      ],
      "pros": [
        "A buyer who is typing a card number does not lose the unit.",
        "Losers can be given a fair waitlist."
      ],
      "cons": [
        "More moving parts: sweeper, expiry races, clock handling.",
        "Abandoned holds hide stock until the TTL passes."
      ],
      "pickWhen": "Buying takes time (payment, seat selection) and the item is scarce."
    }
  ],
  "recommendation": "Make the database conditional update (option 3) the single decision point, because it is correct across servers and survives crashes. If checkout takes more than a moment, add a short hold with an expiry on top; a hold is just another conditional update that moves a unit from *available* to *held*.\n\nKeep the lock and CAS versions for in-memory components and for machine-coding rounds. Whatever you pick, decide what the losers see: a clear 'sold out' or a waitlist spot, never a silent failure.",
  "say": "The real problem is the gap between checking the stock and decrementing it, so I need those to be one atomic step. In memory that is a lock or a compare-and-swap. Across servers it is a conditional UPDATE where stock is greater than zero, and I look at the rows affected. Because payment takes time, I add a hold with a short expiry so the unit is not lost while someone types their card, and a sweeper returns it if they abandon. Everyone who loses gets a clear sold-out message or a waitlist spot.",
  "appearsIn": [
    "limited-stock-cart",
    "shopping-cart-system",
    "quick-commerce-delivery-app",
    "online-bookstore"
  ],
  "related": [
    "race-conditions",
    "reservation-with-ttl",
    "hold-expires-during-payment",
    "double-booking-same-slot",
    "hot-key-contention"
  ]
},
{
  "id": "double-booking-same-slot",
  "prompt": "Two users try to book the same seat, meeting room or appointment slot at the same instant. How do you make sure only one of them succeeds?",
  "context": "A booking service checks 'is this slot free?' and, if so, writes a booking. Both requests see 'free' and both write. Now two people hold a booking for one slot.\n\nThe same shape appears in movie seats, hotel rooms, doctor appointments and car rentals.",
  "whyHard": "It is the same check-then-act bug as the last-item case, with a twist: the thing being claimed is identified by a *key* (resource plus time), not a counter, and the claim must also be undone cleanly on cancellation.\n\nA lock on the whole table is correct but slows every booking. A lock per slot is fast but needs a home. Overlapping time ranges make it harder still, and that is covered in its own drill.",
  "options": [
    {
      "name": "Atomic claim in memory (putIfAbsent)",
      "concept": "Atomic check-and-set on a map",
      "conceptIds": [
        "atomic-operations-cas",
        "race-conditions"
      ],
      "how": "Use the slot key as a map key. `putIfAbsent` stores the user only if nobody is there yet and tells you whether you won. Cancelling removes the entry only if you are the owner.",
      "code": [
        {
          "file": "SlotRegistry.java",
          "body": "import java.util.concurrent.ConcurrentHashMap;\n\npublic class SlotRegistry {\n    private final ConcurrentHashMap<String, String> bookedBy = new ConcurrentHashMap<>();\n\n    /** putIfAbsent is atomic: exactly one caller per slot ever sees null. */\n    public boolean book(String resourceId, String slot, String user) {\n        return bookedBy.putIfAbsent(resourceId + \"@\" + slot, user) == null;\n    }\n\n    /** Only the owner can release their own booking. */\n    public boolean cancel(String resourceId, String slot, String user) {\n        return bookedBy.remove(resourceId + \"@\" + slot, user);\n    }\n}"
        }
      ],
      "pros": [
        "One line, no explicit locks.",
        "Naturally per slot, so different slots never contend."
      ],
      "cons": [
        "Single process only.",
        "State is lost on restart."
      ],
      "pickWhen": "A single-node design or a machine-coding round."
    },
    {
      "name": "Unique constraint in the database",
      "concept": "Let the database enforce the invariant",
      "conceptIds": [
        "database-locking"
      ],
      "how": "Declare `UNIQUE (resource_id, slot_start)`. Insert the booking and treat a duplicate-key error as 'slot taken'. The database serialises the conflict for you.",
      "code": [
        {
          "file": "booking-unique.sql",
          "body": "CREATE TABLE booking (\n  id          BIGINT PRIMARY KEY,\n  resource_id BIGINT    NOT NULL,\n  slot_start  TIMESTAMP NOT NULL,\n  user_id     BIGINT    NOT NULL,\n  UNIQUE (resource_id, slot_start)      -- the database refuses a second booking of the same slot\n);"
        },
        {
          "file": "BookingDao.java",
          "body": "import java.sql.Connection;\nimport java.sql.PreparedStatement;\nimport java.sql.SQLException;\nimport java.sql.SQLIntegrityConstraintViolationException;\nimport java.sql.Timestamp;\n\npublic class BookingDao {\n    public boolean book(Connection db, long id, long resourceId, Timestamp slotStart, long userId)\n            throws SQLException {\n        String sql = \"INSERT INTO booking(id, resource_id, slot_start, user_id) VALUES (?, ?, ?, ?)\";\n        try (PreparedStatement ps = db.prepareStatement(sql)) {\n            ps.setLong(1, id);\n            ps.setLong(2, resourceId);\n            ps.setTimestamp(3, slotStart);\n            ps.setLong(4, userId);\n            ps.executeUpdate();\n            return true;\n        } catch (SQLIntegrityConstraintViolationException slotTaken) {\n            return false;   // some drivers throw a plain SQLException with SQLState 23505 instead\n        }\n    }\n}"
        }
      ],
      "pros": [
        "Cannot be bypassed by a forgotten code path.",
        "Works across any number of servers.",
        "No locking code to write."
      ],
      "cons": [
        "Only catches an exact key match, not overlapping ranges.",
        "You must handle the violation error (drivers differ in how they raise it)."
      ],
      "pickWhen": "Slots are fixed units (a seat, an hourly slot) and you already have a database."
    },
    {
      "name": "Lock the slot row (SELECT FOR UPDATE)",
      "concept": "Pessimistic locking",
      "conceptIds": [
        "optimistic-vs-pessimistic-locking",
        "database-locking"
      ],
      "how": "Inside a transaction, select the slot row with `FOR UPDATE`. A competing booking waits at that line until you commit, then sees 'BOOKED' and backs off.",
      "code": [
        {
          "file": "slot-for-update.sql",
          "body": "BEGIN;\n\nSELECT status FROM slot\n WHERE resource_id = :resource AND slot_start = :start\n   FOR UPDATE;                         -- other buyers of this slot wait here\n\n-- application checks status = 'FREE', otherwise ROLLBACK\n\nUPDATE slot SET status = 'BOOKED', user_id = :user\n WHERE resource_id = :resource AND slot_start = :start;\n\nCOMMIT;"
        }
      ],
      "pros": [
        "Lets you run any number of checks (price, rules, other rows) while you hold the slot.",
        "Waiting buyers get a definite answer afterwards."
      ],
      "cons": [
        "Waiters queue up, and long transactions hold the lock longer.",
        "If you lock several slots, lock them in sorted order or you can deadlock."
      ],
      "pickWhen": "Booking involves several checks or several rows, and conflicts are common."
    },
    {
      "name": "Optimistic version check",
      "concept": "Optimistic locking",
      "conceptIds": [
        "optimistic-vs-pessimistic-locking"
      ],
      "how": "Read the slot and its version. Write the booking only if the version is unchanged (`WHERE version = ?`, or `replace(key, old, new)` in memory). If it changed, someone else got there first, so you retry or fail.",
      "code": [
        {
          "file": "SlotOptimistic.java",
          "body": "import java.util.concurrent.ConcurrentHashMap;\n\npublic class SlotOptimistic {\n    record Slot(String status, long version) {}\n\n    private final ConcurrentHashMap<String, Slot> slots = new ConcurrentHashMap<>();\n\n    public void open(String key) {\n        slots.put(key, new Slot(\"FREE\", 0));\n    }\n\n    public boolean book(String key) {\n        Slot seen = slots.get(key);\n        if (seen == null || !seen.status().equals(\"FREE\")) return false;\n        // replace(key, old, new) only succeeds if nobody changed the slot since we read it\n        return slots.replace(key, seen, new Slot(\"BOOKED\", seen.version() + 1));\n    }\n}"
        },
        {
          "file": "slot-optimistic.sql",
          "body": "UPDATE slot\n   SET status = 'BOOKED', user_id = :user, version = version + 1\n WHERE id = :slotId\n   AND version = :versionWeRead      -- fails (0 rows) if anyone else booked or edited it\n   AND status = 'FREE';"
        }
      ],
      "pros": [
        "Nobody waits and readers are never blocked.",
        "Very cheap when conflicts are rare."
      ],
      "cons": [
        "Losers must retry or fail.",
        "Under heavy contention most attempts are wasted work."
      ],
      "pickWhen": "Conflicts are rare, for example editing your own booking, and you want maximum read throughput."
    }
  ],
  "recommendation": "For fixed slots, add the unique constraint first: it is the cheapest guard that cannot be bypassed, and the violation maps cleanly to 'slot taken'. Add `SELECT ... FOR UPDATE` only when the booking needs extra checks in the same transaction. Use optimistic checks where contention is low.\n\nFor time *ranges*, a plain unique key is not enough; use an exclusion constraint or lock a parent row (see the overlapping-intervals drill).",
  "say": "I would make the database the referee. A unique constraint on resource and slot means a second booking simply cannot be written, and I treat the violation as 'slot taken'. If booking also needs checks across other rows, I lock the slot row with SELECT FOR UPDATE inside one transaction. Optimistic versioning is a good fit when conflicts are rare. In a single-process machine-coding version, putIfAbsent on a map gives the same atomic claim.",
  "appearsIn": [
    "movie-ticket-booking",
    "concert-ticket-booking",
    "hotel-management-system",
    "car-rental-system",
    "airline-management-system"
  ],
  "related": [
    "last-item-in-stock",
    "overlapping-time-intervals",
    "optimistic-vs-pessimistic-locking",
    "hold-expires-during-payment"
  ]
},
{
  "id": "duplicate-charge-on-retry",
  "prompt": "A customer taps Pay, the network times out, and the app retries. How do you make sure they are charged exactly once?",
  "context": "The first request may or may not have reached the payment provider, and the client cannot tell which. So it sends the request again. If the server treats the retry as brand new, the customer pays twice.\n\nThe same thing happens with double-clicks, mobile apps that retry on flaky networks, and message queues that deliver a message twice.",
  "whyHard": "'Retry on failure' and 'never do it twice' pull in opposite directions, and you cannot know whether the first attempt worked. The answer is not to stop retries but to make repeating an operation *harmless*.\n\nThat means remembering what you already did, atomically, and handling the case where two copies of the same request arrive at the same moment.",
  "options": [
    {
      "name": "Idempotency key with a stored result",
      "concept": "Idempotency",
      "conceptIds": [
        "idempotency"
      ],
      "how": "The client generates one key per user intent and sends it on every retry. The server looks the key up: if it has a result, it returns it; if not, it does the work and stores the result under that key.",
      "code": [
        {
          "file": "IdempotentPayments.java",
          "body": "import java.util.concurrent.ConcurrentHashMap;\n\npublic class IdempotentPayments {\n    public record Receipt(String chargeId, long amountPaise) {}\n\n    public interface Gateway {\n        Receipt charge(String customerId, long amountPaise);\n    }\n\n    private final ConcurrentHashMap<String, Receipt> receiptsByKey = new ConcurrentHashMap<>();\n    private final Gateway gateway;\n\n    public IdempotentPayments(Gateway gateway) {\n        this.gateway = gateway;\n    }\n\n    /** The client makes one key per user intent and resends the same key on every retry. */\n    public Receipt pay(String idempotencyKey, String customerId, long amountPaise) {\n        return receiptsByKey.computeIfAbsent(idempotencyKey,\n                key -> gateway.charge(customerId, amountPaise));\n    }\n}"
        }
      ],
      "pros": [
        "A clear contract for API clients.",
        "Retries get back the very same receipt.",
        "Works for any operation, not just payments."
      ],
      "cons": [
        "You must store keys and expire them eventually.",
        "Reject the same key with a different amount. The in-memory map shown here is for one server only; use a database table with a unique key in production."
      ],
      "pickWhen": "You own the API and clients can generate a key per user action."
    },
    {
      "name": "Unique business key in the database",
      "concept": "Database-enforced uniqueness",
      "conceptIds": [
        "idempotency",
        "database-locking"
      ],
      "how": "Give the payment table a unique column for the thing being paid for (order id). The first request inserts a row and owns the charge. A retry hits the unique key, inserts nothing and reads the existing row.",
      "code": [
        {
          "file": "payment-unique.sql",
          "body": "CREATE TABLE payment (\n  id        BIGINT PRIMARY KEY,\n  order_id  BIGINT NOT NULL UNIQUE,      -- one successful payment row per order, ever\n  charge_id VARCHAR(64),\n  status    VARCHAR(16) NOT NULL\n);\n\n-- first request inserts; a retry hits the unique key and does nothing\nINSERT INTO payment(id, order_id, status) VALUES (:id, :order, 'CHARGING')\nON CONFLICT (order_id) DO NOTHING;\n-- rows inserted = 1 -> you own the charge. 0 -> read the existing row and return its result."
        }
      ],
      "pros": [
        "Free deduplication with no new moving parts.",
        "Survives restarts and works across servers."
      ],
      "cons": [
        "Only fits operations with a natural unique identifier, such as one payment per order.",
        "A crash after the insert but before the charge leaves a CHARGING row that needs reconciling."
      ],
      "pickWhen": "There is a natural identifier such as an order id."
    },
    {
      "name": "State machine guard",
      "concept": "State pattern / atomic state transition",
      "conceptIds": [
        "state",
        "atomic-operations-cas"
      ],
      "how": "Only the caller that moves the order from PENDING to CHARGING (a compare-and-set) may call the gateway. Everyone else just reads the current state and returns it.",
      "code": [
        {
          "file": "OrderPayment.java",
          "body": "import java.util.concurrent.atomic.AtomicReference;\n\npublic class OrderPayment {\n    public enum State { PENDING, CHARGING, PAID, FAILED }\n\n    public interface Gateway {\n        boolean charge(String orderId, long amountPaise);\n    }\n\n    private final AtomicReference<State> state = new AtomicReference<>(State.PENDING);\n\n    public State pay(String orderId, long amountPaise, Gateway gateway) {\n        // only the caller that flips PENDING -> CHARGING is allowed to touch the gateway\n        if (!state.compareAndSet(State.PENDING, State.CHARGING)) {\n            return state.get();\n        }\n        // if this throws, the order stays CHARGING: reconcile with the gateway, don't blindly retry\n        boolean ok = gateway.charge(orderId, amountPaise);\n        state.set(ok ? State.PAID : State.FAILED);\n        return state.get();\n    }\n}"
        }
      ],
      "pros": [
        "Duplicate work is impossible by construction.",
        "Easy to explain, and it matches how orders already behave."
      ],
      "cons": [
        "A real system must persist the state, not hold it in memory.",
        "A crash during the charge leaves the order stuck in CHARGING and needs reconciliation."
      ],
      "pickWhen": "The entity already has a lifecycle (pending, paid, shipped)."
    },
    {
      "name": "Pass the key to the provider",
      "concept": "Idempotency at the dependency",
      "conceptIds": [
        "idempotency"
      ],
      "how": "Derive a stable key from the business operation (for example the order id) and send it with the charge. Most payment providers return the original result for a repeated key.",
      "code": [
        {
          "file": "CheckoutService.java",
          "body": "public class CheckoutService {\n    public record Receipt(String chargeId, long amountPaise) {}\n\n    public interface PaymentGateway {\n        Receipt charge(String idempotencyKey, String customerId, long amountPaise);\n    }\n\n    private final PaymentGateway gateway;\n\n    public CheckoutService(PaymentGateway gateway) {\n        this.gateway = gateway;\n    }\n\n    public Receipt checkout(String orderId, String customerId, long amountPaise) {\n        // stable for this order, so every retry carries the same key and the provider collapses them\n        String key = \"charge-\" + orderId;\n        return gateway.charge(key, customerId, amountPaise);\n    }\n}"
        }
      ],
      "pros": [
        "The provider guarantees a single charge even if your server crashes mid-call.",
        "Almost no code."
      ],
      "cons": [
        "Relies on provider support and has a limited retention window.",
        "You still need your own record to answer clients and reconcile."
      ],
      "pickWhen": "You call a payment gateway that supports idempotency keys (most do)."
    }
  ],
  "recommendation": "Combine the layers. Derive a stable key from the business operation (the order id). Enforce it with a unique row in your own database so *your* system deduplicates. Pass the same key to the payment provider so the *money movement* deduplicates as well.\n\nAdd a reconciliation job for the small window where you were charged but never recorded the result.",
  "say": "I cannot stop retries, so I make them safe. Each user action gets an idempotency key, derived from the order id. My database has a unique row for it, so a retry finds the existing result instead of charging again, and I pass the same key to the payment provider so the charge itself is deduplicated. Finally a reconciliation job checks for any charge I never recorded, because a crash can still happen between the two steps.",
  "appearsIn": [
    "digital-wallet",
    "shopping-cart-system",
    "online-bookstore",
    "quick-commerce-delivery-app",
    "notification-system"
  ],
  "related": [
    "idempotency",
    "payment-succeeds-order-fails",
    "message-delivery-guarantees",
    "retry-storm"
  ]
},
{
  "id": "lost-update-counter",
  "prompt": "Thousands of users like a post at once, but the counter shows fewer likes than were clicked. Why does that happen and how do you fix it?",
  "context": "The code reads the count, adds one and writes it back. Two threads read 41, both write 42, and one like vanishes. At small scale you will never notice. At viral scale you lose thousands.",
  "whyHard": "`likes++` looks like one step but is three: read, add, write. Any thread can slip in between them.\n\nThe harder follow-up is throughput. A single hot counter that every request touches becomes a bottleneck, so the obvious fix (a lock, or one database row) can be correct and still too slow.",
  "options": [
    {
      "name": "Atomic counter",
      "concept": "Atomic operations",
      "conceptIds": [
        "atomic-operations-cas"
      ],
      "how": "Use `AtomicLong.incrementAndGet()`. The read, add and write happen as one indivisible step, so no update is lost.",
      "code": [
        {
          "file": "LikeCounterAtomic.java",
          "body": "import java.util.concurrent.atomic.AtomicLong;\n\npublic class LikeCounterAtomic {\n    private final AtomicLong likes = new AtomicLong();\n\n    public long like() {\n        return likes.incrementAndGet();   // read, add and write as one indivisible step\n    }\n\n    public long count() {\n        return likes.get();\n    }\n}"
        }
      ],
      "pros": [
        "Exact and lock-free.",
        "One line."
      ],
      "cons": [
        "One JVM only.",
        "At extreme write rates every thread still fights over the same memory location."
      ],
      "pickWhen": "A single JVM and moderate traffic."
    },
    {
      "name": "LongAdder for hot counters",
      "concept": "Striped counters",
      "conceptIds": [
        "atomic-operations-cas"
      ],
      "how": "`LongAdder` keeps several cells and gives each thread its own, so threads rarely collide. Reading adds the cells together.",
      "code": [
        {
          "file": "LikeCounterAdder.java",
          "body": "import java.util.concurrent.atomic.LongAdder;\n\npublic class LikeCounterAdder {\n    private final LongAdder likes = new LongAdder();\n\n    public void like() {\n        likes.increment();   // threads update separate cells, so they rarely collide\n    }\n\n    public long count() {\n        return likes.sum();  // adds the cells up; fine for display, not a precise snapshot\n    }\n}"
        }
      ],
      "pros": [
        "Much faster than `AtomicLong` when many threads write constantly."
      ],
      "cons": [
        "`sum()` is not a precise snapshot while writes are in flight.",
        "Uses more memory, and still single-process."
      ],
      "pickWhen": "Many threads write non-stop and an instantaneous exact read does not matter."
    },
    {
      "name": "Atomic update in the database",
      "concept": "Database-side arithmetic",
      "conceptIds": [
        "database-locking",
        "race-conditions"
      ],
      "how": "Do not read in the app and write back. Send `SET likes = likes + 1` and let the database apply it under its row lock.",
      "code": [
        {
          "file": "likes-atomic-update.sql",
          "body": "-- WRONG: read-modify-write in the app loses updates\n--   SELECT likes FROM post WHERE id = 7;        -- both read 41\n--   UPDATE post SET likes = 42 WHERE id = 7;    -- both write 42, one like vanished\n\n-- RIGHT: let the database do the arithmetic atomically\nUPDATE post SET likes = likes + 1 WHERE id = 7;"
        }
      ],
      "pros": [
        "Correct across any number of servers.",
        "Durable."
      ],
      "cons": [
        "One hot row serialises all its writers.",
        "A very viral post can slow down."
      ],
      "pickWhen": "Several app servers and a moderate write rate per post."
    },
    {
      "name": "Buffer and flush in batches",
      "concept": "Write-behind aggregation",
      "conceptIds": [
        "atomic-operations-cas"
      ],
      "how": "Count likes in memory per post and flush the total every second with `getAndSet(0)`, so thousands of likes become one database write.",
      "code": [
        {
          "file": "LikeBuffer.java",
          "body": "import java.util.concurrent.ConcurrentHashMap;\nimport java.util.concurrent.atomic.AtomicLong;\n\npublic class LikeBuffer {\n    public interface LikeStore {\n        void addLikes(long postId, long delta);\n    }\n\n    private final ConcurrentHashMap<Long, AtomicLong> pending = new ConcurrentHashMap<>();\n    private final LikeStore store;\n\n    public LikeBuffer(LikeStore store) {\n        this.store = store;\n    }\n\n    public void like(long postId) {\n        pending.computeIfAbsent(postId, id -> new AtomicLong()).incrementAndGet();\n    }\n\n    /** Call once a second from a scheduler: one database write per post instead of one per like. */\n    public void flush() {\n        pending.forEach((postId, counter) -> {\n            long delta = counter.getAndSet(0);   // take everything counted so far, atomically\n            if (delta > 0) store.addLikes(postId, delta);\n        });\n    }\n}"
        }
      ],
      "pros": [
        "Protects the database from a write storm.",
        "Scales almost without limit."
      ],
      "cons": [
        "A crash loses the unflushed counts.",
        "Displayed counts lag by up to one flush interval."
      ],
      "pickWhen": "'Approximately now, exact later' is acceptable (likes, views, impressions)."
    }
  ],
  "recommendation": "Start with correctness: an atomic increment in the right layer (`AtomicLong` in memory, `likes = likes + 1` in SQL). If one post goes viral, buffer increments per server and flush batches, and accept that the displayed count is eventually exact.\n\nCounters that behave like money (balances, stock) must stay exact, so never buffer those.",
  "say": "The bug is that read, add, write is three steps and two threads interleave. I replace it with one atomic operation: an atomic increment in memory or likes equals likes plus one in SQL. If a single post is hot, I buffer increments per server and flush batches every second, trading a slightly lagging number for a database that survives. I would only do that for approximate counters like likes, never for balances or stock.",
  "appearsIn": [
    "social-network",
    "spotify",
    "stack-overflow"
  ],
  "related": [
    "race-conditions",
    "atomic-operations-cas",
    "hot-key-contention",
    "last-item-in-stock"
  ]
},
{
  "id": "money-transfer-deadlock",
  "prompt": "Alice sends money to Bob while Bob sends money to Alice, and both transfers freeze forever. What happened, and how do you prevent it?",
  "context": "Each transfer locks the sender first, then the receiver. Transfer 1 holds Alice and waits for Bob. Transfer 2 holds Bob and waits for Alice. Neither can proceed.",
  "whyHard": "Every lock on its own is correct. The bug only appears with one particular interleaving, so tests pass and production hangs.\n\nThe fix needs a rule that holds across every code path that takes more than one lock, and the interviewer will ask what you do when you cannot control the order (locks across services or tables).",
  "options": [
    {
      "name": "Always lock in a fixed order",
      "concept": "Lock ordering",
      "conceptIds": [
        "deadlock-and-lock-ordering",
        "locks-synchronization"
      ],
      "how": "Give every account a unique id and always lock the lower id first, whichever direction the money moves. A circular wait then cannot form.",
      "code": [
        {
          "file": "Account.java",
          "body": "import java.util.concurrent.locks.ReentrantLock;\n\npublic class Account {\n    final long id;\n    long balance;\n    final ReentrantLock lock = new ReentrantLock();\n\n    public Account(long id, long balance) {\n        this.id = id;\n        this.balance = balance;\n    }\n}"
        },
        {
          "file": "OrderedTransfer.java",
          "body": "public class OrderedTransfer {\n    public static boolean transfer(Account from, Account to, long amount) {\n        if (from.id == to.id) return false;\n        // everyone locks the lower id first, so a circular wait can never form\n        Account first = from.id < to.id ? from : to;\n        Account second = first == from ? to : from;\n\n        first.lock.lock();\n        try {\n            second.lock.lock();\n            try {\n                if (from.balance < amount) return false;\n                from.balance -= amount;\n                to.balance += amount;\n                return true;\n            } finally {\n                second.lock.unlock();\n            }\n        } finally {\n            first.lock.unlock();\n        }\n    }\n}"
        }
      ],
      "pros": [
        "Prevents deadlock outright.",
        "No timeouts or retries needed."
      ],
      "cons": [
        "Every code path that takes two locks must follow the rule.",
        "Needs a stable total order, and locks are held for the whole operation."
      ],
      "pickWhen": "You know all the locks up front, as you do for a transfer."
    },
    {
      "name": "tryLock with a timeout and back off",
      "concept": "Timed lock acquisition",
      "conceptIds": [
        "locks-synchronization",
        "deadlock-and-lock-ordering"
      ],
      "how": "Try to get the first lock, then the second, each with a short timeout. If either fails, release what you hold, wait a random moment and retry a few times.",
      "code": [
        {
          "file": "TryLockTransfer.java",
          "body": "import java.util.concurrent.ThreadLocalRandom;\nimport java.util.concurrent.TimeUnit;\n\npublic class TryLockTransfer {\n    public static boolean transfer(Account from, Account to, long amount) throws InterruptedException {\n        for (int attempt = 0; attempt < 5; attempt++) {\n            if (from.lock.tryLock(50, TimeUnit.MILLISECONDS)) {\n                try {\n                    if (to.lock.tryLock(50, TimeUnit.MILLISECONDS)) {\n                        try {\n                            if (from.balance < amount) return false;\n                            from.balance -= amount;\n                            to.balance += amount;\n                            return true;\n                        } finally {\n                            to.lock.unlock();\n                        }\n                    }\n                } finally {\n                    from.lock.unlock();   // couldn't get both: let go of what we hold\n                }\n            }\n            Thread.sleep(ThreadLocalRandom.current().nextInt(5, 25));   // jitter so rivals don't retry in lockstep\n        }\n        return false;   // caller decides: surface \"try again\" to the user\n    }\n}"
        }
      ],
      "pros": [
        "Works when you cannot impose an order.",
        "A stuck system recovers by itself."
      ],
      "cons": [
        "Without random jitter two threads can livelock, retrying in lockstep.",
        "Callers must handle the failure, and the code is longer."
      ],
      "pickWhen": "The lock order is unknowable (callbacks, plug-in code) or you want a bounded wait."
    },
    {
      "name": "Lock the database rows in order",
      "concept": "Ordered row locks in one transaction",
      "conceptIds": [
        "database-locking",
        "deadlock-and-lock-ordering"
      ],
      "how": "In one transaction, select both account rows `ORDER BY id ... FOR UPDATE`, then update them. It is the same ordering rule, enforced by the database. The database also detects and aborts a deadlock as a backstop.",
      "code": [
        {
          "file": "transfer-ordered-rows.sql",
          "body": "BEGIN;\n\n-- lock both rows in a fixed order (lowest id first), whichever direction the money moves\nSELECT id, balance FROM account\n WHERE id IN (:from, :to)\n ORDER BY id\n   FOR UPDATE;\n\nUPDATE account SET balance = balance - :amount\n WHERE id = :from AND balance >= :amount;   -- 0 rows => insufficient funds, ROLLBACK\n\nUPDATE account SET balance = balance + :amount WHERE id = :to;\n\nCOMMIT;"
        }
      ],
      "pros": [
        "Atomic across both rows.",
        "Built-in deadlock detection as a safety net."
      ],
      "cons": [
        "You must retry if the database kills your transaction.",
        "Row locks are held until commit."
      ],
      "pickWhen": "Balances live in a SQL database."
    },
    {
      "name": "A single writer for the ledger",
      "concept": "Serialise through one thread or queue",
      "conceptIds": [
        "locks-synchronization"
      ],
      "how": "Send every transfer to one thread (or queue) that applies them one by one. With nothing running concurrently, there is nothing to deadlock on.",
      "code": [
        {
          "file": "SerialTransfers.java",
          "body": "import java.util.concurrent.ExecutorService;\nimport java.util.concurrent.Executors;\nimport java.util.concurrent.Future;\n\npublic class SerialTransfers {\n    // one thread applies every transfer, so there is nothing to deadlock on\n    private final ExecutorService ledger = Executors.newSingleThreadExecutor();\n\n    public Future<Boolean> transfer(Account from, Account to, long amount) {\n        return ledger.submit(() -> {\n            if (from.id == to.id || from.balance < amount) return false;\n            from.balance -= amount;\n            to.balance += amount;\n            return true;\n        });\n    }\n\n    public void shutdown() {\n        ledger.shutdown();\n    }\n}"
        }
      ],
      "pros": [
        "No locks, no deadlocks, trivially consistent."
      ],
      "cons": [
        "Throughput is capped at one thread.",
        "One slow transfer delays all the others."
      ],
      "pickWhen": "A small system, or a partition small enough for a single writer to keep up."
    }
  ],
  "recommendation": "Lock accounts in id order: option 1 in memory, option 3 in SQL. It is cheap, deterministic and easy to explain. Keep `tryLock` as a safety net for code whose lock order you do not control.\n\nWhen you scale out, partition accounts and make each partition single-threaded; for a transfer that spans partitions, use a two-step flow with compensation instead of holding two locks.",
  "say": "This is a circular wait: each transfer holds one account and wants the other. The fix is to break the circle with a global order. I lock accounts by ascending id, whichever direction the money moves, so two opposing transfers both start with the same account and one simply waits. In SQL I do the same with SELECT FOR UPDATE ordered by id. If I cannot control the order I fall back to tryLock with a timeout and jittered retries.",
  "appearsIn": [
    "digital-wallet",
    "splitwise",
    "atm"
  ],
  "related": [
    "deadlock-and-lock-ordering",
    "locks-synchronization",
    "database-locking",
    "duplicate-charge-on-retry",
    "payment-succeeds-order-fails"
  ]
},
{
  "id": "hold-expires-during-payment",
  "prompt": "A user holds the last seat for five minutes, and the timer runs out while their payment is still processing. What happens to the seat and to the money?",
  "context": "Holds expire so that abandoned carts do not block inventory forever. But payment takes an unpredictable amount of time. At 4:59 the user presses Pay. At 5:00 the sweeper releases the seat to the next buyer. At 5:01 the payment succeeds.\n\nNow either two people think they own the seat, or one person has paid for nothing.",
  "whyHard": "Two independent clocks, the hold and the payment, race each other and neither knows about the other.\n\nWhatever you choose must give a clear answer to 'who wins?', and must leave the money consistent in every case: the customer is never charged for something they do not get.",
  "options": [
    {
      "name": "Mark the hold as PAYING so the sweeper skips it",
      "concept": "State machine with atomic transitions",
      "conceptIds": [
        "state",
        "reservation-with-ttl",
        "atomic-operations-cas"
      ],
      "how": "The hold has states HELD, PAYING, CONFIRMED and RELEASED. Pressing Pay does a compare-and-set from HELD to PAYING (only if the hold has not expired). The sweeper may only release HELD holds. Either the sweeper wins before payment starts or payment wins, and never both.",
      "code": [
        {
          "file": "SeatHold.java",
          "body": "import java.time.Instant;\nimport java.util.concurrent.atomic.AtomicReference;\n\npublic class SeatHold {\n    public enum State { HELD, PAYING, CONFIRMED, RELEASED }\n\n    private final AtomicReference<State> state = new AtomicReference<>(State.HELD);\n    private final Instant expiresAt;\n\n    public SeatHold(Instant expiresAt) {\n        this.expiresAt = expiresAt;\n    }\n\n    /** User pressed Pay. Fails if the hold already lapsed or the sweeper released it. */\n    public boolean startPayment(Instant now) {\n        return now.isBefore(expiresAt) && state.compareAndSet(State.HELD, State.PAYING);\n    }\n\n    public boolean confirm() {\n        return state.compareAndSet(State.PAYING, State.CONFIRMED);\n    }\n\n    /** Payment declined: back to HELD, which still carries the original expiry. */\n    public boolean paymentFailed() {\n        return state.compareAndSet(State.PAYING, State.HELD);\n    }\n\n    /** The sweeper can only release a hold nobody is paying for. */\n    public boolean expire(Instant now) {\n        return !now.isBefore(expiresAt) && state.compareAndSet(State.HELD, State.RELEASED);\n    }\n\n    public State state() {\n        return state.get();\n    }\n}"
        }
      ],
      "pros": [
        "No race: exactly one of the sweeper and the payment wins.",
        "Easy to reason about and to test."
      ],
      "cons": [
        "A stuck payment keeps the seat blocked, so PAYING needs its own deadline.",
        "One more state to handle."
      ],
      "pickWhen": "You control the moment payment starts, as in a typical checkout."
    },
    {
      "name": "Extend the hold while the user is paying",
      "concept": "Lease renewal",
      "conceptIds": [
        "reservation-with-ttl"
      ],
      "how": "When the payment page opens, and then on a heartbeat while it stays open, push the expiry forward with a compare-and-set. Cap the total time so nobody can hold a seat forever.",
      "code": [
        {
          "file": "ExtendableHold.java",
          "body": "import java.time.Duration;\nimport java.time.Instant;\nimport java.util.concurrent.atomic.AtomicLong;\n\npublic class ExtendableHold {\n    private static final Duration MAX_TOTAL = Duration.ofMinutes(15);\n\n    private final Instant createdAt;\n    private final AtomicLong expiresAtMillis;\n\n    public ExtendableHold(Instant now, Duration ttl) {\n        this.createdAt = now;\n        this.expiresAtMillis = new AtomicLong(now.plus(ttl).toEpochMilli());\n    }\n\n    /** Called when the user opens the payment page and then on a heartbeat while it stays open. */\n    public boolean extend(Instant now, Duration extra) {\n        long current = expiresAtMillis.get();\n        if (now.toEpochMilli() >= current) return false;               // already lost, too late to renew\n        long wanted = Math.min(current + extra.toMillis(),\n                createdAt.plus(MAX_TOTAL).toEpochMilli());               // hard cap so nobody holds forever\n        return expiresAtMillis.compareAndSet(current, wanted);\n    }\n\n    public boolean isActive(Instant now) {\n        return now.toEpochMilli() < expiresAtMillis.get();\n    }\n}"
        }
      ],
      "pros": [
        "Friendly for users, with fewer surprise expiries."
      ],
      "cons": [
        "Needs a hard cap.",
        "Extending is itself a race against expiry, so it must be a compare-and-set, and an already-expired hold cannot be revived."
      ],
      "pickWhen": "Payment pages are slow and you want a gentler experience."
    },
    {
      "name": "Authorize first, capture only if the hold is still ours",
      "concept": "Two-phase payment (authorize, then capture)",
      "conceptIds": [
        "idempotency",
        "reservation-with-ttl"
      ],
      "how": "Reserve the funds (authorize), then confirm the hold atomically. If the hold is gone, void the authorization: no money ever moved. If it is still ours, capture.",
      "code": [
        {
          "file": "AuthorizeThenCapture.java",
          "body": "public class AuthorizeThenCapture {\n    public record Authorization(String id) {}\n    public record Receipt(String chargeId) {}\n\n    public interface Gateway {\n        Authorization authorize(String paymentMethod, long amountPaise);   // funds reserved, nothing taken yet\n        Receipt capture(String authorizationId);\n        void voidAuthorization(String authorizationId);\n    }\n\n    public interface Holds {\n        boolean confirm(String holdId);   // atomic: false if expired or already released\n    }\n\n    public static class HoldExpiredException extends RuntimeException {}\n\n    private final Gateway gateway;\n    private final Holds holds;\n\n    public AuthorizeThenCapture(Gateway gateway, Holds holds) {\n        this.gateway = gateway;\n        this.holds = holds;\n    }\n\n    public Receipt checkout(String holdId, String paymentMethod, long amountPaise) {\n        Authorization auth = gateway.authorize(paymentMethod, amountPaise);\n        if (!holds.confirm(holdId)) {\n            gateway.voidAuthorization(auth.id());   // nothing was charged, so nothing to refund\n            throw new HoldExpiredException();\n        }\n        return gateway.capture(auth.id());\n    }\n}"
        }
      ],
      "pros": [
        "A lost hold costs the customer nothing, so there is nothing to refund."
      ],
      "cons": [
        "Needs a gateway that supports authorize and capture.",
        "Authorizations expire too."
      ],
      "pickWhen": "Card payments with authorization support."
    },
    {
      "name": "Accept the late payment and reconcile",
      "concept": "Compensation (refund) as the safety net",
      "conceptIds": [
        "idempotency"
      ],
      "how": "When the success webhook arrives, try to confirm the hold. If it lapsed, try to take the unit again. If someone else got it, refund automatically and tell the customer.",
      "code": [
        {
          "file": "LatePaymentHandler.java",
          "body": "public class LatePaymentHandler {\n    public enum Outcome { CONFIRMED, CONFIRMED_LATE, REFUNDED }\n\n    public interface Holds {\n        boolean confirm(String holdId);\n    }\n    public interface Inventory {\n        boolean tryTake(String sku);\n    }\n    public interface Refunds {\n        void refund(String orderId);\n    }\n\n    private final Holds holds;\n    private final Inventory inventory;\n    private final Refunds refunds;\n\n    public LatePaymentHandler(Holds holds, Inventory inventory, Refunds refunds) {\n        this.holds = holds;\n        this.inventory = inventory;\n        this.refunds = refunds;\n    }\n\n    /** Called from the payment webhook: the money has already moved. */\n    public Outcome onPaymentSucceeded(String holdId, String orderId, String sku) {\n        if (holds.confirm(holdId)) return Outcome.CONFIRMED;\n        if (inventory.tryTake(sku)) return Outcome.CONFIRMED_LATE;   // hold lapsed but nobody else took the unit\n        refunds.refund(orderId);                                     // someone else got it: pay the customer back\n        return Outcome.REFUNDED;\n    }\n}"
        }
      ],
      "pros": [
        "Handles payments that complete long after the app gave up.",
        "If the seat is still free the customer still gets it."
      ],
      "cons": [
        "Refunds are slow and annoying for the customer.",
        "You need apology and waitlist flows."
      ],
      "pickWhen": "Payments are asynchronous (UPI, bank redirects) so you cannot stop them mid-flight."
    }
  ],
  "recommendation": "Use option 1 as the main guard so the sweeper and the payment can never both win, give PAYING a bounded deadline, and use authorize-then-capture where the gateway allows it so a lost hold costs nothing.\n\nKeep option 4's reconciliation as the backstop for asynchronous payments, because no timing rule can cover a webhook that arrives an hour later.",
  "say": "The hold and the payment have separate clocks, so I make them agree through state. Pressing Pay atomically moves the hold from HELD to PAYING, and the sweeper only releases HELD holds. If the hold is already gone, the user is told straight away. For card payments I authorize first and capture only after confirming the hold, so a lost hold never moves money. For slow async payments I add a reconciliation path that re-claims the seat or refunds.",
  "appearsIn": [
    "movie-ticket-booking",
    "concert-ticket-booking",
    "limited-stock-cart",
    "airline-management-system"
  ],
  "related": [
    "reservation-with-ttl",
    "last-item-in-stock",
    "payment-succeeds-order-fails",
    "idempotency"
  ]
},
{
  "id": "stale-cache-after-update",
  "prompt": "A seller changes a product's price, but customers keep seeing the old price. How do you keep the cache correct?",
  "context": "You cache product pages because reads vastly outnumber writes. After an update the database holds the new price and the cache still holds the old one.\n\nWorse, if a read and an update interleave badly, the cache can end up holding an *older* value than the database until it expires.",
  "whyHard": "Writing to two places, the database and the cache, is not atomic, so there is always a window where they disagree.\n\nThere is also a classic race: a reader loads the old value, a writer updates and deletes the cache entry, and then the reader stores its old value. That stale entry lives until the TTL. Every strategy chooses how big the window is and who pays for it.",
  "options": [
    {
      "name": "Cache-aside: write the database, then delete the cache entry",
      "concept": "Cache-aside with invalidation",
      "conceptIds": [
        "race-conditions"
      ],
      "how": "Reads check the cache, and on a miss load from the database and store the result. Writes commit to the database first and then delete the cache entry, so the next read reloads fresh data.",
      "code": [
        {
          "file": "Product.java",
          "body": "public record Product(long id, String name, long pricePaise, long version) {}"
        },
        {
          "file": "ProductDb.java",
          "body": "public interface ProductDb {\n    Product load(long id);\n    void save(Product product);\n}"
        },
        {
          "file": "CacheAside.java",
          "body": "import java.util.concurrent.ConcurrentHashMap;\n\npublic class CacheAside {\n    private final ConcurrentHashMap<Long, Product> cache = new ConcurrentHashMap<>();\n    private final ProductDb db;\n\n    public CacheAside(ProductDb db) {\n        this.db = db;\n    }\n\n    public Product get(long id) {\n        return cache.computeIfAbsent(id, db::load);   // miss: load from the database and remember it\n    }\n\n    public void update(Product product) {\n        db.save(product);            // 1. commit the truth\n        cache.remove(product.id());  // 2. then drop the cached copy so the next read reloads it\n    }\n}"
        }
      ],
      "pros": [
        "Simple, and the cache never has to be *right*, only absent.",
        "A good default."
      ],
      "cons": [
        "There is a window between the commit and the delete.",
        "With a shared external cache, a slow reader can put the old value back after the delete."
      ],
      "pickWhen": "This is your default choice and slightly stale reads are acceptable."
    },
    {
      "name": "Version every entry",
      "concept": "Optimistic versioning",
      "conceptIds": [
        "optimistic-vs-pessimistic-locking"
      ],
      "how": "Store a version with each product and have the cache accept a write only if its version is not older than what it already holds. An old read can then never overwrite a newer value.",
      "code": [
        {
          "file": "VersionedCache.java",
          "body": "import java.util.concurrent.ConcurrentHashMap;\n\npublic class VersionedCache {\n    private final ConcurrentHashMap<Long, Product> cache = new ConcurrentHashMap<>();\n    private final ProductDb db;\n\n    public VersionedCache(ProductDb db) {\n        this.db = db;\n    }\n\n    public Product get(long id) {\n        Product cached = cache.get(id);\n        if (cached != null) return cached;\n        Product fresh = db.load(id);\n        put(fresh);\n        return cache.get(id);\n    }\n\n    public void update(Product product) {\n        db.save(product);\n        put(product);\n    }\n\n    /** An older version can never overwrite a newer one, whatever order the writes arrive in. */\n    private void put(Product incoming) {\n        cache.merge(incoming.id(), incoming,\n                (current, candidate) -> candidate.version() >= current.version() ? candidate : current);\n    }\n}"
        }
      ],
      "pros": [
        "Closes the stale-set race for good.",
        "Works with out-of-order arrivals."
      ],
      "cons": [
        "Needs a version column and every writer must bump it.",
        "A little more storage and code."
      ],
      "pickWhen": "An external cache such as Redis is shared by many readers and writers."
    },
    {
      "name": "Write-through",
      "concept": "Write-through caching",
      "conceptIds": [
        "locks-synchronization"
      ],
      "how": "Every update writes the database and the cache together, under a per-key lock so the two are written in the same order.",
      "code": [
        {
          "file": "WriteThrough.java",
          "body": "import java.util.concurrent.ConcurrentHashMap;\n\npublic class WriteThrough {\n    private final ConcurrentHashMap<Long, Product> cache = new ConcurrentHashMap<>();\n    private final ConcurrentHashMap<Long, Object> locks = new ConcurrentHashMap<>();\n    private final ProductDb db;\n\n    public WriteThrough(ProductDb db) {\n        this.db = db;\n    }\n\n    public Product get(long id) {\n        return cache.computeIfAbsent(id, db::load);\n    }\n\n    public void update(Product product) {\n        Object lock = locks.computeIfAbsent(product.id(), id -> new Object());\n        synchronized (lock) {          // keeps database and cache writes in the same order per product\n            db.save(product);\n            cache.put(product.id(), product);\n        }\n    }\n}"
        }
      ],
      "pros": [
        "A read right after a write sees the new value.",
        "No extra miss after an update."
      ],
      "cons": [
        "Writes are slower.",
        "Concurrent writers must be ordered or the cache can keep the loser.",
        "The cache fills with items nobody reads."
      ],
      "pickWhen": "Read-your-own-write matters and writes are not frequent."
    },
    {
      "name": "Event-driven invalidation with a TTL safety net",
      "concept": "Observer / publish-subscribe",
      "conceptIds": [
        "observer"
      ],
      "how": "Publish a 'product changed' event on every update. Each server subscribes and removes the entry from its local cache. A short TTL repairs anything where an event was missed.",
      "code": [
        {
          "file": "EventInvalidatedCache.java",
          "body": "import java.time.Clock;\nimport java.time.Duration;\nimport java.time.Instant;\nimport java.util.concurrent.ConcurrentHashMap;\nimport java.util.function.LongConsumer;\n\npublic class EventInvalidatedCache {\n    public interface ChangeFeed {\n        void onProductChanged(LongConsumer listener);   // e.g. a message bus subscription\n    }\n\n    record Entry(Product value, Instant expiresAt) {}\n\n    private static final Duration SAFETY_TTL = Duration.ofMinutes(5);\n\n    private final ConcurrentHashMap<Long, Entry> cache = new ConcurrentHashMap<>();\n    private final ProductDb db;\n    private final Clock clock;\n\n    public EventInvalidatedCache(ProductDb db, ChangeFeed feed, Clock clock) {\n        this.db = db;\n        this.clock = clock;\n        feed.onProductChanged(cache::remove);   // every server hears about every change\n    }\n\n    public Product get(long id) {\n        Entry entry = cache.get(id);\n        if (entry != null && clock.instant().isBefore(entry.expiresAt())) return entry.value();\n        Product fresh = db.load(id);            // missed event or expired: the TTL repairs it\n        cache.put(id, new Entry(fresh, clock.instant().plus(SAFETY_TTL)));\n        return fresh;\n    }\n}"
        }
      ],
      "pros": [
        "Every server's local cache hears about every change.",
        "The TTL guarantees eventual repair."
      ],
      "cons": [
        "Needs a message bus.",
        "Events can arrive late or out of order."
      ],
      "pickWhen": "Several servers each keep their own local cache."
    }
  ],
  "recommendation": "Start with cache-aside plus a TTL: invalidate on write and expire anyway. Add versions when you have an external shared cache and see stale entries slip in. Choose write-through only when users must see their own edits instantly, and use events when many servers hold local copies.\n\nSay out loud that you are trading freshness against complexity, and ask how stale is acceptable for this data (a price page versus a profile photo).",
  "say": "The database and the cache cannot be updated atomically, so I decide how big the disagreement window can be. My default is cache-aside: commit to the database, then delete the cache entry, with a TTL as a safety net. If an external cache lets a slow reader re-insert old data, I add a version so old values can never overwrite new ones. When many servers have local caches, I publish a change event to invalidate them, and the TTL covers a missed event.",
  "appearsIn": [
    "lru-cache",
    "amazon",
    "spotify",
    "online-bookstore"
  ],
  "related": [
    "read-heavy-caching",
    "race-conditions",
    "optimistic-vs-pessimistic-locking",
    "observer"
  ]
},
{
  "id": "job-picked-by-two-workers",
  "prompt": "You run ten workers that pull jobs from a table or a queue, and sometimes two of them run the same job. How do you stop that?",
  "context": "A scheduler adds jobs such as 'send invoice' or 'resize image'. Workers poll: 'find a pending job, mark it running, do it'. Two workers find the same pending job in the same moment, both mark it running, and the invoice goes out twice.\n\nNow add crashes: a worker takes a job and dies, so the job must be picked up again later without ever running twice at the same time.",
  "whyHard": "You are fighting two opposite failures: running a job twice, or never running it because a worker died. Claiming has to be atomic, and the claim has to *expire* (a lease) so a crash cannot strand work.\n\nPerfect exactly-once is not achievable, so the realistic goal is: claimed by one worker at a time, run at least once, with idempotent effects.",
  "options": [
    {
      "name": "Claim with SELECT FOR UPDATE SKIP LOCKED",
      "concept": "Row locking that skips contended rows",
      "conceptIds": [
        "database-locking"
      ],
      "how": "Each worker runs one statement that picks a pending row and marks it running. `SKIP LOCKED` means a worker never waits on a row another worker has locked; it just takes the next one.",
      "code": [
        {
          "file": "job-skip-locked.sql",
          "body": "-- Each worker runs this. SKIP LOCKED means two workers never fight over the same row.\nUPDATE job\n   SET status = 'RUNNING', worker_id = :me, lease_until = now() + interval '5 minutes'\n WHERE id = (\n        SELECT id FROM job\n         WHERE status = 'PENDING'\n         ORDER BY id\n         LIMIT 1\n           FOR UPDATE SKIP LOCKED\n       )\nRETURNING id, payload;"
        }
      ],
      "pros": [
        "Workers never wait on each other.",
        "One atomic statement and no extra infrastructure."
      ],
      "cons": [
        "The table doubles as the queue, so polling and bloat matter at huge scale.",
        "You still need a lease column for crash recovery."
      ],
      "pickWhen": "Jobs already live in a SQL database."
    },
    {
      "name": "Lease with compare-and-set",
      "concept": "Lease-based ownership",
      "conceptIds": [
        "atomic-operations-cas",
        "reservation-with-ttl"
      ],
      "how": "Claiming swaps the job from PENDING (or from a RUNNING job whose lease has expired) to RUNNING with an owner and a lease end, using a compare-and-set. Completing is allowed only for the current owner.",
      "code": [
        {
          "file": "JobStore.java",
          "body": "import java.time.Duration;\nimport java.time.Instant;\nimport java.util.concurrent.ConcurrentHashMap;\n\npublic class JobStore {\n    public enum Status { PENDING, RUNNING, DONE }\n\n    record Job(long id, Status status, String owner, Instant leaseUntil) {}\n\n    private final ConcurrentHashMap<Long, Job> jobs = new ConcurrentHashMap<>();\n\n    public void add(long id) {\n        jobs.put(id, new Job(id, Status.PENDING, null, null));\n    }\n\n    /** Claim a pending job, or take over a running one whose worker stopped renewing its lease. */\n    public boolean claim(long id, String worker, Instant now, Duration lease) {\n        Job seen = jobs.get(id);\n        if (seen == null || seen.status() == Status.DONE) return false;\n        boolean free = seen.status() == Status.PENDING\n                || (seen.status() == Status.RUNNING && !now.isBefore(seen.leaseUntil()));\n        if (!free) return false;\n        // compare-and-swap: fails if another worker changed the job since we read it\n        return jobs.replace(id, seen, new Job(id, Status.RUNNING, worker, now.plus(lease)));\n    }\n\n    /** Only the current owner may finish the job. */\n    public boolean complete(long id, String worker) {\n        Job seen = jobs.get(id);\n        if (seen == null || !worker.equals(seen.owner())) return false;\n        return jobs.replace(id, seen, new Job(id, Status.DONE, worker, seen.leaseUntil()));\n    }\n}"
        }
      ],
      "pros": [
        "A dead worker's job becomes claimable again when its lease expires.",
        "Ownership is checked at completion."
      ],
      "cons": [
        "A slow worker can lose its lease while still running, causing a double run.",
        "Keep jobs idempotent, or use fencing tokens."
      ],
      "pickWhen": "You need crash recovery and the store supports compare-and-set."
    },
    {
      "name": "Queue with a visibility timeout",
      "concept": "Visibility timeout (SQS-style)",
      "conceptIds": [
        "reservation-with-ttl",
        "idempotency"
      ],
      "how": "Receiving a message hides it from other workers for a timeout. Finishing deletes it. If the worker crashes, the message reappears after the timeout and someone else takes it.",
      "code": [
        {
          "file": "VisibilityQueue.java",
          "body": "import java.time.Duration;\nimport java.time.Instant;\nimport java.util.Optional;\nimport java.util.concurrent.ConcurrentHashMap;\n\npublic class VisibilityQueue<T> {\n    public record Message<T>(String id, T body, Instant visibleAt) {}\n\n    private final ConcurrentHashMap<String, Message<T>> messages = new ConcurrentHashMap<>();\n\n    public void send(String id, T body, Instant now) {\n        messages.put(id, new Message<>(id, body, now));\n    }\n\n    /** Hands the message to one receiver and hides it from everyone else until the timeout. */\n    public Optional<Message<T>> receive(Instant now, Duration visibilityTimeout) {\n        for (Message<T> m : messages.values()) {\n            if (m.visibleAt().isAfter(now)) continue;               // someone is working on it\n            Message<T> hidden = new Message<>(m.id(), m.body(), now.plus(visibilityTimeout));\n            if (messages.replace(m.id(), m, hidden)) return Optional.of(hidden);   // we won it\n        }\n        return Optional.empty();\n    }\n\n    /** Worker finished: remove for good. If it crashes instead, the message reappears after the timeout. */\n    public void delete(String id) {\n        messages.remove(id);\n    }\n}"
        }
      ],
      "pros": [
        "Built into SQS and most managed queues.",
        "Crash recovery is automatic."
      ],
      "cons": [
        "Delivery is at-least-once, so the handler must be idempotent.",
        "Timeout tuning: too short causes duplicates, too long delays retries."
      ],
      "pickWhen": "You can use a managed queue."
    },
    {
      "name": "Distributed lock per job",
      "concept": "Distributed lock",
      "conceptIds": [
        "distributed-locks"
      ],
      "how": "Before running, take `SET job-lock:<id> <token> NX PX <ttl>` in Redis. If you got it, run the job; afterwards delete the lock only if the token is still yours.",
      "code": [
        {
          "file": "JobLockRunner.java",
          "body": "import java.time.Duration;\nimport java.util.UUID;\n\npublic class JobLockRunner {\n    public interface Redis {\n        boolean setIfAbsent(String key, String value, Duration ttl);    // SET key value NX PX ttl\n        boolean deleteIfEquals(String key, String value);               // Lua: delete only if still ours\n    }\n\n    private final Redis redis;\n\n    public JobLockRunner(Redis redis) {\n        this.redis = redis;\n    }\n\n    public boolean runOnce(long jobId, Runnable work) {\n        String key = \"job-lock:\" + jobId;\n        String token = UUID.randomUUID().toString();                    // proves the lock is ours\n        if (!redis.setIfAbsent(key, token, Duration.ofMinutes(2))) {\n            return false;                                               // another worker has it\n        }\n        try {\n            work.run();\n            return true;\n        } finally {\n            redis.deleteIfEquals(key, token);                           // never delete someone else's lock\n        }\n    }\n}"
        }
      ],
      "pros": [
        "Works with any job source.",
        "Does not require changing your queue."
      ],
      "cons": [
        "If the lock expires while a slow holder is still working, two workers overlap.",
        "Redis becomes a dependency, with extra lock traffic."
      ],
      "pickWhen": "Jobs come from many sources and you cannot change the queue."
    }
  ],
  "recommendation": "Prefer a queue's visibility timeout, or SKIP LOCKED if the jobs are already in your database, so that claiming is a single atomic step with automatic recovery.\n\nThen make the job handler idempotent (key the side effect by job id), because lease expiry means a very slow worker can still overlap with its replacement.",
  "say": "I want claiming to be one atomic step with an expiry. If jobs are in Postgres I use SELECT FOR UPDATE SKIP LOCKED with a lease column; if I have a queue I rely on its visibility timeout. Both recover automatically from a crashed worker. Because a slow worker can lose its lease and still finish, I make the handler idempotent, keyed by job id. So the guarantee is at-least-once delivery with exactly-once effects.",
  "appearsIn": [
    "task-management-system",
    "notification-system",
    "pub-sub-system",
    "ride-sharing"
  ],
  "related": [
    "idempotency",
    "distributed-locks",
    "message-delivery-guarantees",
    "duplicate-charge-on-retry",
    "expiry-at-scale"
  ]
}
);
