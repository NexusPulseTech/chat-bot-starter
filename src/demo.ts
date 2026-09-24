/**
 * Runs the dashboard with sample data, without any Zalo, Messenger or
 * Anthropic account. Replies are printed instead of sent, and the AI is a
 * stand-in that answers from a few keywords.
 *
 *   npm run demo
 *
 * Then open http://localhost:3000/admin and log in with the password printed
 * on startup. Nothing is written to disk: the database lives in memory.
 */
import type { AiResponder } from "./ai/claude.js";
import { buildRuntime } from "./app.js";
import { MessengerChannel } from "./channels/messenger.js";
import type { InboundMessage, OutboundMessage } from "./channels/types.js";
import { ZaloChannel } from "./channels/zalo.js";
import type { Config } from "./config.js";
import { openDatabase } from "./db/database.js";
import { SETTING_KNOWLEDGE } from "./web/admin.js";

const PORT = Number(process.env["PORT"] ?? 3000);
const PASSWORD = process.env["ADMIN_PASSWORD"] ?? "demo-password-2026";

class PrintingZalo extends ZaloChannel {
  override async send(to: string, message: OutboundMessage): Promise<void> {
    process.stdout.write(`[zalo -> ${to}] ${message.text}\n`);
  }
}

class PrintingMessenger extends MessengerChannel {
  override async send(to: string, message: OutboundMessage): Promise<void> {
    process.stdout.write(`[messenger -> ${to}] ${message.text}\n`);
  }
}

/** Stand-in for Claude so the demo runs offline. */
const demoAi: AiResponder = {
  async reply({ history }) {
    const text = (history.at(-1)?.text ?? "").toLowerCase();
    if (text.includes("size")) return "Dạ áo có size S, M, L, XL ạ. Bạn cao và nặng bao nhiêu để shop tư vấn size cho vừa nhé?";
    if (text.includes("ship") || text.includes("giao")) return "Dạ shop giao toàn quốc trong 2-4 ngày, miễn phí giao hàng cho đơn từ 500.000đ ạ.";
    if (text.includes("đổi")) return "Dạ bạn được đổi trong 7 ngày nếu sản phẩm còn tem mác và chưa qua sử dụng ạ.";
    return "Dạ áo thun cotton giá 150.000đ, túi tote canvas 220.000đ ạ. Bạn nhắn \"đặt hàng\" để shop lên đơn nhé.";
  },
};

const KNOWLEDGE = `Tên shop: Lan Boutique
Sản phẩm: áo thun cotton 150.000đ, túi tote canvas 220.000đ
Size áo: S, M, L, XL
Giao hàng: toàn quốc 2-4 ngày, miễn phí từ 500.000đ
Đổi trả: trong 7 ngày nếu còn tem mác
Giờ mở cửa: 8:00 - 21:00 mỗi ngày`;

let sequence = 0;
function message(channel: "zalo" | "messenger", senderId: string, text: string): InboundMessage {
  sequence += 1;
  return { channel, messageId: `demo-${sequence}`, senderId, text, receivedAt: new Date() };
}

const config: Config = {
  port: PORT,
  databasePath: ":memory:",
  timeZone: "Asia/Ho_Chi_Minh",
  channels: [
    new PrintingZalo({ appId: "demo", oaSecretKey: "demo", accessToken: "demo" }),
    new PrintingMessenger({ appSecret: "demo", pageAccessToken: "demo", verifyToken: "demo" }),
  ],
  admin: { password: PASSWORD, secureCookies: false, trustProxy: false },
  ai: { apiKey: "demo", model: "claude-opus-5", effort: "low" },
};

const { app, store, inbox } = buildRuntime(config, { db: openDatabase(":memory:"), ai: demoAi });
store.setSetting(SETTING_KNOWLEDGE, KNOWLEDGE);

/** Plays scripted conversations through the real bot, so the data is what the bot really produces. */
async function seed(): Promise<void> {
  const conversations: [channel: "zalo" | "messenger", id: string, name: string, messages: string[]][] = [
    ["messenger", "psid-2201", "Trần Minh", ["Áo thun giá bao nhiêu shop?", "Có ship ra Đà Nẵng không?"]],
    ["zalo", "zalo-7788", "Phạm Quốc Huy", ["Cho mình gặp nhân viên", "Mình muốn đặt 20 áo in logo công ty"]],
    ["zalo", "zalo-5012", "Lê Thu Hà", ["Chị ơi áo có size L không", "đặt hàng", "1 áo thun size L màu trắng", "Lê Thu Hà", "0987 654 321", "45 Nguyễn Huệ, Bến Nghé, Quận 1, TP.HCM", "Có"]],
    ["zalo", "zalo-3344", "Nguyễn Lan", ["đặt hàng", "2 túi tote canvas", "Nguyễn Lan", "0912345678", "12 Lê Lợi, Phường 4, Gò Vấp, TP.HCM", "ok"]],
    ["messenger", "psid-9087", "Đỗ Khánh", ["đặt hàng", "3 áo thun size M", "Đỗ Khánh", "0356 111 222", "88 Trần Phú, Hải Châu, Đà Nẵng", "xác nhận"]],
  ];

  for (const [channel, id, name, texts] of conversations) {
    for (const text of texts) await inbox.receive(message(channel, id, text));
    const conversation = store.listConversations().find((c) => c.externalId === id);
    if (conversation) store.setDisplayName(conversation.id, name);
  }

  const [latest, older] = store.listOrders();
  if (older) store.setOrderStatus(older.id, "shipped");
  if (latest) store.setOrderStatus(latest.id, "confirmed");
}

void seed().then(() => {
  app.server.listen(PORT, "127.0.0.1", () => {
    process.stdout.write(
      `\nDemo dashboard: http://localhost:${PORT}/admin\nPassword: ${PASSWORD}\n` +
        "Replies are printed here instead of being sent. Press Ctrl+C to stop.\n\n",
    );
  });
});
