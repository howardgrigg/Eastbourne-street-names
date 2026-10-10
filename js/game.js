/* global L */
import {
  AREAS, DEFAULT_AREA, HIGHWAY_TYPES, BASEMAPS,
  SNAP_DISTANCE_MOUSE, SNAP_DISTANCE_TOUCH,
} from './config.js';
import { fetchStreetsFromOverpass } from './osm.js';

const $ = (id) => document.getElementById(id);
const els = {
  map: $('map'),
  names: $('names'),
  progress: $('progress'),
  submit: $('submit-btn'),
  reset: $('reset-btn'),
  result: $('result'),
  ghost: $('ghost'),
  areaSelect: $('area-select'),
  basemapToggle: $('basemap-toggle'),
};

const params = new URLSearchParams(location.search);
const areaKey = AREAS[params.get('area')] ? params.get('area') : DEFAULT_AREA;
const area = AREAS[areaKey];
const storageKey = `eastbourne-street-names:${areaKey}`;

const COLORS = {
  street: '#d59a4a',
  filled: '#0f6b8f',
  hover: '#e8462f',
  good: '#1f8a4c',
  bad: '#c8372d',
};

// ---------- State ----------
let streets = [];            // { name, lines, line, anchor, angle, marker }
const placed = new Map();    // street index -> guessed name
let selected = null;         // { name, from: street index | null }
let submitted = false;
let revealed = false;
let hoverStreet = null;
let projCache = { zoom: null, lines: [] };

// ---------- Map ----------
const bounds = L.latLngBounds([area.bbox[0], area.bbox[1]], [area.bbox[2], area.bbox[3]]);
const map = L.map(els.map, { zoomSnap: 0.5, doubleClickZoom: false });
map.fitBounds(bounds);
map.setMaxBounds(bounds.pad(0.6));
map.setMinZoom(Math.floor(map.getZoom()) - 1);

const basemapLayers = {};
for (const [key, b] of Object.entries(BASEMAPS)) {
  basemapLayers[key] = L.tileLayer(b.url, b.options);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = b.label;
  btn.dataset.key = key;
  btn.addEventListener('click', () => setBasemap(key));
  els.basemapToggle.appendChild(btn);
}
function setBasemap(key) {
  for (const [k, layer] of Object.entries(basemapLayers)) {
    if (k === key) layer.addTo(map); else layer.remove();
  }
  for (const btn of els.basemapToggle.children) {
    btn.setAttribute('aria-pressed', String(btn.dataset.key === key));
  }
}
setBasemap('map');

for (const [key, a] of Object.entries(AREAS)) {
  const opt = new Option(a.label, key, key === areaKey, key === areaKey);
  els.areaSelect.add(opt);
}
els.areaSelect.addEventListener('change', () => {
  const p = new URLSearchParams(location.search);
  p.set('area', els.areaSelect.value);
  location.search = p.toString();
});

// ---------- Loading ----------
async function loadStreets() {
  try {
    const res = await fetch(`data/streets-${areaKey}.json`, { cache: 'no-cache' });
    if (res.ok) {
      const data = await res.json();
      if (data.streets && data.streets.length) return data.streets;
    }
  } catch { /* fall through to live data */ }
  els.progress.textContent = 'Fetching streets from OpenStreetMap…';
  return fetchStreetsFromOverpass(area.bbox, HIGHWAY_TYPES);
}

function showOverlay(text) {
  const div = document.createElement('div');
  div.className = 'loading-overlay';
  div.textContent = text;
  els.map.appendChild(div);
  return div;
}

// ---------- Geometry ----------
const ANGLE_ZOOM = 18;

// Midpoint (by length) of the street's longest piece, plus the angle of the
// street there, so the label can sit on the street and follow its direction.
function computeAnchor(lines) {
  let best = null;
  for (const line of lines) {
    const pts = line.map((ll) => map.project(L.latLng(ll), ANGLE_ZOOM));
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += pts[i].distanceTo(pts[i - 1]);
    if (!best || len > best.len) best = { pts, len };
  }
  let remaining = best.len / 2;
  const { pts } = best;
  for (let i = 1; i < pts.length; i++) {
    const seg = pts[i].distanceTo(pts[i - 1]);
    if (seg >= remaining || i === pts.length - 1) {
      const t = seg ? Math.min(1, remaining / seg) : 0;
      const a = pts[i - 1];
      const b = pts[i];
      const p = L.point(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
      let angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
      if (angle > 90) angle -= 180;
      if (angle < -90) angle += 180;
      return { latlng: map.unproject(p, ANGLE_ZOOM), angle };
    }
    remaining -= seg;
  }
  return { latlng: L.latLng(best.pts.length ? map.unproject(best.pts[0], ANGLE_ZOOM) : lines[0][0]), angle: 0 };
}

function projectedLines() {
  const zoom = map.getZoom();
  if (projCache.zoom !== zoom) {
    projCache = {
      zoom,
      lines: streets.map((s) => s.lines.map((line) => line.map((ll) => map.project(L.latLng(ll), zoom)))),
    };
  }
  return projCache.lines;
}

function nearestStreet(containerPoint, maxDist) {
  const zoom = map.getZoom();
  const p = map.project(map.containerPointToLatLng(containerPoint), zoom);
  let best = null;
  let bestDist = maxDist;
  projectedLines().forEach((lines, idx) => {
    for (const pts of lines) {
      for (let i = 1; i < pts.length; i++) {
        const d = L.LineUtil.pointToSegmentDistance(p, pts[i - 1], pts[i]);
        if (d < bestDist) { bestDist = d; best = idx; }
      }
    }
  });
  return best;
}

// ---------- Placement ----------
function streetOf(name) {
  for (const [idx, n] of placed) if (n === name) return idx;
  return null;
}

function place(name, idx) {
  const from = streetOf(name);
  if (from === idx) return;
  const existing = placed.get(idx);
  if (from !== null) placed.delete(from);
  // Swap when moving a label from one street onto another labelled street.
  if (existing && from !== null) placed.set(from, existing);
  placed.set(idx, name);
  afterChange();
}

function unplace(name) {
  const from = streetOf(name);
  if (from !== null) placed.delete(from);
  afterChange();
}

function afterChange() {
  selected = null;
  save();
  render();
}

function save() {
  try {
    const data = [...placed].map(([idx, name]) => [streets[idx].name, name]);
    localStorage.setItem(storageKey, JSON.stringify(data));
  } catch { /* storage unavailable */ }
}

function restore() {
  try {
    const data = JSON.parse(localStorage.getItem(storageKey) || '[]');
    const indexByName = new Map(streets.map((s, i) => [s.name, i]));
    const names = new Set(streets.map((s) => s.name));
    const used = new Set();
    for (const [streetName, guess] of data) {
      const idx = indexByName.get(streetName);
      if (idx === undefined || !names.has(guess) || used.has(guess)) continue;
      placed.set(idx, guess);
      used.add(guess);
    }
  } catch { /* ignore bad saved state */ }
}

// ---------- Rendering ----------
function render() {
  renderList();
  renderStreets();
  renderLabels();
  const total = streets.length;
  els.progress.textContent = submitted
    ? `${countCorrect()} / ${total} correct`
    : `${placed.size} / ${total} placed`;
  els.submit.disabled = submitted || placed.size === 0;
  els.reset.disabled = placed.size === 0 && !submitted;
}

function renderList() {
  const placedNames = new Set(placed.values());
  const remaining = streets.map((s) => s.name).filter((n) => !placedNames.has(n));
  els.names.replaceChildren();
  if (!remaining.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = submitted ? '' : 'All names placed — hit Submit when you’re happy!';
    els.names.appendChild(li);
    return;
  }
  for (const name of remaining) {
    const li = document.createElement('li');
    li.className = 'chip';
    li.textContent = name;
    if (selected && selected.from === null && selected.name === name) li.classList.add('selected');
    li.addEventListener('pointerdown', (ev) => startPointer(ev, name, null, li));
    els.names.appendChild(li);
  }
}

function streetStyle(idx) {
  if (idx === hoverStreet) return { color: COLORS.hover, weight: 8, opacity: 0.95 };
  if (submitted) {
    const guess = placed.get(idx);
    if (guess === streets[idx].name) return { color: COLORS.good, weight: 6, opacity: 0.85 };
    return { color: COLORS.bad, weight: 6, opacity: 0.85 };
  }
  if (placed.has(idx)) return { color: COLORS.filled, weight: 6, opacity: 0.8 };
  return { color: COLORS.street, weight: 6, opacity: 0.8 };
}

function renderStreets() {
  streets.forEach((s, idx) => s.line.setStyle(streetStyle(idx)));
}

function labelHtml(idx) {
  const guess = placed.get(idx);
  const truth = streets[idx].name;
  if (!submitted) return { text: guess, cls: '' };
  if (guess === truth) return { text: guess, cls: 'correct' };
  if (!guess) return revealed ? { text: truth, cls: 'answer' } : null;
  return revealed
    ? { html: `<span class="was">${escapeHtml(guess)}</span><span class="fix">${escapeHtml(truth)}</span>`, cls: 'wrong' }
    : { text: guess, cls: 'wrong' };
}

function renderLabels() {
  streets.forEach((s, idx) => {
    const content = placed.has(idx) || submitted ? labelHtml(idx) : null;
    if (!content) {
      if (s.marker) { s.marker.remove(); s.marker = null; }
      return;
    }
    if (!s.marker) {
      s.marker = L.marker(s.anchor, {
        icon: L.divIcon({ className: 'label-anchor', html: '<div class="map-label"></div>', iconSize: null }),
        interactive: false,
        keyboard: false,
      }).addTo(map);
      const el = s.marker.getElement().firstChild;
      el.style.pointerEvents = 'auto';
      L.DomEvent.on(el, 'mousedown touchstart click dblclick', L.DomEvent.stopPropagation);
      el.addEventListener('pointerdown', (ev) => {
        ev.stopPropagation();
        const name = placed.get(idx);
        if (name) startPointer(ev, name, idx, el);
      });
    }
    const el = s.marker.getElement().firstChild;
    el.className = `map-label ${content.cls}`;
    if (selected && selected.from === idx) el.classList.add('selected');
    if (content.html) el.innerHTML = content.html; else el.textContent = content.text;
    el.style.transform = `translate(-50%, -50%) rotate(${s.angle}deg)`;
    el.style.touchAction = 'none';
  });
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function setHover(idx) {
  if (idx === hoverStreet) return;
  const prev = hoverStreet;
  hoverStreet = idx;
  if (prev !== null) streets[prev].line.setStyle(streetStyle(prev));
  if (idx !== null) {
    streets[idx].line.setStyle(streetStyle(idx));
    streets[idx].line.bringToFront();
  }
}

// ---------- Dragging and tapping ----------
function overElement(el, x, y) {
  const r = el.getBoundingClientRect();
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

function startPointer(ev, name, fromIdx, sourceEl) {
  if (submitted) return;
  if (ev.pointerType === 'mouse' && ev.button !== 0) return;
  // On touch screens, chips in the list can only be tapped, so the list still scrolls.
  const canDrag = !(ev.pointerType === 'touch' && fromIdx === null);
  const snap = ev.pointerType === 'mouse' ? SNAP_DISTANCE_MOUSE : SNAP_DISTANCE_TOUCH;
  const startX = ev.clientX;
  const startY = ev.clientY;
  let dragging = false;
  if (canDrag) ev.preventDefault();

  const target = (x, y) => {
    if (overElement(els.map, x, y)) {
      const r = els.map.getBoundingClientRect();
      return { kind: 'map', idx: nearestStreet(L.point(x - r.left, y - r.top), snap) };
    }
    if (overElement(els.names.parentElement, x, y)) return { kind: 'list' };
    return { kind: 'none' };
  };

  const move = (e) => {
    if (e.pointerId !== ev.pointerId) return;
    if (!dragging) {
      if (!canDrag || Math.hypot(e.clientX - startX, e.clientY - startY) < 6) return;
      dragging = true;
      selected = null;
      map.dragging.disable();
      sourceEl.classList.add('dragging');
      els.ghost.textContent = name;
      els.ghost.hidden = false;
    }
    els.ghost.style.left = `${e.clientX}px`;
    els.ghost.style.top = `${e.clientY}px`;
    const t = target(e.clientX, e.clientY);
    setHover(t.kind === 'map' ? t.idx : null);
    els.names.classList.toggle('drop-target', t.kind === 'list' && fromIdx !== null);
  };

  const up = (e) => {
    if (e.pointerId !== ev.pointerId) return;
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    if (!dragging) {
      if (e.type === 'pointerup') tap(name, fromIdx);
      return;
    }
    els.ghost.hidden = true;
    els.names.classList.remove('drop-target');
    sourceEl.classList.remove('dragging');
    map.dragging.enable();
    setHover(null);
    if (e.type === 'pointercancel') { render(); return; }
    const t = target(e.clientX, e.clientY);
    if (t.kind === 'map' && t.idx !== null) place(name, t.idx);
    else if (t.kind === 'list' && fromIdx !== null) unplace(name);
    else render();
  };

  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}

function tap(name, fromIdx) {
  // Tapping a placed label while holding another name drops that name there.
  if (fromIdx !== null && selected && selected.name !== name) {
    place(selected.name, fromIdx);
    return;
  }
  // Tapping a chip while holding a placed label sends the label back to the list.
  if (fromIdx === null && selected && selected.from !== null) {
    unplace(selected.name);
    return;
  }
  const same = selected && selected.name === name;
  selected = same ? null : { name, from: fromIdx };
  render();
}

map.on('click', (e) => {
  if (submitted || !selected) return;
  const snap = e.originalEvent && e.originalEvent.pointerType === 'mouse' ? SNAP_DISTANCE_MOUSE : SNAP_DISTANCE_TOUCH;
  const idx = nearestStreet(e.containerPoint, snap);
  if (idx !== null) place(selected.name, idx);
});

// Tapping empty space in the list while holding a placed label takes it off the map.
els.names.addEventListener('click', (e) => {
  if (e.target === els.names && selected && selected.from !== null) unplace(selected.name);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && selected) { selected = null; render(); }
});

// ---------- Scoring ----------
function countCorrect() {
  let n = 0;
  for (const [idx, name] of placed) if (streets[idx].name === name) n++;
  return n;
}

function scoreMessage(pct) {
  if (pct === 100) return 'Perfect! You clearly never left.';
  if (pct >= 80) return 'Local legend. The ferry still waits for you.';
  if (pct >= 60) return 'Solid. You know your way to the Days Bay Pavilion.';
  if (pct >= 40) return 'Not bad — a few walks along Marine Drive would help.';
  if (pct >= 20) return 'Hmm. Have you been spending too much time over the harbour?';
  return 'Did you actually live in Eastbourne?';
}

function submit() {
  submitted = true;
  selected = null;
  revealed = false;
  const correct = countCorrect();
  const total = streets.length;
  const pct = Math.round((correct / total) * 100);
  const wrong = placed.size - correct;
  const missed = total - placed.size;

  els.result.hidden = false;
  els.result.innerHTML = `
    <div class="score">${correct} / ${total} <small>(${pct}%)</small></div>
    <p>${scoreMessage(pct)}<br>${wrong} wrong, ${missed} not placed.</p>
    <div class="buttons">
      <button class="primary" id="reveal-btn">Reveal answers</button>
      <button class="ghost" id="retry-btn">Retry the wrong ones</button>
      <button class="ghost" id="share-btn">Share score</button>
    </div>`;
  $('reveal-btn').addEventListener('click', (e) => {
    revealed = !revealed;
    e.target.textContent = revealed ? 'Hide answers' : 'Reveal answers';
    render();
  });
  $('retry-btn').addEventListener('click', retryWrong);
  $('share-btn').addEventListener('click', () => share(correct, total, pct));
  els.help.hidden = true;
  render();
}

function retryWrong() {
  for (const [idx, name] of [...placed]) if (streets[idx].name !== name) placed.delete(idx);
  submitted = false;
  revealed = false;
  els.result.hidden = true;
  els.help.hidden = false;
  save();
  render();
}

function resetAll() {
  if (placed.size && !submitted && !confirm('Take every name off the map and start again?')) return;
  placed.clear();
  submitted = false;
  revealed = false;
  selected = null;
  els.result.hidden = true;
  els.help.hidden = false;
  save();
  render();
}

async function share(correct, total, pct) {
  const text = `I put ${correct} of ${total} Eastbourne street names in the right place (${pct}%). Can you beat me?`;
  const url = location.href;
  try {
    if (navigator.share) { await navigator.share({ title: 'Eastbourne Street Names', text, url }); return; }
    await navigator.clipboard.writeText(`${text} ${url}`);
    $('share-btn').textContent = 'Copied!';
  } catch { /* user cancelled */ }
}

els.help = $('help');
els.submit.addEventListener('click', () => {
  const missing = streets.length - placed.size;
  if (missing && !confirm(`${missing} street${missing === 1 ? ' is' : 's are'} still unnamed. Submit anyway?`)) return;
  submit();
});
els.reset.addEventListener('click', resetAll);

// ---------- Start ----------
(async function init() {
  const overlay = showOverlay('Loading the streets of Eastbourne…');
  let data;
  try {
    data = await loadStreets();
  } catch (err) {
    overlay.textContent = `Couldn’t load street data (${err.message}). Try refreshing in a minute.`;
    els.progress.textContent = 'No street data';
    return;
  }
  overlay.remove();
  streets = data.map((s) => {
    const { latlng, angle } = computeAnchor(s.lines);
    const line = L.polyline(s.lines, { ...streetStyle(-1), interactive: false, lineCap: 'round' }).addTo(map);
    return { name: s.name, lines: s.lines, line, anchor: latlng, angle, marker: null };
  });
  restore();
  render();
})();
