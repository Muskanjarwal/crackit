window.QUESTIONS = window.QUESTIONS || [];
window.QUESTIONS.push(
  {
    id: "airline-management-system",
    name: "Design Airline Management System",
    difficulty: "medium",
    understanding: "An airline system lets passengers search scheduled flights, pick seats and book tickets, while staff manage aircraft, crew and schedules. The core difficulty is separating the **schedule** (a flight that recurs) from a **flight instance** (a specific departure with its own seats), and making sure two passengers can never hold the same seat on the same departure.",
    dialogue: [
      { who: "you", text: "Which parts of an airline are in scope: search and booking, or crew scheduling and baggage as well?" },
      { who: "int", text: "Focus on search, booking and cancellation. Mention crew assignment but don't design it in depth." },
      { who: "you", text: "Is a flight like AI-101 one entity, or does each day's departure need its own state?" },
      { who: "int", text: "AI-101 runs every day, but each day has its own seat availability and can be delayed or cancelled independently." },
      { who: "you", text: "Do seats have classes and different prices?" },
      { who: "int", text: "Yes: economy, business, first. Price depends on the class and, later, on how full the flight is." },
      { who: "you", text: "Can a booking contain several passengers, and can it be cancelled?" },
      { who: "int", text: "Yes to both. Cancelling releases the seats and may carry a fee." },
      { who: "you", text: "Should passengers hear about delays or cancellations?" },
      { who: "int", text: "Yes, but the delivery channel will change over time, so don't hard-code it." },
      { who: "you", text: "Concurrency: two users hitting the last seat at once?" },
      { who: "int", text: "Exactly the case to handle. One must win, the other gets a clear failure." }
    ],
    requirements: [
      { group: "Core", items: [
        "Search flights by origin, destination and date.",
        "A flight schedule produces dated flight instances, each with its own seat map.",
        "Book one or more seats on a flight instance for a list of passengers.",
        "Cancel a booking, releasing its seats.",
        "Seats belong to a class (economy, business, first) that determines price."
      ] },
      { group: "Concurrency", items: [
        "A seat on a flight instance can never be booked twice, even under concurrent requests."
      ] },
      { group: "Extensibility", items: [
        "Pricing rules (base fare, load-based surcharge) can change without touching booking code.",
        "Passengers are notified of delays and cancellations through channels that can be added later."
      ] }
    ],
    entities: [
      { name: "Airport", text: "A code (e.g. BLR) and city, used as origin or destination." },
      { name: "Aircraft", text: "A physical plane with a seat layout. Seat layout is a fact about the aircraft." },
      { name: "FlightSchedule", text: "A recurring route (AI-101, BLR to DEL, 06:00 daily). Immutable template." },
      { name: "FlightInstance", text: "One dated departure of a schedule. Owns status (scheduled, delayed, cancelled) and its seats." },
      { name: "Seat", text: "A permanent physical seat (row, letter, class) on an aircraft." },
      { name: "FlightSeat", text: "The per-instance state of a Seat: available or booked. A Seat is never booked, a FlightSeat is." },
      { name: "Passenger", text: "A person travelling; distinct from the user who pays." },
      { name: "Booking", text: "A PNR tying passengers to flight seats, with status and total price." },
      { name: "FlightSearchService / BookingService", text: "Application services that orchestrate search and booking." }
    ],
    design: [
      {
        heading: "Requirement 1: Search flights by route and date",
        text: "Search is a read over flight instances. Keep the entities small and put the query in a service so storage can change later.\n\nNote how `FlightSchedule` is a template and `FlightInstance` carries the date. Search filters instances, not schedules.",
        code: [
          { file: "Airport.java", body: `public record Airport(String code, String city) {}` },
          { file: "FlightSchedule.java", body: `import java.time.LocalTime;

public class FlightSchedule {
  private final String flightNumber;
  private final Airport origin;
  private final Airport destination;
  private final LocalTime departureTime;
  private final Aircraft aircraft;

  public FlightSchedule(String flightNumber, Airport origin, Airport destination,
                        LocalTime departureTime, Aircraft aircraft) {
    this.flightNumber = flightNumber;
    this.origin = origin;
    this.destination = destination;
    this.departureTime = departureTime;
    this.aircraft = aircraft;
  }

  public FlightInstance instanceOn(java.time.LocalDate date) {
    return new FlightInstance(this, date, aircraft.getSeats());
  }

  public String getFlightNumber() { return flightNumber; }
  public Airport getOrigin() { return origin; }
  public Airport getDestination() { return destination; }
  public LocalTime getDepartureTime() { return departureTime; }
}` },
          { file: "FlightSearchService.java", body: `import java.time.LocalDate;
import java.util.List;
import java.util.stream.Collectors;

public class FlightSearchService {
  private final List<FlightInstance> instances;

  public FlightSearchService(List<FlightInstance> instances) {
    this.instances = instances;
  }

  public List<FlightInstance> search(Airport from, Airport to, LocalDate date) {
    return instances.stream()
        .filter(f -> f.getSchedule().getOrigin().equals(from))
        .filter(f -> f.getSchedule().getDestination().equals(to))
        .filter(f -> f.getDate().equals(date))
        .filter(f -> f.getStatus() != FlightStatus.CANCELLED)
        .collect(Collectors.toList());
  }
}` }
        ],
        note: "Interviewers often ask how search scales. For an in-memory design a filter is fine; mention an index on (origin, destination, date) when asked."
      },
      {
        heading: "Requirement 2: Seats, classes and per-flight availability",
        text: "Keep the physical seat separate from its per-flight state. The `Seat` never changes after the aircraft is built; the `FlightSeat` is what gets booked.",
        code: [
          { file: "SeatClass.java", body: `public enum SeatClass { ECONOMY, BUSINESS, FIRST }` },
          { file: "Seat.java", body: `public class Seat {
  private final String id;      // e.g. "12A"
  private final SeatClass seatClass;

  public Seat(String id, SeatClass seatClass) {
    this.id = id;
    this.seatClass = seatClass;
  }

  public String getId() { return id; }
  public SeatClass getSeatClass() { return seatClass; }
}` },
          { file: "FlightSeat.java", body: `public class FlightSeat {
  private final Seat seat;
  private boolean booked;

  public FlightSeat(Seat seat) { this.seat = seat; }

  // Returns true only for the caller that flips it.
  synchronized boolean tryBook() {
    if (booked) return false;
    booked = true;
    return true;
  }

  synchronized void release() { booked = false; }

  public Seat getSeat() { return seat; }
  public synchronized boolean isBooked() { return booked; }
}` },
          { file: "FlightInstance.java", body: `import java.time.LocalDate;
import java.util.*;

public class FlightInstance {
  private final FlightSchedule schedule;
  private final LocalDate date;
  private final Map<String, FlightSeat> seats = new LinkedHashMap<>();
  private FlightStatus status = FlightStatus.SCHEDULED;

  public FlightInstance(FlightSchedule schedule, LocalDate date, List<Seat> aircraftSeats) {
    this.schedule = schedule;
    this.date = date;
    for (Seat s : aircraftSeats) seats.put(s.getId(), new FlightSeat(s));
  }

  public FlightSeat seat(String id) {
    FlightSeat s = seats.get(id);
    if (s == null) throw new IllegalArgumentException("No such seat " + id);
    return s;
  }

  public int bookedCount() {
    return (int) seats.values().stream().filter(FlightSeat::isBooked).count();
  }
  public int totalSeats() { return seats.size(); }

  public FlightSchedule getSchedule() { return schedule; }
  public LocalDate getDate() { return date; }
  public FlightStatus getStatus() { return status; }
  public void setStatus(FlightStatus status) { this.status = status; }
}` }
        ]
      },
      {
        heading: "Requirement 3 & 4: Book and cancel, with no double booking",
        text: "Booking is all-or-nothing across several seats. Try to flip each seat; if any fails, roll back the ones already flipped. Sorting seat ids first gives a stable order, which keeps behaviour deterministic.\n\nBooking status is a small state machine: `CONFIRMED` can move to `CANCELLED`, and nothing moves out of `CANCELLED`.",
        code: [
          { file: "Booking.java", body: `import java.util.List;
import java.util.UUID;

public class Booking {
  public enum Status { CONFIRMED, CANCELLED }

  private final String pnr = UUID.randomUUID().toString().substring(0, 6).toUpperCase();
  private final FlightInstance flight;
  private final List<Passenger> passengers;
  private final List<FlightSeat> seats;
  private final Money total;
  private Status status = Status.CONFIRMED;

  public Booking(FlightInstance flight, List<Passenger> passengers,
                 List<FlightSeat> seats, Money total) {
    this.flight = flight;
    this.passengers = passengers;
    this.seats = seats;
    this.total = total;
  }

  void cancel() {
    if (status == Status.CANCELLED) throw new IllegalStateException("Already cancelled");
    seats.forEach(FlightSeat::release);
    status = Status.CANCELLED;
  }

  public String getPnr() { return pnr; }
  public Status getStatus() { return status; }
  public Money getTotal() { return total; }
  public FlightInstance getFlight() { return flight; }
}` },
          { file: "BookingService.java", body: `import java.util.*;

public class BookingService {
  private final PricingStrategy pricing;
  private final Map<String, Booking> bookings = new HashMap<>();

  public BookingService(PricingStrategy pricing) { this.pricing = pricing; }

  public Booking book(FlightInstance flight, List<Passenger> passengers, List<String> seatIds) {
    if (passengers.size() != seatIds.size())
      throw new IllegalArgumentException("One seat per passenger");

    List<String> ordered = new ArrayList<>(seatIds);
    Collections.sort(ordered);

    List<FlightSeat> taken = new ArrayList<>();
    for (String id : ordered) {
      FlightSeat seat = flight.seat(id);
      if (!seat.tryBook()) {
        taken.forEach(FlightSeat::release);          // roll back
        throw new SeatUnavailableException(id);
      }
      taken.add(seat);
    }

    Money total = taken.stream()
        .map(s -> pricing.priceFor(flight, s))
        .reduce(Money.ZERO, Money::plus);
    Booking booking = new Booking(flight, passengers, taken, total);
    synchronized (bookings) { bookings.put(booking.getPnr(), booking); }
    return booking;
  }

  public void cancel(String pnr) {
    Booking b;
    synchronized (bookings) { b = bookings.get(pnr); }
    if (b == null) throw new IllegalArgumentException("Unknown PNR " + pnr);
    b.cancel();
  }
}` }
        ],
        note: "Because `tryBook()` is atomic per seat, two threads racing for the same seat produce exactly one winner. The loser sees `SeatUnavailableException` and nothing is left half-booked."
      },
      {
        heading: "Requirement 5: Pricing rules that can change",
        text: "Pricing varies by class today and by load tomorrow. Put the calculation behind an interface so `BookingService` never changes when a new rule appears.",
        code: [
          { file: "PricingStrategy.java", body: `public interface PricingStrategy {
  Money priceFor(FlightInstance flight, FlightSeat seat);
}` },
          { file: "ClassBasedPricing.java", body: `import java.util.Map;

public class ClassBasedPricing implements PricingStrategy {
  private final Map<SeatClass, Money> base;

  public ClassBasedPricing(Map<SeatClass, Money> base) { this.base = base; }

  public Money priceFor(FlightInstance flight, FlightSeat seat) {
    return base.get(seat.getSeat().getSeatClass());
  }
}` },
          { file: "LoadSurchargePricing.java", body: `public class LoadSurchargePricing implements PricingStrategy {
  private final PricingStrategy inner;

  public LoadSurchargePricing(PricingStrategy inner) { this.inner = inner; }

  public Money priceFor(FlightInstance flight, FlightSeat seat) {
    Money price = inner.priceFor(flight, seat);
    double load = (double) flight.bookedCount() / flight.totalSeats();
    return load > 0.8 ? price.times(1.25) : price;   // 25% when over 80% full
  }
}` }
        ]
      },
      {
        heading: "Requirement 6: Notify passengers of delays and cancellations",
        text: "A flight instance is the subject; notification channels are observers. Adding SMS later means a new class, not a change to `FlightInstance`.",
        code: [
          { file: "FlightObserver.java", body: `public interface FlightObserver {
  void onStatusChanged(FlightInstance flight, FlightStatus oldStatus, FlightStatus newStatus);
}` },
          { file: "FlightInstance (notify).java", body: `// Added to FlightInstance
private final java.util.List<FlightObserver> observers = new java.util.concurrent.CopyOnWriteArrayList<>();

public void subscribe(FlightObserver o) { observers.add(o); }

public void changeStatus(FlightStatus next) {
  FlightStatus old = this.status;
  this.status = next;
  for (FlightObserver o : observers) o.onStatusChanged(this, old, next);
}` },
          { file: "EmailNotifier.java", body: `public class EmailNotifier implements FlightObserver {
  private final EmailClient client;
  private final BookingRepository bookings;

  public EmailNotifier(EmailClient client, BookingRepository bookings) {
    this.client = client;
    this.bookings = bookings;
  }

  public void onStatusChanged(FlightInstance flight, FlightStatus oldS, FlightStatus newS) {
    for (Booking b : bookings.confirmedFor(flight)) {
      client.send(b.contactEmail(), "Flight " + flight.getSchedule().getFlightNumber()
          + " is now " + newS);
    }
  }
}` }
        ]
      }
    ],
    deepDive: [
      {
        title: "Multi-server booking: where does the seat lock live?",
        text: "`synchronized` only protects one JVM. With several app servers you need the database or a lock service to arbitrate. The simplest correct option is a conditional update on the seat row, which lets the database pick the winner.\n\nOptimistic locking with a version column also works, but on a popular flight many requests lose and retry, so a single conditional update is cheaper.",
        code: [
          { file: "book_seat.sql", body: `UPDATE flight_seat
   SET status = 'BOOKED', booking_id = :bookingId
 WHERE flight_instance_id = :flight
   AND seat_id = :seat
   AND status = 'AVAILABLE';
-- rows affected = 1  -> you got the seat
-- rows affected = 0  -> someone else did; roll back the rest of the booking` }
        ]
      },
      {
        title: "Why not hold seats during payment?",
        text: "Our `book` confirms immediately. Real systems usually add a short hold: mark seats `HELD` with an expiry, charge the card, then flip to `BOOKED`. Introduce `HELD` as a third `FlightSeat` state and a sweeper that releases expired holds. Mention this as an extension rather than building it up front."
      }
    ],
    mistakes: [
      "Modelling one `Flight` class with a seat list and a date. Recurring flights then duplicate everything or share seat state across days.",
      "Putting a `booked` flag on `Seat`. A seat is booked for one departure, not forever.",
      "Booking seats one by one without rollback, leaving partial bookings when the third seat is taken.",
      "Branching on seat class inside `BookingService` instead of using a pricing strategy.",
      "Forcing a pattern in. Design patterns are good to have, but don't force one in just to impress the interviewer. Here Strategy and Observer each remove a real if/else or hard-coded dependency."
    ],
    followups: [
      "How would you support connecting flights and multi-leg itineraries?",
      "How do you handle overbooking, as airlines deliberately do?",
      "Where does seat hold with expiry fit in?",
      "How would you let passengers pick seats after booking?"
    ],
    patterns: ["strategy", "observer", "state"]
  },

  {
    id: "library-management-system",
    name: "Design Library Management System",
    difficulty: "medium",
    understanding: "A library system tracks books, members and loans. A title can have many physical copies, members have borrowing limits, overdue loans accrue fines, and a reserved title must go to the right member when a copy comes back. The key modelling choice is separating a **Book** (the title) from a **BookCopy** (the item on the shelf).",
    dialogue: [
      { who: "you", text: "Does the library own several copies of the same title?" },
      { who: "int", text: "Yes. Some titles have ten copies, some have one." },
      { who: "you", text: "Who uses the system: members only, or librarians as well?" },
      { who: "int", text: "Both. Librarians add books and manage members; members search, borrow, return and reserve." },
      { who: "you", text: "Are there limits per member?" },
      { who: "int", text: "Five books at a time and a loan period of 14 days." },
      { who: "you", text: "What happens when a book is returned late?" },
      { who: "int", text: "A fine per overdue day. The rate might differ by member type or book category later." },
      { who: "you", text: "Can members reserve a title with no available copies?" },
      { who: "int", text: "Yes. When a copy comes back, the first person waiting is told." },
      { who: "you", text: "Should I worry about two librarians checking out the last copy simultaneously?" },
      { who: "int", text: "Yes, a copy can't go to two people." }
    ],
    requirements: [
      { group: "Core", items: [
        "Search books by title, author or ISBN.",
        "Check out and return a physical copy; a member may hold at most five at a time.",
        "Each loan has a due date 14 days out.",
        "Compute a fine when a copy is returned late.",
        "Reserve a title with no available copy and be notified when one is returned."
      ] },
      { group: "Concurrency", items: [
        "A single copy can never be checked out to two members at once."
      ] },
      { group: "Extensibility", items: [
        "Fine calculation rules can vary (per day, capped, by member type).",
        "Notification channels for reservations can be added without changing the loan flow."
      ] }
    ],
    entities: [
      { name: "Book", text: "A title: ISBN, name, authors. Shared by all copies." },
      { name: "BookCopy", text: "A physical item with a barcode and a status (available, on loan)." },
      { name: "Member", text: "A library patron with a list of active loans." },
      { name: "Loan", text: "A copy borrowed by a member, with checkout date, due date and return date." },
      { name: "Reservation", text: "A member's place in the waiting queue for a title." },
      { name: "FineCalculator", text: "Computes the fine for a late return." },
      { name: "Library", text: "Facade over the catalogue and the lending workflow." }
    ],
    design: [
      {
        heading: "Requirement 1: Titles versus physical copies, and search",
        text: "`Book` holds what is true of every copy. `BookCopy` holds what is true of one object on a shelf. Search works on titles and then asks for available copies.",
        code: [
          { file: "Book.java", body: `import java.util.ArrayList;
import java.util.List;

public class Book {
  private final String isbn;
  private final String title;
  private final List<String> authors;
  private final List<BookCopy> copies = new ArrayList<>();

  public Book(String isbn, String title, List<String> authors) {
    this.isbn = isbn;
    this.title = title;
    this.authors = authors;
  }

  public BookCopy addCopy(String barcode) {
    BookCopy c = new BookCopy(barcode, this);
    copies.add(c);
    return c;
  }

  public List<BookCopy> findAllCopies() { return copies; }

  public java.util.Optional<BookCopy> findAvailableCopy() {
    return copies.stream().filter(BookCopy::isAvailable).findFirst();
  }

  public String getIsbn() { return isbn; }
  public String getTitle() { return title; }
  public List<String> getAuthors() { return authors; }
}` },
          { file: "BookCopy.java", body: `public class BookCopy {
  private final String barcode;
  private final Book book;
  private boolean onLoan;

  BookCopy(String barcode, Book book) {
    this.barcode = barcode;
    this.book = book;
  }

  // Atomically claim the copy; false if someone else already has it.
  synchronized boolean tryCheckOut() {
    if (onLoan) return false;
    onLoan = true;
    return true;
  }

  synchronized void markReturned() { onLoan = false; }
  public synchronized boolean isAvailable() { return !onLoan; }

  public Book getBook() { return book; }
  public String getBarcode() { return barcode; }
}` },
          { file: "Catalog.java", body: `import java.util.*;
import java.util.stream.Collectors;

public class Catalog {
  private final Map<String, Book> byIsbn = new HashMap<>();

  public void add(Book b) { byIsbn.put(b.getIsbn(), b); }

  public Optional<Book> byIsbn(String isbn) { return Optional.ofNullable(byIsbn.get(isbn)); }

  public List<Book> search(String query) {
    String q = query.toLowerCase();
    return byIsbn.values().stream()
        .filter(b -> b.getTitle().toLowerCase().contains(q)
            || b.getAuthors().stream().anyMatch(a -> a.toLowerCase().contains(q)))
        .collect(Collectors.toList());
  }
}` }
        ]
      },
      {
        heading: "Requirement 2 & 3: Check out with limits and due dates",
        text: "The member knows how many loans are active; the service enforces the limit and claims the copy atomically. A `Loan` records dates so a fine can be derived later without extra state.",
        code: [
          { file: "Loan.java", body: `import java.time.LocalDate;

public class Loan {
  private final BookCopy copy;
  private final Member member;
  private final LocalDate checkedOutOn;
  private final LocalDate dueOn;
  private LocalDate returnedOn;

  public Loan(BookCopy copy, Member member, LocalDate checkedOutOn, int loanDays) {
    this.copy = copy;
    this.member = member;
    this.checkedOutOn = checkedOutOn;
    this.dueOn = checkedOutOn.plusDays(loanDays);
  }

  void close(LocalDate on) { this.returnedOn = on; }

  public boolean isActive() { return returnedOn == null; }
  public BookCopy getCopy() { return copy; }
  public LocalDate getDueOn() { return dueOn; }
  public LocalDate getReturnedOn() { return returnedOn; }
}` },
          { file: "Member.java", body: `import java.util.ArrayList;
import java.util.List;

public class Member {
  public static final int MAX_LOANS = 5;

  private final String id;
  private final String name;
  private final List<Loan> loans = new ArrayList<>();

  public Member(String id, String name) {
    this.id = id;
    this.name = name;
  }

  public synchronized long activeLoanCount() {
    return loans.stream().filter(Loan::isActive).count();
  }

  synchronized void addLoan(Loan l) { loans.add(l); }

  public String getId() { return id; }
  public String getName() { return name; }
}` },
          { file: "LendingService.java", body: `import java.time.Clock;
import java.time.LocalDate;

public class LendingService {
  private static final int LOAN_DAYS = 14;

  private final Clock clock;
  private final FineCalculator fines;
  private final ReservationService reservations;

  public LendingService(Clock clock, FineCalculator fines, ReservationService reservations) {
    this.clock = clock;
    this.fines = fines;
    this.reservations = reservations;
  }

  public Loan checkOut(Member member, Book book) {
    synchronized (member) {                       // one member, one decision at a time
      if (member.activeLoanCount() >= Member.MAX_LOANS)
        throw new LoanLimitException(member.getId());

      for (BookCopy copy : book.findAllCopies()) {
        if (copy.tryCheckOut()) {                 // atomic claim
          Loan loan = new Loan(copy, member, LocalDate.now(clock), LOAN_DAYS);
          member.addLoan(loan);
          return loan;
        }
      }
      throw new NoCopyAvailableException(book.getIsbn());
    }
  }

  public Money returnCopy(Loan loan) {
    LocalDate today = LocalDate.now(clock);
    loan.close(today);
    loan.getCopy().markReturned();
    Money fine = fines.fineFor(loan, today);
    reservations.onCopyReturned(loan.getCopy().getBook());
    return fine;
  }
}` }
        ],
        note: "A `Clock` is injected so tests can pretend it is 20 days later. `LocalDate.now()` called directly makes fines untestable."
      },
      {
        heading: "Requirement 4: Fines that can change",
        text: "A flat per-day fine is the first rule, but products ask for caps and member-type discounts. Put the rule behind an interface.",
        code: [
          { file: "FineCalculator.java", body: `import java.time.LocalDate;

public interface FineCalculator {
  Money fineFor(Loan loan, LocalDate returnedOn);
}` },
          { file: "PerDayFine.java", body: `import java.time.temporal.ChronoUnit;
import java.time.LocalDate;

public class PerDayFine implements FineCalculator {
  private final Money perDay;

  public PerDayFine(Money perDay) { this.perDay = perDay; }

  public Money fineFor(Loan loan, LocalDate returnedOn) {
    long late = ChronoUnit.DAYS.between(loan.getDueOn(), returnedOn);
    return late <= 0 ? Money.ZERO : perDay.times(late);
  }
}` },
          { file: "CappedFine.java", body: `import java.time.LocalDate;

public class CappedFine implements FineCalculator {
  private final FineCalculator inner;
  private final Money cap;

  public CappedFine(FineCalculator inner, Money cap) {
    this.inner = inner;
    this.cap = cap;
  }

  public Money fineFor(Loan loan, LocalDate returnedOn) {
    Money fine = inner.fineFor(loan, returnedOn);
    return fine.isGreaterThan(cap) ? cap : fine;
  }
}` }
        ]
      },
      {
        heading: "Requirement 5: Reservations and notifications",
        text: "Each title has a FIFO queue of waiting members. When a copy is returned, the first waiter is told. Channels are observers so email today and push tomorrow do not touch the lending flow.",
        code: [
          { file: "ReservationListener.java", body: `public interface ReservationListener {
  void onBookAvailable(Member member, Book book);
}` },
          { file: "ReservationService.java", body: `import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

public class ReservationService {
  private final Map<String, Deque<Member>> queues = new ConcurrentHashMap<>();
  private final List<ReservationListener> listeners = new ArrayList<>();

  public void addListener(ReservationListener l) { listeners.add(l); }

  public void reserve(Member member, Book book) {
    queues.computeIfAbsent(book.getIsbn(), k -> new ArrayDeque<>());
    Deque<Member> q = queues.get(book.getIsbn());
    synchronized (q) {
      if (!q.contains(member)) q.addLast(member);
    }
  }

  void onCopyReturned(Book book) {
    Deque<Member> q = queues.get(book.getIsbn());
    if (q == null) return;
    Member next;
    synchronized (q) { next = q.pollFirst(); }
    if (next != null) listeners.forEach(l -> l.onBookAvailable(next, book));
  }
}` },
          { file: "EmailReservationListener.java", body: `public class EmailReservationListener implements ReservationListener {
  private final EmailClient email;

  public EmailReservationListener(EmailClient email) { this.email = email; }

  public void onBookAvailable(Member member, Book book) {
    email.send(member.getId(), "'" + book.getTitle() + "' is now available for you.");
  }
}` }
        ]
      }
    ],
    deepDive: [
      {
        title: "Holding the returned copy for the first reservation",
        text: "As written, the notified member races with anyone walking in. To be fair, mark the copy `RESERVED` for that member with an expiry (say 48 hours). `tryCheckOut` then succeeds only for the reserved member until the hold expires, after which the copy moves to the next in the queue.",
        code: [
          { file: "BookCopy (reserved).java", body: `private Member heldFor;
private java.time.Instant holdUntil;

synchronized boolean tryCheckOut(Member who, java.time.Instant now) {
  if (onLoan) return false;
  boolean held = heldFor != null && now.isBefore(holdUntil);
  if (held && !heldFor.equals(who)) return false;
  heldFor = null;
  onLoan = true;
  return true;
}` }
        ]
      },
      {
        title: "Where do you enforce 'one member, one decision at a time'?",
        text: "The loan-limit check and the loan creation must be one atomic step per member, otherwise two simultaneous checkouts can both see four loans and both succeed. We lock on the member object. In a multi-node deployment this becomes a database transaction with a row lock on the member, or a unique constraint plus a count check inside the transaction."
      }
    ],
    mistakes: [
      "Having just a `Book` with a `copiesAvailable` counter. You lose which copy is on loan, barcodes and per-copy condition.",
      "Storing the fine on the loan at checkout. Fines depend on the return date, so compute them on return.",
      "Calling `LocalDate.now()` throughout, making overdue logic impossible to test.",
      "Checking `isAvailable()` then calling `checkOut()` as two steps. That is a race; claim atomically.",
      "Forcing a pattern in. Design patterns are good to have, but don't force one in just to impress the interviewer. A fine rule that will never vary does not need a strategy."
    ],
    followups: [
      "How would you add different loan periods for students and staff?",
      "How do you handle lost or damaged copies?",
      "How would you support renewals, and block renewal when someone is waiting?",
      "How do you add e-books with limited concurrent licences?"
    ],
    patterns: ["strategy", "observer", "decorator"]
  },

  {
    id: "traffic-signal-control-system",
    name: "Design Traffic Signal Control System",
    difficulty: "medium",
    understanding: "A traffic signal controller coordinates lights at an intersection so conflicting directions never get green together. Each light is a small state machine (red, green, yellow), and the controller decides which directions may be green and for how long. The hard parts are **safety** (never two conflicting greens) and **timing** that can be changed without rewriting the controller.",
    dialogue: [
      { who: "you", text: "Is this one four-way intersection or a network of coordinated intersections?" },
      { who: "int", text: "Start with one four-way intersection. Mention how it would extend to several." },
      { who: "you", text: "Do opposite directions, north and south, go green together?" },
      { who: "int", text: "Yes. North and south share a phase, east and west share another." },
      { who: "you", text: "Are green durations fixed?" },
      { who: "int", text: "Fixed to start with, but they should be configurable and later adaptive to traffic." },
      { who: "you", text: "Do we model pedestrian crossings or emergency vehicles?" },
      { who: "int", text: "Mention emergency override. Skip pedestrians." },
      { who: "you", text: "What happens if a light fails?" },
      { who: "int", text: "The intersection should fall into a safe mode, flashing red everywhere." },
      { who: "you", text: "Is the system running on a single thread with a timer?" },
      { who: "int", text: "A scheduler drives it. Operators can send commands such as emergency override from another thread." }
    ],
    requirements: [
      { group: "Core", items: [
        "An intersection has four signals (N, S, E, W) that each cycle green, yellow, red.",
        "Conflicting directions are never green at the same time.",
        "Green and yellow durations are configurable per phase.",
        "On fault, the intersection goes to all-red flashing."
      ] },
      { group: "Concurrency", items: [
        "Operator commands (override, fault) can arrive while the timer is advancing phases; state must stay consistent."
      ] },
      { group: "Extensibility", items: [
        "Timing policy can change (fixed to adaptive) without touching the controller.",
        "Observers (logging, dashboards) can watch signal changes."
      ] }
    ],
    entities: [
      { name: "Direction", text: "NORTH, SOUTH, EAST, WEST." },
      { name: "SignalColor", text: "RED, YELLOW, GREEN." },
      { name: "TrafficSignal", text: "A light for one direction. Holds its current color." },
      { name: "Phase", text: "A set of directions that may be green together, plus their durations." },
      { name: "TimingPolicy", text: "Decides the duration for a phase." },
      { name: "IntersectionController", text: "Owns the signals and advances the phases. Enforces the safety rule." },
      { name: "ControllerState", text: "Normal, Emergency override or Fault. Decides how a tick behaves." }
    ],
    design: [
      {
        heading: "Requirement 1: A signal with a safe state machine",
        text: "A signal moves GREEN to YELLOW to RED and back to GREEN. Encode the legal transitions in the enum so an illegal jump (red directly to yellow) is impossible.",
        code: [
          { file: "Direction.java", body: `public enum Direction { NORTH, SOUTH, EAST, WEST }` },
          { file: "SignalColor.java", body: `public enum SignalColor {
  RED, GREEN, YELLOW;

  public SignalColor next() {
    switch (this) {
      case RED:    return GREEN;
      case GREEN:  return YELLOW;
      default:     return RED;
    }
  }
}` },
          { file: "TrafficSignal.java", body: `import java.util.ArrayList;
import java.util.List;

public class TrafficSignal {
  private final Direction direction;
  private SignalColor color = SignalColor.RED;
  private final List<SignalListener> listeners = new ArrayList<>();

  public TrafficSignal(Direction direction) { this.direction = direction; }

  public void addListener(SignalListener l) { listeners.add(l); }

  void advance() { set(color.next()); }

  void set(SignalColor next) {
    SignalColor old = color;
    color = next;
    listeners.forEach(l -> l.onChange(direction, old, next));
  }

  public Direction getDirection() { return direction; }
  public SignalColor getColor() { return color; }
}` }
        ]
      },
      {
        heading: "Requirement 2: Phases guarantee no conflicting greens",
        text: "Safety is structural: the controller only ever turns green the directions listed in the active phase, and it turns the previous phase fully red first. Because directions are grouped into phases up front, the invalid combination cannot be expressed.",
        code: [
          { file: "Phase.java", body: `import java.time.Duration;
import java.util.Set;

public class Phase {
  private final String name;
  private final Set<Direction> directions;
  private final Duration green;
  private final Duration yellow;

  public Phase(String name, Set<Direction> directions, Duration green, Duration yellow) {
    this.name = name;
    this.directions = directions;
    this.green = green;
    this.yellow = yellow;
  }

  public Set<Direction> getDirections() { return directions; }
  public Duration getGreen() { return green; }
  public Duration getYellow() { return yellow; }
  public String getName() { return name; }
}` },
          { file: "IntersectionController.java", body: `import java.util.*;

public class IntersectionController {
  private final Map<Direction, TrafficSignal> signals = new EnumMap<>(Direction.class);
  private final List<Phase> phases;
  private int current = 0;

  public IntersectionController(List<Phase> phases) {
    this.phases = phases;
    for (Direction d : Direction.values()) signals.put(d, new TrafficSignal(d));
  }

  // Safe handover: current group yellow -> red, then next group green.
  void startGreen(Phase p) {
    for (Direction d : p.getDirections()) signals.get(d).set(SignalColor.GREEN);
  }

  void startYellow(Phase p) {
    for (Direction d : p.getDirections()) signals.get(d).set(SignalColor.YELLOW);
  }

  void startRed(Phase p) {
    for (Direction d : p.getDirections()) signals.get(d).set(SignalColor.RED);
  }

  Phase currentPhase() { return phases.get(current); }
  void moveToNextPhase() { current = (current + 1) % phases.size(); }

  void allRed() { signals.values().forEach(s -> s.set(SignalColor.RED)); }
  public TrafficSignal signal(Direction d) { return signals.get(d); }
}` }
        ],
        note: "Never turn the next phase green until the previous one is red. Doing it in the other order opens a window with conflicting greens."
      },
      {
        heading: "Requirement 3 & 4: Controller states, including fault and override",
        text: "Normal cycling, emergency override and fault each treat a tick differently. A state object per mode removes the if/else forest from the controller and makes the transitions explicit.",
        code: [
          { file: "ControllerState.java", body: `public interface ControllerState {
  // Called by the scheduler after the current step's duration elapses.
  void tick(SignalSystem system);
  void onFault(SignalSystem system);
  void onEmergency(SignalSystem system, Direction clear);
  void onReset(SignalSystem system);
}` },
          { file: "NormalState.java", body: `import java.time.Duration;

public class NormalState implements ControllerState {
  private enum Step { GREEN, YELLOW }
  private Step step = Step.GREEN;

  public void tick(SignalSystem s) {
    IntersectionController c = s.controller();
    Phase p = c.currentPhase();
    if (step == Step.GREEN) {
      c.startYellow(p);
      step = Step.YELLOW;
      s.scheduleTick(p.getYellow());
    } else {
      c.startRed(p);
      c.moveToNextPhase();
      Phase next = c.currentPhase();
      c.startGreen(next);
      step = Step.GREEN;
      s.scheduleTick(s.timing().greenFor(next));
    }
  }

  public void onFault(SignalSystem s) {
    s.controller().allRed();
    s.setState(new FaultState());
  }

  public void onEmergency(SignalSystem s, Direction clear) {
    s.controller().allRed();
    s.controller().signal(clear).set(SignalColor.GREEN);
    s.setState(new EmergencyState());
  }

  public void onReset(SignalSystem s) { /* already normal */ }
}` },
          { file: "FaultState.java", body: `public class FaultState implements ControllerState {
  public void tick(SignalSystem s) { /* flashing red: keep all red until reset */ }
  public void onFault(SignalSystem s) { }
  public void onEmergency(SignalSystem s, Direction clear) { /* ignore in fault */ }

  public void onReset(SignalSystem s) {
    s.controller().allRed();
    s.controller().startGreen(s.controller().currentPhase());
    s.setState(new NormalState());
    s.scheduleTick(s.timing().greenFor(s.controller().currentPhase()));
  }
}` },
          { file: "EmergencyState.java", body: `public class EmergencyState implements ControllerState {
  public void tick(SignalSystem s) { /* hold the emergency green until cleared */ }
  public void onFault(SignalSystem s) {
    s.controller().allRed();
    s.setState(new FaultState());
  }
  public void onEmergency(SignalSystem s, Direction clear) { }

  public void onReset(SignalSystem s) {
    s.controller().allRed();
    s.controller().startGreen(s.controller().currentPhase());
    s.setState(new NormalState());
    s.scheduleTick(s.timing().greenFor(s.controller().currentPhase()));
  }
}` }
        ]
      },
      {
        heading: "Requirement 5: A thread-safe facade and pluggable timing",
        text: "One lock guards all state changes, so the scheduler thread and operator commands never interleave inside a transition. Timing is a strategy: fixed today, traffic-adaptive later.",
        code: [
          { file: "TimingPolicy.java", body: `import java.time.Duration;

public interface TimingPolicy {
  Duration greenFor(Phase phase);
}` },
          { file: "FixedTiming.java", body: `import java.time.Duration;

public class FixedTiming implements TimingPolicy {
  public Duration greenFor(Phase phase) { return phase.getGreen(); }
}` },
          { file: "SignalSystem.java", body: `import java.time.Duration;
import java.util.concurrent.*;

public class SignalSystem {
  private final IntersectionController controller;
  private final TimingPolicy timing;
  private final ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor();
  private ScheduledFuture<?> pending;
  private ControllerState state = new NormalState();

  public SignalSystem(IntersectionController controller, TimingPolicy timing) {
    this.controller = controller;
    this.timing = timing;
  }

  public synchronized void start() {
    controller.startGreen(controller.currentPhase());
    scheduleTick(timing.greenFor(controller.currentPhase()));
  }

  synchronized void scheduleTick(Duration after) {
    if (pending != null) pending.cancel(false);
    pending = scheduler.schedule(this::tick, after.toMillis(), TimeUnit.MILLISECONDS);
  }

  private synchronized void tick() { state.tick(this); }
  public synchronized void fault() { state.onFault(this); }
  public synchronized void emergency(Direction d) { state.onEmergency(this, d); }
  public synchronized void reset() { state.onReset(this); }

  synchronized void setState(ControllerState s) { this.state = s; }
  IntersectionController controller() { return controller; }
  TimingPolicy timing() { return timing; }
}` }
        ],
        note: "Because every public entry point is synchronized, an operator calling `fault()` cannot land halfway through a green-to-yellow transition."
      },
      {
        heading: "Requirement 6: Observing signal changes",
        text: "Logging and dashboards subscribe to signals rather than being called by them.",
        code: [
          { file: "SignalListener.java", body: `public interface SignalListener {
  void onChange(Direction direction, SignalColor from, SignalColor to);
}` },
          { file: "AuditLogListener.java", body: `import java.time.Instant;

public class AuditLogListener implements SignalListener {
  public void onChange(Direction d, SignalColor from, SignalColor to) {
    System.out.println(Instant.now() + " " + d + " " + from + " -> " + to);
  }
}` }
        ]
      }
    ],
    deepDive: [
      {
        title: "Adaptive timing from sensors",
        text: "Replace `FixedTiming` with a policy that reads vehicle counts from sensors and scales green time within safe bounds. The controller does not change because it only calls `greenFor(phase)`. Keep minimum and maximum green times enforced in the policy, since a sensor bug must never produce a one-second green or an hour-long one.",
        code: [
          { file: "AdaptiveTiming.java", body: `import java.time.Duration;

public class AdaptiveTiming implements TimingPolicy {
  private final VehicleCounter counter;
  private final Duration min = Duration.ofSeconds(10);
  private final Duration max = Duration.ofSeconds(90);

  public AdaptiveTiming(VehicleCounter counter) { this.counter = counter; }

  public Duration greenFor(Phase phase) {
    int waiting = phase.getDirections().stream().mapToInt(counter::waiting).sum();
    Duration d = Duration.ofSeconds(10L + 2L * waiting);
    return d.compareTo(max) > 0 ? max : d.compareTo(min) < 0 ? min : d;
  }
}` }
        ]
      },
      {
        title: "Scaling to many intersections",
        text: "Give each intersection its own `SignalSystem` and add a coordinator that sets offsets between neighbours (a green wave). The coordinator talks to systems through the same public commands, so nothing inside a system changes. Treat the single-intersection safety guarantee as the unit of correctness."
      }
    ],
    mistakes: [
      "Using a boolean per light and independent timers per direction. Nothing prevents two greens; safety must come from the structure.",
      "Turning the next phase green before the previous one is red.",
      "Hard-coding durations inside the state machine, which blocks adaptive timing.",
      "Forgetting thread safety between the timer and operator commands.",
      "Forcing a pattern in. Design patterns are good to have, but don't force one in just to impress the interviewer. State earns its place here because modes genuinely behave differently on each tick."
    ],
    followups: [
      "How would you add a pedestrian crossing phase?",
      "How do you restore the right phase after an emergency override ends?",
      "How would you model left-turn arrows without conflicts?",
      "How would you test the whole cycle without waiting real seconds?"
    ],
    patterns: ["state", "strategy", "observer"]
  },

  {
    id: "concert-ticket-booking",
    name: "Design Concert Ticket Booking System",
    difficulty: "medium",
    understanding: "A concert ticket system sells seats for events, where thousands of fans compete for the same seats the instant sales open. The system must let a user **hold** seats while they pay, release the hold if they don't, and never sell a seat twice. The design centres on a seat lifecycle (available, held, sold) and a hold with an expiry.",
    dialogue: [
      { who: "you", text: "Is this reserved seating, general admission, or both?" },
      { who: "int", text: "Both. Some sections have numbered seats, some are general admission with a capacity." },
      { who: "you", text: "Can one event have several price tiers?" },
      { who: "int", text: "Yes: floor, balcony, VIP. Price is per tier." },
      { who: "you", text: "How long can a user hold seats while paying?" },
      { who: "int", text: "Ten minutes. After that they go back on sale." },
      { who: "you", text: "Is there a limit per purchase?" },
      { who: "int", text: "Maximum six tickets per booking to discourage scalping." },
      { who: "you", text: "Which payment methods?" },
      { who: "int", text: "Cards and UPI today, wallets next quarter." },
      { who: "you", text: "When payment fails, do the seats go back immediately?" },
      { who: "int", text: "Yes, release them straight away." },
      { who: "you", text: "Expect heavy contention on the same seats?" },
      { who: "int", text: "Very heavy on popular events. Correctness matters more than raw speed." }
    ],
    requirements: [
      { group: "Core", items: [
        "List events with sections, seat maps and per-tier prices.",
        "Hold up to six seats for a user for ten minutes.",
        "Confirm the booking after successful payment, converting the hold to a sale.",
        "Release held seats when payment fails or the hold expires.",
        "Support general-admission sections that sell by capacity."
      ] },
      { group: "Concurrency", items: [
        "A seat can be held or sold to only one user at a time; a late payment cannot resurrect an expired hold."
      ] },
      { group: "Extensibility", items: [
        "New payment methods can be added without changing the booking flow.",
        "Other parts of the system (email, analytics) can react to booking events."
      ] }
    ],
    entities: [
      { name: "Event", text: "A concert on a date at a venue, with sections and prices." },
      { name: "Section", text: "A priced group of seats (floor, balcony) or a general-admission pool with capacity." },
      { name: "EventSeat", text: "A seat for one event with a status: AVAILABLE, HELD or SOLD." },
      { name: "Hold", text: "A time-limited claim on seats by a user." },
      { name: "Booking", text: "A confirmed purchase: seats, total and payment reference." },
      { name: "PaymentMethod", text: "Strategy interface for taking money." },
      { name: "BookingService", text: "Orchestrates hold, pay and confirm." }
    ],
    design: [
      {
        heading: "Requirement 1: Events, sections and seat state",
        text: "A seat has three states. Transitions are guarded so a sold seat can never be held and a hold can only be released by its owner or by expiry.",
        code: [
          { file: "SeatStatus.java", body: `public enum SeatStatus { AVAILABLE, HELD, SOLD }` },
          { file: "EventSeat.java", body: `import java.time.Instant;

public class EventSeat {
  private final String id;
  private final Section section;
  private SeatStatus status = SeatStatus.AVAILABLE;
  private String heldBy;
  private Instant holdExpiresAt;

  public EventSeat(String id, Section section) {
    this.id = id;
    this.section = section;
  }

  // Available (or expired hold) -> Held. Returns false if someone else has it.
  synchronized boolean tryHold(String userId, Instant now, Instant expiresAt) {
    boolean expired = status == SeatStatus.HELD && !now.isBefore(holdExpiresAt);
    if (status == SeatStatus.AVAILABLE || expired) {
      status = SeatStatus.HELD;
      heldBy = userId;
      holdExpiresAt = expiresAt;
      return true;
    }
    return false;
  }

  // Held by this user and not expired -> Sold.
  synchronized boolean confirm(String userId, Instant now) {
    if (status == SeatStatus.HELD && userId.equals(heldBy) && now.isBefore(holdExpiresAt)) {
      status = SeatStatus.SOLD;
      return true;
    }
    return false;
  }

  synchronized void release(String userId) {
    if (status == SeatStatus.HELD && userId.equals(heldBy)) {
      status = SeatStatus.AVAILABLE;
      heldBy = null;
      holdExpiresAt = null;
    }
  }

  public String getId() { return id; }
  public Section getSection() { return section; }
  public synchronized SeatStatus getStatus() { return status; }
}` },
          { file: "Section.java", body: `public class Section {
  private final String name;
  private final Money price;

  public Section(String name, Money price) {
    this.name = name;
    this.price = price;
  }

  public String getName() { return name; }
  public Money getPrice() { return price; }
}` },
          { file: "Event.java", body: `import java.util.*;

public class Event {
  private final String id;
  private final String name;
  private final Map<String, EventSeat> seats = new LinkedHashMap<>();

  public Event(String id, String name) {
    this.id = id;
    this.name = name;
  }

  public void addSeat(EventSeat seat) { seats.put(seat.getId(), seat); }

  public EventSeat seat(String id) {
    EventSeat s = seats.get(id);
    if (s == null) throw new IllegalArgumentException("Unknown seat " + id);
    return s;
  }

  public String getId() { return id; }
  public String getName() { return name; }
}` }
        ]
      },
      {
        heading: "Requirement 2: Holding seats all-or-nothing, with an expiry",
        text: "A hold either claims every requested seat or none. Seats are taken in sorted order so concurrent requests for overlapping sets agree on an ordering, and any failure rolls back what was already claimed.",
        code: [
          { file: "Hold.java", body: `import java.time.Instant;
import java.util.List;
import java.util.UUID;

public class Hold {
  private final String id = UUID.randomUUID().toString();
  private final String userId;
  private final List<EventSeat> seats;
  private final Instant expiresAt;

  public Hold(String userId, List<EventSeat> seats, Instant expiresAt) {
    this.userId = userId;
    this.seats = seats;
    this.expiresAt = expiresAt;
  }

  public Money total() {
    return seats.stream().map(s -> s.getSection().getPrice()).reduce(Money.ZERO, Money::plus);
  }

  public String getId() { return id; }
  public String getUserId() { return userId; }
  public List<EventSeat> getSeats() { return seats; }
  public Instant getExpiresAt() { return expiresAt; }
}` },
          { file: "HoldService.java", body: `import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

public class HoldService {
  private static final int MAX_SEATS = 6;
  private static final Duration HOLD_FOR = Duration.ofMinutes(10);

  private final Clock clock;
  private final Map<String, Hold> holds = new ConcurrentHashMap<>();

  public HoldService(Clock clock) { this.clock = clock; }

  public Hold hold(Event event, String userId, List<String> seatIds) {
    if (seatIds.isEmpty() || seatIds.size() > MAX_SEATS)
      throw new IllegalArgumentException("Choose 1 to " + MAX_SEATS + " seats");

    List<String> ordered = new ArrayList<>(new TreeSet<>(seatIds));
    Instant now = clock.instant();
    Instant expiry = now.plus(HOLD_FOR);

    List<EventSeat> taken = new ArrayList<>();
    for (String id : ordered) {
      EventSeat seat = event.seat(id);
      if (!seat.tryHold(userId, now, expiry)) {
        taken.forEach(s -> s.release(userId));          // roll back
        throw new SeatUnavailableException(id);
      }
      taken.add(seat);
    }
    Hold hold = new Hold(userId, taken, expiry);
    holds.put(hold.getId(), hold);
    return hold;
  }

  public Hold get(String holdId) {
    Hold h = holds.get(holdId);
    if (h == null) throw new IllegalArgumentException("Unknown hold " + holdId);
    return h;
  }

  public void release(Hold hold) {
    hold.getSeats().forEach(s -> s.release(hold.getUserId()));
    holds.remove(hold.getId());
  }
}` }
        ],
        note: "Expiry is checked lazily: an expired hold simply stops counting, and the next buyer's `tryHold` can take the seat. A background sweeper is only needed to keep seat maps tidy, not for correctness."
      },
      {
        heading: "Requirement 3 & 4: Pay, confirm or release",
        text: "Payment happens outside any lock, since it is slow and can fail. Afterwards `confirm` re-checks that the hold is still ours and unexpired. If it isn't, refund and fail instead of selling a seat someone else may now own.",
        code: [
          { file: "PaymentMethod.java", body: `public interface PaymentMethod {
  PaymentResult charge(String userId, Money amount);
  void refund(PaymentResult result);
}` },
          { file: "CardPayment.java", body: `public class CardPayment implements PaymentMethod {
  private final CardGateway gateway;
  private final String cardToken;

  public CardPayment(CardGateway gateway, String cardToken) {
    this.gateway = gateway;
    this.cardToken = cardToken;
  }

  public PaymentResult charge(String userId, Money amount) {
    return gateway.charge(cardToken, amount);
  }

  public void refund(PaymentResult result) { gateway.refund(result.reference()); }
}` },
          { file: "UpiPayment.java", body: `public class UpiPayment implements PaymentMethod {
  private final UpiGateway gateway;
  private final String vpa;

  public UpiPayment(UpiGateway gateway, String vpa) {
    this.gateway = gateway;
    this.vpa = vpa;
  }

  public PaymentResult charge(String userId, Money amount) {
    return gateway.collect(vpa, amount);
  }

  public void refund(PaymentResult result) { gateway.reverse(result.reference()); }
}` },
          { file: "BookingService.java", body: `import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

public class BookingService {
  private final HoldService holds;
  private final Clock clock;
  private final List<BookingListener> listeners = new ArrayList<>();

  public BookingService(HoldService holds, Clock clock) {
    this.holds = holds;
    this.clock = clock;
  }

  public void addListener(BookingListener l) { listeners.add(l); }

  public Booking confirm(String holdId, PaymentMethod method) {
    Hold hold = holds.get(holdId);
    PaymentResult paid;
    try {
      paid = method.charge(hold.getUserId(), hold.total());
    } catch (PaymentFailedException e) {
      holds.release(hold);                              // seats go back on sale at once
      throw e;
    }

    Instant now = clock.instant();
    List<EventSeat> sold = new ArrayList<>();
    for (EventSeat seat : hold.getSeats()) {
      if (!seat.confirm(hold.getUserId(), now)) {
        method.refund(paid);                            // hold lapsed while paying
        holds.release(hold);
        throw new HoldExpiredException(holdId);
      }
      sold.add(seat);
    }

    Booking booking = new Booking(hold.getUserId(), sold, hold.total(), paid.reference());
    listeners.forEach(l -> l.onBooked(booking));
    return booking;
  }
}` }
        ]
      },
      {
        heading: "Requirement 5: General admission by capacity",
        text: "A GA section has no seat ids, only a count. Model it as a counter guarded by a lock. It still plugs into holds by handing back tickets instead of seats.",
        code: [
          { file: "GeneralAdmissionPool.java", body: `public class GeneralAdmissionPool {
  private final Section section;
  private int remaining;

  public GeneralAdmissionPool(Section section, int capacity) {
    this.section = section;
    this.remaining = capacity;
  }

  public synchronized boolean tryReserve(int qty) {
    if (qty <= 0 || qty > remaining) return false;
    remaining -= qty;
    return true;
  }

  public synchronized void giveBack(int qty) { remaining += qty; }
  public synchronized int remaining() { return remaining; }
  public Section getSection() { return section; }
}` }
        ]
      },
      {
        heading: "Requirement 6: Reacting to a booking",
        text: "Email, analytics and seat-map refresh all care that a booking happened. `BookingService` publishes to listeners and knows nothing about them.",
        code: [
          { file: "BookingListener.java", body: `public interface BookingListener {
  void onBooked(Booking booking);
}` },
          { file: "ConfirmationEmailListener.java", body: `public class ConfirmationEmailListener implements BookingListener {
  private final EmailClient email;

  public ConfirmationEmailListener(EmailClient email) { this.email = email; }

  public void onBooked(Booking b) {
    email.send(b.getUserId(), "Your " + b.getSeats().size() + " tickets are confirmed.");
  }
}` }
        ]
      }
    ],
    deepDive: [
      {
        title: "Multi-server holds with Redis",
        text: "In-memory `synchronized` seats work on one node. Across nodes, make the hold atomic in a shared store. `SET key value NX PX 600000` creates the hold only if the seat has none and expires it automatically, which also solves cleanup. Multiple seats must still be acquired in sorted order and rolled back on failure.",
        code: [
          { file: "RedisSeatHold.java", body: `public boolean tryHold(String eventId, String seatId, String userId) {
  String key = "hold:" + eventId + ":" + seatId;
  // NX: only if absent, PX: auto-expire in 10 minutes
  return "OK".equals(redis.set(key, userId, SetParams.setParams().nx().px(600_000)));
}

public boolean confirmOwner(String eventId, String seatId, String userId) {
  String key = "hold:" + eventId + ":" + seatId;
  return userId.equals(redis.get(key));          // then write SOLD to the database
}` }
        ]
      },
      {
        title: "Flash sales: the waiting-room problem",
        text: "When 100,000 users hit one event the bottleneck is the hot rows, not the design. Put a virtual queue in front: admit a bounded number of users into seat selection at a time, so contention stays manageable. The class design is unchanged; this is an admission-control layer."
      }
    ],
    mistakes: [
      "Selling on payment success without re-checking the hold. A slow payment can finish after the hold expired and the seat was re-held.",
      "Holding a lock while calling the payment gateway. One slow card network call stalls everyone buying that event.",
      "A `booked` boolean with no HELD state, forcing the user to pay before the seat is theirs.",
      "Relying on a cleanup job for correctness instead of checking expiry at use time.",
      "Forcing a pattern in. Design patterns are good to have, but don't force one in just to impress the interviewer. Here Strategy for payments and Observer for post-booking effects each solve a stated requirement."
    ],
    followups: [
      "How would you add a waitlist for sold-out events?",
      "How do you stop bots from grabbing seats?",
      "How would you handle refunds and cancellations?",
      "How would you let a user extend their hold?"
    ],
    patterns: ["strategy", "observer", "state"]
  },

  {
    id: "social-network",
    name: "Design Social Network Service like Facebook",
    difficulty: "medium",
    understanding: "A social network lets users create profiles, connect with friends, publish posts, react and comment, and read a personalised feed. The class design focuses on four ideas: users and symmetric friendships, content (posts and nested comments), a feed that can be ranked in different ways, and notifications triggered by activity. Storage and fan-out at scale are deep-dive territory.",
    dialogue: [
      { who: "you", text: "Are friendships mutual, as on Facebook, or one-directional like follows?" },
      { who: "int", text: "Mutual: one user sends a request and the other accepts." },
      { who: "you", text: "What content types are supported?" },
      { who: "int", text: "Text posts with optional media. Keep media as a URL for this exercise." },
      { who: "you", text: "Can people comment on comments?" },
      { who: "int", text: "Yes, nested replies." },
      { who: "you", text: "Which reactions: just likes?" },
      { who: "int", text: "Like, love, laugh. Easy to extend." },
      { who: "you", text: "How is the feed ordered?" },
      { who: "int", text: "Chronological to start. Ranking by engagement will come later, so don't hard-wire it." },
      { who: "you", text: "Who can see a post?" },
      { who: "int", text: "Public or friends-only." },
      { who: "you", text: "Notifications?" },
      { who: "int", text: "When someone comments on or reacts to your post, or sends a friend request." }
    ],
    requirements: [
      { group: "Core", items: [
        "Create a user profile.",
        "Send, accept and decline friend requests; friendship is mutual.",
        "Create posts with public or friends-only visibility.",
        "Comment on posts, including nested replies.",
        "React to posts with a reaction type.",
        "Read a feed of visible posts from friends."
      ] },
      { group: "Concurrency", items: [
        "Concurrent reactions and comments on one post must not lose updates; a user has at most one reaction per post."
      ] },
      { group: "Extensibility", items: [
        "Feed ordering can change (chronological, ranked) without touching feed assembly.",
        "New notification channels and events can be added without modifying posting code."
      ] }
    ],
    entities: [
      { name: "User", text: "Profile plus the set of friend ids." },
      { name: "FriendRequest", text: "A pending invitation between two users, with status." },
      { name: "Post", text: "Authored content with visibility, reactions and a tree of comments." },
      { name: "Comment", text: "Text by a user that can contain replies (a tree)." },
      { name: "Reaction", text: "LIKE, LOVE or LAUGH by one user on one post." },
      { name: "FeedService", text: "Collects visible posts from friends and orders them." },
      { name: "FeedRanker", text: "Strategy for ordering a feed." },
      { name: "NotificationService", text: "Fans activity events out to subscribers." }
    ],
    design: [
      {
        heading: "Requirement 1 & 2: Users and mutual friendships",
        text: "A friendship is symmetric, so accepting a request adds each user to the other's friend set. The request has its own small lifecycle so it can't be accepted twice.",
        code: [
          { file: "User.java", body: `import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

public class User {
  private final String id;
  private final String name;
  private final Set<String> friendIds = ConcurrentHashMap.newKeySet();

  public User(String id, String name) {
    this.id = id;
    this.name = name;
  }

  void addFriend(String otherId) { friendIds.add(otherId); }
  public boolean isFriendsWith(String otherId) { return friendIds.contains(otherId); }
  public Set<String> getFriendIds() { return friendIds; }

  public String getId() { return id; }
  public String getName() { return name; }
}` },
          { file: "FriendRequest.java", body: `public class FriendRequest {
  public enum Status { PENDING, ACCEPTED, DECLINED }

  private final String fromId;
  private final String toId;
  private Status status = Status.PENDING;

  public FriendRequest(String fromId, String toId) {
    this.fromId = fromId;
    this.toId = toId;
  }

  synchronized boolean resolve(Status next) {
    if (status != Status.PENDING) return false;
    status = next;
    return true;
  }

  public String getFromId() { return fromId; }
  public String getToId() { return toId; }
}` },
          { file: "FriendshipService.java", body: `import java.util.*;

public class FriendshipService {
  private final Map<String, User> users;
  private final NotificationService notifications;

  public FriendshipService(Map<String, User> users, NotificationService notifications) {
    this.users = users;
    this.notifications = notifications;
  }

  public FriendRequest send(String fromId, String toId) {
    if (fromId.equals(toId)) throw new IllegalArgumentException("Cannot friend yourself");
    if (users.get(fromId).isFriendsWith(toId)) throw new IllegalStateException("Already friends");
    FriendRequest r = new FriendRequest(fromId, toId);
    notifications.publish(new ActivityEvent(ActivityEvent.Type.FRIEND_REQUEST, fromId, toId, null));
    return r;
  }

  public void accept(FriendRequest r) {
    if (!r.resolve(FriendRequest.Status.ACCEPTED)) throw new IllegalStateException("Already handled");
    users.get(r.getFromId()).addFriend(r.getToId());
    users.get(r.getToId()).addFriend(r.getFromId());      // mutual
  }

  public void decline(FriendRequest r) { r.resolve(FriendRequest.Status.DECLINED); }
}` }
        ]
      },
      {
        heading: "Requirement 3 & 5: Posts, visibility and reactions",
        text: "Visibility is a rule on the post: a public post is visible to anyone, a friends-only post to the author's friends and the author. A user can hold only one reaction per post, which a map keyed by user id enforces naturally.",
        code: [
          { file: "Visibility.java", body: `public enum Visibility { PUBLIC, FRIENDS_ONLY }` },
          { file: "ReactionType.java", body: `public enum ReactionType { LIKE, LOVE, LAUGH }` },
          { file: "Post.java", body: `import java.time.Instant;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;

public class Post {
  private final String id = UUID.randomUUID().toString();
  private final User author;
  private final String text;
  private final Visibility visibility;
  private final Instant createdAt;
  private final Map<String, ReactionType> reactions = new ConcurrentHashMap<>();
  private final List<Comment> comments = new CopyOnWriteArrayList<>();

  public Post(User author, String text, Visibility visibility, Instant createdAt) {
    this.author = author;
    this.text = text;
    this.visibility = visibility;
    this.createdAt = createdAt;
  }

  public boolean isVisibleTo(User viewer) {
    if (visibility == Visibility.PUBLIC) return true;
    return viewer.getId().equals(author.getId()) || author.isFriendsWith(viewer.getId());
  }

  // One reaction per user: later calls replace the earlier one.
  public void react(String userId, ReactionType type) { reactions.put(userId, type); }
  public void removeReaction(String userId) { reactions.remove(userId); }

  public void addComment(Comment c) { comments.add(c); }

  public int reactionCount() { return reactions.size(); }
  public int commentCount() { return comments.stream().mapToInt(Comment::totalCount).sum(); }

  public String getId() { return id; }
  public User getAuthor() { return author; }
  public Instant getCreatedAt() { return createdAt; }
  public List<Comment> getComments() { return comments; }
}` }
        ]
      },
      {
        heading: "Requirement 4: Nested comments as a tree",
        text: "A comment can contain comments, and callers treat a single comment and a whole thread the same way (count them, render them). That is a tree, so the node holds its children directly.",
        code: [
          { file: "Comment.java", body: `import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;

public class Comment {
  private final String id = UUID.randomUUID().toString();
  private final String authorId;
  private final String text;
  private final Instant createdAt;
  private final List<Comment> replies = new CopyOnWriteArrayList<>();

  public Comment(String authorId, String text, Instant createdAt) {
    this.authorId = authorId;
    this.text = text;
    this.createdAt = createdAt;
  }

  public Comment reply(String authorId, String text, Instant at) {
    Comment c = new Comment(authorId, text, at);
    replies.add(c);
    return c;
  }

  // Same call works on a leaf and on a whole thread.
  public int totalCount() {
    int n = 1;
    for (Comment r : replies) n += r.totalCount();
    return n;
  }

  public String getId() { return id; }
  public String getAuthorId() { return authorId; }
  public String getText() { return text; }
  public List<Comment> getReplies() { return replies; }
}` }
        ],
        note: "Cap reply depth in the UI, not the model. The tree can be arbitrarily deep, and rendering decides how much of it to show."
      },
      {
        heading: "Requirement 6: Feed assembly with pluggable ranking",
        text: "Feed assembly has two separate jobs: choose which posts the viewer may see, and decide the order. Keep them apart. Assembly lives in `FeedService`; ordering sits behind a ranker interface.",
        code: [
          { file: "FeedRanker.java", body: `import java.util.List;

public interface FeedRanker {
  List<Post> rank(User viewer, List<Post> candidates);
}` },
          { file: "ChronologicalRanker.java", body: `import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

public class ChronologicalRanker implements FeedRanker {
  public List<Post> rank(User viewer, List<Post> candidates) {
    List<Post> out = new ArrayList<>(candidates);
    out.sort(Comparator.comparing(Post::getCreatedAt).reversed());
    return out;
  }
}` },
          { file: "EngagementRanker.java", body: `import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

public class EngagementRanker implements FeedRanker {
  public List<Post> rank(User viewer, List<Post> candidates) {
    List<Post> out = new ArrayList<>(candidates);
    out.sort(Comparator.comparingDouble(this::score).reversed());
    return out;
  }

  private double score(Post p) {
    long ageHours = java.time.Duration.between(p.getCreatedAt(), java.time.Instant.now()).toHours();
    return (p.reactionCount() + 2.0 * p.commentCount()) / (1.0 + ageHours);
  }
}` },
          { file: "FeedService.java", body: `import java.util.*;
import java.util.stream.Collectors;

public class FeedService {
  private final PostRepository posts;
  private final Map<String, User> users;
  private FeedRanker ranker;

  public FeedService(PostRepository posts, Map<String, User> users, FeedRanker ranker) {
    this.posts = posts;
    this.users = users;
    this.ranker = ranker;
  }

  public void setRanker(FeedRanker ranker) { this.ranker = ranker; }

  public List<Post> feedFor(String viewerId, int limit) {
    User viewer = users.get(viewerId);
    List<Post> candidates = posts.byAuthors(viewer.getFriendIds()).stream()
        .filter(p -> p.isVisibleTo(viewer))
        .collect(Collectors.toList());
    return ranker.rank(viewer, candidates).stream().limit(limit).collect(Collectors.toList());
  }
}` }
        ]
      },
      {
        heading: "Notifications through events",
        text: "Posting, reacting and commenting should not know who cares. They publish an `ActivityEvent`; subscribers such as in-app, push or email decide what to do. A new channel is one new subscriber.",
        code: [
          { file: "ActivityEvent.java", body: `public record ActivityEvent(Type type, String actorId, String targetUserId, String postId) {
  public enum Type { FRIEND_REQUEST, REACTION, COMMENT }
}` },
          { file: "NotificationService.java", body: `import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

public class NotificationService {
  public interface Subscriber { void onEvent(ActivityEvent event); }

  private final List<Subscriber> subscribers = new CopyOnWriteArrayList<>();

  public void subscribe(Subscriber s) { subscribers.add(s); }

  public void publish(ActivityEvent e) {
    for (Subscriber s : subscribers) s.onEvent(e);
  }
}` },
          { file: "PushSubscriber.java", body: `public class PushSubscriber implements NotificationService.Subscriber {
  private final PushClient push;

  public PushSubscriber(PushClient push) { this.push = push; }

  public void onEvent(ActivityEvent e) {
    if (e.targetUserId() == null || e.targetUserId().equals(e.actorId())) return;  // don't notify yourself
    push.send(e.targetUserId(), e.type() + " from " + e.actorId());
  }
}` }
        ]
      }
    ],
    deepDive: [
      {
        title: "Fan-out on write versus fan-out on read",
        text: "Our `feedFor` pulls posts from every friend at read time (**fan-out on read**). It is simple and always fresh, but slow for users with thousands of friends. The alternative is **fan-out on write**: when someone posts, push the post id into each friend's precomputed feed list, so reads are a single lookup.\n\nPure fan-out on write breaks for celebrities with millions of followers, so real systems use a hybrid: push for normal users, pull for celebrity accounts and merge at read time. The `FeedService` interface stays the same, only its internals change."
      },
      {
        title: "Counters under heavy concurrency",
        text: "Reaction counts on a viral post become a hot key. Our `ConcurrentHashMap` is correct in memory, but at scale a single database row with a counter serialises every like. Shard the counter (N sub-counters summed on read) or aggregate asynchronously from an event stream, accepting that the displayed count is slightly stale.",
        code: [
          { file: "ShardedCounter.java", body: `import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.atomic.AtomicLongArray;

public class ShardedCounter {
  private final AtomicLongArray shards;

  public ShardedCounter(int shardCount) { this.shards = new AtomicLongArray(shardCount); }

  public void increment() {
    int i = ThreadLocalRandom.current().nextInt(shards.length());
    shards.incrementAndGet(i);
  }

  public long total() {
    long sum = 0;
    for (int i = 0; i < shards.length(); i++) sum += shards.get(i);
    return sum;
  }
}` }
        ]
      }
    ],
    mistakes: [
      "Storing friendship on only one side, so `A.isFriendsWith(B)` and `B.isFriendsWith(A)` disagree.",
      "Putting feed-ordering `if` statements into `FeedService` instead of a ranker.",
      "Checking visibility in the UI only. Enforce it in the model (`isVisibleTo`), where it cannot be skipped.",
      "A list of reactions per post, letting one user like twice. Key reactions by user id.",
      "Forcing a pattern in. Design patterns are good to have, but don't force one in just to impress the interviewer. A comment tree is a natural composite and the ranker a natural strategy; you don't need a factory around `Post`."
    ],
    followups: [
      "How would you add groups and pages with their own audiences?",
      "How would you implement 'friends of friends' suggestions?",
      "How would you add blocking, and where does it apply in the feed?",
      "How do you paginate a feed that is changing while the user scrolls?"
    ],
    patterns: ["observer", "strategy", "composite"]
  }
);
