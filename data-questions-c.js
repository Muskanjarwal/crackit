window.QUESTIONS = window.QUESTIONS || [];
window.QUESTIONS.push(
  /* ------------------------------------------------------------------ */
  {
    id: "splitwise",
    name: "Design Splitwise",
    difficulty: "medium",
    understanding: "Splitwise lets friends record shared expenses, split them in different ways, and see who owes whom. The core difficulty is modelling splits so new split types are cheap to add, keeping balances exact (no lost cents), and simplifying a web of debts into the fewest payments.",
    dialogue: [
      { who: "you", text: "What kinds of splits do we need to support?" },
      { who: "int", text: "Equal, exact amounts, and percentages to start. More will come, like share-based splits." },
      { who: "you", text: "Are expenses always inside a group, or can two friends split directly?" },
      { who: "int", text: "Both. A group is just a set of users who share expenses." },
      { who: "you", text: "Do we need multiple currencies?" },
      { who: "int", text: "No, a single currency. But amounts must be exact: no floating point drift." },
      { who: "you", text: "What views does a user need?" },
      { who: "int", text: "How much they owe or are owed overall, and the balance with each person." },
      { who: "you", text: "Can people settle up?" },
      { who: "int", text: "Yes, a settlement is a payment that reduces what one person owes another." },
      { who: "you", text: "Can two people add expenses at the same time?" },
      { who: "int", text: "Yes, balances must stay correct under concurrent updates." }
    ],
    requirements: [
      { group: "Core", items: [
        "Users can add an expense paid by one user and shared among several users.",
        "Support equal, exact and percentage splits.",
        "Track pairwise balances and show what each user owes or is owed.",
        "Users can settle up, reducing the balance between two people."
      ] },
      { group: "Concurrency", items: [
        "Concurrent expenses and settlements must never corrupt balances."
      ] },
      { group: "Extensibility", items: [
        "New split types (shares, adjustments) must not modify existing code.",
        "Optionally simplify debts within a group."
      ] }
    ],
    entities: [
      { name: "User", text: "A person who pays for or shares in expenses." },
      { name: "Expense", text: "A payment made by one user, with a total and a list of splits." },
      { name: "Split", text: "How much of an expense one user owes." },
      { name: "SplitStrategy", text: "Computes the splits for an expense from the raw inputs." },
      { name: "BalanceSheet", text: "Pairwise balances: who owes whom how much." },
      { name: "Group", text: "A set of users that share expenses." },
      { name: "SplitwiseService", text: "Facade that records expenses and settlements." }
    ],
    design: [
      {
        heading: "Requirement 1: Split an expense in different ways",
        text: "The thing that varies is how a total becomes per-user amounts. That is a textbook Strategy: each split type implements one interface and the service never branches on type.\n\nMoney is stored as `long` cents. Floating point drifts, so `0.1 + 0.2` style errors would leave balances that never quite settle.",
        code: [
          { file: "Split.java", body: `public class Split {
    private final User user;
    private final long amountCents;

    public Split(User user, long amountCents) {
        this.user = user;
        this.amountCents = amountCents;
    }

    public User getUser() { return user; }
    public long getAmountCents() { return amountCents; }
}` },
          { file: "SplitStrategy.java", body: `public interface SplitStrategy {
    // Returns one Split per participant; amounts must sum to totalCents.
    List<Split> split(long totalCents, List<User> participants, List<Double> values);
}` },
          { file: "EqualSplit.java", body: `public class EqualSplit implements SplitStrategy {
    @Override
    public List<Split> split(long totalCents, List<User> participants, List<Double> values) {
        int n = participants.size();
        long base = totalCents / n;
        long remainder = totalCents % n;
        List<Split> result = new ArrayList<>();
        for (int i = 0; i < n; i++) {
            // spread leftover cents one each so the sum is exact
            long amount = base + (i < remainder ? 1 : 0);
            result.add(new Split(participants.get(i), amount));
        }
        return result;
    }
}` },
          { file: "PercentSplit.java", body: `public class PercentSplit implements SplitStrategy {
    @Override
    public List<Split> split(long totalCents, List<User> participants, List<Double> percents) {
        double sum = percents.stream().mapToDouble(Double::doubleValue).sum();
        if (Math.abs(sum - 100.0) > 1e-9) {
            throw new IllegalArgumentException("Percentages must add up to 100");
        }
        List<Split> result = new ArrayList<>();
        long assigned = 0;
        for (int i = 0; i < participants.size(); i++) {
            long amount = Math.round(totalCents * percents.get(i) / 100.0);
            result.add(new Split(participants.get(i), amount));
            assigned += amount;
        }
        // fix rounding drift on the first participant
        long drift = totalCents - assigned;
        Split first = result.get(0);
        result.set(0, new Split(first.getUser(), first.getAmountCents() + drift));
        return result;
    }
}` },
          { file: "ExactSplit.java", body: `public class ExactSplit implements SplitStrategy {
    @Override
    public List<Split> split(long totalCents, List<User> participants, List<Double> amounts) {
        List<Split> result = new ArrayList<>();
        long sum = 0;
        for (int i = 0; i < participants.size(); i++) {
            long cents = Math.round(amounts.get(i) * 100);
            result.add(new Split(participants.get(i), cents));
            sum += cents;
        }
        if (sum != totalCents) {
            throw new IllegalArgumentException("Exact amounts must add up to the total");
        }
        return result;
    }
}` }
        ],
        note: "Validation lives in the strategy, because each split type has its own rule for what 'valid' means."
      },
      {
        heading: "Requirement 2: Record expenses and track balances",
        text: "An `Expense` is immutable once created. Recording it updates a `BalanceSheet`, which stores one number per ordered pair: `balances[a][b] > 0` means `a` is owed that much by `b`. Storing both directions keeps every lookup O(1).\n\nThe payer is owed by everyone else in the splits; the payer's own split is skipped since you can't owe yourself.",
        code: [
          { file: "Expense.java", body: `public class Expense {
    private final String id = UUID.randomUUID().toString();
    private final User paidBy;
    private final long totalCents;
    private final List<Split> splits;
    private final String description;

    public Expense(User paidBy, long totalCents, List<Split> splits, String description) {
        this.paidBy = paidBy;
        this.totalCents = totalCents;
        this.splits = List.copyOf(splits);
        this.description = description;
    }

    public User getPaidBy() { return paidBy; }
    public long getTotalCents() { return totalCents; }
    public List<Split> getSplits() { return splits; }
}` },
          { file: "BalanceSheet.java", body: `public class BalanceSheet {
    // balances.get(a).get(b) > 0  =>  b owes a
    private final Map<String, Map<String, Long>> balances = new HashMap<>();

    public void add(String creditorId, String debtorId, long cents) {
        if (creditorId.equals(debtorId) || cents == 0) return;
        adjust(creditorId, debtorId, cents);
        adjust(debtorId, creditorId, -cents);
    }

    private void adjust(String a, String b, long delta) {
        balances.computeIfAbsent(a, k -> new HashMap<>()).merge(b, delta, Long::sum);
    }

    public long balance(String a, String b) {
        return balances.getOrDefault(a, Map.of()).getOrDefault(b, 0L);
    }

    public Map<String, Long> forUser(String userId) {
        return Collections.unmodifiableMap(balances.getOrDefault(userId, Map.of()));
    }
}` },
          { file: "SplitwiseService.java", body: `public class SplitwiseService {
    private final BalanceSheet sheet = new BalanceSheet();
    private final Map<SplitType, SplitStrategy> strategies;

    public SplitwiseService(Map<SplitType, SplitStrategy> strategies) {
        this.strategies = strategies;
    }

    public Expense addExpense(User payer, long totalCents, SplitType type,
                              List<User> participants, List<Double> values, String note) {
        List<Split> splits = strategies.get(type).split(totalCents, participants, values);
        Expense expense = new Expense(payer, totalCents, splits, note);
        for (Split s : splits) {
            sheet.add(payer.getId(), s.getUser().getId(), s.getAmountCents());
        }
        return expense;
    }
}` }
        ]
      },
      {
        heading: "Requirement 3: Show balances and settle up",
        text: "A user's total is the sum of their row. A settlement is simply a negative expense between two people: the debtor pays the creditor, so the balance moves toward zero. Reusing `BalanceSheet.add` means there is no second code path to keep correct.",
        code: [
          { file: "SplitwiseService.java (additions)", body: `public long netBalance(User user) {
    return sheet.forUser(user.getId()).values().stream()
            .mapToLong(Long::longValue).sum();   // + means owed to them
}

public Map<String, Long> balancesFor(User user) {
    Map<String, Long> out = new LinkedHashMap<>();
    sheet.forUser(user.getId()).forEach((other, cents) -> {
        if (cents != 0) out.put(other, cents);
    });
    return out;
}

// debtor pays creditor: reduce what the debtor owes
public void settle(User debtor, User creditor, long cents) {
    if (sheet.balance(creditor.getId(), debtor.getId()) < cents) {
        throw new IllegalArgumentException("Settlement exceeds the amount owed");
    }
    sheet.add(debtor.getId(), creditor.getId(), cents);
}` }
        ]
      },
      {
        heading: "Requirement 4: Concurrent updates stay correct",
        text: "One expense touches several pairs, and each update is a read-modify-write on a `HashMap`. Two threads recording expenses can lose an update. The simplest correct answer is to serialise writes with a lock; reads can share a read lock.\n\nStart with one lock for the whole sheet. Only move to finer locking if the interviewer pushes on throughput, since a single lock is easy to reason about and impossible to deadlock.",
        code: [
          { file: "BalanceSheet.java (thread-safe)", body: `public class BalanceSheet {
    private final Map<String, Map<String, Long>> balances = new HashMap<>();
    private final ReadWriteLock lock = new ReentrantReadWriteLock();

    // applies all splits of one expense atomically
    public void addAll(String creditorId, List<Split> splits) {
        lock.writeLock().lock();
        try {
            for (Split s : splits) {
                String debtor = s.getUser().getId();
                if (debtor.equals(creditorId) || s.getAmountCents() == 0) continue;
                adjust(creditorId, debtor, s.getAmountCents());
                adjust(debtor, creditorId, -s.getAmountCents());
            }
        } finally {
            lock.writeLock().unlock();
        }
    }

    public long balance(String a, String b) {
        lock.readLock().lock();
        try {
            return balances.getOrDefault(a, Map.of()).getOrDefault(b, 0L);
        } finally {
            lock.readLock().unlock();
        }
    }

    private void adjust(String a, String b, long delta) {
        balances.computeIfAbsent(a, k -> new HashMap<>()).merge(b, delta, Long::sum);
    }
}` }
        ],
        note: "Applying the whole expense under one lock matters: a reader should never see half of an expense."
      },
      {
        heading: "Requirement 5: New split types",
        text: "Adding a share-based split (A gets 2 shares, B gets 1) is one new class plus a map entry. `SplitwiseService` is untouched, which is exactly what Open/Closed asks for.",
        code: [
          { file: "ShareSplit.java", body: `public class ShareSplit implements SplitStrategy {
    @Override
    public List<Split> split(long totalCents, List<User> participants, List<Double> shares) {
        double totalShares = shares.stream().mapToDouble(Double::doubleValue).sum();
        List<Split> result = new ArrayList<>();
        long assigned = 0;
        for (int i = 0; i < participants.size(); i++) {
            long amount = (long) Math.floor(totalCents * shares.get(i) / totalShares);
            result.add(new Split(participants.get(i), amount));
            assigned += amount;
        }
        long leftover = totalCents - assigned;
        for (int i = 0; leftover > 0; i = (i + 1) % result.size(), leftover--) {
            Split s = result.get(i);
            result.set(i, new Split(s.getUser(), s.getAmountCents() + 1));
        }
        return result;
    }
}` },
          { file: "Wiring.java", body: `Map<SplitType, SplitStrategy> strategies = Map.of(
    SplitType.EQUAL, new EqualSplit(),
    SplitType.EXACT, new ExactSplit(),
    SplitType.PERCENT, new PercentSplit(),
    SplitType.SHARE, new ShareSplit()
);
SplitwiseService service = new SplitwiseService(strategies);` }
        ]
      }
    ],
    deepDive: [
      {
        title: "Simplifying debts",
        text: "If A owes B 10, B owes C 10, then A can pay C 10 directly and B is out of the loop. The trick is that only each person's **net balance** matters, not who owes whom.\n\nCompute each member's net (what they are owed minus what they owe). Split members into creditors (positive) and debtors (negative), then repeatedly match the largest debtor with the largest creditor. Each step settles at least one person fully, so there are at most `n - 1` payments. Finding the true minimum is NP-hard (it is a subset-sum partition problem), so the greedy answer is what interviewers expect.",
        code: [
          { file: "DebtSimplifier.java", body: `public class DebtSimplifier {
    public record Payment(String from, String to, long cents) {}

    public List<Payment> simplify(Map<String, Long> netByUser) {
        PriorityQueue<Map.Entry<String, Long>> creditors =
            new PriorityQueue<>((a, b) -> Long.compare(b.getValue(), a.getValue()));
        PriorityQueue<Map.Entry<String, Long>> debtors =
            new PriorityQueue<>((a, b) -> Long.compare(a.getValue(), b.getValue()));

        for (Map.Entry<String, Long> e : netByUser.entrySet()) {
            if (e.getValue() > 0) creditors.add(new AbstractMap.SimpleEntry<>(e));
            else if (e.getValue() < 0) debtors.add(new AbstractMap.SimpleEntry<>(e));
        }

        List<Payment> payments = new ArrayList<>();
        while (!creditors.isEmpty() && !debtors.isEmpty()) {
            var credit = creditors.poll();
            var debt = debtors.poll();
            long amount = Math.min(credit.getValue(), -debt.getValue());
            payments.add(new Payment(debt.getKey(), credit.getKey(), amount));

            credit.setValue(credit.getValue() - amount);
            debt.setValue(debt.getValue() + amount);
            if (credit.getValue() > 0) creditors.add(credit);
            if (debt.getValue() < 0) debtors.add(debt);
        }
        return payments;
    }
}` }
        ]
      },
      {
        title: "Why cents and remainders matter",
        text: "Splitting 100 cents three ways gives 33 + 33 + 33 = 99. Someone has to absorb the extra cent or the books never balance. Distribute the remainder one cent at a time (as `EqualSplit` does) and assert in the service that splits always sum to the total. Silent drift is the bug interviewers love to probe."
      }
    ],
    mistakes: [
      "Using `double` for money. Balances drift and 'settled' groups still show 0.01 owed.",
      "Branching on split type with if/else inside the service instead of a strategy.",
      "Not validating that splits sum to the total, so bad data silently corrupts balances.",
      "Storing only one direction of a balance and scanning to answer 'what does A owe B'.",
      "Forcing a pattern where none is needed. Design patterns are good to have, but don't force one in just to impress the interviewer: Strategy earns its place here, a Singleton service does not."
    ],
    followups: [
      "How would you support multiple currencies and exchange rates?",
      "How would you add an activity feed and undo of the last expense?",
      "How do you persist this so a restart does not lose balances?",
      "How would you notify users when they are added to an expense?"
    ],
    patterns: ["strategy", "observer"]
  },

  /* ------------------------------------------------------------------ */
  {
    id: "vending-machine",
    name: "Design Vending Machine",
    difficulty: "medium",
    understanding: "A vending machine accepts money, lets the user pick a product, dispenses it and returns change. What a user can do at any moment depends entirely on what has already happened, which makes it the classic State pattern problem: the machine is a small state machine, and behaviour is delegated to the current state.",
    dialogue: [
      { who: "you", text: "What payment methods does the machine accept?" },
      { who: "int", text: "Coins and notes only for now. Card payments might come later." },
      { who: "you", text: "Can the user insert money before choosing a product?" },
      { who: "int", text: "Yes. They insert money, pick a product, and the machine dispenses and returns change." },
      { who: "you", text: "What happens if the user cancels?" },
      { who: "int", text: "Any inserted money is refunded in full." },
      { who: "you", text: "What if the selected product is sold out, or the machine cannot make change?" },
      { who: "int", text: "Reject the selection and keep the money in the machine so the user can choose again or cancel." },
      { who: "you", text: "Is there an admin who restocks?" },
      { who: "int", text: "Yes, a technician can restock products and add coins, but only when the machine is idle." },
      { who: "you", text: "Will two people use it at once?" },
      { who: "int", text: "Physically no, but treat it as a shared object: operations must not interleave." }
    ],
    requirements: [
      { group: "Core", items: [
        "Users insert coins or notes, select a product, and receive the product and change.",
        "Users can cancel and get a full refund before dispensing.",
        "Reject selection if the product is out of stock or insufficient money has been inserted.",
        "Technicians can restock products and change float."
      ] },
      { group: "Concurrency", items: [
        "Only one operation (insert, select, cancel) runs at a time on the machine."
      ] },
      { group: "Extensibility", items: [
        "Add new states (e.g. out of service) without rewriting existing ones.",
        "Add new payment methods (card, QR) later."
      ] }
    ],
    entities: [
      { name: "VendingMachine", text: "The context. Holds inventory, money and the current state." },
      { name: "State", text: "Interface defining what each action does in that state." },
      { name: "Product", text: "Name and price of something for sale." },
      { name: "Inventory", text: "Product to quantity mapping with stock checks." },
      { name: "Coin", text: "Denominations accepted, as an enum." },
      { name: "ChangeCalculator", text: "Works out which coins to return." }
    ],
    design: [
      {
        heading: "Requirement 1: Model products and stock",
        text: "Keep inventory out of the machine class. `Inventory` answers 'is it available?' and 'take one', so the machine can focus on flow. Prices are `int` cents.",
        code: [
          { file: "Product.java", body: `public class Product {
    private final String code;
    private final String name;
    private final int priceCents;

    public Product(String code, String name, int priceCents) {
        this.code = code;
        this.name = name;
        this.priceCents = priceCents;
    }

    public String getCode() { return code; }
    public String getName() { return name; }
    public int getPriceCents() { return priceCents; }
}` },
          { file: "Inventory.java", body: `public class Inventory {
    private final Map<String, Product> products = new HashMap<>();
    private final Map<String, Integer> stock = new HashMap<>();

    public void restock(Product product, int quantity) {
        products.put(product.getCode(), product);
        stock.merge(product.getCode(), quantity, Integer::sum);
    }

    public boolean isAvailable(String code) {
        return stock.getOrDefault(code, 0) > 0;
    }

    public Product get(String code) { return products.get(code); }

    public void dispense(String code) {
        if (!isAvailable(code)) throw new IllegalStateException("Out of stock: " + code);
        stock.merge(code, -1, Integer::sum);
    }
}` },
          { file: "Coin.java", body: `public enum Coin {
    PENNY(1), NICKEL(5), DIME(10), QUARTER(25), DOLLAR(100);

    private final int cents;
    Coin(int cents) { this.cents = cents; }
    public int cents() { return cents; }
}` }
        ]
      },
      {
        heading: "Requirement 2: Behaviour depends on the state",
        text: "Instead of one giant class full of `if (state == ...)`, each state is an object that decides what `insertCoin`, `selectProduct`, `cancel` and `dispense` mean. Actions that make no sense in a state simply reject.\n\nThree states cover the core flow: `IdleState` (no money), `HasMoneyState` (money inserted, awaiting selection) and `DispensingState` (product is being handed out).",
        code: [
          { file: "VendingState.java", body: `public interface VendingState {
    void insertCoin(VendingMachine machine, Coin coin);
    void selectProduct(VendingMachine machine, String code);
    void cancel(VendingMachine machine);
}` },
          { file: "IdleState.java", body: `public class IdleState implements VendingState {
    @Override
    public void insertCoin(VendingMachine m, Coin coin) {
        m.addBalance(coin);
        m.setState(new HasMoneyState());
    }

    @Override
    public void selectProduct(VendingMachine m, String code) {
        throw new IllegalStateException("Insert money first");
    }

    @Override
    public void cancel(VendingMachine m) {
        // nothing to refund
    }
}` },
          { file: "HasMoneyState.java", body: `public class HasMoneyState implements VendingState {
    @Override
    public void insertCoin(VendingMachine m, Coin coin) {
        m.addBalance(coin);
    }

    @Override
    public void selectProduct(VendingMachine m, String code) {
        Inventory inv = m.getInventory();
        if (!inv.isAvailable(code)) {
            throw new IllegalStateException("Sold out");
        }
        Product product = inv.get(code);
        if (m.getBalanceCents() < product.getPriceCents()) {
            throw new IllegalStateException("Insufficient funds, need "
                    + (product.getPriceCents() - m.getBalanceCents()) + " more cents");
        }
        m.setState(new DispensingState());
        m.dispense(product);
    }

    @Override
    public void cancel(VendingMachine m) {
        m.refundAll();
        m.setState(new IdleState());
    }
}` },
          { file: "DispensingState.java", body: `public class DispensingState implements VendingState {
    @Override
    public void insertCoin(VendingMachine m, Coin coin) {
        throw new IllegalStateException("Please wait, dispensing");
    }

    @Override
    public void selectProduct(VendingMachine m, String code) {
        throw new IllegalStateException("Please wait, dispensing");
    }

    @Override
    public void cancel(VendingMachine m) {
        throw new IllegalStateException("Cannot cancel while dispensing");
    }
}` }
        ],
        note: "The machine never asks 'what state am I in?'. It forwards the call, and polymorphism does the branching."
      },
      {
        heading: "Requirement 3: Dispense and return change",
        text: "`VendingMachine` is the context. It owns the data, exposes small operations to the states (`addBalance`, `dispense`, `refundAll`) and delegates the user-facing methods to the current state.\n\nChange is worked out by a separate `ChangeCalculator`, so the greedy logic can be tested in isolation and replaced if the coin set changes. If exact change can't be made, we check **before** handing out the product so we never take the money and then fail.",
        code: [
          { file: "VendingMachine.java", body: `public class VendingMachine {
    private VendingState state = new IdleState();
    private final Inventory inventory = new Inventory();
    private final Map<Coin, Integer> coinBank = new EnumMap<>(Coin.class);
    private int balanceCents;
    private final ChangeCalculator changeCalculator = new ChangeCalculator();

    public synchronized void insertCoin(Coin coin) { state.insertCoin(this, coin); }
    public synchronized void selectProduct(String code) { state.selectProduct(this, code); }
    public synchronized void cancel() { state.cancel(this); }

    void setState(VendingState next) { this.state = next; }
    Inventory getInventory() { return inventory; }
    int getBalanceCents() { return balanceCents; }

    void addBalance(Coin coin) {
        balanceCents += coin.cents();
        coinBank.merge(coin, 1, Integer::sum);
    }

    void dispense(Product product) {
        int changeDue = balanceCents - product.getPriceCents();
        Optional<Map<Coin, Integer>> change = changeCalculator.makeChange(changeDue, coinBank);
        if (change.isEmpty()) {
            setState(new HasMoneyState());
            throw new IllegalStateException("Cannot make exact change, choose another product or cancel");
        }
        inventory.dispense(product.getCode());
        change.get().forEach((coin, count) -> coinBank.merge(coin, -count, Integer::sum));
        balanceCents = 0;
        System.out.println("Dispensed " + product.getName() + ", change: " + change.get());
        setState(new IdleState());
    }

    void refundAll() {
        System.out.println("Refunding " + balanceCents + " cents");
        balanceCents = 0;
    }
}` },
          { file: "ChangeCalculator.java", body: `public class ChangeCalculator {
    // Greedy works for canonical coin sets (1, 5, 10, 25, 100).
    public Optional<Map<Coin, Integer>> makeChange(int amount, Map<Coin, Integer> available) {
        Map<Coin, Integer> result = new EnumMap<>(Coin.class);
        int remaining = amount;
        Coin[] coins = Coin.values();
        for (int i = coins.length - 1; i >= 0 && remaining > 0; i--) {
            Coin coin = coins[i];
            int have = available.getOrDefault(coin, 0);
            int use = Math.min(have, remaining / coin.cents());
            if (use > 0) {
                result.put(coin, use);
                remaining -= use * coin.cents();
            }
        }
        return remaining == 0 ? Optional.of(result) : Optional.empty();
    }
}` }
        ]
      },
      {
        heading: "Requirement 4: Restocking and concurrency",
        text: "Public methods are `synchronized`, so two calls never interleave and read a half-updated state. Technician operations are exposed separately and refuse to run unless the machine is idle, which prevents restocking mid-purchase.",
        code: [
          { file: "VendingMachine.java (admin)", body: `public synchronized void restock(Product product, int quantity) {
    requireIdle();
    inventory.restock(product, quantity);
}

public synchronized void addCoins(Coin coin, int count) {
    requireIdle();
    coinBank.merge(coin, count, Integer::sum);
}

private void requireIdle() {
    if (!(state instanceof IdleState)) {
        throw new IllegalStateException("Machine is in use");
    }
}` }
        ]
      },
      {
        heading: "Requirement 5: New states and payment methods",
        text: "An out-of-service state is one new class implementing `VendingState`, plus a transition into it. No existing state changes. For card payments, extract a `PaymentMethod` interface so the machine asks it to `charge` instead of assuming coins.",
        code: [
          { file: "OutOfServiceState.java", body: `public class OutOfServiceState implements VendingState {
    @Override
    public void insertCoin(VendingMachine m, Coin coin) {
        throw new IllegalStateException("Out of service");
    }

    @Override
    public void selectProduct(VendingMachine m, String code) {
        throw new IllegalStateException("Out of service");
    }

    @Override
    public void cancel(VendingMachine m) {
        m.refundAll();
    }
}` },
          { file: "PaymentMethod.java", body: `public interface PaymentMethod {
    boolean charge(int amountCents);
    void refund(int amountCents);
}` }
        ]
      }
    ],
    deepDive: [
      {
        title: "Making change when greedy fails",
        text: "Greedy is optimal for canonical coin systems like 1, 5, 10, 25. It can fail for others (coins of 1, 3, 4 and an amount of 6 gives 4+1+1 instead of 3+3), and it also fails when a denomination runs out. A robust version uses dynamic programming over amounts with the available counts. In an interview, state the assumption, implement greedy, and mention DP as the fallback.",
        code: [
          { file: "DpChange.java", body: `// min coins to make 'amount' with unlimited supply
int[] dp = new int[amount + 1];
Arrays.fill(dp, Integer.MAX_VALUE);
dp[0] = 0;
for (int a = 1; a <= amount; a++) {
    for (int c : denominations) {
        if (c <= a && dp[a - c] != Integer.MAX_VALUE) {
            dp[a] = Math.min(dp[a], dp[a - c] + 1);
        }
    }
}` }
        ]
      },
      {
        title: "State vs Strategy",
        text: "Both patterns look alike, but the intent differs. In State the **object changes its own behaviour** by switching states, and states often trigger the next transition (`Idle` moves to `HasMoney`). In Strategy the **client picks** one algorithm and it stays put. A vending machine moves itself through states, so State is the honest fit."
      }
    ],
    mistakes: [
      "One giant `switch(state)` in every method, which is the problem State exists to remove.",
      "Taking the customer's money first and only then discovering the machine cannot make change.",
      "Allowing restocking while a purchase is in progress.",
      "Mutating shared fields from several threads without synchronisation.",
      "Forcing a pattern where none is needed. Design patterns are good to have, but don't force one in just to impress the interviewer: the change calculator is a plain class, not a Strategy hierarchy, until a second algorithm actually exists."
    ],
    followups: [
      "How would you support card or QR payments?",
      "How would you handle a hardware jam after payment?",
      "How would you add product-level analytics and low-stock alerts?",
      "How do you persist inventory across a power cut?"
    ],
    patterns: ["state", "strategy"]
  },

  /* ------------------------------------------------------------------ */
  {
    id: "car-rental-system",
    name: "Design Car Rental System",
    difficulty: "medium",
    understanding: "A car rental system lets customers search for vehicles available over a date range, reserve one, pick it up and return it, and pay. The tricky parts are availability across overlapping time windows, preventing two customers from reserving the same car for the same dates, and pricing that varies by vehicle type and duration.",
    dialogue: [
      { who: "you", text: "Is this one rental company with multiple branches, or a marketplace?" },
      { who: "int", text: "One company with several branches. Customers pick up and return at a branch." },
      { who: "you", text: "How do customers find a car?" },
      { who: "int", text: "By branch, date range and optionally vehicle type, like economy or SUV." },
      { who: "you", text: "Is a reservation tied to a specific car, or just a car type?" },
      { who: "int", text: "A specific car, to keep it simple." },
      { who: "you", text: "How is the price computed?" },
      { who: "int", text: "Daily rate depends on the vehicle type, multiplied by days. Long rentals might get discounts later." },
      { who: "you", text: "What about cancellations and late returns?" },
      { who: "int", text: "Support cancelling before pickup. Late returns are charged extra per day." },
      { who: "you", text: "Two customers booking the same car at the same time?" },
      { who: "int", text: "Must never double-book. Exactly one wins." }
    ],
    requirements: [
      { group: "Core", items: [
        "Search available vehicles by branch, date range and type.",
        "Reserve a specific vehicle for a date range.",
        "Pick up and return vehicles; return completes the rental and produces a bill.",
        "Cancel a reservation before pickup."
      ] },
      { group: "Concurrency", items: [
        "A vehicle can never have two overlapping active reservations, even under concurrent requests."
      ] },
      { group: "Extensibility", items: [
        "New vehicle types and pricing rules (discounts, weekend rates) without changing the reservation flow.",
        "New payment methods."
      ] }
    ],
    entities: [
      { name: "Vehicle", text: "A specific car with plate number, type and branch." },
      { name: "VehicleType", text: "Economy, SUV, Luxury, each with a base daily rate." },
      { name: "Customer", text: "Person renting a vehicle." },
      { name: "Reservation", text: "A vehicle held for a customer over a date range, with a status." },
      { name: "PricingStrategy", text: "Computes the total for a reservation." },
      { name: "Branch", text: "A location holding a set of vehicles." },
      { name: "RentalService", text: "Entry point that searches, reserves, picks up and returns." }
    ],
    design: [
      {
        heading: "Requirement 1: Model vehicles and search availability",
        text: "A vehicle is available for `[from, to)` if none of its active reservations overlap that range. Two ranges overlap when `startA < endB && startB < endA`. Keep this check on `Vehicle`, since it owns its reservations.",
        code: [
          { file: "VehicleType.java", body: `public enum VehicleType {
    ECONOMY(40_00), SEDAN(60_00), SUV(90_00), LUXURY(150_00);

    private final long dailyRateCents;
    VehicleType(long dailyRateCents) { this.dailyRateCents = dailyRateCents; }
    public long dailyRateCents() { return dailyRateCents; }
}` },
          { file: "Vehicle.java", body: `public class Vehicle {
    private final String plate;
    private final VehicleType type;
    private final Branch branch;
    private final List<Reservation> reservations = new ArrayList<>();

    public Vehicle(String plate, VehicleType type, Branch branch) {
        this.plate = plate;
        this.type = type;
        this.branch = branch;
    }

    public synchronized boolean isAvailable(LocalDate from, LocalDate to) {
        return reservations.stream()
                .filter(Reservation::isActive)
                .noneMatch(r -> r.overlaps(from, to));
    }

    synchronized void addReservation(Reservation r) { reservations.add(r); }

    public String getPlate() { return plate; }
    public VehicleType getType() { return type; }
    public Branch getBranch() { return branch; }
}` },
          { file: "Branch.java", body: `public class Branch {
    private final String name;
    private final List<Vehicle> vehicles = new CopyOnWriteArrayList<>();

    public Branch(String name) { this.name = name; }

    public void addVehicle(Vehicle v) { vehicles.add(v); }

    public List<Vehicle> search(VehicleType type, LocalDate from, LocalDate to) {
        return vehicles.stream()
                .filter(v -> type == null || v.getType() == type)
                .filter(v -> v.isAvailable(from, to))
                .collect(Collectors.toList());
    }
}` }
        ]
      },
      {
        heading: "Requirement 2: Reservations with a lifecycle",
        text: "A reservation moves through `RESERVED -> PICKED_UP -> COMPLETED`, or `RESERVED -> CANCELLED`. An explicit status enum plus guarded transition methods keeps illegal moves (returning a car that was never picked up) from happening.",
        code: [
          { file: "ReservationStatus.java", body: `public enum ReservationStatus { RESERVED, PICKED_UP, COMPLETED, CANCELLED }` },
          { file: "Reservation.java", body: `public class Reservation {
    private final String id = UUID.randomUUID().toString();
    private final Customer customer;
    private final Vehicle vehicle;
    private final LocalDate from;
    private final LocalDate to;
    private ReservationStatus status = ReservationStatus.RESERVED;
    private LocalDate returnedOn;

    public Reservation(Customer customer, Vehicle vehicle, LocalDate from, LocalDate to) {
        this.customer = customer;
        this.vehicle = vehicle;
        this.from = from;
        this.to = to;
    }

    public boolean isActive() {
        return status == ReservationStatus.RESERVED || status == ReservationStatus.PICKED_UP;
    }

    public boolean overlaps(LocalDate otherFrom, LocalDate otherTo) {
        return from.isBefore(otherTo) && otherFrom.isBefore(to);
    }

    public void pickUp() {
        require(ReservationStatus.RESERVED);
        status = ReservationStatus.PICKED_UP;
    }

    public void complete(LocalDate returnDate) {
        require(ReservationStatus.PICKED_UP);
        returnedOn = returnDate;
        status = ReservationStatus.COMPLETED;
    }

    public void cancel() {
        require(ReservationStatus.RESERVED);
        status = ReservationStatus.CANCELLED;
    }

    private void require(ReservationStatus expected) {
        if (status != expected) {
            throw new IllegalStateException("Expected " + expected + " but was " + status);
        }
    }

    public Vehicle getVehicle() { return vehicle; }
    public LocalDate getFrom() { return from; }
    public LocalDate getTo() { return to; }
    public LocalDate getReturnedOn() { return returnedOn; }
}` }
        ]
      },
      {
        heading: "Requirement 3: Reserve without double-booking",
        text: "The check-then-insert is a race: two threads can both see the car free, then both add a reservation. The check and the insert must be one atomic step per vehicle. Locking on the `Vehicle` object makes concurrent bookings of the *same* car serialise, while bookings of different cars run in parallel.",
        code: [
          { file: "RentalService.java", body: `public class RentalService {
    private final PricingStrategy pricing;

    public RentalService(PricingStrategy pricing) { this.pricing = pricing; }

    public Reservation reserve(Customer customer, Vehicle vehicle, LocalDate from, LocalDate to) {
        if (!from.isBefore(to)) throw new IllegalArgumentException("Invalid date range");

        synchronized (vehicle) {                       // check + insert are atomic per vehicle
            if (!vehicle.isAvailable(from, to)) {
                throw new IllegalStateException("Vehicle not available for those dates");
            }
            Reservation r = new Reservation(customer, vehicle, from, to);
            vehicle.addReservation(r);
            return r;
        }
    }

    public void pickUp(Reservation r) { r.pickUp(); }

    public void cancel(Reservation r) { r.cancel(); }
}` }
        ],
        note: "Vehicle's own methods are `synchronized` on the same monitor, so `isAvailable` inside the block is reentrant and safe."
      },
      {
        heading: "Requirement 4: Pricing and returns",
        text: "Pricing is a Strategy so discounts and surcharges are new classes, not edits. Returning a car computes rental days plus a late fee when the return date is after `to`.",
        code: [
          { file: "PricingStrategy.java", body: `public interface PricingStrategy {
    long totalCents(Reservation r);
}` },
          { file: "DailyRatePricing.java", body: `public class DailyRatePricing implements PricingStrategy {
    private static final double LATE_MULTIPLIER = 1.5;

    @Override
    public long totalCents(Reservation r) {
        long rate = r.getVehicle().getType().dailyRateCents();
        long plannedDays = ChronoUnit.DAYS.between(r.getFrom(), r.getTo());
        long total = rate * plannedDays;

        if (r.getReturnedOn() != null && r.getReturnedOn().isAfter(r.getTo())) {
            long lateDays = ChronoUnit.DAYS.between(r.getTo(), r.getReturnedOn());
            total += Math.round(rate * LATE_MULTIPLIER) * lateDays;
        }
        return total;
    }
}` },
          { file: "LongRentalDiscount.java", body: `// Decorates another strategy: 10% off rentals of a week or more.
public class LongRentalDiscount implements PricingStrategy {
    private final PricingStrategy inner;

    public LongRentalDiscount(PricingStrategy inner) { this.inner = inner; }

    @Override
    public long totalCents(Reservation r) {
        long total = inner.totalCents(r);
        long days = ChronoUnit.DAYS.between(r.getFrom(), r.getTo());
        return days >= 7 ? Math.round(total * 0.9) : total;
    }
}` },
          { file: "RentalService.java (return)", body: `public Bill returnVehicle(Reservation r, LocalDate returnDate) {
    r.complete(returnDate);
    return new Bill(r, pricing.totalCents(r));
}` }
        ]
      },
      {
        heading: "Requirement 5: New vehicle types and payments",
        text: "Vehicle types are an enum with a rate, so adding 'Van' is one line. If types later need behaviour (different insurance rules, age limits), promote the enum to a small class hierarchy or a registry. Payments follow the same shape as pricing: a `PaymentMethod` interface that the checkout depends on.",
        code: [
          { file: "PaymentMethod.java", body: `public interface PaymentMethod {
    PaymentResult pay(Customer customer, long amountCents);
}` }
        ]
      }
    ],
    deepDive: [
      {
        title: "Scaling the availability check",
        text: "Scanning every reservation of every vehicle is fine for an interview, but in production you would not do that per search. Two options: keep each vehicle's reservations in a sorted structure (a `TreeMap` keyed by start date) so an overlap check is O(log n), or push the invariant into the database. A relational design uses an exclusion constraint on `(vehicle_id, daterange)`, so the database itself refuses an overlapping row and the race disappears no matter how many servers you run.",
        code: [
          { file: "schema.sql", body: `-- PostgreSQL: the database enforces no overlap
ALTER TABLE reservation
  ADD CONSTRAINT no_overlap
  EXCLUDE USING gist (
    vehicle_id WITH =,
    daterange(start_date, end_date) WITH &&
  ) WHERE (status IN ('RESERVED', 'PICKED_UP'));` }
        ]
      },
      {
        title: "Locking granularity",
        text: "A global lock on the service would make every booking wait for every other. Locking per vehicle means contention only exists where it is genuinely needed. The cost is that a multi-vehicle booking (a fleet booking) needs a fixed lock order, for example by plate number, to avoid deadlock."
      }
    ],
    mistakes: [
      "Checking availability and inserting the reservation as two separate, unlocked steps.",
      "Treating the end date as inclusive in one place and exclusive in another, which creates off-by-one overlaps.",
      "Hard-coding prices in `if (type == SUV)` branches in the service.",
      "Letting a reservation be completed without being picked up first.",
      "Forcing a pattern where none is needed. Design patterns are good to have, but don't force one in just to impress the interviewer: a simple enum for vehicle types is better than a factory until types need behaviour."
    ],
    followups: [
      "How would you support one-way rentals returned to a different branch?",
      "How would you handle a vehicle going into maintenance mid-reservation?",
      "How would you add a security deposit and damage charges?",
      "How would you reserve by vehicle type and assign the car at pickup?"
    ],
    patterns: ["strategy", "decorator", "state"]
  },

  /* ------------------------------------------------------------------ */
  {
    id: "hotel-management-system",
    name: "Design Hotel Management System",
    difficulty: "medium",
    understanding: "A hotel management system handles room search, bookings, check-in, check-out and billing for guests. The interesting parts are availability over date ranges, a booking lifecycle with strict transitions, and a bill that combines the room charge with extras like meals and services.",
    dialogue: [
      { who: "you", text: "Is this a single hotel or a chain?" },
      { who: "int", text: "A single hotel. Keep the model open to adding branches later." },
      { who: "you", text: "What room types exist?" },
      { who: "int", text: "Standard, Deluxe and Suite, each with a nightly price and capacity." },
      { who: "you", text: "Who uses the system?" },
      { who: "int", text: "Guests searching and booking online, and front-desk staff doing check-in, check-out and walk-ins." },
      { who: "you", text: "Is a specific room assigned at booking or at check-in?" },
      { who: "int", text: "At booking, to keep things simple." },
      { who: "you", text: "What goes on the bill?" },
      { who: "int", text: "Room charge for the nights stayed, plus extra services like room service or laundry." },
      { who: "you", text: "Cancellations?" },
      { who: "int", text: "Allowed before check-in. Ignore refund rules for now." },
      { who: "you", text: "Concurrent bookings of the last available room?" },
      { who: "int", text: "Exactly one booking must succeed." }
    ],
    requirements: [
      { group: "Core", items: [
        "Search available rooms by date range, type and capacity.",
        "Book a room for a date range; guests can cancel before check-in.",
        "Front desk checks guests in and out.",
        "Generate a bill: room charge plus extra services."
      ] },
      { group: "Concurrency", items: [
        "No two active bookings can overlap on the same room."
      ] },
      { group: "Extensibility", items: [
        "New room types and seasonal pricing without changing booking code.",
        "New chargeable services (spa, minibar) without modifying `Invoice`."
      ] }
    ],
    entities: [
      { name: "Hotel", text: "Owns rooms and exposes search and booking." },
      { name: "Room", text: "Physical room with number, type and its bookings." },
      { name: "RoomType", text: "Standard, Deluxe or Suite, with base price and capacity." },
      { name: "Guest", text: "Person staying at the hotel." },
      { name: "Booking", text: "Room held for a guest over a date range, with a status." },
      { name: "ChargeItem", text: "One billable line such as 'Room service' or 'Laundry'." },
      { name: "Invoice", text: "Collection of charges produced at checkout." },
      { name: "PricingPolicy", text: "Computes the nightly rate, possibly by season." }
    ],
    design: [
      {
        heading: "Requirement 1: Rooms and availability search",
        text: "Like any date-range reservation problem, availability is 'no active booking overlaps the requested range'. Room owns its bookings, so the check stays next to the data it reads.",
        code: [
          { file: "RoomType.java", body: `public enum RoomType {
    STANDARD(2, 100_00), DELUXE(3, 160_00), SUITE(4, 300_00);

    private final int capacity;
    private final long baseRateCents;

    RoomType(int capacity, long baseRateCents) {
        this.capacity = capacity;
        this.baseRateCents = baseRateCents;
    }

    public int capacity() { return capacity; }
    public long baseRateCents() { return baseRateCents; }
}` },
          { file: "Room.java", body: `public class Room {
    private final String number;
    private final RoomType type;
    private final List<Booking> bookings = new ArrayList<>();

    public Room(String number, RoomType type) {
        this.number = number;
        this.type = type;
    }

    public synchronized boolean isAvailable(LocalDate checkIn, LocalDate checkOut) {
        return bookings.stream()
                .filter(Booking::isActive)
                .noneMatch(b -> b.overlaps(checkIn, checkOut));
    }

    synchronized void add(Booking b) { bookings.add(b); }

    public String getNumber() { return number; }
    public RoomType getType() { return type; }
}` },
          { file: "Hotel.java (search)", body: `public List<Room> search(LocalDate checkIn, LocalDate checkOut, RoomType type, int guests) {
    return rooms.stream()
            .filter(r -> type == null || r.getType() == type)
            .filter(r -> r.getType().capacity() >= guests)
            .filter(r -> r.isAvailable(checkIn, checkOut))
            .collect(Collectors.toList());
}` }
        ]
      },
      {
        heading: "Requirement 2: Booking lifecycle",
        text: "Bookings move `CONFIRMED -> CHECKED_IN -> CHECKED_OUT`, or `CONFIRMED -> CANCELLED`. The booking owns these transitions and rejects illegal ones, so the front-desk code can't accidentally check out a guest who never checked in.",
        code: [
          { file: "Booking.java", body: `public class Booking {
    public enum Status { CONFIRMED, CHECKED_IN, CHECKED_OUT, CANCELLED }

    private final String id = UUID.randomUUID().toString();
    private final Guest guest;
    private final Room room;
    private final LocalDate checkIn;
    private final LocalDate checkOut;
    private Status status = Status.CONFIRMED;
    private final List<ChargeItem> extras = new ArrayList<>();

    public Booking(Guest guest, Room room, LocalDate checkIn, LocalDate checkOut) {
        this.guest = guest;
        this.room = room;
        this.checkIn = checkIn;
        this.checkOut = checkOut;
    }

    public boolean isActive() {
        return status == Status.CONFIRMED || status == Status.CHECKED_IN;
    }

    public boolean overlaps(LocalDate from, LocalDate to) {
        return checkIn.isBefore(to) && from.isBefore(checkOut);
    }

    public void checkIn() { transition(Status.CONFIRMED, Status.CHECKED_IN); }
    public void checkOut() { transition(Status.CHECKED_IN, Status.CHECKED_OUT); }
    public void cancel() { transition(Status.CONFIRMED, Status.CANCELLED); }

    public void addExtra(ChargeItem item) {
        if (status != Status.CHECKED_IN) throw new IllegalStateException("Guest is not checked in");
        extras.add(item);
    }

    private void transition(Status from, Status to) {
        if (status != from) throw new IllegalStateException(status + " cannot move to " + to);
        status = to;
    }

    public Room getRoom() { return room; }
    public LocalDate getCheckIn() { return checkIn; }
    public LocalDate getCheckOut() { return checkOut; }
    public List<ChargeItem> getExtras() { return List.copyOf(extras); }
}` }
        ]
      },
      {
        heading: "Requirement 3: Book without double-booking",
        text: "Search and book are two steps, so the room can be taken in between. The booking method therefore re-checks availability inside a lock on the room, making check and insert atomic.",
        code: [
          { file: "Hotel.java (book)", body: `public Booking book(Guest guest, Room room, LocalDate checkIn, LocalDate checkOut) {
    if (!checkIn.isBefore(checkOut)) throw new IllegalArgumentException("Invalid dates");

    synchronized (room) {
        if (!room.isAvailable(checkIn, checkOut)) {
            throw new IllegalStateException("Room " + room.getNumber() + " is no longer available");
        }
        Booking booking = new Booking(guest, room, checkIn, checkOut);
        room.add(booking);
        return booking;
    }
}` }
        ]
      },
      {
        heading: "Requirement 4: Billing with extras",
        text: "A bill is the room charge plus a list of `ChargeItem`s. Services implement one small interface, so adding a spa treatment doesn't touch `Invoice`. The nightly rate comes from a `PricingPolicy`, which lets weekends or seasons be priced differently.",
        code: [
          { file: "ChargeItem.java", body: `public interface ChargeItem {
    String description();
    long amountCents();
}` },
          { file: "RoomServiceCharge.java", body: `public class RoomServiceCharge implements ChargeItem {
    private final String item;
    private final long cents;

    public RoomServiceCharge(String item, long cents) {
        this.item = item;
        this.cents = cents;
    }

    public String description() { return "Room service: " + item; }
    public long amountCents() { return cents; }
}` },
          { file: "PricingPolicy.java", body: `public interface PricingPolicy {
    long nightlyRateCents(Room room, LocalDate night);
}

class SeasonalPricing implements PricingPolicy {
    @Override
    public long nightlyRateCents(Room room, LocalDate night) {
        long base = room.getType().baseRateCents();
        boolean weekend = night.getDayOfWeek() == DayOfWeek.FRIDAY
                || night.getDayOfWeek() == DayOfWeek.SATURDAY;
        return weekend ? Math.round(base * 1.25) : base;
    }
}` },
          { file: "InvoiceService.java", body: `public class InvoiceService {
    private final PricingPolicy pricing;

    public InvoiceService(PricingPolicy pricing) { this.pricing = pricing; }

    public Invoice generate(Booking b) {
        long roomTotal = 0;
        for (LocalDate d = b.getCheckIn(); d.isBefore(b.getCheckOut()); d = d.plusDays(1)) {
            roomTotal += pricing.nightlyRateCents(b.getRoom(), d);
        }
        List<ChargeItem> lines = new ArrayList<>(b.getExtras());
        long extrasTotal = lines.stream().mapToLong(ChargeItem::amountCents).sum();
        return new Invoice(b, roomTotal, lines, roomTotal + extrasTotal);
    }
}` }
        ]
      },
      {
        heading: "Requirement 5: Front-desk operations",
        text: "Check-in and check-out are thin orchestration over the booking. Checkout produces the invoice so billing always matches what was recorded, and the room becomes bookable again simply because the booking is no longer active.",
        code: [
          { file: "FrontDesk.java", body: `public class FrontDesk {
    private final InvoiceService invoices;

    public FrontDesk(InvoiceService invoices) { this.invoices = invoices; }

    public void checkIn(Booking b) {
        b.checkIn();
    }

    public Invoice checkOut(Booking b) {
        b.checkOut();
        return invoices.generate(b);
    }
}` }
        ]
      }
    ],
    deepDive: [
      {
        title: "Room type inventory vs. specific room assignment",
        text: "Assigning a specific room at booking time is simple but rigid: a guest in 101 blocks it even if 102 is identical. Real hotels sell **room types**: you book 'Deluxe for Mon-Wed' and a room is assigned at check-in. That lets the front desk rebalance and avoids stranded gaps between bookings.\n\nThe model changes: availability becomes a counter per type per night (`total rooms of type - bookings of type that night`), and `Booking` references a `RoomType` until check-in assigns a `Room`. The race condition moves with it: you now lock the type-and-date inventory rather than a room."
      },
      {
        title: "Where the invariants live",
        text: "The no-overlap rule is a single invariant that must hold for every path that adds a booking. Keep one entry point (`Hotel.book`) so no caller can bypass it, and in a real system back it with a database constraint so multiple application servers can't violate it either."
      }
    ],
    mistakes: [
      "Letting staff add extras to a booking that is not checked in.",
      "Mixing inclusive and exclusive checkout dates, so back-to-back stays appear to clash.",
      "Computing the invoice from mutable live data, so reprinting a bill gives a different total.",
      "Making `Invoice` know about each service type through `instanceof`.",
      "Forcing a pattern where none is needed. Design patterns are good to have, but don't force one in just to impress the interviewer: a plain `ChargeItem` interface is enough, you don't need a Visitor."
    ],
    followups: [
      "How would you support multiple hotels in one system?",
      "How would you add cancellation fees that depend on how close to arrival it is?",
      "How would you model rooms being out of order for maintenance?",
      "How would you add a loyalty programme with discounts?"
    ],
    patterns: ["strategy", "state", "factory-method"]
  },

  /* ------------------------------------------------------------------ */
  {
    id: "digital-wallet",
    name: "Design a Digital Wallet Service",
    difficulty: "medium",
    understanding: "A digital wallet holds a user's balance and lets them add money, pay and transfer to others. The design is dominated by correctness: balances must never go negative, a transfer must move money atomically, and a retried request must not charge twice. Everything else is secondary to those three guarantees.",
    dialogue: [
      { who: "you", text: "What operations does a wallet support?" },
      { who: "int", text: "Top up from a bank account or card, pay another user, withdraw, and view history." },
      { who: "you", text: "Single currency?" },
      { who: "int", text: "Yes. Store amounts as integers in minor units." },
      { who: "you", text: "Can a balance go negative?" },
      { who: "int", text: "Never." },
      { who: "you", text: "Does the user need a transaction history?" },
      { who: "int", text: "Yes, an immutable record of everything that moved money." },
      { who: "you", text: "What if a client retries a payment because of a timeout?" },
      { who: "int", text: "It must not be charged twice." },
      { who: "you", text: "Are transfers between two wallets instant?" },
      { who: "int", text: "Yes, both sides update together or neither does." },
      { who: "you", text: "Is there a limit on top-ups or transfers?" },
      { who: "int", text: "A daily limit per wallet is a likely follow-up." }
    ],
    requirements: [
      { group: "Core", items: [
        "Create a wallet; top up from an external source; withdraw to it.",
        "Transfer money between two wallets atomically.",
        "Never allow a negative balance.",
        "Keep an immutable history of transactions."
      ] },
      { group: "Concurrency", items: [
        "Concurrent debits must not overspend the balance.",
        "Concurrent transfers in opposite directions must not deadlock.",
        "A retried request with the same idempotency key is applied once."
      ] },
      { group: "Extensibility", items: [
        "New funding sources (card, bank, UPI) without changing wallet logic.",
        "Pluggable rules such as daily limits and fraud checks."
      ] }
    ],
    entities: [
      { name: "Wallet", text: "Holds a balance for a user." },
      { name: "Money", text: "Amount in minor units; never negative." },
      { name: "Transaction", text: "Immutable record of one movement of money, with a status." },
      { name: "FundingSource", text: "External place money comes from or goes to." },
      { name: "TransferRule", text: "A check that can reject a transfer, like a limit." },
      { name: "WalletService", text: "Orchestrates top-ups, transfers and idempotency." }
    ],
    design: [
      {
        heading: "Requirement 1: A wallet that can't go negative",
        text: "The wallet owns its balance and enforces the invariant itself. Callers can't set the balance, only `credit` and `debit`, and `debit` refuses to overdraw. Making this the only way to change the balance keeps the rule in one place.",
        code: [
          { file: "Wallet.java", body: `public class Wallet {
    private final String id;
    private final String ownerId;
    private long balanceCents;
    private final ReentrantLock lock = new ReentrantLock();

    public Wallet(String id, String ownerId) {
        this.id = id;
        this.ownerId = ownerId;
    }

    public void credit(long cents) {
        if (cents <= 0) throw new IllegalArgumentException("Amount must be positive");
        balanceCents += cents;
    }

    public void debit(long cents) {
        if (cents <= 0) throw new IllegalArgumentException("Amount must be positive");
        if (balanceCents < cents) throw new InsufficientFundsException(id);
        balanceCents -= cents;
    }

    public long getBalanceCents() { return balanceCents; }
    public String getId() { return id; }
    ReentrantLock lock() { return lock; }
}` }
        ],
        note: "These methods are not thread-safe on their own. The service takes the wallet's lock, which lets one transfer hold two locks at once."
      },
      {
        heading: "Requirement 2: Immutable transaction history",
        text: "Every movement of money produces a `Transaction` that is never modified afterwards. Corrections are new transactions, not edits, which gives you an audit trail for free. Status moves `PENDING -> COMPLETED` or `FAILED`.",
        code: [
          { file: "Transaction.java", body: `public final class Transaction {
    public enum Type { TOP_UP, WITHDRAWAL, TRANSFER }
    public enum Status { PENDING, COMPLETED, FAILED }

    private final String id = UUID.randomUUID().toString();
    private final String idempotencyKey;
    private final Type type;
    private final String fromWalletId;     // null for top-ups
    private final String toWalletId;       // null for withdrawals
    private final long amountCents;
    private final Status status;
    private final Instant createdAt = Instant.now();

    public Transaction(String key, Type type, String from, String to, long cents, Status status) {
        this.idempotencyKey = key;
        this.type = type;
        this.fromWalletId = from;
        this.toWalletId = to;
        this.amountCents = cents;
        this.status = status;
    }

    public String getId() { return id; }
    public String getIdempotencyKey() { return idempotencyKey; }
    public Status getStatus() { return status; }
    public long getAmountCents() { return amountCents; }
}` },
          { file: "TransactionLog.java", body: `public class TransactionLog {
    private final List<Transaction> all = new CopyOnWriteArrayList<>();

    public void append(Transaction t) { all.add(t); }

    public List<Transaction> forWallet(String walletId) {
        return all.stream()
                .filter(t -> walletId.equals(t.fromWalletId()) || walletId.equals(t.toWalletId()))
                .collect(Collectors.toList());
    }
}` }
        ]
      },
      {
        heading: "Requirement 3: Atomic transfers without deadlock",
        text: "A transfer debits one wallet and credits another, so it needs both locks. If transfer A->B locks A then B while transfer B->A locks B then A, they deadlock. The fix is a global lock order: always lock the wallet with the smaller id first, no matter which direction money flows.",
        code: [
          { file: "WalletService.java (transfer)", body: `public Transaction transfer(String key, Wallet from, Wallet to, long cents) {
    Transaction existing = idempotency.get(key);
    if (existing != null) return existing;             // retry: return the original result

    Wallet first = from.getId().compareTo(to.getId()) < 0 ? from : to;
    Wallet second = first == from ? to : from;

    first.lock().lock();
    try {
        second.lock().lock();
        try {
            rules.forEach(rule -> rule.check(from, to, cents));   // limits, fraud
            from.debit(cents);
            to.credit(cents);
            Transaction tx = new Transaction(key, Transaction.Type.TRANSFER,
                    from.getId(), to.getId(), cents, Transaction.Status.COMPLETED);
            log.append(tx);
            idempotency.put(key, tx);
            return tx;
        } finally {
            second.lock().unlock();
        }
    } finally {
        first.lock().unlock();
    }
}` }
        ],
        note: "Both the debit and the credit happen while both locks are held, so no other thread can observe money that has left one wallet but not arrived in the other."
      },
      {
        heading: "Requirement 4: Idempotent requests",
        text: "Networks time out and clients retry. Each request carries a unique idempotency key. The service remembers the result for each key, and a repeat returns that result instead of moving money again. In `transfer` above, the lookup happens first.\n\nA subtle race remains: two retries arriving together could both miss the map. `putIfAbsent` on a `ConcurrentHashMap`, or doing the lookup inside the lock, closes it.",
        code: [
          { file: "WalletService.java (state)", body: `public class WalletService {
    private final Map<String, Wallet> wallets = new ConcurrentHashMap<>();
    private final Map<String, Transaction> idempotency = new ConcurrentHashMap<>();
    private final TransactionLog log = new TransactionLog();
    private final List<TransferRule> rules;

    public WalletService(List<TransferRule> rules) { this.rules = rules; }

    public Wallet createWallet(String ownerId) {
        Wallet w = new Wallet(UUID.randomUUID().toString(), ownerId);
        wallets.put(w.getId(), w);
        return w;
    }
}` }
        ]
      },
      {
        heading: "Requirement 5: Top-ups, withdrawals and pluggable rules",
        text: "External money movement goes through a `FundingSource` interface, so adding UPI or a new bank is a new class. Rules such as a daily limit implement `TransferRule` and are injected, which keeps limit logic out of the transfer code.",
        code: [
          { file: "FundingSource.java", body: `public interface FundingSource {
    boolean charge(String accountRef, long cents);   // pull money into the wallet
    boolean payout(String accountRef, long cents);   // push money out
}` },
          { file: "WalletService.java (top-up)", body: `public Transaction topUp(String key, Wallet wallet, FundingSource source, String ref, long cents) {
    Transaction existing = idempotency.get(key);
    if (existing != null) return existing;

    if (!source.charge(ref, cents)) {
        Transaction failed = new Transaction(key, Transaction.Type.TOP_UP,
                null, wallet.getId(), cents, Transaction.Status.FAILED);
        log.append(failed);
        idempotency.put(key, failed);
        return failed;
    }
    wallet.lock().lock();
    try {
        wallet.credit(cents);
    } finally {
        wallet.lock().unlock();
    }
    Transaction tx = new Transaction(key, Transaction.Type.TOP_UP,
            null, wallet.getId(), cents, Transaction.Status.COMPLETED);
    log.append(tx);
    idempotency.put(key, tx);
    return tx;
}` },
          { file: "DailyLimitRule.java", body: `public interface TransferRule {
    void check(Wallet from, Wallet to, long cents);
}

public class DailyLimitRule implements TransferRule {
    private final long limitCents;
    private final SpentToday spentToday;

    public DailyLimitRule(long limitCents, SpentToday spentToday) {
        this.limitCents = limitCents;
        this.spentToday = spentToday;
    }

    @Override
    public void check(Wallet from, Wallet to, long cents) {
        if (spentToday.forWallet(from.getId()) + cents > limitCents) {
            throw new LimitExceededException(from.getId());
        }
    }
}` }
        ]
      }
    ],
    deepDive: [
      {
        title: "Double-entry ledger instead of a stored balance",
        text: "Real payment systems rarely store 'the balance' as the source of truth. They record **ledger entries**: every transfer writes a debit entry on one account and a credit entry on another, and the balance is the sum of entries. Because every movement has two equal and opposite entries, the books always sum to zero, and any bug shows up as an imbalance you can detect.\n\nA stored balance is then just a cached aggregate for fast reads. This also makes history, audits and reconciliation with the bank trivial.",
        code: [
          { file: "LedgerEntry.java", body: `public record LedgerEntry(
    String transactionId,
    String walletId,
    long amountCents,        // negative = debit, positive = credit
    Instant at
) {}

// A transfer of 500 writes exactly two entries:
//   (tx1, walletA, -500)
//   (tx1, walletB, +500)
// Sum of all entries for a transaction is always 0.` }
        ]
      },
      {
        title: "Scaling past one process",
        text: "In-memory locks protect one JVM only. Across servers you move atomicity into the database: do the debit and credit in one database transaction, take row locks in a consistent order (`SELECT ... FOR UPDATE` ordered by wallet id), and enforce idempotency with a unique constraint on the key. Optimistic locking with a version column also works and performs better when conflicts are rare, retrying on failure."
      }
    ],
    mistakes: [
      "Using `double` for money instead of integer minor units.",
      "Checking the balance and debiting in separate steps without a lock, so two debits overspend.",
      "Locking `from` then `to` in call order, which deadlocks on opposite-direction transfers.",
      "Retrying a failed request without an idempotency key, so the user is charged twice.",
      "Editing or deleting past transactions instead of appending a correcting one.",
      "Forcing a pattern where none is needed. Design patterns are good to have, but don't force one in just to impress the interviewer: injecting `TransferRule`s is plain composition, you don't need a Chain of Responsibility."
    ],
    followups: [
      "How would you support multiple currencies and conversion?",
      "How would you handle a top-up that is pending for minutes at the bank?",
      "How would you reverse a completed transfer (refund)?",
      "How do you reconcile your ledger with the bank's statement?"
    ],
    patterns: ["strategy", "state", "command"]
  }
);
