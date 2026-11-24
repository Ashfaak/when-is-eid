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
  formatTimeInOffset,
  formatUtcTime,
  HIJRI_MONTH_SHORT,
  predictNakedEyeProb,
  yallopZoneLabel,
} from './astronomy.js';
import { EidMapController } from './map.js';
import { renderEmpiricalScatter } from './scatter.js';

const { events, historicEvents, upcomingEvents, defaultEventId } = buildIslamicEvents(
  new Date(),
  empiricalData.historical_observations
);

const state = {
  eventId: defaultEventId,
  eveningIdx: 0, // 0 = Evening 1 (29th), 1 = Evening 2 (30th)
  surfaceMode: 'continuous',
  heatmapEnabled: true,
  showStations: true,
  showReports: false,
  showJurisdictions: true,
  showArcs: false,
  selection: {
    name: 'South Africa (National COSSA Network)',
    country: 'South Africa',
    iso: '710',
    lat: -33.9178,
    lon: 18.4028,
    elevation_m: 340,
    zone: 'local_sighting',
    zoom: 5,
  },
};

const dom = {
  eventSelect: document.getElementById('event-select'),
  searchInput: document.getElementById('location-search'),
  searchResults: document.getElementById('search-results'),
  clearSearch: document.getElementById('clear-search'),
  btnEv1: document.getElementById('btn-ev1'),
  btnEv2: document.getElementById('btn-ev2'),
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
  modeContinuous: document.getElementById('mode-continuous'),
  modeQuantized: document.getElementById('mode-quantized'),
  chkHeatmap: document.getElementById('chk-heatmap'),
  chkStations: document.getElementById('chk-stations'),
  chkReports: document.getElementById('chk-reports'),
  chkJurisdictions: document.getElementById('chk-jurisdictions'),
  chkArcs: document.getElementById('chk-arcs'),
  mapLegend: document.getElementById('map-legend'),
};

// Populate grouped event dropdown: Upcoming Events + Past Year Historic Sightings
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
});

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
  mapCtrl.focusLocation(loc.lat, loc.lon, zoom, loc.name);
  renderAll();
}

function buildSearchIndex() {
  const countryEntries = jurisdictionsData.countries.map((c) => ({
    kind: 'country',
    label: c.name,
    sub: `${c.zone_label} · ${c.authority}`,
    searchKey: `${c.name} ${c.authority}`.toLowerCase(),
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
    searchKey: `${city.name} ${city.city || ''} ${city.country} ${city.province || ''}`.toLowerCase(),
    payload: {
      ...city,
      zoom: city.is_sa_station ? 10 : 8,
    },
  }));

  return [...countryEntries, ...cityEntries];
}

const searchIndex = buildSearchIndex();

function handleSearchInput() {
  const q = dom.searchInput.value.trim().toLowerCase();
  if (!q) {
    dom.searchResults.classList.add('hidden');
    return;
  }
  const hits = searchIndex
    .filter((item) => item.searchKey.includes(q))
    .sort((a, b) => {
      const aStarts = a.label.toLowerCase().startsWith(q) ? 0 : 1;
      const bStarts = b.label.toLowerCase().startsWith(q) ? 0 : 1;
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
  const modeHtml =
    state.surfaceMode === 'continuous'
      ? `<div><strong>Continuous Empirical Naked-Eye Probability</strong> (viewport-adaptive)</div>
         <div class="legend-gradient"></div>
         <div class="legend-ticks"><span>0% (Below limit)</span><span>50%</span><span>100%</span></div>`
      : `<div><strong>Quantized Yallop Bands</strong> (2°×2° raster, ±60° lat)</div>
         <div class="zone-legend-grid" style="border-top:none;padding-top:4px;margin-top:4px">
           <div class="zone-dot-item"><span class="zone-dot" style="background:#008000"></span>A: Easily visible</div>
           <div class="zone-dot-item"><span class="zone-dot" style="background:#00d5cc"></span>B: Perfect conds</div>
           <div class="zone-dot-item"><span class="zone-dot" style="background:#787882"></span>C: Optical to find</div>
           <div class="zone-dot-item"><span class="zone-dot" style="background:#ff0000"></span>D: Optical only</div>
         </div>`;

  const zoneHtml = state.showJurisdictions
    ? `<div class="zone-legend-grid">
         <div class="zone-dot-item"><span class="zone-dot" style="background:#14965a"></span>Local Sighting</div>
         <div class="zone-dot-item"><span class="zone-dot" style="background:#38bdf8"></span>Follows Saudi</div>
         <div class="zone-dot-item"><span class="zone-dot" style="background:#a855f7"></span>Turkey / ECFR</div>
         <div class="zone-dot-item"><span class="zone-dot" style="background:#d9a742"></span>Regional Criteria</div>
         <div class="zone-dot-item"><span class="zone-dot" style="background:#ec4899"></span>Split Communities</div>
       </div>`
    : '';

  dom.mapLegend.innerHTML = modeHtml + zoneHtml;
}

function renderAll() {
  const ev = getCurrentEvent();
  const sel = state.selection;
  const activeEvening = state.eveningIdx === 0 ? ev.evening1 : ev.evening2;

  // 1. Next / Historic Eid Probability Card
  const result = computeEidDayProbabilities(ev, sel, empiricalData.model);
  if (ev.isHistoric) {
    dom.heroEyebrow.textContent = 'HISTORIC SIGHTING';
  } else if (ev.eidType === 'ramadan') {
    dom.heroEyebrow.textContent = 'UPCOMING RAMADAN';
  } else {
    dom.heroEyebrow.textContent = 'NEXT RELEVANT EID';
  }
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
  dom.ruleExplanation.textContent = result.ruleExplanation;

  // 2. Empirical Analogs & Scatter Plot
  const activeMetrics = state.eveningIdx === 0
    ? (result.saAnchorBest ? result.saAnchorBest.metrics : result.localEv1)
    : result.localEv2;

  const analogsInfo = findEmpiricalAnalogs(activeMetrics?.q, empiricalData.historical_observations, 0.08);
  if (analogsInfo.count > 0) {
    const empPct = (analogsInfo.empiricalRate * 100).toFixed(0);
    dom.analogSummaryPill.textContent = `${analogsInfo.sightedCount}/${analogsInfo.count} sighted (${empPct}%)`;
  } else {
    dom.analogSummaryPill.textContent = '0 historical analogs';
  }
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

  // 3. Local Sky & Crescent Metrics
  const localM = state.eveningIdx === 0 ? result.localEv1 : result.localEv2;
  const yZone = classifyYallopZone(localM);
  const { stationProb } = predictNakedEyeProb(localM, empiricalData.model);
  dom.yallopPill.textContent = `Yallop ${yZone} · ${(stationProb * 100).toFixed(1)}%`;

  const metricItems = [
    ['Sunset (Approx Local)', formatTimeInOffset(localM.sunsetTime, sel.lon)],
    ['Moonset (Approx Local)', formatTimeInOffset(localM.moonsetTime, sel.lon)],
    ['Lag (Moonset − Sunset)', localM.valid ? `${localM.lagMin.toFixed(1)} min` : '—'],
    ['Moon Age at Sunset', localM.ageHours !== null && localM.ageHours !== undefined ? `${localM.ageHours.toFixed(1)} hrs` : '—'],
    ['Crescent Width W', localM.valid ? `${localM.wArcmin.toFixed(3)}'` : '—'],
    ['Arc of Vision (ARCV)', localM.valid ? `${localM.arcvDeg.toFixed(2)}°` : '—'],
    ['Elongation (ARCL)', localM.valid ? `${localM.arclDeg.toFixed(2)}°` : '—'],
    ['Yallop q / Odeh V', localM.valid ? `${localM.q.toFixed(3)} / ${localM.v.toFixed(2)}` : '—'],
    ['Conjunction (New Moon)', formatUtcTime(localM.conjunctionUtc ? { date: new Date(localM.conjunctionUtc) } : null)],
    ['Yallop Classification', yallopZoneLabel(yZone)],
  ];
  dom.metricsGrid.innerHTML = metricItems
    .map(
      ([k, v]) => `<div class="metric-box"><div class="metric-label">${k}</div><div class="metric-val">${v}</div></div>`
    )
    .join('');

  // 4. South Africa Observation Stations List
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

  // 5. Update Map Layers & Legend
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
    <p><strong>Empirical Calibration:</strong> Calibrated on <strong>${cv.n_samples}</strong> historic South African 29th-evening decisions (1429–1448 AH / 2008–2026) compiled under COSSA/UUCSA naked-eye rules (${cv.n_sighted} sighted, ${cv.n_not_sighted} not sighted; 0 cross-source conflicts).</p>
    <ul>
      <li><strong>5-Fold Cross-Validation:</strong> ROC-AUC = <code>${cv.roc_auc}</code> · Accuracy = <code>${(cv.accuracy * 100).toFixed(1)}%</code> · Brier Score = <code>${cv.brier_score}</code></li>
      <li><strong>50% National Sighting Threshold:</strong> <code>q = ${cv.q50_midpoint}</code> (with hard Danjon limit <code>ARCL ≥ 6.4°</code> and <code>lag &gt; 0 min</code>)</li>
    </ul>
    <h3>Empirical Calibration Bins (South Africa 2008–2026)</h3>
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

dom.clearSearch.addEventListener('click', () => {
  selectLocation(
    {
      name: 'South Africa (National COSSA Network)',
      country: 'South Africa',
      iso: '710',
      lat: -29.0,
      lon: 24.5,
      elevation_m: 340,
      zone: 'local_sighting',
    },
    5
  );
});

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

dom.modeContinuous.addEventListener('click', () => {
  state.surfaceMode = 'continuous';
  dom.modeContinuous.classList.add('active');
  dom.modeQuantized.classList.remove('active');
  renderAll();
});

dom.modeQuantized.addEventListener('click', () => {
  state.surfaceMode = 'quantized';
  dom.modeQuantized.classList.add('active');
  dom.modeContinuous.classList.remove('active');
  renderAll();
});

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

// Initial boot
dom.searchInput.value = 'South Africa';
mapCtrl.setActiveCountry('710');
mapCtrl.focusLocation(-29.0, 24.5, 5, 'South Africa (COSSA/UUCSA)');
renderAll();
