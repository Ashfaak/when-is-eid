/**
 * Shared topocentric crescent astronomy, empirical naked-eye probability,
 * and Eid/Ramadan day-probability calculations using `astronomy-engine`.
 */
import * as Astronomy from 'astronomy-engine';

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
const AU_KM = 149597870.7;
const MOON_RADIUS_KM = 1737.4;

export const HIJRI_MONTH_SHORT = {
  1: 'Muh',
  2: 'Saf',
  3: 'Rab I',
  4: 'Rab II',
  5: 'Jum I',
  6: 'Jum II',
  7: 'Raj',
  8: 'Shab',
  9: 'Ram',
  10: 'Shaw',
  11: 'D.Qad',
  12: 'D.Hij',
};

export const SA_ANCHOR_STATIONS = [
  { id: 'cape_town', name: 'Signal Hill (Cape Town)', region: 'Western Cape', lat: -33.9178, lon: 18.4028, elevation_m: 340 },
  { id: 'pretoria', name: 'Laudium (Pretoria)', region: 'Gauteng', lat: -25.77966, lon: 28.109, elevation_m: 1380 },
  { id: 'durban', name: 'Durban (KZN)', region: 'KwaZulu-Natal', lat: -29.8587, lon: 31.0218, elevation_m: 20 },
  { id: 'gqeberha', name: 'Gqeberha (Malabar)', region: 'Eastern Cape', lat: -33.9139, lon: 25.5823, elevation_m: 80 },
];

export function addDaysIso(dateIso, days) {
  const [y, m, d] = dateIso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export function formatTimeInOffset(astroTime, lonDeg) {
  if (!astroTime) return '—';
  // Approximate solar/standard offset rounded to nearest 0.5h or 1h for clean display
  const offsetHours = Math.round((lonDeg / 15) * 2) / 2;
  const localMs = astroTime.date.getTime() + offsetHours * 3600 * 1000;
  const d = new Date(localMs);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const sign = offsetHours >= 0 ? '+' : '';
  return `${hh}:${mm} (UTC${sign}${offsetHours})`;
}

export function formatUtcTime(astroTime) {
  if (!astroTime) return '—';
  return astroTime.date.toISOString().slice(0, 16).replace('T', ' ') + ' UT';
}

export function getWeekdayName(dateIso) {
  const [y, m, d] = dateIso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    weekday: 'long',
    timeZone: 'UTC',
  });
}

export function formatDisplayDate(dateIso) {
  const [y, m, d] = dateIso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function wrap180(deg) {
  let x = ((deg + 180) % 360 + 360) % 360 - 180;
  return x;
}

/**
 * Evaluate topocentric crescent visibility metrics on `dateIso` evening
 * at `(lat, lon, elevationM)` using Yallop/Odeh/Shaukat geometry at T_best.
 */
export function evaluateCrescent(dateIso, lat, lon, elevationM = 0) {
  const observer = new Astronomy.Observer(lat, lon, elevationM);
  const [y, m, d] = dateIso.split('-').map(Number);

  // Start search near local solar noon on `dateIso` (12:00 - lon/15 UTC)
  const noonUtcMs = Date.UTC(y, m - 1, d, 12, 0, 0) - (lon / 15) * 3600 * 1000;
  const searchStart = new Date(noonUtcMs - 2 * 3600 * 1000);

  const sunset = Astronomy.SearchRiseSet(Astronomy.Body.Sun, observer, -1, searchStart, 1.25);
  if (!sunset) {
    return { valid: false, reason: 'polar_no_sunset', q: -9, v: -99, lagMin: -999, ageHours: -99 };
  }

  // Search moonset from 2h before sunset onward
  const moonSearchStart = new Date(sunset.date.getTime() - 2 * 3600 * 1000);
  const moonset = Astronomy.SearchRiseSet(Astronomy.Body.Moon, observer, -1, moonSearchStart, 1.25);
  const lagMin = moonset ? (moonset.date.getTime() - sunset.date.getTime()) / 60000 : -999;

  // Most recent geocentric conjunction prior to sunset + 12h
  const conjSearchStart = new Date(sunset.date.getTime() - 4 * 86400 * 1000);
  let conj = Astronomy.SearchMoonPhase(0, conjSearchStart, 5);
  if (conj) {
    // Check if there is a slightly later conjunction still <= sunset + 6h
    const nextConj = Astronomy.SearchMoonPhase(0, new Date(conj.date.getTime() + 20 * 86400 * 1000), 15);
    if (nextConj && nextConj.date.getTime() <= sunset.date.getTime() + 6 * 3600 * 1000) {
      conj = nextConj;
    }
  }
  const ageHours = conj ? (sunset.date.getTime() - conj.date.getTime()) / 3600000 : null;

  // Best time: sunset + 4/9 * lag (or sunset if moon sets before sun)
  const bestMs = lagMin > 0
    ? sunset.date.getTime() + (4 / 9) * lagMin * 60000
    : sunset.date.getTime();
  const bestTime = Astronomy.MakeTime(new Date(bestMs));

  // Topocentric equatorial & horizontal coordinates (geometric, no refraction per Yallop 1997)
  const eqMoon = Astronomy.Equator(Astronomy.Body.Moon, bestTime, observer, true, true);
  const eqSun = Astronomy.Equator(Astronomy.Body.Sun, bestTime, observer, true, true);
  const hzMoonGeom = Astronomy.Horizon(bestTime, observer, eqMoon.ra, eqMoon.dec, null);
  const hzSunGeom = Astronomy.Horizon(bestTime, observer, eqSun.ra, eqSun.dec, null);
  const hzMoonApp = Astronomy.Horizon(bestTime, observer, eqMoon.ra, eqMoon.dec, 'normal');

  // Also evaluate at exact sunset for Turkey/MABIMS rules
  const eqMoonSS = Astronomy.Equator(Astronomy.Body.Moon, sunset, observer, true, true);
  const eqSunSS = Astronomy.Equator(Astronomy.Body.Sun, sunset, observer, true, true);
  const hzMoonSS = Astronomy.Horizon(sunset, observer, eqMoonSS.ra, eqMoonSS.dec, null);
  const hzSunSS = Astronomy.Horizon(sunset, observer, eqSunSS.ra, eqSunSS.dec, null);

  const arcvDeg = hzMoonGeom.altitude - hzSunGeom.altitude;
  const dazDeg = Math.abs(wrap180(hzMoonGeom.azimuth - hzSunGeom.azimuth));
  const cosArcl = Math.max(
    -1,
    Math.min(
      1,
      Math.sin(hzMoonGeom.altitude * DEG2RAD) * Math.sin(hzSunGeom.altitude * DEG2RAD) +
        Math.cos(hzMoonGeom.altitude * DEG2RAD) *
          Math.cos(hzSunGeom.altitude * DEG2RAD) *
          Math.cos(dazDeg * DEG2RAD)
    )
  );
  const arclDeg = Math.acos(cosArcl) * RAD2DEG;

  const moonAltSunset = hzMoonSS.altitude;
  const dazSS = Math.abs(wrap180(hzMoonSS.azimuth - hzSunSS.azimuth));
  const cosArclSS = Math.max(
    -1,
    Math.min(
      1,
      Math.sin(hzMoonSS.altitude * DEG2RAD) * Math.sin(hzSunSS.altitude * DEG2RAD) +
        Math.cos(hzMoonSS.altitude * DEG2RAD) *
          Math.cos(hzSunSS.altitude * DEG2RAD) *
          Math.cos(dazSS * DEG2RAD)
    )
  );
  const arclSunsetDeg = Math.acos(cosArclSS) * RAD2DEG;

  // Topocentric lunar semi-diameter & crescent width W (arcminutes)
  const distKm = eqMoon.dist * AU_KM;
  const sdArcmin = Math.asin(MOON_RADIUS_KM / distKm) * RAD2DEG * 60;
  const wArcmin = sdArcmin * (1 - Math.cos(arclDeg * DEG2RAD));

  const arcvMinYallop = 11.8371 - 6.3226 * wArcmin + 0.7319 * wArcmin ** 2 - 0.1018 * wArcmin ** 3;
  const q = (arcvDeg - arcvMinYallop) / 10;
  const v = arcvDeg - (-0.1018 * wArcmin ** 3 + 0.7319 * wArcmin ** 2 - 6.3226 * wArcmin + 7.1651);

  return {
    valid: true,
    sunsetUtc: sunset.date.toISOString(),
    moonsetUtc: moonset ? moonset.date.toISOString() : null,
    sunsetTime: sunset,
    moonsetTime: moonset,
    bestTime,
    conjunctionUtc: conj ? conj.date.toISOString() : null,
    lagMin,
    ageHours,
    arcvDeg,
    arclDeg,
    arclSunsetDeg,
    moonAltSunset,
    moonAltBest: hzMoonApp.altitude,
    moonAzBest: hzMoonApp.azimuth,
    sunAzBest: hzSunGeom.azimuth,
    dazDeg,
    sdArcmin,
    wArcmin,
    q,
    v,
  };
}

export function classifyYallopZone(metrics) {
  if (!metrics.valid || metrics.lagMin <= 0 || metrics.ageHours <= 0 || metrics.arclDeg < 6.4) {
    return 'F';
  }
  const q = metrics.q;
  if (q > 0.216) return 'A';
  if (q > -0.014) return 'B';
  if (q > -0.160) return 'C';
  if (q > -0.232) return 'D';
  if (q > -0.293) return 'E';
  return 'F';
}

export function yallopZoneLabel(zone) {
  const labels = {
    A: 'A — Easily visible (naked eye)',
    B: 'B — Visible under perfect conditions',
    C: 'C — Optical aid to locate, then naked eye',
    D: 'D — Optical aid only',
    E: 'E — Not visible with telescope',
    F: 'F — Impossible / below Danjon limit',
  };
  return labels[zone] || labels.F;
}

/**
 * Predict continuous naked-eye sighting probability from fitted empirical model.
 * Returns { nationalProb, stationProb } in [0, 1].
 */
export function predictNakedEyeProb(metrics, modelParams) {
  if (!metrics || !metrics.valid) return { nationalProb: 0, stationProb: 0 };
  const limits = modelParams.hard_limits || { min_arcl_deg: 6.4, min_lag_min: 0 };
  if (
    metrics.lagMin <= limits.min_lag_min ||
    (metrics.ageHours !== null && metrics.ageHours <= 0) ||
    metrics.arclDeg < limits.min_arcl_deg
  ) {
    return { nationalProb: 0, stationProb: 0 };
  }
  const z = modelParams.b0 + modelParams.b1 * metrics.q;
  const pNat = 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));
  const kEff = modelParams.k_eff || 2.5;
  const pStation = 1 - Math.pow(1 - pNat, 1 / kEff);
  return { nationalProb: pNat, stationProb: pStation };
}

/**
 * Empirical historical-analog lookup: finds South African 29th evenings
 * with similar crescent visibility `sa_best_q` within ±windowQ.
 */
export function findEmpiricalAnalogs(targetQ, historicalObs, windowQ = 0.08) {
  if (!Number.isFinite(targetQ) || !historicalObs?.length) {
    return { count: 0, sightedCount: 0, empiricalRate: null, analogs: [] };
  }
  const scored = [];
  for (const obs of historicalObs) {
    if (!Number.isFinite(obs.sa_best_q)) continue;
    const dq = Math.abs(obs.sa_best_q - targetQ);
    if (dq <= windowQ) {
      scored.push({ ...obs, dq });
    }
  }
  scored.sort((a, b) => a.dq - b.dq);
  // If fewer than 5 analogs in narrow window, widen slightly for context
  let pool = scored;
  let usedWindow = windowQ;
  if (pool.length < 5) {
    usedWindow = windowQ * 1.75;
    pool = historicalObs
      .filter((o) => Number.isFinite(o.sa_best_q) && Math.abs(o.sa_best_q - targetQ) <= usedWindow)
      .map((o) => ({ ...o, dq: Math.abs(o.sa_best_q - targetQ) }))
      .sort((a, b) => a.dq - b.dq);
  }
  const sightedCount = pool.filter((o) => o.sighted === true).length;
  return {
    count: pool.length,
    sightedCount,
    empiricalRate: pool.length ? sightedCount / pool.length : null,
    usedWindow,
    analogs: pool.slice(0, 12),
  };
}

/**
 * Dynamically generate Islamic events (Ramadan, Eid al-Fitr, Eid al-Adha)
 * centered around `refDate` using exact astronomical lunations anchored to
 * 1447 Shawwal (lunation 17374 = 2026-03-19T01:24Z), plus past-year historic sightings.
 */
export function buildIslamicEvents(refDate = new Date(), historicalObs = []) {
  const SYNODIC_MS = 29.530588853 * 86400 * 1000;
  const ANCHOR_LUNATION = 1447 * 12 + 10; // 1447 Shawwal
  const ANCHOR_CONJ_MS = Date.UTC(2026, 2, 19, 1, 24, 5);

  const obsByKey = new Map();
  for (const o of historicalObs || []) {
    obsByKey.set(`${o.hy}-${o.hm}`, o);
  }

  const approxLunationsSinceAnchor = Math.round((refDate.getTime() - ANCHOR_CONJ_MS) / SYNODIC_MS);
  const currentHijriYear = Math.floor((ANCHOR_LUNATION + approxLunationsSinceAnchor) / 12);
  const startYear = Math.max(1429, currentHijriYear - 2);
  const endYear = currentHijriYear + 3;

  const defs = [];
  for (let hy = startYear; hy <= endYear; hy++) {
    defs.push({
      id: `${hy}-rmd`,
      hijriYear: hy,
      monthNum: 9,
      baseLabel: `Ramadan ${hy} AH`,
      shortLabel: `Ramadan ${hy}`,
      eidType: 'ramadan',
    });
    defs.push({
      id: `${hy}-shw`,
      hijriYear: hy,
      monthNum: 10,
      baseLabel: `Eid al-Fitr ${hy} AH`,
      shortLabel: `Eid al-Fitr ${hy}`,
      eidType: 'fitr',
    });
    defs.push({
      id: `${hy}-zhj`,
      hijriYear: hy,
      monthNum: 12,
      baseLabel: `Eid al-Adha ${hy} AH`,
      shortLabel: `Eid al-Adha ${hy}`,
      eidType: 'adha',
    });
  }

  const todayIso = refDate.toISOString().slice(0, 10);
  const allEvents = defs.map((ev) => {
    const lunIdx = ev.hijriYear * 12 + ev.monthNum;
    const approxMs = ANCHOR_CONJ_MS + (lunIdx - ANCHOR_LUNATION) * SYNODIC_MS;
    const conj = Astronomy.SearchMoonPhase(0, new Date(approxMs - 5 * 86400 * 1000), 10);
    const conjDateIso = conj.date.toISOString().slice(0, 10);
    const obs = obsByKey.get(`${ev.hijriYear}-${ev.monthNum}`);

    const conjHourUt = conj.date.getUTCHours() + conj.date.getUTCMinutes() / 60;
    const evening1 = obs?.ev || (conjHourUt >= 6 ? addDaysIso(conjDateIso, 1) : conjDateIso);
    const evening2 = addDaysIso(evening1, 1);
    const offsetDays = ev.eidType === 'adha' ? 9 : 0;
    const day1Date = addDaysIso(evening1, 1 + offsetDays);
    const day2Date = addDaysIso(evening1, 2 + offsetDays);
    const isHistoric = day2Date < todayIso;
    const monthTag = new Date(day1Date + 'T00:00:00Z').toLocaleDateString('en-US', {
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    });
    const historicSaDate = obs ? (ev.eidType === 'adha' ? obs.eid : obs.start) : null;

    return {
      ...ev,
      label: isHistoric ? `${ev.baseLabel} (${monthTag})` : `${ev.baseLabel} (${monthTag})`,
      conjunctionUtc: conj.date.toISOString(),
      evening1,
      evening2,
      day1Date,
      day2Date,
      monthStart1: addDaysIso(evening1, 1),
      monthStart2: addDaysIso(evening1, 2),
      isHistoric,
      historicSaDate,
      historicSighted: obs ? obs.sighted : null,
    };
  });

  const upcoming = allEvents.filter((e) => !e.isHistoric);
  const pastAll = allEvents.filter((e) => e.isHistoric);
  // Show at least the last 3 historic sightings, or all within the past ~395 days
  const oneYearAgoMs = refDate.getTime() - 395 * 86400 * 1000;
  const pastYear = pastAll.filter((e) => new Date(e.day2Date + 'T00:00:00Z').getTime() >= oneYearAgoMs);
  const historicEvents = pastYear.length >= 3 ? pastYear : pastAll.slice(-3);

  const events = [...historicEvents, ...upcoming];
  const nextEid = upcoming.find((e) => e.eidType !== 'ramadan') || upcoming[0] || events[0];
  return { events, historicEvents, upcomingEvents: upcoming, defaultEventId: nextEid.id };
}

/**
 * Evaluate Turkey / ECFR 2016 global criterion anywhere on Earth on `dateIso`:
 * Moon altitude > 5° and elongation > 8° at local sunset.
 */
export function evaluateTurkeyGlobal(dateIso) {
  for (let lat = -55; lat <= 55; lat += 10) {
    for (let lon = -180; lon <= 165; lon += 15) {
      const m = evaluateCrescent(dateIso, lat, lon, 0);
      if (m.valid && m.moonAltSunset > 5 && m.arclSunsetDeg > 8) {
        return { met: true, sampleLat: lat, sampleLon: lon, alt: m.moonAltSunset, arcl: m.arclSunsetDeg };
      }
    }
  }
  return { met: false };
}

/**
 * Compute Day 1 / Day 2 probabilities for the selected event and jurisdiction/city.
 */
export function computeEidDayProbabilities(event, selection, modelParams) {
  const ev1 = event.evening1;
  const zone = selection.zone || 'local_sighting';

  // Evaluate local location metrics on Evening 1
  const localEv1 = evaluateCrescent(ev1, selection.lat, selection.lon, selection.elevation_m || 0);
  const localEv2 = evaluateCrescent(event.evening2, selection.lat, selection.lon, selection.elevation_m || 0);
  const { stationProb: localP1 } = predictNakedEyeProb(localEv1, modelParams);

  // Saudi Makkah metrics (used for Saudi-following jurisdictions)
  const makkahEv1 = evaluateCrescent(ev1, 21.4225, 39.8262, 277);
  const makkahConjBeforeSS =
    makkahEv1.valid &&
    makkahEv1.conjunctionUtc &&
    new Date(makkahEv1.conjunctionUtc).getTime() < makkahEv1.sunsetTime.date.getTime();
  const ummAlQuraDay1 = makkahConjBeforeSS && makkahEv1.lagMin > 0;

  let pDay1 = localP1;
  let saAnchorBest = null;
  let ruleExplanation = '';

  if (selection.iso === '710' || selection.country === 'South Africa') {
    // Evaluate across all 4 geographic weather hubs under COSSA/UUCSA national consensus rule
    const stationEvals = SA_ANCHOR_STATIONS.map((st) => {
      const m = evaluateCrescent(ev1, st.lat, st.lon, st.elevation_m);
      const probs = predictNakedEyeProb(m, modelParams);
      return { ...st, metrics: m, ...probs };
    });
    saAnchorBest = stationEvals.reduce((best, cur) => (cur.metrics.q > best.metrics.q ? cur : best), stationEvals[0]);
    // Calibrated national probability directly from SA best clear-horizon score
    pDay1 = saAnchorBest.nationalProb;
    ruleExplanation =
      'COSSA / UUCSA naked-eye rule: if any verified South African station sights the crescent on the 29th evening, the new month starts the next day nationwide.';
  } else if (zone === 'follow_saudi') {
    pDay1 = ummAlQuraDay1 ? 0.92 : 0.08;
    ruleExplanation = ummAlQuraDay1
      ? 'Follows Saudi Arabia (Umm al-Qura: conjunction precedes Makkah sunset & moonset lags sunset on Evening 29).'
      : 'Follows Saudi Arabia (Umm al-Qura criterion not met in Makkah on Evening 29; Day 2 highly likely).';
  } else if (zone === 'follow_turkey_diyanet') {
    const tr = evaluateTurkeyGlobal(ev1);
    pDay1 = tr.met ? 0.99 : 0.01;
    ruleExplanation = tr.met
      ? `Turkey / ECFR global calculation met (Alt ${tr.alt.toFixed(1)}° > 5°, Elong ${tr.arcl.toFixed(1)}° > 8° near ${tr.sampleLat}°, ${tr.sampleLon}°).`
      : 'Turkey / ECFR global calculation NOT met anywhere on Earth on Evening 29 — month starts Day 2.';
  } else if (zone === 'regional_criteria') {
    // Check MABIMS 3°/6.4° for SE Asia or local empirical
    const mabimsMet = localEv1.valid && localEv1.moonAltSunset >= 3 && localEv1.arclSunsetDeg >= 6.4;
    pDay1 = mabimsMet ? Math.max(0.75, localP1) : Math.min(0.2, localP1);
    ruleExplanation = mabimsMet
      ? `Regional astronomical criteria met locally (Sunset Alt ${localEv1.moonAltSunset.toFixed(1)}° ≥ 3°, Elong ${localEv1.arclSunsetDeg.toFixed(1)}° ≥ 6.4°).`
      : `Regional astronomical criteria not met locally on Evening 29 (Sunset Alt ${localEv1.moonAltSunset?.toFixed(1) ?? '—'}°, Elong ${localEv1.arclSunsetDeg?.toFixed(1) ?? '—'}°).`;
  } else {
    // Local sighting outside SA
    pDay1 = localP1;
    ruleExplanation =
      zone === 'split_communities'
        ? 'Split communities: probability shown reflects local physical naked-eye sighting; Saudi-following mosques may differ by 1 day.'
        : 'Local physical sighting: probability reflects naked-eye visibility on Evening 29 at this location.';
  }

  const pDay2 = Math.max(0, 1 - pDay1);
  return {
    days: [
      {
        dateIso: event.day1Date,
        displayDate: formatDisplayDate(event.day1Date),
        weekday: getWeekdayName(event.day1Date),
        probability: pDay1,
        label: event.eidType === 'adha' ? 'If 1st Dhul Hijjah sighted on Ev. 29' : '29-day preceding month (Sighted)',
      },
      {
        dateIso: event.day2Date,
        displayDate: formatDisplayDate(event.day2Date),
        weekday: getWeekdayName(event.day2Date),
        probability: pDay2,
        label: event.eidType === 'adha' ? 'If 30 days completed for Dhul Qadah' : '30-day preceding month (Not sighted)',
      },
    ],
    localEv1,
    localEv2,
    localStationProb1: localP1,
    saAnchorBest,
    makkahEv1,
    ruleExplanation,
  };
}
