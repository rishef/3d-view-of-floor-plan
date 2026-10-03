# Keystone BIM

A browser-based Building Information Modeling (BIM) editor in the spirit of Autodesk Revit.
Bring in a floor plan, get a 3D building. Then place it on its real site, with nearby buildings around it,
and study sunlight and shadows at any time of day.

You model a building once, from walls, doors, windows, floors, columns, rooms, levels and grids.
The floor plans, the 3D view, the schedules and the IFC export are all live views of that single model.

No build step and no Node.js. It uses plain ES modules, with Three.js (and pdf.js for PDF plans) loaded from a CDN.

## Run it

```bash
python serve.py
```

Then open <http://localhost:8765>. `serve.py` is a plain static server with caching turned off, so edits
show up on reload. The test suite runs at <http://localhost:8765/tests/>.

The app opens with a two-storey sample house and two nearby buildings. Work autosaves to the browser.
**Save** writes a `.kbim.json` project file and **Open** loads one.

## Floor plan → 3D

**Insert › Import Plan** takes:

| Input | How it's read |
|---|---|
| **PNG / JPG / WebP** scan or export | Raster wall detection (below) |
| **PDF** | Page 1 is rendered with pdf.js, then the same raster detection |
| **DXF** from AutoCAD, BricsCAD, ArchiCAD and similar tools (save DWG as DXF) | Double wall lines are paired into walls; units come from `$INSUNITS` or are guessed; you pick the wall layers |

The wizard has four steps, with the result overlaid live on the drawing:

1. **Scale.** For images and PDFs the scale is estimated from the typical wall thickness. For an exact
   scale, click **Measure a known dimension…**, pick two points and type the real length.
2. **Detection.** Choose the wall style (filled/solid or outlined/hatched; Auto picks one). You can also set the
   ink threshold, the wall-thickness range and the minimum wall length.
3. **Build.** Choose the level, the wall height (up to the next level, or fixed) and whether to add a floor
   slab, a roof slab and rooms in every enclosed space.
4. **Create 3D model.** The drawing stays as a faded underlay in the plan so you can check it. Fix anything
   it missed with the normal Wall/Door/Window tools. **Trace manually** just places the drawing as an
   underlay to draw over.

How the raster detection works:
- A morphological opening (filled walls), or a directional closing then opening (outlined walls), isolates the wall bodies.
- Row and column band scanning turns them into wall rectangles.
- A clean-up pass merges duplicates, snaps ends into corners and T-junctions, and turns gaps into openings.
  A gap between two collinear walls, or between a wall end and a facing wall, becomes an opening.
  Gaps crossed by two or more parallel lines become windows; the rest become doors.

Use **Sample: filled walls** or **Sample: outlined walls** in the wizard to see the whole flow without a file.

**Works best with:** orthogonal plans with clear, dark walls. **Not yet supported:** diagonal and curved walls
in images, DWG directly, and reading room names from the text (rooms are created and numbered; rename them
in Properties or the Room Schedule).

## Walk through the house

**Walkthrough › Walk** (or `WK`, or the **🚶 Walk** button in the 3D view) puts you inside the model at eye height (1.6 m):

- **Move:** `W A S D` or the arrow keys. `Shift` runs and the mouse wheel steps. **Look:** drag, or use `←` `→`.
  **Change level:** `Q` / `E` or the Level ▲▼ buttons.
- **Collisions:** you can't walk through walls, columns or nearby buildings, and windows block you. Doors swing
  open on their real hinge side as you approach and close behind you.
- **Heads-up display:** shows the room you're in (name, number and area) and the level. A minimap is shown in
  full-3D mode. In split view the plan shows a live *you are here* marker with your view cone; click the plan to
  jump there.
- **Auto tour** (`T`, or **Walkthrough › Tour**) plans a route from the door graph:
  1. Enter through the front door.
  2. Visit every room through its doors, pausing to look around.
  3. Fade up to the next level and carry on there.
  4. Jump to any room without a door to it at the end.

  Any movement key or drag takes back control.
- Works with the sun study: pick a time of day and walk the rooms to see where the light falls.
  `Esc` stops the tour; press it again to leave walk mode.

## Site, sun & shadows

- **Site & Sun › Site** sets the location (city presets or latitude/longitude/time zone) and which way the top of
  the plan faces. It also holds **nearby buildings**, each with a direction from your building (compass bearing),
  clear distance (gap between buildings), width facing you, depth and height. They show as hatched massing in
  plan with their distance, and as solid blocks in 3D.
- **Sun Study** (ribbon or the ☀ button in the 3D view) drives the real sun position for the date and time.
  - The time slider is shaded with daylight hours; ▶ animates the day.
  - Light colour, sky colour and shadows follow the sun.
  - The sun path arc shows hour marks.
  - Windows in direct sun light up.
  - Turn on **Section Box** in view properties to see sun patches inside the rooms.
- **Shadow study** renders six times across the day from the current camera into one downloadable sheet.
- **Window sunlight** (schedule) gives each window's facing, hours of direct sun, and first and last sun for the
  date. It accounts for shading from your own building and the nearby buildings.

Solar position uses the NOAA/Almanac approximation (about 0.3° accuracy). Sunrise and sunset include refraction.

## Modelling features

| Revit concept | Here |
|---|---|
| Single model, many views | `BimDocument` holds every element, type and the site. The plan, 3D view, schedules and exports all read the regenerated model. |
| Levels & floor plans | Each level has a plan with a cut plane (1200 mm by default) and a halftone underlay of the level below. |
| System families & types | Wall, door, window, floor and column types carry shared parameters. **Edit Type** changes every instance. **Duplicate…** creates new types. |
| Instance parameters | The Properties palette has grouped parameters and supports multi-select editing. |
| Wall joins | L-junctions are mitered. T-junctions and crossings merge cleanly in plan. |
| Hosted elements | Doors and windows cut real openings, slide along walls, re-host by dragging, and are deleted with their host. |
| Rooms | Boundaries come from a planar graph of wall centerlines, offset to the finish faces, so areas are net. They update when walls move. |
| Floors | Pick Walls, Pick Room, Rectangle or Polygon. |
| Schedules | Walls, doors, windows, rooms, floors, columns, **window sunlight**, **nearby buildings** and a material takeoff. They sort, total, export to CSV and edit text in place. |
| Transactions | Every edit, including site changes, is a named undo step. |
| Warnings | Bad openings and unenclosed rooms are reported. Click a warning to select the element. |
| Interop | IFC4 export (checked with web-ifc), glTF (.glb) export. |

### Shortcuts

`WA` wall · `DR` door · `WN` window · `FL` floor · `CL` column · `RM` room · `GR` grid · `MD` modify · `WK` walk · `ZF` zoom to fit.
`Esc` cancels, then exits the tool. `Space` flips a door or rotates a column. While drawing a wall, type a length in mm and press `Enter`.
In plan: wheel to zoom, middle- or right-drag to pan. In 3D: drag to orbit, right-drag to pan.

## Architecture

```
src/
  core/              the BIM engine (no DOM, no Three.js)
    document.js      elements, types and site; transactions, undo/redo
    regen.js         wall joins, openings, columns, nearby-building placement, rooms, quantities
    rooms.js         planar-graph regions, finish-face offsets, outer boundaries
    solar.js         sun position, sunrise/sunset, sun vectors in plan space
    site.js          location presets, orientation, nearby-building placement
    parameters.js    instance/type parameter definitions per category
  analysis/
    sunlight.js      window probes, ray-cast shading, direct-sun hours
  io/
    planImport/      raster.js (image/PDF load) · detect.js (raster walls) · dxf.js · cleanup.js
                     buildModel.js (walls/openings/rooms/slabs) · samplePlan.js (demo drawing)
    ifc.js, exporters.js, fileio.js
  views/             plan view & rendering, snapping, 3D view (sun study), walk.js (walkthrough & tour), schedules
  tools/             select/modify, wall, door/window, floor, column, room, grid
  ui/                ribbon, properties, project browser, import wizard, site dialog, sun bar, status bar
tests/               in-browser regression tests (engine, solar, plan import incl. DXF and PDF, walkthrough)
serve.py             no-cache dev server
```

There are three rules:

1. **The document is the only source of truth.**
2. **Geometry is derived, never stored.** `regenerate()` rebuilds everything after each change.
3. **Every edit is a transaction.**

## Roadmap

1. **Smarter plan reading.** OCR of room names and dimensions for automatic scale. An AI vision pass (e.g. Claude)
   for messy scans. Diagonal and curved walls. Multi-page PDFs as multiple levels.
2. **Daylight depth.** Annual sun-hours heatmaps on facades and floors, sky-view and daylight-factor estimates,
   terrain and trees, and ASHRAE/EPW weather files.
3. **Modeling depth.** Layered walls, curtain walls, sloped roofs, stairs, solid booleans.
4. **Documentation.** Sections, elevations, dimensions, sheets, PDF.
5. **Collaboration and scale.** Worksharing, incremental regeneration, TypeScript + Vite.

## Known limitations

- Imported drawings (underlays) last for the session only; the model built from them is saved.
- Regeneration and undo are whole-model operations, fine for houses and small buildings.
- Section-box cuts aren't capped. Rooms ignore room-separation lines.
- Three.js, pdf.js and fonts come from CDNs, so the first load needs internet access.
