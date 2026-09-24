import type { OrderDraft } from "../db/store.js";
import { normalize } from "../handlers/rules.js";

/**
 * Collects an order over several messages: items, name, phone, address, then
 * a confirmation.
 *
 * The flow is a pure function of (state, message) so it is easy to test and
 * to persist: the state is stored on the conversation as JSON between
 * messages, which means an order in progress survives a restart.
 */
export type OrderStep = "items" | "name" | "phone" | "address" | "confirm";

export interface OrderFlowState {
  readonly step: OrderStep;
  readonly items?: string;
  readonly customerName?: string;
  readonly phone?: string;
  readonly address?: string;
}

export interface FlowResult {
  /** State to store, or null when the flow has ended. */
  readonly state: OrderFlowState | null;
  readonly reply: string;
  /** Present once the customer confirms. */
  readonly order?: OrderDraft;
}

export const PROMPTS = {
  start: "Dạ, bạn muốn đặt sản phẩm nào và số lượng bao nhiêu ạ?",
  name: "Bạn cho shop xin họ tên người nhận ạ.",
  phone: "Bạn cho shop xin số điện thoại nhận hàng ạ.",
  invalidPhone: "Số điện thoại chưa đúng. Bạn nhập giúp số di động Việt Nam 10 số, ví dụ 0912345678 ạ.",
  address: "Bạn cho shop xin địa chỉ giao hàng đầy đủ (số nhà, đường, phường, quận, tỉnh) ạ.",
  shortAddress: "Địa chỉ hơi ngắn, bạn ghi đầy đủ giúp shop để giao đúng nơi ạ.",
  askConfirm: "Bạn trả lời CÓ để xác nhận đơn, hoặc HỦY để hủy ạ.",
  cancelled: "Shop đã hủy đơn đang tạo. Khi cần, bạn nhắn \"đặt hàng\" để bắt đầu lại nhé.",
} as const;

const CANCEL_WORDS = /^(huy|huy don|thoi|khong dat|cancel|stop)$/;
const CONFIRM_WORDS = /^(co|dung|ok|oke|okay|dong y|xac nhan|chot|yes|y)$/;

/**
 * Normalises a Vietnamese mobile number to the 10-digit local form.
 * Accepts spaces, dots, dashes and the +84 / 84 prefixes.
 * Returns null when the input is not a valid mobile number.
 */
export function normalizePhone(input: string): string | null {
  const digits = input.replace(/[\s.\-()]/g, "");
  const local = digits.replace(/^\+?84/, "0");
  // Current mobile prefixes: 03, 05, 07, 08, 09.
  return /^0[35789]\d{8}$/.test(local) ? local : null;
}

export function startOrderFlow(): FlowResult {
  return { state: { step: "items" }, reply: PROMPTS.start };
}

function summary(state: OrderFlowState): string {
  return [
    "Shop xác nhận lại đơn của bạn:",
    `- Sản phẩm: ${state.items}`,
    `- Người nhận: ${state.customerName}`,
    `- Điện thoại: ${state.phone}`,
    `- Địa chỉ: ${state.address}`,
    PROMPTS.askConfirm,
  ].join("\n");
}

/** Advances the flow with the customer's next message. */
export function advanceOrderFlow(state: OrderFlowState, message: string): FlowResult {
  const text = message.trim();
  const plain = normalize(text);

  if (CANCEL_WORDS.test(plain)) return { state: null, reply: PROMPTS.cancelled };

  switch (state.step) {
    case "items":
      if (text.length < 2) return { state, reply: PROMPTS.start };
      return { state: { ...state, step: "name", items: text.slice(0, 500) }, reply: PROMPTS.name };

    case "name":
      if (text.length < 2) return { state, reply: PROMPTS.name };
      return { state: { ...state, step: "phone", customerName: text.slice(0, 100) }, reply: PROMPTS.phone };

    case "phone": {
      const phone = normalizePhone(text);
      if (!phone) return { state, reply: PROMPTS.invalidPhone };
      return { state: { ...state, step: "address", phone }, reply: PROMPTS.address };
    }

    case "address": {
      if (text.length < 10) return { state, reply: PROMPTS.shortAddress };
      const next: OrderFlowState = { ...state, step: "confirm", address: text.slice(0, 300) };
      return { state: next, reply: summary(next) };
    }

    case "confirm": {
      if (!CONFIRM_WORDS.test(plain)) return { state, reply: summary(state) };
      const { items, customerName, phone, address } = state;
      if (!items || !customerName || !phone || !address) {
        // Only reachable with a corrupted stored state: restart cleanly.
        return startOrderFlow();
      }
      return {
        state: null,
        reply: "", // The caller adds the order number once the order is stored.
        order: { items, customerName, phone, address },
      };
    }
  }
}

/** Reads a stored flow state, tolerating a missing or corrupted value. */
export function parseFlowState(stored: string | null): OrderFlowState | null {
  if (!stored) return null;
  try {
    const value: unknown = JSON.parse(stored);
    if (typeof value === "object" && value !== null && "step" in value) {
      const step = (value as { step: unknown }).step;
      if (step === "items" || step === "name" || step === "phone" || step === "address" || step === "confirm") {
        return value as OrderFlowState;
      }
    }
  } catch {
    // Fall through: a corrupted state is treated as no flow in progress.
  }
  return null;
}
