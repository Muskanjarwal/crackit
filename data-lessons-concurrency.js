window.LESSONS = window.LESSONS || [];
window.LESSONS.push(
{
  "id": "race-conditions",
  "name": "Race Conditions & Check-Then-Act",
  "summary": "A race condition is a bug whose outcome depends on the timing of concurrent operations. The classic form is **check-then-act**: two buyers both see `stock = 1`, both decide to proceed, and you sell a unit you do not have. This lesson sets up the running example for the whole concurrency course: one product, stock of 1, and thousands of people pressing Add to Cart at the same moment.",
  "sections": [
    {
      "heading": "The scenario: one PlayStation left",
      "text": "A product page shows 'Only 1 left'. Ten thousand people are refreshing it. The first thing every LLD answer writes is the obvious code: if there is stock, take one.\n\nRead it slowly. Every line is correct on its own, and on a single thread this class works perfectly. The bug only exists when two threads (or two servers, or two database sessions) run the method at the same time.",
      "code": [
        {
          "file": "BrokenInventory.java",
          "body": "public class BrokenInventory implements Inventory {\n    private int stock;\n\n    public BrokenInventory(int stock) {\n        this.stock = stock;\n    }\n\n    @Override\n    public boolean addToCart(String userId) {\n        if (stock > 0) {            // 1. check\n            Thread.yield();         //    (stands in for a DB round trip or any other delay)\n            stock = stock - 1;      // 2. act\n            return true;\n        }\n        return false;\n    }\n\n    @Override\n    public int stock() {\n        return stock;\n    }\n}"
        },
        {
          "file": "Inventory.java",
          "body": "public interface Inventory {\n    /** Returns true if this user got a unit. */\n    boolean addToCart(String userId);\n\n    int stock();\n}"
        }
      ],
      "note": "The `Thread.yield()` stands in for anything that takes time between the check and the act: a database round trip, a call to a pricing service, a garbage-collection pause. Real systems always have such a gap."
    },
    {
      "heading": "Why it breaks: the interleaving",
      "text": "The method has two steps, a **check** (`stock > 0`) and an **act** (`stock = stock - 1`). Nothing stops another thread from running its check in the gap between them. Both threads then act on a fact that stopped being true.\n\nThere are two flavours of the same bug. **Check-then-act**: the decision is made from data that is stale by the time you act on it. **Read-modify-write** (also called a lost update): two threads read the same value, both add or subtract, and the second write silently overwrites the first.",
      "code": [
        {
          "file": "timeline.txt",
          "body": "stock = 1\n\nThread A: reads stock   -> 1     (1 > 0, safe to proceed)\nThread B: reads stock   -> 1     (1 > 0, safe to proceed)\nThread A: writes stock  =  0     A gets the unit\nThread B: writes stock  =  0     B gets the unit too\n\nResult: two buyers, one unit. The counter says 0, so nothing looks wrong\nuntil the warehouse tries to ship two PlayStations."
        },
        {
          "file": "LostUpdate.java",
          "body": "// The same bug without an if: a plain read-modify-write loses updates.\npublic class LostUpdate {\n    static int soldCounter = 0;\n\n    public static void main(String[] args) throws Exception {\n        Thread[] buyers = new Thread[4];\n        for (int i = 0; i < buyers.length; i++) {\n            buyers[i] = new Thread(() -> {\n                for (int n = 0; n < 100_000; n++) {\n                    soldCounter++;       // read, add one, write: three steps, not one\n                }\n            });\n            buyers[i].start();\n        }\n        for (Thread t : buyers) t.join();\n        System.out.println(\"expected 400000, got \" + soldCounter);\n    }\n}"
        }
      ],
      "note": "On our run, four threads each incrementing a counter 100,000 times produced 316,526 instead of 400,000. `count++` is three steps (read, add, write), not one."
    },
    {
      "heading": "Reproduce it before you fix it",
      "text": "Concurrency bugs are easy to believe in and hard to see. Always write a test that provokes the race before you write the fix, otherwise you cannot prove the fix works.\n\nThe trick is a start gate: every buyer thread waits on a latch, and the test releases them all at the same instant. Run many rounds, and count the rounds where more than one buyer got the single unit.",
      "code": [
        {
          "file": "OversellTest.java",
          "body": "import java.util.concurrent.CountDownLatch;\nimport java.util.concurrent.ExecutorService;\nimport java.util.concurrent.Executors;\nimport java.util.concurrent.atomic.AtomicInteger;\nimport java.util.function.Supplier;\n\npublic class OversellTest {\n    /** Returns how many rounds handed the single last unit to more than one buyer. */\n    public static int run(Supplier<Inventory> factory, int rounds, int buyers) throws InterruptedException {\n        ExecutorService pool = Executors.newFixedThreadPool(buyers);\n        int oversold = 0;\n        try {\n            for (int r = 0; r < rounds; r++) {\n                Inventory inventory = factory.get();\n                CountDownLatch start = new CountDownLatch(1);\n                CountDownLatch done = new CountDownLatch(buyers);\n                AtomicInteger winners = new AtomicInteger();\n                for (int i = 0; i < buyers; i++) {\n                    String user = \"user-\" + i;\n                    pool.execute(() -> {\n                        try {\n                            start.await();\n                            if (inventory.addToCart(user)) winners.incrementAndGet();\n                        } catch (InterruptedException e) {\n                            Thread.currentThread().interrupt();\n                        } finally {\n                            done.countDown();\n                        }\n                    });\n                }\n                start.countDown();   // release every buyer at the same instant\n                done.await();\n                if (winners.get() > 1 || inventory.stock() < 0) oversold++;\n            }\n        } finally {\n            pool.shutdown();\n        }\n        return oversold;\n    }\n}"
        },
        {
          "file": "BrokenDemo.java",
          "body": "public class BrokenDemo {\n    public static void main(String[] args) throws Exception {\n        int rounds = 5000;\n        int oversold = OversellTest.run(() -> new BrokenInventory(1), rounds, 8);\n        System.out.println(\"rounds that sold the last unit twice or more: \" + oversold + \" of \" + rounds);\n    }\n}"
        }
      ],
      "note": "On our run, 1,628 of 5,000 rounds sold the last unit more than once. Your number will differ, but it will not be zero. We reuse `OversellTest` in every lesson that follows, and every fix must score 0."
    },
    {
      "heading": "Where this hides in LLD designs",
      "text": "Once you know the shape (read a value, decide, write it back) you will see it in almost every interview problem. In an interview, naming the race out loud before the interviewer asks is a strong signal.",
      "bullets": [
        "Parking Lot: two cars are assigned the last free spot.",
        "Movie or concert booking: two users both book seat A7 for the same show.",
        "Digital Wallet / ATM: two withdrawals of 800 from a balance of 1,000.",
        "Library: the last copy of a book is lent to two members.",
        "Auction: two bids both beat the 'current highest' they each read.",
        "Coupon with a usage limit, ride-sharing driver assignment, task claimed by two workers."
      ]
    },
    {
      "heading": "The map of fixes",
      "text": "The rest of the course is one idea applied at different levels: **make the check and the act a single indivisible step**. Which tool you pick depends on where the state lives.",
      "bullets": [
        "State in one JVM: locks, then atomic variables (next two lessons).",
        "State in a database: conditional UPDATE, row locks, unique constraints, or a version column.",
        "State shared by many servers outside the database: distributed locks with fencing, or an atomic Redis counter.",
        "Item must stay yours while you pay: a reservation with an expiry.",
        "Requests arrive twice: idempotency keys.",
        "More than one resource at once: lock ordering."
      ]
    }
  ],
  "takeaways": [
    "Check-then-act and read-modify-write are the two shapes of almost every race.",
    "Correct single-threaded code can be wrong under concurrency. The bug is in the gap between steps.",
    "Reproduce the race with a start gate and many rounds before you fix it.",
    "The cure is always the same: make check and act one atomic step, at whatever level owns the data."
  ],
  "pitfalls": [
    "Assuming 'it worked in my test' means it is safe. A race that needs a microsecond gap shows up under production load.",
    "Reading the value twice (once to check, once to use) and trusting both reads.",
    "Fixing the in-memory object while the real truth lives in the database, or the other way round.",
    "Adding `Thread.sleep` to a test to 'make it deterministic' instead of using a latch."
  ],
  "interviewQs": [
    {
      "q": "What is a race condition? Give an example from a booking system.",
      "a": "A race condition is a bug where the result depends on the relative timing of concurrent operations. In a booking system, two users read that seat A7 is free, both decide to book it, and both writes succeed, so one seat is sold twice. The root cause is check-then-act: the check and the booking are separate steps that another request can slip between."
    },
    {
      "q": "What is the difference between a race condition and a data race?",
      "a": "A data race is a low-level memory issue: two threads access the same variable, at least one writes, and there is no synchronisation, so visibility and ordering are undefined. A race condition is a higher-level logic bug about timing. You can have a race condition with no data race (every access is atomic but the sequence is wrong, like the half-atomic counter in lesson 3) and a data race without harmful results."
    },
    {
      "q": "Why is `count++` not thread-safe?",
      "a": "It compiles to read, add one, write. Two threads can both read 5, both compute 6, and both write 6, so one increment is lost. Use AtomicInteger.incrementAndGet, a lock, or a database UPDATE that increments in a single statement."
    },
    {
      "q": "How would you test for a race condition?",
      "a": "Hold all worker threads at a start latch and release them together, run the scenario thousands of times, and assert the invariant (never more units sold than stock). Stress tests do not prove absence of races, so you also reason about atomicity, but they reliably catch missing locks."
    }
  ],
  "related": [
    "locks-synchronization",
    "atomic-operations-cas",
    "limited-stock-cart",
    "movie-ticket-booking"
  ]
},
{
  "id": "locks-synchronization",
  "name": "Locks & Synchronization",
  "summary": "A lock lets only one thread into a critical section at a time, which turns check-then-act into one indivisible step. Inside a single JVM, `synchronized` and `ReentrantLock` are the first tools to reach for. This lesson fixes the stock = 1 bug, then shows how to scale the fix from one product to millions.",
  "sections": [
    {
      "heading": "Fix 1: synchronized",
      "text": "Make the check and the decrement happen while holding the object's monitor. The second buyer cannot enter `addToCart` until the first has left, so it now sees `stock = 0`.\n\nBoth methods are synchronized, including the getter. A lock gives you two things: mutual exclusion and **visibility** (writes made inside the lock are seen by the next thread that takes it). Reading without the lock can return a stale value.",
      "code": [
        {
          "file": "SynchronizedInventory.java",
          "body": "public class SynchronizedInventory implements Inventory {\n    private int stock;\n\n    public SynchronizedInventory(int stock) {\n        this.stock = stock;\n    }\n\n    @Override\n    public synchronized boolean addToCart(String userId) {\n        if (stock > 0) {\n            stock--;\n            return true;\n        }\n        return false;\n    }\n\n    @Override\n    public synchronized int stock() {\n        return stock;\n    }\n}"
        }
      ],
      "note": "Run through the `OversellTest` from lesson 1: 0 oversold rounds out of 3,000 on our run, against 1,628 of 5,000 for the unsafe version."
    },
    {
      "heading": "Fix 2: ReentrantLock with a timeout",
      "text": "`ReentrantLock` does the same job with more control: `tryLock` with a timeout so a request never waits forever, interruptible waits, optional fairness, and multiple condition queues.\n\nNotice the contract. If we cannot get the lock in time we throw `BusyException`, we do not return `false`. 'Busy, try again' and 'sold out' are different answers, and telling a shopper that something is sold out because the server was slow is a real bug. Always unlock in `finally`.",
      "code": [
        {
          "file": "LockedInventory.java",
          "body": "import java.util.concurrent.TimeUnit;\nimport java.util.concurrent.locks.ReentrantLock;\n\npublic class LockedInventory implements Inventory {\n    public static class BusyException extends RuntimeException {\n        public BusyException() { super(\"inventory is busy, please retry\"); }\n    }\n\n    private final ReentrantLock lock = new ReentrantLock();\n    private int stock;\n\n    public LockedInventory(int stock) {\n        this.stock = stock;\n    }\n\n    @Override\n    public boolean addToCart(String userId) {\n        boolean acquired;\n        try {\n            acquired = lock.tryLock(200, TimeUnit.MILLISECONDS);   // never wait forever\n        } catch (InterruptedException e) {\n            Thread.currentThread().interrupt();\n            throw new BusyException();\n        }\n        if (!acquired) throw new BusyException();   // \"busy\" is not the same answer as \"sold out\"\n        try {\n            if (stock <= 0) return false;\n            stock--;\n            return true;\n        } finally {\n            lock.unlock();                          // always in finally\n        }\n    }\n\n    @Override\n    public int stock() {\n        lock.lock();\n        try { return stock; } finally { lock.unlock(); }\n    }\n}"
        }
      ]
    },
    {
      "heading": "Keep the critical section small",
      "text": "The lock should cover exactly the invariant you are protecting and nothing more. Time spent holding the lock is time every other buyer of that product spends waiting.",
      "bullets": [
        "Put the check and the act inside. Put logging, pricing and emails outside.",
        "Never call a network service, a database, or any code you do not control while holding a lock.",
        "Use a private lock object (or a private `ReentrantLock`) instead of `synchronized(this)` on a public class, so outside code cannot take your lock by accident.",
        "If the method touches stock and the cart, decide which object owns the invariant. Do not scatter it across two locks without a lock order (lesson 9)."
      ]
    },
    {
      "heading": "One lock per product: striping",
      "text": "A single lock for the whole inventory is correct but turns the shop into a queue: a buyer of socks waits behind a buyer of PlayStations. Give each product its own lock and unrelated products stop interfering.\n\nTwo common ways. **Per-key locks** keep a `ConcurrentHashMap<productId, lock>` and create locks on demand: simple and exact, but the map grows with the catalogue. **Striping** hashes the product id onto a fixed array of locks (say 64): bounded memory, but two unrelated products can occasionally share a stripe, which only costs a little waiting and never correctness.",
      "code": [
        {
          "file": "StripedInventory.java",
          "body": "import java.util.Map;\nimport java.util.concurrent.ConcurrentHashMap;\nimport java.util.concurrent.locks.ReentrantLock;\n\n/** One lock per group of products, so unrelated products never wait on each other. */\npublic class StripedInventory {\n    private final Map<String, Integer> stock = new ConcurrentHashMap<>();\n    private final ReentrantLock[] stripes;\n\n    public StripedInventory(Map<String, Integer> initial, int stripeCount) {\n        stock.putAll(initial);\n        stripes = new ReentrantLock[stripeCount];\n        for (int i = 0; i < stripeCount; i++) stripes[i] = new ReentrantLock();\n    }\n\n    private ReentrantLock stripeFor(String productId) {\n        return stripes[Math.floorMod(productId.hashCode(), stripes.length)];\n    }\n\n    public boolean tryReserve(String productId) {\n        ReentrantLock lock = stripeFor(productId);\n        lock.lock();\n        try {\n            Integer current = stock.get(productId);\n            if (current == null || current <= 0) return false;\n            stock.put(productId, current - 1);\n            return true;\n        } finally {\n            lock.unlock();\n        }\n    }\n\n    public int stock(String productId) {\n        return stock.getOrDefault(productId, 0);\n    }\n}"
        },
        {
          "file": "PerKeyLockInventory.java",
          "body": "import java.util.Map;\nimport java.util.concurrent.ConcurrentHashMap;\nimport java.util.concurrent.locks.ReentrantLock;\n\n/** Alternative to striping: one lock object per product id, created on demand. */\npublic class PerKeyLockInventory {\n    private final Map<String, Integer> stock = new ConcurrentHashMap<>();\n    private final Map<String, ReentrantLock> locks = new ConcurrentHashMap<>();\n\n    public PerKeyLockInventory(Map<String, Integer> initial) {\n        stock.putAll(initial);\n    }\n\n    public boolean tryReserve(String productId) {\n        ReentrantLock lock = locks.computeIfAbsent(productId, id -> new ReentrantLock());\n        lock.lock();\n        try {\n            int current = stock.getOrDefault(productId, 0);\n            if (current <= 0) return false;\n            stock.put(productId, current - 1);\n            return true;\n        } finally {\n            lock.unlock();\n        }\n    }\n}"
        }
      ],
      "note": "Note the stock map is a `ConcurrentHashMap` even though a lock guards each update: different stripes touch the map at the same time, so the map itself must be thread-safe."
    },
    {
      "heading": "The limit: one JVM only",
      "text": "Everything in this lesson protects memory inside one process. The moment you run two application servers behind a load balancer, each has its own lock and its own copy of the state, and both will happily sell the last unit.\n\nTwo escapes. Move the decision into the database, which every server shares (lesson 5). Or take a lock that lives outside the processes (lesson 6). Interviewers often ask exactly this follow-up: 'what if you have ten servers?'"
    }
  ],
  "takeaways": [
    "A lock makes check-then-act atomic and makes writes visible to the next thread. You need both.",
    "Use `tryLock` with a timeout in request paths, and distinguish 'busy' from 'sold out'.",
    "Lock per product (or per stripe), not one global lock.",
    "In-process locks stop working the moment there is more than one server."
  ],
  "pitfalls": [
    "Locking the writer but not the reader, so readers see stale data.",
    "Forgetting `finally { lock.unlock(); }`, so one exception leaves the product locked forever.",
    "Holding a lock while calling a database or HTTP service.",
    "Synchronizing on a String literal, a boxed Integer or `this` of a public class: other code can share that lock by accident.",
    "Using a global lock 'to be safe' and discovering at launch that throughput equals one request at a time."
  ],
  "interviewQs": [
    {
      "q": "synchronized vs ReentrantLock: when would you pick each?",
      "a": "synchronized is simpler, cannot leak a lock (it is released on any exit), and is fine when you just need mutual exclusion. Pick ReentrantLock when you need tryLock with a timeout, interruptible waiting, fairness, or several Conditions. The price is that you must unlock in finally yourself."
    },
    {
      "q": "How do you lock per product instead of the whole inventory?",
      "a": "Keep a lock per product id, either a ConcurrentHashMap of locks created with computeIfAbsent, or a fixed array of stripes indexed by hash(productId) mod N. Striping bounds memory; per-key locks are exact. Both keep unrelated products from waiting on each other."
    },
    {
      "q": "Your API runs on 10 servers. Does synchronized on the inventory object protect you?",
      "a": "No. Each JVM has its own monitor and its own copy of the data, so ten buyers on ten servers can all pass the check. The invariant must be enforced where the data is shared: a conditional UPDATE or row lock in the database, or a distributed lock with a fencing token."
    },
    {
      "q": "What is the difference between a lock and a monitor, and what does 'reentrant' mean?",
      "a": "In Java every object has a monitor used by synchronized. A ReentrantLock is an explicit lock object. Reentrant means the thread that already holds the lock can acquire it again without deadlocking itself, with a hold count that must be released the same number of times."
    }
  ],
  "related": [
    "race-conditions",
    "atomic-operations-cas",
    "deadlock-and-lock-ordering",
    "database-locking"
  ]
},
{
  "id": "atomic-operations-cas",
  "name": "Atomic Operations & Compare-And-Swap",
  "summary": "For a single counter you do not need a lock at all. **Compare-and-swap (CAS)** updates a value only if it still holds the value you read, and the CPU does it as one indivisible step. This is how `AtomicInteger` and `ConcurrentHashMap` stay correct without blocking, and it is the in-memory cousin of the optimistic locking you will meet next.",
  "sections": [
    {
      "heading": "Atomic variables and CAS",
      "text": "`AtomicInteger.compareAndSet(expected, newValue)` says: 'set the value to newValue, but only if it is still expected'. It returns true if it succeeded and false if another thread changed the value first. Modern CPUs implement this as a single instruction, so no thread ever holds a lock, and a slow thread can never block a fast one.\n\nThat gives us a recipe for the last-unit problem: read the current stock, decide, then try to swap it. If the swap fails, someone else got there first, so read again."
    },
    {
      "heading": "The CAS retry loop",
      "text": "The loop re-reads and re-decides on every failed attempt. That re-decision is the important part: if the competitor took the last unit, the next iteration sees `current <= 0` and correctly reports sold out.\n\nThe loop always terminates in practice because each failed CAS means some other thread succeeded, so the system as a whole makes progress (this is called being lock-free).",
      "code": [
        {
          "file": "AtomicInventory.java",
          "body": "import java.util.concurrent.atomic.AtomicInteger;\n\npublic class AtomicInventory implements Inventory {\n    private final AtomicInteger stock;\n\n    public AtomicInventory(int stock) {\n        this.stock = new AtomicInteger(stock);\n    }\n\n    @Override\n    public boolean addToCart(String userId) {\n        while (true) {\n            int current = stock.get();\n            if (current <= 0) return false;\n            if (stock.compareAndSet(current, current - 1)) return true;\n            // CAS failed: someone changed stock between our read and our write.\n            // Loop, re-read, and decide again with fresh data.\n        }\n    }\n\n    @Override\n    public int stock() {\n        return stock.get();\n    }\n}"
        }
      ]
    },
    {
      "heading": "One line: getAndUpdate",
      "text": "`getAndUpdate` runs that same CAS loop for you. You hand it a function from the old value to the new value, and it returns the old value it actually replaced.\n\nBecause the function may run more than once under contention, it must be free of side effects: no logging, no incrementing other counters, no calls to other systems.",
      "code": [
        {
          "file": "UpdateInventory.java",
          "body": "import java.util.concurrent.atomic.AtomicInteger;\n\n/** Same guarantee, one line: getAndUpdate runs the CAS loop for us. */\npublic class UpdateInventory implements Inventory {\n    private final AtomicInteger stock;\n\n    public UpdateInventory(int stock) {\n        this.stock = new AtomicInteger(stock);\n    }\n\n    @Override\n    public boolean addToCart(String userId) {\n        int previous = stock.getAndUpdate(current -> current > 0 ? current - 1 : current);\n        return previous > 0;   // the value it saw is the value it acted on\n    }\n\n    @Override\n    public int stock() {\n        return stock.get();\n    }\n}"
        }
      ]
    },
    {
      "heading": "The trap: atomic pieces do not make an atomic whole",
      "text": "A very common mistake is to swap `int` for `AtomicInteger` and call it thread-safe. Each call is atomic, but the pair 'check then decrement' is not. Two buyers can both see 1, and both decrement, taking the stock to -1.",
      "code": [
        {
          "file": "HalfAtomicInventory.java",
          "body": "import java.util.concurrent.atomic.AtomicInteger;\n\n/** Looks safe because it uses an atomic type. It is not. */\npublic class HalfAtomicInventory implements Inventory {\n    private final AtomicInteger stock;\n\n    public HalfAtomicInventory(int stock) {\n        this.stock = new AtomicInteger(stock);\n    }\n\n    @Override\n    public boolean addToCart(String userId) {\n        if (stock.get() > 0) {          // atomic read ...\n            Thread.yield();\n            stock.decrementAndGet();    // ... atomic decrement, but the pair is not atomic\n            return true;\n        }\n        return false;\n    }\n\n    @Override\n    public int stock() {\n        return stock.get();\n    }\n}"
        }
      ],
      "note": "On our run this version oversold in 1,180 of 3,000 rounds, even though it only uses atomic operations. The fix is to make the decision part of the atomic operation, as `compareAndSet` and `getAndUpdate` do."
    },
    {
      "heading": "Many products: ConcurrentHashMap.compute",
      "text": "For a map of product to stock, `computeIfPresent` runs your function atomically for that key: no other thread can modify the same key while it runs, while other keys proceed in parallel. It gives you per-product atomicity without managing locks yourself.\n\nKeep the function short and never touch the same map from inside it.",
      "code": [
        {
          "file": "ComputeInventory.java",
          "body": "import java.util.Map;\nimport java.util.concurrent.ConcurrentHashMap;\n\n/** Many products: ConcurrentHashMap.compute runs the whole check-and-update atomically per key. */\npublic class ComputeInventory {\n    private final ConcurrentHashMap<String, Integer> stock = new ConcurrentHashMap<>();\n\n    public ComputeInventory(Map<String, Integer> initial) {\n        stock.putAll(initial);\n    }\n\n    public boolean tryReserve(String productId) {\n        boolean[] reserved = {false};\n        stock.computeIfPresent(productId, (id, current) -> {\n            if (current > 0) {\n                reserved[0] = true;\n                return current - 1;\n            }\n            return current;\n        });\n        return reserved[0];\n    }\n\n    public int stock(String productId) {\n        return stock.getOrDefault(productId, 0);\n    }\n}"
        }
      ]
    }
  ],
  "takeaways": [
    "CAS updates a value only if it has not changed since you read it, in one atomic step.",
    "Put the decision inside the atomic operation (compareAndSet or getAndUpdate), not around it.",
    "Atomic types protect one variable. They cannot protect an invariant spanning two fields.",
    "ConcurrentHashMap.compute gives per-key atomic updates for free."
  ],
  "pitfalls": [
    "Checking `atomic.get() > 0` and then calling `decrementAndGet()` separately: atomic parts, non-atomic whole.",
    "Side effects inside the update function: it can run several times.",
    "Using LongAdder or other striped counters for a bounded quantity. They are fast for counting but cannot enforce 'never below zero'.",
    "Assuming atomics cross process boundaries. They are per-JVM, just like locks."
  ],
  "interviewQs": [
    {
      "q": "How does compare-and-swap work?",
      "a": "CAS takes a memory location, an expected value and a new value. If the location currently holds the expected value it is replaced by the new value atomically and CAS reports success, otherwise nothing changes and it reports failure. Callers loop: read, compute, CAS, and retry from the read on failure."
    },
    {
      "q": "Why is `if (stock.get() > 0) stock.decrementAndGet();` wrong?",
      "a": "Each call is atomic but the two together are not, so it is still check-then-act. Two threads can both pass the check and both decrement, reaching -1. Use compareAndSet in a loop or getAndUpdate with the condition inside the function."
    },
    {
      "q": "CAS vs locks: when is each better?",
      "a": "CAS is cheap and non-blocking under low or moderate contention for a single variable. Under heavy contention many CAS attempts fail and burn CPU in retries. Locks are better when the critical section spans several variables or does more than a tiny update, because a waiting thread sleeps instead of spinning."
    },
    {
      "q": "What is the ABA problem?",
      "a": "A thread reads value A, another thread changes it to B and back to A, and the first thread's CAS succeeds even though the state changed in between. It matters for pointer-based structures. Counters are safe from it, and AtomicStampedReference adds a version stamp when you need to detect it."
    }
  ],
  "related": [
    "locks-synchronization",
    "optimistic-vs-pessimistic-locking",
    "race-conditions"
  ]
},
{
  "id": "optimistic-vs-pessimistic-locking",
  "name": "Optimistic vs Pessimistic Locking",
  "summary": "There are two philosophies for protecting shared data. **Pessimistic locking** assumes conflicts will happen and locks the data before touching it. **Optimistic locking** assumes they are rare, works without locks, and detects a conflict at write time using a version number, then retries. Choosing well is one of the most common LLD interview discussions.",
  "sections": [
    {
      "heading": "Two philosophies",
      "text": "Pessimistic: 'Someone else probably wants this row, so I will lock it first and everyone else waits.' You pay the cost of waiting on every request, but you never do wasted work.\n\nOptimistic: 'Probably nobody else is editing this, so I will read it, do my work, and check at the end that it has not changed.' Nobody waits, but when a conflict does happen your work is thrown away and you retry. The CAS loop from the last lesson is optimistic locking inside memory; this lesson applies the same idea to rows in a database."
    },
    {
      "heading": "Optimistic locking with a version column",
      "text": "Add a `version` column that increases on every change. Read the row with its version, and make the write conditional on that version still being current. If the update touches zero rows, someone else changed the row after you read it: re-read and try again.\n\nThe in-memory store below plays the part of the database table, so you can run the logic yourself. JPA/Hibernate does the same thing for you with an `@Version` field.",
      "code": [
        {
          "file": "VersionedRowStore.java",
          "body": "import java.util.HashMap;\nimport java.util.Map;\n\n/** Stands in for a database table with a version column. */\npublic class VersionedRowStore {\n    public record Row(int stock, long version) {}\n\n    private final Map<String, Row> rows = new HashMap<>();\n\n    public VersionedRowStore(String productId, int stock) {\n        rows.put(productId, new Row(stock, 0));\n    }\n\n    /** SELECT stock, version FROM product WHERE id = ? */\n    public synchronized Row read(String productId) {\n        return rows.get(productId);\n    }\n\n    /**\n     * UPDATE product SET stock = ?, version = version + 1 WHERE id = ? AND version = ?\n     * Returns true when exactly one row was updated.\n     */\n    public synchronized boolean update(String productId, int newStock, long expectedVersion) {\n        Row current = rows.get(productId);\n        if (current == null || current.version() != expectedVersion) return false;\n        rows.put(productId, new Row(newStock, expectedVersion + 1));\n        return true;\n    }\n}"
        },
        {
          "file": "OptimisticInventory.java",
          "body": "import java.util.concurrent.atomic.AtomicLong;\n\npublic class OptimisticInventory implements Inventory {\n    private static final int MAX_ATTEMPTS = 20;\n\n    private final VersionedRowStore store;\n    private final String productId;\n    private final AtomicLong conflicts = new AtomicLong();\n\n    public OptimisticInventory(String productId, int stock) {\n        this.productId = productId;\n        this.store = new VersionedRowStore(productId, stock);\n    }\n\n    @Override\n    public boolean addToCart(String userId) {\n        for (int attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {\n            VersionedRowStore.Row row = store.read(productId);        // no lock held while we think\n            if (row.stock() <= 0) return false;\n            if (store.update(productId, row.stock() - 1, row.version())) return true;\n            conflicts.incrementAndGet();                              // lost the race: re-read and retry\n        }\n        throw new IllegalStateException(\"too much contention, giving up\");\n    }\n\n    @Override\n    public int stock() {\n        return store.read(productId).stock();\n    }\n\n    public long conflicts() {\n        return conflicts.get();\n    }\n}"
        },
        {
          "file": "optimistic.sql",
          "body": "ALTER TABLE product ADD COLUMN version BIGINT NOT NULL DEFAULT 0;\n\nSELECT stock, version FROM product WHERE id = 42;     -- stock = 1, version = 7\n\nUPDATE product\n   SET stock = stock - 1, version = version + 1\n WHERE id = 42 AND version = 7;\n-- 1 row updated : we won\n-- 0 rows updated: another buyer changed the row first; re-read and retry"
        }
      ],
      "note": "Retries are bounded (`MAX_ATTEMPTS`), and we count conflicts so the metric shows when optimism stops paying off. Under the `OversellTest` it scored 0 oversold rounds in 3,000."
    },
    {
      "heading": "Pessimistic locking",
      "text": "Pessimistic locking holds a real lock while you work. In a database that means `SELECT ... FOR UPDATE`, which locks the rows it returns until the transaction ends. Everyone else who wants the row waits in line and then sees the up-to-date value. The next lesson covers the exact syntax and its relatives.\n\nIn memory it is simply the `synchronized` or `ReentrantLock` code from lesson 2."
    },
    {
      "heading": "What happens with stock = 1 and 10,000 buyers?",
      "text": "Optimistic: all 10,000 read version 7. One update wins. The other 9,999 get zero rows, re-read, see `stock = 0` and answer 'sold out'. That is cheap, because after the first conflict the answer is immediate.\n\nNow change the numbers: stock of 1,000 and 10,000 buyers. Almost every attempt collides with someone else's successful write, each failure costs a read plus a retry, and the database spends its time on wasted round trips. For hot rows, optimistic locking turns into a retry storm.\n\nPessimistic locking queues the buyers politely: slower for any single request, but no wasted work. And the best option for a plain counter, in the next lesson, is to skip both and let a single conditional UPDATE decide."
    },
    {
      "heading": "Which technique when?",
      "text": "Use this as a decision list. In an interview, naming the trade-off matters more than the name of the technique.",
      "bullets": [
        "One counter, one JVM, tiny update: AtomicInteger CAS or ConcurrentHashMap.compute.",
        "One JVM, an invariant across several fields: synchronized or a per-product ReentrantLock.",
        "State in a database, simple decrement: a conditional UPDATE (`WHERE stock > 0`). Best default.",
        "State in a database, you must read and run business rules before writing, with high contention: SELECT ... FOR UPDATE.",
        "State in a database, low contention, long think time (a user editing a form for minutes): optimistic version column.",
        "One row per unit, seat or driver and any free one will do: FOR UPDATE SKIP LOCKED.",
        "State outside the database, many servers: a distributed lock with fencing, or an atomic Redis counter.",
        "The item must stay yours while the buyer pays: a reservation with an expiry.",
        "Retries or duplicate requests: idempotency keys.",
        "Several products locked in one operation: a global lock order."
      ]
    }
  ],
  "takeaways": [
    "Pessimistic = lock first, wait. Optimistic = check at write time, retry.",
    "Optimistic locking uses a version (or timestamp) in the WHERE clause of the UPDATE.",
    "Optimistic wins on low-contention data and long think times. Pessimistic wins on hot rows.",
    "For a plain stock counter, a single conditional UPDATE beats both."
  ],
  "pitfalls": [
    "Optimistic locking on a hot row: retry storms and wasted database work.",
    "Retrying forever. Bound the retries and surface a clear error.",
    "Forgetting to bump the version on some code path, which silently disables the protection.",
    "Holding a pessimistic lock across user think time (while a person types), which blocks everyone else.",
    "Treating 'update returned zero rows' as an error instead of a normal, expected conflict signal."
  ],
  "interviewQs": [
    {
      "q": "Explain optimistic and pessimistic locking and when you would use each.",
      "a": "Pessimistic locking locks the data before use so concurrent writers wait; it suits high contention and short transactions. Optimistic locking lets everyone read freely and detects conflicts at write time via a version column, retrying on conflict; it suits low contention and long operations because nobody holds locks while thinking."
    },
    {
      "q": "How does a version column prevent a lost update?",
      "a": "Each writer reads the row and its version, then runs UPDATE ... SET ..., version = version + 1 WHERE id = ? AND version = ?. If someone else committed first, the version no longer matches, zero rows are updated, and the writer knows its view was stale. It re-reads and retries instead of overwriting."
    },
    {
      "q": "For the last item in stock with thousands of buyers, which do you choose?",
      "a": "Neither classic option first: use a single conditional UPDATE (set stock = stock - 1 where id = ? and stock > 0) and check the affected row count. The database serialises it, there is no retry storm, and exactly one buyer gets 1 row. If you need to read and apply rules first, SELECT FOR UPDATE; on a hot row, avoid optimistic locking."
    },
    {
      "q": "What is the downside of optimistic locking under high contention?",
      "a": "Most attempts fail and must retry, so you do the read, the logic and the failed write repeatedly. Throughput collapses and latency spikes, and fairness is poor because unlucky requests may starve. Switching to a lock or a single atomic statement fixes it."
    }
  ],
  "related": [
    "atomic-operations-cas",
    "database-locking",
    "locks-synchronization",
    "limited-stock-cart"
  ]
},
{
  "id": "database-locking",
  "name": "Database Locking",
  "summary": "Once the state lives in a database, let the database do the locking: it is shared by every server and already built for this. The tools, in the order you should reach for them, are the conditional UPDATE, row locks (`FOR UPDATE`, `SKIP LOCKED`), unique constraints, and finally isolation levels.",
  "sections": [
    {
      "heading": "Rule one: make the database do the check",
      "text": "The stock = 1 problem has an elegant answer. Do not read the stock into your application at all. Send one statement that checks and decrements together, and look at how many rows it changed.\n\nThe database takes a row lock for the update. If two sessions run it together, the second waits, then re-evaluates `stock > 0` against the committed value (in PostgreSQL and MySQL InnoDB). So exactly one of them changes a row. No retry loop, no version column, no explicit lock in your code.",
      "code": [
        {
          "file": "JdbcInventory.java",
          "body": "import java.sql.Connection;\nimport java.sql.PreparedStatement;\nimport java.sql.ResultSet;\nimport java.sql.SQLException;\nimport javax.sql.DataSource;\n\npublic class JdbcInventory {\n    private final DataSource ds;\n\n    public JdbcInventory(DataSource ds) {\n        this.ds = ds;\n    }\n\n    /** Best default: the check and the decrement are ONE statement, so the database serialises it. */\n    public boolean tryReserve(String productId) throws SQLException {\n        String sql = \"UPDATE product SET stock = stock - 1 WHERE id = ? AND stock > 0\";\n        try (Connection c = ds.getConnection();\n             PreparedStatement ps = c.prepareStatement(sql)) {\n            ps.setString(1, productId);\n            return ps.executeUpdate() == 1;   // 1 row changed = we got the unit, 0 = sold out\n        }\n    }\n\n    /** Pessimistic: lock the row, look at it, then change it. Use when you need to read and decide first. */\n    public boolean tryReserveWithRowLock(String productId) throws SQLException {\n        try (Connection c = ds.getConnection()) {\n            c.setAutoCommit(false);\n            try {\n                int stock;\n                try (PreparedStatement ps = c.prepareStatement(\n                        \"SELECT stock FROM product WHERE id = ? FOR UPDATE\")) {   // other buyers wait here\n                    ps.setString(1, productId);\n                    try (ResultSet rs = ps.executeQuery()) {\n                        if (!rs.next()) { c.rollback(); return false; }\n                        stock = rs.getInt(1);\n                    }\n                }\n                if (stock <= 0) { c.rollback(); return false; }\n                try (PreparedStatement ps = c.prepareStatement(\n                        \"UPDATE product SET stock = stock - 1 WHERE id = ?\")) {\n                    ps.setString(1, productId);\n                    ps.executeUpdate();\n                }\n                c.commit();                                                       // lock released here\n                return true;\n            } catch (SQLException | RuntimeException e) {\n                c.rollback();\n                throw e;\n            }\n        }\n    }\n}"
        },
        {
          "file": "conditional-update.sql",
          "body": "UPDATE product\n   SET stock = stock - 1\n WHERE id = 42\n   AND stock > 0;\n\n-- affected rows = 1 -> you got the last unit\n-- affected rows = 0 -> sold out (or no such product)"
        }
      ],
      "note": "`tryReserve` is the best default. `tryReserveWithRowLock` is the same outcome through an explicit lock, kept in the same class to compare the two."
    },
    {
      "heading": "Rule two: when you must read first, lock first",
      "text": "Sometimes the decision needs more than a number: check the buyer's purchase limit, apply a pricing rule, write an audit row. Now one statement is not enough. `SELECT ... FOR UPDATE` locks the matching rows until your transaction commits or rolls back, so nobody can change them under you.\n\nKeep the transaction short, do the minimum between the SELECT and the COMMIT, and never wait for a person or a network call while holding the lock.",
      "code": [
        {
          "file": "for-update-timeline.sql",
          "body": "-- Session A                                -- Session B\nBEGIN;                                      BEGIN;\nSELECT stock FROM product\n WHERE id = 42 FOR UPDATE;   -- stock = 1\n                                            SELECT stock FROM product\n                                             WHERE id = 42 FOR UPDATE;  -- blocks...\nUPDATE product SET stock = 0\n WHERE id = 42;\nCOMMIT;                                     -- ...unblocks, now sees stock = 0\n                                            ROLLBACK;   -- sold out"
        }
      ]
    },
    {
      "heading": "One row per unit: SKIP LOCKED",
      "text": "Some domains model every physical thing as its own row: serial numbers, seats, parking spots, drivers. A buyer does not care which unit they get, only that it is free. With plain `FOR UPDATE`, buyers queue on the same first row. With `SKIP LOCKED`, each buyer skips rows someone else has locked and takes the next free one, so they all proceed in parallel.\n\nIt is also the standard trick for job queues: many workers, each claiming a different pending task.",
      "code": [
        {
          "file": "UnitClaimer.java",
          "body": "import java.sql.Connection;\nimport java.sql.PreparedStatement;\nimport java.sql.ResultSet;\nimport java.sql.SQLException;\nimport java.util.Optional;\nimport javax.sql.DataSource;\n\n/** When stock is modelled as one row per physical unit (serial numbers, seats, drivers). */\npublic class UnitClaimer {\n    private final DataSource ds;\n\n    public UnitClaimer(DataSource ds) {\n        this.ds = ds;\n    }\n\n    public Optional<Long> claimAnyAvailableUnit(String productId, String userId) throws SQLException {\n        String pick = \"SELECT id FROM inventory_unit \"\n                + \"WHERE product_id = ? AND status = 'AVAILABLE' \"\n                + \"ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED\";   // skip rows other buyers are holding\n        try (Connection c = ds.getConnection()) {\n            c.setAutoCommit(false);\n            try (PreparedStatement ps = c.prepareStatement(pick)) {\n                ps.setString(1, productId);\n                try (ResultSet rs = ps.executeQuery()) {\n                    if (!rs.next()) { c.rollback(); return Optional.empty(); }\n                    long unitId = rs.getLong(1);\n                    try (PreparedStatement up = c.prepareStatement(\n                            \"UPDATE inventory_unit SET status = 'HELD', held_by = ? WHERE id = ?\")) {\n                        up.setString(1, userId);\n                        up.setLong(2, unitId);\n                        up.executeUpdate();\n                    }\n                    c.commit();\n                    return Optional.of(unitId);\n                }\n            } catch (SQLException | RuntimeException e) {\n                c.rollback();\n                throw e;\n            }\n        }\n    }\n}"
        },
        {
          "file": "unit-table.sql",
          "body": "CREATE TABLE inventory_unit (\n  id         BIGSERIAL PRIMARY KEY,\n  product_id TEXT   NOT NULL,\n  status     TEXT   NOT NULL DEFAULT 'AVAILABLE',   -- AVAILABLE | HELD | SOLD\n  held_by    TEXT\n);\nCREATE INDEX ON inventory_unit (product_id, status, id);\n\n-- NOWAIT is the sibling option: fail immediately instead of waiting\nSELECT id FROM inventory_unit\n WHERE product_id = 'ps5' AND status = 'AVAILABLE'\n ORDER BY id LIMIT 1\n FOR UPDATE SKIP LOCKED;"
        }
      ]
    },
    {
      "heading": "Unique constraints are locks you cannot forget",
      "text": "For 'only one person can have this seat for this show', the strongest guard is not in your code at all: a unique constraint. Both buyers try to INSERT the claim. The database lets exactly one succeed and rejects the other, with no check-then-act gap, because the check is the insert.\n\nThis is also your safety net behind any lock: if a bug lets two requests through, the constraint still stops the double booking.",
      "code": [
        {
          "file": "SeatClaimer.java",
          "body": "import java.sql.Connection;\nimport java.sql.PreparedStatement;\nimport java.sql.SQLException;\nimport javax.sql.DataSource;\n\n/** A unique constraint is a lock the database enforces for you: UNIQUE (show_id, seat_id). */\npublic class SeatClaimer {\n    private final DataSource ds;\n\n    public SeatClaimer(DataSource ds) {\n        this.ds = ds;\n    }\n\n    public boolean claim(long showId, long seatId, String userId) throws SQLException {\n        String sql = \"INSERT INTO seat_claim (show_id, seat_id, user_id) VALUES (?, ?, ?)\";\n        try (Connection c = ds.getConnection();\n             PreparedStatement ps = c.prepareStatement(sql)) {\n            ps.setLong(1, showId);\n            ps.setLong(2, seatId);\n            ps.setString(3, userId);\n            ps.executeUpdate();\n            return true;\n        } catch (SQLException e) {\n            if (e.getSQLState() != null && e.getSQLState().startsWith(\"23\")) {\n                return false;   // integrity violation: someone else already holds this seat\n            }\n            throw e;\n        }\n    }\n}"
        },
        {
          "file": "seat-claim.sql",
          "body": "CREATE TABLE seat_claim (\n  show_id  BIGINT NOT NULL,\n  seat_id  BIGINT NOT NULL,\n  user_id  TEXT   NOT NULL,\n  UNIQUE (show_id, seat_id)          -- the second INSERT fails with SQLSTATE 23505\n);"
        }
      ]
    },
    {
      "heading": "Isolation levels in one minute",
      "text": "Isolation controls what a transaction can see while others run. You rarely need to change the default if the correctness lives in single statements, row locks and constraints.",
      "bullets": [
        "READ COMMITTED (default in PostgreSQL): each statement sees only committed data. A separate SELECT then UPDATE can still race, which is why the conditional UPDATE matters.",
        "REPEATABLE READ (default in MySQL InnoDB): a snapshot for the whole transaction. A decision made from the snapshot can be stale, so keep conditions inside the UPDATE. PostgreSQL aborts a transaction that tries to update a row changed since its snapshot.",
        "SERIALIZABLE: behaves as if transactions ran one at a time, and aborts conflicting ones with SQLSTATE 40001. Safest, but you must catch the error and retry the whole transaction.",
        "Write skew: two transactions each read overlapping rows, each write different rows, and together break a rule (two doctors both going off call). Only SERIALIZABLE, or an explicit lock on a shared row, prevents it.",
        "Rule of thumb: keep the default isolation, put the guard in one statement or a lock, and add a unique constraint as a backstop."
      ]
    }
  ],
  "takeaways": [
    "Default answer for the last unit: `UPDATE ... SET stock = stock - 1 WHERE id = ? AND stock > 0`, then check the row count.",
    "Use SELECT FOR UPDATE when you must read and apply logic before writing, and keep that transaction short.",
    "SKIP LOCKED lets many workers each claim a different row without queueing.",
    "A unique constraint is the strongest and simplest guard against double booking.",
    "Do not rely on a higher isolation level to fix a check-then-act you split into two statements."
  ],
  "pitfalls": [
    "SELECT the stock, decide in Java, then UPDATE in a second statement with no lock: the same race, now across servers.",
    "Long transactions that hold row locks while calling external services.",
    "Locking rows in different orders in different code paths, which creates database deadlocks (lesson 9).",
    "Not handling the retry for SERIALIZABLE or deadlock errors.",
    "Forgetting that no locking exists on a missing row, so use a unique constraint when the thing you guard may not exist yet."
  ],
  "interviewQs": [
    {
      "q": "How do you prevent overselling the last item using only the database?",
      "a": "Run a single conditional UPDATE: set stock = stock - 1 where id = ? and stock > 0, and treat affected rows = 1 as success and 0 as sold out. The row lock makes concurrent updates run one after another, and each re-evaluates the condition, so exactly one buyer wins."
    },
    {
      "q": "What does SELECT ... FOR UPDATE do, and what are its risks?",
      "a": "It locks the selected rows until the transaction ends, so other transactions that try to update or lock them wait. Risks: lower throughput on hot rows, long waits if the transaction is slow, and deadlocks if rows are locked in inconsistent order. Keep the transaction short and lock in a consistent order."
    },
    {
      "q": "When would you use SKIP LOCKED?",
      "a": "When many workers take items from a pool and any available item will do: job queues, assigning a free driver, seat or serial number. Each worker skips rows already locked by others instead of waiting, so they proceed in parallel."
    },
    {
      "q": "Does SERIALIZABLE isolation solve double booking?",
      "a": "It can, because the database detects conflicting concurrent transactions and aborts one with a serialization failure. But the application must catch that error and retry, throughput drops under contention, and a unique constraint or conditional UPDATE solves the same problem more simply."
    }
  ],
  "related": [
    "optimistic-vs-pessimistic-locking",
    "race-conditions",
    "reservation-with-ttl",
    "deadlock-and-lock-ordering",
    "movie-ticket-booking"
  ]
},
{
  "id": "distributed-locks",
  "name": "Distributed Locks",
  "summary": "When the data is not in one database transaction (a cache, an external API, work spread over many servers) you need a lock that lives outside any one process. Redis `SET key token NX PX ttl` is the usual tool. But locks expire, processes pause, and a lock alone is never a guarantee, so correct systems add fencing tokens, a conditional write, or skip the lock with an atomic counter.",
  "sections": [
    {
      "heading": "Why a JVM lock is not enough",
      "text": "Five application servers each run `synchronized`. Each has its own monitor, so five buyers can pass the check at the same moment. The lock has to live somewhere all five can see: a database row, ZooKeeper or etcd, or Redis.\n\nA distributed lock has three requirements that a local lock gets for free. **Mutual exclusion**: at most one holder. **Deadlock freedom**: a crashed holder must not keep the lock forever, so every lock needs an expiry (TTL). **Safe release**: you may only release a lock you still own."
    },
    {
      "heading": "Redis SET NX PX and the Lua unlock",
      "text": "`SET key value NX PX 5000` sets the key only if it does not exist (`NX`) and gives it a 5 second expiry (`PX`), in one atomic command. The value is a random token that identifies the holder.\n\nUnlocking needs care. A plain `DEL` could delete a lock that expired and was taken by someone else. So we delete only if the stored value is still our token, and that check and delete must be atomic, which is what the Lua script does.",
      "code": [
        {
          "file": "commands.redis",
          "body": "SET lock:product:42 7f3c9a10-token NX PX 5000\n-> OK        you hold the lock for at most 5 seconds\n-> (nil)     someone else holds it; wait and retry"
        },
        {
          "file": "unlock.lua",
          "body": "-- KEYS[1] = lock key, ARGV[1] = our token\nif redis.call('get', KEYS[1]) == ARGV[1] then\n  return redis.call('del', KEYS[1])\nelse\n  return 0\nend"
        },
        {
          "file": "RedisOps.java",
          "body": "import java.util.List;\n\n/** The three Redis operations we need, so the code below does not depend on a specific client. */\npublic interface RedisOps {\n    /** SET key value NX PX ttlMillis. True only if the key did not exist. */\n    boolean setIfAbsent(String key, String value, long ttlMillis);\n\n    /** EVAL script numKeys keys... args... */\n    long eval(String luaScript, List<String> keys, List<String> args);\n\n    /** INCR key. Returns the new value. */\n    long incr(String key);\n}"
        },
        {
          "file": "RedisLock.java",
          "body": "import java.util.List;\nimport java.util.UUID;\n\npublic class RedisLock {\n    // Delete the key only if it still holds OUR token. Check and delete must be one atomic step.\n    private static final String UNLOCK_LUA =\n            \"if redis.call('get', KEYS[1]) == ARGV[1] then \"\n          + \"  return redis.call('del', KEYS[1]) \"\n          + \"else return 0 end\";\n\n    private final RedisOps redis;\n    private final String key;\n    private final long ttlMillis;\n    private final String token = UUID.randomUUID().toString();   // identifies this holder\n\n    public RedisLock(RedisOps redis, String key, long ttlMillis) {\n        this.redis = redis;\n        this.key = key;\n        this.ttlMillis = ttlMillis;\n    }\n\n    public boolean tryLock() {\n        return redis.setIfAbsent(key, token, ttlMillis);\n    }\n\n    public boolean tryLock(long waitMillis) throws InterruptedException {\n        long deadline = System.nanoTime() + waitMillis * 1_000_000L;\n        long backoff = 5;\n        while (System.nanoTime() < deadline) {\n            if (tryLock()) return true;\n            Thread.sleep(backoff);\n            backoff = Math.min(backoff * 2, 50);\n        }\n        return false;\n    }\n\n    public void unlock() {\n        redis.eval(UNLOCK_LUA, List.of(key), List.of(token));   // never a blind DEL\n    }\n}"
        }
      ],
      "note": "`tryLock(waitMillis)` retries with a short, growing sleep instead of hammering Redis. We checked this class against an in-memory fake: with 8 racing buyers exactly one gets the item, and an unlock from an expired holder does not free the new holder's lock."
    },
    {
      "heading": "Using it: lock, then a conditional write",
      "text": "Wrap the critical section in the lock, and inside it still use the safe database statement. The lock is there to reduce contention and serialise multi-step work. The conditional UPDATE is what actually guarantees correctness, because of what happens next.",
      "code": [
        {
          "file": "CartService.java",
          "body": "public class CartService {\n    private final RedisOps redis;\n    private final StockRepository stock;\n\n    public CartService(RedisOps redis, StockRepository stock) {\n        this.redis = redis;\n        this.stock = stock;\n    }\n\n    public boolean addToCart(String productId, String userId) throws InterruptedException {\n        RedisLock lock = new RedisLock(redis, \"lock:product:\" + productId, 5_000);\n        if (!lock.tryLock(300)) {\n            throw new IllegalStateException(\"busy, please retry\");\n        }\n        try {\n            // The lock reduces contention. The conditional UPDATE is the real guarantee.\n            return stock.decrementIfAvailable(productId);\n        } finally {\n            lock.unlock();\n        }\n    }\n}"
        },
        {
          "file": "StockRepository.java",
          "body": "public interface StockRepository {\n    /** UPDATE product SET stock = stock - 1 WHERE id = ? AND stock > 0, true if one row changed. */\n    boolean decrementIfAvailable(String productId);\n}"
        }
      ]
    },
    {
      "heading": "Locks expire: fencing tokens",
      "text": "Here is the nasty case. Server A takes the lock (5 second TTL). A long garbage-collection pause, or a slow network call, freezes it for 6 seconds. The lock expires, server B takes it and decrements stock. Server A wakes up, still believing it holds the lock, and decrements too. Mutual exclusion is broken, and A could not have known.\n\nThe fix lives in the protected resource. Every time a lock is granted, issue a number that only grows (an `INCR`). The holder sends that **fencing token** with every write, and the resource rejects any write whose token is older than one it has already seen. A's stale token is refused.",
      "code": [
        {
          "file": "FencedStock.java",
          "body": "/** The protected resource rejects holders whose lock has already been superseded. */\npublic class FencedStock {\n    private int stock;\n    private long highestTokenSeen = -1;\n\n    public FencedStock(int stock) {\n        this.stock = stock;\n    }\n\n    public synchronized boolean decrement(long fencingToken) {\n        if (fencingToken < highestTokenSeen) {\n            return false;                 // stale holder: its lock expired and someone newer already acted\n        }\n        highestTokenSeen = fencingToken;\n        if (stock <= 0) return false;\n        stock--;\n        return true;\n    }\n\n    public synchronized int stock() {\n        return stock;\n    }\n}"
        },
        {
          "file": "fencing.redis",
          "body": "INCR fence:product:42      -> 17   (issued to the holder of this lock)\n-- the holder sends 17 with each write; the resource rejects anything below\n-- the highest token it has already accepted"
        }
      ]
    },
    {
      "heading": "Often, skip the lock: an atomic Redis counter",
      "text": "If the only thing you protect is a number, you do not need a lock at all. Keep the flash-sale stock in Redis and decrement it with a small Lua script. Redis runs scripts one at a time, so the check and the decrement are atomic, with no lock to expire.\n\nWhen to choose what:",
      "code": [
        {
          "file": "stock.lua",
          "body": "-- KEYS[1] = stock:product:42\nlocal stock = tonumber(redis.call('get', KEYS[1]))\nif stock and stock > 0 then\n  return redis.call('decr', KEYS[1])   -- new stock value, 0 or more\nelse\n  return -1                            -- sold out\nend"
        }
      ],
      "bullets": [
        "Stock lives in your SQL database: conditional UPDATE. No distributed lock needed.",
        "Hot flash sale, a counter in Redis: the Lua decrement. Fast, and later reconcile with the database.",
        "A multi-step critical section across services (not just a number): Redis lock plus fencing tokens, or a coordination service such as ZooKeeper or etcd.",
        "Single Redis node or replica failover can hand the same lock to two holders (the failed-over replica may not have the key). For strict correctness add fencing and a conditional write.",
        "Always set a TTL, always release with the token check, never assume you still hold a lock after a pause."
      ]
    }
  ],
  "takeaways": [
    "A distributed lock needs mutual exclusion, an expiry, and token-checked release.",
    "Acquire with `SET key token NX PX ttl`. Release with a Lua compare-and-delete, never a blind DEL.",
    "Locks can expire while the holder is paused. Protect the resource with a fencing token or a conditional write.",
    "If all you guard is a counter, an atomic Lua decrement is simpler and safer than any lock."
  ],
  "pitfalls": [
    "Locks without a TTL: one crashed server blocks the product forever.",
    "Unlocking with plain DEL, releasing someone else's lock.",
    "A TTL shorter than the work, with no fencing and no conditional write behind it.",
    "Locking a coarse key like `lock:inventory` and serialising the whole shop.",
    "Treating Redis as infallible: it can fail over, so design as if the lock can occasionally be granted twice."
  ],
  "interviewQs": [
    {
      "q": "How do you implement a distributed lock with Redis?",
      "a": "Acquire with SET key randomToken NX PX ttl, which is atomic, retrying with backoff until a deadline. Release with a Lua script that deletes the key only if its value equals your token. Always set a TTL so a crashed holder cannot block others."
    },
    {
      "q": "Why must the value be a random token, and why a Lua script to unlock?",
      "a": "If the lock expires and another client acquires it, a plain DEL from the first client would delete the second client's lock. The token identifies the owner, and the get-compare-delete must be atomic, otherwise the lock could change between the check and the delete. A Lua script runs atomically in Redis."
    },
    {
      "q": "What can go wrong with a lock that expires, and how do you fix it?",
      "a": "A holder that is paused (GC, network) can outlive its TTL, another client gets the lock, and then both act. Use fencing tokens: a monotonically increasing number issued with each lock grant that the protected resource checks, rejecting stale ones. Or make the final write conditional (version check or WHERE stock > 0) so correctness does not depend on the lock."
    },
    {
      "q": "Would you use a distributed lock to protect stock in a database?",
      "a": "Usually not. A conditional UPDATE or SELECT FOR UPDATE already serialises access where the data lives and cannot expire. I would add a Redis lock only for multi-step work across systems, and even then keep the conditional write as the final guard."
    }
  ],
  "related": [
    "locks-synchronization",
    "database-locking",
    "reservation-with-ttl",
    "movie-ticket-booking",
    "limited-stock-cart"
  ]
},
{
  "id": "reservation-with-ttl",
  "name": "Reservation / Hold with Expiry",
  "summary": "Locks protect a moment; a reservation protects a *process*. The buyer needs the last PlayStation to stay theirs while they type card details, which takes minutes, far too long to hold a lock. So we move the unit out of 'available' into a time-limited **hold**, then either confirm it when payment succeeds or let it expire back to the shelf.",
  "sections": [
    {
      "heading": "When does the item become yours?",
      "text": "This is a product decision before it is an engineering one, and interviewers like candidates who ask it.",
      "bullets": [
        "At add-to-cart: the unit is held as soon as it lands in the cart. Fair for flash sales, but abandoned carts lock stock away, so use a short TTL (5 to 10 minutes).",
        "At checkout start: the common choice. Browsing and carts are free, and a hold starts only when the buyer begins paying.",
        "At payment success: no hold at all. Simple, but two buyers can both pay for the last unit and one gets a refund. Acceptable only for low-value items.",
        "Whatever you choose, the hold needs an expiry, a way to confirm, and a way to release."
      ]
    },
    {
      "heading": "The model: available, held, sold",
      "text": "Split stock into three buckets. A unit is always in exactly one of them, so `available + held + sold = total`. That invariant is easy to assert in tests and impossible to violate if every transition happens atomically.\n\nA reservation moves through a tiny state machine: **HELD** to **CONFIRMED** (paid), **RELEASED** (buyer cancelled) or **EXPIRED** (time ran out). Only HELD can transition, which also makes confirm and release safe to call twice.",
      "code": [
        {
          "file": "ReservationService.java",
          "body": "import java.time.Clock;\nimport java.time.Duration;\nimport java.time.Instant;\nimport java.util.HashMap;\nimport java.util.Map;\nimport java.util.Optional;\nimport java.util.UUID;\n\npublic class ReservationService {\n    public enum Status { HELD, CONFIRMED, RELEASED, EXPIRED }\n\n    public static final class Reservation {\n        public final String id = UUID.randomUUID().toString().substring(0, 8);\n        public final String productId;\n        public final String userId;\n        public final int quantity;\n        public final Instant expiresAt;\n        private Status status = Status.HELD;\n\n        Reservation(String productId, String userId, int quantity, Instant expiresAt) {\n            this.productId = productId;\n            this.userId = userId;\n            this.quantity = quantity;\n            this.expiresAt = expiresAt;\n        }\n\n        public Status status() { return status; }\n    }\n\n    private final Clock clock;\n    private final Duration holdFor;\n    private final Map<String, Integer> available = new HashMap<>();\n    private final Map<String, Integer> sold = new HashMap<>();\n    private final Map<String, Reservation> reservations = new HashMap<>();\n\n    public ReservationService(Clock clock, Duration holdFor, Map<String, Integer> initialStock) {\n        this.clock = clock;\n        this.holdFor = holdFor;\n        this.available.putAll(initialStock);\n    }\n\n    /** Takes units out of \"available\" and parks them in a HELD reservation. */\n    public synchronized Optional<Reservation> reserve(String productId, String userId, int quantity) {\n        sweepExpired();                                   // lazy expiry: never trust stale holds\n        int free = available.getOrDefault(productId, 0);\n        if (free < quantity) return Optional.empty();\n        available.put(productId, free - quantity);\n        Reservation r = new Reservation(productId, userId, quantity, clock.instant().plus(holdFor));\n        reservations.put(r.id, r);\n        return Optional.of(r);\n    }\n\n    /** Called after payment succeeds. Only a live HELD reservation can be confirmed. */\n    public synchronized boolean confirm(String reservationId) {\n        sweepExpired();\n        Reservation r = reservations.get(reservationId);\n        if (r == null || r.status != Status.HELD) return false;   // expired, released or already confirmed\n        r.status = Status.CONFIRMED;\n        sold.merge(r.productId, r.quantity, Integer::sum);\n        return true;\n    }\n\n    /** Called when the user abandons the cart or payment fails. */\n    public synchronized boolean release(String reservationId) {\n        Reservation r = reservations.get(reservationId);\n        if (r == null || r.status != Status.HELD) return false;\n        r.status = Status.RELEASED;\n        available.merge(r.productId, r.quantity, Integer::sum);\n        return true;\n    }\n\n    /** Returns units from expired holds to the pool. Also run on a timer. */\n    public synchronized int sweepExpired() {\n        Instant now = clock.instant();\n        int expired = 0;\n        for (Reservation r : reservations.values()) {\n            if (r.status == Status.HELD && !now.isBefore(r.expiresAt)) {\n                r.status = Status.EXPIRED;\n                available.merge(r.productId, r.quantity, Integer::sum);\n                expired++;\n            }\n        }\n        return expired;\n    }\n\n    public synchronized int available(String productId) {\n        return available.getOrDefault(productId, 0);\n    }\n\n    public synchronized int held(String productId) {\n        return reservations.values().stream()\n                .filter(r -> r.productId.equals(productId) && r.status == Status.HELD)\n                .mapToInt(r -> r.quantity).sum();\n    }\n\n    public synchronized int sold(String productId) {\n        return sold.getOrDefault(productId, 0);\n    }\n}"
        }
      ],
      "note": "The whole service is one synchronized object to keep the logic readable. In a real system the per-product lock, a conditional UPDATE, or a Redis key plays the same role (see the SQL tab below)."
    },
    {
      "heading": "Expiry: lazy plus a sweeper",
      "text": "Expired holds must return to the pool. Do it two ways. **Lazily**: every `reserve` and `confirm` first sweeps expired holds, so a stale hold can never block or be confirmed. **On a timer**: a background sweeper returns stock even if nobody is asking, so dashboards and 'only 1 left' counters stay honest.\n\nThe lazy path is the correctness mechanism; the sweeper is housekeeping. We inject a `Clock` so tests can move time forward without sleeping.",
      "code": [
        {
          "file": "ReservationSweeper.java",
          "body": "import java.util.concurrent.Executors;\nimport java.util.concurrent.ScheduledExecutorService;\nimport java.util.concurrent.TimeUnit;\n\n/** Background safety net: even if nobody asks for the item, expired holds go back on the shelf. */\npublic class ReservationSweeper implements AutoCloseable {\n    private final ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor();\n\n    public ReservationSweeper(ReservationService service, long periodSeconds) {\n        scheduler.scheduleAtFixedRate(service::sweepExpired, periodSeconds, periodSeconds, TimeUnit.SECONDS);\n    }\n\n    @Override\n    public void close() {\n        scheduler.shutdownNow();\n    }\n}"
        },
        {
          "file": "MutableClock.java",
          "body": "import java.time.Clock;\nimport java.time.Duration;\nimport java.time.Instant;\nimport java.time.ZoneId;\nimport java.time.ZoneOffset;\n\n/** A clock tests can move forward, so we never need Thread.sleep. */\npublic class MutableClock extends Clock {\n    private Instant now = Instant.parse(\"2026-01-01T10:00:00Z\");\n\n    public void advance(Duration d) { now = now.plus(d); }\n\n    @Override public ZoneId getZone() { return ZoneOffset.UTC; }\n    @Override public Clock withZone(ZoneId zone) { return this; }\n    @Override public Instant instant() { return now; }\n}"
        }
      ]
    },
    {
      "heading": "Walk-through with stock = 1",
      "text": "Alice grabs the last unit. Bob is told it is unavailable, which is correct, because it is on hold, not sold. Alice walks away without paying. After 11 minutes her hold has expired, her late confirm is rejected, and Bob can now buy the unit. Bob pays, and the last line shows the unit sold.\n\nThe output below is the real output of this program.",
      "code": [
        {
          "file": "ReservationDemo.java",
          "body": "import java.time.Duration;\nimport java.util.Map;\nimport java.util.Optional;\n\npublic class ReservationDemo {\n    public static void main(String[] args) {\n        MutableClock clock = new MutableClock();\n        ReservationService svc = new ReservationService(clock, Duration.ofMinutes(10), Map.of(\"ps5\", 1));\n\n        Optional<ReservationService.Reservation> alice = svc.reserve(\"ps5\", \"alice\", 1);\n        Optional<ReservationService.Reservation> bob = svc.reserve(\"ps5\", \"bob\", 1);\n        System.out.println(\"alice reserved: \" + alice.isPresent());\n        System.out.println(\"bob reserved:   \" + bob.isPresent() + \"   (the last unit is on hold)\");\n        print(svc);\n\n        clock.advance(Duration.ofMinutes(11));\n        System.out.println(\"-- 11 minutes later, alice never paid --\");\n        System.out.println(\"alice confirm:  \" + svc.confirm(alice.get().id));\n        Optional<ReservationService.Reservation> bob2 = svc.reserve(\"ps5\", \"bob\", 1);\n        System.out.println(\"bob retries:    \" + bob2.isPresent());\n        print(svc);\n\n        System.out.println(\"bob pays and confirms: \" + svc.confirm(bob2.get().id));\n        print(svc);\n    }\n\n    static void print(ReservationService svc) {\n        System.out.println(\"   available=\" + svc.available(\"ps5\") + \" held=\" + svc.held(\"ps5\")\n                + \" sold=\" + svc.sold(\"ps5\") + \"  (total always 1)\");\n    }\n}"
        },
        {
          "file": "output.txt",
          "body": "alice reserved: true\nbob reserved:   false   (the last unit is on hold)\n   available=0 held=1 sold=0  (total always 1)\n-- 11 minutes later, alice never paid --\nalice confirm:  false\nbob retries:    true\n   available=0 held=1 sold=0  (total always 1)\nbob pays and confirms: true\n   available=0 held=0 sold=1  (total always 1)"
        }
      ],
      "note": "We also ran 1,000 rounds of 8 racing buyers against this service: exactly one reservation per round, and the three buckets always add up to 1."
    },
    {
      "heading": "In a database or in Redis",
      "text": "In SQL, the hold is a row, and every transition is a conditional UPDATE so that confirm and the sweeper can never both win. The `WHERE status = 'HELD' AND expires_at > now()` clause is what makes confirm-after-expiry fail.\n\nIn Redis, a hold can be a key with an expiry. Redis removes it for you when time runs out, and you restore the stock counter in a sweeper or from the expiry notification (notifications can be missed, so keep a periodic reconciliation too).",
      "code": [
        {
          "file": "reservation.sql",
          "body": "CREATE TABLE reservation (\n  id         UUID PRIMARY KEY,\n  product_id BIGINT NOT NULL,\n  user_id    TEXT   NOT NULL,\n  qty        INT    NOT NULL,\n  status     TEXT   NOT NULL,          -- HELD | CONFIRMED | RELEASED | EXPIRED\n  expires_at TIMESTAMPTZ NOT NULL\n);\n\n-- 1. reserve: one transaction\nBEGIN;\nUPDATE product SET stock = stock - 1 WHERE id = 42 AND stock > 0;   -- must affect 1 row\nINSERT INTO reservation (id, product_id, user_id, qty, status, expires_at)\nVALUES (gen_random_uuid(), 42, 'alice', 1, 'HELD', now() + interval '10 minutes');\nCOMMIT;\n\n-- 2. confirm after payment: fails if it expired or was released\nUPDATE reservation SET status = 'CONFIRMED'\n WHERE id = $1 AND status = 'HELD' AND expires_at > now();      -- 1 row = confirmed\n\n-- 3. sweeper (every few seconds): expire holds and return the stock\nWITH expired AS (\n  UPDATE reservation SET status = 'EXPIRED'\n   WHERE status = 'HELD' AND expires_at <= now()\n  RETURNING product_id, qty\n)\nUPDATE product p SET stock = p.stock + e.total\n  FROM (SELECT product_id, SUM(qty) AS total FROM expired GROUP BY product_id) e\n WHERE p.id = e.product_id;"
        },
        {
          "file": "redis-hold.redis",
          "body": "-- hold the unit for this user for 10 minutes\nSET hold:product:42:alice 1 NX EX 600\n\n-- stock counter lives next to it; reserve = atomic Lua decrement (see Distributed Locks)\n-- release / expiry: INCR stock:product:42 from the sweeper"
        }
      ]
    }
  ],
  "takeaways": [
    "A hold protects the unit across a slow process like payment, which a lock cannot do.",
    "Model stock as available, held and sold, and keep available + held + sold = total.",
    "Only a live HELD reservation can be confirmed. The status check and expiry check make late confirms fail.",
    "Expire lazily inside every operation for correctness, and with a sweeper for tidiness."
  ],
  "pitfalls": [
    "A hold with no expiry: abandoned carts lock stock forever.",
    "Confirming without re-checking that the hold is still live.",
    "Relying only on a background sweeper: a hold can be 'expired' in time but still look held until the sweeper runs.",
    "Releasing stock twice (sweeper and cancel both returning the same unit). Guard with the status transition.",
    "Making the TTL too long for scarce items, or too short for slow payment methods like bank redirects."
  ],
  "interviewQs": [
    {
      "q": "Why not just lock the row while the user pays?",
      "a": "Payment takes minutes and depends on a human and an external gateway. A lock held that long blocks everyone, and a lock does not survive a server crash or restart. A reservation records the claim as data with an expiry, so nobody waits, and it survives failures."
    },
    {
      "q": "How do you handle a user who takes too long to pay?",
      "a": "The hold has an expiry. When it passes, the sweeper (and every reserve or confirm, lazily) moves the unit back to available and marks the reservation EXPIRED. If the user pays late, confirm sees status is not HELD or expires_at has passed, rejects it, and the payment is refunded or never captured."
    },
    {
      "q": "What happens if confirm and the expiry sweeper run at the same time?",
      "a": "Both are conditional state transitions on the same row, for example UPDATE ... WHERE status = 'HELD'. The database serialises them, one changes the row, and the other updates zero rows and backs off, so a hold ends up either confirmed or expired, never both."
    },
    {
      "q": "Should adding to cart reserve stock?",
      "a": "It depends on the product. For flash sales and one-of-a-kind items, a short hold at add-to-cart is fair. For normal catalogues, hold at checkout start, because most carts are abandoned. State the trade-off: earlier holds are fairer to the buyer but lock up stock."
    }
  ],
  "related": [
    "database-locking",
    "distributed-locks",
    "idempotency",
    "limited-stock-cart",
    "movie-ticket-booking",
    "concert-ticket-booking"
  ]
},
{
  "id": "idempotency",
  "name": "Idempotency & Safe Retries",
  "summary": "Locks stop two *different* buyers colliding. Idempotency handles the other half of reality: the *same* request arriving twice. Double clicks, mobile retries after a timeout and at-least-once message queues all deliver duplicates. An idempotent operation produces the same result no matter how many times it is applied, so duplicates become harmless.",
  "sections": [
    {
      "heading": "Why duplicates happen",
      "text": "Networks fail in the middle. The client sent 'place order', the server did it, but the response was lost, so the client retries. From the server's side that is a second order for the same intent.",
      "bullets": [
        "The user double-clicks Pay, or taps again because the spinner took too long.",
        "A mobile client or HTTP library retries after a timeout.",
        "A load balancer or API gateway retries a request that it thinks failed.",
        "A message queue delivers at least once, so a consumer can see the same event twice.",
        "A payment provider's webhook is sent again until you acknowledge it."
      ],
      "note": "A lock does not help here. The two requests may run seconds apart, long after the first has released its lock. Both are 'valid', so you need to recognise them as the same request."
    },
    {
      "heading": "Idempotency keys",
      "text": "The client generates a unique key (a UUID) once per user intent and sends it with every attempt. The server remembers the result for each key. The first request does the work and stores the answer; any later request with the same key returns the stored answer without doing the work again.\n\nIn the code, `putIfAbsent` decides who is first atomically. A concurrent duplicate does not run the order a second time; it waits for the first attempt to finish and receives the same result. If the first attempt fails, we forget the key so a retry can try again.",
      "code": [
        {
          "file": "IdempotentCheckout.java",
          "body": "import java.util.concurrent.CompletableFuture;\nimport java.util.concurrent.ConcurrentHashMap;\nimport java.util.function.Supplier;\n\npublic class IdempotentCheckout {\n    public record OrderResult(String orderId, String status) {}\n\n    private final ConcurrentHashMap<String, CompletableFuture<OrderResult>> seen = new ConcurrentHashMap<>();\n\n    /**\n     * Runs placeOrder at most once per idempotency key. Duplicates, even concurrent ones,\n     * wait for the first attempt and get the same answer back.\n     */\n    public OrderResult checkout(String idempotencyKey, Supplier<OrderResult> placeOrder) {\n        CompletableFuture<OrderResult> mine = new CompletableFuture<>();\n        CompletableFuture<OrderResult> existing = seen.putIfAbsent(idempotencyKey, mine);\n        if (existing != null) {\n            return existing.join();                       // a duplicate: replay the stored result\n        }\n        try {\n            OrderResult result = placeOrder.get();        // the real work, executed once\n            mine.complete(result);\n            return result;\n        } catch (RuntimeException e) {\n            seen.remove(idempotencyKey, mine);            // failed attempts may be retried\n            mine.completeExceptionally(e);\n            throw e;\n        }\n    }\n}"
        },
        {
          "file": "IdempotencyDemo.java",
          "body": "import java.util.concurrent.*;\nimport java.util.concurrent.atomic.AtomicInteger;\n\npublic class IdempotencyDemo {\n    public static void main(String[] args) throws Exception {\n        IdempotentCheckout checkout = new IdempotentCheckout();\n        AtomicInteger ordersCreated = new AtomicInteger();\n        ExecutorService pool = Executors.newFixedThreadPool(5);\n        CountDownLatch go = new CountDownLatch(1);\n\n        // Five identical requests: a double click plus three client retries.\n        Future<?>[] calls = new Future<?>[5];\n        for (int i = 0; i < 5; i++) {\n            calls[i] = pool.submit(() -> {\n                go.await();\n                IdempotentCheckout.OrderResult r = checkout.checkout(\"key-9f3a\", () -> {\n                    int n = ordersCreated.incrementAndGet();\n                    return new IdempotentCheckout.OrderResult(\"order-\" + n, \"PAID\");\n                });\n                System.out.println(\"client got \" + r.orderId() + \" \" + r.status());\n                return null;\n            });\n        }\n        go.countDown();\n        for (Future<?> f : calls) f.get();\n        pool.shutdown();\n        System.out.println(\"orders actually created: \" + ordersCreated.get());\n    }\n}"
        },
        {
          "file": "output.txt",
          "body": "client got order-1 PAID\nclient got order-1 PAID\nclient got order-1 PAID\nclient got order-1 PAID\nclient got order-1 PAID\norders actually created: 1"
        }
      ],
      "note": "Five identical requests (a double click plus retries) raced. Five clients got the same `order-1`, and exactly one order was created. That output is the real run."
    },
    {
      "heading": "In a database: insert first",
      "text": "In production the key store must be durable and shared, so it lives in the database (or Redis with a TTL). The trick is to **insert the key before doing the work**. The primary key makes the insert the atomic 'first or duplicate' decision, the same unique-constraint idea as in the database locking lesson.\n\nAlso store a hash of the request body. If the same key arrives with a different payload, it is a client bug: reject it instead of returning an answer for a different request.",
      "code": [
        {
          "file": "idempotency.sql",
          "body": "CREATE TABLE idempotency_key (\n  key          TEXT PRIMARY KEY,\n  request_hash TEXT NOT NULL,\n  response     JSONB,                 -- filled in when the work finishes\n  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()\n);\n\nINSERT INTO idempotency_key (key, request_hash)\nVALUES ('9f3a-...', 'sha256-of-body')\nON CONFLICT (key) DO NOTHING;\n-- 1 row inserted : first time, do the work, then UPDATE ... SET response = ...\n-- 0 rows inserted: duplicate. Return the stored response (or 409 while still in progress,\n--                  or 422 if request_hash differs)"
        }
      ]
    },
    {
      "heading": "Make operations naturally idempotent",
      "text": "The best idempotency needs no key store, because the operation is safe to repeat by design.",
      "code": [
        {
          "file": "OrderStatus.java",
          "body": "/** Guarded transitions make \"confirm\" safe to repeat: the second call changes nothing. */\npublic enum OrderStatus {\n    HELD, PAID, CANCELLED;\n\n    public boolean canMoveTo(OrderStatus next) {\n        return this == HELD && (next == PAID || next == CANCELLED);\n    }\n}"
        }
      ],
      "bullets": [
        "Set, do not increment: 'set status = PAID' is idempotent, 'add 1 to sold' is not.",
        "Guarded transitions: `UPDATE orders SET status = 'PAID' WHERE id = ? AND status = 'HELD'`. Repeating it changes zero rows and does no harm.",
        "Natural business keys: a unique constraint on (order_id, line_no) or on a payment reference makes a duplicate insert fail.",
        "Pass the order id to the payment provider as its own idempotency key so a retry never charges twice."
      ]
    },
    {
      "heading": "Retries done right",
      "text": "Retries are the reason you need idempotency, and badly done they cause outages. Retry only operations that are safe to repeat, retry only on transient errors, cap the attempts, and spread retries out. **Exponential backoff with jitter** (a random delay up to a doubling cap) stops thousands of clients retrying in lockstep and hammering a recovering server.\n\nThe summary rule for messaging: at-least-once delivery plus an idempotent consumer is how you get *effectively once* processing.",
      "code": [
        {
          "file": "Retry.java",
          "body": "import java.util.concurrent.ThreadLocalRandom;\nimport java.util.function.Supplier;\n\npublic final class Retry {\n    private Retry() {}\n\n    /** Exponential backoff with full jitter, so thousands of clients do not retry in lockstep. */\n    public static <T> T withBackoff(Supplier<T> call, int maxAttempts, long baseMillis) throws InterruptedException {\n        RuntimeException last = null;\n        for (int attempt = 0; attempt < maxAttempts; attempt++) {\n            try {\n                return call.get();\n            } catch (RuntimeException e) {\n                last = e;\n                long cap = baseMillis * (1L << attempt);\n                Thread.sleep(ThreadLocalRandom.current().nextLong(cap + 1));\n            }\n        }\n        throw last;\n    }\n}"
        }
      ]
    }
  ],
  "takeaways": [
    "Locks stop different users colliding. Idempotency makes the same request, sent twice, harmless.",
    "Client generates the key once per intent. Server stores the result and replays it for duplicates.",
    "Insert the key before doing the work, so the unique constraint decides who is first.",
    "Prefer naturally idempotent operations: set not add, guarded status transitions, unique business keys.",
    "Retry with exponential backoff and jitter, only for safe operations."
  ],
  "pitfalls": [
    "Generating a new key on every retry. Then there is nothing to match against.",
    "Storing the key after doing the work: a crash in between leaves no record and the retry runs again.",
    "Not comparing the request payload to the key, so a reused key returns the wrong answer.",
    "Keeping keys forever or for a few seconds. Choose a retention longer than any realistic retry window (typically 24 hours).",
    "Retrying non-idempotent calls (charging a card) with no key."
  ],
  "interviewQs": [
    {
      "q": "What is idempotency and why does it matter for payments and orders?",
      "a": "An operation is idempotent if applying it many times has the same effect as applying it once. Networks and queues deliver duplicates, so without idempotency a retry could charge a card twice or create two orders. With it, a retry is safe and returns the original result."
    },
    {
      "q": "How would you implement idempotency keys?",
      "a": "The client sends a unique key per intent. The server inserts the key into a table with a primary key before doing the work, and the insert result says whether this is the first request. It stores the response against the key and returns it for any duplicate, and rejects a reused key whose request hash differs."
    },
    {
      "q": "How is idempotency different from locking?",
      "a": "Locking prevents concurrent conflicting changes. Idempotency recognises repeated delivery of the same intent, possibly much later when no lock is held. You usually need both: a lock or atomic statement for different users racing, and an idempotency key for duplicates."
    },
    {
      "q": "Why add jitter to exponential backoff?",
      "a": "Without jitter, all clients that failed together retry at the same moments (1s, 2s, 4s), creating synchronised spikes that can keep a recovering service down. Randomising each delay spreads the retries over time."
    }
  ],
  "related": [
    "reservation-with-ttl",
    "database-locking",
    "limited-stock-cart",
    "digital-wallet",
    "notification-system"
  ]
},
{
  "id": "deadlock-and-lock-ordering",
  "name": "Deadlocks & Lock Ordering",
  "summary": "Locks fix races but introduce a new failure: two threads each hold a lock the other needs and wait forever. It appears the moment one operation needs more than one lock, such as a cart with two products. The cure is simple and absolute: take locks in one global order, or never wait forever. This final lesson closes the course with a cheat sheet.",
  "sections": [
    {
      "heading": "How a deadlock happens",
      "text": "Alice's cart is [keyboard, mouse]. Bob's cart is [mouse, keyboard]. Each checkout locks the products in cart order. Alice locks the keyboard, Bob locks the mouse, then Alice waits for the mouse and Bob waits for the keyboard. Neither can ever proceed.\n\nA deadlock needs four things at once: mutual exclusion, hold-and-wait, no pre-emption, and a **circular wait**. Remove any one and it cannot happen. In practice we remove the circular wait.",
      "code": [
        {
          "file": "DeadlockDemo.java",
          "body": "import java.util.concurrent.locks.ReentrantLock;\n\n/** DO NOT RUN IN PRODUCTION: each buyer locks products in the order of THEIR cart. */\npublic class DeadlockDemo {\n    static final ReentrantLock keyboard = new ReentrantLock();\n    static final ReentrantLock mouse = new ReentrantLock();\n\n    static void checkout(ReentrantLock first, ReentrantLock second) {\n        first.lock();\n        try {\n            pause();                 // the window in which the other thread grabs its first lock\n            second.lock();           // each thread now waits for the lock the other one holds\n            try {\n                System.out.println(Thread.currentThread().getName() + \" bought both\");\n            } finally {\n                second.unlock();\n            }\n        } finally {\n            first.unlock();\n        }\n    }\n\n    static void pause() {\n        try { Thread.sleep(50); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }\n    }\n\n    public static void main(String[] args) {\n        new Thread(() -> checkout(keyboard, mouse), \"alice (keyboard, mouse)\").start();\n        new Thread(() -> checkout(mouse, keyboard), \"bob (mouse, keyboard)\").start();   // opposite order\n    }\n}"
        }
      ],
      "note": "We ran this and had to kill it after 5 seconds: both threads hang forever and no output appears. It also means a deadlock produces no error, only a request that never returns."
    },
    {
      "heading": "Fix 1: one global lock order",
      "text": "If every thread acquires locks in the same global order, a cycle is impossible. Sort the products by a stable key (the id) before locking, remove duplicates, and always lock ascending. Alice and Bob now both lock the keyboard first (or the mouse first, whichever sorts earlier), so one simply waits for the other.\n\nCheck everything first, change everything second, and release in reverse order. Doing the checks under all locks also makes a multi-item purchase all-or-nothing.",
      "code": [
        {
          "file": "OrderedCheckout.java",
          "body": "import java.util.ArrayList;\nimport java.util.List;\nimport java.util.Map;\nimport java.util.TreeSet;\nimport java.util.concurrent.ConcurrentHashMap;\nimport java.util.concurrent.locks.ReentrantLock;\n\npublic class OrderedCheckout {\n    private final Map<String, Integer> stock = new ConcurrentHashMap<>();\n    private final Map<String, ReentrantLock> locks = new ConcurrentHashMap<>();\n\n    public OrderedCheckout(Map<String, Integer> initial) {\n        stock.putAll(initial);\n    }\n\n    private ReentrantLock lockFor(String productId) {\n        return locks.computeIfAbsent(productId, id -> new ReentrantLock());\n    }\n\n    /** All-or-nothing purchase of several products, safe against any other cart ordering. */\n    public boolean buyAll(List<String> productIds) {\n        List<String> ordered = new ArrayList<>(new TreeSet<>(productIds));   // one global order, no duplicates\n        List<ReentrantLock> held = new ArrayList<>();\n        try {\n            for (String id : ordered) {\n                ReentrantLock lock = lockFor(id);\n                lock.lock();                       // always ascending id: a cycle is impossible\n                held.add(lock);\n            }\n            for (String id : ordered) {\n                if (stock.getOrDefault(id, 0) <= 0) return false;   // check everything first\n            }\n            for (String id : ordered) {\n                stock.merge(id, -1, Integer::sum);                  // then change everything\n            }\n            return true;\n        } finally {\n            for (int i = held.size() - 1; i >= 0; i--) held.get(i).unlock();   // release in reverse\n        }\n    }\n\n    public int stock(String productId) {\n        return stock.getOrDefault(productId, 0);\n    }\n}"
        }
      ],
      "note": "We ran 4 threads buying [A, B] and [B, A] in opposite orders, 2,000 purchases each, 8,000 in total: all completed, stock was exact, and a deadlock check reported none."
    },
    {
      "heading": "Fix 2: tryLock with a timeout and back-off",
      "text": "Sometimes you cannot control the order (the locks are acquired in different classes, or the set of locks is discovered as you go). Then never wait forever: `tryLock` with a short timeout, and if you cannot get every lock, release everything you hold, sleep a random few milliseconds, and try again.\n\nThe random delay matters: without it two threads can keep colliding in lockstep (livelock). This breaks the hold-and-wait condition, because a thread that fails gives up what it holds.",
      "code": [
        {
          "file": "TryLockCheckout.java",
          "body": "import java.util.ArrayList;\nimport java.util.List;\nimport java.util.Map;\nimport java.util.concurrent.ConcurrentHashMap;\nimport java.util.concurrent.ThreadLocalRandom;\nimport java.util.concurrent.TimeUnit;\nimport java.util.concurrent.locks.ReentrantLock;\n\n/** When you cannot control lock order: never wait forever, back off and retry. */\npublic class TryLockCheckout {\n    private final Map<String, Integer> stock = new ConcurrentHashMap<>();\n    private final Map<String, ReentrantLock> locks = new ConcurrentHashMap<>();\n\n    public TryLockCheckout(Map<String, Integer> initial) {\n        stock.putAll(initial);\n    }\n\n    private ReentrantLock lockFor(String id) {\n        return locks.computeIfAbsent(id, k -> new ReentrantLock());\n    }\n\n    public boolean buyAll(List<String> productIds) throws InterruptedException {\n        for (int attempt = 0; attempt < 10; attempt++) {\n            List<ReentrantLock> held = new ArrayList<>();\n            try {\n                boolean gotAll = true;\n                for (String id : productIds) {\n                    ReentrantLock lock = lockFor(id);\n                    if (lock.tryLock(20, TimeUnit.MILLISECONDS)) {\n                        held.add(lock);\n                    } else {\n                        gotAll = false;           // someone holds it: release what we have, then retry\n                        break;\n                    }\n                }\n                if (gotAll) {\n                    for (String id : productIds) {\n                        if (stock.getOrDefault(id, 0) <= 0) return false;\n                    }\n                    for (String id : productIds) stock.merge(id, -1, Integer::sum);\n                    return true;\n                }\n            } finally {\n                for (int i = held.size() - 1; i >= 0; i--) held.get(i).unlock();\n            }\n            Thread.sleep(ThreadLocalRandom.current().nextLong(1, 15));   // jitter breaks the symmetry\n        }\n        throw new IllegalStateException(\"could not acquire all locks, try again\");\n    }\n\n    public int stock(String id) {\n        return stock.getOrDefault(id, 0);\n    }\n}"
        }
      ]
    },
    {
      "heading": "Spotting and preventing deadlocks in practice",
      "text": "In Java, `jstack <pid>` prints 'Found one Java-level deadlock' with the threads and locks involved, and the JMX `ThreadMXBean` can report the same from inside the process, which is handy for a health check.\n\nDatabases deadlock too, on row locks. Two transactions updating the same two rows in opposite order will do it. The database detects the cycle and aborts one transaction (SQLSTATE 40P01 in PostgreSQL, error 1213 in MySQL), so your code must be ready to retry the whole transaction. Prevent them the same way: touch rows in a consistent order and keep transactions short.",
      "code": [
        {
          "file": "DeadlockDetector.java",
          "body": "import java.lang.management.ManagementFactory;\nimport java.lang.management.ThreadInfo;\nimport java.lang.management.ThreadMXBean;\n\npublic class DeadlockDetector {\n    /** Call from a health check or a watchdog thread. */\n    public static void report() {\n        ThreadMXBean threads = ManagementFactory.getThreadMXBean();\n        long[] ids = threads.findDeadlockedThreads();\n        if (ids == null) {\n            System.out.println(\"no deadlock\");\n            return;\n        }\n        for (ThreadInfo info : threads.getThreadInfo(ids)) {\n            System.out.println(info.getThreadName() + \" is waiting for \" + info.getLockName()\n                    + \" held by \" + info.getLockOwnerName());\n        }\n    }\n\n    public static void main(String[] args) {\n        report();\n    }\n}"
        },
        {
          "file": "ordered-row-locks.sql",
          "body": "-- lock every row of the cart in one consistent order, then update them\nBEGIN;\nSELECT id FROM product\n WHERE id IN (101, 205)\n ORDER BY id\n FOR UPDATE;\n\nUPDATE product SET stock = stock - 1 WHERE id IN (101, 205) AND stock > 0;\nCOMMIT;\n-- on SQLSTATE 40P01 (deadlock) or 40001 (serialization failure): roll back and retry"
        }
      ]
    },
    {
      "heading": "The whole course on one page",
      "text": "When an interviewer says 'what if two people do this at the same time?', walk down this list.",
      "bullets": [
        "Name the race: which check and which act can be separated? Say 'check-then-act' out loud.",
        "Where does the state live? One JVM: lock or CAS. A database: conditional UPDATE, FOR UPDATE, or a unique constraint. Many servers and Redis: a Lua counter, or a lock with fencing.",
        "Is the resource held for a long time (payment, form)? Use a reservation with an expiry and a sweeper.",
        "Can the same request arrive twice? Add an idempotency key or make the transition conditional on status.",
        "Do you lock more than one thing? Use a global lock order, or tryLock with back-off.",
        "Last line of defence: a unique constraint or conditional write, so a bug in the lock cannot cause double booking.",
        "Say the trade-off: optimistic for low contention, pessimistic for hot rows, and measure."
      ]
    }
  ],
  "takeaways": [
    "Deadlock needs a circular wait. Remove the cycle with a global lock order.",
    "Where order cannot be controlled, use tryLock with a timeout, release everything, and retry after a random delay.",
    "Deadlocks give no error: the request just hangs. Add timeouts, detection, and monitoring.",
    "Databases deadlock too: order your row access and retry on deadlock errors.",
    "Prefer one lock per operation. The fewer nested locks, the fewer deadlocks."
  ],
  "pitfalls": [
    "Locking in cart order or call order instead of a stable global order.",
    "Sorting by something unstable, or forgetting duplicates (locking the same product twice).",
    "Nested locks across classes, where nobody sees the whole order.",
    "Retry loops without jitter, causing livelock.",
    "Calling out to other services while holding locks, which hides cycles across systems."
  ],
  "interviewQs": [
    {
      "q": "What causes a deadlock, and how do you prevent it?",
      "a": "Four conditions together: mutual exclusion, hold-and-wait, no pre-emption and circular wait. The usual prevention is to break the circular wait by always acquiring locks in one global order (for example sorted by product id). You can also break hold-and-wait with tryLock and timeouts, releasing everything on failure."
    },
    {
      "q": "Two users check out carts [A, B] and [B, A]. What goes wrong and how do you fix it?",
      "a": "Each locks its first product, then waits for the second held by the other: a classic deadlock. Fix by sorting the product ids and locking in ascending order for everyone, check all stock under the locks, then decrement all, and release in reverse order."
    },
    {
      "q": "What is the difference between deadlock, livelock and starvation?",
      "a": "Deadlock: threads wait forever, blocked on each other. Livelock: threads keep reacting to each other and retrying but make no progress, as with two tryLock loops backing off in lockstep. Starvation: a thread is perpetually denied a resource because others keep winning. Random back-off helps livelock, and fair locks or queues help starvation."
    },
    {
      "q": "How do you detect and handle deadlocks in a database?",
      "a": "The database finds cycles itself and aborts one transaction with a deadlock error (SQLSTATE 40P01 in PostgreSQL). The application must catch it, roll back and retry the transaction. To reduce them, access rows in a consistent order, keep transactions short and avoid holding locks across slow work."
    }
  ],
  "related": [
    "locks-synchronization",
    "database-locking",
    "race-conditions",
    "reservation-with-ttl",
    "limited-stock-cart"
  ]
}
);
