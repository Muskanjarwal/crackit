window.CONCURRENCY = window.CONCURRENCY || [];
window.CONCURRENCY.push(
{
  "id": "tic-tac-toe",
  "scenarios": [
    {
      "title": "The same player moves twice (check-then-act)",
      "race": "X has the turn. X's phone and X's laptop both send a move at the same time: (0,0) and (2,2). **T1** checks `nextToMove == X`: yes. **T2** checks `nextToMove == X`: still yes, because T1 has not flipped it yet. **T1** writes (0,0) and flips the turn to O. **T2** writes (2,2) and flips the turn to X. X has played twice in a row and O lost a turn.",
      "why": "The turn check, the cell check and the writes are separate steps. Each check is true when it runs, but by the time the write happens the world has changed. This is the classic check-then-act race.",
      "fix": "Make 'is it my turn, is the cell free, place the mark, pass the turn' one atomic step with a single lock around the whole move. The board is tiny and a move takes microseconds, so one coarse lock per game is the right trade-off. There is no point in locking per cell: the turn field couples every cell.\n\nUse one lock **per game**, never a global one, so different games never wait on each other.",
      "code": [
        {
          "file": "TicTacToeGame.java",
          "body": "import java.util.concurrent.locks.ReentrantLock;\n\npublic class TicTacToeGame {\n    public enum Mark { X, O }\n\n    private final Mark[][] board = new Mark[3][3];\n    private final ReentrantLock lock = new ReentrantLock();\n    private Mark nextToMove = Mark.X;\n\n    /** Returns true if the move was applied, false if it was rejected. */\n    public boolean play(Mark player, int row, int col) {\n        lock.lock();                                   // turn check + cell check + write = one atomic step\n        try {\n            if (player != nextToMove) return false;    // not your turn (or your other request already won)\n            if (board[row][col] != null) return false; // cell already taken\n            board[row][col] = player;\n            nextToMove = (player == Mark.X) ? Mark.O : Mark.X;\n            return true;\n        } finally {\n            lock.unlock();\n        }\n    }\n}"
        }
      ],
      "alternatives": [
        "`synchronized` on the play method: identical behaviour, less code, but you cannot use `tryLock` with a timeout.",
        "Single-threaded game actor or queue: every move for a game is posted to one thread. Prefer it when moves already arrive over a message bus.",
        "Not a good fit: `ConcurrentHashMap` or atomics on single cells. They protect one cell, not the rule 'it must be your turn'."
      ],
      "say": "A move is a check followed by a write, so I make the whole move one critical section. One lock per game keeps contention tiny, and I would not shard the lock by cell because the turn rule spans the whole board."
    },
    {
      "title": "Spectators and the win-checker see a half-applied move",
      "race": "X's move is being applied while a spectator's UI thread renders the board and a bot calls `winner()`. The writer has set the cell but not yet flipped the turn, or is halfway through updating a row/column counter. The reader sees X on the board with X still to move, or a winner computed from a board that never existed.",
      "why": "Readers share mutable state with the writer without any ordering guarantee. Taking a lock for every read would make the UI and bots contend with players for no benefit.",
      "fix": "Publish **immutable snapshots**. Each move builds a new `Board` (copy-on-write) and swaps it into a `volatile` field. Readers grab the reference and work on a complete, never-changing board with no locks. Only writers serialise.\n\nThis fits well because the board is 9 cells. For large boards use a persistent structure or send diffs, since copying becomes expensive.",
      "code": [
        {
          "file": "SnapshotGame.java",
          "body": "public class SnapshotGame {\n    public enum Mark { X, O }\n\n    /** Immutable: once built, nobody can change it, so readers never see a half-applied move. */\n    public static final class Board {\n        private static final int[][] LINES = {\n            {0,1,2},{3,4,5},{6,7,8},{0,3,6},{1,4,7},{2,5,8},{0,4,8},{2,4,6}\n        };\n        private final Mark[] cells;\n        private final Mark next;\n\n        private Board(Mark[] cells, Mark next) { this.cells = cells; this.next = next; }\n        static Board empty() { return new Board(new Mark[9], Mark.X); }\n\n        public Mark at(int row, int col) { return cells[row * 3 + col]; }\n        public Mark next() { return next; }\n\n        public Mark winner() {\n            for (int[] l : LINES) {\n                Mark m = cells[l[0]];\n                if (m != null && m == cells[l[1]] && m == cells[l[2]]) return m;\n            }\n            return null;\n        }\n\n        Board with(Mark player, int row, int col) {\n            Mark[] copy = cells.clone();               // copy-on-write\n            copy[row * 3 + col] = player;\n            return new Board(copy, player == Mark.X ? Mark.O : Mark.X);\n        }\n    }\n\n    private volatile Board current = Board.empty();    // volatile publish: readers always get a complete board\n\n    /** Readers (UI, spectators, bots) never need a lock. */\n    public Board snapshot() { return current; }\n\n    /** Only writers serialise. */\n    public synchronized boolean play(Mark player, int row, int col) {\n        Board b = current;\n        if (b.winner() != null || b.next() != player || b.at(row, col) != null) return false;\n        current = b.with(player, row, col);\n        return true;\n    }\n}"
        }
      ],
      "alternatives": [
        "Read/write lock: works, but readers still block while a move is applied and it is more code than a volatile reference.",
        "`CopyOnWriteArrayList` of moves: replay the move list to render. Good when you need a move history anyway."
      ],
      "say": "Players are the only writers, but everything else reads. I make the board immutable and publish it through a volatile reference, so reads are lock-free and can never observe a half-applied move."
    },
    {
      "title": "A retried request applies the same move twice",
      "race": "X taps (1,1) and the response is lost on a flaky network, so the client retries after a timeout. The first request was already applied and O has replied at (0,0). The retry reaches the server and is rejected as 'illegal move' because the cell is taken. The client cannot tell whether its own move went through or was simply wrong, so it shows an error for a move that actually succeeded. In games where a request is not naturally unique, such as a dice roll in Snake and Ladder, the same retry would be applied a second time.",
      "why": "The server cannot tell 'the same request again' from 'a new, wrong request'. Locks make each request safe individually, but they do not make requests idempotent.",
      "fix": "Add a version, the **move number**, to the API. The client sends the move number it believes it is playing. The server applies the move only if that matches its own count, and otherwise answers STALE, so the client refreshes and sees what really happened. This is optimistic locking applied to a game.\n\nThe check and the increment run in the same critical section as the move, so two requests carrying the same number cannot both pass.",
      "code": [
        {
          "file": "VersionedGame.java",
          "body": "public class VersionedGame {\n    public enum Mark { X, O }\n    public enum Result { APPLIED, STALE, ILLEGAL }\n\n    private final Mark[][] board = new Mark[3][3];\n    private Mark nextToMove = Mark.X;\n    private int moveNumber = 0;                         // how many moves have been applied\n\n    /**\n     * The client says which move number it believes it is playing.\n     * A retried or duplicated request carries an old number and is rejected instead of applied twice.\n     */\n    public synchronized Result play(Mark player, int row, int col, int expectedMoveNumber) {\n        if (expectedMoveNumber != moveNumber) return Result.STALE;\n        if (player != nextToMove || board[row][col] != null) return Result.ILLEGAL;\n        board[row][col] = player;\n        nextToMove = (player == Mark.X) ? Mark.O : Mark.X;\n        moveNumber++;\n        return Result.APPLIED;\n    }\n\n    public synchronized int moveNumber() { return moveNumber; }\n}"
        }
      ],
      "alternatives": [
        "Client-generated request id stored in a set: also idempotent, and the right choice for operations that have no natural version.",
        "ETag or `If-Match` header on an HTTP API: the same idea expressed at the protocol level."
      ],
      "say": "Locking protects the server from itself but not from duplicate requests. I give each move an expected move number, so a retry is recognised as stale and rejected deterministically."
    }
  ]
},
{
  "id": "snake-and-ladder",
  "scenarios": [
    {
      "title": "Two players roll at the same time",
      "race": "It is player A's turn. A rolls on one thread; B, impatient, taps roll on another. **T-A** reads `turn == 0`. **T-B** reads `turn == 0` as well if it runs before A advances the turn, or the check is made against a stale local copy. Both move, so B takes a turn it does not own and A's position or the turn counter is corrupted.",
      "why": "'Whose turn is it' and 'move and pass the turn' are two steps. Without mutual exclusion the turn pointer is a shared variable updated by check-then-act.",
      "fix": "Guard the roll with one lock per game: check turn ownership, roll, move, apply snake or ladder, then advance the turn, all inside it. Reject out-of-turn rolls instead of queuing them, because a queued roll would fire later when the user has already moved on.\n\nUse `ThreadLocalRandom` for the dice. It is thread-safe without contention, unlike a shared `Random` created per game.",
      "code": [
        {
          "file": "SnakeAndLadderGame.java",
          "body": "import java.util.List;\nimport java.util.Map;\nimport java.util.concurrent.ThreadLocalRandom;\nimport java.util.concurrent.locks.ReentrantLock;\n\npublic class SnakeAndLadderGame {\n    private static final int WIN_SQUARE = 100;\n\n    private final List<String> players;\n    private final int[] position;\n    private final Map<Integer, Integer> jumps;           // snake heads and ladder bottoms -> destination\n    private final ReentrantLock lock = new ReentrantLock();\n    private int turn = 0;\n\n    public SnakeAndLadderGame(List<String> players, Map<Integer, Integer> jumps) {\n        this.players = List.copyOf(players);\n        this.position = new int[players.size()];\n        this.jumps = Map.copyOf(jumps);\n    }\n\n    /** Returns the new square, or -1 if it is not this player's turn. */\n    public int roll(String player) {\n        lock.lock();                                     // \"is it my turn?\" and \"move + pass the turn\" must be one step\n        try {\n            int idx = players.indexOf(player);\n            if (idx != turn) return -1;\n            int dice = ThreadLocalRandom.current().nextInt(1, 7);\n            int target = position[idx] + dice;\n            if (target <= WIN_SQUARE) {\n                position[idx] = jumps.getOrDefault(target, target);\n            }\n            turn = (turn + 1) % players.size();\n            return position[idx];\n        } finally {\n            lock.unlock();\n        }\n    }\n}"
        }
      ],
      "alternatives": [
        "Single-threaded game loop (actor): all rolls for a game go through one queue. Simplest to reason about for online play.",
        "Do not use `AtomicInteger turn` alone: the move itself also has to be atomic with the turn change."
      ],
      "say": "The turn is shared state, so 'is it my turn then move and pass the turn' must be atomic. I use one lock per game and reject out-of-turn rolls immediately."
    },
    {
      "title": "The game ends twice: reach 100 and forfeit at once",
      "race": "Player A rolls onto square 100 on one thread. At the same moment B's connection drops and a timeout thread forfeits B, which would make A the winner. Both paths call `endGame`. The game is finished twice, the winner is announced twice, and A's win is added to the leaderboard twice.",
      "why": "Ending a game is a one-time state transition, but nothing stops two different code paths from triggering it.",
      "fix": "Model the lifecycle as a state machine and move from IN_PROGRESS to FINISHED with `compareAndSet`. Only the single thread that wins the CAS runs the side effects: set the winner, credit the leaderboard, publish the event. Everyone else gets `false` and does nothing.\n\nThe same trick works for any 'happens exactly once' action: refund, notification, badge.",
      "code": [
        {
          "file": "GameLifecycle.java",
          "body": "import java.util.concurrent.atomic.AtomicInteger;\nimport java.util.concurrent.atomic.AtomicReference;\n\npublic class GameLifecycle {\n    public enum State { IN_PROGRESS, FINISHED }\n\n    private final AtomicReference<State> state = new AtomicReference<>(State.IN_PROGRESS);\n    private volatile String winner;\n    private final AtomicInteger leaderboardWins = new AtomicInteger();\n\n    /**\n     * Called from \"player reached 100\" AND from \"opponent forfeited / session timed out\".\n     * Only the thread that wins the compareAndSet finishes the game and credits the leaderboard.\n     */\n    public boolean finish(String winningPlayer) {\n        if (!state.compareAndSet(State.IN_PROGRESS, State.FINISHED)) {\n            return false;                                // somebody else already finished it\n        }\n        winner = winningPlayer;\n        leaderboardWins.incrementAndGet();               // runs exactly once per game\n        return true;\n    }\n\n    public State state() { return state.get(); }\n    public String winner() { return winner; }\n    public int leaderboardWins() { return leaderboardWins.get(); }\n}"
        }
      ],
      "alternatives": [
        "`synchronized` finish method with an `if (finished) return` guard: equivalent and simpler to read.",
        "DB: `UPDATE game SET status='FINISHED' WHERE id=? AND status='IN_PROGRESS'` and treat 'rows updated = 1' as winning the race."
      ],
      "say": "Finishing is a one-shot transition, so I use a compare-and-set from IN_PROGRESS to FINISHED. Whoever wins it does the side effects exactly once; everyone else is a no-op."
    },
    {
      "title": "Someone joins while the game is starting",
      "race": "The host presses Start while a fourth player taps Join. The game thread is building the turn order from the player list while the join thread appends to it. The turn rotation either skips the new player, throws `ConcurrentModificationException`, or gives the new player an index that has no position slot.",
      "why": "The player list and the per-player position array are derived from each other, and one of them changes while the other is being read.",
      "fix": "Make **join and start mutually exclusive** and freeze the roster. `start()` flips a flag and returns an immutable copy of the players. After that, `join` is rejected and the game works only with the frozen list, so it never needs a lock to read it.\n\nWhen the rules change at a clear moment (lobby to started), prefer freezing over trying to make a live list safe.",
      "code": [
        {
          "file": "Lobby.java",
          "body": "import java.util.ArrayList;\nimport java.util.List;\n\npublic class Lobby {\n    private final List<String> players = new ArrayList<>();\n    private final int maxPlayers;\n    private boolean started = false;\n\n    public Lobby(int maxPlayers) { this.maxPlayers = maxPlayers; }\n\n    /** Join and start are mutually exclusive, so the turn order can never change mid-game. */\n    public synchronized boolean join(String player) {\n        if (started || players.size() >= maxPlayers || players.contains(player)) return false;\n        players.add(player);\n        return true;\n    }\n\n    /** After this returns, the player list is frozen and safe to read without a lock. */\n    public synchronized List<String> start() {\n        if (started || players.size() < 2) throw new IllegalStateException(\"cannot start\");\n        started = true;\n        return List.copyOf(players);\n    }\n}"
        }
      ],
      "alternatives": [
        "`CopyOnWriteArrayList`: safe to iterate, but the positions array would still go out of sync with it.",
        "Allow late joiners by design: then positions must live in a map keyed by player id and the turn queue must be a concurrent structure."
      ],
      "say": "Instead of making a live list thread-safe, I make join and start mutually exclusive and hand the game an immutable roster. After start, nothing about the players can change."
    }
  ]
},
{
  "id": "lru-cache",
  "scenarios": [
    {
      "title": "Concurrent get and put corrupt the order list",
      "race": "Thread 1 calls `get(a)`, which unlinks `a` from the doubly linked list and relinks it at the head. Thread 2 calls `put(z)` at the same moment and evicts the tail, which is next to `a`. Both rewrite `prev` and `next` pointers of the same nodes. The list ends up with a cycle or a lost node, and the map and list disagree about which keys exist.",
      "why": "In an LRU cache a **read is a write**: `get` changes recency order. Plain `HashMap` plus linked list is not thread-safe, and even `ConcurrentHashMap` does not help because the list is the problem.",
      "fix": "Protect map and list with a single lock, and take it for `get` too. A read/write lock does not help for exactly the reason above. Keep the critical section tiny: map lookup and pointer swaps only. Never call a loader or do IO while holding it.\n\nA single lock is the right first answer: it is correct and a cache hit takes tens of nanoseconds.",
      "code": [
        {
          "file": "LockedLruCache.java",
          "body": "import java.util.LinkedHashMap;\nimport java.util.Map;\nimport java.util.concurrent.locks.ReentrantLock;\n\npublic class LockedLruCache<K, V> {\n    private final int capacity;\n    private final ReentrantLock lock = new ReentrantLock();\n    // accessOrder = true: every get() moves the entry to the tail, so get() is a WRITE to the list\n    private final LinkedHashMap<K, V> map;\n\n    public LockedLruCache(int capacity) {\n        this.capacity = capacity;\n        this.map = new LinkedHashMap<>(16, 0.75f, true) {\n            @Override protected boolean removeEldestEntry(Map.Entry<K, V> eldest) {\n                return size() > LockedLruCache.this.capacity;\n            }\n        };\n    }\n\n    public V get(K key) {\n        lock.lock();                       // a read/write lock would NOT help: get() reorders the list\n        try {\n            return map.get(key);\n        } finally {\n            lock.unlock();\n        }\n    }\n\n    public void put(K key, V value) {\n        lock.lock();\n        try {\n            map.put(key, value);           // insert + evict-eldest happen under the same lock\n        } finally {\n            lock.unlock();\n        }\n    }\n}"
        }
      ],
      "alternatives": [
        "`Collections.synchronizedMap(new LinkedHashMap(..., true))`: the same idea in one line, but compound operations still need external locking.",
        "Approximate LRU with a concurrent map and a buffered recency queue (what Caffeine does): choose it when the single lock becomes the bottleneck."
      ],
      "say": "In an LRU cache a get mutates the recency list, so a read/write lock does not apply. I use one lock around the map and the list, keep the critical section tiny, and only shard it if profiling shows contention."
    },
    {
      "title": "Cache stampede: 500 threads miss the same hot key",
      "race": "A popular key expires. 500 request threads call `get(key)` in the same millisecond. All 500 see a miss, and all 500 call the database to load the same row. The database spikes and each thread then writes back the same value.",
      "why": "'Miss then load then put' is another check-then-act. A lock around the whole cache would serialise unrelated keys behind one slow load.",
      "fix": "**Single-flight per key.** The first thread to miss registers a `CompletableFuture` in an `inFlight` map with `putIfAbsent`. Later threads for the same key find that future and wait on it. Only one load happens, and failures propagate to the waiters instead of leaving them hanging. Other keys proceed untouched.\n\nThis does not hold any global lock while loading, which is the property you want for slow IO.",
      "code": [
        {
          "file": "SingleFlightLoader.java",
          "body": "import java.util.Map;\nimport java.util.concurrent.CompletableFuture;\nimport java.util.concurrent.ConcurrentHashMap;\nimport java.util.function.Function;\n\n/** Wraps any thread-safe cache so a hot key is loaded from the database once, not once per waiting thread. */\npublic class SingleFlightLoader<K, V> {\n    private final Map<K, V> cache;                                   // any thread-safe cache\n    private final Function<K, V> loader;                             // the slow call (DB, network)\n    private final ConcurrentHashMap<K, CompletableFuture<V>> inFlight = new ConcurrentHashMap<>();\n\n    public SingleFlightLoader(Map<K, V> cache, Function<K, V> loader) {\n        this.cache = cache;\n        this.loader = loader;\n    }\n\n    public V get(K key) {\n        V hit = cache.get(key);\n        if (hit != null) return hit;\n\n        CompletableFuture<V> mine = new CompletableFuture<>();\n        CompletableFuture<V> existing = inFlight.putIfAbsent(key, mine);\n        if (existing != null) {\n            return existing.join();                                  // another thread is already loading: wait for it\n        }\n        try {\n            V value = loader.apply(key);                             // only ONE thread per key gets here\n            cache.put(key, value);\n            mine.complete(value);\n            return value;\n        } catch (RuntimeException e) {\n            mine.completeExceptionally(e);                           // waiters fail fast instead of hanging\n            throw e;\n        } finally {\n            inFlight.remove(key, mine);\n        }\n    }\n}"
        }
      ],
      "alternatives": [
        "`ConcurrentHashMap.computeIfAbsent(key, loader)`: very short, but the loader runs inside the map's bin lock, so keep it fast and never touch the same map from it.",
        "Add a random jitter to TTLs so hot keys do not all expire together."
      ],
      "say": "On a miss I register an in-flight future with putIfAbsent. Only the first thread loads; the rest wait on that future. One database call per key, and unrelated keys never block."
    },
    {
      "title": "One big lock becomes the bottleneck",
      "race": "With 64 cores and 95% hits, every `get` takes the same lock. Threads spend their time queued behind each other even though they touch completely different keys, so throughput flatlines and tail latency grows.",
      "why": "Correctness is fine; the lock **granularity** is too coarse. Recency order only needs to be consistent within one partition of the keys.",
      "fix": "**Shard the cache.** Hash each key to one of N independent LRU shards, each with its own lock and its own capacity. Threads touching different shards never contend. The trade-off is that eviction becomes approximate across shards, since each shard only evicts its own least recently used entry. That is acceptable for a cache.\n\nPick the shard count from the number of cores (a small multiple), and mask the sign bit before the modulo so a negative `hashCode` cannot produce a negative index.",
      "code": [
        {
          "file": "ShardedLruCache.java",
          "body": "import java.util.ArrayList;\nimport java.util.LinkedHashMap;\nimport java.util.List;\nimport java.util.Map;\n\n/** N independent LRU shards: threads touching different shards never contend. */\npublic class ShardedLruCache<K, V> {\n    private static final class Shard<K, V> {\n        private final LinkedHashMap<K, V> map;\n        Shard(int capacity) {\n            this.map = new LinkedHashMap<>(16, 0.75f, true) {\n                @Override protected boolean removeEldestEntry(Map.Entry<K, V> eldest) {\n                    return size() > capacity;\n                }\n            };\n        }\n        synchronized V get(K key) { return map.get(key); }\n        synchronized void put(K key, V value) { map.put(key, value); }\n    }\n\n    private final List<Shard<K, V>> shards = new ArrayList<>();\n\n    public ShardedLruCache(int totalCapacity, int shardCount) {\n        int perShard = Math.max(1, totalCapacity / shardCount);\n        for (int i = 0; i < shardCount; i++) shards.add(new Shard<>(perShard));\n    }\n\n    private Shard<K, V> shardFor(K key) {\n        return shards.get((key.hashCode() & 0x7fffffff) % shards.size());\n    }\n\n    public V get(K key) { return shardFor(key).get(key); }\n    public void put(K key, V value) { shardFor(key).put(key, value); }\n}"
        }
      ],
      "alternatives": [
        "Striped locks over a single structure: harder, because the order list is shared.",
        "Caffeine-style buffers: best throughput, much more complex; mention it, do not build it in an interview."
      ],
      "say": "I start with one lock because it is correct. If contention shows up I shard by key hash: each shard is an independent LRU with its own lock, which trades exact global recency for throughput."
    }
  ]
},
{
  "id": "parking-lot",
  "scenarios": [
    {
      "title": "Two cars take the last spot",
      "race": "One small spot is free. **Gate A** scans and finds spot 12 free. **Gate B** scans and finds spot 12 free. Gate A marks it occupied by KA-01. Gate B marks it occupied by KA-02, overwriting. Two tickets are issued for one spot.",
      "why": "'Find a free spot' and 'mark it occupied' are separate steps. Between them another gate can claim the same spot.",
      "fix": "Make claiming a spot one atomic operation: `compareAndSet(null, plate)` on the spot's occupant. Exactly one caller can succeed. The loser simply moves on to the next candidate spot, so there is no lock to hold and no waiting.\n\nThe same shape works in a database: `UPDATE spot SET occupant=? WHERE id=? AND occupant IS NULL` and check that one row changed.",
      "code": [
        {
          "file": "ParkingAllocator.java",
          "body": "import java.util.List;\nimport java.util.Optional;\nimport java.util.concurrent.atomic.AtomicReference;\n\npublic class ParkingAllocator {\n    public enum Size { SMALL, LARGE }\n\n    public static final class Spot {\n        final int id;\n        final Size size;\n        private final AtomicReference<String> occupant = new AtomicReference<>(null);   // null = free\n\n        Spot(int id, Size size) { this.id = id; this.size = size; }\n\n        /** Atomic \"if free then take\": exactly one caller can ever succeed. */\n        boolean tryPark(String plate) { return occupant.compareAndSet(null, plate); }\n        void release(String plate)    { occupant.compareAndSet(plate, null); }\n    }\n\n    private final List<Spot> spots;\n\n    public ParkingAllocator(List<Spot> spots) { this.spots = spots; }\n\n    public Optional<Spot> park(String plate, Size needed) {\n        for (Spot s : spots) {\n            if (s.size == needed && s.tryPark(plate)) {   // losing the race just moves on to the next spot\n                return Optional.of(s);\n            }\n        }\n        return Optional.empty();                          // lot is genuinely full\n    }\n}"
        }
      ],
      "alternatives": [
        "Lock the whole floor while allocating: simple, but entry gates queue behind each other. Fine for a small lot.",
        "Per-spot `synchronized`: correct too, but compare-and-set expresses 'take it if free' directly.",
        "Pre-assign spots from a concurrent queue of free spots (`ConcurrentLinkedQueue.poll()`): no scan at all, and the queue hands out each spot once."
      ],
      "say": "Finding and taking a spot has to be one atomic step, so each spot has an atomic occupant and I claim it with compareAndSet. Losing a race just means trying the next spot, with no locks and no double-booking."
    },
    {
      "title": "Double tap at the exit gate charges twice",
      "race": "The driver scans the ticket and the gate is slow, so they scan it again. Two exit requests for ticket T1 run together. Both compute the fee, both call the payment service, and both free the spot, so the spot count goes up twice and the customer is charged twice.",
      "why": "Exit is a multi-step action with side effects (charge, free spot), and nothing records that it already happened.",
      "fix": "Make the exit **idempotent**. `computeIfAbsent(ticketId, ...)` runs the charge-and-free lambda at most once per ticket, and every other caller blocks briefly and receives the same receipt. The ticket id is the idempotency key.\n\nLimit what runs inside the lambda. If the payment call can be slow, call your payment provider with the ticket id as an idempotency key and keep the lambda to cheap work, or store an `EXITING` state and let waiters poll.",
      "code": [
        {
          "file": "ExitService.java",
          "body": "import java.util.concurrent.ConcurrentHashMap;\nimport java.util.function.Function;\n\npublic class ExitService {\n    public record Receipt(String ticketId, long amount) {}\n\n    private final ConcurrentHashMap<String, Receipt> receipts = new ConcurrentHashMap<>();\n    private final Function<String, Long> pricing;          // ticketId -> fee\n    private final Runnable freeSpot;                       // releases the spot\n\n    public ExitService(Function<String, Long> pricing, Runnable freeSpot) {\n        this.pricing = pricing;\n        this.freeSpot = freeSpot;\n    }\n\n    /**\n     * Idempotent: a double-tap at the exit gate, or a client retry, returns the SAME receipt.\n     * computeIfAbsent runs the lambda at most once per ticket; concurrent callers wait and reuse the result.\n     */\n    public Receipt exit(String ticketId) {\n        return receipts.computeIfAbsent(ticketId, id -> {\n            long fee = pricing.apply(id);                  // charge once\n            freeSpot.run();                                // free the spot once\n            return new Receipt(id, fee);\n        });\n    }\n}"
        }
      ],
      "alternatives": [
        "Ticket state machine with CAS: ACTIVE to EXITING, then PAID and CLOSED. Better when payment can fail and must be retried.",
        "DB unique constraint on (ticket_id) in the payments table: the database refuses the second charge."
      ],
      "say": "Exit has side effects, so I make it idempotent keyed on the ticket id. Concurrent or retried requests return the same receipt, and the fee and the spot release happen exactly once."
    },
    {
      "title": "The 'spots left' counter drifts or the lot overfills",
      "race": "The lot has 1 space left. Three entry gates each read `available = 1`, decide to admit, and all decrement. The display now shows -2, and a counter incremented separately from the real occupancy slowly disagrees with it.",
      "why": "A separate counter is a second copy of the truth, updated by read-modify-write without coordination.",
      "fix": "Use a **Semaphore** whose permits are the free spots. `tryAcquire()` is atomic, so the last permit goes to exactly one car and everyone else is rejected immediately. If the spot allocation then fails (for example no spot of the right size), hand the permit back. The display reads `availablePermits()`, so it is derived and can never go negative.\n\nIt fits well because the capacity check is a pure counting problem.",
      "code": [
        {
          "file": "EntryGate.java",
          "body": "import java.util.Optional;\nimport java.util.concurrent.Semaphore;\nimport java.util.function.Supplier;\n\npublic class EntryGate {\n    private final Semaphore freeSlots;                      // one permit per free spot in the lot\n\n    public EntryGate(int capacity) { this.freeSlots = new Semaphore(capacity); }\n\n    /** All entry gates share this: the last permit can only be taken by one car. */\n    public <T> Optional<T> admit(Supplier<Optional<T>> allocateSpot) {\n        if (!freeSlots.tryAcquire()) return Optional.empty();   // lot full: reject immediately, no waiting\n        Optional<T> spot = allocateSpot.get();\n        if (spot.isEmpty()) freeSlots.release();                // e.g. no spot of the right size: hand the permit back\n        return spot;\n    }\n\n    public void onExit() { freeSlots.release(); }\n\n    /** The \"spots left\" display is derived from the permits, so it cannot drift or go negative. */\n    public int available() { return freeSlots.availablePermits(); }\n}"
        }
      ],
      "alternatives": [
        "`AtomicInteger` with a CAS loop that only decrements when greater than zero: same effect, more code to get right.",
        "Per-size semaphores when small and large spots are separate pools."
      ],
      "say": "Free capacity is a counting problem, so I use a semaphore. tryAcquire is atomic, so the last permit goes to one car, and the display is derived from it rather than being a second counter that can drift."
    }
  ]
},
{
  "id": "task-management-system",
  "scenarios": [
    {
      "title": "Two people claim the same unassigned task",
      "race": "Task 42 is unassigned. Asha and Ravi both click 'Assign to me'. Both requests read `assignee == null`, both write their own name, and the last write wins. Ravi starts working on a task that the UI told Asha she owned.",
      "why": "Check-then-act on the assignee field. Both writers were allowed by a check that was true when it ran.",
      "fix": "Claim with an atomic conditional write: `compareAndSet(null, user)`. The loser gets `false` and the UI says 'already assigned to Asha'. Reassignment by a manager names the person it expects to take the task from, so two managers cannot silently overwrite each other either.\n\nDB version: `UPDATE task SET assignee=? WHERE id=? AND assignee IS NULL` and check the number of rows changed.",
      "code": [
        {
          "file": "Task.java",
          "body": "import java.util.concurrent.atomic.AtomicReference;\n\npublic class Task {\n    public final long id;\n    private final AtomicReference<String> assignee = new AtomicReference<>(null);\n\n    public Task(long id) { this.id = id; }\n\n    /** Atomic \"assign only if nobody has it yet\": the second claimer gets false and can show \"already taken\". */\n    public boolean claim(String user) {\n        return assignee.compareAndSet(null, user);\n    }\n\n    /** Reassignment must name who it expects to take it from, so two managers cannot overwrite each other. */\n    public boolean reassign(String from, String to) {\n        return assignee.compareAndSet(from, to);\n    }\n\n    public String assignee() { return assignee.get(); }\n}"
        }
      ],
      "alternatives": [
        "Pessimistic row lock (`SELECT ... FOR UPDATE`): fine, but holds a lock for the whole transaction.",
        "Version column on the task row (see the next scenario) for edits that touch many fields."
      ],
      "say": "Assignment is check-then-act, so I make it one conditional write: set the assignee only if it is still empty. The loser gets a clear 'already taken' result instead of a silent overwrite."
    },
    {
      "title": "Lost update: two people edit the same task",
      "race": "Asha opens task 42 (title T, description D, version 0). Ravi opens the same task. Asha changes the title and saves. Ravi changes the description and saves. Ravi's save sends the whole task, including the **old title**, so Asha's edit disappears without any error.",
      "why": "Both writers read the same snapshot and wrote it back. Last write wins, and the earlier edit is lost.",
      "fix": "**Optimistic locking with a version.** Every save carries the version the user loaded. The store applies the update only if that version is still current and bumps it. The second saver gets a `ConflictException`, reloads, and merges or retries. Nobody waits and nothing is locked while a user thinks.\n\nIt fits because conflicts are rare in task editing and the 'transaction' spans human think time, which you never want to hold a lock across.",
      "code": [
        {
          "file": "TaskStore.java",
          "body": "import java.util.concurrent.ConcurrentHashMap;\n\npublic class TaskStore {\n    public record TaskRecord(long id, String title, String description, int version) {}\n\n    public static class ConflictException extends RuntimeException {\n        public ConflictException(String msg) { super(msg); }\n    }\n\n    private final ConcurrentHashMap<Long, TaskRecord> tasks = new ConcurrentHashMap<>();\n\n    public void create(long id, String title, String description) {\n        tasks.put(id, new TaskRecord(id, title, description, 0));\n    }\n\n    public TaskRecord get(long id) { return tasks.get(id); }\n\n    /**\n     * Optimistic locking: the caller sends the version it read.\n     * SQL equivalent:  UPDATE task SET title=?, description=?, version=version+1 WHERE id=? AND version=?\n     */\n    public TaskRecord update(long id, int expectedVersion, String title, String description) {\n        return tasks.compute(id, (k, current) -> {\n            if (current == null) throw new IllegalArgumentException(\"no such task\");\n            if (current.version() != expectedVersion) {\n                throw new ConflictException(\"task changed since you loaded it (v\" + current.version() + \")\");\n            }\n            return new TaskRecord(id, title, description, current.version() + 1);\n        });\n    }\n}"
        }
      ],
      "alternatives": [
        "Pessimistic lock while editing: only when conflicts are frequent and costly, and you need lock timeouts so an abandoned tab does not hold it forever.",
        "Patch-style updates (send only changed fields): reduces conflicts but does not remove them if both edit the same field."
      ],
      "say": "Editing spans human think time, so I do not hold a lock. I use optimistic locking: each save carries the version it loaded. If it has moved on I reject with a conflict so the user can reload and merge."
    },
    {
      "title": "Illegal status jumps when two people change status at once",
      "race": "A task is IN_REVIEW. Ravi moves it to DONE. At the same moment Asha moves it back to IN_PROGRESS. Each request validates against the state it read, IN_REVIEW, and both are legal from there. Whichever writes last wins, and the audit trail shows a DONE that was never really final.",
      "why": "Validation and the write are separated, so the rule 'DONE is final' is checked against a stale state.",
      "fix": "Keep the allowed transitions in a table and apply them with a **CAS loop**: read the current status, validate the move from *that* state, and `compareAndSet(from, to)`. If another thread changed the status in between, the CAS fails and the loop re-reads and re-validates. After DONE, the second request now sees DONE and is rejected as illegal.\n\nThe transition table is also the single place to extend when product adds a new status.",
      "code": [
        {
          "file": "WorkflowTask.java",
          "body": "import java.util.EnumMap;\nimport java.util.EnumSet;\nimport java.util.Map;\nimport java.util.Set;\nimport java.util.concurrent.atomic.AtomicReference;\n\npublic class WorkflowTask {\n    public enum Status { TODO, IN_PROGRESS, IN_REVIEW, DONE }\n\n    private static final Map<Status, Set<Status>> ALLOWED = new EnumMap<>(Status.class);\n    static {\n        ALLOWED.put(Status.TODO,        EnumSet.of(Status.IN_PROGRESS));\n        ALLOWED.put(Status.IN_PROGRESS, EnumSet.of(Status.TODO, Status.IN_REVIEW));\n        ALLOWED.put(Status.IN_REVIEW,   EnumSet.of(Status.IN_PROGRESS, Status.DONE));\n        ALLOWED.put(Status.DONE,        EnumSet.noneOf(Status.class));\n    }\n\n    private final AtomicReference<Status> status = new AtomicReference<>(Status.TODO);\n\n    /** Validate against the state we actually observed, then swap only if it is still that state. */\n    public boolean transition(Status to) {\n        while (true) {\n            Status from = status.get();\n            if (!ALLOWED.get(from).contains(to)) return false;      // illegal from the CURRENT state\n            if (status.compareAndSet(from, to)) return true;        // nobody changed it in between\n            // lost the race: loop, re-read the new state and re-validate\n        }\n    }\n\n    public Status status() { return status.get(); }\n}"
        }
      ],
      "alternatives": [
        "`synchronized` transition method: simpler, fine when a task is rarely contended.",
        "DB: `UPDATE task SET status=:to WHERE id=:id AND status=:from`, retrying on zero rows."
      ],
      "say": "A status change is validated against the current status, so the validation and the write must be atomic. I loop on compareAndSet: read, validate, swap, and if someone changed it in between I re-read and validate again."
    }
  ]
},
{
  "id": "stack-overflow",
  "scenarios": [
    {
      "title": "Duplicate votes from double clicks and two tabs",
      "race": "A user double-clicks the upvote arrow, or has the question open in two tabs. Both requests check 'has this user voted on this post?' and see no. Both insert a vote and both add +1 to the score. One person has voted twice.",
      "why": "'Check for existing vote' then 'insert vote' is check-then-act, and the score update is a separate read-modify-write.",
      "fix": "Key each vote by (user, post) and update it **atomically**. `compute` is atomic per key, so one user's requests are serialised, and the score delta is computed from the vote actually stored: +1 for a new upvote, +2 for flipping down to up, 0 for a duplicate. Different users voting on the same post only contend on a single atomic counter.\n\nIn SQL: a `UNIQUE(user_id, post_id)` constraint plus an upsert makes the database the referee, and `score = score + delta` is one statement.",
      "code": [
        {
          "file": "VoteService.java",
          "body": "import java.util.concurrent.ConcurrentHashMap;\nimport java.util.concurrent.atomic.AtomicInteger;\n\npublic class VoteService {\n    private final ConcurrentHashMap<String, Integer> votes = new ConcurrentHashMap<>();   // \"user:post\" -> +1 / -1\n    private final ConcurrentHashMap<Long, AtomicInteger> score = new ConcurrentHashMap<>();\n\n    /**\n     * direction is +1 (upvote) or -1 (downvote). Calling it twice with the same direction is a no-op.\n     * compute() is atomic per key, so one user's double-click or two open tabs are serialised,\n     * and the score delta is always computed from the vote that was really stored.\n     * DB equivalent: UNIQUE(user_id, post_id) + upsert, then score = score + delta in one statement.\n     */\n    public int vote(long userId, long postId, int direction) {\n        String key = userId + \":\" + postId;\n        AtomicInteger postScore = score.computeIfAbsent(postId, id -> new AtomicInteger());\n        votes.compute(key, (k, previous) -> {\n            int prev = (previous == null) ? 0 : previous;\n            int delta = direction - prev;                  // +1 new upvote, +2 flipped from down to up, 0 duplicate\n            if (delta != 0) postScore.addAndGet(delta);\n            return direction;\n        });\n        return postScore.get();\n    }\n\n    public int score(long postId) {\n        AtomicInteger s = score.get(postId);\n        return s == null ? 0 : s.get();\n    }\n}"
        }
      ],
      "alternatives": [
        "Client-side disabling of the button: good UX, never a guarantee.",
        "Derive the score by counting votes: always correct, but slow for hot posts; use a cached counter and reconcile periodically."
      ],
      "say": "The unique key on user and post is the real guard. I update the vote atomically and derive the score change from the vote that was actually stored, so double clicks and retries are no-ops."
    },
    {
      "title": "Two answers accepted at the same time",
      "race": "The asker clicks Accept on answer 5, then changes their mind and clicks answer 8 on a second tab. If acceptance is a boolean on each answer, both requests set their own flag true, and the question ends up with two accepted answers and the reputation bonus awarded twice.",
      "why": "'At most one accepted answer' is an invariant across rows, but each request only updates its own row.",
      "fix": "Store acceptance in **one field on the question**, so the invariant holds by construction, and swap it atomically with `getAndSet`. The returned previous value is seen by exactly one caller, so the +15 is taken from the old author once and given to the new author once. A duplicate click returns early.\n\nAlways prefer a data model where invalid states cannot be represented over one that needs a lock to stay valid.",
      "code": [
        {
          "file": "AcceptedAnswer.java",
          "body": "import java.util.Map;\nimport java.util.concurrent.atomic.AtomicLong;\n\npublic class AcceptedAnswer {\n    public interface Reputation { void add(long userId, int delta); }\n\n    private static final long NONE = 0L;\n    private static final int ACCEPT_BONUS = 15;\n\n    private final long questionAuthorId;\n    private final Map<Long, Long> answerAuthor;                         // answerId -> authorId\n    private final Reputation reputation;\n    private final AtomicLong acceptedAnswerId = new AtomicLong(NONE);   // ONE field, so \"at most one accepted\" is structural\n\n    public AcceptedAnswer(long questionAuthorId, Map<Long, Long> answerAuthor, Reputation reputation) {\n        this.questionAuthorId = questionAuthorId;\n        this.answerAuthor = answerAuthor;\n        this.reputation = reputation;\n    }\n\n    public boolean accept(long callerId, long newAnswerId) {\n        if (callerId != questionAuthorId) return false;                  // only the asker can accept\n        long previous = acceptedAnswerId.getAndSet(newAnswerId);         // atomic swap: each previous value is seen by exactly one caller\n        if (previous == newAnswerId) return false;                       // duplicate click or retry\n        if (previous != NONE) reputation.add(answerAuthor.get(previous), -ACCEPT_BONUS);\n        reputation.add(answerAuthor.get(newAnswerId), +ACCEPT_BONUS);\n        return true;\n    }\n\n    public long accepted() { return acceptedAnswerId.get(); }\n}"
        }
      ],
      "alternatives": [
        "Keep a boolean per answer, but change both rows in a single DB transaction with `SELECT ... FOR UPDATE` on the question row.",
        "Unique partial index on `answers(question_id) WHERE accepted`: the database rejects a second accepted answer."
      ],
      "say": "The rule is at most one accepted answer, so I store it as a single field on the question and swap it atomically. getAndSet tells me the previous answer, so reputation moves exactly once."
    },
    {
      "title": "Reputation updates are lost under load",
      "race": "A popular answer gets 50 upvotes within a second. Each event does `rep = rep + 10` as read, add, write. Two threads read 100 and both write 110, so ten reputation points vanish. Under load the user's total is permanently wrong.",
      "why": "A read-modify-write on shared state is not atomic, and the reputation floor (never below 1) makes it a conditional update too.",
      "fix": "Do the whole update in one atomic operation. In memory, `ConcurrentHashMap.merge` applies the add and the floor under the key's lock. In SQL, `UPDATE users SET reputation = GREATEST(1, reputation + :delta) WHERE id = :id` lets the database apply it row by row. The caller never reads the value first.\n\nThis fits better than a lock because the operation is a single arithmetic step.",
      "code": [
        {
          "file": "ReputationBook.java",
          "body": "import java.util.concurrent.ConcurrentHashMap;\n\npublic class ReputationBook {\n    private static final int FLOOR = 1;                      // reputation never drops below 1\n\n    private final ConcurrentHashMap<Long, Integer> reputation = new ConcurrentHashMap<>();\n\n    /**\n     * Read-modify-write on a Map<Long,Integer> (get, add, put) loses updates when two events arrive together.\n     * merge() does the whole read-modify-write atomically for that key, and the floor is applied inside it.\n     * DB equivalent: UPDATE users SET reputation = GREATEST(1, reputation + ?) WHERE id = ?\n     */\n    public int add(long userId, int delta) {\n        return reputation.merge(userId, Math.max(FLOOR, FLOOR + delta), (old, ignored) -> Math.max(FLOOR, old + delta));\n    }\n\n    public int get(long userId) { return reputation.getOrDefault(userId, FLOOR); }\n}"
        }
      ],
      "alternatives": [
        "`LongAdder` per user: higher throughput under heavy write contention, but it cannot enforce a floor.",
        "Append-only reputation events with a periodic sum: no lost updates and a full audit trail, at the cost of read complexity."
      ],
      "say": "Reputation changes are arithmetic, so I push the whole read-modify-write down into one atomic operation: merge in memory, or a single UPDATE with the floor applied in SQL. I never read, add and write back."
    }
  ]
}
);
