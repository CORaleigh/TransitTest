// Pure, framework- and SDK-agnostic helpers: string escaping, timestamp parsing,
// human-readable formatting, and route-key normalization. No DOM, no ArcGIS, no
// shared state — every function is a plain input -> output transform (§7a: these
// are the first things to unit-test).
import { CONFIG } from "../config.js";

export function safeAttr(graphic, fieldName, fallback = "") {
  if (!graphic?.attributes || !fieldName) return fallback;
  const value = graphic.attributes[fieldName];
  return value === null || value === undefined || value === "" ? fallback : value;
}

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  }[char]));
}

export function escapeSql(value) {
  return String(value).replaceAll("'", "''");
}

export function timestampToMs(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return value < 100000000000 ? value * 1000 : value;
  const text = String(value).trim();
  if (/^\d+$/.test(text)) {
    const num = Number(text);
    return num < 100000000000 ? num * 1000 : num;
  }
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? null : parsed;
}

export function formatValue(value) {
  if (value === null || value === undefined || value === "") return "--";
  const dateMs = timestampToMs(value);
  return dateMs ? new Date(dateMs).toLocaleString() : String(value);
}

export function relativeTime(value) {
  const ms = timestampToMs(value);
  if (!ms) return "--";
  const diffSeconds = Math.round((Date.now() - ms) / 1000);
  if (diffSeconds < 0) return "just now";
  if (diffSeconds < 45) return "just now";
  if (diffSeconds < 90) return "1 min ago";
  const diffMinutes = Math.round(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes} min ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} hr ago`;
  return new Date(ms).toLocaleString();
}

export function isStaleTimestamp(value) {
  const ms = timestampToMs(value);
  if (!ms) return false;
  return Date.now() - ms > CONFIG.staleBusMinutes * 60 * 1000;
}

export function routeKey(value) {
  return String(value ?? "").trim().split(/\s+/)[0] || "";
}

export function routeNumber(value) {
  const key = routeKey(value);
  const num = Number(key);
  return Number.isFinite(num) ? num : null;
}
