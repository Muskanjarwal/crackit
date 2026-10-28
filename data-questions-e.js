window.QUESTIONS = window.QUESTIONS || [];
window.QUESTIONS.push(
  {
    id: "spotify",
    name: "Design Spotify",
    difficulty: "hard",
    understanding: "A music streaming service lets users search a catalogue, build playlists and play tracks through a player that supports queueing, shuffle and repeat. In an LLD round the audio streaming itself is out of scope. The hard part is modelling the catalogue, the player state machine and the swappable behaviours (play order, recommendations) cleanly.",
    dialogue: [
      { who: "you", text: "Spotify is huge. Which parts should I focus on: catalogue, playlists, the player, recommendations?" },
      { who: "int", text: "Catalogue search, user playlists, and the player with queue, shuffle and repeat. Add a simple recommendation feature at the end." },
      { who: "you", text: "Do I need to design audio streaming, DRM or the CDN?" },
      { who: "int", text: "No. Assume a `Song` knows its stream URL and a playback engine can play it." },
      { who: "you", text: "Is playback per user, or can one account play on several devices?" },
      { who: "int", text: "One active player per user. Starting playback on a second device stops the first." },
      { who: "you", text: "Should other parts of the system react to plays, like recently played and play counts?" },
      { who: "int", text: "Yes. The player shouldn't know about those features." },
      { who: "you", text: "And play order: sequential, shuffle, repeat-one, repeat-all?" },
      { who: "int", text: "All four, and we may add more later." }
    ],
    requirements: [
      { group: "Core", items: [
        "Search songs, albums and artists by text.",
        "Users create, edit and delete playlists of songs.",
        "A player plays, pauses, resumes, skips and goes back through a queue.",
        "The player supports sequential, shuffle, repeat-one and repeat-all modes.",
        "Users can like songs, and the system can suggest songs."
      ] },
      { group: "Concurrency", items: [
        "A user has only one active player across devices.",
        "Playlist edits from several devices must not corrupt the playlist."
      ] },
      { group: "Extensibility", items: [
        "New play orders and new recommendation algorithms can be added without touching the player.",
        "New features can react to playback events (history, analytics) without modifying the player."
      ] }
    ],
    entities: [
      { name: "Song", text: "A playable track with title, duration, artist and album." },
      { name: "Artist / Album", text: "Catalogue grouping. An album has many songs, an artist has many albums." },
      { name: "User", text: "Owns playlists and liked songs." },
      { name: "Playlist", text: "An ordered list of songs owned by a user." },
      { name: "Player", text: "Plays a queue of songs and owns the player state." },
      { name: "PlayOrderStrategy", text: "Decides the next and previous song for the active mode." },
      { name: "PlaybackListener", text: "Observer notified about player events." },
      { name: "RecommendationStrategy", text: "Produces suggested songs for a user." },
      { name: "MusicCatalog", text: "Stores and searches songs, albums and artists." }
    ],
    design: [
      {
        heading: "Requirement 1: Search the catalogue",
        text: "`Song`, `Album` and `Artist` are plain data holders. `MusicCatalog` owns the collections and the search. Keep search behind a method so you can swap the in-memory scan for an inverted index later.",
        code: [
          { file: "Song.java", body: `public class Song {
    private final String id;
    private final String title;
    private final Artist artist;
    private final Album album;
    private final int durationSeconds;

    public Song(String id, String title, Artist artist, Album album, int durationSeconds) {
        this.id = id;
        this.title = title;
        this.artist = artist;
        this.album = album;
        this.durationSeconds = durationSeconds;
    }

    public String getId() { return id; }
    public String getTitle() { return title; }
    public Artist getArtist() { return artist; }
    public Album getAlbum() { return album; }
    public int getDurationSeconds() { return durationSeconds; }
}` },
          { file: "Artist.java", body: `public class Artist {
    private final String id;
    private final String name;

    public Artist(String id, String name) {
        this.id = id;
        this.name = name;
    }

    public String getId() { return id; }
    public String getName() { return name; }
}` },
          { file: "MusicCatalog.java", body: `import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

public class MusicCatalog {
    private final Map<String, Song> songs = new ConcurrentHashMap<>();

    public void addSong(Song song) {
        songs.put(song.getId(), song);
    }

    public List<Song> searchSongs(String query) {
        String q = query.toLowerCase();
        return songs.values().stream()
            .filter(s -> s.getTitle().toLowerCase().contains(q)
                      || s.getArtist().getName().toLowerCase().contains(q)
                      || s.getAlbum().getTitle().toLowerCase().contains(q))
            .collect(Collectors.toList());
    }

    public Optional<Song> findById(String id) {
        return Optional.ofNullable(songs.get(id));
    }
}` }
        ],
        note: "A `Playlist` holds `Song` references, not copies, so edits to catalogue metadata show up everywhere."
      },
      {
        heading: "Requirement 2: Playlists and the user library",
        text: "A playlist is an ordered list owned by one user. Guard mutations so two devices editing at once can't interleave and corrupt the order. A per-playlist lock is enough because playlists are small and edits are rare.",
        code: [
          { file: "Playlist.java", body: `import java.util.*;

public class Playlist {
    private final String id;
    private final User owner;
    private String name;
    private final List<Song> songs = new ArrayList<>();

    public Playlist(String id, String name, User owner) {
        this.id = id;
        this.name = name;
        this.owner = owner;
    }

    public synchronized void addSong(Song song) {
        songs.add(song);
    }

    public synchronized boolean removeSong(Song song) {
        return songs.remove(song);
    }

    public synchronized void move(int from, int to) {
        Song s = songs.remove(from);
        songs.add(to, s);
    }

    // Defensive copy: callers must not hold the live list.
    public synchronized List<Song> snapshot() {
        return new ArrayList<>(songs);
    }

    public String getId() { return id; }
    public String getName() { return name; }
    public User getOwner() { return owner; }
}` },
          { file: "User.java", body: `import java.util.*;

public class User {
    private final String id;
    private final String name;
    private final Map<String, Playlist> playlists = new LinkedHashMap<>();
    private final Set<Song> likedSongs = new LinkedHashSet<>();

    public User(String id, String name) {
        this.id = id;
        this.name = name;
    }

    public Playlist createPlaylist(String playlistId, String name) {
        Playlist p = new Playlist(playlistId, name, this);
        playlists.put(playlistId, p);
        return p;
    }

    public void like(Song song) { likedSongs.add(song); }
    public Set<Song> getLikedSongs() { return Collections.unmodifiableSet(likedSongs); }
    public String getId() { return id; }
}` }
        ]
      },
      {
        heading: "Requirement 3: The player and play order",
        text: "The player is a state machine (stopped, playing, paused), and *what plays next* is a separate concern. Pull next/previous selection behind `PlayOrderStrategy` so shuffle and repeat are interchangeable objects instead of if/else branches in the player.",
        code: [
          { file: "PlayOrderStrategy.java", body: `import java.util.List;
import java.util.Optional;

public interface PlayOrderStrategy {
    // index is the current position, or -1 before anything has played.
    Optional<Integer> next(int index, int size);
    Optional<Integer> previous(int index, int size);
}` },
          { file: "SequentialOrder.java", body: `import java.util.Optional;

public class SequentialOrder implements PlayOrderStrategy {
    public Optional<Integer> next(int index, int size) {
        return index + 1 < size ? Optional.of(index + 1) : Optional.empty();
    }

    public Optional<Integer> previous(int index, int size) {
        return index - 1 >= 0 ? Optional.of(index - 1) : Optional.empty();
    }
}` },
          { file: "RepeatAllOrder.java", body: `import java.util.Optional;

public class RepeatAllOrder implements PlayOrderStrategy {
    public Optional<Integer> next(int index, int size) {
        return size == 0 ? Optional.empty() : Optional.of((index + 1) % size);
    }

    public Optional<Integer> previous(int index, int size) {
        return size == 0 ? Optional.empty() : Optional.of((index - 1 + size) % size);
    }
}` },
          { file: "RepeatOneOrder.java", body: `import java.util.Optional;

public class RepeatOneOrder implements PlayOrderStrategy {
    public Optional<Integer> next(int index, int size) {
        return index >= 0 ? Optional.of(index) : Optional.empty();
    }

    public Optional<Integer> previous(int index, int size) {
        return next(index, size);
    }
}` }
        ],
        note: "Shuffle is not a one-liner. It must be stateful so it never repeats a song until the queue is exhausted. See deep dive 1."
      },
      {
        heading: "Requirement 3 (continued): Player states",
        text: "Each state decides which operations are legal. Calling `pause()` while stopped should be a no-op or an error, and the player must not check this with flags scattered through its methods.",
        code: [
          { file: "PlayerState.java", body: `public interface PlayerState {
    void play(Player player);
    void pause(Player player);
    void stop(Player player);
}` },
          { file: "StoppedState.java", body: `public class StoppedState implements PlayerState {
    public void play(Player player) {
        if (player.startCurrent()) {
            player.setState(new PlayingState());
        }
    }
    public void pause(Player player) { /* nothing to pause */ }
    public void stop(Player player) { /* already stopped */ }
}` },
          { file: "PlayingState.java", body: `public class PlayingState implements PlayerState {
    public void play(Player player) { /* already playing */ }

    public void pause(Player player) {
        player.engine().pause();
        player.setState(new PausedState());
    }

    public void stop(Player player) {
        player.engine().stop();
        player.setState(new StoppedState());
    }
}` },
          { file: "PausedState.java", body: `public class PausedState implements PlayerState {
    public void play(Player player) {
        player.engine().resume();
        player.setState(new PlayingState());
    }
    public void pause(Player player) { /* already paused */ }

    public void stop(Player player) {
        player.engine().stop();
        player.setState(new StoppedState());
    }
}` },
          { file: "Player.java", body: `import java.util.*;

public class Player {
    private final PlaybackEngine engine;
    private final List<Song> queue = new ArrayList<>();
    private final List<PlaybackListener> listeners = new ArrayList<>();
    private PlayOrderStrategy order = new SequentialOrder();
    private PlayerState state = new StoppedState();
    private int index = -1;

    public Player(PlaybackEngine engine) { this.engine = engine; }

    public void load(List<Song> songs) {
        queue.clear();
        queue.addAll(songs);
        index = -1;
        state = new StoppedState();
    }

    public void setOrder(PlayOrderStrategy order) { this.order = order; }
    public void addListener(PlaybackListener l) { listeners.add(l); }

    public void play()  { if (index < 0) index = 0; state.play(this); }
    public void pause() { state.pause(this); }
    public void stop()  { state.stop(this); }

    public void next() {
        order.next(index, queue.size()).ifPresentOrElse(i -> {
            index = i;
            startCurrent();
            state = new PlayingState();
        }, () -> state.stop(this));
    }

    public void previous() {
        order.previous(index, queue.size()).ifPresent(i -> {
            index = i;
            startCurrent();
            state = new PlayingState();
        });
    }

    boolean startCurrent() {
        if (index < 0 || index >= queue.size()) return false;
        Song song = queue.get(index);
        engine.play(song);
        listeners.forEach(l -> l.onSongStarted(song));
        return true;
    }

    PlaybackEngine engine() { return engine; }
    void setState(PlayerState s) { this.state = s; }
}` }
        ]
      },
      {
        heading: "Requirement 5: Playback events with Observer",
        text: "Recently played, play counts and analytics all care about 'a song started'. The player publishes the event and has no idea who listens. New features register themselves; the player is never edited.",
        code: [
          { file: "PlaybackListener.java", body: `public interface PlaybackListener {
    void onSongStarted(Song song);
}` },
          { file: "RecentlyPlayed.java", body: `import java.util.*;

public class RecentlyPlayed implements PlaybackListener {
    private static final int LIMIT = 50;
    private final Deque<Song> history = new ArrayDeque<>();

    public synchronized void onSongStarted(Song song) {
        history.remove(song);
        history.addFirst(song);
        if (history.size() > LIMIT) history.removeLast();
    }

    public synchronized List<Song> get() { return new ArrayList<>(history); }
}` },
          { file: "PlayCounter.java", body: `import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.LongAdder;
import java.util.Map;

public class PlayCounter implements PlaybackListener {
    private final Map<String, LongAdder> counts = new ConcurrentHashMap<>();

    public void onSongStarted(Song song) {
        counts.computeIfAbsent(song.getId(), k -> new LongAdder()).increment();
    }

    public long countFor(Song song) {
        LongAdder a = counts.get(song.getId());
        return a == null ? 0 : a.sum();
    }
}` }
        ]
      },
      {
        heading: "Recommendations behind a strategy",
        text: "Recommendation logic changes constantly (popularity, same-artist, collaborative filtering). Keep it behind one interface and let the service pick one, or combine several.",
        code: [
          { file: "RecommendationStrategy.java", body: `import java.util.List;

public interface RecommendationStrategy {
    List<Song> recommend(User user, int limit);
}` },
          { file: "SameArtistRecommendation.java", body: `import java.util.*;
import java.util.stream.Collectors;

public class SameArtistRecommendation implements RecommendationStrategy {
    private final MusicCatalog catalog;

    public SameArtistRecommendation(MusicCatalog catalog) { this.catalog = catalog; }

    public List<Song> recommend(User user, int limit) {
        Set<String> artists = user.getLikedSongs().stream()
            .map(s -> s.getArtist().getId())
            .collect(Collectors.toSet());

        return catalog.searchSongs("").stream()
            .filter(s -> artists.contains(s.getArtist().getId()))
            .filter(s -> !user.getLikedSongs().contains(s))
            .limit(limit)
            .collect(Collectors.toList());
    }
}` }
        ]
      }
    ],
    deepDive: [
      {
        title: "Shuffle without repeats",
        text: "Picking `random.nextInt(size)` each time repeats songs quickly. A proper shuffle builds a permutation once (Fisher-Yates) and walks it. Going 'previous' walks it backwards, and the shuffle only reshuffles after the last song. Because it holds state, it becomes a per-queue object, which is why the strategy is created when the user turns shuffle on, not shared as a singleton.",
        code: [
          { file: "ShuffleOrder.java", body: `import java.util.*;

public class ShuffleOrder implements PlayOrderStrategy {
    private final List<Integer> permutation = new ArrayList<>();
    private final Random random = new Random();
    private int cursor = -1;

    private void reshuffle(int size, int first) {
        permutation.clear();
        for (int i = 0; i < size; i++) permutation.add(i);
        for (int i = size - 1; i > 0; i--) {
            Collections.swap(permutation, i, random.nextInt(i + 1));
        }
        // Keep the song that just played from also playing first in the new round.
        int pos = permutation.indexOf(first);
        if (first >= 0 && pos == 0 && size > 1) Collections.swap(permutation, 0, 1);
        cursor = -1;
    }

    public Optional<Integer> next(int index, int size) {
        if (size == 0) return Optional.empty();
        if (permutation.size() != size || cursor + 1 >= size) reshuffle(size, index);
        return Optional.of(permutation.get(++cursor));
    }

    public Optional<Integer> previous(int index, int size) {
        if (cursor - 1 < 0 || permutation.size() != size) return Optional.empty();
        return Optional.of(permutation.get(--cursor));
    }
}` }
        ]
      },
      {
        title: "One active player per user across devices",
        text: "A user can open Spotify on a phone and a laptop. Keep a `Map<userId, Player>` in a `PlaybackSessionManager`. When a device calls `play`, atomically swap the registered player and stop the previous one. If the stop is skipped, two devices stream at once. Use `ConcurrentHashMap.put` (returns the old value) so the swap and the lookup of the previous player are a single atomic step.",
        code: [
          { file: "PlaybackSessionManager.java", body: `import java.util.concurrent.ConcurrentHashMap;
import java.util.Map;

public class PlaybackSessionManager {
    private final Map<String, Player> activePlayers = new ConcurrentHashMap<>();

    public void startOnDevice(User user, Player newPlayer) {
        Player previous = activePlayers.put(user.getId(), newPlayer);
        if (previous != null && previous != newPlayer) {
            previous.stop();
        }
        newPlayer.play();
    }
}` }
        ]
      },
      {
        title: "Making search fast",
        text: "A substring scan over every song is O(n) per query. For a real catalogue, build an inverted index from lower-cased tokens to song ids, or a trie for prefix search as the user types. Because the catalogue is behind `searchSongs`, the swap doesn't touch callers. In an interview, name the trade-off (index memory and write-time cost for read speed) and move on."
      }
    ],
    mistakes: [
      "Modelling audio bytes or streaming in the class design. The interviewer scoped that out.",
      "Using `if (mode == SHUFFLE)` branches inside the player instead of a play-order strategy.",
      "Letting the player call history and analytics directly. Use an observer so features don't edit the player.",
      "Picking a random next song each time and calling it shuffle, which repeats songs.",
      "Exposing the live playlist list so callers mutate it without the lock.",
      "Don't force a pattern. Design patterns are good to have, but don't force one in just to impress the interviewer. Here Strategy, State and Observer each remove a real branch; a `Factory` for `Song` would not."
    ],
    followups: [
      "How would you add collaborative playlists that several users edit?",
      "How would 'play queue' (user-added songs jump ahead of the playlist) change the player?",
      "How would you support offline downloads?",
      "How would you cross-fade or gapless-play the next song?"
    ],
    patterns: ["strategy", "state", "observer", "iterator"]
  },

  {
    id: "amazon",
    name: "Design Amazon",
    difficulty: "hard",
    understanding: "An e-commerce platform lets customers browse products, fill a cart and place orders that are paid for and shipped. The core difficulty is the checkout path: reserving stock so you never oversell, capturing the price at purchase time, and moving an order through a lifecycle while notifying other parts of the system.",
    dialogue: [
      { who: "you", text: "Amazon spans sellers, recommendations, reviews, logistics. What should I focus on?" },
      { who: "int", text: "Products and search, the cart, checkout, orders and payment. Skip recommendations, reviews and warehouse logistics." },
      { who: "you", text: "Is there one inventory pool per product, or per warehouse?" },
      { who: "int", text: "Keep it a single pool per product." },
      { who: "you", text: "If two customers try to buy the last unit at the same time, what happens?" },
      { who: "int", text: "Exactly one succeeds. The other gets a clear out-of-stock error." },
      { who: "you", text: "What payment methods, and can they grow?" },
      { who: "int", text: "Card and UPI today. Wallets and buy-now-pay-later next quarter." },
      { who: "you", text: "What happens to the price if the seller changes it after the order is placed?" },
      { who: "int", text: "The customer pays the price they saw at checkout." },
      { who: "you", text: "Should emails and SMS be part of the order code?" },
      { who: "int", text: "They should react to order changes, but the order code shouldn't know about them." }
    ],
    requirements: [
      { group: "Core", items: [
        "Browse and search products by name and category.",
        "A customer has a cart: add, remove and change quantities.",
        "Checkout creates an order from the cart and charges the customer.",
        "An order moves through placed, paid, shipped, delivered, and can be cancelled before shipping.",
        "The customer pays the price shown at checkout even if the catalogue price later changes."
      ] },
      { group: "Concurrency", items: [
        "Two customers can never both buy the last unit.",
        "A retry of the same checkout must not charge or create the order twice."
      ] },
      { group: "Extensibility", items: [
        "New payment methods can be added without editing checkout.",
        "New order-event reactions (email, SMS, analytics) can be added without editing the order."
      ] }
    ],
    entities: [
      { name: "Product", text: "A sellable item with name, category and current price." },
      { name: "Inventory", text: "Available stock per product, separate from the product description." },
      { name: "Cart / CartItem", text: "A customer's pending selection of products and quantities." },
      { name: "Order / OrderItem", text: "An immutable record of what was bought, with the price captured at purchase." },
      { name: "OrderStatus", text: "The lifecycle states of an order." },
      { name: "PaymentStrategy", text: "Charges a customer using one payment method." },
      { name: "OrderListener", text: "Observer notified when an order changes status." },
      { name: "OrderService", text: "Orchestrates checkout." }
    ],
    design: [
      {
        heading: "Requirement 1: Products and search",
        text: "Keep `Product` about description and price, and keep stock in a separate `Inventory`. Stock changes at a very different rate than a product title and needs its own concurrency control.",
        code: [
          { file: "Product.java", body: `public class Product {
    private final String id;
    private final String name;
    private final String category;
    private long priceInPaise;

    public Product(String id, String name, String category, long priceInPaise) {
        this.id = id;
        this.name = name;
        this.category = category;
        this.priceInPaise = priceInPaise;
    }

    public String getId() { return id; }
    public String getName() { return name; }
    public String getCategory() { return category; }
    public long getPriceInPaise() { return priceInPaise; }
    public void setPriceInPaise(long p) { this.priceInPaise = p; }
}` },
          { file: "ProductCatalog.java", body: `import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

public class ProductCatalog {
    private final Map<String, Product> products = new ConcurrentHashMap<>();

    public void add(Product p) { products.put(p.getId(), p); }

    public Optional<Product> get(String id) { return Optional.ofNullable(products.get(id)); }

    public List<Product> search(String text, String category) {
        String q = text == null ? "" : text.toLowerCase();
        return products.values().stream()
            .filter(p -> p.getName().toLowerCase().contains(q))
            .filter(p -> category == null || p.getCategory().equals(category))
            .collect(Collectors.toList());
    }
}` }
        ],
        note: "Money is a long in the smallest unit (paise). Never use `double` for money."
      },
      {
        heading: "Requirement 2: The cart",
        text: "A cart is mutable and personal, so it's the one place where a quantity can be edited freely. It stores product ids and quantities, not prices, because the price is only fixed at checkout.",
        code: [
          { file: "Cart.java", body: `import java.util.*;

public class Cart {
    private final String customerId;
    private final Map<String, Integer> quantities = new LinkedHashMap<>();

    public Cart(String customerId) { this.customerId = customerId; }

    public void add(String productId, int qty) {
        if (qty <= 0) throw new IllegalArgumentException("qty must be positive");
        quantities.merge(productId, qty, Integer::sum);
    }

    public void setQuantity(String productId, int qty) {
        if (qty <= 0) quantities.remove(productId);
        else quantities.put(productId, qty);
    }

    public Map<String, Integer> items() { return Collections.unmodifiableMap(quantities); }
    public boolean isEmpty() { return quantities.isEmpty(); }
    public void clear() { quantities.clear(); }
    public String getCustomerId() { return customerId; }
}` }
        ]
      },
      {
        heading: "Requirement 3: Inventory that never oversells",
        text: "Check-then-decrement is a race: two threads both see stock 1 and both decrement. Make 'reserve' a single atomic operation. A compare-and-set loop keeps the lock off unrelated products.",
        code: [
          { file: "Inventory.java", body: `import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

public class Inventory {
    private final Map<String, AtomicInteger> stock = new ConcurrentHashMap<>();

    public void setStock(String productId, int quantity) {
        stock.computeIfAbsent(productId, k -> new AtomicInteger()).set(quantity);
    }

    // Atomically take qty units, or take nothing.
    public boolean reserve(String productId, int qty) {
        AtomicInteger available = stock.get(productId);
        if (available == null) return false;
        while (true) {
            int current = available.get();
            if (current < qty) return false;
            if (available.compareAndSet(current, current - qty)) return true;
        }
    }

    public void release(String productId, int qty) {
        AtomicInteger available = stock.get(productId);
        if (available != null) available.addAndGet(qty);
    }
}` }
        ],
        note: "Reserving several products is not atomic as a group. If product B fails after A succeeded, release A (see the checkout code)."
      },
      {
        heading: "Requirement 4: Orders and their lifecycle",
        text: "An order snapshots each line's price at purchase, so later catalogue changes can't alter history. Its status changes through a small set of allowed transitions, enforced in one place.",
        code: [
          { file: "OrderStatus.java", body: `import java.util.EnumSet;
import java.util.Set;

public enum OrderStatus {
    PLACED, PAID, SHIPPED, DELIVERED, CANCELLED;

    public Set<OrderStatus> allowedNext() {
        switch (this) {
            case PLACED:    return EnumSet.of(PAID, CANCELLED);
            case PAID:      return EnumSet.of(SHIPPED, CANCELLED);
            case SHIPPED:   return EnumSet.of(DELIVERED);
            default:        return EnumSet.noneOf(OrderStatus.class);
        }
    }
}` },
          { file: "OrderItem.java", body: `public class OrderItem {
    private final String productId;
    private final int quantity;
    private final long unitPriceInPaise; // captured at checkout

    public OrderItem(String productId, int quantity, long unitPriceInPaise) {
        this.productId = productId;
        this.quantity = quantity;
        this.unitPriceInPaise = unitPriceInPaise;
    }

    public String getProductId() { return productId; }
    public int getQuantity() { return quantity; }
    public long total() { return quantity * unitPriceInPaise; }
}` },
          { file: "Order.java", body: `import java.util.*;

public class Order {
    private final String id;
    private final String customerId;
    private final List<OrderItem> items;
    private OrderStatus status = OrderStatus.PLACED;
    private final List<OrderListener> listeners = new ArrayList<>();

    public Order(String id, String customerId, List<OrderItem> items) {
        this.id = id;
        this.customerId = customerId;
        this.items = List.copyOf(items);
    }

    public void addListener(OrderListener l) { listeners.add(l); }

    public synchronized void transitionTo(OrderStatus next) {
        if (!status.allowedNext().contains(next)) {
            throw new IllegalStateException(status + " -> " + next + " is not allowed");
        }
        OrderStatus previous = status;
        status = next;
        listeners.forEach(l -> l.onStatusChanged(this, previous, next));
    }

    public long total() { return items.stream().mapToLong(OrderItem::total).sum(); }
    public List<OrderItem> getItems() { return items; }
    public OrderStatus getStatus() { return status; }
    public String getId() { return id; }
    public String getCustomerId() { return customerId; }
}` }
        ]
      },
      {
        heading: "Requirement 6: Payment strategies",
        text: "Payment methods differ in how they charge but not in what checkout needs from them: a success or a failure. Each method is a strategy, so adding a wallet is a new class.",
        code: [
          { file: "PaymentStrategy.java", body: `public interface PaymentStrategy {
    PaymentResult pay(String customerId, long amountInPaise, String idempotencyKey);
}` },
          { file: "PaymentResult.java", body: `public class PaymentResult {
    private final boolean success;
    private final String reference;

    public PaymentResult(boolean success, String reference) {
        this.success = success;
        this.reference = reference;
    }

    public boolean isSuccess() { return success; }
    public String getReference() { return reference; }
}` },
          { file: "CardPayment.java", body: `public class CardPayment implements PaymentStrategy {
    private final PaymentGateway gateway;
    private final String cardToken;

    public CardPayment(PaymentGateway gateway, String cardToken) {
        this.gateway = gateway;
        this.cardToken = cardToken;
    }

    public PaymentResult pay(String customerId, long amountInPaise, String idempotencyKey) {
        return gateway.chargeCard(cardToken, amountInPaise, idempotencyKey);
    }
}` },
          { file: "UpiPayment.java", body: `public class UpiPayment implements PaymentStrategy {
    private final PaymentGateway gateway;
    private final String upiId;

    public UpiPayment(PaymentGateway gateway, String upiId) {
        this.gateway = gateway;
        this.upiId = upiId;
    }

    public PaymentResult pay(String customerId, long amountInPaise, String idempotencyKey) {
        return gateway.collectUpi(upiId, amountInPaise, idempotencyKey);
    }
}` }
        ]
      },
      {
        heading: "Putting checkout together",
        text: "Checkout is the orchestration: reserve stock, snapshot prices, charge, then transition the order. If any step fails, undo the earlier ones. Keep this in `OrderService`, not in the cart or the order.",
        code: [
          { file: "OrderService.java", body: `import java.util.*;

public class OrderService {
    private final ProductCatalog catalog;
    private final Inventory inventory;
    private final Map<String, Order> ordersByCheckoutKey = new java.util.concurrent.ConcurrentHashMap<>();

    public OrderService(ProductCatalog catalog, Inventory inventory) {
        this.catalog = catalog;
        this.inventory = inventory;
    }

    public Order checkout(Cart cart, PaymentStrategy payment, String checkoutKey, List<OrderListener> listeners) {
        // Idempotency: a retry with the same key returns the same order.
        Order existing = ordersByCheckoutKey.get(checkoutKey);
        if (existing != null) return existing;
        if (cart.isEmpty()) throw new IllegalStateException("Cart is empty");

        List<OrderItem> items = new ArrayList<>();
        List<String[]> reserved = new ArrayList<>();
        try {
            for (Map.Entry<String, Integer> e : cart.items().entrySet()) {
                Product p = catalog.get(e.getKey()).orElseThrow(() -> new IllegalArgumentException("Unknown product"));
                if (!inventory.reserve(p.getId(), e.getValue())) {
                    throw new IllegalStateException("Out of stock: " + p.getName());
                }
                reserved.add(new String[] { p.getId(), String.valueOf(e.getValue()) });
                items.add(new OrderItem(p.getId(), e.getValue(), p.getPriceInPaise()));
            }

            Order order = new Order(UUID.randomUUID().toString(), cart.getCustomerId(), items);
            listeners.forEach(order::addListener);

            PaymentResult result = payment.pay(cart.getCustomerId(), order.total(), checkoutKey);
            if (!result.isSuccess()) throw new IllegalStateException("Payment failed");

            order.transitionTo(OrderStatus.PAID);
            cart.clear();
            ordersByCheckoutKey.put(checkoutKey, order);
            return order;
        } catch (RuntimeException ex) {
            for (String[] r : reserved) inventory.release(r[0], Integer.parseInt(r[1]));
            throw ex;
        }
    }
}` }
        ],
        note: "The idempotency check here is deliberately simple. Two concurrent retries with the same key could still both pass it. See deep dive 2."
      },
      {
        heading: "Requirement 7: Order notifications with Observer",
        text: "Sending an email is not the order's job. Listeners register and react to status changes.",
        code: [
          { file: "OrderListener.java", body: `public interface OrderListener {
    void onStatusChanged(Order order, OrderStatus from, OrderStatus to);
}` },
          { file: "EmailNotifier.java", body: `public class EmailNotifier implements OrderListener {
    private final EmailClient email;

    public EmailNotifier(EmailClient email) { this.email = email; }

    public void onStatusChanged(Order order, OrderStatus from, OrderStatus to) {
        email.send(order.getCustomerId(), "Order " + order.getId() + " is now " + to);
    }
}` }
        ]
      }
    ],
    deepDive: [
      {
        title: "Reserving stock for several products without deadlock or leaks",
        text: "Each product's reservation is atomic, but a cart of three products is three separate operations, so a failure in the middle leaves earlier reservations held. The checkout above releases them in a catch block. Two more production concerns: a customer who reserves stock and then abandons payment ties it up forever, so reservations need an expiry that releases them; and if you ever lock per-product (rather than CAS), acquire locks in sorted product-id order so two carts can't deadlock on each other."
      },
      {
        title: "Making checkout idempotent",
        text: "Mobile apps retry requests. Without protection a retry charges the customer twice. The client sends a `checkoutKey` that is stable across retries. The service must make 'check key, create order, store key' atomic, for example with `ConcurrentHashMap.computeIfAbsent` or a unique constraint on the key in the database. The same key is forwarded to the payment gateway so that the gateway deduplicates the charge as well.",
        code: [
          { file: "IdempotentCheckout.java", body: `// Atomic: only one thread runs the lambda for a given key.
Order order = ordersByCheckoutKey.computeIfAbsent(checkoutKey, k -> doCheckout(cart, payment, k));` }
        ]
      },
      {
        title: "Why the order copies the price",
        text: "If `OrderItem` stored a reference to `Product` and read the price from it, a seller changing the price would rewrite the history of every past order and every receipt. Snapshotting `unitPriceInPaise` (and ideally the product name) makes the order a self-contained record. This is the same reason `Seat` and `ShowSeat` are separate in a booking system: separate what is permanent from what is a fact about one transaction."
      }
    ],
    mistakes: [
      "Storing stock inside `Product` and decrementing it with a plain `if (stock > 0) stock--`.",
      "Computing an order's total from the live product price, so history changes when prices change.",
      "Using `double` for money.",
      "Putting payment `if (method == CARD)` branches into checkout instead of a payment strategy.",
      "Letting the order class send emails directly.",
      "Skipping rollback of reserved stock when payment fails.",
      "Don't force a pattern. Design patterns are good to have, but don't force one in just to impress the interviewer. A `Builder` for `Order` or a `Singleton` catalogue here would add code without removing a real problem."
    ],
    followups: [
      "How would you support multiple warehouses and choose the nearest one?",
      "How would you handle partial shipments and refunds?",
      "How would you add coupons and discounts that stack?",
      "How would you hold stock while the customer is on the payment page?"
    ],
    patterns: ["strategy", "state", "observer"]
  },

  {
    id: "linkedin",
    name: "Design LinkedIn",
    difficulty: "hard",
    understanding: "A professional network lets members maintain a profile, connect with other members, post updates, see a feed, and discover and apply to jobs. The interesting design decisions are the symmetric connection model with a request/accept flow, a feed that can be ranked in different ways, and notifications that react to many kinds of events.",
    dialogue: [
      { who: "you", text: "LinkedIn is wide. Which areas should I cover?" },
      { who: "int", text: "Profiles, connections, posts with a feed, and job posting with applications. Skip messaging and learning." },
      { who: "you", text: "Are connections mutual, like friends, or one-way follows?" },
      { who: "int", text: "Mutual. One member sends a request and the other must accept." },
      { who: "you", text: "Can I send a request twice or to someone who already sent me one?" },
      { who: "int", text: "Duplicate pending requests should be rejected. If they already sent you one, accepting it is the sensible outcome." },
      { who: "you", text: "How is the feed ordered?" },
      { who: "int", text: "Start with most recent. Product will try other orderings, such as engagement-based." },
      { who: "you", text: "Should a member be able to see how far away another member is, like 1st or 2nd degree?" },
      { who: "int", text: "Yes, compute the degree of connection between two members." },
      { who: "you", text: "Who gets notified, and for what?" },
      { who: "int", text: "Connection requests, accepted requests, new applications on your job posts. More types later." }
    ],
    requirements: [
      { group: "Core", items: [
        "Members have a profile with headline, experience and skills.",
        "Members send, accept and reject connection requests. Connections are mutual.",
        "Members publish posts, and a member's feed shows posts from their connections.",
        "Recruiters post jobs; members apply, and recruiters see applications.",
        "A member can see the degree of connection to another member."
      ] },
      { group: "Concurrency", items: [
        "Two members sending each other requests at the same moment must result in one connection, not two.",
        "Applying to the same job twice is rejected."
      ] },
      { group: "Extensibility", items: [
        "The feed ordering can change without changing the feed's callers.",
        "New notification types and channels can be added without touching the code that raises events."
      ] }
    ],
    entities: [
      { name: "Member", text: "A user with a profile and a set of connections." },
      { name: "Profile", text: "Headline, experience entries and skills. Built step by step." },
      { name: "ConnectionRequest", text: "A pending, accepted or rejected invitation between two members." },
      { name: "Post", text: "A member's published update." },
      { name: "FeedRankingStrategy", text: "Orders candidate posts for a member." },
      { name: "JobPosting / Application", text: "A job and a member's application to it." },
      { name: "NotificationListener", text: "Observer reacting to domain events." },
      { name: "ConnectionGraph", text: "Tracks accepted connections and answers degree queries." }
    ],
    design: [
      {
        heading: "Requirement 1: Profiles with a Builder",
        text: "A profile has many optional parts: headline, summary, experience, skills. A builder keeps construction readable and lets `build()` validate once. The resulting `Profile` can then be immutable-ish and safe to share.",
        code: [
          { file: "Experience.java", body: `import java.time.LocalDate;

public class Experience {
    private final String company;
    private final String title;
    private final LocalDate from;
    private final LocalDate to; // null means current

    public Experience(String company, String title, LocalDate from, LocalDate to) {
        this.company = company;
        this.title = title;
        this.from = from;
        this.to = to;
    }

    public String getCompany() { return company; }
    public String getTitle() { return title; }
}` },
          { file: "Profile.java", body: `import java.util.*;

public class Profile {
    private final String headline;
    private final String summary;
    private final List<Experience> experience;
    private final Set<String> skills;

    private Profile(Builder b) {
        this.headline = b.headline;
        this.summary = b.summary;
        this.experience = List.copyOf(b.experience);
        this.skills = Set.copyOf(b.skills);
    }

    public String getHeadline() { return headline; }
    public Set<String> getSkills() { return skills; }
    public List<Experience> getExperience() { return experience; }

    public static class Builder {
        private String headline;
        private String summary = "";
        private final List<Experience> experience = new ArrayList<>();
        private final Set<String> skills = new LinkedHashSet<>();

        public Builder headline(String h) { this.headline = h; return this; }
        public Builder summary(String s) { this.summary = s; return this; }
        public Builder experience(Experience e) { this.experience.add(e); return this; }
        public Builder skill(String s) { this.skills.add(s); return this; }

        public Profile build() {
            if (headline == null || headline.isBlank()) {
                throw new IllegalStateException("headline is required");
            }
            return new Profile(this);
        }
    }
}` },
          { file: "Member.java", body: `public class Member {
    private final String id;
    private final String name;
    private Profile profile;

    public Member(String id, String name, Profile profile) {
        this.id = id;
        this.name = name;
        this.profile = profile;
    }

    public String getId() { return id; }
    public String getName() { return name; }
    public Profile getProfile() { return profile; }
    public void updateProfile(Profile profile) { this.profile = profile; }
}` }
        ]
      },
      {
        heading: "Requirement 2: Connections as a request/accept flow",
        text: "A request goes through states (pending, accepted, rejected). Accepting creates an undirected edge. The graph stores adjacency sets, and a connection is symmetric so both sides are written together. The whole operation is synchronised so a simultaneous cross-request can't create two connections.",
        code: [
          { file: "ConnectionRequest.java", body: `public class ConnectionRequest {
    public enum Status { PENDING, ACCEPTED, REJECTED }

    private final String from;
    private final String to;
    private Status status = Status.PENDING;

    public ConnectionRequest(String from, String to) {
        this.from = from;
        this.to = to;
    }

    public String getFrom() { return from; }
    public String getTo() { return to; }
    public Status getStatus() { return status; }
    void setStatus(Status s) { this.status = s; }
}` },
          { file: "ConnectionService.java", body: `import java.util.*;

public class ConnectionService {
    private final Map<String, Set<String>> graph = new HashMap<>();
    private final Map<String, ConnectionRequest> pending = new HashMap<>(); // key: from->to
    private final EventBus events;

    public ConnectionService(EventBus events) { this.events = events; }

    private static String key(String from, String to) { return from + "->" + to; }

    public synchronized void sendRequest(String from, String to) {
        if (from.equals(to)) throw new IllegalArgumentException("Cannot connect to yourself");
        if (areConnected(from, to)) throw new IllegalStateException("Already connected");
        if (pending.containsKey(key(from, to))) throw new IllegalStateException("Request already pending");

        // They already asked us: accepting is the natural outcome.
        if (pending.containsKey(key(to, from))) {
            accept(to, from);
            return;
        }
        pending.put(key(from, to), new ConnectionRequest(from, to));
        events.publish(new ConnectionRequested(from, to));
    }

    public synchronized void accept(String from, String to) {
        ConnectionRequest r = pending.remove(key(from, to));
        if (r == null) throw new IllegalStateException("No pending request");
        r.setStatus(ConnectionRequest.Status.ACCEPTED);
        graph.computeIfAbsent(from, k -> new HashSet<>()).add(to);
        graph.computeIfAbsent(to, k -> new HashSet<>()).add(from);
        events.publish(new ConnectionAccepted(from, to));
    }

    public synchronized void reject(String from, String to) {
        ConnectionRequest r = pending.remove(key(from, to));
        if (r != null) r.setStatus(ConnectionRequest.Status.REJECTED);
    }

    public synchronized boolean areConnected(String a, String b) {
        return graph.getOrDefault(a, Set.of()).contains(b);
    }

    public synchronized Set<String> connectionsOf(String id) {
        return new HashSet<>(graph.getOrDefault(id, Set.of()));
    }
}` }
        ]
      },
      {
        heading: "Requirement 3: Posts and a pluggable feed",
        text: "A feed has two steps: gather candidate posts (from connections) and order them. The first step is stable. The second changes constantly, so it sits behind `FeedRankingStrategy`.",
        code: [
          { file: "Post.java", body: `import java.time.Instant;
import java.util.concurrent.atomic.AtomicInteger;

public class Post {
    private final String id;
    private final String authorId;
    private final String text;
    private final Instant createdAt;
    private final AtomicInteger likes = new AtomicInteger();

    public Post(String id, String authorId, String text, Instant createdAt) {
        this.id = id;
        this.authorId = authorId;
        this.text = text;
        this.createdAt = createdAt;
    }

    public void like() { likes.incrementAndGet(); }
    public int getLikes() { return likes.get(); }
    public Instant getCreatedAt() { return createdAt; }
    public String getAuthorId() { return authorId; }
    public String getId() { return id; }
}` },
          { file: "FeedRankingStrategy.java", body: `import java.util.List;

public interface FeedRankingStrategy {
    List<Post> rank(List<Post> candidates);
}` },
          { file: "RecentFirst.java", body: `import java.util.*;
import java.util.stream.Collectors;

public class RecentFirst implements FeedRankingStrategy {
    public List<Post> rank(List<Post> candidates) {
        return candidates.stream()
            .sorted(Comparator.comparing(Post::getCreatedAt).reversed())
            .collect(Collectors.toList());
    }
}` },
          { file: "EngagementFirst.java", body: `import java.time.Duration;
import java.time.Instant;
import java.util.*;
import java.util.stream.Collectors;

public class EngagementFirst implements FeedRankingStrategy {
    public List<Post> rank(List<Post> candidates) {
        Instant now = Instant.now();
        return candidates.stream()
            .sorted(Comparator.comparingDouble((Post p) -> score(p, now)).reversed())
            .collect(Collectors.toList());
    }

    // Likes, decayed by age in hours.
    private double score(Post p, Instant now) {
        double ageHours = Duration.between(p.getCreatedAt(), now).toMinutes() / 60.0;
        return p.getLikes() / Math.pow(ageHours + 2, 1.5);
    }
}` },
          { file: "FeedService.java", body: `import java.util.*;

public class FeedService {
    private final PostRepository posts;
    private final ConnectionService connections;
    private FeedRankingStrategy ranking;

    public FeedService(PostRepository posts, ConnectionService connections, FeedRankingStrategy ranking) {
        this.posts = posts;
        this.connections = connections;
        this.ranking = ranking;
    }

    public void setRanking(FeedRankingStrategy ranking) { this.ranking = ranking; }

    public List<Post> feedFor(String memberId, int limit) {
        List<Post> candidates = new ArrayList<>();
        for (String friend : connections.connectionsOf(memberId)) {
            candidates.addAll(posts.recentBy(friend, 50));
        }
        List<Post> ranked = ranking.rank(candidates);
        return ranked.subList(0, Math.min(limit, ranked.size()));
    }
}` }
        ]
      },
      {
        heading: "Requirement 4: Jobs and applications",
        text: "A job posting owns its applications. Rejecting duplicates is a rule of the posting, so it lives there, and the check-and-insert is atomic.",
        code: [
          { file: "JobPosting.java", body: `import java.util.*;

public class JobPosting {
    private final String id;
    private final String recruiterId;
    private final String title;
    private boolean open = true;
    private final Map<String, Application> applications = new LinkedHashMap<>();

    public JobPosting(String id, String recruiterId, String title) {
        this.id = id;
        this.recruiterId = recruiterId;
        this.title = title;
    }

    public synchronized Application apply(Member member, String coverLetter) {
        if (!open) throw new IllegalStateException("Job is closed");
        if (applications.containsKey(member.getId())) {
            throw new IllegalStateException("Already applied");
        }
        Application a = new Application(member.getId(), coverLetter);
        applications.put(member.getId(), a);
        return a;
    }

    public synchronized void close() { open = false; }
    public synchronized List<Application> applications() { return new ArrayList<>(applications.values()); }
    public String getRecruiterId() { return recruiterId; }
    public String getId() { return id; }
    public String getTitle() { return title; }
}` },
          { file: "Application.java", body: `import java.time.Instant;

public class Application {
    public enum Status { SUBMITTED, REVIEWED, REJECTED, HIRED }

    private final String memberId;
    private final String coverLetter;
    private final Instant appliedAt = Instant.now();
    private Status status = Status.SUBMITTED;

    public Application(String memberId, String coverLetter) {
        this.memberId = memberId;
        this.coverLetter = coverLetter;
    }

    public String getMemberId() { return memberId; }
    public Status getStatus() { return status; }
    public void setStatus(Status s) { this.status = s; }
}` }
        ]
      },
      {
        heading: "Requirement 6: Notifications through events",
        text: "Code that raises 'connection accepted' shouldn't know about emails or in-app badges. It publishes an event. Channels subscribe to the event types they care about.",
        code: [
          { file: "EventBus.java", body: `import java.util.*;
import java.util.concurrent.CopyOnWriteArrayList;

public class EventBus {
    private final Map<Class<?>, List<NotificationListener<?>>> listeners = new HashMap<>();

    public synchronized <E> void subscribe(Class<E> type, NotificationListener<E> l) {
        listeners.computeIfAbsent(type, k -> new CopyOnWriteArrayList<>()).add(l);
    }

    @SuppressWarnings("unchecked")
    public <E> void publish(E event) {
        List<NotificationListener<?>> ls;
        synchronized (this) {
            ls = listeners.getOrDefault(event.getClass(), List.of());
        }
        for (NotificationListener<?> l : ls) {
            ((NotificationListener<E>) l).onEvent(event);
        }
    }
}` },
          { file: "NotificationListener.java", body: `public interface NotificationListener<E> {
    void onEvent(E event);
}` },
          { file: "ConnectionAccepted.java", body: `public class ConnectionAccepted {
    public final String from;
    public final String to;

    public ConnectionAccepted(String from, String to) {
        this.from = from;
        this.to = to;
    }
}` },
          { file: "InAppNotifier.java", body: `public class InAppNotifier implements NotificationListener<ConnectionAccepted> {
    private final InboxStore inbox;

    public InAppNotifier(InboxStore inbox) { this.inbox = inbox; }

    public void onEvent(ConnectionAccepted e) {
        inbox.add(e.from, e.to + " accepted your connection request");
    }
}` }
        ]
      }
    ],
    deepDive: [
      {
        title: "Degree of connection with BFS",
        text: "1st degree means directly connected, 2nd means a connection of a connection, and so on. That is the shortest path length in an unweighted graph, which is a breadth-first search. Cap the depth (LinkedIn only shows up to 3rd) so a query on a huge graph stays bounded. For very large graphs you search from both ends (bidirectional BFS) to cut the explored nodes dramatically.",
        code: [
          { file: "DegreeOfConnection.java", body: `import java.util.*;

public class DegreeOfConnection {
    private final ConnectionService connections;

    public DegreeOfConnection(ConnectionService connections) { this.connections = connections; }

    // Returns 1, 2, 3 ... or -1 if not reachable within maxDepth.
    public int between(String start, String target, int maxDepth) {
        if (start.equals(target)) return 0;
        Set<String> visited = new HashSet<>(List.of(start));
        Deque<String> frontier = new ArrayDeque<>(List.of(start));
        int depth = 0;

        while (!frontier.isEmpty() && depth < maxDepth) {
            depth++;
            for (int n = frontier.size(); n > 0; n--) {
                String current = frontier.poll();
                for (String next : connections.connectionsOf(current)) {
                    if (next.equals(target)) return depth;
                    if (visited.add(next)) frontier.add(next);
                }
            }
        }
        return -1;
    }
}` }
        ]
      },
      {
        title: "Feed generation: fan-out on read vs on write",
        text: "`feedFor` above reads every connection's recent posts at request time (fan-out on read). That is simple and always fresh, but slow for a member with thousands of connections. Fan-out on write pushes each new post into every connection's precomputed feed, making reads cheap at the cost of expensive writes and wasted storage for inactive members. Real systems mix both. In an LLD round, the strategy interface already isolates this: only `FeedService` changes. State the trade-off clearly and don't build the pipeline."
      },
      {
        title: "Cross-requests and the race",
        text: "Alice requests Bob while Bob requests Alice. Without protection both requests are stored as pending and neither side ever sees a 'natural accept'. Two defences: serialise all connection mutations through one lock (shown above), which is fine for an interview, or, in a database, store the pair with a canonical order (smaller id first) under a unique constraint so the second insert fails or turns into an accept."
      }
    ],
    mistakes: [
      "Modelling connections as one-way follows when the requirement says mutual.",
      "Storing each connection once with a direction, then forgetting to query both directions.",
      "Hard-coding feed ordering into `FeedService` with `sort` calls scattered around.",
      "Having the code that accepts a connection call email and push code directly.",
      "Allowing a member to apply twice because the duplicate check isn't atomic.",
      "Don't force a pattern. Design patterns are good to have, but don't force one in just to impress the interviewer. The `Builder` earns its place because `Profile` has many optional fields. A `Builder` for `Post`, which has three required fields, would not."
    ],
    followups: [
      "How would you suggest 'People you may know'?",
      "How would you support following company pages and influencers (one-way)?",
      "How would you handle blocking a member?",
      "How would you add endorsements for skills?"
    ],
    patterns: ["builder", "strategy", "observer"]
  },

  {
    id: "cricinfo",
    name: "Design CricInfo",
    difficulty: "hard",
    understanding: "CricInfo shows live cricket scores, scorecards and commentary for matches. The system has to record a match ball by ball, derive scorecards and statistics from those balls, and push updates to many viewers. The key insight is to treat each delivery as an event and compute everything else from the event log.",
    dialogue: [
      { who: "you", text: "Is this a scoring tool for officials, a read-only viewer app, or both?" },
      { who: "int", text: "Both. A scorer records each ball, and viewers see the live scoreboard and commentary." },
      { who: "you", text: "Which formats: Test, ODI, T20?" },
      { who: "int", text: "Support limited-overs matches first, with the number of overs configurable. Keep room for Tests." },
      { who: "you", text: "What has to be recorded for each ball?" },
      { who: "int", text: "Bowler, batsman, runs, extras like wides and no-balls, and wickets with how the batsman got out." },
      { who: "you", text: "Do wides and no-balls count as a legal delivery?" },
      { who: "int", text: "No. They add runs but the ball is bowled again." },
      { who: "you", text: "What do viewers see?" },
      { who: "int", text: "Live score, current batsmen and bowler, over-by-over commentary, and the full scorecard." },
      { who: "you", text: "If the scorer makes a mistake, can they fix it?" },
      { who: "int", text: "Yes, at least undo the last ball." }
    ],
    requirements: [
      { group: "Core", items: [
        "Create a match between two teams with a configurable number of overs.",
        "Record each ball with runs, extras and wickets.",
        "Compute the live score, overs, batting and bowling figures from recorded balls.",
        "Match goes through scheduled, in progress, innings break and completed.",
        "Show commentary for each ball."
      ] },
      { group: "Concurrency", items: [
        "Many viewers read the live score while a single scorer writes balls.",
        "A viewer must never see a half-applied ball."
      ] },
      { group: "Extensibility", items: [
        "New viewer channels (website, mobile push, TV graphics) can subscribe to live updates.",
        "New match formats can be added without rewriting the scoring logic."
      ] }
    ],
    entities: [
      { name: "Match", text: "Two teams, a format and a lifecycle state." },
      { name: "Team / Player", text: "Squads that play the match." },
      { name: "Innings", text: "One team batting. Holds the ordered list of balls." },
      { name: "BallEvent", text: "An immutable record of a delivery." },
      { name: "Extra", text: "Wide, no-ball, bye or leg-bye." },
      { name: "Wicket", text: "A dismissal with type, batsman out and optional fielder." },
      { name: "Scorecard", text: "Derived batting and bowling figures." },
      { name: "MatchState", text: "The lifecycle of a match." },
      { name: "ScoreSubscriber", text: "Observer receiving live updates." }
    ],
    design: [
      {
        heading: "Requirement 1: Matches, teams and players",
        text: "These are straightforward data holders. The only design choice is to put the format (number of overs) in a `MatchFormat` value so Test cricket can later provide a different rule set.",
        code: [
          { file: "Player.java", body: `public class Player {
    private final String id;
    private final String name;

    public Player(String id, String name) {
        this.id = id;
        this.name = name;
    }

    public String getId() { return id; }
    public String getName() { return name; }
}` },
          { file: "Team.java", body: `import java.util.*;

public class Team {
    private final String name;
    private final List<Player> players;

    public Team(String name, List<Player> players) {
        this.name = name;
        this.players = List.copyOf(players);
    }

    public String getName() { return name; }
    public List<Player> getPlayers() { return players; }
}` },
          { file: "MatchFormat.java", body: `public class MatchFormat {
    private final String name;
    private final int oversPerInnings;
    private final int maxInnings;

    public MatchFormat(String name, int oversPerInnings, int maxInnings) {
        this.name = name;
        this.oversPerInnings = oversPerInnings;
        this.maxInnings = maxInnings;
    }

    public static MatchFormat t20() { return new MatchFormat("T20", 20, 2); }
    public static MatchFormat odi() { return new MatchFormat("ODI", 50, 2); }

    public int getOversPerInnings() { return oversPerInnings; }
    public int getMaxInnings() { return maxInnings; }
}` }
        ]
      },
      {
        heading: "Requirement 2: Every ball is an immutable event",
        text: "Record exactly what happened on the delivery and nothing derived. The score is *not* stored anywhere. It is a function of the list of balls. That makes corrections trivial (remove or edit a ball and recompute) and the data auditable.",
        code: [
          { file: "ExtraType.java", body: `public enum ExtraType {
    NONE(true), WIDE(false), NO_BALL(false), BYE(true), LEG_BYE(true);

    private final boolean legalDelivery;

    ExtraType(boolean legalDelivery) { this.legalDelivery = legalDelivery; }

    public boolean isLegalDelivery() { return legalDelivery; }
}` },
          { file: "Wicket.java", body: `public class Wicket {
    public enum Kind { BOWLED, CAUGHT, LBW, RUN_OUT, STUMPED, HIT_WICKET }

    private final Kind kind;
    private final Player batsmanOut;
    private final Player fielder; // may be null

    public Wicket(Kind kind, Player batsmanOut, Player fielder) {
        this.kind = kind;
        this.batsmanOut = batsmanOut;
        this.fielder = fielder;
    }

    public Kind getKind() { return kind; }
    public Player getBatsmanOut() { return batsmanOut; }

    // Run outs are not credited to the bowler.
    public boolean creditedToBowler() { return kind != Kind.RUN_OUT; }
}` },
          { file: "BallEvent.java", body: `public class BallEvent {
    private final Player bowler;
    private final Player striker;
    private final Player nonStriker;
    private final int runsOffBat;
    private final ExtraType extra;
    private final int extraRuns;
    private final Wicket wicket; // null if none
    private final String commentary;

    public BallEvent(Player bowler, Player striker, Player nonStriker, int runsOffBat,
                     ExtraType extra, int extraRuns, Wicket wicket, String commentary) {
        this.bowler = bowler;
        this.striker = striker;
        this.nonStriker = nonStriker;
        this.runsOffBat = runsOffBat;
        this.extra = extra;
        this.extraRuns = extraRuns;
        this.wicket = wicket;
        this.commentary = commentary;
    }

    public int totalRuns() { return runsOffBat + extraRuns; }
    public boolean isLegal() { return extra.isLegalDelivery(); }
    public boolean isWicket() { return wicket != null; }

    public Player getBowler() { return bowler; }
    public Player getStriker() { return striker; }
    public int getRunsOffBat() { return runsOffBat; }
    public ExtraType getExtra() { return extra; }
    public Wicket getWicket() { return wicket; }
    public String getCommentary() { return commentary; }
}` }
        ]
      },
      {
        heading: "Requirement 3: Innings derive the score",
        text: "An innings holds the ordered balls and exposes derived values. Legal balls drive the over count. Wides and no-balls add runs without consuming a ball.",
        code: [
          { file: "Innings.java", body: `import java.util.*;

public class Innings {
    private final Team battingTeam;
    private final Team bowlingTeam;
    private final int maxOvers;
    private final List<BallEvent> balls = new ArrayList<>();

    public Innings(Team battingTeam, Team bowlingTeam, int maxOvers) {
        this.battingTeam = battingTeam;
        this.bowlingTeam = bowlingTeam;
        this.maxOvers = maxOvers;
    }

    synchronized void add(BallEvent ball) { balls.add(ball); }

    synchronized BallEvent removeLast() {
        if (balls.isEmpty()) throw new IllegalStateException("No balls to undo");
        return balls.remove(balls.size() - 1);
    }

    public synchronized int runs() {
        return balls.stream().mapToInt(BallEvent::totalRuns).sum();
    }

    public synchronized int wickets() {
        return (int) balls.stream().filter(BallEvent::isWicket).count();
    }

    public synchronized int legalBalls() {
        return (int) balls.stream().filter(BallEvent::isLegal).count();
    }

    // e.g. "12.3"
    public synchronized String oversDisplay() {
        int legal = legalBalls();
        return (legal / 6) + "." + (legal % 6);
    }

    public synchronized boolean isOver() {
        return wickets() >= battingTeam.getPlayers().size() - 1 || legalBalls() >= maxOvers * 6;
    }

    public synchronized List<BallEvent> balls() { return List.copyOf(balls); }
    public Team getBattingTeam() { return battingTeam; }
    public Team getBowlingTeam() { return bowlingTeam; }
}` },
          { file: "Scorecard.java", body: `import java.util.*;

public class Scorecard {
    public static class BattingLine {
        public int runs;
        public int ballsFaced;
        public boolean out;
    }

    public static class BowlingLine {
        public int legalBalls;
        public int runsConceded;
        public int wickets;
    }

    public final Map<Player, BattingLine> batting = new LinkedHashMap<>();
    public final Map<Player, BowlingLine> bowling = new LinkedHashMap<>();

    public static Scorecard from(Innings innings) {
        Scorecard card = new Scorecard();
        for (BallEvent b : innings.balls()) {
            BattingLine bat = card.batting.computeIfAbsent(b.getStriker(), p -> new BattingLine());
            BowlingLine bowl = card.bowling.computeIfAbsent(b.getBowler(), p -> new BowlingLine());

            bat.runs += b.getRunsOffBat();
            if (b.getExtra() != ExtraType.WIDE) bat.ballsFaced++;

            // Byes and leg byes are not charged to the bowler.
            boolean chargedToBowler = b.getExtra() != ExtraType.BYE && b.getExtra() != ExtraType.LEG_BYE;
            if (chargedToBowler) bowl.runsConceded += b.totalRuns();
            if (b.isLegal()) bowl.legalBalls++;

            if (b.isWicket()) {
                BattingLine out = card.batting.computeIfAbsent(b.getWicket().getBatsmanOut(), p -> new BattingLine());
                out.out = true;
                if (b.getWicket().creditedToBowler()) bowl.wickets++;
            }
        }
        return card;
    }
}` }
        ],
        note: "`Scorecard.from` recomputes from the ball list on demand, so there is no second copy of the truth to drift out of sync."
      },
      {
        heading: "Requirement 4: Match lifecycle with State",
        text: "What the scorer may do depends on the match state: you can't record balls before the match starts or after it ends. Each state owns the legal operations.",
        code: [
          { file: "MatchState.java", body: `public interface MatchState {
    void start(Match match);
    void recordBall(Match match, BallEvent ball);
    void endInnings(Match match);
}` },
          { file: "ScheduledState.java", body: `public class ScheduledState implements MatchState {
    public void start(Match match) {
        match.beginFirstInnings();
        match.setState(new InProgressState());
    }
    public void recordBall(Match match, BallEvent ball) {
        throw new IllegalStateException("Match has not started");
    }
    public void endInnings(Match match) {
        throw new IllegalStateException("Match has not started");
    }
}` },
          { file: "InProgressState.java", body: `public class InProgressState implements MatchState {
    public void start(Match match) { throw new IllegalStateException("Already started"); }

    public void recordBall(Match match, BallEvent ball) {
        match.currentInnings().add(ball);
        if (match.currentInnings().isOver()) {
            endInnings(match);
        }
    }

    public void endInnings(Match match) {
        if (match.hasSecondInnings()) {
            match.setState(new CompletedState());
        } else {
            match.beginSecondInnings();
            match.setState(new InningsBreakState());
        }
    }
}` },
          { file: "InningsBreakState.java", body: `public class InningsBreakState implements MatchState {
    public void start(Match match) {
        // Resume play for the second innings.
        match.setState(new InProgressState());
    }
    public void recordBall(Match match, BallEvent ball) {
        throw new IllegalStateException("Innings break");
    }
    public void endInnings(Match match) {
        throw new IllegalStateException("Innings break");
    }
}` },
          { file: "CompletedState.java", body: `public class CompletedState implements MatchState {
    public void start(Match match) { throw new IllegalStateException("Match is over"); }
    public void recordBall(Match match, BallEvent ball) { throw new IllegalStateException("Match is over"); }
    public void endInnings(Match match) { throw new IllegalStateException("Match is over"); }
}` }
        ]
      },
      {
        heading: "Requirement 5: Live updates with Observer",
        text: "The match publishes 'a ball was recorded' and doesn't know who's watching. A website pusher, a mobile notifier and a TV graphics feed each implement the same listener. Publish after the state is fully updated so viewers never see a half-applied ball.",
        code: [
          { file: "ScoreSubscriber.java", body: `public interface ScoreSubscriber {
    void onBall(Match match, BallEvent ball);
    void onMatchStateChanged(Match match);
}` },
          { file: "Match.java", body: `import java.util.*;
import java.util.concurrent.CopyOnWriteArrayList;

public class Match {
    private final String id;
    private final Team teamA;
    private final Team teamB;
    private final MatchFormat format;
    private final List<Innings> innings = new ArrayList<>();
    private final List<ScoreSubscriber> subscribers = new CopyOnWriteArrayList<>();
    private MatchState state = new ScheduledState();

    public Match(String id, Team teamA, Team teamB, MatchFormat format) {
        this.id = id;
        this.teamA = teamA;
        this.teamB = teamB;
        this.format = format;
    }

    public void subscribe(ScoreSubscriber s) { subscribers.add(s); }

    // A single scorer writes; the lock guards the write against viewers' reads.
    public synchronized void start() {
        state.start(this);
        subscribers.forEach(s -> s.onMatchStateChanged(this));
    }

    public synchronized void recordBall(BallEvent ball) {
        state.recordBall(this, ball);
        subscribers.forEach(s -> s.onBall(this, ball));
    }

    public synchronized void undoLastBall() {
        currentInnings().removeLast();
        subscribers.forEach(s -> s.onMatchStateChanged(this));
    }

    void beginFirstInnings()  { innings.add(new Innings(teamA, teamB, format.getOversPerInnings())); }
    void beginSecondInnings() { innings.add(new Innings(teamB, teamA, format.getOversPerInnings())); }
    boolean hasSecondInnings() { return innings.size() == format.getMaxInnings(); }
    Innings currentInnings() { return innings.get(innings.size() - 1); }
    void setState(MatchState s) { this.state = s; }

    public synchronized List<Innings> getInnings() { return List.copyOf(innings); }
    public String getId() { return id; }
}` },
          { file: "CommentaryFeed.java", body: `import java.util.*;

public class CommentaryFeed implements ScoreSubscriber {
    private final List<String> lines = new ArrayList<>();

    public synchronized void onBall(Match match, BallEvent ball) {
        Innings current = match.getInnings().get(match.getInnings().size() - 1);
        lines.add(current.oversDisplay() + "  " + ball.getCommentary());
    }

    public void onMatchStateChanged(Match match) { }

    public synchronized List<String> latest(int n) {
        return new ArrayList<>(lines.subList(Math.max(0, lines.size() - n), lines.size()));
    }
}` }
        ]
      }
    ],
    deepDive: [
      {
        title: "Event log vs stored totals",
        text: "A naive design keeps `int totalRuns`, `int wickets` and updates them on each ball. The first correction (wrong runs on ball 4.2) forces you to reverse-engineer which counters to adjust, and they will drift. With the ball list as the single source of truth, undo is `removeLast()` and every derived view (score, scorecard, over summary, partnerships) is a pure function of the list. The price is recomputation, which is cheap for a few hundred balls and can be cached incrementally if needed. This is event sourcing in miniature."
      },
      {
        title: "Strike rotation and over changes",
        text: "The striker changes after an odd number of runs and at the end of each over. If the scorer enters balls as `BallEvent` with striker and non-striker named explicitly, the model stays simple but the UI has to track rotation. A more convenient design has `Innings` track the two batsmen at the crease and rotate on `runs % 2 == 1` and over end. Be careful with the rules: a wide with a single added run doesn't rotate the strike, and runs from a no-ball hit off the bat do. Mention that this logic belongs in a small `StrikeRotationRule` so Test and limited-overs variants can share it."
      },
      {
        title: "Many readers, one writer",
        text: "Viewers outnumber the scorer by orders of magnitude. The `synchronized` methods here are fine for a single match, but every viewer read would block the scorer. Two better options: publish an immutable `MatchSnapshot` (score, overs, batsmen) after each ball into a `volatile` reference so readers never take the lock, or use a read-write lock. For fan-out to millions of devices, the observer list is replaced by a publish/subscribe broker, and `ScoreSubscriber` becomes one subscriber that publishes to it."
      }
    ],
    mistakes: [
      "Storing running totals and trying to keep them in sync with the balls.",
      "Counting wides and no-balls as legal deliveries, so overs advance wrongly.",
      "Crediting run outs to the bowler.",
      "Notifying subscribers before the ball is fully applied.",
      "Scattering `if (state == IN_PROGRESS)` checks across `Match` instead of using state classes.",
      "Don't force a pattern. Design patterns are good to have, but don't force one in just to impress the interviewer. State and Observer solve real problems here. A `Builder` for `BallEvent` would only hide a constructor."
    ],
    followups: [
      "How would you support Test matches with up to four innings and declarations?",
      "How would you calculate the required run rate and projected score?",
      "How would you add DRS reviews that change a decision after the fact?",
      "How would you handle rain delays and the DLS method?"
    ],
    patterns: ["observer", "state", "command"]
  },

  {
    id: "chess-game",
    name: "Design Chess Game",
    difficulty: "hard",
    understanding: "A two-player chess game must model the board, the six piece types with their movement rules, turn-taking, and the end of the game by checkmate, stalemate or resignation. The depth is in rules: a move is legal only if the piece can move that way, the path is clear, and it does not leave your own king in check.",
    dialogue: [
      { who: "you", text: "Is this two humans on one machine, or do I need an AI opponent?" },
      { who: "int", text: "Two human players taking turns. No AI." },
      { who: "you", text: "How complete should the rules be? Castling, en passant, promotion?" },
      { who: "int", text: "Standard moves, check, checkmate and stalemate. Treat special moves as an extension, but your design should make them possible." },
      { who: "you", text: "Should the game validate moves, rejecting illegal ones?" },
      { who: "int", text: "Yes. An illegal move leaves the game unchanged and the same player moves again." },
      { who: "you", text: "Do I keep a move history? Should there be undo?" },
      { who: "int", text: "Keep history and support undoing the last move." },
      { who: "you", text: "Do we need clocks or draw by repetition?" },
      { who: "int", text: "Out of scope for now." },
      { who: "you", text: "Should the board be an 8x8 array of pieces?" },
      { who: "int", text: "That's your call. Explain the choice." }
    ],
    requirements: [
      { group: "Core", items: [
        "An 8x8 board with the standard starting position.",
        "Each piece type moves by its own rules, and sliding pieces can't jump over others.",
        "Players alternate turns, White first.",
        "A move that leaves your own king in check is illegal.",
        "Detect check, checkmate and stalemate.",
        "Keep move history and allow undoing the last move."
      ] },
      { group: "Concurrency", items: [
        "Moves are applied one at a time; a game instance is not shared between threads without synchronisation."
      ] },
      { group: "Extensibility", items: [
        "Special moves (castling, en passant, promotion) can be added without rewriting existing piece logic.",
        "A new piece type (for a chess variant) can be added without changing the board."
      ] }
    ],
    entities: [
      { name: "Board", text: "An 8x8 grid of squares, each holding a piece or empty." },
      { name: "Position", text: "A row and column coordinate." },
      { name: "Piece", text: "Has a colour and decides which moves it can make." },
      { name: "PieceFactory", text: "Creates pieces for the starting position." },
      { name: "Move", text: "A command: from, to, captured piece, with execute and undo." },
      { name: "Player", text: "A colour with a name." },
      { name: "Game", text: "Owns the board, turn, history and status." },
      { name: "GameState", text: "Active, check, checkmate, stalemate or resigned." }
    ],
    design: [
      {
        heading: "Requirement 1: Board and pieces",
        text: "Use an 8x8 array of `Piece` references with null for empty squares. It's the simplest structure that gives O(1) lookup by position, which dominates move generation. `Position` is a small immutable value so it can be used in comparisons and sets.",
        code: [
          { file: "Color.java", body: `public enum Color {
    WHITE, BLACK;

    public Color opposite() { return this == WHITE ? BLACK : WHITE; }
}` },
          { file: "Position.java", body: `public final class Position {
    public final int row;
    public final int col;

    public Position(int row, int col) {
        this.row = row;
        this.col = col;
    }

    public boolean isOnBoard() { return row >= 0 && row < 8 && col >= 0 && col < 8; }

    public Position offset(int dRow, int dCol) { return new Position(row + dRow, col + dCol); }

    @Override public boolean equals(Object o) {
        return o instanceof Position p && p.row == row && p.col == col;
    }

    @Override public int hashCode() { return row * 8 + col; }
}` },
          { file: "Board.java", body: `public class Board {
    private final Piece[][] squares = new Piece[8][8];

    public Piece at(Position p) { return squares[p.row][p.col]; }

    public void place(Position p, Piece piece) { squares[p.row][p.col] = piece; }

    public void clear(Position p) { squares[p.row][p.col] = null; }

    public boolean isEmpty(Position p) { return at(p) == null; }

    public Position findKing(Color color) {
        for (int r = 0; r < 8; r++) {
            for (int c = 0; c < 8; c++) {
                Piece piece = squares[r][c];
                if (piece instanceof King && piece.getColor() == color) return new Position(r, c);
            }
        }
        throw new IllegalStateException("No king for " + color);
    }
}` },
          { file: "PieceFactory.java", body: `public class PieceFactory {
    public static Board standardBoard() {
        Board board = new Board();
        Class<?>[] backRank = { Rook.class, Knight.class, Bishop.class, Queen.class,
                                King.class, Bishop.class, Knight.class, Rook.class };
        for (int c = 0; c < 8; c++) {
            board.place(new Position(0, c), create(backRank[c], Color.WHITE));
            board.place(new Position(1, c), new Pawn(Color.WHITE));
            board.place(new Position(6, c), new Pawn(Color.BLACK));
            board.place(new Position(7, c), create(backRank[c], Color.BLACK));
        }
        return board;
    }

    private static Piece create(Class<?> type, Color color) {
        if (type == Rook.class) return new Rook(color);
        if (type == Knight.class) return new Knight(color);
        if (type == Bishop.class) return new Bishop(color);
        if (type == Queen.class) return new Queen(color);
        return new King(color);
    }
}` }
        ]
      },
      {
        heading: "Requirement 2: Each piece owns its movement rule",
        text: "Pieces answer one question: from this position on this board, which squares can I reach, ignoring check? Sliding pieces share the same walk-in-a-direction logic, so put it in the abstract base once. Subclasses just declare their directions.",
        code: [
          { file: "Piece.java", body: `import java.util.*;

public abstract class Piece {
    private final Color color;

    protected Piece(Color color) { this.color = color; }

    public Color getColor() { return color; }

    // Pseudo-legal targets: obey the piece's own rules but ignore check.
    public abstract List<Position> reachableFrom(Position from, Board board);

    protected List<Position> slide(Position from, Board board, int[][] directions) {
        List<Position> result = new ArrayList<>();
        for (int[] d : directions) {
            Position p = from.offset(d[0], d[1]);
            while (p.isOnBoard()) {
                Piece occupant = board.at(p);
                if (occupant == null) {
                    result.add(p);
                } else {
                    if (occupant.getColor() != color) result.add(p); // capture
                    break; // blocked
                }
                p = p.offset(d[0], d[1]);
            }
        }
        return result;
    }

    protected List<Position> step(Position from, Board board, int[][] offsets) {
        List<Position> result = new ArrayList<>();
        for (int[] o : offsets) {
            Position p = from.offset(o[0], o[1]);
            if (!p.isOnBoard()) continue;
            Piece occupant = board.at(p);
            if (occupant == null || occupant.getColor() != color) result.add(p);
        }
        return result;
    }
}` },
          { file: "Rook.java", body: `import java.util.List;

public class Rook extends Piece {
    private static final int[][] DIRS = { {1,0}, {-1,0}, {0,1}, {0,-1} };

    public Rook(Color color) { super(color); }

    public List<Position> reachableFrom(Position from, Board board) {
        return slide(from, board, DIRS);
    }
}` },
          { file: "Bishop.java", body: `import java.util.List;

public class Bishop extends Piece {
    private static final int[][] DIRS = { {1,1}, {1,-1}, {-1,1}, {-1,-1} };

    public Bishop(Color color) { super(color); }

    public List<Position> reachableFrom(Position from, Board board) {
        return slide(from, board, DIRS);
    }
}` },
          { file: "Queen.java", body: `import java.util.List;

public class Queen extends Piece {
    private static final int[][] DIRS = {
        {1,0}, {-1,0}, {0,1}, {0,-1}, {1,1}, {1,-1}, {-1,1}, {-1,-1}
    };

    public Queen(Color color) { super(color); }

    public List<Position> reachableFrom(Position from, Board board) {
        return slide(from, board, DIRS);
    }
}` },
          { file: "Knight.java", body: `import java.util.List;

public class Knight extends Piece {
    private static final int[][] JUMPS = {
        {2,1}, {2,-1}, {-2,1}, {-2,-1}, {1,2}, {1,-2}, {-1,2}, {-1,-2}
    };

    public Knight(Color color) { super(color); }

    public List<Position> reachableFrom(Position from, Board board) {
        return step(from, board, JUMPS);
    }
}` },
          { file: "King.java", body: `import java.util.List;

public class King extends Piece {
    private static final int[][] STEPS = {
        {1,0}, {-1,0}, {0,1}, {0,-1}, {1,1}, {1,-1}, {-1,1}, {-1,-1}
    };

    public King(Color color) { super(color); }

    public List<Position> reachableFrom(Position from, Board board) {
        return step(from, board, STEPS);
    }
}` },
          { file: "Pawn.java", body: `import java.util.*;

public class Pawn extends Piece {
    public Pawn(Color color) { super(color); }

    public List<Position> reachableFrom(Position from, Board board) {
        List<Position> result = new ArrayList<>();
        int dir = getColor() == Color.WHITE ? 1 : -1;
        int startRow = getColor() == Color.WHITE ? 1 : 6;

        Position one = from.offset(dir, 0);
        if (one.isOnBoard() && board.isEmpty(one)) {
            result.add(one);
            Position two = from.offset(2 * dir, 0);
            if (from.row == startRow && board.isEmpty(two)) result.add(two);
        }
        for (int dc : new int[] { -1, 1 }) {
            Position diag = from.offset(dir, dc);
            if (!diag.isOnBoard()) continue;
            Piece occupant = board.at(diag);
            if (occupant != null && occupant.getColor() != getColor()) result.add(diag);
        }
        return result;
    }
}` }
        ],
        note: "A pawn is the odd one: it moves forward but captures diagonally. Putting this in `Pawn` keeps the exception out of the board and the game."
      },
      {
        heading: "Requirement 6: Moves as commands with undo",
        text: "A move changes the board and must be reversible. Wrapping it in an object that knows how to apply and revert itself gives you history for free: the history is a stack of commands, and undo is `pop().undo()`. Capturing the captured piece inside the move is what makes the revert correct.",
        code: [
          { file: "Move.java", body: `public interface Move {
    void execute(Board board);
    void undo(Board board);
    Position from();
    Position to();
}` },
          { file: "StandardMove.java", body: `public class StandardMove implements Move {
    private final Position from;
    private final Position to;
    private Piece moved;
    private Piece captured;

    public StandardMove(Position from, Position to) {
        this.from = from;
        this.to = to;
    }

    public void execute(Board board) {
        moved = board.at(from);
        captured = board.at(to);
        board.clear(from);
        board.place(to, moved);
    }

    public void undo(Board board) {
        board.place(from, moved);
        if (captured != null) board.place(to, captured);
        else board.clear(to);
    }

    public Position from() { return from; }
    public Position to() { return to; }
}` }
        ]
      },
      {
        heading: "Requirement 4: Legality means 'not leaving your king in check'",
        text: "Generating moves for a piece gives pseudo-legal moves. A move is only legal if, after making it, your own king is not attacked. The simplest correct way is to try the move, test for check, and undo it. That reuses the same command we already need for history.",
        code: [
          { file: "RuleEngine.java", body: `import java.util.*;

public class RuleEngine {
    public boolean isInCheck(Board board, Color color) {
        Position king = board.findKing(color);
        for (int r = 0; r < 8; r++) {
            for (int c = 0; c < 8; c++) {
                Position p = new Position(r, c);
                Piece piece = board.at(p);
                if (piece != null && piece.getColor() != color
                        && piece.reachableFrom(p, board).contains(king)) {
                    return true;
                }
            }
        }
        return false;
    }

    public boolean isLegal(Board board, Color mover, Move move) {
        Piece piece = board.at(move.from());
        if (piece == null || piece.getColor() != mover) return false;
        if (!piece.reachableFrom(move.from(), board).contains(move.to())) return false;

        move.execute(board);
        boolean leavesKingInCheck = isInCheck(board, mover);
        move.undo(board);
        return !leavesKingInCheck;
    }

    public List<Move> legalMoves(Board board, Color color) {
        List<Move> moves = new ArrayList<>();
        for (int r = 0; r < 8; r++) {
            for (int c = 0; c < 8; c++) {
                Position from = new Position(r, c);
                Piece piece = board.at(from);
                if (piece == null || piece.getColor() != color) continue;
                for (Position to : piece.reachableFrom(from, board)) {
                    Move m = new StandardMove(from, to);
                    if (isLegal(board, color, m)) moves.add(m);
                }
            }
        }
        return moves;
    }
}` }
        ]
      },
      {
        heading: "Requirement 3 and 5: The game, turns and end conditions",
        text: "`Game` ties it together. After each move it evaluates the opponent's situation: no legal moves and in check is checkmate; no legal moves and not in check is stalemate. The status is modelled as a small state so the game rejects moves once it is over.",
        code: [
          { file: "GameStatus.java", body: `public enum GameStatus {
    ACTIVE, CHECK, CHECKMATE, STALEMATE, RESIGNED;

    public boolean isOver() {
        return this == CHECKMATE || this == STALEMATE || this == RESIGNED;
    }
}` },
          { file: "Game.java", body: `import java.util.*;

public class Game {
    private final Board board = PieceFactory.standardBoard();
    private final RuleEngine rules = new RuleEngine();
    private final Deque<Move> history = new ArrayDeque<>();
    private Color turn = Color.WHITE;
    private GameStatus status = GameStatus.ACTIVE;

    public synchronized boolean makeMove(Position from, Position to) {
        if (status.isOver()) throw new IllegalStateException("Game is over");

        Move move = new StandardMove(from, to);
        if (!rules.isLegal(board, turn, move)) return false; // unchanged, same player again

        move.execute(board);
        history.push(move);
        turn = turn.opposite();
        status = evaluate(turn);
        return true;
    }

    public synchronized void undo() {
        if (history.isEmpty()) throw new IllegalStateException("Nothing to undo");
        history.pop().undo(board);
        turn = turn.opposite();
        status = evaluate(turn);
    }

    public synchronized void resign(Color loser) {
        status = GameStatus.RESIGNED;
    }

    private GameStatus evaluate(Color toMove) {
        boolean inCheck = rules.isInCheck(board, toMove);
        boolean hasMoves = !rules.legalMoves(board, toMove).isEmpty();
        if (!hasMoves) return inCheck ? GameStatus.CHECKMATE : GameStatus.STALEMATE;
        return inCheck ? GameStatus.CHECK : GameStatus.ACTIVE;
    }

    public Color getTurn() { return turn; }
    public GameStatus getStatus() { return status; }
}` }
        ],
        note: "As written, undo of a capture restores the captured piece (the move remembers it), but undo does not handle special moves yet. Each special move type must implement its own `undo`."
      }
    ],
    deepDive: [
      {
        title: "Special moves without rewriting the pieces",
        text: "Castling moves two pieces, en passant removes a pawn that is not on the destination square, and promotion replaces a pawn with another piece. None of these fit 'move one piece from A to B'. Because moves are already command objects, add `CastlingMove`, `EnPassantMove` and `PromotionMove` implementing the same `Move` interface, each with its own `execute` and `undo`. Piece classes only need to offer these extra candidate moves (for example `King` proposing castling when its conditions hold) rather than changing how existing moves work. Rules that depend on history (castling needs an unmoved king and rook, en passant needs the previous move) read the move stack.",
        code: [
          { file: "PromotionMove.java", body: `public class PromotionMove implements Move {
    private final Position from;
    private final Position to;
    private final Piece promotedTo;
    private Piece pawn;
    private Piece captured;

    public PromotionMove(Position from, Position to, Piece promotedTo) {
        this.from = from;
        this.to = to;
        this.promotedTo = promotedTo;
    }

    public void execute(Board board) {
        pawn = board.at(from);
        captured = board.at(to);
        board.clear(from);
        board.place(to, promotedTo);
    }

    public void undo(Board board) {
        board.place(from, pawn);
        if (captured != null) board.place(to, captured);
        else board.clear(to);
    }

    public Position from() { return from; }
    public Position to() { return to; }
}` }
        ]
      },
      {
        title: "Checkmate and stalemate detection cost",
        text: "`evaluate` generates every legal move for the side to move. Each candidate is applied, checked for king safety (which scans the whole board for attackers) and reverted. That's roughly 30 moves times a 64-square scan, trivial for a human-speed game. If speed matters (an engine), keep attack maps updated incrementally, or find the king and trace outward along lines and knight jumps to see whether it is attacked, rather than asking every enemy piece for its moves. Being able to name this optimisation, and to say it is unnecessary here, is the right level for an interview."
      },
      {
        title: "Board as array vs map of pieces",
        text: "An 8x8 array gives O(1) lookup by square, which move generation does constantly, and the board is tiny and fixed. A `Map<Position, Piece>` is attractive for sparse boards or variants with huge boards, and it makes iterating all pieces cheap, but each lookup costs a hash. For standard chess the array wins; keep the representation private behind `Board` so changing your mind later affects one class."
      }
    ],
    mistakes: [
      "Putting every piece's movement rules in one giant switch inside `Board` or `Game`.",
      "Forgetting that sliding pieces are blocked by the first piece in their path.",
      "Checking only whether a move fits the piece's pattern and not whether it leaves your own king in check.",
      "Making `Move` a plain data object with no undo, then trying to reconstruct captured pieces from history.",
      "Detecting checkmate by checking only whether the king can move, ignoring blocks and captures by other pieces.",
      "Don't force a pattern. Design patterns are good to have, but don't force one in just to impress the interviewer. Polymorphic pieces and a command for moves each earn their keep here; a `Singleton` board or a `Visitor` over pieces does not."
    ],
    followups: [
      "How would you add castling, en passant and promotion?",
      "How would you detect draw by threefold repetition or the fifty-move rule?",
      "How would you add chess clocks with time controls?",
      "How would you design a simple computer opponent on top of this?"
    ],
    patterns: ["factory-method", "strategy", "command", "state"]
  }
);
