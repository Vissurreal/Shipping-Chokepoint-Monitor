# Seaborne Chokepoint Command Center

A single-page, real-time "command center" for maritime oil chokepoints — the Strait
of Hormuz, Bab el-Mandeb, Suez, Malacca, and the Cape of Good Hope reroute — plus the
industrial/market reaction to events affecting them.

![status](https://img.shields.io/badge/data-live-brightgreen)

## What it shows

| Section | Metric |
|---|---|
| **Alert banner** | Hormuz open/closed verdict, crisis-pressure & escalation-probability meters |
| **KPI tiles** (color-coded by severity) | US **SPR** level (vs. capacity & 4-week draw), **Brent/WTI** oil price + 24h move, **war-risk insurance** multiple & VLCC premium, **Cape reroute** volume vs. peacetime, crisis-pressure index, share of world oil trade at risk |
| **Interactive map** | Each chokepoint as a severity-colored marker (transits vs. pre-crisis baseline), popups with tanker/cargo splits, the dashed "long way round Africa" reroute path, and the **bypass pipelines** (Petroline, ADCOP, Goreh–Jask) that move crude around Hormuz |
| **Strait status list** | Per-strait transits/day, peacetime average, % of normal, tanker count, and an **"irregular vs. norm"** badge |
| **Panels** | War-risk insurance detail (withdrawn P&I clubs), trade-at-risk & exposed importers, pipeline bypass & reroute snapshots, carrier posture (surcharges / trapped vessels), escalation prediction markets, and a live event feed |

Severity is **color-coded** everywhere (green → amber → orange → red) and every figure
is compared to a **pre-crisis baseline**, so abnormal values are flagged explicitly.

## Data source

All live data comes from **[straits.live](https://straits.live)** — a keyless,
CORS-enabled JSON API that aggregates:

- **IMF PortWatch** — daily chokepoint transit counts & baselines (AIS-derived)
- **EIA** — SPR inventory, oil prices, US gas prices
- **Lloyd's Joint War Committee** — war-risk listed areas & insurance signals
- **Kalshi / Polymarket** — escalation prediction markets
- Curated event feed

The app calls `/status` (one bundled snapshot) plus `/api/v1/chokepoints` (per-vessel-type
detail) every 90 seconds. A **baked-in snapshot** is embedded in `app.js`, so the
dashboard still renders if the network or API is unavailable (it shows a
"Cached snapshot" badge instead of "Live").

> Indicators are estimates for situational awareness — not navigational or trading
> advice. AIS-derived counts can be affected by GPS jamming and "dark" activity.

## Running it

**Option A — just open it.** Double-click `index.html`. It runs entirely in the
browser (Leaflet is loaded from a CDN; live data is fetched over HTTPS).

**Option B — local server** (avoids any `file://` quirks; no Node/Python needed):

```powershell
powershell -ExecutionPolicy Bypass -File serve.ps1 -Port 8123
# then open http://localhost:8123/
```

## Files

| File | Purpose |
|---|---|
| `index.html` | Markup / layout |
| `styles.css` | Dark ops theme (validated status palette) |
| `app.js` | Data fetch + merge, severity model, map, all rendering, auto-refresh, fallback |
| `serve.ps1` | Dependency-free static server (PowerShell `TcpListener`) |
| `.claude/launch.json` | Preview/launch config |

## Customizing

- **Refresh interval** — `REFRESH_MS` in `app.js`.
- **Severity thresholds** — the `*Severity()` helpers near the top of `app.js`
  (SPR bands, insurance multiple, throughput %, etc.).
- **Baselines ("% of normal")** — the `BASELINE` table in `app.js`. These are the
  curated pre-Hormuz-crisis daily-transit norms used as the denominator (the
  aggregator's own baseline field is unreliable). Swap in true-peacetime values
  here if you'd rather benchmark against pre-2023 levels.
- **SPR projection** — `SPR_FLOOR_MBBL` (default 238, the statutory floor) and
  `SPR_CAPACITY_MBBL`; the "days to floor / empty" is projected from the live
  4-week draw rate.
- **Chokepoints & pipelines on the map** — the `GEO` table (chokepoint coordinates +
  whether each is a supply *artery* or a *reroute* stress signal) and `PIPELINE_GEO`
  (bypass-pipeline routes, keyed by straits.live pipeline id).
