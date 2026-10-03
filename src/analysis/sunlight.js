// Direct-sunlight analysis for windows: a window is sunlit when the sun is above the horizon,
// in front of its exterior face, and a ray from it to the sun is not blocked by our own building
// or by the nearby buildings.

import * as THREE from 'three';
import { wallPoint } from '../core/regen.js';
import { regionAt } from '../core/rooms.js';
import { sunPosition, sunTimes, localToUTC, sunVectorPlan } from '../core/solar.js';
import { planToBearing } from '../core/site.js';

/** Sun direction in Three.js world space (+Y up) plus the raw solar position. */
export function sunDirection3(site, dateStr, minutes) {
  const pos = sunPosition(localToUTC(dateStr, minutes, site.utcOffset), site.latitude, site.longitude);
  const v = sunVectorPlan(pos.azimuth, pos.altitude, site.planTopBearing);
  return { pos, dir: new THREE.Vector3(v.x, v.z, -v.y).normalize() };
}

/** One sample point per exterior window, just outside the glass, with its outward normal. */
export function windowProbes(app) {
  const { model, doc } = app;
  const probes = [];
  for (const op of model.openings.values()) {
    if (op.kind !== 'Window' || !op.valid) continue;
    const f = op.host;
    const u = (op.u0 + op.u1) / 2;
    const graph = model.graphFor(f.wall.levelId);
    const outside = [1, -1].filter((s) => !regionAt(graph, wallPoint(f, u, s * (f.t / 2 + 0.4))));
    if (!outside.length) continue; // window between two rooms: no direct sun
    const s = outside.length === 2 ? -1 : outside[0];
    const p = wallPoint(f, u, s * (f.t / 2 + 0.03));
    const n = { x: f.n.x * s, y: f.n.y * s };
    probes.push({
      id: op.id,
      mark: op.el.mark,
      levelId: f.wall.levelId,
      width: op.u1 - op.u0,
      height: op.z1 - op.z0,
      point: new THREE.Vector3(p.x, f.baseZ + (op.z0 + op.z1) / 2, -p.y),
      normal: new THREE.Vector3(n.x, 0, -n.y),
      facing: planToBearing(n, doc.site),
    });
  }
  return probes;
}

/** Opaque meshes that can cast shade (glass lets light through). */
export function occluders(view3d) {
  view3d.modelGroup.updateMatrixWorld(true);
  const list = [];
  view3d.modelGroup.traverse((o) => {
    if (o.isMesh && !o.userData.baseMaterial?.transparent) list.push(o);
  });
  return list;
}

export function sunlitSet(probes, dir, occ, raycaster) {
  const lit = new Set();
  if (dir.y <= 0) return lit;
  raycaster.far = 2000;
  for (const p of probes) {
    if (p.normal.dot(dir) <= 0.02) continue;
    raycaster.set(p.point, dir);
    if (!raycaster.intersectObjects(occ, false).length) lit.add(p.id);
  }
  return lit;
}

/** Direct-sun minutes per window across a day, sampled every `step` minutes from sunrise to sunset. */
export function analyzeWindowSunlight(app, dateStr, step = 10) {
  const site = app.doc.site;
  app.view3d.ensureBuilt();
  const probes = windowProbes(app);
  const occ = occluders(app.view3d);
  const raycaster = new THREE.Raycaster();
  const times = sunTimes(dateStr, site.latitude, site.longitude, site.utcOffset);
  const results = new Map(probes.map((p) => [p.id, { probe: p, minutes: 0, first: null, last: null }]));
  const start = times.sunrise ?? 0, end = times.sunset ?? (times.polarNight ? 0 : 1440);
  for (let m = Math.ceil(start / step) * step; m <= end; m += step) {
    const { dir } = sunDirection3(site, dateStr, m);
    for (const id of sunlitSet(probes, dir, occ, raycaster)) {
      const r = results.get(id);
      r.minutes += step;
      r.first ??= m;
      r.last = m;
    }
  }
  return { date: dateStr, step, times, results };
}
