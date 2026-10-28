window.SCENARIOS = window.SCENARIOS || [];
window.SCENARIOS.push(
{
  "id": "hot-key-contention",
  "prompt": "A flash sale sends 50,000 requests a second at one product page. Every request updates the same row: the view counter, the stock count, the 'sold' number. The database is melting. How do you fix it?",
  "context": "The system is correct but slow. Every writer fights over one row (or one in-memory counter), so throughput is capped by how fast one lock, or one cache line, can be handed from thread to thread. Adding servers makes it worse, because there are now more writers queueing for the same key.\n\nThe interviewer wants to hear you separate two cases: numbers you can approximate (views, likes) and quantities that must stay exact (stock).",
  "whyHard": "Throughput on one key does not scale with hardware. A row lock, a mutex or even a compare-and-set on one memory location serialises every writer. All the fixes work by splitting one hot key into many cold ones, or by doing fewer writes. Each trades some exactness or read cost for write speed, so the right answer depends on whether the number must be exact.",
  "options": [
    {
      "name": "Shard the key",
      "concept": "Sharded counters (key splitting)",
      "conceptIds": [
        "atomic-operations-cas"
      ],
      "how": "Split the hot key into N sub-keys such as `product:42#0` to `product:42#N-1`. A writer picks a random shard, so writers rarely collide. A read sums all the shards.\n\nFor stock, spread the units across the shards and take a unit from a shard only while it is above zero, falling back to the next shard. The compare-and-set on each shard keeps the total exact: a unit is taken by exactly one successful update.",
      "code": [
        {
          "file": "ShardedCounter.java",
          "body": "import java.util.concurrent.ThreadLocalRandom;\nimport java.util.concurrent.atomic.AtomicLongArray;\n\n/** One logical counter split into N cells, so concurrent writers rarely touch the same memory. */\npublic class ShardedCounter {\n    private final AtomicLongArray shards;\n\n    public ShardedCounter(int shardCount) {\n        this.shards = new AtomicLongArray(shardCount);\n    }\n\n    public void increment() {\n        int i = ThreadLocalRandom.current().nextInt(shards.length());\n        shards.incrementAndGet(i);\n    }\n\n    /** Reads are eventually consistent: the sum can miss increments that are still in flight. */\n    public long sum() {\n        long total = 0;\n        for (int i = 0; i < shards.length(); i++) total += shards.get(i);\n        return total;\n    }\n}"
        },
        {
          "file": "ShardedStock.java",
          "body": "import java.util.concurrent.ThreadLocalRandom;\nimport java.util.concurrent.atomic.AtomicIntegerArray;\n\n/** A hot product's stock split across shards. Each shard is only decremented while it is above zero. */\npublic class ShardedStock {\n    private final AtomicIntegerArray shards;\n\n    public ShardedStock(int totalUnits, int shardCount) {\n        shards = new AtomicIntegerArray(shardCount);\n        for (int unit = 0; unit < totalUnits; unit++) shards.incrementAndGet(unit % shardCount);\n    }\n\n    /** Never oversells: a unit is taken by a successful compare-and-set on exactly one shard. */\n    public boolean tryTake() {\n        int start = ThreadLocalRandom.current().nextInt(shards.length());\n        for (int k = 0; k < shards.length(); k++) {\n            int i = (start + k) % shards.length();\n            int current;\n            while ((current = shards.get(i)) > 0) {\n                if (shards.compareAndSet(i, current, current - 1)) return true;\n            }\n        }\n        return false;\n    }\n}"
        }
      ],
      "pros": [
        "Write throughput grows with the number of shards",
        "Works in memory, in Redis (N keys) and in SQL (N rows)",
        "Stock stays exact: each unit is taken by one successful compare-and-set"
      ],
      "cons": [
        "A read must sum N shards, and a counter read can lag writes still in flight",
        "One shard can run dry while others still have units, so the take loop must scan them all",
        "Rebalancing units between shards adds complexity"
      ],
      "pickWhen": "A counter or stock value takes thousands of writes a second on one key and you can afford a slightly dearer read."
    },
    {
      "name": "One writer per key",
      "concept": "Single-writer principle (one thread owns the key)",
      "conceptIds": [
        "locks-synchronization"
      ],
      "how": "Route every update for a key to the same lane: a single thread, or a queue partition chosen by hashing the key. That thread changes the state with no lock at all, because nobody else can touch it. Different keys land on different lanes, so they still run in parallel. Kafka partitions by key and actor frameworks work the same way.",
      "code": [
        {
          "file": "KeyedSerialExecutor.java",
          "body": "import java.util.concurrent.Callable;\nimport java.util.concurrent.ExecutorService;\nimport java.util.concurrent.Executors;\nimport java.util.concurrent.Future;\n\n/** Every update for a key runs on the same single-thread lane, so that key needs no lock at all. */\npublic class KeyedSerialExecutor {\n    private final ExecutorService[] lanes;\n\n    public KeyedSerialExecutor(int laneCount) {\n        lanes = new ExecutorService[laneCount];\n        for (int i = 0; i < laneCount; i++) lanes[i] = Executors.newSingleThreadExecutor();\n    }\n\n    public <T> Future<T> submit(String key, Callable<T> task) {\n        int lane = Math.floorMod(key.hashCode(), lanes.length);\n        return lanes[lane].submit(task);\n    }\n\n    public void shutdown() {\n        for (ExecutorService lane : lanes) lane.shutdown();\n    }\n}"
        }
      ],
      "pros": [
        "No locks and no compare-and-set retries",
        "Updates to a key are naturally ordered",
        "A natural place to add batching"
      ],
      "cons": [
        "One very hot key still saturates one lane, so the ceiling for that key does not rise",
        "Adds queueing latency",
        "A crashed lane has to restart and rebuild its state"
      ],
      "pickWhen": "Operations on one key must apply in order and correctness matters more than the last bit of throughput, such as the highest bid in an auction."
    },
    {
      "name": "Batch the writes",
      "concept": "Write combining (batching)",
      "conceptIds": [
        "atomic-operations-cas"
      ],
      "how": "Accumulate increments in memory with a `LongAdder` and flush one combined `UPDATE counter SET n = n + :delta` every 100 milliseconds. Fifty thousand increments a second become about ten database writes a second.",
      "code": [
        {
          "file": "BatchedWriter.java",
          "body": "import java.util.concurrent.Executors;\nimport java.util.concurrent.ScheduledExecutorService;\nimport java.util.concurrent.TimeUnit;\nimport java.util.concurrent.atomic.LongAdder;\nimport java.util.function.LongConsumer;\n\n/** Collapses thousands of increments into one write per interval. */\npublic class BatchedWriter implements AutoCloseable {\n    private final LongAdder pending = new LongAdder();\n    private final LongConsumer storeDelta;\n    private final ScheduledExecutorService flusher = Executors.newSingleThreadScheduledExecutor();\n\n    public BatchedWriter(long intervalMillis, LongConsumer storeDelta) {\n        this.storeDelta = storeDelta;\n        flusher.scheduleAtFixedRate(this::flush, intervalMillis, intervalMillis, TimeUnit.MILLISECONDS);\n    }\n\n    public void add(long amount) {\n        pending.add(amount);\n    }\n\n    private void flush() {\n        long delta = pending.sumThenReset();\n        if (delta != 0) storeDelta.accept(delta);   // one \"UPDATE counter SET n = n + :delta\"\n    }\n\n    @Override\n    public void close() {\n        flusher.shutdown();\n        flush();   // do not lose the last partial batch\n    }\n}"
        }
      ],
      "pros": [
        "Cuts write load by orders of magnitude",
        "Small and easy to reason about"
      ],
      "cons": [
        "Increments made since the last flush are lost if the process crashes",
        "Database reads lag by up to the flush interval",
        "Not suitable when every write must be durably acknowledged, such as a purchase"
      ],
      "pickWhen": "Approximate, slightly delayed numbers are fine: views, likes, analytics."
    },
    {
      "name": "Replicate the key for reads",
      "concept": "Hot-key replication and read caching",
      "conceptIds": [
        "proxy"
      ],
      "how": "If the heat is reads of one key rather than writes, serve it from a small in-process cache with a one to five second TTL, or copy the key to several cache nodes (`product:42#r1` to `#r3`) and let each client pick one at random.",
      "pros": [
        "Takes the load off the primary almost completely",
        "Easy to add in front of an existing system"
      ],
      "cons": [
        "Readers see data up to one TTL old",
        "All replicas must be invalidated together on a write",
        "Does nothing for write contention"
      ],
      "pickWhen": "The pain is read traffic on one key and a few seconds of staleness is acceptable."
    }
  ],
  "recommendation": "First decide which kind of number it is.\n\nFor views and likes, batch the writes (option 3) and shard the counter as well if one node is still too slow. For stock, keep it exact: shard the units (option 1) and make the purchase idempotent, with a reservation hold for the last few units where sharding stops helping. Use a single-writer lane (option 2) when ordering matters more than raw throughput.\n\nAdd read replication (option 4) in every case, because it is nearly free. And revisit the design when the sale ends: a sharded layout that suits a flash sale is over-engineered for a normal Tuesday.",
  "say": "First I would ask whether the number has to be exact. If it is a view counter, I batch increments in memory and flush one combined update every few hundred milliseconds. If it is stock, I split it into shards so writers do not collide, take a unit with a compare-and-set on one shard, and fall back to the other shards when one is empty. For keys where ordering matters I would give each key a single writer lane. And I would cache reads of that product for a couple of seconds.",
  "appearsIn": [
    "limited-stock-cart",
    "quick-commerce-delivery-app",
    "amazon",
    "spotify",
    "cricinfo"
  ],
  "related": [
    "last-item-in-stock",
    "lost-update-counter",
    "atomic-operations-cas",
    "race-conditions",
    "read-heavy-caching"
  ]
},
{
  "id": "read-heavy-caching",
  "prompt": "Your product catalogue gets 100 reads for every write and the database is struggling. Add caching. Which strategy do you use, and what goes wrong when the data changes?",
  "context": "Most of the traffic is reads of the same popular items. The database can serve them, but at a cost, and latency is climbing. Product data changes a few times a day, and sometimes a price change must show up immediately.\n\nThe interviewer is less interested in the word 'cache' than in whether you can say who fills it, who invalidates it, and what happens at the edges.",
  "whyHard": "A cache is a second copy of the truth, and every copy can go stale. Adding the cache is easy. The hard part is deciding who updates it, when entries die, and what happens when many requests miss at the same moment. Each strategy trades freshness, write cost and complexity against each other.",
  "options": [
    {
      "name": "Cache-aside",
      "concept": "Cache-aside (lazy loading) with LRU eviction",
      "conceptIds": [
        "lru-cache"
      ],
      "how": "The application checks the cache first. On a miss it loads from the database and fills the cache. On a write it updates the database and then deletes the cached key. Evict with LRU so memory stays bounded, and add a TTL as a safety net for missed invalidations.\n\nThe snippet synchronises `get`, so concurrent misses on one key load once instead of stampeding the database. In production use per-key single-flight so unrelated keys do not wait on each other.",
      "code": [
        {
          "file": "CacheAside.java",
          "body": "import java.util.LinkedHashMap;\nimport java.util.Map;\nimport java.util.function.Function;\n\n/** Cache-aside: the application checks the cache, loads from the source of truth on a miss, then fills the cache. */\npublic class CacheAside<K, V> {\n    private final Map<K, V> cache;\n    private final Function<K, V> loader;   // the source of truth, e.g. a database read\n\n    public CacheAside(int capacity, Function<K, V> loader) {\n        this.loader = loader;\n        this.cache = new LinkedHashMap<K, V>(16, 0.75f, true) {   // access order = LRU eviction\n            @Override\n            protected boolean removeEldestEntry(Map.Entry<K, V> eldest) {\n                return size() > capacity;\n            }\n        };\n    }\n\n    /** Synchronized, so concurrent misses for one key trigger a single load instead of a stampede. */\n    public synchronized V get(K key) {\n        V value = cache.get(key);\n        if (value == null) {\n            value = loader.apply(key);\n            if (value != null) cache.put(key, value);\n        }\n        return value;\n    }\n\n    /** Call after every write to the source of truth. */\n    public synchronized void invalidate(K key) {\n        cache.remove(key);\n    }\n}"
        }
      ],
      "pros": [
        "Only data that is actually read gets cached",
        "If the cache is down, reads just get slower",
        "Simple and widely understood"
      ],
      "cons": [
        "The first read after a miss or an invalidation is slow",
        "A read racing with a write can put the old value back in the cache",
        "A hot key that expires can cause a stampede unless one request loads for everyone"
      ],
      "pickWhen": "The default for read-heavy data where brief staleness is tolerable."
    },
    {
      "name": "Write-through decorator",
      "concept": "Write-through cache (Decorator / caching proxy)",
      "conceptIds": [
        "decorator",
        "proxy"
      ],
      "how": "Wrap the store in a class that implements the same interface. A write goes to the database and then updates the cache within the same call, so a read after a write sees the new value. Callers never know a cache exists.",
      "code": [
        {
          "file": "WriteThroughStore.java",
          "body": "import java.util.Map;\nimport java.util.concurrent.ConcurrentHashMap;\n\ninterface Store {\n    String read(String key);\n    void write(String key, String value);\n}\n\n/** Decorator: same interface as the real store, with a cache in front of it. */\npublic class WriteThroughStore implements Store {\n    private final Store delegate;\n    private final Map<String, String> cache = new ConcurrentHashMap<>();\n\n    public WriteThroughStore(Store delegate) {\n        this.delegate = delegate;\n    }\n\n    @Override\n    public String read(String key) {\n        return cache.computeIfAbsent(key, delegate::read);\n    }\n\n    @Override\n    public void write(String key, String value) {\n        delegate.write(key, value);   // the source of truth first\n        cache.put(key, value);        // then refresh the cache, so readers never see the old value\n    }\n}"
        }
      ],
      "pros": [
        "Reads right after a write are warm and fresh",
        "Caching lives in one class and callers do not change"
      ],
      "cons": [
        "Every write pays for two writes",
        "Data that is written but never read still occupies the cache",
        "A crash between the database write and the cache update leaves a stale entry, so keep a TTL"
      ],
      "pickWhen": "Data is read soon after it is written and readers must not see old values."
    },
    {
      "name": "Event-driven invalidation",
      "concept": "Invalidate through change events (Observer)",
      "conceptIds": [
        "observer",
        "pub-sub-system"
      ],
      "how": "Writers publish a 'key changed' event. Every server holds a local cache subscribed to the bus and evicts that key when the event arrives. A short TTL covers events that never arrive.",
      "code": [
        {
          "file": "ChangeBus.java",
          "body": "import java.util.List;\nimport java.util.Map;\nimport java.util.concurrent.ConcurrentHashMap;\nimport java.util.concurrent.CopyOnWriteArrayList;\nimport java.util.function.Consumer;\nimport java.util.function.Function;\n\n/** Writers publish \"this key changed\"; every cache subscribed to the bus evicts that key. */\npublic class ChangeBus {\n    private final List<Consumer<String>> subscribers = new CopyOnWriteArrayList<>();\n\n    public void subscribe(Consumer<String> onChange) {\n        subscribers.add(onChange);\n    }\n\n    public void publishChange(String key) {\n        subscribers.forEach(s -> s.accept(key));\n    }\n}\n\nclass LocalCache {\n    private final Map<String, String> data = new ConcurrentHashMap<>();\n\n    LocalCache(ChangeBus bus) {\n        bus.subscribe(data::remove);\n    }\n\n    String get(String key, Function<String, String> loader) {\n        return data.computeIfAbsent(key, loader);\n    }\n}"
        }
      ],
      "pros": [
        "Local caches on many servers stay in step without polling",
        "The writer does not need to know who caches the data"
      ],
      "cons": [
        "Event delivery is not guaranteed, so a TTL is still needed",
        "A subscriber that is down serves stale data until it restarts or the TTL expires",
        "Needs a bus or broker to run"
      ],
      "pickWhen": "Several servers each keep a local cache of the same data and changes must spread in near real time."
    },
    {
      "name": "Precomputed read model",
      "concept": "Materialised view / read replica",
      "conceptIds": [],
      "how": "Build the exact shape the page needs (product, price and stock summary) in a separate store that is updated asynchronously from the write path, for example from events or change-data-capture. Or add read replicas and send reads there. There is no per-request caching logic at all.",
      "pros": [
        "Fast, predictable reads",
        "Reads scale independently of writes",
        "No invalidation code on the read path"
      ],
      "cons": [
        "Eventually consistent, with replication or projection lag",
        "More infrastructure to run",
        "The projection must be rebuilt when its shape changes"
      ],
      "pickWhen": "A few expensive read shapes carry most of the traffic and a short delay after a write is acceptable."
    }
  ],
  "recommendation": "Start with cache-aside, an LRU bound and a TTL (option 1). It is the smallest design that works.\n\nHide it behind the store interface, the way option 2's decorator does, so callers never see it and you can make a few entities write-through when they must be fresh straight after a write. Add event invalidation (option 3) only once you run several servers with local caches. Move to a read model (option 4) when profiling shows a handful of query shapes cause most of the load.\n\nWhatever you pick, keep a TTL: every invalidation scheme can miss an event.",
  "say": "I would put a cache-aside layer with LRU eviction and a TTL in front of the database, behind the same interface the callers already use. Writes update the database and invalidate the key. If a price must be fresh right after a write, that entity uses write-through. If we run many servers with local caches, I would publish change events so they evict together, and I would keep the TTL anyway because events can be lost.",
  "appearsIn": [
    "lru-cache",
    "amazon",
    "spotify",
    "online-bookstore",
    "shopping-cart-system"
  ],
  "related": [
    "stale-cache-after-update",
    "hot-key-contention",
    "proxy",
    "decorator",
    "observer"
  ]
},
{
  "id": "fan-out-to-millions",
  "prompt": "A user with 50 million followers posts. Their followers must see it in their feed, or get a notification, quickly. How do you deliver it without melting the system?",
  "context": "Most accounts have a few hundred followers. A handful have millions. The same code path has to serve both, and a celebrity posting during an event is a sudden burst, not a steady load.\n\nThe interviewer is looking for you to notice that the cost can be paid at write time, at read time, or smoothed through a queue, and that real systems mix the three.",
  "whyHard": "Delivering one post to N people is N units of work. For 500 followers that is nothing. For 50 million it is a backlog that outlives the news cycle. The cost has to land somewhere, and the follower distribution is wildly skewed, so any single strategy is either wasteful for the many or crushed by the few.",
  "options": [
    {
      "name": "Fan out on write (push)",
      "concept": "Push each post into every follower's inbox (Observer at scale)",
      "conceptIds": [
        "observer"
      ],
      "how": "When an author posts, copy the post id into each follower's inbox, capped at a few hundred entries. Reading a feed is one inbox lookup, so reads are very fast. The cost is paid once per post, per follower.",
      "code": [
        {
          "file": "FanOutOnWrite.java",
          "body": "import java.util.ArrayDeque;\nimport java.util.ArrayList;\nimport java.util.Deque;\nimport java.util.List;\nimport java.util.Map;\nimport java.util.Set;\nimport java.util.concurrent.ConcurrentHashMap;\n\n/** Push model: a post is copied into every follower's inbox when it is written. */\npublic class FanOutOnWrite {\n    private static final int INBOX_LIMIT = 800;\n\n    private final Map<String, Set<String>> followers = new ConcurrentHashMap<>();\n    private final Map<String, Deque<String>> inbox = new ConcurrentHashMap<>();\n\n    public void follow(String follower, String author) {\n        followers.computeIfAbsent(author, a -> ConcurrentHashMap.newKeySet()).add(follower);\n    }\n\n    /** Cost is O(followers) per post. Fine for 500 followers, a disaster for 50 million. */\n    public void post(String author, String postId) {\n        for (String follower : followers.getOrDefault(author, Set.of())) {\n            Deque<String> box = inbox.computeIfAbsent(follower, f -> new ArrayDeque<>());\n            synchronized (box) {\n                box.addFirst(postId);\n                if (box.size() > INBOX_LIMIT) box.removeLast();\n            }\n        }\n    }\n\n    /** Reading is a single lookup. */\n    public List<String> feed(String user, int limit) {\n        Deque<String> box = inbox.get(user);\n        if (box == null) return List.of();\n        synchronized (box) {\n            List<String> out = new ArrayList<>();\n            for (String id : box) {\n                if (out.size() == limit) break;\n                out.add(id);\n            }\n            return out;\n        }\n    }\n}"
        }
      ],
      "pros": [
        "Feed reads are a single fast lookup",
        "Simple to understand and to rank"
      ],
      "cons": [
        "A post by a celebrity writes millions of inbox entries",
        "Wasted work for followers who never log in",
        "Inbox storage grows with followers times posts"
      ],
      "pickWhen": "Most authors have modest follower counts and reads are far more frequent than posts."
    },
    {
      "name": "Fan out on read (pull)",
      "concept": "Merge followed authors' recent posts at read time (k-way merge)",
      "conceptIds": [
        "iterator"
      ],
      "how": "A post is stored once, under its author. When a user opens the feed, fetch the latest posts of every author they follow and merge them by time with a priority queue. Writes stay cheap, whatever the follower count.",
      "code": [
        {
          "file": "FanOutOnRead.java",
          "body": "import java.util.ArrayList;\nimport java.util.Comparator;\nimport java.util.List;\nimport java.util.Map;\nimport java.util.PriorityQueue;\nimport java.util.Set;\nimport java.util.concurrent.ConcurrentHashMap;\nimport java.util.concurrent.CopyOnWriteArrayList;\n\n/** Pull model: nothing is copied on write. The feed is merged from the followed authors when it is read. */\npublic class FanOutOnRead {\n    public record Post(String id, long time) {}\n\n    private final Map<String, Set<String>> following = new ConcurrentHashMap<>();\n    private final Map<String, List<Post>> postsByAuthor = new ConcurrentHashMap<>();   // newest last\n\n    public void follow(String follower, String author) {\n        following.computeIfAbsent(follower, f -> ConcurrentHashMap.newKeySet()).add(author);\n    }\n\n    /** One write per post, however many followers there are. */\n    public void post(String author, Post post) {\n        postsByAuthor.computeIfAbsent(author, a -> new CopyOnWriteArrayList<>()).add(post);\n    }\n\n    /** Cost is O(authors followed) per read: cheap writes, more expensive reads. */\n    public List<Post> feed(String user, int limit) {\n        PriorityQueue<Post> newestFirst = new PriorityQueue<>(Comparator.comparingLong(Post::time).reversed());\n        for (String author : following.getOrDefault(user, Set.of())) {\n            List<Post> posts = postsByAuthor.getOrDefault(author, List.of());\n            int from = Math.max(0, posts.size() - limit);\n            newestFirst.addAll(posts.subList(from, posts.size()));\n        }\n        List<Post> out = new ArrayList<>();\n        while (out.size() < limit && !newestFirst.isEmpty()) out.add(newestFirst.poll());\n        return out;\n    }\n}"
        }
      ],
      "pros": [
        "One write per post, even for a celebrity",
        "No work for followers who never read"
      ],
      "cons": [
        "Reads cost one lookup per followed author",
        "Hard to keep feed latency low for users who follow thousands of accounts"
      ],
      "pickWhen": "Authors have huge follower counts and each reader follows few of them."
    },
    {
      "name": "Hybrid: push for most, pull for celebrities",
      "concept": "Choose the delivery strategy per author (Strategy)",
      "conceptIds": [
        "strategy"
      ],
      "how": "Above a follower threshold, an author is treated as a celebrity: their posts are stored once and pulled at read time. Everyone else is pushed to inboxes. A feed read merges the user's inbox with the recent posts of the celebrities they follow.",
      "code": [
        {
          "file": "HybridFeed.java",
          "body": "import java.util.ArrayList;\nimport java.util.Comparator;\nimport java.util.List;\nimport java.util.Map;\nimport java.util.Set;\nimport java.util.concurrent.ConcurrentHashMap;\nimport java.util.concurrent.CopyOnWriteArrayList;\n\n/** Push for ordinary authors, pull for celebrities, merged when the feed is read. */\npublic class HybridFeed {\n    public record Post(String id, long time) {}\n\n    private static final int CELEBRITY_FOLLOWERS = 100_000;\n\n    private final Map<String, Set<String>> followersOf = new ConcurrentHashMap<>();\n    private final Map<String, Set<String>> followed = new ConcurrentHashMap<>();\n    private final Map<String, List<Post>> inbox = new ConcurrentHashMap<>();\n    private final Map<String, List<Post>> celebrityPosts = new ConcurrentHashMap<>();\n\n    public void follow(String follower, String author) {\n        followersOf.computeIfAbsent(author, a -> ConcurrentHashMap.newKeySet()).add(follower);\n        followed.computeIfAbsent(follower, f -> ConcurrentHashMap.newKeySet()).add(author);\n    }\n\n    private boolean isCelebrity(String author) {\n        return followersOf.getOrDefault(author, Set.of()).size() >= CELEBRITY_FOLLOWERS;\n    }\n\n    public void post(String author, Post post) {\n        if (isCelebrity(author)) {\n            celebrityPosts.computeIfAbsent(author, a -> new CopyOnWriteArrayList<>()).add(post);   // 1 write, pulled later\n            return;\n        }\n        for (String follower : followersOf.getOrDefault(author, Set.of())) {\n            inbox.computeIfAbsent(follower, f -> new CopyOnWriteArrayList<>()).add(post);          // N writes, pushed now\n        }\n    }\n\n    public List<Post> feed(String user, int limit) {\n        List<Post> merged = new ArrayList<>(inbox.getOrDefault(user, List.of()));\n        for (String author : followed.getOrDefault(user, Set.of())) {\n            if (isCelebrity(author)) merged.addAll(celebrityPosts.getOrDefault(author, List.of()));\n        }\n        merged.sort(Comparator.comparingLong(Post::time).reversed());\n        return merged.size() > limit ? merged.subList(0, limit) : merged;\n    }\n}"
        }
      ],
      "pros": [
        "Cheap writes for celebrities and cheap reads for everyone else",
        "The threshold is a tuning knob"
      ],
      "cons": [
        "Two code paths to build, test and keep consistent",
        "An author who crosses the threshold has posts in both places"
      ],
      "pickWhen": "Follower counts are heavily skewed, which is true of almost every social product."
    },
    {
      "name": "Queue and batch the deliveries",
      "concept": "Message queue with batched workers (Pub/Sub)",
      "conceptIds": [
        "pub-sub-system"
      ],
      "how": "Instead of delivering inline, the post publishes one event. A pool of workers pulls 'deliver to user X' jobs from a bounded queue and sends them in batches, for example one push-gateway call per 500 users. A full queue slows the producer, which gives you back-pressure.",
      "code": [
        {
          "file": "BatchedNotifier.java",
          "body": "import java.util.ArrayList;\nimport java.util.List;\nimport java.util.concurrent.ArrayBlockingQueue;\nimport java.util.concurrent.BlockingQueue;\nimport java.util.concurrent.ExecutorService;\nimport java.util.concurrent.Executors;\nimport java.util.concurrent.TimeUnit;\nimport java.util.function.Consumer;\n\n/** Producers enqueue \"notify this user\" jobs; a worker pool drains them in batches. */\npublic class BatchedNotifier implements AutoCloseable {\n    private final BlockingQueue<String> queue = new ArrayBlockingQueue<>(100_000);\n    private final ExecutorService workers;\n    private volatile boolean running = true;\n\n    public BatchedNotifier(int workerCount, int batchSize, Consumer<List<String>> sendBatch) {\n        workers = Executors.newFixedThreadPool(workerCount);\n        for (int i = 0; i < workerCount; i++) {\n            workers.submit(() -> {\n                List<String> batch = new ArrayList<>(batchSize);\n                while (running || !queue.isEmpty()) {\n                    try {\n                        String first = queue.poll(200, TimeUnit.MILLISECONDS);\n                        if (first == null) continue;\n                        batch.add(first);\n                        queue.drainTo(batch, batchSize - 1);\n                        sendBatch.accept(new ArrayList<>(batch));   // e.g. one push-gateway call for the whole batch\n                        batch.clear();\n                    } catch (InterruptedException e) {\n                        Thread.currentThread().interrupt();\n                        return;\n                    }\n                }\n            });\n        }\n    }\n\n    /** Blocks when the queue is full: natural back-pressure on the producer. */\n    public void enqueue(String userId) throws InterruptedException {\n        queue.put(userId);\n    }\n\n    @Override\n    public void close() throws InterruptedException {\n        running = false;\n        workers.shutdown();\n        workers.awaitTermination(5, TimeUnit.SECONDS);\n    }\n}"
        }
      ],
      "pros": [
        "Smooths a burst into steady work",
        "Workers scale out horizontally",
        "Retries and rate limits to downstream providers become easy"
      ],
      "cons": [
        "Delivery is delayed by queue depth",
        "Needs idempotent delivery, because retries mean duplicates are possible"
      ],
      "pickWhen": "The delivery itself (push notification, email, inbox write) is slow or rate limited."
    }
  ],
  "recommendation": "Use the hybrid (option 3) and run the push side through a queue (option 4).\n\nOrdinary authors are fanned out through batched workers, so a burst becomes steady work. Celebrities are stored once and pulled at read time. Cap each inbox, and when notifying, deliver to recently active users first.\n\nMake delivery idempotent, because a queue plus retries means a message can arrive twice. Keep the threshold in configuration so you can tune it with real data rather than guesses.",
  "say": "I would not pick one strategy. For ordinary authors I push the post to followers' inboxes through a queue with batched workers, so a burst turns into steady work. For authors above a follower threshold I store the post once and merge it into each follower's feed at read time. Delivery is idempotent because retries can duplicate messages, and I would notify the most recently active followers first.",
  "appearsIn": [
    "social-network",
    "linkedin",
    "notification-system",
    "chat-application",
    "cricinfo"
  ],
  "related": [
    "message-delivery-guarantees",
    "add-new-notification-channel",
    "observer",
    "pub-sub-system",
    "hot-key-contention"
  ]
},
{
  "id": "search-and-filter-speed",
  "prompt": "Users search ten million products by keyword and filter by category and price range. A full table scan takes seconds. How do you make it fast?",
  "context": "The current code loops over every product and tests each one. It works in a demo with a thousand rows. In production, search is the most used feature and its latency is the first thing users notice.\n\nThe interviewer wants to see that you can match the data structure to the question being asked: text lookup, range query, or arbitrary combinations of filters.",
  "whyHard": "Different questions need different structures. A hash map answers equality but not ranges. A sorted structure answers ranges but not 'contains this word'. Users also combine filters in unpredictable ways, so you cannot hand-build an index for every combination. Every index you add speeds reads and slows writes.",
  "options": [
    {
      "name": "Inverted index",
      "concept": "Inverted index (term to document ids)",
      "conceptIds": [],
      "how": "For each word, store the sorted set of document ids that contain it. A multi-word search intersects those sets, starting from the rarest word so the working set stays small. This is the core of every full-text search engine.",
      "code": [
        {
          "file": "InvertedIndex.java",
          "body": "import java.util.ArrayList;\nimport java.util.Comparator;\nimport java.util.HashMap;\nimport java.util.List;\nimport java.util.Map;\nimport java.util.Set;\nimport java.util.TreeSet;\n\npublic class InvertedIndex {\n    private final Map<String, Set<Integer>> postings = new HashMap<>();   // term -> ids of documents containing it\n\n    public void add(int docId, String text) {\n        for (String term : text.toLowerCase().split(\"\\\\W+\")) {\n            if (!term.isEmpty()) postings.computeIfAbsent(term, t -> new TreeSet<>()).add(docId);\n        }\n    }\n\n    /** AND query. Intersect starting from the rarest term so the working set stays small. */\n    public Set<Integer> search(String... terms) {\n        if (terms.length == 0) return Set.of();\n        List<Set<Integer>> lists = new ArrayList<>();\n        for (String term : terms) {\n            Set<Integer> docs = postings.get(term.toLowerCase());\n            if (docs == null) return Set.of();\n            lists.add(docs);\n        }\n        lists.sort(Comparator.comparingInt(Set::size));\n        Set<Integer> result = new TreeSet<>(lists.get(0));\n        for (int i = 1; i < lists.size() && !result.isEmpty(); i++) result.retainAll(lists.get(i));\n        return result;\n    }\n}"
        }
      ],
      "pros": [
        "Keyword search no longer depends on the number of products",
        "Easy to extend with ranking, stemming and prefix search"
      ],
      "cons": [
        "Must be updated whenever a document changes",
        "Memory heavy for large vocabularies",
        "Handles text well but not numeric ranges"
      ],
      "pickWhen": "The main query is keyword or full-text search."
    },
    {
      "name": "Sorted secondary index",
      "concept": "Secondary index (category, then sorted price)",
      "conceptIds": [],
      "how": "Keep a map from category to a sorted map from price to products. A category plus price-range filter becomes a lookup and a range scan over just the matching slice. A database composite index on (category, price) does exactly this for you.",
      "code": [
        {
          "file": "ProductIndex.java",
          "body": "import java.util.ArrayList;\nimport java.util.HashMap;\nimport java.util.List;\nimport java.util.Map;\nimport java.util.NavigableMap;\nimport java.util.TreeMap;\n\n/** A secondary index: category first, then a sorted price axis for range queries. */\npublic class ProductIndex {\n    public record Product(int id, String category, int priceCents) {}\n\n    private final Map<String, NavigableMap<Integer, List<Product>>> byCategoryThenPrice = new HashMap<>();\n\n    public void add(Product p) {\n        byCategoryThenPrice\n            .computeIfAbsent(p.category(), c -> new TreeMap<>())\n            .computeIfAbsent(p.priceCents(), price -> new ArrayList<>())\n            .add(p);\n    }\n\n    /** O(log n + result size) instead of scanning every product. */\n    public List<Product> find(String category, int minCents, int maxCents) {\n        NavigableMap<Integer, List<Product>> prices = byCategoryThenPrice.get(category);\n        if (prices == null) return List.of();\n        List<Product> out = new ArrayList<>();\n        prices.subMap(minCents, true, maxCents, true).values().forEach(out::addAll);\n        return out;\n    }\n}"
        }
      ],
      "pros": [
        "Range and equality filters in O(log n + results)",
        "Predictable performance"
      ],
      "cons": [
        "One index per query shape",
        "Each index costs memory and slows writes",
        "Only helps filters the index was designed for"
      ],
      "pickWhen": "The common filters are known, such as category and price range, and you can index them."
    },
    {
      "name": "Composable specifications",
      "concept": "Specification objects composed with and/or/not (Composite, Strategy)",
      "conceptIds": [
        "composite",
        "strategy"
      ],
      "how": "Model each criterion as a small predicate object and combine them: city is Pune and stars at least four and price at most 8000. This keeps the API small instead of one method per filter combination. In memory it is still a scan, so to get speed you translate the same specification tree into a `WHERE` clause or index lookups.",
      "code": [
        {
          "file": "Specs.java",
          "body": "import java.util.List;\nimport java.util.stream.Collectors;\n\n@FunctionalInterface\ninterface Spec<T> {\n    boolean matches(T item);\n\n    default Spec<T> and(Spec<T> other) { return t -> matches(t) && other.matches(t); }\n    default Spec<T> or(Spec<T> other)  { return t -> matches(t) || other.matches(t); }\n    default Spec<T> not()              { return t -> !matches(t); }\n}\n\npublic class Specs {\n    public record Hotel(String city, int stars, int priceCents, boolean petFriendly) {}\n\n    static Spec<Hotel> city(String c)  { return h -> h.city().equals(c); }\n    static Spec<Hotel> minStars(int s) { return h -> h.stars() >= s; }\n    static Spec<Hotel> maxPrice(int p) { return h -> h.priceCents() <= p; }\n    static Spec<Hotel> petFriendly()   { return Hotel::petFriendly; }\n\n    /** Callers compose criteria: city(\"Pune\").and(minStars(4)).and(maxPrice(8000)).or(petFriendly()). */\n    public static List<Hotel> search(List<Hotel> all, Spec<Hotel> spec) {\n        return all.stream().filter(spec::matches).collect(Collectors.toList());\n    }\n}"
        }
      ],
      "pros": [
        "Arbitrary filter combinations without a method for each",
        "Each criterion is tested on its own"
      ],
      "cons": [
        "The in-memory version is O(n) per query",
        "The abstraction hides what the database can actually index"
      ],
      "pickWhen": "Users combine many optional filters, and you either have a small data set or translate the specification to a query."
    },
    {
      "name": "Dedicated search engine or read model",
      "concept": "Search engine fed from the primary store (Elasticsearch, OpenSearch)",
      "conceptIds": [],
      "how": "Stream changes from the primary database into a search engine that owns inverted indexes, range structures, relevance scoring and facets. The search request goes to the engine, and the database stays the source of truth.",
      "pros": [
        "Full-text relevance, facets and filters work together",
        "Search load is off the primary database"
      ],
      "cons": [
        "Eventual consistency between the database and the index",
        "Another system to run, monitor and reindex"
      ],
      "pickWhen": "You need relevance ranking, typo tolerance or faceted navigation at scale."
    }
  ],
  "recommendation": "Start where the data already lives: add a composite database index for the filters people actually use (option 2). That alone often removes the full scan.\n\nWhen keyword search matters, use an inverted index (option 1), in practice through a search engine (option 4) so you also get ranking and facets. Keep the filter API in code as specifications (option 3) so callers compose criteria freely, and make sure each specification can translate to a query rather than being tested row by row.\n\nIndex only the shapes you have measured, because every index slows writes.",
  "say": "I would match the structure to the query. Category and price range get a composite index so the database does a range scan. Keyword search gets an inverted index, usually through a search engine fed from the main database, which also gives ranking and facets. In code I would model filters as composable specifications and translate them into queries, so combinations do not need new methods. And I would only index query shapes I have measured, because each index slows writes.",
  "appearsIn": [
    "stack-overflow",
    "amazon",
    "online-bookstore",
    "spotify",
    "linkedin"
  ],
  "related": [
    "read-heavy-caching",
    "large-collections-memory",
    "strategy",
    "composite"
  ]
},
{
  "id": "large-collections-memory",
  "prompt": "A report endpoint returns twenty million rows, or a game holds a million objects on the board, and the service keeps running out of memory. What do you change?",
  "context": "The code builds the full list in memory, then serialises or processes it. On test data of a few hundred rows it is fine. In production the heap fills, garbage collection stalls and the process is killed.\n\nThe interviewer wants to hear you ask whether callers really need everything at once, and what repeats across the objects.",
  "whyHard": "Memory is used by what you hold at the same time, not by what you process in total. The fixes either hold less at once (pages, streams), share what repeats (Flyweight) or store it more compactly (bit sets, primitives). Each one limits how callers can use the data: no random access in a stream, no cheap jump to page 5,000 with offsets, no mutating shared objects.",
  "options": [
    {
      "name": "Keyset pagination",
      "concept": "Cursor (keyset) pagination instead of OFFSET",
      "conceptIds": [
        "iterator"
      ],
      "how": "Return a page and a cursor, the last id seen. The next request asks for `id > cursor` ordered by id with a limit. The cost of a page stays the same however deep the user scrolls, whereas `OFFSET 1000000` makes the database walk and discard a million rows first.",
      "code": [
        {
          "file": "KeysetPaginator.java",
          "body": "import java.util.ArrayList;\nimport java.util.List;\n\npublic class KeysetPaginator {\n    public record Item(long id, String name) {}\n    public record Page(List<Item> items, Long nextCursor) {}\n\n    private final List<Item> sortedById;   // stands in for an indexed table\n\n    public KeysetPaginator(List<Item> sortedById) {\n        this.sortedById = sortedById;\n    }\n\n    /**\n     * SELECT ... WHERE id > :cursor ORDER BY id LIMIT :limit.\n     * Cost is O(log n + limit) however deep the user scrolls; OFFSET pagination gets slower with every page.\n     */\n    public Page next(Long cursor, int limit) {\n        int start = 0;\n        if (cursor != null) {\n            int lo = 0, hi = sortedById.size();\n            while (lo < hi) {\n                int mid = (lo + hi) >>> 1;\n                if (sortedById.get(mid).id() <= cursor) lo = mid + 1; else hi = mid;\n            }\n            start = lo;\n        }\n        int end = Math.min(sortedById.size(), start + limit);\n        List<Item> items = new ArrayList<>(sortedById.subList(start, end));\n        Long nextCursor = (end < sortedById.size() && !items.isEmpty()) ? Long.valueOf(items.get(items.size() - 1).id()) : null;\n        return new Page(items, nextCursor);\n    }\n}"
        }
      ],
      "pros": [
        "Constant cost per page",
        "Stable results when rows are inserted while paging"
      ],
      "cons": [
        "No jumping straight to page N",
        "Needs a unique, indexed sort key"
      ],
      "pickWhen": "Humans or clients scroll through a large ordered list."
    },
    {
      "name": "Stream in chunks",
      "concept": "Lazy iterator over chunks of the source (Iterator)",
      "conceptIds": [
        "iterator"
      ],
      "how": "Expose the data as an `Iterator` that fetches the next chunk only when the current one is exhausted. The consumer sees one long sequence, but only a single chunk is in memory at any moment. Export jobs, batch processing and file uploads fit this shape.",
      "code": [
        {
          "file": "ChunkedIterator.java",
          "body": "import java.util.Iterator;\nimport java.util.List;\nimport java.util.NoSuchElementException;\nimport java.util.function.BiFunction;\n\n/** Walks an arbitrarily large source while holding only one chunk in memory. */\npublic class ChunkedIterator<T> implements Iterator<T> {\n    private final BiFunction<Long, Integer, List<T>> fetch;   // (offset, size) -> next rows, empty at the end\n    private final int chunkSize;\n    private long offset = 0;\n    private Iterator<T> current = List.<T>of().iterator();\n    private boolean exhausted = false;\n\n    public ChunkedIterator(int chunkSize, BiFunction<Long, Integer, List<T>> fetch) {\n        this.chunkSize = chunkSize;\n        this.fetch = fetch;\n    }\n\n    @Override\n    public boolean hasNext() {\n        while (!current.hasNext() && !exhausted) {\n            List<T> chunk = fetch.apply(offset, chunkSize);\n            if (chunk.isEmpty()) {\n                exhausted = true;\n            } else {\n                offset += chunk.size();\n                current = chunk.iterator();\n            }\n        }\n        return current.hasNext();\n    }\n\n    @Override\n    public T next() {\n        if (!hasNext()) throw new NoSuchElementException();\n        return current.next();\n    }\n}"
        }
      ],
      "pros": [
        "Memory is bounded by the chunk size, not the data size",
        "Callers keep a simple loop"
      ],
      "cons": [
        "Sequential access only",
        "The source can change between chunks, so use a stable cursor or a snapshot",
        "Holds a connection open for long jobs"
      ],
      "pickWhen": "A job must process everything once, such as an export, a migration or a nightly report."
    },
    {
      "name": "Share repeated state",
      "concept": "Flyweight: share immutable intrinsic state",
      "conceptIds": [
        "flyweight"
      ],
      "how": "Split each object into intrinsic state, which is identical across many instances (a piece's name, sprite and value), and extrinsic state, which is unique (its position and colour). Share one immutable object for the intrinsic part through a factory, and keep only the tiny unique part per instance.",
      "code": [
        {
          "file": "Piece.java",
          "body": "import java.util.HashMap;\nimport java.util.Map;\n\n/** Intrinsic state: identical for every piece of a kind, so it is shared and immutable. */\nfinal class PieceType {\n    final String name;\n    final String spriteFile;\n    final int value;\n\n    PieceType(String name, String spriteFile, int value) {\n        this.name = name;\n        this.spriteFile = spriteFile;\n        this.value = value;\n    }\n}\n\nclass PieceTypeFactory {\n    private static final Map<String, PieceType> CACHE = new HashMap<>();\n\n    static synchronized PieceType get(String name, String spriteFile, int value) {\n        return CACHE.computeIfAbsent(name, n -> new PieceType(n, spriteFile, value));\n    }\n\n    static synchronized int distinctTypes() {\n        return CACHE.size();\n    }\n}\n\n/** Extrinsic state: the only per-piece data. A million boards share the same few PieceType objects. */\npublic class Piece {\n    final PieceType type;\n    final byte row;\n    final byte col;\n    final boolean white;\n\n    Piece(PieceType type, int row, int col, boolean white) {\n        this.type = type;\n        this.row = (byte) row;\n        this.col = (byte) col;\n        this.white = white;\n    }\n}"
        }
      ],
      "pros": [
        "Large reductions in memory when many objects repeat the same data",
        "Shared objects are immutable, so they are thread safe"
      ],
      "cons": [
        "Extra indirection and a factory to maintain",
        "Only pays off when most of the state really is shared"
      ],
      "pickWhen": "You hold many objects whose heavy fields are mostly identical."
    },
    {
      "name": "Compact representation",
      "concept": "Compact data structures (BitSet, primitive arrays)",
      "conceptIds": [],
      "how": "When the state of each element is a single bit or a small number, stop using one object per element. A `BitSet` stores 100,000 seat flags in about 12.5 KB, and the operations to find the next free seat or count the free ones are built in.",
      "code": [
        {
          "file": "SeatMap.java",
          "body": "import java.util.BitSet;\n\n/** 100,000 seats cost about 12.5 KB as bits, instead of 100,000 Seat objects. */\npublic class SeatMap {\n    private final BitSet booked;\n    private final int seats;\n\n    public SeatMap(int seats) {\n        this.seats = seats;\n        this.booked = new BitSet(seats);\n    }\n\n    public synchronized boolean tryBook(int seat) {\n        if (booked.get(seat)) return false;\n        booked.set(seat);\n        return true;\n    }\n\n    public synchronized int firstFree() {\n        int i = booked.nextClearBit(0);\n        return i < seats ? i : -1;\n    }\n\n    public synchronized int freeCount() {\n        return seats - booked.cardinality();\n    }\n}"
        }
      ],
      "pros": [
        "Orders of magnitude less memory",
        "Fast scans and counts that are friendly to the CPU cache"
      ],
      "cons": [
        "Loses per-element behaviour and metadata",
        "Less readable than a domain object",
        "Needs a lock or atomics because bits share words"
      ],
      "pickWhen": "Each element's state is a flag or a small number and there are very many of them."
    }
  ],
  "recommendation": "Ask first whether the caller needs everything at once. Interactive screens almost never do, so use keyset pagination (option 1). Jobs that must touch every row use a chunked stream (option 2).\n\nOnly when the data is truly resident in memory, such as game state or a cached catalogue, reach for structure: share repeated fields with Flyweight (option 3) and use bit sets or primitive arrays for flag-like data (option 4). Measure the heap before and after, because Flyweight and compact structures cost readability and should earn their place.",
  "say": "I would first ask whether the caller needs it all at once. For screens I paginate with a cursor, so each page costs the same however deep you go. For exports I stream in chunks with an iterator, so memory is bounded by the chunk size. If the data really must live in memory, I share the repeated immutable parts with Flyweight and store flags in a bit set instead of an object per element, and I measure the heap to prove it helped.",
  "appearsIn": [
    "chess-game",
    "concert-ticket-booking",
    "movie-ticket-booking",
    "spotify",
    "file-storage-system",
    "parking-lot"
  ],
  "related": [
    "search-and-filter-speed",
    "iterator",
    "flyweight",
    "fan-out-to-millions"
  ]
},
{
  "id": "rate-limit-abuse",
  "prompt": "One client is sending 10,000 requests a second and everyone else is getting slow responses. Design a rate limiter.",
  "context": "Some of this is accidental, such as a retry loop with no backoff, and some is malicious, such as a scraper or a guessing attack on a login or OTP endpoint. Either way a single caller must not be able to take the service away from the rest.\n\nThe interviewer wants to hear the algorithm, how you key it (per user, per API key, per IP), and what happens when you run more than one server.",
  "whyHard": "A limiter is itself on the hot path, so it must be cheap and thread safe. The algorithms differ in how they treat bursts and window edges. Memory per client grows with the number of clients, and across several servers the counters need a shared, atomic store or the limit silently multiplies by the number of servers.",
  "options": [
    {
      "name": "Token bucket",
      "concept": "Token bucket (Strategy for the policy)",
      "conceptIds": [
        "strategy"
      ],
      "how": "Each client has a bucket holding up to N tokens that refills at a steady rate. A request takes a token or is rejected. A full bucket allows a short burst of N requests, then the client is held to the refill rate.\n\nThe clock is injected so tests can control time.",
      "code": [
        {
          "file": "TokenBucket.java",
          "body": "import java.util.function.LongSupplier;\n\n/** Allows bursts up to `capacity`, then a steady refill rate. */\npublic class TokenBucket {\n    private final long capacity;\n    private final double refillPerNano;\n    private final LongSupplier nanoClock;   // System::nanoTime in production, a fake in tests\n    private double tokens;\n    private long lastRefill;\n\n    public TokenBucket(long capacity, double refillPerSecond, LongSupplier nanoClock) {\n        this.capacity = capacity;\n        this.refillPerNano = refillPerSecond / 1_000_000_000.0;\n        this.nanoClock = nanoClock;\n        this.tokens = capacity;\n        this.lastRefill = nanoClock.getAsLong();\n    }\n\n    public synchronized boolean tryAcquire() {\n        long now = nanoClock.getAsLong();\n        tokens = Math.min(capacity, tokens + (now - lastRefill) * refillPerNano);\n        lastRefill = now;\n        if (tokens >= 1) {\n            tokens -= 1;\n            return true;\n        }\n        return false;\n    }\n}"
        }
      ],
      "pros": [
        "Allows natural bursts while enforcing an average rate",
        "Constant memory per client",
        "Cheap to compute"
      ],
      "cons": [
        "A burst is allowed up to the bucket size, which may be too generous",
        "Needs a careful, monotonic clock"
      ],
      "pickWhen": "Short bursts are acceptable and a long-run average is what you want to enforce. This is the usual default."
    },
    {
      "name": "Sliding window log",
      "concept": "Sliding window log (exact timestamps)",
      "conceptIds": [],
      "how": "Keep the timestamps of the client's recent allowed requests. Drop those older than the window, and allow the request only if fewer than the limit remain. The limit is exact over any rolling window, with no boundary effects.",
      "code": [
        {
          "file": "SlidingWindowLimiter.java",
          "body": "import java.util.ArrayDeque;\nimport java.util.Deque;\nimport java.util.function.LongSupplier;\n\n/** Exact limit over any rolling window, at the cost of storing one timestamp per allowed request. */\npublic class SlidingWindowLimiter {\n    private final int limit;\n    private final long windowMillis;\n    private final LongSupplier clockMillis;\n    private final Deque<Long> timestamps = new ArrayDeque<>();\n\n    public SlidingWindowLimiter(int limit, long windowMillis, LongSupplier clockMillis) {\n        this.limit = limit;\n        this.windowMillis = windowMillis;\n        this.clockMillis = clockMillis;\n    }\n\n    public synchronized boolean tryAcquire() {\n        long now = clockMillis.getAsLong();\n        while (!timestamps.isEmpty() && now - timestamps.peekFirst() >= windowMillis) timestamps.pollFirst();\n        if (timestamps.size() >= limit) return false;\n        timestamps.addLast(now);\n        return true;\n    }\n}"
        }
      ],
      "pros": [
        "Exact: no burst at window edges",
        "Easy to explain"
      ],
      "cons": [
        "Stores one timestamp per allowed request, so memory grows with the limit",
        "More work per request than a counter"
      ],
      "pickWhen": "The limit is small, such as five login attempts in ten minutes, and exactness matters."
    },
    {
      "name": "Fixed window counter",
      "concept": "Fixed window counter (atomic INCR with expiry)",
      "conceptIds": [
        "atomic-operations-cas"
      ],
      "how": "Count requests in each calendar window, such as one minute. Reject when the count passes the limit and reset at the next window. In Redis this is a single atomic `INCR` with `PEXPIRE`, so it is shared by every server. The weakness is the boundary: a client can send a full limit at the end of one window and again at the start of the next.",
      "code": [
        {
          "file": "FixedWindowLimiter.java",
          "body": "import java.util.function.LongSupplier;\n\n/** Simplest limiter: one counter per window. A client can burst 2x the limit across a window boundary. */\npublic class FixedWindowLimiter {\n    private final int limit;\n    private final long windowMillis;\n    private final LongSupplier clockMillis;\n    private long windowStart;\n    private int count;\n\n    public FixedWindowLimiter(int limit, long windowMillis, LongSupplier clockMillis) {\n        this.limit = limit;\n        this.windowMillis = windowMillis;\n        this.clockMillis = clockMillis;\n    }\n\n    public synchronized boolean tryAcquire() {\n        long now = clockMillis.getAsLong();\n        if (now - windowStart >= windowMillis) {\n            windowStart = now - (now % windowMillis);\n            count = 0;\n        }\n        if (count >= limit) return false;\n        count++;\n        return true;\n    }\n}"
        },
        {
          "file": "fixed_window.lua",
          "body": "-- KEYS[1] = \"rate:<client>:<window number>\", ARGV[1] = window in ms, ARGV[2] = limit\nlocal count = redis.call('INCR', KEYS[1])\nif count == 1 then\n  redis.call('PEXPIRE', KEYS[1], ARGV[1])\nend\nif count > tonumber(ARGV[2]) then\n  return 0\nend\nreturn 1"
        }
      ],
      "pros": [
        "Very cheap: one counter per client per window",
        "Trivial to run in Redis for all servers"
      ],
      "cons": [
        "Up to twice the limit can pass around a window boundary",
        "Resets are bunched on the window edge"
      ],
      "pickWhen": "You need a coarse, cheap, shared limit and a boundary burst is not a problem."
    },
    {
      "name": "Per-client limiter with eviction",
      "concept": "Map of client key to bucket, with idle eviction",
      "conceptIds": [
        "lru-cache"
      ],
      "how": "Real traffic has many clients, so keep a concurrent map from the client key to its bucket. Create buckets on demand and evict the ones that have been idle, as an LRU does, so the map cannot grow without bound. Decide what the key is: user id, API key, IP, or a combination. Across servers, push the buckets to a shared store or accept that each server enforces its own share.",
      "code": [
        {
          "file": "PerKeyRateLimiter.java",
          "body": "import java.util.concurrent.ConcurrentHashMap;\n\n/** One bucket per client key (user id, API key or IP). Idle buckets are evicted so the map cannot grow forever. */\npublic class PerKeyRateLimiter {\n    private static final class Bucket {\n        private final long capacity;\n        private final double refillPerNano;\n        private double tokens;\n        private long lastRefill;\n        private volatile long lastSeen;\n\n        Bucket(long capacity, double refillPerSecond, long now) {\n            this.capacity = capacity;\n            this.refillPerNano = refillPerSecond / 1_000_000_000.0;\n            this.tokens = capacity;\n            this.lastRefill = now;\n            this.lastSeen = now;\n        }\n\n        synchronized boolean tryAcquire(long now) {\n            tokens = Math.min(capacity, tokens + (now - lastRefill) * refillPerNano);\n            lastRefill = now;\n            lastSeen = now;\n            if (tokens >= 1) {\n                tokens -= 1;\n                return true;\n            }\n            return false;\n        }\n    }\n\n    private final ConcurrentHashMap<String, Bucket> buckets = new ConcurrentHashMap<>();\n    private final long capacity;\n    private final double refillPerSecond;\n\n    public PerKeyRateLimiter(long capacity, double refillPerSecond) {\n        this.capacity = capacity;\n        this.refillPerSecond = refillPerSecond;\n    }\n\n    public boolean allow(String clientKey) {\n        long now = System.nanoTime();\n        return buckets.computeIfAbsent(clientKey, k -> new Bucket(capacity, refillPerSecond, now)).tryAcquire(now);\n    }\n\n    /** Run from a scheduled task, for example once a minute. */\n    public void evictIdle(long idleNanos) {\n        long now = System.nanoTime();\n        buckets.values().removeIf(b -> now - b.lastSeen > idleNanos);\n    }\n\n    public int trackedClients() {\n        return buckets.size();\n    }\n}"
        }
      ],
      "pros": [
        "Isolates clients from each other",
        "Memory stays bounded"
      ],
      "cons": [
        "Keying by IP punishes users behind one NAT",
        "Local maps multiply the effective limit by the number of servers"
      ],
      "pickWhen": "You need per-client fairness. It is the structure around any of the algorithms above."
    }
  ],
  "recommendation": "Use a token bucket per client key (options 1 and 4) as the default, because it allows legitimate bursts and costs constant memory. Use a sliding window log for small, security-sensitive limits such as login or OTP attempts, where exactness matters.\n\nWhen you run several servers, keep the counters in Redis and make the check atomic, as in the Lua script, so the limit does not multiply with the server count. Return a clear rejection (HTTP 429 with a retry-after header) so well-behaved clients back off. Rate limiting protects you, but it does not replace authentication or abuse detection.",
  "say": "I would key the limit per client, using user id or API key rather than only IP, and use a token bucket so normal bursts pass but the long-run rate is capped. For sensitive endpoints like OTP or login I would use a sliding window with a small exact limit. With multiple servers the counters live in Redis with an atomic increment and expiry, otherwise the limit multiplies by the server count. Rejections return 429 with a retry-after so clients can back off.",
  "appearsIn": [
    "notification-system",
    "otp-generation-system",
    "chat-application",
    "social-network",
    "online-auction-system"
  ],
  "related": [
    "retry-storm",
    "hot-key-contention",
    "strategy",
    "atomic-operations-cas"
  ]
},
{
  "id": "expiry-at-scale",
  "prompt": "Every hold, OTP and session must expire after its TTL. You have ten million live items. How do you expire them on time without a thread or a timer per item?",
  "context": "The simple answer, schedule a task per item, works for a thousand items. At ten million, each pending task costs memory, and the scheduler's data structure becomes a bottleneck. Meanwhile the business needs an expired seat hold released and an expired OTP rejected, ideally promptly.\n\nThe interviewer wants to separate two requirements: an expired item must never be treated as valid, and an expired item should eventually be cleaned up.",
  "whyHard": "Correctness and cleanup are different jobs. Correctness can be done lazily by checking the deadline on every read, which is free. Cleanup needs some mechanism to find items that are due without scanning everything. The mechanisms differ in memory per item, precision and how much work each tick does.",
  "options": [
    {
      "name": "One timer per item",
      "concept": "Per-item scheduled tasks",
      "conceptIds": [
        "reservation-with-ttl"
      ],
      "how": "When an item is created, schedule a task that fires after its TTL. If the item is cancelled early, such as a seat hold that was paid for, cancel the task. It is the easiest model to reason about and fires almost exactly on time.",
      "code": [
        {
          "file": "PerItemTimers.java",
          "body": "import java.util.Map;\nimport java.util.concurrent.ConcurrentHashMap;\nimport java.util.concurrent.Executors;\nimport java.util.concurrent.ScheduledExecutorService;\nimport java.util.concurrent.ScheduledFuture;\nimport java.util.concurrent.TimeUnit;\n\n/** One scheduled task per item. Precise and simple, but every pending item costs a task object in the scheduler. */\npublic class PerItemTimers<K> {\n    private final ScheduledExecutorService scheduler = Executors.newScheduledThreadPool(1);\n    private final Map<K, ScheduledFuture<?>> pending = new ConcurrentHashMap<>();\n\n    public void expireAfter(K key, long ttlMillis, Runnable onExpire) {\n        ScheduledFuture<?> task = scheduler.schedule(() -> {\n            pending.remove(key);\n            onExpire.run();\n        }, ttlMillis, TimeUnit.MILLISECONDS);\n        ScheduledFuture<?> replaced = pending.put(key, task);\n        if (replaced != null) replaced.cancel(false);\n    }\n\n    /** E.g. the payment arrived, so the hold must not expire. */\n    public boolean cancel(K key) {\n        ScheduledFuture<?> task = pending.remove(key);\n        return task != null && task.cancel(false);\n    }\n\n    public int pendingCount() {\n        return pending.size();\n    }\n\n    public void shutdown() {\n        scheduler.shutdownNow();\n    }\n}"
        }
      ],
      "pros": [
        "Precise and simple",
        "Cancellation is explicit"
      ],
      "cons": [
        "Every live item holds a task object in the scheduler",
        "A scheduler heap of millions of entries is slow",
        "Timers vanish on restart and must be rebuilt"
      ],
      "pickWhen": "A few thousand items at most, and on-time firing matters."
    },
    {
      "name": "Lazy check plus periodic sweep",
      "concept": "Lazy expiry on read plus a background sweeper",
      "conceptIds": [
        "reservation-with-ttl"
      ],
      "how": "Store the expiry time with each item. Every read checks it, so an expired item is invisible the instant it expires, with no scheduler involved. A background sweeper runs every few seconds and removes expired entries so memory is eventually reclaimed.",
      "code": [
        {
          "file": "ExpiringMap.java",
          "body": "import java.util.Map;\nimport java.util.concurrent.ConcurrentHashMap;\nimport java.util.function.LongSupplier;\n\n/** Lazy expiry on read plus a periodic sweep: no timer per item. */\npublic class ExpiringMap<K, V> {\n    private record Entry<V>(V value, long expiresAt) {}\n\n    private final Map<K, Entry<V>> map = new ConcurrentHashMap<>();\n    private final LongSupplier clockMillis;\n\n    public ExpiringMap(LongSupplier clockMillis) {\n        this.clockMillis = clockMillis;\n    }\n\n    public void put(K key, V value, long ttlMillis) {\n        map.put(key, new Entry<>(value, clockMillis.getAsLong() + ttlMillis));\n    }\n\n    /** An expired entry is invisible the moment its time passes, even before the sweeper has run. */\n    public V get(K key) {\n        Entry<V> entry = map.get(key);\n        if (entry == null) return null;\n        if (entry.expiresAt() <= clockMillis.getAsLong()) {\n            map.remove(key, entry);\n            return null;\n        }\n        return entry.value();\n    }\n\n    /** Reclaims memory for keys nobody reads. Schedule it, for example, every 30 seconds. */\n    public int sweep() {\n        long now = clockMillis.getAsLong();\n        int removed = 0;\n        for (Map.Entry<K, Entry<V>> e : map.entrySet()) {\n            if (e.getValue().expiresAt() <= now && map.remove(e.getKey(), e.getValue())) removed++;\n        }\n        return removed;\n    }\n\n    public int size() {\n        return map.size();\n    }\n}"
        }
      ],
      "pros": [
        "No timer per item",
        "Correct even if the sweeper is late",
        "Very little code"
      ],
      "cons": [
        "A full sweep is O(n) and gets expensive at ten million items",
        "Expiry side effects (releasing stock, sending a notification) happen only when the sweeper runs"
      ],
      "pickWhen": "Correctness matters more than prompt cleanup, or the sweeper can scan an index of only the expiring items."
    },
    {
      "name": "Delay queue",
      "concept": "Priority queue ordered by deadline (DelayQueue)",
      "conceptIds": [],
      "how": "Keep all pending expiries in a min-heap ordered by deadline. A single consumer thread blocks until the earliest deadline, handles it, and loops. There is one thread and one structure, regardless of how many items there are.",
      "code": [
        {
          "file": "DelayQueueExpirer.java",
          "body": "import java.util.concurrent.DelayQueue;\nimport java.util.concurrent.Delayed;\nimport java.util.concurrent.TimeUnit;\nimport java.util.function.Consumer;\n\n/** A heap ordered by deadline plus one consumer thread that sleeps until the next item is due. */\npublic class DelayQueueExpirer implements AutoCloseable {\n    private static final class Expiry implements Delayed {\n        final String key;\n        final long deadlineNanos;\n\n        Expiry(String key, long ttlMillis) {\n            this.key = key;\n            this.deadlineNanos = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(ttlMillis);\n        }\n\n        @Override\n        public long getDelay(TimeUnit unit) {\n            return unit.convert(deadlineNanos - System.nanoTime(), TimeUnit.NANOSECONDS);\n        }\n\n        @Override\n        public int compareTo(Delayed other) {\n            return Long.compare(getDelay(TimeUnit.NANOSECONDS), other.getDelay(TimeUnit.NANOSECONDS));\n        }\n    }\n\n    private final DelayQueue<Expiry> queue = new DelayQueue<>();\n    private final Thread consumer;\n\n    /** The callback must re-check that the key is still due: a rescheduled key leaves a stale entry behind. */\n    public DelayQueueExpirer(Consumer<String> onExpire) {\n        consumer = new Thread(() -> {\n            try {\n                while (!Thread.currentThread().isInterrupted()) onExpire.accept(queue.take().key);\n            } catch (InterruptedException e) {\n                Thread.currentThread().interrupt();\n            }\n        }, \"expirer\");\n        consumer.setDaemon(true);\n        consumer.start();\n    }\n\n    public void schedule(String key, long ttlMillis) {\n        queue.put(new Expiry(key, ttlMillis));\n    }\n\n    @Override\n    public void close() {\n        consumer.interrupt();\n    }\n}"
        }
      ],
      "pros": [
        "One thread, precise timing",
        "Only due items are touched"
      ],
      "cons": [
        "Heap operations are O(log n) with a lock, which is a bottleneck at very high rates",
        "Removing or rescheduling a key leaves a stale entry, so the callback must re-check",
        "Lost on restart unless rebuilt from storage"
      ],
      "pickWhen": "Hundreds of thousands of items and precise firing matters."
    },
    {
      "name": "Bucketed expiry",
      "concept": "Timing wheel style bucketing by expiry second",
      "conceptIds": [
        "reservation-with-ttl"
      ],
      "how": "Group keys by the second, or minute, at which they expire. Each tick drains only the buckets that are fully in the past, so the work per tick is proportional to the number of keys that expire, not to the number that exist. Precision is one bucket wide, and keys are never reported early.",
      "code": [
        {
          "file": "BucketedExpiry.java",
          "body": "import java.util.ArrayList;\nimport java.util.List;\nimport java.util.Map;\nimport java.util.Set;\nimport java.util.concurrent.ConcurrentHashMap;\nimport java.util.concurrent.ConcurrentSkipListMap;\n\n/** Groups keys by the second in which they expire. One tick touches only the buckets that are due. */\npublic class BucketedExpiry {\n    private static final long BUCKET_MILLIS = 1_000;\n\n    private final ConcurrentSkipListMap<Long, Set<String>> buckets = new ConcurrentSkipListMap<>();\n\n    public void schedule(String key, long expiresAtMillis) {\n        buckets.computeIfAbsent(expiresAtMillis / BUCKET_MILLIS, b -> ConcurrentHashMap.newKeySet()).add(key);\n    }\n\n    /**\n     * Call once per tick. Cost is proportional to the keys that expire, not to the keys that exist.\n     * Only fully elapsed buckets are drained, so a key is never reported early (it can be up to a second late).\n     */\n    public List<String> pollDue(long nowMillis) {\n        long lastDueBucket = nowMillis / BUCKET_MILLIS - 1;\n        List<String> due = new ArrayList<>();\n        Map.Entry<Long, Set<String>> first;\n        while ((first = buckets.firstEntry()) != null && first.getKey() <= lastDueBucket) {\n            if (buckets.remove(first.getKey(), first.getValue())) due.addAll(first.getValue());\n        }\n        return due;\n    }\n}"
        }
      ],
      "pros": [
        "Scales to millions of items",
        "Cheap insert and cheap tick",
        "Easy to persist per bucket"
      ],
      "cons": [
        "Keys can fire up to one bucket late",
        "A key added to a bucket that is being drained can be picked up on the next tick"
      ],
      "pickWhen": "Millions of items and per-second precision is enough."
    }
  ],
  "recommendation": "Do both jobs separately.\n\nFor correctness, always store the deadline and check it on read (option 2's lazy check). That makes an expired hold or OTP unusable the instant it expires, whatever else is running.\n\nFor cleanup and side effects, use bucketed expiry (option 4), or the store's own TTL if you have one, such as Redis `PEXPIRE` or a database TTL index. Reserve per-item timers (option 1) and delay queues (option 3) for small volumes.\n\nFinally, make the expiry action idempotent and re-check the item's state inside it, because the payment may arrive at the same instant the timer fires.",
  "say": "I would separate correctness from cleanup. Every read checks the stored deadline, so an expired hold is never honoured even if cleanup is late. For cleanup I would bucket items by their expiry second and drain only the buckets that are due each tick, or use the store's native TTL, so the work depends on what expires, not on how many items exist. The expiry action re-checks the item and is idempotent, because a late payment can race with the timer.",
  "appearsIn": [
    "otp-generation-system",
    "limited-stock-cart",
    "movie-ticket-booking",
    "concert-ticket-booking",
    "quick-commerce-delivery-app",
    "car-rental-system"
  ],
  "related": [
    "hold-expires-during-payment",
    "reservation-with-ttl",
    "rate-limit-abuse",
    "hot-key-contention"
  ]
}
);
