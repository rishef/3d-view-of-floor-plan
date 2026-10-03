// In-app replacements for window.confirm / window.prompt. Native dialogs are blocked in some
// embedded browsers (and look out of place everywhere), so these render as regular modals.

import { h } from './dom.js';
import { openModal } from './modal.js';

export function confirmDialog(message, { title = 'Please confirm', ok = 'OK', danger = false } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (v) => {
      if (settled) return;
      settled = true;
      resolve(v);
      modal.close();
    };
    const modal = openModal({ title, className: 'dialog-modal', onClose: () => settle(false) });
    const okBtn = h('button', { class: `btn ${danger ? 'danger-fill' : 'primary'}`, type: 'button', onclick: () => settle(true) }, ok);
    modal.body.append(h('p', { class: 'dialog-msg' }, message));
    modal.foot.append(h('span', { class: 'spacer' }), h('button', { class: 'btn', type: 'button', onclick: () => settle(false) }, 'Cancel'), okBtn);
    okBtn.focus();
  });
}

export function promptDialog(message, value = '', { title = 'Enter a value', ok = 'OK', type = 'text', suffix = '' } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (v) => {
      if (settled) return;
      settled = true;
      resolve(v);
      modal.close();
    };
    const modal = openModal({ title, className: 'dialog-modal', onClose: () => settle(null) });
    const input = h('input', {
      class: 'dialog-input', type, value,
      onkeydown: (e) => { if (e.key === 'Enter') settle(input.value); },
    });
    modal.body.append(h('label', { class: 'dialog-msg' }, message, h('span', { class: 'dialog-field' }, input, suffix ? h('span', { class: 'muted' }, suffix) : null)));
    modal.foot.append(
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn', type: 'button', onclick: () => settle(null) }, 'Cancel'),
      h('button', { class: 'btn primary', type: 'button', onclick: () => settle(input.value) }, ok));
    input.focus();
    input.select();
  });
}
