window.QUESTIONS = window.QUESTIONS || [];
window.QUESTIONS.push(
  /* ------------------------------------------------------------------ */
  {
    id: "online-bookstore",
    name: "Design Online Bookstore",
    difficulty: "medium",
    understanding: "Design the backend of an online bookstore where customers search a catalogue, place orders and pay. The core difficulty is not the CRUD around books; it is keeping inventory correct when many customers buy the last copies at once, and making the order flow (reserve stock, charge, confirm) safe when payment fails halfway.",
    dialogue: [
      { who: "you", text: "What can a customer do: browse, search, buy? Is there a cart, or does an order contain items directly?" },
      { who: "int", text: "Search the catalogue, then place an order for one or more books and pay. Keep the cart out of scope for now." },
      { who: "you", text: "How do customers search?" },
      { who: "int", text: "By title, author or subject. Partial title matches should work, and results should come back fast on a large catalogue." },
      { who: "you", text: "Does one book have multiple physical copies, and who manages stock?" },
      { who: "int", text: "Each book has a stock count. Staff restock it, and we want to be told when stock runs low." },
      { who: "you", text: "What if two customers order the last copy at the same moment?" },
      { who: "int", text: "Exactly one of them must succeed. We can never sell a copy we do not have." },
      { who: "you", text: "And if the payment fails after we reserved the stock?" },
      { who: "int", text: "The stock must go back. The customer should not lose a copy because their card was declined." },
      { who: "you", text: "Payment methods: cards only, or more to come?" },
      { who: "int", text: "Cards and UPI today. Wallets later, without rewriting the order flow." }
    ],
    requirements: [
      { group: "Core", items: [
        "Maintain a catalogue of books with title, authors, subjects and price.",
        "Search books by title, author and subject.",
        "Track stock per book and support restocking.",
        "A customer places an order for one or more books and pays for it.",
        "An order moves through a clear lifecycle: pending, confirmed, cancelled."
      ] },
      { group: "Concurrency", items: [
        "Stock can never go negative, even when many customers buy the last copy at once.",
        "If payment fails, reserved stock is released."
      ] },
      { group: "Extensibility", items: [
        "New search criteria can be added without changing the catalogue.",
        "New payment methods can be added without changing the order flow.",
        "Interested parties are notified when stock falls below a threshold."
      ] }
    ],
    entities: [
      { name: "Book", text: "A catalogue entry identified by ISBN, with title, authors, subjects and price. Immutable once created." },
      { name: "Catalog", text: "Holds all books and answers search queries." },
      { name: "BookFilter", text: "A single search criterion (by title, author or subject). Filters can be combined." },
      { name: "Inventory", text: "The stock count per ISBN. The only class allowed to change stock." },
      { name: "Customer", text: "The person placing orders." },
      { name: "Order", text: "A customer's purchase: line items, total, and a status." },
      { name: "OrderItem", text: "One book, a quantity and the unit price at the time of purchase." },
      { name: "OrderStatus", text: "An enum: PENDING, CONFIRMED, CANCELLED." },
      { name: "PaymentStrategy", text: "An interface for charging a customer, with one implementation per payment method." }
    ],
    design: [
      {
        heading: "Requirement 1: Model the catalogue",
        text: "A `Book` is a fact about a title, not a physical object, so it carries no stock. Keeping stock out of `Book` is a deliberate split: the catalogue changes rarely and is read constantly, while stock changes on every sale and needs locking. They should not share a class or a lock.",
        code: [
          { file: "Book.java", body: `import java.util.Set;

public final class Book {
    private final String isbn;
    private final String title;
    private final Set<String> authors;
    private final Set<String> subjects;
    private final long priceInPaise;

    public Book(String isbn, String title, Set<String> authors,
                Set<String> subjects, long priceInPaise) {
        this.isbn = isbn;
        this.title = title;
        this.authors = Set.copyOf(authors);
        this.subjects = Set.copyOf(subjects);
        this.priceInPaise = priceInPaise;
    }

    public String getIsbn() { return isbn; }
    public String getTitle() { return title; }
    public Set<String> getAuthors() { return authors; }
    public Set<String> getSubjects() { return subjects; }
    public long getPriceInPaise() { return priceInPaise; }
}` }
        ],
        note: "Money is stored as an integer number of the smallest unit (paise), never as `double`, to avoid rounding errors."
      },
      {
        heading: "Requirement 2: Search by title, author and subject",
        text: "Searching is a family of interchangeable criteria, so each one becomes a small `BookFilter`. The catalogue takes a filter and returns the matches. Adding a publisher filter later is a new class and no edit to `Catalog`. Filters can also be combined with `and`.",
        code: [
          { file: "BookFilter.java", body: `public interface BookFilter {
    boolean matches(Book book);

    default BookFilter and(BookFilter other) {
        return book -> this.matches(book) && other.matches(book);
    }
}` },
          { file: "Filters.java", body: `public final class Filters {
    private Filters() {}

    public static BookFilter titleContains(String text) {
        String needle = text.toLowerCase();
        return b -> b.getTitle().toLowerCase().contains(needle);
    }

    public static BookFilter byAuthor(String author) {
        String needle = author.toLowerCase();
        return b -> b.getAuthors().stream()
                .anyMatch(a -> a.toLowerCase().contains(needle));
    }

    public static BookFilter bySubject(String subject) {
        String needle = subject.toLowerCase();
        return b -> b.getSubjects().stream()
                .anyMatch(s -> s.toLowerCase().equals(needle));
    }
}` },
          { file: "Catalog.java", body: `import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

public class Catalog {
    private final Map<String, Book> booksByIsbn = new ConcurrentHashMap<>();

    public void add(Book book) {
        booksByIsbn.put(book.getIsbn(), book);
    }

    public Optional<Book> findByIsbn(String isbn) {
        return Optional.ofNullable(booksByIsbn.get(isbn));
    }

    public List<Book> search(BookFilter filter) {
        return booksByIsbn.values().stream()
                .filter(filter::matches)
                .collect(Collectors.toList());
    }
}` }
        ],
        note: "This scans every book on each search. That is fine to start with; the first deep dive shows how to make it fast with an index."
      },
      {
        heading: "Requirement 3: Track stock and restock",
        text: "`Inventory` is the single owner of stock counts. It exposes `reserve`, `release` and `restock` rather than a raw setter, so the invariant \"stock never goes negative\" lives in one place. `reserve` is atomic: it either takes all requested copies or none.",
        code: [
          { file: "Inventory.java", body: `import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

public class Inventory {
    private final Map<String, Integer> stock = new ConcurrentHashMap<>();
    private final List<StockListener> listeners = new ArrayList<>();
    private final int lowStockThreshold;

    public Inventory(int lowStockThreshold) {
        this.lowStockThreshold = lowStockThreshold;
    }

    public void addListener(StockListener l) { listeners.add(l); }

    public void restock(String isbn, int quantity) {
        stock.merge(isbn, quantity, Integer::sum);
    }

    /** Takes 'quantity' copies if available. Returns false and changes nothing otherwise. */
    public boolean reserve(String isbn, int quantity) {
        boolean[] ok = { false };
        stock.compute(isbn, (k, current) -> {
            int have = current == null ? 0 : current;
            if (have < quantity) return current;
            ok[0] = true;
            return have - quantity;
        });
        if (ok[0] && stock.get(isbn) <= lowStockThreshold) {
            int left = stock.get(isbn);
            listeners.forEach(l -> l.onLowStock(isbn, left));
        }
        return ok[0];
    }

    public void release(String isbn, int quantity) {
        stock.merge(isbn, quantity, Integer::sum);
    }

    public int available(String isbn) {
        return stock.getOrDefault(isbn, 0);
    }
}` },
          { file: "StockListener.java", body: `public interface StockListener {
    void onLowStock(String isbn, int remaining);
}` }
        ],
        note: "`ConcurrentHashMap.compute` runs the check and the decrement atomically for one key, so two buyers of the last copy cannot both succeed."
      },
      {
        heading: "Requirement 4: Place an order and pay",
        text: "Placing an order is three steps: reserve stock for every line, charge the customer, then confirm. If any step fails, undo the earlier ones. Reserving first and charging second means we never charge for a book we cannot ship.",
        code: [
          { file: "Order.java", body: `import java.util.List;
import java.util.UUID;

public class Order {
    public enum Status { PENDING, CONFIRMED, CANCELLED }

    private final String id = UUID.randomUUID().toString();
    private final String customerId;
    private final List<OrderItem> items;
    private Status status = Status.PENDING;

    public Order(String customerId, List<OrderItem> items) {
        this.customerId = customerId;
        this.items = List.copyOf(items);
    }

    public long total() {
        return items.stream().mapToLong(OrderItem::lineTotal).sum();
    }

    public void confirm() { status = Status.CONFIRMED; }
    public void cancel()  { status = Status.CANCELLED; }

    public String getId() { return id; }
    public String getCustomerId() { return customerId; }
    public List<OrderItem> getItems() { return items; }
    public Status getStatus() { return status; }
}` },
          { file: "OrderItem.java", body: `public class OrderItem {
    private final String isbn;
    private final int quantity;
    private final long unitPrice; // price when ordered, not today's price

    public OrderItem(String isbn, int quantity, long unitPrice) {
        this.isbn = isbn;
        this.quantity = quantity;
        this.unitPrice = unitPrice;
    }

    public long lineTotal() { return unitPrice * quantity; }
    public String getIsbn() { return isbn; }
    public int getQuantity() { return quantity; }
}` },
          { file: "OrderService.java", body: `import java.util.*;

public class OrderService {
    private final Catalog catalog;
    private final Inventory inventory;

    public OrderService(Catalog catalog, Inventory inventory) {
        this.catalog = catalog;
        this.inventory = inventory;
    }

    public Order placeOrder(String customerId, Map<String, Integer> isbnToQty,
                            PaymentStrategy payment) {
        List<OrderItem> items = new ArrayList<>();
        for (var e : isbnToQty.entrySet()) {
            Book book = catalog.findByIsbn(e.getKey())
                    .orElseThrow(() -> new IllegalArgumentException("Unknown book " + e.getKey()));
            items.add(new OrderItem(book.getIsbn(), e.getValue(), book.getPriceInPaise()));
        }
        Order order = new Order(customerId, items);

        // Reserve in a fixed (sorted) order; roll back on the first failure.
        List<OrderItem> reserved = new ArrayList<>();
        items.sort(Comparator.comparing(OrderItem::getIsbn));
        for (OrderItem item : items) {
            if (!inventory.reserve(item.getIsbn(), item.getQuantity())) {
                reserved.forEach(r -> inventory.release(r.getIsbn(), r.getQuantity()));
                order.cancel();
                return order;
            }
            reserved.add(item);
        }

        if (payment.charge(customerId, order.total())) {
            order.confirm();
        } else {
            reserved.forEach(r -> inventory.release(r.getIsbn(), r.getQuantity()));
            order.cancel();
        }
        return order;
    }
}` }
        ],
        note: "`OrderItem` stores the price at purchase time. If the book's price changes tomorrow, yesterday's order must not."
      },
      {
        heading: "Requirement 5: Add payment methods without touching the order flow",
        text: "The order flow only needs to know \"charge this customer this much\". Each payment method is a `PaymentStrategy`. Adding wallets is one new class, and `OrderService` does not change.",
        code: [
          { file: "PaymentStrategy.java", body: `public interface PaymentStrategy {
    /** Returns true if the charge succeeded. */
    boolean charge(String customerId, long amountInPaise);
}` },
          { file: "CardPayment.java", body: `public class CardPayment implements PaymentStrategy {
    private final CardGateway gateway;
    private final String cardToken;

    public CardPayment(CardGateway gateway, String cardToken) {
        this.gateway = gateway;
        this.cardToken = cardToken;
    }

    @Override
    public boolean charge(String customerId, long amount) {
        return gateway.authorizeAndCapture(cardToken, amount);
    }
}` },
          { file: "UpiPayment.java", body: `public class UpiPayment implements PaymentStrategy {
    private final UpiGateway gateway;
    private final String vpa;

    public UpiPayment(UpiGateway gateway, String vpa) {
        this.gateway = gateway;
        this.vpa = vpa;
    }

    @Override
    public boolean charge(String customerId, long amount) {
        return gateway.collect(vpa, amount);
    }
}` }
        ]
      }
    ],
    deepDive: [
      {
        title: "Making search fast on a large catalogue",
        text: "Scanning every book works for thousands of titles, not millions. Build indexes once at insert time and answer queries from them.\n\nAuthor and subject are exact-match lookups, so a `Map<String, Set<String>>` from author or subject to ISBNs gives O(1) lookup. Title search is partial, so build an inverted index from each lowercase word to the ISBNs that contain it, then intersect the sets for the query's words. For prefix or fuzzy matching, move this to a real search engine and keep the `BookFilter` API as the boundary.",
        code: [
          { file: "IndexedCatalog.java", body: `import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

public class IndexedCatalog {
    private final Map<String, Book> byIsbn = new ConcurrentHashMap<>();
    private final Map<String, Set<String>> byAuthor = new ConcurrentHashMap<>();
    private final Map<String, Set<String>> byWord = new ConcurrentHashMap<>();

    public void add(Book b) {
        byIsbn.put(b.getIsbn(), b);
        for (String a : b.getAuthors()) {
            byAuthor.computeIfAbsent(a.toLowerCase(), k -> ConcurrentHashMap.newKeySet()).add(b.getIsbn());
        }
        for (String w : b.getTitle().toLowerCase().split("\\\\s+")) {
            byWord.computeIfAbsent(w, k -> ConcurrentHashMap.newKeySet()).add(b.getIsbn());
        }
    }

    public List<Book> searchTitle(String query) {
        Set<String> result = null;
        for (String w : query.toLowerCase().split("\\\\s+")) {
            Set<String> hits = byWord.getOrDefault(w, Set.of());
            if (result == null) result = new HashSet<>(hits);
            else result.retainAll(hits);
        }
        List<Book> out = new ArrayList<>();
        if (result != null) result.forEach(isbn -> out.add(byIsbn.get(isbn)));
        return out;
    }
}` }
        ]
      },
      {
        title: "Never oversell: atomic reserve and lock ordering",
        text: "The race is two customers reading \"1 copy left\" and both decrementing. The fix is to make check-and-decrement one atomic step, which is what `reserve` does. For an order with several books you need all-or-nothing, which `placeOrder` gets by rolling back earlier reservations on the first failure.\n\nIf you move to explicit locks per book instead of `compute`, acquire them in a consistent order (sorted by ISBN) so two orders containing the same two books cannot deadlock by locking them in opposite orders. In a real deployment the stock row lives in a database, and the same idea becomes a conditional update: `UPDATE stock SET qty = qty - ? WHERE isbn = ? AND qty >= ?`, treating zero rows updated as \"out of stock\"."
      },
      {
        title: "Payment failure and idempotency",
        text: "Reserve-then-charge handles a clean decline, but real gateways can time out, leaving you unsure whether the customer was charged. Two safeguards help. First, give every order a unique id and pass it to the gateway as an idempotency key, so retrying the same charge cannot double-charge. Second, keep the order in `PENDING` with the reservation held for a bounded time, and run a reconciliation job that asks the gateway for the final result and then confirms or releases.\n\nThis is also why reserved stock should expire: a crashed process must not hold copies forever."
      }
    ],
    mistakes: [
      "Putting the stock count on `Book`, so every sale locks the same object that every search reads.",
      "Checking stock with `available()` and then decrementing in a separate step. The check and the decrement must be one atomic operation.",
      "Charging first and reserving second, which means charging customers for books you cannot ship.",
      "Reading today's price when displaying an old order. Snapshot the unit price on `OrderItem`.",
      "Using `double` for prices.",
      "Forcing a pattern in just to impress the interviewer. `BookFilter` and `PaymentStrategy` earn their place because requirements say these will grow; a Singleton `OrderManager` or an `AbstractBookFactory` would not."
    ],
    followups: [
      "How would you add a shopping cart in front of this order flow?",
      "How would you support discounts and coupons?",
      "How would you handle e-books, which have no stock, alongside physical books?",
      "How would you let customers reserve a title that is out of stock and notify them when it is back?",
      "How would you recover orders left in PENDING after a crash?"
    ],
    patterns: ["strategy", "observer"]
  },

  /* ------------------------------------------------------------------ */
  {
    id: "shopping-cart-system",
    name: "Design Shopping Cart System",
    difficulty: "medium",
    understanding: "Design the cart and checkout of an e-commerce site. A cart looks like a list with add and remove, but the real design questions are where pricing rules live, what happens when price or stock changes between adding an item and paying, and how checkout turns a mutable cart into an immutable order without charging twice.",
    dialogue: [
      { who: "you", text: "Is the cart tied to a logged-in user, or can guests have one too?" },
      { who: "int", text: "Logged-in users only for now. One active cart per user." },
      { who: "you", text: "What cart operations do we need?" },
      { who: "int", text: "Add an item, change its quantity, remove it, and view the cart with a running total." },
      { who: "you", text: "If a customer adds the same product twice, do we create two lines or merge?" },
      { who: "int", text: "Merge into one line and increase the quantity." },
      { who: "you", text: "How is the total computed? Any discounts or taxes?" },
      { who: "int", text: "Support a percentage coupon and a flat-amount coupon. More types will come. Keep tax out of scope." },
      { who: "you", text: "What if the price changes, or an item goes out of stock, after it is in the cart?" },
      { who: "int", text: "Show the current price. At checkout, if anything is unavailable, fail with a clear reason rather than charging for it." },
      { who: "you", text: "Checkout means pay, create an order and empty the cart, correct?" },
      { who: "int", text: "Yes. If payment fails, the cart must stay exactly as it was. Paying twice for one checkout must not happen." }
    ],
    requirements: [
      { group: "Core", items: [
        "Each user has one active cart.",
        "Add a product, update its quantity and remove it. Adding an existing product merges into one line.",
        "View the cart with line totals, discount and a grand total.",
        "Checkout validates stock, charges payment, creates an order and clears the cart.",
        "If payment fails, the cart is left untouched."
      ] },
      { group: "Concurrency", items: [
        "Two checkouts of the same cart (double click, two devices) produce only one order and one charge.",
        "Concurrent edits to one cart do not lose updates."
      ] },
      { group: "Extensibility", items: [
        "New discount types can be added without changing the cart.",
        "New payment methods can be added without changing checkout."
      ] }
    ],
    entities: [
      { name: "Product", text: "A sellable item with an id, name and current price." },
      { name: "CartItem", text: "A product id and a quantity in the cart. One line per product." },
      { name: "Cart", text: "A user's collection of items. Owns add, update and remove rules." },
      { name: "DiscountRule", text: "An interface that, given a subtotal, returns a discount amount. Percentage and flat-amount are implementations." },
      { name: "PricingService", text: "Turns a cart into a priced summary: subtotal, discount and total." },
      { name: "Order", text: "The immutable result of a successful checkout, with a price snapshot." },
      { name: "CheckoutService", text: "Orchestrates validation, payment, order creation and clearing the cart." },
      { name: "PaymentStrategy", text: "An interface for charging the customer." }
    ],
    design: [
      {
        heading: "Requirement 1: Add, update and remove items",
        text: "The cart keeps one `CartItem` per product in a map keyed by product id. That makes \"merge into one line\" fall out for free: adding an existing product just increases its quantity. The cart stores ids and quantities only, not prices, so it never shows a stale price.",
        code: [
          { file: "CartItem.java", body: `public class CartItem {
    private final String productId;
    private int quantity;

    public CartItem(String productId, int quantity) {
        this.productId = productId;
        this.quantity = quantity;
    }

    public String getProductId() { return productId; }
    public int getQuantity() { return quantity; }
    void setQuantity(int quantity) { this.quantity = quantity; }
}` },
          { file: "Cart.java", body: `import java.util.*;

public class Cart {
    private final String userId;
    private final Map<String, CartItem> items = new LinkedHashMap<>();
    private long version; // bumped on every change, used for checkout safety

    public Cart(String userId) { this.userId = userId; }

    public synchronized void add(String productId, int quantity) {
        requirePositive(quantity);
        items.merge(productId, new CartItem(productId, quantity), (existing, added) -> {
            existing.setQuantity(existing.getQuantity() + added.getQuantity());
            return existing;
        });
        version++;
    }

    public synchronized void updateQuantity(String productId, int quantity) {
        if (!items.containsKey(productId)) throw new NoSuchElementException(productId);
        if (quantity == 0) { items.remove(productId); }
        else { requirePositive(quantity); items.get(productId).setQuantity(quantity); }
        version++;
    }

    public synchronized void remove(String productId) {
        items.remove(productId);
        version++;
    }

    public synchronized List<CartItem> snapshot() {
        List<CartItem> copy = new ArrayList<>();
        for (CartItem i : items.values()) copy.add(new CartItem(i.getProductId(), i.getQuantity()));
        return copy;
    }

    public synchronized long getVersion() { return version; }
    public synchronized void clear() { items.clear(); version++; }
    public String getUserId() { return userId; }

    private static void requirePositive(int q) {
        if (q <= 0) throw new IllegalArgumentException("quantity must be positive");
    }
}` }
        ],
        note: "`snapshot()` returns copies so callers cannot mutate the cart behind its lock."
      },
      {
        heading: "Requirement 2: Price the cart with pluggable discounts",
        text: "Pricing is separate from the cart. `PricingService` looks up current prices, sums line totals into a subtotal, then asks each `DiscountRule` how much to take off. A new coupon type is a new `DiscountRule`; neither `Cart` nor `PricingService` changes.",
        code: [
          { file: "DiscountRule.java", body: `public interface DiscountRule {
    /** Returns the amount to subtract (never more than the subtotal). */
    long discountFor(long subtotal);
}` },
          { file: "PercentageDiscount.java", body: `public class PercentageDiscount implements DiscountRule {
    private final int percent;

    public PercentageDiscount(int percent) {
        if (percent < 0 || percent > 100) throw new IllegalArgumentException("percent");
        this.percent = percent;
    }

    @Override
    public long discountFor(long subtotal) {
        return subtotal * percent / 100;
    }
}` },
          { file: "FlatDiscount.java", body: `public class FlatDiscount implements DiscountRule {
    private final long amount;

    public FlatDiscount(long amount) { this.amount = amount; }

    @Override
    public long discountFor(long subtotal) {
        return Math.min(amount, subtotal);
    }
}` },
          { file: "PricingService.java", body: `import java.util.List;

public class PricingService {
    public record Summary(long subtotal, long discount, long total) {}

    private final ProductRepository products;

    public PricingService(ProductRepository products) { this.products = products; }

    public Summary price(List<CartItem> items, List<DiscountRule> rules) {
        long subtotal = 0;
        for (CartItem item : items) {
            Product p = products.get(item.getProductId());
            subtotal += p.getPrice() * item.getQuantity();
        }
        long discount = 0;
        for (DiscountRule rule : rules) discount += rule.discountFor(subtotal);
        discount = Math.min(discount, subtotal);
        return new Summary(subtotal, discount, subtotal - discount);
    }
}` }
        ]
      },
      {
        heading: "Requirement 3: Checkout and order creation",
        text: "Checkout works on a snapshot, not on the live cart. It re-prices, validates stock, charges, and only then creates the order and clears the cart. The order copies the price of each line so later price changes do not rewrite history.\n\nOrder matters: charge before clearing the cart. If the charge fails we return early and the cart is untouched, which is exactly the requirement.",
        code: [
          { file: "Order.java", body: `import java.util.List;
import java.util.UUID;

public class Order {
    public record Line(String productId, int quantity, long unitPrice) {}

    private final String id = UUID.randomUUID().toString();
    private final String userId;
    private final List<Line> lines;
    private final long total;

    public Order(String userId, List<Line> lines, long total) {
        this.userId = userId;
        this.lines = List.copyOf(lines);
        this.total = total;
    }

    public String getId() { return id; }
    public String getUserId() { return userId; }
    public List<Line> getLines() { return lines; }
    public long getTotal() { return total; }
}` },
          { file: "CheckoutService.java", body: `import java.util.*;

public class CheckoutService {
    private final ProductRepository products;
    private final StockService stock;
    private final PricingService pricing;
    private final OrderRepository orders;

    public CheckoutService(ProductRepository products, StockService stock,
                           PricingService pricing, OrderRepository orders) {
        this.products = products;
        this.stock = stock;
        this.pricing = pricing;
        this.orders = orders;
    }

    public Order checkout(Cart cart, List<DiscountRule> rules, PaymentStrategy payment) {
        long versionAtStart = cart.getVersion();
        List<CartItem> items = cart.snapshot();
        if (items.isEmpty()) throw new IllegalStateException("Cart is empty");

        // 1. Validate availability and build the price snapshot.
        List<Order.Line> lines = new ArrayList<>();
        for (CartItem item : items) {
            if (!stock.isAvailable(item.getProductId(), item.getQuantity())) {
                throw new OutOfStockException(item.getProductId());
            }
            long price = products.get(item.getProductId()).getPrice();
            lines.add(new Order.Line(item.getProductId(), item.getQuantity(), price));
        }
        PricingService.Summary summary = pricing.price(items, rules);

        // 2. Charge. On failure we return before touching the cart.
        if (!payment.charge(cart.getUserId(), summary.total())) {
            throw new PaymentFailedException();
        }

        // 3. Commit: create order, then clear the cart.
        Order order = new Order(cart.getUserId(), lines, summary.total());
        orders.save(order);
        if (cart.getVersion() == versionAtStart) {
            cart.clear();
        }
        return order;
    }
}` }
        ],
        note: "The version check shows why the cart keeps a counter: if the customer edited the cart while we were charging, we do not wipe their new changes."
      },
      {
        heading: "Requirement 4: Pluggable payment",
        text: "Checkout only needs \"charge this user this amount\". Card, UPI and wallet payments are separate `PaymentStrategy` classes, so adding one never touches `CheckoutService`.",
        code: [
          { file: "PaymentStrategy.java", body: `public interface PaymentStrategy {
    boolean charge(String userId, long amount);
}` },
          { file: "WalletPayment.java", body: `public class WalletPayment implements PaymentStrategy {
    private final WalletService wallets;

    public WalletPayment(WalletService wallets) { this.wallets = wallets; }

    @Override
    public boolean charge(String userId, long amount) {
        return wallets.debitIfSufficient(userId, amount);
    }
}` }
        ]
      }
    ],
    deepDive: [
      {
        title: "Stale prices and stock between add and pay",
        text: "There are two honest designs. Storing the price in the cart at add time makes the cart stable but can show an old price. Storing only the product id (as here) always shows the current price but the total can change under the customer. Most stores take the second path and show a notice such as \"price changed since you added this\".\n\nWhatever you choose, checkout is the point of truth: re-price and re-check stock there, then show the final total and charge exactly that. Never charge a total the customer did not see."
      },
      {
        title: "Preventing a double checkout",
        text: "Double clicks and two open tabs can start two checkouts of the same cart. Pass the client an idempotency key (the cart id plus its version) with the checkout request and store it with the order. A second request with the same key returns the existing order instead of charging again.\n\nIn a database-backed system, enforce this with a unique constraint on that key so even two servers racing cannot both succeed. The cart's `version` also guards the other direction: it stops checkout from clearing edits made while payment was in flight."
      },
      {
        title: "Reserving stock during checkout",
        text: "Checking stock and charging are separate steps, so the last unit can sell to someone else in between. The robust fix is to reserve units atomically at the start of checkout, charge, then commit the reservation or release it on failure, with an expiry so abandoned checkouts do not hold stock forever. Do not reserve when an item is merely added to a cart: carts are abandoned constantly and would lock up inventory."
      }
    ],
    mistakes: [
      "Storing a `Product` object inside `CartItem`, which freezes the price and mixes catalogue data into the cart.",
      "Clearing the cart before payment succeeds, so a declined card loses the customer's cart.",
      "Creating a new line every time the same product is added instead of merging.",
      "Letting `Order` reference live products, so changing a price rewrites old orders. Copy the price into the order lines.",
      "Making `Cart` a global Singleton. There is one cart per user, not one per application.",
      "Forcing a pattern in just to impress the interviewer. `DiscountRule` and `PaymentStrategy` are justified by the stated need for new types; adding a State machine to the cart is not."
    ],
    followups: [
      "How would you support guest carts that merge into the user's cart at login?",
      "How would you allow stacking rules, such as a coupon plus a bulk discount, with a clear order of application?",
      "How would you expire an inactive cart and release anything reserved?",
      "How would you add taxes and shipping to the total?",
      "How would you support saving an item for later?"
    ],
    patterns: ["strategy"]
  },

  /* ------------------------------------------------------------------ */
  {
    id: "notification-system",
    name: "Design Notification System",
    difficulty: "medium",
    understanding: "Design a service that sends notifications to users over email, SMS and push. Sending one message is easy. The design is about decoupling the callers from the channels, respecting each user's preferences, and making delivery reliable when providers are slow, down or rate limited.",
    dialogue: [
      { who: "you", text: "Who calls this service, and what do they send?" },
      { who: "int", text: "Other services: orders, payments, marketing. They say which user to notify and what about, not how." },
      { who: "you", text: "Which channels do we support?" },
      { who: "int", text: "Email, SMS and push today. A WhatsApp channel is planned for next quarter." },
      { who: "you", text: "Can users control which channels they receive?" },
      { who: "int", text: "Yes. A user can turn off a channel, or all marketing messages, and we must honour that." },
      { who: "you", text: "Is the message text written by the caller, or built from templates?" },
      { who: "int", text: "Templates with placeholders such as the user's name and an order id. Callers pass the values." },
      { who: "you", text: "What are the delivery guarantees? What if the email provider is down?" },
      { who: "int", text: "Do not lose notifications. Retry transient failures with backoff, and stop after a limit." },
      { who: "you", text: "Is a duplicate acceptable, like two identical SMS messages?" },
      { who: "int", text: "No. Retries must not create duplicates for the user." },
      { who: "you", text: "Should callers wait for the message to actually be delivered?" },
      { who: "int", text: "No. Accept it quickly, deliver asynchronously, and let callers look up the status." }
    ],
    requirements: [
      { group: "Core", items: [
        "Callers submit a notification for a user with a type and template values.",
        "Support email, SMS and push channels.",
        "Render the message from a template.",
        "Respect each user's channel preferences and opt-outs.",
        "Track the delivery status of every notification."
      ] },
      { group: "Concurrency", items: [
        "Submitting is fast; delivery happens asynchronously on worker threads.",
        "Failed sends are retried with backoff up to a limit, without creating duplicates.",
        "One slow channel does not block the others."
      ] },
      { group: "Extensibility", items: [
        "A new channel can be added without changing the core service.",
        "A fallback order can be configured, such as push first and then SMS."
      ] }
    ],
    entities: [
      { name: "Notification", text: "One message to one user: id, type, template values, and a status." },
      { name: "Channel", text: "An enum of the supported channels: EMAIL, SMS, PUSH." },
      { name: "NotificationChannel", text: "An interface with one implementation per channel. Knows how to talk to one provider." },
      { name: "Template", text: "Text with placeholders, rendered with the caller's values." },
      { name: "UserPreferences", text: "Which channels a user allows and which notification types they have opted out of." },
      { name: "NotificationService", text: "The entry point. Validates, applies preferences and enqueues." },
      { name: "DeliveryWorker", text: "Takes notifications from the queue, sends them and applies the retry policy." },
      { name: "DeliveryStatus", text: "An enum: QUEUED, SENT, FAILED, SUPPRESSED." }
    ],
    design: [
      {
        heading: "Requirement 1: Model notifications and templates",
        text: "A `Notification` is a request, not a rendered message. It carries a type and a map of values; the template turns that into text at send time. Callers never format messages, so wording can change without touching them.",
        code: [
          { file: "Notification.java", body: `import java.util.Map;
import java.util.UUID;

public class Notification {
    public enum Status { QUEUED, SENT, FAILED, SUPPRESSED }

    private final String id = UUID.randomUUID().toString();
    private final String userId;
    private final String type;                 // e.g. "ORDER_SHIPPED"
    private final Map<String, String> values;  // template placeholders
    private volatile Status status = Status.QUEUED;
    private volatile int attempts;

    public Notification(String userId, String type, Map<String, String> values) {
        this.userId = userId;
        this.type = type;
        this.values = Map.copyOf(values);
    }

    public String getId() { return id; }
    public String getUserId() { return userId; }
    public String getType() { return type; }
    public Map<String, String> getValues() { return values; }
    public Status getStatus() { return status; }
    public void setStatus(Status s) { this.status = s; }
    public int incrementAttempts() { return ++attempts; }
}` },
          { file: "Template.java", body: `import java.util.Map;

public class Template {
    private final String body; // e.g. "Hi {name}, order {orderId} has shipped."

    public Template(String body) { this.body = body; }

    public String render(Map<String, String> values) {
        String out = body;
        for (var e : values.entrySet()) {
            out = out.replace("{" + e.getKey() + "}", e.getValue());
        }
        return out;
    }
}` }
        ]
      },
      {
        heading: "Requirement 2: One interface per channel",
        text: "Each channel talks to a different provider with different rules, but the service only needs \"send this text to this user\". `NotificationChannel` is that contract. The service holds a map from `Channel` to implementation, so adding WhatsApp is a new class and one registration line.",
        code: [
          { file: "NotificationChannel.java", body: `public interface NotificationChannel {
    Channel type();

    /** Throws TransientSendException for retryable failures, PermanentSendException otherwise. */
    void send(String userId, String message, String idempotencyKey);
}` },
          { file: "EmailChannel.java", body: `public class EmailChannel implements NotificationChannel {
    private final EmailProvider provider;
    private final UserDirectory users;

    public EmailChannel(EmailProvider provider, UserDirectory users) {
        this.provider = provider;
        this.users = users;
    }

    @Override public Channel type() { return Channel.EMAIL; }

    @Override
    public void send(String userId, String message, String key) {
        String address = users.emailOf(userId);
        provider.send(address, "Notification", message, key);
    }
}` },
          { file: "SmsChannel.java", body: `public class SmsChannel implements NotificationChannel {
    private final SmsProvider provider;
    private final UserDirectory users;

    public SmsChannel(SmsProvider provider, UserDirectory users) {
        this.provider = provider;
        this.users = users;
    }

    @Override public Channel type() { return Channel.SMS; }

    @Override
    public void send(String userId, String message, String key) {
        provider.sendText(users.phoneOf(userId), message, key);
    }
}` }
        ]
      },
      {
        heading: "Requirement 3: Honour user preferences",
        text: "Preferences are checked before anything is queued. If the user has opted out of this type, mark the notification `SUPPRESSED` and stop; the caller still gets a status, so nothing silently disappears. Otherwise the service picks the user's allowed channels in priority order.",
        code: [
          { file: "UserPreferences.java", body: `import java.util.*;

public class UserPreferences {
    private final Set<Channel> enabledChannels;
    private final Set<String> optedOutTypes;

    public UserPreferences(Set<Channel> enabledChannels, Set<String> optedOutTypes) {
        this.enabledChannels = Set.copyOf(enabledChannels);
        this.optedOutTypes = Set.copyOf(optedOutTypes);
    }

    public boolean allows(String type) { return !optedOutTypes.contains(type); }

    public List<Channel> channelsInOrder(List<Channel> priority) {
        List<Channel> result = new ArrayList<>();
        for (Channel c : priority) if (enabledChannels.contains(c)) result.add(c);
        return result;
    }
}` },
          { file: "NotificationService.java", body: `import java.util.*;
import java.util.concurrent.BlockingQueue;

public class NotificationService {
    private final PreferenceRepository preferences;
    private final BlockingQueue<Notification> queue;
    private final NotificationStore store;

    public NotificationService(PreferenceRepository preferences,
                               BlockingQueue<Notification> queue,
                               NotificationStore store) {
        this.preferences = preferences;
        this.queue = queue;
        this.store = store;
    }

    /** Fast path: validate, apply preferences, enqueue. Never calls a provider. */
    public String submit(String userId, String type, Map<String, String> values) {
        Notification n = new Notification(userId, type, values);
        store.save(n);

        UserPreferences prefs = preferences.forUser(userId);
        if (!prefs.allows(type)) {
            n.setStatus(Notification.Status.SUPPRESSED);
            store.save(n);
            return n.getId();
        }
        queue.add(n);
        return n.getId();
    }

    public Notification.Status statusOf(String id) {
        return store.get(id).getStatus();
    }
}` }
        ],
        note: "`submit` returns as soon as the notification is queued. Callers poll `statusOf` or subscribe to status events if they care about the outcome."
      },
      {
        heading: "Requirement 4: Reliable, asynchronous delivery",
        text: "Worker threads pull from the queue and send. A `TransientSendException` (timeout, 503) is retried with exponential backoff and jitter, up to a limit. A `PermanentSendException` (invalid address) fails immediately, since retrying cannot help. The notification id doubles as the idempotency key, so a retry after an ambiguous timeout does not send a second copy.",
        code: [
          { file: "RetryPolicy.java", body: `import java.util.concurrent.ThreadLocalRandom;

public class RetryPolicy {
    private final int maxAttempts;
    private final long baseDelayMs;

    public RetryPolicy(int maxAttempts, long baseDelayMs) {
        this.maxAttempts = maxAttempts;
        this.baseDelayMs = baseDelayMs;
    }

    public boolean shouldRetry(int attemptsSoFar) {
        return attemptsSoFar < maxAttempts;
    }

    /** Exponential backoff with jitter: base * 2^attempt, randomised by up to 50%. */
    public long delayMs(int attemptsSoFar) {
        long exp = baseDelayMs * (1L << Math.min(attemptsSoFar, 10));
        long jitter = ThreadLocalRandom.current().nextLong(exp / 2 + 1);
        return exp / 2 + jitter;
    }
}` },
          { file: "DeliveryWorker.java", body: `import java.util.Map;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

public class DeliveryWorker implements Runnable {
    private final BlockingQueue<Notification> queue;
    private final ScheduledExecutorService scheduler;
    private final Map<Channel, NotificationChannel> channels;
    private final TemplateRepository templates;
    private final RetryPolicy retry;
    private final NotificationStore store;
    private final PreferenceRepository preferences;
    private final java.util.List<Channel> priority;

    public DeliveryWorker(BlockingQueue<Notification> queue, ScheduledExecutorService scheduler,
                          Map<Channel, NotificationChannel> channels, TemplateRepository templates,
                          RetryPolicy retry, NotificationStore store,
                          PreferenceRepository preferences, java.util.List<Channel> priority) {
        this.queue = queue; this.scheduler = scheduler; this.channels = channels;
        this.templates = templates; this.retry = retry; this.store = store;
        this.preferences = preferences; this.priority = priority;
    }

    @Override
    public void run() {
        while (!Thread.currentThread().isInterrupted()) {
            try {
                deliver(queue.take());
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }
    }

    void deliver(Notification n) {
        String message = templates.forType(n.getType()).render(n.getValues());
        UserPreferences prefs = preferences.forUser(n.getUserId());
        int attempt = n.incrementAttempts();

        for (Channel c : prefs.channelsInOrder(priority)) {
            try {
                channels.get(c).send(n.getUserId(), message, n.getId() + ":" + c);
                n.setStatus(Notification.Status.SENT);
                store.save(n);
                return;
            } catch (TransientSendException e) {
                if (retry.shouldRetry(attempt)) {
                    scheduler.schedule(() -> queue.add(n), retry.delayMs(attempt), TimeUnit.MILLISECONDS);
                    return;
                }
                // out of retries on this channel: fall through to the next channel
            } catch (PermanentSendException e) {
                // this channel cannot work for this user: try the next one
            }
        }
        n.setStatus(Notification.Status.FAILED);
        store.save(n);
    }
}` }
        ],
        note: "Retries are scheduled onto a timer and put back on the queue instead of sleeping, so a failing provider does not tie up a worker thread."
      }
    ],
    deepDive: [
      {
        title: "Retries, backoff and not sending duplicates",
        text: "Exponential backoff spreads retries out so a recovering provider is not hit by a thundering herd, and jitter stops every failed message from retrying at the same instant. Cap both the number of attempts and the maximum delay.\n\nThe subtle failure is the ambiguous timeout: the provider may have sent the SMS but the response was lost. If we retry blindly, the user gets two. Send a stable idempotency key (the notification id plus the channel) on every attempt and rely on providers that deduplicate on it. For providers that do not, record \"send started\" before the call and \"send confirmed\" after, and treat a started-but-unconfirmed message as needing manual or reconciled handling rather than an automatic resend."
      },
      {
        title: "Fallback chain across channels",
        text: "\"Try push, then SMS, then email\" is a chain: each handler tries to deliver and passes the request on only if it cannot. `DeliveryWorker` above loops over the user's channels in priority order, which is the simplest form of this. If the rules grow (quiet hours, escalate only for critical alerts, different chains per notification type), model each rule as a handler object linked to the next so the chain can be configured per type without editing the worker."
      },
      {
        title: "Isolation, rate limits and priority",
        text: "One shared queue lets a flood of marketing email delay a password-reset SMS. Use a separate queue and worker pool per channel so a slow provider only backs up its own queue, and add a priority lane so transactional messages (OTPs, payment alerts) overtake bulk marketing sends.\n\nProviders also impose rate limits. Put a token-bucket limiter inside each channel implementation so workers slow down before the provider starts rejecting requests. For very large fan-out, such as a campaign to a million users, have the caller submit one batch job that expands into per-user notifications gradually, instead of enqueueing a million items at once."
      }
    ],
    mistakes: [
      "Calling the email or SMS provider inside the request that submits the notification, so callers wait on slow third parties and fail when a provider is down.",
      "Retrying every failure, including permanent ones like an invalid phone number, which only wastes attempts.",
      "Retrying immediately in a tight loop with no backoff or jitter.",
      "Checking preferences at send time only, or not at all, so opted-out users still get messages.",
      "Embedding a `switch` on channel type in `NotificationService`, which must then change for every new channel.",
      "Forcing a pattern in just to impress the interviewer. `NotificationChannel` as a Strategy is clearly needed; a Chain of Responsibility only becomes worthwhile once fallback rules get complicated."
    ],
    followups: [
      "How would you add a WhatsApp channel?",
      "How would you support scheduled notifications, such as \"send tomorrow at 9am in the user's timezone\"?",
      "How would you batch many notifications into a daily digest email?",
      "How would you add a dead-letter queue and alerting for notifications that exhaust their retries?",
      "How would you guarantee a notification is not lost if the service crashes after enqueueing?"
    ],
    patterns: ["strategy", "chain-of-responsibility"]
  }
);
