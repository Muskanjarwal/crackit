window.CONCURRENCY = window.CONCURRENCY || [];
window.CONCURRENCY.push(
  {
    "id": "file-storage-system",
    "scenarios": [
      {
        "title": "Two people save the same file at the same time",
        "race": "Alice and Bob both open `notes.txt` at **v1**. Alice saves, the file becomes v2. Bob saves a second later from his stale copy. A naive `file.content = newContent` silently overwrites Alice's work and nobody is told.",
        "why": "This is a **lost update**: both writers read the same state, changed it independently, and the last write wins. The check \"is my copy still the latest?\" and the write are two separate steps, so another writer can slip in between them.",
        "fix": "Treat every save as a compare-and-set on the version number. The client sends the version it edited (`baseVersion`). The store applies the write only if that is still the latest version, and in the same atomic step bumps the version. The loser gets a conflict and must reload, merge and retry.\n\n`ConcurrentHashMap.compute` makes the check and the write atomic for one path, so there is no lock to hold while you do anything slow. This is optimistic locking: no one blocks, conflicts are detected instead of prevented.",
        "code": [
          {
            "file": "VersionedFileStore.java",
            "body": "import java.util.concurrent.ConcurrentHashMap;\n\npublic class VersionedFileStore {\n    public record FileVersion(long version, String content) {}\n\n    public static class ConflictException extends RuntimeException {\n        public ConflictException(String message) { super(message); }\n    }\n\n    private final ConcurrentHashMap<String, FileVersion> files = new ConcurrentHashMap<>();\n\n    public FileVersion create(String path, String content) {\n        FileVersion v = new FileVersion(1, content);\n        if (files.putIfAbsent(path, v) != null) throw new ConflictException(path + \" already exists\");\n        return v;\n    }\n\n    /** Saves only if the caller edited the version that is still the latest. */\n    public FileVersion save(String path, long baseVersion, String content) {\n        FileVersion[] saved = new FileVersion[1];\n        files.compute(path, (p, current) -> {            // atomic per key\n            if (current == null) throw new ConflictException(p + \" was deleted\");\n            if (current.version() != baseVersion) {\n                throw new ConflictException(\"stale edit: based on v\" + baseVersion + \" but latest is v\" + current.version());\n            }\n            saved[0] = new FileVersion(current.version() + 1, content);\n            return saved[0];\n        });\n        return saved[0];\n    }\n\n    public FileVersion read(String path) { return files.get(path); }\n\n    public static void main(String[] args) throws Exception {\n        VersionedFileStore store = new VersionedFileStore();\n        store.create(\"/notes.txt\", \"hello\");\n        Thread alice = new Thread(() -> edit(store, \"alice\"));\n        Thread bob = new Thread(() -> edit(store, \"bob\"));\n        alice.start(); bob.start(); alice.join(); bob.join();\n        System.out.println(\"final: \" + store.read(\"/notes.txt\"));\n    }\n\n    private static void edit(VersionedFileStore store, String who) {\n        try {\n            System.out.println(who + \" saved \" + store.save(\"/notes.txt\", 1, \"edited by \" + who));\n        } catch (ConflictException e) {\n            System.out.println(who + \" rejected: \" + e.getMessage());\n        }\n    }\n}"
          }
        ],
        "alternatives": [
          "Pessimistic check-out lock (like SharePoint): one editor holds a lock, others are read-only. Safe, but locks get abandoned, so you need lease timeouts.",
          "Operational transforms or CRDTs for real-time co-editing (Google Docs). Much more work, only worth it for live collaborative text.",
          "Store every save as a new immutable version and let users pick or merge, so nothing is ever lost."
        ],
        "say": "\"Two concurrent saves are a lost-update problem. I'd version every file and make save a compare-and-set on the base version: if it isn't the latest, I reject with a conflict and the client merges. That avoids holding locks while users type. If product wants no conflicts at all I'd add a lease-based check-out lock instead.\""
      },
      {
        "title": "A share is revoked while the download is starting",
        "race": "Alice shares `salary.xlsx` with Bob. Bob's download request checks permission and passes. Before the bytes are read, Alice revokes Bob's access. If the check and the read are separate steps, Bob can still receive the file after the revoke call has returned success to Alice.",
        "why": "A **time-of-check to time-of-use** gap. The permission was true when checked and false when used. Alice has been told access is gone, but it isn't.",
        "fix": "Put the permission check and the read inside one critical section and make revoke take the exclusive side of the same lock. With a read-write lock, many downloads run in parallel (shared read lock), while grant and revoke wait for in-flight reads and then block new ones.\n\nAfter `revoke` returns, any new download re-checks the ACL under the lock and fails. A download that already started before the revoke may finish, and that is the correct semantics: it began while access was valid.",
        "code": [
          {
            "file": "SecureFile.java",
            "body": "import java.util.HashSet;\nimport java.util.Set;\nimport java.util.concurrent.locks.ReadWriteLock;\nimport java.util.concurrent.locks.ReentrantReadWriteLock;\n\npublic class SecureFile {\n    private final String content;\n    private final Set<String> allowedReaders = new HashSet<>();\n    private final ReadWriteLock lock = new ReentrantReadWriteLock();\n\n    public SecureFile(String content) { this.content = content; }\n\n    public void grant(String user) {\n        lock.writeLock().lock();\n        try { allowedReaders.add(user); } finally { lock.writeLock().unlock(); }\n    }\n\n    public void revoke(String user) {\n        lock.writeLock().lock();\n        try { allowedReaders.remove(user); } finally { lock.writeLock().unlock(); }\n    }\n\n    /** The permission check and the read happen inside ONE critical section. */\n    public String download(String user) {\n        lock.readLock().lock();\n        try {\n            if (!allowedReaders.contains(user)) throw new SecurityException(user + \" has no access\");\n            return content;\n        } finally {\n            lock.readLock().unlock();\n        }\n    }\n\n    public static void main(String[] args) {\n        SecureFile file = new SecureFile(\"salary.xlsx bytes\");\n        file.grant(\"bob\");\n        System.out.println(\"before revoke: \" + file.download(\"bob\"));\n        file.revoke(\"bob\");\n        try {\n            file.download(\"bob\");\n        } catch (SecurityException e) {\n            System.out.println(\"after revoke: \" + e.getMessage());\n        }\n    }\n}"
          }
        ],
        "alternatives": [
          "Immutable ACL snapshots with a version number: each download reads one snapshot and validates against it, with no lock on the read path.",
          "Short-lived signed download URLs, so a leaked or revoked link expires on its own within minutes.",
          "In a multi-server deployment keep the ACL in one authoritative store (or use a version check against it) so every node sees the revoke."
        ],
        "say": "\"The danger is a gap between checking permission and reading. I'd make the check and the read one atomic section, using a read-write lock per file so downloads stay concurrent and revoke is exclusive. Across servers the ACL lives in one source of truth and downloads use short-lived signed URLs so a revoke takes effect quickly.\""
      }
    ]
  },
  {
    "id": "chat-application",
    "scenarios": [
      {
        "title": "Two senders posting to one room get out-of-order sequence numbers",
        "race": "Thread A takes `seq = 7`, thread B takes `seq = 8`, then B appends to the log first. The log now reads 8, 7. Clients that sort by arrival see one order, clients that sort by `seq` see another, and \"load messages after 7\" can skip message 8 entirely.",
        "why": "Two steps that must be one: **assign the sequence number** and **append to the log**. Each step may be thread-safe on its own (an `AtomicLong` plus a concurrent list), yet the pair still interleaves.",
        "fix": "Make allocate-and-append a single critical section per room. Different rooms stay fully parallel because each room has its own lock.\n\nThe sequence number is the room's single source of truth for ordering, so clients fetch with `since(lastSeenSeq)` and can detect gaps. In a distributed system the same idea becomes **one writer per room** (route a room to one partition or shard) rather than a shared lock.",
        "code": [
          {
            "file": "ChatRoom.java",
            "body": "import java.util.ArrayList;\nimport java.util.List;\n\npublic class ChatRoom {\n    public record Message(long seq, String sender, String text) {}\n\n    private final List<Message> log = new ArrayList<>();\n    private long nextSeq = 1;\n\n    /** Assigning the sequence number and appending must be ONE atomic step. */\n    public synchronized Message post(String sender, String text) {\n        Message m = new Message(nextSeq++, sender, text);\n        log.add(m);\n        return m;\n    }\n\n    public synchronized List<Message> since(long afterSeq) {\n        return new ArrayList<>(log.subList((int) afterSeq, log.size()));\n    }\n\n    public static void main(String[] args) throws Exception {\n        ChatRoom room = new ChatRoom();\n        Thread[] senders = new Thread[4];\n        for (int t = 0; t < senders.length; t++) {\n            String name = \"user\" + t;\n            senders[t] = new Thread(() -> { for (int i = 0; i < 1000; i++) room.post(name, \"hi \" + i); });\n            senders[t].start();\n        }\n        for (Thread t : senders) t.join();\n        List<Message> all = room.since(0);\n        boolean ordered = true;\n        for (int i = 0; i < all.size(); i++) ordered &= all.get(i).seq() == i + 1;\n        System.out.println(all.size() + \" messages, log order matches seq order: \" + ordered);\n    }\n}"
          }
        ],
        "alternatives": [
          "Partition by room id in a log such as Kafka: one partition has one total order, with no application-level lock.",
          "Database sequence per room, inserted in the same transaction as the message row.",
          "Lamport or hybrid logical clocks if rooms are replicated across regions and you accept approximate ordering."
        ],
        "say": "\"Message order only has to hold inside a room, so I'd give each room a monotonically increasing sequence assigned in the same critical section that appends the message. Rooms don't contend with each other. At scale that becomes one writer per room by partitioning on room id.\""
      },
      {
        "title": "A client retries a send and the message is delivered twice",
        "race": "The phone sends \"hello\" and the connection drops before the ack arrives. The app retries. If the first request actually succeeded, the room now has two \"hello\" messages. Worse, both requests can arrive at two server threads at the same moment.",
        "why": "Networks give **at-least-once** delivery, not exactly-once. The server cannot tell a retry from a genuinely new message unless the client tells it. And a plain \"if not exists then insert\" check is itself a check-then-act race.",
        "fix": "The client generates a `clientMsgId` once per message and reuses it on every retry. The server keys messages by `(sender, clientMsgId)` and uses an atomic create-if-absent, so the second request returns the original message instead of creating a new one.\n\nIn a database, the same guarantee comes from a unique index on `(sender_id, client_msg_id)` with insert-or-ignore, and the server then reads back the existing row.",
        "code": [
          {
            "file": "DedupingMessageService.java",
            "body": "import java.util.concurrent.ConcurrentHashMap;\nimport java.util.concurrent.atomic.AtomicLong;\n\npublic class DedupingMessageService {\n    public record Message(long id, String sender, String clientMsgId, String text) {}\n\n    private final ConcurrentHashMap<String, Message> bySenderAndClientId = new ConcurrentHashMap<>();\n    private final AtomicLong ids = new AtomicLong();\n\n    /** A retry with the same clientMsgId returns the original message instead of creating a new one. */\n    public Message send(String sender, String clientMsgId, String text) {\n        return bySenderAndClientId.computeIfAbsent(sender + \":\" + clientMsgId,\n                key -> new Message(ids.incrementAndGet(), sender, clientMsgId, text));\n    }\n\n    public static void main(String[] args) throws Exception {\n        DedupingMessageService service = new DedupingMessageService();\n        Thread[] retries = new Thread[8];\n        long[] seen = new long[retries.length];\n        for (int i = 0; i < retries.length; i++) {\n            int slot = i;\n            retries[i] = new Thread(() -> seen[slot] = service.send(\"alice\", \"c-42\", \"hello\").id());\n            retries[i].start();\n        }\n        for (Thread t : retries) t.join();\n        System.out.println(\"distinct message ids across 8 retries: \" + java.util.Arrays.stream(seen).distinct().count());\n    }\n}"
          }
        ],
        "alternatives": [
          "Unique constraint in the database as the final arbiter, with the in-memory map only as a fast path.",
          "Expire dedupe keys after a window (say 24 hours) to bound memory.",
          "Client-side dedupe on delivery too, using the server message id, because push notifications can also repeat."
        ],
        "say": "\"Retries make delivery at-least-once, so I make sends idempotent. The client attaches a unique id to each message, and the server does an atomic create-if-absent on sender plus that id. A retry returns the original message. In the database that's a unique index.\""
      }
    ]
  },
  {
    "id": "otp-generation-system",
    "scenarios": [
      {
        "title": "Brute-forcing past the retry limit with parallel guesses",
        "race": "The limit is 3 attempts. An attacker fires 200 guesses at once. Each request reads `attempts = 0`, sees it is below the limit, compares its guess, and only then increments. All 200 pass the check, and a 6-digit code (1,000,000 possibilities) becomes very guessable.",
        "why": "**Check-then-act** on the counter: `if (attempts < max) { compare(); attempts++; }`. The limit is enforced against a stale value. Concurrency turns \"3 tries\" into \"as many as I can send in the same few milliseconds\".",
        "fix": "Claim the attempt first, then decide. `incrementAndGet()` is atomic, so each request gets a unique attempt number. Only attempts numbered 1 to 3 are allowed to compare against the code. Everything above the limit is rejected without comparing, and the first over-limit request invalidates the code.\n\nCompare with a constant-time check (`MessageDigest.isEqual`) so timing doesn't leak how many digits were right.",
        "code": [
          {
            "file": "OtpVerifier.java",
            "body": "import java.nio.charset.StandardCharsets;\nimport java.security.MessageDigest;\nimport java.util.concurrent.ConcurrentHashMap;\nimport java.util.concurrent.atomic.AtomicInteger;\n\npublic class OtpVerifier {\n    private static final int MAX_ATTEMPTS = 3;\n\n    private static class Entry {\n        final String code;\n        final AtomicInteger attempts = new AtomicInteger();\n        Entry(String code) { this.code = code; }\n    }\n\n    private final ConcurrentHashMap<String, Entry> otps = new ConcurrentHashMap<>();\n    final AtomicInteger comparisons = new AtomicInteger();   // exposed only for the demo\n\n    public void issue(String user, String code) { otps.put(user, new Entry(code)); }\n\n    public boolean verify(String user, String guess) {\n        Entry e = otps.get(user);\n        if (e == null) return false;\n        int attempt = e.attempts.incrementAndGet();          // claim an attempt BEFORE comparing\n        if (attempt > MAX_ATTEMPTS) {\n            otps.remove(user, e);                            // locked out: invalidate the code\n            return false;\n        }\n        comparisons.incrementAndGet();\n        return MessageDigest.isEqual(\n                e.code.getBytes(StandardCharsets.UTF_8), guess.getBytes(StandardCharsets.UTF_8));\n    }\n\n    public static void main(String[] args) throws Exception {\n        OtpVerifier verifier = new OtpVerifier();\n        verifier.issue(\"alice\", \"482913\");\n        Thread[] attackers = new Thread[200];\n        for (int i = 0; i < attackers.length; i++) {\n            String guess = String.format(\"%06d\", 482000 + i);       // the right code is among the guesses\n            attackers[i] = new Thread(() -> verifier.verify(\"alice\", guess));\n            attackers[i].start();\n        }\n        for (Thread t : attackers) t.join();\n        System.out.println(\"guesses fired: 200, guesses actually compared: \" + verifier.comparisons.get());\n    }\n}"
          }
        ],
        "alternatives": [
          "Rate limit per user and per IP in front of this (token bucket), so brute force is slowed even before the counter.",
          "Redis `INCR` with `EXPIRE` for the attempt counter when verification runs on many servers.",
          "Lock the account or force a fresh OTP after repeated failures."
        ],
        "say": "\"The counter check has to be atomic with the increment, otherwise parallel guesses all see the old count. I increment first and only compare if my attempt number is within the limit. Across servers that's a Redis INCR. I'd also compare in constant time and rate limit at the edge.\""
      },
      {
        "title": "The same OTP accepted twice, or accepted at the moment it expires",
        "race": "Two requests carrying the correct code arrive together. Both read the OTP, both see it valid, both mark it used afterwards: two logins (or two payments) from one code. Separately, a request at 10:05:00.000 reads the OTP as valid at 10:04:59.999 and acts on it after it has expired.",
        "why": "Validity (not expired, not used, matches) is checked in one step and the OTP is consumed in another. Another request, or the clock, can change the answer in between.",
        "fix": "Do expiry check, comparison and consumption as one atomic operation per user. `ConcurrentHashMap.compute` runs the whole function under the key's lock: it drops expired codes, keeps the entry on a wrong guess (so retries still work), and removes it on a correct guess. Exactly one of N concurrent correct submissions sees the entry and wins.\n\nInject a `Clock` so expiry is testable, and define the boundary clearly (here, valid strictly before `expiresAt`).",
        "code": [
          {
            "file": "SingleUseOtpStore.java",
            "body": "import java.time.Clock;\nimport java.time.Duration;\nimport java.time.Instant;\nimport java.time.ZoneOffset;\nimport java.util.concurrent.ConcurrentHashMap;\nimport java.util.concurrent.atomic.AtomicInteger;\n\npublic class SingleUseOtpStore {\n    public record Otp(String code, Instant expiresAt) {}\n\n    private final ConcurrentHashMap<String, Otp> otps = new ConcurrentHashMap<>();\n    private final Clock clock;\n\n    public SingleUseOtpStore(Clock clock) { this.clock = clock; }\n\n    public void issue(String user, String code, Duration ttl) {\n        otps.put(user, new Otp(code, clock.instant().plus(ttl)));\n    }\n\n    /** Expiry check, comparison and consumption are one atomic step per user. */\n    public boolean consume(String user, String guess) {\n        boolean[] accepted = {false};\n        otps.compute(user, (u, otp) -> {\n            if (otp == null) return null;\n            if (!clock.instant().isBefore(otp.expiresAt())) return null;   // expired: drop it\n            if (!otp.code().equals(guess)) return otp;                      // wrong guess: keep for retries\n            accepted[0] = true;\n            return null;                                                    // correct: remove so it works once\n        });\n        return accepted[0];\n    }\n\n    public static void main(String[] args) throws Exception {\n        SingleUseOtpStore store = new SingleUseOtpStore(Clock.systemUTC());\n        store.issue(\"alice\", \"482913\", Duration.ofMinutes(5));\n        AtomicInteger accepted = new AtomicInteger();\n        Thread[] replays = new Thread[10];\n        for (int i = 0; i < replays.length; i++) {\n            replays[i] = new Thread(() -> { if (store.consume(\"alice\", \"482913\")) accepted.incrementAndGet(); });\n            replays[i].start();\n        }\n        for (Thread t : replays) t.join();\n        System.out.println(\"10 concurrent submits of the correct code, accepted: \" + accepted.get());\n\n        Clock fixedNow = Clock.fixed(Instant.parse(\"2026-01-01T10:00:00Z\"), ZoneOffset.UTC);\n        SingleUseOtpStore expired = new SingleUseOtpStore(fixedNow);\n        expired.issue(\"bob\", \"111111\", Duration.ZERO);\n        System.out.println(\"submit at the exact expiry instant: \" + expired.consume(\"bob\", \"111111\"));\n    }\n}"
          }
        ],
        "alternatives": [
          "Redis: `GETDEL` or a small Lua script (compare and delete) gives the same atomic consume across servers; store the code with a TTL so expiry is automatic.",
          "SQL: `UPDATE otp SET used = true WHERE user_id = ? AND code = ? AND used = false AND expires_at > now()` and check that one row was affected.",
          "Bind the OTP to the action (login vs payment) and to a request id, so a code for one purpose can't be replayed for another."
        ],
        "say": "\"Verify and consume must be a single atomic step, otherwise replays win. I'd use compute on a concurrent map in memory, or a conditional UPDATE or Redis GETDEL in production, where exactly one caller gets the row. Expiry is checked inside the same step against an injected clock.\""
      }
    ]
  },
  {
    "id": "limited-stock-cart",
    "scenarios": [
      {
        "title": "Stock is 1 and two buyers check out together",
        "race": "`stock = 1`. Buyer A reads 1, buyer B reads 1 (both pass `if (stock > 0)`). A decrements to 0, B decrements to -1. Two orders confirmed for one item. This is **overselling**, and the first tab shows exactly how it happens.",
        "why": "The classic **check-then-act** race: reading the stock and decrementing it are two steps with a gap in between (a DB round trip, a network call, even just a context switch). Any number of buyers can pass the check inside that gap.",
        "fix": "Fuse the check and the decrement into one atomic operation, so only one buyer can move stock from 1 to 0.\n\nIn memory use a **compare-and-set loop**: read the current value, bail out if it is too low, and only commit if nobody changed it meanwhile (otherwise re-read and retry). In a database use a **conditional UPDATE**: `WHERE stock >= 1` is the check and `SET stock = stock - 1` is the act, in one statement, and \"1 row affected\" means you got the unit.\n\nLosers get a clean \"out of stock\" and the stock never goes negative. Also add a `CHECK (stock >= 0)` constraint as a safety net.",
        "code": [
          {
            "file": "BrokenInventory.java",
            "body": "public class BrokenInventory {\n    private int available;\n\n    public BrokenInventory(int units) { this.available = units; }\n\n    // BUG: check-then-act. Two threads can both see available == 1.\n    public boolean tryTake() {\n        if (available > 0) {\n            pause();                    // stands in for a DB round trip or any gap between check and write\n            available--;\n            return true;\n        }\n        return false;\n    }\n\n    private static void pause() {\n        try { Thread.sleep(5); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }\n    }\n\n    public static void main(String[] args) throws Exception {\n        BrokenInventory stock = new BrokenInventory(1);\n        java.util.concurrent.atomic.AtomicInteger sold = new java.util.concurrent.atomic.AtomicInteger();\n        Thread[] buyers = new Thread[2];\n        for (int i = 0; i < buyers.length; i++) {\n            buyers[i] = new Thread(() -> { if (stock.tryTake()) sold.incrementAndGet(); });\n            buyers[i].start();\n        }\n        for (Thread t : buyers) t.join();\n        System.out.println(\"units in stock: 1, units sold: \" + sold.get());\n    }\n}"
          },
          {
            "file": "StockCounter.java",
            "body": "import java.util.concurrent.CountDownLatch;\nimport java.util.concurrent.atomic.AtomicInteger;\n\npublic class StockCounter {\n    private final AtomicInteger available;\n\n    public StockCounter(int units) { this.available = new AtomicInteger(units); }\n\n    /** Takes qty units or nothing. The check and the decrement are one atomic step. */\n    public boolean tryTake(int qty) {\n        while (true) {\n            int current = available.get();\n            if (current < qty) return false;\n            if (available.compareAndSet(current, current - qty)) return true;   // lost the race? re-read and retry\n        }\n    }\n\n    public void putBack(int qty) { available.addAndGet(qty); }\n\n    public int available() { return available.get(); }\n\n    public static void main(String[] args) throws Exception {\n        StockCounter stock = new StockCounter(1);\n        AtomicInteger bought = new AtomicInteger();\n        CountDownLatch start = new CountDownLatch(1);\n        Thread[] buyers = new Thread[50];\n        for (int i = 0; i < buyers.length; i++) {\n            buyers[i] = new Thread(() -> {\n                try { start.await(); } catch (InterruptedException e) { return; }\n                if (stock.tryTake(1)) bought.incrementAndGet();\n            });\n            buyers[i].start();\n        }\n        start.countDown();\n        for (Thread t : buyers) t.join();\n        System.out.println(\"buyers: 50, units: 1, successful checkouts: \" + bought.get() + \", left: \" + stock.available());\n    }\n}"
          },
          {
            "file": "ReserveStock.sql",
            "body": "-- One statement, one atomic step. The WHERE clause is the check, the SET is the act.\nUPDATE inventory\n   SET stock = stock - 1\n WHERE sku = ?\n   AND stock >= 1;\n\n-- Application code: if the driver reports 1 row affected you own the unit,\n-- if it reports 0 rows someone else took it first. Never SELECT stock then UPDATE."
          }
        ],
        "alternatives": [
          "`SELECT ... FOR UPDATE` inside a transaction: lock the inventory row, check, update, commit. Correct, but other buyers wait on the lock and a hot SKU becomes a bottleneck.",
          "Optimistic version column: `UPDATE ... SET stock = stock - 1, version = version + 1 WHERE sku = ? AND version = ?` and retry on 0 rows. Fine at low contention, wasteful for flash sales.",
          "Redis `DECR` (or a Lua script that checks and decrements) in front of the database for very hot items, with the DB as the source of truth."
        ],
        "say": "\"Reading stock and decrementing it can't be separate steps. I'd make it one atomic conditional update: decrement only where stock is at least the quantity, and treat rows-affected as the answer. Exactly one buyer wins the last unit and the rest get out-of-stock. A non-negative constraint is my safety net.\""
      },
      {
        "title": "Add to cart: should it reserve the item? Soft vs hard reservation",
        "race": "The product has 1 unit. Alice adds it to her cart and walks away. Bob can't buy it for hours because it \"is in a cart\". Or the opposite: nothing is reserved, Alice and Bob both reach the payment page, and one of them is told \"sorry, gone\" after typing their card number.",
        "why": "Two different promises are being mixed up. **Add to cart** is intent, and carts are abandoned most of the time. **Checkout** is commitment. Locking stock on every add-to-cart lets idle carts starve real buyers (and lets bots drain inventory). Reserving nothing until payment surprises users late.",
        "fix": "Use a **soft reservation for the cart and a hard reservation with a TTL for checkout**:\n\n1. Add to cart: no stock change. Show \"only 1 left\" using availability, but make no promise.\n2. Start checkout: atomically take a **hold** if `onHand - activeHolds >= qty`. The hold has an expiry (say 5 minutes) and counts against availability.\n3. Payment success: confirm the hold (deduct `onHand`). Failure, abandon or expiry: the hold disappears and the unit is available again.\n\nAll of this is decided under one lock per SKU, so two buyers can never both hold the last unit. Expired holds are ignored (and cleaned up) at read time, so availability is always correct even if a background sweeper runs late.",
        "code": [
          {
            "file": "SkuStock.java",
            "body": "import java.time.Clock;\nimport java.time.Duration;\nimport java.time.Instant;\nimport java.util.HashMap;\nimport java.util.Map;\nimport java.util.Optional;\nimport java.util.UUID;\n\n/** Adding to a cart is a soft intent and touches nothing here. Starting checkout takes a hold with a TTL. */\npublic class SkuStock {\n    public record Hold(String id, int qty, Instant expiresAt) {}\n\n    private int onHand;\n    private final Map<String, Hold> holds = new HashMap<>();\n    private final Clock clock;\n    private final Duration ttl;\n\n    public SkuStock(int onHand, Clock clock, Duration ttl) {\n        this.onHand = onHand;\n        this.clock = clock;\n        this.ttl = ttl;\n    }\n\n    private void dropExpired() {\n        holds.values().removeIf(h -> !clock.instant().isBefore(h.expiresAt()));\n    }\n\n    private int heldQty() {\n        return holds.values().stream().mapToInt(Hold::qty).sum();\n    }\n\n    public synchronized int availableToPromise() {\n        dropExpired();\n        return onHand - heldQty();\n    }\n\n    public synchronized Optional<Hold> tryHold(int qty) {\n        dropExpired();\n        if (onHand - heldQty() < qty) return Optional.empty();\n        Hold hold = new Hold(UUID.randomUUID().toString(), qty, clock.instant().plus(ttl));\n        holds.put(hold.id(), hold);\n        return Optional.of(hold);\n    }\n\n    public synchronized boolean confirm(String holdId) {\n        dropExpired();\n        Hold hold = holds.remove(holdId);\n        if (hold == null) return false;            // expired or already used\n        onHand -= hold.qty();\n        return true;\n    }\n\n    public synchronized void release(String holdId) { holds.remove(holdId); }\n\n    public static void main(String[] args) {\n        SkuStock stock = new SkuStock(1, Clock.systemUTC(), Duration.ofMinutes(5));\n        Optional<Hold> alice = stock.tryHold(1);\n        Optional<Hold> bob = stock.tryHold(1);\n        System.out.println(\"alice hold: \" + alice.isPresent() + \", bob hold: \" + bob.isPresent());\n        stock.release(alice.get().id());                       // alice abandons checkout\n        System.out.println(\"after release, bob hold: \" + stock.tryHold(1).isPresent());\n    }\n}"
          }
        ],
        "alternatives": [
          "Reserve on add-to-cart with a short TTL (what ticketing sites do for scarce seats). Simple for users, but vulnerable to hoarding, so cap the quantity per user.",
          "Per-SKU lock striping or a Redis hash per SKU for hold bookkeeping when one JVM isn't enough.",
          "For hot flash sales, a waiting room or queue that lets only N users into checkout at a time."
        ],
        "say": "\"I separate intent from commitment. Add-to-cart doesn't touch stock. When checkout starts I take a time-limited hold, atomically, against on-hand minus active holds, and confirm it on payment. Abandoned holds expire so inventory isn't stuck, and the last unit can only be held by one buyer.\""
      },
      {
        "title": "The hold expires at the same instant the payment succeeds",
        "race": "Alice holds the last unit for 5 minutes. At minute 4:59 she clicks Pay. The gateway takes 3 seconds. The sweeper expires her hold at 5:00 and Bob grabs the unit. Alice's payment then succeeds, and now two people have paid for one item.",
        "why": "Expiry and payment are two actors changing the same hold with no agreed winner. Either order of \"charge, then confirm\" can leave money taken for stock that has been given away.",
        "fix": "Model the hold as a **small state machine** and make every transition a compare-and-set, so exactly one of the competing actors wins:\n\n`HELD -> PAYING -> CONFIRMED` (or `RELEASED` on failure) and `HELD -> EXPIRED`.\n\nCheckout must call `startPayment()` (HELD to PAYING) **before** charging the card. If that returns false, the hold already expired and the customer is told immediately, with no money taken. Once the hold is PAYING the sweeper's `expire()` fails, so the unit can't be resold mid-payment. The gateway call gets its own timeout, after which a PAYING hold is released.\n\nThe demo races both transitions 10,000 times: they never both succeed.",
        "code": [
          {
            "file": "StockHold.java",
            "body": "import java.util.concurrent.CountDownLatch;\nimport java.util.concurrent.atomic.AtomicInteger;\nimport java.util.concurrent.atomic.AtomicReference;\n\npublic class StockHold {\n    public enum State { HELD, PAYING, CONFIRMED, EXPIRED, RELEASED }\n\n    private final AtomicReference<State> state = new AtomicReference<>(State.HELD);\n\n    /** Called by checkout BEFORE charging the card. Only one of this and expire() can win. */\n    public boolean startPayment() { return state.compareAndSet(State.HELD, State.PAYING); }\n\n    public boolean paymentSucceeded() { return state.compareAndSet(State.PAYING, State.CONFIRMED); }\n\n    public boolean paymentFailed() { return state.compareAndSet(State.PAYING, State.RELEASED); }\n\n    /** Called by the TTL sweeper. Cannot touch a hold that is already being paid for. */\n    public boolean expire() { return state.compareAndSet(State.HELD, State.EXPIRED); }\n\n    public State state() { return state.get(); }\n\n    public static void main(String[] args) throws Exception {\n        int rounds = 10_000;\n        AtomicInteger paymentWon = new AtomicInteger();\n        AtomicInteger expiryWon = new AtomicInteger();\n        for (int i = 0; i < rounds; i++) {\n            StockHold hold = new StockHold();\n            CountDownLatch go = new CountDownLatch(1);\n            Thread checkout = new Thread(() -> { await(go); if (hold.startPayment()) paymentWon.incrementAndGet(); });\n            Thread sweeper = new Thread(() -> { await(go); if (hold.expire()) expiryWon.incrementAndGet(); });\n            checkout.start(); sweeper.start();\n            go.countDown();\n            checkout.join(); sweeper.join();\n        }\n        System.out.println(\"rounds: \" + rounds + \", payment won: \" + paymentWon + \", expiry won: \" + expiryWon\n                + \", sum: \" + (paymentWon.get() + expiryWon.get()));\n    }\n\n    private static void await(CountDownLatch latch) {\n        try { latch.await(); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }\n    }\n}"
          }
        ],
        "alternatives": [
          "Charge first, confirm after; if confirm fails (hold gone), refund automatically. Works, but you charge and refund people, which erodes trust.",
          "Extend the TTL when payment starts instead of introducing a PAYING state.",
          "Make the payment request idempotent with a key tied to the hold id, so retries can't charge twice."
        ],
        "say": "\"Expiry and payment race on the same hold, so I make the hold a state machine with compare-and-set transitions. Checkout moves it to PAYING before charging, and the sweeper can only expire a HELD hold. Exactly one wins: either the customer is told it expired before paying, or the unit is safely theirs.\""
      }
    ]
  },
  {
    "id": "quick-commerce-delivery-app",
    "scenarios": [
      {
        "title": "Two multi-item orders race for the last milk and the last bread",
        "race": "A dark store has 1 milk and 1 bread. Order A wants milk then bread, order B wants bread then milk. A reserves the milk, B reserves the bread, and now each waits for the item the other holds: a **deadlock**. If you avoid waiting by simply failing, you can instead end up with A holding the milk and B holding the bread, both orders half-filled and both failing.",
        "why": "A single order touches several SKUs, so it needs several locks (or several conditional updates). Taking them in different orders deadlocks, and reserving item by item without rolling back leaves **partial reservations** that waste stock.",
        "fix": "Reserve the whole basket as one all-or-nothing step, taking per-SKU locks in a **fixed global order** (sorted by SKU). Because everyone acquires milk before bread, nobody can hold bread while waiting for milk, so a cycle is impossible.\n\nWhile holding all locks, first check that every line has enough stock, and only then deduct. If any line is short, nothing is touched and the order fails cleanly (or is offered a substitute). Locks are per SKU, so orders for different products never block each other.",
        "code": [
          {
            "file": "DarkStoreInventory.java",
            "body": "import java.util.ArrayList;\nimport java.util.Collections;\nimport java.util.List;\nimport java.util.Map;\nimport java.util.concurrent.ConcurrentHashMap;\nimport java.util.concurrent.locks.ReentrantLock;\n\npublic class DarkStoreInventory {\n    private final Map<String, Integer> stock = new ConcurrentHashMap<>();\n    private final Map<String, ReentrantLock> locks = new ConcurrentHashMap<>();\n\n    public DarkStoreInventory(Map<String, Integer> initial) {\n        initial.forEach((sku, qty) -> { stock.put(sku, qty); locks.put(sku, new ReentrantLock()); });\n    }\n\n    /** All-or-nothing. Locks are always taken in sorted SKU order, so two orders can never deadlock. */\n    public boolean reserveAll(Map<String, Integer> items) {\n        List<String> skus = new ArrayList<>(items.keySet());\n        Collections.sort(skus);                                   // one global lock order\n        List<ReentrantLock> held = new ArrayList<>();\n        try {\n            for (String sku : skus) {\n                ReentrantLock lock = locks.get(sku);\n                lock.lock();\n                held.add(lock);\n            }\n            for (String sku : skus) {\n                if (stock.getOrDefault(sku, 0) < items.get(sku)) return false;   // nothing has been deducted yet\n            }\n            for (String sku : skus) stock.merge(sku, -items.get(sku), Integer::sum);\n            return true;\n        } finally {\n            for (int i = held.size() - 1; i >= 0; i--) held.get(i).unlock();\n        }\n    }\n\n    public int available(String sku) { return stock.getOrDefault(sku, 0); }\n\n    public static void main(String[] args) throws Exception {\n        DarkStoreInventory store = new DarkStoreInventory(Map.of(\"milk\", 1, \"bread\", 1));\n        boolean[] result = new boolean[2];\n        Thread a = new Thread(() -> result[0] = store.reserveAll(Map.of(\"milk\", 1, \"bread\", 1)));\n        Thread b = new Thread(() -> result[1] = store.reserveAll(Map.of(\"bread\", 1, \"milk\", 1)));\n        a.start(); b.start(); a.join(); b.join();\n        System.out.println(\"order A: \" + result[0] + \", order B: \" + result[1]\n                + \", milk left: \" + store.available(\"milk\") + \", bread left: \" + store.available(\"bread\"));\n    }\n}"
          }
        ],
        "alternatives": [
          "Single database transaction updating all SKU rows with rows ordered by SKU id (`ORDER BY sku FOR UPDATE`), letting the database enforce the same ordering rule.",
          "Optimistic approach: conditional UPDATE per line inside one transaction, rolling back the whole transaction if any line reports 0 rows.",
          "Offer substitutions (oat milk for milk) when a line fails instead of cancelling the whole order."
        ],
        "say": "\"A basket touches several SKUs, so I reserve it all-or-nothing and always acquire the per-SKU locks in sorted order, which rules out deadlock. I check every line before deducting anything, so a failed order leaves stock untouched. In SQL it's one transaction with SELECT FOR UPDATE ordered by SKU.\""
      },
      {
        "title": "Two orders are assigned to the same rider",
        "race": "Orders 1 and 2 are placed within the same second and the same rider, Asha, is the nearest free one for both. Each dispatcher thread sees Asha as \"free\", assigns her, and she is told to pick up two orders at once. Alternatively, one order gets no rider even though another free rider (Ravi) is nearby.",
        "why": "Reading the rider's status and writing the assignment are separate steps, so both orders pass the \"is she free?\" check. This is again check-then-act, this time on a person instead of a stock count.",
        "fix": "Make claiming a rider a single atomic compare-and-set from \"unassigned\" to \"this order\". Whoever's CAS succeeds owns the rider; the loser simply moves on to the next-nearest candidate in its ranked list. No locks, no waiting, and no rider can be double-booked.\n\nIn the demo, 3 orders compete for 2 riders: exactly 2 get riders and 1 is told to wait, which then goes into a retry queue or a rider-offer timeout.\n\nIn production the rider is first sent an offer and the CAS moves her from FREE to OFFERED, then ASSIGNED on accept (or back to FREE on reject or timeout), the same pattern as the stock hold.",
        "code": [
          {
            "file": "RiderDispatcher.java",
            "body": "import java.util.List;\nimport java.util.Optional;\nimport java.util.concurrent.CountDownLatch;\nimport java.util.concurrent.atomic.AtomicReference;\n\npublic class RiderDispatcher {\n    public static class Rider {\n        final String name;\n        private final AtomicReference<String> currentOrder = new AtomicReference<>();\n\n        Rider(String name) { this.name = name; }\n\n        /** Exactly one caller can move this rider from free to assigned. */\n        boolean tryAssign(String orderId) { return currentOrder.compareAndSet(null, orderId); }\n\n        void free(String orderId) { currentOrder.compareAndSet(orderId, null); }\n    }\n\n    /** Walks the candidates nearest-first and claims the first rider nobody else got to. */\n    public Optional<Rider> assign(String orderId, List<Rider> nearestFirst) {\n        for (Rider rider : nearestFirst) {\n            if (rider.tryAssign(orderId)) return Optional.of(rider);\n        }\n        return Optional.empty();\n    }\n\n    public static void main(String[] args) throws Exception {\n        RiderDispatcher dispatcher = new RiderDispatcher();\n        List<Rider> nearby = List.of(new Rider(\"asha\"), new Rider(\"ravi\"));\n        String[] orders = {\"order-1\", \"order-2\", \"order-3\"};\n        String[] outcome = new String[orders.length];\n        CountDownLatch go = new CountDownLatch(1);\n        Thread[] threads = new Thread[orders.length];\n        for (int i = 0; i < orders.length; i++) {\n            int n = i;\n            threads[i] = new Thread(() -> {\n                try { go.await(); } catch (InterruptedException e) { return; }\n                outcome[n] = orders[n] + \" -> \" + dispatcher.assign(orders[n], nearby).map(r -> r.name).orElse(\"no rider yet\");\n            });\n            threads[i].start();\n        }\n        go.countDown();\n        for (Thread t : threads) t.join();\n        long assigned = java.util.Arrays.stream(outcome).filter(s -> !s.endsWith(\"no rider yet\")).count();\n        System.out.println(\"3 orders, 2 riders, assigned: \" + assigned + \", waiting: \" + (3 - assigned));\n    }\n}"
          }
        ],
        "alternatives": [
          "A single dispatcher per zone (single-writer): all assignment decisions for a geohash go through one queue consumer, so there is no race at all.",
          "Database: `UPDATE rider SET order_id = ? WHERE id = ? AND order_id IS NULL`, and check 1 row affected.",
          "Batch matching every few seconds (as ride-hailing apps do) to optimise globally instead of first-come-first-served."
        ],
        "say": "\"Claiming a rider has to be atomic. I do a compare-and-set from free to assigned, and the loser falls through to the next-nearest rider. For scale I'd either shard dispatch per zone with a single consumer, or use a conditional update in the database. A rider offer has its own timeout so a no-show goes back to free.\""
      }
    ]
  }
);
