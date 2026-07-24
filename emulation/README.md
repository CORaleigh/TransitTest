# Raleigh Digital Twin — visual emulation

A visual mock modeled on the "Digital Twin — NYC Buses" dashboard
(livemaps360.com/DigitalTwin/NYCBuses), retargeted to **Raleigh**. The dashboard
chrome is layered over a **real ArcGIS Maps SDK for JavaScript 5.1** `SceneView` —
a dark 3D scene using the Raleigh 3D-buildings portal item
`affa13965fe948cca694e356ef9a3004` (the same item as the main GoRaleigh app),
re-styled with a cyan wireframe renderer. Isolated from the app in the repo root.

Requires network access (loads the ArcGIS SDK + basemap + buildings from Esri's
CDN). If the SDK can't load, it automatically falls back to a stylized SVG city.
Fully static — no backend/server.

## Files
| File | Purpose |
|------|---------|
| `index.html` | Dashboard markup + ArcGIS 5.1 module loader; `#viewDiv` scene + overlay chrome. |
| `styles.css` | Dark / cyan / orange theme; hides default Esri widgets. |
| `app.js` | ArcGIS scene + the live data layer (see below) + all interactions. |
| `shot.js` | Puppeteer harness — loads via `file://`, waits for the scene (`window.__mapReady`), runs sanity checks + an interaction test, writes screenshots to `shots/`. |

## Live functionality
Driven by the realtime-vehicles layer (portal item `90339540…`), refreshed every 15s:
- **BUS LINES** = distinct routes network-wide; **BUSES** = buses currently shown.
- **Ticker chips**: route id (`trip_route_id`) on top, `vehicle_id` in the badge.
- **Line filter dropdown**: distinct route ids; selecting one filters the ticker, the
  map pins, and the BUSES count. "ALL LINES" resets.
- **Map pins**: one per active bus at its real location; they **glide** smoothly from
  the previous position to the newest one between refreshes (respects
  `prefers-reduced-motion`).
- **Mode switcher** (bottom-left): **Real-time Alerts** is the live view; **Historic
  Crash Data** and **Graph Analytics** are styled stubs (toast — no Raleigh data).
- **Sort button**: cycles the ticker order (recent → route ▲ → route ▼).
- **Weather icons** drive `view.environment.weather`; **zoom** drives `view.goTo`.

The vehicles layer is a position *log* (many pings per bus), so the app keeps only the
latest ping per `vehicle_id` and drops anything older than 3 hours.

> Notes: ALERTS / HIGH RISK / the donut are static placeholders for now (no alerts
> feed wired). The mock hides the Esri attribution to match the target's clean look —
> a published app must keep attribution per the ArcGIS terms of use.

## View it
Just open `index.html` in a browser (double-click), or serve the folder.

## Iterate with Puppeteer
```powershell
# node must be on PATH (e.g. C:\Users\alberquej\AppData\Local\node-v24.18.0-win-x64)
node shot.js            # full page -> shots/dashboard.png, prints element checks
node shot.js --menu     # also captures the line-filter dropdown open
node shot.js --width 1600 --height 900
```
`shot.js` prints element counts (chips, pins, buildings, stat values) and fails
with exit code 1 on any page/console error, so a broken build is obvious.
