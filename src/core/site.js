// Project location, orientation and nearby-building ("context massing") placement.

import { sub, add, mul, dot, perp, bounds } from './geom.js';

export const DEFAULT_SITE = {
  locationName: 'Singapore',
  latitude: 1.3521,
  longitude: 103.8198,
  utcOffset: 8,
  planTopBearing: 0, // compass bearing the top of the plan faces (0 = north, 90 = east)
};

export const LOCATIONS = [
  ['Singapore', 1.3521, 103.8198, 8],
  ['Kuala Lumpur', 3.139, 101.6869, 8],
  ['Jakarta', -6.2088, 106.8456, 7],
  ['Bangkok', 13.7563, 100.5018, 7],
  ['Chennai', 13.0827, 80.2707, 5.5],
  ['Bengaluru', 12.9716, 77.5946, 5.5],
  ['Hyderabad', 17.385, 78.4867, 5.5],
  ['Mumbai', 19.076, 72.8777, 5.5],
  ['New Delhi', 28.6139, 77.209, 5.5],
  ['Dubai', 25.2048, 55.2708, 4],
  ['Riyadh', 24.7136, 46.6753, 3],
  ['London', 51.5074, -0.1278, 0],
  ['New York', 40.7128, -74.006, -5],
  ['San Francisco', 37.7749, -122.4194, -8],
  ['Sydney', -33.8688, 151.2093, 10],
  ['Tokyo', 35.6762, 139.6503, 9],
];

/** Plan-space unit vector for a compass bearing, honouring the plan's orientation. */
export function bearingToPlan(bearing, site) {
  const a = ((bearing - (site.planTopBearing || 0)) * Math.PI) / 180;
  return { x: Math.sin(a), y: Math.cos(a) };
}

/** Compass bearing of a plan-space direction. */
export function planToBearing(v, site) {
  const a = (Math.atan2(v.x, v.y) * 180) / Math.PI + (site.planTopBearing || 0);
  return ((a % 360) + 360) % 360;
}

/**
 * Places a nearby building from its user inputs: compass direction from our building, clear distance
 * from our building's outer face, frontage width facing us, depth away from us, and height.
 */
export function placeContext(el, footprint, site) {
  const b = footprint.length ? bounds(footprint) : { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  const c = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
  const u = bearingToPlan(el.bearing ?? 0, site);
  const v = perp(u);
  const reach = footprint.length ? Math.max(...footprint.map((p) => dot(sub(p, c), u))) : 0;
  const depth = Math.max(0.5, el.depth ?? 10), width = Math.max(0.5, el.width ?? 10);
  const center = add(c, mul(u, reach + Math.max(0, el.distance ?? 10) + depth / 2));
  const at = (sd, sw) => add(center, add(mul(u, (sd * depth) / 2), mul(v, (sw * width) / 2)));
  return {
    id: el.id, el, center, u, v, width, depth,
    height: Math.max(0.5, el.height ?? 10),
    corners: [at(-1, -1), at(-1, 1), at(1, 1), at(1, -1)],
  };
}
