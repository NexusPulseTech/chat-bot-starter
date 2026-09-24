import type { ChannelId } from "../channels/types.js";
import type {
  Conversation,
  ConversationMode,
  ConversationSummary,
  MessageAuthor,
  Order,
  OrderStatus,
  StoredMessage,
} from "../db/store.js";
import { ORDER_STATUSES } from "../db/store.js";
import { html, type SafeHtml } from "./html.js";

export const CHANNEL_LABELS: Record<ChannelId, string> = { zalo: "Zalo", messenger: "Messenger" };
export const MODE_LABELS: Record<ConversationMode, string> = { bot: "Bot đang trả lời", human: "Nhân viên phụ trách" };
export const AUTHOR_LABELS: Record<MessageAuthor, string> = { customer: "Khách", bot: "Bot", agent: "Nhân viên" };
export const STATUS_LABELS: Record<OrderStatus, string> = {
  new: "Mới",
  confirmed: "Đã xác nhận",
  shipped: "Đang giao",
  completed: "Hoàn tất",
  cancelled: "Đã hủy",
};

export interface ViewContext {
  readonly csrf: string;
  readonly counts: { waitingForAgent: number; newOrders: number; unread: number };
  readonly formatTime: (iso: string) => string;
}

export function contactName(conversation: Conversation): string {
  return conversation.displayName ?? `Khách ${CHANNEL_LABELS[conversation.channel]} #${conversation.externalId.slice(-4)}`;
}

export function messageLabel(message: StoredMessage, formatTime: (iso: string) => string): string {
  const who = AUTHOR_LABELS[message.author];
  const failed = message.status === "failed" ? ` - Gửi thất bại: ${message.error ?? "không rõ lỗi"}` : "";
  return `${who} - ${formatTime(message.createdAt)}${failed}`;
}

function csrfField(csrf: string): SafeHtml {
  return html`<input type="hidden" name="_csrf" value="${csrf}">`;
}

function badge(count: number): SafeHtml {
  return count > 0 ? html`<span class="badge">${count > 99 ? "99+" : count}</span>` : html``;
}

type Section = "inbox" | "orders" | "settings";

export function page(title: string, body: SafeHtml): string {
  return html`<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title} - NexusPulse Inbox</title>
<link rel="stylesheet" href="/admin/assets/app.css">
<script src="/admin/assets/app.js" defer></script>
</head>
<body>${body}</body>
</html>`.value;
}

export function layout(ctx: ViewContext, section: Section, title: string, content: SafeHtml): string {
  const current = (name: Section) => (name === section ? "page" : "false");
  return page(
    title,
    html`<header class="topbar"><div class="topbar-inner">
  <a class="brand" href="/admin/inbox">Nexus<span>Pulse</span> Inbox</a>
  <nav class="nav" aria-label="Chính">
    <a href="/admin/inbox" aria-current="${current("inbox")}">Hộp thư${badge(ctx.counts.unread)}</a>
    <a href="/admin/orders" aria-current="${current("orders")}">Đơn hàng${badge(ctx.counts.newOrders)}</a>
    <a href="/admin/settings" aria-current="${current("settings")}">Cài đặt</a>
  </nav>
  <form class="inline-form" method="post" action="/admin/logout">${csrfField(ctx.csrf)}<button class="btn btn-ghost btn-small" type="submit">Đăng xuất</button></form>
</div></header>
<main>${content}</main>`,
  );
}

export function loginPage(error: string | null): string {
  return page(
    "Đăng nhập",
    html`<div class="login"><div class="panel">
  <h1>Nexus<span class="muted">Pulse</span> Inbox</h1>
  ${error ? html`<p class="notice error" role="alert">${error}</p>` : ""}
  <form method="post" action="/admin/login">
    <div class="field"><label for="password">Mật khẩu quản trị</label>
    <input id="password" type="password" name="password" autocomplete="current-password" required autofocus></div>
    <button class="btn" type="submit">Đăng nhập</button>
  </form>
</div></div>`,
  );
}

export function inboxPage(ctx: ViewContext, conversations: readonly ConversationSummary[], filter: string): string {
  const tab = (value: string, label: string, count?: number) =>
    html`<a href="/admin/inbox${value === "all" ? "" : `?filter=${value}`}" aria-current="${String(filter === value)}">${label}${count ? html` (${count})` : ""}</a>`;

  const rows = conversations.map((conversation) => {
    const name = contactName(conversation);
    const prefix = conversation.lastAuthor === "customer" ? "" : `${AUTHOR_LABELS[conversation.lastAuthor]}: `;
    return html`<li><a href="/admin/conversations/${conversation.id}">
  <span class="avatar" aria-hidden="true">${name.charAt(0).toUpperCase()}</span>
  <span class="conv-body">
    <span class="conv-title">${name}
      <span class="pill">${CHANNEL_LABELS[conversation.channel]}</span>
      ${conversation.mode === "human" ? html`<span class="pill human">Cần nhân viên</span>` : ""}
    </span>
    <span class="conv-last">${prefix}${conversation.lastText}</span>
  </span>
  <span class="conv-meta">${ctx.formatTime(conversation.lastMessageAt)}<br>${badge(conversation.unread)}</span>
</a></li>`;
  });

  return layout(
    ctx,
    "inbox",
    "Hộp thư",
    html`<div id="inbox"><h1>Hộp thư</h1>
<nav class="tabs" aria-label="Lọc">
  ${tab("all", "Tất cả")}${tab("human", "Cần nhân viên", ctx.counts.waitingForAgent)}${tab("bot", "Bot đang trả lời")}
</nav>
<div class="panel">
  ${rows.length > 0
    ? html`<ul class="conversations">${rows}</ul>`
    : html`<p class="empty">Chưa có cuộc trò chuyện nào. Tin nhắn từ Zalo và Messenger sẽ hiện ở đây.</p>`}
</div></div>`,
  );
}

export function conversationPage(
  ctx: ViewContext,
  conversation: Conversation,
  messages: readonly StoredMessage[],
  notice: string | null,
): string {
  const lastId = messages.at(-1)?.id ?? 0;
  const nextMode: ConversationMode = conversation.mode === "bot" ? "human" : "bot";
  const bubbles = messages.map(
    (message) => html`<div class="msg ${message.direction}${message.status === "failed" ? " failed" : ""}">
  <div class="bubble">${message.text}</div>
  <div class="meta">${messageLabel(message, ctx.formatTime)}</div>
</div>`,
  );

  return layout(
    ctx,
    "inbox",
    contactName(conversation),
    html`<p><a href="/admin/inbox" class="muted">Quay lại hộp thư</a></p>
${notice ? html`<p class="notice" role="status">${notice}</p>` : ""}
<div class="panel">
  <div class="thread-head">
    <div>
      <strong>${contactName(conversation)}</strong>
      <span class="pill">${CHANNEL_LABELS[conversation.channel]}</span>
      <span class="pill ${conversation.mode === "human" ? "human" : ""}">${MODE_LABELS[conversation.mode]}</span>
    </div>
    <form method="post" action="/admin/conversations/${conversation.id}/mode">
      ${csrfField(ctx.csrf)}<input type="hidden" name="mode" value="${nextMode}">
      <button class="btn btn-ghost btn-small" type="submit">${nextMode === "bot" ? "Giao lại cho bot" : "Nhân viên tiếp nhận"}</button>
    </form>
  </div>
  <div class="thread" id="thread" data-conversation="${conversation.id}" data-last-id="${lastId}" aria-live="polite">${bubbles}</div>
  <form class="reply" method="post" action="/admin/conversations/${conversation.id}/reply">
    ${csrfField(ctx.csrf)}
    <textarea name="text" rows="2" maxlength="2000" placeholder="Nhập tin trả lời. Ctrl + Enter để gửi." required aria-label="Tin trả lời"></textarea>
    <button class="btn" type="submit">Gửi</button>
  </form>
</div>
<p class="muted">Khi nhân viên trả lời, bot tự dừng ở cuộc trò chuyện này cho tới khi bạn giao lại cho bot.</p>`,
  );
}

export function ordersPage(ctx: ViewContext, orders: readonly Order[], filter: OrderStatus | "all", notice: string | null): string {
  const tab = (value: OrderStatus | "all", label: string) =>
    html`<a href="/admin/orders${value === "all" ? "" : `?status=${value}`}" aria-current="${String(filter === value)}">${label}</a>`;
  const options = (current: OrderStatus) =>
    ORDER_STATUSES.map((status) => html`<option value="${status}"${status === current ? html` selected` : ""}>${STATUS_LABELS[status]}</option>`);

  const rows = orders.map(
    (order) => html`<tr>
  <td class="nowrap"><a href="/admin/conversations/${order.conversationId}">#${order.id}</a></td>
  <td class="nowrap">${ctx.formatTime(order.createdAt)}</td>
  <td>${order.customerName}<br><span class="muted">${CHANNEL_LABELS[order.channel]}</span></td>
  <td class="nowrap">${order.phone}</td>
  <td>${order.address}</td>
  <td>${order.items}</td>
  <td>
    <form class="status-form" method="post" action="/admin/orders/${order.id}/status">
      ${csrfField(ctx.csrf)}
      <select name="status" aria-label="Trạng thái đơn #${order.id}">${options(order.status)}</select>
      <button class="btn btn-ghost btn-small" type="submit">Lưu</button>
    </form>
  </td>
</tr>`,
  );

  return layout(
    ctx,
    "orders",
    "Đơn hàng",
    html`<div class="toolbar"><h1>Đơn hàng</h1>
  <a class="btn btn-ghost" href="/admin/orders.csv${filter === "all" ? "" : `?status=${filter}`}">Xuất CSV</a>
</div>
${notice ? html`<p class="notice" role="status">${notice}</p>` : ""}
<nav class="tabs" aria-label="Lọc">${tab("all", "Tất cả")}${ORDER_STATUSES.map((status) => tab(status, STATUS_LABELS[status]))}</nav>
<div class="panel">
  ${rows.length > 0
    ? html`<div class="table-wrap"><table>
  <thead><tr><th>Đơn</th><th>Thời gian</th><th>Khách</th><th>Điện thoại</th><th>Địa chỉ</th><th>Sản phẩm</th><th>Trạng thái</th></tr></thead>
  <tbody>${rows}</tbody>
</table></div>`
    : html`<p class="empty">Chưa có đơn hàng. Khách nhắn "đặt hàng" để bot bắt đầu lên đơn.</p>`}
</div>`,
  );
}

export interface SettingsView {
  readonly aiConfigured: boolean;
  readonly aiEnabled: boolean;
  readonly model: string;
  readonly knowledge: string;
  readonly channels: readonly ChannelId[];
  readonly forwarding: boolean;
}

export const KNOWLEDGE_PLACEHOLDER = `Tên shop: Lan Boutique
Sản phẩm: áo thun cotton 150.000đ, túi tote canvas 220.000đ
Size áo: S, M, L, XL
Giao hàng: toàn quốc 2-4 ngày, miễn phí từ 500.000đ
Đổi trả: trong 7 ngày nếu còn tem mác
Giờ mở cửa: 8:00 - 21:00 mỗi ngày`;

export function settingsPage(ctx: ViewContext, view: SettingsView, notice: string | null): string {
  return layout(
    ctx,
    "settings",
    "Cài đặt",
    html`<h1>Cài đặt</h1>
${notice ? html`<p class="notice" role="status">${notice}</p>` : ""}
<form class="panel form-grid" method="post" action="/admin/settings">
  ${csrfField(ctx.csrf)}
  <div class="field">
    <label>Trả lời bằng AI</label>
    ${view.forwarding
      ? html`<p class="muted">Đang chuyển tin nhắn tới workflow ngoài qua <code>FORWARD_URL</code>, nên AI không được dùng.</p>`
      : view.aiConfigured
        ? html`<div class="check"><input id="ai" type="checkbox" name="ai_enabled" value="true"${view.aiEnabled ? html` checked` : ""}>
            <label for="ai">Bật AI trả lời khách dựa trên thông tin cửa hàng bên dưới. Khi tắt, bot trả lời theo luật từ khoá. Mô hình: <code>${view.model}</code></label></div>`
        : html`<p class="muted">Chưa cấu hình. Đặt biến môi trường <code>ANTHROPIC_API_KEY</code> rồi khởi động lại để bật.</p>`}
  </div>
  <div class="field">
    <label for="knowledge">Thông tin cửa hàng cho AI</label>
    <textarea id="knowledge" name="knowledge" rows="12" maxlength="20000" placeholder="${KNOWLEDGE_PLACEHOLDER}">${view.knowledge}</textarea>
    <p class="hint">AI chỉ trả lời dựa trên nội dung này. Ghi rõ sản phẩm, giá, phí giao hàng, chính sách đổi trả. Thông tin nào không có, AI sẽ báo khách chờ nhân viên.</p>
  </div>
  <div><button class="btn" type="submit">Lưu cài đặt</button></div>
</form>
<div class="panel form-grid">
  <div class="field">
    <label>Địa chỉ webhook</label>
    ${view.channels.map((channel) => html`<p><strong>${CHANNEL_LABELS[channel]}:</strong> <code>https://tên-miền-của-bạn/webhook/${channel}</code></p>`)}
    <p class="hint">Điền địa chỉ này trong trang cài đặt webhook của Zalo OA hoặc Messenger.</p>
  </div>
</div>`,
  );
}
