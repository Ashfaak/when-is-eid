/**
 * Interactive SVG scatter plot of South African historical 29th evenings
 * in (W_arcmin, ARCV_deg) space, overlaid with Yallop Zone A/B/C curves,
 * the active candidate evening, and its empirical visibility-size band.
 */

function yallopArcvCurve(w, qTarget) {
  return qTarget * 10 + (11.8371 - 6.3226 * w + 0.7319 * w * w - 0.1018 * w * w * w);
}

export function renderEmpiricalScatter(container, historicalObs, currentMetrics, analogsInfo) {
  container.innerHTML = '';
  const width = 360;
  const height = 215;
  const pad = { top: 14, right: 14, bottom: 30, left: 36 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const wMax = 2.6;
  const arcvMin = -2;
  const arcvMax = 24;

  const xScale = (w) => pad.left + (Math.max(0, Math.min(wMax, w)) / wMax) * plotW;
  const yScale = (a) => pad.top + (1 - (Math.max(arcvMin, Math.min(arcvMax, a)) - arcvMin) / (arcvMax - arcvMin)) * plotH;

  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.style.width = '100%';
  svg.style.height = 'auto';
  svg.style.display = 'block';

  const mk = (tag, attrs = {}) => {
    const el = document.createElementNS(svgNS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
  };

  // Grid lines
  for (const a of [0, 5, 10, 15, 20]) {
    const y = yScale(a);
    svg.appendChild(mk('line', { x1: pad.left, y1: y, x2: width - pad.right, y2: y, stroke: 'rgba(148,163,184,0.14)', 'stroke-width': '1' }));
    const lbl = mk('text', { x: pad.left - 6, y: y + 3, fill: '#94a3b8', 'font-size': '9', 'text-anchor': 'end', 'font-family': 'JetBrains Mono, monospace' });
    lbl.textContent = `${a}°`;
    svg.appendChild(lbl);
  }
  for (const w of [0.5, 1.0, 1.5, 2.0, 2.5]) {
    const x = xScale(w);
    svg.appendChild(mk('line', { x1: x, y1: pad.top, x2: x, y2: height - pad.bottom, stroke: 'rgba(148,163,184,0.12)', 'stroke-width': '1' }));
    const lbl = mk('text', { x, y: height - pad.bottom + 12, fill: '#94a3b8', 'font-size': '9', 'text-anchor': 'middle', 'font-family': 'JetBrains Mono, monospace' });
    lbl.textContent = `${w.toFixed(1)}'`;
    svg.appendChild(lbl);
  }

  // Axis labels
  const xTit = mk('text', { x: pad.left + plotW / 2, y: height - 4, fill: '#94a3b8', 'font-size': '9.5', 'text-anchor': 'middle' });
  xTit.textContent = 'Crescent Width W (arcmin)';
  svg.appendChild(xTit);

  const yTit = mk('text', {
    x: 10,
    y: pad.top + plotH / 2,
    fill: '#94a3b8',
    'font-size': '9.5',
    'text-anchor': 'middle',
    transform: `rotate(-90 10 ${pad.top + plotH / 2})`,
  });
  yTit.textContent = 'ARCV (°)';
  svg.appendChild(yTit);

  // Shaded analog band around current candidate q
  if (currentMetrics?.valid && Number.isFinite(currentMetrics.q)) {
    const dq = analogsInfo?.usedWindow || 0.08;
    const ptsTop = [];
    const ptsBot = [];
    for (let w = 0.05; w <= wMax; w += 0.1) {
      ptsTop.push(`${xScale(w).toFixed(1)},${yScale(yallopArcvCurve(w, currentMetrics.q + dq)).toFixed(1)}`);
      ptsBot.unshift(`${xScale(w).toFixed(1)},${yScale(yallopArcvCurve(w, currentMetrics.q - dq)).toFixed(1)}`);
    }
    svg.appendChild(
      mk('polygon', {
        points: ptsTop.concat(ptsBot).join(' '),
        fill: 'rgba(217, 167, 66, 0.16)',
        stroke: 'rgba(217, 167, 66, 0.42)',
        'stroke-width': '0.8',
      })
    );
  }

  // Yallop Zone A (q=0.216) and Zone B/C (q=-0.014) reference curves
  for (const [qVal, color, name] of [
    [0.216, 'rgba(16, 185, 129, 0.45)', 'Yallop A'],
    [-0.014, 'rgba(56, 189, 248, 0.45)', 'Yallop B'],
  ]) {
    const dParts = [];
    for (let w = 0.05; w <= wMax; w += 0.08) {
      const a = yallopArcvCurve(w, qVal);
      if (a >= arcvMin - 2 && a <= arcvMax + 2) {
        dParts.push(`${dParts.length === 0 ? 'M' : 'L'}${xScale(w).toFixed(1)},${yScale(a).toFixed(1)}`);
      }
    }
    if (dParts.length > 1) {
      svg.appendChild(mk('path', { d: dParts.join(' '), fill: 'none', stroke: color, 'stroke-width': '1.2', 'stroke-dasharray': '3,3' }));
      const endW = 2.45;
      const endY = yScale(yallopArcvCurve(endW, qVal));
      const t = mk('text', { x: xScale(endW) - 2, y: Math.max(pad.top + 10, endY - 4), fill: color, 'font-size': '8', 'text-anchor': 'end' });
      t.textContent = name;
      svg.appendChild(t);
    }
  }

  // Tooltip element
  const tip = document.createElement('div');
  tip.className = 'scatter-tooltip hidden';
  container.appendChild(svg);
  container.appendChild(tip);

  const analogSet = new Set((analogsInfo?.analogs || []).map((a) => `${a.hy}-${a.hm}`));

  // Historical points
  for (const obs of historicalObs) {
    if (obs.w > wMax || obs.arcv < arcvMin || obs.arcv > arcvMax) continue;
    const cx = xScale(obs.w);
    const cy = yScale(obs.arcv);
    const isAnalog = analogSet.has(`${obs.hy}-${obs.hm}`);
    const dot = mk('circle', {
      cx,
      cy,
      r: isAnalog ? '4.2' : '2.7',
      fill: obs.sighted ? '#14965a' : '#c93b3b',
      'fill-opacity': isAnalog ? '0.96' : '0.68',
      stroke: isAnalog ? '#f2cb6b' : 'rgba(6,12,26,0.75)',
      'stroke-width': isAnalog ? '1.3' : '0.6',
      style: 'cursor:pointer',
    });

    dot.addEventListener('mouseenter', () => {
      tip.innerHTML = `<strong>${obs.hname} ${obs.hy} AH</strong> (${obs.ev})<br/>
        SA Outcome: <span style="color:${obs.sighted ? '#34d399' : '#fda4af'}">${obs.sighted ? 'Sighted (29d)' : 'Not sighted (30d)'}</span><br/>
        W=${obs.w.toFixed(2)}' · ARCV=${obs.arcv.toFixed(1)}° · q=${obs.sa_best_q.toFixed(3)}
        ${obs.cities?.length ? `<br/>Stations: ${obs.cities.join(', ')}` : ''}`;
      tip.style.left = `${Math.min(200, Math.max(6, (cx / width) * container.clientWidth - 40))}px`;
      tip.style.top = `${Math.max(4, (cy / height) * container.clientHeight - 62)}px`;
      tip.classList.remove('hidden');
    });
    dot.addEventListener('mouseleave', () => tip.classList.add('hidden'));
    svg.appendChild(dot);
  }

  // Current candidate marker (gold star/diamond)
  if (currentMetrics?.valid) {
    const cx = xScale(currentMetrics.wArcmin);
    const cy = yScale(currentMetrics.arcvDeg);
    const diamond = mk('polygon', {
      points: `${cx},${cy - 6} ${cx + 6},${cy} ${cx},${cy + 6} ${cx - 6},${cy}`,
      fill: '#fbbf24',
      stroke: '#070b14',
      'stroke-width': '1.5',
    });
    svg.appendChild(diamond);
  }
}
