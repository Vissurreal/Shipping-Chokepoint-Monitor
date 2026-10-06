# Seaborne Chokepoint Command Center

Single-page maritime-chokepoint dashboard. `README.md` covers what it shows, the data source, and every tuning knob — read it first; don't duplicate it here.

## Constraints

- **No build, no npm, no framework.** Vanilla JS in `app.js`, plain `index.html` + `styles.css`. Leaflet is the only dependency (CDN). Keep it that way.
- **Must work from `file://`** (double-click `index.html`) as well as via `serve.ps1`.
- **All live data is from straits.live** (keyless, CORS). Never add an API that needs a key — there's nowhere safe to put one in a static page.
- **`FALLBACK` in `app.js` is the offline snapshot.** If you change the shape of data the renderers read, update `FALLBACK` to match, or the cached mode breaks silently.
- **Interpolating API strings into HTML goes through `esc()`.** The `el()` helper uses `innerHTML`.
- Severity is the 4-step `SEV` scale (good → warning → serious → critical) mapped to CSS vars `--good`/`--warning`/…; new indicators get a `*Severity()` helper next to the others, not inline thresholds.

## Verify a change

`powershell -ExecutionPolicy Bypass -File serve.ps1 -Port 8123` → open http://localhost:8123/ (also in `.claude/launch.json`, so `/run` works). Check both the "Live" badge and the fallback (block straits.live in devtools → should show "Cached snapshot").
