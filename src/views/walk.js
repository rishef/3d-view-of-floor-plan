// First-person walkthrough: free walking with wall collision and auto-opening doors, plus an
// automatic tour that follows doors from room to room and level to level.

import * as THREE from 'three';
import { add, sub, mul, norm, len, dist, clamp, pointInPolygon, projectOnSegment, bounds, interiorPoint } from '../core/geom.js';
import { wallPieces, wallPoint, columnCorners } from '../core/regen.js';
import { h } from '../ui/dom.js';

const EYE = 1.6;           // eye height above the level (m)
const RADIUS = 0.25;       // body radius for collisions (m)
const DOOR_REACH = 2.2;    // doors open when you are this close (m)
const SPEEDS = { slow: 0.9, normal: 1.4, fast: 2.6 }; // m/s
const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
const WALK_KEYS = new Set([...MOVE_KEYS, 'ShiftLeft', 'ShiftRight', 'PageUp', 'PageDown', 'KeyQ', 'KeyE', 'KeyT', 'Space']);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const smooth = (x) => x * x * (3 - 2 * x);

export class WalkController {
  constructor(app, view3d) {
    this.app = app;
    this.view = view3d;
    this.active = false;
    this.keys = new Set();
    this.pos = { x: 0, y: 0 };
    this.yaw = 0;
    this.pitch = -0.05;
    this.levelId = null;
    this.speed = 'normal';
    this.tour = null;
    this.cache = new Map();
    this.doors = [];
    this.doorsVersion = -1;

    this.onKeyDown = this.onKeyDown.bind(this);
    this.onKeyUp = this.onKeyUp.bind(this);
    this.onPointerDown = this.onPointerDown.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);
    this.onWheel = this.onWheel.bind(this);
    this.loop = this.loop.bind(this);

    app.on('model', () => this.cache.clear());
    app.on('view', () => {
      if (this.active && (app.viewMode === 'plan' || app.viewMode === 'schedule')) this.exit();
    });
  }

  // ---- model queries (cached per 3D build + level) ----------------------------------------
  cached(key, fn) {
    const k = `${key}|${this.view.version}`;
    if (!this.cache.has(k)) this.cache.set(k, fn());
    return this.cache.get(k);
  }

  levelElevation(levelId = this.levelId) {
    return this.app.doc.get(levelId)?.elevation ?? 0;
  }

  /** Rooms on a level (or enclosed spaces when no rooms were placed). */
  spaces(levelId) {
    return this.cached(`spaces:${levelId}`, () => {
      const { doc, model } = this.app;
      const rooms = doc.byCategory('Room')
        .filter((r) => r.levelId === levelId && model.rooms.get(r.id))
        .map((r) => {
          const reg = model.rooms.get(r.id);
          const center = pointInPolygon({ x: r.x, y: r.y }, reg.outer) ? { x: r.x, y: r.y } : interiorPoint(reg.outer);
          return { id: r.id, name: r.name || 'Room', number: r.number, area: reg.area, poly: reg.outer, center };
        });
      if (rooms.length) return rooms;
      return model.graphFor(levelId).faces
        .filter((f) => f.area >= 2)
        .map((f, i) => {
          const poly = f.loop.map((l) => l.p);
          return { id: `space-${i}`, name: `Space ${i + 1}`, number: '', area: f.area, poly, center: interiorPoint(poly) };
        });
    });
  }

  spaceAt(p, levelId = this.levelId) {
    return this.spaces(levelId).find((s) => pointInPolygon(p, s.poly)) ?? null;
  }

  /** Doors on a level with the spaces on either side ('outside' when not in a room). */
  doorLinks(levelId) {
    return this.cached(`doors:${levelId}`, () => {
      const links = [];
      for (const op of this.app.model.openings.values()) {
        if (op.kind !== 'Door' || !op.valid || op.host.wall.levelId !== levelId) continue;
        const f = op.host;
        const u = (op.u0 + op.u1) / 2;
        const reach = f.t / 2 + 0.7;
        const pA = wallPoint(f, u, reach), pB = wallPoint(f, u, -reach);
        const a = this.spaceAt(pA, levelId)?.id ?? 'outside';
        const b = this.spaceAt(pB, levelId)?.id ?? 'outside';
        if (a !== b) links.push({ id: op.id, c: wallPoint(f, u, 0), pA, pB, a, b, n: f.n });
      }
      return links;
    });
  }

  /** Collision outlines at walking height: wall pieces (door openings left open), columns, nearby buildings. */
  obstacles(levelId) {
    return this.cached(`obs:${levelId}`, () => {
      const { model } = this.app;
      const z0 = this.levelElevation(levelId) + 0.3, z1 = z0 + 1.4;
      const out = [];
      const push = (pts, kind) => out.push({ pts, kind, b: bounds(pts) });
      for (const f of model.walls.values()) {
        if (f.baseZ > z1 || f.topZ < z0) continue;
        const doors = f.openings.filter((o) => o.valid && o.kind === 'Door' && o.z0 < z0 + 0.1).map((o) => ({ u0: o.u0, u1: o.u1 }));
        for (const pts of wallPieces(f, doors)) push(pts, 'wall');
      }
      for (const c of model.columns.values()) if (c.baseZ <= z1 && c.topZ >= z0) push(columnCorners(c), 'column');
      for (const c of model.context.values()) push(c.corners, 'context');
      return out;
    });
  }

  /** Pushes a body at p out of every obstacle it overlaps. */
  resolve(p) {
    let q = { ...p };
    const obs = this.obstacles(this.levelId);
    for (let iter = 0; iter < 4; iter++) {
      let moved = false;
      for (const { pts, b } of obs) {
        if (q.x < b.minX - RADIUS || q.x > b.maxX + RADIUS || q.y < b.minY - RADIUS || q.y > b.maxY + RADIUS) continue;
        let best = null;
        for (let i = 0; i < pts.length; i++) {
          const pr = projectOnSegment(q, pts[i], pts[(i + 1) % pts.length]);
          if (!best || pr.dist < best.dist) best = pr;
        }
        const inside = pointInPolygon(q, pts);
        if (inside) {
          const dir = norm(sub(best.point, q));
          q = add(best.point, mul(dir, RADIUS));
          moved = true;
        } else if (best.dist < RADIUS - 1e-6) {
          const dir = norm(sub(q, best.point));
          q = add(best.point, mul(dir, RADIUS));
          moved = true;
        }
      }
      if (!moved) break;
    }
    return q;
  }

  moveBy(delta) {
    const steps = Math.max(1, Math.ceil(len(delta) / 0.08));
    for (let i = 0; i < steps; i++) this.pos = this.resolve(add(this.pos, mul(delta, 1 / steps)));
  }

  // ---- entering & leaving ----------------------------------------------------------------
  enter({ tour = false } = {}) {
    const { app, view } = this;
    if (this.active) {
      if (tour) this.startTour();
      return;
    }
    if (app.viewMode === 'plan' || app.viewMode === 'schedule') app.setViewMode('3d');
    view.ensureBuilt();
    this.saved = {
      pos: view.camera.position.clone(), target: view.controls.target.clone(),
      fov: view.camera.fov, near: view.camera.near, far: view.camera.far, sectionBox: app.viewSettings.sectionBox,
      edges: app.viewSettings.edges,
    };
    app.viewSettings.edges = false; // CAD edge lines look wrong at eye level
    view.updateEdges();
    if (app.viewSettings.sectionBox) app.setViewSetting('sectionBox', false);
    view.controls.enabled = false;
    view.fill.intensity = 0.9; // soft indoor light so rooms in shade stay readable
    view.camera.fov = 70;
    view.camera.near = 0.05;
    view.camera.far = 4000;
    view.camera.updateProjectionMatrix();
    this.active = true;
    this.levelId = app.activeLevelId;
    this.placeAtStart();
    this.buildHud();
    window.addEventListener('keydown', this.onKeyDown, true);
    window.addEventListener('keyup', this.onKeyUp, true);
    const el = view.renderer.domElement;
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    this.last = performance.now();
    this.lastSpace = undefined;
    requestAnimationFrame(this.loop);
    app.emit('walk', { active: true });
    if (tour) this.startTour();
    else this.toastMsg('Walk mode — W A S D to move, drag to look');
  }

  exit() {
    if (!this.active) return;
    const { app, view } = this;
    this.active = false;
    this.tour = null;
    this.keys.clear();
    window.removeEventListener('keydown', this.onKeyDown, true);
    window.removeEventListener('keyup', this.onKeyUp, true);
    const el = view.renderer.domElement;
    el.removeEventListener('pointerdown', this.onPointerDown);
    el.removeEventListener('pointermove', this.onPointerMove);
    el.removeEventListener('pointerup', this.onPointerUp);
    el.removeEventListener('wheel', this.onWheel);
    for (const s of this.doors) { s.userData.doorSwing.amount = 0; s.rotation.y = 0; }
    this.hud?.remove();
    this.mini?.remove();
    this.fadeEl?.remove();
    this.toastEl?.remove();
    view.container.classList.remove('walking');
    const sv = this.saved;
    view.camera.fov = sv.fov;
    view.camera.near = sv.near;
    view.camera.far = sv.far;
    view.camera.position.copy(sv.pos);
    view.controls.target.copy(sv.target);
    view.camera.updateProjectionMatrix();
    view.controls.enabled = true;
    view.fill.intensity = 0;
    view.controls.update();
    app.viewSettings.edges = sv.edges;
    view.updateEdges();
    if (sv.sectionBox) app.setViewSetting('sectionBox', true);
    view.render();
    app.emit('walk', { active: false });
  }

  /** Start in the selected room, else just outside the front door looking in, else in the first room. */
  placeAtStart() {
    const { app } = this;
    const sel = [...app.selection].map((id) => app.doc.get(id)).find((e) => e?.category === 'Room' && e.levelId === this.levelId);
    const spaces = this.spaces(this.levelId);
    const room = sel ? spaces.find((s) => s.id === sel.id) : null;
    if (room) {
      this.pos = { ...room.center };
      this.yaw = 0;
      return;
    }
    const front = this.doorLinks(this.levelId).find((l) => l.a === 'outside' || l.b === 'outside');
    if (front) {
      const outside = front.a === 'outside' ? front.pA : front.pB;
      const out = norm(sub(outside, front.c));
      this.pos = this.resolve(add(outside, mul(out, 2.5)));
      this.yaw = Math.atan2(-out.y, -out.x);
      return;
    }
    if (spaces.length) {
      this.pos = { ...spaces[0].center };
      this.yaw = 0;
      return;
    }
    const fp = this.app.model.footprint;
    const b = fp.length ? bounds(fp) : { minX: -2, maxX: 2, minY: -2, maxY: 2 };
    this.pos = { x: (b.minX + b.maxX) / 2, y: b.minY - 4 };
    this.yaw = Math.PI / 2;
  }

  teleport(p, levelId = this.levelId) {
    if (!this.active) return;
    this.stopTour();
    if (levelId !== this.levelId) this.setLevel(levelId, false);
    this.pos = this.resolve(p);
  }

  setLevel(levelId, keepInside = true) {
    this.levelId = levelId;
    if (this.app.activeLevelId !== levelId) this.app.setActiveLevel(levelId);
    if (keepInside && !this.spaceAt(this.pos)) {
      const first = this.spaces(levelId)[0];
      if (first) this.pos = { ...first.center };
    }
    this.pos = this.resolve(this.pos);
    this.toastMsg(this.app.doc.get(levelId)?.name ?? 'Level');
  }

  changeLevel(step) {
    const levels = this.app.doc.levels();
    const i = levels.findIndex((l) => l.id === this.levelId);
    const next = levels[i + step];
    if (!next) return;
    this.stopTour();
    this.fadeThen(() => this.setLevel(next.id));
  }

  // ---- auto tour ---------------------------------------------------------------------------
  /** Route through every room: depth-first over the door graph, one leg per level. */
  planTour() {
    const levels = this.app.doc.levels();
    const startIdx = Math.max(0, levels.findIndex((l) => l.id === this.levelId));
    const order = [...levels.slice(startIdx), ...levels.slice(0, startIdx).reverse()];
    const legs = [];
    order.forEach((lvl, legNo) => {
      const spaces = this.spaces(lvl.id);
      if (!spaces.length) return;
      const byId = new Map(spaces.map((s) => [s.id, s]));
      const links = this.doorLinks(lvl.id);
      const adj = new Map();
      for (const l of links) {
        if (!adj.has(l.a)) adj.set(l.a, []);
        if (!adj.has(l.b)) adj.set(l.b, []);
        adj.get(l.a).push({ to: l.b, l });
        adj.get(l.b).push({ to: l.a, l });
      }
      const wps = [];
      const go = (p, extra = {}) => wps.push({ x: p.x, y: p.y, ...extra });
      const through = (l, from) => {
        const [p0, p1] = l.a === from ? [l.pA, l.pB] : [l.pB, l.pA];
        go(p0);
        go(l.c);
        go(p1);
      };
      const visited = new Set();
      const dfs = (node) => {
        visited.add(node);
        for (const e of adj.get(node) ?? []) {
          if (visited.has(e.to) || e.to === 'outside') continue;
          through(e.l, node);
          const s = byId.get(e.to);
          go(s.center, { pause: 3, space: s });
          dfs(e.to);
          through(e.l, e.to);
          go(byId.get(node).center);
        }
      };
      let start = legNo === 0 ? this.spaceAt(this.pos, lvl.id)?.id ?? null : null;
      if (!start && legNo === 0) {
        const front = links.find((l) => l.a === 'outside' || l.b === 'outside');
        if (front) {
          const inside = front.a === 'outside' ? front.b : front.a;
          const outsidePt = front.a === 'outside' ? front.pA : front.pB;
          go(outsidePt);
          through(front, 'outside');
          start = inside;
        }
      }
      if (!start) start = spaces[0].id;
      go(byId.get(start).center, { pause: 3, space: byId.get(start), teleport: legNo > 0 });
      dfs(start);
      // drop the walk back to where we came from at the very end
      while (wps.length > 1 && !wps[wps.length - 1].pause) wps.pop();
      for (const s of spaces) {
        if (!visited.has(s.id)) go(s.center, { pause: 3, space: s, teleport: true });
      }
      legs.push({ levelId: lvl.id, wps });
    });
    return legs;
  }

  startTour() {
    const legs = this.planTour();
    if (!legs.length) {
      this.toastMsg('Place rooms first (Room tool) so the tour knows where to go');
      return;
    }
    this.tour = { legs, leg: 0, i: 0, pause: 0, busy: false };
    if (legs[0].levelId !== this.levelId) this.setLevel(legs[0].levelId, false);
    this.syncHud();
  }

  stopTour() {
    if (!this.tour) return;
    this.tour = null;
    this.syncHud();
  }

  updateTour(dt) {
    const t = this.tour;
    if (t.busy) return;
    const leg = t.legs[t.leg];
    const wp = leg?.wps[t.i];
    if (!leg) {
      this.tour = null;
      this.toastMsg('Tour complete');
      this.syncHud();
      return;
    }
    if (!wp) {
      t.leg += 1;
      t.i = 0;
      const next = t.legs[t.leg];
      if (next) {
        t.busy = true;
        this.fadeThen(() => {
          this.setLevel(next.levelId, false);
          this.pos = { x: next.wps[0].x, y: next.wps[0].y };
          t.busy = false;
        });
      }
      return;
    }
    if (t.pause > 0) {
      t.pause -= dt;
      const k = 1 - Math.max(0, t.pause) / t.pauseTotal;
      this.yaw = t.pauseYaw + Math.sin(k * Math.PI * 2) * 0.85;
      this.pitch += (-0.05 - this.pitch) * Math.min(1, dt * 3);
      if (t.pause <= 0) t.i += 1;
      return;
    }
    if (wp.teleport && dist(wp, this.pos) > 0.05) {
      t.busy = true;
      this.fadeThen(() => {
        this.pos = { x: wp.x, y: wp.y };
        t.busy = false;
      });
      return;
    }
    const d = sub(wp, this.pos);
    const L = len(d);
    if (L < 0.04) {
      this.pos = { x: wp.x, y: wp.y };
      if (wp.pause) {
        t.pause = t.pauseTotal = wp.pause;
        t.pauseYaw = this.yaw;
      } else {
        t.i += 1;
      }
      return;
    }
    const want = Math.atan2(d.y, d.x);
    const diff = wrap(want - this.yaw);
    this.yaw += clamp(diff, -2.6 * dt, 2.6 * dt);
    this.pitch += (-0.05 - this.pitch) * Math.min(1, dt * 3);
    if (Math.abs(diff) < 0.7) this.pos = add(this.pos, mul(norm(d), Math.min(L, SPEEDS[this.speed] * dt)));
  }

  // ---- per-frame update -------------------------------------------------------------------
  loop(now) {
    if (!this.active) return;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const before = `${this.pos.x.toFixed(3)},${this.pos.y.toFixed(3)},${this.yaw.toFixed(3)},${this.levelId}`;
    if (this.tour) this.updateTour(dt);
    else this.updateManual(dt);
    this.updateDoors(dt);
    this.applyCamera();
    this.view.renderer.render(this.view.scene, this.view.camera);
    this.updateHud();
    const after = `${this.pos.x.toFixed(3)},${this.pos.y.toFixed(3)},${this.yaw.toFixed(3)},${this.levelId}`;
    if (after !== before) this.app.emit('walk', { active: true });
    requestAnimationFrame(this.loop);
  }

  updateManual(dt) {
    const k = this.keys;
    let fwd = 0, side = 0, turn = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) fwd += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) fwd -= 1;
    if (k.has('KeyA')) side -= 1;
    if (k.has('KeyD')) side += 1;
    if (k.has('ArrowLeft')) turn += 1;
    if (k.has('ArrowRight')) turn -= 1;
    this.yaw += turn * 1.9 * dt;
    if (!fwd && !side) return;
    const run = k.has('ShiftLeft') || k.has('ShiftRight') ? 2 : 1;
    const f = { x: Math.cos(this.yaw), y: Math.sin(this.yaw) };
    const r = { x: Math.sin(this.yaw), y: -Math.cos(this.yaw) };
    this.moveBy(mul(norm(add(mul(f, fwd), mul(r, side))), SPEEDS[this.speed] * run * dt));
  }

  updateDoors(dt) {
    if (this.doorsVersion !== this.view.version) {
      this.doors = [];
      this.view.modelGroup.traverse((o) => { if (o.userData.doorSwing) this.doors.push(o); });
      this.doorsVersion = this.view.version;
    }
    for (const s of this.doors) {
      const ds = s.userData.doorSwing;
      const near = ds.levelId === this.levelId && dist(ds.center, this.pos) < DOOR_REACH;
      ds.amount = clamp(ds.amount + (near ? 1 : -1) * dt * 1.8, 0, 1);
      s.rotation.y = smooth(ds.amount) * ds.open;
    }
  }

  applyCamera() {
    const cam = this.view.camera;
    cam.position.set(this.pos.x, this.levelElevation() + EYE, -this.pos.y);
    const c = Math.cos(this.pitch);
    const dir = new THREE.Vector3(Math.cos(this.yaw) * c, Math.sin(this.pitch), -Math.sin(this.yaw) * c);
    cam.lookAt(cam.position.clone().add(dir));
  }

  // ---- input --------------------------------------------------------------------------------
  onKeyDown(e) {
    if (document.querySelector('.modal-backdrop')) return;
    if (e.target instanceof Element && e.target.closest('input, select, textarea')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (this.tour) this.stopTour();
      else this.exit();
      return;
    }
    if (!WALK_KEYS.has(e.code)) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.repeat && !MOVE_KEYS.has(e.code)) return;
    if (MOVE_KEYS.has(e.code)) this.stopTour();
    if (e.code === 'PageUp' || e.code === 'KeyE') this.changeLevel(1);
    else if (e.code === 'PageDown' || e.code === 'KeyQ') this.changeLevel(-1);
    else if (e.code === 'KeyT') (this.tour ? this.stopTour() : this.startTour());
    this.keys.add(e.code);
  }

  onKeyUp(e) {
    this.keys.delete(e.code);
  }

  onPointerDown(e) {
    this.drag = { x: e.clientX, y: e.clientY };
    this.view.renderer.domElement.setPointerCapture(e.pointerId);
  }

  onPointerMove(e) {
    if (!this.drag) return;
    const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
    this.drag = { x: e.clientX, y: e.clientY };
    if (Math.abs(dx) + Math.abs(dy) > 0) this.stopTour();
    this.yaw -= dx * 0.0045;
    this.pitch = clamp(this.pitch - dy * 0.0035, -1.25, 1.25);
  }

  onPointerUp() {
    this.drag = null;
  }

  onWheel(e) {
    e.preventDefault();
    this.stopTour();
    const f = { x: Math.cos(this.yaw), y: Math.sin(this.yaw) };
    this.moveBy(mul(f, clamp(-e.deltaY * 0.004, -0.6, 0.6)));
  }

  // ---- HUD, minimap, plan marker -------------------------------------------------------------
  buildHud() {
    const pane = this.view.container;
    pane.classList.add('walking');
    this.roomEl = h('div', { class: 'walk-room' });
    this.levelEl = h('div', { class: 'walk-level' });
    this.tourBtn = h('button', { type: 'button', class: 'walk-btn primary', onclick: () => (this.tour ? this.stopTour() : this.startTour()) });
    const speed = h('select', { class: 'walk-speed', title: 'Walking speed', onchange: (e) => { this.speed = e.target.value; e.target.blur(); } },
      Object.keys(SPEEDS).map((k) => h('option', { value: k, selected: k === this.speed }, `${k[0].toUpperCase()}${k.slice(1)} pace`)));
    this.hud = h('div', { class: 'walk-hud' },
      h('div', { class: 'walk-info' }, this.roomEl, this.levelEl),
      h('div', { class: 'walk-btns' },
        this.tourBtn,
        h('button', { type: 'button', class: 'walk-btn', title: 'Up a level (E / Page Up)', onclick: () => this.changeLevel(1) }, 'Level ▲'),
        h('button', { type: 'button', class: 'walk-btn', title: 'Down a level (Q / Page Down)', onclick: () => this.changeLevel(-1) }, 'Level ▼'),
        speed,
        h('button', { type: 'button', class: 'walk-btn exit', onclick: () => this.exit() }, 'Exit walk (Esc)')),
      h('div', { class: 'walk-help' }, 'W A S D / ↑↓ move · ←→ or drag to look · Shift run · wheel step · Q/E change level · T tour · click the plan to jump'));
    this.mini = h('canvas', { class: 'walk-mini', width: 220, height: 170 });
    this.fadeEl = h('div', { class: 'walk-fade' });
    this.toastEl = h('div', { class: 'walk-toast' });
    pane.append(this.hud, this.mini, this.fadeEl, this.toastEl);
    this.syncHud();
  }

  syncHud() {
    if (!this.tourBtn) return;
    this.tourBtn.textContent = this.tour ? '❚❚ Pause tour' : '▶ Auto tour';
  }

  /** True while standing in a door opening (between rooms, inside the wall thickness). */
  inDoorway() {
    return this.doorLinks(this.levelId).some((l) => dist(l.c, this.pos) < 0.75);
  }

  updateHud() {
    const space = this.spaceAt(this.pos);
    if (!space && this.lastSpace !== undefined && this.inDoorway()) {
      this.drawMinimap();
      return; // keep showing the room we are leaving until we are through
    }
    const key = `${space?.id ?? 'out'}|${this.levelId}`;
    if (key !== this.lastSpace) {
      const changedRoom = this.lastSpace !== undefined && space;
      this.lastSpace = key;
      this.roomEl.textContent = space ? space.name : 'Outside';
      const lvl = this.app.doc.get(this.levelId);
      this.levelEl.textContent = [lvl?.name, space?.number ? `Room ${space.number}` : null, space ? `${space.area.toFixed(1)} m²` : null].filter(Boolean).join(' · ');
      if (changedRoom) this.toastMsg(space.name);
    }
    this.drawMinimap();
  }

  toastMsg(text) {
    if (!this.toastEl) return;
    this.toastEl.textContent = text;
    this.toastEl.classList.remove('show');
    void this.toastEl.offsetWidth; // restart the CSS animation
    this.toastEl.classList.add('show');
  }

  fadeThen(fn) {
    this.fadeEl.classList.add('on');
    setTimeout(() => {
      fn();
      this.fadeEl.classList.remove('on');
    }, 380);
  }

  /** Static minimap image per level: rooms and walls, scaled to fit. */
  miniBase() {
    return this.cached(`mini:${this.levelId}`, () => {
      const W = this.mini.width, H = this.mini.height;
      const polys = this.obstacles(this.levelId).filter((o) => o.kind !== 'context').map((o) => o.pts);
      const spaces = this.spaces(this.levelId);
      const pts = [...polys.flat(), ...spaces.flatMap((s) => s.poly)];
      const b = pts.length ? bounds(pts) : { minX: -5, maxX: 5, minY: -5, maxY: 5 };
      const pad = 3;
      const k = Math.min((W - 16) / (b.maxX - b.minX + 2 * pad), (H - 16) / (b.maxY - b.minY + 2 * pad));
      const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
      const S = (p) => ({ x: W / 2 + (p.x - cx) * k, y: H / 2 - (p.y - cy) * k });
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      const g = c.getContext('2d');
      const poly = (ps) => {
        g.beginPath();
        ps.forEach((p, i) => { const s = S(p); if (i) g.lineTo(s.x, s.y); else g.moveTo(s.x, s.y); });
        g.closePath();
      };
      g.fillStyle = 'rgba(255,255,255,0.92)';
      g.fillRect(0, 0, W, H);
      g.fillStyle = 'rgba(64,140,255,0.12)';
      for (const s of spaces) { poly(s.poly); g.fill(); }
      g.fillStyle = '#3a4048';
      for (const p of polys) { poly(p); g.fill(); }
      return { canvas: c, S, k };
    });
  }

  drawMinimap() {
    const show = this.app.viewMode === '3d';
    this.mini.hidden = !show;
    if (!show) return;
    const base = this.miniBase();
    const g = this.mini.getContext('2d');
    g.clearRect(0, 0, this.mini.width, this.mini.height);
    g.drawImage(base.canvas, 0, 0);
    this.drawMarker(g, base.S(this.pos), 28);
  }

  drawMarker(g, s, reach) {
    const a = -this.yaw; // screen y points down
    g.save();
    g.beginPath();
    g.moveTo(s.x, s.y);
    g.arc(s.x, s.y, reach, a - 0.6, a + 0.6);
    g.closePath();
    g.fillStyle = 'rgba(245,159,0,0.28)';
    g.fill();
    g.beginPath();
    g.arc(s.x, s.y, 6, 0, Math.PI * 2);
    g.fillStyle = '#f08c00';
    g.fill();
    g.lineWidth = 2;
    g.strokeStyle = '#fff';
    g.stroke();
    g.restore();
  }

  /** "You are here" marker in the floor plan. */
  drawPlanMarker(ctx, view) {
    if (!this.active || this.levelId !== this.app.activeLevelId) return;
    this.drawMarker(ctx, view.toScreen(this.pos), 46);
  }
}
