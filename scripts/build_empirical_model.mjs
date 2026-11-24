/**
 * Enrich all resolved South African historical moonsighting decisions with
 * topocentric astronomical parameters at Signal Hill (Cape Town), Laudium (Pretoria),
 * and Durban using `astronomy-engine`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { addDaysIso, evaluateCrescent, SA_ANCHOR_STATIONS } from '../src/astronomy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const INPUT_PATH = path.join(ROOT, 'data', 'sa_moonsighting_history.json');
const OUTPUT_PATH = path.join(ROOT, 'data', 'sa_enriched_history.json');

function pickStationMetrics(m) {
  return {
    lagMin: Number(m.lagMin.toFixed(2)),
    ageHours: m.ageHours !== null ? Number(m.ageHours.toFixed(2)) : null,
    arcvDeg: Number(m.arcvDeg.toFixed(3)),
    arclDeg: Number(m.arclDeg.toFixed(3)),
    dazDeg: Number(m.dazDeg.toFixed(3)),
    wArcmin: Number(m.wArcmin.toFixed(4)),
    sdArcmin: Number(m.sdArcmin.toFixed(3)),
    moonAltBest: Number(m.moonAltBest.toFixed(3)),
    q: Number(m.q.toFixed(4)),
    v: Number(m.v.toFixed(4)),
  };
}

function main() {
  const history = JSON.parse(fs.readFileSync(INPUT_PATH, 'utf8'));
  const anchors = SA_ANCHOR_STATIONS.slice(0, 3); // cape_town, pretoria, durban
  const enriched = [];
  let anomalyCount = 0;

  for (const row of history) {
    if (!row.first_of_month_gregorian || row.sighted_on_29th === null || row.sighted_on_29th === undefined) {
      continue;
    }

    // Exact 29th decision evening: 1 day before 1st if sighted, 2 days before 1st if not sighted
    const expectedEvening = addDaysIso(
      row.first_of_month_gregorian,
      row.sighted_on_29th ? -1 : -2
    );

    const perStation = {};
    let bestQ = -Infinity;
    let bestV = -Infinity;
    let bestStation = null;

    for (const st of anchors) {
      const m = evaluateCrescent(expectedEvening, st.lat, st.lon, st.elevation_m);
      const compact = pickStationMetrics(m);
      perStation[st.id] = compact;
      if (m.valid && m.q > bestQ) {
        bestQ = m.q;
        bestV = m.v;
        bestStation = st.id;
      }
    }

    const bestMetrics = perStation[bestStation];
    // Flag physical impossibility checks on positively sighted nights
    if (row.sighted_on_29th && (bestMetrics.lagMin <= 0 || bestMetrics.arclDeg < 6.4)) {
      anomalyCount++;
      console.warn(
        `PHYSICAL WARNING ${row.hijri_year}-${String(row.hijri_month_num).padStart(2, '0')} (${expectedEvening}): sighted=true yet lag=${bestMetrics.lagMin}m arcl=${bestMetrics.arclDeg}°`
      );
    }

    enriched.push({
      hijri_year: row.hijri_year,
      hijri_month_num: row.hijri_month_num,
      hijri_month_name: row.hijri_month_name,
      decision_evening: expectedEvening,
      recorded_decision_evening: row.decision_evening,
      first_of_month: row.first_of_month_gregorian,
      eid_date: row.eid_date_gregorian,
      sighted: row.sighted_on_29th,
      best_station: bestStation,
      sa_best_q: Number(bestQ.toFixed(4)),
      sa_best_v: Number(bestV.toFixed(4)),
      sa_best_arcv: bestMetrics.arcvDeg,
      sa_best_w: bestMetrics.wArcmin,
      sa_best_arcl: bestMetrics.arclDeg,
      sa_best_lag: bestMetrics.lagMin,
      sa_best_age: bestMetrics.ageHours,
      cape_town: perStation.cape_town,
      pretoria: perStation.pretoria,
      durban: perStation.durban,
      observer_cities: row.observer_cities || [],
      sources: row.sources || [],
    });
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(enriched, null, 2));
  const sightedCnt = enriched.filter((r) => r.sighted).length;
  console.log(`Enriched ${enriched.length} resolved SA months (${sightedCnt} sighted, ${enriched.length - sightedCnt} not sighted) -> ${OUTPUT_PATH}`);
  console.log(`Physical impossibility warnings on sighted nights: ${anomalyCount}`);
}

main();
