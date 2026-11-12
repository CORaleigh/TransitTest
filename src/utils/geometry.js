// Pure planar-geometry math on plain polyline/point structures ({ x, y },
// { paths: [...] }). No ArcGIS SDK, no state — this is the "heavy algorithm"
// layer the conventions push out of the render path (§4) and prioritize for
// unit testing (§7a).

export function pointXY(geometry) {
  if (!geometry || typeof geometry.x !== "number" || typeof geometry.y !== "number") return null;
  return [geometry.x, geometry.y];
}

export function segmentProjection(point, start, end) {
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

export function polylineLength(geometry) {
  let length = 0;
  for (const path of geometry?.paths || []) {
    for (let i = 0; i < path.length - 1; i++) {
      const projection = segmentProjection([path[i][0], path[i][1]], path[i], path[i + 1]);
      if (projection) length += projection.segmentLength;
    }
  }
  return length;
}

export function routeMeasureAtPoint(routeGeometry, pointGeometry) {
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

export function routeSegmentAtMeasure(routeGeometry, measure) {
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

export function pointAtRouteMeasure(routeGeometry, measure) {
  const segment = routeSegmentAtMeasure(routeGeometry, measure);
  if (!segment) return null;

  return {
    type: "point",
    x: segment.start[0] + (segment.end[0] - segment.start[0]) * segment.t,
    y: segment.start[1] + (segment.end[1] - segment.start[1]) * segment.t,
    spatialReference: routeGeometry.spatialReference
  };
}

export function bearingVector(bearing) {
  const value = Number(bearing);
  if (!Number.isFinite(value)) return null;

  const radians = value * Math.PI / 180;
  return [Math.sin(radians), Math.cos(radians)];
}

export function routeDirectionSign(routeGeometry, measure, bearing) {
  const segment = routeSegmentAtMeasure(routeGeometry, measure);
  const bearingDirection = bearingVector(bearing);
  if (!segment || !bearingDirection) return 1;

  const routeX = (segment.end[0] - segment.start[0]) / segment.length;
  const routeY = (segment.end[1] - segment.start[1]) / segment.length;
  return routeX * bearingDirection[0] + routeY * bearingDirection[1] >= 0 ? 1 : -1;
}

export function nearestStopIndex(stops, pointGeometry) {
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
