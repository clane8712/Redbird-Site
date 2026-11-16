/* Redbird retailer reservation portal (redbird-cannabis.com/reserve/)
 *
 * Signed out: a preview (next week's strains, a peek at the week after, then dates only)
 *             from Chris's Portal web app. No other inventory data is sent to the page.
 * Signed in:  every upcoming week; reserve by the case or type any number.
 * Reservations go to Josh's CRM script exactly like the old portal (writeReservation /
 * updateReservation / cancelReservation), so the Reservations tab and emails don't change.
 */
(function () {
  'use strict';

  var CFG = Object.assign({
    PORTAL_API: 'https://script.google.com/macros/s/AKfycbxleeQ3JUPYfYr1VZl_Ac_ata1Qt8sjY_I9SsanvVf2Zy07jn_daHUQbet3PPL_bGVJaw/exec'   // Chris's Portal.gs: everything goes through here
  }, window.RB_PORTAL_CFG || {});

  // Prices from the current portal; steps are Scott's case sizes (Nov 13).
  var SIZES = [
    { k: '35',  sec: 'flower', col: '3.5g', lab: '3.5g',      sku: '3.5g Flower', price: 10,    step: 10 },
    { k: '7',   sec: 'flower', col: '7g',   lab: '7g',        sku: '7g Flower',   price: 16.66, step: 5 },
    { k: 'pm',  sec: 'flower', col: '14g',  lab: 'Micro 14g', sku: '14g Micros',  price: 33.33, step: 5 },
    { k: '28',  sec: 'flower', col: '28g',  lab: '28g',       sku: '28g Flower',  price: 60,    step: 1 },
    { k: 'j1',  sec: 'pre',    col: '1g',   lab: '1g single', sku: '1g Singles',  price: 2,     step: 25 },
    { k: 'j2',  sec: 'pre',    col: '2pk',  lab: '2pk',       sku: '2pk Joints',  price: 2.5,   step: 25 },
    { k: 'j10', sec: 'pre',    col: '10pk', lab: '10pk',      sku: '10pk Joints', price: 10,    step: 10 }
  ];
  var SIZE = {}; SIZES.forEach(function (z) { SIZE[z.k] = z; });
  var CHIPS = [['Flower', ['35', '7', '28']], ['Micro Buds', ['pm']], ['Pre-rolls', ['j1', 'j2', 'j10']]];
  var SEC_NAME = { flower: 'Flower', pre: 'Pre-rolls' };
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var LOCK_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9A9AA2" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';

  var root = document.getElementById('rbp');
  var S = {
    mode: 'loading',      // loading | out | in
    gate: 'signin',       // signin | request | sent   (signed out card)
    screen: 'browse',     // browse | review | done | cancelled
    teaser: null, weeks: [], err: '',
    who: { name: '', email: '', account: '' }, accounts: [], internal: false,
    cart: {}, carts: {}, open: {}, sizes: {}, q: '', month: '',
    submitted: null, editing: false, extra: [], notes: '', busy: false, menu: false, formStart: 0, mine: [], sentLink: {}, collapsed: {}
  };

  // ───────── helpers ─────────
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function money(n) { var r = Math.round(n * 100) / 100; return '$' + (r % 1 ? r.toFixed(2) : String(r)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function phone() { return window.matchMedia('(max-width: 720px)').matches; }
  function ymd(d) { var p = d.split('-'); return new Date(+p[0], +p[1] - 1, +p[2], 12); }
  function shortDate(d) { var x = ymd(d); return MONTHS[x.getMonth()] + ' ' + x.getDate(); }
  function longDate(d) { var x = ymd(d); return DAYS[x.getDay()] + ', ' + MONTHS[x.getMonth()] + ' ' + x.getDate(); }
  function fullDate(d) { var x = ymd(d); return x.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }); }
  function monthOf(d) { return MONTHS[ymd(d).getMonth()]; }
  function cents(n) { var r = Math.round(n * 100) / 100; return '$' + r.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }   // review + receipts: always cents so amounts line up
  var TRASH = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>';
  var CHEV = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
  function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }
  function typePill(t) { var k = String(t || '').toLowerCase(); return /^(indica|sativa|hybrid)$/.test(k) ? '<span class="rbp-pill ' + k + '">' + esc(t) + '</span>' : ''; }
  function tag(status) { return status === 'confirmed' ? '<span class="rbp-tag conf">Confirmed</span>' : '<span class="rbp-tag proj">Projected</span>'; }
  function store(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
  function stored(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function hdrHeight() { var h = document.querySelector('header'); var px = h ? h.offsetHeight : 74; document.documentElement.style.setProperty('--hdr', px + 'px'); return px; }

  function getJSON(url, ms, tries) {
    tries = tries == null ? 2 : tries;
    var attempt = 0;
    function once() {
      var ctl = window.AbortController ? new AbortController() : null;
      var t = setTimeout(function () { if (ctl) ctl.abort(); }, ms || 20000);
      return fetch(url, { cache: 'no-store', signal: ctl ? ctl.signal : undefined }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }).finally(function () { clearTimeout(t); });
    }
    function run() { return once().catch(function (e) { if (attempt++ >= tries) throw e; return new Promise(function (res) { setTimeout(res, 700 * attempt); }).then(run); }); }
    return run();
  }
  function postJSON(url, body, ms) {
    var ctl = window.AbortController ? new AbortController() : null;
    var t = setTimeout(function () { if (ctl) ctl.abort(); }, ms || 30000);
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body), signal: ctl ? ctl.signal : undefined })
      .then(function (r) { return r.json(); }).finally(function () { clearTimeout(t); });
  }
  function api(params) {
    var qs = Object.keys(params).map(function (k) { return k + '=' + encodeURIComponent(params[k]); }).join('&');
    return getJSON(CFG.PORTAL_API + '?' + qs);
  }

  // ───────── week model ─────────
  // Server week: { d:'2026-11-30', status, flower:[{n,t}], pre:[{n,t}] }  ->  ids match the old portal
  function wid(w) { return 'w_' + w.d.replace(/-/g, ''); }
  function pid(w, name, k) { return name.replace(/[^a-z0-9]/gi, '_').toLowerCase() + '_' + w.d.replace(/-/g, '') + '_' + k; }
  function weekById(id) { for (var i = 0; i < S.weeks.length; i++) if (wid(S.weeks[i]) === id) return S.weeks[i]; return null; }
  function product(weekId, p) {
    var w = weekById(weekId); if (!w) return null;
    for (var i = 0; i < SIZES.length; i++) {
      var z = SIZES[i], list = w[z.sec] || [];
      for (var j = 0; j < list.length; j++) if (pid(w, list[j].n, z.k) === p) return { week: w, name: list[j].n, type: list[j].t, size: z };
    }
    return null;
  }
  function types(w) { var t = []; if ((w.flower || []).length) t.push('Flower', 'Micro Buds'); if ((w.pre || []).length) t.push('Pre-rolls'); return w.types || t; }
  function strainCount(w) { if (w.count) return w.count; var s = {}; (w.flower || []).concat(w.pre || []).forEach(function (x) { s[x.n.toLowerCase()] = 1; }); return Object.keys(s).length; }
  function strainNames(w) { var seen = {}, out = []; (w.flower || []).concat(w.pre || []).forEach(function (x) { var k = x.n.toLowerCase(); if (!seen[k]) { seen[k] = 1; out.push(x.n); } }); return out; }

  // ───────── cart ─────────
  function qty(weekId, p) { return (S.cart[weekId] || {})[p] || 0; }
  function setQty(weekId, p, n) {
    n = Math.max(0, Math.floor(+n || 0));
    if (n > 0) { (S.cart[weekId] = S.cart[weekId] || {})[p] = n; }
    else if (S.cart[weekId]) { delete S.cart[weekId][p]; if (!Object.keys(S.cart[weekId]).length) delete S.cart[weekId]; }
  }
  function weekTotals(weekId) {
    var u = 0, d = 0, c = S.cart[weekId] || {};
    Object.keys(c).forEach(function (p) { var pr = product(weekId, p); if (pr) { u += c[p]; d += c[p] * pr.size.price; } });
    return { u: u, d: d };
  }
  function totals() {
    var u = 0, d = 0, w = 0;
    Object.keys(S.cart).forEach(function (id) { var t = weekTotals(id); if (t.u) { u += t.u; d += t.d; w++; } });
    return { u: u, d: d, w: w };
  }
  function cartWeeks() { return S.weeks.filter(function (w) { return weekTotals(wid(w)).u > 0; }); }

  // ───────── rendering ─────────
  function render() {
    hdrHeight();
    var html = hero();
    if (S.mode === 'loading') html += main('<div class="rbp-loading"><span class="rbp-spin"></span>Loading upcoming harvests…</div>');
    else if (S.mode === 'out') html += main(signedOut()) + gateCard();
    else if (S.screen === 'review') html += main(review(), 'rbp-review', true) + reviewBar();
    else if (S.screen === 'done') html += main(done(), 'rbp-review');
    else if (S.screen === 'cancelled') html += main(cancelled(), 'rbp-review');
    else html += main(browse(), '', totals().u > 0) + bar();
    root.innerHTML = html;
    var b0 = document.getElementById('rbp-bar'); document.body.classList.toggle('rbp-has-bar', !!(b0 && !b0.hidden));   // footer gets room so the bar never covers it
    if (S.mode === 'in' && S.screen === 'browse') spy();
    root.querySelectorAll('.rbp-rhead[data-act="collapse"]').forEach(function (x) { x.onkeydown = function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); x.click(); } }; });
    root.querySelectorAll('.rbp-lock').forEach(function (x) { x.onkeydown = function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); focusGate(); } }; });

  }
  function main(inner, cls, hasBar) { return '<main class="rbp-main' + (cls ? ' ' + cls : '') + (hasBar ? ' has-bar' : '') + '">' + inner + '</main>'; }

  function hero() {
    var title = 'Reserve upcoming harvests', sub;
    if (S.mode !== 'in') sub = 'Licensed Washington retailers can see what’s coming off the line each week and reserve it before it hits the menu.';
    else if (S.screen === 'review') { title = S.editing ? 'Edit your reservation' : 'Review your reservation'; sub = 'Check quantities, add a note if you need to, then send it to the Redbird team.'; }
    else if (S.screen === 'done' && S.submitted && S.submitted.viewing) { title = 'Your reservation'; sub = 'Change amounts or cancel any week that\u2019s still 14 or more days out.'; }
    else if (S.screen === 'done') { title = S.submitted && S.submitted.updated ? 'Changes saved' : 'Reservation sent'; sub = 'The Redbird team has it. We’ll be in touch to confirm delivery details.'; }
    else if (S.screen === 'cancelled') { title = 'Reservation cancelled'; sub = 'Your reserved quantities have been released.'; }
    else sub = 'Pick a delivery week and add what you want to reserve. Buttons add by the case; you can type any number.';
    var who = '';
    if (S.mode === 'in') {
      var multi = S.accounts.length > 1;
      who = '<div class="rbp-who">' + (S.internal ? '<span class="rbp-test">INTERNAL TEST</span>' : '') + 'Signed in as ' +
        (multi ? '<button class="rbp-store-btn" data-act="menu" aria-haspopup="true" aria-expanded="' + S.menu + '">' + esc(S.who.account) + ' ▾</button>' : '<b>' + esc(S.who.account) + '</b>') +
        ' · <button class="rbp-link" data-act="signout">Sign out</button>' +
        (multi && S.menu ? '<div class="rbp-store-menu" role="menu">' + S.accounts.map(function (a, i) {
          return '<button role="menuitem" data-act="store" data-i="' + i + '"><span>' + esc(a) + (i === 0 ? ' <small>primary</small>' : '') + '</span>' + (a === S.who.account ? '✓' : '') + '</button>';
        }).join('') + '</div>' : '') + '</div>';
    }
    return '<section class="rbp-hero"><div class="rbp-hero-text"><div class="rbp-mono rbp-eyebrow">Retailer reservations</div>' +
      '<h1 class="rbp-bebas">' + title + '</h1><p>' + sub + '</p></div>' + who + '</section>';
  }

  function legend() {
    return '<div class="rbp-legend"><span>' + tag('confirmed') + '<span>within the next 3 weeks</span></span><span>' + tag('projected') + '<span>further out, may change</span></span></div>';
  }

  function qctl(weekId, p, z, locked) {
    var n = locked ? 0 : qty(weekId, p);
    var a = locked ? ' data-act="locked"' : '';
    return '<span class="rbp-q' + (n ? ' has' : '') + '" data-w="' + weekId + '" data-p="' + p + '">' +
      '<button type="button" tabindex="-1"' + (a || ' data-act="step" data-d="-' + z.step + '"') + ' aria-label="Remove ' + z.step + '">−' + z.step + '</button>' +
      '<input type="number" min="0" inputmode="numeric" placeholder="0" value="' + (n || '') + '"' + (locked ? ' readonly data-act="locked"' : '') + ' aria-label="' + esc(z.sku) + ' quantity">' +
      '<button type="button" tabindex="-1"' + (a || ' data-act="step" data-d="' + z.step + '"') + ' aria-label="Add ' + z.step + '">+' + z.step + '</button></span>';
  }

  // Strain lists for a week, after search + size filters
  function visible(w) {
    var q = S.q.trim().toLowerCase(), picked = Object.keys(S.sizes).filter(function (k) { return S.sizes[k]; });
    var out = {};
    ['flower', 'pre'].forEach(function (sec) {
      var zs = SIZES.filter(function (z) { return z.sec === sec && (!picked.length || S.sizes[z.k]); });
      var list = (w[sec] || []).filter(function (s) { return !q || s.n.toLowerCase().indexOf(q) >= 0; });
      out[sec] = zs.length && list.length ? { sizes: zs, list: list } : null;
    });
    return out;
  }

  function grid(w, v, locked) {
    var id = wid(w), html = '';
    ['flower', 'pre'].forEach(function (sec) {
      var g = v[sec]; if (!g) return;
      if (phone()) {
        html += '<div class="rbp-mono rbp-sec">' + SEC_NAME[sec] + '</div>';
        g.list.forEach(function (s) {
          html += '<div class="rbp-sc"><div class="rbp-sc-top"><b>' + esc(s.n) + '</b>' + typePill(s.t) + '</div>' +
            (locked
              ? '<div class="rbp-sizechips"><div>' + g.sizes.map(function (z) { return '<span>' + z.col + '</span>'; }).join('') + '</div><button type="button" class="rbp-add" data-act="locked">+ Add</button></div>'
              : g.sizes.map(function (z) { return '<div class="rbp-sizerow"><span>' + z.lab + ' <i>· ' + money(z.price) + '</i></span>' + qctl(id, pid(w, s.n, z.k), z) + '</div>'; }).join('')) + '</div>';
        });
        return;
      }
      html += '<table class="rbp-table"><thead><tr><th class="rbp-mono">' + SEC_NAME[sec] + '</th>' +
        g.sizes.map(function (z) { return '<th>' + z.col + (locked ? '' : '<div class="rbp-per">' + money(z.price) + '/u</div>') + '</th>'; }).join('') + '</tr></thead><tbody>' +
        g.list.map(function (s) {
          return '<tr><td><span class="rbp-name">' + esc(s.n) + '</span>' + typePill(s.t) + '</td>' +
            g.sizes.map(function (z) { return '<td>' + qctl(id, pid(w, s.n, z.k), z, locked) + '</td>'; }).join('') + '</tr>';
        }).join('') + '</tbody></table>';
    });
    return html;
  }

  function weekHead(w, opts) {
    opts = opts || {};
    var id = wid(w), t = opts.out ? { u: 0 } : weekTotals(id);
    return '<div class="rbp-card-head' + (opts.click ? ' clickable' : '') + '"' + (opts.click ? ' data-act="toggle" data-w="' + id + '"' : '') + '>' +
      '<div style="min-width:0"><div class="rbp-card-title"><span class="rbp-bebas">Week of ' + shortDate(w.d) + '</span>' + tag(w.status) + '</div>' +
      '<div class="rbp-meta">' + plural(strainCount(w), 'strain') + ' · ' + types(w).join(' · ') + '</div>' +
      (opts.preview ? '<div class="rbp-preview">' + esc(strainNames(w).join(' · ')) + '</div>' : '') + '</div>' +
      '<div class="rbp-card-side"><span class="rbp-badge" data-badge="' + id + '"' + (t.u ? '' : ' hidden') + '>' + (t.u ? plural(t.u, 'unit') + ' · ' + money(t.d) : '') + '</span>' +
      (opts.out ? '' : '<button type="button" class="rbp-toggle' + (opts.open ? ' open' : '') + '" data-act="toggle" data-w="' + id + '" aria-expanded="' + !!opts.open + '">' + (opts.open ? 'Close ▴' : 'Open ▾') + '</button>') +
      '</div></div>';
  }

  // ── signed out ──
  function signedOut() {
    var weeks = (S.teaser && S.teaser.weeks) || [];
    var html = weeks.length ? tools(weeks, true) : legend();
    if (!weeks.length) return html + (S.teaser ? '<section class="rbp-card"><div class="rbp-empty">New weeks are posted as harvests get scheduled. Check back soon.</div></section>' : '');
    var w1 = weeks[0], w2 = weeks[1];
    html += '<div class="rbp-weeks">';
    html += '<section class="rbp-card rbp-out" data-act="locked">' + weekHead(w1, { out: true }) + grid(w1, visible(w1), true) + '<div class="rbp-note">Sign in to see pricing and reserve this week.</div></section>';
    if (w2) html += '<div class="rbp-fade" aria-hidden="true"><section class="rbp-card rbp-out" data-act="locked">' + weekHead(w2, { out: true }) + grid(w2, visible(w2), true) + '</section></div>';
    html += '</div>';
    var rest = weeks.slice(w2 ? 2 : 1);
    if (rest.length) {
      html += '<div class="rbp-later"><div class="rbp-mono">Also coming up</div>' + rest.map(function (w) {
        return '<div class="rbp-lock" data-act="locked" role="button" tabindex="0"><div><span class="rbp-bebas">Week of ' + shortDate(w.d) + '</span>' + tag(w.status) + '<span class="rbp-meta">' + types(w).join(' · ') + '</span></div>' + LOCK_SVG + '</div>';
      }).join('') + '</div>';
    }
    return html;
  }

  function gateCard() {
    var c = '<div class="rbp-gate ' + S.gate + '" id="rbp-gate" role="region" aria-label="Sign in">';
    if (S.gate === 'request') {
      c += '<h2 class="rbp-bebas">Request access</h2><p>Goes to the Redbird sales team. We’ll set you up and email you back.</p>' +
        '<form class="rbp-form" data-form="request" novalidate style="margin-top:12px">' +
        '<input class="rbp-input" name="shop" placeholder="Shop name" autocomplete="organization" required>' +
        '<input class="rbp-input" name="license" placeholder="WSLCB license #" inputmode="numeric">' +
        '<input class="rbp-input" name="name" placeholder="Your name" autocomplete="name" required>' +
        '<input class="rbp-input" name="email" type="email" placeholder="Email" autocomplete="email" required>' +
        '<input class="rbp-input" name="phone" type="tel" placeholder="Phone (optional)" autocomplete="tel">' +
        '<input class="rbp-hp" name="hp" tabindex="-1" autocomplete="off" aria-hidden="true">' +
        '<button class="rbp-btn block" type="submit"' + (S.busy ? ' disabled' : '') + '>' + (S.busy ? 'Sending…' : 'Send request') + '</button>' +
        (S.err ? '<div class="rbp-msg err" role="alert">' + esc(S.err) + '</div>' : '') +
        '</form><div class="rbp-center"><button type="button" class="rbp-textlink" data-act="gate" data-to="signin">Back to sign in</button></div>';
    } else if (S.gate === 'sent') {
      c += '<h2 class="rbp-bebas">Request sent</h2><p>Thanks. The Redbird sales team will set you up and email you back, usually within a business day. Once you’re set up, sign in here with that email.</p>' +
        '<div class="rbp-center" style="margin-top:14px"><button type="button" class="rbp-textlink" data-act="gate" data-to="signin">Back to sign in</button></div>';
    } else {
      c += '<h2 class="rbp-bebas">Sign in to reserve</h2><p>Use the buyer email your Redbird sales rep has on file to see every week, pricing and strains.</p>' +
        '<form class="rbp-row" data-form="signin" novalidate><input class="rbp-input" name="email" type="email" placeholder="buyer@yourshop.com" autocomplete="email" aria-label="Buyer email" value="' + esc(S.lastEmail || '') + '">' +
        '<button class="rbp-btn" type="submit"' + (S.busy ? ' disabled' : '') + '>' + (S.busy ? 'One sec…' : 'Sign in') + '</button></form>' +
        (S.err ? '<div class="rbp-msg err" role="alert">' + S.err + '</div>' : '') +
        '<div class="rbp-or"><span></span>Not set up yet?<span></span></div>' +
        '<button type="button" class="rbp-btn ghost block" data-act="gate" data-to="request">Request access</button>';
    }
    return c + '</div>';
  }

  // Search, size chips and month tabs. Signed out they look the same but every click goes to the sign-in card.
  function tools(weeks, locked) {
    var L = locked ? ' data-act="locked"' : '';
    var html = '<div class="rbp-tools"><input class="rbp-search" type="search" placeholder="Search strains" aria-label="Search strains" value="' + (locked ? '' : esc(S.q)) + '"' + (locked ? ' readonly data-act="locked"' : ' data-act="search"') + '>';
    html += CHIPS.map(function (g) {
      return '<div class="rbp-chipgroup"><span class="rbp-mono">' + g[0] + '</span>' + g[1].map(function (k) {
        var on = !locked && S.sizes[k];
        return '<button type="button" class="rbp-chip' + (on ? ' on' : '') + '"' + (L || ' data-act="size" data-k="' + k + '"') + ' aria-pressed="' + !!on + '">' + SIZE[k].col + '</button>';
      }).join('') + '</div>';
    }).join('<span class="rbp-sep"></span>');
    if (!locked && (S.q || Object.keys(S.sizes).some(function (k) { return S.sizes[k]; }))) html += '<button type="button" class="rbp-clear" data-act="clear">Clear</button>';
    html += '</div>';
    var months = [];
    weeks.forEach(function (w) { var m = monthOf(w.d); if (months.indexOf(m) < 0) months.push(m); });
    if (!phone() && months.length > 1) html += '<div class="rbp-months">' + months.map(function (m, i) { return '<button type="button" class="rbp-month' + ((locked ? months[0] : (S.month || months[0])) === m ? ' on' : '') + '"' + (L || ' data-act="month" data-m="' + m + '"') + '>' + m + '</button>'; }).join('') + '</div>';
    return html + legend();
  }

  // ── signed in: browse ──
  function browse() {
    if (!S.weeks.length) return mineList() + legend() + '<section class="rbp-card"><div class="rbp-empty">Nothing is open for reservations right now. New weeks are posted as harvests get scheduled, so check back soon.</div></section>';
    var html = mineList() + tools(S.weeks, false);
    var cards = S.weeks.map(function (w) {
      var v = visible(w);
      if (!v.flower && !v.pre) return '';
      var id = wid(w), open = !!S.open[id];
      return '<section class="rbp-card" id="card-' + id + '" data-month="' + monthOf(w.d) + '">' + weekHead(w, { open: open, preview: !open, click: !open }) + (open ? grid(w, v, false) : '') + '</section>';
    }).join('');
    html += '<div class="rbp-weeks">' + (cards || '<section class="rbp-card"><div class="rbp-empty">No strains match. <button type="button" class="rbp-textlink" data-act="clear">Clear filters</button></div></section>') + '</div>';
    return html;
  }

  function mineList() {
    var list = S.mine || [];
    if (!list.length) return '';
    return '<section class="rbp-mine"><div class="rbp-mono">Your reservations</div>' + list.map(function (r) {
      var sent = S.sentLink[r.id];
      return '<div class="rbp-mine-row"><div><b>' + esc(r.id) + '</b><span class="rbp-meta">' + (S.accounts.length > 1 ? esc(r.store) + ' · ' : '') + 'Week' + (r.weeks.length > 1 ? 's' : '') + ' of ' + r.weeks.map(shortDate).join(', ') + ' · ' + plural(r.units, 'unit') + ' · ' + money(r.total) + '</span></div>' +
        (r.changeable ? (sent ? '<span class="rbp-meta">Link sent to ' + esc(sent) + '</span>' : '<button type="button" class="rbp-textlink" data-act="resend" data-id="' + esc(r.id) + '">Email me the link to change it</button>') : '<span class="rbp-meta">Locked in</span>') + '</div>';
    }).join('') + '</section>';
  }

  function bar() {
    var t = totals();
    return '<div class="rbp-bar" id="rbp-bar"' + (t.u ? '' : ' hidden') + '><div><div><div class="rbp-bebas" data-total>' + money(t.d) + '</div><small data-sub>' + plural(t.u, 'unit') + ' · ' + plural(t.w, 'week') + '</small></div>' +
      '<button type="button" class="rbp-btn" data-act="review">' + (S.editing ? 'Review changes →' : 'Review reservation →') + '</button></div></div>';
  }

  // ── review ──
  function weekMeta(id) { var t = weekTotals(id), n = Object.keys(S.cart[id] || {}).length; return plural(n, 'item') + ' · ' + plural(t.u, 'unit') + ' · ' + cents(t.d); }
  function review() {
    var weeks = cartWeeks();
    var html = '<div class="rbp-col"><button type="button" class="rbp-back" data-act="browse">\u2190 Back to all weeks</button>';
    if (S.editing && S.submitted) {
      var keep = S.submitted.reservation.items.filter(function (i) { return i.locked; }).concat(S.extra || []);
      if (keep.length) html += '<p class="rbp-fine" style="margin:0 0 10px">These stay as reserved: weeks within 14 days are locked in, and strains no longer on the menu can\u2019t be changed here.</p><div class="rbp-weeks" style="margin-bottom:12px">' + resItemsHtml(keep) + '</div>';
    }
    if (!weeks.length && !(S.editing && S.extra && S.extra.length)) return html + '<section class="rbp-card"><div class="rbp-empty">Nothing added yet. <button type="button" class="rbp-textlink" data-act="browse">Pick a week</button></div></section></div>';
    html += '<div class="rbp-weeks">';
    weeks.forEach(function (w) {
      var id = wid(w), c = S.cart[id], t = weekTotals(id), shut = !!S.collapsed[id];
      html += '<section class="rbp-card rbp-rcard' + (shut ? ' shut' : '') + '"><div class="rbp-rhead" data-act="collapse" data-w="' + id + '" role="button" tabindex="0" aria-expanded="' + !shut + '">' +
        '<div><span class="rbp-bebas">Week of ' + shortDate(w.d) + '</span>' + (shut ? '<small data-wmeta="' + id + '">' + weekMeta(id) + '</small>' : '') + '</div>' +
        '<div class="rbp-rhead-side">' + (shut ? '' : '<button type="button" class="rbp-textlink" data-act="addmore" data-w="' + id + '">+ Add more</button>') +
        '<span class="rbp-chev">' + CHEV + '</span></div></div>';
      if (!shut) {
        ['flower', 'pre'].forEach(function (sec) {
          var rows = '';
          SIZES.forEach(function (z) {
            if (z.sec !== sec) return;
            (w[z.sec] || []).forEach(function (st) {
              var p = pid(w, st.n, z.k), n = c[p]; if (!n) return;
              rows += '<div class="rbp-ritem"><div class="rbp-ritem-name"><b>' + esc(st.n) + '</b>' + typePill(st.t) + '<div>' + z.sku + ' · ' + money(z.price) + ' each</div></div>' +
                '<div class="rbp-ritem-ctl">' + qctl(id, p, z) + '<span class="rbp-line" data-line="' + p + '">' + cents(n * z.price) + '</span>' +
                '<button type="button" class="rbp-trash" data-act="remove" data-w="' + id + '" data-p="' + p + '" aria-label="Remove ' + esc(st.n) + ' ' + z.sku + '" title="Remove">' + TRASH + '</button></div></div>';
            });
          });
          if (rows) html += '<div class="rbp-mono rbp-rsec">' + SEC_NAME[sec] + '</div>' + rows;
        });
        html += '<div class="rbp-wsub"><span>Week of ' + shortDate(w.d) + ' subtotal</span><span><i data-wu="' + id + '">' + plural(t.u, 'unit') + '</i><b data-wt="' + id + '">' + cents(t.d) + '</b></span></div>';
      }
      html += '</section>';
    });
    html += '</div>';
    html += '<section class="rbp-card rbp-notes"><label for="rbp-notes">Order notes <span>(optional)</span></label><p>Anything the Redbird team should know: delivery instructions, store requests, special asks.</p>' +
      '<textarea id="rbp-notes" data-act="notes" placeholder="e.g. Deliver to the back door, ring the bell for the buyer">' + esc(S.notes) + '</textarea></section>';
    html += (S.editing ? '<div class="rbp-actions"><button type="button" class="rbp-btn ghost" data-act="askcancel">Cancel reservation</button></div>' : '') +
      (S.err ? '<div class="rbp-msg err" role="alert">' + esc(S.err) + '</div>' : '') +
      '<p class="rbp-fine" style="margin-top:12px">Availability is first-come, first-served. Projected weeks can shift; we\u2019ll confirm before delivery.</p>';
    return html + '</div>';
  }

  // Review: the total and the send button stay at the bottom of the screen.
  function reviewBar() {
    var T = totals();
    return '<div class="rbp-bar" id="rbp-bar"><div><div><div class="rbp-bebas" data-total>' + cents(T.d) + '</div><small data-sub>' + plural(T.u, 'unit') + ' · ' + plural(T.w, 'week') + '</small></div>' +
      '<button type="button" class="rbp-btn" data-act="confirm"' + (S.busy || !T.u && !(S.extra && S.extra.length) ? ' disabled' : '') + '>' + (S.busy ? 'Sending\u2026' : S.editing ? 'Save changes' : 'Send reservation') + '</button></div></div>';
  }

  function resWeeks(items) {
    var by = {}, order = [];
    items.forEach(function (i) { if (!by[i.week]) { by[i.week] = []; order.push(i.week); } by[i.week].push(i); });
    return order.map(function (d) { return { d: d, items: by[d], total: by[d].reduce(function (s, i) { return s + i.lineTotal; }, 0), units: by[d].reduce(function (s, i) { return s + i.qty; }, 0) }; });
  }
  function resItemsHtml(items, note) {
    return resWeeks(items).map(function (w) {
      return '<section class="rbp-card rbp-rcard"><div class="rbp-rhead"><div><span class="rbp-bebas">Week of ' + shortDate(w.d) + '</span>' + (w.items[0].locked ? '<small>Locked in</small>' : '') + '</div>' + (note || '') + '</div>' +
        w.items.map(function (it) { return '<div class="rbp-ritem"><div class="rbp-ritem-name"><b>' + esc(it.strain) + '</b><div>' + esc(it.size) + ' · ' + it.qty + ' × ' + cents(it.unitPrice) + '</div></div><span class="rbp-line">' + cents(it.lineTotal) + '</span></div>'; }).join('') +
        '<div class="rbp-wsub receipt"><span>Week of ' + shortDate(w.d) + ' subtotal</span><span><i>' + plural(w.units, 'unit') + '</i><b>' + cents(w.total) + '</b></span></div></section>';
    }).join('');
  }

  function done() {
    var o = S.submitted, r = o.reservation, changeable = r.items.some(function (i) { return !i.locked; });
    var head = o.viewing ? esc(r.id) : o.updated ? 'Updated ' + esc(r.id) : 'Thanks, ' + esc(S.who.account);
    var sub = o.viewing ? (changeable ? 'Weeks 14 or more days out can still be changed.' : 'Every week is within 14 days, so this one is locked in.')
      : 'Reservation ' + esc(r.id) + (r.email ? ' · a copy is on its way to ' + esc(r.email) : '');
    var html = '<div class="rbp-weeks"><section class="rbp-card"><div style="display:flex;gap:14px;align-items:center"><div class="rbp-check">' + (o.viewing ? '#' : '\u2713') + '</div><div><div class="rbp-bebas" style="font-size:30px;line-height:1">' + head + '</div>' +
      '<div class="rbp-meta">' + sub + '</div></div></div></section>';
    html += resItemsHtml(r.items);
    html += '<section class="rbp-card rbp-rcard"><div class="rbp-totals"><div class="rbp-grand" style="border:0;margin:0;padding:0"><span>Total · ' + plural(r.units, 'unit') + '</span><span class="rbp-bebas">' + cents(r.total) + '</span></div></div></section>';
    if (r.notes) html += '<section class="rbp-card rbp-notes"><label>Order notes</label><p style="margin:0;white-space:pre-wrap">' + esc(r.notes) + '</p></section>';
    html += (changeable ? '<div class="rbp-actions"><button type="button" class="rbp-btn" data-act="edit">Change reservation</button><button type="button" class="rbp-btn ghost" data-act="askcancel">Cancel reservation</button></div>' +
      '<p class="rbp-fine">You can change or cancel each week until 14 days before that week. After that it\u2019s locked in; reply to your confirmation email or call your rep.</p>' : '') +
      (S.err ? '<div class="rbp-msg err" role="alert">' + esc(S.err) + '</div>' : '') +
      '<p class="rbp-fine"><button type="button" class="rbp-textlink" data-act="new">Start a new reservation</button></p></div>';
    return html;
  }

  function cancelled() {
    var r = S.submitted && S.submitted.reservation, kept = r ? r.items : [];
    return '<section class="rbp-card"><div class="rbp-empty">' + (kept.length ? 'We released the weeks you could still change. The weeks below are within 14 days and stay reserved.' : 'Reservation ' + esc(r ? r.id : '') + ' is cancelled and the amounts were released.') +
      '<div style="margin-top:16px"><button type="button" class="rbp-btn" data-act="new">Start a new reservation</button></div></div></section>' + (kept.length ? '<div class="rbp-weeks" style="margin-top:12px">' + resItemsHtml(kept) + '</div>' : '');
  }

  function modal(title, text, yes, yesAct, no) {
    var m = document.createElement('div');
    m.className = 'rbp-modal'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true');
    m.innerHTML = '<div><h3>' + title + '</h3><p>' + text + '</p><div class="rbp-actions"><button type="button" class="rbp-btn ghost" data-m="no">' + no + '</button><button type="button" class="rbp-btn" data-m="yes">' + yes + '</button></div></div>';
    m.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-m]');
      if (ev.target === m || (b && b.getAttribute('data-m') === 'no')) { m.remove(); return; }
      if (b && b.getAttribute('data-m') === 'yes') { m.remove(); yesAct(); }
    });
    document.body.appendChild(m);
    m.querySelector('[data-m="yes"]').focus();
  }

  // ───────── soft updates (typing keeps focus) ─────────
  function refreshNumbers(weekId, p) {
    var n = qty(weekId, p), pr = product(weekId, p);
    root.querySelectorAll('.rbp-q[data-w="' + weekId + '"][data-p="' + p + '"]').forEach(function (q) {
      q.classList.toggle('has', n > 0);
      var inp = q.querySelector('input'); if (inp && document.activeElement !== inp) inp.value = n || '';
    });
    var t = weekTotals(weekId), T = totals();
    var b = root.querySelector('[data-badge="' + weekId + '"]');
    if (b) { b.hidden = !t.u; b.textContent = t.u ? plural(t.u, 'unit') + ' · ' + money(t.d) : ''; }
    var line = root.querySelector('[data-line="' + p + '"]'); if (line && pr) line.textContent = cents(n * pr.size.price);
    var wt = root.querySelector('[data-wt="' + weekId + '"]'); if (wt) wt.textContent = cents(t.d);
    var wt2 = root.querySelector('[data-wt2="' + weekId + '"]'); if (wt2) wt2.textContent = money(t.d);
    var wu = root.querySelector('[data-wu="' + weekId + '"]'); if (wu) wu.textContent = plural(t.u, 'unit');
    var tu = root.querySelector('[data-tu]'); if (tu) tu.textContent = plural(T.u, 'unit');
    root.querySelectorAll('[data-total]').forEach(function (el) { el.textContent = S.screen === 'review' ? cents(T.d) : money(T.d); });
    var bar = document.getElementById('rbp-bar');
    if (bar && S.screen === 'review') { bar.querySelector('[data-sub]').textContent = plural(T.u, 'unit') + ' · ' + plural(T.w, 'week'); }
    else if (bar) {
      bar.hidden = !T.u; document.body.classList.toggle('rbp-has-bar', !!T.u);
      bar.querySelector('[data-sub]').textContent = plural(T.u, 'unit') + ' · ' + plural(T.w, 'week');
      var m = root.querySelector('main.rbp-main'); if (m) m.classList.toggle('has-bar', T.u > 0);
    }
  }

  // ───────── signed out: the sign-in card stays put at the bottom of the screen ─────────
  // The sign-in card sits in the middle of the screen the whole way down (it's meant to cover the preview).

  // ───────── month tabs follow the scroll (desktop) ─────────
  var spyOn = false;
  function spy() {
    if (spyOn) return; spyOn = true;
    window.addEventListener('scroll', function () {
      if (S.mode !== 'in' || S.screen !== 'browse') return;
      var line = hdrHeight() + 70, cur = '';
      root.querySelectorAll('.rbp-card[data-month]').forEach(function (c) { if (c.getBoundingClientRect().top <= line) cur = c.getAttribute('data-month'); });
      var first = root.querySelector('.rbp-card[data-month]');
      cur = cur || (first && first.getAttribute('data-month')) || '';
      if (cur && cur !== S.month) {
        S.month = cur;
        root.querySelectorAll('.rbp-month').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-m') === cur); });
      }
    }, { passive: true });
  }
  function scrollToEl(el, extra) {
    if (!el) return;
    var y = el.getBoundingClientRect().top + window.pageYOffset - hdrHeight() - (extra || 12);
    window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
  }

  // ───────── actions ─────────
  function toggleWeek(id) {
    var opening = !S.open[id];
    if (phone()) S.open = {};               // phone: one week open at a time (amounts stay in the cart)
    if (opening) S.open[id] = true; else delete S.open[id];
    render();
    if (opening) scrollToEl(document.getElementById('card-' + id), phone() ? 8 : 58);
  }

  function focusGate() {
    if (S.gate !== 'signin') { S.gate = 'signin'; S.err = ''; render(); }
    var g = document.getElementById('rbp-gate'), inp = g && g.querySelector('input[name="email"]');
    if (inp) inp.focus({ preventScroll: true });
    if (g) { g.classList.remove('nudge'); void g.offsetWidth; g.classList.add('nudge'); }
  }

  function setUrl(params) {
    var qs = Object.keys(params).filter(function (k) { return params[k]; }).map(function (k) { return k + '=' + encodeURIComponent(params[k]); }).join('&');
    try { history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '')); } catch (e) {}
  }

  function signIn(email) {
    email = String(email || '').trim().toLowerCase();
    S.lastEmail = email;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { S.err = 'Please enter a valid email address.'; render(); focusGate(); return; }
    S.busy = true; S.err = ''; render();
    api({ action: 'lookup', email: email }).then(function (r) {
      S.busy = false;
      if (!r || !r.ok) {
        S.err = r && r.error === 'not_found'
          ? 'We don’t have ' + esc(email) + ' on file yet. Ask your Redbird sales rep to add you, or request access below.'
          : 'We couldn’t reach our system just now. Please try again in a moment.';
        render(); return;
      }
      enter({ email: r.email, name: r.name, accounts: r.stores, internal: !!r.internal });
    }).catch(function () { S.busy = false; S.err = 'We couldn’t reach our system just now. Please try again in a moment.'; render(); });
  }

  // Signed in: load every week, then show the portal.
  function enter(o) {
    S.who = { email: o.email || '', name: o.name || '', account: o.accounts[0] || '' };
    S.accounts = o.accounts || []; S.internal = !!o.internal;
    if (S.who.email) store('rb_portal_email', S.who.email);
    if (o.keepUrl !== true) setUrl({ acct: S.who.account, contact: S.who.name, email: S.who.email, internal: S.internal ? '1' : '' });
    S.mode = 'loading'; render();
    return api({ action: 'weeks', email: S.who.email, acct: S.who.account }).then(function (r) {
      if (!r || !r.ok) throw new Error((r && r.error) || 'weeks');
      S.weeks = r.weeks || []; S.mode = 'in'; S.screen = 'browse'; S.err = '';
      S.month = S.weeks.length ? monthOf(S.weeks[0].d) : '';
      if (o.then) o.then(); else { render(); window.scrollTo(0, 0); }
      loadMine();
    }).catch(function (e) {
      if (String(e && e.message) === 'not_found') { signOut('We couldn’t open that account. Sign in with your buyer email.'); return; }
      S.mode = 'in'; S.weeks = []; render();
      root.querySelector('main').innerHTML = '<section class="rbp-card"><div class="rbp-empty">We couldn’t load upcoming harvests right now. This is usually a brief connection issue.<div style="margin-top:14px"><button type="button" class="rbp-btn" data-act="retry">Try again</button></div></div></section>';
    });
  }

  function signOut(msg) {
    store('rb_portal_email', null);
    S.cart = {}; S.carts = {}; S.open = {}; S.submitted = null; S.editing = false; S.notes = ''; S.menu = false;
    S.who = { name: '', email: '', account: '' }; S.accounts = []; S.internal = false;
    S.gate = 'signin'; S.err = msg || ''; S.busy = false;
    setUrl({});
    loadTeaser();
  }

  function loadTeaser() {
    S.mode = S.teaser ? 'out' : 'loading'; render();
    if (S.teaser) return;
    api({ action: 'teaser' }).then(function (r) { S.teaser = r && r.ok ? r : { weeks: [] }; })
      .catch(function () { S.teaser = null; })
      .then(function () { S.mode = 'out'; render(); });
  }

  function switchStore(i) {
    var to = S.accounts[i]; S.menu = false;
    if (!to || to === S.who.account) { render(); return; }
    S.carts[S.who.account] = S.cart;
    S.cart = S.carts[to] || {};
    S.who.account = to; S.submitted = null; S.editing = false; S.notes = ''; S.screen = 'browse';
    setUrl({ acct: to, contact: S.who.name, email: S.who.email, internal: S.internal ? '1' : '' });
    render();
  }

  // Everything in the cart (plus any reserved lines that are no longer on the menu, kept as they are)
  function cartItems() {
    var items = [];
    cartWeeks().forEach(function (w) {
      var c = S.cart[wid(w)];
      SIZES.forEach(function (z) { (w[z.sec] || []).forEach(function (s) { var n = c[pid(w, s.n, z.k)]; if (n) items.push({ deliveryWeek: w.d, strain: s.n, productSize: z.sku, qty: n }); }); });
    });
    (S.extra || []).forEach(function (i) { items.push({ deliveryWeek: i.week, strain: i.strain, productSize: i.size, qty: i.qty }); });
    return items;
  }
  var ERR = {
    locked: 'Those weeks are within 14 days now, so they\u2019re locked in. Reply to your confirmation email or call your rep.',
    cancelled: 'This reservation was already cancelled.',
    not_found: 'We couldn\u2019t find that reservation. Use the link in your latest confirmation email.',
    empty: 'Those strains aren\u2019t on the menu for that week anymore. Go back and pick again.',
    store: 'That store isn\u2019t linked to your email. Ask your Redbird sales rep.'
  };

  function send() {
    var items = cartItems(); if (!items.length) return;
    var editing = S.editing && S.submitted;
    var body = editing ? { action: 'update', id: S.submitted.reservation.id, t: S.submitted.t, items: items, notes: S.notes.trim() }
      : { action: 'reserve', email: S.who.email, account: S.who.account, items: items, notes: S.notes.trim() };
    S.busy = true; S.err = ''; render();
    postJSON(CFG.PORTAL_API, body).then(function (r) {
      S.busy = false;
      if (!r || !r.ok) { S.err = ERR[r && r.error] || 'We couldn\u2019t confirm that went through. Check your email for a confirmation before trying again, or contact your Redbird sales rep.'; render(); return; }
      S.submitted = { reservation: r.reservation, t: editing ? S.submitted.t : r.t, updated: !!editing };
      S.editing = false; S.extra = []; S.cart = {}; S.notes = '';
      S.screen = r.cancelled ? 'cancelled' : 'done'; render(); window.scrollTo(0, 0); loadMine();
    }).catch(function () {
      S.busy = false;
      S.err = 'We couldn\u2019t confirm that went through. Check your email for a confirmation before trying again, or contact your Redbird sales rep.';
      render();
    });
  }

  function cancelRes() {
    if (!S.submitted) return;
    S.busy = true; S.err = ''; render();
    postJSON(CFG.PORTAL_API, { action: 'cancel', id: S.submitted.reservation.id, t: S.submitted.t }).then(function (r) {
      S.busy = false;
      if (!r || !r.ok) { S.err = ERR[r && r.error] || 'We couldn\u2019t cancel just now. Please try again, or contact your Redbird sales rep.'; render(); return; }
      S.submitted.reservation = r.reservation;
      S.cart = {}; S.notes = ''; S.editing = false; S.extra = []; S.screen = 'cancelled'; render(); window.scrollTo(0, 0); loadMine();
    }).catch(function () { S.busy = false; S.err = 'We couldn\u2019t cancel just now. Please try again, or contact your Redbird sales rep.'; render(); });
  }

  // Put a saved reservation back in the cart to change it (weeks inside 14 days stay as they are).
  function editSubmitted() {
    var r = S.submitted.reservation; S.cart = {}; S.extra = [];
    r.items.forEach(function (i) {
      if (i.locked) return;
      var w = null; S.weeks.forEach(function (x) { if (x.d === i.week) w = x; });
      var z = null; SIZES.forEach(function (x) { if (x.sku === i.size) z = x; });
      var onMenu = w && z && (w[z.sec] || []).some(function (s) { return s.n.toLowerCase() === i.strain.toLowerCase(); });
      if (onMenu) setQty(wid(w), pid(w, (w[z.sec].filter(function (s) { return s.n.toLowerCase() === i.strain.toLowerCase(); })[0]).n, z.k), i.qty);
      else S.extra.push(i);
    });
    S.notes = r.notes || ''; S.editing = true; S.screen = 'review'; S.err = ''; render(); window.scrollTo(0, 0);
  }

  function loadMine() {
    if (S.mode !== 'in') return;
    api({ action: 'mine', email: S.who.email, acct: S.who.account }).then(function (r) {
      S.mine = r && r.ok ? r.reservations : [];
      if (S.screen === 'browse') { var y = window.pageYOffset; render(); window.scrollTo(0, y); }
    }).catch(function () {});
  }

  function requestAccess(form) {
    var f = {}; ['shop', 'license', 'name', 'email', 'phone', 'hp'].forEach(function (k) { f[k] = (form.elements[k].value || '').trim(); });
    if (!f.shop || !f.name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email)) { S.err = 'Please add your shop name, your name and a valid email.'; keepForm(form, f); return; }
    S.busy = true; S.err = ''; keepForm(form, f);
    postJSON(CFG.PORTAL_API, { action: 'requestAccess', shop: f.shop, license: f.license, name: f.name, email: f.email, phone: f.phone, hp: f.hp, ms: Date.now() - S.formStart })
      .then(function (r) { S.busy = false; if (!r || !r.ok) throw new Error('x'); S.gate = 'sent'; render(); focusGate2(); })
      .catch(function () { S.busy = false; S.err = 'That didn’t send. Please try again, or email redbird@redbird-cannabis.com.'; keepForm(null, f); });
  }
  // re-render the request form without losing what was typed
  function keepForm(form, f) {
    render();
    var nf = root.querySelector('form[data-form="request"]');
    if (nf) Object.keys(f).forEach(function (k) { if (nf.elements[k]) nf.elements[k].value = f[k]; });
  }

  // ───────── events ─────────
  root.addEventListener('click', function (ev) {
    var el = ev.target.closest('[data-act]'); if (!el || !root.contains(el)) {
      if (S.menu && !ev.target.closest('.rbp-who')) { S.menu = false; render(); }
      return;
    }
    var act = el.getAttribute('data-act'), w = el.getAttribute('data-w'), p;
    switch (act) {
      case 'locked': ev.preventDefault(); focusGate(); break;
      case 'gate': S.gate = el.getAttribute('data-to'); S.err = ''; S.busy = false; if (S.gate === 'request') S.formStart = Date.now(); render(); focusGate2(); break;
      case 'toggle': ev.stopPropagation(); toggleWeek(w); break;
      case 'collapse': if (ev.target.closest('[data-act="addmore"]')) break; S.collapsed[w] = !S.collapsed[w]; render(); break;
      case 'step':
        var q = el.closest('.rbp-q'); w = q.getAttribute('data-w'); p = q.getAttribute('data-p');
        setQty(w, p, qty(w, p) + (+el.getAttribute('data-d'))); refreshNumbers(w, p); break;
      case 'remove': setQty(w, el.getAttribute('data-p'), 0); render(); break;
      case 'size': var k = el.getAttribute('data-k'); S.sizes[k] = !S.sizes[k]; render(); break;
      case 'clear': S.q = ''; S.sizes = {}; render(); break;
      case 'month':
        var m = el.getAttribute('data-m'), card = root.querySelector('.rbp-card[data-month="' + m + '"]');
        S.month = m; root.querySelectorAll('.rbp-month').forEach(function (b) { b.classList.toggle('on', b === el); });
        scrollToEl(card, 58); break;
      case 'review': S.screen = 'review'; S.err = ''; render(); window.scrollTo(0, 0); break;
      case 'browse': S.screen = 'browse'; S.err = ''; render(); window.scrollTo(0, 0); break;
      case 'addmore': S.screen = 'browse'; S.err = ''; if (phone()) S.open = {}; S.open[w] = true; render(); scrollToEl(document.getElementById('card-' + w), phone() ? 8 : 58); break;
      case 'confirm':
        var T = totals();
        if (S.editing) send();
        else modal('Send this reservation?', plural(T.u, 'unit') + ' across ' + plural(T.w, 'delivery week') + ' for ' + money(T.d) + '.', 'Yes, send it', send, 'Go back');
        break;
      case 'edit': editSubmitted(); break;
      case 'resend':
        var rid = el.getAttribute('data-id'); el.disabled = true; el.textContent = 'Sending…';
        postJSON(CFG.PORTAL_API, { action: 'resend', id: rid, email: S.who.email, account: S.who.account }).then(function (r) {
          S.sentLink[rid] = r && r.ok ? r.to : 'your email'; render();
        }).catch(function () { el.disabled = false; el.textContent = 'Try again'; });
        break;
      case 'askcancel': modal('Cancel this reservation?', 'This can’t be undone. Your reserved quantities will be released.', 'Yes, cancel it', cancelRes, 'Keep it'); break;
      case 'new': S.cart = {}; S.submitted = null; S.editing = false; S.extra = []; S.notes = ''; S.open = {}; S.screen = 'browse'; S.err = ''; setUrl({ acct: S.who.account, contact: S.who.name, email: S.who.email, internal: S.internal ? '1' : '' }); render(); window.scrollTo(0, 0); break;
      case 'signout': signOut(); break;
      case 'menu': S.menu = !S.menu; render(); break;
      case 'store': switchStore(+el.getAttribute('data-i')); break;
      case 'retry': enter({ email: S.who.email, name: S.who.name, accounts: S.accounts.length ? S.accounts : [S.who.account], internal: S.internal, keepUrl: true }); break;
    }
  });
  function focusGate2() { var g = document.getElementById('rbp-gate'), i = g && g.querySelector('input'); if (i) i.focus({ preventScroll: true }); }

  root.addEventListener('submit', function (ev) {
    var f = ev.target; ev.preventDefault();
    if (f.getAttribute('data-form') === 'signin') signIn(f.elements.email.value);
    if (f.getAttribute('data-form') === 'request' && !S.busy) requestAccess(f);
  });

  root.addEventListener('focusin', function (ev) {
    var t = ev.target;
    if (t.matches('.rbp-q input')) { if (t.hasAttribute('readonly')) { focusGate(); return; } setTimeout(function () { try { t.select(); } catch (e) {} }, 0); }
  });
  root.addEventListener('input', function (ev) {
    var t = ev.target;
    if (t.matches('[data-act="search"]')) {
      S.q = t.value; var pos = t.selectionStart; render();
      var s = root.querySelector('[data-act="search"]'); if (s) { s.focus(); try { s.setSelectionRange(pos, pos); } catch (e) {} }
    } else if (t.matches('[data-act="notes"]')) S.notes = t.value;
    else if (t.matches('.rbp-q input') && !t.readOnly) {
      var q = t.closest('.rbp-q'), w = q.getAttribute('data-w'), p = q.getAttribute('data-p');
      setQty(w, p, t.value.replace(/\D/g, '')); refreshNumbers(w, p);
    }
  });
  root.addEventListener('change', function (ev) {
    var t = ev.target;
    if (t.matches('.rbp-q input') && !t.readOnly) { var q = t.closest('.rbp-q'); t.value = qty(q.getAttribute('data-w'), q.getAttribute('data-p')) || ''; }
  });
  root.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' && ev.target.matches('.rbp-q input')) { ev.preventDefault(); ev.target.blur(); } });

  // Re-draw when crossing the phone/desktop width (keeps the cart).
  var wasPhone = phone();
  window.addEventListener('resize', function () { hdrHeight(); var now = phone(); if (now !== wasPhone) { wasPhone = now; if (now) { var keep = Object.keys(S.open)[0]; S.open = {}; if (keep) S.open[keep] = true; } render(); } });
  window.addEventListener('beforeunload', function (ev) { if (S.mode === 'in' && S.screen !== 'done' && totals().u > 0) { ev.preventDefault(); ev.returnValue = ''; } });

  // ───────── start ─────────
  // Links the old portal used keep working: ?c=<contactId> (Josh's buyer links), ?acct=&email=, ?acct= alone.
  // New: ?r=<reservation>&t=<key> from the "View or change this reservation" button in the emails.
  function openReservation(id, t) {
    api({ action: 'reservation', r: id, t: t }).then(function (r) {
      if (!r || !r.ok) { S.err = 'That reservation link didn\u2019t work. Sign in, or use the link in your latest confirmation email.'; loadTeaser(); return; }
      var w = r.who, res = r.reservation;
      enter({ email: w.email, name: w.name, accounts: w.stores, internal: w.internal, keepUrl: true, then: function () {
        S.submitted = { reservation: res, t: t, viewing: true };
        S.screen = res.items.length ? 'done' : 'cancelled'; render(); window.scrollTo(0, 0);
      } });
    }).catch(function () { S.err = 'We couldn\u2019t reach our system just now. Please try again in a moment.'; loadTeaser(); });
  }

  function start() {
    var p = new URLSearchParams(location.search);
    var c = (p.get('c') || p.get('contactId') || '').trim();
    var acct = p.get('acct') || p.get('account') || '', email = (p.get('email') || '').trim().toLowerCase();
    var remembered = stored('rb_portal_email');
    render();
    if (p.get('r') && p.get('t')) { openReservation(p.get('r'), p.get('t')); return; }
    if (c) {
      api({ action: 'context', c: c }).then(function (r) {
        if (!r || !r.ok) { S.err = 'We couldn\u2019t open your account link. Enter your email to continue.'; loadTeaser(); return; }
        enter({ email: r.contact.email || '', name: ((r.contact.firstName || '') + ' ' + (r.contact.lastName || '')).trim(), accounts: r.accounts.map(function (a) { return a.tradeName; }), keepUrl: true });
      }).catch(function () { S.err = 'We couldn\u2019t open your account link. Enter your email to continue.'; loadTeaser(); });
      return;
    }
    if (email) { signInQuiet(email); return; }
    if (acct && acct !== 'Redbird') { enter({ email: '', name: p.get('contact') || '', accounts: [acct], keepUrl: true }); return; }
    if (remembered) { signInQuiet(remembered); return; }
    loadTeaser();
  }
  // Returning buyers skip the sign-in card.
  function signInQuiet(email) {
    api({ action: 'lookup', email: email }).then(function (r) {
      if (r && r.ok) enter({ email: r.email, name: r.name, accounts: r.stores, internal: !!r.internal });
      else { store('rb_portal_email', null); setUrl({}); loadTeaser(); }
    }).catch(function () { loadTeaser(); });
  }

  start();
})();
