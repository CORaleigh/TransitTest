import { test } from "node:test";
import assert from "node:assert/strict";
import {
  pointXY,
  segmentProjection,
  polylineLength,
  routeMeasureAtPoint,
  routeSegmentAtMeasure,
  pointAtRouteMeasure,
  bearingVector,
  routeDirectionSign,
  nearestStopIndex
} from "./geometry.js";

// A simple L-shaped route: 10 units east, then 10 units north. Total length 20.
const route = {
  spatialReference: { wkid: 3857 },
  paths: [[[0, 0], [10, 0], [10, 10]]]
};

test("pointXY guards non-point geometries", () => {
  assert.deepEqual(pointXY({ x: 3, y: 4 }), [3, 4]);
  assert.equal(pointXY(null), null);
  assert.equal(pointXY({ x: "3", y: 4 }), null);
});

test("segmentProjection clamps to the segment and reports distance", () => {
  const proj = segmentProjection([5, 3], [0, 0], [10, 0]);
  assert.equal(proj.t, 0.5);
  assert.equal(proj.segmentLength, 10);
  assert.equal(proj.distanceSquared, 9); // 3 units off the line
  // beyond the far end clamps to t=1
  assert.equal(segmentProjection([20, 0], [0, 0], [10, 0]).t, 1);
  // degenerate zero-length segment
  assert.deepEqual(segmentProjection([3, 4], [0, 0], [0, 0]),
    { t: 0, distanceSquared: 25, segmentLength: 0 });
  assert.equal(segmentProjection([0, 0], [NaN, 0], [1, 1]), null);
});

test("polylineLength sums every segment", () => {
  assert.equal(polylineLength(route), 20);
  assert.equal(polylineLength({ paths: [] }), 0);
  assert.equal(polylineLength(null), 0);
});

test("routeMeasureAtPoint finds the along-route distance of the nearest point", () => {
  const measure = routeMeasureAtPoint(route, { x: 10, y: 5 });
  assert.equal(measure.measure, 15); // 10 along first leg + 5 up second leg
  assert.equal(measure.distanceSquared, 0);
  assert.equal(routeMeasureAtPoint(route, {}), null);
});

test("routeSegmentAtMeasure locates the segment containing a measure", () => {
  const seg = routeSegmentAtMeasure(route, 15);
  assert.deepEqual(seg.start, [10, 0]);
  assert.deepEqual(seg.end, [10, 10]);
  assert.equal(seg.t, 0.5);
  // past the end clamps to the last segment at t=1
  assert.equal(routeSegmentAtMeasure(route, 999).t, 1);
  assert.equal(routeSegmentAtMeasure(route, NaN), null);
});

test("pointAtRouteMeasure interpolates a point along the route", () => {
  assert.deepEqual(pointAtRouteMeasure(route, 15), {
    type: "point",
    x: 10,
    y: 5,
    spatialReference: { wkid: 3857 }
  });
  assert.deepEqual(pointAtRouteMeasure(route, 5), {
    type: "point",
    x: 5,
    y: 0,
    spatialReference: { wkid: 3857 }
  });
});

test("bearingVector converts compass degrees to an [x, y] unit vector", () => {
  const [x, y] = bearingVector(90); // due east
  assert.ok(Math.abs(x - 1) < 1e-9);
  assert.ok(Math.abs(y) < 1e-9);
  assert.equal(bearingVector("nope"), null);
});

test("routeDirectionSign is +1 when heading matches route direction, -1 against", () => {
  // On the second leg (northbound) a north-ish bearing (0deg) agrees -> +1
  assert.equal(routeDirectionSign(route, 15, 0), 1);
  // a south bearing (180deg) opposes -> -1
  assert.equal(routeDirectionSign(route, 15, 180), -1);
  assert.equal(routeDirectionSign(route, 15, "nope"), 1);
});

test("nearestStopIndex picks the closest stop", () => {
  const stops = [
    { geometry: { x: 0, y: 0 } },
    { geometry: { x: 10, y: 0 } },
    { geometry: { x: 10, y: 10 } }
  ];
  assert.equal(nearestStopIndex(stops, { x: 9, y: 1 }), 1);
  assert.equal(nearestStopIndex(stops, { x: 0, y: 0 }), 0);
  assert.equal(nearestStopIndex(stops, {}), 0);
});
