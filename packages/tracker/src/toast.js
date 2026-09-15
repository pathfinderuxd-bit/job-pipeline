/* toast.js — short messages at the bottom of the screen, some with an Undo.
 *
 * Deliberately small: one stack, one live region, no dependencies. A toast
 * with an action stays until it is dismissed or its window runs out, because
 * an Undo that vanishes while you are reading it is worse than none.
 */
(function (root) {
  'use strict';

  var host = null;

  function mount() {
    if (host) return host;
    host = document.createElement('div');
    host.className = 'toasts';
    host.setAttribute('role', 'status');
    host.setAttribute('aria-live', 'polite');
    document.body.appendChild(host);
    return host;
  }

  /* show({text, tone, action:{label, onClick}, timeout, id})
   *
   *   tone     'info' | 'good' | 'warn' | 'bad' | 'busy'
   *   timeout  ms; 0 keeps it up until something dismisses it
   *   id       reusing an id replaces that toast in place, which is how the
   *            save indicator goes Saving… → Saved without stacking up
   *
   * Returns a handle with .dismiss() and .update(). */
  function show(opts) {
    var o = opts || {};
    mount();

    var existing = o.id ? host.querySelector('[data-toast-id="' + o.id + '"]') : null;
    var el = existing || document.createElement('div');
    var fresh = !existing;

    el.className = 'toast toast-' + (o.tone || 'info');
    if (o.id) el.setAttribute('data-toast-id', o.id);
    el.innerHTML = '';

    if (o.tone === 'busy') {
      var spin = document.createElement('span');
      spin.className = 'toast-spin';
      el.appendChild(spin);
    }

    var text = document.createElement('span');
    text.className = 'toast-text';
    text.textContent = o.text || '';
    el.appendChild(text);

    var timer = null;
    function dismiss() {
      clearTimeout(timer);
      if (!el.parentNode) return;
      el.classList.add('out');
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 180);
    }

    if (o.action && o.action.label) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'toast-action';
      btn.textContent = o.action.label;
      btn.addEventListener('click', function () {
        dismiss();
        if (o.action.onClick) o.action.onClick();
      });
      el.appendChild(btn);
    }

    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'toast-close';
    close.setAttribute('aria-label', 'Dismiss');
    close.innerHTML = '&#10005;';
    close.addEventListener('click', dismiss);
    el.appendChild(close);

    if (fresh) {
      host.appendChild(el);
      /* let the browser see the starting state before the transition */
      void el.offsetWidth;
    }
    el.classList.remove('out');

    var ms = o.timeout === undefined ? (o.action ? 9000 : 4000) : o.timeout;
    if (ms > 0) timer = setTimeout(dismiss, ms);

    return {
      el: el,
      dismiss: dismiss,
      update: function (next) {
        clearTimeout(timer);
        return show(Object.assign({ id: o.id }, next));
      }
    };
  }

  var API = { show: show, mount: mount };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.Toast = API;
})(typeof window !== 'undefined' ? window : globalThis);
