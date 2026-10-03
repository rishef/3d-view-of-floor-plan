// IFC4 (ISO 16739) STEP writer. Produces spatial structure (project/site/building/storeys),
// walls with voiding openings filled by doors and windows, slabs, columns, spaces, materials
// and common property sets, all as extruded-area solids that every IFC viewer understands.

import { wallFootprint, wallPoint } from '../core/regen.js';
import { polygonArea } from '../core/geom.js';

const B64 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';

/** 22-character IFC GlobalId from 128 random bits. */
export function ifcGuid() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let bits = '';
  for (const b of bytes) bits += b.toString(2).padStart(8, '0');
  let s = B64[parseInt(bits.slice(0, 2), 2)];
  for (let i = 2; i < 128; i += 6) s += B64[parseInt(bits.slice(i, i + 6), 2)];
  return s;
}

function str(s) {
  if (s === null || s === undefined || s === '') return '$';
  let out = '';
  for (const ch of String(s)) {
    const c = ch.codePointAt(0);
    if (ch === "'") out += "''";
    else if (ch === '\\') out += '\\\\';
    else if (c >= 32 && c < 127) out += ch;
    else if (c <= 0xffff) out += `\\X2\\${c.toString(16).toUpperCase().padStart(4, '0')}\\X0\\`;
    else out += `\\X4\\${c.toString(16).toUpperCase().padStart(8, '0')}\\X0\\`;
  }
  return `'${out}'`;
}

function real(x) {
  const v = Number.isFinite(x) ? Math.round(x * 1e6) / 1e6 : 0;
  const s = String(Object.is(v, -0) ? 0 : v);
  return s.includes('.') ? s : `${s}.`;
}

const ccw = (pts) => (polygonArea(pts) < 0 ? [...pts].reverse() : pts);

export function buildIFC(app) {
  const { doc, model } = app;
  const lines = [];
  let n = 0;
  const E = (s) => { n += 1; lines.push(`#${n}=${s};`); return `#${n}`; };
  const g = () => `'${ifcGuid()}'`;

  const P3 = (x, y, z) => E(`IFCCARTESIANPOINT((${real(x)},${real(y)},${real(z)}))`);
  const P2 = (x, y) => E(`IFCCARTESIANPOINT((${real(x)},${real(y)}))`);
  const D3 = (x, y, z) => E(`IFCDIRECTION((${real(x)},${real(y)},${real(z)}))`);
  const origin = P3(0, 0, 0);
  const zAxis = D3(0, 0, 1);
  const xAxis = D3(1, 0, 0);
  const A3 = (loc = origin, ref = xAxis) => E(`IFCAXIS2PLACEMENT3D(${loc},${zAxis},${ref})`);
  const world = A3();
  const LP = (rel, ax) => E(`IFCLOCALPLACEMENT(${rel ?? '$'},${ax})`);

  const ctx = E(`IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,${world},$)`);
  const body = E(`IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,${ctx},$,.MODEL_VIEW.,$)`);
  const units = [
    E('IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)'),
    E('IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)'),
    E('IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.)'),
    E('IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.)'),
  ];
  const unitAssignment = E(`IFCUNITASSIGNMENT((${units.join(',')}))`);
  const project = E(`IFCPROJECT(${g()},$,${str(doc.name)},$,$,$,$,(${ctx}),${unitAssignment})`);
  const sitePl = LP(null, world);
  const site = E(`IFCSITE(${g()},$,'Site',$,$,${sitePl},$,$,.ELEMENT.,$,$,$,$,$)`);
  const bldgPl = LP(sitePl, world);
  const building = E(`IFCBUILDING(${g()},$,'Building',$,$,${bldgPl},$,$,.ELEMENT.,$,$,$)`);
  E(`IFCRELAGGREGATES(${g()},$,$,$,${project},(${site}))`);
  E(`IFCRELAGGREGATES(${g()},$,$,$,${site},(${building}))`);

  const levels = doc.levels();
  const storeys = new Map();
  for (const lvl of levels) {
    const pl = LP(bldgPl, A3(P3(0, 0, lvl.elevation)));
    const ref = E(`IFCBUILDINGSTOREY(${g()},$,${str(lvl.name)},$,$,${pl},$,$,.ELEMENT.,${real(lvl.elevation)})`);
    storeys.set(lvl.id, { ref, pl, elev: lvl.elevation, items: [], spaces: [] });
  }
  if (storeys.size) E(`IFCRELAGGREGATES(${g()},$,$,$,${building},(${[...storeys.values()].map((s) => s.ref).join(',')}))`);

  const shape = (items) => E(`IFCPRODUCTDEFINITIONSHAPE($,$,(${E(`IFCSHAPEREPRESENTATION(${body},'Body','SweptSolid',(${items.join(',')}))`)}))`);
  const polyline = (pts) => {
    const ps = pts.map((p) => P2(p.x, p.y));
    return E(`IFCPOLYLINE((${[...ps, ps[0]].join(',')}))`);
  };
  const polyProfile = (pts, holes = []) => (holes.length
    ? E(`IFCARBITRARYPROFILEDEFWITHVOIDS(.AREA.,$,${polyline(ccw(pts))},(${holes.map((h) => polyline(ccw(h).reverse())).join(',')}))`)
    : E(`IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,$,${polyline(ccw(pts))})`));
  const rectProfile = (w, d) => E(`IFCRECTANGLEPROFILEDEF(.AREA.,$,${E(`IFCAXIS2PLACEMENT2D(${P2(0, 0)},$)`)},${real(w)},${real(d)})`);
  const extrude = (profile, depth) => E(`IFCEXTRUDEDAREASOLID(${profile},${world},${zAxis},${real(depth)})`);

  const materials = new Map();
  const assignMaterial = (name, ref) => {
    if (!name) return;
    if (!materials.has(name)) materials.set(name, { ref: E(`IFCMATERIAL(${str(name)},$,$)`), items: [] });
    materials.get(name).items.push(ref);
  };
  const pset = (target, name, props) => {
    const items = props
      .filter(([, , v]) => v !== undefined && v !== null && v !== '')
      .map(([k, t, v]) => E(`IFCPROPERTYSINGLEVALUE(${str(k)},$,${t}(${t === 'IFCBOOLEAN' ? (v ? '.T.' : '.F.') : t === 'IFCLABEL' || t === 'IFCIDENTIFIER' ? str(v) : real(v)}),$)`));
    if (!items.length) return;
    const ps = E(`IFCPROPERTYSET(${g()},$,${str(name)},$,(${items.join(',')}))`);
    E(`IFCRELDEFINESBYPROPERTIES(${g()},$,$,$,(${target}),${ps})`);
  };

  // Walls
  const wallRefs = new Map();
  for (const f of model.walls.values()) {
    const st = storeys.get(f.wall.levelId);
    if (!st) continue;
    const pl = LP(st.pl, A3(P3(0, 0, f.baseZ - st.elev)));
    const name = f.type?.name ?? 'Wall';
    const ref = E(`IFCWALL(${g()},$,${str(name)},$,${str(name)},${pl},${shape([extrude(polyProfile(wallFootprint(f)), f.H)])},${str(f.wall.mark)},.SOLIDWALL.)`);
    st.items.push(ref);
    wallRefs.set(f.id, { ref, pl });
    assignMaterial(f.type?.material, ref);
    pset(ref, 'Pset_WallCommon', [['Reference', 'IFCIDENTIFIER', name], ['IsExternal', 'IFCBOOLEAN', f.type?.function === 'Exterior'], ['LoadBearing', 'IFCBOOLEAN', f.type?.function === 'Exterior']]);
  }

  // Openings, doors, windows
  for (const op of model.openings.values()) {
    const host = wallRefs.get(op.host.id);
    if (!op.valid || !host) continue;
    const f = op.host;
    const st = storeys.get(f.wall.levelId);
    const c = wallPoint(f, (op.u0 + op.u1) / 2, 0);
    const w = op.u1 - op.u0, hgt = op.z1 - op.z0;
    const opPl = LP(host.pl, A3(P3(c.x, c.y, op.z0), D3(f.d.x, f.d.y, 0)));
    const opening = E(`IFCOPENINGELEMENT(${g()},$,'Opening',$,$,${opPl},${shape([extrude(rectProfile(w, f.t + 0.1), hgt)])},$,.OPENING.)`);
    E(`IFCRELVOIDSELEMENT(${g()},$,$,$,${host.ref},${opening})`);
    const fillPl = LP(opPl, world);
    const name = str(op.type?.name);
    const tag = str(op.el.mark);
    const panel = shape([extrude(rectProfile(w, op.kind === 'Door' ? 0.05 : 0.09), hgt)]);
    let fill;
    if (op.kind === 'Door') {
      const operation = op.type?.leaves === 2 ? '.DOUBLE_DOOR_SINGLE_SWING.' : op.el.flipHand ? '.SINGLE_SWING_RIGHT.' : '.SINGLE_SWING_LEFT.';
      fill = E(`IFCDOOR(${g()},$,${name},$,${name},${fillPl},${panel},${tag},${real(hgt)},${real(w)},.DOOR.,${operation},$)`);
    } else {
      fill = E(`IFCWINDOW(${g()},$,${name},$,${name},${fillPl},${panel},${tag},${real(hgt)},${real(w)},.WINDOW.,.SINGLE_PANEL.,$)`);
    }
    E(`IFCRELFILLSELEMENT(${g()},$,$,$,${opening},${fill})`);
    st.items.push(fill);
    assignMaterial(op.type?.material, fill);
  }

  // Slabs
  for (const el of doc.byCategory('Floor')) {
    const st = storeys.get(el.levelId);
    if (!st || el.boundary.length < 3) continue;
    const type = doc.type(el.typeId);
    const th = type?.thickness ?? 0.2;
    const pl = LP(st.pl, A3(P3(0, 0, (el.offset || 0) - th)));
    const name = type?.name ?? 'Floor';
    const ref = E(`IFCSLAB(${g()},$,${str(name)},$,${str(name)},${pl},${shape([extrude(polyProfile(el.boundary), th)])},${str(el.mark)},${type?.roof ? '.ROOF.' : '.FLOOR.'})`);
    st.items.push(ref);
    assignMaterial(type?.material, ref);
  }

  // Columns
  for (const c of model.columns.values()) {
    const st = storeys.get(c.el.levelId);
    if (!st) continue;
    const r = (c.rot * Math.PI) / 180;
    const pl = LP(st.pl, A3(P3(c.x, c.y, c.baseZ - st.elev), D3(Math.cos(r), Math.sin(r), 0)));
    const name = c.type?.name ?? 'Column';
    const ref = E(`IFCCOLUMN(${g()},$,${str(name)},$,${str(name)},${pl},${shape([extrude(rectProfile(c.w, c.dd), c.topZ - c.baseZ)])},${str(c.el.mark)},.COLUMN.)`);
    st.items.push(ref);
    assignMaterial(c.type?.material, ref);
  }

  // Spaces (rooms)
  for (const el of doc.byCategory('Room')) {
    const reg = model.rooms.get(el.id);
    const st = storeys.get(el.levelId);
    if (!reg || !st) continue;
    const idx = levels.findIndex((l) => l.id === el.levelId);
    const height = levels[idx + 1] ? levels[idx + 1].elevation - st.elev : 3;
    const ref = E(`IFCSPACE(${g()},$,${str(el.number)},$,$,${LP(st.pl, world)},${shape([extrude(polyProfile(reg.outer, reg.holes), height)])},${str(el.name)},.ELEMENT.,.INTERNAL.,$)`);
    st.spaces.push(ref);
    pset(ref, 'Pset_SpaceCommon', [['Reference', 'IFCIDENTIFIER', el.number]]);
  }

  for (const st of storeys.values()) {
    if (st.items.length) E(`IFCRELCONTAINEDINSPATIALSTRUCTURE(${g()},$,$,$,(${st.items.join(',')}),${st.ref})`);
    if (st.spaces.length) E(`IFCRELAGGREGATES(${g()},$,$,$,${st.ref},(${st.spaces.join(',')}))`);
  }
  for (const m of materials.values()) E(`IFCRELASSOCIATESMATERIAL(${g()},$,$,$,(${m.items.join(',')}),${m.ref})`);

  const stamp = new Date().toISOString().slice(0, 19);
  return [
    'ISO-10303-21;',
    'HEADER;',
    "FILE_DESCRIPTION(('ViewDefinition [DesignTransferView]'),'2;1');",
    `FILE_NAME(${str(`${doc.name}.ifc`)},'${stamp}',(''),(''),'Keystone BIM 0.1','Keystone BIM','');`,
    "FILE_SCHEMA(('IFC4'));",
    'ENDSEC;',
    'DATA;',
    ...lines,
    'ENDSEC;',
    'END-ISO-10303-21;',
    '',
  ].join('\n');
}
