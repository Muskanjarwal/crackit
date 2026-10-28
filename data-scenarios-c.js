window.SCENARIOS = window.SCENARIOS || [];
window.SCENARIOS.push(
{
  "id": "payment-succeeds-order-fails",
  "prompt": "A customer's card is charged successfully, but creating the order (or reserving the stock) fails right afterwards. How do you make sure nobody pays for something they never get?",
  "context": "Checkout touches three systems: the payment gateway, the inventory service and the order database. Each call can succeed, fail or time out on its own, and there is no single transaction that spans them.\n\nThe interviewer is checking whether you notice that the failure can happen *between* any two steps, and that the undo can fail too.",
  "whyHard": "Money has already moved in a system you do not control, so you cannot simply roll back. Every step can be retried or can partially complete, and a crash can happen anywhere, including in the middle of your own cleanup. The design has to converge to a consistent state even when nobody is watching.",
  "options": [
    {
      "name": "Saga with compensating actions",
      "concept": "Saga / compensating transactions (each step is a Command with an undo)",
      "conceptIds": [
        "command",
        "idempotency"
      ],
      "how": "Break checkout into steps, each with a matching compensation: charge/refund, reserve/release, create/cancel. Run them in order. If step N fails, run the compensations of steps 1..N-1 in reverse. Compensations must be idempotent because they may be retried after a crash.",
      "code": [
        {
          "file": "SagaOrchestrator.java",
          "body": "import java.util.ArrayDeque;\nimport java.util.Deque;\nimport java.util.List;\n\npublic class SagaOrchestrator {\n    public interface Step {\n        String name();\n        void execute() throws Exception;\n        void compensate();              // must be idempotent: it may run twice\n    }\n\n    public void run(List<Step> steps) {\n        Deque<Step> done = new ArrayDeque<>();\n        try {\n            for (Step step : steps) {\n                step.execute();\n                done.push(step);\n            }\n        } catch (Exception failure) {\n            while (!done.isEmpty()) {\n                Step step = done.pop();               // undo in reverse order\n                try {\n                    step.compensate();\n                } catch (RuntimeException e) {\n                    // never swallow silently: park it for retry or manual review\n                    System.err.println(\"compensation failed for \" + step.name());\n                }\n            }\n            throw new IllegalStateException(\"saga rolled back\", failure);\n        }\n    }\n}\n"
        }
      ],
      "pros": [
        "Works across any number of independent services",
        "Each step and its undo live together, so the flow is easy to read and test",
        "Failure handling is explicit instead of scattered try/catch blocks"
      ],
      "cons": [
        "A compensation can itself fail, so you still need retries and an escalation path",
        "Intermediate states are visible to users and other systems (charged but no order yet)",
        "Some actions cannot be undone, such as an email already sent"
      ],
      "pickWhen": "Several independent services must succeed together and each step has a sensible undo."
    },
    {
      "name": "Authorize first, capture last",
      "concept": "Two-phase payment: hold funds, do the reversible work, then charge. A close cousin of the reservation-with-expiry hold.",
      "conceptIds": [
        "reservation-with-ttl"
      ],
      "how": "Ask the gateway to authorize (hold) the amount instead of charging it. Do the reversible and cheap work next: reserve stock and persist the order. Capture the payment as the very last step. If anything fails before the capture, just void the authorization and no money ever moved.",
      "code": [
        {
          "file": "AuthorizeCapture.java",
          "body": "import java.util.UUID;\n\npublic class AuthorizeCapture {\n    interface Gateway {\n        String authorize(String customer, long cents);   // holds the funds, no money moves\n        void capture(String authId);                      // money moves\n        void voidAuth(String authId);                     // releases the hold\n    }\n    interface Inventory { boolean reserve(String sku, int qty); void release(String sku, int qty); }\n    interface Orders { void create(String orderId, String authId); }\n\n    private final Gateway gateway;\n    private final Inventory inventory;\n    private final Orders orders;\n\n    AuthorizeCapture(Gateway gateway, Inventory inventory, Orders orders) {\n        this.gateway = gateway;\n        this.inventory = inventory;\n        this.orders = orders;\n    }\n\n    boolean checkout(String customer, String sku, int qty, long cents) {\n        String authId = gateway.authorize(customer, cents);        // 1. hold the money\n        boolean reserved = false;\n        try {\n            reserved = inventory.reserve(sku, qty);                // 2. reversible work\n            if (!reserved) {\n                gateway.voidAuth(authId);\n                return false;\n            }\n            orders.create(UUID.randomUUID().toString(), authId);   // 3. persist the order\n            gateway.capture(authId);                               // 4. charge LAST\n            return true;\n        } catch (RuntimeException e) {\n            if (reserved) inventory.release(sku, qty);\n            gateway.voidAuth(authId);                              // nothing was charged\n            throw e;\n        }\n    }\n}\n"
        }
      ],
      "pros": [
        "Most failures cost nothing: voiding a hold moves no money",
        "Very little extra machinery compared to a full saga",
        "Matches how card networks already work"
      ],
      "cons": [
        "Holds expire (usually 7 days), so capture must happen in time",
        "Not every payment method supports authorize/capture",
        "The capture can still fail or time out, so you still need a fallback"
      ],
      "pickWhen": "The payment provider supports holds and the other steps are quick and reversible."
    },
    {
      "name": "Transactional outbox plus reconciliation job",
      "concept": "Outbox pattern and periodic reconciliation (eventual consistency, repair instead of prevent)",
      "conceptIds": [
        "idempotency"
      ],
      "how": "Record the payment and an outbox entry in one local transaction, so you never lose track of money taken. A background job scans entries whose order never appeared, retries the order creation, and refunds the payment if it still cannot be created. You accept a short window of inconsistency and guarantee that it gets repaired.",
      "code": [
        {
          "file": "OutboxReconciler.java",
          "body": "import java.util.List;\n\npublic class OutboxReconciler {\n    enum Status { PENDING, DONE }\n    record OutboxEntry(String orderId, String paymentId, Status status) {}\n\n    interface Orders { boolean exists(String orderId); void create(String orderId, String paymentId); }\n    interface Refunds { void refund(String paymentId); }       // idempotent per paymentId\n\n    // The payment row and its OutboxEntry are written in ONE local transaction.\n    // This job runs every minute and repairs payments whose order never appeared.\n    void reconcile(List<OutboxEntry> pending, Orders orders, Refunds refunds) {\n        for (OutboxEntry e : pending) {\n            if (orders.exists(e.orderId())) continue;                 // already fine\n            try {\n                orders.create(e.orderId(), e.paymentId());            // retry the order first\n            } catch (RuntimeException stillFailing) {\n                refunds.refund(e.paymentId());                        // give up: money back\n            }\n        }\n    }\n}\n"
        }
      ],
      "pros": [
        "Survives crashes at any point because the record of intent is durable",
        "Catches failures nobody thought of, including lost messages",
        "Simple to reason about: one job, one invariant"
      ],
      "cons": [
        "Users can briefly see a charge with no order",
        "Needs monitoring and alerting on entries that stay pending",
        "Refunds and retries must be idempotent"
      ],
      "pickWhen": "You already have a durable database and can tolerate short inconsistency, or as the safety net behind another option."
    },
    {
      "name": "Make failure a first-class order state",
      "concept": "State pattern / explicit state machine",
      "conceptIds": [
        "state"
      ],
      "how": "Model the order lifecycle with states such as PENDING_PAYMENT, PAID, FULFILLING, REFUND_PENDING and REFUNDED, and a table of allowed transitions. When fulfilment fails after payment, the order moves to REFUND_PENDING. A worker picks up every REFUND_PENDING order and refunds it. Nothing is lost because the failure is data, not an exception.",
      "code": [
        {
          "file": "OrderLifecycle.java",
          "body": "import java.util.EnumSet;\nimport java.util.Map;\nimport java.util.Set;\n\npublic class OrderLifecycle {\n    public enum State { PENDING_PAYMENT, PAID, FULFILLING, COMPLETED, REFUND_PENDING, REFUNDED, CANCELLED }\n\n    private static final Map<State, Set<State>> ALLOWED = Map.of(\n        State.PENDING_PAYMENT, EnumSet.of(State.PAID, State.CANCELLED),\n        State.PAID,            EnumSet.of(State.FULFILLING, State.REFUND_PENDING),\n        State.FULFILLING,      EnumSet.of(State.COMPLETED, State.REFUND_PENDING),\n        State.REFUND_PENDING,  EnumSet.of(State.REFUNDED),\n        State.COMPLETED,       EnumSet.noneOf(State.class),\n        State.REFUNDED,        EnumSet.noneOf(State.class),\n        State.CANCELLED,       EnumSet.noneOf(State.class));\n\n    private State state = State.PENDING_PAYMENT;\n\n    public synchronized void moveTo(State next) {\n        if (!ALLOWED.get(state).contains(next)) {\n            throw new IllegalStateException(state + \" -> \" + next + \" is not allowed\");\n        }\n        state = next;                      // persist the new state in the same transaction\n    }\n\n    // \"paid but could not fulfil\" is an explicit, queryable state, not a mystery\n    public synchronized void fulfilmentFailed() { moveTo(State.REFUND_PENDING); }\n\n    public synchronized State state() { return state; }\n}\n"
        }
      ],
      "pros": [
        "Impossible transitions are rejected in one place",
        "Support and dashboards can query exactly which orders are stuck",
        "Pairs well with every other option here"
      ],
      "cons": [
        "Does not fix anything by itself: you still need the worker that acts on each state",
        "More states means more transitions to test"
      ],
      "pickWhen": "Always, as the backbone. Combine it with one of the other options for the actual recovery."
    }
  ],
  "recommendation": "Use an explicit order state machine as the backbone, authorize-then-capture where the gateway allows it so most failures never move money, and a saga or reconciliation job as the safety net for everything else. Make every step and every compensation idempotent with a stable key such as the order id. If you only have time to describe one thing, describe how a crash between charge and order creation is detected and repaired.",
  "say": "\"The risk is the gap between charging and creating the order. First I would shrink that gap: authorize the card, do the reversible work, and capture last. For what still slips through, the order is a state machine, so 'paid but not fulfilled' is a real state. A reconciler finds those orders, retries, and refunds if it must. Every step carries the order id as an idempotency key, so retries are safe.\"",
  "appearsIn": [
    "digital-wallet",
    "amazon",
    "online-food-delivery",
    "shopping-cart-system",
    "movie-ticket-booking"
  ],
  "related": [
    "idempotency",
    "duplicate-charge-on-retry",
    "hold-expires-during-payment",
    "cancel-mid-flow"
  ]
},
{
  "id": "downstream-service-down",
  "prompt": "Your service depends on a recommendations (or payments, or inventory) service that has become slow or is returning errors. What happens to your service, and what do you do about it?",
  "context": "Checkout calls the dependency on every request. Latency has jumped from 50 ms to 30 seconds, and requests are piling up. Soon your own threads are exhausted and unrelated endpoints start failing too.\n\nThe interviewer wants to see that you protect your own service first, then degrade gracefully.",
  "whyHard": "A slow dependency is worse than a dead one: calls do not fail, they hang, and each hung call holds a thread and a connection. Retrying makes the load worse. One non-critical dependency can take down the whole service if you let it.",
  "options": [
    {
      "name": "Timeouts with bounded retries",
      "concept": "Timeouts and limited retries of idempotent calls",
      "conceptIds": [
        "idempotency"
      ],
      "how": "Put a hard timeout on every remote call and cancel it when it fires. Retry a small, fixed number of times, and only if the call is safe to repeat. This is the baseline everything else builds on.",
      "code": [
        {
          "file": "TimeoutRetry.java",
          "body": "import java.util.concurrent.Callable;\nimport java.util.concurrent.ExecutionException;\nimport java.util.concurrent.ExecutorService;\nimport java.util.concurrent.Executors;\nimport java.util.concurrent.Future;\nimport java.util.concurrent.TimeUnit;\nimport java.util.concurrent.TimeoutException;\n\npublic class TimeoutRetry {\n    private final ExecutorService pool = Executors.newFixedThreadPool(8);\n\n    public <T> T call(Callable<T> remote, long timeoutMs, int maxAttempts) throws Exception {\n        Exception last = new IllegalArgumentException(\"maxAttempts must be >= 1\");\n        for (int attempt = 1; attempt <= maxAttempts; attempt++) {\n            Future<T> future = pool.submit(remote);\n            try {\n                return future.get(timeoutMs, TimeUnit.MILLISECONDS);   // never wait forever\n            } catch (TimeoutException | ExecutionException e) {\n                future.cancel(true);\n                last = e;\n            }\n        }\n        throw last;\n    }\n}\n"
        }
      ],
      "pros": [
        "Easy to add and to explain",
        "Turns hangs into fast, visible failures",
        "Fixes transient glitches without extra design"
      ],
      "cons": [
        "Does nothing against a long outage: every request still pays the full timeout",
        "Retries multiply load on an already struggling service",
        "Needs thought about which calls are safe to repeat"
      ],
      "pickWhen": "Always, as step zero. It is necessary but not sufficient."
    },
    {
      "name": "Circuit breaker",
      "concept": "Circuit breaker: a small state machine (closed, open, half-open)",
      "conceptIds": [
        "state",
        "proxy"
      ],
      "how": "Count recent failures. After a threshold the breaker opens and calls fail immediately, without touching the dependency, giving it room to recover. After a cool-down one probe call is let through (half-open). If it succeeds the breaker closes, otherwise it opens again.",
      "code": [
        {
          "file": "CircuitBreaker.java",
          "body": "import java.time.Clock;\nimport java.time.Duration;\nimport java.util.function.Supplier;\n\npublic class CircuitBreaker {\n    enum State { CLOSED, OPEN, HALF_OPEN }\n\n    private final int failureThreshold;\n    private final long openForMs;\n    private final Clock clock;\n    private State state = State.CLOSED;\n    private int failures;\n    private long openedAt;\n\n    public CircuitBreaker(int failureThreshold, Duration openFor, Clock clock) {\n        this.failureThreshold = failureThreshold;\n        this.openForMs = openFor.toMillis();\n        this.clock = clock;\n    }\n\n    public <T> T call(Supplier<T> remote, Supplier<T> fallback) {\n        if (!allowRequest()) return fallback.get();      // OPEN: do not even try\n        try {\n            T result = remote.get();                     // not inside the lock\n            onSuccess();\n            return result;\n        } catch (RuntimeException e) {\n            onFailure();\n            return fallback.get();\n        }\n    }\n\n    private synchronized boolean allowRequest() {\n        if (state == State.OPEN) {\n            if (clock.millis() - openedAt < openForMs) return false;\n            state = State.HALF_OPEN;                     // let a probe through\n        }\n        return true;\n    }\n\n    private synchronized void onSuccess() { failures = 0; state = State.CLOSED; }\n\n    private synchronized void onFailure() {\n        failures++;\n        if (state == State.HALF_OPEN || failures >= failureThreshold) {\n            state = State.OPEN;\n            openedAt = clock.millis();\n        }\n    }\n}\n"
        }
      ],
      "pros": [
        "Fails fast, so threads are not tied up waiting",
        "Gives the struggling service time to recover",
        "Pairs naturally with a fallback"
      ],
      "cons": [
        "Thresholds and cool-down need tuning",
        "A flapping breaker can hide partial outages",
        "One breaker per dependency (or per route) to avoid over-blocking"
      ],
      "pickWhen": "The dependency can stay broken for a while and callers have somewhere sensible to fall back."
    },
    {
      "name": "Graceful fallback",
      "concept": "Decorator / Proxy that degrades instead of failing",
      "conceptIds": [
        "decorator",
        "proxy"
      ],
      "how": "Wrap the dependency in a decorator with the same interface. When the real call fails, return the last good result for that user, or a safe default such as popular items. The rest of the code does not know a fallback exists.",
      "code": [
        {
          "file": "FallbackRecommendations.java",
          "body": "import java.util.List;\nimport java.util.Map;\nimport java.util.concurrent.ConcurrentHashMap;\n\npublic class FallbackRecommendations {\n    interface Recommendations { List<String> forUser(String userId); }\n\n    // Decorator: same interface, adds \"degrade instead of fail\"\n    static class WithFallback implements Recommendations {\n        private final Recommendations primary;\n        private final List<String> popularItems;\n        private final Map<String, List<String>> lastGood = new ConcurrentHashMap<>();\n\n        WithFallback(Recommendations primary, List<String> popularItems) {\n            this.primary = primary;\n            this.popularItems = popularItems;\n        }\n\n        public List<String> forUser(String userId) {\n            try {\n                List<String> fresh = primary.forUser(userId);\n                lastGood.put(userId, fresh);\n                return fresh;\n            } catch (RuntimeException e) {\n                return lastGood.getOrDefault(userId, popularItems);   // stale beats an error page\n            }\n        }\n    }\n}\n"
        }
      ],
      "pros": [
        "Users see slightly stale data instead of an error",
        "Callers stay unchanged because the interface is the same",
        "Easy to unit test with a failing fake"
      ],
      "cons": [
        "Only suits non-critical data: you cannot fake a payment",
        "Stale or generic data can mislead if it is not labelled",
        "Needs a decision about how stale is too stale"
      ],
      "pickWhen": "A degraded answer is better than no answer, such as recommendations, reviews or counts."
    },
    {
      "name": "Bulkhead isolation",
      "concept": "Bulkhead: cap concurrency per dependency so one cannot starve the rest",
      "conceptIds": [
        "locks-synchronization"
      ],
      "how": "Give each dependency its own small pool of permits. If the recommendations service is slow, it can occupy at most N concurrent calls, and the remaining threads stay free for checkout. When the permits run out, extra calls are rejected immediately.",
      "code": [
        {
          "file": "Bulkhead.java",
          "body": "import java.util.concurrent.Semaphore;\nimport java.util.function.Supplier;\n\npublic class Bulkhead {\n    private final Semaphore permits;\n\n    public Bulkhead(int maxConcurrent) {\n        this.permits = new Semaphore(maxConcurrent);\n    }\n\n    public <T> T call(Supplier<T> work, Supplier<T> rejected) {\n        if (!permits.tryAcquire()) return rejected.get();   // fail fast, do not queue\n        try {\n            return work.get();\n        } finally {\n            permits.release();\n        }\n    }\n}\n// One Bulkhead per dependency: a slow reviews service can use at most N threads,\n// so it can never starve checkout of threads.\n"
        }
      ],
      "pros": [
        "Contains the blast radius of one slow dependency",
        "Cheap: a semaphore is enough",
        "Combines well with a breaker"
      ],
      "cons": [
        "Limits must be sized per dependency",
        "Rejects some requests even when the dependency would have recovered",
        "More configuration to maintain"
      ],
      "pickWhen": "Several dependencies share one process and a non-critical one must never starve a critical one."
    }
  ],
  "recommendation": "Layer them: a timeout on every call, a bulkhead per dependency, a circuit breaker with a fallback for non-critical data, and bounded retries only for idempotent calls. For critical dependencies like payments, fail fast with a clear error instead of faking a result. Add metrics so you can see breakers opening.",
  "say": "\"First a timeout on every remote call, because a hang is worse than a failure. Then I would isolate each dependency with a bulkhead so one slow service cannot eat all my threads. A circuit breaker stops me hammering a service that is down, and for non-critical data a decorator returns the last good value or a default. For payments I fail fast and surface the error, because a fake success there is dangerous.\"",
  "appearsIn": [
    "amazon",
    "spotify",
    "ride-sharing",
    "notification-system",
    "online-food-delivery"
  ],
  "related": [
    "retry-storm",
    "rate-limit-abuse",
    "state",
    "proxy"
  ]
},
{
  "id": "retry-storm",
  "prompt": "A dependency has a brief hiccup, every client retries, and the extra load keeps it down long after the original problem is gone. How do you stop retries from making the outage worse?",
  "context": "Ten thousand clients each retry three times with no delay, and each of those calls is itself made by a service that also retries three times. A 2-second blip turns into a sustained overload.\n\nThe interviewer wants you to talk about both the client side (how to retry) and the server side (how to protect itself).",
  "whyHard": "Retries are a good idea for one client and a bad idea for ten thousand clients at once. They arrive in synchronized waves, they stack across layers (3 x 3 x 3 = 27 calls), and they never back off when the server is already struggling.",
  "options": [
    {
      "name": "Exponential backoff with jitter",
      "concept": "Exponential backoff with full jitter; retries only for idempotent calls",
      "conceptIds": [
        "idempotency"
      ],
      "how": "Wait longer after each failed attempt (100 ms, 200 ms, 400 ms, up to a cap), and pick a random delay below that ceiling. The randomness (jitter) spreads clients out in time so they do not all return at the same instant.",
      "code": [
        {
          "file": "Backoff.java",
          "body": "import java.util.concurrent.Callable;\nimport java.util.concurrent.ThreadLocalRandom;\n\npublic class Backoff {\n    public static <T> T retry(Callable<T> op, int maxAttempts, long baseMs, long capMs) throws Exception {\n        for (int attempt = 1; ; attempt++) {\n            try {\n                return op.call();\n            } catch (Exception e) {\n                if (attempt >= maxAttempts) throw e;\n                long ceiling = Math.min(capMs, baseMs * (1L << (attempt - 1)));   // 100, 200, 400...\n                long sleepMs = ThreadLocalRandom.current().nextLong(ceiling + 1); // full jitter\n                Thread.sleep(sleepMs);\n            }\n        }\n    }\n}\n"
        }
      ],
      "pros": [
        "Spreads load out and gives the server time to recover",
        "A few lines of code, no coordination needed",
        "The standard answer most interviewers expect"
      ],
      "cons": [
        "Slows down the client's own success on transient errors",
        "Does not cap total retries across the whole system",
        "Still unsafe for non-idempotent calls"
      ],
      "pickWhen": "Always for client retries. It is the minimum."
    },
    {
      "name": "Retry budget",
      "concept": "Retry budget: a token bucket that only lets retries be a small fraction of traffic",
      "conceptIds": [],
      "how": "Each success earns a fraction of a retry token, and each retry spends a whole token. When the dependency is healthy there is plenty of budget. When it is down the budget drains in seconds and retries stop on their own, capping the extra load at, say, 10 percent.",
      "code": [
        {
          "file": "RetryBudget.java",
          "body": "public class RetryBudget {\n    private final double maxTokens;\n    private final double tokensPerSuccess;\n    private double tokens;\n\n    public RetryBudget(double maxTokens, double tokensPerSuccess) {\n        this.maxTokens = maxTokens;\n        this.tokensPerSuccess = tokensPerSuccess;\n        this.tokens = maxTokens;\n    }\n\n    // every success earns a fraction of a retry, e.g. 0.1 = at most ~10% extra load\n    public synchronized void onSuccess() {\n        tokens = Math.min(maxTokens, tokens + tokensPerSuccess);\n    }\n\n    // every retry spends a whole token; when the dependency is down, tokens run out fast\n    public synchronized boolean tryRetry() {\n        if (tokens < 1) return false;\n        tokens -= 1;\n        return true;\n    }\n}\n"
        }
      ],
      "pros": [
        "Puts a hard ceiling on retry amplification",
        "Adapts automatically: more successes mean more allowed retries",
        "Works per client without central coordination"
      ],
      "cons": [
        "One more thing to configure and monitor",
        "A tiny budget can fail requests that a retry would have saved",
        "Less familiar to many engineers"
      ],
      "pickWhen": "Many callers share one dependency and you must bound the worst-case extra load."
    },
    {
      "name": "Server-side load shedding",
      "concept": "Load shedding with 503 and Retry-After (protect the server, do not rely on clients)",
      "conceptIds": [],
      "how": "The server counts in-flight requests. Above a limit it rejects new ones immediately with 503 and a Retry-After hint instead of letting work queue until everything times out. Rejecting early is cheap, and well-behaved clients honor the hint.",
      "code": [
        {
          "file": "LoadShedder.java",
          "body": "import java.util.concurrent.atomic.AtomicInteger;\nimport java.util.function.Supplier;\n\npublic class LoadShedder {\n    public record Response(int status, String body, int retryAfterSeconds) {}\n\n    private final AtomicInteger inFlight = new AtomicInteger();\n    private final int limit;\n\n    public LoadShedder(int limit) { this.limit = limit; }\n\n    public Response handle(Supplier<String> work) {\n        if (inFlight.incrementAndGet() > limit) {\n            inFlight.decrementAndGet();\n            return new Response(503, \"busy\", 2);       // tell clients when to come back\n        }\n        try {\n            return new Response(200, work.get(), 0);\n        } finally {\n            inFlight.decrementAndGet();\n        }\n    }\n}\n"
        }
      ],
      "pros": [
        "Works even against clients you do not control",
        "Keeps the server responsive for the requests it does accept",
        "Simple concurrency limit, no external state"
      ],
      "cons": [
        "Some users get errors on purpose",
        "Needs a sensible limit, often found by load testing",
        "Clients that ignore Retry-After still add load"
      ],
      "pickWhen": "You own the server and cannot trust every client to behave."
    },
    {
      "name": "Retry at one layer only",
      "concept": "Retry placement: choose a single layer to own retries",
      "conceptIds": [],
      "how": "Pick one layer, usually the one closest to the user or the one that knows the call is idempotent, and let it retry. Lower layers fail fast. This turns 3 x 3 x 3 = 27 attempts into 3.",
      "pros": [
        "Removes the multiplication across layers",
        "No new code, only a decision and some configuration",
        "Easy to reason about during an incident"
      ],
      "cons": [
        "Needs agreement across teams, which is the hard part",
        "The chosen layer must have enough context to retry safely"
      ],
      "pickWhen": "A request passes through several services that each retry independently."
    }
  ],
  "recommendation": "Combine them. Retry at one layer, with exponential backoff and full jitter, only for idempotent calls and under a retry budget. On the server side add load shedding with Retry-After. If you have to pick one thing for the interview, pick backoff with jitter and mention the layer multiplication, because that shows you understand why storms happen.",
  "say": "\"The problem is synchronized, amplified retries. On the client I back off exponentially with jitter, cap the attempts, and keep a retry budget so retries stay a small fraction of traffic. I make sure only one layer retries. On the server I shed load with a 503 and Retry-After instead of queueing until everything times out.\"",
  "appearsIn": [
    "notification-system",
    "ride-sharing",
    "online-food-delivery",
    "chat-application"
  ],
  "related": [
    "downstream-service-down",
    "rate-limit-abuse",
    "idempotency",
    "duplicate-charge-on-retry"
  ]
},
{
  "id": "crash-midway-recovery",
  "prompt": "Your service crashes halfway through a multi-step operation, such as processing an order or importing a large file. What state is the system in after a restart, and how does it recover?",
  "context": "The operation has five steps and takes about a minute. The process can be killed at any moment by a deploy, an out-of-memory error or a hardware fault. When it comes back there are half-finished orders and half-imported files.\n\nThe interviewer wants to hear where you keep progress and how restarting is made safe.",
  "whyHard": "In-memory progress dies with the process, so you need durable progress. But persisting progress and doing the work are two separate actions, so a crash can fall between them. Recovery then has to deal with work that may or may not have happened.",
  "options": [
    {
      "name": "Persist the workflow state after each step",
      "concept": "State pattern with durable state (a persisted state machine)",
      "conceptIds": [
        "state",
        "memento"
      ],
      "how": "Store the current step of each operation in a database. On start-up, load every unfinished operation and resume from its recorded step. Because a crash can land between doing the work and saving the step, each action must be safe to repeat.",
      "code": [
        {
          "file": "DurableWorkflow.java",
          "body": "public class DurableWorkflow {\n    enum Step { CREATED, PAYMENT_TAKEN, STOCK_RESERVED, SHIPPED, DONE }\n\n    interface Store { Step load(String id); void save(String id, Step step); }   // a database row\n    interface Actions { void takePayment(String id); void reserveStock(String id); void ship(String id); }\n\n    // Called on every start-up for each unfinished order: picks up where it stopped.\n    void resume(String id, Store store, Actions actions) {\n        Step step = store.load(id);\n        while (step != Step.DONE) {\n            switch (step) {\n                case CREATED -> { actions.takePayment(id); step = Step.PAYMENT_TAKEN; }\n                case PAYMENT_TAKEN -> { actions.reserveStock(id); step = Step.STOCK_RESERVED; }\n                case STOCK_RESERVED -> { actions.ship(id); step = Step.SHIPPED; }\n                case SHIPPED -> step = Step.DONE;\n                default -> throw new IllegalStateException(\"unexpected \" + step);\n            }\n            store.save(id, step);     // a crash between action and save repeats that action,\n        }                             // so every action must be idempotent\n    }\n}\n"
        }
      ],
      "pros": [
        "Resumes exactly where it stopped",
        "Easy to inspect: the current step is just a column",
        "Natural fit for order and booking lifecycles"
      ],
      "cons": [
        "Needs idempotent actions to cover the gap between action and save",
        "Extra database writes on every step",
        "Workflow changes need migration of stored states"
      ],
      "pickWhen": "The process has distinct, named steps, such as an order or a booking."
    },
    {
      "name": "Checkpoint with Memento",
      "concept": "Memento pattern: snapshot enough state to resume a long-running job",
      "conceptIds": [
        "memento"
      ],
      "how": "For a long loop, such as importing a million rows, save a small snapshot every N items: the next row and a running total. On restart, restore the latest snapshot and continue. You redo at most N items, not the whole job.",
      "code": [
        {
          "file": "CheckpointedImport.java",
          "body": "import java.util.List;\n\npublic class CheckpointedImport {\n    record Checkpoint(int nextRow, long totalImported) {}          // the memento\n\n    interface CheckpointStore { Checkpoint latest(String jobId); void save(String jobId, Checkpoint c); }\n\n    private int nextRow;\n    private long totalImported;\n\n    Checkpoint snapshot() { return new Checkpoint(nextRow, totalImported); }\n    void restore(Checkpoint c) { nextRow = c.nextRow(); totalImported = c.totalImported(); }\n\n    void run(String jobId, List<String> rows, CheckpointStore store) {\n        Checkpoint last = store.latest(jobId);\n        if (last != null) restore(last);                           // resume, do not restart\n        while (nextRow < rows.size()) {\n            importRow(rows.get(nextRow));\n            nextRow++;\n            totalImported++;\n            if (nextRow % 100 == 0) store.save(jobId, snapshot()); // checkpoint every 100 rows\n        }\n        store.save(jobId, snapshot());\n    }\n\n    // rows after the last checkpoint run again after a crash, so this must be idempotent\n    private void importRow(String row) { }\n}\n"
        }
      ],
      "pros": [
        "Bounded rework after a crash",
        "Low overhead: one small write per batch",
        "No need to model every step as a state"
      ],
      "cons": [
        "Work after the last checkpoint is repeated, so it must be idempotent",
        "Checkpoint size and frequency are a trade-off",
        "Does not help with side effects outside the job"
      ],
      "pickWhen": "A single long-running loop processes many similar items."
    },
    {
      "name": "Idempotent steps, replay from the top",
      "concept": "Idempotency keys with Command objects: re-running is safe by construction",
      "conceptIds": [
        "idempotency",
        "command"
      ],
      "how": "Give every step a stable key, such as the workflow id plus the step name. Before running a step, check a durable set of completed keys. After a crash, simply run the whole workflow again: finished steps are skipped and the rest run. Pass the same key to external APIs so they deduplicate too.",
      "code": [
        {
          "file": "IdempotentReplay.java",
          "body": "import java.util.List;\n\npublic class IdempotentReplay {\n    interface Done { boolean has(String key); void mark(String key); }   // durable set\n    interface Command { String key(); void run(); }\n\n    // Safe to call again from the top after any crash.\n    void runAll(String workflowId, List<Command> steps, Done done) {\n        for (Command step : steps) {\n            String key = workflowId + \":\" + step.key();\n            if (done.has(key)) continue;       // finished before the crash\n            step.run();                        // itself idempotent (dedupe key to the payment API)\n            done.mark(key);\n        }\n    }\n}\n"
        }
      ],
      "pros": [
        "Recovery is just 'run it again', with no special recovery code",
        "Also protects against duplicate triggers and retries",
        "Easy to reason about"
      ],
      "cons": [
        "Every external call must honor a dedupe key",
        "Marking a step done and doing it still cannot be perfectly atomic",
        "Needs a durable store for completed keys"
      ],
      "pickWhen": "Steps call external systems that support idempotency keys."
    },
    {
      "name": "Append-only journal and replay",
      "concept": "Write-ahead log / event sourcing: record what happened, rebuild state from it",
      "conceptIds": [],
      "how": "Append every change to a durable log before applying it. After a crash, rebuild the in-memory state by replaying the log from the start (or from a snapshot). The log is the source of truth, so nothing that was acknowledged is lost.",
      "code": [
        {
          "file": "Journal.java",
          "body": "import java.util.ArrayList;\nimport java.util.HashMap;\nimport java.util.List;\nimport java.util.Map;\n\npublic class Journal {\n    record Entry(long seq, String type, String payload) {}\n\n    private final List<Entry> log = new ArrayList<>();    // append-only; on disk in real life\n\n    public synchronized void append(String type, String payload) {\n        log.add(new Entry(log.size() + 1, type, payload));\n    }\n\n    // After a crash, rebuild the in-memory state by replaying the log from the start.\n    public synchronized Map<String, Long> replayBalances() {\n        Map<String, Long> balances = new HashMap<>();\n        for (Entry e : log) {\n            String[] parts = e.payload().split(\":\");           // \"accountId:amount\"\n            long amount = Long.parseLong(parts[1]);\n            balances.merge(parts[0], e.type().equals(\"CREDIT\") ? amount : -amount, Long::sum);\n        }\n        return balances;\n    }\n}\n"
        }
      ],
      "pros": [
        "Strong durability and a full audit trail",
        "Rebuilding state is mechanical",
        "Enables time travel and debugging"
      ],
      "cons": [
        "Log growth needs compaction or snapshots",
        "More complex than a plain table",
        "Replay must be deterministic"
      ],
      "pickWhen": "You need an audit trail anyway, such as balances, ledgers and auctions."
    }
  ],
  "recommendation": "For most interview designs: persist the state machine in a database and make each action idempotent. Add checkpoints for long loops. Reach for a journal only when auditability is a requirement. The key sentence is that recovery means asking 'what is the last thing I know finished' and re-doing only what is safe to repeat.",
  "say": "\"I assume the process can die at any line. Progress lives in the database, not memory: each order has a persisted state. On restart I resume every unfinished order from its state, and every step is idempotent, so doing something twice after a crash is harmless. For long loops I checkpoint every N items to bound the rework.\"",
  "appearsIn": [
    "file-storage-system",
    "task-management-system",
    "digital-wallet",
    "atm",
    "logging-framework"
  ],
  "related": [
    "payment-succeeds-order-fails",
    "message-delivery-guarantees",
    "idempotency",
    "memento",
    "state"
  ]
},
{
  "id": "partial-batch-failure",
  "prompt": "You process a batch of 1,000 items (bulk upload, mass notifications, settling payments) and item 437 fails. What should happen to the other 999, and what does the caller see?",
  "context": "A file with 1,000 rows is submitted. Row 437 has bad data, and row 700 hits a transient network error. The product owner has not said what the rule is.\n\nThe interviewer wants you to ask whether the batch is all-or-nothing, and then handle each answer properly.",
  "whyHard": "There is no universal right answer: it depends on the business. A payroll run may need all-or-nothing, an email blast should skip bad addresses, and a flaky error should be retried but a bad row never will be. The hard part is telling the caller exactly what happened.",
  "options": [
    {
      "name": "All-or-nothing with rollback",
      "concept": "Atomic batch via undoable Commands (or a single database transaction)",
      "conceptIds": [
        "command"
      ],
      "how": "Apply the items one by one, remembering each applied action. On the first failure, undo them in reverse order and report failure. Inside a single database just use one transaction and let ROLLBACK do the work.",
      "code": [
        {
          "file": "AllOrNothingBatch.java",
          "body": "import java.util.ArrayDeque;\nimport java.util.Deque;\nimport java.util.List;\n\npublic class AllOrNothingBatch {\n    interface UndoableAction { void apply(); void undo(); }\n\n    void runAll(List<UndoableAction> actions) {\n        Deque<UndoableAction> applied = new ArrayDeque<>();\n        try {\n            for (UndoableAction a : actions) {\n                a.apply();\n                applied.push(a);\n            }\n        } catch (RuntimeException e) {\n            while (!applied.isEmpty()) applied.pop().undo();   // roll back what already happened\n            throw e;\n        }\n    }\n}\n// Inside one database, just use a single transaction instead: BEGIN ... COMMIT / ROLLBACK.\n"
        }
      ],
      "pros": [
        "Simple promise to the caller: either everything happened or nothing did",
        "No partial state to clean up manually",
        "Right for money and legal records"
      ],
      "cons": [
        "One bad row blocks 999 good ones",
        "Undo can fail or be impossible across external systems",
        "Long transactions hold locks and hurt throughput"
      ],
      "pickWhen": "A partial result is worse than no result, such as payroll and ledger entries."
    },
    {
      "name": "Best-effort with per-item results",
      "concept": "Result object that reports successes and failures separately",
      "conceptIds": [
        "idempotency"
      ],
      "how": "Process every item independently and collect two lists: what succeeded and what failed, with a reason for each. Return both to the caller, who can fix and resubmit only the failures. Idempotency keys make resubmission safe.",
      "code": [
        {
          "file": "BestEffortBatch.java",
          "body": "import java.util.ArrayList;\nimport java.util.List;\nimport java.util.function.Consumer;\n\npublic class BestEffortBatch {\n    record Failure<T>(T item, String reason) {}\n    record BatchResult<T>(List<T> succeeded, List<Failure<T>> failed) {}\n\n    <T> BatchResult<T> process(List<T> items, Consumer<T> handler) {\n        List<T> ok = new ArrayList<>();\n        List<Failure<T>> bad = new ArrayList<>();\n        for (T item : items) {\n            try {\n                handler.accept(item);\n                ok.add(item);\n            } catch (RuntimeException e) {\n                bad.add(new Failure<>(item, e.getMessage()));   // keep going, remember why\n            }\n        }\n        return new BatchResult<>(ok, bad);                      // caller sees exactly what happened\n    }\n}\n"
        }
      ],
      "pros": [
        "Maximizes useful work done",
        "The caller gets a precise, actionable report",
        "Resubmitting only failures is cheap"
      ],
      "cons": [
        "The system ends in a partially applied state by design",
        "Callers must handle the 'some failed' case",
        "Needs idempotency so a full resubmit does not duplicate work"
      ],
      "pickWhen": "Items are independent, such as notifications, imports and bulk updates."
    },
    {
      "name": "Retry, then dead-letter",
      "concept": "Dead-letter queue (bounded retries, then park the poison item)",
      "conceptIds": [],
      "how": "Retry each failing item a few times, because many failures are transient. If it still fails, move it to a dead-letter queue and carry on. Someone inspects the queue later, fixes the cause and replays the items.",
      "code": [
        {
          "file": "DeadLetterRetry.java",
          "body": "import java.util.ArrayDeque;\nimport java.util.List;\nimport java.util.Queue;\nimport java.util.function.Consumer;\n\npublic class DeadLetterRetry<T> {\n    private final Queue<T> deadLetters = new ArrayDeque<>();\n    private final int maxAttempts;\n\n    public DeadLetterRetry(int maxAttempts) { this.maxAttempts = maxAttempts; }\n\n    public void process(T item, Consumer<T> handler) {\n        for (int attempt = 1; attempt <= maxAttempts; attempt++) {\n            try {\n                handler.accept(item);\n                return;\n            } catch (RuntimeException e) {\n                // retry, ideally with backoff\n            }\n        }\n        deadLetters.add(item);          // park it: do not block the rest of the batch\n    }\n\n    public List<T> deadLetters() { return List.copyOf(deadLetters); }   // inspect, fix, replay\n}\n"
        }
      ],
      "pros": [
        "One poison item never blocks the stream",
        "Transient errors heal automatically",
        "Failed items are kept, not lost"
      ],
      "cons": [
        "Needs monitoring or the dead-letter queue becomes a graveyard",
        "Processing order is no longer guaranteed",
        "Retry policy needs tuning"
      ],
      "pickWhen": "A continuous stream of items, where blocking on a bad one is unacceptable."
    },
    {
      "name": "Validate everything first, then apply",
      "concept": "Template Method: fixed phases (validate all, then apply) with per-batch steps",
      "conceptIds": [
        "template-method"
      ],
      "how": "Split the work into two phases. Phase one validates every item with no side effects and collects every error. If there are any, return them all at once and apply nothing. Phase two applies the items, which now should fail only for rare infrastructure reasons.",
      "code": [
        {
          "file": "ValidatedBatch.java",
          "body": "import java.util.ArrayList;\nimport java.util.List;\n\npublic abstract class ValidatedBatch<T> {\n    public record BatchOutcome(boolean applied, List<String> errors) {}\n\n    // Template method: the order of phases is fixed, subclasses fill in the steps.\n    public final BatchOutcome run(List<T> items) {\n        List<String> errors = new ArrayList<>();\n        for (T item : items) validate(item, errors);       // phase 1: no side effects\n        if (!errors.isEmpty()) return new BatchOutcome(false, errors);\n        for (T item : items) apply(item);                  // phase 2: only valid input gets here\n        return new BatchOutcome(true, errors);\n    }\n\n    protected abstract void validate(T item, List<String> errors);\n    protected abstract void apply(T item);\n}\n"
        }
      ],
      "pros": [
        "Users see all problems in one pass",
        "Most failures happen before any side effect",
        "Cheap to combine with all-or-nothing"
      ],
      "cons": [
        "Cannot catch errors that only appear at apply time",
        "Validation and application can drift apart",
        "State may change between the two phases"
      ],
      "pickWhen": "Most failures are bad input, not infrastructure."
    }
  ],
  "recommendation": "Ask the business rule first. For independent items I would validate up front, then process best-effort with bounded retries and a dead-letter queue, returning per-item results. For money-moving batches I would switch to all-or-nothing in one transaction. State the choice out loud, because the trade-off is the answer.",
  "say": "\"First I would ask whether the batch is atomic. If it is, one transaction or a list of undoable actions. If items are independent, I validate everything up front, process each one with a few retries, park what still fails in a dead-letter queue, and return a per-item report so the caller can fix and resubmit just the failures. Idempotency keys make that resubmit safe.\"",
  "appearsIn": [
    "splitwise",
    "notification-system",
    "online-bookstore",
    "course-registration-system",
    "file-storage-system"
  ],
  "related": [
    "cancel-mid-flow",
    "crash-midway-recovery",
    "idempotency",
    "command"
  ]
},
{
  "id": "message-delivery-guarantees",
  "prompt": "In your design, components communicate through a queue or a pub/sub system. What happens if a message is lost, or delivered twice? What guarantee do you promise?",
  "context": "A producer publishes an 'order placed' event. Consumers update inventory, send email and credit loyalty points. The network drops acknowledgements, consumers crash after doing the work but before acknowledging, and the broker redelivers.\n\nThe interviewer is probing whether you know that exactly-once delivery is not something you can simply switch on.",
  "whyHard": "Over an unreliable network you can have either lost messages (at-most-once) or duplicates (at-least-once), and you cannot fully distinguish a slow ack from a lost one. 'Exactly once' is really at-least-once delivery combined with idempotent processing.",
  "options": [
    {
      "name": "At-least-once delivery with an idempotent consumer",
      "concept": "Idempotent consumer: dedupe on message id",
      "conceptIds": [
        "idempotency"
      ],
      "how": "The broker redelivers until the consumer acknowledges. The consumer records each message id in a table with a unique constraint and ignores ids it has already seen. Ideally the record and the business effect are written in one transaction so they cannot diverge.",
      "code": [
        {
          "file": "IdempotentConsumer.java",
          "body": "import java.util.Set;\nimport java.util.concurrent.ConcurrentHashMap;\n\npublic class IdempotentConsumer {\n    // A table with a UNIQUE(message_id) constraint in real life\n    private final Set<String> processed = ConcurrentHashMap.newKeySet();\n\n    public void onMessage(String messageId, Runnable handler) {\n        if (!processed.add(messageId)) return;        // duplicate: already handled, just ack it\n        try {\n            handler.run();\n        } catch (RuntimeException e) {\n            processed.remove(messageId);              // let the broker redeliver\n            throw e;\n        }\n    }\n}\n"
        }
      ],
      "pros": [
        "Nothing is lost, and duplicates do no harm",
        "The standard, widely understood pattern",
        "Works with almost any broker"
      ],
      "cons": [
        "Needs a dedupe store that grows, so expire old ids",
        "The check and the effect must be atomic or a crash can lose work",
        "Every consumer must implement it"
      ],
      "pickWhen": "Losing a message is unacceptable. This is the default for orders, payments and inventory."
    },
    {
      "name": "Acknowledgements with a visibility timeout",
      "concept": "Ack / redelivery, like a hold with an expiry (visibility timeout)",
      "conceptIds": [
        "reservation-with-ttl"
      ],
      "how": "When a consumer receives a message the broker hides it for a limited time. If the consumer acknowledges within that time the message is gone for good. If it crashes or is too slow, the message becomes visible again and another consumer picks it up. This is how SQS-style queues work.",
      "code": [
        {
          "file": "AckQueue.java",
          "body": "import java.time.Clock;\nimport java.util.ArrayDeque;\nimport java.util.Deque;\nimport java.util.HashMap;\nimport java.util.Iterator;\nimport java.util.Map;\n\npublic class AckQueue<T> {\n    public record Delivery<T>(String id, T body) {}\n\n    private final Deque<Delivery<T>> ready = new ArrayDeque<>();\n    private final Map<String, Delivery<T>> inFlight = new HashMap<>();\n    private final Map<String, Long> deadline = new HashMap<>();\n    private final long visibilityMs;\n    private final Clock clock;\n\n    public AckQueue(long visibilityMs, Clock clock) {\n        this.visibilityMs = visibilityMs;\n        this.clock = clock;\n    }\n\n    public synchronized void send(String id, T body) { ready.add(new Delivery<>(id, body)); }\n\n    public synchronized Delivery<T> receive() {\n        requeueExpired();\n        Delivery<T> d = ready.poll();\n        if (d != null) {\n            inFlight.put(d.id(), d);\n            deadline.put(d.id(), clock.millis() + visibilityMs);   // consumer has this long to ack\n        }\n        return d;\n    }\n\n    public synchronized void ack(String id) {           // done: never delivered again\n        inFlight.remove(id);\n        deadline.remove(id);\n    }\n\n    private void requeueExpired() {\n        long now = clock.millis();\n        Iterator<Map.Entry<String, Long>> it = deadline.entrySet().iterator();\n        while (it.hasNext()) {\n            Map.Entry<String, Long> e = it.next();\n            if (e.getValue() <= now) {                  // consumer died or was too slow\n                ready.add(inFlight.remove(e.getKey()));\n                it.remove();\n            }\n        }\n    }\n}\n"
        }
      ],
      "pros": [
        "Handles consumer crashes without any extra code",
        "Slow consumers are covered by the timeout",
        "Natural basis for at-least-once"
      ],
      "cons": [
        "A timeout shorter than the work causes duplicate processing",
        "Needs idempotent handlers anyway",
        "Ordering is not preserved on redelivery"
      ],
      "pickWhen": "You are designing or explaining the queue itself."
    },
    {
      "name": "Transactional outbox on the producer side",
      "concept": "Outbox pattern: write the event and the data change in one transaction",
      "conceptIds": [
        "idempotency"
      ],
      "how": "The service inserts the order and an outbox row in the same database transaction, so it can never save one without the other. A poller publishes outbox rows and marks them published. A crash between publish and mark causes a duplicate, which the consumers dedupe.",
      "code": [
        {
          "file": "OutboxPublisher.java",
          "body": "import java.util.List;\n\npublic class OutboxPublisher {\n    record OutboxRow(long id, String topic, String payload, boolean published) {}\n\n    interface Db { List<OutboxRow> unpublished(int limit); void markPublished(long id); }\n    interface Broker { void publish(String topic, String payload, String messageId); }\n\n    // Step 1, inside the business transaction: INSERT the order AND INSERT its outbox row.\n    // Step 2, this poller: publish, then mark. A crash between the two publishes again,\n    // so consumers must dedupe on messageId (at-least-once).\n    void pollOnce(Db db, Broker broker) {\n        for (OutboxRow row : db.unpublished(100)) {\n            broker.publish(row.topic(), row.payload(), String.valueOf(row.id()));\n            db.markPublished(row.id());\n        }\n    }\n}\n"
        }
      ],
      "pros": [
        "Fixes the 'saved the order but lost the event' problem",
        "No distributed transaction needed",
        "Pairs with idempotent consumers to look like exactly-once"
      ],
      "cons": [
        "Adds a table and a poller",
        "Publishing is slightly delayed",
        "Duplicates are possible by design"
      ],
      "pickWhen": "A database change and a published event must never get out of sync."
    },
    {
      "name": "At-most-once (fire and forget)",
      "concept": "At-most-once delivery: accept loss to avoid duplicates",
      "conceptIds": [],
      "how": "Send the message once and never retry. If it is lost, it is lost. Nothing can be duplicated, and the producer and consumer stay simple and fast.",
      "pros": [
        "Fastest and simplest",
        "No dedupe logic, no redelivery storms",
        "Fine when the next event supersedes the last"
      ],
      "cons": [
        "Messages can silently disappear",
        "Not acceptable for anything with money or state",
        "Hard to detect that something was lost"
      ],
      "pickWhen": "Loss is harmless, such as metrics, live location pings and typing indicators."
    }
  ],
  "recommendation": "Say plainly that exactly-once delivery is a myth and that you build exactly-once effects: at-least-once delivery plus idempotent consumers, with an outbox so a database change and its event cannot diverge. Use at-most-once only for data that is cheap to lose. Mention a dead-letter queue for messages that keep failing.",
  "say": "\"I would not promise exactly-once delivery. I promise at-least-once, and make consumers idempotent by deduplicating on a message id. On the producer side an outbox keeps the data change and the event atomic. For things like live location or metrics I accept at-most-once, because a lost update is harmless.\"",
  "appearsIn": [
    "pub-sub-system",
    "notification-system",
    "chat-application",
    "logging-framework",
    "online-stock-exchange"
  ],
  "related": [
    "idempotency",
    "duplicate-charge-on-retry",
    "crash-midway-recovery",
    "observer"
  ]
},
{
  "id": "cancel-mid-flow",
  "prompt": "A user cancels a booking or order while it is halfway through processing. What should cancellation do at each stage, and what if it races with a step that is still running?",
  "context": "A customer has paid, the warehouse has started packing, and a payment-confirmation email is about to go out. Then the customer hits Cancel. At the same moment a worker is trying to mark the order as shipped.\n\nThe interviewer wants to see that you define what 'cancel' means at every stage, and that you handle the race.",
  "whyHard": "Cancellation is not one operation: before payment it is free, after payment it needs a refund, after shipping it is impossible and becomes a return. It also races with the very workers that are advancing the order, so two threads can disagree about the current state.",
  "options": [
    {
      "name": "Undo stack of reversible actions",
      "concept": "Command pattern with undo: roll back what has been done, newest first",
      "conceptIds": [
        "command"
      ],
      "how": "Each step the flow performs is a Command that knows how to apply itself and how to undo itself. The flow keeps a stack of completed commands. Cancel pops the stack, undoing each one in reverse order.",
      "code": [
        {
          "file": "CancellableFlow.java",
          "body": "import java.util.ArrayDeque;\nimport java.util.Deque;\n\npublic class CancellableFlow {\n    interface Action { void apply(); void undo(); }       // the Command pattern, with undo\n\n    private final Deque<Action> done = new ArrayDeque<>();\n\n    public void perform(Action action) {\n        action.apply();\n        done.push(action);\n    }\n\n    public void cancel() {\n        while (!done.isEmpty()) done.pop().undo();         // newest first\n    }\n}\n"
        }
      ],
      "pros": [
        "Cancel logic lives next to the action it reverses",
        "Works for any number of steps",
        "Easy to extend with new steps"
      ],
      "cons": [
        "Some actions cannot be undone (an email already sent)",
        "Undo can fail and needs retries",
        "In-memory stacks are lost in a crash unless persisted"
      ],
      "pickWhen": "A flow made of discrete, reversible steps inside one process."
    },
    {
      "name": "State machine with cancellable states",
      "concept": "State pattern: each state decides whether, and how, cancellation is allowed",
      "conceptIds": [
        "state"
      ],
      "how": "Mark which states allow cancellation and what each one costs. PLACED cancels freely, PAID cancels with a refund, SHIPPED rejects cancellation and points to returns. All transitions, including cancel and the worker's advance, go through the same synchronized method, so the race has one winner.",
      "code": [
        {
          "file": "CancellableOrder.java",
          "body": "public class CancellableOrder {\n    enum State {\n        PLACED(true), PAID(true), PACKED(true), SHIPPED(false), DELIVERED(false), CANCELLED(false);\n\n        final boolean cancellable;\n        State(boolean cancellable) { this.cancellable = cancellable; }\n    }\n\n    private State state = State.PLACED;\n\n    public synchronized String cancel() {\n        if (!state.cancellable) return \"too late (\" + state + \"): start a return instead\";\n        boolean needsRefund = state != State.PLACED;\n        state = State.CANCELLED;\n        return needsRefund ? \"cancelled, refund queued\" : \"cancelled\";\n    }\n\n    // The warehouse worker and the customer race; both go through the same lock.\n    public synchronized boolean advance(State next) {\n        if (state == State.CANCELLED) return false;       // cancelled wins, the worker stops\n        state = next;\n        return true;\n    }\n}\n"
        }
      ],
      "pros": [
        "The rules per stage are explicit and testable",
        "The race is resolved in one place",
        "Gives users a clear message about why they cannot cancel"
      ],
      "cons": [
        "Needs a persisted state and an atomic update in a real system (conditional UPDATE)",
        "More states mean more rules",
        "Does not undo side effects by itself"
      ],
      "pickWhen": "The rules depend on how far the order has progressed."
    },
    {
      "name": "Snapshot and restore",
      "concept": "Memento pattern: capture state before a change, restore it on cancel",
      "conceptIds": [
        "memento"
      ],
      "how": "Take a snapshot when the user starts an editable step, such as choosing seats. If they cancel, restore the snapshot and the draft goes back to exactly how it was. It suits drafts and in-progress edits rather than committed transactions.",
      "code": [
        {
          "file": "BookingDraft.java",
          "body": "import java.util.ArrayList;\nimport java.util.List;\n\npublic class BookingDraft {\n    record Snapshot(List<String> seats, long totalCents) {}   // the memento\n\n    private List<String> seats = new ArrayList<>();\n    private long totalCents;\n\n    public void addSeat(String seat, long priceCents) {\n        seats.add(seat);\n        totalCents += priceCents;\n    }\n\n    public Snapshot snapshot() { return new Snapshot(List.copyOf(seats), totalCents); }\n\n    public void restore(Snapshot s) {\n        seats = new ArrayList<>(s.seats());\n        totalCents = s.totalCents();\n    }\n}\n// Take a snapshot when the user starts an edit step. \"Cancel\" is restore(snapshot).\n"
        }
      ],
      "pros": [
        "Simple and reliable for in-memory edits",
        "No per-action undo logic to write",
        "Cheap when the state is small"
      ],
      "cons": [
        "Only restores your own object, not external systems",
        "Large state makes snapshots expensive",
        "Not suitable once money has moved"
      ],
      "pickWhen": "Cancelling an edit session or a draft before anything is committed."
    },
    {
      "name": "Cooperative cancellation token",
      "concept": "Cancellation token: running work checks a flag at safe points",
      "conceptIds": [],
      "how": "Hand the long-running flow a token. The flow checks it between steps and stops at a safe point instead of being killed mid-step. Cancelling just flips the flag, and the flow cleans up after itself.",
      "code": [
        {
          "file": "CancellationToken.java",
          "body": "import java.util.concurrent.CancellationException;\nimport java.util.concurrent.atomic.AtomicBoolean;\n\npublic class CancellationToken {\n    private final AtomicBoolean cancelled = new AtomicBoolean();\n\n    public void cancel() { cancelled.set(true); }\n\n    public void throwIfCancelled() {\n        if (cancelled.get()) throw new CancellationException(\"cancelled by user\");\n    }\n\n    // A long flow checks the token between steps, so it stops at a safe point.\n    static void fulfil(CancellationToken token, Runnable... steps) {\n        for (Runnable step : steps) {\n            token.throwIfCancelled();\n            step.run();\n        }\n    }\n}\n"
        }
      ],
      "pros": [
        "Stops in-flight work without corrupting it",
        "Cheap to implement",
        "Combines with undo or compensation for cleanup"
      ],
      "cons": [
        "A step already in progress still finishes",
        "Only works if the code checks the token",
        "You still need compensation for what already happened"
      ],
      "pickWhen": "Long-running background work needs to be stoppable."
    }
  ],
  "recommendation": "Model the order as a state machine that defines what cancel means in each state, make the transition atomic so cancel and the worker cannot both win, and run compensation for committed steps (refund, release stock). Use a cancellation token to stop in-flight work at safe points. Persist the state so cancel survives a crash.",
  "say": "\"Cancel means something different at each stage, so I put it in the state machine: free before payment, refund after payment, rejected after shipping. The cancel and the warehouse worker's 'advance' both go through one atomic transition, so they cannot both win. Committed steps are compensated, a refund and a stock release, and in-flight work checks a cancellation token.\"",
  "appearsIn": [
    "movie-ticket-booking",
    "concert-ticket-booking",
    "car-rental-system",
    "hotel-management-system",
    "restaurant-management-system"
  ],
  "related": [
    "payment-succeeds-order-fails",
    "enum-vs-state-pattern",
    "add-undo-redo",
    "hold-expires-during-payment"
  ]
}
);
