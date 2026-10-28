window.SOLUTIONS = window.SOLUTIONS || [];
window.SOLUTIONS.push(
{
  "id": "online-auction-system",
  "intro": "The solution is built one requirement at a time. Every step below adds classes to the previous one, and the **Complete source** section shows the final files together. The two ideas to hold on to: all state changes on an auction happen under that auction's own lock, and everything that varies (bid rules, anti-sniping, notifications) sits behind a small interface.",
  "steps": [
    {
      "title": "Requirement 1: create an auction",
      "text": "Start with the data. An `Auction` knows its item, prices and end time, owns its list of bids, and can answer 'what is the smallest bid I will accept next?'. Amounts are `long` whole units to avoid floating point money.\n\n`createAuction` validates the inputs (positive prices, end time in the future) and registers the auction.",
      "code": [
        {
          "file": "Item.java",
          "body": "public record Item(String id, String title, User seller) {}"
        },
        {
          "file": "Bid.java",
          "body": "import java.time.Instant;\n\npublic record Bid(User bidder, long amount, Instant placedAt) {}"
        },
        {
          "file": "Auction.java",
          "body": "/** The smallest amount a new bid must reach. */\npublic long minimumNextBid() {\n    return highestBid().map(b -> b.amount() + minIncrement).orElse(startPrice);\n}"
        },
        {
          "file": "AuctionService.java",
          "body": "public Auction createAuction(Item item, long startPrice, long reservePrice,\n                             long minIncrement, Instant endTime) {\n    if (startPrice <= 0 || minIncrement <= 0) throw new IllegalArgumentException(\"prices must be positive\");\n    if (!endTime.isAfter(clock.instant())) throw new IllegalArgumentException(\"end time must be in the future\");\n    Auction auction = new Auction(\"A\" + ids.incrementAndGet(), item, startPrice, reservePrice, minIncrement, endTime);\n    auctions.put(auction.id(), auction);\n    return auction;\n}"
        }
      ]
    },
    {
      "title": "Requirement 2 and 3: bid rules",
      "text": "A bid is valid only if the auction is open, the bidder is not the seller, and the amount clears the increment. Each check is one `BidRule`, so the auction class contains no validation logic at all. A rule returns a rejection reason, or empty if the bid passes.",
      "code": [
        {
          "file": "BidRule.java",
          "body": "import java.time.Instant;\nimport java.util.Optional;\n\n/** A validation rule a new bid must satisfy. Returns a rejection reason, or empty if the bid passes. */\npublic interface BidRule {\n    Optional<String> check(Auction auction, User bidder, long amount, Instant now);\n}"
        },
        {
          "file": "Rules.java",
          "body": "public static final BidRule AUCTION_OPEN = (a, bidder, amount, now) ->\n        a.status() != AuctionStatus.ACTIVE || !now.isBefore(a.endTime())\n                ? Optional.of(\"auction is not open\")\n                : Optional.empty();\n\npublic static final BidRule NOT_THE_SELLER = (a, bidder, amount, now) ->\n        a.seller().equals(bidder)\n                ? Optional.of(\"sellers cannot bid on their own auction\")\n                : Optional.empty();\n\npublic static final BidRule MIN_INCREMENT = (a, bidder, amount, now) ->\n        amount < a.minimumNextBid()\n                ? Optional.of(\"bid must be at least \" + a.minimumNextBid())\n                : Optional.empty();\n\n/** A new rule added later: no single bid above a cap. Nothing else changes. */\npublic static BidRule maxBid(long cap) {\n    return (a, bidder, amount, now) ->\n            amount > cap ? Optional.of(\"bid exceeds the cap of \" + cap) : Optional.empty();\n}"
        },
        {
          "file": "Rules.java",
          "body": "public static final BidRule NOT_THE_SELLER = (a, bidder, amount, now) ->\n        a.seller().equals(bidder)\n                ? Optional.of(\"sellers cannot bid on their own auction\")\n                : Optional.empty();\n\npublic static final BidRule MIN_INCREMENT = (a, bidder, amount, now) ->\n        amount < a.minimumNextBid()\n                ? Optional.of(\"bid must be at least \" + a.minimumNextBid())\n                : Optional.empty();\n\n/** A new rule added later: no single bid above a cap. Nothing else changes. */\npublic static BidRule maxBid(long cap) {\n    return (a, bidder, amount, now) ->\n            amount > cap ? Optional.of(\"bid exceeds the cap of \" + cap) : Optional.empty();\n}"
        },
        {
          "file": "Rules.java",
          "body": "public static final BidRule MIN_INCREMENT = (a, bidder, amount, now) ->\n        amount < a.minimumNextBid()\n                ? Optional.of(\"bid must be at least \" + a.minimumNextBid())\n                : Optional.empty();\n\n/** A new rule added later: no single bid above a cap. Nothing else changes. */\npublic static BidRule maxBid(long cap) {\n    return (a, bidder, amount, now) ->\n            amount > cap ? Optional.of(\"bid exceeds the cap of \" + cap) : Optional.empty();\n}"
        }
      ]
    },
    {
      "title": "Concurrency: serialise bids on one auction",
      "text": "Two bidders can arrive at the same moment, both see 100 as the highest bid and both try to place 110. To make exactly one of them win, the rule check and the append happen inside one critical section guarded by the auction's own lock. Different auctions have different locks, so they never block each other.\n\nNotifications are fired after the lock is released, so a slow listener can't stall other bidders.",
      "code": [
        {
          "file": "AuctionService.java",
          "body": "public BidResult placeBid(String auctionId, User bidder, long amount) {\n    Auction auction = auctions.get(auctionId);\n    if (auction == null) return BidResult.rejected(\"unknown auction\");\n\n    Bid previous;\n    Bid current;\n    auction.lock().lock();\n    try {\n        Instant now = clock.instant();\n        for (BidRule rule : rules) {\n            Optional<String> failure = rule.check(auction, bidder, amount, now);\n            if (failure.isPresent()) return BidResult.rejected(failure.get());\n        }\n        previous = auction.highestBid().orElse(null);\n        current = new Bid(bidder, amount, now);\n        auction.addBid(current);\n        auction.extendTo(extensionPolicy.endTimeAfterBid(auction, now));\n    } finally {\n        auction.lock().unlock();\n    }\n\n    // Notify outside the lock so a slow listener can't block other bidders.\n    if (previous != null && !previous.bidder().equals(bidder)) {\n        for (AuctionListener l : listeners) l.onOutbid(auction, previous, current);\n    }\n    return BidResult.ok();\n}"
        }
      ]
    },
    {
      "title": "Requirement 4: close exactly once and pick the winner",
      "text": "`closeIfDue` takes the lock, checks the status and the clock, and flips the status to `CLOSED`. A second call (or a racing thread) sees `CLOSED` and returns false, so winners are announced once. The winner is the highest bid that meets the reserve; otherwise the item goes unsold.\n\nThe periodic job simply calls `closeAllDue`.",
      "code": [
        {
          "file": "AuctionService.java",
          "body": "/** Closes the auction if its time is up. Safe to call any number of times, from any thread. */\npublic boolean closeIfDue(String auctionId) {\n    Auction auction = auctions.get(auctionId);\n    Optional<Bid> winner;\n    auction.lock().lock();\n    try {\n        if (auction.status() != AuctionStatus.ACTIVE) return false;\n        if (clock.instant().isBefore(auction.endTime())) return false;\n        auction.markClosed();\n        winner = auction.highestBid().filter(b -> b.amount() >= auction.reservePrice());\n    } finally {\n        auction.lock().unlock();\n    }\n    for (AuctionListener l : listeners) l.onClosed(auction, winner);\n    return true;\n}"
        },
        {
          "file": "AuctionService.java",
          "body": "/** What the periodic job calls. */\npublic int closeAllDue() {\n    int closed = 0;\n    for (String id : auctions.keySet()) if (closeIfDue(id)) closed++;\n    return closed;\n}"
        },
        {
          "file": "AuctionService.java",
          "body": "public Optional<Bid> winner(Auction auction) {\n    auction.lock().lock();\n    try {\n        if (auction.status() != AuctionStatus.CLOSED) return Optional.empty();\n        return auction.highestBid().filter(b -> b.amount() >= auction.reservePrice());\n    } finally {\n        auction.lock().unlock();\n    }\n}"
        }
      ]
    },
    {
      "title": "Requirement 5: notify bidders and the seller",
      "text": "Auction logic only knows about the `AuctionListener` interface. Email, SMS or push channels are new implementations that you register on the service.",
      "code": [
        {
          "file": "AuctionListener.java",
          "body": "import java.util.Optional;\n\npublic interface AuctionListener {\n    void onOutbid(Auction auction, Bid previous, Bid current);\n\n    void onClosed(Auction auction, Optional<Bid> winner);\n}"
        },
        {
          "file": "ConsoleNotifier.java",
          "body": "import java.util.Optional;\n\npublic class ConsoleNotifier implements AuctionListener {\n    @Override\n    public void onOutbid(Auction auction, Bid previous, Bid current) {\n        System.out.println(\"  [notify] \" + previous.bidder().name() + \": you were outbid on '\"\n                + auction.item().title() + \"' (\" + previous.amount() + \" -> \" + current.amount() + \")\");\n    }\n\n    @Override\n    public void onClosed(Auction auction, Optional<Bid> winner) {\n        String msg = winner\n                .map(w -> w.bidder().name() + \" won '\" + auction.item().title() + \"' at \" + w.amount())\n                .orElse(\"'\" + auction.item().title() + \"' closed unsold\");\n        System.out.println(\"  [notify] \" + msg + \" (seller: \" + auction.seller().name() + \")\");\n    }\n}"
        }
      ]
    },
    {
      "title": "Extensibility: new rules and anti-sniping",
      "text": "A new auction type or rule does not require touching `Auction` or `AuctionService`. A cap on bids is one more `BidRule`. Anti-sniping is a separate `ExtensionPolicy` consulted after each accepted bid.",
      "code": [
        {
          "file": "Rules.java",
          "body": "/** A new rule added later: no single bid above a cap. Nothing else changes. */\npublic static BidRule maxBid(long cap) {\n    return (a, bidder, amount, now) ->\n            amount > cap ? Optional.of(\"bid exceeds the cap of \" + cap) : Optional.empty();\n}"
        },
        {
          "file": "ExtensionPolicy.java",
          "body": "import java.time.Instant;\n\n/** Decides whether an accepted bid pushes the end time back (anti-sniping). */\npublic interface ExtensionPolicy {\n    Instant endTimeAfterBid(Auction auction, Instant now);\n\n    ExtensionPolicy NONE = (auction, now) -> auction.endTime();\n}"
        },
        {
          "file": "AntiSnipingPolicy.java",
          "body": "import java.time.Duration;\nimport java.time.Instant;\n\n/** If a bid lands inside the final window, extend the auction by a fixed amount. */\npublic class AntiSnipingPolicy implements ExtensionPolicy {\n    private final Duration window;\n    private final Duration extension;\n\n    public AntiSnipingPolicy(Duration window, Duration extension) {\n        this.window = window;\n        this.extension = extension;\n    }\n\n    @Override\n    public Instant endTimeAfterBid(Auction auction, Instant now) {\n        boolean inWindow = Duration.between(now, auction.endTime()).compareTo(window) <= 0;\n        return inWindow ? auction.endTime().plus(extension) : auction.endTime();\n    }\n}"
        }
      ]
    }
  ],
  "files": [
    {
      "file": "User.java",
      "body": "public record User(String id, String name) {}"
    },
    {
      "file": "Item.java",
      "body": "public record Item(String id, String title, User seller) {}"
    },
    {
      "file": "AuctionStatus.java",
      "body": "public enum AuctionStatus { ACTIVE, CLOSED, CANCELLED }"
    },
    {
      "file": "Bid.java",
      "body": "import java.time.Instant;\n\npublic record Bid(User bidder, long amount, Instant placedAt) {}"
    },
    {
      "file": "BidResult.java",
      "body": "public record BidResult(boolean accepted, String reason) {\n    public static BidResult ok() { return new BidResult(true, \"accepted\"); }\n    public static BidResult rejected(String reason) { return new BidResult(false, reason); }\n}"
    },
    {
      "file": "Auction.java",
      "body": "import java.time.Instant;\nimport java.util.ArrayList;\nimport java.util.Collections;\nimport java.util.List;\nimport java.util.Optional;\nimport java.util.concurrent.locks.ReentrantLock;\n\npublic class Auction {\n    private final String id;\n    private final Item item;\n    private final long startPrice;\n    private final long reservePrice;      // 0 means no reserve\n    private final long minIncrement;\n    private Instant endTime;\n    private AuctionStatus status = AuctionStatus.ACTIVE;\n    private final List<Bid> bids = new ArrayList<>();\n    private final ReentrantLock lock = new ReentrantLock();\n\n    public Auction(String id, Item item, long startPrice, long reservePrice,\n                   long minIncrement, Instant endTime) {\n        this.id = id;\n        this.item = item;\n        this.startPrice = startPrice;\n        this.reservePrice = reservePrice;\n        this.minIncrement = minIncrement;\n        this.endTime = endTime;\n    }\n\n    // All state changes go through lock(); readers inside the lock see a consistent view.\n    public ReentrantLock lock() { return lock; }\n\n    public String id() { return id; }\n    public Item item() { return item; }\n    public User seller() { return item.seller(); }\n    public long startPrice() { return startPrice; }\n    public long reservePrice() { return reservePrice; }\n    public long minIncrement() { return minIncrement; }\n    public Instant endTime() { return endTime; }\n    public AuctionStatus status() { return status; }\n\n    public Optional<Bid> highestBid() {\n        return bids.isEmpty() ? Optional.empty() : Optional.of(bids.get(bids.size() - 1));\n    }\n\n    /** The smallest amount a new bid must reach. */\n    public long minimumNextBid() {\n        return highestBid().map(b -> b.amount() + minIncrement).orElse(startPrice);\n    }\n\n    public List<Bid> bids() { return Collections.unmodifiableList(bids); }\n\n    void addBid(Bid bid) { bids.add(bid); }\n    void extendTo(Instant newEnd) { this.endTime = newEnd; }\n    void markClosed() { this.status = AuctionStatus.CLOSED; }\n    void markCancelled() { this.status = AuctionStatus.CANCELLED; }\n}"
    },
    {
      "file": "BidRule.java",
      "body": "import java.time.Instant;\nimport java.util.Optional;\n\n/** A validation rule a new bid must satisfy. Returns a rejection reason, or empty if the bid passes. */\npublic interface BidRule {\n    Optional<String> check(Auction auction, User bidder, long amount, Instant now);\n}"
    },
    {
      "file": "Rules.java",
      "body": "import java.time.Instant;\nimport java.util.Optional;\n\npublic final class Rules {\n    private Rules() {}\n\n    public static final BidRule AUCTION_OPEN = (a, bidder, amount, now) ->\n            a.status() != AuctionStatus.ACTIVE || !now.isBefore(a.endTime())\n                    ? Optional.of(\"auction is not open\")\n                    : Optional.empty();\n\n    public static final BidRule NOT_THE_SELLER = (a, bidder, amount, now) ->\n            a.seller().equals(bidder)\n                    ? Optional.of(\"sellers cannot bid on their own auction\")\n                    : Optional.empty();\n\n    public static final BidRule MIN_INCREMENT = (a, bidder, amount, now) ->\n            amount < a.minimumNextBid()\n                    ? Optional.of(\"bid must be at least \" + a.minimumNextBid())\n                    : Optional.empty();\n\n    /** A new rule added later: no single bid above a cap. Nothing else changes. */\n    public static BidRule maxBid(long cap) {\n        return (a, bidder, amount, now) ->\n                amount > cap ? Optional.of(\"bid exceeds the cap of \" + cap) : Optional.empty();\n    }\n}"
    },
    {
      "file": "ExtensionPolicy.java",
      "body": "import java.time.Instant;\n\n/** Decides whether an accepted bid pushes the end time back (anti-sniping). */\npublic interface ExtensionPolicy {\n    Instant endTimeAfterBid(Auction auction, Instant now);\n\n    ExtensionPolicy NONE = (auction, now) -> auction.endTime();\n}"
    },
    {
      "file": "AntiSnipingPolicy.java",
      "body": "import java.time.Duration;\nimport java.time.Instant;\n\n/** If a bid lands inside the final window, extend the auction by a fixed amount. */\npublic class AntiSnipingPolicy implements ExtensionPolicy {\n    private final Duration window;\n    private final Duration extension;\n\n    public AntiSnipingPolicy(Duration window, Duration extension) {\n        this.window = window;\n        this.extension = extension;\n    }\n\n    @Override\n    public Instant endTimeAfterBid(Auction auction, Instant now) {\n        boolean inWindow = Duration.between(now, auction.endTime()).compareTo(window) <= 0;\n        return inWindow ? auction.endTime().plus(extension) : auction.endTime();\n    }\n}"
    },
    {
      "file": "AuctionListener.java",
      "body": "import java.util.Optional;\n\npublic interface AuctionListener {\n    void onOutbid(Auction auction, Bid previous, Bid current);\n\n    void onClosed(Auction auction, Optional<Bid> winner);\n}"
    },
    {
      "file": "ConsoleNotifier.java",
      "body": "import java.util.Optional;\n\npublic class ConsoleNotifier implements AuctionListener {\n    @Override\n    public void onOutbid(Auction auction, Bid previous, Bid current) {\n        System.out.println(\"  [notify] \" + previous.bidder().name() + \": you were outbid on '\"\n                + auction.item().title() + \"' (\" + previous.amount() + \" -> \" + current.amount() + \")\");\n    }\n\n    @Override\n    public void onClosed(Auction auction, Optional<Bid> winner) {\n        String msg = winner\n                .map(w -> w.bidder().name() + \" won '\" + auction.item().title() + \"' at \" + w.amount())\n                .orElse(\"'\" + auction.item().title() + \"' closed unsold\");\n        System.out.println(\"  [notify] \" + msg + \" (seller: \" + auction.seller().name() + \")\");\n    }\n}"
    },
    {
      "file": "ManualClock.java",
      "body": "import java.time.Clock;\nimport java.time.Duration;\nimport java.time.Instant;\nimport java.time.ZoneId;\nimport java.time.ZoneOffset;\n\n/** A clock tests and demos can move forward by hand. */\npublic class ManualClock extends Clock {\n    private volatile Instant now;\n\n    public ManualClock(Instant start) { this.now = start; }\n\n    public void advance(Duration d) { now = now.plus(d); }\n\n    @Override public ZoneId getZone() { return ZoneOffset.UTC; }\n    @Override public Clock withZone(ZoneId zone) { return this; }\n    @Override public Instant instant() { return now; }\n}"
    },
    {
      "file": "AuctionService.java",
      "body": "import java.time.Clock;\nimport java.time.Instant;\nimport java.util.ArrayList;\nimport java.util.List;\nimport java.util.Map;\nimport java.util.Optional;\nimport java.util.concurrent.ConcurrentHashMap;\nimport java.util.concurrent.atomic.AtomicInteger;\n\npublic class AuctionService {\n    private final Map<String, Auction> auctions = new ConcurrentHashMap<>();\n    private final AtomicInteger ids = new AtomicInteger();\n    private final List<BidRule> rules;\n    private final ExtensionPolicy extensionPolicy;\n    private final List<AuctionListener> listeners = new ArrayList<>();\n    private final Clock clock;\n\n    public AuctionService(Clock clock, List<BidRule> rules, ExtensionPolicy extensionPolicy) {\n        this.clock = clock;\n        this.rules = List.copyOf(rules);\n        this.extensionPolicy = extensionPolicy;\n    }\n\n    public void addListener(AuctionListener listener) { listeners.add(listener); }\n\n    public Auction createAuction(Item item, long startPrice, long reservePrice,\n                                 long minIncrement, Instant endTime) {\n        if (startPrice <= 0 || minIncrement <= 0) throw new IllegalArgumentException(\"prices must be positive\");\n        if (!endTime.isAfter(clock.instant())) throw new IllegalArgumentException(\"end time must be in the future\");\n        Auction auction = new Auction(\"A\" + ids.incrementAndGet(), item, startPrice, reservePrice, minIncrement, endTime);\n        auctions.put(auction.id(), auction);\n        return auction;\n    }\n\n    public BidResult placeBid(String auctionId, User bidder, long amount) {\n        Auction auction = auctions.get(auctionId);\n        if (auction == null) return BidResult.rejected(\"unknown auction\");\n\n        Bid previous;\n        Bid current;\n        auction.lock().lock();\n        try {\n            Instant now = clock.instant();\n            for (BidRule rule : rules) {\n                Optional<String> failure = rule.check(auction, bidder, amount, now);\n                if (failure.isPresent()) return BidResult.rejected(failure.get());\n            }\n            previous = auction.highestBid().orElse(null);\n            current = new Bid(bidder, amount, now);\n            auction.addBid(current);\n            auction.extendTo(extensionPolicy.endTimeAfterBid(auction, now));\n        } finally {\n            auction.lock().unlock();\n        }\n\n        // Notify outside the lock so a slow listener can't block other bidders.\n        if (previous != null && !previous.bidder().equals(bidder)) {\n            for (AuctionListener l : listeners) l.onOutbid(auction, previous, current);\n        }\n        return BidResult.ok();\n    }\n\n    /** Closes the auction if its time is up. Safe to call any number of times, from any thread. */\n    public boolean closeIfDue(String auctionId) {\n        Auction auction = auctions.get(auctionId);\n        Optional<Bid> winner;\n        auction.lock().lock();\n        try {\n            if (auction.status() != AuctionStatus.ACTIVE) return false;\n            if (clock.instant().isBefore(auction.endTime())) return false;\n            auction.markClosed();\n            winner = auction.highestBid().filter(b -> b.amount() >= auction.reservePrice());\n        } finally {\n            auction.lock().unlock();\n        }\n        for (AuctionListener l : listeners) l.onClosed(auction, winner);\n        return true;\n    }\n\n    /** What the periodic job calls. */\n    public int closeAllDue() {\n        int closed = 0;\n        for (String id : auctions.keySet()) if (closeIfDue(id)) closed++;\n        return closed;\n    }\n\n    public boolean cancel(String auctionId) {\n        Auction auction = auctions.get(auctionId);\n        auction.lock().lock();\n        try {\n            if (auction.status() != AuctionStatus.ACTIVE || !auction.bids().isEmpty()) return false;\n            auction.markCancelled();\n            return true;\n        } finally {\n            auction.lock().unlock();\n        }\n    }\n\n    public Optional<Bid> winner(Auction auction) {\n        auction.lock().lock();\n        try {\n            if (auction.status() != AuctionStatus.CLOSED) return Optional.empty();\n            return auction.highestBid().filter(b -> b.amount() >= auction.reservePrice());\n        } finally {\n            auction.lock().unlock();\n        }\n    }\n}"
    }
  ],
  "driver": {
    "text": "The driver walks through every requirement in order: creating an auction, accepted and rejected bids, anti-sniping, closing twice, a reserve that is not met, and a new rule plugged in. `ManualClock` lets it move time forward instead of sleeping.",
    "file": "Main.java",
    "body": "import java.time.Duration;\nimport java.time.Instant;\nimport java.util.List;\n\npublic class Main {\n    public static void main(String[] args) {\n        ManualClock clock = new ManualClock(Instant.parse(\"2026-01-01T10:00:00Z\"));\n        AuctionService service = new AuctionService(clock,\n                List.of(Rules.AUCTION_OPEN, Rules.NOT_THE_SELLER, Rules.MIN_INCREMENT),\n                new AntiSnipingPolicy(Duration.ofMinutes(2), Duration.ofMinutes(5)));\n        service.addListener(new ConsoleNotifier());\n\n        User sara = new User(\"u1\", \"Sara\");\n        User ben = new User(\"u2\", \"Ben\");\n        User chloe = new User(\"u3\", \"Chloe\");\n\n        System.out.println(\"-- 1. Create an auction (start 100, reserve 200, increment 10, ends in 1h)\");\n        Auction watch = service.createAuction(new Item(\"i1\", \"Vintage watch\", sara), 100, 200, 10,\n                clock.instant().plus(Duration.ofHours(1)));\n        System.out.println(\"  \" + watch.id() + \" is \" + watch.status() + \", minimum bid \" + watch.minimumNextBid());\n\n        System.out.println(\"-- 2. Place bids (rules enforced)\");\n        show(\"Ben bids 100\", service.placeBid(watch.id(), ben, 100));\n        show(\"Chloe bids 105 (below increment)\", service.placeBid(watch.id(), chloe, 105));\n        show(\"Sara bids 500 on her own item\", service.placeBid(watch.id(), sara, 500));\n        show(\"Chloe bids 150\", service.placeBid(watch.id(), chloe, 150));\n        show(\"Ben bids 210\", service.placeBid(watch.id(), ben, 210));\n\n        System.out.println(\"-- 3. Anti-sniping: a bid in the last 2 minutes extends the end time\");\n        clock.advance(Duration.ofMinutes(59));\n        show(\"Chloe bids 230 at T+59m\", service.placeBid(watch.id(), chloe, 230));\n        System.out.println(\"  end time moved to T+\" + Duration.between(Instant.parse(\"2026-01-01T10:00:00Z\"), watch.endTime()).toMinutes() + \"m\");\n\n        System.out.println(\"-- 4. Closing: the job runs twice, the auction closes once\");\n        clock.advance(Duration.ofMinutes(10));\n        System.out.println(\"  closed first run: \" + service.closeAllDue());\n        System.out.println(\"  closed second run: \" + service.closeAllDue());\n        show(\"Ben bids 300 after close\", service.placeBid(watch.id(), ben, 300));\n        System.out.println(\"  winner: \" + service.winner(watch).map(b -> b.bidder().name() + \" at \" + b.amount()).orElse(\"none\"));\n\n        System.out.println(\"-- 5. Reserve not met: item goes unsold\");\n        Auction lamp = service.createAuction(new Item(\"i2\", \"Brass lamp\", sara), 50, 500, 5,\n                clock.instant().plus(Duration.ofMinutes(30)));\n        service.placeBid(lamp.id(), ben, 60);\n        clock.advance(Duration.ofMinutes(31));\n        service.closeAllDue();\n        System.out.println(\"  winner: \" + service.winner(lamp).map(b -> b.bidder().name()).orElse(\"none\"));\n\n        System.out.println(\"-- 6. Extensibility: add a new rule without touching Auction\");\n        AuctionService capped = new AuctionService(clock,\n                List.of(Rules.AUCTION_OPEN, Rules.NOT_THE_SELLER, Rules.MIN_INCREMENT, Rules.maxBid(1000)),\n                ExtensionPolicy.NONE);\n        Auction vase = capped.createAuction(new Item(\"i3\", \"Vase\", sara), 10, 0, 5,\n                clock.instant().plus(Duration.ofHours(1)));\n        show(\"Ben bids 5000 with a 1000 cap\", capped.placeBid(vase.id(), ben, 5000));\n    }\n\n    private static void show(String what, BidResult r) {\n        System.out.println(\"  \" + what + \" -> \" + (r.accepted() ? \"OK\" : \"REJECTED (\" + r.reason() + \")\"));\n    }\n}",
    "output": "-- 1. Create an auction (start 100, reserve 200, increment 10, ends in 1h)\n  A1 is ACTIVE, minimum bid 100\n-- 2. Place bids (rules enforced)\n  Ben bids 100 -> OK\n  Chloe bids 105 (below increment) -> REJECTED (bid must be at least 110)\n  Sara bids 500 on her own item -> REJECTED (sellers cannot bid on their own auction)\n  [notify] Ben: you were outbid on 'Vintage watch' (100 -> 150)\n  Chloe bids 150 -> OK\n  [notify] Chloe: you were outbid on 'Vintage watch' (150 -> 210)\n  Ben bids 210 -> OK\n-- 3. Anti-sniping: a bid in the last 2 minutes extends the end time\n  [notify] Ben: you were outbid on 'Vintage watch' (210 -> 230)\n  Chloe bids 230 at T+59m -> OK\n  end time moved to T+65m\n-- 4. Closing: the job runs twice, the auction closes once\n  [notify] Chloe won 'Vintage watch' at 230 (seller: Sara)\n  closed first run: 1\n  closed second run: 0\n  Ben bids 300 after close -> REJECTED (auction is not open)\n  winner: Chloe at 230\n-- 5. Reserve not met: item goes unsold\n  [notify] 'Brass lamp' closed unsold (seller: Sara)\n  winner: none\n-- 6. Extensibility: add a new rule without touching Auction\n  Ben bids 5000 with a 1000 cap -> REJECTED (bid exceeds the cap of 1000)"
  },
  "tests": {
    "file": "Tests.java",
    "cases": [
      "bid below start price is rejected",
      "bid at start price is accepted",
      "bid under minimum increment is rejected",
      "bid exactly at increment is accepted",
      "highest bid tracks the latest accepted bid",
      "seller cannot bid on own auction",
      "no bids after end time, even before the close job runs",
      "unknown auction is rejected",
      "auction does not close before end time",
      "highest bid meeting the reserve wins",
      "reserve not met means no winner",
      "auction with no bids closes unsold",
      "auction without bids can be cancelled",
      "auction with bids cannot be cancelled",
      "early bid does not extend the auction",
      "late bid extends the end time",
      "previous highest bidder is notified when outbid",
      "concurrent bids never leave a lower bid after a higher one",
      "the highest concurrent bid wins",
      "auction closes exactly once when the close job races",
      "a custom rule plugs in without changing Auction"
    ],
    "body": "import java.time.Duration;\nimport java.time.Instant;\nimport java.util.ArrayList;\nimport java.util.List;\nimport java.util.Optional;\nimport java.util.concurrent.CountDownLatch;\nimport java.util.concurrent.ExecutorService;\nimport java.util.concurrent.Executors;\nimport java.util.concurrent.TimeUnit;\nimport java.util.concurrent.atomic.AtomicInteger;\n\npublic class Tests {\n    static final Instant START = Instant.parse(\"2026-01-01T10:00:00Z\");\n    static final User SELLER = new User(\"s\", \"Seller\");\n    static final User A = new User(\"a\", \"A\");\n    static final User B = new User(\"b\", \"B\");\n\n    static AuctionService service(ManualClock clock, ExtensionPolicy policy) {\n        return new AuctionService(clock,\n                List.of(Rules.AUCTION_OPEN, Rules.NOT_THE_SELLER, Rules.MIN_INCREMENT), policy);\n    }\n\n    static Auction newAuction(AuctionService s, ManualClock c, long reserve) {\n        return s.createAuction(new Item(\"i\", \"Thing\", SELLER), 100, reserve, 10, c.instant().plus(Duration.ofHours(1)));\n    }\n\n    static void check(boolean cond, String name) {\n        if (!cond) throw new AssertionError(\"FAIL: \" + name);\n        System.out.println(\"PASS: \" + name);\n    }\n\n    public static void main(String[] args) throws Exception {\n        { // first bid must reach the start price\n            ManualClock c = new ManualClock(START);\n            AuctionService s = service(c, ExtensionPolicy.NONE);\n            Auction a = newAuction(s, c, 0);\n            check(!s.placeBid(a.id(), A, 99).accepted(), \"bid below start price is rejected\");\n            check(s.placeBid(a.id(), A, 100).accepted(), \"bid at start price is accepted\");\n        }\n        { // increments\n            ManualClock c = new ManualClock(START);\n            AuctionService s = service(c, ExtensionPolicy.NONE);\n            Auction a = newAuction(s, c, 0);\n            s.placeBid(a.id(), A, 100);\n            check(!s.placeBid(a.id(), B, 109).accepted(), \"bid under minimum increment is rejected\");\n            check(s.placeBid(a.id(), B, 110).accepted(), \"bid exactly at increment is accepted\");\n            check(a.highestBid().get().amount() == 110, \"highest bid tracks the latest accepted bid\");\n        }\n        { // seller\n            ManualClock c = new ManualClock(START);\n            AuctionService s = service(c, ExtensionPolicy.NONE);\n            Auction a = newAuction(s, c, 0);\n            check(!s.placeBid(a.id(), SELLER, 500).accepted(), \"seller cannot bid on own auction\");\n        }\n        { // closed / unknown\n            ManualClock c = new ManualClock(START);\n            AuctionService s = service(c, ExtensionPolicy.NONE);\n            Auction a = newAuction(s, c, 0);\n            s.placeBid(a.id(), A, 100);\n            c.advance(Duration.ofHours(2));\n            check(!s.placeBid(a.id(), B, 200).accepted(), \"no bids after end time, even before the close job runs\");\n            check(!s.placeBid(\"nope\", A, 100).accepted(), \"unknown auction is rejected\");\n        }\n        { // winner and reserve\n            ManualClock c = new ManualClock(START);\n            AuctionService s = service(c, ExtensionPolicy.NONE);\n            Auction met = newAuction(s, c, 150);\n            Auction unmet = newAuction(s, c, 500);\n            s.placeBid(met.id(), A, 160);\n            s.placeBid(unmet.id(), A, 160);\n            check(!s.closeIfDue(met.id()), \"auction does not close before end time\");\n            c.advance(Duration.ofHours(1));\n            s.closeAllDue();\n            check(s.winner(met).map(b -> b.bidder().equals(A)).orElse(false), \"highest bid meeting the reserve wins\");\n            check(s.winner(unmet).isEmpty(), \"reserve not met means no winner\");\n        }\n        { // no bids at all\n            ManualClock c = new ManualClock(START);\n            AuctionService s = service(c, ExtensionPolicy.NONE);\n            Auction a = newAuction(s, c, 0);\n            c.advance(Duration.ofHours(1));\n            s.closeAllDue();\n            check(a.status() == AuctionStatus.CLOSED && s.winner(a).isEmpty(), \"auction with no bids closes unsold\");\n        }\n        { // cancel\n            ManualClock c = new ManualClock(START);\n            AuctionService s = service(c, ExtensionPolicy.NONE);\n            Auction clean = newAuction(s, c, 0);\n            Auction bid = newAuction(s, c, 0);\n            s.placeBid(bid.id(), A, 100);\n            check(s.cancel(clean.id()) && clean.status() == AuctionStatus.CANCELLED, \"auction without bids can be cancelled\");\n            check(!s.cancel(bid.id()), \"auction with bids cannot be cancelled\");\n        }\n        { // anti sniping\n            ManualClock c = new ManualClock(START);\n            AuctionService s = service(c, new AntiSnipingPolicy(Duration.ofMinutes(2), Duration.ofMinutes(5)));\n            Auction a = newAuction(s, c, 0);\n            Instant original = a.endTime();\n            s.placeBid(a.id(), A, 100);\n            check(a.endTime().equals(original), \"early bid does not extend the auction\");\n            c.advance(Duration.ofMinutes(59));\n            s.placeBid(a.id(), B, 110);\n            check(a.endTime().equals(original.plus(Duration.ofMinutes(5))), \"late bid extends the end time\");\n        }\n        { // outbid notification\n            ManualClock c = new ManualClock(START);\n            AuctionService s = service(c, ExtensionPolicy.NONE);\n            AtomicInteger outbid = new AtomicInteger();\n            s.addListener(new AuctionListener() {\n                public void onOutbid(Auction a, Bid p, Bid cur) { outbid.incrementAndGet(); }\n                public void onClosed(Auction a, Optional<Bid> w) {}\n            });\n            Auction a = newAuction(s, c, 0);\n            s.placeBid(a.id(), A, 100);\n            s.placeBid(a.id(), B, 110);\n            check(outbid.get() == 1, \"previous highest bidder is notified when outbid\");\n        }\n        { // concurrent bids\n            ManualClock c = new ManualClock(START);\n            AuctionService s = service(c, ExtensionPolicy.NONE);\n            Auction a = newAuction(s, c, 0);\n            int n = 64;\n            ExecutorService pool = Executors.newFixedThreadPool(16);\n            CountDownLatch go = new CountDownLatch(1);\n            List<User> users = new ArrayList<>();\n            for (int i = 0; i < n; i++) users.add(new User(\"u\" + i, \"U\" + i));\n            for (int i = 0; i < n; i++) {\n                final int idx = i;\n                pool.submit(() -> {\n                    try { go.await(); } catch (InterruptedException e) { return; }\n                    s.placeBid(a.id(), users.get(idx), 100 + idx * 10L);\n                });\n            }\n            go.countDown();\n            pool.shutdown();\n            pool.awaitTermination(10, TimeUnit.SECONDS);\n            List<Bid> history = a.bids();\n            boolean increasing = true;\n            for (int i = 1; i < history.size(); i++) {\n                if (history.get(i).amount() < history.get(i - 1).amount() + 10) increasing = false;\n            }\n            check(increasing, \"concurrent bids never leave a lower bid after a higher one\");\n            check(a.highestBid().get().amount() == 100 + (n - 1) * 10L, \"the highest concurrent bid wins\");\n        }\n        { // concurrent close\n            ManualClock c = new ManualClock(START);\n            AuctionService s = service(c, ExtensionPolicy.NONE);\n            AtomicInteger closed = new AtomicInteger();\n            s.addListener(new AuctionListener() {\n                public void onOutbid(Auction a, Bid p, Bid cur) {}\n                public void onClosed(Auction a, Optional<Bid> w) { closed.incrementAndGet(); }\n            });\n            Auction a = newAuction(s, c, 0);\n            s.placeBid(a.id(), A, 100);\n            c.advance(Duration.ofHours(1));\n            ExecutorService pool = Executors.newFixedThreadPool(8);\n            CountDownLatch go = new CountDownLatch(1);\n            for (int i = 0; i < 8; i++) pool.submit(() -> {\n                try { go.await(); } catch (InterruptedException e) { return; }\n                s.closeAllDue();\n            });\n            go.countDown();\n            pool.shutdown();\n            pool.awaitTermination(10, TimeUnit.SECONDS);\n            check(closed.get() == 1, \"auction closes exactly once when the close job races\");\n        }\n        { // new rule\n            ManualClock c = new ManualClock(START);\n            AuctionService s = new AuctionService(c,\n                    List.of(Rules.AUCTION_OPEN, Rules.MIN_INCREMENT, Rules.maxBid(200)), ExtensionPolicy.NONE);\n            Auction a = newAuction(s, c, 0);\n            check(!s.placeBid(a.id(), A, 201).accepted() && s.placeBid(a.id(), A, 200).accepted(), \"a custom rule plugs in without changing Auction\");\n        }\n        System.out.println(\"ALL TESTS PASSED\");\n    }\n}",
    "output": "PASS: bid below start price is rejected\nPASS: bid at start price is accepted\nPASS: bid under minimum increment is rejected\nPASS: bid exactly at increment is accepted\nPASS: highest bid tracks the latest accepted bid\nPASS: seller cannot bid on own auction\nPASS: no bids after end time, even before the close job runs\nPASS: unknown auction is rejected\nPASS: auction does not close before end time\nPASS: highest bid meeting the reserve wins\nPASS: reserve not met means no winner\nPASS: auction with no bids closes unsold\nPASS: auction without bids can be cancelled\nPASS: auction with bids cannot be cancelled\nPASS: early bid does not extend the auction\nPASS: late bid extends the end time\nPASS: previous highest bidder is notified when outbid\nPASS: concurrent bids never leave a lower bid after a higher one\nPASS: the highest concurrent bid wins\nPASS: auction closes exactly once when the close job races\nPASS: a custom rule plugs in without changing Auction\nALL TESTS PASSED"
  },
  "complexity": [
    "placeBid: O(r) for r bid rules, plus the time spent waiting for that one auction's lock",
    "highest bid / minimum next bid: O(1) (last element of the bid list)",
    "closeAllDue: O(a) over all auctions; each close is O(1)",
    "Space: O(a + b) for auctions and bids"
  ]
},
{
  "id": "hotel-management-system",
  "intro": "Rooms hold their own bookings, and a room is the unit of locking. That one decision gives you no double-booking without a global lock. Each step below adds one requirement; the **Complete source** shows the final files.",
  "steps": [
    {
      "title": "Requirement 1: rooms and availability search",
      "text": "A `RoomType` carries the base price and capacity, so adding a type is one enum constant. A room answers 'am I free for these nights?' by checking its active bookings; `Hotel.search` filters by type and capacity and asks each room.",
      "code": [
        {
          "file": "RoomType.java",
          "body": "public enum RoomType {\n    STANDARD(100, 2),\n    DELUXE(180, 3),\n    SUITE(350, 4);\n\n    private final long basePrice;\n    private final int capacity;\n\n    RoomType(long basePrice, int capacity) {\n        this.basePrice = basePrice;\n        this.capacity = capacity;\n    }\n\n    public long basePrice() { return basePrice; }\n    public int capacity() { return capacity; }\n}"
        },
        {
          "file": "Room.java",
          "body": "public synchronized boolean isAvailable(LocalDate from, LocalDate to) {\n    return bookings.stream().noneMatch(b -> b.status().holdsRoom() && b.overlaps(from, to));\n}"
        },
        {
          "file": "Hotel.java",
          "body": "/** Rooms free for every night in [from, to) that fit the party. Type is optional (null = any). */\npublic List<Room> search(LocalDate from, LocalDate to, RoomType type, int guests) {\n    validate(from, to);\n    List<Room> result = new ArrayList<>();\n    for (Room room : rooms) {\n        if (type != null && room.type() != type) continue;\n        if (room.type().capacity() < guests) continue;\n        if (room.isAvailable(from, to)) result.add(room);\n    }\n    return result;\n}"
        }
      ]
    },
    {
      "title": "Requirement 2: the booking lifecycle",
      "text": "A booking moves `CONFIRMED -> CHECKED_IN -> CHECKED_OUT`, or `CONFIRMED -> CANCELLED`. The allowed moves live in the enum, so an illegal change (cancel after check-in) fails in one place.\n\nDates are half-open, `[checkIn, checkOut)`: a guest leaving on the 26th does not block someone arriving on the 26th.",
      "code": [
        {
          "file": "BookingStatus.java",
          "body": "public enum BookingStatus {\n    CONFIRMED, CHECKED_IN, CHECKED_OUT, CANCELLED;\n\n    public boolean canMoveTo(BookingStatus next) {\n        return switch (this) {\n            case CONFIRMED -> next == CHECKED_IN || next == CANCELLED;\n            case CHECKED_IN -> next == CHECKED_OUT;\n            case CHECKED_OUT, CANCELLED -> false;\n        };\n    }\n\n    /** Statuses that hold the room, so they block other bookings. */\n    public boolean holdsRoom() {\n        return this == CONFIRMED || this == CHECKED_IN;\n    }\n}"
        },
        {
          "file": "Booking.java",
          "body": "/** Half-open range overlap: [checkIn, checkOut). Back-to-back stays do not conflict. */\npublic boolean overlaps(LocalDate from, LocalDate to) {\n    return checkIn.isBefore(to) && from.isBefore(checkOut);\n}"
        },
        {
          "file": "Booking.java",
          "body": "public synchronized void moveTo(BookingStatus next) {\n    if (!status.canMoveTo(next)) {\n        throw new IllegalStateException(\"cannot go from \" + status + \" to \" + next);\n    }\n    status = next;\n}"
        }
      ]
    },
    {
      "title": "Requirement 3: book without double-booking",
      "text": "`Room.tryBook` checks availability and inserts the booking in one synchronized step, so two guests can never both pass the check and then both insert. `Hotel.book` treats `search` as a hint only: if another guest takes the room first, `tryBook` says no and the loop moves to the next candidate.",
      "code": [
        {
          "file": "Room.java",
          "body": "/**\n * Check-and-book in one synchronized step, so two guests can never both pass the check\n * and then both insert.\n */\npublic synchronized Optional<Booking> tryBook(Guest guest, LocalDate from, LocalDate to) {\n    if (!isAvailable(from, to)) return Optional.empty();\n    Booking booking = new Booking(\"B\" + BOOKING_IDS.incrementAndGet(), guest, this, from, to);\n    bookings.add(booking);\n    return Optional.of(booking);\n}"
        },
        {
          "file": "Hotel.java",
          "body": "/** Books the first free room of the requested type. Returns empty if none is free. */\npublic Optional<Booking> book(Guest guest, RoomType type, int guests, LocalDate from, LocalDate to) {\n    // search() is only a hint: another guest may take the room before tryBook runs,\n    // so we move on to the next candidate whenever tryBook says no.\n    for (Room candidate : search(from, to, type, guests)) {\n        Optional<Booking> booking = candidate.tryBook(guest, from, to);\n        if (booking.isPresent()) {\n            bookings.put(booking.get().id(), booking.get());\n            return booking;\n        }\n    }\n    return Optional.empty();\n}"
        }
      ]
    },
    {
      "title": "Requirement 4: billing with extras",
      "text": "An invoice is a list of `ChargeItem`s. The room charge is computed night by night from a `PricingPolicy`, which is where seasonal pricing plugs in. Extras (room service, spa) are more `ChargeItem` implementations, so `Invoice` and `InvoiceService` never change when a new charge type appears.",
      "code": [
        {
          "file": "ChargeItem.java",
          "body": "/** One billable line on an invoice. New kinds of charge are new implementations; Invoice never changes. */\npublic interface ChargeItem {\n    String description();\n\n    long amount();\n}"
        },
        {
          "file": "RoomServiceCharge.java",
          "body": "public record RoomServiceCharge(String item, long amount) implements ChargeItem {\n    @Override public String description() { return \"Room service: \" + item; }\n}"
        },
        {
          "file": "SpaCharge.java",
          "body": "/** Added later, with no change to Invoice, Booking or InvoiceService. */\npublic record SpaCharge(String treatment, long amount) implements ChargeItem {\n    @Override public String description() { return \"Spa: \" + treatment; }\n}"
        },
        {
          "file": "PricingPolicy.java",
          "body": "import java.time.LocalDate;\n\npublic interface PricingPolicy {\n    /** Price for one night, the night that starts on {@code night}. */\n    long nightlyRate(RoomType type, LocalDate night);\n}"
        },
        {
          "file": "SeasonalPricing.java",
          "body": "import java.time.LocalDate;\n\n/** Wraps another policy and applies a multiplier on peak-season nights and weekends. */\npublic class SeasonalPricing implements PricingPolicy {\n    private final PricingPolicy inner;\n    private final LocalDate peakFrom;\n    private final LocalDate peakTo;      // exclusive\n    private final double peakMultiplier;\n\n    public SeasonalPricing(PricingPolicy inner, LocalDate peakFrom, LocalDate peakTo, double peakMultiplier) {\n        this.inner = inner;\n        this.peakFrom = peakFrom;\n        this.peakTo = peakTo;\n        this.peakMultiplier = peakMultiplier;\n    }\n\n    @Override\n    public long nightlyRate(RoomType type, LocalDate night) {\n        long rate = inner.nightlyRate(type, night);\n        boolean peak = !night.isBefore(peakFrom) && night.isBefore(peakTo);\n        return peak ? Math.round(rate * peakMultiplier) : rate;\n    }\n}"
        },
        {
          "file": "InvoiceService.java",
          "body": "public Invoice generate(Booking booking) {\n    List<ChargeItem> lines = new ArrayList<>();\n    for (LocalDate night = booking.checkInDate(); night.isBefore(booking.checkOutDate()); night = night.plusDays(1)) {\n        long rate = pricing.nightlyRate(booking.room().type(), night);\n        lines.add(new RoomCharge(\"Room \" + booking.room().number() + \" night of \" + night, rate));\n    }\n    lines.addAll(booking.extras());\n    return new Invoice(booking.id(), booking.guest().name(), lines);\n}"
        }
      ]
    },
    {
      "title": "Requirement 5: front-desk operations",
      "text": "`FrontDesk` is a thin facade over the lifecycle: check in (only during the stay), check out (which produces the invoice), cancel (only before check-in) and add charges (only while checked in). The rules themselves are enforced by `Booking`.",
      "code": [
        {
          "file": "FrontDesk.java",
          "body": "import java.time.LocalDate;\n\npublic class FrontDesk {\n    private final Hotel hotel;\n    private final InvoiceService invoices;\n\n    public FrontDesk(Hotel hotel, InvoiceService invoices) {\n        this.hotel = hotel;\n        this.invoices = invoices;\n    }\n\n    public void checkIn(String bookingId, LocalDate today) {\n        Booking b = hotel.booking(bookingId);\n        if (today.isBefore(b.checkInDate()) || !today.isBefore(b.checkOutDate())) {\n            throw new IllegalStateException(\"today is outside the booked stay\");\n        }\n        b.moveTo(BookingStatus.CHECKED_IN);\n    }\n\n    public Invoice checkOut(String bookingId) {\n        Booking b = hotel.booking(bookingId);\n        b.moveTo(BookingStatus.CHECKED_OUT);\n        return invoices.generate(b);\n    }\n\n    /** Guests may cancel only before check-in. */\n    public void cancel(String bookingId) {\n        hotel.booking(bookingId).moveTo(BookingStatus.CANCELLED);\n    }\n\n    public void addCharge(String bookingId, ChargeItem charge) {\n        hotel.booking(bookingId).addCharge(charge);\n    }\n}"
        }
      ]
    }
  ],
  "files": [
    {
      "file": "RoomType.java",
      "body": "public enum RoomType {\n    STANDARD(100, 2),\n    DELUXE(180, 3),\n    SUITE(350, 4);\n\n    private final long basePrice;\n    private final int capacity;\n\n    RoomType(long basePrice, int capacity) {\n        this.basePrice = basePrice;\n        this.capacity = capacity;\n    }\n\n    public long basePrice() { return basePrice; }\n    public int capacity() { return capacity; }\n}"
    },
    {
      "file": "Guest.java",
      "body": "public record Guest(String id, String name) {}"
    },
    {
      "file": "BookingStatus.java",
      "body": "public enum BookingStatus {\n    CONFIRMED, CHECKED_IN, CHECKED_OUT, CANCELLED;\n\n    public boolean canMoveTo(BookingStatus next) {\n        return switch (this) {\n            case CONFIRMED -> next == CHECKED_IN || next == CANCELLED;\n            case CHECKED_IN -> next == CHECKED_OUT;\n            case CHECKED_OUT, CANCELLED -> false;\n        };\n    }\n\n    /** Statuses that hold the room, so they block other bookings. */\n    public boolean holdsRoom() {\n        return this == CONFIRMED || this == CHECKED_IN;\n    }\n}"
    },
    {
      "file": "ChargeItem.java",
      "body": "/** One billable line on an invoice. New kinds of charge are new implementations; Invoice never changes. */\npublic interface ChargeItem {\n    String description();\n\n    long amount();\n}"
    },
    {
      "file": "RoomCharge.java",
      "body": "public record RoomCharge(String description, long amount) implements ChargeItem {}"
    },
    {
      "file": "RoomServiceCharge.java",
      "body": "public record RoomServiceCharge(String item, long amount) implements ChargeItem {\n    @Override public String description() { return \"Room service: \" + item; }\n}"
    },
    {
      "file": "SpaCharge.java",
      "body": "/** Added later, with no change to Invoice, Booking or InvoiceService. */\npublic record SpaCharge(String treatment, long amount) implements ChargeItem {\n    @Override public String description() { return \"Spa: \" + treatment; }\n}"
    },
    {
      "file": "Booking.java",
      "body": "import java.time.LocalDate;\nimport java.time.temporal.ChronoUnit;\nimport java.util.ArrayList;\nimport java.util.Collections;\nimport java.util.List;\n\npublic class Booking {\n    private final String id;\n    private final Guest guest;\n    private final Room room;\n    private final LocalDate checkIn;     // first night\n    private final LocalDate checkOut;    // departure day: the night of checkOut is NOT stayed\n    private BookingStatus status = BookingStatus.CONFIRMED;\n    private final List<ChargeItem> extras = new ArrayList<>();\n\n    Booking(String id, Guest guest, Room room, LocalDate checkIn, LocalDate checkOut) {\n        this.id = id;\n        this.guest = guest;\n        this.room = room;\n        this.checkIn = checkIn;\n        this.checkOut = checkOut;\n    }\n\n    public String id() { return id; }\n    public Guest guest() { return guest; }\n    public Room room() { return room; }\n    public LocalDate checkInDate() { return checkIn; }\n    public LocalDate checkOutDate() { return checkOut; }\n    public synchronized BookingStatus status() { return status; }\n    public long nights() { return ChronoUnit.DAYS.between(checkIn, checkOut); }\n\n    /** Half-open range overlap: [checkIn, checkOut). Back-to-back stays do not conflict. */\n    public boolean overlaps(LocalDate from, LocalDate to) {\n        return checkIn.isBefore(to) && from.isBefore(checkOut);\n    }\n\n    public synchronized void moveTo(BookingStatus next) {\n        if (!status.canMoveTo(next)) {\n            throw new IllegalStateException(\"cannot go from \" + status + \" to \" + next);\n        }\n        status = next;\n    }\n\n    public synchronized void addCharge(ChargeItem charge) {\n        if (status != BookingStatus.CHECKED_IN) {\n            throw new IllegalStateException(\"charges can only be added while checked in\");\n        }\n        extras.add(charge);\n    }\n\n    public synchronized List<ChargeItem> extras() {\n        return Collections.unmodifiableList(new ArrayList<>(extras));\n    }\n}"
    },
    {
      "file": "Room.java",
      "body": "import java.time.LocalDate;\nimport java.util.ArrayList;\nimport java.util.List;\nimport java.util.Optional;\nimport java.util.concurrent.atomic.AtomicInteger;\n\npublic class Room {\n    private static final AtomicInteger BOOKING_IDS = new AtomicInteger();\n\n    private final int number;\n    private final RoomType type;\n    private final List<Booking> bookings = new ArrayList<>();\n\n    public Room(int number, RoomType type) {\n        this.number = number;\n        this.type = type;\n    }\n\n    public int number() { return number; }\n    public RoomType type() { return type; }\n\n    public synchronized boolean isAvailable(LocalDate from, LocalDate to) {\n        return bookings.stream().noneMatch(b -> b.status().holdsRoom() && b.overlaps(from, to));\n    }\n\n    /**\n     * Check-and-book in one synchronized step, so two guests can never both pass the check\n     * and then both insert.\n     */\n    public synchronized Optional<Booking> tryBook(Guest guest, LocalDate from, LocalDate to) {\n        if (!isAvailable(from, to)) return Optional.empty();\n        Booking booking = new Booking(\"B\" + BOOKING_IDS.incrementAndGet(), guest, this, from, to);\n        bookings.add(booking);\n        return Optional.of(booking);\n    }\n}"
    },
    {
      "file": "Hotel.java",
      "body": "import java.time.LocalDate;\nimport java.util.ArrayList;\nimport java.util.List;\nimport java.util.Map;\nimport java.util.Optional;\nimport java.util.concurrent.ConcurrentHashMap;\n\npublic class Hotel {\n    private final String name;\n    private final List<Room> rooms = new ArrayList<>();\n    private final Map<String, Booking> bookings = new ConcurrentHashMap<>();\n\n    public Hotel(String name) { this.name = name; }\n\n    public String name() { return name; }\n\n    public void addRoom(Room room) { rooms.add(room); }\n\n    /** Rooms free for every night in [from, to) that fit the party. Type is optional (null = any). */\n    public List<Room> search(LocalDate from, LocalDate to, RoomType type, int guests) {\n        validate(from, to);\n        List<Room> result = new ArrayList<>();\n        for (Room room : rooms) {\n            if (type != null && room.type() != type) continue;\n            if (room.type().capacity() < guests) continue;\n            if (room.isAvailable(from, to)) result.add(room);\n        }\n        return result;\n    }\n\n    /** Books the first free room of the requested type. Returns empty if none is free. */\n    public Optional<Booking> book(Guest guest, RoomType type, int guests, LocalDate from, LocalDate to) {\n        // search() is only a hint: another guest may take the room before tryBook runs,\n        // so we move on to the next candidate whenever tryBook says no.\n        for (Room candidate : search(from, to, type, guests)) {\n            Optional<Booking> booking = candidate.tryBook(guest, from, to);\n            if (booking.isPresent()) {\n                bookings.put(booking.get().id(), booking.get());\n                return booking;\n            }\n        }\n        return Optional.empty();\n    }\n\n    /** Books a specific room. */\n    public Optional<Booking> bookRoom(Guest guest, int roomNumber, LocalDate from, LocalDate to) {\n        validate(from, to);\n        for (Room room : rooms) {\n            if (room.number() == roomNumber) {\n                Optional<Booking> booking = room.tryBook(guest, from, to);\n                booking.ifPresent(b -> bookings.put(b.id(), b));\n                return booking;\n            }\n        }\n        return Optional.empty();\n    }\n\n    public Booking booking(String id) {\n        Booking b = bookings.get(id);\n        if (b == null) throw new IllegalArgumentException(\"unknown booking \" + id);\n        return b;\n    }\n\n    private static void validate(LocalDate from, LocalDate to) {\n        if (!to.isAfter(from)) throw new IllegalArgumentException(\"check-out must be after check-in\");\n    }\n}"
    },
    {
      "file": "PricingPolicy.java",
      "body": "import java.time.LocalDate;\n\npublic interface PricingPolicy {\n    /** Price for one night, the night that starts on {@code night}. */\n    long nightlyRate(RoomType type, LocalDate night);\n}"
    },
    {
      "file": "BasePricing.java",
      "body": "import java.time.LocalDate;\n\npublic class BasePricing implements PricingPolicy {\n    @Override\n    public long nightlyRate(RoomType type, LocalDate night) {\n        return type.basePrice();\n    }\n}"
    },
    {
      "file": "SeasonalPricing.java",
      "body": "import java.time.LocalDate;\n\n/** Wraps another policy and applies a multiplier on peak-season nights and weekends. */\npublic class SeasonalPricing implements PricingPolicy {\n    private final PricingPolicy inner;\n    private final LocalDate peakFrom;\n    private final LocalDate peakTo;      // exclusive\n    private final double peakMultiplier;\n\n    public SeasonalPricing(PricingPolicy inner, LocalDate peakFrom, LocalDate peakTo, double peakMultiplier) {\n        this.inner = inner;\n        this.peakFrom = peakFrom;\n        this.peakTo = peakTo;\n        this.peakMultiplier = peakMultiplier;\n    }\n\n    @Override\n    public long nightlyRate(RoomType type, LocalDate night) {\n        long rate = inner.nightlyRate(type, night);\n        boolean peak = !night.isBefore(peakFrom) && night.isBefore(peakTo);\n        return peak ? Math.round(rate * peakMultiplier) : rate;\n    }\n}"
    },
    {
      "file": "Invoice.java",
      "body": "import java.util.List;\n\npublic record Invoice(String bookingId, String guestName, List<ChargeItem> lines) {\n    public long total() {\n        return lines.stream().mapToLong(ChargeItem::amount).sum();\n    }\n\n    public String render() {\n        StringBuilder sb = new StringBuilder(\"Invoice for \" + guestName + \" (\" + bookingId + \")\\n\");\n        for (ChargeItem line : lines) {\n            sb.append(String.format(\"  %-34s %6d%n\", line.description(), line.amount()));\n        }\n        sb.append(String.format(\"  %-34s %6d\", \"TOTAL\", total()));\n        return sb.toString();\n    }\n}"
    },
    {
      "file": "InvoiceService.java",
      "body": "import java.time.LocalDate;\nimport java.util.ArrayList;\nimport java.util.List;\n\npublic class InvoiceService {\n    private final PricingPolicy pricing;\n\n    public InvoiceService(PricingPolicy pricing) { this.pricing = pricing; }\n\n    public Invoice generate(Booking booking) {\n        List<ChargeItem> lines = new ArrayList<>();\n        for (LocalDate night = booking.checkInDate(); night.isBefore(booking.checkOutDate()); night = night.plusDays(1)) {\n            long rate = pricing.nightlyRate(booking.room().type(), night);\n            lines.add(new RoomCharge(\"Room \" + booking.room().number() + \" night of \" + night, rate));\n        }\n        lines.addAll(booking.extras());\n        return new Invoice(booking.id(), booking.guest().name(), lines);\n    }\n}"
    },
    {
      "file": "FrontDesk.java",
      "body": "import java.time.LocalDate;\n\npublic class FrontDesk {\n    private final Hotel hotel;\n    private final InvoiceService invoices;\n\n    public FrontDesk(Hotel hotel, InvoiceService invoices) {\n        this.hotel = hotel;\n        this.invoices = invoices;\n    }\n\n    public void checkIn(String bookingId, LocalDate today) {\n        Booking b = hotel.booking(bookingId);\n        if (today.isBefore(b.checkInDate()) || !today.isBefore(b.checkOutDate())) {\n            throw new IllegalStateException(\"today is outside the booked stay\");\n        }\n        b.moveTo(BookingStatus.CHECKED_IN);\n    }\n\n    public Invoice checkOut(String bookingId) {\n        Booking b = hotel.booking(bookingId);\n        b.moveTo(BookingStatus.CHECKED_OUT);\n        return invoices.generate(b);\n    }\n\n    /** Guests may cancel only before check-in. */\n    public void cancel(String bookingId) {\n        hotel.booking(bookingId).moveTo(BookingStatus.CANCELLED);\n    }\n\n    public void addCharge(String bookingId, ChargeItem charge) {\n        hotel.booking(bookingId).addCharge(charge);\n    }\n}"
    }
  ],
  "driver": {
    "text": "The driver searches, books (including an overlapping attempt and a back-to-back stay), cancels, then runs a stay through check-in, extras and check-out with seasonal pricing on the invoice.",
    "file": "Main.java",
    "body": "import java.time.LocalDate;\nimport java.util.List;\nimport java.util.Optional;\n\npublic class Main {\n    public static void main(String[] args) {\n        Hotel hotel = new Hotel(\"Grand Plaza\");\n        hotel.addRoom(new Room(101, RoomType.STANDARD));\n        hotel.addRoom(new Room(102, RoomType.STANDARD));\n        hotel.addRoom(new Room(201, RoomType.DELUXE));\n        hotel.addRoom(new Room(301, RoomType.SUITE));\n\n        PricingPolicy pricing = new SeasonalPricing(new BasePricing(),\n                LocalDate.of(2026, 12, 24), LocalDate.of(2027, 1, 2), 1.5);\n        FrontDesk desk = new FrontDesk(hotel, new InvoiceService(pricing));\n\n        Guest asha = new Guest(\"g1\", \"Asha\");\n        Guest ravi = new Guest(\"g2\", \"Ravi\");\n        Guest mei = new Guest(\"g3\", \"Mei\");\n\n        LocalDate dec23 = LocalDate.of(2026, 12, 23);\n        LocalDate dec26 = LocalDate.of(2026, 12, 26);\n        LocalDate dec28 = LocalDate.of(2026, 12, 28);\n\n        System.out.println(\"-- 1. Search available rooms, Dec 23 to 26, 3 guests\");\n        for (Room r : hotel.search(dec23, dec26, null, 3)) {\n            System.out.println(\"  room \" + r.number() + \" \" + r.type());\n        }\n\n        System.out.println(\"-- 2. Book rooms (no overlap on the same room)\");\n        Booking b1 = hotel.bookRoom(asha, 101, dec23, dec26).orElseThrow();\n        System.out.println(\"  Asha booked room 101, \" + b1.nights() + \" nights, \" + b1.id());\n        Optional<Booking> clash = hotel.bookRoom(ravi, 101, LocalDate.of(2026, 12, 25), dec28);\n        System.out.println(\"  Ravi wants room 101 from Dec 25: \" + (clash.isPresent() ? \"booked\" : \"not available\"));\n        Optional<Booking> backToBack = hotel.bookRoom(ravi, 101, dec26, dec28);\n        System.out.println(\"  Ravi wants room 101 from Dec 26 (Asha leaves that day): \" + (backToBack.isPresent() ? \"booked\" : \"not available\"));\n        Booking b3 = hotel.book(mei, RoomType.STANDARD, 2, dec23, dec26).orElseThrow();\n        System.out.println(\"  Mei asked for any STANDARD room: got room \" + b3.room().number());\n        System.out.println(\"  Another STANDARD room for the same dates: \"\n                + hotel.book(new Guest(\"g4\", \"Li\"), RoomType.STANDARD, 2, dec23, dec26).map(b -> \"room \" + b.room().number()).orElse(\"none free\"));\n\n        System.out.println(\"-- 3. Cancellation and the lifecycle\");\n        desk.cancel(b3.id());\n        System.out.println(\"  Mei cancelled, room 102 free again: \" + hotel.search(dec23, dec26, RoomType.STANDARD, 2).size() + \" standard room(s) available\");\n        try {\n            desk.cancel(b3.id());\n        } catch (IllegalStateException e) {\n            System.out.println(\"  cancelling twice: \" + e.getMessage());\n        }\n\n        System.out.println(\"-- 4. Front desk: check in, add charges, check out\");\n        desk.checkIn(b1.id(), dec23);\n        desk.addCharge(b1.id(), new RoomServiceCharge(\"Dinner\", 45));\n        desk.addCharge(b1.id(), new SpaCharge(\"Massage\", 80));\n        try {\n            desk.cancel(b1.id());\n        } catch (IllegalStateException e) {\n            System.out.println(\"  cancel after check-in: \" + e.getMessage());\n        }\n        Invoice invoice = desk.checkOut(b1.id());\n        System.out.println(invoice.render());\n    }\n}",
    "output": "-- 1. Search available rooms, Dec 23 to 26, 3 guests\n  room 201 DELUXE\n  room 301 SUITE\n-- 2. Book rooms (no overlap on the same room)\n  Asha booked room 101, 3 nights, B1\n  Ravi wants room 101 from Dec 25: not available\n  Ravi wants room 101 from Dec 26 (Asha leaves that day): booked\n  Mei asked for any STANDARD room: got room 102\n  Another STANDARD room for the same dates: none free\n-- 3. Cancellation and the lifecycle\n  Mei cancelled, room 102 free again: 1 standard room(s) available\n  cancelling twice: cannot go from CANCELLED to CANCELLED\n-- 4. Front desk: check in, add charges, check out\n  cancel after check-in: cannot go from CHECKED_IN to CANCELLED\nInvoice for Asha (B1)\n  Room 101 night of 2026-12-23          100\n  Room 101 night of 2026-12-24          150\n  Room 101 night of 2026-12-25          150\n  Room service: Dinner                   45\n  Spa: Massage                           80\n  TOTAL                                 525"
  },
  "tests": {
    "file": "Tests.java",
    "cases": [
      "search returns every free room",
      "search filters by type",
      "search filters by capacity",
      "booked room is not returned",
      "reversed date range is rejected",
      "first booking succeeds",
      "identical dates conflict",
      "partial overlap conflicts",
      "back-to-back stay is allowed",
      "same dates on another room are fine",
      "cannot check out before checking in",
      "no charges before check-in",
      "cannot check in outside the stay",
      "cannot cancel after check-in",
      "check-out completes the booking",
      "cannot check in twice",
      "cancelled booking frees the room",
      "invoice = seasonal room nights + extras",
      "invoice has one line per night and per extra",
      "40 concurrent bookings of one room: exactly one wins",
      "30 guests, 5 rooms: five bookings, each on a different room"
    ],
    "body": "import java.time.LocalDate;\nimport java.util.ArrayList;\nimport java.util.List;\nimport java.util.concurrent.CountDownLatch;\nimport java.util.concurrent.ExecutorService;\nimport java.util.concurrent.Executors;\nimport java.util.concurrent.TimeUnit;\nimport java.util.concurrent.atomic.AtomicInteger;\n\npublic class Tests {\n    static final LocalDate D1 = LocalDate.of(2026, 3, 1);\n    static final LocalDate D3 = LocalDate.of(2026, 3, 3);\n    static final LocalDate D5 = LocalDate.of(2026, 3, 5);\n    static final Guest G = new Guest(\"g\", \"G\");\n\n    static void check(boolean cond, String name) {\n        if (!cond) throw new AssertionError(\"FAIL: \" + name);\n        System.out.println(\"PASS: \" + name);\n    }\n\n    static Hotel hotel() {\n        Hotel h = new Hotel(\"T\");\n        h.addRoom(new Room(1, RoomType.STANDARD));\n        h.addRoom(new Room(2, RoomType.DELUXE));\n        return h;\n    }\n\n    static boolean throwsIllegalState(Runnable r) {\n        try { r.run(); return false; } catch (IllegalStateException e) { return true; }\n    }\n\n    public static void main(String[] args) throws Exception {\n        { // search\n            Hotel h = hotel();\n            check(h.search(D1, D3, null, 2).size() == 2, \"search returns every free room\");\n            check(h.search(D1, D3, RoomType.DELUXE, 2).size() == 1, \"search filters by type\");\n            check(h.search(D1, D3, null, 3).size() == 1, \"search filters by capacity\");\n            h.bookRoom(G, 1, D1, D3);\n            check(h.search(D1, D3, RoomType.STANDARD, 1).isEmpty(), \"booked room is not returned\");\n            boolean bad = false;\n            try { h.search(D3, D1, null, 1); } catch (IllegalArgumentException e) { bad = true; }\n            check(bad, \"reversed date range is rejected\");\n        }\n        { // overlap rules\n            Hotel h = hotel();\n            check(h.bookRoom(G, 1, D1, D3).isPresent(), \"first booking succeeds\");\n            check(h.bookRoom(G, 1, D1, D3).isEmpty(), \"identical dates conflict\");\n            check(h.bookRoom(G, 1, LocalDate.of(2026, 3, 2), D5).isEmpty(), \"partial overlap conflicts\");\n            check(h.bookRoom(G, 1, D3, D5).isPresent(), \"back-to-back stay is allowed\");\n            check(h.bookRoom(G, 2, D1, D3).isPresent(), \"same dates on another room are fine\");\n        }\n        { // lifecycle\n            Hotel h = hotel();\n            FrontDesk desk = new FrontDesk(h, new InvoiceService(new BasePricing()));\n            Booking b = h.bookRoom(G, 1, D1, D3).get();\n            check(throwsIllegalState(() -> desk.checkOut(b.id())), \"cannot check out before checking in\");\n            check(throwsIllegalState(() -> desk.addCharge(b.id(), new SpaCharge(\"x\", 1))), \"no charges before check-in\");\n            check(throwsIllegalState(() -> desk.checkIn(b.id(), D5)), \"cannot check in outside the stay\");\n            desk.checkIn(b.id(), D1);\n            check(throwsIllegalState(() -> desk.cancel(b.id())), \"cannot cancel after check-in\");\n            desk.checkOut(b.id());\n            check(b.status() == BookingStatus.CHECKED_OUT, \"check-out completes the booking\");\n            check(throwsIllegalState(() -> desk.checkIn(b.id(), D1)), \"cannot check in twice\");\n        }\n        { // cancel frees the room\n            Hotel h = hotel();\n            FrontDesk desk = new FrontDesk(h, new InvoiceService(new BasePricing()));\n            Booking b = h.bookRoom(G, 1, D1, D3).get();\n            desk.cancel(b.id());\n            check(h.bookRoom(G, 1, D1, D3).isPresent(), \"cancelled booking frees the room\");\n        }\n        { // billing\n            Hotel h = hotel();\n            PricingPolicy seasonal = new SeasonalPricing(new BasePricing(), D3, D5, 2.0);\n            FrontDesk desk = new FrontDesk(h, new InvoiceService(seasonal));\n            Booking b = h.bookRoom(G, 1, D1, D5).get();   // nights: 1,2 normal (100); 3,4 peak (200)\n            desk.checkIn(b.id(), D1);\n            desk.addCharge(b.id(), new RoomServiceCharge(\"Tea\", 10));\n            desk.addCharge(b.id(), new SpaCharge(\"Facial\", 50));\n            Invoice inv = desk.checkOut(b.id());\n            check(inv.total() == 100 + 100 + 200 + 200 + 10 + 50, \"invoice = seasonal room nights + extras\");\n            check(inv.lines().size() == 6, \"invoice has one line per night and per extra\");\n        }\n        { // concurrency: one room, many guests\n            Hotel h = hotel();\n            AtomicInteger wins = new AtomicInteger();\n            ExecutorService pool = Executors.newFixedThreadPool(16);\n            CountDownLatch go = new CountDownLatch(1);\n            for (int i = 0; i < 40; i++) {\n                final int n = i;\n                pool.submit(() -> {\n                    try { go.await(); } catch (InterruptedException e) { return; }\n                    if (h.bookRoom(new Guest(\"g\" + n, \"G\" + n), 1, D1, D5).isPresent()) wins.incrementAndGet();\n                });\n            }\n            go.countDown();\n            pool.shutdown();\n            pool.awaitTermination(10, TimeUnit.SECONDS);\n            check(wins.get() == 1, \"40 concurrent bookings of one room: exactly one wins\");\n        }\n        { // concurrency: pool of rooms\n            Hotel h = new Hotel(\"T\");\n            for (int i = 1; i <= 5; i++) h.addRoom(new Room(i, RoomType.STANDARD));\n            List<Booking> got = java.util.Collections.synchronizedList(new ArrayList<>());\n            ExecutorService pool = Executors.newFixedThreadPool(16);\n            CountDownLatch go = new CountDownLatch(1);\n            for (int i = 0; i < 30; i++) {\n                final int n = i;\n                pool.submit(() -> {\n                    try { go.await(); } catch (InterruptedException e) { return; }\n                    h.book(new Guest(\"g\" + n, \"G\" + n), RoomType.STANDARD, 2, D1, D5).ifPresent(got::add);\n                });\n            }\n            go.countDown();\n            pool.shutdown();\n            pool.awaitTermination(10, TimeUnit.SECONDS);\n            long distinctRooms = got.stream().map(b -> b.room().number()).distinct().count();\n            check(got.size() == 5 && distinctRooms == 5, \"30 guests, 5 rooms: five bookings, each on a different room\");\n        }\n        System.out.println(\"ALL TESTS PASSED\");\n    }\n}",
    "output": "PASS: search returns every free room\nPASS: search filters by type\nPASS: search filters by capacity\nPASS: booked room is not returned\nPASS: reversed date range is rejected\nPASS: first booking succeeds\nPASS: identical dates conflict\nPASS: partial overlap conflicts\nPASS: back-to-back stay is allowed\nPASS: same dates on another room are fine\nPASS: cannot check out before checking in\nPASS: no charges before check-in\nPASS: cannot check in outside the stay\nPASS: cannot cancel after check-in\nPASS: check-out completes the booking\nPASS: cannot check in twice\nPASS: cancelled booking frees the room\nPASS: invoice = seasonal room nights + extras\nPASS: invoice has one line per night and per extra\nPASS: 40 concurrent bookings of one room: exactly one wins\nPASS: 30 guests, 5 rooms: five bookings, each on a different room\nALL TESTS PASSED"
  },
  "complexity": [
    "search: O(R x B_r), rooms times the bookings on each room",
    "tryBook: O(B_r) under that room's lock only, so different rooms book in parallel",
    "invoice: O(nights + extras)",
    "Space: O(R + B)"
  ]
},
{
  "id": "digital-wallet",
  "intro": "Three guarantees drive the design: a balance never goes negative, a transfer moves money atomically, and a retried request is applied once. Each step below adds one of them; everything else (funding sources, limits) hangs off small interfaces.",
  "steps": [
    {
      "title": "Requirement 1: a wallet that can't go negative",
      "text": "`Money` is a non-negative amount in minor units, so a negative value cannot even be constructed. `Wallet.debit` refuses to go below zero and returns false. Callers can't overspend by forgetting a check, because the invariant lives in the wallet.",
      "code": [
        {
          "file": "Money.java",
          "body": "/** An amount in minor units (paise/cents). A Money can never be negative. */\npublic record Money(long minor) implements Comparable<Money> {\n    public static final Money ZERO = new Money(0);\n\n    public Money {\n        if (minor < 0) throw new IllegalArgumentException(\"money cannot be negative\");\n    }\n\n    public static Money of(long minor) { return new Money(minor); }\n\n    public Money plus(Money other) { return new Money(minor + other.minor); }\n\n    public Money minus(Money other) { return new Money(minor - other.minor); }\n\n    public boolean isPositive() { return minor > 0; }\n\n    @Override public int compareTo(Money other) { return Long.compare(minor, other.minor); }\n\n    @Override public String toString() { return String.valueOf(minor); }\n}"
        },
        {
          "file": "Wallet.java",
          "body": "// The two mutators below must be called with lock() held. The invariant lives here:\n// debit refuses to go below zero, so no caller can overspend by forgetting to check.\nboolean debit(Money amount) {\n    if (balance.compareTo(amount) < 0) return false;\n    balance = balance.minus(amount);\n    return true;\n}"
        },
        {
          "file": "Wallet.java",
          "body": "void credit(Money amount) {\n    balance = balance.plus(amount);\n}"
        }
      ]
    },
    {
      "title": "Requirement 2: immutable transaction history",
      "text": "Every attempt, successful or failed, is recorded as an immutable `Transaction`. The log is append-only and hands out read-only copies, so history cannot be edited after the fact. The log also answers 'how much did this wallet send today?', which the daily limit needs.",
      "code": [
        {
          "file": "Transaction.java",
          "body": "import java.time.Instant;\n\n/** One immutable fact about money moving (or failing to move). Never updated, only appended. */\npublic record Transaction(String id, TxType type, String fromWalletId, String toWalletId,\n                          Money amount, TxStatus status, String reason,\n                          String idempotencyKey, Instant createdAt) {}"
        },
        {
          "file": "TransactionLog.java",
          "body": "public synchronized void append(Transaction tx) { entries.add(tx); }"
        },
        {
          "file": "TransactionLog.java",
          "body": "/** Total completed money sent out of a wallet on a given UTC day. */\npublic synchronized long sentOn(String walletId, LocalDate day) {\n    long total = 0;\n    for (Transaction t : entries) {\n        boolean sameDay = LocalDate.ofInstant(t.createdAt(), ZoneOffset.UTC).equals(day);\n        if (t.status() == TxStatus.COMPLETED && t.type() == TxType.TRANSFER\n                && walletId.equals(t.fromWalletId()) && sameDay) {\n            total += t.amount().minor();\n        }\n    }\n    return total;\n}"
        }
      ]
    },
    {
      "title": "Requirement 3: atomic transfers without deadlock",
      "text": "A transfer locks both wallets, then debits one and credits the other. If A->B and B->A each locked their own wallet first, they would wait on each other forever. So both always lock the wallet with the smaller id first, which makes opposite transfers queue instead of deadlock.",
      "code": [
        {
          "file": "WalletService.java",
          "body": "private Transaction doTransfer(String fromId, String toId, Money amount, String key) {\n    Wallet from = wallet(fromId);\n    Wallet to = wallet(toId);\n\n    // Always lock the wallet with the smaller id first. A->B and B->A then queue up\n    // behind each other instead of each holding one lock and waiting for the other.\n    Wallet first = fromId.compareTo(toId) < 0 ? from : to;\n    Wallet second = first == from ? to : from;\n    first.lock().lock();\n    second.lock().lock();\n    try {\n        Instant now = clock.instant();\n        for (TransferRule rule : rules) {\n            Optional<String> veto = rule.check(from, to, amount, now, log);\n            if (veto.isPresent()) return record(TxType.TRANSFER, fromId, toId, amount, TxStatus.FAILED, veto.get(), key);\n        }\n        if (!from.debit(amount)) {\n            return record(TxType.TRANSFER, fromId, toId, amount, TxStatus.FAILED, \"insufficient funds\", key);\n        }\n        to.credit(amount);\n        return record(TxType.TRANSFER, fromId, toId, amount, TxStatus.COMPLETED, \"ok\", key);\n    } finally {\n        second.lock().unlock();\n        first.lock().unlock();\n    }\n}"
        }
      ]
    },
    {
      "title": "Requirement 4: idempotent requests",
      "text": "Clients retry when a response is lost. Each request carries an idempotency key; `computeIfAbsent` runs the action once per key and hands every later caller the same `Transaction`, even if they arrive at the same instant. Reusing a key for a different request is rejected rather than silently ignored.",
      "code": [
        {
          "file": "WalletService.java",
          "body": "/**\n * Runs {@code action} at most once per key. computeIfAbsent blocks other callers with the same\n * key until the first finishes, then hands them the same Transaction. The action must not touch\n * this map.\n */\nprivate Transaction idempotent(String key, java.util.function.Supplier<Transaction> action) {\n    if (key == null || key.isBlank()) throw new IllegalArgumentException(\"an idempotency key is required\");\n    return byIdempotencyKey.computeIfAbsent(key, k -> action.get());\n}"
        },
        {
          "file": "WalletService.java",
          "body": "private static void assertSameRequest(Transaction tx, TxType type, String from, String to, Money amount) {\n    boolean same = tx.type() == type && java.util.Objects.equals(tx.fromWalletId(), from)\n            && java.util.Objects.equals(tx.toWalletId(), to) && tx.amount().equals(amount);\n    if (!same) throw new IllegalArgumentException(\"idempotency key already used for a different request\");\n}"
        }
      ]
    },
    {
      "title": "Requirement 5: top-ups and withdrawals via funding sources",
      "text": "`FundingSource` abstracts cards, bank accounts and UPI. A top-up pulls from the source before crediting; a withdrawal debits first and refunds the wallet if the destination declines, so the wallet never loses money.",
      "code": [
        {
          "file": "FundingSource.java",
          "body": "/** Anywhere money comes from or goes to outside the wallet: card, bank, UPI. */\npublic interface FundingSource {\n    String name();\n\n    /** Take money from the source. Returns false if the source declines. */\n    boolean pull(Money amount);\n\n    /** Send money to the source. Returns false if the source declines. */\n    boolean push(Money amount);\n}"
        },
        {
          "file": "BankSource.java",
          "body": "/** A second funding source, added without touching Wallet or WalletService. */\npublic class BankSource implements FundingSource {\n    private final String account;\n\n    public BankSource(String account) { this.account = account; }\n\n    @Override public String name() { return \"bank \" + account; }\n    @Override public boolean pull(Money amount) { return true; }\n    @Override public boolean push(Money amount) { return true; }\n}"
        },
        {
          "file": "WalletService.java",
          "body": "public Transaction topUp(String walletId, FundingSource source, Money amount, String key) {\n    requirePositive(amount);\n    Transaction tx = idempotent(key, () -> {\n        Wallet wallet = wallet(walletId);\n        // Money must arrive from the source before it is credited.\n        if (!source.pull(amount)) {\n            return record(TxType.TOP_UP, null, walletId, amount, TxStatus.FAILED, source.name() + \" declined\", key);\n        }\n        wallet.lock().lock();\n        try {\n            wallet.credit(amount);\n            return record(TxType.TOP_UP, null, walletId, amount, TxStatus.COMPLETED, \"from \" + source.name(), key);\n        } finally {\n            wallet.lock().unlock();\n        }\n    });\n    assertSameRequest(tx, TxType.TOP_UP, null, walletId, amount);\n    return tx;\n}"
        },
        {
          "file": "WalletService.java",
          "body": "public Transaction withdraw(String walletId, FundingSource destination, Money amount, String key) {\n    requirePositive(amount);\n    Transaction tx = idempotent(key, () -> {\n        Wallet wallet = wallet(walletId);\n        wallet.lock().lock();\n        try {\n            if (!wallet.debit(amount)) {\n                return record(TxType.WITHDRAWAL, walletId, null, amount, TxStatus.FAILED, \"insufficient funds\", key);\n            }\n            if (!destination.push(amount)) {\n                wallet.credit(amount);   // put the money back: the wallet never loses it\n                return record(TxType.WITHDRAWAL, walletId, null, amount, TxStatus.FAILED, destination.name() + \" declined\", key);\n            }\n            return record(TxType.WITHDRAWAL, walletId, null, amount, TxStatus.COMPLETED, \"to \" + destination.name(), key);\n        } finally {\n            wallet.lock().unlock();\n        }\n    });\n    assertSameRequest(tx, TxType.WITHDRAWAL, walletId, null, amount);\n    return tx;\n}"
        }
      ]
    },
    {
      "title": "Extensibility: pluggable transfer rules",
      "text": "Limits and fraud checks are `TransferRule`s that run inside the transfer, while the sender is locked, so two simultaneous transfers cannot both slip under a daily limit. Adding a rule needs no change to `WalletService`.",
      "code": [
        {
          "file": "TransferRule.java",
          "body": "import java.time.Instant;\nimport java.util.Optional;\n\n/** A check that can veto a transfer. Runs while the sender's wallet is locked. */\npublic interface TransferRule {\n    Optional<String> check(Wallet from, Wallet to, Money amount, Instant now, TransactionLog log);\n}"
        },
        {
          "file": "DailyLimitRule.java",
          "body": "import java.time.Instant;\nimport java.time.LocalDate;\nimport java.time.ZoneOffset;\nimport java.util.Optional;\n\npublic class DailyLimitRule implements TransferRule {\n    private final Money limit;\n\n    public DailyLimitRule(Money limit) { this.limit = limit; }\n\n    @Override\n    public Optional<String> check(Wallet from, Wallet to, Money amount, Instant now, TransactionLog log) {\n        LocalDate today = LocalDate.ofInstant(now, ZoneOffset.UTC);\n        long sentToday = log.sentOn(from.id(), today);\n        return sentToday + amount.minor() > limit.minor()\n                ? Optional.of(\"daily limit of \" + limit + \" exceeded (already sent \" + sentToday + \")\")\n                : Optional.empty();\n    }\n}"
        },
        {
          "file": "MaxTransferRule.java",
          "body": "import java.time.Instant;\nimport java.util.Optional;\n\n/** A stand-in for a fraud check: block any single transfer above a threshold. */\npublic class MaxTransferRule implements TransferRule {\n    private final Money max;\n\n    public MaxTransferRule(Money max) { this.max = max; }\n\n    @Override\n    public Optional<String> check(Wallet from, Wallet to, Money amount, Instant now, TransactionLog log) {\n        return amount.compareTo(max) > 0\n                ? Optional.of(\"single transfer above \" + max + \" needs review\")\n                : Optional.empty();\n    }\n}"
        }
      ]
    }
  ],
  "files": [
    {
      "file": "Money.java",
      "body": "/** An amount in minor units (paise/cents). A Money can never be negative. */\npublic record Money(long minor) implements Comparable<Money> {\n    public static final Money ZERO = new Money(0);\n\n    public Money {\n        if (minor < 0) throw new IllegalArgumentException(\"money cannot be negative\");\n    }\n\n    public static Money of(long minor) { return new Money(minor); }\n\n    public Money plus(Money other) { return new Money(minor + other.minor); }\n\n    public Money minus(Money other) { return new Money(minor - other.minor); }\n\n    public boolean isPositive() { return minor > 0; }\n\n    @Override public int compareTo(Money other) { return Long.compare(minor, other.minor); }\n\n    @Override public String toString() { return String.valueOf(minor); }\n}"
    },
    {
      "file": "Wallet.java",
      "body": "import java.util.concurrent.locks.ReentrantLock;\n\npublic class Wallet {\n    private final String id;\n    private final String owner;\n    private Money balance = Money.ZERO;\n    private final ReentrantLock lock = new ReentrantLock();\n\n    public Wallet(String id, String owner) {\n        this.id = id;\n        this.owner = owner;\n    }\n\n    public String id() { return id; }\n    public String owner() { return owner; }\n    ReentrantLock lock() { return lock; }\n\n    public Money balance() {\n        lock.lock();\n        try {\n            return balance;\n        } finally {\n            lock.unlock();\n        }\n    }\n\n    // The two mutators below must be called with lock() held. The invariant lives here:\n    // debit refuses to go below zero, so no caller can overspend by forgetting to check.\n    boolean debit(Money amount) {\n        if (balance.compareTo(amount) < 0) return false;\n        balance = balance.minus(amount);\n        return true;\n    }\n\n    void credit(Money amount) {\n        balance = balance.plus(amount);\n    }\n}"
    },
    {
      "file": "TxType.java",
      "body": "public enum TxType { TOP_UP, WITHDRAWAL, TRANSFER }"
    },
    {
      "file": "TxStatus.java",
      "body": "public enum TxStatus { COMPLETED, FAILED }"
    },
    {
      "file": "Transaction.java",
      "body": "import java.time.Instant;\n\n/** One immutable fact about money moving (or failing to move). Never updated, only appended. */\npublic record Transaction(String id, TxType type, String fromWalletId, String toWalletId,\n                          Money amount, TxStatus status, String reason,\n                          String idempotencyKey, Instant createdAt) {}"
    },
    {
      "file": "TransactionLog.java",
      "body": "import java.time.Instant;\nimport java.time.LocalDate;\nimport java.time.ZoneOffset;\nimport java.util.ArrayList;\nimport java.util.Collections;\nimport java.util.List;\n\npublic class TransactionLog {\n    private final List<Transaction> entries = new ArrayList<>();\n\n    public synchronized void append(Transaction tx) { entries.add(tx); }\n\n    public synchronized List<Transaction> all() {\n        return Collections.unmodifiableList(new ArrayList<>(entries));\n    }\n\n    public synchronized List<Transaction> forWallet(String walletId) {\n        List<Transaction> result = new ArrayList<>();\n        for (Transaction t : entries) {\n            if (walletId.equals(t.fromWalletId()) || walletId.equals(t.toWalletId())) result.add(t);\n        }\n        return Collections.unmodifiableList(result);\n    }\n\n    /** Total completed money sent out of a wallet on a given UTC day. */\n    public synchronized long sentOn(String walletId, LocalDate day) {\n        long total = 0;\n        for (Transaction t : entries) {\n            boolean sameDay = LocalDate.ofInstant(t.createdAt(), ZoneOffset.UTC).equals(day);\n            if (t.status() == TxStatus.COMPLETED && t.type() == TxType.TRANSFER\n                    && walletId.equals(t.fromWalletId()) && sameDay) {\n                total += t.amount().minor();\n            }\n        }\n        return total;\n    }\n}"
    },
    {
      "file": "FundingSource.java",
      "body": "/** Anywhere money comes from or goes to outside the wallet: card, bank, UPI. */\npublic interface FundingSource {\n    String name();\n\n    /** Take money from the source. Returns false if the source declines. */\n    boolean pull(Money amount);\n\n    /** Send money to the source. Returns false if the source declines. */\n    boolean push(Money amount);\n}"
    },
    {
      "file": "CardSource.java",
      "body": "public class CardSource implements FundingSource {\n    private final String last4;\n    private final boolean approves;\n\n    public CardSource(String last4, boolean approves) {\n        this.last4 = last4;\n        this.approves = approves;\n    }\n\n    @Override public String name() { return \"card ****\" + last4; }\n    @Override public boolean pull(Money amount) { return approves; }\n    @Override public boolean push(Money amount) { return approves; }\n}"
    },
    {
      "file": "BankSource.java",
      "body": "/** A second funding source, added without touching Wallet or WalletService. */\npublic class BankSource implements FundingSource {\n    private final String account;\n\n    public BankSource(String account) { this.account = account; }\n\n    @Override public String name() { return \"bank \" + account; }\n    @Override public boolean pull(Money amount) { return true; }\n    @Override public boolean push(Money amount) { return true; }\n}"
    },
    {
      "file": "TransferRule.java",
      "body": "import java.time.Instant;\nimport java.util.Optional;\n\n/** A check that can veto a transfer. Runs while the sender's wallet is locked. */\npublic interface TransferRule {\n    Optional<String> check(Wallet from, Wallet to, Money amount, Instant now, TransactionLog log);\n}"
    },
    {
      "file": "DailyLimitRule.java",
      "body": "import java.time.Instant;\nimport java.time.LocalDate;\nimport java.time.ZoneOffset;\nimport java.util.Optional;\n\npublic class DailyLimitRule implements TransferRule {\n    private final Money limit;\n\n    public DailyLimitRule(Money limit) { this.limit = limit; }\n\n    @Override\n    public Optional<String> check(Wallet from, Wallet to, Money amount, Instant now, TransactionLog log) {\n        LocalDate today = LocalDate.ofInstant(now, ZoneOffset.UTC);\n        long sentToday = log.sentOn(from.id(), today);\n        return sentToday + amount.minor() > limit.minor()\n                ? Optional.of(\"daily limit of \" + limit + \" exceeded (already sent \" + sentToday + \")\")\n                : Optional.empty();\n    }\n}"
    },
    {
      "file": "MaxTransferRule.java",
      "body": "import java.time.Instant;\nimport java.util.Optional;\n\n/** A stand-in for a fraud check: block any single transfer above a threshold. */\npublic class MaxTransferRule implements TransferRule {\n    private final Money max;\n\n    public MaxTransferRule(Money max) { this.max = max; }\n\n    @Override\n    public Optional<String> check(Wallet from, Wallet to, Money amount, Instant now, TransactionLog log) {\n        return amount.compareTo(max) > 0\n                ? Optional.of(\"single transfer above \" + max + \" needs review\")\n                : Optional.empty();\n    }\n}"
    },
    {
      "file": "ManualClock.java",
      "body": "import java.time.Clock;\nimport java.time.Duration;\nimport java.time.Instant;\nimport java.time.ZoneId;\nimport java.time.ZoneOffset;\n\npublic class ManualClock extends Clock {\n    private volatile Instant now;\n\n    public ManualClock(Instant start) { this.now = start; }\n\n    public void advance(Duration d) { now = now.plus(d); }\n\n    @Override public ZoneId getZone() { return ZoneOffset.UTC; }\n    @Override public Clock withZone(ZoneId zone) { return this; }\n    @Override public Instant instant() { return now; }\n}"
    },
    {
      "file": "WalletService.java",
      "body": "import java.time.Clock;\nimport java.time.Instant;\nimport java.util.List;\nimport java.util.Map;\nimport java.util.Optional;\nimport java.util.concurrent.ConcurrentHashMap;\nimport java.util.concurrent.atomic.AtomicInteger;\n\npublic class WalletService {\n    private final Map<String, Wallet> wallets = new ConcurrentHashMap<>();\n    private final Map<String, Transaction> byIdempotencyKey = new ConcurrentHashMap<>();\n    private final TransactionLog log = new TransactionLog();\n    private final List<TransferRule> rules;\n    private final Clock clock;\n    private final AtomicInteger txIds = new AtomicInteger();\n    private final AtomicInteger walletIds = new AtomicInteger();\n\n    public WalletService(Clock clock, List<TransferRule> rules) {\n        this.clock = clock;\n        this.rules = List.copyOf(rules);\n    }\n\n    public Wallet createWallet(String owner) {\n        Wallet wallet = new Wallet(\"W\" + walletIds.incrementAndGet(), owner);\n        wallets.put(wallet.id(), wallet);\n        return wallet;\n    }\n\n    public TransactionLog log() { return log; }\n\n    public Money balance(String walletId) { return wallet(walletId).balance(); }\n\n    // ---- transfer: atomic, deadlock-free, idempotent ----\n\n    public Transaction transfer(String fromId, String toId, Money amount, String key) {\n        if (fromId.equals(toId)) throw new IllegalArgumentException(\"cannot transfer to the same wallet\");\n        requirePositive(amount);\n        Transaction tx = idempotent(key, () -> doTransfer(fromId, toId, amount, key));\n        assertSameRequest(tx, TxType.TRANSFER, fromId, toId, amount);\n        return tx;\n    }\n\n    private Transaction doTransfer(String fromId, String toId, Money amount, String key) {\n        Wallet from = wallet(fromId);\n        Wallet to = wallet(toId);\n\n        // Always lock the wallet with the smaller id first. A->B and B->A then queue up\n        // behind each other instead of each holding one lock and waiting for the other.\n        Wallet first = fromId.compareTo(toId) < 0 ? from : to;\n        Wallet second = first == from ? to : from;\n        first.lock().lock();\n        second.lock().lock();\n        try {\n            Instant now = clock.instant();\n            for (TransferRule rule : rules) {\n                Optional<String> veto = rule.check(from, to, amount, now, log);\n                if (veto.isPresent()) return record(TxType.TRANSFER, fromId, toId, amount, TxStatus.FAILED, veto.get(), key);\n            }\n            if (!from.debit(amount)) {\n                return record(TxType.TRANSFER, fromId, toId, amount, TxStatus.FAILED, \"insufficient funds\", key);\n            }\n            to.credit(amount);\n            return record(TxType.TRANSFER, fromId, toId, amount, TxStatus.COMPLETED, \"ok\", key);\n        } finally {\n            second.lock().unlock();\n            first.lock().unlock();\n        }\n    }\n\n    // ---- top-up and withdrawal against an external FundingSource ----\n\n    public Transaction topUp(String walletId, FundingSource source, Money amount, String key) {\n        requirePositive(amount);\n        Transaction tx = idempotent(key, () -> {\n            Wallet wallet = wallet(walletId);\n            // Money must arrive from the source before it is credited.\n            if (!source.pull(amount)) {\n                return record(TxType.TOP_UP, null, walletId, amount, TxStatus.FAILED, source.name() + \" declined\", key);\n            }\n            wallet.lock().lock();\n            try {\n                wallet.credit(amount);\n                return record(TxType.TOP_UP, null, walletId, amount, TxStatus.COMPLETED, \"from \" + source.name(), key);\n            } finally {\n                wallet.lock().unlock();\n            }\n        });\n        assertSameRequest(tx, TxType.TOP_UP, null, walletId, amount);\n        return tx;\n    }\n\n    public Transaction withdraw(String walletId, FundingSource destination, Money amount, String key) {\n        requirePositive(amount);\n        Transaction tx = idempotent(key, () -> {\n            Wallet wallet = wallet(walletId);\n            wallet.lock().lock();\n            try {\n                if (!wallet.debit(amount)) {\n                    return record(TxType.WITHDRAWAL, walletId, null, amount, TxStatus.FAILED, \"insufficient funds\", key);\n                }\n                if (!destination.push(amount)) {\n                    wallet.credit(amount);   // put the money back: the wallet never loses it\n                    return record(TxType.WITHDRAWAL, walletId, null, amount, TxStatus.FAILED, destination.name() + \" declined\", key);\n                }\n                return record(TxType.WITHDRAWAL, walletId, null, amount, TxStatus.COMPLETED, \"to \" + destination.name(), key);\n            } finally {\n                wallet.lock().unlock();\n            }\n        });\n        assertSameRequest(tx, TxType.WITHDRAWAL, walletId, null, amount);\n        return tx;\n    }\n\n    // ---- helpers ----\n\n    /**\n     * Runs {@code action} at most once per key. computeIfAbsent blocks other callers with the same\n     * key until the first finishes, then hands them the same Transaction. The action must not touch\n     * this map.\n     */\n    private Transaction idempotent(String key, java.util.function.Supplier<Transaction> action) {\n        if (key == null || key.isBlank()) throw new IllegalArgumentException(\"an idempotency key is required\");\n        return byIdempotencyKey.computeIfAbsent(key, k -> action.get());\n    }\n\n    private static void assertSameRequest(Transaction tx, TxType type, String from, String to, Money amount) {\n        boolean same = tx.type() == type && java.util.Objects.equals(tx.fromWalletId(), from)\n                && java.util.Objects.equals(tx.toWalletId(), to) && tx.amount().equals(amount);\n        if (!same) throw new IllegalArgumentException(\"idempotency key already used for a different request\");\n    }\n\n    private Transaction record(TxType type, String from, String to, Money amount,\n                               TxStatus status, String reason, String key) {\n        Transaction tx = new Transaction(\"T\" + txIds.incrementAndGet(), type, from, to, amount,\n                status, reason, key, clock.instant());\n        log.append(tx);\n        return tx;\n    }\n\n    private Wallet wallet(String id) {\n        Wallet w = wallets.get(id);\n        if (w == null) throw new IllegalArgumentException(\"unknown wallet \" + id);\n        return w;\n    }\n\n    private static void requirePositive(Money amount) {\n        if (!amount.isPositive()) throw new IllegalArgumentException(\"amount must be positive\");\n    }\n}"
    }
  ],
  "driver": {
    "text": "The driver covers each guarantee in turn: top-ups from two sources (one declined), an overdraft attempt, a retried transfer, a reused key, both rules firing, a failed withdrawal that is refunded, and finally the full history.",
    "file": "Main.java",
    "body": "import java.time.Duration;\nimport java.time.Instant;\nimport java.util.List;\n\npublic class Main {\n    public static void main(String[] args) {\n        ManualClock clock = new ManualClock(Instant.parse(\"2026-03-01T09:00:00Z\"));\n        WalletService service = new WalletService(clock,\n                List.of(new MaxTransferRule(Money.of(5_000)), new DailyLimitRule(Money.of(1_000))));\n\n        Wallet alice = service.createWallet(\"Alice\");\n        Wallet bob = service.createWallet(\"Bob\");\n\n        System.out.println(\"-- 1. Top up from different funding sources\");\n        print(service.topUp(alice.id(), new CardSource(\"4242\", true), Money.of(2_000), \"k1\"));\n        print(service.topUp(bob.id(), new BankSource(\"HDFC-77\"), Money.of(300), \"k2\"));\n        print(service.topUp(bob.id(), new CardSource(\"0000\", false), Money.of(500), \"k3\"));\n        balances(service, alice, bob);\n\n        System.out.println(\"-- 2. Transfer, and never below zero\");\n        print(service.transfer(alice.id(), bob.id(), Money.of(400), \"k4\"));\n        print(service.transfer(bob.id(), alice.id(), Money.of(900), \"k5\"));\n        balances(service, alice, bob);\n\n        System.out.println(\"-- 3. A retried request is applied once\");\n        Transaction first = service.transfer(alice.id(), bob.id(), Money.of(250), \"k6\");\n        Transaction retry = service.transfer(alice.id(), bob.id(), Money.of(250), \"k6\");\n        System.out.println(\"  same transaction returned: \" + (first == retry) + \" (\" + first.id() + \")\");\n        balances(service, alice, bob);\n        try {\n            service.transfer(alice.id(), bob.id(), Money.of(999), \"k6\");\n        } catch (IllegalArgumentException e) {\n            System.out.println(\"  reusing k6 for another amount: \" + e.getMessage());\n        }\n\n        System.out.println(\"-- 4. Pluggable rules: daily limit (1000) and per-transfer check (5000)\");\n        print(service.transfer(alice.id(), bob.id(), Money.of(400), \"k7\"));\n        print(service.transfer(alice.id(), bob.id(), Money.of(100), \"k8\"));\n        print(service.transfer(alice.id(), bob.id(), Money.of(6_000), \"k9\"));\n        clock.advance(Duration.ofDays(1));\n        print(service.transfer(alice.id(), bob.id(), Money.of(100), \"k10\"));\n\n        System.out.println(\"-- 5. Withdraw to a bank, and a declined withdrawal gives the money back\");\n        print(service.withdraw(bob.id(), new BankSource(\"HDFC-77\"), Money.of(200), \"k11\"));\n        print(service.withdraw(bob.id(), new CardSource(\"0000\", false), Money.of(100), \"k12\"));\n        balances(service, alice, bob);\n\n        System.out.println(\"-- 6. Immutable history for Bob\");\n        for (Transaction t : service.log().forWallet(bob.id())) print(t);\n    }\n\n    private static void print(Transaction t) {\n        System.out.println(\"  \" + t.id() + \" \" + t.type() + \" \" + t.amount() + \" \" + t.status() + \" (\" + t.reason() + \")\");\n    }\n\n    private static void balances(WalletService s, Wallet a, Wallet b) {\n        System.out.println(\"  balances: Alice=\" + s.balance(a.id()) + \" Bob=\" + s.balance(b.id()));\n    }\n}",
    "output": "-- 1. Top up from different funding sources\n  T1 TOP_UP 2000 COMPLETED (from card ****4242)\n  T2 TOP_UP 300 COMPLETED (from bank HDFC-77)\n  T3 TOP_UP 500 FAILED (card ****0000 declined)\n  balances: Alice=2000 Bob=300\n-- 2. Transfer, and never below zero\n  T4 TRANSFER 400 COMPLETED (ok)\n  T5 TRANSFER 900 FAILED (insufficient funds)\n  balances: Alice=1600 Bob=700\n-- 3. A retried request is applied once\n  same transaction returned: true (T6)\n  balances: Alice=1350 Bob=950\n  reusing k6 for another amount: idempotency key already used for a different request\n-- 4. Pluggable rules: daily limit (1000) and per-transfer check (5000)\n  T7 TRANSFER 400 FAILED (daily limit of 1000 exceeded (already sent 650))\n  T8 TRANSFER 100 COMPLETED (ok)\n  T9 TRANSFER 6000 FAILED (single transfer above 5000 needs review)\n  T10 TRANSFER 100 COMPLETED (ok)\n-- 5. Withdraw to a bank, and a declined withdrawal gives the money back\n  T11 WITHDRAWAL 200 COMPLETED (to bank HDFC-77)\n  T12 WITHDRAWAL 100 FAILED (card ****0000 declined)\n  balances: Alice=1150 Bob=950\n-- 6. Immutable history for Bob\n  T2 TOP_UP 300 COMPLETED (from bank HDFC-77)\n  T3 TOP_UP 500 FAILED (card ****0000 declined)\n  T4 TRANSFER 400 COMPLETED (ok)\n  T5 TRANSFER 900 FAILED (insufficient funds)\n  T6 TRANSFER 250 COMPLETED (ok)\n  T7 TRANSFER 400 FAILED (daily limit of 1000 exceeded (already sent 650))\n  T8 TRANSFER 100 COMPLETED (ok)\n  T9 TRANSFER 6000 FAILED (single transfer above 5000 needs review)\n  T10 TRANSFER 100 COMPLETED (ok)\n  T11 WITHDRAWAL 200 COMPLETED (to bank HDFC-77)\n  T12 WITHDRAWAL 100 FAILED (card ****0000 declined)"
  },
  "tests": {
    "file": "Tests.java",
    "cases": [
      "Money cannot be negative",
      "zero amount is rejected",
      "approved top-up credits the wallet",
      "declined top-up leaves the balance alone",
      "transfer succeeds with enough funds",
      "transfer moves exactly the amount",
      "overspending is refused, balance untouched",
      "transfer to self is rejected",
      "unknown wallet is rejected",
      "missing idempotency key is rejected",
      "withdrawal debits the wallet",
      "declined withdrawal is refunded",
      "cannot withdraw more than the balance",
      "history records completed and failed attempts",
      "history cannot be edited from outside",
      "retry with the same key is applied once",
      "same key, different request is rejected",
      "under the daily limit passes",
      "going over the daily limit fails",
      "exactly reaching the limit passes",
      "limit resets the next day",
      "a second rule type plugs in",
      "concurrent debits finish",
      "80 transfers of 30 from 1000: exactly 33 succeed",
      "no money is created or destroyed",
      "400 opposite-direction transfers finish without deadlock",
      "total is conserved across opposite transfers",
      "40 simultaneous retries with one key move money once"
    ],
    "body": "import java.time.Duration;\nimport java.time.Instant;\nimport java.util.List;\nimport java.util.concurrent.CountDownLatch;\nimport java.util.concurrent.ExecutorService;\nimport java.util.concurrent.Executors;\nimport java.util.concurrent.TimeUnit;\nimport java.util.concurrent.atomic.AtomicInteger;\n\npublic class Tests {\n    static final Instant START = Instant.parse(\"2026-03-01T09:00:00Z\");\n\n    static void check(boolean cond, String name) {\n        if (!cond) throw new AssertionError(\"FAIL: \" + name);\n        System.out.println(\"PASS: \" + name);\n    }\n\n    static boolean throwsIllegalArg(Runnable r) {\n        try { r.run(); return false; } catch (IllegalArgumentException e) { return true; }\n    }\n\n    static WalletService service(TransferRule... rules) {\n        return new WalletService(new ManualClock(START), List.of(rules));\n    }\n\n    static Wallet funded(WalletService s, String owner, long minor, String key) {\n        Wallet w = s.createWallet(owner);\n        s.topUp(w.id(), new BankSource(\"b\"), Money.of(minor), key);\n        return w;\n    }\n\n    public static void main(String[] args) throws Exception {\n        { // money invariant\n            check(throwsIllegalArg(() -> Money.of(-1)), \"Money cannot be negative\");\n            WalletService s = service();\n            Wallet w = s.createWallet(\"A\");\n            check(throwsIllegalArg(() -> s.topUp(w.id(), new BankSource(\"b\"), Money.ZERO, \"z\")), \"zero amount is rejected\");\n        }\n        { // top up\n            WalletService s = service();\n            Wallet w = s.createWallet(\"A\");\n            Transaction ok = s.topUp(w.id(), new CardSource(\"1\", true), Money.of(500), \"t1\");\n            Transaction no = s.topUp(w.id(), new CardSource(\"2\", false), Money.of(700), \"t2\");\n            check(ok.status() == TxStatus.COMPLETED && s.balance(w.id()).minor() == 500, \"approved top-up credits the wallet\");\n            check(no.status() == TxStatus.FAILED && s.balance(w.id()).minor() == 500, \"declined top-up leaves the balance alone\");\n        }\n        { // transfer basics\n            WalletService s = service();\n            Wallet a = funded(s, \"A\", 1000, \"f1\");\n            Wallet b = s.createWallet(\"B\");\n            check(s.transfer(a.id(), b.id(), Money.of(300), \"x1\").status() == TxStatus.COMPLETED, \"transfer succeeds with enough funds\");\n            check(s.balance(a.id()).minor() == 700 && s.balance(b.id()).minor() == 300, \"transfer moves exactly the amount\");\n            Transaction tooMuch = s.transfer(a.id(), b.id(), Money.of(701), \"x2\");\n            check(tooMuch.status() == TxStatus.FAILED && s.balance(a.id()).minor() == 700, \"overspending is refused, balance untouched\");\n            check(throwsIllegalArg(() -> s.transfer(a.id(), a.id(), Money.of(1), \"x3\")), \"transfer to self is rejected\");\n            check(throwsIllegalArg(() -> s.transfer(a.id(), \"W999\", Money.of(1), \"x4\")), \"unknown wallet is rejected\");\n            check(throwsIllegalArg(() -> s.transfer(a.id(), b.id(), Money.of(1), \" \")), \"missing idempotency key is rejected\");\n        }\n        { // withdraw\n            WalletService s = service();\n            Wallet a = funded(s, \"A\", 500, \"f1\");\n            check(s.withdraw(a.id(), new BankSource(\"b\"), Money.of(200), \"w1\").status() == TxStatus.COMPLETED\n                    && s.balance(a.id()).minor() == 300, \"withdrawal debits the wallet\");\n            Transaction declined = s.withdraw(a.id(), new CardSource(\"1\", false), Money.of(100), \"w2\");\n            check(declined.status() == TxStatus.FAILED && s.balance(a.id()).minor() == 300, \"declined withdrawal is refunded\");\n            check(s.withdraw(a.id(), new BankSource(\"b\"), Money.of(301), \"w3\").status() == TxStatus.FAILED, \"cannot withdraw more than the balance\");\n        }\n        { // history\n            WalletService s = service();\n            Wallet a = funded(s, \"A\", 100, \"f1\");\n            Wallet b = s.createWallet(\"B\");\n            s.transfer(a.id(), b.id(), Money.of(10), \"h1\");\n            s.transfer(a.id(), b.id(), Money.of(1000), \"h2\");   // fails, still recorded\n            check(s.log().forWallet(a.id()).size() == 3, \"history records completed and failed attempts\");\n            boolean immutable = false;\n            try { s.log().all().clear(); } catch (UnsupportedOperationException e) { immutable = true; }\n            check(immutable, \"history cannot be edited from outside\");\n        }\n        { // idempotency\n            WalletService s = service();\n            Wallet a = funded(s, \"A\", 1000, \"f1\");\n            Wallet b = s.createWallet(\"B\");\n            Transaction t1 = s.transfer(a.id(), b.id(), Money.of(100), \"same\");\n            Transaction t2 = s.transfer(a.id(), b.id(), Money.of(100), \"same\");\n            check(t1 == t2 && s.balance(b.id()).minor() == 100, \"retry with the same key is applied once\");\n            check(throwsIllegalArg(() -> s.transfer(a.id(), b.id(), Money.of(5), \"same\")), \"same key, different request is rejected\");\n        }\n        { // rules\n            ManualClock clock = new ManualClock(START);\n            WalletService s = new WalletService(clock, List.of(new DailyLimitRule(Money.of(500))));\n            Wallet a = funded(s, \"A\", 5000, \"f1\");\n            Wallet b = s.createWallet(\"B\");\n            check(s.transfer(a.id(), b.id(), Money.of(300), \"r1\").status() == TxStatus.COMPLETED, \"under the daily limit passes\");\n            check(s.transfer(a.id(), b.id(), Money.of(300), \"r2\").status() == TxStatus.FAILED, \"going over the daily limit fails\");\n            check(s.transfer(a.id(), b.id(), Money.of(200), \"r3\").status() == TxStatus.COMPLETED, \"exactly reaching the limit passes\");\n            clock.advance(Duration.ofDays(1));\n            check(s.transfer(a.id(), b.id(), Money.of(300), \"r4\").status() == TxStatus.COMPLETED, \"limit resets the next day\");\n            WalletService fraud = service(new MaxTransferRule(Money.of(100)));\n            Wallet c = funded(fraud, \"C\", 1000, \"f2\");\n            Wallet d = fraud.createWallet(\"D\");\n            check(fraud.transfer(c.id(), d.id(), Money.of(101), \"m1\").status() == TxStatus.FAILED, \"a second rule type plugs in\");\n        }\n        { // concurrent debits never overspend\n            WalletService s = service();\n            Wallet a = funded(s, \"A\", 1000, \"f1\");\n            Wallet sink = s.createWallet(\"S\");\n            AtomicInteger ok = new AtomicInteger();\n            ExecutorService pool = Executors.newFixedThreadPool(16);\n            CountDownLatch go = new CountDownLatch(1);\n            for (int i = 0; i < 80; i++) {\n                final int n = i;\n                pool.submit(() -> {\n                    try { go.await(); } catch (InterruptedException e) { return; }\n                    if (s.transfer(a.id(), sink.id(), Money.of(30), \"c\" + n).status() == TxStatus.COMPLETED) ok.incrementAndGet();\n                });\n            }\n            go.countDown();\n            pool.shutdown();\n            check(pool.awaitTermination(10, TimeUnit.SECONDS), \"concurrent debits finish\");\n            check(ok.get() == 33 && s.balance(a.id()).minor() == 10, \"80 transfers of 30 from 1000: exactly 33 succeed\");\n            check(s.balance(a.id()).minor() + s.balance(sink.id()).minor() == 1000, \"no money is created or destroyed\");\n        }\n        { // opposite transfers do not deadlock\n            WalletService s = service();\n            Wallet a = funded(s, \"A\", 10_000, \"f1\");\n            Wallet b = funded(s, \"B\", 10_000, \"f2\");\n            ExecutorService pool = Executors.newFixedThreadPool(8);\n            CountDownLatch go = new CountDownLatch(1);\n            for (int i = 0; i < 400; i++) {\n                final int n = i;\n                pool.submit(() -> {\n                    try { go.await(); } catch (InterruptedException e) { return; }\n                    if (n % 2 == 0) s.transfer(a.id(), b.id(), Money.of(7), \"d\" + n);\n                    else s.transfer(b.id(), a.id(), Money.of(5), \"d\" + n);\n                });\n            }\n            go.countDown();\n            pool.shutdown();\n            check(pool.awaitTermination(10, TimeUnit.SECONDS), \"400 opposite-direction transfers finish without deadlock\");\n            check(s.balance(a.id()).minor() + s.balance(b.id()).minor() == 20_000, \"total is conserved across opposite transfers\");\n        }\n        { // concurrent retries\n            WalletService s = service();\n            Wallet a = funded(s, \"A\", 1000, \"f1\");\n            Wallet b = s.createWallet(\"B\");\n            ExecutorService pool = Executors.newFixedThreadPool(16);\n            CountDownLatch go = new CountDownLatch(1);\n            for (int i = 0; i < 40; i++) pool.submit(() -> {\n                try { go.await(); } catch (InterruptedException e) { return; }\n                s.transfer(a.id(), b.id(), Money.of(100), \"retry-me\");\n            });\n            go.countDown();\n            pool.shutdown();\n            pool.awaitTermination(10, TimeUnit.SECONDS);\n            check(s.balance(b.id()).minor() == 100, \"40 simultaneous retries with one key move money once\");\n        }\n        System.out.println(\"ALL TESTS PASSED\");\n    }\n}",
    "output": "PASS: Money cannot be negative\nPASS: zero amount is rejected\nPASS: approved top-up credits the wallet\nPASS: declined top-up leaves the balance alone\nPASS: transfer succeeds with enough funds\nPASS: transfer moves exactly the amount\nPASS: overspending is refused, balance untouched\nPASS: transfer to self is rejected\nPASS: unknown wallet is rejected\nPASS: missing idempotency key is rejected\nPASS: withdrawal debits the wallet\nPASS: declined withdrawal is refunded\nPASS: cannot withdraw more than the balance\nPASS: history records completed and failed attempts\nPASS: history cannot be edited from outside\nPASS: retry with the same key is applied once\nPASS: same key, different request is rejected\nPASS: under the daily limit passes\nPASS: going over the daily limit fails\nPASS: exactly reaching the limit passes\nPASS: limit resets the next day\nPASS: a second rule type plugs in\nPASS: concurrent debits finish\nPASS: 80 transfers of 30 from 1000: exactly 33 succeed\nPASS: no money is created or destroyed\nPASS: 400 opposite-direction transfers finish without deadlock\nPASS: total is conserved across opposite transfers\nPASS: 40 simultaneous retries with one key move money once\nALL TESTS PASSED"
  },
  "complexity": [
    "transfer: O(r + h) for r rules and the log scan the daily limit does (an index by wallet and day makes it O(r))",
    "balance, debit, credit: O(1)",
    "Lock order is fixed (smaller wallet id first), so no deadlock",
    "Space: O(w + t) for wallets and transactions"
  ]
},
{
  "id": "airline-management-system",
  "intro": "The key split is **schedule vs flight instance**, and **Seat vs FlightSeat**. A schedule is a recurring template; an instance is one dated departure with its own seat state. A `Seat` is a fact about the aircraft; a `FlightSeat` is what gets booked. Everything else follows from that.",
  "steps": [
    {
      "title": "Requirement 1: search flights by route and date",
      "text": "A `FlightSchedule` says 'AI-101, BLR to DEL, 06:00, these weekdays'. Search filters schedules by route and operating day, creates (or reuses) the dated instance, and drops cancelled or full flights.",
      "code": [
        {
          "file": "Airport.java",
          "body": "public record Airport(String code, String city) {}"
        },
        {
          "file": "FlightSchedule.java",
          "body": "import java.time.DayOfWeek;\nimport java.time.Duration;\nimport java.time.LocalDate;\nimport java.time.LocalTime;\nimport java.util.Set;\n\n/** A recurring route, e.g. AI-101 BLR to DEL at 06:00 on weekdays. Immutable template. */\npublic record FlightSchedule(String flightNumber, Airport origin, Airport destination,\n                             LocalTime departure, Duration duration, Aircraft aircraft,\n                             long baseFare, Set<DayOfWeek> operatingDays) {\n\n    public boolean operatesOn(LocalDate date) {\n        return operatingDays.contains(date.getDayOfWeek());\n    }\n}"
        },
        {
          "file": "FlightSearchService.java",
          "body": "/** The dated departure for a schedule, created on first use and shared by everyone after. */\npublic FlightInstance instance(FlightSchedule schedule, LocalDate date) {\n    if (!schedule.operatesOn(date)) throw new IllegalArgumentException(schedule.flightNumber() + \" does not fly on \" + date);\n    return instances.computeIfAbsent(schedule.flightNumber() + \"@\" + date, k -> new FlightInstance(schedule, date));\n}"
        },
        {
          "file": "FlightSearchService.java",
          "body": "/** Flights on a route and date that are not cancelled and still have a free seat, earliest first. */\npublic List<FlightInstance> search(String originCode, String destinationCode, LocalDate date) {\n    List<FlightInstance> result = new ArrayList<>();\n    for (FlightSchedule s : schedules) {\n        if (!s.origin().code().equals(originCode) || !s.destination().code().equals(destinationCode)) continue;\n        if (!s.operatesOn(date)) continue;\n        FlightInstance f = instance(s, date);\n        if (f.status() != FlightStatus.CANCELLED && f.availableSeats() > 0) result.add(f);\n    }\n    result.sort(Comparator.comparing(FlightInstance::departure));\n    return result;\n}"
        }
      ]
    },
    {
      "title": "Requirement 2: seats, classes and per-flight availability",
      "text": "`Aircraft` defines the physical layout once. Each `FlightInstance` builds its own `FlightSeat` map from it, so booking 4A on Monday does not touch 4A next Monday. Seat class is data on the seat, which is what lets pricing differ by class.",
      "code": [
        {
          "file": "Seat.java",
          "body": "/** A permanent physical seat on an aircraft. It is never \"booked\"; a FlightSeat is. */\npublic record Seat(int row, char letter, SeatClass seatClass) {\n    public String id() { return row + \"\" + letter; }\n}"
        },
        {
          "file": "Aircraft.java",
          "body": "/** First rows have 2 seats (A-B), business rows 3 (A-C), economy rows 4 (A-D). */\npublic static Aircraft layout(String model, int firstRows, int businessRows, int economyRows) {\n    List<Seat> seats = new ArrayList<>();\n    int row = 1;\n    for (int i = 0; i < firstRows; i++, row++) addRow(seats, row, \"AB\", SeatClass.FIRST);\n    for (int i = 0; i < businessRows; i++, row++) addRow(seats, row, \"ABC\", SeatClass.BUSINESS);\n    for (int i = 0; i < economyRows; i++, row++) addRow(seats, row, \"ABCD\", SeatClass.ECONOMY);\n    return new Aircraft(model, seats);\n}"
        },
        {
          "file": "FlightSeat.java",
          "body": "import java.util.concurrent.locks.ReentrantLock;\n\n/** The state of one Seat on one dated departure. This is the thing that gets booked. */\npublic class FlightSeat {\n    private final Seat seat;\n    private final ReentrantLock lock = new ReentrantLock();\n    private volatile boolean booked;\n\n    public FlightSeat(Seat seat) { this.seat = seat; }\n\n    public Seat seat() { return seat; }\n    public boolean isBooked() { return booked; }\n    ReentrantLock lock() { return lock; }\n\n    // Both mutators require lock() to be held by the caller.\n    void markBooked() { booked = true; }\n    void release() { booked = false; }\n}"
        },
        {
          "file": "FlightInstance.java",
          "body": "public FlightInstance(FlightSchedule schedule, LocalDate date) {\n    this.schedule = schedule;\n    this.date = date;\n    for (Seat s : schedule.aircraft().seats()) seats.put(s.id(), new FlightSeat(s));\n}"
        }
      ]
    },
    {
      "title": "Requirements 3 and 4: book and cancel, never double-book",
      "text": "A party books several seats at once and must get all of them or none. The service locks each `FlightSeat` in seat-id order, checks every seat is free, then marks them all booked. Because the order is fixed, two parties asking for the same seats in opposite order cannot deadlock. Cancelling marks the booking cancelled once and releases each seat.",
      "code": [
        {
          "file": "BookingService.java",
          "body": "/** One seat per passenger. Either every seat is booked, or none is. */\npublic Booking book(FlightInstance flight, List<Passenger> passengers, List<String> seatIds) {\n    if (flight.status() == FlightStatus.CANCELLED) throw new BookingException(\"flight is cancelled\");\n    if (passengers.isEmpty() || passengers.size() != seatIds.size()) {\n        throw new BookingException(\"need exactly one seat per passenger\");\n    }\n    if (seatIds.stream().distinct().count() != seatIds.size()) throw new BookingException(\"duplicate seat requested\");\n\n    List<FlightSeat> wanted = new ArrayList<>();\n    for (String id : seatIds) wanted.add(flight.seat(id));\n\n    // Price is read before we lock anything, so all seats in one booking share one price basis.\n    long total = 0;\n    for (FlightSeat fs : wanted) total += pricing.priceFor(flight, fs.seat().seatClass());\n\n    // Lock in seat-id order. Two requests for {4A,4B} and {4B,4A} then take locks in the same\n    // order and cannot deadlock.\n    List<FlightSeat> ordered = new ArrayList<>(wanted);\n    ordered.sort(Comparator.comparing(fs -> fs.seat().id()));\n    for (FlightSeat fs : ordered) fs.lock().lock();\n    try {\n        for (FlightSeat fs : ordered) {\n            if (fs.isBooked()) throw new BookingException(\"seat \" + fs.seat().id() + \" is already booked\");\n        }\n        for (FlightSeat fs : ordered) fs.markBooked();\n    } finally {\n        for (int i = ordered.size() - 1; i >= 0; i--) ordered.get(i).lock().unlock();\n    }\n\n    Booking booking = new Booking(\"PNR\" + pnrs.incrementAndGet(), flight, passengers, wanted, total);\n    for (Passenger p : passengers) {\n        FlightObserver notifier = new EmailNotifier(p);\n        booking.subscriptions().add(notifier);\n        flight.subscribe(notifier);\n    }\n    bookings.put(booking.pnr(), booking);\n    return booking;\n}"
        },
        {
          "file": "BookingService.java",
          "body": "public void cancel(String pnr) {\n    Booking booking = bookings.get(pnr);\n    if (booking == null) throw new BookingException(\"unknown booking \" + pnr);\n    if (!booking.markCancelled()) throw new BookingException(pnr + \" is already cancelled\");\n    for (FlightSeat fs : booking.seats()) {\n        fs.lock().lock();\n        try {\n            fs.release();\n        } finally {\n            fs.lock().unlock();\n        }\n    }\n    for (FlightObserver o : booking.subscriptions()) booking.flight().unsubscribe(o);\n}"
        }
      ]
    },
    {
      "title": "Requirement 5: pricing rules that can change",
      "text": "Price comes from a `PricingStrategy`. Class-based pricing is the base; load surcharge wraps any other strategy, so rules compose without touching booking code.",
      "code": [
        {
          "file": "PricingStrategy.java",
          "body": "public interface PricingStrategy {\n    long priceFor(FlightInstance flight, SeatClass seatClass);\n}"
        },
        {
          "file": "ClassBasedPricing.java",
          "body": "public class ClassBasedPricing implements PricingStrategy {\n    @Override\n    public long priceFor(FlightInstance flight, SeatClass seatClass) {\n        double multiplier = switch (seatClass) {\n            case ECONOMY -> 1.0;\n            case BUSINESS -> 2.5;\n            case FIRST -> 4.0;\n        };\n        return Math.round(flight.schedule().baseFare() * multiplier);\n    }\n}"
        },
        {
          "file": "LoadSurchargePricing.java",
          "body": "/** Wraps another strategy and charges more when the flight is filling up. */\npublic class LoadSurchargePricing implements PricingStrategy {\n    private final PricingStrategy inner;\n    private final double threshold;\n    private final double surcharge;\n\n    public LoadSurchargePricing(PricingStrategy inner, double threshold, double surcharge) {\n        this.inner = inner;\n        this.threshold = threshold;\n        this.surcharge = surcharge;\n    }\n\n    @Override\n    public long priceFor(FlightInstance flight, SeatClass seatClass) {\n        long base = inner.priceFor(flight, seatClass);\n        return flight.bookedFraction() >= threshold ? Math.round(base * surcharge) : base;\n    }\n}"
        }
      ]
    },
    {
      "title": "Requirement 6: notify passengers of delays and cancellations",
      "text": "The flight instance is the subject; each booked passenger is subscribed as a `FlightObserver`. A new channel (SMS, push) is one more observer implementation. Cancelling a booking unsubscribes its passengers.",
      "code": [
        {
          "file": "FlightObserver.java",
          "body": "public interface FlightObserver {\n    void onDelayed(FlightInstance flight, int minutes);\n\n    void onCancelled(FlightInstance flight);\n}"
        },
        {
          "file": "EmailNotifier.java",
          "body": "public class EmailNotifier implements FlightObserver {\n    private final Passenger passenger;\n\n    public EmailNotifier(Passenger passenger) { this.passenger = passenger; }\n\n    @Override\n    public void onDelayed(FlightInstance flight, int minutes) {\n        System.out.println(\"  [email to \" + passenger.email() + \"] \" + flight.schedule().flightNumber()\n                + \" on \" + flight.date() + \" is delayed by \" + minutes + \" min\");\n    }\n\n    @Override\n    public void onCancelled(FlightInstance flight) {\n        System.out.println(\"  [email to \" + passenger.email() + \"] \" + flight.schedule().flightNumber()\n                + \" on \" + flight.date() + \" is cancelled\");\n    }\n}"
        },
        {
          "file": "FlightInstance.java",
          "body": "public void delay(int minutes) {\n    status = FlightStatus.DELAYED;\n    delayMinutes += minutes;\n    for (FlightObserver o : observers) o.onDelayed(this, minutes);\n}"
        },
        {
          "file": "FlightInstance.java",
          "body": "public void cancel() {\n    status = FlightStatus.CANCELLED;\n    for (FlightObserver o : observers) o.onCancelled(this);\n}"
        }
      ]
    }
  ],
  "files": [
    {
      "file": "Airport.java",
      "body": "public record Airport(String code, String city) {}"
    },
    {
      "file": "Passenger.java",
      "body": "public record Passenger(String name, String email) {}"
    },
    {
      "file": "SeatClass.java",
      "body": "public enum SeatClass { ECONOMY, BUSINESS, FIRST }"
    },
    {
      "file": "Seat.java",
      "body": "/** A permanent physical seat on an aircraft. It is never \"booked\"; a FlightSeat is. */\npublic record Seat(int row, char letter, SeatClass seatClass) {\n    public String id() { return row + \"\" + letter; }\n}"
    },
    {
      "file": "Aircraft.java",
      "body": "import java.util.ArrayList;\nimport java.util.Collections;\nimport java.util.List;\n\npublic class Aircraft {\n    private final String model;\n    private final List<Seat> seats;\n\n    private Aircraft(String model, List<Seat> seats) {\n        this.model = model;\n        this.seats = Collections.unmodifiableList(seats);\n    }\n\n    /** First rows have 2 seats (A-B), business rows 3 (A-C), economy rows 4 (A-D). */\n    public static Aircraft layout(String model, int firstRows, int businessRows, int economyRows) {\n        List<Seat> seats = new ArrayList<>();\n        int row = 1;\n        for (int i = 0; i < firstRows; i++, row++) addRow(seats, row, \"AB\", SeatClass.FIRST);\n        for (int i = 0; i < businessRows; i++, row++) addRow(seats, row, \"ABC\", SeatClass.BUSINESS);\n        for (int i = 0; i < economyRows; i++, row++) addRow(seats, row, \"ABCD\", SeatClass.ECONOMY);\n        return new Aircraft(model, seats);\n    }\n\n    private static void addRow(List<Seat> seats, int row, String letters, SeatClass cls) {\n        for (char c : letters.toCharArray()) seats.add(new Seat(row, c, cls));\n    }\n\n    public String model() { return model; }\n    public List<Seat> seats() { return seats; }\n}"
    },
    {
      "file": "FlightSchedule.java",
      "body": "import java.time.DayOfWeek;\nimport java.time.Duration;\nimport java.time.LocalDate;\nimport java.time.LocalTime;\nimport java.util.Set;\n\n/** A recurring route, e.g. AI-101 BLR to DEL at 06:00 on weekdays. Immutable template. */\npublic record FlightSchedule(String flightNumber, Airport origin, Airport destination,\n                             LocalTime departure, Duration duration, Aircraft aircraft,\n                             long baseFare, Set<DayOfWeek> operatingDays) {\n\n    public boolean operatesOn(LocalDate date) {\n        return operatingDays.contains(date.getDayOfWeek());\n    }\n}"
    },
    {
      "file": "FlightStatus.java",
      "body": "public enum FlightStatus { SCHEDULED, DELAYED, CANCELLED }"
    },
    {
      "file": "FlightSeat.java",
      "body": "import java.util.concurrent.locks.ReentrantLock;\n\n/** The state of one Seat on one dated departure. This is the thing that gets booked. */\npublic class FlightSeat {\n    private final Seat seat;\n    private final ReentrantLock lock = new ReentrantLock();\n    private volatile boolean booked;\n\n    public FlightSeat(Seat seat) { this.seat = seat; }\n\n    public Seat seat() { return seat; }\n    public boolean isBooked() { return booked; }\n    ReentrantLock lock() { return lock; }\n\n    // Both mutators require lock() to be held by the caller.\n    void markBooked() { booked = true; }\n    void release() { booked = false; }\n}"
    },
    {
      "file": "FlightObserver.java",
      "body": "public interface FlightObserver {\n    void onDelayed(FlightInstance flight, int minutes);\n\n    void onCancelled(FlightInstance flight);\n}"
    },
    {
      "file": "EmailNotifier.java",
      "body": "public class EmailNotifier implements FlightObserver {\n    private final Passenger passenger;\n\n    public EmailNotifier(Passenger passenger) { this.passenger = passenger; }\n\n    @Override\n    public void onDelayed(FlightInstance flight, int minutes) {\n        System.out.println(\"  [email to \" + passenger.email() + \"] \" + flight.schedule().flightNumber()\n                + \" on \" + flight.date() + \" is delayed by \" + minutes + \" min\");\n    }\n\n    @Override\n    public void onCancelled(FlightInstance flight) {\n        System.out.println(\"  [email to \" + passenger.email() + \"] \" + flight.schedule().flightNumber()\n                + \" on \" + flight.date() + \" is cancelled\");\n    }\n}"
    },
    {
      "file": "FlightInstance.java",
      "body": "import java.time.LocalDate;\nimport java.time.LocalDateTime;\nimport java.util.ArrayList;\nimport java.util.LinkedHashMap;\nimport java.util.List;\nimport java.util.Map;\nimport java.util.concurrent.CopyOnWriteArrayList;\n\n/** One dated departure of a schedule: owns its status and its own seat map. */\npublic class FlightInstance {\n    private final FlightSchedule schedule;\n    private final LocalDate date;\n    private final Map<String, FlightSeat> seats = new LinkedHashMap<>();\n    private final List<FlightObserver> observers = new CopyOnWriteArrayList<>();\n    private volatile FlightStatus status = FlightStatus.SCHEDULED;\n    private volatile int delayMinutes;\n\n    public FlightInstance(FlightSchedule schedule, LocalDate date) {\n        this.schedule = schedule;\n        this.date = date;\n        for (Seat s : schedule.aircraft().seats()) seats.put(s.id(), new FlightSeat(s));\n    }\n\n    public FlightSchedule schedule() { return schedule; }\n    public LocalDate date() { return date; }\n    public FlightStatus status() { return status; }\n    public int delayMinutes() { return delayMinutes; }\n    public String id() { return schedule.flightNumber() + \"@\" + date; }\n\n    public LocalDateTime departure() {\n        return date.atTime(schedule.departure()).plusMinutes(delayMinutes);\n    }\n\n    public FlightSeat seat(String seatId) {\n        FlightSeat s = seats.get(seatId);\n        if (s == null) throw new IllegalArgumentException(\"no seat \" + seatId + \" on \" + id());\n        return s;\n    }\n\n    public List<FlightSeat> allSeats() { return new ArrayList<>(seats.values()); }\n\n    public long availableSeats(SeatClass cls) {\n        return seats.values().stream()\n                .filter(s -> s.seat().seatClass() == cls && !s.isBooked()).count();\n    }\n\n    public long availableSeats() {\n        return seats.values().stream().filter(s -> !s.isBooked()).count();\n    }\n\n    public double bookedFraction() {\n        return 1.0 - (double) availableSeats() / seats.size();\n    }\n\n    // ---- observers: who wants to hear about delays and cancellations ----\n\n    public void subscribe(FlightObserver o) { observers.add(o); }\n    public void unsubscribe(FlightObserver o) { observers.remove(o); }\n\n    public void delay(int minutes) {\n        status = FlightStatus.DELAYED;\n        delayMinutes += minutes;\n        for (FlightObserver o : observers) o.onDelayed(this, minutes);\n    }\n\n    public void cancel() {\n        status = FlightStatus.CANCELLED;\n        for (FlightObserver o : observers) o.onCancelled(this);\n    }\n}"
    },
    {
      "file": "FlightSearchService.java",
      "body": "import java.time.LocalDate;\nimport java.util.ArrayList;\nimport java.util.Comparator;\nimport java.util.List;\nimport java.util.Map;\nimport java.util.concurrent.ConcurrentHashMap;\n\npublic class FlightSearchService {\n    private final List<FlightSchedule> schedules = new ArrayList<>();\n    private final Map<String, FlightInstance> instances = new ConcurrentHashMap<>();\n\n    public void addSchedule(FlightSchedule schedule) { schedules.add(schedule); }\n\n    /** The dated departure for a schedule, created on first use and shared by everyone after. */\n    public FlightInstance instance(FlightSchedule schedule, LocalDate date) {\n        if (!schedule.operatesOn(date)) throw new IllegalArgumentException(schedule.flightNumber() + \" does not fly on \" + date);\n        return instances.computeIfAbsent(schedule.flightNumber() + \"@\" + date, k -> new FlightInstance(schedule, date));\n    }\n\n    public FlightInstance instance(String flightNumber, LocalDate date) {\n        for (FlightSchedule s : schedules) if (s.flightNumber().equals(flightNumber)) return instance(s, date);\n        throw new IllegalArgumentException(\"unknown flight \" + flightNumber);\n    }\n\n    /** Flights on a route and date that are not cancelled and still have a free seat, earliest first. */\n    public List<FlightInstance> search(String originCode, String destinationCode, LocalDate date) {\n        List<FlightInstance> result = new ArrayList<>();\n        for (FlightSchedule s : schedules) {\n            if (!s.origin().code().equals(originCode) || !s.destination().code().equals(destinationCode)) continue;\n            if (!s.operatesOn(date)) continue;\n            FlightInstance f = instance(s, date);\n            if (f.status() != FlightStatus.CANCELLED && f.availableSeats() > 0) result.add(f);\n        }\n        result.sort(Comparator.comparing(FlightInstance::departure));\n        return result;\n    }\n}"
    },
    {
      "file": "PricingStrategy.java",
      "body": "public interface PricingStrategy {\n    long priceFor(FlightInstance flight, SeatClass seatClass);\n}"
    },
    {
      "file": "ClassBasedPricing.java",
      "body": "public class ClassBasedPricing implements PricingStrategy {\n    @Override\n    public long priceFor(FlightInstance flight, SeatClass seatClass) {\n        double multiplier = switch (seatClass) {\n            case ECONOMY -> 1.0;\n            case BUSINESS -> 2.5;\n            case FIRST -> 4.0;\n        };\n        return Math.round(flight.schedule().baseFare() * multiplier);\n    }\n}"
    },
    {
      "file": "LoadSurchargePricing.java",
      "body": "/** Wraps another strategy and charges more when the flight is filling up. */\npublic class LoadSurchargePricing implements PricingStrategy {\n    private final PricingStrategy inner;\n    private final double threshold;\n    private final double surcharge;\n\n    public LoadSurchargePricing(PricingStrategy inner, double threshold, double surcharge) {\n        this.inner = inner;\n        this.threshold = threshold;\n        this.surcharge = surcharge;\n    }\n\n    @Override\n    public long priceFor(FlightInstance flight, SeatClass seatClass) {\n        long base = inner.priceFor(flight, seatClass);\n        return flight.bookedFraction() >= threshold ? Math.round(base * surcharge) : base;\n    }\n}"
    },
    {
      "file": "BookingStatus.java",
      "body": "public enum BookingStatus { CONFIRMED, CANCELLED }"
    },
    {
      "file": "BookingException.java",
      "body": "public class BookingException extends RuntimeException {\n    public BookingException(String message) { super(message); }\n}"
    },
    {
      "file": "Booking.java",
      "body": "import java.util.ArrayList;\nimport java.util.List;\n\npublic class Booking {\n    private final String pnr;\n    private final FlightInstance flight;\n    private final List<Passenger> passengers;\n    private final List<FlightSeat> seats;\n    private final long totalPrice;\n    private BookingStatus status = BookingStatus.CONFIRMED;\n    private final List<FlightObserver> subscriptions = new ArrayList<>();\n\n    Booking(String pnr, FlightInstance flight, List<Passenger> passengers, List<FlightSeat> seats, long totalPrice) {\n        this.pnr = pnr;\n        this.flight = flight;\n        this.passengers = List.copyOf(passengers);\n        this.seats = List.copyOf(seats);\n        this.totalPrice = totalPrice;\n    }\n\n    public String pnr() { return pnr; }\n    public FlightInstance flight() { return flight; }\n    public List<Passenger> passengers() { return passengers; }\n    public List<FlightSeat> seats() { return seats; }\n    public long totalPrice() { return totalPrice; }\n    public synchronized BookingStatus status() { return status; }\n\n    List<FlightObserver> subscriptions() { return subscriptions; }\n\n    /** Returns false if it was already cancelled, so a double cancel releases seats once. */\n    synchronized boolean markCancelled() {\n        if (status == BookingStatus.CANCELLED) return false;\n        status = BookingStatus.CANCELLED;\n        return true;\n    }\n}"
    },
    {
      "file": "BookingService.java",
      "body": "import java.util.ArrayList;\nimport java.util.Comparator;\nimport java.util.List;\nimport java.util.Map;\nimport java.util.concurrent.ConcurrentHashMap;\nimport java.util.concurrent.atomic.AtomicInteger;\n\npublic class BookingService {\n    private final PricingStrategy pricing;\n    private final Map<String, Booking> bookings = new ConcurrentHashMap<>();\n    private final AtomicInteger pnrs = new AtomicInteger(1000);\n\n    public BookingService(PricingStrategy pricing) { this.pricing = pricing; }\n\n    /** One seat per passenger. Either every seat is booked, or none is. */\n    public Booking book(FlightInstance flight, List<Passenger> passengers, List<String> seatIds) {\n        if (flight.status() == FlightStatus.CANCELLED) throw new BookingException(\"flight is cancelled\");\n        if (passengers.isEmpty() || passengers.size() != seatIds.size()) {\n            throw new BookingException(\"need exactly one seat per passenger\");\n        }\n        if (seatIds.stream().distinct().count() != seatIds.size()) throw new BookingException(\"duplicate seat requested\");\n\n        List<FlightSeat> wanted = new ArrayList<>();\n        for (String id : seatIds) wanted.add(flight.seat(id));\n\n        // Price is read before we lock anything, so all seats in one booking share one price basis.\n        long total = 0;\n        for (FlightSeat fs : wanted) total += pricing.priceFor(flight, fs.seat().seatClass());\n\n        // Lock in seat-id order. Two requests for {4A,4B} and {4B,4A} then take locks in the same\n        // order and cannot deadlock.\n        List<FlightSeat> ordered = new ArrayList<>(wanted);\n        ordered.sort(Comparator.comparing(fs -> fs.seat().id()));\n        for (FlightSeat fs : ordered) fs.lock().lock();\n        try {\n            for (FlightSeat fs : ordered) {\n                if (fs.isBooked()) throw new BookingException(\"seat \" + fs.seat().id() + \" is already booked\");\n            }\n            for (FlightSeat fs : ordered) fs.markBooked();\n        } finally {\n            for (int i = ordered.size() - 1; i >= 0; i--) ordered.get(i).lock().unlock();\n        }\n\n        Booking booking = new Booking(\"PNR\" + pnrs.incrementAndGet(), flight, passengers, wanted, total);\n        for (Passenger p : passengers) {\n            FlightObserver notifier = new EmailNotifier(p);\n            booking.subscriptions().add(notifier);\n            flight.subscribe(notifier);\n        }\n        bookings.put(booking.pnr(), booking);\n        return booking;\n    }\n\n    public void cancel(String pnr) {\n        Booking booking = bookings.get(pnr);\n        if (booking == null) throw new BookingException(\"unknown booking \" + pnr);\n        if (!booking.markCancelled()) throw new BookingException(pnr + \" is already cancelled\");\n        for (FlightSeat fs : booking.seats()) {\n            fs.lock().lock();\n            try {\n                fs.release();\n            } finally {\n                fs.lock().unlock();\n            }\n        }\n        for (FlightObserver o : booking.subscriptions()) booking.flight().unsubscribe(o);\n    }\n\n    public Booking booking(String pnr) { return bookings.get(pnr); }\n}"
    }
  ],
  "driver": {
    "text": "The driver searches a route, books economy and first class, shows a failed booking taking no seats, triggers the load surcharge, cancels a booking, then delays and cancels the flight so passengers are notified.",
    "file": "Main.java",
    "body": "import java.time.DayOfWeek;\nimport java.time.Duration;\nimport java.time.LocalDate;\nimport java.time.LocalTime;\nimport java.util.List;\nimport java.util.Set;\n\npublic class Main {\n    public static void main(String[] args) {\n        Airport blr = new Airport(\"BLR\", \"Bengaluru\");\n        Airport del = new Airport(\"DEL\", \"Delhi\");\n        Aircraft a320 = Aircraft.layout(\"A320\", 1, 2, 3);      // 2 first, 6 business, 12 economy = 20 seats\n\n        FlightSearchService search = new FlightSearchService();\n        Set<DayOfWeek> daily = Set.of(DayOfWeek.values());\n        search.addSchedule(new FlightSchedule(\"AI-101\", blr, del, LocalTime.of(6, 0), Duration.ofMinutes(160), a320, 5000, daily));\n        search.addSchedule(new FlightSchedule(\"AI-103\", blr, del, LocalTime.of(18, 30), Duration.ofHours(3), a320, 5200, daily));\n\n        BookingService bookings = new BookingService(new LoadSurchargePricing(new ClassBasedPricing(), 0.25, 1.2));\n        LocalDate day = LocalDate.of(2026, 6, 15);   // a Monday\n\n        System.out.println(\"-- 1. Search BLR to DEL on \" + day);\n        for (FlightInstance f : search.search(\"BLR\", \"DEL\", day)) {\n            System.out.println(\"  \" + f.schedule().flightNumber() + \" departs \" + f.departure().toLocalTime()\n                    + \", \" + f.availableSeats() + \" seats free (economy \" + f.availableSeats(SeatClass.ECONOMY) + \")\");\n        }\n        FlightInstance morning = search.instance(\"AI-101\", day);\n\n        System.out.println(\"-- 2. Seat classes decide the price\");\n        Passenger asha = new Passenger(\"Asha\", \"asha@mail.com\");\n        Passenger ravi = new Passenger(\"Ravi\", \"ravi@mail.com\");\n        Booking b1 = bookings.book(morning, List.of(asha, ravi), List.of(\"4A\", \"4B\"));\n        System.out.println(\"  \" + b1.pnr() + \": economy 4A+4B, total \" + b1.totalPrice());\n        Passenger mei = new Passenger(\"Mei\", \"mei@mail.com\");\n        Booking b2 = bookings.book(morning, List.of(mei), List.of(\"1A\"));\n        System.out.println(\"  \" + b2.pnr() + \": first class 1A, total \" + b2.totalPrice());\n\n        System.out.println(\"-- 3. A seat can only be booked once, and a failed booking takes nothing\");\n        try {\n            bookings.book(morning, List.of(new Passenger(\"Li\", \"li@mail.com\")), List.of(\"4A\"));\n        } catch (BookingException e) {\n            System.out.println(\"  Li wants 4A: \" + e.getMessage());\n        }\n        try {\n            bookings.book(morning, List.of(new Passenger(\"Li\", \"li@mail.com\"), new Passenger(\"Jo\", \"jo@mail.com\")),\n                    List.of(\"5A\", \"4B\"));\n        } catch (BookingException e) {\n            System.out.println(\"  Li+Jo want 5A+4B: \" + e.getMessage());\n        }\n        System.out.println(\"  5A still free: \" + !morning.seat(\"5A\").isBooked());\n\n        System.out.println(\"-- 4. Pricing rule changes with load (surcharge from 25% full)\");\n        long before = new LoadSurchargePricing(new ClassBasedPricing(), 0.25, 1.2).priceFor(morning, SeatClass.ECONOMY);\n        for (String id : List.of(\"5A\", \"5B\")) {\n            bookings.book(morning, List.of(new Passenger(\"P\" + id, id + \"@mail.com\")), List.of(id));\n        }\n        long after = new LoadSurchargePricing(new ClassBasedPricing(), 0.25, 1.2).priceFor(morning, SeatClass.ECONOMY);\n        System.out.println(\"  economy fare at \" + Math.round(morning.bookedFraction() * 100) + \"% full: \" + after + \" (was \" + before + \")\");\n\n        System.out.println(\"-- 5. Cancel releases the seats\");\n        System.out.println(\"  seats free before: \" + morning.availableSeats());\n        bookings.cancel(b1.pnr());\n        System.out.println(\"  seats free after cancelling \" + b1.pnr() + \": \" + morning.availableSeats());\n        try {\n            bookings.cancel(b1.pnr());\n        } catch (BookingException e) {\n            System.out.println(\"  cancelling again: \" + e.getMessage());\n        }\n\n        System.out.println(\"-- 6. Passengers hear about delays and cancellations\");\n        morning.delay(45);\n        System.out.println(\"  new departure: \" + morning.departure().toLocalTime());\n        morning.cancel();\n        try {\n            bookings.book(morning, List.of(new Passenger(\"Zed\", \"zed@mail.com\")), List.of(\"4C\"));\n        } catch (BookingException e) {\n            System.out.println(\"  booking on a cancelled flight: \" + e.getMessage());\n        }\n        System.out.println(\"  search now shows \" + search.search(\"BLR\", \"DEL\", day).size() + \" flight(s) (the evening one)\");\n    }\n}",
    "output": "-- 1. Search BLR to DEL on 2026-06-15\n  AI-101 departs 06:00, 20 seats free (economy 12)\n  AI-103 departs 18:30, 20 seats free (economy 12)\n-- 2. Seat classes decide the price\n  PNR1001: economy 4A+4B, total 10000\n  PNR1002: first class 1A, total 20000\n-- 3. A seat can only be booked once, and a failed booking takes nothing\n  Li wants 4A: seat 4A is already booked\n  Li+Jo want 5A+4B: seat 4B is already booked\n  5A still free: true\n-- 4. Pricing rule changes with load (surcharge from 25% full)\n  economy fare at 25% full: 6000 (was 5000)\n-- 5. Cancel releases the seats\n  seats free before: 15\n  seats free after cancelling PNR1001: 17\n  cancelling again: PNR1001 is already cancelled\n-- 6. Passengers hear about delays and cancellations\n  [email to mei@mail.com] AI-101 on 2026-06-15 is delayed by 45 min\n  [email to 5A@mail.com] AI-101 on 2026-06-15 is delayed by 45 min\n  [email to 5B@mail.com] AI-101 on 2026-06-15 is delayed by 45 min\n  new departure: 06:45\n  [email to mei@mail.com] AI-101 on 2026-06-15 is cancelled\n  [email to 5A@mail.com] AI-101 on 2026-06-15 is cancelled\n  [email to 5B@mail.com] AI-101 on 2026-06-15 is cancelled\n  booking on a cancelled flight: flight is cancelled\n  search now shows 1 flight(s) (the evening one)"
  },
  "tests": {
    "file": "Tests.java",
    "cases": [
      "search only returns flights operating that day",
      "search respects direction",
      "cannot create an instance on a non-operating day",
      "the same dated flight is one shared instance",
      "each date has its own instance and seats",
      "booking a seat affects only its own date",
      "availability is counted per instance",
      "economy pays the base fare",
      "business is 2.5x",
      "first is 4x",
      "party total sums every seat",
      "no surcharge on an empty flight",
      "surcharge applies once the flight is half full",
      "seat count must match passenger count",
      "duplicate seats are rejected",
      "unknown seat is rejected",
      "empty booking is rejected",
      "party booking fails when one seat is taken",
      "a failed party booking holds none of its seats",
      "cancel releases the seats",
      "cancelling twice is rejected",
      "a released seat can be booked again",
      "cancelling an unknown booking is rejected",
      "observers hear about each delay and the total accumulates",
      "departure time reflects the delay",
      "observers hear about cancellation",
      "cancelled flight cannot be booked",
      "cancelled flight disappears from search",
      "60 concurrent bookings of seat 4A: exactly one wins",
      "overlapping party bookings finish without deadlock",
      "overlapping parties: exactly one booking wins",
      "100 requests for 13 seats: every seat sold exactly once"
    ],
    "body": "import java.time.DayOfWeek;\nimport java.time.Duration;\nimport java.time.LocalDate;\nimport java.time.LocalTime;\nimport java.util.ArrayList;\nimport java.util.Collections;\nimport java.util.List;\nimport java.util.Set;\nimport java.util.concurrent.CountDownLatch;\nimport java.util.concurrent.ExecutorService;\nimport java.util.concurrent.Executors;\nimport java.util.concurrent.TimeUnit;\nimport java.util.concurrent.atomic.AtomicInteger;\n\npublic class Tests {\n    static final Airport BLR = new Airport(\"BLR\", \"Bengaluru\");\n    static final Airport DEL = new Airport(\"DEL\", \"Delhi\");\n    static final LocalDate MONDAY = LocalDate.of(2026, 6, 15);\n\n    static void check(boolean cond, String name) {\n        if (!cond) throw new AssertionError(\"FAIL: \" + name);\n        System.out.println(\"PASS: \" + name);\n    }\n\n    static Passenger p(String n) { return new Passenger(n, n + \"@mail.com\"); }\n\n    static FlightSchedule schedule(String no, Set<DayOfWeek> days) {\n        return new FlightSchedule(no, BLR, DEL, LocalTime.of(6, 0), Duration.ofMinutes(160),\n                Aircraft.layout(\"A320\", 1, 1, 2), 1000, days);   // 2 first + 3 business + 8 economy = 13\n    }\n\n    static boolean fails(Runnable r) {\n        try { r.run(); return false; } catch (BookingException | IllegalArgumentException e) { return true; }\n    }\n\n    public static void main(String[] args) throws Exception {\n        { // search\n            FlightSearchService s = new FlightSearchService();\n            s.addSchedule(schedule(\"X1\", Set.of(DayOfWeek.MONDAY)));\n            s.addSchedule(schedule(\"X2\", Set.of(DayOfWeek.TUESDAY)));\n            check(s.search(\"BLR\", \"DEL\", MONDAY).size() == 1, \"search only returns flights operating that day\");\n            check(s.search(\"DEL\", \"BLR\", MONDAY).isEmpty(), \"search respects direction\");\n            check(fails(() -> s.instance(\"X2\", MONDAY)), \"cannot create an instance on a non-operating day\");\n            check(s.instance(\"X1\", MONDAY) == s.instance(\"X1\", MONDAY), \"the same dated flight is one shared instance\");\n            check(s.instance(\"X1\", MONDAY) != s.instance(\"X1\", MONDAY.plusDays(7)), \"each date has its own instance and seats\");\n        }\n        { // seat maps are per instance\n            FlightSearchService s = new FlightSearchService();\n            s.addSchedule(schedule(\"X1\", Set.of(DayOfWeek.MONDAY)));\n            BookingService b = new BookingService(new ClassBasedPricing());\n            FlightInstance w1 = s.instance(\"X1\", MONDAY);\n            FlightInstance w2 = s.instance(\"X1\", MONDAY.plusDays(7));\n            b.book(w1, List.of(p(\"A\")), List.of(\"4A\"));\n            check(w1.seat(\"4A\").isBooked() && !w2.seat(\"4A\").isBooked(), \"booking a seat affects only its own date\");\n            check(w1.availableSeats() == 12 && w2.availableSeats() == 13, \"availability is counted per instance\");\n        }\n        { // pricing\n            FlightSearchService s = new FlightSearchService();\n            s.addSchedule(schedule(\"X1\", Set.of(DayOfWeek.MONDAY)));\n            FlightInstance f = s.instance(\"X1\", MONDAY);\n            BookingService b = new BookingService(new ClassBasedPricing());\n            check(b.book(f, List.of(p(\"A\")), List.of(\"4A\")).totalPrice() == 1000, \"economy pays the base fare\");\n            check(b.book(f, List.of(p(\"B\")), List.of(\"2A\")).totalPrice() == 2500, \"business is 2.5x\");\n            check(b.book(f, List.of(p(\"C\")), List.of(\"1A\")).totalPrice() == 4000, \"first is 4x\");\n            check(b.book(f, List.of(p(\"D\"), p(\"E\")), List.of(\"4B\", \"4C\")).totalPrice() == 2000, \"party total sums every seat\");\n            FlightInstance g = s.instance(\"X1\", MONDAY.plusDays(7));\n            PricingStrategy surge = new LoadSurchargePricing(new ClassBasedPricing(), 0.5, 1.5);\n            check(surge.priceFor(g, SeatClass.ECONOMY) == 1000, \"no surcharge on an empty flight\");\n            BookingService sb = new BookingService(surge);\n            for (String id : List.of(\"1A\", \"1B\", \"2A\", \"2B\", \"2C\", \"3A\", \"4A\")) sb.book(g, List.of(p(id)), List.of(id));\n            check(surge.priceFor(g, SeatClass.ECONOMY) == 1500, \"surcharge applies once the flight is half full\");\n        }\n        { // validation\n            FlightSearchService s = new FlightSearchService();\n            s.addSchedule(schedule(\"X1\", Set.of(DayOfWeek.MONDAY)));\n            FlightInstance f = s.instance(\"X1\", MONDAY);\n            BookingService b = new BookingService(new ClassBasedPricing());\n            check(fails(() -> b.book(f, List.of(p(\"A\")), List.of(\"4A\", \"4B\"))), \"seat count must match passenger count\");\n            check(fails(() -> b.book(f, List.of(p(\"A\"), p(\"B\")), List.of(\"4A\", \"4A\"))), \"duplicate seats are rejected\");\n            check(fails(() -> b.book(f, List.of(p(\"A\")), List.of(\"99Z\"))), \"unknown seat is rejected\");\n            check(fails(() -> b.book(f, List.of(), List.of())), \"empty booking is rejected\");\n        }\n        { // all or nothing, cancel\n            FlightSearchService s = new FlightSearchService();\n            s.addSchedule(schedule(\"X1\", Set.of(DayOfWeek.MONDAY)));\n            FlightInstance f = s.instance(\"X1\", MONDAY);\n            BookingService b = new BookingService(new ClassBasedPricing());\n            Booking first = b.book(f, List.of(p(\"A\")), List.of(\"4B\"));\n            check(fails(() -> b.book(f, List.of(p(\"C\"), p(\"D\")), List.of(\"4A\", \"4B\"))), \"party booking fails when one seat is taken\");\n            check(!f.seat(\"4A\").isBooked(), \"a failed party booking holds none of its seats\");\n            b.cancel(first.pnr());\n            check(!f.seat(\"4B\").isBooked() && first.status() == BookingStatus.CANCELLED, \"cancel releases the seats\");\n            check(fails(() -> b.cancel(first.pnr())), \"cancelling twice is rejected\");\n            check(b.book(f, List.of(p(\"E\")), List.of(\"4B\")).status() == BookingStatus.CONFIRMED, \"a released seat can be booked again\");\n            check(fails(() -> b.cancel(\"PNR-nope\")), \"cancelling an unknown booking is rejected\");\n        }\n        { // notifications\n            FlightSearchService s = new FlightSearchService();\n            s.addSchedule(schedule(\"X1\", Set.of(DayOfWeek.MONDAY)));\n            FlightInstance f = s.instance(\"X1\", MONDAY);\n            BookingService b = new BookingService(new ClassBasedPricing());\n            AtomicInteger delays = new AtomicInteger(), cancels = new AtomicInteger();\n            f.subscribe(new FlightObserver() {\n                public void onDelayed(FlightInstance fl, int m) { delays.addAndGet(m); }\n                public void onCancelled(FlightInstance fl) { cancels.incrementAndGet(); }\n            });\n            b.book(f, List.of(p(\"A\")), List.of(\"4A\"));\n            f.delay(30);\n            f.delay(15);\n            check(delays.get() == 45 && f.delayMinutes() == 45 && f.status() == FlightStatus.DELAYED, \"observers hear about each delay and the total accumulates\");\n            check(f.departure().toLocalTime().equals(LocalTime.of(6, 45)), \"departure time reflects the delay\");\n            f.cancel();\n            check(cancels.get() == 1 && f.status() == FlightStatus.CANCELLED, \"observers hear about cancellation\");\n            check(fails(() -> b.book(f, List.of(p(\"B\")), List.of(\"4B\"))), \"cancelled flight cannot be booked\");\n            check(s.search(\"BLR\", \"DEL\", MONDAY).isEmpty(), \"cancelled flight disappears from search\");\n        }\n        { // concurrency: one seat\n            FlightSearchService s = new FlightSearchService();\n            s.addSchedule(schedule(\"X1\", Set.of(DayOfWeek.MONDAY)));\n            FlightInstance f = s.instance(\"X1\", MONDAY);\n            BookingService b = new BookingService(new ClassBasedPricing());\n            AtomicInteger wins = new AtomicInteger();\n            ExecutorService pool = Executors.newFixedThreadPool(16);\n            CountDownLatch go = new CountDownLatch(1);\n            for (int i = 0; i < 60; i++) {\n                final int n = i;\n                pool.submit(() -> {\n                    try { go.await(); } catch (InterruptedException e) { return; }\n                    try { b.book(f, List.of(p(\"P\" + n)), List.of(\"4A\")); wins.incrementAndGet(); } catch (BookingException ignored) {}\n                });\n            }\n            go.countDown();\n            pool.shutdown();\n            pool.awaitTermination(10, TimeUnit.SECONDS);\n            check(wins.get() == 1, \"60 concurrent bookings of seat 4A: exactly one wins\");\n        }\n        { // concurrency: overlapping parties in opposite order\n            FlightSearchService s = new FlightSearchService();\n            s.addSchedule(schedule(\"X1\", Set.of(DayOfWeek.MONDAY)));\n            FlightInstance f = s.instance(\"X1\", MONDAY);\n            BookingService b = new BookingService(new ClassBasedPricing());\n            AtomicInteger wins = new AtomicInteger();\n            ExecutorService pool = Executors.newFixedThreadPool(16);\n            CountDownLatch go = new CountDownLatch(1);\n            for (int i = 0; i < 60; i++) {\n                final int n = i;\n                pool.submit(() -> {\n                    try { go.await(); } catch (InterruptedException e) { return; }\n                    List<String> seats = n % 2 == 0 ? List.of(\"4A\", \"4B\") : List.of(\"4B\", \"4A\");\n                    try { b.book(f, List.of(p(\"X\" + n), p(\"Y\" + n)), seats); wins.incrementAndGet(); } catch (BookingException ignored) {}\n                });\n            }\n            go.countDown();\n            pool.shutdown();\n            check(pool.awaitTermination(10, TimeUnit.SECONDS), \"overlapping party bookings finish without deadlock\");\n            check(wins.get() == 1, \"overlapping parties: exactly one booking wins\");\n        }\n        { // concurrency: fill the plane\n            FlightSearchService s = new FlightSearchService();\n            s.addSchedule(schedule(\"X1\", Set.of(DayOfWeek.MONDAY)));\n            FlightInstance f = s.instance(\"X1\", MONDAY);\n            BookingService b = new BookingService(new ClassBasedPricing());\n            List<Booking> got = Collections.synchronizedList(new ArrayList<>());\n            List<String> all = new ArrayList<>();\n            for (FlightSeat fs : f.allSeats()) all.add(fs.seat().id());\n            ExecutorService pool = Executors.newFixedThreadPool(16);\n            CountDownLatch go = new CountDownLatch(1);\n            for (int i = 0; i < 100; i++) {\n                final int n = i;\n                pool.submit(() -> {\n                    try { go.await(); } catch (InterruptedException e) { return; }\n                    String seat = all.get(n % all.size());\n                    try { got.add(b.book(f, List.of(p(\"Q\" + n)), List.of(seat))); } catch (BookingException ignored) {}\n                });\n            }\n            go.countDown();\n            pool.shutdown();\n            pool.awaitTermination(10, TimeUnit.SECONDS);\n            check(got.size() == all.size() && f.availableSeats() == 0, \"100 requests for 13 seats: every seat sold exactly once\");\n        }\n        System.out.println(\"ALL TESTS PASSED\");\n    }\n}",
    "output": "PASS: search only returns flights operating that day\nPASS: search respects direction\nPASS: cannot create an instance on a non-operating day\nPASS: the same dated flight is one shared instance\nPASS: each date has its own instance and seats\nPASS: booking a seat affects only its own date\nPASS: availability is counted per instance\nPASS: economy pays the base fare\nPASS: business is 2.5x\nPASS: first is 4x\nPASS: party total sums every seat\nPASS: no surcharge on an empty flight\nPASS: surcharge applies once the flight is half full\nPASS: seat count must match passenger count\nPASS: duplicate seats are rejected\nPASS: unknown seat is rejected\nPASS: empty booking is rejected\nPASS: party booking fails when one seat is taken\nPASS: a failed party booking holds none of its seats\nPASS: cancel releases the seats\nPASS: cancelling twice is rejected\nPASS: a released seat can be booked again\nPASS: cancelling an unknown booking is rejected\n  [email to A@mail.com] X1 on 2026-06-15 is delayed by 30 min\n  [email to A@mail.com] X1 on 2026-06-15 is delayed by 15 min\nPASS: observers hear about each delay and the total accumulates\nPASS: departure time reflects the delay\n  [email to A@mail.com] X1 on 2026-06-15 is cancelled\nPASS: observers hear about cancellation\nPASS: cancelled flight cannot be booked\nPASS: cancelled flight disappears from search\nPASS: 60 concurrent bookings of seat 4A: exactly one wins\nPASS: overlapping party bookings finish without deadlock\nPASS: overlapping parties: exactly one booking wins\nPASS: 100 requests for 13 seats: every seat sold exactly once\nALL TESTS PASSED"
  },
  "complexity": [
    "book: O(k log k) for k seats (sorting), locks only those k seats",
    "search: O(S) schedules plus an O(seats) count per candidate flight",
    "cancel: O(k)",
    "Space: O(seats x instances) for flight seats"
  ]
}
);
