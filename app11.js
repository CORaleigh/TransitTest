require([
  "esri/Map",
  "esri/views/SceneView",
  "esri/Graphic",
  "esri/layers/FeatureLayer",
  "esri/layers/GraphicsLayer",
  "esri/layers/SceneLayer",
  "esri/layers/support/LabelClass",
  "esri/renderers/UniqueValueRenderer",
  "esri/widgets/Legend",
  "esri/widgets/LayerList",
  "esri/widgets/Expand",
  "esri/geometry/Circle",
  "esri/geometry/geometryEngine",
  "esri/layers/support/FeatureFilter"
], (
  Map,
  SceneView,
  Graphic,
  FeatureLayer,
  GraphicsLayer,
  SceneLayer,
  LabelClass,
  UniqueValueRenderer,
  Legend,
  LayerList,
  Expand,
  Circle,
  geometryEngine,
  FeatureFilter
) => {
  const CONFIG = {
    camera: {
      position: { longitude: -78.6382, latitude: 35.7096, z: 4000 },
      tilt: 64,
      heading: 0
    },
    downtownCamera: {
      position: { longitude: -78.6381, latitude: 35.7624, z: 1000 },
      tilt: 60,
      heading: 0
    },
    routesUrl: "https://services.arcgis.com/v400IkDOw1ad7Yad/arcgis/rest/services/GoRaleigh_Routes/FeatureServer/0",
    stopsUrl: "https://services.arcgis.com/v400IkDOw1ad7Yad/arcgis/rest/services/GoRaleigh_BusStops/FeatureServer/0",
    realtimeVehiclesItemId: "5274781da96e4ea5bc512a99b5b4c509",
    buildingsItemId: "affa13965fe948cca694e356ef9a3004",
    refreshIntervalMinutes: 0.25,
    recentBusHours: 3,
    routeLineNameField: "full_name",
    routeIdField: "route_short_name",
    stopNameField: "Stop_Name",
    stopIdField: "Stop_ID",
    stopCodeField: "Stop_Code",
    vehicleRouteField: "trip_route_id",
    vehicleIdField: "vehicle_id",
    vehicleTimestampField: "vehicle_position_timestamp",
    vehicleStopField: "stop_id",
    vehicleStatusField: "current_status",
    vehicleBearingField: "bearing",
    vehicleSpeedField: "speed",
    buildingHighlightDistance: 1320, // feet, approximately 1/4 mile (0.25 * 5280 = 1320 feet)
    routeDirectionCueFeet: 2000,
    staleBusMinutes: 5 // a still-active bus older than this is flagged as stale
  };

  const reducedMotionQuery = globalThis.matchMedia
    ? globalThis.matchMedia("(prefers-reduced-motion: reduce)")
    : null;
  const prefersReducedMotion = () => Boolean(reducedMotionQuery?.matches);

  const $ = (id) => document.getElementById(id);

  let toastTimer = null;
  function showToast(message, { duration = 4000 } = {}) {
    const toast = $("toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("visible");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("visible"), duration);
  }

  const state = {
    selectedBusObjectId: null,
    selectedBusVehicleId: null,
    followingBus: false,
    lastSelectedBusLocation: null,
    currentRouteFilter: "",
    routeKeys: [],
    fields: {},
    highlightedBuildingIds: [],
    schematicRoute: null,
    schematicCache: null,
    schematicDismissed: false,
    stopNameById: null,
    selectedBuildings: [],
    liveFollowQueued: false,
    busArrivalAnimationFrame: null,
    busArrivalCueRequest: 0
  };

  const map = new Map({ basemap: "dark-gray-vector", ground: "world-elevation" });

  const view = new SceneView({
    container: "viewDiv",
    map,
    camera: CONFIG.camera,
    qualityProfile: "high",
    environment: {
      atmosphere: { quality: "high" },
      lighting: {
        directShadowsEnabled: true,
        ambientOcclusionEnabled: true,
        date: new Date()
      },
      starsEnabled: false
    },
    popup: { dockEnabled: false, collapseEnabled: false }
  });

  const routesLayer = new FeatureLayer({
    title: "GoRaleigh Routes",
    url: CONFIG.routesUrl,
    outFields: ["*"],
    elevationInfo: { mode: "on-the-ground" },
    popupTemplate: {
      title: "GoRaleigh Route",
      content: [{ type: "fields", fieldInfos: [
        { fieldName: "Line Name", label: "Route Name" },
        { fieldName: "Frequency", label: "Frequency" }
      ] }]
    }
  });

  const stopsLayer = new FeatureLayer({
    title: "GoRaleigh Stops",
    url: CONFIG.stopsUrl,
    outFields: ["*"],
    elevationInfo: { mode: "relative-to-ground", offset: 3 },
    renderer: {
      type: "simple",
      symbol: {
        type: "point-3d",
        symbolLayers: [{
          type: "icon",
          resource: { primitive: "circle" },
          size: 5,
          material: { color: [255, 255, 255, 0.7] },
          outline: { color: [40, 45, 56, 0.9], size: 1 }
        }]
      }
    },
    popupTemplate: { title: "Bus Stop", content: [{ type: "fields", fieldInfos: [
      {fieldName: "Stop_ID", label: "Stop_ID"}, {fieldName: "Stop_Name", label: "Stop Name"}
    ] }] }
  });

  const busesLayer = new FeatureLayer({
    title: "Live GoRaleigh Buses",
    portalItem: { id: CONFIG.realtimeVehiclesItemId },
    outFields: ["*"],
    elevationInfo: { mode: "relative-to-ground", offset: 24 },
    visible: false,
    listMode: "hide",
    popupTemplate: {
      title: "Live bus",
      content: [{ type: "fields", fieldInfos: [
        { fieldName: "trip_route_id", label: "Bus Route" },
        { fieldName: "vehicle_id", label: "Vehicle ID" },
        { fieldName: "vehicle_position_timestamp", label: "Update Time" },
        { fieldName: "stop_id", label: "Stop ID" },
        { fieldName: "current_status", label: "Current Status" }
      ] }]
    }
  });

  const buildingsLayer = new SceneLayer({
    title: "Raleigh 3D Buildings",
    portalItem: { id: CONFIG.buildingsItemId },
    popupEnabled: false,
    opacity: 0.82,
    renderer: defaultBuildingRenderer()
  });

  const buildingHighlightLayer = new SceneLayer({
    title: "Buildings within 1/4 mile",
    portalItem: { id: CONFIG.buildingsItemId },
    popupEnabled: false,
    opacity: 0.95,
    visible: false,
    definitionExpression: "1=0",
    renderer: highlightedBuildingRenderer()
  });

  const busArrivalPulseLayer = new GraphicsLayer({
    title: "Selected bus arrival cue",
    listMode: "hide",
    elevationInfo: { mode: "on-the-ground" }
  });

  // Smooth bus movement: instead of letting the realtime layer's markers jump to
  // each new reported position on every refresh, we draw one marker per vehicle in
  // this GraphicsLayer and glide it from its last drawn spot to the newest reported
  // spot over the refresh interval — the continuous "digital twin" feel of buses
  // rolling along their routes. (The realtime FeatureLayer stays loaded but hidden;
  // it is still queried for the authoritative positions that drive the animation.)
  const animatedBusLayer = new GraphicsLayer({
    title: "Live GoRaleigh Buses",
    elevationInfo: { mode: "relative-to-ground", offset: 24 }
  });

  map.addMany([buildingsLayer, buildingHighlightLayer, routesLayer, stopsLayer, busesLayer, animatedBusLayer, busArrivalPulseLayer]);

  const busAnimators = new globalThis.Map(); // vehicleId -> { icon, label, from, to, start, ... }
  const BUS_TWEEN_MS = Math.max(1, CONFIG.refreshIntervalMinutes * 60 * 1000);
  let busAnimationFrame = null;

  function busPointFromFeature(feature) {
    const geometry = feature?.geometry;
    if (!geometry || geometry.type !== "point") return null;
    return { x: geometry.x, y: geometry.y, sr: geometry.spatialReference };
  }

  function animatorPointNow(animator, now) {
    const t = BUS_TWEEN_MS > 0 ? Math.min(1, (now - animator.start) / BUS_TWEEN_MS) : 1;
    return {
      x: animator.from.x + (animator.to.x - animator.from.x) * t,
      y: animator.from.y + (animator.to.y - animator.from.y) * t
    };
  }

  function setAnimatorGeometry(animator, x, y) {
    const geometry = { type: "point", x, y, spatialReference: animator.sr };
    animator.icon.geometry = geometry;
    animator.label.geometry = geometry;
  }

  function busLabelSymbol(route) {
    return {
      type: "point-3d",
      verticalOffset: { screenLength: 96, maxWorldLength: 2200, minWorldLength: 60 },
      symbolLayers: [{
        type: "text",
        text: String(route ?? ""),
        material: { color: "#ffffff" },
        halo: { color: "#05070a", size: 1.5 },
        size: 10,
        font: { weight: "bold" }
      }]
    };
  }

  // Single rAF loop drives every marker. Each frame advances each animator toward
  // its target; the loop parks itself once all tweens have settled and is woken
  // again by ensureBusAnimationRunning() whenever new targets arrive.
  function tickBusAnimation() {
    const now = performance.now();
    const snap = prefersReducedMotion();
    let stillMoving = false;

    for (const animator of busAnimators.values()) {
      const t = snap || BUS_TWEEN_MS <= 0 ? 1 : Math.min(1, (now - animator.start) / BUS_TWEEN_MS);
      if (t < 1) stillMoving = true;
      const x = animator.from.x + (animator.to.x - animator.from.x) * t;
      const y = animator.from.y + (animator.to.y - animator.from.y) * t;
      setAnimatorGeometry(animator, x, y);
    }

    busAnimationFrame = stillMoving ? requestAnimationFrame(tickBusAnimation) : null;
  }

  function ensureBusAnimationRunning() {
    if (!busAnimationFrame) busAnimationFrame = requestAnimationFrame(tickBusAnimation);
  }

  function refreshBusSelectionStyles() {
    for (const animator of busAnimators.values()) {
      const selected = isSelectedBusFeature(animator.icon);
      if (selected === animator.selected) continue;
      animator.selected = selected;
      animator.icon.symbol = busSymbol(animator.color, selected);
    }
  }

  // Reconcile the animated markers with the latest deduped active-bus set: retarget
  // existing vehicles (gliding from where they are now), add new ones, drop missing.
  function updateAnimatedBuses(activeBuses) {
    const now = performance.now();
    const seen = new Set();

    for (const feature of activeBuses) {
      const vehicleId = String(safeAttr(feature, state.fields.vehicleId, "")).trim();
      const point = busPointFromFeature(feature);
      if (!vehicleId || !point) continue;
      seen.add(vehicleId);

      const route = routeKey(safeAttr(feature, state.fields.busRoute));
      const color = routeColor(route);
      let animator = busAnimators.get(vehicleId);

      if (!animator) {
        const geometry = { type: "point", x: point.x, y: point.y, spatialReference: point.sr };
        const icon = new Graphic({ geometry, symbol: busSymbol(color), attributes: { ...feature.attributes } });
        const label = new Graphic({ geometry, symbol: busLabelSymbol(route) });
        animatedBusLayer.addMany([icon, label]);
        animator = { icon, label, sr: point.sr, from: point, to: point, start: now, route, color, selected: false };
        busAnimators.set(vehicleId, animator);
      } else {
        animator.from = animatorPointNow(animator, now);
        animator.to = { x: point.x, y: point.y };
        animator.start = now;
        animator.sr = point.sr;
        animator.icon.attributes = { ...feature.attributes };
        if (animator.route !== route) {
          animator.route = route;
          animator.color = color;
          animator.label.symbol = busLabelSymbol(route);
          animator.icon.symbol = busSymbol(color, animator.selected);
        }
      }
    }

    for (const [vehicleId, animator] of busAnimators) {
      if (seen.has(vehicleId)) continue;
      animatedBusLayer.removeMany([animator.icon, animator.label]);
      busAnimators.delete(vehicleId);
    }

    refreshBusSelectionStyles();
    ensureBusAnimationRunning();
  }

  // Create schematic diagram container
  const schematicContainer = document.createElement("div");
  schematicContainer.id = "schematicDiagram";
  schematicContainer.style.cssText = `
    position: absolute;
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(30, 30, 30, 0.95);
    border: 1px solid #4a9eff;
    border-radius: 8px;
    padding: 15px;
    max-width: 800px;
    z-index: 100;
    display: none;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
  `;
  schematicContainer.innerHTML = `
    <div style="color: #fff; font-size: 12px; margin-bottom: 10px; font-weight: bold;">
      Route Schematic Diagram
      <button id="closeSchematic" style="float: right; background: none; border: none; color: #fff; cursor: pointer; font-size: 16px;">×</button>
    </div>
    <svg id="schematiCanvas" width="750" height="150" style="background: #1a1a1a; border-radius: 4px; border: 1px solid #333;"></svg>
  `;
  document.body.appendChild(schematicContainer);

  // Close schematic button
  document.getElementById("closeSchematic").addEventListener("click", () => {
    // Dismiss until the route filter changes, so periodic refreshes don't reopen it.
    state.schematicDismissed = true;
    schematicContainer.style.display = "none";
  });

  function safeAttr(graphic, fieldName, fallback = "") {
    if (!graphic?.attributes || !fieldName) return fallback;
    const value = graphic.attributes[fieldName];
    return value === null || value === undefined || value === "" ? fallback : value;
  }

  function resolveFieldName(layer, candidates) {
    const names = layer?.fields?.map((field) => field.name) || [];
    const options = Array.isArray(candidates) ? candidates : [candidates];
    for (const candidate of options.filter(Boolean)) {
      const match = names.find((name) => name.toLowerCase() === String(candidate).toLowerCase());
      if (match) return match;
    }
    return options.find(Boolean) || "";
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;"
    }[char]));
  }

  function escapeSql(value) {
    return String(value).replaceAll("'", "''");
  }

  function timestampToMs(value) {
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

  function formatValue(value) {
    if (value === null || value === undefined || value === "") return "--";
    const dateMs = timestampToMs(value);
    return dateMs ? new Date(dateMs).toLocaleString() : String(value);
  }

  function relativeTime(value) {
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

  function isStaleTimestamp(value) {
    const ms = timestampToMs(value);
    if (!ms) return false;
    return Date.now() - ms > CONFIG.staleBusMinutes * 60 * 1000;
  }

  function routeKey(value) {
    return String(value ?? "").trim().split(/\s+/)[0] || "";
  }

  function routeNumber(value) {
    const key = routeKey(value);
    const num = Number(key);
    return Number.isFinite(num) ? num : null;
  }

  function sortActiveBuses(features) {
    return [...features].sort((a, b) => {
      const routeA = routeKey(safeAttr(a, state.fields.busRoute));
      const routeB = routeKey(safeAttr(b, state.fields.busRoute));
      const numA = routeNumber(routeA);
      const numB = routeNumber(routeB);

      if (numA !== null && numB !== null && numA !== numB) return numA - numB;
      if (numA !== null) return -1;
      if (numB !== null) return 1;

      const routeCompare = routeA.localeCompare(routeB, undefined, { numeric: true, sensitivity: "base" });
      if (routeCompare !== 0) return routeCompare;

      const vehicleA = String(safeAttr(a, state.fields.vehicleId, ""));
      const vehicleB = String(safeAttr(b, state.fields.vehicleId, ""));
      return vehicleA.localeCompare(vehicleB, undefined, { numeric: true, sensitivity: "base" });
    });
  }

  function recentCutoffMs() {
    return Date.now() - CONFIG.recentBusHours * 60 * 60 * 1000;
  }

  function timestampFieldType() {
    return busesLayer.fields?.find((field) => field.name === state.fields.vehicleTimestamp)?.type;
  }

  function arcgisTimestampLiteral(ms) {
    const utcText = new Date(ms).toISOString().slice(0, 19).replace("T", " ");
    return `TIMESTAMP '${utcText}'`;
  }

  function recentBusWhere() {
    const field = state.fields.vehicleTimestamp;
    if (!field) return "1=1";

    const cutoffMs = recentCutoffMs();
    const cutoffSeconds = Math.floor(cutoffMs / 1000);
    const fieldType = timestampFieldType();

    if (fieldType === "date") {
      return `${field} >= ${arcgisTimestampLiteral(cutoffMs)}`;
    }

    if (["integer", "small-integer"].includes(fieldType)) {
      return `${field} >= ${cutoffSeconds}`;
    }

    if (["big-integer", "double", "single", "long"].includes(fieldType)) {
      return `(${field} >= ${cutoffMs} OR (${field} < 100000000000 AND ${field} >= ${cutoffSeconds}))`;
    }

    return `${field} IS NOT NULL`;
  }

  function isActiveBus(feature) {
    const route = routeKey(safeAttr(feature, state.fields.busRoute));
    const vehicle = safeAttr(feature, state.fields.vehicleId);
    const timestamp = timestampToMs(safeAttr(feature, state.fields.vehicleTimestamp));
    return Boolean(route) && Boolean(vehicle) && Boolean(timestamp) && timestamp >= recentCutoffMs();
  }

  function baseBusWhere() {
    const clauses = ["1=1"];
    if (state.fields.busRoute) clauses.push(`${state.fields.busRoute} IS NOT NULL`);
    if (state.fields.vehicleId) clauses.push(`${state.fields.vehicleId} IS NOT NULL`);
    if (state.fields.vehicleTimestamp) clauses.push(recentBusWhere());
    return clauses.join(" AND ");
  }

  function selectedBusWhere(route) {
    if (!route || !state.fields.busRoute) return baseBusWhere();
    return `${baseBusWhere()} AND ${state.fields.busRoute} = '${escapeSql(route)}'`;
  }

  function selectedRouteWhere(route) {
    if (!route) return "1=1";
    if (state.fields.routeLineName) {
      const escaped = escapeSql(route);
      return `${state.fields.routeLineName} = '${escaped}' OR ${state.fields.routeLineName} LIKE '${escaped} %'`;
    }
    return state.fields.routeId ? `${state.fields.routeId} = '${escapeSql(route)}'` : "1=1";
  }

  function routeColor(route) {
    const palette = [
      "#19b5fe", "#f6c85f", "#6acc64", "#ff6b6b", "#b084f5",
      "#4ecdc4", "#f9844a", "#90be6d", "#43aa8b", "#577590",
      "#f3722c", "#277da1", "#f9c74f", "#c77dff", "#00bbf9"
    ];
    let hash = 0;
    for (const char of String(route || "0")) hash = ((hash << 5) - hash) + char.charCodeAt(0);
    return palette[Math.abs(hash) % palette.length];
  }

  function makeLineSymbol(color, size = 6, opacity = 0.88) {
    return {
      type: "line-3d",
      symbolLayers: [{
        type: "line",
        size,
        material: { color: hexToRgba(color, opacity) }
      }]
    };
  }

  function hexToRgba(hex, alpha = 1) {
    const clean = hex.replace("#", "");
    return [
      parseInt(clean.slice(0, 2), 16),
      parseInt(clean.slice(2, 4), 16),
      parseInt(clean.slice(4, 6), 16),
      alpha
    ];
  }

  function busSymbol(color, selected = false) {
    return {
      type: "point-3d",
      verticalOffset: { screenLength: 70, maxWorldLength: 2000, minWorldLength: 40 },
      callout: {
        type: "line",
        size: 1.5,
        color: [255, 255, 255, 0.72],
        border: { color: [5, 7, 10, 0.55] }
      },
      symbolLayers: [{
        type: "icon",
        resource: { href: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(busSvg(color, selected))}` },
        size: selected ? 38 : 30
      }]
    };
  }

  function busSvg(color, selected = false) {
    const ring = selected ? "#32e875" : "#05070a";
    const ringWidth = selected ? 6 : 4;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="30" fill="${color}" stroke="${ring}" stroke-width="${ringWidth}"/><path d="M18 21c0-4 3-7 7-7h14c4 0 7 3 7 7v20c0 3-2 5-5 5l3 4v2h-5l-4-5H29l-4 5h-5v-2l3-4c-3 0-5-2-5-5V21zm6 3v10h16V24H24zm2 16a4 4 0 100 8 4 4 0 000-8zm16 0a4 4 0 100 8 4 4 0 000-8z" fill="#05070a"/></svg>`;
  }

  function makeBuildingSymbol(faceColor, edgeColor, edgeSize = 1.2) {
    return {
      type: "mesh-3d",
      symbolLayers: [{
        type: "fill",
        material: { color: faceColor },
        edges: { type: "solid", color: edgeColor, size: edgeSize }
      }]
    };
  }

  function defaultBuildingRenderer() {
    return {
      type: "simple",
      symbol: makeBuildingSymbol([8, 135, 160, 0.4], [8, 135, 160, 1], 1.2)
    };
  }

  function highlightedBuildingRenderer() {
    return {
      type: "simple",
      symbol: makeBuildingSymbol([70, 255, 110, 0.38], [0, 220, 70, 1], 2)
    };
  }

  function objectIdWhereClause(objectIdField, objectIds) {
    if (!objectIdField || !objectIds.length) return "1=0";

    const values = objectIds.map((id) => {
      const text = String(id).trim();
      return /^-?\d+$/.test(text) ? text : `'${escapeSql(text)}'`;
    });

    return `${objectIdField} IN (${values.join(",")})`;
  }

  function fieldEqualsWhereClause(layer, fieldName, value) {
    const field = layer?.fields?.find((item) => item.name.toLowerCase() === String(fieldName).toLowerCase());
    const text = String(value ?? "").trim();
    const numericTypes = ["oid", "integer", "small-integer", "big-integer", "double", "single", "long"];
    if (numericTypes.includes(field?.type) && /^-?\d+(\.\d+)?$/.test(text)) {
      return `${fieldName} = ${text}`;
    }
    return `${fieldName} = '${escapeSql(text)}'`;
  }

  function useViewSpatialReference(query) {
    if (view?.spatialReference) query.outSpatialReference = view.spatialReference;
    return query;
  }

  function pointXY(geometry) {
    if (!geometry || typeof geometry.x !== "number" || typeof geometry.y !== "number") return null;
    return [geometry.x, geometry.y];
  }

  function segmentProjection(point, start, end) {
    const ax = Number(start?.[0]);
    const ay = Number(start?.[1]);
    const bx = Number(end?.[0]);
    const by = Number(end?.[1]);
    if (![ax, ay, bx, by].every(Number.isFinite)) return null;

    const vx = bx - ax;
    const vy = by - ay;
    const wx = point[0] - ax;
    const wy = point[1] - ay;
    const lengthSquared = vx * vx + vy * vy;

    if (lengthSquared === 0) {
      const dx = point[0] - ax;
      const dy = point[1] - ay;
      return { t: 0, distanceSquared: dx * dx + dy * dy, segmentLength: 0 };
    }

    const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / lengthSquared));
    const projectedX = ax + t * vx;
    const projectedY = ay + t * vy;
    const dx = point[0] - projectedX;
    const dy = point[1] - projectedY;

    return {
      t,
      distanceSquared: dx * dx + dy * dy,
      segmentLength: Math.sqrt(lengthSquared)
    };
  }

  function polylineLength(geometry) {
    let length = 0;
    for (const path of geometry?.paths || []) {
      for (let i = 0; i < path.length - 1; i++) {
        const projection = segmentProjection([path[i][0], path[i][1]], path[i], path[i + 1]);
        if (projection) length += projection.segmentLength;
      }
    }
    return length;
  }

  function routeMeasureAtPoint(routeGeometry, pointGeometry) {
    const point = pointXY(pointGeometry);
    if (!point || !routeGeometry?.paths?.length) return null;

    let lengthBeforeSegment = 0;
    let best = null;

    for (const path of routeGeometry.paths) {
      for (let i = 0; i < path.length - 1; i++) {
        const projection = segmentProjection(point, path[i], path[i + 1]);
        if (!projection) continue;

        const measure = lengthBeforeSegment + projection.segmentLength * projection.t;
        if (!best || projection.distanceSquared < best.distanceSquared) {
          best = {
            measure,
            distanceSquared: projection.distanceSquared
          };
        }

        lengthBeforeSegment += projection.segmentLength;
      }
    }

    return best ? { ...best, totalLength: lengthBeforeSegment } : null;
  }

  function routeSegmentAtMeasure(routeGeometry, measure) {
    if (!routeGeometry?.paths?.length || !Number.isFinite(measure)) return null;

    let lengthBeforeSegment = 0;
    let lastSegment = null;
    const targetMeasure = Math.max(0, measure);

    for (const path of routeGeometry.paths) {
      for (let i = 0; i < path.length - 1; i++) {
        const start = path[i];
        const end = path[i + 1];
        const ax = Number(start?.[0]);
        const ay = Number(start?.[1]);
        const bx = Number(end?.[0]);
        const by = Number(end?.[1]);
        if (![ax, ay, bx, by].every(Number.isFinite)) continue;

        const dx = bx - ax;
        const dy = by - ay;
        const segmentLength = Math.hypot(dx, dy);
        if (segmentLength <= 0) continue;

        const segment = {
          start: [ax, ay],
          end: [bx, by],
          length: segmentLength,
          startMeasure: lengthBeforeSegment,
          endMeasure: lengthBeforeSegment + segmentLength
        };
        lastSegment = segment;

        if (targetMeasure <= segment.endMeasure) {
          return {
            ...segment,
            t: Math.max(0, Math.min(1, (targetMeasure - segment.startMeasure) / segment.length))
          };
        }

        lengthBeforeSegment = segment.endMeasure;
      }
    }

    return lastSegment ? { ...lastSegment, t: 1 } : null;
  }

  function pointAtRouteMeasure(routeGeometry, measure) {
    const segment = routeSegmentAtMeasure(routeGeometry, measure);
    if (!segment) return null;

    return {
      type: "point",
      x: segment.start[0] + (segment.end[0] - segment.start[0]) * segment.t,
      y: segment.start[1] + (segment.end[1] - segment.start[1]) * segment.t,
      spatialReference: routeGeometry.spatialReference
    };
  }

  function bearingVector(bearing) {
    const value = Number(bearing);
    if (!Number.isFinite(value)) return null;

    const radians = value * Math.PI / 180;
    return [Math.sin(radians), Math.cos(radians)];
  }

  function routeDirectionSign(routeGeometry, measure, bearing) {
    const segment = routeSegmentAtMeasure(routeGeometry, measure);
    const bearingDirection = bearingVector(bearing);
    if (!segment || !bearingDirection) return 1;

    const routeX = (segment.end[0] - segment.start[0]) / segment.length;
    const routeY = (segment.end[1] - segment.start[1]) / segment.length;
    return routeX * bearingDirection[0] + routeY * bearingDirection[1] >= 0 ? 1 : -1;
  }

  function nearestStopIndex(stops, pointGeometry) {
    const point = pointXY(pointGeometry);
    if (!point) return 0;

    let closestIndex = 0;
    let closestDistance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < stops.length; i++) {
      const stopPoint = pointXY(stops[i].geometry);
      if (!stopPoint) continue;
      const dx = stopPoint[0] - point[0];
      const dy = stopPoint[1] - point[1];
      const distance = dx * dx + dy * dy;
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = i;
      }
    }
    return closestIndex;
  }

  function normalizeStopId(value) {
    if (value === null || value === undefined || value === "") return "";
    const text = String(value).trim();
    if (!text) return "";
    return /^\d+(\.0+)?$/.test(text) ? String(Number.parseInt(text, 10)) : text.toLowerCase();
  }

  function stopIdValues(stop) {
    return [
      state.fields.stopId,
      state.fields.stopCode,
      "Stop_ID",
      "Stop_Code",
      "stop_id",
      "stop_code"
    ]
      .map((fieldName) => normalizeStopId(safeAttr(stop, fieldName)))
      .filter(Boolean);
  }

  function stopIndexById(stops, stopId) {
    const normalizedStopId = normalizeStopId(stopId);
    if (!normalizedStopId) return -1;
    return stops.findIndex((stop) => stopIdValues(stop).includes(normalizedStopId));
  }

  function stopSequenceLabel(index) {
    return index >= 0 ? `S${index + 1}` : "";
  }

  function stopDisplayName(stop, index) {
    const name = safeAttr(stop, state.fields.stopName, "");
    const stopId = safeAttr(stop, state.fields.stopId, "") || safeAttr(stop, state.fields.stopCode, "");
    if (name) return `${stopSequenceLabel(index)} ${name}`;
    if (stopId) return `${stopSequenceLabel(index)} Stop ${stopId}`;
    return stopSequenceLabel(index);
  }

  function busStatusText(status) {
    const value = String(status ?? "").trim().toLowerCase();
    if (value === "1" || value.includes("stopped")) return "at";
    if (value === "2" || value.includes("transit")) return "to";
    if (value === "0" || value.includes("incoming")) return "near";
    return "near";
  }

  function isStoppedStatus(status) {
    const value = String(status ?? "").trim().toLowerCase();
    return value === "1" || value.includes("stopped");
  }

  function setRouteRenderer(routes) {
    const routeField = state.fields.routeLineName || state.fields.routeId;
    if (!routeField) {
      routesLayer.renderer = null;
      return;
    }

    const valueExpression = `var n = $feature['${routeField}']; return IIF(IsEmpty(n), '', Split(n, ' ')[0]);`;

    routesLayer.renderer = new UniqueValueRenderer({
      valueExpression,
      defaultSymbol: makeLineSymbol("#8fd7ff", 4, 0.32),
      uniqueValueInfos: routes.map((route) => ({
        value: route,
        label: route,
        symbol: makeLineSymbol(routeColor(route), 6, 0.9)
      }))
    });
  }

  // The realtime feed keeps several rows per vehicle (one per reported position
  // in the recent window), so the same bus would otherwise be counted, carded,
  // schematized, and drawn many times. Collapse to one feature per vehicle_id,
  // keeping the newest report (tie-break on the highest objectId).
  function dedupeLatestByVehicle(features) {
    const latestByVehicle = new globalThis.Map();
    for (const feature of features) {
      const vehicleId = String(safeAttr(feature, state.fields.vehicleId, "")).trim();
      if (!vehicleId) continue;

      const timestamp = timestampToMs(safeAttr(feature, state.fields.vehicleTimestamp)) ?? 0;
      const objectId = Number(selectedBusObjectId(feature)) || 0;
      const existing = latestByVehicle.get(vehicleId);

      if (!existing ||
          timestamp > existing.timestamp ||
          (timestamp === existing.timestamp && objectId > existing.objectId)) {
        latestByVehicle.set(vehicleId, { feature, timestamp, objectId });
      }
    }
    return [...latestByVehicle.values()].map((entry) => entry.feature);
  }

  async function queryActiveBuses(where = null) {
    const query = busesLayer.createQuery();
    query.where = where || busesLayer.definitionExpression || baseBusWhere();
    query.outFields = ["*"];
    query.returnGeometry = true;
    query.num = 2000;
    query.orderByFields = [state.fields.busRoute, state.fields.vehicleId].filter(Boolean);

    const result = await busesLayer.queryFeatures(useViewSpatialReference(query));
    return sortActiveBuses(dedupeLatestByVehicle(result.features.filter(isActiveBus)));
  }

  function selectedBusObjectId(feature) {
    return feature?.attributes?.[busesLayer.objectIdField];
  }

  function selectedBusVehicleId(feature) {
    return safeAttr(feature, state.fields.vehicleId, "");
  }

  function hasSelectedBus() {
    return Boolean(state.selectedBusObjectId || state.selectedBusVehicleId);
  }

  function isSelectedBusFeature(feature) {
    const objectId = selectedBusObjectId(feature);
    const vehicleId = selectedBusVehicleId(feature);
    return Boolean(
      (state.selectedBusVehicleId && String(vehicleId) === String(state.selectedBusVehicleId)) ||
      (state.selectedBusObjectId && String(objectId) === String(state.selectedBusObjectId))
    );
  }

  function rememberSelectedBus(feature) {
    if (!feature) return;
    const objectId = selectedBusObjectId(feature);
    const vehicleId = selectedBusVehicleId(feature);
    if (objectId !== null && objectId !== undefined && objectId !== "") state.selectedBusObjectId = objectId;
    if (vehicleId !== null && vehicleId !== undefined && vehicleId !== "") state.selectedBusVehicleId = vehicleId;
  }

  function selectedBusFromFeatures(features) {
    return features.find((feature) => isSelectedBusFeature(feature)) || null;
  }

  async function querySelectedBus() {
    if (!hasSelectedBus()) return null;

    const whereParts = [baseBusWhere()];
    if (state.selectedBusVehicleId && state.fields.vehicleId) {
      whereParts.push(fieldEqualsWhereClause(busesLayer, state.fields.vehicleId, state.selectedBusVehicleId));
    } else if (state.selectedBusObjectId && busesLayer.objectIdField) {
      whereParts.push(fieldEqualsWhereClause(busesLayer, busesLayer.objectIdField, state.selectedBusObjectId));
    }

    const query = busesLayer.createQuery();
    query.where = whereParts.join(" AND ");
    query.outFields = ["*"];
    query.returnGeometry = true;
    query.num = 3;

    const result = await busesLayer.queryFeatures(useViewSpatialReference(query));
    return dedupeLatestByVehicle(result.features.filter(isActiveBus))[0] || null;
  }

  function clearSelectedBus() {
    state.selectedBusObjectId = null;
    state.selectedBusVehicleId = null;
    state.lastSelectedBusLocation = null;
  }

  async function clearBuildingHighlight() {
    buildingHighlightLayer.visible = false;
    buildingHighlightLayer.definitionExpression = "1=0";
    state.highlightedBuildingIds = [];
    state.selectedBuildings = [];
  }

  async function queryBuildingsWithin(searchArea) {
    const query = buildingsLayer.createQuery();
    query.geometry = searchArea;
    query.spatialRelationship = "intersects";
    if (buildingsLayer.objectIdField) query.outFields = [buildingsLayer.objectIdField];
    query.returnGeometry = false;
    query.num = 2000;

    try {
      return await buildingsLayer.queryFeatures(query);
    } catch (error) {
      console.warn("Lean building query failed, retrying with full fields.", error);
      const fallbackQuery = buildingsLayer.createQuery();
      fallbackQuery.geometry = searchArea;
      fallbackQuery.spatialRelationship = "intersects";
      fallbackQuery.outFields = ["*"];
      fallbackQuery.returnGeometry = true;
      fallbackQuery.num = 2000;
      return buildingsLayer.queryFeatures(fallbackQuery);
    }
  }

  async function highlightBuildingsNearBus(busGeometry) {
    if (!busGeometry || !buildingsLayer) return;

    try {
      // Clear previous highlights
      await clearBuildingHighlight();

      // Convert feet to meters (1/4 mile = 1320 feet = 402.336 meters)
      const distanceInMeters = CONFIG.buildingHighlightDistance * 0.3048;

      // Create a circle around the selected bus location. Geodesic, because a
      // planar circle in Web Mercator shrinks to ~81% of its ground radius here.
      const searchArea = new Circle({
        center: busGeometry,
        geodesic: true,
        radius: distanceInMeters,
        radiusUnit: "meters"
      });

      const result = await queryBuildingsWithin(searchArea);

      if (result.features.length > 0) {
        const objectIdField = buildingsLayer.objectIdField;
        state.selectedBuildings = result.features;
        state.highlightedBuildingIds = [...new Set(result.features
          .map((feature) => feature.attributes?.[objectIdField])
          .filter((id) => id !== null && id !== undefined))];

        buildingHighlightLayer.definitionExpression = objectIdWhereClause(objectIdField, state.highlightedBuildingIds);
        buildingHighlightLayer.visible = state.highlightedBuildingIds.length > 0;
      }
    } catch (error) {
      console.error("Error highlighting buildings:", error);
    }
  }

  // Route geometry and stop ordering are static per route; only bus positions
  // change between refreshes, so cache the expensive query/sort work by route.
  async function getSchematicRouteData(route) {
    if (state.schematicCache && state.schematicCache.route === route) {
      return state.schematicCache;
    }

    // Query the selected route geometry first
    const routeQuery = routesLayer.createQuery();
    routeQuery.where = selectedRouteWhere(route);
    routeQuery.returnGeometry = true;
    routeQuery.outFields = ["*"];
    routeQuery.num = 50;

    const routeResult = await routesLayer.queryFeatures(useViewSpatialReference(routeQuery));
    const routeFeature = routeResult.features[0];
    if (!routeFeature?.geometry) {
      console.log("No route geometry found for route:", route);
      return null;
    }

    const routeGeometry = routeFeature.geometry;
    const routeBuffer = geometryEngine.geodesicBuffer(routeGeometry, 200, "meters");

    // Query stops that fall along or near the selected route
    const stopsQuery = stopsLayer.createQuery();
    stopsQuery.geometry = routeBuffer;
    stopsQuery.spatialRelationship = "intersects";
    stopsQuery.outFields = ["*"];
    stopsQuery.returnGeometry = true;
    stopsQuery.num = 1000;

    const stopsResult = await stopsLayer.queryFeatures(useViewSpatialReference(stopsQuery));
    let routeStops = stopsResult.features;

    if (!routeStops.length) {
      console.log("No stops found near route geometry, falling back to all stops.");
      const fallbackQuery = stopsLayer.createQuery();
      fallbackQuery.where = "1=1";
      fallbackQuery.outFields = ["*"];
      fallbackQuery.returnGeometry = true;
      fallbackQuery.num = 500;
      const fallbackResult = await stopsLayer.queryFeatures(useViewSpatialReference(fallbackQuery));
      routeStops = fallbackResult.features;
    }

    if (!routeStops.length) {
      console.log("No stops found for route:", route);
      return null;
    }

    const routeLength = polylineLength(routeGeometry);
    const routeStopsWithOrder = routeStops.map((stop) => {
      const routePosition = routeMeasureAtPoint(routeGeometry, stop.geometry);
      const order = routePosition?.measure;
      return {
        stop,
        order: Number.isFinite(order) ? order : null
      };
    });

    routeStopsWithOrder.sort((a, b) => {
      if (a.order !== null && b.order !== null && a.order !== b.order) return a.order - b.order;
      if (a.order !== null) return -1;
      if (b.order !== null) return 1;
      return (a.stop.geometry?.x || 0) - (b.stop.geometry?.x || 0) || (a.stop.geometry?.y || 0) - (b.stop.geometry?.y || 0);
    });

    const orderedStops = routeStopsWithOrder.map((item) => item.stop);
    const stopMeasures = routeStopsWithOrder.map((item, index) => {
      if (Number.isFinite(item.order)) return item.order;
      return routeStopsWithOrder.length > 1 && routeLength > 0
        ? (index / (routeStopsWithOrder.length - 1)) * routeLength
        : 0;
    });

    state.schematicCache = { route, routeGeometry, routeLength, routeStops: orderedStops, stopMeasures };
    return state.schematicCache;
  }

  async function drawSchematicDiagram(route) {
    if (!route || state.schematicDismissed) {
      document.getElementById("schematicDiagram").style.display = "none";
      return;
    }

    try {
      const routeData = await getSchematicRouteData(route);
      if (!routeData) {
        document.getElementById("schematicDiagram").style.display = "none";
        return;
      }

      const { routeGeometry, routeLength, routeStops, stopMeasures } = routeData;

      // Query all active buses, then keep the selected route for the schematic.
      const activeBusesForSchematic = await queryActiveBuses(baseBusWhere());
      const routeBuses = activeBusesForSchematic.filter((feature) =>
        routeKey(safeAttr(feature, state.fields.busRoute)) === route && feature.geometry
      );

      const stopSpanForMeasure = (measure) => {
        if (!Number.isFinite(measure) || !stopMeasures.length) return null;
        if (stopMeasures.length === 1 || measure <= stopMeasures[0]) {
          return { fromIndex: 0, toIndex: 0 };
        }

        const lastIndex = stopMeasures.length - 1;
        if (measure >= stopMeasures[lastIndex]) {
          return { fromIndex: lastIndex, toIndex: lastIndex };
        }

        for (let i = 0; i < stopMeasures.length - 1; i++) {
          const startMeasure = stopMeasures[i];
          const endMeasure = stopMeasures[i + 1];
          if (measure < startMeasure || measure > endMeasure) continue;
          return { fromIndex: i, toIndex: i + 1 };
        }

        return null;
      };

      const routeBusPlacements = routeBuses.map((bus) => {
        const routePosition = routeMeasureAtPoint(routeGeometry, bus.geometry);
        const reportedStopIndex = stopIndexById(routeStops, safeAttr(bus, state.fields.vehicleStop));
        const closestStopIndex = nearestStopIndex(routeStops, bus.geometry);
        return {
          bus,
          measure: routePosition?.measure,
          reportedStopIndex,
          closestStopIndex,
          stopSpan: stopSpanForMeasure(routePosition?.measure),
          stackIndex: 0,
          x: null,
          relation: ""
        };
      });

      // Create SVG schematic
      const svg = document.getElementById("schematiCanvas");
      svg.innerHTML = ""; // Clear previous

      const padding = 20;
      const canvasWidth = Number(svg.getAttribute("width"));
      const usableWidth = canvasWidth - 2 * padding;
      const stopRadius = 4;

      const stopCount = routeStops.length;
      const stopSpacing = stopCount > 1 ? usableWidth / (stopCount - 1) : usableWidth / 2;
      const stopX = (index) => stopCount > 1 ? padding + index * stopSpacing : canvasWidth / 2;
      const routeXForMeasure = (measure) => {
        const ratio = routeLength > 0 ? measure / routeLength : 0;
        const x = padding + Math.max(0, Math.min(1, ratio)) * usableWidth;
        return Math.max(padding, Math.min(canvasWidth - padding, x));
      };

      const schematicXForPlacement = (placement) => {
        const measure = placement.measure;
        if (!Number.isFinite(measure) || stopMeasures.length === 0 || routeLength <= 0) {
          const fallbackIndex = placement.reportedStopIndex >= 0
            ? placement.reportedStopIndex
            : placement.closestStopIndex;
          return stopX(fallbackIndex >= 0 ? fallbackIndex : 0);
        }
        if (stopMeasures.length === 1 || measure <= stopMeasures[0]) return routeXForMeasure(measure);
        const lastIndex = stopMeasures.length - 1;
        if (measure >= stopMeasures[lastIndex]) return routeXForMeasure(measure);

        for (let i = 0; i < stopMeasures.length - 1; i++) {
          const startMeasure = stopMeasures[i];
          const endMeasure = stopMeasures[i + 1];
          if (measure < startMeasure || measure > endMeasure) continue;

          const denominator = endMeasure - startMeasure;
          const ratio = denominator > 0 ? (measure - startMeasure) / denominator : 0;
          return stopX(i) + ratio * (stopX(i + 1) - stopX(i));
        }

        return routeXForMeasure(measure);
      };

      const relationForPlacement = (placement) => {
        if (placement.reportedStopIndex >= 0) {
          const prefix = busStatusText(safeAttr(placement.bus, state.fields.vehicleStatus));
          return `${prefix} ${stopSequenceLabel(placement.reportedStopIndex)}`;
        }

        if (placement.stopSpan) {
          const { fromIndex, toIndex } = placement.stopSpan;
          if (fromIndex === toIndex) return `near ${stopSequenceLabel(fromIndex)}`;
          return `${stopSequenceLabel(fromIndex)}-${stopSequenceLabel(toIndex)}`;
        }

        return placement.closestStopIndex >= 0
          ? `near ${stopSequenceLabel(placement.closestStopIndex)}`
          : "on route";
      };

      const nextStopIndexForPlacement = (placement) => {
        const lastIndex = stopCount - 1;
        if (lastIndex < 0) return -1;

        if (placement.reportedStopIndex >= 0) {
          return isStoppedStatus(safeAttr(placement.bus, state.fields.vehicleStatus))
            ? Math.min(placement.reportedStopIndex + 1, lastIndex)
            : placement.reportedStopIndex;
        }

        if (Number.isFinite(placement.measure) && stopMeasures.length) {
          for (let i = 0; i < stopMeasures.length; i++) {
            if (placement.measure <= stopMeasures[i]) return i;
          }
          return lastIndex;
        }

        if (placement.stopSpan) return placement.stopSpan.toIndex;
        return placement.closestStopIndex >= 0 ? placement.closestStopIndex : -1;
      };

      const stacksBySlot = new globalThis.Map();
      for (const placement of routeBusPlacements) {
        placement.x = schematicXForPlacement(placement);
        placement.relation = relationForPlacement(placement);
        placement.nextStopIndex = nextStopIndexForPlacement(placement);
        const stackKey = Math.round(placement.x / 16);
        const currentStack = stacksBySlot.get(stackKey) || 0;
        placement.stackIndex = currentStack;
        stacksBySlot.set(stackKey, currentStack + 1);
      }

      const nextStopVehicles = new globalThis.Map();
      for (const placement of routeBusPlacements) {
        if (placement.nextStopIndex < 0) continue;
        const vehicles = nextStopVehicles.get(placement.nextStopIndex) || [];
        vehicles.push(safeAttr(placement.bus, state.fields.vehicleId, "?"));
        nextStopVehicles.set(placement.nextStopIndex, vehicles);
      }

      const maxStackCount = Math.max(1, ...stacksBySlot.values());
      const busLaneCount = Math.min(maxStackCount, 6);
      const busLaneHeight = 16;
      const canvasHeight = Math.max(150, 112 + busLaneCount * busLaneHeight);
      const lineY = 42 + busLaneCount * busLaneHeight;
      svg.setAttribute("height", String(canvasHeight));

      // Draw line connecting stops
      const pathData = `M ${stopX(0)},${lineY} L ${stopX(stopCount - 1)},${lineY}`;

      const line = document.createElementNS("http://www.w3.org/2000/svg", "path");
      line.setAttribute("d", pathData);
      line.setAttribute("stroke", "#4a9eff");
      line.setAttribute("stroke-width", "2");
      line.setAttribute("fill", "none");
      svg.appendChild(line);

      // Draw stops as circles
      for (let i = 0; i < stopCount; i++) {
        const x = stopX(i);
        const y = lineY;
        const nextStopVehicleIds = nextStopVehicles.get(i) || [];
        const isNextStop = nextStopVehicleIds.length > 0;
        const isSelectedNextStop = routeBusPlacements.some((placement) =>
          placement.nextStopIndex === i && isSelectedBusFeature(placement.bus)
        );

        const stopGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
        const stopTitle = document.createElementNS("http://www.w3.org/2000/svg", "title");
        stopTitle.textContent = `${stopDisplayName(routeStops[i], i)}${isNextStop ? ` - next stop for vehicle${nextStopVehicleIds.length === 1 ? "" : "s"} ${nextStopVehicleIds.join(", ")}` : ""}`;
        stopGroup.appendChild(stopTitle);

        if (isNextStop) {
          const ring = document.createElementNS("http://www.w3.org/2000/svg", "circle");
          ring.setAttribute("cx", x);
          ring.setAttribute("cy", y);
          ring.setAttribute("r", isSelectedNextStop ? stopRadius + 6 : stopRadius + 4);
          ring.setAttribute("fill", "none");
          ring.setAttribute("stroke", "#32e875");
          ring.setAttribute("stroke-width", isSelectedNextStop ? "2.5" : "1.8");
          ring.setAttribute("opacity", isSelectedNextStop ? "0.95" : "0.8");
          stopGroup.appendChild(ring);
        }

        const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        circle.setAttribute("cx", x);
        circle.setAttribute("cy", y);
        circle.setAttribute("r", stopRadius);
        circle.setAttribute("fill", "#4a9eff");
        circle.setAttribute("stroke", "#fff");
        circle.setAttribute("stroke-width", "1");
        stopGroup.appendChild(circle);

        const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
        label.setAttribute("x", x);
        label.setAttribute("y", y + 18);
        label.setAttribute("text-anchor", "middle");
        label.setAttribute("font-size", "9");
        label.setAttribute("fill", isNextStop ? "#d8ffe5" : "#ccc");
        label.textContent = `S${i + 1}`;
        stopGroup.appendChild(label);

        svg.appendChild(stopGroup);
      }

      // Draw buses on route
      for (const placement of routeBusPlacements) {
        const bus = placement.bus;
        const busRoute = routeKey(safeAttr(bus, state.fields.busRoute));
        const busColor = routeColor(busRoute);
        const stackLane = placement.stackIndex % busLaneCount;
        const stackColumn = Math.floor(placement.stackIndex / busLaneCount);
        const stackOffset = stackColumn === 0
          ? 0
          : (stackColumn % 2 === 1 ? 1 : -1) * Math.ceil(stackColumn / 2) * 14;
        const baseBusX = placement.x;
        const busX = Math.max(padding + 7, Math.min(canvasWidth - padding - 7, baseBusX + stackOffset));
        const busY = placement.stackIndex === 0 ? lineY : lineY - 16 - stackLane * busLaneHeight;
        const isSelected = isSelectedBusFeature(bus);
        const markerSize = isSelected ? 12 : 10;
        const vehicleId = safeAttr(bus, state.fields.vehicleId, "?");
        const updated = safeAttr(bus, state.fields.vehicleTimestamp, "");
        const reportedStop = placement.reportedStopIndex >= 0
          ? stopDisplayName(routeStops[placement.reportedStopIndex], placement.reportedStopIndex)
          : "";
        const closestStop = placement.closestStopIndex >= 0
          ? stopDisplayName(routeStops[placement.closestStopIndex], placement.closestStopIndex)
          : "";
        const betweenStops = placement.stopSpan && placement.stopSpan.fromIndex !== placement.stopSpan.toIndex
          ? `${stopDisplayName(routeStops[placement.stopSpan.fromIndex], placement.stopSpan.fromIndex)} to ${stopDisplayName(routeStops[placement.stopSpan.toIndex], placement.stopSpan.toIndex)}`
          : "";
        const busTooltip = [
          `Vehicle ${vehicleId}`,
          `Updated ${formatValue(updated)}`,
          reportedStop ? `Reported stop: ${reportedStop}` : "",
          closestStop ? `Closest stop: ${closestStop}` : "",
          betweenStops ? `Position: ${betweenStops}` : ""
        ].filter(Boolean).join("\n");

        const busGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
        const busTitle = document.createElementNS("http://www.w3.org/2000/svg", "title");
        busTitle.textContent = busTooltip;
        busGroup.appendChild(busTitle);

        if (Math.abs(busX - baseBusX) > 0.1 || Math.abs(busY - lineY) > 0.1) {
          const busStem = document.createElementNS("http://www.w3.org/2000/svg", "line");
          busStem.setAttribute("x1", busX);
          busStem.setAttribute("y1", busY + markerSize / 2);
          busStem.setAttribute("x2", baseBusX);
          busStem.setAttribute("y2", lineY);
          busStem.setAttribute("stroke", busColor);
          busStem.setAttribute("stroke-width", isSelected ? "1.5" : "1");
          busStem.setAttribute("opacity", "0.55");
          busGroup.appendChild(busStem);
        }

        // Only the selected bus shows its relation label inline; for the rest it
        // would just pile text on top of the vehicle-id labels. Every bus still
        // carries the full relation in its hover tooltip below.
        if (isSelected) {
          const relationLabel = document.createElementNS("http://www.w3.org/2000/svg", "text");
          relationLabel.setAttribute("x", baseBusX);
          relationLabel.setAttribute("y", Math.max(10, busY - markerSize / 2 - 12));
          relationLabel.setAttribute("text-anchor", "middle");
          relationLabel.setAttribute("font-size", "7");
          relationLabel.setAttribute("fill", "#d8ffe5");
          relationLabel.setAttribute("font-weight", "700");
          relationLabel.textContent = placement.relation;
          busGroup.appendChild(relationLabel);
        }

        const busIcon = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        busIcon.setAttribute("x", busX - markerSize / 2);
        busIcon.setAttribute("y", busY - markerSize / 2);
        busIcon.setAttribute("width", markerSize);
        busIcon.setAttribute("height", markerSize);
        busIcon.setAttribute("fill", busColor);
        busIcon.setAttribute("stroke", isSelected ? "#32e875" : "#fff");
        busIcon.setAttribute("stroke-width", isSelected ? "2" : "1");
        busIcon.setAttribute("rx", "2");
        busGroup.appendChild(busIcon);

        const busLabel = document.createElementNS("http://www.w3.org/2000/svg", "text");
        busLabel.setAttribute("x", busX);
        busLabel.setAttribute("y", busY - markerSize / 2 - 3);
        busLabel.setAttribute("text-anchor", "middle");
        busLabel.setAttribute("font-size", "8");
        busLabel.setAttribute("fill", busColor);
        busLabel.setAttribute("font-weight", "bold");
        busLabel.textContent = vehicleId;
        busGroup.appendChild(busLabel);

        svg.appendChild(busGroup);
      }

      const legendY = canvasHeight - 12;
      const legendText = document.createElementNS("http://www.w3.org/2000/svg", "text");
      legendText.setAttribute("x", padding);
      legendText.setAttribute("y", legendY);
      legendText.setAttribute("font-size", "8");
      legendText.setAttribute("fill", "#999");
      legendText.textContent = `Route ${route} - ${stopCount} stops, ${routeBuses.length} active buses`;
      svg.appendChild(legendText);

      document.getElementById("schematicDiagram").style.display = "block";
    } catch (error) {
      console.error("Error drawing schematic:", error);
    }
  }

  async function initialize() {
    await Promise.allSettled([
      routesLayer.load(),
      stopsLayer.load(),
      busesLayer.load(),
      buildingsLayer.load(),
      buildingHighlightLayer.load()
    ]);

    state.fields = {
      routeLineName: resolveFieldName(routesLayer, CONFIG.routeLineNameField),
      routeId: resolveFieldName(routesLayer, CONFIG.routeIdField),
      stopName: resolveFieldName(stopsLayer, [CONFIG.stopNameField, "Stop_Name", "stop_name"]),
      stopId: resolveFieldName(stopsLayer, [CONFIG.stopIdField, "Stop_ID", "stop_id"]),
      stopCode: resolveFieldName(stopsLayer, [CONFIG.stopCodeField, "Stop_Code", "stop_code"]),
      busRoute: resolveFieldName(busesLayer, CONFIG.vehicleRouteField),
      vehicleId: resolveFieldName(busesLayer, CONFIG.vehicleIdField),
      vehicleTimestamp: resolveFieldName(busesLayer, CONFIG.vehicleTimestampField),
      vehicleStop: resolveFieldName(busesLayer, CONFIG.vehicleStopField),
      vehicleStatus: resolveFieldName(busesLayer, CONFIG.vehicleStatusField),
      vehicleBearing: resolveFieldName(busesLayer, CONFIG.vehicleBearingField),
      vehicleSpeed: resolveFieldName(busesLayer, CONFIG.vehicleSpeedField)
    };

    if (!state.fields.busRoute || !state.fields.vehicleId || !state.fields.vehicleTimestamp) {
      throw new Error("The realtime vehicle layer is missing a required route, vehicle id, or timestamp field.");
    }

    busesLayer.definitionExpression = baseBusWhere();

    // Load the stop-name index alongside the first bus query so initial cards show names.
    const [activeBuses] = await Promise.all([queryActiveBuses(), loadStopNameIndex()]);
    state.routeKeys = uniqueSorted(activeBuses.map((feature) => routeKey(safeAttr(feature, state.fields.busRoute))).filter(Boolean));

    setRouteRenderer(state.routeKeys);
    populateRouteFilter(state.routeKeys);
    updateBusCards(activeBuses);
    updateAnimatedBuses(activeBuses);
    await updateStats(activeBuses);
    updateFollowButton();

    busesLayer.on("refresh", queueLiveLocationRefresh);
    setInterval(() => refreshApp().catch((error) => console.error("Interval refresh failed", error)), CONFIG.refreshIntervalMinutes * 60 * 1000);
  }

  function uniqueSorted(values) {
    return [...new Set(values)].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }

  function populateRouteFilter(routes) {
    $("routeFilter").innerHTML = `<option value="">All routes</option>` +
      routes.map((route) => `<option value="${escapeHtml(route)}">${escapeHtml(route)}</option>`).join("");
    $("routeCount").textContent = String(routes.length);
  }

  async function applyRouteFilter(route, { drawSchematic = true } = {}) {
    state.currentRouteFilter = route || "";
    busesLayer.definitionExpression = selectedBusWhere(route);
    routesLayer.definitionExpression = selectedRouteWhere(route);
    routesLayer.refresh();

    // Show schematic for selected route
    if (route) {
      state.schematicRoute = route;
      if (drawSchematic) await drawSchematicDiagram(route);
    } else {
      state.schematicRoute = null;
      document.getElementById("schematicDiagram").style.display = "none";
    }
  }

  async function refreshApp({ zoom = false, followBus = state.followingBus } = {}) {
    await applyRouteFilter(state.currentRouteFilter, { drawSchematic: false });
    await busesLayer.refresh();

    const activeBuses = await queryActiveBuses();
    const routes = uniqueSorted(activeBuses.map((feature) => routeKey(safeAttr(feature, state.fields.busRoute))).filter(Boolean));

    if (routes.join("|") !== state.routeKeys.join("|")) {
      const selectedRoute = $("routeFilter").value;
      state.routeKeys = routes;
      populateRouteFilter(routes);
      $("routeFilter").value = selectedRoute;
      setRouteRenderer(routes);
    }

    updateBusCards(activeBuses);
    updateAnimatedBuses(activeBuses);
    updateFollowButton();
    if (hasSelectedBus()) updateSelectedBusInfo(selectedBusFromFeatures(activeBuses));

    if (zoom) await zoomToActiveBuses(activeBuses);
    if (followBus && hasSelectedBus()) await followSelectedBus(false, selectedBusFromFeatures(activeBuses));

    await updateStats(activeBuses);

    // Refresh schematic if route is selected
    if (state.schematicRoute) {
      await drawSchematicDiagram(state.schematicRoute);
    }
  }

  function queueLiveLocationRefresh() {
    const shouldFollow = state.followingBus && hasSelectedBus();
    if ((!shouldFollow && !state.schematicRoute) || state.liveFollowQueued) return;

    state.liveFollowQueued = true;
    const schedule = globalThis.requestAnimationFrame || ((callback) => globalThis.setTimeout(callback, 0));
    schedule(() => {
      state.liveFollowQueued = false;
      (async () => {
        if (shouldFollow) await followSelectedBus(false);
        if (state.schematicRoute) await drawSchematicDiagram(state.schematicRoute);
      })().catch((error) => console.error("Live location follow failed", error));
    });
  }

  async function updateStats(activeBuses = null) {
    const buses = activeBuses || await queryActiveBuses();
    const stopCount = await stopsLayer.queryFeatureCount({ where: stopsLayer.definitionExpression || "1=1" });

    $("busCount").textContent = String(buses.length);
    $("routeCount").textContent = String(uniqueSorted(buses.map((feature) => routeKey(safeAttr(feature, state.fields.busRoute))).filter(Boolean)).length);
    $("stopCount").textContent = String(stopCount);
    $("updatedAt").textContent = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
  }

  function updateFollowButton() {
    const button = $("btnFollowToggle");
    const followState = $("followState");
    const selected = hasSelectedBus();
    const following = state.followingBus && selected;
    if (button) {
      button.textContent = following ? "Following bus" : "Follow bus";
      button.classList.toggle("active", following);
      button.disabled = !selected;
      button.title = selected ? "" : "Select a bus first to follow it";
      button.setAttribute("aria-pressed", following ? "true" : "false");
    }
    if (followState) {
      followState.textContent = following ? "Yes" : "No";
    }
  }

  // One-time index of stop id/code -> friendly stop name, so live readouts can
  // show "to Eastgate Station" instead of the raw GTFS stop id.
  async function loadStopNameIndex() {
    const idField = state.fields.stopId;
    const codeField = state.fields.stopCode;
    const nameField = state.fields.stopName;
    if (!nameField || (!idField && !codeField)) return;

    const query = stopsLayer.createQuery();
    query.where = "1=1";
    query.outFields = [idField, codeField, nameField].filter(Boolean);
    query.returnGeometry = false;
    query.num = 5000;

    try {
      const result = await stopsLayer.queryFeatures(query);
      const index = new globalThis.Map();
      for (const feature of result.features) {
        const name = safeAttr(feature, nameField);
        if (!name) continue;
        for (const field of [idField, codeField].filter(Boolean)) {
          const key = normalizeStopId(safeAttr(feature, field));
          if (key && !index.has(key)) index.set(key, name);
        }
      }
      state.stopNameById = index;
    } catch (error) {
      console.warn("Stop name index query failed", error);
    }
  }

  function stopLabel(stopId) {
    const normalized = normalizeStopId(stopId);
    if (!normalized) return "";
    const name = state.stopNameById?.get(normalized);
    return name || `stop ${stopId}`;
  }

  function busStopRelation(feature) {
    const stopId = safeAttr(feature, state.fields.vehicleStop);
    if (!stopId) return "";
    const label = stopLabel(stopId);
    if (!label) return "";
    const relation = busStatusText(safeAttr(feature, state.fields.vehicleStatus));
    return `${relation} ${label}`;
  }

  function updateBusCards(activeBuses) {
    const cards = activeBuses.map((feature) => {
      const vehicleId = selectedBusVehicleId(feature);
      const route = routeKey(safeAttr(feature, state.fields.busRoute, "--"));
      const vehicle = safeAttr(feature, state.fields.vehicleId, "--");
      const updated = safeAttr(feature, state.fields.vehicleTimestamp, "--");
      const active = isSelectedBusFeature(feature) ? " active" : "";
      const stale = isStaleTimestamp(updated) ? " stale" : "";
      const relation = busStopRelation(feature);
      const color = routeColor(route);

      return `
        <article class="bus-card${active}${stale}" data-vehicle-id="${escapeHtml(vehicleId)}"
          role="button" tabindex="0"
          aria-label="Route ${escapeHtml(route)}, vehicle ${escapeHtml(vehicle)}, updated ${escapeHtml(relativeTime(updated))}"
          title="Updated ${escapeHtml(formatValue(updated))}"
          style="border-color:${color}; box-shadow: inset 4px 0 0 ${color}, 0 12px 32px rgba(0,0,0,0.28);">
          <div class="bus-card-route" style="color:${color};">${escapeHtml(route)}</div>
          ${relation ? `<div class="bus-card-meta">${escapeHtml(relation)}</div>` : ""}
          <div class="bus-card-meta bus-card-updated">Updated ${escapeHtml(relativeTime(updated))}</div>
          <div class="bus-card-meta">Vehicle ID: ${escapeHtml(vehicle)}</div>
        </article>`;
    }).join("");

    $("busCards").innerHTML = cards || `
      <article class="bus-card">
        <div class="bus-card-route">No buses</div>
        <div class="bus-card-meta">No active vehicles with a route in the last ${CONFIG.recentBusHours} hours</div>
      </article>`;
  }

  function updateSelectedBusInfo(feature) {
    const panel = $("selectedBus");
    if (!panel) return;

    if (!feature || !hasSelectedBus()) {
      panel.hidden = true;
      panel.innerHTML = "";
      return;
    }

    const route = routeKey(safeAttr(feature, state.fields.busRoute, "--"));
    const vehicle = safeAttr(feature, state.fields.vehicleId, "--");
    const updated = safeAttr(feature, state.fields.vehicleTimestamp);
    const relation = busStopRelation(feature);
    const color = routeColor(route);
    const staleClass = isStaleTimestamp(updated) ? " stale" : "";

    panel.innerHTML = `
      <div class="sb-route" style="color:${color}; border-color:${color};">${escapeHtml(route)}</div>
      <div class="sb-body">
        <div class="sb-title">Vehicle ${escapeHtml(vehicle)}</div>
        <div class="sb-meta${staleClass}">${relation ? escapeHtml(relation) + " · " : ""}Updated ${escapeHtml(relativeTime(updated))}</div>
      </div>
      <button type="button" class="sb-clear" aria-label="Clear selected bus">Clear</button>`;
    panel.hidden = false;
  }

  async function clearBusSelection() {
    state.followingBus = false;
    clearSelectedBus();
    await clearBuildingHighlight();
    clearBusArrivalCue();
    updateFollowButton();
    updateSelectedBusInfo(null);
    closePopup();
    const activeBuses = await queryActiveBuses();
    updateBusCards(activeBuses);
    updateAnimatedBuses(activeBuses);
  }

  function isAbortError(error) {
    return error?.name === "AbortError" || error?.message === "Aborted";
  }

  async function queryRouteGeometryForBus(busFeature) {
    const route = routeKey(safeAttr(busFeature, state.fields.busRoute));
    if (!route) return null;

    const routeQuery = routesLayer.createQuery();
    routeQuery.where = selectedRouteWhere(route);
    routeQuery.returnGeometry = true;
    routeQuery.outFields = ["*"];
    routeQuery.num = 10;

    try {
      const routeResult = await routesLayer.queryFeatures(useViewSpatialReference(routeQuery));
      const routeCandidates = routeResult.features
        .filter((feature) => feature.geometry)
        .map((feature) => ({
          geometry: feature.geometry,
          position: routeMeasureAtPoint(feature.geometry, busFeature.geometry)
        }));
      routeCandidates.sort((a, b) => {
        const distanceA = a.position?.distanceSquared ?? Number.POSITIVE_INFINITY;
        const distanceB = b.position?.distanceSquared ?? Number.POSITIVE_INFINITY;
        return distanceA - distanceB;
      });
      return routeCandidates[0]?.geometry || null;
    } catch (error) {
      console.warn("Route direction cue query failed", error);
      return null;
    }
  }

  // Route measures are planar lengths in the view's Web Mercator units, which
  // overstate ground distance by 1/cos(latitude); scale ground meters to match.
  function groundMetersToMapUnits(meters, pointGeometry) {
    const latitude = pointGeometry?.spatialReference?.isWebMercator ? pointGeometry.latitude : null;
    return Number.isFinite(latitude) ? meters / Math.cos(latitude * Math.PI / 180) : meters;
  }

  function routeDirectionCueForBus(routeGeometry, busFeature) {
    if (!routeGeometry || !busFeature?.geometry) return null;

    const routePosition = routeMeasureAtPoint(routeGeometry, busFeature.geometry);
    const routeLength = routePosition?.totalLength || polylineLength(routeGeometry);
    if (!routePosition || routeLength <= 0) return null;

    const cueLength = Math.min(groundMetersToMapUnits(CONFIG.routeDirectionCueFeet * 0.3048, busFeature.geometry), routeLength);
    const directionSign = routeDirectionSign(
      routeGeometry,
      routePosition.measure,
      safeAttr(busFeature, state.fields.vehicleBearing)
    );

    return {
      routeGeometry,
      routeLength,
      startMeasure: routePosition.measure,
      directionSign,
      cueLength
    };
  }

  // Persistent cue graphics. The animation runs at ~60fps, so rather than
  // rebuilding ~10 Graphic/Circle objects every frame we create the pool once
  // and update each graphic's geometry/symbol in place.
  const DIRECTION_DOT_COUNT = 7;
  const cueGraphics = {
    rings: Array.from({ length: 3 }, () => new Graphic({ visible: false })),
    dots: Array.from({ length: DIRECTION_DOT_COUNT }, () => new Graphic({ visible: false }))
  };
  busArrivalPulseLayer.addMany([...cueGraphics.rings, ...cueGraphics.dots]);

  function hideCueGraphics() {
    for (const graphic of cueGraphics.rings) graphic.visible = false;
    for (const graphic of cueGraphics.dots) graphic.visible = false;
  }

  function clearBusArrivalCue() {
    if (state.busArrivalAnimationFrame) {
      cancelAnimationFrame(state.busArrivalAnimationFrame);
      state.busArrivalAnimationFrame = null;
    }
    hideCueGraphics();
  }

  function updateRingGraphic(graphic, center, radius, outlineColor, outlineWidth, fillColor) {
    graphic.geometry = new Circle({
      center,
      geodesic: true,
      numberOfPoints: 96,
      radius,
      radiusUnit: "meters"
    });
    graphic.symbol = {
      type: "simple-fill",
      color: fillColor,
      outline: { color: outlineColor, width: outlineWidth }
    };
    graphic.visible = true;
  }

  function updateDotGraphic(graphic, pointGeometry, opacity, size) {
    graphic.geometry = pointGeometry;
    graphic.symbol = {
      type: "point-3d",
      symbolLayers: [{
        type: "icon",
        resource: { primitive: "circle" },
        size,
        material: { color: [255, 255, 255, Math.min(.55, opacity + 0.6)] },
        outline: { color: [255, 255, 255, Math.min(.35, opacity + 0.4)], size: 1.3 }
      }]
    };
    graphic.visible = true;
  }

  function updateDirectionDots(directionCue, progress, opacity) {
    const dots = cueGraphics.dots;
    let used = 0;

    if (directionCue) {
      const minOffset = 3.5;
      const availableLength = Math.max(0, directionCue.cueLength - minOffset);
      const phase = (progress * 0.38) % 1;

      for (let i = 0; i < dots.length; i++) {
        const normalized = (i / dots.length + phase) % 1;
        const offset = minOffset + normalized * availableLength;
        const measure = directionCue.startMeasure + directionCue.directionSign * offset;
        if (measure < 0 || measure > directionCue.routeLength) continue;

        const point = pointAtRouteMeasure(directionCue.routeGeometry, measure);
        if (!point) continue;

        const edgeFade = Math.sin(normalized * Math.PI);
        updateDotGraphic(dots[used], point, opacity * (0.22 + edgeFade * 0.72), 5 + edgeFade * 4);
        used++;
      }
    }

    for (let i = used; i < dots.length; i++) dots[i].visible = false;
  }

  async function animateBusArrivalCue(busFeature) {
    if (!busFeature?.geometry) return;
    // Respect reduced-motion: skip the pulsing arrival animation entirely.
    if (prefersReducedMotion()) {
      clearBusArrivalCue();
      return;
    }

    const cueRequest = state.busArrivalCueRequest + 1;
    state.busArrivalCueRequest = cueRequest;
    const routeGeometry = await queryRouteGeometryForBus(busFeature);
    if (cueRequest !== state.busArrivalCueRequest) return;

    const directionCue = routeDirectionCueForBus(routeGeometry, busFeature);
    clearBusArrivalCue();
    const duration = 2600;
    const start = performance.now();
    const center = busFeature.geometry.clone ? busFeature.geometry.clone() : busFeature.geometry;
    const easeOut = (value) => 1 - Math.pow(1 - value, 3);

    const drawFrame = (now) => {
      const progress = Math.min(1, (now - start) / duration);
      const intro = Math.min(1, progress / 0.28);
      const exit = progress > 0.78 ? 1 - ((progress - 0.78) / 0.22) : 1;
      const opacity = Math.max(0, Math.min(1, easeOut(intro) * exit));
      const pulse = Math.sin(Math.min(1, progress / 0.34) * Math.PI);
      const outerRadius = 13 + easeOut(intro) * 14 + pulse * 2.5;
      const innerRadius = 6 + easeOut(intro) * 8.5;
      const centerRadius = 2.5 + pulse * 1.5;

      updateRingGraphic(cueGraphics.rings[0], center, outerRadius, [245, 248, 250, 0.9 * opacity], 4, [210, 214, 218, 0.17 * opacity]);
      updateRingGraphic(cueGraphics.rings[1], center, innerRadius, [245, 248, 250, 0.88 * opacity], 3, [5, 7, 10, 0.52 * opacity]);
      updateRingGraphic(cueGraphics.rings[2], center, centerRadius, [50, 232, 117, 0.92 * opacity], 2, [50, 232, 117, 0.4 * opacity]);
      updateDirectionDots(directionCue, progress, opacity);

      if (progress < 1) {
        state.busArrivalAnimationFrame = requestAnimationFrame(drawFrame);
      } else {
        clearBusArrivalCue();
      }
    };

    state.busArrivalAnimationFrame = requestAnimationFrame(drawFrame);
  }

  async function goToView(target, options) {
    const navOptions = prefersReducedMotion() ? { ...options, duration: 0 } : options;
    try {
      await view.goTo(target, navOptions);
    } catch (error) {
      if (!isAbortError(error)) console.warn("View navigation failed", error);
    }
  }

  async function zoomToActiveBuses(activeBuses) {
    const targets = activeBuses.filter((feature) => feature.geometry).map((feature) => feature.geometry);
    if (!targets.length) return;
    await goToView(targets, { duration: 900, easing: "ease-in-out" });
  }

  $("routeFilter").addEventListener("change", async (event) => {
    try {
      const route = event.target.value;
      const selectedValue = route;
      state.currentRouteFilter = route || "";
      state.schematicDismissed = false; // a fresh route selection re-opens the schematic
      await refreshApp({ zoom: true });
      $("routeFilter").value = selectedValue;
    } catch (error) {
      console.error("Route filter update failed", error);
    }
  });

  $("btnDowntown").addEventListener("click", () => {
    goToView(CONFIG.downtownCamera, { duration: 1100 });
  });
  $("btnFollowToggle").addEventListener("click", async () => {
    try {
      if (!hasSelectedBus()) {
        showToast("Select a bus card first to follow a bus.");
        return;
      }
      state.followingBus = !state.followingBus;
      updateFollowButton();
      if (state.followingBus) await followSelectedBus(true);
    } catch (error) {
      console.error("Follow toggle failed", error);
    }
  });
  $("btnRefresh").addEventListener("click", () => {
    refreshApp().catch((error) => console.error("Manual refresh failed", error));
  });

  $("selectedBus").addEventListener("click", (event) => {
    if (!event.target.closest(".sb-clear")) return;
    clearBusSelection().catch((error) => console.error("Clear selection failed", error));
  });

  // Select by vehicle id, not objectId: the card may have been rendered from a
  // report that a newer row for the same vehicle has since superseded.
  async function activateBusCard(card) {
    state.selectedBusVehicleId = card.dataset.vehicleId;
    state.selectedBusObjectId = null;
    state.followingBus = true;
    const activeBuses = await queryActiveBuses();
    const selectedBus = selectedBusFromFeatures(activeBuses);
    if (selectedBus) rememberSelectedBus(selectedBus);
    updateFollowButton();
    updateBusCards(activeBuses);
    updateAnimatedBuses(activeBuses);
    updateSelectedBusInfo(selectedBus);

    // Find and highlight buildings near selected bus
    if (selectedBus && selectedBus.geometry) {
      await highlightBuildingsNearBus(selectedBus.geometry);
    }

    await followSelectedBus(true, selectedBus, { openPopup: false, showArrivalCue: true });
    if (state.schematicRoute) await drawSchematicDiagram(state.schematicRoute);
  }

  $("busCards").addEventListener("click", async (event) => {
    try {
      const card = event.target.closest(".bus-card[data-vehicle-id]");
      if (!card) return;
      await activateBusCard(card);
    } catch (error) {
      console.error("Bus card selection failed", error);
    }
  });

  $("busCards").addEventListener("keydown", async (event) => {
    if (event.key !== "Enter" && event.key !== " " && event.key !== "Spacebar") return;
    const card = event.target.closest(".bus-card[data-vehicle-id]");
    if (!card) return;
    event.preventDefault(); // stop Space from scrolling the strip
    try {
      await activateBusCard(card);
    } catch (error) {
      console.error("Bus card keyboard selection failed", error);
    }
  });

  function closePopup() {
    if (typeof view.closePopup === "function") {
      view.closePopup();
    } else if (typeof view.popup?.close === "function") {
      view.popup.close();
    }
  }

  async function followSelectedBus(forcePopup = false, selectedFeature = null, { openPopup = forcePopup, showArrivalCue = false } = {}) {
    if (!hasSelectedBus()) return;

    const feature = selectedFeature && isActiveBus(selectedFeature)
      ? selectedFeature
      : await querySelectedBus();
    if (!feature?.geometry || !isActiveBus(feature)) {
      state.followingBus = false;
      clearSelectedBus();
      await clearBuildingHighlight();
      updateFollowButton();
      updateSelectedBusInfo(null);
      showToast("That bus is no longer reporting — stopped following.");
      return;
    }
    rememberSelectedBus(feature);
    updateSelectedBusInfo(feature);

    const location = feature.geometry.type === "point"
      ? { x: feature.geometry.x, y: feature.geometry.y }
      : null;

    const shouldPan = forcePopup || !state.lastSelectedBusLocation || !location ||
      location.x !== state.lastSelectedBusLocation.x || location.y !== state.lastSelectedBusLocation.y;

    if (shouldPan) {
      const camera = {
        target: feature.geometry,
        scale: forcePopup ? 1500 : view.scale,
        tilt: view.camera?.tilt ?? 68,
        heading: view.camera?.heading ?? 0
      };
      await goToView(camera, { duration: forcePopup ? 700 : 450, easing: forcePopup ? "ease-in-out" : "linear" });
    }
    if (showArrivalCue) {
      animateBusArrivalCue(feature).catch((error) => console.warn("Bus arrival cue failed", error));
    }

    if (location) state.lastSelectedBusLocation = location;
    if (openPopup) {
      view.openPopup({ features: [feature], location: feature.geometry });
    } else {
      closePopup();
    }

    updateFollowButton();
  }

  // Selecting a bus on the map drives follow + schematic. Stops and routes rely
  // on their layers' native popupTemplates, so no custom handling is needed here.
  view.on("click", async (event) => {
    const response = await view.hitTest(event);
    // Buses are drawn as animated GraphicsLayer markers; the icon graphics carry
    // the vehicle attributes (label graphics don't), so match on those.
    const result = response.results.find((hit) =>
      hit.graphic?.layer === animatedBusLayer && hit.graphic.attributes
    );
    if (!result) return;

    const vehicleId = safeAttr(result.graphic, state.fields.vehicleId, "");
    if (vehicleId) {
      state.selectedBusVehicleId = vehicleId;
      state.selectedBusObjectId = null;
    } else {
      rememberSelectedBus(result.graphic);
    }

    const activeBuses = await queryActiveBuses();
    // Resolve back to the authoritative queried feature so the popup/camera use
    // the reported position and the layer's popupTemplate.
    const selectedBus = selectedBusFromFeatures(activeBuses) || result.graphic;
    rememberSelectedBus(selectedBus);
    updateFollowButton();
    updateSelectedBusInfo(selectedBus);
    updateBusCards(activeBuses);
    updateAnimatedBuses(activeBuses);
    if (state.followingBus) await followSelectedBus(true, selectedBus);
    if (state.schematicRoute) await drawSchematicDiagram(state.schematicRoute);
  });

  view.when(() => {
    view.ui.add(new Expand({ view, content: new Legend({ view }), expanded: false, expandIcon: "legend" }), "top-right");
    view.ui.add(new Expand({ view, content: new LayerList({ view }), expanded: false, expandIcon: "layers" }), "top-right");
  });

  initialize().catch((error) => {
    console.error("App initialization failed", error);
    showToast("The app could not initialize. Check the browser console for layer or field details.", { duration: 10000 });
  });
});
