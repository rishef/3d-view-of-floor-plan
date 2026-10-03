import { App } from './app.js';
import { PlanView } from './views/planView.js';
import { View3D } from './views/view3d.js';
import { ScheduleView } from './views/scheduleView.js';
import { PropertiesPanel } from './ui/propertiesPanel.js';
import { ProjectBrowser } from './ui/projectBrowser.js';
import { Ribbon } from './ui/ribbon.js';
import { StatusBar } from './ui/statusBar.js';
import { installKeyboard } from './ui/keyboard.js';
import { icon } from './ui/icons.js';
import { SunBar } from './ui/sunBar.js';
import { WalkController } from './views/walk.js';
import { openSiteDialog } from './ui/siteDialog.js';
import { openImportDialog } from './ui/importDialog.js';

const $ = (id) => document.getElementById(id);

const app = new App();
window.keystone = app; // handy for poking at the model from DevTools

$('viewPanes').dataset.mode = app.viewMode;
app.planView = new PlanView($('planCanvas'), app);
app.view3d = new View3D($('pane3d'), app);
app.scheduleView = new ScheduleView($('schedulePane'), app);
app.sunBar = new SunBar($('pane3d'), app);
app.walk = new WalkController(app, app.view3d);
app.openSiteDialog = () => openSiteDialog(app);
app.openImportDialog = () => openImportDialog(app);
new Ribbon($('ribbon'), $('optionsBar'), app);
new PropertiesPanel($('properties'), app);
new ProjectBrowser($('browser'), app);
new StatusBar($('statusBar'), app);
installKeyboard(app);

// View switcher in the view header
const modes = [['plan', 'Plan', 'plan'], ['split', 'Plan + 3D', 'split'], ['3d', '3D', 'cube'], ['schedule', 'Schedules', 'table']];
const switcher = $('viewSwitch');
for (const [mode, label, ic] of modes) {
  const b = document.createElement('button');
  b.type = 'button';
  b.dataset.mode = mode;
  b.innerHTML = `${icon(ic, 16)}<span>${label}</span>`;
  b.addEventListener('click', () => app.setViewMode(mode));
  switcher.append(b);
}
const syncSwitch = () => switcher.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.mode === app.viewMode));
app.on('view', syncSwitch);
syncSwitch();

$('fitPlan').innerHTML = icon('fit', 16);
$('fitPlan').addEventListener('click', () => app.planView.fit());
