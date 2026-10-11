// Static page: reads docs/data/<plugin>/{history,meta}.json and draws everything client-side.
// No dependencies, no network calls except to files in this site.
(function () {
  'use strict';

  var DAY = 864e5;
  var $ = function (s) { return document.querySelector(s); };
  var NS = 'http://www.w3.org/2000/svg';

  // ---------- helpers ----------
  var parseD = function (s) { return Date.parse(s + 'T00:00:00Z'); };
  var iso = function (ms) { return new Date(ms).toISOString().slice(0, 10); };
  var addDays = function (s, n) { return iso(parseD(s) + n * DAY); };
  var fmtN = function (n) { return Number(n).toLocaleString('en'); };
  var fmtDay = function (s) { return new Date(parseD(s)).toLocaleDateString('en', { month: 'short', day: 'numeric', timeZone: 'UTC' }); };
  var fmtMonth = function (m) { return new Date(parseD(m + '-01')).toLocaleDateString('en', { month: 'short', year: 'numeric', timeZone: 'UTC' }); };
  var pct = function (x) { return (x * 100).toFixed(x < 0.1 && x > 0 ? 1 : 0) + '%'; };
  var sum = function (a) { return a.reduce(function (s, x) { return s + x; }, 0); };

  function cmpVersion(a, b) {
    var pa = a.split(/[.-]/), pb = b.split(/[.-]/), n = Math.max(pa.length, pb.length);
    for (var i = 0; i < n; i++) {
      var x = pa[i] || '0', y = pb[i] || '0', nx = Number(x), ny = Number(y);
      if (isFinite(nx) && isFinite(ny)) { if (nx !== ny) return nx - ny; }
      else if (x !== y) return x < y ? -1 : 1;
    }
    return 0;
  }

  function el(tag, attrs, text) {
    var e = document.createElement(tag);
    if (attrs) for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    return e;
  }
  function svg(tag, attrs, text) {
    var e = document.createElementNS(NS, tag);
    if (attrs) for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    return e;
  }
  function getJSON(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error(url + ' ' + r.status);
      return r.json();
    });
  }

  // ---------- tooltip ----------
  var tip = $('#tip');
  function showTip(ev, title, lines) {
    tip.textContent = '';
    if (title) tip.appendChild(el('div', { 'class': 't' }, title));
    lines.forEach(function (l) {
      var d = el('div');
      if (l.color) { var i = el('i'); i.style.background = l.color; d.appendChild(i); }
      d.appendChild(document.createTextNode(l.text));
      tip.appendChild(d);
    });
    tip.style.opacity = 1;
    var w = tip.offsetWidth, h = tip.offsetHeight;
    var x = ev.clientX + 14, y = ev.clientY - h - 10;
    if (x + w > window.innerWidth - 8) x = ev.clientX - w - 14;
    if (y < 8) y = ev.clientY + 14;
    tip.style.left = Math.max(8, x) + 'px';
    tip.style.top = y + 'px';
  }
  function hideTip() { tip.style.opacity = 0; }

  // ---------- data model ----------
  function computeDaily(snaps) {
    var out = [];
    for (var i = 1; i < snaps.length; i++) {
      var p = snaps[i - 1], s = snaps[i], byVer = {};
      var keys = Object.keys(p.versions).concat(Object.keys(s.versions));
      keys.forEach(function (v) {
        var d = (s.versions[v] || 0) - (p.versions[v] || 0);
        if (d) byVer[v] = d;
      });
      out.push({ day: addDays(s.date, -1), n: s.total - p.total, byVer: byVer, gap: parseD(s.date) - parseD(p.date) > DAY });
    }
    return out;
  }

  function monthly(daily) {
    var m = {};
    daily.forEach(function (d) { var k = d.day.slice(0, 7); m[k] = (m[k] || 0) + d.n; });
    return Object.keys(m).sort().map(function (k) { return { month: k, n: m[k] }; });
  }

  function weekStart(day) { // Monday of the week containing `day`
    var t = parseD(day), dow = (new Date(t).getUTCDay() + 6) % 7;
    return iso(t - dow * DAY);
  }

  // ---------- chart primitives ----------
  // Returns {max, step}: step is 1/2/5 x 10^k, max is a multiple of step, at most ~5 gridlines.
  function niceScale(v) {
    var raw = Math.max(v, 1) / 4, p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
    var m = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
    var step = Math.max(1, m * p);
    return { max: step * Math.max(2, Math.ceil(v / step)), step: step };
  }

  function frame(host, H, m, maxVal) {
    host.textContent = '';
    var W = Math.max(host.clientWidth, 260);
    var s = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img' });
    host.appendChild(s);
    var sc = niceScale(maxVal), nice = sc.max;
    var y = function (v) { return H - m.b - (v / nice) * (H - m.t - m.b); };
    for (var v = 0; v <= nice + 1e-9; v += sc.step) (function (v) {
      s.appendChild(svg('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), 'class': v === 0 ? 'axis' : 'gridl' }));
      s.appendChild(svg('text', { x: m.l - 6, y: y(v) + 4, 'text-anchor': 'end' }, fmtN(v)));
    })(v);
    return { s: s, W: W, H: H, m: m, y: y, nice: nice };
  }

  function xLabels(f, n, xAt, labelFn) {
    var inner = f.W - f.m.l - f.m.r, maxLabels = Math.max(2, Math.floor(inner / 56));
    var every = Math.ceil(n / maxLabels);
    for (var i = 0; i < n; i++) {
      if ((n - 1 - i) % every !== 0) continue; // anchor labels to the newest bar
      f.s.appendChild(svg('text', { x: xAt(i), y: f.H - f.m.b + 16, 'text-anchor': 'middle' }, labelFn(i)));
    }
  }

  // items: [{label, value, color, title, lines}]
  function barChart(host, items, o) {
    o = o || {};
    if (!items.length) { host.textContent = ''; host.appendChild(el('div', { 'class': 'empty' }, 'No data yet')); return; }
    var maxVal = Math.max.apply(null, items.map(function (d) { return d.value; }).concat(o.line || [0]));
    var f = frame(host, o.height || 220, { t: 16, r: 8, b: 28, l: 34 }, maxVal);
    var n = items.length, slot = (f.W - f.m.l - f.m.r) / n, bw = Math.min(40, Math.max(2, slot * 0.72));
    var xAt = function (i) { return f.m.l + (i + 0.5) * slot; };
    items.forEach(function (d, i) {
      var top = f.y(d.value), h = Math.max(0, f.H - f.m.b - top);
      if (d.value > 0) f.s.appendChild(svg('rect', { 'class': 'bar', x: xAt(i) - bw / 2, y: top, width: bw, height: h, rx: Math.min(3, bw / 2), fill: d.color || 'var(--c1)' }));
      if (o.valueLabels !== false && slot >= 22 && d.value > 0)
        f.s.appendChild(svg('text', { 'class': 'val', x: xAt(i), y: top - 4, 'text-anchor': 'middle' }, fmtN(d.value)));
      var hit = svg('rect', { x: xAt(i) - slot / 2, y: 0, width: slot, height: f.H - f.m.b, fill: 'transparent' });
      hit.addEventListener('mousemove', function (ev) { showTip(ev, d.title, d.lines); });
      hit.addEventListener('mouseleave', hideTip);
      f.s.appendChild(hit);
    });
    if (o.line) {
      var pts = o.line.map(function (v, i) { return (i ? 'L' : 'M') + xAt(i).toFixed(1) + ',' + f.y(v).toFixed(1); }).join('');
      f.s.insertBefore(svg('path', { d: pts, fill: 'none', stroke: 'var(--fg)', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity: .75 }), f.s.querySelector('rect[fill=transparent]'));
    }
    xLabels(f, n, xAt, function (i) { return items[i].label; });
  }

  // items: [{label, segs:[{key,value,color}], title}]
  function stackedChart(host, items) {
    if (!items.length) { host.textContent = ''; host.appendChild(el('div', { 'class': 'empty' }, 'No data yet')); return; }
    var maxVal = Math.max.apply(null, items.map(function (d) { return sum(d.segs.map(function (s) { return s.value; })); }));
    var f = frame(host, 220, { t: 16, r: 8, b: 28, l: 34 }, maxVal);
    var n = items.length, slot = (f.W - f.m.l - f.m.r) / n, bw = Math.min(48, Math.max(3, slot * 0.72));
    var xAt = function (i) { return f.m.l + (i + 0.5) * slot; };
    items.forEach(function (d, i) {
      var acc = 0;
      d.segs.forEach(function (sg) {
        if (sg.value <= 0) return;
        var y1 = f.y(acc + sg.value), y0 = f.y(acc);
        f.s.appendChild(svg('rect', { 'class': 'bar', x: xAt(i) - bw / 2, y: y1, width: bw, height: Math.max(0, y0 - y1), fill: sg.color, stroke: 'var(--panel)', 'stroke-width': 1 }));
        acc += sg.value;
      });
      var hit = svg('rect', { x: xAt(i) - slot / 2, y: 0, width: slot, height: f.H - f.m.b, fill: 'transparent' });
      hit.addEventListener('mousemove', function (ev) {
        showTip(ev, d.title, d.segs.filter(function (s) { return s.value > 0; }).map(function (s) { return { color: s.color, text: s.key + ': ' + fmtN(s.value) }; })
          .concat([{ text: 'Total: ' + fmtN(sum(d.segs.map(function (s) { return s.value; }))) }]));
      });
      hit.addEventListener('mouseleave', hideTip);
      f.s.appendChild(hit);
    });
    xLabels(f, n, xAt, function (i) { return items[i].label; });
  }

  // points: [{t (ms), v}], marks: [{t, label}]
  function lineChart(host, pts, marks) {
    if (pts.length < 2) { host.textContent = ''; host.appendChild(el('div', { 'class': 'empty' }, 'Needs at least two snapshots')); return; }
    var maxVal = Math.max.apply(null, pts.map(function (p) { return p.v; }));
    var f = frame(host, 240, { t: 26, r: 14, b: 28, l: 34 }, maxVal);
    var t0 = pts[0].t, t1 = pts[pts.length - 1].t;
    var x = function (t) { return f.m.l + ((t - t0) / (t1 - t0 || 1)) * (f.W - f.m.l - f.m.r); };
    // x axis: up to ~6 date ticks
    var ticks = Math.max(2, Math.min(6, Math.floor((f.W - f.m.l - f.m.r) / 90)));
    for (var i = 0; i < ticks; i++) {
      var t = t0 + (i / (ticks - 1)) * (t1 - t0);
      f.s.appendChild(svg('text', { x: x(t), y: f.H - f.m.b + 16, 'text-anchor': i === 0 ? 'start' : i === ticks - 1 ? 'end' : 'middle' }, fmtDay(iso(t))));
    }
    var lastLabelX = -1e9, row = 0;
    marks.forEach(function (mk) {
      if (mk.t < t0 || mk.t > t1) return;
      var mx = x(mk.t);
      f.s.appendChild(svg('line', { x1: mx, x2: mx, y1: f.m.t, y2: f.H - f.m.b, stroke: 'var(--muted)', 'stroke-dasharray': '3 3', opacity: .7 }));
      row = (mx - lastLabelX < 34) ? (row + 1) % 2 : 0;
      lastLabelX = mx;
      f.s.appendChild(svg('text', { x: mx, y: 10 + row * 10, 'text-anchor': 'middle' }, mk.label));
    });
    var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + x(p.t).toFixed(1) + ',' + f.y(p.v).toFixed(1); }).join('');
    var area = d + 'L' + x(t1).toFixed(1) + ',' + f.y(0) + 'L' + x(t0).toFixed(1) + ',' + f.y(0) + 'Z';
    f.s.appendChild(svg('path', { d: area, fill: 'var(--c1)', opacity: .12 }));
    f.s.appendChild(svg('path', { d: d, fill: 'none', stroke: 'var(--c1)', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    var dot = svg('circle', { r: 4, fill: 'var(--c1)', stroke: 'var(--panel)', 'stroke-width': 2, opacity: 0 });
    f.s.appendChild(dot);
    var hit = svg('rect', { x: f.m.l, y: 0, width: f.W - f.m.l - f.m.r, height: f.H - f.m.b, fill: 'transparent' });
    hit.addEventListener('mousemove', function (ev) {
      var b = f.s.getBoundingClientRect(), px = (ev.clientX - b.left) * (f.W / b.width);
      var best = pts[0];
      pts.forEach(function (p) { if (Math.abs(x(p.t) - px) < Math.abs(x(best.t) - px)) best = p; });
      dot.setAttribute('cx', x(best.t)); dot.setAttribute('cy', f.y(best.v)); dot.setAttribute('opacity', 1);
      showTip(ev, fmtDay(iso(best.t)), [{ text: fmtN(best.v) + ' installs in total' }]);
    });
    hit.addEventListener('mouseleave', function () { dot.setAttribute('opacity', 0); hideTip(); });
    f.s.appendChild(hit);
  }

  // ---------- page ----------
  var state = null;

  function colorOf(v) { return state.colors[v] || 'var(--c1)'; }

  function render() {
    var st = state, snaps = st.history.snapshots;
    if (!snaps.length) { $('#title').textContent = st.name; $('#take').textContent = 'No snapshots yet.'; return; }
    var last = snaps[snaps.length - 1];
    var daily = computeDaily(snaps);
    var latestDay = daily.length ? daily[daily.length - 1].day : addDays(last.date, -1);
    var versions = Object.keys(last.versions).sort(cmpVersion);
    var latestV = versions[versions.length - 1];
    var months = monthly(daily);

    // header
    document.title = st.name + ' install stats';
    $('#title').textContent = st.name + ' installs';
    var tk = $('#take'); tk.textContent = '';
    tk.appendChild(el('b', null, fmtN(last.total))); tk.appendChild(document.createTextNode(' installs to date'));
    if (latestV) {
      tk.appendChild(document.createTextNode('. The latest version, ' + latestV + ', accounts for '));
      tk.appendChild(el('b', null, pct(last.total ? (last.versions[latestV] || 0) / last.total : 0)));
      tk.appendChild(document.createTextNode(' of them.'));
    }
    if (st.meta && st.meta.repo) { var a = $('#repo-link'); a.href = 'https://github.com/' + st.meta.repo; a.hidden = false; }

    // freshness
    var age = Math.floor((Date.now() - parseD(last.date)) / DAY);
    var fr = $('#fresh');
    fr.className = 'badge ' + (age <= 1 ? 'ok' : age <= 3 ? 'warn' : 'bad');
    fr.textContent = age <= 0 ? 'Updated today' : age === 1 ? 'Updated yesterday' : 'Last update ' + age + ' days ago';
    fr.title = 'Latest snapshot: ' + last.date + ' (UTC)';

    // KPIs
    var l7 = sum(daily.slice(-7).map(function (d) { return d.n; }));
    var p7 = sum(daily.slice(-14, -7).map(function (d) { return d.n; }));
    var l30 = sum(daily.slice(-30).map(function (d) { return d.n; }));
    var firstDay = null; daily.forEach(function (d) { if (firstDay === null && d.n > 0) firstDay = d.day; });
    var activeDays = firstDay ? Math.round((parseD(latestDay) - parseD(firstDay)) / DAY) + 1 : 0;
    var curMonth = latestDay.slice(0, 7), mtd = 0, prevM = 0;
    months.forEach(function (m) { if (m.month === curMonth) mtd = m.n; });
    var pm = iso(parseD(curMonth + '-01') - DAY).slice(0, 7);
    months.forEach(function (m) { if (m.month === pm) prevM = m.n; });

    var kpis = [
      { lab: 'Total installs', val: fmtN(last.total), note: 'All versions' },
      { lab: 'Last 7 days', val: fmtN(l7), delta: daily.length >= 14 ? l7 - p7 : null, note: daily.length >= 14 ? 'vs previous 7 days' : '' },
      { lab: 'Last 30 days', val: fmtN(l30), note: daily.length < 30 ? 'Since first snapshot' : '' },
      { lab: fmtMonth(curMonth) + ' so far', val: fmtN(mtd), note: prevM ? 'Last month: ' + fmtN(prevM) : '' },
      { lab: 'Average per day', val: activeDays ? (last.total / activeDays).toFixed(1) : 'n/a', note: activeDays ? 'Over ' + activeDays + ' days' : '' }
    ];
    if (st.meta && st.meta.stars != null) kpis.push({ lab: 'GitHub stars', val: fmtN(st.meta.stars), note: st.meta.forks != null ? fmtN(st.meta.forks) + ' forks' : '' });
    var kh = $('#kpis'); kh.textContent = '';
    kpis.forEach(function (k) {
      var d = el('div', { 'class': 'kpi' });
      d.appendChild(el('div', { 'class': 'lab' }, k.lab));
      d.appendChild(el('div', { 'class': 'val' }, k.val));
      var note = el('div', { 'class': 'note' });
      if (k.delta != null) {
        note.appendChild(el('span', { 'class': k.delta >= 0 ? 'up' : 'down' }, (k.delta >= 0 ? '+' : '−') + fmtN(Math.abs(k.delta)) + ' '));
      }
      note.appendChild(document.createTextNode(k.note || ' '));
      d.appendChild(note);
      kh.appendChild(d);
    });

    // monthly
    barChart($('#c-month'), months.map(function (m, i) {
      var partial = m.month === curMonth && addDays(latestDay, 1).slice(0, 7) === curMonth;
      return {
        label: fmtMonth(m.month).replace(' 20', " '"), value: m.n,
        color: partial ? 'var(--bar-muted)' : 'var(--c1)',
        title: fmtMonth(m.month) + (partial ? ' (partial)' : ''), lines: [{ text: fmtN(m.n) + ' installs' }]
      };
    }));

    // daily + 7d average
    var d60 = daily.slice(-60);
    var avg = d60.map(function (d, i) {
      var from = Math.max(0, i - 6), win = d60.slice(from, i + 1);
      return sum(win.map(function (x) { return x.n; })) / win.length;
    });
    barChart($('#c-day'), d60.map(function (d, i) {
      return { label: fmtDay(d.day), value: d.n, color: 'var(--c1)', title: fmtDay(d.day), lines: [{ text: fmtN(d.n) + ' installs' }, { text: '7-day average: ' + avg[i].toFixed(1) }] };
    }), { line: avg, valueLabels: false });

    // cumulative with release markers
    var pts = snaps.map(function (s) { return { t: parseD(addDays(s.date, -1)), v: s.total }; });
    var rels = (st.meta && st.meta.releases) || [];
    var byDay = {};
    rels.filter(function (r) { return !r.prerelease; }).forEach(function (r) { var d = r.publishedAt.slice(0, 10); (byDay[d] = byDay[d] || []).push(r.tag); });
    var marks = Object.keys(byDay).sort().map(function (d) { var t = byDay[d].sort(cmpVersion); return { t: parseD(d), label: t.length > 1 ? t[0] + '–' + t[t.length - 1].split('.').pop() : t[0] }; });
    lineChart($('#c-cum'), pts, marks);

    // weekly stacked by version
    var weeks = {};
    daily.forEach(function (d) {
      var w = weekStart(d.day); weeks[w] = weeks[w] || {};
      Object.keys(d.byVer).forEach(function (v) { weeks[w][v] = (weeks[w][v] || 0) + d.byVer[v]; });
    });
    var weekKeys = Object.keys(weeks).sort().slice(-16);
    stackedChart($('#c-week'), weekKeys.map(function (w) {
      return { label: fmtDay(w), title: 'Week of ' + fmtDay(w), segs: versions.map(function (v) { return { key: v, value: weeks[w][v] || 0, color: colorOf(v) }; }) };
    }));
    var lg = $('#legend'); lg.textContent = '';
    versions.forEach(function (v) { var s = el('span'); var i = el('i'); i.style.background = colorOf(v); s.appendChild(i); s.appendChild(document.createTextNode(v)); lg.appendChild(s); });

    // where new installs land (last 7 days)
    var land = {}; daily.slice(-7).forEach(function (d) { Object.keys(d.byVer).forEach(function (v) { land[v] = (land[v] || 0) + d.byVer[v]; }); });
    var lh = $('#land'); lh.textContent = '';
    var landKeys = Object.keys(land).filter(function (v) { return land[v] > 0; }).sort(cmpVersion).reverse();
    if (!landKeys.length) lh.appendChild(el('div', { 'class': 'empty' }, 'No installs in the last 7 days'));
    var landMax = Math.max.apply(null, landKeys.map(function (v) { return land[v]; }).concat([1]));
    landKeys.forEach(function (v) {
      var r = el('div', { 'class': 'landrow' });
      r.appendChild(el('span', null, v));
      var tr = el('span', { 'class': 'track' }), fl = el('span', { 'class': 'fill' });
      fl.style.width = (100 * land[v] / landMax) + '%'; fl.style.background = colorOf(v);
      tr.appendChild(fl); r.appendChild(tr); r.appendChild(el('span', { 'class': 'n' }, fmtN(land[v])));
      lh.appendChild(r);
    });
    if (landKeys.length > 1) {
      lh.appendChild(el('p', { 'class': 'sub', style: 'margin-top:10px' }, 'Installs on an older version usually mean users on an older Obsidian, because Obsidian serves the newest version their app can run (see minAppVersion).'));
    }

    // health checks
    var checks = [];
    checks.push({ s: age <= 1 ? 'ok' : age <= 3 ? 'warn' : 'bad', t: 'Data freshness', d: 'Latest snapshot ' + last.date + ' (' + (age <= 0 ? 'today' : age + ' day' + (age === 1 ? '' : 's') + ' ago') + ').' });
    var anomalies = snaps.filter(function (s) { return s.anomaly; });
    checks.push({ s: anomalies.length ? 'warn' : 'ok', t: 'Counter sanity', d: anomalies.length ? anomalies.length + ' snapshot(s) where the total went down: ' + anomalies.map(function (s) { return s.date; }).join(', ') : 'Totals only ever go up, as expected.' });
    var idle = 0; for (var i = daily.length - 1; i >= 0 && daily[i].n === 0; i--) idle++;
    checks.push({ s: idle >= 7 ? 'warn' : 'ok', t: 'Quiet days', d: idle ? idle + ' day' + (idle === 1 ? '' : 's') + ' in a row without a new install.' : 'Installs came in on the latest day.' });
    var gaps = daily.filter(function (d) { return d.gap; }).length;
    checks.push({ s: gaps ? 'warn' : 'ok', t: 'Snapshot gaps', d: gaps ? gaps + ' missed day(s); those installs are credited to a single day.' : 'No missed daily snapshots.' });
    if (daily.length >= 14 && p7 > 0 && l7 < p7 * 0.5) checks.push({ s: 'warn', t: 'Slowdown', d: 'Last 7 days are less than half of the previous 7 (' + l7 + ' vs ' + p7 + ').' });
    if (st.meta && st.meta.openIssues) checks.push({ s: 'warn', t: 'Open issues', d: st.meta.openIssues + ' open on GitHub.' });
    var ch = $('#checks'); ch.textContent = '';
    checks.forEach(function (c) {
      var li = el('li', { 'class': c.s }); li.appendChild(el('span', { 'class': 'dot' }));
      var b = el('div'); b.appendChild(document.createTextNode(c.t)); b.appendChild(el('small', null, c.d));
      li.appendChild(b); ch.appendChild(li);
    });

    // releases table
    var tb = $('#rel tbody'); tb.textContent = '';
    var rows = {};
    rels.forEach(function (r) { rows[r.tag] = { tag: r.tag, at: r.publishedAt, pre: r.prerelease, gh: r.mainJsDownloads }; });
    versions.forEach(function (v) { rows[v] = rows[v] || { tag: v, at: null, pre: false, gh: null }; rows[v].installs = last.versions[v] || 0; });
    Object.keys(rows).map(function (k) { return rows[k]; })
      .sort(function (a, b) { return a.at && b.at ? (a.at < b.at ? 1 : -1) : cmpVersion(b.tag, a.tag); })
      .forEach(function (r) {
        var tr = el('tr'); if (r.pre) tr.className = 'pre';
        tr.appendChild(el('td', { 'class': r.pre ? 'pre' : '' }, r.tag));
        tr.appendChild(el('td', { 'class': r.pre ? 'pre' : '' }, r.at ? fmtDay(r.at.slice(0, 10)) + ", " + r.at.slice(0, 4) : 'n/a'));
        var td = el('td'); td.appendChild(el('span', { 'class': 'tag' }, r.pre ? 'pre-release' : 'stable')); tr.appendChild(td);
        tr.appendChild(el('td', { 'class': 'n' }, r.installs != null ? fmtN(r.installs) : 'n/a'));
        tr.appendChild(el('td', { 'class': 'n' }, r.installs != null && last.total ? pct(r.installs / last.total) : 'n/a'));
        var f7 = 'n/a';
        if (r.installs != null && r.at) {
          var cutoff = addDays(r.at.slice(0, 10), 7);
          if (latestDay >= cutoff) {
            var snap = null; snaps.forEach(function (s) { if (addDays(s.date, -1) <= cutoff) snap = s; });
            if (snap) f7 = fmtN(snap.versions[r.tag] || 0);
          }
        }
        tr.appendChild(el('td', { 'class': 'n' }, f7));
        tr.appendChild(el('td', { 'class': 'n' }, r.gh != null ? fmtN(r.gh) : 'n/a'));
        tb.appendChild(tr);
      });

    // downloads
    $('#dl-csv').href = 'data/' + st.id + '/history.csv';
    $('#dl-json').href = 'data/' + st.id + '/history.json';
  }

  function load(id, index) {
    var entry = index.plugins.filter(function (p) { return p.id === id; })[0] || index.plugins[0];
    return Promise.all([
      getJSON('data/' + entry.id + '/history.json'),
      getJSON('data/' + entry.id + '/meta.json').catch(function () { return null; })
    ]).then(function (r) {
      var all = {}; r[0].snapshots.forEach(function (s) { Object.keys(s.versions).forEach(function (v) { all[v] = 1; }); });
      var colors = {}; Object.keys(all).sort(cmpVersion).forEach(function (v, i) { colors[v] = 'var(--c' + ((i % 8) + 1) + ')'; });
      state = { id: entry.id, name: entry.name || entry.id, history: r[0], meta: r[1], colors: colors };
      render();
    });
  }

  getJSON('data/index.json').then(function (index) {
    if (!index.plugins.length) throw new Error('No plugins configured');
    var want = new URLSearchParams(location.search).get('plugin') || index.plugins[0].id;
    if (index.plugins.length > 1) {
      var sel = $('#pick'); $('#pick-wrap').hidden = false;
      index.plugins.forEach(function (p) { var o = el('option', { value: p.id }, p.name || p.id); if (p.id === want) o.selected = true; sel.appendChild(o); });
      sel.addEventListener('change', function () {
        history.replaceState(null, '', '?plugin=' + encodeURIComponent(sel.value));
        load(sel.value, index);
      });
    }
    return load(want, index);
  }).catch(function (e) {
    $('#title').textContent = 'Could not load stats';
    $('#take').textContent = String(e && e.message || e);
  });

  var rt; window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(function () { if (state) render(); }, 120); });
})();
