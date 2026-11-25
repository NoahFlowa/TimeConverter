import assert from "node:assert/strict";
import test from "node:test";
import "../src/parser.js";

const { findBareTimes, findExplicitTimes, formatLocal } = globalThis.TCParser;

const NOW = new Date("2026-11-25T18:00:00.000Z");
const EN = { locale: "en-US", now: NOW };

const WAVES = [
  ["16:00 UTC", "2026-11-25T16:00:00.000Z", "11:00 AM EST", "1:00 AM GMT+9"],
  ["20:00 UTC", "2026-11-25T20:00:00.000Z", "3:00 PM EST", "5:00 AM GMT+9"],
  ["00:00 UTC (next day)", "2026-11-26T00:00:00.000Z", "7:00 PM EST", "9:00 AM GMT+9"],
  ["04:00 UTC (next day)", "2026-11-26T04:00:00.000Z", "11:00 PM EST", "1:00 PM GMT+9"],
  ["08:00 UTC (next day)", "2026-11-26T08:00:00.000Z", "3:00 AM EST (Thu, Nov 26)", "5:00 PM GMT+9"],
  ["12:00 UTC (next day)", "2026-11-26T12:00:00.000Z", "7:00 AM EST (Thu, Nov 26)", "9:00 PM GMT+9"],
];

test("RSI waves become local time in New York and Tokyo", () => {
  for (const [raw, iso, eastern, tokyo] of WAVES) {
    const [match] = findExplicitTimes(raw, NOW);
    assert.equal(match.raw, raw);
    assert.equal(match.date.toISOString(), iso);
    assert.equal(formatLocal(match.date, { ...EN, timeZone: "America/New_York", hour12: true }), eastern);
    assert.equal(formatLocal(match.date, { ...EN, timeZone: "Asia/Tokyo", hour12: true }), tokyo);
    assert.equal(findBareTimes(raw, NOW).length, 0);
  }
});

test("Tokyo labels do not keep the UTC next-day phrase", () => {
  const text = WAVES.map(([raw]) => raw).join("\n");
  const labels = findExplicitTimes(text, NOW).map((match) =>
    formatLocal(match.date, { ...EN, timeZone: "Asia/Tokyo", hour12: true }),
  );
  assert.deepEqual(labels, WAVES.map((wave) => wave[3]));
  for (const label of labels) assert.equal(label.includes("next day"), false);
});

test("24-hour formatting still adds a local date when the day changes", () => {
  const date = new Date("2026-11-26T08:00:00.000Z");
  assert.equal(
    formatLocal(date, { ...EN, timeZone: "America/New_York", hour12: false }),
    "03:00 EST (Thu, Nov 26)",
  );
});

test("explicit formats keep their own date instead of assuming today", () => {
  const cases = [
    ["4:00 PM UTC", "2026-11-25T16:00:00.000Z"],
    ["4 PM UTC", "2026-11-25T16:00:00.000Z"],
    ["4:00 p.m. UTC", "2026-11-25T16:00:00.000Z"],
    ["16:00:00 GMT", "2026-11-25T16:00:00.000Z"],
    ["16:00 Zulu", "2026-11-25T16:00:00.000Z"],
    ["16:00 utc (Tomorrow)", "2026-11-26T16:00:00.000Z"],
    ["16:00 UTC (yesterday)", "2026-11-24T16:00:00.000Z"],
    ["16:00 UTC (previous day)", "2026-11-24T16:00:00.000Z"],
    ["2026-11-26T08:00:00Z", "2026-11-26T08:00:00.000Z"],
    ["2026-11-25T16:00:00.500Z", "2026-11-25T16:00:00.500Z"],
    ["2026-11-26 08:00 UTC", "2026-11-26T08:00:00.000Z"],
    ["Nov 26, 2026 8:00 UTC", "2026-11-26T08:00:00.000Z"],
    ["25 Nov 2026 4:00 PM UTC", "2026-11-25T16:00:00.000Z"],
  ];
  for (const [raw, iso] of cases) {
    const matches = findExplicitTimes(raw, NOW);
    assert.equal(matches.length, 1, raw);
    assert.equal(matches[0].date.toISOString(), iso, raw);
  }
});

test("clock phrases leave the surrounding sentence alone", () => {
  const text = "starting daily at 16:00 UTC.";
  const [match] = findExplicitTimes(text, NOW);
  assert.equal(match.raw, "16:00 UTC");
  assert.equal(text.slice(0, match.start), "starting daily at ");
  assert.equal(text.slice(match.end), ".");
});

test("one line can hold both wave times", () => {
  const matches = findExplicitTimes("Wave 1: 16:00 UTC and Wave 2: 20:00 UTC", NOW);
  assert.deepEqual(matches.map((match) => match.raw), ["16:00 UTC", "20:00 UTC"]);
});

test("offsets, invalid clocks, and bare times are not automatic", () => {
  for (const text of ["16:00 GMT+5", "16:00 GMT +5", "16:00 UTC+1", "25:00 UTC", "16:99 UTC", "7:30 PM"]) {
    assert.equal(findExplicitTimes(text, NOW).length, 0, text);
  }
  const [bare] = findBareTimes("Showtime 7:30 PM", NOW);
  assert.equal(bare.raw, "7:30 PM");
  assert.equal(bare.date.toISOString(), "2026-11-25T19:30:00.000Z");
  assert.equal(findBareTimes("16:00 UTC and 18:00", NOW).map((match) => match.raw).join(), "18:00");
});
