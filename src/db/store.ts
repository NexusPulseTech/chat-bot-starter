import type { DatabaseSync } from "node:sqlite";
import type { ChannelId, InboundMessage } from "../channels/types.js";

export type ConversationMode = "bot" | "human";
export type MessageAuthor = "customer" | "bot" | "agent";
export type MessageStatus = "received" | "sent" | "failed";
export type OrderStatus = "new" | "confirmed" | "shipped" | "completed" | "cancelled";

export const ORDER_STATUSES: readonly OrderStatus[] = ["new", "confirmed", "shipped", "completed", "cancelled"];

export interface Conversation {
  readonly id: number;
  readonly channel: ChannelId;
  /** The customer's id on the channel. Replies are sent to this id. */
  readonly externalId: string;
  readonly displayName: string | null;
  readonly mode: ConversationMode;
  /** Serialised order-flow state, or null when no order is in progress. */
  readonly flow: string | null;
  readonly unread: number;
  readonly lastMessageAt: string;
}

export interface ConversationSummary extends Conversation {
  readonly lastText: string;
  readonly lastAuthor: MessageAuthor;
}

export interface StoredMessage {
  readonly id: number;
  readonly conversationId: number;
  readonly direction: "in" | "out";
  readonly author: MessageAuthor;
  readonly text: string;
  readonly status: MessageStatus;
  readonly error: string | null;
  readonly createdAt: string;
}

export interface OrderDraft {
  readonly items: string;
  readonly customerName: string;
  readonly phone: string;
  readonly address: string;
}

export interface Order extends OrderDraft {
  readonly id: number;
  readonly conversationId: number;
  readonly channel: ChannelId;
  readonly status: OrderStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface Session {
  readonly csrfToken: string;
  readonly expiresAt: number;
}

type Row = Record<string, unknown>;

const CONVERSATION_COLUMNS = `
  c.id, t.channel, t.external_id, t.display_name, c.mode, c.flow, c.unread, c.last_message_at`;

function toConversation(row: Row): Conversation {
  return {
    id: Number(row["id"]),
    channel: row["channel"] as ChannelId,
    externalId: String(row["external_id"]),
    displayName: row["display_name"] === null ? null : String(row["display_name"]),
    mode: row["mode"] as ConversationMode,
    flow: row["flow"] === null ? null : String(row["flow"]),
    unread: Number(row["unread"]),
    lastMessageAt: String(row["last_message_at"]),
  };
}

function toMessage(row: Row): StoredMessage {
  return {
    id: Number(row["id"]),
    conversationId: Number(row["conversation_id"]),
    direction: row["direction"] as "in" | "out",
    author: row["author"] as MessageAuthor,
    text: String(row["text"]),
    status: row["status"] as MessageStatus,
    error: row["error"] === null ? null : String(row["error"]),
    createdAt: String(row["created_at"]),
  };
}

function toOrder(row: Row): Order {
  return {
    id: Number(row["id"]),
    conversationId: Number(row["conversation_id"]),
    channel: row["channel"] as ChannelId,
    items: String(row["items"]),
    customerName: String(row["customer_name"]),
    phone: String(row["phone"]),
    address: String(row["address"]),
    status: row["status"] as OrderStatus,
    createdAt: String(row["created_at"]),
    updatedAt: String(row["updated_at"]),
  };
}

/**
 * All reads and writes go through this class, so SQL lives in one place and
 * the rest of the code works with plain objects.
 */
export class Store {
  readonly #db: DatabaseSync;
  readonly #now: () => Date;

  constructor(db: DatabaseSync, now: () => Date = () => new Date()) {
    this.#db = db;
    this.#now = now;
  }

  #timestamp(): string {
    return this.#now().toISOString();
  }

  #transaction<T>(work: () => T): T {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      this.#db.exec("COMMIT");
      return result;
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  // Conversations and messages -------------------------------------------

  /**
   * Stores an inbound message, creating the contact and conversation on first
   * contact.
   *
   * Returns null when the provider already delivered this message id: the
   * unique index on (channel, provider_message_id) makes the insert a no-op,
   * which is how a redelivered webhook is recognised, across restarts too.
   */
  recordInbound(message: InboundMessage): Conversation | null {
    return this.#transaction(() => {
      const now = this.#timestamp();

      this.#db
        .prepare(
          `INSERT INTO contacts (channel, external_id, created_at) VALUES (?, ?, ?)
           ON CONFLICT (channel, external_id) DO NOTHING`,
        )
        .run(message.channel, message.senderId, now);
      const contact = this.#db
        .prepare("SELECT id FROM contacts WHERE channel = ? AND external_id = ?")
        .get(message.channel, message.senderId) as Row;
      const contactId = Number(contact["id"]);

      this.#db
        .prepare(
          `INSERT INTO conversations (contact_id, last_message_at) VALUES (?, ?)
           ON CONFLICT (contact_id) DO NOTHING`,
        )
        .run(contactId, now);
      const conversation = this.#db
        .prepare("SELECT id FROM conversations WHERE contact_id = ?")
        .get(contactId) as Row;
      const conversationId = Number(conversation["id"]);

      const inserted = this.#db
        .prepare(
          `INSERT INTO messages
             (conversation_id, channel, direction, author, text, provider_message_id, status, created_at)
           VALUES (?, ?, 'in', 'customer', ?, ?, 'received', ?)
           ON CONFLICT DO NOTHING`,
        )
        .run(conversationId, message.channel, message.text, message.messageId, now);

      if (inserted.changes === 0) return null;

      this.#db
        .prepare("UPDATE conversations SET unread = unread + 1, last_message_at = ? WHERE id = ?")
        .run(now, conversationId);

      return this.getConversation(conversationId) ?? null;
    });
  }

  /** Stores a message sent by the bot or by a person in the dashboard. */
  recordOutbound(
    conversationId: number,
    author: "bot" | "agent",
    text: string,
    outcome: { status: "sent" } | { status: "failed"; error: string },
  ): StoredMessage {
    const now = this.#timestamp();
    const conversation = this.getConversation(conversationId);
    if (!conversation) throw new Error(`Conversation ${conversationId} does not exist`);

    const result = this.#db
      .prepare(
        `INSERT INTO messages (conversation_id, channel, direction, author, text, status, error, created_at)
         VALUES (?, ?, 'out', ?, ?, ?, ?, ?)`,
      )
      .run(
        conversationId,
        conversation.channel,
        author,
        text,
        outcome.status,
        outcome.status === "failed" ? outcome.error : null,
        now,
      );
    this.#db.prepare("UPDATE conversations SET last_message_at = ? WHERE id = ?").run(now, conversationId);

    const row = this.#db.prepare("SELECT * FROM messages WHERE id = ?").get(Number(result.lastInsertRowid)) as Row;
    return toMessage(row);
  }

  getConversation(id: number): Conversation | undefined {
    const row = this.#db
      .prepare(`SELECT ${CONVERSATION_COLUMNS} FROM conversations c JOIN contacts t ON t.id = c.contact_id WHERE c.id = ?`)
      .get(id) as Row | undefined;
    return row ? toConversation(row) : undefined;
  }

  /** Most recent conversations first, each with its latest message. */
  listConversations(options: { mode?: ConversationMode; limit?: number } = {}): ConversationSummary[] {
    const where = options.mode ? "WHERE c.mode = ?" : "";
    const params: (string | number)[] = options.mode ? [options.mode] : [];
    const rows = this.#db
      .prepare(
        `SELECT ${CONVERSATION_COLUMNS}, m.text AS last_text, m.author AS last_author
         FROM conversations c
         JOIN contacts t ON t.id = c.contact_id
         JOIN messages m ON m.id = (SELECT MAX(id) FROM messages WHERE conversation_id = c.id)
         ${where}
         ORDER BY c.last_message_at DESC, c.id DESC
         LIMIT ?`,
      )
      .all(...params, options.limit ?? 100) as Row[];

    return rows.map((row) => ({
      ...toConversation(row),
      lastText: String(row["last_text"]),
      lastAuthor: row["last_author"] as MessageAuthor,
    }));
  }

  /** Messages in chronological order. Pass `afterId` to fetch only newer ones. */
  listMessages(conversationId: number, options: { afterId?: number; limit?: number } = {}): StoredMessage[] {
    const rows = this.#db
      .prepare(
        `SELECT * FROM (
           SELECT * FROM messages WHERE conversation_id = ? AND id > ? ORDER BY id DESC LIMIT ?
         ) ORDER BY id ASC`,
      )
      .all(conversationId, options.afterId ?? 0, options.limit ?? 200) as Row[];
    return rows.map(toMessage);
  }

  setMode(conversationId: number, mode: ConversationMode): void {
    this.#db.prepare("UPDATE conversations SET mode = ? WHERE id = ?").run(mode, conversationId);
  }

  setFlow(conversationId: number, flow: string | null): void {
    this.#db.prepare("UPDATE conversations SET flow = ? WHERE id = ?").run(flow, conversationId);
  }

  setDisplayName(conversationId: number, name: string): void {
    this.#db
      .prepare("UPDATE contacts SET display_name = ? WHERE id = (SELECT contact_id FROM conversations WHERE id = ?)")
      .run(name, conversationId);
  }

  markRead(conversationId: number): void {
    this.#db.prepare("UPDATE conversations SET unread = 0 WHERE id = ?").run(conversationId);
  }

  // Orders -----------------------------------------------------------------

  createOrder(conversationId: number, draft: OrderDraft): Order {
    const now = this.#timestamp();
    const result = this.#db
      .prepare(
        `INSERT INTO orders (conversation_id, items, customer_name, phone, address, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(conversationId, draft.items, draft.customerName, draft.phone, draft.address, now, now);
    const order = this.getOrder(Number(result.lastInsertRowid));
    if (!order) throw new Error("Order was not stored");
    return order;
  }

  getOrder(id: number): Order | undefined {
    const row = this.#db
      .prepare(
        `SELECT o.*, t.channel FROM orders o
         JOIN conversations c ON c.id = o.conversation_id
         JOIN contacts t ON t.id = c.contact_id
         WHERE o.id = ?`,
      )
      .get(id) as Row | undefined;
    return row ? toOrder(row) : undefined;
  }

  listOrders(options: { status?: OrderStatus; limit?: number } = {}): Order[] {
    const where = options.status ? "WHERE o.status = ?" : "";
    const params: (string | number)[] = options.status ? [options.status] : [];
    const rows = this.#db
      .prepare(
        `SELECT o.*, t.channel FROM orders o
         JOIN conversations c ON c.id = o.conversation_id
         JOIN contacts t ON t.id = c.contact_id
         ${where}
         ORDER BY o.id DESC
         LIMIT ?`,
      )
      .all(...params, options.limit ?? 500) as Row[];
    return rows.map(toOrder);
  }

  setOrderStatus(id: number, status: OrderStatus): boolean {
    const result = this.#db
      .prepare("UPDATE orders SET status = ?, updated_at = ? WHERE id = ?")
      .run(status, this.#timestamp(), id);
    return result.changes > 0;
  }

  // Counters for the dashboard navigation -----------------------------------

  counts(): { waitingForAgent: number; newOrders: number; unread: number } {
    const row = this.#db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM conversations WHERE mode = 'human') AS waiting,
           (SELECT COUNT(*) FROM orders WHERE status = 'new') AS new_orders,
           (SELECT COALESCE(SUM(unread), 0) FROM conversations) AS unread`,
      )
      .get() as Row;
    return {
      waitingForAgent: Number(row["waiting"]),
      newOrders: Number(row["new_orders"]),
      unread: Number(row["unread"]),
    };
  }

  // Settings ---------------------------------------------------------------

  getSetting(key: string): string | undefined {
    const row = this.#db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as Row | undefined;
    return row ? String(row["value"]) : undefined;
  }

  setSetting(key: string, value: string): void {
    this.#db
      .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value")
      .run(key, value);
  }

  // Dashboard sessions -------------------------------------------------------

  createSession(tokenHash: string, csrfToken: string, expiresAt: number): void {
    this.#db
      .prepare("INSERT INTO sessions (token_hash, csrf_token, expires_at) VALUES (?, ?, ?)")
      .run(tokenHash, csrfToken, expiresAt);
  }

  /** Returns the session if it exists and has not expired. */
  getSession(tokenHash: string, now: number = Date.now()): Session | undefined {
    const row = this.#db
      .prepare("SELECT csrf_token, expires_at FROM sessions WHERE token_hash = ? AND expires_at > ?")
      .get(tokenHash, now) as Row | undefined;
    return row ? { csrfToken: String(row["csrf_token"]), expiresAt: Number(row["expires_at"]) } : undefined;
  }

  deleteSession(tokenHash: string): void {
    this.#db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
  }

  deleteExpiredSessions(now: number = Date.now()): void {
    this.#db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now);
  }
}
