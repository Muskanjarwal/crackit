window.QUESTIONS = window.QUESTIONS || [];
window.QUESTIONS.push(
  /* ------------------------------------------------------------------ */
  {
    id: "file-storage-system",
    name: "Design File Storage System like Google Drive",
    difficulty: "hard",
    understanding: "Design the object model of a cloud file store: users upload files into folders, share them with others at different permission levels, and every edit creates a new version. The hard parts are modelling files and folders as one tree, enforcing permissions that inherit down that tree, and keeping version history without copying everything on every save.",
    dialogue: [
      { who: "you", text: "Are we designing the storage backend, or the domain model that sits on top of it?" },
      { who: "int", text: "The domain model. Assume a blob store holds the bytes; you own metadata, folders, sharing and versions." },
      { who: "you", text: "Do folders nest, and can a file live in more than one folder?" },
      { who: "int", text: "Folders nest arbitrarily. A file lives in exactly one folder." },
      { who: "you", text: "What sharing levels do we need?" },
      { who: "int", text: "Viewer, commenter and editor. The owner can do everything. Sharing a folder should cover everything inside it." },
      { who: "you", text: "Should each save create a version, and can users roll back?" },
      { who: "int", text: "Yes. Keep a version history, let users restore an old version, and do not duplicate bytes unnecessarily." },
      { who: "you", text: "Do we handle two people editing the same file at once?" },
      { who: "int", text: "Keep it simple: reject a stale write rather than merge. Explain how you would detect it." },
      { who: "you", text: "Is search or real-time sync in scope?" },
      { who: "int", text: "No. Focus on upload, download, share, permissions and versioning." }
    ],
    requirements: [
      { group: "Core", items: [
        "Users create nested folders and upload files into them.",
        "Download a file's latest version, or any earlier version.",
        "Share a file or folder with another user as viewer, commenter or editor.",
        "Permissions on a folder apply to everything beneath it unless overridden.",
        "Every upload to an existing file creates a new version; users can restore an old one."
      ] },
      { group: "Concurrency", items: [
        "Two edits based on the same version must not silently overwrite each other."
      ] },
      { group: "Extensibility", items: [
        "New permission levels can be added without touching file or folder code.",
        "Storage of bytes is pluggable (local disk, S3, and so on)."
      ] }
    ],
    entities: [
      { name: "User", text: "An account that owns and accesses items." },
      { name: "Node", text: "The common base for anything in the tree: has an id, name, parent and owner." },
      { name: "Folder", text: "A Node that contains child Nodes." },
      { name: "File", text: "A Node that holds an ordered list of FileVersions." },
      { name: "FileVersion", text: "One immutable snapshot: version number, size, checksum, author and a pointer to the stored blob." },
      { name: "Permission", text: "An enum: VIEWER, COMMENTER, EDITOR, OWNER, ordered by power." },
      { name: "AccessControlList", text: "Per-node map of user to Permission." },
      { name: "BlobStore", text: "Interface that saves and loads raw bytes by key." },
      { name: "DriveService", text: "Facade exposing create, upload, download, share and restore." }
    ],
    design: [
      {
        heading: "Requirement 1: Files and folders form one tree",
        text: "Callers should be able to treat a file and a folder uniformly when walking up to check permissions or computing a path. Make both extend a `Node` base class that stores its parent. A `Folder` holds children; a `File` holds versions. This is the Composite pattern, though you do not need to name it to get the structure right.",
        code: [
          { file: "Node.java", body: `public abstract class Node {
    private final String id = java.util.UUID.randomUUID().toString();
    private String name;
    private Folder parent;
    private final User owner;
    private final AccessControlList acl = new AccessControlList();

    protected Node(String name, User owner, Folder parent) {
        this.name = name;
        this.owner = owner;
        this.parent = parent;
    }

    public String getId() { return id; }
    public String getName() { return name; }
    public User getOwner() { return owner; }
    public Folder getParent() { return parent; }
    public AccessControlList getAcl() { return acl; }

    public String path() {
        return parent == null ? "/" + name : parent.path() + "/" + name;
    }
}` },
          { file: "Folder.java", body: `public class Folder extends Node {
    private final java.util.Map<String, Node> children = new java.util.LinkedHashMap<>();

    public Folder(String name, User owner, Folder parent) {
        super(name, owner, parent);
    }

    public void add(Node child) {
        if (children.containsKey(child.getName())) {
            throw new IllegalStateException("Name already exists: " + child.getName());
        }
        children.put(child.getName(), child);
    }

    public java.util.Collection<Node> list() {
        return java.util.Collections.unmodifiableCollection(children.values());
    }
}` },
          { file: "File.java", body: `public class File extends Node {
    private final java.util.List<FileVersion> versions = new java.util.ArrayList<>();

    public File(String name, User owner, Folder parent) {
        super(name, owner, parent);
    }

    public FileVersion latest() {
        return versions.get(versions.size() - 1);
    }

    public FileVersion version(int number) {
        return versions.get(number - 1);
    }

    public int versionCount() { return versions.size(); }

    void append(FileVersion v) { versions.add(v); }
}` }
        ],
        note: "Names are unique within a folder, so the children map is keyed by name. That makes lookups and duplicate checks O(1)."
      },
      {
        heading: "Requirement 2: Sharing with permission levels",
        text: "Each node has its own `AccessControlList`. Permission is an ordered enum, so \"is this user allowed to edit?\" becomes a comparison rather than a chain of ifs. Adding a new level is adding an enum constant.",
        code: [
          { file: "Permission.java", body: `public enum Permission {
    NONE, VIEWER, COMMENTER, EDITOR, OWNER;

    public boolean allows(Permission required) {
        return this.ordinal() >= required.ordinal();
    }
}` },
          { file: "AccessControlList.java", body: `public class AccessControlList {
    private final java.util.Map<String, Permission> grants = new java.util.HashMap<>();

    public void grant(User user, Permission p) { grants.put(user.getId(), p); }
    public void revoke(User user) { grants.remove(user.getId()); }

    public java.util.Optional<Permission> explicit(User user) {
        return java.util.Optional.ofNullable(grants.get(user.getId()));
    }
}` }
        ]
      },
      {
        heading: "Requirement 3: Permissions inherit down the tree",
        text: "Sharing a folder must cover its contents, so the effective permission is the explicit grant on the nearest ancestor (including the node itself). Resolve it by walking up from the node. The owner always has `OWNER`. Keeping this logic in one `PermissionChecker` means upload, download and share all enforce the same rule.",
        code: [
          { file: "PermissionChecker.java", body: `public class PermissionChecker {

    public Permission effective(User user, Node node) {
        for (Node n = node; n != null; n = n.getParent()) {
            if (n.getOwner().equals(user)) return Permission.OWNER;
            java.util.Optional<Permission> p = n.getAcl().explicit(user);
            if (p.isPresent()) return p.get();
        }
        return Permission.NONE;
    }

    public void require(User user, Node node, Permission needed) {
        if (!effective(user, node).allows(needed)) {
            throw new SecurityException(user.getName() + " lacks " + needed + " on " + node.path());
        }
    }
}` }
        ],
        note: "Walking up costs O(depth). For very deep trees you could cache effective permissions, but invalidation on share changes makes that a deliberate trade-off, not a default."
      },
      {
        heading: "Requirement 4: Versioning without duplicating bytes",
        text: "A `FileVersion` is immutable and points at a blob key rather than holding bytes. The blob store is an interface, so local disk and cloud object stores are interchangeable. Using the content checksum as the key gives free deduplication: uploading identical content twice stores one blob.",
        code: [
          { file: "BlobStore.java", body: `public interface BlobStore {
    String put(byte[] content);          // returns a key (content hash)
    byte[] get(String key);
}` },
          { file: "InMemoryBlobStore.java", body: `public class InMemoryBlobStore implements BlobStore {
    private final java.util.Map<String, byte[]> blobs = new java.util.concurrent.ConcurrentHashMap<>();

    public String put(byte[] content) {
        String key = Hashing.sha256(content);
        blobs.putIfAbsent(key, content);
        return key;
    }

    public byte[] get(String key) {
        byte[] b = blobs.get(key);
        if (b == null) throw new IllegalArgumentException("Missing blob " + key);
        return b;
    }
}` },
          { file: "FileVersion.java", body: `public final class FileVersion {
    private final int number;
    private final String blobKey;
    private final long size;
    private final User author;
    private final java.time.Instant createdAt;

    public FileVersion(int number, String blobKey, long size, User author) {
        this.number = number;
        this.blobKey = blobKey;
        this.size = size;
        this.author = author;
        this.createdAt = java.time.Instant.now();
    }

    public int getNumber() { return number; }
    public String getBlobKey() { return blobKey; }
    public long getSize() { return size; }
    public User getAuthor() { return author; }
}` }
        ]
      },
      {
        heading: "Requirement 5: DriveService ties it together",
        text: "The service is the single entry point. Every method checks permission first, then does its work. Upload takes the version the caller last saw, which is how stale writes are detected (see the first deep dive).",
        code: [
          { file: "DriveService.java", body: `public class DriveService {
    private final BlobStore blobs;
    private final PermissionChecker checker = new PermissionChecker();

    public DriveService(BlobStore blobs) { this.blobs = blobs; }

    public Folder createFolder(User user, Folder parent, String name) {
        checker.require(user, parent, Permission.EDITOR);
        Folder f = new Folder(name, user, parent);
        parent.add(f);
        return f;
    }

    public synchronized FileVersion upload(User user, File file, byte[] content, int baseVersion) {
        checker.require(user, file, Permission.EDITOR);
        if (baseVersion != file.versionCount()) {
            throw new IllegalStateException("File changed since version " + baseVersion);
        }
        String key = blobs.put(content);
        FileVersion v = new FileVersion(file.versionCount() + 1, key, content.length, user);
        file.append(v);
        return v;
    }

    public byte[] download(User user, File file, int versionNumber) {
        checker.require(user, file, Permission.VIEWER);
        return blobs.get(file.version(versionNumber).getBlobKey());
    }

    public FileVersion restore(User user, File file, int versionNumber) {
        checker.require(user, file, Permission.EDITOR);
        FileVersion old = file.version(versionNumber);
        FileVersion v = new FileVersion(file.versionCount() + 1, old.getBlobKey(), old.getSize(), user);
        file.append(v);
        return v;
    }

    public void share(User actor, Node node, User target, Permission level) {
        checker.require(actor, node, Permission.OWNER);
        node.getAcl().grant(target, level);
    }
}` }
        ],
        note: "`restore` appends a new version that points at the old blob. History is never rewritten, and no bytes are copied."
      }
    ],
    deepDive: [
      {
        title: "Detecting conflicting edits",
        text: "Pessimistic locking (lock the file while someone edits) hurts in a collaborative product because locks get abandoned. Prefer **optimistic concurrency**: the client sends the version it based its edit on, and the server accepts the write only if that is still the latest. In the code above this is the `baseVersion` check inside a synchronized method.\n\nIn a real system that check-and-append must be atomic in the database, for example `UPDATE ... WHERE current_version = :base`. When it fails, the client fetches the latest version and merges or asks the user."
      },
      {
        title: "Deleting and garbage-collecting blobs",
        text: "Deduplication by content hash means two files may share one blob, so deleting a file must not delete its blob blindly. Track a reference count per blob, or run a periodic mark-and-sweep that removes blobs no live version references. Prefer soft-deleting the file first (a trash folder) so accidental deletes are recoverable."
      },
      {
        title: "Large files",
        text: "Holding a whole file in a `byte[]` does not scale. Change `BlobStore` to accept and return streams, and upload in chunks, hashing as you go. Chunk-level dedup then falls out naturally: a `FileVersion` becomes an ordered list of chunk keys, so an edit to one section re-uploads only the chunks that changed."
      }
    ],
    mistakes: [
      "Using separate class hierarchies for files and folders, then duplicating permission and path logic in both.",
      "Copying the file bytes into every version, which wastes storage; versions should reference blobs.",
      "Checking permissions only on the node itself and forgetting inheritance from the parent folder.",
      "Scattering permission checks across methods instead of centralising them in one checker.",
      "Mutating old versions on restore. History should be append-only.",
      "Forcing a pattern in just to impress the interviewer. Composite and Facade fall out naturally here; do not bolt on Visitor or Decorator without a reason."
    ],
    followups: [
      "How would you support a file that appears in multiple folders (shortcuts or links)?",
      "How would you add shareable public links with an expiry date?",
      "How would you add trash, restore and permanent delete with a retention period?",
      "How would you make search by name and owner fast over millions of nodes?"
    ],
    patterns: ["composite", "facade", "strategy"]
  },

  /* ------------------------------------------------------------------ */
  {
    id: "chat-application",
    name: "Design Chat Application",
    difficulty: "medium",
    understanding: "Design the object model of a chat application: users send messages in one-to-one chats and group rooms, messages are stored in order, and online members receive them in real time. The interesting parts are modelling one-to-one and group chats uniformly, decoupling message delivery from the sender, and handling users who are offline.",
    dialogue: [
      { who: "you", text: "Do we support both one-to-one and group conversations?" },
      { who: "int", text: "Yes, both. Treat them as the same idea if you can." },
      { who: "you", text: "What kinds of message: text only, or also images and files?" },
      { who: "int", text: "Text and attachments. Design so new message types are easy to add." },
      { who: "you", text: "What does real-time mean here? Should a connected user see messages immediately?" },
      { who: "int", text: "Yes. Connected users get messages pushed to them. Offline users should see them when they come back." },
      { who: "you", text: "Do we need delivery and read receipts?" },
      { who: "int", text: "Basic ones: sent, delivered, read." },
      { who: "you", text: "How is a user authenticated?" },
      { who: "int", text: "Assume a login service gives you a session token. Show where you validate it, but do not design the login itself." },
      { who: "you", text: "Is message history paginated?" },
      { who: "int", text: "Yes. Load the latest messages first, older ones on demand." }
    ],
    requirements: [
      { group: "Core", items: [
        "Users send messages in one-to-one chats and group rooms.",
        "A message is stored in order with sender, timestamp and content.",
        "Online members of a room receive a new message immediately.",
        "Offline members receive undelivered messages when they reconnect.",
        "Messages have sent, delivered and read status.",
        "Only authenticated users can send, and only room members can read."
      ] },
      { group: "Concurrency", items: [
        "Messages in a room keep a single consistent order even when sent concurrently."
      ] },
      { group: "Extensibility", items: [
        "New message types (image, file, location) can be added without changing delivery.",
        "Delivery channels can change (WebSocket, push notification) without changing chat logic."
      ] }
    ],
    entities: [
      { name: "User", text: "A person with an id, name and online status." },
      { name: "Chat", text: "A conversation with a member list. A one-to-one chat is simply a chat with two members." },
      { name: "Message", text: "Abstract base: id, sender, chat, timestamp and status." },
      { name: "TextMessage / ImageMessage", text: "Concrete message types." },
      { name: "MessageStatus", text: "An enum: SENT, DELIVERED, READ." },
      { name: "Session", text: "An authenticated connection for a user." },
      { name: "DeliveryChannel", text: "Interface that pushes a message to one connected user." },
      { name: "ChatService", text: "Facade that validates, stores and fans out messages." }
    ],
    design: [
      {
        heading: "Requirement 1: One Chat model for both one-to-one and group",
        text: "Do not create `DirectChat` and `GroupChat` classes with duplicated logic. A chat is a set of members and an ordered list of messages. A direct chat has two members; a group has more and a name. The `Chat` also assigns sequence numbers, which gives every message one definite position.",
        code: [
          { file: "Chat.java", body: `public class Chat {
    private final String id = java.util.UUID.randomUUID().toString();
    private final String name;                       // null for direct chats
    private final java.util.Set<User> members = new java.util.LinkedHashSet<>();
    private final java.util.List<Message> messages = new java.util.ArrayList<>();

    public Chat(String name, java.util.Collection<User> members) {
        this.name = name;
        this.members.addAll(members);
    }

    public String getId() { return id; }
    public boolean hasMember(User u) { return members.contains(u); }
    public java.util.Set<User> getMembers() { return java.util.Collections.unmodifiableSet(members); }

    // synchronized so concurrent senders get one consistent order
    public synchronized Message append(Message m) {
        m.assignSequence(messages.size() + 1);
        messages.add(m);
        return m;
    }

    public synchronized java.util.List<Message> latest(int limit) {
        int from = Math.max(0, messages.size() - limit);
        return new java.util.ArrayList<>(messages.subList(from, messages.size()));
    }

    public synchronized java.util.List<Message> before(long sequence, int limit) {
        java.util.List<Message> out = new java.util.ArrayList<>();
        for (int i = (int) sequence - 2; i >= 0 && out.size() < limit; i--) out.add(0, messages.get(i));
        return out;
    }
}` }
        ]
      },
      {
        heading: "Requirement 2: Message types without if/else",
        text: "Delivery and storage should not care what is inside a message. Define an abstract `Message` with the common fields and let subclasses add their payload. New types are new subclasses.",
        code: [
          { file: "Message.java", body: `public abstract class Message {
    private final String id = java.util.UUID.randomUUID().toString();
    private final User sender;
    private final java.time.Instant sentAt = java.time.Instant.now();
    private long sequence;
    private MessageStatus status = MessageStatus.SENT;

    protected Message(User sender) { this.sender = sender; }

    public User getSender() { return sender; }
    public long getSequence() { return sequence; }
    public MessageStatus getStatus() { return status; }

    void assignSequence(long s) { this.sequence = s; }
    public void markDelivered() { if (status == MessageStatus.SENT) status = MessageStatus.DELIVERED; }
    public void markRead() { status = MessageStatus.READ; }

    public abstract String preview();
}` },
          { file: "TextMessage.java", body: `public class TextMessage extends Message {
    private final String text;

    public TextMessage(User sender, String text) {
        super(sender);
        this.text = text;
    }

    public String preview() { return text; }
}` },
          { file: "ImageMessage.java", body: `public class ImageMessage extends Message {
    private final String url;

    public ImageMessage(User sender, String url) {
        super(sender);
        this.url = url;
    }

    public String preview() { return "[image] " + url; }
}` }
        ]
      },
      {
        heading: "Requirement 3: Real-time delivery that does not depend on the sender",
        text: "The sender should not loop over recipients and know how each one is connected. Introduce a `DeliveryChannel` interface and a registry of who is online. When a message is stored, the service pushes it to each online member and parks it in an inbox for each offline one. This is Observer in spirit: members of a chat are subscribers to it.",
        code: [
          { file: "DeliveryChannel.java", body: `public interface DeliveryChannel {
    boolean isOnline(User user);
    void push(User user, Message message);
}` },
          { file: "WebSocketChannel.java", body: `public class WebSocketChannel implements DeliveryChannel {
    private final java.util.Map<String, Connection> connections = new java.util.concurrent.ConcurrentHashMap<>();

    public void connect(User user, Connection c) { connections.put(user.getId(), c); }
    public void disconnect(User user) { connections.remove(user.getId()); }

    public boolean isOnline(User user) { return connections.containsKey(user.getId()); }

    public void push(User user, Message message) {
        Connection c = connections.get(user.getId());
        if (c != null) c.send(message);
    }
}` },
          { file: "Inbox.java", body: `public class Inbox {
    private final java.util.Map<String, java.util.Queue<Message>> pending = new java.util.concurrent.ConcurrentHashMap<>();

    public void add(User user, Message m) {
        pending.computeIfAbsent(user.getId(), k -> new java.util.concurrent.ConcurrentLinkedQueue<>()).add(m);
    }

    public java.util.List<Message> drain(User user) {
        java.util.Queue<Message> q = pending.remove(user.getId());
        return q == null ? java.util.List.of() : new java.util.ArrayList<>(q);
    }
}` }
        ],
        note: "Swapping WebSocket for push notifications is a new `DeliveryChannel` implementation. Chat logic never changes."
      },
      {
        heading: "Requirement 4: Authentication and the send path",
        text: "`ChatService` is the only entry point. It resolves the session to a user, checks membership, stores the message, then fans out. Validation lives here, so channels and chats stay simple.",
        code: [
          { file: "ChatService.java", body: `public class ChatService {
    private final SessionStore sessions;
    private final DeliveryChannel channel;
    private final Inbox inbox = new Inbox();

    public ChatService(SessionStore sessions, DeliveryChannel channel) {
        this.sessions = sessions;
        this.channel = channel;
    }

    public Message send(String token, Chat chat, Message message) {
        User sender = sessions.resolve(token);          // throws if token invalid or expired
        if (!chat.hasMember(sender) || !message.getSender().equals(sender)) {
            throw new SecurityException("Not allowed to send in this chat");
        }
        chat.append(message);

        for (User member : chat.getMembers()) {
            if (member.equals(sender)) continue;
            if (channel.isOnline(member)) {
                channel.push(member, message);
                message.markDelivered();
            } else {
                inbox.add(member, message);
            }
        }
        return message;
    }

    // Called when a user reconnects
    public java.util.List<Message> sync(String token) {
        User user = sessions.resolve(token);
        java.util.List<Message> missed = inbox.drain(user);
        missed.forEach(Message::markDelivered);
        return missed;
    }

    public void markRead(String token, Chat chat, Message message) {
        User reader = sessions.resolve(token);
        if (!chat.hasMember(reader)) throw new SecurityException("Not a member");
        message.markRead();
    }
}` }
        ]
      }
    ],
    deepDive: [
      {
        title: "Ordering messages across concurrent senders",
        text: "Two people send at the same moment. Using client timestamps for order is unreliable because clocks differ. Assign a **per-chat sequence number on the server** at append time, as `Chat.append` does. Everyone then sees the same order, and clients can ask for \"messages after sequence N\" to resume cleanly.\n\nIn a distributed system the sequence for one chat must come from a single owner (for example by partitioning chats across servers), so you never need a global lock."
      },
      {
        title: "Receipts in group chats",
        text: "A single `status` field works for a direct chat, but in a group the answer to \"was it read?\" depends on who you ask. Store status per recipient: `Map<User, MessageStatus>` on the message, or a separate receipts table. The sender's UI can then show \"read by 3 of 5\". Keep the simple enum for the one-to-one case if that is all the interviewer asks for, and mention this as the extension."
      }
    ],
    mistakes: [
      "Separate DirectChat and GroupChat classes that duplicate sending, storage and ordering.",
      "Having the sender iterate over recipients and open connections itself, which couples chat logic to the transport.",
      "Ordering by client timestamp instead of a server-assigned sequence.",
      "Forgetting offline users, so messages are lost unless the recipient is connected at send time.",
      "Not checking chat membership when sending or reading.",
      "Forcing a pattern in just to impress the interviewer. A DeliveryChannel interface earns its place; a full Mediator with a message bus does not at this scope."
    ],
    followups: [
      "How would you add typing indicators and presence (online, last seen)?",
      "How would you support editing and deleting a message?",
      "How would you add end-to-end encryption to the model?",
      "How would you scale to millions of rooms across many servers?"
    ],
    patterns: ["observer", "mediator", "factory-method"]
  },

  /* ------------------------------------------------------------------ */
  {
    id: "otp-generation-system",
    name: "Design OTP Generation System",
    difficulty: "easy",
    understanding: "Design a service that generates one-time passwords, delivers them, and verifies them later. The substance is in the rules around the code: it must be unpredictable, expire quickly, work only once, and lock out guessing. It is a small system where correctness and security details matter more than structure.",
    dialogue: [
      { who: "you", text: "What is the OTP used for, login or transaction confirmation? Does that change the rules?" },
      { who: "int", text: "Both. Treat each use as a purpose, like LOGIN or PAYMENT, with its own settings." },
      { who: "you", text: "How long is the code and how long is it valid?" },
      { who: "int", text: "Six digits, valid for five minutes by default. Make both configurable." },
      { who: "you", text: "Can a code be used more than once?" },
      { who: "int", text: "No. A successful verification consumes it." },
      { who: "you", text: "What if someone keeps guessing wrong codes?" },
      { who: "int", text: "Limit attempts per OTP, say three. After that the OTP is invalid and the user must request a new one." },
      { who: "you", text: "If a user requests a new OTP, what happens to the previous one?" },
      { who: "int", text: "The old one is invalidated. Also limit how often a user can request one." },
      { who: "you", text: "How is the code sent?" },
      { who: "int", text: "SMS or email. Make the sender pluggable." }
    ],
    requirements: [
      { group: "Core", items: [
        "Generate a random numeric OTP of configurable length for a user and purpose.",
        "Send it through a pluggable channel (SMS, email).",
        "An OTP expires after a configurable time to live.",
        "Verification succeeds once; a used OTP can never be reused.",
        "After a maximum number of wrong attempts the OTP is invalidated.",
        "Requesting a new OTP invalidates the previous one for that user and purpose."
      ] },
      { group: "Concurrency", items: [
        "Two simultaneous verifications of the same OTP: only one may succeed."
      ] },
      { group: "Extensibility", items: [
        "Rules (length, expiry, attempts, resend limit) vary by purpose.",
        "Delivery channels can be added without touching the OTP logic."
      ] }
    ],
    entities: [
      { name: "OtpPurpose", text: "An enum such as LOGIN or PAYMENT." },
      { name: "OtpPolicy", text: "Settings for a purpose: length, time to live, max attempts, min seconds between requests." },
      { name: "Otp", text: "One issued code: the stored hash, expiry, attempts used and whether it was consumed." },
      { name: "OtpGenerator", text: "Produces a secure random code." },
      { name: "OtpSender", text: "Interface that delivers a code to a destination." },
      { name: "OtpService", text: "Issues and verifies OTPs and enforces the rules." }
    ],
    design: [
      {
        heading: "Requirement 1: Generate an unpredictable code",
        text: "Use a cryptographically secure source of randomness. `java.util.Random` is predictable and must not be used for security codes. Also keep leading zeros: a code is a string of digits, not an int.",
        code: [
          { file: "OtpGenerator.java", body: `public class OtpGenerator {
    private final java.security.SecureRandom random = new java.security.SecureRandom();

    public String generate(int length) {
        StringBuilder sb = new StringBuilder(length);
        for (int i = 0; i < length; i++) sb.append(random.nextInt(10));
        return sb.toString();
    }
}` }
        ]
      },
      {
        heading: "Requirement 2: Per-purpose rules in a policy object",
        text: "Different purposes need different settings, such as a shorter expiry for payments. Put the settings in an immutable `OtpPolicy` and look it up by purpose, instead of branching on purpose inside the service.",
        code: [
          { file: "OtpPolicy.java", body: `public final class OtpPolicy {
    private final int length;
    private final java.time.Duration ttl;
    private final int maxAttempts;
    private final java.time.Duration minResendGap;

    public OtpPolicy(int length, java.time.Duration ttl, int maxAttempts, java.time.Duration minResendGap) {
        this.length = length;
        this.ttl = ttl;
        this.maxAttempts = maxAttempts;
        this.minResendGap = minResendGap;
    }

    public int getLength() { return length; }
    public java.time.Duration getTtl() { return ttl; }
    public int getMaxAttempts() { return maxAttempts; }
    public java.time.Duration getMinResendGap() { return minResendGap; }
}` },
          { file: "OtpPurpose.java", body: `public enum OtpPurpose { LOGIN, PAYMENT, PASSWORD_RESET }` }
        ]
      },
      {
        heading: "Requirement 3: The OTP record, expiry and one-time use",
        text: "Store a **hash** of the code, not the code itself, so a leaked database does not leak live OTPs. The record knows its own expiry and attempt count. Verification mutates it, so it must be done atomically.",
        code: [
          { file: "Otp.java", body: `public class Otp {
    private final String codeHash;
    private final java.time.Instant issuedAt;
    private final java.time.Instant expiresAt;
    private final int maxAttempts;
    private int attempts;
    private boolean consumed;

    public Otp(String codeHash, java.time.Instant issuedAt, java.time.Duration ttl, int maxAttempts) {
        this.codeHash = codeHash;
        this.issuedAt = issuedAt;
        this.expiresAt = issuedAt.plus(ttl);
        this.maxAttempts = maxAttempts;
    }

    public java.time.Instant getIssuedAt() { return issuedAt; }

    public synchronized VerifyResult verify(String candidateHash, java.time.Instant now) {
        if (consumed) return VerifyResult.ALREADY_USED;
        if (now.isAfter(expiresAt)) return VerifyResult.EXPIRED;
        if (attempts >= maxAttempts) return VerifyResult.TOO_MANY_ATTEMPTS;

        attempts++;
        if (java.security.MessageDigest.isEqual(codeHash.getBytes(), candidateHash.getBytes())) {
            consumed = true;
            return VerifyResult.SUCCESS;
        }
        return attempts >= maxAttempts ? VerifyResult.TOO_MANY_ATTEMPTS : VerifyResult.WRONG_CODE;
    }
}` },
          { file: "VerifyResult.java", body: `public enum VerifyResult {
    SUCCESS, WRONG_CODE, EXPIRED, ALREADY_USED, TOO_MANY_ATTEMPTS, NOT_FOUND
}` }
        ],
        note: "`MessageDigest.isEqual` compares in constant time, so response time does not reveal how many leading characters were right."
      },
      {
        heading: "Requirement 4: Pluggable delivery",
        text: "Sending is a separate concern behind an interface. The service never knows whether the code goes out by SMS or email, and tests can use a fake sender that captures the code.",
        code: [
          { file: "OtpSender.java", body: `public interface OtpSender {
    void send(String destination, String code);
}` },
          { file: "SmsOtpSender.java", body: `public class SmsOtpSender implements OtpSender {
    private final SmsGateway gateway;

    public SmsOtpSender(SmsGateway gateway) { this.gateway = gateway; }

    public void send(String phone, String code) {
        gateway.sendSms(phone, "Your verification code is " + code + ". Do not share it.");
    }
}` }
        ]
      },
      {
        heading: "Requirement 5: OtpService enforces the lifecycle",
        text: "The service keeps at most one active OTP per user and purpose. Issuing a new one replaces the old, which invalidates it. A resend gap stops someone from spamming a phone number with messages.",
        code: [
          { file: "OtpService.java", body: `public class OtpService {
    private final OtpGenerator generator = new OtpGenerator();
    private final java.util.Map<OtpPurpose, OtpPolicy> policies;
    private final OtpSender sender;
    private final java.time.Clock clock;
    private final java.util.Map<String, Otp> active = new java.util.concurrent.ConcurrentHashMap<>();

    public OtpService(java.util.Map<OtpPurpose, OtpPolicy> policies, OtpSender sender, java.time.Clock clock) {
        this.policies = policies;
        this.sender = sender;
        this.clock = clock;
    }

    private String key(String userId, OtpPurpose purpose) { return userId + ":" + purpose; }

    public void issue(String userId, String destination, OtpPurpose purpose) {
        OtpPolicy policy = policies.get(purpose);
        java.time.Instant now = clock.instant();
        String k = key(userId, purpose);

        Otp previous = active.get(k);
        if (previous != null && now.isBefore(previous.getIssuedAt().plus(policy.getMinResendGap()))) {
            throw new IllegalStateException("Please wait before requesting another code");
        }

        String code = generator.generate(policy.getLength());
        active.put(k, new Otp(Hashing.sha256Hex(code), now, policy.getTtl(), policy.getMaxAttempts()));
        sender.send(destination, code);
    }

    public VerifyResult verify(String userId, OtpPurpose purpose, String code) {
        Otp otp = active.get(key(userId, purpose));
        if (otp == null) return VerifyResult.NOT_FOUND;
        return otp.verify(Hashing.sha256Hex(code), clock.instant());
    }
}` }
        ],
        note: "Injecting a `Clock` lets tests move time forward to check expiry without sleeping."
      }
    ],
    deepDive: [
      {
        title: "Why a plain hash is only a start",
        text: "A six-digit code has just a million possibilities, so a leaked unsalted hash can be brute-forced in milliseconds. The real protection is the short expiry and the attempt limit, which stop online guessing, plus a salted or keyed hash (HMAC with a server secret) so a database leak alone is not enough. Say this out loud: it shows you understand that hashing is defence in depth here, not the main control."
      },
      {
        title: "TOTP versus stored OTPs",
        text: "Time-based OTPs (the kind in authenticator apps) avoid storing codes at all. Both sides derive the code from a shared secret and the current 30-second window, and the server accepts a small window of drift. That scales better because there is nothing to write per request, but it needs a secret per user and does not fit codes sent by SMS. In a distributed deployment, the stored version needs an expiring store such as Redis with atomic increment for the attempt counter."
      }
    ],
    mistakes: [
      "Using java.util.Random, or a counter-based code, which an attacker can predict.",
      "Storing the OTP in plain text, or logging it.",
      "Not limiting attempts, which allows brute-forcing a six-digit code in minutes.",
      "Letting an old OTP stay valid after a new one is issued.",
      "Checking and consuming the code in two separate steps, which allows two concurrent verifications to both succeed.",
      "Forcing a pattern in just to impress the interviewer. A policy object and a sender interface are plenty; a State machine for one boolean is overkill."
    ],
    followups: [
      "How would you rate-limit requests per phone number or IP across the whole system?",
      "How would you store OTPs in Redis with automatic expiry?",
      "How would you design TOTP support for authenticator apps?",
      "How would you add a fallback to email when the SMS fails to deliver?"
    ],
    patterns: ["strategy", "factory-method"]
  }
);
