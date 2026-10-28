window.QUESTIONS = window.QUESTIONS || [];
window.QUESTIONS.push({
  "id": "limited-stock-cart",
  "name": "Design a Limited-Stock Cart (Flash Sale)",
  "difficulty": "hard",
  "understanding": "A product has exactly one unit left and thousands of shoppers add it to their carts at the same moment. Exactly one of them may buy it, nobody may be charged for something they do not get, and the losers should be treated fairly. The whole problem is the gap between *checking* the stock and *taking* it: any design that leaves that gap open will oversell.",
  "dialogue": [
    {
      "who": "int",
      "text": "A PlayStation 5 has one unit left and 500 people have it in their cart. What happens when they all click Buy?"
    },
    {
      "who": "you",
      "text": "Only one should succeed. First question: does adding to the cart reserve the item, or only checkout?"
    },
    {
      "who": "int",
      "text": "Good question. What would you pick?"
    },
    {
      "who": "you",
      "text": "Checkout. If add-to-cart reserved stock, abandoned carts and bots could block real sales. So a cart is a wish list and the hold starts when checkout starts."
    },
    {
      "who": "int",
      "text": "And once someone holds the last unit but is still typing their card number?"
    },
    {
      "who": "you",
      "text": "The hold has a time limit, say two minutes. Pay in time and it is sold. Fail or time out and the unit goes back."
    },
    {
      "who": "int",
      "text": "What about the 499 people who lost?"
    },
    {
      "who": "you",
      "text": "They join a FIFO waitlist. If the winner's payment fails, the head of the queue gets the unit. If it sells, everyone is told it is sold out."
    },
    {
      "who": "int",
      "text": "Users double-click and apps retry on timeouts. Prices also change while items sit in carts."
    },
    {
      "who": "you",
      "text": "Checkout takes an idempotency key so a retry returns the same hold and never takes a second unit. We also revalidate the price and quantity at checkout and reject the stale ones."
    },
    {
      "who": "int",
      "text": "Single server or many?"
    },
    {
      "who": "you",
      "text": "I will design it single-process first with a lock per product, then show how the atomic step moves into the database or Redis when we scale out."
    }
  ],
  "requirements": [
    {
      "group": "Core",
      "items": [
        "Adding to a cart never reserves stock; the cart remembers the price the user saw.",
        "Starting checkout takes a time-boxed hold on the units, or puts the buyer on a waitlist.",
        "Paying confirms the sale; a failed payment or an expired hold returns the units.",
        "Stock can never be oversold: units available + held + sold always equals the total."
      ]
    },
    {
      "group": "Concurrency",
      "items": [
        "N simultaneous buyers for the last unit produce exactly one hold.",
        "Confirm, cancel and expire race safely: a hold leaves HELD exactly once.",
        "Duplicate checkout and payment requests are idempotent (no double hold, no double charge)."
      ]
    },
    {
      "group": "Extensibility",
      "items": [
        "Waitlisted users are served in FIFO order, and new arrivals cannot jump the queue.",
        "Revalidate price and quantity at checkout.",
        "The reservation store can move from in-memory to a database or Redis without changing the checkout flow."
      ]
    }
  ],
  "entities": [
    {
      "name": "Product",
      "text": "what is sold and its current price."
    },
    {
      "name": "ProductStock",
      "text": "the ledger for one product: `available`, `held`, `sold`, plus its waitlist. All changes happen under one lock per product."
    },
    {
      "name": "CartService / CartLine",
      "text": "the wish list. Remembers the price seen, reserves nothing."
    },
    {
      "name": "Hold",
      "text": "a time-boxed claim on units with a status (`HELD`, `CONFIRMED`, `RELEASED`, `EXPIRED`) that changes once, by compare-and-set."
    },
    {
      "name": "CheckoutService",
      "text": "orchestrates revalidation, hold, payment, release and the expiry sweep."
    },
    {
      "name": "PaymentGateway",
      "text": "charges and refunds, idempotent on a key."
    },
    {
      "name": "WaitEntry",
      "text": "a queued buyer (user and quantity)."
    }
  ],
  "design": [
    {
      "heading": "Requirement 1: a cart is not a reservation",
      "text": "The cart only stores what the user saw. Stock is untouched, so a thousand carts can hold the same last unit without harming anyone. The advisory `looksInStock` flag is allowed to be wrong; the authoritative check is the next step.",
      "code": [
        {
          "file": "CartService.java",
          "body": "public final class CartService {\n    public record CartLine(String productId, int qty, long priceSeenCents) {}\n\n    public CartLine add(String userId, String productId, int qty);   // records the price, reserves nothing\n    public boolean looksInStock(String productId);                   // advisory, may be stale\n    public List<CartLine> cart(String userId);\n}\n"
        }
      ],
      "note": "Reserving at add-to-cart is a product decision, not a technical one. Ticketing sites do it with a very short TTL. Retail usually does not, because carts are abandoned far more than they are bought."
    },
    {
      "heading": "Requirement 2: the ledger that cannot oversell",
      "text": "`ProductStock` owns the three counters and a waitlist, guarded by one lock. The only way to claim units is `acquireOrWait`, which checks and takes in one critical section. The invariant `available + held + sold == total` is checked in the tests after every race.",
      "code": [
        {
          "file": "ProductStock.java (contract)",
          "body": "public final class ProductStock {\n    public record WaitEntry(String userId, int qty) {}\n\n    public boolean acquireOrWait(String userId, int qty);   // true: units held. false: queued\n    public List<WaitEntry> commit(int qty);                // held -> sold; returns waiters to tell 'sold out'\n    public List<WaitEntry> returnUnits(int qty);           // held -> available; returns waiters now served\n\n    public boolean invariantHolds();                       // available + held + sold == total\n}\n"
        }
      ],
      "note": "Why not `synchronized` on the whole inventory? Because buyers of different products would queue behind each other. Lock **per product**: contention only exists where the real conflict is."
    },
    {
      "heading": "Requirement 3: holds with an expiry",
      "text": "A `Hold` carries the price locked in at hold time, an absolute expiry, and an atomic status. Its single operation is `transition(from, to)`, a compare-and-set. If a payment confirmation and the expiry sweeper reach the same hold together, exactly one of them wins and the other sees `false`.",
      "code": [
        {
          "file": "Hold.java (contract)",
          "body": "public final class Hold {\n    public enum Status { HELD, CONFIRMED, RELEASED, EXPIRED }\n\n    public boolean transition(Status from, Status to);   // compare-and-set: exactly one caller wins\n    public Status status();\n    public long expiresAtMillis();\n    public long amountCents();\n}\n"
        }
      ]
    },
    {
      "heading": "Requirement 4: pay, fail or expire",
      "text": "`CheckoutService` is the only class that moves a hold out of `HELD`. Success commits held to sold. A declined card or a cancel releases it. A timeout expires it. Whichever happens, units go back through one method, so the waitlist handoff cannot be skipped.",
      "code": [
        {
          "file": "CheckoutService.java (contract)",
          "body": "public final class CheckoutService {\n    public CheckoutResult startCheckout(String userId, String productId, int qty,\n                                        long priceSeenCents, String idempotencyKey);\n    public PaymentOutcome pay(String holdId);     // PAID | PAYMENT_FAILED | HOLD_EXPIRED | UNKNOWN_HOLD\n    public boolean cancel(String holdId);         // user abandons checkout\n    public int sweepExpired();                    // run on a schedule\n}\n"
        }
      ],
      "note": "A payment can finish *after* the hold expired. The CAS to `CONFIRMED` then fails and we **refund**. See the full solution below."
    },
    {
      "heading": "Requirement 5: a fair waitlist",
      "text": "A failed `tryLock`-style retry loop is not fair: whoever happens to run next wins. Instead the loser is queued inside `acquireOrWait`, in the same critical section that found no stock, so a release cannot slip in between 'no stock' and 'joined the queue'. `returnUnits` serves the head of the queue before the unit ever becomes `available`.",
      "code": [
        {
          "file": "WaitlistFlow.txt",
          "body": "alice holds the last unit\nbob   -> acquireOrWait -> queued [bob]\ncarol -> acquireOrWait -> queued [bob, carol]\n\nalice's card is declined -> release -> returnUnits(1):\n    available 0 -> 1, head of queue is bob, so available 1 -> 0, held 0 -> 1\n    offer(bob)                              carol still waiting\n\nzed arrives now -> queue not empty -> queued [carol, zed]   (cannot barge)\n"
        }
      ]
    },
    {
      "heading": "Requirement 6: idempotency",
      "text": "Clients send an idempotency key with checkout. The service remembers the first result per key, so a retry returns the same hold instead of taking a second unit. Payments reuse a key derived from the hold id, so the gateway cannot charge a hold twice even under 10 simultaneous clicks.",
      "code": [
        {
          "file": "Idempotency.java",
          "body": "// checkout: the body runs once per key\nbyIdempotencyKey.computeIfAbsent(idempotencyKey, k -> begin(userId, productId, qty, priceSeenCents));\n\n// payment: the gateway stores the first result per key\ncharges.computeIfAbsent(\"pay-\" + hold.id(), k -> approve(userId, amountCents));\n"
        }
      ]
    },
    {
      "heading": "Requirement 7: revalidate at checkout",
      "text": "Between add-to-cart and Buy the price may change and the quantity may be impossible. We compare the price the user saw with the current one, return `PRICE_CHANGED` with the new price and take no stock. We also reject any quantity above the product's total, because such a buyer would sit at the head of the waitlist forever.",
      "code": [
        {
          "file": "CheckoutResult.java",
          "body": "public record CheckoutResult(Status status, Hold hold, String message) {\n    public enum Status { HELD, WAITLISTED, PRICE_CHANGED, REJECTED }\n}\n"
        }
      ]
    }
  ],
  "deepDive": [
    {
      "title": "Soft vs hard reservation: when should the unit be held?",
      "text": "There are three places to take the unit, and each has a failure mode.\n\n**At add-to-cart.** Nothing is ever oversold, but abandoned carts lock stock and bots can hoard it. Only viable with a very short TTL (seat maps on ticketing sites).\n\n**At checkout start (our choice).** Only people who are actually paying hold stock, and the hold is short. The cost is that a buyer can reach checkout and learn they lost the race, so the UI needs a clear waitlist or sold-out state.\n\n**At payment only.** Simplest, but you can charge a card and then discover there is no stock. You would then have to refund, which is a bad experience and a support cost. Avoid it for scarce items.\n\nA good answer names the trade-off and ties it to the product: scarce and hyped means hold early and expire fast; plentiful means do not hold at all and just decrement atomically at payment."
    },
    {
      "title": "Per-product lock vs CAS vs a database conditional update",
      "text": "All three make check-and-take atomic. Pick by what else you need.\n\n**Per-product lock** (our solution): easy to reason about, and the waitlist handoff happens atomically with the counters. Best when you need several fields to change together.\n\n**CAS on one counter**: lock-free and very fast for a plain counter, but it cannot also queue a waiter atomically, so fair FIFO needs extra machinery.\n\n**Conditional UPDATE in the database**: the database is the lock. `UPDATE ... WHERE available >= 1` is atomic, and the rows-affected count says who won. This is what survives multiple servers.\n\nNote what is *not* on the list: `SELECT` then `UPDATE` in two statements without a lock. That is the bug again, one layer down.",
      "code": [
        {
          "file": "CasStock.java",
          "body": "import java.util.concurrent.atomic.AtomicInteger;\n\n/** Lock-free alternative: one atomic counter, compare-and-set in a loop. */\npublic final class CasStock {\n    private final AtomicInteger available;\n\n    public CasStock(int units) { this.available = new AtomicInteger(units); }\n\n    public boolean tryTake(int qty) {\n        while (true) {\n            int current = available.get();\n            if (current < qty) return false;                        // not enough: fail without changing anything\n            if (available.compareAndSet(current, current - qty)) return true;   // nobody changed it since we read\n        }\n    }\n\n    public void give(int qty) { available.addAndGet(qty); }\n\n    public int available() { return available.get(); }\n}\n"
        },
        {
          "file": "conditional-update.sql",
          "body": "-- one statement: check and take are the same operation\nUPDATE product_stock\n   SET available = available - 1,\n       held      = held + 1\n WHERE product_id = :id\n   AND available >= 1;\n\n-- rows affected = 1  -> you got the unit\n-- rows affected = 0  -> sold out / held by someone else, queue the buyer\n"
        }
      ]
    },
    {
      "title": "Scaling beyond one JVM",
      "text": "An in-process lock only protects one server. With ten app servers the atomic step has to live in shared state.\n\n- **Database**: the conditional update above, plus a `holds` table with `expires_at`. A scheduled job expires overdue holds in one statement and returns their units.\n- **Redis**: one Lua script runs atomically on the server, so check-and-decrement cannot interleave. The hold is a key with a TTL, so it expires by itself.\n- **A hot SKU is a hot row.** Thousands of writers on one row serialise anyway. For true flash sales put a queue in front (a virtual waiting room) and let only as many shoppers into checkout as there are units.\n\nA plain distributed lock around read-then-write also works, but it is slower and needs fencing tokens so a paused client with an expired lock cannot write late.",
      "code": [
        {
          "file": "reserve.lua",
          "body": "-- KEYS[1] = stock:{productId}, ARGV[1] = qty, ARGV[2] = holdId, ARGV[3] = ttlSeconds\nlocal available = tonumber(redis.call('GET', KEYS[1]))\nif available == nil or available < tonumber(ARGV[1]) then\n  return 0                                   -- sold out\nend\nredis.call('DECRBY', KEYS[1], ARGV[1])\nredis.call('SET', 'hold:' .. ARGV[2], ARGV[1], 'EX', ARGV[3])   -- expires on its own\nreturn 1\n"
        }
      ]
    }
  ],
  "mistakes": [
    "`if (stock > 0) stock--` with no lock or atomic operation. Under load it oversells, however unlikely it looks in testing.",
    "Locking the whole inventory (or the whole checkout) instead of one product, so unrelated purchases wait on each other.",
    "Letting a hold live forever. One abandoned checkout then blocks the last unit permanently.",
    "Charging the card before confirming the hold is still valid, or forgetting to refund when the hold expired mid-payment.",
    "Returning freed units to `available` before serving the waitlist, which lets new arrivals barge ahead.",
    "Skipping idempotency: a double-click or a retry takes two units or charges twice.",
    "Letting an impossible request (qty above total stock) into the waitlist, where it blocks everyone behind it.",
    "Forcing a pattern in just to impress the interviewer. The correct answer here is a lock plus a state machine, not a pile of design patterns."
  ],
  "followups": [
    "A cart has several products. How do you hold all of them or none, and avoid deadlock? (Acquire in sorted product-id order and release everything on the first failure.)",
    "Limit each customer to one unit of the sale item. Where does that check live, and how is it made race-free?",
    "How do you stop bots from joining the queue (rate limits, a waiting room, per-account holds)?",
    "How would you reconcile `available + held + sold` against the warehouse count?",
    "The sweeper runs every 5 seconds. Can a unit be unavailable for up to 5 seconds past expiry, and is that acceptable?",
    "Hold TTL: how long, and should it extend while the user is on the payment page?"
  ],
  "patterns": [
    "state",
    "observer"
  ]
});
