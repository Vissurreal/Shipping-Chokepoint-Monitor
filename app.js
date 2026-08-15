/* ============================================================
   Seaborne Chokepoint Command Center
   Live data: straits.live /status  (keyless, CORS-enabled)
   Sources aggregated there: IMF PortWatch · EIA · Lloyd's JWC · Kalshi/Polymarket
   ============================================================ */

'use strict';

const STATUS_URL = 'https://straits.live/status';
const CHOKE_URL = 'https://straits.live/api/v1/chokepoints';
const REFRESH_MS = 90 * 1000;

async function fetchJson(url, ms = 12000) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } finally { clearTimeout(to); }
}

/* /status chokepoints omit the per-vessel-type split; the dedicated
   endpoint carries nTanker/nCargo/previousNTotal. Merge it in when available. */
function mergeChokepoints(status, chokeData) {
  if (!chokeData || !Array.isArray(chokeData.chokepoints)) return;
  const byKey = {};
  chokeData.chokepoints.forEach(c => { byKey[c.key] = c; });
  (status.chokepoints || []).forEach(c => {
    const rich = byKey[c.key];
    if (rich) {
      if (c.nTanker == null) c.nTanker = rich.nTanker;
      if (c.nCargo == null) c.nCargo = rich.nCargo;
      if (c.previousNTotal == null) c.previousNTotal = rich.previousNTotal;
    }
  });
}

/* --- Geography + framing for each chokepoint --------------------------------
   mode 'flow'    = lower throughput than baseline is BAD (supply artery)
   mode 'reroute' = higher throughput than baseline is a STRESS signal
                    (traffic diverting the long way around Africa)            */
const GEO = {
  'hormuz':        { lat: 26.57, lng: 56.25, mode: 'flow',    labelOff: [10, -6] },
  'bab-el-mandeb': { lat: 12.58, lng: 43.33, mode: 'flow',    labelOff: [10, -6] },
  'suez':          { lat: 30.02, lng: 32.55, mode: 'flow',    labelOff: [10, -6] },
  'malacca':       { lat:  2.50, lng: 101.3, mode: 'flow',    labelOff: [10, -6] },
  'cape':          { lat: -34.36, lng: 18.47, mode: 'reroute', labelOff: [10, -6] },
};

/* --- Curated PRE-CRISIS baseline: the steady state IMMEDIATELY BEFORE the
   Feb 2026 Hormuz crisis (i.e. early-2026 "recent normal"), used as the
   denominator for % of normal. Daily transit calls, all vessel types.

   The straits.live / PortWatch baseline field is unreliable (returns ~73–83 for
   Hormuz where the real figure is ~90–100). Values here are sourced and reflect
   the last steady state before the current crisis:
     hormuz 94  – IMF PortWatch pre-crisis baseline (~90–100/day; ~94 cited)
     suez   40  – early-2026 Houthi-era level (~60% below the 2023 ~72/day)
     bab    35  – early-2026 Houthi-era level (~half of pre-Houthi 60–70/day)
     malacca 225 – unaffected; ~94,000 transits/yr (~210–257/day)
     cape   90  – early-2026 level, already elevated by 2024–25 Red Sea diversions

   NOTE: for Suez/Bab/Cape this is the *recent* (Houthi-era) normal, NOT true
   peacetime — so their % reflects change driven by the Hormuz crisis on top of
   the pre-existing Red Sea disruption. Hormuz (unaffected by the Red Sea crisis)
   keeps its genuine ~94/day peacetime figure.   */
const BASELINE = {
  'hormuz': 94,
  'suez': 40,
  'bab-el-mandeb': 35,
  'malacca': 225,
  'cape': 90,
};

/* SPR structural/statutory floor (million barrels). 238 Mbbl is the level
   current legislation allows the reserve to fall to (below which further
   drawdown needs special authorization) — the nearest defensible "hard floor"
   short of physical cavern-integrity limits, which have no single public number. */
const SPR_FLOOR_MBBL = 238;
const SPR_CAPACITY_MBBL = 714;

/* Dashed "the long way round Africa" reroute path (decorative context). */
const REROUTE_PATH = [
  [12.58, 43.33],   // Bab el-Mandeb
  [11.0, 51.3],     // Horn of Africa
  [-4.0, 39.7],     // East Africa coast
  [-26.0, 33.0],    // Mozambique channel
  [-34.36, 18.47],  // Cape of Good Hope
  [-14.0, 5.0],     // West Africa (northbound)
  [14.0, -17.5],    // Dakar
  [35.0, -9.5],     // Gibraltar approach
];

/* Bypass-pipeline routes (approx. paths) that move crude AROUND the chokepoints,
   keyed by the straits.live pipeline id. `out` marks the outlet that bypasses
   the strait (used for the terminus label). */
const PIPELINE_GEO = {
  'petroline':  { path: [[25.35, 49.57], [25.10, 44.00], [24.09, 38.06]], short: 'Petroline', out: 'Yanbu (Red Sea)' },      // bypasses Hormuz
  'adcop':      { path: [[23.75, 53.75], [24.60, 55.40], [25.33, 56.36]], short: 'ADCOP', out: 'Fujairah (Gulf of Oman)' },  // bypasses Hormuz
  'goreh-jask': { path: [[29.35, 50.85], [27.50, 54.50], [25.64, 57.77]], short: 'Goreh–Jask', out: 'Jask (Gulf of Oman)' }, // bypasses Hormuz
};

/* ---------------------------------------------------------------------------
   Baked-in fallback so the dashboard renders even with no network.
   Captured from straits.live /status (2026-07-08). Live fetch overrides it.
--------------------------------------------------------------------------- */
const FALLBACK = {
  _fallbackDate: '2026-07-08',
  verdict: { status: 'closed', long: 'The Strait of Hormuz is effectively closed to commercial shipping.', basis: 'carriers' },
  asOf: '2026-07-08T01:57:11.492Z',
  hormuzIndex: {
    crisisPressure: { value: 90, band: 'extreme', delta24h: 1 },
    escalationProbability: { value: 65, band: 'high', delta24h: -2 },
  },
  transits: { count: 34, baseline: 83, throughputPct: 41, asOfDate: '2026-07-05', provisional: false },
  dailyTransits: { date: '2026-07-05', nTotal: 34, nTanker: 17, nCargo: 17, capacity: 1140248, previousNTotal: 25, previousDate: '2026-07-04', preCrisisBaselineMedian: 83 },
  transitsBaseline: { median: 89, mean: 130.61, p10: 19, p90: 239 },
  stranded: 817,
  brent: 76.13, wti: 72.42, change24h: 5.55, change24hUsd: 4.23, oilAsOf: '2026-07-08T00:12:34.274Z',
  insurance: { multiple: 8, vlccPremiumLow: 125000, vlccPremiumHigh: 2500000,
    withdrawnClubs: ['Gard', 'Skuld', 'North Standard', 'London P&I Club', 'American Club', 'Steamship Mutual'],
    sourceName: "Lloyd's Joint War Committee", updatedAt: '2026-07-05T12:00:27.498Z' },
  tradeImpact: { worldOilAtRiskPct: 21, worldLngAtRiskPct: 25, dailyEconomicCostUsd: 4000000000,
    topAffectedCountries: ['South Korea', 'Japan', 'India', 'China', 'EU'], alternativeRouteExtraDays: 14 },
  carrierSuspensions: [
    { carrier: 'MSC', status: 'rerouting', surchargeUsdPerTeu: 1200, vesselsTrapped: 15, trappedTeu: 109000, since: '2026-03-04T00:00:00.000Z' },
  ],
  pipelineBypass: [
    { name: 'Petroline (East-West Pipeline)', originCountry: 'Saudi Arabia', terminus: 'Yanbu (Red Sea)', capacityBpd: 5000000, currentUtilizationPct: 95, status: 'operational' },
  ],
  spr: { currentMbbl: 325.65, change4wMbbl: -31.46, asOfDate: '2026-06-26' },
  gas: { nationalAvgUsd: 3.82 },
  chokepoints: [
    { key: 'hormuz', label: 'Strait of Hormuz', date: '2026-07-05', nTotal: 34, nTanker: 17, nCargo: 17, previousNTotal: 25, deltaDay: 9, preCrisisBaselineMedian: 73, baselineMedian: 15 },
    { key: 'malacca', label: 'Strait of Malacca', date: '2026-07-05', nTotal: 235, nTanker: 77, nCargo: 158, previousNTotal: 241, deltaDay: -6, preCrisisBaselineMedian: 238.5, baselineMedian: 225.5 },
    { key: 'bab-el-mandeb', label: 'Bab el-Mandeb', date: '2026-07-05', nTotal: 34, nTanker: 13, nCargo: 21, previousNTotal: 31, deltaDay: 3, preCrisisBaselineMedian: 34, baselineMedian: 36.5 },
    { key: 'suez', label: 'Suez Canal', date: '2026-07-05', nTotal: 46, nTanker: 20, nCargo: 26, previousNTotal: 41, deltaDay: 5, preCrisisBaselineMedian: 40, baselineMedian: 40.5 },
    { key: 'cape', label: 'Cape of Good Hope', date: '2026-07-05', nTotal: 115, nTanker: 19, nCargo: 96, previousNTotal: 68, deltaDay: 47, preCrisisBaselineMedian: 86, baselineMedian: 96 },
  ],
  hormuzSnapshot: { inPortTotal: 589, expectedTotal: 228, transitsLast24h: 516 },
  capeSnapshot: { inPortTotal: 245, expectedTotal: 178, transitsLast24h: 84 },
  predictionMarkets: [
    { venue: 'polymarket', question: 'Strait of Hormuz reopens to normal traffic by Aug 2026', probability: 0.145, volumeUsd: 39702681 },
  ],
  iranRate: { midRial: 7507500, delta7dPct: 2.04 },
  dataHealth: {
    oil: { source: 'stale', verifiedAt: '2026-07-08T00:12:34.274Z' },
    ships: { source: 'curated', verifiedAt: '2026-07-08T01:22:01.149Z' },
    events: { source: 'live', verifiedAt: '2026-07-08T01:20:00.000Z' },
  },
  events: [
    { title: 'U.S. and Iran sign MoU; JMIC reports uptick in open Hormuz transits', type: 'diplomacy', severity: 'warning', occurredAt: '2026-07-07T18:00:00.000Z' },
    { title: 'Oil & gas tankers cross Hormuz via Oman-side corridor after U-turns', type: 'shipping', severity: 'serious', occurredAt: '2026-07-05T09:00:00.000Z' },
    { title: 'SPR falls to 325.7 Mbbl — lowest level since the early 1980s', type: 'supply', severity: 'critical', occurredAt: '2026-07-02T14:00:00.000Z' },
  ],
};

/* ========================= Severity model ================================= */

const SEV = { good: 'good', warning: 'warning', serious: 'serious', critical: 'critical', neutral: 'neutral' };
const SEV_RANK = { good: 0, warning: 1, serious: 2, critical: 3 };

function sprSeverity(mbbl) {
  if (mbbl == null) return SEV.neutral;
  if (mbbl >= 500) return SEV.good;
  if (mbbl >= 400) return SEV.warning;
  if (mbbl >= 330) return SEV.serious;
  return SEV.critical;
}
function insuranceSeverity(mult) {
  if (mult == null) return SEV.neutral;
  if (mult <= 1.25) return SEV.good;
  if (mult < 3) return SEV.warning;
  if (mult < 6) return SEV.serious;
  return SEV.critical;
}
function pressureSeverity(band) {
  const b = (band || '').toLowerCase();
  if (b === 'extreme' || b === 'severe') return SEV.critical;
  if (b === 'high' || b === 'elevated') return SEV.serious;
  if (b === 'moderate' || b === 'guarded') return SEV.warning;
  return SEV.good;
}
function tradeSeverity(pct) {
  if (pct == null) return SEV.neutral;
  if (pct >= 20) return SEV.critical;
  if (pct >= 10) return SEV.serious;
  if (pct >= 4) return SEV.warning;
  return SEV.good;
}
/* Flow arteries: low throughput = bad. Sub-50% of peacetime on a vital
   artery reads critical (matches carrier-based "closed" verdict). */
function flowSeverity(pct) {
  if (pct == null) return SEV.neutral;
  if (pct >= 90) return SEV.good;
  if (pct >= 72) return SEV.warning;
  if (pct >= 50) return SEV.serious;
  return SEV.critical;
}
/* Reroute (Cape): high relative traffic = stress. */
function rerouteSeverity(pct) {
  if (pct == null) return SEV.neutral;
  if (pct >= 140) return SEV.critical;
  if (pct >= 120) return SEV.serious;
  if (pct >= 108) return SEV.warning;
  return SEV.good;
}

function todayUTC() { return new Date().toISOString().slice(0, 10); }

/* Resolve the transits/day figure to the latest reported COMPLETE daily total.
   If the newest reported day is still in progress / provisional (the current UTC
   day, or flagged provisional-and-not-partial-day-adjusted by the feed), fall
   back to the previous day's total. Returns the count, its date, and how stale. */
function resolveTransits(cp, d) {
  const today = todayUTC();
  const provisional =
    cp.date === today ||
    (cp.key === 'hormuz' && d && d.transits && d.transits.asOfDate === cp.date &&
      d.transits.provisional === true && d.transits.partialDayAdjusted !== true);
  let n = cp.nTotal, date = cp.date, fellBack = false;
  if (provisional && cp.previousNTotal != null) {
    n = cp.previousNTotal; date = cp.previousDate; fellBack = true;
  }
  let ageDays = null;
  if (date) {
    const diff = Date.now() - new Date(date + 'T00:00:00Z').getTime();
    ageDays = Math.max(0, Math.floor(diff / 86400000));
  }
  return { n, date, fellBack, ageDays };
}

/* Per-chokepoint computed view model. */
function chokeModel(cp, d) {
  const geo = GEO[cp.key] || { mode: 'flow', lat: 0, lng: 0 };
  const rep = resolveTransits(cp, d);
  const nTotal = rep.n;                            // latest reported complete daily total
  // Prefer the curated pre-crisis baseline; fall back to feed values.
  const base = BASELINE[cp.key] || cp.preCrisisBaselineMedian || cp.baselineMedian || nTotal || 1;
  const ratio = nTotal / base;                     // 1.0 = at pre-crisis norm
  const pct = Math.round(ratio * 100);
  const sev = geo.mode === 'reroute' ? rerouteSeverity(pct) : flowSeverity(pct);
  const noun = geo.mode === 'reroute' ? 'traffic' : 'throughput';
  let statusWord;
  if (geo.mode === 'reroute') {
    statusWord = sev === SEV.critical ? 'Surge' : sev === SEV.serious ? 'Elevated' : sev === SEV.warning ? 'Above norm' : 'Normal';
  } else {
    statusWord = sev === SEV.critical ? 'Closed / choked' : sev === SEV.serious ? 'Restricted' : sev === SEV.warning ? 'Reduced' : 'Open';
  }
  const sublabel = `${pct}% of pre-crisis ${noun}`;
  const deviation = pct - 100;
  const irregular = Math.abs(deviation) >= 15;
  // Spread cp, THEN override nTotal with the resolved latest-complete-day value
  // (and keep cp.label — the real name — intact since we don't set it here).
  return { geo, base, ratio, pct, sev, statusWord, sublabel, deviation, irregular, ...cp,
    nTotal, reportedDate: rep.date, reportedAgeDays: rep.ageDays, reportedFellBack: rep.fellBack };
}

/* ============================= Formatters ================================= */
const nf = new Intl.NumberFormat('en-US');
function num(n) { return (n == null) ? '—' : nf.format(Math.round(n)); }
function money(n) {
  if (n == null) return '—';
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(n >= 1e10 ? 0 : 1) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M';
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
  return '$' + num(n);
}
function signed(n, digits = 2) {
  if (n == null) return '—';
  const s = n > 0 ? '+' : '';
  return s + n.toFixed(digits);
}
function timeAgo(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (isNaN(t)) return '';
  const diff = Math.max(0, Date.now() - t);
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  const d = Math.floor(h / 24);
  return d + 'd ago';
}
function futureMonth(daysFromNow) {
  const dt = new Date(Date.now() + daysFromNow * 86400000);
  return dt.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
}
function shortDate(isoDate) {
  if (!isoDate) return '—';
  const dt = new Date(isoDate + 'T00:00:00Z');
  if (isNaN(dt)) return isoDate;
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}
/* Tanker vs cargo (all non-tanker) split for a chokepoint. */
function cargoSplit(cp) {
  if (!cp || cp.nTanker == null || !cp.nTotal) return null;
  const tanker = cp.nTanker;
  const cargo = cp.nCargo != null ? cp.nCargo : (cp.nTotal - tanker);
  const total = (tanker + cargo) || cp.nTotal;
  return { tanker, cargo, tankerPct: Math.round((tanker / total) * 100), cargoPct: Math.round((cargo / total) * 100) };
}
function el(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstChild; }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function clampPct(x) { return Math.max(0, Math.min(100, x)); }
function sevVar(sev) { return `var(--${sev === 'neutral' ? 'accent' : sev})`; }

/* =============================== Rendering ================================ */

function renderHeader(d, isLive) {
  // data-health chips
  const chips = document.getElementById('healthChips');
  chips.innerHTML = '';
  const health = d.dataHealth || {};
  const order = [['oil', 'Oil'], ['ships', 'Ships'], ['events', 'Events']];
  order.forEach(([k, lbl]) => {
    const h = health[k];
    if (!h) return;
    const cls = h.source === 'live' ? 'live' : h.source === 'stale' ? 'stale' : 'curated';
    chips.appendChild(el(`<span class="chip ${cls}" title="${esc(lbl)} — ${esc(h.source)} · verified ${timeAgo(h.verifiedAt)}"><i></i>${esc(lbl)}</span>`));
  });

  const modeChip = document.getElementById('dataMode');
  modeChip.textContent = isLive ? 'Live' : 'Cached snapshot';
  modeChip.className = 'mode-chip ' + (isLive ? 'live' : 'cached');
  document.getElementById('lastUpdated').textContent =
    (isLive ? 'updated ' : 'snapshot ') + (timeAgo(d.asOf) || d._fallbackDate || '');
}

function renderBanner(d) {
  const banner = document.getElementById('banner');
  const cp = d.hormuzIndex?.crisisPressure;
  const sev = pressureSeverity(cp?.band);
  banner.className = 'banner sev-' + sev;
  document.getElementById('bannerStatus').textContent =
    'Strait of Hormuz: ' + (d.verdict?.status || 'unknown').toUpperCase();
  document.getElementById('bannerDetail').textContent =
    d.verdict?.long || 'Operational status of the primary oil chokepoint.';
  document.getElementById('bannerDot');

  const meters = document.getElementById('bannerMeters');
  meters.innerHTML = '';
  const m = [];
  if (cp) m.push(meterEl('Crisis pressure', cp.value, 100, pressureSeverity(cp.band), cp.band, cp.delta24h));
  const ep = d.hormuzIndex?.escalationProbability;
  if (ep) m.push(meterEl('Escalation prob.', ep.value, 100, escSeverity(ep.value), ep.band, ep.delta24h, '%'));
  const hz = (d.chokepoints || []).find(c => c.key === 'hormuz');
  if (hz) {
    const hm = chokeModel(hz, d);
    m.push(meterEl('Hormuz throughput', hm.pct, 100, hm.sev, `${num(hm.nTotal)} of ~${num(hm.base)}/day · as of ${shortDate(hm.reportedDate)}`, null, '%'));
  }
  m.forEach(x => meters.appendChild(x));
}
function escSeverity(v) { return v >= 60 ? SEV.critical : v >= 40 ? SEV.serious : v >= 20 ? SEV.warning : SEV.good; }

function meterEl(label, val, max, sev, band, delta, unit = '') {
  const pct = clampPct((val / max) * 100);
  const deltaHtml = (delta != null && delta !== 0)
    ? `<span class="${delta > 0 ? 'delta-up' : 'delta-down'}"> ${delta > 0 ? '▲' : '▼'}${Math.abs(delta)}</span>` : '';
  return el(`
    <div class="meter">
      <div class="meter-top">
        <span class="meter-label">${esc(label)}</span>
        <span class="meter-val tnum">${num(val)}${unit}${deltaHtml}</span>
      </div>
      <div class="meter-track"><div class="meter-fill" style="width:${pct}%;background:${sevVar(sev)}"></div></div>
      <div class="meter-foot">${esc(band || '')}</div>
    </div>`);
}

function kpiEl({ label, sev, flag, value, unit, sub, delta, bar }) {
  const flagHtml = flag ? `<span class="kpi-flag">${esc(flag)}</span>` : '';
  const valHtml = `${esc(value)}${unit ? `<span class="unit">${esc(unit)}</span>` : ''}`;
  const subHtml = sub ? `<div class="kpi-sub">${sub}</div>` : '';
  let barHtml = '';
  if (bar) {
    const fillPct = clampPct(bar.pct);
    const tick = bar.tickPct != null ? `<span class="tick" style="left:${clampPct(bar.tickPct)}%"></span>` : '';
    barHtml = `<div class="kpi-bar" title="${esc(bar.title || '')}"><span class="fill" style="width:${fillPct}%;background:${sevVar(sev)}"></span>${tick}</div>`;
  }
  return el(`<div class="kpi sev-${sev}">
    <div class="kpi-head"><span class="kpi-label">${esc(label)}</span>${flagHtml}</div>
    <div class="kpi-value tnum">${valHtml}</div>
    ${subHtml}${barHtml}
  </div>`);
}

function renderKpis(d) {
  const wrap = document.getElementById('kpis');
  wrap.innerHTML = '';
  const tiles = [];

  // SPR
  const spr = d.spr;
  if (spr) {
    const sev = sprSeverity(spr.currentMbbl);
    const capPct = (spr.currentMbbl / SPR_CAPACITY_MBBL) * 100;
    const dn = spr.change4wMbbl;
    // Projection at the current 4-week draw rate.
    let projLine = '';
    if (dn < -0.5) {
      const ratePerDay = Math.abs(dn) / 28;
      const dFloor = Math.max(0, (spr.currentMbbl - SPR_FLOOR_MBBL) / ratePerDay);
      const dEmpty = Math.max(0, spr.currentMbbl / ratePerDay);
      projLine = `<br><span class="c-critical">⚠ ${SPR_FLOOR_MBBL} Mbbl floor in ~${Math.round(dFloor)}d (${futureMonth(dFloor)})</span> · empty ~${futureMonth(dEmpty)}`;
    } else if (dn > 0.5) {
      projLine = `<br><span class="c-good">▲ refilling ${signed(dn, 1)} Mbbl / 4wk</span>`;
    }
    tiles.push(kpiEl({
      label: 'US Strategic Petroleum Reserve', sev,
      flag: sev === SEV.critical ? '4-decade low' : sev === SEV.serious ? 'Low' : null,
      value: num(spr.currentMbbl), unit: 'Mbbl',
      sub: `${capPct.toFixed(0)}% of ${SPR_CAPACITY_MBBL} Mbbl capacity · <span class="kpi-delta ${dn < 0 ? 'delta-up' : 'delta-down'}">${signed(dn, 1)} Mbbl / 4wk</span>${projLine}`,
      bar: { pct: capPct, tickPct: (SPR_FLOOR_MBBL / SPR_CAPACITY_MBBL) * 100, title: `Fill vs capacity; tick = ${SPR_FLOOR_MBBL} Mbbl statutory floor` },
    }));
  }

  // Oil price — conventional finance coloring: up = green, down = red.
  if (d.brent != null) {
    const up = (d.change24h || 0) >= 0;
    tiles.push(kpiEl({
      label: 'Crude Oil — Brent', sev: SEV.neutral,
      flag: 'WTI $' + (d.wti != null ? d.wti.toFixed(2) : '—'),
      value: '$' + d.brent.toFixed(2),
      sub: `<span class="kpi-delta ${up ? 'c-good' : 'c-critical'}">${up ? '▲' : '▼'} ${signed(d.change24h, 2)}% (${signed(d.change24hUsd, 2)})</span> · 24h · updated ${timeAgo(d.oilAsOf)}`,
    }));
  }

  // War-risk insurance
  const ins = d.insurance;
  if (ins) {
    const sev = insuranceSeverity(ins.multiple);
    tiles.push(kpiEl({
      label: 'War-Risk Insurance', sev,
      flag: ins.multiple >= 3 ? 'Abnormal' : null,
      value: ins.multiple + '×', unit: 'pre-crisis',
      sub: `VLCC AWRP ${money(ins.vlccPremiumLow)}–${money(ins.vlccPremiumHigh)}/voyage · ${(ins.withdrawnClubs || []).length} P&amp;I clubs withdrew cover`,
      bar: { pct: (ins.multiple / 10) * 100, tickPct: 10, title: 'Multiple of pre-crisis premium (scale 0–10×)' },
    }));
  }

  // Cape reroute pressure
  const cape = (d.chokepoints || []).find(c => c.key === 'cape');
  if (cape) {
    const cm = chokeModel(cape, d);
    const split = cargoSplit(cape);
    const splitTxt = split ? ` · ${split.tankerPct}% tanker / ${split.cargoPct}% cargo` : '';
    tiles.push(kpiEl({
      label: 'Reroute Around Africa (Cape)', sev: cm.sev,
      flag: cm.irregular ? (cm.deviation > 0 ? 'Above normal' : 'Below normal') : 'Normal',
      value: num(cm.nTotal), unit: 'ships/day',
      sub: `${cm.pct}% of pre-crisis norm · <span class="kpi-delta ${cape.deltaDay > 0 ? 'delta-up' : 'delta-down'}">${signed(cape.deltaDay, 0)} vs prior day</span>${splitTxt} · as of ${shortDate(cm.reportedDate)}`,
      bar: { pct: cm.ratio * 50, tickPct: 50, title: 'Traffic vs pre-crisis baseline (tick = baseline)' },
    }));
  }

  // Crisis pressure index
  const crp = d.hormuzIndex?.crisisPressure;
  if (crp) {
    const sev = pressureSeverity(crp.band);
    tiles.push(kpiEl({
      label: 'Crisis Pressure Index', sev,
      flag: (crp.band || '').toUpperCase(),
      value: num(crp.value), unit: '/100',
      sub: `Escalation probability ${num(d.hormuzIndex?.escalationProbability?.value)}% · <span class="kpi-delta ${crp.delta24h > 0 ? 'delta-up' : crp.delta24h < 0 ? 'delta-down' : 'delta-flat'}">${signed(crp.delta24h, 0)} / 24h</span>`,
      bar: { pct: crp.value, title: 'Composite crisis pressure (0–100)' },
    }));
  }

  // Trade at risk
  const ti = d.tradeImpact;
  if (ti) {
    const sev = tradeSeverity(ti.worldOilAtRiskPct);
    tiles.push(kpiEl({
      label: 'World Oil Trade at Risk', sev,
      flag: money(ti.dailyEconomicCostUsd) + '/day',
      value: ti.worldOilAtRiskPct + '%', unit: 'of seaborne oil',
      sub: `${ti.worldLngAtRiskPct}% of LNG · +${ti.alternativeRouteExtraDays} days via Cape reroute`,
      bar: { pct: ti.worldOilAtRiskPct * 3, title: 'Share of world seaborne oil transiting the affected chokepoint' },
    }));
  }

  tiles.forEach(t => wrap.appendChild(t));
}

/* ------------------------------ Chokepoint list ------------------------- */
function renderChokeList(d) {
  const wrap = document.getElementById('chokeList');
  wrap.innerHTML = '';
  const models = (d.chokepoints || []).map(c => chokeModel(c, d));
  // "As of" date for the transit counts (latest reported complete day).
  const asOfEl = document.getElementById('chokeAsOf');
  if (asOfEl && models.length) {
    const latest = models.reduce((a, b) => (a.reportedDate > b.reportedDate ? a : b));
    const age = latest.reportedAgeDays;
    const stale = age != null && age > 2;
    asOfEl.textContent = `· counts as of ${shortDate(latest.reportedDate)}${age != null ? ` (${age}d old)` : ''}`;
    asOfEl.style.color = stale ? 'var(--warning)' : '';
  }
  // Sort: most severe first, Hormuz always leads.
  models.sort((a, b) => (a.key === 'hormuz' ? -1 : b.key === 'hormuz' ? 1 : SEV_RANK[b.sev] - SEV_RANK[a.sev]));
  models.forEach(m => {
    const barPct = m.geo.mode === 'reroute' ? clampPct(m.ratio * 50) : clampPct(m.pct);
    const basePct = m.geo.mode === 'reroute' ? 50 : 100;
    const irregular = m.irregular
      ? `<span class="li-badge sev-${m.sev}-bg">${m.deviation > 0 ? '▲' : '▼'} ${Math.abs(m.deviation)}% vs norm</span>` : '';
    const row = el(`
      <div class="choke-row" data-key="${esc(m.key)}">
        <div class="choke-name"><span class="dot bg-${m.sev}"></span>${esc(m.label)}</div>
        <span class="choke-pill sev-${m.sev}-bg">${esc(m.statusWord)}</span>
        <div class="choke-metrics">
          <div class="cm" title="Latest reported complete day: ${shortDate(m.reportedDate)}${m.reportedFellBack ? ' — latest day was provisional, showing previous complete day' : ''}"><span class="cm-val tnum">${num(m.nTotal)}</span><span class="cm-lbl">transits/day${m.reportedFellBack ? ' *' : ''}</span></div>
          <div class="cm"><span class="cm-val tnum">${num(m.base)}</span><span class="cm-lbl">pre-crisis norm</span></div>
          <div class="cm"><span class="cm-val tnum c-${m.sev}">${m.pct}%</span><span class="cm-lbl">of normal</span></div>
          <div class="cm"><span class="cm-val tnum">${num(m.nTanker)}</span><span class="cm-lbl">tankers</span></div>
          <div class="cm" style="margin-left:auto">${irregular}</div>
        </div>
        <div class="choke-track" title="Current vs pre-crisis baseline">
          <span class="fill bg-${m.sev}" style="width:${barPct}%"></span>
          <span class="base" style="left:${basePct}%"></span>
        </div>
      </div>`);
    row.addEventListener('click', () => focusChoke(m.key));
    wrap.appendChild(row);
  });
}

/* --------------------------------- Map ---------------------------------- */
let map, markerLayer, pipelineLayer, chokeMarkers = {}, mapFitted = false;
function initMap() {
  if (map) return;
  map = L.map('map', { worldCopyJump: true, zoomControl: true, attributionControl: true, minZoom: 2 })
        .setView([20, 55], 3);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap &copy; CARTO', subdomains: 'abcd', maxZoom: 12,
  }).addTo(map);
  // Decorative reroute path around Africa.
  L.polyline(REROUTE_PATH, { color: '#ec835a', weight: 2, opacity: 0.55, dashArray: '6 8' }).addTo(map)
    .bindTooltip('Cape of Good Hope reroute (~+14 days)', { sticky: true });
  pipelineLayer = L.layerGroup().addTo(map);   // drawn under the chokepoint markers
  markerLayer = L.layerGroup().addTo(map);
}

function renderPipelines(d) {
  if (!pipelineLayer) return;
  pipelineLayer.clearLayers();
  (d.pipelineBypass || []).forEach(p => {
    const g = PIPELINE_GEO[p.id];
    if (!g) return;
    const partial = (p.status || '').toLowerCase() !== 'operational';
    L.polyline(g.path, { color: '#e0b34a', weight: 3, opacity: 0.9, dashArray: partial ? '4 6' : null })
      .bindTooltip(`${g.short} — ${num(p.currentUtilizationPct)}% used`, { sticky: true })
      .bindPopup(pipelinePopup(p, g))
      .addTo(pipelineLayer);
    [g.path[0], g.path[g.path.length - 1]].forEach(pt => {
      L.circleMarker(pt, { radius: 3.5, color: '#e0b34a', weight: 2, fillColor: '#1a1a19', fillOpacity: 1 })
        .addTo(pipelineLayer);
    });
  });
}

function pipelinePopup(p, g) {
  return `
    <b>${esc(p.name)}</b><br>
    <span style="color:#e0b34a;font-weight:700">Bypass pipeline → ${esc(g.out)}</span><br>
    <hr style="border:none;border-top:1px solid var(--border);margin:7px 0">
    ${esc(p.originCountry)} → ${esc(p.terminus)}<br>
    Capacity: <b>${(p.capacityBpd / 1e6).toFixed(2)}M bpd</b><br>
    Utilization: <b>${num(p.currentUtilizationPct)}%</b> · ${esc(p.status)}`;
}

function renderMap(d) {
  initMap();
  renderPipelines(d);
  markerLayer.clearLayers();
  chokeMarkers = {};
  const models = (d.chokepoints || []).map(c => chokeModel(c, d));
  models.forEach(m => {
    if (!m.geo || m.geo.lat == null) return;
    const color = m.sev === 'neutral' ? '#3987e5' : getComputedStyle(document.documentElement).getPropertyValue('--' + m.sev).trim();
    const r = m.key === 'hormuz' ? 15 : 11;
    const critical = m.sev === 'critical';
    const marker = L.circleMarker([m.geo.lat, m.geo.lng], {
      radius: r, color: color, weight: 2, fillColor: color, fillOpacity: critical ? 0.55 : 0.4,
    });
    if (critical) {
      // outer pulse ring
      L.circleMarker([m.geo.lat, m.geo.lng], { radius: r + 8, color: color, weight: 1, opacity: 0.35, fill: false }).addTo(markerLayer);
    }
    marker.bindTooltip(m.label, { permanent: true, direction: 'right', offset: [8, 0], className: 'choke-marker-label' });
    marker.bindPopup(chokePopup(m));
    marker.addTo(markerLayer);
    chokeMarkers[m.key] = marker;
  });
  if (!mapFitted) {
    const pts = models.filter(m => m.geo && m.geo.lat != null).map(m => [m.geo.lat, m.geo.lng]);
    if (pts.length) { map.fitBounds(pts, { padding: [55, 55], maxZoom: 5 }); mapFitted = true; }
  }
}

function chokePopup(m) {
  const modeNote = m.geo.mode === 'reroute'
    ? 'Diversion route — higher traffic signals stress elsewhere.'
    : 'Primary artery — lower throughput signals disruption.';
  return `
    <b>${esc(m.label)}</b><br>
    <span style="color:var(--${m.sev});font-weight:700">${esc(m.statusWord)}</span> · ${m.pct}% of pre-crisis norm<br>
    <hr style="border:none;border-top:1px solid var(--border);margin:7px 0">
    Transits today: <b>${num(m.nTotal)}</b> &nbsp; (pre-crisis ${num(m.base)})<br>
    Tankers: <b>${num(m.nTanker)}</b> &nbsp; Cargo: <b>${num(m.nCargo)}</b><br>
    Day-over-day: <b>${signed(m.deltaDay, 0)}</b><br>
    <span style="color:var(--muted);font-size:11px">${esc(modeNote)}</span>`;
}

function focusChoke(key) {
  document.querySelectorAll('.choke-row').forEach(r => r.classList.toggle('active', r.dataset.key === key));
  const m = chokeMarkers[key];
  const g = GEO[key];
  if (map && g) map.flyTo([g.lat, g.lng], key === 'cape' ? 4 : 5, { duration: 0.6 });
  if (m) setTimeout(() => m.openPopup(), 350);
}

/* ------------------------------- Panels --------------------------------- */
function renderInsurance(d) {
  const b = document.getElementById('insuranceBody');
  const ins = d.insurance;
  if (!ins) { b.innerHTML = '<div class="kpi-sub">No data.</div>'; return; }
  const sev = insuranceSeverity(ins.multiple);
  b.innerHTML = '';
  b.appendChild(el(`
    <div class="big-stat">
      <span class="num c-${sev}">${ins.multiple}×</span>
      <span class="tag sev-${sev}-bg">pre-crisis premium</span>
    </div>`));
  b.appendChild(row('Additional War-Risk Premium (VLCC)', `${money(ins.vlccPremiumLow)} – ${money(ins.vlccPremiumHigh)}`));
  b.appendChild(row('Renewal cadence', 'every 7 days'));
  b.appendChild(row('Source', ins.sourceName || "Lloyd's JWC"));
  const clubs = ins.withdrawnClubs || [];
  if (clubs.length) {
    b.appendChild(el(`<div class="kpi-sub" style="margin-top:12px;color:var(--serious)">P&amp;I clubs that withdrew cover (${clubs.length}):</div>`));
    const tags = el('<div class="tags"></div>');
    clubs.forEach(c => tags.appendChild(el(`<span class="tag-pill warn">${esc(c)}</span>`)));
    b.appendChild(tags);
  }
}

function renderTrade(d) {
  const b = document.getElementById('tradeBody');
  const ti = d.tradeImpact;
  if (!ti) { b.innerHTML = '<div class="kpi-sub">No data.</div>'; return; }
  const sev = tradeSeverity(ti.worldOilAtRiskPct);
  b.innerHTML = '';
  b.appendChild(el(`
    <div class="big-stat">
      <span class="num c-${sev}">${money(ti.dailyEconomicCostUsd)}</span>
      <span class="cap">estimated daily economic cost</span>
    </div>`));
  b.appendChild(row('World seaborne oil at risk', ti.worldOilAtRiskPct + '%'));
  b.appendChild(row('World LNG at risk', ti.worldLngAtRiskPct + '%'));
  b.appendChild(row('Extra days via Cape reroute', '+' + ti.alternativeRouteExtraDays));
  const countries = ti.topAffectedCountries || [];
  if (countries.length) {
    b.appendChild(el(`<div class="kpi-sub" style="margin-top:12px">Most exposed importers:</div>`));
    const tags = el('<div class="tags"></div>');
    countries.forEach(c => tags.appendChild(el(`<span class="tag-pill">${esc(c)}</span>`)));
    b.appendChild(tags);
  }
}

function renderReroute(d) {
  const b = document.getElementById('rerouteBody');
  b.innerHTML = '';
  // Cape snapshot summary
  const cs = d.capeSnapshot, hs = d.hormuzSnapshot;
  if (cs) {
    b.appendChild(el(`<div class="kpi-sub" style="margin-bottom:6px;color:var(--text-2);font-weight:700">Cape of Good Hope (last 24h)</div>`));
    b.appendChild(row('Transits last 24h', num(cs.transitsLast24h)));
    b.appendChild(row('In port / expected', `${num(cs.inPortTotal)} / ${num(cs.expectedTotal)}`));
  }
  // Cape reroute cargo-type split (%)
  const capeCp = (d.chokepoints || []).find(c => c.key === 'cape');
  const split = cargoSplit(capeCp);
  if (split) {
    b.appendChild(el(`
      <div style="margin-top:10px">
        <div class="kpi-sub" style="display:flex;justify-content:space-between;margin-bottom:6px">
          <span style="color:var(--text-2);font-weight:700">Reroute cargo mix</span>
          <span class="tnum" style="color:var(--muted)">${num(capeCp.nTotal)} ships/day</span>
        </div>
        <div class="split-bar" title="Tanker ${num(split.tanker)} · Cargo ${num(split.cargo)}">
          <span style="width:${split.tankerPct}%;background:var(--accent)"></span>
          <span style="width:${split.cargoPct}%;background:#199e70"></span>
        </div>
        <div class="split-legend">
          <span><i style="background:var(--accent)"></i>Tanker <b class="tnum">${split.tankerPct}%</b> (${num(split.tanker)})</span>
          <span><i style="background:#199e70"></i>Cargo <b class="tnum">${split.cargoPct}%</b> (${num(split.cargo)})</span>
        </div>
      </div>`));
  }
  if (hs) {
    b.appendChild(el(`<div class="kpi-sub" style="margin:12px 0 6px;color:var(--text-2);font-weight:700">Hormuz approaches</div>`));
    b.appendChild(row('In port / expected', `${num(hs.inPortTotal)} / ${num(hs.expectedTotal)}`));
    if (d.stranded != null) b.appendChild(row('Vessels stranded / waiting', num(d.stranded)));
  }
  // Pipeline bypass
  const pipes = d.pipelineBypass || [];
  if (pipes.length) {
    b.appendChild(el(`<div class="kpi-sub" style="margin:12px 0 4px;color:var(--text-2);font-weight:700">Pipeline bypass capacity</div>`));
    pipes.forEach(p => {
      const util = p.currentUtilizationPct;
      const sev = util >= 92 ? SEV.serious : util >= 75 ? SEV.warning : SEV.good;
      b.appendChild(el(`
        <div class="list-item">
          <div class="li-head">
            <span class="li-title">${esc(p.name)}</span>
            <span class="li-badge sev-${sev}-bg">${num(util)}% used</span>
          </div>
          <div class="li-sub">${esc(p.originCountry)} → ${esc(p.terminus)} · ${(p.capacityBpd / 1e6).toFixed(1)}M bpd · ${esc(p.status)}</div>
        </div>`));
    });
  }
}

function renderCarriers(d) {
  const b = document.getElementById('carrierBody');
  b.innerHTML = '';
  const carriers = d.carrierSuspensions || [];
  if (!carriers.length) { b.innerHTML = '<div class="kpi-sub">No carrier advisories.</div>'; return; }
  carriers.forEach(c => {
    const st = (c.status || '').toLowerCase();
    const sev = st.includes('suspend') || st.includes('stop') ? SEV.critical : st.includes('reroute') ? SEV.serious : SEV.warning;
    const bits = [];
    if (c.surchargeUsdPerTeu) bits.push(`+$${num(c.surchargeUsdPerTeu)}/TEU surcharge`);
    if (c.vesselsTrapped) bits.push(`${num(c.vesselsTrapped)} vessels trapped`);
    if (c.trappedTeu) bits.push(`${num(c.trappedTeu)} TEU`);
    b.appendChild(el(`
      <div class="list-item">
        <div class="li-head">
          <span class="li-title"><span class="dot bg-${sev}" style="width:9px;height:9px;border-radius:50%"></span>${esc(c.carrier)}</span>
          <span class="li-badge sev-${sev}-bg">${esc(c.status)}</span>
        </div>
        <div class="li-sub">${bits.map(esc).join(' · ') || '—'}</div>
      </div>`));
  });
  if (d.iranRate) {
    b.appendChild(el(`<div class="kpi-sub" style="margin:12px 0 4px;color:var(--text-2);font-weight:700">Iran market signal</div>`));
    const ir = d.iranRate;
    b.appendChild(row('IRR/USD (free market, rial)', num(ir.midRial) + (ir.delta7dPct != null ? `  (${signed(ir.delta7dPct, 1)}% 7d)` : '')));
  }
}

function renderMarkets(d) {
  const b = document.getElementById('marketBody');
  b.innerHTML = '';
  const mkts = (d.predictionMarkets || []).slice().sort((a, b2) => (b2.volumeUsd || 0) - (a.volumeUsd || 0)).slice(0, 6);
  if (!mkts.length) { b.innerHTML = '<div class="kpi-sub">No active markets.</div>'; return; }
  mkts.forEach(m => {
    const p = Math.round((m.probability || 0) * 100);
    const sev = p >= 60 ? SEV.critical : p >= 35 ? SEV.serious : p >= 15 ? SEV.warning : SEV.good;
    const q = m.question || m.title || 'Market';
    b.appendChild(el(`
      <div class="mkt">
        <div class="mkt-top"><span class="mkt-q">${esc(q)}</span><span class="mkt-p c-${sev}">${p}%</span></div>
        <div class="mkt-track"><span class="mkt-fill bg-${sev}" style="width:${clampPct(p)}%"></span></div>
        <div class="mkt-foot"><span>${esc(m.venue || '')}</span><span>${m.volumeUsd ? money(m.volumeUsd) + ' vol' : ''}</span></div>
      </div>`));
  });
}

function renderEvents(d) {
  const b = document.getElementById('eventBody');
  b.innerHTML = '';
  const events = (d.events || []).slice()
    .sort((a, b2) => new Date(b2.occurredAt) - new Date(a.occurredAt)).slice(0, 12);
  if (!events.length) { b.innerHTML = '<div class="kpi-sub">No recent events.</div>'; return; }
  events.forEach(e => {
    const sev = ['critical', 'serious', 'warning', 'good'].includes((e.severity || '').toLowerCase()) ? e.severity.toLowerCase() : SEV.warning;
    b.appendChild(el(`
      <div class="ev sev-${sev}">
        <div class="ev-rail"></div>
        <div>
          <div class="ev-title">${esc(e.title)}</div>
          <div class="ev-meta"><span class="ev-type c-${sev}">${esc(e.type || 'update')}</span><span>${timeAgo(e.occurredAt)}</span></div>
        </div>
      </div>`));
  });
}

function row(k, v) { return el(`<div class="stat-row"><span class="k">${k}</span><span class="v tnum">${v}</span></div>`); }

/* ============================ Orchestration =============================== */
function renderAll(d, isLive) {
  renderHeader(d, isLive);
  renderBanner(d);
  renderKpis(d);
  renderChokeList(d);
  renderMap(d);
  renderInsurance(d);
  renderTrade(d);
  renderReroute(d);
  renderCarriers(d);
  renderMarkets(d);
  renderEvents(d);
}

let currentData = FALLBACK;
async function load() {
  const btn = document.getElementById('refreshBtn');
  btn.classList.add('spin');
  let isLive = false, data = FALLBACK;
  try {
    const [status, choke] = await Promise.all([
      fetchJson(STATUS_URL),
      fetchJson(CHOKE_URL).catch(() => null),   // enrichment; non-fatal
    ]);
    data = status;
    mergeChokepoints(data, choke);
    isLive = true;
  } catch (err) {
    console.warn('Live fetch failed, using cached snapshot:', err.message);
    data = FALLBACK;
    isLive = false;
  }
  currentData = data;
  try { renderAll(data, isLive); } catch (e) { console.error('Render error', e); }
  btn.classList.remove('spin');
}

function startClock() {
  const t = document.getElementById('clockTime');
  const tick = () => { t.textContent = new Date().toISOString().slice(11, 19); };
  tick(); setInterval(tick, 1000);
}

document.addEventListener('DOMContentLoaded', () => {
  startClock();
  document.getElementById('refreshBtn').addEventListener('click', load);
  load();
  setInterval(load, REFRESH_MS);
});
