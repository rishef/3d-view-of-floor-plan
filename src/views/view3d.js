import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildModel, MaterialCache } from './build3d.js';
import { sunTimes } from '../core/solar.js';
import { bearingToPlan } from '../core/site.js';
import { sunDirection3, windowProbes, occluders, sunlitSet } from '../analysis/sunlight.js';

const VIEW_DIRS = {
  iso: new THREE.Vector3(-1, 0.85, 1.25),
  top: new THREE.Vector3(0, 1, 0.0001),
  front: new THREE.Vector3(0, 0.12, 1),
  back: new THREE.Vector3(0, 0.12, -1),
  left: new THREE.Vector3(-1, 0.12, 0),
  right: new THREE.Vector3(1, 0.12, 0),
};
const DEFAULT_SUN = new THREE.Vector3(-0.55, 1, 0.45).normalize();
const SKY = { night: new THREE.Color('#1b2433'), dusk: new THREE.Color('#e7b48e'), day: new THREE.Color('#cfe0ef'), neutral: new THREE.Color('#e3e8ed') };
const clamp01 = (v) => Math.max(0, Math.min(1, v));

/** {3D} view: rebuilt from the model after every change, render-on-demand, with an optional sun study. */
export class View3D {
  constructor(container, app) {
    this.app = app;
    this.container = container;
    this.mats = new MaterialCache();

    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true }));
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.domElement.className = 'view3d-canvas';
    container.prepend(r.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = SKY.neutral.clone();
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.1, 5000);
    this.camera.position.set(-20, 18, 26);
    this.controls = new OrbitControls(this.camera, r.domElement);
    this.controls.screenSpacePanning = true;
    this.controls.addEventListener('change', () => this.render());

    this.hemi = new THREE.HemisphereLight(0xf5f8fc, 0x8d939a, 1.7);
    this.fill = new THREE.AmbientLight(0xfff4e6, 0); // switched on during walkthroughs
    this.scene.add(this.hemi, this.fill);
    const sun = (this.sun = new THREE.DirectionalLight(0xffffff, 2.3));
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    sun.shadow.bias = -0.0003;
    sun.shadow.normalBias = 0.02;
    this.scene.add(sun, sun.target);

    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(1500, 1500), new THREE.ShadowMaterial({ opacity: 0.2 }));
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.grid = new THREE.GridHelper(300, 300, 0xc0c8cf, 0xd6dce1);
    this.scene.add(this.ground, this.grid);

    this.modelGroup = new THREE.Group();
    this.sunGroup = new THREE.Group();
    this.northGroup = new THREE.Group();
    this.scene.add(this.modelGroup, this.sunGroup, this.northGroup);
    this.clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
    this.raycaster = new THREE.Raycaster();
    this.sceneBox = new THREE.Box3();
    this.buildingBox = new THREE.Box3();
    this.sunlit = new Set();
    this.sunInfo = null;
    this.fitted = false;
    this.dirty = true;
    this.rafPending = false;
    this.version = 0;

    let down = null;
    r.domElement.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, button: e.button }; });
    r.domElement.addEventListener('pointerup', (e) => {
      if (down && down.button === 0 && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 4) this.pickAt(e);
      down = null;
    });

    new ResizeObserver(() => this.resize()).observe(container);
    app.on('model', () => this.queueRebuild());
    app.on('selection', () => this.applyMaterials());
    app.on('view', () => this.applyViewSettings());
    app.on('sun', () => this.applyLighting());

    container.querySelector('.pane-tools')?.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-view]');
      if (!b) return;
      if (b.dataset.view === 'fit') this.fit();
      else if (b.dataset.view === 'walk') app.walk?.enter();
      else this.setView(b.dataset.view);
    });

    this.rebuild();
    this.applyViewSettings();
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (w < 2 || h < 2) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (!this.fitted) {
      this.fitted = true;
      this.fit();
    }
    this.render();
  }

  queueRebuild() {
    this.dirty = true;
    if (this.rafPending) return;
    this.rafPending = true;
    requestAnimationFrame(() => {
      this.rafPending = false;
      if (this.dirty) this.rebuild();
    });
  }

  /** Analyses that raycast the scene call this so they never see a stale model. */
  ensureBuilt() {
    if (this.dirty) this.rebuild();
  }

  rebuild() {
    this.dirty = false;
    this.version += 1;
    this.modelGroup.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    this.modelGroup.clear();
    for (const obj of buildModel(this.app, this.mats)) this.modelGroup.add(obj);
    this.modelGroup.updateMatrixWorld(true);

    this.sceneBox.makeEmpty();
    this.buildingBox.makeEmpty();
    for (const obj of this.modelGroup.children) {
      const b = new THREE.Box3().setFromObject(obj);
      this.sceneBox.union(b);
      if (!obj.userData.isContext) this.buildingBox.union(b);
    }
    if (this.buildingBox.isEmpty()) this.buildingBox.copy(this.sceneBox);
    const minY = this.sceneBox.isEmpty() ? 0 : this.sceneBox.min.y;
    this.ground.position.y = minY - 0.002;
    this.grid.position.y = minY - 0.001;
    this.probes = null;
    this.updateEdges();
    this.buildNorthArrow();
    this.applyLighting();
  }

  // ---- sun & lighting --------------------------------------------------------------------
  applyLighting() {
    const { sun: state } = this.app;
    const site = this.app.doc.site;
    let dir = DEFAULT_SUN.clone();
    let intensity = 2.3, hemi = 1.7;
    const color = new THREE.Color(0xffffff);
    let bg = SKY.neutral.clone();
    this.sunInfo = null;
    this.sunlit = new Set();

    if (state.enabled) {
      const s = sunDirection3(site, state.date, state.minutes);
      const alt = s.pos.altitude;
      dir = s.dir;
      const day = clamp01((alt + 6) / 18);
      intensity = alt > 0 ? 0.5 + 2.7 * clamp01(alt / 25) : 0;
      hemi = 0.18 + 1.5 * day;
      color.set('#ffa860').lerp(new THREE.Color('#fff7ec'), clamp01(alt / 30));
      bg = alt < -6 ? SKY.night.clone()
        : alt < 4 ? SKY.night.clone().lerp(SKY.dusk, clamp01((alt + 6) / 10))
          : SKY.dusk.clone().lerp(SKY.day, clamp01((alt - 4) / 16));
      this.sunInfo = { ...s.pos, times: sunTimes(state.date, site.latitude, site.longitude, site.utcOffset) };
      if (!this.probes) this.probes = windowProbes(this.app);
      if (alt > 0) this.sunlit = sunlitSet(this.probes, dir, occluders(this), this.raycaster);
      this.sunInfo.windowsLit = this.sunlit.size;
      this.sunInfo.windowsTotal = this.probes.length;
    }

    this.sun.color.copy(color);
    this.sun.intensity = intensity;
    this.sun.castShadow = intensity > 0 && this.app.viewSettings.shadows;
    this.hemi.intensity = hemi;
    this.scene.background = bg;
    this.positionSun(dir);
    this.buildSunPath();
    this.applyMaterials(false);
    this.render();
    this.app.emit('sunInfo', this.sunInfo ?? {});
  }

  /** Points the light along dir and fits the shadow frustum tightly around everything that casts. */
  positionSun(dirIn) {
    const dir = dirIn.clone();
    if (dir.y < 0.02) dir.y = 0.02;
    if (Math.abs(dir.x) < 1e-3 && Math.abs(dir.z) < 1e-3) dir.x = 1e-3; // avoid a degenerate lookAt at the zenith
    dir.normalize();
    const box = this.sceneBox.isEmpty() ? new THREE.Box3(new THREE.Vector3(-10, 0, -10), new THREE.Vector3(10, 10, 10)) : this.sceneBox;
    const center = box.getCenter(new THREE.Vector3());
    const radius = box.getSize(new THREE.Vector3()).length() / 2 + 1;
    this.sun.position.copy(center).addScaledVector(dir, radius * 2);
    this.sun.target.position.copy(center);
    this.sun.updateMatrixWorld();
    this.sun.target.updateMatrixWorld();

    const cam = this.sun.shadow.camera;
    cam.position.copy(this.sun.position);
    cam.lookAt(center);
    cam.updateMatrixWorld();
    const inv = cam.matrixWorldInverse;
    const lo = new THREE.Vector3(Infinity, Infinity, Infinity), hi = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    for (let i = 0; i < 8; i++) {
      const p = new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).applyMatrix4(inv);
      lo.min(p);
      hi.max(p);
    }
    const pad = 0.5;
    cam.left = lo.x - pad;
    cam.right = hi.x + pad;
    cam.bottom = lo.y - pad;
    cam.top = hi.y + pad;
    cam.near = Math.max(0.1, -hi.z - pad);
    cam.far = -lo.z + radius * 40; // reach the ground where long evening shadows land
    cam.updateProjectionMatrix();
  }

  buildSunPath() {
    this.sunGroup.traverse((o) => { o.geometry?.dispose(); });
    this.sunGroup.clear();
    const { sun: state } = this.app;
    if (!state.enabled || !state.showPath) return;
    const site = this.app.doc.site;
    const box = this.buildingBox.isEmpty() ? this.sceneBox : this.buildingBox;
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    center.y = box.min.y;
    const R = Math.max(12, box.getSize(new THREE.Vector3()).length() * 0.9);
    const pts = [];
    const hours = [];
    for (let m = 0; m <= 1440; m += 10) {
      const { dir } = sunDirection3(site, state.date, m);
      if (dir.y < -0.02) continue;
      const p = center.clone().addScaledVector(dir, R);
      pts.push(p);
      if (m % 60 === 0) hours.push({ p, m });
    }
    if (pts.length > 1) {
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xf59f00, transparent: true, opacity: 0.8 }));
      this.sunGroup.add(line);
    }
    const tickMat = new THREE.MeshBasicMaterial({ color: 0xf59f00 });
    for (const { p, m } of hours) {
      const tick = new THREE.Mesh(new THREE.SphereGeometry(R * 0.008, 8, 6), tickMat);
      tick.position.copy(p);
      this.sunGroup.add(tick);
      const label = this.textSprite(`${m / 60}`, '#b35c00', R * 0.035);
      label.position.copy(p).add(new THREE.Vector3(0, R * 0.03, 0));
      this.sunGroup.add(label);
    }
    const now = sunDirection3(site, state.date, state.minutes).dir;
    if (now.y > -0.02) {
      const disc = new THREE.Mesh(new THREE.SphereGeometry(R * 0.035, 20, 14), new THREE.MeshBasicMaterial({ color: 0xffd43b }));
      disc.position.copy(center).addScaledVector(now, R);
      this.sunGroup.add(disc);
      const ray = new THREE.Line(new THREE.BufferGeometry().setFromPoints([center, disc.position]), new THREE.LineDashedMaterial({ color: 0xf59f00, dashSize: R * 0.03, gapSize: R * 0.02 }));
      ray.computeLineDistances();
      this.sunGroup.add(ray);
    }
    this.sunGroup.traverse((o) => { o.castShadow = false; o.receiveShadow = false; });
  }

  textSprite(text, color, size) {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 64;
    const g = c.getContext('2d');
    g.font = '600 40px Inter, system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = color;
    g.fillText(text, 64, 34);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    s.scale.set(size * 2, size, 1);
    return s;
  }

  /** A north arrow on the ground beside the building, pointing to true north. */
  buildNorthArrow() {
    this.northGroup.traverse((o) => { o.geometry?.dispose(); });
    this.northGroup.clear();
    const box = this.buildingBox;
    if (box.isEmpty()) return;
    const size = Math.max(2, box.getSize(new THREE.Vector3()).length() * 0.08);
    const n = bearingToPlan(0, this.app.doc.site);
    const dir = new THREE.Vector3(n.x, 0, -n.y);
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    const base = new THREE.Vector3(box.min.x - size * 1.4, box.min.y + 0.01, box.max.z + size * 1.4);
    const tip = base.clone().addScaledVector(dir, size);
    const l = base.clone().addScaledVector(dir, -size * 0.4).addScaledVector(side, size * 0.45);
    const rr = base.clone().addScaledVector(dir, -size * 0.4).addScaledVector(side, -size * 0.45);
    const geo = new THREE.BufferGeometry().setFromPoints([tip, l, base, tip, base, rr]);
    const arrow = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x2b3036, side: THREE.DoubleSide }));
    const label = this.textSprite('N', '#2b3036', size * 0.5);
    label.position.copy(tip).addScaledVector(dir, size * 0.35).add(new THREE.Vector3(0, size * 0.2, 0));
    this.northGroup.add(arrow, label);
  }

  // ---- materials, selection, settings ------------------------------------------------------
  applyMaterials(render = true) {
    const sel = this.app.selection;
    this.modelGroup.traverse((o) => {
      if (!o.isMesh || !o.userData.baseMaterial) return;
      const base = o.userData.baseMaterial;
      const id = o.userData.id;
      if (sel.has(id)) o.material = base.transparent ? this.mats.selectedGlass : this.mats.selected;
      else if (o.userData.isGlass && this.sunlit.has(id)) o.material = this.mats.sunGlass;
      else o.material = base;
    });
    if (render) this.render();
  }

  updateEdges() {
    const show = this.app.viewSettings.edges;
    this.modelGroup.traverse((o) => { if (o.userData.isEdge) o.visible = show; });
  }

  applyViewSettings() {
    const vs = this.app.viewSettings;
    const level = this.app.activeLevel;
    this.clipPlane.constant = (level?.elevation ?? 0) + vs.cutHeight;
    this.renderer.clippingPlanes = vs.sectionBox ? [this.clipPlane] : [];
    this.sun.castShadow = vs.shadows && this.sun.intensity > 0;
    this.updateEdges();
    const label = this.container.querySelector('.pane-label');
    if (label) label.textContent = vs.sectionBox ? `{3D} · cut at ${level?.name ?? ''}` : '{3D}';
    this.render();
  }

  fit(dirName = 'iso') {
    const box = this.sceneBox.isEmpty() ? new THREE.Box3().setFromObject(this.modelGroup) : this.sceneBox;
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const radius = box.getSize(new THREE.Vector3()).length() / 2;
    const vfov = (this.camera.fov * Math.PI) / 180;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * this.camera.aspect);
    const dist = radius / Math.sin(Math.min(vfov, hfov) / 2);
    const dir = (VIEW_DIRS[dirName] ?? VIEW_DIRS.iso).clone().normalize();
    this.camera.position.copy(center).addScaledVector(dir, dist);
    this.controls.target.copy(center);
    this.camera.near = Math.max(0.05, dist / 500);
    this.camera.far = dist * 30;
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.render();
  }

  setView(name) { this.fit(name); }

  pickAt(e) {
    if (this.app.walk?.active) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    this.raycaster.far = Infinity;
    const clipY = this.app.viewSettings.sectionBox ? this.clipPlane.constant : Infinity;
    const hit = this.raycaster
      .intersectObjects(this.modelGroup.children, true)
      .find((x) => x.object.isMesh && x.object.userData.id && x.point.y <= clipY + 1e-3);
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    if (hit) this.app.select([hit.object.userData.id], additive ? 'toggle' : 'replace');
    else if (!additive) this.app.clearSelection();
  }

  /** Renders the current camera at several times of day (for the shadow study sheet). */
  snapshots(minutesList, width = 960, height = 600) {
    const size = this.renderer.getSize(new THREE.Vector2());
    const aspect = this.camera.aspect;
    const saved = this.app.sun.minutes;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    const shots = [];
    for (const m of minutesList) {
      this.app.sun.minutes = m;
      this.applyLighting();
      this.renderer.render(this.scene, this.camera);
      shots.push({ minutes: m, url: this.renderer.domElement.toDataURL('image/png'), info: { ...this.sunInfo } });
    }
    this.app.sun.minutes = saved;
    this.renderer.setSize(size.x, size.y);
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.applyLighting();
    return shots;
  }

  render() {
    if (!this.container.clientWidth) return;
    if (this.app.walk?.active) this.app.walk.applyCamera();
    this.renderer.render(this.scene, this.camera);
  }
}
