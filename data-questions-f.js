window.QUESTIONS = window.QUESTIONS || [];
window.QUESTIONS.push(
  /* ------------------------------------------------------------------ */
  {
    id: "coffee-vending-machine",
    name: "Design Coffee Vending Machine",
    difficulty: "hard",
    understanding: "A coffee machine takes a drink order, checks that it has enough ingredients, brews it and deducts the ingredients. The hard parts are keeping the inventory consistent when several outlets brew at the same time, and making new drinks and add-ons a matter of data rather than new branches of code.",
    dialogue: [
      { who: "you", text: "Is this a single-outlet machine, or can it serve several drinks in parallel?" },
      { who: "int", text: "Assume N outlets. Up to N drinks can be brewing at the same time." },
      { who: "you", text: "How is a drink defined? Is it fixed in code, or does the operator configure it?" },
      { who: "int", text: "Each drink is a recipe: a list of ingredients and quantities. Operators add new drinks without a redeploy." },
      { who: "you", text: "What happens when ingredients run low halfway through a busy period?" },
      { who: "int", text: "The order should fail with a clear reason. Nothing should be half-consumed, and the machine should tell the operator what to refill." },
      { who: "you", text: "Do customers customise drinks, such as an extra shot or extra sugar?" },
      { who: "int", text: "Yes, add-ons that cost extra and use extra ingredients." },
      { who: "you", text: "Is payment in scope? I'd model it behind an interface and keep real payment gateways out." },
      { who: "int", text: "Agreed. Cash and card are enough, and a failed payment must not lose ingredients." }
    ],
    requirements: [
      { group: "Core", items: [
        "The machine offers a menu of beverages, each defined by a recipe of ingredients and quantities.",
        "Ordering a beverage checks ingredients, takes payment, brews and deducts ingredients.",
        "The operator can refill ingredients and see what is running low."
      ] },
      { group: "Concurrency", items: [
        "Up to N outlets brew simultaneously, and two orders must never consume the same ingredient units.",
        "Ingredient checking and deduction is all-or-nothing: a drink either gets every ingredient or none."
      ] },
      { group: "Extensibility", items: [
        "New beverages are added as data, with no change to the machine class.",
        "Customers can add paid add-ons to any beverage.",
        "New payment methods can be added without touching the ordering flow."
      ] }
    ],
    entities: [
      { name: "Ingredient", text: "An enum of things the machine stores, such as water, milk and coffee beans." },
      { name: "Recipe", text: "An immutable map of ingredient to quantity needed for one serving." },
      { name: "Beverage", text: "A named, priced drink with a recipe. Add-ons are beverages too." },
      { name: "Inventory", text: "Current stock of each ingredient with atomic check-and-consume." },
      { name: "CoffeeMachine", text: "The facade that owns the outlets and coordinates inventory and payment." },
      { name: "PaymentStrategy", text: "How money is collected: cash, card and so on." },
      { name: "OrderResult", text: "The outcome of an order: served, or failed with a reason." }
    ],
    design: [
      {
        heading: "Requirement 1: Beverages are recipes, not classes",
        text: "The tempting design is a class per drink: `Latte extends Beverage`, `Espresso extends Beverage`. That means every new drink is a code change. A recipe is just data, so one `Beverage` class holding a `Recipe` covers every drink on the menu.\n\nKeep `Recipe` immutable. It is shared by every order of that drink, and a mutable shared map would let one order corrupt another.",
        code: [
          { file: "Ingredient.java", body: `public enum Ingredient {
  WATER, MILK, COFFEE_BEANS, SUGAR, CHOCOLATE
}` },
          { file: "Recipe.java", body: `import java.util.EnumMap;
import java.util.Map;

public final class Recipe {
  private final Map<Ingredient, Integer> required;

  public Recipe(Map<Ingredient, Integer> required) {
    this.required = Map.copyOf(required);
  }

  public Map<Ingredient, Integer> required() {
    return required;
  }

  // Returns a new recipe; recipes are never mutated after creation.
  public Recipe plus(Ingredient ingredient, int quantity) {
    Map<Ingredient, Integer> merged = new EnumMap<>(Ingredient.class);
    merged.putAll(required);
    merged.merge(ingredient, quantity, Integer::sum);
    return new Recipe(merged);
  }
}` },
          { file: "Beverage.java", body: `public interface Beverage {
  String name();
  long priceCents();
  Recipe recipe();
}` },
          { file: "BasicBeverage.java", body: `public class BasicBeverage implements Beverage {
  private final String name;
  private final long priceCents;
  private final Recipe recipe;

  public BasicBeverage(String name, long priceCents, Recipe recipe) {
    this.name = name;
    this.priceCents = priceCents;
    this.recipe = recipe;
  }

  public String name() { return name; }
  public long priceCents() { return priceCents; }
  public Recipe recipe() { return recipe; }
}` }
        ],
        note: "The menu itself is a `Map<String, Beverage>` loaded from configuration. A new drink is a new entry, not a new class."
      },
      {
        heading: "Requirement 2: Check and consume ingredients atomically",
        text: "The invariant is that stock never goes negative and an order never takes half its ingredients. Checking stock and deducting it as two separate steps has a race: two orders both see 10 units of milk, both need 8, and both pass the check.\n\nPut the check and the deduction in one critical section inside `Inventory`. The lock belongs to the inventory, not the machine, because the inventory is the thing being protected.",
        code: [
          { file: "Inventory.java", body: `import java.util.EnumMap;
import java.util.HashMap;
import java.util.Map;

public class Inventory {
  private final Map<Ingredient, Integer> stock = new EnumMap<>(Ingredient.class);

  public synchronized void refill(Ingredient ingredient, int amount) {
    stock.merge(ingredient, amount, Integer::sum);
  }

  // All-or-nothing: either every ingredient is deducted, or none is.
  public synchronized boolean tryConsume(Recipe recipe) {
    for (Map.Entry<Ingredient, Integer> need : recipe.required().entrySet()) {
      if (stock.getOrDefault(need.getKey(), 0) < need.getValue()) {
        return false;
      }
    }
    recipe.required().forEach((ingredient, qty) -> stock.merge(ingredient, -qty, Integer::sum));
    return true;
  }

  // Undo a consume, for example when payment fails after ingredients were reserved.
  public synchronized void release(Recipe recipe) {
    recipe.required().forEach((ingredient, qty) -> stock.merge(ingredient, qty, Integer::sum));
  }

  public synchronized Map<Ingredient, Integer> lowOn(int threshold) {
    Map<Ingredient, Integer> low = new HashMap<>();
    for (Ingredient ingredient : Ingredient.values()) {
      int level = stock.getOrDefault(ingredient, 0);
      if (level < threshold) low.put(ingredient, level);
    }
    return low;
  }
}` }
        ],
        note: "`synchronized` is fine here because the critical section is tiny and in memory. Brewing takes seconds, so it must happen outside this lock."
      },
      {
        heading: "Requirement 3: N outlets brew in parallel",
        text: "Model the outlets as a fixed-size thread pool. Each outlet is one worker, so at most N drinks brew at once and extra orders queue naturally. `order()` returns a `Future` so the caller is not blocked while the drink brews.\n\nThe order of steps matters. Reserve ingredients first, charge the customer second, and release the ingredients if payment fails. Charging first risks taking money for a drink that cannot be made.",
        code: [
          { file: "OrderResult.java", body: `public final class OrderResult {
  public enum Status { SERVED, OUT_OF_INGREDIENTS, PAYMENT_FAILED }

  private final Status status;
  private final String message;

  private OrderResult(Status status, String message) {
    this.status = status;
    this.message = message;
  }

  public static OrderResult served(String drink) { return new OrderResult(Status.SERVED, drink + " is ready"); }
  public static OrderResult outOfIngredients(String drink) { return new OrderResult(Status.OUT_OF_INGREDIENTS, "Cannot make " + drink + ": ingredients low"); }
  public static OrderResult paymentFailed() { return new OrderResult(Status.PAYMENT_FAILED, "Payment was declined"); }

  public Status status() { return status; }
  public String message() { return message; }
}` },
          { file: "CoffeeMachine.java", body: `import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

public class CoffeeMachine {
  private final Inventory inventory;
  private final ExecutorService outlets;

  public CoffeeMachine(Inventory inventory, int outletCount) {
    this.inventory = inventory;
    this.outlets = Executors.newFixedThreadPool(outletCount);
  }

  public Future<OrderResult> order(Beverage beverage, PaymentStrategy payment) {
    return outlets.submit(() -> {
      // 1. Reserve ingredients atomically.
      if (!inventory.tryConsume(beverage.recipe())) {
        return OrderResult.outOfIngredients(beverage.name());
      }
      // 2. Charge. If it fails, give the ingredients back.
      if (!payment.charge(beverage.priceCents())) {
        inventory.release(beverage.recipe());
        return OrderResult.paymentFailed();
      }
      // 3. Brew outside any lock; this is the slow part.
      brew(beverage);
      return OrderResult.served(beverage.name());
    });
  }

  private void brew(Beverage beverage) {
    try {
      Thread.sleep(2000); // stands in for heating, grinding and pouring
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
    }
  }

  public void shutdown() {
    outlets.shutdown();
  }
}` }
        ]
      },
      {
        heading: "Requirement 4: Add-ons without a subclass per combination",
        text: "Extra shot, extra sugar, extra milk and every combination of them would be an explosion of subclasses if you tried to inherit. Each add-on is a wrapper that is itself a `Beverage`: it adds to the price and to the recipe, then delegates to what it wraps. Add-ons stack in any order, and the inventory check automatically covers the extra ingredients because it sees the combined recipe.",
        code: [
          { file: "AddOn.java", body: `public abstract class AddOn implements Beverage {
  protected final Beverage base;

  protected AddOn(Beverage base) {
    this.base = base;
  }
}` },
          { file: "ExtraShot.java", body: `public class ExtraShot extends AddOn {
  public ExtraShot(Beverage base) { super(base); }

  public String name() { return base.name() + " + extra shot"; }
  public long priceCents() { return base.priceCents() + 50; }
  public Recipe recipe() { return base.recipe().plus(Ingredient.COFFEE_BEANS, 10); }
}` },
          { file: "ExtraSugar.java", body: `public class ExtraSugar extends AddOn {
  public ExtraSugar(Beverage base) { super(base); }

  public String name() { return base.name() + " + sugar"; }
  public long priceCents() { return base.priceCents() + 10; }
  public Recipe recipe() { return base.recipe().plus(Ingredient.SUGAR, 5); }
}` },
          { file: "Usage.java", body: `Beverage latte = menu.get("latte");
Beverage custom = new ExtraSugar(new ExtraShot(latte));

Future<OrderResult> result = machine.order(custom, new CardPayment());` }
        ]
      },
      {
        heading: "Requirement 5: Payment behind an interface",
        text: "The machine only needs to know whether the charge succeeded. A `PaymentStrategy` interface keeps cash, card and any future method out of the ordering flow. Adding a wallet is a new class that the machine never hears about.",
        code: [
          { file: "PaymentStrategy.java", body: `public interface PaymentStrategy {
  // Returns true if the amount was collected.
  boolean charge(long amountCents);
}` },
          { file: "CashPayment.java", body: `public class CashPayment implements PaymentStrategy {
  private long insertedCents;

  public void insert(long cents) { insertedCents += cents; }

  public boolean charge(long amountCents) {
    if (insertedCents < amountCents) return false;
    insertedCents -= amountCents; // remaining balance is returned as change
    return true;
  }
}` },
          { file: "CardPayment.java", body: `public class CardPayment implements PaymentStrategy {
  private final CardGateway gateway;

  public CardPayment(CardGateway gateway) { this.gateway = gateway; }

  public boolean charge(long amountCents) {
    return gateway.authorize(amountCents);
  }
}` }
        ]
      }
    ],
    deepDive: [
      {
        title: "Why lock only the inventory, and not the whole order",
        text: "A single `synchronized` on `order()` would make the machine correct, but it also serialises brewing, so N outlets behave like one. The shared resource is the inventory, not the order. By locking only inside `tryConsume` and `release`, the critical section lasts microseconds, and the two-second brew runs in parallel across outlets.\n\nReserving ingredients before brewing also means a drink that has started is guaranteed to finish. There is no point mid-brew where the machine discovers it ran out."
      },
      {
        title: "Alternatives to a single inventory lock",
        text: "One lock per ingredient lets orders for different drinks proceed without contending, but it brings back the multi-lock problem: an order needing milk then beans can deadlock with one needing beans then milk. The fix is to always acquire locks in a fixed order, for example by enum ordinal.\n\nFor a machine with a handful of ingredients and tiny critical sections, the single lock is simpler and never the bottleneck. Name the per-ingredient design, say why you did not choose it, and move on.",
        code: [
          { file: "OrderedLocks.java", body: `// Sketch: acquire per-ingredient locks in enum order to avoid deadlock.
List<Ingredient> needed = new ArrayList<>(recipe.required().keySet());
Collections.sort(needed); // enum natural order = ordinal order
for (Ingredient i : needed) locks.get(i).lock();
try {
  // check then deduct
} finally {
  for (int k = needed.size() - 1; k >= 0; k--) locks.get(needed.get(k)).unlock();
}` }
        ]
      },
      {
        title: "Running low: telling the operator",
        text: "`lowOn(threshold)` gives the operator a snapshot, but a real machine should notify as soon as a level crosses the threshold. The inventory can accept listeners and call them after the deduction, outside the lock, so a slow listener cannot stall brewing. Keep the notification as a hook; do not build a notification system in the interview."
      }
    ],
    mistakes: [
      "Creating a subclass per drink, or per drink and add-on combination, instead of treating recipes and add-ons as data and composition.",
      "Checking stock and deducting it in two separate steps, which lets two outlets consume the same units.",
      "Holding the inventory lock while brewing, which serialises every outlet.",
      "Charging the customer before reserving ingredients, or forgetting to release ingredients when payment fails.",
      "Using a mutable `Recipe` shared across orders. Add-ons then leak into later orders.",
      "Forcing a pattern in just to impress the interviewer. Decorator earns its place for stackable add-ons and Strategy for payment, but not everything needs a pattern; the inventory is just a locked map."
    ],
    followups: [
      "How would you support a drink that needs ingredients to be used in sequence, such as steaming milk before pouring?",
      "How would you make the machine survive a restart without losing inventory counts?",
      "What changes if two physical machines share one remote inventory?",
      "How would you add a maintenance mode that rejects new orders but lets running brews finish?"
    ],
    patterns: ["decorator", "strategy"]
  },

  /* ------------------------------------------------------------------ */
  {
    id: "restaurant-management-system",
    name: "Design Restaurant Management System",
    difficulty: "hard",
    understanding: "A restaurant system connects the floor, the kitchen and the till. Staff seat guests at tables, take orders, the kitchen prepares them, and the system produces a bill. The interesting design questions are how an order moves through a controlled lifecycle, how the kitchen learns about new orders without being coupled to the waiter code, and how billing rules like discounts stay flexible.",
    dialogue: [
      { who: "you", text: "Which flows are in scope: reservations, walk-ins, ordering, kitchen, billing?" },
      { who: "int", text: "Seating, ordering, kitchen preparation and billing. Skip online reservations and inventory of raw ingredients." },
      { who: "you", text: "So I'll treat reservations as an extension and start with walk-ins only. Is that okay?" },
      { who: "int", text: "Yes, but your design should not make reservations hard to add later." },
      { who: "you", text: "Can one table have several orders, for example a second round of drinks?" },
      { who: "int", text: "Yes. A table can place multiple orders during one visit, and the bill covers all of them." },
      { who: "you", text: "What does the kitchen need to see, and who is told when food is ready?" },
      { who: "int", text: "The kitchen sees new orders. When food is ready, the waiter is notified." },
      { who: "you", text: "For billing, are discounts and tax fixed, or should they vary?" },
      { who: "int", text: "Tax is fixed. Discounts vary: festival offers, loyalty, a manager override." },
      { who: "you", text: "And several waiters work at once, so two of them must not seat different parties at the same table?" },
      { who: "int", text: "Exactly." }
    ],
    requirements: [
      { group: "Core", items: [
        "Seat a party at the smallest available table that fits, and free the table when they leave.",
        "Take orders from a table made of menu items with quantities. A table can place several orders in one visit.",
        "Orders move through placed, preparing, ready and served; illegal jumps are rejected.",
        "Generate a bill for all orders of a visit, with tax and an optional discount."
      ] },
      { group: "Concurrency", items: [
        "Two waiters must never seat different parties at the same table."
      ] },
      { group: "Extensibility", items: [
        "The kitchen and waiters react to order changes without the order knowing who they are.",
        "New discount rules plug in without changing the billing code.",
        "Reservations can be added later without redesigning tables."
      ] }
    ],
    entities: [
      { name: "Table", text: "A physical table with a capacity and a status." },
      { name: "TableService", text: "Owns the tables and hands them out safely to concurrent waiters." },
      { name: "MenuItem", text: "A dish with a name and a price." },
      { name: "Order", text: "One round of items for a table, with a status." },
      { name: "OrderItem", text: "A line on an order: item name, price at order time and quantity." },
      { name: "OrderListener", text: "Anyone interested in order status changes, such as the kitchen display or a waiter's pager." },
      { name: "DiscountStrategy", text: "A rule that reduces the bill." },
      { name: "Bill", text: "The final amounts: subtotal, discount, tax and total." }
    ],
    design: [
      {
        heading: "Requirement 1: Seating guests safely",
        text: "`TableService` is the only place that changes a table's status. Finding a free table and marking it occupied must happen as one step; otherwise two waiters can both see table 4 as free and seat two parties there. Choosing the smallest table that fits keeps large tables available for large parties.\n\nReservations later become another status, `RESERVED`, and another path into `seat`, so the model already has room for them.",
        code: [
          { file: "Table.java", body: `public class Table {
  public enum Status { AVAILABLE, OCCUPIED, RESERVED }

  private final int id;
  private final int capacity;
  private Status status = Status.AVAILABLE;

  public Table(int id, int capacity) {
    this.id = id;
    this.capacity = capacity;
  }

  public int id() { return id; }
  public int capacity() { return capacity; }
  Status status() { return status; }
  void setStatus(Status status) { this.status = status; }
}` },
          { file: "TableService.java", body: `import java.util.Comparator;
import java.util.List;
import java.util.Optional;

public class TableService {
  private final List<Table> tables;

  public TableService(List<Table> tables) {
    this.tables = tables;
  }

  // Find and claim in one critical section so two waiters cannot get the same table.
  public synchronized Optional<Table> seat(int partySize) {
    Optional<Table> best = tables.stream()
        .filter(t -> t.status() == Table.Status.AVAILABLE && t.capacity() >= partySize)
        .min(Comparator.comparingInt(Table::capacity));
    best.ifPresent(t -> t.setStatus(Table.Status.OCCUPIED));
    return best;
  }

  public synchronized void free(Table table) {
    table.setStatus(Table.Status.AVAILABLE);
  }
}` }
        ]
      },
      {
        heading: "Requirement 2: Orders hold a price snapshot",
        text: "An `OrderItem` copies the item's name and price at the moment of ordering. If the menu price changes while the meal is in progress, the bill must still charge what the guest was shown. Referencing the live `MenuItem` for price would silently change totals.\n\nA table keeps a list of orders for the visit. The bill sums across them.",
        code: [
          { file: "MenuItem.java", body: `public class MenuItem {
  private final String name;
  private final long priceCents;

  public MenuItem(String name, long priceCents) {
    this.name = name;
    this.priceCents = priceCents;
  }

  public String name() { return name; }
  public long priceCents() { return priceCents; }
}` },
          { file: "OrderItem.java", body: `public final class OrderItem {
  private final String name;
  private final long unitPriceCents;
  private final int quantity;

  public OrderItem(MenuItem item, int quantity) {
    this.name = item.name();
    this.unitPriceCents = item.priceCents(); // snapshot, not a live reference
    this.quantity = quantity;
  }

  public long totalCents() { return unitPriceCents * quantity; }
  public String name() { return name; }
  public int quantity() { return quantity; }
}` }
        ]
      },
      {
        heading: "Requirement 3: A controlled order lifecycle",
        text: "An order should only move forward through legal steps. Put the allowed transitions next to the statuses, and make `Order.advance` the only way to change status. A `SERVED` order cannot return to `PREPARING`, and an order can be cancelled only before the kitchen starts it.\n\nThis is a light form of the State pattern: the rules live in one place instead of `if (status == ...)` checks scattered across the waiter and kitchen code.",
        code: [
          { file: "OrderStatus.java", body: `public enum OrderStatus {
  PLACED, PREPARING, READY, SERVED, CANCELLED;

  public boolean canMoveTo(OrderStatus next) {
    switch (this) {
      case PLACED:    return next == PREPARING || next == CANCELLED;
      case PREPARING: return next == READY;
      case READY:     return next == SERVED;
      default:        return false; // SERVED and CANCELLED are terminal
    }
  }
}` },
          { file: "Order.java", body: `import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

public class Order {
  private final long id;
  private final Table table;
  private final List<OrderItem> items;
  private OrderStatus status = OrderStatus.PLACED;
  private final List<OrderListener> listeners = new CopyOnWriteArrayList<>();

  public Order(long id, Table table, List<OrderItem> items) {
    this.id = id;
    this.table = table;
    this.items = List.copyOf(items);
  }

  public synchronized void advance(OrderStatus next) {
    if (!status.canMoveTo(next)) {
      throw new IllegalStateException("Cannot move order " + id + " from " + status + " to " + next);
    }
    OrderStatus previous = status;
    status = next;
    for (OrderListener listener : listeners) {
      listener.onStatusChanged(this, previous, next);
    }
  }

  public void addListener(OrderListener listener) { listeners.add(listener); }
  public long id() { return id; }
  public Table table() { return table; }
  public List<OrderItem> items() { return items; }
  public synchronized OrderStatus status() { return status; }

  public long subtotalCents() {
    return items.stream().mapToLong(OrderItem::totalCents).sum();
  }
}` }
        ]
      },
      {
        heading: "Requirement 4: Kitchen and waiters listen, the order doesn't know them",
        text: "When an order is placed the kitchen needs to see it, and when it is ready the waiter must be told. If `Order` called `Kitchen.display(this)` directly, the order would depend on every consumer. Instead consumers register as listeners. Adding an SMS to the guest later is one more listener, not a change to `Order`.",
        code: [
          { file: "OrderListener.java", body: `public interface OrderListener {
  void onStatusChanged(Order order, OrderStatus from, OrderStatus to);
}` },
          { file: "KitchenDisplay.java", body: `public class KitchenDisplay implements OrderListener {
  public void onStatusChanged(Order order, OrderStatus from, OrderStatus to) {
    if (to == OrderStatus.PLACED) {
      show("New order " + order.id() + " for table " + order.table().id());
    }
  }

  public void showNew(Order order) {
    show("New order " + order.id() + " for table " + order.table().id());
  }

  private void show(String line) { System.out.println("[KITCHEN] " + line); }
}` },
          { file: "WaiterPager.java", body: `public class WaiterPager implements OrderListener {
  public void onStatusChanged(Order order, OrderStatus from, OrderStatus to) {
    if (to == OrderStatus.READY) {
      System.out.println("[PAGER] Order " + order.id() + " is ready for table " + order.table().id());
    }
  }
}` }
        ],
        note: "`PLACED` is the initial status, so no transition into it ever fires. The service that creates an order calls `kitchen.showNew(order)` once, and listeners cover every later change."
      },
      {
        heading: "Requirement 5: Billing with pluggable discounts",
        text: "The bill adds up every order for the visit, applies one discount, then adds tax on the discounted amount. The discount is a `DiscountStrategy`, so a festival offer, a loyalty rate or a manager override is a new class that `BillingService` never sees.\n\nCancelled orders are excluded from the bill.",
        code: [
          { file: "DiscountStrategy.java", body: `public interface DiscountStrategy {
  long discountFor(long subtotalCents);
}` },
          { file: "PercentOff.java", body: `public class PercentOff implements DiscountStrategy {
  private final int percent;

  public PercentOff(int percent) { this.percent = percent; }

  public long discountFor(long subtotalCents) {
    return subtotalCents * percent / 100;
  }
}` },
          { file: "BillingService.java", body: `import java.util.List;

public class BillingService {
  private static final int TAX_PERCENT = 5;

  public Bill billFor(List<Order> orders, DiscountStrategy discount) {
    long subtotal = orders.stream()
        .filter(o -> o.status() != OrderStatus.CANCELLED)
        .mapToLong(Order::subtotalCents)
        .sum();
    long discountAmount = Math.min(subtotal, discount.discountFor(subtotal));
    long taxable = subtotal - discountAmount;
    long tax = taxable * TAX_PERCENT / 100;
    return new Bill(subtotal, discountAmount, tax, taxable + tax);
  }
}` },
          { file: "Bill.java", body: `public final class Bill {
  public final long subtotalCents;
  public final long discountCents;
  public final long taxCents;
  public final long totalCents;

  public Bill(long subtotalCents, long discountCents, long taxCents, long totalCents) {
    this.subtotalCents = subtotalCents;
    this.discountCents = discountCents;
    this.taxCents = taxCents;
    this.totalCents = totalCents;
  }
}` }
        ]
      }
    ],
    deepDive: [
      {
        title: "Money as integers",
        text: "Every amount here is a `long` in cents. Floating point cannot represent 0.10 exactly, so sums of prices drift by fractions of a cent and totals stop matching receipts. In a real system use a `Money` type that carries the currency and rounding rule. Percentage maths needs a stated rounding policy; integer division truncates, which is fine for a sketch and something to call out."
      },
      {
        title: "Adding reservations later",
        text: "Reservations add a new way to claim a table at a future time. `TableService.seat` stays the walk-in path. A `ReservationService` stores time-slot bookings per table and checks overlap, the same interval logic used in car rental or hotel booking. Because `Table` already has a `RESERVED` status and `TableService` is the only writer of status, the existing code does not change.\n\nThe tension to mention is a walk-in sitting at a table that is reserved in 30 minutes. A simple rule: a walk-in may take a table only if its estimated dining time ends before the next reservation."
      },
      {
        title: "Listener ordering and failures",
        text: "`Order.advance` notifies listeners while holding the order's lock, so a slow or throwing listener delays or breaks the transition. Two safer options: collect listeners and notify after releasing the lock, or deliver events through a queue so consumers run on their own threads. For an interview, say which you would choose and why; for a small in-process app, notifying after the state change with each call in a try/catch is usually enough."
      }
    ],
    mistakes: [
      "Letting any code set `order.status` directly, so illegal jumps like `SERVED` back to `PREPARING` become possible.",
      "Checking for a free table and claiming it as two steps, which seats two parties at one table.",
      "Storing a reference to the menu item for price, so a price change alters an in-flight order.",
      "Having `Order` call the kitchen or waiter classes directly, which couples the domain to its consumers.",
      "Hard-coding discount rules in the billing method.",
      "Forcing a pattern in just to impress the interviewer. Observer and Strategy help here, but a full State class hierarchy for five statuses would be more code than value."
    ],
    followups: [
      "How would you split one bill among several guests?",
      "How would you let the kitchen track each dish separately, so a starter can be ready before the main?",
      "How would you handle an order being cancelled after the kitchen started preparing?",
      "How would you add inventory so items disappear from the menu when sold out?"
    ],
    patterns: ["state", "observer", "strategy"]
  },

  /* ------------------------------------------------------------------ */
  {
    id: "online-stock-exchange",
    name: "Design Online Stock Exchange",
    difficulty: "hard",
    understanding: "An exchange accepts buy and sell orders for stocks and matches them against each other. Every stock has an order book of waiting orders, and an incoming order trades with the best opposite orders first. The design has to get matching rules exactly right (price, then time priority, with partial fills) and keep the book consistent under heavy concurrent traffic.",
    dialogue: [
      { who: "you", text: "What order types do we support at first?" },
      { who: "int", text: "Limit and market orders, buy and sell. Cancellation too." },
      { who: "you", text: "How should competing orders be prioritised when several can match?" },
      { who: "int", text: "Best price first. Among equal prices, the order that arrived first wins." },
      { who: "you", text: "Are partial fills allowed? A buy for 100 shares may meet a sell of only 40." },
      { who: "int", text: "Yes. Fill what you can, and the rest of a limit order waits on the book." },
      { who: "you", text: "What about a market order that can't be filled fully?" },
      { who: "int", text: "It fills what is available and the remainder is dropped. It never rests on the book." },
      { who: "you", text: "What price does a trade execute at when a buy at 102 meets a resting sell at 100?" },
      { who: "int", text: "At the resting order's price, which is 100." },
      { who: "you", text: "Can I leave out accounts, balances and settlement and focus on matching?" },
      { who: "int", text: "Yes, but mention where checks would plug in. Also, traders want to be notified of their trades." }
    ],
    requirements: [
      { group: "Core", items: [
        "Place limit and market orders, buy or sell, for a stock symbol.",
        "Match incoming orders against the opposite side by best price, then earliest arrival.",
        "Support partial fills; unfilled limit quantity rests on the book, unfilled market quantity is dropped.",
        "Cancel an order that is still resting on the book.",
        "Trades execute at the resting order's price."
      ] },
      { group: "Concurrency", items: [
        "Matching for one symbol must be strictly sequential and deterministic.",
        "Different symbols should be processed in parallel."
      ] },
      { group: "Extensibility", items: [
        "New order types, such as stop or fill-or-kill, plug in without rewriting the matching loop.",
        "Interested parties can subscribe to trades, for portfolios, market data or notifications."
      ] }
    ],
    entities: [
      { name: "Order", text: "A request to buy or sell a quantity of a symbol, with remaining quantity tracked." },
      { name: "OrderType", text: "The matching rules that differ between limit and market orders." },
      { name: "OrderBook", text: "The resting buy and sell orders for one symbol, sorted by price then time." },
      { name: "MatchingEngine", text: "Matches an incoming order against a book and produces trades." },
      { name: "Trade", text: "An executed match between a buy and a sell: price, quantity and parties." },
      { name: "TradeListener", text: "Receives each executed trade." },
      { name: "Exchange", text: "The entry point that routes each order to the right symbol's engine." }
    ],
    design: [
      {
        heading: "Requirement 1: The order and its remaining quantity",
        text: "An order tracks how much is still unfilled. Prices are stored as integer ticks (for example hundredths of a currency unit) because floating point makes price comparisons unreliable. Each order gets a sequence number when it is created; FIFO within a price level then comes from insertion order.",
        code: [
          { file: "Side.java", body: `public enum Side { BUY, SELL }` },
          { file: "Order.java", body: `import java.util.concurrent.atomic.AtomicLong;

public class Order {
  private static final AtomicLong SEQUENCE = new AtomicLong();

  private final long id = SEQUENCE.incrementAndGet();
  private final String traderId;
  private final String symbol;
  private final Side side;
  private final OrderType type;
  private final long limitPrice; // in ticks; ignored for market orders
  private long remaining;

  public Order(String traderId, String symbol, Side side, OrderType type, long limitPrice, long quantity) {
    this.traderId = traderId;
    this.symbol = symbol;
    this.side = side;
    this.type = type;
    this.limitPrice = limitPrice;
    this.remaining = quantity;
  }

  void fill(long quantity) {
    if (quantity > remaining) throw new IllegalArgumentException("Overfill");
    remaining -= quantity;
  }

  public long id() { return id; }
  public String traderId() { return traderId; }
  public String symbol() { return symbol; }
  public Side side() { return side; }
  public OrderType type() { return type; }
  public long limitPrice() { return limitPrice; }
  public long remaining() { return remaining; }
}` }
        ]
      },
      {
        heading: "Requirement 2: The order book keeps price-time priority",
        text: "Each side of the book is a sorted map from price to a FIFO queue of orders. Bids sort highest price first and asks lowest first, so the best opposite order is always the first entry. A `TreeMap` gives ordered access in O(log P) for P distinct price levels, and the `ArrayDeque` at each price gives arrival order.\n\nAn index from order id to order makes cancellation lookups direct.",
        code: [
          { file: "OrderBook.java", body: `import java.util.ArrayDeque;
import java.util.Collections;
import java.util.Deque;
import java.util.HashMap;
import java.util.Map;
import java.util.TreeMap;

public class OrderBook {
  private final TreeMap<Long, Deque<Order>> bids = new TreeMap<>(Collections.reverseOrder());
  private final TreeMap<Long, Deque<Order>> asks = new TreeMap<>();
  private final Map<Long, Order> byId = new HashMap<>();

  private TreeMap<Long, Deque<Order>> sideOf(Side side) {
    return side == Side.BUY ? bids : asks;
  }

  public void add(Order order) {
    sideOf(order.side())
        .computeIfAbsent(order.limitPrice(), price -> new ArrayDeque<>())
        .addLast(order);
    byId.put(order.id(), order);
  }

  // Best resting order on the side opposite to the incoming side.
  public Order bestOpposite(Side incomingSide) {
    TreeMap<Long, Deque<Order>> opposite = sideOf(incomingSide == Side.BUY ? Side.SELL : Side.BUY);
    return opposite.isEmpty() ? null : opposite.firstEntry().getValue().peekFirst();
  }

  public void remove(Order order) {
    TreeMap<Long, Deque<Order>> side = sideOf(order.side());
    Deque<Order> level = side.get(order.limitPrice());
    if (level != null) {
      level.remove(order);
      if (level.isEmpty()) side.remove(order.limitPrice());
    }
    byId.remove(order.id());
  }

  public boolean cancel(long orderId) {
    Order order = byId.get(orderId);
    if (order == null) return false;
    remove(order);
    return true;
  }
}` }
        ]
      },
      {
        heading: "Requirement 3: Order types as strategies",
        text: "Limit and market orders differ in two rules: whether a resting price is acceptable, and whether leftover quantity rests on the book. Put those two decisions behind `OrderType`. The matching loop asks the type instead of branching on it, so a new type changes nothing in the loop.",
        code: [
          { file: "OrderType.java", body: `public interface OrderType {
  // Can an incoming order of this type trade against a resting order at restingPrice?
  boolean accepts(Side side, long limitPrice, long restingPrice);

  // Should unfilled quantity wait on the book?
  boolean restsOnBook();
}` },
          { file: "LimitOrderType.java", body: `public class LimitOrderType implements OrderType {
  public boolean accepts(Side side, long limitPrice, long restingPrice) {
    return side == Side.BUY ? restingPrice <= limitPrice : restingPrice >= limitPrice;
  }

  public boolean restsOnBook() { return true; }
}` },
          { file: "MarketOrderType.java", body: `public class MarketOrderType implements OrderType {
  public boolean accepts(Side side, long limitPrice, long restingPrice) {
    return true; // takes any price available
  }

  public boolean restsOnBook() { return false; }
}` }
        ]
      },
      {
        heading: "Requirement 4: The matching loop with partial fills",
        text: "Take the best opposite order, check the type accepts its price, trade the smaller of the two remaining quantities, and repeat until the incoming order is filled or nothing acceptable is left. A resting order that is fully filled leaves the book. Whatever remains of the incoming order rests on the book only if its type says so.\n\nThe trade price is the resting order's price, which is why a buy at 102 meeting a sell at 100 trades at 100.",
        code: [
          { file: "Trade.java", body: `public final class Trade {
  public final String symbol;
  public final long priceTicks;
  public final long quantity;
  public final String buyerId;
  public final String sellerId;

  public Trade(String symbol, long priceTicks, long quantity, String buyerId, String sellerId) {
    this.symbol = symbol;
    this.priceTicks = priceTicks;
    this.quantity = quantity;
    this.buyerId = buyerId;
    this.sellerId = sellerId;
  }
}` },
          { file: "MatchingEngine.java", body: `import java.util.ArrayList;
import java.util.List;

public class MatchingEngine {
  private final String symbol;
  private final OrderBook book = new OrderBook();

  public MatchingEngine(String symbol) {
    this.symbol = symbol;
  }

  // Not thread-safe by design: the exchange feeds each engine from one thread.
  public List<Trade> submit(Order incoming) {
    List<Trade> trades = new ArrayList<>();

    while (incoming.remaining() > 0) {
      Order resting = book.bestOpposite(incoming.side());
      if (resting == null
          || !incoming.type().accepts(incoming.side(), incoming.limitPrice(), resting.limitPrice())) {
        break;
      }

      long quantity = Math.min(incoming.remaining(), resting.remaining());
      incoming.fill(quantity);
      resting.fill(quantity);

      boolean incomingIsBuy = incoming.side() == Side.BUY;
      trades.add(new Trade(symbol, resting.limitPrice(), quantity,
          incomingIsBuy ? incoming.traderId() : resting.traderId(),
          incomingIsBuy ? resting.traderId() : incoming.traderId()));

      if (resting.remaining() == 0) book.remove(resting);
    }

    if (incoming.remaining() > 0 && incoming.type().restsOnBook()) {
      book.add(incoming);
    }
    return trades;
  }

  public boolean cancel(long orderId) {
    return book.cancel(orderId);
  }
}` }
        ]
      },
      {
        heading: "Requirement 5: One thread per symbol, and trade notifications",
        text: "Matching must be deterministic: the outcome depends on the exact order orders arrive in. Rather than locking the book, give each symbol a single-threaded executor. Every order for that symbol is queued onto it, processed one at a time, with no locks inside the engine. Different symbols have different executors and run in parallel.\n\nAfter matching, the exchange passes each trade to listeners, such as a portfolio service or a market-data feed.",
        code: [
          { file: "TradeListener.java", body: `public interface TradeListener {
  void onTrade(Trade trade);
}` },
          { file: "Exchange.java", body: `import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class Exchange {
  private final Map<String, MatchingEngine> engines = new ConcurrentHashMap<>();
  private final Map<String, ExecutorService> lanes = new ConcurrentHashMap<>();
  private final List<TradeListener> listeners = new CopyOnWriteArrayList<>();

  public void listSymbol(String symbol) {
    engines.put(symbol, new MatchingEngine(symbol));
    lanes.put(symbol, Executors.newSingleThreadExecutor());
  }

  public void subscribe(TradeListener listener) {
    listeners.add(listener);
  }

  public CompletableFuture<List<Trade>> placeOrder(Order order) {
    ExecutorService lane = lanes.get(order.symbol());
    if (lane == null) throw new IllegalArgumentException("Unknown symbol " + order.symbol());

    return CompletableFuture.supplyAsync(() -> {
      List<Trade> trades = engines.get(order.symbol()).submit(order);
      for (Trade trade : trades) {
        for (TradeListener listener : listeners) listener.onTrade(trade);
      }
      return trades;
    }, lane);
  }

  public CompletableFuture<Boolean> cancelOrder(String symbol, long orderId) {
    return CompletableFuture.supplyAsync(() -> engines.get(symbol).cancel(orderId), lanes.get(symbol));
  }
}` }
        ],
        note: "Cancellation goes through the same lane as orders. A cancel that raced past a fill on another thread would be the classic bug."
      }
    ],
    deepDive: [
      {
        title: "Why a single thread per symbol beats locking",
        text: "A shared book guarded by a lock would be correct, but under contention the order in which threads win the lock decides who gets filled first. That makes outcomes non-deterministic and unfair. A queue per symbol makes the arrival order the processing order, which is the definition of price-time priority. It also removes lock contention from the hot path: the engine is plain single-threaded code, which is fast and easy to test.\n\nThe cost is that one very busy symbol is bounded by one core. Real exchanges accept that and shard by symbol."
      },
      {
        title: "Where balance and risk checks go",
        text: "A pre-trade check, such as a buyer having enough cash or a seller holding the shares, should run before the order reaches the engine, in a validation step in front of `placeOrder`. It must reserve the funds or shares so that two orders cannot spend the same money. Settlement, the actual transfer after a trade, is driven by `TradeListener`. Keeping both outside the engine means the matching code stays small and purely about the book."
      },
      {
        title: "Money and price representation",
        text: "Prices are integer ticks and quantities are whole shares. Totals like price times quantity can overflow an `int`, so use `long` and consider `Math.multiplyExact` to fail loudly rather than wrap around. Trade price comes from the resting order, so the matching loop never has to average or round."
      }
    ],
    mistakes: [
      "Ignoring time priority: using a plain `PriorityQueue` keyed only on price does not give FIFO among equal prices.",
      "Using `double` for prices, then comparing with `<=` on values that do not round-trip exactly.",
      "Executing trades at the incoming order's price rather than the resting order's price.",
      "Letting a market order rest on the book, where it has no price to sort by.",
      "Cancelling on a different thread from matching, which races with fills.",
      "Forcing a pattern in just to impress the interviewer. Strategy for order types and Observer for trades are reasonable, but a Command or Visitor layer around matching adds nothing."
    ],
    followups: [
      "How would you add a stop-loss order that activates only when the price crosses a trigger?",
      "How would you support fill-or-kill, where the order must fill entirely or not at all?",
      "How would you recover the order book after a crash?",
      "How would you publish top-of-book prices to thousands of subscribers without slowing matching?"
    ],
    patterns: ["strategy", "observer"]
  },

  /* ------------------------------------------------------------------ */
  {
    id: "course-registration-system",
    name: "Design Course Registration System",
    difficulty: "hard",
    understanding: "Students register for course sections that have limited seats, prerequisites and meeting times. The system must decide whether a student is eligible, enrol them if a seat is free, waitlist them if the section is full, and promote waitlisted students when a seat opens. The difficulty is the last seat: many students click at once, and the eligibility rules keep growing.",
    dialogue: [
      { who: "you", text: "Do students register for a course, or for a specific section of a course?" },
      { who: "int", text: "A section. A course like Databases can have several sections with different times and capacities." },
      { who: "you", text: "What makes a student eligible?" },
      { who: "int", text: "They must have completed the prerequisites, the section must not clash with one they already have, and they must stay within the credit limit." },
      { who: "you", text: "Is the list of rules fixed?" },
      { who: "int", text: "No. Next term we want to add holds on accounts and department permissions. It should be easy to add rules." },
      { who: "you", text: "When a section is full, do we reject or waitlist?" },
      { who: "int", text: "Waitlist in order of request. If someone drops, the first eligible person on the waitlist gets the seat." },
      { who: "you", text: "Should the promoted student be notified?" },
      { who: "int", text: "Yes. And registration opens at a fixed time, so hundreds of students will hit the same popular section at once." },
      { who: "you", text: "So the last seat must go to exactly one student, and the system can never exceed capacity." },
      { who: "int", text: "Correct." }
    ],
    requirements: [
      { group: "Core", items: [
        "Students register for and drop sections.",
        "A student is eligible only if prerequisites are met, there is no time clash and the credit limit is respected.",
        "If the section is full and the student is otherwise eligible, they join a FIFO waitlist.",
        "When a seat opens, the first waitlisted student who is still eligible is enrolled and notified."
      ] },
      { group: "Concurrency", items: [
        "Section capacity must never be exceeded, even when many students register at once.",
        "A student registering for two clashing sections at once must not slip past the clash rule."
      ] },
      { group: "Extensibility", items: [
        "New eligibility rules can be added without modifying existing rules or the registrar.",
        "New listeners, such as email or SMS, can be added for promotion events."
      ] }
    ],
    entities: [
      { name: "Course", text: "A subject with credits and the codes of its prerequisite courses." },
      { name: "Section", text: "A scheduled offering of a course with a time slot, a capacity, enrolled students and a waitlist." },
      { name: "Student", text: "Holds completed courses and current enrolments." },
      { name: "TimeSlot", text: "A day and time range, with an overlap check." },
      { name: "EnrollmentRule", text: "One eligibility check, linked to the next in a chain." },
      { name: "Registrar", text: "Coordinates rule checks, enrolment, waitlisting and promotion." },
      { name: "EnrollmentListener", text: "Receives enrolment and promotion events." }
    ],
    design: [
      {
        heading: "Requirement 1: Courses, sections and students",
        text: "Separate the course (what is taught) from the section (when and how many). Prerequisites belong to the course, while capacity and time belong to the section. Mixing these means one course with three sections would repeat its prerequisites three times.\n\n`TimeSlot` owns the overlap logic so rules do not reimplement interval comparison.",
        code: [
          { file: "TimeSlot.java", body: `import java.time.DayOfWeek;
import java.time.LocalTime;

public final class TimeSlot {
  private final DayOfWeek day;
  private final LocalTime start;
  private final LocalTime end;

  public TimeSlot(DayOfWeek day, LocalTime start, LocalTime end) {
    this.day = day;
    this.start = start;
    this.end = end;
  }

  public boolean overlaps(TimeSlot other) {
    return day == other.day && start.isBefore(other.end) && other.start.isBefore(end);
  }
}` },
          { file: "Course.java", body: `import java.util.Set;

public class Course {
  private final String code;
  private final int credits;
  private final Set<String> prerequisites;

  public Course(String code, int credits, Set<String> prerequisites) {
    this.code = code;
    this.credits = credits;
    this.prerequisites = Set.copyOf(prerequisites);
  }

  public String code() { return code; }
  public int credits() { return credits; }
  public Set<String> prerequisites() { return prerequisites; }
}` },
          { file: "Student.java", body: `import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

public class Student {
  private final String id;
  private final String name;
  private final Set<String> completedCourses;
  private final List<Section> enrolled = new ArrayList<>();

  public Student(String id, String name, Set<String> completedCourses) {
    this.id = id;
    this.name = name;
    this.completedCourses = new HashSet<>(completedCourses);
  }

  public String id() { return id; }
  public String name() { return name; }
  public Set<String> completedCourses() { return completedCourses; }
  public List<Section> enrolled() { return enrolled; }

  public int currentCredits() {
    return enrolled.stream().mapToInt(s -> s.course().credits()).sum();
  }
}` }
        ]
      },
      {
        heading: "Requirement 2: Eligibility rules as a chain",
        text: "Each rule checks one thing and either rejects with a reason or hands over to the next rule. The registrar holds only the head of the chain. Adding a hold check or a department permission is a new class linked into the chain; neither the existing rules nor the registrar change.\n\nA failing rule returns its reason, so the student sees why they were rejected rather than a generic error.",
        code: [
          { file: "EnrollmentRule.java", body: `import java.util.Optional;

public abstract class EnrollmentRule {
  private EnrollmentRule next;

  // Links the next rule and returns it, so chains read left to right.
  public EnrollmentRule then(EnrollmentRule next) {
    this.next = next;
    return next;
  }

  public final Optional<String> check(Student student, Section section) {
    Optional<String> failure = validate(student, section);
    if (failure.isPresent() || next == null) return failure;
    return next.check(student, section);
  }

  // Empty means this rule passes.
  protected abstract Optional<String> validate(Student student, Section section);
}` },
          { file: "PrerequisiteRule.java", body: `import java.util.Optional;

public class PrerequisiteRule extends EnrollmentRule {
  protected Optional<String> validate(Student student, Section section) {
    for (String required : section.course().prerequisites()) {
      if (!student.completedCourses().contains(required)) {
        return Optional.of("Missing prerequisite " + required);
      }
    }
    return Optional.empty();
  }
}` },
          { file: "ScheduleConflictRule.java", body: `import java.util.Optional;

public class ScheduleConflictRule extends EnrollmentRule {
  protected Optional<String> validate(Student student, Section section) {
    for (Section existing : student.enrolled()) {
      if (existing.slot().overlaps(section.slot())) {
        return Optional.of("Clashes with " + existing.course().code());
      }
    }
    return Optional.empty();
  }
}` },
          { file: "CreditLimitRule.java", body: `import java.util.Optional;

public class CreditLimitRule extends EnrollmentRule {
  private final int maxCredits;

  public CreditLimitRule(int maxCredits) { this.maxCredits = maxCredits; }

  protected Optional<String> validate(Student student, Section section) {
    if (student.currentCredits() + section.course().credits() > maxCredits) {
      return Optional.of("Exceeds the " + maxCredits + " credit limit");
    }
    return Optional.empty();
  }
}` }
        ],
        note: "Capacity is deliberately not a rule. It depends on the live state of the section and decides between enrolling and waitlisting, so it lives in `Section`, not in the eligibility chain."
      },
      {
        heading: "Requirement 3: Section capacity and the waitlist",
        text: "A section owns its enrolled set and its waitlist, and exposes small synchronized operations. `enrollOrWaitlist` is one atomic decision: if a seat is free the student is added, otherwise they join the waitlist. Two students racing for the last seat are serialised by the section's lock, so exactly one wins and the other is waitlisted.",
        code: [
          { file: "Section.java", body: `import java.util.ArrayDeque;
import java.util.Deque;
import java.util.LinkedHashSet;
import java.util.Set;

public class Section {
  public enum Outcome { ENROLLED, WAITLISTED, ALREADY_PRESENT }

  private final String id;
  private final Course course;
  private final TimeSlot slot;
  private final int capacity;
  private final Set<Student> enrolled = new LinkedHashSet<>();
  private final Deque<Student> waitlist = new ArrayDeque<>();

  public Section(String id, Course course, TimeSlot slot, int capacity) {
    this.id = id;
    this.course = course;
    this.slot = slot;
    this.capacity = capacity;
  }

  public String id() { return id; }
  public Course course() { return course; }
  public TimeSlot slot() { return slot; }

  // One atomic decision: take a free seat, or queue up.
  public synchronized Outcome enrollOrWaitlist(Student student) {
    if (enrolled.contains(student) || waitlist.contains(student)) return Outcome.ALREADY_PRESENT;
    if (enrolled.size() < capacity) {
      enrolled.add(student);
      return Outcome.ENROLLED;
    }
    waitlist.addLast(student);
    return Outcome.WAITLISTED;
  }

  // Takes a seat for a promoted student, only if one is actually free.
  public synchronized boolean enrollIfSeatFree(Student student) {
    if (enrolled.size() >= capacity) return false;
    waitlist.remove(student);
    enrolled.add(student);
    return true;
  }

  public synchronized boolean remove(Student student) {
    return enrolled.remove(student) | waitlist.remove(student);
  }

  public synchronized Student pollWaitlist() {
    return waitlist.pollFirst();
  }
}` }
        ]
      },
      {
        heading: "Requirement 4: Registering, dropping and promoting",
        text: "The registrar runs the rule chain, then asks the section to enrol or waitlist. A student who fails any rule is rejected before touching the section.\n\nDropping frees a seat and then tries to promote. Promotion pulls candidates off the waitlist one at a time and re-checks them against the rules, because their situation may have changed while they waited: they might have picked up a clashing section elsewhere. A candidate who no longer qualifies is skipped, and the loop moves on to the next.\n\nObservers are told about each promotion, so email and SMS are additional listeners.",
        code: [
          { file: "EnrollmentListener.java", body: `public interface EnrollmentListener {
  void onPromoted(Student student, Section section);
}` },
          { file: "RegistrationResult.java", body: `public final class RegistrationResult {
  public enum Status { ENROLLED, WAITLISTED, REJECTED }

  private final Status status;
  private final String message;

  public RegistrationResult(Status status, String message) {
    this.status = status;
    this.message = message;
  }

  public Status status() { return status; }
  public String message() { return message; }
}` },
          { file: "Registrar.java", body: `import java.util.Optional;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

public class Registrar {
  private final EnrollmentRule rules;
  private final List<EnrollmentListener> listeners = new CopyOnWriteArrayList<>();

  public Registrar(EnrollmentRule rules) {
    this.rules = rules;
  }

  public void subscribe(EnrollmentListener listener) {
    listeners.add(listener);
  }

  public RegistrationResult register(Student student, Section section) {
    // Lock order is always student first, then section.
    synchronized (student) {
      Optional<String> failure = rules.check(student, section);
      if (failure.isPresent()) {
        return new RegistrationResult(RegistrationResult.Status.REJECTED, failure.get());
      }

      switch (section.enrollOrWaitlist(student)) {
        case ENROLLED:
          student.enrolled().add(section);
          return new RegistrationResult(RegistrationResult.Status.ENROLLED, "Enrolled in " + section.course().code());
        case WAITLISTED:
          return new RegistrationResult(RegistrationResult.Status.WAITLISTED, "Section full; added to the waitlist");
        default:
          return new RegistrationResult(RegistrationResult.Status.REJECTED, "Already registered or waitlisted");
      }
    }
  }

  public void drop(Student student, Section section) {
    synchronized (student) {
      if (section.remove(student)) {
        student.enrolled().remove(section);
      }
    }
    promoteFromWaitlist(section); // runs with no locks held
  }

  private void promoteFromWaitlist(Section section) {
    Student candidate;
    while ((candidate = section.pollWaitlist()) != null) {
      synchronized (candidate) {
        // Their circumstances may have changed while waiting, so check again.
        if (rules.check(candidate, section).isPresent()) continue;
        if (section.enrollIfSeatFree(candidate)) {
          candidate.enrolled().add(section);
          for (EnrollmentListener listener : listeners) listener.onPromoted(candidate, section);
          return;
        }
        return; // seat was taken meanwhile; the next drop will promote again
      }
    }
  }
}` },
          { file: "Setup.java", body: `EnrollmentRule rules = new PrerequisiteRule();
rules.then(new ScheduleConflictRule())
     .then(new CreditLimitRule(18));

Registrar registrar = new Registrar(rules);
registrar.subscribe((student, section) ->
    System.out.println(student.name() + " promoted into " + section.course().code()));` }
        ],
        note: "If a candidate fails the rules and is skipped, they are dropped from the waitlist. Decide whether that is acceptable, or put them back and notify them; that is a product call to raise with the interviewer."
      }
    ],
    deepDive: [
      {
        title: "Why the lock order is student first, then section",
        text: "Two locks mean a deadlock is possible if two threads take them in opposite orders. Registration locks the student, then the section. The tempting design for promotion, locking the section and then each waitlisted student, takes them the other way round, and a student dropping one section while being promoted into another could deadlock.\n\nThe fix above avoids nesting in the reverse direction. `drop` releases the student lock before promotion starts, and promotion takes a candidate's lock only after `pollWaitlist` has returned, with no section lock held. Every path that holds both locks holds them as student then section."
      },
      {
        title: "Why re-check rules at promotion time",
        text: "Eligibility is evaluated at the moment of registration, but a waitlist is a promise about the future. In the weeks between joining the waitlist and a seat opening, the student may have enrolled somewhere that clashes or exhausted their credits. Promoting without checking would silently break the rules the system exists to enforce. The cost is a few extra checks, and the benefit is that invariants hold regardless of how long anyone waited."
      },
      {
        title: "Scaling the registration rush",
        text: "At peak, thousands of students hit a few popular sections. Per-section locking is already narrow: students registering for different sections do not contend. For one hot section the lock still serialises, but each critical section is a set insertion, so throughput is high. If it ever became the bottleneck, move seat allocation to a counter in a database with a conditional update, `UPDATE section SET seats_left = seats_left - 1 WHERE id = ? AND seats_left > 0`, and treat the affected row count as the decision. That is the same pattern as seat locking in a ticket booking system."
      }
    ],
    mistakes: [
      "Checking `enrolled.size() < capacity` in the registrar and adding the student in a separate call, which allows overbooking.",
      "Locking sections and students in different orders on different paths, which can deadlock.",
      "Promoting from the waitlist without re-checking eligibility.",
      "Putting prerequisites and capacity into the same class, so every section duplicates course data.",
      "Hard-coding the rule list in the registrar with a chain of ifs, so every new rule edits it.",
      "Forcing a pattern in just to impress the interviewer. Chain of Responsibility fits a growing list of checks, but a single rule with one condition does not need a chain."
    ],
    followups: [
      "How would you support co-requisites, courses that must be taken in the same term?",
      "How would you let a student swap one section for another atomically?",
      "How would you give priority to seniors during early registration windows?",
      "How would you give a promoted student 24 hours to accept the seat before offering it to the next person?"
    ],
    patterns: ["chain-of-responsibility", "observer"]
  }
);
