import { test } from "node:test";
import assert from "node:assert/strict";
import {
  safeAttr,
  escapeHtml,
  escapeSql,
  timestampToMs,
  formatValue,
  relativeTime,
  routeKey,
  routeNumber
} from "./format.js";

test("safeAttr returns the field value or the fallback", () => {
  const graphic = { attributes: { route: "11", empty: "" } };
  assert.equal(safeAttr(graphic, "route"), "11");
  assert.equal(safeAttr(graphic, "empty", "--"), "--");
  assert.equal(safeAttr(graphic, "missing", "--"), "--");
  assert.equal(safeAttr(null, "route", "--"), "--");
  assert.equal(safeAttr(graphic, "", "--"), "--");
});

test("escapeHtml neutralizes markup characters", () => {
  assert.equal(escapeHtml(`<a href="x">O'Neil & Co</a>`),
    "&lt;a href=&quot;x&quot;&gt;O&#39;Neil &amp; Co&lt;/a&gt;");
  assert.equal(escapeHtml(null), "");
});

test("escapeSql doubles single quotes", () => {
  assert.equal(escapeSql("O'Neil"), "O''Neil");
  assert.equal(escapeSql("plain"), "plain");
});

test("timestampToMs handles seconds, millis, strings and blanks", () => {
  assert.equal(timestampToMs(""), null);
  assert.equal(timestampToMs(null), null);
  assert.equal(timestampToMs(1_600_000_000), 1_600_000_000_000); // seconds -> ms
  assert.equal(timestampToMs(1_600_000_000_000), 1_600_000_000_000); // already ms
  assert.equal(timestampToMs("1600000000"), 1_600_000_000_000);
  assert.equal(timestampToMs("not a date"), null);
  assert.equal(timestampToMs("2020-09-13T12:26:40Z"), Date.parse("2020-09-13T12:26:40Z"));
});

test("formatValue returns -- for empty and a string otherwise", () => {
  assert.equal(formatValue(""), "--");
  assert.equal(formatValue(null), "--");
  assert.equal(typeof formatValue(1_600_000_000), "string");
});

test("relativeTime buckets recent timestamps", () => {
  const now = Date.now();
  assert.equal(relativeTime(now), "just now");
  assert.equal(relativeTime(now - 60 * 1000), "1 min ago");
  assert.equal(relativeTime(now - 5 * 60 * 1000), "5 min ago");
  assert.equal(relativeTime(now - 2 * 60 * 60 * 1000), "2 hr ago");
  assert.equal(relativeTime(""), "--");
});

test("routeKey extracts the leading token", () => {
  assert.equal(routeKey("11 Avent Ferry"), "11");
  assert.equal(routeKey("  4A  Rex  "), "4A");
  assert.equal(routeKey(null), "");
});

test("routeNumber parses numeric route keys only", () => {
  assert.equal(routeNumber("11 Avent Ferry"), 11);
  assert.equal(routeNumber("4A"), null);
  // Quirk carried over verbatim from the original: an empty/blank route key
  // becomes "" which Number() coerces to 0 (a finite number), not null.
  assert.equal(routeNumber(null), 0);
});
