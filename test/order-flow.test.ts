import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  advanceOrderFlow,
  normalizePhone,
  parseFlowState,
  PROMPTS,
  startOrderFlow,
  type OrderFlowState,
} from "../src/bot/order-flow.js";

/** Feeds messages through the flow and returns the final result. */
function run(...messages: string[]) {
  let state: OrderFlowState | null = startOrderFlow().state;
  let last = startOrderFlow();
  for (const message of messages) {
    assert.ok(state, `flow ended before "${message}"`);
    last = advanceOrderFlow(state, message);
    state = last.state;
  }
  return last;
}

describe("normalizePhone", () => {
  it("accepts common ways of writing a Vietnamese mobile number", () => {
    assert.equal(normalizePhone("0912345678"), "0912345678");
    assert.equal(normalizePhone("0912 345 678"), "0912345678");
    assert.equal(normalizePhone("091.234.5678"), "0912345678");
    assert.equal(normalizePhone("+84912345678"), "0912345678");
    assert.equal(normalizePhone("84 912 345 678"), "0912345678");
  });

  it("rejects numbers that are not mobile numbers", () => {
    assert.equal(normalizePhone("12345"), null);
    assert.equal(normalizePhone("0212345678"), null);
    assert.equal(normalizePhone("09123456789"), null);
    assert.equal(normalizePhone("abc"), null);
  });
});

describe("order flow", () => {
  it("collects items, name, phone and address, then produces the order on confirmation", () => {
    const result = run("2 áo thun size M", "Nguyễn Lan", "0912 345 678", "12 Lê Lợi, Bến Nghé, Quận 1, TP.HCM", "Có");
    assert.equal(result.state, null);
    assert.deepEqual(result.order, {
      items: "2 áo thun size M",
      customerName: "Nguyễn Lan",
      phone: "0912345678",
      address: "12 Lê Lợi, Bến Nghé, Quận 1, TP.HCM",
    });
  });

  it("shows a summary before asking for confirmation", () => {
    const result = run("1 túi xách", "Lan", "0912345678", "12 Lê Lợi, Quận 1, TP.HCM");
    assert.equal(result.state?.step, "confirm");
    assert.match(result.reply, /1 túi xách/);
    assert.match(result.reply, /0912345678/);
  });

  it("asks again for an invalid phone number without losing earlier answers", () => {
    const result = run("1 túi xách", "Lan", "123");
    assert.equal(result.reply, PROMPTS.invalidPhone);
    assert.equal(result.state?.step, "phone");
    assert.equal(result.state?.customerName, "Lan");
  });

  it("asks again for an address that is too short", () => {
    assert.equal(run("1 túi", "Lan", "0912345678", "Q1").reply, PROMPTS.shortAddress);
  });

  it("can be cancelled at any step, with or without accents", () => {
    assert.equal(run("1 túi", "Hủy").state, null);
    assert.equal(run("1 túi", "Lan", "huy").state, null);
    assert.equal(run("1 túi", "Lan", "0912345678", "12 Lê Lợi, Quận 1", "HỦY").reply, PROMPTS.cancelled);
  });

  it("repeats the summary when the confirmation is unclear", () => {
    const result = run("1 túi", "Lan", "0912345678", "12 Lê Lợi, Quận 1, HCM", "để mình xem");
    assert.equal(result.state?.step, "confirm");
    assert.equal(result.order, undefined);
  });

  it("accepts several ways of saying yes", () => {
    for (const yes of ["có", "CO", "ok", "Đồng ý", "xác nhận", "chốt"]) {
      assert.ok(run("1 túi", "Lan", "0912345678", "12 Lê Lợi, Quận 1, HCM", yes).order, yes);
    }
  });
});

describe("parseFlowState", () => {
  it("round-trips a stored state", () => {
    const state: OrderFlowState = { step: "phone", items: "x", customerName: "Lan" };
    assert.deepEqual(parseFlowState(JSON.stringify(state)), state);
  });

  it("treats missing or corrupted state as no flow", () => {
    assert.equal(parseFlowState(null), null);
    assert.equal(parseFlowState("{oops"), null);
    assert.equal(parseFlowState('{"step":"nope"}'), null);
  });
});
