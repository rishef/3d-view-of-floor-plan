import { h } from './dom.js';

/** Opens a modal dialog. Returns { el, body, foot, close }. Esc or × closes it. */
export function openModal({ title, className = '', onClose }) {
  const body = h('div', { class: 'modal-body' });
  const foot = h('div', { class: 'modal-foot' });
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    backdrop.remove();
    window.removeEventListener('keydown', onKey, true);
    onClose?.();
  };
  const onKey = (e) => {
    const all = document.querySelectorAll('.modal-backdrop');
    if (all[all.length - 1] !== backdrop) return; // only the topmost dialog handles keys
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  const dialog = h('div', { class: `modal ${className}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'modal-head' }, h('div', { class: 'modal-title' }, title), h('button', { class: 'modal-x', type: 'button', title: 'Close (Esc)', onclick: close }, '×')),
    body, foot);
  const backdrop = h('div', { class: 'modal-backdrop', onmousedown: (e) => { if (e.target === backdrop) close(); } }, dialog);
  document.body.append(backdrop);
  window.addEventListener('keydown', onKey, true);
  return { el: dialog, body, foot, close };
}

/** Labelled form row helper. */
export const field = (label, control, hint) => h('label', { class: 'frow' }, h('span', { class: 'flabel' }, label), control, hint ? h('span', { class: 'fhint' }, hint) : null);
