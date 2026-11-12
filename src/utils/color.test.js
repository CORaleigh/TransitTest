import { test } from "node:test";
import assert from "node:assert/strict";
import {
  routeColor,
  hexToRgba,
  makeLineSymbol,
  busSymbol,
  busSvg,
  defaultBuildingRenderer,
  highlightedBuildingRenderer
} from "./color.js";

test("routeColor is deterministic and returns a palette hex", () => {
  const a = routeColor("11");
  const b = routeColor("11");
  assert.equal(a, b);
  assert.match(a, /^#[0-9a-f]{6}$/);
  // different routes generally map to different colors (not guaranteed, but these do)
  assert.notEqual(routeColor("11"), routeColor("7"));
});

test("hexToRgba splits a hex string into [r, g, b, a]", () => {
  assert.deepEqual(hexToRgba("#19b5fe"), [25, 181, 254, 1]);
  assert.deepEqual(hexToRgba("19b5fe", 0.5), [25, 181, 254, 0.5]);
});

test("makeLineSymbol embeds the rgba color and size", () => {
  const sym = makeLineSymbol("#19b5fe", 6, 0.9);
  assert.equal(sym.type, "line-3d");
  assert.equal(sym.symbolLayers[0].size, 6);
  assert.deepEqual(sym.symbolLayers[0].material.color, [25, 181, 254, 0.9]);
});

test("busSvg reflects the selected ring styling", () => {
  assert.match(busSvg("#19b5fe", false), /stroke="#05070a"/);
  assert.match(busSvg("#19b5fe", true), /stroke="#32e875"/);
});

test("busSymbol grows the icon and encodes the svg when selected", () => {
  assert.equal(busSymbol("#19b5fe", false).symbolLayers[0].size, 30);
  assert.equal(busSymbol("#19b5fe", true).symbolLayers[0].size, 38);
  assert.match(busSymbol("#19b5fe").symbolLayers[0].resource.href, /^data:image\/svg\+xml/);
});

test("building renderers are simple renderers with mesh symbols", () => {
  assert.equal(defaultBuildingRenderer().type, "simple");
  assert.equal(defaultBuildingRenderer().symbol.type, "mesh-3d");
  assert.equal(highlightedBuildingRenderer().symbol.symbolLayers[0].edges.size, 2);
});
