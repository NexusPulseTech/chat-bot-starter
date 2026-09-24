import type { InboundMessage, MessageHandler, OutboundMessage } from "../channels/types.js";

/** One keyword rule. The first rule whose pattern matches wins. */
export interface Rule {
  readonly pattern: RegExp;
  readonly reply: string;
}

/**
 * Lowercases and strips Vietnamese diacritics, so "Giá", "gia" and "GIÁ" all
 * match the same rule. Customers type without accents on a phone keyboard far
 * more often than with them.
 */
export function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .trim();
}

/**
 * Example rules for a shop. Replace them with your own.
 * They answer when AI replies are off. Ordering and asking for a person are
 * handled before rules, in src/bot/engine.ts.
 */
export const DEFAULT_RULES: readonly Rule[] = [
  { pattern: /\b(xin chao|chao|hello|hi)\b/, reply: "Xin chào! Bạn cần tư vấn sản phẩm, xem giá hay đặt hàng ạ? Nhắn \"đặt hàng\" để lên đơn nhé." },
  { pattern: /\b(gia|bao nhieu|price)\b/, reply: "Bạn gửi giúp tên sản phẩm, shop báo giá ngay ạ." },
  { pattern: /\b(gio mo cua|mo cua|open)\b/, reply: "Shop mở cửa từ 8:00 đến 21:00 mỗi ngày." },
];

export const FALLBACK_REPLY = "Cảm ơn bạn đã nhắn tin. Nhân viên sẽ phản hồi trong ít phút.";

/** Builds a handler that answers from a keyword table. */
export function createRulesHandler(
  rules: readonly Rule[] = DEFAULT_RULES,
  fallback: string = FALLBACK_REPLY,
): MessageHandler {
  return (message: InboundMessage): OutboundMessage => {
    const text = normalize(message.text);
    const match = rules.find((rule) => rule.pattern.test(text));
    return { text: match?.reply ?? fallback };
  };
}
