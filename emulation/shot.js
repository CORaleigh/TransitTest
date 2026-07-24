/* Puppeteer screenshot / iteration harness for the NYC Digital Twin emulation.
 *
 *   node shot.js                       full page @ 1900x980
 *   node shot.js --width 1600 --height 900
 *   node shot.js --menu                also capture the line-filter dropdown open
 *
 * Screenshots land in ./shots/. Loads index.html directly via file:// (the
 * mock is fully self-contained — no server required).
 */
import puppeteer from "puppeteer";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : true;
}

const width = Number(arg("width", 1900));
const height = Number(arg("height", 980));
const withMenu = Boolean(arg("menu", false));
const pageUrl = pathToFileURL(join(__dirname, "index.html")).href;

const browser = await puppeteer.launch({
  headless: "new",
  args: ["--no-sandbox", "--force-color-profile=srgb"],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 2 });

  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

  await page.goto(pageUrl, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#tickerTrack .chip");

  // wait for the ArcGIS scene to finish loading + rendering (or the fallback)
  await page.waitForFunction(() => window.__mapReady === true, { timeout: 90000 });
  // let building LOD tiles / weather finish streaming in
  await new Promise((r) => setTimeout(r, 6000));

  // sanity checks — cheap assertions so a broken build is obvious
  const report = await page.evaluate(() => ({
    chips: document.querySelectorAll("#tickerTrack .chip").length,
    realMap: !!window.__view,
    canvas: document.querySelectorAll("#viewDiv canvas").length,
    fallbackPins: document.querySelectorAll(".bus-pin").length,
    statLines: document.getElementById("statLines")?.textContent,
    statBuses: document.getElementById("statBuses")?.textContent,
    donut: document.getElementById("donutPct")?.textContent,
    vehicleFields: window.__twin?.vehicleFields,
    vehicleCount: window.__twin?.vehicleCount,
    routeCount: window.__twin?.routeCount,
    pinCount: window.__twin?.pinCount,
    lastRefresh: window.__twin?.lastRefresh,
    sampleChips: [...document.querySelectorAll("#tickerTrack .chip")].slice(0, 3).map((c) => ({
      route: c.querySelector(".chip-name")?.textContent,
      vehicle: c.querySelector(".chip-badge span")?.textContent,
    })),
    dropdownItems: document.querySelectorAll("#lineMenu li").length,
  }));

  await page.screenshot({ path: join(__dirname, "shots", "dashboard.png") });

  // interaction check: filter to a real route and confirm the view narrows
  const filterCheck = await page.evaluate(async () => {
    const before = Number(document.getElementById("statBuses").textContent);
    const li = document.querySelector('#lineMenu li[data-val]:not([data-val="ALL LINES"])');
    const route = li?.dataset.val;
    li?.click(); // menu uses event delegation, so this filters even while hidden
    await new Promise((r) => setTimeout(r, 200));
    const after = Number(document.getElementById("statBuses").textContent);
    const chipRoutes = [...document.querySelectorAll("#tickerTrack .chip-name")].map((n) => n.textContent);
    return {
      route, before, after,
      filteredPins: window.__twin?.pinCount,
      allChipsMatchRoute: chipRoutes.length > 0 && chipRoutes.every((r) => r === route),
    };
  });

  await page.screenshot({ path: join(__dirname, "shots", "filtered.png") });

  // reset to ALL LINES, then optionally capture the open dropdown
  await page.evaluate(() => document.querySelector('#lineMenu li[data-val="ALL LINES"]')?.click());
  if (withMenu) {
    await page.click("#lineFilter");
    await page.waitForSelector("#lineMenu li");
    await page.screenshot({ path: join(__dirname, "shots", "dropdown.png") });
  }
  report.filterCheck = filterCheck;

  console.log("Rendered", `${width}x${height}`, "->", "shots/dashboard.png");
  console.log("Checks:", JSON.stringify(report));
  if (errors.length) {
    console.log("PAGE ERRORS:");
    errors.forEach((e) => console.log("  -", e));
    process.exitCode = 1;
  } else {
    console.log("No page errors.");
  }
} finally {
  await browser.close();
}
