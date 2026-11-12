// Pure color + symbol builders. Each returns a plain ArcGIS symbol/renderer
// descriptor object (no SDK class construction), so this module has zero runtime
// dependencies and is safe to unit-test in isolation.

export function routeColor(route) {
  const palette = [
    "#19b5fe", "#f6c85f", "#6acc64", "#ff6b6b", "#b084f5",
    "#4ecdc4", "#f9844a", "#90be6d", "#43aa8b", "#577590",
    "#f3722c", "#277da1", "#f9c74f", "#c77dff", "#00bbf9"
  ];
  let hash = 0;
  for (const char of String(route || "0")) hash = ((hash << 5) - hash) + char.charCodeAt(0);
  return palette[Math.abs(hash) % palette.length];
}

export function hexToRgba(hex, alpha = 1) {
  const clean = hex.replace("#", "");
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
    alpha
  ];
}

export function makeLineSymbol(color, size = 6, opacity = 0.88) {
  return {
    type: "line-3d",
    symbolLayers: [{
      type: "line",
      size,
      material: { color: hexToRgba(color, opacity) }
    }]
  };
}

export function busSvg(color, selected = false) {
  const ring = selected ? "#32e875" : "#05070a";
  const ringWidth = selected ? 6 : 4;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="30" fill="${color}" stroke="${ring}" stroke-width="${ringWidth}"/><path d="M18 21c0-4 3-7 7-7h14c4 0 7 3 7 7v20c0 3-2 5-5 5l3 4v2h-5l-4-5H29l-4 5h-5v-2l3-4c-3 0-5-2-5-5V21zm6 3v10h16V24H24zm2 16a4 4 0 100 8 4 4 0 000-8zm16 0a4 4 0 100 8 4 4 0 000-8z" fill="#05070a"/></svg>`;
}

export function busSymbol(color, selected = false) {
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

export function makeBuildingSymbol(faceColor, edgeColor, edgeSize = 1.2) {
  return {
    type: "mesh-3d",
    symbolLayers: [{
      type: "fill",
      material: { color: faceColor },
      edges: { type: "solid", color: edgeColor, size: edgeSize }
    }]
  };
}

export function defaultBuildingRenderer() {
  return {
    type: "simple",
    symbol: makeBuildingSymbol([8, 135, 160, 0.4], [8, 135, 160, 1], 1.2)
  };
}

export function highlightedBuildingRenderer() {
  return {
    type: "simple",
    symbol: makeBuildingSymbol([70, 255, 110, 0.38], [0, 220, 70, 1], 2)
  };
}
