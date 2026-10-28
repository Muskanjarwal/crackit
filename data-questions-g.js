window.QUESTIONS = window.QUESTIONS || [];
window.QUESTIONS.push(
  /* ------------------------------------------------------------------ */
  {
    id: "movie-ticket-booking",
    name: "Design Movie Ticket Booking System",
    difficulty: "hard",
    understanding: "Users browse movies, pick a show in a theatre, choose seats and pay. The hard part is that seats must be held while a user is paying, and no seat may ever be sold twice, even when thousands of people click the same seat at once and the service runs on many servers.",
    dialogue: [
      { who: "you", text: "Is this a single theatre or an aggregator like BookMyShow with many theatres and cities?" },
      { who: "int", text: "An aggregator. Many theatres, each with several screens, each screen running several shows a day." },
      { who: "you", text: "How do users find a movie? Search by title, city, or both?" },
      { who: "int", text: "Browse by city, then pick a movie, then see which theatres are showing it and at what times." },
      { who: "you", text: "Once a user picks seats, how long can they hold them while paying?" },
      { who: "int", text: "Around five minutes. After that the seats go back on sale." },
      { who: "you", text: "What if two users select the same seat at the same moment?" },
      { who: "int", text: "Exactly one wins. The other gets a clear failure. Double booking is the one thing we cannot allow." },
      { who: "you", text: "Are seats all the same price?" },
      { who: "int", text: "No. Regular, premium and recliner today, and product will add more. Pricing differs per seat type." },
      { who: "you", text: "And payments? Cards only?" },
      { who: "int", text: "Cards and UPI now. Wallets and net banking will come later, so don't hard-code anything." },
      { who: "you", text: "I will keep refunds, cancellations and notifications out of scope unless you want them." },
      { who: "int", text: "Out of scope for now. Focus on the booking flow." }
    ],
    requirements: [
      {
        group: "Core",
        items: [
          "Users can search and browse movies by city and see the theatres and shows that play them.",
          "A user picks a theatre, a show and one or more seats for that show.",
          "Booking is two steps: create a booking (holds the seats), then confirm it by paying before the hold expires."
        ]
      },
      {
        group: "Concurrency",
        items: [
          "A seat can never be booked twice for the same show, even under concurrent requests and across multiple servers.",
          "Held seats that are not paid for within the hold window are released automatically."
        ]
      },
      {
        group: "Extensibility",
        items: [
          "New seat types (and their prices) can be added without changing booking logic.",
          "New payment methods can be added without changing booking logic."
        ]
      }
    ],
    entities: [
      { name: "Movie", text: "A title that can be screened. Holds name, duration, language and genre." },
      { name: "Theatre", text: "A physical venue in a city with one or more screens." },
      { name: "Screen", text: "A hall inside a theatre. Owns the permanent list of seats." },
      { name: "Seat", text: "A physical seat in a screen: row, number and type. It never changes per show." },
      { name: "Show", text: "One screening of a movie on a screen at a start time." },
      { name: "ShowSeat", text: "The availability of one Seat for one Show. This is what actually gets booked." },
      { name: "Booking", text: "A user's reservation of a set of ShowSeats with a status and an expiry." },
      { name: "Payment", text: "A charge attempt for a booking via some payment method." },
      { name: "User", text: "The person browsing and booking." }
    ],
    design: [
      {
        heading: "Requirement 1: Search and browse movies",
        text: "Keep the catalogue model boring and navigable: a Theatre owns Screens, a Screen owns Seats, a Show links a Movie to a Screen at a time. A small `MovieCatalog` service answers the two queries the UI needs: movies in a city, and shows of a movie in a city.\n\nA `Seat` is a permanent physical fact about a screen. Whether it is free tonight at 9pm is a different question, and that belongs to the show.",
        code: [
          {
            file: "Movie.java",
            body: `public class Movie {
    private final String id;
    private final String title;
    private final int durationMinutes;
    private final String language;

    public Movie(String id, String title, int durationMinutes, String language) {
        this.id = id;
        this.title = title;
        this.durationMinutes = durationMinutes;
        this.language = language;
    }

    public String getId() { return id; }
    public String getTitle() { return title; }
    public int getDurationMinutes() { return durationMinutes; }
    public String getLanguage() { return language; }
}`
          },
          {
            file: "Theatre.java",
            body: `import java.util.List;

public class Theatre {
    private final String id;
    private final String name;
    private final String city;
    private final List<Screen> screens;

    public Theatre(String id, String name, String city, List<Screen> screens) {
        this.id = id;
        this.name = name;
        this.city = city;
        this.screens = List.copyOf(screens);
    }

    public String getId() { return id; }
    public String getName() { return name; }
    public String getCity() { return city; }
    public List<Screen> getScreens() { return screens; }
}`
          },
          {
            file: "Screen.java",
            body: `import java.util.List;

public class Screen {
    private final String id;
    private final String name;
    private final List<Seat> seats;   // permanent layout

    public Screen(String id, String name, List<Seat> seats) {
        this.id = id;
        this.name = name;
        this.seats = List.copyOf(seats);
    }

    public String getId() { return id; }
    public String getName() { return name; }
    public List<Seat> getSeats() { return seats; }
}`
          },
          {
            file: "Show.java",
            body: `import java.time.LocalDateTime;

public class Show {
    private final String id;
    private final Movie movie;
    private final Screen screen;
    private final LocalDateTime startTime;

    public Show(String id, Movie movie, Screen screen, LocalDateTime startTime) {
        this.id = id;
        this.movie = movie;
        this.screen = screen;
        this.startTime = startTime;
    }

    public String getId() { return id; }
    public Movie getMovie() { return movie; }
    public Screen getScreen() { return screen; }
    public LocalDateTime getStartTime() { return startTime; }
}`
          },
          {
            file: "MovieCatalog.java",
            body: `import java.util.List;
import java.util.stream.Collectors;

public class MovieCatalog {
    private final List<Theatre> theatres;
    private final List<Show> shows;

    public MovieCatalog(List<Theatre> theatres, List<Show> shows) {
        this.theatres = theatres;
        this.shows = shows;
    }

    public List<Movie> moviesIn(String city) {
        return showsIn(city).stream()
                .map(Show::getMovie)
                .distinct()
                .collect(Collectors.toList());
    }

    public List<Show> showsOf(String movieId, String city) {
        return showsIn(city).stream()
                .filter(s -> s.getMovie().getId().equals(movieId))
                .collect(Collectors.toList());
    }

    private List<Show> showsIn(String city) {
        return shows.stream()
                .filter(s -> theatres.stream()
                        .filter(t -> t.getCity().equalsIgnoreCase(city))
                        .anyMatch(t -> t.getScreens().contains(s.getScreen())))
                .collect(Collectors.toList());
    }
}`
          }
        ],
        note: "In production this is a search index or database query, not a stream over in-memory lists. The interview cares about the shape of the model, not the query engine."
      },
      {
        heading: "Requirement 2: Pick a theatre, show and seat",
        text: "Here is the key modelling decision. **A `Seat` never gets booked, a `ShowSeat` does.** `Seat` is the physical chair and is shared by every show on that screen. `ShowSeat` is one row per (show, seat) pair carrying the status for that show only.\n\nIf you put a `booked` flag on `Seat`, booking the 6pm show would mark the chair taken for the 9pm show too.\n\nSeat types are an enum that carries the price, so pricing is a lookup rather than a branch.",
        code: [
          {
            file: "SeatType.java",
            body: `public enum SeatType {
    REGULAR(150),
    PREMIUM(250),
    RECLINER(450);

    private final int basePrice;

    SeatType(int basePrice) { this.basePrice = basePrice; }

    public int getBasePrice() { return basePrice; }
}`
          },
          {
            file: "Seat.java",
            body: `public class Seat {
    private final String id;
    private final char row;
    private final int number;
    private final SeatType type;

    public Seat(String id, char row, int number, SeatType type) {
        this.id = id;
        this.row = row;
        this.number = number;
        this.type = type;
    }

    public String getId() { return id; }
    public char getRow() { return row; }
    public int getNumber() { return number; }
    public SeatType getType() { return type; }
}`
          },
          {
            file: "ShowSeatStatus.java",
            body: `public enum ShowSeatStatus {
    AVAILABLE,
    LOCKED,
    BOOKED
}`
          },
          {
            file: "ShowSeat.java",
            body: `public class ShowSeat {
    private final String id;          // unique per (show, seat)
    private final Show show;
    private final Seat seat;
    private ShowSeatStatus status = ShowSeatStatus.AVAILABLE;

    public ShowSeat(String id, Show show, Seat seat) {
        this.id = id;
        this.show = show;
        this.seat = seat;
    }

    public String getId() { return id; }
    public Show getShow() { return show; }
    public Seat getSeat() { return seat; }
    public ShowSeatStatus getStatus() { return status; }
    public void setStatus(ShowSeatStatus status) { this.status = status; }

    public int getPrice() { return seat.getType().getBasePrice(); }
}`
          },
          {
            file: "ShowSeatRepository.java",
            body: `import java.util.List;

public interface ShowSeatRepository {
    List<ShowSeat> findByShow(String showId);
    List<ShowSeat> findAllById(List<String> showSeatIds);
    void save(ShowSeat showSeat);
}`
          }
        ],
        note: "`ShowSeatStatus` is state, but you do not need to dress it up as the State pattern. Three values and a couple of guarded transitions are enough."
      },
      {
        heading: "Requirement 3: Select seats, book, then pay",
        text: "Booking is split into two calls on purpose.\n\n**Create** validates the seats, locks them and records a `PENDING` booking with an expiry. **Confirm** charges the user, but only if the booking is still valid and the lock is still ours. A stale request therefore fails cheaply instead of charging someone for seats they no longer hold.\n\nThe booking service owns the flow. It does not know how locks or payments work, it just talks to `LockService` and `PaymentStrategy`.",
        code: [
          {
            file: "BookingStatus.java",
            body: `public enum BookingStatus {
    PENDING,
    CONFIRMED,
    EXPIRED,
    FAILED
}`
          },
          {
            file: "Booking.java",
            body: `import java.time.Instant;
import java.util.List;

public class Booking {
    private final String id;
    private final String userId;
    private final List<ShowSeat> seats;
    private final Instant expiresAt;
    private BookingStatus status = BookingStatus.PENDING;

    public Booking(String id, String userId, List<ShowSeat> seats, Instant expiresAt) {
        this.id = id;
        this.userId = userId;
        this.seats = List.copyOf(seats);
        this.expiresAt = expiresAt;
    }

    public String getId() { return id; }
    public String getUserId() { return userId; }
    public List<ShowSeat> getSeats() { return seats; }
    public Instant getExpiresAt() { return expiresAt; }
    public BookingStatus getStatus() { return status; }
    public void setStatus(BookingStatus status) { this.status = status; }

    public int totalAmount() {
        return seats.stream().mapToInt(ShowSeat::getPrice).sum();
    }

    public boolean isExpired(Instant now) { return now.isAfter(expiresAt); }
}`
          },
          {
            file: "BookingService.java",
            body: `import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public class BookingService {
    private static final Duration HOLD = Duration.ofMinutes(5);

    private final ShowSeatRepository showSeats;
    private final LockService locks;
    private final Clock clock;
    private final Map<String, Booking> bookings = new HashMap<>();

    public BookingService(ShowSeatRepository showSeats, LockService locks, Clock clock) {
        this.showSeats = showSeats;
        this.locks = locks;
        this.clock = clock;
    }

    /** Step 1: hold the seats. */
    public Booking createBooking(String userId, List<String> showSeatIds) {
        // Sort so every request acquires locks in the same global order (no deadlock).
        List<String> ordered = new ArrayList<>(showSeatIds);
        ordered.sort(Comparator.naturalOrder());

        List<String> acquired = new ArrayList<>();
        try {
            for (String id : ordered) {
                if (!locks.tryLock(id, userId, HOLD)) {
                    throw new SeatUnavailableException("Seat " + id + " is already held");
                }
                acquired.add(id);
            }

            List<ShowSeat> seats = showSeats.findAllById(ordered);
            for (ShowSeat s : seats) {
                if (s.getStatus() != ShowSeatStatus.AVAILABLE) {
                    throw new SeatUnavailableException("Seat " + s.getId() + " is not available");
                }
            }

            Booking booking = new Booking(UUID.randomUUID().toString(), userId, seats,
                    Instant.now(clock).plus(HOLD));
            for (ShowSeat s : seats) {
                s.setStatus(ShowSeatStatus.LOCKED);
                showSeats.save(s);
            }
            bookings.put(booking.getId(), booking);
            return booking;
        } catch (RuntimeException e) {
            // Roll back any locks we took before failing.
            acquired.forEach(id -> locks.unlock(id, userId));
            throw e;
        }
    }

    /** Step 2: pay. Fails cheaply if the hold is gone. */
    public Booking confirmBooking(String bookingId, PaymentStrategy payment) {
        Booking booking = bookings.get(bookingId);
        if (booking == null) throw new IllegalArgumentException("Unknown booking " + bookingId);

        if (booking.getStatus() != BookingStatus.PENDING || booking.isExpired(Instant.now(clock))) {
            release(booking, BookingStatus.EXPIRED);
            throw new BookingExpiredException("Booking " + bookingId + " is no longer valid");
        }
        for (ShowSeat s : booking.getSeats()) {
            if (!locks.isHeldBy(s.getId(), booking.getUserId())) {
                release(booking, BookingStatus.EXPIRED);
                throw new BookingExpiredException("Lost the hold on seat " + s.getId());
            }
        }

        boolean paid = payment.pay(booking.totalAmount());
        if (!paid) {
            release(booking, BookingStatus.FAILED);
            throw new PaymentFailedException("Payment declined");
        }

        for (ShowSeat s : booking.getSeats()) {
            s.setStatus(ShowSeatStatus.BOOKED);
            showSeats.save(s);
            locks.unlock(s.getId(), booking.getUserId());
        }
        booking.setStatus(BookingStatus.CONFIRMED);
        return booking;
    }

    private void release(Booking booking, BookingStatus finalStatus) {
        for (ShowSeat s : booking.getSeats()) {
            if (s.getStatus() == ShowSeatStatus.LOCKED) {
                s.setStatus(ShowSeatStatus.AVAILABLE);
                showSeats.save(s);
            }
            locks.unlock(s.getId(), booking.getUserId());
        }
        booking.setStatus(finalStatus);
    }
}`
          },
          {
            file: "Exceptions.java",
            body: `class SeatUnavailableException extends RuntimeException {
    SeatUnavailableException(String m) { super(m); }
}

class BookingExpiredException extends RuntimeException {
    BookingExpiredException(String m) { super(m); }
}

class PaymentFailedException extends RuntimeException {
    PaymentFailedException(String m) { super(m); }
}`
          }
        ],
        note: "Sorting the seat ids is a one-line change that removes a whole class of deadlocks. Two users selecting seats A1,A2 and A2,A1 would otherwise each hold one lock and wait for the other."
      },
      {
        heading: "Requirement 4: No seat can be double-booked",
        text: "Locking is a cross-cutting concern, so it gets its own interface rather than being a `synchronized` block buried in `BookingService`. Each lock has an owner and a time-to-live, which gives us automatic release when a user abandons the page.\n\nThe in-memory implementation is perfect for a single server and for tests. Swapping in Redis later is a constructor change, because the service only knows the interface.",
        code: [
          {
            file: "LockService.java",
            body: `import java.time.Duration;

public interface LockService {
    /** Atomically acquire the lock for owner. Returns false if someone else holds it. */
    boolean tryLock(String key, String owner, Duration ttl);

    /** Release only if owner still holds it. */
    void unlock(String key, String owner);

    boolean isHeldBy(String key, String owner);
}`
          },
          {
            file: "InMemoryLockService.java",
            body: `import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.concurrent.ConcurrentHashMap;

public class InMemoryLockService implements LockService {
    private static class Lock {
        final String owner;
        final Instant expiresAt;
        Lock(String owner, Instant expiresAt) { this.owner = owner; this.expiresAt = expiresAt; }
    }

    private final ConcurrentHashMap<String, Lock> locks = new ConcurrentHashMap<>();
    private final Clock clock;

    public InMemoryLockService(Clock clock) { this.clock = clock; }

    @Override
    public boolean tryLock(String key, String owner, Duration ttl) {
        Instant now = Instant.now(clock);
        Lock candidate = new Lock(owner, now.plus(ttl));
        // compute() is atomic per key: check-and-set cannot interleave.
        Lock result = locks.compute(key, (k, existing) -> {
            if (existing == null || !existing.expiresAt.isAfter(now)) return candidate;
            return existing;
        });
        return result == candidate;
    }

    @Override
    public void unlock(String key, String owner) {
        locks.computeIfPresent(key, (k, existing) -> existing.owner.equals(owner) ? null : existing);
    }

    @Override
    public boolean isHeldBy(String key, String owner) {
        Lock l = locks.get(key);
        return l != null && l.owner.equals(owner) && l.expiresAt.isAfter(Instant.now(clock));
    }
}`
          },
          {
            file: "RedisLockService.java",
            body: `import java.time.Duration;
import java.util.List;
import redis.clients.jedis.Jedis;
import redis.clients.jedis.JedisPool;
import redis.clients.jedis.params.SetParams;

public class RedisLockService implements LockService {
    // Delete only if the value still equals our owner token.
    private static final String UNLOCK_SCRIPT =
            "if redis.call('get', KEYS[1]) == ARGV[1] then " +
            "  return redis.call('del', KEYS[1]) " +
            "else return 0 end";

    private final JedisPool pool;

    public RedisLockService(JedisPool pool) { this.pool = pool; }

    @Override
    public boolean tryLock(String key, String owner, Duration ttl) {
        try (Jedis jedis = pool.getResource()) {
            // SET key owner NX PX ttl: set only if absent, with an expiry, in one atomic command.
            String reply = jedis.set("seat:" + key, owner, SetParams.setParams().nx().px(ttl.toMillis()));
            return "OK".equals(reply);
        }
    }

    @Override
    public void unlock(String key, String owner) {
        try (Jedis jedis = pool.getResource()) {
            jedis.eval(UNLOCK_SCRIPT, List.of("seat:" + key), List.of(owner));
        }
    }

    @Override
    public boolean isHeldBy(String key, String owner) {
        try (Jedis jedis = pool.getResource()) {
            return owner.equals(jedis.get("seat:" + key));
        }
    }
}`
          }
        ],
        note: "The unlock script matters. A plain DEL could remove a lock that expired and was since acquired by someone else."
      },
      {
        heading: "Requirement 5: New seat types",
        text: "Because `SeatType` is an enum that carries its own price, adding `SOFA` is a single line. There is no `if (type == PREMIUM)` anywhere to hunt down.\n\nA branch works today and becomes a liability the day product adds a fourth seat type. If prices later depend on the show (weekend surcharge, dynamic pricing), pull the price out of the enum into a `SeatPricing` lookup keyed by seat type, still without branching.",
        code: [
          {
            file: "SeatType.java",
            body: `public enum SeatType {
    REGULAR(150),
    PREMIUM(250),
    RECLINER(450),
    SOFA(600);          // new seat type: one line, nothing else changes

    private final int basePrice;

    SeatType(int basePrice) { this.basePrice = basePrice; }

    public int getBasePrice() { return basePrice; }
}`
          },
          {
            file: "SeatPricing.java",
            body: `import java.util.EnumMap;
import java.util.Map;

/** Optional: price per seat type per show, still a lookup rather than a branch. */
public class SeatPricing {
    private final Map<SeatType, Integer> prices = new EnumMap<>(SeatType.class);

    public SeatPricing(int weekendSurcharge, boolean weekend) {
        for (SeatType t : SeatType.values()) {
            prices.put(t, t.getBasePrice() + (weekend ? weekendSurcharge : 0));
        }
    }

    public int priceOf(SeatType type) { return prices.get(type); }
}`
          }
        ]
      },
      {
        heading: "Requirement 6: New payment methods",
        text: "Payment varies in exactly one way: how money is collected. That is a textbook use of **Strategy**. `BookingService.confirmBooking` takes a `PaymentStrategy` and never inspects which one it received.\n\nAdding wallets later is a new class. No existing class changes.",
        code: [
          {
            file: "PaymentStrategy.java",
            body: `public interface PaymentStrategy {
    /** Returns true if the charge succeeded. */
    boolean pay(int amount);
}`
          },
          {
            file: "CreditCardPayment.java",
            body: `public class CreditCardPayment implements PaymentStrategy {
    private final String cardNumber;
    private final String cvv;
    private final CardGateway gateway;

    public CreditCardPayment(String cardNumber, String cvv, CardGateway gateway) {
        this.cardNumber = cardNumber;
        this.cvv = cvv;
        this.gateway = gateway;
    }

    @Override
    public boolean pay(int amount) {
        return gateway.charge(cardNumber, cvv, amount);
    }
}`
          },
          {
            file: "UpiPayment.java",
            body: `public class UpiPayment implements PaymentStrategy {
    private final String vpa;
    private final UpiGateway gateway;

    public UpiPayment(String vpa, UpiGateway gateway) {
        this.vpa = vpa;
        this.gateway = gateway;
    }

    @Override
    public boolean pay(int amount) {
        return gateway.collect(vpa, amount);
    }
}`
          },
          {
            file: "Demo.java",
            body: `Clock clock = Clock.systemUTC();
LockService locks = new InMemoryLockService(clock);
BookingService service = new BookingService(showSeatRepo, locks, clock);

Booking booking = service.createBooking("user-1", List.of("show9pm-A1", "show9pm-A2"));
service.confirmBooking(booking.getId(), new UpiPayment("asha@upi", upiGateway));`
          }
        ],
        note: "Strategy earns its place here because there are already two real variants and a third is promised. Don't force a pattern in just to impress the interviewer."
      }
    ],
    deepDive: [
      {
        title: "Implementing locks across multiple servers",
        text: "**Bad: `synchronized` or a local map.** It only protects one JVM. With two app servers, both can lock seat A1 in their own memory and both sell it. The in-memory `LockService` is correct for one process and for tests, and wrong the moment you scale out.\n\n**Good: a shared lock store.** Put the lock somewhere every server can see and make acquisition atomic. Redis `SET key owner NX PX ttl` does check, set and expiry in a single command, so there is no window between \"is it free?\" and \"take it\".\n\nThree details separate a good answer from a hand-wavy one:\n\n- **TTL.** The expiry is the hold window. If a user closes the tab, Redis releases the seat on its own, with no cleanup job.\n- **Owner token.** Store who holds the lock and release with a compare-and-delete script, so a slow client cannot delete a lock that expired and was taken by someone else.\n- **The database is still the source of truth.** Redis can lose data on failover. The final write that marks a `ShowSeat` as `BOOKED` should be guarded by a database constraint (for example a unique index on show_id + seat_id in the bookings table), so even a lost lock cannot produce a double booking.",
        code: [
          {
            file: "Wiring.java",
            body: `// One-line swap, because BookingService depends on the interface.
LockService locks = new RedisLockService(new JedisPool("redis.internal", 6379));
BookingService service = new BookingService(showSeatRepo, locks, Clock.systemUTC());`
          },
          {
            file: "booked_seat.sql",
            body: `-- Last line of defence: the database refuses a second booking of the same seat for a show.
CREATE TABLE booked_seat (
    show_id     BIGINT NOT NULL,
    seat_id     BIGINT NOT NULL,
    booking_id  BIGINT NOT NULL,
    PRIMARY KEY (show_id, seat_id)
);`
          }
        ]
      },
      {
        title: "Reducing row-level contention",
        text: "A blockbuster opening night means thousands of people fight over the same few hundred `show_seat` rows. The goal is to avoid users queueing behind each other on one hot row.\n\n**Pessimistic row locking.** `SELECT ... FOR UPDATE` locks the chosen rows until the transaction ends. It is simple and correct, but a second request for the same seat blocks until the first finishes, and slow payment calls inside the transaction make that worse. Keep the transaction tiny: lock, flip status to LOCKED, commit. Never call the payment gateway while holding row locks.\n\n**`SKIP LOCKED`.** When the user does not care which seats they get (\"give me any 3 regular seats\"), skip rows other transactions already hold instead of waiting. Throughput goes up because nobody waits.\n\n**Optimistic locking is the wrong fit.** A version column plus retry assumes conflicts are rare. For a popular show conflicts are the common case, so most attempts would fail at commit time and retry, burning work and frustrating users who already filled in their details.",
        code: [
          {
            file: "pessimistic.sql",
            body: `-- Specific seats chosen by the user: wait briefly, then fail.
BEGIN;
SELECT id, status FROM show_seat
 WHERE id IN (101, 102, 103)
 ORDER BY id            -- same order everywhere: no deadlocks
   FOR UPDATE;

UPDATE show_seat SET status = 'LOCKED', locked_until = now() + interval '5 minutes'
 WHERE id IN (101, 102, 103) AND status = 'AVAILABLE';
COMMIT;`
          },
          {
            file: "skip_locked.sql",
            body: `-- "Any 3 seats": skip anything another transaction is already working on.
BEGIN;
SELECT id FROM show_seat
 WHERE show_id = 42 AND seat_type = 'REGULAR' AND status = 'AVAILABLE'
 LIMIT 3
   FOR UPDATE SKIP LOCKED;
-- mark returned rows LOCKED, then COMMIT
COMMIT;`
          },
          {
            file: "ExpiryJob.java",
            body: `import java.time.Clock;
import java.time.Instant;
import java.util.List;

/** Safety net: Redis TTLs release locks, but status columns need to follow. */
public class ExpiryJob implements Runnable {
    private final ShowSeatRepository seats;
    private final BookingStore bookings;
    private final Clock clock;

    public ExpiryJob(ShowSeatRepository seats, BookingStore bookings, Clock clock) {
        this.seats = seats;
        this.bookings = bookings;
        this.clock = clock;
    }

    @Override
    public void run() {
        List<Booking> stale = bookings.findPendingExpiredBefore(Instant.now(clock));
        for (Booking b : stale) {
            for (ShowSeat s : b.getSeats()) {
                if (s.getStatus() == ShowSeatStatus.LOCKED) {
                    s.setStatus(ShowSeatStatus.AVAILABLE);
                    seats.save(s);
                }
            }
            b.setStatus(BookingStatus.EXPIRED);
            bookings.save(b);
        }
    }
}`
          }
        ]
      }
    ],
    mistakes: [
      "Putting a `booked` flag on `Seat`. That blocks the seat for every show on the screen; availability belongs on `ShowSeat`.",
      "Locking seats in whatever order the user sent them, which deadlocks when two users pick overlapping seats in opposite orders.",
      "Using `synchronized` or an in-process map and calling it done, which breaks the moment there are two servers.",
      "Charging the card first and checking the lock afterwards, so a stale request takes money for seats the user no longer holds.",
      "Holding database row locks while calling the payment gateway.",
      "No expiry on locks, so abandoned carts keep seats unsellable forever.",
      "Forcing a pattern in. Strategy is justified for payments because there are real variants; State, Observer and Factory here would be decoration. Design patterns are good to have, but don't force one in just to impress the interviewer."
    ],
    followups: [
      "How would you support cancellations and refunds without freeing seats too early?",
      "How would you send confirmation emails and SMS once a booking is confirmed?",
      "How would you let users pick any available seats together (adjacent seats) rather than specific ones?",
      "How would you protect the system when a very popular show goes on sale and a million users arrive at once (waiting room, rate limiting)?",
      "What happens if the payment succeeds but the server crashes before marking seats BOOKED?"
    ],
    patterns: ["strategy", "state", "observer"]
  },

  /* ------------------------------------------------------------------ */
  {
    id: "online-auction-system",
    name: "Design Online Auction System",
    difficulty: "hard",
    understanding: "Sellers list items with a starting price and an end time, buyers place increasing bids, and when the clock runs out the highest valid bid wins. The tricky parts are accepting bids correctly under concurrency (only one can be the new highest), enforcing flexible bidding rules, and closing the auction exactly once.",
    dialogue: [
      { who: "you", text: "What kinds of auctions do we support? Just the classic ascending-price English auction?" },
      { who: "int", text: "English auctions to start. We may add others later, so keep that in mind." },
      { who: "you", text: "Is there a reserve price, a price below which the seller will not sell?" },
      { who: "int", text: "Yes, optional. If the top bid is below the reserve, the item does not sell." },
      { who: "you", text: "How much must a new bid exceed the current one by?" },
      { who: "int", text: "There is a minimum increment, set per auction." },
      { who: "you", text: "What about last-second bidding? Does the auction end at a hard deadline?" },
      { who: "int", text: "Keep a hard deadline for now. Anti-sniping extensions might come later." },
      { who: "you", text: "Should bidders be notified when they are outbid or when the auction ends?" },
      { who: "int", text: "Yes. Bidders and the seller should hear about relevant events." },
      { who: "you", text: "Can a seller bid on their own item?" },
      { who: "int", text: "No. That is an obvious abuse." },
      { who: "you", text: "I will assume payment and shipping happen after the auction and are out of scope." },
      { who: "int", text: "Agreed. Stop at determining the winner." }
    ],
    requirements: [
      {
        group: "Core",
        items: [
          "Sellers create auctions for an item with a start price, optional reserve price, minimum bid increment and an end time.",
          "Buyers place bids; a bid is valid only if it beats the current highest bid by at least the increment and the auction is open.",
          "Sellers cannot bid on their own auctions.",
          "When the end time passes the auction closes; the highest bid wins if it meets the reserve, otherwise the item goes unsold."
        ]
      },
      {
        group: "Concurrency",
        items: [
          "Concurrent bids on the same auction are serialised so exactly one becomes the new highest, and the history never shows a lower bid after a higher one.",
          "An auction closes exactly once, even if the close job runs twice or races with a last bid."
        ]
      },
      {
        group: "Extensibility",
        items: [
          "Bid validation rules can change (new auction types, anti-sniping) without rewriting the auction class.",
          "Notification channels and recipients can change without touching auction logic."
        ]
      }
    ],
    entities: [
      { name: "User", text: "A person who can act as seller, bidder or both." },
      { name: "Item", text: "The thing being sold: title, description, seller." },
      { name: "Auction", text: "A listing of an item with rules, a status and its bids." },
      { name: "Bid", text: "An amount offered by a bidder at a point in time." },
      { name: "AuctionStatus", text: "SCHEDULED, ACTIVE, CLOSED or CANCELLED." },
      { name: "BidRule", text: "A validation rule a new bid must satisfy." },
      { name: "AuctionListener", text: "Receives events such as outbid and auction closed." },
      { name: "AuctionService", text: "Entry point: create auctions, place bids, close auctions." }
    ],
    design: [
      {
        heading: "Requirement 1: Create an auction",
        text: "An `Auction` owns its rules and its bid history. Money is stored as integer minor units (cents) to avoid floating-point drift.\n\nStatus is derived from the clock and an explicit closed flag, so creating a scheduled auction does not need a background job just to flip it to active.",
        code: [
          {
            file: "Item.java",
            body: `public class Item {
    private final String id;
    private final String title;
    private final String description;
    private final User seller;

    public Item(String id, String title, String description, User seller) {
        this.id = id;
        this.title = title;
        this.description = description;
        this.seller = seller;
    }

    public String getId() { return id; }
    public String getTitle() { return title; }
    public User getSeller() { return seller; }
}`
          },
          {
            file: "User.java",
            body: `public class User {
    private final String id;
    private final String name;

    public User(String id, String name) {
        this.id = id;
        this.name = name;
    }

    public String getId() { return id; }
    public String getName() { return name; }
}`
          },
          {
            file: "AuctionStatus.java",
            body: `public enum AuctionStatus {
    SCHEDULED,
    ACTIVE,
    CLOSED,
    CANCELLED
}`
          },
          {
            file: "Auction.java",
            body: `import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Optional;

public class Auction {
    private final String id;
    private final Item item;
    private final long startPrice;          // minor units
    private final Long reservePrice;        // nullable
    private final long minIncrement;
    private final Instant startsAt;
    private final Instant endsAt;
    private final List<Bid> bids = new ArrayList<>();
    private AuctionStatus status = AuctionStatus.SCHEDULED;
    private Bid winningBid;

    public Auction(String id, Item item, long startPrice, Long reservePrice,
                   long minIncrement, Instant startsAt, Instant endsAt) {
        this.id = id;
        this.item = item;
        this.startPrice = startPrice;
        this.reservePrice = reservePrice;
        this.minIncrement = minIncrement;
        this.startsAt = startsAt;
        this.endsAt = endsAt;
    }

    public String getId() { return id; }
    public Item getItem() { return item; }
    public long getStartPrice() { return startPrice; }
    public Optional<Long> getReservePrice() { return Optional.ofNullable(reservePrice); }
    public long getMinIncrement() { return minIncrement; }
    public Instant getStartsAt() { return startsAt; }
    public Instant getEndsAt() { return endsAt; }
    public AuctionStatus getStatus() { return status; }
    public Optional<Bid> getWinningBid() { return Optional.ofNullable(winningBid); }
    public List<Bid> getBids() { return Collections.unmodifiableList(bids); }

    public Optional<Bid> highestBid() {
        return bids.isEmpty() ? Optional.empty() : Optional.of(bids.get(bids.size() - 1));
    }

    /** Smallest amount the next bid must reach. */
    public long minimumNextBid() {
        return highestBid().map(b -> b.getAmount() + minIncrement).orElse(startPrice);
    }

    // Package-private mutators: only AuctionService changes state.
    void addBid(Bid bid) { bids.add(bid); }
    void setStatus(AuctionStatus status) { this.status = status; }
    void setWinningBid(Bid bid) { this.winningBid = bid; }

    public boolean isOpenAt(Instant now) {
        return status != AuctionStatus.CLOSED
                && status != AuctionStatus.CANCELLED
                && !now.isBefore(startsAt)
                && now.isBefore(endsAt);
    }
}`
          },
          {
            file: "Bid.java",
            body: `import java.time.Instant;

public class Bid {
    private final String id;
    private final User bidder;
    private final long amount;
    private final Instant placedAt;

    public Bid(String id, User bidder, long amount, Instant placedAt) {
        this.id = id;
        this.bidder = bidder;
        this.amount = amount;
        this.placedAt = placedAt;
    }

    public String getId() { return id; }
    public User getBidder() { return bidder; }
    public long getAmount() { return amount; }
    public Instant getPlacedAt() { return placedAt; }
}`
          }
        ]
      },
      {
        heading: "Requirement 2 and 3: Validate and place a bid",
        text: "Each rule a bid must satisfy is its own small object behind a `BidRule` interface: auction is open, bidder is not the seller, amount meets the minimum. The service runs them in order. Adding a rule is adding a class; the auction itself stays a plain data holder.\n\nThe placement itself is a critical section per auction. The service keeps one lock per auction id, so bids on different auctions never wait for each other, while bids on the same one are strictly ordered.",
        code: [
          {
            file: "BidRule.java",
            body: `import java.time.Instant;

public interface BidRule {
    /** Throw InvalidBidException if the bid breaks this rule. */
    void check(Auction auction, User bidder, long amount, Instant now);
}`
          },
          {
            file: "Rules.java",
            body: `import java.time.Instant;

class AuctionOpenRule implements BidRule {
    public void check(Auction a, User bidder, long amount, Instant now) {
        if (!a.isOpenAt(now)) throw new InvalidBidException("Auction is not open for bidding");
    }
}

class NotSellerRule implements BidRule {
    public void check(Auction a, User bidder, long amount, Instant now) {
        if (a.getItem().getSeller().getId().equals(bidder.getId())) {
            throw new InvalidBidException("Sellers cannot bid on their own item");
        }
    }
}

class MinimumIncrementRule implements BidRule {
    public void check(Auction a, User bidder, long amount, Instant now) {
        if (amount < a.minimumNextBid()) {
            throw new InvalidBidException("Bid must be at least " + a.minimumNextBid());
        }
    }
}

class InvalidBidException extends RuntimeException {
    InvalidBidException(String message) { super(message); }
}`
          },
          {
            file: "AuctionService.java",
            body: `import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.locks.ReentrantLock;

public class AuctionService {
    private final Map<String, Auction> auctions = new ConcurrentHashMap<>();
    private final Map<String, ReentrantLock> locks = new ConcurrentHashMap<>();
    private final List<BidRule> rules;
    private final AuctionEvents events;
    private final Clock clock;

    public AuctionService(List<BidRule> rules, AuctionEvents events, Clock clock) {
        this.rules = rules;
        this.events = events;
        this.clock = clock;
    }

    public Auction create(Auction auction) {
        auctions.put(auction.getId(), auction);
        auction.setStatus(AuctionStatus.ACTIVE);
        return auction;
    }

    public Bid placeBid(String auctionId, User bidder, long amount) {
        Auction auction = require(auctionId);
        ReentrantLock lock = locks.computeIfAbsent(auctionId, k -> new ReentrantLock());
        lock.lock();
        try {
            Instant now = Instant.now(clock);
            for (BidRule rule : rules) rule.check(auction, bidder, amount, now);

            Optional<Bid> previous = auction.highestBid();
            Bid bid = new Bid(UUID.randomUUID().toString(), bidder, amount, now);
            auction.addBid(bid);

            previous.ifPresent(p -> events.outbid(auction, p.getBidder(), bid));
            return bid;
        } finally {
            lock.unlock();
        }
    }

    private Auction require(String id) {
        Auction a = auctions.get(id);
        if (a == null) throw new IllegalArgumentException("Unknown auction " + id);
        return a;
    }

    public Auction get(String id) { return require(id); }

    List<Auction> all() { return List.copyOf(auctions.values()); }

    Optional<ReentrantLock> lockFor(String id) { return Optional.of(locks.computeIfAbsent(id, k -> new ReentrantLock())); }
}`
          }
        ],
        note: "Checking the minimum inside the lock is the point. If validation ran before taking the lock, two bidders could both pass it against the same current price."
      },
      {
        heading: "Requirement 4: Close the auction and pick a winner",
        text: "Closing is idempotent. A scheduler calls `closeIfDue` for each auction; the method takes the same per-auction lock as bidding, so a last-millisecond bid and the close cannot interleave. If the status is already `CLOSED` it simply returns.\n\nWinner logic is small: take the highest bid, and if a reserve exists and it was not met, there is no winner.",
        code: [
          {
            file: "AuctionCloser.java",
            body: `import java.time.Clock;
import java.time.Instant;
import java.util.Optional;
import java.util.concurrent.locks.ReentrantLock;

public class AuctionCloser {
    private final AuctionService service;
    private final AuctionEvents events;
    private final Clock clock;

    public AuctionCloser(AuctionService service, AuctionEvents events, Clock clock) {
        this.service = service;
        this.events = events;
        this.clock = clock;
    }

    /** Safe to call repeatedly and from several threads. */
    public void closeIfDue(String auctionId) {
        Auction auction = service.get(auctionId);
        ReentrantLock lock = service.lockFor(auctionId).orElseThrow();
        lock.lock();
        try {
            if (auction.getStatus() == AuctionStatus.CLOSED
                    || auction.getStatus() == AuctionStatus.CANCELLED) return;
            if (Instant.now(clock).isBefore(auction.getEndsAt())) return;

            Optional<Bid> top = auction.highestBid();
            boolean reserveMet = auction.getReservePrice()
                    .map(r -> top.isPresent() && top.get().getAmount() >= r)
                    .orElse(top.isPresent());

            auction.setStatus(AuctionStatus.CLOSED);
            if (reserveMet) {
                auction.setWinningBid(top.get());
                events.won(auction, top.get());
            } else {
                events.unsold(auction);
            }
        } finally {
            lock.unlock();
        }
    }
}`
          },
          {
            file: "AuctionScheduler.java",
            body: `import java.time.Duration;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

public class AuctionScheduler {
    private final ScheduledExecutorService pool = Executors.newSingleThreadScheduledExecutor();

    public void start(AuctionService service, AuctionCloser closer, Duration every) {
        pool.scheduleAtFixedRate(() -> {
            for (Auction a : service.all()) closer.closeIfDue(a.getId());
        }, every.toMillis(), every.toMillis(), TimeUnit.MILLISECONDS);
    }

    public void stop() { pool.shutdown(); }
}`
          }
        ]
      },
      {
        heading: "Requirement 5: Notify bidders and sellers",
        text: "Auction logic should not know how users are told. It publishes events to an `AuctionEvents` fan-out, and each listener decides what to do. This is **Observer**: email, push or a websocket channel can be added by registering another listener.",
        code: [
          {
            file: "AuctionListener.java",
            body: `public interface AuctionListener {
    void onOutbid(Auction auction, User previousHighBidder, Bid newBid);
    void onWon(Auction auction, Bid winningBid);
    void onUnsold(Auction auction);
}`
          },
          {
            file: "AuctionEvents.java",
            body: `import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

public class AuctionEvents {
    private final List<AuctionListener> listeners = new CopyOnWriteArrayList<>();

    public void register(AuctionListener l) { listeners.add(l); }

    public void outbid(Auction a, User previous, Bid newBid) {
        for (AuctionListener l : listeners) l.onOutbid(a, previous, newBid);
    }
    public void won(Auction a, Bid bid) {
        for (AuctionListener l : listeners) l.onWon(a, bid);
    }
    public void unsold(Auction a) {
        for (AuctionListener l : listeners) l.onUnsold(a);
    }
}`
          },
          {
            file: "EmailNotifier.java",
            body: `public class EmailNotifier implements AuctionListener {
    private final EmailClient email;

    public EmailNotifier(EmailClient email) { this.email = email; }

    @Override
    public void onOutbid(Auction a, User previous, Bid newBid) {
        email.send(previous, "You were outbid on " + a.getItem().getTitle()
                + ". New high bid: " + newBid.getAmount());
    }

    @Override
    public void onWon(Auction a, Bid bid) {
        email.send(bid.getBidder(), "You won " + a.getItem().getTitle());
        email.send(a.getItem().getSeller(), a.getItem().getTitle() + " sold for " + bid.getAmount());
    }

    @Override
    public void onUnsold(Auction a) {
        email.send(a.getItem().getSeller(), a.getItem().getTitle() + " did not sell");
    }
}`
          }
        ],
        note: "Listener calls run inside the auction lock in this sketch. In production, publish to a queue and deliver asynchronously so a slow email provider can never slow down bidding."
      }
    ],
    deepDive: [
      {
        title: "Serialising bids without a global lock",
        text: "A single global lock would make every auction wait on every other. A lock per auction id keeps contention local to the item people are actually fighting over, and it scales with the number of auctions.\n\nOn multiple servers an in-process lock stops working. Two options: route all bids for an auction to the same server (consistent hashing on auction id), or move the compare-and-set into the database: `UPDATE auction SET highest_bid = :amount, version = version + 1 WHERE id = :id AND highest_bid + min_increment <= :amount`. The statement either affects one row (bid accepted) or zero (someone beat you), which is atomic without explicit locks.",
        code: [
          {
            file: "place_bid.sql",
            body: `-- Atomic accept: only succeeds if the bid still beats the current highest bid.
UPDATE auction
   SET highest_bid = :amount,
       highest_bidder_id = :bidder
 WHERE id = :auctionId
   AND status = 'ACTIVE'
   AND ends_at > now()
   AND :amount >= COALESCE(highest_bid + min_increment, start_price);
-- rows affected = 1 -> accepted and insert into bid history; 0 -> rejected`
          }
        ]
      },
      {
        title: "Different auction types: Strategy for the winning rule",
        text: "English auctions pick the highest bid. A sealed-bid second-price (Vickrey) auction picks the highest bid but charges the second-highest. A Dutch auction lowers the price until someone accepts. The part that varies is how bids are accepted and how the winner and price are determined, which fits **Strategy**.\n\nOnly introduce this once a second auction type is real. Until then `AuctionCloser` as written is the simplest correct design.",
        code: [
          {
            file: "WinnerPolicy.java",
            body: `import java.util.List;
import java.util.Optional;

public interface WinnerPolicy {
    Optional<Settlement> decide(Auction auction, List<Bid> bids);

    record Settlement(Bid winner, long price) {}
}

class HighestBidWins implements WinnerPolicy {
    public Optional<Settlement> decide(Auction a, List<Bid> bids) {
        return bids.stream()
                .max(java.util.Comparator.comparingLong(Bid::getAmount))
                .map(b -> new Settlement(b, b.getAmount()));
    }
}

class SecondPriceWins implements WinnerPolicy {
    public Optional<Settlement> decide(Auction a, List<Bid> bids) {
        List<Bid> sorted = bids.stream()
                .sorted(java.util.Comparator.comparingLong(Bid::getAmount).reversed())
                .toList();
        if (sorted.isEmpty()) return Optional.empty();
        long price = sorted.size() > 1 ? sorted.get(1).getAmount() : a.getStartPrice();
        return Optional.of(new Settlement(sorted.get(0), price));
    }
}`
          }
        ]
      },
      {
        title: "Anti-sniping extensions",
        text: "A common product rule: if a valid bid arrives in the last two minutes, extend the end time by two minutes. Because validation and state change are already inside the per-auction critical section, this is one extra step after accepting the bid. Make the extension a rule-like collaborator (`ClosingPolicy`) so the base auction class never learns about it.",
        code: [
          {
            file: "ClosingPolicy.java",
            body: `import java.time.Duration;
import java.time.Instant;

public interface ClosingPolicy {
    Instant endTimeAfterBid(Auction auction, Instant bidTime);
}

class HardDeadline implements ClosingPolicy {
    public Instant endTimeAfterBid(Auction a, Instant bidTime) { return a.getEndsAt(); }
}

class ExtendOnLateBid implements ClosingPolicy {
    private final Duration window = Duration.ofMinutes(2);

    public Instant endTimeAfterBid(Auction a, Instant bidTime) {
        boolean late = bidTime.isAfter(a.getEndsAt().minus(window));
        return late ? bidTime.plus(window) : a.getEndsAt();
    }
}`
          }
        ]
      }
    ],
    mistakes: [
      "Validating the bid outside the lock, so two bids pass against the same stale highest price.",
      "Using floating point for money instead of integer minor units.",
      "Closing the auction from a timer without protecting against double execution or racing with a final bid.",
      "Trusting the client clock or the order requests arrive in; use server time inside the critical section.",
      "One global lock for all auctions, which turns a busy auction into a platform-wide slowdown.",
      "Sending notifications synchronously inside the bid path.",
      "Forcing a pattern in. Observer is justified by multiple notification channels; wrapping a one-line check in a Chain of Responsibility is not. Design patterns are good to have, but don't force one in just to impress the interviewer."
    ],
    followups: [
      "How would you add proxy (auto) bidding, where a user sets a maximum and the system bids for them?",
      "How would you scale to a million concurrent auctions across many servers?",
      "How would you prevent bid shilling (a seller's accomplice inflating the price)?",
      "How would you store and display bid history efficiently for a very popular item?",
      "How would you handle a winner who never pays?"
    ],
    patterns: ["observer", "strategy", "state"]
  },

  /* ------------------------------------------------------------------ */
  {
    id: "online-food-delivery",
    name: "Design Online Food Delivery Service",
    difficulty: "hard",
    understanding: "Customers browse restaurants, build a cart, place an order and track it until a delivery partner brings it to them. The design centres on an order that moves through a well-defined lifecycle, on keeping cart and menu pricing consistent, and on assigning drivers in a way that can change without rewriting the order flow.",
    dialogue: [
      { who: "you", text: "Is this a marketplace with many restaurants, or one chain?" },
      { who: "int", text: "A marketplace. Many restaurants, each with its own menu." },
      { who: "you", text: "Can a customer order from several restaurants in one order?" },
      { who: "int", text: "No. One restaurant per order. Keep it simple." },
      { who: "you", text: "What should a customer be able to see about their order after placing it?" },
      { who: "int", text: "Live status: placed, accepted, being prepared, out for delivery, delivered." },
      { who: "you", text: "Can the restaurant reject an order, and can the customer cancel?" },
      { who: "int", text: "Restaurants can reject. Customers can cancel until the restaurant starts preparing." },
      { who: "you", text: "How are delivery partners assigned?" },
      { who: "int", text: "Nearest available partner for now. We might later weigh rating or load." },
      { who: "you", text: "How is the price built? Item prices plus delivery fee plus taxes?" },
      { who: "int", text: "Item prices, a delivery fee, tax, and sometimes a discount code." },
      { who: "you", text: "And payment?" },
      { who: "int", text: "Assume it succeeds; focus on the order and delivery logic." },
      { who: "you", text: "Two orders racing for the same delivery partner, how serious is that?" },
      { who: "int", text: "Serious. A partner can carry only one order at a time." }
    ],
    requirements: [
      {
        group: "Core",
        items: [
          "Customers can browse restaurants and menus and add items from one restaurant to a cart.",
          "Placing an order snapshots the cart with prices and computes a total (items, delivery fee, tax, discount).",
          "An order moves through PLACED, ACCEPTED, PREPARING, OUT_FOR_DELIVERY, DELIVERED, with REJECTED and CANCELLED as exits; illegal transitions are refused.",
          "Customers and restaurants can follow the order's status."
        ]
      },
      {
        group: "Concurrency",
        items: [
          "A delivery partner is assigned to at most one active order at a time, even when several orders are looking for a partner simultaneously."
        ]
      },
      {
        group: "Extensibility",
        items: [
          "Partner assignment logic can change (nearest, highest rated, least loaded) without touching the order flow.",
          "Pricing components such as discounts, surge fees and taxes can be added without editing existing ones."
        ]
      }
    ],
    entities: [
      { name: "Customer", text: "Places orders; has addresses and a location." },
      { name: "Restaurant", text: "Owns a menu and accepts or rejects orders." },
      { name: "MenuItem", text: "A dish with a name and a price." },
      { name: "Cart", text: "A customer's in-progress selection from a single restaurant." },
      { name: "Order", text: "A placed order: line items snapshot, totals, status and assigned partner." },
      { name: "OrderItem", text: "A line in an order that copies the name and price at order time." },
      { name: "DeliveryPartner", text: "A courier with a location and an availability flag." },
      { name: "OrderStatus", text: "The lifecycle states of an order." },
      { name: "DeliveryAssignmentStrategy", text: "Chooses which available partner gets an order." },
      { name: "PriceComponent", text: "One contribution to the final total." }
    ],
    design: [
      {
        heading: "Requirement 1: Browse and build a cart",
        text: "Menus are plain data. The only rule worth encoding is that a cart belongs to one restaurant: adding an item from another restaurant is rejected rather than silently clearing the cart.\n\nOrders must not point at live menu items for prices. A restaurant can change a price after the order is placed, and the customer's receipt must not change. So the order copies name and price into `OrderItem` at placement time.",
        code: [
          {
            file: "MenuItem.java",
            body: `public class MenuItem {
    private final String id;
    private final String name;
    private final long price;      // minor units
    private boolean available = true;

    public MenuItem(String id, String name, long price) {
        this.id = id;
        this.name = name;
        this.price = price;
    }

    public String getId() { return id; }
    public String getName() { return name; }
    public long getPrice() { return price; }
    public boolean isAvailable() { return available; }
    public void setAvailable(boolean available) { this.available = available; }
}`
          },
          {
            file: "Restaurant.java",
            body: `import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;

public class Restaurant {
    private final String id;
    private final String name;
    private final Location location;
    private final Map<String, MenuItem> menu = new LinkedHashMap<>();

    public Restaurant(String id, String name, Location location) {
        this.id = id;
        this.name = name;
        this.location = location;
    }

    public void addItem(MenuItem item) { menu.put(item.getId(), item); }
    public Optional<MenuItem> find(String itemId) { return Optional.ofNullable(menu.get(itemId)); }

    public String getId() { return id; }
    public String getName() { return name; }
    public Location getLocation() { return location; }
    public Map<String, MenuItem> getMenu() { return menu; }
}`
          },
          {
            file: "Location.java",
            body: `public class Location {
    private final double lat;
    private final double lng;

    public Location(double lat, double lng) {
        this.lat = lat;
        this.lng = lng;
    }

    public double distanceTo(Location other) {
        // Equirectangular approximation: plenty for ranking nearby partners.
        double x = Math.toRadians(other.lng - lng) * Math.cos(Math.toRadians((lat + other.lat) / 2));
        double y = Math.toRadians(other.lat - lat);
        return Math.sqrt(x * x + y * y) * 6371.0;   // kilometres
    }

    public double getLat() { return lat; }
    public double getLng() { return lng; }
}`
          },
          {
            file: "Cart.java",
            body: `import java.util.LinkedHashMap;
import java.util.Map;

public class Cart {
    private final Customer customer;
    private Restaurant restaurant;
    private final Map<MenuItem, Integer> lines = new LinkedHashMap<>();

    public Cart(Customer customer) { this.customer = customer; }

    public void add(Restaurant from, MenuItem item, int quantity) {
        if (restaurant != null && !restaurant.getId().equals(from.getId())) {
            throw new IllegalStateException("A cart can only hold items from one restaurant");
        }
        if (!item.isAvailable()) throw new IllegalStateException(item.getName() + " is unavailable");
        restaurant = from;
        lines.merge(item, quantity, Integer::sum);
    }

    public Customer getCustomer() { return customer; }
    public Restaurant getRestaurant() { return restaurant; }
    public Map<MenuItem, Integer> getLines() { return lines; }
    public boolean isEmpty() { return lines.isEmpty(); }
}`
          },
          {
            file: "Customer.java",
            body: `public class Customer {
    private final String id;
    private final String name;
    private Location location;

    public Customer(String id, String name, Location location) {
        this.id = id;
        this.name = name;
        this.location = location;
    }

    public String getId() { return id; }
    public String getName() { return name; }
    public Location getLocation() { return location; }
}`
          }
        ]
      },
      {
        heading: "Requirement 2: Price the order",
        text: "The total is a sum of independent contributions: item subtotal, delivery fee, tax, and an optional discount. Instead of one method full of conditionals, each contribution is a `PriceComponent` and the calculator sums them. A new surge fee is a new class added to the list.\n\nThis is a lightweight **Strategy**: each component encapsulates one pricing rule.",
        code: [
          {
            file: "PriceComponent.java",
            body: `public interface PriceComponent {
    String label();
    /** Positive adds to the total, negative reduces it. */
    long amount(Order order);
}`
          },
          {
            file: "Components.java",
            body: `class ItemSubtotal implements PriceComponent {
    public String label() { return "Items"; }
    public long amount(Order o) {
        return o.getItems().stream().mapToLong(i -> i.getUnitPrice() * i.getQuantity()).sum();
    }
}

class DeliveryFee implements PriceComponent {
    private final long perKm;
    private final long base;

    DeliveryFee(long base, long perKm) { this.base = base; this.perKm = perKm; }

    public String label() { return "Delivery"; }
    public long amount(Order o) {
        double km = o.getRestaurant().getLocation().distanceTo(o.getCustomer().getLocation());
        return base + Math.round(km * perKm);
    }
}

class Tax implements PriceComponent {
    private final int percent;
    Tax(int percent) { this.percent = percent; }
    public String label() { return "Tax"; }
    public long amount(Order o) {
        long subtotal = o.getItems().stream().mapToLong(i -> i.getUnitPrice() * i.getQuantity()).sum();
        return subtotal * percent / 100;
    }
}

class PercentDiscount implements PriceComponent {
    private final int percent;
    PercentDiscount(int percent) { this.percent = percent; }
    public String label() { return "Discount"; }
    public long amount(Order o) {
        long subtotal = o.getItems().stream().mapToLong(i -> i.getUnitPrice() * i.getQuantity()).sum();
        return -(subtotal * percent / 100);
    }
}`
          },
          {
            file: "PriceCalculator.java",
            body: `import java.util.List;

public class PriceCalculator {
    private final List<PriceComponent> components;

    public PriceCalculator(List<PriceComponent> components) {
        this.components = List.copyOf(components);
    }

    public long total(Order order) {
        return components.stream().mapToLong(c -> c.amount(order)).sum();
    }
}`
          }
        ]
      },
      {
        heading: "Requirement 3: The order lifecycle",
        text: "An order is a small state machine, and the interesting question is who is allowed to move it. A customer can cancel only before preparation; a restaurant can accept, reject and start preparing; a partner picks up and delivers.\n\nThe simplest robust way is an enum that knows its legal next states. The order refuses anything else. If each state started carrying different behaviour (not just different permissions), promote it to the full **State** pattern; for pure transition rules the enum is enough.",
        code: [
          {
            file: "OrderStatus.java",
            body: `import java.util.EnumSet;
import java.util.Set;

public enum OrderStatus {
    PLACED,
    ACCEPTED,
    PREPARING,
    OUT_FOR_DELIVERY,
    DELIVERED,
    REJECTED,
    CANCELLED;

    private Set<OrderStatus> next;

    static {
        PLACED.next = EnumSet.of(ACCEPTED, REJECTED, CANCELLED);
        ACCEPTED.next = EnumSet.of(PREPARING, CANCELLED);
        PREPARING.next = EnumSet.of(OUT_FOR_DELIVERY);
        OUT_FOR_DELIVERY.next = EnumSet.of(DELIVERED);
        DELIVERED.next = EnumSet.noneOf(OrderStatus.class);
        REJECTED.next = EnumSet.noneOf(OrderStatus.class);
        CANCELLED.next = EnumSet.noneOf(OrderStatus.class);
    }

    public boolean canMoveTo(OrderStatus target) { return next.contains(target); }
}`
          },
          {
            file: "OrderItem.java",
            body: `public class OrderItem {
    private final String name;
    private final long unitPrice;
    private final int quantity;

    public OrderItem(String name, long unitPrice, int quantity) {
        this.name = name;
        this.unitPrice = unitPrice;
        this.quantity = quantity;
    }

    public String getName() { return name; }
    public long getUnitPrice() { return unitPrice; }
    public int getQuantity() { return quantity; }
}`
          },
          {
            file: "Order.java",
            body: `import java.util.List;

public class Order {
    private final String id;
    private final Customer customer;
    private final Restaurant restaurant;
    private final List<OrderItem> items;
    private OrderStatus status = OrderStatus.PLACED;
    private DeliveryPartner partner;
    private long total;
    private final OrderEvents events;

    public Order(String id, Customer customer, Restaurant restaurant,
                 List<OrderItem> items, OrderEvents events) {
        this.id = id;
        this.customer = customer;
        this.restaurant = restaurant;
        this.items = List.copyOf(items);
        this.events = events;
    }

    public synchronized void moveTo(OrderStatus target) {
        if (!status.canMoveTo(target)) {
            throw new IllegalStateException("Cannot go from " + status + " to " + target);
        }
        OrderStatus old = status;
        status = target;
        events.statusChanged(this, old, target);
    }

    public String getId() { return id; }
    public Customer getCustomer() { return customer; }
    public Restaurant getRestaurant() { return restaurant; }
    public List<OrderItem> getItems() { return items; }
    public synchronized OrderStatus getStatus() { return status; }
    public DeliveryPartner getPartner() { return partner; }
    public void setPartner(DeliveryPartner partner) { this.partner = partner; }
    public long getTotal() { return total; }
    public void setTotal(long total) { this.total = total; }
}`
          },
          {
            file: "OrderService.java",
            body: `import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

public class OrderService {
    private final PriceCalculator pricing;
    private final OrderEvents events;
    private final Map<String, Order> orders = new HashMap<>();

    public OrderService(PriceCalculator pricing, OrderEvents events) {
        this.pricing = pricing;
        this.events = events;
    }

    public Order place(Cart cart) {
        if (cart.isEmpty()) throw new IllegalStateException("Cart is empty");

        // Snapshot name and price now; later menu edits must not change this order.
        List<OrderItem> items = cart.getLines().entrySet().stream()
                .map(e -> new OrderItem(e.getKey().getName(), e.getKey().getPrice(), e.getValue()))
                .collect(Collectors.toList());

        Order order = new Order(UUID.randomUUID().toString(), cart.getCustomer(),
                cart.getRestaurant(), items, events);
        order.setTotal(pricing.total(order));
        orders.put(order.getId(), order);
        events.statusChanged(order, null, OrderStatus.PLACED);
        return order;
    }

    public void restaurantAccepts(String orderId) { get(orderId).moveTo(OrderStatus.ACCEPTED); }
    public void restaurantRejects(String orderId) { get(orderId).moveTo(OrderStatus.REJECTED); }
    public void startPreparing(String orderId) { get(orderId).moveTo(OrderStatus.PREPARING); }
    public void cancel(String orderId) { get(orderId).moveTo(OrderStatus.CANCELLED); }
    public void pickedUp(String orderId) { get(orderId).moveTo(OrderStatus.OUT_FOR_DELIVERY); }
    public void delivered(String orderId) { get(orderId).moveTo(OrderStatus.DELIVERED); }

    public Order get(String id) {
        Order o = orders.get(id);
        if (o == null) throw new IllegalArgumentException("Unknown order " + id);
        return o;
    }
}`
          }
        ]
      },
      {
        heading: "Requirement 4: Track status with observers",
        text: "Customers, restaurants and delivery partners all care when an order changes. The order publishes status changes to listeners, and each listener decides what to do: push a notification, update a dashboard, ping a driver. Order code never changes when a new subscriber appears. This is **Observer**.",
        code: [
          {
            file: "OrderListener.java",
            body: `public interface OrderListener {
    void onStatusChanged(Order order, OrderStatus from, OrderStatus to);
}`
          },
          {
            file: "OrderEvents.java",
            body: `import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

public class OrderEvents {
    private final List<OrderListener> listeners = new CopyOnWriteArrayList<>();

    public void subscribe(OrderListener l) { listeners.add(l); }

    public void statusChanged(Order order, OrderStatus from, OrderStatus to) {
        for (OrderListener l : listeners) l.onStatusChanged(order, from, to);
    }
}`
          },
          {
            file: "CustomerPushNotifier.java",
            body: `public class CustomerPushNotifier implements OrderListener {
    private final PushClient push;

    public CustomerPushNotifier(PushClient push) { this.push = push; }

    @Override
    public void onStatusChanged(Order order, OrderStatus from, OrderStatus to) {
        String message = switch (to) {
            case ACCEPTED -> "Your order was accepted";
            case PREPARING -> "The kitchen is preparing your food";
            case OUT_FOR_DELIVERY -> "Your food is on its way";
            case DELIVERED -> "Delivered. Enjoy!";
            case REJECTED -> "Sorry, the restaurant could not take your order";
            case CANCELLED -> "Your order was cancelled";
            default -> null;
        };
        if (message != null) push.send(order.getCustomer().getId(), message);
    }
}`
          }
        ]
      },
      {
        heading: "Requirement 5: Assign a delivery partner",
        text: "How a partner is picked is the part product will keep changing, so it sits behind `DeliveryAssignmentStrategy`. The first implementation picks the nearest free partner to the restaurant.\n\nConcurrency matters here: two orders must not claim the same partner. Claiming is a single atomic check-and-set on the partner (`tryReserve`), and the dispatcher retries with the next candidate if the claim loses.",
        code: [
          {
            file: "DeliveryPartner.java",
            body: `import java.util.concurrent.atomic.AtomicBoolean;

public class DeliveryPartner {
    private final String id;
    private final String name;
    private volatile Location location;
    private final AtomicBoolean busy = new AtomicBoolean(false);
    private final double rating;

    public DeliveryPartner(String id, String name, Location location, double rating) {
        this.id = id;
        this.name = name;
        this.location = location;
        this.rating = rating;
    }

    /** Atomically claim this partner. Exactly one caller wins. */
    public boolean tryReserve() { return busy.compareAndSet(false, true); }
    public void release() { busy.set(false); }
    public boolean isAvailable() { return !busy.get(); }

    public String getId() { return id; }
    public String getName() { return name; }
    public Location getLocation() { return location; }
    public void setLocation(Location location) { this.location = location; }
    public double getRating() { return rating; }
}`
          },
          {
            file: "DeliveryAssignmentStrategy.java",
            body: `import java.util.List;

public interface DeliveryAssignmentStrategy {
    /** Candidates in order of preference, best first. */
    List<DeliveryPartner> rank(Order order, List<DeliveryPartner> available);
}`
          },
          {
            file: "NearestPartnerStrategy.java",
            body: `import java.util.Comparator;
import java.util.List;
import java.util.stream.Collectors;

public class NearestPartnerStrategy implements DeliveryAssignmentStrategy {
    @Override
    public List<DeliveryPartner> rank(Order order, List<DeliveryPartner> available) {
        Location pickup = order.getRestaurant().getLocation();
        return available.stream()
                .sorted(Comparator.comparingDouble(p -> p.getLocation().distanceTo(pickup)))
                .collect(Collectors.toList());
    }
}`
          },
          {
            file: "HighestRatedStrategy.java",
            body: `import java.util.Comparator;
import java.util.List;
import java.util.stream.Collectors;

public class HighestRatedStrategy implements DeliveryAssignmentStrategy {
    @Override
    public List<DeliveryPartner> rank(Order order, List<DeliveryPartner> available) {
        return available.stream()
                .sorted(Comparator.comparingDouble(DeliveryPartner::getRating).reversed())
                .collect(Collectors.toList());
    }
}`
          },
          {
            file: "DispatchService.java",
            body: `import java.util.List;
import java.util.Optional;
import java.util.stream.Collectors;

public class DispatchService {
    private final List<DeliveryPartner> partners;
    private final DeliveryAssignmentStrategy strategy;

    public DispatchService(List<DeliveryPartner> partners, DeliveryAssignmentStrategy strategy) {
        this.partners = partners;
        this.strategy = strategy;
    }

    public Optional<DeliveryPartner> assign(Order order) {
        List<DeliveryPartner> free = partners.stream()
                .filter(DeliveryPartner::isAvailable)
                .collect(Collectors.toList());

        for (DeliveryPartner candidate : strategy.rank(order, free)) {
            if (candidate.tryReserve()) {          // atomic: loses if another order got there first
                order.setPartner(candidate);
                return Optional.of(candidate);
            }
        }
        return Optional.empty();                    // nobody free; caller retries or queues
    }

    public void complete(Order order) {
        if (order.getPartner() != null) order.getPartner().release();
    }
}`
          }
        ],
        note: "Ranking and reserving are separate on purpose. Ranking is a pure function that is easy to test; reserving is the single atomic step that guarantees correctness."
      }
    ],
    deepDive: [
      {
        title: "Why the compare-and-set claim is enough",
        text: "Consider two orders assigning at the same instant. Both read the same list of free partners, both rank the same best partner first, and both try to claim her. `compareAndSet(false, true)` is atomic, so exactly one succeeds. The loser does not fail; it moves to its next candidate. There is no lock to hold across the whole assignment and nothing to deadlock.\n\nThe pattern generalises: when many actors compete for a resource, prefer a tiny atomic claim operation over locking a broader structure. If you need claims to survive restarts or span servers, the same idea becomes a conditional database update: `UPDATE partner SET status='BUSY', order_id=:o WHERE id=:p AND status='FREE'` and check the row count.",
        code: [
          {
            file: "claim_partner.sql",
            body: `UPDATE delivery_partner
   SET status = 'BUSY', current_order_id = :orderId
 WHERE id = :partnerId AND status = 'FREE';
-- rows affected = 1 -> claimed; 0 -> someone else got there first, try the next candidate`
          }
        ]
      },
      {
        title: "Finding nearby partners at scale",
        text: "Scanning every partner for every order is fine for an interview sketch and wrong for a city. The usual answer is spatial indexing: bucket partners into grid cells (geohash or an S2 cell) and only rank those in the restaurant's cell and its neighbours. The strategy interface does not change; `available` simply becomes a pre-filtered list. Location updates from phones arrive often, so partner position lives in a fast store, not the primary database.",
        code: [
          {
            file: "PartnerIndex.java",
            body: `import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** Very small grid index: partners bucketed into ~1km cells. */
public class PartnerIndex {
    private static final double CELL = 0.01;   // degrees, roughly 1 km
    private final Map<String, List<DeliveryPartner>> cells = new HashMap<>();

    private String key(Location l) {
        return (long) (l.getLat() / CELL) + ":" + (long) (l.getLng() / CELL);
    }

    public synchronized void add(DeliveryPartner p) {
        cells.computeIfAbsent(key(p.getLocation()), k -> new ArrayList<>()).add(p);
    }

    public synchronized List<DeliveryPartner> near(Location l) {
        long cx = (long) (l.getLat() / CELL), cy = (long) (l.getLng() / CELL);
        List<DeliveryPartner> out = new ArrayList<>();
        for (long dx = -1; dx <= 1; dx++) {
            for (long dy = -1; dy <= 1; dy++) {
                List<DeliveryPartner> cell = cells.get((cx + dx) + ":" + (cy + dy));
                if (cell != null) out.addAll(cell);
            }
        }
        return out;
    }
}`
          }
        ]
      },
      {
        title: "Cancellation and what has to be undone",
        text: "Cancelling before preparation is a state transition, but it also has side effects: release the reserved partner, refund the payment, tell the restaurant. Keep those out of `Order.moveTo`. A listener reacting to the CANCELLED transition handles each side effect independently, so one failing (a refund API outage) can be retried without corrupting the order state.",
        code: [
          {
            file: "CancellationHandler.java",
            body: `public class CancellationHandler implements OrderListener {
    private final DispatchService dispatch;
    private final RefundService refunds;

    public CancellationHandler(DispatchService dispatch, RefundService refunds) {
        this.dispatch = dispatch;
        this.refunds = refunds;
    }

    @Override
    public void onStatusChanged(Order order, OrderStatus from, OrderStatus to) {
        if (to != OrderStatus.CANCELLED && to != OrderStatus.REJECTED) return;
        dispatch.complete(order);                 // frees the partner if one was reserved
        refunds.refund(order.getId(), order.getTotal());
    }
}`
          }
        ]
      }
    ],
    mistakes: [
      "Pointing order lines at live menu items, so a price edit silently changes historical orders.",
      "Allowing any status to jump to any other. Encode the legal transitions and refuse the rest.",
      "Checking `isAvailable()` and then marking a partner busy as two separate steps, which lets two orders claim the same partner.",
      "Putting refunds, partner release and notifications inside the order's status setter so one failure corrupts the order.",
      "Letting a cart mix restaurants and hoping checkout sorts it out.",
      "Forcing a pattern in. Strategy for partner assignment is justified by a real roadmap; a full State class hierarchy for an order that only differs in allowed transitions is not. Design patterns are good to have, but don't force one in just to impress the interviewer."
    ],
    followups: [
      "How would you batch two nearby orders onto one delivery partner?",
      "How would you estimate delivery time and show it to the customer?",
      "How would you handle a partner who accepts and then goes offline?",
      "How would you add coupons with eligibility rules (first order only, minimum cart value)?",
      "How would you scale partner location updates to hundreds of thousands of drivers?"
    ],
    patterns: ["strategy", "observer", "state"]
  },

  /* ------------------------------------------------------------------ */
  {
    id: "ride-sharing",
    name: "Design Ride-Sharing Service like Uber",
    difficulty: "hard",
    understanding: "Riders request a trip from A to B, the system matches them with a nearby available driver, the trip progresses through pickup and drop-off, and the rider is charged a fare. The design hinges on matching under concurrency (a driver must never be given two trips), a clean trip state machine, and pricing and matching logic that can evolve independently.",
    dialogue: [
      { who: "you", text: "Are we covering only the core ride request flow, or also scheduled rides and ride pooling?" },
      { who: "int", text: "Core on-demand rides. Pooling is out of scope for now." },
      { who: "you", text: "Are there different ride types, like economy and premium?" },
      { who: "int", text: "Yes. Economy, premium and XL. Each has its own pricing and requires a matching vehicle." },
      { who: "you", text: "How do we choose a driver for a request?" },
      { who: "int", text: "Nearest available driver of the right type, to start. That might change." },
      { who: "you", text: "Does the driver have to accept, or is assignment automatic?" },
      { who: "int", text: "The driver gets an offer and can accept or decline. If declined or ignored, try the next driver." },
      { who: "you", text: "How is the fare computed?" },
      { who: "int", text: "Base fare plus per-kilometre and per-minute charges, multiplied by a surge factor when demand is high." },
      { who: "you", text: "What are the trip states?" },
      { who: "int", text: "Requested, driver assigned, driver arrived, in progress, completed. Cancellation is possible before the trip starts." },
      { who: "you", text: "Can two riders end up with the same driver?" },
      { who: "int", text: "Never. A driver handles one trip at a time." },
      { who: "you", text: "I will leave payments and ratings out of scope and stop at fare calculation." },
      { who: "int", text: "Fine." }
    ],
    requirements: [
      {
        group: "Core",
        items: [
          "A rider requests a trip with pickup, drop-off and a ride type.",
          "The system offers the trip to nearby available drivers of the matching vehicle type until one accepts.",
          "A trip moves through REQUESTED, DRIVER_ASSIGNED, DRIVER_ARRIVED, IN_PROGRESS and COMPLETED, with CANCELLED allowed before it starts.",
          "On completion the fare is computed from distance, duration, ride type and surge."
        ]
      },
      {
        group: "Concurrency",
        items: [
          "A driver is assigned to at most one active trip; concurrent requests must not claim the same driver.",
          "A trip accepted by two drivers at once is assigned to exactly one."
        ]
      },
      {
        group: "Extensibility",
        items: [
          "The matching algorithm (nearest, best rating, ETA-based) can change without touching trip logic.",
          "New ride types and pricing rules can be added without editing existing classes."
        ]
      }
    ],
    entities: [
      { name: "Rider", text: "Requests trips; has a current location." },
      { name: "Driver", text: "Drives a vehicle; has a location and availability." },
      { name: "Vehicle", text: "The car with a ride type it can serve." },
      { name: "RideType", text: "ECONOMY, PREMIUM or XL; each with a pricing policy." },
      { name: "Trip", text: "A ride from pickup to drop-off with a status and fare." },
      { name: "TripStatus", text: "REQUESTED, DRIVER_ASSIGNED, DRIVER_ARRIVED, IN_PROGRESS, COMPLETED, CANCELLED." },
      { name: "MatchingStrategy", text: "Orders candidate drivers for a request." },
      { name: "PricingStrategy", text: "Computes a fare for a completed trip." },
      { name: "Location", text: "A latitude and longitude with a distance function." }
    ],
    design: [
      {
        heading: "Requirement 1: Model riders, drivers and a trip request",
        text: "Keep the location type small and reusable; both matching and pricing need distances. A driver's availability is an atomic flag, because the single most important rule in the system is that it can be claimed by only one trip.\n\nA `RideType` is an enum, so a vehicle declares which type it can serve and matching can filter by it without branching.",
        code: [
          {
            file: "Location.java",
            body: `public class Location {
    private final double lat;
    private final double lng;

    public Location(double lat, double lng) {
        this.lat = lat;
        this.lng = lng;
    }

    /** Great-circle distance in kilometres. */
    public double distanceKm(Location other) {
        double dLat = Math.toRadians(other.lat - lat);
        double dLng = Math.toRadians(other.lng - lng);
        double a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
                + Math.cos(Math.toRadians(lat)) * Math.cos(Math.toRadians(other.lat))
                * Math.sin(dLng / 2) * Math.sin(dLng / 2);
        return 6371.0 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    public double getLat() { return lat; }
    public double getLng() { return lng; }
}`
          },
          {
            file: "RideType.java",
            body: `public enum RideType {
    ECONOMY,
    PREMIUM,
    XL
}`
          },
          {
            file: "Rider.java",
            body: `public class Rider {
    private final String id;
    private final String name;

    public Rider(String id, String name) {
        this.id = id;
        this.name = name;
    }

    public String getId() { return id; }
    public String getName() { return name; }
}`
          },
          {
            file: "Driver.java",
            body: `import java.util.concurrent.atomic.AtomicBoolean;

public class Driver {
    private final String id;
    private final String name;
    private final RideType vehicleType;
    private final double rating;
    private volatile Location location;
    private final AtomicBoolean online = new AtomicBoolean(true);
    private final AtomicBoolean onTrip = new AtomicBoolean(false);

    public Driver(String id, String name, RideType vehicleType, double rating, Location location) {
        this.id = id;
        this.name = name;
        this.vehicleType = vehicleType;
        this.rating = rating;
        this.location = location;
    }

    public boolean isAvailable() { return online.get() && !onTrip.get(); }

    /** Atomically claim the driver for a trip. Exactly one caller can win. */
    public boolean tryReserve() { return online.get() && onTrip.compareAndSet(false, true); }
    public void release() { onTrip.set(false); }

    public void goOnline() { online.set(true); }
    public void goOffline() { online.set(false); }

    public String getId() { return id; }
    public String getName() { return name; }
    public RideType getVehicleType() { return vehicleType; }
    public double getRating() { return rating; }
    public Location getLocation() { return location; }
    public void updateLocation(Location location) { this.location = location; }
}`
          }
        ]
      },
      {
        heading: "Requirement 2: Match a rider to a driver",
        text: "Matching has two separable parts. **Ranking**: which drivers are good candidates, best first. **Claiming**: actually getting one of them.\n\nRanking is a pure function behind `MatchingStrategy`, so nearest, highest-rated or ETA-based variants are drop-in replacements. Claiming is one atomic `tryReserve()` on the driver. The dispatcher walks the ranked list, offers the trip, and moves to the next driver when one declines, times out or was already claimed.",
        code: [
          {
            file: "MatchingStrategy.java",
            body: `import java.util.List;

public interface MatchingStrategy {
    /** Eligible drivers ordered best-first for this pickup. */
    List<Driver> rank(Location pickup, RideType type, List<Driver> drivers);
}`
          },
          {
            file: "NearestDriverStrategy.java",
            body: `import java.util.Comparator;
import java.util.List;
import java.util.stream.Collectors;

public class NearestDriverStrategy implements MatchingStrategy {
    private final double maxKm;

    public NearestDriverStrategy(double maxKm) { this.maxKm = maxKm; }

    @Override
    public List<Driver> rank(Location pickup, RideType type, List<Driver> drivers) {
        return drivers.stream()
                .filter(Driver::isAvailable)
                .filter(d -> d.getVehicleType() == type)
                .filter(d -> d.getLocation().distanceKm(pickup) <= maxKm)
                .sorted(Comparator.comparingDouble(d -> d.getLocation().distanceKm(pickup)))
                .collect(Collectors.toList());
    }
}`
          },
          {
            file: "BestRatedNearbyStrategy.java",
            body: `import java.util.Comparator;
import java.util.List;
import java.util.stream.Collectors;

public class BestRatedNearbyStrategy implements MatchingStrategy {
    private final double maxKm;

    public BestRatedNearbyStrategy(double maxKm) { this.maxKm = maxKm; }

    @Override
    public List<Driver> rank(Location pickup, RideType type, List<Driver> drivers) {
        return drivers.stream()
                .filter(Driver::isAvailable)
                .filter(d -> d.getVehicleType() == type)
                .filter(d -> d.getLocation().distanceKm(pickup) <= maxKm)
                .sorted(Comparator.comparingDouble(Driver::getRating).reversed())
                .collect(Collectors.toList());
    }
}`
          },
          {
            file: "DriverOffers.java",
            body: `/** How the system asks a driver; in production this is a push notification with a timeout. */
public interface DriverOffers {
    /** Returns true if the driver accepts within the timeout. */
    boolean offer(Driver driver, Trip trip);
}`
          }
        ]
      },
      {
        heading: "Requirement 3: The trip lifecycle",
        text: "A trip is the central state machine. The transition rules sit with the status enum, and the `Trip` refuses illegal moves. Two drivers accepting at once is the same kind of race as claiming a driver: `assign` is synchronised and only works from `REQUESTED`, so exactly one acceptance wins.\n\nSide effects (releasing the driver, notifying the rider, calculating the fare) hang off transitions through a listener rather than being tangled into the state change.",
        code: [
          {
            file: "TripStatus.java",
            body: `import java.util.EnumSet;
import java.util.Set;

public enum TripStatus {
    REQUESTED,
    DRIVER_ASSIGNED,
    DRIVER_ARRIVED,
    IN_PROGRESS,
    COMPLETED,
    CANCELLED;

    private Set<TripStatus> next;

    static {
        REQUESTED.next = EnumSet.of(DRIVER_ASSIGNED, CANCELLED);
        DRIVER_ASSIGNED.next = EnumSet.of(DRIVER_ARRIVED, CANCELLED);
        DRIVER_ARRIVED.next = EnumSet.of(IN_PROGRESS, CANCELLED);
        IN_PROGRESS.next = EnumSet.of(COMPLETED);
        COMPLETED.next = EnumSet.noneOf(TripStatus.class);
        CANCELLED.next = EnumSet.noneOf(TripStatus.class);
    }

    public boolean canMoveTo(TripStatus target) { return next.contains(target); }
}`
          },
          {
            file: "Trip.java",
            body: `import java.time.Duration;
import java.time.Instant;

public class Trip {
    private final String id;
    private final Rider rider;
    private final Location pickup;
    private final Location dropoff;
    private final RideType rideType;
    private TripStatus status = TripStatus.REQUESTED;
    private Driver driver;
    private Instant startedAt;
    private Instant endedAt;
    private long fare;

    public Trip(String id, Rider rider, Location pickup, Location dropoff, RideType rideType) {
        this.id = id;
        this.rider = rider;
        this.pickup = pickup;
        this.dropoff = dropoff;
        this.rideType = rideType;
    }

    /** Only the first successful acceptance can assign the driver. */
    public synchronized boolean assign(Driver d) {
        if (status != TripStatus.REQUESTED) return false;
        driver = d;
        status = TripStatus.DRIVER_ASSIGNED;
        return true;
    }

    public synchronized void moveTo(TripStatus target, Instant now) {
        if (!status.canMoveTo(target)) {
            throw new IllegalStateException("Cannot go from " + status + " to " + target);
        }
        status = target;
        if (target == TripStatus.IN_PROGRESS) startedAt = now;
        if (target == TripStatus.COMPLETED) endedAt = now;
    }

    public double distanceKm() { return pickup.distanceKm(dropoff); }

    public Duration duration() {
        return (startedAt == null || endedAt == null) ? Duration.ZERO : Duration.between(startedAt, endedAt);
    }

    public String getId() { return id; }
    public Rider getRider() { return rider; }
    public Location getPickup() { return pickup; }
    public Location getDropoff() { return dropoff; }
    public RideType getRideType() { return rideType; }
    public synchronized TripStatus getStatus() { return status; }
    public Driver getDriver() { return driver; }
    public long getFare() { return fare; }
    public void setFare(long fare) { this.fare = fare; }
}`
          },
          {
            file: "TripService.java",
            body: `import java.time.Clock;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public class TripService {
    private final List<Driver> drivers;
    private final MatchingStrategy matching;
    private final DriverOffers offers;
    private final PricingStrategyRegistry pricing;
    private final SurgeProvider surge;
    private final Clock clock;
    private final Map<String, Trip> trips = new HashMap<>();

    public TripService(List<Driver> drivers, MatchingStrategy matching, DriverOffers offers,
                       PricingStrategyRegistry pricing, SurgeProvider surge, Clock clock) {
        this.drivers = drivers;
        this.matching = matching;
        this.offers = offers;
        this.pricing = pricing;
        this.surge = surge;
        this.clock = clock;
    }

    public Trip request(Rider rider, Location pickup, Location dropoff, RideType type) {
        Trip trip = new Trip(UUID.randomUUID().toString(), rider, pickup, dropoff, type);
        trips.put(trip.getId(), trip);

        for (Driver candidate : matching.rank(pickup, type, drivers)) {
            if (!candidate.tryReserve()) continue;          // another trip got this driver first
            if (offers.offer(candidate, trip) && trip.assign(candidate)) {
                return trip;                                // matched
            }
            candidate.release();                            // declined, timed out, or trip taken
        }
        trip.moveTo(TripStatus.CANCELLED, Instant.now(clock));   // nobody available
        return trip;
    }

    public void driverArrived(String tripId) { get(tripId).moveTo(TripStatus.DRIVER_ARRIVED, Instant.now(clock)); }
    public void startTrip(String tripId) { get(tripId).moveTo(TripStatus.IN_PROGRESS, Instant.now(clock)); }

    public void cancel(String tripId) {
        Trip t = get(tripId);
        t.moveTo(TripStatus.CANCELLED, Instant.now(clock));
        if (t.getDriver() != null) t.getDriver().release();
    }

    public long completeTrip(String tripId) {
        Trip t = get(tripId);
        t.moveTo(TripStatus.COMPLETED, Instant.now(clock));
        long fare = pricing.forType(t.getRideType()).fare(t, surge.multiplierFor(t.getPickup()));
        t.setFare(fare);
        t.getDriver().release();
        return fare;
    }

    public Trip get(String id) {
        Trip t = trips.get(id);
        if (t == null) throw new IllegalArgumentException("Unknown trip " + id);
        return t;
    }
}`
          }
        ],
        note: "The order matters in `request`: reserve the driver before offering. If you offered first and reserved after, two trips could both be told the same driver accepted."
      },
      {
        heading: "Requirement 4: Calculate the fare",
        text: "Fares differ by ride type and by surge, and both change often. A `PricingStrategy` computes a fare for a trip given a surge multiplier; one implementation per ride type holds its own rates. A small registry maps `RideType` to its strategy, which is an enum-keyed lookup instead of a switch.\n\nSurge is an input, not logic inside pricing: a `SurgeProvider` answers how busy an area is, so pricing never learns about demand calculation.",
        code: [
          {
            file: "PricingStrategy.java",
            body: `public interface PricingStrategy {
    /** Fare in minor units. */
    long fare(Trip trip, double surgeMultiplier);
}`
          },
          {
            file: "DistanceTimePricing.java",
            body: `public class DistanceTimePricing implements PricingStrategy {
    private final long baseFare;
    private final long perKm;
    private final long perMinute;
    private final long minimumFare;

    public DistanceTimePricing(long baseFare, long perKm, long perMinute, long minimumFare) {
        this.baseFare = baseFare;
        this.perKm = perKm;
        this.perMinute = perMinute;
        this.minimumFare = minimumFare;
    }

    @Override
    public long fare(Trip trip, double surgeMultiplier) {
        long minutes = trip.duration().toMinutes();
        long raw = baseFare
                + Math.round(trip.distanceKm() * perKm)
                + minutes * perMinute;
        long surged = Math.round(raw * surgeMultiplier);
        return Math.max(surged, minimumFare);
    }
}`
          },
          {
            file: "PricingStrategyRegistry.java",
            body: `import java.util.EnumMap;
import java.util.Map;

public class PricingStrategyRegistry {
    private final Map<RideType, PricingStrategy> byType = new EnumMap<>(RideType.class);

    public PricingStrategyRegistry() {
        byType.put(RideType.ECONOMY, new DistanceTimePricing(5000, 1200, 200, 8000));
        byType.put(RideType.PREMIUM, new DistanceTimePricing(10000, 2200, 400, 15000));
        byType.put(RideType.XL, new DistanceTimePricing(8000, 1800, 300, 12000));
    }

    public PricingStrategy forType(RideType type) { return byType.get(type); }

    public void register(RideType type, PricingStrategy strategy) { byType.put(type, strategy); }
}`
          },
          {
            file: "SurgeProvider.java",
            body: `public interface SurgeProvider {
    /** 1.0 means no surge. */
    double multiplierFor(Location area);
}

class DemandSupplySurge implements SurgeProvider {
    private final DemandTracker tracker;

    DemandSupplySurge(DemandTracker tracker) { this.tracker = tracker; }

    @Override
    public double multiplierFor(Location area) {
        int requests = tracker.recentRequests(area);
        int drivers = Math.max(1, tracker.availableDrivers(area));
        double ratio = (double) requests / drivers;
        if (ratio < 1.0) return 1.0;
        return Math.min(3.0, 1.0 + (ratio - 1.0) * 0.5);   // capped at 3x
    }
}`
          }
        ]
      },
      {
        heading: "Requirement 5: Offer, accept and decline",
        text: "The offer step is a call to the driver's phone with a timeout. Behind `DriverOffers` it is simple to test with a fake that accepts or declines on command. The trip's synchronised `assign` is what protects against two acceptances; the loser simply sees `false` and releases their driver.\n\nWiring it all up is just constructing the collaborators.",
        code: [
          {
            file: "Demo.java",
            body: `import java.time.Clock;
import java.util.List;

Clock clock = Clock.systemUTC();

List<Driver> drivers = List.of(
        new Driver("d1", "Ravi", RideType.ECONOMY, 4.8, new Location(12.9716, 77.5946)),
        new Driver("d2", "Meena", RideType.ECONOMY, 4.9, new Location(12.9750, 77.6000)));

TripService service = new TripService(
        drivers,
        new NearestDriverStrategy(5.0),        // swap to BestRatedNearbyStrategy without touching TripService
        (driver, trip) -> true,                // fake offers: every driver accepts
        new PricingStrategyRegistry(),
        area -> 1.0,                           // no surge
        clock);

Trip trip = service.request(rider, new Location(12.9720, 77.5950),
        new Location(12.9352, 77.6245), RideType.ECONOMY);
service.driverArrived(trip.getId());
service.startTrip(trip.getId());
long fare = service.completeTrip(trip.getId());`
          }
        ],
        note: "Matching and pricing are Strategy because each has real variants today. A Factory or Singleton here would be decoration."
      }
    ],
    deepDive: [
      {
        title: "Avoiding double assignment",
        text: "There are two races and each has its own tiny atomic step.\n\n**Two trips want the same driver.** Both rank her first. `tryReserve()` is a compare-and-set on her `onTrip` flag, so one wins; the other moves on to its next candidate. No locks are held across the matching loop.\n\n**Two drivers accept the same trip.** `Trip.assign` is synchronised and succeeds only from `REQUESTED`. The second acceptance returns false, and the loop releases that driver.\n\nOn many servers both flags live in a shared store and the same operations become conditional updates, for example `UPDATE driver SET status='ON_TRIP' WHERE id=:d AND status='AVAILABLE'` and `UPDATE trip SET driver_id=:d, status='DRIVER_ASSIGNED' WHERE id=:t AND status='REQUESTED'`, checking affected rows.",
        code: [
          {
            file: "assign.sql",
            body: `-- Claim driver (rows = 1 means claimed)
UPDATE driver SET status = 'ON_TRIP'
 WHERE id = :driverId AND status = 'AVAILABLE';

-- Assign trip only if nobody beat us to it
UPDATE trip SET driver_id = :driverId, status = 'DRIVER_ASSIGNED'
 WHERE id = :tripId AND status = 'REQUESTED';`
          }
        ]
      },
      {
        title: "Finding nearby drivers efficiently",
        text: "Ranking only works if the candidate list is small. Scanning every driver in the system for each request does not scale. Index drivers by geographic cell (geohash or S2) and only look at the rider's cell and its neighbours, widening the search ring if the result is empty.\n\nThe point for the interview: `MatchingStrategy` and `TripService` do not change. Only the way you obtain the pre-filtered driver list does, which is why ranking and claiming were kept separate.",
        code: [
          {
            file: "DriverIndex.java",
            body: `import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** Grid index of online drivers. Ring 0 is the rider's cell; ring 1 adds its 8 neighbours. */
public class DriverIndex {
    private static final double CELL = 0.01;     // ~1 km
    private final Map<String, List<Driver>> cells = new HashMap<>();

    private static long cell(double v) { return (long) Math.floor(v / CELL); }

    public synchronized void add(Driver d) {
        String key = cell(d.getLocation().getLat()) + ":" + cell(d.getLocation().getLng());
        cells.computeIfAbsent(key, k -> new ArrayList<>()).add(d);
    }

    public synchronized List<Driver> nearby(Location l, int ring) {
        long cx = cell(l.getLat()), cy = cell(l.getLng());
        List<Driver> out = new ArrayList<>();
        for (long dx = -ring; dx <= ring; dx++) {
            for (long dy = -ring; dy <= ring; dy++) {
                List<Driver> c = cells.get((cx + dx) + ":" + (cy + dy));
                if (c != null) out.addAll(c);
            }
        }
        return out;
    }
}`
          }
        ]
      },
      {
        title: "Surge pricing without coupling",
        text: "Surge is derived from supply and demand in an area over a recent window. Keep it out of `PricingStrategy`: the fare formula takes the multiplier as a number and does not care where it came from. That lets you test pricing with a fixed multiplier, test surge on its own, and change either independently.\n\nTwo product details are worth raising: lock the surge multiplier at request time so the rider is quoted a stable price (otherwise the fare changes while they wait), and cap it so a short spike cannot produce absurd fares.",
        code: [
          {
            file: "FareQuote.java",
            body: `import java.time.Instant;

/** The price the rider agreed to at request time. Completion honours the quoted multiplier. */
public class FareQuote {
    private final double surgeMultiplier;
    private final Instant quotedAt;

    public FareQuote(double surgeMultiplier, Instant quotedAt) {
        this.surgeMultiplier = surgeMultiplier;
        this.quotedAt = quotedAt;
    }

    public double getSurgeMultiplier() { return surgeMultiplier; }
    public Instant getQuotedAt() { return quotedAt; }
}`
          }
        ]
      }
    ],
    mistakes: [
      "Checking `isAvailable()` and then setting the driver busy as two steps, which lets two trips claim the same driver.",
      "Offering the trip before reserving the driver.",
      "Scanning every driver in the system for each ride request.",
      "Putting surge calculation inside the fare formula so pricing and demand analysis cannot change separately.",
      "Letting the trip jump to any status. Encode the legal transitions.",
      "Forgetting to release the driver on cancel, decline and timeout paths, leaving drivers stuck as busy forever.",
      "Forcing a pattern in. Strategy for matching and pricing is justified by real variants; wrapping a simple rating filter in a Decorator chain is not. Design patterns are good to have, but don't force one in just to impress the interviewer."
    ],
    followups: [
      "How would you support ride pooling, where one driver serves several riders?",
      "How would you estimate pickup ETA using real road distance instead of straight-line?",
      "How would you handle a driver who loses connectivity mid-trip?",
      "How would you scale driver location updates (one every few seconds from each driver)?",
      "How would you add scheduled rides booked hours in advance?"
    ],
    patterns: ["strategy", "state", "observer"]
  }
);
