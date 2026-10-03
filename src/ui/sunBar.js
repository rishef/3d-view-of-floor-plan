import { h } from './dom.js';
import { openModal } from './modal.js';
import { sunTimes, formatClock, compassLabel } from '../core/solar.js';

/** Sun-study controls docked at the bottom of the 3D pane. */
export class SunBar {
  constructor(container, app) {
    this.app = app;
    this.timer = 0;
    this.el = h('div', { class: 'sunbar' });
    container.append(this.el);
    this.render();
    app.on('sun', () => this.sync());
    app.on('sunInfo', () => this.readout());
    app.on('model', ({ reason }) => { if (reason !== 'live') this.sync(); });
  }

  render() {
    const { app } = this;
    const s = app.sun;
    this.toggle = h('button', { class: 'sun-toggle', type: 'button', title: 'Show real sun position and shadows for the project location', onclick: () => this.setEnabled(!app.sun.enabled) });
    this.date = h('input', { type: 'date', value: s.date, onchange: (e) => e.target.value && app.setSun({ date: e.target.value }) });
    this.slider = h('input', { type: 'range', min: 0, max: 1435, step: 5, value: s.minutes, class: 'sun-slider', oninput: (e) => app.setSun({ minutes: +e.target.value }) });
    this.clock = h('span', { class: 'sun-clock' });
    this.play = h('button', { class: 'sun-btn', type: 'button', title: 'Animate the day', onclick: () => this.togglePlay() });
    const quick = [['Sunrise', 'rise'], ['9:00', 540], ['12:00', 720], ['15:00', 900], ['Sunset', 'set']].map(([label, v]) =>
      h('button', { class: 'sun-chip', type: 'button', onclick: () => this.jump(v) }, label));
    this.pathChk = h('input', { type: 'checkbox', checked: s.showPath, onchange: (e) => app.setSun({ showPath: e.target.checked }) });
    this.info = h('div', { class: 'sun-readout' });
    this.controls = h('div', { class: 'sun-controls' },
      h('div', { class: 'sun-row' }, this.date, this.play, this.slider, this.clock),
      h('div', { class: 'sun-row' }, ...quick,
        h('label', { class: 'sun-chk' }, this.pathChk, ' Sun path'),
        h('span', { class: 'spacer' }),
        h('button', { class: 'sun-chip strong', type: 'button', onclick: () => this.shadowStudy() }, 'Shadow study'),
        h('button', { class: 'sun-chip strong', type: 'button', onclick: () => app.openSchedule('sunlight') }, 'Window sunlight')),
      this.info);
    this.el.replaceChildren(this.toggle, this.controls);
    this.sync();
  }

  setEnabled(on) {
    const { app } = this;
    if (!on) this.stop();
    if (on && (app.viewMode === 'plan' || app.viewMode === 'schedule')) app.setViewMode('split');
    app.setSun({ enabled: on });
  }

  times() {
    const site = this.app.doc.site;
    return sunTimes(this.app.sun.date, site.latitude, site.longitude, site.utcOffset);
  }

  jump(v) {
    const t = this.times();
    const m = v === 'rise' ? Math.ceil(((t.sunrise ?? 360) + 10) / 5) * 5 : v === 'set' ? Math.floor(((t.sunset ?? 1080) - 10) / 5) * 5 : v;
    this.app.setSun({ minutes: m, enabled: true });
  }

  togglePlay() {
    if (this.timer) { this.stop(); return; }
    const t = this.times();
    const start = Math.max(0, (t.sunrise ?? 300) - 30), end = Math.min(1435, (t.sunset ?? 1140) + 30);
    if (this.app.sun.minutes < start || this.app.sun.minutes >= end) this.app.setSun({ minutes: Math.round(start / 5) * 5 });
    this.timer = setInterval(() => {
      let m = this.app.sun.minutes + 5;
      if (m > end) m = Math.round(start / 5) * 5;
      this.app.setSun({ minutes: m });
    }, 70);
    this.sync();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = 0;
    this.sync();
  }

  sync() {
    const s = this.app.sun;
    const site = this.app.doc.site;
    this.el.classList.toggle('on', s.enabled);
    this.toggle.innerHTML = s.enabled ? '☀ Sun study <span class="muted">· on</span>' : '☀ Sun study';
    this.controls.hidden = !s.enabled;
    this.date.value = s.date;
    this.slider.value = s.minutes;
    this.clock.textContent = formatClock(s.minutes);
    this.play.textContent = this.timer ? '❚❚' : '▶';
    this.pathChk.checked = s.showPath;
    // daylight band on the slider track
    const t = this.times();
    const rise = ((t.sunrise ?? 0) / 1440) * 100, set = ((t.sunset ?? (t.polarNight ? 0 : 1440)) / 1440) * 100;
    this.slider.style.background = `linear-gradient(90deg, #2b3445 0%, #2b3445 ${rise - 2}%, #f4b26b ${rise}%, #ffe7a3 ${(rise + set) / 2}%, #f4b26b ${set}%, #2b3445 ${set + 2}%, #2b3445 100%)`;
    this.slider.title = `${site.locationName || 'Site'} · sunrise ${formatClock(t.sunrise)} · sunset ${formatClock(t.sunset)}`;
    this.readout();
  }

  readout() {
    const i = this.app.view3d?.sunInfo;
    if (!this.app.sun.enabled || !i) { this.info.textContent = ''; return; }
    const site = this.app.doc.site;
    const up = i.altitude > 0;
    this.info.innerHTML = '';
    this.info.append(
      h('span', {}, h('b', {}, site.locationName || 'Site'), ` ${site.latitude.toFixed(2)}°, ${site.longitude.toFixed(2)}° · UTC${site.utcOffset >= 0 ? '+' : ''}${site.utcOffset}`),
      h('span', {}, up ? `Sun ${i.altitude.toFixed(0)}° high, from ${compassLabel(i.azimuth)} (${i.azimuth.toFixed(0)}°)` : 'Sun below the horizon'),
      h('span', {}, `☀ ${formatClock(i.times?.sunrise)} – ${formatClock(i.times?.sunset)}`),
      h('span', { class: up && i.windowsLit ? 'lit' : '' }, `${i.windowsLit ?? 0} of ${i.windowsTotal ?? 0} windows in direct sun`),
    );
  }

  shadowStudy() {
    const { app } = this;
    const t = this.times();
    if (t.polarNight) { app.status('The sun does not rise on this date at this location', 'warn'); return; }
    const rise = t.sunrise ?? 0, set = t.sunset ?? 1440;
    const minutes = [];
    for (let k = 1; k <= 6; k++) minutes.push(Math.round((rise + ((set - rise) * k) / 7) / 15) * 15);
    if (app.viewMode === 'plan' || app.viewMode === 'schedule') app.setViewMode('split');
    if (!app.sun.enabled) app.setSun({ enabled: true });
    const shots = app.view3d.snapshots(minutes);
    const site = app.doc.site;
    const modal = openModal({ title: `Shadow study — ${site.locationName || 'Site'}, ${app.sun.date}`, className: 'study-modal' });
    const grid = h('div', { class: 'study-grid' }, shots.map((s) => h('figure', {},
      h('img', { src: s.url, alt: `Shadows at ${formatClock(s.minutes)}` }),
      h('figcaption', {}, h('b', {}, formatClock(s.minutes)),
        s.info.altitude > 0 ? ` · sun ${s.info.altitude.toFixed(0)}° from ${compassLabel(s.info.azimuth)} · ${s.info.windowsLit}/${s.info.windowsTotal} windows sunlit` : ' · sun below horizon'))));
    modal.body.append(grid);
    modal.foot.append(
      h('span', { class: 'muted' }, 'Rendered from the current 3D camera. Orbit the 3D view first to change the angle.'),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn primary', type: 'button', onclick: () => this.downloadSheet(shots) }, 'Download sheet (PNG)'));
  }

  downloadSheet(shots) {
    const img0 = new Image();
    img0.onload = () => {
      const w = img0.width, hh = img0.height, cols = 3, rows = Math.ceil(shots.length / cols), cap = 44, head = 60;
      const c = document.createElement('canvas');
      c.width = cols * w;
      c.height = head + rows * (hh + cap);
      const g = c.getContext('2d');
      g.fillStyle = '#fff';
      g.fillRect(0, 0, c.width, c.height);
      g.fillStyle = '#1d2126';
      g.font = '600 28px Inter, system-ui, sans-serif';
      const site = this.app.doc.site;
      g.fillText(`Shadow study · ${this.app.doc.name} · ${site.locationName || ''} · ${this.app.sun.date}`, 20, 40);
      let loaded = 0;
      shots.forEach((s, k) => {
        const im = new Image();
        im.onload = () => {
          const x = (k % cols) * w, y = head + Math.floor(k / cols) * (hh + cap);
          g.drawImage(im, x, y, w, hh);
          g.fillStyle = '#1d2126';
          g.font = '600 22px Inter, system-ui, sans-serif';
          g.fillText(`${formatClock(s.minutes)}${s.info.altitude > 0 ? `  ·  sun ${s.info.altitude.toFixed(0)}° from ${compassLabel(s.info.azimuth)}` : ''}`, x + 16, y + hh + 30);
          if (++loaded === shots.length) {
            c.toBlob((blob) => {
              const a = document.createElement('a');
              a.href = URL.createObjectURL(blob);
              a.download = `shadow-study-${this.app.sun.date}.png`;
              a.click();
              setTimeout(() => URL.revokeObjectURL(a.href), 2000);
            });
          }
        };
        im.src = s.url;
      });
    };
    img0.src = shots[0].url;
  }
}
