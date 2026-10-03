import * as THREE from 'three';
import { buildIFC } from './ifc.js';
import { downloadText, downloadBlob, slug } from './fileio.js';

export function downloadIFC(app) {
  const text = buildIFC(app);
  downloadText(text, `${slug(app.doc.name)}.ifc`, 'application/x-step');
  app.status(`Exported IFC4 (${app.model.walls.size} walls, ${app.model.openings.size} openings) — open it in any IFC viewer`);
}

/** A clean scene for export: one named mesh per element part, unselected materials, no edge lines. */
export function exportScene(app) {
  const scene = new THREE.Group();
  scene.name = app.doc.name;
  app.view3d.modelGroup.updateMatrixWorld(true);
  app.view3d.modelGroup.traverse((o) => {
    if (!o.isMesh) return;
    const el = app.doc.get(o.userData.id);
    const mesh = new THREE.Mesh(o.geometry, o.userData.baseMaterial ?? o.material);
    mesh.applyMatrix4(o.matrixWorld);
    mesh.name = el ? `${el.category} ${el.mark || el.name || el.number || el.id}` : 'Element';
    mesh.userData = { elementId: o.userData.id, category: el?.category ?? null, type: app.doc.type(el?.typeId)?.name ?? null };
    scene.add(mesh);
  });
  return scene;
}

export async function buildGLB(app) {
  const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
  return new GLTFExporter().parseAsync(exportScene(app), { binary: true });
}

export async function downloadGLB(app) {
  try {
    const glb = await buildGLB(app);
    downloadBlob(new Blob([glb], { type: 'model/gltf-binary' }), `${slug(app.doc.name)}.glb`);
    app.status('Exported glTF binary (.glb)');
  } catch (err) {
    app.status(`glTF export failed: ${err.message ?? err}`, 'warn');
  }
}
