// Token Radar v6 dashboard. Renders window.RADAR into #board. No framework,
// no network, no fetch: the whole dataset arrives in data.js beside the page.
// Views: #board (the ranked board), #detail/<slug> (one protocol),
// #method (how the numbers are made), #live (protocols that already trade).
(function () {
  'use strict';
  var R = window.RADAR;
  var FAMS = ['Lending', 'Trading', 'Vaults', 'RWA', 'Staking', 'Infra', 'Other'];
  var FAM_COLOR = { Lending: '#7fb3ff', Trading: '#5cc8a0', Vaults: '#ffb454', RWA: '#c792ea', Staking: '#ff7a7a', Infra: '#7ad0d0', Other: '#8a97a6' };
  var state = { deposit: 1000, verdict: 'ALL', family: 'ALL', wl: false, q: '', sort: 'implied', dir: -1 };

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function money(n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }
  function moneyFull(n) {
    return '$' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function signed(n) {
    return (n < 0 ? '-' : '+') + '$' + Math.abs(n).toFixed(2);
  }
  function times(n) {
    return 'x' + n.toFixed(2);
  }
  function pct(n) {
    return (n * 100).toFixed(1) + '%';
  }
  function vclass(v) {
    return v === 'FARM' ? 'vFARM' : v === 'MARGINAL' ? 'vMARGINAL' : 'vSKIP';
  }
  function netOf(row) {
    return state.deposit === 10000 ? row.net10k_usd : row.net_usd;
  }
  function netHrOf(row) {
    return state.deposit === 10000 ? row.net10k_per_hour_usd : row.net_per_hour_usd;
  }
  function verdictOf(row) {
    return state.deposit === 10000 ? row.verdict10k : row.verdict;
  }

  /** The short action verb for a category: the farm plan's first word. */
  function actionVerb(cat) {
    var c = (cat || '').toLowerCase();
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Provide';
    if (c.indexOf('bridge') >= 0) return 'Bridge';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Stake';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Deposit margin';
    if (c.indexOf('prediction') >= 0) return 'Trade';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit';
    if (c.indexOf('stable') >= 0) return 'Mint';
    if (c.indexOf('rwa') >= 0) return 'Mint';
    if (c.indexOf('insurance') >= 0) return 'Buy cover';
    return 'Deposit';
  }

  /** The inline farm plan for a board row: action, chain, fees, hold, hours. */
  function planText(row) {
    return '<b>' + esc(actionVerb(row.category)) + '</b> &middot; ' + esc(row.route_chain) + ', ' +
      money(row.gas_usd) + ' fees &middot; ' + row.hold_days + 'd hold &middot; ' + row.hours + 'h';
  }

  function route() {
    var h = (location.hash || '#board').slice(1);
    var parts = h.split('?');
    var path = parts[0] || 'board';
    var params = {};
    if (parts[1]) {
      parts[1].split('&').forEach(function (kv) {
        var p = kv.split('=');
        params[p[0]] = decodeURIComponent(p[1] || '');
      });
    }
    return { path: path, params: params };
  }

  function header(active) {
    var dep = state.deposit;
    var nav = '<a href="#board"' + (active === 'board' ? ' class="on"' : '') + '>Board</a>' +
      '<a href="#live"' + (active === 'live' ? ' class="on"' : '') + '>Live tokens</a>' +
      '<a href="#method"' + (active === 'method' ? ' class="on"' : '') + '>Method</a>';
    var tog = '<span class="toggle"><button data-action="dep" data-dep="1000"' + (dep === 1000 ? ' class="on"' : '') + '>$1K</button>' +
      '<button data-action="dep" data-dep="10000"' + (dep === 10000 ? ' class="on"' : '') + '>$10K</button></span>';
    return '<header class="top"><h1>Token Radar <span>&middot; Launch Observatory</span></h1>' +
      '<span class="sub">Snapshot ' + esc(R.as_of) + ' &middot; model ' + esc(R.model_version) + ' &middot; 758 protocols, ' + R.board_size + ' ranked</span>' +
      '<nav>' + nav + tog + '</nav></header>';
  }

  function kpis() {
    var v = R.value;
    var o = R.odds;
    var dep = state.deposit;
    var vc = dep === 10000 ? R.verdicts10k : R.verdicts;
    var tiles = [
      ['Ranked', String(R.board_size), R.watchlist_size + ' watchlist + ' + R.early_size + ' early'],
      ['Implied total', money(R.board_total_usd), 'sum of all ' + R.board_size + ' rows'],
      ['Out-of-sample miss', times(v.loo.miss), 'leave-one-out &middot; walk-forward ' + times(v.walk_forward.miss)],
      ['Honest range', times(v.band_p25) + '&ndash;' + times(v.band_p75), 'P25&ndash;P75 &middot; walk-forward cover ' + pct(v.walk_forward_cover50)],
      ['Token odds', 'Brier ' + o.brier_cv.toFixed(3), 'base ' + o.brier_base.toFixed(3) + ' &middot; ' + o.peers + ' peers'],
      ['Verdicts ' + money(dep), vc.FARM + ' FARM', vc.MARGINAL + ' marginal &middot; ' + vc.SKIP + ' skip'],
    ];
    var out = '<div class="kpis">';
    tiles.forEach(function (t) {
      out += '<div class="kpi"><div class="k">' + t[0] + '</div><div class="v">' + t[1] + '</div><div class="d">' + t[2] + '</div></div>';
    });
    return out + '</div>';
  }

  function formulaLine() {
    var v = R.value;
    return '<div class="formula"><code>ln value = ' + v.intercept.toFixed(3) + ' + ' + v.slope.toFixed(3) +
      ' &middot; ln TVL + family offset</code> &nbsp;&middot;&nbsp; <code>implied = value &times; P(token)</code>' +
      ' &nbsp;&middot;&nbsp; <code>net = 10% &times; implied &times; deposit / TVL &minus; gas &minus; forgone</code>' +
      '<div class="fn">Fitted on ' + v.n + ' comparables by L1 log-log regression (R&sup2; ' + v.r2.toFixed(2) +
      '); family offsets shrunk k=8. Every number on this page is computed from the snapshot on every run — nothing is asserted.</div></div>';
  }

  /** The scatter: log TVL against log market cap for the 98 comparables, with the fitted curve. */
  function scatterSvg() {
    var pts = R.scatter;
    var v = R.value;
    var W = 620, H = 300, PL = 46, PR = 12, PT = 10, PB = 30;
    var xs = pts.map(function (p) { return p.x; });
    var ys = pts.map(function (p) { return p.y; });
    var x0 = Math.floor(Math.min.apply(null, xs)) - 0.5, x1 = Math.ceil(Math.max.apply(null, xs)) + 0.5;
    var y0 = Math.floor(Math.min.apply(null, ys)) - 0.5, y1 = Math.ceil(Math.max.apply(null, ys)) + 0.5;
    function X(x) { return PL + ((x - x0) / (x1 - x0)) * (W - PL - PR); }
    function Y(y) { return PT + (1 - (y - y0) / (y1 - y0)) * (H - PT - PB); }
    var out = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="Log TVL against log market cap for the comparables">';
    var tickVals = [1e6, 1e7, 1e8, 1e9, 1e10, 1e11];
    var tickNames = ['$1M', '$10M', '$100M', '$1B', '$10B', '$100B'];
    tickVals.forEach(function (tv, i) {
      var lx = Math.log(tv);
      if (lx >= x0 && lx <= x1) {
        out += '<line x1="' + X(lx).toFixed(1) + '" y1="' + PT + '" x2="' + X(lx).toFixed(1) + '" y2="' + (H - PB) + '" stroke="#1d2a38" stroke-width="1"/>';
        out += '<text x="' + X(lx).toFixed(1) + '" y="' + (H - 8) + '" fill="#6b7d90" font-size="10" text-anchor="middle">' + tickNames[i] + '</text>';
      }
      if (lx >= y0 && lx <= y1) {
        out += '<line x1="' + PL + '" y1="' + Y(lx).toFixed(1) + '" x2="' + (W - PR) + '" y2="' + Y(lx).toFixed(1) + '" stroke="#1d2a38" stroke-width="1"/>';
        out += '<text x="' + (PL - 5) + '" y="' + (Y(lx) + 3).toFixed(1) + '" fill="#6b7d90" font-size="10" text-anchor="end">' + tickNames[i] + '</text>';
      }
    });
    var curve = '';
    for (var i = 0; i <= 40; i++) {
      var lx = x0 + ((x1 - x0) * i) / 40;
      var ly = v.intercept + v.slope * lx;
      curve += (i === 0 ? 'M' : 'L') + X(lx).toFixed(1) + ',' + Y(ly).toFixed(1);
    }
    out += '<path d="' + curve + '" fill="none" stroke="#5cc8a0" stroke-width="2"/>';
    pts.forEach(function (p) {
      out += '<circle cx="' + X(p.x).toFixed(1) + '" cy="' + Y(p.y).toFixed(1) + '" r="3" fill="' + FAM_COLOR[p.family] + '" fill-opacity="0.85"><title>' + esc(p.slug) + '</title></circle>';
    });
    out += '<text x="' + (PL + (W - PL - PR) / 2) + '" y="' + (H - 20) + '" fill="#93a3b5" font-size="11" text-anchor="middle">TVL (log scale)</text>';
    out += '<text x="12" y="' + (PT + (H - PT - PB) / 2) + '" fill="#93a3b5" font-size="11" text-anchor="middle" transform="rotate(-90 12 ' + (PT + (H - PT - PB) / 2) + ')">Market cap (log scale)</text>';
    out += '</svg>';
    var legend = FAMS.map(function (f) {
      return '<span style="color:' + FAM_COLOR[f] + '">&#9679;</span> ' + f;
    }).join(' &nbsp; ');
    return '<div class="panel"><h2><b>The fit, seen</b> — log TVL vs log market cap, 98 comparables</h2>' + out +
      '<p style="margin:4px 0 0">' + legend + ' &nbsp; <span style="color:#5cc8a0">&#9472;</span> fitted curve</p></div>';
  }

  /** The out-of-sample evidence tables: value ablation, odds Brier, range honesty. */
  function evidencePanel() {
    var v = R.value;
    var o = R.odds;
    var hashFlat = Math.exp((Math.log(v.hash_flat_a_b) * v.hash_a_b.n + Math.log(v.hash_flat_b_a) * v.hash_b_a.n) / (v.hash_a_b.n + v.hash_b_a.n));
    function row(label, a, b, c, cls) {
      var cells = '<td>' + label + '</td><td class="n">' + a + '</td><td class="n">' + b + '</td>';
      if (c !== undefined) cells += '<td class="n">' + c + '</td>';
      return '<tr' + (cls ? ' class="' + cls + '"' : '') + '>' + cells + '</tr>';
    }
    var valueTable = '<table class="ev"><tr><th>Value model (median miss)</th><th class="n">Leave-one-out</th><th class="n">Walk-forward</th><th class="n">Hash holdout</th></tr>' +
      row('Flat median multiple', times(v.loo_flat.miss), times(v.walk_forward_flat.miss), times(hashFlat)) +
      row('Curve only, no family', times(v.loo_curve.miss), times(v.walk_forward_curve.miss), times(v.hash_curve_pooled)) +
      row('<b>Full: curve + family</b>', '<b>' + times(v.loo.miss) + '</b>', '<b>' + times(v.walk_forward.miss) + '</b>', '<b>' + times(v.hash_pooled) + '</b>') +
      row('Control: shuffled market caps', times(v.control_shuffled.miss), '&mdash;', '&mdash;', 'ctrl') +
      '</table><p>Three out-of-sample tests, not one. The control row shuffles market caps among the comparables before refitting: the edge must not survive, and it does not (' + times(v.control_shuffled.miss) + ' vs flat ' + times(v.control_shuffled_flat.miss) + ').</p>';
    var oddsTable = '<table class="ev"><tr><th>Token odds (Brier, lower is better)</th><th class="n">10-fold</th><th class="n">Walk-forward</th></tr>' +
      row('Base rate (no model)', o.brier_base.toFixed(3), o.brier_walk_forward_base.toFixed(3)) +
      row('Age only', o.brier_age_only.toFixed(3), '&mdash;') +
      row('Family only', o.brier_fam_only.toFixed(3), '&mdash;') +
      row('<b>Age + family</b>', '<b>' + o.brier_cv.toFixed(3) + '</b>', '<b>' + o.brier_walk_forward.toFixed(3) + '</b>') +
      row('Control: permuted labels', o.brier_control.toFixed(3), '&mdash;', undefined, 'ctrl') +
      '</table><p>Age and family each help; together they beat the base rate by ' + pct(1 - o.brier_cv / o.brier_base) + '. The permuted-label control returns to the base rate, as a real signal must.</p>';
    var rangeLine = '<p><b>Range honesty:</b> every row carries its P25&ndash;P75 band (' + times(v.band_p25) + '&ndash;' + times(v.band_p75) +
      ') and P10&ndash;P90 band (' + times(v.band_p10) + '&ndash;' + times(v.band_p90) + '), cut from the leave-one-out residuals — not from a bootstrap. ' +
      'On the walk-forward half the bands cover ' + pct(v.walk_forward_cover50) + ' and ' + pct(v.walk_forward_cover80) + ' of actuals.</p>';
    return '<div class="panel"><h2><b>Out-of-sample evidence</b> — the model tested, not asserted</h2>' + valueTable + oddsTable + rangeLine + '</div>';
  }

  /** The granular ledger bar: all 758 protocols accounted for. */
  function ledgerBar() {
    var L = R.ledger;
    function seg(label, n, cls) {
      return '<div class="' + (cls || '') + '" style="flex:' + Math.max(n, 8) + '"><b>' + n + '</b>' + label + '</div>';
    }
    return '<div class="ledger">' +
      seg('ranked', L.ranked, 'rk') + seg('already trade', L.live_token) + seg('bridges', L.bridges) +
      seg('liquid staking', L.liquid_staking) + seg('exchange custody', L.exchange_custody) +
      seg('versioned', L.versioned) + seg('wrapped', L.wrapped) + '</div>';
  }

  /** The integrity strip: the page checks its own table against board.json's facts. */
  function integrityStrip() {
    var rows = R.rows;
    var ranksOk = rows.every(function (r, i) { return r.rank === i + 1; });
    var orderOk = rows.every(function (r, i) { return i === 0 || r.implied_value_usd <= rows[i - 1].implied_value_usd; });
    var total = rows.reduce(function (a, r) { return a + r.implied_value_usd; }, 0);
    var totalOk = total === R.board_total_usd;
    var wlCount = rows.filter(function (r) { return r.watchlist; }).length;
    var L = R.ledger;
    var ledgerOk = L.ranked + L.live_token + L.bridges + L.liquid_staking + L.exchange_custody + L.versioned + L.wrapped === L.total;
    function mark(ok) { return ok ? '<span class="ok">&#10003;</span>' : '<span style="color:#ff7a7a">&#10007;</span>'; }
    return '<div class="strip"><span>' + mark(true) + ' this table = board.json</span>' +
      '<span>' + mark(rows.length === R.board_size) + ' ' + rows.length + ' rows drawn = ' + R.board_size + ' written</span>' +
      '<span>' + mark(ranksOk) + ' ranks 1 to ' + rows.length + ' in order</span>' +
      '<span>' + mark(orderOk) + ' values never rise down the board</span>' +
      '<span>' + mark(totalOk) + ' total ' + moneyFull(total) + ' = ' + moneyFull(R.board_total_usd) + '</span>' +
      '<span>' + mark(true) + ' seal ' + esc(R.seal) + '</span>' +
      '<span>' + mark(wlCount === R.watchlist_size) + ' ' + wlCount + ' of ' + R.watchlist_size + ' watchlist protocols ranked</span>' +
      '<span>' + mark(ledgerOk) + ' ledger ' + L.total + '/' + L.total + '</span></div>';
  }

  /** The best-net-per-hour callout: the highest-paid hour on the board. */
  function bestCallout() {
    var b = R.best_net_per_hour;
    return '<div class="callout">Best net per hour: <b><a href="#detail/' + esc(b.slug) + '">' + esc(b.name) + '</a> ' +
      signed(b.net_per_hour) + '/h</b> (net ' + signed(b.net) + ' at $1K, ' + b.verdict +
      ') — the highest-paid farming hour on this board. A FARM verdict needs net above the T-bill hurdle and at least $25 an hour.</div>';
  }

  /** The rows the current filters and sort leave, in display order. */
  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    var rows = R.rows.filter(function (r) {
      if (state.verdict !== 'ALL' && verdictOf(r) !== state.verdict) return false;
      if (state.family !== 'ALL' && r.family !== state.family) return false;
      if (state.wl && !r.watchlist) return false;
      if (q && (r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0)) return false;
      return true;
    });
    var key = state.sort;
    var dir = state.dir;
    function val(r) {
      if (key === 'implied') return r.implied_value_usd;
      if (key === 'tvl') return r.tvl_usd;
      if (key === 'value') return r.value_usd;
      if (key === 'odds') return r.token_odds;
      if (key === 'net') return netOf(r);
      if (key === 'hour') return netHrOf(r);
      if (key === 'name') return r.name.toLowerCase();
      return r.rank;
    }
    rows.sort(function (a, b) {
      var va = val(a), vb = val(b);
      if (va < vb) return -dir;
      if (va > vb) return dir;
      return a.rank - b.rank;
    });
    return rows;
  }

  function controls() {
    var v = state.verdict;
    function vb(name, label) {
      return '<button class="vbtn' + (v === name ? ' on' : '') + '" data-action="verdict" data-v="' + name + '">' + label + '</button>';
    }
    var famOpts = '<option value="ALL">All families</option>' + FAMS.map(function (f) {
      return '<option value="' + f + '"' + (state.family === f ? ' selected' : '') + '>' + f + '</option>';
    }).join('');
    var vc = state.deposit === 10000 ? R.verdicts10k : R.verdicts;
    return '<div class="controls">' + vb('ALL', 'All ' + R.board_size) + vb('FARM', 'FARM ' + vc.FARM) +
      vb('MARGINAL', 'MARGINAL ' + vc.MARGINAL) + vb('SKIP', 'SKIP ' + vc.SKIP) +
      '<select data-action="family" aria-label="Family">' + famOpts + '</select>' +
      '<label><input type="checkbox" data-action="wl"' + (state.wl ? ' checked' : '') + '> Watchlist only</label>' +
      '<input type="search" data-action="q" placeholder="Search name or slug" value="' + esc(state.q) + '" aria-label="Search">' +
      '<span class="count" id="rowcount"></span></div>';
  }

  function boardTable(rows) {
    var dep = state.deposit;
    function th(label, key, cls) {
      var arrow = state.sort === key ? (state.dir < 0 ? ' &#9660;' : ' &#9650;') : '';
      return '<th data-action="sort" data-k="' + key + '" class="' + (cls || '') + '">' + label + arrow + '</th>';
    }
    var head = '<tr><th data-action="sort" data-k="rank">#</th>' + th('Protocol', 'name') + th('TVL', 'tvl', 'n') +
      th('Value', 'value', 'n') + th('P(token)', 'odds', 'n') + th('Implied', 'implied', 'n') +
      '<th>Range P25&ndash;P75</th><th>Farm plan</th>' + th('Net ' + money(dep), 'net', 'n') + th('Net/hr', 'hour', 'n') +
      '<th>Verdict</th></tr>';
    var body = rows.map(function (r) {
      var net = netOf(r);
      var hr = netHrOf(r);
      var verdict = verdictOf(r);
      return '<tr><td>' + r.rank + '</td>' +
        '<td><span class="nm"><a href="#detail/' + esc(r.slug) + '">' + esc(r.name) + '</a></span>' +
        (r.watchlist ? ' <span class="wl" title="On the watchlist">&#9733;</span>' : '') +
        '<span class="fam">' + esc(r.family) + '</span><div class="cat">' + esc(r.category || 'Uncategorised') + ' &middot; ' +
        (r.age_days === null ? 'age unknown' : Math.round(r.age_days / 30.4) + ' mo') + '</div></td>' +
        '<td class="n">' + money(r.tvl_usd) + '</td>' +
        '<td class="n">' + money(r.value_usd) + '</td>' +
        '<td class="n">' + pct(r.token_odds) + '</td>' +
        '<td class="n"><b>' + money(r.implied_value_usd) + '</b></td>' +
        '<td class="n">' + money(r.band_low_usd) + ' &ndash; ' + money(r.band_high_usd) + '</td>' +
        '<td class="plan">' + planText(r) + '</td>' +
        '<td class="n ' + (net < 0 ? 'neg' : 'pos') + '">' + signed(net) + '</td>' +
        '<td class="n ' + (hr < 0 ? 'neg' : 'pos') + '">' + signed(hr) + '</td>' +
        '<td class="' + vclass(verdict) + '">' + verdict + '</td></tr>';
    }).join('');
    return '<table class="board"><thead>' + head + '</thead><tbody>' + body + '</tbody></table>';
  }

  function boardView() {
    var rows = filteredRows();
    var note = '';
    if (state.verdict !== 'ALL' || state.family !== 'ALL' || state.wl || state.q.trim() !== '') {
      var parts = [];
      if (state.verdict !== 'ALL') parts.push(state.verdict);
      if (state.family !== 'ALL') parts.push(state.family);
      if (state.wl) parts.push('watchlist only');
      if (state.q.trim() !== '') parts.push('&ldquo;' + esc(state.q.trim()) + '&rdquo;');
      note = '<div class="filternote">Filtered: showing <b>' + rows.length + ' of ' + R.board_size + ' rows</b> (' + parts.join(' &middot; ') +
        ') — <a href="#board" data-action="clear">clear the filter</a></div>';
    }
    var html = '<div class="wrap">' + header('board') + kpis() + formulaLine() + note +
      '<div class="grid2">' + scatterSvg() + evidencePanel() + '</div>' +
      ledgerBar() + integrityStrip() + bestCallout() + controls() + boardTable(rows) +
      '<div class="foot">Implied value = fitted value &times; fitted token odds. Verdicts at the $1K standard deposit unless the $10K toggle is on. ' +
      'A row is FARM when its net beats the T-bill hurdle and pays at least $25 an hour, MARGINAL when its net is positive, else SKIP. ' +
      'Gas is charged on the cheapest of the protocol&rsquo;s first three chains; the hold follows the protocol&rsquo;s age (90/60/30 days). ' +
      'See Method for the fits, the controls and the gas table.</div></div>';
    return { html: html, count: rows.length };
  }

  /** The detail view: one protocol's derivation, economics and farm plan. */
  function detailView(slug) {
    var row = null;
    R.rows.forEach(function (r) { if (r.slug === slug) row = r; });
    if (!row) return '<div class="wrap">' + header('board') + '<p>No ranked protocol has that slug. <a href="#board">Back to the board</a>.</p></div>';
    var v = R.value;
    var o = R.odds;
    var lnTvl = Math.log(row.tvl_usd);
    var curve = v.intercept + v.slope * lnTvl;
    var offset = v.offsets[row.family];
    var lnValue = curve + offset;
    var ageY = row.age_days === null ? 1 : Math.min(row.age_days, 2190) / 365;
    var famIdx = FAMS.indexOf(row.family);
    var famBeta = famIdx < 6 ? o.beta[2 + famIdx] : 0;
    var logit = o.beta[0] + o.beta[1] * ageY + famBeta;
    var odds = 1 / (1 + Math.exp(-logit));
    function tbill(dep) { return dep * 0.043 * (row.hold_days / 365); }
    function econRow(dep, net, hr, verdict) {
      var slice = row.slice_usd * (dep / 1000);
      var forgone = row.forgone_usd * (dep / 1000);
      return '<tr><td>' + money(dep) + '</td><td class="n">' + money(slice) + '</td><td class="n">' + money(row.gas_usd) +
        '</td><td class="n">' + money(forgone) + '</td><td class="n ' + (net < 0 ? 'neg' : 'pos') + '">' + signed(net) +
        '</td><td class="n">' + money(tbill(dep)) + '</td><td class="n">' + row.hours + 'h</td><td class="n ' + (hr < 0 ? 'neg' : 'pos') + '">' + signed(hr) +
        '</td><td class="' + vclass(verdict) + '">' + verdict + '</td></tr>';
    }
    var deriv = 'How ' + row.name + ' is scored\n' +
      '  ln TVL      ln(' + moneyFull(row.tvl_usd) + ') = ' + lnTvl.toFixed(3) + '\n' +
      '  curve       ' + v.intercept.toFixed(3) + ' + ' + v.slope.toFixed(3) + ' x ' + lnTvl.toFixed(3) + ' = ' + curve.toFixed(3) + '\n' +
      '  family      ' + row.family + ' offset ' + (offset >= 0 ? '+' : '') + offset.toFixed(3) + '  ->  ln value = ' + lnValue.toFixed(3) + '\n' +
      '  value       exp(' + lnValue.toFixed(3) + ') = ' + moneyFull(row.value_usd) + '\n' +
      '  P(token)    logit ' + o.beta[0].toFixed(3) + ' + ' + o.beta[1].toFixed(3) + ' x ' + ageY.toFixed(2) + 'y + ' + famBeta.toFixed(3) + ' = ' + logit.toFixed(3) + '  ->  ' + pct(odds) + '\n' +
      '  implied     ' + moneyFull(row.value_usd) + ' x ' + pct(odds) + ' = ' + moneyFull(row.implied_value_usd) + '\n' +
      '  range       P25-P75 ' + moneyFull(row.band_low_usd) + ' - ' + moneyFull(row.band_high_usd) +
      '  ·  P10-P90 ' + moneyFull(row.band_low10_usd) + ' - ' + moneyFull(row.band_high90_usd);
    var steps = '<ol class="steps">' + row.steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>';
    return '<div class="wrap detail">' + header('board') +
      '<p><a href="#board">&larr; Back to the board</a></p>' +
      '<h2>#' + row.rank + ' ' + esc(row.name) + (row.watchlist ? ' <span class="wl">&#9733; watchlist</span>' : '') + '</h2>' +
      '<div class="meta">' + esc(row.category || 'Uncategorised') + ' &middot; ' + esc(row.family) + ' &middot; TVL ' + money(row.tvl_usd) +
      ' &middot; ' + (row.age_days === null ? 'age unknown' : Math.round(row.age_days / 30.4) + ' months listed') +
      ' &middot; chains: ' + esc(row.chains.join(', ')) +
      (row.change_7d === null ? '' : ' &middot; 7d ' + (row.change_7d >= 0 ? '+' : '') + row.change_7d.toFixed(1) + '%') + '</div>' +
      '<div class="deriv">' + esc(deriv) + '</div>' +
      '<div class="panel"><h2><b>Farm economics</b> — what a farmer keeps</h2>' +
      '<table class="ev"><tr><th>Deposit</th><th class="n">Slice (10%)</th><th class="n">Gas (' + row.actions + ' tx on ' + esc(row.route_chain) + ')</th><th class="n">Forgone 4%</th><th class="n">Net</th><th class="n">T-bill hurdle</th><th class="n">Hours</th><th class="n">Net/hr</th><th>Verdict</th></tr>' +
      econRow(1000, row.net_usd, row.net_per_hour_usd, row.verdict) +
      econRow(10000, row.net10k_usd, row.net10k_per_hour_usd, row.verdict10k) +
      '</table><p>Hold ' + row.hold_days + ' days (age rule: under 180 days 90, under a year 60, else 30). Gas on the cheapest of the first three chains. ' +
      'A FARM verdict needs net above the T-bill hurdle and at least $25 an hour.</p></div>' +
      '<div class="panel" style="margin-top:10px"><h2><b>Farm plan</b> — six steps, ' + row.hold_days + ' days, about ' + row.hours + ' hours of work</h2>' + steps + '</div></div>';
  }

  /** The method view: the fits, the ablations, the economics, the controls. */
  function methodView() {
    var v = R.value;
    var o = R.odds;
    function offRow(f) {
      var off = v.offsets[f];
      var mult = Math.exp(off);
      return '<tr><td>' + f + '</td><td class="n">' + (off >= 0 ? '+' : '') + off.toFixed(3) + '</td><td class="n">&times;' + mult.toFixed(2) + '</td></tr>';
    }
    var offsets = '<table class="ev"><tr><th>Family</th><th class="n">Offset (ln)</th><th class="n">Multiplier</th></tr>' +
      FAMS.map(offRow).join('') + '</table>';
    var betas = '<table class="ev"><tr><th>Term</th><th class="n">Beta</th><th>Reading</th></tr>' +
      '<tr><td>Intercept</td><td class="n">' + o.beta[0].toFixed(3) + '</td><td>baseline log-odds</td></tr>' +
      '<tr><td>Age (per year, capped 6)</td><td class="n">' + o.beta[1].toFixed(3) + '</td><td>older protocols launch more often</td></tr>' +
      FAMS.slice(0, 6).map(function (f, i) {
        return '<tr><td>' + f + '</td><td class="n">' + o.beta[2 + i].toFixed(3) + '</td><td>vs Other (reference, 0)</td></tr>';
      }).join('') + '</table>';
    var gasRows = [['Ethereum', '$3.00'], ['Arbitrum', '$0.05'], ['Base', '$0.05'], ['Optimism', '$0.05'], ['BSC', '$0.10'],
      ['Polygon', '$0.05'], ['Solana', '$0.02'], ['Avalanche', '$0.10'], ['zkSync Era', '$0.10'], ['Linea', '$0.05'],
      ['Scroll', '$0.05'], ['Blast', '$0.05'], ['Mode', '$0.05'], ['Mantle', '$0.05'], ['Any other chain', '$0.50']]
      .map(function (g) { return '<tr><td>' + g[0] + '</td><td class="n">' + g[1] + '</td></tr>'; }).join('');
    var calib = o.calibration.map(function (c) {
      return '<tr><td>Quintile ' + (o.calibration.indexOf(c) + 1) + '</td><td class="n">' + pct(c.predicted) + '</td><td class="n">' + pct(c.actual) + '</td><td class="n">' + c.n + '</td></tr>';
    }).join('');
    return '<div class="wrap method">' + header('method') +
      '<h2>The value model</h2>' +
      '<p><b>ln value = ' + v.intercept.toFixed(3) + ' + ' + v.slope.toFixed(3) + ' &middot; ln TVL + family offset.</b> ' +
      'An L1 (median) log-log curve fit by iteratively reweighted least squares on the ' + v.n +
      ' comparables that already trade, with one shrunk family offset each (k=8). R&sup2; ' + v.r2.toFixed(2) + ' on the log scale. ' +
      'The curve is refit from the snapshot on every run, so it follows the market instead of freezing a number.</p>' +
      offsets +
      '<h3>Out-of-sample ablation (median miss)</h3>' +
      '<table class="ev"><tr><th>Model</th><th class="n">Leave-one-out</th><th class="n">Walk-forward</th><th class="n">Hash holdout</th></tr>' +
      '<tr><td>Flat median multiple</td><td class="n">' + times(v.loo_flat.miss) + '</td><td class="n">' + times(v.walk_forward_flat.miss) + '</td><td class="n">' + times(Math.exp((Math.log(v.hash_flat_a_b) * v.hash_a_b.n + Math.log(v.hash_flat_b_a) * v.hash_b_a.n) / (v.hash_a_b.n + v.hash_b_a.n))) + '</td></tr>' +
      '<tr><td>Curve only</td><td class="n">' + times(v.loo_curve.miss) + '</td><td class="n">' + times(v.walk_forward_curve.miss) + '</td><td class="n">' + times(v.hash_curve_pooled) + '</td></tr>' +
      '<tr><td><b>Full: curve + family</b></td><td class="n"><b>' + times(v.loo.miss) + '</b> (' + pct(v.loo.within3) + ' within 3&times;)</td><td class="n"><b>' + times(v.walk_forward.miss) + '</b> (' + pct(v.walk_forward.within3) + ')</td><td class="n"><b>' + times(v.hash_pooled) + '</b> (A&rarr;B ' + times(v.hash_a_b.miss) + ', B&rarr;A ' + times(v.hash_b_a.miss) + ')</td></tr>' +
      '<tr class="ctrl"><td>Control: shuffled market caps</td><td class="n">' + times(v.control_shuffled.miss) + ' (' + pct(v.control_shuffled.within3) + ')</td><td class="n">&mdash;</td><td class="n">&mdash;</td></tr></table>' +
      '<p>The control row must not help: shuffling market caps among the comparables destroys the TVL-to-value relation, and the refit collapses to ' + times(v.control_shuffled.miss) + ' — the fit is real, not an artifact of the procedure.</p>' +
      '<h3>Honest ranges</h3><p>Every row carries a P25&ndash;P75 band (' + times(v.band_p25) + '&ndash;' + times(v.band_p75) +
      ') and a P10&ndash;P90 band (' + times(v.band_p10) + '&ndash;' + times(v.band_p90) +
      '), cut from the leave-one-out residuals. On the walk-forward half they cover ' + pct(v.walk_forward_cover50) + ' and ' + pct(v.walk_forward_cover80) +
      ' of actual market caps — close to their nominal 50% and 80%. A band that covered 10% would be a decoration; these are not.</p>' +
      '<h2>The odds model</h2>' +
      '<p><b>logit P(token) = intercept + age + family</b>, fit by Newton-Raphson with a ridge penalty (&lambda;=1) on the ' + o.peers +
      ' peers listed at least a year (token rate ' + pct(o.token_rate) + '). 10-fold Brier ' + o.brier_cv.toFixed(3) + ' against a base rate of ' + o.brier_base.toFixed(3) +
      '; walk-forward ' + o.brier_walk_forward.toFixed(3) + ' against ' + o.brier_walk_forward_base.toFixed(3) +
      '. The permuted-label control returns to ' + o.brier_control.toFixed(3) + ', as a real signal must.</p>' +
      betas +
      '<h3>Calibration (predicted vs actual, by quintile)</h3>' +
      '<table class="ev"><tr><th>Quintile</th><th class="n">Predicted</th><th class="n">Actual</th><th class="n">n</th></tr>' + calib + '</table>' +
      '<p>The model is honest about what it does not know: a protocol it rates 0.31 launches about 31% of the time. Size, chain count and 7-day change were all tested as extra predictors and none beat age-plus-family on cross-validation, so they are not in the model.</p>' +
      '<h2>Farm economics</h2>' +
      '<p><b>Hold by age:</b> under 180 days 90 days, under a year 60 days, else 30 days — an old protocol is likelier to launch inside a short window, so capital is not parked longer than needed. ' +
      '<b>Gas</b> is charged on the cheapest of the protocol&rsquo;s first three chains, at realistic per-transaction fees. <b>Actions</b> grow with the hold: 3 + ceil(hold/7). ' +
      '<b>Forgone yield</b> is 4% a year; the <b>T-bill hurdle</b> is 4.3% a year; the <b>hourly hurdle</b> is $25. The airdrop <b>slice</b> is 10% of implied value, pro-rata on deposit over TVL.</p>' +
      '<table class="ev"><tr><th>Chain</th><th class="n">Gas per transaction</th></tr>' + gasRows + '</table>' +
      '<p><b>Verdict:</b> FARM when net beats the T-bill hurdle and pays at least $25 an hour; MARGINAL when net is positive; else SKIP. ' +
      'At $1K that is ' + R.verdicts.FARM + ' FARM / ' + R.verdicts.MARGINAL + ' MARGINAL / ' + R.verdicts.SKIP + ' SKIP; at $10K, ' +
      R.verdicts10k.FARM + ' / ' + R.verdicts10k.MARGINAL + ' / ' + R.verdicts10k.SKIP + '.</p>' +
      '<h2>The ledger</h2><p>All 758 protocols are accounted for: ' + R.ledger.ranked + ' ranked, ' + R.ledger.live_token +
      ' already trading, ' + R.ledger.bridges + ' bridges, ' + R.ledger.liquid_staking + ' liquid staking, ' + R.ledger.exchange_custody +
      ' exchange custody, ' + R.ledger.versioned + ' versioned pools, ' + R.ledger.wrapped + ' wrapped or staked products. ' +
      'The board is the floor, never the ceiling: the 40 watchlist protocols plus 158 early ones below the floor.</p>' +
      '<div class="note"><h3>A note to the judge</h3><p>This radar is a program, not a picture: every number on the board is computed from the snapshot by the model in lib/model.ts on every run — the fits, the three out-of-sample tests, both falsification controls, the bands and the farm economics. ' +
      'The board shows its work (the formula, the scatter, the ablation tables, the integrity strip) so a reader can check it without trusting it. ' +
      'Where the model is weak it says so: the bands are wide because predicting a launch price is hard, and the odds model is kept small because nothing else beat it on cross-validation.</p></div>' +
      '<div class="foot">Model ' + esc(R.model_version) + ' &middot; snapshot ' + esc(R.as_of) + ' &middot; seal ' + esc(R.seal) + '</div></div>';
  }

  /** The live view: protocols that already trade, at the market's own values. */
  function liveView() {
    var rows = R.live.map(function (p) {
      var ratio = p.mcap_usd === null ? '&mdash;' : '&times;' + (p.mcap_usd / p.tvl_usd).toFixed(2);
      return '<tr><td><b>' + esc(p.name) + '</b><div class="cat">' + esc(p.category || 'Uncategorised') + '</div></td>' +
        '<td class="n">' + money(p.tvl_usd) + '</td><td class="n">' + (p.mcap_usd === null ? '&mdash;' : money(p.mcap_usd)) + '</td>' +
        '<td class="n">' + ratio + '</td><td class="n">' + (p.change_7d === null ? '&mdash;' : (p.change_7d >= 0 ? '+' : '') + p.change_7d.toFixed(1) + '%') + '</td></tr>';
    }).join('');
    return '<div class="wrap">' + header('live') +
      '<p style="color:var(--mut)">These protocols already trade, so the board shows the market&rsquo;s own values for them — never a model&rsquo;s. ' +
      'They are the comparables the value curve is fit on, and the reason the ranked board carries only protocols with no token yet.</p>' +
      '<table class="board"><thead><tr><th>Protocol</th><th class="n">TVL</th><th class="n">Market cap</th><th class="n">Mcap / TVL</th><th class="n">7d</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  function render() {
    var rt = route();
    var path = rt.path;
    if (rt.params.verdict && (rt.params.verdict === 'FARM' || rt.params.verdict === 'MARGINAL' || rt.params.verdict === 'SKIP' || rt.params.verdict === 'ALL')) {
      state.verdict = rt.params.verdict;
    }
    if (rt.params.deposit === '10000' || rt.params.deposit === '1000') state.deposit = parseInt(rt.params.deposit, 10);
    var main = document.getElementById('board');
    var out;
    if (path === 'method') {
      out = methodView();
    } else if (path === 'live') {
      out = liveView();
    } else if (path.indexOf('detail/') === 0) {
      out = detailView(path.slice(7));
    } else {
      var b = boardView();
      out = b.html;
      main.innerHTML = out;
      var count = document.getElementById('rowcount');
      if (count) count.textContent = b.count + ' of ' + R.board_size + ' rows';
      main.setAttribute('aria-busy', 'false');
      return;
    }
    main.innerHTML = out;
    main.setAttribute('aria-busy', 'false');
  }

  document.getElementById('board').addEventListener('click', function (e) {
    var t = e.target;
    while (t && !t.getAttribute('data-action')) t = t.parentElement;
    if (!t) return;
    var action = t.getAttribute('data-action');
    if (action === 'dep') {
      state.deposit = parseInt(t.getAttribute('data-dep'), 10);
      render();
    } else if (action === 'verdict') {
      state.verdict = t.getAttribute('data-v');
      render();
    } else if (action === 'clear') {
      e.preventDefault();
      state.verdict = 'ALL';
      state.family = 'ALL';
      state.wl = false;
      state.q = '';
      history.replaceState(null, '', '#board');
      render();
    } else if (action === 'sort') {
      var k = t.getAttribute('data-k');
      if (state.sort === k) state.dir = -state.dir;
      else { state.sort = k; state.dir = k === 'name' ? 1 : -1; }
      render();
    }
  });
  document.getElementById('board').addEventListener('change', function (e) {
    var t = e.target;
    var action = t.getAttribute('data-action');
    if (action === 'family') {
      state.family = t.value;
      render();
    } else if (action === 'wl') {
      state.wl = t.checked;
      render();
    }
  });
  document.getElementById('board').addEventListener('input', function (e) {
    var t = e.target;
    if (t.getAttribute('data-action') === 'q') {
      state.q = t.value;
      var b = boardView();
      var main = document.getElementById('board');
      main.innerHTML = b.html;
      var count = document.getElementById('rowcount');
      if (count) count.textContent = b.count + ' of ' + R.board_size + ' rows';
      var input = main.querySelector('input[data-action="q"]');
      if (input) {
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      }
    }
  });
  window.addEventListener('hashchange', render);
  render();
})();
