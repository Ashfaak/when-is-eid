import './styles.css';
import empiricalData from './data/empirical_model.json';
import jurisdictionsData from './data/jurisdictions_map.json';
import citiesData from './data/cities.json';
import saStations from './data/sa_stations.json';
import saReports from './data/sa_reports.json';
import {
  buildIslamicEvents,
  classifyYallopZone,
  computeEidDayProbabilities,
  evaluateCrescent,
  findEmpiricalAnalogs,
  formatDisplayDate,
  formatUtcTime,
  HIJRI_MONTH_SHORT,
  predictNakedEyeProb,
  yallopZoneLabel,
} from './astronomy.js';
import { formatLocalTime } from './timezones.js';
import { EidMapController, FLAT_BANDS, HistoryMapController, YALLOP_BANDS } from './map.js';
import { renderEmpiricalScatter } from './scatter.js';

const { events, historicEvents, upcomingEvents, nextEventId, nextEidId, defaultEventId } = buildIslamicEvents(
  new Date(),
  empiricalData.historical_observations
);

const sortedHistory = [...empiricalData.historical_observations].sort((a, b) =>
  b.ev.localeCompare(a.ev)
);

const DEFAULT_SA_SELECTION = {
  name: 'South Africa (National COSSA Network)',
  country: 'South Africa',
  iso: '710',
  lat: -29.0,
  lon: 24.5,
  elevation_m: 340,
  zone: 'local_sighting',
  zoom: 5,
};

const state = {
  viewMode: 'forecast', // 'forecast' | 'history'
  eventId: defaultEventId,
  eveningIdx: 0, // 0 = Evening 1 (29th), 1 = Evening 2 (30th)
  surfaceMode: 'yallop',
  heatmapEnabled: true,
  showStations: true,
  showReports: false,
  showJurisdictions: false,
  showArcs: false,
  selectedHistoryKey: sortedHistory[0] ? `${sortedHistory[0].hy}-${sortedHistory[0].hm}` : null,
  histShowReports: false,
  selection: { ...DEFAULT_SA_SELECTION, lat: -33.9178, lon: 18.4028 },
};

const dom = {
  forecastControls: document.getElementById('forecast-controls'),
  forecastView: document.getElementById('forecast-view'),
  historyView: document.getElementById('history-view'),
  eventSelect: document.getElementById('event-select'),
  searchInput: document.getElementById('location-search'),
  searchResults: document.getElementById('search-results'),
  clearSearch: document.getElementById('clear-search'),
  btnEv1: document.getElementById('btn-ev1'),
  btnEv2: document.getElementById('btn-ev2'),
  btnHistory: document.getElementById('btn-history'),
  btnMethodology: document.getElementById('btn-methodology'),
  btnAcknowledgements: document.getElementById('btn-acknowledgements'),
  modal: document.getElementById('methodology-modal'),
  modalCloseBtn: document.getElementById('modal-close-btn'),
  modalCloseBg: document.getElementById('modal-close-bg'),
  methodologyBody: document.getElementById('methodology-body'),
  ackModal: document.getElementById('acknowledgements-modal'),
  ackCloseBtn: document.getElementById('ack-close-btn'),
  ackCloseBg: document.getElementById('ack-close-bg'),
  ackBody: document.getElementById('acknowledgements-body'),
  heroEyebrow: document.getElementById('hero-eyebrow'),
  heroTitle: document.getElementById('hero-title'),
  jurisdictionBadge: document.getElementById('jurisdiction-badge'),
  selectedLocationLine: document.getElementById('selected-location-line'),
  eidDaysContainer: document.getElementById('eid-days-container'),
  ruleExplanation: document.getElementById('rule-explanation'),
  analogSummaryPill: document.getElementById('analog-summary-pill'),
  analogDescription: document.getElementById('analog-description'),
  scatterContainer: document.getElementById('scatter-container'),
  analogList: document.getElementById('analog-list'),
  yallopPill: document.getElementById('yallop-pill'),
  metricsGrid: document.getElementById('metrics-grid'),
  stationsTitle: document.getElementById('stations-title'),
  stationsCountPill: document.getElementById('stations-count-pill'),
  stationsList: document.getElementById('stations-list'),
  modeYallop: document.getElementById('mode-yallop'),
  modeContinuous: document.getElementById('mode-continuous'),
  modeQuantized: document.getElementById('mode-quantized'),
  chkHeatmap: document.getElementById('chk-heatmap'),
  chkStations: document.getElementById('chk-stations'),
  chkReports: document.getElementById('chk-reports'),
  chkJurisdictions: document.getElementById('chk-jurisdictions'),
  chkArcs: document.getElementById('chk-arcs'),
  mapLegend: document.getElementById('map-legend'),
  // History view DOM
  historyKpis: document.getElementById('history-kpis'),
  histFilterMonth: document.getElementById('hist-filter-month'),
  histFilterOutcome: document.getElementById('hist-filter-outcome'),
  histFilterSearch: document.getElementById('hist-filter-search'),
  histChkReports: document.getElementById('hist-chk-reports'),
  histCountPill: document.getElementById('hist-count-pill'),
  historyTableBody: document.getElementById('history-table-body'),
  historyDetailCard: document.getElementById('history-detail-card'),
  histSelectedPill: document.getElementById('hist-selected-pill'),
  historyScatterContainer: document.getElementById('history-scatter-container'),
  histMapDatePill: document.getElementById('hist-map-date-pill'),
  appTooltip: document.getElementById('app-tooltip'),
};

let historyMapCtrl = null;

function normalizeText(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function populateEventDropdown() {
  dom.eventSelect.innerHTML = '';
  const upcomingGroup = document.createElement('optgroup');
  upcomingGroup.label = 'Upcoming Ramadan & Eid';
  for (const ev of upcomingEvents) {
    const opt = document.createElement('option');
    opt.value = ev.id;
    opt.textContent = ev.label;
    if (ev.id === state.eventId) opt.selected = true;
    upcomingGroup.appendChild(opt);
  }
  dom.eventSelect.appendChild(upcomingGroup);

  if (historicEvents.length) {
    const histGroup = document.createElement('optgroup');
    histGroup.label = 'Past Year — Historic Sightings';
    for (const ev of historicEvents) {
      const opt = document.createElement('option');
      opt.value = ev.id;
      opt.textContent = ev.label;
      if (ev.id === state.eventId) opt.selected = true;
      histGroup.appendChild(opt);
    }
    dom.eventSelect.appendChild(histGroup);
  }
}

populateEventDropdown();

const mapCtrl = new EidMapController({
  containerId: 'map',
  modelParams: empiricalData.model,
  jurisdictionsData,
  saStations,
  saReports,
  onSelectLocation: (loc) => selectLocation(loc, loc.is_sa_station ? 9 : 7),
  onSelectCountry: (countryMeta) => {
    selectLocation(
      {
        name: countryMeta.name,
        country: countryMeta.name,
        iso: countryMeta.iso,
        lat: countryMeta.center[0],
        lon: countryMeta.center[1],
        elevation_m: 0,
        zone: countryMeta.zone,
        authority: countryMeta.authority,
        rule_summary: countryMeta.rule_summary,
      },
      countryMeta.zoom || 5
    );
  },
  onResetCustomPoint: () => resetToSouthAfrica(),
});

function resetToSouthAfrica() {
  state.selection = { ...DEFAULT_SA_SELECTION };
  dom.searchInput.value = 'South Africa';
  dom.searchResults.classList.add('hidden');
  mapCtrl.setActiveCountry('710');
  mapCtrl.resetView(-29.0, 24.5, 5);
  renderAll();
}

function getCurrentEvent() {
  return events.find((e) => e.id === state.eventId) || upcomingEvents[0] || events[0];
}

function getZoneLabel(zone) {
  return jurisdictionsData.zones[zone]?.label || 'Local Sighting';
}

function selectLocation(loc, zoom = 6) {
  state.selection = { ...loc };
  dom.searchInput.value = loc.country === loc.name ? loc.name : `${loc.name}, ${loc.country}`;
  dom.searchResults.classList.add('hidden');
  mapCtrl.setActiveCountry(loc.iso || null);
  mapCtrl.focusLocation(loc.lat, loc.lon, zoom, loc.name, { isCustom: Boolean(loc.isCustom) });
  renderAll();
}

function buildSearchIndex() {
  const countryEntries = jurisdictionsData.countries.map((c) => ({
    kind: 'country',
    label: c.name,
    sub: `${c.zone_label} · ${c.authority}`,
    searchKey: normalizeText(`${c.name} ${c.iso === '792' ? 'turkey' : ''} ${c.authority}`),
    payload: {
      name: c.name,
      country: c.name,
      iso: c.iso,
      lat: c.center[0],
      lon: c.center[1],
      elevation_m: 0,
      zone: c.zone,
      authority: c.authority,
      rule_summary: c.rule_summary,
      zoom: c.zoom || 5,
    },
  }));

  const cityEntries = citiesData.map((city) => ({
    kind: city.is_sa_station ? 'station' : 'city',
    label: `${city.name}, ${city.country}`,
    sub: city.is_sa_station
      ? `COSSA/SA Station · ${city.elevation_m}m ASL · ${city.organization}`
      : `${getZoneLabel(city.zone)} · ${city.lat.toFixed(2)}°, ${city.lon.toFixed(2)}°`,
    searchKey: normalizeText(
      `${city.name} ${city.city || ''} ${city.country} ${city.iso === '792' ? 'turkey' : ''} ${city.province || ''}`
    ),
    payload: {
      ...city,
      zoom: city.is_sa_station ? 10 : 8,
    },
  }));

  return [...countryEntries, ...cityEntries];
}

const searchIndex = buildSearchIndex();

function handleSearchInput() {
  const q = normalizeText(dom.searchInput.value.trim());
  if (!q) {
    dom.searchResults.classList.add('hidden');
    return;
  }
  const hits = searchIndex
    .filter((item) => item.searchKey.includes(q))
    .sort((a, b) => {
      const aStarts = normalizeText(a.label).startsWith(q) ? 0 : 1;
      const bStarts = normalizeText(b.label).startsWith(q) ? 0 : 1;
      if (aStarts !== bStarts) return aStarts - bStarts;
      if (a.kind !== b.kind && a.kind === 'country') return -1;
      return a.label.localeCompare(b.label);
    })
    .slice(0, 14);

  if (!hits.length) {
    dom.searchResults.innerHTML = `<div class="search-item"><span>No matching country or city</span></div>`;
    dom.searchResults.classList.remove('hidden');
    return;
  }

  dom.searchResults.innerHTML = '';
  for (const hit of hits) {
    const row = document.createElement('div');
    row.className = 'search-item';
    row.innerHTML = `<span>${hit.label}</span><small>${hit.kind === 'country' ? 'Country' : hit.kind === 'station' ? 'SA Station' : 'City'}</small>`;
    row.addEventListener('click', () => selectLocation(hit.payload, hit.payload.zoom));
    dom.searchResults.appendChild(row);
  }
  dom.searchResults.classList.remove('hidden');
}

function renderLegend() {
  let modeHtml;
  if (state.surfaceMode === 'yallop') {
    modeHtml = `<div><strong>Yallop Visibility Bands</strong></div>
       <div class="flat-legend-list">
         ${YALLOP_BANDS.map(
           (b) => `<div class="zone-dot-item" data-tip="${b.title}"><span class="zone-dot" style="background:${b.color};border-radius:2px"></span>${b.label}</div>`
         ).join('')}
       </div>`;
  } else if (state.surfaceMode === 'quantized') {
    modeHtml = `<div><strong>Flat Visibility Bands</strong></div>
       <div class="flat-legend-list">
         ${FLAT_BANDS.map(
           (b) => `<div class="zone-dot-item" data-tip="${b.pctRange} local single-site naked-eye sighting probability"><span class="zone-dot" style="background:${b.color};border-radius:2px"></span>${b.label}</div>`
         ).join('')}
       </div>`;
  } else {
    modeHtml = `<div><strong>Continuous Empirical Naked-Eye Probability</strong></div>
       <div class="legend-gradient"></div>
       <div class="legend-ticks"><span>0% (Below limit)</span><span>50%</span><span>100%</span></div>`;
  }

  const zoneHtml = state.showJurisdictions
    ? `<div class="zone-legend-grid">
         <div class="zone-dot-item"><span class="zone-dot" style="background:#14965a"></span>Local Sighting</div>
         <div class="zone-dot-item"><span class="zone-dot" style="background:#38bdf8"></span>Follows Saudi</div>
         <div class="zone-dot-item"><span class="zone-dot" style="background:#a855f7"></span>Türkiye / ECFR</div>
         <div class="zone-dot-item"><span class="zone-dot" style="background:#d9a742"></span>Regional Criteria</div>
         <div class="zone-dot-item"><span class="zone-dot" style="background:#ec4899"></span>Split Communities</div>
       </div>`
    : '';

  dom.mapLegend.innerHTML = modeHtml + zoneHtml;
}

function getHeroEyebrow(ev) {
  if (ev.isHistoric) return 'HISTORIC SIGHTING';
  if (ev.id === nextEidId) return 'NEXT RELEVANT EID';
  if (ev.id === nextEventId && ev.eidType === 'ramadan') return 'NEXT RELEVANT EVENT';
  if (ev.eidType === 'ramadan') return 'FUTURE RAMADAN';
  return 'FUTURE EID';
}

function renderAll() {
  const ev = getCurrentEvent();
  const sel = state.selection;
  const activeEvening = state.eveningIdx === 0 ? ev.evening1 : ev.evening2;

  const result = computeEidDayProbabilities(ev, sel, empiricalData.model);
  dom.heroEyebrow.textContent = getHeroEyebrow(ev);
  dom.heroTitle.textContent = ev.shortLabel;

  const zone = sel.zone || 'local_sighting';
  dom.jurisdictionBadge.className = `badge badge-${zone}`;
  dom.jurisdictionBadge.textContent = getZoneLabel(zone);
  dom.selectedLocationLine.textContent = `${sel.name}${sel.country && sel.country !== sel.name ? ` · ${sel.country}` : ''} · 29th evening: ${ev.evening1}`;

  dom.eidDaysContainer.innerHTML = '';
  for (const day of result.days) {
    const pct = day.probability * 100;
    const isLikely = pct >= 50;
    const barColor = pct >= 70 ? '#14965a' : pct >= 30 ? '#d9a742' : '#64748b';
    const isOfficialSa = (sel.iso === '710' || sel.country === 'South Africa') && ev.historicSaDate === day.dateIso;
    const row = document.createElement('div');
    row.className = `eid-day-row ${isLikely || isOfficialSa ? 'likely' : ''}`;
    row.innerHTML = `
      <div class="eid-day-top">
        <span class="eid-date">${day.displayDate}</span>
        <span class="eid-pct" style="color:${barColor}">${pct.toFixed(1)}%</span>
      </div>
      <div class="eid-bar-track">
        <div class="eid-bar-fill" style="width:${pct.toFixed(1)}%;background:${barColor}"></div>
      </div>
      <div class="eid-sub">${day.label}${isOfficialSa ? ' · Official SA Date ✓' : ''}</div>
    `;
    dom.eidDaysContainer.appendChild(row);
  }

  const isSouthAfrica = sel.iso === '710' || sel.country === 'South Africa';
  const isSpecificSaSite =
    isSouthAfrica && sel.name !== 'South Africa (National COSSA Network)' && sel.name !== 'South Africa';
  if (isSpecificSaSite) {
    const note = document.createElement('div');
    note.className = 'site-vs-national-note';
    note.innerHTML = `<strong>${sel.name} local horizon:</strong> ${(result.localStationProb1 * 100).toFixed(1)}% single-site sighting chance · <strong>Official Eid date:</strong> ${(result.days[0].probability * 100).toFixed(1)}% / ${(result.days[1].probability * 100).toFixed(1)}% (South Africa follows national UUCSA/COSSA consensus across all sites).`;
    dom.eidDaysContainer.appendChild(note);
  }
  dom.ruleExplanation.textContent = result.ruleExplanation;

  const activeMetrics =
    state.eveningIdx === 0
      ? result.saAnchorBest
        ? result.saAnchorBest.metrics
        : result.localEv1
      : result.localEv2;

  const analogsInfo = findEmpiricalAnalogs(activeMetrics?.q, empiricalData.historical_observations, 0.08);
  if (analogsInfo.count > 0) {
    const empPct = (analogsInfo.empiricalRate * 100).toFixed(0);
    dom.analogSummaryPill.textContent = `${analogsInfo.sightedCount}/${analogsInfo.count} sighted (${empPct}%)`;
  } else {
    dom.analogSummaryPill.textContent = '0 historical analogs';
  }
  dom.analogSummaryPill.dataset.tip =
    'Count and percentage of historic South African 29th evenings (2009–2026) whose Yallop q fell within ±0.08 of this evening.';
  dom.analogDescription.textContent =
    `Evaluated for ${activeEvening} (${state.eveningIdx === 0 ? '29th' : '30th'} evening)${result.saAnchorBest && state.eveningIdx === 0 ? ` at SA best horizon (${result.saAnchorBest.name})` : ''}. Gold diamond = candidate evening; shaded band = similar visibility size (Δq ± ${analogsInfo.usedWindow?.toFixed(2) || '0.08'}).`;

  renderEmpiricalScatter(dom.scatterContainer, empiricalData.historical_observations, activeMetrics, analogsInfo);

  dom.analogList.innerHTML = '';
  for (const a of analogsInfo.analogs.slice(0, 8)) {
    const shortMonth = HIJRI_MONTH_SHORT[a.hm] || a.hname;
    const chip = document.createElement('span');
    chip.className = `analog-chip ${a.sighted ? 'yes' : 'no'}`;
    chip.title = `${a.hname} ${a.hy} AH (${a.ev}) — W=${a.w.toFixed(2)}', ARCV=${a.arcv.toFixed(1)}°, q=${a.sa_best_q.toFixed(2)}`;
    chip.textContent = `${shortMonth} ${a.hy} ${a.sighted ? '✓' : '✕'}`;
    dom.analogList.appendChild(chip);
  }

  const localM = state.eveningIdx === 0 ? result.localEv1 : result.localEv2;
  const yZone = classifyYallopZone(localM);
  const { stationProb } = predictNakedEyeProb(localM, empiricalData.model);
  dom.yallopPill.textContent = `Yallop ${yZone} · ${(stationProb * 100).toFixed(1)}%`;
  dom.yallopPill.dataset.tip =
    'Yallop 1997 visibility zone (A–F) paired with this specific location’s single-site naked-eye sighting probability.';

  const sunsetFmt = formatLocalTime(localM.sunsetTime, sel);
  const moonsetFmt = formatLocalTime(localM.moonsetTime, sel);
  const tzNote = sunsetFmt.ianaTz ? ` (${sunsetFmt.ianaTz}, automatic DST applied)` : ' (nautical longitude estimate)';

  const metricItems = [
    [
      sunsetFmt.isExact ? 'Sunset (Local)' : 'Sunset (Approx Local)',
      sunsetFmt.text,
      `Local solar sunset time on the selected observation evening${tzNote}.`,
    ],
    [
      moonsetFmt.isExact ? 'Moonset (Local)' : 'Moonset (Approx Local)',
      moonsetFmt.text,
      `Local upper-limb moonset time on the selected evening${tzNote}.`,
    ],
    [
      'Lag (Moonset − Sunset)',
      localM.valid ? `${localM.lagMin.toFixed(1)} min` : '—',
      'Minutes between sunset and moonset. Negative lag means the Moon sets before the Sun and cannot be seen.',
    ],
    [
      'Moon Age at Sunset',
      localM.ageHours !== null && localM.ageHours !== undefined ? `${localM.ageHours.toFixed(1)} hrs` : '—',
      'Hours elapsed since geocentric conjunction (astronomical New Moon) at local sunset.',
    ],
    [
      'Crescent Width W',
      localM.valid ? `${localM.wArcmin.toFixed(3)}'` : '—',
      'Topocentric angular thickness of the lit crescent in arcminutes (′). Wider crescents are easier for the naked eye to resolve.',
    ],
    [
      'Arc of Vision (ARCV)',
      localM.valid ? `${localM.arcvDeg.toFixed(2)}°` : '—',
      'Altitude difference between the Moon and Sun at best observation time (sunset + 4/9 of lag). Controls twilight sky brightness.',
    ],
    [
      'Elongation (ARCL)',
      localM.valid ? `${localM.arclDeg.toFixed(2)}°` : '—',
      'Angular separation between the Sun and Moon in degrees. Below the Danjon limit (~6.4°–7°), no lit crescent can form.',
    ],
    [
      'Yallop q / Odeh V',
      localM.valid ? `${localM.q.toFixed(3)} / ${localM.v.toFixed(2)}` : '—',
      'Combined crescent visibility indices balancing ARCV against crescent width W. Higher values indicate an easier naked-eye sighting.',
    ],
    [
      'Conjunction (New Moon)',
      formatUtcTime(localM.conjunctionUtc ? { date: new Date(localM.conjunctionUtc) } : null),
      'Exact UTC instant of geocentric New Moon conjunction (0° ecliptic elongation) for this lunar month.',
    ],
    [
      'Yallop Classification',
      yallopZoneLabel(yZone),
      'Bernard Yallop (1997, HMNAO TN 69) global visibility category A–F based on q.',
    ],
  ];
  dom.metricsGrid.innerHTML = metricItems
    .map(
      ([k, v, tip]) =>
        `<div class="metric-box" data-tip="${tip}"><div class="metric-label has-tip">${k}</div><div class="metric-val">${v}</div></div>`
    )
    .join('');

  dom.stationsList.innerHTML = '';
  const stationRows = saStations
    .map((st) => {
      const m = evaluateCrescent(activeEvening, st.lat, st.lon, st.elevation_m || 0);
      const { stationProb: p } = predictNakedEyeProb(m, empiricalData.model);
      return { st, m, p };
    })
    .sort((a, b) => b.p - a.p);

  for (const { st, m, p } of stationRows) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `station-row ${sel.name === st.name ? 'active' : ''}`;
    const pctColor = p >= 0.7 ? '#34d399' : p >= 0.3 ? '#f2cb6b' : '#9fb0cb';
    btn.innerHTML = `
      <div>
        <div class="station-name">${st.name}</div>
        <div class="station-meta">${st.city} (${st.province}) · ${st.elevation_m}m · Lag ${m.valid ? m.lagMin.toFixed(0) : '—'}m</div>
      </div>
      <div class="station-prob" style="color:${pctColor}">${(p * 100).toFixed(0)}%</div>
    `;
    btn.addEventListener('click', () => {
      selectLocation(
        {
          name: st.name,
          city: st.city,
          country: 'South Africa',
          iso: '710',
          lat: st.lat,
          lon: st.lon,
          elevation_m: st.elevation_m || 0,
          zone: 'local_sighting',
          is_sa_station: true,
        },
        10
      );
    });
    dom.stationsList.appendChild(btn);
  }

  mapCtrl.updateVisibility({
    dateIso: activeEvening,
    mode: state.surfaceMode,
    heatmapEnabled: state.heatmapEnabled,
    showStations: state.showStations,
    showReports: state.showReports,
    showJurisdictions: state.showJurisdictions,
    showArcs: state.showArcs,
  });
  renderLegend();
}

// ---------------------------------------------------------------------------
// Dedicated History Archive Mode (Zero Forecasts)
// ---------------------------------------------------------------------------

function getFilteredHistory() {
  const mf = dom.histFilterMonth.value;
  const of = dom.histFilterOutcome.value;
  const q = normalizeText(dom.histFilterSearch.value.trim());

  return sortedHistory.filter((r) => {
    if (mf === 'eid_ram' && ![9, 10, 12].includes(r.hm)) return false;
    if (mf !== 'all' && mf !== 'eid_ram' && String(r.hm) !== mf) return false;
    if (of === 'sighted' && !r.sighted) return false;
    if (of === 'not_sighted' && r.sighted) return false;
    if (q) {
      const hay = normalizeText(
        `${r.hy} ${r.hname} ${HIJRI_MONTH_SHORT[r.hm] || ''} ${r.ev} ${r.start} ${r.eid || ''} ${(r.cities || []).join(' ')}`
      );
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function renderHistoryKpis() {
  const total = sortedHistory.length;
  const sighted = sortedHistory.filter((r) => r.sighted).length;
  const notSighted = total - sighted;
  const oldest = sortedHistory[sortedHistory.length - 1];
  const newest = sortedHistory[0];
  dom.historyKpis.innerHTML = `
    <div class="kpi-chip" data-tip="Total verified monthly South African UUCSA / COSSA / MCW crescent decisions stored in the archive."><span class="kpi-label has-tip">Stored Decisions</span><strong>${total}</strong></div>
    <div class="kpi-chip kpi-yes" data-tip="Months where a verified naked-eye crescent sighting was confirmed in South Africa on the 29th evening (29-day preceding month)."><span class="kpi-label has-tip">Sighted on 29th</span><strong>${sighted}</strong></div>
    <div class="kpi-chip kpi-no" data-tip="Months with no confirmed South African sighting on the 29th evening, completing 30 days (Istikmal)."><span class="kpi-label has-tip">Not Sighted (30d)</span><strong>${notSighted}</strong></div>
    <div class="kpi-chip" data-tip="Hijri year range covered by the stored South African observation records."><span class="kpi-label has-tip">Archive Span</span><strong>${oldest?.hy}–${newest?.hy} AH</strong></div>
    <div class="kpi-chip" data-tip="Individual GPS-tagged South African field observer reports imported from HilalWatchZA."><span class="kpi-label has-tip">GPS Field Logs</span><strong>${saReports.length}</strong></div>
  `;
}

function renderHistoryInspector(obs) {
  if (!obs) return;
  const key = `${obs.hy}-${obs.hm}`;
  dom.histSelectedPill.textContent = `${HIJRI_MONTH_SHORT[obs.hm] || obs.hname} ${obs.hy}`;
  dom.histMapDatePill.textContent = obs.ev;

  const outcomeBadge = obs.sighted
    ? `<span class="badge badge-local_sighting">Sighted on 29th (29d prev) ✓</span>`
    : `<span class="badge badge-split_communities">Not Sighted (30d Istikmal) ✕</span>`;

  const citiesStr = obs.cities?.length ? obs.cities.join(', ') : 'National bulletin (no city listed)';
  const srcStr = (obs.src || []).join(', ');

  dom.historyDetailCard.innerHTML = `
    <div class="card-header">
      <div>
        <div class="eyebrow">STORED HISTORICAL RECORD</div>
        <h2>${obs.hname} ${obs.hy} AH</h2>
      </div>
      ${outcomeBadge}
    </div>
    <div class="location-line">29th Evening: ${formatDisplayDate(obs.ev)} (${obs.ev})</div>
    <div class="metrics-grid">
      <div class="metric-box" data-tip="Official 1st Gregorian date of this Hijri month as declared in South Africa."><div class="metric-label has-tip">1st of Month (SA)</div><div class="metric-val">${obs.start || '—'}</div></div>
      <div class="metric-box" data-tip="${obs.hm === 12 || obs.hm === 10 ? 'Official Eid date celebrated in South Africa for this lunar month.' : 'Best-horizon South African weather hub used to score this evening.'}"><div class="metric-label has-tip">${obs.hm === 12 ? 'Eid al-Adha (10th)' : obs.hm === 10 ? 'Eid al-Fitr (1st)' : 'Anchor Station'}</div><div class="metric-val">${obs.eid || obs.best_st || '—'}</div></div>
      <div class="metric-box" data-tip="Topocentric Crescent Width (W′) in arcminutes at the best South African horizon."><div class="metric-label has-tip">Crescent Width W′</div><div class="metric-val">${obs.w.toFixed(3)}'</div></div>
      <div class="metric-box" data-tip="Arc of Vision (vertical Sun–Moon separation at best time) and Elongation (ARCL, angular Sun–Moon separation) in degrees."><div class="metric-label has-tip">ARCV / ARCL</div><div class="metric-val">${obs.arcv.toFixed(2)}° / ${obs.arcl.toFixed(2)}°</div></div>
      <div class="metric-box" data-tip="Minutes elapsed between local sunset and moonset at the anchor horizon."><div class="metric-label has-tip">Sunset–Moonset Lag</div><div class="metric-val">${obs.lag.toFixed(1)} min</div></div>
      <div class="metric-box" data-tip="Yallop 1997 (q) and Odeh 2004 (V) empirical visibility indices at South Africa’s best horizon."><div class="metric-label has-tip">Yallop q / Odeh V</div><div class="metric-val">${obs.sa_best_q.toFixed(3)} / ${obs.sa_best_v.toFixed(2)}</div></div>
    </div>
    <p class="rule-note"><strong>Logged Cities:</strong> ${citiesStr} · <strong>Sources:</strong> <code>${srcStr}</code></p>
  `;

  const pointMetrics = { valid: true, wArcmin: obs.w, arcvDeg: obs.arcv, q: obs.sa_best_q };
  renderEmpiricalScatter(dom.historyScatterContainer, sortedHistory, pointMetrics, { usedWindow: 0.05, analogs: [obs] });

  if (!historyMapCtrl) {
    historyMapCtrl = new HistoryMapController({
      containerId: 'history-map',
      modelParams: empiricalData.model,
      saStations,
      saReports,
    });
  }
  requestAnimationFrame(() => {
    historyMapCtrl.map.invalidateSize({ pan: false });
    historyMapCtrl.renderRecord(obs, state.histShowReports);
  });
}

function renderHistoryView() {
  renderHistoryKpis();
  const rows = getFilteredHistory();
  dom.histCountPill.textContent = `${rows.length} of ${sortedHistory.length} records`;

  let selectedObs = rows.find((r) => `${r.hy}-${r.hm}` === state.selectedHistoryKey) || rows[0] || sortedHistory[0];
  if (selectedObs) state.selectedHistoryKey = `${selectedObs.hy}-${selectedObs.hm}`;

  dom.historyTableBody.innerHTML = '';
  for (const r of rows) {
    const k = `${r.hy}-${r.hm}`;
    const tr = document.createElement('tr');
    tr.className = k === state.selectedHistoryKey ? 'active' : '';
    const dateCell = r.eid && r.hm === 12 ? `${r.start} (Eid ${r.eid})` : r.start;
    tr.innerHTML = `
      <td><strong>${HIJRI_MONTH_SHORT[r.hm] || r.hname} ${r.hy}</strong></td>
      <td class="mono-cell">${r.ev}</td>
      <td><span class="outcome-pill ${r.sighted ? 'yes' : 'no'}">${r.sighted ? 'Sighted ✓' : 'Not Sighted ✕'}</span></td>
      <td class="mono-cell">${dateCell || '—'}</td>
      <td class="mono-cell">${r.w.toFixed(2)}'</td>
      <td class="mono-cell">${r.arcv.toFixed(1)}°</td>
      <td class="mono-cell">${r.lag.toFixed(0)}m</td>
      <td class="mono-cell">${r.sa_best_q.toFixed(2)}</td>
      <td>${(r.cities || []).join(', ') || '—'}</td>
    `;
    tr.addEventListener('click', () => {
      state.selectedHistoryKey = k;
      renderHistoryView();
    });
    dom.historyTableBody.appendChild(tr);
  }
  renderHistoryInspector(selectedObs);
}

function setViewMode(mode) {
  state.viewMode = mode;
  const isHist = mode === 'history';
  dom.forecastView.classList.toggle('hidden', isHist);
  dom.forecastControls.classList.toggle('hidden', isHist);
  dom.historyView.classList.toggle('hidden', !isHist);
  dom.btnHistory.classList.toggle('btn-active-gold', isHist);
  dom.btnHistory.textContent = isHist ? '← Forecasts' : 'History';

  if (isHist) {
    renderHistoryView();
  } else {
    setTimeout(() => mapCtrl.invalidate(), 40);
  }
}

function renderMethodologyModal() {
  const cv = empiricalData.model.cv_metrics;
  const binsHtml = empiricalData.calibration_bins
    .map(
      (b) => `<tr>
        <td>${b.label}</td>
        <td>${b.k} / ${b.n}</td>
        <td>${b.empirical_rate !== null ? (b.empirical_rate * 100).toFixed(1) + '%' : '—'}</td>
        <td>${b.predicted_mean !== null ? (b.predicted_mean * 100).toFixed(1) + '%' : '—'}</td>
      </tr>`
    )
    .join('');

  dom.methodologyBody.innerHTML = `
    <p><strong>Empirical Calibration:</strong> Calibrated on <strong>${cv.n_samples}</strong> historic South African 29th-evening decisions (1429–1448 AH / 2009–2026) compiled under COSSA/UUCSA naked-eye rules (${cv.n_sighted} sighted, ${cv.n_not_sighted} not sighted; 0 cross-source conflicts).</p>
    <ul>
      <li><strong>5-Fold Cross-Validation:</strong> ROC-AUC = <code>${cv.roc_auc}</code> · Accuracy = <code>${(cv.accuracy * 100).toFixed(1)}%</code> · Brier Score = <code>${cv.brier_score}</code></li>
      <li><strong>50% National Sighting Threshold:</strong> <code>q = ${cv.q50_midpoint}</code> (with hard Danjon limit <code>ARCL ≥ 6.4°</code> and <code>lag &gt; 0 min</code>)</li>
    </ul>
    <h3>Empirical Calibration Bins (South Africa 2009–2026)</h3>
    <table>
      <thead><tr><th>Visibility Regime</th><th>Sighted / Total</th><th>Observed Rate</th><th>Model Pred</th></tr></thead>
      <tbody>${binsHtml}</tbody>
    </table>
    <h3>How It Works</h3>
    <p><strong>When is Eid</strong> computes continuous topocentric probabilities in the browser via <code>astronomy-engine</code> at viewport resolution, pairs every forecast with historical South African analogs at the same visibility size, and maps global moonsighting jurisdictions.</p>
  `;
}

function renderAcknowledgementsModal() {
  dom.ackBody.innerHTML = `
    <p><strong>When is Eid</strong> builds upon decades of dedicated physical crescent observation, community broadcasting, and open astronomical science:</p>
    <h3>South African Sighting Bodies &amp; Archives</h3>
    <ul>
      <li><a href="https://www.cossa.co.za/" target="_blank" rel="noopener noreferrer">Crescent Observers Society of South Africa (COSSA)</a> — Cape Town <em>maankykers</em> since 1952/1953, naked-eye protocols, and Western Cape vantage points (Signal Hill, Three Anchor Bay, Bakoven, Stellenbosch, Gordon's Bay, Grabouw).</li>
      <li><a href="https://wifaq.org.za/" target="_blank" rel="noopener noreferrer">Wifaqul Ulama South Africa</a> — Official monthly Hilāl announcements and South African Islamic calendars (2020–present).</li>
      <li><a href="https://hilalwatch.org.za/" target="_blank" rel="noopener noreferrer">HilalWatchZA</a> — South African month-length overrides, horizon profiles, and GPS-tagged sighting reports.</li>
      <li><a href="https://mjc.org.za/" target="_blank" rel="noopener noreferrer">Muslim Judicial Council (MJC)</a> &amp; United Ulama Council of South Africa (UUCSA) — National Hilaal adjudication and community consensus.</li>
      <li><a href="https://jamiat.org.za/" target="_blank" rel="noopener noreferrer">Jamiatul Ulama KwaZulu-Natal</a> &amp; <a href="https://vocfm.co.za/" target="_blank" rel="noopener noreferrer">Voice of the Cape (VOC)</a> — Regional coordination and live 29th-evening broadcasts.</li>
    </ul>
    <h3>Global Sighting Reports &amp; Jurisdiction Data</h3>
    <ul>
      <li><a href="https://www.moonsighting.com/" target="_blank" rel="noopener noreferrer">Moonsighting.com / Moonsighting Committee Worldwide (MCW)</a> — Founded by Syed Khalid Shaukat; South African observer archive reports (1429–1445 AH) by Rashid Motala, Dr. Abdurrazak Ebrahim, Abdullah Salie, Mohamed Iqbal Keeka, Shakil Vayani, and Tehseen Raza Hamdani, plus global country jurisdiction classifications.</li>
    </ul>
    <h3>Astronomical Models &amp; Open-Source Libraries</h3>
    <ul>
      <li>B. D. Yallop (1997, <em>HMNAO Technical Note No. 69</em>), M. Sh. Odeh (2004/2006, <em>ICOP</em>), and J. A. R. Caldwell &amp; C. D. Laney (2001, <em>SAAO Cape Town</em>).</li>
      <li><a href="https://github.com/cosinekitty/astronomy" target="_blank" rel="noopener noreferrer">astronomy-engine</a> · <a href="https://leafletjs.com/" target="_blank" rel="noopener noreferrer">Leaflet</a> · <a href="https://www.openstreetmap.org/" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> · <a href="https://github.com/topojson/world-atlas" target="_blank" rel="noopener noreferrer">world-atlas</a>.</li>
    </ul>
  `;
}

// Event bindings
dom.eventSelect.addEventListener('change', (e) => {
  state.eventId = e.target.value;
  renderAll();
});

dom.searchInput.addEventListener('input', handleSearchInput);
dom.searchInput.addEventListener('focus', handleSearchInput);
document.addEventListener('click', (e) => {
  if (!e.target.closest('.search-group')) dom.searchResults.classList.add('hidden');
});

dom.clearSearch.addEventListener('click', () => resetToSouthAfrica());

dom.btnEv1.addEventListener('click', () => {
  state.eveningIdx = 0;
  dom.btnEv1.classList.add('active');
  dom.btnEv2.classList.remove('active');
  renderAll();
});

dom.btnEv2.addEventListener('click', () => {
  state.eveningIdx = 1;
  dom.btnEv2.classList.add('active');
  dom.btnEv1.classList.remove('active');
  renderAll();
});

function setSurfaceMode(mode) {
  state.surfaceMode = mode;
  dom.modeYallop.classList.toggle('active', mode === 'yallop');
  dom.modeQuantized.classList.toggle('active', mode === 'quantized');
  dom.modeContinuous.classList.toggle('active', mode === 'continuous');
  renderAll();
}

dom.modeYallop.addEventListener('click', () => setSurfaceMode('yallop'));
dom.modeQuantized.addEventListener('click', () => setSurfaceMode('quantized'));
dom.modeContinuous.addEventListener('click', () => setSurfaceMode('continuous'));

dom.chkHeatmap.addEventListener('change', (e) => {
  state.heatmapEnabled = e.target.checked;
  renderAll();
});
dom.chkStations.addEventListener('change', (e) => {
  state.showStations = e.target.checked;
  renderAll();
});
dom.chkReports.addEventListener('change', (e) => {
  state.showReports = e.target.checked;
  renderAll();
});
dom.chkJurisdictions.addEventListener('change', (e) => {
  state.showJurisdictions = e.target.checked;
  renderAll();
});
dom.chkArcs.addEventListener('change', (e) => {
  state.showArcs = e.target.checked;
  renderAll();
});

dom.btnHistory.addEventListener('click', () => {
  setViewMode(state.viewMode === 'forecast' ? 'history' : 'forecast');
});

dom.histFilterMonth.addEventListener('change', renderHistoryView);
dom.histFilterOutcome.addEventListener('change', renderHistoryView);
dom.histFilterSearch.addEventListener('input', renderHistoryView);
dom.histChkReports.addEventListener('change', (e) => {
  state.histShowReports = e.target.checked;
  renderHistoryView();
});

dom.btnMethodology.addEventListener('click', () => {
  renderMethodologyModal();
  dom.modal.classList.remove('hidden');
});
dom.modalCloseBtn.addEventListener('click', () => dom.modal.classList.add('hidden'));
dom.modalCloseBg.addEventListener('click', () => dom.modal.classList.add('hidden'));

dom.btnAcknowledgements.addEventListener('click', () => {
  renderAcknowledgementsModal();
  dom.ackModal.classList.remove('hidden');
});
dom.ackCloseBtn.addEventListener('click', () => dom.ackModal.classList.add('hidden'));
dom.ackCloseBg.addEventListener('click', () => dom.ackModal.classList.add('hidden'));

// Floating explainer tooltips
let activeTipTarget = null;
function showTooltipFor(el) {
  const text = el?.dataset?.tip;
  if (!text) return;
  activeTipTarget = el;
  dom.appTooltip.textContent = text;
  dom.appTooltip.classList.remove('hidden');
  const rect = el.getBoundingClientRect();
  const tipRect = dom.appTooltip.getBoundingClientRect();
  let top = rect.top - tipRect.height - 8;
  if (top < 8) top = rect.bottom + 8;
  let left = rect.left + rect.width / 2 - tipRect.width / 2;
  left = Math.max(8, Math.min(window.innerWidth - tipRect.width - 8, left));
  dom.appTooltip.style.top = `${top}px`;
  dom.appTooltip.style.left = `${left}px`;
}
function hideTooltip() {
  activeTipTarget = null;
  dom.appTooltip.classList.add('hidden');
}
document.addEventListener('mouseover', (e) => {
  const el = e.target.closest?.('[data-tip]');
  if (el) showTooltipFor(el);
  else if (activeTipTarget) hideTooltip();
});
document.addEventListener('mouseout', (e) => {
  if (activeTipTarget && (!e.relatedTarget || !activeTipTarget.contains(e.relatedTarget))) {
    hideTooltip();
  }
});
document.addEventListener('scroll', hideTooltip, true);

// Initial boot
dom.searchInput.value = 'South Africa';
mapCtrl.setActiveCountry('710');
mapCtrl.focusLocation(-29.0, 24.5, 5, 'South Africa (COSSA/UUCSA)');
renderAll();
