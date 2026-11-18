/* 2D Animation Classroom — client helpers (no inline scripts; CSP script-src 'self') */
(function () {
  'use strict';
  var csrf = (document.querySelector('meta[name="csrf-token"]') || {}).content || '';
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  function api(url, body, method) {
    return fetch(url, {
      method: method || 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': csrf },
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) { return r.json().then(function (j) { if (!r.ok || j.ok === false) throw j; return j; }); });
  }
  function getJson(url) {
    return fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } }).then(function (r) { return r.json(); });
  }
  function fmtTime(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
  }
  var STATUS = { present: 'มาเรียน', late: 'มาสาย', absent: 'ขาดเรียน', leave: 'ลา' };

  // ---- โหมดโปรแกรม PC: เตือนเมื่อโปรแกรมไม่ตอบสนอง (เช่น หน้าต่าง Command Prompt ถูกหยุดด้วย QuickEdit) ----
  if (document.body.dataset.desktop === '1') {
    var stall = $('[data-stall]'), stallTimer = null;
    var arm = function () { clearTimeout(stallTimer); stallTimer = setTimeout(function () { if (stall) stall.hidden = false; }, 6000); };
    document.addEventListener('submit', function (e) { if (!e.defaultPrevented) arm(); });
    document.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a[href^="/"]');
      if (a && !a.target && !e.defaultPrevented && !a.hasAttribute('download')) arm();
    });
    window.addEventListener('pagehide', function () { clearTimeout(stallTimer); });
    window.addEventListener('pageshow', function () { clearTimeout(stallTimer); if (stall) stall.hidden = true; });
    // ตรวจทุก 20 วินาทีว่าโปรแกรมยังตอบอยู่
    setInterval(function () {
      var done = false;
      var t = setTimeout(function () { if (!done && stall) stall.hidden = false; }, 5000);
      fetch('/healthz', { cache: 'no-store' }).then(function () { done = true; clearTimeout(t); if (stall) stall.hidden = true; }).catch(function () {});
    }, 20000);
  }

  // ---- confirm ----
  document.addEventListener('submit', function (e) {
    var f = e.target;
    if (f.dataset && f.dataset.confirm && !window.confirm(f.dataset.confirm)) e.preventDefault();
  });

  // ---- QR rotation (live page + projector) ----
  $$('[data-qr-session]').forEach(function (box) {
    var sid = box.dataset.qrSession;
    var img = $('[data-qr-img]', box), code = $('[data-qr-code]', box), bar = $('[data-qr-bar]', box), left = $('[data-qr-left]', box);
    var count = $$('[data-qr-count]'), closedMsg = $('[data-qr-closed]', box), verify = $('[data-qr-verify]', box);
    var expiresAt = 0, ttl = 45, skew = 0, timer = null;
    function refresh() {
      getJson('/teacher/sessions/' + sid + '/qr.json').then(function (j) {
        if (!j.ok) return;
        count.forEach(function (c) { c.textContent = (j.summary.present + j.summary.late) + ' / ' + j.summary.total; });
        if (!j.open) { box.classList.add('closed'); if (closedMsg) closedMsg.hidden = false; if (img) img.hidden = true; return; }
        if (closedMsg) closedMsg.hidden = true;
        if (img) { img.hidden = false; img.src = j.qr; }
        if (code) code.textContent = j.code;
        if (verify) verify.hidden = !j.verify;
        skew = Date.parse(j.serverNow) - Date.now();
        expiresAt = Date.parse(j.expiresAt); ttl = j.ttl;
      }).catch(function () {});
    }
    function tick() {
      if (!expiresAt) return;
      var remain = Math.max(0, (expiresAt - (Date.now() + skew)) / 1000);
      if (bar) bar.style.width = Math.min(100, (remain / ttl) * 100) + '%';
      if (left) left.textContent = Math.ceil(remain) + ' วินาที';
      if (remain <= 1) { expiresAt = 0; setTimeout(refresh, 1200); }
    }
    refresh();
    timer = setInterval(tick, 500);
    setInterval(function () { if (expiresAt) refresh(); }, 8000); // อัปเดตจำนวนผู้เช็คชื่อ
  });

  // ---- Live roster: manual attendance segmented buttons ----
  function applyRow(row, status) {
    row.className = 'roster-row' + (status ? ' status-' + status : '');
    $$('.seg button', row).forEach(function (b) { b.classList.toggle('on', b.dataset.status === status); });
    row.dataset.current = status || '';
  }
  $$('[data-roster]').forEach(function (table) {
    var sid = table.dataset.roster;
    table.addEventListener('click', function (e) {
      var btn = e.target.closest('.seg button');
      if (!btn) return;
      var row = btn.closest('tr');
      var status = btn.dataset.status;
      if (row.dataset.current === status) return;
      var reason = '';
      if (row.dataset.current || table.dataset.closed === '1') {
        reason = window.prompt('ระบุเหตุผลการแก้ไข/บันทึกย้อนหลัง (เช่น โทรศัพท์เสีย, ลาป่วย)');
        if (!reason) return;
      }
      api('/teacher/sessions/' + sid + '/attendance/manual', { student_id: row.dataset.student, status: status, reason: reason })
        .then(function (j) {
          applyRow(row, status);
          var m = $('[data-method]', row); if (m) m.textContent = 'Manual';
          updateSummary(j.summary);
        })
        .catch(function (err) { window.alert((err && err.error) || 'บันทึกไม่สำเร็จ'); });
    });
    function updateSummary(s) {
      if (!s) return;
      Object.keys(s).forEach(function (k) { $$('[data-sum="' + k + '"]').forEach(function (el) { el.textContent = s[k]; }); });
    }
    // poll roster every 6s while attendance is open
    if (table.dataset.state === 'open') {
      setInterval(function () {
        getJson('/teacher/sessions/' + sid + '/roster.json').then(function (j) {
          if (!j.ok) return;
          updateSummary(j.summary);
          j.roster.forEach(function (r) {
            var row = $('tr[data-student="' + r.id + '"]', table);
            if (!row) return;
            if ((row.dataset.current || null) !== r.status) applyRow(row, r.status);
            var t = $('[data-time]', row); if (t) t.textContent = fmtTime(r.time);
            var m = $('[data-method]', row); if (m && r.method) m.textContent = r.method === 'qr' ? 'QR' : r.method === 'code' ? 'รหัส' : 'Manual';
            var v = $('[data-verified]', row); if (v) v.hidden = !r.verified;
            var rk = $('[data-risk]', row); if (rk) { rk.hidden = !r.risks; rk.textContent = '⚑ ' + r.risks; }
            var ipc = $('[data-ip]', row); if (ipc) ipc.textContent = (r.ip || '') + (r.distance !== null && r.distance !== undefined ? ' · ' + r.distance + ' ม.' : '');
          });
        });
      }, 6000);
    }
  });

  // ---- Rubric grading form: live total + level buttons ----
  $$('[data-rubric-form]').forEach(function (form) {
    var max = Number(form.dataset.max);
    var out = $('[data-total]', form);
    function recalc() {
      var inputs = $$('input[data-criterion]', form);
      if (!inputs.length) return;
      var weighted = 0, weights = 0, complete = true;
      inputs.forEach(function (i) {
        var v = i.value === '' ? null : Number(i.value);
        var cmax = Number(i.dataset.max), w = Number(i.dataset.weight);
        i.classList.toggle('invalid', v !== null && (v < 0 || v > cmax));
        if (v === null) complete = false; else weighted += (v / cmax) * w;
        weights += w;
      });
      if (out) out.textContent = complete ? (Math.round(Math.min(max, (weighted / weights) * max) * 100) / 100) : '—';
    }
    form.addEventListener('input', recalc);
    form.addEventListener('click', function (e) {
      var b = e.target.closest('[data-level]');
      if (!b) return;
      e.preventDefault();
      var input = $('#' + b.dataset.target);
      input.value = b.dataset.level;
      $$('[data-target="' + b.dataset.target + '"]', form).forEach(function (x) { x.classList.toggle('on', x === b); });
      recalc();
    });
    recalc();
  });

  // ---- Quick grading grid (autosave per row) ----
  $$('[data-grid]').forEach(function (table) {
    var aid = table.dataset.grid, max = Number(table.dataset.max);
    var timers = {};
    function rowTotal(row) {
      var inputs = $$('input[data-criterion]', row);
      if (!inputs.length) { var d = $('input[data-direct]', row); return d && d.value !== '' ? Number(d.value) : null; }
      var weighted = 0, weights = 0, complete = true;
      inputs.forEach(function (i) {
        var v = i.value === '' ? null : Number(i.value);
        if (v === null) complete = false; else weighted += (v / Number(i.dataset.max)) * Number(i.dataset.weight);
        weights += Number(i.dataset.weight);
      });
      return complete ? Math.round(Math.min(max, (weighted / weights) * max) * 100) / 100 : null;
    }
    function save(row, action) {
      var st = $('.save-state', row);
      var body = { action: action || 'draft', scores: {}, feedback: ($('textarea, input[data-feedback]', row) || {}).value };
      $$('input[data-criterion]', row).forEach(function (i) { body.scores[i.dataset.criterion] = i.value; });
      var d = $('input[data-direct]', row); if (d) body.direct_score = d.value;
      if (row.dataset.status === 'published' && action !== 'publish') {
        var reason = window.prompt('คะแนนนี้เผยแพร่แล้ว ระบุเหตุผลการแก้ไข');
        if (!reason) { st.textContent = 'ยกเลิก'; return Promise.resolve(); }
        body.reason = reason; body.action = 'publish';
      }
      st.className = 'save-state saving'; st.textContent = 'กำลังบันทึก…';
      return api('/teacher/grading/' + aid + '/' + row.dataset.student, body).then(function (j) {
        st.className = 'save-state saved';
        st.textContent = j.grade.status === 'published' ? 'เผยแพร่แล้ว ✓' : 'บันทึก Draft ✓';
        row.dataset.status = j.grade.status;
      }).catch(function (err) { st.className = 'save-state error'; st.textContent = (err && err.errors ? err.errors.join(', ') : 'บันทึกไม่สำเร็จ'); });
    }
    table.addEventListener('input', function (e) {
      var row = e.target.closest('tr[data-student]');
      if (!row) return;
      var t = rowTotal(row);
      $('.total', row).textContent = t === null ? '—' : t;
      if (row.dataset.status === 'published') return; // แก้คะแนนที่เผยแพร่แล้ว ต้องกดบันทึกและระบุเหตุผล
      clearTimeout(timers[row.dataset.student]);
      timers[row.dataset.student] = setTimeout(function () { save(row, 'draft'); }, 700);
    });
    table.addEventListener('click', function (e) {
      var b = e.target.closest('[data-row-action]');
      if (!b) return;
      e.preventDefault();
      save(b.closest('tr[data-student]'), b.dataset.rowAction);
    });
    // Enter → ช่องถัดไปลงด้านล่าง (ให้คะแนนต่อเนื่องเร็ว)
    table.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' || e.target.tagName !== 'INPUT') return;
      e.preventDefault();
      var col = e.target.dataset.col;
      var rows = $$('tr[data-student]', table);
      var idx = rows.indexOf(e.target.closest('tr'));
      var next = rows[idx + 1] && $('input[data-col="' + col + '"]', rows[idx + 1]);
      if (next) next.focus(); else e.target.blur();
    });
  });

  // ---- Submission form: preview files & links before confirm ----
  $$('[data-submit-form]').forEach(function (form) {
    var input = $('input[type=file]', form), list = $('[data-file-list]', form);
    var allowed = (form.dataset.allowed || '').split(',').filter(Boolean), maxMb = Number(form.dataset.maxMb || 200);
    function render() {
      list.innerHTML = '';
      Array.prototype.forEach.call(input.files || [], function (f) {
        var ext = (f.name.split('.').pop() || '').toLowerCase();
        var bad = allowed.length && allowed.indexOf(ext) < 0 ? 'ชนิดไฟล์ไม่อนุญาต' : f.size > maxMb * 1048576 ? 'ไฟล์ใหญ่เกิน ' + maxMb + ' MB' : '';
        var row = document.createElement('div'); row.className = 'file-card';
        var left = document.createElement('div');
        if (/^image\//.test(f.type)) { var im = document.createElement('img'); im.src = URL.createObjectURL(f); im.style.maxHeight = '70px'; im.style.marginRight = '.6rem'; im.style.verticalAlign = 'middle'; left.appendChild(im); }
        else if (/^video\//.test(f.type)) { var v = document.createElement('video'); v.src = URL.createObjectURL(f); v.muted = true; v.style.maxHeight = '70px'; v.style.marginRight = '.6rem'; v.style.verticalAlign = 'middle'; left.appendChild(v); }
        left.appendChild(document.createTextNode(f.name));
        var right = document.createElement('small'); right.textContent = (f.size / 1048576).toFixed(2) + ' MB' + (bad ? ' — ' + bad : '');
        if (bad) right.className = 'err-text';
        row.appendChild(left); row.appendChild(right); list.appendChild(row);
      });
    }
    if (input) input.addEventListener('change', render);
    var add = $('[data-add-link]', form);
    if (add) add.addEventListener('click', function (e) {
      e.preventDefault();
      var tpl = $('[data-link-row]', form); var c = tpl.cloneNode(true);
      $$('input', c).forEach(function (i) { i.value = ''; });
      tpl.parentNode.insertBefore(c, add);
    });
    form.addEventListener('submit', function (e) {
      var n = (input && input.files ? input.files.length : 0);
      var links = $$('input[name=link_url]', form).filter(function (i) { return i.value.trim(); }).length;
      if (!n && !links) { e.preventDefault(); window.alert('กรุณาแนบไฟล์หรือ URL อย่างน้อย 1 รายการ'); return; }
      if (!window.confirm('ยืนยันส่งงาน: ไฟล์ ' + n + ' รายการ, URL ' + links + ' รายการ\nกรุณาตรวจสอบว่าเปิดสิทธิ์การแชร์ลิงก์ให้อาจารย์เปิดดูได้')) { e.preventDefault(); return; }
      var btn = $('button[type=submit]', form); if (btn) { btn.disabled = true; btn.textContent = 'กำลังอัปโหลด…'; }
    });
  });

  // ---- Assignment builder ----
  $$('[data-assignment-form]').forEach(function (form) {
    var addBtn = $('[data-add-criterion]', form), body = $('[data-criteria]', form);
    function sumCrit() {
      var s = 0; $$('input[name=criterion_max]', form).forEach(function (i) { s += Number(i.value) || 0; });
      var out = $('[data-crit-sum]', form); if (out) out.textContent = Math.round(s * 100) / 100;
    }
    if (addBtn) addBtn.addEventListener('click', function (e) {
      e.preventDefault();
      var tpl = $('template[data-criterion-tpl]', form);
      body.appendChild(tpl.content.cloneNode(true));
    });
    form.addEventListener('click', function (e) {
      var rm = e.target.closest('[data-remove-row]');
      if (rm) { e.preventDefault(); rm.closest('[data-row]').remove(); sumCrit(); }
    });
    function cloSum() {
      var s = 0, n = 0;
      $$('input[data-clo-check]', form).forEach(function (c) {
        var w = $('input[name="clo_weight_' + c.dataset.cloCheck + '"]', form);
        if (c.checked) { n++; s += Number(w.value) || 0; }
      });
      var out = $('[data-clo-sum]', form);
      if (out) { out.textContent = Math.round(s * 100) / 100; out.className = Math.abs(s - 1) < 0.011 || !n ? '' : 'err-text'; }
    }
    form.addEventListener('input', function () { sumCrit(); cloSum(); });
    form.addEventListener('change', function (e) {
      if (e.target.matches('select[name=category_id]')) {
        var opt = e.target.selectedOptions[0];
        var hint = $('[data-cat-hint]', form); if (hint && opt) hint.textContent = opt.dataset.hint || '';
      }
      if (e.target.matches('select[name=submission_mode]')) {
        $$('[data-online-only]', form).forEach(function (el) { el.hidden = e.target.value !== 'online'; });
      }
      cloSum();
    });
    var tplSel = $('[data-template-select]');
    if (tplSel) tplSel.addEventListener('change', function () {
      if (!tplSel.value) return;
      var url = new URL(window.location.href); url.searchParams.set('template', tplSel.value); window.location.href = url.toString();
    });
    sumCrit(); cloSum();
    var mode = $('select[name=submission_mode]', form);
    if (mode) $$('[data-online-only]', form).forEach(function (el) { el.hidden = mode.value !== 'online'; });
  });

  // ---- Check-in: device ID + fingerprint + GPS แล้วส่ง ----
  function cyrb53(str) {
    var h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (var i = 0; i < str.length; i++) { var ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
  }
  function localDeviceId() {
    try {
      var id = localStorage.getItem('aj-device-id');
      if (!id) {
        var a = new Uint8Array(16); (window.crypto || window.msCrypto).getRandomValues(a);
        id = Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
        localStorage.setItem('aj-device-id', id);
      }
      return id;
    } catch (e) { return ''; }
  }
  function fingerprint() {
    var n = navigator, s = window.screen || {}, canvasHash = '';
    try {
      var c = document.createElement('canvas'); c.width = 220; c.height = 30; var x = c.getContext('2d');
      x.textBaseline = 'top'; x.font = '16px Arial'; x.fillStyle = '#f60'; x.fillRect(100, 1, 60, 20); x.fillStyle = '#069'; x.fillText('2D Animation ✓ ก', 2, 4);
      canvasHash = cyrb53(c.toDataURL());
    } catch (e) { /* ignore */ }
    var tz = ''; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { /* ignore */ }
    return cyrb53([n.userAgent, n.language, (n.languages || []).join(','), n.platform, n.hardwareConcurrency, n.deviceMemory, n.maxTouchPoints,
      s.width, s.height, s.colorDepth, window.devicePixelRatio, tz, canvasHash].join('|'));
  }
  function prepareCheckin(form, done) {
    var st = $('[data-checkin-status]', form.parentNode) || $('[data-checkin-status]');
    form.elements.fp.value = fingerprint();
    form.elements.lsid.value = localDeviceId();
    if (form.dataset.geo !== '1') return done();
    function fail(msg) {
      if (st) {
        st.className = 'flash error'; st.textContent = msg + ' ';
        var b = document.createElement('button'); b.type = 'button'; b.className = 'btn sm'; b.textContent = 'ลองขอตำแหน่งอีกครั้ง';
        b.addEventListener('click', function () { prepareCheckin(form, done); }); st.appendChild(b);
      }
      var btn = $('button[type=submit]', form); if (btn) btn.disabled = false;
    }
    if (!window.isSecureContext || !navigator.geolocation) return fail('เบราว์เซอร์นี้ขอตำแหน่งไม่ได้ (ต้องเปิดระบบผ่าน HTTPS) — แจ้งผู้สอน');
    if (st) { st.className = 'hint'; st.textContent = '📍 กำลังขอตำแหน่ง GPS…'; }
    navigator.geolocation.getCurrentPosition(function (pos) {
      form.elements.lat.value = pos.coords.latitude; form.elements.lng.value = pos.coords.longitude; form.elements.acc.value = Math.round(pos.coords.accuracy);
      if (st) st.textContent = 'ได้ตำแหน่งแล้ว (±' + Math.round(pos.coords.accuracy) + ' ม.) กำลังเช็คชื่อ…';
      done();
    }, function (err) {
      fail(err.code === 1 ? 'คุณไม่อนุญาตให้เข้าถึงตำแหน่ง — เปิดสิทธิ์ Location ของเบราว์เซอร์แล้วลองใหม่' : 'ขอตำแหน่งไม่สำเร็จ กรุณาเปิด GPS แล้วลองใหม่');
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  }
  $$('form[data-checkin]').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      if (form.dataset.ready === '1') return;
      e.preventDefault();
      var btn = $('button[type=submit]', form); if (btn) btn.disabled = true;
      prepareCheckin(form, function () { form.dataset.ready = '1'; form.submit(); });
    });
    if (form.hasAttribute('data-autosubmit')) {
      setTimeout(function () { prepareCheckin(form, function () { form.dataset.ready = '1'; form.submit(); }); }, 150);
    }
  });

  // ---- จำรหัสนักศึกษาไว้บนเครื่องนี้ (กรอกครั้งเดียว) ----
  $$('input[data-remember-code]').forEach(function (inp) {
    try { var saved = localStorage.getItem('aj-student-code'); if (saved && !inp.value) inp.value = saved; } catch (e) { /* ignore */ }
    inp.form.addEventListener('submit', function () { try { localStorage.setItem('aj-student-code', inp.value.trim()); } catch (e) { /* ignore */ } });
  });

  // ---- ผู้สอน: ตั้งตำแหน่งห้องเรียนจาก GPS ของเครื่องนี้ ----
  $$('[data-set-geo]').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      var out = $('[data-geo-status]');
      if (!window.isSecureContext || !navigator.geolocation) { if (out) out.textContent = 'ต้องเปิดผ่าน HTTPS จึงจะใช้ GPS ได้'; return; }
      if (out) out.textContent = 'กำลังขอตำแหน่ง…';
      navigator.geolocation.getCurrentPosition(function (pos) {
        var c = pos.coords;
        if (btn.dataset.setGeo === 'fields') {
          var f = btn.closest('form'); f.elements.geo_lat.value = c.latitude.toFixed(6); f.elements.geo_lng.value = c.longitude.toFixed(6);
          if (out) out.textContent = 'ใส่พิกัดแล้ว (±' + Math.round(c.accuracy) + ' ม.) กดบันทึก';
          return;
        }
        api(btn.dataset.setGeo, { lat: c.latitude, lng: c.longitude, accuracy: c.accuracy, as_default: btn.dataset.default === '1' })
          .then(function () { window.location.reload(); })
          .catch(function (err) { if (out) out.textContent = (err && err.error) || 'บันทึกไม่สำเร็จ'; });
      }, function () { if (out) out.textContent = 'ขอตำแหน่งไม่สำเร็จ — อนุญาต Location ให้เบราว์เซอร์'; }, { enableHighAccuracy: true, timeout: 15000 });
    });
  });

  // ---- link status select auto-submit ----
  $$('select[data-autosave]').forEach(function (s) { s.addEventListener('change', function () { s.form.submit(); }); });
  // ---- mail preset ----
  $$('select[data-mail-preset]').forEach(function (sel) {
    sel.addEventListener('change', function () {
      var o = sel.selectedOptions[0]; if (!o || !o.dataset.host) return;
      sel.form.elements.imap_host.value = o.dataset.host; sel.form.elements.imap_port.value = o.dataset.port; sel.form.elements.imap_secure.checked = true;
    });
  });
  // ---- print button ----
  $$('[data-print]').forEach(function (b) { b.addEventListener('click', function () { window.print(); }); });
})();
