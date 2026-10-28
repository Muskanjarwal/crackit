window.CONCURRENCY = window.CONCURRENCY || [];
window.CONCURRENCY.push(
  {
    "id": "atm",
    "scenarios": [
      {
        "title": "Two withdrawals from one account at the same moment",
        "race": "A joint account holds **$100.00**. Alice at ATM 1 and Bob at ATM 2 each request **$100.00**. Both threads run `if (balance >= amount)` and both read 100.00, so both pass the check. Alice debits to 0.00, Bob debits to **-100.00**, and two sets of cash come out of an account that only held one.",
        "why": "This is a **check-then-act** race. The balance check and the debit are two separate steps, and another thread can run in the gap between them. Both threads decided based on a value that was already stale by the time they acted.",
        "fix": "Make check and debit one indivisible step by guarding the account's balance with a lock. Use a **per-account** lock, not one global lock, so withdrawals from different accounts still run in parallel.\n\nThe lock must cover every read and write of `balanceCents`, including the balance enquiry. Locking only `withdraw` while `deposit` or `balance()` touch the field unguarded leaves the same bug in a different place.",
        "code": [
          {
            "file": "Account.java",
            "body": "import java.util.concurrent.locks.ReentrantLock;\n\npublic class Account {\n    private final String id;\n    private long balanceCents;\n    private final ReentrantLock lock = new ReentrantLock();\n\n    public Account(String id, long balanceCents) {\n        this.id = id;\n        this.balanceCents = balanceCents;\n    }\n\n    /** Check and debit happen as ONE atomic step. */\n    public boolean withdraw(long amountCents) {\n        if (amountCents <= 0) throw new IllegalArgumentException(\"amount must be positive\");\n        lock.lock();\n        try {\n            if (balanceCents < amountCents) return false;\n            balanceCents -= amountCents;\n            return true;\n        } finally {\n            lock.unlock();\n        }\n    }\n\n    public long balance() {\n        lock.lock();\n        try {\n            return balanceCents;\n        } finally {\n            lock.unlock();\n        }\n    }\n\n    public String id() { return id; }\n}"
          },
          {
            "file": "BrokenAccount.java",
            "body": "// The bug: the check and the debit are two separate steps.\npublic class BrokenAccount {\n    private long balanceCents;\n\n    public BrokenAccount(long balanceCents) { this.balanceCents = balanceCents; }\n\n    public boolean withdraw(long amountCents) {\n        if (balanceCents >= amountCents) {   // both ATMs read 100.00 here...\n            balanceCents -= amountCents;     // ...and both debit, leaving -100.00\n            return true;\n        }\n        return false;\n    }\n}"
          }
        ],
        "alternatives": [
          "**Conditional UPDATE** if the balance lives in a database: `UPDATE accounts SET balance = balance - ? WHERE id = ? AND balance >= ?` and check that 1 row was affected. No explicit lock needed.",
          "**Optimistic locking** with a `version` column: read, compute, write `WHERE version = ?`, retry on conflict. Better when conflicts are rare.",
          "**synchronized** methods work too, but `ReentrantLock` allows `tryLock` with a timeout so a stuck session can't hold the account forever."
        ],
        "say": "\"Withdrawal is a check-then-act, so I make it atomic per account. In memory that's a lock on the account, in the database it's a conditional UPDATE or SELECT FOR UPDATE. I lock per account rather than globally so unrelated customers don't block each other.\""
      },
      {
        "title": "The ATM times out and retries, and the customer is charged twice",
        "race": "The ATM sends a withdraw request to the bank. The bank debits $40 and replies, but the response is lost on the network. The ATM times out and **retries**. The bank sees a second request and debits another $40. The customer's account is down $80 and they received $40.",
        "why": "The network can fail after the work is done. The caller can't tell \"request never arrived\" from \"request succeeded but the reply was lost\", so it retries, and a retry of a non-idempotent operation repeats the side effect.",
        "fix": "Make the operation **idempotent** with a request ID. The ATM generates one ID per customer action and sends the same ID on every retry. The service remembers the result for each ID and returns the stored receipt instead of debiting again.\n\n`computeIfAbsent` runs the debit at most once per ID, even when two retries arrive concurrently. In a real system the ID and result live in the same database transaction as the debit.",
        "code": [
          {
            "file": "WithdrawalService.java",
            "body": "import java.util.concurrent.ConcurrentHashMap;\n\npublic class WithdrawalService {\n    public record Receipt(String requestId, boolean approved, long newBalanceCents) {}\n\n    public interface Account {\n        boolean withdraw(long cents);\n        long balance();\n    }\n\n    private final ConcurrentHashMap<String, Receipt> processed = new ConcurrentHashMap<>();\n\n    /** The ATM generates requestId once per customer action and reuses it on every retry. */\n    public Receipt withdraw(String requestId, Account account, long cents) {\n        // computeIfAbsent runs the lambda at most once per key, even for concurrent retries.\n        return processed.computeIfAbsent(requestId, id -> {\n            boolean ok = account.withdraw(cents);\n            return new Receipt(id, ok, account.balance());\n        });\n    }\n}"
          }
        ],
        "alternatives": [
          "A **unique constraint** on `(account_id, request_id)` in the transactions table: the second insert fails and you return the original row.",
          "A **state machine** per transaction (INITIATED, DEBITED, DISPENSED) so a retry resumes from the last completed step.",
          "Expire stored request IDs after a retention window, for example 24 hours, so the table doesn't grow forever."
        ],
        "say": "\"Retries are inevitable, so I make withdraw idempotent. The ATM sends the same request ID every time, and the bank stores the outcome per ID. A duplicate returns the original receipt rather than debiting twice.\""
      },
      {
        "title": "Two sessions plan on the same last notes in the cash cassette",
        "race": "The machine has one $50 note and plenty of $20s. Session 1 asks for $50 and plans \"one $50\". Session 2 asks for $70 and also plans \"one $50 + one $20\". Both read the count of $50 notes as 1 before either commits. Session 1 commits and takes the note. Session 2 then commits a plan that needs a note that is gone, and the count goes to **-1**.",
        "why": "Planning (reading the counts) and committing (decrementing them) were separate steps. The plan was computed from a snapshot that another session invalidated before it could be applied.",
        "fix": "The cash cassette is one physical resource shared by every session, so guard it with a **single lock** and do plan and commit in the same critical section. If the plan can't be satisfied, return empty before touching anything, so there is nothing to roll back.\n\nA global lock is fine here because there is only one dispenser. The critical section is a few arithmetic operations, and the slow part (the motor pushing out notes) happens afterwards, outside the lock.",
        "code": [
          {
            "file": "CashDispenser.java",
            "body": "import java.util.Comparator;\nimport java.util.LinkedHashMap;\nimport java.util.Map;\nimport java.util.Optional;\nimport java.util.TreeMap;\n\npublic class CashDispenser {\n    private final TreeMap<Integer, Integer> notes = new TreeMap<>(Comparator.reverseOrder());\n\n    public CashDispenser(Map<Integer, Integer> initial) {\n        notes.putAll(initial);\n    }\n\n    /** Plan and commit under one lock so two sessions can't both plan on the same last notes. */\n    public synchronized Optional<Map<Integer, Integer>> dispense(int amount) {\n        Map<Integer, Integer> plan = new LinkedHashMap<>();\n        int remaining = amount;\n        for (Map.Entry<Integer, Integer> e : notes.entrySet()) {\n            int use = Math.min(remaining / e.getKey(), e.getValue());\n            if (use > 0) {\n                plan.put(e.getKey(), use);\n                remaining -= use * e.getKey();\n            }\n        }\n        if (remaining != 0) return Optional.empty();   // nothing was touched, so nothing to roll back\n        plan.forEach((denom, n) -> notes.merge(denom, -n, Integer::sum));\n        return Optional.of(plan);\n    }\n}"
          }
        ],
        "alternatives": [
          "A single-threaded executor for dispenser commands: all requests queue up and run one at a time.",
          "**Reserve then confirm**: reserve the notes at plan time, release them if the mechanical dispense fails.",
          "Per-denomination atomic counters work only if each request needs a single denomination. Mixed notes need the lock."
        ],
        "say": "\"The cash bin is one shared physical resource, so I plan and commit under a single lock. If the plan fails I haven't mutated anything. The slow mechanical dispense happens after releasing the lock.\""
      }
    ]
  },
  {
    "id": "logging-framework",
    "scenarios": [
      {
        "title": "Log lines from many threads interleave and corrupt the file",
        "race": "Thread A writes `ERROR payment failed for order 42` while thread B writes `INFO user logged in`. With an unsynchronised writer the output becomes `ERROR payment faiINFO user logged inled for order 42`, and a log parser can no longer split the lines.",
        "why": "Writing a line is not atomic: a `println` can be several writes (message, then newline), and concurrent writers interleave at those boundaries. Even when each call is thread-safe, a slow disk write also makes every application thread wait on the same lock.",
        "fix": "Use an **async appender with a single writer thread**. Application threads only put the formatted line on a bounded queue and return. One dedicated thread takes lines off the queue and writes them, so lines can never interleave and the file has exactly one writer.\n\nThis also moves disk latency off the request path: a slow `fsync` no longer stalls the thread that logged.",
        "code": [
          {
            "file": "AsyncAppender.java",
            "body": "import java.io.PrintStream;\nimport java.util.concurrent.BlockingQueue;\nimport java.util.concurrent.LinkedBlockingQueue;\nimport java.util.concurrent.TimeUnit;\n\npublic class AsyncAppender implements AutoCloseable {\n    private final BlockingQueue<String> queue = new LinkedBlockingQueue<>(10_000);\n    private final PrintStream out;\n    private final Thread writer;\n    private volatile boolean running = true;\n\n    public AsyncAppender(PrintStream out) {\n        this.out = out;\n        this.writer = new Thread(this::drain, \"log-writer\");\n        this.writer.setDaemon(true);\n        this.writer.start();\n    }\n\n    /** Called by any application thread: only enqueues. */\n    public void append(String line) throws InterruptedException {\n        queue.put(line);\n    }\n\n    private void drain() {\n        try {\n            while (running || !queue.isEmpty()) {\n                String line = queue.poll(100, TimeUnit.MILLISECONDS);\n                if (line != null) out.println(line);   // only this thread ever writes\n            }\n        } catch (InterruptedException e) {\n            Thread.currentThread().interrupt();\n        }\n    }\n\n    @Override\n    public void close() throws InterruptedException {\n        running = false;\n        writer.join();\n    }\n}"
          }
        ],
        "alternatives": [
          "A `synchronized` append is the simplest correct option when throughput is low, but every logging thread pays for the I/O.",
          "A `LinkedTransferQueue` or the LMAX Disruptor ring buffer for very high rates.",
          "One log file per thread, merged later by timestamp. Avoids contention but complicates reading."
        ],
        "say": "\"I don't let application threads touch the file. They enqueue, and a single writer thread drains the queue, which gives me atomic lines and keeps disk latency off the hot path.\""
      },
      {
        "title": "The disk stalls, the queue fills, and logging takes the app down",
        "race": "The log disk slows to a crawl. The writer thread falls behind, the queue reaches capacity, and every `append()` call now **blocks**. Request threads stall on `logger.info(...)`, the thread pool exhausts, and a logging problem has become a full outage. With an *unbounded* queue the alternative is an OutOfMemoryError.",
        "why": "A producer faster than its consumer needs a bounded buffer and an explicit decision about what happens when it is full. Without one, the system picks a failure mode for you: block forever or run out of memory.",
        "fix": "Use a **bounded queue with an explicit overflow policy**, chosen per level or appender:\n\n- `BLOCK` for audit logs that must never be lost, accepting the slowdown.\n- `DROP_NEWEST` or `DROP_OLDEST` for diagnostics, where the application must never stall.\n\nCount every dropped message in an `AtomicLong` and expose it as a metric, so loss is visible instead of silent.",
        "code": [
          {
            "file": "BoundedAppender.java",
            "body": "import java.util.concurrent.BlockingQueue;\nimport java.util.concurrent.LinkedBlockingQueue;\nimport java.util.concurrent.atomic.AtomicLong;\n\npublic class BoundedAppender {\n    public enum Overflow { BLOCK, DROP_NEWEST, DROP_OLDEST }\n\n    private final BlockingQueue<String> queue;\n    private final Overflow policy;\n    private final AtomicLong dropped = new AtomicLong();\n\n    public BoundedAppender(int capacity, Overflow policy) {\n        this.queue = new LinkedBlockingQueue<>(capacity);\n        this.policy = policy;\n    }\n\n    public void append(String line) throws InterruptedException {\n        switch (policy) {\n            case BLOCK -> queue.put(line);                                  // safe but slows the app\n            case DROP_NEWEST -> { if (!queue.offer(line)) dropped.incrementAndGet(); }\n            case DROP_OLDEST -> {\n                while (!queue.offer(line)) {\n                    if (queue.poll() != null) dropped.incrementAndGet();    // make room, keep newest\n                }\n            }\n        }\n    }\n\n    public String take() throws InterruptedException { return queue.take(); }\n\n    /** Export this as a metric so silent loss is visible. */\n    public long dropped() { return dropped.get(); }\n}"
          }
        ],
        "alternatives": [
          "Never drop `ERROR` and above: use separate queues, or evict only lower-severity entries first.",
          "Sampling: keep 1 in N `DEBUG` messages when the queue is above a high-water mark.",
          "Fall back to a synchronous write to stderr when the queue is full."
        ],
        "say": "\"The queue is bounded, and I make the full-queue behaviour a policy: block for audit logs, drop for debug logs. I count drops in a metric so we know when we're losing data.\""
      },
      {
        "title": "Changing the log level or adding an appender while threads are logging",
        "race": "An operator flips the level from INFO to DEBUG at runtime while 50 request threads are logging. One thread is iterating the appender list when another adds a file appender, and the plain `ArrayList` throws **ConcurrentModificationException** inside `log()`. Another thread might keep using a stale level because the field was never made visible.",
        "why": "Two separate problems: a shared mutable list that is iterated while being modified, and a plain field written by one thread and read by others with no visibility guarantee.",
        "fix": "Pick the structure by access pattern. Logging reads on every call and configuration changes almost never, so a read-mostly design fits:\n\n- `volatile` for the **level**, so a write is immediately visible to every reader and a read costs almost nothing.\n- `CopyOnWriteArrayList` for **appenders**. Every write copies the array, but iteration is lock-free and works on a stable snapshot, so adding or removing an appender never disturbs an in-flight `log()` call.",
        "code": [
          {
            "file": "Logger.java",
            "body": "import java.util.concurrent.CopyOnWriteArrayList;\n\npublic class Logger {\n    public enum Level { DEBUG, INFO, WARN, ERROR }\n\n    public interface Appender {\n        void append(String line);\n    }\n\n    private volatile Level level = Level.INFO;                       // read on every call, rarely written\n    private final CopyOnWriteArrayList<Appender> appenders = new CopyOnWriteArrayList<>();\n\n    public void setLevel(Level newLevel) { this.level = newLevel; }\n\n    public void addAppender(Appender a) { appenders.add(a); }\n\n    public void removeAppender(Appender a) { appenders.remove(a); }\n\n    public void log(Level l, String message) {\n        if (l.compareTo(level) < 0) return;\n        String line = \"[\" + l + \"] \" + message;\n        for (Appender a : appenders) {                                // iterates a stable snapshot\n            a.append(line);\n        }\n    }\n}"
          }
        ],
        "alternatives": [
          "An immutable `Config` object held in an `AtomicReference`: swap the whole configuration in one step so readers never see a half-updated state.",
          "`ReentrantReadWriteLock` if configuration has several fields that must change together.",
          "`ConcurrentHashMap` keyed by appender name if you need lookups."
        ],
        "say": "\"Logging is read-heavy and config is write-rare, so I use a volatile level and a copy-on-write appender list. Readers never lock, and a config change can't break a log call in flight.\""
      }
    ]
  },
  {
    "id": "pub-sub-system",
    "scenarios": [
      {
        "title": "One slow subscriber blocks the publisher and every other subscriber",
        "race": "A topic has three subscribers. The publisher loops `for (s : subscribers) s.onMessage(msg)` on its own thread. Subscriber 2 calls a slow external API and takes 3 seconds per message. The publisher is stuck for 3 seconds on every publish, and subscriber 3 doesn't see the message until subscriber 2 finishes.",
        "why": "Delivery is **synchronous and shared**: the publisher's thread executes subscriber code. The slowest handler sets the pace for the publisher and for every subscriber behind it in the loop. One failing handler that throws would stop the loop altogether.",
        "fix": "**Decouple publishing from delivery.** Give each subscriber its own queue and worker, here a single-thread executor. `deliver()` only enqueues and returns immediately, so the publisher is never blocked and a slow subscriber only delays itself.\n\nA single-threaded worker per subscriber also preserves the order in which that subscriber receives messages. Catch exceptions inside the task so one bad message cannot kill the worker.",
        "code": [
          {
            "file": "Subscriber.java",
            "body": "import java.util.concurrent.ExecutorService;\nimport java.util.concurrent.Executors;\nimport java.util.function.Consumer;\n\npublic class Subscriber<T> implements AutoCloseable {\n    private final ExecutorService worker = Executors.newSingleThreadExecutor();\n    private final Consumer<T> handler;\n\n    public Subscriber(Consumer<T> handler) {\n        this.handler = handler;\n    }\n\n    /** Publisher calls this and returns immediately; the handler runs on this subscriber's own thread. */\n    public void deliver(T message) {\n        worker.execute(() -> {\n            try {\n                handler.accept(message);\n            } catch (RuntimeException e) {\n                System.err.println(\"subscriber failed: \" + e);        // never let one failure kill the worker\n            }\n        });\n    }\n\n    @Override\n    public void close() {\n        worker.shutdown();\n    }\n}"
          }
        ],
        "alternatives": [
          "A **bounded** per-subscriber queue with a policy for a full queue (drop, block, or disconnect the subscriber) to stop a very slow one growing memory without limit.",
          "A shared thread pool is cheaper for many subscribers, but you give up per-subscriber ordering unless you serialise by key.",
          "**Pull model** like Kafka: the subscriber reads at its own pace from a log, and the broker never waits for it."
        ],
        "say": "\"The publisher should never run subscriber code. I give each subscriber its own queue and worker so a slow consumer only hurts itself, and I bound the queue so one stuck consumer can't exhaust memory.\""
      },
      {
        "title": "Subscribing or unsubscribing while a message is being published",
        "race": "Thread P is iterating `subscribers` to publish. Thread U calls `unsubscribe(x)` on the same `ArrayList`. P's iterator detects the structural change and throws **ConcurrentModificationException**, dropping the message for every subscriber after that point. In the worst case, an unsynchronised `HashSet` corrupts silently instead of throwing.",
        "why": "A non-thread-safe collection is being read and structurally modified at the same time. Iterators over `ArrayList` and `HashMap` are fail-fast and make no promises under concurrent modification.",
        "fix": "Use `CopyOnWriteArrayList`. Publishing is the hot path and subscription changes are rare, which is the exact case it is designed for. Each publish iterates a **snapshot**, so concurrent changes are safe and take effect from the next publish.\n\nThe trade-off to mention: an unsubscribed listener may still receive one in-flight message that was already snapshotted, so handlers should tolerate that.",
        "code": [
          {
            "file": "Topic.java",
            "body": "import java.util.List;\nimport java.util.concurrent.CopyOnWriteArrayList;\nimport java.util.function.Consumer;\n\npublic class Topic<T> {\n    private final List<Consumer<T>> subscribers = new CopyOnWriteArrayList<>();\n\n    public void subscribe(Consumer<T> s) { subscribers.add(s); }\n\n    public void unsubscribe(Consumer<T> s) { subscribers.remove(s); }\n\n    public void publish(T message) {\n        // The iterator works on a snapshot, so subscribe/unsubscribe during a publish is safe\n        // and never throws ConcurrentModificationException.\n        for (Consumer<T> s : subscribers) {\n            s.accept(message);\n        }\n    }\n}"
          }
        ],
        "alternatives": [
          "Hold a `ReadWriteLock`: publishers take the read lock, subscribe/unsubscribe take the write lock. Blocks subscription changes during long publishes.",
          "`ConcurrentHashMap.newKeySet()` when you need set semantics and weakly consistent iteration.",
          "Copy the list under a lock at the start of `publish`, then iterate the copy outside the lock."
        ],
        "say": "\"Publishing is hot and subscribing is rare, so I use copy-on-write. Publishers iterate a snapshot with no lock, and a subscribe or unsubscribe never breaks an in-flight publish.\""
      },
      {
        "title": "Two publishers on one topic and messages arrive out of order",
        "race": "Publisher 1 and publisher 2 publish to the same topic at the same time. An `AtomicLong` gives P1 sequence 1 and P2 sequence 2, but P2 enqueues its message to the subscribers first. Subscribers now receive sequence 2, then 1, and any consumer that relies on order (for example applying account updates) is wrong.",
        "why": "Taking a sequence number and enqueueing the message are two steps. The atomic counter makes each number unique, but it doesn't make the *delivery order* match the *number order*, because a thread can be descheduled between the two steps.",
        "fix": "Make **sequence assignment and enqueue one critical section** per topic. Whichever publisher holds the lock gets the next number and puts the message on every subscriber queue before anyone else can. Because subscribers consume from FIFO queues, the order they see equals the sequence order.\n\nThe lock is per topic, so unrelated topics still publish in parallel, and the critical section only enqueues, so it is short.",
        "code": [
          {
            "file": "OrderedTopic.java",
            "body": "import java.util.List;\nimport java.util.concurrent.CopyOnWriteArrayList;\n\npublic class OrderedTopic<T> {\n    public record Envelope<T>(long seq, T payload) {}\n\n    public interface Sub<T> {\n        void deliver(Envelope<T> e);   // must enqueue and return, e.g. onto a per-subscriber queue\n    }\n\n    private final List<Sub<T>> subs = new CopyOnWriteArrayList<>();\n    private final Object publishLock = new Object();\n    private long seq = 0;\n\n    public void subscribe(Sub<T> s) { subs.add(s); }\n\n    public void publish(T message) {\n        // An AtomicLong alone is not enough: two threads could get seq 1 and 2\n        // but enqueue in the order 2, 1. Assign and enqueue under one lock.\n        synchronized (publishLock) {\n            Envelope<T> env = new Envelope<>(++seq, message);\n            for (Sub<T> s : subs) s.deliver(env);\n        }\n    }\n}"
          }
        ],
        "alternatives": [
          "Funnel each topic through a **single-threaded executor**: submission order is the delivery order and no lock is needed.",
          "Partition by key (as Kafka does): order is guaranteed only within a partition, which scales better than a total order per topic.",
          "Let subscribers reorder using the sequence number and a small buffer."
        ],
        "say": "\"A unique sequence number isn't the same as ordered delivery. I assign the number and enqueue under one per-topic lock, or use a single-threaded executor per topic. If I only need order per key, I partition instead.\""
      }
    ]
  },
  {
    "id": "elevator-system",
    "scenarios": [
      {
        "title": "Two elevators claim the same hall call",
        "race": "A passenger presses UP on floor 5. The dispatcher thread for elevator A and the one for elevator B both scan pending calls, both see this call as unassigned, and both head to floor 5. The passenger boards one car, and the other travels there empty, wasting a trip and delaying every other call it could have served.",
        "why": "Claiming a call is a check-then-act on its status: \"if unassigned, assign to me.\" Two threads can both pass the check before either writes.",
        "fix": "Make the claim a single **compare-and-set** on the call's owner. `compareAndSet(UNASSIGNED, elevatorId)` succeeds for exactly one caller, and everyone else gets `false` and moves on to the next candidate. No lock is needed and no thread ever blocks.\n\nIn the dispatcher, order candidates by distance but let the atomic claim, not the ordering, decide the winner. Provide a `release` that CASes back to `UNASSIGNED` when an elevator can't serve the call (fault, overload) so another can pick it up.",
        "code": [
          {
            "file": "HallCall.java",
            "body": "import java.util.concurrent.atomic.AtomicInteger;\n\npublic class HallCall {\n    public static final int UNASSIGNED = -1;\n\n    private final int floor;\n    private final boolean up;\n    private final AtomicInteger assignedElevator = new AtomicInteger(UNASSIGNED);\n\n    public HallCall(int floor, boolean up) {\n        this.floor = floor;\n        this.up = up;\n    }\n\n    /** Exactly one caller wins; every other caller sees false. */\n    public boolean tryClaim(int elevatorId) {\n        return assignedElevator.compareAndSet(UNASSIGNED, elevatorId);\n    }\n\n    /** Give the call back if the elevator can't serve it (fault, overload). */\n    public void release(int elevatorId) {\n        assignedElevator.compareAndSet(elevatorId, UNASSIGNED);\n    }\n\n    public int floor() { return floor; }\n    public boolean up() { return up; }\n}"
          },
          {
            "file": "Dispatcher.java",
            "body": "import java.util.Comparator;\nimport java.util.List;\nimport java.util.Optional;\n\npublic class Dispatcher {\n    public record Elevator(int id, int currentFloor) {}\n\n    /** Try candidates nearest-first; the atomic claim decides the winner, not the ordering. */\n    public Optional<Elevator> assign(HallCall call, List<Elevator> elevators) {\n        return elevators.stream()\n                .sorted(Comparator.comparingInt(e -> Math.abs(e.currentFloor() - call.floor())))\n                .filter(e -> call.tryClaim(e.id()))\n                .findFirst();\n    }\n}"
          }
        ],
        "alternatives": [
          "A **single dispatcher thread** that owns all assignments, so there is nothing to race on (see the next scenario).",
          "A `synchronized` method on the call object: simple and correct, slightly more contention.",
          "Database row with `UPDATE ... WHERE assigned IS NULL` when assignments must survive restarts."
        ],
        "say": "\"Claiming a hall call is a check-then-act, so I use a CAS on the call's owner. Exactly one elevator wins, and the rest immediately move on to the next call without blocking.\""
      },
      {
        "title": "The dispatcher reads elevator positions while they are changing",
        "race": "Elevator controllers update `currentFloor` and `direction` from their own threads. The dispatcher reads them to pick the nearest car and sees elevator 2 at floor 4 *and* moving up from a previous update, a combination that was never true at any single instant. It sends the \"nearest\" car in the wrong direction.",
        "why": "Several fields describing one elevator are updated separately, so a reader can observe a torn, inconsistent snapshot. Adding locks on each field doesn't fix it, since consistency spans more than one field and more than one elevator.",
        "fix": "Use a **single-threaded event loop** for dispatching (the actor model). Everything that happens, a button press or an elevator arriving at a floor, is posted as an **event** onto one queue. One thread processes events one at a time and is the **only** thread that reads or writes dispatcher state, so a plain `HashMap` is safe and every decision sees a consistent view.\n\nProducers never touch shared state, they just post events. This removes locks and the risk of deadlock for this component.",
        "code": [
          {
            "file": "DispatcherLoop.java",
            "body": "import java.util.HashMap;\nimport java.util.Map;\nimport java.util.concurrent.BlockingQueue;\nimport java.util.concurrent.LinkedBlockingQueue;\n\npublic class DispatcherLoop implements Runnable {\n    public sealed interface Event permits HallCallEvent, ElevatorMoved {}\n    public record HallCallEvent(int floor, boolean up) implements Event {}\n    public record ElevatorMoved(int elevatorId, int floor) implements Event {}\n\n    private final BlockingQueue<Event> inbox = new LinkedBlockingQueue<>();\n    private final Map<Integer, Integer> elevatorFloor = new HashMap<>();   // touched ONLY by the loop thread\n\n    /** Any thread (button panel, elevator controller) may post. */\n    public void post(Event e) { inbox.add(e); }\n\n    @Override\n    public void run() {\n        try {\n            while (!Thread.currentThread().isInterrupted()) {\n                handle(inbox.take());\n            }\n        } catch (InterruptedException e) {\n            Thread.currentThread().interrupt();\n        }\n    }\n\n    private void handle(Event e) {\n        switch (e) {\n            case ElevatorMoved m -> elevatorFloor.put(m.elevatorId(), m.floor());\n            case HallCallEvent c -> {\n                int best = -1, bestDist = Integer.MAX_VALUE;\n                for (Map.Entry<Integer, Integer> en : elevatorFloor.entrySet()) {\n                    int dist = Math.abs(en.getValue() - c.floor());\n                    if (dist < bestDist) { bestDist = dist; best = en.getKey(); }\n                }\n                System.out.println(\"call at floor \" + c.floor() + \" -> elevator \" + best);\n            }\n        }\n    }\n}"
          }
        ],
        "alternatives": [
          "Immutable snapshots: each elevator publishes an immutable `ElevatorState` through an `AtomicReference`, and the dispatcher reads whole snapshots.",
          "A `ReadWriteLock` over all elevator state, at the cost of readers blocking writers.",
          "A single lock around the dispatching decision, accepting the contention."
        ],
        "say": "\"Rather than locking every field, I give the dispatcher a single thread and communicate through an event queue. Only that thread touches the state, so decisions always see a consistent view and there are no locks to deadlock on.\""
      }
    ]
  },
  {
    "id": "splitwise",
    "scenarios": [
      {
        "title": "Concurrent expenses overwrite each other's balance updates",
        "race": "Alice owes Bob 500. Two expenses arrive at once: Carol adds a 200 expense and Dan adds a 300 one, both involving the pair. Each thread reads the current 500, adds its amount, and writes back. One writes 700, the other writes 800 and silently erases the first update. The true balance should be 1000.",
        "why": "`get` followed by `put` is a **read-modify-write**, a lost update waiting to happen. Using a `ConcurrentHashMap` doesn't help if you read and write in two separate calls, because the map is thread-safe but your sequence isn't atomic.",
        "fix": "Do the update inside a single atomic map operation: `ConcurrentHashMap.merge(key, delta, Long::sum)`. The read, the addition and the write happen atomically for that key, so no update is lost, and different keys update in parallel.\n\nStore amounts as integer cents (`long`), never `double`, so repeated additions don't accumulate rounding errors.",
        "code": [
          {
            "file": "BalanceSheet.java",
            "body": "import java.util.concurrent.ConcurrentHashMap;\n\npublic class BalanceSheet {\n    private final ConcurrentHashMap<String, Long> owedCents = new ConcurrentHashMap<>();   // \"debtor->creditor\"\n\n    private static String key(String debtor, String creditor) {\n        return debtor + \"->\" + creditor;\n    }\n\n    public void addDebt(String debtor, String creditor, long cents) {\n        // merge is atomic per key: read, add and write cannot interleave with another merge.\n        owedCents.merge(key(debtor, creditor), cents, Long::sum);\n    }\n\n    public long owed(String debtor, String creditor) {\n        return owedCents.getOrDefault(key(debtor, creditor), 0L);\n    }\n}"
          },
          {
            "file": "BrokenBalanceSheet.java",
            "body": "import java.util.HashMap;\nimport java.util.Map;\n\npublic class BrokenBalanceSheet {\n    private final Map<String, Long> owedCents = new HashMap<>();\n\n    public void addDebt(String debtor, String creditor, long cents) {\n        String k = debtor + \"->\" + creditor;\n        long current = owedCents.getOrDefault(k, 0L);   // thread A and B both read 500\n        owedCents.put(k, current + cents);              // A writes 700, B overwrites with 800: A's 200 is lost\n    }\n}"
          }
        ],
        "alternatives": [
          "`LongAdder` per pair when you only ever add and rarely read.",
          "A per-pair `ReentrantLock` if an update needs to touch more than one value.",
          "**Optimistic version** in the database: `UPDATE ... SET amount = ?, version = version + 1 WHERE id = ? AND version = ?`, and retry on 0 rows."
        ],
        "say": "\"Updating a balance is a read-modify-write, so I use an atomic merge instead of get then put. And I keep money in integer cents so the arithmetic is exact.\""
      },
      {
        "title": "An expense must update several people atomically without deadlocking",
        "race": "Expense 1 (paid by Alice, split with Bob) locks Alice then Bob. At the same time, Expense 2 (paid by Bob, split with Alice) locks Bob then Alice. Thread 1 holds Alice and waits for Bob. Thread 2 holds Bob and waits for Alice. **Deadlock**: neither ever proceeds.",
        "why": "Two threads acquire the same locks in **different orders**, which creates a cycle in the wait-for graph. Without locks at all you'd have the opposite problem: a reader could see the payer credited but the participants not yet debited, so the group's balances don't sum to zero.",
        "fix": "Lock every involved user, but always in a **global, deterministic order**, here sorted by user ID. If every thread acquires locks in the same order, a cycle is impossible. Release in reverse order in a `finally` block so a failure can't leave anyone locked.\n\nHolding all the locks makes the whole expense **atomic**: no observer ever sees a half-applied expense, and the sum of all net balances is always zero.",
        "code": [
          {
            "file": "ExpenseService.java",
            "body": "import java.util.ArrayList;\nimport java.util.Comparator;\nimport java.util.List;\nimport java.util.concurrent.locks.ReentrantLock;\n\npublic class ExpenseService {\n    public static class User {\n        final String id;\n        long netCents;                       // positive = is owed, negative = owes\n        final ReentrantLock lock = new ReentrantLock();\n\n        public User(String id) { this.id = id; }\n        public long net() { return netCents; }\n    }\n\n    /** Equal split. Updates payer and all participants as one atomic unit. */\n    public void addExpense(User payer, List<User> participants, long totalCents) {\n        List<User> involved = new ArrayList<>(participants);\n        if (!involved.contains(payer)) involved.add(payer);\n        involved.sort(Comparator.comparing(u -> u.id));          // same global order for every thread\n\n        for (User u : involved) u.lock.lock();\n        try {\n            int n = participants.size();\n            long share = totalCents / n;\n            long remainder = totalCents % n;\n            payer.netCents += totalCents;\n            for (int i = 0; i < n; i++) {\n                participants.get(i).netCents -= share + (i < remainder ? 1 : 0);\n            }\n        } finally {\n            for (int i = involved.size() - 1; i >= 0; i--) involved.get(i).lock.unlock();\n        }\n    }\n}"
          }
        ],
        "alternatives": [
          "`tryLock` with a timeout and a back-off retry. Handles deadlock when you can't impose an order, but can livelock.",
          "One lock per **group** instead of per user: simpler and deadlock-free, but all expenses in a group are serialised.",
          "A database transaction updating all the rows, ordered by ID in the statement (`ORDER BY id FOR UPDATE`)."
        ],
        "say": "\"An expense touches several users, so I need them all locked together for atomicity. To avoid deadlock I always acquire locks in sorted user-ID order. If the group is small and writes are rare, a single lock per group is an even simpler answer.\""
      },
      {
        "title": "A double tap on \"Add expense\" creates it twice",
        "race": "A user taps **Save** on a slow connection and nothing seems to happen, so they tap again. Two requests arrive within milliseconds. Both pass validation and both create an expense, so every participant is charged twice for dinner.",
        "why": "Both requests are valid and independent from the server's point of view. Nothing tells it that they represent the same user intent, so each one has a real effect.",
        "fix": "Have the client generate a **request ID** (a UUID) when the form is opened and send it with every submit. The server creates the expense with `computeIfAbsent(requestId, ...)`, which runs the creation at most once per ID even when both requests arrive at the same instant, and returns the existing expense to the second caller.\n\nIn a database this is a unique index on `request_id` with an insert-or-return-existing.",
        "code": [
          {
            "file": "ExpenseLedger.java",
            "body": "import java.util.concurrent.ConcurrentHashMap;\nimport java.util.concurrent.atomic.AtomicLong;\n\npublic class ExpenseLedger {\n    public record Expense(String id, String payerId, long totalCents) {}\n\n    private final ConcurrentHashMap<String, Expense> byRequestId = new ConcurrentHashMap<>();\n    private final AtomicLong nextId = new AtomicLong();\n\n    /** The client sends the same requestId on a double tap or a retry after a timeout. */\n    public Expense create(String requestId, String payerId, long totalCents) {\n        return byRequestId.computeIfAbsent(requestId,\n                r -> new Expense(\"E\" + nextId.incrementAndGet(), payerId, totalCents));\n    }\n}"
          }
        ],
        "alternatives": [
          "Disable the button after the first tap: helps the UI, but does not protect against retries from the network layer.",
          "Detect duplicates by content (same payer, amount and participants within a few seconds). Fragile, because legitimate repeated expenses exist.",
          "Use the unique constraint and catch the duplicate-key error."
        ],
        "say": "\"The UI can't be trusted to prevent duplicates, so the server enforces it. The client sends a request ID and the server creates the expense once per ID, returning the same result on a retry.\""
      }
    ]
  },
  {
    "id": "vending-machine",
    "scenarios": [
      {
        "title": "Two buyers for the last can",
        "race": "Slot A3 has **1** can left. A physical user and a mobile-app order (or two app users) press *buy* at nearly the same moment. Both threads run `if (stock > 0)` and see 1. Both then decrement: stock becomes **-1**, two sales are confirmed and one can exists. One customer has paid for nothing.",
        "why": "Checking the stock and decrementing it are separate steps, so the answer \"is there one left?\" can be true for two threads at once. The stock figure is a shared resource that more than one buyer is trying to claim.",
        "fix": "Claim the unit with an atomic **compare-and-set loop**: read the current stock, return false if it is zero, otherwise try to swap it to `current - 1`, and retry if another thread changed it in between. Exactly one buyer succeeds for the last unit and everyone else gets a clean \"sold out\", with stock never going negative.\n\nTreat it as a **reservation**: take the unit when the buyer commits to the purchase, and call `release()` if payment or dispensing fails, so a failed sale doesn't permanently lose a can.",
        "code": [
          {
            "file": "Slot.java",
            "body": "import java.util.concurrent.atomic.AtomicInteger;\n\npublic class Slot {\n    private final AtomicInteger stock;\n\n    public Slot(int initialStock) {\n        this.stock = new AtomicInteger(initialStock);\n    }\n\n    /** Reserve one unit. Returns false if none left; never goes below zero. */\n    public boolean tryTake() {\n        int current;\n        do {\n            current = stock.get();\n            if (current == 0) return false;\n        } while (!stock.compareAndSet(current, current - 1));   // retry if someone else changed it\n        return true;\n    }\n\n    /** Give the unit back if dispensing fails or the sale is cancelled. */\n    public void release() { stock.incrementAndGet(); }\n\n    public void restock(int n) { stock.addAndGet(n); }\n\n    public int available() { return stock.get(); }\n}"
          },
          {
            "file": "BrokenSlot.java",
            "body": "public class BrokenSlot {\n    private int stock;\n\n    public BrokenSlot(int stock) { this.stock = stock; }\n\n    public boolean tryTake() {\n        if (stock > 0) {     // both buyers see stock == 1\n            stock--;         // second decrement makes stock -1: two cans sold, one existed\n            return true;\n        }\n        return false;\n    }\n}"
          }
        ],
        "alternatives": [
          "`synchronized` on the slot: simplest, and perfectly fine for a single machine.",
          "Database conditional update when stock lives in a server: `UPDATE slot SET stock = stock - 1 WHERE id = ? AND stock > 0` and check the affected row count.",
          "**Reserve with a timeout** for app orders, so a unit isn't held forever by someone who never pays."
        ],
        "say": "\"Selling the last unit is a check-then-act, so I make the decrement atomic, with a CAS loop in memory or a conditional UPDATE in the database. Whoever wins the claim gets the can, and I give the unit back if the sale fails.\""
      },
      {
        "title": "Refund pressed while the machine is dispensing",
        "race": "The customer selects a drink and the machine starts the motor. Half a second later they press **Refund**. Thread 1 (dispense) has already deducted the price, but thread 2 (refund) reads the old balance and pays the **full amount** back as coins. The customer gets both the drink and their money.",
        "why": "The machine is a **state machine** whose transitions are not atomic. A refund request is evaluated against the old state while the select transition is still partly applied, so two operations that should be mutually exclusive both succeed.",
        "fix": "Guard every state transition with one lock (`synchronized`) and make each transition check the current state before acting. `select` deducts the price **and** moves to `DISPENSING` in the same critical section. A refund arriving afterwards sees `DISPENSING` and returns nothing. Inserting a coin during dispensing is rejected the same way.\n\nKeep the lock only around the quick state change. The slow mechanical dispense happens outside it, and the motor reports back through `finishDispense()`.",
        "code": [
          {
            "file": "VendingMachine.java",
            "body": "public class VendingMachine {\n    public enum State { IDLE, HAS_MONEY, DISPENSING }\n\n    private State state = State.IDLE;\n    private int balance;\n\n    public synchronized void insertCoin(int coin) {\n        if (state == State.DISPENSING) throw new IllegalStateException(\"busy dispensing\");\n        balance += coin;\n        state = State.HAS_MONEY;\n    }\n\n    /** Commit the sale and flip to DISPENSING in the same critical section. */\n    public synchronized boolean select(int price) {\n        if (state != State.HAS_MONEY || balance < price) return false;\n        balance -= price;\n        state = State.DISPENSING;\n        return true;\n    }\n\n    /** A refund that arrives mid-dispense sees DISPENSING and gets nothing, instead of double paying out. */\n    public synchronized int refund() {\n        if (state != State.HAS_MONEY) return 0;\n        int refund = balance;\n        balance = 0;\n        state = State.IDLE;\n        return refund;\n    }\n\n    /** Motor finished: return leftover change and go back to IDLE. */\n    public synchronized int finishDispense() {\n        if (state != State.DISPENSING) throw new IllegalStateException(\"not dispensing\");\n        int change = balance;\n        balance = 0;\n        state = State.IDLE;\n        return change;\n    }\n}"
          }
        ],
        "alternatives": [
          "Model states as the **State pattern**, where each state class decides which operations are legal. Same locking rule applies.",
          "Single-threaded event queue for every button press, so only one operation is ever in flight.",
          "A `ReentrantLock` with `tryLock` to reject, rather than queue, an operation when the machine is busy."
        ],
        "say": "\"The machine is a state machine, so I make each transition atomic and check the state under the same lock. Select deducts the price and flips to DISPENSING in one step, so a refund arriving later is simply rejected.\""
      }
    ]
  }
);
