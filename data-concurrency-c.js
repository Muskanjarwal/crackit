window.CONCURRENCY = window.CONCURRENCY || [];
window.CONCURRENCY.push(
  {
    "id": "car-rental-system",
    "scenarios": [
      {
        "title": "Two renters book the same car for overlapping dates",
        "race": "Car KA-01 is free on 1–5 Nov. **Asha** requests 1–4 Nov and **Ben** requests 3–6 Nov at the same instant. Both threads run the availability check and both see no conflicting booking. Asha saves her booking, then Ben saves his. The car is now rented to two people on 3 and 4 Nov.",
        "why": "This is check-then-act. The availability check and the insert are two separate steps, and the other request can slip in between them. Each thread decided on data that was already stale by the time it acted. A `synchronized` keyword on the controller method or a thread-safe list does not help: every individual operation is safe, the combination is not.",
        "fix": "Make the check and the insert one indivisible step by holding a **lock per car** around both. A request for car A and a request for car B never wait on each other, so throughput stays high. Inside the lock the overlap test uses half-open ranges `[from, to)`, so a return on the 5th and a new pickup on the 5th are allowed.\n\nIn production the same idea moves to the database: a unique constraint is awkward for ranges, so use an exclusion constraint (Postgres `EXCLUDE USING gist` on the car and date range) or `SELECT ... FOR UPDATE` on the car row before checking overlaps.",
        "code": [
          {
            "file": "CarBookingService.java",
            "body": "import java.time.LocalDate;\nimport java.util.ArrayList;\nimport java.util.List;\nimport java.util.Map;\nimport java.util.Optional;\nimport java.util.UUID;\nimport java.util.concurrent.ConcurrentHashMap;\nimport java.util.concurrent.locks.ReentrantLock;\n\npublic class CarBookingService {\n    // Half-open range [from, to): returning on the 5th and a new pickup on the 5th do not clash.\n    record Booking(String id, String carId, LocalDate from, LocalDate to) {\n        boolean overlaps(LocalDate f, LocalDate t) {\n            return from.isBefore(t) && f.isBefore(to);\n        }\n    }\n\n    private final Map<String, List<Booking>> bookingsByCar = new ConcurrentHashMap<>();\n    private final Map<String, ReentrantLock> locks = new ConcurrentHashMap<>();\n\n    public Optional<Booking> book(String carId, LocalDate from, LocalDate to) {\n        // One lock per car: bookings for different cars never wait on each other.\n        ReentrantLock lock = locks.computeIfAbsent(carId, id -> new ReentrantLock());\n        lock.lock();\n        try {\n            List<Booking> existing = bookingsByCar.computeIfAbsent(carId, id -> new ArrayList<>());\n            for (Booking b : existing) {\n                if (b.overlaps(from, to)) {\n                    return Optional.empty();   // check and insert happen under the same lock\n                }\n            }\n            Booking booking = new Booking(UUID.randomUUID().toString(), carId, from, to);\n            existing.add(booking);\n            return Optional.of(booking);\n        } finally {\n            lock.unlock();\n        }\n    }\n}"
          }
        ],
        "alternatives": [
          "One global lock: correct but serialises every booking in the system. Fine for a whiteboard answer, not for scale.",
          "Optimistic: add a `version` to the car's calendar row and retry if the version changed between read and write. Better when conflicts are rare.",
          "Database exclusion constraint: the database rejects the overlapping insert, and the service just maps the error to 'car unavailable'."
        ],
        "say": "\"The bug is check-then-act: availability and insert are two steps. I'd lock per car, so only one request at a time can check-and-insert for that car, while other cars stay fully parallel. In the database I'd get the same effect with a row lock on the car or an exclusion constraint on the date range.\""
      },
      {
        "title": "Payment retries create two rentals and two charges",
        "race": "Asha taps **Confirm and pay**. The payment gateway is slow, the app times out and the client retries automatically. Both requests reach the server. The first charges the card and creates a rental. The second also sees 'no rental yet', charges again and creates a second rental.",
        "why": "A retry looks exactly like a new request unless the server can recognise it. Network timeouts mean the client cannot know whether the first attempt succeeded, so retries are unavoidable. The system has to make the second attempt harmless.",
        "fix": "Use an **idempotency key**. The client generates one key per checkout and sends the same key on every retry. The server stores the result under that key and returns the stored result for repeats. `computeIfAbsent` guarantees the creation logic runs at most once per key, even if ten retries arrive together.\n\nIn a real service the key and the rental live in the same database transaction (a unique index on the key), so a crash between 'charged' and 'saved' cannot leave them out of step. Call the payment provider with the same key too, since most providers support it.",
        "code": [
          {
            "file": "IdempotentRentalService.java",
            "body": "import java.util.UUID;\nimport java.util.concurrent.ConcurrentHashMap;\nimport java.util.concurrent.atomic.AtomicInteger;\n\npublic class IdempotentRentalService {\n    record Rental(String id, String carId, String requestKey) {}\n\n    private final ConcurrentHashMap<String, Rental> byRequestKey = new ConcurrentHashMap<>();\n    private final AtomicInteger charges = new AtomicInteger();\n\n    /** The client generates requestKey once per checkout and resends the same key on every retry. */\n    public Rental confirm(String requestKey, String carId) {\n        // computeIfAbsent runs the lambda at most once per key, even if 10 retries arrive together.\n        return byRequestKey.computeIfAbsent(requestKey, key -> {\n            charges.incrementAndGet();            // stand-in for \"charge the card\"\n            return new Rental(UUID.randomUUID().toString(), carId, key);\n        });\n    }\n\n    public int chargeCount() {\n        return charges.get();\n    }\n}"
          }
        ],
        "alternatives": [
          "Unique constraint on `(user_id, car_id, pickup_time)`: simple, but it blocks legitimate repeat bookings and cannot tell a retry from a new intent.",
          "Disable the button after the first tap: good UX, but it does nothing for automatic client retries or a double-submit from two tabs."
        ],
        "say": "\"Retries are normal, so the server must be idempotent. The client sends an idempotency key per checkout, and I store the outcome against that key. A duplicate gets the original result back instead of a second charge.\""
      }
    ]
  },
  {
    "id": "hotel-management-system",
    "scenarios": [
      {
        "title": "The last room is sold to two guests across a multi-night stay",
        "race": "A hotel has 1 Deluxe room left for 1–3 Dec. **Guest A** books 1–3 Dec and **Guest B** books 2–4 Dec. Both read the nightly counts, see 1 left for each of their nights, and both decrement. The night of 2 Dec now has -1 rooms available: the room is oversold.",
        "why": "A stay spans several nights, so one booking updates several counters, and the check and updates must be atomic across **all** of them. Making each single decrement atomic is not enough: B can pass the check for 2 Dec before A's decrement lands. It is also easy to half-apply: reserve night 1, find night 2 full, and leave night 1 decremented.",
        "fix": "Guard the room type's inventory with one lock. Inside it, **check every night first, then decrement every night**. If any night is sold out, return without changing anything, so a failed booking never leaves a partial reservation behind.\n\nThe lock is scoped to one room type, so Deluxe and Standard bookings do not block each other. In SQL the same shape is one transaction: `SELECT ... FOR UPDATE` on the inventory rows for those dates (ordered by date, to avoid deadlock), verify `available > 0` for all, then update them.",
        "code": [
          {
            "file": "RoomTypeInventory.java",
            "body": "import java.time.LocalDate;\nimport java.util.HashMap;\nimport java.util.Map;\n\npublic class RoomTypeInventory {\n    private final int totalRooms;\n    private final Map<LocalDate, Integer> availableByNight = new HashMap<>();\n\n    public RoomTypeInventory(int totalRooms) {\n        this.totalRooms = totalRooms;\n    }\n\n    /** All-or-nothing across every night of the stay. */\n    public synchronized boolean reserve(LocalDate checkIn, LocalDate checkOut) {\n        for (LocalDate d = checkIn; d.isBefore(checkOut); d = d.plusDays(1)) {\n            if (availableByNight.getOrDefault(d, totalRooms) <= 0) {\n                return false;                       // sold out on at least one night: change nothing\n            }\n        }\n        for (LocalDate d = checkIn; d.isBefore(checkOut); d = d.plusDays(1)) {\n            availableByNight.merge(d, totalRooms - 1, (current, ignored) -> current - 1);\n        }\n        return true;\n    }\n\n    public synchronized void release(LocalDate checkIn, LocalDate checkOut) {\n        for (LocalDate d = checkIn; d.isBefore(checkOut); d = d.plusDays(1)) {\n            availableByNight.merge(d, 1, Integer::sum);\n        }\n    }\n}"
          }
        ],
        "alternatives": [
          "Conditional update per night, `UPDATE inventory SET available = available - 1 WHERE date = ? AND available > 0`, inside one transaction. Check the affected row count for every night and roll back if any is 0.",
          "Allow controlled overbooking (airlines do): keep a limit slightly above capacity and handle the walk-away case as a business process. Say this if the interviewer asks about real-world practice."
        ],
        "say": "\"A stay touches several nightly counters, so I need check-all-then-decrement-all as one atomic step. I'd lock the room-type inventory, verify every night, then decrement; if any night is full I change nothing. In SQL that's one transaction with row locks taken in date order.\""
      },
      {
        "title": "Two front-desk clerks check guests into the same room number",
        "race": "Rooms 101 and 102 are free. Clerk 1 and Clerk 2 each call 'assign me an available room'. Both scan the list, both find room 101 with status AVAILABLE, and both write OCCUPIED. Two guests are handed the key to 101.",
        "why": "Reading the status and writing it are separate operations. Between them the other clerk can read the same AVAILABLE value. The state change 'AVAILABLE to OCCUPIED' must be a single atomic transition that only one caller can win.",
        "fix": "Store the status in an `AtomicReference` and claim the room with `compareAndSet(AVAILABLE, OCCUPIED)`. CAS succeeds only if the value is still AVAILABLE at the moment of the write, so exactly one clerk wins each room, and the loser simply moves on to the next one. No lock is held while scanning, so clerks do not block each other.\n\nThe database equivalent is a conditional update: `UPDATE rooms SET status = 'OCCUPIED' WHERE id = ? AND status = 'AVAILABLE'`. If it updates 0 rows, someone else got there first.",
        "code": [
          {
            "file": "RoomAssigner.java",
            "body": "import java.util.List;\nimport java.util.Optional;\nimport java.util.concurrent.atomic.AtomicReference;\n\npublic class RoomAssigner {\n    enum Status { AVAILABLE, OCCUPIED }\n\n    static class Room {\n        final String number;\n        final AtomicReference<Status> status = new AtomicReference<>(Status.AVAILABLE);\n        Room(String number) { this.number = number; }\n    }\n\n    private final List<Room> rooms;\n\n    public RoomAssigner(List<Room> rooms) {\n        this.rooms = rooms;\n    }\n\n    /** Two front-desk clerks can call this at once; each room can be won by only one of them. */\n    public Optional<Room> checkIn() {\n        for (Room room : rooms) {\n            // Atomic \"if AVAILABLE then OCCUPIED\": exactly one caller sees true.\n            if (room.status.compareAndSet(Status.AVAILABLE, Status.OCCUPIED)) {\n                return Optional.of(room);\n            }\n        }\n        return Optional.empty();\n    }\n\n    public void checkOut(Room room) {\n        room.status.set(Status.AVAILABLE);\n    }\n}"
          }
        ],
        "alternatives": [
          "`synchronized` around the whole `checkIn()`: simplest and correct, at the cost of serialising all check-ins.",
          "`SELECT ... FOR UPDATE SKIP LOCKED LIMIT 1` in SQL, so concurrent clerks each grab a different free room instead of waiting."
        ],
        "say": "\"The transition AVAILABLE to OCCUPIED has to be atomic. I'd use compare-and-set on the room status, so only one clerk's CAS succeeds and the other falls through to the next room. In SQL it's a conditional UPDATE with a WHERE status = 'AVAILABLE' and I check the row count.\""
      }
    ]
  },
  {
    "id": "digital-wallet",
    "scenarios": [
      {
        "title": "Two simultaneous payments overdraw the wallet",
        "race": "Balance is ₹1,000. A payment of ₹800 for a cab and a payment of ₹700 for food arrive together. Both threads read 1,000, both see enough funds, and both write back: one writes 200, the other writes 300. Whichever writes last wins, so ₹1,500 was spent from a ₹1,000 wallet and the balance is wrong.",
        "why": "`balance = balance - amount` is read-modify-write, three steps that can interleave. This is the classic **lost update**: the second write overwrites the first without ever seeing it. The 'sufficient funds' check suffers from the same gap.",
        "fix": "Put the balance in an `AtomicLong` and debit with a **compare-and-set loop**: read the current balance, refuse if it is too low, and try to swap `current` for `current - amount`. If another thread changed the balance meanwhile, the CAS fails and the loop re-reads and re-checks. The balance can never go negative and no update is lost.\n\nStore money as integer minor units (paise), never `double`. In SQL use one atomic statement: `UPDATE wallets SET balance = balance - ? WHERE id = ? AND balance >= ?` and treat 0 affected rows as 'insufficient funds'.",
        "code": [
          {
            "file": "Wallet.java",
            "body": "import java.util.concurrent.atomic.AtomicLong;\n\npublic class Wallet {\n    private final AtomicLong balancePaise;\n\n    public Wallet(long openingBalancePaise) {\n        this.balancePaise = new AtomicLong(openingBalancePaise);\n    }\n\n    public boolean debit(long amount) {\n        while (true) {\n            long current = balancePaise.get();\n            if (current < amount) {\n                return false;                       // insufficient funds, balance never goes negative\n            }\n            // Succeeds only if nobody changed the balance since we read it; otherwise retry.\n            if (balancePaise.compareAndSet(current, current - amount)) {\n                return true;\n            }\n        }\n    }\n\n    public void credit(long amount) {\n        balancePaise.addAndGet(amount);\n    }\n\n    public long balance() {\n        return balancePaise.get();\n    }\n}"
          }
        ],
        "alternatives": [
          "`synchronized` or a `ReentrantLock` per wallet: simpler to read, and the right choice once a debit has to update more than one field.",
          "Optimistic locking with a `version` column: `UPDATE ... WHERE id = ? AND version = ?`, retry on 0 rows. Good when updates carry more than a single number.",
          "`SELECT ... FOR UPDATE` then update in one transaction: pessimistic, fine for modest contention on a single wallet."
        ],
        "say": "\"Balance minus amount is read-modify-write, so concurrent debits lose updates. I'd make the debit atomic: a CAS loop in memory, or a single conditional UPDATE with balance >= amount in the database. The WHERE clause does the sufficient-funds check and the update in one step.\""
      },
      {
        "title": "A transfers to B while B transfers to A: deadlock",
        "race": "Thread 1 moves ₹100 from account 1 to account 2: it locks account 1, then waits for account 2. At the same moment Thread 2 moves ₹50 from account 2 to account 1: it locks account 2, then waits for account 1. Each holds what the other needs, and both wait forever.",
        "why": "A transfer needs **two** locks, and the two threads acquire them in opposite orders. That is the textbook deadlock condition: a cycle in the wait-for graph. It only shows up under load and with opposing transfers, so it often escapes testing.",
        "fix": "Impose a **global lock order**: always lock the account with the lower id first, whichever way the money moves. Now both threads ask for account 1 before account 2, so one of them simply waits for the other and no cycle can form. Guard the `from == to` case separately, because locking the same account twice and updating it twice is a bug.\n\nThe same rule applies in SQL: when a transaction touches two rows, lock them in primary-key order.",
        "code": [
          {
            "file": "TransferService.java",
            "body": "public class TransferService {\n    static class Account {\n        final long id;\n        private long balance;\n        Account(long id, long balance) { this.id = id; this.balance = balance; }\n        long balance() { return balance; }\n    }\n\n    public boolean transfer(Account from, Account to, long amount) {\n        if (from.id == to.id) {\n            return false;                           // self-transfer would lock the same monitor twice\n        }\n        // Always lock the lower id first, whatever the direction of the transfer.\n        Account first = from.id < to.id ? from : to;\n        Account second = first == from ? to : from;\n\n        synchronized (first) {\n            synchronized (second) {\n                if (from.balance < amount) {\n                    return false;\n                }\n                from.balance -= amount;\n                to.balance += amount;\n                return true;\n            }\n        }\n    }\n}"
          }
        ],
        "alternatives": [
          "`tryLock` with a timeout and a randomised back-off retry: avoids the deadlock but can livelock under heavy contention.",
          "A single global lock for all transfers: no deadlock, but one transfer at a time for the whole bank.",
          "Avoid two-row transactions: write immutable ledger entries (debit and credit) and compute balances from them."
        ],
        "say": "\"Two locks acquired in opposite orders is the deadlock. I'd always lock the lower account id first, so every transfer follows the same order and there's no cycle. I'd also reject a transfer to the same account.\""
      },
      {
        "title": "A retried transfer moves the money twice",
        "race": "Asha sends ₹500 to Ben. The response is lost on a flaky network, so the app retries the same request. The server receives it twice. The first call debits ₹500. The second call looks like a brand-new transfer and debits another ₹500.",
        "why": "From the server's side, a retry and a genuinely new request are identical unless the request carries an identity. Money movement must be **at-most-once** per user intent, even though the network only guarantees at-least-once delivery.",
        "fix": "Require an **idempotency key** with each transfer, generated once by the client for the user's intent. The service records the outcome under that key; a repeat returns the stored outcome instead of moving money. `computeIfAbsent` makes 'first one runs, others wait and reuse the result' atomic per key. Inside, the transfer still uses ordered locking from the previous scenario.\n\nIn a real system persist the key and result in the same transaction as the balance update (unique index on the key), and expire keys after a retention window such as 24 hours.",
        "code": [
          {
            "file": "IdempotentTransferService.java",
            "body": "import java.util.concurrent.ConcurrentHashMap;\n\npublic class IdempotentTransferService {\n    static class Account {\n        final long id;\n        private long balance;\n        Account(long id, long balance) { this.id = id; this.balance = balance; }\n        long balance() { return balance; }\n    }\n\n    enum Result { SUCCESS, INSUFFICIENT_FUNDS }\n\n    private final ConcurrentHashMap<String, Result> processed = new ConcurrentHashMap<>();\n\n    /** The same idempotencyKey always returns the same result and moves money at most once. */\n    public Result transfer(String idempotencyKey, Account from, Account to, long amount) {\n        return processed.computeIfAbsent(idempotencyKey, key -> doTransfer(from, to, amount));\n    }\n\n    private Result doTransfer(Account from, Account to, long amount) {\n        Account first = from.id < to.id ? from : to;      // lock ordering, see the deadlock scenario\n        Account second = first == from ? to : from;\n        synchronized (first) {\n            synchronized (second) {\n                if (from.balance < amount) {\n                    return Result.INSUFFICIENT_FUNDS;\n                }\n                from.balance -= amount;\n                to.balance += amount;\n                return Result.SUCCESS;\n            }\n        }\n    }\n}"
          }
        ],
        "alternatives": [
          "Natural key: dedupe on `(from, to, amount, client_timestamp)`. Fragile, because two real identical transfers can collide.",
          "Server-issued transaction id: the client first asks for an id, then submits it. Safe but needs an extra round trip."
        ],
        "say": "\"Networks give at-least-once delivery, so I make the operation idempotent. Each transfer carries a client-generated key; the first execution stores its result under that key and every retry gets that stored result back, so money moves at most once.\""
      }
    ]
  },
  {
    "id": "airline-management-system",
    "scenarios": [
      {
        "title": "Two passengers book the last seat, or the same seat, at once",
        "race": "Seat 12A on flight FL101 is free. **Passenger A** and **Passenger B** both select it. Each reads 'free', each writes their booking. Both receive a confirmation. For a group booking it is worse: A takes 12A+12B, B takes 12B+12C, and each ends up with half of what they wanted.",
        "why": "Check-then-act again, now with several resources per booking. A plain `containsKey` followed by `put` leaves a window for the other request, and claiming seats one at a time without a rollback strategy leaves partial bookings behind.",
        "fix": "Make 'claim this seat' a single atomic operation: `putIfAbsent(flight:seat, bookingId)` returns null for exactly one caller. For multi-seat bookings, claim seats in a **sorted order** (so two group bookings cannot interleave oddly), and if any seat is already taken, **roll back** the ones you did claim. `remove(key, value)` releases only seats still owned by this booking, so you can never free someone else's seat.\n\nIn SQL, make the seat a row with a unique constraint on `(flight_id, seat_no)` and insert; a duplicate-key error means someone else got it. Wrap the group in one transaction so the rollback is automatic.",
        "code": [
          {
            "file": "SeatClaimService.java",
            "body": "import java.util.ArrayList;\nimport java.util.List;\nimport java.util.TreeSet;\nimport java.util.concurrent.ConcurrentHashMap;\n\npublic class SeatClaimService {\n    // key \"FL101:12A\" -> bookingId. putIfAbsent is the atomic \"insert only if free\".\n    private final ConcurrentHashMap<String, String> seatOwner = new ConcurrentHashMap<>();\n\n    /** Books several seats for one booking: either all of them, or none. */\n    public boolean claim(String flightId, List<String> seats, String bookingId) {\n        List<String> claimed = new ArrayList<>();\n        for (String seat : new TreeSet<>(seats)) {          // fixed order, no duplicates\n            String key = flightId + \":\" + seat;\n            if (seatOwner.putIfAbsent(key, bookingId) == null) {\n                claimed.add(key);\n            } else {\n                for (String k : claimed) {\n                    seatOwner.remove(k, bookingId);          // roll back only what we own\n                }\n                return false;\n            }\n        }\n        return true;\n    }\n\n    public void release(String flightId, String seat, String bookingId) {\n        seatOwner.remove(flightId + \":\" + seat, bookingId);\n    }\n}"
          }
        ],
        "alternatives": [
          "`synchronized` per flight: easy, but one slow booking blocks everyone on that flight.",
          "Optimistic `version` on the seat map row, retrying on conflict: fine for low contention, wasteful for a hot flight.",
          "Run seat assignment on a per-flight single-threaded queue, so all bookings for a flight are processed in order without locks."
        ],
        "say": "\"Seat selection must be an atomic claim. I'd use putIfAbsent or a unique constraint on flight and seat, so exactly one request wins. For group bookings I claim in sorted order and roll back on the first failure, so nobody ends up with a partial booking.\""
      },
      {
        "title": "A seat is held during payment, then the passenger disappears",
        "race": "Asha picks seat 1A and goes to the payment page. If the seat is only 'selected' on her screen, Ben can buy it meanwhile and Asha pays for a seat that no longer exists. If instead you mark it BOOKED at selection time, Asha closing the tab leaves 1A blocked forever.",
        "why": "Payment takes seconds to minutes and can fail or be abandoned, so you cannot hold a hard lock the whole time, and you cannot skip protection either. You need a temporary claim that expires by itself, and a confirm step that checks the claim is still valid.",
        "fix": "Two states: **HELD** (with an expiry time and the holder's id) and **BOOKED**. `hold` succeeds if the seat is free, **or its previous hold has expired**, and uses `compute` so the check and the write are atomic per seat. `confirm` succeeds only if the caller is still the holder and the hold has not expired. Expiry is evaluated lazily on read, so no cleanup thread is needed for correctness; an optional sweeper can just tidy memory.\n\nInject a `Clock` so you can test expiry without sleeping.",
        "code": [
          {
            "file": "SeatHoldService.java",
            "body": "import java.time.Clock;\nimport java.time.Duration;\nimport java.time.Instant;\nimport java.util.concurrent.ConcurrentHashMap;\n\npublic class SeatHoldService {\n    enum State { HELD, BOOKED }\n\n    record Slot(String owner, State state, Instant expiresAt) {\n        boolean isLive(Instant now) {\n            return state == State.BOOKED || now.isBefore(expiresAt);\n        }\n    }\n\n    private final ConcurrentHashMap<String, Slot> slots = new ConcurrentHashMap<>();\n    private final Duration holdTtl;\n    private final Clock clock;\n\n    public SeatHoldService(Duration holdTtl, Clock clock) {\n        this.holdTtl = holdTtl;\n        this.clock = clock;\n    }\n\n    /** Step 1: reserve the seat while the passenger pays. */\n    public boolean hold(String seatKey, String passengerId) {\n        Instant now = clock.instant();\n        boolean[] won = {false};\n        slots.compute(seatKey, (key, current) -> {          // compute() is atomic per key\n            if (current != null && current.isLive(now)) {\n                won[0] = current.owner().equals(passengerId);\n                return current;                              // someone else holds or owns it\n            }\n            won[0] = true;                                   // free or expired: take it\n            return new Slot(passengerId, State.HELD, now.plus(holdTtl));\n        });\n        return won[0];\n    }\n\n    /** Step 2: only the holder, and only before the hold expires, can confirm. */\n    public boolean confirm(String seatKey, String passengerId) {\n        Instant now = clock.instant();\n        boolean[] confirmed = {false};\n        slots.computeIfPresent(seatKey, (key, current) -> {\n            if (current.state() == State.HELD && current.owner().equals(passengerId) && current.isLive(now)) {\n                confirmed[0] = true;\n                return new Slot(passengerId, State.BOOKED, null);\n            }\n            return current;\n        });\n        return confirmed[0];\n    }\n}"
          }
        ],
        "alternatives": [
          "A background job that releases expired holds: needed when other systems must see the seat as free, but never rely on it alone for correctness, since it runs late.",
          "Redis `SET seat:FL101:1A passengerId NX PX 300000`: the same hold-with-TTL idea, shared across servers.",
          "Reserve for a short fixed window and make payment fail fast if the hold has lapsed."
        ],
        "say": "\"I'd split selection into hold and confirm. A hold is a short, expiring claim, and confirm re-checks that I still own an unexpired hold before it books the seat. Expiry is checked at read time, so an abandoned checkout frees the seat on its own.\""
      }
    ]
  },
  {
    "id": "library-management-system",
    "scenarios": [
      {
        "title": "Two members borrow the last copy of a book",
        "race": "One copy of *Clean Code* is left. **Member A** and **Member B** press Borrow in the same millisecond. Both read `availableCopies = 1`, both pass the `> 0` check, and both write `0`. Two loans exist for one physical book, and the inventory count is now wrong.",
        "why": "`if (available > 0) available--` is check-then-act. Between the comparison and the decrement, the other thread runs the same comparison on the same stale value. This is the same 'last item in stock' problem as flash sales.",
        "fix": "Decrement with a **compare-and-set loop** on an `AtomicInteger`: read the count, refuse if it is 0, then swap `current` for `current - 1`, retrying if another thread got in first. Exactly as many borrows succeed as there are copies, however many requests arrive at once. Returns use `updateAndGet` capped at the total, so a duplicate return call can never create phantom copies.\n\nThe SQL form is a single statement: `UPDATE books SET available = available - 1 WHERE id = ? AND available > 0`. If it updates one row, the borrow succeeded.",
        "code": [
          {
            "file": "BookInventory.java",
            "body": "import java.util.concurrent.atomic.AtomicInteger;\n\npublic class BookInventory {\n    private final int totalCopies;\n    private final AtomicInteger availableCopies;\n\n    public BookInventory(int totalCopies) {\n        this.totalCopies = totalCopies;\n        this.availableCopies = new AtomicInteger(totalCopies);\n    }\n\n    /** Succeeds for exactly as many callers as there are copies, however many arrive at once. */\n    public boolean tryBorrow() {\n        while (true) {\n            int current = availableCopies.get();\n            if (current == 0) {\n                return false;\n            }\n            if (availableCopies.compareAndSet(current, current - 1)) {\n                return true;\n            }\n        }\n    }\n\n    public void giveBack() {\n        availableCopies.updateAndGet(current -> Math.min(totalCopies, current + 1));   // never exceed the shelf\n    }\n\n    public int available() {\n        return availableCopies.get();\n    }\n}"
          }
        ],
        "alternatives": [
          "Model each physical copy as its own `BookCopy` row with a status, and CAS the status of a copy. Needed anyway if you track barcodes or condition per copy.",
          "`synchronized` around borrow and return: simplest, and fine for a library-sized load."
        ],
        "say": "\"It's check-then-act on the available count. I'd make the decrement atomic: CAS in memory, or a conditional UPDATE with available > 0 in SQL and a check on the row count. Only as many requests succeed as there are copies.\""
      },
      {
        "title": "Renewing a loan at the same moment it is returned",
        "race": "The librarian scans the return of a book just as the member taps Renew in the app. The renew handler loads the loan, sees ACTIVE, the return handler marks it RETURNED, and then the renew handler writes back its stale copy: the loan is ACTIVE again with a new due date. A book that is physically on the shelf is shown as on loan and starts accruing fines.",
        "why": "Both handlers read the loan, decide, and write the whole object back. The later write silently overwrites the earlier one (a lost update), and a decision made from stale state, 'it's still active so I may renew', is applied after the state has already changed.",
        "fix": "Keep the loan's state in one **immutable snapshot** (status, due date, renewal count) inside an `AtomicReference`, and change it only with `compareAndSet`. Renew re-reads and re-decides if its CAS fails, so it will see RETURNED on the retry and refuse. A second return click simply returns false.\n\nThis is optimistic concurrency. In a database it becomes a `version` column: `UPDATE loans SET status = ..., version = version + 1 WHERE id = ? AND version = ?`, retrying or failing when 0 rows are updated.",
        "code": [
          {
            "file": "Loan.java",
            "body": "import java.time.LocalDate;\nimport java.util.concurrent.atomic.AtomicReference;\n\npublic class Loan {\n    enum Status { ACTIVE, RETURNED }\n\n    // Immutable snapshot: status, due date and renewal count always change together.\n    record Snapshot(Status status, LocalDate due, int renewals) {}\n\n    private static final int MAX_RENEWALS = 2;\n    private final AtomicReference<Snapshot> state;\n\n    public Loan(LocalDate due) {\n        this.state = new AtomicReference<>(new Snapshot(Status.ACTIVE, due, 0));\n    }\n\n    public boolean renew() {\n        while (true) {\n            Snapshot current = state.get();\n            if (current.status() != Status.ACTIVE || current.renewals() >= MAX_RENEWALS) {\n                return false;                       // cannot renew a returned loan\n            }\n            Snapshot next = new Snapshot(Status.ACTIVE, current.due().plusDays(14), current.renewals() + 1);\n            if (state.compareAndSet(current, next)) {\n                return true;\n            }                                       // lost a race: re-read and decide again\n        }\n    }\n\n    public boolean returnBook() {\n        while (true) {\n            Snapshot current = state.get();\n            if (current.status() == Status.RETURNED) {\n                return false;                       // second return click is a harmless no-op\n            }\n            Snapshot next = new Snapshot(Status.RETURNED, current.due(), current.renewals());\n            if (state.compareAndSet(current, next)) {\n                return true;\n            }\n        }\n    }\n\n    public Snapshot snapshot() {\n        return state.get();\n    }\n}"
          }
        ],
        "alternatives": [
          "Pessimistic: lock the loan row (`SELECT ... FOR UPDATE`) in both handlers. Correct and simple when conflicts are common.",
          "A small state machine, ACTIVE to RETURNED only, enforced in one method with a lock. Clearer to read, and equivalent for this problem."
        ],
        "say": "\"Both handlers read-then-write the whole loan, so the stale write wins. I'd make state transitions atomic with optimistic locking: a version check or CAS, so a renew that raced with a return fails and re-reads the new state.\""
      }
    ]
  },
  {
    "id": "traffic-signal-control-system",
    "scenarios": [
      {
        "title": "Two directions turn green at the same time",
        "race": "The north-south light is green. The controller switches phase: thread 1 sets north-south to RED, thread 2 (a pedestrian-button handler) sets east-west to GREEN and also the old schedule thread sets north-south back to GREEN. A monitoring thread reading the lights in between sees both directions green, or a half-updated junction.",
        "why": "A junction has an **invariant**: never two conflicting greens. That invariant spans several fields, so protecting each light separately does not protect it. Writers can interleave, and readers can observe the state mid-change.",
        "fix": "Route every change **and every read** through one lock owned by the intersection. The change method first sets all conflicting directions to RED and only then sets the target GREEN, all within one critical section, so the invariant holds whenever the lock is free. `snapshot()` takes the same lock and returns a copy, so a monitor gets a consistent picture and never sees a transient state.\n\nIn a real controller also insert an all-red clearance interval between phases; that is a timing rule layered on top of this safety rule.",
        "code": [
          {
            "file": "IntersectionController.java",
            "body": "import java.util.EnumMap;\nimport java.util.Map;\n\npublic class IntersectionController {\n    enum Direction { NORTH_SOUTH, EAST_WEST }\n    enum Light { RED, GREEN }\n\n    private final Map<Direction, Light> lights = new EnumMap<>(Direction.class);\n\n    public IntersectionController() {\n        lights.put(Direction.NORTH_SOUTH, Light.GREEN);\n        lights.put(Direction.EAST_WEST, Light.RED);\n    }\n\n    /** Every change goes through this one monitor, so no reader ever sees two greens. */\n    public synchronized void giveGreenTo(Direction target) {\n        for (Direction d : Direction.values()) {\n            if (d != target) {\n                lights.put(d, Light.RED);           // clear conflicting directions first\n            }\n        }\n        lights.put(target, Light.GREEN);\n    }\n\n    /** Readers take the same lock, so they get a consistent picture of the whole junction. */\n    public synchronized Map<Direction, Light> snapshot() {\n        return new EnumMap<>(lights);\n    }\n}"
          }
        ],
        "alternatives": [
          "`volatile` fields: gives visibility but not atomicity across several lights, so it does not protect the invariant.",
          "An immutable `Phase` object swapped through an `AtomicReference`: readers are lock-free and always see a complete phase. A good fit if reads vastly outnumber changes."
        ],
        "say": "\"The safety rule is that two conflicting directions are never green together, and it spans multiple fields. I'd keep all lights behind one intersection-level lock for both changes and reads, clearing the conflicting directions to red before turning the target green.\""
      },
      {
        "title": "An emergency override races with the timer tick",
        "race": "An ambulance triggers the emergency override and the system sets all lights to red. In the same instant the scheduled timer fires and advances the phase to EAST_WEST_GREEN. The timer's write lands after the override and silently cancels it: the ambulance faces cross traffic.",
        "why": "Two independent threads (timer and emergency handler) both write the phase, and their order is arbitrary. 'Last writer wins' is the wrong policy: the override must beat the timer no matter which one runs second. With locks alone you also have to remember to check the emergency flag in every code path.",
        "fix": "Use a **single-threaded event loop** (the actor style). Every event, timer tick, emergency, or clear, is queued as a task, and one thread processes them one at a time. The state is touched only by that thread, so there is nothing to lock and no interleaving to reason about. The `advance` task explicitly ignores ticks while in EMERGENCY_ALL_RED, so the override can never be undone by a timer event.\n\nReads go through the same thread (`supplyAsync(..., loop)`), so they too see a consistent phase.",
        "code": [
          {
            "file": "SignalActor.java",
            "body": "import java.util.concurrent.CompletableFuture;\nimport java.util.concurrent.ExecutorService;\nimport java.util.concurrent.Executors;\nimport java.util.concurrent.ScheduledExecutorService;\nimport java.util.concurrent.TimeUnit;\n\npublic class SignalActor {\n    enum Phase { NORTH_SOUTH_GREEN, EAST_WEST_GREEN, EMERGENCY_ALL_RED }\n\n    // One thread owns all state. Timer ticks and emergency calls are just queued tasks.\n    private final ExecutorService loop = Executors.newSingleThreadExecutor();\n    private final ScheduledExecutorService timer = Executors.newSingleThreadScheduledExecutor();\n    private Phase phase = Phase.NORTH_SOUTH_GREEN;          // touched only from the loop thread\n\n    public void start(long periodSeconds) {\n        timer.scheduleAtFixedRate(() -> loop.execute(this::advance), periodSeconds, periodSeconds, TimeUnit.SECONDS);\n    }\n\n    private void advance() {\n        if (phase == Phase.EMERGENCY_ALL_RED) {\n            return;                                         // a tick can never undo an override\n        }\n        phase = phase == Phase.NORTH_SOUTH_GREEN ? Phase.EAST_WEST_GREEN : Phase.NORTH_SOUTH_GREEN;\n    }\n\n    public void emergencyOverride() {\n        loop.execute(() -> phase = Phase.EMERGENCY_ALL_RED);\n    }\n\n    public void clearEmergency() {\n        loop.execute(() -> phase = Phase.NORTH_SOUTH_GREEN);\n    }\n\n    public CompletableFuture<Phase> currentPhase() {\n        return CompletableFuture.supplyAsync(() -> phase, loop);\n    }\n\n    public void shutdown() {\n        timer.shutdownNow();\n        loop.shutdown();\n    }\n}"
          }
        ],
        "alternatives": [
          "A lock plus a `volatile boolean emergency` that every method checks. Works, but it is easy to forget a check as the system grows.",
          "Priority queue of events, so an emergency task jumps ahead of queued ticks. Useful when events can pile up.",
          "Fail-safe default: if the controller crashes or loses state, fall back to flashing red."
        ],
        "say": "\"Timer and emergency are two writers racing, and the override must always win. I'd serialise all events onto a single thread, so there are no locks and no interleavings, and make the tick handler ignore ticks while an emergency is active.\""
      }
    ]
  }
);
