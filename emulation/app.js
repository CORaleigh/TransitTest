/* ===== Digital Twin — NYC Buses (visual emulation over a real ArcGIS scene) ===== */

// deterministic PRNG so the fallback backdrop is stable across screenshots
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LINES = [
  { name: "M116", bus: "3949", risk: "amber" },
  { name: "M96",  bus: "9422", risk: "amber" },
  { name: "M1",   bus: "9560", risk: "red" },
  { name: "M103", bus: "5883", risk: "red" },
  { name: "M103", bus: "5254", risk: "red" },
  { name: "M11",  bus: "9778", risk: "red" },
  { name: "M2",   bus: "4357", risk: "red" },
  { name: "M3",   bus: "9611", risk: "red" },
  { name: "M4",   bus: "9605", risk: "red" },
  { name: "M42",  bus: "9718", risk: "red" },
  { name: "M50",  bus: "9666", risk: "red" },
  { name: "M7",   bus: "7584", risk: "red" },
  { name: "M5",   bus: "6120", risk: "red" },
  { name: "M15",  bus: "8830", risk: "red" },
  { name: "M23",  bus: "4471", risk: "red" },
];

const STATE = { lines: 26, buses: 300, alerts: 2, highRisk: 10, riskPct: 4 };
const REFRESH_MS = 15000;
const RECENT_HOURS = 3; // drop buses whose last ping is older than this (matches the main app)

// is a vehicle-position timestamp within RECENT_HOURS? Tolerates epoch s/ms or a date string.
function isRecent(ts) {
  if (ts == null) return true; // no timestamp field -> don't filter it out
  let ms;
  if (typeof ts === "number") ms = ts > 1e12 ? ts : ts * 1000; // seconds vs milliseconds
  else { const p = Date.parse(ts); if (Number.isNaN(p)) return true; ms = p; }
  return Date.now() - ms < RECENT_HOURS * 3600 * 1000;
}

// live data-layer state (populated once the ArcGIS scene + vehicles layer load)
let vehiclesLayer = null;
let fieldMap = { route: null, id: null, ts: null };
let allVehicles = [];
let currentRoute = "ALL LINES";
let sortMode = 0; // 0 = recency, 1 = route asc, 2 = route desc
let refreshTimer = null;
let refreshing = false;
let renderPins = () => {}; // assigned once the map's pin layer exists

let toastTimer = null;
function showToast(message) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = message;
  el.classList.add("visible");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("visible"), 2600);
}

// ArcGIS buildings SceneLayer portal item + downtown camera (from the GoRaleigh app)
const MAP_CONFIG = {
  buildingsItemId: "affa13965fe948cca694e356ef9a3004",
  realtimeVehiclesItemId: "90339540b1fd4678bf474ab1ab5abe73",
  center: { longitude: -78.6382, latitude: 35.7796 }, // downtown Raleigh
  camera: {
    position: { longitude: -78.6470, latitude: 35.7690, z: 640 },
    tilt: 70,
    heading: 28,
  },
};

const BUS_SVG =
  '<svg viewBox="0 0 24 24" fill="none"><rect x="4" y="4" width="16" height="13" rx="2" stroke="currentColor" stroke-width="1.8"/><line x1="4" y1="9.5" x2="20" y2="9.5" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="19" r="1.6" fill="currentColor"/><circle cx="16" cy="19" r="1.6" fill="currentColor"/></svg>';

// teardrop bus pin (colored by alert level), used for map PictureMarkerSymbols
function pinSvg(fill, stroke) {
  return '<svg xmlns="http://www.w3.org/2000/svg" width="34" height="42" viewBox="0 0 34 42">' +
    `<path d="M17 41C17 41 32 24 32 15A15 15 0 1 0 2 15C2 24 17 41 17 41Z" fill="${fill}" stroke="${stroke}" stroke-width="1.3"/>` +
    '<g transform="translate(17,15)" fill="none" stroke="#eafaff" stroke-width="1.5">' +
    '<rect x="-6.5" y="-6" width="13" height="10.5" rx="1.6"/><line x1="-6.5" y1="-1.6" x2="6.5" y2="-1.6"/>' +
    '<circle cx="-3.6" cy="5.6" r="1.2" fill="#eafaff"/><circle cx="3.6" cy="5.6" r="1.2" fill="#eafaff"/></g></svg>';
}
const pinUrl = (fill, stroke) => "data:image/svg+xml;charset=utf-8," + encodeURIComponent(pinSvg(fill, stroke));
const PIN_MARKUP = pinSvg("#12a9d6", "#7fe0f6"); // cyan, reused by the SVG fallback

const reducedMotionQuery = globalThis.matchMedia ? globalThis.matchMedia("(prefers-reduced-motion: reduce)") : null;
const prefersReducedMotion = () => Boolean(reducedMotionQuery && reducedMotionQuery.matches);

/* ---------- REAL MAP: ArcGIS SceneView (SDK 5.x, $arcgis.import) ---------- */
// Resolves true if the ArcGIS SDK loaded and the scene was built; false to fall back.
async function initMap() {
  // the module CDN loader defines a global $arcgis asynchronously — wait for it
  for (let i = 0; typeof window.$arcgis === "undefined" && i < 200; i++) {
    await new Promise((r) => setTimeout(r, 50));
  }
  if (typeof window.$arcgis === "undefined") return false;

  try {
    const [Map, SceneView, SceneLayer, GraphicsLayer, Graphic, FeatureLayer, Point] = await window.$arcgis.import([
      "@arcgis/core/Map.js",
      "@arcgis/core/views/SceneView.js",
      "@arcgis/core/layers/SceneLayer.js",
      "@arcgis/core/layers/GraphicsLayer.js",
      "@arcgis/core/Graphic.js",
      "@arcgis/core/layers/FeatureLayer.js",
      "@arcgis/core/geometry/Point.js",
    ]);

    const map = new Map({ basemap: "dark-gray-vector", ground: "world-elevation" });

    // cyan wireframe buildings to match the "digital twin" aesthetic
    const buildings = new SceneLayer({
      portalItem: { id: MAP_CONFIG.buildingsItemId },
      popupEnabled: false,
      renderer: {
        type: "simple",
        symbol: {
          type: "mesh-3d",
          symbolLayers: [{
            type: "fill",
            material: { color: [22, 96, 134, 0.86], colorMixMode: "replace" },
            edges: { type: "solid", color: [122, 226, 250, 0.9], size: 0.7 },
          }],
        },
      },
    });
    map.add(buildings);

    // live bus pins — one persistent graphic per vehicle, colored by alert level,
    // glided from old to new position on each refresh
    const pinsLayer = new GraphicsLayer({ elevationInfo: { mode: "relative-to-ground", offset: 90 } });
    map.add(pinsLayer);
    const pinSym = { type: "picture-marker", url: pinUrl("#12a9d6", "#7fe0f6"), width: "26px", height: "32px", yoffset: "16px" };

    // NOTE: `Map` is shadowed by the ArcGIS Map class in this scope -> use globalThis.Map
    const pinGraphics = new globalThis.Map(); // vehicleId -> Graphic
    const anim = new globalThis.Map();        // vehicleId -> { fromLon, fromLat, toLon, toLat, start }
    const GLIDE_MS = 1400;

    renderPins = (vehicles) => {
      const now = performance.now();
      const live = new Set();
      for (const v of vehicles) {
        if (v.lon == null || v.lat == null) continue;
        live.add(v.id);
        let g = pinGraphics.get(v.id);
        if (!g) {
          g = new Graphic({ geometry: new Point({ longitude: v.lon, latitude: v.lat }), symbol: pinSym });
          pinGraphics.set(v.id, g);
          pinsLayer.add(g);
        } else {
          const cur = g.geometry;
          if (prefersReducedMotion() || (cur.longitude === v.lon && cur.latitude === v.lat)) {
            g.geometry = new Point({ longitude: v.lon, latitude: v.lat });
          } else {
            anim.set(v.id, { fromLon: cur.longitude, fromLat: cur.latitude, toLon: v.lon, toLat: v.lat, start: now });
          }
        }
      }
      // drop vehicles no longer present
      for (const [id, g] of pinGraphics) {
        if (!live.has(id)) { pinsLayer.remove(g); pinGraphics.delete(id); anim.delete(id); }
      }
      window.__twin.pinCount = pinGraphics.size;
      if (anim.size) requestAnimationFrame(tickAnim);
    };

    function tickAnim() {
      const now = performance.now();
      for (const [id, a] of anim) {
        const g = pinGraphics.get(id);
        if (!g) { anim.delete(id); continue; }
        const t = Math.min(1, (now - a.start) / GLIDE_MS);
        const e = t * (2 - t); // ease-out
        g.geometry = new Point({
          longitude: a.fromLon + (a.toLon - a.fromLon) * e,
          latitude: a.fromLat + (a.toLat - a.fromLat) * e,
        });
        if (t >= 1) anim.delete(id);
      }
      if (anim.size) requestAnimationFrame(tickAnim);
    }

    const view = new SceneView({
      container: "viewDiv",
      map,
      camera: MAP_CONFIG.camera,
      qualityProfile: "high",
      ui: { components: [] }, // hide default widgets; the mock supplies its own chrome
      environment: {
        atmosphere: { quality: "high" },
        lighting: { type: "sun", directShadowsEnabled: true },
        weather: { type: "sunny", cloudCover: 0.2 },
        starsEnabled: false,
      },
    });

    window.__view = view;

    // load the realtime-vehicles layer, do a first refresh, then poll every 15s
    if (await setupVehicles(FeatureLayer)) {
      await refreshData();
      startAutoRefresh();
    }

    await view.when();
    // poll until the scene stops loading tiles/buildings, then flag ready
    await new Promise((resolve) => {
      const check = () => (view.updating ? setTimeout(check, 150) : resolve());
      setTimeout(check, 300);
    });
    window.__mapReady = true;
    return true;
  } catch (err) {
    console.error("SceneView failed:", err);
    return false;
  }
}

/* ---------- OFFLINE FALLBACK: stylized SVG city ---------- */
function buildCityFallback() {
  const svg = document.getElementById("city");
  document.getElementById("viewDiv").style.display = "none";
  svg.removeAttribute("hidden");
  const W = 1920, H = 780;
  const rnd = mulberry32(1337);
  const parts = [];
  for (let i = -6; i < 40; i++) {
    const x = i * 62;
    parts.push(`<line x1="${x}" y1="0" x2="${x + 260}" y2="${H}" stroke="rgba(70,150,185,0.10)" stroke-width="1"/>`);
  }
  const buildings = [];
  for (let n = 0; n < 460; n++) {
    const gx = rnd(), gy = rnd();
    const density = (1 - gx * 0.7) * (1 - gy * 0.35);
    if (rnd() > density + 0.15) continue;
    const bx = 40 + gx * (W - 120), by = 20 + gy * (H - 120);
    const w = 12 + rnd() * 26, d = 8 + rnd() * 16, h = 10 + rnd() * (70 * (1 - gy) + 18);
    buildings.push({ bx, by, w, d, h });
  }
  buildings.sort((a, b) => a.by - b.by);
  for (const { bx, by, w, d, h } of buildings) {
    const a = 0.10 + Math.min(0.28, h / 260);
    parts.push(`<polygon points="${bx},${by} ${bx + w},${by} ${bx + w + d},${by + d} ${bx + d},${by + d}" fill="rgba(70,205,240,${a + 0.06})" stroke="rgba(120,225,250,0.35)" stroke-width="0.6"/>`);
    parts.push(`<polygon points="${bx},${by} ${bx + d},${by + d} ${bx + d},${by + d + h} ${bx},${by + h}" fill="rgba(30,120,160,${a})" stroke="rgba(90,200,235,0.28)" stroke-width="0.5"/>`);
    parts.push(`<polygon points="${bx + w},${by} ${bx + w + d},${by + d} ${bx + w + d},${by + d + h} ${bx + w},${by + h}" fill="rgba(18,80,115,${a})" stroke="rgba(90,200,235,0.22)" stroke-width="0.5"/>`);
  }
  svg.innerHTML = parts.join("");
  const pinLayer = document.createElement("div");
  pinLayer.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:4;";
  for (const [px, py] of [[1050, 30], [640, 175], [880, 260], [205, 360], [150, 455], [1360, 205], [600, 300], [1885, 245], [635, 225]]) {
    const pin = document.createElement("div");
    pin.className = "bus-pin";
    pin.style.cssText = `position:absolute;left:${(px / W) * 100}%;top:${(py / H) * 100}%;transform:translate(-50%,-100%);`;
    pin.innerHTML = `<svg width="34" height="42" viewBox="0 0 34 42">${PIN_MARKUP.slice(PIN_MARKUP.indexOf(">") + 1, PIN_MARKUP.lastIndexOf("</svg>"))}</svg>`;
    pinLayer.appendChild(pin);
  }
  document.getElementById("map").appendChild(pinLayer);
}

/* ---------- stats + donut ---------- */
function renderStats() {
  document.getElementById("statLines").textContent = STATE.lines;
  document.getElementById("statBuses").textContent = STATE.buses;
  document.getElementById("statAlerts").textContent = STATE.alerts;
  document.getElementById("statRisk").textContent = STATE.highRisk;
  document.getElementById("donutPct").textContent = STATE.riskPct + "%";

  const r = 52, C = 2 * Math.PI * r;
  const redFrac = STATE.riskPct / 100;
  const orangeFrac = Math.min(0.03, redFrac * 0.6);
  const red = document.querySelector(".red-arc");
  const orange = document.querySelector(".orange-arc");
  red.setAttribute("stroke", "#e6472b");
  red.setAttribute("stroke-dasharray", `${(C * redFrac).toFixed(2)} ${C}`);
  orange.setAttribute("stroke", "#e8862f");
  orange.setAttribute("stroke-dasharray", `${(C * orangeFrac).toFixed(2)} ${C}`);
  orange.setAttribute("stroke-dashoffset", `${(-C * redFrac).toFixed(2)}`);
  document.querySelector(".donut-track").setAttribute("stroke", "#1c93b8");
}

/* ---------- ticker ---------- */
function esc(v) {
  return String(v).replace(/[&<>"]/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
}

// chip head = route_id, chip badge = vehicle id
function renderTicker(list = LINES) {
  const track = document.getElementById("tickerTrack");
  track.innerHTML = list.map((l) => `
    <div class="chip ${l.risk === "amber" ? "amber" : ""}">
      <div class="chip-head">
        <span class="chip-ring"></span>
        <span class="chip-name">${esc(l.name)}</span>
      </div>
      <div class="chip-badge">${BUS_SVG}<span>${esc(l.bus)}</span></div>
    </div>`).join("");
}

// find the first layer field whose name matches (exact first, then substring)
function pickField(fields, candidates) {
  const names = (fields || []).map((f) => f.name);
  const lower = names.map((n) => n.toLowerCase());
  for (const c of candidates) {
    const i = lower.indexOf(c.toLowerCase());
    if (i !== -1) return names[i];
  }
  for (const c of candidates) {
    const i = lower.findIndex((n) => n.includes(c.toLowerCase()));
    if (i !== -1) return names[i];
  }
  return null;
}

// load the realtime-vehicles layer and resolve its field names
async function setupVehicles(FeatureLayer) {
  window.__twin = window.__twin || {};
  try {
    vehiclesLayer = new FeatureLayer({ portalItem: { id: MAP_CONFIG.realtimeVehiclesItemId } });
    await vehiclesLayer.load();
    fieldMap.route = pickField(vehiclesLayer.fields, ["route_id", "trip_route_id", "route_short_name", "route"]);
    fieldMap.id = pickField(vehiclesLayer.fields, ["vehicle_id", "vehicle_number", "vehicleid", "vehicle"]);
    fieldMap.ts = pickField(vehiclesLayer.fields, ["vehicle_position_timestamp", "timestamp", "last_updated"]);
    window.__twin.vehicleFields = { ...fieldMap };
    return Boolean(fieldMap.route && fieldMap.id);
  } catch (err) {
    console.warn("Vehicles layer setup failed:", err);
    window.__twin.vehicleFields = { error: String(err) };
    return false;
  }
}

// pull the latest vehicles, refresh the route list, and re-render the current view
async function refreshData() {
  if (!vehiclesLayer || refreshing) return;
  refreshing = true;
  try {
    const { route, id, ts } = fieldMap;
    const q = vehiclesLayer.createQuery();
    q.where = `${route} IS NOT NULL`;
    q.outFields = [route, id, ts].filter(Boolean);
    q.returnGeometry = true;
    q.num = 1000;
    if (ts) q.orderByFields = [`${ts} DESC`];

    const { features } = await vehiclesLayer.queryFeatures(q);

    // the layer is a position LOG (many pings per bus) — keep the latest ping per
    // vehicle_id (features arrive newest-first) and drop stale ones
    const seen = new Set();
    allVehicles = [];
    for (const f of features) {
      const vid = f.attributes[id] == null ? "—" : String(f.attributes[id]);
      if (seen.has(vid)) continue;
      seen.add(vid);
      const rt = f.attributes[route] == null ? "" : String(f.attributes[route]);
      if (!rt || rt === "null") continue;
      if (!isRecent(f.attributes[ts])) continue;
      allVehicles.push({ route: rt, id: vid, ts: f.attributes[ts], lon: f.geometry?.longitude, lat: f.geometry?.latitude });
    }

    window.__twin.rawPings = features.length;
    window.__twin.sampleTs = features[0]?.attributes?.[ts];

    const routes = [...new Set(allVehicles.map((v) => v.route))]
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    populateDropdown(routes);

    window.__twin.routeCount = routes.length;
    window.__twin.vehicleCount = allVehicles.length;
    window.__twin.lastRefresh = new Date().toISOString();

    applyView();
  } catch (err) {
    console.warn("Vehicle refresh failed:", err);
  } finally {
    refreshing = false;
  }
}

// apply the current route filter + sort mode to ticker, pins, and stats
function applyView() {
  let list = currentRoute === "ALL LINES"
    ? allVehicles
    : allVehicles.filter((v) => v.route === currentRoute);

  if (sortMode === 1) {
    list = [...list].sort((a, b) => a.route.localeCompare(b.route, undefined, { numeric: true }));
  } else if (sortMode === 2) {
    list = [...list].sort((a, b) => b.route.localeCompare(a.route, undefined, { numeric: true }));
  } // sortMode 0 = order returned by the service (most recent first)

  renderTicker(list.slice(0, 60).map((v) => ({ name: v.route, bus: v.id })));
  renderPins(list);
  updateStats(list);
}

// BUS LINES = distinct routes network-wide; BUSES = buses currently shown.
// (ALERTS / HIGH RISK / donut stay as static placeholders — no alerts feed for now.)
function updateStats(shown) {
  const routes = new Set(allVehicles.map((v) => v.route));
  document.getElementById("statLines").textContent = routes.size;
  document.getElementById("statBuses").textContent = shown.length;
}

function startAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(() => { refreshData(); }, REFRESH_MS);
}

/* ---------- line filter dropdown ---------- */
// (re)fill the menu: "ALL LINES" followed by the given route ids
function populateDropdown(routes) {
  const menu = document.getElementById("lineMenu");
  const label = document.getElementById("lineFilterLabel");
  const current = label.textContent;
  const items = ["ALL LINES", ...routes];
  menu.innerHTML = items.map((t, i) =>
    `<li role="option" data-val="${esc(t)}" ${t === current ? 'aria-selected="true"' : (i === 0 && current === "ALL LINES" ? 'aria-selected="true"' : "")}>${esc(t)}</li>`).join("");
}

function initDropdown() {
  const filter = document.getElementById("lineFilter");
  const menu = document.getElementById("lineMenu");
  const label = document.getElementById("lineFilterLabel");
  // initial content: distinct mock route names (replaced by live route ids once loaded)
  populateDropdown(LINES.map((l) => l.name).filter((v, i, a) => a.indexOf(v) === i));

  function toggle(open) {
    const show = open ?? menu.hasAttribute("hidden");
    menu.toggleAttribute("hidden", !show);
    filter.setAttribute("aria-expanded", String(show));
  }
  filter.addEventListener("click", (e) => { if (!e.target.closest(".lf-menu")) toggle(); });
  filter.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
    if (e.key === "Escape") toggle(false);
  });
  menu.addEventListener("click", (e) => {
    const li = e.target.closest("li");
    if (!li) return;
    label.textContent = li.dataset.val;
    menu.querySelectorAll("li").forEach((n) => n.removeAttribute("aria-selected"));
    li.setAttribute("aria-selected", "true");
    toggle(false);
    // filter the ticker + map pins to the chosen route
    currentRoute = li.dataset.val;
    if (allVehicles.length) applyView();
  });
  document.addEventListener("click", (e) => { if (!filter.contains(e.target)) toggle(false); });
}

/* ---------- weather toggles -> real scene weather ---------- */
function initWeather() {
  const group = document.getElementById("weather");
  const WX = { clear: { type: "sunny", cloudCover: 0.2 }, rain: { type: "rainy", cloudCover: 0.7, precipitation: 0.5 }, snow: { type: "snowy", cloudCover: 0.7, precipitation: 0.5 } };
  group.addEventListener("click", (e) => {
    const btn = e.target.closest(".wx");
    if (!btn) return;
    group.querySelectorAll(".wx").forEach((b) => b.setAttribute("aria-pressed", "false"));
    btn.setAttribute("aria-pressed", "true");
    document.getElementById("map").dataset.wx = btn.dataset.wx;
    const view = window.__view;
    if (view && view.environment) {
      try { view.environment.weather = WX[btn.dataset.wx] || WX.clear; } catch (_) {}
    }
  });
}

/* ---------- zoom buttons -> real scene zoom ---------- */
function initZoom() {
  const bump = (delta) => {
    const view = window.__view;
    if (view && typeof view.goTo === "function") {
      view.goTo({ zoom: view.zoom + delta }, { duration: 350 }).catch(() => {});
    } else {
      const city = document.getElementById("city");
      const z = (Number(city.dataset.z) || 1) + delta * 0.15;
      city.dataset.z = z;
      city.style.transform = `scale(${Math.max(0.7, Math.min(2.2, z))})`;
      city.style.transformOrigin = "60% 40%";
    }
  };
  document.getElementById("zoomIn").addEventListener("click", () => bump(1));
  document.getElementById("zoomOut").addEventListener("click", () => bump(-1));
}

/* ---------- sort button -> cycle ticker order ---------- */
function initSort() {
  const modes = ["Most recent", "Route ▲", "Route ▼"];
  const btn = document.getElementById("sortBtn");
  btn.addEventListener("click", () => {
    sortMode = (sortMode + 1) % 3;
    btn.title = `Sort: ${modes[sortMode]}`;
    showToast(`Sort: ${modes[sortMode]}`);
    if (allVehicles.length) applyView();
  });
}

/* ---------- bottom-left mode switcher ---------- */
// Real-time Alerts is the live view; the other two are stubs (no Raleigh data)
function initModes() {
  const toolbar = document.getElementById("toolbar");
  const STUB = {
    crash: "Historic Crash Data isn't available in this Raleigh demo.",
    graph: "Graph Analytics isn't available in this Raleigh demo.",
  };
  toolbar.addEventListener("click", (e) => {
    const btn = e.target.closest(".mode-btn");
    if (!btn) return;
    toolbar.querySelectorAll(".mode-btn").forEach((b) => {
      b.classList.toggle("active", b === btn);
      b.setAttribute("aria-selected", String(b === btn));
    });
    if (btn.dataset.mode !== "realtime") showToast(STUB[btn.dataset.mode]);
  });
}

/* ---------- boot ---------- */
renderStats();
renderTicker();
initDropdown();
initWeather();
initZoom();
initSort();
initModes();

initMap().then((ok) => {
  if (!ok) {
    buildCityFallback();
    window.__mapReady = true;
  }
});

window.__twin = { STATE, LINES, renderStats };
