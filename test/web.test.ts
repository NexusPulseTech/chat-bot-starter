import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { csvField, toCsv } from "../src/web/csv.js";
import { escapeHtml, html, raw } from "../src/web/html.js";

describe("html", () => {
  it("escapes interpolated values", () => {
    const message = `<script>alert("x")</script> & 'quotes'`;
    assert.equal(
      html`<p>${message}</p>`.value,
      "<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;quotes&#39;</p>",
    );
  });

  it("does not escape nested templates or raw markup", () => {
    assert.equal(html`<div>${html`<b>${"<i>"}</b>`}${raw("<hr>")}</div>`.value, "<div><b>&lt;i&gt;</b><hr></div>");
  });

  it("renders arrays and skips null, undefined and false", () => {
    assert.equal(html`${["a", "<b>"]}${null}${undefined}${false}${0}`.value, "a&lt;b&gt;0");
  });

  it("escapes attribute-breaking characters", () => {
    assert.equal(escapeHtml(`" onmouseover="x`), "&quot; onmouseover=&quot;x");
  });
});

describe("csv", () => {
  it("quotes fields with commas, quotes and line breaks", () => {
    assert.equal(csvField("a,b"), '"a,b"');
    assert.equal(csvField('say "hi"'), '"say ""hi"""');
    assert.equal(csvField("line1\nline2"), '"line1\nline2"');
    assert.equal(csvField("plain"), "plain");
  });

  it("neutralises values a spreadsheet would run as formulas", () => {
    assert.equal(csvField('=HYPERLINK("http://evil","x")'), `"'=HYPERLINK(""http://evil"",""x"")"`);
    assert.equal(csvField("+84912345678"), "'+84912345678");
    assert.equal(csvField("@SUM(A1)"), "'@SUM(A1)");
    assert.equal(csvField("-1"), "'-1");
  });

  it("starts with a byte order mark so Excel reads Vietnamese correctly", () => {
    const csv = toCsv(["Tên"], [["Nguyễn Lan"]]);
    assert.ok(csv.startsWith("﻿"));
    assert.equal(csv, "﻿Tên\r\nNguyễn Lan\r\n");
  });
});
