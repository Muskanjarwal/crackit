window.QUESTIONS = window.QUESTIONS || [];
window.QUESTIONS.push(
  {
    id: "stack-overflow",
    name: "Design Stack Overflow",
    difficulty: "medium",
    understanding: "A Q&A platform where users post questions and answers, comment, vote, tag content, accept the best answer and earn reputation. The interesting parts are modelling things that can be voted on without duplicating logic, keeping reputation consistent with votes, and keeping search extensible.",
    dialogue: [
      { who: "you", text: "What can a user do on the platform?" },
      { who: "int", text: "Post questions, answer them, comment on both, and vote on questions and answers." },
      { who: "you", text: "Are questions categorised?" },
      { who: "int", text: "Yes, with tags. A question has one or more tags, and people search by tag, keyword or author." },
      { who: "you", text: "Is there an accepted answer?" },
      { who: "int", text: "Only the question's author can accept one answer." },
      { who: "you", text: "How does reputation work?" },
      { who: "int", text: "Upvotes on your question or answer raise your reputation, downvotes lower it, and an accepted answer gives a bonus. The numbers will change over time." },
      { who: "you", text: "Can a user vote more than once on the same post?" },
      { who: "int", text: "No. One vote per user per post, but they can change or retract it." },
      { who: "you", text: "Should I worry about concurrent votes?" },
      { who: "int", text: "Yes. Counts and reputation must stay correct when many people vote at once." }
    ],
    requirements: [
      { group: "Core", items: [
        "Users can post questions with a title, body and tags.",
        "Users can answer questions and comment on questions and answers.",
        "Users can upvote or downvote a question or answer, one vote per user per post.",
        "The question author can accept one answer.",
        "Users can search questions by keyword, tag or author."
      ] },
      { group: "Concurrency", items: [
        "Vote counts and reputation stay correct under concurrent voting."
      ] },
      { group: "Extensibility", items: [
        "Reputation rules can change without touching voting code.",
        "New search filters can be added without modifying the search service."
      ] }
    ],
    entities: [
      { name: "User", text: "has a name and a reputation score." },
      { name: "Post (abstract)", text: "shared base of Question and Answer: author, body, votes, comments, creation time." },
      { name: "Question", text: "a Post with a title, tags, answers and an optional accepted answer." },
      { name: "Answer", text: "a Post that belongs to one Question." },
      { name: "Comment", text: "short text attached to a Post." },
      { name: "Tag", text: "a label used to categorise questions." },
      { name: "Vote", text: "one user's UP or DOWN vote on one post." },
      { name: "ReputationPolicy", text: "decides how many points each event is worth." },
      { name: "SearchService", text: "finds questions using pluggable filters." }
    ],
    design: [
      {
        heading: "Requirement 1: Questions, answers and comments share a Post",
        text: "Questions and answers are both voted on and commented on. Put that shared state in an abstract `Post` so voting, comments and authorship are written once. `Question` and `Answer` add only what is specific to them.",
        code: [
          { file: "Post.java", body: `public abstract class Post {
  private final String id = UUID.randomUUID().toString();
  private final User author;
  private final String body;
  private final Instant createdAt = Instant.now();
  private final List<Comment> comments = new CopyOnWriteArrayList<>();
  private final Map<String, Vote> votes = new ConcurrentHashMap<>();

  protected Post(User author, String body) {
    this.author = author;
    this.body = body;
  }

  public void addComment(Comment c) { comments.add(c); }
  public Map<String, Vote> votes() { return votes; }
  public User author() { return author; }
  public String id() { return id; }

  public int score() {
    return votes.values().stream().mapToInt(v -> v.type().delta()).sum();
  }
}` },
          { file: "Question.java", body: `public class Question extends Post {
  private final String title;
  private final Set<Tag> tags;
  private final List<Answer> answers = new CopyOnWriteArrayList<>();
  private volatile Answer accepted;

  public Question(User author, String title, String body, Set<Tag> tags) {
    super(author, body);
    this.title = title;
    this.tags = Set.copyOf(tags);
  }

  public void addAnswer(Answer a) { answers.add(a); }
  public String title() { return title; }
  public Set<Tag> tags() { return tags; }
  public Answer accepted() { return accepted; }

  public void accept(User actor, Answer answer) {
    if (!actor.equals(author())) throw new IllegalStateException("Only the author can accept");
    if (!answers.contains(answer)) throw new IllegalArgumentException("Not an answer to this question");
    this.accepted = answer;
  }
}` },
          { file: "Answer.java", body: `public class Answer extends Post {
  private final Question question;

  public Answer(User author, String body, Question question) {
    super(author, body);
    this.question = question;
  }

  public Question question() { return question; }
}` }
        ],
        note: "Inheritance is justified here because Question and Answer are genuinely substitutable as `Post`s for voting and commenting."
      },
      {
        heading: "Requirement 2: Voting, one vote per user",
        text: "Store votes in a map keyed by user id. That makes 'one vote per user' a structural guarantee instead of a check someone can forget, and changing or retracting a vote is a simple replace or remove. `VoteType` carries its own delta so score is a sum.",
        code: [
          { file: "VoteType.java", body: `public enum VoteType {
  UP(1), DOWN(-1);

  private final int delta;
  VoteType(int delta) { this.delta = delta; }
  public int delta() { return delta; }
}` },
          { file: "Vote.java", body: `public record Vote(User voter, VoteType type) {}` },
          { file: "VotingService.java", body: `public class VotingService {
  private final List<VoteListener> listeners = new CopyOnWriteArrayList<>();

  public void subscribe(VoteListener l) { listeners.add(l); }

  public void vote(User voter, Post post, VoteType type) {
    if (post.author().equals(voter)) throw new IllegalArgumentException("Cannot vote on your own post");

    Vote previous = post.votes().put(voter.id(), new Vote(voter, type));
    if (previous != null && previous.type() == type) return; // no change

    for (VoteListener l : listeners) l.onVoteChanged(post, previous, type);
  }

  public void retract(User voter, Post post) {
    Vote previous = post.votes().remove(voter.id());
    if (previous != null) {
      for (VoteListener l : listeners) l.onVoteChanged(post, previous, null);
    }
  }
}` }
        ]
      },
      {
        heading: "Requirement 3: Reputation reacts to events (Observer + Strategy)",
        text: "Voting should not know that reputation exists. `VotingService` publishes an event, and a reputation listener translates it into points. The point values come from a `ReputationPolicy`, so changing the rules never touches voting.",
        code: [
          { file: "VoteListener.java", body: `public interface VoteListener {
  // previous or current may be null (new vote / retracted vote)
  void onVoteChanged(Post post, Vote previous, VoteType current);
}` },
          { file: "ReputationPolicy.java", body: `public interface ReputationPolicy {
  int pointsFor(Post post, VoteType type);
  int acceptedAnswerBonus();
}

public class DefaultReputationPolicy implements ReputationPolicy {
  public int pointsFor(Post post, VoteType type) {
    boolean isQuestion = post instanceof Question;
    if (type == VoteType.UP) return isQuestion ? 5 : 10;
    return -2;
  }
  public int acceptedAnswerBonus() { return 15; }
}` },
          { file: "ReputationListener.java", body: `public class ReputationListener implements VoteListener {
  private final ReputationPolicy policy;

  public ReputationListener(ReputationPolicy policy) { this.policy = policy; }

  public void onVoteChanged(Post post, Vote previous, VoteType current) {
    int delta = 0;
    if (previous != null) delta -= policy.pointsFor(post, previous.type());
    if (current != null)  delta += policy.pointsFor(post, current);
    post.author().addReputation(delta);
  }
}` }
        ],
        note: "Replacing a vote subtracts the old vote's points before adding the new ones, so reputation never drifts."
      },
      {
        heading: "Requirement 4: Search with composable filters",
        text: "Each way of narrowing results is a small predicate object. `SearchService` ANDs together whatever filters the caller supplies. Adding 'unanswered only' is a new class, not an edit to the service.",
        code: [
          { file: "QuestionFilter.java", body: `public interface QuestionFilter {
  boolean matches(Question q);
}` },
          { file: "Filters.java", body: `public class KeywordFilter implements QuestionFilter {
  private final String keyword;
  public KeywordFilter(String keyword) { this.keyword = keyword.toLowerCase(); }
  public boolean matches(Question q) { return q.title().toLowerCase().contains(keyword); }
}

public class TagFilter implements QuestionFilter {
  private final Tag tag;
  public TagFilter(Tag tag) { this.tag = tag; }
  public boolean matches(Question q) { return q.tags().contains(tag); }
}

public class AuthorFilter implements QuestionFilter {
  private final User author;
  public AuthorFilter(User author) { this.author = author; }
  public boolean matches(Question q) { return q.author().equals(author); }
}` },
          { file: "SearchService.java", body: `public class SearchService {
  private final Collection<Question> questions;

  public SearchService(Collection<Question> questions) { this.questions = questions; }

  public List<Question> search(List<QuestionFilter> filters) {
    return questions.stream()
        .filter(q -> filters.stream().allMatch(f -> f.matches(q)))
        .collect(Collectors.toList());
  }
}` }
        ]
      }
    ],
    deepDive: [
      {
        title: "Keeping counts correct under concurrent voting",
        text: "Because votes live in a `ConcurrentHashMap` keyed by user, two different users voting at the same time never conflict, and the same user double-clicking is naturally idempotent: the second `put` returns the previous identical vote and we return early. The remaining hazard is reputation: `User.addReputation` must be atomic.",
        code: [
          { file: "User.java", body: `public class User {
  private final String id = UUID.randomUUID().toString();
  private final String name;
  private final AtomicInteger reputation = new AtomicInteger();

  public User(String name) { this.name = name; }

  public void addReputation(int delta) { reputation.addAndGet(delta); }
  public int reputation() { return reputation.get(); }
  public String id() { return id; }
}` }
        ]
      },
      {
        title: "Scaling search beyond a linear scan",
        text: "Streaming over every question is fine for an interview, but it is O(n) per search. In production keep an inverted index from tag to question ids and from keyword to question ids, intersect the id sets for the active filters, and delegate full-text to a search engine. The `QuestionFilter` interface still works as the post-filter for conditions the index cannot answer."
      }
    ],
    mistakes: [
      "Duplicating vote and comment logic separately in Question and Answer instead of sharing a Post.",
      "Storing votes in a list and checking for duplicates by scanning, which is slow and racy.",
      "Updating reputation directly inside the voting method, so changing the rules means editing voting code.",
      "Forgetting to undo the previous vote's reputation when a user flips their vote.",
      "Forcing a pattern in just to impress the interviewer. Observer and Strategy are justified here because reputation rules change; use plain methods where nothing varies."
    ],
    followups: [
      "How would you add bounties or a 'close question' workflow?",
      "How would you prevent vote-ring abuse?",
      "How would you support editing history for a post?"
    ],
    patterns: ["observer", "strategy"]
  },

  {
    id: "atm",
    name: "Design ATM",
    difficulty: "medium",
    understanding: "An ATM lets a customer insert a card, authenticate with a PIN, check balance, withdraw cash and eject the card. What makes it a good LLD question is that valid actions depend entirely on the machine's current step, and that cash must be dispensed in the right notes from a limited supply.",
    dialogue: [
      { who: "you", text: "What operations should the ATM support?" },
      { who: "int", text: "Insert card, enter PIN, check balance, withdraw cash, and eject card." },
      { who: "you", text: "Does the ATM talk to a bank?" },
      { who: "int", text: "Yes. Treat the bank as an external service that validates PINs and debits accounts." },
      { who: "you", text: "What happens if someone tries to withdraw before entering a PIN?" },
      { who: "int", text: "It should be rejected. Only operations valid for the current step should work." },
      { who: "you", text: "How is cash dispensed?" },
      { who: "int", text: "The ATM holds notes of several denominations in limited quantity, and it should pay out using the available notes." },
      { who: "you", text: "What if the ATM can't make the exact amount?" },
      { who: "int", text: "Reject the request without debiting the account." },
      { who: "you", text: "Do we need to support new denominations later?" },
      { who: "int", text: "Possibly, so don't hard-code them." }
    ],
    requirements: [
      { group: "Core", items: [
        "Insert a card and authenticate with a PIN.",
        "Check balance and withdraw cash after authentication.",
        "Dispense the requested amount using available notes, or reject it.",
        "Eject the card at any point, ending the session."
      ] },
      { group: "Concurrency", items: [
        "Only one customer session at a time; the machine's state must be consistent."
      ] },
      { group: "Extensibility", items: [
        "New denominations can be added without changing the dispenser logic.",
        "New operations (deposit, PIN change) can be added with limited impact."
      ] }
    ],
    entities: [
      { name: "ATM", text: "the context. Holds the current state, cash inventory and card session." },
      { name: "ATMState", text: "interface with one method per user action. Implemented by Idle, CardInserted and Authenticated." },
      { name: "Card", text: "card number and the account it belongs to." },
      { name: "BankService", text: "external dependency: validate PIN, get balance, debit." },
      { name: "CashDispenser", text: "chain of note handlers that pay out an amount." },
      { name: "NoteHandler", text: "dispenses one denomination, then passes the remainder on." }
    ],
    design: [
      {
        heading: "Requirement 1: Actions depend on the current step (State)",
        text: "Instead of `if (state == ...)` in every method, each step is an object that implements all actions. Illegal actions are rejected inside the state that does not allow them, and each state decides which state comes next.",
        code: [
          { file: "ATMState.java", body: `public interface ATMState {
  void insertCard(ATM atm, Card card);
  void enterPin(ATM atm, String pin);
  void checkBalance(ATM atm);
  void withdraw(ATM atm, int amount);
  void ejectCard(ATM atm);
}` },
          { file: "IdleState.java", body: `public class IdleState implements ATMState {
  public void insertCard(ATM atm, Card card) {
    atm.setCard(card);
    atm.setState(new CardInsertedState());
  }
  public void enterPin(ATM atm, String pin)   { throw new IllegalStateException("Insert a card first"); }
  public void checkBalance(ATM atm)           { throw new IllegalStateException("Insert a card first"); }
  public void withdraw(ATM atm, int amount)   { throw new IllegalStateException("Insert a card first"); }
  public void ejectCard(ATM atm)              { throw new IllegalStateException("No card inserted"); }
}` },
          { file: "CardInsertedState.java", body: `public class CardInsertedState implements ATMState {
  private int attempts;

  public void insertCard(ATM atm, Card card) { throw new IllegalStateException("Card already inserted"); }

  public void enterPin(ATM atm, String pin) {
    if (atm.bank().verifyPin(atm.card(), pin)) {
      atm.setState(new AuthenticatedState());
      return;
    }
    if (++attempts >= 3) {
      atm.ejectAndReset(); // too many failures
      throw new SecurityException("Card retained after 3 failed attempts");
    }
    throw new IllegalArgumentException("Wrong PIN");
  }

  public void checkBalance(ATM atm)         { throw new IllegalStateException("Enter PIN first"); }
  public void withdraw(ATM atm, int amount) { throw new IllegalStateException("Enter PIN first"); }
  public void ejectCard(ATM atm)            { atm.ejectAndReset(); }
}` }
        ]
      },
      {
        heading: "Requirement 2: Authenticated operations",
        text: "Only the authenticated state performs real work. It validates the amount, asks the dispenser whether it can pay, and only then debits the account, so a request that can't be fulfilled never touches the balance.",
        code: [
          { file: "AuthenticatedState.java", body: `public class AuthenticatedState implements ATMState {
  public void insertCard(ATM atm, Card card) { throw new IllegalStateException("Card already inserted"); }
  public void enterPin(ATM atm, String pin)  { throw new IllegalStateException("Already authenticated"); }

  public void checkBalance(ATM atm) {
    System.out.println("Balance: " + atm.bank().balance(atm.card()));
  }

  public void withdraw(ATM atm, int amount) {
    if (amount <= 0) throw new IllegalArgumentException("Invalid amount");
    if (!atm.dispenser().canDispense(amount)) throw new IllegalStateException("ATM cannot dispense " + amount);

    atm.bank().debit(atm.card(), amount);          // may throw: insufficient funds
    atm.dispenser().dispense(amount);
  }

  public void ejectCard(ATM atm) { atm.ejectAndReset(); }
}` },
          { file: "BankService.java", body: `public interface BankService {
  boolean verifyPin(Card card, String pin);
  long balance(Card card);
  void debit(Card card, long amount); // throws if insufficient funds
}` }
        ],
        note: "Order matters: check the dispenser can pay before debiting, otherwise a failed dispense would leave the customer charged."
      },
      {
        heading: "Requirement 3: Dispensing cash (Chain of Responsibility)",
        text: "Each denomination is a handler that takes as many notes as it can, then hands the remainder to the next smaller denomination. Adding a new note value means adding one handler to the chain.",
        code: [
          { file: "NoteHandler.java", body: `public class NoteHandler {
  private final int value;
  private int count;
  private NoteHandler next;

  public NoteHandler(int value, int count) { this.value = value; this.count = count; }
  public NoteHandler then(NoteHandler next) { this.next = next; return next; }

  // Plans the notes without mutating stock; returns remainder that could not be covered.
  int plan(int amount, Map<Integer, Integer> out) {
    int use = Math.min(amount / value, count);
    if (use > 0) out.put(value, use);
    int remaining = amount - use * value;
    return (remaining > 0 && next != null) ? next.plan(remaining, out) : remaining;
  }

  void commit(Map<Integer, Integer> plan) {
    Integer used = plan.get(value);
    if (used != null) count -= used;
    if (next != null) next.commit(plan);
  }
}` },
          { file: "CashDispenser.java", body: `public class CashDispenser {
  private final NoteHandler head;

  public CashDispenser(NoteHandler head) { this.head = head; }

  public boolean canDispense(int amount) {
    return head.plan(amount, new HashMap<>()) == 0;
  }

  public Map<Integer, Integer> dispense(int amount) {
    Map<Integer, Integer> plan = new LinkedHashMap<>();
    if (head.plan(amount, plan) != 0) throw new IllegalStateException("Cannot dispense exact amount");
    head.commit(plan);
    return plan;
  }
}` }
        ],
        note: "Greedy largest-first works for standard denominations like 2000/500/100. For arbitrary denominations it can fail where a solution exists; see the deep dive."
      },
      {
        heading: "Putting it together: the ATM context",
        text: "The ATM is a thin context. It forwards every action to its current state and exposes setters the states use for transitions.",
        code: [
          { file: "ATM.java", body: `public class ATM {
  private ATMState state = new IdleState();
  private Card card;
  private final BankService bank;
  private final CashDispenser dispenser;

  public ATM(BankService bank, CashDispenser dispenser) {
    this.bank = bank;
    this.dispenser = dispenser;
  }

  public synchronized void insertCard(Card c)   { state.insertCard(this, c); }
  public synchronized void enterPin(String pin) { state.enterPin(this, pin); }
  public synchronized void checkBalance()       { state.checkBalance(this); }
  public synchronized void withdraw(int amount) { state.withdraw(this, amount); }
  public synchronized void ejectCard()          { state.ejectCard(this); }

  void ejectAndReset() { this.card = null; this.state = new IdleState(); }
  void setState(ATMState s) { this.state = s; }
  void setCard(Card c) { this.card = c; }
  Card card() { return card; }
  BankService bank() { return bank; }
  CashDispenser dispenser() { return dispenser; }
}` }
        ]
      }
    ],
    deepDive: [
      {
        title: "When greedy dispensing is wrong",
        text: "Largest-first fails for unusual note sets: with notes of 5 and 3 and a request for 9, greedy takes one 5, leaves 4 and gives up, although 3+3+3 works. If denominations are arbitrary, replace the chain's `plan` with a bounded coin-change DP (or DFS with memoisation) that finds any valid combination, and keep the chain only for the standard case. The `CashDispenser` interface stays the same, so this is a swap-in change."
      },
      {
        title: "Concurrency and atomicity with the bank",
        text: "A physical ATM serves one customer at a time, so `synchronized` on the ATM is enough locally. The real hazard is a crash between `debit` and `dispense`. Make the debit a reservation with an id, dispense, then confirm; on failure, reverse the reservation. This is the same two-step 'hold then confirm' idea used in booking systems."
      }
    ],
    mistakes: [
      "Writing one big `if (state == HAS_CARD && ...)` ladder in every method instead of using State.",
      "Debiting the account before checking the machine can dispense the amount.",
      "Hard-coding 2000/500/100 inside the withdraw method so a new note means editing core logic.",
      "Retaining PIN attempt counts outside the session, so they leak between customers.",
      "Forcing a pattern in just to impress the interviewer. State and Chain of Responsibility fit here; a plain method would do for something like balance lookup."
    ],
    followups: [
      "How would you add deposits and cheque deposits?",
      "How would you handle the ATM running low on cash and alerting operations?",
      "How would you make the bank call idempotent if the network times out?"
    ],
    patterns: ["state", "chain-of-responsibility"]
  },

  {
    id: "logging-framework",
    name: "Design Logging Framework",
    difficulty: "medium",
    understanding: "A logging framework accepts messages at different severity levels, filters them by a configured threshold, formats them and writes them to one or more destinations. The design challenge is keeping levels, formatting and destinations independent so each can change without affecting the others, while staying cheap and safe to call from many threads.",
    dialogue: [
      { who: "you", text: "Which log levels do we need?" },
      { who: "int", text: "DEBUG, INFO, WARN, ERROR and FATAL, in increasing severity." },
      { who: "you", text: "Where can logs go?" },
      { who: "int", text: "Console and file to start with, but we'll want to add things like a remote service later." },
      { who: "you", text: "Can the same message go to several destinations?" },
      { who: "int", text: "Yes. Each destination may have its own minimum level and format." },
      { who: "you", text: "Should callers choose a format?" },
      { who: "int", text: "Formatting should be configurable per destination: plain text, JSON, and so on." },
      { who: "you", text: "Will many threads log at once?" },
      { who: "int", text: "Yes, and logging should not slow the application down noticeably." },
      { who: "you", text: "Is there one global logger or several named ones?" },
      { who: "int", text: "Named loggers per class or module are fine, obtained from a central place." }
    ],
    requirements: [
      { group: "Core", items: [
        "Log messages at DEBUG, INFO, WARN, ERROR and FATAL.",
        "Drop messages below the configured minimum level.",
        "Send each message to one or more destinations (appenders).",
        "Format messages per destination."
      ] },
      { group: "Concurrency", items: [
        "Safe to call from multiple threads without interleaved output.",
        "Slow destinations must not block application threads."
      ] },
      { group: "Extensibility", items: [
        "New destinations and formats can be added without changing existing classes."
      ] }
    ],
    entities: [
      { name: "LogLevel", text: "ordered enum of severities." },
      { name: "LogEvent", text: "immutable record of level, message, timestamp, thread and logger name." },
      { name: "Logger", text: "the entry point callers use; checks the level and builds events." },
      { name: "Appender", text: "a destination such as console or file." },
      { name: "Formatter", text: "turns a LogEvent into text." },
      { name: "LoggerFactory", text: "central registry returning named loggers." }
    ],
    design: [
      {
        heading: "Requirement 1: Levels and the log event",
        text: "Declare levels in increasing severity so filtering is a numeric comparison. Capture everything about a log call in an immutable `LogEvent`, so appenders on other threads can't see it change.",
        code: [
          { file: "LogLevel.java", body: `public enum LogLevel {
  DEBUG, INFO, WARN, ERROR, FATAL;

  public boolean isAtLeast(LogLevel threshold) {
    return this.ordinal() >= threshold.ordinal();
  }
}` },
          { file: "LogEvent.java", body: `public record LogEvent(
    Instant timestamp,
    LogLevel level,
    String loggerName,
    String threadName,
    String message) {}` }
        ]
      },
      {
        heading: "Requirement 2: Formatting and destinations (Strategy)",
        text: "Formatting and writing vary independently, so each gets its own interface. An appender owns a formatter and a minimum level; adding JSON output or a network sink is a new class.",
        code: [
          { file: "Formatter.java", body: `public interface Formatter {
  String format(LogEvent e);
}

public class PlainTextFormatter implements Formatter {
  public String format(LogEvent e) {
    return String.format("%s [%s] %-5s %s - %s",
        e.timestamp(), e.threadName(), e.level(), e.loggerName(), e.message());
  }
}

public class JsonFormatter implements Formatter {
  public String format(LogEvent e) {
    return String.format("{\\"ts\\":\\"%s\\",\\"level\\":\\"%s\\",\\"logger\\":\\"%s\\",\\"msg\\":\\"%s\\"}",
        e.timestamp(), e.level(), e.loggerName(), e.message().replace("\\"", "\\\\\\""));
  }
}` },
          { file: "Appender.java", body: `public interface Appender {
  void append(LogEvent event);
  LogLevel minLevel();
}

public class ConsoleAppender implements Appender {
  private final Formatter formatter;
  private final LogLevel min;

  public ConsoleAppender(Formatter formatter, LogLevel min) {
    this.formatter = formatter;
    this.min = min;
  }

  public void append(LogEvent e) { System.out.println(formatter.format(e)); }
  public LogLevel minLevel() { return min; }
}

public class FileAppender implements Appender {
  private final Formatter formatter;
  private final LogLevel min;
  private final BufferedWriter out;

  public FileAppender(Path file, Formatter formatter, LogLevel min) throws IOException {
    this.out = Files.newBufferedWriter(file, StandardOpenOption.CREATE, StandardOpenOption.APPEND);
    this.formatter = formatter;
    this.min = min;
  }

  public synchronized void append(LogEvent e) {
    try {
      out.write(formatter.format(e));
      out.newLine();
      out.flush();
    } catch (IOException ex) {
      System.err.println("Logging failed: " + ex.getMessage());
    }
  }

  public LogLevel minLevel() { return min; }
}` }
        ]
      },
      {
        heading: "Requirement 3: Logger fans out to appenders",
        text: "The `Logger` checks the threshold first so disabled levels cost almost nothing, builds the event once, and hands it to every appender whose own minimum level it meets. Each appender decides independently, which is a light chain-of-responsibility style filter.",
        code: [
          { file: "Logger.java", body: `public class Logger {
  private final String name;
  private final LogLevel level;
  private final List<Appender> appenders;

  Logger(String name, LogLevel level, List<Appender> appenders) {
    this.name = name;
    this.level = level;
    this.appenders = appenders;
  }

  public void debug(String msg) { log(LogLevel.DEBUG, msg); }
  public void info(String msg)  { log(LogLevel.INFO, msg); }
  public void warn(String msg)  { log(LogLevel.WARN, msg); }
  public void error(String msg) { log(LogLevel.ERROR, msg); }
  public void fatal(String msg) { log(LogLevel.FATAL, msg); }

  private void log(LogLevel lvl, String msg) {
    if (!lvl.isAtLeast(level)) return;           // cheap early exit
    LogEvent e = new LogEvent(Instant.now(), lvl, name, Thread.currentThread().getName(), msg);
    for (Appender a : appenders) {
      if (lvl.isAtLeast(a.minLevel())) a.append(e);
    }
  }
}` }
        ]
      },
      {
        heading: "Requirement 4: Named loggers from one registry (Singleton)",
        text: "Loggers need to share configuration and appenders, so they come from a single registry. Use an enum singleton for safe lazy initialisation, and cache loggers by name.",
        code: [
          { file: "LoggerFactory.java", body: `public enum LoggerFactory {
  INSTANCE;

  private volatile LogLevel rootLevel = LogLevel.INFO;
  private final List<Appender> appenders = new CopyOnWriteArrayList<>();
  private final Map<String, Logger> loggers = new ConcurrentHashMap<>();

  public void configure(LogLevel level, List<Appender> configured) {
    this.rootLevel = level;
    this.appenders.clear();
    this.appenders.addAll(configured);
    loggers.clear();
  }

  public Logger get(String name) {
    return loggers.computeIfAbsent(name, n -> new Logger(n, rootLevel, appenders));
  }
}` },
          { file: "Main.java", body: `LoggerFactory.INSTANCE.configure(LogLevel.DEBUG, List.of(
    new ConsoleAppender(new PlainTextFormatter(), LogLevel.INFO),
    new FileAppender(Path.of("app.log"), new JsonFormatter(), LogLevel.DEBUG)
));

Logger log = LoggerFactory.INSTANCE.get("OrderService");
log.info("Order placed");
log.debug("cart=3 items");` }
        ],
        note: "Only the registry is a singleton. `Logger` and `Appender` are ordinary objects, so tests can build isolated instances."
      }
    ],
    deepDive: [
      {
        title: "Asynchronous appenders so slow I/O never blocks callers",
        text: "A file or network write can take milliseconds. Wrap any appender in an `AsyncAppender` that puts events on a bounded queue and drains it from a background thread. The bounded queue forces a policy decision when full: block, drop the oldest, or drop DEBUG first. Decorating an existing appender keeps this concern out of the other classes.",
        code: [
          { file: "AsyncAppender.java", body: `public class AsyncAppender implements Appender {
  private final Appender delegate;
  private final BlockingQueue<LogEvent> queue = new ArrayBlockingQueue<>(10_000);
  private final Thread worker;

  public AsyncAppender(Appender delegate) {
    this.delegate = delegate;
    this.worker = new Thread(this::drain, "log-writer");
    this.worker.setDaemon(true);
    this.worker.start();
  }

  public void append(LogEvent e) {
    if (!queue.offer(e) && e.level().isAtLeast(LogLevel.ERROR)) {
      try { queue.put(e); } catch (InterruptedException ie) { Thread.currentThread().interrupt(); }
    } // low-severity events are dropped when the queue is full
  }

  private void drain() {
    try {
      while (true) delegate.append(queue.take());
    } catch (InterruptedException ie) { Thread.currentThread().interrupt(); }
  }

  public LogLevel minLevel() { return delegate.minLevel(); }
}` }
        ]
      },
      {
        title: "Lazy message building",
        text: "Callers often build expensive strings that a disabled level then throws away. Accept a `Supplier<String>` overload (`log.debug(() -> expensive())`) so the message is only built when the level is enabled. This is the same reason the `Logger` checks the threshold before constructing a `LogEvent`."
      }
    ],
    mistakes: [
      "Making every class a singleton instead of only the registry, which makes tests share global state.",
      "Formatting the message inside the logger so every output must use the same format.",
      "Writing to a file from many threads without synchronisation, interleaving lines.",
      "Doing blocking I/O on the caller's thread for every log call.",
      "Forcing a pattern in just to impress the interviewer. Strategy for formatters and appenders is earned by real variation; a Chain of Responsibility with a handler class per level would be overkill."
    ],
    followups: [
      "How would you add log rotation by size or date?",
      "How would you add contextual data (request id) to every log line?",
      "How would you change log levels at runtime without a restart?"
    ],
    patterns: ["singleton", "strategy", "decorator", "chain-of-responsibility"]
  },

  {
    id: "pub-sub-system",
    name: "Design Pub Sub System",
    difficulty: "medium",
    understanding: "A publish/subscribe system lets publishers send messages to named topics without knowing who is listening, and delivers each message to every subscriber of that topic. The challenge is decoupling publishers from subscribers while making sure one slow or failing subscriber doesn't hold up the others, and defining clear ordering guarantees.",
    dialogue: [
      { who: "you", text: "What are the main actors?" },
      { who: "int", text: "Publishers that send messages to a topic, and subscribers that receive messages from topics they subscribed to." },
      { who: "you", text: "Can a subscriber listen to several topics?" },
      { who: "int", text: "Yes, and a topic can have many subscribers." },
      { who: "you", text: "Does every subscriber get every message?" },
      { who: "int", text: "Yes, each subscriber receives each message published after it subscribed." },
      { who: "you", text: "What if one subscriber is slow?" },
      { who: "int", text: "It must not delay the others, or the publisher." },
      { who: "you", text: "Do messages need to arrive in order?" },
      { who: "int", text: "Per subscriber, messages from one topic should arrive in the order they were published." },
      { who: "you", text: "What about subscriber failures?" },
      { who: "int", text: "A failure in one subscriber must not affect the others. You can keep it simple on retries." },
      { who: "you", text: "Is this in-process or a network service?" },
      { who: "int", text: "In-process is fine, but keep the design so a network transport could slot in." }
    ],
    requirements: [
      { group: "Core", items: [
        "Create topics and publish messages to them.",
        "Subscribe to and unsubscribe from topics.",
        "Deliver each message to all current subscribers of the topic."
      ] },
      { group: "Concurrency", items: [
        "Publishing is non-blocking and thread-safe.",
        "A slow or failing subscriber does not affect others.",
        "Messages are delivered to a subscriber in publish order."
      ] },
      { group: "Extensibility", items: [
        "Subscribers can be added for new use cases without changing publishers.",
        "Message filtering or alternate delivery policies can be added later."
      ] }
    ],
    entities: [
      { name: "Message", text: "immutable payload with id and timestamp." },
      { name: "Topic", text: "a named channel holding its subscribers." },
      { name: "Subscriber", text: "interface with `onMessage`; implemented by consumers." },
      { name: "Publisher", text: "facade used to publish to a topic by name." },
      { name: "Broker", text: "owns topics, subscriptions and delivery." },
      { name: "SubscriberWorker", text: "per-subscriber queue and thread that delivers in order." }
    ],
    design: [
      {
        heading: "Requirement 1: Topics, subscribers and messages (Observer)",
        text: "This is Observer with an indirection: publishers talk to a topic, topics talk to subscribers. Subscribers implement a tiny interface, so publishers never depend on concrete consumers.",
        code: [
          { file: "Message.java", body: `public record Message(String id, String topic, String payload, Instant timestamp) {
  public static Message of(String topic, String payload) {
    return new Message(UUID.randomUUID().toString(), topic, payload, Instant.now());
  }
}` },
          { file: "Subscriber.java", body: `public interface Subscriber {
  String id();
  void onMessage(Message message);
}` },
          { file: "Topic.java", body: `public class Topic {
  private final String name;
  private final Set<SubscriberWorker> workers = ConcurrentHashMap.newKeySet();

  public Topic(String name) { this.name = name; }

  public String name() { return name; }
  void add(SubscriberWorker w)    { workers.add(w); }
  void remove(SubscriberWorker w) { workers.remove(w); }
  Collection<SubscriberWorker> subscribers() { return workers; }
}` }
        ]
      },
      {
        heading: "Requirement 2: Per-subscriber queues for isolation and ordering",
        text: "Calling subscribers directly from `publish` would let one slow subscriber block everyone. Give each subscription its own queue and a single worker thread. Publishing becomes 'enqueue to each queue', which is fast, and each subscriber sees messages in the order they were enqueued.",
        code: [
          { file: "SubscriberWorker.java", body: `class SubscriberWorker implements Runnable {
  private final Subscriber subscriber;
  private final BlockingQueue<Message> queue = new LinkedBlockingQueue<>();
  private volatile boolean running = true;

  SubscriberWorker(Subscriber subscriber) { this.subscriber = subscriber; }

  void enqueue(Message m) { queue.offer(m); }
  Subscriber subscriber() { return subscriber; }
  void stop() { running = false; }

  public void run() {
    while (running || !queue.isEmpty()) {
      try {
        Message m = queue.poll(200, TimeUnit.MILLISECONDS);
        if (m != null) subscriber.onMessage(m);
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
        return;
      } catch (RuntimeException e) {
        // isolate failures: log and continue with the next message
        System.err.println("Subscriber " + subscriber.id() + " failed: " + e.getMessage());
      }
    }
  }
}` }
        ],
        note: "Catching the exception inside the worker is what keeps a buggy subscriber from stopping delivery to itself, and never to anyone else."
      },
      {
        heading: "Requirement 3: The broker manages topics and subscriptions",
        text: "The broker is the only class that knows about topics and workers. It creates a worker per (topic, subscriber) subscription and starts it on a thread pool.",
        code: [
          { file: "Broker.java", body: `public class Broker {
  private final Map<String, Topic> topics = new ConcurrentHashMap<>();
  private final Map<String, SubscriberWorker> workers = new ConcurrentHashMap<>(); // key: topic|subscriber
  private final ExecutorService pool = Executors.newCachedThreadPool();

  public void createTopic(String name) {
    topics.putIfAbsent(name, new Topic(name));
  }

  public void subscribe(String topicName, Subscriber subscriber) {
    Topic topic = require(topicName);
    workers.computeIfAbsent(topicName + "|" + subscriber.id(), k -> {
      SubscriberWorker w = new SubscriberWorker(subscriber);
      topic.add(w);
      pool.submit(w);
      return w;
    });
  }

  public void unsubscribe(String topicName, Subscriber subscriber) {
    SubscriberWorker w = workers.remove(topicName + "|" + subscriber.id());
    if (w != null) {
      require(topicName).remove(w);
      w.stop();
    }
  }

  public void publish(String topicName, String payload) {
    Message m = Message.of(topicName, payload);
    for (SubscriberWorker w : require(topicName).subscribers()) w.enqueue(m);
  }

  private Topic require(String name) {
    Topic t = topics.get(name);
    if (t == null) throw new IllegalArgumentException("Unknown topic " + name);
    return t;
  }

  public void shutdown() { workers.values().forEach(SubscriberWorker::stop); pool.shutdown(); }
}` },
          { file: "Publisher.java", body: `public class Publisher {
  private final Broker broker;
  public Publisher(Broker broker) { this.broker = broker; }

  public void publish(String topic, String payload) { broker.publish(topic, payload); }
}` }
        ]
      },
      {
        heading: "Requirement 4: Using it",
        text: "Publishers and subscribers only ever see the broker. Neither knows about the other, and new consumers need no publisher changes.",
        code: [
          { file: "Main.java", body: `Broker broker = new Broker();
broker.createTopic("orders");

Subscriber billing = new Subscriber() {
  public String id() { return "billing"; }
  public void onMessage(Message m) { System.out.println("Billing got " + m.payload()); }
};
Subscriber email = new Subscriber() {
  public String id() { return "email"; }
  public void onMessage(Message m) { System.out.println("Email got " + m.payload()); }
};

broker.subscribe("orders", billing);
broker.subscribe("orders", email);

new Publisher(broker).publish("orders", "order-42 created");` }
        ]
      }
    ],
    deepDive: [
      {
        title: "Bounded queues and back-pressure",
        text: "The unbounded `LinkedBlockingQueue` above can grow without limit if a subscriber is permanently slow. Switch to an `ArrayBlockingQueue` and choose a policy when it fills: drop the oldest message, drop the new one and count it, or block the publisher (which sacrifices isolation). Dropping with a metric is common for telemetry; blocking suits payments where loss is unacceptable."
      },
      {
        title: "Delivery guarantees and filtering",
        text: "This design gives at-most-once delivery within the process: if the process dies, queued messages vanish. At-least-once needs a persisted log with per-subscriber offsets and acknowledgements, so a subscriber resumes from its last acknowledged offset. For filtering, give `subscribe` an optional `Predicate<Message>` stored alongside the worker, and test it in `publish` before enqueueing, which avoids queueing messages a subscriber would ignore."
      }
    ],
    mistakes: [
      "Invoking subscriber callbacks synchronously inside `publish`, so one slow subscriber blocks everyone.",
      "Sharing one queue across subscribers, which breaks per-subscriber isolation and ordering.",
      "Letting a subscriber exception propagate into the publisher or other subscribers.",
      "Mutating the subscriber set while iterating without a concurrent collection.",
      "Forcing a pattern in just to impress the interviewer. Observer is the heart of the problem, but wrapping every message in a Command object adds ceremony with no benefit here."
    ],
    followups: [
      "How would you support consumer groups where only one member gets each message?",
      "How would you replay messages for a new subscriber?",
      "How would you partition a hot topic across several brokers while keeping order per key?"
    ],
    patterns: ["observer"]
  },

  {
    id: "elevator-system",
    name: "Design Elevator System",
    difficulty: "medium",
    understanding: "A building has several elevators serving requests from hallway buttons and from inside the cars. The system must decide which elevator should take each request, and each elevator must move efficiently, serving requests along its direction of travel. The design splits cleanly into three concerns: elevator behaviour, request dispatching and the controller that wires them together.",
    dialogue: [
      { who: "you", text: "How many elevators and floors?" },
      { who: "int", text: "Several elevators, configurable, in a building with a configurable number of floors." },
      { who: "you", text: "What kinds of requests exist?" },
      { who: "int", text: "External requests from a floor with an up or down button, and internal requests from inside the car selecting a destination floor." },
      { who: "you", text: "Which elevator handles an external request?" },
      { who: "int", text: "That's up to your scheduling. The goal is to keep waiting time low." },
      { who: "you", text: "Does an elevator stop at floors in the middle of its trip?" },
      { who: "int", text: "Yes. If it is going up and someone above wants to go up, it should pick them up on the way." },
      { who: "you", text: "What states can an elevator be in?" },
      { who: "int", text: "Moving up, moving down, or idle. Doors and weight limits we can ignore for now." },
      { who: "you", text: "Will requests arrive while elevators are moving?" },
      { who: "int", text: "Constantly, from many threads." },
      { who: "you", text: "Could we want a different dispatch algorithm later?" },
      { who: "int", text: "Very likely. Keep it swappable." }
    ],
    requirements: [
      { group: "Core", items: [
        "Support multiple elevators across a fixed number of floors.",
        "Accept external requests (floor, direction) and internal requests (destination floor).",
        "Assign each external request to one elevator.",
        "Each elevator serves floors along its direction before reversing."
      ] },
      { group: "Concurrency", items: [
        "Requests arrive from many threads while elevators move."
      ] },
      { group: "Extensibility", items: [
        "The dispatch algorithm can be changed without touching elevator logic.",
        "New elevator behaviours (maintenance, out of service) can be added."
      ] }
    ],
    entities: [
      { name: "Direction", text: "UP, DOWN or IDLE." },
      { name: "Request", text: "an external request (floor + direction)." },
      { name: "Elevator", text: "current floor, direction and the sorted stops it must make." },
      { name: "DispatchStrategy", text: "chooses the best elevator for an external request." },
      { name: "ElevatorController", text: "receives requests, dispatches, and drives the elevators." }
    ],
    design: [
      {
        heading: "Requirement 1: An elevator that serves stops along its direction",
        text: "Each elevator keeps two sorted sets of stops: those above it (served going up) and those below it (served going down). It moves one floor per step, stops if the current floor is requested, and reverses only when nothing remains in its direction. This is the classic SCAN behaviour.",
        code: [
          { file: "Direction.java", body: `public enum Direction { UP, DOWN, IDLE }` },
          { file: "Elevator.java", body: `public class Elevator {
  private final int id;
  private int currentFloor = 0;
  private Direction direction = Direction.IDLE;
  private final TreeSet<Integer> upStops = new TreeSet<>();
  private final TreeSet<Integer> downStops = new TreeSet<>(Comparator.reverseOrder());

  public Elevator(int id) { this.id = id; }

  public synchronized void addStop(int floor) {
    if (floor == currentFloor) return;
    if (floor > currentFloor) upStops.add(floor); else downStops.add(floor);
    if (direction == Direction.IDLE) direction = floor > currentFloor ? Direction.UP : Direction.DOWN;
  }

  // Advance one floor; returns true if the elevator stopped at a requested floor.
  public synchronized boolean step() {
    if (direction == Direction.IDLE) return false;

    currentFloor += (direction == Direction.UP) ? 1 : -1;

    boolean stopped = upStops.remove(currentFloor) | downStops.remove(currentFloor);
    updateDirection();
    return stopped;
  }

  private void updateDirection() {
    if (direction == Direction.UP && upStops.isEmpty()) {
      direction = downStops.isEmpty() ? Direction.IDLE : Direction.DOWN;
    } else if (direction == Direction.DOWN && downStops.isEmpty()) {
      direction = upStops.isEmpty() ? Direction.IDLE : Direction.UP;
    }
  }

  public synchronized int floor() { return currentFloor; }
  public synchronized Direction direction() { return direction; }
  public int id() { return id; }
}` }
        ],
        note: "Stops below the current floor are held in descending order, so `first()` is always the next floor to visit when going down."
      },
      {
        heading: "Requirement 2: Request types",
        text: "An internal request is just `addStop` on that car. An external request needs a direction so the dispatcher can prefer elevators already heading the same way.",
        code: [
          { file: "Request.java", body: `public record Request(int floor, Direction direction) {}` }
        ]
      },
      {
        heading: "Requirement 3: Choosing an elevator (Strategy)",
        text: "Which car should take a hallway call is a policy that product will tune. Hide it behind an interface and inject it into the controller. The default scores each elevator by how disruptive it would be to send it.",
        code: [
          { file: "DispatchStrategy.java", body: `public interface DispatchStrategy {
  Elevator choose(List<Elevator> elevators, Request request);
}` },
          { file: "NearestElevatorStrategy.java", body: `public class NearestElevatorStrategy implements DispatchStrategy {
  public Elevator choose(List<Elevator> elevators, Request req) {
    Elevator best = null;
    int bestCost = Integer.MAX_VALUE;
    for (Elevator e : elevators) {
      int cost = cost(e, req);
      if (cost < bestCost) { bestCost = cost; best = e; }
    }
    return best;
  }

  private int cost(Elevator e, Request req) {
    int distance = Math.abs(e.floor() - req.floor());
    Direction d = e.direction();

    if (d == Direction.IDLE) return distance;
    boolean onTheWay = (d == Direction.UP && req.direction() == Direction.UP && req.floor() >= e.floor())
                    || (d == Direction.DOWN && req.direction() == Direction.DOWN && req.floor() <= e.floor());
    // on the way: cheap. Otherwise it must finish its sweep first, so penalise.
    return onTheWay ? distance : distance + 100;
  }
}` }
        ]
      },
      {
        heading: "Requirement 4: The controller and the movement loop (State by direction)",
        text: "The controller owns the elevators, receives requests and drives the system forward with a scheduler. Each elevator's behaviour is determined by its direction state, which is why `Direction` works as a lightweight state. A full State-pattern class hierarchy only pays off once states carry real behaviour such as doors or maintenance.",
        code: [
          { file: "ElevatorController.java", body: `public class ElevatorController {
  private final List<Elevator> elevators;
  private final DispatchStrategy strategy;
  private final ScheduledExecutorService ticker = Executors.newSingleThreadScheduledExecutor();

  public ElevatorController(int count, DispatchStrategy strategy) {
    this.elevators = IntStream.range(0, count).mapToObj(Elevator::new).collect(Collectors.toList());
    this.strategy = strategy;
  }

  public void start() {
    ticker.scheduleAtFixedRate(this::tick, 0, 1, TimeUnit.SECONDS);
  }

  public void requestElevator(int floor, Direction direction) {
    Elevator e = strategy.choose(elevators, new Request(floor, direction));
    e.addStop(floor);
  }

  public void selectFloor(int elevatorId, int destination) {
    elevators.get(elevatorId).addStop(destination);
  }

  private void tick() {
    for (Elevator e : elevators) {
      if (e.step()) System.out.println("Elevator " + e.id() + " stopped at floor " + e.floor());
    }
  }

  public void stop() { ticker.shutdown(); }
}` },
          { file: "Main.java", body: `ElevatorController controller = new ElevatorController(3, new NearestElevatorStrategy());
controller.start();

controller.requestElevator(5, Direction.UP);   // someone on floor 5 presses up
controller.selectFloor(0, 9);                  // a passenger in car 0 chooses floor 9` }
        ]
      }
    ],
    deepDive: [
      {
        title: "Thread-safety of dispatch plus movement",
        text: "Each `Elevator` method is synchronized on that elevator, so a request arriving mid-step is applied atomically. The controller reads `floor()` and `direction()` for scoring without holding a global lock, which means the score can be slightly stale. That is acceptable: the worst case is a marginally suboptimal choice, never an inconsistent state. A global lock around dispatch would serialise all requests for no real gain."
      },
      {
        title: "Replacing the strategy and adding out-of-service cars",
        text: "Because `ElevatorController` depends only on `DispatchStrategy`, you can add a `ZoneStrategy` (cars dedicated to floor ranges), a peak-hour strategy that parks idle cars at the lobby, or a destination-dispatch strategy where passengers enter the target floor in the hallway. To model maintenance, add an `available` flag and have strategies skip unavailable elevators, or promote `Direction` into full state classes once behaviours like open-door and overload diverge."
      }
    ],
    mistakes: [
      "Using a single queue of requests per elevator in arrival order, which makes the car zig-zag instead of sweeping.",
      "Putting the dispatch algorithm inside the controller so changing it means editing core code.",
      "Treating internal and external requests the same, losing the direction hint that makes dispatch efficient.",
      "Holding one global lock around everything, so a slow step blocks all new requests.",
      "Forcing a pattern in just to impress the interviewer. Strategy for dispatch is justified; a State class per direction with three trivial methods each is not."
    ],
    followups: [
      "How would you add door open/close timing and a weight limit?",
      "How would you handle express elevators or a freight elevator?",
      "How would you test the dispatch strategy deterministically without real timers?"
    ],
    patterns: ["strategy", "state"]
  }
);
