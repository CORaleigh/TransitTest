require([
  "esri/Map",
  "esri/views/SceneView",
  "esri/layers/FeatureLayer",
  "esri/layers/SceneLayer",
  "esri/layers/support/LabelClass",
  "esri/renderers/UniqueValueRenderer",
  "esri/widgets/Legend",
  "esri/widgets/LayerList",
  "esri/widgets/Expand",
  "esri/core/reactiveUtils"
], (
  Map,
  SceneView,
  FeatureLayer,
  SceneLayer,
  LabelClass,
  UniqueValueRenderer,
  Legend,
  LayerList,
  Expand,
  reactiveUtils
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
    realtimeVehiclesItemId: "764268786eb74844b12b0b55fdc2575e",
    buildingsItemId: "affa13965fe948cca694e356ef9a3004",
    refreshIntervalMinutes: 0.25,
    recentBusHours: 3,
    routeLineNameField: "full_name",
    routeIdField: "route_short_name",
    stopNameField: "stop_name",
    vehicleRouteField: "trip_route_id",
    vehicleIdField: "vehicle_id",
    vehicleTimestampField: "vehicle_position_timestamp",
    vehicleStopField: "stop_id",
    vehicleBearingField: "bearing",
    vehicleSpeedField: "speed"
  };

  const $ = (id) => document.getElementById(id);

  const state = {
    selectedBusObjectId: null,
    followingBus: false,
    lastSelectedBusLocation: null,
    currentRouteFilter: "",
    routeKeys: [],
    fields: {}
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
    popupTemplate: { title: "Bus Stop", content: [{ type: "fields", fieldInfos: [] }] }
  });

  const busesLayer = new FeatureLayer({
    title: "Live GoRaleigh Buses",
    portalItem: { id: CONFIG.realtimeVehiclesItemId },
    outFields: ["*"],
    refreshInterval: CONFIG.refreshIntervalMinutes,
    elevationInfo: { mode: "relative-to-ground", offset: 24 },
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
    renderer: {
      type: "simple",
      symbol: {
        type: "mesh-3d",
        symbolLayers: [{
          type: "fill",
          material: { color: [8, 135, 160, 0.4] },
          edges: { type: "solid", color: [8, 135, 160, 1], size: 1.2 }
        }]
      }
    }
  });

  map.addMany([buildingsLayer, routesLayer, stopsLayer, busesLayer]);

  function safeAttr(graphic, fieldName, fallback = "") {
    if (!graphic?.attributes || !fieldName) return fallback;
    const value = graphic.attributes[fieldName];
    return value === null || value === undefined || value === "" ? fallback : value;
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

  function busSymbol(color) {
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
        resource: { href: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(busSvg(color))}` },
        size: 30
      }]
    };
  }

  function busSvg(color) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="30" fill="${color}" stroke="#05070a" stroke-width="4"/><path d="M18 21c0-4 3-7 7-7h14c4 0 7 3 7 7v20c0 3-2 5-5 5l3 4v2h-5l-4-5H29l-4 5h-5v-2l3-4c-3 0-5-2-5-5V21zm6 3v10h16V24H24zm2 16a4 4 0 100 8 4 4 0 000-8zm16 0a4 4 0 100 8 4 4 0 000-8z" fill="#05070a"/></svg>`;
  }

  function setBusRenderer(routes) {
    const routeField = state.fields.busRoute;
    if (!routeField) {
      busesLayer.renderer = null;
      return;
    }

    const valueExpression = `var n = $feature['${routeField}']; return IIF(IsEmpty(n), '', Split(n, ' ')[0]);`;

    busesLayer.renderer = new UniqueValueRenderer({
      valueExpression,
      defaultSymbol: busSymbol("#676c7a"),
      uniqueValueInfos: routes.map((route) => ({
        value: route,
        label: route,
        symbol: busSymbol(routeColor(route))
      }))
    });
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

  function setBusLabels() {
    busesLayer.labelingInfo = [new LabelClass({
      labelExpressionInfo: { expression: `$feature.${state.fields.busRoute}` },
      symbol: {
        type: "label-3d",
        symbolLayers: [{
          type: "text",
          material: { color: "#ffffff" },
          halo: { color: "#05070a", size: 1.5 },
          size: 10,
          font: { weight: "bold" }
        }]
      },
      labelPlacement: "above-center"
    })];
    busesLayer.labelsVisible = true;
  }

  async function queryActiveBuses() {
    const query = busesLayer.createQuery();
    query.where = busesLayer.definitionExpression || baseBusWhere();
    query.outFields = ["*"];
    query.returnGeometry = true;
    query.num = 2000;
    query.orderByFields = [state.fields.busRoute, state.fields.vehicleId].filter(Boolean);

    const result = await busesLayer.queryFeatures(query);
    return sortActiveBuses(result.features.filter(isActiveBus));
  }

  async function initialize() {
    await Promise.allSettled([routesLayer.load(), stopsLayer.load(), busesLayer.load(), buildingsLayer.load()]);

    state.fields = {
      routeLineName: CONFIG.routeLineNameField,
      routeId: CONFIG.routeIdField,
      stopName: CONFIG.stopNameField,
      busRoute: CONFIG.vehicleRouteField,
      vehicleId: CONFIG.vehicleIdField,
      vehicleTimestamp: CONFIG.vehicleTimestampField,
      vehicleStop: CONFIG.vehicleStopField,
      vehicleBearing: CONFIG.vehicleBearingField,
      vehicleSpeed: CONFIG.vehicleSpeedField
    };

    if (!state.fields.busRoute || !state.fields.vehicleId || !state.fields.vehicleTimestamp) {
      throw new Error("The realtime vehicle layer is missing a required route, vehicle id, or timestamp field.");
    }

    busesLayer.definitionExpression = baseBusWhere();
    setBusLabels();

    const activeBuses = await queryActiveBuses();
    state.routeKeys = uniqueSorted(activeBuses.map((feature) => routeKey(safeAttr(feature, state.fields.busRoute))).filter(Boolean));

    setBusRenderer(state.routeKeys);
    setRouteRenderer(state.routeKeys);
    populateRouteFilter(state.routeKeys);
    updateBusCards(activeBuses);
    await updateStats(activeBuses);
    updateFollowButton();

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

  async function applyRouteFilter(route) {
    state.currentRouteFilter = route || "";
    busesLayer.definitionExpression = selectedBusWhere(route);
    routesLayer.definitionExpression = selectedRouteWhere(route);
    routesLayer.refresh();
  }

  async function refreshApp({ zoom = false, followBus = state.followingBus } = {}) {
    await applyRouteFilter(state.currentRouteFilter);
    await busesLayer.refresh();

    const activeBuses = await queryActiveBuses();
    const routes = uniqueSorted(activeBuses.map((feature) => routeKey(safeAttr(feature, state.fields.busRoute))).filter(Boolean));

    if (routes.join("|") !== state.routeKeys.join("|")) {
      const selectedRoute = $("routeFilter").value;
      state.routeKeys = routes;
      populateRouteFilter(routes);
      $("routeFilter").value = selectedRoute;
      setBusRenderer(routes);
      setRouteRenderer(routes);
    }

    updateBusCards(activeBuses);
    await updateStats(activeBuses);
    updateFollowButton();

    if (zoom) await zoomToActiveBuses(activeBuses);
    if (followBus) await followSelectedBus(false);
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
    if (button) {
      if (state.followingBus && state.selectedBusObjectId) {
        button.textContent = "Following bus";
        button.classList.add("active");
      } else {
        button.textContent = "Follow bus";
        button.classList.remove("active");
      }
    }
    if (followState) {
      followState.textContent = state.followingBus && state.selectedBusObjectId ? "Yes" : "No";
    }
  }

  function updateBusCards(activeBuses) {
    const objectIdField = busesLayer.objectIdField;
    const cards = activeBuses.map((feature) => {
      const oid = feature.attributes[objectIdField];
      const route = routeKey(safeAttr(feature, state.fields.busRoute, "--"));
      const vehicle = safeAttr(feature, state.fields.vehicleId, "--");
      const updated = safeAttr(feature, state.fields.vehicleTimestamp, "--");
      const active = String(oid) === String(state.selectedBusObjectId) ? " active" : "";
      const color = routeColor(route);

      return `
        <article class="bus-card${active}" data-objectid="${escapeHtml(oid)}"
          style="border-color:${color}; box-shadow: inset 4px 0 0 ${color}, 0 12px 32px rgba(0,0,0,0.28);">
          <div class="bus-card-route" style="color:${color};">${escapeHtml(route)}</div>
          <div class="bus-card-meta">Time: ${escapeHtml(formatValue(updated))}</div>
          <div class="bus-card-meta">Vehicle ID: ${escapeHtml(vehicle)}</div>
        </article>`;
    }).join("");

    $("busCards").innerHTML = cards || `
      <article class="bus-card">
        <div class="bus-card-route">No buses</div>
        <div class="bus-card-meta">No active vehicles with a route in the last ${CONFIG.recentBusHours} hours</div>
      </article>`;
  }

  function makeDetails(title, rows) {
    $("detailsTitle").textContent = title;
    $("detailsGrid").innerHTML = rows
      .map(([key, value]) => `<div class="key">${escapeHtml(key)}</div><div>${escapeHtml(formatValue(value))}</div>`)
      .join("");
    $("detailsCard").classList.add("visible");
  }

  async function zoomToActiveBuses(activeBuses) {
    const targets = activeBuses.filter((feature) => feature.geometry).map((feature) => feature.geometry);
    if (!targets.length) return;
    await view.goTo(targets, { duration: 900, easing: "ease-in-out" });
  }

  $("routeFilter").addEventListener("change", async (event) => {
    const route = event.target.value;
    const selectedValue = route;
    await applyRouteFilter(route);
    await refreshApp({ zoom: true });
    $("routeFilter").value = selectedValue;
  });

  $("btnDowntown").addEventListener("click", () => view.goTo(CONFIG.downtownCamera, { duration: 1100 }));
  $("btnFollowToggle").addEventListener("click", async () => {
    if (!state.selectedBusObjectId) {
      alert("Select a bus card first to follow a bus.");
      return;
    }
    state.followingBus = !state.followingBus;
    updateFollowButton();
    if (state.followingBus) await followSelectedBus(true);
  });
  $("btnRefresh").addEventListener("click", refreshApp);

  $("busCards").addEventListener("click", async (event) => {
    const card = event.target.closest(".bus-card[data-objectid]");
    if (!card) return;
    state.selectedBusObjectId = card.dataset.objectid;
    state.followingBus = true;
    updateFollowButton();
    const activeBuses = await queryActiveBuses();
    updateBusCards(activeBuses);
    await followSelectedBus(true);
  });

  async function followSelectedBus(forcePopup = false) {
    if (!state.selectedBusObjectId) return;

    const result = await busesLayer.queryFeatures({
      where: `${busesLayer.objectIdField} = ${state.selectedBusObjectId}`,
      outFields: ["*"],
      returnGeometry: true,
      num: 1
    });

    const feature = result.features[0];
    if (!feature?.geometry || !isActiveBus(feature)) {
      state.followingBus = false;
      state.selectedBusObjectId = null;
      state.lastSelectedBusLocation = null;
      updateFollowButton();
      return;
    }

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
      await view.goTo(camera, { duration: 700, easing: "ease-in-out" });
    }

    if (location) state.lastSelectedBusLocation = location;
    if (forcePopup) view.openPopup({ features: [feature], location: feature.geometry });

    makeDetails("Live bus", [
      ["Route", routeKey(safeAttr(feature, state.fields.busRoute))],
      ["Time", safeAttr(feature, state.fields.vehicleTimestamp)],
      ["Vehicle ID", safeAttr(feature, state.fields.vehicleId)],
      ["Stop ID", safeAttr(feature, state.fields.vehicleStop)],
      ["Bearing", safeAttr(feature, state.fields.vehicleBearing)],
      ["Speed", safeAttr(feature, state.fields.vehicleSpeed)]
    ]);
    updateFollowButton();
  }

  view.on("click", async (event) => {
    const response = await view.hitTest(event);
    const result = response.results.find((hit) =>
      hit.graphic?.layer === busesLayer || hit.graphic?.layer === stopsLayer || hit.graphic?.layer === routesLayer
    );
    if (!result) return;

    const graphic = result.graphic;
    if (graphic.layer === busesLayer) {
      makeDetails("Live bus", [
        ["Route", routeKey(safeAttr(graphic, state.fields.busRoute))],
        ["Time", safeAttr(graphic, state.fields.vehicleTimestamp)],
        ["Vehicle ID", safeAttr(graphic, state.fields.vehicleId)]
      ]);
    } else if (graphic.layer === stopsLayer) {
      makeDetails("Bus stop", [
        ["Stop", safeAttr(graphic, state.fields.stopName)],
        ["Object ID", safeAttr(graphic, graphic.layer.objectIdField)]
      ]);
    } else if (graphic.layer === routesLayer) {
      makeDetails("Route", [
        ["Route", safeAttr(graphic, state.fields.routeId)],
        ["Line Name", safeAttr(graphic, state.fields.routeLineName)],
        ["Object ID", safeAttr(graphic, graphic.layer.objectIdField)]
      ]);
    }
  });

  view.when(() => {
    view.ui.add(new Expand({ view, content: new Legend({ view }), expanded: false, expandIcon: "legend" }), "top-right");
    view.ui.add(new Expand({ view, content: new LayerList({ view }), expanded: false, expandIcon: "layers" }), "top-right");
  });

  reactiveUtils.when(
    () => !view.updating,
    () => updateStats().catch((error) => console.warn("Reactive stats update failed", error)),
    { once: false }
  );

  initialize().catch((error) => {
    console.error("App initialization failed", error);
    alert("The app could not initialize. Check the browser console for layer or field details.");
  });
});