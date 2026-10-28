window.CONCURRENCY = window.CONCURRENCY || [];
window.CONCURRENCY.push(
{
  "id": "concert-ticket-booking",
  "scenarios": [
    {
      "title": "Two buyers click the last seat at the same instant",
      "race": "Show 1, seat A12 is the last one left. At t=0 Asha's request reads the seat as AVAILABLE. Before she writes HELD, Ben's request also reads AVAILABLE. Both write HELD, both are told 'seat reserved', and both go to payment.",
      "why": "Classic check-then-act: reading the status and writing it are two separate steps, so another thread can slip in between. Nothing makes 'is it free?' and 'mark it mine' a single decision.",
      "fix": "Make the claim itself the one atomic operation. `ConcurrentHashMap.compute` runs the lambda atomically per key, so the decision 'is it free or expired? then take it' cannot interleave with another buyer's. Exactly one caller sees `won = true`; everyone else gets false and is shown 'seat just taken'. The demo races 100 buyers and exactly 1 wins.\n\nThe hold carries an expiry (5 minutes) so an abandoned checkout frees the seat by itself instead of blocking it forever. On a single JVM this is enough. With several servers the same compare-and-set has to live in the database or Redis (see the options below).",
      "code": [
        {
          "file": "SeatHoldService.java",
          "body": "import java.time.Duration;\nimport java.util.concurrent.*;\nimport java.util.concurrent.atomic.AtomicInteger;\n\npublic class SeatHoldService {\n    record Hold(String userId, long expiresAtMillis) {\n        boolean isExpired(long now) { return now >= expiresAtMillis; }\n    }\n\n    private final ConcurrentHashMap<String, Hold> holds = new ConcurrentHashMap<>();\n    private final Duration ttl;\n\n    public SeatHoldService(Duration ttl) { this.ttl = ttl; }\n\n    /** Atomically claim a seat. When many buyers race, exactly one wins. */\n    public boolean tryHold(String showSeatId, String userId, long now) {\n        boolean[] won = {false};\n        holds.compute(showSeatId, (id, current) -> {\n            if (current == null || current.isExpired(now)) {\n                won[0] = true;\n                return new Hold(userId, now + ttl.toMillis());\n            }\n            return current;\n        });\n        return won[0];\n    }\n\n    public static void main(String[] args) throws Exception {\n        SeatHoldService svc = new SeatHoldService(Duration.ofMinutes(5));\n        ExecutorService pool = Executors.newFixedThreadPool(32);\n        CountDownLatch start = new CountDownLatch(1);\n        AtomicInteger winners = new AtomicInteger();\n        for (int i = 0; i < 100; i++) {\n            String user = \"user-\" + i;\n            pool.submit(() -> {\n                start.await();\n                if (svc.tryHold(\"show1-A12\", user, System.currentTimeMillis())) winners.incrementAndGet();\n                return null;\n            });\n        }\n        start.countDown();\n        pool.shutdown();\n        pool.awaitTermination(5, TimeUnit.SECONDS);\n        System.out.println(\"buyers=100 winners=\" + winners.get());\n    }\n}"
        }
      ],
      "alternatives": [
        "Database: `UPDATE show_seat SET status='HELD', held_by=?, hold_expires_at=? WHERE id=? AND (status='AVAILABLE' OR hold_expires_at < now())`, then check that exactly 1 row was updated.",
        "Redis: `SET seat:show1:A12 userId NX PX 300000`. The key is the hold and its TTL is the expiry.",
        "`synchronized` per seat works on one server but not across a fleet."
      ],
      "say": "Reading then writing is a race, so I make the claim itself atomic: a conditional update that only succeeds if the seat is free or its hold expired. The caller that gets one row updated wins, and everyone else gets a clean 'seat taken'."
    },
    {
      "title": "Payment finishes after the hold expired",
      "race": "Asha holds A12 at t=0 with a 100 ms TTL (5 minutes in production). Her bank is slow and answers at t=150. The hold expired at t=100 and Ben grabbed the seat at t=150. Asha's payment callback now says 'confirm booking'.",
      "why": "Confirming without re-checking ownership assumes the hold is still hers. Time passing silently changed who owns the seat, so a plain `status = BOOKED` write would double-book the seat or overwrite Ben's hold.",
      "fix": "Confirm is itself an atomic compare-and-flip: only a seat that is HELD by this user and not expired becomes BOOKED. Anything else is left untouched and reported as a failure. In the demo Asha's late confirm returns false while Ben's succeeds.\n\nIf the charge already went through, a failed confirm triggers an automatic refund. A better ordering is authorize first, confirm the seat, then capture, so losing the seat means no money moved.",
      "code": [
        {
          "file": "SeatBooking.java",
          "body": "import java.util.concurrent.ConcurrentHashMap;\n\npublic class SeatBooking {\n    enum Status { HELD, BOOKED }\n    record SeatState(Status status, String holder, long expiresAt) {}\n\n    private final ConcurrentHashMap<String, SeatState> seats = new ConcurrentHashMap<>();\n\n    public boolean hold(String seatId, String user, long now, long ttl) {\n        boolean[] ok = {false};\n        seats.compute(seatId, (id, cur) -> {\n            boolean free = cur == null || (cur.status() == Status.HELD && now >= cur.expiresAt());\n            if (!free) return cur;\n            ok[0] = true;\n            return new SeatState(Status.HELD, user, now + ttl);\n        });\n        return ok[0];\n    }\n\n    /** Charge only if THIS user still owns an unexpired hold; the check and the flip are one atomic step. */\n    public boolean confirm(String seatId, String user, long now) {\n        boolean[] ok = {false};\n        seats.compute(seatId, (id, cur) -> {\n            if (cur != null && cur.status() == Status.HELD\n                    && cur.holder().equals(user) && now < cur.expiresAt()) {\n                ok[0] = true;\n                return new SeatState(Status.BOOKED, user, Long.MAX_VALUE);\n            }\n            return cur;\n        });\n        return ok[0];\n    }\n\n    public static void main(String[] args) {\n        SeatBooking b = new SeatBooking();\n        System.out.println(\"A holds        : \" + b.hold(\"S1\", \"A\", 0, 100));\n        System.out.println(\"A pays late    : \" + b.confirm(\"S1\", \"A\", 150));\n        System.out.println(\"B holds        : \" + b.hold(\"S1\", \"B\", 150, 100));\n        System.out.println(\"A retries pay  : \" + b.confirm(\"S1\", \"A\", 160));\n        System.out.println(\"B pays         : \" + b.confirm(\"S1\", \"B\", 170));\n    }\n}"
        }
      ],
      "alternatives": [
        "Extend the hold while a payment is in progress (heartbeat) so slow gateways do not cost the user the seat.",
        "Store a fencing token with the hold and require it on confirm, so a stale holder is rejected even if clocks disagree."
      ],
      "say": "The hold is a lease, not ownership. Confirm re-validates that this user still has an unexpired lease in the same atomic step that books the seat, and if the lease is gone we refund automatically."
    },
    {
      "title": "Booking several seats at once deadlocks",
      "race": "Asha books [A1, A2] and Ben books [A2, A1]. Asha locks A1 while Ben locks A2. Asha now waits for A2 and Ben waits for A1. Neither can ever proceed.",
      "why": "Each request holds one lock while waiting for another, and the two requests take the locks in opposite orders, which creates a cycle. That is a deadlock.",
      "fix": "Impose one global order: sort the seat ids and always lock in that order. With the order fixed a cycle is impossible, because whoever gets A1 first also gets A2 first. Check availability of all seats while holding all the locks and only then take them, so the booking is all-or-nothing. Locks are released in reverse order in `finally`. The demo runs 2000 racing pairs with no deadlock and no double booking.",
      "code": [
        {
          "file": "MultiSeatBooking.java",
          "body": "import java.util.*;\nimport java.util.concurrent.*;\nimport java.util.concurrent.locks.ReentrantLock;\n\npublic class MultiSeatBooking {\n    private final Map<String, ReentrantLock> locks = new ConcurrentHashMap<>();\n    private final Set<String> taken = ConcurrentHashMap.newKeySet();\n\n    /** All-or-nothing booking. Locks are always taken in sorted seat order, so no two requests can wait on each other in a cycle. */\n    public boolean book(Collection<String> seatIds) {\n        List<String> ordered = new ArrayList<>(new TreeSet<>(seatIds));\n        List<ReentrantLock> acquired = new ArrayList<>();\n        try {\n            for (String id : ordered) {\n                ReentrantLock lock = locks.computeIfAbsent(id, k -> new ReentrantLock());\n                lock.lock();\n                acquired.add(lock);\n            }\n            for (String id : ordered) if (taken.contains(id)) return false;\n            taken.addAll(ordered);\n            return true;\n        } finally {\n            for (int i = acquired.size() - 1; i >= 0; i--) acquired.get(i).unlock();\n        }\n    }\n\n    public static void main(String[] args) throws Exception {\n        int rounds = 2000, bothWon = 0;\n        for (int r = 0; r < rounds; r++) {\n            MultiSeatBooking svc = new MultiSeatBooking();\n            boolean[] res = new boolean[2];\n            Thread t1 = new Thread(() -> res[0] = svc.book(List.of(\"A1\", \"A2\")));\n            Thread t2 = new Thread(() -> res[1] = svc.book(List.of(\"A2\", \"A1\")));\n            t1.start(); t2.start();\n            t1.join(2000); t2.join(2000);\n            if (t1.isAlive() || t2.isAlive()) { System.out.println(\"DEADLOCK\"); return; }\n            if (res[0] && res[1]) bothWon++;\n        }\n        System.out.println(\"rounds=\" + rounds + \" no deadlock, double-bookings=\" + bothWon);\n    }\n}"
        }
      ],
      "alternatives": [
        "Try-lock with a timeout and roll back; easy to reason about for a few seats but can livelock under load.",
        "A single DB transaction: `SELECT ... WHERE id IN (...) ORDER BY id FOR UPDATE`, then update. The ORDER BY gives the same lock ordering.",
        "Hold seats one by one and release the already-held ones if a later one fails."
      ],
      "say": "Whenever a request needs several locks, I sort the resources and lock in that order. The waiting graph then cannot contain a cycle, so no deadlock, and I check all the seats while holding all the locks so it is all-or-nothing."
    }
  ]
},
{
  "id": "social-network",
  "scenarios": [
    {
      "title": "Likes get lost, and double taps get counted twice",
      "race": "A post has 41 likes. Two users tap like in the same millisecond. Both read count = 41 and both write 42, so the post shows 42 instead of 43. Separately, one impatient user double-taps and the like is counted twice.",
      "why": "`count = count + 1` is read-modify-write, three steps, so concurrent updates overwrite each other (a lost update). The double tap is a second bug: nothing records who already liked.",
      "fix": "Two separate guarantees. First, who liked: a concurrent set per post, where `add()` returns false if the user is already in it, so duplicates are dropped atomically. Second, how many: a `LongAdder`, which spreads increments over internal cells so a viral post does not make every like queue on one hot variable. The demo runs 1000 distinct likers plus duplicate taps and the count is exactly 1000.\n\nIn production the unique (post_id, user_id) row in the likes table plays the role of the set, and the counter is either derived or updated by something that tolerates slight lag.",
      "code": [
        {
          "file": "LikeService.java",
          "body": "import java.util.Set;\nimport java.util.concurrent.*;\nimport java.util.concurrent.atomic.LongAdder;\n\npublic class LikeService {\n    private final ConcurrentHashMap<String, Set<String>> likers = new ConcurrentHashMap<>();\n    private final ConcurrentHashMap<String, LongAdder> counts = new ConcurrentHashMap<>();\n\n    public boolean like(String postId, String userId) {\n        Set<String> set = likers.computeIfAbsent(postId, p -> ConcurrentHashMap.newKeySet());\n        if (!set.add(userId)) return false;               // add() is atomic: a double tap is counted once\n        counts.computeIfAbsent(postId, p -> new LongAdder()).increment();\n        return true;\n    }\n\n    public boolean unlike(String postId, String userId) {\n        Set<String> set = likers.get(postId);\n        if (set == null || !set.remove(userId)) return false;\n        counts.get(postId).decrement();\n        return true;\n    }\n\n    public long count(String postId) {\n        LongAdder a = counts.get(postId);\n        return a == null ? 0 : a.sum();\n    }\n\n    public static void main(String[] args) throws Exception {\n        LikeService svc = new LikeService();\n        ExecutorService pool = Executors.newFixedThreadPool(32);\n        for (int i = 0; i < 1000; i++) {\n            String user = \"u\" + i;\n            pool.submit(() -> svc.like(\"post1\", user));\n            if (i % 100 == 0) pool.submit(() -> svc.like(\"post1\", user));   // duplicate tap\n        }\n        pool.shutdown();\n        pool.awaitTermination(5, TimeUnit.SECONDS);\n        System.out.println(\"distinct likers=1000 count=\" + svc.count(\"post1\"));\n    }\n}"
        }
      ],
      "alternatives": [
        "DB: `INSERT INTO likes(post_id, user_id) ... ON CONFLICT DO NOTHING`, then `UPDATE posts SET like_count = like_count + 1` only if the insert affected a row.",
        "Count lazily: store likes only and refresh a cached count every few seconds. Slightly stale but contention-free.",
        "Redis `SADD` for who liked and `INCR` for the count, flushed to the database in batches."
      ],
      "say": "I separate 'did this user already like' from 'how many likes'. The first is a unique constraint and the second is an atomic or sharded counter. Both are single atomic operations, so there are no lost updates."
    },
    {
      "title": "Alice and Bob send each other a friend request at the same time",
      "race": "Alice sends a request to Bob while Bob sends one to Alice. Each thread checks 'is there a request from the other side?', sees none, and inserts its own PENDING row. Now there are two pending rows in opposite directions, and Alice and Bob each wait for the other to accept.",
      "why": "The existence check and the insert are separate steps, and the two directions are stored under different keys, so the two requests never actually contend on anything.",
      "fix": "Normalize the pair into one canonical key (smaller id first) so both directions land on the same entry, then decide inside one atomic `compute`. No entry means create PENDING. A pending request from the other person means they both want it, so become FRIENDS. Anything else is a duplicate click or already friends, so change nothing. Over 5000 trials with both requests racing, the result is FRIENDS every time.",
      "code": [
        {
          "file": "FriendshipService.java",
          "body": "import java.util.concurrent.ConcurrentHashMap;\n\npublic class FriendshipService {\n    enum State { PENDING, FRIENDS }\n    record Edge(State state, String requester) {}\n\n    private final ConcurrentHashMap<String, Edge> edges = new ConcurrentHashMap<>();\n\n    /** One canonical key per pair, so A->B and B->A hit the same entry. */\n    private static String key(String a, String b) {\n        return a.compareTo(b) < 0 ? a + \"|\" + b : b + \"|\" + a;\n    }\n\n    public State sendRequest(String from, String to) {\n        State[] result = new State[1];\n        edges.compute(key(from, to), (k, e) -> {\n            if (e == null) {\n                result[0] = State.PENDING;\n                return new Edge(State.PENDING, from);\n            }\n            if (e.state() == State.PENDING && !e.requester().equals(from)) {\n                result[0] = State.FRIENDS;                      // crossing requests auto-accept\n                return new Edge(State.FRIENDS, null);\n            }\n            result[0] = e.state();                              // duplicate click or already friends\n            return e;\n        });\n        return result[0];\n    }\n\n    public static void main(String[] args) throws Exception {\n        int trials = 5000, friends = 0;\n        for (int i = 0; i < trials; i++) {\n            FriendshipService svc = new FriendshipService();\n            Thread t1 = new Thread(() -> svc.sendRequest(\"alice\", \"bob\"));\n            Thread t2 = new Thread(() -> svc.sendRequest(\"bob\", \"alice\"));\n            t1.start(); t2.start(); t1.join(); t2.join();\n            if (svc.edges.get(key(\"alice\", \"bob\")).state() == State.FRIENDS) friends++;\n        }\n        System.out.println(\"trials=\" + trials + \" ended as FRIENDS=\" + friends);\n    }\n}"
        }
      ],
      "alternatives": [
        "DB: unique index on (least(a,b), greatest(a,b)) and an upsert that flips the status.",
        "Reject the second request with 'already pending' and make the user accept manually. Simpler, but a worse experience."
      ],
      "say": "I store one row per unordered pair with a unique key, so crossing requests collide on the same row and the database resolves it: the second writer turns it into a friendship."
    },
    {
      "title": "Two devices edit the same post",
      "race": "Her phone and laptop both load the draft at version 0. The phone saves 'from phone'. The laptop, still holding the old draft, saves 'from laptop' and silently erases the phone's edit.",
      "why": "Last write wins. Neither writer knows the other exists, and an in-place update has no way to notice that the data changed under it.",
      "fix": "Optimistic concurrency. Every post has a version, the editor sends back the version it loaded, and the save succeeds only if that version is still current. The loser gets a conflict ('post changed, reload') and can merge. Reads never block, which suits content that is rarely edited concurrently. Here it is an `AtomicReference` compare-and-set; in a database it is `UPDATE posts SET body=?, version=version+1 WHERE id=? AND version=?` and a check on the row count.",
      "code": [
        {
          "file": "PostEditor.java",
          "body": "import java.util.concurrent.atomic.AtomicReference;\n\npublic class PostEditor {\n    record Post(String body, long version) {}\n    static class ConflictException extends RuntimeException {\n        ConflictException(String msg) { super(msg); }\n    }\n\n    private final AtomicReference<Post> ref = new AtomicReference<>(new Post(\"\", 0));\n\n    public Post read() { return ref.get(); }\n\n    /** Optimistic write: succeeds only if nobody saved since the version the editor loaded. */\n    public Post edit(long expectedVersion, String newBody) {\n        Post cur = ref.get();\n        if (cur.version() != expectedVersion) throw new ConflictException(\"post changed, reload (now v\" + cur.version() + \")\");\n        Post next = new Post(newBody, expectedVersion + 1);\n        if (!ref.compareAndSet(cur, next)) throw new ConflictException(\"lost the race, reload\");\n        return next;\n    }\n\n    public static void main(String[] args) {\n        PostEditor p = new PostEditor();\n        Post seenByPhone = p.read(), seenByLaptop = p.read();\n        System.out.println(\"phone saves  : \" + p.edit(seenByPhone.version(), \"from phone\"));\n        try {\n            p.edit(seenByLaptop.version(), \"from laptop\");\n        } catch (ConflictException e) {\n            System.out.println(\"laptop saves : \" + e.getMessage());\n        }\n    }\n}"
        }
      ],
      "alternatives": [
        "Pessimistic lock while the editor is open: simple, but a closed tab blocks everyone until the lock times out.",
        "Operational transforms or CRDTs for real-time collaborative editing."
      ],
      "say": "Edits conflict rarely, so I use optimistic locking with a version column. No lock is held while the user types, and a stale save is rejected rather than silently overwriting."
    }
  ]
},
{
  "id": "spotify",
  "scenarios": [
    {
      "title": "Two devices edit the same playlist",
      "race": "The playlist is at version 7. The phone adds a song while the laptop adds a different song. Both read the 7-track list and both write back an 8-track list. One song disappears.",
      "why": "Read-modify-write on the whole list. Each writer replaces the list with its own copy, so the later write erases the earlier one.",
      "fix": "Distinguish operations by whether they commute. Appending songs can be applied in any order, so on a failed compare-and-set we simply re-read the latest list and apply the append again. The user sees no error, and 100 concurrent adds produce exactly 100 tracks. Reordering depends on the positions the user saw, so it carries the version they saw and is rejected as stale if the list has changed; the client then refreshes.",
      "code": [
        {
          "file": "PlaylistService.java",
          "body": "import java.util.*;\nimport java.util.concurrent.*;\nimport java.util.concurrent.atomic.AtomicReference;\n\npublic class PlaylistService {\n    record Playlist(List<String> tracks, long version) {}\n    static class StaleEditException extends RuntimeException {}\n\n    private final AtomicReference<Playlist> ref = new AtomicReference<>(new Playlist(List.of(), 0));\n\n    /** Appends commute, so on a conflict retry against the latest playlist instead of failing the user. */\n    public Playlist addTrack(String trackId) {\n        while (true) {\n            Playlist cur = ref.get();\n            List<String> next = new ArrayList<>(cur.tracks());\n            next.add(trackId);\n            Playlist updated = new Playlist(List.copyOf(next), cur.version() + 1);\n            if (ref.compareAndSet(cur, updated)) return updated;\n        }\n    }\n\n    /** A reorder only makes sense for the list the user saw, so reject it if the list moved on. */\n    public Playlist move(long seenVersion, int from, int to) {\n        while (true) {\n            Playlist cur = ref.get();\n            if (cur.version() != seenVersion) throw new StaleEditException();\n            List<String> next = new ArrayList<>(cur.tracks());\n            next.add(to, next.remove(from));\n            Playlist updated = new Playlist(List.copyOf(next), cur.version() + 1);\n            if (ref.compareAndSet(cur, updated)) return updated;\n        }\n    }\n\n    public static void main(String[] args) throws Exception {\n        PlaylistService svc = new PlaylistService();\n        ExecutorService pool = Executors.newFixedThreadPool(16);\n        for (int i = 0; i < 100; i++) { String t = \"track-\" + i; pool.submit(() -> svc.addTrack(t)); }\n        pool.shutdown();\n        pool.awaitTermination(5, TimeUnit.SECONDS);\n        Playlist p = svc.ref.get();\n        System.out.println(\"tracks=\" + p.tracks().size() + \" version=\" + p.version());\n        try { svc.move(5, 0, 1); } catch (StaleEditException e) { System.out.println(\"stale reorder rejected\"); }\n    }\n}"
        }
      ],
      "alternatives": [
        "A per-playlist lock: correct, but serializes all edits and needs a distributed lock across servers.",
        "Store tracks as rows with a fractional position so inserts and moves touch single rows instead of the whole list.",
        "CRDT-based ordering for offline edits."
      ],
      "say": "I ask whether the operation is commutative. For appends I retry on the latest version and nobody notices. For reorders I use optimistic versioning and surface a conflict."
    },
    {
      "title": "A viral track makes the play counter a bottleneck",
      "race": "A new single drops and a million listeners hit play within a minute. Every play runs `UPDATE tracks SET plays = plays + 1`, so thousands of writers queue up on one row lock.",
      "why": "One hot row is a serialization point. Each update is atomic, so the count is correct, but throughput collapses, and playback itself slows down if it waits on the counter.",
      "fix": "Take counting off the playback path. Increment an in-memory `LongAdder`, which stripes contention across cells so threads rarely touch the same memory, and have a background job `drain()` the totals every few seconds and apply them as one batched `plays = plays + N`. The demo records 800,000 plays from 8 threads and drains exactly 800,000. Draining again returns nothing, so nothing is counted twice.",
      "code": [
        {
          "file": "PlayCounter.java",
          "body": "import java.util.*;\nimport java.util.concurrent.*;\nimport java.util.concurrent.atomic.LongAdder;\n\npublic class PlayCounter {\n    private final ConcurrentHashMap<String, LongAdder> pending = new ConcurrentHashMap<>();\n\n    /** Hot path: no lock, and LongAdder spreads contention over cells so a viral track does not serialize. */\n    public void recordPlay(String trackId) {\n        pending.computeIfAbsent(trackId, t -> new LongAdder()).increment();\n    }\n\n    /** Called every few seconds: move the deltas to the database in one batched write. */\n    public Map<String, Long> drain() {\n        Map<String, Long> batch = new HashMap<>();\n        pending.forEach((track, adder) -> {\n            long n = adder.sumThenReset();\n            if (n > 0) batch.put(track, n);\n        });\n        return batch;\n    }\n\n    public static void main(String[] args) throws Exception {\n        PlayCounter c = new PlayCounter();\n        ExecutorService pool = Executors.newFixedThreadPool(8);\n        for (int t = 0; t < 8; t++) {\n            pool.submit(() -> { for (int i = 0; i < 100_000; i++) c.recordPlay(\"viral-hit\"); });\n        }\n        pool.shutdown();\n        pool.awaitTermination(10, TimeUnit.SECONDS);\n        System.out.println(\"flushed=\" + c.drain() + \" after drain=\" + c.drain());\n    }\n}"
        }
      ],
      "alternatives": [
        "Append every play to a log or Kafka topic and aggregate downstream; exact and replayable.",
        "Sharded counters in the database: N rows per track, summed on read.",
        "Show approximate counts in the UI and keep exact counts for royalty reporting."
      ],
      "say": "A hot counter is a throughput problem, not a correctness problem. I move it off the request path with a striped in-memory counter and flush the deltas in batches."
    },
    {
      "title": "A stale device sends a command after another device took over",
      "race": "The user is playing on the phone and then starts the laptop. A delayed 'resume' from the phone arrives after the laptop took over, and the phone starts playing again on top of the laptop.",
      "why": "Commands from a device that has lost control are still in flight. Without knowing which ownership era a command belongs to, the server cannot tell it is stale.",
      "fix": "A fencing token. Every takeover increments an epoch and returns it to the new device. Each command must present the epoch it was granted, and the server rejects commands with an old epoch or from a non-active device. The check and the apply happen inside the same `synchronized` section so they cannot be split. The demo shows the phone's late 'resume' rejected and the laptop's 'skip' accepted.",
      "code": [
        {
          "file": "PlaybackSession.java",
          "body": "import java.util.ArrayList;\nimport java.util.List;\n\npublic class PlaybackSession {\n    private long epoch = 0;                         // fencing token: grows on every takeover\n    private String activeDevice = null;\n    private final List<String> log = new ArrayList<>();\n\n    public synchronized long takeOver(String deviceId) {\n        activeDevice = deviceId;\n        return ++epoch;\n    }\n\n    /** Commands carry the epoch the device was granted; a device that lost control is rejected. */\n    public synchronized boolean command(String deviceId, long tokenEpoch, String cmd) {\n        if (tokenEpoch != epoch || !deviceId.equals(activeDevice)) return false;\n        log.add(deviceId + \":\" + cmd);\n        return true;\n    }\n\n    public static void main(String[] args) {\n        PlaybackSession s = new PlaybackSession();\n        long phone = s.takeOver(\"phone\");\n        System.out.println(\"phone pause  : \" + s.command(\"phone\", phone, \"pause\"));\n        long laptop = s.takeOver(\"laptop\");\n        System.out.println(\"phone resume : \" + s.command(\"phone\", phone, \"resume\") + \" (lost control)\");\n        System.out.println(\"laptop skip  : \" + s.command(\"laptop\", laptop, \"skip\"));\n        System.out.println(\"log=\" + s.log);\n    }\n}"
        }
      ],
      "alternatives": [
        "Keep the session in a database row with a version column and compare-and-set on takeover.",
        "Use WebSocket sessions where the server closes the old device's connection on takeover."
      ],
      "say": "Every takeover bumps a monotonically increasing epoch, and the server rejects commands with a stale epoch. It is the same fencing idea used with distributed locks."
    }
  ]
},
{
  "id": "amazon",
  "scenarios": [
    {
      "title": "One unit left and two shoppers press Buy",
      "race": "A SKU has 1 unit left. Two shoppers press Buy now. Both requests run `SELECT qty` and see 1, both decide 'in stock', and both run `qty = qty - 1`. Stock is now -1 and one customer gets an apology email after paying.",
      "why": "Check-then-act again: 'is qty >= 1' and 'decrement' are separate statements, so two transactions can both pass the check.",
      "fix": "Fuse the check and the decrement into one atomic step. In memory that is a compare-and-set loop: read the current count, refuse if it is too low, otherwise CAS to count - qty and retry if someone changed it first. In SQL it is a conditional update, `UPDATE inventory SET qty = qty - ? WHERE sku = ? AND qty >= ?`. One row updated means you got the unit; zero rows means sold out. With 200 buyers and 1 unit, exactly one wins and the stock never goes negative.\n\nNo explicit lock is needed, because the database takes a row lock for the duration of that single statement.",
      "code": [
        {
          "file": "InventoryService.java",
          "body": "import java.util.concurrent.*;\nimport java.util.concurrent.atomic.AtomicInteger;\n\npublic class InventoryService {\n    private final ConcurrentHashMap<String, AtomicInteger> stock = new ConcurrentHashMap<>();\n\n    public void restock(String sku, int qty) {\n        stock.computeIfAbsent(sku, k -> new AtomicInteger()).addAndGet(qty);\n    }\n\n    /**\n     * Check and decrement as ONE atomic step (compare-and-set loop).\n     * The database twin of this is a conditional update:\n     *   UPDATE inventory SET qty = qty - ? WHERE sku = ? AND qty >= ?   -- 1 row updated = you got it\n     */\n    public boolean tryReserve(String sku, int qty) {\n        AtomicInteger units = stock.get(sku);\n        if (units == null) return false;\n        while (true) {\n            int cur = units.get();\n            if (cur < qty) return false;\n            if (units.compareAndSet(cur, cur - qty)) return true;\n        }\n    }\n\n    public int available(String sku) {\n        AtomicInteger u = stock.get(sku);\n        return u == null ? 0 : u.get();\n    }\n\n    public static void main(String[] args) throws Exception {\n        InventoryService inv = new InventoryService();\n        inv.restock(\"sku-1\", 1);\n        ExecutorService pool = Executors.newFixedThreadPool(32);\n        AtomicInteger got = new AtomicInteger();\n        for (int i = 0; i < 200; i++) pool.submit(() -> { if (inv.tryReserve(\"sku-1\", 1)) got.incrementAndGet(); });\n        pool.shutdown();\n        pool.awaitTermination(5, TimeUnit.SECONDS);\n        System.out.println(\"buyers=200 stock=1 reserved=\" + got.get() + \" left=\" + inv.available(\"sku-1\"));\n    }\n}"
        }
      ],
      "alternatives": [
        "Pessimistic: `SELECT ... FOR UPDATE`, check, then update. Correct, but holds the row lock for the whole transaction.",
        "Optimistic with a version column and retry: fine at low contention, wasteful in a flash sale.",
        "A Redis Lua script that checks and decrements atomically for very hot SKUs."
      ],
      "say": "I never check stock and then decrement. I decrement conditionally, and the row count or CAS result tells me whether I got the unit. It works the same in memory, SQL or Redis."
    },
    {
      "title": "Cart holds: stop overselling without letting people hoard stock",
      "race": "Two units are left. Shopper A starts checkout for 2 and wanders off for 20 minutes with the payment page open. If we do nothing, B sees 'in stock', but when B pays, A's order may already have consumed the units. If instead we lock stock forever at add-to-cart, A hoards it.",
      "why": "Between 'I want it' and 'I paid', stock needs a state in the middle. With only two states (available and sold) you are forced to choose between overselling and hoarding.",
      "fix": "Add a reservation with an expiry. Starting checkout moves units from available into a reservation, and since available is what other shoppers see, nobody can oversell. A sweep job returns expired reservations, and confirm re-checks the expiry so a late payer cannot claim stock that was already released. In the demo, A reserves the last unit, B is refused, after the TTL the sweep frees it, B reserves and pays, and A's late payment is refused.\n\nAdding to the cart does not reserve stock; only starting checkout (or a short timed hold on flash sales) does. Reserve is idempotent per order, so a retry does not take stock twice.",
      "code": [
        {
          "file": "CheckoutReservations.java",
          "body": "import java.util.*;\n\npublic class CheckoutReservations {\n    record Reservation(String sku, int qty, long expiresAt) {}\n\n    private final Map<String, Integer> available = new HashMap<>();\n    private final Map<String, Reservation> active = new HashMap<>();\n\n    public synchronized void restock(String sku, int qty) { available.merge(sku, qty, Integer::sum); }\n    public synchronized int available(String sku) { return available.getOrDefault(sku, 0); }\n\n    /** Taking stock out of \"available\" is what prevents overselling; the TTL is what prevents hoarding. */\n    public synchronized boolean reserve(String orderId, String sku, int qty, long now, long ttl) {\n        if (active.containsKey(orderId)) return true;           // retry of the same checkout\n        if (available.getOrDefault(sku, 0) < qty) return false;\n        available.merge(sku, -qty, Integer::sum);\n        active.put(orderId, new Reservation(sku, qty, now + ttl));\n        return true;\n    }\n\n    /** Payment succeeded: make the hold permanent, unless it already expired. */\n    public synchronized boolean confirm(String orderId, long now) {\n        Reservation r = active.remove(orderId);\n        if (r == null) return false;\n        if (now >= r.expiresAt()) { available.merge(r.sku(), r.qty(), Integer::sum); return false; }\n        return true;\n    }\n\n    public synchronized void cancel(String orderId) {\n        Reservation r = active.remove(orderId);\n        if (r != null) available.merge(r.sku(), r.qty(), Integer::sum);\n    }\n\n    /** Background sweep returns abandoned holds to stock. */\n    public synchronized int sweep(long now) {\n        int released = 0;\n        for (Iterator<Map.Entry<String, Reservation>> it = active.entrySet().iterator(); it.hasNext(); ) {\n            Reservation r = it.next().getValue();\n            if (now >= r.expiresAt()) { available.merge(r.sku(), r.qty(), Integer::sum); it.remove(); released++; }\n        }\n        return released;\n    }\n\n    public static void main(String[] args) {\n        CheckoutReservations c = new CheckoutReservations();\n        c.restock(\"sku-1\", 1);\n        System.out.println(\"A reserves : \" + c.reserve(\"orderA\", \"sku-1\", 1, 0, 600));\n        System.out.println(\"B reserves : \" + c.reserve(\"orderB\", \"sku-1\", 1, 10, 600));\n        System.out.println(\"sweep      : released \" + c.sweep(700));\n        System.out.println(\"B reserves : \" + c.reserve(\"orderB\", \"sku-1\", 1, 700, 600));\n        System.out.println(\"A pays late: \" + c.confirm(\"orderA\", 800));\n        System.out.println(\"B pays     : \" + c.confirm(\"orderB\", 800));\n    }\n}"
        }
      ],
      "alternatives": [
        "Soft holds only on scarce items and a hard decrement at payment, handling 'sold out' at payment time.",
        "A per-SKU lock instead of one coarse lock (the demo uses `synchronized` for clarity).",
        "Event-driven expiry with delayed queues instead of a polling sweep."
      ],
      "say": "Stock has three states: available, reserved with a deadline, and sold. Reserving is the atomic conditional decrement, a sweeper releases expired holds, and confirm checks that the hold is still valid."
    },
    {
      "title": "Double-click on Place Order",
      "race": "The shopper double-clicks Place Order, or the mobile app retries after a timeout. Two requests reach the server. Both create an order and both charge the card.",
      "why": "The server cannot tell a retry from a genuinely new order, so every delivery of the request is treated as new work.",
      "fix": "Make the operation idempotent. The client generates an idempotency key per checkout and sends it with every retry. The server atomically registers the key with `putIfAbsent`: the winner does the work and completes a future with the order id, and every other request with the same key waits for and returns that same result. In the demo 20 concurrent requests with one key produce one order. On failure the key is removed so a legitimate retry can run again. In the database the key is a unique column checked on insert.",
      "code": [
        {
          "file": "OrderService.java",
          "body": "import java.util.concurrent.*;\nimport java.util.concurrent.atomic.AtomicInteger;\n\npublic class OrderService {\n    private final ConcurrentHashMap<String, CompletableFuture<String>> byKey = new ConcurrentHashMap<>();\n    private final AtomicInteger created = new AtomicInteger();\n\n    /** The client sends the same idempotency key for every retry of one \"Place order\" click. */\n    public String placeOrder(String idempotencyKey, String cartId) {\n        CompletableFuture<String> mine = new CompletableFuture<>();\n        CompletableFuture<String> existing = byKey.putIfAbsent(idempotencyKey, mine);\n        if (existing != null) return existing.join();           // duplicate: wait for and reuse the first result\n        try {\n            String orderId = \"ORD-\" + created.incrementAndGet(); // charge card + create order happen exactly once\n            mine.complete(orderId);\n            return orderId;\n        } catch (RuntimeException e) {\n            byKey.remove(idempotencyKey, mine);                 // let a later retry try again\n            mine.completeExceptionally(e);\n            throw e;\n        }\n    }\n\n    public static void main(String[] args) throws Exception {\n        OrderService svc = new OrderService();\n        ExecutorService pool = Executors.newFixedThreadPool(16);\n        ConcurrentHashMap<String, Boolean> ids = new ConcurrentHashMap<>();\n        for (int i = 0; i < 20; i++) pool.submit(() -> ids.put(svc.placeOrder(\"key-123\", \"cart-9\"), true));\n        pool.shutdown();\n        pool.awaitTermination(5, TimeUnit.SECONDS);\n        System.out.println(\"requests=20 distinct order ids=\" + ids.keySet() + \" created=\" + svc.created.get());\n    }\n}"
        }
      ],
      "alternatives": [
        "A unique constraint on (cart_id, status='PLACED') so only one order per cart can exist.",
        "Disable the button client-side. Helpful, but never sufficient on its own."
      ],
      "say": "Retries are normal in distributed systems, so endpoints with side effects take an idempotency key and return the stored result when they see the key again."
    }
  ]
},
{
  "id": "linkedin",
  "scenarios": [
    {
      "title": "Accepting a connection updates two members at once",
      "race": "Ana and Bo accept each other's requests at the same time. One thread locks Ana and then Bo while another locks Bo and then Ana, and they deadlock. Without locks at all, the two lists drift apart: Ana sees Bo as a connection but Bo does not see Ana.",
      "why": "A connection is a change to two members that must happen together. A one-lock-per-member design needs two locks, and opposite acquisition orders form a cycle.",
      "fix": "Always lock the member with the smaller id first, then the other. Everyone follows the same order, so no cycle can form. While holding both locks, check for an existing connection and update both sides, which makes the change atomic and idempotent (a second accept returns false). The demo runs a ring of 4 members with accepts in both directions at once: no deadlock, and everyone ends up with exactly 2 connections.",
      "code": [
        {
          "file": "ConnectionService.java",
          "body": "import java.util.*;\nimport java.util.concurrent.*;\nimport java.util.concurrent.locks.ReentrantLock;\n\npublic class ConnectionService {\n    static class Member {\n        final String id;\n        final ReentrantLock lock = new ReentrantLock();\n        final Set<String> connections = new HashSet<>();\n        Member(String id) { this.id = id; }\n    }\n\n    private final ConcurrentHashMap<String, Member> members = new ConcurrentHashMap<>();\n\n    private Member member(String id) { return members.computeIfAbsent(id, Member::new); }\n\n    /** Accepting touches two members, so lock both. Always lock the smaller id first to rule out deadlock. */\n    public boolean accept(String a, String b) {\n        if (a.equals(b)) return false;\n        Member first = member(a.compareTo(b) < 0 ? a : b);\n        Member second = member(a.compareTo(b) < 0 ? b : a);\n        first.lock.lock();\n        try {\n            second.lock.lock();\n            try {\n                if (!first.connections.add(second.id)) return false;   // already connected\n                second.connections.add(first.id);\n                return true;\n            } finally { second.lock.unlock(); }\n        } finally { first.lock.unlock(); }\n    }\n\n    public int count(String id) {\n        Member m = member(id);\n        m.lock.lock();\n        try { return m.connections.size(); } finally { m.lock.unlock(); }\n    }\n\n    public static void main(String[] args) throws Exception {\n        ConnectionService svc = new ConnectionService();\n        String[] ids = {\"ana\", \"bo\", \"cy\", \"di\"};\n        List<Thread> threads = new ArrayList<>();\n        for (int i = 0; i < ids.length; i++) {\n            String x = ids[i], y = ids[(i + 1) % ids.length];\n            threads.add(new Thread(() -> svc.accept(x, y)));\n            threads.add(new Thread(() -> svc.accept(y, x)));       // opposite direction at the same time\n        }\n        threads.forEach(Thread::start);\n        for (Thread t : threads) { t.join(3000); if (t.isAlive()) { System.out.println(\"DEADLOCK\"); return; } }\n        for (String id : ids) System.out.println(id + \" has \" + svc.count(id) + \" connections\");\n    }\n}"
        }
      ],
      "alternatives": [
        "Store one row per unordered pair in a `connections` table with a unique key. The database makes it atomic and the counts are derived.",
        "A single-writer queue per member (the actor model), so each member's state is only touched by one thread."
      ],
      "say": "Two-party updates are the textbook deadlock risk. I order the locks by id, or better, store a single canonical row per pair so there is nothing to lock twice."
    },
    {
      "title": "A job that accepts only the first 100 applicants",
      "race": "A job accepts the first 100 applicants. At the deadline 150 candidates click Apply together, and a few double-submit. A naive `if (count < 100) count++` lets 107 through, and a double-submitter takes two slots.",
      "why": "Check-then-act on the counter once more, plus no uniqueness on (user, job).",
      "fix": "Two atomic gates. First, `applicants.add(userId)` rejects a duplicate immediately. Second, a compare-and-set loop claims a slot only if the count is below the limit; if the job is full, the applicant is removed from the set so the state stays consistent. Out of 500 concurrent requests with 100 slots, exactly 100 are accepted. In SQL it is a unique (job_id, user_id) plus `UPDATE jobs SET applications = applications + 1 WHERE id = ? AND applications < max`, checking the row count.",
      "code": [
        {
          "file": "JobApplicationService.java",
          "body": "import java.util.Set;\nimport java.util.concurrent.*;\nimport java.util.concurrent.atomic.AtomicInteger;\n\npublic class JobApplicationService {\n    enum Result { ACCEPTED, DUPLICATE, FULL }\n\n    private final int limit;\n    private final AtomicInteger accepted = new AtomicInteger();\n    private final Set<String> applicants = ConcurrentHashMap.newKeySet();\n\n    public JobApplicationService(int limit) { this.limit = limit; }\n\n    public Result apply(String userId) {\n        if (!applicants.add(userId)) return Result.DUPLICATE;     // double-submit by the same user\n        while (true) {                                            // claim one of the limited slots atomically\n            int cur = accepted.get();\n            if (cur >= limit) { applicants.remove(userId); return Result.FULL; }\n            if (accepted.compareAndSet(cur, cur + 1)) return Result.ACCEPTED;\n        }\n    }\n\n    public static void main(String[] args) throws Exception {\n        JobApplicationService job = new JobApplicationService(100);\n        ExecutorService pool = Executors.newFixedThreadPool(32);\n        AtomicInteger ok = new AtomicInteger(), dup = new AtomicInteger(), full = new AtomicInteger();\n        for (int i = 0; i < 500; i++) {\n            String user = \"u\" + (i % 450);                        // 50 users submit twice\n            pool.submit(() -> {\n                switch (job.apply(user)) {\n                    case ACCEPTED -> ok.incrementAndGet();\n                    case DUPLICATE -> dup.incrementAndGet();\n                    case FULL -> full.incrementAndGet();\n                }\n            });\n        }\n        pool.shutdown();\n        pool.awaitTermination(5, TimeUnit.SECONDS);\n        System.out.println(\"limit=100 accepted=\" + ok.get() + \" (duplicates and full rejected=\" + (dup.get() + full.get()) + \")\");\n    }\n}"
        }
      ],
      "alternatives": [
        "A `Semaphore` with `tryAcquire()` for a bounded number of permits.",
        "Accept all applications and let the recruiter cap the review list; this avoids contention when a hard limit is not required."
      ],
      "say": "A cap is a conditional increment, and uniqueness is a constraint. I do not read the count in application code and then decide."
    }
  ]
},
{
  "id": "cricinfo",
  "scenarios": [
    {
      "title": "The scorer writes while millions of fans read",
      "race": "The scorer records a ball by adding runs and then incrementing the ball count. A reader loading the page between those two steps sees 187 runs but the previous over count, a scoreboard that never existed. Making every reader take a lock fixes that but slows the page for millions of viewers whenever the scorer is busy.",
      "why": "A multi-field update is not atomic from a reader's point of view. Locks fix the tearing but make readers wait on the writer.",
      "fix": "Publish immutable snapshots. Each ball builds a brand-new `Snapshot` (runs, wickets, legal balls) and swaps it in with a single volatile write, so a reader always sees one consistent scoreboard from before or after the ball, never a mixture. Writers are serialized with `synchronized` (there is one scorer per match) and readers take no lock at all. In the demo, 8 readers hammer the scoreboard during 600 balls and observe zero inconsistent reads.",
      "code": [
        {
          "file": "LiveScoreboard.java",
          "body": "import java.util.concurrent.*;\nimport java.util.concurrent.atomic.AtomicInteger;\n\npublic class LiveScoreboard {\n    /** Immutable: a reader can never see runs from one ball and wickets from another. */\n    public record Snapshot(int runs, int wickets, int legalBalls) {\n        String overs() { return legalBalls / 6 + \".\" + legalBalls % 6; }\n    }\n\n    private volatile Snapshot current = new Snapshot(0, 0, 0);\n\n    /** Readers are lock-free and never block the scorer. */\n    public Snapshot read() { return current; }\n\n    /** Only writers serialize; each ball builds a new snapshot and publishes it with one volatile write. */\n    public synchronized void record(int runs, boolean wicket, boolean legal) {\n        Snapshot c = current;\n        current = new Snapshot(c.runs() + runs, c.wickets() + (wicket ? 1 : 0), c.legalBalls() + (legal ? 1 : 0));\n    }\n\n    public static void main(String[] args) throws Exception {\n        LiveScoreboard sb = new LiveScoreboard();\n        AtomicInteger torn = new AtomicInteger();\n        ExecutorService readers = Executors.newFixedThreadPool(8);\n        for (int r = 0; r < 8; r++) {\n            readers.submit(() -> {\n                for (int i = 0; i < 200_000; i++) {\n                    Snapshot s = sb.read();\n                    if (s.runs() != s.legalBalls()) torn.incrementAndGet();   // every ball here adds 1 run and 1 legal ball\n                }\n            });\n        }\n        for (int b = 0; b < 600; b++) sb.record(1, false, true);\n        readers.shutdown();\n        readers.awaitTermination(10, TimeUnit.SECONDS);\n        Snapshot s = sb.read();\n        System.out.println(\"final \" + s.runs() + \" runs in \" + s.overs() + \" overs, torn reads=\" + torn.get());\n    }\n}"
        }
      ],
      "alternatives": [
        "`AtomicReference<Snapshot>` with compare-and-set if there can be several writers.",
        "Keep the latest snapshot per match in a cache and serve it through a CDN with a one-second TTL."
      ],
      "say": "One writer and many readers: an immutable snapshot behind a volatile reference. Readers are lock-free and always see a consistent state."
    },
    {
      "title": "Duplicate and out-of-order ball events",
      "race": "Two scorers, or a retrying mobile app, send ball events 1 to 5. The network delivers 2, 1, 1, 4, 3, 3, 5. Applying them as they arrive double counts balls 1 and 3 and applies ball 2 before ball 1, which breaks over boundaries and strike rotation.",
      "why": "At-least-once delivery means duplicates, and nothing guarantees ordering across retries or multiple senders.",
      "fix": "Give every ball a sequence number. The processor applies only the next expected number: anything at or below the last applied number is a duplicate and is ignored, and anything ahead waits in a sorted buffer until the gap fills, then drains in order. The method is `synchronized`, so check, buffer and apply are one step. The demo applies balls 1 to 5 exactly once and in order, for 15 runs.",
      "code": [
        {
          "file": "BallEventProcessor.java",
          "body": "import java.util.*;\n\npublic class BallEventProcessor {\n    record BallEvent(long seq, int runs) {}\n\n    private long lastApplied = 0;\n    private int totalRuns = 0;\n    private final TreeMap<Long, BallEvent> buffered = new TreeMap<>();\n\n    /** Duplicates are ignored; early arrivals wait until the gap before them is filled. */\n    public synchronized boolean accept(BallEvent e) {\n        if (e.seq() <= lastApplied) return false;                 // already applied (duplicate delivery)\n        if (buffered.putIfAbsent(e.seq(), e) != null) return false;\n        while (!buffered.isEmpty() && buffered.firstKey() == lastApplied + 1) {\n            BallEvent next = buffered.pollFirstEntry().getValue();\n            totalRuns += next.runs();\n            lastApplied = next.seq();\n        }\n        return true;\n    }\n\n    public synchronized int totalRuns() { return totalRuns; }\n    public synchronized long lastApplied() { return lastApplied; }\n\n    public static void main(String[] args) {\n        BallEventProcessor p = new BallEventProcessor();\n        int[] arrivalOrder = {2, 1, 1, 4, 3, 3, 5};               // out of order, with duplicates\n        for (int seq : arrivalOrder) p.accept(new BallEvent(seq, seq));\n        System.out.println(\"applied up to ball \" + p.lastApplied() + \", runs=\" + p.totalRuns() + \" (expected 15)\");\n    }\n}"
        }
      ],
      "alternatives": [
        "Idempotent upserts keyed by (match_id, ball_number); order matters less if the state is recomputed from the events.",
        "Event sourcing: append events and compute the scoreboard as a fold over the ordered log."
      ],
      "say": "Duplicates and reordering are handled with a per-match sequence number: ignore what has already been applied, buffer what arrives early, and apply in order."
    },
    {
      "title": "Broadcasting commentary while fans join and leave",
      "race": "A new comment is being pushed to 50,000 connected fans while some disconnect and others join. With an ordinary list, removing a subscriber during the `for` loop throws `ConcurrentModificationException`, or one broken client's exception stops everyone after it from receiving the comment.",
      "why": "The loop iterates a structure that other threads mutate, and one subscriber's failure is allowed to propagate to the rest.",
      "fix": "Use a `CopyOnWriteArrayList`: iteration works on a snapshot, so joins and leaves never break a running broadcast (they take effect from the next one). Reads are far more common than subscription changes, which is exactly where copy-on-write is cheap. Each callback is wrapped in try/catch so a broken client cannot block the rest. In the demo one fan leaves in the middle of a publish and another throws an error, yet the third fan still gets every comment.",
      "code": [
        {
          "file": "CommentaryBroadcaster.java",
          "body": "import java.util.concurrent.CopyOnWriteArrayList;\n\npublic class CommentaryBroadcaster {\n    public interface Subscriber { void onComment(String text); }\n\n    /** Snapshot-on-iterate list: joining or leaving mid-broadcast can never break the loop. */\n    private final CopyOnWriteArrayList<Subscriber> subscribers = new CopyOnWriteArrayList<>();\n\n    public Runnable subscribe(Subscriber s) {\n        subscribers.add(s);\n        return () -> subscribers.remove(s);\n    }\n\n    public void publish(String text) {\n        for (Subscriber s : subscribers) {\n            try { s.onComment(text); } catch (RuntimeException ignored) { /* one bad client must not stop the rest */ }\n        }\n    }\n\n    public static void main(String[] args) {\n        CommentaryBroadcaster b = new CommentaryBroadcaster();\n        Runnable[] leave = new Runnable[1];\n        leave[0] = b.subscribe(t -> { System.out.println(\"fan1 got: \" + t); leave[0].run(); });   // unsubscribes mid-publish\n        b.subscribe(t -> { throw new IllegalStateException(\"broken client\"); });\n        b.subscribe(t -> System.out.println(\"fan3 got: \" + t));\n        b.publish(\"FOUR! Kohli drives through cover\");\n        b.publish(\"OUT! Bowled him\");\n        System.out.println(\"subscribers left=\" + b.subscribers.size());\n    }\n}"
        }
      ],
      "alternatives": [
        "`ConcurrentHashMap.newKeySet()` for a weakly consistent view when subscribers change very often.",
        "A bounded queue and worker per subscriber so slow consumers do not delay the publisher."
      ],
      "say": "Many reads and rare writes, so copy-on-write. And I isolate each subscriber's failure so one slow or broken client cannot affect the others."
    }
  ]
}
);
