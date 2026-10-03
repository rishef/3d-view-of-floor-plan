// Turns the regenerated model into Three.js meshes.
// Plan (x, y) + elevation z maps to Three.js (x, z, -y) with +Y up.

import * as THREE from 'three';
import { wallPoint } from '../core/regen.js';

const T = (x, y, z) => new THREE.Vector3(x, z, -y);

export class MaterialCache {
  constructor() {
    this.cache = new Map();
    this.edge = new THREE.LineBasicMaterial({ color: 0x2b3036, transparent: true, opacity: 0.5 });
    this.glass = new THREE.MeshStandardMaterial({ color: 0x9cc7e4, transparent: true, opacity: 0.38, roughness: 0.05, metalness: 0.1, depthWrite: false, side: THREE.DoubleSide });
    this.selected = new THREE.MeshStandardMaterial({ color: 0x4a90ff, emissive: 0x0b3f9e, emissiveIntensity: 0.45, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    this.selectedGlass = new THREE.MeshStandardMaterial({ color: 0x4a90ff, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide });
    this.sunGlass = new THREE.MeshStandardMaterial({ color: 0xffd36b, emissive: 0xffb020, emissiveIntensity: 0.9, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide });
  }

  /** offset pushes coplanar faces back so floor tops win over wall tops and edges draw on top. */
  get(color, offset = 1) {
    const key = `${color}|${offset}`;
    if (!this.cache.has(key)) {
      this.cache.set(key, new THREE.MeshStandardMaterial({
        color, roughness: 0.92, metalness: 0,
        polygonOffset: true, polygonOffsetFactor: offset, polygonOffsetUnits: offset,
      }));
    }
    return this.cache.get(key);
  }
}

/** A wall solid: two faces with holes, top, split bottom, end caps and opening reveals. */
export function wallGeometry(f) {
  const H = f.H, h = f.t / 2;
  const ops = f.openings.filter((o) => o.valid);
  const pos = [];
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), nn = new THREE.Vector3();
  const W = (u, v, z) => {
    const p = wallPoint(f, u, v);
    return T(p.x, p.y, f.baseZ + z);
  };
  // Orient each triangle against the intended outward normal, so winding never matters.
  const tri = (a, b, c, normal) => {
    e1.subVectors(b, a);
    e2.subVectors(c, a);
    nn.crossVectors(e1, e2);
    const [p, q, r] = nn.dot(normal) < 0 ? [a, c, b] : [a, b, c];
    pos.push(p.x, p.y, p.z, q.x, q.y, q.z, r.x, r.y, r.z);
  };
  const quad = (a, b, c, d, normal) => { tri(a, b, c, normal); tri(a, c, d, normal); };

  const nLeft = new THREE.Vector3(f.n.x, 0, -f.n.y);
  const nRight = nLeft.clone().negate();
  const dPos = new THREE.Vector3(f.d.x, 0, -f.d.y);
  const dNeg = dPos.clone().negate();
  const up = new THREE.Vector3(0, 1, 0), down = new THREE.Vector3(0, -1, 0);

  for (const side of [1, -1]) {
    const u0 = side > 0 ? f.uSL : f.uSR, u1 = side > 0 ? f.uEL : f.uER;
    const outer = [new THREE.Vector2(u0, 0)];
    const holes = [];
    for (const o of ops) {
      if (o.z0 <= 1e-4) {
        outer.push(new THREE.Vector2(o.u0, 0), new THREE.Vector2(o.u0, o.z1), new THREE.Vector2(o.u1, o.z1), new THREE.Vector2(o.u1, 0));
      } else {
        holes.push([new THREE.Vector2(o.u0, o.z0), new THREE.Vector2(o.u1, o.z0), new THREE.Vector2(o.u1, o.z1), new THREE.Vector2(o.u0, o.z1)]);
      }
    }
    outer.push(new THREE.Vector2(u1, 0), new THREE.Vector2(u1, H), new THREE.Vector2(u0, H));
    const all = outer.concat(...holes);
    const normal = side > 0 ? nLeft : nRight;
    for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(outer, holes)) {
      const P = (q) => W(q.x, side * h, q.y);
      tri(P(all[i]), P(all[j]), P(all[k]), normal);
    }
  }

  quad(W(f.uSL, h, H), W(f.uEL, h, H), W(f.uER, -h, H), W(f.uSR, -h, H), up);

  let cl = f.uSL, cr = f.uSR;
  for (const o of ops) {
    if (o.z0 > 1e-4) continue;
    quad(W(cl, h, 0), W(o.u0, h, 0), W(o.u0, -h, 0), W(cr, -h, 0), down);
    cl = cr = o.u1;
  }
  quad(W(cl, h, 0), W(f.uEL, h, 0), W(f.uER, -h, 0), W(cr, -h, 0), down);

  quad(W(f.uSL, h, 0), W(f.uSR, -h, 0), W(f.uSR, -h, H), W(f.uSL, h, H), dNeg);
  quad(W(f.uEL, h, 0), W(f.uER, -h, 0), W(f.uER, -h, H), W(f.uEL, h, H), dPos);

  for (const o of ops) {
    quad(W(o.u0, h, o.z0), W(o.u0, -h, o.z0), W(o.u0, -h, o.z1), W(o.u0, h, o.z1), dPos);
    quad(W(o.u1, h, o.z0), W(o.u1, -h, o.z0), W(o.u1, -h, o.z1), W(o.u1, h, o.z1), dNeg);
    quad(W(o.u0, h, o.z1), W(o.u1, h, o.z1), W(o.u1, -h, o.z1), W(o.u0, -h, o.z1), down);
    if (o.z0 > 1e-4) quad(W(o.u0, h, o.z0), W(o.u1, h, o.z0), W(o.u1, -h, o.z0), W(o.u0, -h, o.z0), up);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}

/** A box in a wall's local frame: u along the wall, v across it, z up from the wall base. */
function wallBox(f, u0, u1, v0, v1, z0, z1, material) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(Math.max(1e-3, u1 - u0), Math.max(1e-3, z1 - z0), Math.max(1e-3, v1 - v0)), material);
  const c = wallPoint(f, (u0 + u1) / 2, (v0 + v1) / 2);
  m.position.copy(T(c.x, c.y, f.baseZ + (z0 + z1) / 2));
  m.rotation.y = Math.atan2(f.d.y, f.d.x);
  return m;
}

function doorObject(op, mats) {
  const f = op.host, g = new THREE.Group();
  const fw = 0.05, t = f.t / 2 + 0.01;
  const frameMat = mats.get(op.type.glass ? op.type.color : '#e9e6df');
  g.add(
    wallBox(f, op.u0, op.u0 + fw, -t, t, 0, op.z1, frameMat),
    wallBox(f, op.u1 - fw, op.u1, -t, t, 0, op.z1, frameMat),
    wallBox(f, op.u0, op.u1, -t, t, op.z1 - fw, op.z1, frameMat),
  );
  // Each leaf hangs on a hinge pivot so the walkthrough can swing it open, matching the plan swing.
  const leaves = op.type.leaves === 2 ? 2 : 1;
  const lw = (op.u1 - op.u0 - 2 * fw) / leaves;
  const side = op.el.flipFacing ? -1 : 1; // swing side, as in the plan symbol
  const hinges = leaves === 2 ? [[op.u0 + fw, 1], [op.u1 - fw, -1]] : op.el.flipHand ? [[op.u1 - fw, -1]] : [[op.u0 + fw, 1]];
  const vh = side * Math.max(0.025, f.t / 2 - 0.03); // hinge line just inside the swing-side face
  const lt = 0.044;
  for (const [uh, s] of hinges) {
    const hp = wallPoint(f, uh, vh);
    const hinge = new THREE.Group();
    hinge.position.copy(T(hp.x, hp.y, f.baseZ));
    hinge.rotation.y = Math.atan2(f.d.y, f.d.x); // local x along the wall, local -z toward +n
    const swing = new THREE.Group();
    swing.userData.doorSwing = { open: (Math.PI / 2) * 0.95 * side * s, center: wallPoint(f, (op.u0 + op.u1) / 2, 0), levelId: f.wall.levelId, amount: 0 };
    hinge.add(swing);
    // part spanning [x0, x1] along the leaf from the hinge, [d0, d1] of leaf depth, [z0, z1] up
    const part = (x0, x1, d0, d1, z0, z1, mat) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(Math.max(1e-3, x1 - x0), Math.max(1e-3, z1 - z0), Math.max(1e-3, d1 - d0)), mat);
      m.position.set((s * (x0 + x1)) / 2, (z0 + z1) / 2, (side * (d0 + d1)) / 2);
      swing.add(m);
    };
    const top = op.z1 - fw - 0.003;
    if (op.type.glass) {
      const sm = mats.get(op.type.color);
      part(0, 0.06, 0, lt, 0.01, top, sm);
      part(lw - 0.06, lw, 0, lt, 0.01, top, sm);
      part(0, lw, 0, lt, 0.01, 0.12, sm);
      part(0, lw, 0, lt, top - 0.06, top, sm);
      const glass = new THREE.Mesh(new THREE.BoxGeometry(lw - 0.12, top - 0.18, 0.012), mats.glass);
      glass.position.set((s * lw) / 2, (0.12 + top - 0.06) / 2, (side * lt) / 2);
      swing.add(glass);
    } else {
      part(0.003, lw - 0.003, 0, lt, 0.01, top, mats.get(op.type.color ?? '#8a5a3b'));
    }
    g.add(hinge);
  }
  return g;
}

function windowObject(op, mats) {
  const f = op.host, g = new THREE.Group();
  const fw = 0.06, fd = 0.045;
  const fm = mats.get(op.type.color ?? '#3f454c');
  g.add(
    wallBox(f, op.u0, op.u0 + fw, -fd, fd, op.z0, op.z1, fm),
    wallBox(f, op.u1 - fw, op.u1, -fd, fd, op.z0, op.z1, fm),
    wallBox(f, op.u0, op.u1, -fd, fd, op.z0, op.z0 + fw, fm),
    wallBox(f, op.u0, op.u1, -fd, fd, op.z1 - fw, op.z1, fm),
    wallBox(f, op.u0 - 0.02, op.u1 + 0.02, -f.t / 2 - 0.04, -f.t / 2 + 0.02, op.z0 - 0.03, op.z0, mats.get('#d8d4cc')),
  );
  if (op.u1 - op.u0 > 1.4) {
    const c = (op.u0 + op.u1) / 2;
    g.add(wallBox(f, c - fw / 2, c + fw / 2, -fd, fd, op.z0, op.z1, fm));
  }
  const glass = wallBox(f, op.u0 + fw, op.u1 - fw, -0.006, 0.006, op.z0 + fw, op.z1 - fw, mats.glass);
  glass.userData.isGlass = true;
  g.add(glass);
  return g;
}

function floorMesh(el, type, elevation, mats) {
  if (el.boundary.length < 3) return null;
  const th = type?.thickness ?? 0.2;
  const shape = new THREE.Shape(el.boundary.map((p) => new THREE.Vector2(p.x, p.y)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: th, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, elevation + (el.offset || 0) - th, 0);
  return new THREE.Mesh(geo, mats.get(type?.color ?? '#bdb9b1', 1));
}

function columnMesh(c, mats) {
  const h = c.topZ - c.baseZ;
  const m = new THREE.Mesh(new THREE.BoxGeometry(c.w, h, c.dd), mats.get(c.type?.color ?? '#a9a6a0', 2));
  m.position.copy(T(c.x, c.y, c.baseZ + h / 2));
  m.rotation.y = (c.rot * Math.PI) / 180;
  return m;
}

function contextMesh(c, groundZ, mats) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(c.width, c.height, c.depth), mats.get('#cfd4da', 1));
  m.position.copy(T(c.center.x, c.center.y, groundZ + c.height / 2));
  m.rotation.y = Math.atan2(c.v.y, c.v.x);
  return m;
}

function tagged(obj, id) {
  obj.userData.id = id;
  obj.traverse((o) => {
    o.userData.id = id;
    if (o.isMesh) {
      o.userData.baseMaterial = o.material;
      o.castShadow = o.material !== undefined && !o.material.transparent;
      o.receiveShadow = true;
    }
  });
  return obj;
}

function withEdges(mesh, mats) {
  const g = new THREE.Group();
  g.add(mesh);
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 25), mats.edge);
  edges.position.copy(mesh.position);
  edges.rotation.copy(mesh.rotation);
  edges.userData.isEdge = true;
  g.add(edges);
  return g;
}

export function buildModel(app, mats) {
  const { doc, model } = app;
  const out = [];
  for (const f of model.walls.values()) {
    const mesh = new THREE.Mesh(wallGeometry(f), mats.get(f.type?.color ?? '#cfcac1', 2));
    out.push(tagged(withEdges(mesh, mats), f.id));
  }
  for (const op of model.openings.values()) {
    if (!op.valid) continue;
    out.push(tagged(op.kind === 'Door' ? doorObject(op, mats) : windowObject(op, mats), op.id));
  }
  for (const el of doc.byCategory('Floor')) {
    const mesh = floorMesh(el, doc.type(el.typeId), doc.get(el.levelId)?.elevation ?? 0, mats);
    if (mesh) out.push(tagged(withEdges(mesh, mats), el.id));
  }
  for (const c of model.columns.values()) out.push(tagged(withEdges(columnMesh(c, mats), mats), c.id));
  for (const c of model.context.values()) {
    const obj = tagged(withEdges(contextMesh(c, model.groundZ, mats), mats), c.id);
    obj.userData.isContext = true;
    out.push(obj);
  }
  return out;
}
