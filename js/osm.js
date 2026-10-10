// Shared between the browser game and scripts/fetch-streets.mjs.
// Turns OpenStreetMap data from the Overpass API into a list of named streets.

export const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

export function buildQuery(bbox, highwayTypes) {
  const [s, w, n, e] = bbox;
  return `[out:json][timeout:60];
way["highway"~"^(${highwayTypes.join('|')})$"]["name"](${s},${w},${n},${e});
out geom;`;
}

const round = (v) => Math.round(v * 1e6) / 1e6;

// Liang-Barsky: the part of segment a-b inside the box, or null.
function clipSegment(a, b, [s, w, n, e]) {
  const [y0, x0] = a;
  const dy = b[0] - y0;
  const dx = b[1] - x0;
  let t0 = 0;
  let t1 = 1;
  const checks = [[-dx, x0 - w], [dx, e - x0], [-dy, y0 - s], [dy, n - y0]];
  for (const [p, q] of checks) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const t = q / p;
    if (p < 0) { if (t > t1) return null; if (t > t0) t0 = t; } else { if (t < t0) return null; if (t < t1) t1 = t; }
  }
  const at = (t) => [round(y0 + dy * t), round(x0 + dx * t)];
  return [t0 === 0 ? a : at(t0), t1 === 1 ? b : at(t1)];
}

// Keep only the parts of a way inside the bounding box, so long roads
// like Marine Drive don't stretch out of the area being played.
function clipLine(points, bbox) {
  const lines = [];
  let cur = [];
  for (let i = 0; i < points.length - 1; i++) {
    const seg = clipSegment(points[i], points[i + 1], bbox);
    if (!seg) {
      if (cur.length > 1) lines.push(cur);
      cur = [];
      continue;
    }
    if (!cur.length) cur.push(seg[0]);
    cur.push(seg[1]);
    if (seg[1] !== points[i + 1]) {
      lines.push(cur);
      cur = [];
    }
  }
  if (cur.length > 1) lines.push(cur);
  return lines;
}

export function overpassToStreets(json, bbox) {
  const byName = new Map();
  for (const el of json.elements || []) {
    if (el.type !== 'way' || !el.geometry || !el.tags || !el.tags.name) continue;
    const name = el.tags.name.trim();
    const points = el.geometry.filter(Boolean).map((p) => [round(p.lat), round(p.lon)]);
    const lines = clipLine(points, bbox);
    if (!lines.length) continue;
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(...lines);
  }
  return [...byName]
    .map(([name, lines]) => ({ name, lines }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function fetchStreetsFromOverpass(bbox, highwayTypes, fetchImpl = fetch) {
  const query = buildQuery(bbox, highwayTypes);
  let lastError;
  for (const url of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query),
      });
      if (!res.ok) throw new Error(`${url} responded ${res.status}`);
      const streets = overpassToStreets(await res.json(), bbox);
      if (!streets.length) throw new Error(`${url} returned no streets`);
      return streets;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}
