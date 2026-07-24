# GoRaleigh Live Bus Digital Twin

A single-page 3D web app that visualizes the City of Raleigh's GoRaleigh bus
network in real time — live vehicle positions, routes, stops, and downtown 3D
building context. Built on the [ArcGIS Maps SDK for JavaScript](https://developers.arcgis.com/javascript/)
(v4.33) and served as a static site (GitHub Pages, `gh-pages` branch).

## Features

- **Live buses** — realtime vehicle positions, auto-refreshed every 15 seconds,
  colored by route. Each vehicle is rendered as a single animated marker that
  **glides** smoothly from its last position to the newest reported position
  between refreshes (interpolated per frame), for a continuous "digital twin"
  feel instead of markers jumping. Respects `prefers-reduced-motion` (snaps
  instead of animating).
- **Routes & stops** — GoRaleigh route lines and bus stops, color-coded per route.
- **3D buildings** — downtown Raleigh buildings, with highlighting of every
  building within ¼ mile of a selected bus.
- **Route schematic** — an SVG "stick diagram" of stops along a route showing
  where each active bus sits (next stop, between stops, etc.).
- Route filter, "follow bus" camera tracking, downtown jump, and live stats.

## Running locally

It's a static site — serve the folder with any static file server, e.g.:

```powershell
npx serve .
# or
python -m http.server 8000
```

Then open the served `index.html`. No build step.

## Project layout

| Path | Purpose |
|------|---------|
| `index.html` | App shell; loads the ArcGIS SDK and `app11.js`. |
| `app11.js` | The application (the active script). |
| `styles.css` | Dark-themed UI styling. |
| `stops_schema.json` | **Reference artifact** — a saved copy of the Bus Stops feature-layer schema (fields, coded-value domains, per-route flags). Not loaded at runtime; the app reads field names live from the service via `resolveFieldName`. Kept for documentation of the stops data model. |
| `QA_Data/`, `QA_Data2/`, `Exceptions.gdb/` | Esri File Geodatabases + ArcGIS Pro projects used for data QA. Binary; git-ignored and not part of the deployed site (see below). |

## Configuration

All service URLs, portal item IDs, field names, camera positions, and tuning
constants (refresh interval, building-highlight radius, etc.) live in the
`CONFIG` object at the top of `app11.js`.

The app pulls from hosted ArcGIS feature services and portal items:
GoRaleigh routes, bus stops, realtime vehicles, and Raleigh 3D buildings.

## Note on the geodatabases

`QA_Data/`, `QA_Data2/`, and `Exceptions.gdb/` are binary QA data, not site
assets. They are listed in `.gitignore`. If they were already committed, stop
tracking them without deleting your local copies:

```
git rm -r --cached QA_Data QA_Data2 Exceptions.gdb
git commit -m "Stop tracking geodatabase QA data"
```
