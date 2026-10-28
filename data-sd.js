window.TRACKS = window.TRACKS || {};
window.TRACKS.sd = {
  sections: [
    {
      id: "blocks",
      title: "Building Blocks",
      blurb: "Know what each component buys you and what it costs.",
      items: [
        {
          id: "sd-scaling", title: "Scaling: vertical vs horizontal", difficulty: "easy", tags: ["fundamentals"],
          desc: "When to scale up, when to scale out, and what breaks when you do.",
          points: ["Stateless services scale out trivially; state is the hard part.", "Load balancing: round robin, least connections, consistent hashing."]
        },
        {
          id: "sd-caching", title: "Caching", difficulty: "medium", tags: ["performance"],
          desc: "Where to cache, write policies and invalidation.",
          points: ["Cache-aside, write-through, write-back.", "Eviction (LRU/LFU), TTLs, stampede protection.", "CDN for static and edge content."]
        },
        {
          id: "sd-db", title: "SQL vs NoSQL, sharding & replication", difficulty: "medium", tags: ["storage"],
          desc: "Choose a datastore from access patterns, then scale it.",
          points: ["Replication: leader-follower, lag, failover.", "Sharding keys, hot partitions, resharding.", "Indexes and read/write amplification."]
        },
        {
          id: "sd-cap", title: "CAP, consistency models", difficulty: "hard", tags: ["distributed systems"],
          desc: "Strong, eventual and causal consistency, and the trade-offs.",
          points: ["Under partition choose consistency or availability.", "Quorums (R+W>N), idempotency, exactly-once myths."]
        },
        {
          id: "sd-queues", title: "Message queues & streams", difficulty: "medium", tags: ["async"],
          desc: "Decouple producers and consumers; handle retries and ordering.",
          points: ["At-least-once delivery, dead-letter queues.", "Partitioning for ordering and parallelism."]
        }
      ]
    },
    {
      id: "problems",
      title: "Classic Design Problems",
      blurb: "Follow a framework: requirements, estimates, API, data model, high-level design, deep dives, trade-offs.",
      items: [
        { id: "sdp-urlshort", title: "URL Shortener", difficulty: "easy", tags: ["hashing", "read-heavy"], desc: "Short, unique, redirect-fast links at scale.",
          points: ["ID generation: counter + base62 vs hashing.", "Cache hot links; 301 vs 302 trade-off."] },
        { id: "sdp-ratelimiter", title: "Distributed Rate Limiter", difficulty: "medium", tags: ["redis", "algorithms"], desc: "Throttle clients across many servers.",
          points: ["Token bucket vs sliding window.", "Central store (Redis) and atomic scripts."] },
        { id: "sdp-feed", title: "News Feed", difficulty: "hard", tags: ["fan-out"], desc: "Generate personalised timelines for millions of users.",
          points: ["Fan-out on write vs read, and hybrid for celebrities.", "Ranking and cache layout."] },
        { id: "sdp-chat", title: "Chat / Messaging App", difficulty: "hard", tags: ["websockets"], desc: "Real-time delivery, presence and history.",
          points: ["Persistent connections, message ordering, offline delivery.", "Group chats and delivery receipts."] },
        { id: "sdp-video", title: "Video Streaming", difficulty: "hard", tags: ["cdn", "storage"], desc: "Upload, transcode and stream to global audiences.",
          points: ["Transcoding pipeline, adaptive bitrate.", "CDN placement and cold content."] }
      ]
    }
  ]
};
