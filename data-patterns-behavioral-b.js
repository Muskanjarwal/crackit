window.PATTERNS = window.PATTERNS || [];
window.PATTERNS.push(
  {
    id: "iterator",
    name: "Iterator",
    category: "behavioral",
    difficulty: "easy",
    understanding: "Iterator gives clients a uniform way to walk through a collection, one element at a time, without exposing whether it is backed by an array, a linked list, a tree or a database cursor.",
    problem: {
      intro: "You are designing the playback queue of a music app. Songs live in several different structures, and the player must traverse all of them the same way.",
      dialogue: [
        { who: "you", text: "How are songs stored today?" },
        { who: "int", text: "The library is an array list, but playlists can contain nested folders, so that part is a tree." },
        { who: "you", text: "And how does the player consume them?" },
        { who: "int", text: "It plays next, next, next. Later we want shuffle and reverse order as well." },
        { who: "you", text: "So the player should not care how a collection is laid out or in which order it is visited." },
        { who: "int", text: "Right. Adding a new traversal must not touch the player." }
      ],
      requirements: [
        "Traverse flat lists and nested folders with the same player code.",
        "Support multiple traversal orders (sequential, reverse, shuffle).",
        "Several traversals can be active on one collection at the same time.",
        "The player must not depend on the internal structure of any collection."
      ]
    },
    badApproach: {
      text: "The player reaches into each collection and knows how to walk it.",
      code: "class Player {\n  void playAll(Object source) {\n    if (source instanceof List) {\n      List<Song> songs = (List<Song>) source;\n      for (int i = 0; i < songs.size(); i++) play(songs.get(i));\n    } else if (source instanceof Folder) {\n      playFolder((Folder) source);\n    }\n  }\n\n  private void playFolder(Folder f) {\n    for (Song s : f.songs) play(s);\n    for (Folder child : f.children) playFolder(child);\n  }\n}",
      why: [
        "The player knows the internals of every collection, so each new structure edits it.",
        "Traversal order is hard-coded; shuffle means another branch.",
        "Traversal state lives in local variables, so two cursors over one collection are awkward."
      ]
    },
    design: [
      {
        heading: "Define the iterator contract",
        text: "A tiny interface that exposes only what a client needs: is there more, and give me the next one.",
        code: [
          { file: "SongIterator.java", body: "public interface SongIterator {\n  boolean hasNext();\n  Song next();\n}" },
          { file: "SongCollection.java", body: "public interface SongCollection {\n  SongIterator iterator();\n}" }
        ]
      },
      {
        heading: "Each collection returns its own iterator",
        text: "The traversal logic and its cursor state live in a separate object created by the collection. The collection can keep its internals private.",
        code: [
          { file: "Library.java", body: "public class Library implements SongCollection {\n  private final List<Song> songs = new ArrayList<>();\n\n  public void add(Song s) { songs.add(s); }\n\n  public SongIterator iterator() {\n    return new SongIterator() {\n      private int index = 0;\n      public boolean hasNext() { return index < songs.size(); }\n      public Song next() { return songs.get(index++); }\n    };\n  }\n\n  public SongIterator reverseIterator() {\n    return new SongIterator() {\n      private int index = songs.size() - 1;\n      public boolean hasNext() { return index >= 0; }\n      public Song next() { return songs.get(index--); }\n    };\n  }\n}" },
          { file: "FolderIterator.java", body: "public class FolderIterator implements SongIterator {\n  private final Deque<Folder> pending = new ArrayDeque<>();\n  private Iterator<Song> current = Collections.emptyIterator();\n\n  public FolderIterator(Folder root) { pending.push(root); }\n\n  public boolean hasNext() {\n    while (!current.hasNext() && !pending.isEmpty()) {\n      Folder f = pending.pop();\n      current = f.songs().iterator();\n      f.children().forEach(pending::push);\n    }\n    return current.hasNext();\n  }\n\n  public Song next() {\n    if (!hasNext()) throw new NoSuchElementException();\n    return current.next();\n  }\n}" }
        ],
        note: "The tree traversal keeps its own explicit stack. A caller never sees recursion or the folder structure."
      },
      {
        heading: "Decorate iterators for new orders",
        text: "Because iterators share one interface, shuffle can wrap any source iterator instead of being baked into each collection.",
        code: [
          { file: "ShuffleIterator.java", body: "public class ShuffleIterator implements SongIterator {\n  private final List<Song> buffer = new ArrayList<>();\n  private int index = 0;\n\n  public ShuffleIterator(SongIterator source) {\n    while (source.hasNext()) buffer.add(source.next());\n    Collections.shuffle(buffer);\n  }\n\n  public boolean hasNext() { return index < buffer.size(); }\n  public Song next() { return buffer.get(index++); }\n}" }
        ]
      }
    ],
    usage: {
      text: "The player accepts any `SongIterator`. Which collection and which order are decisions made by whoever builds the queue.",
      code: [
        { file: "Player.java", body: "class Player {\n  void playAll(SongIterator songs) {\n    while (songs.hasNext()) {\n      play(songs.next());\n    }\n  }\n}\n\n// elsewhere\nplayer.playAll(library.iterator());\nplayer.playAll(new ShuffleIterator(new FolderIterator(rootFolder)));" }
      ]
    },
    whenToUse: [
      "A collection has a complex structure (tree, graph) you want to hide.",
      "You need several traversal strategies over the same data.",
      "Clients should treat different collection types uniformly.",
      "You need independent cursors on one collection at once."
    ],
    whenNotToUse: [
      "A plain array or list is enough; the language's built-in for-each already is Iterator.",
      "Callers genuinely need random access by index.",
      "The collection is tiny and will never change shape."
    ],
    mistakes: [
      "Re-implementing what the language already gives you. In Java, implement `Iterable<T>` so for-each works.",
      "Exposing the iterator's cursor so callers can reset or corrupt it.",
      "Ignoring concurrent modification: mutating a collection mid-traversal should fail fast or be documented.",
      "Building a new pattern class for a simple loop. Design patterns are good to have, but don't force one in just to impress the interviewer."
    ],
    deepDive: [
      {
        title: "Internal vs external iterators",
        text: "An **external** iterator hands control to the client, which calls `next()` when it wants. An **internal** iterator (`forEach`, `stream().map`) takes a callback and drives the loop itself. External iterators allow early exit and lock-step traversal of two collections; internal ones are shorter and let the library parallelise."
      },
      {
        title: "Fail-fast iterators",
        text: "Track a modification counter in the collection and compare it inside the iterator. If they differ, throw `ConcurrentModificationException` rather than return inconsistent data.",
        code: [
          { file: "FailFast.java", body: "private int modCount = 0;\n\npublic void add(Song s) { songs.add(s); modCount++; }\n\n// inside the iterator\nprivate final int expected = modCount;\npublic Song next() {\n  if (modCount != expected) throw new ConcurrentModificationException();\n  return songs.get(index++);\n}" }
        ]
      }
    ],
    usedIn: [
      "LRU Cache: iterate entries from most to least recently used.",
      "File system or menu tree traversal.",
      "Paginated search results hidden behind one cursor.",
      "Playlist and queue designs in media-player questions."
    ],
    related: ["composite", "visitor", "memento"]
  },

  {
    id: "mediator",
    name: "Mediator",
    category: "behavioral",
    difficulty: "medium",
    understanding: "Mediator centralises how a group of objects communicate. Instead of every object holding references to every other, they talk only to the mediator, which decides who needs to hear what.",
    problem: {
      intro: "You are asked to design a chat room. Users send messages, can be muted, and some messages are private. The first version works, but it gets tangled fast.",
      dialogue: [
        { who: "you", text: "Do users message each other directly or through the room?" },
        { who: "int", text: "Think of a group chat. A user posts, and everyone else in the room should see it." },
        { who: "you", text: "Any rules about who can hear whom?" },
        { who: "int", text: "Muted users can't post, and users can send private messages. More rules will arrive, like blocking." },
        { who: "you", text: "Then routing rules should live in one place, not inside each user." },
        { who: "int", text: "That is what I want to see." }
      ],
      requirements: [
        "Users join and leave a room.",
        "A message from one user is delivered to all others in the room.",
        "Support private messages and muted users.",
        "Adding a new routing rule must not change the User class."
      ]
    },
    badApproach: {
      text: "Every user keeps references to the other users and sends to them directly.",
      code: "class User {\n  private final String name;\n  private final List<User> contacts = new ArrayList<>();\n\n  void connect(User other) {\n    contacts.add(other);\n    other.contacts.add(this);\n  }\n\n  void send(String text) {\n    for (User u : contacts) {\n      if (!u.blocked.contains(this) && !this.muted) {\n        u.receive(name, text);\n      }\n    }\n  }\n}",
      why: [
        "N users means up to N*(N-1) references to keep in sync on join and leave.",
        "Routing rules (mute, block, private) are scattered across the User class.",
        "Users cannot be reused in another context, such as a support channel, because they are coupled to each other."
      ]
    },
    design: [
      {
        heading: "Introduce the mediator interface",
        text: "Colleagues depend on an abstraction, not on each other. It exposes only what colleagues need to ask for.",
        code: [
          { file: "ChatMediator.java", body: "public interface ChatMediator {\n  void join(User user);\n  void leave(User user);\n  void broadcast(User from, String text);\n  void whisper(User from, String toName, String text);\n}" }
        ]
      },
      {
        heading: "Colleagues know only the mediator",
        text: "A user holds a single reference, the room. It does not know who else is listening.",
        code: [
          { file: "User.java", body: "public class User {\n  private final String name;\n  private final ChatMediator room;\n\n  public User(String name, ChatMediator room) {\n    this.name = name;\n    this.room = room;\n  }\n\n  public String name() { return name; }\n\n  public void say(String text) { room.broadcast(this, text); }\n  public void whisper(String to, String text) { room.whisper(this, to, text); }\n\n  public void receive(String from, String text) {\n    System.out.println(name + \" got [\" + from + \"]: \" + text);\n  }\n}" }
        ]
      },
      {
        heading: "The mediator owns the routing rules",
        text: "Membership, muting and delivery live in one class. A new rule edits only this class.",
        code: [
          { file: "ChatRoom.java", body: "public class ChatRoom implements ChatMediator {\n  private final Map<String, User> members = new LinkedHashMap<>();\n  private final Set<String> muted = new HashSet<>();\n\n  public void join(User u) { members.put(u.name(), u); }\n  public void leave(User u) { members.remove(u.name()); }\n  public void mute(String name) { muted.add(name); }\n\n  public void broadcast(User from, String text) {\n    if (muted.contains(from.name())) return;\n    for (User u : members.values()) {\n      if (u != from) u.receive(from.name(), text);\n    }\n  }\n\n  public void whisper(User from, String toName, String text) {\n    User target = members.get(toName);\n    if (target != null && !muted.contains(from.name())) {\n      target.receive(from.name() + \" (private)\", text);\n    }\n  }\n}" }
        ],
        note: "Blocking is now one extra set and one extra check in `ChatRoom`. `User` does not change."
      }
    ],
    usage: {
      text: "Users are created with the room, then join it. After that they only ever call the room.",
      code: [
        { file: "Main.java", body: "ChatRoom room = new ChatRoom();\nUser asha = new User(\"Asha\", room);\nUser ben  = new User(\"Ben\", room);\nroom.join(asha);\nroom.join(ben);\n\nasha.say(\"Hello team\");\nben.whisper(\"Asha\", \"Can we sync later?\");" }
      ]
    },
    whenToUse: [
      "Many objects interact in complicated, many-to-many ways.",
      "Interaction rules change often and should live in one place.",
      "You want to reuse components without dragging their peers along.",
      "Examples: chat rooms, air traffic control, dialog form widgets."
    ],
    whenNotToUse: [
      "Two or three objects talk in a simple one-to-one way.",
      "A fixed publish/subscribe model is enough; use Observer.",
      "The mediator would only forward calls and add no logic."
    ],
    mistakes: [
      "Letting the mediator grow into a god object that knows every detail of every colleague.",
      "Having colleagues still call each other directly, which defeats the purpose.",
      "Mediator and Observer confusion: Mediator coordinates two-way interaction, Observer just broadcasts one-way change.",
      "Adding a mediator for a two-object interaction. Design patterns are good to have, but don't force one in just to impress the interviewer."
    ],
    deepDive: [
      {
        title: "Keeping the mediator from becoming a god class",
        text: "Split the mediator by responsibility when it grows. Keep membership in `ChatRoom`, move delivery rules into a `RoutingPolicy` strategy and moderation into a `ModerationFilter`. The room then coordinates small collaborators instead of holding every rule.",
        code: [
          { file: "RoutingPolicy.java", body: "public interface RoutingPolicy {\n  boolean canDeliver(User from, User to, String text);\n}\n\n// in ChatRoom.broadcast\nfor (User u : members.values()) {\n  if (u != from && policy.canDeliver(from, u, text)) {\n    u.receive(from.name(), text);\n  }\n}" }
        ]
      },
      {
        title: "Mediator vs Observer",
        text: "With Observer the subject does not know what listeners do with an update and there is no coordination between them. With Mediator the hub knows its colleagues and actively decides who gets what, often reacting to one colleague by commanding another. Many event buses are an Observer implementation used inside a Mediator."
      }
    ],
    usedIn: [
      "Chat rooms and group messaging designs.",
      "Elevator system: a controller dispatches requests to cars.",
      "Air traffic control or ride dispatcher style questions.",
      "Form and dialog designs where widgets enable or disable each other."
    ],
    related: ["observer", "facade", "command"]
  },

  {
    id: "memento",
    name: "Memento",
    category: "behavioral",
    difficulty: "medium",
    understanding: "Memento captures an object's internal state in a separate snapshot so it can be restored later, without exposing the object's internals to the outside world.",
    problem: {
      intro: "You are asked to add undo to a text editor. The editor has private fields, and you want to roll back without breaking encapsulation.",
      dialogue: [
        { who: "you", text: "What state needs to be restored on undo?" },
        { who: "int", text: "The text, the cursor position and the current selection." },
        { who: "you", text: "Should undo go back many steps?" },
        { who: "int", text: "Yes, a full history, with a sensible limit on memory." },
        { who: "you", text: "And the history should not be able to read or edit the editor's internals." },
        { who: "int", text: "Correct. Keep the editor's fields private." }
      ],
      requirements: [
        "Save a snapshot of editor state before each change.",
        "Undo restores the previous snapshot, and redo reapplies it.",
        "The editor's fields stay private; outsiders cannot edit snapshots.",
        "Limit how many snapshots are kept."
      ]
    },
    badApproach: {
      text: "Make the editor's fields public so a history class can copy them.",
      code: "class Editor {\n  public StringBuilder text = new StringBuilder();\n  public int cursor;\n  public int selectionStart;\n}\n\nclass History {\n  Deque<String> texts = new ArrayDeque<>();\n  Deque<Integer> cursors = new ArrayDeque<>();\n\n  void save(Editor e) {\n    texts.push(e.text.toString());\n    cursors.push(e.cursor);\n  }\n}",
      why: [
        "Public fields let anyone corrupt the editor, such as moving the cursor past the end.",
        "The history must know every field, so adding one means editing two classes.",
        "Parallel stacks drift out of sync easily."
      ]
    },
    design: [
      {
        heading: "The originator creates and restores snapshots",
        text: "Only the editor knows its own fields, so it is the one that builds a snapshot and reads one back. This preserves encapsulation.",
        code: [
          { file: "Editor.java", body: "public class Editor {\n  private StringBuilder text = new StringBuilder();\n  private int cursor;\n  private int selectionStart;\n\n  public void type(String s) {\n    text.insert(cursor, s);\n    cursor += s.length();\n  }\n\n  public Snapshot save() {\n    return new Snapshot(text.toString(), cursor, selectionStart);\n  }\n\n  public void restore(Snapshot s) {\n    this.text = new StringBuilder(s.text);\n    this.cursor = s.cursor;\n    this.selectionStart = s.selectionStart;\n  }\n\n  // Immutable memento nested so only Editor can read its fields\n  public static final class Snapshot {\n    private final String text;\n    private final int cursor;\n    private final int selectionStart;\n\n    private Snapshot(String text, int cursor, int selectionStart) {\n      this.text = text;\n      this.cursor = cursor;\n      this.selectionStart = selectionStart;\n    }\n  }\n}" }
        ],
        note: "`Snapshot` is immutable with private fields. To the outside world it is an opaque token that can be stored and handed back, nothing more."
      },
      {
        heading: "The caretaker stores snapshots without peeking",
        text: "The history manages undo and redo stacks. It never reads inside a snapshot.",
        code: [
          { file: "History.java", body: "public class History {\n  private final Deque<Editor.Snapshot> undo = new ArrayDeque<>();\n  private final Deque<Editor.Snapshot> redo = new ArrayDeque<>();\n  private final int limit;\n\n  public History(int limit) { this.limit = limit; }\n\n  public void record(Editor.Snapshot s) {\n    undo.push(s);\n    if (undo.size() > limit) undo.removeLast();\n    redo.clear();\n  }\n\n  public void undo(Editor editor) {\n    if (undo.isEmpty()) return;\n    redo.push(editor.save());\n    editor.restore(undo.pop());\n  }\n\n  public void redo(Editor editor) {\n    if (redo.isEmpty()) return;\n    undo.push(editor.save());\n    editor.restore(redo.pop());\n  }\n}" }
        ]
      },
      {
        heading: "Record before every mutating action",
        text: "Take the snapshot just before the change, so undo returns to the previous state.",
        code: [
          { file: "EditorController.java", body: "public class EditorController {\n  private final Editor editor = new Editor();\n  private final History history = new History(100);\n\n  public void type(String s) {\n    history.record(editor.save());\n    editor.type(s);\n  }\n\n  public void undo() { history.undo(editor); }\n  public void redo() { history.redo(editor); }\n}" }
        ]
      }
    ],
    usage: {
      text: "The controller is the only place that coordinates the editor and its history.",
      code: [
        { file: "Main.java", body: "EditorController c = new EditorController();\nc.type(\"Hello\");\nc.type(\" world\");\nc.undo();   // back to \"Hello\"\nc.redo();   // forward to \"Hello world\"" }
      ]
    },
    whenToUse: [
      "You need undo, redo or checkpoints and the object's fields are private.",
      "Direct access to the state would break encapsulation.",
      "Transactions that may need to roll back to a known good state.",
      "Examples: editors, games with save points, form drafts."
    ],
    whenNotToUse: [
      "State is huge and changes constantly; full snapshots get expensive. Prefer Command with inverse operations.",
      "The state is already immutable and versioned, so older versions exist for free.",
      "You only need a one-off copy; use Prototype."
    ],
    mistakes: [
      "Storing a reference to mutable state instead of a copy, so the snapshot changes later.",
      "Unbounded history, which leaks memory in long sessions.",
      "Forgetting to clear the redo stack after a new edit.",
      "Letting the caretaker read snapshot contents, which breaks encapsulation again."
    ],
    deepDive: [
      {
        title: "Memento vs Command for undo",
        text: "Memento stores **state** and restores it wholesale, which is simple and robust but costs memory proportional to state size. Command stores **operations** and their inverses, which is cheap per step but every command must be correctly reversible. Large systems often combine them: commands for fine-grained undo, periodic snapshots as checkpoints."
      },
      {
        title: "Reducing snapshot cost",
        text: "Store only the diff from the previous snapshot, or share unchanged parts. Persistent data structures (structural sharing) give cheap snapshots of large documents because untouched branches are reused between versions.",
        code: [
          { file: "Delta.java", body: "// Instead of a full copy of text, record just the change\nrecord Delta(int position, String removed, String inserted) {}\n\n// undo applies the reverse delta\nvoid undo(Delta d) {\n  text.replace(d.position(), d.position() + d.inserted().length(), d.removed());\n}" }
        ]
      }
    ],
    usedIn: [
      "Text editor undo/redo.",
      "Game save points and checkpoints.",
      "Form wizards that restore drafts.",
      "Database transaction rollback explained at object level."
    ],
    related: ["command", "prototype", "iterator"]
  },

  {
    id: "visitor",
    name: "Visitor",
    category: "behavioral",
    difficulty: "hard",
    understanding: "Visitor lets you add new operations to a stable set of classes without modifying them, by moving each operation into its own visitor object that the elements accept.",
    problem: {
      intro: "You are designing a document model with paragraphs, images and tables. The element types are fixed, but product keeps asking for new things to do with documents.",
      dialogue: [
        { who: "you", text: "What operations do we need on a document?" },
        { who: "int", text: "Right now, export to HTML and count words. Next quarter, export to Markdown and compute accessibility warnings." },
        { who: "you", text: "How often do new element types appear?" },
        { who: "int", text: "Rarely. Paragraph, image and table cover almost everything." },
        { who: "you", text: "So elements are stable, and operations keep growing." },
        { who: "int", text: "Yes. Adding an operation shouldn't mean editing every element class." }
      ],
      requirements: [
        "Document has paragraphs, images and tables, and tables contain cells.",
        "Support operations such as export to HTML and word count.",
        "New operations must not modify the element classes.",
        "Each operation can return its own result type."
      ]
    },
    badApproach: {
      text: "Put every operation as a method on every element.",
      code: "interface Element {\n  String toHtml();\n  String toMarkdown();\n  int wordCount();\n  List<String> accessibilityWarnings();\n}\n\nclass Paragraph implements Element {\n  String toHtml() { return \"<p>\" + text + \"</p>\"; }\n  String toMarkdown() { return text; }\n  int wordCount() { return text.split(\" \").length; }\n  // ... and again for every new operation\n}",
      why: [
        "Each new operation edits every element class, which violates Open/Closed.",
        "Unrelated concerns (rendering, analytics, accessibility) pile up in the model.",
        "Element classes grow heavier the more features exist."
      ]
    },
    design: [
      {
        heading: "Elements accept a visitor",
        text: "Each element has a single `accept` method. Calling `visitor.visit(this)` from inside the element is what selects the right overload, a technique called double dispatch.",
        code: [
          { file: "Element.java", body: "public interface Element {\n  <R> R accept(Visitor<R> visitor);\n}" },
          { file: "Paragraph.java", body: "public class Paragraph implements Element {\n  final String text;\n  public Paragraph(String text) { this.text = text; }\n  public <R> R accept(Visitor<R> v) { return v.visit(this); }\n}" },
          { file: "Image.java", body: "public class Image implements Element {\n  final String url;\n  final String alt;\n  public Image(String url, String alt) { this.url = url; this.alt = alt; }\n  public <R> R accept(Visitor<R> v) { return v.visit(this); }\n}" },
          { file: "Table.java", body: "public class Table implements Element {\n  final List<List<String>> rows;\n  public Table(List<List<String>> rows) { this.rows = rows; }\n  public <R> R accept(Visitor<R> v) { return v.visit(this); }\n}" }
        ]
      },
      {
        heading: "The visitor interface has one method per element type",
        text: "This is the contract every operation must satisfy. The generic result type lets each visitor return what it needs.",
        code: [
          { file: "Visitor.java", body: "public interface Visitor<R> {\n  R visit(Paragraph p);\n  R visit(Image i);\n  R visit(Table t);\n}" }
        ]
      },
      {
        heading: "Each operation is a visitor",
        text: "New behaviour is a new class. The element classes stay untouched.",
        code: [
          { file: "HtmlExporter.java", body: "public class HtmlExporter implements Visitor<String> {\n  public String visit(Paragraph p) { return \"<p>\" + p.text + \"</p>\"; }\n  public String visit(Image i) { return \"<img src='\" + i.url + \"' alt='\" + i.alt + \"'>\"; }\n  public String visit(Table t) {\n    StringBuilder sb = new StringBuilder(\"<table>\");\n    for (List<String> row : t.rows) {\n      sb.append(\"<tr>\");\n      for (String cell : row) sb.append(\"<td>\").append(cell).append(\"</td>\");\n      sb.append(\"</tr>\");\n    }\n    return sb.append(\"</table>\").toString();\n  }\n}" },
          { file: "WordCounter.java", body: "public class WordCounter implements Visitor<Integer> {\n  public Integer visit(Paragraph p) { return p.text.trim().split(\"\\\\s+\").length; }\n  public Integer visit(Image i) { return 0; }\n  public Integer visit(Table t) {\n    int total = 0;\n    for (List<String> row : t.rows)\n      for (String cell : row) total += cell.trim().split(\"\\\\s+\").length;\n    return total;\n  }\n}" }
        ]
      }
    ],
    usage: {
      text: "Walk the elements and hand each one the operation you want to run.",
      code: [
        { file: "Main.java", body: "List<Element> doc = List.of(\n  new Paragraph(\"Hello world\"),\n  new Image(\"cat.png\", \"A cat\"),\n  new Table(List.of(List.of(\"a\", \"b\"), List.of(\"c\", \"d\")))\n);\n\nHtmlExporter html = new HtmlExporter();\nfor (Element e : doc) System.out.println(e.accept(html));\n\nWordCounter counter = new WordCounter();\nint words = 0;\nfor (Element e : doc) words += e.accept(counter);" }
      ]
    },
    whenToUse: [
      "The set of element types is stable but operations keep being added.",
      "Operations need to treat each concrete type differently.",
      "You want to keep unrelated algorithms out of the model classes.",
      "Examples: syntax tree passes, document exporters, tax calculation over item types."
    ],
    whenNotToUse: [
      "New element types are added often, because every visitor must change.",
      "There are only one or two operations; plain methods are simpler.",
      "Your language has pattern matching over sealed types, which does the same more directly."
    ],
    mistakes: [
      "Using Visitor when the element hierarchy is the part that changes. You will edit every visitor each time.",
      "Exposing element internals publicly so visitors can read them, weakening encapsulation.",
      "Forgetting that traversal is a separate decision; decide whether elements or the visitor recurse into children.",
      "Reaching for Visitor to sound sophisticated. Design patterns are good to have, but don't force one in just to impress the interviewer."
    ],
    deepDive: [
      {
        title: "Double dispatch explained",
        text: "Java picks a method overload at compile time from the static type of the argument, so `visitor.visit(element)` over a `List<Element>` would not know the concrete type. `accept` fixes this: the first dispatch picks the element's `accept` at runtime, and inside it `this` has a precise static type, so the second call selects the right `visit` overload."
      },
      {
        title: "The expression problem",
        text: "Visitor and ordinary polymorphism are two sides of one trade-off. Methods on elements make adding a **type** easy and adding an **operation** hard. Visitor reverses this. Pick the axis that is more likely to change. Sealed interfaces with pattern-matching switch in modern Java give Visitor-style code without the boilerplate.",
        code: [
          { file: "Modern.java", body: "sealed interface Element permits Paragraph, Image, Table {}\n\nString render(Element e) {\n  return switch (e) {\n    case Paragraph p -> \"<p>\" + p.text() + \"</p>\";\n    case Image i     -> \"<img src='\" + i.url() + \"'>\";\n    case Table t     -> renderTable(t);\n  };\n}" }
        ]
      }
    ],
    usedIn: [
      "File system: compute sizes, search, or export over files and folders.",
      "Shopping cart: tax and discount rules by item type.",
      "Compilers and expression trees: type-check, evaluate, pretty-print passes.",
      "Document and report exporters."
    ],
    related: ["composite", "iterator", "interpreter"]
  },

  {
    id: "interpreter",
    name: "Interpreter",
    category: "behavioral",
    difficulty: "hard",
    understanding: "Interpreter represents sentences of a simple language as a tree of objects, one class per grammar rule, so a sentence can be evaluated by calling interpret on the root.",
    problem: {
      intro: "You are designing a rule engine for an online store. Marketing wants to write filters such as discount rules and promotional segments without a code deploy.",
      dialogue: [
        { who: "you", text: "What do the rules look like?" },
        { who: "int", text: "Things like: price is greater than 500 AND category equals shoes, or the user is premium." },
        { who: "you", text: "Do we need to support nesting with parentheses?" },
        { who: "int", text: "Yes, AND, OR and NOT, combined freely." },
        { who: "you", text: "Will new conditions be added over time?" },
        { who: "int", text: "Often. Each new kind of check should be easy to add." }
      ],
      requirements: [
        "Rules combine conditions with AND, OR and NOT.",
        "Conditions compare fields of an order to values.",
        "A rule is built once and evaluated against many orders.",
        "Adding a new kind of condition must not change existing ones."
      ]
    },
    badApproach: {
      text: "Hard-code each rule as a method, or parse the rule text over and over at every evaluation.",
      code: "class Rules {\n  boolean isEligible(Order o) {\n    return o.price() > 500 && o.category().equals(\"shoes\");\n  }\n\n  boolean isVip(Order o) {\n    return o.user().isPremium() || o.total() > 10000;\n  }\n  // every new marketing rule is a code change and a deploy\n}",
      why: [
        "Business users cannot change rules without engineers and a release.",
        "Combinations multiply into many one-off methods.",
        "Rules cannot be stored, loaded or composed at runtime."
      ]
    },
    design: [
      {
        heading: "Define the expression contract",
        text: "Every node in the rule tree, simple or compound, answers one question: does this match the given context?",
        code: [
          { file: "Expression.java", body: "public interface Expression {\n  boolean interpret(Order order);\n}" }
        ]
      },
      {
        heading: "Terminal expressions are the leaves",
        text: "Terminals are the smallest checks. They read from the context and do not contain other expressions.",
        code: [
          { file: "PriceGreaterThan.java", body: "public class PriceGreaterThan implements Expression {\n  private final double limit;\n  public PriceGreaterThan(double limit) { this.limit = limit; }\n  public boolean interpret(Order o) { return o.price() > limit; }\n}" },
          { file: "CategoryEquals.java", body: "public class CategoryEquals implements Expression {\n  private final String category;\n  public CategoryEquals(String category) { this.category = category; }\n  public boolean interpret(Order o) { return o.category().equals(category); }\n}" },
          { file: "IsPremiumUser.java", body: "public class IsPremiumUser implements Expression {\n  public boolean interpret(Order o) { return o.user().isPremium(); }\n}" }
        ]
      },
      {
        heading: "Non-terminal expressions compose others",
        text: "Operators hold child expressions and combine their results. This is what lets rules nest to any depth.",
        code: [
          { file: "And.java", body: "public class And implements Expression {\n  private final Expression left, right;\n  public And(Expression left, Expression right) { this.left = left; this.right = right; }\n  public boolean interpret(Order o) { return left.interpret(o) && right.interpret(o); }\n}" },
          { file: "Or.java", body: "public class Or implements Expression {\n  private final Expression left, right;\n  public Or(Expression left, Expression right) { this.left = left; this.right = right; }\n  public boolean interpret(Order o) { return left.interpret(o) || right.interpret(o); }\n}" },
          { file: "Not.java", body: "public class Not implements Expression {\n  private final Expression inner;\n  public Not(Expression inner) { this.inner = inner; }\n  public boolean interpret(Order o) { return !inner.interpret(o); }\n}" }
        ],
        note: "A new kind of check is one new terminal class. `And`, `Or` and `Not` work with it immediately."
      }
    ],
    usage: {
      text: "Build the tree once, by hand or from a parser, then evaluate it against any number of orders.",
      code: [
        { file: "Main.java", body: "// (price > 500 AND category = shoes) OR premium user\nExpression rule = new Or(\n  new And(new PriceGreaterThan(500), new CategoryEquals(\"shoes\")),\n  new IsPremiumUser()\n);\n\nfor (Order o : orders) {\n  if (rule.interpret(o)) applyDiscount(o);\n}" }
      ]
    },
    whenToUse: [
      "You have a small, stable grammar, such as filters, rules or search queries.",
      "Rules should be configurable at runtime rather than compiled in.",
      "A sentence is naturally a tree of smaller sentences.",
      "Examples: discount rule engines, permission rules, simple query filters."
    ],
    whenNotToUse: [
      "The grammar is large or complex; use a parser generator or an existing library instead.",
      "Performance is critical, since a tree of objects is slower than compiled code.",
      "A few if statements or a lambda predicate already do the job."
    ],
    mistakes: [
      "Hand-growing the grammar until there are dozens of expression classes. Switch to a real parser at that point.",
      "Mixing parsing and evaluation. Interpreter only evaluates a tree; building it from text is a separate parser's job.",
      "Putting mutable state in expressions, which makes a shared rule tree unsafe across threads.",
      "Building an expression language for three hard-coded rules. Design patterns are good to have, but don't force one in just to impress the interviewer."
    ],
    deepDive: [
      {
        title: "Parsing text into the tree",
        text: "The pattern describes evaluation, not parsing. A small recursive-descent parser turns a string such as `price > 500 AND category = shoes` into the expression tree. Keep the parser separate so you can change the syntax without touching the expression classes.",
        code: [
          { file: "RuleParser.java", body: "// grammar:\n//   expr   := term (OR term)*\n//   term   := factor (AND factor)*\n//   factor := NOT factor | '(' expr ')' | condition\nclass RuleParser {\n  Expression parseExpr() {\n    Expression left = parseTerm();\n    while (match(\"OR\")) left = new Or(left, parseTerm());\n    return left;\n  }\n  Expression parseTerm() {\n    Expression left = parseFactor();\n    while (match(\"AND\")) left = new And(left, parseFactor());\n    return left;\n  }\n}" }
        ]
      },
      {
        title: "Interpreter vs Composite vs Visitor",
        text: "The expression tree is a Composite: leaves and branches share one interface. Interpreter is the specific use of that structure to evaluate a language. If you later need many different operations over the same tree, such as evaluate, print and optimise, pair it with Visitor instead of adding methods to every expression."
      }
    ],
    usedIn: [
      "Discount and promotion rule engines.",
      "Permission or access-control rule evaluation.",
      "Search query filters and simple DSLs.",
      "Spreadsheet-style formula evaluation."
    ],
    related: ["composite", "visitor", "strategy"]
  }
);
