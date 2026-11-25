import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import "../src/parser.js";
import "../src/content.js";

const { createController } = globalThis.TCContent;

const NOW = new Date("2026-11-25T18:00:00.000Z");
const SUBTITLE = [
  "A new stock-limited ship is featured every day for 24 hours only. ",
  "Limited quantities release in six waves across global time zones, so there\u2019s a chance to grab one wherever you are. ",
  "<br><br>The same six waves repeat daily, starting at Wave 1.<br> <br>",
  "Wave 1: 16:00 UTC  <br>",
  "Wave 2: 20:00 UTC  <br>",
  "Wave 3: 00:00 UTC (next day)  <br>",
  "Wave 4: 04:00 UTC (next day)  <br>",
  "Wave 5: 08:00 UTC (next day)  <br>",
  "Wave 6: 12:00 UTC (next day)",
].join("");

function mount(html, options = {}) {
  const dom = new JSDOM(`<!doctype html><html><head><title>Sale at 16:00 UTC</title></head><body>${html}</body></html>`);
  const document = dom.window.document;
  const controller = createController(document, {
    now: () => NOW,
    timeZone: "America/New_York",
    hour12: true,
    locale: "en-US",
    ...options,
  });
  return {
    dom,
    document,
    controller,
    close() {
      controller.destroy();
      dom.window.close();
    },
  };
}

test("Stock Limited Ships subtitle converts each UTC wave once", () => {
  const { document, controller, close } = mount(`<section><h2>STOCK LIMITED SHIPS</h2><div class="subtitle">${SUBTITLE}</div><code>16:00 UTC</code></section>`);
  try {
    const text = document.querySelector(".subtitle").textContent;
    assert.match(text, /six waves across global time zones/);
    assert.match(text, /starting at Wave 1/);
    assert.match(text, /Wave 1:\s+11:00 AM EST/);
    assert.match(text, /Wave 2:\s+3:00 PM EST/);
    assert.match(text, /Wave 3:\s+7:00 PM EST/);
    assert.match(text, /Wave 4:\s+11:00 PM EST/);
    assert.match(text, /Wave 5:\s+3:00 AM EST \(Thu, Nov 26\)/);
    assert.match(text, /Wave 6:\s+7:00 AM EST \(Thu, Nov 26\)/);
    assert.doesNotMatch(text, /UTC|next day/i);

    const spans = [...document.querySelectorAll(".subtitle .tc-time")];
    assert.deepEqual(spans.map((span) => span.title), [
      "16:00 UTC",
      "20:00 UTC",
      "00:00 UTC (next day)",
      "04:00 UTC (next day)",
      "08:00 UTC (next day)",
      "12:00 UTC (next day)",
    ]);

    spans[0].dispatchEvent(new document.defaultView.MouseEvent("click", { bubbles: true, composed: true }));
    assert.equal(spans[0].textContent, "16:00 UTC");
    assert.equal(spans[0].title, "11:00 AM EST");
    spans[0].dispatchEvent(new document.defaultView.MouseEvent("click", { bubbles: true, composed: true }));
    assert.equal(spans[0].textContent, "11:00 AM EST");

    controller.scan();
    assert.equal(document.querySelectorAll(".subtitle .tc-time").length, 6);
    assert.equal(document.querySelector("code").textContent, "16:00 UTC");
    assert.equal(document.title, "Sale at 16:00 UTC");

    controller.setHour12(false);
    assert.match(document.querySelector(".subtitle").textContent, /Wave 2:\s+15:00 EST/);
    assert.match(document.querySelector(".subtitle").textContent, /Wave 5:\s+03:00 EST \(Thu, Nov 26\)/);
  } finally {
    close();
  }
});

test("later light-DOM and open shadow-root text is converted", async () => {
  const { document, controller, close } = mount("<p>Wave 1: 16:00 UTC</p>");
  try {
    const added = document.createElement("p");
    added.textContent = "Doors at 18:30 UTC.";
    document.body.appendChild(added);

    const host = document.createElement("div");
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = "<p>Meet at 16:00 UTC</p>";

    await new Promise((resolve) => setTimeout(resolve, 120));
    assert.match(added.textContent, /1:30 PM EST/);
    assert.match(shadow.textContent, /11:00 AM EST/);
    controller.scan();
    assert.equal(added.querySelectorAll(".tc-time").length, 1);
    assert.equal(shadow.querySelectorAll(".tc-time").length, 1);
  } finally {
    close();
  }
});

test("pick mode converts a missed time without rewriting every copy", () => {
  const { document, controller, close } = mount("<p id='one'>Showtime 7:30 PM</p><p id='two'>Showtime 7:30 PM</p>");
  try {
    assert.equal(document.querySelectorAll(".tc-time").length, 0);
    controller.enterPickMode();
    assert.equal(controller.isPickMode(), true);
    assert.equal(document.querySelectorAll(".tc-candidate").length, 2);
    assert.match(document.querySelector(".tc-bar-text").textContent, /Click a highlighted time/);

    const first = document.querySelector("#one .tc-candidate");
    first.dispatchEvent(new document.defaultView.MouseEvent("click", { bubbles: true, composed: true }));
    assert.match(document.querySelector("#one").textContent, /Showtime 2:30 PM EST/);
    assert.equal(document.querySelector("#two .tc-candidate").textContent, "7:30 PM");

    const second = document.querySelector("#two");
    second.dispatchEvent(new document.defaultView.MouseEvent("click", { bubbles: true, composed: true }));
    assert.match(second.textContent, /Showtime 2:30 PM EST/);

    document.dispatchEvent(new document.defaultView.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    assert.equal(controller.isPickMode(), false);
    controller.exitPickMode();
    assert.equal(document.querySelector(".tc-bar"), null);
    assert.equal(document.querySelectorAll(".tc-candidate").length, 0);

    document.querySelector("#one").remove();
    const again = document.createElement("p");
    again.textContent = "Showtime 7:30 PM";
    document.body.appendChild(again);
    controller.scan();
    assert.match(again.textContent, /2:30 PM EST/);
    assert.match(document.querySelector("#two").textContent, /2:30 PM EST/);
  } finally {
    close();
  }
});

test("pause restores UTC text and resume converts it again", () => {
  const { document, controller, close } = mount(`<div class="subtitle">${SUBTITLE}</div>`);
  try {
    controller.enterPickMode();
    controller.setPaused(true);
    const text = document.querySelector(".subtitle").textContent;
    assert.match(text, /16:00 UTC/);
    assert.match(text, /00:00 UTC \(next day\)/);
    assert.doesNotMatch(text, /EST/);
    controller.setPaused(false);
    assert.match(document.querySelector(".subtitle").textContent, /Wave 1:\s+11:00 AM EST/);
    assert.equal(document.querySelectorAll(".tc-time").length, 6);
  } finally {
    close();
  }
});
