/**
 * Interactive Leaflet map for When is Eid:
 * - Adaptive continuous non-quantized empirical probability surface (Canvas)
 * - High-resolution 8-level (3-bit) discrete Flat Bands contour mode (no gradient)
 * - Global moonsighting jurisdiction zones (world-atlas TopoJSON) + follower arcs
 * - South African 17 observation stations & HilalWatchZA GPS sighting pins
 * - Dedicated HistoryMapController for inspecting past South African 29th evenings
 */
import L from 'leaflet';
import { feature as topoFeature } from 'topojson-client';
import worldAtlas from 'world-atlas/countries-110m.json';
import { evaluateCrescent, getEveningGridEvaluator, predictNakedEyeProb } from './astronomy.js';

export const FLAT_BANDS = [
  { min: 0.95, max: 1.01, label: 'Easily visible', pctRange: '95–100%', color: '#34d399', rgba: [52, 211, 153, 175] },
  { min: 0.85, max: 0.95, label: 'Readily visible (naked eye)', pctRange: '85–95%', color: '#10b981', rgba: [16, 185, 129, 168] },
  { min: 0.70, max: 0.85, label: 'Visible to naked eye', pctRange: '70–85%', color: '#1ca39b', rgba: [28, 163, 155, 162] },
  { min: 0.50, max: 0.70, label: 'Visible in clear conditions', pctRange: '50–70%', color: '#84cc16', rgba: [132, 204, 22, 156] },
  { min: 0.30, max: 0.50, label: 'Visible if perfect conditions', pctRange: '30–50%', color: '#eab308', rgba: [234, 179, 8, 154] },
  { min: 0.15, max: 0.30, label: 'May need optical aid to find', pctRange: '15–30%', color: '#d97706', rgba: [217, 119, 6, 150] },
  { min: 0.05, max: 0.15, label: 'Needs optical aid to locate', pctRange: '5–15%', color: '#c93b3b', rgba: [201, 59, 59, 145] },
  { min: 0.01, max: 0.05, label: 'Only visible with optical aid', pctRange: '1–5%', color: '#991b1b', rgba: [153, 27, 27, 132] },
];

function unwrapRing(ring) {
  if (!ring.length) return ring;
  const out = [[ring[0][0], ring[0][1]]];
  let minLon = ring[0][0];
  for (let i = 1; i < ring.length; i++) {
    let lon = ring[i][0];
    const prevLon = out[i - 1][0];
    while (lon - prevLon > 180) lon -= 360;
    while (lon - prevLon < -180) lon += 360;
    if (lon < minLon) minLon = lon;
    out.push([lon, ring[i][1]]);
  }
  // Keep rings that cross -180 on the eastern (+180) side (e.g. Fiji poly 1 & Wrangel Island)
  if (minLon < -180) {
    for (let i = 0; i < out.length; i++) out[i][0] += 360;
  }
  return out;
}

function fixAntimeridianGeoJson(geo) {
  return {
    ...geo,
    features: geo.features
      .filter((feat) => String(feat.id) !== '010' && feat.properties?.name !== 'Antarctica')
      .map((feat) => {
        const g = feat.geometry;
        if (!g) return feat;
        if (g.type === 'Polygon') {
          return { ...feat, geometry: { ...g, coordinates: g.coordinates.map(unwrapRing) } };
        }
        if (g.type === 'MultiPolygon') {
          return {
            ...feat,
            geometry: { ...g, coordinates: g.coordinates.map((poly) => poly.map(unwrapRing)) },
          };
        }
        return feat;
      }),
  };
}

function probToRgba(p) {
  if (p <= 0.005) return [0, 0, 0, 0];
  const alpha = Math.round(38 + Math.min(1, p * 1.15) * 128);
  let r, g, b;
  if (p < 0.25) {
    const t = p / 0.25;
    r = Math.round(201 + (217 - 201) * t);
    g = Math.round(59 + (167 - 59) * t);
    b = Math.round(59 + (66 - 59) * t);
  } else if (p < 0.5) {
    const t = (p - 0.25) / 0.25;
    r = Math.round(217 + (242 - 217) * t);
    g = Math.round(167 + (203 - 167) * t);
    b = Math.round(66 + (107 - 66) * t);
  } else if (p < 0.75) {
    const t = (p - 0.5) / 0.25;
    r = Math.round(242 + (28 - 242) * t);
    g = Math.round(203 + (163 - 203) * t);
    b = Math.round(107 + (155 - 107) * t);
  } else {
    const t = (p - 0.75) / 0.25;
    r = Math.round(28 + (20 - 28) * t);
    g = Math.round(163 + (150 - 163) * t);
    b = Math.round(155 + (90 - 155) * t);
  }
  return [r, g, b, alpha];
}

function probToFlatBandRgba(p) {
  if (p < 0.01) return [0, 0, 0, 0];
  for (const band of FLAT_BANDS) {
    if (p >= band.min) return band.rgba;
  }
  return [0, 0, 0, 0];
}

function addDarkOsmTiles(map) {
  return L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19,
  }).addTo(map);
}

class VisibilityCanvasLayer extends L.Layer {
  constructor(options) {
    super();
    this.dateIso = options.dateIso;
    this.modelParams = options.modelParams;
    this.mode = options.mode || 'continuous'; // 'continuous' | 'quantized' (8-band flat)
    this.enabled = options.enabled ?? true;
    this.canvas = null;
  }

  onAdd(map) {
    this._map = map;
    const pane = map.getPane('overlayPane');
    this.canvas = L.DomUtil.create('canvas', 'visibility-canvas leaflet-zoom-animated', pane);
    this.canvas.style.pointerEvents = 'none';
    this.canvas.style.position = 'absolute';
    map.on('moveend zoomend resize', this._render, this);
    this._render();
  }

  onRemove(map) {
    map.off('moveend zoomend resize', this._render, this);
    if (this.canvas && this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas);
    }
    this.canvas = null;
  }

  setState({ dateIso, mode, enabled }) {
    if (dateIso !== undefined) this.dateIso = dateIso;
    if (mode !== undefined) this.mode = mode;
    if (enabled !== undefined) this.enabled = enabled;
    this._render();
  }

  _render() {
    if (!this._map || !this.canvas) return;
    const container = this._map.getContainer();
    if (!container || container.offsetParent === null) return;
    const size = this._map.getSize();
    if (!size.x || !size.y) return;

    const topLeft = this._map.containerPointToLayerPoint([0, 0]);
    L.DomUtil.setPosition(this.canvas, topLeft);
    this.canvas.style.width = `${size.x}px`;
    this.canvas.style.height = `${size.y}px`;

    // Higher backing resolution in Flat Bands mode so contour boundaries stay sharp & detailed
    const maxW = this.mode === 'quantized' ? 520 : 380;
    const scale = Math.min(1, maxW / size.x);
    const w = Math.max(80, Math.round(size.x * scale));
    const h = Math.max(60, Math.round(size.y * scale));
    this.canvas.width = w;
    this.canvas.height = h;

    const ctx = this.canvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    if (!this.enabled || !this.dateIso) return;

    const img = ctx.createImageData(w, h);
    const buf = img.data;

    // Viewport-adaptive fast vector-table evaluation grid (smooth & detailed at any zoom, <40ms)
    const evalGridPoint = getEveningGridEvaluator(this.dateIso);
    const gx = 38;
    const gy = 24;
    const gridP = new Float32Array((gx + 1) * (gy + 1));

    for (let j = 0; j <= gy; j++) {
      const cy = (j / gy) * size.y;
      for (let i = 0; i <= gx; i++) {
        const cx = (i / gx) * size.x;
        const ll = this._map.containerPointToLatLng([cx, cy]);
        const clampedLat = Math.max(-72, Math.min(72, ll.lat));
        const lon = ((ll.lng + 180) % 360 + 360) % 360 - 180;
        const m = evalGridPoint(clampedLat, lon);
        const { stationProb } = predictNakedEyeProb(m, this.modelParams);
        gridP[j * (gx + 1) + i] = stationProb;
      }
    }

    const colorFn = this.mode === 'quantized' ? probToFlatBandRgba : probToRgba;

    for (let py = 0; py < h; py++) {
      const fy = (py / (h - 1)) * gy;
      const j0 = Math.min(gy - 1, Math.floor(fy));
      const ty = fy - j0;
      for (let px = 0; px < w; px++) {
        const fx = (px / (w - 1)) * gx;
        const i0 = Math.min(gx - 1, Math.floor(fx));
        const tx = fx - i0;

        const p00 = gridP[j0 * (gx + 1) + i0];
        const p10 = gridP[j0 * (gx + 1) + (i0 + 1)];
        const p01 = gridP[(j0 + 1) * (gx + 1) + i0];
        const p11 = gridP[(j0 + 1) * (gx + 1) + (i0 + 1)];

        const p =
          p00 * (1 - tx) * (1 - ty) +
          p10 * tx * (1 - ty) +
          p01 * (1 - tx) * ty +
          p11 * tx * ty;

        const [r, g, b, a] = colorFn(p);
        const idx = (py * w + px) * 4;
        buf[idx] = r;
        buf[idx + 1] = g;
        buf[idx + 2] = b;
        buf[idx + 3] = a;
      }
    }
    ctx.putImageData(img, 0, 0);
  }
}

export class EidMapController {
  constructor({ containerId, modelParams, jurisdictionsData, saStations, saReports, onSelectLocation, onSelectCountry }) {
    this.modelParams = modelParams;
    this.jurisdictionsData = jurisdictionsData;
    this.saStations = saStations;
    this.saReports = saReports;
    this.onSelectLocation = onSelectLocation;
    this.onSelectCountry = onSelectCountry;

    this.countryByIso = new Map(jurisdictionsData.countries.map((c) => [c.iso, c]));
    this.activeIso = '710';
    this.activeDateIso = null;
    this.surfaceMode = 'continuous';

    this.map = L.map(containerId, {
      center: [-29.0, 24.5],
      zoom: 5,
      minZoom: 2,
      maxZoom: 14,
      worldCopyJump: true,
    });

    addDarkOsmTiles(this.map);

    this.map.createPane('jurisdictionPane').style.zIndex = 340;
    this.map.createPane('arcsPane').style.zIndex = 480;
    this.map.createPane('stationPane').style.zIndex = 650;

    const geo = fixAntimeridianGeoJson(topoFeature(worldAtlas, worldAtlas.objects.countries));
    this.jurisdictionLayer = L.geoJSON(geo, {
      pane: 'jurisdictionPane',
      style: (feat) => this._styleCountry(feat),
      onEachFeature: (feat, layer) => {
        const meta = this.countryByIso.get(String(feat.id));
        const name = meta?.name || feat.properties?.name || 'Unknown';
        const tip = meta
          ? `<strong>${name}</strong><br/><span style="color:${meta.color}">${meta.zone_label}</span><br/>${meta.authority}`
          : `<strong>${name}</strong>`;
        layer.bindTooltip(tip, { sticky: true });
        layer.on('click', (e) => {
          L.DomEvent.stopPropagation(e);
          if (meta) {
            this.onSelectCountry(meta);
          } else {
            this.onSelectLocation({
              name,
              country: name,
              iso: String(feat.id || ''),
              lat: e.latlng.lat,
              lon: e.latlng.lng,
              elevation_m: 0,
              zone: 'local_sighting',
            });
          }
        });
      },
    });

    this.visLayer = new VisibilityCanvasLayer({
      dateIso: null,
      modelParams: this.modelParams,
      mode: 'continuous',
      enabled: true,
    }).addTo(this.map);

    this.arcsGroup = L.layerGroup().addTo(this.map);
    this.stationsGroup = L.layerGroup().addTo(this.map);
    this.reportsGroup = L.layerGroup();
    this.pinGroup = L.layerGroup().addTo(this.map);

    this.map.on('click', (e) => {
      this.onSelectLocation({
        name: `Custom Point (${e.latlng.lat.toFixed(2)}°, ${e.latlng.lng.toFixed(2)}°)`,
        country: 'Custom Coordinates',
        iso: null,
        lat: e.latlng.lat,
        lon: e.latlng.lng,
        elevation_m: 0,
        zone: 'local_sighting',
      });
    });
  }

  invalidate() {
    this.map.invalidateSize();
    this.visLayer._render();
  }

  _styleCountry(feat) {
    const meta = this.countryByIso.get(String(feat.id));
    const isSel = String(feat.id) === this.activeIso;
    if (!meta) {
      return {
        color: 'rgba(148,163,184,0.22)',
        weight: 0.7,
        fillColor: '#0f172a',
        fillOpacity: 0.12,
      };
    }
    return {
      color: isSel ? '#f2cb6b' : meta.color,
      weight: isSel ? 2 : 0.8,
      opacity: isSel ? 0.95 : 0.5,
      fillColor: meta.color,
      fillOpacity: isSel ? 0.14 : 0.08,
    };
  }

  setActiveCountry(iso) {
    this.activeIso = iso;
    if (this.jurisdictionLayer) {
      this.jurisdictionLayer.setStyle((feat) => this._styleCountry(feat));
    }
    this._renderFollowerArcs();
  }

  focusLocation(lat, lon, zoom = 6, label = '') {
    this.map.flyTo([lat, lon], zoom, { duration: 0.65 });
    this.pinGroup.clearLayers();
    const marker = L.circleMarker([lat, lon], {
      pane: 'stationPane',
      radius: 7,
      color: '#f2cb6b',
      weight: 2.5,
      fillColor: '#d9a742',
      fillOpacity: 0.9,
    });
    if (label) marker.bindTooltip(label, { direction: 'top' });
    marker.addTo(this.pinGroup);
  }

  updateVisibility({ dateIso, mode, heatmapEnabled, showStations, showReports, showJurisdictions, showArcs }) {
    this.activeDateIso = dateIso;
    this.surfaceMode = mode;
    this._showArcs = showArcs;

    this.visLayer.setState({ dateIso, mode, enabled: heatmapEnabled });

    if (showJurisdictions) {
      if (!this.map.hasLayer(this.jurisdictionLayer)) this.jurisdictionLayer.addTo(this.map);
    } else {
      if (this.map.hasLayer(this.jurisdictionLayer)) this.map.removeLayer(this.jurisdictionLayer);
    }

    this._renderStations(showStations);
    this._renderReports(showReports);
    this._renderFollowerArcs();
  }

  _renderStations(visible) {
    this.stationsGroup.clearLayers();
    if (!visible || !this.activeDateIso) return;

    for (const st of this.saStations) {
      const m = evaluateCrescent(this.activeDateIso, st.lat, st.lon, st.elevation_m || 0);
      const { stationProb } = predictNakedEyeProb(m, this.modelParams);
      const pct = (stationProb * 100).toFixed(0);
      const color =
        stationProb >= 0.7 ? '#10b981' : stationProb >= 0.3 ? '#d9a742' : stationProb > 0.02 ? '#38bdf8' : '#c93b3b';

      const marker = L.circleMarker([st.lat, st.lon], {
        pane: 'stationPane',
        radius: 6,
        color: '#060c1a',
        weight: 1.5,
        fillColor: color,
        fillOpacity: 0.95,
      });

      marker.bindPopup(`
        <div style="min-width:210px;font-size:12px;line-height:1.45">
          <strong>${st.name}</strong><br/>
          <span style="color:#9eb0cc">${st.province} · ${st.elevation_m} m ASL · ${st.organization}</span><br/>
          <hr style="border:none;border-top:1px solid rgba(148,163,184,0.2);margin:5px 0"/>
          Naked-eye site prob: <strong style="color:${color}">${pct}%</strong><br/>
          W = ${m.valid ? m.wArcmin.toFixed(2) : '—'}' · ARCV = ${m.valid ? m.arcvDeg.toFixed(1) : '—'}° · Lag = ${m.valid ? m.lagMin.toFixed(0) : '—'} min<br/>
          <span style="color:#9eb0cc">${st.notes}</span>
        </div>
      `);

      marker.bindTooltip(`${st.name}: ${pct}%`, { direction: 'top' });
      marker.on('click', () => {
        this.onSelectLocation({
          name: st.name,
          city: st.city,
          country: 'South Africa',
          iso: '710',
          lat: st.lat,
          lon: st.lon,
          elevation_m: st.elevation_m || 0,
          zone: 'local_sighting',
          is_sa_station: true,
        });
      });
      marker.addTo(this.stationsGroup);
    }
  }

  _renderReports(visible) {
    this.reportsGroup.clearLayers();
    if (!visible) {
      if (this.map.hasLayer(this.reportsGroup)) this.map.removeLayer(this.reportsGroup);
      return;
    }
    if (!this.map.hasLayer(this.reportsGroup)) this.reportsGroup.addTo(this.map);

    for (const r of this.saReports) {
      if (typeof r.lat !== 'number' || typeof r.lon !== 'number') continue;
      const seen = r.vis === 'naked' || r.vis === 'optical';
      const marker = L.circleMarker([r.lat, r.lon], {
        pane: 'stationPane',
        radius: 4.5,
        color: '#ffffff',
        weight: 1,
        fillColor: seen ? '#34d399' : '#fb7185',
        fillOpacity: 0.85,
      });
      marker.bindTooltip(`${r.loc} (${r.d}): ${r.vis} · ${r.cond || 'unknown sky'} — ${r.by}`, { direction: 'top' });
      marker.addTo(this.reportsGroup);
    }
  }

  _renderFollowerArcs() {
    this.arcsGroup.clearLayers();
    if (!this._showArcs) return;

    for (const c of this.jurisdictionsData.countries) {
      if (!c.follows_hub || !c.center) continue;
      const [lat1, lon1] = c.center;
      const { lat: lat2, lon: lon2, name: hubName } = c.follows_hub;
      if (Math.abs(lat1 - lat2) < 1 && Math.abs(lon1 - lon2) < 1) continue;

      const midLat = (lat1 + lat2) / 2 + Math.abs(lon1 - lon2) * 0.12;
      const midLon = (lon1 + lon2) / 2;
      const arc = L.polyline(
        [
          [lat1, lon1],
          [midLat, midLon],
          [lat2, lon2],
        ],
        {
          pane: 'arcsPane',
          color: c.color,
          weight: c.iso === this.activeIso ? 2.4 : 1.1,
          opacity: c.iso === this.activeIso ? 0.9 : 0.42,
          dashArray: '4 5',
        }
      );
      arc.bindTooltip(`${c.name} → ${hubName}`);
      arc.addTo(this.arcsGroup);
    }
  }
}

export class HistoryMapController {
  constructor({ containerId, modelParams, saStations, saReports }) {
    this.modelParams = modelParams;
    this.saStations = saStations;
    this.saReports = saReports;

    this.map = L.map(containerId, {
      center: [-29.0, 24.5],
      zoom: 5,
      minZoom: 3,
      maxZoom: 12,
    });
    addDarkOsmTiles(this.map);

    this.map.createPane('histStations').style.zIndex = 650;
    this.visLayer = new VisibilityCanvasLayer({
      dateIso: null,
      modelParams: this.modelParams,
      mode: 'continuous',
      enabled: true,
    }).addTo(this.map);

    this.stationsGroup = L.layerGroup().addTo(this.map);
    this.reportsGroup = L.layerGroup();
  }

  invalidate() {
    this.map.invalidateSize({ pan: false });
    this.visLayer._render();
  }

  renderRecord(obs, showReports = false) {
    if (!obs) return;
    this.visLayer.setState({ dateIso: obs.ev, mode: 'continuous', enabled: true });
    this.stationsGroup.clearLayers();

    const mentioned = new Set((obs.cities || []).map((c) => c.toLowerCase()));
    const evalFast = getEveningGridEvaluator(obs.ev);

    for (const st of this.saStations) {
      const m = evalFast(st.lat, st.lon);
      const isMentioned =
        mentioned.has(st.city.toLowerCase()) ||
        mentioned.has(st.name.toLowerCase()) ||
        [...mentioned].some((c) => st.name.toLowerCase().includes(c));

      const color = isMentioned ? (obs.sighted ? '#34d399' : '#fb7185') : '#38bdf8';
      const marker = L.circleMarker([st.lat, st.lon], {
        pane: 'histStations',
        radius: isMentioned ? 8 : 5,
        color: isMentioned ? '#f2cb6b' : '#060c1a',
        weight: isMentioned ? 2.2 : 1.2,
        fillColor: color,
        fillOpacity: isMentioned ? 0.96 : 0.72,
      });
      marker.bindTooltip(
        `<strong>${st.name}</strong> (${obs.ev})<br/>${
          isMentioned ? 'Logged in this historical record · ' : ''
        }W=${m.valid ? m.wArcmin.toFixed(2) : '—'}', ARCV=${m.valid ? m.arcvDeg.toFixed(1) : '—'}°, Lag=${
          m.valid ? m.lagMin.toFixed(0) : '—'
        }m`,
        { direction: 'top' }
      );
      marker.addTo(this.stationsGroup);
    }

    this.reportsGroup.clearLayers();
    if (showReports) {
      if (!this.map.hasLayer(this.reportsGroup)) this.reportsGroup.addTo(this.map);
      for (const r of this.saReports) {
        if (typeof r.lat !== 'number' || typeof r.lon !== 'number') continue;
        const seen = r.vis === 'naked' || r.vis === 'optical';
        L.circleMarker([r.lat, r.lon], {
          pane: 'histStations',
          radius: 4.5,
          color: '#ffffff',
          weight: 1,
          fillColor: seen ? '#34d399' : '#fb7185',
          fillOpacity: 0.85,
        })
          .bindTooltip(`${r.loc} (${r.d}): ${r.vis} · ${r.cond || 'unknown'} — ${r.by}`)
          .addTo(this.reportsGroup);
      }
    } else if (this.map.hasLayer(this.reportsGroup)) {
      this.map.removeLayer(this.reportsGroup);
    }
  }
}
