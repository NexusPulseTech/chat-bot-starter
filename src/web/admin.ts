import type { IncomingMessage, ServerResponse } from "node:http";
import type { Inbox } from "../bot/inbox.js";
import type { ChannelId } from "../channels/types.js";
import { ORDER_STATUSES, type ConversationMode, type OrderStatus, type Store } from "../db/store.js";
import { PayloadTooLargeError, readBody, redirect, send } from "../http.js";
import { log } from "../logger.js";
import { SCRIPT, STYLESHEET } from "./assets.js";
import type { Auth } from "./auth.js";
import { toCsv } from "./csv.js";
import {
  CHANNEL_LABELS,
  conversationPage,
  inboxPage,
  loginPage,
  messageLabel,
  ordersPage,
  settingsPage,
  STATUS_LABELS,
  type ViewContext,
} from "./views.js";

export const SETTING_AI_ENABLED = "ai_enabled";
export const SETTING_KNOWLEDGE = "knowledge";

/** Form posts are small; this keeps a stray large upload from being buffered. */
const FORM_LIMIT_BYTES = 64 * 1024;

/**
 * Security headers for every dashboard response.
 * The CSP allows only same-origin scripts and styles, with nothing inline,
 * so even an escaping mistake could not run injected script.
 */
const SECURITY_HEADERS: Record<string, string> = {
  "content-security-policy":
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "cache-control": "no-store",
};

export interface AdminOptions {
  readonly store: Store;
  readonly inbox: Inbox;
  readonly auth: Auth;
  readonly channels: readonly ChannelId[];
  readonly aiConfigured: boolean;
  readonly aiModel: string;
  readonly forwarding: boolean;
  readonly timeZone: string;
}

/** Reads whether AI replies are on. Defaults to on once a key is configured. */
export function aiEnabledSetting(store: Store): boolean {
  return store.getSetting(SETTING_AI_ENABLED) !== "false";
}

function isOrderStatus(value: string | null): value is OrderStatus {
  return value !== null && (ORDER_STATUSES as readonly string[]).includes(value);
}

/**
 * Builds the dashboard request handler. It returns false for paths outside
 * /admin so the caller can route them elsewhere.
 */
export function createAdmin(options: AdminOptions) {
  const { store, inbox, auth } = options;
  const formatter = new Intl.DateTimeFormat("vi-VN", {
    timeZone: options.timeZone,
    dateStyle: "short",
    timeStyle: "short",
  });
  const formatTime = (iso: string) => formatter.format(new Date(iso));

  function html(res: ServerResponse, status: number, body: string, headers: Record<string, string> = {}): void {
    send(res, status, body, "text/html", { ...SECURITY_HEADERS, ...headers });
  }

  async function readForm(req: IncomingMessage): Promise<URLSearchParams> {
    return new URLSearchParams(await readBody(req, FORM_LIMIT_BYTES));
  }

  function context(csrf: string): ViewContext {
    return { csrf, counts: store.counts(), formatTime };
  }

  async function handleLogin(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method === "GET") {
      if (auth.session(req)) return redirect(res, "/admin/inbox");
      return html(res, 200, loginPage(null));
    }

    const address = auth.clientAddress(req);
    if (auth.isLockedOut(address)) {
      return html(res, 429, loginPage("Sai mật khẩu quá nhiều lần. Thử lại sau 15 phút."));
    }

    const form = await readForm(req);
    const cookie = auth.login(address, form.get("password") ?? "");
    if (!cookie) {
      log.warn("dashboard login failed", { address });
      return html(res, 401, loginPage("Mật khẩu không đúng."));
    }
    log.info("dashboard login", { address });
    return redirect(res, "/admin/inbox", { "set-cookie": cookie });
  }

  async function route(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const path = url.pathname.replace(/\/+$/, "") || "/admin";

    if (path === "/admin/assets/app.css") {
      return send(res, 200, STYLESHEET, "text/css", { "cache-control": "public, max-age=3600", "x-content-type-options": "nosniff" });
    }
    if (path === "/admin/assets/app.js") {
      return send(res, 200, SCRIPT, "text/javascript", { "cache-control": "public, max-age=3600", "x-content-type-options": "nosniff" });
    }
    if (path === "/admin/login") {
      if (req.method !== "GET" && req.method !== "POST") return send(res, 405, "Method not allowed");
      return handleLogin(req, res);
    }

    const session = auth.session(req);
    if (!session) {
      if (req.method === "GET" && !path.endsWith("/messages")) return redirect(res, "/admin/login");
      return send(res, 401, "Unauthorized", "text/plain", SECURITY_HEADERS);
    }

    // Every state-changing request must carry the session's CSRF token.
    let form = new URLSearchParams();
    if (req.method === "POST") {
      form = await readForm(req);
      if (!auth.checkCsrf(session, form.get("_csrf"))) {
        log.warn("csrf check failed", { path });
        return send(res, 403, "Invalid form token. Reload the page and try again.", "text/plain", SECURITY_HEADERS);
      }
    } else if (req.method !== "GET") {
      return send(res, 405, "Method not allowed");
    }

    const ctx = context(session.csrfToken);
    const notice = url.searchParams.get("notice");

    if (path === "/admin" || path === "/admin/inbox") {
      const filter = url.searchParams.get("filter");
      const mode: ConversationMode | undefined = filter === "human" || filter === "bot" ? filter : undefined;
      return html(res, 200, inboxPage(ctx, store.listConversations(mode ? { mode } : {}), mode ?? "all"));
    }

    if (path === "/admin/logout" && req.method === "POST") {
      return redirect(res, "/admin/login", { "set-cookie": auth.logout(req) });
    }

    const conversationMatch = /^\/admin\/conversations\/(\d+)(\/[a-z]+)?$/.exec(path);
    if (conversationMatch) {
      const id = Number(conversationMatch[1]);
      const action = conversationMatch[2];
      const conversation = store.getConversation(id);
      if (!conversation) return html(res, 404, "Not found");

      if (!action && req.method === "GET") {
        store.markRead(id);
        const updated = store.getConversation(id) ?? conversation;
        return html(res, 200, conversationPage(context(session.csrfToken), updated, store.listMessages(id), notice));
      }

      if (action === "/messages" && req.method === "GET") {
        const after = Number(url.searchParams.get("after") ?? 0);
        const messages = store.listMessages(id, { afterId: Number.isFinite(after) ? after : 0 });
        if (messages.some((message) => message.direction === "in")) store.markRead(id);
        const body = messages.map((message) => ({
          id: message.id,
          direction: message.direction,
          status: message.status,
          text: message.text,
          label: messageLabel(message, formatTime),
        }));
        return send(res, 200, JSON.stringify(body), "application/json", SECURITY_HEADERS);
      }

      if (action === "/reply" && req.method === "POST") {
        const text = (form.get("text") ?? "").trim();
        if (text === "") return redirect(res, `/admin/conversations/${id}`);
        const sent = await inbox.sendAgentReply(id, text.slice(0, 2000));
        const message = sent.status === "sent" ? "Đã gửi." : `Gửi thất bại: ${sent.error ?? "không rõ lỗi"}`;
        return redirect(res, `/admin/conversations/${id}?notice=${encodeURIComponent(message)}`);
      }

      if (action === "/mode" && req.method === "POST") {
        const mode = form.get("mode");
        if (mode === "bot" || mode === "human") {
          store.setMode(id, mode);
          if (mode === "bot") store.setFlow(id, null);
        }
        return redirect(res, `/admin/conversations/${id}`);
      }
    }

    if (path === "/admin/orders" && req.method === "GET") {
      const status = url.searchParams.get("status");
      const filter = isOrderStatus(status) ? status : "all";
      const orders = store.listOrders(filter === "all" ? {} : { status: filter });
      return html(res, 200, ordersPage(ctx, orders, filter, notice));
    }

    if (path === "/admin/orders.csv" && req.method === "GET") {
      const status = url.searchParams.get("status");
      const orders = store.listOrders(isOrderStatus(status) ? { status, limit: 100_000 } : { limit: 100_000 });
      const csv = toCsv(
        ["Mã đơn", "Thời gian", "Trạng thái", "Kênh", "Khách hàng", "Điện thoại", "Địa chỉ", "Sản phẩm"],
        orders.map((order) => [
          order.id,
          formatTime(order.createdAt),
          STATUS_LABELS[order.status],
          CHANNEL_LABELS[order.channel],
          order.customerName,
          order.phone,
          order.address,
          order.items,
        ]),
      );
      const date = new Date().toISOString().slice(0, 10);
      return send(res, 200, csv, "text/csv", {
        ...SECURITY_HEADERS,
        "content-disposition": `attachment; filename="don-hang-${date}.csv"`,
      });
    }

    const orderMatch = /^\/admin\/orders\/(\d+)\/status$/.exec(path);
    if (orderMatch && req.method === "POST") {
      const status = form.get("status");
      const id = Number(orderMatch[1]);
      if (isOrderStatus(status) && store.setOrderStatus(id, status)) {
        return redirect(res, `/admin/orders?notice=${encodeURIComponent(`Đã cập nhật đơn #${id}.`)}`);
      }
      return redirect(res, "/admin/orders");
    }

    if (path === "/admin/settings") {
      if (req.method === "POST") {
        store.setSetting(SETTING_AI_ENABLED, form.get("ai_enabled") === "true" ? "true" : "false");
        store.setSetting(SETTING_KNOWLEDGE, (form.get("knowledge") ?? "").slice(0, 20_000));
        return redirect(res, `/admin/settings?notice=${encodeURIComponent("Đã lưu cài đặt.")}`);
      }
      return html(
        res,
        200,
        settingsPage(
          ctx,
          {
            aiConfigured: options.aiConfigured,
            aiEnabled: aiEnabledSetting(store),
            model: options.aiModel,
            knowledge: store.getSetting(SETTING_KNOWLEDGE) ?? "",
            channels: options.channels,
            forwarding: options.forwarding,
          },
          notice,
        ),
      );
    }

    return html(res, 404, "Not found");
  }

  return async function handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    if (url.pathname !== "/admin" && !url.pathname.startsWith("/admin/")) return false;
    try {
      await route(req, res, url);
    } catch (error) {
      if (error instanceof PayloadTooLargeError) {
        res.setHeader("connection", "close");
        send(res, 413, "Payload too large");
      } else {
        throw error;
      }
    }
    return true;
  };
}
