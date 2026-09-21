window.TrackerApp = function(){
  var tb = document.getElementById('tb');
  var rows = Array.prototype.slice.call(tb.querySelectorAll('tr'));
  var qfs = Array.prototype.slice.call(document.querySelectorAll('.qf'));
  var cols = Array.prototype.slice.call(document.querySelectorAll('.colbtn'));
  var counter = document.getElementById('rowcount');
  var emptymsg = document.getElementById('emptymsg');
  var resetBtn = document.getElementById('resetall');

  var stats = Array.prototype.slice.call(document.querySelectorAll('.tstat'));
  var STATUS_LABEL = {live:'Live', lead:'In progress', wait:'Awaiting', shut:'Closed out'};
  var filters = {s:'', date:'', via:'', type:'', cv:'', stale:false, q:''};
  var sortKey = 'applied', sortDir = 'desc';

  function uniq(attr){
    var seen = {}, out = [];
    rows.forEach(function(r){
      var v = r.getAttribute(attr);
      if (!seen[v]){ seen[v] = 1; out.push(v); }
    });
    return out;
  }
  var DATES = uniq('data-date');
  var VIAS  = uniq('data-via').sort();
  var TYPES = uniq('data-type').sort();
  var CVS   = uniq('data-cv').sort();

  /* ---------- persistence (this browser only) ---------- */
  /* window.Tracker is the v3 store (per-account, backed up to Drive). Without
   * it — an offline build opened straight from the filesystem — fall back to a
   * single localStorage key, which is how v2 worked. */
  var SHELF = window.Tracker || null;
  var STORE = (window.TRACKER_CONFIG && window.TRACKER_CONFIG.storeKey) || 'job-pipeline/edits/v1';
  function loadStore(){
    if (SHELF) return SHELF.rows();
    try { return JSON.parse(localStorage.getItem(STORE) || '{}') || {}; }
    catch (e) { return {}; }
  }
  function writeStore(o){
    if (SHELF) return SHELF.touch();
    try { localStorage.setItem(STORE, JSON.stringify(o)); } catch (e) {}
  }
  var STATE = loadStore();

  /* The stale badge ("22d") is a child of the updated cell, so reading the
   * cell's textContent gets "24 Aug22d" — and saving that makes it permanent,
   * then the next render appends another badge to it, and the next. Two rows
   * had already reached "24 Aug22d22d22d". markStale stashes the real value on
   * data-base before it ever appends, so trust that; the trailing strip heals
   * the rows already corrupted. */
  function updShownOf(tr) {
    var cell = tr.querySelector('.c-upd');
    if (!cell) return '';
    var base = cell.getAttribute('data-base');
    return (base === null ? cell.textContent : base).replace(/(\s*\d+d)+$/, '').trim();
  }

  /* Remember that a field was set by hand so a later Gmail sweep treats it as
   * a decision to respect rather than something to quietly overwrite. */
  function markManual(tr, fields){
    if (!SHELF) return;
    var id = tr.getAttribute('data-id');
    fields.forEach(function(f){ SHELF.markManual(id, f); });
  }

  function persist(tr){
    var id = tr.getAttribute('data-id');
    if (!id) return;
    STATE[id] = {
      s: tr.getAttribute('data-s'),
      label: tr.querySelector('.pill').textContent.trim(),
      type: tr.getAttribute('data-type'),
      applied: tr.getAttribute('data-applied'),
      date: tr.getAttribute('data-date'),
      updated: tr.getAttribute('data-updated'),
      updShown: updShownOf(tr),
      via: tr.getAttribute('data-via'),
      viaLabel: tr.querySelector('.c-src .cellf > span:last-child').textContent.trim(),
      co: coOf(tr),
      role: roleOf(tr),
      note: noteOf(tr),
      cv: tr.getAttribute('data-cv'),
      cl: tr.getAttribute('data-cl') || '',
      jd: tr.getAttribute('data-jd') || '',
      star: tr.getAttribute('data-star') === '1'
    };
    writeStore(STATE);
  }

  /* ---------- starred (max 3) ---------- */
  var STAR_MAX = 3;
  function starCount(){
    return rows.filter(function(r){ return r.getAttribute('data-star') === '1'; }).length;
  }
  function setStar(tr, on, quiet){
    if (on && tr.getAttribute('data-star') !== '1' && starCount() >= STAR_MAX) return false;
    tr.setAttribute('data-star', on ? '1' : '0');
    var b = tr.querySelector('.starbtn');
    if (b) b.setAttribute('aria-pressed', String(!!on));
    if (!quiet) persist(tr);
    return true;
  }
  function renderStarred(){
    var sec = document.getElementById('starred-sec');
    var ul = document.getElementById('starlist');
    if (!sec || !ul) return;
    var starred = rows.filter(function(r){ return r.getAttribute('data-star') === '1'; });
    sec.hidden = !starred.length;
    ul.innerHTML = '';
    starred.forEach(function(r){
      var note = noteOf(r);
      var li = document.createElement('li');
      var st = document.createElement('span');
      st.className = 'listar';
      st.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="m12 3.7 2.55 5.17 5.7.83-4.12 4.02.97 5.68L12 16.7l-5.1 2.7.97-5.68L3.75 9.7l5.7-.83z"/></svg>';
      var co = document.createElement('span'); co.className = 'co'; co.textContent = coOf(r);
      var rl = document.createElement('span'); rl.className = 'rl'; rl.textContent = roleOf(r);
      var nx = document.createElement('span'); nx.className = 'nx';
      var label = r.querySelector('.pill').textContent.trim();
      nx.textContent = note ? (label + ' \u00b7 ' + note) : label;
      li.appendChild(st); li.appendChild(co); li.appendChild(rl); li.appendChild(nx);
      ul.appendChild(li);
    });
  }

  /* ---------- job description ---------- */
  var jdDlg = document.getElementById('jddlg');
  var jdText = document.getElementById('jd-text');
  var jdTitle = document.getElementById('jd-title');
  var jdHint = document.getElementById('jd-hint');
  var jdRow = null;
  function jdMark(tr){
    var b = tr.querySelector('.copill');
    if (b) b.classList.toggle('has-jd', !!(tr.getAttribute('data-jd') || '').trim());
  }
  function openJd(tr){
    jdRow = tr;
    jdTitle.textContent = 'Job description \u2014 ' + coOf(tr);
    jdText.value = tr.getAttribute('data-jd') || '';
    jdHint.textContent = 'Saved automatically';
    jdDlg.showModal();
    jdText.focus();
  }
  jdText.addEventListener('input', function(){
    if (!jdRow) return;
    jdRow.setAttribute('data-jd', jdText.value);
    jdMark(jdRow);
    persist(jdRow);
    jdHint.textContent = jdText.value.trim()
      ? 'Saved \u00b7 ' + jdText.value.trim().split(/\s+/).length + ' words'
      : 'Saved automatically';
  });
  document.getElementById('jd-close').addEventListener('click', function(){ jdDlg.close(); });
  document.getElementById('jd-copy').addEventListener('click', function(){
    var v = jdText.value;
    function done(){ jdHint.textContent = 'Copied to clipboard'; }
    if (navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(v).then(done, function(){ jdText.select(); document.execCommand('copy'); done(); });
    } else { jdText.select(); document.execCommand('copy'); done(); }
  });

  /* ---------- cover letter ---------- */
  var clDlg = document.getElementById('cldlg');
  var clText = document.getElementById('cl-text');
  var clTitle = document.getElementById('cl-title');
  var clHint = document.getElementById('cl-hint');
  var clRow = null;

  function clLabel(tr){
    var txt = tr.getAttribute('data-cl') || '';
    var btn = tr.querySelector('.clbtn');
    if (!btn) return;
    if (txt){
      var first = txt.replace(/\s+/g, ' ').trim().slice(0, 26);
      btn.textContent = first + (txt.length > 26 ? '…' : '');
      btn.classList.add('filled');
      btn.title = 'Open cover letter';
    } else {
      btn.textContent = 'Add';
      btn.classList.remove('filled');
      btn.title = 'Add a cover letter';
    }
  }

  function openCover(tr){
    clRow = tr;
    clTitle.textContent = 'Cover letter — ' + coOf(tr);
    clText.value = tr.getAttribute('data-cl') || '';
    clHint.textContent = 'Saved automatically';
    clDlg.showModal();
    clText.focus();
  }

  clText.addEventListener('input', function(){
    if (!clRow) return;
    clRow.setAttribute('data-cl', clText.value);
    clLabel(clRow);
    persist(clRow);
    clHint.textContent = clText.value.trim()
      ? 'Saved · ' + clText.value.trim().split(/\s+/).length + ' words'
      : 'Saved automatically';
  });

  document.getElementById('cl-close').addEventListener('click', function(){ clDlg.close(); });
  document.getElementById('cl-copy').addEventListener('click', function(){
    var v = clText.value;
    function done(){ clHint.textContent = 'Copied to clipboard'; }
    if (navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(v).then(done, function(){ clText.select(); document.execCommand('copy'); done(); });
    } else { clText.select(); document.execCommand('copy'); done(); }
  });

  /* ---------- manual status editing (session only) ---------- */
  var RANKJS = {live:0, lead:1, wait:2, shut:3};
  var STATUS_OPTIONS = [
    ['live', 'Interview'], ['live', 'Screening'],
    ['lead', 'In progress'],
    ['wait', 'Awaiting'],
    ['shut', 'Not shortlisted'], ['shut', 'Withdrew']
  ];

  function coOf(tr){
    var b = tr.querySelector('.copill');
    return (b || tr.querySelector('.c-co')).textContent.trim();
  }
  function setCo(tr, v){
    var b = tr.querySelector('.copill');
    if (b) b.textContent = v; else tr.querySelector('.c-co').textContent = v;
    /* the avatar is the first letter of the name, so a rename has to redraw it */
    var av = tr.querySelector('.coav');
    if (av && window.Render && window.Render.initial) av.textContent = window.Render.initial(v);
  }

  function roleOf(tr){
    var cell = tr.querySelector('.c-role').cloneNode(true);
    var n = cell.querySelector('.note');
    if (n) n.parentNode.removeChild(n);
    return cell.textContent.trim();
  }
  function noteOf(tr){
    var n = tr.querySelector('.c-role .note');
    return n ? n.textContent.trim() : '';
  }

  function renderLive(){
    var ul = document.querySelector('.live-list');
    if (!ul) return;
    var live = rows.filter(function(r){ return r.getAttribute('data-s') === 'live'; });
    ul.innerHTML = '';
    if (!live.length){
      var empty = document.createElement('li');
      empty.className = 'none';
      empty.textContent = 'Nothing live right now.';
      ul.appendChild(empty);
      return;
    }
    live.forEach(function(r){
      var label = r.querySelector('.pill').textContent.trim();
      var note = noteOf(r);
      var li = document.createElement('li');
      var dot = document.createElement('span'); dot.className = 'dot dot-live';
      var co = document.createElement('span'); co.className = 'co';
      co.textContent = coOf(r);
      var rl = document.createElement('span'); rl.className = 'rl';
      rl.textContent = roleOf(r);
      var nx = document.createElement('span'); nx.className = 'nx';
      nx.textContent = note ? (label + ' · ' + note) : label;
      li.appendChild(dot); li.appendChild(co); li.appendChild(rl); li.appendChild(nx);
      ul.appendChild(li);
    });
  }

  function setStatusQuiet(tr, st, label){
    tr.setAttribute('data-s', st);
    tr.setAttribute('data-rank', String(RANKJS[st]));
    var pill = tr.querySelector('.pill');
    pill.innerHTML = '';
    var d = document.createElement('span');
    d.className = 'dot dot-' + st;
    pill.appendChild(d);
    pill.appendChild(document.createTextNode(label));
  }
  function setStatus(tr, st, label){
    setStatusQuiet(tr, st, label);
    markManual(tr, ['status', 'chip']);
    persist(tr); apply();
  }

  function buildStatusMenu(tr){
    menu.innerHTML = '';
    var lab = document.createElement('div');
    lab.className = 'mlabel';
    lab.textContent = 'Set status';
    menu.appendChild(lab);
    var current = tr.querySelector('.pill').textContent.trim();
    STATUS_OPTIONS.forEach(function(o, i){
      if (i === 2 || i === 4) menu.appendChild(document.createElement('hr'));
      menu.appendChild(mkBtn(
        '<span class="dot dot-' + o[0] + '"></span>' + o[1],
        current === o[1],
        function(){ setStatus(tr, o[0], o[1]); },
        true));
    });
  }

  tb.addEventListener('click', function(e){
    if (!e.target.closest) return;
    var pill = e.target.closest('.pill');
    if (pill){
      e.stopPropagation();
      if (openFor === pill){ closeMenu(); return; }
      buildStatusMenu(pill.closest('tr'));
      placeMenu(pill);
      openFor = pill;
      return;
    }
    var star = e.target.closest('.starbtn');
    if (star){
      e.stopPropagation(); closeMenu();
      var strow = star.closest('tr');
      var want = strow.getAttribute('data-star') !== '1';
      if (!setStar(strow, want)){
        star.classList.add('nope');
        setTimeout(function(){ star.classList.remove('nope'); }, 420);
      }
      renderStarred();
      return;
    }
    var del = e.target.closest('.delbtn');
    if (del){ e.stopPropagation(); closeMenu(); deleteRow(del.closest('tr')); return; }
    var cop = e.target.closest('.copill');
    if (cop){ e.stopPropagation(); closeMenu(); openJd(cop.closest('tr')); return; }
    var cl = e.target.closest('.clbtn');
    if (cl){ e.stopPropagation(); closeMenu(); openCover(cl.closest('tr')); return; }
    var more = e.target.closest('.rowbtn');
    if (more){ e.stopPropagation(); closeMenu(); openEditor(more.closest('tr')); }
  });

  tb.addEventListener('change', function(e){
    var sel = e.target.closest ? e.target.closest('.cvsel') : null;
    if (!sel) return;
    var tr = sel.closest('tr');
    var current = tr.getAttribute('data-cv') || '\u2014';

    /* The last group is not a list of CVs — it is three things to do. Put the
     * dropdown back to what the row actually says before running any of them,
     * so a cancelled upload does not silently change which CV this row used. */
    if (window.CVUI && window.CVUI.isAction(sel.value)){
      var action = sel.value;
      sel.value = current;
      if (action === window.CVUI.OPEN) window.CVUI.openCv(current, function(msg, bad){
        if (msg && window.Toast) window.Toast.show({text: msg, tone: bad ? 'warn' : 'info'});
      });
      else window.CVUI.open(action === window.CVUI.UPLOAD ? 'upload' : null);
      return;
    }

    tr.setAttribute('data-cv', sel.value);
    /* Redrawn because the actions group depends on the selection: "Open this
     * CV" only belongs there once there is a file to open. */
    if (window.cvOptionsHtml) sel.innerHTML = window.cvOptionsHtml(sel.value);
    markManual(tr, ['cv']);
    persist(tr);
    refreshFacets();
    apply();
  });

  /* ---------- delete a row (stays deleted in this browser) ---------- */
  function mergeKeyOf(tr){
    if (!window.Merge) return '';
    return window.Merge.keyOf({ company: coOf(tr), role: roleOf(tr) });
  }

  function deleteRow(tr){
    var id = tr.getAttribute('data-id');
    var i = rows.indexOf(tr);
    var after = tr.nextSibling;
    var parent = tr.parentNode;
    var co = coOf(tr);

    if (i > -1) rows.splice(i, 1);
    parent.removeChild(tr);
    if (id){ STATE[id] = {deleted: true}; }
    if (SHELF) SHELF.markDeleted(mergeKeyOf(tr));
    writeStore(STATE);
    refreshFacets(); apply(); renderStarred();

    if (!window.Toast) return;
    window.Toast.show({
      text: co ? ('Deleted ' + co) : 'Row deleted',
      tone: 'warn',
      timeout: 9000,
      action: { label: 'Undo', onClick: function(){
        parent.insertBefore(tr, after);
        rows.splice(Math.min(i < 0 ? rows.length : i, rows.length), 0, tr);
        if (id) delete STATE[id];
        if (SHELF) SHELF.undeleted(mergeKeyOf(tr));
        writeStore(STATE);
        persist(tr);
        refreshFacets(); apply(); renderStarred();
      }}
    });
  }

  /* ---------- show / hide columns ---------- */
  var COLS = [
    ['c-status','Status'], ['c-date','Applied'], ['c-co','Company'],
    ['c-role','Role / Latest'], ['c-type','Type'], ['c-src','Via'],
    ['c-upd','Updated'], ['c-cl','Cover letter'], ['c-cv','CV']
  ];
  var hidden = {};
  function setCol(key, on){
    hidden[key] = !on;
    var th = headRow.querySelector('[data-col="' + key + '"]');
    if (th) th.style.display = on ? '' : 'none';
    rows.forEach(function(r){
      var td = r.querySelector('.' + key);
      if (td) td.style.display = on ? '' : 'none';
    });
  }
  var colsBtn = document.getElementById('colsbtn');
  colsBtn.addEventListener('click', function(e){
    e.stopPropagation();
    if (openFor === colsBtn){ closeMenu(); return; }
    menu.innerHTML = '';
    var lab = document.createElement('div');
    lab.className = 'mlabel'; lab.textContent = 'Show columns';
    menu.appendChild(lab);
    COLS.forEach(function(c){
      menu.appendChild(mkBtn(c[1], !hidden[c[0]], function(){
        setCol(c[0], !!hidden[c[0]]);
      }, true));
    });
    placeMenu(colsBtn);
    openFor = colsBtn;
    colsBtn.setAttribute('aria-expanded', 'true');
  });

  /* ---------- full row editor ---------- */
  var MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function toISO(n){
    n = String(n || '');
    return n.length === 8 ? n.slice(0,4) + '-' + n.slice(4,6) + '-' + n.slice(6) : '';
  }
  function fromISO(v){ return v ? parseInt(v.replace(/-/g, ''), 10) : 0; }
  function human(v){
    if (!v) return '—';
    var p = v.split('-');
    return String(parseInt(p[2], 10)) + ' ' + MON[parseInt(p[1], 10) - 1];
  }

  var dlg = document.getElementById('editdlg');
  var edCo = document.getElementById('ed-co');
  var edRole = document.getElementById('ed-role');
  var edNote = document.getElementById('ed-note');
  var edStatus = document.getElementById('ed-status');
  var edType = document.getElementById('ed-type');
  var edApplied = document.getElementById('ed-applied');
  var edUpdated = document.getElementById('ed-updated');
  var edSrc = document.getElementById('ed-src');
  var edVia = document.getElementById('ed-via');
  var editing = null;

  STATUS_OPTIONS.forEach(function(o){
    var op = document.createElement('option');
    op.value = o[0] + '|' + o[1];
    op.textContent = o[1];
    edStatus.appendChild(op);
  });
  Object.keys(TYPE_ICONS).forEach(function(k){
    var op = document.createElement('option');
    op.value = k; op.textContent = k; edType.appendChild(op);
  });
  Object.keys(SRC_BADGE).sort().forEach(function(k){
    var op = document.createElement('option');
    op.value = k; op.textContent = k; edSrc.appendChild(op);
  });
  var edCv = document.getElementById('ed-cv');
  /* The editor offers the same library as the column, minus the actions —
   * uploading from inside a half-finished edit would lose the edit. */
  function fillEdCv(current){
    if (window.cvOptionsHtml){ edCv.innerHTML = window.cvOptionsHtml(current || '\u2014', false); return; }
    edCv.innerHTML = '';
    (window.CV_OPTIONS || []).forEach(function(v){
      var op = document.createElement('option');
      op.value = v; op.textContent = v; edCv.appendChild(op);
    });
    if (current) edCv.value = current;
  }
  fillEdCv('\u2014');

  /* Re-apply everything saved in this browser on top of freshly drawn rows.
   * Called once at start-up, and again whenever a Gmail refresh replaces
   * the row set. */
  function restoreSaved(){
    rows.slice().forEach(function(tr){
      var gone = STATE[tr.getAttribute('data-id')];
      if (gone && gone.deleted){
        rows.splice(rows.indexOf(tr), 1);
        tr.parentNode.removeChild(tr);
      }
    });
    rows.forEach(function(tr){
      var st = STATE[tr.getAttribute('data-id')];
      if (!st) return;
      if (st.s && st.label) setStatusQuiet(tr, st.s, st.label);
      if (st.co){ setCo(tr, st.co); tr.setAttribute('data-co', st.co.toLowerCase()); }
      if (typeof st.role === 'string' && st.role){
        var rc = tr.querySelector('.c-role');
        rc.textContent = st.role;
        tr.setAttribute('data-role', st.role.toLowerCase());
        if (st.note){
          var nn = document.createElement('span');
          nn.className = 'note'; nn.textContent = st.note;
          rc.appendChild(nn);
        }
      }
      if (st.type){
        tr.setAttribute('data-type', st.type);
        tr.querySelector('.c-type').innerHTML =
          '<span class="cellf"><span class="tyi">' + (TYPE_ICONS[st.type] || '') + '</span><span></span></span>';
        tr.querySelector('.c-type .cellf > span:last-child').textContent = st.type;
      }
      if (st.via){
        var b = SRC_BADGE[st.via] || ['?', ''];
        tr.setAttribute('data-via', st.via);
        tr.querySelector('.c-src').innerHTML =
          '<span class="cellf"><span class="vlogo ' + b[1] + '">' + b[0] + '</span><span></span></span>';
        tr.querySelector('.c-src .cellf > span:last-child').textContent = st.viaLabel || st.via;
      }
      if (st.applied !== undefined){
        tr.setAttribute('data-applied', st.applied);
        tr.setAttribute('data-date', st.date);
        tr.querySelector('.c-date').textContent = st.date;
      }
      if (st.updated !== undefined){
        tr.setAttribute('data-updated', st.updated);
        var uc = tr.querySelector('.c-upd');
        uc.textContent = st.updShown;
        uc.removeAttribute('data-base');
      }
      if (st.cv){
        tr.setAttribute('data-cv', st.cv);
        var sel = tr.querySelector('.cvsel');
        /* Redrawn rather than just assigned: a saved CV may be one the library
         * has since deleted, and assigning a value with no matching option
         * silently leaves the dropdown on "Select CV…". */
        if (sel && window.cvOptionsHtml) sel.innerHTML = window.cvOptionsHtml(st.cv);
        else if (sel) sel.value = st.cv;
      }
      tr.setAttribute('data-cl', st.cl || '');
      tr.setAttribute('data-jd', st.jd || '');
      if (st.star) setStar(tr, true, true);
    });
    rows.forEach(clLabel);
    rows.forEach(jdMark);
    refreshFacets();
  }
  restoreSaved();

  /* Swap in a new set of rows without a page reload — which matters because
   * the Google token lives in memory, and reloading would sign you out. All
   * the row handlers are delegated from the table, so they survive this. */
  window.TrackerApp.reload = function(list){
    window.Render.rows(list);
    rows = Array.prototype.slice.call(tb.querySelectorAll('tr'));
    restoreSaved();
    apply();
    setSort(sortKey, sortDir);
    renderStarred();
  };

  /* Set while the dialog is showing a row that does not exist yet, so
   * cancelling takes the half-made row away with it. */
  var adding = null;

  function openEditor(tr, isNew){
    editing = tr;
    adding = isNew ? tr : null;
    document.getElementById('ed-title').textContent =
      isNew ? 'Add an application' : 'Edit application';
    document.getElementById('ed-save').textContent =
      isNew ? 'Add it' : 'Save changes';
    var paste = document.getElementById('ed-paste');
    if (paste){ paste.hidden = !isNew; paste.open = false; }
    var pt = document.getElementById('paste-text');
    if (pt) pt.value = '';
    var ph = document.getElementById('paste-hint');
    if (ph) ph.textContent = '';
    prepCheck(tr, isNew);
    edCo.value = coOf(tr);
    edRole.value = roleOf(tr);
    edNote.value = noteOf(tr);
    edStatus.value = tr.getAttribute('data-s') + '|' + tr.querySelector('.pill').textContent.trim();
    if (!edStatus.value || edStatus.selectedIndex < 0) edStatus.selectedIndex = 0;
    edType.value = tr.getAttribute('data-type') || '';
    edApplied.value = toISO(tr.getAttribute('data-applied'));
    edUpdated.value = toISO(tr.getAttribute('data-updated'));
    edSrc.value = tr.getAttribute('data-via') || '';
    edVia.value = tr.querySelector('.c-src .cellf > span:last-child').textContent.trim();
    fillEdCv(tr.getAttribute('data-cv') || '\u2014');
    dlg.showModal();
  }

  function dropAdding(){
    if (!adding) return;
    var i = rows.indexOf(adding);
    if (i > -1) rows.splice(i, 1);
    if (adding.parentNode) adding.parentNode.removeChild(adding);
    adding = null;
    refreshFacets(); apply(); renderStarred();
  }

  document.getElementById('ed-cancel').addEventListener('click', function(){ dlg.close(); });
  /* Esc closes a <dialog> without going through Cancel. */
  dlg.addEventListener('close', function(){ dropAdding(); });

  document.getElementById('editform').addEventListener('submit', function(){
    if (!editing) return;
    var tr = editing;
    var st = edStatus.value.split('|');

    /* Everything the editor touches is a deliberate decision, so a later Gmail
     * sweep has to ask before changing any of it. */
    markManual(tr, ['status', 'chip', 'note', 'applied', 'updated', 'sourceLabel']);

    setStatusQuiet(tr, st[0], st[1]);

    setCo(tr, edCo.value);
    tr.setAttribute('data-co', edCo.value.toLowerCase());

    var roleCell = tr.querySelector('.c-role');
    roleCell.textContent = edRole.value;
    tr.setAttribute('data-role', edRole.value.toLowerCase());
    if (edNote.value){
      var nn = document.createElement('span');
      nn.className = 'note';
      nn.textContent = edNote.value;
      roleCell.appendChild(nn);
    }

    var ty = edType.value;
    tr.setAttribute('data-type', ty);
    tr.querySelector('.c-type').innerHTML =
      '<span class="cellf"><span class="tyi">' + (TYPE_ICONS[ty] || '') +
      '</span><span></span></span>';
    tr.querySelector('.c-type .cellf > span:last-child').textContent = ty;

    var src = edSrc.value;
    var badge = SRC_BADGE[src] || ['?', ''];
    tr.setAttribute('data-via', src);
    tr.querySelector('.c-src').innerHTML =
      '<span class="cellf"><span class="vlogo ' + badge[1] + '">' + badge[0] +
      '</span><span></span></span>';
    tr.querySelector('.c-src .cellf > span:last-child').textContent = edVia.value || src;

    tr.setAttribute('data-applied', String(fromISO(edApplied.value)));
    tr.setAttribute('data-date', human(edApplied.value));
    tr.querySelector('.c-date').textContent = human(edApplied.value);

    tr.setAttribute('data-updated', String(fromISO(edUpdated.value)));
    var updCell = tr.querySelector('.c-upd');
    updCell.textContent = human(edUpdated.value);
    updCell.removeAttribute('data-base');

    tr.setAttribute('data-cv', edCv.value);
    var cvSel = tr.querySelector('.cvsel');
    if (cvSel && window.cvOptionsHtml) cvSel.innerHTML = window.cvOptionsHtml(edCv.value);
    else if (cvSel) cvSel.value = edCv.value;

    clLabel(tr);
    jdMark(tr);
    adding = null;          /* it exists now — the close handler must not bin it */
    persist(tr);
    refreshFacets();
    apply();
    setSort(sortKey, sortDir);
    renderStarred();
    editing = null;
  });

  /* A blank row, drawn by the same renderer as every other row so it carries
   * the same attributes and the same delegated handlers, then handed to the
   * editor. Nothing is saved until the dialog is submitted. */
  var addBtn = document.getElementById('addrow');
  if (addBtn) addBtn.addEventListener('click', function(){
    var today = new Date();
    function p(n){ return n < 10 ? '0' + n : String(n); }
    var sortNum = Number('' + today.getFullYear() + p(today.getMonth() + 1) + p(today.getDate()));
    var MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    var shown = today.getDate() + ' ' + MON[today.getMonth()];

    var html = window.Render.rowHtml({
      status: 'wait', chip: 'Awaiting', company: '', role: '',
      type: 'Full-Time', source: 'Direct', sourceLabel: 'Direct',
      applied: shown, appliedSort: sortNum, updated: '\u2014', updatedSort: 0,
      note: '', id: 'new-' + Date.now()
    });
    var holder = document.createElement('tbody');
    holder.innerHTML = html;
    var tr = holder.firstElementChild;
    tb.insertBefore(tr, tb.firstChild);
    rows.unshift(tr);
    openEditor(tr, true);
    edCo.focus();
  });

  /* ---------- paste-to-fill ----------
   *
   * Reads a confirmation screen, a job card or an ATS thank-you page and fills
   * the form in. It runs here, on the text in the box — nothing is uploaded and
   * no model is called — so it is wrong sometimes by design: it fills the form
   * and you correct it, rather than writing a row behind your back.
   *
   * It cannot read a screenshot. A static page has no OCR, and bolting one on
   * would be megabytes of wasm that misreads phone captures anyway.
   */
  var ROLE_WORDS = /\b(designer|design|lead|manager|engineer|developer|director|head|consultant|analyst|architect|producer|officer|specialist|contractor|researcher|strategist|principal|senior|junior|ux|ui|product)\b/i;

  function parsePasted(text){
    var raw = String(text || '');
    var lines = raw.split(/\n+/).map(function(l){ return l.trim(); }).filter(Boolean);
    var out = {};

    /* The employer, best evidence first: LinkedIn says it outright, an ATS
     * thank-you usually names itself, and a job card puts it under the title. */
    var m = raw.match(/your application was sent to\s+([^!\n]+)/i)
         || raw.match(/thank you for your interest in\s+(?:a career at\s+)?(?:the\s+)?([^.!\n]+)/i)
         || raw.match(/application (?:to|for)\s+([^\n,.]+?)\s+(?:has been|was)\s+(?:received|sent)/i);
    if (m) out.company = m[1].replace(/[!.]+$/, '').trim();

    /* A job card: title on one line, employer on the next. */
    if (!out.company || !lines.length){
      for (var i = 0; i < lines.length - 1; i++){
        if (ROLE_WORDS.test(lines[i]) && lines[i].length < 90 &&
            lines[i + 1].length < 60 && !/^(london|england|united kingdom|remote|hybrid|on.site)/i.test(lines[i + 1])){
          out.role = out.role || lines[i];
          out.company = out.company || lines[i + 1].split(/\s+[\u00b7|]\s+/)[0].trim();
          break;
        }
      }
    }

    if (!out.role){
      for (var j = 0; j < lines.length; j++){
        var l = lines[j];
        if (ROLE_WORDS.test(l) && l.length < 90 && !/your application|thank you|keep track|update profile/i.test(l)){
          out.role = l; break;
        }
      }
    }

    /* Contract shape. FTC and maternity cover are temporary even when the
     * advert also says full-time, so those are tested first. */
    if (/\bftc\b|fixed[- ]term|maternity|\b\d+[- ]month\b/i.test(raw)) out.type = 'Temporary';
    else if (/\bcontract\b|outside ir35|inside ir35|day rate|\/hr|per hour|gbp\/hr/i.test(raw)) out.type = 'Contract';
    else if (/part[- ]time/i.test(raw)) out.type = 'Part-Time';
    else if (/freelance/i.test(raw)) out.type = 'Freelance';
    else if (/fractional/i.test(raw)) out.type = 'Fractional';
    else if (/full[- ]time|permanent/i.test(raw)) out.type = 'Full-Time';

    /* Where it came from — match the boards we already know by name. */
    var badges = Object.keys(window.SRC_BADGE || {});
    for (var k = 0; k < badges.length; k++){
      if (badges[k] === 'Unknown' || badges[k] === 'Direct') continue;
      if (new RegExp('\\b' + badges[k].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(raw)){
        out.source = badges[k]; break;
      }
    }
    if (!out.source && /pinpointhq/i.test(raw)) out.source = 'Direct';
    /* LinkedIn's confirmation screen never says "LinkedIn" on it. Its wording
     * is the giveaway, so match that rather than the brand name. */
    if (!out.source && /("|\u201c)applied("|\u201d)\s+tab of my jobs|your application was sent to|easy apply/i.test(raw)) {
      out.source = 'LinkedIn';
    }
    if (!out.source && /linkedin/i.test(raw)) out.source = 'LinkedIn';

    /* Anything worth keeping that has nowhere else to go. */
    var bits = [];
    var rate = raw.match(/[\u00a3$\u20ac]\s?[\d,]+(?:\.\d+)?\s*(?:\u2013|-|to)\s*[\u00a3$\u20ac]?\s?[\d,]+(?:\.\d+)?\s*(?:\/\s*hr|per hour|\/\s*day|k)?/i)
            || raw.match(/[\d,]+\s*(?:GBP|USD|EUR)\s*\/\s*hr\s*(?:\u2013|-|to)\s*[\d,]+\s*(?:GBP|USD|EUR)\s*\/\s*hr/i);
    if (rate) bits.push(rate[0].trim());
    var where = raw.match(/\b(remote|hybrid|on[- ]site)\b/i);
    if (where) bits.push(where[1].toLowerCase());
    if (bits.length) out.note = bits.join(' \u00b7 ');

    return out;
  }

  var pasteBtn = document.getElementById('paste-fill');
  if (pasteBtn) pasteBtn.addEventListener('click', function(){
    var hint = document.getElementById('paste-hint');
    var got = parsePasted(document.getElementById('paste-text').value);
    var filled = [];
    if (got.company){ edCo.value = got.company; filled.push('company'); }
    if (got.role){ edRole.value = got.role; filled.push('role'); }
    if (got.type){ edType.value = got.type; filled.push('type'); }
    if (got.source && window.SRC_BADGE[got.source]){
      edSrc.value = got.source; edVia.value = got.source; filled.push('source');
    }
    if (got.note && !edNote.value){ edNote.value = got.note; filled.push('note'); }
    hint.textContent = filled.length
      ? 'Filled ' + filled.join(', ') + ' \u2014 check it before saving.'
      : 'Could not make anything of that. Fill it in below.';
  });

  /* ---------- check one row against Gmail ----------
   *
   * The sweep reads the whole mailbox; this reads it for one employer, on
   * demand, and shows what it found rather than changing anything. Same
   * read-only scope: it cannot send, reply, label or delete.
   */
  var checkBtn = document.getElementById('ed-check');
  var checkOut = document.getElementById('ed-check-out');

  function prepCheck(tr, isNew){
    if (!checkBtn) return;
    var can = !isNew && window.Google && window.Google.findFor && window.Google.signedIn && window.Google.signedIn();
    checkBtn.hidden = !can;
    checkBtn.disabled = false;
    checkBtn.textContent = 'Check Gmail for replies';
    if (checkOut) checkOut.textContent = '';
  }

  if (checkBtn) checkBtn.addEventListener('click', function(){
    if (!editing) return;
    var co = edCo.value || coOf(editing);
    if (!co){ checkOut.textContent = 'Give it a company name first.'; return; }
    checkBtn.disabled = true;
    checkBtn.textContent = 'Looking\u2026';
    checkOut.textContent = '';
    window.Google.findFor(co, 6).then(function(found){
      checkBtn.disabled = false;
      checkBtn.textContent = 'Check Gmail for replies';
      if (!found.length){ checkOut.textContent = 'Nothing from ' + co + ' in the last 6 months.'; return; }
      checkOut.innerHTML = '';
      var head = document.createElement('span');
      head.className = 'chk-head';
      head.textContent = found.length + ' from ' + co + ':';
      checkOut.appendChild(head);
      found.slice(0, 4).forEach(function(f){
        var li = document.createElement('span');
        li.className = 'chk-line';
        li.textContent = f.when + ' \u00b7 ' + f.subject;
        li.title = f.sender;
        checkOut.appendChild(li);
      });
    }, function(err){
      checkBtn.disabled = false;
      checkBtn.textContent = 'Check Gmail for replies';
      checkOut.textContent = err.message;
    });
  });

  function refreshFacets(){
    DATES = uniq('data-date');
    VIAS = uniq('data-via').sort();
    TYPES = uniq('data-type').sort();
    CVS = uniq('data-cv').sort();
    ['date','via','type','cv'].forEach(function(k){
      if (filters[k] && rows.every(function(r){ return r.getAttribute('data-' + k) !== filters[k]; })) filters[k] = '';
    });
  }

  /* ---------- column move + resize (session only, never persisted) ---------- */
  var table = tb.parentNode;
  var headRow = table.querySelector('thead tr');
  var resetCols = document.getElementById('resetcols');
  var ORDER0 = Array.prototype.map.call(headRow.children, function(th){ return th; });
  var touched = false;
  var fixedOn = false;

  function markTouched(){ touched = true; resetCols.hidden = false; }

  function moveCell(tr, from, to){
    var kids = Array.prototype.slice.call(tr.children);
    var node = kids[from];
    if (to > from) tr.insertBefore(node, kids[to].nextSibling);
    else tr.insertBefore(node, kids[to]);
  }
  function moveCol(from, to){
    if (to < 0 || to >= headRow.children.length) return;
    moveCell(headRow, from, to);
    rows.forEach(function(r){ moveCell(r, from, to); });
    markTouched();
  }

  function lockWidths(){
    if (fixedOn) return;
    var ths = Array.prototype.slice.call(headRow.children);
    var ws = ths.map(function(th){ return th.getBoundingClientRect().width; });
    table.style.width = table.getBoundingClientRect().width + 'px';
    table.style.tableLayout = 'fixed';
    ths.forEach(function(th, i){ th.style.width = ws[i] + 'px'; });
    fixedOn = true;
  }

  ['c-co','c-role','c-type','c-via','c-cl'].forEach(function(id){
    var b = document.getElementById(id);
    if (!b) return;
    var th = b.parentNode;
    var h = document.createElement('span');
    h.className = 'rz';
    h.title = 'Drag to resize';
    th.appendChild(h);

    function start(e){
      e.preventDefault(); e.stopPropagation();
      lockWidths(); markTouched();
      h.classList.add('on');
      var x0 = e.touches ? e.touches[0].clientX : e.clientX;
      var w0 = th.getBoundingClientRect().width;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      function mv(ev){
        var x = ev.touches ? ev.touches[0].clientX : ev.clientX;
        th.style.width = Math.max(96, w0 + (x - x0)) + 'px';
      }
      function up(){
        h.classList.remove('on');
        document.removeEventListener('mousemove', mv);
        document.removeEventListener('mouseup', up);
        document.removeEventListener('touchmove', mv);
        document.removeEventListener('touchend', up);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
      document.addEventListener('mousemove', mv);
      document.addEventListener('mouseup', up);
      document.addEventListener('touchmove', mv, {passive: false});
      document.addEventListener('touchend', up);
    }
    h.addEventListener('mousedown', start);
    h.addEventListener('touchstart', start, {passive: false});
  });

  resetCols.addEventListener('click', function(){
    ORDER0.forEach(function(th){ th.style.width = ''; headRow.appendChild(th); });
    var order = ORDER0.map(function(th){
      var b = th.querySelector('.colbtn');
      return b ? b.id : th.getAttribute('data-col');
    });
    rows.forEach(function(r){
      var byCls = {};
      Array.prototype.slice.call(r.children).forEach(function(td){ byCls[td.className.split(' ')[0]] = td; });
      ['c-star','c-status','c-date','c-co','c-role','c-type','c-src','c-upd','c-cl','c-cv','c-act'].forEach(function(c){
        if (byCls[c]) r.appendChild(byCls[c]);
      });
    });
    table.style.tableLayout = ''; table.style.width = '';
    fixedOn = false; touched = false; resetCols.hidden = true;
  });

  /* ---------- menu ---------- */
  var menu = document.createElement('div');
  menu.className = 'menu';
  menu.hidden = true;
  menu.setAttribute('role','menu');
  document.body.appendChild(menu);
  var openFor = null;

  function closeMenu(){
    menu.hidden = true;
    if (openFor){ openFor.setAttribute('aria-expanded','false'); }
    openFor = null;
  }

  function mkBtn(label, checked, onClick, showTick){
    var b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role','menuitemradio');
    b.setAttribute('aria-checked', String(!!checked));
    b.innerHTML = (showTick ? '<span class="tick">&#10003;</span>' : '') +
                  '<span>' + label + '</span>';
    b.addEventListener('click', function(){ onClick(); closeMenu(); });
    return b;
  }

  function buildMenu(btn){
    var key = btn.getAttribute('data-k');
    var fkey = btn.getAttribute('data-f');
    menu.innerHTML = '';

    var lab1 = document.createElement('div');
    lab1.className = 'mlabel'; lab1.textContent = 'Sort';
    menu.appendChild(lab1);
    menu.appendChild(mkBtn('&#8593;&nbsp; Ascending', sortKey === key && sortDir === 'asc',
      function(){ setSort(key, 'asc'); }, true));
    menu.appendChild(mkBtn('&#8595;&nbsp; Descending', sortKey === key && sortDir === 'desc',
      function(){ setSort(key, 'desc'); }, true));

    menu.appendChild(document.createElement('hr'));
    var labM = document.createElement('div');
    labM.className = 'mlabel'; labM.textContent = 'Column';
    menu.appendChild(labM);
    var thNode = btn.parentNode;
    var idx = Array.prototype.indexOf.call(headRow.children, thNode);
    var last = headRow.children.length - 1;
    if (idx > 0){
      menu.appendChild(mkBtn('&#8592;&nbsp;&nbsp;Move left', false, function(){ moveCol(idx, idx - 1); }, false));
    }
    if (idx < last){
      menu.appendChild(mkBtn('&#8594;&nbsp;&nbsp;Move right', false, function(){ moveCol(idx, idx + 1); }, false));
    }

    if (fkey){
      menu.appendChild(document.createElement('hr'));
      var lab2 = document.createElement('div');
      lab2.className = 'mlabel'; lab2.textContent = 'Filter';
      menu.appendChild(lab2);

      var vals, labels;
      if (fkey === 's'){ vals = ['live','lead','wait','shut']; labels = vals.map(function(v){ return '<span class="dot dot-' + v + '"></span>' + STATUS_LABEL[v]; }); }
      else if (fkey === 'date'){ vals = DATES; labels = DATES; }
      else if (fkey === 'type'){ vals = TYPES; labels = TYPES; }
      else if (fkey === 'cv'){ vals = CVS; labels = CVS.map(function(v){ return window.cvDisplayName ? window.cvDisplayName(v) : v; }); }
      else { vals = VIAS; labels = VIAS; }

      menu.appendChild(mkBtn(fkey === 's' ? 'Any status' : (fkey === 'date' ? 'Any date' : (fkey === 'type' ? 'Any type' : (fkey === 'cv' ? 'Any CV' : 'Any source'))),
        filters[fkey] === '', function(){ filters[fkey] = ''; apply(); }, true));
      vals.forEach(function(v, i){
        menu.appendChild(mkBtn(labels[i], filters[fkey] === v,
          function(){ filters[fkey] = v; apply(); }, true));
      });
    }
  }

  /* The menu is position:fixed, so anything hanging below the fold cannot be
   * scrolled to — the page moves and the menu does not. Give it whichever side
   * of the button has room, and cap it to that room so it scrolls inside
   * itself rather than off the screen. */
  function placeMenu(btn){
    var r = btn.getBoundingClientRect();
    menu.hidden = false;
    menu.style.maxHeight = '';
    menu.style.top = '0px';

    var mw = menu.offsetWidth;
    var left = Math.min(r.left, window.innerWidth - mw - 12);
    menu.style.left = Math.max(8, left) + 'px';

    var GAP = 4, EDGE = 10, MIN = 150;
    var below = window.innerHeight - r.bottom - GAP - EDGE;
    var above = r.top - GAP - EDGE;
    var want = menu.scrollHeight;

    if (want <= below){
      menu.style.top = (r.bottom + GAP) + 'px';
    } else if (want <= above){
      menu.style.top = (r.top - GAP - want) + 'px';
    } else {
      /* Neither side fits it whole. Take the roomier one and scroll inside. */
      var useAbove = above > below;
      var h = Math.max(MIN, useAbove ? above : below);
      menu.style.maxHeight = h + 'px';
      menu.style.top = useAbove ? Math.max(EDGE, r.top - GAP - h) + 'px'
                                : (r.bottom + GAP) + 'px';
    }
  }

  cols.forEach(function(btn){
    btn.setAttribute('aria-haspopup','true');
    btn.setAttribute('aria-expanded','false');
    btn.addEventListener('click', function(e){
      e.stopPropagation();
      if (openFor === btn){ closeMenu(); return; }
      buildMenu(btn);
      placeMenu(btn);
      openFor = btn;
      btn.setAttribute('aria-expanded','true');
    });
  });

  document.addEventListener('click', function(e){
    if (!menu.hidden && !menu.contains(e.target)) closeMenu();
  });
  document.addEventListener('keydown', function(e){
    if (e.key === 'Escape') closeMenu();
  });
  window.addEventListener('resize', closeMenu);
  window.addEventListener('scroll', closeMenu, true);

  /* ---------- sort ---------- */
  function setSort(key, dir){
    sortKey = key; sortDir = dir;
    var num = (key === 'applied' || key === 'updated' || key === 'rank');
    var sorted = rows.slice().sort(function(a, b){
      var av, bv;
      if (num){
        av = parseInt(a.getAttribute('data-' + key), 10);
        bv = parseInt(b.getAttribute('data-' + key), 10);
      } else {
        av = a.getAttribute('data-' + key) || '';
        bv = b.getAttribute('data-' + key) || '';
      }
      if (av < bv) return dir === 'asc' ? -1 : 1;
      if (av > bv) return dir === 'asc' ? 1 : -1;
      return 0;
    });
    var frag = document.createDocumentFragment();
    sorted.forEach(function(r){ frag.appendChild(r); });
    tb.appendChild(frag);
    paintCols();
  }

  function paintCols(){
    cols.forEach(function(b){
      var k = b.getAttribute('data-k');
      var f = b.getAttribute('data-f');
      var on = (k === sortKey);
      b.classList.toggle('active', on);
      b.querySelector('.ind').innerHTML = (on && sortDir === 'asc') ? '&#9650;' : '&#9660;';
      b.classList.toggle('filtered', !!(f && filters[f]));
    });
  }

  /* ---------- filter ---------- */
  /* How long since anything happened on a row. Derived from the dates already
   * on it — nothing extra is stored — and only meaningful for something still
   * open: a lead was never applied to, and a closed one is finished. */
  var STALE_DAYS = 14;

  function daysSince(sortNum){
    var v = String(sortNum || '');
    if (v.length !== 8) return -1;
    var then = Date.UTC(+v.slice(0,4), +v.slice(4,6) - 1, +v.slice(6,8));
    var now = new Date();
    var today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.floor((today - then) / 86400000);
  }

  function markStale(){
    var n = 0;
    rows.forEach(function(tr){
      var cell = tr.querySelector('.c-upd');
      if (!cell) return;
      var base = cell.getAttribute('data-base');
      if (base === null){ base = cell.textContent.trim(); cell.setAttribute('data-base', base); }

      var st = tr.getAttribute('data-s');
      var open = st === 'live' || st === 'wait';
      var last = Number(tr.getAttribute('data-updated')) || Number(tr.getAttribute('data-applied'));
      var age = open ? daysSince(last) : -1;
      var stale = age >= STALE_DAYS;

      tr.setAttribute('data-stale', stale ? '1' : '0');
      cell.textContent = base;
      if (stale){
        n++;
        var tag = document.createElement('span');
        tag.className = 'age';
        tag.textContent = age + 'd';
        tag.title = 'No movement for ' + age + ' days';
        cell.appendChild(tag);
      }
    });

    var btn = document.getElementById('qf-stale');
    var num = document.getElementById('stale-n');
    if (num) num.textContent = String(n);
    if (btn){
      btn.hidden = n === 0;
      /* the filter cannot stay on with nothing left to show */
      if (!n && filters.stale){ filters.stale = false; }
    }
    return n;
  }

  /* ---------- search ----------
   * Every word has to match, anywhere in the row, in any case and ignoring
   * accents. "Quoted words" match as a phrase. A leading minus excludes.
   * company: role: via: type: status: note: narrow a word to one column, so
   * via:wttj finds WTTJ → Workable and -status:closed hides what is finished.
   * The row's own text is the index — nothing extra to keep in sync. */
  var FIELDS = { company:'.c-co', co:'.c-co', role:'.c-role', title:'.c-role',
                 via:'.c-src', source:'.c-src', type:'.c-type',
                 status:'.c-status', note:'.c-role', notes:'.c-role', date:'.c-date' };
  function fold(t){
    return String(t || '').toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[\u2018\u2019]/g, "'").replace(/\u2192/g, ' ').replace(/\s+/g, ' ');
  }
  function parseQuery(q){
    var out = [], re = /(-)?(?:(\w+):)?(?:"([^"]*)"|(\S+))/g, m;
    while ((m = re.exec(String(q || '')))){
      var word = fold(m[3] != null ? m[3] : m[4]).trim();
      var field = m[2] && FIELDS[m[2].toLowerCase()] ? FIELDS[m[2].toLowerCase()] : null;
      /* "foo:" that is not a known field is just a word with a colon in it */
      if (m[2] && !field) word = fold(m[2] + ':' + (m[3] != null ? m[3] : m[4]));
      if (word) out.push({ not: !!m[1], field: field, word: word });
    }
    return out;
  }
  var STATUS_WORDS = {live:'live interview screening', lead:'in progress lead', wait:'awaiting', shut:'closed rejected'};
  function hay(r, sel){
    if (!sel) return fold(r.textContent + ' ' + (STATUS_WORDS[r.getAttribute('data-s')] || ''));
    var cell = r.querySelector(sel);
    var extra = sel === '.c-status' ? ' ' + (STATUS_WORDS[r.getAttribute('data-s')] || '') : '';
    return fold((cell ? cell.textContent : '') + extra);
  }
  function matches(r, terms){
    for (var i = 0; i < terms.length; i++){
      var t = terms[i], hit = hay(r, t.field).indexOf(t.word) > -1;
      if (hit === t.not) return false;
    }
    return true;
  }

  var qIn = document.getElementById('q'), qX = document.getElementById('q-x'), qTimer = null;
  if (qIn){
    qIn.addEventListener('input', function(){
      clearTimeout(qTimer);
      qTimer = setTimeout(function(){ filters.q = qIn.value; apply(); }, 80);
    });
    qIn.addEventListener('keydown', function(e){
      if (e.key === 'Escape'){ qIn.value = ''; filters.q = ''; apply(); qIn.blur(); }
    });
    qX.addEventListener('click', function(){ qIn.value = ''; filters.q = ''; apply(); qIn.focus(); });
    /* "/" jumps to search from anywhere that is not already a text field. */
    document.addEventListener('keydown', function(e){
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      var t = e.target, tag = t && t.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable)) return;
      if (document.querySelector('dialog[open]')) return;
      e.preventDefault(); qIn.focus(); qIn.select();
    });
  }

  function apply(){
    markStale();
    var terms = parseQuery(filters.q);
    if (qX) qX.hidden = !filters.q;
    var n = 0;
    rows.forEach(function(r){
      var ok = (!filters.s    || r.getAttribute('data-s')    === filters.s)
            && (!filters.date || r.getAttribute('data-date') === filters.date)
            && (!filters.via  || r.getAttribute('data-via')  === filters.via)
            && (!filters.type || r.getAttribute('data-type') === filters.type)
            && (!filters.cv   || r.getAttribute('data-cv')   === filters.cv)
            && (!filters.stale || r.getAttribute('data-stale') === '1')
            && (!terms.length || matches(r, terms));
      r.classList.toggle('hide', !ok);
      if (ok) n++;
    });
    counter.textContent = (n === rows.length)
      ? (rows.length + ' shown')
      : (n + ' of ' + rows.length + ' shown');
    emptymsg.hidden = n !== 0;
    emptymsg.textContent = filters.q
      ? 'Nothing matches \u201c' + filters.q.trim() + '\u201d. Try fewer words, or clear the other filters.'
      : 'No applications match these filters.';

    var any = filters.s || filters.date || filters.via || filters.type || filters.cv || filters.stale || filters.q;
    resetBtn.hidden = !any;

    var counts = {live:0, lead:0, wait:0, shut:0};
    rows.forEach(function(r){ counts[r.getAttribute('data-s')]++; });
    stats.forEach(function(b){
      var f = b.getAttribute('data-f');
      var num = b.querySelector('b');
      if (num) num.textContent = (f === 'all') ? rows.length : counts[f];
    });
    renderLive();
    renderStarred();

    qfs.concat(stats).forEach(function(b){
      var f = b.getAttribute('data-f');
      var on = (f === 'stale') ? filters.stale
             : (f === 'all') ? (filters.s === '' && !filters.stale)
             : (filters.s === f);
      b.setAttribute('aria-pressed', String(on));
    });
    paintCols();
  }

  function bindStatus(list){
    list.forEach(function(b){
      b.addEventListener('click', function(){
        var f = b.getAttribute('data-f');
        /* Needs-chasing cuts across the statuses rather than being one of them,
         * so it toggles alongside whichever status filter is already set. */
        if (f === 'stale'){ filters.stale = !filters.stale; apply(); return; }
        filters.s = (f === 'all') ? '' : f;
        apply();
      });
    });
  }
  bindStatus(qfs);
  bindStatus(stats);

  resetBtn.addEventListener('click', function(){
    filters.s = ''; filters.date = ''; filters.via = ''; filters.type = ''; filters.cv = '';
    filters.stale = false; filters.q = '';
    if (qIn) qIn.value = '';
    apply();
  });

  /* ---------- insight carousel ---------- */
  var track = document.getElementById('ins-track');
  var vp = document.getElementById('ins-vp');
  var cards = Array.prototype.slice.call(track.children);
  var pos = document.getElementById('ins-pos');
  var prevBtn = document.getElementById('ins-prev');
  var nextBtn = document.getElementById('ins-next');
  var base = cards.length ? cards[0].offsetLeft : 0;
  var idx = 0;
  var animating = 0;

  function paint(){
    if (!cards.length){ pos.textContent = ''; prevBtn.disabled = nextBtn.disabled = true; return; }
    cards.forEach(function(c, i){ c.classList.toggle('cur', i === idx); });
    pos.textContent = (idx + 1) + ' / ' + cards.length;
    prevBtn.disabled = idx === 0;
    nextBtn.disabled = idx === cards.length - 1;
    vp.classList.toggle('fade-l', track.scrollLeft > 4);
    vp.classList.toggle('fade-r', track.scrollLeft + track.clientWidth < track.scrollWidth - 4);
  }

  function show(i){
    if (!cards.length) return;
    idx = Math.max(0, Math.min(cards.length - 1, i));
    var card = cards[idx];
    var x = card.offsetLeft - base;
    var l = track.scrollLeft, r = l + track.clientWidth;
    var target = l;
    if (x < l) target = x;
    else if (x + card.offsetWidth > r) target = x + card.offsetWidth - track.clientWidth;
    target = Math.max(0, Math.min(track.scrollWidth - track.clientWidth, target));
    animating = Date.now();
    track.scrollTo({left: target, behavior: 'smooth'});
    paint();
  }

  prevBtn.addEventListener('click', function(){ show(idx - 1); });
  nextBtn.addEventListener('click', function(){ show(idx + 1); });

  track.addEventListener('scroll', function(){
    if (Date.now() - animating < 500){ paint(); return; }
    var l = track.scrollLeft, r = l + track.clientWidth;
    for (var i = 0; i < cards.length; i++){
      var x = cards[i].offsetLeft - base;
      if (x >= l - 6 && x + cards[i].offsetWidth <= r + 6){ idx = i; break; }
    }
    paint();
  }, {passive: true});
  window.addEventListener('resize', paint);
  paint();

  if (window.CVUI) window.CVUI.start();

  apply();
  setSort('applied', 'desc');
};

/* An offline build renders at load and boots here. A hosted build boots
 * from gate.js once someone has signed in. */
if (window.__BOOT_NOW) window.TrackerApp();
