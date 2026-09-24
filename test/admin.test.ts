import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import type { AiResponder } from "../src/ai/claude.js";
import { buildRuntime, type Runtime } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { openDatabase } from "../src/db/database.js";
import { RecordingZalo, zaloMessage } from "./helpers.js";

const PASSWORD = "correct-horse-battery";

async function start(ai?: AiResponder) {
  const zalo = new RecordingZalo();
  const config = {
    ...loadConfig({ ZALO_APP_ID: "a", ZALO_OA_SECRET_KEY: "k", ZALO_OA_ACCESS_TOKEN: "t", ADMIN_PASSWORD: PASSWORD }),
    channels: [zalo],
  };
  const runtime = buildRuntime(config, { db: openDatabase(":memory:"), ...(ai ? { ai } : {}) });
  await new Promise<void>((resolve) => runtime.app.server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(runtime.app.server.address() as AddressInfo).port}`;
  return { runtime, zalo, base };
}

function stop(runtime: Runtime): Promise<void> {
  return new Promise((resolve) => runtime.app.server.close(() => resolve()));
}

function login(base: string, password = PASSWORD): Promise<Response> {
  return fetch(`${base}/admin/login`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ password }),
  });
}

describe("dashboard", () => {
  let runtime: Runtime;
  let zalo: RecordingZalo;
  let base: string;
  let cookie = "";
  let csrf = "";
  let conversationId = 0;

  before(async () => {
    ({ runtime, zalo, base } = await start());
    await runtime.inbox.receive(zaloMessage(`<script>alert("xss")</script> giá?`, "khach-1"));
    conversationId = runtime.store.listConversations()[0]?.id ?? 0;
  });

  after(() => stop(runtime));

  function get(path: string): Promise<Response> {
    return fetch(`${base}${path}`, { redirect: "manual", headers: { cookie } });
  }

  function post(path: string, fields: Record<string, string>, token: string | null = csrf): Promise<Response> {
    const body = new URLSearchParams(fields);
    if (token !== null) body.set("_csrf", token);
    return fetch(`${base}${path}`, {
      method: "POST",
      redirect: "manual",
      headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
      body,
    });
  }

  it("sends visitors who are not logged in to the login page", async () => {
    const res = await fetch(`${base}/admin/inbox`, { redirect: "manual" });
    assert.equal(res.status, 303);
    assert.equal(res.headers.get("location"), "/admin/login");
  });

  it("serves the stylesheet and script without a session", async () => {
    const css = await fetch(`${base}/admin/assets/app.css`);
    assert.equal(css.status, 200);
    assert.match(css.headers.get("content-type") ?? "", /text\/css/);
    assert.equal((await fetch(`${base}/admin/assets/app.js`)).status, 200);
  });

  it("rejects a wrong password without setting a cookie", async () => {
    const res = await login(base, "wrong-password-123");
    assert.equal(res.status, 401);
    assert.equal(res.headers.get("set-cookie"), null);
  });

  it("logs in with the right password and sets a locked-down session cookie", async () => {
    const res = await login(base);
    assert.equal(res.status, 303);
    const setCookie = res.headers.get("set-cookie") ?? "";
    assert.match(setCookie, /^np_session=[\w-]{20,};/);
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Lax/);
    assert.match(setCookie, /Path=\/admin/);
    cookie = setCookie.split(";")[0] ?? "";
  });

  it("sends security headers on every page", async () => {
    const res = await get("/admin/inbox");
    assert.equal(res.status, 200);
    const csp = res.headers.get("content-security-policy") ?? "";
    assert.match(csp, /script-src 'self'/);
    assert.doesNotMatch(csp, /unsafe-inline/);
    assert.equal(res.headers.get("x-frame-options"), "DENY");
    assert.equal(res.headers.get("cache-control"), "no-store");
    csrf = /name="_csrf" value="([^"]+)"/.exec(await res.text())?.[1] ?? "";
    assert.ok(csrf.length > 20);
  });

  it("shows customer messages as text, never as markup", async () => {
    const body = await (await get(`/admin/conversations/${conversationId}`)).text();
    assert.match(body, /&lt;script&gt;alert\(&quot;xss&quot;\)&lt;\/script&gt; giá\?/);
    assert.doesNotMatch(body, /<script>alert/);
  });

  it("rejects a form without the CSRF token", async () => {
    const res = await post(`/admin/conversations/${conversationId}/reply`, { text: "hi" }, null);
    assert.equal(res.status, 403);
    const forged = await post(`/admin/conversations/${conversationId}/reply`, { text: "hi" }, "forged-token");
    assert.equal(forged.status, 403);
  });

  it("sends a staff reply through the channel and hands the conversation to staff", async () => {
    const res = await post(`/admin/conversations/${conversationId}/reply`, { text: "Dạ áo 150.000đ ạ" });
    assert.equal(res.status, 303);
    assert.equal(zalo.sent.at(-1)?.text, "Dạ áo 150.000đ ạ");
    assert.equal(zalo.sent.at(-1)?.to, "khach-1");
    assert.equal(runtime.store.getConversation(conversationId)?.mode, "human");
  });

  it("hands the conversation back to the bot", async () => {
    await post(`/admin/conversations/${conversationId}/mode`, { mode: "bot" });
    assert.equal(runtime.store.getConversation(conversationId)?.mode, "bot");
  });

  it("returns new messages as JSON for live updates", async () => {
    const res = await get(`/admin/conversations/${conversationId}/messages?after=0`);
    assert.equal(res.status, 200);
    const messages = (await res.json()) as { text: string; direction: string }[];
    assert.equal(messages.at(-1)?.text, "Dạ áo 150.000đ ạ");
    assert.equal(messages.at(-1)?.direction, "out");
  });

  it("answers the live-update endpoint with 401, not a redirect, when logged out", async () => {
    const res = await fetch(`${base}/admin/conversations/${conversationId}/messages`, { redirect: "manual" });
    assert.equal(res.status, 401);
  });

  it("lists orders, updates their status and exports them as CSV", async () => {
    const order = runtime.store.createOrder(conversationId, {
      items: "2 áo thun",
      customerName: "=HYPERLINK(\"http://evil\")",
      phone: "0912345678",
      address: "12 Lê Lợi, Quận 1",
    });

    const page = await (await get("/admin/orders")).text();
    assert.match(page, /0912345678/);

    assert.equal((await post(`/admin/orders/${order.id}/status`, { status: "shipped" })).status, 303);
    assert.equal(runtime.store.getOrder(order.id)?.status, "shipped");

    const csv = await get("/admin/orders.csv");
    assert.match(csv.headers.get("content-type") ?? "", /text\/csv/);
    assert.match(csv.headers.get("content-disposition") ?? "", /attachment; filename="don-hang-/);
    const text = await csv.text();
    assert.ok(text.includes("Đang giao"), "status is exported with its Vietnamese label");
    assert.ok(text.includes(`"'=HYPERLINK(""http://evil"")"`), "formula is neutralised");
  });

  it("saves settings", async () => {
    const res = await post("/admin/settings", { knowledge: "Áo thun 150.000đ <b>" });
    assert.equal(res.status, 303);
    assert.equal(runtime.store.getSetting("knowledge"), "Áo thun 150.000đ <b>");
    assert.equal(runtime.store.getSetting("ai_enabled"), "false");
    const page = await (await get("/admin/settings")).text();
    assert.match(page, /Áo thun 150.000đ &lt;b&gt;/);
  });

  it("logs out and invalidates the session on the server", async () => {
    const res = await post("/admin/logout", {});
    assert.equal(res.status, 303);
    assert.match(res.headers.get("set-cookie") ?? "", /Max-Age=0/);
    const after = await get("/admin/inbox");
    assert.equal(after.status, 303, "the old cookie no longer works");
  });
});

describe("dashboard login rate limit", () => {
  it("locks out an address after five wrong passwords, even for the right one", async () => {
    const { runtime, base } = await start();
    try {
      for (let attempt = 0; attempt < 5; attempt++) {
        assert.equal((await login(base, `wrong-password-${attempt}`)).status, 401);
      }
      assert.equal((await login(base)).status, 429);
    } finally {
      await stop(runtime);
    }
  });
});

describe("dashboard with AI", () => {
  it("lets the AI answer and shows the setting as available", async () => {
    const ai: AiResponder = { reply: async () => "Dạ áo 150.000đ ạ" };
    const { runtime, zalo, base } = await start(ai);
    try {
      await runtime.inbox.receive(zaloMessage("áo bao nhiêu tiền?", "khach-ai"));
      assert.equal(zalo.sent.at(-1)?.text, "Dạ áo 150.000đ ạ");

      const cookie = (await login(base)).headers.get("set-cookie")?.split(";")[0] ?? "";
      const page = await (await fetch(`${base}/admin/settings`, { headers: { cookie } })).text();
      assert.match(page, /name="ai_enabled" value="true" checked/);
    } finally {
      await stop(runtime);
    }
  });
});
