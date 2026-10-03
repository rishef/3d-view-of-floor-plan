/** Base class for plan-view tools. Pointer events carry { sx, sy, world, button, shift, ctrl, alt }. */
export class Tool {
  constructor(app) {
    this.app = app;
    this.snapInfo = null;
  }

  /** Category whose type selector the Properties palette shows while this tool is active. */
  get category() { return null; }
  get title() { return 'Modify'; }
  get hint() { return ''; }

  activate() {}
  deactivate() {}
  pointerDown() {}
  pointerMove() {}
  pointerUp() {}
  doubleClick() {}
  /** Return true when the key was consumed. */
  keyDown() { return false; }
  /** Abort an in-progress operation. Return false when there was nothing to cancel. */
  cancel() { return false; }
  drawOverlay() {}

  renderOptions(el) {
    el.innerHTML = `<span class="opt-title">${this.title}</span>`;
  }

  redraw() { this.app.planView?.draw(); }

  /** Small helper for option-bar markup: a segmented mode switch. */
  static segmented(name, options, current) {
    return `<div class="seg" data-name="${name}">${options
      .map(([v, label]) => `<button type="button" data-value="${v}" class="${v === current ? 'on' : ''}">${label}</button>`)
      .join('')}</div>`;
  }
}
