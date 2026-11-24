# When is Eid

**When is Eid** (`when-is-eid`) is a static web application (built for GitHub Pages) that estimates the probability of the next upcoming Eid (and Ramadan) falling on specific calendar days using **empirical South African naked-eye crescent observations** (COSSA / MJC / UUCSA / MCW / Wifaqul Ulama SA, 2008–2026).

## How It Works
**When is Eid** computes continuous topocentric probabilities in the browser via `astronomy-engine` at viewport resolution, pairs every forecast with historical South African analogs at the same visibility size, and maps global moonsighting jurisdictions.

## Key Features
- **Empirical Eid Day Probabilities & Past-Year Historic Sightings:** Evaluates the 29th evening across South Africa's regional observation hubs (`Signal Hill`, `Three Anchor Bay`, `Laudium`, `Durban`, `Gqeberha`) and computes calibrated `P(Day 1)` vs `P(Day 2)` probabilities backed by historical analogs at the same crescent visibility size (`W`, `ARCV`, `q`), plus a past-year historic sightings view in the Target Event selector.
- **Continuous Non-Quantized Visibility Map:** Adaptive viewport-resolution Canvas heatmap with bilinear pixel interpolation, plus a `Quantized (A–D)` Yallop band view for comparison.
- **Country & City Type-Ahead Search:** Type any country or city (e.g., `South Africa`, `Cape Town`, `Durban`, `Johannesburg`, `Rabat`, `London`, `Jakarta`) to zoom in and inspect local sunset, moonset, lag, crescent width, and historical station data.
- **Global Moonsighting Jurisdictions ("Zones"):** Interactive choropleth mapping which countries practice local sighting (`South Africa`, `Morocco`, `Pakistan`, `India`, `Australia`), follow Saudi Arabia, follow Turkey/ECFR (`5° / 8°`), use MABIMS/regional criteria, or have split communities—with optional follower arcs.
- **Automated Monthly Refresh:** GitHub Actions dynamically generates upcoming Ramadan and Eid windows in the browser and refreshes live South African decision archives (`wifaq.org.za` & `hilalwatch.org.za`) on a monthly schedule.

## Acknowledgements & Data Sources
- [Crescent Observers Society of South Africa (COSSA)](https://www.cossa.co.za/)
- [Wifaqul Ulama South Africa](https://wifaq.org.za/)
- [HilalWatchZA](https://hilalwatch.org.za/)
- [Moonsighting.com / Moonsighting Committee Worldwide (MCW)](https://www.moonsighting.com/)
- [Muslim Judicial Council (MJC)](https://mjc.org.za/) & United Ulama Council of South Africa (UUCSA)
- [Jamiatul Ulama KwaZulu-Natal](https://jamiat.org.za/) & [Voice of the Cape (VOC)](https://vocfm.co.za/)
- [astronomy-engine](https://github.com/cosinekitty/astronomy), [Leaflet](https://leafletjs.com/), [OpenStreetMap](https://www.openstreetmap.org/), and [world-atlas](https://github.com/topojson/world-atlas)

## Local Development & Data Pipeline
```bash
npm install
npm run dev       # Start Vite dev server
npm run build     # Build static site into dist/
```

To refresh live South African sighting archives and recalibrate the empirical logistic model:
```bash
python scripts/fetch_sa_history.py --live-only
npm run build:data
```
