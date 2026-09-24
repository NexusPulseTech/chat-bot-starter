/**
 * Dashboard stylesheet and script, served from /admin/assets/.
 *
 * They are served as files rather than inlined so the Content-Security-Policy
 * can forbid inline scripts and styles entirely.
 */
export const STYLESHEET = `
:root {
  --bg: #f5f5f7; --surface: #fff; --text: #1d1d1f; --muted: #6e6e73; --line: #e3e3e8;
  --brand: #b20015; --brand-strong: #8b000f; --brand-soft: #fbeaec; --ok: #1e7e34; --ok-soft: #e7f5ea;
  --warn: #9a6700; --warn-soft: #fff4d6; --bubble: #fff; --mine: #1d1d1f; --mine-text: #fff;
  --radius: 14px; --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  color-scheme: light dark;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #000; --surface: #161617; --text: #f5f5f7; --muted: #a1a1a6; --line: #2c2c2e;
    --brand-soft: #3a0d12; --ok: #5bd67a; --ok-soft: #10301a; --warn: #f0c14b; --warn-soft: #33290d;
    --bubble: #232325; --mine: #f5f5f7; --mine-text: #111;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.5 var(--font); -webkit-font-smoothing: antialiased; }
a { color: inherit; }
.topbar { position: sticky; top: 0; z-index: 10; background: var(--surface); border-bottom: 1px solid var(--line); }
.topbar-inner { display: flex; align-items: center; gap: 20px; max-width: 1120px; margin: 0 auto; padding: 0 16px; height: 56px; }
.brand { font-weight: 700; text-decoration: none; letter-spacing: -0.01em; }
.brand span { color: var(--brand); }
.nav { display: flex; gap: 4px; flex: 1; overflow-x: auto; }
.nav a { padding: 8px 12px; border-radius: 10px; text-decoration: none; color: var(--muted); white-space: nowrap; font-weight: 500; }
.nav a[aria-current="page"] { color: var(--text); background: var(--bg); }
.badge { display: inline-block; min-width: 20px; padding: 0 6px; margin-left: 6px; border-radius: 10px; background: var(--brand); color: #fff; font-size: 12px; font-weight: 700; text-align: center; line-height: 20px; }
main { max-width: 1120px; margin: 0 auto; padding: 24px 16px 64px; }
h1 { margin: 0 0 16px; font-size: 26px; letter-spacing: -0.02em; }
.panel { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); }
.panel + .panel { margin-top: 16px; }
.muted { color: var(--muted); }
.tabs { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; }
.tabs a { padding: 6px 14px; border-radius: 999px; border: 1px solid var(--line); text-decoration: none; background: var(--surface); font-size: 14px; }
.tabs a[aria-current="true"] { background: var(--text); color: var(--bg); border-color: var(--text); }
.btn { display: inline-flex; align-items: center; gap: 6px; padding: 9px 16px; border-radius: 10px; border: 1px solid transparent; background: var(--brand); color: #fff; font: inherit; font-weight: 600; cursor: pointer; text-decoration: none; }
.btn:hover { background: var(--brand-strong); }
.btn-ghost { background: transparent; color: var(--text); border-color: var(--line); }
.btn-ghost:hover { background: var(--bg); }
.btn-small { padding: 5px 10px; font-size: 13px; }
.notice { padding: 10px 14px; border-radius: 10px; margin-bottom: 16px; background: var(--ok-soft); color: var(--ok); }
.notice.error { background: var(--brand-soft); color: var(--brand); }
.conversations { list-style: none; margin: 0; padding: 0; }
.conversations li + li { border-top: 1px solid var(--line); }
.conversations a { display: grid; grid-template-columns: 40px minmax(0, 1fr) auto; gap: 12px; align-items: center; padding: 14px 16px; text-decoration: none; }
.conversations a:hover { background: var(--bg); }
.avatar { width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center; background: var(--brand-soft); color: var(--brand); font-weight: 700; }
.conv-title { font-weight: 600; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.conv-body { min-width: 0; }
.conv-last { display: block; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.conv-meta { text-align: right; font-size: 13px; color: var(--muted); }
.pill { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 12px; font-weight: 600; background: var(--bg); color: var(--muted); border: 1px solid var(--line); }
.pill.human { background: var(--warn-soft); color: var(--warn); border-color: transparent; }
.pill.status-new { background: var(--brand-soft); color: var(--brand); border-color: transparent; }
.pill.status-completed { background: var(--ok-soft); color: var(--ok); border-color: transparent; }
.empty { padding: 48px 16px; text-align: center; color: var(--muted); }
.thread-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; padding: 14px 16px; border-bottom: 1px solid var(--line); }
.thread { display: flex; flex-direction: column; gap: 10px; padding: 16px; height: min(60vh, 640px); overflow-y: auto; }
.msg { max-width: min(75%, 560px); }
.msg .bubble { padding: 9px 13px; border-radius: 16px; background: var(--bubble); border: 1px solid var(--line); white-space: pre-wrap; word-wrap: break-word; }
.msg.out { align-self: flex-end; }
.msg.out .bubble { background: var(--mine); color: var(--mine-text); border-color: transparent; }
.msg.failed .bubble { background: var(--brand-soft); color: var(--brand); border: 1px dashed var(--brand); }
.msg .meta { font-size: 12px; color: var(--muted); margin: 3px 6px 0; }
.msg.out .meta { text-align: right; }
.reply { display: flex; gap: 10px; padding: 12px 16px; border-top: 1px solid var(--line); }
textarea, input[type="password"], input[type="text"], select { width: 100%; padding: 10px 12px; border-radius: 10px; border: 1px solid var(--line); background: var(--surface); color: var(--text); font: inherit; }
textarea { resize: vertical; }
.reply textarea { min-height: 44px; }
.table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 14px; }
th, td { padding: 10px 12px; text-align: left; border-bottom: 1px solid var(--line); vertical-align: top; }
th { font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); white-space: nowrap; }
td.nowrap { white-space: nowrap; }
.status-form { display: flex; gap: 6px; }
.status-form select { width: auto; padding: 5px 8px; }
.toolbar { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 16px; }
.toolbar h1 { margin: 0; }
.form-grid { display: grid; gap: 18px; padding: 20px; }
.field label { display: block; font-weight: 600; margin-bottom: 6px; }
.field .hint { font-size: 13px; color: var(--muted); margin-top: 6px; }
.check { display: flex; gap: 10px; align-items: flex-start; }
.check input { margin-top: 4px; width: 18px; height: 18px; accent-color: var(--brand); }
code { background: var(--bg); padding: 1px 6px; border-radius: 6px; font-size: 13px; }
.login { min-height: 100vh; display: grid; place-items: center; padding: 16px; }
.login .panel { width: 100%; max-width: 380px; padding: 28px; }
.login h1 { font-size: 22px; }
.login form { display: grid; gap: 14px; }
.inline-form { display: inline; }
@media (max-width: 640px) {
  .topbar-inner { flex-wrap: wrap; height: auto; padding-top: 10px; padding-bottom: 6px; gap: 6px 12px; }
  .brand { flex: 1; }
  .nav { order: 3; flex-basis: 100%; margin: 0 -12px; }
  .conversations a { padding: 12px; gap: 10px; }
  .msg { max-width: 90%; }
  .reply { flex-direction: column; }
}
`;

export const SCRIPT = `
(function () {
  "use strict";

  var thread = document.getElementById("thread");
  if (thread) {
    thread.scrollTop = thread.scrollHeight;
    var id = thread.getAttribute("data-conversation");
    var lastId = Number(thread.getAttribute("data-last-id") || 0);

    function append(message) {
      var wrap = document.createElement("div");
      wrap.className = "msg " + (message.direction === "out" ? "out" : "in") + (message.status === "failed" ? " failed" : "");
      var bubble = document.createElement("div");
      bubble.className = "bubble";
      bubble.textContent = message.text;
      var meta = document.createElement("div");
      meta.className = "meta";
      meta.textContent = message.label;
      wrap.appendChild(bubble);
      wrap.appendChild(meta);
      thread.appendChild(wrap);
    }

    function poll() {
      if (document.hidden) return;
      fetch("/admin/conversations/" + id + "/messages?after=" + lastId, { credentials: "same-origin" })
        .then(function (response) { return response.ok ? response.json() : []; })
        .then(function (messages) {
          if (!messages.length) return;
          var atBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 80;
          messages.forEach(function (message) { append(message); lastId = message.id; });
          if (atBottom) thread.scrollTop = thread.scrollHeight;
        })
        .catch(function () {});
    }
    setInterval(poll, 4000);
  }

  var reply = document.querySelector(".reply textarea");
  if (reply) {
    reply.addEventListener("keydown", function (event) {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        reply.form.requestSubmit();
      }
    });
  }

  if (document.getElementById("inbox")) {
    setInterval(function () { if (!document.hidden) location.reload(); }, 15000);
  }
})();
`;
