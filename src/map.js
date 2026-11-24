/**
 * Interactive Leaflet map for whenIsEid:
 * - Adaptive continuous non-quantized empirical probability surface (Canvas)
 * - Toggleable comparison vs Yallop 2° quantized A-D bands
 * - Global moonsighting jurisdiction zones (world-atlas TopoJSON) + follower arcs
 * - South African 17 observation stations & HilalWatchZA GPS sighting pins
 */
import L from 'leaflet';
import { feature as topoFeature } from 'topojson-client';
import worldAtlas from 'world-atlas/countries-110m.json';
import { classifyYallopZone, evaluateCrescent, predictNakedEyeProb } from './astronomy.js';

function probToRgba(p) {
  if (p <= 0.005) return [0, 0, 0, 0];
  // Smooth multi-stop ramp: rose/amber -> gold -> cyan -> emerald
  const alpha = Math.round(38 + Math.min(1, p * 1.15) * 128);
  let r, g, b;
  if (p < 0.25) {
    const t = p / 0.25;
    r = Math.round(244 + (245 - 244) * t);
    g = Math.round(63 + (158 - 63) * t);
    b = Math.round(94 + (11 - 94) * t);
  } else if (p < 0.5) {
    const t = (p - 0.25) / 0.25;
    r = Math.round(245 + (234 - 245) * t);
    g = Math.round(158 + (179 - 158) * t);
    b = Math.round(11 + (8 - 11) * t);
  } else if (p < 0.75) {
    const t = (p - 0.5) / 0.25;
    r = Math.round(234 + (6 - 234) * t);
    g = Math.round(179 + (182 - 179) * t);
    b = Math.round(8 + (212 - 8) * t);
  } else {
    const t = (p - 0.75) / 0.25;
    r = Math.round(6 + (16 - 6) * t);
    g = Math.round(182 + (185 - 182) * t);
    b = Math.round(212 + (129 - 212) * t);
  }
  return [r, g, b, alpha];
}

function zoneToQuantizedRgba(zone) {
  switch (zone) {
    case 'A':
      return [0, 128, 0, 145];
    case 'B':
      return [0, 213, 204, 145];
    case 'C':
      return [120, 120, 130, 140];
    case 'D':
      return [255, 0, 0, 140];
    default:
      return [0, 0, 0, 0];
  }
}

class VisibilityCanvasLayer extends L.Layer {
  constructor(options) {
    super();
    this.dateIso = options.dateIso;
    this.modelParams = options.modelParams;
    this.mode = options.mode || 'continuous'; // 'continuous' | 'quantized'
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
    const size = this._map.getSize();
    if (!size.x || !size.y) return;

    const topLeft = this._map.containerPointToLayerPoint([0, 0]);
    L.DomUtil.setPosition(this.canvas, topLeft);
    this.canvas.style.width = `${size.x}px`;
    this.canvas.style.height = `${size.y}px`;

    // Render on an internal backing buffer (~360px wide) for smooth <15ms interactive updates
    const scale = Math.min(1, 360 / size.x);
    const w = Math.max(80, Math.round(size.x * scale));
    const h = Math.max(60, Math.round(size.y * scale));
    this.canvas.width = w;
    this.canvas.height = h;

    const ctx = this.canvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    if (!this.enabled || !this.dateIso) return;

    const img = ctx.createImageData(w, h);
    const buf = img.data;

    if (this.mode === 'quantized') {
      // Render discrete 2°x2° Yallop A-D bands clipped at +-60° lat
      const cellCache = new Map();
      for (let py = 0; py < h; py++) {
        const cy = (py + 0.5) / scale;
        for (let px = 0; px < w; px++) {
          const cx = (px + 0.5) / scale;
          const ll = this._map.containerPointToLatLng([cx, cy]);
          if (ll.lat > 60 || ll.lat < -60) continue;
          const lon = ((ll.lng + 180) % 360 + 360) % 360 - 180;
          const qLat = Math.floor(ll.lat / 2) * 2 + 1;
          const qLon = Math.floor(lon / 2) * 2 + 1;
          const key = `${qLat},${qLon}`;
          let rgba = cellCache.get(key);
          if (!rgba) {
            const m = evaluateCrescent(this.dateIso, qLat, qLon, 0);
            const z = classifyYallopZone(m);
            rgba = zoneToQuantizedRgba(z);
            cellCache.set(key, rgba);
          }
          const idx = (py * w + px) * 4;
          buf[idx] = rgba[0];
          buf[idx + 1] = rgba[1];
          buf[idx + 2] = rgba[2];
          buf[idx + 3] = rgba[3];
        }
      }
      ctx.putImageData(img, 0, 0);
      return;
    }

    // Continuous non-quantized adaptive grid over the exact current viewport
    const gx = 44;
    const gy = 28;
    const gridP = new Float32Array((gx + 1) * (gy + 1));

    for (let j = 0; j <= gy; j++) {
      const cy = (j / gy) * size.y;
      for (let i = 0; i <= gx; i++) {
        const cx = (i / gx) * size.x;
        const ll = this._map.containerPointToLatLng([cx, cy]);
        const clampedLat = Math.max(-72, Math.min(72, ll.lat));
        const lon = ((ll.lng + 180) % 360 + 360) % 360 - 180;
        const m = evaluateCrescent(this.dateIso, clampedLat, lon, 0);
        const { stationProb } = predictNakedEyeProb(m, this.modelParams);
        gridP[j * (gx + 1) + i] = stationProb;
      }
    }

    // Bilinear interpolation to every pixel on the backing canvas
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

        const [r, g, b, a] = probToRgba(p);
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

    // OpenStreetMap tiles styled into dark observatory palette via CSS .leaflet-tile-pane filter
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(this.map);

    // Custom panes to guarantee clean stacking
    this.map.createPane('jurisdictionPane').style.zIndex = 340;
    this.map.createPane('arcsPane').style.zIndex = 480;
    this.map.createPane('stationPane').style.zIndex = 650;

    // 1. Jurisdiction polygons from world-atlas TopoJSON
    const geo = topoFeature(worldAtlas, worldAtlas.objects.countries);
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
    }).addTo(this.map);

    // 2. Visibility surface overlay
    this.visLayer = new VisibilityCanvasLayer({
      dateIso: null,
      modelParams: this.modelParams,
      mode: 'continuous',
      enabled: true,
    }).addTo(this.map);

    // 3. Layer groups for follower arcs, SA stations, HilalWatchZA pins, and active pin
    this.arcsGroup = L.layerGroup().addTo(this.map);
    this.stationsGroup = L.layerGroup().addTo(this.map);
    this.reportsGroup = L.layerGroup();
    this.pinGroup = L.layerGroup().addTo(this.map);

    // Click anywhere on map to inspect coordinates
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
      color: isSel ? '#fde047' : meta.color,
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
      color: '#fde047',
      weight: 2.5,
      fillColor: '#f59e0b',
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
        stationProb >= 0.7 ? '#10b981' : stationProb >= 0.3 ? '#f59e0b' : stationProb > 0.02 ? '#38bdf8' : '#f43f5e';

      const marker = L.circleMarker([st.lat, st.lon], {
        pane: 'stationPane',
        radius: 6,
        color: '#070b14',
        weight: 1.5,
        fillColor: color,
        fillOpacity: 0.95,
      });

      marker.bindPopup(`
        <div style="min-width:210px;font-size:12px;line-height:1.45">
          <strong>${st.name}</strong><br/>
          <span style="color:#94a3b8">${st.province} · ${st.elevation_m} m ASL · ${st.organization}</span><br/>
          <hr style="border:none;border-top:1px solid rgba(148,163,184,0.2);margin:5px 0"/>
          Naked-eye site prob: <strong style="color:${color}">${pct}%</strong><br/>
          W = ${m.valid ? m.wArcmin.toFixed(2) : '—'}' · ARCV = ${m.valid ? m.arcvDeg.toFixed(1) : '—'}° · Lag = ${m.valid ? m.lagMin.toFixed(0) : '—'} min<br/>
          <span style="color:#94a3b8">${st.notes}</span>
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
      marker.bindTooltip(
        `${r.loc} (${r.d}): ${r.vis} · ${r.cond || 'unknown sky'} — ${r.by}`,
        { direction: 'top' }
      );
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
