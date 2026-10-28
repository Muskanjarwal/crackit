window.QUESTIONS = window.QUESTIONS || [];
window.QUESTIONS.push(
  /* ------------------------------------------------------------------ */
  {
    id: "tic-tac-toe",
    name: "Design Tic Tac Toe",
    difficulty: "easy",
    understanding: "Design a two-player Tic Tac Toe that is general enough to run on an N×N board. The interesting part is not drawing the board; it is detecting a winner in O(1) per move instead of rescanning the grid, while keeping the board, players and game rules cleanly separated.",
    dialogue: [
      { who: "you", text: "Is this the classic 3×3 game, or should the board size be configurable?" },
      { who: "int", text: "Make it N×N. A player wins by filling a whole row, column or diagonal." },
      { who: "you", text: "Two players only, alternating turns, X always starts?" },
      { who: "int", text: "Two players. Let the caller decide who goes first, but turns must alternate." },
      { who: "you", text: "What should happen on an invalid move: an occupied cell, out of bounds, or a move after the game ended?" },
      { who: "int", text: "Reject it with a clear error and do not change the state. The same player keeps their turn." },
      { who: "you", text: "Do we need a UI, or just the game engine with a move API?" },
      { who: "int", text: "Just the engine. Assume a UI or console wrapper calls it." },
      { who: "you", text: "Is performance a concern? For large boards, scanning every row and column on every move gets expensive." },
      { who: "int", text: "Good instinct. Win detection should not depend on scanning the whole board." }
    ],
    requirements: [
      { group: "Core", items: [
        "Play on an N×N board between two players who alternate turns.",
        "A move places the current player's mark on an empty, in-bounds cell.",
        "A player wins by owning an entire row, column or either diagonal.",
        "The game ends in a draw when the board is full with no winner.",
        "Invalid moves are rejected without changing state or switching turns."
      ] },
      { group: "Extensibility", items: [
        "Board size is configurable.",
        "Win detection stays O(1) per move regardless of board size.",
        "The engine is UI-agnostic so a console or GUI can sit on top."
      ] }
    ],
    entities: [
      { name: "Mark", text: "An enum for the symbols a player can place (X, O). A cell holds a Mark or is empty." },
      { name: "Player", text: "A name plus the Mark they play with." },
      { name: "Board", text: "The N×N grid. Owns placement rules and the counters used for O(1) win detection." },
      { name: "Game", text: "Orchestrates turns and tracks status (in progress, won, draw). The public API for callers." },
      { name: "GameStatus", text: "An enum: IN_PROGRESS, WON, DRAW." }
    ],
    design: [
      {
        heading: "Requirement 1: Model players, marks and the board",
        text: "Start with the data. A cell either holds a `Mark` or nothing. The `Board` owns the grid and is the only place that knows whether a coordinate is valid and free. That keeps validation in one spot instead of scattered across the game loop.",
        code: [
          { file: "Mark.java", body: `public enum Mark { X, O }` },
          { file: "Player.java", body: `public class Player {
    private final String name;
    private final Mark mark;

    public Player(String name, Mark mark) {
        this.name = name;
        this.mark = mark;
    }

    public String getName() { return name; }
    public Mark getMark() { return mark; }
}` },
          { file: "Board.java", body: `public class Board {
    private final int size;
    private final Mark[][] cells;
    private int filled;

    public Board(int size) {
        if (size < 2) throw new IllegalArgumentException("size must be >= 2");
        this.size = size;
        this.cells = new Mark[size][size];
    }

    public int getSize() { return size; }

    public boolean isFull() { return filled == size * size; }

    public boolean isValidMove(int row, int col) {
        return row >= 0 && row < size && col >= 0 && col < size && cells[row][col] == null;
    }

    public void place(int row, int col, Mark mark) {
        if (!isValidMove(row, col)) {
            throw new IllegalArgumentException("Invalid move at (" + row + ", " + col + ")");
        }
        cells[row][col] = mark;
        filled++;
    }
}` }
        ],
        note: "A `Board` that knows nothing about players or turns is easy to test: place marks, assert state."
      },
      {
        heading: "Requirement 2: Alternate turns and report status",
        text: "`Game` is the facade callers use. It holds the two players, whose turn it is and the current status. `makeMove` validates, delegates placement to the board, checks for a result and only then flips the turn. If anything throws, no state has changed, which satisfies the 'same player keeps their turn' rule.",
        code: [
          { file: "GameStatus.java", body: `public enum GameStatus { IN_PROGRESS, WON, DRAW }` },
          { file: "Game.java", body: `public class Game {
    private final Board board;
    private final Player[] players;
    private int current;
    private GameStatus status = GameStatus.IN_PROGRESS;
    private Player winner;

    public Game(int size, Player first, Player second) {
        if (first.getMark() == second.getMark()) {
            throw new IllegalArgumentException("Players must use different marks");
        }
        this.board = new Board(size);
        this.players = new Player[] { first, second };
    }

    public GameStatus makeMove(int row, int col) {
        if (status != GameStatus.IN_PROGRESS) {
            throw new IllegalStateException("Game is already over");
        }
        Player player = players[current];
        board.place(row, col, player.getMark());

        if (board.recordAndCheckWin(row, col, player.getMark())) {
            status = GameStatus.WON;
            winner = player;
        } else if (board.isFull()) {
            status = GameStatus.DRAW;
        } else {
            current = 1 - current;
        }
        return status;
    }

    public Player getCurrentPlayer() { return players[current]; }
    public Player getWinner() { return winner; }
    public GameStatus getStatus() { return status; }
}` }
        ]
      },
      {
        heading: "Requirement 3: Detect a winner in O(1)",
        text: "The naive check scans a full row, column and both diagonals after every move: O(N) per move. Instead keep a running count per row, per column and for each diagonal, per mark. A move increments at most four counters. If any counter reaches N, that mark owns an entire line and has won. No scanning at all.\n\nThe counters live inside `Board`, since they are derived purely from board state.",
        code: [
          { file: "Board.java (win tracking)", body: `// Added to Board. One counter array per mark: index 0 = X, 1 = O.
private final int[][] rowCount;
private final int[][] colCount;
private final int[] diagCount;
private final int[] antiDiagCount;

// in the constructor:
//   rowCount = new int[2][size];
//   colCount = new int[2][size];
//   diagCount = new int[2];
//   antiDiagCount = new int[2];

public boolean recordAndCheckWin(int row, int col, Mark mark) {
    int m = mark.ordinal();
    boolean won = false;

    if (++rowCount[m][row] == size) won = true;
    if (++colCount[m][col] == size) won = true;
    if (row == col && ++diagCount[m] == size) won = true;
    if (row + col == size - 1 && ++antiDiagCount[m] == size) won = true;

    return won;
}` },
          { file: "Demo.java", body: `Game game = new Game(3,
        new Player("Asha", Mark.X),
        new Player("Ben", Mark.O));

game.makeMove(0, 0); // X
game.makeMove(1, 0); // O
game.makeMove(0, 1); // X
game.makeMove(1, 1); // O
GameStatus s = game.makeMove(0, 2); // X completes row 0

System.out.println(s);                       // WON
System.out.println(game.getWinner().getName()); // Asha` }
        ],
        note: "Every counter increment is O(1), so a move is O(1) time. The extra memory is O(N), tiny next to the O(N²) board."
      },
      {
        heading: "Requirement 4: Extensibility",
        text: "Board size is just a constructor argument, and the engine exposes no I/O, so a console, web or test harness can all drive it. If the interviewer later asks for more than two players or a 'K in a row' rule on a larger board, the counters generalise: index them by player and compare against K with a sliding line check. You do not need to build that now; the clean `Board`/`Game` split is what makes it cheap."
      }
    ],
    deepDive: [
      {
        title: "Why counters beat scanning",
        text: "Scanning costs O(N) per move and O(N³) over a full game on an N×N board (N² moves, N work each). Counters make each move O(1) and a full game O(N²), which is optimal because you must place N² marks anyway. The trade-off is a little extra state to keep consistent; that is why the counters sit inside `Board` and are updated in exactly one method."
      },
      {
        title: "Undo and move history",
        text: "If asked for undo, store each move as an object and decrement the same counters in reverse. With counters the undo is also O(1). This is the Command pattern's natural fit, but only reach for it if undo is actually required.",
        code: [
          { file: "Move.java", body: `public class Move {
    final int row, col;
    final Mark mark;
    Move(int row, int col, Mark mark) {
        this.row = row; this.col = col; this.mark = mark;
    }
}` }
        ]
      }
    ],
    mistakes: [
      "Rescanning the whole board after every move; it works but misses the point of the question.",
      "Putting turn logic, validation and win detection in one giant class.",
      "Mutating state before validating, so a rejected move still flips the turn.",
      "Hard-coding 3×3 with magic numbers instead of a size field.",
      "Forcing a pattern (State, Strategy) onto a game this small. Design patterns are good to have, but don't force one in just to impress the interviewer."
    ],
    followups: [
      "How would you support more than two players?",
      "How would you add undo/redo?",
      "How would you support 'K in a row' on a larger board, like Gomoku?",
      "How would you add an AI opponent?"
    ],
    patterns: ["strategy", "command"]
  },

  /* ------------------------------------------------------------------ */
  {
    id: "snake-and-ladder",
    name: "Design Snake and Ladder game",
    difficulty: "easy",
    understanding: "Design a Snake and Ladder game for two or more players on a 100-cell board. Players roll a die, move forward, and are redirected by snakes (down) and ladders (up). The design challenge is keeping the board's jump rules, the dice and the turn loop independent so each can change without touching the others.",
    dialogue: [
      { who: "you", text: "Is the board the standard 10×10 with 100 cells, or configurable?" },
      { who: "int", text: "Configurable size, but default to 100. Snakes and ladders are given as start and end cells." },
      { who: "you", text: "How many players, and how is the die rolled: one die, two dice, or a different range?" },
      { who: "int", text: "Two or more players, one six-sided die by default. We may add a two-dice variant later." },
      { who: "you", text: "What happens if a roll would take a player past the final cell?" },
      { who: "int", text: "They stay where they are. You must land exactly on the last cell to win." },
      { who: "you", text: "Can a snake's tail land on another snake's head, or a ladder's top on a snake's head?" },
      { who: "int", text: "Assume the input is valid: no cell is the start of more than one jump, and no jumps loop." },
      { who: "you", text: "Does rolling a six give an extra turn?" },
      { who: "int", text: "Not by default, but it should be easy to add as a rule." },
      { who: "you", text: "Should the game end at the first winner, or continue until everyone finishes?" },
      { who: "int", text: "First player to reach the last cell wins and the game ends." }
    ],
    requirements: [
      { group: "Core", items: [
        "A board of N cells with snakes (head to lower tail) and ladders (bottom to higher top).",
        "Two or more players start at cell 0 and take turns in a fixed order.",
        "On a turn a player rolls the die and moves forward by the rolled value.",
        "Landing on a snake head or ladder bottom moves the player to the jump's end.",
        "A roll that overshoots the last cell is ignored; the first player to land exactly on the last cell wins."
      ] },
      { group: "Extensibility", items: [
        "The dice is pluggable (one die, two dice, loaded die for testing).",
        "Optional rules (extra turn on six) can be added without rewriting the game loop.",
        "Board size and jump layout are configuration, not code."
      ] }
    ],
    entities: [
      { name: "Dice", text: "An interface that produces a roll. Implementations: single die, multiple dice, fixed sequence for tests." },
      { name: "Jump", text: "A start cell and end cell. A snake is a Jump with end < start; a ladder has end > start." },
      { name: "Board", text: "Holds the size and a map from start cell to Jump. Resolves where a position ends up." },
      { name: "Player", text: "A name and current position." },
      { name: "Game", text: "Owns the player queue, board and dice. Runs turns until someone wins." }
    ],
    design: [
      {
        heading: "Requirement 1: Model the board and its jumps",
        text: "Snakes and ladders are the same thing: a jump from one cell to another. Modelling them as a single `Jump` type removes duplicate branches. The `Board` stores jumps in a map from start cell to end cell so resolving a landing is one lookup.",
        code: [
          { file: "Jump.java", body: `public class Jump {
    private final int start;
    private final int end;

    public Jump(int start, int end) {
        if (start == end) throw new IllegalArgumentException("start must differ from end");
        this.start = start;
        this.end = end;
    }

    public int getStart() { return start; }
    public int getEnd() { return end; }
    public boolean isSnake() { return end < start; }
}` },
          { file: "Board.java", body: `import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class Board {
    private final int size;
    private final Map<Integer, Integer> jumps = new HashMap<>();

    public Board(int size, List<Jump> jumpList) {
        this.size = size;
        for (Jump j : jumpList) {
            if (j.getStart() >= size || j.getEnd() > size || j.getStart() <= 0 || j.getEnd() < 0) {
                throw new IllegalArgumentException("Jump out of board bounds");
            }
            if (jumps.putIfAbsent(j.getStart(), j.getEnd()) != null) {
                throw new IllegalArgumentException("Two jumps start at " + j.getStart());
            }
        }
    }

    public int getSize() { return size; }

    // Where does a player end up after landing on this cell?
    public int resolve(int cell) {
        return jumps.getOrDefault(cell, cell);
    }
}` }
        ],
        note: "Validate the layout once in the constructor. After that the game loop can trust the board."
      },
      {
        heading: "Requirement 2: Pluggable dice",
        text: "Hide randomness behind an interface. The game only asks for a number. Tests can inject a fixed sequence for deterministic runs, and a two-dice variant is a new class, not a change to `Game`.",
        code: [
          { file: "Dice.java", body: `public interface Dice {
    int roll();
}` },
          { file: "SingleDice.java", body: `import java.util.concurrent.ThreadLocalRandom;

public class SingleDice implements Dice {
    private final int faces;

    public SingleDice() { this(6); }
    public SingleDice(int faces) { this.faces = faces; }

    @Override
    public int roll() {
        return ThreadLocalRandom.current().nextInt(1, faces + 1);
    }
}` },
          { file: "MultiDice.java", body: `public class MultiDice implements Dice {
    private final Dice[] dice;

    public MultiDice(int count) {
        dice = new Dice[count];
        for (int i = 0; i < count; i++) dice[i] = new SingleDice();
    }

    @Override
    public int roll() {
        int total = 0;
        for (Dice d : dice) total += d.roll();
        return total;
    }
}` }
        ]
      },
      {
        heading: "Requirement 3: Turns, movement and winning",
        text: "`Game` keeps players in a queue. Each turn polls the front player, rolls, computes the target, applies the overshoot rule, resolves any jump, then either declares a winner or puts the player at the back of the queue. The overshoot rule and jump resolution each live in one small method so they are easy to read and test.",
        code: [
          { file: "Player.java", body: `public class Player {
    private final String name;
    private int position;

    public Player(String name) { this.name = name; }

    public String getName() { return name; }
    public int getPosition() { return position; }
    public void setPosition(int position) { this.position = position; }
}` },
          { file: "Game.java", body: `import java.util.ArrayDeque;
import java.util.Deque;
import java.util.List;

public class Game {
    private final Board board;
    private final Dice dice;
    private final Deque<Player> queue;
    private Player winner;

    public Game(Board board, Dice dice, List<Player> players) {
        if (players.size() < 2) throw new IllegalArgumentException("Need at least 2 players");
        this.board = board;
        this.dice = dice;
        this.queue = new ArrayDeque<>(players);
    }

    public Player play() {
        while (winner == null) {
            playTurn();
        }
        return winner;
    }

    void playTurn() {
        Player player = queue.pollFirst();
        int roll = dice.roll();
        int target = player.getPosition() + roll;

        if (target <= board.getSize()) {
            player.setPosition(board.resolve(target));
        }
        // overshoot: stay put

        if (player.getPosition() == board.getSize()) {
            winner = player;
        } else {
            queue.addLast(player);
        }
    }
}` },
          { file: "Demo.java", body: `Board board = new Board(100, List.of(
        new Jump(17, 7),   // snake
        new Jump(54, 34),  // snake
        new Jump(62, 19),  // snake
        new Jump(98, 79),  // snake
        new Jump(3, 38),   // ladder
        new Jump(24, 33),  // ladder
        new Jump(42, 93),  // ladder
        new Jump(72, 84)   // ladder
));

Game game = new Game(board, new SingleDice(),
        List.of(new Player("Asha"), new Player("Ben")));

System.out.println("Winner: " + game.play().getName());` }
        ],
        note: "Resolving a jump once per move is enough because the input guarantees no chained jumps. If chains were allowed, loop on `resolve` until the position stops changing."
      },
      {
        heading: "Requirement 4: Optional rules without rewriting the loop",
        text: "An extra turn on six is a change to what happens after a move, not to how the board or dice work. The simplest approach that does not over-engineer: let `playTurn` return whether the player keeps the turn, and decide that with a small hook.",
        code: [
          { file: "ExtraTurnOnSix.java", body: `// In Game.playTurn, after resolving movement:
//
//   boolean extraTurn = rule.grantsExtraTurn(roll);
//   if (player.getPosition() == board.getSize()) {
//       winner = player;
//   } else if (extraTurn) {
//       queue.addFirst(player);   // same player goes again
//   } else {
//       queue.addLast(player);
//   }

public interface TurnRule {
    boolean grantsExtraTurn(int roll);
}

public class SixGrantsExtraTurn implements TurnRule {
    @Override
    public boolean grantsExtraTurn(int roll) { return roll == 6; }
}

public class NoExtraTurn implements TurnRule {
    @Override
    public boolean grantsExtraTurn(int roll) { return false; }
}` }
        ]
      }
    ],
    deepDive: [
      {
        title: "Testing with deterministic dice",
        text: "Randomness is the enemy of tests. Because `Game` depends on the `Dice` interface, a test can inject a scripted sequence and assert the exact outcome, including snakes, ladders and the overshoot rule.",
        code: [
          { file: "FixedDice.java", body: `import java.util.ArrayDeque;
import java.util.Deque;

public class FixedDice implements Dice {
    private final Deque<Integer> rolls = new ArrayDeque<>();

    public FixedDice(int... values) {
        for (int v : values) rolls.add(v);
    }

    @Override
    public int roll() { return rolls.removeFirst(); }
}` }
        ]
      },
      {
        title: "Chained jumps and cycles",
        text: "If a ladder can end on a snake head, resolving once is not enough. Loop until the cell has no jump. A snake that leads back up to a ladder that leads back to the same snake would loop forever, so validate for cycles when the board is built (follow each jump with a visited set) and reject such layouts."
      }
    ],
    mistakes: [
      "Modelling Snake and Ladder as two separate classes with duplicated logic when they are the same concept.",
      "Calling `Math.random()` directly inside the game, which makes tests flaky.",
      "Forgetting the exact-landing rule, so players overshoot and 'win' past the last cell.",
      "Storing the board as a full array of 100 cells when a map of jumps is all you need.",
      "Forcing a pattern. Design patterns are good to have, but don't force one in just to impress the interviewer; an interface for dice already gives you the flexibility you need."
    ],
    followups: [
      "How would you add a 'bonus move' square or a trap that skips a turn?",
      "How would you support a human player choosing between two dice outcomes?",
      "How would you notify a UI of each move (hint: events)?",
      "How would you validate that a randomly generated board is solvable?"
    ],
    patterns: ["strategy", "observer"]
  },

  /* ------------------------------------------------------------------ */
  {
    id: "lru-cache",
    name: "Design LRU Cache",
    difficulty: "easy",
    understanding: "Design a fixed-capacity cache that evicts the least recently used entry when full. Both `get` and `put` must run in O(1). The classic solution pairs a hash map (for lookup) with a doubly linked list (for recency order). A strong answer also makes eviction pluggable and discusses thread safety.",
    dialogue: [
      { who: "you", text: "What operations do we need, and what are the performance targets?" },
      { who: "int", text: "get(key) and put(key, value), both O(1) on average." },
      { who: "you", text: "What does get return on a miss, and does a get count as a use?" },
      { who: "int", text: "Return null (or an Optional) on a miss. Yes, a hit makes that key the most recently used." },
      { who: "you", text: "What happens when we put a key that already exists?" },
      { who: "int", text: "Update the value and mark it most recently used. No eviction." },
      { who: "you", text: "Is the cache generic over key and value types, and is the capacity fixed at construction?" },
      { who: "int", text: "Generic, capacity fixed at construction." },
      { who: "you", text: "Will multiple threads share it?" },
      { who: "int", text: "Start single-threaded, then tell me how you'd make it thread-safe." },
      { who: "you", text: "Might product ask for other eviction policies later, like LFU or FIFO?" },
      { who: "int", text: "Possibly. Design so it is not painful." }
    ],
    requirements: [
      { group: "Core", items: [
        "Fixed capacity chosen at construction.",
        "`get(key)` returns the value or nothing, and marks a hit as most recently used.",
        "`put(key, value)` inserts or updates and marks the key most recently used.",
        "When a new key is inserted into a full cache, the least recently used key is evicted.",
        "`get` and `put` run in O(1) average time."
      ] },
      { group: "Concurrency", items: [
        "The cache can be shared safely by multiple threads.",
        "Concurrent reads must not corrupt the recency order."
      ] },
      { group: "Extensibility", items: [
        "The cache is generic over key and value types.",
        "The eviction policy is pluggable (LRU, LFU, FIFO)."
      ] }
    ],
    entities: [
      { name: "Cache<K, V>", text: "The public interface: get, put, size." },
      { name: "Node<K, V>", text: "A doubly linked list node holding a key, a value and prev/next pointers." },
      { name: "LRUCache<K, V>", text: "A hash map from key to node plus a doubly linked list ordered by recency." },
      { name: "EvictionPolicy<K>", text: "Decides which key to remove and is told about accesses and insertions." }
    ],
    design: [
      {
        heading: "Requirement 1: O(1) lookup and O(1) recency updates",
        text: "A hash map alone gives O(1) lookup but no order. A list alone gives order but O(N) lookup. Combine them: the map points straight at list nodes. The list is ordered most recent at the head, least recent at the tail. Moving a node to the head or removing the tail node is O(1) because it is doubly linked and we already hold the node reference.\n\nSentinel head and tail nodes remove all the null-checking edge cases when the list is empty or has one element.",
        code: [
          { file: "Node.java", body: `class Node<K, V> {
    final K key;
    V value;
    Node<K, V> prev;
    Node<K, V> next;

    Node(K key, V value) {
        this.key = key;
        this.value = value;
    }
}` },
          { file: "LRUCache.java", body: `import java.util.HashMap;
import java.util.Map;

public class LRUCache<K, V> {
    private final int capacity;
    private final Map<K, Node<K, V>> map = new HashMap<>();
    private final Node<K, V> head = new Node<>(null, null); // most recent after head
    private final Node<K, V> tail = new Node<>(null, null); // least recent before tail

    public LRUCache(int capacity) {
        if (capacity <= 0) throw new IllegalArgumentException("capacity must be > 0");
        this.capacity = capacity;
        head.next = tail;
        tail.prev = head;
    }

    public V get(K key) {
        Node<K, V> node = map.get(key);
        if (node == null) return null;
        moveToFront(node);
        return node.value;
    }

    public void put(K key, V value) {
        Node<K, V> node = map.get(key);
        if (node != null) {
            node.value = value;
            moveToFront(node);
            return;
        }
        if (map.size() == capacity) {
            evictLeastRecent();
        }
        Node<K, V> fresh = new Node<>(key, value);
        map.put(key, fresh);
        addToFront(fresh);
    }

    public int size() { return map.size(); }

    private void evictLeastRecent() {
        Node<K, V> lru = tail.prev;
        remove(lru);
        map.remove(lru.key);
    }

    private void moveToFront(Node<K, V> node) {
        remove(node);
        addToFront(node);
    }

    private void addToFront(Node<K, V> node) {
        node.next = head.next;
        node.prev = head;
        head.next.prev = node;
        head.next = node;
    }

    private void remove(Node<K, V> node) {
        node.prev.next = node.next;
        node.next.prev = node.prev;
    }
}` }
        ],
        note: "The node stores its own key. When evicting from the tail you only have the node, and you need the key to delete the map entry."
      },
      {
        heading: "Requirement 2: Make eviction pluggable",
        text: "The cache has two jobs: store values and decide what to throw away. Pull the second out behind an interface. The cache tells the policy about hits and inserts and asks it for a victim when full. LRU keeps the recency list inside the policy; LFU would keep frequency buckets there instead.\n\nA word of caution for interviews: build the simple version first, then show this refactor when the interviewer asks for it. Do not start here.",
        code: [
          { file: "EvictionPolicy.java", body: `public interface EvictionPolicy<K> {
    void onAccess(K key);   // key was read or updated
    void onInsert(K key);   // key was newly added
    void onRemove(K key);   // key was removed
    K evict();              // choose and forget a victim key
}` },
          { file: "LruPolicy.java", body: `import java.util.LinkedHashSet;

public class LruPolicy<K> implements EvictionPolicy<K> {
    // Iteration order = insertion order; re-adding moves a key to the end.
    private final LinkedHashSet<K> order = new LinkedHashSet<>();

    @Override public void onAccess(K key) { order.remove(key); order.add(key); }
    @Override public void onInsert(K key) { order.add(key); }
    @Override public void onRemove(K key) { order.remove(key); }

    @Override
    public K evict() {
        K victim = order.iterator().next(); // oldest
        order.remove(victim);
        return victim;
    }
}` },
          { file: "PolicyCache.java", body: `import java.util.HashMap;
import java.util.Map;

public class PolicyCache<K, V> {
    private final int capacity;
    private final Map<K, V> store = new HashMap<>();
    private final EvictionPolicy<K> policy;

    public PolicyCache(int capacity, EvictionPolicy<K> policy) {
        this.capacity = capacity;
        this.policy = policy;
    }

    public V get(K key) {
        V value = store.get(key);
        if (value != null) policy.onAccess(key);
        return value;
    }

    public void put(K key, V value) {
        if (store.containsKey(key)) {
            store.put(key, value);
            policy.onAccess(key);
            return;
        }
        if (store.size() == capacity) {
            K victim = policy.evict();
            store.remove(victim);
        }
        store.put(key, value);
        policy.onInsert(key);
    }
}` }
        ]
      },
      {
        heading: "Requirement 3: Thread safety",
        text: "Even `get` mutates the list (it moves a node), so a read/write lock does not help: every operation is a write. The simplest correct approach is to guard each public method with one lock. That is almost always the right answer for an interview and often in production for a small cache.",
        code: [
          { file: "SynchronizedLRUCache.java", body: `import java.util.concurrent.locks.ReentrantLock;

public class SynchronizedLRUCache<K, V> {
    private final LRUCache<K, V> delegate;
    private final ReentrantLock lock = new ReentrantLock();

    public SynchronizedLRUCache(int capacity) {
        this.delegate = new LRUCache<>(capacity);
    }

    public V get(K key) {
        lock.lock();
        try {
            return delegate.get(key);
        } finally {
            lock.unlock();
        }
    }

    public void put(K key, V value) {
        lock.lock();
        try {
            delegate.put(key, value);
        } finally {
            lock.unlock();
        }
    }
}` },
          { file: "Demo.java", body: `LRUCache<String, Integer> cache = new LRUCache<>(2);
cache.put("a", 1);
cache.put("b", 2);
cache.get("a");        // a is now most recent
cache.put("c", 3);     // evicts b
System.out.println(cache.get("b")); // null
System.out.println(cache.get("a")); // 1` }
        ]
      }
    ],
    deepDive: [
      {
        title: "Reducing lock contention",
        text: "One global lock serialises all access. If the cache is hot, shard it: hash each key to one of N independent LRU segments, each with its own lock. Recency is then approximate across the whole cache but exact within a segment, which is the trade-off most production caches (Guava, Caffeine) accept. A further option is to buffer access events and apply recency updates in batches, so `get` rarely needs the lock for long."
      },
      {
        title: "The one-liner and why not to stop there",
        text: "Java's `LinkedHashMap` with access order gives you an LRU in a few lines. Mentioning it shows you know the library, but the interviewer wants to see the underlying structure, so build the map plus doubly linked list and then note the shortcut.",
        code: [
          { file: "LinkedHashMapLRU.java", body: `import java.util.LinkedHashMap;
import java.util.Map;

public class LinkedHashMapLRU<K, V> extends LinkedHashMap<K, V> {
    private final int capacity;

    public LinkedHashMapLRU(int capacity) {
        super(16, 0.75f, true); // true = access order
        this.capacity = capacity;
    }

    @Override
    protected boolean removeEldestEntry(Map.Entry<K, V> eldest) {
        return size() > capacity;
    }
}` }
        ]
      }
    ],
    mistakes: [
      "Using only a list (O(N) lookup) or only a map (no recency order).",
      "A singly linked list, which makes removing an arbitrary node O(N).",
      "Forgetting to store the key in the node, so you cannot remove the map entry on eviction.",
      "Not updating recency on a `put` of an existing key.",
      "Using a read/write lock; `get` modifies the list, so it is not a pure read.",
      "Forcing a pattern up front. Design patterns are good to have, but don't force one in just to impress the interviewer. Start with the data structure, then extract the policy if asked."
    ],
    followups: [
      "How would you add TTL (time-based expiry) to entries?",
      "How would you implement LFU with O(1) operations?",
      "How would you make this a distributed cache?",
      "How would you add cache statistics (hit rate)?"
    ],
    patterns: ["strategy"]
  },

  /* ------------------------------------------------------------------ */
  {
    id: "parking-lot",
    name: "Design Parking Lot",
    difficulty: "easy",
    understanding: "Design a multi-floor parking lot that accepts different vehicle types, assigns a suitable spot at entry, issues a ticket and charges a fee at exit. The core is modelling vehicles, spots and tickets cleanly, then keeping spot allocation and pricing swappable so the rules can change without touching the lot itself.",
    dialogue: [
      { who: "you", text: "What kinds of vehicles do we park, and are there different spot sizes?" },
      { who: "int", text: "Motorcycles, cars and trucks. Spots come in small, medium and large sizes." },
      { who: "you", text: "Can a smaller vehicle use a bigger spot if its own size is full?" },
      { who: "int", text: "Yes. A motorcycle can take any spot, a car medium or large, a truck only large." },
      { who: "you", text: "Is there a single lot with multiple floors, and are there multiple entry and exit gates?" },
      { who: "int", text: "One lot, multiple floors, multiple gates. Keep gates simple for now." },
      { who: "you", text: "How do we decide which spot to give a vehicle?" },
      { who: "int", text: "Start with the first available suitable spot, but we may want nearest-to-entrance later." },
      { who: "you", text: "How is the fee calculated?" },
      { who: "int", text: "Hourly rate, different per vehicle type. Might become flat-rate or time-of-day pricing." },
      { who: "you", text: "What happens when the lot is full?" },
      { who: "int", text: "Reject the entry with a clear message. No waiting list." },
      { who: "you", text: "Do we need payment processing and a UI?" },
      { who: "int", text: "No. Compute the fee and mark the ticket paid; skip real payment integration." }
    ],
    requirements: [
      { group: "Core", items: [
        "A lot has multiple floors, each with spots of small, medium and large sizes.",
        "On entry, find a suitable free spot for the vehicle, mark it occupied and issue a ticket.",
        "A vehicle may use any free spot at least as large as it needs.",
        "On exit, calculate the fee from the parked duration and vehicle type, then free the spot.",
        "Reject entry when no suitable spot is free."
      ] },
      { group: "Concurrency", items: [
        "Two vehicles entering at different gates at the same time must never be assigned the same spot."
      ] },
      { group: "Extensibility", items: [
        "The spot allocation rule can change (first available, nearest to entrance).",
        "The pricing rule can change (hourly, flat, time-of-day) without modifying the lot.",
        "New vehicle types and spot sizes can be added."
      ] }
    ],
    entities: [
      { name: "Vehicle", text: "A licence plate and a VehicleType (MOTORCYCLE, CAR, TRUCK)." },
      { name: "ParkingSpot", text: "An id, a SpotSize and an occupied flag. Knows whether a vehicle fits." },
      { name: "ParkingFloor", text: "A numbered level holding spots." },
      { name: "Ticket", text: "Links a vehicle to a spot with an entry time (and later exit time and fee)." },
      { name: "SpotAllocationStrategy", text: "Chooses a free spot for a vehicle." },
      { name: "PricingStrategy", text: "Computes the fee for a ticket." },
      { name: "ParkingLot", text: "The facade: park(vehicle) returns a ticket, unpark(ticket) returns the fee." }
    ],
    design: [
      {
        heading: "Requirement 1: Vehicles, spots and fit rules",
        text: "Put the 'can this vehicle fit here?' rule where the knowledge lives. Each `VehicleType` declares the minimum spot size it needs; a spot is suitable when it is free and at least that big. Using enum ordering (SMALL < MEDIUM < LARGE) makes the comparison one line and adding a size is one enum value.",
        code: [
          { file: "VehicleType.java", body: `public enum VehicleType {
    MOTORCYCLE(SpotSize.SMALL),
    CAR(SpotSize.MEDIUM),
    TRUCK(SpotSize.LARGE);

    private final SpotSize minimumSize;

    VehicleType(SpotSize minimumSize) { this.minimumSize = minimumSize; }

    public SpotSize getMinimumSize() { return minimumSize; }
}` },
          { file: "SpotSize.java", body: `public enum SpotSize { SMALL, MEDIUM, LARGE }` },
          { file: "Vehicle.java", body: `public class Vehicle {
    private final String plate;
    private final VehicleType type;

    public Vehicle(String plate, VehicleType type) {
        this.plate = plate;
        this.type = type;
    }

    public String getPlate() { return plate; }
    public VehicleType getType() { return type; }
}` },
          { file: "ParkingSpot.java", body: `public class ParkingSpot {
    private final String id;
    private final int floor;
    private final SpotSize size;
    private boolean occupied;

    public ParkingSpot(String id, int floor, SpotSize size) {
        this.id = id;
        this.floor = floor;
        this.size = size;
    }

    public boolean canFit(Vehicle vehicle) {
        return !occupied && size.compareTo(vehicle.getType().getMinimumSize()) >= 0;
    }

    public void occupy() { occupied = true; }
    public void release() { occupied = false; }

    public String getId() { return id; }
    public int getFloor() { return floor; }
    public SpotSize getSize() { return size; }
    public boolean isOccupied() { return occupied; }
}` }
        ]
      },
      {
        heading: "Requirement 2: Allocate a spot and issue a ticket",
        text: "Searching for a spot is a policy that will change, so hide it behind `SpotAllocationStrategy`. The default scans floors in order and returns the best-fitting free spot (smallest sufficient size, which avoids wasting large spots on motorcycles). Nearest-to-entrance would be a second implementation.",
        code: [
          { file: "ParkingFloor.java", body: `import java.util.List;

public class ParkingFloor {
    private final int number;
    private final List<ParkingSpot> spots;

    public ParkingFloor(int number, List<ParkingSpot> spots) {
        this.number = number;
        this.spots = spots;
    }

    public int getNumber() { return number; }
    public List<ParkingSpot> getSpots() { return spots; }
}` },
          { file: "SpotAllocationStrategy.java", body: `import java.util.List;
import java.util.Optional;

public interface SpotAllocationStrategy {
    Optional<ParkingSpot> findSpot(List<ParkingFloor> floors, Vehicle vehicle);
}` },
          { file: "BestFitAllocation.java", body: `import java.util.Comparator;
import java.util.List;
import java.util.Optional;

public class BestFitAllocation implements SpotAllocationStrategy {
    @Override
    public Optional<ParkingSpot> findSpot(List<ParkingFloor> floors, Vehicle vehicle) {
        // Lowest floor first, then the smallest spot that still fits.
        return floors.stream()
                .flatMap(f -> f.getSpots().stream())
                .filter(s -> s.canFit(vehicle))
                .min(Comparator.comparingInt(ParkingSpot::getFloor)
                        .thenComparing(ParkingSpot::getSize));
    }
}` },
          { file: "Ticket.java", body: `import java.time.Instant;
import java.util.UUID;

public class Ticket {
    private final String id = UUID.randomUUID().toString();
    private final Vehicle vehicle;
    private final ParkingSpot spot;
    private final Instant entryTime;

    public Ticket(Vehicle vehicle, ParkingSpot spot, Instant entryTime) {
        this.vehicle = vehicle;
        this.spot = spot;
        this.entryTime = entryTime;
    }

    public String getId() { return id; }
    public Vehicle getVehicle() { return vehicle; }
    public ParkingSpot getSpot() { return spot; }
    public Instant getEntryTime() { return entryTime; }
}` }
        ],
        note: "Return `Optional` rather than null so 'lot is full' is impossible to forget to handle."
      },
      {
        heading: "Requirement 3: Pricing at exit",
        text: "Pricing is the second thing that changes independently, so it gets its own strategy. The ticket holds facts (entry time, vehicle); the strategy turns facts into money. Charge by started hour so 61 minutes costs two hours.",
        code: [
          { file: "PricingStrategy.java", body: `import java.time.Instant;

public interface PricingStrategy {
    long feeFor(Ticket ticket, Instant exitTime);
}` },
          { file: "HourlyPricing.java", body: `import java.time.Duration;
import java.time.Instant;
import java.util.Map;

public class HourlyPricing implements PricingStrategy {
    private final Map<VehicleType, Long> ratePerHour;

    public HourlyPricing(Map<VehicleType, Long> ratePerHour) {
        this.ratePerHour = ratePerHour;
    }

    @Override
    public long feeFor(Ticket ticket, Instant exitTime) {
        long minutes = Duration.between(ticket.getEntryTime(), exitTime).toMinutes();
        long hours = Math.max(1, (minutes + 59) / 60); // round up, minimum one hour
        return hours * ratePerHour.get(ticket.getVehicle().getType());
    }
}` }
        ]
      },
      {
        heading: "Requirement 4: The ParkingLot facade and concurrency",
        text: "`ParkingLot` ties it together: park finds a spot, occupies it and issues a ticket; unpark computes the fee and frees the spot. Finding and occupying a spot must be one atomic step, otherwise two gates can both find the same free spot before either marks it taken. A single lock around allocation is simple and correct for one lot.",
        code: [
          { file: "ParkingLot.java", body: `import java.time.Instant;
import java.util.List;
import java.util.Optional;

public class ParkingLot {
    private final List<ParkingFloor> floors;
    private final SpotAllocationStrategy allocation;
    private final PricingStrategy pricing;

    public ParkingLot(List<ParkingFloor> floors,
                      SpotAllocationStrategy allocation,
                      PricingStrategy pricing) {
        this.floors = floors;
        this.allocation = allocation;
        this.pricing = pricing;
    }

    // find + occupy must be atomic across gates
    public synchronized Ticket park(Vehicle vehicle) {
        Optional<ParkingSpot> spot = allocation.findSpot(floors, vehicle);
        if (spot.isEmpty()) {
            throw new IllegalStateException("Parking lot is full for " + vehicle.getType());
        }
        spot.get().occupy();
        return new Ticket(vehicle, spot.get(), Instant.now());
    }

    public synchronized long unpark(Ticket ticket) {
        long fee = pricing.feeFor(ticket, Instant.now());
        ticket.getSpot().release();
        return fee;
    }
}` },
          { file: "Demo.java", body: `ParkingFloor ground = new ParkingFloor(0, List.of(
        new ParkingSpot("G1", 0, SpotSize.SMALL),
        new ParkingSpot("G2", 0, SpotSize.MEDIUM),
        new ParkingSpot("G3", 0, SpotSize.LARGE)));

ParkingLot lot = new ParkingLot(List.of(ground),
        new BestFitAllocation(),
        new HourlyPricing(Map.of(
                VehicleType.MOTORCYCLE, 10L,
                VehicleType.CAR, 20L,
                VehicleType.TRUCK, 40L)));

Ticket t = lot.park(new Vehicle("KA-01-1234", VehicleType.CAR)); // takes G2
long fee = lot.unpark(t);` }
        ],
        note: "A double unpark would release a spot that may already belong to someone else. Production code should mark the ticket as closed and reject a second use."
      }
    ],
    deepDive: [
      {
        title: "Scaling allocation beyond a linear scan",
        text: "Scanning every spot on every entry is O(total spots). For a real lot keep a free-spot index per size (a queue or sorted set per `SpotSize`, per floor). Allocation becomes 'poll the smallest sufficient size', and release adds the spot back. A single lock around these structures is still cheap because each operation is O(1) or O(log N)."
      },
      {
        title: "Finer-grained locking",
        text: "A global lock serialises all gates. If contention matters, lock per size-queue, or use an atomic compare-and-set on each spot's occupied flag: the allocation strategy proposes a spot, and `park` claims it with `compareAndSet(false, true)`, retrying with another candidate on failure.",
        code: [
          { file: "ParkingSpot.java (CAS claim)", body: `import java.util.concurrent.atomic.AtomicBoolean;

// Replace the boolean with:
private final AtomicBoolean occupied = new AtomicBoolean(false);

public boolean tryOccupy() {
    return occupied.compareAndSet(false, true);
}

public void release() { occupied.set(false); }` }
        ]
      }
    ],
    mistakes: [
      "Hard-coding pricing and spot choice inside `ParkingLot`, so every rule change edits the core class.",
      "Returning the first free spot regardless of size, which wastes large spots on motorcycles.",
      "Separate find and occupy steps without a lock, allowing double allocation.",
      "Using `null` for 'lot full' instead of `Optional` or an exception.",
      "Forcing patterns everywhere. Design patterns are good to have, but don't force one in just to impress the interviewer; Strategy earns its place here because two rules genuinely vary."
    ],
    followups: [
      "How would you add EV charging spots that only electric cars may use?",
      "How would you support multiple entry and exit gates with separate displays?",
      "How would you add monthly pass holders with different pricing?",
      "How would you show 'spots available per floor' on a display board (hint: observer)?"
    ],
    patterns: ["strategy", "observer", "singleton"]
  },

  /* ------------------------------------------------------------------ */
  {
    id: "task-management-system",
    name: "Design Task Management System",
    difficulty: "easy",
    understanding: "Design a Trello or Jira-lite task manager where users create tasks, assign them, move them through statuses and search or filter them. The design is mostly about modelling tasks and their lifecycle well, then keeping filtering and notifications open to extension without bloating the core service.",
    dialogue: [
      { who: "you", text: "What does a task contain, and who can create one?" },
      { who: "int", text: "Title, description, priority, due date, status and an assignee. Any user can create tasks." },
      { who: "you", text: "What statuses exist, and are transitions restricted?" },
      { who: "int", text: "TODO, IN_PROGRESS, IN_REVIEW and DONE. Don't allow arbitrary jumps: you can't go from TODO straight to DONE." },
      { who: "you", text: "Can a task be reassigned, and can it have multiple assignees?" },
      { who: "int", text: "One assignee at a time, reassignable." },
      { who: "you", text: "How do users find tasks: by status, assignee, priority, due date?" },
      { who: "int", text: "All of those, and combinations. For example high-priority tasks assigned to me that are not done." },
      { who: "you", text: "Do we need subtasks, comments or projects?" },
      { who: "int", text: "Keep subtasks and comments out of scope, but make sure we could add them." },
      { who: "you", text: "Should anyone be notified when a task changes?" },
      { who: "int", text: "Notify the assignee on assignment and status change. The channel (email, push) should be swappable." },
      { who: "you", text: "Persistence and authentication?" },
      { who: "int", text: "In-memory is fine. Assume the caller is already authenticated." }
    ],
    requirements: [
      { group: "Core", items: [
        "Users can create tasks with title, description, priority and optional due date.",
        "A task has exactly one assignee at a time and can be reassigned.",
        "A task moves through TODO, IN_PROGRESS, IN_REVIEW, DONE; only valid transitions are allowed.",
        "Tasks can be listed filtered by status, assignee, priority and due date, alone or in combination.",
        "Tasks can be listed sorted by priority or due date."
      ] },
      { group: "Extensibility", items: [
        "New filter criteria can be added without modifying the service.",
        "The assignee is notified on assignment and status change, through a pluggable channel.",
        "Subtasks and comments can be added later without redesigning Task."
      ] }
    ],
    entities: [
      { name: "User", text: "An id and a name." },
      { name: "Task", text: "Owns its fields and enforces its own lifecycle rules." },
      { name: "TaskStatus", text: "An enum with the allowed next statuses of each state." },
      { name: "Priority", text: "An enum: LOW, MEDIUM, HIGH." },
      { name: "TaskFilter", text: "A predicate over tasks that can be combined with AND." },
      { name: "TaskListener", text: "Receives task events such as assigned or status changed." },
      { name: "TaskService", text: "The facade for create, assign, update status and search." }
    ],
    design: [
      {
        heading: "Requirement 1: Model tasks and users",
        text: "Keep `Task` a real object with behaviour, not a bag of getters and setters. The fields that must not change freely (status, assignee) are only changed through methods that enforce the rules. Give each task an id and creation time, and use the builder style for the many optional fields.",
        code: [
          { file: "Priority.java", body: `public enum Priority { LOW, MEDIUM, HIGH }` },
          { file: "User.java", body: `public class User {
    private final String id;
    private final String name;

    public User(String id, String name) {
        this.id = id;
        this.name = name;
    }

    public String getId() { return id; }
    public String getName() { return name; }
}` },
          { file: "Task.java", body: `import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

public class Task {
    private final String id = UUID.randomUUID().toString();
    private final Instant createdAt = Instant.now();
    private String title;
    private String description;
    private Priority priority;
    private LocalDate dueDate;     // may be null
    private TaskStatus status = TaskStatus.TODO;
    private User assignee;         // may be null until assigned

    public Task(String title, String description, Priority priority, LocalDate dueDate) {
        if (title == null || title.isBlank()) throw new IllegalArgumentException("title required");
        this.title = title;
        this.description = description;
        this.priority = priority;
        this.dueDate = dueDate;
    }

    public String getId() { return id; }
    public String getTitle() { return title; }
    public String getDescription() { return description; }
    public Priority getPriority() { return priority; }
    public LocalDate getDueDate() { return dueDate; }
    public TaskStatus getStatus() { return status; }
    public User getAssignee() { return assignee; }
    public Instant getCreatedAt() { return createdAt; }

    void setAssignee(User assignee) { this.assignee = assignee; }
    void setStatus(TaskStatus status) { this.status = status; }
}` }
        ]
      },
      {
        heading: "Requirement 2: Valid status transitions",
        text: "Instead of a web of if/else checks, let each status declare where it may go next. The rule is data, so adding a state (BLOCKED) or relaxing a transition is a one-line change. The task asks its status whether the move is legal.",
        code: [
          { file: "TaskStatus.java", body: `import java.util.EnumSet;
import java.util.Set;

public enum TaskStatus {
    TODO, IN_PROGRESS, IN_REVIEW, DONE;

    private Set<TaskStatus> next;

    static {
        TODO.next = EnumSet.of(IN_PROGRESS);
        IN_PROGRESS.next = EnumSet.of(TODO, IN_REVIEW);
        IN_REVIEW.next = EnumSet.of(IN_PROGRESS, DONE);
        DONE.next = EnumSet.noneOf(TaskStatus.class);
    }

    public boolean canMoveTo(TaskStatus target) {
        return next.contains(target);
    }
}` },
          { file: "TaskService.java (status)", body: `public void updateStatus(String taskId, TaskStatus target) {
    Task task = getTask(taskId);
    TaskStatus before = task.getStatus();
    if (!before.canMoveTo(target)) {
        throw new IllegalStateException("Cannot move " + before + " -> " + target);
    }
    task.setStatus(target);
    listeners.forEach(l -> l.onStatusChanged(task, before, target));
}` }
        ],
        note: "If transitions later carry behaviour (auto-assign reviewer on IN_REVIEW), that is the point to promote each status to a State object. Until then, an enum with a transition table is simpler."
      },
      {
        heading: "Requirement 3: Flexible filtering and sorting",
        text: "Searches combine arbitrary criteria. A `TaskFilter` is just a predicate with an `and` combinator, so callers build the query they need and the service never changes when a new criterion appears. Sorting is a `Comparator`.",
        code: [
          { file: "TaskFilter.java", body: `import java.time.LocalDate;
import java.util.function.Predicate;

public interface TaskFilter extends Predicate<Task> {

    static TaskFilter byStatus(TaskStatus status) {
        return t -> t.getStatus() == status;
    }

    static TaskFilter byAssignee(User user) {
        return t -> t.getAssignee() != null
                && t.getAssignee().getId().equals(user.getId());
    }

    static TaskFilter byPriority(Priority priority) {
        return t -> t.getPriority() == priority;
    }

    static TaskFilter dueBefore(LocalDate date) {
        return t -> t.getDueDate() != null && t.getDueDate().isBefore(date);
    }

    default TaskFilter and(TaskFilter other) {
        return t -> this.test(t) && other.test(t);
    }
}` },
          { file: "TaskService.java (search)", body: `import java.util.Comparator;
import java.util.List;
import java.util.stream.Collectors;

public List<Task> search(TaskFilter filter, Comparator<Task> order) {
    return tasks.values().stream()
            .filter(filter)
            .sorted(order)
            .collect(Collectors.toList());
}

// Usage: high-priority tasks assigned to me that are not done
// service.search(
//     TaskFilter.byAssignee(me).and(TaskFilter.byPriority(Priority.HIGH)),
//     Comparator.comparing(Task::getDueDate, Comparator.nullsLast(Comparator.naturalOrder())));` }
        ]
      },
      {
        heading: "Requirement 4: Assignment and notifications",
        text: "When a task is assigned or changes status, other parts of the system (email, push, activity log) may need to react. The service should not know about any of them. It publishes events to registered `TaskListener`s. A new channel is a new listener, with no change to `TaskService`.",
        code: [
          { file: "TaskListener.java", body: `public interface TaskListener {
    void onAssigned(Task task, User assignee);
    void onStatusChanged(Task task, TaskStatus from, TaskStatus to);
}` },
          { file: "EmailNotifier.java", body: `public class EmailNotifier implements TaskListener {
    @Override
    public void onAssigned(Task task, User assignee) {
        System.out.println("Email to " + assignee.getName()
                + ": you were assigned '" + task.getTitle() + "'");
    }

    @Override
    public void onStatusChanged(Task task, TaskStatus from, TaskStatus to) {
        if (task.getAssignee() != null) {
            System.out.println("Email to " + task.getAssignee().getName()
                    + ": '" + task.getTitle() + "' moved " + from + " -> " + to);
        }
    }
}` },
          { file: "TaskService.java", body: `import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.NoSuchElementException;

public class TaskService {
    private final Map<String, Task> tasks = new HashMap<>();
    private final List<TaskListener> listeners = new ArrayList<>();

    public void addListener(TaskListener listener) { listeners.add(listener); }

    public Task createTask(String title, String description,
                           Priority priority, java.time.LocalDate dueDate) {
        Task task = new Task(title, description, priority, dueDate);
        tasks.put(task.getId(), task);
        return task;
    }

    public void assign(String taskId, User user) {
        Task task = getTask(taskId);
        task.setAssignee(user);
        listeners.forEach(l -> l.onAssigned(task, user));
    }

    private Task getTask(String taskId) {
        Task task = tasks.get(taskId);
        if (task == null) throw new NoSuchElementException("No task " + taskId);
        return task;
    }

    // updateStatus and search shown above
}` }
        ]
      }
    ],
    deepDive: [
      {
        title: "Making room for subtasks and comments",
        text: "Subtasks are tasks that reference a parent, so add an optional `parentId` (or a list of child tasks) rather than a new entity; the status rule can then require all children to be DONE before a parent may be. Comments are a separate `Comment` entity keyed by task id, so `Task` does not grow. This is a good place to mention the Composite pattern if subtasks may nest arbitrarily, while noting you would not build it until asked."
      },
      {
        title: "Concurrency and persistence",
        text: "With the in-memory map, two users updating the same task at once can race. Use a `ConcurrentHashMap` and synchronise on the task (or use `compute`) for status changes, so the check-then-set of a transition is atomic. With a database, use optimistic locking: a version column on the task row, and reject an update whose version has moved, which is cheaper than holding locks during a long edit."
      }
    ],
    mistakes: [
      "Public setters on `Task`, so any caller can jump TODO to DONE and bypass the rules.",
      "One `search` method per filter combination (`findByStatusAndAssignee`...). It explodes; use composable filters.",
      "Having `TaskService` send emails directly, coupling the core to one channel.",
      "A long chain of status if/else instead of a transition table.",
      "Forcing a pattern for show. Design patterns are good to have, but don't force one in just to impress the interviewer; here the listener interface and filter predicates earn their keep because they genuinely vary."
    ],
    followups: [
      "How would you add recurring tasks?",
      "How would you add projects and boards with permissions?",
      "How would you support undo of a status change?",
      "How would you send a reminder when a due date is near?"
    ],
    patterns: ["observer", "strategy", "state", "composite"]
  }
);
