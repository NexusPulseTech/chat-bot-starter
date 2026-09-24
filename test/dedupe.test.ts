import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DedupeStore } from "../src/dedupe.js";

describe("DedupeStore", () => {
  it("admits a key once and rejects repeats", () => {
    const store = new DedupeStore();
    assert.equal(store.admit("messenger:m1", 0), true);
    assert.equal(store.admit("messenger:m1", 1), false);
    assert.equal(store.admit("messenger:m1", 2), false);
  });

  it("treats the same id on different channels as different messages", () => {
    const store = new DedupeStore();
    assert.equal(store.admit("messenger:42", 0), true);
    assert.equal(store.admit("zalo:42", 0), true);
  });

  it("admits a key again once its entry has expired", () => {
    const store = new DedupeStore({ ttlMs: 1_000 });
    assert.equal(store.admit("k", 0), true);
    assert.equal(store.admit("k", 999), false);
    assert.equal(store.admit("k", 1_000), true);
  });

  it("never holds more than maxEntries", () => {
    const store = new DedupeStore({ ttlMs: 60_000, maxEntries: 100 });
    for (let i = 0; i < 1_000; i++) store.admit(`k${i}`, i);
    assert.ok(store.size <= 100, `size was ${store.size}`);
  });

  it("drops the oldest entries first when it is full", () => {
    const store = new DedupeStore({ ttlMs: 60_000, maxEntries: 3 });
    for (const key of ["a", "b", "c", "d"]) store.admit(key, 0);
    assert.equal(store.admit("a", 1), true, "oldest key should have been dropped");
    assert.equal(store.admit("d", 1), false, "newest key should still be held");
  });
});
