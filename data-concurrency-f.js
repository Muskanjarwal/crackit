// Concurrency scenarios for six interview questions. Every Java snippet here was compiled and
// raced with real threads (20 rounds) before being embedded.
window.CONCURRENCY = window.CONCURRENCY || [];
window.CONCURRENCY.push(...([
  {
    "id": "online-auction-system",
    "scenarios": [
      {
        "title": "Two bids land in the same millisecond",
        "race": "The highest bid is $100. Alice reads 100 and bids 110. Bob also reads 100 and bids 105. Both pass the check 'is my bid higher than 100?', and both write. If Bob's write lands last, the leader becomes $105 and Alice's $110 is silently lost.",
        "why": "This is check-then-act on shared state. Validating the bid and storing it are two separate steps, so another bid can slip in between them and the last writer wins instead of the highest bidder.",
        "fix": "Keep the leading bid in one immutable `Bid` object held in an `AtomicReference`, and update it with a compare-and-set loop. The CAS succeeds only if nobody changed the leader since you read it. If it fails, re-read and re-validate against the new leader: Bob's 105 is now below 110 plus the minimum increment, so it is rejected cleanly.\n\nNo lock is held, so one slow bidder never blocks the others, and the sequence number gives a total order of accepted bids for the audit log.",
        "code": [
          {
            "file": "HighestBidTracker.java",
            "body": "import java.util.concurrent.atomic.AtomicReference;\n\npublic class HighestBidTracker {\n    public record Bid(String bidderId, long amountCents, long sequence) {}\n\n    private final AtomicReference<Bid> highest;\n    private final long minIncrementCents;\n\n    public HighestBidTracker(long startingPriceCents, long minIncrementCents) {\n        this.minIncrementCents = minIncrementCents;\n        // the first bid must be >= the starting price\n        this.highest = new AtomicReference<>(new Bid(null, startingPriceCents - minIncrementCents, 0));\n    }\n\n    /** Returns true only if this bid became the new highest bid. */\n    public boolean placeBid(String bidderId, long amountCents) {\n        while (true) {\n            Bid current = highest.get();\n            if (amountCents < current.amountCents() + minIncrementCents) {\n                return false;                       // beaten by a bid that landed first\n            }\n            Bid next = new Bid(bidderId, amountCents, current.sequence() + 1);\n            if (highest.compareAndSet(current, next)) {\n                return true;\n            }\n            // lost the race: loop, re-read the new highest bid and re-validate against it\n        }\n    }\n\n    public Bid highest() {\n        return highest.get();\n    }\n}"
          }
        ],
        "alternatives": [
          "A `ReentrantLock` or `synchronized` block per auction: simpler, and fine when bid volume per auction is modest.",
          "In a database: `UPDATE auctions SET leading_bid = ?, leader_id = ? WHERE id = ? AND leading_bid < ?`, then check the rows affected.",
          "Optimistic versioning: store a version on the auction row and retry on a version mismatch."
        ],
        "say": "Placing a bid is a read, validate, write, so two bidders can validate against the same leader. I keep the leading bid as one immutable object and swap it with compare-and-set, retrying on failure. The loser re-validates against the new leader and gets a clean rejection."
      },
      {
        "title": "A bid arrives exactly as the auction closes",
        "race": "The auction ends at 12:00:00. The close job reads the leader (Alice, $200) and starts building the result. At 11:59:59.999 Bob's $250 bid passed its time check and is being written. Bob is shown as the highest bidder, but the result that gets charged says Alice won at $200.",
        "why": "'Is the auction still open?', 'record the bid' and 'read the winner' are separate steps on shared state, so a close can interleave with a bid. The system ends up with two different answers for who the final leader is.",
        "fix": "Make accepting a bid and closing the auction mutually exclusive with one lock per auction. Inside the lock a bid checks the status and the clock and then records itself; `close()` flips the status and snapshots the winner. Every bid is then either entirely before the close, and included in the result, or entirely after it, and rejected.\n\nThe clock is injected so the boundary can be tested deterministically. Use a lock per auction, never a global one, so a hot auction does not slow down the others.",
        "code": [
          {
            "file": "TimedAuction.java",
            "body": "import java.time.Clock;\nimport java.time.Instant;\nimport java.util.concurrent.locks.ReentrantLock;\n\npublic class TimedAuction {\n    public enum Status { OPEN, CLOSED }\n    public record Result(String winnerId, long amountCents) {}\n\n    private final ReentrantLock lock = new ReentrantLock();\n    private final Clock clock;\n    private final Instant endsAt;\n    private Status status = Status.OPEN;   // guarded by lock\n    private String leaderId;               // guarded by lock\n    private long leadingCents;             // guarded by lock\n\n    public TimedAuction(Clock clock, Instant endsAt, long startingCents) {\n        this.clock = clock;\n        this.endsAt = endsAt;\n        this.leadingCents = startingCents - 1;   // first bid must be >= starting price\n    }\n\n    public boolean placeBid(String bidderId, long amountCents) {\n        lock.lock();\n        try {\n            // \"is the auction still open\" and \"record the bid\" are one atomic step\n            if (status != Status.OPEN || !clock.instant().isBefore(endsAt)) return false;\n            if (amountCents <= leadingCents) return false;\n            leaderId = bidderId;\n            leadingCents = amountCents;\n            return true;\n        } finally {\n            lock.unlock();\n        }\n    }\n\n    /** Safe to call more than once; every call returns the same result. */\n    public Result close() {\n        lock.lock();\n        try {\n            status = Status.CLOSED;\n            return new Result(leaderId, leadingCents);\n        } finally {\n            lock.unlock();\n        }\n    }\n}"
          }
        ],
        "alternatives": [
          "A single-threaded actor or queue per auction: all bids and the close are processed in order by one thread.",
          "Database: keep status, leader and amount in one row and update with `WHERE status = 'OPEN'`.",
          "Anti-sniping: extend the end time when a bid lands in the final minutes, under the same lock."
        ],
        "say": "I treat bid and close as two operations on one state machine and serialise them with a per-auction lock. Whatever close returns is exactly the set of bids accepted before it; anything later is rejected."
      },
      {
        "title": "The close job runs on two servers",
        "race": "Two scheduler nodes wake up at the end time. Node A reads status OPEN and starts charging the winner. Node B also reads OPEN and charges the winner a second time.",
        "why": "Schedulers are usually at-least-once, and charging is not idempotent. The status check and the status change are separate steps, so both nodes believe they are first.",
        "fix": "Claim the settlement with a compare-and-set on the phase, `OPEN -> SETTLING`. Only one caller wins the transition and the rest return immediately. After charging, move to `SETTLED`. If charging fails, move back to `OPEN` so a retry can run, otherwise one failure would leave the auction stuck forever.\n\nAcross servers the same idea is a conditional update: `UPDATE auctions SET status = 'SETTLING' WHERE id = ? AND status = 'OPEN'`, proceeding only if one row changed. Pair it with an idempotency key on the payment call as a second line of defence.",
        "code": [
          {
            "file": "AuctionSettlement.java",
            "body": "import java.util.concurrent.atomic.AtomicReference;\n\npublic class AuctionSettlement {\n    public enum Phase { OPEN, SETTLING, SETTLED }\n\n    private final AtomicReference<Phase> phase = new AtomicReference<>(Phase.OPEN);\n\n    /** Returns true only for the single caller that actually settled the auction. */\n    public boolean settle(Runnable chargeWinnerAndNotify) {\n        // exactly one caller can move OPEN -> SETTLING; everyone else backs off\n        if (!phase.compareAndSet(Phase.OPEN, Phase.SETTLING)) {\n            return false;\n        }\n        try {\n            chargeWinnerAndNotify.run();\n            phase.set(Phase.SETTLED);\n            return true;\n        } catch (RuntimeException e) {\n            phase.set(Phase.OPEN);      // charge failed: allow a retry to run it again\n            throw e;\n        }\n    }\n\n    public Phase phase() {\n        return phase.get();\n    }\n}"
          }
        ],
        "alternatives": [
          "A distributed lock (Redis `SET NX PX`) around the job, with a short expiry.",
          "A queue with one consumer per auction id, so only one worker ever handles it.",
          "Make the payment itself idempotent so a double call is harmless."
        ],
        "say": "The close job must be safe to run twice. I claim the auction with an atomic OPEN to SETTLING transition, so only one node charges the winner, and I roll the state back if the charge fails so it can be retried."
      }
    ]
  },
  {
    "id": "online-food-delivery",
    "scenarios": [
      {
        "title": "Two orders assigned to the same delivery partner",
        "race": "Partner Ravi is the nearest free partner for two different orders. Order 1 sees Ravi as AVAILABLE and assigns him. A moment later order 2 also saw him as AVAILABLE and assigns him too. Ravi now has two pickups at once.",
        "why": "Finding a free partner and marking him busy are separate steps. Two matching threads can both pass the availability check before either one writes the new status.",
        "fix": "Make 'claim the partner' a single atomic transition: `AVAILABLE -> ASSIGNED` using `compareAndSet`. The matcher walks the candidates nearest-first and takes the first partner whose CAS succeeds. A failed CAS just means another order won that partner, so it moves on to the next one.\n\nIf no partner can be claimed the order stays queued and is retried. When an order is cancelled or finished, release the partner with the reverse transition.",
        "code": [
          {
            "file": "DeliveryPartnerPool.java",
            "body": "import java.util.List;\nimport java.util.Map;\nimport java.util.Optional;\nimport java.util.concurrent.ConcurrentHashMap;\nimport java.util.concurrent.atomic.AtomicReference;\n\npublic class DeliveryPartnerPool {\n    public enum Status { AVAILABLE, ASSIGNED, OFFLINE }\n\n    private final Map<String, AtomicReference<Status>> partners = new ConcurrentHashMap<>();\n\n    public void register(String partnerId) {\n        partners.put(partnerId, new AtomicReference<>(Status.AVAILABLE));\n    }\n\n    /** Try the nearest partner first; the CAS guarantees one order per partner. */\n    public Optional<String> claimFirstAvailable(List<String> nearestFirst) {\n        for (String partnerId : nearestFirst) {\n            AtomicReference<Status> status = partners.get(partnerId);\n            if (status != null && status.compareAndSet(Status.AVAILABLE, Status.ASSIGNED)) {\n                return Optional.of(partnerId);\n            }\n            // someone else just claimed this partner: fall through to the next one\n        }\n        return Optional.empty();\n    }\n\n    public void release(String partnerId) {\n        partners.get(partnerId).compareAndSet(Status.ASSIGNED, Status.AVAILABLE);\n    }\n}"
          }
        ],
        "alternatives": [
          "A per-partner lock; fine at small scale but slower than a CAS.",
          "Database: `UPDATE partners SET status = 'ASSIGNED' WHERE id = ? AND status = 'AVAILABLE'` and check the rows affected.",
          "Offer-based dispatch: send the order to one partner at a time with a timeout, as in `ride-sharing`."
        ],
        "say": "Assigning a partner must be one atomic step, not 'check then set'. I model partner status as a state machine and claim with compare-and-set from AVAILABLE to ASSIGNED, so two orders can never take the same partner."
      },
      {
        "title": "The last portion of a dish is ordered twice",
        "race": "The kitchen has 1 portion of biryani left. Two customers add it and check out at the same moment. Both read quantity = 1, both pass the check, and both decrement. The restaurant has sold 2 portions and has 1 to cook.",
        "why": "Read-modify-write on a shared counter: `if (left >= 1) left = left - 1` is not atomic, so both threads act on the same stale value.",
        "fix": "Decrement conditionally and atomically. A compare-and-set loop reads the current count, refuses if there is not enough, and otherwise swaps in the lower count only if nothing changed in between. The count can never go below zero and exactly one customer gets the last portion.\n\nIf payment fails or the order is cancelled, return the portions with `giveBack` so the dish becomes orderable again.",
        "code": [
          {
            "file": "DishInventory.java",
            "body": "import java.util.Map;\nimport java.util.concurrent.ConcurrentHashMap;\nimport java.util.concurrent.atomic.AtomicInteger;\n\npublic class DishInventory {\n    private final Map<String, AtomicInteger> portions = new ConcurrentHashMap<>();\n\n    public void set(String dishId, int qty) {\n        portions.put(dishId, new AtomicInteger(qty));\n    }\n\n    /** Take qty portions only if enough remain. Never goes below zero. */\n    public boolean tryTake(String dishId, int qty) {\n        AtomicInteger left = portions.get(dishId);\n        if (left == null) return false;\n        while (true) {\n            int current = left.get();\n            if (current < qty) return false;\n            if (left.compareAndSet(current, current - qty)) return true;\n        }\n    }\n\n    /** Payment failed or the order was cancelled: return the portions. */\n    public void giveBack(String dishId, int qty) {\n        portions.get(dishId).addAndGet(qty);\n    }\n\n    public int left(String dishId) {\n        return portions.get(dishId).get();\n    }\n}"
          }
        ],
        "alternatives": [
          "Decrement first and roll back if the result is negative (`addAndGet(-1) < 0`); simpler, but the counter is briefly wrong.",
          "A lock per dish when an order touches several dishes and must be all-or-nothing.",
          "Database: `UPDATE dishes SET qty = qty - 1 WHERE id = ? AND qty >= 1`."
        ],
        "say": "For the last portion, the check and the decrement have to be one atomic step. I use a conditional compare-and-set so the count never drops below zero, and I give the portion back if payment fails."
      }
    ]
  },
  {
    "id": "ride-sharing",
    "scenarios": [
      {
        "title": "One driver gets offers from two riders",
        "race": "Driver Asha is the closest driver to rider A and to rider B. Matching for A offers her the ride; matching for B reads her as AVAILABLE a moment earlier and offers her another ride. Her phone shows two offers, and whichever she taps first, the other rider waits for a driver who never comes.",
        "why": "The driver's availability is read and then updated in separate steps, so two matching threads both see her as free.",
        "fix": "Give each driver a small state machine held in an `AtomicReference`: `AVAILABLE -> OFFERED(ride) -> ON_TRIP`. Making an offer is a compare-and-set from `AVAILABLE`, so only one rider can hold her at a time. Accepting checks that the offer is for that ride; an offer that times out or is declined moves her back to `AVAILABLE` and the matcher tries the next driver.\n\nThe slot is an immutable record holding both the state and the ride id, so state and ride can never be out of sync.",
        "code": [
          {
            "file": "DriverMatcher.java",
            "body": "import java.util.Map;\nimport java.util.concurrent.ConcurrentHashMap;\nimport java.util.concurrent.atomic.AtomicReference;\n\npublic class DriverMatcher {\n    public enum State { AVAILABLE, OFFERED, ON_TRIP }\n\n    private record Slot(State state, String rideId) {}\n\n    private static final Slot FREE = new Slot(State.AVAILABLE, null);\n    private final Map<String, AtomicReference<Slot>> drivers = new ConcurrentHashMap<>();\n\n    public void register(String driverId) {\n        drivers.put(driverId, new AtomicReference<>(FREE));\n    }\n\n    /** A driver can hold at most one open offer at a time. */\n    public boolean offer(String driverId, String rideId) {\n        AtomicReference<Slot> slot = drivers.get(driverId);\n        Slot current = slot.get();\n        return current.state() == State.AVAILABLE\n                && slot.compareAndSet(current, new Slot(State.OFFERED, rideId));\n    }\n\n    public boolean accept(String driverId, String rideId) {\n        AtomicReference<Slot> slot = drivers.get(driverId);\n        Slot current = slot.get();\n        return current.state() == State.OFFERED && rideId.equals(current.rideId())\n                && slot.compareAndSet(current, new Slot(State.ON_TRIP, rideId));\n    }\n\n    /** Offer timed out or was declined: free the driver for the next rider. */\n    public boolean expireOffer(String driverId, String rideId) {\n        AtomicReference<Slot> slot = drivers.get(driverId);\n        Slot current = slot.get();\n        return current.state() == State.OFFERED && rideId.equals(current.rideId())\n                && slot.compareAndSet(current, FREE);\n    }\n}"
          }
        ],
        "alternatives": [
          "A lock per driver around read and update.",
          "Redis `SET driver:{id}:offer {ride} NX PX 15000`, which doubles as the offer timeout.",
          "A single dispatcher thread per city or geo-cell that makes all matching decisions sequentially."
        ],
        "say": "A driver can only hold one open offer, so making an offer is an atomic AVAILABLE to OFFERED transition. If it fails I move on to the next driver, and an expired or declined offer puts her back to AVAILABLE."
      },
      {
        "title": "Two drivers accept the same ride, or the rider cancels as one accepts",
        "race": "A ride is offered to two drivers. Both tap Accept within 100 ms. Both requests read the ride as REQUESTED and both mark it MATCHED, so the rider is told two drivers are coming. In another case the rider taps Cancel at the same time as a driver accepts, and the driver drives to a cancelled pickup.",
        "why": "Accept and cancel are competing transitions out of the same state, and each does a separate read then write.",
        "fix": "Treat the ride request as a state machine whose only exits from `REQUESTED` are `MATCHED` and `CANCELLED`, and make each exit a compare-and-set from the `REQUESTED` value. Exactly one transition can succeed. The losing driver gets a clear 'ride already taken' response and the losing cancel gets 'already matched'.\n\nHold the state and the driver id in one immutable `Outcome`, so no other thread can see MATCHED without also seeing which driver matched.",
        "code": [
          {
            "file": "RideRequest.java",
            "body": "import java.util.concurrent.atomic.AtomicReference;\n\npublic class RideRequest {\n    public enum State { REQUESTED, MATCHED, CANCELLED }\n    public record Outcome(State state, String driverId) {}\n\n    private final AtomicReference<Outcome> outcome =\n            new AtomicReference<>(new Outcome(State.REQUESTED, null));\n\n    /** First driver to accept wins; everyone else (and a late cancel) gets false. */\n    public boolean accept(String driverId) {\n        Outcome current = outcome.get();\n        return current.state() == State.REQUESTED\n                && outcome.compareAndSet(current, new Outcome(State.MATCHED, driverId));\n    }\n\n    /** The rider cancels. Only possible while still waiting for a match. */\n    public boolean cancel() {\n        Outcome current = outcome.get();\n        return current.state() == State.REQUESTED\n                && outcome.compareAndSet(current, new Outcome(State.CANCELLED, null));\n    }\n\n    public Outcome outcome() {\n        return outcome.get();\n    }\n}"
          }
        ],
        "alternatives": [
          "A lock on the ride row (`SELECT ... FOR UPDATE`) before changing status.",
          "Conditional update: `UPDATE rides SET status = 'MATCHED', driver_id = ? WHERE id = ? AND status = 'REQUESTED'`.",
          "Send the ride to one driver at a time so a double accept cannot happen in the first place."
        ],
        "say": "Accept and cancel both leave the REQUESTED state, so I make each one a compare-and-set from REQUESTED. Exactly one wins, and the losers get a deterministic answer rather than a half-applied state."
      }
    ]
  },
  {
    "id": "online-bookstore",
    "scenarios": [
      {
        "title": "Last copy of a book in two carts",
        "race": "One copy of a book is left and two customers press Pay at the same time. Both requests read on_hand = 1, both see 'in stock', and both write on_hand = 0 and create an order. One of them will wait weeks for a book that was never there.",
        "why": "Check-then-decrement is two operations. The check is based on a value that is already stale by the time the write happens.",
        "fix": "Push the check into the write. A single conditional statement, `UPDATE stock SET on_hand = on_hand - 1 WHERE isbn = ? AND on_hand >= 1`, is atomic in the database. Read the rows-affected count: 1 means this buyer got the copy, 0 means it sold out. There is no window between check and decrement, and the stock can never go negative.\n\nThe Java class mirrors that statement with an atomic per-key update. A restock uses an additive `increment`, so it never overwrites a sale that happened concurrently.",
        "code": [
          {
            "file": "StockTable.java",
            "body": "import java.util.concurrent.ConcurrentHashMap;\n\n/** In-memory stand-in for the stock table, mirroring one conditional UPDATE. */\npublic class StockTable {\n    private final ConcurrentHashMap<String, Integer> onHand = new ConcurrentHashMap<>();\n\n    public void upsert(String isbn, int qty) {\n        onHand.put(isbn, qty);\n    }\n\n    /**\n     * UPDATE stock SET on_hand = on_hand - ? WHERE isbn = ? AND on_hand >= ?\n     * Returns the number of rows affected: 1 = got the copy, 0 = sold out.\n     */\n    public int decrementIfEnough(String isbn, int qty) {\n        int[] affected = {0};\n        onHand.computeIfPresent(isbn, (key, current) -> {   // atomic per key\n            if (current >= qty) {\n                affected[0] = 1;\n                return current - qty;\n            }\n            return current;\n        });\n        return affected[0];\n    }\n\n    /** A restock adds to whatever is there now; it never overwrites a concurrent sale. */\n    public void increment(String isbn, int qty) {\n        onHand.merge(isbn, qty, Integer::sum);\n    }\n\n    public int onHand(String isbn) {\n        return onHand.getOrDefault(isbn, 0);\n    }\n}"
          },
          {
            "file": "reserve-last-copy.sql",
            "body": "-- One statement; the database applies it atomically under a row lock.\nUPDATE stock\n   SET on_hand = on_hand - 1\n WHERE isbn = 'isbn-1'\n   AND on_hand >= 1;\n-- rows affected = 1  -> this buyer got the copy\n-- rows affected = 0  -> sold out, tell the buyer"
          }
        ],
        "alternatives": [
          "Pessimistic: `SELECT ... FOR UPDATE` on the stock row, check, then update, all in one transaction. Correct, but holds the lock longer.",
          "Optimistic: add a `version` column and `UPDATE ... WHERE version = ?`; retry or fail on zero rows.",
          "Hold the copy while the customer pays, using a reservation with an expiry (see the shopping cart question)."
        ],
        "say": "I never check stock and then decrement in two steps. I do it in one conditional UPDATE and look at the rows affected. If it is zero the book has sold out, and the database guarantees only one buyer gets the last copy."
      },
      {
        "title": "An order with several books, in different orders",
        "race": "Cart 1 contains books A then B. Cart 2 contains B then A. Cart 1 locks A and waits for B. Cart 2 locks B and waits for A. Both wait forever, and the checkout threads are stuck.",
        "why": "Each order needs several locks and acquires them in the order the cart lists the books. Two orders that take the same locks in opposite orders deadlock. A second problem is partial failure: book A reserved but book B out of stock leaves A reserved for nothing.",
        "fix": "Always acquire the locks in one global order, here sorted by ISBN, no matter how the cart is ordered. With a single order of acquisition a cycle of waiting cannot form. Then check every book first and only decrement after all the checks pass, so a failure touches nothing, and release the locks in reverse order in a `finally` block.",
        "code": [
          {
            "file": "MultiBookReservation.java",
            "body": "import java.util.ArrayList;\nimport java.util.List;\nimport java.util.Map;\nimport java.util.TreeSet;\nimport java.util.concurrent.ConcurrentHashMap;\nimport java.util.concurrent.locks.ReentrantLock;\n\npublic class MultiBookReservation {\n    private static final class Row {\n        final ReentrantLock lock = new ReentrantLock();\n        int onHand;\n        Row(int onHand) { this.onHand = onHand; }\n    }\n\n    private final Map<String, Row> rows = new ConcurrentHashMap<>();\n\n    public void add(String isbn, int qty) {\n        rows.put(isbn, new Row(qty));\n    }\n\n    /** All-or-nothing: either every book is reserved or none is touched. */\n    public boolean reserveAll(Map<String, Integer> wanted) {\n        List<String> order = new ArrayList<>(new TreeSet<>(wanted.keySet()));  // one global lock order\n        List<Row> held = new ArrayList<>();\n        try {\n            for (String isbn : order) {\n                Row row = rows.get(isbn);\n                if (row == null) return false;\n                row.lock.lock();\n                held.add(row);\n            }\n            for (String isbn : order) {\n                if (rows.get(isbn).onHand < wanted.get(isbn)) return false;   // nothing changed yet\n            }\n            for (String isbn : order) {\n                rows.get(isbn).onHand -= wanted.get(isbn);\n            }\n            return true;\n        } finally {\n            for (int i = held.size() - 1; i >= 0; i--) held.get(i).lock.unlock();\n        }\n    }\n\n    public int onHand(String isbn) {\n        Row row = rows.get(isbn);\n        row.lock.lock();\n        try {\n            return row.onHand;\n        } finally {\n            row.lock.unlock();\n        }\n    }\n}"
          }
        ],
        "alternatives": [
          "`tryLock` with a timeout and a back-off retry; avoids deadlock but needs retry logic.",
          "One database transaction that updates the rows in sorted order, so the database acquires row locks in a consistent order.",
          "Reserve each line separately and compensate (release) the earlier lines if a later one fails."
        ],
        "say": "A multi-book order needs several locks, so I fix a global lock order, for example by ISBN. That removes the possibility of a deadlock cycle. I check everything first and only then decrement, so an out-of-stock book leaves nothing half-reserved."
      },
      {
        "title": "The customer double-clicks Place Order",
        "race": "The browser sends the same checkout request twice, 40 ms apart, or the mobile app retries after a timeout. Both requests create an order and both charge the card, so the customer pays twice for one basket.",
        "why": "The server cannot tell a retry from a genuinely new order. Without a stable identity for the operation, each request is treated as new work.",
        "fix": "Have the client send an idempotency key, one per checkout attempt, and make the first request win. `putIfAbsent` atomically claims the key with a pending result. The first caller does the work and completes the future; every later caller finds the existing future and simply waits for and returns the same order.\n\nIf the first attempt fails, remove the key so a real retry is allowed. In production store the key with the order in the database under a unique constraint, so it also survives restarts and works across servers.",
        "code": [
          {
            "file": "IdempotentOrderService.java",
            "body": "import java.util.concurrent.CompletableFuture;\nimport java.util.concurrent.ConcurrentHashMap;\nimport java.util.function.Supplier;\n\npublic class IdempotentOrderService {\n    public record Order(String id) {}\n\n    private final ConcurrentHashMap<String, CompletableFuture<Order>> byKey = new ConcurrentHashMap<>();\n\n    /** Same idempotency key => same order, no matter how many times or how fast it is sent. */\n    public Order placeOrder(String idempotencyKey, Supplier<Order> createAndCharge) {\n        CompletableFuture<Order> mine = new CompletableFuture<>();\n        CompletableFuture<Order> existing = byKey.putIfAbsent(idempotencyKey, mine);\n        if (existing != null) {\n            return existing.join();            // a duplicate: wait for / reuse the first result\n        }\n        try {\n            Order order = createAndCharge.get();   // runs once per key\n            mine.complete(order);\n            return order;\n        } catch (RuntimeException e) {\n            byKey.remove(idempotencyKey, mine);    // allow a genuine retry after a failure\n            mine.completeExceptionally(e);\n            throw e;\n        }\n    }\n}"
          }
        ],
        "alternatives": [
          "A unique constraint on `(user_id, idempotency_key)` in the orders table; the second insert fails and you return the existing order.",
          "Disable the button client-side. Helpful, but never enough on its own.",
          "A short-lived Redis key (`SET key NX EX 60`) as a fast duplicate filter in front of the database."
        ],
        "say": "Retries and double clicks are normal, so checkout has to be idempotent. The client sends an idempotency key, I claim it atomically, and every duplicate gets back the original order instead of creating or charging again."
      }
    ]
  },
  {
    "id": "shopping-cart-system",
    "scenarios": [
      {
        "title": "Stock is 1: only one shopper may add it to the cart",
        "race": "Only one unit of a product is left. Ten shoppers open the page and all see In stock. All ten press Add to cart. If the cart does not reserve anything, all ten check out, nine of them are told 'sorry, out of stock' at the payment page, and nine people feel cheated after entering their card details.",
        "why": "Showing stock and promising stock are different things. Without reserving the unit, availability is only a hint that is stale a moment later, and the real decrement happens at the very end, in a race.",
        "fix": "Reserve the unit when it is added to the cart. A hold records who has it and when it expires. Add-to-cart succeeds only if the units not held by other people cover the request. Everything for one SKU happens under that SKU's lock, so ten concurrent shoppers are processed one at a time and exactly one gets the hold.\n\nThe hold has a time to live, for example 10 minutes, so an abandoned cart does not block the item forever. On payment, `confirm` turns the hold into a real decrement; if the hold expired, confirmation fails and the shopper is told. Expired holds are purged lazily inside the same lock, so no background job is required.\n\nThe lock is per SKU, so busy products do not slow down the rest of the catalogue.",
        "code": [
          {
            "file": "StockReservations.java",
            "body": "import java.time.Clock;\nimport java.time.Duration;\nimport java.time.Instant;\nimport java.util.HashMap;\nimport java.util.Map;\nimport java.util.concurrent.ConcurrentHashMap;\nimport java.util.concurrent.locks.ReentrantLock;\n\npublic class StockReservations {\n    private record Hold(int qty, Instant expiresAt) {}\n\n    private static final class Sku {\n        final ReentrantLock lock = new ReentrantLock();\n        final Map<String, Hold> holds = new HashMap<>();   // userId -> hold, guarded by lock\n        int onHand;                                        // guarded by lock\n        Sku(int onHand) { this.onHand = onHand; }\n    }\n\n    private final Map<String, Sku> skus = new ConcurrentHashMap<>();\n    private final Clock clock;\n    private final Duration holdTtl;\n\n    public StockReservations(Clock clock, Duration holdTtl) {\n        this.clock = clock;\n        this.holdTtl = holdTtl;\n    }\n\n    public void addSku(String skuId, int onHand) {\n        skus.put(skuId, new Sku(onHand));\n    }\n\n    /** Add-to-cart: hold qty for this user unless other people's holds leave too little. */\n    public boolean reserve(String skuId, String userId, int qty) {\n        Sku sku = skus.get(skuId);\n        sku.lock.lock();\n        try {\n            Instant now = clock.instant();\n            purgeExpired(sku, now);\n            int heldByOthers = sku.holds.entrySet().stream()\n                    .filter(e -> !e.getKey().equals(userId))\n                    .mapToInt(e -> e.getValue().qty())\n                    .sum();\n            if (sku.onHand - heldByOthers < qty) return false;\n            sku.holds.put(userId, new Hold(qty, now.plus(holdTtl)));   // re-adding refreshes the hold\n            return true;\n        } finally {\n            sku.lock.unlock();\n        }\n    }\n\n    /** Payment succeeded: turn the hold into a real stock decrement. */\n    public boolean confirm(String skuId, String userId) {\n        Sku sku = skus.get(skuId);\n        sku.lock.lock();\n        try {\n            purgeExpired(sku, clock.instant());\n            Hold hold = sku.holds.remove(userId);\n            if (hold == null) return false;          // the hold expired: the item may be gone\n            sku.onHand -= hold.qty();\n            return true;\n        } finally {\n            sku.lock.unlock();\n        }\n    }\n\n    public void release(String skuId, String userId) {\n        Sku sku = skus.get(skuId);\n        sku.lock.lock();\n        try {\n            sku.holds.remove(userId);\n        } finally {\n            sku.lock.unlock();\n        }\n    }\n\n    public int available(String skuId) {\n        Sku sku = skus.get(skuId);\n        sku.lock.lock();\n        try {\n            purgeExpired(sku, clock.instant());\n            return sku.onHand - sku.holds.values().stream().mapToInt(Hold::qty).sum();\n        } finally {\n            sku.lock.unlock();\n        }\n    }\n\n    private void purgeExpired(Sku sku, Instant now) {\n        sku.holds.values().removeIf(h -> !h.expiresAt().isAfter(now));\n    }\n}"
          }
        ],
        "alternatives": [
          "Do not reserve at add-to-cart; only decrement at checkout with a conditional UPDATE. Simpler, but the loser finds out late. Common for low-demand items.",
          "Redis: `SET hold:{sku}:{user} 1 NX PX 600000` plus an atomic counter in a Lua script, for multiple servers.",
          "Database row lock: `SELECT ... FOR UPDATE` on the stock row, count active holds, insert the hold.",
          "For flash sales put buyers in a queue and admit them one by one."
        ],
        "say": "Add to cart is a promise, so I reserve the unit with an expiry. Each SKU has its own lock, so with a stock of one exactly one shopper gets the hold. The hold expires so abandoned carts free the item, and payment confirms the hold into a real decrement."
      },
      {
        "title": "Same user adds the same item from two tabs",
        "race": "A user has an item in the cart with quantity 2. In one tab they press +1 and in another they press +1 at the same moment. Both requests read 2 and both write 3. The user expected 4 and the cart silently lost one click.",
        "why": "A lost update: two read-modify-write sequences start from the same value, and the second write overwrites the first.",
        "fix": "Do the whole update in one atomic operation per cart line. `ConcurrentHashMap.merge` runs the function atomically for that key, so each add sees the result of the previous one and no update is lost. The same function applies the per-line limit, so a cap of N stays true even under concurrency.\n\nIn a database store carts per row and use `UPDATE cart_items SET qty = LEAST(qty + ?, ?) WHERE ...`, which is atomic, instead of reading the quantity into the application.",
        "code": [
          {
            "file": "CartLines.java",
            "body": "import java.util.concurrent.ConcurrentHashMap;\n\npublic class CartLines {\n    private final ConcurrentHashMap<String, Integer> lines = new ConcurrentHashMap<>();\n    private final int maxPerLine;\n\n    public CartLines(int maxPerLine) {\n        this.maxPerLine = maxPerLine;\n    }\n\n    /** Safe when the same user adds from two tabs or devices at once. */\n    public void add(String skuId, int qty) {\n        // merge() is atomic per key: no get-then-put window, so no lost update\n        lines.merge(skuId, Math.min(qty, maxPerLine),\n                (current, added) -> Math.min(maxPerLine, current + added));\n    }\n\n    public int qty(String skuId) {\n        return lines.getOrDefault(skuId, 0);\n    }\n}"
          }
        ],
        "alternatives": [
          "Optimistic version on the cart: `UPDATE ... WHERE version = ?` and retry on a conflict.",
          "Make requests idempotent by sending the desired quantity instead of +1, so replays do not add twice.",
          "Serialise per cart with a lock or a single-writer queue keyed by cart id."
        ],
        "say": "Two tabs means two concurrent read-modify-writes on the same line. I make the line update atomic, merge in memory or an arithmetic UPDATE in the database, so no click is lost, and the limit is enforced in the same operation."
      },
      {
        "title": "The cart changes while the customer is paying",
        "race": "The customer presses Pay on a cart of 2 items totalling 500. While the payment is being processed, a second tab adds a third item. The charge was for 500 but the order that gets created contains 3 items worth 700, or the opposite: the order has 2 items but the cart still shows 3.",
        "why": "Checkout reads the cart, charges, and creates the order in several steps, and the cart is allowed to change during them. The amount charged and the goods ordered come from different moments in time.",
        "fix": "Freeze the cart atomically when checkout begins and use the returned snapshot for both the charge and the order. The cart state is an immutable value in an `AtomicReference`; `beginCheckout` swaps in a frozen copy and returns exactly the lines it froze. Any `add` that arrives afterwards is rejected, so every accepted add is part of the snapshot.\n\nIf payment fails, `abortCheckout` unfreezes the cart. If it succeeds, `completeCheckout` empties it. A frozen cart must also expire, so a crashed checkout cannot lock the cart forever.",
        "code": [
          {
            "file": "FreezableCart.java",
            "body": "import java.util.HashMap;\nimport java.util.Map;\nimport java.util.concurrent.atomic.AtomicReference;\n\npublic class FreezableCart {\n    public record State(Map<String, Integer> lines, boolean frozen) {\n        public int totalQty() {\n            return lines.values().stream().mapToInt(Integer::intValue).sum();\n        }\n    }\n\n    private final AtomicReference<State> state = new AtomicReference<>(new State(Map.of(), false));\n\n    public void add(String skuId, int qty) {\n        state.updateAndGet(s -> {\n            if (s.frozen()) throw new IllegalStateException(\"cart is being checked out\");\n            Map<String, Integer> next = new HashMap<>(s.lines());\n            next.merge(skuId, qty, Integer::sum);\n            return new State(Map.copyOf(next), false);\n        });\n    }\n\n    /** Freezes the cart and returns the exact lines the payment will be charged for. */\n    public State beginCheckout() {\n        return state.updateAndGet(s -> new State(s.lines(), true));\n    }\n\n    public void abortCheckout() {\n        state.updateAndGet(s -> new State(s.lines(), false));\n    }\n\n    public void completeCheckout() {\n        state.set(new State(Map.of(), false));\n    }\n}"
          }
        ],
        "alternatives": [
          "Version number on the cart; checkout records the version and the commit step fails if it changed.",
          "Create the order first as PENDING from a snapshot and charge that order, so the amount always matches.",
          "Re-price and re-validate the cart at the payment step, and ask the customer to confirm if it changed."
        ],
        "say": "Checkout must charge exactly what it orders. I freeze the cart at the start and charge and order from that one snapshot, rejecting edits while frozen, and I unfreeze it if the payment fails."
      }
    ]
  },
  {
    "id": "notification-system",
    "scenarios": [
      {
        "title": "A retry sends the same notification twice",
        "race": "An order-shipped event triggers an SMS. The provider call is slow, so the caller times out and retries, while the first call is still in flight. Both succeed at the provider and the customer receives the same SMS twice. The same happens when a message-queue redelivers an event.",
        "why": "Retries and at-least-once delivery are normal in distributed systems, but sending an SMS is not idempotent. Nothing records that this event has already been handled.",
        "fix": "Give every notification a deterministic idempotency key that names the business event, for example `order-123:shipped:sms`, and claim it before sending. `putIfAbsent` marks the key `IN_FLIGHT` for exactly one caller. That caller calls the provider and marks it `SENT`; duplicates see `IN_FLIGHT` or `SENT` and return without sending anything.\n\nIf the provider call fails, release the key so that a retry may try again. In production keep the ledger in a database or Redis with a TTL, because an in-memory map is lost on restart and not shared between servers.",
        "code": [
          {
            "file": "IdempotentNotifier.java",
            "body": "import java.util.concurrent.ConcurrentHashMap;\n\npublic class IdempotentNotifier {\n    public enum Outcome { SENT, ALREADY_SENT, IN_PROGRESS }\n    private enum Status { IN_FLIGHT, SENT }\n\n    private final ConcurrentHashMap<String, Status> ledger = new ConcurrentHashMap<>();\n\n    /** The key identifies the business event, e.g. \"order-123:shipped:sms\". */\n    public Outcome send(String idempotencyKey, Runnable provider) {\n        Status prior = ledger.putIfAbsent(idempotencyKey, Status.IN_FLIGHT);   // claim the key\n        if (prior == Status.SENT) return Outcome.ALREADY_SENT;\n        if (prior == Status.IN_FLIGHT) return Outcome.IN_PROGRESS;\n        try {\n            provider.run();\n            ledger.put(idempotencyKey, Status.SENT);\n            return Outcome.SENT;\n        } catch (RuntimeException e) {\n            ledger.remove(idempotencyKey);      // provider failed: a retry may try again\n            throw e;\n        }\n    }\n}"
          }
        ],
        "alternatives": [
          "A unique index on the idempotency key in a `notifications` table; the duplicate insert fails and is skipped.",
          "Pass the key to providers that support idempotency keys, so they dedupe on their side.",
          "Accept at-least-once and make the message idempotent for the user, for example by including an order reference."
        ],
        "say": "Retries are inevitable, so I make sending idempotent. Each notification has a key derived from the business event, I claim the key atomically before calling the provider, and a failed send releases the key so a retry can succeed."
      },
      {
        "title": "Two workers pick up the same queued notification",
        "race": "Two workers poll the queue at the same time. Both read notification 77 as QUEUED and both start sending it. Separately, worker A crashes mid-send and nobody ever finishes notification 77.",
        "why": "Claiming a job is a read followed by a write, so two workers can both read QUEUED. A plain 'claimed' flag also has no answer for a worker that dies while holding the job.",
        "fix": "Claim the job with a compare-and-set that records the worker and a lease expiry, `QUEUED -> SENDING(worker, leaseUntil)`. Only one worker wins; the rest back off. If the worker dies, the lease expires and another worker may take the job over.\n\nOnly the current lease holder may mark the job done. A stale worker that wakes up after losing its lease gets `false` from `complete`, so it cannot overwrite the new owner's result. This is the same idea as a fencing token.\n\nIn a database it is one statement: `UPDATE jobs SET state = 'SENDING', worker = ?, lease_until = ? WHERE id = ? AND (state = 'QUEUED' OR lease_until < now())`.",
        "code": [
          {
            "file": "JobClaim.java",
            "body": "import java.util.concurrent.atomic.AtomicReference;\n\npublic class JobClaim {\n    public enum State { QUEUED, SENDING, DONE }\n\n    private record Claim(State state, String workerId, long leaseUntilMillis) {}\n\n    private final AtomicReference<Claim> claim = new AtomicReference<>(new Claim(State.QUEUED, null, 0));\n    private final long leaseMillis;\n\n    public JobClaim(long leaseMillis) {\n        this.leaseMillis = leaseMillis;\n    }\n\n    /** One worker wins. A dead worker's lease expires and the job can be claimed again. */\n    public boolean tryClaim(String workerId, long nowMillis) {\n        Claim current = claim.get();\n        boolean claimable = current.state() == State.QUEUED\n                || (current.state() == State.SENDING && current.leaseUntilMillis() <= nowMillis);\n        return claimable\n                && claim.compareAndSet(current, new Claim(State.SENDING, workerId, nowMillis + leaseMillis));\n    }\n\n    /** Only the current lease holder may finish the job; a stale worker is rejected. */\n    public boolean complete(String workerId) {\n        Claim current = claim.get();\n        return current.state() == State.SENDING && workerId.equals(current.workerId())\n                && claim.compareAndSet(current, new Claim(State.DONE, workerId, 0));\n    }\n}"
          }
        ],
        "alternatives": [
          "`SELECT ... FOR UPDATE SKIP LOCKED` to let each worker grab a different row.",
          "A broker with visibility timeouts (such as SQS) or consumer groups (such as Kafka), which give you the lease for free.",
          "Combine with the idempotency key above, so a takeover after a crash cannot send a duplicate."
        ],
        "say": "A job claim has to be atomic and it has to survive worker crashes. I claim with compare-and-set plus a lease, only the lease holder can complete it, and an expired lease lets another worker take over safely."
      }
    ]
  }
]));
