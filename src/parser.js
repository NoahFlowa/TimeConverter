(function () {
const MONTHS = new Map([
  ["jan", 1],
  ["january", 1],
  ["feb", 2],
  ["february", 2],
  ["mar", 3],
  ["march", 3],
  ["apr", 4],
  ["april", 4],
  ["may", 5],
  ["jun", 6],
  ["june", 6],
  ["jul", 7],
  ["july", 7],
  ["aug", 8],
  ["august", 8],
  ["sep", 9],
  ["sept", 9],
  ["september", 9],
  ["oct", 10],
  ["october", 10],
  ["nov", 11],
  ["november", 11],
  ["dec", 12],
  ["december", 12],
]);

const MONTH = "Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?";
const AMPM = String.raw`([ap])\.?m\.?`;
// "GMT+5" and "UTC +1" name an offset, not UTC itself. A following clock on the next line does not.
const TZ = String.raw`(?:UTC|GMT|Zulu)(?!\s*[+-]\d)(?![\w+-])`;
const SHIFT = String.raw`(?:\s*\(\s*(?:next\s+day|tomorrow|previous\s+day|prev\s+day|yesterday)\s*\))?`;

const ISO_RE = /\b(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d+))?Z\b/gi;
const YMD_RE = new RegExp(String.raw`\b(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?\s*${TZ}${SHIFT}`, "gi");
const MONTH_FIRST_RE = new RegExp(
  String.raw`\b(${MONTH})\s+(\d{1,2})(?:st|nd|rd|th)?\,?\s+(\d{4})\,?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(?:${AMPM})?\s*${TZ}${SHIFT}`,
  "gi",
);
const DAY_FIRST_RE = new RegExp(
  String.raw`\b(\d{1,2})(?:st|nd|rd|th)?\s+(${MONTH})\,?\s+(\d{4})\,?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(?:${AMPM})?\s*${TZ}${SHIFT}`,
  "gi",
);
const CLOCK_RE = new RegExp(String.raw`\b(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(?:${AMPM})?\s*${TZ}${SHIFT}`, "gi");
const HOUR_ONLY_RE = new RegExp(String.raw`\b(\d{1,2})\s*${AMPM}\s*${TZ}${SHIFT}`, "gi");
const BARE_CLOCK_RE = /\b(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(?:([ap])\.?m\.?)?\b/gi;
const BARE_HOUR_RE = /\b(\d{1,2})\s*([ap])\.?m\.?\b/gi;

const UNUSUAL_SPACE = /[\u00A0\u202F]/g;

function dayShiftFrom(raw) {
  const match = raw.match(/\(\s*(next\s+day|tomorrow|previous\s+day|prev\s+day|yesterday)\s*\)/i);
  if (!match) return 0;
  const word = match[1].toLowerCase();
  if (word === "next day" || word === "tomorrow") return 1;
  return -1;
}

function toHour24(hour, ampm) {
  if (!Number.isInteger(hour)) return null;
  if (ampm) {
    if (hour < 1 || hour > 12) return null;
    if (ampm.toLowerCase() === "a") return hour === 12 ? 0 : hour;
    return hour === 12 ? 12 : hour + 12;
  }
  if (hour < 0 || hour > 23) return null;
  return hour;
}

function validMinute(value) {
  return Number.isInteger(value) && value >= 0 && value <= 59;
}

function isValidYmd(year, month, day) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (month < 1 || month > 12 || day < 1) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function fractionToMs(frac) {
  if (!frac) return 0;
  const ms = Math.round(Number(`0.${frac}`) * 1000);
  return Number.isFinite(ms) ? ms : null;
}

function makeUtc({ year, month, day, hour, minute, second, ms, shift }) {
  if (!isValidYmd(year, month, day)) return null;
  return new Date(Date.UTC(year, month - 1, day + shift, hour, minute, second, ms));
}

function span(match, date) {
  if (!date || Number.isNaN(date.getTime())) return null;
  return {
    start: match.index,
    end: match.index + match[0].length,
    raw: match[0],
    date,
  };
}

function integer(value, fallback = null) {
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function clockOn(now, hour, minute, second, ampm, raw) {
  const parts = timeParts(hour, minute, second, ampm);
  if (!parts) return null;
  return makeUtc({
    year: now.getUTCFullYear(),
    month: now.getUTCMonth() + 1,
    day: now.getUTCDate(),
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
    ms: 0,
    shift: dayShiftFrom(raw),
  });
}

function timeParts(hour, minute, second, ampm) {
  const hour24 = toHour24(hour, ampm);
  if (hour24 === null || !validMinute(minute) || !validMinute(second)) return null;
  return { hour: hour24, minute, second };
}

function fromIso(match) {
  const ms = fractionToMs(match[7]);
  const parts = timeParts(integer(match[4]), integer(match[5]), integer(match[6], 0), null);
  if (ms === null || !parts) return null;
  return span(match, makeUtc({
    year: integer(match[1]),
    month: integer(match[2]),
    day: integer(match[3]),
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
    ms,
    shift: 0,
  }));
}

function fromYmd(match) {
  const parts = timeParts(integer(match[4]), integer(match[5]), integer(match[6], 0), null);
  if (!parts) return null;
  return span(match, makeUtc({
    year: integer(match[1]),
    month: integer(match[2]),
    day: integer(match[3]),
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
    ms: 0,
    shift: dayShiftFrom(match[0]),
  }));
}

function fromNamed(match, monthText, dayText, yearText, hourText, minuteText, secondText, ampm) {
  const parts = timeParts(integer(hourText), integer(minuteText), integer(secondText, 0), ampm);
  const month = MONTHS.get(monthText.toLowerCase());
  if (month == null || !parts) return null;
  return span(match, makeUtc({
    year: integer(yearText),
    month,
    day: integer(dayText),
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
    ms: 0,
    shift: dayShiftFrom(match[0]),
  }));
}

function takeNonOverlapping(matches) {
  const sorted = [...matches].sort((a, b) => a.start - b.start || b.end - a.end);
  const chosen = [];
  let cursor = 0;
  for (const match of sorted) {
    if (match.start < cursor || match.end <= match.start) continue;
    chosen.push(match);
    cursor = match.end;
  }
  return chosen;
}

function overlaps(start, end, ranges) {
  return ranges.some(([rangeStart, rangeEnd]) => start < rangeEnd && end > rangeStart);
}

function allMatches(text, regex) {
  regex.lastIndex = 0;
  return text.matchAll(regex);
}

function findExplicitTimes(text, now = new Date()) {
  const found = [];
  const add = (match, date) => {
    const item = span(match, date);
    if (item) found.push(item);
  };

  for (const match of allMatches(text, ISO_RE)) add(match, fromIso(match)?.date);
  for (const match of allMatches(text, YMD_RE)) add(match, fromYmd(match)?.date);
  for (const match of allMatches(text, MONTH_FIRST_RE)) {
    add(match, fromNamed(match, match[1], match[2], match[3], match[4], match[5], match[6], match[7])?.date);
  }
  for (const match of allMatches(text, DAY_FIRST_RE)) {
    add(match, fromNamed(match, match[2], match[1], match[3], match[4], match[5], match[6], match[7])?.date);
  }
  for (const match of allMatches(text, CLOCK_RE)) {
    add(match, clockOn(now, integer(match[1]), integer(match[2]), integer(match[3], 0), match[4], match[0]));
  }
  for (const match of allMatches(text, HOUR_ONLY_RE)) {
    add(match, clockOn(now, integer(match[1]), 0, 0, match[2], match[0]));
  }
  return takeNonOverlapping(found);
}

function findBareTimes(text, now = new Date()) {
  const blocked = findExplicitTimes(text, now).map((match) => [match.start, match.end]);
  const found = [];
  const consider = (match, date) => {
    if (!date) return;
    const start = match.index;
    const end = match.index + match[0].length;
    if (overlaps(start, end, blocked)) return;
    const item = span(match, date);
    if (item) found.push(item);
  };

  for (const match of allMatches(text, BARE_CLOCK_RE)) {
    consider(match, clockOn(now, integer(match[1]), integer(match[2]), integer(match[3], 0), match[4], match[0]));
  }
  for (const match of allMatches(text, BARE_HOUR_RE)) {
    consider(match, clockOn(now, integer(match[1]), 0, 0, match[2], match[0]));
  }
  return takeNonOverlapping(found);
}

function localDayKey(date, timeZone) {
  const options = { year: "numeric", month: "2-digit", day: "2-digit" };
  if (timeZone) options.timeZone = timeZone;
  return new Intl.DateTimeFormat("en-CA", options).format(date);
}

function formatLocal(date, { hour12 = null, timeZone, locale, now = new Date() } = {}) {
  const timeOptions = {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  };
  if (timeZone) timeOptions.timeZone = timeZone;
  if (typeof hour12 === "boolean") timeOptions.hour12 = hour12;

  const time = new Intl.DateTimeFormat(locale, timeOptions).format(date).replace(UNUSUAL_SPACE, " ");
  if (localDayKey(date, timeZone) === localDayKey(now, timeZone)) return time;

  const dayOptions = { weekday: "short", month: "short", day: "numeric" };
  if (timeZone) dayOptions.timeZone = timeZone;
  const day = new Intl.DateTimeFormat(locale, dayOptions).format(date).replace(UNUSUAL_SPACE, " ");
  return `${time} (${day})`;
}

function localeUsesHour12(locale, timeZone) {
  const options = { hour: "numeric" };
  if (timeZone) options.timeZone = timeZone;
  return new Intl.DateTimeFormat(locale, options).formatToParts(new Date()).some((part) => part.type === "dayPeriod");
}

globalThis.TCParser = { findExplicitTimes, findBareTimes, formatLocal, localeUsesHour12 };
})();
