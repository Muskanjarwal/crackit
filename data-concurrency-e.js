window.CONCURRENCY = window.CONCURRENCY || [];
window.CONCURRENCY.push(
  {
    "id": "chess-game",
    "scenarios": [
      {
        "title": "Both players move at the same moment",
        "race": "White and Black are connected over WebSockets. White's client sends e2-e4 (move 0). Because of a laggy connection, Black's client, which still thinks it is Black's turn after a stale board refresh, sends e7-e5 at the same instant. Thread A reads `turn = WHITE`, thread B reads `turn = WHITE` too (it hasn't been flipped yet) and passes a naive check-then-update `if (player == turn)`. Both threads apply a move and the board now contains two moves for one turn.",
        "why": "Reading whose turn it is and flipping the turn are two separate steps, so this is a classic **check-then-act** race. The board, the turn and the move counter must change together as one unit, and a move built from an old board must never be applied to a newer one.",
        "fix": "Give each `Game` its own lock and do the whole move (turn check, staleness check, validation, apply, flip turn) inside it. Add an `expectedMoveNumber` that the client sends with every move; if it no longer matches, reject with a stale-move error and let the client resync. Locking per game (not globally) means thousands of games run in parallel and only the two players of one game ever contend.\n\nA lock is enough here because a game is a tiny, in-memory critical section and one game is owned by one server. If the game state lives in a database instead, the same idea becomes a conditional update on a version column.",
        "code": [
          {
            "file": "ChessGame.java",
            "body": "import java.util.concurrent.locks.ReentrantLock;\n\npublic class ChessGame {\n    public enum Color { WHITE, BLACK }\n\n    public record Move(String from, String to) {}\n\n    public static class StaleMoveException extends RuntimeException {\n        public StaleMoveException(String message) { super(message); }\n    }\n\n    private final ReentrantLock lock = new ReentrantLock();\n    private Color turn = Color.WHITE;\n    private int moveNumber = 0;\n\n    /** expectedMoveNumber is the move count the client saw when it built this move. */\n    public int makeMove(Color player, Move move, int expectedMoveNumber) {\n        lock.lock();\n        try {\n            if (player != turn) {\n                throw new IllegalStateException(\"Not your turn\");\n            }\n            if (expectedMoveNumber != moveNumber) {\n                throw new StaleMoveException(\"Board has moved on, now at move \" + moveNumber);\n            }\n            // validate the move against the board here, then apply it\n            moveNumber++;\n            turn = (turn == Color.WHITE) ? Color.BLACK : Color.WHITE;\n            return moveNumber;\n        } finally {\n            lock.unlock();\n        }\n    }\n}"
          }
        ],
        "alternatives": [
          "Optimistic version in the database: `UPDATE game SET move_no = move_no + 1, turn = ? WHERE id = ? AND move_no = ?` and treat 0 rows updated as a stale move.",
          "Single-writer actor per game: route every command for a game through one thread or queue, so no lock is needed at all.",
          "A global lock would also be correct but serialises every game on the server, which is the wrong granularity."
        ],
        "say": "A move is a check-then-act on shared state, so I put the turn check and the update under one per-game lock and also send the move number the client saw. That makes stale or out-of-turn moves fail cleanly instead of corrupting the board, and games never block each other."
      },
      {
        "title": "The same move submitted twice (retry or double click)",
        "race": "White drags a piece and the request times out on the client. The client retries the same move. Both requests actually reached the server: the first applied e2-e4, and the retry arrives while it is Black's turn. Depending on timing it is either rejected as 'not your turn' (confusing, the user thinks the move failed) or, worse, interpreted as a different legal move for the new position.",
        "why": "The network is at-least-once: clients retry when they don't get an answer. Without a way to recognise a duplicate, a retry is indistinguishable from a brand-new request, so the server can apply one logical action twice or report a false failure.",
        "fix": "Make `submit` **idempotent**. The client generates a `moveId` (UUID) once per user action and reuses it on every retry. The server remembers the result per `(gameId, moveId)`; a repeat returns the stored result instead of applying the move again. `ConcurrentHashMap.computeIfAbsent` guarantees the move is applied at most once per key even if the original and the retry arrive concurrently.\n\nStore results with a short TTL (minutes) so the map does not grow forever; in a multi-server deployment the same table lives in Redis or the database with a unique constraint on `(game_id, move_id)`.",
        "code": [
          {
            "file": "MoveService.java",
            "body": "import java.util.concurrent.ConcurrentHashMap;\n\npublic class MoveService {\n    /** Applies a move and returns the new move number. */\n    public interface Game {\n        int apply(String player, String move);\n    }\n\n    private final ConcurrentHashMap<String, Integer> results = new ConcurrentHashMap<>();\n    private final Game game;\n\n    public MoveService(Game game) {\n        this.game = game;\n    }\n\n    /** The client generates moveId once per click and reuses it on every retry. */\n    public int submit(String gameId, String moveId, String player, String move) {\n        String key = gameId + \":\" + moveId;\n        // computeIfAbsent runs the function at most once per key, even under races\n        return results.computeIfAbsent(key, k -> game.apply(player, move));\n    }\n}"
          }
        ],
        "alternatives": [
          "Use the move number as the idempotency key: a retry carries the same `expectedMoveNumber`, so a second apply is detected as stale and can be answered with the already-applied result.",
          "Database unique constraint on `(game_id, move_id)`: insert first, and treat a duplicate-key error as 'already applied'."
        ],
        "say": "Retries are inevitable, so I make the move endpoint idempotent with a client-generated moveId. The first request applies the move and stores the result; any duplicate just gets that stored result back, so a retry can never play the move twice."
      },
      {
        "title": "A resignation and a checkmating move arrive together",
        "race": "Black is about to be checkmated. At the same instant Black clicks Resign and White plays the mating move. Thread A marks the game `WHITE_WON` by resignation; thread B marks it `WHITE_WON` by checkmate (or, worse, Black's resign and a draw offer accepted by White both fire and the game is first set to `BLACK_WON`, then overwritten with `DRAW`). Ratings are updated twice, or the final result flips after players saw it.",
        "why": "Several terminal events (checkmate, resignation, draw agreement, timeout) can happen concurrently and each one blindly writes the final status. The result must be decided **once**; any later event has to lose.",
        "fix": "Model the status as an `AtomicReference` and end the game with `compareAndSet(IN_PROGRESS, result)`. Only one caller can win that transition. Everything with side effects (rating update, notifications, persisting the result) runs only for the caller that got `true`, so it happens exactly once. Move handling checks `isOver()` inside the same game lock before applying a move.",
        "code": [
          {
            "file": "GameLifecycle.java",
            "body": "import java.util.concurrent.atomic.AtomicReference;\n\npublic class GameLifecycle {\n    public enum Status { IN_PROGRESS, WHITE_WON, BLACK_WON, DRAW }\n\n    private final AtomicReference<Status> status = new AtomicReference<>(Status.IN_PROGRESS);\n\n    /** The first terminal event wins; every later one is rejected. */\n    public boolean end(Status result) {\n        if (result == Status.IN_PROGRESS) {\n            throw new IllegalArgumentException(\"Not a terminal status\");\n        }\n        return status.compareAndSet(Status.IN_PROGRESS, result);\n    }\n\n    public boolean isOver() {\n        return status.get() != Status.IN_PROGRESS;\n    }\n\n    public Status status() {\n        return status.get();\n    }\n}"
          }
        ],
        "alternatives": [
          "Inside the game lock, check `status == IN_PROGRESS` before writing the result. This is equivalent when the lock already exists.",
          "Database: `UPDATE game SET status = ? WHERE id = ? AND status = 'IN_PROGRESS'` and check that one row changed."
        ],
        "say": "Game over is a state transition that must happen exactly once, so I use a compare-and-set from IN_PROGRESS to the result. Whichever of resign, checkmate or timeout wins that CAS decides the result and triggers the rating update; the others see false and do nothing."
      }
    ]
  },
  {
    "id": "coffee-vending-machine",
    "scenarios": [
      {
        "title": "Ingredient stock goes negative",
        "race": "The machine has 250 ml of milk left. A latte needs 200 ml. Two users (or two app orders hitting a networked machine) both call `milk >= 200`; both see 250 and both pass. Each then deducts 200, leaving milk at -150 and one customer with a cup that was brewed from milk that did not exist. With several ingredients the problem is worse: coffee is deducted, then milk is found short, and the coffee is lost.",
        "why": "Checking availability and deducting are separate steps (check-then-act), and a recipe needs several ingredients, so a half-deducted order leaves the inventory inconsistent.",
        "fix": "Make reservation **atomic and all-or-nothing** inside the inventory. `tryConsume(recipe)` takes the inventory lock, verifies every ingredient, and only then deducts them all. A single lock is the right tool here because the check touches several counters at once, which a single `AtomicInteger` cannot protect. Refills use the same lock, so a refill can never be lost between a read and a write.",
        "code": [
          {
            "file": "Inventory.java",
            "body": "import java.util.HashMap;\nimport java.util.Map;\n\npublic class Inventory {\n    private final Map<String, Integer> stock = new HashMap<>();\n\n    public synchronized void refill(String ingredient, int qty) {\n        stock.merge(ingredient, qty, Integer::sum);\n    }\n\n    /** All-or-nothing: either every ingredient is taken or none is. */\n    public synchronized boolean tryConsume(Map<String, Integer> recipe) {\n        for (Map.Entry<String, Integer> e : recipe.entrySet()) {\n            if (stock.getOrDefault(e.getKey(), 0) < e.getValue()) {\n                return false;\n            }\n        }\n        recipe.forEach((ingredient, qty) -> stock.merge(ingredient, -qty, Integer::sum));\n        return true;\n    }\n\n    public synchronized int available(String ingredient) {\n        return stock.getOrDefault(ingredient, 0);\n    }\n}"
          }
        ],
        "alternatives": [
          "One `AtomicInteger` per ingredient with CAS works for single-ingredient items, but multi-ingredient recipes need either a lock or deducting in a fixed order with rollback.",
          "Reserve first, brew second: deduct ingredients before brewing and call a `refund(recipe)` if the machine jams, instead of checking at the end."
        ],
        "say": "A recipe touches several counters, so I put check and deduct for the whole recipe under one inventory lock. It's all-or-nothing: either the drink gets every ingredient or the order is rejected and nothing changes. Refills share the same lock."
      },
      {
        "title": "Two users press Brew at the same time",
        "race": "The machine is idle. User A taps Latte on the touchscreen and, within the same few milliseconds, the mobile app sends an order for Espresso. Both handlers read `state == IDLE`, both set it to `BREWING`, and both start the grinder and the pump. One cup gets two drinks' worth of liquid and the motor is driven by two threads.",
        "why": "There is one physical resource (the dispenser) but the state check and state change are separate operations, so two threads can both believe they are first.",
        "fix": "Treat the state as a single atomic cell and claim it with `compareAndSet(IDLE, BREWING)`. Exactly one caller succeeds; the other immediately gets `false` and the UI can show 'machine busy'. The `finally` block puts the state back to `IDLE` even if dispensing throws, so a failure never leaves the machine permanently busy.\n\nThis is the state-machine form of mutual exclusion: the transition itself is the lock, and no thread ever blocks.",
        "code": [
          {
            "file": "CoffeeMachine.java",
            "body": "import java.util.concurrent.atomic.AtomicReference;\n\npublic class CoffeeMachine {\n    public enum State { IDLE, BREWING, OUT_OF_SERVICE }\n\n    private final AtomicReference<State> state = new AtomicReference<>(State.IDLE);\n\n    /** Returns false immediately if another drink is already being made. */\n    public boolean brew(Runnable dispense) {\n        if (!state.compareAndSet(State.IDLE, State.BREWING)) {\n            return false;\n        }\n        try {\n            dispense.run();\n        } finally {\n            state.compareAndSet(State.BREWING, State.IDLE);\n        }\n        return true;\n    }\n\n    public State state() {\n        return state.get();\n    }\n}"
          }
        ],
        "alternatives": [
          "`synchronized` or a `ReentrantLock.tryLock()` around the brew gives the same exclusion; CAS on the state is just lighter and also records the state.",
          "A single-threaded executor queue so orders are brewed one after another instead of being rejected."
        ],
        "say": "The machine can only make one drink at a time, so I claim it with a compare-and-set from IDLE to BREWING. One request wins and the other is told the machine is busy, and a finally block always returns it to IDLE even on failure."
      }
    ]
  },
  {
    "id": "restaurant-management-system",
    "scenarios": [
      {
        "title": "Two waiters seat guests at the same table",
        "race": "Table 7 is free. Waiter Asha and waiter Ben both pick it for different parties at the same moment. Both read `status == FREE`, both set `OCCUPIED`, and the last write wins: Ben's party is recorded, Asha's party stands at the table with an order that is attached to nothing, and two orders end up on one table.",
        "why": "Reading the status and writing it are two steps. The table's owner (status plus waiter) is also two fields, so a reader can see 'OCCUPIED' with the previous waiter.",
        "fix": "Hold status and waiter in one **immutable** value (`Seating`) inside an `AtomicReference`, and claim the table with `compareAndSet(free, occupied)`. The CAS compares the exact object that was read, so if anyone changed the table in between, the claim fails and the caller tells the waiter 'already taken'. Because the value is replaced as a whole, nobody can ever observe a half-updated table.",
        "code": [
          {
            "file": "Table.java",
            "body": "import java.util.concurrent.atomic.AtomicReference;\n\npublic class Table {\n    public enum Status { FREE, OCCUPIED }\n\n    /** Immutable, so status and waiter always change together. */\n    private record Seating(Status status, String waiterId) {}\n\n    private final AtomicReference<Seating> seating = new AtomicReference<>(new Seating(Status.FREE, null));\n\n    public boolean seat(String waiterId) {\n        Seating current = seating.get();\n        if (current.status() != Status.FREE) {\n            return false;\n        }\n        return seating.compareAndSet(current, new Seating(Status.OCCUPIED, waiterId));\n    }\n\n    public void release() {\n        seating.set(new Seating(Status.FREE, null));\n    }\n\n    public String waiter() {\n        return seating.get().waiterId();\n    }\n}"
          }
        ],
        "alternatives": [
          "A per-table `ReentrantLock` and an `if (status == FREE)` check inside it.",
          "Database: `UPDATE tables SET status='OCCUPIED', waiter_id=? WHERE id=? AND status='FREE'` and check that one row was updated."
        ],
        "say": "Seating is a transition from FREE to OCCUPIED that only one waiter may make. I keep status and waiter together in one immutable object and swap it with compare-and-set, so the loser gets a clean 'table already taken' instead of two parties on one table."
      },
      {
        "title": "The last portion of a dish",
        "race": "The kitchen has one portion of biryani left. Two waiters take orders for it at once. Both read `portions == 1`, both accept the order, both decrement. Stock becomes -1 (or 0 after a lost update with plain `portions--`) and one customer waits 20 minutes for a dish that cannot be made.",
        "why": "`if (portions > 0) portions--` is a check-then-act, and `portions--` on a plain int is itself not atomic (read, subtract, write), so concurrent decrements can also be lost.",
        "fix": "Use an `AtomicInteger` and a **CAS loop**: read the current value, return false if it is zero, otherwise try `compareAndSet(current, current - 1)` and retry if another waiter changed it first. The count can never go below zero, and exactly one waiter gets the last portion. `giveBack()` restores a portion when an order is cancelled before cooking starts.",
        "code": [
          {
            "file": "MenuItemStock.java",
            "body": "import java.util.concurrent.atomic.AtomicInteger;\n\npublic class MenuItemStock {\n    private final AtomicInteger portions;\n\n    public MenuItemStock(int portions) {\n        this.portions = new AtomicInteger(portions);\n    }\n\n    /** Never lets the count go below zero, however many waiters race for the last portion. */\n    public boolean tryTake() {\n        while (true) {\n            int current = portions.get();\n            if (current == 0) {\n                return false;\n            }\n            if (portions.compareAndSet(current, current - 1)) {\n                return true;\n            }\n        }\n    }\n\n    /** The order was cancelled before the kitchen started cooking. */\n    public void giveBack() {\n        portions.incrementAndGet();\n    }\n\n    public int remaining() {\n        return portions.get();\n    }\n}"
          }
        ],
        "alternatives": [
          "`synchronized` on the stock object; simple and fast enough for one restaurant.",
          "Database: `UPDATE stock SET qty = qty - 1 WHERE item_id = ? AND qty > 0`. The `qty > 0` in the WHERE clause is the atomic check; 0 rows updated means sold out."
        ],
        "say": "Selling the last portion is a conditional decrement, so I do it as one atomic step: a CAS loop that never goes below zero, or an UPDATE with qty greater than zero in the WHERE clause. Exactly one order gets it and the rest are told it's sold out immediately."
      },
      {
        "title": "Adding an item while the bill is being generated",
        "race": "A customer asks for the bill. The cashier thread totals the items (Rs 1,200) and prints it. Meanwhile a waiter adds a dessert to the same order. The dessert is added after the total was computed, so the bill says 1,200 while the order now holds 1,350, and the kitchen cooks a dish that will never be paid for.",
        "why": "The bill is a snapshot of a collection that other threads are still modifying; the order has no rule that stops items arriving after billing.",
        "fix": "Guard each order with its own lock and give it a **status**. `addItem` and `generateBill` both take the order's lock. Once the bill is generated the status is `BILLED` and `addItem` returns false; to add more, the cashier explicitly reopens the order, which forces a new bill. A lock per order (not one global lock) means busy tables never wait on each other.",
        "code": [
          {
            "file": "Order.java",
            "body": "import java.util.ArrayList;\nimport java.util.List;\nimport java.util.concurrent.locks.ReentrantLock;\n\npublic class Order {\n    public enum Status { OPEN, BILLED, PAID }\n\n    private final ReentrantLock lock = new ReentrantLock();\n    private final List<Integer> priceCents = new ArrayList<>();\n    private Status status = Status.OPEN;\n\n    public boolean addItem(int cents) {\n        lock.lock();\n        try {\n            if (status != Status.OPEN) {\n                return false; // the bill is already printed; reopen the order explicitly\n            }\n            priceCents.add(cents);\n            return true;\n        } finally {\n            lock.unlock();\n        }\n    }\n\n    public int generateBill() {\n        lock.lock();\n        try {\n            if (status == Status.OPEN) {\n                status = Status.BILLED;\n            }\n            return priceCents.stream().mapToInt(Integer::intValue).sum();\n        } finally {\n            lock.unlock();\n        }\n    }\n}"
          }
        ],
        "alternatives": [
          "Optimistic version on the order: the bill stores the version it totalled and payment fails if the version changed.",
          "Make the order immutable once billed and create an adjustment order for late items."
        ],
        "say": "An order moves OPEN to BILLED to PAID, and I check and change that state under a per-order lock. Late items are rejected once the bill is generated, so the total on the bill always matches what the customer is charged for."
      }
    ]
  },
  {
    "id": "online-stock-exchange",
    "scenarios": [
      {
        "title": "Order-book races and price-time priority",
        "race": "Two sell orders at 100 rest in the book: order 1 (arrived first) and order 2. A buy for 7 arrives at 100 on thread A while another buy for 3 arrives on thread B. Both threads walk the same book, both see order 1 as best, both fill against it and consume more quantity than it has. Or, on a different run, order 2 is filled before order 1, which breaks the exchange's core promise that the earlier order at the same price goes first.",
        "why": "A matching engine reads the best price, compares, updates quantities and removes filled orders. These must all happen on one consistent snapshot; with many threads that is nearly impossible to guarantee with fine-grained locks, and **arrival order** itself becomes ambiguous when several threads stamp it.",
        "fix": "Use the **single-writer** design that real exchanges use: one engine thread per symbol owns the order book, and every request is a message on that thread's queue. There is no shared mutable state to lock; matching is deterministic because the queue order is the arrival order. Note that the sequence number is assigned **on the engine thread**, not on the caller's thread. If callers stamped it themselves, two threads could stamp 5 and 6 and enqueue them as 6 then 5, silently breaking time priority. Different symbols run on different engine threads, so the system still scales out.",
        "code": [
          {
            "file": "MatchingEngine.java",
            "body": "import java.util.ArrayList;\nimport java.util.Comparator;\nimport java.util.List;\nimport java.util.PriorityQueue;\nimport java.util.concurrent.ExecutorService;\nimport java.util.concurrent.Executors;\nimport java.util.concurrent.Future;\n\n/** One engine per symbol. Only its single thread ever touches the book. */\npublic class MatchingEngine {\n    public enum Side { BUY, SELL }\n\n    private static final class Order {\n        final long id;\n        final Side side;\n        final long priceCents;\n        final long seq;\n        long remaining;\n\n        Order(long id, Side side, long priceCents, long qty, long seq) {\n            this.id = id;\n            this.side = side;\n            this.priceCents = priceCents;\n            this.remaining = qty;\n            this.seq = seq;\n        }\n    }\n\n    private final ExecutorService engineThread = Executors.newSingleThreadExecutor();\n\n    // Best price first, then earliest arrival (price-time priority).\n    private final PriorityQueue<Order> bids = new PriorityQueue<>(\n            Comparator.<Order>comparingLong(o -> -o.priceCents).thenComparingLong(o -> o.seq));\n    private final PriorityQueue<Order> asks = new PriorityQueue<>(\n            Comparator.<Order>comparingLong(o -> o.priceCents).thenComparingLong(o -> o.seq));\n\n    private long nextSeq = 0; // touched only on the engine thread\n\n    public Future<List<String>> submit(long id, Side side, long priceCents, long qty) {\n        // The queue order of the engine thread IS the arrival order.\n        return engineThread.submit(() -> match(new Order(id, side, priceCents, qty, ++nextSeq)));\n    }\n\n    private List<String> match(Order in) {\n        List<String> trades = new ArrayList<>();\n        PriorityQueue<Order> opposite = (in.side == Side.BUY) ? asks : bids;\n        while (in.remaining > 0 && !opposite.isEmpty()) {\n            Order best = opposite.peek();\n            boolean crosses = (in.side == Side.BUY)\n                    ? best.priceCents <= in.priceCents\n                    : best.priceCents >= in.priceCents;\n            if (!crosses) {\n                break;\n            }\n            long qty = Math.min(in.remaining, best.remaining);\n            trades.add(qty + \"@\" + best.priceCents + \" (\" + in.id + \" x \" + best.id + \")\");\n            in.remaining -= qty;\n            best.remaining -= qty;\n            if (best.remaining == 0) {\n                opposite.poll();\n            }\n        }\n        if (in.remaining > 0) {\n            ((in.side == Side.BUY) ? bids : asks).add(in);\n        }\n        return trades;\n    }\n\n    public void shutdown() {\n        engineThread.shutdown();\n    }\n}"
          }
        ],
        "alternatives": [
          "Partition by symbol across a pool of engine threads (a symbol is always routed to the same one).",
          "Lock the whole order book per symbol with a `ReentrantLock`. Correct, but arrival order across threads is then decided by who wins the lock, which is hard to audit.",
          "Disruptor-style ring buffer for very low latency."
        ],
        "say": "Matching is inherently sequential per symbol, so I give each symbol a single engine thread that owns its order book and process orders from a queue. That removes locking from the hot path, makes price-time priority deterministic, and I scale by sharding symbols across threads."
      },
      {
        "title": "Two buy orders spend the same money",
        "race": "An account has Rs 10,000 of buying power. Two buy orders for Rs 8,000 each are placed through the API from two devices at once. Each handler checks `available >= 8000` and passes; the orders are accepted and later both fill. The account is now 6,000 overdrawn.",
        "why": "Checking the balance and reserving it are separate steps. Whichever risk check runs first is meaningless if the second check ran before the first deducted anything.",
        "fix": "Reserve funds **atomically when the order is accepted**, before it reaches the book. `reserve(cents)` is a CAS loop that checks and deducts in one step, so only one of the two orders can reserve the 8,000. When an order is cancelled or fills at a better price, `release()` returns the difference. The matching engine then never needs to look at balances.",
        "code": [
          {
            "file": "Account.java",
            "body": "import java.util.concurrent.atomic.AtomicLong;\n\npublic class Account {\n    private final AtomicLong availableCents;\n\n    public Account(long cents) {\n        this.availableCents = new AtomicLong(cents);\n    }\n\n    /** Check and deduct in one atomic step, so two orders can never spend the same money. */\n    public boolean reserve(long cents) {\n        while (true) {\n            long current = availableCents.get();\n            if (current < cents) {\n                return false;\n            }\n            if (availableCents.compareAndSet(current, current - cents)) {\n                return true;\n            }\n        }\n    }\n\n    /** Order cancelled or filled for less than reserved: give the difference back. */\n    public void release(long cents) {\n        availableCents.addAndGet(cents);\n    }\n\n    public long available() {\n        return availableCents.get();\n    }\n}"
          }
        ],
        "alternatives": [
          "A per-account lock around check and deduct, useful when the reservation spans several fields (cash, margin, positions).",
          "Database: `UPDATE accounts SET available = available - ? WHERE id = ? AND available >= ?`.",
          "Do the reservation in the account service and publish the accepted order to the engine; keep the balance logic out of the matching thread."
        ],
        "say": "Buying power is a resource that must be reserved, not just checked. I deduct it atomically when the order is accepted with a conditional update, and release it on cancel or a better fill. Two orders can never both spend the same money."
      },
      {
        "title": "Cancel arrives while the order is being filled",
        "race": "A trader has a buy for 10 resting in the book. A sell for 4 is matching against it on the engine at the same instant the trader's client sends Cancel. If cancel reads `remaining = 10` while the fill is half done, it reports 'cancelled 10 shares' to the trader, and then the fill completes. The trader believes they own 0 shares but actually own 4.",
        "why": "Cancel and fill both read and modify the same `remaining` quantity, and the cancel's answer depends on exactly where the fill was.",
        "fix": "Treat cancel as **just another command on the engine's queue**. The engine processes the fill and the cancel strictly one after another, in arrival order. If the fill is first, cancel then sees `remaining = 6` and returns 6 cancelled shares; if cancel is first, the fill finds no order and fills nothing. The cancel result always states exactly how much was cancelled, and returns -1 if the order is already gone, so the client can reconcile with the trades it received.",
        "code": [
          {
            "file": "OrderBookActor.java",
            "body": "import java.util.HashMap;\nimport java.util.Map;\nimport java.util.concurrent.ExecutorService;\nimport java.util.concurrent.Executors;\nimport java.util.concurrent.Future;\n\npublic class OrderBookActor {\n    private final ExecutorService engine = Executors.newSingleThreadExecutor();\n    private final Map<Long, Long> openQty = new HashMap<>(); // orderId -> remaining, engine thread only\n\n    public Future<Boolean> place(long orderId, long qty) {\n        return engine.submit(() -> {\n            openQty.put(orderId, qty);\n            return true;\n        });\n    }\n\n    /** Returns how much was actually filled. */\n    public Future<Long> fill(long orderId, long qty) {\n        return engine.submit(() -> {\n            Long remaining = openQty.get(orderId);\n            if (remaining == null) {\n                return 0L; // already cancelled or fully filled\n            }\n            long filled = Math.min(remaining, qty);\n            if (remaining - filled == 0) {\n                openQty.remove(orderId);\n            } else {\n                openQty.put(orderId, remaining - filled);\n            }\n            return filled;\n        });\n    }\n\n    /** Returns the quantity cancelled (what was left), or -1 if there was nothing to cancel. */\n    public Future<Long> cancel(long orderId) {\n        return engine.submit(() -> {\n            Long remaining = openQty.remove(orderId);\n            return (remaining == null) ? -1L : remaining;\n        });\n    }\n\n    public void shutdown() {\n        engine.shutdown();\n    }\n}"
          }
        ],
        "alternatives": [
          "Per-order lock plus a status field (`OPEN`, `PARTIALLY_FILLED`, `CANCELLED`, `FILLED`) moved with compare-and-set. This needs care to keep matching consistent with the book.",
          "Make cancel idempotent by cancel id, so a retried cancel returns the same answer."
        ],
        "say": "I never let cancel touch the order directly. It's a message on the same single-threaded queue as fills, so the two are strictly ordered and the cancel reply says exactly how much was left. The trader never gets an ambiguous answer."
      }
    ]
  },
  {
    "id": "course-registration-system",
    "scenarios": [
      {
        "title": "Two students, one last seat",
        "race": "A course has capacity 30 and 29 seats taken. Students Maya and Raj click Register in the same millisecond. Both read `enrolled = 29`, both pass `enrolled < 30`, both are added. The course now has 31 students and the lecture hall is over capacity.",
        "why": "`if (enrolled < capacity) enrolled++` is check-then-act on shared state. The same student double-clicking Register is a second, related problem: the same id may be added twice.",
        "fix": "Claim a seat atomically. First add the student to a concurrent set so a double-click is rejected (`students.add` returns false for a duplicate). Then run a **CAS loop** on the seat counter: read, refuse if full, otherwise `compareAndSet(current, current + 1)`. If the course turns out to be full, undo the set insertion. With a database this is exactly one conditional statement: `UPDATE course SET enrolled = enrolled + 1 WHERE id = ? AND enrolled < capacity`.",
        "code": [
          {
            "file": "Course.java",
            "body": "import java.util.Set;\nimport java.util.concurrent.ConcurrentHashMap;\nimport java.util.concurrent.atomic.AtomicInteger;\n\npublic class Course {\n    private final int capacity;\n    private final AtomicInteger enrolled = new AtomicInteger();\n    private final Set<String> students = ConcurrentHashMap.newKeySet();\n\n    public Course(int capacity) {\n        this.capacity = capacity;\n    }\n\n    public boolean enroll(String studentId) {\n        if (!students.add(studentId)) {\n            return false; // duplicate request from the same student\n        }\n        while (true) {\n            int current = enrolled.get();\n            if (current >= capacity) {\n                students.remove(studentId);\n                return false; // full\n            }\n            if (enrolled.compareAndSet(current, current + 1)) {\n                return true;\n            }\n        }\n    }\n\n    public int enrolledCount() {\n        return enrolled.get();\n    }\n}"
          }
        ],
        "alternatives": [
          "A per-course lock around check and enrol (also required if enrolment writes several tables).",
          "Database unique constraint on `(course_id, student_id)` to stop duplicates, plus the conditional UPDATE above for capacity.",
          "Optimistic version column on the course row; retry on conflict."
        ],
        "say": "The last seat is a conditional increment, so I make it one atomic step: a CAS loop in memory, or an UPDATE with enrolled less than capacity in the WHERE clause. Exactly one student gets the seat, and a unique key on course and student stops duplicate registrations."
      },
      {
        "title": "Waitlist promotion when a student drops",
        "race": "Course is full with two students on the waitlist. Student P drops and, at the same time, student Q drops. Both drop handlers see the same first waitlisted student Z and both promote Z: Z is enrolled once but two seats were consumed by the single promotion logic, or Z is skipped and a seat sits empty while students wait. A new registration may also slip in ahead of the waitlist in the gap between 'seat freed' and 'waitlist promoted'.",
        "why": "Dropping a student and promoting the next one are two steps that must look like one. In between, the section is in an inconsistent state: a free seat exists, so a brand-new registration can take it ahead of people who have been waiting.",
        "fix": "Do drop and promote **under one lock per section**. The freed seat is handed to the head of the waitlist inside the same critical section, so the seat is never visible as free to a new registrant and each waitlisted student is promoted at most once, in FIFO order. The notification to the promoted student is sent after the lock is released, so slow I/O never holds the lock.",
        "code": [
          {
            "file": "CourseSection.java",
            "body": "import java.util.ArrayDeque;\nimport java.util.Deque;\nimport java.util.HashSet;\nimport java.util.Optional;\nimport java.util.Set;\nimport java.util.concurrent.locks.ReentrantLock;\n\npublic class CourseSection {\n    public enum Result { ENROLLED, WAITLISTED, ALREADY_REGISTERED }\n\n    private final int capacity;\n    private final Set<String> enrolled = new HashSet<>();\n    private final Deque<String> waitlist = new ArrayDeque<>();\n    private final ReentrantLock lock = new ReentrantLock();\n\n    public CourseSection(int capacity) {\n        this.capacity = capacity;\n    }\n\n    public Result register(String studentId) {\n        lock.lock();\n        try {\n            if (enrolled.contains(studentId) || waitlist.contains(studentId)) {\n                return Result.ALREADY_REGISTERED;\n            }\n            if (enrolled.size() < capacity) {\n                enrolled.add(studentId);\n                return Result.ENROLLED;\n            }\n            waitlist.addLast(studentId);\n            return Result.WAITLISTED;\n        } finally {\n            lock.unlock();\n        }\n    }\n\n    /**\n     * Drop and promote under one lock: the freed seat goes to exactly one waitlisted\n     * student, in order. Send the notification after returning, outside the lock.\n     */\n    public Optional<String> drop(String studentId) {\n        lock.lock();\n        try {\n            if (!enrolled.remove(studentId)) {\n                waitlist.remove(studentId); // was only waitlisted\n                return Optional.empty();\n            }\n            String next = waitlist.pollFirst();\n            if (next != null) {\n                enrolled.add(next);\n            }\n            return Optional.ofNullable(next);\n        } finally {\n            lock.unlock();\n        }\n    }\n}"
          }
        ],
        "alternatives": [
          "Database transaction that deletes the enrolment and promotes the first waitlist row with `SELECT ... FOR UPDATE SKIP LOCKED LIMIT 1`.",
          "Publish a 'seat freed' event to a queue consumed by a single worker per course, which performs the promotion."
        ],
        "say": "A freed seat must go to the head of the waitlist atomically, so I do drop and promote inside one per-course lock. A new registration can never sneak in between, each waitlisted student is promoted once and in order, and I send notifications after releasing the lock."
      },
      {
        "title": "One student registering for two courses at once",
        "race": "A student has 16 credits and the cap is 20. They open two tabs and register for two 4-credit courses at the same time. Each request reads 16 credits, computes 16 + 4 = 20 and passes. Both succeed and the student is at 24 credits. The same applies to timetable clashes: each check passes against the schedule as it was before the other registration landed.",
        "why": "The rule (credit limit, no clash) depends on **all of the student's registrations**, but each request only checks the snapshot it read. Locking each course alone does not help, because the two requests touch different courses.",
        "fix": "Serialise registrations **per student** with a per-student lock: check the credit cap and clash, claim the seat, update the credits, all inside it. To avoid deadlock, the order of locks is fixed: student lock first, then the course's seat claim, never the other way round. Different students never contend, so throughput is unaffected.",
        "code": [
          {
            "file": "RegistrationService.java",
            "body": "import java.util.HashMap;\nimport java.util.Map;\nimport java.util.concurrent.ConcurrentHashMap;\nimport java.util.concurrent.locks.ReentrantLock;\n\npublic class RegistrationService {\n    /** Course-level seat claim; itself atomic (see the last-seat scenario). */\n    public interface CourseSeats {\n        boolean tryEnroll(String studentId, String courseId);\n    }\n\n    private static final int MAX_CREDITS = 20;\n\n    private final ConcurrentHashMap<String, ReentrantLock> studentLocks = new ConcurrentHashMap<>();\n    private final Map<String, Integer> creditsByStudent = new HashMap<>(); // guarded by the student's lock\n    private final CourseSeats seats;\n\n    public RegistrationService(CourseSeats seats) {\n        this.seats = seats;\n    }\n\n    /** Lock order is always student first, course second. Never the reverse. */\n    public boolean register(String studentId, String courseId, int courseCredits) {\n        ReentrantLock studentLock = studentLocks.computeIfAbsent(studentId, k -> new ReentrantLock());\n        studentLock.lock();\n        try {\n            int current = creditsByStudent.getOrDefault(studentId, 0);\n            if (current + courseCredits > MAX_CREDITS) {\n                return false; // would exceed the credit cap\n            }\n            if (!seats.tryEnroll(studentId, courseId)) {\n                return false; // course is full\n            }\n            creditsByStudent.put(studentId, current + courseCredits);\n            return true;\n        } finally {\n            studentLock.unlock();\n        }\n    }\n}"
          }
        ],
        "alternatives": [
          "Database: lock the student's row with `SELECT ... FOR UPDATE` in the same transaction as the enrolment insert.",
          "Re-check the credit and clash rules in a final validation step at commit time and roll back if they are violated (optimistic approach).",
          "Funnel all registration requests for a student through one queue partition keyed by student id."
        ],
        "say": "The credit cap is a per-student invariant, so I serialise a student's registrations with a per-student lock and always take it before the course lock to avoid deadlocks. Two tabs from the same student can't both pass the check."
      }
    ]
  },
  {
    "id": "movie-ticket-booking",
    "scenarios": [
      {
        "title": "Double-booked seats and deadlock between two bookings",
        "race": "Booking X wants seats A1 and A2; booking Y wants A2 and A1 (the user clicked them in a different order). X locks A1 and waits for A2; Y locks A2 and waits for A1. Neither can proceed: a deadlock. If instead there are no locks, both read A1 and A2 as AVAILABLE and both mark them HELD, so the same seats are sold twice.",
        "why": "Without locks it is a check-then-act race on seat status. With naive locks, taking them in the order the user clicked creates a cycle, which is the textbook condition for deadlock.",
        "fix": "Lock the seats **in a canonical sorted order**. Every request, regardless of click order, locks A1 before A2, so a cycle is impossible. Hold all locks only for the short critical section (verify every seat is AVAILABLE, then mark them HELD), use `tryLock` with a timeout so a stuck request fails fast instead of hanging, and release in reverse order. The locks are per `ShowSeat`, so two different shows or distant seats never block each other.",
        "code": [
          {
            "file": "SeatLocks.java",
            "body": "import java.util.ArrayList;\nimport java.util.Collection;\nimport java.util.List;\nimport java.util.TreeSet;\nimport java.util.concurrent.ConcurrentHashMap;\nimport java.util.concurrent.TimeUnit;\nimport java.util.concurrent.locks.ReentrantLock;\nimport java.util.function.Supplier;\n\npublic class SeatLocks {\n    private final ConcurrentHashMap<String, ReentrantLock> locks = new ConcurrentHashMap<>();\n\n    /**\n     * Runs the action while holding every seat lock. Locks are taken in sorted order,\n     * so two requests for overlapping seats can never wait on each other in a cycle.\n     */\n    public <T> T withSeats(Collection<String> showSeatIds, Supplier<T> action) throws InterruptedException {\n        List<ReentrantLock> acquired = new ArrayList<>();\n        try {\n            for (String id : new TreeSet<>(showSeatIds)) {\n                ReentrantLock lock = locks.computeIfAbsent(id, k -> new ReentrantLock());\n                if (!lock.tryLock(2, TimeUnit.SECONDS)) {\n                    throw new IllegalStateException(\"Seat busy: \" + id);\n                }\n                acquired.add(lock);\n            }\n            return action.get(); // check every seat is AVAILABLE, then mark them HELD\n        } finally {\n            for (int i = acquired.size() - 1; i >= 0; i--) {\n                acquired.get(i).unlock();\n            }\n        }\n    }\n}"
          }
        ],
        "alternatives": [
          "Database: `SELECT ... FROM show_seat WHERE id IN (...) ORDER BY id FOR UPDATE`. Sorting by id in the query gives the same lock ordering inside the database, and `SKIP LOCKED` lets you pick other seats instead of waiting.",
          "Single conditional UPDATE: `UPDATE show_seat SET status='HELD', booking_id=? WHERE id IN (...) AND status='AVAILABLE'`, then check that the number of updated rows equals the number of seats requested, otherwise roll back.",
          "Optimistic locking with a version column. A poor fit here, because popular shows have high contention and many retries."
        ],
        "say": "Two bookings can ask for the same seats in different orders, so I always acquire seat locks in sorted order, which makes deadlock impossible. I hold them just long enough to check availability and mark the seats held, with a timeout so nothing hangs."
      },
      {
        "title": "Holding seats across servers with a TTL (Redis SET NX PX)",
        "race": "The app runs on three servers behind a load balancer. User 1's request lands on server A and user 2's on server B, both for seat C5. An in-memory lock on each server doesn't help because the servers don't share memory, so both think they hold C5. Even with a shared lock, if the user closes the tab while holding it, the seat stays locked forever.",
        "why": "In-process locks only protect one JVM. Seat holds also need to **expire on their own**, otherwise abandoned checkouts permanently remove seats from sale.",
        "fix": "Hold each seat in Redis with `SET key token NX PX ttl`. `NX` means set only if absent, so exactly one server wins; `PX` gives an automatic expiry (say 5 minutes), so abandoned holds free themselves. The value is a random **token** identifying the holder, and release uses a small Lua script that deletes the key only if the token still matches, so a slow client whose hold already expired cannot delete someone else's newer hold. Seats are taken in sorted order and rolled back if any one fails.\n\nThe interface is tiny (`Redis` with two methods), which also makes the logic easy to test with the in-memory fake shown in the second tab.",
        "code": [
          {
            "file": "RedisSeatHold.java",
            "body": "import java.util.ArrayList;\nimport java.util.Collection;\nimport java.util.List;\nimport java.util.Optional;\nimport java.util.TreeSet;\nimport java.util.UUID;\n\npublic class RedisSeatHold {\n    /** The small slice of a Redis client this needs. */\n    public interface Redis {\n        /** SET key value NX PX ttlMillis. True only if the key did not exist. */\n        boolean setNxPx(String key, String value, long ttlMillis);\n\n        /** Runs RELEASE_SCRIPT atomically on the server. */\n        boolean deleteIfEquals(String key, String value);\n    }\n\n    /** Only the owner may release: compare the token, then delete, in one atomic step. */\n    public static final String RELEASE_SCRIPT =\n            \"if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end\";\n\n    private static final long HOLD_MILLIS = 5 * 60 * 1000;\n\n    private final Redis redis;\n\n    public RedisSeatHold(Redis redis) {\n        this.redis = redis;\n    }\n\n    /** Returns a hold token if every seat was held, otherwise nothing is held. */\n    public Optional<String> holdSeats(String showId, Collection<String> seatIds) {\n        String token = UUID.randomUUID().toString();\n        List<String> heldKeys = new ArrayList<>();\n        for (String seat : new TreeSet<>(seatIds)) {\n            String key = \"hold:\" + showId + \":\" + seat;\n            if (!redis.setNxPx(key, token, HOLD_MILLIS)) {\n                heldKeys.forEach(k -> redis.deleteIfEquals(k, token)); // roll back\n                return Optional.empty();\n            }\n            heldKeys.add(key);\n        }\n        return Optional.of(token);\n    }\n\n    public void release(String showId, Collection<String> seatIds, String token) {\n        for (String seat : seatIds) {\n            redis.deleteIfEquals(\"hold:\" + showId + \":\" + seat, token);\n        }\n    }\n}"
          },
          {
            "file": "InMemoryRedis.java",
            "body": "import java.util.HashMap;\nimport java.util.Map;\n\n/** Test double with real expiry semantics, so the hold logic can be exercised without Redis. */\npublic class InMemoryRedis implements RedisSeatHold.Redis {\n    private record Entry(String value, long expiresAt) {}\n\n    private final Map<String, Entry> data = new HashMap<>();\n\n    @Override\n    public synchronized boolean setNxPx(String key, String value, long ttlMillis) {\n        Entry existing = data.get(key);\n        if (existing != null && existing.expiresAt() > System.currentTimeMillis()) {\n            return false;\n        }\n        data.put(key, new Entry(value, System.currentTimeMillis() + ttlMillis));\n        return true;\n    }\n\n    @Override\n    public synchronized boolean deleteIfEquals(String key, String value) {\n        Entry existing = data.get(key);\n        if (existing != null && existing.value().equals(value)) {\n            data.remove(key);\n            return true;\n        }\n        return false;\n    }\n}"
          }
        ],
        "alternatives": [
          "Database rows with a `held_until` timestamp: `UPDATE show_seat SET held_by=?, held_until=now()+interval '5 min' WHERE id=? AND (held_until IS NULL OR held_until < now())`. Simpler when you already need a database, at the cost of more load on it.",
          "Redlock across several Redis nodes for stronger guarantees; for seat holds a single Redis plus the database as the final authority is usually enough.",
          "Add a fencing token or final database check at confirm time so a lock that expired mid-request can't cause a double booking."
        ],
        "say": "Across servers I need a shared lock with expiry, so I use Redis SET NX PX with a random token per hold. NX gives one winner, PX frees abandoned holds automatically, and release is a compare-token-then-delete script so one client can never release another's hold."
      },
      {
        "title": "Payment succeeds after the hold expired (and gateway retries)",
        "race": "A user holds seats for 5 minutes but takes 6 minutes to pay. At minute 5 the sweeper expires the hold and another user grabs the seats. At minute 6 the payment gateway calls back with 'paid'. Confirming now would double-book the seats. Separately, the gateway delivers the same 'paid' webhook twice; a naive confirm either fails the second time or charges and issues two tickets.",
        "why": "Confirmation races with expiry, and webhooks are delivered at-least-once. Confirm has to decide between three outcomes (confirm, already confirmed, expired) based on state that another thread may be changing right now.",
        "fix": "Treat the booking as a **small state machine** (`PENDING`, `CONFIRMED`, `EXPIRED`) guarded by a lock per booking. The confirm path and the expiry sweeper take the same lock, so they cannot interleave. Inside it: if already `CONFIRMED` with the same `paymentId`, return success again (idempotent retry); if the hold has expired, mark `EXPIRED` and return `HOLD_EXPIRED_REFUND` so the payment is refunded; otherwise move to `CONFIRMED`. The 'paid after expiry' case is therefore detected explicitly and refunded instead of double-booking.",
        "code": [
          {
            "file": "BookingService.java",
            "body": "import java.time.Instant;\nimport java.util.concurrent.ConcurrentHashMap;\n\npublic class BookingService {\n    public enum Status { PENDING, CONFIRMED, EXPIRED }\n\n    public enum Result { CONFIRMED, ALREADY_CONFIRMED, HOLD_EXPIRED_REFUND, REJECTED }\n\n    private static final class Booking {\n        final Instant holdExpiresAt;\n        Status status = Status.PENDING;\n        String paymentId;\n\n        Booking(Instant holdExpiresAt) {\n            this.holdExpiresAt = holdExpiresAt;\n        }\n    }\n\n    private final ConcurrentHashMap<String, Booking> bookings = new ConcurrentHashMap<>();\n\n    public void create(String bookingId, Instant holdExpiresAt) {\n        bookings.put(bookingId, new Booking(holdExpiresAt));\n    }\n\n    /** Called when the payment gateway reports success. Safe to call twice. */\n    public Result confirm(String bookingId, String paymentId, Instant now) {\n        Booking b = bookings.get(bookingId);\n        if (b == null) {\n            return Result.REJECTED;\n        }\n        synchronized (b) {\n            if (b.status == Status.CONFIRMED) {\n                // a webhook retry is fine; a different payment for the same booking is not\n                return paymentId.equals(b.paymentId) ? Result.ALREADY_CONFIRMED : Result.REJECTED;\n            }\n            if (b.status == Status.EXPIRED || now.isAfter(b.holdExpiresAt)) {\n                b.status = Status.EXPIRED;\n                return Result.HOLD_EXPIRED_REFUND; // seats may already belong to someone else\n            }\n            b.status = Status.CONFIRMED;\n            b.paymentId = paymentId;\n            return Result.CONFIRMED;\n        }\n    }\n\n    /** The sweeper uses the same lock, so it can't expire a booking mid-confirm. */\n    public boolean expireIfPending(String bookingId) {\n        Booking b = bookings.get(bookingId);\n        if (b == null) {\n            return false;\n        }\n        synchronized (b) {\n            if (b.status != Status.PENDING) {\n                return false;\n            }\n            b.status = Status.EXPIRED;\n            return true;\n        }\n    }\n}"
          }
        ],
        "alternatives": [
          "Database: `UPDATE booking SET status='CONFIRMED', payment_id=? WHERE id=? AND status='PENDING' AND hold_expires_at > now()`. Zero rows updated means expired or already confirmed, and you read the row to tell which.",
          "Extend the hold when payment starts (for example to 10 minutes) so slow-but-genuine payments are not penalised, then let the sweeper expire it normally.",
          "Record the gateway's event id in a processed-events table with a unique constraint for webhook de-duplication."
        ],
        "say": "Confirm and expire are competing transitions on the booking, so I guard them with the same per-booking lock or a conditional update on status. A duplicate webhook is answered idempotently, and a payment that arrives after the hold expired is refunded rather than risking a double booking."
      }
    ]
  }
);
