/* chrome.js — the page's own controls: light/dark, and full screen.
 *
 * These belong to the page rather than to the account, so they live here and
 * not in gate.js: an offline build opened from a file gets them too.
 */
(function (root) {
  'use strict';

  var KEY = 'job-pipeline/theme';

  /* The pin, as supplied. The wordmark is live text rather than part of the
   * image so it can take the page's ink colour — black on light, white on dark
   * — which a flattened logo cannot do. */
  var PIN =
    '<img class="brand-pin" src="data:image/png;base64,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" alt="" width="72" height="72">';

  /* Three states, not two. The CSS is written for all three — a bare :root for
   * light, a prefers-color-scheme block for the un-stamped default, and a
   * [data-theme] block that beats both — so "follow the system" is a real
   * setting and not just "light". */
  /* The splash goes when the page has something real to show. gate.js calls
   * this from both of its endings — rows drawn, or the sign-in card offered —
   * and the load fallback covers an offline build, which has no gate at all,
   * and any path added later that forgets to call it. */
  var splashGone = false;
  function hideSplash() {
    if (splashGone) return;
    splashGone = true;
    var el = document.getElementById('splash');
    if (!el) return;
    el.classList.add('gone');
    var done = function () { el.hidden = true; };
    el.addEventListener('transitionend', done, { once: true });
    /* transitionend never fires when the transition is off — reduced motion,
     * or an already-hidden tab. */
    setTimeout(done, 400);
  }
  window.addEventListener('load', function () { setTimeout(hideSplash, 1200); });

  root.hideSplash = hideSplash;

  var ORDER = ['auto', 'light', 'dark'];

  var ICONS = {
    auto: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
          'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
          '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17" /><path d="M12 12h8.5"/>' +
          '<path d="M12 7h6"/><path d="M12 17h6"/></svg>',
    light: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
           'stroke-linecap="round" aria-hidden="true">' +
           '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M4.2 4.2l1.6 1.6' +
           'M18.2 18.2l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.2 19.8l1.6-1.6M18.2 5.8l1.6-1.6"/></svg>',
    dark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
          'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
          '<path d="M20 14.2A8.4 8.4 0 0 1 9.8 4 8.5 8.5 0 1 0 20 14.2Z"/></svg>'
  };

  var LABEL = { auto: 'System', light: 'Light', dark: 'Dark' };

  function saved() {
    try {
      var v = localStorage.getItem(KEY);
      return ORDER.indexOf(v) > -1 ? v : 'auto';
    } catch (e) { return 'auto'; }
  }

  function resolved(mode) {
    if (mode !== 'auto') return mode;
    try {
      return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } catch (e) { return 'light'; }
  }

  /* The browser's own chrome — the address bar on a phone — takes the brand
   * colour rather than the page ground, which is what makes it look like part
   * of the app instead of a website someone opened. One constant to change. */
  var BAR = { light: '#C2791A', dark: '#8E5A10' };

  function paintBar(mode) {
    var tag = document.querySelector('meta[name="theme-color"]');
    if (!tag) {
      tag = document.createElement('meta');
      tag.setAttribute('name', 'theme-color');
      document.head.appendChild(tag);
    }
    tag.setAttribute('content', BAR[resolved(mode)]);
  }

  function apply(mode) {
    var el = document.documentElement;
    if (mode === 'auto') el.removeAttribute('data-theme');
    else el.setAttribute('data-theme', mode);
    paintBar(mode);
  }

  /* "DIGITAL CONSULTANCY" is set to the exact width of "PATHFINDER" above it.
   * That cannot be done in CSS — the tracking depends on the rendered width of
   * two different strings at two different sizes — so it is measured once the
   * font is actually in, and again if it arrives late. */
  function fitSub(name, sub) {
    if (!name || !sub) return;
    sub.style.letterSpacing = '0';
    var want = name.getBoundingClientRect().width;
    var have = sub.getBoundingClientRect().width;
    if (!want || !have) return;
    var gaps = Math.max(1, (sub.textContent || '').length - 1);
    var per = (want - have) / gaps;

    /* Wide enough for the real font. The first version capped this at 0.62px,
     * which was tuned against a fallback face because the webfont had not
     * loaded — with IBM Plex the subtitle needs roughly twice that, so it came
     * out visibly short. The clamp is only here to stop a broken measurement
     * from exploding the lockup. */
    sub.style.letterSpacing = Math.max(-0.5, Math.min(8, per)) + 'px';

    /* letter-spacing adds a trailing gap after the last character, so the line
     * ends up one gap too wide. Pull it back by exactly that. */
    sub.style.marginRight = (-Math.max(0, per)) + 'px';
  }

  function brand() {
    var wrap = document.createElement('span');
    wrap.className = 'brand';
    wrap.innerHTML = PIN +
      '<span class="brand-words">' +
        '<span class="brand-name">PATHFINDER</span>' +
        '<span class="brand-sub">DIGITAL CONSULTANCY</span>' +
      '</span>';
    var name = wrap.querySelector('.brand-name');
    var sub = wrap.querySelector('.brand-sub');
    function fit(){ fitSub(name, sub); }
    fit();
    /* fonts.ready can resolve before the face is actually painted, and the
     * lockup is wrong in a way you can see if it does. Measure again when the
     * specific face reports in, and once more on the next frame. */
    if (document.fonts) {
      if (document.fonts.ready) document.fonts.ready.then(function(){ fit(); requestAnimationFrame(fit); }).catch(function(){});
      if (document.fonts.load) document.fonts.load('700 17px "IBM Plex Sans"').then(fit).catch(function(){});
      if (document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', fit);
    }
    window.addEventListener('resize', fit);
    return wrap;
  }

  function mount() {
    var host = document.getElementById('pagechrome');
    if (!host) return;
    host.innerHTML = '';
    host.appendChild(brand());
    var actions = document.createElement('span');
    actions.className = 'chrome-actions';
    host.appendChild(actions);

    var mode = saved();
    apply(mode);

    var themeBtn = document.createElement('button');
    themeBtn.type = 'button';
    themeBtn.className = 'themebtn';
    themeBtn.id = 'themebtn';

    function draw() {
      themeBtn.innerHTML = ICONS[mode] + '<span>' + LABEL[mode] + '</span>';
      themeBtn.setAttribute('aria-label', 'Appearance: ' + LABEL[mode] + '. Click to change.');
      themeBtn.title = 'Appearance: ' + LABEL[mode];
    }
    draw();

    themeBtn.addEventListener('click', function () {
      mode = ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length];
      try { localStorage.setItem(KEY, mode); } catch (e) {}
      apply(mode);
      draw();
    });
    actions.appendChild(themeBtn);

    /* Following the system means following it as it changes. */
    try {
      matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
        if (mode === 'auto') paintBar(mode);
      });
    } catch (e) {}

    /* Full screen is Chrome and Firefox on Android. iOS Safari has no
     * Fullscreen API for a page, so rather than show a button that does
     * nothing there, the button only exists where the API does — on iOS,
     * Share → Add to Home Screen gives the same thing and keeps it. */
    var can = !!(document.documentElement.requestFullscreen ||
                 document.documentElement.webkitRequestFullscreen);
    var fullBtn = document.createElement('button');
    fullBtn.type = 'button';
    fullBtn.className = 'themebtn fullbtn' + (can ? ' can-full' : '');
    fullBtn.id = 'fullbtn';

    var IN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
             'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
             '<path d="M4 9V4h5"/><path d="M20 9V4h-5"/><path d="M4 15v5h5"/><path d="M20 15v5h-5"/></svg>';
    var OUT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
              'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
              '<path d="M9 4v5H4"/><path d="M15 4v5h5"/><path d="M9 20v-5H4"/><path d="M15 20v-5h5"/></svg>';

    function drawFull() {
      var on = !!(document.fullscreenElement || document.webkitFullscreenElement);
      fullBtn.innerHTML = (on ? OUT : IN) + '<span>' + (on ? 'Exit' : 'Full screen') + '</span>';
      fullBtn.setAttribute('aria-pressed', String(on));
    }
    drawFull();

    fullBtn.addEventListener('click', function () {
      var doc = document, el = doc.documentElement;
      var on = !!(doc.fullscreenElement || doc.webkitFullscreenElement);
      try {
        if (on) (doc.exitFullscreen || doc.webkitExitFullscreen).call(doc);
        else (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
      } catch (e) { /* a browser that says it can and then will not */ }
    });
    document.addEventListener('fullscreenchange', drawFull);
    document.addEventListener('webkitfullscreenchange', drawFull);
    actions.appendChild(fullBtn);
  }

  root.PageChrome = { mount: mount, apply: apply, saved: saved, resolved: resolved,
                      brand: brand };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})(typeof window !== 'undefined' ? window : globalThis);
