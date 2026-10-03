// The project template: system types and default levels (Revit's "Architectural Template").
// Types carry the parameters shared by every instance; editing a type updates them all.

export function defaultTypes() {
  return [
    { id: 'wt-ext-300', category: 'Wall', name: 'Exterior - Brick on Block 300', thickness: 0.3, function: 'Exterior', material: 'Brick', color: '#c28466' },
    { id: 'wt-generic-200', category: 'Wall', name: 'Generic - 200', thickness: 0.2, function: 'Interior', material: 'Concrete Masonry', color: '#cfcac1' },
    { id: 'wt-int-120', category: 'Wall', name: 'Interior - Partition 120', thickness: 0.12, function: 'Interior', material: 'Gypsum Board', color: '#e8e4dc' },

    { id: 'dt-single-900', category: 'Door', name: 'Single Flush 900 x 2100', width: 0.9, height: 2.1, leaves: 1, glass: false, material: 'Wood', color: '#8a5a3b' },
    { id: 'dt-single-1000', category: 'Door', name: 'Single Flush 1000 x 2100', width: 1.0, height: 2.1, leaves: 1, glass: false, material: 'Wood', color: '#7b4f33' },
    { id: 'dt-double-1800', category: 'Door', name: 'Double Glazed 1800 x 2400', width: 1.8, height: 2.4, leaves: 2, glass: true, material: 'Aluminium', color: '#3f454c' },

    { id: 'wnt-fixed-1200', category: 'Window', name: 'Fixed 1200 x 1500', width: 1.2, height: 1.5, defaultSill: 0.9, material: 'Aluminium', color: '#3f454c' },
    { id: 'wnt-fixed-1800', category: 'Window', name: 'Fixed 1800 x 1500', width: 1.8, height: 1.5, defaultSill: 0.9, material: 'Aluminium', color: '#3f454c' },
    { id: 'wnt-casement-600', category: 'Window', name: 'Casement 600 x 1200', width: 0.6, height: 1.2, defaultSill: 1.0, material: 'Aluminium', color: '#3f454c' },

    { id: 'ft-generic-200', category: 'Floor', name: 'Generic Slab 200', thickness: 0.2, material: 'Concrete', color: '#bdb9b1', roof: false },
    { id: 'ft-roof-250', category: 'Floor', name: 'Roof Slab 250', thickness: 0.25, material: 'Concrete', color: '#8e959c', roof: true },

    { id: 'ct-concrete-400', category: 'Column', name: 'Concrete 400 x 400', width: 0.4, depth: 0.4, material: 'Concrete', color: '#a9a6a0' },
    { id: 'ct-concrete-300', category: 'Column', name: 'Concrete 300 x 300', width: 0.3, depth: 0.3, material: 'Concrete', color: '#a9a6a0' },
  ];
}

export function defaultLevels() {
  return [
    { id: 'lvl-1', category: 'Level', name: 'Level 1', elevation: 0 },
    { id: 'lvl-2', category: 'Level', name: 'Level 2', elevation: 3.2 },
  ];
}

/** Display names used for the "family" line above the type selector. */
export const FAMILY_NAMES = {
  Wall: 'Basic Wall',
  Door: 'Door',
  Window: 'Window',
  Floor: 'Floor',
  Column: 'Structural Column',
  Room: 'Room',
  Grid: 'Grid',
  Level: 'Level',
  Context: 'Site Context (massing)',
};

export const CATEGORY_PLURAL = {
  Wall: 'Walls', Door: 'Doors', Window: 'Windows', Floor: 'Floors', Column: 'Columns', Room: 'Rooms', Grid: 'Grids', Level: 'Levels', Context: 'Nearby Buildings',
};
